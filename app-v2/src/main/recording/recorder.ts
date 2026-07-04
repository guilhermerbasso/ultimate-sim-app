import { mkdir, readFile, readdir, rm, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type {
  RecordingLapSummary,
  RecordingSample,
  RecordingSessionSummary,
  RecordingStartOptions,
  RecordingStatus
} from '../../shared/recording'

type JsonlRow = RecordingSample

const DEFAULT_SAMPLE_RATE_HZ = 15
const MIN_SAMPLE_INTERVAL_MS = 50
const MAX_SAMPLE_INTERVAL_MS = 1000
const LAP_WRAP_HIGH = 0.82
const LAP_WRAP_LOW = 0.18

function clampSampleRate(rate?: number): number {
  if (!Number.isFinite(rate) || !rate) return DEFAULT_SAMPLE_RATE_HZ
  return Math.max(1, Math.min(30, Math.round(rate)))
}

function sessionIdFromDate(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function lapDist(snapshot: TelemetrySnapshot): number | null {
  const value = finiteOrUndefined(snapshot.lapDistPct)
  if (value === undefined) return null
  return Math.max(0, Math.min(1, value))
}

export class TelemetryRecorder {
  private readonly recordingsDir: string
  private active: RecordingSessionSummary | null = null
  private lastSampleAt = 0
  private lastLapDistPct: number | null = null
  private currentLapIndex = -1
  private lapStartedAtBoundary = new Map<number, boolean>()
  private writeQueue: Promise<void> = Promise.resolve()
  private metadataQueue: Promise<void> = Promise.resolve()
  private lastWriteError: string | null = null
  private stopping = false

  constructor(userDataPath: string) {
    this.recordingsDir = join(userDataPath, 'recordings')
  }

  status(): RecordingStatus {
    return { recording: this.active !== null, activeSession: this.active }
  }

  async start(options: RecordingStartOptions = {}): Promise<RecordingStatus> {
    if (this.active) return this.status()

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
      await mkdir(this.sessionDir(id), { recursive: true })
      this.active = pending
      this.lastSampleAt = 0
      this.lastLapDistPct = null
      this.currentLapIndex = -1
      this.lapStartedAtBoundary.clear()
      this.metadataQueue = Promise.resolve()
      this.lastWriteError = null
      this.stopping = false
      await this.enqueueMetadataPersist()
    } catch (error) {
      this.active = null
      throw error
    }
    return this.status()
  }

  async stop(): Promise<RecordingStatus> {
    if (!this.active) return this.status()
    const session = this.active
    this.stopping = true
    session.endedAt = Date.now()
    const lap = session.laps[this.currentLapIndex]
    if (lap && !lap.endedAt) this.finishLap(lap, session.endedAt, false)
    await this.flushWrites()
    await this.enqueueMetadataPersist(session)
    this.active = null
    this.lastLapDistPct = null
    this.currentLapIndex = -1
    this.lapStartedAtBoundary.clear()
    this.stopping = false
    return this.status()
  }

  onSnapshot(snapshot: TelemetrySnapshot | null): void {
    if (!this.active || this.stopping || !snapshot?.connected) return
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

    if (!currentLap || lapNumberChanged || wrapped) {
      if (currentLap && !currentLap.endedAt) {
        this.finishLap(currentLap, timestamp, this.lapStartedAtBoundary.get(currentLap.lapIndex) === true)
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
      void this.enqueueMetadataPersist().catch((error: unknown) => {
        this.lastWriteError = error instanceof Error ? error.message : String(error)
        console.warn('[recording] metadata persist failed:', this.lastWriteError)
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
    // `.then(append).catch(...)` keeps the promise chain alive after a failed
    // write. The previous version dropped silently on the first rejection and
    // stopped recording without any visible error.
    this.writeQueue = this.writeQueue
      .then(() => appendFile(filePath, `${JSON.stringify(sample)}\n`, 'utf8'))
      .catch((error: unknown) => {
        this.lastWriteError = error instanceof Error ? error.message : String(error)
        console.warn('[recording] sample append failed:', this.lastWriteError)
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
