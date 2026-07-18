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
export type SetupExperimentSequence = 'ABA' | 'BAB'
export type SetupExperimentTreatment = 'A' | 'B'
export type SetupExperimentEvidenceStrength = 'insufficient' | 'exploratory' | 'confirmatory'
export type SetupExperimentRollbackRelation = 'agreement' | 'conflict' | 'unknown'

export type SetupExperimentEnvironmentField =
  | 'trackWetnessPct'
  | 'trackTempC'
  | 'airTempC'
  | 'fuelMassKg'
  | 'tyreStatePct'
  | 'trafficDensity'
  | 'flagStateIndex'
  | 'damagePct'
  | 'gripPct'

export interface SetupExperimentEnvironment {
  trackWetnessPct: number | null
  trackTempC: number | null
  airTempC: number | null
  fuelMassKg: number | null
  tyreStatePct: number | null
  trafficDensity: number | null
  flagStateIndex: number | null
  damagePct: number | null
  gripPct: number | null
}

export type SetupExperimentEnvironmentTolerances = Record<SetupExperimentEnvironmentField, number>

export interface SetupExperimentAnalysisPlan {
  seed: number
  iterations: number
  lapBlockLength: number
  minimumIndependentBlocks: number
  maxRollbackDriftSec: number
}

export const DEFAULT_SETUP_EXPERIMENT_ANALYSIS_PLAN: Readonly<SetupExperimentAnalysisPlan> =
  Object.freeze({
    seed: 0x5eed1234,
    iterations: 512,
    lapBlockLength: 2,
    minimumIndependentBlocks: 2,
    maxRollbackDriftSec: 0.5
  })

export const DEFAULT_SETUP_EXPERIMENT_TOLERANCES: Readonly<SetupExperimentEnvironmentTolerances> =
  Object.freeze({
    trackWetnessPct: 0.02,
    trackTempC: 2,
    airTempC: 1.5,
    fuelMassKg: 5,
    tyreStatePct: 0.05,
    trafficDensity: 0.1,
    flagStateIndex: 0,
    damagePct: 0.005,
    gripPct: 0.02
  })

export interface SetupExperimentContext extends SetupExperimentEnvironment {
  sim: string | null
  car: string | null
  carLabel: string | null
  track: string | null
  layout: string | null
  layoutSource: 'telemetry' | 'track-fallback' | 'unknown'
  condition: SetupExperimentCondition
  session: string | null
  sessionId: string | null
  fuelMassSource?: 'telemetry' | 'estimated-from-liters' | 'unknown'
}

export type SetupExperimentContextField =
  | 'sim'
  | 'car'
  | 'track'
  | 'layout'
  | 'condition'
  | 'session'
  | 'sessionId'
  | SetupExperimentEnvironmentField

export interface SetupExperimentComparabilityIssue {
  field: SetupExperimentContextField
  kind: 'mismatch' | 'unknown'
  expected: string | number | null
  actual: string | number | null
  tolerance?: number
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

export interface SetupExperimentProtocolBlock {
  blockId: string
  sequence: SetupExperimentSequence
}

export interface SetupExperimentProtocolStep {
  blockId: string
  sequence: SetupExperimentSequence
  stepIndex: number
  treatment: SetupExperimentTreatment
  arm: SetupExperimentArm
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
  validitySource?: 'telemetry' | 'derived' | 'unknown'
  context: SetupExperimentContext
  comparability: SetupExperimentComparability
  eligible: boolean
  exclusionReasons: string[]
  auditFlags?: string[]
  flaggedOutlier?: boolean
  blockId?: string
  sequence?: SetupExperimentSequence
  stepIndex?: number
  treatment?: SetupExperimentTreatment
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
  blockId?: string
  sequence?: SetupExperimentSequence
  stepIndex?: number
  treatment?: SetupExperimentTreatment
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
  analysisPlan?: SetupExperimentAnalysisPlan
  environmentTolerances?: SetupExperimentEnvironmentTolerances
  protocolPlan?: SetupExperimentProtocolBlock[]
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

export interface SetupExperimentBootstrapWindow {
  runId: string
  startLapIndex: number
  lapIds: string[]
}

export interface SetupExperimentBootstrapDraw {
  iteration: number
  sampledClusters: string[]
  windows: SetupExperimentBootstrapWindow[]
  effectSec: number
}

export interface SetupExperimentBootstrapSummary {
  seed: number
  iterations: number
  lapBlockLength: number
  minimumIndependentBlocks: number
  maxRollbackDriftSec: number
  totalDraws: number
  interval95Sec: { low: number; high: number } | null
  degenerate: boolean
  draws: SetupExperimentBootstrapDraw[]
}

export interface SetupExperimentSensitivityResult {
  medians: { A: number | null; B: number | null }
  effectSec: number | null
  direction: SetupExperimentDirection
  independentBlocks: number
  confidence95Sec: { low: number; high: number } | null
  rollbackRelation: SetupExperimentRollbackRelation
  driftPass: boolean
  uncertaintyPass: boolean
  blockDirectionPass: boolean
}

export interface SetupExperimentSensitivity {
  allClean: SetupExperimentSensitivityResult
  excludingFlagged: SetupExperimentSensitivityResult
  flaggedLapIds: string[]
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
  evidenceStrength?: SetupExperimentEvidenceStrength
  exploratoryDirection?: SetupExperimentDirection
  rollbackRelation?: SetupExperimentRollbackRelation
  blocks?: SetupExperimentProtocolBlock[]
  bootstrap?: SetupExperimentBootstrapSummary | null
  sensitivity?: SetupExperimentSensitivity
}

export interface SetupExperimentPortfolioMetrics {
  definitions: number
  completedProtocols: number
  eligibleExperiments: number
  directionalDecisions: number
  alignedDirectionalDecisions: number
  falseDirectionDecisions: number
  confirmatoryDirections: number
  rollbackEvaluatedSignals: number
  rollbackAgreementSignals: number
  rollbackConflictSignals: number
  rollbackConfirmedDirections: number
  protocolCompletionRate: number | null
  decisionCoverage: number | null
  rollbackAgreementRate: number | null
  rollbackConflictRate: number | null
  coverageTargetMet: boolean | null
  agreementTargetMet: boolean | null
  conflictTargetMet: boolean | null
  /** @deprecated Use rollbackAgreementRate. */
  conditionalDirectionalAccuracy: number | null
  /** @deprecated Use rollbackConflictRate. */
  falseDirectionRate: number | null
  /** @deprecated Use agreementTargetMet. */
  accuracyTargetMet: boolean | null
  /** @deprecated Use conflictTargetMet. */
  falseDirectionTargetMet: boolean | null
  /** @deprecated Use rollbackEvaluatedSignals. */
  rollbackEvaluatedDirections: number
  /** @deprecated Use rollbackAgreementSignals. */
  rollbackConfirmedDirectionsLegacy?: number
  /** @deprecated Use rollbackConflictSignals. */
  falseDirectionSignals: number
}

export type SetupExperimentStorageIssueKind =
  | 'corrupt-store'
  | 'unreadable-store'
  | 'recoverable'

export interface SetupExperimentStorageIssue {
  kind: SetupExperimentStorageIssueKind
  sourcePath: string
  code: string
  message: string
  quarantineStatus?: 'quarantined' | 'failed'
  quarantinePath?: string
  checksum?: string
}

export interface SetupExperimentStoredState {
  schemaVersion: typeof SETUP_EXPERIMENT_SCHEMA_VERSION
  experiments: SetupExperimentDefinition[]
  revision?: number
  storageIssues?: SetupExperimentStorageIssue[]
}

export interface SetupExperimentSnapshot {
  state: SetupExperimentStoredState
  analyses: Record<string, SetupExperimentAnalysis>
  metrics: SetupExperimentPortfolioMetrics
  liveContext: SetupExperimentContext | null
  activeCapture: {
    experimentId: string
    runId: string
    arm: SetupExperimentArm
    step?: SetupExperimentProtocolStep
    pendingLapCount?: number
    persistenceError?: string
  } | null
}

export interface CreateSetupExperimentInput {
  name: string
  baselinePath: string
  variantPath: string
  analysisPlan?: SetupExperimentAnalysisPlan
  environmentTolerances?: SetupExperimentEnvironmentTolerances
  protocolPlan?: SetupExperimentProtocolBlock[]
}

export interface StartSetupExperimentArmInput {
  experimentId: string
  arm: SetupExperimentArm
  confirmedSetupPath: string
  blockId?: string
  sequence?: SetupExperimentSequence
  stepIndex?: number
  treatment?: SetupExperimentTreatment
}

export interface SetupExperimentMutationInput {
  experimentId: string
}

export interface AddSetupExperimentBlockInput extends SetupExperimentMutationInput {
  sequence: SetupExperimentSequence
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
  addBlock: 'setupExperiment:addBlock',
  recordDecision: 'setupExperiment:recordDecision',
  export: 'setupExperiment:export',
  updated: 'setupExperiment:updated'
} as const

const IDENTITY_FIELDS: readonly Exclude<SetupExperimentContextField, SetupExperimentEnvironmentField>[] = [
  'sim',
  'car',
  'track',
  'layout',
  'condition',
  'session',
  'sessionId'
]

const ENVIRONMENT_FIELDS: readonly SetupExperimentEnvironmentField[] = [
  'trackWetnessPct',
  'trackTempC',
  'airTempC',
  'fuelMassKg',
  'tyreStatePct',
  'trafficDensity',
  'flagStateIndex',
  'damagePct',
  'gripPct'
]

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return cleaned ? cleaned.slice(0, 240) : null
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function normalizedWear(value: unknown): number | null {
  const numeric = finite(value)
  if (numeric === null) return null
  return clamp(numeric > 1 ? numeric / 100 : numeric, 0, 1)
}

function tyreState(snapshot: TelemetrySnapshot): number | null {
  const explicit = finite((snapshot as TelemetrySnapshot & { tyreStatePct?: number }).tyreStatePct)
  if (explicit !== null) return explicit
  if (!snapshot.tyres) return null
  const values = [
    normalizedWear(snapshot.tyres.lf.wearPct),
    normalizedWear(snapshot.tyres.rf.wearPct),
    normalizedWear(snapshot.tyres.lr.wearPct),
    normalizedWear(snapshot.tyres.rr.wearPct)
  ]
  if (values.some((value) => value === null)) return null
  return (values as number[]).reduce((sum, value) => sum + value, 0) / values.length
}

function trafficDensity(snapshot: TelemetrySnapshot): number | null {
  const explicit = finite((snapshot as TelemetrySnapshot & { trafficDensity?: number }).trafficDensity)
  if (explicit !== null) return explicit
  if (!Array.isArray(snapshot.radarCars)) {
    return Array.isArray(snapshot.drivers) ? 0 : null
  }
  return clamp(snapshot.radarCars.length / 10, 0, 1)
}

function flagStateIndex(snapshot: TelemetrySnapshot): number | null {
  const explicit = finite((snapshot as TelemetrySnapshot & { flagStateIndex?: number }).flagStateIndex)
  if (explicit !== null) return explicit
  const flags = snapshot.flags
  if (!flags) return null
  if (flags.red || flags.black || flags.meatball || flags.disqualify) return 4
  if (flags.yellow) return 3
  if (flags.white || flags.checkered) return 2
  if (flags.blue) return 1
  return flags.green ? 0 : null
}

function damagePct(snapshot: TelemetrySnapshot): number | null {
  const explicit = finite((snapshot as TelemetrySnapshot & { damagePct?: number }).damagePct)
  return explicit
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
  const extended = snapshot as TelemetrySnapshot & { fuelMassKg?: number }
  const explicitFuelMass = finite(extended.fuelMassKg)
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
    airTempC: finite(snapshot.airTempC),
    fuelMassKg: explicitFuelMass,
    fuelMassSource: explicitFuelMass !== null ? 'telemetry' : 'unknown',
    tyreStatePct: tyreState(snapshot),
    trafficDensity: trafficDensity(snapshot),
    flagStateIndex: flagStateIndex(snapshot),
    damagePct: damagePct(snapshot),
    gripPct: finite(snapshot.gripPct)
  }
}

function contextString(
  context: SetupExperimentContext,
  field: Exclude<SetupExperimentContextField, SetupExperimentEnvironmentField>
): string | null {
  const value = context[field]
  return typeof value === 'string' ? value : null
}

export function compareSetupExperimentContexts(
  expected: SetupExperimentContext,
  actual: SetupExperimentContext | null | undefined,
  tolerances?: Partial<SetupExperimentEnvironmentTolerances>
): SetupExperimentComparability {
  const issues: SetupExperimentComparabilityIssue[] = []
  for (const field of IDENTITY_FIELDS) {
    const expectedValue = contextString(expected, field)
    const actualValue = actual ? contextString(actual, field) : null
    if (!expectedValue || !actualValue || expectedValue === 'unknown' || actualValue === 'unknown') {
      issues.push({ field, kind: 'unknown', expected: expectedValue, actual: actualValue })
    } else if (expectedValue !== actualValue) {
      issues.push({ field, kind: 'mismatch', expected: expectedValue, actual: actualValue })
    }
  }
  if (tolerances) {
    for (const field of ENVIRONMENT_FIELDS) {
      const expectedValue = finite(expected[field])
      const actualValue = actual ? finite(actual[field]) : null
      const tolerance = finite(tolerances[field])
      if (expectedValue === null || actualValue === null || tolerance === null || tolerance < 0) {
        issues.push({ field, kind: 'unknown', expected: expectedValue, actual: actualValue })
      } else if (Math.abs(expectedValue - actualValue) > tolerance + Number.EPSILON * 16) {
        issues.push({
          field,
          kind: 'mismatch',
          expected: expectedValue,
          actual: actualValue,
          tolerance
        })
      }
    }
  }
  if (issues.some((issue) => issue.kind === 'mismatch')) return { status: 'incomparable', issues }
  if (issues.length > 0) return { status: 'unknown', issues }
  return { status: 'comparable', issues: [] }
}

export function assertComparableExperimentContext(
  context: SetupExperimentContext | null,
  tolerances: SetupExperimentEnvironmentTolerances = {
    ...DEFAULT_SETUP_EXPERIMENT_TOLERANCES
  }
): SetupExperimentContext {
  if (!context) throw new Error('Live telemetry is required to define a setup experiment.')
  const report = compareSetupExperimentContexts(context, context, tolerances)
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

function frozenAnalysisPlan(input?: Partial<SetupExperimentAnalysisPlan>): SetupExperimentAnalysisPlan {
  const plan: SetupExperimentAnalysisPlan = {
    seed: Number.isSafeInteger(input?.seed) ? Number(input?.seed) >>> 0 : DEFAULT_SETUP_EXPERIMENT_ANALYSIS_PLAN.seed,
    iterations: Number.isSafeInteger(input?.iterations)
      ? clamp(Number(input?.iterations), 8, 5000)
      : DEFAULT_SETUP_EXPERIMENT_ANALYSIS_PLAN.iterations,
    lapBlockLength: Number.isSafeInteger(input?.lapBlockLength)
      ? clamp(Number(input?.lapBlockLength), 1, 20)
      : DEFAULT_SETUP_EXPERIMENT_ANALYSIS_PLAN.lapBlockLength,
    minimumIndependentBlocks: Number.isSafeInteger(input?.minimumIndependentBlocks)
      ? clamp(Number(input?.minimumIndependentBlocks), 2, 20)
      : DEFAULT_SETUP_EXPERIMENT_ANALYSIS_PLAN.minimumIndependentBlocks,
    maxRollbackDriftSec: finite(input?.maxRollbackDriftSec) !== null && Number(input?.maxRollbackDriftSec) > 0
      ? Number(input?.maxRollbackDriftSec)
      : DEFAULT_SETUP_EXPERIMENT_ANALYSIS_PLAN.maxRollbackDriftSec
  }
  return Object.freeze(plan)
}

function frozenTolerances(
  input?: Partial<SetupExperimentEnvironmentTolerances>
): SetupExperimentEnvironmentTolerances {
  const tolerances = Object.fromEntries(ENVIRONMENT_FIELDS.map((field) => {
    const value = finite(input?.[field])
    return [field, value !== null && value >= 0 ? value : DEFAULT_SETUP_EXPERIMENT_TOLERANCES[field]]
  })) as unknown as SetupExperimentEnvironmentTolerances
  return Object.freeze(tolerances)
}

function normalizedProtocolPlan(
  input?: readonly SetupExperimentProtocolBlock[]
): SetupExperimentProtocolBlock[] {
  const source = input?.length ? input : [{ blockId: 'block-001', sequence: 'ABA' as const }]
  const seen = new Set<string>()
  return source.map((block, index) => {
    const sequence: SetupExperimentSequence = block.sequence === 'BAB' ? 'BAB' : 'ABA'
    let blockId = text(block.blockId) ?? `block-${String(index + 1).padStart(3, '0')}`
    if (seen.has(blockId)) blockId = `${blockId}-${index + 1}`
    seen.add(blockId)
    return { blockId, sequence }
  })
}

export function createSetupExperimentDefinition(input: {
  id: string
  name: string
  now: number
  baseline: SetupLibraryItem
  variant: SetupLibraryItem
  diff: StoDiffResult
  context: SetupExperimentContext
  analysisPlan?: Partial<SetupExperimentAnalysisPlan>
  environmentTolerances?: Partial<SetupExperimentEnvironmentTolerances>
  protocolPlan?: SetupExperimentProtocolBlock[]
}): SetupExperimentDefinition {
  const name = text(input.name) ?? `${input.baseline.fileName} vs ${input.variant.fileName}`
  if (
    input.environmentTolerances &&
    ENVIRONMENT_FIELDS.some((field) => {
      const value = finite(input.environmentTolerances?.[field])
      return value === null || value < 0
    })
  ) {
    throw new Error('Every environment tolerance must be predeclared before collection.')
  }
  if (
    input.analysisPlan &&
    (
      !Number.isSafeInteger(input.analysisPlan.seed) ||
      !Number.isSafeInteger(input.analysisPlan.iterations) ||
      !Number.isSafeInteger(input.analysisPlan.lapBlockLength) ||
      !Number.isSafeInteger(input.analysisPlan.minimumIndependentBlocks) ||
      finite(input.analysisPlan.maxRollbackDriftSec) === null ||
      (input.analysisPlan.maxRollbackDriftSec ?? 0) <= 0
    )
  ) {
    throw new Error('The bootstrap and rollback-drift plan must be fully predeclared.')
  }
  const environmentTolerances = frozenTolerances(input.environmentTolerances)
  return {
    schemaVersion: SETUP_EXPERIMENT_SCHEMA_VERSION,
    id: input.id,
    name,
    createdAt: input.now,
    updatedAt: input.now,
    baselineSetup: setupRef(input.baseline),
    variantSetup: setupRef(input.variant),
    variable: oneVariableFromSetupDiff(input.diff),
    context: assertComparableExperimentContext(input.context, environmentTolerances),
    minCleanLapsPerArm: SETUP_EXPERIMENT_MIN_CLEAN_LAPS,
    runs: [],
    decision: null,
    localOnly: true,
    setupApplication: 'manual',
    analysisPlan: frozenAnalysisPlan(input.analysisPlan),
    environmentTolerances,
    protocolPlan: normalizedProtocolPlan(input.protocolPlan)
  }
}

export function protocolSteps(
  block: SetupExperimentProtocolBlock
): SetupExperimentProtocolStep[] {
  const treatments = block.sequence.split('') as SetupExperimentTreatment[]
  return treatments.map((treatment, stepIndex) => ({
    blockId: block.blockId,
    sequence: block.sequence,
    stepIndex,
    treatment,
    arm: block.sequence === 'ABA'
      ? (['A1', 'B', 'A2'] as const)[stepIndex]
      : treatment === 'B'
        ? 'B'
        : 'A1'
  }))
}

export function experimentProtocolPlan(
  experiment: SetupExperimentDefinition
): SetupExperimentProtocolBlock[] {
  let plan = normalizedProtocolPlan(experiment.protocolPlan)
  const explicitRunBlockIds = new Set(
    experiment.runs.map((run) => run.blockId).filter((value): value is string => typeof value === 'string')
  )
  if (
    explicitRunBlockIds.size > 0 &&
    plan.length === 1 &&
    !explicitRunBlockIds.has(plan[0].blockId) &&
    experiment.runs.every((run) => run.blockId !== undefined)
  ) {
    plan = []
  }
  const known = new Set(plan.map((block) => block.blockId))
  for (const run of experiment.runs) {
    if (
      typeof run.blockId === 'string' &&
      (run.sequence === 'ABA' || run.sequence === 'BAB') &&
      !known.has(run.blockId)
    ) {
      plan.push({ blockId: run.blockId, sequence: run.sequence })
      known.add(run.blockId)
    }
  }
  return plan
}

function runMatchesStep(
  run: SetupExperimentRun,
  step: SetupExperimentProtocolStep,
  legacyBlockId: string
): boolean {
  if (
    run.blockId !== undefined ||
    run.sequence !== undefined ||
    run.stepIndex !== undefined ||
    run.treatment !== undefined
  ) {
    return (
      run.blockId === step.blockId &&
      run.sequence === step.sequence &&
      run.stepIndex === step.stepIndex &&
      run.treatment === step.treatment
    )
  }
  if (step.blockId !== legacyBlockId || step.sequence !== 'ABA') return false
  return (
    (run.arm === 'A1' && step.stepIndex === 0) ||
    (run.arm === 'B' && step.stepIndex === 1) ||
    (run.arm === 'A2' && step.stepIndex === 2)
  )
}

export function latestCompletedRunForStep(
  experiment: SetupExperimentDefinition,
  step: SetupExperimentProtocolStep
): SetupExperimentRun | null {
  const legacyBlockId = experimentProtocolPlan(experiment)[0]?.blockId ?? 'block-001'
  return [...experiment.runs].reverse().find((run) =>
    run.status === 'completed' && runMatchesStep(run, step, legacyBlockId)
  ) ?? null
}

export function latestCompletedRun(
  experiment: SetupExperimentDefinition,
  arm: SetupExperimentArm
): SetupExperimentRun | null {
  return [...experiment.runs].reverse().find((run) => run.arm === arm && run.status === 'completed') ?? null
}

export function nextSetupExperimentStep(
  experiment: SetupExperimentDefinition
): SetupExperimentProtocolStep | null {
  for (const block of experimentProtocolPlan(experiment)) {
    for (const step of protocolSteps(block)) {
      if (!latestCompletedRunForStep(experiment, step)) return step
    }
  }
  return null
}

export function nextSetupExperimentArm(
  experiment: SetupExperimentDefinition
): SetupExperimentArm | null {
  return nextSetupExperimentStep(experiment)?.arm ?? null
}

export function expectedSetupPathForTreatment(
  experiment: SetupExperimentDefinition,
  treatment: SetupExperimentTreatment
): string {
  return treatment === 'B' ? experiment.variantSetup.path : experiment.baselineSetup.path
}

export function expectedSetupPathForArm(
  experiment: SetupExperimentDefinition,
  arm: SetupExperimentArm
): string {
  return arm === 'B' ? experiment.variantSetup.path : experiment.baselineSetup.path
}

export function assertSetupExperimentArmOrder(
  experiment: SetupExperimentDefinition,
  requested: SetupExperimentArm | SetupExperimentProtocolStep
): void {
  const expected = nextSetupExperimentStep(experiment)
  if (!expected) throw new Error('The declared setup experiment protocol is already complete.')
  if (typeof requested === 'string') {
    if (requested !== expected.arm) {
      throw new Error(`Protocol order violation: expected ${expected.arm}, received ${requested}.`)
    }
    return
  }
  if (
    requested.blockId !== expected.blockId ||
    requested.sequence !== expected.sequence ||
    requested.stepIndex !== expected.stepIndex ||
    requested.treatment !== expected.treatment
  ) {
    throw new Error(
      `Protocol sequence violation: expected ${expected.blockId} ${expected.sequence} step ${expected.stepIndex}.`
    )
  }
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

function percentile(sortedValues: readonly number[], probability: number): number {
  const rank = probability * (sortedValues.length - 1)
  const lower = Math.floor(rank)
  const upper = Math.ceil(rank)
  const weight = rank - lower
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight
}

function quantile(values: readonly number[], probability: number): number | null {
  if (values.length === 0) return null
  return percentile([...values].sort((left, right) => left - right), probability)
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
  return {
    used: values.filter((value) => Math.abs(value - center) <= threshold),
    outliers: values.filter((value) => Math.abs(value - center) > threshold),
    median: center,
    mad
  }
}

interface LapValue {
  id: string
  value: number
  flagged: boolean
}

interface CompleteBlock {
  plan: SetupExperimentProtocolBlock
  steps: Array<{ step: SetupExperimentProtocolStep; run: SetupExperimentRun; laps: LapValue[] }>
}

function explicitOutlier(lap: SetupExperimentLap): boolean {
  return lap.flaggedOutlier === true || lap.auditFlags?.includes('outlier') === true
}

function eligibleLapValues(run: SetupExperimentRun): LapValue[] {
  const eligible = run.laps.filter((lap) =>
    lap.eligible && lap.lapTimeSec !== null && Number.isFinite(lap.lapTimeSec)
  )
  const numeric = eligible.map((lap) => lap.lapTimeSec as number)
  const detected = new Set(filterSetupExperimentOutliers(numeric).outliers)
  return eligible.map((lap) => ({
    id: lap.id,
    value: lap.lapTimeSec as number,
    flagged: explicitOutlier(lap) || detected.has(lap.lapTimeSec as number)
  }))
}

function completeBlocks(experiment: SetupExperimentDefinition): CompleteBlock[] {
  return experimentProtocolPlan(experiment).flatMap((plan) => {
    const steps = protocolSteps(plan).map((step) => {
      const run = latestCompletedRunForStep(experiment, step)
      return run ? { step, run, laps: eligibleLapValues(run) } : null
    })
    return steps.every(Boolean) ? [{ plan, steps: steps as CompleteBlock['steps'] }] : []
  })
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function movingBlockResample(
  runId: string,
  values: readonly LapValue[],
  blockLength: number,
  random: () => number
): { values: number[]; windows: SetupExperimentBootstrapWindow[] } {
  const output: number[] = []
  const windows: SetupExperimentBootstrapWindow[] = []
  const length = Math.min(blockLength, values.length)
  const starts = Math.max(1, values.length - length + 1)
  while (output.length < values.length) {
    const startLapIndex = Math.floor(random() * starts)
    const window = values.slice(startLapIndex, startLapIndex + length)
    output.push(...window.map((lap) => lap.value))
    windows.push({ runId, startLapIndex, lapIds: window.map((lap) => lap.id) })
  }
  return { values: output.slice(0, values.length), windows }
}

function fullMedianContrast(
  sampled: Array<{ treatment: SetupExperimentTreatment; values: number[] }>
): number | null {
  const control = sampled.filter((entry) => entry.treatment === 'A').flatMap((entry) => entry.values)
  const variant = sampled.filter((entry) => entry.treatment === 'B').flatMap((entry) => entry.values)
  const controlMedian = median(control)
  const variantMedian = median(variant)
  return controlMedian === null || variantMedian === null ? null : controlMedian - variantMedian
}

function bootstrapMedianContrast(
  blocks: readonly CompleteBlock[],
  plan: SetupExperimentAnalysisPlan,
  excludeFlagged: boolean
): SetupExperimentBootstrapSummary | null {
  if (blocks.length === 0) return null
  const random = mulberry32(plan.seed)
  const effects: number[] = []
  const draws: SetupExperimentBootstrapDraw[] = []
  for (let iteration = 0; iteration < plan.iterations; iteration++) {
    const sampledClusters: string[] = []
    const sampledRuns: Array<{ treatment: SetupExperimentTreatment; values: number[] }> = []
    const windows: SetupExperimentBootstrapWindow[] = []
    for (let clusterIndex = 0; clusterIndex < blocks.length; clusterIndex++) {
      const block = blocks[Math.floor(random() * blocks.length)]
      sampledClusters.push(block.plan.blockId)
      for (const entry of block.steps) {
        const source = excludeFlagged ? entry.laps.filter((lap) => !lap.flagged) : entry.laps
        const sampled = movingBlockResample(entry.run.id, source, plan.lapBlockLength, random)
        sampledRuns.push({ treatment: entry.step.treatment, values: sampled.values })
        windows.push(...sampled.windows)
      }
    }
    const effect = fullMedianContrast(sampledRuns)
    if (effect === null) continue
    effects.push(effect)
    if (draws.length < 8) {
      draws.push({ iteration, sampledClusters, windows, effectSec: effect })
    }
  }
  if (effects.length < Math.max(8, Math.floor(plan.iterations * 0.8))) return null
  const sorted = [...effects].sort((left, right) => left - right)
  const interval95Sec = {
    low: percentile(sorted, 0.025),
    high: percentile(sorted, 0.975)
  }
  const degenerate = Math.abs(interval95Sec.high - interval95Sec.low) < 1e-9
  return {
    seed: plan.seed,
    iterations: plan.iterations,
    lapBlockLength: plan.lapBlockLength,
    minimumIndependentBlocks: plan.minimumIndependentBlocks,
    maxRollbackDriftSec: plan.maxRollbackDriftSec,
    totalDraws: effects.length,
    interval95Sec: degenerate ? null : interval95Sec,
    degenerate,
    draws
  }
}

function directionFromEffect(effect: number | null, material: number): SetupExperimentDirection {
  if (effect === null || Math.abs(effect) < material) return 'abstain'
  return effect > 0 ? 'variant' : 'baseline'
}

function materialEffect(controlMedian: number | null): number {
  return Math.max(0.05, Math.abs(controlMedian ?? 0) * 0.0005)
}

function sensitivityResult(
  blocks: readonly CompleteBlock[],
  plan: SetupExperimentAnalysisPlan,
  minimumLaps: number,
  excludeFlagged: boolean
): SetupExperimentSensitivityResult & {
  bootstrap: SetupExperimentBootstrapSummary | null
  robustDirection: SetupExperimentDirection
  firstContrastSec: number | null
  rollbackContrastSec: number | null
  rollbackDriftSec: number | null
  samplePass: boolean
} {
  const usable = blocks.filter((block) => block.steps.every((entry) => {
    const values = excludeFlagged ? entry.laps.filter((lap) => !lap.flagged) : entry.laps
    return values.length >= minimumLaps
  }))
  const control = usable.flatMap((block) => block.steps)
    .filter((entry) => entry.step.treatment === 'A')
    .flatMap((entry) => (excludeFlagged ? entry.laps.filter((lap) => !lap.flagged) : entry.laps))
    .map((lap) => lap.value)
  const variant = usable.flatMap((block) => block.steps)
    .filter((entry) => entry.step.treatment === 'B')
    .flatMap((entry) => (excludeFlagged ? entry.laps.filter((lap) => !lap.flagged) : entry.laps))
    .map((lap) => lap.value)
  const aMedian = median(control)
  const bMedian = median(variant)
  const effect = aMedian === null || bMedian === null ? null : aMedian - bMedian
  const threshold = materialEffect(aMedian)
  const blockDirections: SetupExperimentDirection[] = []
  const firstContrasts: number[] = []
  const rollbackContrasts: number[] = []
  const drifts: number[] = []
  let rollbackRelation: SetupExperimentRollbackRelation = 'unknown'

  for (const block of usable) {
    const stepValues = block.steps.map((entry) =>
      (excludeFlagged ? entry.laps.filter((lap) => !lap.flagged) : entry.laps).map((lap) => lap.value)
    )
    const stepMedians = stepValues.map((values) => median(values))
    if (stepMedians.some((value) => value === null)) continue
    const medians = stepMedians as number[]
    const first = block.plan.sequence === 'ABA' ? medians[0] - medians[1] : medians[1] - medians[0]
    const rollback = block.plan.sequence === 'ABA' ? medians[2] - medians[1] : medians[1] - medians[2]
    const drift = medians[2] - medians[0]
    firstContrasts.push(first)
    rollbackContrasts.push(rollback)
    drifts.push(drift)
    blockDirections.push(directionFromEffect((first + rollback) / 2, threshold))
  }

  const materialPairs = firstContrasts.map((first, index) => ({
    first,
    rollback: rollbackContrasts[index]
  })).filter(({ first, rollback }) =>
    Math.abs(first) >= threshold && Math.abs(rollback) >= threshold
  )
  if (materialPairs.some(({ first, rollback }) => Math.sign(first) !== Math.sign(rollback))) {
    rollbackRelation = 'conflict'
  } else if (materialPairs.length > 0) {
    rollbackRelation = 'agreement'
  }
  const nonAbstainedBlockDirections = blockDirections.filter((direction) => direction !== 'abstain')
  const blockDirectionPass =
    nonAbstainedBlockDirections.length === usable.length &&
    new Set(nonAbstainedBlockDirections).size === 1
  const driftPass = drifts.length > 0 && drifts.every((drift) => Math.abs(drift) <= plan.maxRollbackDriftSec)
  const bootstrap = bootstrapMedianContrast(usable, plan, excludeFlagged)
  const interval = bootstrap?.interval95Sec ?? null
  const uncertaintyPass = Boolean(
    interval && (interval.low > 0 || interval.high < 0) && bootstrap?.degenerate === false
  )
  const intervalDirection: SetupExperimentDirection = interval
    ? interval.low > 0
      ? 'variant'
      : interval.high < 0
        ? 'baseline'
        : 'abstain'
    : 'abstain'
  const robustDirection =
    usable.length >= plan.minimumIndependentBlocks &&
    blockDirectionPass &&
    driftPass &&
    rollbackRelation === 'agreement' &&
    uncertaintyPass
      ? intervalDirection
      : 'abstain'
  return {
    medians: { A: aMedian, B: bMedian },
    effectSec: effect,
    direction: directionFromEffect(effect, threshold),
    independentBlocks: usable.length,
    confidence95Sec: interval,
    rollbackRelation,
    driftPass,
    uncertaintyPass,
    blockDirectionPass,
    bootstrap,
    robustDirection,
    firstContrastSec: median(firstContrasts),
    rollbackContrastSec: median(rollbackContrasts),
    rollbackDriftSec: drifts.length ? Math.max(...drifts.map((value) => Math.abs(value))) : null,
    samplePass: usable.length === blocks.length && usable.length > 0
  }
}

function aggregateArmStatistics(
  experiment: SetupExperimentDefinition,
  arm: SetupExperimentArm
): SetupExperimentArmStatistics {
  const laps = experiment.runs
    .filter((run) => run.status === 'completed' && run.arm === arm)
    .flatMap((run) => run.laps)
  const clean = laps.filter((lap) => lap.eligible && lap.lapTimeSec !== null)
  const values = clean.map((lap) => lap.lapTimeSec as number)
  const flaggedValues = new Set(filterSetupExperimentOutliers(values).outliers)
  return {
    arm,
    totalLaps: laps.length,
    cleanKnownLaps: clean.length,
    unknownLaps: laps.filter((lap) =>
      lap.incidentState === 'unknown' || lap.telemetryState === 'unknown'
    ).length,
    incidentLaps: laps.filter((lap) => lap.incidentState === 'incident').length,
    usedLaps: clean.length,
    outliers: clean.filter((lap) =>
      explicitOutlier(lap) || flaggedValues.has(lap.lapTimeSec as number)
    ).length,
    medianLapTimeSec: median(values),
    madSec: median(values.map((value) => Math.abs(value - (median(values) ?? value))))
  }
}

function protocolComplete(experiment: SetupExperimentDefinition): boolean {
  return nextSetupExperimentStep(experiment) === null
}

export function analyzeSetupExperiment(
  experiment: SetupExperimentDefinition
): SetupExperimentAnalysis {
  const plan = frozenAnalysisPlan(experiment.analysisPlan)
  const blocks = completeBlocks(experiment)
  const allClean = sensitivityResult(blocks, plan, experiment.minCleanLapsPerArm, false)
  const excludingFlagged = sensitivityResult(blocks, plan, experiment.minCleanLapsPerArm, true)
  const flaggedLapIds = Array.from(new Set(blocks.flatMap((block) =>
    block.steps.flatMap((entry) => entry.laps.filter((lap) => lap.flagged).map((lap) => lap.id))
  )))
  const reasons: string[] = []
  const declaredBlocks = experimentProtocolPlan(experiment)
  const completeBlockIds = new Set(blocks.map((block) => block.plan.blockId))
  for (const block of declaredBlocks) {
    for (const step of protocolSteps(block)) {
      const run = latestCompletedRunForStep(experiment, step)
      if (!run) {
        reasons.push(`protocol-incomplete:${block.blockId}:${step.stepIndex}`)
        continue
      }
      if (eligibleLapValues(run).length < experiment.minCleanLapsPerArm) {
        reasons.push(`insufficient-samples:${block.blockId}:${step.stepIndex}`)
      }
    }
  }
  if (allClean.independentBlocks < plan.minimumIndependentBlocks) {
    reasons.push('insufficient-independent-blocks')
  }
  if (!allClean.blockDirectionPass && allClean.independentBlocks > 0) reasons.push('block-direction-conflict')
  if (allClean.rollbackRelation === 'conflict') reasons.push('rollback-conflict')
  if (!allClean.driftPass && allClean.independentBlocks > 0) reasons.push('rollback-drift')
  if (allClean.bootstrap?.degenerate) reasons.push('uncertainty-degenerate')
  else if (allClean.bootstrap && !allClean.uncertaintyPass) {
    reasons.push('uncertainty-crosses-zero')
  }
  const exploratoryDirection = directionFromEffect(
    allClean.effectSec,
    materialEffect(allClean.medians.A)
  )
  const sensitivitySurvives =
    flaggedLapIds.length === 0 ||
    (
      allClean.robustDirection !== 'abstain' &&
      excludingFlagged.robustDirection === allClean.robustDirection &&
      excludingFlagged.samplePass
    )
  if (!sensitivitySurvives) reasons.push('outlier-sensitive')
  const direction = sensitivitySurvives ? allClean.robustDirection : 'abstain'
  const evidenceStrength: SetupExperimentEvidenceStrength =
    direction !== 'abstain' &&
    allClean.independentBlocks >= plan.minimumIndependentBlocks &&
    protocolComplete(experiment)
      ? 'confirmatory'
      : allClean.effectSec !== null
        ? 'exploratory'
        : 'insufficient'
  const finalDirection = evidenceStrength === 'confirmatory' ? direction : 'abstain'
  const eligible = blocks.length > 0 && allClean.samplePass
  const controlMedian = allClean.medians.A
  const effectPct =
    allClean.effectSec !== null && controlMedian !== null && controlMedian !== 0
      ? (allClean.effectSec / controlMedian) * 100
      : null
  return {
    eligible,
    direction: finalDirection,
    reasons: Array.from(new Set(reasons)),
    arms: {
      A1: aggregateArmStatistics(experiment, 'A1'),
      B: aggregateArmStatistics(experiment, 'B'),
      A2: aggregateArmStatistics(experiment, 'A2')
    },
    effectSec: allClean.effectSec,
    effectPct,
    confidence95Sec: allClean.confidence95Sec,
    firstContrastSec: allClean.firstContrastSec,
    rollbackContrastSec: allClean.rollbackContrastSec,
    rollbackDriftSec: allClean.rollbackDriftSec,
    falseDirectionProtected:
      allClean.rollbackRelation === 'conflict' ||
      !allClean.driftPass ||
      !sensitivitySurvives,
    evidenceStrength,
    exploratoryDirection,
    rollbackRelation: allClean.rollbackRelation,
    blocks: declaredBlocks.filter((block) => completeBlockIds.has(block.blockId)),
    bootstrap: allClean.bootstrap,
    sensitivity: {
      allClean,
      excludingFlagged,
      flaggedLapIds
    }
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
  if (analysis.direction === 'abstain' || analysis.evidenceStrength !== 'confirmatory') {
    if (requestedDirection) {
      throw new Error('Directional decision rejected: evidence is exploratory or must abstain.')
    }
    return
  }
  if (requestedDirection && requestedDirection !== analysis.direction) {
    throw new Error('Directional decision rejected by rollback conflict protection.')
  }
}

export function setupExperimentPortfolioMetrics(
  experiments: readonly SetupExperimentDefinition[]
): SetupExperimentPortfolioMetrics {
  const evaluated = experiments.map((experiment) => ({
    experiment,
    analysis: analyzeSetupExperiment(experiment)
  }))
  const eligible = evaluated.filter(({ analysis }) => analysis.eligible)
  const directional = eligible.filter(({ experiment }) =>
    dispositionDirection(experiment.decision?.disposition ?? 'abstain')
  )
  const aligned = directional.filter(({ experiment, analysis }) =>
    dispositionDirection(experiment.decision?.disposition ?? 'abstain') === analysis.direction
  )
  const confirmatory = evaluated.filter(({ analysis }) =>
    analysis.evidenceStrength === 'confirmatory' && analysis.direction !== 'abstain'
  )
  const rollbackAgreement = evaluated.filter(({ analysis }) =>
    analysis.rollbackRelation === 'agreement' &&
    analysis.confidence95Sec !== null &&
    (analysis.confidence95Sec.low > 0 || analysis.confidence95Sec.high < 0) &&
    !analysis.reasons.includes('rollback-drift') &&
    !analysis.reasons.includes('block-direction-conflict') &&
    !analysis.reasons.includes('outlier-sensitive')
  )
  const rollbackConflict = evaluated.filter(({ analysis }) =>
    analysis.rollbackRelation === 'conflict'
  )
  const rollbackEvaluatedSignals = rollbackAgreement.length + rollbackConflict.length
  const rollbackAgreementRate = rollbackEvaluatedSignals > 0
    ? rollbackAgreement.length / rollbackEvaluatedSignals
    : null
  const rollbackConflictRate = rollbackEvaluatedSignals > 0
    ? rollbackConflict.length / rollbackEvaluatedSignals
    : null
  const decisionCoverage = eligible.length > 0 ? directional.length / eligible.length : null
  const protocolCompletionRate = experiments.length > 0
    ? evaluated.filter(({ experiment }) => protocolComplete(experiment)).length / experiments.length
    : null
  const agreementTargetMet = rollbackAgreementRate === null ? null : rollbackAgreementRate >= 0.7
  const conflictTargetMet = rollbackConflictRate === null ? null : rollbackConflictRate <= 0.1
  return {
    definitions: experiments.length,
    completedProtocols: evaluated.filter(({ experiment }) => protocolComplete(experiment)).length,
    eligibleExperiments: eligible.length,
    directionalDecisions: directional.length,
    alignedDirectionalDecisions: aligned.length,
    falseDirectionDecisions: directional.length - aligned.length,
    confirmatoryDirections: confirmatory.length,
    rollbackEvaluatedSignals,
    rollbackAgreementSignals: rollbackAgreement.length,
    rollbackConflictSignals: rollbackConflict.length,
    rollbackConfirmedDirections: confirmatory.filter(({ analysis }) =>
      analysis.rollbackRelation === 'agreement'
    ).length,
    protocolCompletionRate,
    decisionCoverage,
    rollbackAgreementRate,
    rollbackConflictRate,
    coverageTargetMet: decisionCoverage === null ? null : decisionCoverage >= 0.5,
    agreementTargetMet,
    conflictTargetMet,
    conditionalDirectionalAccuracy: rollbackAgreementRate,
    falseDirectionRate: rollbackConflictRate,
    accuracyTargetMet: agreementTargetMet,
    falseDirectionTargetMet: conflictTargetMet,
    rollbackEvaluatedDirections: rollbackEvaluatedSignals,
    rollbackConfirmedDirectionsLegacy: rollbackAgreement.length,
    falseDirectionSignals: rollbackConflict.length
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
    state: {
      schemaVersion: SETUP_EXPERIMENT_SCHEMA_VERSION,
      revision: state.revision ?? 0,
      storageIssues: state.storageIssues ?? [],
      experiments
    },
    recovered
  }
}

export function normalizeSetupExperimentState(
  state: SetupExperimentStoredState
): SetupExperimentStoredState {
  return {
    schemaVersion: SETUP_EXPERIMENT_SCHEMA_VERSION,
    revision: Number.isSafeInteger(state.revision) && Number(state.revision) >= 0
      ? Number(state.revision)
      : 0,
    storageIssues: Array.isArray(state.storageIssues) ? state.storageIssues : [],
    experiments: Array.isArray(state.experiments)
      ? state.experiments.map((experiment) => ({
          ...experiment,
          analysisPlan: { ...frozenAnalysisPlan(experiment.analysisPlan) },
          environmentTolerances: experiment.environmentTolerances === undefined
            ? { ...DEFAULT_SETUP_EXPERIMENT_TOLERANCES }
            : { ...experiment.environmentTolerances },
          protocolPlan: normalizedProtocolPlan(experiment.protocolPlan)
        }))
      : []
  }
}

export function emptySetupExperimentState(
  storageIssues: SetupExperimentStorageIssue[] = []
): SetupExperimentStoredState {
  return {
    schemaVersion: SETUP_EXPERIMENT_SCHEMA_VERSION,
    revision: 0,
    storageIssues,
    experiments: []
  }
}
