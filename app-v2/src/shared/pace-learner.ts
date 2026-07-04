// PACE LEARNER (WS-L) — a PURE, dependency-free online regressor that PERSONALIZES
// a pace / tyre-degradation model to the user's OWN laps.
//
// Design goals (per plan WS-L):
//   • NO Python, NO heavy training, NO model runtime. Plain TypeScript math.
//   • Incremental / online: learns continuously, one CLEAN lap at a time.
//   • Tiny + CPU-trivial + deterministic → safe to run in the main process,
//     NEVER inside the telemetry tick (the owning module calls `update()` once
//     per completed lap).
//   • Serializable so the owning module can persist one learner per car+track.
//
// The core is a Recursive-Least-Squares (RLS) ridge regressor mapping a small
// feature row (tyre wear, fuel load, laps-on-stint, track temp) → lap time in
// seconds, plus a dedicated 1-D incremental fit of lap time vs laps-on-stint that
// yields a degradation slope (sec/lap) → `lapsToCliff`.
//
// This file is dependency-free (no node:*, no electron) exactly like
// shared/predictions.ts, so it imports cleanly into main, renderer AND tests.

import type { PaceFeatures } from './predictions'

// ─── tunables (fixed, deterministic) ─────────────────────────────────────────

/** Reference/scale constants used to center & scale features for numerical
 * stability. The RLS bias term absorbs the absolute lap time, so a missing
 * optional feature maps to its reference (a neutral 0 contribution). */
const FUEL_REF_L = 40
const FUEL_SCALE_L = 40
const STINT_SCALE_LAPS = 15
const TEMP_REF_C = 25
const TEMP_SCALE_C = 15

/** Ridge prior: P0 = (1/RIDGE) * I. Small ridge → quick personalization. */
const RIDGE = 1e-2
/** Forgetting factor (1 = remember everything; <1 weights recent laps more). */
const DEFAULT_FORGETTING = 1.0

/** Confidence ramp: below MIN we defer to the deterministic engine; at FULL we
 * trust the model fully (subject to residual quality). */
const MIN_SAMPLES = 5
const FULL_SAMPLES = 20
/** Residual tolerance (s) used to discount confidence when the fit is noisy. */
const RMSE_TOL_SEC = 0.3
/** EWMA weight for the residual estimate (recent laps dominate). */
const RESID_ALPHA = 0.15

/** Robust outlier gate (rejects in/out laps, incidents, traffic laps). */
const GATE_BUFFER = 12
const GATE_MIN_FOR_STATS = 4
const OUTLIER_K = 4
const OUTLIER_FLOOR_SEC = 0.5
const ABS_MIN_LAP_SEC = 5
const ABS_MAX_LAP_SEC = 1200

/** lapsToCliff heuristic: the "cliff" is when cumulative degradation has cost
 * this many seconds relative to fresh tyres. Refined by the LEARNED slope. */
const DEFAULT_CLIFF_MARGIN_SEC = 1.5
/** A learned degradation slope below this (sec/lap) is treated as "no cliff". */
const MIN_DEG_SLOPE_SEC = 0.01

// Feature row layout (excluding the implicit leading bias term).
const FEATURE_DIM = 4 // wear, fuel, stint, temp
const DIM = FEATURE_DIM + 1 // + bias

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * Build the (centered/scaled) feature row from a `PaceFeatures`. The leading
 * bias term (1) is prepended. Missing optional features map to their reference
 * value (i.e. a neutral 0 after centering), so the model degrades gracefully.
 */
export function featureRow(f: PaceFeatures): number[] {
  const wear = isFiniteNum(f.tyreWearPct) ? clamp(f.tyreWearPct, 0, 1) : 0
  const fuel = isFiniteNum(f.fuelLevelL) ? (f.fuelLevelL - FUEL_REF_L) / FUEL_SCALE_L : 0
  const stint = isFiniteNum(f.lapsOnStint) ? f.lapsOnStint / STINT_SCALE_LAPS : 0
  const temp = isFiniteNum(f.trackTempC) ? (f.trackTempC - TEMP_REF_C) / TEMP_SCALE_C : 0
  return [1, wear, fuel, stint, temp]
}

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b)
  const n = s.length
  if (n === 0) return 0
  const mid = n >> 1
  return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Median absolute deviation (robust spread). */
function mad(values: number[], med: number): number {
  if (values.length === 0) return 0
  return median(values.map((v) => Math.abs(v - med)))
}

export interface PaceLearnerOptions {
  /** RLS forgetting factor in (0, 1]. Default 1 (no forgetting). */
  forgetting?: number
  /** Seconds of cumulative degradation that define the tyre "cliff". */
  cliffMarginSec?: number
}

export interface PacePredictResult {
  /** Predicted clean lap time, seconds. */
  lapSec: number
  /** 0..1 confidence from sample count and residual quality. */
  confidence: number
  /** Number of clean laps learned so far. */
  samples: number
}

/** Serialized form — small, JSON-safe, versioned for forward-compat. */
export interface PaceLearnerState {
  v: 1
  dim: number
  forgetting: number
  cliffMarginSec: number
  w: number[]
  p: number[][]
  n: number
  // residual tracking (EWMA of squared a-priori errors)
  residMs: number
  residSeen: number
  // 1-D degradation fit: lapTime vs lapsOnStint
  deg: { n: number; sx: number; sy: number; sxx: number; sxy: number }
  // robust outlier gate ring buffer (recent accepted lap times)
  lapBuf: number[]
}

/**
 * Online ridge/RLS pace learner. One instance per (car+track). Feed it ONLY
 * clean green laps via `update()`; query it via `predict()` / `lapsToCliff()`.
 */
export class PaceLearner {
  private w: number[]
  private p: number[][]
  private n = 0
  // EWMA of squared a-priori prediction error → reflects CURRENT fit quality
  // (forgets early warmup transients as the model converges).
  private residMs = 0
  private residSeen = 0
  private deg = { n: 0, sx: 0, sy: 0, sxx: 0, sxy: 0 }
  private lapBuf: number[] = []
  private readonly forgetting: number
  private readonly cliffMarginSec: number

  constructor(options: PaceLearnerOptions = {}) {
    this.forgetting = clamp(options.forgetting ?? DEFAULT_FORGETTING, 0.5, 1)
    this.cliffMarginSec =
      isFiniteNum(options.cliffMarginSec) && options.cliffMarginSec > 0
        ? options.cliffMarginSec
        : DEFAULT_CLIFF_MARGIN_SEC
    this.w = new Array(DIM).fill(0)
    this.p = identity(DIM, 1 / RIDGE)
  }

  /** Clean laps learned so far. */
  get sampleCount(): number {
    return this.n
  }

  /**
   * Decide whether `lapTimeSec` looks like a clean green lap or an outlier
   * (in/out lap, incident, traffic). Pure; used internally by `update()` and
   * exposed so callers can pre-screen. Returns false for non-finite / insane
   * values, or values far from the robust recent median.
   */
  isOutlier(lapTimeSec: number): boolean {
    if (!isFiniteNum(lapTimeSec)) return true
    if (lapTimeSec < ABS_MIN_LAP_SEC || lapTimeSec > ABS_MAX_LAP_SEC) return true
    if (this.lapBuf.length < GATE_MIN_FOR_STATS) return false
    const med = median(this.lapBuf)
    const sigma = 1.4826 * mad(this.lapBuf, med)
    const tol = Math.max(OUTLIER_FLOOR_SEC, OUTLIER_K * sigma)
    return Math.abs(lapTimeSec - med) > tol
  }

  /**
   * Learn from one CLEAN lap. Returns true if the sample was accepted (used to
   * update the model) or false if it was rejected as an outlier / invalid.
   * Deterministic and O(DIM^2) — trivial CPU.
   */
  update(features: PaceFeatures, lapTimeSec: number): boolean {
    if (this.isOutlier(lapTimeSec)) return false

    const x = featureRow(features)
    const y = lapTimeSec

    // a-priori prediction error (before this sample updates the weights).
    const yhat = dot(this.w, x)
    const err = y - yhat
    if (this.n >= MIN_SAMPLES) {
      const sq = err * err
      this.residMs = this.residSeen === 0 ? sq : (1 - RESID_ALPHA) * this.residMs + RESID_ALPHA * sq
      this.residSeen += 1
    }

    // ── RLS update ──
    const ff = this.forgetting
    const px = matVec(this.p, x) // P x
    const denom = ff + dot(x, px)
    if (!isFiniteNum(denom) || denom <= 0) return false
    const k = px.map((v) => v / denom) // gain
    for (let i = 0; i < DIM; i++) this.w[i] += k[i] * err
    // P = (P - k (Px)^T) / ff
    for (let i = 0; i < DIM; i++) {
      for (let j = 0; j < DIM; j++) {
        this.p[i][j] = (this.p[i][j] - k[i] * px[j]) / ff
      }
    }
    // keep P symmetric (guards against numeric drift).
    symmetrize(this.p)

    // ── 1-D degradation fit (lapTime vs lapsOnStint) ──
    if (isFiniteNum(features.lapsOnStint)) {
      const xl = features.lapsOnStint
      this.deg.n += 1
      this.deg.sx += xl
      this.deg.sy += y
      this.deg.sxx += xl * xl
      this.deg.sxy += xl * y
    }

    // ── robust gate buffer ──
    this.lapBuf.push(y)
    if (this.lapBuf.length > GATE_BUFFER) this.lapBuf.shift()

    this.n += 1
    return true
  }

  /**
   * Predict a clean lap time + confidence. Returns confidence 0 (and the linear
   * estimate) when under-trained; callers should defer to the deterministic
   * engine until confidence clears their threshold.
   */
  predict(features: PaceFeatures): PacePredictResult {
    const lapSec = dot(this.w, featureRow(features))
    return { lapSec, confidence: this.confidence(), samples: this.n }
  }

  /** 0..1 confidence from sample count and residual RMSE. */
  confidence(): number {
    if (this.n < MIN_SAMPLES) return 0
    const nFactor = clamp((this.n - MIN_SAMPLES) / (FULL_SAMPLES - MIN_SAMPLES), 0, 1)
    const rmse = this.residSeen > 0 ? Math.sqrt(this.residMs) : 0
    const residFactor = 1 / (1 + rmse / RMSE_TOL_SEC)
    return clamp(nFactor * residFactor, 0, 1)
  }

  /**
   * Learned tyre-degradation slope (seconds added per lap of stint), or null if
   * there isn't enough spread of stint laps to fit a line. Robust to noise.
   */
  degradationSlopeSecPerLap(): number | null {
    const { n, sx, sy, sxx, sxy } = this.deg
    if (n < 3) return null
    const denom = n * sxx - sx * sx
    if (!isFiniteNum(denom) || Math.abs(denom) < 1e-9) return null
    const slope = (n * sxy - sx * sy) / denom
    if (!isFiniteNum(slope)) return null
    return slope
  }

  /**
   * Estimated laps remaining until the tyre cliff, given the current stint
   * position. Uses the LEARNED degradation slope; returns null when the slope
   * is unknown or negligible (so the engine keeps its heuristic).
   */
  lapsToCliff(features: PaceFeatures): number | null {
    const slope = this.degradationSlopeSecPerLap()
    if (slope === null || slope < MIN_DEG_SLOPE_SEC) return null
    const lapsAtFullCliff = this.cliffMarginSec / slope
    const current = isFiniteNum(features.lapsOnStint) ? Math.max(0, features.lapsOnStint) : 0
    return Math.max(0, lapsAtFullCliff - current)
  }

  // ── persistence ──

  toJSON(): PaceLearnerState {
    return {
      v: 1,
      dim: DIM,
      forgetting: this.forgetting,
      cliffMarginSec: this.cliffMarginSec,
      w: this.w.slice(),
      p: this.p.map((row) => row.slice()),
      n: this.n,
      residMs: this.residMs,
      residSeen: this.residSeen,
      deg: { ...this.deg },
      lapBuf: this.lapBuf.slice()
    }
  }

  /**
   * Rehydrate a learner from a serialized state. Returns a fresh learner if the
   * state is missing/corrupt/incompatible (defensive — never throws).
   */
  static fromJSON(state: unknown, options: PaceLearnerOptions = {}): PaceLearner {
    const learner = new PaceLearner(options)
    if (!isState(state)) return learner
    try {
      learner.w = state.w.slice()
      learner.p = state.p.map((row) => row.slice())
      learner.n = state.n
      learner.residMs = state.residMs
      learner.residSeen = state.residSeen
      learner.deg = { ...state.deg }
      learner.lapBuf = state.lapBuf.slice()
    } catch {
      return new PaceLearner(options)
    }
    return learner
  }
}

// ─── tiny linear-algebra helpers (DIM is tiny, so this is trivial) ────────────

function identity(d: number, scale: number): number[][] {
  const m: number[][] = []
  for (let i = 0; i < d; i++) {
    const row = new Array(d).fill(0)
    row[i] = scale
    m.push(row)
  }
  return m
}

function dot(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

function matVec(m: number[][], x: number[]): number[] {
  const out = new Array(m.length).fill(0)
  for (let i = 0; i < m.length; i++) {
    let s = 0
    const row = m[i]
    for (let j = 0; j < row.length; j++) s += row[j] * x[j]
    out[i] = s
  }
  return out
}

function symmetrize(m: number[][]): void {
  for (let i = 0; i < m.length; i++) {
    for (let j = i + 1; j < m.length; j++) {
      const avg = (m[i][j] + m[j][i]) / 2
      m[i][j] = avg
      m[j][i] = avg
    }
  }
}

function isState(s: unknown): s is PaceLearnerState {
  if (typeof s !== 'object' || s === null) return false
  const st = s as Record<string, unknown>
  return (
    st.v === 1 &&
    Array.isArray(st.w) &&
    st.w.length === DIM &&
    Array.isArray(st.p) &&
    st.p.length === DIM &&
    typeof st.n === 'number' &&
    typeof st.residMs === 'number' &&
    typeof st.residSeen === 'number' &&
    typeof st.deg === 'object' &&
    st.deg !== null &&
    Array.isArray(st.lapBuf)
  )
}
