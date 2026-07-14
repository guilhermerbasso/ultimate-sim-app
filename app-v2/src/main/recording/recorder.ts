import { mkdir, readFile, readdir, rm, writeFile, appendFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type {
  RecordingLapSummary,
  RecordingSample,
  RecordingSessionSummary,
  RecordingStartOptions,
  RecordingStatus
} from '../../shared/recording'
import { LiveTelemetryGate } from '../../shared/replay'

type JsonlRow = RecordingSample

const DEFAULT_SAMPLE_RATE_HZ = 15
const MIN_SAMPLE_INTERVAL_MS = 50
const MAX_SAMPLE_INTERVAL_MS = 1000
const LAP_WRAP_HIGH = 0.82
const LAP_WRAP_LOW = 0.18

export interface TelemetryRecorderLifecycle {
  prepareSession(dir: string): Promise<void>
  removeSession(dir: string): Promise<void>
}

const DEFAULT_LIFECYCLE: TelemetryRecorderLifecycle = {
  prepareSession: (dir) => mkdir(dir, { recursive: true }).then(() => undefined),
  removeSession: (dir) => rm(dir, { recursive: true, force: true })
}

function clampSampleRate(rate?: number): number {
  if (!Number.isFinite(rate) || !rate) return DEFAULT_SAMPLE_RATE_HZ
  return Math.max(1, Math.min(30, Math.round(rate)))
}

function sessionIdFromDate(date = new Date()): string {
  return `${date.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')}-${randomUUID().slice(0, 8)}`
}

function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function recordingFailure(message: string, error: unknown): Error {
  return new Error(`${message}: ${errorMessage(error)}`, { cause: error })
}

function lapDist(snapshot: TelemetrySnapshot): number | null {
  const value = finiteOrUndefined(snapshot.lapDistPct)
  if (value === undefined) return null
  return Math.max(0, Math.min(1, value))
}

export class TelemetryRecorder {
  private readonly liveGate = new LiveTelemetryGate()
  private readonly recordingsDir: string
  private active: RecordingSessionSummary | null = null
  private lastSampleAt = 0
  private lastLapDistPct: number | null = null
  private currentLapIndex = -1
  private lapStartedAtBoundary = new Map<number, boolean>()
  private writeQueue: Promise<void> = Promise.resolve()
  private metadataQueue: Promise<void> = Promise.resolve()
  private pendingWriteFailures: Error[] = []
  private stopping = false
  private boundaryPending = false
  private startGeneration = 0
  private startRequest: {
    generation: number
    contextKey: string | null
    sampleRateHz: number
    promise: Promise<RecordingStatus>
  } | null = null
  private accepting = true

  constructor(
    userDataPath: string,
    private readonly lifecycle: TelemetryRecorderLifecycle = DEFAULT_LIFECYCLE
  ) {
    this.recordingsDir = join(userDataPath, 'recordings')
  }

  status(): RecordingStatus {
    return { recording: this.active !== null, activeSession: this.active }
  }

  async start(
    options: RecordingStartOptions = {},
    isCurrent: () => boolean = () => true,
    contextKey: string | null = null
  ): Promise<RecordingStatus> {
    if (!this.accepting) throw new Error('Recording lifecycle is shutting down.')
    const sampleRateHz = clampSampleRate(options.sampleRateHz)
    const pending = this.startRequest
    if (
      pending &&
      pending.generation === this.startGeneration &&
      pending.contextKey === contextKey &&
      pending.sampleRateHz === sampleRateHz
    ) {
      return pending.promise
    }
    if (pending?.generation === this.startGeneration) this.cancelPendingStart()
    if (!pending && this.active) return this.status()
    const generation = ++this.startGeneration
    const predecessor = pending?.promise.then(
      () => undefined,
      () => undefined
    ) ?? Promise.resolve()
    const promise = predecessor.then(() =>
      this.startInternal({ ...options, sampleRateHz }, generation, isCurrent)
    )
    const request = { generation, contextKey, sampleRateHz, promise }
    this.startRequest = request
    void promise.then(
      () => {
        if (this.startRequest === request) this.startRequest = null
      },
      () => {
        if (this.startRequest === request) this.startRequest = null
      }
    )
    return promise
  }

  cancelPendingStart(): void {
    this.startGeneration += 1
  }

  async settlePendingStart(): Promise<void> {
    await this.startRequest?.promise.catch(() => undefined)
  }

  quiesce(): void {
    if (!this.accepting) return
    this.accepting = false
    this.cancelPendingStart()
  }

  private async startInternal(
    options: RecordingStartOptions,
    generation: number,
    isCurrent: () => boolean
  ): Promise<RecordingStatus> {
    if (!this.startIsCurrent(generation, isCurrent)) return this.status()
    const startedAt = Date.now()
    const id = sessionIdFromDate(new Date(startedAt))
    const sampleRateHz = clampSampleRate(options.sampleRateHz)
    const pending: RecordingSessionSummary = {
      id,
      source: 'none',
      startedAt,
      sampleRateHz,
      sampleCount: 0,
      lapCount: 0,
      laps: []
    }

    // Only mark the session as active after the initial I/O succeeds. Otherwise
    // a failed mkdir/persist would leave `active` set and `onSnapshot` would
    // start enqueuing appends to a directory that never got created.
    try {
      await this.lifecycle.prepareSession(this.sessionDir(id))
      if (!this.startIsCurrent(generation, isCurrent)) {
        await this.lifecycle.removeSession(this.sessionDir(id))
        return this.status()
      }
      this.writeQueue = Promise.resolve()
      this.metadataQueue = Promise.resolve()
      this.pendingWriteFailures = []
      await this.enqueueMetadataPersist(pending)
      if (!this.startIsCurrent(generation, isCurrent)) {
        await this.lifecycle.removeSession(this.sessionDir(id))
        return this.status()
      }
      this.active = pending
      this.lastSampleAt = 0
      this.lastLapDistPct = null
      this.currentLapIndex = -1
      this.lapStartedAtBoundary.clear()
      this.stopping = false
      this.boundaryPending = false
    } catch (error) {
      await this.rollbackStart(id)
      throw error
    }
    return this.status()
  }

  async stop(): Promise<RecordingStatus> {
    this.cancelPendingStart()
    await this.settlePendingStart()
    if (!this.active) return this.status()
    const session = this.active
    const pendingWriteFailures = this.pendingWriteFailures
    const failures: Error[] = []
    let metadataFailure: Error | null = null
    this.stopping = true
    try {
      try {
        session.endedAt = Date.now()
        const lap = session.laps[this.currentLapIndex]
        if (lap && !lap.endedAt) this.finishLap(lap, session.endedAt, false)
      } catch (error) {
        failures.push(recordingFailure('Recording finalization failed', error))
      }
      try {
        await this.flushWrites()
      } catch (error) {
        failures.push(recordingFailure('Recording sample queue drain failed', error))
      }
      try {
        await this.enqueueMetadataPersist(session)
      } catch (error) {
        metadataFailure = recordingFailure('Recording metadata persistence failed', error)
      }
    } finally {
      this.clearStoppedSession(session, pendingWriteFailures)
      failures.push(...pendingWriteFailures)
      if (metadataFailure) failures.push(metadataFailure)
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Recording persistence failed.')
    }
    return this.status()
  }

  private clearStoppedSession(
    session: RecordingSessionSummary,
    pendingWriteFailures: Error[]
  ): void {
    if (this.active === session) {
      this.active = null
      this.lastSampleAt = 0
      this.lastLapDistPct = null
      this.currentLapIndex = -1
      this.lapStartedAtBoundary.clear()
      this.boundaryPending = false
      this.writeQueue = Promise.resolve()
      this.metadataQueue = Promise.resolve()
    }
    if (this.pendingWriteFailures === pendingWriteFailures) this.pendingWriteFailures = []
    this.stopping = false
  }

  private startIsCurrent(generation: number, isCurrent: () => boolean): boolean {
    if (generation !== this.startGeneration) return false
    try {
      return isCurrent()
    } catch {
      return false
    }
  }

  private async rollbackStart(sessionId: string): Promise<void> {
    if (this.active?.id === sessionId) {
      this.stopping = true
      await this.flushWrites()
      await this.metadataQueue.catch(() => undefined)
      this.active = null
      this.lastSampleAt = 0
      this.lastLapDistPct = null
      this.currentLapIndex = -1
      this.lapStartedAtBoundary.clear()
      this.boundaryPending = false
      this.stopping = false
    }
    await this.lifecycle.removeSession(this.sessionDir(sessionId)).catch(() => undefined)
  }

  onSnapshot(snapshot: TelemetrySnapshot | null): void {
    if (!this.accepting) return
    const live = this.liveGate.observe(snapshot)
    if (!live.live) {
      if (live.boundary) this.resetTelemetryBoundary()
      return
    }
    if (live.boundary) this.resetTelemetryBoundary()
    if (!this.active || this.stopping || !snapshot) return
    const dist = lapDist(snapshot)
    if (dist === null) return

    const now = snapshot.timestamp || Date.now()
    const intervalMs = Math.max(MIN_SAMPLE_INTERVAL_MS, Math.min(MAX_SAMPLE_INTERVAL_MS, 1000 / this.active.sampleRateHz))
    if (this.lastSampleAt && now - this.lastSampleAt < intervalMs) return

    this.ensureLap(snapshot, dist, now)
    const lap = this.active.laps[this.currentLapIndex]
    if (!lap) return

    const sample: RecordingSample = {
      timestamp: now,
      sessionTimeSec: finiteOrUndefined(snapshot.sessionTimeRemainingSec),
      lapIndex: this.currentLapIndex,
      lapNumber: finiteOrUndefined(snapshot.currentLap),
      lapDistPct: dist,
      speedKmh: snapshot.speedKmh,
      throttle: snapshot.throttle,
      brake: snapshot.brake,
      deltaToBestSec: finiteOrUndefined(snapshot.deltaToBestSec),
      currentLapTimeSec: finiteOrUndefined(snapshot.currentLapTimeSec),
      rpm: finiteOrUndefined(snapshot.rpm),
      gear: finiteOrUndefined(snapshot.gear)
    }

    this.active.source = snapshot.sim
    this.active.sampleCount += 1
    this.updateLap(lap, sample)
    this.lastSampleAt = now
    this.lastLapDistPct = dist
    this.enqueueAppend(sample)
  }

  private resetTelemetryBoundary(): void {
    this.lastSampleAt = 0
    this.lastLapDistPct = null
    this.boundaryPending = this.active !== null
  }

  async listSessions(): Promise<RecordingSessionSummary[]> {
    await mkdir(this.recordingsDir, { recursive: true })
    const entries = await readdir(this.recordingsDir, { withFileTypes: true })
    const sessions = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => this.readSession(entry.name).catch(() => null))
    )
    return sessions
      .filter((session): session is RecordingSessionSummary => Boolean(session))
      .sort((a, b) => b.startedAt - a.startedAt)
  }

  async getLap(sessionId: string, lapIndex: number): Promise<RecordingSample[]> {
    if (!this.isSafeSessionId(sessionId)) throw new Error('Invalid session id')
    const raw = await readFile(join(this.sessionDir(sessionId), 'samples.jsonl'), 'utf8').catch(() => '')
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as JsonlRow)
      .filter((sample) => sample.lapIndex === lapIndex)
      .sort((a, b) => a.lapDistPct - b.lapDistPct)
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!this.isSafeSessionId(sessionId)) throw new Error('Invalid session id')
    if (this.active?.id === sessionId) throw new Error('Cannot delete an active recording')
    await rm(this.sessionDir(sessionId), { recursive: true, force: true })
  }

  private ensureLap(snapshot: TelemetrySnapshot, dist: number, timestamp: number): void {
    if (!this.active) return
    const lapNumber = finiteOrUndefined(snapshot.currentLap)
    const currentLap = this.active.laps[this.currentLapIndex]
    const lapNumberChanged = Boolean(
      currentLap && lapNumber !== undefined && currentLap.lapNumber !== undefined && lapNumber > currentLap.lapNumber
    )
    const wrapped = this.lastLapDistPct !== null && this.lastLapDistPct > LAP_WRAP_HIGH && dist < LAP_WRAP_LOW

    if (!currentLap || this.boundaryPending || lapNumberChanged || wrapped) {
      if (currentLap && !currentLap.endedAt) {
        const complete = !this.boundaryPending && this.lapStartedAtBoundary.get(currentLap.lapIndex) === true
        this.finishLap(currentLap, timestamp, complete)
      }
      this.currentLapIndex += 1
      const openedAtBoundary = wrapped || lapNumberChanged || (!currentLap && dist < LAP_WRAP_LOW)
      this.active.laps.push({
        lapIndex: this.currentLapIndex,
        lapNumber,
        startedAt: timestamp,
        sampleCount: 0,
        complete: false
      })
      this.lapStartedAtBoundary.set(this.currentLapIndex, openedAtBoundary)
      this.active.lapCount = this.active.laps.length
      this.boundaryPending = false
      const pendingWriteFailures = this.pendingWriteFailures
      void this.enqueueMetadataPersist().catch((error: unknown) => {
        pendingWriteFailures.push(recordingFailure('Recording I/O failed', error))
        console.warn('[recording] metadata persist failed:', errorMessage(error))
      })
    }
  }

  private updateLap(lap: RecordingLapSummary, sample: RecordingSample): void {
    const count = lap.sampleCount
    lap.sampleCount = count + 1
    lap.minSpeedKmh = lap.minSpeedKmh === undefined ? sample.speedKmh : Math.min(lap.minSpeedKmh, sample.speedKmh)
    lap.maxSpeedKmh = lap.maxSpeedKmh === undefined ? sample.speedKmh : Math.max(lap.maxSpeedKmh, sample.speedKmh)
    lap.avgSpeedKmh = ((lap.avgSpeedKmh ?? 0) * count + sample.speedKmh) / lap.sampleCount
    if (sample.deltaToBestSec !== undefined) {
      lap.bestDeltaToBestSec = lap.bestDeltaToBestSec === undefined ? sample.deltaToBestSec : Math.min(lap.bestDeltaToBestSec, sample.deltaToBestSec)
      lap.worstDeltaToBestSec = lap.worstDeltaToBestSec === undefined ? sample.deltaToBestSec : Math.max(lap.worstDeltaToBestSec, sample.deltaToBestSec)
    }
    lap.durationSec = Math.max(0, (sample.timestamp - lap.startedAt) / 1000)
  }

  private finishLap(lap: RecordingLapSummary, timestamp: number, complete: boolean): void {
    lap.endedAt = timestamp
    lap.durationSec = Math.max(0, (timestamp - lap.startedAt) / 1000)
    lap.complete = complete
  }

  private enqueueAppend(sample: RecordingSample): void {
    if (!this.active) return
    const filePath = join(this.sessionDir(this.active.id), 'samples.jsonl')
    const pendingWriteFailures = this.pendingWriteFailures
    // `.then(append).catch(...)` keeps the promise chain alive after a failed
    // write. The previous version dropped silently on the first rejection and
    // stopped recording without any visible error.
    this.writeQueue = this.writeQueue
      .then(() => appendFile(filePath, `${JSON.stringify(sample)}\n`, 'utf8'))
      .catch((error: unknown) => {
        pendingWriteFailures.push(recordingFailure('Recording I/O failed', error))
        console.warn('[recording] sample append failed:', errorMessage(error))
      })
  }

  private async flushWrites(): Promise<void> {
    await this.writeQueue
  }

  private enqueueMetadataPersist(session: RecordingSessionSummary | null = this.active): Promise<void> {
    if (!session) return this.metadataQueue
    const sessionDir = this.sessionDir(session.id)
    const payload = `${JSON.stringify(session, null, 2)}\n`
    this.metadataQueue = this.metadataQueue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(sessionDir, { recursive: true })
        await writeFile(join(sessionDir, 'session.json'), payload, 'utf8')
      })
    return this.metadataQueue
  }

  private async readSession(sessionId: string): Promise<RecordingSessionSummary> {
    const raw = await readFile(join(this.sessionDir(sessionId), 'session.json'), 'utf8')
    return JSON.parse(raw) as RecordingSessionSummary
  }

  private sessionDir(sessionId: string): string {
    return join(this.recordingsDir, sessionId)
  }

  private isSafeSessionId(sessionId: string): boolean {
    return /^[0-9T_\-.A-Za-z]+$/.test(sessionId) && !sessionId.includes('..')
  }
}
