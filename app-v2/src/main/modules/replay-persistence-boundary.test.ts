import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {
  mkdir,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GracefulTeardownPhase, ModuleContext } from '../module-context'
import type {
  RecordingSessionSummary,
  RecordingStartOptions,
  RecordingStatus
} from '../../shared/recording'
import {
  captureLiveTelemetryContext,
  type LiveTelemetryContext
} from '../../shared/replay'
import {
  DEBRIEF_CHANNELS,
  type DebriefTriggerPayload,
  type StintDebrief
} from '../../shared/stint-debrief'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import {
  PaceModelStore,
  type PaceModelPersistence
} from './pace-model'
import {
  RecordingLifecycleCoordinator,
  SessionEnricher,
  type RecordingLifecycleRecorder,
  type RecordingReconcileTarget,
  type RecordingSessionEnricher,
  register as registerRecordingAnalysis
} from './recording-analysis'
import { register as registerStintDebrief } from './stint-debrief'
import {
  TelemetryRecorder,
  type TelemetryRecorderLifecycle
} from '../recording/recorder'

vi.mock('electron', () => ({
  app: {},
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openPath: vi.fn(async () => '') }
}))

const scratchDirs: string[] = []

afterEach(() => {
  vi.useRealTimers()
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(name: string): string {
  const dir = join(process.cwd(), `.replay-persistence-${name}-${process.pid}-${Date.now()}-${scratchDirs.length}`)
  mkdirSync(dir, { recursive: true })
  scratchDirs.push(dir)
  return dir
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function snapshot(
  sessionIdentity: string,
  trackName: string,
  revision = 0,
  overrides: Partial<TelemetrySnapshot> = {}
): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1_000 + revision * 100,
    speedKmh: 180,
    rpm: 7_000,
    gear: 4,
    throttle: 0.8,
    brake: 0,
    clutch: 0,
    currentLap: 1,
    lapDistPct: 0.2,
    sessionType: 'Race',
    trackName,
    trackConfigName: 'Grand Prix',
    carName: 'GT3 R',
    replayContext: {
      state: 'live',
      reason: 'confirmed-live',
      inputs: {},
      active: false,
      revision,
      token: `token-${sessionIdentity}-${revision}`,
      sessionIdentity,
      connectionEpoch: 1
    },
    ...overrides
  }
}

function target(snap: TelemetrySnapshot, recording = true): RecordingReconcileTarget {
  return {
    mode: 'live',
    recording,
    context: captureLiveTelemetryContext(snap),
    snapshot: snap,
    options: { sampleRateHz: 15 }
  }
}

class FakeRecorder implements RecordingLifecycleRecorder {
  active: RecordingSessionSummary | null = null
  accepting = true
  failStarts = 0
  stopGate: Promise<void> | null = null
  readonly starts: string[] = []
  readonly deleted: string[] = []
  readonly samples: Array<{ sessionId: string; trackName?: string }> = []
  stopCalls = 0

  status(): RecordingStatus {
    return { recording: this.active !== null, activeSession: this.active }
  }

  async start(
    options: RecordingStartOptions = {},
    isCurrent: () => boolean = () => true,
    contextKey: string | null = null
  ): Promise<RecordingStatus> {
    if (!this.accepting) throw new Error('closed')
    const label = contextKey?.split(':').at(-1) || `start-${this.starts.length + 1}`
    this.starts.push(label)
    if (this.failStarts > 0) {
      this.failStarts -= 1
      throw new Error('prepare failed')
    }
    if (!isCurrent()) return this.status()
    this.active = {
      id: `recording-${label}`,
      source: 'none',
      startedAt: Date.now(),
      sampleRateHz: options.sampleRateHz ?? 15,
      sampleCount: 0,
      lapCount: 0,
      laps: []
    }
    return this.status()
  }

  cancelPendingStart(): void {}

  async settlePendingStart(): Promise<void> {}

  quiesce(): void {
    this.accepting = false
  }

  async stop(): Promise<RecordingStatus> {
    this.stopCalls += 1
    if (this.stopGate) await this.stopGate
    this.active = null
    return this.status()
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.deleted.push(sessionId)
  }

  onSnapshot(snap: TelemetrySnapshot | null): void {
    if (this.active && snap) {
      this.samples.push({ sessionId: this.active.id, trackName: snap.trackName })
    }
  }
}

class FakeEnricher implements RecordingSessionEnricher {
  readonly finalized: string[] = []
  readonly forgotten: string[] = []
  readonly observed: Array<{ sessionId: string; trackName?: string }> = []
  finalizeGate: Promise<void> | null = null
  quiesced = false

  observe(sessionId: string, snap: TelemetrySnapshot | null): void {
    this.observed.push({ sessionId, trackName: snap?.trackName })
  }

  async finalize(sessionId: string): Promise<void> {
    this.finalized.push(sessionId)
    if (this.finalizeGate) await this.finalizeGate
  }

  async forget(sessionId: string): Promise<void> {
    this.forgotten.push(sessionId)
  }

  pause(): void {}

  resume(): void {}

  closeIntake(): void {
    this.quiesced = true
  }

  async quiesce(): Promise<void> {
    this.closeIntake()
  }
}

function coordinatorHarness() {
  const recorder = new FakeRecorder()
  const enricher = new FakeEnricher()
  const failures = vi.fn()
  let latest: TelemetrySnapshot | null = null
  const coordinator = new RecordingLifecycleCoordinator(
    recorder,
    enricher,
    () => latest,
    vi.fn(),
    failures
  )
  return {
    recorder,
    enricher,
    failures,
    coordinator,
    setLatest(snap: TelemetrySnapshot | null) {
      latest = snap
    }
  }
}

function moduleHarness(userData: string) {
  const handlers = new Map<string, (...args: any[]) => any>()
  const listeners: Array<(snap: TelemetrySnapshot | null) => void> = []
  const broadcast = vi.fn()
  const teardowns: Array<{
    phase: GracefulTeardownPhase
    task: () => Promise<void> | void
  }> = []
  let latest: TelemetrySnapshot | null = null
  const ctx = {
    app: { getPath: () => userData, getVersion: () => 'test', getLocale: () => 'en-US' },
    ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler) },
    telemetryHub: {
      on: (event: string, listener: (snap: TelemetrySnapshot | null) => void) => {
        if (event === 'snapshot') listeners.push(listener)
      },
      getLatest: () => latest
    },
    broadcast,
    getMainWindow: () => null,
    registerGracefulTeardown: (
      task: () => Promise<void> | void,
      phase: GracefulTeardownPhase = 'persistence'
    ) => {
      teardowns.push({ phase, task })
      return () => undefined
    }
  } as unknown as ModuleContext
  return {
    ctx,
    handlers,
    broadcast,
    teardowns,
    emit(snap: TelemetrySnapshot | null) {
      latest = snap
      for (const listener of listeners) listener(snap)
    },
    async teardown(phase: GracefulTeardownPhase) {
      for (const entry of teardowns.filter((item) => item.phase === phase)) await entry.task()
    }
  }
}

describe('recording persistence lifecycle', () => {
  it('keeps the automatic queue resolved after an I/O rejection and retries without unhandled rejection', async () => {
    const harness = coordinatorHarness()
    const live = snapshot('A', 'Track A')
    harness.setLatest(live)
    harness.recorder.failStarts = 1
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      harness.coordinator.requestAutomatic(target(live), 'automatic recording start')
      await harness.coordinator.whenIdle()
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(harness.failures).toHaveBeenCalledWith(
        'automatic recording start',
        expect.objectContaining({ message: 'prepare failed' })
      )
      expect(unhandled).not.toHaveBeenCalled()

      harness.coordinator.requestAutomatic(target(live), 'automatic recording retry')
      await harness.coordinator.whenIdle()
      expect(harness.recorder.status().recording).toBe(true)
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('waits for active recording finalization during shutdown', async () => {
    const harness = coordinatorHarness()
    const live = snapshot('A', 'Track A')
    harness.setLatest(live)
    await harness.coordinator.requestUser(target(live), 'user recording start')
    const stopGate = deferred()
    harness.recorder.stopGate = stopGate.promise

    harness.coordinator.quiesce()
    const shutdown = harness.coordinator.shutdown()
    await vi.waitFor(() => expect(harness.recorder.stopCalls).toBe(1))
    let settled = false
    void shutdown.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(harness.enricher.finalized).toEqual([])

    stopGate.resolve()
    await shutdown
    expect(harness.recorder.status().recording).toBe(false)
    expect(harness.enricher.finalized).toEqual(['recording-A'])
    expect(harness.enricher.quiesced).toBe(true)
  })

  it('tombstones a deleted session before settling a stale sidecar tail and never recreates it', async () => {
    vi.useFakeTimers()
    const root = scratch('sidecar-delete-race')
    const sessionId = 'deleted-session'
    const sessionDir = join(root, 'recordings', sessionId)
    await mkdir(sessionDir, { recursive: true })
    await writeFile(join(sessionDir, 'session.json'), '{}\n', 'utf8')
    const writeStarted = deferred()
    const releaseWrite = deferred()
    let writeCount = 0
    const enricher = new SessionEnricher(root, async (id, entry) => {
      writeCount += 1
      writeStarted.resolve()
      await releaseWrite.promise
      const dir = join(root, 'recordings', id)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'track.json'), JSON.stringify(entry), 'utf8')
    })
    const recorder = new TelemetryRecorder(root)
    const coordinator = new RecordingLifecycleCoordinator(
      recorder,
      enricher,
      () => null,
      vi.fn(),
      vi.fn()
    )

    enricher.observe(sessionId, snapshot('A', 'Track A'))
    await vi.advanceTimersByTimeAsync(500)
    await writeStarted.promise
    const deleting = coordinator.deleteSession(sessionId)
    enricher.observe(sessionId, snapshot('A', 'Track B', 1))
    await vi.advanceTimersByTimeAsync(500)

    let deleted = false
    void deleting.then(() => {
      deleted = true
    })
    await Promise.resolve()
    expect(deleted).toBe(false)
    expect(existsSync(sessionDir)).toBe(true)

    releaseWrite.resolve()
    await deleting
    enricher.observe(sessionId, snapshot('A', 'Track C', 2))
    coordinator.quiesce()
    await coordinator.shutdown()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(writeCount).toBe(1)
    expect(existsSync(sessionDir)).toBe(false)
  })

  it('rejects active recording deletion before tombstoning sidecar state', async () => {
    const harness = coordinatorHarness()
    harness.recorder.active = {
      id: 'active-session',
      source: 'none',
      startedAt: Date.now(),
      sampleRateHz: 15,
      sampleCount: 0,
      lapCount: 0,
      laps: []
    }

    await expect(harness.coordinator.deleteSession('active-session')).rejects.toThrow(
      'Cannot delete an active recording'
    )
    expect(harness.enricher.forgotten).toEqual([])
    expect(harness.recorder.deleted).toEqual([])
  })

  it('launches a replacement start with new options after the cancelled generation rolls back', async () => {
    const root = scratch('cancelled-start')
    const firstPrepare = deferred()
    let prepareCount = 0
    const removeSession = vi.fn(async (dir: string) => {
      await rm(dir, { recursive: true, force: true })
    })
    const recorderLifecycle: TelemetryRecorderLifecycle = {
      prepareSession: vi.fn(async () => {
        prepareCount += 1
        if (prepareCount === 1) await firstPrepare.promise
      }),
      removeSession
    }
    const recorder = new TelemetryRecorder(root, recorderLifecycle)

    const cancelled = recorder.start({ sampleRateHz: 5 }, () => true, 'context-A')
    await vi.waitFor(() => expect(recorderLifecycle.prepareSession).toHaveBeenCalledTimes(1))
    recorder.cancelPendingStart()
    const replacement = recorder.start({ sampleRateHz: 30 }, () => true, 'context-B')
    await Promise.resolve()
    expect(recorderLifecycle.prepareSession).toHaveBeenCalledTimes(1)

    firstPrepare.resolve()
    await expect(cancelled).resolves.toMatchObject({ recording: false })
    await expect(replacement).resolves.toMatchObject({
      recording: true,
      activeSession: { sampleRateHz: 30 }
    })
    expect(recorderLifecycle.prepareSession).toHaveBeenCalledTimes(2)
    expect(removeSession).toHaveBeenCalledTimes(1)
    await recorder.stop()
  })

  it('coalesces blocked A to B to C reconciliation and never records the stale B context', async () => {
    const harness = coordinatorHarness()
    const a = snapshot('A', 'Track A')
    const b = snapshot('B', 'Track B', 1)
    const c = snapshot('C', 'Track C', 2)
    harness.setLatest(a)
    await harness.coordinator.requestUser(target(a), 'start A')
    harness.coordinator.observeLiveSnapshot(a, captureLiveTelemetryContext(a) as LiveTelemetryContext)

    const finalizeGate = deferred()
    harness.enricher.finalizeGate = finalizeGate.promise
    harness.setLatest(b)
    harness.coordinator.requestAutomatic(target(b), 'rotate B')
    await vi.waitFor(() => expect(harness.enricher.finalized).toContain('recording-A'))

    harness.setLatest(c)
    harness.coordinator.requestAutomatic(target(c), 'rotate C')
    finalizeGate.resolve()
    await harness.coordinator.whenIdle()

    expect(harness.recorder.starts).toEqual(['A', 'C'])
    expect(harness.recorder.status().activeSession?.id).toBe('recording-C')
    expect(harness.recorder.samples.map((sample) => sample.trackName)).toEqual(['Track A', 'Track C'])
    expect(harness.enricher.observed.map((sample) => sample.trackName)).toEqual(['Track A', 'Track C'])
  })

  it('cancels a blocked B prepare and launches the latest C recording with the real recorder', async () => {
    const root = scratch('prepare-coalescing')
    const prepareB = deferred()
    const prepared: string[] = []
    const removed: string[] = []
    const recorder = new TelemetryRecorder(root, {
      prepareSession: async (dir) => {
        prepared.push(dir)
        await mkdir(dir, { recursive: true })
        if (prepared.length === 2) await prepareB.promise
      },
      removeSession: async (dir) => {
        removed.push(dir)
        await rm(dir, { recursive: true, force: true })
      }
    })
    const enricher = new FakeEnricher()
    let latest: TelemetrySnapshot | null = null
    const coordinator = new RecordingLifecycleCoordinator(
      recorder,
      enricher,
      () => latest,
      vi.fn(),
      vi.fn()
    )
    const a = snapshot('A', 'Track A')
    const b = snapshot('B', 'Track B', 1)
    const c = snapshot('C', 'Track C', 2)
    latest = a
    await coordinator.requestUser(target(a), 'start A')
    coordinator.observeLiveSnapshot(a, captureLiveTelemetryContext(a) as LiveTelemetryContext)

    latest = b
    coordinator.requestAutomatic(target(b), 'rotate B')
    await vi.waitFor(() => expect(prepared).toHaveLength(2))
    latest = c
    coordinator.requestAutomatic(target(c), 'rotate C')
    prepareB.resolve()
    await coordinator.whenIdle()

    expect(prepared).toHaveLength(3)
    expect(removed).toContain(prepared[1])
    expect(recorder.status().activeSession?.id).toBe(basename(prepared[2]))
    expect(enricher.observed.map((sample) => sample.trackName)).toEqual(['Track A', 'Track C'])

    coordinator.quiesce()
    await coordinator.shutdown()
  })

  it('registers quiesce/persistence teardown and finalizes active metadata plus sidecar', async () => {
    const root = scratch('registered-shutdown')
    writeFileSync(join(root, 'recording-config.json'), JSON.stringify({ autoRecord: false }), 'utf8')
    const harness = moduleHarness(root)
    registerRecordingAnalysis(harness.ctx)
    await new Promise<void>((resolve) => setImmediate(resolve))
    const live = snapshot('A', 'Track A', 0, { timestamp: 2_000, lapDistPct: 0.3 })
    harness.emit(live)
    await harness.handlers.get('recording:start')?.(undefined, { sampleRateHz: 10 })
    const sessionId = (harness.handlers.get('recording:status')?.() as RecordingStatus).activeSession?.id
    expect(sessionId).toBeTruthy()
    harness.emit(snapshot('A', 'Track A', 0, { timestamp: 2_100, lapDistPct: 0.4 }))

    expect(harness.teardowns.map((entry) => entry.phase)).toEqual(['quiesce', 'persistence'])
    await harness.teardown('quiesce')
    await harness.teardown('persistence')

    expect((harness.handlers.get('recording:status')?.() as RecordingStatus).recording).toBe(false)
    const metadata = JSON.parse(
      readFileSync(join(root, 'recordings', sessionId as string, 'session.json'), 'utf8')
    ) as RecordingSessionSummary
    expect(metadata.endedAt).toBeTypeOf('number')
    expect(JSON.parse(
      readFileSync(join(root, 'recordings', sessionId as string, 'track.json'), 'utf8')
    )).toMatchObject({ trackName: 'Track A', carName: 'GT3 R' })
  })

  it('serializes a fired debounce write before final sidecar state and drains it on quiesce', async () => {
    vi.useFakeTimers()
    const firstWriteStarted = deferred()
    const releaseFirstWrite = deferred()
    const writeStarts: string[] = []
    let persistedTrack: string | undefined
    const enricher = new SessionEnricher(scratch('sidecar-chain'), async (_sessionId, entry) => {
      writeStarts.push(entry.trackName ?? '')
      if (writeStarts.length === 1) {
        firstWriteStarted.resolve()
        await releaseFirstWrite.promise
      }
      persistedTrack = entry.trackName
    })
    const sessionId = 'session-sidecar'
    enricher.observe(sessionId, snapshot('A', 'Track A'))
    await vi.advanceTimersByTimeAsync(500)
    await firstWriteStarted.promise
    expect(writeStarts).toEqual(['Track A'])

    enricher.observe(sessionId, snapshot('A', 'Track B', 1))
    const finalizing = enricher.finalize(sessionId)
    enricher.closeIntake()
    const draining = enricher.quiesce()
    let drained = false
    void draining.then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)

    releaseFirstWrite.resolve()
    await Promise.all([finalizing, draining])
    expect(writeStarts).toEqual(['Track A', 'Track B'])
    expect(persistedTrack).toBe('Track B')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(writeStarts).toEqual(['Track A', 'Track B'])
  })

  it('purges sidecar cache, tail, and timer after successful finalization', async () => {
    vi.useFakeTimers()
    const writes: string[] = []
    const enricher = new SessionEnricher(scratch('sidecar-purge'), async (_sessionId, entry) => {
      writes.push(entry.trackName ?? '')
    })
    const sessionId = 'session-purge'
    enricher.observe(sessionId, snapshot('A', 'Track A'))

    await enricher.finalize(sessionId)
    const internals = enricher as unknown as {
      pending: Map<string, NodeJS.Timeout>
      cache: Map<string, unknown>
      writeTails: Map<string, Promise<void>>
    }
    expect(internals.pending.has(sessionId)).toBe(false)
    expect(internals.cache.has(sessionId)).toBe(false)
    expect(internals.writeTails.has(sessionId)).toBe(false)

    enricher.observe(sessionId, snapshot('A', 'Track B', 1))
    await enricher.quiesce()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(writes).toEqual(['Track A'])
  })

  it('remembers queued sample loss and rejects shutdown only after sidecar draining completes', async () => {
    const root = scratch('recording-write-loss')
    const recorder = new TelemetryRecorder(root)
    const live = snapshot('A', 'Track A', 0, { timestamp: 2_000, lapDistPct: 0.3 })
    await recorder.start({ sampleRateHz: 15 })
    const sessionId = recorder.status().activeSession?.id
    expect(sessionId).toBeTruthy()
    await mkdir(join(root, 'recordings', sessionId as string, 'samples.jsonl'))
    recorder.onSnapshot(live)

    const sidecarStarted = deferred()
    const releaseSidecar = deferred()
    let sidecarDrained = false
    const enricher = new SessionEnricher(root, async () => {
      sidecarStarted.resolve()
      await releaseSidecar.promise
      sidecarDrained = true
    })
    enricher.observe(sessionId as string, live)
    const coordinator = new RecordingLifecycleCoordinator(
      recorder,
      enricher,
      () => live,
      vi.fn(),
      vi.fn()
    )

    coordinator.quiesce()
    const shutdown = coordinator.shutdown()
    await sidecarStarted.promise
    let settled = false
    void shutdown.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await Promise.resolve()
    expect(settled).toBe(false)

    releaseSidecar.resolve()
    let failure: unknown
    try {
      await shutdown
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors.some(
      (error) => error instanceof Error && error.message.includes('Recording I/O failed')
    )).toBe(true)
    expect(sidecarDrained).toBe(true)
    expect(recorder.status().recording).toBe(false)
    expect(JSON.parse(
      readFileSync(join(root, 'recordings', sessionId as string, 'session.json'), 'utf8')
    )).toMatchObject({ endedAt: expect.any(Number) })
  })
})

describe('pace persistence versions and quiescence', () => {
  it('does not restore failed payload A after newer payload B is queued and persisted', async () => {
    const root = scratch('pace-version')
    const file = join(root, 'pace-models.json')
    const firstWriteStarted = deferred()
    const releaseFirstWrite = deferred()
    let writeCount = 0
    const persistence: PaceModelPersistence = {
      mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
      writeFile: async (path, payload) => {
        writeCount += 1
        if (writeCount === 1) {
          firstWriteStarted.resolve()
          await releaseFirstWrite.promise
          throw new Error('A failed')
        }
        await writeFile(path, payload, 'utf8')
      },
      rename,
      remove: (path) => rm(path, { force: true })
    }
    const store = new PaceModelStore({} as ModuleContext, file, persistence)
    await store.load()
    store.onSnapshot(snapshot('A', 'Track A', 0, { currentLap: 1, incidentCountMy: 0 }))
    store.onSnapshot(snapshot('A', 'Track A', 0, {
      currentLap: 2,
      lastLapTimeSec: 90,
      incidentCountMy: 0
    }))
    const flushA = store.flush()
    await firstWriteStarted.promise

    store.onSnapshot(snapshot('A', 'Track A', 0, {
      currentLap: 3,
      lastLapTimeSec: 91,
      incidentCountMy: 0
    }))
    expect(store.status().activeSamples).toBe(2)
    const flushB = store.flush()
    releaseFirstWrite.resolve()
    await Promise.all([flushA, flushB])

    const persisted = JSON.parse(readFileSync(file, 'utf8')) as {
      models: Record<string, { n: number }>
    }
    expect(Object.values(persisted.models)[0]?.n).toBe(2)
    await store.dispose()
    expect(Object.values(
      (JSON.parse(readFileSync(file, 'utf8')) as { models: Record<string, { n: number }> }).models
    )[0]?.n).toBe(2)
  })

  it('ignores telemetry that arrives after quiesce before the final flush', async () => {
    const root = scratch('pace-quiesce')
    const file = join(root, 'pace-models.json')
    const store = new PaceModelStore({} as ModuleContext, file)
    await store.load()
    store.onSnapshot(snapshot('A', 'Track A', 0, { currentLap: 1, incidentCountMy: 0 }))
    store.onSnapshot(snapshot('A', 'Track A', 0, {
      currentLap: 2,
      lastLapTimeSec: 90,
      incidentCountMy: 0
    }))
    store.quiesce()
    store.onSnapshot(snapshot('A', 'Track A', 0, {
      currentLap: 3,
      lastLapTimeSec: 91,
      incidentCountMy: 0
    }))
    expect(store.status().activeSamples).toBe(1)

    await store.dispose()
    const persisted = JSON.parse(readFileSync(file, 'utf8')) as {
      models: Record<string, { n: number }>
    }
    expect(Object.values(persisted.models)[0]?.n).toBe(1)
  })
})

describe('main-owned stint debrief persistence', () => {
  it('uses ended non-iRacing metadata and generates while the Coach view is unmounted', async () => {
    const root = scratch('debrief-main')
    const harness = moduleHarness(root)
    registerStintDebrief(harness.ctx)
    const ended = {
      ...snapshot('legacy', 'Old Track', 0, {
        sim: 'acc',
        sessionUniqueId: 7,
        completedLaps: 12,
        bestLapTimeSec: 91.2
      }),
      replayContext: undefined
    }
    const next = {
      ...snapshot('legacy', 'New Track', 1, {
        sim: 'acc',
        sessionUniqueId: 7,
        completedLaps: 0,
        bestLapTimeSec: undefined
      }),
      replayContext: undefined
    }
    harness.emit(ended)
    harness.emit(next)
    await vi.waitFor(() => {
      expect(harness.broadcast).toHaveBeenCalledWith(DEBRIEF_CHANNELS.updated, expect.anything())
    })

    const trigger = harness.broadcast.mock.calls.find(
      ([channel]) => channel === DEBRIEF_CHANNELS.trigger
    )?.[1] as DebriefTriggerPayload
    const updated = harness.broadcast.mock.calls.find(
      ([channel]) => channel === DEBRIEF_CHANNELS.updated
    )?.[1] as StintDebrief
    expect(trigger.sessionInfo).toMatchObject({
      trackName: 'Old Track',
      carName: 'GT3 R',
      lapsCompleted: 12,
      bestLapTimeSec: 91.2,
      reason: 'session-end'
    })
    expect(updated).toMatchObject({
      reason: 'session-end',
      source: 'deterministic',
      sessionInfo: { trackName: 'Old Track', lapsCompleted: 12 }
    })
    await expect(harness.handlers.get(DEBRIEF_CHANNELS.last)?.()).resolves.toEqual(updated)

    await harness.teardown('quiesce')
    await harness.teardown('persistence')
    expect(existsSync(join(root, 'stint-debrief.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(root, 'stint-debrief.json'), 'utf8'))).toMatchObject({
      reason: 'session-end',
      sessionInfo: { trackName: 'Old Track', lapsCompleted: 12 }
    })

    const reload = moduleHarness(root)
    registerStintDebrief(reload.ctx)
    await expect(reload.handlers.get(DEBRIEF_CHANNELS.last)?.()).resolves.toMatchObject({
      reason: 'session-end',
      sessionInfo: { trackName: 'Old Track', lapsCompleted: 12 }
    })
    await reload.teardown('quiesce')
    await reload.teardown('persistence')
  })

  it('waits for an accepted trigger to become durable before returning the latest debrief', async () => {
    const root = scratch('debrief-visible-after-trigger')
    const harness = moduleHarness(root)
    const triggerWriteStarted = deferred()
    const releaseTriggerWrite = deferred()
    let writeAttempts = 0
    registerStintDebrief(harness.ctx, {
      writePersisted: async (filePath, payload) => {
        writeAttempts += 1
        if (writeAttempts === 2) {
          triggerWriteStarted.resolve()
          await releaseTriggerWrite.promise
        }
        await writeFile(filePath, payload, 'utf8')
      }
    })
    await harness.handlers.get(DEBRIEF_CHANNELS.generate)?.(undefined, {
      sessionInfo: { trackName: 'Previous Manual Track', reason: 'manual' }
    })

    harness.emit(snapshot('visible', 'Track C', 0, { completedLaps: 9 }))
    harness.emit(null)
    const latestRequest = harness.handlers.get(DEBRIEF_CHANNELS.last)?.() as Promise<StintDebrief>
    await triggerWriteStarted.promise
    expect(JSON.parse(readFileSync(join(root, 'stint-debrief.json'), 'utf8'))).toMatchObject({
      reason: 'manual',
      sessionInfo: { trackName: 'Previous Manual Track' }
    })
    let settled = false
    void latestRequest.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await Promise.resolve()
    expect(settled).toBe(false)

    releaseTriggerWrite.resolve()
    await expect(latestRequest).resolves.toMatchObject({
      reason: 'session-end',
      sessionInfo: { trackName: 'Track C', reason: 'session-end' }
    })
    expect(JSON.parse(readFileSync(join(root, 'stint-debrief.json'), 'utf8'))).toMatchObject({
      reason: 'session-end',
      sessionInfo: { trackName: 'Track C', reason: 'session-end' }
    })
    await harness.teardown('quiesce')
    await harness.teardown('persistence')
  })

  it('surfaces an accepted trigger persistence failure instead of returning a stale debrief', async () => {
    const root = scratch('debrief-visible-failure')
    const harness = moduleHarness(root)
    let writeAttempts = 0
    registerStintDebrief(harness.ctx, {
      writePersisted: async (filePath, payload) => {
        writeAttempts += 1
        if (writeAttempts === 2) throw new Error('accepted trigger persistence failed')
        await writeFile(filePath, payload, 'utf8')
      }
    })
    await harness.handlers.get(DEBRIEF_CHANNELS.generate)?.(undefined, {
      sessionInfo: { trackName: 'Durable Manual Track', reason: 'manual' }
    })

    harness.emit(snapshot('failure', 'Failed Trigger Track', 0, { completedLaps: 6 }))
    harness.emit(null)
    await expect(
      harness.handlers.get(DEBRIEF_CHANNELS.last)?.()
    ).rejects.toThrow('accepted trigger persistence failed')
    expect(JSON.parse(readFileSync(join(root, 'stint-debrief.json'), 'utf8'))).toMatchObject({
      reason: 'manual',
      sessionInfo: { trackName: 'Durable Manual Track' }
    })

    await harness.teardown('quiesce')
    await harness.teardown('persistence')
    expect(writeAttempts).toBe(3)
    expect(JSON.parse(readFileSync(join(root, 'stint-debrief.json'), 'utf8'))).toMatchObject({
      reason: 'session-end',
      sessionInfo: { trackName: 'Failed Trigger Track' }
    })
    await expect(harness.handlers.get(DEBRIEF_CHANNELS.last)?.()).resolves.toMatchObject({
      reason: 'session-end',
      sessionInfo: { trackName: 'Failed Trigger Track' }
    })
  })

  it('follows a newer accepted operation when an older pending operation later fails', async () => {
    const root = scratch('debrief-superseded-failure')
    const harness = moduleHarness(root)
    const olderWriteStarted = deferred()
    const releaseOlderWrite = deferred()
    let writeAttempts = 0
    registerStintDebrief(harness.ctx, {
      writePersisted: async (filePath, payload) => {
        writeAttempts += 1
        if (writeAttempts === 2) {
          olderWriteStarted.resolve()
          await releaseOlderWrite.promise
          throw new Error('superseded debrief write failed')
        }
        await writeFile(filePath, payload, 'utf8')
      }
    })
    await harness.handlers.get(DEBRIEF_CHANNELS.generate)?.(undefined, {
      sessionInfo: { trackName: 'Baseline Track', reason: 'manual' }
    })

    harness.emit(snapshot('older', 'Older Trigger Track', 0, { completedLaps: 4 }))
    harness.emit(null)
    const latestRequest = harness.handlers.get(DEBRIEF_CHANNELS.last)?.() as Promise<StintDebrief>
    await olderWriteStarted.promise
    const newerGeneration = harness.handlers.get(DEBRIEF_CHANNELS.generate)?.(undefined, {
      sessionInfo: { trackName: 'Newer Accepted Track', reason: 'manual' }
    }) as Promise<StintDebrief>

    releaseOlderWrite.resolve()
    await expect(newerGeneration).resolves.toMatchObject({
      sessionInfo: { trackName: 'Newer Accepted Track' }
    })
    await expect(latestRequest).resolves.toMatchObject({
      reason: 'manual',
      sessionInfo: { trackName: 'Newer Accepted Track' }
    })
    expect(writeAttempts).toBe(3)
    expect(JSON.parse(readFileSync(join(root, 'stint-debrief.json'), 'utf8'))).toMatchObject({
      reason: 'manual',
      sessionInfo: { trackName: 'Newer Accepted Track' }
    })
    await harness.teardown('quiesce')
    await harness.teardown('persistence')
  })

  it('drains a pre-close request blocked on load without broadcasting during close', async () => {
    const root = scratch('debrief-load-drain')
    const harness = moduleHarness(root)
    const releaseLoad = deferred()
    registerStintDebrief(harness.ctx, {
      loadPersisted: async () => {
        await releaseLoad.promise
        return null
      },
      writePersisted: (filePath, payload) => writeFile(filePath, payload, 'utf8')
    })
    const generation = harness.handlers.get(DEBRIEF_CHANNELS.generate)?.(undefined, {
      sessionInfo: {
        trackName: 'Load Blocked Track',
        carName: 'GT3 R',
        lapsCompleted: 8,
        reason: 'session-end'
      }
    }) as Promise<StintDebrief>
    harness.broadcast.mockClear()

    await harness.teardown('quiesce')
    const persistence = harness.teardown('persistence')
    let settled = false
    void persistence.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await Promise.resolve()
    expect(settled).toBe(false)

    releaseLoad.resolve()
    await expect(generation).resolves.toMatchObject({
      source: 'deterministic',
      sessionInfo: { trackName: 'Load Blocked Track' }
    })
    await persistence
    expect(harness.broadcast).not.toHaveBeenCalledWith(DEBRIEF_CHANNELS.updated, expect.anything())
    expect(JSON.parse(readFileSync(join(root, 'stint-debrief.json'), 'utf8'))).toMatchObject({
      sessionInfo: { trackName: 'Load Blocked Track' }
    })
    await expect(
      harness.handlers.get(DEBRIEF_CHANNELS.generate)?.(undefined, { useLlm: false })
    ).rejects.toThrow('shutting down')
    await expect(harness.handlers.get(DEBRIEF_CHANNELS.last)?.()).resolves.toMatchObject({
      sessionInfo: { trackName: 'Load Blocked Track' }
    })
  })

  it('retries the latest failed debrief payload during teardown without broadcasting it', async () => {
    const root = scratch('debrief-write-retry')
    const harness = moduleHarness(root)
    const attemptedTracks: Array<string | undefined> = []
    registerStintDebrief(harness.ctx, {
      writePersisted: async (filePath, payload) => {
        const parsed = JSON.parse(payload) as StintDebrief
        attemptedTracks.push(parsed.sessionInfo?.trackName)
        if (attemptedTracks.length < 3) throw new Error('transient debrief write failure')
        await writeFile(filePath, payload, 'utf8')
      }
    })

    await expect(
      harness.handlers.get(DEBRIEF_CHANNELS.generate)?.(undefined, {
        sessionInfo: { trackName: 'Failed Track A', reason: 'session-end' }
      })
    ).rejects.toThrow('transient debrief write failure')
    await expect(
      harness.handlers.get(DEBRIEF_CHANNELS.generate)?.(undefined, {
        sessionInfo: { trackName: 'Latest Track B', reason: 'session-end' }
      })
    ).rejects.toThrow('transient debrief write failure')

    await harness.teardown('quiesce')
    await harness.teardown('persistence')
    expect(attemptedTracks).toEqual(['Failed Track A', 'Latest Track B', 'Latest Track B'])
    expect(harness.broadcast).not.toHaveBeenCalledWith(DEBRIEF_CHANNELS.updated, expect.anything())
    expect(JSON.parse(readFileSync(join(root, 'stint-debrief.json'), 'utf8'))).toMatchObject({
      sessionInfo: { trackName: 'Latest Track B' }
    })
  })

  it('rejects teardown after draining when the latest debrief remains non-durable', async () => {
    const root = scratch('debrief-write-persistent-failure')
    const harness = moduleHarness(root)
    const firstWriteStarted = deferred()
    const releaseFirstWrite = deferred()
    let writeAttempts = 0
    registerStintDebrief(harness.ctx, {
      writePersisted: async () => {
        writeAttempts += 1
        if (writeAttempts === 1) {
          firstWriteStarted.resolve()
          await releaseFirstWrite.promise
        }
        throw new Error('debrief storage unavailable')
      }
    })
    const generation = harness.handlers.get(DEBRIEF_CHANNELS.generate)?.(undefined, {
      sessionInfo: { trackName: 'Persistent Failure Track', reason: 'session-end' }
    }) as Promise<StintDebrief>
    await firstWriteStarted.promise
    harness.broadcast.mockClear()

    await harness.teardown('quiesce')
    const persistence = harness.teardown('persistence')
    let settled = false
    void persistence.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await Promise.resolve()
    expect(settled).toBe(false)

    releaseFirstWrite.resolve()
    await expect(generation).rejects.toThrow('debrief storage unavailable')
    await expect(persistence).rejects.toThrow('Stint debrief durability failed during teardown')
    await expect(
      harness.handlers.get(DEBRIEF_CHANNELS.last)?.()
    ).rejects.toThrow('debrief storage unavailable')
    expect(writeAttempts).toBe(2)
    expect(harness.broadcast).not.toHaveBeenCalledWith(DEBRIEF_CHANNELS.updated, expect.anything())
  })

  it('drains an accepted pending LLM composition and suppresses its late teardown broadcast', async () => {
    const root = scratch('debrief-inflight')
    const harness = moduleHarness(root)
    const phraseStarted = deferred()
    const releasePhrase = deferred()
    registerStintDebrief(harness.ctx, {
      phrase: async () => {
        phraseStarted.resolve()
        await releasePhrase.promise
        return 'Accepted debrief completed during teardown.'
      }
    })
    const generation = harness.handlers.get(DEBRIEF_CHANNELS.generate)?.(undefined, {
      useLlm: true,
      sessionInfo: {
        trackName: 'Endurance Track',
        carName: 'GT3 R',
        lapsCompleted: 20,
        reason: 'session-end'
      }
    }) as Promise<StintDebrief>
    await phraseStarted.promise
    harness.broadcast.mockClear()

    await harness.teardown('quiesce')
    const persistence = harness.teardown('persistence')
    let drained = false
    void persistence.then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)
    expect(harness.broadcast).not.toHaveBeenCalledWith(DEBRIEF_CHANNELS.updated, expect.anything())

    releasePhrase.resolve()
    await expect(generation).resolves.toMatchObject({
      text: 'Accepted debrief completed during teardown.',
      source: 'llm',
      reason: 'session-end'
    })
    await persistence
    expect(harness.broadcast).not.toHaveBeenCalledWith(DEBRIEF_CHANNELS.updated, expect.anything())
    const file = join(root, 'stint-debrief.json')
    const persisted = readFileSync(file, 'utf8')
    expect(JSON.parse(persisted)).toMatchObject({
      text: 'Accepted debrief completed during teardown.',
      source: 'llm',
      sessionInfo: { trackName: 'Endurance Track' }
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(readFileSync(file, 'utf8')).toBe(persisted)
    expect(readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([])
    await expect(
      harness.handlers.get(DEBRIEF_CHANNELS.generate)?.(undefined, { useLlm: false })
    ).rejects.toThrow('shutting down')
  })
})
