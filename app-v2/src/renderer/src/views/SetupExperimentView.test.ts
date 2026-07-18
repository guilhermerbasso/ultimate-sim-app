// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppViewProps } from '../App'
import type { IpcBridge } from '../../../shared/bridge'
import {
  SETUP_EXPERIMENT_CHANNELS,
  type SetupExperimentAnalysis,
  type SetupExperimentArm,
  type SetupExperimentArmStatistics,
  type SetupExperimentDefinition,
  type SetupExperimentSnapshot
} from '../../../shared/setup-experiment'
import { SETUP_MANAGER_CHANNELS, type SetupLibraryResult } from '../../../shared/setup-manager'
import SetupExperimentView from './SetupExperimentView'

type RuntimeStorageIssue = {
  sourcePath: string
  code: string
  message: string
  quarantineStatus: 'quarantined' | 'failed'
  quarantinePath?: string
}

type RuntimeAnalysis = SetupExperimentAnalysis & {
  evidenceStrength: 'exploratory' | 'confirmatory'
  exploratoryDirection: 'variant' | 'baseline' | 'abstain'
  rollbackRelation: 'agreement' | 'conflict'
}

type RuntimeSnapshot = SetupExperimentSnapshot & {
  state: SetupExperimentSnapshot['state'] & {
    revision?: number
    storageIssues?: RuntimeStorageIssue[]
  }
}

type SnapshotListener = (snapshot: SetupExperimentSnapshot) => void

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function armStatistics(arm: SetupExperimentArm): SetupExperimentArmStatistics {
  return {
    arm,
    totalLaps: 0,
    cleanKnownLaps: 0,
    unknownLaps: 0,
    incidentLaps: 0,
    usedLaps: 0,
    outliers: 0,
    medianLapTimeSec: null,
    madSec: null
  }
}

function experiment(id: string, name: string): SetupExperimentDefinition {
  return {
    schemaVersion: 1,
    id,
    name,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_001,
    baselineSetup: {
      id: `${id}-baseline`,
      path: `C:\\fixed\\${id}-baseline.sto`,
      fileName: `${id}-baseline.sto`,
      relativePath: `car\\${id}-baseline.sto`,
      sizeBytes: 512,
      modifiedAt: 1_699_999_999_000
    },
    variantSetup: {
      id: `${id}-variant`,
      path: `C:\\fixed\\${id}-variant.sto`,
      fileName: `${id}-variant.sto`,
      relativePath: `car\\${id}-variant.sto`,
      sizeBytes: 513,
      modifiedAt: 1_699_999_999_001
    },
    variable: {
      section: 'Chassis',
      key: 'RearWing',
      kind: 'changed',
      before: '8',
      after: '7'
    },
    context: {
      sim: 'iracing',
      car: 'ferrari488gt3',
      carLabel: 'Ferrari 488 GT3',
      track: 'Spa',
      layout: 'Grand Prix',
      layoutSource: 'telemetry',
      condition: 'dry',
      session: 'Practice',
      sessionId: 'fixed-session',
      trackWetnessPct: 0,
      trackTempC: 31,
      airTempC: 22,
      fuelMassKg: 45,
      tyreStatePct: 0.8,
      trafficDensity: 0.3,
      flagStateIndex: 0,
      damagePct: 0,
      gripPct: 0.8
    },
    minCleanLapsPerArm: 5,
    runs: [],
    decision: null,
    localOnly: true,
    setupApplication: 'manual'
  }
}

function analysis(): SetupExperimentAnalysis {
  return {
    eligible: false,
    direction: 'abstain',
    reasons: ['protocol-incomplete:A1'],
    arms: {
      A1: armStatistics('A1'),
      B: armStatistics('B'),
      A2: armStatistics('A2')
    },
    effectSec: null,
    effectPct: null,
    confidence95Sec: null,
    firstContrastSec: null,
    rollbackContrastSec: null,
    rollbackDriftSec: null,
    falseDirectionProtected: false
  }
}

function snapshot(
  revision: number | undefined,
  definitions: SetupExperimentDefinition[] = [],
  analyses: Record<string, SetupExperimentAnalysis> = {}
): SetupExperimentSnapshot {
  const value: RuntimeSnapshot = {
    state: {
      schemaVersion: 1,
      experiments: definitions
    },
    analyses,
    metrics: {
      definitions: definitions.length,
      completedProtocols: 0,
      eligibleExperiments: 0,
      directionalDecisions: 0,
      alignedDirectionalDecisions: 0,
      falseDirectionDecisions: 0,
      confirmatoryDirections: 0,
      rollbackEvaluatedSignals: 0,
      rollbackAgreementSignals: 0,
      rollbackConflictSignals: 0,
      rollbackEvaluatedDirections: 0,
      rollbackConfirmedDirections: 0,
      falseDirectionSignals: 0,
      protocolCompletionRate: definitions.length === 0 ? null : 0,
      decisionCoverage: null,
      rollbackAgreementRate: null,
      rollbackConflictRate: null,
      conditionalDirectionalAccuracy: null,
      falseDirectionRate: null,
      coverageTargetMet: null,
      agreementTargetMet: null,
      conflictTargetMet: null,
      accuracyTargetMet: null,
      falseDirectionTargetMet: null
    },
    liveContext: null,
    activeCapture: null
  }
  if (revision !== undefined) value.state.revision = revision
  return value
}

function namedSnapshot(revision: number | undefined, id: string, name: string): SetupExperimentSnapshot {
  const definition = experiment(id, name)
  return snapshot(revision, [definition], { [id]: analysis() })
}

function props(): AppViewProps {
  return {
    connectedDevice: null,
    mapping: null,
    config: null,
    setConnectedDevice: vi.fn(),
    refreshDeviceState: vi.fn().mockResolvedValue(undefined),
    showToast: vi.fn(),
    language: 'en'
  }
}

function installIpc(initial: ReturnType<typeof deferred<SetupExperimentSnapshot>>): {
  invoke: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  unsubscribe: ReturnType<typeof vi.fn>
  listener(): SnapshotListener
} {
  const library: SetupLibraryResult = { root: 'C:\\fixed\\setups', items: [] }
  const unsubscribe = vi.fn()
  let updatedListener: SnapshotListener | undefined
  const invoke = vi.fn((channel: string): Promise<unknown> => {
    if (channel === SETUP_EXPERIMENT_CHANNELS.getSnapshot) return initial.promise
    if (channel === SETUP_MANAGER_CHANNELS.libraryList) return Promise.resolve(library)
    return Promise.reject(new Error(`Unexpected IPC invoke channel: ${channel}`))
  })
  const subscribe = vi.fn((channel: string, callback: SnapshotListener): (() => void) => {
    if (channel !== SETUP_EXPERIMENT_CHANNELS.updated) {
      throw new Error(`Unexpected IPC subscribe channel: ${channel}`)
    }
    updatedListener = callback
    return unsubscribe
  })
  Object.defineProperty(window, 'ipc', {
    configurable: true,
    value: { invoke, subscribe } as unknown as IpcBridge
  })
  return {
    invoke,
    subscribe,
    unsubscribe,
    listener: () => {
      expect(updatedListener).toBeTypeOf('function')
      return updatedListener as SnapshotListener
    }
  }
}

async function renderView(initial: ReturnType<typeof deferred<SetupExperimentSnapshot>>) {
  const ipc = installIpc(initial)
  const rendered = render(createElement(SetupExperimentView, props()))
  await waitFor(() => {
    expect(ipc.invoke).toHaveBeenCalledWith(SETUP_EXPERIMENT_CHANNELS.getSnapshot)
    expect(ipc.invoke).toHaveBeenCalledWith(SETUP_MANAGER_CHANNELS.libraryList)
    expect(ipc.subscribe).toHaveBeenCalledOnce()
    expect(ipc.subscribe).toHaveBeenCalledWith(
      SETUP_EXPERIMENT_CHANNELS.updated,
      expect.any(Function)
    )
  })
  return { ...rendered, ...ipc }
}

async function emit(listener: SnapshotListener, value: SetupExperimentSnapshot): Promise<void> {
  await act(async () => {
    listener(value)
  })
}

async function hydrate(
  initial: ReturnType<typeof deferred<SetupExperimentSnapshot>>,
  value: SetupExperimentSnapshot
): Promise<void> {
  await act(async () => {
    initial.resolve(value)
    await initial.promise
  })
}

afterEach(() => {
  cleanup()
})

describe('SetupExperimentView revision arbitration', () => {
  it('keeps LIVE REVISION 2 when delayed hydration resolves STALE REVISION 1', async () => {
    const initial = deferred<SetupExperimentSnapshot>()
    const target = await renderView(initial)

    await emit(target.listener(), namedSnapshot(2, 'live-2', 'LIVE REVISION 2'))
    expect(screen.queryByText('LIVE REVISION 2')).not.toBeNull()

    await hydrate(initial, namedSnapshot(1, 'stale-1', 'STALE REVISION 1'))

    expect(screen.queryByText('LIVE REVISION 2')).not.toBeNull()
    expect(screen.queryByText('STALE REVISION 1')).toBeNull()
  })

  it('lets the live payload win when hydration and subscription have equal revision', async () => {
    const initial = deferred<SetupExperimentSnapshot>()
    const target = await renderView(initial)

    await emit(target.listener(), namedSnapshot(5, 'live-5', 'LIVE EQUAL REVISION 5'))
    await hydrate(initial, namedSnapshot(5, 'hydrated-5', 'HYDRATED EQUAL REVISION 5'))

    expect(screen.queryByText('LIVE EQUAL REVISION 5')).not.toBeNull()
    expect(screen.queryByText('HYDRATED EQUAL REVISION 5')).toBeNull()
  })

  it('ignores an older broadcast delivered after a newer revision', async () => {
    const initial = deferred<SetupExperimentSnapshot>()
    const target = await renderView(initial)
    await hydrate(initial, namedSnapshot(3, 'hydrated-3', 'HYDRATED REVISION 3'))

    await emit(target.listener(), namedSnapshot(5, 'newer-5', 'NEWER REVISION 5'))
    await emit(target.listener(), namedSnapshot(4, 'older-4', 'OLDER REVISION 4'))

    expect(screen.queryByText('NEWER REVISION 5')).not.toBeNull()
    expect(screen.queryByText('OLDER REVISION 4')).toBeNull()
    expect(screen.queryByText('HYDRATED REVISION 3')).toBeNull()
  })

  it('does not let an unrevisioned hydration replace revisioned live state', async () => {
    const initial = deferred<SetupExperimentSnapshot>()
    const target = await renderView(initial)

    await emit(target.listener(), namedSnapshot(2, 'revisioned-live', 'REVISIONED LIVE STATE'))
    await hydrate(initial, namedSnapshot(undefined, 'unknown-hydration', 'UNREVISIONED HYDRATION'))

    expect(screen.queryByText('REVISIONED LIVE STATE')).not.toBeNull()
    expect(screen.queryByText('UNREVISIONED HYDRATION')).toBeNull()
  })

  it('unsubscribes setupExperiment updated exactly once on unmount', async () => {
    const initial = deferred<SetupExperimentSnapshot>()
    const target = await renderView(initial)
    await hydrate(initial, snapshot(1))

    expect(target.subscribe).toHaveBeenCalledOnce()
    expect(target.subscribe).toHaveBeenCalledWith(
      SETUP_EXPERIMENT_CHANNELS.updated,
      expect.any(Function)
    )

    target.unmount()

    expect(target.unsubscribe).toHaveBeenCalledOnce()
  })

  it('surfaces corrupt-store source path code and quarantine status from the snapshot', async () => {
    const initial = deferred<SetupExperimentSnapshot>()
    await renderView(initial)
    const corrupt = snapshot(7) as RuntimeSnapshot
    corrupt.state.storageIssues = [{
      kind: 'corrupt-store',
      sourcePath: 'C:\\Users\\fixed\\setup-experiments.json',
      code: 'corrupt-json',
      quarantinePath: 'C:\\Users\\fixed\\setup-experiments.json.corrupt-20260717',
      quarantineStatus: 'quarantined',
      message: 'The setup experiment store contained invalid JSON.'
    }]

    await hydrate(initial, corrupt)

    const visibleText = document.body.textContent ?? ''
    expect.soft(visibleText).toContain('C:\\Users\\fixed\\setup-experiments.json')
    expect.soft(visibleText).toContain('corrupt-json')
    expect.soft(visibleText).toMatch(/\bquarantined\b/i)
    expect.soft(visibleText).not.toContain('No local setup experiments yet.')
  })

  it('surfaces retained pending-lap evidence when local persistence retries fail', async () => {
    const initial = deferred<SetupExperimentSnapshot>()
    await renderView(initial)
    const pending = snapshot(9)
    pending.activeCapture = {
      experimentId: 'pending-experiment',
      runId: 'pending-run',
      arm: 'A1',
      pendingLapCount: 1,
      persistenceError: 'fixed EIO while replacing the local store'
    }

    await hydrate(initial, pending)

    expect(screen.queryByText(/waiting for local persistence/i)).not.toBeNull()
    expect(screen.queryByText(/fixed EIO/i)).not.toBeNull()
    expect(screen.queryByText(/1 lap/i)).not.toBeNull()
  })

  it('uses agreement and conflict for raw rollback copy and reserves confirmation for confirmatory evidence', async () => {
    const initial = deferred<SetupExperimentSnapshot>()
    await renderView(initial)
    const agreement = experiment('raw-agreement', 'RAW A2 MATCH')
    const conflict = experiment('raw-conflict', 'RAW A2 DIVERGENCE')
    const confirmatory = experiment('strong-agreement', 'STRONG A2 MATCH')
    const agreementAnalysis = Object.assign(analysis() as RuntimeAnalysis, {
      evidenceStrength: 'exploratory' as const,
      exploratoryDirection: 'variant' as const,
      rollbackRelation: 'agreement' as const
    })
    const conflictAnalysis = Object.assign(analysis() as RuntimeAnalysis, {
      evidenceStrength: 'exploratory' as const,
      exploratoryDirection: 'variant' as const,
      rollbackRelation: 'conflict' as const
    })
    const confirmatoryAnalysis = Object.assign(analysis() as RuntimeAnalysis, {
      evidenceStrength: 'confirmatory' as const,
      exploratoryDirection: 'variant' as const,
      rollbackRelation: 'agreement' as const
    })
    const evidenceSnapshot = snapshot(
      8,
      [agreement, conflict, confirmatory],
      {
        [agreement.id]: agreementAnalysis,
        [conflict.id]: conflictAnalysis,
        [confirmatory.id]: confirmatoryAnalysis
      }
    )

    await hydrate(initial, evidenceSnapshot)

    const agreementArticle = screen.getByText(agreement.name).closest('article')
    const conflictArticle = screen.getByText(conflict.name).closest('article')
    const confirmatoryArticle = screen.getByText(confirmatory.name).closest('article')
    expect(agreementArticle).not.toBeNull()
    expect(conflictArticle).not.toBeNull()
    expect(confirmatoryArticle).not.toBeNull()

    const agreementText = within(agreementArticle as HTMLElement).getByRole('heading').parentElement
      ?.parentElement?.parentElement?.textContent ?? agreementArticle?.textContent ?? ''
    const conflictText = conflictArticle?.textContent ?? ''
    const confirmatoryText = confirmatoryArticle?.textContent ?? ''
    expect.soft(agreementText).toMatch(/\brollback agreement\b/i)
    expect.soft(conflictText).toMatch(/\brollback conflict\b/i)
    expect.soft(agreementText).not.toMatch(/\bconfirm(?:ed|ation|atory)\b/i)
    expect.soft(conflictText).not.toMatch(/\bconfirm(?:ed|ation|atory)\b/i)
    expect.soft(confirmatoryText).toMatch(/\bconfirm(?:ed|ation|atory)\b/i)
  })
})
