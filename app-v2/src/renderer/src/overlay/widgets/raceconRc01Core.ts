import { isLiveTelemetrySnapshot } from '../../../../shared/replay'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'

/** RC-01 owns its own live-only model. It intentionally has no scenario/mock dependency. */
export const RC01_LED_COUNT = 11
export const RC01_HISTORY_LIMIT = 240
export const RC01_NATIVE_WIDTH_PX = 800
export const RC01_NATIVE_HEIGHT_PX = 480
export const RC01_NATIVE_TOLERANCE_PX = 1
export const RC01_APP_WIDTH_PX = 1024
export const RC01_APP_HEIGHT_PX = 600
export const RC01_PHONE_MIN_WIDTH_PX = 360
export const RC01_PHONE_MAX_WIDTH_PX = 480
export const RC01_PHONE_MIN_HEIGHT_PX = 650
export const RC01_SLOWEST_STREAM_CADENCE_MS = 67
export const RC01_STREAM_JITTER_BUDGET_MS = 33
export const RC01_MIN_STREAM_FRESH_MS =
  RC01_SLOWEST_STREAM_CADENCE_MS + RC01_STREAM_JITTER_BUDGET_MS

export const RC01_CHANNEL_STALE_MS = {
  rpm: 200,
  speed: 500,
  gear: RC01_MIN_STREAM_FRESH_MS,
  tc: 1_000,
  position: 1_000,
  fuel: 500,
  delta: 250,
  bestLap: 2_000,
  gapAhead: 1_000,
  pitLimiter: 300,
  tyreLf: 200,
  tyreRf: 200,
  tyreLr: 200,
  tyreRr: 200
} as const

export type Rc01ChannelName = keyof typeof RC01_CHANNEL_STALE_MS
export type Rc01FieldTone = 'primary' | 'muted' | 'good' | 'bad'
export type Rc01LedTone = 'dark' | 'cyan' | 'green' | 'amber' | 'red' | 'magenta'
export type Rc01MonotonicClock = () => number
export type Rc01CompactMode = 'phone' | 'standard'

export const RC01_SHIFT_THRESHOLD_BY_GEAR = {
  1: 0.86,
  2: 0.88,
  3: 0.90,
  4: 0.92,
  5: 0.94,
  6: 0.96,
  7: 0.97,
  8: 0.98
} as const
export const RC01_SHIFT_THRESHOLD_FALLBACK = 0.94

export interface Rc01Field {
  value: string
  raw: number | string | null
  stale: boolean
  unavailable: boolean
  tone: Rc01FieldTone
}

export interface Rc01Tyre extends Rc01Field {
  corner: 'LF' | 'RF' | 'LR' | 'RR'
}

export interface Rc01Led {
  index: number
  active: boolean
  tone: Rc01LedTone
}

export interface Rc01ChannelReceipt {
  snapshotTimestamp: number
  receivedAt: number
  value: number | string | boolean
}

/** A frozen, primitive-only record retained in the bounded RC-01 ring. */
export interface Rc01AcceptedSample {
  readonly sourceIdentity: string
  readonly timestamp: number
  readonly receivedAt: number
  readonly fingerprint: string
  readonly rpmRatio: number | null
  readonly rpmFresh: boolean
  readonly gear: number | null
  readonly delta: number | null
  readonly deltaFresh: boolean
  readonly bestLap: number | null
  readonly bestLapFresh: boolean
  readonly pitLimiter: boolean | null
  readonly pitLimiterFresh: boolean
}

export type Rc01IngestReason =
  | 'accepted'
  | 'duplicate'
  | 'disconnected'
  | 'mock-telemetry'
  | 'replay-telemetry'
  | 'not-live-telemetry'
  | 'invalid-timestamp'
  | 'missing-source-identity'
  | 'source-discontinuity'
  | 'out-of-order'
  | 'same-timestamp-collision'

export interface Rc01IngestResult {
  accepted: boolean
  renderable: boolean
  reason: Rc01IngestReason
}

/**
 * RC-01 accepts only an identity supplied by the live source. An explicit,
 * confirmed-live replay context is authoritative for ACC/AMS2. Without one,
 * the source must expose its own finite sessionUniqueId or connectionEpoch;
 * inferred session metadata is deliberately never used as a replay boundary.
 */
export function rc01SourceIdentity(snapshot: TelemetrySnapshot | null | undefined): string | null {
  if (!snapshot || !isLiveTelemetrySnapshot(snapshot) || snapshot.sim === 'none' || snapshot.sim === 'mock' || snapshot.sim === 'replay') return null

  const context = snapshot.replayContext
  if (context !== undefined) {
    if (context.state !== 'live' ||
      typeof context.sessionIdentity !== 'string' || !context.sessionIdentity.trim() ||
      !Number.isSafeInteger(context.connectionEpoch) || context.connectionEpoch < 0 ||
      typeof context.token !== 'string' || !context.token.trim() ||
      !Number.isSafeInteger(context.revision) || context.revision < 0) return null
    return `${snapshot.sim}:session:${context.sessionIdentity}:connection:${context.connectionEpoch}:token:${context.token}:revision:${context.revision}`
  }

  const sessionUniqueId = finiteNumber(snapshot.sessionUniqueId) ? snapshot.sessionUniqueId : null
  const rawConnectionEpoch = snapshot.connectionEpoch
  const connectionEpoch = typeof rawConnectionEpoch === 'number' && Number.isSafeInteger(rawConnectionEpoch) && rawConnectionEpoch >= 0
    ? rawConnectionEpoch
    : null
  if (sessionUniqueId === null && connectionEpoch === null) return null
  return `${snapshot.sim}:session:${sessionUniqueId ?? 'none'}:connection:${connectionEpoch ?? 'none'}`
}

function finiteNumber(value: unknown, min = Number.NEGATIVE_INFINITY): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min
}

/** Local receipt/freshness clock. Provider timestamps are never compared to it. */
export function rc01MonotonicNow(): number {
  const value = globalThis.performance?.now()
  return finiteNumber(value, 0) ? value : 0
}

function validAidLevel(value: unknown): value is number | string {
  return (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && value.trim().length > 0)
}

function channelValue(snapshot: TelemetrySnapshot, channel: Rc01ChannelName): number | string | boolean | null {
  switch (channel) {
    case 'rpm': return finiteNumber(snapshot.rpm, 0) ? snapshot.rpm : null
    case 'speed': return finiteNumber(snapshot.speedKmh, 0) ? snapshot.speedKmh : null
    case 'gear': return finiteNumber(snapshot.gear) && Number.isInteger(snapshot.gear) ? snapshot.gear : null
    case 'tc': return validAidLevel(snapshot.tcLevel) ? snapshot.tcLevel : null
    case 'position': return finiteNumber(snapshot.position, 1) && Number.isInteger(snapshot.position) ? snapshot.position : null
    case 'fuel': return finiteNumber(snapshot.fuelLiters, 0) ? snapshot.fuelLiters : null
    case 'delta': return finiteNumber(snapshot.deltaToBestSec) ? snapshot.deltaToBestSec : null
    case 'bestLap': return finiteNumber(snapshot.bestLapTimeSec, Number.EPSILON) ? snapshot.bestLapTimeSec : null
    case 'gapAhead': return finiteNumber(snapshot.relatives?.ahead?.gapSec) ? snapshot.relatives!.ahead!.gapSec! : null
    case 'pitLimiter': return typeof snapshot.pitLimiter === 'boolean' ? snapshot.pitLimiter : null
    case 'tyreLf': return finiteNumber(snapshot.tyres?.lf?.tempC) ? snapshot.tyres!.lf.tempC! : null
    case 'tyreRf': return finiteNumber(snapshot.tyres?.rf?.tempC) ? snapshot.tyres!.rf.tempC! : null
    case 'tyreLr': return finiteNumber(snapshot.tyres?.lr?.tempC) ? snapshot.tyres!.lr.tempC! : null
    case 'tyreRr': return finiteNumber(snapshot.tyres?.rr?.tempC) ? snapshot.tyres!.rr.tempC! : null
  }
}

function fingerprint(snapshot: TelemetrySnapshot, sourceIdentity: string): string {
  return JSON.stringify({
    connected: snapshot.connected,
    timestamp: snapshot.timestamp,
    source: sourceIdentity,
    maxRpm: finiteNumber(snapshot.maxRpm, 0) ? snapshot.maxRpm : null,
    channels: Object.fromEntries((Object.keys(RC01_CHANNEL_STALE_MS) as Rc01ChannelName[])
      .map((channel) => [channel, channelValue(snapshot, channel)]))
  })
}

function createRc01AcceptedSample(
  snapshot: TelemetrySnapshot,
  sourceIdentity: string,
  receivedAt: number,
  sampleFingerprint: string
): Rc01AcceptedSample {
  const rpm = channelValue(snapshot, 'rpm')
  const maxRpm = finiteNumber(snapshot.maxRpm, Number.EPSILON) ? snapshot.maxRpm : null
  const rpmRatio = typeof rpm === 'number' && maxRpm !== null ? rpm / maxRpm : null
  const deltaValue = channelValue(snapshot, 'delta')
  const bestLapValue = channelValue(snapshot, 'bestLap')
  const gearValue = channelValue(snapshot, 'gear')
  const pitLimiterValue = channelValue(snapshot, 'pitLimiter')

  // All retained values are primitives. Full snapshots are kept only as the current display frame.
  return Object.freeze({
    sourceIdentity,
    timestamp: snapshot.timestamp,
    receivedAt,
    fingerprint: sampleFingerprint,
    rpmRatio,
    rpmFresh: rpmRatio !== null,
    gear: typeof gearValue === 'number' ? gearValue : null,
    delta: typeof deltaValue === 'number' ? deltaValue : null,
    deltaFresh: typeof deltaValue === 'number',
    bestLap: typeof bestLapValue === 'number' ? bestLapValue : null,
    bestLapFresh: typeof bestLapValue === 'number',
    pitLimiter: typeof pitLimiterValue === 'boolean' ? pitLimiterValue : null,
    pitLimiterFresh: typeof pitLimiterValue === 'boolean'
  })
}

function clearExpiredReceiptAlertContinuity(
  alerts: Rc01AlertState,
  receipts: ReadonlyMap<Rc01ChannelName, Rc01ChannelReceipt>,
  receivedAt: number
): Rc01AlertState {
  const next = cloneRc01AlertState(alerts)
  if (rc01ReceiptAgeMs(receipts.get('rpm'), receivedAt) > RC01_CHANNEL_STALE_MS.rpm) {
    next.overRev = { active: false, pendingSinceMs: null, recoverySinceMs: null }
  }
  if (
    rc01ReceiptAgeMs(receipts.get('delta'), receivedAt) > RC01_CHANNEL_STALE_MS.delta ||
    rc01ReceiptAgeMs(receipts.get('bestLap'), receivedAt) > RC01_CHANNEL_STALE_MS.bestLap
  ) {
    next.deltaCliff = { active: false, pendingSinceMs: null, baselineDelta: null }
    next.deltaZeroCross = {
      active: false,
      pendingSinceMs: null,
      pendingSign: null,
      lastNonZeroSign: null,
      minimumVisibleUntilMs: 0
    }
  }
  if (rc01ReceiptAgeMs(receipts.get('pitLimiter'), receivedAt) > RC01_CHANNEL_STALE_MS.pitLimiter) {
    next.pitLimiter = { active: false, minimumVisibleUntilMs: 0 }
  }
  return next
}

/**
 * A bounded, source-owned history. It accepts only connected, monotonically
 * timestamped live samples and deliberately never manufactures history.
 */
export class Rc01LiveTelemetryBuffer {
  private source: string | null = null
  private minimumTimestampExclusive: number | null = null
  private samples: Rc01AcceptedSample[] = []
  private latest: TelemetrySnapshot | null = null
  private channelReceipts = new Map<Rc01ChannelName, Rc01ChannelReceipt>()
  private alerts = createRc01AlertState()
  private trace: readonly number[] = []

  /** A render may mutate this candidate, never the committed buffer it was cloned from. */
  clone(): Rc01LiveTelemetryBuffer {
    const next = new Rc01LiveTelemetryBuffer()
    next.source = this.source
    next.minimumTimestampExclusive = this.minimumTimestampExclusive
    next.samples = this.samples.slice()
    next.latest = this.latest
    next.channelReceipts = new Map(this.channelReceipts)
    next.alerts = cloneRc01AlertState(this.alerts)
    next.trace = this.trace.slice()
    return next
  }

  reset(): void {
    this.source = null
    this.minimumTimestampExclusive = null
    this.samples = []
    this.latest = null
    this.channelReceipts.clear()
    this.alerts = createRc01AlertState()
    this.trace = []
  }

  /**
   * Clears all data that could belong to an ambiguous source/timestamp while
   * retaining a strictly-after barrier. The rejecting frame is never rendered.
   */
  private quarantine(sourceIdentity: string, timestamp: number): void {
    this.reset()
    this.source = sourceIdentity
    this.minimumTimestampExclusive = timestamp
  }

  ingest(snapshot: TelemetrySnapshot | null | undefined, receivedAt = rc01MonotonicNow()): Rc01IngestResult {
    const connected = Boolean(snapshot?.connected)
    if (snapshot?.sim === 'mock') {
      this.reset()
      return { accepted: false, renderable: false, reason: 'mock-telemetry' }
    }
    if (snapshot?.sim === 'replay' || snapshot?.replayContext?.state === 'replay') {
      this.reset()
      return { accepted: false, renderable: false, reason: 'replay-telemetry' }
    }
    if (!isLiveTelemetrySnapshot(snapshot)) {
      this.reset()
      return { accepted: false, renderable: false, reason: connected ? 'not-live-telemetry' : 'disconnected' }
    }
    if (!finiteNumber(snapshot.timestamp)) {
      this.reset()
      return { accepted: false, renderable: false, reason: 'invalid-timestamp' }
    }
    const sourceIdentity = rc01SourceIdentity(snapshot)
    if (!sourceIdentity) {
      this.reset()
      return { accepted: false, renderable: false, reason: 'missing-source-identity' }
    }
    if (this.source !== null && this.source !== sourceIdentity) {
      this.quarantine(sourceIdentity, snapshot.timestamp)
      return { accepted: false, renderable: false, reason: 'source-discontinuity' }
    }
    if (this.source === null) this.source = sourceIdentity

    const last = this.samples.at(-1)
    if (this.minimumTimestampExclusive !== null && snapshot.timestamp <= this.minimumTimestampExclusive) {
      return { accepted: false, renderable: false, reason: 'out-of-order' }
    }
    const nextFingerprint = fingerprint(snapshot, sourceIdentity)
    if (last && snapshot.timestamp < last.timestamp) {
      return { accepted: false, renderable: false, reason: 'out-of-order' }
    }
    if (last && snapshot.timestamp === last.timestamp) {
      if (last.fingerprint !== nextFingerprint) {
        this.quarantine(sourceIdentity, snapshot.timestamp)
        return { accepted: false, renderable: false, reason: 'same-timestamp-collision' }
      }
      return { accepted: false, renderable: true, reason: 'duplicate' }
    }

    const safeReceiptAt = finiteNumber(receivedAt, 0) ? receivedAt : rc01MonotonicNow()
    this.alerts = clearExpiredReceiptAlertContinuity(
      this.alerts,
      this.channelReceipts,
      safeReceiptAt
    )
    const sample = createRc01AcceptedSample(snapshot, sourceIdentity, safeReceiptAt, nextFingerprint)
    const deltaTwoSecondsAgo = rc01DeltaTwoSecondsAgo(this.samples, sample.receivedAt)
    this.alerts = advanceRc01Alerts(this.alerts, rc01AlertInputForSample(sample, deltaTwoSecondsAgo))
    this.samples.push(sample)
    this.minimumTimestampExclusive = null
    if (this.samples.length > RC01_HISTORY_LIMIT) this.samples.splice(0, this.samples.length - RC01_HISTORY_LIMIT)
    this.latest = snapshot
    for (const channel of Object.keys(RC01_CHANNEL_STALE_MS) as Rc01ChannelName[]) {
      const value = channelValue(snapshot, channel)
      if (value !== null) {
        this.channelReceipts.set(channel, Object.freeze({
          value,
          snapshotTimestamp: sample.timestamp,
          receivedAt: safeReceiptAt
        }))
      }
    }
    this.trace = rc01TraceValues(this.samples)
    return { accepted: true, renderable: true, reason: 'accepted' }
  }

  history(): readonly Rc01AcceptedSample[] {
    return this.samples.slice()
  }

  receipts(): ReadonlyMap<Rc01ChannelName, Rc01ChannelReceipt> {
    return new Map(this.channelReceipts)
  }

  latestSample(): Rc01AcceptedSample | null {
    return this.samples.at(-1) ?? null
  }

  /** The exact latest accepted frame is intentionally outside compact history. */
  latestSnapshot(): TelemetrySnapshot | null {
    return this.latest
  }

  /**
   * Apply render-time freshness invalidation to this isolated candidate. The caller
   * commits the candidate in a layout effect, so an abandoned render cannot clear
   * committed continuity while a committed stale frame permanently breaks it.
   */
  clearInvalidCurrentAlerts(model: Rc01DashboardModel): Rc01AlertState {
    this.alerts = clearInvalidRc01CurrentAlerts(this.alerts, model)
    return cloneRc01AlertState(this.alerts)
  }

  /** Incremental state; callers receive a small defensive copy, never mutable buffer state. */
  alertState(): Rc01AlertState {
    return cloneRc01AlertState(this.alerts)
  }

  /** A cached, down-sampled trace derived only when a compact sample is accepted. */
  traceValues(): readonly number[] {
    return this.trace.slice()
  }

  sourceIdentity(): string | null {
    return this.source
  }
}

export function createRc01ChannelReceipts(
  snapshot: TelemetrySnapshot,
  receivedAt = rc01MonotonicNow()
): ReadonlyMap<Rc01ChannelName, Rc01ChannelReceipt> {
  const buffer = new Rc01LiveTelemetryBuffer()
  buffer.ingest(snapshot, receivedAt)
  return buffer.receipts()
}

export function rc01ReceiptAgeMs(receipt: Rc01ChannelReceipt | undefined, nowMs: number): number {
  if (!receipt || !finiteNumber(nowMs, 0) || !finiteNumber(receipt.receivedAt, 0)) return Number.POSITIVE_INFINITY
  return Math.max(0, nowMs - receipt.receivedAt)
}

function field(value: string, raw: number | string | null, stale = false, unavailable = false, tone: Rc01FieldTone = 'primary'): Rc01Field {
  return { value, raw, stale, unavailable, tone }
}

function unavailable(value: string): Rc01Field {
  return field(value, null, false, true, 'muted')
}

function displayGear(value: number): string {
  if (value === -1) return 'R'
  if (value === 0) return 'N'
  return String(value)
}

function displayBestLap(value: number): string {
  const minutes = Math.floor(value / 60)
  const seconds = value - minutes * 60
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(3).padStart(6, '0')}`
}

function displayDelta(value: number): string {
  return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(3)} S`
}

function receiptFor(
  receipts: ReadonlyMap<Rc01ChannelName, Rc01ChannelReceipt>,
  channel: Rc01ChannelName,
  nowMs: number
): { receipt: Rc01ChannelReceipt | undefined; stale: boolean } {
  const receipt = receipts.get(channel)
  return { receipt, stale: rc01ReceiptAgeMs(receipt, nowMs) > RC01_CHANNEL_STALE_MS[channel] }
}

function numericField(
  snapshot: TelemetrySnapshot,
  receipts: ReadonlyMap<Rc01ChannelName, Rc01ChannelReceipt>,
  channel: Rc01ChannelName,
  nowMs: number,
  unavailableText: string,
  formatter: (value: number) => string,
  staleText = unavailableText,
  retainStaleValue = false
): Rc01Field {
  const raw = channelValue(snapshot, channel)
  if (typeof raw !== 'number') return unavailable(unavailableText)
  const { receipt, stale } = receiptFor(receipts, channel, nowMs)
  if (!receipt || typeof receipt.value !== 'number') return unavailable(unavailableText)
  const displayValue = stale && retainStaleValue ? formatter(receipt.value) : stale ? staleText : formatter(raw)
  return field(displayValue, stale && retainStaleValue ? receipt.value : raw, stale, false, stale ? 'muted' : 'primary')
}

function aidField(
  snapshot: TelemetrySnapshot,
  receipts: ReadonlyMap<Rc01ChannelName, Rc01ChannelReceipt>,
  nowMs: number
): Rc01Field {
  const raw = channelValue(snapshot, 'tc')
  if (typeof raw !== 'number' && typeof raw !== 'string') return unavailable('--')
  const { receipt, stale } = receiptFor(receipts, 'tc', nowMs)
  if (!receipt || (typeof receipt.value !== 'number' && typeof receipt.value !== 'string')) return unavailable('--')
  const value = stale ? receipt.value : raw
  return field(String(value), value, stale, false, stale ? 'muted' : 'primary')
}

export interface Rc01DashboardModel {
  speed: Rc01Field
  gear: Rc01Field
  rpm: Rc01Field
  tc: Rc01Field
  position: Rc01Field
  fuel: Rc01Field
  delta: Rc01Field & { direction: 'up' | 'down' | 'flat' }
  best: Rc01Field
  gapAhead: Rc01Field
  tyres: readonly Rc01Tyre[]
  pitLimiter: { value: boolean | null; stale: boolean; unavailable: boolean }
  rpmRatio: number | null
  rpmFresh: boolean
  shiftGear: number | null
  shiftThreshold: number
  leds: readonly Rc01Led[]
  criticalFresh: Readonly<Record<Rc01ChannelName, boolean>>
}

export function rc01ShiftThresholdForGear(gear: number | null): number {
  if (gear !== null && gear >= 1 && gear <= 8 && Number.isInteger(gear)) {
    return RC01_SHIFT_THRESHOLD_BY_GEAR[gear as keyof typeof RC01_SHIFT_THRESHOLD_BY_GEAR]
  }
  return RC01_SHIFT_THRESHOLD_FALLBACK
}

export function buildRc01LedStates(
  rpmRatio: number | null,
  rpmFresh: boolean,
  overRevActive = false,
  gear: number | null = null
): readonly Rc01Led[] {
  const threshold = rc01ShiftThresholdForGear(gear)
  const activeCount = rpmFresh && rpmRatio !== null && rpmRatio >= 0.6
    ? Math.max(0, Math.min(RC01_LED_COUNT, Math.ceil(((rpmRatio - 0.6) * RC01_LED_COUNT) / (threshold - 0.6))))
    : 0
  return Array.from({ length: RC01_LED_COUNT }, (_, index) => {
    const normalTone: Rc01LedTone = index < 3 ? 'cyan' : index < 6 ? 'green' : index < 9 ? 'amber' : 'red'
    return { index, active: index < activeCount, tone: index < activeCount ? (overRevActive ? 'magenta' : normalTone) : 'dark' }
  })
}

export function createRc01DashboardModel(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc01ChannelName, Rc01ChannelReceipt> = new Map(),
  nowMs = rc01MonotonicNow()
): Rc01DashboardModel {
  const offline = !snapshot?.connected
  const safeSnapshot = snapshot && snapshot.connected ? snapshot : null
  const fresh = Object.fromEntries((Object.keys(RC01_CHANNEL_STALE_MS) as Rc01ChannelName[]).map((channel) => {
    const valid = safeSnapshot !== null && channelValue(safeSnapshot, channel) !== null
    const { receipt, stale } = receiptFor(receipts, channel, nowMs)
    return [channel, Boolean(valid && receipt && !stale)]
  })) as Record<Rc01ChannelName, boolean>

  if (!safeSnapshot) {
    const missingTyre = (corner: Rc01Tyre['corner']): Rc01Tyre => ({ corner, ...unavailable('--') })
    return {
      speed: unavailable('---'), gear: unavailable('\u2014'), rpm: unavailable('---'), tc: unavailable('--'),
      position: unavailable('--'), fuel: unavailable('--'), delta: { ...unavailable('--.---'), direction: 'flat' },
      best: unavailable('--:--.---'), gapAhead: unavailable('--.--- S'),
      tyres: [missingTyre('LF'), missingTyre('RF'), missingTyre('LR'), missingTyre('RR')],
      pitLimiter: { value: null, stale: false, unavailable: true },
      rpmRatio: null, rpmFresh: false, shiftGear: null, shiftThreshold: RC01_SHIFT_THRESHOLD_FALLBACK,
      leds: buildRc01LedStates(null, false), criticalFresh: fresh
    }
  }

  const speed = numericField(safeSnapshot, receipts, 'speed', nowMs, '---', (value) => String(Math.round(value)))
  const gearRaw = channelValue(safeSnapshot, 'gear')
  const gearReceipt = receiptFor(receipts, 'gear', nowMs)
  const gear = typeof gearRaw !== 'number' || !gearReceipt.receipt
    ? unavailable('\u2014')
    : field(displayGear(gearRaw), gearRaw, gearReceipt.stale, false, gearReceipt.stale ? 'muted' : 'primary')
  const rpmRaw = channelValue(safeSnapshot, 'rpm')
  const rpmReceipt = receiptFor(receipts, 'rpm', nowMs)
  const rpmValue = rpmReceipt.receipt?.value
  const rpm = typeof rpmRaw !== 'number' || typeof rpmValue !== 'number'
    ? unavailable('---')
    : field(Math.round(rpmReceipt.stale ? rpmValue : rpmRaw).toLocaleString('en-US'), rpmReceipt.stale ? rpmValue : rpmRaw, rpmReceipt.stale, false, rpmReceipt.stale ? 'muted' : 'primary')
  const tc = aidField(safeSnapshot, receipts, nowMs)
  const position = numericField(safeSnapshot, receipts, 'position', nowMs, '--', (value) => `P${String(Math.trunc(value)).padStart(2, '0')}`, '--', true)
  const fuel = numericField(safeSnapshot, receipts, 'fuel', nowMs, '--', (value) => `${value.toFixed(1)} L`, '--', true)
  const best = numericField(safeSnapshot, receipts, 'bestLap', nowMs, '--:--.---', displayBestLap)
  const gapAhead = numericField(safeSnapshot, receipts, 'gapAhead', nowMs, '--.--- S', (value) => `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(3)} S`)

  const deltaRaw = channelValue(safeSnapshot, 'delta')
  const deltaReceipt = receiptFor(receipts, 'delta', nowMs)
  const deltaUnavailable = typeof deltaRaw !== 'number' || !deltaReceipt.receipt || best.unavailable
  const deltaStale = !deltaUnavailable && (deltaReceipt.stale || best.stale)
  const deltaValue = deltaUnavailable || deltaStale ? '--.---' : displayDelta(deltaRaw)
  const delta = {
    ...field(deltaValue, deltaUnavailable ? null : deltaRaw, deltaStale, deltaUnavailable, deltaUnavailable || deltaStale ? 'muted' : deltaRaw < 0 ? 'good' : deltaRaw > 0 ? 'bad' : 'primary'),
    direction: deltaUnavailable || deltaStale ? 'flat' as const : deltaRaw < 0 ? 'down' as const : deltaRaw > 0 ? 'up' as const : 'flat' as const
  }

  const tyres = ([['LF', 'tyreLf'], ['RF', 'tyreRf'], ['LR', 'tyreLr'], ['RR', 'tyreRr']] as const).map(([corner, channel]) => {
    const tyre = numericField(safeSnapshot, receipts, channel, nowMs, '--', (value) => `${Math.round(value)}\u00B0`, '--', true)
    return { corner, ...tyre }
  })
  const pitRaw = channelValue(safeSnapshot, 'pitLimiter')
  const pitReceipt = receiptFor(receipts, 'pitLimiter', nowMs)
  const pitLimiter = typeof pitRaw !== 'boolean' || !pitReceipt.receipt || typeof pitReceipt.receipt.value !== 'boolean'
    ? { value: null, stale: false, unavailable: true }
    : { value: pitReceipt.stale ? pitReceipt.receipt.value : pitRaw, stale: pitReceipt.stale, unavailable: false }

  const rpmFresh = !rpm.stale && !rpm.unavailable && finiteNumber(safeSnapshot.maxRpm, Number.EPSILON)
  const rpmRatio = rpmFresh && typeof rpm.raw === 'number' ? rpm.raw / safeSnapshot.maxRpm! : null
  const shiftGear = !gear.stale && !gear.unavailable && typeof gear.raw === 'number' && gear.raw >= 1 && gear.raw <= 8 ? gear.raw : null
  const shiftThreshold = rc01ShiftThresholdForGear(shiftGear)

  return {
    speed, gear, rpm, tc, position, fuel, delta, best, gapAhead, tyres, pitLimiter,
    rpmRatio, rpmFresh, shiftGear, shiftThreshold,
    leds: buildRc01LedStates(rpmRatio, rpmFresh, false, shiftGear),
    criticalFresh: fresh
  }
}

export interface Rc01AlertState {
  overRev: { active: boolean; pendingSinceMs: number | null; recoverySinceMs: number | null }
  deltaCliff: { active: boolean; pendingSinceMs: number | null; baselineDelta: number | null }
  deltaZeroCross: { active: boolean; pendingSinceMs: number | null; pendingSign: -1 | 1 | null; lastNonZeroSign: -1 | 1 | null; minimumVisibleUntilMs: number }
  pitLimiter: { active: boolean; minimumVisibleUntilMs: number }
}

export const RC01_DELTA_ZERO_CROSS_DEBOUNCE_MS = 150
export const RC01_DELTA_ZERO_CROSS_MIN_VISIBLE_MS = 700

export function createRc01AlertState(): Rc01AlertState {
  return {
    overRev: { active: false, pendingSinceMs: null, recoverySinceMs: null },
    deltaCliff: { active: false, pendingSinceMs: null, baselineDelta: null },
    deltaZeroCross: { active: false, pendingSinceMs: null, pendingSign: null, lastNonZeroSign: null, minimumVisibleUntilMs: 0 },
    pitLimiter: { active: false, minimumVisibleUntilMs: 0 }
  }
}

export interface Rc01AlertInput {
  nowMs: number
  rpmRatio: number | null
  rpmFresh: boolean
  delta: number | null
  deltaTwoSecondsAgo: number | null
  pitLimiter: boolean | null
}

function cloneRc01AlertState(state: Rc01AlertState): Rc01AlertState {
  return {
    overRev: { ...state.overRev },
    deltaCliff: { ...state.deltaCliff },
    deltaZeroCross: { ...state.deltaZeroCross },
    pitLimiter: { ...state.pitLimiter }
  }
}

export function advanceRc01Alerts(state: Rc01AlertState, input: Rc01AlertInput): Rc01AlertState {
  const nowMs = finiteNumber(input.nowMs) ? input.nowMs : 0
  const next = cloneRc01AlertState(state)

  if (!input.rpmFresh || input.rpmRatio === null) next.overRev = { active: false, pendingSinceMs: null, recoverySinceMs: null }
  else if (next.overRev.active) {
    if (input.rpmRatio < 0.95) {
      const recoverySinceMs = next.overRev.recoverySinceMs ?? nowMs
      next.overRev.recoverySinceMs = recoverySinceMs
      if (nowMs - recoverySinceMs >= 250) next.overRev = { active: false, pendingSinceMs: null, recoverySinceMs: null }
    } else next.overRev.recoverySinceMs = null
  } else if (input.rpmRatio > 0.99) {
    const pendingSinceMs = next.overRev.pendingSinceMs ?? nowMs
    next.overRev.pendingSinceMs = pendingSinceMs
    if (nowMs - pendingSinceMs >= 60) next.overRev = { active: true, pendingSinceMs: null, recoverySinceMs: null }
  } else next.overRev.pendingSinceMs = null

  const comparable = input.delta !== null && input.deltaTwoSecondsAgo !== null
  const worsening = comparable && input.delta! - input.deltaTwoSecondsAgo! > 0.3
  if (!comparable) next.deltaCliff = { active: false, pendingSinceMs: null, baselineDelta: null }
  else if (next.deltaCliff.active) {
    if (next.deltaCliff.baselineDelta !== null && input.delta! - next.deltaCliff.baselineDelta <= 0.15) next.deltaCliff = { active: false, pendingSinceMs: null, baselineDelta: null }
  } else if (worsening) {
    next.deltaCliff.pendingSinceMs ??= nowMs
    next.deltaCliff.baselineDelta ??= input.deltaTwoSecondsAgo
    if (nowMs - next.deltaCliff.pendingSinceMs >= 500) next.deltaCliff = { active: true, pendingSinceMs: null, baselineDelta: next.deltaCliff.baselineDelta }
  } else next.deltaCliff = { active: false, pendingSinceMs: null, baselineDelta: null }

  if (input.delta === null) next.deltaZeroCross = { active: false, pendingSinceMs: null, pendingSign: null, lastNonZeroSign: null, minimumVisibleUntilMs: 0 }
  else {
    const sign = input.delta < 0 ? -1 : input.delta > 0 ? 1 : null
    if (sign !== null) {
      const prior = next.deltaZeroCross.lastNonZeroSign
      if (prior === null) next.deltaZeroCross.lastNonZeroSign = sign
      else if (prior === sign) {
        next.deltaZeroCross.pendingSinceMs = null
        next.deltaZeroCross.pendingSign = null
      } else {
        const pendingSinceMs = next.deltaZeroCross.pendingSign === sign ? next.deltaZeroCross.pendingSinceMs ?? nowMs : nowMs
        next.deltaZeroCross.pendingSign = sign
        next.deltaZeroCross.pendingSinceMs = pendingSinceMs
        if (nowMs - pendingSinceMs >= RC01_DELTA_ZERO_CROSS_DEBOUNCE_MS) {
          next.deltaZeroCross.active = true
          next.deltaZeroCross.lastNonZeroSign = sign
          next.deltaZeroCross.pendingSinceMs = null
          next.deltaZeroCross.pendingSign = null
          next.deltaZeroCross.minimumVisibleUntilMs = nowMs + RC01_DELTA_ZERO_CROSS_MIN_VISIBLE_MS
        }
      }
    }
    if (next.deltaZeroCross.active && nowMs >= next.deltaZeroCross.minimumVisibleUntilMs) next.deltaZeroCross.active = false
  }

  if (input.pitLimiter === null) next.pitLimiter = { active: false, minimumVisibleUntilMs: 0 }
  else if (input.pitLimiter) next.pitLimiter = { active: true, minimumVisibleUntilMs: Math.max(next.pitLimiter.minimumVisibleUntilMs, nowMs + 300) }
  else next.pitLimiter.active = nowMs < next.pitLimiter.minimumVisibleUntilMs
  return next
}

function rc01SampleDeltaForAlert(sample: Rc01AcceptedSample): number | null {
  return sample.delta !== null && sample.deltaFresh && sample.bestLap !== null && sample.bestLapFresh ? sample.delta : null
}

function rc01AlertInputForSample(sample: Rc01AcceptedSample, deltaTwoSecondsAgo: number | null): Rc01AlertInput {
  return {
    nowMs: sample.receivedAt,
    rpmRatio: sample.rpmRatio,
    rpmFresh: sample.rpmFresh,
    delta: rc01SampleDeltaForAlert(sample),
    deltaTwoSecondsAgo,
    pitLimiter: sample.pitLimiter !== null && sample.pitLimiterFresh ? sample.pitLimiter : null
  }
}

/** Finds the same baseline the old replay used, but only while accepting a new compact sample. */
function rc01DeltaTwoSecondsAgo(
  history: readonly Rc01AcceptedSample[],
  receivedAt: number,
  endExclusive = history.length
): number | null {
  for (let previous = endExclusive - 1; previous >= 0; previous -= 1) {
    const sample = history[previous]
    if (sample.receivedAt <= receivedAt - 2_000) return rc01SampleDeltaForAlert(sample)
  }
  return null
}

/** Verification helper for the compact ring. Rendering always reads incremental buffer state. */
export function replayRc01Alerts(history: readonly Rc01AcceptedSample[]): Rc01AlertState {
  let state = createRc01AlertState()
  const receipts = new Map<Rc01ChannelName, Rc01ChannelReceipt>()
  for (let index = 0; index < history.length; index += 1) {
    const sample = history[index]
    state = clearExpiredReceiptAlertContinuity(state, receipts, sample.receivedAt)
    state = advanceRc01Alerts(state, rc01AlertInputForSample(sample, rc01DeltaTwoSecondsAgo(history, sample.receivedAt, index)))
    if (sample.rpmRatio !== null && sample.rpmFresh) {
      receipts.set('rpm', { snapshotTimestamp: sample.timestamp, receivedAt: sample.receivedAt, value: sample.rpmRatio })
    }
    if (sample.delta !== null && sample.deltaFresh) {
      receipts.set('delta', { snapshotTimestamp: sample.timestamp, receivedAt: sample.receivedAt, value: sample.delta })
    }
    if (sample.bestLap !== null && sample.bestLapFresh) {
      receipts.set('bestLap', { snapshotTimestamp: sample.timestamp, receivedAt: sample.receivedAt, value: sample.bestLap })
    }
    if (sample.pitLimiter !== null && sample.pitLimiterFresh) {
      receipts.set('pitLimiter', { snapshotTimestamp: sample.timestamp, receivedAt: sample.receivedAt, value: sample.pitLimiter })
    }
  }
  return state
}

/** A stale/unavailable current channel can never leave its dependent alert latched. */
export function clearInvalidRc01CurrentAlerts(alerts: Rc01AlertState, model: Rc01DashboardModel): Rc01AlertState {
  return {
    ...alerts,
    overRev: model.rpmFresh ? alerts.overRev : { active: false, pendingSinceMs: null, recoverySinceMs: null },
    deltaCliff: !model.delta.unavailable && !model.delta.stale ? alerts.deltaCliff : { active: false, pendingSinceMs: null, baselineDelta: null },
    deltaZeroCross: !model.delta.unavailable && !model.delta.stale ? alerts.deltaZeroCross : { active: false, pendingSinceMs: null, pendingSign: null, lastNonZeroSign: null, minimumVisibleUntilMs: 0 },
    pitLimiter: !model.pitLimiter.unavailable && !model.pitLimiter.stale ? alerts.pitLimiter : { active: false, minimumVisibleUntilMs: 0 }
  }
}

export function rc01FieldDescription(label: string, value: Rc01Field): string {
  if (value.unavailable) return `${label} unavailable`
  if (value.stale) return /^[-.\u2014]+(?: S)?$/u.test(value.value) ? `${label} stale` : `${label} stale; last known value ${value.value}`
  return `${label} ${value.value}`
}

export function rc01LayoutForContentBox(width: number, height: number): 'native' | 'app' | 'compact' {
  const native = Math.abs(width - RC01_NATIVE_WIDTH_PX) <= RC01_NATIVE_TOLERANCE_PX &&
    Math.abs(height - RC01_NATIVE_HEIGHT_PX) <= RC01_NATIVE_TOLERANCE_PX
  if (native) return 'native'
  if (width >= RC01_APP_WIDTH_PX - RC01_NATIVE_TOLERANCE_PX && height >= RC01_APP_HEIGHT_PX - RC01_NATIVE_TOLERANCE_PX) return 'app'
  return 'compact'
}

export function rc01CompactModeForContentBox(width: number, height: number): Rc01CompactMode {
  const phone = finiteNumber(width, RC01_PHONE_MIN_WIDTH_PX) &&
    width <= RC01_PHONE_MAX_WIDTH_PX &&
    finiteNumber(height, RC01_PHONE_MIN_HEIGHT_PX) &&
    height / width >= 1.5
  return phone ? 'phone' : 'standard'
}

export interface Rc01PhoneGeometry {
  inset: number
  ledTop: number
  ledHeight: number
  heroTop: number
  heroHeight: number
  deltaTop: number
  deltaHeight: number
  statusTop: number
  statusHeight: number
  bottomInset: number
  toggleSize: number
}

/** Deterministic portrait layout shared by canonical phone captures and CSS variables. */
export function rc01PhoneGeometryForContentBox(width: number, height: number): Rc01PhoneGeometry | null {
  if (rc01CompactModeForContentBox(width, height) !== 'phone') return null
  const safeHeight = Math.round(height)
  const statusTop = Math.floor(safeHeight * 0.53)
  const bottomInset = 18
  return {
    inset: 12,
    ledTop: 12,
    ledHeight: 16,
    heroTop: 48,
    heroHeight: Math.floor(safeHeight * 0.25),
    deltaTop: Math.floor(safeHeight * 0.33),
    deltaHeight: Math.floor(safeHeight * 0.18),
    statusTop,
    statusHeight: safeHeight - statusTop - bottomInset,
    bottomInset,
    toggleSize: 44
  }
}

/** The trace is derived solely from the primitive compact history ring. */
export function rc01TraceValues(history: readonly Rc01AcceptedSample[]): readonly number[] {
  const values = history.flatMap((sample) => sample.delta !== null && sample.bestLap !== null ? [sample.delta] : [])
  if (values.length <= 12) return values
  return Array.from({ length: 12 }, (_, index) => values[Math.round(index * (values.length - 1) / 11)])
}
