export const REQUIRED_PERCEPTUAL_STATES = [
  'idle',
  'drive',
  'redline',
  'brake',
  'yellow',
  'blue',
  'pit',
  'extreme'
] as const

export type RequiredPerceptualState = (typeof REQUIRED_PERCEPTUAL_STATES)[number]

export const PERCEPTUAL_SIMILARITY_THRESHOLDS = {
  ssimMinimum: 0.92,
  pHashDistanceMaximum: 8,
  pixelMismatchRatioMaximum: 0.1,
  paletteSimilarityMinimum: 0.97,
  similarStateRejectCount: 4
} as const

export interface PerceptualStateMetrics {
  state: RequiredPerceptualState
  ssim: number
  pHashDistance: number
  pixelMismatchRatio: number
  paletteSimilarity: number
}

export type PerceptualDecisionStatus = 'passed' | 'rejected' | 'incomplete' | 'invalid'

export interface PerceptualStateDecision {
  state: RequiredPerceptualState
  similar: boolean
  metrics: PerceptualStateMetrics
}

export interface PerceptualSimilarityDecision {
  status: PerceptualDecisionStatus
  hardFail: boolean
  complete: boolean
  missingStates: readonly RequiredPerceptualState[]
  duplicateStates: readonly RequiredPerceptualState[]
  invalidMetrics: readonly string[]
  similarStates: readonly RequiredPerceptualState[]
  states: readonly PerceptualStateDecision[]
  message: string
}

function metricError(metric: PerceptualStateMetrics): string | null {
  const fields = [
    ['ssim', metric.ssim, 0, 1],
    ['pHashDistance', metric.pHashDistance, 0, Number.POSITIVE_INFINITY],
    ['pixelMismatchRatio', metric.pixelMismatchRatio, 0, 1],
    ['paletteSimilarity', metric.paletteSimilarity, 0, 1]
  ] as const
  for (const [name, value, minimum, maximum] of fields) {
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      return `${metric.state}.${name} must be finite and within ${minimum}..${maximum}.`
    }
  }
  if (!Number.isInteger(metric.pHashDistance)) {
    return `${metric.state}.pHashDistance must be an integer.`
  }
  return null
}

export function isPerceptuallySimilarState(metric: PerceptualStateMetrics): boolean {
  return metric.ssim >= PERCEPTUAL_SIMILARITY_THRESHOLDS.ssimMinimum &&
    metric.pHashDistance <= PERCEPTUAL_SIMILARITY_THRESHOLDS.pHashDistanceMaximum &&
    metric.pixelMismatchRatio <= PERCEPTUAL_SIMILARITY_THRESHOLDS.pixelMismatchRatioMaximum &&
    metric.paletteSimilarity >= PERCEPTUAL_SIMILARITY_THRESHOLDS.paletteSimilarityMinimum
}

export function evaluatePerceptualSimilarity(
  evidence: readonly PerceptualStateMetrics[]
): PerceptualSimilarityDecision {
  const required = new Set<RequiredPerceptualState>(REQUIRED_PERCEPTUAL_STATES)
  const byState = new Map<RequiredPerceptualState, PerceptualStateMetrics>()
  const duplicateStates = new Set<RequiredPerceptualState>()
  const invalidMetrics: string[] = []

  for (const metric of evidence) {
    if (!required.has(metric.state)) {
      invalidMetrics.push(`Unknown perceptual state: ${String(metric.state)}.`)
      continue
    }
    if (byState.has(metric.state)) duplicateStates.add(metric.state)
    else byState.set(metric.state, metric)
    const error = metricError(metric)
    if (error) invalidMetrics.push(error)
  }

  const missingStates = REQUIRED_PERCEPTUAL_STATES.filter((state) => !byState.has(state))
  const states = REQUIRED_PERCEPTUAL_STATES.flatMap((state): PerceptualStateDecision[] => {
    const metrics = byState.get(state)
    return metrics ? [{ state, metrics, similar: isPerceptuallySimilarState(metrics) }] : []
  })
  const similarStates = states.filter((state) => state.similar).map((state) => state.state)
  const complete = missingStates.length === 0 &&
    duplicateStates.size === 0 &&
    invalidMetrics.length === 0 &&
    evidence.length === REQUIRED_PERCEPTUAL_STATES.length

  if (invalidMetrics.length > 0 || duplicateStates.size > 0) {
    return {
      status: 'invalid',
      hardFail: true,
      complete: false,
      missingStates,
      duplicateStates: [...duplicateStates].sort(),
      invalidMetrics,
      similarStates,
      states,
      message: 'Perceptual evidence is invalid and cannot pass the gate.'
    }
  }
  if (!complete) {
    return {
      status: 'incomplete',
      hardFail: true,
      complete: false,
      missingStates,
      duplicateStates: [],
      invalidMetrics: [],
      similarStates,
      states,
      message: 'All eight deterministic perceptual states are required.'
    }
  }
  if (similarStates.length >= PERCEPTUAL_SIMILARITY_THRESHOLDS.similarStateRejectCount) {
    return {
      status: 'rejected',
      hardFail: true,
      complete: true,
      missingStates: [],
      duplicateStates: [],
      invalidMetrics: [],
      similarStates,
      states,
      message: `Perceptual similarity thresholds were reached in ${similarStates.length}/8 states.`
    }
  }
  return {
    status: 'passed',
    hardFail: false,
    complete: true,
    missingStates: [],
    duplicateStates: [],
    invalidMetrics: [],
    similarStates,
    states,
    message: 'Complete perceptual evidence remains below the rejection threshold.'
  }
}
