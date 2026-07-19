import { describe, expect, it } from 'vitest'
import type { SetupLibraryItem, SetupCompareResult } from '../../shared/setup-manager'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import {
  emptySetupExperimentState,
  nextSetupExperimentArm,
  type SetupExperimentStoredState
} from '../../shared/setup-experiment'
import {
  SetupExperimentService,
  type SetupExperimentPersistence
} from './setup-experiment'

class MemoryPersistence implements SetupExperimentPersistence {
  state: SetupExperimentStoredState = emptySetupExperimentState()

  async load(): Promise<SetupExperimentStoredState> {
    return clone(this.state)
  }

  async save(state: SetupExperimentStoredState): Promise<void> {
    this.state = clone(state)
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function setup(path: string, fileName: string): SetupLibraryItem {
  return {
    id: path,
    path,
    fileName,
    relativePath: `ferrari488gt3\\${fileName}`,
    carFolder: 'ferrari488gt3',
    sizeBytes: 100,
    modifiedAt: 1,
    metadata: { car: 'Ferrari 488 GT3', track: 'Spa', notes: '', tags: [], rating: 0, updatedAt: 0 }
  }
}

function comparison(): SetupCompareResult {
  return {
    left: setup('C:\\setups\\baseline.sto', 'baseline.sto'),
    right: setup('C:\\setups\\variant.sto', 'variant.sto'),
    diff: {
      totalChanges: 1,
      sections: [{
        section: 'Aero',
        added: [],
        removed: [],
        changed: [{ key: 'Rear Wing', kind: 'changed', before: '8', after: '7' }]
      }]
    }
  }
}

function telemetry(overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1000,
    speedKmh: 120,
    rpm: 6000,
    gear: 4,
    throttle: 0.8,
    brake: 0,
    clutch: 0,
    carName: 'Ferrari 488 GT3',
    carPath: 'ferrari488gt3',
    trackName: 'Spa',
    trackConfigName: 'Grand Prix',
    trackWetnessPct: 0,
    trackTempC: 30,
    airTempC: 20,
    gripPct: 0.8,
    isRaining: false,
    weatherDeclaredWet: false,
    fuelLiters: 60,
    fuelMassKg: 45,
    tyreStatePct: 0.8,
    trafficDensity: 0.3,
    flagStateIndex: 0,
    damagePct: 0,
    repairTimeSec: 0,
    optionalRepairTimeSec: 0,
    onTrack: true,
    onPitRoad: false,
    pitStopActive: false,
    pit: { inPitStall: false, repairNeeded: false, optRepairNeeded: false, pitsOpen: true },
    refuelServiceActive: false,
    pitServiceFlags: [],
    pitFuelToAddL: 0,
    lapValidity: 'valid',
    towReset: false,
    sessionType: 'Practice',
    sessionUniqueId: 42,
    currentLap: 1,
    lapDistPct: 0.5,
    ...overrides
  }
}

function harness(options: {
  persistence?: MemoryPersistence
  current?: TelemetrySnapshot
  startNow?: number
} = {}) {
  const persistence = options.persistence ?? new MemoryPersistence()
  let current = options.current ?? telemetry()
  let now = options.startNow ?? 10_000
  let id = 0
  const service = new SetupExperimentService({
    persistence,
    compare: async () => comparison(),
    getTelemetry: () => current,
    broadcast: () => {},
    now: () => now++,
    id: () => `id-${++id}`
  })
  return {
    persistence,
    service,
    getTelemetry: () => current,
    setTelemetry(next: TelemetrySnapshot): void {
      current = next
    }
  }
}

async function createExperiment(service: SetupExperimentService): Promise<string> {
  const snapshot = await service.create({
    name: 'Rear wing test',
    baselinePath: 'C:\\setups\\baseline.sto',
    variantPath: 'C:\\setups\\variant.sto'
  })
  return snapshot.state.experiments[0].id
}

async function captureFiveEligibleLaps(
  target: ReturnType<typeof harness>,
  times: readonly number[] = [100.2, 100, 100.1, 99.9, 100.3]
): Promise<void> {
  for (const time of times) {
    const currentLap = target.getTelemetry().currentLap ?? 1
    const fuel = target.getTelemetry().fuelLiters ?? 60
    const mid = telemetry({
      currentLap,
      lapDistPct: 0.5,
      fuelLiters: fuel - 0.5,
      incidentCountMy: 0
    })
    target.setTelemetry(mid)
    target.service.onSnapshot(mid)
    const crossing = telemetry({
      currentLap: currentLap + 1,
      lapDistPct: 0.02,
      lastLapTimeSec: time,
      fuelLiters: fuel - 1,
      incidentCountMy: 0
    })
    target.setTelemetry(crossing)
    target.service.onSnapshot(crossing)
    await target.service.snapshot()
  }
}

describe('SetupExperimentService', () => {
  it('rejects out-of-order arms and requires the baseline for rollback A2', async () => {
    const target = harness()
    const { service } = target
    const experimentId = await createExperiment(service)

    await expect(service.startArm({
      experimentId,
      arm: 'B',
      confirmedSetupPath: 'C:\\setups\\variant.sto'
    })).rejects.toThrow(/expected A1/i)

    target.setTelemetry(telemetry({ currentLap: 1, lapDistPct: 0.02, incidentCountMy: 0 }))
    await service.startArm({
      experimentId,
      arm: 'A1',
      confirmedSetupPath: 'C:\\setups\\baseline.sto'
    })
    await captureFiveEligibleLaps(target)
    await service.finishArm({ experimentId })
    await service.startArm({
      experimentId,
      arm: 'B',
      confirmedSetupPath: 'C:\\setups\\variant.sto'
    })
    await captureFiveEligibleLaps(target, [99.2, 99, 99.1, 98.9, 99.3])
    await service.finishArm({ experimentId })

    await expect(service.startArm({
      experimentId,
      arm: 'A2',
      confirmedSetupPath: 'C:\\setups\\variant.sto'
    })).rejects.toThrow(/baseline setup/i)
    await expect(service.startArm({
      experimentId,
      arm: 'A2',
      confirmedSetupPath: 'C:\\setups\\baseline.sto'
    })).resolves.toBeDefined()
  })

  it('excludes a partial opening lap and keeps missing incidents unknown', async () => {
    const harnessState = harness()
    const { service, setTelemetry } = harnessState
    const experimentId = await createExperiment(service)
    await service.startArm({
      experimentId,
      arm: 'A1',
      confirmedSetupPath: 'C:\\setups\\baseline.sto'
    })

    setTelemetry(telemetry({ currentLap: 1, lapDistPct: 0.95 }))
    service.onSnapshot(telemetry({ currentLap: 1, lapDistPct: 0.95 }))
    setTelemetry(telemetry({
      currentLap: 2,
      lapDistPct: 0.02,
      lastLapTimeSec: 100,
      incidentCountMy: 0
    }))
    service.onSnapshot(telemetry({
      currentLap: 2,
      lapDistPct: 0.02,
      lastLapTimeSec: 100,
      incidentCountMy: 0
    }))
    service.onSnapshot(telemetry({ currentLap: 2, lapDistPct: 0.95, incidentCountMy: 0 }))
    setTelemetry(telemetry({
      currentLap: 3,
      lapDistPct: 0.02,
      lastLapTimeSec: 99.5,
      incidentCountMy: 0
    }))
    service.onSnapshot(telemetry({
      currentLap: 3,
      lapDistPct: 0.02,
      lastLapTimeSec: 99.5,
      incidentCountMy: 0
    }))

    const snapshot = await service.snapshot()
    const laps = snapshot.state.experiments[0].runs[0].laps
    expect(laps).toHaveLength(2)
    expect(laps[0]).toMatchObject({
      completion: 'partial',
      incidentState: 'unknown',
      eligible: false
    })
    expect(laps[0].exclusionReasons).toContain('partial-lap')
    expect(laps[0].exclusionReasons).toContain('incidents-unknown')
    expect(laps[1]).toMatchObject({
      completion: 'complete',
      incidentState: 'clean',
      telemetryState: 'known',
      eligible: true
    })
  })

  it('rejects a dry run as soon as telemetry becomes wet', async () => {
    const { service, setTelemetry } = harness()
    const experimentId = await createExperiment(service)
    await service.startArm({
      experimentId,
      arm: 'A1',
      confirmedSetupPath: 'C:\\setups\\baseline.sto'
    })

    const wet = telemetry({
      trackWetnessPct: 0.4,
      isRaining: true,
      weatherDeclaredWet: true
    })
    setTelemetry(wet)
    service.onSnapshot(wet)

    const snapshot = await service.snapshot()
    const experiment = snapshot.state.experiments[0]
    expect(snapshot.activeCapture).toBeNull()
    expect(experiment.runs[0].status).toBe('rejected')
    expect(experiment.runs[0].rejectionReasons[0]).toMatch(/context-incomparable:condition/)
    expect(nextSetupExperimentArm(experiment)).toBe('A1')
  })

  it('recovers a recording run as interrupted after restart and allows the same arm to restart', async () => {
    const first = harness()
    const experimentId = await createExperiment(first.service)
    await first.service.startArm({
      experimentId,
      arm: 'A1',
      confirmedSetupPath: 'C:\\setups\\baseline.sto'
    })

    const restarted = harness({ persistence: first.persistence, startNow: 20_000 })
    const recovered = await restarted.service.snapshot()
    const experiment = recovered.state.experiments[0]
    expect(experiment.runs[0]).toMatchObject({
      arm: 'A1',
      status: 'interrupted',
      rejectionReasons: ['app-restart']
    })
    expect(restarted.persistence.state.experiments[0].runs[0].status).toBe('interrupted')
    expect(recovered.activeCapture).toBeNull()
    expect(nextSetupExperimentArm(experiment)).toBe('A1')

    const next = await restarted.service.startArm({
      experimentId,
      arm: 'A1',
      confirmedSetupPath: 'C:\\setups\\baseline.sto'
    })
    expect(next.activeCapture?.arm).toBe('A1')
    expect(next.state.experiments[0].runs).toHaveLength(2)
    expect(next.state.experiments[0].runs[1].status).toBe('recording')
  })

  it('rejects creation when the setup comparison contains multiple variables', async () => {
    const persistence = new MemoryPersistence()
    const service = new SetupExperimentService({
      persistence,
      compare: async () => ({
        ...comparison(),
        diff: {
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
        }
      }),
      getTelemetry: () => telemetry(),
      broadcast: () => {},
      now: () => 10_000,
      id: () => 'experiment'
    })

    await expect(service.create({
      name: 'Invalid',
      baselinePath: 'C:\\setups\\baseline.sto',
      variantPath: 'C:\\setups\\variant.sto'
    })).rejects.toThrow(/exactly one variable/i)
    expect((await service.snapshot()).state.experiments).toHaveLength(0)
  })

  it('keeps complete laps with missing incident or lap-time evidence unknown and ineligible', async () => {
    const initialTelemetry = telemetry({ currentLap: 1, lapDistPct: 0.03 })
    const { service, setTelemetry } = harness({ current: initialTelemetry })
    const experimentId = await createExperiment(service)
    await service.startArm({
      experimentId,
      arm: 'A1',
      confirmedSetupPath: 'C:\\setups\\baseline.sto'
    })

    const incidentUnknown = telemetry({
      currentLap: 2,
      lapDistPct: 0.02,
      lastLapTimeSec: 100,
      incidentCountMy: 0
    })
    setTelemetry(incidentUnknown)
    service.onSnapshot(incidentUnknown)

    const lapTimeUnknown = telemetry({
      currentLap: 3,
      lapDistPct: 0.02,
      incidentCountMy: 0
    })
    setTelemetry(lapTimeUnknown)
    service.onSnapshot(lapTimeUnknown)

    const nonPositiveLapTime = telemetry({
      currentLap: 4,
      lapDistPct: 0.02,
      lastLapTimeSec: 0,
      incidentCountMy: 0
    })
    setTelemetry(nonPositiveLapTime)
    service.onSnapshot(nonPositiveLapTime)

    const snapshot = await service.snapshot()
    const laps = snapshot.state.experiments[0].runs[0].laps
    expect(laps).toHaveLength(3)
    expect(laps[0]).toMatchObject({
      lapNumber: 2,
      completion: 'complete',
      lapTimeSec: 100,
      telemetryState: 'known',
      incidentDelta: null,
      incidentState: 'unknown',
      eligible: false,
      comparability: { status: 'comparable' }
    })
    expect(laps[0].exclusionReasons).toEqual(['incidents-unknown'])
    expect(laps[1]).toMatchObject({
      lapNumber: 3,
      completion: 'complete',
      lapTimeSec: null,
      telemetryState: 'unknown',
      incidentDelta: 0,
      incidentState: 'clean',
      eligible: false,
      comparability: { status: 'comparable' }
    })
    expect(laps[1].exclusionReasons).toEqual(['lap-time-unknown'])
    expect(laps[2]).toMatchObject({
      lapNumber: 4,
      completion: 'complete',
      lapTimeSec: null,
      telemetryState: 'unknown',
      incidentDelta: 0,
      incidentState: 'clean',
      eligible: false,
      comparability: { status: 'comparable' }
    })
    expect(laps[2].exclusionReasons).toEqual(['lap-time-unknown'])
  })

  it('creates, starts and exports a local manual experiment without automatic setup application', async () => {
    const { service } = harness()
    const created = await service.create({
      name: 'Rear wing test',
      baselinePath: 'C:\\setups\\baseline.sto',
      variantPath: 'C:\\setups\\variant.sto'
    })
    const experiment = created.state.experiments[0]
    expect(experiment.localOnly).toBe(true)
    expect(experiment.setupApplication).toBe('manual')
    expect(experiment.baselineSetup.path).toBe('C:\\setups\\baseline.sto')
    expect(experiment.variantSetup.path).toBe('C:\\setups\\variant.sto')
    expect(experiment.runs).toEqual([])

    const started = await service.startArm({
      experimentId: experiment.id,
      arm: 'A1',
      confirmedSetupPath: 'C:\\setups\\baseline.sto'
    })
    const run = started.state.experiments[0].runs[0]
    expect(started.activeCapture).toMatchObject({
      experimentId: experiment.id,
      runId: run.id,
      arm: 'A1'
    })
    expect(run.status).toBe('recording')
    expect(run.setupPath).toBe('C:\\setups\\baseline.sto')

    const exported = await service.exportBundle(experiment.id)
    expect(exported.schema).toBe('ultimate-sim-app.setup-experiment')
    expect(exported.schemaVersion).toBe(1)
    expect(exported.experiment.localOnly).toBe(true)
    expect(exported.experiment.setupApplication).toBe('manual')
    expect(exported.experiment.baselineSetup.path).toBe('C:\\setups\\baseline.sto')
    expect(exported.experiment.variantSetup.path).toBe('C:\\setups\\variant.sto')
    expect(exported.disclaimer).toMatch(/local exploratory or confirmatory decision-support evidence/i)
    expect(exported.disclaimer).toMatch(/no setup is applied automatically/i)
  })

  it('rejects a run when either frozen setup file changes after definition', async () => {
    const persistence = new MemoryPersistence()
    let modifiedAt = 1
    const service = new SetupExperimentService({
      persistence,
      compare: async () => {
        const result = comparison()
        result.right.modifiedAt = modifiedAt
        return result
      },
      getTelemetry: () => telemetry(),
      broadcast: () => {},
      now: () => 10_000,
      id: () => 'experiment'
    })
    const experimentId = await createExperiment(service)
    modifiedAt = 2

    await expect(service.startArm({
      experimentId,
      arm: 'A1',
      confirmedSetupPath: 'C:\\setups\\baseline.sto'
    })).rejects.toThrow(/changed after.*defined/i)
    expect((await service.snapshot()).state.experiments[0].runs).toEqual([])
  })
})

type Phase2Record = Record<string, unknown>
type Phase2Snapshot = Awaited<ReturnType<SetupExperimentService['snapshot']>>
type Phase2Arm = 'A1' | 'B' | 'A2'
type Phase2Sequence = 'ABA' | 'BAB'
type Phase2Treatment = 'A' | 'B'
type Phase2EnvironmentField =
  | 'trackWetnessPct'
  | 'trackTempC'
  | 'airTempC'
  | 'fuelMassKg'
  | 'tyreStatePct'
  | 'trafficDensity'
  | 'flagStateIndex'
  | 'damagePct'
  | 'gripPct'

type Phase2Environment = Record<Phase2EnvironmentField, number>
type Phase2RuntimeCreateInput = Parameters<SetupExperimentService['create']>[0] & {
  analysisPlan: {
    seed: number
    iterations: number
    lapBlockLength: number
    minimumIndependentBlocks: number
  }
  environmentTolerances: Phase2Environment
  protocolPlan?: Array<{ blockId: string; sequence: Phase2Sequence }>
}
type Phase2RuntimeStartInput = Parameters<SetupExperimentService['startArm']>[0] & {
  blockId: string
  sequence: Phase2Sequence
  stepIndex: number
  treatment: Phase2Treatment
}

const PHASE2_ENVIRONMENT: Phase2Environment = {
  trackWetnessPct: 0,
  trackTempC: 30,
  airTempC: 20,
  fuelMassKg: 45,
  tyreStatePct: 0.8,
  trafficDensity: 0.3,
  flagStateIndex: 0,
  damagePct: 0,
  gripPct: 0.8
}

const PHASE2_TOLERANCES: Phase2Environment = {
  trackWetnessPct: 0.01,
  trackTempC: 2,
  airTempC: 1.5,
  fuelMassKg: 1,
  tyreStatePct: 0.02,
  trafficDensity: 0.05,
  flagStateIndex: 0,
  damagePct: 0.005,
  gripPct: 0.02
}

const PHASE2_ENVIRONMENT_FIELDS = Object.keys(PHASE2_ENVIRONMENT) as Phase2EnvironmentField[]
const PHASE2_ANALYSIS_PLAN = {
  seed: 0x5eed1234,
  iterations: 512,
  lapBlockLength: 2,
  minimumIndependentBlocks: 2,
  maxRollbackDriftSec: 0.5
}

function phase2Record(value: unknown): Phase2Record {
  return typeof value === 'object' && value !== null ? value as Phase2Record : {}
}

function phase2Revision(value: unknown): unknown {
  return phase2Record(phase2Record(value).state).revision
}

function knownValidTelemetry(overrides: Phase2Record = {}): TelemetrySnapshot {
  return Object.assign(telemetry({
    currentLap: 1,
    lapDistPct: 0.02,
    lastLapTimeSec: 100,
    incidentCountMy: 0,
    onTrack: true,
    onPitRoad: false,
    pitStopActive: false,
    pitServiceFlags: [],
    pitFuelToAddL: 0,
    fuelLiters: 40,
    trackWetnessPct: PHASE2_ENVIRONMENT.trackWetnessPct,
    trackTempC: PHASE2_ENVIRONMENT.trackTempC,
    airTempC: PHASE2_ENVIRONMENT.airTempC,
    gripPct: PHASE2_ENVIRONMENT.gripPct
  }), {
    pit: { inPitStall: false },
    refuelServiceActive: false,
    lapValidity: 'valid',
    towReset: false,
    fuelMassKg: PHASE2_ENVIRONMENT.fuelMassKg,
    tyreStatePct: PHASE2_ENVIRONMENT.tyreStatePct,
    trafficDensity: PHASE2_ENVIRONMENT.trafficDensity,
    flagStateIndex: PHASE2_ENVIRONMENT.flagStateIndex,
    damagePct: PHASE2_ENVIRONMENT.damagePct
  }, overrides) as unknown as TelemetrySnapshot
}

function productionIRacingTyreTelemetry(
  wearPct: readonly [number, number, number, number],
  overrides: Phase2Record = {}
): TelemetrySnapshot {
  const [lf, rf, lr, rr] = wearPct
  const snapshot = knownValidTelemetry({
    ...overrides,
    tyres: {
      lf: { wearPct: lf, wearLeftPct: lf, wearMiddlePct: lf, wearRightPct: lf },
      rf: { wearPct: rf, wearLeftPct: rf, wearMiddlePct: rf, wearRightPct: rf },
      lr: { wearPct: lr, wearLeftPct: lr, wearMiddlePct: lr, wearRightPct: lr },
      rr: { wearPct: rr, wearLeftPct: rr, wearMiddlePct: rr, wearRightPct: rr }
    }
  })
  delete snapshot.tyreStatePct
  return snapshot
}

function phase2CreateInput(
  name: string,
  tolerances: Phase2Environment = clone(PHASE2_TOLERANCES)
): Phase2RuntimeCreateInput {
  return {
    name,
    baselinePath: 'C:\\setups\\baseline.sto',
    variantPath: 'C:\\setups\\variant.sto',
    analysisPlan: clone(PHASE2_ANALYSIS_PLAN),
    environmentTolerances: tolerances,
    protocolPlan: [{ blockId: 'block-001', sequence: 'ABA' }]
  }
}

function phase2StartInput(
  experimentId: string,
  arm: Phase2Arm,
  metadata: Partial<Omit<Phase2RuntimeStartInput, 'experimentId' | 'arm' | 'confirmedSetupPath'>> = {}
): Phase2RuntimeStartInput {
  const treatment: Phase2Treatment = arm === 'B' ? 'B' : 'A'
  return {
    experimentId,
    arm,
    confirmedSetupPath: treatment === 'B'
      ? 'C:\\setups\\variant.sto'
      : 'C:\\setups\\baseline.sto',
    blockId: 'block-001',
    sequence: 'ABA',
    stepIndex: arm === 'A1' ? 0 : arm === 'B' ? 1 : 2,
    treatment,
    ...metadata
  }
}

function phase2Harness(options: {
  persistence?: SetupExperimentPersistence
  current?: TelemetrySnapshot
  clock?: readonly number[]
  idPrefix?: string
} = {}) {
  const persistence = options.persistence ?? new MemoryPersistence()
  let current = options.current ?? knownValidTelemetry()
  let clockIndex = 0
  let fallbackNow = 30_000
  let id = 0
  const broadcasts: Phase2Snapshot[] = []
  const service = new SetupExperimentService({
    persistence,
    compare: async () => comparison(),
    getTelemetry: () => current,
    broadcast: (snapshot) => broadcasts.push(clone(snapshot)),
    now: () => options.clock?.[Math.min(clockIndex++, options.clock.length - 1)] ?? fallbackNow++,
    id: () => `${options.idPrefix ?? 'phase2'}-${++id}`
  })
  return {
    persistence,
    service,
    broadcasts,
    getTelemetry: () => current,
    setTelemetry(next: TelemetrySnapshot): void {
      current = next
    }
  }
}

async function phase2CreateExperiment(
  target: ReturnType<typeof phase2Harness>,
  name = 'Phase 2 setup experiment',
  tolerances: Phase2Environment = clone(PHASE2_TOLERANCES)
): Promise<string> {
  const snapshot = await target.service.create(phase2CreateInput(name, tolerances))
  return snapshot.state.experiments[0].id
}

async function emitCompleteLap(
  target: ReturnType<typeof phase2Harness>,
  lapTimeSec: number,
  midLapOverrides: Phase2Record = {},
  crossingOverrides: Phase2Record = {}
): Promise<Phase2Snapshot> {
  const currentLap = target.getTelemetry().currentLap ?? 1
  const currentFuel = target.getTelemetry().fuelLiters ?? 40
  const midLap = knownValidTelemetry({
    currentLap,
    lapDistPct: 0.5,
    fuelLiters: currentFuel - 0.5,
    ...midLapOverrides
  })
  target.setTelemetry(midLap)
  target.service.onSnapshot(midLap)
  const crossing = knownValidTelemetry({
    currentLap: currentLap + 1,
    lapDistPct: 0.02,
    lastLapTimeSec: lapTimeSec,
    fuelLiters: currentFuel - 1,
    ...crossingOverrides
  })
  target.setTelemetry(crossing)
  target.service.onSnapshot(crossing)
  return target.service.snapshot()
}

async function captureEligibleLaps(
  target: ReturnType<typeof phase2Harness>,
  times: readonly number[]
): Promise<Phase2Snapshot> {
  let snapshot = await target.service.snapshot()
  for (const time of times) snapshot = await emitCompleteLap(target, time)
  return snapshot
}

async function phase2CompleteArm(
  target: ReturnType<typeof phase2Harness>,
  experimentId: string,
  arm: Phase2Arm,
  metadata: Partial<Omit<Phase2RuntimeStartInput, 'experimentId' | 'arm' | 'confirmedSetupPath'>> = {}
): Promise<Phase2Snapshot> {
  await target.service.startArm(phase2StartInput(experimentId, arm, metadata))
  await captureEligibleLaps(target, [100.2, 100, 100.1, 99.9, 100.3])
  return target.service.finishArm({ experimentId })
}

async function phase2CompleteLegacyBlock(
  target: ReturnType<typeof phase2Harness>,
  experimentId: string
): Promise<void> {
  await phase2CompleteArm(target, experimentId, 'A1')
  await phase2CompleteArm(target, experimentId, 'B')
  await phase2CompleteArm(target, experimentId, 'A2')
}

async function phase2Settle<T>(promise: Promise<T>): Promise<
  { status: 'fulfilled'; value: T } |
  { status: 'rejected'; reason: unknown }
> {
  try {
    return { status: 'fulfilled', value: await promise }
  } catch (reason) {
    return { status: 'rejected', reason }
  }
}

function phase2ErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function phase2Deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

class Phase2DeferredPersistence implements SetupExperimentPersistence {
  state: SetupExperimentStoredState = emptySetupExperimentState()
  readonly attemptedStates: SetupExperimentStoredState[] = []
  private readonly controls: Array<ReturnType<typeof phase2Deferred<void>>> = []
  private readonly callWaiters = new Map<number, ReturnType<typeof phase2Deferred<void>>>()

  async load(): Promise<SetupExperimentStoredState> {
    return clone(this.state)
  }

  save(state: SetupExperimentStoredState): Promise<void> {
    const control = phase2Deferred<void>()
    const callNumber = this.controls.push(control)
    this.attemptedStates.push(clone(state))
    this.callWaiters.get(callNumber)?.resolve()
    return control.promise.then(() => {
      this.state = clone(state)
    })
  }

  waitForSave(callNumber: number): Promise<void> {
    if (this.controls.length >= callNumber) return Promise.resolve()
    const waiter = this.callWaiters.get(callNumber) ?? phase2Deferred<void>()
    this.callWaiters.set(callNumber, waiter)
    return waiter.promise
  }

  resolve(callNumber: number): void {
    this.controls[callNumber - 1].resolve()
  }
}

class Phase2FailingPersistence implements SetupExperimentPersistence {
  state: SetupExperimentStoredState
  readonly attemptedStates: SetupExperimentStoredState[] = []
  private readonly attemptWaiters = new Map<number, ReturnType<typeof phase2Deferred<void>>>()

  constructor(
    failureAttempts: readonly number[],
    initial: SetupExperimentStoredState = emptySetupExperimentState()
  ) {
    this.failures = new Set(failureAttempts)
    this.state = clone(initial)
  }

  private readonly failures: Set<number>

  async load(): Promise<SetupExperimentStoredState> {
    return clone(this.state)
  }

  async save(state: SetupExperimentStoredState): Promise<void> {
    const attempt = this.attemptedStates.push(clone(state))
    this.attemptWaiters.get(attempt)?.resolve()
    if (this.failures.has(attempt)) {
      const error = new Error(`fixed EIO on save ${attempt}`)
      Object.assign(error, { code: 'EIO' })
      throw error
    }
    this.state = clone(state)
  }

  waitForAttempt(attempt: number): Promise<void> {
    if (this.attemptedStates.length >= attempt) return Promise.resolve()
    const waiter = this.attemptWaiters.get(attempt) ?? phase2Deferred<void>()
    this.attemptWaiters.set(attempt, waiter)
    return waiter.promise
  }
}

function seedPhase2RuntimeDefinition(
  persistence: MemoryPersistence,
  options: {
    tolerances?: Phase2Environment
    protocolPlan?: Array<{ blockId: string; sequence: Phase2Sequence }>
  } = {}
): void {
  const definition = persistence.state.experiments[0]
  Object.assign(definition.context as unknown as Phase2Record, clone(PHASE2_ENVIRONMENT))
  Object.assign(definition as unknown as Phase2Record, {
    environmentTolerances: clone(options.tolerances ?? PHASE2_TOLERANCES),
    analysisPlan: clone(PHASE2_ANALYSIS_PLAN),
    protocolPlan: clone(options.protocolPlan ?? [{ blockId: 'block-001', sequence: 'ABA' }])
  })
}

function phase2RuntimeLap(
  definition: SetupExperimentStoredState['experiments'][number],
  arm: Phase2Arm,
  id: string,
  lapNumber: number,
  lapTimeSec: number,
  metadata: Phase2Record = {}
) {
  return Object.assign({
    id,
    arm,
    capturedAt: 60_000 + lapNumber,
    lapNumber,
    lapTimeSec,
    completion: 'complete' as const,
    incidentDelta: 0,
    incidentState: 'clean' as const,
    telemetryState: 'known' as const,
    context: clone(definition.context),
    comparability: { status: 'comparable' as const, issues: [] },
    eligible: true,
    exclusionReasons: []
  }, metadata)
}

function seedPhase2CompletedRun(
  definition: SetupExperimentStoredState['experiments'][number],
  arm: Phase2Arm,
  times: readonly number[],
  metadata: Phase2Record = {}
) {
  const treatment = arm === 'B' ? 'B' : 'A'
  return Object.assign({
    id: `${String(metadata.blockId ?? 'block-001')}-${arm}`,
    arm,
    setupPath: treatment === 'B' ? definition.variantSetup.path : definition.baselineSetup.path,
    status: 'completed' as const,
    startedAt: 50_000,
    completedAt: 51_000,
    startContext: clone(definition.context),
    laps: times.map((time, index) => phase2RuntimeLap(
      definition,
      arm,
      `${arm}-${index + 1}`,
      index + 1,
      time,
      metadata
    )),
    rejectionReasons: []
  }, metadata)
}

const PHASE2_MISSING_ENVIRONMENT_ROWS = PHASE2_ENVIRONMENT_FIELDS.flatMap((field) => [
  { field, missing: 'expected' as const },
  { field, missing: 'actual' as const },
  { field, missing: 'tolerance' as const }
])

describe('SetupExperimentService Phase 2 red regressions', () => {
  it.each(PHASE2_MISSING_ENVIRONMENT_ROWS)(
    'fails closed before startArm when a required environment value or tolerance is missing ($missing $field)',
    async ({ field, missing }) => {
      const persistence = new MemoryPersistence()
      const initial = phase2Harness({ persistence, current: knownValidTelemetry(), idPrefix: `${missing}-${field}` })
      const experimentId = await phase2CreateExperiment(initial)
      seedPhase2RuntimeDefinition(persistence)
      const definition = persistence.state.experiments[0] as unknown as Phase2Record
      const actual = knownValidTelemetry()
      if (missing === 'expected') delete phase2Record(definition.context)[field]
      if (missing === 'tolerance') delete phase2Record(definition.environmentTolerances)[field]
      if (missing === 'actual') delete (actual as unknown as Phase2Record)[field]

      const reopened = phase2Harness({ persistence, current: actual, idPrefix: `reopened-${field}` })
      const outcome = await phase2Settle(reopened.service.startArm(phase2StartInput(experimentId, 'A1')))
      const snapshot = outcome.status === 'rejected' ? await reopened.service.snapshot() : outcome.value

      expect({
        outcome: outcome.status,
        message: outcome.status === 'rejected' ? phase2ErrorMessage(outcome.reason) : '',
        runs: snapshot.state.experiments[0].runs.length,
        activeCapture: snapshot.activeCapture
      }).toEqual({
        outcome: 'rejected',
        message: expect.stringMatching(new RegExp(`unknown.*${field}|${field}.*unknown`, 'i')),
        runs: 0,
        activeCapture: null
      })
    }
  )

  it('marks a lap ineligible after a mid-lap environment excursion even when the line snapshot is back in tolerance', async () => {
    const persistence = new MemoryPersistence()
    const target = phase2Harness({ persistence })
    const experimentId = await phase2CreateExperiment(target)
    seedPhase2RuntimeDefinition(persistence)
    const reopened = phase2Harness({ persistence, current: knownValidTelemetry(), idPrefix: 'environment-excursion' })
    await reopened.service.startArm(phase2StartInput(experimentId, 'A1'))

    const snapshot = await emitCompleteLap(
      reopened,
      100,
      { trackTempC: PHASE2_ENVIRONMENT.trackTempC + PHASE2_TOLERANCES.trackTempC + 0.000001 },
      { trackTempC: PHASE2_ENVIRONMENT.trackTempC + PHASE2_TOLERANCES.trackTempC }
    )
    const lap = snapshot.state.experiments[0].runs[0].laps[0]
    expect(lap).toMatchObject({
      eligible: false,
      exclusionReasons: ['environment-tolerance:trackTempC']
    })
    expect(phase2Record(lap.context).trackTempC).toBe(32)
  })

  it('freezes tolerances at create time and preserves them through save restart and exportBundle', async () => {
    const persistence = new MemoryPersistence()
    const callerTolerances = clone(PHASE2_TOLERANCES)
    const target = phase2Harness({ persistence, idPrefix: 'freeze' })
    const created = await target.service.create(phase2CreateInput('Frozen tolerances', callerTolerances))
    const experimentId = created.state.experiments[0].id
    callerTolerances.trackTempC = 999
    const persistedBeforeRestart = clone(persistence.state)
    const reopened = phase2Harness({ persistence, idPrefix: 'freeze-reopened' })
    const restarted = await reopened.service.snapshot()
    const exported = await reopened.service.exportBundle(experimentId)

    expect({
      created: phase2Record(created.state.experiments[0]).environmentTolerances,
      persisted: phase2Record(persistedBeforeRestart.experiments[0]).environmentTolerances,
      restarted: phase2Record(restarted.state.experiments[0]).environmentTolerances,
      exported: phase2Record(exported.experiment).environmentTolerances,
      caller: callerTolerances.trackTempC
    }).toEqual({
      created: PHASE2_TOLERANCES,
      persisted: PHASE2_TOLERANCES,
      restarted: PHASE2_TOLERANCES,
      exported: PHASE2_TOLERANCES,
      caller: 999
    })
  })

  it('rejects finishArm after four eligible laps and leaves the same run active', async () => {
    const target = phase2Harness()
    const experimentId = await phase2CreateExperiment(target)
    const started = await target.service.startArm(phase2StartInput(experimentId, 'A1'))
    const runId = started.activeCapture?.runId
    await captureEligibleLaps(target, [100.2, 100, 100.1, 99.9])
    const outcome = await phase2Settle(target.service.finishArm({ experimentId }))
    const snapshot = outcome.status === 'rejected' ? await target.service.snapshot() : outcome.value

    expect({
      outcome: outcome.status,
      status: snapshot.state.experiments[0].runs[0].status,
      activeRunId: snapshot.activeCapture?.runId,
      nextArm: nextSetupExperimentArm(snapshot.state.experiments[0])
    }).toEqual({
      outcome: 'rejected',
      status: 'recording',
      activeRunId: runId,
      nextArm: 'A1'
    })
  })

  it('finishes the same arm after a fifth eligible lap and advances exactly once', async () => {
    const target = phase2Harness()
    const experimentId = await phase2CreateExperiment(target)
    const started = await target.service.startArm(phase2StartInput(experimentId, 'A1'))
    const runId = started.activeCapture?.runId
    await captureEligibleLaps(target, [100.2, 100, 100.1, 99.9])
    const fourLapFinish = await phase2Settle(target.service.finishArm({ experimentId }))
    if (fourLapFinish.status === 'fulfilled') {
      expect({
        fourLapFinish: fourLapFinish.status,
        activeRunId: fourLapFinish.value.activeCapture?.runId
      }).toEqual({ fourLapFinish: 'rejected', activeRunId: runId })
      return
    }

    await emitCompleteLap(target, 100.3)
    const finished = await target.service.finishArm({ experimentId })
    expect({
      status: finished.state.experiments[0].runs[0].status,
      runId: finished.state.experiments[0].runs[0].id,
      activeCapture: finished.activeCapture,
      nextArm: nextSetupExperimentArm(finished.state.experiments[0]),
      runs: finished.state.experiments[0].runs.length
    }).toEqual({
      status: 'completed',
      runId,
      activeCapture: null,
      nextArm: 'B',
      runs: 1
    })
  })

  it.each([
    {
      label: 'unknown-validity',
      midLap: {},
      crossing: { lapValidity: null },
      time: 100.3
    },
    {
      label: 'incident/invalid',
      midLap: { incidentCountMy: 1, lapValidity: 'invalid' },
      crossing: { incidentCountMy: 1, lapValidity: 'invalid' },
      time: 100.3
    }
  ])('does not count a fifth $label lap toward finishArm eligibility', async ({ midLap, crossing, time }) => {
    const target = phase2Harness()
    const experimentId = await phase2CreateExperiment(target)
    const started = await target.service.startArm(phase2StartInput(experimentId, 'A1'))
    const runId = started.activeCapture?.runId
    await captureEligibleLaps(target, [100, 100, 100, 100])
    await emitCompleteLap(target, time, midLap, crossing)
    const outcome = await phase2Settle(target.service.finishArm({ experimentId }))
    const snapshot = outcome.status === 'rejected' ? await target.service.snapshot() : outcome.value

    expect({
      outcome: outcome.status,
      status: snapshot.state.experiments[0].runs[0].status,
      activeRunId: snapshot.activeCapture?.runId,
      nextArm: nextSetupExperimentArm(snapshot.state.experiments[0])
    }).toEqual({
      outcome: 'rejected',
      status: 'recording',
      activeRunId: runId,
      nextArm: 'A1'
    })
  })

  it('counts a telemetry-valid extreme clean lap toward finish and preserves it for sensitivity analysis', async () => {
    const target = phase2Harness()
    const experimentId = await phase2CreateExperiment(target)
    await target.service.startArm(phase2StartInput(experimentId, 'A1'))
    await captureEligibleLaps(target, [100, 100, 100, 100])
    await emitCompleteLap(target, 130)

    const finished = await target.service.finishArm({ experimentId })
    const run = finished.state.experiments[0].runs[0]
    expect(run.status).toBe('completed')
    expect(run.laps).toHaveLength(5)
    expect(run.laps[4]).toMatchObject({
      lapTimeSec: 130,
      eligible: true,
      exclusionReasons: []
    })
  })

  it('interrupts and restarts the same arm without deleting the manual-interrupt attempt', async () => {
    const target = phase2Harness()
    const experimentId = await phase2CreateExperiment(target)
    await target.service.startArm(phase2StartInput(experimentId, 'A1'))
    await target.service.interruptArm({ experimentId })
    const restarted = await target.service.startArm(phase2StartInput(experimentId, 'A1'))
    const runs = restarted.state.experiments[0].runs
    expect(runs.map((run) => ({
      arm: run.arm,
      status: run.status,
      rejectionReasons: run.rejectionReasons
    }))).toEqual([
      { arm: 'A1', status: 'interrupted', rejectionReasons: ['manual-interrupt'] },
      { arm: 'A1', status: 'recording', rejectionReasons: [] }
    ])
    expect(runs[0].id).not.toBe(runs[1].id)
  })

  it('starts a deterministic new independent block after a completed block and preserves all completed runs', async () => {
    const target = phase2Harness()
    const experimentId = await phase2CreateExperiment(target)
    await phase2CompleteLegacyBlock(target, experimentId)
    const before = clone((await target.service.snapshot()).state.experiments[0].runs)
    const outcome = await phase2Settle(target.service.startArm(phase2StartInput(experimentId, 'A1', {
      blockId: 'block-002',
      sequence: 'ABA',
      stepIndex: 0,
      treatment: 'A'
    })))
    const snapshot = outcome.status === 'fulfilled' ? outcome.value : await target.service.snapshot()
    const runs = snapshot.state.experiments[0].runs

    expect({
      outcome: outcome.status,
      preserved: runs.slice(0, before.length),
      newRun: phase2Record(runs[before.length])
    }).toEqual({
      outcome: 'fulfilled',
      preserved: before,
      newRun: expect.objectContaining({
        blockId: 'block-002',
        sequence: 'ABA',
        stepIndex: 0,
        treatment: 'A',
        status: 'recording'
      })
    })
  })

  it('starts the first B treatment of an explicitly declared BAB repeat', async () => {
    const target = phase2Harness()
    const experimentId = await phase2CreateExperiment(target)
    await phase2CompleteLegacyBlock(target, experimentId)
    const outcome = await phase2Settle(target.service.startArm(phase2StartInput(experimentId, 'B', {
      blockId: 'block-002',
      sequence: 'BAB' as const,
      stepIndex: 0,
      treatment: 'B' as const
    })))
    const snapshot = outcome.status === 'fulfilled' ? outcome.value : await target.service.snapshot()
    const run = snapshot.state.experiments[0].runs.at(-1)

    expect({
      outcome: outcome.status,
      run: phase2Record(run),
      active: snapshot.activeCapture
    }).toEqual({
      outcome: 'fulfilled',
      run: expect.objectContaining({
        blockId: 'block-002',
        sequence: 'BAB' as const,
        stepIndex: 0,
        treatment: 'B',
        arm: 'B',
        setupPath: 'C:\\setups\\variant.sto'
      }),
      active: expect.objectContaining({ arm: 'B' })
    })
  })

  it('clears a stale final disposition when the protocol is reopened with a repeat block', async () => {
    const target = phase2Harness()
    const experimentId = await phase2CreateExperiment(target)
    await phase2CompleteLegacyBlock(target, experimentId)
    const decided = await target.service.recordDecision({
      experimentId,
      disposition: 'abstain',
      note: 'Single block remains exploratory.'
    })
    expect(decided.state.experiments[0].decision?.disposition).toBe('abstain')

    const reopened = await target.service.addBlock({ experimentId, sequence: 'BAB' })
    expect(reopened.state.experiments[0].decision).toBeNull()
    expect(nextSetupExperimentArm(reopened.state.experiments[0])).toBe('B')
  })

  it('rejects an invalid reopen order without appending or overwriting a run', async () => {
    const target = phase2Harness()
    const experimentId = await phase2CreateExperiment(target)
    await phase2CompleteLegacyBlock(target, experimentId)
    const before = clone((await target.service.snapshot()).state.experiments[0].runs)
    const outcome = await phase2Settle(target.service.startArm(phase2StartInput(experimentId, 'B', {
      blockId: 'block-002',
      sequence: 'ABA',
      stepIndex: 1,
      treatment: 'B' as const
    })))
    const after = (await target.service.snapshot()).state.experiments[0].runs

    expect({
      outcome: outcome.status,
      message: outcome.status === 'rejected' ? phase2ErrorMessage(outcome.reason) : '',
      after
    }).toEqual({
      outcome: 'rejected',
      message: expect.stringMatching(/step 0|reopen order|sequence/i),
      after: before
    })
  })

  it('recovers an interrupted repeated block at the same block and step after reopen', async () => {
    const persistence = new MemoryPersistence()
    const first = phase2Harness({ persistence, idPrefix: 'repeat-first' })
    const experimentId = await phase2CreateExperiment(first)
    await phase2CompleteLegacyBlock(first, experimentId)
    const definition = persistence.state.experiments[0]
    definition.runs.push(Object.assign({
      id: 'block-002-step-0-attempt-1',
      arm: 'B' as const,
      setupPath: definition.variantSetup.path,
      status: 'recording' as const,
      startedAt: 70_000,
      startContext: clone(definition.context),
      laps: [],
      rejectionReasons: []
    }, {
      blockId: 'block-002',
      sequence: 'BAB' as const,
      stepIndex: 0,
      treatment: 'B' as const
    }))

    const reopened = phase2Harness({ persistence, idPrefix: 'repeat-reopened' })
    const recovered = await reopened.service.snapshot()
    const outcome = await phase2Settle(reopened.service.startArm(phase2StartInput(experimentId, 'B', {
      blockId: 'block-002',
      sequence: 'BAB',
      stepIndex: 0,
      treatment: 'B'
    })))
    const after = outcome.status === 'fulfilled' ? outcome.value : await reopened.service.snapshot()
    const runs = after.state.experiments[0].runs

    expect({
      recoveredAttempt: phase2Record(recovered.state.experiments[0].runs.at(-1)),
      outcome: outcome.status,
      restartedAttempt: phase2Record(runs.at(-1))
    }).toEqual({
      recoveredAttempt: expect.objectContaining({
        blockId: 'block-002',
        stepIndex: 0,
        status: 'interrupted',
        rejectionReasons: ['app-restart']
      }),
      outcome: 'fulfilled',
      restartedAttempt: expect.objectContaining({
        blockId: 'block-002',
        sequence: 'BAB',
        stepIndex: 0,
        treatment: 'B',
        status: 'recording'
      })
    })
  })

  it.each([
    { label: 'pit road', midLap: { onPitRoad: true }, reason: 'pit-road' },
    { label: 'active pit stop', midLap: { pitStopActive: true }, reason: 'pit-stop' },
    { label: 'pit stall', midLap: { pit: { inPitStall: true } }, reason: 'pit-stop' },
    {
      label: 'refuel service',
      midLap: { pitServiceFlags: ['fuel'], refuelServiceActive: true },
      reason: 'refuel'
    },
    {
      label: 'positive fuel discontinuity',
      midLap: { fuelLiters: 41, fuelMassKg: 46 },
      reason: 'fuel-discontinuity'
    },
    { label: 'off track', midLap: { onTrack: false }, reason: 'off-track' },
    { label: 'tow/reset', midLap: { towReset: true }, reason: 'tow-reset' },
    { label: 'unknown lap validity', midLap: { lapValidity: null }, reason: 'lap-validity-unknown' }
  ])(
    'stores a lap ineligible for mid-lap $label and clears the flag for the next clean lap',
    async ({ midLap, reason }) => {
      const target = phase2Harness()
      const experimentId = await phase2CreateExperiment(target)
      await target.service.startArm(phase2StartInput(experimentId, 'A1'))
      await emitCompleteLap(target, 100, midLap)
      const snapshot = await emitCompleteLap(target, 99.8)
      const laps = snapshot.state.experiments[0].runs[0].laps

      expect(laps).toHaveLength(2)
      expect(laps[0]).toMatchObject({
        eligible: false,
        exclusionReasons: [reason]
      })
      expect(laps[1]).toMatchObject({
        eligible: true,
        exclusionReasons: []
      })
    }
  )

  it('accepts normal monotonically decreasing fuel burn without treating it as refueling', async () => {
    const target = phase2Harness({ current: knownValidTelemetry({ fuelLiters: 40, fuelMassKg: 45 }) })
    const experimentId = await phase2CreateExperiment(target)
    await target.service.startArm(phase2StartInput(experimentId, 'A1'))
    const snapshot = await emitCompleteLap(
      target,
      100,
      { fuelLiters: 39.5, fuelMassKg: 44.5 },
      { fuelLiters: 39, fuelMassKg: 44 }
    )
    const lap = snapshot.state.experiments[0].runs[0].laps[0]
    expect(lap).toMatchObject({ eligible: true, exclusionReasons: [] })
    expect(lap.exclusionReasons).not.toContain('refuel')
    expect(lap.exclusionReasons).not.toContain('fuel-discontinuity')
  })

  it('does not mistake a selected fuel strategy for active refueling while driving', async () => {
    const target = phase2Harness()
    const experimentId = await phase2CreateExperiment(target)
    await target.service.startArm(phase2StartInput(experimentId, 'A1'))
    const snapshot = await emitCompleteLap(
      target,
      100,
      {
        onPitRoad: false,
        pitStopActive: false,
        pit: { inPitStall: false, repairNeeded: false, optRepairNeeded: false, pitsOpen: true },
        refuelServiceActive: undefined,
        pitServiceFlags: ['fuel'],
        pitFuelToAddL: 40
      },
      {
        onPitRoad: false,
        pitStopActive: false,
        pit: { inPitStall: false, repairNeeded: false, optRepairNeeded: false, pitsOpen: true },
        refuelServiceActive: undefined,
        pitServiceFlags: ['fuel'],
        pitFuelToAddL: 40
      }
    )

    expect(snapshot.state.experiments[0].runs[0].laps[0]).toMatchObject({
      eligible: true,
      exclusionReasons: []
    })
  })

  it('validates monotonic iRacing tyre wear from production corner telemetry without top-level tyreStatePct', async () => {
    const initial = productionIRacingTyreTelemetry([0.82, 0.81, 0.79, 0.78])
    expect('tyreStatePct' in initial).toBe(false)
    const target = phase2Harness({ current: initial })
    const experimentId = await phase2CreateExperiment(target)
    await target.service.startArm(phase2StartInput(experimentId, 'A1'))

    const midLap = productionIRacingTyreTelemetry(
      [0.815, 0.805, 0.785, 0.775],
      { currentLap: 1, lapDistPct: 0.5, fuelLiters: 39.5 }
    )
    target.setTelemetry(midLap)
    target.service.onSnapshot(midLap)
    const crossing = productionIRacingTyreTelemetry(
      [0.81, 0.8, 0.78, 0.77],
      { currentLap: 2, lapDistPct: 0.02, lastLapTimeSec: 100, fuelLiters: 39 }
    )
    target.setTelemetry(crossing)
    target.service.onSnapshot(crossing)

    const lap = (await target.service.snapshot()).state.experiments[0].runs[0].laps[0]
    expect(lap).toMatchObject({
      eligible: true,
      exclusionReasons: [],
      validitySource: 'telemetry',
      comparability: { status: 'comparable', issues: [] }
    })
    expect(lap.context.tyreStatePct).toBeCloseTo(0.79, 10)
  })

  it('detects an iRacing tyre reset from production corner telemetry without top-level tyreStatePct', async () => {
    const target = phase2Harness({
      current: productionIRacingTyreTelemetry([0.82, 0.81, 0.79, 0.78])
    })
    const experimentId = await phase2CreateExperiment(target)
    await target.service.startArm(phase2StartInput(experimentId, 'A1'))

    const midLap = productionIRacingTyreTelemetry(
      [0.82, 0.8, 0.78, 0.76],
      { currentLap: 1, lapDistPct: 0.5, fuelLiters: 39.5 }
    )
    target.setTelemetry(midLap)
    target.service.onSnapshot(midLap)
    const crossing = productionIRacingTyreTelemetry(
      [0.835, 0.815, 0.795, 0.775],
      { currentLap: 2, lapDistPct: 0.02, lastLapTimeSec: 100, fuelLiters: 39 }
    )
    target.setTelemetry(crossing)
    target.service.onSnapshot(crossing)

    const lap = (await target.service.snapshot()).state.experiments[0].runs[0].laps[0]
    expect(lap).toMatchObject({
      eligible: false,
      exclusionReasons: ['tyre-discontinuity'],
      comparability: { status: 'comparable', issues: [] }
    })
    expect(lap.context.tyreStatePct).toBeCloseTo(0.805, 10)
  })

  it('gates fuel and tyre state at run start but permits monotonic within-run depletion', async () => {
    const target = phase2Harness()
    const tolerances = clone(PHASE2_TOLERANCES)
    tolerances.fuelMassKg = 1
    tolerances.tyreStatePct = 0.01
    const experimentId = await phase2CreateExperiment(target, 'Consumable trajectory', tolerances)
    await target.service.startArm(phase2StartInput(experimentId, 'A1'))
    for (let index = 0; index < 5; index++) {
      await emitCompleteLap(
        target,
        100 + index * 0.01,
        {
          fuelMassKg: 44.5 - index,
          tyreStatePct: 0.795 - index * 0.01
        },
        {
          fuelMassKg: 44 - index,
          tyreStatePct: 0.79 - index * 0.01
        }
      )
    }

    const finished = await target.service.finishArm({ experimentId })
    expect(finished.state.experiments[0].runs[0]).toMatchObject({ status: 'completed' })
    expect(finished.state.experiments[0].runs[0].laps.every((lap) => lap.eligible)).toBe(true)
    expect(finished.state.experiments[0].runs[0].laps.every(
      (lap) => lap.comparability.status === 'comparable'
    )).toBe(true)
  })

  it.each([
    { label: 'on-track status', field: 'onTrack', reason: 'on-track-unknown' },
    { label: 'fuel evidence', field: 'fuelLiters', reason: 'fuel-unknown' }
  ])(
    'requires every valid control snapshot to carry explicit known-valid lap signals ($label)',
    async ({ field, reason }) => {
      const target = phase2Harness()
      const experimentId = await phase2CreateExperiment(target)
      await target.service.startArm(phase2StartInput(experimentId, 'A1'))
      const midLap = knownValidTelemetry({ currentLap: 1, lapDistPct: 0.5 })
      delete (midLap as unknown as Phase2Record)[field]
      target.setTelemetry(midLap)
      target.service.onSnapshot(midLap)
      const crossing = knownValidTelemetry({ currentLap: 2, lapDistPct: 0.02, lastLapTimeSec: 100 })
      target.setTelemetry(crossing)
      target.service.onSnapshot(crossing)
      const snapshot = await target.service.snapshot()
      const lap = snapshot.state.experiments[0].runs[0].laps[0]

      expect(lap).toMatchObject({
        eligible: false,
        exclusionReasons: [reason]
      })
    }
  )

  it('derives valid continuity when a provider omits dedicated lap-validity and tow flags', async () => {
    const target = phase2Harness()
    const experimentId = await phase2CreateExperiment(target)
    await target.service.startArm(phase2StartInput(experimentId, 'A1'))
    const midLap = knownValidTelemetry({ currentLap: 1, lapDistPct: 0.5, fuelLiters: 39.5 })
    delete midLap.lapValidity
    delete midLap.towReset
    target.setTelemetry(midLap)
    target.service.onSnapshot(midLap)
    const crossing = knownValidTelemetry({
      currentLap: 2,
      lapDistPct: 0.02,
      lastLapTimeSec: 100,
      fuelLiters: 39
    })
    delete crossing.lapValidity
    delete crossing.towReset
    target.setTelemetry(crossing)
    target.service.onSnapshot(crossing)

    const lap = (await target.service.snapshot()).state.experiments[0].runs[0].laps[0]
    expect(lap).toMatchObject({
      eligible: true,
      exclusionReasons: [],
      validitySource: 'derived'
    })
  })

  it('exportBundle retains the exact seeded bootstrap plan and explicit ABA BAB block metadata', async () => {
    const persistence = new MemoryPersistence()
    const first = phase2Harness({ persistence, idPrefix: 'export-plan' })
    const experimentId = await phase2CreateExperiment(first)
    seedPhase2RuntimeDefinition(persistence, {
      protocolPlan: [
        { blockId: 'block-001', sequence: 'ABA' },
        { blockId: 'block-002', sequence: 'BAB' }
      ]
    })
    const definition = persistence.state.experiments[0]
    definition.runs = [
      seedPhase2CompletedRun(definition, 'A1', [100.2, 100, 100.1, 99.9, 100.3], {
        blockId: 'block-001', sequence: 'ABA', stepIndex: 0, treatment: 'A'
      }),
      seedPhase2CompletedRun(definition, 'B', [98.8, 99, 98.9, 99.1, 98.7], {
        blockId: 'block-001', sequence: 'ABA', stepIndex: 1, treatment: 'B'
      }),
      seedPhase2CompletedRun(definition, 'A2', [100.1, 99.9, 100, 100.2, 99.8], {
        blockId: 'block-001', sequence: 'ABA', stepIndex: 2, treatment: 'A'
      })
    ]
    const reopened = phase2Harness({ persistence, idPrefix: 'export-plan-reopened' })
    const bundle = await reopened.service.exportBundle(experimentId)

    expect({
      plan: phase2Record(bundle.experiment).analysisPlan,
      protocolPlan: phase2Record(bundle.experiment).protocolPlan,
      bootstrap: phase2Record(bundle.analysis).bootstrap
    }).toEqual({
      plan: PHASE2_ANALYSIS_PLAN,
      protocolPlan: [
        { blockId: 'block-001', sequence: 'ABA' },
        { blockId: 'block-002', sequence: 'BAB' }
      ],
      bootstrap: expect.objectContaining({
        seed: PHASE2_ANALYSIS_PLAN.seed,
        iterations: PHASE2_ANALYSIS_PLAN.iterations,
        lapBlockLength: PHASE2_ANALYSIS_PLAN.lapBlockLength,
        minimumIndependentBlocks: PHASE2_ANALYSIS_PLAN.minimumIndependentBlocks
      })
    })
  })

  it('exportBundle retains every independently declared environment tolerance', async () => {
    const persistence = new MemoryPersistence()
    const first = phase2Harness({ persistence, idPrefix: 'export-tolerances' })
    const experimentId = await phase2CreateExperiment(first)
    seedPhase2RuntimeDefinition(persistence)
    const reopened = phase2Harness({ persistence, idPrefix: 'export-tolerances-reopened' })
    const bundle = await reopened.service.exportBundle(experimentId)
    expect(phase2Record(bundle.experiment).environmentTolerances).toEqual(PHASE2_TOLERANCES)
    expect(Object.keys(phase2Record(bundle.experiment).environmentTolerances as Phase2Record)).toEqual(
      PHASE2_ENVIRONMENT_FIELDS
    )
  })

  it('exportBundle retains every clean lap including flagged B-10', async () => {
    const persistence = new MemoryPersistence()
    const first = phase2Harness({ persistence, idPrefix: 'export-laps' })
    const experimentId = await phase2CreateExperiment(first)
    seedPhase2RuntimeDefinition(persistence)
    const definition = persistence.state.experiments[0]
    const controls = [99.8, 99.85, 99.9, 99.95, 100, 100.05, 100.1, 100.15, 100.2]
    const treatment = [98, 98.1, 98.2, 98.3, 98.5, 102, 102.1, 102.2, 102.3, 130]
    definition.runs = [
      seedPhase2CompletedRun(definition, 'A1', controls, {
        blockId: 'block-001', sequence: 'ABA', stepIndex: 0, treatment: 'A'
      }),
      seedPhase2CompletedRun(definition, 'B', treatment, {
        blockId: 'block-001', sequence: 'ABA', stepIndex: 1, treatment: 'B'
      }),
      seedPhase2CompletedRun(definition, 'A2', controls, {
        blockId: 'block-001', sequence: 'ABA', stepIndex: 2, treatment: 'A'
      })
    ]
    Object.assign(definition.runs[1].laps[9] as unknown as Phase2Record, {
      id: 'B-10',
      auditFlags: ['outlier']
    })
    const expectedIds = definition.runs.flatMap((run) => run.laps.map((lap) => lap.id))
    const reopened = phase2Harness({ persistence, idPrefix: 'export-laps-reopened' })
    const bundle = await reopened.service.exportBundle(experimentId)
    const exportedLaps = bundle.experiment.runs.flatMap((run) => run.laps)

    expect(exportedLaps).toHaveLength(28)
    expect(exportedLaps.map((lap) => lap.id)).toEqual(expectedIds)
    expect(exportedLaps.find((lap) => lap.id === 'B-10')).toMatchObject({
      lapTimeSec: 130,
      eligible: true,
      auditFlags: ['outlier']
    })
  })

  it('increments a persisted snapshot revision for each committed change even when clocks tie or move backward', async () => {
    const persistence = new MemoryPersistence()
    const clock = [90_000, 90_000, 89_999, 89_998, 89_997, 89_996, 89_995, 89_994, 89_993, 89_992]
    const target = phase2Harness({ persistence, clock, idPrefix: 'revision' })
    const created = await target.service.create(phase2CreateInput('Revision one'))
    const experimentId = created.state.experiments[0].id
    const started = await target.service.startArm(phase2StartInput(experimentId, 'A1'))
    const revisions = [phase2Revision(created), phase2Revision(started)]
    for (const time of [100.2, 100, 100.1, 99.9, 100.3]) {
      revisions.push(phase2Revision(await emitCompleteLap(target, time)))
    }
    const finished = await target.service.finishArm({ experimentId })
    revisions.push(phase2Revision(finished))
    const persistedBeforeRestart = phase2Record(persistence.state).revision
    const reopened = phase2Harness({ persistence, clock: [80_000], idPrefix: 'revision-reopened' })
    const next = await reopened.service.create(phase2CreateInput('Revision after restart'))
    revisions.push(phase2Revision(next))

    expect(revisions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(persistedBeforeRestart).toBe(8)
    expect(phase2Record(persistence.state).revision).toBe(9)
    expect(finished.state.experiments[0].updatedAt).toBeLessThanOrEqual(
      created.state.experiments[0].updatedAt
    )
  })

  it('broadcasts the exact committed revision returned by snapshot', async () => {
    const persistence = new MemoryPersistence()
    const target = phase2Harness({ persistence, idPrefix: 'broadcast-revision' })
    const created = await target.service.create(phase2CreateInput('Broadcast revision'))
    const experimentId = created.state.experiments[0].id
    const started = await target.service.startArm(phase2StartInput(experimentId, 'A1'))
    const captured = await emitCompleteLap(target, 100)
    const operationRevisions = [created, started, captured].map(phase2Revision)
    const broadcastRevisions = target.broadcasts.map(phase2Revision)

    expect(operationRevisions).toEqual([1, 2, 3])
    expect(broadcastRevisions).toEqual(operationRevisions)
    expect(phase2Record(persistence.state).revision).toBe(3)
    expect(target.broadcasts.map((snapshot) => snapshot.state.experiments[0].runs[0]?.laps.length ?? 0))
      .toEqual([0, 0, 1])
  })

  it('rolls back a failed mutation withholds its revision and broadcast and lets the next mutation commit', async () => {
    const persistence = new Phase2FailingPersistence([1])
    const target = phase2Harness({ persistence, idPrefix: 'rollback' })
    const failed = await phase2Settle(target.service.create(phase2CreateInput('Must roll back')))
    const visibleAfterFailure = await phase2Settle(target.service.snapshot())
    const next = await phase2Settle(target.service.create(phase2CreateInput('Committed after EIO')))
    const visibleAfterNext = await phase2Settle(target.service.snapshot())

    expect({
      failed: failed.status,
      failedCode: failed.status === 'rejected' ? phase2Record(failed.reason).code : null,
      visibleAfterFailure: visibleAfterFailure.status,
      stateAfterFailure: visibleAfterFailure.status === 'fulfilled'
        ? visibleAfterFailure.value.state.experiments.map((experiment) => experiment.name)
        : null,
      next: next.status,
      visibleAfterNext: visibleAfterNext.status,
      diskNames: persistence.state.experiments.map((experiment) => experiment.name),
      revision: phase2Record(persistence.state).revision,
      broadcasts: target.broadcasts.map((snapshot) => ({
        revision: phase2Revision(snapshot),
        names: snapshot.state.experiments.map((experiment) => experiment.name)
      })),
      attempts: persistence.attemptedStates.length
    }).toEqual({
      failed: 'rejected',
      failedCode: 'EIO',
      visibleAfterFailure: 'fulfilled',
      stateAfterFailure: [],
      next: 'fulfilled',
      visibleAfterNext: 'fulfilled',
      diskNames: ['Committed after EIO'],
      revision: 1,
      broadcasts: [{ revision: 1, names: ['Committed after EIO'] }],
      attempts: 2
    })
  })

  it('serializes deferred saves and never broadcasts state from a later uncommitted mutation', async () => {
    const persistence = new Phase2DeferredPersistence()
    const target = phase2Harness({ persistence, idPrefix: 'deferred' })
    const firstPromise = target.service.create(phase2CreateInput('First committed'))
    await persistence.waitForSave(1)
    const secondPromise = target.service.create(phase2CreateInput('Second committed'))
    await Promise.resolve()
    await Promise.resolve()
    const beforeFirstCommit = {
      saveCalls: persistence.attemptedStates.length,
      broadcasts: clone(target.broadcasts)
    }

    persistence.resolve(1)
    const firstResult = await firstPromise
    await persistence.waitForSave(2)
    const afterFirstCommit = {
      resultNames: firstResult.state.experiments.map((experiment) => experiment.name),
      broadcasts: clone(target.broadcasts)
    }
    persistence.resolve(2)
    const secondResult = await secondPromise

    expect(beforeFirstCommit).toEqual({ saveCalls: 1, broadcasts: [] })
    expect(afterFirstCommit).toEqual({
      resultNames: ['First committed'],
      broadcasts: [expect.objectContaining({
        state: expect.objectContaining({
          revision: 1,
          experiments: [expect.objectContaining({ name: 'First committed' })]
        })
      })]
    })
    expect(secondResult.state.experiments.map((experiment) => experiment.name)).toEqual([
      'Second committed',
      'First committed'
    ])
    expect(target.broadcasts.map((snapshot) => phase2Revision(snapshot))).toEqual([1, 2])
  })

  it('retries a transient onSnapshot save failure without dropping or prematurely broadcasting the lap', async () => {
    const persistence = new Phase2FailingPersistence([3])
    const target = phase2Harness({ persistence, idPrefix: 'snapshot-eio' })
    const experimentId = await phase2CreateExperiment(target, 'Lap save failure')
    await target.service.startArm(phase2StartInput(experimentId, 'A1'))
    const midLap = knownValidTelemetry({ currentLap: 1, lapDistPct: 0.5 })
    target.setTelemetry(midLap)
    target.service.onSnapshot(midLap)
    const crossing = knownValidTelemetry({ currentLap: 2, lapDistPct: 0.02, lastLapTimeSec: 100 })
    target.setTelemetry(crossing)
    target.service.onSnapshot(crossing)
    await persistence.waitForAttempt(3)

    const later = await phase2Settle(target.service.create(phase2CreateInput('Later mutation')))
    const visible = await phase2Settle(target.service.snapshot())
    expect({
      later: later.status,
      visible: visible.status,
      attempts: persistence.attemptedStates.length,
      diskNames: persistence.state.experiments.map((experiment) => experiment.name),
      diskLapCount: persistence.state.experiments.find((experiment) => experiment.id === experimentId)
        ?.runs[0].laps.length,
      broadcastLapCounts: target.broadcasts.map((snapshot) =>
        snapshot.state.experiments.find((experiment) => experiment.id === experimentId)
          ?.runs[0]?.laps.length ?? 0
      )
    }).toEqual({
      later: 'fulfilled',
      visible: 'fulfilled',
      attempts: 5,
      diskNames: ['Later mutation', 'Lap save failure'],
      diskLapCount: 1,
      broadcastLapCounts: [0, 0, 1, 1]
    })
  })

  it('retains and surfaces a pending lap until persistence recovers', async () => {
    const persistence = new Phase2FailingPersistence([3, 4])
    const target = phase2Harness({ persistence, idPrefix: 'pending-lap' })
    const experimentId = await phase2CreateExperiment(target, 'Pending lap')
    await target.service.startArm(phase2StartInput(experimentId, 'A1'))
    const midLap = knownValidTelemetry({ currentLap: 1, lapDistPct: 0.5 })
    target.setTelemetry(midLap)
    target.service.onSnapshot(midLap)
    const crossing = knownValidTelemetry({ currentLap: 2, lapDistPct: 0.02, lastLapTimeSec: 100 })
    target.setTelemetry(crossing)
    target.service.onSnapshot(crossing)
    await persistence.waitForAttempt(4)

    const pending = await target.service.snapshot()
    expect(pending.activeCapture).toMatchObject({
      pendingLapCount: 1,
      persistenceError: expect.stringMatching(/fixed EIO/i)
    })
    expect(persistence.state.experiments[0].runs[0].laps).toEqual([])
    expect(target.broadcasts.map((snapshot) =>
      snapshot.state.experiments[0]?.runs[0]?.laps.length ?? 0
    )).toEqual([0, 0, 0])

    target.service.onSnapshot(crossing)
    await persistence.waitForAttempt(5)
    const recovered = await target.service.snapshot()
    expect(recovered.activeCapture?.pendingLapCount).toBe(0)
    expect(persistence.state.experiments[0].runs[0].laps).toHaveLength(1)
  })

  it('snapshot surfaces corrupt-store path code and quarantine status without treating it as an empty success', async () => {
    const persistence = new MemoryPersistence()
    Object.assign(persistence.state as unknown as Phase2Record, {
      storageIssues: [{
        kind: 'corrupt-store',
        sourcePath: 'C:\\Users\\fixed\\setup-experiments.json',
        code: 'corrupt-json',
        quarantinePath: 'C:\\Users\\fixed\\setup-experiments.json.corrupt-20260717',
        quarantineStatus: 'quarantined',
        message: 'The setup experiment store contained invalid JSON.'
      }]
    })
    const target = phase2Harness({ persistence, idPrefix: 'corrupt-store' })
    const snapshot = await target.service.snapshot()

    expect(phase2Record(snapshot.state).storageIssues).toEqual([{
      kind: 'corrupt-store',
      sourcePath: 'C:\\Users\\fixed\\setup-experiments.json',
      code: 'corrupt-json',
      quarantinePath: 'C:\\Users\\fixed\\setup-experiments.json.corrupt-20260717',
      quarantineStatus: 'quarantined',
      message: 'The setup experiment store contained invalid JSON.'
    }])
    expect(snapshot.state.experiments).toEqual([])
  })

  it('keeps the service read-only when corrupt bytes could not be quarantined', async () => {
    const persistence = new MemoryPersistence()
    Object.assign(persistence.state as unknown as Phase2Record, {
      storageIssues: [{
        kind: 'corrupt-store',
        sourcePath: 'C:\\Users\\fixed\\setup-experiments.json',
        code: 'EACCES',
        quarantinePath: 'C:\\Users\\fixed\\setup-experiments.json.corrupt-fixed',
        quarantineStatus: 'failed',
        message: 'Quarantine failed.'
      }]
    })
    const target = phase2Harness({ persistence, idPrefix: 'read-only-store' })

    await expect(target.service.create(phase2CreateInput('Must not overwrite corrupt bytes')))
      .rejects.toThrow(/read-only.*EACCES/i)
    expect((await target.service.snapshot()).state.experiments).toEqual([])
    expect(persistence.state.experiments).toEqual([])
  })
})
