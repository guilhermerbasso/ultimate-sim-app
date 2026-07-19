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
import type { CoachFinding } from '../../shared/coach'
import {
  captureLiveTelemetryContext
} from '../../shared/replay'
import {
  DEBRIEF_CHANNELS,
  type DebriefTriggerPayload,
  type StintDebrief
} from '../../shared/stint-debrief'
import { DEFAULT_APP_SETTINGS } from '../../shared/settings'
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
import { settingsEvents } from '../settings/events'
import {
  TelemetryRecorder,
  type TelemetryRecorderLifecycle,
  type TelemetryRecorderPersistence
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

function errorContains(error: unknown, expected: string): boolean {
  if (error instanceof Error && error.message.includes(expected)) return true
  if (error instanceof AggregateError && error.errors.some((entry) => errorContains(entry, expected))) {
    return true
  }
  return error instanceof Error && error.cause !== undefined
    ? errorContains(error.cause, expected)
    : false
}

function recorderPersistence(
  renameFile: TelemetryRecorderPersistence['rename']
): TelemetryRecorderPersistence {
  return {
    mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
    writeFile: (path, payload) => writeFile(path, payload, 'utf8'),
    rename: renameFile,
    remove: (path) => rm(path, { force: true })
  }
}

type SessionEnricherInternals = {
  pending: Map<string, NodeJS.Timeout>
  cache: Map<string, unknown>
  writeTails: Map<string, Promise<void>>
  finalizeRequests: Map<string, Promise<void>>
  sessionGenerations: Map<string, unknown>
}

function sessionEnricherInternals(enricher: SessionEnricher): SessionEnricherInternals {
  return enricher as unknown as SessionEnricherInternals
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
  stopFailures = 0
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
    if (this.stopFailures > 0) {
      this.stopFailures -= 1
      throw new Error('final metadata unavailable')
    }
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
  readonly activated: string[] = []
  readonly finalized: string[] = []
  readonly forgotten: string[] = []
  readonly observed: Array<{ sessionId: string; trackName?: string }> = []
  finalizeGate: Promise<void> | null = null
  finalizeFailures = 0
  quiesced = false

  activate(sessionId: string): void {
    this.activated.push(sessionId)
  }

  observe(sessionId: string, snap: TelemetrySnapshot | null): void {
    this.observed.push({ sessionId, trackName: snap?.trackName })
  }

  async finalize(sessionId: string): Promise<void> {
    this.finalized.push(sessionId)
    if (this.finalizeGate) await this.finalizeGate
    if (this.finalizeFailures > 0) {
      this.finalizeFailures -= 1
      throw new Error('sidecar unavailable')
    }
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

  it('backs off automatic retries after a retained final metadata failure', async () => {
    vi.useFakeTimers()
    const harness = coordinatorHarness()
    const live = snapshot('A', 'Track A')
    harness.setLatest(live)
    await harness.coordinator.requestUser(target(live), 'user recording start')
    harness.recorder.stopFailures = 3

    await expect(
      harness.coordinator.requestUser(target(live, false), 'user recording stop')
    ).rejects.toThrow('final metadata unavailable')
    expect(harness.recorder.stopCalls).toBe(1)

    for (let attempt = 0; attempt < 20; attempt += 1) {
      harness.coordinator.requestAutomatic(target(live, false), 'automatic stop retry')
    }
    await harness.coordinator.whenIdle()
    expect(harness.recorder.stopCalls).toBe(1)

    await vi.advanceTimersByTimeAsync(999)
    await harness.coordinator.whenIdle()
    expect(harness.recorder.stopCalls).toBe(1)

    await vi.advanceTimersByTimeAsync(1)
    await harness.coordinator.whenIdle()
    expect(harness.recorder.stopCalls).toBe(2)

    await vi.advanceTimersByTimeAsync(1_999)
    await harness.coordinator.whenIdle()
    expect(harness.recorder.stopCalls).toBe(2)

    await vi.advanceTimersByTimeAsync(1)
    await harness.coordinator.whenIdle()
    expect(harness.recorder.stopCalls).toBe(3)
    harness.coordinator.quiesce()
  })

  it('schedules backed-off retries after a retained sidecar finalization failure', async () => {
    vi.useFakeTimers()
    const harness = coordinatorHarness()
    const live = snapshot('A', 'Track A')
    harness.setLatest(live)
    await harness.coordinator.requestUser(target(live), 'user recording start')
    harness.enricher.finalizeFailures = 3

    await expect(
      harness.coordinator.requestUser(target(live, false), 'user recording stop')
    ).rejects.toThrow('sidecar unavailable')
    expect(harness.enricher.finalized).toEqual(['recording-A'])

    for (let attempt = 0; attempt < 20; attempt += 1) {
      harness.coordinator.requestAutomatic(target(live, false), 'automatic sidecar retry')
    }
    await harness.coordinator.whenIdle()
    expect(harness.enricher.finalized).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(999)
    await harness.coordinator.whenIdle()
    expect(harness.enricher.finalized).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1)
    await harness.coordinator.whenIdle()
    expect(harness.enricher.finalized).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(2_000)
    await harness.coordinator.whenIdle()
    expect(harness.enricher.finalized).toHaveLength(3)
    harness.coordinator.quiesce()
  })

  it('retries retained persistence when the latest telemetry mode is suspended', async () => {
    vi.useFakeTimers()
    const harness = coordinatorHarness()
    const live = snapshot('A', 'Track A')
    harness.setLatest(live)
    await harness.coordinator.requestUser(target(live), 'user recording start')
    harness.recorder.stopFailures = 1

    await expect(
      harness.coordinator.requestUser(target(live, false), 'user recording stop')
    ).rejects.toThrow('final metadata unavailable')
    harness.coordinator.requestAutomatic({
      ...target(live, false),
      mode: 'suspended'
    }, 'replay suspension')

    vi.setSystemTime(Date.now() + 1_000)
    harness.coordinator.requestAutomatic({
      ...target(live, false),
      mode: 'suspended'
    }, 'replay suspension at retry deadline')
    await harness.coordinator.whenIdle()

    expect(harness.recorder.stopCalls).toBe(2)
    expect(harness.recorder.status()).toEqual({ recording: false, activeSession: null })
    expect(harness.enricher.finalized).toEqual(['recording-A'])
    harness.coordinator.quiesce()
  })

  it('retries retained persistence before resuming the same live context', async () => {
    vi.useFakeTimers()
    const harness = coordinatorHarness()
    const live = snapshot('A', 'Track A')
    harness.setLatest(live)
    await harness.coordinator.requestUser(target(live), 'user recording start')
    harness.recorder.stopFailures = 1

    await expect(
      harness.coordinator.requestUser(target(live, false), 'user recording stop')
    ).rejects.toThrow('final metadata unavailable')
    harness.coordinator.requestAutomatic(target(live), 'live recording resume')

    vi.setSystemTime(Date.now() + 1_000)
    harness.coordinator.requestAutomatic(target(live), 'live recording resume at retry deadline')
    await harness.coordinator.whenIdle()

    expect(harness.recorder.stopCalls).toBe(2)
    expect(harness.recorder.starts).toEqual(['A', 'A'])
    expect(harness.recorder.status().recording).toBe(true)
    expect(harness.enricher.finalized).toEqual(['recording-A'])
    harness.coordinator.quiesce()
  })

  it('defers an in-flight automatic target until the persistence retry deadline', async () => {
    vi.useFakeTimers()
    const harness = coordinatorHarness()
    const live = snapshot('A', 'Track A')
    harness.setLatest(live)
    await harness.coordinator.requestUser(target(live), 'user recording start')
    const stopGate = deferred()
    harness.recorder.stopGate = stopGate.promise
    harness.recorder.stopFailures = 2

    harness.coordinator.requestAutomatic(target(live, false), 'automatic recording stop')
    await vi.waitFor(() => expect(harness.recorder.stopCalls).toBe(1))
    harness.coordinator.requestAutomatic({
      ...target(live, false),
      mode: 'suspended'
    }, 'queued replay suspension')

    stopGate.resolve()
    await harness.coordinator.whenIdle()
    expect(harness.recorder.stopCalls).toBe(1)

    await vi.advanceTimersByTimeAsync(999)
    await harness.coordinator.whenIdle()
    expect(harness.recorder.stopCalls).toBe(1)

    await vi.advanceTimersByTimeAsync(1)
    await harness.coordinator.whenIdle()
    expect(harness.recorder.stopCalls).toBe(2)
    harness.coordinator.quiesce()
  })

  it('bypasses automatic backoff when shutdown must retry retained persistence', async () => {
    vi.useFakeTimers()
    const harness = coordinatorHarness()
    const live = snapshot('A', 'Track A')
    harness.setLatest(live)
    await harness.coordinator.requestUser(target(live), 'user recording start')
    harness.recorder.stopFailures = 1

    harness.coordinator.requestAutomatic(target(live, false), 'automatic recording stop')
    await harness.coordinator.whenIdle()
    expect(harness.recorder.stopCalls).toBe(1)
    expect(harness.recorder.status().recording).toBe(true)

    harness.coordinator.quiesce()
    await expect(harness.coordinator.shutdown()).resolves.toBeUndefined()

    expect(harness.recorder.stopCalls).toBe(2)
    expect(harness.recorder.status()).toEqual({ recording: false, activeSession: null })
  })

  it('retires a deleted session after stale timer/tail work drains and never recreates it', async () => {
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

    enricher.activate(sessionId)
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
    const internals = sessionEnricherInternals(enricher)
    expect(internals.pending.size).toBe(0)
    expect(internals.cache.size).toBe(0)
    expect(internals.writeTails.size).toBe(0)
    expect(internals.finalizeRequests.size).toBe(0)
    expect(internals.sessionGenerations.size).toBe(0)
  })

  it('rejects active recording deletion before retiring sidecar state', async () => {
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
    expect(harness.enricher.activated).toEqual(['recording-A', 'recording-C'])
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

  it('persists the initial target snapshot when shutdown follows start without another telemetry event', async () => {
    const root = scratch('initial-snapshot-shutdown')
    writeFileSync(join(root, 'recording-config.json'), JSON.stringify({ autoRecord: false }), 'utf8')
    const harness = moduleHarness(root)
    registerRecordingAnalysis(harness.ctx)
    await new Promise<void>((resolve) => setImmediate(resolve))
    const live = snapshot('A', 'Track A', 0, { timestamp: 2_000, lapDistPct: 0.3 })
    harness.emit(live)

    await harness.handlers.get('recording:start')?.(undefined, { sampleRateHz: 10 })
    const sessionId = (harness.handlers.get('recording:status')?.() as RecordingStatus).activeSession?.id
    expect(sessionId).toBeTruthy()

    await harness.teardown('quiesce')
    await harness.teardown('persistence')

    const metadata = JSON.parse(
      readFileSync(join(root, 'recordings', sessionId as string, 'session.json'), 'utf8')
    ) as RecordingSessionSummary
    expect(metadata).toMatchObject({
      endedAt: expect.any(Number),
      sampleCount: 1
    })
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
    enricher.activate(sessionId)
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
    enricher.activate(sessionId)
    enricher.observe(sessionId, snapshot('A', 'Track A'))

    await enricher.finalize(sessionId)
    const internals = sessionEnricherInternals(enricher)
    expect(internals.pending.has(sessionId)).toBe(false)
    expect(internals.cache.has(sessionId)).toBe(false)
    expect(internals.writeTails.has(sessionId)).toBe(false)
    expect(internals.finalizeRequests.has(sessionId)).toBe(false)
    expect(internals.sessionGenerations.has(sessionId)).toBe(false)

    enricher.observe(sessionId, snapshot('A', 'Track B', 1))
    await enricher.quiesce()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(writes).toEqual(['Track A'])
  })

  it('releases tracking after many finalized and forgotten sidecar generations', async () => {
    vi.useFakeTimers()
    const writes: string[] = []
    const enricher = new SessionEnricher(scratch('sidecar-bounded'), async (sessionId) => {
      writes.push(sessionId)
    })
    const finalized = Array.from({ length: 64 }, (_, index) => `finalized-${index}`)
    for (const sessionId of finalized) {
      enricher.activate(sessionId)
      enricher.observe(sessionId, snapshot(sessionId, `Track ${sessionId}`))
    }
    await Promise.all(finalized.map((sessionId) => enricher.finalize(sessionId)))

    const forgotten = Array.from({ length: 64 }, (_, index) => `forgotten-${index}`)
    for (const sessionId of forgotten) {
      enricher.activate(sessionId)
      enricher.observe(sessionId, snapshot(sessionId, `Track ${sessionId}`))
    }
    await Promise.all(forgotten.map((sessionId) => enricher.forget(sessionId)))
    await Promise.resolve()

    const internals = sessionEnricherInternals(enricher)
    expect(writes).toHaveLength(finalized.length)
    expect(internals.pending.size).toBe(0)
    expect(internals.cache.size).toBe(0)
    expect(internals.writeTails.size).toBe(0)
    expect(internals.finalizeRequests.size).toBe(0)
    expect(internals.sessionGenerations.size).toBe(0)
  })

  it('retains failed finalization state for quiesce retry, then releases it', async () => {
    const attemptedTracks: Array<string | undefined> = []
    const enricher = new SessionEnricher(scratch('sidecar-retry-release'), async (_sessionId, entry) => {
      attemptedTracks.push(entry.trackName)
      if (attemptedTracks.length === 1) throw new Error('sidecar unavailable')
    })
    const sessionId = 'retry-session'
    enricher.activate(sessionId)
    enricher.observe(sessionId, snapshot('A', 'Track A'))

    await expect(enricher.finalize(sessionId)).rejects.toThrow('sidecar unavailable')
    const internals = sessionEnricherInternals(enricher)
    expect(internals.cache.has(sessionId)).toBe(true)
    expect(internals.sessionGenerations.has(sessionId)).toBe(true)

    enricher.observe(sessionId, snapshot('A', 'Track B', 1))
    await expect(enricher.quiesce()).resolves.toBeUndefined()
    expect(attemptedTracks).toEqual(['Track A', 'Track A'])
    expect(internals.pending.size).toBe(0)
    expect(internals.cache.size).toBe(0)
    expect(internals.writeTails.size).toBe(0)
    expect(internals.finalizeRequests.size).toBe(0)
    expect(internals.sessionGenerations.size).toBe(0)
  })

  it('retries a failed debounced sidecar with the latest accepted state during quiesce', async () => {
    vi.useFakeTimers()
    const firstAttempt = deferred()
    const attemptedTracks: Array<string | undefined> = []
    const enricher = new SessionEnricher(scratch('sidecar-debounce-retry'), async (_sessionId, entry) => {
      attemptedTracks.push(entry.trackName)
      if (attemptedTracks.length === 1) {
        firstAttempt.resolve()
        throw new Error('debounced sidecar unavailable')
      }
    })
    const sessionId = 'debounce-retry-session'
    enricher.activate(sessionId)
    enricher.observe(sessionId, snapshot('A', 'Track A'))
    await vi.advanceTimersByTimeAsync(500)
    await firstAttempt.promise

    enricher.observe(sessionId, snapshot('A', 'Track B', 1))
    await expect(enricher.quiesce()).resolves.toBeUndefined()

    expect(attemptedTracks).toEqual(['Track A', 'Track B'])
    const internals = sessionEnricherInternals(enricher)
    expect(internals.pending.size).toBe(0)
    expect(internals.cache.size).toBe(0)
    expect(internals.writeTails.size).toBe(0)
    expect(internals.finalizeRequests.size).toBe(0)
    expect(internals.sessionGenerations.size).toBe(0)
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
    enricher.activate(sessionId as string)
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

  it('retries a transient final metadata failure during shutdown without losing the session', async () => {
    const root = scratch('recording-metadata-retry')
    let finalizing = false
    let finalRenameAttempts = 0
    let failuresRemaining = 1
    const recorder = new TelemetryRecorder(
      root,
      undefined,
      recorderPersistence(async (from, to) => {
        if (finalizing) {
          finalRenameAttempts += 1
          if (failuresRemaining > 0) {
            failuresRemaining -= 1
            throw new Error('transient final metadata failure')
          }
        }
        await rename(from, to)
      })
    )
    const live = snapshot('A', 'Track A', 0, { timestamp: 2_000, lapDistPct: 0.3 })
    await recorder.start({ sampleRateHz: 15 })
    const sessionId = recorder.status().activeSession?.id
    expect(sessionId).toBeTruthy()
    finalizing = true

    const enricher = new SessionEnricher(root, async () => undefined)
    enricher.activate(sessionId as string)
    enricher.observe(sessionId as string, live)
    const coordinator = new RecordingLifecycleCoordinator(
      recorder,
      enricher,
      () => live,
      vi.fn(),
      vi.fn()
    )

    coordinator.quiesce()
    await expect(coordinator.shutdown()).resolves.toBeUndefined()

    expect(finalRenameAttempts).toBe(2)
    expect(recorder.status()).toEqual({ recording: false, activeSession: null })
    await expect(new TelemetryRecorder(root).listSessions()).resolves.toEqual([
      expect.objectContaining({
        id: sessionId,
        endedAt: expect.any(Number)
      })
    ])
  })

  it('drains sidecars and exposes persistent final metadata failure while keeping restart visibility', async () => {
    const root = scratch('recording-metadata-loss')
    let finalizing = false
    let finalRenameAttempts = 0
    const recorder = new TelemetryRecorder(
      root,
      undefined,
      recorderPersistence(async (from, to) => {
        if (finalizing) {
          finalRenameAttempts += 1
          throw new Error('persistent final metadata failure')
        }
        await rename(from, to)
      })
    )
    const live = snapshot('A', 'Track A', 0, { timestamp: 2_000, lapDistPct: 0.3 })
    await recorder.start({ sampleRateHz: 15 })
    const sessionId = recorder.status().activeSession?.id
    expect(sessionId).toBeTruthy()
    finalizing = true

    const sidecarStarted = deferred()
    const releaseSidecar = deferred()
    let sidecarDrained = false
    const enricher = new SessionEnricher(root, async () => {
      sidecarStarted.resolve()
      await releaseSidecar.promise
      sidecarDrained = true
    })
    enricher.activate(sessionId as string)
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
    expect(recorder.status()).toMatchObject({
      recording: true,
      activeSession: { id: sessionId, endedAt: expect.any(Number) }
    })
    await expect(new TelemetryRecorder(root).listSessions()).resolves.toEqual([
      expect.objectContaining({ id: sessionId })
    ])

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
    expect(errorContains(failure, 'Recording metadata persistence failed')).toBe(true)
    expect(finalRenameAttempts).toBe(2)
    expect(sidecarDrained).toBe(true)
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
    const flushA = store.flush().then(
      () => null,
      (error: unknown) => error
    )
    await firstWriteStarted.promise

    store.onSnapshot(snapshot('A', 'Track A', 0, {
      currentLap: 3,
      lastLapTimeSec: 91,
      incidentCountMy: 0
    }))
    expect(store.status().activeSamples).toBe(2)
    const flushB = store.flush()
    releaseFirstWrite.resolve()
    expect(await flushA).toBeInstanceOf(Error)
    await flushB

    const persisted = JSON.parse(readFileSync(file, 'utf8')) as {
      models: Record<string, { n: number }>
    }
    expect(Object.values(persisted.models)[0]?.n).toBe(2)
    await store.dispose()
    expect(Object.values(
      (JSON.parse(readFileSync(file, 'utf8')) as { models: Record<string, { n: number }> }).models
    )[0]?.n).toBe(2)
  })

  it('does not resolve flush until a newer payload learned during the write is durable', async () => {
    const root = scratch('pace-concurrent-flush')
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

    const flushing = store.flush()
    await firstWriteStarted.promise
    store.onSnapshot(snapshot('A', 'Track A', 0, {
      currentLap: 3,
      lastLapTimeSec: 91,
      incidentCountMy: 0
    }))
    releaseFirstWrite.resolve()
    await flushing

    expect(writeCount).toBe(2)
    expect(Object.values(
      (JSON.parse(readFileSync(file, 'utf8')) as { models: Record<string, { n: number }> }).models
    )[0]?.n).toBe(2)
    await store.dispose()
  })

  it('retries dirty pace data during dispose until persistence eventually succeeds', async () => {
    const root = scratch('pace-dispose-retry')
    const file = join(root, 'pace-models.json')
    let failuresRemaining = 2
    let writeAttempts = 0
    const persistence: PaceModelPersistence = {
      mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
      writeFile: async (path, payload) => {
        writeAttempts += 1
        if (failuresRemaining > 0) {
          failuresRemaining -= 1
          throw new Error('transient pace persistence failure')
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

    await expect(store.dispose()).resolves.toBeUndefined()

    expect(writeAttempts).toBe(3)
    expect(Object.values(
      (JSON.parse(readFileSync(file, 'utf8')) as { models: Record<string, { n: number }> }).models
    )[0]?.n).toBe(1)
  })

  it('throws after bounded pace retries and preserves dirty data for a later successful teardown', async () => {
    const root = scratch('pace-dispose-exhausted')
    const file = join(root, 'pace-models.json')
    let persistentFailure = true
    let writeAttempts = 0
    const persistence: PaceModelPersistence = {
      mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
      writeFile: async (path, payload) => {
        writeAttempts += 1
        if (persistentFailure) throw new Error('pace storage unavailable')
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

    await expect(store.dispose()).rejects.toThrow(
      'Pace model persistence failed after 3 attempts: pace storage unavailable'
    )
    expect(writeAttempts).toBe(3)

    persistentFailure = false
    await expect(store.dispose()).resolves.toBeUndefined()
    expect(writeAttempts).toBe(4)
    expect(Object.values(
      (JSON.parse(readFileSync(file, 'utf8')) as { models: Record<string, { n: number }> }).models
    )[0]?.n).toBe(1)
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
  it('baselines an initial pit-lane snapshot before detecting a real pit-in transition', async () => {
    const root = scratch('debrief-pit-baseline')
    const harness = moduleHarness(root)
    registerStintDebrief(harness.ctx)

    harness.emit(snapshot('pit', 'Track A', 0, {
      onPitRoad: true,
      currentLap: 5,
      completedLaps: 5
    }))
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(harness.broadcast).not.toHaveBeenCalledWith(
      DEBRIEF_CHANNELS.updated,
      expect.anything()
    )

    harness.emit(snapshot('pit', 'Track A', 0, {
      onPitRoad: false,
      currentLap: 5,
      completedLaps: 5
    }))
    harness.emit(snapshot('pit', 'Track A', 0, {
      onPitRoad: false,
      currentLap: 7,
      completedLaps: 7
    }))
    harness.emit(snapshot('pit', 'Track A', 0, {
      onPitRoad: true,
      currentLap: 7,
      completedLaps: 7
    }))

    await vi.waitFor(() => {
      expect(harness.broadcast).toHaveBeenCalledWith(
        DEBRIEF_CHANNELS.updated,
        expect.objectContaining({ reason: 'stint-end' })
      )
    })
    await harness.teardown('quiesce')
    await harness.teardown('persistence')
  })

  it('uses ended non-iRacing metadata and generates while the Coach view is unmounted', async () => {
    const root = scratch('debrief-main')
    const harness = moduleHarness(root)
    const coachFinding: CoachFinding = {
      id: 'coach-owned-finding',
      kind: 'brake-late',
      sector: 1,
      zonePctStart: 0.1,
      zonePctEnd: 0.2,
      severity: 'med',
      estTimeLossSec: 0.3,
      title: 'Brake earlier',
      detail: 'Release the brake before turn-in.',
      evidence: 'Brake release was late.',
      metrics: { brakeReleasePct: 0.2 }
    }
    registerStintDebrief(harness.ctx, {
      getFindings: () => [coachFinding]
    })
    settingsEvents.emitChanged({ ...DEFAULT_APP_SETTINGS, language: 'pt-BR' })
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
    expect(trigger.findings).toEqual([coachFinding])
    expect(updated).toMatchObject({
      reason: 'session-end',
      source: 'deterministic',
      language: 'pt-BR',
      sessionInfo: { trackName: 'Old Track', lapsCompleted: 12 }
    })
    await expect(harness.handlers.get(DEBRIEF_CHANNELS.last)?.()).resolves.toEqual(updated)

    await harness.teardown('quiesce')
    await harness.teardown('persistence')
    expect(existsSync(join(root, 'stint-debrief.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(root, 'stint-debrief.json'), 'utf8'))).toMatchObject({
      reason: 'session-end',
      language: 'pt-BR',
      sessionInfo: { trackName: 'Old Track', lapsCompleted: 12 }
    })

    const reload = moduleHarness(root)
    registerStintDebrief(reload.ctx)
    await expect(reload.handlers.get(DEBRIEF_CHANNELS.last)?.()).resolves.toMatchObject({
      reason: 'session-end',
      language: 'pt-BR',
      sessionInfo: { trackName: 'Old Track', lapsCompleted: 12 }
    })
    await reload.teardown('quiesce')
    await reload.teardown('persistence')
  })

  it('migrates a persisted deterministic pre-language debrief to historical en-US', async () => {
    const root = scratch('debrief-language-migration')
    const harness = moduleHarness(root)
    registerStintDebrief(harness.ctx, {
      loadPersisted: async () => ({
        generatedAt: 1_000,
        text: 'Legacy deterministic debrief.',
        bullets: ['⚠ Turn 1'],
        source: 'deterministic',
        reason: 'manual'
      })
    })

    await expect(harness.handlers.get(DEBRIEF_CHANNELS.last)?.()).resolves.toMatchObject({
      text: 'Legacy deterministic debrief.',
      language: 'en-US'
    })

    await harness.teardown('quiesce')
    await harness.teardown('persistence')
  })

  it('migrates a persisted LLM pre-language debrief to historical en-US', async () => {
    const root = scratch('debrief-llm-language-migration')
    const harness = moduleHarness(root)
    registerStintDebrief(harness.ctx, {
      loadPersisted: async () => ({
        generatedAt: 1_000,
        text: 'Legacy English debrief.',
        bullets: ['✅ Turn 1'],
        source: 'llm',
        reason: 'manual'
      })
    })

    await expect(harness.handlers.get(DEBRIEF_CHANNELS.last)?.()).resolves.toMatchObject({
      text: 'Legacy English debrief.',
      language: 'en-US'
    })

    await harness.teardown('quiesce')
    await harness.teardown('persistence')
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
