// PREDICTIONS engine — PURE, deterministic projections (WS-G, FOUNDATION).
//
// IMPORTANT: this file is dependency-free (no node:*, no electron, no model
// runtime) exactly like shared/strategy.ts / shared/fuel.ts / shared/tire-strategy.ts,
// so it can be imported by main, renderer AND the unit tests without dragging in
// any runtime. It carries ONLY the shared CONTRACT TYPES + pure math.
//
// The 5 consumers (WS-H widgets/overlays, WS-F adaptive dashboard, WS-I stint
// debrief, WS-L learned pace model) compile against the exported types below.
// `PredictionsSnapshot` is the canonical broadcast payload; the deterministic
// math here ALWAYS works, and a learned `PaceModel` (WS-L) only REFINES
// `pace.projectedLapSec` / `tire.lapsToCliff` when one is plugged in.

// ─── IPC channels (module + renderer agree on these) ─────────────────────────

export const PREDICTIONS_CHANNELS = {
  /** Broadcast: per-lap (+ light sampling) snapshot. */
  snapshot: 'predictions:snapshot',
  /** invoke() → PredictionsSnapshot | null. */
  get: 'predictions:get'
} as const

export type PredictionsChannel = (typeof PREDICTIONS_CHANNELS)[keyof typeof PREDICTIONS_CHANNELS]

// ─── Contract types (consumers compile against these) ────────────────────────

/**
 * A catch-up estimate at the CURRENT relative pace.
 * - `catchAhead`: time/laps for YOU to reach the car ahead (only when you are
 *   faster, i.e. the gap is shrinking → `closingSecPerLap > 0`).
 * - `caughtBehind`: time/laps for the car BEHIND to reach YOU (only when it is
 *   closing, i.e. the gap is shrinking → `closingSecPerLap > 0`).
 */
export interface CatchEstimate {
  /** Other car's iRacing carIdx (the one ahead, or the chaser behind). */
  carIdx: number
  /** Current absolute gap in seconds (always >= 0). */
  gapSec: number
  /** How many seconds of gap close PER LAP at the current relative pace (> 0). */
  closingSecPerLap: number
  /** Estimated time to close the gap, in seconds. */
  etaSec: number
  /** Estimated time to close the gap, in LAPS. */
  etaLaps: number
  /**
   * True when the closing rate is above the noise floor but BELOW the
   * confidence floor (`confidentClosingSecPerLap`). The ETA is then dominated by
   * a barely-closing trend and can balloon to absurd values, so consumers should
   * render it as "—"/neutral rather than a giant number.
   */
  lowConfidence?: boolean
}

/**
 * Fuel-to-the-end projection. `finishMarginLaps`/`finishMarginL` are OPTIONAL:
 * they are `undefined` when the race distance is unknown (no real lap count and
 * no session time + lap time to derive one). Consumers MUST treat `undefined` as
 * "no data" — never as a 0-lap margin / fuel-critical.
 */
export interface FuelPrediction {
  /** Laps the remaining fuel covers at the current per-lap burn. */
  lapsLeftAtPace: number
  /** lapsLeftAtPace − laps remaining in the race (+ surplus, − short). Undefined when distance unknown. */
  finishMarginLaps?: number
  /** Litres of surplus (+) / deficit (−) at the chequered flag. Undefined when distance unknown. */
  finishMarginL?: number
}

export type TirePressureState = 'low' | 'ok' | 'high'
export type TireTempState = 'cold' | 'optimal' | 'hot'

/** Tyre degradation / window projection. */
export interface TirePrediction {
  /** Lap-time loss attributable to degradation, seconds per lap (>= 0). */
  degSecPerLap: number
  /** Heuristic (or model) estimate of laps until the performance "cliff". */
  lapsToCliff?: number
  /** Decided pressure window state across the axle. */
  pressureState: TirePressureState
  /** Decided temperature window state across the axle. */
  tempState: TireTempState
}

/** Projected lap-time + how much to trust it. */
export interface PacePrediction {
  /** Projected clean lap time, seconds. */
  projectedLapSec: number
  /** Confidence in `projectedLapSec`, 0..1. */
  confidence: number
}

/**
 * The canonical predictions payload broadcast on `predictions:snapshot` and
 * returned by `predictions:get`. `catchAhead`/`caughtBehind` are OPTIONAL: they
 * are only present when the guard conditions hold (you are faster / the chaser
 * is closing). `fuel`/`tire`/`pace` are always present (deterministic).
 */
export interface PredictionsSnapshot {
  /** Time to REACH the car ahead (only when you are closing on it). */
  catchAhead?: CatchEstimate
  /** Time for the car BEHIND to reach you (only when it is closing). */
  caughtBehind?: CatchEstimate
  fuel: FuelPrediction
  tire: TirePrediction
  pace: PacePrediction
}

// ─── PaceModel plug (WS-L) ───────────────────────────────────────────────────

/**
 * Feature row shared by the deterministic engine and a learned model. WS-L
 * trains an online regressor on these rows (per car+track) and plugs it in via
 * `PaceModel`; the engine falls back to deterministic math when no model is set
 * or the model returns `null`.
 */
export interface PaceFeatures {
  /** Recent CLEAN lap times (most-recent last), seconds. */
  recentLapTimes: number[]
  /** Representative tyre wear across the axle, 0..1 (1 = worn out), if known. */
  tyreWearPct?: number
  /** Fuel on board, litres (lighter car → faster), if known. */
  fuelLevelL?: number
  /** Track temperature, °C, if known. */
  trackTempC?: number
  /** Laps completed on the current set, if known. */
  lapsOnStint?: number
}

/**
 * Pluggable learned pace model (WS-L). Both methods return `null` when the model
 * is not confident / not trained, so the engine cleanly falls back to its
 * deterministic estimates.
 */
export interface PaceModel {
  /** Predicted clean lap time in seconds, or `null` to defer to deterministic. */
  predictLapSec(features: PaceFeatures): number | null
  /** Predicted laps until the cliff, or `null` to defer to deterministic. */
  lapsToCliff(features: PaceFeatures): number | null
}

// ─── Engine inputs (built by the main module from telemetry samples) ─────────

/** One sample of a relative gap, keyed by a fractional lap counter. */
export interface GapSample {
  /** Fractional lap counter (e.g. currentLap + lapDistPct) — monotonic x-axis. */
  lap: number
  /** Absolute gap to the other car, seconds (>= 0). */
  gapSec: number
}

/** A tyre corner reading (subset of TyreInfo the engine cares about). */
export interface TyreReading {
  pressureKpa?: number
  coldPressureKpa?: number
  tempC?: number
  wearPct?: number
}

/**
 * Everything the pure engine needs to produce a `PredictionsSnapshot`. The
 * main-process module assembles this from sampled telemetry (NOT in the tick).
 */
export interface PredictionInputs {
  // ── catch-up ──
  aheadCarIdx?: number
  /** Recent samples of the gap to the car AHEAD (oldest → newest). */
  aheadGapSamples?: GapSample[]
  behindCarIdx?: number
  /** Recent samples of the gap to the car BEHIND (oldest → newest). */
  behindGapSamples?: GapSample[]
  /** Lap time used to convert etaLaps → etaSec (projected or last clean lap). */
  lapTimeSec?: number

  // ── fuel ──
  fuelLevelL?: number
  fuelPerLap?: number
  /** Race laps remaining (raw iRacing value — sentinel-guarded internally). */
  lapsRemaining?: number
  /** Session time remaining, seconds — used when lapsRemaining is a sentinel. */
  sessionTimeRemainingSec?: number

  // ── tyre ──
  /** Recent CLEAN lap times (oldest → newest), seconds. */
  recentLapTimes?: number[]
  /** Per-corner tyre readings (any order; used as an axle-wide aggregate). */
  tyres?: TyreReading[]
  trackTempC?: number
  /** Laps completed on the current tyre set, if known. */
  lapsOnStint?: number
}

// ─── Tunables (sane defaults; deterministic) ─────────────────────────────────

export interface PredictionTunables {
  /** Min closingSecPerLap to emit a catch estimate (filters noise/parity). */
  minClosingSecPerLap: number
  /**
   * Min closingSecPerLap to TRUST the ETA. Between `minClosingSecPerLap` and this
   * floor the estimate is emitted but flagged `lowConfidence` (a barely-closing
   * car yields an absurd, tens-of-minutes ETA that the UI should hide).
   */
  confidentClosingSecPerLap: number
  /** Cap on etaLaps to keep absurd projections out of the UI. */
  maxEtaLaps: number
  /** Lap-time loss vs fresh tyres that defines the "cliff", seconds. */
  cliffDegSec: number
  /** Hot pressure as a fraction of cold pressure: below → low, above → high. */
  pressureLowFracOfCold: number
  pressureHighFracOfCold: number
  /** Absolute pressure window (kPa) used when cold pressure is unknown. */
  pressureLowKpa: number
  pressureHighKpa: number
  /** Tyre core temperature window (°C). */
  tempColdC: number
  tempHotC: number
}

export const DEFAULT_PREDICTION_TUNABLES: PredictionTunables = {
  minClosingSecPerLap: 0.05,
  confidentClosingSecPerLap: 0.12,
  maxEtaLaps: 999,
  cliffDegSec: 0.8,
  pressureLowFracOfCold: 1.02,
  pressureHighFracOfCold: 1.2,
  pressureLowKpa: 165,
  pressureHighKpa: 205,
  tempColdC: 70,
  tempHotC: 100
}

// ─── Sentinel / numeric guards (mirror the codebase-wide < 9999 rule) ────────

// iRacing reports 32767 (and other absurd sentinels) for lap counters in TIMED /
// unlimited sessions; the codebase treats anything >= 9999 as "not a real lap".
const LAP_SENTINEL = 9999

/** True when `value` is a genuine lap counter (guards the 32767 timed sentinel). */
export function isRealLapCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < LAP_SENTINEL
}

function isFiniteNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPositive(value: unknown): value is number {
  return isFiniteNum(value) && value > 0
}

/** A sane absolute gap: finite, non-negative and below the timed sentinel. */
function isSaneGap(value: unknown): value is number {
  return isFiniteNum(value) && value >= 0 && value < LAP_SENTINEL
}

// ─── Pure compute helpers (unit-tested) ──────────────────────────────────────

/**
 * Least-squares slope of `y` over `x` (per unit x). Returns `null` when there
 * are fewer than 2 points or x has no spread.
 */
export function linearSlope(points: Array<{ x: number; y: number }>): number | null {
  const pts = points.filter((p) => isFiniteNum(p.x) && isFiniteNum(p.y))
  if (pts.length < 2) return null
  const n = pts.length
  let sx = 0
  let sy = 0
  for (const p of pts) {
    sx += p.x
    sy += p.y
  }
  const mx = sx / n
  const my = sy / n
  let num = 0
  let den = 0
  for (const p of pts) {
    const dx = p.x - mx
    num += dx * (p.y - my)
    den += dx * dx
  }
  if (den <= 1e-9) return null
  return num / den
}

/**
 * Theil–Sen slope: the MEDIAN of all pairwise slopes of `y` over `x`. Robust to
 * outliers (a single traffic/incident-skewed sample can't drag the trend), unlike
 * least-squares. Returns `null` with < 2 points or no x-spread.
 */
export function theilSenSlope(points: Array<{ x: number; y: number }>): number | null {
  const pts = points.filter((p) => isFiniteNum(p.x) && isFiniteNum(p.y))
  if (pts.length < 2) return null
  const slopes: number[] = []
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 1; j < pts.length; j += 1) {
      const dx = pts[j].x - pts[i].x
      if (Math.abs(dx) <= 1e-9) continue
      slopes.push((pts[j].y - pts[i].y) / dx)
    }
  }
  if (slopes.length === 0) return null
  slopes.sort((a, b) => a - b)
  const mid = slopes.length >> 1
  return slopes.length % 2 === 1 ? slopes[mid] : (slopes[mid - 1] + slopes[mid]) / 2
}

/**
 * Closing rate in SECONDS-OF-GAP CLOSED PER LAP from a trend of gap samples.
 * Positive ⇒ the gap is SHRINKING (you/he is catching). Returns `null` with too
 * little data. Sentinel/insane gaps are dropped before the regression.
 */
export function gapClosingSecPerLap(samples: GapSample[] | undefined): number | null {
  if (!Array.isArray(samples)) return null
  const clean = samples.filter((s) => isFiniteNum(s?.lap) && isSaneGap(s?.gapSec))
  if (clean.length < 2) return null
  const slope = linearSlope(clean.map((s) => ({ x: s.lap, y: s.gapSec })))
  if (slope === null) return null
  // Gap shrinking ⇒ negative slope ⇒ positive closing.
  return -slope
}

/**
 * Build a `CatchEstimate` from a current gap + closing rate + lap time. Returns
 * `undefined` unless the gap is closing fast enough (`closingSecPerLap >=
 * tunables.minClosingSecPerLap`) and the inputs are sane.
 */
export function catchEstimate(
  carIdx: number | undefined,
  gapSec: number | undefined,
  closingSecPerLap: number | null,
  lapTimeSec: number | undefined,
  tunables: PredictionTunables = DEFAULT_PREDICTION_TUNABLES
): CatchEstimate | undefined {
  if (!isFiniteNum(carIdx)) return undefined
  if (!isSaneGap(gapSec) || gapSec <= 0) return undefined
  if (closingSecPerLap === null || !isFiniteNum(closingSecPerLap)) return undefined
  if (closingSecPerLap < tunables.minClosingSecPerLap) return undefined
  const etaLapsRaw = gapSec / closingSecPerLap
  if (!isPositive(etaLapsRaw)) return undefined
  const etaLaps = Math.min(etaLapsRaw, tunables.maxEtaLaps)
  const etaSec = isPositive(lapTimeSec) ? etaLaps * lapTimeSec : etaLaps * Math.max(gapSec, 1)
  const lowConfidence = closingSecPerLap < tunables.confidentClosingSecPerLap
  return {
    carIdx,
    gapSec: round(gapSec, 2),
    closingSecPerLap: round(closingSecPerLap, 3),
    etaSec: round(etaSec, 1),
    etaLaps: round(etaLaps, 1),
    ...(lowConfidence ? { lowConfidence: true } : {})
  }
}

/**
 * Fuel-to-the-end. `lapsRemaining` is sentinel-guarded; when it is not a real
 * lap count (timed session) it is derived from `sessionTimeRemainingSec /
 * lapTimeSec`. Returns zeros when fuel/burn data is missing (never throws).
 */
export function fuelPrediction(args: {
  fuelLevelL?: number
  fuelPerLap?: number
  lapsRemaining?: number
  sessionTimeRemainingSec?: number
  lapTimeSec?: number
}): FuelPrediction {
  const { fuelLevelL, fuelPerLap, lapsRemaining, sessionTimeRemainingSec, lapTimeSec } = args
  const lapsLeftAtPace = isPositive(fuelPerLap) && isFiniteNum(fuelLevelL) ? fuelLevelL / fuelPerLap : 0

  let raceLapsRemaining: number | null = null
  if (isRealLapCount(lapsRemaining)) {
    raceLapsRemaining = lapsRemaining
  } else if (isPositive(sessionTimeRemainingSec) && isPositive(lapTimeSec)) {
    raceLapsRemaining = sessionTimeRemainingSec / lapTimeSec
  }

  // Unknown race distance ⇒ NO margin (consumers must not read this as 0 / critical).
  if (raceLapsRemaining === null) {
    return { lapsLeftAtPace: round(lapsLeftAtPace, 1) }
  }

  const finishMarginLaps = lapsLeftAtPace - raceLapsRemaining
  const finishMarginL =
    isPositive(fuelPerLap) && isFiniteNum(fuelLevelL) ? fuelLevelL - raceLapsRemaining * fuelPerLap : 0

  return {
    lapsLeftAtPace: round(lapsLeftAtPace, 1),
    finishMarginLaps: round(finishMarginLaps, 1),
    finishMarginL: round(finishMarginL, 2)
  }
}

/**
 * Degradation lap-time trend, seconds per lap (>= 0). Positive ⇒ getting slower.
 * Uses a ROBUST (Theil–Sen median) slope of recent lap times so a single traffic
 * /incident-held slow lap can't fake a degradation cliff; early-out 0 with < 3
 * samples.
 */
export function tireDegSecPerLap(recentLapTimes: number[] | undefined): number {
  if (!Array.isArray(recentLapTimes)) return 0
  const clean = recentLapTimes.filter((t) => isPositive(t))
  if (clean.length < 3) return 0
  const slope = theilSenSlope(clean.map((y, x) => ({ x, y })))
  if (slope === null) return 0
  return Math.max(0, round(slope, 3))
}

/** Decide the pressure window state for ONE corner. */
export function pressureStateFor(
  pressureKpa: number | undefined,
  coldPressureKpa: number | undefined,
  tunables: PredictionTunables = DEFAULT_PREDICTION_TUNABLES
): TirePressureState {
  if (!isPositive(pressureKpa)) return 'ok'
  if (isPositive(coldPressureKpa)) {
    if (pressureKpa < coldPressureKpa * tunables.pressureLowFracOfCold) return 'low'
    if (pressureKpa > coldPressureKpa * tunables.pressureHighFracOfCold) return 'high'
    return 'ok'
  }
  if (pressureKpa < tunables.pressureLowKpa) return 'low'
  if (pressureKpa > tunables.pressureHighKpa) return 'high'
  return 'ok'
}

/** Decide the temperature window state for ONE corner. */
export function tempStateFor(
  tempC: number | undefined,
  tunables: PredictionTunables = DEFAULT_PREDICTION_TUNABLES
): TireTempState {
  if (!isFiniteNum(tempC)) return 'optimal'
  if (tempC < tunables.tempColdC) return 'cold'
  if (tempC > tunables.tempHotC) return 'hot'
  return 'optimal'
}

// Axle-wide aggregation: a notable (non-neutral) corner wins, so one cold/hot or
// low/high tyre is surfaced rather than averaged away.
function aggregatePressureState(states: TirePressureState[]): TirePressureState {
  if (states.includes('high')) return 'high'
  if (states.includes('low')) return 'low'
  return 'ok'
}

function aggregateTempState(states: TireTempState[]): TireTempState {
  if (states.includes('hot')) return 'hot'
  if (states.includes('cold')) return 'cold'
  return 'optimal'
}

/**
 * Heuristic laps-until-cliff from the degradation trend (and tyre wear when
 * available). Returns `undefined` when there is no measurable degradation.
 */
export function lapsToCliffHeuristic(
  degSecPerLap: number,
  representativeWearPct: number | undefined,
  tunables: PredictionTunables = DEFAULT_PREDICTION_TUNABLES
): number | undefined {
  // Wear-based estimate: laps until wear reaches 100% at the current rate is not
  // available without a wear trend, so we lean on the lap-time degradation: how
  // many MORE laps until accumulated deg reaches the cliff threshold.
  if (degSecPerLap > 1e-3) {
    const laps = tunables.cliffDegSec / degSecPerLap
    if (isPositive(laps)) return round(Math.min(laps, 999), 1)
  }
  // Fallback: if tyres are already very worn, the cliff is imminent.
  if (isPositive(representativeWearPct) && representativeWearPct >= 0.9) return 0
  return undefined
}

/**
 * Robust projected lap time + confidence from recent laps. Trims the single
 * fastest & slowest sample (when >= 4) then means the rest; confidence grows
 * with sample count and shrinks with relative spread. Returns `{ projectedLapSec:
 * 0, confidence: 0 }` with no usable data.
 */
export function projectedLapFromRecent(recentLapTimes: number[] | undefined): PacePrediction {
  if (!Array.isArray(recentLapTimes)) return { projectedLapSec: 0, confidence: 0 }
  const clean = recentLapTimes.filter((t) => isPositive(t)).slice()
  if (clean.length === 0) return { projectedLapSec: 0, confidence: 0 }
  if (clean.length === 1) return { projectedLapSec: round(clean[0], 3), confidence: 0.2 }

  const sorted = clean.slice().sort((a, b) => a - b)
  const trimmed = sorted.length >= 4 ? sorted.slice(1, sorted.length - 1) : sorted
  const mean = trimmed.reduce((s, v) => s + v, 0) / trimmed.length

  // Relative spread (coefficient of variation) over the trimmed set.
  const variance = trimmed.reduce((s, v) => s + (v - mean) * (v - mean), 0) / trimmed.length
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 1
  const countScore = Math.min(clean.length / 6, 1)
  const spreadScore = Math.max(0, 1 - cv * 40) // ~2.5% CV → 0 confidence
  const confidence = round(Math.max(0, Math.min(1, countScore * spreadScore)), 2)

  return { projectedLapSec: round(mean, 3), confidence }
}

// ─── Top-level assembler ─────────────────────────────────────────────────────

/**
 * Compute the full `PredictionsSnapshot` from sampled inputs. Pure and total:
 * every field is populated with deterministic math; an optional `PaceModel`
 * (WS-L) only REFINES `pace.projectedLapSec` and `tire.lapsToCliff` when it
 * returns a finite value. Never throws.
 */
export function computePredictions(
  inputs: PredictionInputs,
  model?: PaceModel | null,
  tunables: PredictionTunables = DEFAULT_PREDICTION_TUNABLES
): PredictionsSnapshot {
  const recentLapTimes = inputs.recentLapTimes ?? []

  // ── pace ──
  let pace = projectedLapFromRecent(recentLapTimes)
  const tyres = inputs.tyres ?? []
  const representativeWearPct = averageDefined(tyres.map((t) => t?.wearPct))
  if (model) {
    const features: PaceFeatures = {
      recentLapTimes,
      tyreWearPct: representativeWearPct,
      fuelLevelL: inputs.fuelLevelL,
      trackTempC: inputs.trackTempC,
      lapsOnStint: inputs.lapsOnStint
    }
    const learned = safeModelCall(() => model.predictLapSec(features))
    if (isPositive(learned)) {
      // Blend: trust the model but keep a confidence floor so the UI shows a value.
      pace = { projectedLapSec: round(learned, 3), confidence: Math.max(pace.confidence, 0.5) }
    }
  }

  // Lap time used for ETA conversions: prefer projected, else last clean lap.
  const lapTimeSec = isPositive(pace.projectedLapSec)
    ? pace.projectedLapSec
    : isPositive(inputs.lapTimeSec)
      ? inputs.lapTimeSec
      : lastPositive(recentLapTimes)

  // ── catch-up ──
  const aheadClosing = gapClosingSecPerLap(inputs.aheadGapSamples)
  const behindClosing = gapClosingSecPerLap(inputs.behindGapSamples)
  const aheadGapNow = lastGap(inputs.aheadGapSamples)
  const behindGapNow = lastGap(inputs.behindGapSamples)

  const catchAhead = catchEstimate(inputs.aheadCarIdx, aheadGapNow, aheadClosing, lapTimeSec, tunables)
  const caughtBehind = catchEstimate(inputs.behindCarIdx, behindGapNow, behindClosing, lapTimeSec, tunables)

  // ── fuel ──
  const fuel = fuelPrediction({
    fuelLevelL: inputs.fuelLevelL,
    fuelPerLap: inputs.fuelPerLap,
    lapsRemaining: inputs.lapsRemaining,
    sessionTimeRemainingSec: inputs.sessionTimeRemainingSec,
    lapTimeSec
  })

  // ── tyre ──
  const degSecPerLap = tireDegSecPerLap(recentLapTimes)
  const pressureState = aggregatePressureState(
    tyres.map((t) => pressureStateFor(t?.pressureKpa, t?.coldPressureKpa, tunables))
  )
  const tempState = aggregateTempState(tyres.map((t) => tempStateFor(t?.tempC, tunables)))

  let lapsToCliff = lapsToCliffHeuristic(degSecPerLap, representativeWearPct, tunables)
  if (model) {
    const features: PaceFeatures = {
      recentLapTimes,
      tyreWearPct: representativeWearPct,
      fuelLevelL: inputs.fuelLevelL,
      trackTempC: inputs.trackTempC,
      lapsOnStint: inputs.lapsOnStint
    }
    const learnedCliff = safeModelCall(() => model.lapsToCliff(features))
    if (isFiniteNum(learnedCliff) && learnedCliff >= 0) lapsToCliff = round(learnedCliff, 1)
  }

  const tire: TirePrediction = {
    degSecPerLap,
    ...(lapsToCliff !== undefined ? { lapsToCliff } : {}),
    pressureState,
    tempState
  }

  return {
    ...(catchAhead ? { catchAhead } : {}),
    ...(caughtBehind ? { caughtBehind } : {}),
    fuel,
    tire,
    pace
  }
}

// ─── small numeric utilities ─────────────────────────────────────────────────

function round(value: number, decimals: number): number {
  if (!isFiniteNum(value)) return 0
  const f = 10 ** decimals
  return Math.round(value * f) / f
}

function lastPositive(values: number[] | undefined): number | undefined {
  if (!Array.isArray(values)) return undefined
  for (let i = values.length - 1; i >= 0; i -= 1) if (isPositive(values[i])) return values[i]
  return undefined
}

function lastGap(samples: GapSample[] | undefined): number | undefined {
  if (!Array.isArray(samples)) return undefined
  for (let i = samples.length - 1; i >= 0; i -= 1) if (isSaneGap(samples[i]?.gapSec)) return samples[i].gapSec
  return undefined
}

function averageDefined(values: Array<number | undefined>): number | undefined {
  const clean = values.filter((v): v is number => isFiniteNum(v))
  if (clean.length === 0) return undefined
  return clean.reduce((s, v) => s + v, 0) / clean.length
}

function safeModelCall(fn: () => number | null): number | null {
  try {
    return fn()
  } catch {
    return null
  }
}
