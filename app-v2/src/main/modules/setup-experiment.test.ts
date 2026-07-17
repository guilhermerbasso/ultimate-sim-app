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
    isRaining: false,
    weatherDeclaredWet: false,
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

describe('SetupExperimentService', () => {
  it('rejects out-of-order arms and requires the baseline for rollback A2', async () => {
    const { service } = harness()
    const experimentId = await createExperiment(service)

    await expect(service.startArm({
      experimentId,
      arm: 'B',
      confirmedSetupPath: 'C:\\setups\\variant.sto'
    })).rejects.toThrow(/expected A1/i)

    await service.startArm({
      experimentId,
      arm: 'A1',
      confirmedSetupPath: 'C:\\setups\\baseline.sto'
    })
    await service.finishArm({ experimentId })
    await service.startArm({
      experimentId,
      arm: 'B',
      confirmedSetupPath: 'C:\\setups\\variant.sto'
    })
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
    expect(started.activeCapture).toEqual({
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
    expect(exported.disclaimer).toBe(
      'Local decision-support evidence only. No setup is applied automatically and no causal or optimal-setup claim is made.'
    )
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
