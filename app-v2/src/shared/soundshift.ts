// 'exact' (default): beep EXACTLY at the iRacing shift point with NO lead projection —
// rpm >= DriverCarSLShiftRPM when usable, else shiftIndicatorPct >= 1.0 (the provider
// anchors that to SLShiftRPM for every car). The other modes stay for power users.
export type SoundshiftMode = 'exact' | 'shiftLight' | 'rpm' | 'redlineOffset'
export type SoundAlertId = 'soundshift' | 'incident' | 'abs' | 'tcs'
export type ControlTriggerMode = 'start' | 'repeat'

export interface SoundshiftCarTuning {
  carKey: string
  carName?: string
  // Optional: when absent the car follows SoundshiftConfig.defaultMode. Auto-learn must
  // NOT stamp this (a stamped value used to pin cars to a stale global default forever).
  mode?: SoundshiftMode
  targetRpm?: number
  thresholdPct?: number
  // Per-car override for the redlineOffset mode: how many RPM BEFORE the rev limiter
  // the cue should fire. Falls back to SoundshiftConfig.defaultShiftOffsetRpm.
  shiftOffsetRpm?: number
  learnedUpshiftRpmByGear?: Record<number, number>
}

export interface SoundshiftConfig {
  version: 3
  enabled: boolean
  toneHz: number
  volume: number
  beepMs: number
  leadMs: number
  autoLearn: boolean
  defaultMode: SoundshiftMode
  defaultThresholdPct: number
  // Global default for the redlineOffset mode: RPM below the rev limiter at which the
  // cue fires (per-car shiftOffsetRpm overrides it). 100 ≈ a short heads-up before redline.
  defaultShiftOffsetRpm: number
  cars: Record<string, SoundshiftCarTuning>
  updatedAt: number
}

export interface SoundCueSettings {
  enabled: boolean
  toneHz: number
  volume: number
  beepMs: number
}

export interface IncidentSoundConfig extends SoundCueSettings {
  minDelta: number
  cooldownMs: number
}

export interface ControlAssistSoundConfig extends SoundCueSettings {
  inputThreshold: number
  triggerMode: ControlTriggerMode
  repeatMs: number
}

export interface SoundsConfig {
  version: 2
  outputDeviceId: string
  soundshift: SoundshiftConfig
  incident: IncidentSoundConfig
  abs: ControlAssistSoundConfig
  tcs: ControlAssistSoundConfig
  updatedAt: number
}

export interface SoundCue {
  id: SoundAlertId
  toneHz: number
  volume: number
  beepMs: number
  reason: string
  at: number
}

export const DEFAULT_SOUNDSHIFT_CONFIG: SoundshiftConfig = {
  version: 3,
  enabled: false,
  toneHz: 1320,
  volume: 0.5,
  beepMs: 70,
  leadMs: 120,
  autoLearn: true,
  defaultMode: 'exact',
  defaultThresholdPct: 0.9,
  defaultShiftOffsetRpm: 100,
  cars: {},
  updatedAt: 0
}

export const DEFAULT_SOUNDS_CONFIG: SoundsConfig = {
  version: 2,
  outputDeviceId: '',
  soundshift: DEFAULT_SOUNDSHIFT_CONFIG,
  incident: {
    enabled: false,
    toneHz: 880,
    volume: 0.55,
    beepMs: 120,
    minDelta: 1,
    cooldownMs: 1500
  },
  abs: {
    enabled: false,
    toneHz: 520,
    volume: 0.45,
    beepMs: 45,
    inputThreshold: 0.35,
    triggerMode: 'repeat',
    repeatMs: 250
  },
  tcs: {
    enabled: false,
    toneHz: 660,
    volume: 0.45,
    beepMs: 45,
    inputThreshold: 0.25,
    triggerMode: 'repeat',
    repeatMs: 250
  },
  updatedAt: 0
}

export const SOUNDSHIFT_CHANNELS = {
  getConfig: 'soundshift:getConfig',
  setConfig: 'soundshift:setConfig',
  updateLearned: 'soundshift:updateLearned',
  clearLearned: 'soundshift:clearLearned',
  configEvent: 'soundshift:config',
  cueEvent: 'soundshift:cue'
} as const

export interface ShiftDecision {
  shouldBeep: boolean
  reason: string
}

export interface IncidentDecision extends ShiftDecision {
  delta: number
}

export interface ControlAssistDecision extends ShiftDecision {
  engaging: boolean
}

export interface SoundshiftSnapshotLike {
  carName?: string
  // Stable per-car identity (iRacing CarPath slug). Preferred over the localized carName
  // when keying per-car tuning so the key never drifts with UI language/renames.
  carPath?: string
  rpm: number
  maxRpm?: number
  shiftIndicatorPct?: number
  shiftRpm?: number
  gear: number
  throttle: number
}

export interface IncidentSnapshotLike {
  incidentCount?: number
}

export interface AbsSnapshotLike {
  absActive?: boolean
  brake: number
}

export interface TcsSnapshotLike {
  tcActive?: boolean
  throttle: number
}

// Normalises a raw identity string (carPath or carName) into a config-key token, or
// undefined when it carries no usable identity. Lower-cased, accent-stripped, with
// punctuation collapsed to single spaces so equivalent labels map to one key.
function normalizeCarKey(value?: string): string | undefined {
  const normalized = (value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return normalized.length > 0 ? normalized : undefined
}

// The per-car config key. PREFERS the stable carPath (e.g. "mx5 mx52016") over the
// localized/display carName, which drifts with UI language and iRacing renames. Falls
// back to the display name when no path is available, then to the 'unknown' sentinel so
// callers never crash on a missing identity (it just lands in a clearly-labelled bucket).
export function carKeyOf(carName?: string, carPath?: string): string {
  return normalizeCarKey(carPath) ?? normalizeCarKey(carName) ?? 'unknown'
}

// Resolves the config key to USE for a car, preferring the stable carPath key but
// preserving backward-compat: if no carPath-keyed tuning exists yet but a legacy
// carName-keyed one does, that legacy entry still wins so configs saved before carPath
// keying keep applying. With neither present, returns the preferred (carPath) key — or
// the carName key, or the 'unknown' sentinel — so a fresh learn stamps the stable key.
export function resolveCarKey(
  cars: Record<string, SoundshiftCarTuning>,
  carName: string | undefined,
  carPath: string | undefined
): string {
  const pathKey = normalizeCarKey(carPath)
  const nameKey = normalizeCarKey(carName)
  if (pathKey && cars[pathKey]) return pathKey
  if (nameKey && cars[nameKey]) return nameKey
  return pathKey ?? nameKey ?? 'unknown'
}

// The effective mode for a car: an explicit per-car tuning.mode wins, else the global
// default. Centralised so the main module (lead gating) and decisions agree on the mode.
export function effectiveMode(
  config: Pick<SoundshiftConfig, 'defaultMode' | 'cars'>,
  carName: string | undefined,
  carPath?: string
): SoundshiftMode {
  return config.cars[resolveCarKey(config.cars, carName, carPath)]?.mode ?? config.defaultMode
}

export function hasUsableShiftRpm(snap: { shiftRpm?: number; maxRpm?: number }): boolean {
  // The per-car optimal upshift RPM (DriverCarSLShiftRPM) is only trusted when it's a
  // finite positive value at or (just) below redline. A small 2% margin allows shift
  // points sitting right at the limiter. An implausible value (e.g. well above redline
  // → unreachable, the limiter hits first) is ignored so a bogus reading can't silence
  // the cue entirely — the caller falls back to the rev-light fill %.
  if (snap.shiftRpm == null || !Number.isFinite(snap.shiftRpm) || snap.shiftRpm <= 0) return false
  if (snap.maxRpm != null && Number.isFinite(snap.maxRpm) && snap.maxRpm > 0) {
    return snap.shiftRpm <= snap.maxRpm * 1.02
  }
  return true
}

// The exact-mode trigger RPM, for LOGGING only. In 'exact' mode the cue fires at the per-car
// optimal upshift (DriverCarSLShiftRPM) when usable; otherwise it keys off shiftIndicatorPct
// reaching 1.0 (anchored to SLShiftRPM by the provider) and there is no single RPM target —
// callers log the live rpm at fire time in that case.
export function resolveExactTarget(snap: Pick<SoundshiftSnapshotLike, 'shiftRpm' | 'maxRpm'>): number | undefined {
  return hasUsableShiftRpm(snap) ? (snap.shiftRpm as number) : undefined
}

function isFinitePositive(value: number | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0
}

// The rev limiter / PlayerCarRedLine. maxRpm is the truth; a zero/garbage maxRpm falls
// back to the optimal-shift RPM so a bad reading can't silence the cue when shiftRpm exists.
function pickRedlineAnchor(snap: { maxRpm?: number; shiftRpm?: number }): number | undefined {
  if (isFinitePositive(snap.maxRpm)) return snap.maxRpm
  if (isFinitePositive(snap.shiftRpm)) return snap.shiftRpm
  return undefined
}

// Effective "RPM before redline" offset for the redlineOffset mode: the per-car override
// wins, else the global default, else the hard-coded default (defensive for un-sanitized
// configs reaching evaluateShift directly, e.g. in tests).
export function effectiveShiftOffsetRpm(
  config: Pick<SoundshiftConfig, 'defaultShiftOffsetRpm'>,
  tuning: Pick<SoundshiftCarTuning, 'shiftOffsetRpm'> | undefined
): number {
  const perCar = tuning?.shiftOffsetRpm
  if (perCar != null && Number.isFinite(perCar) && perCar >= 0) return perCar
  const fallback = config.defaultShiftOffsetRpm
  if (fallback != null && Number.isFinite(fallback) && fallback >= 0) return fallback
  return DEFAULT_SOUNDSHIFT_CONFIG.defaultShiftOffsetRpm
}

// Single source of truth for the RPM the cue triggers on, shared by evaluateShift (trigger)
// and isClearlyBelowThreshold (re-arm/hysteresis) so they can never desync.
//   • redlineOffset: redlineAnchor (maxRpm, else shiftRpm) minus the effective offset,
//     clamped > 0. Missing/invalid anchor → undefined (caller reports 'missing-rpm-target').
//   • rpm / shiftLight fallthrough: user target → learned per-gear → optimal shift RPM →
//     maxRpm × threshold.
export function resolveShiftTarget(
  config: SoundshiftConfig,
  tuning: SoundshiftCarTuning | undefined,
  snap: Pick<SoundshiftSnapshotLike, 'gear' | 'shiftRpm' | 'maxRpm'>
): number | undefined {
  const mode = tuning?.mode ?? config.defaultMode

  if (mode === 'redlineOffset') {
    const redlineAnchor = pickRedlineAnchor(snap)
    if (redlineAnchor == null) return undefined
    return Math.max(1, redlineAnchor - effectiveShiftOffsetRpm(config, tuning))
  }

  const threshold = tuning?.thresholdPct ?? config.defaultThresholdPct
  const learnedTarget = tuning?.learnedUpshiftRpmByGear?.[snap.gear]
  const fromMax = isFinitePositive(snap.maxRpm) ? snap.maxRpm * threshold : undefined
  const target = tuning?.targetRpm ?? learnedTarget ?? snap.shiftRpm ?? fromMax
  if (target == null || !Number.isFinite(target) || target <= 0) return undefined
  return target
}

export function evaluateShift(config: SoundshiftConfig, snap: SoundshiftSnapshotLike): ShiftDecision {
  if (!config.enabled) return { shouldBeep: false, reason: 'disabled' }
  if (!Number.isFinite(snap.rpm) || snap.rpm <= 0) return { shouldBeep: false, reason: 'invalid-rpm' }
  if (!Number.isFinite(snap.gear) || snap.gear < 1) return { shouldBeep: false, reason: 'not-forward-gear' }
  if (!Number.isFinite(snap.throttle) || snap.throttle < 0.5) return { shouldBeep: false, reason: 'low-throttle' }

  const carKey = resolveCarKey(config.cars, snap.carName, snap.carPath)
  const tuning = config.cars[carKey]
  const mode = tuning?.mode ?? config.defaultMode
  const threshold = tuning?.thresholdPct ?? config.defaultThresholdPct

  if (mode === 'exact') {
    // Beep EXACTLY at the iRacing shift point. The caller does NOT apply leadMs in this
    // mode (lead is forced to 0), so `snap.rpm` is the live RPM — no anticipation.
    // Primary: the per-car optimal upshift (DriverCarSLShiftRPM) when it's usable.
    if (hasUsableShiftRpm(snap)) {
      const shouldBeep = snap.rpm >= (snap.shiftRpm as number)
      return { shouldBeep, reason: shouldBeep ? 'exact-shift-rpm' : 'below-exact-shift-rpm' }
    }
    // Fallback (cars where SLShiftRPM sits above redline → unusable, e.g. a Porsche whose
    // slShift 8500 > maxRpm 8275). For the iracing-live fill source the provider pins
    // shiftIndicatorPct to 1.0 at SLShiftRPM, BUT for the sl-band source pct CAPS BELOW
    // 1.0 when rpm can't reach slShift — so pct>=1 alone would never fire for this car
    // class. Also fire at the reachable rev limiter (maxRpm), which IS the practical
    // "shift NOW" point when the nominal shift RPM is above the limiter.
    const pct = snap.shiftIndicatorPct
    const redline = snap.maxRpm
    const hasRedline = Number.isFinite(redline) && (redline as number) > 0
    if (pct != null || hasRedline) {
      const shouldBeep = (pct != null && pct >= 1) || (hasRedline && snap.rpm >= (redline as number))
      return { shouldBeep, reason: shouldBeep ? 'exact-shift-pct' : 'below-exact-shift-pct' }
    }
    // No shiftRpm and no fill % at all → fall through to the generic rpm/maxRpm target.
  }

  if (mode === 'redlineOffset') {
    // Anchor the cue to the rev limiter (DriverCarSLLastRPM / PlayerCarRedLine = maxRpm)
    // and fire a fixed number of RPM BEFORE it. Deterministic even on cars where iRacing
    // reports the optimal-shift RPM AT the redline (e.g. Mazda MX-5) — the shiftLight mode
    // would beep on that value, i.e. already in the red.
    const target = resolveShiftTarget(config, tuning, snap)
    if (target == null) return { shouldBeep: false, reason: 'missing-rpm-target' }
    const shouldBeep = snap.rpm >= target
    return { shouldBeep, reason: shouldBeep ? 'redline-offset-threshold' : 'below-redline-offset-threshold' }
  }

  if (mode === 'shiftLight') {
    // Primary: beep exactly at the per-car optimal upshift (DriverCarSLShiftRPM),
    // decoupled from the rev-light fill %. The caller's leadMs projection already
    // advances `rpm`, so this fires ~leadMs before reaching the optimal shift RPM.
    if (hasUsableShiftRpm(snap)) {
      const shouldBeep = snap.rpm >= (snap.shiftRpm as number)
      return { shouldBeep, reason: shouldBeep ? 'shift-rpm-threshold' : 'below-shift-rpm-threshold' }
    }
    // Fallback: when the optimal shift RPM is unavailable or implausible, use the rev-light fill %.
    if (snap.shiftIndicatorPct != null) {
      const shouldBeep = snap.shiftIndicatorPct >= threshold
      return { shouldBeep, reason: shouldBeep ? 'shift-light-threshold' : 'below-shift-light-threshold' }
    }
  }

  const target = resolveShiftTarget(config, tuning, snap)
  if (target == null) {
    return { shouldBeep: false, reason: 'missing-rpm-target' }
  }

  const shouldBeep = snap.rpm >= target
  return { shouldBeep, reason: shouldBeep ? 'rpm-threshold' : 'below-rpm-threshold' }
}

export function evaluateIncident(config: IncidentSoundConfig, snap: IncidentSnapshotLike, previousIncidentCount?: number): IncidentDecision {
  if (!config.enabled) return { shouldBeep: false, reason: 'disabled', delta: 0 }
  if (snap.incidentCount == null || !Number.isFinite(snap.incidentCount)) {
    return { shouldBeep: false, reason: 'missing-incident-count', delta: 0 }
  }
  if (previousIncidentCount == null || !Number.isFinite(previousIncidentCount)) {
    return { shouldBeep: false, reason: 'priming-incident-count', delta: 0 }
  }

  const delta = Math.trunc(snap.incidentCount) - Math.trunc(previousIncidentCount)
  const shouldBeep = delta >= config.minDelta
  return { shouldBeep, reason: shouldBeep ? 'incident-count-increased' : 'incident-count-unchanged', delta }
}

export function evaluateAbs(config: ControlAssistSoundConfig, snap: AbsSnapshotLike): ControlAssistDecision {
  if (!config.enabled) return { shouldBeep: false, engaging: false, reason: 'disabled' }
  if (!Number.isFinite(snap.brake) || snap.brake < config.inputThreshold) {
    return { shouldBeep: false, engaging: false, reason: 'below-brake-threshold' }
  }
  if (typeof snap.absActive !== 'boolean') {
    return { shouldBeep: false, engaging: false, reason: 'missing-abs-intervention-signal' }
  }

  const engaging = snap.absActive
  return { shouldBeep: engaging, engaging, reason: engaging ? 'abs-intervention-signal' : 'abs-not-intervening' }
}

export function evaluateTcs(config: ControlAssistSoundConfig, snap: TcsSnapshotLike): ControlAssistDecision {
  if (!config.enabled) return { shouldBeep: false, engaging: false, reason: 'disabled' }
  if (!Number.isFinite(snap.throttle) || snap.throttle < config.inputThreshold) {
    return { shouldBeep: false, engaging: false, reason: 'below-throttle-threshold' }
  }
  if (typeof snap.tcActive !== 'boolean') {
    return { shouldBeep: false, engaging: false, reason: 'missing-tc-intervention-signal' }
  }

  const engaging = snap.tcActive
  return { shouldBeep: engaging, engaging, reason: engaging ? 'tc-intervention-signal' : 'tc-not-intervening' }
}
