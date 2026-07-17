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
  oneVariableFromSetupDiff,
  recoverSetupExperimentStateAfterRestart,
  setupExperimentConditionFromTelemetry,
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
    airTempC: 22
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
  it('removes deterministic lap-time outliers without allowing them to reverse direction', () => {
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
    expect(analysis.direction).toBe('variant')
    expect(analysis.arms.A1.outliers).toBe(1)
    expect(analysis.arms.B.outliers).toBe(1)
    expect(analysis.arms.A2.outliers).toBe(1)
    expect(analysis.confidence95Sec?.low).toBeGreaterThan(0)
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
    expect(analysis.reasons).toContain('insufficient-samples:A1')
    expect(analysis.reasons).toContain('insufficient-samples:B')
    expect(analysis.reasons).toContain('insufficient-samples:A2')
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
    expect(analysis.reasons).toContain('rollback-direction-conflict')
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
    expect(analysis.direction).toBe('variant')
    expect(() => assertSetupExperimentDecision(analysis, 'keep-baseline')).toThrow(/false-direction/i)
    expect(() => assertSetupExperimentDecision(analysis, 'keep-variant')).not.toThrow()
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

  it('uses the zero-MAD fallback and requires five post-filter samples', () => {
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
    expect(analysis.eligible).toBe(false)
    expect(analysis.direction).toBe('abstain')
    expect(analysis.reasons).toEqual(['insufficient-samples:B'])
    expect(analysis.arms.B).toMatchObject({
      cleanKnownLaps: 5,
      usedLaps: 4,
      outliers: 1
    })
    expect(analysis.effectSec).toBeNull()
    expect(analysis.confidence95Sec).toBeNull()
    expect(analysis.falseDirectionProtected).toBe(false)
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
    expect(analysis.reasons).toEqual(['rollback-drift'])
    expect(analysis.falseDirectionProtected).toBe(true)
    expect(analysis.effectSec).toBeCloseTo(1.1)
    expect(analysis.firstContrastSec).toBeCloseTo(0.1)
    expect(analysis.rollbackContrastSec).toBeCloseTo(2.1)
    expect(analysis.rollbackDriftSec).toBeCloseTo(2)
    expect(() => assertSetupExperimentDecision(analysis, 'keep-variant')).toThrow(/must abstain/i)
    expect(() => assertSetupExperimentDecision(analysis, 'keep-baseline')).toThrow(/must abstain/i)
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
    expect(analysis.direction).toBe('baseline')
    expect(analysis.effectSec).toBeCloseTo(-1)
    expect(analysis.falseDirectionProtected).toBe(false)
    expect(() => assertSetupExperimentDecision(analysis, 'keep-variant')).toThrow(/false-direction/i)
    expect(() => assertSetupExperimentDecision(analysis, 'keep-baseline')).not.toThrow()
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
