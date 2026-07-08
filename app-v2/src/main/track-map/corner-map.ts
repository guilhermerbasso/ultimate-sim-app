// Corner map — auto-detect & number the corners (Turn 1..N) of a track from a
// single clean lap of telemetry.
//
// This module is the deterministic, PURE, unit-testable brain behind per-corner
// coaching (WS-E). It turns a lap of reduced telemetry (speed / brake / throttle
// / steering keyed by `lapDistPct`) into a numbered list of corners and exposes a
// getter that maps any `lapDistPct` back to its corner index (+ the corner's
// extent). It does NOT touch the filesystem — persistence lives in the learner,
// which owns the lap acquisition and disk cache.
//
// Detection pipeline (all on a fixed `lapDistPct` grid so the output is
// deterministic regardless of sample timing):
//   1. Resample the lap to a regular grid of bins (carry-forward empty bins).
//   2. Smooth the speed trace on the ring (lap is a closed loop).
//   3. Find significant local speed MINIMA by prominence — each minimum is a
//      corner apex. Merge minima that sit too close together.
//   4. For each apex walk out to the entry (where braking / the speed drop
//      begins) and the exit (where throttle is reapplied / speed recovers).
//   5. Sort the apexes along `lapDistPct` and number them 1..N.

/** One reduced telemetry frame the corner detector consumes. */
export interface CornerSample {
  /** 0..1 fraction of the lap. */
  lapDistPct: number
  speedKmh: number
  /** 0..1 brake input (optional — improves entry detection when present). */
  brake?: number
  /** 0..1 throttle input (optional — improves exit detection when present). */
  throttle?: number
  /** Absolute steering angle in degrees (optional — improves turn-in detection). */
  steerAbsDeg?: number
}

/** A single auto-numbered corner. */
export interface Corner {
  /** 1-based corner number, sequential along `lapDistPct` (Turn 1..N). */
  index: number
  /** Entry point (braking / turn-in begins), 0..1. */
  startPct: number
  /** Apex (speed minimum), 0..1. */
  apexPct: number
  /** Exit point (throttle reapplied / speed recovers), 0..1. */
  endPct: number
  minSpeedKmh: number
  entrySpeedKmh: number
  exitSpeedKmh: number
}

/** Tunable, exported so the learner, the coach and the tests share one source. */
export interface CornerMapConfig {
  /** Number of regular `lapDistPct` bins used for detection. */
  bins: number
  /** Circular moving-average half-window (in bins) used to smooth speed. */
  smoothWindow: number
  /** A corner requires a speed dip of at least this (km/h) below its shoulders. */
  minProminenceKmh: number
  /** Apexes closer than this fraction of the lap are merged into one corner. */
  minCornerGapPct: number
  /** Brake input considered "on" when locating the entry. */
  brakeOn: number
  /** Throttle input considered "on" when locating the exit. */
  throttleOn: number
  /** Steering (deg) considered a committed turn-in. */
  turnInDeg: number
}

export const DEFAULT_CORNER_MAP_CONFIG: CornerMapConfig = {
  bins: 200,
  smoothWindow: 3,
  minProminenceKmh: 12,
  minCornerGapPct: 0.02,
  brakeOn: 0.12,
  throttleOn: 0.2,
  turnInDeg: 8
}

/** Persisted / served corner map for one track configuration. */
export interface CornerMapData {
  version: 1
  trackName: string
  /** iRacing TrackConfigName (track LAYOUT) this map was learned on, if any. Two
   *  layouts of one track must not share a corner map. Undefined = single-config
   *  track (backward-compatible with maps persisted before layout keying). */
  trackConfigName?: string
  /** Stable key derived from the detection config (`trackName + config`). */
  configKey: string
  corners: Corner[]
  generatedAt: number
  /** Number of samples the map was learned from (diagnostic). */
  sampleCount: number
}

/** Stable cache/persistence key for a track LAYOUT: the display name plus the
 *  optional iRacing TrackConfigName. Keeps two layouts of one track (e.g.
 *  Silverstone GP vs International) from sharing a corner map. Backward-compatible:
 *  no config → just the (trimmed) track name, so pre-layout keys/files still match. */
export function trackLayoutKey(trackName: string, trackConfigName?: string | null): string {
  const name = (trackName ?? '').trim()
  const config = (trackConfigName ?? '').trim()
  return config ? `${name} :: ${config}` : name
}

/** A stable, short key for a detection config so a config change re-learns the map. */
export function cornerConfigKey(cfg: CornerMapConfig): string {
  return [
    `b${cfg.bins}`,
    `w${cfg.smoothWindow}`,
    `p${cfg.minProminenceKmh}`,
    `g${cfg.minCornerGapPct}`,
    `k${cfg.brakeOn}`,
    `t${cfg.throttleOn}`,
    `s${cfg.turnInDeg}`
  ].join('-')
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 0.999999
  return value
}

interface BinGrid {
  speed: number[]
  brake: number[]
  throttle: number[]
  steer: number[]
}

/** Resample the lap onto a regular `lapDistPct` grid (carry-forward empty bins). */
function resampleToBins(samples: CornerSample[], bins: number): BinGrid | null {
  if (samples.length < 4 || bins < 8) return null
  const speedSum = new Array(bins).fill(0)
  const brakeSum = new Array(bins).fill(0)
  const throttleSum = new Array(bins).fill(0)
  const steerSum = new Array(bins).fill(0)
  const count = new Array(bins).fill(0)
  for (const s of samples) {
    if (!Number.isFinite(s.speedKmh)) continue
    const bin = Math.min(bins - 1, Math.floor(clamp01(s.lapDistPct) * bins))
    speedSum[bin] += s.speedKmh
    brakeSum[bin] += Number.isFinite(s.brake) ? (s.brake as number) : 0
    throttleSum[bin] += Number.isFinite(s.throttle) ? (s.throttle as number) : 0
    steerSum[bin] += Number.isFinite(s.steerAbsDeg) ? (s.steerAbsDeg as number) : 0
    count[bin] += 1
  }
  const speed = new Array(bins).fill(NaN)
  const brake = new Array(bins).fill(0)
  const throttle = new Array(bins).fill(0)
  const steer = new Array(bins).fill(0)
  for (let b = 0; b < bins; b += 1) {
    if (count[b] > 0) {
      speed[b] = speedSum[b] / count[b]
      brake[b] = brakeSum[b] / count[b]
      throttle[b] = throttleSum[b] / count[b]
      steer[b] = steerSum[b] / count[b]
    }
  }
  // Carry-forward / back-fill empty bins on the ring so detection sees a dense trace.
  let filledAny = false
  for (let b = 0; b < bins; b += 1) {
    if (Number.isFinite(speed[b])) {
      filledAny = true
      break
    }
  }
  if (!filledAny) return null
  for (let b = 0; b < bins; b += 1) {
    if (!Number.isFinite(speed[b])) {
      const prev = (b - 1 + bins) % bins
      speed[b] = Number.isFinite(speed[prev]) ? speed[prev] : 0
      brake[b] = brake[prev]
      throttle[b] = throttle[prev]
      steer[b] = steer[prev]
    }
  }
  // A second forward pass closes the seam (bin 0 may have started empty).
  for (let b = 0; b < bins; b += 1) {
    if (!Number.isFinite(speed[b])) {
      const prev = (b - 1 + bins) % bins
      speed[b] = speed[prev]
    }
  }
  return { speed, brake, throttle, steer }
}

/** Circular moving-average smoother (lap is a closed ring). */
function smoothRing(values: number[], halfWindow: number): number[] {
  const n = values.length
  if (n === 0 || halfWindow <= 0) return values.slice()
  const out = new Array(n).fill(0)
  for (let i = 0; i < n; i += 1) {
    let sum = 0
    let cnt = 0
    for (let k = -halfWindow; k <= halfWindow; k += 1) {
      sum += values[(i + k + n) % n]
      cnt += 1
    }
    out[i] = sum / cnt
  }
  return out
}

interface ApexCandidate {
  bin: number
  speed: number
  prominence: number
}

/** Local minima of the speed ring with a prominence at least `minProminence`. */
function findApexes(speed: number[], minProminence: number): ApexCandidate[] {
  const n = speed.length
  const out: ApexCandidate[] = []
  for (let i = 0; i < n; i += 1) {
    const here = speed[i]
    const prev = speed[(i - 1 + n) % n]
    const next = speed[(i + 1) % n]
    // Strict-ish local minimum (allow a flat shoulder on one side only).
    if (!(here <= prev && here <= next && (here < prev || here < next))) continue
    // Prominence: rise to the nearest higher saddle on each side of the ring.
    const leftRise = ringRise(speed, i, -1)
    const rightRise = ringRise(speed, i, +1)
    const prominence = Math.min(leftRise, rightRise)
    if (prominence >= minProminence) out.push({ bin: i, speed: here, prominence })
  }
  return out
}

/** Climb from `start` in `dir` until the trace turns back down; return the rise. */
function ringRise(speed: number[], start: number, dir: number): number {
  const n = speed.length
  const base = speed[start]
  let peak = base
  // Walk at most half the ring (a corner can't span more than that meaningfully).
  for (let step = 1; step <= Math.floor(n / 2); step += 1) {
    const idx = (start + dir * step + n * step) % n
    const v = speed[idx]
    if (v > peak) peak = v
    // Stop once we start descending into the next corner (past a local max).
    const nextIdx = (start + dir * (step + 1) + n * (step + 1)) % n
    if (speed[nextIdx] < v && v >= peak) break
  }
  return peak - base
}

/** Drop apexes that sit within `minGapBins` of a stronger (deeper) apex. */
function mergeApexes(apexes: ApexCandidate[], bins: number, minGapPct: number): ApexCandidate[] {
  const minGapBins = Math.max(1, Math.round(minGapPct * bins))
  const sorted = apexes.slice().sort((a, b) => a.speed - b.speed) // deepest first
  const kept: ApexCandidate[] = []
  for (const cand of sorted) {
    let tooClose = false
    for (const k of kept) {
      const d = Math.abs(cand.bin - k.bin)
      const ringDist = Math.min(d, bins - d)
      if (ringDist < minGapBins) {
        tooClose = true
        break
      }
    }
    if (!tooClose) kept.push(cand)
  }
  return kept
}

/** Walk back from the apex to the corner entry (braking / speed-drop onset). */
function findEntryBin(grid: BinGrid, apexBin: number, cfg: CornerMapConfig): number {
  const n = grid.speed.length
  const maxSpan = Math.floor(n / 2)
  let entry = apexBin
  for (let step = 1; step <= maxSpan; step += 1) {
    const idx = (apexBin - step + n) % n
    const onBrake = grid.brake[idx] > cfg.brakeOn
    const onTurn = grid.steer[idx] > cfg.turnInDeg
    const rising = grid.speed[idx] > grid.speed[(idx + 1) % n]
    if (onBrake || onTurn || rising) {
      entry = idx
    }
    // Stop once speed has recovered well above the apex AND we're off the brake:
    // we've reached the preceding straight.
    if (!onBrake && grid.speed[idx] > grid.speed[apexBin] + cfg.minProminenceKmh) break
  }
  return entry
}

/** Walk forward from the apex to the corner exit (throttle reapplied / recovery). */
function findExitBin(grid: BinGrid, apexBin: number, cfg: CornerMapConfig): number {
  const n = grid.speed.length
  const maxSpan = Math.floor(n / 2)
  let exit = apexBin
  for (let step = 1; step <= maxSpan; step += 1) {
    const idx = (apexBin + step) % n
    const onThrottle = grid.throttle[idx] > cfg.throttleOn
    const recovered = grid.speed[idx] > grid.speed[apexBin] + cfg.minProminenceKmh
    exit = idx
    if (onThrottle && recovered) break
    if (recovered) break
  }
  return exit
}

function binToPct(bin: number, bins: number): number {
  return clamp01((bin + 0.5) / bins)
}

/** PURE: detect & number the corners of a lap. Empty array when the lap is unusable. */
export function detectCorners(samples: CornerSample[], cfg: CornerMapConfig = DEFAULT_CORNER_MAP_CONFIG): Corner[] {
  const grid = resampleToBins(samples, cfg.bins)
  if (!grid) return []
  const smoothed = smoothRing(grid.speed, cfg.smoothWindow)
  const apexes = mergeApexes(findApexes(smoothed, cfg.minProminenceKmh), cfg.bins, cfg.minCornerGapPct)
  if (apexes.length === 0) return []
  // Number sequentially along the lap.
  const ordered = apexes.slice().sort((a, b) => a.bin - b.bin)
  const corners: Corner[] = []
  ordered.forEach((apex, i) => {
    const entryBin = findEntryBin(grid, apex.bin, cfg)
    const exitBin = findExitBin(grid, apex.bin, cfg)
    const apexPct = binToPct(apex.bin, cfg.bins)
    let startPct = binToPct(entryBin, cfg.bins)
    let endPct = binToPct(exitBin, cfg.bins)
    // Keep the extent non-wrapping and ordered around the apex for a clean,
    // non-overlapping `lapDistPct → corner` mapping.
    if (startPct > apexPct) startPct = Math.max(0, apexPct - 1 / cfg.bins)
    if (endPct < apexPct) endPct = Math.min(0.999999, apexPct + 1 / cfg.bins)
    corners.push({
      index: i + 1,
      startPct,
      apexPct,
      endPct,
      minSpeedKmh: Math.round(smoothed[apex.bin]),
      entrySpeedKmh: Math.round(smoothed[entryBin]),
      exitSpeedKmh: Math.round(smoothed[exitBin])
    })
  })
  return clampNonOverlapping(corners)
}

/** Trim adjacent corner extents so they don't overlap (keeps the mapping clean). */
function clampNonOverlapping(corners: Corner[]): Corner[] {
  for (let i = 1; i < corners.length; i += 1) {
    const prev = corners[i - 1]
    const cur = corners[i]
    if (cur.startPct < prev.endPct) {
      const mid = (prev.apexPct + cur.apexPct) / 2
      prev.endPct = Math.max(prev.apexPct, Math.min(prev.endPct, mid))
      cur.startPct = Math.min(cur.apexPct, Math.max(cur.startPct, mid))
    }
  }
  return corners
}

/** PURE: assemble a full corner map for a track from a lap of samples. */
export function buildCornerMap(
  trackName: string,
  samples: CornerSample[],
  cfg: CornerMapConfig = DEFAULT_CORNER_MAP_CONFIG,
  now: number = Date.now(),
  trackConfigName?: string
): CornerMapData {
  const config = (trackConfigName ?? '').trim()
  return {
    version: 1,
    trackName,
    ...(config ? { trackConfigName: config } : {}),
    configKey: cornerConfigKey(cfg),
    corners: detectCorners(samples, cfg),
    generatedAt: now,
    sampleCount: samples.length
  }
}

/** The corner that owns `lapDistPct` (within its [start,end] extent), or null on a straight. */
export function cornerAt(corners: Corner[] | null | undefined, lapDistPct: number): Corner | null {
  if (!Array.isArray(corners) || corners.length === 0) return null
  if (!Number.isFinite(lapDistPct)) return null
  const pct = clamp01(lapDistPct)
  for (const c of corners) {
    if (pct >= c.startPct && pct < c.endPct) return c
  }
  return null
}

/** 1-based corner index for `lapDistPct`, or null on a straight. */
export function cornerIndexAt(corners: Corner[] | null | undefined, lapDistPct: number): number | null {
  return cornerAt(corners, lapDistPct)?.index ?? null
}

/** Validate a hydrated corner-map record (defensive against corrupt cache files). */
export function isValidCornerMap(value: unknown): value is CornerMapData {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<CornerMapData>
  return (
    v.version === 1 &&
    typeof v.trackName === 'string' &&
    (v.trackConfigName === undefined || typeof v.trackConfigName === 'string') &&
    typeof v.configKey === 'string' &&
    Array.isArray(v.corners) &&
    v.corners.every(
      (c) =>
        c &&
        typeof c.index === 'number' &&
        Number.isFinite(c.startPct) &&
        Number.isFinite(c.apexPct) &&
        Number.isFinite(c.endPct)
    )
  )
}
