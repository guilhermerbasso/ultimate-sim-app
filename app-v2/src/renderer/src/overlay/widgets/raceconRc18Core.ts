import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import {
  type Rc01ChannelName,
  type Rc01ChannelReceipt,
  type Rc01CompactMode,
  type Rc01Field,
  rc01CompactModeForContentBox,
  rc01LayoutForContentBox,
  rc01MonotonicNow,
  rc01ReceiptAgeMs
} from './raceconRc01Core'
import {
  RC02_LAP_CLOCK_RESTART_TOLERANCE_SEC,
  RC02_SECTOR_BOUNDARIES,
  Rc02SectorTracker
} from './raceconRc02Core'

/**
 * RaceCon RC-18 "Split Test — Setup A/B Practice Comparison", concept signature
 * `setup-ab-mirror-split-compare`.
 *
 * Governed reference: `rc18-attempt004-governed-800x480.png`, approved on attempt-004 after
 * re-adjudication (attempts 005 and 006 were built from 004 and both regressed).
 *
 * This module owns ONLY what is specific to RC-18. Everything else is imported:
 *
 * - `Rc01LiveTelemetryBuffer` (used by the widget) — live-only ingest, identity binding,
 *   mock/replay refusal, out-of-order and same-timestamp guards, StrictMode-safe commit.
 * - `createRc01ChannelReceipts` / `rc01ReceiptAgeMs` — channel freshness.
 * - `rc01LayoutForContentBox` / `rc01CompactModeForContentBox` — the family breakpoints.
 * - `Rc02SectorTracker` — RC-02 already measures sector splits between OBSERVED lap-distance
 *   crossings and refuses to archive a lap unless all three sectors were genuinely measured.
 *   RC-18 needs exactly that guarantee, so it reuses the tracker rather than forking it.
 *
 * The mirror is the payload. Every geometry helper below is arithmetic on packet 11.1 / 12.1
 * coordinates (normative override NO-3: never trace the reference render), and the A and B
 * halves are derived from ONE shared pair list so structural symmetry cannot drift.
 */

// ------------------------------------------------------------------ packet 11.3 colour tokens

/** Packet 11.3. `normal` and `danger` belong to the alert layer and are silent by default. */
export const RC18_TOKENS = Object.freeze({
  bg: '#0C0E11',
  panel: '#161A20',
  primary: '#E8ECEF',
  secondary: '#8B95A0',
  info: '#4FB0E0',
  normal: '#52C07A',
  caution: '#F0B83A',
  danger: '#F0533E',
  signature: '#B0A0FF'
})

export type Rc18Side = 'a' | 'b'

/** Packet 11.3 / 20: A is cyan `info`, B is violet `signature`, and the tokens never swap. */
export const RC18_SIDE_TOKENS: Readonly<Record<Rc18Side, string>> = Object.freeze({
  a: RC18_TOKENS.info,
  b: RC18_TOKENS.signature
})

/**
 * Normative override NO-6. Packet 11.3 demands "distinct labels and patterns" so A and B stay
 * separable without colour. The approved render carries it as identity LINE COUNT — one band
 * for A, two for B — after a dash-count pattern failed to hold in three consecutive renders.
 */
export const RC18_SIDE_LINE_BANDS: Readonly<Record<Rc18Side, number>> = Object.freeze({ a: 1, b: 2 })

export const RC18_SIDE_LABELS: Readonly<Record<Rc18Side, string>> = Object.freeze({
  a: 'SETUP A',
  b: 'SETUP B'
})

// ------------------------------------------------------------- packet 11.2 typographic ladder

/**
 * Normative override NO-1 and NO-5. Packet 11.2 names four steps and does not bind them to
 * numerals; the render then compressed ranks 2-4 into 1 px of each other. The ladder is taken
 * from the packet arithmetic, never from the picture, and the 22 px secondary step is an
 * explicit addition documented in NO-5.
 */
export const RC18_TYPE_SCALE_PX = Object.freeze({
  verdict: 44,
  sector: 34,
  summary: 28,
  secondary: 22,
  label: 16
})

/** Ranked largest first, no ties. Asserted by the suite with at least 8 % between neighbours. */
export const RC18_TYPE_RANKS = Object.freeze([
  'verdict',
  'sector',
  'summary',
  'secondary',
  'label'
] as const)

export type Rc18TypeRank = (typeof RC18_TYPE_RANKS)[number]

/** 1 cqw of the 800 px native canvas. The ladder is expressed in cqw so it scales, not jumps. */
export const RC18_CQW_PX = 8

export function rc18TypeScaleCqw(px: number): number {
  return px / RC18_CQW_PX
}

// ----------------------------------------------------------- packet 15 alert numerics (gap G4)

/**
 * The packet's alert table publishes no numbers at all: "noise threshold", "differs beyond
 * band" and "computed on matched laps" are unimplementable as written (brief gap G4). These
 * are the values the approved frame was adjudicated against, published here as the binding.
 */
export const RC18_SECTOR_NOISE_SEC = 0.05
/** Hysteresis, so a delta sitting exactly on the noise threshold cannot chatter the highlight. */
export const RC18_SECTOR_NOISE_HYSTERESIS_SEC = 0.01
export const RC18_BALANCE_BAND = 0.15
export const RC18_BALANCE_BAND_HYSTERESIS = 0.03
/** A recomputed match must stay visible long enough to be read before it can be replaced. */
export const RC18_ALERT_MIN_VISIBLE_MS = 700

/** Normative override NO-2: the delta bar is arithmetic, never eyeballed off the render. */
export const RC18_SPINE_FULL_SCALE_SEC = 0.32
export const RC18_SPINE_HALF_SPAN_NATIVE_PX = 76
export const RC18_SPINE_NATIVE_WIDTH_PX = 168
export const RC18_SPINE_HALF_SPAN_APP_PX = 152
export const RC18_SPINE_APP_WIDTH_PX = 336

/**
 * 76/168 and 152/336 are the SAME fraction, so one constant serves both canvases and the two
 * halves of the spine are provably equal at every breakpoint. This is the shared axis.
 */
export const RC18_SPINE_HALF_SPAN_PCT = (RC18_SPINE_HALF_SPAN_NATIVE_PX / RC18_SPINE_NATIVE_WIDTH_PX) * 100

/** The mirror axis, as a percentage of the widget width. Both canvases put it dead centre. */
export const RC18_MIRROR_AXIS_PCT = 50

// -------------------------------------------------------------------- measurement definitions

export const RC18_CORNERS = Object.freeze(['lf', 'rf', 'lr', 'rr'] as const)
export type Rc18Corner = (typeof RC18_CORNERS)[number]

export const RC18_AXLES = Object.freeze(['frt', 'rear'] as const)
export type Rc18Axle = (typeof RC18_AXLES)[number]

export const RC18_AXLE_CORNERS: Readonly<Record<Rc18Axle, readonly Rc18Corner[]>> = Object.freeze({
  frt: ['lf', 'rf'],
  rear: ['lr', 'rr']
})

/** A timing feed quieter than this can no longer accept new matched laps. */
export const RC18_MATCH_FEED_STALE_MS = 1_000
/** Packet 16: tyre and brake sensors are 200 ms channels; speed is a 100 ms channel. */
export const RC18_CHANNEL_STALE_MS = Object.freeze({
  sector: RC18_MATCH_FEED_STALE_MS,
  delta: 500,
  tyre: 200,
  brake: 200,
  speed: 100,
  balance: 200
})
export type Rc18ChannelName = keyof typeof RC18_CHANNEL_STALE_MS

/** How many matched laps stay available for re-matching before the oldest is dropped. */
export const RC18_RUN_HISTORY_LIMIT = 8

/**
 * Balance index gates (brief gap G10 asks for the range and the convention; here it is).
 *
 * The app has no balance channel. It has `steerAngleDeg`, `yawRateRadSec` and `speedKmh`, and
 * understeer is by definition the FALL of yaw gain with speed, so the index is measured as the
 * self-normalised drop in yaw gain between the slow and fast halves of a lap's cornering
 * samples. No wheelbase, steering ratio or any other vehicle constant is assumed, because
 * assuming one would be inventing a channel.
 *
 *   gain(v) = |yawRate| / (|steerRad| * v)
 *   index   = (gainSlowHalf - gainFastHalf) / gainSlowHalf, clamped to [-1, 1]
 *
 * index > 0 understeer (UND), index < 0 oversteer (OVR), 0 neutral. Dimensionless.
 */
export const RC18_BALANCE_MIN_SPEED_KMH = 40
export const RC18_BALANCE_MIN_STEER_DEG = 3
export const RC18_BALANCE_MIN_SAMPLES = 24
export const RC18_BALANCE_MIN_SPEED_SPREAD_KMH = 20

/** App-only A/B speed trace: samples binned by lap distance, never interpolated across a gap. */
export const RC18_TRACE_BINS = 96

export const RC18_BASELINE_LOCK_EVENT = 'racecon:rc18-baseline'
export type Rc18BaselineCommand = 'lock' | 'release' | 'match'

/**
 * Packet 11.5 wants the matched laps toggled and a setup locked as the baseline. Packet 13
 * lists the controls and packet 11.1 / 12.1 give them no zone anywhere (brief gap G6), so the
 * command arrives as a window event instead of an invented on-screen control.
 */
export function rc18BaselineCommandFromEvent(detail: unknown): Rc18BaselineCommand | null {
  if (detail === 'lock' || detail === 'release' || detail === 'match') return detail
  if (detail && typeof detail === 'object' && 'command' in detail) {
    return rc18BaselineCommandFromEvent((detail as { command: unknown }).command)
  }
  return null
}

// -------------------------------------------------------------------------- packet omissions

/**
 * Every place the packet asks for something no channel or no zone can lawfully supply. The
 * structure is still rendered where one exists; the value is the honest empty state. Nothing
 * in this table is estimated, mirrored or back-filled, and no packet file was modified.
 */
export const RC18_PACKET_OMISSIONS = Object.freeze({
  configurationIdentityChannel:
    'packet 6/10 compares two setups; no channel identifies a car configuration, so A is a LOCKED matched lap and B the latest matched lap from the same live stream, never two simultaneous cars',
  sectorSplitChannel:
    'packet 16 "Timing sector feed": no such channel exists, so splits are measured between observed lap-distance crossings (RC-02 tracker) and a lap is matched only when all three sectors were genuinely measured',
  deltaToBestZone:
    'packet 10 makes delta-to-best primary and 11.1/12.1 give it no zone at all (gap G1); it is granted an explicit row at the top of each column on every canvas',
  deltaToBestLapTrigger:
    'packet 16 wants a lap-trigger delta; the app exposes only a rolling deltaToBestSec, so the matched lap keeps the last value observed before its start-finish crossing and dashes without a stored best',
  balanceRangeConvention:
    'packet 16 names a balance index with no range and no sign convention (gap G10); published here as the self-normalised yaw-gain drop over a lap, positive UND, negative OVR, clamped to [-1, 1]',
  appStabilityZone:
    'packet 12.1 drops the stability zone that 11.1 grants the primary balance channel (gap G2); it is nested in the base of the widened 1024x600 spine instead of being deleted',
  stabilityZoneOverlap:
    'packet 11.1 puts the stability row entirely inside the verdict spine (gap G3); it is declared a nested sub-zone and the delta stack is capped short of it with a 4 px gutter',
  stabilityMinSpeedBinding:
    'packet 15 says the stability alert watches "balance/min-speed"; the approved frame is SILENT with a 6 km/h min-speed gap, so the alert binds to the balance index only',
  alertNumerics:
    'packet 15 publishes no numbers for "noise threshold", "beyond band" or the debounce column (gap G4); the adjudicated values are bound here as 0.050 s, 0.15 index and a recompute-driven latch',
  brakeAxleAggregation:
    'packet 16 says "per axle/corner" and the app supplies per-corner brakeTempC, so an axle reads the hotter measured corner and requires BOTH corners; one sensor alone dashes as INCOMPARABLE',
  tyreWindowSampling:
    'packet 11.1 asks for a tyre/brake WINDOW and packet 16 supplies an instantaneous per-corner temperature, so the matched lap carries the measured peak over that lap and never an estimate',
  bestLapAndFuelZone:
    'packet 16 lists best lap and fuel per lap and 11.1/12.1 give neither a zone on either canvas (gap G7); best lap stays a reference-only gate for delta-to-best and neither is rendered',
  speedNativeZone:
    'packet 16 lists speed and only 12.1 hosts it, in the app-only A/B trace (gap G9); the 800x480 canvas therefore carries no speed readout at all',
  rpmComparisonRow:
    'packet 11.4 promises an RPM comparison row, packet 16 defines no RPM channel and no zone hosts one (gap G8); no RPM, LED or shift element is rendered anywhere',
  perCornerDifferenceTable:
    'packet 12 prose promises a per-corner difference table that 12.1 gives no zone (gap G5); the per-corner difference stays inside the mirrored corner rows rather than inventing a table',
  matchLapControlZone:
    'packet 13 lists match-lap / baseline controls that 11.1 and 12.1 give no zone (gap G6); the lock, release and re-match commands arrive as a window event, not an invented on-screen control'
})

// ---------------------------------------------------------------------------- small utilities

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

function field(
  value: string,
  raw: number | string | null,
  stale = false,
  unavailable = false,
  tone: Rc01Field['tone'] = 'primary'
): Rc01Field {
  return { value, raw, stale, unavailable, tone }
}

const DASH = '--'
const DASH_TIME = '--.---'

/**
 * Signed seconds, always 6 characters or fewer so a 44 px numeral cannot outgrow the spine.
 * A magnitude past the display ceiling is FLAGGED rather than rounded into a plausible lie.
 */
export function rc18SignedSeconds(value: number | null, digits = 3): string {
  if (!finite(value)) return digits === 3 ? DASH_TIME : DASH
  const sign = value > 0 ? '+' : value < 0 ? '\u2212' : '+'
  const magnitude = Math.abs(value)
  if (magnitude >= 10) return `${sign}9.99+`
  return `${sign}${magnitude.toFixed(digits)}`
}

export function rc18ClampsDisplay(value: number | null): boolean {
  return finite(value) && Math.abs(value) >= 10
}

export function rc18Seconds(value: number | null): string {
  return finite(value) && value > 0 ? value.toFixed(3) : DASH_TIME
}

export function rc18Integer(value: number | null): string {
  return finite(value) ? String(Math.round(value)) : DASH
}

export function rc18BalanceText(value: number | null): string {
  if (!finite(value)) return DASH
  const word = value > 0 ? 'UND' : value < 0 ? 'OVR' : 'NEU'
  return `${Math.abs(value).toFixed(2)} ${word}`
}

export function rc18Percent(value: number): string {
  return `${Number(value.toFixed(4))}%`
}

// ------------------------------------------------------------------ measured matched-lap runs

export interface Rc18RunTrace {
  /** One bin per `RC18_TRACE_BINS`; null where the lap produced no sample in that bin. */
  readonly speedKmh: readonly (number | null)[]
}

export interface Rc18Run {
  readonly lapOrdinal: number
  readonly recordedAtMs: number
  readonly sectorsSec: readonly (number | null)[]
  readonly totalSec: number | null
  readonly deltaToBestSec: number | null
  readonly minSpeedKmh: number | null
  readonly balanceIndex: number | null
  readonly balanceSamples: number
  readonly tyrePeakC: Readonly<Record<Rc18Corner, number | null>>
  readonly brakePeakC: Readonly<Record<Rc18Corner, number | null>>
  readonly trace: Rc18RunTrace
}

export interface Rc18RunSample {
  lapDistPct: number | null
  currentLapTimeSec: number | null
  speedKmh: number | null
  deltaToBestSec: number | null
  bestLapTimeSec: number | null
  steerAngleDeg: number | null
  yawRateRadSec: number | null
  tyreC: Readonly<Record<Rc18Corner, number | null>>
  brakeC: Readonly<Record<Rc18Corner, number | null>>
  receivedAt: number
}

interface BalanceSample {
  gain: number
  speedKmh: number
}

interface RunAccumulator {
  minSpeedKmh: number | null
  deltaToBestSec: number | null
  bestLapTimeSec: number | null
  tyrePeakC: Record<Rc18Corner, number | null>
  brakePeakC: Record<Rc18Corner, number | null>
  balance: BalanceSample[]
  trace: (number | null)[]
  samples: number
}

function emptyCornerMap(): Record<Rc18Corner, number | null> {
  return { lf: null, rf: null, lr: null, rr: null }
}

function emptyAccumulator(): RunAccumulator {
  return {
    minSpeedKmh: null,
    deltaToBestSec: null,
    bestLapTimeSec: null,
    tyrePeakC: emptyCornerMap(),
    brakePeakC: emptyCornerMap(),
    balance: [],
    trace: new Array<number | null>(RC18_TRACE_BINS).fill(null),
    samples: 0
  }
}

/**
 * The self-normalised balance index. Returns null unless the lap genuinely produced enough
 * cornering samples across a wide enough speed spread to separate a slow half from a fast one;
 * a lap that never turned, or that ran at one speed, has no measurable balance and must dash.
 */
export function rc18BalanceIndexFromSamples(samples: readonly BalanceSample[]): number | null {
  if (samples.length < RC18_BALANCE_MIN_SAMPLES) return null
  const sorted = [...samples].sort((left, right) => left.speedKmh - right.speedKmh)
  const spread = sorted[sorted.length - 1].speedKmh - sorted[0].speedKmh
  if (spread < RC18_BALANCE_MIN_SPEED_SPREAD_KMH) return null

  const half = Math.floor(sorted.length / 2)
  const slow = sorted.slice(0, half)
  const fast = sorted.slice(sorted.length - half)
  if (slow.length === 0 || fast.length === 0) return null

  const mean = (rows: readonly BalanceSample[]): number =>
    rows.reduce((sum, row) => sum + row.gain, 0) / rows.length
  const slowGain = mean(slow)
  const fastGain = mean(fast)
  if (!(slowGain > 0)) return null

  return clamp((slowGain - fastGain) / slowGain, -1, 1)
}

/**
 * Records one `Rc18Run` per MATCHED lap. A lap is matched only when RC-02's tracker archives
 * it, which happens only when all three sectors were measured between observed crossings, so
 * an out-lap, a mid-lap mount or a pit reset can never enter the comparison.
 *
 * Clone-then-commit, exactly like `Rc01LiveTelemetryBuffer`, so a StrictMode double render or
 * an abandoned concurrent render cannot advance the recorded history.
 */
export class Rc18RunRecorder {
  private tracker = new Rc02SectorTracker()
  private accumulator = emptyAccumulator()
  private runs: Rc18Run[] = []
  private lastLapDistPct: number | null = null
  private lastLapTimeSec: number | null = null
  private lastSampleAtMs: number | null = null
  private hasFeed = false

  clone(): Rc18RunRecorder {
    const next = new Rc18RunRecorder()
    next.tracker = this.tracker.clone()
    next.accumulator = {
      ...this.accumulator,
      tyrePeakC: { ...this.accumulator.tyrePeakC },
      brakePeakC: { ...this.accumulator.brakePeakC },
      balance: [...this.accumulator.balance],
      trace: [...this.accumulator.trace]
    }
    next.runs = [...this.runs]
    next.lastLapDistPct = this.lastLapDistPct
    next.lastLapTimeSec = this.lastLapTimeSec
    next.lastSampleAtMs = this.lastSampleAtMs
    next.hasFeed = this.hasFeed
    return next
  }

  /** A refused snapshot, a source change or a session change invalidates every matched lap. */
  reset(): void {
    this.tracker.reset()
    this.accumulator = emptyAccumulator()
    this.runs = []
    this.lastLapDistPct = null
    this.lastLapTimeSec = null
    this.lastSampleAtMs = null
    this.hasFeed = false
  }

  private seal(lapOrdinal: number, sectorsSec: readonly (number | null)[], receivedAt: number): void {
    const accumulator = this.accumulator
    const totalSec = sectorsSec.every(finite)
      ? (sectorsSec as readonly number[]).reduce((sum, value) => sum + value, 0)
      : null
    // Packet 16: a delta is only shown against a REAL stored best. No best, no delta.
    const deltaToBestSec =
      finite(accumulator.deltaToBestSec) && finite(accumulator.bestLapTimeSec) && accumulator.bestLapTimeSec > 0
        ? accumulator.deltaToBestSec
        : null
    this.runs = [
      {
        lapOrdinal,
        recordedAtMs: receivedAt,
        sectorsSec: [...sectorsSec],
        totalSec,
        deltaToBestSec,
        minSpeedKmh: accumulator.minSpeedKmh,
        balanceIndex: rc18BalanceIndexFromSamples(accumulator.balance),
        balanceSamples: accumulator.balance.length,
        tyrePeakC: { ...accumulator.tyrePeakC },
        brakePeakC: { ...accumulator.brakePeakC },
        trace: { speedKmh: [...accumulator.trace] }
      },
      ...this.runs
    ].slice(0, RC18_RUN_HISTORY_LIMIT)
    this.accumulator = emptyAccumulator()
  }

  private accumulate(sample: Rc18RunSample): void {
    const accumulator = this.accumulator
    accumulator.samples += 1

    if (finite(sample.speedKmh) && sample.speedKmh > 0) {
      accumulator.minSpeedKmh =
        accumulator.minSpeedKmh === null ? sample.speedKmh : Math.min(accumulator.minSpeedKmh, sample.speedKmh)
      if (finite(sample.lapDistPct) && sample.lapDistPct >= 0 && sample.lapDistPct < 1) {
        const bin = Math.min(RC18_TRACE_BINS - 1, Math.floor(sample.lapDistPct * RC18_TRACE_BINS))
        const current = accumulator.trace[bin]
        accumulator.trace[bin] = current === null ? sample.speedKmh : Math.max(current, sample.speedKmh)
      }
    }

    if (finite(sample.deltaToBestSec)) accumulator.deltaToBestSec = sample.deltaToBestSec
    if (finite(sample.bestLapTimeSec) && sample.bestLapTimeSec > 0) {
      accumulator.bestLapTimeSec = sample.bestLapTimeSec
    }

    for (const corner of RC18_CORNERS) {
      const tyre = sample.tyreC[corner]
      if (finite(tyre)) {
        const current = accumulator.tyrePeakC[corner]
        accumulator.tyrePeakC[corner] = current === null ? tyre : Math.max(current, tyre)
      }
      const brake = sample.brakeC[corner]
      if (finite(brake)) {
        const current = accumulator.brakePeakC[corner]
        accumulator.brakePeakC[corner] = current === null ? brake : Math.max(current, brake)
      }
    }

    if (
      finite(sample.speedKmh) &&
      sample.speedKmh >= RC18_BALANCE_MIN_SPEED_KMH &&
      finite(sample.steerAngleDeg) &&
      Math.abs(sample.steerAngleDeg) >= RC18_BALANCE_MIN_STEER_DEG &&
      finite(sample.yawRateRadSec)
    ) {
      const steerRad = Math.abs((sample.steerAngleDeg * Math.PI) / 180)
      const speedMps = sample.speedKmh / 3.6
      const demand = steerRad * speedMps
      if (demand > 0) {
        accumulator.balance.push({ gain: Math.abs(sample.yawRateRadSec) / demand, speedKmh: sample.speedKmh })
      }
    }
  }

  ingest(sample: Rc18RunSample): void {
    if (!finite(sample.lapDistPct) || !finite(sample.currentLapTimeSec)) {
      this.hasFeed = false
      return
    }
    this.hasFeed = true
    this.lastSampleAtMs = sample.receivedAt

    // A lap boundary is a start-finish wrap or a pit/session lap-clock rewind. The aggregates
    // belong to exactly one lap, so an UNARCHIVED lap (one whose sectors were not all measured)
    // must still close its accumulator, or an out-lap would bleed into the next matched lap.
    const boundary =
      this.lastLapDistPct === null ||
      sample.lapDistPct + 0.5 < this.lastLapDistPct ||
      (this.lastLapTimeSec !== null &&
        sample.currentLapTimeSec < this.lastLapTimeSec - RC02_LAP_CLOCK_RESTART_TOLERANCE_SEC)

    const before = this.tracker.laps()[0]?.lapOrdinal ?? 0
    this.tracker.ingest({
      lapDistPct: sample.lapDistPct,
      currentLapTimeSec: sample.currentLapTimeSec,
      receivedAt: sample.receivedAt
    })
    const archived = this.tracker.laps()[0]
    if (archived && archived.lapOrdinal !== before) {
      this.seal(archived.lapOrdinal, archived.sectors, sample.receivedAt)
    } else if (boundary) {
      this.accumulator = emptyAccumulator()
    }

    this.accumulate(sample)
    this.lastLapDistPct = sample.lapDistPct
    this.lastLapTimeSec = sample.currentLapTimeSec
  }

  /** Newest matched lap first. */
  laps(): readonly Rc18Run[] {
    return this.runs
  }

  feedFresh(nowMs: number): boolean {
    return this.hasFeed && this.lastSampleAtMs !== null && nowMs - this.lastSampleAtMs <= RC18_MATCH_FEED_STALE_MS
  }

  hasTimingFeed(): boolean {
    return this.hasFeed
  }
}

/**
 * Picks the compared pair. With no lock, A is the OLDEST matched lap still in history and B the
 * newest, which is the honest reading of "run setup A, then run setup B". A lock pins A to a
 * chosen lap; if that lap has aged out of history the lock is dropped rather than silently
 * re-pointed at a different lap.
 */
export function rc18SelectPair(
  runs: readonly Rc18Run[],
  baselineOrdinal: number | null
): { a: Rc18Run | null; b: Rc18Run | null; locked: boolean } {
  if (runs.length === 0) return { a: null, b: null, locked: false }
  const locked = baselineOrdinal === null ? null : (runs.find((run) => run.lapOrdinal === baselineOrdinal) ?? null)
  const a = locked ?? runs[runs.length - 1]
  const b = runs.find((run) => run.lapOrdinal !== a.lapOrdinal) ?? null
  return { a, b, locked: locked !== null }
}

// ----------------------------------------------------------------------- packet 11.1 / 12.1 zones

export interface Rc18Rect {
  left: number
  top: number
  width: number
  height: number
}

export type Rc18ZoneId = 'summary' | 'columnA' | 'spine' | 'deltaStack' | 'stability' | 'columnB' | 'trace'
export type Rc18ZoneMap = Partial<Record<Rc18ZoneId, Rc18Rect>>
export type Rc18Layout = 'native' | 'app' | 'compact'
export type Rc18CompactMode = Rc01CompactMode

const NATIVE_W = 800
const NATIVE_H = 480
const APP_W = 1024
const APP_H = 600

function pctRect(x: number, y: number, w: number, h: number, canvasW: number, canvasH: number): Rc18Rect {
  return {
    left: (x / canvasW) * 100,
    top: (y / canvasH) * 100,
    width: (w / canvasW) * 100,
    height: (h / canvasH) * 100
  }
}

/**
 * Packet 11.1, verbatim, plus the two nested sub-zones that close gaps G3 and G1. The delta
 * stack stops at y=356 and the stability row starts at y=360, so the 4 px gutter guarantees the
 * two zones the packet overlaps by 11,760 px^2 can never collide.
 */
export function rc18NativeZones(): Rc18ZoneMap {
  return {
    summary: pctRect(16, 12, 768, 30, NATIVE_W, NATIVE_H),
    columnA: pctRect(16, 50, 300, 380, NATIVE_W, NATIVE_H),
    spine: pctRect(316, 50, 168, 380, NATIVE_W, NATIVE_H),
    deltaStack: pctRect(316, 50, 168, 306, NATIVE_W, NATIVE_H),
    stability: pctRect(316, 360, 168, 70, NATIVE_W, NATIVE_H),
    columnB: pctRect(484, 50, 300, 380, NATIVE_W, NATIVE_H)
  }
}

/**
 * Packet 12.1, verbatim, plus the stability row packet 12.1 forgot (gap G2) nested in the base
 * of the widened spine at x 344-680, y 430-500, mirroring the 800x480 nesting exactly.
 */
export function rc18AppZones(): Rc18ZoneMap {
  return {
    summary: pctRect(24, 12, 976, 36, APP_W, APP_H),
    columnA: pctRect(24, 60, 320, 440, APP_W, APP_H),
    spine: pctRect(344, 60, 336, 440, APP_W, APP_H),
    deltaStack: pctRect(344, 60, 336, 366, APP_W, APP_H),
    stability: pctRect(344, 430, 336, 70, APP_W, APP_H),
    columnB: pctRect(680, 60, 320, 440, APP_W, APP_H),
    trace: pctRect(24, 510, 976, 70, APP_W, APP_H)
  }
}

/**
 * Compact keeps the packet's mirror grammar — the axis never rotates, so A stays left of the
 * spine and B stays right of it at every breakpoint — and reflows by DROPPING modules (see
 * `rc18RowsForLayout`) rather than by scaling the 800x480 frame down.
 */
export function rc18CompactZones(mode: Rc18CompactMode): Rc18ZoneMap {
  const summaryHeight = mode === 'phone' ? 7 : 8
  const bodyTop = mode === 'phone' ? 11 : 12
  const bodyHeight = mode === 'phone' ? 80 : 76
  const stabilityHeight = mode === 'phone' ? 17 : 15
  const deltaHeight = bodyHeight - stabilityHeight - 1
  return {
    summary: { left: 2, top: 2, width: 96, height: summaryHeight },
    columnA: { left: 2, top: bodyTop, width: 37.5, height: bodyHeight },
    spine: { left: 39.5, top: bodyTop, width: 21, height: bodyHeight },
    deltaStack: { left: 39.5, top: bodyTop, width: 21, height: deltaHeight },
    stability: { left: 39.5, top: bodyTop + deltaHeight + 1, width: 21, height: stabilityHeight },
    columnB: { left: 60.5, top: bodyTop, width: 37.5, height: bodyHeight }
  }
}

export function rc18ZonesForLayout(layout: Rc18Layout, mode: Rc18CompactMode): Rc18ZoneMap {
  if (layout === 'native') return rc18NativeZones()
  if (layout === 'app') return rc18AppZones()
  return rc18CompactZones(mode)
}

export function rc18ZoneStyle(rect: Rc18Rect | undefined): Record<string, string> | undefined {
  if (!rect) return undefined
  return {
    left: rc18Percent(rect.left),
    top: rc18Percent(rect.top),
    width: rc18Percent(rect.width),
    height: rc18Percent(rect.height)
  }
}

export function rc18RectsOverlap(a: Rc18Rect, b: Rc18Rect): boolean {
  return (
    a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top
  )
}

export function rc18RectContains(outer: Rc18Rect, inner: Rc18Rect): boolean {
  return (
    inner.left >= outer.left - 1e-9 &&
    inner.top >= outer.top - 1e-9 &&
    inner.left + inner.width <= outer.left + outer.width + 1e-9 &&
    inner.top + inner.height <= outer.top + outer.height + 1e-9
  )
}

/** A nested rect expressed relative to its parent, so a sub-zone can be positioned inside it. */
export function rc18NestedRect(child: Rc18Rect, parent: Rc18Rect): Rc18Rect {
  return {
    left: ((child.left - parent.left) / parent.width) * 100,
    top: ((child.top - parent.top) / parent.height) * 100,
    width: (child.width / parent.width) * 100,
    height: (child.height / parent.height) * 100
  }
}

/** The mirror is structural: A's rect reflected about the axis must BE B's rect. */
export function rc18MirrorError(zones: Rc18ZoneMap): number {
  const a = zones.columnA
  const b = zones.columnB
  if (!a || !b) return Number.POSITIVE_INFINITY
  const reflectedLeft = 2 * RC18_MIRROR_AXIS_PCT - (a.left + a.width)
  return Math.max(
    Math.abs(reflectedLeft - b.left),
    Math.abs(a.width - b.width),
    Math.abs(a.top - b.top),
    Math.abs(a.height - b.height)
  )
}

export function rc18LayoutForContentBox(width: number, height: number): Rc18Layout {
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return 'app'
  return rc01LayoutForContentBox(width, height)
}

export function rc18CompactModeForContentBox(width: number, height: number): Rc18CompactMode {
  if (rc18LayoutForContentBox(width, height) !== 'compact') return 'standard'
  return rc01CompactModeForContentBox(width, height)
}

// -------------------------------------------------------------------------- the compared pairs

export type Rc18RowKey =
  | 'deltaToBest'
  | 'sector1'
  | 'sector2'
  | 'sector3'
  | 'minSpeed'
  | 'tyreLf'
  | 'tyreRf'
  | 'tyreLr'
  | 'tyreRr'
  | 'brakeFrt'
  | 'brakeRear'

export type Rc18RowRung = 'timing' | 'secondary'

export interface Rc18MetricPair {
  key: Rc18RowKey
  label: string
  unit: string
  rung: Rc18RowRung
  a: Rc01Field
  b: Rc01Field
  /** Packet 14/15: a channel gap on either side makes the PAIR incomparable, never one side. */
  incomparable: boolean
}

/**
 * The reflow model. `phone` genuinely drops the tyre and brake modules instead of shrinking
 * them below legibility; every other breakpoint carries the full ladder. The alert surface for
 * a dropped module moves to the summary header, so no alert loses its surface (SOP).
 */
export function rc18RowsForLayout(layout: Rc18Layout, mode: Rc18CompactMode): readonly Rc18RowKey[] {
  const timing: Rc18RowKey[] = ['deltaToBest', 'sector1', 'sector2', 'sector3']
  if (layout === 'compact' && mode === 'phone') return [...timing, 'minSpeed']
  return [...timing, 'minSpeed', 'tyreLf', 'tyreRf', 'tyreLr', 'tyreRr', 'brakeFrt', 'brakeRear']
}

const ROW_DEFINITIONS: Readonly<Record<Rc18RowKey, { label: string; unit: string; rung: Rc18RowRung }>> =
  Object.freeze({
    deltaToBest: { label: 'DELTA', unit: 'S', rung: 'timing' },
    sector1: { label: 'S1', unit: 'S', rung: 'timing' },
    sector2: { label: 'S2', unit: 'S', rung: 'timing' },
    sector3: { label: 'S3', unit: 'S', rung: 'timing' },
    minSpeed: { label: 'MIN SPD', unit: 'KM/H', rung: 'secondary' },
    tyreLf: { label: 'TYRE LF', unit: '\u00B0C', rung: 'secondary' },
    tyreRf: { label: 'TYRE RF', unit: '\u00B0C', rung: 'secondary' },
    tyreLr: { label: 'TYRE LR', unit: '\u00B0C', rung: 'secondary' },
    tyreRr: { label: 'TYRE RR', unit: '\u00B0C', rung: 'secondary' },
    brakeFrt: { label: 'BRK FRT', unit: '\u00B0C', rung: 'secondary' },
    brakeRear: { label: 'BRK REAR', unit: '\u00B0C', rung: 'secondary' }
  })

/**
 * Packet 16 says "per axle/corner"; the app supplies per-corner sensors, so an axle figure is
 * the hotter MEASURED corner and requires both corners to have reported. One sensor alone is a
 * channel gap, not half an answer, and never borrows the other corner or the other setup.
 */
export function rc18AxlePeakC(peaks: Readonly<Record<Rc18Corner, number | null>>, axle: Rc18Axle): number | null {
  const corners = RC18_AXLE_CORNERS[axle]
  const values = corners.map((corner) => peaks[corner])
  if (!values.every(finite)) return null
  return Math.max(...(values as number[]))
}

function rawFor(run: Rc18Run | null, key: Rc18RowKey): number | null {
  if (!run) return null
  switch (key) {
    case 'deltaToBest':
      return run.deltaToBestSec
    case 'sector1':
      return run.sectorsSec[0] ?? null
    case 'sector2':
      return run.sectorsSec[1] ?? null
    case 'sector3':
      return run.sectorsSec[2] ?? null
    case 'minSpeed':
      return run.minSpeedKmh
    case 'tyreLf':
      return run.tyrePeakC.lf
    case 'tyreRf':
      return run.tyrePeakC.rf
    case 'tyreLr':
      return run.tyrePeakC.lr
    case 'tyreRr':
      return run.tyrePeakC.rr
    case 'brakeFrt':
      return rc18AxlePeakC(run.brakePeakC, 'frt')
    case 'brakeRear':
      return rc18AxlePeakC(run.brakePeakC, 'rear')
    default:
      return null
  }
}

function formatFor(key: Rc18RowKey, raw: number | null): string {
  if (key === 'deltaToBest') return rc18SignedSeconds(raw)
  if (key === 'sector1' || key === 'sector2' || key === 'sector3') return rc18Seconds(raw)
  return rc18Integer(raw)
}

export function rc18PairsForRows(
  rows: readonly Rc18RowKey[],
  a: Rc18Run | null,
  b: Rc18Run | null,
  stale: boolean
): readonly Rc18MetricPair[] {
  return rows.map((key) => {
    const definition = ROW_DEFINITIONS[key]
    const rawA = rawFor(a, key)
    const rawB = rawFor(b, key)
    const incomparable = rawA === null || rawB === null
    const make = (raw: number | null): Rc01Field =>
      field(
        formatFor(key, raw),
        raw,
        stale && raw !== null,
        raw === null,
        raw === null ? 'muted' : stale ? 'muted' : 'primary'
      )
    return { key, ...definition, a: make(rawA), b: make(rawB), incomparable }
  })
}

// ----------------------------------------------------------------------------- verdict spine

export type Rc18SectorIndex = 0 | 1 | 2
export const RC18_SECTOR_LABELS = Object.freeze(['S1', 'S2', 'S3'] as const)

export interface Rc18SectorVerdict {
  index: Rc18SectorIndex
  label: 'S1' | 'S2' | 'S3'
  /** Signed B minus A. Positive means B lost time, so A is the faster side. */
  deltaSec: number | null
  value: string
  fasterSide: Rc18Side | null
  /** |delta| / full scale, clamped to [0, 1]. Normative override NO-2. */
  magnitude: number
  /** Bar length as a percentage of the SPINE width, measured from the shared datum. */
  lengthPct: number
  highlighted: boolean
  muted: boolean
  incomparable: boolean
  clamped: boolean
}

/** Normative override NO-2: `clamp(|delta| / 0.320, 0, 1) * halfSpan`, never eyeballed. */
export function rc18BarLengthPct(deltaSec: number | null): number {
  if (!finite(deltaSec)) return 0
  return clamp(Math.abs(deltaSec) / RC18_SPINE_FULL_SCALE_SEC, 0, 1) * RC18_SPINE_HALF_SPAN_PCT
}

export function rc18SectorDeltas(a: Rc18Run | null, b: Rc18Run | null): readonly (number | null)[] {
  return [0, 1, 2].map((index) => {
    const left = a?.sectorsSec[index] ?? null
    const right = b?.sectorsSec[index] ?? null
    if (!finite(left) || !finite(right)) return null
    return right - left
  })
}

export function rc18FasterSide(deltaSec: number | null): Rc18Side | null {
  if (!finite(deltaSec) || deltaSec === 0) return null
  return deltaSec > 0 ? 'a' : 'b'
}

// ------------------------------------------------------------------ packet 15 trigger-only alerts

export interface Rc18Latch {
  active: boolean
  minimumVisibleUntilMs: number
}

export interface Rc18AlertState {
  sectorGap: readonly Rc18Latch[]
  stability: Rc18Latch
  incomparable: { active: boolean; keys: readonly string[] }
}

export interface Rc18AlertInput {
  nowMs: number
  pairAvailable: boolean
  sectorDeltas: readonly (number | null)[]
  balanceDelta: number | null
  incomparableKeys: readonly string[]
}

function silentLatch(): Rc18Latch {
  return { active: false, minimumVisibleUntilMs: 0 }
}

export function createRc18AlertState(): Rc18AlertState {
  return {
    sectorGap: [silentLatch(), silentLatch(), silentLatch()],
    stability: silentLatch(),
    incomparable: { active: false, keys: [] }
  }
}

/**
 * One latch, one rule. Silent until the magnitude passes the threshold on a recomputed match
 * (packet 15 defines the debounce as "computed on matched laps", not as a timer), held for
 * `RC18_ALERT_MIN_VISIBLE_MS` so a re-match cannot strobe it, released only below the
 * hysteresis floor, and UNLATCHED immediately the moment its input stops being comparable.
 */
function advanceLatch(
  latch: Rc18Latch,
  magnitude: number | null,
  threshold: number,
  hysteresis: number,
  nowMs: number
): Rc18Latch {
  if (!finite(magnitude)) return silentLatch()
  const value = Math.abs(magnitude)
  if (value > threshold) return { active: true, minimumVisibleUntilMs: nowMs + RC18_ALERT_MIN_VISIBLE_MS }
  if (!latch.active) return { active: false, minimumVisibleUntilMs: 0 }
  if (nowMs < latch.minimumVisibleUntilMs) return latch
  if (value <= threshold - hysteresis) return silentLatch()
  return latch
}

export function advanceRc18Alerts(state: Rc18AlertState, input: Rc18AlertInput): Rc18AlertState {
  if (!input.pairAvailable) return createRc18AlertState()
  return {
    sectorGap: state.sectorGap.map((latch, index) =>
      advanceLatch(
        latch,
        input.sectorDeltas[index] ?? null,
        RC18_SECTOR_NOISE_SEC,
        RC18_SECTOR_NOISE_HYSTERESIS_SEC,
        input.nowMs
      )
    ),
    stability: advanceLatch(
      state.stability,
      input.balanceDelta,
      RC18_BALANCE_BAND,
      RC18_BALANCE_BAND_HYSTERESIS,
      input.nowMs
    ),
    incomparable: { active: input.incomparableKeys.length > 0, keys: [...input.incomparableKeys] }
  }
}

/** Fail closed: without a comparable pair no latch may survive into the next frame. */
export function clearInvalidRc18Alerts(state: Rc18AlertState, pairAvailable: boolean): Rc18AlertState {
  return pairAvailable ? state : createRc18AlertState()
}

export interface Rc18AlertFlags {
  sectorGap: readonly boolean[]
  stability: boolean
  incomparable: boolean
  incomparableKeys: readonly string[]
}

export function rc18AlertFlags(state: Rc18AlertState): Rc18AlertFlags {
  return {
    sectorGap: state.sectorGap.map((latch) => latch.active),
    stability: state.stability.active,
    incomparable: state.incomparable.active,
    incomparableKeys: [...state.incomparable.keys]
  }
}

export function rc18AlertLines(flags: Rc18AlertFlags): readonly string[] {
  const lines: string[] = []
  flags.sectorGap.forEach((active, index) => {
    if (active) lines.push(`sector-gap:${RC18_SECTOR_LABELS[index]}`)
  })
  if (flags.stability) lines.push('stability-difference')
  for (const key of flags.incomparableKeys) lines.push(`incomparable:${key}`)
  return lines
}

// ------------------------------------------------------------------------------ the model

export interface Rc18StabilityModel {
  a: Rc01Field
  b: Rc01Field
  deltaIndex: number | null
  deltaValue: string
  highlighted: boolean
  available: boolean
  sourceLabel: string
}

export interface Rc18SummaryModel {
  text: string
  fasterSide: Rc18Side | null
  deltaSec: number | null
  unavailable: boolean
}

export interface Rc18TraceModel {
  available: boolean
  minKmh: number | null
  maxKmh: number | null
  /** One polyline per side; each point is `[binFraction, normalisedSpeed]` in 0..1. */
  points: Readonly<Record<Rc18Side, readonly (readonly [number, number])[]>>
}

export interface Rc18DashboardModel {
  pairAvailable: boolean
  baselineLocked: boolean
  feed: 'live' | 'stale' | 'none'
  summary: Rc18SummaryModel
  pairs: readonly Rc18MetricPair[]
  verdicts: readonly Rc18SectorVerdict[]
  stability: Rc18StabilityModel
  trace: Rc18TraceModel
  alerts: Rc18AlertFlags
  incomparableKeys: readonly string[]
  runs: { a: Rc18Run | null; b: Rc18Run | null }
}

export interface Rc18ModelOptions {
  alerts?: Rc18AlertState
  rows?: readonly Rc18RowKey[]
  includeTrace?: boolean
  baselineOrdinal?: number | null
  feedFresh?: boolean
  hasTimingFeed?: boolean
}

function emptyTrace(): Rc18TraceModel {
  return { available: false, minKmh: null, maxKmh: null, points: { a: [], b: [] } }
}

function traceModel(a: Rc18Run | null, b: Rc18Run | null, include: boolean): Rc18TraceModel {
  if (!include || !a || !b) return emptyTrace()
  const values: number[] = []
  for (const run of [a, b]) {
    for (const value of run.trace.speedKmh) if (finite(value)) values.push(value)
  }
  if (values.length === 0) return emptyTrace()
  const minKmh = Math.min(...values)
  const maxKmh = Math.max(...values)
  const span = maxKmh - minKmh
  const project = (run: Rc18Run): readonly (readonly [number, number])[] =>
    run.trace.speedKmh
      .map((value, index): readonly [number, number] | null =>
        finite(value)
          ? [index / (RC18_TRACE_BINS - 1), span > 0 ? (value - minKmh) / span : 0.5]
          : null
      )
      .filter((point): point is readonly [number, number] => point !== null)
  return { available: true, minKmh, maxKmh, points: { a: project(a), b: project(b) } }
}

/**
 * Packet 4/6: the verdict is the whole point, so it is stated as a sentence, not implied by a
 * colour. Without two matched laps it says so, and no number is shown at all.
 */
function summaryModel(a: Rc18Run | null, b: Rc18Run | null): Rc18SummaryModel {
  if (!a || !b || !finite(a.totalSec) || !finite(b.totalSec)) {
    return { text: 'NO MATCHED PAIR', fasterSide: null, deltaSec: null, unavailable: true }
  }
  const deltaSec = b.totalSec - a.totalSec
  if (deltaSec === 0) return { text: 'SETUPS LEVEL', fasterSide: null, deltaSec: 0, unavailable: false }
  const fasterSide: Rc18Side = deltaSec > 0 ? 'a' : 'b'
  const magnitude = Math.abs(deltaSec)
  const printed = magnitude >= 10 ? '9.99+' : magnitude.toFixed(3)
  return {
    text: `${RC18_SIDE_LABELS[fasterSide]} FASTER BY ${printed} S`,
    fasterSide,
    deltaSec,
    unavailable: false
  }
}

export function createRc18DashboardModel(
  runs: readonly Rc18Run[],
  nowMs: number = rc01MonotonicNow(),
  options: Rc18ModelOptions = {}
): Rc18DashboardModel {
  const alerts = options.alerts ?? createRc18AlertState()
  const rows = options.rows ?? rc18RowsForLayout('native', 'standard')
  const { a, b, locked } = rc18SelectPair(runs, options.baselineOrdinal ?? null)
  const pairAvailable = a !== null && b !== null
  const hasFeed = options.hasTimingFeed ?? runs.length > 0
  const fresh = options.feedFresh ?? true
  const feed: Rc18DashboardModel['feed'] = !hasFeed ? 'none' : fresh ? 'live' : 'stale'
  const stale = feed === 'stale'

  const pairs = rc18PairsForRows(rows, a, b, stale)
  const deltas = rc18SectorDeltas(a, b)
  const flags = rc18AlertFlags(alerts)

  const verdicts: readonly Rc18SectorVerdict[] = [0, 1, 2].map((index) => {
    const deltaSec = deltas[index] ?? null
    const highlighted = Boolean(flags.sectorGap[index]) && finite(deltaSec)
    return {
      index: index as Rc18SectorIndex,
      label: RC18_SECTOR_LABELS[index],
      deltaSec,
      value: rc18SignedSeconds(deltaSec),
      fasterSide: rc18FasterSide(deltaSec),
      magnitude: finite(deltaSec) ? clamp(Math.abs(deltaSec) / RC18_SPINE_FULL_SCALE_SEC, 0, 1) : 0,
      lengthPct: rc18BarLengthPct(deltaSec),
      highlighted,
      muted: finite(deltaSec) && !highlighted,
      incomparable: !finite(deltaSec),
      clamped: rc18ClampsDisplay(deltaSec)
    }
  })

  const balanceA = a?.balanceIndex ?? null
  const balanceB = b?.balanceIndex ?? null
  const balanceAvailable = finite(balanceA) && finite(balanceB)
  const deltaIndex = balanceAvailable ? (balanceB as number) - (balanceA as number) : null
  const stability: Rc18StabilityModel = {
    a: field(rc18BalanceText(balanceA), balanceA, stale && balanceA !== null, balanceA === null, balanceA === null ? 'muted' : 'primary'),
    b: field(rc18BalanceText(balanceB), balanceB, stale && balanceB !== null, balanceB === null, balanceB === null ? 'muted' : 'primary'),
    deltaIndex,
    deltaValue: finite(deltaIndex) ? rc18SignedSeconds(deltaIndex, 2) : DASH,
    highlighted: flags.stability && balanceAvailable,
    available: balanceAvailable,
    sourceLabel: balanceAvailable ? 'STEER + YAW' : 'NO SOURCE'
  }

  const incomparableKeys = pairs.filter((pair) => pair.incomparable).map((pair) => pair.key)

  return {
    pairAvailable,
    baselineLocked: locked,
    feed,
    summary: summaryModel(a, b),
    pairs,
    verdicts,
    stability,
    trace: traceModel(a, b, options.includeTrace ?? false),
    alerts: flags,
    incomparableKeys,
    runs: { a, b }
  }
}

export function rc18AlertInputForModel(model: Rc18DashboardModel, nowMs: number): Rc18AlertInput {
  return {
    nowMs,
    pairAvailable: model.pairAvailable,
    sectorDeltas: model.verdicts.map((verdict) => verdict.deltaSec),
    balanceDelta: model.stability.deltaIndex,
    incomparableKeys: model.incomparableKeys
  }
}

// ------------------------------------------------------------------------------- ingest glue

function cornerValue(source: unknown, corner: Rc18Corner): number | null {
  if (!source || typeof source !== 'object') return null
  const value = (source as Record<string, unknown>)[corner]
  return finite(value) ? value : null
}

function tyreCorner(snapshot: TelemetrySnapshot | null, corner: Rc18Corner): number | null {
  const tyres = snapshot?.tyres as Record<string, { tempC?: number } | undefined> | undefined
  const value = tyres?.[corner]?.tempC
  return finite(value) ? value : null
}

/** Channel receipts decide freshness; a channel that missed its packet-16 budget cannot record. */
function receiptFresh(
  receipts: ReadonlyMap<Rc01ChannelName, Rc01ChannelReceipt>,
  channel: Rc01ChannelName,
  nowMs: number,
  budgetMs: number
): boolean {
  const receipt = receipts.get(channel)
  if (!receipt) return false
  return rc01ReceiptAgeMs(receipt, nowMs) <= budgetMs
}

export function rc18SampleFromSnapshot(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc01ChannelName, Rc01ChannelReceipt>,
  receivedAt: number
): Rc18RunSample | null {
  if (!snapshot) return null
  const speedFresh = receiptFresh(receipts, 'speed', receivedAt, RC18_CHANNEL_STALE_MS.speed)
  const tyreFreshFor = (corner: Rc18Corner): boolean =>
    receiptFresh(
      receipts,
      (corner === 'lf' ? 'tyreLf' : corner === 'rf' ? 'tyreRf' : corner === 'lr' ? 'tyreLr' : 'tyreRr'),
      receivedAt,
      RC18_CHANNEL_STALE_MS.tyre
    )
  const tyreC: Record<Rc18Corner, number | null> = emptyCornerMap()
  const brakeC: Record<Rc18Corner, number | null> = emptyCornerMap()
  for (const corner of RC18_CORNERS) {
    tyreC[corner] = tyreFreshFor(corner) ? tyreCorner(snapshot, corner) : null
    brakeC[corner] = cornerValue(snapshot.brakeTempC, corner)
  }
  return {
    lapDistPct: finite(snapshot.lapDistPct) ? snapshot.lapDistPct : null,
    currentLapTimeSec: finite(snapshot.currentLapTimeSec) ? snapshot.currentLapTimeSec : null,
    speedKmh: speedFresh && finite(snapshot.speedKmh) ? snapshot.speedKmh : null,
    deltaToBestSec: finite(snapshot.deltaToBestSec) ? snapshot.deltaToBestSec : null,
    bestLapTimeSec: finite(snapshot.bestLapTimeSec) ? snapshot.bestLapTimeSec : null,
    steerAngleDeg: finite(snapshot.steerAngleDeg) ? snapshot.steerAngleDeg : null,
    yawRateRadSec: finite(snapshot.yawRateRadSec) ? snapshot.yawRateRadSec : null,
    tyreC,
    brakeC,
    receivedAt
  }
}

export function rc18SideDescription(side: Rc18Side, label: string, value: Rc01Field): string {
  const state = value.unavailable ? 'unavailable' : value.stale ? 'stale' : value.value
  return `${RC18_SIDE_LABELS[side]} ${label} ${state}`
}

/** Exported for the suite: the boundaries RC-18 inherits from RC-02's measured sectors. */
export const RC18_SECTOR_BOUNDARIES = RC02_SECTOR_BOUNDARIES
