import { describe, expect, it } from 'vitest'
import type { SetupLibraryItem } from './setup-manager'
import type { StoDiffResult } from './sto-parser'
import type { TelemetrySnapshot } from './telemetry'
import {
  analyzeSetupExperiment,
  assertSetupExperimentArmOrder,
  assertSetupExperimentDecision,
  compareSetupExperimentContexts,
  createSetupExperimentDefinition,
  expectedSetupPathForArm,
  filterSetupExperimentOutliers,
  nextSetupExperimentArm,
  nextSetupExperimentStep,
  oneVariableFromSetupDiff,
  recoverSetupExperimentStateAfterRestart,
  setupExperimentConditionFromTelemetry,
  setupExperimentContextFromTelemetry,
  setupExperimentPortfolioMetrics,
  type SetupExperimentArm,
  type SetupExperimentCondition,
  type SetupExperimentContext,
  type SetupExperimentDefinition,
  type SetupExperimentLap,
  type SetupExperimentRun
} from './setup-experiment'
import type { SetupExperimentStoredState } from './setup-experiment'

const singleDiff: StoDiffResult = {
  totalChanges: 1,
  sections: [{
    section: 'Aero',
    added: [],
    removed: [],
    changed: [{ key: 'Rear Wing', kind: 'changed', before: '8', after: '7' }]
  }]
}

function setup(path: string, fileName: string): SetupLibraryItem {
  return {
    id: path,
    path,
    fileName,
    relativePath: `car\\${fileName}`,
    carFolder: 'car',
    sizeBytes: 100,
    modifiedAt: 1,
    metadata: { car: 'GT3', track: 'Spa', notes: '', tags: [], rating: 0, updatedAt: 0 }
  }
}

function context(condition: SetupExperimentCondition = 'dry'): SetupExperimentContext {
  return {
    sim: 'iracing',
    car: 'ferrari488gt3',
    carLabel: 'Ferrari 488 GT3',
    track: 'Spa',
    layout: 'Grand Prix',
    layoutSource: 'telemetry',
    condition,
    session: 'Practice',
    sessionId: '42',
    trackWetnessPct: condition === 'wet' ? 0.5 : condition === 'dry' ? 0 : null,
    trackTempC: 31,
    airTempC: 22,
    fuelMassKg: 45,
    tyreStatePct: 0.8,
    trafficDensity: 0.3,
    flagStateIndex: 0,
    damagePct: 0,
    gripPct: 0.8
  }
}

function definition(id = 'experiment-1'): SetupExperimentDefinition {
  return createSetupExperimentDefinition({
    id,
    name: 'Rear wing test',
    now: 1000,
    baseline: setup('C:\\setups\\a.sto', 'a.sto'),
    variant: setup('C:\\setups\\b.sto', 'b.sto'),
    diff: singleDiff,
    context: context()
  })
}

function lap(
  arm: SetupExperimentArm,
  lapTimeSec: number,
  index: number,
  overrides: Partial<SetupExperimentLap> = {}
): SetupExperimentLap {
  return {
    id: `${arm}-${index}`,
    arm,
    capturedAt: 2000 + index,
    lapNumber: index,
    lapTimeSec,
    completion: 'complete',
    incidentDelta: 0,
    incidentState: 'clean',
    telemetryState: 'known',
    context: context(),
    comparability: { status: 'comparable', issues: [] },
    eligible: true,
    exclusionReasons: [],
    ...overrides
  }
}

function completeArm(
  experiment: SetupExperimentDefinition,
  arm: SetupExperimentArm,
  times: number[]
): void {
  const run: SetupExperimentRun = {
    id: `run-${arm}`,
    arm,
    setupPath: expectedSetupPathForArm(experiment, arm),
    status: 'completed',
    startedAt: 1500,
    completedAt: 2500,
    startContext: context(),
    laps: times.map((time, index) => lap(arm, time, index + 1)),
    rejectionReasons: []
  }
  experiment.runs.push(run)
}

function completedExperiment(
  id: string,
  a1: number[],
  b: number[],
  a2: number[]
): SetupExperimentDefinition {
  const experiment = definition(id)
  completeArm(experiment, 'A1', a1)
  completeArm(experiment, 'B', b)
  completeArm(experiment, 'A2', a2)
  return experiment
}

function telemetry(overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1000,
    speedKmh: 0,
    rpm: 0,
    gear: 0,
    throttle: 0,
    brake: 0,
    clutch: 0,
    ...overrides
  }
}

describe('setup experiment definition', () => {
  it('accepts exactly one setup variable and rejects zero or multiple changes', () => {
    expect(oneVariableFromSetupDiff(singleDiff)).toEqual({
      section: 'Aero',
      key: 'Rear Wing',
      kind: 'changed',
      before: '8',
      after: '7'
    })
    expect(() => oneVariableFromSetupDiff({ totalChanges: 0, sections: [] })).toThrow(/exactly one/i)
    expect(() => oneVariableFromSetupDiff({
      totalChanges: 2,
      sections: [{
        section: 'Aero',
        added: [],
        removed: [],
        changed: [
          { key: 'Rear Wing', kind: 'changed', before: '8', after: '7' },
          { key: 'Front Wing', kind: 'changed', before: '3', after: '4' }
        ]
      }]
    })).toThrow(/found 2/i)
  })

  it('enforces A1-B-A2 order and maps rollback A2 to the baseline setup', () => {
    const experiment = definition()
    expect(nextSetupExperimentArm(experiment)).toBe('A1')
    expect(() => assertSetupExperimentArmOrder(experiment, 'B')).toThrow(/expected A1/i)
    completeArm(experiment, 'A1', [])
    expect(nextSetupExperimentArm(experiment)).toBe('B')
    completeArm(experiment, 'B', [])
    expect(nextSetupExperimentArm(experiment)).toBe('A2')
    expect(expectedSetupPathForArm(experiment, 'A2')).toBe(experiment.baselineSetup.path)
    expect(() => assertSetupExperimentArmOrder(experiment, 'B')).toThrow(/expected A2/i)
  })

  it('advances A1-B-A2 only after completed runs', () => {
    const experiment = definition('completed-only-order')
    expect(nextSetupExperimentArm(experiment)).toBe('A1')

    const attempts: Array<{
      id: string
      status: SetupExperimentRun['status']
      completedAt?: number
      rejectionReasons: string[]
    }> = [
      { id: 'recording-A1', status: 'recording', rejectionReasons: [] },
      { id: 'rejected-A1', status: 'rejected', completedAt: 1200, rejectionReasons: ['setup-mismatch'] },
      { id: 'interrupted-A1', status: 'interrupted', completedAt: 1300, rejectionReasons: ['user-stop'] }
    ]

    for (const attempt of attempts) {
      experiment.runs.push({
        id: attempt.id,
        arm: 'A1',
        setupPath: expectedSetupPathForArm(experiment, 'A1'),
        status: attempt.status,
        startedAt: 1100,
        completedAt: attempt.completedAt,
        startContext: context(),
        laps: [],
        rejectionReasons: attempt.rejectionReasons
      })
      expect(nextSetupExperimentArm(experiment)).toBe('A1')
    }
    expect(experiment.runs.map((run) => run.status)).toEqual(['recording', 'rejected', 'interrupted'])

    completeArm(experiment, 'A1', [])
    expect(nextSetupExperimentArm(experiment)).toBe('B')
    completeArm(experiment, 'B', [])
    expect(nextSetupExperimentArm(experiment)).toBe('A2')
    completeArm(experiment, 'A2', [])
    expect(nextSetupExperimentArm(experiment)).toBeNull()
    expect(() => assertSetupExperimentArmOrder(experiment, 'A1')).toThrow(/already complete/i)
  })

  it('rejects inconsistent reported and flattened diff cardinality', () => {
    const twoEntriesButOneReported: StoDiffResult = {
      totalChanges: 1,
      sections: [{
        section: 'Aero',
        added: [],
        removed: [],
        changed: [
          { key: 'Rear Wing', kind: 'changed', before: '8', after: '7' },
          { key: 'Front Wing', kind: 'changed', before: '3', after: '4' }
        ]
      }]
    }
    const oneEntryButTwoReported: StoDiffResult = {
      ...singleDiff,
      totalChanges: 2
    }

    expect(() => oneVariableFromSetupDiff(twoEntriesButOneReported)).toThrow(/exactly one variable/i)
    expect(() => oneVariableFromSetupDiff(oneEntryButTwoReported)).toThrow(/exactly one variable/i)
  })
})

describe('setup experiment comparability', () => {
  it('rejects wet versus dry while preserving missing condition as unknown', () => {
    expect(compareSetupExperimentContexts(context('dry'), context('wet'))).toMatchObject({
      status: 'incomparable',
      issues: [{ field: 'condition', kind: 'mismatch' }]
    })
    expect(compareSetupExperimentContexts(context('dry'), context('unknown'))).toMatchObject({
      status: 'unknown',
      issues: [{ field: 'condition', kind: 'unknown' }]
    })
  })

  it('rejects a different sim, car, track, layout or session identity', () => {
    const actual = { ...context(), layout: 'Endurance', sessionId: '43' }
    const report = compareSetupExperimentContexts(context(), actual)
    expect(report.status).toBe('incomparable')
    expect(report.issues.map((issue) => issue.field)).toEqual(['layout', 'sessionId'])
  })

  it('keeps a known mismatch incomparable when another field is unknown', () => {
    const report = compareSetupExperimentContexts(context('dry'), {
      ...context('unknown'),
      layout: 'Endurance'
    })
    expect(report.status).toBe('incomparable')
    expect(report.issues).toEqual([
      { field: 'layout', kind: 'mismatch', expected: 'Grand Prix', actual: 'Endurance' },
      { field: 'condition', kind: 'unknown', expected: 'dry', actual: 'unknown' }
    ])
  })

  it('treats an available driver feed with no radar contacts as known zero traffic', () => {
    const snapshot = telemetry({
      carName: 'Ferrari 488 GT3',
      carPath: 'ferrari488gt3',
      trackName: 'Spa',
      trackConfigName: 'Grand Prix',
      sessionType: 'Practice',
      sessionUniqueId: 42,
      trackWetnessPct: 0,
      trackTempC: 31,
      airTempC: 22,
      fuelMassKg: 45,
      tyreStatePct: 0.8,
      flagStateIndex: 0,
      damagePct: 0,
      gripPct: 0.8,
      drivers: [],
      radarCars: undefined
    })

    expect(setupExperimentContextFromTelemetry(snapshot)?.trafficDensity).toBe(0)
  })

  it.each([
    { label: 'raining signal', override: { isRaining: true }, expected: 'wet' },
    { label: 'declared-wet signal', override: { weatherDeclaredWet: true }, expected: 'wet' },
    { label: 'track wetness above boundary', override: { trackWetnessPct: 0.010001 }, expected: 'wet' },
    { label: 'precipitation above boundary', override: { precipitationPct: 0.010001 }, expected: 'wet' },
    { label: 'track wetness at boundary', override: { trackWetnessPct: 0.01 }, expected: 'dry' },
    {
      label: 'explicit dry rain signals',
      override: { isRaining: false, weatherDeclaredWet: false },
      expected: 'dry'
    },
    {
      label: 'precipitation at boundary without other evidence',
      override: { precipitationPct: 0.01 },
      expected: 'unknown'
    },
    { label: 'no weather evidence', override: {}, expected: 'unknown' }
  ] as Array<{
    label: string
    override: Partial<TelemetrySnapshot>
    expected: SetupExperimentCondition
  }>)('$label -> $expected', ({ override, expected }) => {
    expect(setupExperimentConditionFromTelemetry(telemetry(override))).toBe(expected)
  })
})

describe('setup experiment analysis', () => {
  it('flags deterministic lap-time outliers without deleting clean laps or claiming a single-block direction', () => {
    const filtered = filterSetupExperimentOutliers([100, 100.1, 99.9, 100.05, 100, 130])
    expect(filtered.used).toHaveLength(5)
    expect(filtered.outliers).toEqual([130])

    const experiment = completedExperiment(
      'outliers',
      [100, 100.1, 99.9, 100.05, 100, 130],
      [99, 99.1, 98.9, 99.05, 99, 125],
      [100.1, 100, 100.2, 99.95, 100.05, 140]
    )
    const analysis = analyzeSetupExperiment(experiment)
    expect(analysis.eligible).toBe(true)
    expect(analysis.direction).toBe('abstain')
    expect(analysis.evidenceStrength).toBe('exploratory')
    expect(analysis.arms.A1.outliers).toBe(1)
    expect(analysis.arms.B.outliers).toBe(1)
    expect(analysis.arms.A2.outliers).toBe(1)
    expect(analysis.arms.A1.usedLaps).toBe(6)
    expect(analysis.sensitivity?.flaggedLapIds).toHaveLength(3)
  })

  it('abstains when any arm has insufficient clean known samples', () => {
    const experiment = completedExperiment(
      'insufficient',
      [100, 100.1, 99.9, 100],
      [99, 99.1, 98.9, 99],
      [100, 100.1, 99.9, 100]
    )
    const analysis = analyzeSetupExperiment(experiment)
    expect(analysis.eligible).toBe(false)
    expect(analysis.direction).toBe('abstain')
    expect(analysis.reasons).toEqual(expect.arrayContaining([
      expect.stringMatching(/^insufficient-samples:.*:0$/),
      expect.stringMatching(/^insufficient-samples:.*:1$/),
      expect.stringMatching(/^insufficient-samples:.*:2$/)
    ]))
  })

  it('abstains when rollback reverses the apparent A1-to-B direction', () => {
    const experiment = completedExperiment(
      'rollback-conflict',
      [100, 100.1, 99.9, 100.05, 100],
      [99, 99.1, 98.9, 99.05, 99],
      [98, 98.1, 97.9, 98.05, 98]
    )
    const analysis = analyzeSetupExperiment(experiment)
    expect(analysis.eligible).toBe(true)
    expect(analysis.direction).toBe('abstain')
    expect(analysis.reasons).toContain('rollback-conflict')
    expect(analysis.falseDirectionProtected).toBe(true)
  })

  it('rejects a user direction opposite to rollback-confirmed evidence', () => {
    const experiment = completedExperiment(
      'decision-protection',
      [100, 100.1, 99.9, 100.05, 100],
      [99, 99.1, 98.9, 99.05, 99],
      [100.1, 100, 100.2, 99.95, 100.05]
    )
    const analysis = analyzeSetupExperiment(experiment)
    expect(analysis.direction).toBe('abstain')
    expect(analysis.evidenceStrength).toBe('exploratory')
    expect(() => assertSetupExperimentDecision(analysis, 'keep-baseline')).toThrow(/exploratory|abstain/i)
    expect(() => assertSetupExperimentDecision(analysis, 'keep-variant')).toThrow(/exploratory|abstain/i)
  })

  it('reports decision coverage and does not reward always-abstain', () => {
    const decided = completedExperiment(
      'decided',
      [100, 100.1, 99.9, 100.05, 100],
      [99, 99.1, 98.9, 99.05, 99],
      [100.1, 100, 100.2, 99.95, 100.05]
    )
    decided.decision = { disposition: 'keep-variant', decidedAt: 5000, note: '' }
    const abstained = completedExperiment(
      'abstained',
      [100, 100.1, 99.9, 100.05, 100],
      [99, 99.1, 98.9, 99.05, 99],
      [100.1, 100, 100.2, 99.95, 100.05]
    )
    abstained.decision = { disposition: 'abstain', decidedAt: 5000, note: '' }

    expect(setupExperimentPortfolioMetrics([decided, abstained])).toMatchObject({
      eligibleExperiments: 2,
      directionalDecisions: 1,
      decisionCoverage: 0.5,
      conditionalDirectionalAccuracy: 1,
      falseDirectionRate: 0,
      coverageTargetMet: true,
      accuracyTargetMet: true,
      falseDirectionTargetMet: true
    })
    expect(setupExperimentPortfolioMetrics([abstained]).decisionCoverage).toBe(0)
  })

  it('measures false direction from A1-B evidence contradicted by the A2 rollback', () => {
    const conflict = completedExperiment(
      'portfolio-conflict',
      [100, 100.1, 99.9, 100.05, 100],
      [99, 99.1, 98.9, 99.05, 99],
      [98, 98.1, 97.9, 98.05, 98]
    )
    expect(setupExperimentPortfolioMetrics([conflict])).toMatchObject({
      rollbackEvaluatedDirections: 1,
      rollbackConfirmedDirections: 0,
      falseDirectionSignals: 1,
      conditionalDirectionalAccuracy: 0,
      falseDirectionRate: 1,
      accuracyTargetMet: false,
      falseDirectionTargetMet: false
    })
  })

  it('uses the zero-MAD fallback only to flag sensitivity while retaining all clean samples', () => {
    const filtered = filterSetupExperimentOutliers([99, 99, 99, 99, 130])
    expect(filtered).toEqual({
      used: [99, 99, 99, 99],
      outliers: [130],
      median: 99,
      mad: 0
    })

    const experiment = completedExperiment(
      'post-filter-insufficient',
      [100, 100, 100, 100, 100],
      [99, 99, 99, 99, 130],
      [100, 100, 100, 100, 100]
    )
    const analysis = analyzeSetupExperiment(experiment)
    expect(analysis.eligible).toBe(true)
    expect(analysis.direction).toBe('abstain')
    expect(analysis.arms.B).toMatchObject({
      cleanKnownLaps: 5,
      usedLaps: 5,
      outliers: 1
    })
    expect(analysis.effectSec).not.toBeNull()
    expect(analysis.sensitivity?.flaggedLapIds).toContain('B-5')
  })

  it('starts filtering at four samples while leaving smaller samples unchanged', () => {
    expect(filterSetupExperimentOutliers([100, 100, 130])).toMatchObject({
      used: [100, 100, 130],
      outliers: []
    })
    expect(filterSetupExperimentOutliers([100, 100, 100, 130])).toMatchObject({
      used: [100, 100, 100],
      outliers: [130]
    })
  })

  it('abstains and rejects both directions when rollback drift is excessive', () => {
    const experiment = completedExperiment(
      'rollback-drift',
      [100, 100, 100, 100, 100],
      [99.9, 99.9, 99.9, 99.9, 99.9],
      [102, 102, 102, 102, 102]
    )
    const analysis = analyzeSetupExperiment(experiment)
    expect(analysis.eligible).toBe(true)
    expect(analysis.direction).toBe('abstain')
    expect(analysis.reasons).toContain('rollback-drift')
    expect(analysis.falseDirectionProtected).toBe(true)
    expect(analysis.effectSec).toBeCloseTo(1.1)
    expect(analysis.firstContrastSec).toBeCloseTo(0.1)
    expect(analysis.rollbackContrastSec).toBeCloseTo(2.1)
    expect(analysis.rollbackDriftSec).toBeCloseTo(2)
    expect(() => assertSetupExperimentDecision(analysis, 'keep-variant')).toThrow(/exploratory|abstain/i)
    expect(() => assertSetupExperimentDecision(analysis, 'keep-baseline')).toThrow(/exploratory|abstain/i)
    expect(() => assertSetupExperimentDecision(analysis, 'abstain')).not.toThrow()
  })

  it('rejects a variant decision when rollback-confirmed evidence favors the baseline', () => {
    const experiment = completedExperiment(
      'baseline-decision-protection',
      [99, 99, 99, 99, 99],
      [100, 100, 100, 100, 100],
      [99, 99, 99, 99, 99]
    )
    const analysis = analyzeSetupExperiment(experiment)
    expect(analysis.direction).toBe('abstain')
    expect(analysis.exploratoryDirection).toBe('baseline')
    expect(analysis.effectSec).toBeCloseTo(-1)
    expect(analysis.falseDirectionProtected).toBe(false)
    expect(() => assertSetupExperimentDecision(analysis, 'keep-variant')).toThrow(/exploratory|abstain/i)
    expect(() => assertSetupExperimentDecision(analysis, 'keep-baseline')).toThrow(/exploratory|abstain/i)
  })
})

describe('setup experiment restart recovery', () => {
  it('is idempotent, deduplicates app-restart and does not advance the arm', () => {
    const experiment = definition('restart-recovery')
    const recordingRun: SetupExperimentRun = {
      id: 'recording-A1',
      arm: 'A1',
      setupPath: expectedSetupPathForArm(experiment, 'A1'),
      status: 'recording',
      startedAt: 1100,
      startContext: context(),
      laps: [],
      rejectionReasons: ['app-restart']
    }
    const rejectedRun: SetupExperimentRun = {
      id: 'rejected-A1',
      arm: 'A1',
      setupPath: expectedSetupPathForArm(experiment, 'A1'),
      status: 'rejected',
      startedAt: 1200,
      completedAt: 1300,
      startContext: context(),
      laps: [],
      rejectionReasons: ['setup-mismatch']
    }
    const rejectedBeforeRecovery = structuredClone(rejectedRun)
    experiment.runs.push(recordingRun, rejectedRun)
    const state: SetupExperimentStoredState = {
      schemaVersion: experiment.schemaVersion,
      experiments: [experiment]
    }

    const firstRecovery = recoverSetupExperimentStateAfterRestart(state, 5000)
    expect(firstRecovery.recovered).toBe(true)
    const recoveredExperiment = firstRecovery.state.experiments[0]
    expect(recoveredExperiment.updatedAt).toBe(5000)
    expect(recoveredExperiment.runs[0]).toMatchObject({
      status: 'interrupted',
      completedAt: 5000
    })
    expect(recoveredExperiment.runs[0].rejectionReasons).toEqual(['app-restart'])
    expect(recoveredExperiment.runs[1]).toEqual(rejectedBeforeRecovery)
    expect(nextSetupExperimentArm(recoveredExperiment)).toBe('A1')

    const secondRecovery = recoverSetupExperimentStateAfterRestart(firstRecovery.state, 6000)
    expect(secondRecovery.recovered).toBe(false)
    expect(secondRecovery.state).toEqual(firstRecovery.state)
  })
})

type RuntimeRecord = Record<string, unknown>

type RuntimeAnalysisPlan = {
  seed: number
  iterations: number
  lapBlockLength: number
  minimumIndependentBlocks: number
  maxRollbackDriftSec: number
}

type RuntimeEnvironment = {
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

type RuntimeEnvironmentField = keyof RuntimeEnvironment
type RuntimeEnvironmentTolerances = Record<RuntimeEnvironmentField, number>
type RuntimeSequence = 'ABA' | 'BAB'
type RuntimeTreatment = 'A' | 'B'

type RuntimeProtocolStep = {
  blockId: string
  sequence: RuntimeSequence
  stepIndex: number
  treatment: RuntimeTreatment
}

type RuntimeProtocolRun = SetupExperimentRun & RuntimeProtocolStep

type RuntimeExperimentDefinition = SetupExperimentDefinition & {
  analysisPlan: RuntimeAnalysisPlan
  environmentTolerances: RuntimeEnvironmentTolerances
  protocolPlan?: Array<{ blockId: string; sequence: RuntimeSequence }>
}

const RUNTIME_ENVIRONMENT_CASES: ReadonlyArray<{
  label: string
  field: RuntimeEnvironmentField
  baseline: number
  maxDelta: number
  epsilon: number
}> = [
  { label: 'wetness', field: 'trackWetnessPct', baseline: 0.2, maxDelta: 0.05, epsilon: 0.000001 },
  { label: 'track temperature', field: 'trackTempC', baseline: 30, maxDelta: 2, epsilon: 0.000001 },
  { label: 'air temperature', field: 'airTempC', baseline: 20, maxDelta: 1.5, epsilon: 0.000001 },
  { label: 'fuel mass', field: 'fuelMassKg', baseline: 45, maxDelta: 1, epsilon: 0.000001 },
  { label: 'tyre state', field: 'tyreStatePct', baseline: 0.8, maxDelta: 0.02, epsilon: 0.000001 },
  { label: 'traffic', field: 'trafficDensity', baseline: 0.3, maxDelta: 0.05, epsilon: 0.000001 },
  { label: 'flags', field: 'flagStateIndex', baseline: 0, maxDelta: 0, epsilon: 0.000001 },
  { label: 'damage', field: 'damagePct', baseline: 0, maxDelta: 0.005, epsilon: 0.000001 },
  { label: 'track evolution', field: 'gripPct', baseline: 0.8, maxDelta: 0.02, epsilon: 0.000001 }
]

function runtimeRecord(value: unknown): RuntimeRecord {
  expect(value).toBeTypeOf('object')
  expect(value).not.toBeNull()
  return value as RuntimeRecord
}

function runtimeAnalysisPlan(overrides: Partial<RuntimeAnalysisPlan> = {}): RuntimeAnalysisPlan {
  return {
    seed: 0x5eed1234,
    iterations: 512,
    lapBlockLength: 2,
    minimumIndependentBlocks: 2,
    maxRollbackDriftSec: 0.5,
    ...overrides
  }
}

function runtimeEnvironment(): SetupExperimentContext & RuntimeEnvironment {
  return Object.assign(context(), {
    trackWetnessPct: 0.2,
    trackTempC: 30,
    airTempC: 20,
    fuelMassKg: 45,
    tyreStatePct: 0.8,
    trafficDensity: 0.3,
    flagStateIndex: 0,
    damagePct: 0,
    gripPct: 0.8
  })
}

function runtimeTolerances(): RuntimeEnvironmentTolerances {
  return {
    trackWetnessPct: 0.05,
    trackTempC: 2,
    airTempC: 1.5,
    fuelMassKg: 1,
    tyreStatePct: 0.02,
    trafficDensity: 0.05,
    flagStateIndex: 0,
    damagePct: 0.005,
    gripPct: 0.02
  }
}

function runtimeExperiment(id: string): RuntimeExperimentDefinition {
  return Object.assign(definition(id), {
    analysisPlan: runtimeAnalysisPlan(),
    environmentTolerances: runtimeTolerances()
  })
}

function addProtocolBlock(
  experiment: SetupExperimentDefinition,
  options: {
    blockId: string
    sequence: RuntimeSequence
    values: readonly [readonly number[], readonly number[], readonly number[]]
    timestampBase: number
    legacyArms?: readonly [SetupExperimentArm, SetupExperimentArm, SetupExperimentArm]
  }
): RuntimeProtocolRun[] {
  const treatments = options.sequence.split('') as RuntimeTreatment[]
  const legacyArms = options.legacyArms ?? ['A1', 'B', 'A2']
  const runs = options.values.map((times, stepIndex) => {
    const arm = legacyArms[stepIndex]
    const metadata: RuntimeProtocolStep = {
      blockId: options.blockId,
      sequence: options.sequence,
      stepIndex,
      treatment: treatments[stepIndex]
    }
    const laps = times.map((time, lapIndex) => Object.assign(
      lap(arm, time, lapIndex + 1, {
        id: `${options.blockId}-step-${stepIndex}-lap-${lapIndex + 1}`,
        capturedAt: options.timestampBase + (stepIndex * 100) + lapIndex
      }),
      metadata
    ))
    return Object.assign({
      id: `${options.blockId}-step-${stepIndex}`,
      arm,
      setupPath: metadata.treatment === 'B'
        ? experiment.variantSetup.path
        : experiment.baselineSetup.path,
      status: 'completed' as const,
      startedAt: options.timestampBase + (stepIndex * 100),
      completedAt: options.timestampBase + (stepIndex * 100) + 50,
      startContext: runtimeEnvironment(),
      laps,
      rejectionReasons: []
    }, metadata)
  })
  experiment.runs.push(...runs)
  return runs
}

function nonDegenerateDirectionalExperiment(id = 'runtime-directional'): RuntimeExperimentDefinition {
  const experiment = runtimeExperiment(id)
  addProtocolBlock(experiment, {
    blockId: 'block-001',
    sequence: 'ABA',
    values: [
      [100.2, 100, 100.1, 99.9, 100.3],
      [98.8, 99, 98.9, 99.1, 98.7],
      [100.1, 99.9, 100, 100.2, 99.8]
    ],
    timestampBase: 10_000
  })
  addProtocolBlock(experiment, {
    blockId: 'block-002',
    sequence: 'BAB',
    values: [
      [98.9, 98.7, 99, 98.8, 99.1],
      [100.1, 100.3, 100, 100.2, 99.9],
      [98.8, 99, 98.7, 99.1, 98.9]
    ],
    timestampBase: 20_000
  })
  return experiment
}

function oneProtocolBlockExperiment(
  id: string,
  values: readonly [readonly number[], readonly number[], readonly number[]]
): RuntimeExperimentDefinition {
  const experiment = runtimeExperiment(id)
  addProtocolBlock(experiment, {
    blockId: 'block-001',
    sequence: 'ABA',
    values,
    timestampBase: 30_000
  })
  return experiment
}

function analysisRuntime(result: unknown): RuntimeRecord {
  return runtimeRecord(result)
}

function iidLapIntervalWidth(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1)
  return 3.92 * Math.sqrt(variance) / Math.sqrt(values.length)
}

function runtimeSensitivityExperiment(id = 'outlier-sensitivity'): RuntimeExperimentDefinition {
  const experiment = completedExperiment(
    id,
    [99.8, 99.85, 99.9, 99.95, 100, 100.05, 100.1, 100.15, 100.2],
    [98, 98.1, 98.2, 98.3, 98.5, 102, 102.1, 102.2, 102.3, 130],
    [99.8, 99.85, 99.9, 99.95, 100, 100.05, 100.1, 100.15, 100.2]
  )
  Object.assign(experiment, {
    analysisPlan: runtimeAnalysisPlan(),
    environmentTolerances: runtimeTolerances()
  })
  experiment.runs.forEach((run, stepIndex) => {
    Object.assign(run, {
      blockId: 'block-001',
      sequence: 'ABA',
      stepIndex,
      treatment: stepIndex === 1 ? 'B' : 'A'
    })
  })
  return experiment as RuntimeExperimentDefinition
}

const compareWithRuntimeContract =
  compareSetupExperimentContexts as unknown as (
    expected: SetupExperimentContext & RuntimeEnvironment,
    actual: (SetupExperimentContext & RuntimeEnvironment) | null | undefined,
    tolerances: Partial<RuntimeEnvironmentTolerances>
  ) => {
    status: 'comparable' | 'incomparable' | 'unknown'
    issues: Array<{ field: string; kind: 'mismatch' | 'unknown'; expected: unknown; actual: unknown }>
  }

describe('setup experiment uncertainty contracts', () => {
  it('abstains with an explicit uncertainty reason for the exact zero-width median fixture', () => {
    const experiment = completedExperiment(
      'zero-width-median',
      [100, 100, 100, 100, 100],
      [99, 99, 99, 99, 99],
      [100, 100, 100, 100, 100]
    )
    Object.assign(experiment, { analysisPlan: runtimeAnalysisPlan() })

    const analysis = analyzeSetupExperiment(experiment)

    expect(analysis.direction).toBe('abstain')
    expect(analysis.reasons).toContain('uncertainty-degenerate')
    expect(analysis.confidence95Sec).not.toEqual({ low: 1, high: 1 })
    expect(analysisRuntime(analysis).evidenceStrength).not.toBe('confirmatory')
  })

  it('rejects both directional dispositions for degenerate median uncertainty', () => {
    const experiment = completedExperiment(
      'zero-width-decision',
      [100, 100, 100, 100, 100],
      [99, 99, 99, 99, 99],
      [100, 100, 100, 100, 100]
    )
    Object.assign(experiment, { analysisPlan: runtimeAnalysisPlan() })
    const analysis = analyzeSetupExperiment(experiment)

    expect(() => assertSetupExperimentDecision(analysis, 'keep-variant')).toThrow(/abstain|uncertainty/i)
    expect(() => assertSetupExperimentDecision(analysis, 'keep-baseline')).toThrow(/abstain|uncertainty/i)
    expect(() => assertSetupExperimentDecision(analysis, 'abstain')).not.toThrow()
  })

  it('keeps directional-control assertions on non-degenerate repeated-block evidence', () => {
    const analysis = analyzeSetupExperiment(nonDegenerateDirectionalExperiment())
    const bootstrap = runtimeRecord(analysisRuntime(analysis).bootstrap)
    const interval = runtimeRecord(bootstrap.interval95Sec)

    expect(Number(interval.high) - Number(interval.low)).toBeGreaterThan(0)
    expect(analysisRuntime(analysis).evidenceStrength).toBe('confirmatory')
    expect(analysis.direction).toBe('variant')
  })
})

describe('setup experiment seeded cluster bootstrap', () => {
  it('returns byte-for-byte identical bootstrap summaries for seed 0x5eed1234', () => {
    const fixture = nonDegenerateDirectionalExperiment('seed-repeatability')
    const first = analysisRuntime(analyzeSetupExperiment(structuredClone(fixture))).bootstrap
    const second = analysisRuntime(analyzeSetupExperiment(structuredClone(fixture))).bootstrap

    expect(first).toBeTypeOf('object')
    expect(second).toBeTypeOf('object')
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(first).toMatchObject(runtimeAnalysisPlan())
  })

  it('matches the fixed eight-draw bootstrap audit trace for seed 0x5eed1234', () => {
    const fixture = nonDegenerateDirectionalExperiment('eight-draw-audit')
    fixture.analysisPlan = runtimeAnalysisPlan({ iterations: 8 })

    const bootstrap = analysisRuntime(analyzeSetupExperiment(fixture)).bootstrap

    expect(bootstrap).toMatchObject({
      seed: 0x5eed1234,
      iterations: 8,
      totalDraws: 8,
      lapBlockLength: 2,
      minimumIndependentBlocks: 2,
      maxRollbackDriftSec: 0.5,
      degenerate: false,
      draws: expect.arrayContaining([
        expect.objectContaining({
          iteration: 0,
          sampledClusters: ['block-001', 'block-002'],
          effectSec: expect.closeTo(1.2, 8)
        })
      ])
    })
    expect(runtimeRecord(bootstrap).draws).toHaveLength(8)
  })

  it('resamples whole protocol clusters and contiguous two-lap windows instead of IID laps', () => {
    const bootstrap = runtimeRecord(
      analysisRuntime(analyzeSetupExperiment(nonDegenerateDirectionalExperiment('cluster-integrity'))).bootstrap
    )

    expect(Array.isArray(bootstrap.draws)).toBe(true)
    const draws = bootstrap.draws as unknown[]
    expect(bootstrap.totalDraws).toBe(512)
    expect(draws.length).toBe(8)
    for (const drawValue of draws) {
      const draw = runtimeRecord(drawValue)
      expect(Array.isArray(draw.sampledClusters)).toBe(true)
      expect(Array.isArray(draw.windows)).toBe(true)
      expect(draw.flatLapIds).toBeUndefined()
      const sampledClusters = draw.sampledClusters as unknown[]
      const windows = draw.windows as unknown[]
      // Whole-cluster integrity: each sampled cluster occurrence contributes all
      // three declared ABA/BAB run steps, so the window count is exactly
      // (sampled clusters) x (three steps) with no partial clusters.
      expect(sampledClusters.length).toBe(2)
      expect(windows.length).toBe(sampledClusters.length * 3 * Math.ceil(5 / 2))
      const windowRunIds = new Set(
        windows.map((windowValue) => String(runtimeRecord(windowValue).runId))
      )
      for (const clusterValue of sampledClusters) {
        const clusterId = String(clusterValue)
        for (let stepIndex = 0; stepIndex < 3; stepIndex++) {
          expect(windowRunIds.has(`${clusterId}-step-${stepIndex}`)).toBe(true)
        }
      }
      for (const windowValue of windows) {
        const window = runtimeRecord(windowValue)
        // Each within-run block is exactly two contiguous lap IDs addressed by a
        // zero-based start index.
        expect(Number.isInteger(window.startLapIndex)).toBe(true)
        expect(Number(window.startLapIndex)).toBeGreaterThanOrEqual(0)
        expect(window.lapIds).toEqual([
          `${String(window.runId)}-lap-${Number(window.startLapIndex) + 1}`,
          `${String(window.runId)}-lap-${Number(window.startLapIndex) + 2}`
        ])
      }
    }
  })

  it('widens uncertainty for strongly correlated runs relative to the fixed IID-lap oracle', () => {
    const fixture = runtimeExperiment('correlated-runs')
    addProtocolBlock(fixture, {
      blockId: 'block-001',
      sequence: 'ABA',
      values: [
        [96, 96.01, 95.99, 96.02, 95.98],
        [95, 95.01, 94.99, 95.02, 94.98],
        [96.1, 96.11, 96.09, 96.12, 96.08]
      ],
      timestampBase: 40_000
    })
    addProtocolBlock(fixture, {
      blockId: 'block-002',
      sequence: 'BAB',
      values: [
        [104, 104.01, 103.99, 104.02, 103.98],
        [105, 105.01, 104.99, 105.02, 104.98],
        [104.1, 104.11, 104.09, 104.12, 104.08]
      ],
      timestampBase: 50_000
    })
    const iidWidth = iidLapIntervalWidth([
      1, 1, 1, 1, 1, 1.1, 1.1, 1.1, 1.1, 1.1,
      1, 1, 1, 1, 1, 0.9, 0.9, 0.9, 0.9, 0.9
    ])
    const bootstrap = runtimeRecord(analysisRuntime(analyzeSetupExperiment(fixture)).bootstrap)
    const interval = runtimeRecord(bootstrap.interval95Sec)

    expect(Number(interval.high) - Number(interval.low)).toBeGreaterThan(iidWidth)
    expect(iidWidth).toBeGreaterThan(0)
  })

  it('does not read ambient Math.random when analysis has a persisted seed', () => {
    const originalRandom = Math.random
    Math.random = () => {
      throw new Error('ambient Math.random must not be read')
    }
    try {
      const analysis = analyzeSetupExperiment(nonDegenerateDirectionalExperiment('no-ambient-random'))
      const bootstrap = runtimeRecord(analysisRuntime(analysis).bootstrap)
      expect(bootstrap).toMatchObject(runtimeAnalysisPlan())
      expect(bootstrap.totalDraws).toBe(512)
      expect(bootstrap.draws).toHaveLength(8)
      expect(analysis.direction).toBe('variant')
    } finally {
      Math.random = originalRandom
    }
  })

  it('freezes the seeded analysis plan in createSetupExperimentDefinition', () => {
    const plan = runtimeAnalysisPlan()
    const createWithRuntimeContract = createSetupExperimentDefinition as unknown as (
      input: Parameters<typeof createSetupExperimentDefinition>[0] & { analysisPlan: RuntimeAnalysisPlan }
    ) => SetupExperimentDefinition & { analysisPlan: RuntimeAnalysisPlan }
    const created = createWithRuntimeContract({
      id: 'factory-analysis-plan',
      name: 'Factory plan',
      now: 61_000,
      baseline: setup('C:\\setups\\factory-a.sto', 'factory-a.sto'),
      variant: setup('C:\\setups\\factory-b.sto', 'factory-b.sto'),
      diff: singleDiff,
      context: context(),
      analysisPlan: plan
    })
    plan.seed = 1
    plan.iterations = 1
    plan.lapBlockLength = 1
    plan.minimumIndependentBlocks = 1

    const storedPlan = runtimeRecord(runtimeRecord(created).analysisPlan)
    expect(storedPlan).toEqual(runtimeAnalysisPlan())
    expect(storedPlan).not.toBe(plan)
    expect(Object.isFrozen(storedPlan)).toBe(true)
  })
})

describe('setup experiment independent sample and block gates', () => {
  it('abstains at four eligible laps per arm', () => {
    const analysis = analyzeSetupExperiment(completedExperiment(
      'four-lap-boundary',
      [100, 100.1, 99.9, 100.05],
      [99, 99.1, 98.9, 99.05],
      [100.1, 100, 99.95, 100.05]
    ))

    expect(analysis.direction).toBe('abstain')
    expect(analysis.reasons).toEqual(expect.arrayContaining([
      expect.stringMatching(/^insufficient-samples:.*:0$/),
      expect.stringMatching(/^insufficient-samples:.*:1$/),
      expect.stringMatching(/^insufficient-samples:.*:2$/)
    ]))
  })

  it('passes the five-lap boundary but keeps one protocol block exploratory', () => {
    const analysis = analyzeSetupExperiment(oneProtocolBlockExperiment(
      'five-lap-one-block',
      [
        [100.2, 100, 100.1, 99.9, 100.3],
        [98.8, 99, 98.9, 99.1, 98.7],
        [100.1, 99.9, 100, 100.2, 99.8]
      ]
    ))

    expect(analysis.reasons.some((reason) => reason.startsWith('insufficient-samples:'))).toBe(false)
    expect(analysis.reasons).toContain('insufficient-independent-blocks')
    expect(analysisRuntime(analysis).evidenceStrength).toBe('exploratory')
    expect(analysis.direction).toBe('abstain')
  })

  it('abstains when many laps come from fewer than two independent blocks', () => {
    const control = Array.from({ length: 20 }, (_, index) => 100 + ((index % 5) * 0.01))
    const variant = Array.from({ length: 20 }, (_, index) => 99 + ((index % 5) * 0.01))
    const analysis = analyzeSetupExperiment(oneProtocolBlockExperiment(
      'many-laps-one-block',
      [control, variant, control]
    ))

    expect(analysis.arms.A1.usedLaps).toBe(20)
    expect(analysis.arms.B.usedLaps).toBe(20)
    expect(analysis.reasons).toContain('insufficient-independent-blocks')
    expect(analysisRuntime(analysis).evidenceStrength).toBe('exploratory')
    expect(analysis.direction).toBe('abstain')
  })

  it('counts independent blocks after validity and outlier filtering in both sensitivity analyses', () => {
    const experiment = runtimeExperiment('filtered-independent-blocks')
    addProtocolBlock(experiment, {
      blockId: 'block-valid',
      sequence: 'ABA',
      values: [
        [100, 100.1, 99.9, 100.05, 99.95],
        [99, 99.1, 98.9, 99.05, 98.95],
        [100.1, 100, 99.9, 100.05, 99.95]
      ],
      timestampBase: 70_000
    })
    const ineligibleRuns = addProtocolBlock(experiment, {
      blockId: 'block-ineligible',
      sequence: 'BAB',
      values: [
        [99, 99.1, 98.9, 99.05, 98.95],
        [100, 100.1, 99.9, 100.05, 99.95],
        [99.1, 99, 98.9, 99.05, 98.95]
      ],
      timestampBase: 80_000
    })
    ineligibleRuns.forEach((run) => run.laps.forEach((runtimeLap) => {
      runtimeLap.eligible = false
      runtimeLap.exclusionReasons = ['telemetry-unknown']
    }))
    addProtocolBlock(experiment, {
      blockId: 'block-flagged-fifth',
      sequence: 'ABA',
      values: [
        [100, 100, 100, 100, 130],
        [99, 99, 99, 99, 129],
        [100, 100, 100, 100, 130]
      ],
      timestampBase: 90_000
    })

    const analysis = analysisRuntime(analyzeSetupExperiment(experiment))
    const sensitivity = runtimeRecord(analysis.sensitivity)
    expect(sensitivity).toMatchObject({
      allClean: { independentBlocks: 2 },
      excludingFlagged: { independentBlocks: 1 }
    })
    expect(analysis.reasons).toContain('outlier-sensitive')
    expect(analysis.direction).toBe('abstain')
  })
})

describe('setup experiment exploratory and confirmatory blocks', () => {
  it('reports a single non-degenerate ABA block as exploratory rather than confirmatory', () => {
    const analysis = analyzeSetupExperiment(oneProtocolBlockExperiment(
      'single-exploratory-block',
      [
        [100.2, 100, 100.1, 99.9, 100.3],
        [98.8, 99, 98.9, 99.1, 98.7],
        [100.1, 99.9, 100, 100.2, 99.8]
      ]
    ))
    const runtime = analysisRuntime(analysis)

    expect(runtime.exploratoryDirection).toBe('variant')
    expect(runtime.evidenceStrength).toBe('exploratory')
    expect(analysis.direction).toBe('abstain')
    expect(() => assertSetupExperimentDecision(analysis, 'keep-variant')).toThrow(/exploratory|abstain/i)
    expect(() => assertSetupExperimentDecision(analysis, 'keep-baseline')).toThrow(/exploratory|abstain/i)
    expect(Number(analysis.effectSec)).toBeGreaterThan(0)
  })

  it('confirms repeated independent blocks only when robust direction uncertainty and drift all pass', () => {
    const analysis = analyzeSetupExperiment(nonDegenerateDirectionalExperiment('confirmatory-gates'))

    expect(analysisRuntime(analysis).evidenceStrength).toBe('confirmatory')
    expect(analysis.direction).toBe('variant')
    expect(analysis.reasons).toEqual([])
    expect(analysisRuntime(analysis).rollbackRelation).toBe('agreement')
  })

  it('uses explicit ABA and BAB sequence metadata instead of legacy array position', () => {
    const experiment = nonDegenerateDirectionalExperiment('explicit-counterbalance')
    const analysis = analyzeSetupExperiment(experiment)
    const blocks = analysisRuntime(analysis).blocks

    expect(blocks).toEqual([
      { blockId: 'block-001', sequence: 'ABA' },
      { blockId: 'block-002', sequence: 'BAB' }
    ])
    expect(analysisRuntime(analysis).exploratoryDirection).toBe('variant')
    expect(analysis.effectSec).toBeCloseTo(1.2, 1)
  })

  it('abstains when repeated independent blocks disagree on direction', () => {
    const experiment = runtimeExperiment('block-direction-conflict')
    addProtocolBlock(experiment, {
      blockId: 'block-001',
      sequence: 'ABA',
      values: [
        [100.2, 100, 100.1, 99.9, 100.3],
        [98.8, 99, 98.9, 99.1, 98.7],
        [100.1, 99.9, 100, 100.2, 99.8]
      ],
      timestampBase: 100_000
    })
    addProtocolBlock(experiment, {
      blockId: 'block-002',
      sequence: 'BAB',
      values: [
        [101.1, 100.9, 101, 101.2, 100.8],
        [100, 100.2, 99.9, 100.1, 99.8],
        [101, 101.2, 100.9, 101.1, 100.8]
      ],
      timestampBase: 110_000
    })

    const analysis = analyzeSetupExperiment(experiment)

    expect(analysis.direction).toBe('abstain')
    expect(analysis.reasons).toContain('block-direction-conflict')
    expect(analysisRuntime(analysis).evidenceStrength).not.toBe('confirmatory')
  })
})

describe('setup experiment independent environment tolerances', () => {
  it.each(RUNTIME_ENVIRONMENT_CASES)(
    'enforces $label independently at its inclusive boundary epsilon and missing values',
    ({ field, baseline, maxDelta, epsilon }) => {
      const expected = runtimeEnvironment()
      const tolerances = runtimeTolerances()
      const plusBoundary = { ...runtimeEnvironment(), [field]: baseline + maxDelta }
      const minusBoundary = { ...runtimeEnvironment(), [field]: baseline - maxDelta }
      const overBoundary = { ...runtimeEnvironment(), [field]: baseline + maxDelta + epsilon }
      const missingExpected = { ...runtimeEnvironment(), [field]: null }
      const missingActual = { ...runtimeEnvironment(), [field]: null }
      const pairedCase = RUNTIME_ENVIRONMENT_CASES[
        (RUNTIME_ENVIRONMENT_CASES.findIndex((entry) => entry.field === field) + 1) %
        RUNTIME_ENVIRONMENT_CASES.length
      ]
      const widenedTolerance = {
        ...tolerances,
        [field]: maxDelta + 100
      }
      const pairedOverBoundary = {
        ...runtimeEnvironment(),
        [field]: baseline + maxDelta + epsilon,
        [pairedCase.field]: pairedCase.baseline + pairedCase.maxDelta + pairedCase.epsilon
      }

      expect(compareWithRuntimeContract(expected, plusBoundary, tolerances)).toEqual({
        status: 'comparable',
        issues: []
      })
      expect(compareWithRuntimeContract(expected, minusBoundary, tolerances)).toEqual({
        status: 'comparable',
        issues: []
      })
      expect(compareWithRuntimeContract(expected, overBoundary, tolerances)).toMatchObject({
        status: 'incomparable',
        issues: [{ field, kind: 'mismatch' }]
      })
      expect(compareWithRuntimeContract(missingExpected, runtimeEnvironment(), tolerances)).toMatchObject({
        status: 'unknown',
        issues: [{ field, kind: 'unknown' }]
      })
      expect(compareWithRuntimeContract(expected, missingActual, tolerances)).toMatchObject({
        status: 'unknown',
        issues: [{ field, kind: 'unknown' }]
      })
      expect(compareWithRuntimeContract(expected, pairedOverBoundary, widenedTolerance)).toMatchObject({
        status: 'incomparable',
        issues: [{ field: pairedCase.field, kind: 'mismatch' }]
      })
    }
  )

  it.each(RUNTIME_ENVIRONMENT_CASES)(
    'fails closed when the $label tolerance is not predeclared',
    ({ field }) => {
      const tolerances: Partial<RuntimeEnvironmentTolerances> = runtimeTolerances()
      delete tolerances[field]

      expect(compareWithRuntimeContract(
        runtimeEnvironment(),
        runtimeEnvironment(),
        tolerances
      )).toMatchObject({
        status: 'unknown',
        issues: [{ field, kind: 'unknown' }]
      })
    }
  )

  it('copies and freezes all nine environment tolerances before collection starts', () => {
    const tolerances = runtimeTolerances()
    const original = structuredClone(tolerances)
    const createWithRuntimeContract = createSetupExperimentDefinition as unknown as (
      input: Parameters<typeof createSetupExperimentDefinition>[0] & {
        environmentTolerances: RuntimeEnvironmentTolerances
      }
    ) => SetupExperimentDefinition & { environmentTolerances: RuntimeEnvironmentTolerances }
    const created = createWithRuntimeContract({
      id: 'factory-tolerances',
      name: 'Factory tolerances',
      now: 120_000,
      baseline: setup('C:\\setups\\tolerance-a.sto', 'tolerance-a.sto'),
      variant: setup('C:\\setups\\tolerance-b.sto', 'tolerance-b.sto'),
      diff: singleDiff,
      context: context(),
      environmentTolerances: tolerances
    })
    tolerances.trackWetnessPct = 99
    tolerances.trackTempC = 99

    const stored = runtimeRecord(runtimeRecord(created).environmentTolerances)
    expect(stored).toEqual(original)
    expect(Object.keys(stored).sort()).toEqual(Object.keys(original).sort())
    expect(stored).not.toBe(tolerances)
    expect(Object.isFrozen(stored)).toBe(true)
  })

  it('rejects a partially declared environment or rollback-drift plan at definition time', () => {
    const incompleteTolerances = runtimeTolerances() as Partial<RuntimeEnvironmentTolerances>
    delete incompleteTolerances.damagePct
    expect(() => createSetupExperimentDefinition({
      id: 'partial-tolerances',
      name: 'Partial tolerances',
      now: 120_001,
      baseline: setup('C:\\setups\\partial-a.sto', 'partial-a.sto'),
      variant: setup('C:\\setups\\partial-b.sto', 'partial-b.sto'),
      diff: singleDiff,
      context: runtimeEnvironment(),
      environmentTolerances: incompleteTolerances as RuntimeEnvironmentTolerances
    })).toThrow(/every environment tolerance/i)

    const incompletePlan = runtimeAnalysisPlan() as Partial<RuntimeAnalysisPlan>
    delete incompletePlan.maxRollbackDriftSec
    expect(() => createSetupExperimentDefinition({
      id: 'partial-plan',
      name: 'Partial plan',
      now: 120_002,
      baseline: setup('C:\\setups\\plan-a.sto', 'plan-a.sto'),
      variant: setup('C:\\setups\\plan-b.sto', 'plan-b.sto'),
      diff: singleDiff,
      context: runtimeEnvironment(),
      analysisPlan: incompletePlan as RuntimeAnalysisPlan
    })).toThrow(/rollback-drift plan/i)
  })
})

describe('setup experiment flagged-outlier sensitivity', () => {
  it('abstains when excluding flagged laps favors the variant but all clean laps favor the baseline', () => {
    const analysis = analyzeSetupExperiment(runtimeSensitivityExperiment())

    expect(analysis.direction).toBe('abstain')
    expect(analysis.reasons).toContain('outlier-sensitive')
    expect(analysisRuntime(analysis).evidenceStrength).not.toBe('confirmatory')
  })

  it('reports both sensitivity results and the exact flagged lap IDs', () => {
    const sensitivity = runtimeRecord(
      analysisRuntime(analyzeSetupExperiment(runtimeSensitivityExperiment('sensitivity-audit'))).sensitivity
    )

    expect(sensitivity).toMatchObject({
      excludingFlagged: {
        medians: { B: 98.5 },
        direction: 'variant'
      },
      allClean: {
        medians: { B: 100.25 },
        direction: 'baseline'
      },
      flaggedLapIds: ['B-10']
    })
  })

  it('does not mutate runs lap order eligibility or IDs while analyzing sensitivity', () => {
    const experiment = runtimeSensitivityExperiment('sensitivity-immutability')
    const before = structuredClone(experiment.runs)

    analyzeSetupExperiment(experiment)
    analyzeSetupExperiment(experiment)

    expect(experiment.runs).toEqual(before)
    expect(experiment.runs.flatMap((run) => run.laps.map((runtimeLap) => runtimeLap.id))).toEqual(
      before.flatMap((run) => run.laps.map((runtimeLap) => runtimeLap.id))
    )
  })

  it('does not count an outlier-sensitive result as confirmatory portfolio evidence', () => {
    const experiment = runtimeSensitivityExperiment('sensitivity-portfolio')
    const analysis = analysisRuntime(analyzeSetupExperiment(experiment))
    const metrics = runtimeRecord(setupExperimentPortfolioMetrics([experiment]))

    expect(analysis.sensitivity).toBeTypeOf('object')
    expect(runtimeRecord(analysis.sensitivity).flaggedLapIds).toEqual(['B-10'])
    expect(metrics.confirmatoryDirections).toBe(0)
    expect(metrics.rollbackConfirmedDirections).toBe(0)
  })
})

describe('setup experiment deterministic repeat steps', () => {
  it('returns the first explicit step of a deterministic next block after a completed block', () => {
    const experiment = runtimeExperiment('next-repeat-block')
    experiment.protocolPlan = [
      { blockId: 'block-001', sequence: 'ABA' },
      { blockId: 'block-002', sequence: 'BAB' }
    ]
    addProtocolBlock(experiment, {
      blockId: 'block-001',
      sequence: 'ABA',
      values: [
        [100, 100.1, 99.9, 100.05, 99.95],
        [99, 99.1, 98.9, 99.05, 98.95],
        [100.1, 100, 99.9, 100.05, 99.95]
      ],
      timestampBase: 130_000
    })
    expect(nextSetupExperimentStep(experiment)).toEqual({
      blockId: 'block-002',
      sequence: 'BAB',
      stepIndex: 0,
      treatment: 'B',
      arm: 'B'
    })
  })

  it('rejects a reopen step that violates the declared block sequence', () => {
    const experiment = runtimeExperiment('invalid-repeat-order')
    experiment.protocolPlan = [
      { blockId: 'block-001', sequence: 'ABA' },
      { blockId: 'block-002', sequence: 'BAB' }
    ]
    addProtocolBlock(experiment, {
      blockId: 'block-001',
      sequence: 'ABA',
      values: [
        [100, 100.1, 99.9, 100.05, 99.95],
        [99, 99.1, 98.9, 99.05, 98.95],
        [100.1, 100, 99.9, 100.05, 99.95]
      ],
      timestampBase: 140_000
    })
    const before = structuredClone(experiment.runs)
    const assertRuntimeOrder = assertSetupExperimentArmOrder as unknown as (
      value: SetupExperimentDefinition,
      step: RuntimeProtocolStep
    ) => void

    expect(() => assertRuntimeOrder(experiment, {
      blockId: 'block-002',
      sequence: 'BAB',
      stepIndex: 1,
      treatment: 'A'
    })).toThrow(/sequence|order/i)
    expect(experiment.runs).toEqual(before)
  })
})

describe('setup experiment rollback semantics and gated metrics', () => {
  it('calls genuine opposite-sign rollback evidence conflict rather than confirmation', () => {
    const experiment = completedExperiment(
      'rollback-opposite-sign',
      [100, 100.1, 99.9, 100.05, 100],
      [99, 99.1, 98.9, 99.05, 99],
      [98, 98.1, 97.9, 98.05, 98]
    )
    Object.assign(experiment, { analysisPlan: runtimeAnalysisPlan() })
    const analysis = analyzeSetupExperiment(experiment)
    const metrics = runtimeRecord(setupExperimentPortfolioMetrics([experiment]))

    expect(analysisRuntime(analysis).rollbackRelation).toBe('conflict')
    expect(analysis.reasons).toContain('rollback-conflict')
    expect(metrics.rollbackConflictSignals).toBe(1)
    expect(metrics.rollbackConfirmedDirections).toBe(0)
  })

  it('does not count rollback sign agreement when the drift gate fails', () => {
    const experiment = completedExperiment(
      'rollback-drift-gated',
      [100, 100, 100, 100, 100],
      [99.9, 99.9, 99.9, 99.9, 99.9],
      [102, 102, 102, 102, 102]
    )
    Object.assign(experiment, { analysisPlan: runtimeAnalysisPlan() })
    const analysis = analyzeSetupExperiment(experiment)
    const metrics = runtimeRecord(setupExperimentPortfolioMetrics([experiment]))

    expect(analysis.reasons).toContain('rollback-drift')
    expect(metrics.rollbackAgreementSignals).toBe(0)
    expect(metrics.rollbackConfirmedDirections).toBe(0)
    expect(metrics.confirmatoryDirections).toBe(0)
  })

  it('does not count rollback sign agreement when uncertainty crosses zero', () => {
    const experiment = completedExperiment(
      'rollback-uncertainty-gated',
      [97, 99, 101, 103, 105],
      [100, 100, 100, 100, 100],
      [97, 99, 101, 103, 105]
    )
    Object.assign(experiment, { analysisPlan: runtimeAnalysisPlan() })
    const analysis = analyzeSetupExperiment(experiment)
    const metrics = runtimeRecord(setupExperimentPortfolioMetrics([experiment]))

    expect(analysis.reasons).toContain('uncertainty-crosses-zero')
    expect(metrics.rollbackAgreementSignals).toBe(0)
    expect(metrics.rollbackConfirmedDirections).toBe(0)
    expect(metrics.confirmatoryDirections).toBe(0)
  })

  it('reserves confirmation for repeated robust uncertainty-and-drift-gated evidence', () => {
    const experiment = nonDegenerateDirectionalExperiment('robust-confirmation')
    const analysis = analyzeSetupExperiment(experiment)
    const metrics = runtimeRecord(setupExperimentPortfolioMetrics([experiment]))

    expect(analysisRuntime(analysis).rollbackRelation).toBe('agreement')
    expect(analysisRuntime(analysis).evidenceStrength).toBe('confirmatory')
    expect(metrics.rollbackAgreementSignals).toBe(1)
    expect(metrics.rollbackConfirmedDirections).toBe(1)
    expect(metrics.confirmatoryDirections).toBe(1)
  })
})
