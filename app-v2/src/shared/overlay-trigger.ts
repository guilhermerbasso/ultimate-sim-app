import {
  trackSurfaceMaterialLabel,
  type TelemetrySnapshot,
  type TyreInfo
} from './telemetry'

export type OverlayRole = 'alert' | 'ordinary'

export type OverlaySemanticTriggerId =
  | 'paceFlags'
  | 'pitFuelToAdd'
  | 'precipitation'
  | 'repairTime'
  | 'optionalRepairTime'
  | 'incidentCounts'
  | 'repairRequirement'
  | 'pitServiceStatus'
  | 'pitsOpen'
  | 'pitServicesSelected'
  | 'trackWetness'
  | 'fogLevel'
  | 'sideProximity'
  | 'raceControlFlags'
  | 'drs'
  | 'engineWarnings'
  | 'pushToPassState'
  | 'absActive'
  | 'absCut'
  | 'tcActive'
  | 'declaredWet'
  | 'paceMode'
  | 'paceFormation'
  | 'onPitRoad'
  | 'pitLimiter'
  | 'inPitStall'
  | 'pitStopActive'
  | 'pitTyreTargets'
  | 'replayState'
  | 'replayTimeline'
  | 'alert2EngineWarning'
  | 'alert2WaterTempCritical'
  | 'alert2OilTempCritical'
  | 'alert2OilPressureLow'
  | 'alert2BadSurface'
  | 'alert2BlueFlag'
  | 'alert2TyreTempCritical'
  | 'alert2BrakePressureLow'

export type OverlayTriggerKind =
  | 'always'
  | 'never'
  | 'semantic'
  | 'carLeft'
  | 'carRight'
  | 'carLeftOrRight'
  | 'proximity'
  | 'shiftPoint'
  | 'pitLimiter'
  | 'flag'
  | 'lowFuel'

export interface OverlayTrigger {
  kind: OverlayTriggerKind
  semantic?: OverlaySemanticTriggerId
  thresholdSec?: number
  shiftPct?: number
  lapsToEmpty?: number
}

export interface OverlayVisibilityMetadata {
  role: OverlayRole
  trigger: OverlayTrigger
  preview: 'simulated-active-sequence'
}

export type TemporalTriggerMode = 'level' | 'rising' | 'falling' | 'pulse' | 'after-false'

export interface OverlayTriggerResult {
  visible: boolean
  active: boolean
  held: boolean
  phase: string
  nextChangeAt?: number
}

interface TriggerSignal {
  known: boolean
  value: boolean
}

interface TemporalChannel {
  id: string
  mode: TemporalTriggerMode
  signal: TriggerSignal
  ttlMs?: number
  phase: string
  priority: number
}

interface SemanticPolicy {
  channels(snapshot: TelemetrySnapshot | null | undefined): TemporalChannel[]
}

interface TemporalEntry {
  initialized: boolean
  previous: boolean
  expiresAt?: number
}

interface TemporalChannelResult {
  visible: boolean
  active: boolean
  held: boolean
  nextChangeAt?: number
}

const SEMANTIC_IDS: readonly OverlaySemanticTriggerId[] = [
  'paceFlags',
  'pitFuelToAdd',
  'precipitation',
  'repairTime',
  'optionalRepairTime',
  'incidentCounts',
  'repairRequirement',
  'pitServiceStatus',
  'pitsOpen',
  'pitServicesSelected',
  'trackWetness',
  'fogLevel',
  'sideProximity',
  'raceControlFlags',
  'drs',
  'engineWarnings',
  'pushToPassState',
  'absActive',
  'absCut',
  'tcActive',
  'declaredWet',
  'paceMode',
  'paceFormation',
  'onPitRoad',
  'pitLimiter',
  'inPitStall',
  'pitStopActive',
  'pitTyreTargets',
  'replayState',
  'replayTimeline',
  'alert2EngineWarning',
  'alert2WaterTempCritical',
  'alert2OilTempCritical',
  'alert2OilPressureLow',
  'alert2BadSurface',
  'alert2BlueFlag',
  'alert2TyreTempCritical',
  'alert2BrakePressureLow'
]

const SEMANTIC_ID_SET = new Set<string>(SEMANTIC_IDS)

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function knownBoolean(value: unknown): TriggerSignal {
  return typeof value === 'boolean'
    ? { known: true, value }
    : { known: false, value: false }
}

function knownPositive(value: unknown): TriggerSignal {
  const number = finite(value)
  return number == null
    ? { known: false, value: false }
    : { known: true, value: number > 0 }
}

function activeRaceControlFlags(snapshot: TelemetrySnapshot | null | undefined): TriggerSignal {
  const flags = snapshot?.flags
  if (!flags) return { known: false, value: false }
  const { green: _green, ...alertFlags } = flags
  return { known: true, value: Object.values(alertFlags).some(Boolean) }
}

function activeEngineWarnings(snapshot: TelemetrySnapshot | null | undefined): TriggerSignal {
  const warnings = snapshot?.engineWarnings
  if (!warnings) return { known: false, value: false }
  return { known: true, value: Object.values(warnings).some(Boolean) }
}

function inPits(snapshot: TelemetrySnapshot | null | undefined): TriggerSignal {
  return knownBoolean(snapshot?.onPitRoad)
}

function paceCarOut(snapshot: TelemetrySnapshot | null | undefined): TriggerSignal {
  if (!Array.isArray(snapshot?.drivers)) return { known: false, value: false }
  const paceCar = snapshot.drivers.find((driver) => driver.isPaceCar === true)
  if (!paceCar || typeof paceCar.inPits !== 'boolean') return { known: false, value: false }
  return { known: true, value: paceCar.inPits === false }
}

function precipitation(snapshot: TelemetrySnapshot | null | undefined): TriggerSignal {
  const raining = snapshot?.isRaining
  const amount = finite(snapshot?.precipitationPct)
  if (typeof raining !== 'boolean' && amount == null) return { known: false, value: false }
  return { known: true, value: raining === true || (amount ?? 0) > 0 }
}

function repairTime(snapshot: TelemetrySnapshot | null | undefined, field: 'repairTimeSec' | 'optionalRepairTimeSec'): TriggerSignal {
  const pit = inPits(snapshot)
  const time = finite(snapshot?.[field])
  if (!pit.known && time == null) return { known: false, value: false }
  return { known: true, value: pit.value || (time ?? 0) > 0 }
}

function pitServicePending(snapshot: TelemetrySnapshot | null | undefined): TriggerSignal {
  const pit = snapshot?.pit
  if (!pit) return { known: false, value: false }
  return {
    known: true,
    value: pit.repairNeeded || pit.optRepairNeeded || pit.svStatus === 1
  }
}

function sideProximity(snapshot: TelemetrySnapshot | null | undefined): TriggerSignal {
  const side = snapshot?.carLeftRight
  if (side !== 'clear' && side !== 'left' && side !== 'right' && side !== 'both') {
    return { known: false, value: false }
  }
  return { known: true, value: side !== 'clear' }
}

function drsKnown(snapshot: TelemetrySnapshot | null | undefined): TriggerSignal {
  const state = snapshot?.drsState
  if (state !== 0 && state !== 1 && state !== 2 && state !== 3) {
    return { known: false, value: false }
  }
  return { known: true, value: state > 0 }
}

function drsActive(snapshot: TelemetrySnapshot | null | undefined): TriggerSignal {
  const state = snapshot?.drsState
  if (state !== 0 && state !== 1 && state !== 2 && state !== 3) {
    return { known: false, value: false }
  }
  return { known: true, value: state === 3 }
}

function paceModeActive(snapshot: TelemetrySnapshot | null | undefined): TriggerSignal {
  const mode = snapshot?.paceMode
  if (!mode) return { known: false, value: false }
  return { known: true, value: mode !== 'notPacing' }
}

function replayActive(snapshot: TelemetrySnapshot | null | undefined): TriggerSignal {
  if (snapshot?.replayContext) {
    return { known: true, value: snapshot.replayContext.active === true }
  }
  return knownBoolean(snapshot?.replayPlaying)
}

function maxTyreTemp(tyre: TyreInfo | undefined): number | undefined {
  const values = [
    tyre?.tempC,
    tyre?.tempLeftC,
    tyre?.tempMiddleC,
    tyre?.tempRightC,
    tyre?.surfaceTempLeftC,
    tyre?.surfaceTempMiddleC,
    tyre?.surfaceTempRightC
  ].map(finite).filter((value): value is number => value != null)
  return values.length > 0 ? Math.max(...values) : undefined
}

function hottestTyre(snapshot: TelemetrySnapshot | null | undefined): TriggerSignal {
  const tyres = snapshot?.tyres
  if (!tyres) return { known: false, value: false }
  const values = [tyres.lf, tyres.rf, tyres.lr, tyres.rr]
    .map(maxTyreTemp)
    .filter((value): value is number => value != null)
  if (values.length === 0) return { known: false, value: false }
  return { known: true, value: Math.max(...values) >= 115 }
}

function brakePressureLow(snapshot: TelemetrySnapshot | null | undefined): TriggerSignal {
  const brake = finite(snapshot?.brake)
  const pressure = snapshot?.brakeLinePressBar
  const values = pressure
    ? [pressure.lf, pressure.rf, pressure.lr, pressure.rr]
        .map(finite)
        .filter((value): value is number => value != null)
    : []
  if (brake == null || values.length === 0) return { known: false, value: false }
  return { known: true, value: brake >= 0.35 && Math.max(...values) < 25 }
}

function level(signal: TriggerSignal, phase = 'active', priority = 10): TemporalChannel {
  return { id: 'level', mode: 'level', signal, phase, priority }
}

function edge(
  id: string,
  mode: 'rising' | 'falling',
  signal: TriggerSignal,
  ttlMs: number,
  phase: string,
  priority = 100
): TemporalChannel {
  return { id, mode, signal, ttlMs, phase, priority }
}

const POLICIES: Record<OverlaySemanticTriggerId, SemanticPolicy> = {
  paceFlags: {
    channels: (snapshot) => {
      const signal = paceCarOut(snapshot)
      return [
        level(signal, 'pace-active'),
        edge('clear', 'falling', signal, 5000, 'pace-clear')
      ]
    }
  },
  pitFuelToAdd: { channels: (snapshot) => [level(inPits(snapshot))] },
  precipitation: { channels: (snapshot) => [level(precipitation(snapshot))] },
  repairTime: { channels: (snapshot) => [level(repairTime(snapshot, 'repairTimeSec'))] },
  optionalRepairTime: { channels: (snapshot) => [level(repairTime(snapshot, 'optionalRepairTimeSec'))] },
  incidentCounts: { channels: (snapshot) => [level(knownPositive(snapshot?.incidentCountMy ?? snapshot?.incidentCountTeam ?? snapshot?.incidentCount))] },
  repairRequirement: {
    channels: (snapshot) => {
      const pit = snapshot?.pit
      return [level(pit
        ? { known: true, value: pit.repairNeeded || pit.optRepairNeeded }
        : { known: false, value: false })]
    }
  },
  pitServiceStatus: {
    channels: (snapshot) => [
      level(inPits(snapshot), 'pit-service'),
      edge('done', 'falling', pitServicePending(snapshot), 4000, 'service-done')
    ]
  },
  pitsOpen: {
    channels: (snapshot) => [edge('open', 'rising', knownBoolean(snapshot?.pit?.pitsOpen), 5000, 'pits-open')]
  },
  pitServicesSelected: { channels: (snapshot) => [level(inPits(snapshot))] },
  trackWetness: { channels: (snapshot) => [level(knownPositive(snapshot?.trackWetnessPct))] },
  fogLevel: { channels: (snapshot) => [level(knownPositive(snapshot?.fogPct))] },
  sideProximity: { channels: (snapshot) => [level(sideProximity(snapshot))] },
  raceControlFlags: { channels: (snapshot) => [level(activeRaceControlFlags(snapshot))] },
  drs: {
    channels: (snapshot) => [
      level(drsKnown(snapshot), 'drs-state'),
      edge('deactivated', 'falling', drsActive(snapshot), 5000, 'drs-deactivated')
    ]
  },
  engineWarnings: { channels: (snapshot) => [level(activeEngineWarnings(snapshot))] },
  pushToPassState: { channels: (snapshot) => [level(knownBoolean(snapshot?.pushToPass))] },
  absActive: { channels: (snapshot) => [level(knownBoolean(snapshot?.absActive))] },
  absCut: { channels: (snapshot) => [level(knownPositive(snapshot?.absCutPct))] },
  tcActive: { channels: (snapshot) => [level(knownBoolean(snapshot?.tcActive))] },
  declaredWet: { channels: (snapshot) => [level(knownBoolean(snapshot?.weatherDeclaredWet))] },
  paceMode: { channels: (snapshot) => [level(paceModeActive(snapshot))] },
  paceFormation: { channels: (snapshot) => [level(paceModeActive(snapshot))] },
  onPitRoad: { channels: (snapshot) => [level(knownBoolean(snapshot?.onPitRoad))] },
  pitLimiter: { channels: (snapshot) => [level(knownBoolean(snapshot?.pitLimiter))] },
  inPitStall: { channels: (snapshot) => [level(knownBoolean(snapshot?.pit?.inPitStall))] },
  pitStopActive: { channels: (snapshot) => [level(knownBoolean(snapshot?.pitStopActive))] },
  pitTyreTargets: { channels: (snapshot) => [level(inPits(snapshot))] },
  replayState: { channels: (snapshot) => [level(replayActive(snapshot))] },
  replayTimeline: { channels: (snapshot) => [level(replayActive(snapshot))] },
  alert2EngineWarning: { channels: (snapshot) => [level(activeEngineWarnings(snapshot))] },
  alert2WaterTempCritical: {
    channels: (snapshot) => {
      const temperature = finite(snapshot?.waterTempC)
      const warning = snapshot?.engineWarnings?.waterTemp
      return [level(
        typeof warning === 'boolean' || temperature != null
          ? { known: true, value: warning === true || (temperature ?? -Infinity) >= 105 }
          : { known: false, value: false }
      )]
    }
  },
  alert2OilTempCritical: {
    channels: (snapshot) => {
      const temperature = finite(snapshot?.oilTempC)
      const warning = snapshot?.engineWarnings?.oilTemp
      return [level(
        typeof warning === 'boolean' || temperature != null
          ? { known: true, value: warning === true || (temperature ?? -Infinity) >= 125 }
          : { known: false, value: false }
      )]
    }
  },
  alert2OilPressureLow: {
    channels: (snapshot) => {
      const pressure = finite(snapshot?.oilPressureKpa)
      const warning = snapshot?.engineWarnings?.oilPressure
      return [level(
        typeof warning === 'boolean' || pressure != null
          ? { known: true, value: warning === true || (pressure ?? Infinity) <= 140 }
          : { known: false, value: false }
      )]
    }
  },
  alert2BadSurface: {
    channels: (snapshot) => {
      const raw = finite(snapshot?.trackSurfaceMaterial)
      if (raw == null) return [level({ known: false, value: false })]
      const material = trackSurfaceMaterialLabel(raw)
      return [level({
        known: material != null,
        value: material != null && !['asphalt', 'concrete', 'paint', 'kerb'].includes(material)
      })]
    }
  },
  alert2BlueFlag: {
    channels: (snapshot) => [level(snapshot?.flags
      ? { known: true, value: snapshot.flags.blue === true }
      : { known: false, value: false })]
  },
  alert2TyreTempCritical: { channels: (snapshot) => [level(hottestTyre(snapshot))] },
  alert2BrakePressureLow: { channels: (snapshot) => [level(brakePressureLow(snapshot))] }
}

const TRIGGER_KINDS: readonly OverlayTriggerKind[] = [
  'always',
  'never',
  'semantic',
  'carLeft',
  'carRight',
  'carLeftOrRight',
  'proximity',
  'shiftPoint',
  'pitLimiter',
  'flag',
  'lowFuel'
]

export function semanticOverlayTrigger(semantic: OverlaySemanticTriggerId): OverlayTrigger {
  return { kind: 'semantic', semantic }
}

export function semanticAlertVisibility(semantic: OverlaySemanticTriggerId): OverlayVisibilityMetadata {
  return {
    role: 'alert',
    trigger: semanticOverlayTrigger(semantic),
    preview: 'simulated-active-sequence'
  }
}

export function evaluateOverlayTrigger(
  trigger: OverlayTrigger | null | undefined,
  snapshot: TelemetrySnapshot | null | undefined
): boolean {
  if (!trigger || trigger.kind === 'always') return true
  if (trigger.kind === 'never') return false
  if (!snapshot) return false
  if (trigger.kind === 'semantic') {
    if (!trigger.semantic) return false
    const policy = POLICIES[trigger.semantic]
    return policy.channels(snapshot).some((channel) =>
      channel.signal.known &&
      channel.signal.value &&
      (channel.mode === 'level' || channel.mode === 'after-false' || channel.mode === 'pulse')
    )
  }
  switch (trigger.kind) {
    case 'carLeft':
      return snapshot.carLeftRight === 'left' || snapshot.carLeftRight === 'both'
    case 'carRight':
      return snapshot.carLeftRight === 'right' || snapshot.carLeftRight === 'both'
    case 'carLeftOrRight':
      return snapshot.carLeftRight === 'left' || snapshot.carLeftRight === 'right' || snapshot.carLeftRight === 'both'
    case 'proximity': {
      const threshold = trigger.thresholdSec ?? 0.5
      const gaps: number[] = []
      const ahead = snapshot.relatives?.ahead?.gapSec
      const behind = snapshot.relatives?.behind?.gapSec
      if (typeof ahead === 'number' && Number.isFinite(ahead)) gaps.push(Math.abs(ahead))
      if (typeof behind === 'number' && Number.isFinite(behind)) gaps.push(Math.abs(behind))
      for (const car of snapshot.radarCars ?? []) {
        if (typeof car.gapSec === 'number' && Number.isFinite(car.gapSec)) gaps.push(Math.abs(car.gapSec))
      }
      return gaps.some((gap) => gap <= threshold)
    }
    case 'shiftPoint':
      return Number.isFinite(snapshot.shiftIndicatorPct) &&
        (snapshot.shiftIndicatorPct as number) >= (trigger.shiftPct ?? 0.97)
    case 'pitLimiter':
      return snapshot.pitLimiter === true
    case 'flag':
      return activeRaceControlFlags(snapshot).value
    case 'lowFuel': {
      const fuel = finite(snapshot.fuelLiters)
      const perLap = finite(snapshot.fuelPerLap)
      return fuel != null && perLap != null && perLap > 0 && fuel / perLap <= (trigger.lapsToEmpty ?? 2)
    }
    default:
      return false
  }
}

export function sanitizeOverlayTrigger(value: unknown): OverlayTrigger | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.kind !== 'string' || !TRIGGER_KINDS.includes(raw.kind as OverlayTriggerKind)) return null
  const trigger: OverlayTrigger = { kind: raw.kind as OverlayTriggerKind }
  if (trigger.kind === 'semantic') {
    if (typeof raw.semantic !== 'string' || !SEMANTIC_ID_SET.has(raw.semantic)) return null
    trigger.semantic = raw.semantic as OverlaySemanticTriggerId
  }
  if (typeof raw.thresholdSec === 'number' && Number.isFinite(raw.thresholdSec)) trigger.thresholdSec = raw.thresholdSec
  if (typeof raw.shiftPct === 'number' && Number.isFinite(raw.shiftPct)) trigger.shiftPct = raw.shiftPct
  if (typeof raw.lapsToEmpty === 'number' && Number.isFinite(raw.lapsToEmpty)) trigger.lapsToEmpty = raw.lapsToEmpty
  return trigger
}

export function sanitizeOverlayTriggerForRole(
  value: unknown,
  role: OverlayRole | undefined,
  fallback: OverlayTrigger | null | undefined
): OverlayTrigger | null {
  const trigger = sanitizeOverlayTrigger(value)
  if (role !== 'alert') return trigger
  if (trigger && trigger.kind !== 'always') return trigger
  const safeFallback = sanitizeOverlayTrigger(fallback)
  return safeFallback && safeFallback.kind !== 'always' ? safeFallback : { kind: 'never' }
}

export function overlayTriggerTags(trigger: OverlayTrigger | null | undefined): string[] {
  if (!trigger || trigger.kind === 'always') return []
  const tags = ['trigger-only']
  if (trigger.kind === 'semantic' && trigger.semantic) {
    const channels = POLICIES[trigger.semantic].channels(null)
    if (channels.some((channel) => channel.mode === 'rising' || channel.mode === 'falling')) tags.push('trigger-edge')
    if (channels.some((channel) => (channel.ttlMs ?? 0) > 0)) tags.push('trigger-hold')
  }
  return tags
}

export class MonotonicTemporalTriggerEngine {
  private entries = new Map<string, TemporalEntry>()
  private lastNow = Number.NEGATIVE_INFINITY

  reset(): void {
    this.entries.clear()
    this.lastNow = Number.NEGATIVE_INFINITY
  }

  evaluate(
    key: string,
    mode: TemporalTriggerMode,
    signal: TriggerSignal,
    now: number,
    ttlMs = 0
  ): TemporalChannelResult {
    if (!Number.isFinite(now)) return { visible: false, active: false, held: false }
    if (now < this.lastNow) this.reset()
    this.lastNow = now

    if (!signal.known) {
      this.entries.delete(key)
      return { visible: false, active: false, held: false }
    }

    const entry = this.entries.get(key) ?? {
      initialized: false,
      previous: signal.value
    }
    const rising = entry.initialized && !entry.previous && signal.value
    const falling = entry.initialized && entry.previous && !signal.value
    const ttl = Math.max(0, ttlMs)

    if (mode === 'rising' && rising) entry.expiresAt = now + ttl
    if (mode === 'falling' && falling) entry.expiresAt = now + ttl
    if (mode === 'pulse' && signal.value) entry.expiresAt = now + ttl
    if (mode === 'after-false' && falling) entry.expiresAt = now + ttl

    entry.initialized = true
    entry.previous = signal.value
    this.entries.set(key, entry)

    const beforeExpiry = entry.expiresAt != null && now < entry.expiresAt
    const visible =
      mode === 'level'
        ? signal.value
        : mode === 'after-false'
          ? signal.value || beforeExpiry
          : beforeExpiry
    const nextChangeAt =
      visible &&
      beforeExpiry &&
      (mode === 'rising' || mode === 'falling' || mode === 'pulse' || !signal.value)
        ? entry.expiresAt
        : undefined
    if (!beforeExpiry && entry.expiresAt != null) entry.expiresAt = undefined
    return {
      visible,
      active: signal.value,
      held: visible && !signal.value,
      nextChangeAt
    }
  }

  nextDeadline(now = this.lastNow): number | undefined {
    if (Number.isFinite(now) && now > this.lastNow) this.lastNow = now
    let next: number | undefined
    for (const entry of this.entries.values()) {
      if (entry.expiresAt == null) continue
      if (entry.expiresAt <= this.lastNow) {
        entry.expiresAt = undefined
        continue
      }
      next = next == null ? entry.expiresAt : Math.min(next, entry.expiresAt)
    }
    return next
  }
}

function sessionIdentity(snapshot: TelemetrySnapshot): string {
  const identity =
    snapshot.replayContext?.sessionIdentity ??
    (snapshot.sessionUniqueId != null
      ? String(snapshot.sessionUniqueId)
      : [snapshot.trackName, snapshot.trackConfigName, snapshot.sessionType]
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .join('|') || 'unknown')
  return `${snapshot.sim}:${identity}:${snapshot.sessionNumber ?? 'unknown'}`
}

function replayBoundaryIdentity(snapshot: TelemetrySnapshot): string {
  const context = snapshot.replayContext
  if (!context) return `legacy:${snapshot.replayPlaying === true ? 'replay' : 'live'}`
  return `${context.connectionEpoch}:${context.revision}:${context.state}:${context.token}`
}

export class OverlayTriggerController {
  private readonly temporal = new MonotonicTemporalTriggerEngine()
  private preparedSnapshot: TelemetrySnapshot | null | undefined
  private connected = false
  private identity: string | undefined
  private replayFrame: number | undefined
  private replayTime: number | undefined
  private replayBoundary: string | undefined

  reset(): void {
    this.temporal.reset()
    this.preparedSnapshot = undefined
    this.connected = false
    this.identity = undefined
    this.replayFrame = undefined
    this.replayTime = undefined
    this.replayBoundary = undefined
  }

  evaluate(
    key: string,
    trigger: OverlayTrigger | null | undefined,
    snapshot: TelemetrySnapshot | null | undefined,
    now: number
  ): OverlayTriggerResult {
    this.prepare(snapshot)
    if (!trigger || trigger.kind === 'always') {
      return { visible: true, active: true, held: false, phase: 'active' }
    }
    if (!snapshot?.connected) {
      return { visible: false, active: false, held: false, phase: 'inactive' }
    }
    if (trigger.kind !== 'semantic' || !trigger.semantic) {
      const active = evaluateOverlayTrigger(trigger, snapshot)
      return { visible: active, active, held: false, phase: active ? 'active' : 'inactive' }
    }

    const channels = POLICIES[trigger.semantic].channels(snapshot)
    const visible = channels
      .map((channel) => ({
        channel,
        result: this.temporal.evaluate(
          `${key}:${trigger.semantic}:${channel.id}`,
          channel.mode,
          channel.signal,
          now,
          channel.ttlMs
        )
      }))
      .filter((entry) => entry.result.visible)
      .sort((a, b) => b.channel.priority - a.channel.priority || a.channel.id.localeCompare(b.channel.id))

    const selected = visible[0]
    return {
      visible: Boolean(selected),
      active: visible.some((entry) => entry.result.active),
      held: selected?.result.held ?? false,
      phase: selected?.channel.phase ?? 'inactive',
      nextChangeAt: visible.reduce<number | undefined>((next, entry) => {
        const deadline = entry.result.nextChangeAt
        if (deadline == null) return next
        return next == null ? deadline : Math.min(next, deadline)
      }, undefined)
    }
  }

  nextDeadline(now?: number): number | undefined {
    return this.temporal.nextDeadline(now)
  }

  private prepare(snapshot: TelemetrySnapshot | null | undefined): void {
    if (snapshot === this.preparedSnapshot) return
    this.preparedSnapshot = snapshot
    if (!snapshot?.connected) {
      if (this.connected) this.temporal.reset()
      this.connected = false
      this.identity = undefined
      this.replayFrame = undefined
      this.replayTime = undefined
      this.replayBoundary = undefined
      return
    }

    const nextIdentity = sessionIdentity(snapshot)
    const nextReplayBoundary = replayBoundaryIdentity(snapshot)
    const frame = finite(snapshot.replayFrameNum)
    const replayTime = finite(snapshot.sessionTimeSec)
    const replayActive = snapshot.replayPlaying === true || snapshot.replayContext?.active === true
    const rewound =
      replayActive &&
      ((frame != null && this.replayFrame != null && frame < this.replayFrame) ||
      (
        replayTime != null &&
        this.replayTime != null &&
        replayTime < this.replayTime))
    if (
      (this.connected && this.identity !== nextIdentity) ||
      (this.connected && this.replayBoundary !== nextReplayBoundary) ||
      rewound
    ) {
      this.temporal.reset()
    }

    this.connected = true
    this.identity = nextIdentity
    this.replayFrame = frame
    this.replayTime = replayTime
    this.replayBoundary = nextReplayBoundary
  }
}

const GENERATED_SEMANTICS = new Set<OverlaySemanticTriggerId>([
  'paceFlags',
  'pitFuelToAdd',
  'precipitation',
  'repairTime',
  'optionalRepairTime',
  'incidentCounts',
  'repairRequirement',
  'pitServiceStatus',
  'pitsOpen',
  'pitServicesSelected',
  'trackWetness',
  'fogLevel',
  'sideProximity',
  'raceControlFlags',
  'drs',
  'engineWarnings',
  'pushToPassState',
  'absActive',
  'absCut',
  'tcActive',
  'declaredWet',
  'paceMode',
  'paceFormation',
  'onPitRoad',
  'pitLimiter',
  'inPitStall',
  'pitStopActive',
  'pitTyreTargets',
  'replayState',
  'replayTimeline'
])

const DIRECT_MODULE_SEMANTICS: Record<string, OverlaySemanticTriggerId> = {
  drs: 'drs',
  pushToPass: 'pushToPassState',
  absState: 'absActive',
  tcState: 'tcActive',
  engineWarnings: 'engineWarnings',
  paceMode: 'paceMode',
  flag: 'raceControlFlags',
  raceControlFlags: 'raceControlFlags',
  incidents: 'incidentCounts',
  pitLimiter: 'pitLimiter',
  pitService: 'pitServicesSelected',
  wetDeclared: 'declaredWet',
  wetness: 'trackWetness',
  fog: 'fogLevel',
  alert2EngineWarning: 'alert2EngineWarning',
  alert2WaterTempCritical: 'alert2WaterTempCritical',
  alert2OilTempCritical: 'alert2OilTempCritical',
  alert2OilPressureLow: 'alert2OilPressureLow',
  alert2BadSurface: 'alert2BadSurface',
  alert2BlueFlag: 'alert2BlueFlag',
  alert2TyreTempCritical: 'alert2TyreTempCritical',
  alert2BrakePressureLow: 'alert2BrakePressureLow'
}

export function semanticTriggerForHifiModule(moduleId: string): OverlayTrigger | undefined {
  const direct = DIRECT_MODULE_SEMANTICS[moduleId]
  if (direct) return semanticOverlayTrigger(direct)
  if (moduleId.startsWith('raceControlFlags')) return semanticOverlayTrigger('raceControlFlags')
  if (moduleId.startsWith('spotterRaw')) return semanticOverlayTrigger('sideProximity')
  const generated = /^telemetry-(.+)-(competition|futuristic|ddu)$/.exec(moduleId)?.[1]
  if (generated === 'proximity') return semanticOverlayTrigger('sideProximity')
  if (generated === 'raceFlags') return semanticOverlayTrigger('raceControlFlags')
  if (generated && GENERATED_SEMANTICS.has(generated as OverlaySemanticTriggerId)) {
    return semanticOverlayTrigger(generated as OverlaySemanticTriggerId)
  }
  return undefined
}

const DIRECT_ALERT_TRIGGERS: Record<string, OverlayTrigger> = {
  alertCarLeft: { kind: 'carLeft' },
  alertCarRight: { kind: 'carRight' },
  alertProximityRadar: { kind: 'proximity', thresholdSec: 0.5 },
  alertShiftFlash: { kind: 'shiftPoint', shiftPct: 0.97 },
  alertPitLimiter: { kind: 'pitLimiter' },
  alertFlag: { kind: 'flag' },
  alertLowFuel: { kind: 'lowFuel', lapsToEmpty: 2 }
}

export function defaultTriggerForHifiModule(moduleId: string): OverlayTrigger | undefined {
  return semanticTriggerForHifiModule(moduleId) ?? DIRECT_ALERT_TRIGGERS[moduleId]
}

export function hifiModuleRole(moduleId: string): OverlayRole | undefined {
  return defaultTriggerForHifiModule(moduleId) || /^alert/i.test(moduleId) ? 'alert' : undefined
}

function previewFlags(active: boolean, blueOnly = false): NonNullable<TelemetrySnapshot['flags']> {
  return {
    green: active && !blueOnly,
    yellow: false,
    blue: active && blueOnly,
    white: false,
    checkered: false,
    red: false,
    black: false,
    meatball: false,
    repair: false,
    disqualify: false,
    greenWhiteCheckered: false
  }
}

export function simulateOverlayTriggerSnapshot(
  base: TelemetrySnapshot,
  trigger: OverlayTrigger | null | undefined,
  active: boolean
): TelemetrySnapshot {
  const snapshot: TelemetrySnapshot = {
    ...base,
    connected: true,
    timestamp: base.timestamp + (active ? 1 : 0)
  }
  if (!trigger || trigger.kind === 'always') return snapshot
  if (trigger.kind !== 'semantic' || !trigger.semantic) {
    if (trigger.kind === 'carLeft') snapshot.carLeftRight = active ? 'left' : 'clear'
    if (trigger.kind === 'carRight') snapshot.carLeftRight = active ? 'right' : 'clear'
    if (trigger.kind === 'carLeftOrRight') snapshot.carLeftRight = active ? 'both' : 'clear'
    if (trigger.kind === 'proximity') {
      snapshot.relatives = active
        ? { ahead: { carIdx: 2, name: 'Preview', carNumber: '2', gapSec: 0.2 } }
        : { ahead: { carIdx: 2, name: 'Preview', carNumber: '2', gapSec: 2 } }
      snapshot.radarCars = []
    }
    if (trigger.kind === 'shiftPoint') snapshot.shiftIndicatorPct = active ? 1 : 0.5
    if (trigger.kind === 'pitLimiter') snapshot.pitLimiter = active
    if (trigger.kind === 'flag') snapshot.flags = previewFlags(active)
    if (trigger.kind === 'lowFuel') {
      snapshot.fuelLiters = active ? 2 : 30
      snapshot.fuelPerLap = 2
    }
    return snapshot
  }

  const pit = {
    repairNeeded: false,
    optRepairNeeded: false,
    pitsOpen: false,
    inPitStall: false,
    svStatus: 0
  }
  switch (trigger.semantic) {
    case 'paceFlags': {
      const drivers = (base.drivers ?? []).filter((driver) => driver.isPaceCar !== true)
      snapshot.drivers = [
        ...drivers,
        {
          carIdx: 63,
          name: 'Pace Car',
          carNumber: 'PC',
          position: 0,
          classPosition: 0,
          classId: 0,
          isPlayer: false,
          isPaceCar: true,
          inPits: !active
        }
      ]
      snapshot.paceFlags = active ? ['freePass'] : []
      break
    }
    case 'pitFuelToAdd':
      snapshot.onPitRoad = active
      snapshot.pitFuelToAddL = 24
      break
    case 'precipitation':
      snapshot.isRaining = active
      snapshot.precipitationPct = active ? 0.35 : 0
      break
    case 'repairTime':
      snapshot.onPitRoad = active
      snapshot.repairTimeSec = active ? 42 : 0
      break
    case 'optionalRepairTime':
      snapshot.onPitRoad = active
      snapshot.optionalRepairTimeSec = active ? 18 : 0
      break
    case 'incidentCounts':
      snapshot.incidentCount = active ? 4 : 0
      snapshot.incidentCountMy = active ? 4 : 0
      snapshot.incidentCountTeam = active ? 4 : 0
      break
    case 'repairRequirement':
      snapshot.pit = { ...pit, repairNeeded: active }
      break
    case 'pitServiceStatus':
      snapshot.onPitRoad = active
      snapshot.pit = active
        ? { ...pit, repairNeeded: true, svStatus: 1 }
        : { ...pit, svStatus: 2 }
      break
    case 'pitsOpen':
      snapshot.pit = { ...pit, pitsOpen: active }
      break
    case 'pitServicesSelected':
      snapshot.onPitRoad = active
      snapshot.pitServiceFlags = active ? ['fuel', 'lf', 'rf'] : []
      break
    case 'trackWetness':
      snapshot.trackWetnessPct = active ? 0.4 : 0
      break
    case 'fogLevel':
      snapshot.fogPct = active ? 0.35 : 0
      break
    case 'sideProximity':
      snapshot.carLeftRight = active ? 'left' : 'clear'
      snapshot.carLeftRightCount = active ? 1 : undefined
      break
    case 'raceControlFlags':
      snapshot.flags = previewFlags(active)
      break
    case 'drs':
      snapshot.drsState = active ? 3 : 0
      snapshot.drs = active
      break
    case 'engineWarnings':
    case 'alert2EngineWarning':
      snapshot.engineWarnings = {
        oilPressure: active,
        waterTemp: false,
        oilTemp: false,
        fuelPressure: false,
        stalled: false,
        pitLimiter: false,
        revLimiter: false,
        mandRepair: false,
        optRepair: false
      }
      break
    case 'pushToPassState':
      snapshot.pushToPass = active
      break
    case 'absActive':
      snapshot.absActive = active
      break
    case 'absCut':
      snapshot.absCutPct = active ? 32 : 0
      break
    case 'tcActive':
      snapshot.tcActive = active
      break
    case 'declaredWet':
      snapshot.weatherDeclaredWet = active
      break
    case 'paceMode':
    case 'paceFormation':
      snapshot.paceMode = active ? 'doubleFileRestart' : 'notPacing'
      break
    case 'onPitRoad':
      snapshot.onPitRoad = active
      break
    case 'pitLimiter':
      snapshot.pitLimiter = active
      break
    case 'inPitStall':
      snapshot.pit = { ...pit, inPitStall: active }
      break
    case 'pitStopActive':
      snapshot.pitStopActive = active
      break
    case 'pitTyreTargets':
      snapshot.onPitRoad = active
      snapshot.pitTyreTargetsKpa = { lf: 165, rf: 166, lr: 163, rr: 164 }
      break
    case 'replayState':
    case 'replayTimeline':
      snapshot.replayPlaying = active
      snapshot.replayFrameNum = active ? 500 : 0
      snapshot.replayFrameEnd = 1000
      break
    case 'alert2WaterTempCritical':
      snapshot.waterTempC = active ? 112 : 95
      snapshot.engineWarnings = { ...base.engineWarnings, waterTemp: active } as TelemetrySnapshot['engineWarnings']
      break
    case 'alert2OilTempCritical':
      snapshot.oilTempC = active ? 132 : 105
      snapshot.engineWarnings = { ...base.engineWarnings, oilTemp: active } as TelemetrySnapshot['engineWarnings']
      break
    case 'alert2OilPressureLow':
      snapshot.oilPressureKpa = active ? 92 : 470
      snapshot.engineWarnings = { ...base.engineWarnings, oilPressure: active } as TelemetrySnapshot['engineWarnings']
      break
    case 'alert2BadSurface':
      snapshot.trackSurfaceMaterial = active ? 15 : 1
      break
    case 'alert2BlueFlag':
      snapshot.flags = previewFlags(active, true)
      break
    case 'alert2TyreTempCritical':
      snapshot.tyres = {
        ...(base.tyres ?? {
          lf: {},
          rf: {},
          lr: {},
          rr: {}
        }),
        lf: { ...(base.tyres?.lf ?? {}), tempC: active ? 118 : 88 }
      }
      break
    case 'alert2BrakePressureLow':
      snapshot.brake = active ? 0.72 : 0
      snapshot.brakeLinePressBar = active
        ? { lf: 18, rf: 17, lr: 14, rr: 13 }
        : { lf: 80, rf: 78, lr: 65, rr: 64 }
      break
  }
  return snapshot
}

export function isSemanticTriggerWithEdges(trigger: OverlayTrigger | null | undefined): boolean {
  if (trigger?.kind !== 'semantic' || !trigger.semantic) return false
  return POLICIES[trigger.semantic].channels(null).some((channel) =>
    channel.mode === 'rising' || channel.mode === 'falling'
  )
}

export function isSemanticTriggerWithHold(trigger: OverlayTrigger | null | undefined): boolean {
  if (trigger?.kind !== 'semantic' || !trigger.semantic) return false
  return POLICIES[trigger.semantic].channels(null).some((channel) => (channel.ttlMs ?? 0) > 0)
}
