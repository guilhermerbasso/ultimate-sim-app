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

export interface PerceptualPairReference {
  leftId: string
  rightId: string
}

export interface PerceptualPairEvidence extends PerceptualPairReference {
  states: readonly PerceptualStateMetrics[]
}

export interface PerceptualEvidenceDocument {
  schemaVersion: 1
  pairs: readonly PerceptualPairEvidence[]
}

export interface PerceptualPairDecision extends PerceptualPairReference {
  key: string
  evidencePresent: boolean
  decision: PerceptualSimilarityDecision
}

export class PerceptualEvidenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PerceptualEvidenceError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function perceptualPairKey(leftId: string, rightId: string): string {
  return [leftId, rightId].sort().map(encodeURIComponent).join('::')
}

export function parsePerceptualEvidenceDocument(value: unknown): PerceptualEvidenceDocument {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.pairs)) {
    throw new PerceptualEvidenceError('Perceptual evidence must use schemaVersion 1 and a pairs array.')
  }

  const seen = new Set<string>()
  const pairs = value.pairs.map((pair, pairIndex): PerceptualPairEvidence => {
    if (!isRecord(pair) || typeof pair.leftId !== 'string' || typeof pair.rightId !== 'string') {
      throw new PerceptualEvidenceError(`Perceptual pair ${pairIndex} requires string leftId and rightId.`)
    }
    if (!pair.leftId.trim() || !pair.rightId.trim() || pair.leftId === pair.rightId) {
      throw new PerceptualEvidenceError(`Perceptual pair ${pairIndex} ids must be non-empty and distinct.`)
    }
    if (!Array.isArray(pair.states)) {
      throw new PerceptualEvidenceError(`Perceptual pair ${pairIndex} requires a states array.`)
    }
    const key = perceptualPairKey(pair.leftId, pair.rightId)
    if (seen.has(key)) throw new PerceptualEvidenceError(`Duplicate perceptual pair: ${key}.`)
    seen.add(key)

    const states = pair.states.map((metric, stateIndex): PerceptualStateMetrics => {
      if (!isRecord(metric) || typeof metric.state !== 'string') {
        throw new PerceptualEvidenceError(`Perceptual pair ${key} state ${stateIndex} is malformed.`)
      }
      for (const field of ['ssim', 'pHashDistance', 'pixelMismatchRatio', 'paletteSimilarity'] as const) {
        if (typeof metric[field] !== 'number') {
          throw new PerceptualEvidenceError(`Perceptual pair ${key} state ${stateIndex}.${field} must be numeric.`)
        }
      }
      return {
        state: metric.state as RequiredPerceptualState,
        ssim: metric.ssim as number,
        pHashDistance: metric.pHashDistance as number,
        pixelMismatchRatio: metric.pixelMismatchRatio as number,
        paletteSimilarity: metric.paletteSimilarity as number
      }
    })
    return { leftId: pair.leftId, rightId: pair.rightId, states }
  })
  return { schemaVersion: 1, pairs }
}

export function evaluatePerceptualPairEvidence(
  expectedPairs: readonly PerceptualPairReference[],
  document?: PerceptualEvidenceDocument
): readonly PerceptualPairDecision[] {
  const expectedByKey = new Map<string, PerceptualPairReference>()
  for (const pair of expectedPairs) {
    const key = perceptualPairKey(pair.leftId, pair.rightId)
    if (expectedByKey.has(key)) throw new PerceptualEvidenceError(`Duplicate expected pair: ${key}.`)
    expectedByKey.set(key, pair)
  }

  const evidenceByKey = new Map<string, PerceptualPairEvidence>()
  for (const evidence of document?.pairs ?? []) {
    const key = perceptualPairKey(evidence.leftId, evidence.rightId)
    if (!expectedByKey.has(key)) {
      throw new PerceptualEvidenceError(`Unexpected perceptual evidence pair: ${key}.`)
    }
    evidenceByKey.set(key, evidence)
  }

  return [...expectedByKey.entries()]
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, pair]) => {
      const evidence = evidenceByKey.get(key)
      return {
        ...pair,
        key,
        evidencePresent: Boolean(evidence),
        decision: evaluatePerceptualSimilarity(evidence?.states ?? [])
      }
    })
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
