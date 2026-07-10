const DEFAULT_ALPHA = 0.2
const DEFAULT_OUTLIER_K = 3
const DEFAULT_MAX_LAPS = 5
const SAMPLE_WINDOW = 31
const EPS = 1e-9

export interface RobustMetric {
  n: number
  median: number
  mad: number
  ema: number
  lastUpdated: number
  /**
   * Bounded retained sample window used to recompute deterministic median/MAD.
   * This is an intentionally small approximation of full-history robust stats so
   * persistence stays compact while clean-lap style changes can still adapt.
   */
  samples?: number[]
}

export function updateRobustMetric(prev: RobustMetric | undefined, sample: number, alpha = DEFAULT_ALPHA): RobustMetric {
  if (!Number.isFinite(sample)) {
    return prev ? cloneMetric(prev) : emptyMetric()
  }

  const baselinePrev = prev && prev.n > 0 ? prev : undefined
  const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : DEFAULT_ALPHA
  const samples = [...(baselinePrev?.samples ?? (baselinePrev && Number.isFinite(baselinePrev.median) ? [baselinePrev.median] : [])), sample]
    .filter(Number.isFinite)
    .slice(-SAMPLE_WINDOW)
  const median = calcMedian(samples)
  const deviations = samples.map((v) => Math.abs(v - median))
  const mad = calcMedian(deviations)
  return {
    n: (baselinePrev?.n ?? 0) + 1,
    median,
    mad,
    ema: baselinePrev ? a * sample + (1 - a) * baselinePrev.ema : sample,
    lastUpdated: Date.now(),
    samples
  }
}

export function robustZ(metric: RobustMetric, sample: number): number {
  if (!Number.isFinite(sample) || !isFiniteMetric(metric)) return Number.POSITIVE_INFINITY
  return Math.abs(sample - metric.median) / Math.max(EPS, 1.4826 * metric.mad)
}

export function isOutlier(metric: RobustMetric, sample: number, k = DEFAULT_OUTLIER_K): boolean {
  const threshold = Number.isFinite(k) && k > 0 ? k : DEFAULT_OUTLIER_K
  return robustZ(metric, sample) > threshold
}

export interface RepetitionTracker {
  laps: { lap: number; keys: string[] }[]
}

export function recordLapEvents(
  tracker: RepetitionTracker,
  lap: number,
  eventKeys: string[],
  maxLaps = DEFAULT_MAX_LAPS
): RepetitionTracker {
  const cap = Number.isInteger(maxLaps) && maxLaps > 0 ? maxLaps : DEFAULT_MAX_LAPS
  const keys = [...new Set(eventKeys.filter((k): k is string => typeof k === 'string' && k.trim().length > 0))]
  const laps = [...(isValidRepetitionTracker(tracker) ? tracker.laps : []), { lap, keys }].slice(-cap)
  return { laps }
}

export function isRepeated(
  tracker: RepetitionTracker,
  eventKey: string,
  opts: { minOfLast3?: number; minOfLast5?: number } = {}
): boolean {
  if (!isValidRepetitionTracker(tracker) || !eventKey) return false
  const min3 = opts.minOfLast3 ?? 2
  const min5 = opts.minOfLast5 ?? 3
  return countInLast(tracker, eventKey, 3) >= min3 || countInLast(tracker, eventKey, 5) >= min5
}

export interface CoachBaseline {
  version: 1
  trackLayoutKey: string
  carName?: string
  corners: Record<string, Record<string, RobustMetric>>
  repetition: RepetitionTracker
  updatedAt: number
}

export function emptyBaseline(trackLayoutKey: string, carName?: string): CoachBaseline {
  const car = typeof carName === 'string' && carName.trim() ? carName.trim() : undefined
  return {
    version: 1,
    trackLayoutKey,
    ...(car ? { carName: car } : {}),
    corners: {},
    repetition: { laps: [] },
    updatedAt: Date.now()
  }
}

export function isValidCoachBaseline(v: unknown): v is CoachBaseline {
  if (!isObject(v)) return false
  if (v.version !== 1 || typeof v.trackLayoutKey !== 'string') return false
  if (v.carName !== undefined && typeof v.carName !== 'string') return false
  if (!isObject(v.corners) || !isValidRepetitionTracker(v.repetition)) return false
  if (typeof v.updatedAt !== 'number' || !Number.isFinite(v.updatedAt)) return false

  return Object.values(v.corners).every(
    (metrics) => isObject(metrics) && Object.values(metrics).every(isFiniteMetric)
  )
}

function countInLast(tracker: RepetitionTracker, eventKey: string, n: number): number {
  return tracker.laps.slice(-n).filter((lap) => lap.keys.includes(eventKey)).length
}

function calcMedian(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function initialMetric(sample: number): RobustMetric {
  return { n: 1, median: sample, mad: 0, ema: sample, lastUpdated: Date.now(), samples: [sample] }
}

function emptyMetric(): RobustMetric {
  return { n: 0, median: 0, mad: 0, ema: 0, lastUpdated: 0, samples: [] }
}

function cloneMetric(metric: RobustMetric): RobustMetric {
  return { ...metric, samples: metric.samples?.slice() }
}

function isFiniteMetric(v: unknown): v is RobustMetric {
  if (!isObject(v)) return false
  return (
    typeof v.n === 'number' &&
    Number.isFinite(v.n) &&
    typeof v.median === 'number' &&
    Number.isFinite(v.median) &&
    typeof v.mad === 'number' &&
    Number.isFinite(v.mad) &&
    v.mad >= 0 &&
    typeof v.ema === 'number' &&
    Number.isFinite(v.ema) &&
    typeof v.lastUpdated === 'number' &&
    Number.isFinite(v.lastUpdated) &&
    (v.samples === undefined || (Array.isArray(v.samples) && v.samples.every((s) => typeof s === 'number' && Number.isFinite(s))))
  )
}

function isValidRepetitionTracker(v: unknown): v is RepetitionTracker {
  return (
    isObject(v) &&
    Array.isArray(v.laps) &&
    v.laps.every(
      (lap) =>
        isObject(lap) &&
        typeof lap.lap === 'number' &&
        Number.isFinite(lap.lap) &&
        Array.isArray(lap.keys) &&
        lap.keys.every((key) => typeof key === 'string')
    )
  )
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
