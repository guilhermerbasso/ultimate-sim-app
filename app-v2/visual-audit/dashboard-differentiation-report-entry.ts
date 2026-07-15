import {
  BUILTIN_PRESETS,
  dashboardValidationError,
  type DashboardPreset
} from '@shared/dashboards'
import {
  STRUCTURAL_SIMILARITY_THRESHOLDS,
  STRUCTURAL_SIMILARITY_WEIGHTS,
  compareDashboardFingerprints,
  createDashboardFingerprint,
  type DashboardFingerprint,
  type StructuralComparison
} from '@shared/visual-pipeline'

interface PreparedPreset {
  id: string
  name: string
  fingerprint: DashboardFingerprint
}

type PairScope = 'baseline-existing' | 'candidate-vs-baseline' | 'candidate-vs-candidate'

interface PairFinding {
  scope: PairScope
  leftId: string
  rightId: string
  metrics: StructuralComparison['metrics']
  rejectionCodes: readonly string[]
  warningCodes: readonly string[]
}

interface PairReport {
  pairsCompared: number
  findingCount: number
  hardFailPairCount: number
  exactCanonicalPairCount: number
  findings: readonly PairFinding[]
}

export interface DashboardDifferentiationReport {
  schemaVersion: 1
  mode: 'baseline' | 'candidate'
  thresholds: typeof STRUCTURAL_SIMILARITY_THRESHOLDS
  weights: typeof STRUCTURAL_SIMILARITY_WEIGHTS
  candidates: readonly string[]
  presets: {
    total: number
    fingerprints: readonly {
      id: string
      name: string
      hash: string
      elementCount: number
      semanticWidgetCount: number
      topologyTokenCount: number
    }[]
  }
  baselineExisting: PairReport
  candidateGate: null | (PairReport & { passed: boolean })
}

function preparePreset(preset: DashboardPreset): PreparedPreset {
  let dashboard
  try {
    dashboard = preset.build()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Preset "${preset.id}" build failed: ${message}`)
  }
  const validationError = dashboardValidationError(dashboard)
  if (validationError) {
    throw new Error(`Preset "${preset.id}" is malformed: ${validationError}`)
  }
  return {
    id: preset.id,
    name: preset.name,
    fingerprint: createDashboardFingerprint(dashboard)
  }
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function finding(
  left: PreparedPreset,
  right: PreparedPreset,
  scope: PairScope
): PairFinding | null {
  const comparison = compareDashboardFingerprints(left.fingerprint, right.fingerprint)
  if (!comparison.decision.hardFail && comparison.decision.warnings.length === 0) return null
  return {
    scope,
    leftId: left.id,
    rightId: right.id,
    metrics: {
      ...comparison.metrics,
      semanticWidgetJaccard: rounded(comparison.metrics.semanticWidgetJaccard),
      geometryIou: rounded(comparison.metrics.geometryIou),
      sameWidgetPlacement: rounded(comparison.metrics.sameWidgetPlacement),
      topology: rounded(comparison.metrics.topology),
      overallSimilarity: rounded(comparison.metrics.overallSimilarity)
    },
    rejectionCodes: comparison.decision.reasons.map((reason) => reason.code),
    warningCodes: comparison.decision.warnings.map((warning) => warning.code)
  }
}

function pairReport(
  pairs: readonly [PreparedPreset, PreparedPreset, PairScope][]
): PairReport {
  const findings: PairFinding[] = []
  for (const [left, right, scope] of pairs) {
    const result = finding(left, right, scope)
    if (result) findings.push(result)
  }
  return {
    pairsCompared: pairs.length,
    findingCount: findings.length,
    hardFailPairCount: findings.filter((entry) => entry.rejectionCodes.length > 0).length,
    exactCanonicalPairCount: findings.filter((entry) =>
      entry.rejectionCodes.includes('exact-canonical-equality')
    ).length,
    findings
  }
}

function withinGroupPairs(
  presets: readonly PreparedPreset[],
  scope: PairScope
): [PreparedPreset, PreparedPreset, PairScope][] {
  const pairs: [PreparedPreset, PreparedPreset, PairScope][] = []
  for (let left = 0; left < presets.length; left += 1) {
    for (let right = left + 1; right < presets.length; right += 1) {
      pairs.push([presets[left], presets[right], scope])
    }
  }
  return pairs
}

export function createBuiltinDashboardDifferentiationReport(
  candidateIds: readonly string[] = []
): DashboardDifferentiationReport {
  const duplicateRegistryIds = BUILTIN_PRESETS
    .map((preset) => preset.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index)
  if (duplicateRegistryIds.length > 0) {
    throw new Error(`Built-in preset registry contains duplicate ids: ${[...new Set(duplicateRegistryIds)].join(', ')}`)
  }

  const requestedCandidates = [...candidateIds].sort()
  if (new Set(requestedCandidates).size !== requestedCandidates.length) {
    throw new Error('Candidate ids must be unique.')
  }
  const knownIds = new Set(BUILTIN_PRESETS.map((preset) => preset.id))
  const missingCandidates = requestedCandidates.filter((id) => !knownIds.has(id))
  if (missingCandidates.length > 0) {
    throw new Error(`Candidate preset ids were not found: ${missingCandidates.join(', ')}`)
  }

  const presets = BUILTIN_PRESETS.map(preparePreset).sort((left, right) => left.id.localeCompare(right.id))
  const candidateSet = new Set(requestedCandidates)
  const candidates = presets.filter((preset) => candidateSet.has(preset.id))
  const baseline = presets.filter((preset) => !candidateSet.has(preset.id))

  const baselineExisting = pairReport(withinGroupPairs(baseline, 'baseline-existing'))
  let candidateGate: DashboardDifferentiationReport['candidateGate'] = null
  if (candidates.length > 0) {
    const candidatePairs: [PreparedPreset, PreparedPreset, PairScope][] = []
    for (const candidate of candidates) {
      for (const existing of baseline) {
        candidatePairs.push([candidate, existing, 'candidate-vs-baseline'])
      }
    }
    candidatePairs.push(...withinGroupPairs(candidates, 'candidate-vs-candidate'))
    const report = pairReport(candidatePairs)
    candidateGate = { ...report, passed: report.hardFailPairCount === 0 }
  }

  return {
    schemaVersion: 1,
    mode: candidates.length > 0 ? 'candidate' : 'baseline',
    thresholds: STRUCTURAL_SIMILARITY_THRESHOLDS,
    weights: STRUCTURAL_SIMILARITY_WEIGHTS,
    candidates: requestedCandidates,
    presets: {
      total: presets.length,
      fingerprints: presets.map((preset) => ({
        id: preset.id,
        name: preset.name,
        hash: preset.fingerprint.hash,
        elementCount: preset.fingerprint.elementCount,
        semanticWidgetCount: preset.fingerprint.semanticWidgetSet.length,
        topologyTokenCount: preset.fingerprint.topology.tokens.length
      }))
    },
    baselineExisting,
    candidateGate
  }
}
