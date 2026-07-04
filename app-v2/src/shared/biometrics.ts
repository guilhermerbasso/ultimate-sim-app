// Biometrics core — PURE, dependency-free analysis shared by the main module
// (HR data sources + IPC) and the renderer (BiometricsView + AR HUD). Nothing
// here touches Electron, the filesystem, BLE, the DOM or telemetry plumbing, so
// every function is deterministic and unit-testable with synthetic data.
//
// What lives here:
//   • The standard BLE Heart Rate Measurement (0x2A37) value parser + flags.
//   • A driving-intensity → target-heart-rate model used to drive the MOCK
//     source (and to label "how hard were you pushing").
//   • Correlation of heart rate against lap pace ("calmer is faster" vs
//     "harder is faster"), a 0..100 "calm under pressure" score, and stress
//     spike detection aligned to incidents / lap starts.
//   • An HRV-ish RMSSD helper for RR-interval streams (when the HRM provides
//     them) and a baseline-relative stress classifier for live colouring.

// ─── BLE Heart Rate Service (0x180D) / Heart Rate Measurement (0x2A37) ───────

/** 16-bit UUID of the standard BLE Heart Rate Service. */
export const BLE_HEART_RATE_SERVICE = 0x180d
/** 16-bit UUID of the Heart Rate Measurement characteristic (notify). */
export const BLE_HEART_RATE_MEASUREMENT = 0x2a37
/** 16-bit UUID of the Body Sensor Location characteristic (read). */
export const BLE_BODY_SENSOR_LOCATION = 0x2a38

/** Bit layout of the 0x2A37 first flags byte (Bluetooth GATT spec). */
export const HRM_FLAG = {
  /** 0 = Heart Rate is UINT8, 1 = UINT16. */
  valueFormatUint16: 1 << 0,
  /** Sensor Contact detected (only meaningful if support bit is set). */
  contactDetected: 1 << 1,
  /** Sensor Contact feature supported. */
  contactSupported: 1 << 2,
  /** Energy Expended field (UINT16, kJ) present. */
  energyExpended: 1 << 3,
  /** One or more RR-Interval values (UINT16, 1/1024 s) present. */
  rrInterval: 1 << 4
} as const

/** RR-Interval resolution per the spec: units of 1/1024 of a second. */
const RR_UNIT_MS = 1000 / 1024

/** Decoded Heart Rate Measurement notification. */
export interface HeartRateMeasurement {
  /** Beats per minute. */
  heartRate: number
  /** Whether the sensor reports it supports contact detection. */
  contactSupported: boolean
  /** Contact state — `undefined` when the sensor does not support it. */
  contactDetected: boolean | undefined
  /** Cumulative energy expended in kilojoules, when present. */
  energyExpendedKJ?: number
  /** RR-intervals converted to milliseconds (empty when absent). */
  rrIntervalsMs: number[]
  /** Raw flags byte, kept for diagnostics. */
  flags: number
}

type BleInput = DataView | ArrayBuffer | ArrayBufferView | ArrayLike<number>

/** Normalises the many shapes a BLE value can arrive in into a DataView. */
function toDataView(input: BleInput): DataView {
  if (input instanceof DataView) return input
  if (input instanceof ArrayBuffer) return new DataView(input)
  if (ArrayBuffer.isView(input)) {
    return new DataView(input.buffer, input.byteOffset, input.byteLength)
  }
  const bytes = Uint8Array.from(input as ArrayLike<number>, (value) => Number(value) & 0xff)
  return new DataView(bytes.buffer)
}

/**
 * Parses a standard BLE Heart Rate Measurement (0x2A37) characteristic value.
 *
 * Layout: [flags:u8][HR:u8|u16][energy:u16?][rr:u16*?] — all multi-byte fields
 * little-endian. Throws on an empty/short buffer so callers can surface a clear
 * "no data" error instead of silently reporting 0 bpm.
 */
export function parseHeartRateMeasurement(input: BleInput): HeartRateMeasurement {
  const view = toDataView(input)
  if (view.byteLength < 2) {
    throw new Error('Heart Rate Measurement value too short (need flags + at least 1 HR byte)')
  }

  const flags = view.getUint8(0)
  const uint16 = (flags & HRM_FLAG.valueFormatUint16) !== 0
  const contactSupported = (flags & HRM_FLAG.contactSupported) !== 0
  const contactDetected = contactSupported ? (flags & HRM_FLAG.contactDetected) !== 0 : undefined

  let offset = 1
  let heartRate: number
  if (uint16) {
    if (view.byteLength < offset + 2) throw new Error('Heart Rate Measurement truncated (UINT16 HR)')
    heartRate = view.getUint16(offset, true)
    offset += 2
  } else {
    heartRate = view.getUint8(offset)
    offset += 1
  }

  let energyExpendedKJ: number | undefined
  if ((flags & HRM_FLAG.energyExpended) !== 0 && view.byteLength >= offset + 2) {
    energyExpendedKJ = view.getUint16(offset, true)
    offset += 2
  }

  const rrIntervalsMs: number[] = []
  if ((flags & HRM_FLAG.rrInterval) !== 0) {
    while (offset + 2 <= view.byteLength) {
      rrIntervalsMs.push(round(view.getUint16(offset, true) * RR_UNIT_MS, 2))
      offset += 2
    }
  }

  return { heartRate, contactSupported, contactDetected, energyExpendedKJ, rrIntervalsMs, flags }
}

// ─── HRV (RR-interval) ───────────────────────────────────────────────────────

/**
 * RMSSD (root mean square of successive RR differences) in ms — the classic
 * short-window HRV metric. Higher RMSSD ≈ more parasympathetic / relaxed; a
 * collapsing RMSSD under load is a stress proxy. Returns `undefined` with fewer
 * than two intervals.
 */
export function rmssd(rrIntervalsMs: readonly number[]): number | undefined {
  const rr = rrIntervalsMs.filter((value) => Number.isFinite(value) && value > 0)
  if (rr.length < 2) return undefined
  let sumSq = 0
  for (let i = 1; i < rr.length; i += 1) {
    const diff = rr[i] - rr[i - 1]
    sumSq += diff * diff
  }
  return round(Math.sqrt(sumSq / (rr.length - 1)), 2)
}

/** Converts an instantaneous RR-interval (ms) to an instantaneous BPM. */
export function bpmFromRr(rrMs: number): number | undefined {
  if (!Number.isFinite(rrMs) || rrMs <= 0) return undefined
  return round(60000 / rrMs, 1)
}

// ─── Driving intensity → target heart rate (drives the MOCK source) ──────────

/** Telemetry-derived inputs to the intensity model (all optional/safe). */
export interface IntensityInputs {
  speedKmh?: number
  throttle?: number // 0..1
  brake?: number // 0..1
  rpm?: number
  maxRpm?: number
  latAccelG?: number
  longAccelG?: number
  steerAngleDeg?: number
  /** Cars within wheel-to-wheel proximity (radar), raises arousal. */
  nearbyCars?: number
  /** Under a local/full-course yellow. */
  yellowFlag?: boolean
  /** A fresh incident just happened this tick. */
  incident?: boolean
}

function unit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  return clamp(value, 0, 1)
}

/**
 * Maps live telemetry to a 0..1 "how hard is this moment" intensity. Blends
 * speed, combined G-load, braking effort, wheel-to-wheel proximity and a
 * yellow/incident arousal bump. Pure and monotonic so the mock HR curve tracks
 * the action and tests can assert ordering (hot lap > cruising > pit lane).
 */
export function drivingIntensity(input: IntensityInputs): number {
  const speed = unit((input.speedKmh ?? 0) / 300)
  const combinedG = Math.hypot(input.latAccelG ?? 0, input.longAccelG ?? 0)
  const grip = unit(combinedG / 2.5)
  const brake = unit(input.brake)
  const revShare = input.maxRpm && input.maxRpm > 0 ? unit((input.rpm ?? 0) / input.maxRpm) : 0
  const proximity = unit((input.nearbyCars ?? 0) / 2)
  const steer = unit(Math.abs(input.steerAngleDeg ?? 0) / 180)

  let intensity =
    0.26 * speed +
    0.28 * grip +
    0.16 * brake +
    0.12 * revShare +
    0.10 * proximity +
    0.08 * steer

  if (input.yellowFlag) intensity += 0.12
  if (input.incident) intensity += 0.35

  return round(clamp(intensity, 0, 1), 4)
}

/** Heart-rate envelope used to translate intensity into BPM. */
export interface HeartRateModelParams {
  /** Resting HR (engine off / menus). */
  restingBpm: number
  /** HR while cruising / low intensity behind the wheel. */
  baseDriveBpm: number
  /** Effective ceiling under maximum competitive load. */
  maxBpm: number
}

export const DEFAULT_HR_MODEL: HeartRateModelParams = {
  restingBpm: 64,
  baseDriveBpm: 98,
  maxBpm: 178
}

/**
 * Target BPM for a given driving intensity. `engaged=false` (in menus / not
 * connected) decays toward resting; otherwise interpolates baseDrive → max.
 * Deterministic — the mock source adds smoothing + noise on top of this.
 */
export function targetHeartRate(
  intensity: number,
  params: HeartRateModelParams = DEFAULT_HR_MODEL,
  engaged = true
): number {
  const i = clamp(intensity, 0, 1)
  if (!engaged) return params.restingBpm + i * (params.baseDriveBpm - params.restingBpm) * 0.4
  const span = Math.max(0, params.maxBpm - params.baseDriveBpm)
  // Slight ease-in so mid intensities don't peg HR near the ceiling.
  const shaped = i * i * 0.5 + i * 0.5
  return round(params.baseDriveBpm + shaped * span, 1)
}

// ─── Live stress classification (baseline-relative) ──────────────────────────

export type StressState = 'calm' | 'elevated' | 'stressed'

export interface StressReading {
  state: StressState
  /** BPM above the session baseline (can be negative when calmer than usual). */
  deltaBpm: number
}

/**
 * Classifies a live BPM against a rolling session baseline. `calm` (good) is the
 * ONLY cool/green state in the UI; elevated/stressed use warm chrome.
 */
export function classifyStress(
  bpm: number,
  baselineBpm: number,
  thresholds: { elevated?: number; stressed?: number } = {}
): StressReading {
  const elevated = thresholds.elevated ?? 10
  const stressed = thresholds.stressed ?? 22
  const deltaBpm = round(bpm - baselineBpm, 1)
  const state: StressState = deltaBpm >= stressed ? 'stressed' : deltaBpm >= elevated ? 'elevated' : 'calm'
  return { state, deltaBpm }
}

// ─── HR ↔ lap-pace correlation ───────────────────────────────────────────────

/** A timestamped heart-rate reading (t = epoch ms). */
export interface HrSample {
  t: number
  bpm: number
}

/** Boundaries of one completed lap within an HR time-series. */
export interface LapBoundary {
  lap: number
  startT: number
  endT: number
  lapTimeSec: number
}

/** Per-lap pace + biometric aggregate — the unit of correlation analysis. */
export interface LapBiometrics {
  lap: number
  lapTimeSec: number
  avgBpm: number
  maxBpm: number
}

/**
 * Buckets a raw HR series into per-lap aggregates using lap boundaries (from the
 * lap-timing module). Laps with no HR samples in range are skipped.
 */
export function aggregateLapBiometrics(
  series: readonly HrSample[],
  boundaries: readonly LapBoundary[]
): LapBiometrics[] {
  const sorted = [...series].sort((a, b) => a.t - b.t)
  const out: LapBiometrics[] = []
  for (const boundary of boundaries) {
    if (!(boundary.lapTimeSec > 0)) continue
    let sum = 0
    let count = 0
    let max = 0
    for (const sample of sorted) {
      if (sample.t < boundary.startT) continue
      if (sample.t > boundary.endT) break
      if (!Number.isFinite(sample.bpm) || sample.bpm <= 0) continue
      sum += sample.bpm
      count += 1
      if (sample.bpm > max) max = sample.bpm
    }
    if (count === 0) continue
    out.push({ lap: boundary.lap, lapTimeSec: round(boundary.lapTimeSec, 3), avgBpm: round(sum / count, 1), maxBpm: round(max, 1) })
  }
  return out
}

export type PaceHrInterpretation = 'calmer-is-faster' | 'harder-is-faster' | 'inconclusive'

export interface PaceHrCorrelation {
  /** Number of laps used. */
  samples: number
  /** Pearson r between avg BPM and lap time, in [-1, 1]. */
  pearson: number
  /** Regression slope: Δbpm per +1s of lap time. */
  bpmPerSecond: number
  interpretation: PaceHrInterpretation
}

/**
 * Correlates per-lap heart rate with lap time. Positive r → higher HR on SLOWER
 * laps ("calmer is faster": stress costs pace). Negative r → higher HR on FASTER
 * laps ("harder is faster": you find time by pushing). Needs ≥3 laps with pace
 * variance, else `inconclusive`.
 */
export function correlatePaceHr(laps: readonly LapBiometrics[]): PaceHrCorrelation {
  const valid = laps.filter((lap) => lap.lapTimeSec > 0 && Number.isFinite(lap.avgBpm))
  if (valid.length < 3) {
    return { samples: valid.length, pearson: 0, bpmPerSecond: 0, interpretation: 'inconclusive' }
  }
  const paces = valid.map((lap) => lap.lapTimeSec)
  const hrs = valid.map((lap) => lap.avgBpm)
  const r = pearson(paces, hrs)
  const slope = regressionSlope(paces, hrs)
  let interpretation: PaceHrInterpretation = 'inconclusive'
  if (r >= 0.3) interpretation = 'calmer-is-faster'
  else if (r <= -0.3) interpretation = 'harder-is-faster'
  return {
    samples: valid.length,
    pearson: round(r, 3),
    bpmPerSecond: round(slope, 2),
    interpretation
  }
}

export interface CalmUnderPressure {
  /** 0..100 — higher means you stay composed while setting your best laps. */
  score: number
  /** Mean BPM on the fastest third of laps. */
  fastLapBpm: number
  /** Mean BPM on the slowest third of laps. */
  slowLapBpm: number
  /** Coefficient of variation of per-lap BPM (lower = steadier). */
  bpmCoefficientOfVariation: number
}

/**
 * "Calm under pressure" score. Rewards (a) NOT spiking your HR on your fastest
 * laps relative to your slowest, and (b) overall HR steadiness across the run.
 * Drivers who go quick without their HR running away score high. Needs ≥3 laps.
 */
export function calmUnderPressure(laps: readonly LapBiometrics[]): CalmUnderPressure | null {
  const valid = laps.filter((lap) => lap.lapTimeSec > 0 && Number.isFinite(lap.avgBpm))
  if (valid.length < 3) return null

  const byPace = [...valid].sort((a, b) => a.lapTimeSec - b.lapTimeSec)
  const third = Math.max(1, Math.floor(byPace.length / 3))
  const fast = byPace.slice(0, third)
  const slow = byPace.slice(byPace.length - third)
  const fastLapBpm = mean(fast.map((lap) => lap.avgBpm))
  const slowLapBpm = mean(slow.map((lap) => lap.avgBpm))

  const allBpm = valid.map((lap) => lap.avgBpm)
  const avg = mean(allBpm)
  const cov = avg > 0 ? std(allBpm) / avg : 0

  // Composure: staying calm (or calmer) on fast laps. (slow - fast) > 0 is good.
  const composure = clamp(50 + (slowLapBpm - fastLapBpm) * 4, 0, 100)
  // Steadiness: penalise a jumpy HR trace (cov ~0.10 → ~0 steadiness points).
  const steadiness = clamp(100 - cov * 700, 0, 100)
  const score = round(0.65 * composure + 0.35 * steadiness, 1)

  return {
    score,
    fastLapBpm: round(fastLapBpm, 1),
    slowLapBpm: round(slowLapBpm, 1),
    bpmCoefficientOfVariation: round(cov, 4)
  }
}

// ─── Stress spikes aligned to incidents / laps ───────────────────────────────

export type BioEventKind = 'lap' | 'incident' | 'flag' | 'session'

/** An event to align stress spikes against. */
export interface BioEvent {
  t: number
  kind: BioEventKind
  label?: string
  lap?: number
}

export interface StressSpike {
  /** Time of the peak BPM within the spike. */
  t: number
  /** Peak BPM. */
  peakBpm: number
  /** Trailing baseline at the spike. */
  baselineBpm: number
  /** peakBpm − baselineBpm. */
  deltaBpm: number
}

export interface StressSpikeOptions {
  /** Trailing window for the baseline median, ms (default 30 000). */
  baselineWindowMs?: number
  /** BPM above baseline to count as a spike (default 12). */
  thresholdBpm?: number
  /** Samples within this gap are merged into one spike (default 5 000 ms). */
  mergeGapMs?: number
}

/**
 * Detects stress spikes: BPM excursions above a trailing-median baseline.
 * Consecutive over-threshold samples are merged into a single spike at their
 * peak. Pure and deterministic (no noise) for testing.
 */
export function detectStressSpikes(series: readonly HrSample[], options: StressSpikeOptions = {}): StressSpike[] {
  const windowMs = options.baselineWindowMs ?? 30_000
  const threshold = options.thresholdBpm ?? 12
  const mergeGapMs = options.mergeGapMs ?? 5_000

  const samples = [...series].filter((s) => Number.isFinite(s.t) && Number.isFinite(s.bpm) && s.bpm > 0).sort((a, b) => a.t - b.t)
  const spikes: StressSpike[] = []
  let open: { startT: number; lastT: number; peak: StressSpike } | null = null

  const flush = (): void => {
    if (open) {
      spikes.push(open.peak)
      open = null
    }
  }

  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i]
    const baseline = trailingMedian(samples, i, sample.t - windowMs)
    if (baseline === undefined) continue
    const delta = sample.bpm - baseline
    if (delta >= threshold) {
      if (open && sample.t - open.lastT > mergeGapMs) flush()
      if (!open) {
        open = { startT: sample.t, lastT: sample.t, peak: spikeOf(sample, baseline, delta) }
      } else {
        open.lastT = sample.t
        if (sample.bpm > open.peak.peakBpm) open.peak = spikeOf(sample, baseline, delta)
      }
    } else if (open && sample.t - open.lastT > mergeGapMs) {
      flush()
    }
  }
  flush()
  return spikes
}

export interface AlignedStressSpike extends StressSpike {
  /** Nearest event within tolerance, or null when the spike stands alone. */
  event: BioEvent | null
  /** Signed ms from spike peak to the event (positive = spike after event). */
  offsetMs: number | null
}

/**
 * Attaches the nearest event (incident / lap start / flag) to each spike within
 * `toleranceMs` (default 8 000). This is how "stress spikes aligned to incidents
 * / laps" is surfaced to the driver.
 */
export function alignSpikesToEvents(
  spikes: readonly StressSpike[],
  events: readonly BioEvent[],
  toleranceMs = 8_000
): AlignedStressSpike[] {
  const sortedEvents = [...events].sort((a, b) => a.t - b.t)
  return spikes.map((spike) => {
    let best: BioEvent | null = null
    let bestAbs = Number.POSITIVE_INFINITY
    for (const event of sortedEvents) {
      const abs = Math.abs(spike.t - event.t)
      if (abs < bestAbs) {
        bestAbs = abs
        best = event
      }
    }
    if (best && bestAbs <= toleranceMs) {
      return { ...spike, event: best, offsetMs: round(spike.t - best.t, 0) }
    }
    return { ...spike, event: null, offsetMs: null }
  })
}

// ─── small numeric helpers (pure) ────────────────────────────────────────────

function spikeOf(sample: HrSample, baseline: number, delta: number): StressSpike {
  return { t: sample.t, peakBpm: round(sample.bpm, 1), baselineBpm: round(baseline, 1), deltaBpm: round(delta, 1) }
}

/** Median BPM of samples in [minT, index] (inclusive of the current sample). */
function trailingMedian(samples: readonly HrSample[], index: number, minT: number): number | undefined {
  const window: number[] = []
  for (let j = index; j >= 0; j -= 1) {
    if (samples[j].t < minT) break
    window.push(samples[j].bpm)
  }
  if (window.length < 3) return undefined
  return median(window)
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function round(value: number, digits = 3): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function std(values: readonly number[]): number {
  if (values.length < 2) return 0
  const avg = mean(values)
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** Pearson correlation coefficient; 0 when either series has no variance. */
export function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return 0
  const mx = mean(xs.slice(0, n))
  const my = mean(ys.slice(0, n))
  let num = 0
  let dx2 = 0
  let dy2 = 0
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    num += dx * dy
    dx2 += dx * dx
    dy2 += dy * dy
  }
  if (dx2 === 0 || dy2 === 0) return 0
  return num / Math.sqrt(dx2 * dy2)
}

/** Ordinary-least-squares slope dy/dx; 0 when x has no variance. */
function regressionSlope(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return 0
  const mx = mean(xs.slice(0, n))
  const my = mean(ys.slice(0, n))
  let num = 0
  let den = 0
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx
    num += dx * (ys[i] - my)
    den += dx * dx
  }
  if (den === 0) return 0
  return num / den
}

// ─── IPC contract (channels + payloads) shared by main + renderer ────────────

export type HeartRateSourceKind = 'mock' | 'ble'

export interface BioStatus {
  running: boolean
  sourceKind: HeartRateSourceKind
  /** True only when a REAL BLE HRM is feeding samples (mock is always false). */
  hardwareConnected: boolean
  bpm?: number
  state?: StressState
  baselineBpm?: number
  sampleCount: number
  sessionId?: string
  /** Set when the BLE seam has no live feed yet (renderer pairing pending). */
  note?: string
}

/** Broadcast on every HR tick (≈1 Hz) for live readouts + the AR HUD. */
export interface BioLiveSample {
  t: number
  bpm: number
  source: HeartRateSourceKind
  state: StressState
  baselineBpm: number
  /** 0..1 driving intensity (mock model); omitted for real BLE. */
  intensity?: number
  rrMs?: number[]
}

/** Full analysis payload returned by `bio:series` for the config view. */
export interface BioSeriesResult {
  status: BioStatus
  samples: HrSample[]
  laps: LapBiometrics[]
  correlation: PaceHrCorrelation | null
  calm: CalmUnderPressure | null
  spikes: AlignedStressSpike[]
}

/** Lightweight persisted summary of a past biometrics session. */
export interface BioSessionSummary {
  id: string
  startedAt: number
  endedAt: number
  source: HeartRateSourceKind
  sampleCount: number
  avgBpm: number
  maxBpm: number
  laps: number
  calmScore?: number
  correlation?: PaceHrInterpretation
}

export const BIO_CHANNELS = {
  /** invoke → BioStatus */
  status: 'bio:status',
  /** invoke(sourceKind?: HeartRateSourceKind) → BioStatus */
  start: 'bio:start',
  /** invoke → BioStatus */
  stop: 'bio:stop',
  /** invoke → BioSeriesResult */
  series: 'bio:series',
  /** invoke → BioSessionSummary[] */
  sessions: 'bio:sessions',
  /** invoke(bytes: number[]) → BioStatus — renderer Web Bluetooth feeds 0x2A37 */
  bleValue: 'bio:bleValue',
  /** broadcast → BioLiveSample */
  sample: 'bio:sample',
  /** broadcast → BioStatus */
  update: 'bio:update'
} as const

export type BioChannel = (typeof BIO_CHANNELS)[keyof typeof BIO_CHANNELS]
