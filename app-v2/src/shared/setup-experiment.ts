import type { SetupLibraryItem } from './setup-manager'
import type { StoDiffEntry, StoDiffKind, StoDiffResult } from './sto-parser'
import type { TelemetrySnapshot } from './telemetry'
import { liveTelemetryState } from './replay'

export const SETUP_EXPERIMENT_SCHEMA_VERSION = 1 as const
export const SETUP_EXPERIMENT_MIN_CLEAN_LAPS = 5
export const SETUP_EXPERIMENT_ARM_ORDER = ['A1', 'B', 'A2'] as const

export type SetupExperimentArm = (typeof SETUP_EXPERIMENT_ARM_ORDER)[number]
export type SetupExperimentCondition = 'dry' | 'wet' | 'unknown'
export type SetupExperimentComparabilityStatus = 'comparable' | 'incomparable' | 'unknown'
export type SetupExperimentRunStatus = 'recording' | 'completed' | 'rejected' | 'interrupted'
export type SetupExperimentDirection = 'variant' | 'baseline' | 'abstain'
export type SetupExperimentDisposition = 'keep-variant' | 'keep-baseline' | 'abstain'

export interface SetupExperimentContext {
  sim: string | null
  car: string | null
  carLabel: string | null
  track: string | null
  layout: string | null
  layoutSource: 'telemetry' | 'track-fallback' | 'unknown'
  condition: SetupExperimentCondition
  session: string | null
  sessionId: string | null
  trackWetnessPct: number | null
  trackTempC: number | null
  airTempC: number | null
}

export type SetupExperimentContextField =
  | 'sim'
  | 'car'
  | 'track'
  | 'layout'
  | 'condition'
  | 'session'
  | 'sessionId'

export interface SetupExperimentComparabilityIssue {
  field: SetupExperimentContextField
  kind: 'mismatch' | 'unknown'
  expected: string | null
  actual: string | null
}

export interface SetupExperimentComparability {
  status: SetupExperimentComparabilityStatus
  issues: SetupExperimentComparabilityIssue[]
}

export interface SetupExperimentSetupRef {
  id: string
  path: string
  fileName: string
  relativePath: string
  sizeBytes: number
  modifiedAt: number
}

export interface SetupExperimentVariable {
  section: string
  key: string
  kind: StoDiffKind
  before: string | null
  after: string | null
}

export interface SetupExperimentLap {
  id: string
  arm: SetupExperimentArm
  capturedAt: number
  lapNumber: number | null
  lapTimeSec: number | null
  completion: 'complete' | 'partial'
  incidentDelta: number | null
  incidentState: 'clean' | 'incident' | 'unknown'
  telemetryState: 'known' | 'unknown'
  context: SetupExperimentContext
  comparability: SetupExperimentComparability
  eligible: boolean
  exclusionReasons: string[]
}

export interface SetupExperimentRun {
  id: string
  arm: SetupExperimentArm
  setupPath: string
  status: SetupExperimentRunStatus
  startedAt: number
  completedAt?: number
  startContext: SetupExperimentContext
  laps: SetupExperimentLap[]
  rejectionReasons: string[]
}

export interface SetupExperimentDecision {
  disposition: SetupExperimentDisposition
  decidedAt: number
  note: string
}

export interface SetupExperimentDefinition {
  schemaVersion: typeof SETUP_EXPERIMENT_SCHEMA_VERSION
  id: string
  name: string
  createdAt: number
  updatedAt: number
  baselineSetup: SetupExperimentSetupRef
  variantSetup: SetupExperimentSetupRef
  variable: SetupExperimentVariable
  context: SetupExperimentContext
  minCleanLapsPerArm: typeof SETUP_EXPERIMENT_MIN_CLEAN_LAPS
  runs: SetupExperimentRun[]
  decision: SetupExperimentDecision | null
  localOnly: true
  setupApplication: 'manual'
}

export interface SetupExperimentArmStatistics {
  arm: SetupExperimentArm
  totalLaps: number
  cleanKnownLaps: number
  unknownLaps: number
  incidentLaps: number
  usedLaps: number
  outliers: number
  medianLapTimeSec: number | null
  madSec: number | null
}

export interface SetupExperimentAnalysis {
  eligible: boolean
  direction: SetupExperimentDirection
  reasons: string[]
  arms: Record<SetupExperimentArm, SetupExperimentArmStatistics>
  effectSec: number | null
  effectPct: number | null
  confidence95Sec: { low: number; high: number } | null
  firstContrastSec: number | null
  rollbackContrastSec: number | null
  rollbackDriftSec: number | null
  falseDirectionProtected: boolean
}

export interface SetupExperimentPortfolioMetrics {
  definitions: number
  completedProtocols: number
  eligibleExperiments: number
  directionalDecisions: number
  alignedDirectionalDecisions: number
  falseDirectionDecisions: number
  rollbackEvaluatedDirections: number
  rollbackConfirmedDirections: number
  falseDirectionSignals: number
  protocolCompletionRate: number | null
  decisionCoverage: number | null
  conditionalDirectionalAccuracy: number | null
  falseDirectionRate: number | null
  coverageTargetMet: boolean | null
  accuracyTargetMet: boolean | null
  falseDirectionTargetMet: boolean | null
}

export interface SetupExperimentStoredState {
  schemaVersion: typeof SETUP_EXPERIMENT_SCHEMA_VERSION
  experiments: SetupExperimentDefinition[]
}

export interface SetupExperimentSnapshot {
  state: SetupExperimentStoredState
  analyses: Record<string, SetupExperimentAnalysis>
  metrics: SetupExperimentPortfolioMetrics
  liveContext: SetupExperimentContext | null
  activeCapture: { experimentId: string; runId: string; arm: SetupExperimentArm } | null
}

export interface CreateSetupExperimentInput {
  name: string
  baselinePath: string
  variantPath: string
}

export interface StartSetupExperimentArmInput {
  experimentId: string
  arm: SetupExperimentArm
  confirmedSetupPath: string
}

export interface SetupExperimentMutationInput {
  experimentId: string
}

export interface RecordSetupExperimentDecisionInput extends SetupExperimentMutationInput {
  disposition: SetupExperimentDisposition
  note?: string
}

export interface SetupExperimentExportResult {
  ok: boolean
  canceled: boolean
  fileName?: string
  packageHash?: string
}

export interface SetupExperimentExportBundle {
  schema: 'ultimate-sim-app.setup-experiment'
  schemaVersion: typeof SETUP_EXPERIMENT_SCHEMA_VERSION
  exportedAt: number
  disclaimer: string
  experiment: SetupExperimentDefinition
  analysis: SetupExperimentAnalysis
  portfolioMetrics: SetupExperimentPortfolioMetrics
}

export const SETUP_EXPERIMENT_CHANNELS = {
  getSnapshot: 'setupExperiment:getSnapshot',
  create: 'setupExperiment:create',
  delete: 'setupExperiment:delete',
  startArm: 'setupExperiment:startArm',
  finishArm: 'setupExperiment:finishArm',
  interruptArm: 'setupExperiment:interruptArm',
  recordDecision: 'setupExperiment:recordDecision',
  export: 'setupExperiment:export',
  updated: 'setupExperiment:updated'
} as const

const REQUIRED_CONTEXT_FIELDS: readonly SetupExperimentContextField[] = [
  'sim',
  'car',
  'track',
  'layout',
  'condition',
  'session',
  'sessionId'
]

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return cleaned ? cleaned.slice(0, 240) : null
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function setupExperimentConditionFromTelemetry(
  snapshot: TelemetrySnapshot | null | undefined
): SetupExperimentCondition {
  const wetness = finite(snapshot?.trackWetnessPct)
  const precipitation = finite(snapshot?.precipitationPct)
  if (
    snapshot?.isRaining === true ||
    snapshot?.weatherDeclaredWet === true ||
    (wetness !== null && wetness > 0.01) ||
    (precipitation !== null && precipitation > 0.01)
  ) {
    return 'wet'
  }
  if (
    (wetness !== null && wetness <= 0.01) ||
    (snapshot?.isRaining === false && snapshot?.weatherDeclaredWet === false)
  ) {
    return 'dry'
  }
  return 'unknown'
}

export function setupExperimentContextFromTelemetry(
  snapshot: TelemetrySnapshot | null | undefined
): SetupExperimentContext | null {
  if (!snapshot?.connected || liveTelemetryState(snapshot) !== 'live') return null
  const track = text(snapshot.trackName)
  const telemetryLayout = text(snapshot.trackConfigName)
  const layout = telemetryLayout ?? track
  return {
    sim: snapshot.sim === 'none' ? null : text(snapshot.sim),
    car: text(snapshot.carPath) ?? text(snapshot.carName),
    carLabel: text(snapshot.carName),
    track,
    layout,
    layoutSource: telemetryLayout ? 'telemetry' : track ? 'track-fallback' : 'unknown',
    condition: setupExperimentConditionFromTelemetry(snapshot),
    session: text(snapshot.sessionType),
    sessionId: Number.isSafeInteger(snapshot.sessionUniqueId) ? String(snapshot.sessionUniqueId) : null,
    trackWetnessPct: finite(snapshot.trackWetnessPct),
    trackTempC: finite(snapshot.trackTempC),
    airTempC: finite(snapshot.airTempC)
  }
}

function contextFieldValue(
  context: SetupExperimentContext,
  field: SetupExperimentContextField
): string | null {
  const value = context[field]
  return typeof value === 'string' ? value : null
}

export function compareSetupExperimentContexts(
  expected: SetupExperimentContext,
  actual: SetupExperimentContext | null | undefined
): SetupExperimentComparability {
  const issues: SetupExperimentComparabilityIssue[] = []
  for (const field of REQUIRED_CONTEXT_FIELDS) {
    const expectedValue = contextFieldValue(expected, field)
    const actualValue = actual ? contextFieldValue(actual, field) : null
    if (!expectedValue || !actualValue || expectedValue === 'unknown' || actualValue === 'unknown') {
      issues.push({ field, kind: 'unknown', expected: expectedValue, actual: actualValue })
    } else if (expectedValue !== actualValue) {
      issues.push({ field, kind: 'mismatch', expected: expectedValue, actual: actualValue })
    }
  }
  if (issues.some((issue) => issue.kind === 'mismatch')) return { status: 'incomparable', issues }
  if (issues.length > 0) return { status: 'unknown', issues }
  return { status: 'comparable', issues: [] }
}

export function assertComparableExperimentContext(context: SetupExperimentContext | null): SetupExperimentContext {
  if (!context) throw new Error('Live telemetry is required to define a setup experiment.')
  const report = compareSetupExperimentContexts(context, context)
  if (report.status !== 'comparable') {
    const fields = report.issues.map((issue) => issue.field).join(', ')
    throw new Error(`Setup experiment context is unknown: ${fields}.`)
  }
  return context
}

function setupRef(item: SetupLibraryItem): SetupExperimentSetupRef {
  return {
    id: item.id,
    path: item.path,
    fileName: item.fileName,
    relativePath: item.relativePath,
    sizeBytes: item.sizeBytes,
    modifiedAt: item.modifiedAt
  }
}

function diffEntries(diff: StoDiffResult): Array<{ section: string; entry: StoDiffEntry }> {
  return diff.sections.flatMap((section) => [
    ...section.added.map((entry) => ({ section: section.section, entry })),
    ...section.removed.map((entry) => ({ section: section.section, entry })),
    ...section.changed.map((entry) => ({ section: section.section, entry }))
  ])
}

export function oneVariableFromSetupDiff(diff: StoDiffResult): SetupExperimentVariable {
  const entries = diffEntries(diff)
  if (diff.totalChanges !== 1 || entries.length !== 1) {
    throw new Error(`A setup experiment must change exactly one variable; found ${diff.totalChanges}.`)
  }
  const [{ section, entry }] = entries
  return {
    section,
    key: entry.key,
    kind: entry.kind,
    before: entry.before ?? null,
    after: entry.after ?? null
  }
}

export function createSetupExperimentDefinition(input: {
  id: string
  name: string
  now: number
  baseline: SetupLibraryItem
  variant: SetupLibraryItem
  diff: StoDiffResult
  context: SetupExperimentContext
}): SetupExperimentDefinition {
  const name = text(input.name) ?? `${input.baseline.fileName} vs ${input.variant.fileName}`
  return {
    schemaVersion: SETUP_EXPERIMENT_SCHEMA_VERSION,
    id: input.id,
    name,
    createdAt: input.now,
    updatedAt: input.now,
    baselineSetup: setupRef(input.baseline),
    variantSetup: setupRef(input.variant),
    variable: oneVariableFromSetupDiff(input.diff),
    context: assertComparableExperimentContext(input.context),
    minCleanLapsPerArm: SETUP_EXPERIMENT_MIN_CLEAN_LAPS,
    runs: [],
    decision: null,
    localOnly: true,
    setupApplication: 'manual'
  }
}

export function latestCompletedRun(
  experiment: SetupExperimentDefinition,
  arm: SetupExperimentArm
): SetupExperimentRun | null {
  return [...experiment.runs].reverse().find((run) => run.arm === arm && run.status === 'completed') ?? null
}

export function nextSetupExperimentArm(
  experiment: SetupExperimentDefinition
): SetupExperimentArm | null {
  for (const arm of SETUP_EXPERIMENT_ARM_ORDER) {
    if (!latestCompletedRun(experiment, arm)) return arm
  }
  return null
}

export function expectedSetupPathForArm(
  experiment: SetupExperimentDefinition,
  arm: SetupExperimentArm
): string {
  return arm === 'B' ? experiment.variantSetup.path : experiment.baselineSetup.path
}

export function assertSetupExperimentArmOrder(
  experiment: SetupExperimentDefinition,
  requested: SetupExperimentArm
): void {
  const expected = nextSetupExperimentArm(experiment)
  if (!expected) throw new Error('The A-B-A protocol is already complete.')
  if (requested !== expected) throw new Error(`A-B-A order violation: expected ${expected}, received ${requested}.`)
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const position = (sorted.length - 1) * q
  const base = Math.floor(position)
  const remainder = position - base
  return sorted[base + 1] === undefined
    ? sorted[base]
    : sorted[base] + remainder * (sorted[base + 1] - sorted[base])
}

function sampleStandardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1)
  return Math.sqrt(Math.max(0, variance))
}

export function filterSetupExperimentOutliers(values: readonly number[]): {
  used: number[]
  outliers: number[]
  median: number | null
  mad: number | null
} {
  const center = median(values)
  if (center === null) return { used: [], outliers: [], median: null, mad: null }
  const absoluteDeviations = values.map((value) => Math.abs(value - center))
  const mad = median(absoluteDeviations) ?? 0
  if (values.length < 4) return { used: [...values], outliers: [], median: center, mad }

  let threshold = mad > 0 ? 3 * 1.4826 * mad : 0
  if (threshold === 0) {
    const q1 = quantile(values, 0.25) ?? center
    const q3 = quantile(values, 0.75) ?? center
    const iqr = q3 - q1
    threshold = iqr > 0 ? 1.5 * iqr : Math.max(0.25, Math.abs(center) * 0.005)
  }
  const used = values.filter((value) => Math.abs(value - center) <= threshold)
  const outliers = values.filter((value) => Math.abs(value - center) > threshold)
  return {
    used: used.length > 0 ? used : [...values],
    outliers: used.length > 0 ? outliers : [],
    median: median(used.length > 0 ? used : values),
    mad
  }
}

function armStatistics(
  experiment: SetupExperimentDefinition,
  arm: SetupExperimentArm
): { stats: SetupExperimentArmStatistics; values: number[] } {
  const run = latestCompletedRun(experiment, arm)
  const laps = run?.laps ?? []
  const cleanValues = laps
    .filter((lap) => lap.eligible && lap.lapTimeSec !== null)
    .map((lap) => lap.lapTimeSec as number)
  const filtered = filterSetupExperimentOutliers(cleanValues)
  return {
    stats: {
      arm,
      totalLaps: laps.length,
      cleanKnownLaps: cleanValues.length,
      unknownLaps: laps.filter((lap) => lap.incidentState === 'unknown' || lap.telemetryState === 'unknown').length,
      incidentLaps: laps.filter((lap) => lap.incidentState === 'incident').length,
      usedLaps: filtered.used.length,
      outliers: filtered.outliers.length,
      medianLapTimeSec: filtered.median,
      madSec: filtered.mad
    },
    values: filtered.used
  }
}

function standardError(values: readonly number[]): number {
  return values.length > 0 ? sampleStandardDeviation(values) / Math.sqrt(values.length) : 0
}

export function analyzeSetupExperiment(
  experiment: SetupExperimentDefinition
): SetupExperimentAnalysis {
  const a1 = armStatistics(experiment, 'A1')
  const b = armStatistics(experiment, 'B')
  const a2 = armStatistics(experiment, 'A2')
  const arms = { A1: a1.stats, B: b.stats, A2: a2.stats }
  const reasons: string[] = []

  for (const arm of SETUP_EXPERIMENT_ARM_ORDER) {
    if (!latestCompletedRun(experiment, arm)) reasons.push(`protocol-incomplete:${arm}`)
    if (arms[arm].usedLaps < experiment.minCleanLapsPerArm) reasons.push(`insufficient-samples:${arm}`)
  }

  const sampleEligible = reasons.length === 0
  const a1Median = a1.stats.medianLapTimeSec
  const bMedian = b.stats.medianLapTimeSec
  const a2Median = a2.stats.medianLapTimeSec
  if (!sampleEligible || a1Median === null || bMedian === null || a2Median === null) {
    return {
      eligible: false,
      direction: 'abstain',
      reasons: Array.from(new Set(reasons)),
      arms,
      effectSec: null,
      effectPct: null,
      confidence95Sec: null,
      firstContrastSec: null,
      rollbackContrastSec: null,
      rollbackDriftSec: null,
      falseDirectionProtected: false
    }
  }

  const controlMedian = (a1Median + a2Median) / 2
  const effectSec = controlMedian - bMedian
  const effectPct = controlMedian !== 0 ? (effectSec / controlMedian) * 100 : null
  const firstContrastSec = a1Median - bMedian
  const rollbackContrastSec = a2Median - bMedian
  const rollbackDriftSec = a2Median - a1Median
  const se = Math.sqrt(
    (standardError(a1.values) ** 2) / 4 +
    standardError(b.values) ** 2 +
    (standardError(a2.values) ** 2) / 4
  )
  const confidence95Sec = {
    low: effectSec - 1.96 * se,
    high: effectSec + 1.96 * se
  }
  const materialEffect = Math.max(0.05, Math.abs(controlMedian) * 0.0005)
  const driftLimit = Math.max(0.5, Math.abs(effectSec) * 1.5)
  let direction: SetupExperimentDirection = 'abstain'
  let falseDirectionProtected = false

  if (
    Math.abs(firstContrastSec) < materialEffect ||
    Math.abs(rollbackContrastSec) < materialEffect
  ) {
    reasons.push('effect-not-material')
  } else if (Math.sign(firstContrastSec) !== Math.sign(rollbackContrastSec)) {
    reasons.push('rollback-direction-conflict')
    falseDirectionProtected = true
  } else if (Math.abs(rollbackDriftSec) > driftLimit) {
    reasons.push('rollback-drift')
    falseDirectionProtected = true
  } else if (confidence95Sec.low <= 0 && confidence95Sec.high >= 0) {
    reasons.push('uncertainty-crosses-zero')
  } else if (effectSec > materialEffect) {
    direction = 'variant'
  } else if (effectSec < -materialEffect) {
    direction = 'baseline'
  } else {
    reasons.push('effect-not-material')
  }

  return {
    eligible: true,
    direction,
    reasons: Array.from(new Set(reasons)),
    arms,
    effectSec,
    effectPct,
    confidence95Sec,
    firstContrastSec,
    rollbackContrastSec,
    rollbackDriftSec,
    falseDirectionProtected
  }
}

function dispositionDirection(
  disposition: SetupExperimentDisposition
): Exclude<SetupExperimentDirection, 'abstain'> | null {
  if (disposition === 'keep-variant') return 'variant'
  if (disposition === 'keep-baseline') return 'baseline'
  return null
}

export function assertSetupExperimentDecision(
  analysis: SetupExperimentAnalysis,
  disposition: SetupExperimentDisposition
): void {
  const requestedDirection = dispositionDirection(disposition)
  if (analysis.direction === 'abstain') {
    if (requestedDirection) throw new Error('Directional decision rejected: the experiment must abstain.')
    return
  }
  if (requestedDirection && requestedDirection !== analysis.direction) {
    throw new Error('Directional decision rejected by rollback false-direction protection.')
  }
}

export function setupExperimentPortfolioMetrics(
  experiments: readonly SetupExperimentDefinition[]
): SetupExperimentPortfolioMetrics {
  const evaluated = experiments.map((experiment) => ({
    experiment,
    analysis: analyzeSetupExperiment(experiment)
  }))
  const completedProtocols = evaluated.filter(({ experiment }) => nextSetupExperimentArm(experiment) === null).length
  const eligible = evaluated.filter(({ analysis }) => analysis.eligible)
  const directional = eligible.filter(({ experiment }) => dispositionDirection(experiment.decision?.disposition ?? 'abstain'))
  const aligned = directional.filter(({ experiment, analysis }) =>
    dispositionDirection(experiment.decision?.disposition ?? 'abstain') === analysis.direction
  )
  const falseDirections = directional.length - aligned.length
  const rollbackEvaluated = eligible.filter(({ analysis }) => {
    const a1Median = analysis.arms.A1.medianLapTimeSec
    const a2Median = analysis.arms.A2.medianLapTimeSec
    if (
      analysis.firstContrastSec === null ||
      analysis.rollbackContrastSec === null ||
      a1Median === null ||
      a2Median === null
    ) {
      return false
    }
    const materialEffect = Math.max(0.05, Math.abs((a1Median + a2Median) / 2) * 0.0005)
    return (
      Math.abs(analysis.firstContrastSec) >= materialEffect &&
      Math.abs(analysis.rollbackContrastSec) >= materialEffect
    )
  })
  const rollbackConfirmed = rollbackEvaluated.filter(({ analysis }) =>
    Math.sign(analysis.firstContrastSec as number) === Math.sign(analysis.rollbackContrastSec as number)
  )
  const falseDirectionSignals = rollbackEvaluated.length - rollbackConfirmed.length
  const definitions = experiments.length
  const decisionCoverage = eligible.length > 0 ? directional.length / eligible.length : null
  const conditionalDirectionalAccuracy = rollbackEvaluated.length > 0
    ? rollbackConfirmed.length / rollbackEvaluated.length
    : null
  const falseDirectionRate = rollbackEvaluated.length > 0
    ? falseDirectionSignals / rollbackEvaluated.length
    : null
  return {
    definitions,
    completedProtocols,
    eligibleExperiments: eligible.length,
    directionalDecisions: directional.length,
    alignedDirectionalDecisions: aligned.length,
    falseDirectionDecisions: falseDirections,
    rollbackEvaluatedDirections: rollbackEvaluated.length,
    rollbackConfirmedDirections: rollbackConfirmed.length,
    falseDirectionSignals,
    protocolCompletionRate: definitions > 0 ? completedProtocols / definitions : null,
    decisionCoverage,
    conditionalDirectionalAccuracy,
    falseDirectionRate,
    coverageTargetMet: decisionCoverage === null ? null : decisionCoverage >= 0.5,
    accuracyTargetMet: conditionalDirectionalAccuracy === null ? null : conditionalDirectionalAccuracy >= 0.7,
    falseDirectionTargetMet: falseDirectionRate === null ? null : falseDirectionRate <= 0.1
  }
}

export function recoverSetupExperimentStateAfterRestart(
  state: SetupExperimentStoredState,
  now: number
): { state: SetupExperimentStoredState; recovered: boolean } {
  let recovered = false
  const experiments = state.experiments.map((experiment) => {
    let experimentRecovered = false
    const runs = experiment.runs.map((run) => {
      if (run.status !== 'recording') return run
      recovered = true
      experimentRecovered = true
      return {
        ...run,
        status: 'interrupted' as const,
        completedAt: now,
        rejectionReasons: Array.from(new Set([...run.rejectionReasons, 'app-restart']))
      }
    })
    return experimentRecovered ? { ...experiment, runs, updatedAt: now } : experiment
  })
  return {
    state: { schemaVersion: SETUP_EXPERIMENT_SCHEMA_VERSION, experiments },
    recovered
  }
}

export function emptySetupExperimentState(): SetupExperimentStoredState {
  return { schemaVersion: SETUP_EXPERIMENT_SCHEMA_VERSION, experiments: [] }
}
