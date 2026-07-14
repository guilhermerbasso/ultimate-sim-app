import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

import {
  BIO_CHANNELS,
  DEFAULT_HR_MODEL,
  aggregateLapBiometrics,
  alignSpikesToEvents,
  calmUnderPressure,
  classifyStress,
  correlatePaceHr,
  detectStressSpikes,
  drivingIntensity,
  parseHeartRateMeasurement,
  targetHeartRate,
  type BioEvent,
  type BioLiveSample,
  type BioSeriesResult,
  type BioSessionSummary,
  type BioStatus,
  type HeartRateModelParams,
  type HeartRateSourceKind,
  type HrSample,
  type LapBoundary,
  type StressState
} from '../../shared/biometrics'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { ModuleContext } from '../module-context'
import { logger } from './logger'
import { isLiveTelemetrySnapshot, LiveTelemetryGate } from '../../shared/replay'

// ─────────────────────────────────────────────────────────────────────────────
// Biometrics module (F7).
//
// Owns a heart-rate DATA SOURCE behind a small interface so the rest of the app
// never cares whether the beats come from a simulated curve or a real chest
// strap:
//   • MockHeartRateSource  — default, NO hardware. Drives a believable HR curve
//     from live telemetry intensity (speed, G-load, braking, proximity,
//     incidents) via the pure model in shared/biometrics.ts.
//   • WebBleHeartRateSource — SEAM for a standard BLE Heart Rate Service device
//     (0x180D / 0x2A37). Native BLE is intentionally NOT bundled; the renderer
//     pairs over Web Bluetooth and pushes raw 0x2A37 bytes back through the
//     `bio:bleValue` IPC, which this source parses. See the class TODO.
//
// On top of the source it keeps a rolling HR ring-buffer, derives lap/incident
// events from telemetry, correlates HR against lap pace, scores "calm under
// pressure", flags stress spikes, and persists a light per-session summary.
// ─────────────────────────────────────────────────────────────────────────────

const SESSIONS_FILE = 'biometrics-sessions.json'
const MAX_SESSIONS = 50
const SAMPLE_BUFFER_LIMIT = 3600 // ~60 min at 1 Hz
const SERIES_MAX_POINTS = 600
const TICK_MS = 1000
const INCIDENT_AROUSAL_MS = 4000
const HARDWARE_TIMEOUT_MS = 6000
const BASELINE_EMA_ALPHA = 0.02

// ─── HR source interface + implementations ───────────────────────────────────

export interface HeartRateReading {
  bpm: number
  t: number
  rrMs?: number[]
}

export interface HeartRateSource {
  readonly kind: HeartRateSourceKind
  start(): void
  stop(): void
  /** True only when a REAL device is actively streaming (mock returns false). */
  isHardwareConnected(): boolean
  onReading(listener: (reading: HeartRateReading) => void): () => void
}

abstract class BaseHeartRateSource implements HeartRateSource {
  abstract readonly kind: HeartRateSourceKind
  protected readonly listeners = new Set<(reading: HeartRateReading) => void>()

  abstract start(): void
  abstract stop(): void
  abstract isHardwareConnected(): boolean

  onReading(listener: (reading: HeartRateReading) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  protected emit(reading: HeartRateReading): void {
    for (const listener of this.listeners) listener(reading)
  }
}

/**
 * Telemetry-driven simulated heart rate. Requires NO hardware: each tick it maps
 * the latest telemetry snapshot to a 0..1 intensity, eases the current BPM
 * toward the model target (HR rises faster than it recovers), and adds light
 * noise + a respiratory-sinus wiggle so the trace looks human. Also synthesises
 * a single RR-interval so the HRV view has something to chew on.
 */
export class MockHeartRateSource extends BaseHeartRateSource {
  readonly kind = 'mock' as const
  private timer: ReturnType<typeof setInterval> | null = null
  private currentBpm: number
  private phase = 0
  private incidentUntil = 0
  private lastIncidentCount: number | undefined
  private wasLive = false

  constructor(
    private readonly getSnapshot: () => TelemetrySnapshot | null,
    private readonly model: HeartRateModelParams = DEFAULT_HR_MODEL
  ) {
    super()
    this.currentBpm = model.restingBpm
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  isHardwareConnected(): boolean {
    return false
  }

  private tick(): void {
    const snapshot = this.getSnapshot()
    if (!isLiveTelemetrySnapshot(snapshot)) {
      if (this.wasLive) {
        this.wasLive = false
        this.incidentUntil = 0
        this.lastIncidentCount = undefined
      }
      return
    }
    if (!this.wasLive) {
      this.wasLive = true
      this.incidentUntil = 0
      this.lastIncidentCount = snapshot.incidentCount
    }
    const engaged = true
    const now = Date.now()

    // Latch a transient arousal bump for a few seconds after a fresh incident.
    if (snapshot && typeof snapshot.incidentCount === 'number') {
      if (this.lastIncidentCount !== undefined && snapshot.incidentCount > this.lastIncidentCount) {
        this.incidentUntil = now + INCIDENT_AROUSAL_MS
      }
      this.lastIncidentCount = snapshot.incidentCount
    }
    const incident = now < this.incidentUntil

    const intensity = engaged
      ? drivingIntensity({
          speedKmh: snapshot?.speedKmh,
          throttle: snapshot?.throttle,
          brake: snapshot?.brake,
          rpm: snapshot?.rpm,
          maxRpm: snapshot?.maxRpm,
          latAccelG: snapshot?.latAccelG,
          longAccelG: snapshot?.longAccelG,
          steerAngleDeg: snapshot?.steerAngleDeg,
          nearbyCars: snapshot?.radarCars?.length ?? proximityFromRelatives(snapshot),
          yellowFlag: snapshot?.flags?.yellow,
          incident
        })
      : 0

    const target = targetHeartRate(intensity, this.model, engaged)
    // Asymmetric easing: climb quickly, recover slowly.
    const alpha = target > this.currentBpm ? 0.14 : 0.06
    this.currentBpm += (target - this.currentBpm) * alpha

    this.phase += 0.4
    const respiratory = Math.sin(this.phase) * 1.2
    const noise = (Math.random() - 0.5) * 2.4
    const bpm = clampBpm(this.currentBpm + respiratory + noise)
    const rrMs = [Math.round(60000 / bpm)]

    this.emit({ bpm: Math.round(bpm), t: now, rrMs })
  }
}

/**
 * BLE Heart Rate Service SEAM (0x180D service / 0x2A37 measurement).
 *
 * We deliberately do NOT add a native BLE dependency (noble/koffi BLE, etc.).
 * Two supported activation paths:
 *   1. RENDERER (recommended): the BiometricsView uses Web Bluetooth
 *      (navigator.bluetooth) to request the Heart Rate Service, subscribes to
 *      the 0x2A37 characteristic, and forwards each notification's bytes to the
 *      main process via the `bio:bleValue` IPC. `ingest()` parses them here with
 *      the shared, unit-tested parser. This keeps pairing in the only context
 *      that has the Web Bluetooth API.
 *   2. NATIVE (TODO): a future native transport could call `ingest()` directly
 *      with the raw characteristic value — no other change required.
 *
 * Until a feed arrives the source reports `hardwareConnected = false` so the UI
 * can clearly flag "waiting for a heart-rate monitor".
 */
export class WebBleHeartRateSource extends BaseHeartRateSource {
  readonly kind = 'ble' as const
  private running = false
  private lastValueAt = 0

  start(): void {
    this.running = true
  }

  stop(): void {
    this.running = false
    this.lastValueAt = 0
  }

  isHardwareConnected(): boolean {
    return this.running && Date.now() - this.lastValueAt < HARDWARE_TIMEOUT_MS
  }

  /** Parse + emit a raw 0x2A37 characteristic value pushed from the renderer. */
  ingest(bytes: ArrayLike<number>): void {
    if (!this.running) return
    const measurement = parseHeartRateMeasurement(bytes)
    if (!(measurement.heartRate > 0)) return
    this.lastValueAt = Date.now()
    this.emit({
      bpm: measurement.heartRate,
      t: this.lastValueAt,
      rrMs: measurement.rrIntervalsMs.length > 0 ? measurement.rrIntervalsMs : undefined
    })
  }
}

// ─── Service: ring buffer, lap/incident events, analysis, persistence ────────

interface ActiveSession {
  id: string
  startedAt: number
  source: HeartRateSourceKind
}

export class BiometricsService {
  private readonly liveGate = new LiveTelemetryGate()
  private source: HeartRateSource
  private unsubscribeSource: (() => void) | null = null
  private readonly samples: HrSample[] = []
  private readonly boundaries: LapBoundary[] = []
  private readonly events: BioEvent[] = []
  private running = false
  private baselineBpm = DEFAULT_HR_MODEL.restingBpm
  private lastBpm: number | undefined
  private lastState: StressState = 'calm'
  private session: ActiveSession | null = null

  // Telemetry-derived lap/incident tracking.
  private lastLap: number | undefined
  private lastIncidentCount: number | undefined
  private lastYellow = false
  private liveContextActive = false

  constructor(private readonly ctx: ModuleContext, private readonly sessionsPath: string) {
    this.source = new MockHeartRateSource(() => ctx.telemetryHub.getLatest())
    this.liveContextActive = this.liveGate.observe(ctx.telemetryHub.getLatest()).live
    ctx.telemetryHub.on('snapshot', (snapshot) => this.onTelemetry(snapshot))
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  start(kind?: HeartRateSourceKind): BioStatus {
    if (this.running && (!kind || kind === this.source.kind)) return this.status()
    if (this.running) this.stop()

    if (kind && kind !== this.source.kind) this.source = this.makeSource(kind)
    this.resetBuffers()
    this.session = { id: randomUUID(), startedAt: Date.now(), source: this.source.kind }
    this.baselineBpm = DEFAULT_HR_MODEL.restingBpm
    this.lastBpm = undefined
    this.events.push({ t: this.session.startedAt, kind: 'session', label: 'Session started' })

    this.unsubscribeSource = this.source.onReading((reading) => this.onReading(reading))
    this.source.start()
    this.running = true
    logger.info('biometrics', 'session started', { id: this.session.id, source: this.source.kind })
    this.broadcastStatus()
    return this.status()
  }

  stop(): BioStatus {
    if (!this.running) return this.status()
    this.source.stop()
    this.unsubscribeSource?.()
    this.unsubscribeSource = null
    this.running = false
    void this.persistSession().catch((error) => logger.warn('biometrics', 'persist failed', { error: String(error) }))
    logger.info('biometrics', 'session stopped', { id: this.session?.id, samples: this.samples.length })
    this.broadcastStatus()
    return this.status()
  }

  dispose(): void {
    if (this.running) this.stop()
  }

  /** Forward a raw BLE 0x2A37 value from the renderer to an active BLE source. */
  ingestBleValue(bytes: unknown): BioStatus {
    if (!this.liveContextActive) return this.status()
    const array = toByteArray(bytes)
    if (array && this.source instanceof WebBleHeartRateSource) {
      try {
        this.source.ingest(array)
      } catch (error) {
        logger.warn('biometrics', 'ble parse failed', { error: String(error) })
      }
    }
    return this.status()
  }

  // ── source readings ──────────────────────────────────────────────────────────

  private onReading(reading: HeartRateReading): void {
    if (!this.running || !this.liveContextActive) return
    this.lastBpm = reading.bpm
    // Seed the baseline on the first sample, then track it with a slow EMA so
    // "elevated/stressed" is measured against THIS driver's session resting HR.
    this.baselineBpm = this.samples.length === 0
      ? reading.bpm
      : this.baselineBpm + (reading.bpm - this.baselineBpm) * BASELINE_EMA_ALPHA

    this.samples.push({ t: reading.t, bpm: reading.bpm })
    if (this.samples.length > SAMPLE_BUFFER_LIMIT) this.samples.shift()

    const { state } = classifyStress(reading.bpm, this.baselineBpm)
    this.lastState = state

    const live: BioLiveSample = {
      t: reading.t,
      bpm: reading.bpm,
      source: this.source.kind,
      state,
      baselineBpm: Math.round(this.baselineBpm),
      ...(this.source.kind === 'mock'
        ? { intensity: drivingIntensity(intensityInputs(this.ctx.telemetryHub.getLatest())) }
        : {}),
      ...(reading.rrMs ? { rrMs: reading.rrMs } : {})
    }
    this.ctx.broadcast(BIO_CHANNELS.sample, live)
  }

  // ── telemetry → lap / incident / flag events ────────────────────────────────

  private onTelemetry(snapshot: TelemetrySnapshot | null): void {
    const live = this.liveGate.observe(snapshot)
    if (!live.live) {
      if (live.boundary) this.resetTelemetryBoundary()
      return
    }
    if (live.boundary) this.resetTelemetryBoundary()
    this.liveContextActive = true
    if (!this.running || !snapshot) return
    const now = Date.now()

    if (typeof snapshot.currentLap === 'number') {
      if (this.lastLap !== undefined && snapshot.currentLap > this.lastLap) {
        this.events.push({ t: now, kind: 'lap', lap: snapshot.currentLap, label: `Lap ${snapshot.currentLap}` })
        const lapTimeSec = snapshot.lastLapTimeSec
        if (typeof lapTimeSec === 'number' && lapTimeSec > 0) {
          this.boundaries.push({ lap: this.lastLap, startT: now - lapTimeSec * 1000, endT: now, lapTimeSec })
          if (this.boundaries.length > 200) this.boundaries.shift()
        }
      }
      this.lastLap = snapshot.currentLap
    }

    if (typeof snapshot.incidentCount === 'number') {
      if (this.lastIncidentCount !== undefined && snapshot.incidentCount > this.lastIncidentCount) {
        this.events.push({ t: now, kind: 'incident', label: 'Incidente' })
      }
      this.lastIncidentCount = snapshot.incidentCount
    }

    const yellow = Boolean(snapshot.flags?.yellow)
    if (yellow && !this.lastYellow) this.events.push({ t: now, kind: 'flag', label: 'Yellow flag' })
    this.lastYellow = yellow

    if (this.events.length > 400) this.events.splice(0, this.events.length - 400)
  }

  private resetTelemetryBoundary(): void {
    this.liveContextActive = false
    this.lastLap = undefined
    this.lastIncidentCount = undefined
    this.lastYellow = false
    this.lastBpm = undefined
    this.lastState = 'calm'
    if (this.running) this.broadcastStatus()
  }

  // ── queries ──────────────────────────────────────────────────────────────────

  status(): BioStatus {
    const hardwareConnected = this.source.isHardwareConnected()
    const note = this.running && this.source.kind === 'ble' && !hardwareConnected
      ? 'Waiting for BLE heart-rate monitor (pair through Web Bluetooth on the Biometrics screen).'
      : undefined
    return {
      running: this.running,
      sourceKind: this.source.kind,
      hardwareConnected,
      bpm: this.lastBpm,
      state: this.lastBpm !== undefined ? this.lastState : undefined,
      baselineBpm: Math.round(this.baselineBpm),
      sampleCount: this.samples.length,
      sessionId: this.session?.id,
      note
    }
  }

  series(): BioSeriesResult {
    const laps = aggregateLapBiometrics(this.samples, this.boundaries)
    const spikes = detectStressSpikes(this.samples)
    return {
      status: this.status(),
      samples: downsample(this.samples, SERIES_MAX_POINTS),
      laps,
      correlation: laps.length >= 3 ? correlatePaceHr(laps) : null,
      calm: calmUnderPressure(laps),
      spikes: alignSpikesToEvents(spikes, this.events)
    }
  }

  async listSessions(): Promise<BioSessionSummary[]> {
    return loadSessions(this.sessionsPath)
  }

  // ── internals ────────────────────────────────────────────────────────────────

  private makeSource(kind: HeartRateSourceKind): HeartRateSource {
    return kind === 'ble'
      ? new WebBleHeartRateSource()
      : new MockHeartRateSource(() => this.ctx.telemetryHub.getLatest())
  }

  private resetBuffers(): void {
    this.samples.length = 0
    this.boundaries.length = 0
    this.events.length = 0
    this.lastLap = undefined
    this.lastIncidentCount = undefined
    this.lastYellow = false
  }

  private broadcastStatus(): void {
    this.ctx.broadcast(BIO_CHANNELS.update, this.status())
  }

  private async persistSession(): Promise<void> {
    if (!this.session || this.samples.length === 0) return
    const laps = aggregateLapBiometrics(this.samples, this.boundaries)
    const calm = calmUnderPressure(laps)
    const correlation = laps.length >= 3 ? correlatePaceHr(laps) : null
    const bpms = this.samples.map((s) => s.bpm)
    const summary: BioSessionSummary = {
      id: this.session.id,
      startedAt: this.session.startedAt,
      endedAt: Date.now(),
      source: this.session.source,
      sampleCount: this.samples.length,
      avgBpm: Math.round(bpms.reduce((sum, value) => sum + value, 0) / bpms.length),
      maxBpm: Math.max(...bpms),
      laps: laps.length,
      ...(calm ? { calmScore: calm.score } : {}),
      ...(correlation ? { correlation: correlation.interpretation } : {})
    }
    const sessions = [summary, ...(await loadSessions(this.sessionsPath))].slice(0, MAX_SESSIONS)
    await mkdir(dirname(this.sessionsPath), { recursive: true })
    await writeFile(this.sessionsPath, `${JSON.stringify({ version: 1, sessions }, null, 2)}\n`, 'utf8')
  }
}

// ─── module registration ─────────────────────────────────────────────────────

export function register(ctx: ModuleContext): void {
  const service = new BiometricsService(ctx, join(ctx.app.getPath('userData'), SESSIONS_FILE))

  ctx.ipcMain.handle(BIO_CHANNELS.status, () => service.status())
  ctx.ipcMain.handle(BIO_CHANNELS.start, (_event, kind?: HeartRateSourceKind) => service.start(normalizeKind(kind)))
  ctx.ipcMain.handle(BIO_CHANNELS.stop, () => service.stop())
  ctx.ipcMain.handle(BIO_CHANNELS.series, () => service.series())
  ctx.ipcMain.handle(BIO_CHANNELS.sessions, () => service.listSessions())
  ctx.ipcMain.handle(BIO_CHANNELS.bleValue, (_event, bytes: unknown) => service.ingestBleValue(bytes))

  ctx.app.once('before-quit', () => service.dispose())
}

// ─── pure-ish helpers ────────────────────────────────────────────────────────

function intensityInputs(snapshot: TelemetrySnapshot | null): Parameters<typeof drivingIntensity>[0] {
  if (!isLiveTelemetrySnapshot(snapshot)) return {}
  return {
    speedKmh: snapshot.speedKmh,
    throttle: snapshot.throttle,
    brake: snapshot.brake,
    rpm: snapshot.rpm,
    maxRpm: snapshot.maxRpm,
    latAccelG: snapshot.latAccelG,
    longAccelG: snapshot.longAccelG,
    steerAngleDeg: snapshot.steerAngleDeg,
    nearbyCars: snapshot.radarCars?.length ?? proximityFromRelatives(snapshot),
    yellowFlag: snapshot.flags?.yellow
  }
}

function proximityFromRelatives(snapshot: TelemetrySnapshot | null): number {
  if (!snapshot?.relatives) return 0
  let count = 0
  if (snapshot.relatives.ahead && Math.abs(snapshot.relatives.ahead.gapSec ?? 9) < 1) count += 1
  if (snapshot.relatives.behind && Math.abs(snapshot.relatives.behind.gapSec ?? 9) < 1) count += 1
  return count
}

function normalizeKind(kind: unknown): HeartRateSourceKind | undefined {
  return kind === 'mock' || kind === 'ble' ? kind : undefined
}

function toByteArray(bytes: unknown): number[] | null {
  if (Array.isArray(bytes)) return bytes.map((value) => Number(value) & 0xff)
  if (bytes instanceof Uint8Array) return Array.from(bytes)
  if (bytes instanceof ArrayBuffer) return Array.from(new Uint8Array(bytes))
  return null
}

function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return DEFAULT_HR_MODEL.restingBpm
  return Math.min(210, Math.max(38, bpm))
}

function downsample(samples: readonly HrSample[], max: number): HrSample[] {
  if (samples.length <= max) return [...samples]
  const step = Math.ceil(samples.length / max)
  const out: HrSample[] = []
  for (let i = 0; i < samples.length; i += step) out.push(samples[i])
  const last = samples[samples.length - 1]
  if (out[out.length - 1]?.t !== last.t) out.push(last)
  return out
}

async function loadSessions(path: string): Promise<BioSessionSummary[]> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as { sessions?: unknown }
    if (!parsed || !Array.isArray(parsed.sessions)) return []
    return parsed.sessions.filter(isSessionSummary)
  } catch {
    return []
  }
}

function isSessionSummary(value: unknown): value is BioSessionSummary {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && typeof record.startedAt === 'number' && typeof record.sampleCount === 'number'
}
