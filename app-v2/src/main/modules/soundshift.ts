import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ModuleContext } from '../module-context'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import { logger } from './logger'
import {
  DEFAULT_SOUNDS_CONFIG,
  DEFAULT_SOUNDSHIFT_CONFIG,
  SOUNDSHIFT_CHANNELS,
  carKeyOf,
  effectiveMode,
  effectiveShiftOffsetRpm,
  evaluateAbs,
  evaluateIncident,
  evaluateShift,
  evaluateTcs,
  hasUsableShiftRpm,
  resolveCarKey,
  resolveExactTarget,
  resolveShiftTarget,
  type ControlAssistSoundConfig,
  type ControlTriggerMode,
  type IncidentSoundConfig,
  type SoundCue,
  type SoundCueSettings,
  type SoundAlertId,
  type SoundsConfig,
  type SoundshiftCarTuning,
  type SoundshiftConfig,
  type SoundshiftMode,
  type SoundshiftSnapshotLike
} from '../../shared/soundshift'
import {
  isLiveTelemetrySnapshot,
  LiveTelemetryGate,
  sameLiveTelemetryContext,
  type LiveTelemetryContext
} from '../../shared/replay'

const CONFIG_FILE = 'soundshift.json'
const SOUNDSHIFT_CANCEL_EVENT = 'soundshift:cancel'

export type SoundsConfigPatch = {
  version?: 2
  outputDeviceId?: string
  soundshift?: Partial<SoundshiftConfig>
  incident?: Partial<IncidentSoundConfig>
  abs?: Partial<ControlAssistSoundConfig>
  tcs?: Partial<ControlAssistSoundConfig>
  updatedAt?: number
}

let config: SoundsConfig = DEFAULT_SOUNDS_CONFIG
let previousSnapshot: TelemetrySnapshot | null = null
let previousIncidentCount: number | undefined
let shiftArmed = true
let wasInShiftZone = false
// Dedupe key for the resolved-shift-target diagnostic below: it logs only when the
// car, mode, or computed shift RPM actually changes (processShift runs at telemetry
// rate, so this gate keeps it off the per-tick hot path).
let lastShiftResolutionKey: string | null = null
let wasAbsEngaging = false
let wasTcsEngaging = false
const lastCueAt: Partial<Record<SoundAlertId, number>> = {}

export function register(ctx: ModuleContext): void {
  const configPath = join(ctx.app.getPath('userData'), CONFIG_FILE)
  const liveGate = new LiveTelemetryGate()
  let lastLiveContext: LiveTelemetryContext | null = null
  let observedLive = false
  let configReady = false
  let pendingLiveSnapshot: TelemetrySnapshot | null = null

  void loadConfig(configPath).then((loaded) => {
    config = loaded
    configReady = true
    ctx.broadcast(SOUNDSHIFT_CHANNELS.configEvent, config)
    const pending = pendingLiveSnapshot
    pendingLiveSnapshot = null
    if (pending) {
      resetLiveState()
      seedLiveState(pending)
    }
  })

  ctx.telemetryHub.on('snapshot', (snapshot: TelemetrySnapshot | null) => {
    const live = liveGate.observe(snapshot)
    const liveContextChanged = Boolean(
      live.live &&
      live.context &&
      lastLiveContext &&
      !sameLiveTelemetryContext(live.context, lastLiveContext)
    )
    const boundary = live.boundary || liveContextChanged
    const firstLive = live.live && !observedLive
    if (live.live) observedLive = true
    if (live.live && live.context) lastLiveContext = live.context

    if (boundary) {
      resetLiveState()
      ctx.broadcast(SOUNDSHIFT_CANCEL_EVENT, { state: live.state, revision: snapshot?.replayContext?.revision })
    }
    if (!live.live || !snapshot) {
      pendingLiveSnapshot = null
      return
    }
    if (!configReady) {
      pendingLiveSnapshot = snapshot
      return
    }
    if (firstLive && !boundary) resetLiveState()
    if (boundary || firstLive) {
      seedLiveState(snapshot)
      return
    }
    processSnapshot(ctx, snapshot)
  })

  ctx.ipcMain.handle(SOUNDSHIFT_CHANNELS.getConfig, () => config)

  ctx.ipcMain.handle(SOUNDSHIFT_CHANNELS.setConfig, async (_event, patch: SoundsConfigPatch) => {
    config = mergeConfig(config, patch)
    await saveAndBroadcast(ctx, configPath)
    return config
  })

  ctx.ipcMain.handle(
    SOUNDSHIFT_CHANNELS.updateLearned,
    async (_event, carKeyArg: string | undefined, gearArg: number, rpmArg: number, carName?: string, maxRpmArg?: number, carPathArg?: string) => {
      if (!isLiveTelemetrySnapshot(ctx.telemetryHub.getLatest())) return config
      const cars = learnedUpshiftWrite(config.soundshift, carKeyArg, gearArg, rpmArg, carName, maxRpmArg, carPathArg)
      if (!cars) return config
      config = mergeConfig(config, { soundshift: { cars } })
      await saveAndBroadcast(ctx, configPath)
      return config
    }
  )

  ctx.ipcMain.handle(SOUNDSHIFT_CHANNELS.clearLearned, async () => {
    config = mergeConfig(config, { soundshift: { cars: stripLearned(config.soundshift.cars) } })
    await saveAndBroadcast(ctx, configPath)
    return config
  })
}

// Pure core of the auto-learn write, shared by the IPC handler and tests. Returns the next
// `cars` map, or null when the sample must be IGNORED — two de-contamination guards:
//   • no real carName (collapses to the 'unknown' bucket that mixed distinct cars), or
//   • rpm above the car's redline (a missed/late shift, or a cross-car bogus reading).
// Never stamps a per-car `mode` (that pinned cars to a stale global default forever); an
// explicit prior mode is preserved via `...existing`, otherwise it stays undefined.
export function learnedUpshiftWrite(
  soundshift: SoundshiftConfig,
  carKeyArg: string | undefined,
  gearArg: number,
  rpmArg: number,
  carName?: string,
  maxRpmArg?: number,
  carPathArg?: string
): Record<string, SoundshiftCarTuning> | null {
  // Prefer the stable carPath for the key (consistent with evaluateShift's resolution),
  // then an explicit carKeyArg, then the display carName.
  const key = carKeyOf(carKeyArg || carName, carPathArg)
  if (key === 'unknown') return null
  const gear = Math.round(Number(gearArg))
  const rpm = Math.round(Number(rpmArg))
  if (gear < 1 || !Number.isFinite(rpm) || rpm <= 0) return null
  const maxRpm = Number(maxRpmArg)
  if (Number.isFinite(maxRpm) && maxRpm > 0 && rpm > maxRpm) return null

  const existing = soundshift.cars[key]
  const learned = { ...(existing?.learnedUpshiftRpmByGear ?? {}) }
  const previous = learned[gear]
  learned[gear] = previous == null ? rpm : Math.round(previous * 0.7 + rpm * 0.3)

  const tuning: SoundshiftCarTuning = sanitizeTuning({
    ...existing,
    carKey: key,
    carName: carName ?? existing?.carName,
    learnedUpshiftRpmByGear: learned
  }, key)
  return { ...soundshift.cars, [key]: tuning }
}

// Drops every car's learned per-gear RPM. Each car entry REPLACES its base entry in
// mergeConfig (shallow per-key merge), so omitting learnedUpshiftRpmByGear wipes it.
function stripLearned(cars: Record<string, SoundshiftCarTuning>): Record<string, SoundshiftCarTuning> {
  return Object.fromEntries(
    Object.entries(cars).map(([key, tuning]) => {
      const { learnedUpshiftRpmByGear: _drop, ...rest } = tuning
      return [key, rest]
    })
  )
}

function resetLiveState(): void {
  previousSnapshot = null
  previousIncidentCount = undefined
  shiftArmed = true
  wasInShiftZone = false
  wasAbsEngaging = false
  wasTcsEngaging = false
  lastShiftResolutionKey = null
  for (const key of Object.keys(lastCueAt) as SoundAlertId[]) delete lastCueAt[key]
}

function seedLiveState(snapshot: TelemetrySnapshot): void {
  previousSnapshot = snapshot
  if (snapshot.incidentCount != null && Number.isFinite(snapshot.incidentCount)) {
    previousIncidentCount = snapshot.incidentCount
  }

  const shiftDecision = evaluateShift(config.soundshift, snapshot)
  wasInShiftZone = shiftDecision.shouldBeep
  shiftArmed = !shiftDecision.shouldBeep
  wasAbsEngaging = evaluateAbs(config.abs, snapshot).engaging
  if (wasAbsEngaging && config.abs.triggerMode === 'repeat') {
    lastCueAt.abs = Date.now()
  } else {
    delete lastCueAt.abs
  }
  wasTcsEngaging = evaluateTcs(config.tcs, snapshot).engaging
}

function processSnapshot(ctx: ModuleContext, snapshot: TelemetrySnapshot | null): void {
  if (!isLiveTelemetrySnapshot(snapshot)) {
    resetLiveState()
    return
  }

  processShift(ctx, snapshot)
  processIncident(ctx, snapshot)
  processAbs(ctx, snapshot)
  processTcs(ctx, snapshot)
  previousSnapshot = snapshot
}

function processShift(ctx: ModuleContext, snapshot: TelemetrySnapshot): void {
  logShiftResolutionIfChanged(config.soundshift, snapshot)
  if (previousSnapshot && snapshot.gear !== previousSnapshot.gear) {
    shiftArmed = true
    wasInShiftZone = false
  }

  // 'exact' mode fires AT the iRacing shift point, so it must NOT anticipate: force the
  // lead projection to 0 for it (other modes keep the configurable leadMs anticipation).
  const leadMs = effectiveLeadMs(config.soundshift, snapshot.carName, snapshot.carPath)
  const evalSnapshot = projectForLead(snapshot, previousSnapshot, leadMs)
  const decision = evaluateShift(config.soundshift, evalSnapshot)
  const clearlyBelow = isClearlyBelowThreshold(config.soundshift, snapshot)
  if (clearlyBelow || !decision.shouldBeep) {
    if (clearlyBelow) shiftArmed = true
    wasInShiftZone = false
  }

  if (decision.shouldBeep && shiftArmed && !wasInShiftZone) {
    logShiftFire(config.soundshift, snapshot, evalSnapshot.rpm, decision.reason)
    emitCue(ctx, 'soundshift', config.soundshift, decision.reason)
    shiftArmed = false
  }

  wasInShiftZone = decision.shouldBeep
}

// Logs ONE line per beep (the not-beeping → beeping transition), never per snapshot:
// this block only runs when the cue is armed and first enters the shift zone, and it
// disarms immediately after. Detail mirrors the decision so logs explain WHY it fired.
function logShiftFire(
  soundshift: SoundshiftConfig,
  snapshot: TelemetrySnapshot,
  projectedRpm: number,
  reason: string
): void {
  const tuning = soundshift.cars[resolveCarKey(soundshift.cars, snapshot.carName, snapshot.carPath)]
  const mode = tuning?.mode ?? soundshift.defaultMode
  // In 'exact' mode the cue uses the iRacing shift point itself, NOT resolveShiftTarget()'s
  // learned/threshold value (which could read ABOVE redline and mislead). Log the real point:
  // DriverCarSLShiftRPM when usable, else the live rpm at fire (where shiftIndicatorPct hit 1.0).
  const usesLead = mode !== 'exact'
  const target = mode === 'exact'
    ? (resolveExactTarget(snapshot) ?? Math.round(snapshot.rpm))
    : resolveShiftTarget(soundshift, tuning, snapshot)
  logger.info('soundshift', 'shift cue fired', {
    mode,
    target,
    rpm: snapshot.rpm,
    // The trigger compares the LEAD-PROJECTED rpm against target, so `projectedRpm`
    // (not raw `rpm`) is the value that crossed the threshold — log both so a cue that
    // fires while raw rpm is still below target is explainable (leadMs anticipation).
    // 'exact' mode applies no lead, so these are omitted there.
    ...(usesLead ? { projectedRpm: Math.round(projectedRpm), leadMs: soundshift.leadMs } : {}),
    redline: snapshot.maxRpm,
    gear: snapshot.gear,
    car: snapshot.carName,
    offset: effectiveShiftOffsetRpm(soundshift, tuning),
    reason
  })
}

// Logs the RESOLVED shift target whenever the CAR, mode, or computed shift RPM
// changes — never per tick. processShift runs at telemetry rate, so this is gated
// by a dedupe key and an unchanged resolution is skipped. Mirrors logShiftFire's
// resolution but WITHOUT the live-rpm fallback (which would move every frame), so
// the key stays stable per car/mode and a capture shows the active shift point.
function logShiftResolutionIfChanged(soundshift: SoundshiftConfig, snapshot: TelemetrySnapshot): void {
  const carKey = resolveCarKey(soundshift.cars, snapshot.carName, snapshot.carPath)
  const tuning = soundshift.cars[carKey]
  const mode = tuning?.mode ?? soundshift.defaultMode
  const target = mode === 'exact'
    ? resolveExactTarget(snapshot)
    : resolveShiftTarget(soundshift, tuning, snapshot)
  const key = `${carKey}|${mode}|${target ?? 'n/a'}`
  if (key === lastShiftResolutionKey) return
  lastShiftResolutionKey = key
  logger.info('soundshift', 'shift target resolved', {
    car: snapshot.carName,
    carKey,
    mode,
    target,
    redline: snapshot.maxRpm,
    offset: effectiveShiftOffsetRpm(soundshift, tuning)
  })
}

function processIncident(ctx: ModuleContext, snapshot: TelemetrySnapshot): void {
  const decision = evaluateIncident(config.incident, snapshot, previousIncidentCount)
  if (decision.shouldBeep && canEmit('incident', config.incident.cooldownMs)) {
    emitCue(ctx, 'incident', config.incident, decision.reason)
  }
  if (snapshot.incidentCount != null && Number.isFinite(snapshot.incidentCount)) {
    previousIncidentCount = snapshot.incidentCount
  }
}

function processAbs(ctx: ModuleContext, snapshot: TelemetrySnapshot): void {
  const decision = evaluateAbs(config.abs, snapshot)
  const shouldEmit = decision.engaging && shouldEmitControlCue('abs', config.abs, wasAbsEngaging)
  if (shouldEmit) emitCue(ctx, 'abs', config.abs, decision.reason)
  wasAbsEngaging = decision.engaging
}

function processTcs(ctx: ModuleContext, snapshot: TelemetrySnapshot): void {
  const decision = evaluateTcs(config.tcs, snapshot)
  const shouldEmit = decision.engaging && !wasTcsEngaging && canEmit('tcs', config.tcs.repeatMs)
  if (shouldEmit) emitCue(ctx, 'tcs', config.tcs, decision.reason)
  wasTcsEngaging = decision.engaging
}

function shouldEmitControlCue(id: 'abs' | 'tcs', cueConfig: ControlAssistSoundConfig, wasEngaging: boolean): boolean {
  if (cueConfig.triggerMode === 'start') return !wasEngaging && canEmit(id, cueConfig.repeatMs)
  return canEmit(id, cueConfig.repeatMs)
}

function canEmit(id: SoundAlertId, intervalMs: number): boolean {
  const now = Date.now()
  const last = lastCueAt[id] ?? 0
  if (now - last < Math.max(0, intervalMs)) return false
  lastCueAt[id] = now
  return true
}

function emitCue(ctx: ModuleContext, id: SoundAlertId, cueConfig: SoundCueSettings, reason: string): void {
  const cue: SoundCue = {
    id,
    toneHz: cueConfig.toneHz,
    volume: cueConfig.volume,
    beepMs: cueConfig.beepMs,
    reason,
    at: Date.now()
  }
  ctx.broadcast(SOUNDSHIFT_CHANNELS.cueEvent, cue)
}

async function saveAndBroadcast(ctx: ModuleContext, configPath: string): Promise<void> {
  await saveConfig(configPath, config)
  ctx.broadcast(SOUNDSHIFT_CHANNELS.configEvent, config)
}

async function loadConfig(configPath: string): Promise<SoundsConfig> {
  try {
    const raw = await readFile(configPath, 'utf8')
    const parsed = JSON.parse(raw) as SoundsConfigPatch | Partial<SoundshiftConfig>
    return mergeConfig(DEFAULT_SOUNDS_CONFIG, migrateLoadedSoundshift(migrateConfig(parsed)))
  } catch {
    return { ...DEFAULT_SOUNDS_CONFIG, updatedAt: Date.now() }
  }
}

// Inner-soundshift config version. Bumped 2→3 in round-16 when the default shift mode
// became 'exact' (beep AT the iRacing shift point, no lead) and auto-learned per-car data
// had to be reset. (2 was round-15's 'redlineOffset' default; 1 predates both.)
const SOUNDSHIFT_CONFIG_VERSION = 3

// ONE-TIME, LOAD-ONLY migration (NOT applied in mergeConfig, so deliberate in-UI choices
// survive). For any persisted soundshift older than version 3 it:
//   1. sets the global defaultMode to 'exact' (the round-16 shift-point fix reaches existing
//      users, not just fresh installs);
//   2. un-pins every per-car tuning whose `mode` equals the OLD default 'shiftLight' — the
//      value auto-learn stamped pre-round-15, which pinned those cars to shiftLight forever
//      (cleared to undefined → follows the global 'exact'). Explicit 'rpm'/'redlineOffset'/
//      'exact' selections are preserved as deliberate power-user choices;
//   3. WIPES every car's learnedUpshiftRpmByGear (cross-car contaminated: the learn write had
//      no redline clamp and an empty carName collapsed distinct cars into one 'unknown' bucket);
//   4. drops the 'unknown' car bucket entirely.
// Idempotent: a version-3 config is returned untouched.
export function migrateLoadedSoundshift(patch: SoundsConfigPatch): SoundsConfigPatch {
  const ss = patch.soundshift
  if (!ss) return patch
  const version = typeof ss.version === 'number' ? ss.version : 1
  if (version >= SOUNDSHIFT_CONFIG_VERSION) return patch

  const nextCars: Record<string, SoundshiftCarTuning> = {}
  for (const [key, tuning] of Object.entries(ss.cars ?? {})) {
    if (key === 'unknown') continue
    const { learnedUpshiftRpmByGear: _wipe, mode, ...rest } = tuning
    const migratedCar: SoundshiftCarTuning = { ...rest }
    // Preserve ONLY modes that could have been a DELIBERATE per-car choice: 'rpm'
    // (never a global default) and 'exact' (new in round 16). Un-pin 'shiftLight' AND
    // 'redlineOffset' — both were stamped automatically by round-15 auto-learn
    // (`mode: existing?.mode ?? defaultMode`, gated only by autoLearn=true), so a car
    // the user merely DROVE in v2.13/v2.14 carries that stamp without ever choosing it.
    // Clearing it (→ undefined) lets the car follow the new global 'exact' default,
    // which is what the user asked for. (A deliberate redlineOffset user re-selects it.)
    if (mode === 'rpm' || mode === 'exact') migratedCar.mode = mode
    nextCars[key] = migratedCar
  }

  return {
    ...patch,
    soundshift: {
      ...ss,
      version: SOUNDSHIFT_CONFIG_VERSION,
      defaultMode: 'exact',
      cars: nextCars
    }
  }
}

async function saveConfig(configPath: string, nextConfig: SoundsConfig): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8')
}

function migrateConfig(input: SoundsConfigPatch | Partial<SoundshiftConfig>): SoundsConfigPatch {
  if ('soundshift' in input || input.version === 2) return input as SoundsConfigPatch
  return { soundshift: input as Partial<SoundshiftConfig> }
}

function mergeConfig(base: SoundsConfig, patch: SoundsConfigPatch | Partial<SoundshiftConfig>): SoundsConfig {
  const migrated = migrateConfig(patch)
  return {
    version: 2,
    outputDeviceId: sanitizeOutputDeviceId(migrated.outputDeviceId ?? base.outputDeviceId),
    soundshift: mergeSoundshiftConfig(base.soundshift, migrated.soundshift ?? {}),
    incident: sanitizeIncidentConfig(base.incident, migrated.incident ?? {}),
    abs: sanitizeControlConfig(base.abs, migrated.abs ?? {}),
    tcs: sanitizeControlConfig(base.tcs, migrated.tcs ?? {}),
    updatedAt: Date.now()
  }
}

function mergeSoundshiftConfig(base: SoundshiftConfig, patch: Partial<SoundshiftConfig>): SoundshiftConfig {
  const nextCars = sanitizeCars({ ...base.cars, ...(patch.cars ?? {}) })
  return {
    version: SOUNDSHIFT_CONFIG_VERSION,
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : base.enabled,
    toneHz: clamp(patch.toneHz, 120, 6000, base.toneHz),
    volume: clamp(patch.volume, 0, 1, base.volume),
    beepMs: Math.round(clamp(patch.beepMs, 20, 500, base.beepMs)),
    leadMs: Math.round(clamp(patch.leadMs, 0, 1000, base.leadMs)),
    autoLearn: typeof patch.autoLearn === 'boolean' ? patch.autoLearn : base.autoLearn,
    defaultMode: sanitizeMode(patch.defaultMode, base.defaultMode),
    defaultThresholdPct: clamp(patch.defaultThresholdPct, 0.5, 1, base.defaultThresholdPct),
    defaultShiftOffsetRpm: Math.round(clamp(patch.defaultShiftOffsetRpm, 0, 2000, base.defaultShiftOffsetRpm)),
    cars: nextCars,
    updatedAt: Date.now()
  }
}

function sanitizeIncidentConfig(base: IncidentSoundConfig, patch: Partial<IncidentSoundConfig>): IncidentSoundConfig {
  return {
    ...sanitizeCueConfig(base, patch),
    minDelta: Math.round(clamp(patch.minDelta, 1, 20, base.minDelta)),
    cooldownMs: Math.round(clamp(patch.cooldownMs, 0, 10000, base.cooldownMs))
  }
}

function sanitizeControlConfig(base: ControlAssistSoundConfig, patch: Partial<ControlAssistSoundConfig>): ControlAssistSoundConfig {
  return {
    ...sanitizeCueConfig(base, patch),
    inputThreshold: clamp(patch.inputThreshold, 0, 1, base.inputThreshold),
    triggerMode: sanitizeTriggerMode(patch.triggerMode, base.triggerMode),
    repeatMs: Math.round(clamp(patch.repeatMs, 75, 5000, base.repeatMs))
  }
}

function sanitizeCueConfig<T extends SoundCueSettings>(base: T, patch: Partial<T>): SoundCueSettings {
  return {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : base.enabled,
    toneHz: Math.round(clamp(patch.toneHz, 120, 6000, base.toneHz)),
    volume: clamp(patch.volume, 0, 1, base.volume),
    beepMs: Math.round(clamp(patch.beepMs, 20, 500, base.beepMs))
  }
}

function sanitizeOutputDeviceId(outputDeviceId: string | undefined): string {
  return typeof outputDeviceId === 'string' ? outputDeviceId.trim() : ''
}

function sanitizeCars(
  cars: Record<string, SoundshiftCarTuning>
): Record<string, SoundshiftCarTuning> {
  const entries = Object.entries(cars).map(([key, tuning]) => {
    const normalizedKey = carKeyOf(tuning.carKey || key || tuning.carName)
    return [normalizedKey, sanitizeTuning(tuning, normalizedKey)] as const
  })
  return Object.fromEntries(entries)
}

function sanitizeTuning(tuning: Partial<SoundshiftCarTuning>, key: string): SoundshiftCarTuning {
  const learned = sanitizeLearned(tuning.learnedUpshiftRpmByGear)
  const sanitized: SoundshiftCarTuning = { carKey: key }
  // mode is OPTIONAL: keep an explicit valid choice, otherwise leave it undefined so the
  // car follows the global defaultMode (auto-learn no longer pins a mode per car).
  const mode = sanitizeOptionalMode(tuning.mode)
  if (mode) sanitized.mode = mode
  if (tuning.carName?.trim()) sanitized.carName = tuning.carName.trim()
  if (tuning.targetRpm != null && Number.isFinite(tuning.targetRpm)) {
    sanitized.targetRpm = Math.round(clamp(tuning.targetRpm, 1000, 30000, 6500))
  }
  if (tuning.thresholdPct != null && Number.isFinite(tuning.thresholdPct)) {
    sanitized.thresholdPct = clamp(tuning.thresholdPct, 0.5, 1, DEFAULT_SOUNDSHIFT_CONFIG.defaultThresholdPct)
  }
  if (tuning.shiftOffsetRpm != null && Number.isFinite(tuning.shiftOffsetRpm)) {
    sanitized.shiftOffsetRpm = Math.round(clamp(tuning.shiftOffsetRpm, 0, 2000, DEFAULT_SOUNDSHIFT_CONFIG.defaultShiftOffsetRpm))
  }
  if (Object.keys(learned).length > 0) sanitized.learnedUpshiftRpmByGear = learned
  return sanitized
}

function sanitizeLearned(input: Record<number, number> | undefined): Record<number, number> {
  const learned: Record<number, number> = {}
  for (const [gearKey, rpmValue] of Object.entries(input ?? {})) {
    const gear = Math.round(Number(gearKey))
    const rpm = Math.round(Number(rpmValue))
    if (gear >= 1 && Number.isFinite(rpm) && rpm > 0) learned[gear] = rpm
  }
  return learned
}

function isMode(mode: SoundshiftMode | undefined): mode is SoundshiftMode {
  return mode === 'exact' || mode === 'rpm' || mode === 'shiftLight' || mode === 'redlineOffset'
}

function sanitizeMode(mode: SoundshiftMode | undefined, fallback: SoundshiftMode): SoundshiftMode {
  return isMode(mode) ? mode : fallback
}

// Per-car mode sanitiser: a valid explicit mode is kept, anything else collapses to
// undefined so the car follows the global default.
function sanitizeOptionalMode(mode: SoundshiftMode | undefined): SoundshiftMode | undefined {
  return isMode(mode) ? mode : undefined
}

function sanitizeTriggerMode(mode: ControlTriggerMode | undefined, fallback: ControlTriggerMode): ControlTriggerMode {
  return mode === 'start' || mode === 'repeat' ? mode : fallback
}

function projectForLead(
  snapshot: TelemetrySnapshot,
  previous: TelemetrySnapshot | null,
  leadMs: number
): TelemetrySnapshot {
  const lead = Math.max(0, leadMs) / 1000
  if (!previous || lead <= 0) return snapshot
  const dt = (snapshot.timestamp - previous.timestamp) / 1000
  if (!Number.isFinite(dt) || dt <= 0 || dt > 0.5) return snapshot

  const rpmRate = (snapshot.rpm - previous.rpm) / dt
  const projectedRpm = rpmRate > 0 ? snapshot.rpm + rpmRate * lead : snapshot.rpm

  let projectedPct = snapshot.shiftIndicatorPct
  if (snapshot.shiftIndicatorPct != null && previous.shiftIndicatorPct != null) {
    const pctRate = (snapshot.shiftIndicatorPct - previous.shiftIndicatorPct) / dt
    if (pctRate > 0) projectedPct = snapshot.shiftIndicatorPct + pctRate * lead
  }

  return { ...snapshot, rpm: projectedRpm, shiftIndicatorPct: projectedPct }
}

// The lead projection (ms) to apply for a car's effective mode. 'exact' fires AT the iRacing
// shift point, so it gets 0 (no anticipation); every other mode keeps the configured leadMs.
export function effectiveLeadMs(soundshift: SoundshiftConfig, carName: string | undefined, carPath?: string): number {
  return effectiveMode(soundshift, carName, carPath) === 'exact' ? 0 : soundshift.leadMs
}

export function isClearlyBelowThreshold(config: SoundshiftConfig, snapshot: SoundshiftSnapshotLike): boolean {
  if (snapshot.gear < 1) return true
  const tuning = config.cars[resolveCarKey(config.cars, snapshot.carName, snapshot.carPath)]
  const threshold = tuning?.thresholdPct ?? config.defaultThresholdPct
  const mode = tuning?.mode ?? config.defaultMode

  if (mode === 'exact') {
    // Lockstep with evaluateShift's 'exact' branch: re-arm once clearly back below the
    // iRacing shift point (rpm < shiftRpm*0.95), else below BOTH the fill % AND the rev
    // limiter. The trigger fires at pct>=1 OR rpm>=maxRpm, so for a car whose pct caps
    // below 1.0 (sl-band, slShift>redline) we must re-arm off the limiter too — otherwise
    // pct<0.9 would be permanently true and the cue would beep-spam at the limiter.
    if (hasUsableShiftRpm(snapshot)) {
      return snapshot.rpm < (snapshot.shiftRpm as number) * 0.95
    }
    const pct = snapshot.shiftIndicatorPct
    const redline = snapshot.maxRpm
    const hasRedline = Number.isFinite(redline) && (redline as number) > 0
    if (pct != null || hasRedline) {
      const pctBelow = pct == null || pct < 0.9
      const limiterBelow = !hasRedline || snapshot.rpm < (redline as number) * 0.95
      return pctBelow && limiterBelow
    }
    // No shiftRpm and no fill %/redline → fall through to the shared rpm/maxRpm target below.
  }

  if (mode === 'shiftLight') {
    // Match evaluateShift: when the optimal upshift RPM is available AND plausible,
    // gate on it; otherwise fall back to the rev-light fill % (keeps the trigger and
    // re-arm in lockstep so a bogus shiftRpm can't desync them).
    if (hasUsableShiftRpm(snapshot)) {
      return snapshot.rpm < (snapshot.shiftRpm as number) * 0.93
    }
    if (snapshot.shiftIndicatorPct != null) {
      return snapshot.shiftIndicatorPct < Math.max(0, threshold - 0.08)
    }
  }

  // redlineOffset (and the rpm / shiftLight fallthrough) re-arm off the SAME target the
  // trigger uses (shared resolveShiftTarget) so the cue can't beep at one RPM and re-arm
  // at a different one.
  const target = resolveShiftTarget(config, tuning, snapshot)
  if (target != null) return snapshot.rpm < target * 0.93
  return false
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}
