import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, resolve, isAbsolute, basename, dirname } from 'node:path'
import { homedir } from 'node:os'
import { shell } from 'electron'
import type {
  AnalysisLap,
  AnalysisLapRef,
  AnalysisLapSample,
  AnalysisProfile,
  AnalysisRequest,
  AnalysisResult,
  RecordingConfig,
  ReferenceLap,
  ReferenceLapSummary,
  IbtFileInfo,
  IbtFileSummary,
  IbtLapSummary,
  RecordingSample,
  RecordingSessionSummary,
  RecordingStartOptions,
  RecordingStatus,
  TrackOption
} from '../../shared/recording'
import {
  DEFAULT_RECORDING_CONFIG,
  RECORDING_CHANNELS,
  mergeRecordingConfig
} from '../../shared/recording'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { UnitSystem } from '../../shared/units'
import type { ModuleContext } from '../module-context'
import { TelemetryRecorder } from '../recording/recorder'
import { analyze, colorForIndex } from '../analysis/engine'
import { parseAnalysisCsv } from '../analysis/csv'
import { buildInsights } from '../analysis/insights'
import { settingsEvents } from '../settings/events'
import { parseIbtLap, parseIbtSummary, type IbtSummary, type IbtTickSample } from '../analysis/ibt'
import {
  captureLiveTelemetryContext,
  isCurrentLiveTelemetryContext,
  LiveTelemetryGate,
  sameLiveTelemetryContext,
  type LiveTelemetryContext
} from '../../shared/replay'
import { logger } from './logger'

// ─────────────────────────────────────────────────────────────────────────────
// Módulo de gravação + análise.
//
// Mantém o recorder original (já existente) intacto e adiciona:
//   • Enricher: observa snapshots da sessão ativa e persiste `track.json`
//     ao lado do session.json — best-effort para guardar trackName/carName
//     da gravação sem editar o recorder.
//   • Listagem/leitura de `.ibt` do iRacing (pasta default: ~/Documents/iRacing/telemetry).
//   • Listagem de pistas únicas vindas das gravações + .ibt indexados.
//   • Pipeline de análise: aceita LapRefs (recording|ibt) e roda o engine.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_IBT_FOLDER = join(homedir(), 'Documents', 'iRacing', 'telemetry')
const MAX_IBT_LIST = 200
const MAX_LAPS_PER_ANALYSIS = 8
const MAX_REFERENCE_SAMPLES = 2500
const REFERENCES_FILE = 'references.json'
const RECORDING_CONFIG_FILE = 'recording-config.json'
const AUTO_RECORD_SAMPLE_RATE_HZ = 15

function recordingsDir(userData: string): string {
  return join(userData, 'recordings')
}

function recordingConfigPath(userData: string): string {
  return join(userData, RECORDING_CONFIG_FILE)
}

async function loadRecordingConfig(userData: string): Promise<RecordingConfig> {
  try {
    const raw = await readFile(recordingConfigPath(userData), 'utf8')
    return mergeRecordingConfig(DEFAULT_RECORDING_CONFIG, JSON.parse(raw) as Partial<RecordingConfig>)
  } catch {
    return { ...DEFAULT_RECORDING_CONFIG }
  }
}

async function saveRecordingConfig(userData: string, config: RecordingConfig): Promise<void> {
  const path = recordingConfigPath(userData)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

export interface EnricherEntry {
  trackName?: string
  trackShortName?: string
  carName?: string
  sim?: string
}

export type RecordingSidecarWriter = (
  sessionId: string,
  entry: Readonly<EnricherEntry>
) => Promise<void>

export interface RecordingSessionEnricher {
  observe(sessionId: string, snapshot: TelemetrySnapshot | null): void
  finalize(sessionId: string): Promise<void>
  forget(sessionId: string): Promise<void>
  pause(sessionId?: string): void
  resume(sessionId: string): void
  closeIntake(): void
  quiesce(): Promise<void>
}

export class SessionEnricher implements RecordingSessionEnricher {
  private readonly pending = new Map<string, NodeJS.Timeout>()
  private readonly cache = new Map<string, EnricherEntry>()
  private readonly writeTails = new Map<string, Promise<void>>()
  private readonly finalizeRequests = new Map<string, Promise<void>>()
  private readonly closedSessions = new Set<string>()
  private readonly forgottenSessions = new Set<string>()
  private closed = false

  constructor(
    userData: string,
    private readonly writeSidecar: RecordingSidecarWriter = async (sessionId, entry) => {
      const dir = join(userData, 'recordings', sessionId)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'track.json'), `${JSON.stringify(entry, null, 2)}\n`, 'utf8')
    }
  ) {}

  observe(sessionId: string, snapshot: TelemetrySnapshot | null): void {
    if (this.closed || this.closedSessions.has(sessionId)) return
    if (!snapshot || !snapshot.connected) return
    const previous = this.cache.get(sessionId) ?? {}
    const next: EnricherEntry = {
      trackName: snapshot.trackName?.trim() || previous.trackName,
      trackShortName: previous.trackShortName,
      carName: snapshot.carName?.trim() || previous.carName,
      sim: snapshot.sim || previous.sim
    }
    if (
      previous.trackName === next.trackName &&
      previous.carName === next.carName &&
      previous.sim === next.sim
    ) {
      return
    }
    this.cache.set(sessionId, next)
    this.scheduleFlush(sessionId)
  }

  finalize(sessionId: string): Promise<void> {
    const existing = this.finalizeRequests.get(sessionId)
    if (existing) return existing
    this.closedSessions.add(sessionId)
    const request = this.finalizeInternal(sessionId)
    this.finalizeRequests.set(sessionId, request)
    void request.then(
      () => {
        if (this.finalizeRequests.get(sessionId) === request) this.finalizeRequests.delete(sessionId)
      },
      () => {
        if (this.finalizeRequests.get(sessionId) === request) this.finalizeRequests.delete(sessionId)
      }
    )
    return request
  }

  async forget(sessionId: string): Promise<void> {
    this.forgottenSessions.add(sessionId)
    this.closedSessions.add(sessionId)
    this.pause(sessionId)
    await this.finalizeRequests.get(sessionId)?.catch(() => undefined)
    await this.writeTails.get(sessionId)
    this.purge(sessionId)
  }

  pause(sessionId?: string): void {
    const ids = sessionId ? [sessionId] : [...this.pending.keys()]
    for (const id of ids) {
      const timer = this.pending.get(id)
      if (timer) clearTimeout(timer)
      this.pending.delete(id)
    }
  }

  resume(sessionId: string): void {
    if (this.closed || this.closedSessions.has(sessionId)) return
    if (this.cache.has(sessionId) && !this.pending.has(sessionId)) this.scheduleFlush(sessionId)
  }

  closeIntake(): void {
    if (this.closed) return
    this.closed = true
    this.pause()
  }

  async quiesce(): Promise<void> {
    this.closeIntake()
    const sessionIds = new Set([
      ...this.cache.keys(),
      ...this.writeTails.keys(),
      ...this.finalizeRequests.keys()
    ])
    const results = await Promise.allSettled(
      [...sessionIds].map((sessionId) => this.finalize(sessionId))
    )
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason)
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Recording sidecars could not be finalized during teardown.')
    }
  }

  private scheduleFlush(sessionId: string): void {
    if (this.closedSessions.has(sessionId)) return
    const existing = this.pending.get(sessionId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.pending.delete(sessionId)
      void this.enqueueFlush(sessionId, true)
    }, 500)
    timer.unref?.()
    this.pending.set(sessionId, timer)
  }

  private async finalizeInternal(sessionId: string): Promise<void> {
    this.pause(sessionId)
    await this.writeTails.get(sessionId)
    if (this.forgottenSessions.has(sessionId)) {
      this.purge(sessionId)
      return
    }
    await this.enqueueFlush(sessionId, false, true)
    await this.writeTails.get(sessionId)
    this.purge(sessionId)
  }

  private enqueueFlush(
    sessionId: string,
    automatic: boolean,
    allowClosed = false
  ): Promise<void> {
    if (this.forgottenSessions.has(sessionId)) {
      return this.writeTails.get(sessionId) ?? Promise.resolve()
    }
    if (this.closedSessions.has(sessionId) && !allowClosed) {
      return this.writeTails.get(sessionId) ?? Promise.resolve()
    }
    const entry = this.cache.get(sessionId)
    if (!entry) return this.writeTails.get(sessionId) ?? Promise.resolve()
    const immutableEntry = { ...entry }
    const operation = (this.writeTails.get(sessionId) ?? Promise.resolve())
      .then(() => this.writeSidecar(sessionId, immutableEntry))
    const tail = operation.then(
      () => undefined,
      (error: unknown) => {
        logger.warn('recording-analysis', automatic
          ? 'automatic track sidecar flush failed'
          : 'final track sidecar flush failed', {
          message: error instanceof Error ? error.message : String(error)
        })
      }
    )
    this.writeTails.set(sessionId, tail)
    return automatic ? tail : operation
  }

  private purge(sessionId: string): void {
    this.pause(sessionId)
    this.cache.delete(sessionId)
    this.writeTails.delete(sessionId)
  }
}

async function readTrackSidecar(userData: string, sessionId: string): Promise<EnricherEntry | null> {
  try {
    const raw = await readFile(join(userData, 'recordings', sessionId, 'track.json'), 'utf8')
    return JSON.parse(raw) as EnricherEntry
  } catch {
    return null
  }
}

function trackKeyOf(name: string | undefined): string {
  if (!name) return '__unknown__'
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
}

function trackLabelOf(name: string | undefined): string {
  return name?.trim() || 'Pista desconhecida'
}

function isAllowedFolder(folder: string): boolean {
  // Aceita apenas caminhos absolutos sem `..`. Sem isso, um valor malicioso
  // vindo do renderer poderia escapar para fora de userData.
  const resolved = resolve(folder)
  if (!isAbsolute(resolved)) return false
  if (resolved.includes('..')) return false
  return true
}

function ensureIbtPath(path: string): string {
  if (typeof path !== 'string' || path.length === 0) throw new Error('Invalid .ibt path')
  const resolved = resolve(path)
  if (!resolved.toLowerCase().endsWith('.ibt')) throw new Error('File must have the .ibt extension')
  return resolved
}

async function listIbtFiles(folder: string): Promise<IbtFileInfo[]> {
  const dir = folder?.trim() || DEFAULT_IBT_FOLDER
  if (!isAllowedFolder(dir)) throw new Error('Invalid folder')
  let entries: string[]
  try {
    entries = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.ibt'))
      .map((entry) => entry.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  // Ordena por nome desc (iRacing usa timestamp no nome) para ter os mais
  // recentes primeiro — o usuário quase sempre quer a last sessão.
  entries.sort((a, b) => b.localeCompare(a))
  const limited = entries.slice(0, MAX_IBT_LIST)
  const infos: IbtFileInfo[] = []
  for (const name of limited) {
    const full = join(dir, name)
    try {
      const stats = await stat(full)
      infos.push({
        path: full,
        fileName: name,
        sizeBytes: stats.size,
        modifiedAt: stats.mtimeMs
      })
    } catch {
      // ignora arquivos que sumiram entre readdir e stat
    }
  }
  return infos
}

function summaryToFileSummary(summary: IbtSummary): IbtFileSummary {
  const laps: IbtLapSummary[] = summary.laps.map((lap) => ({
    lapIndex: lap.lapIndex,
    lapNumber: lap.lapNumber,
    startedAtSec: lap.startedAtSec ?? 0,
    endedAtSec: lap.endedAtSec,
    durationSec: lap.durationSec,
    sampleCount: lap.sampleCount,
    complete: lap.complete
  }))
  return {
    path: summary.path,
    fileName: summary.fileName,
    sizeBytes: summary.sizeBytes,
    modifiedAt: summary.modifiedAt,
    tickRate: summary.tickRate,
    numVars: summary.numVars,
    recordCount: summary.recordCount,
    durationSec: summary.durationSec,
    trackName: summary.trackName,
    trackShortName: summary.trackShortName,
    carName: summary.carName,
    sessionType: summary.sessionType,
    laps
  }
}

function ibtSampleToAnalysis(s: IbtTickSample): AnalysisLapSample {
  return {
    lapDistPct: s.lapDistPct,
    speedKmh: s.speedKmh,
    throttle: s.throttle,
    brake: s.brake,
    currentLapTimeSec: s.currentLapTimeSec,
    rpm: s.rpm,
    gear: s.gear
  }
}

function recordingSampleToAnalysis(s: RecordingSample): AnalysisLapSample {
  return {
    lapDistPct: s.lapDistPct,
    speedKmh: s.speedKmh,
    throttle: s.throttle,
    brake: s.brake,
    currentLapTimeSec: s.currentLapTimeSec,
    rpm: s.rpm,
    gear: s.gear
  }
}


function referencesDir(userData: string): string {
  return join(userData, 'analysis')
}

function referencesPath(userData: string): string {
  return join(referencesDir(userData), REFERENCES_FILE)
}

function referenceSummary(ref: ReferenceLap): ReferenceLapSummary {
  return {
    id: ref.id,
    label: ref.label,
    trackKey: ref.trackKey,
    carName: ref.carName,
    createdAt: ref.createdAt,
    source: ref.source,
    durationSec: ref.durationSec,
    sampleCount: ref.samples.length
  }
}

function downsampleSamples(samples: AnalysisLapSample[]): AnalysisLapSample[] {
  if (samples.length <= MAX_REFERENCE_SAMPLES) return samples
  const stride = Math.ceil(samples.length / MAX_REFERENCE_SAMPLES)
  const out = samples.filter((_, index) => index % stride === 0)
  // Always keep the final sample so the reference retains its 100%/end-of-lap
  // point instead of extrapolating stale values across the last bins.
  const last = samples[samples.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

async function readReferences(userData: string): Promise<ReferenceLap[]> {
  try {
    const raw = await readFile(referencesPath(userData), 'utf8')
    const parsed = JSON.parse(raw) as ReferenceLap[]
    return Array.isArray(parsed) ? parsed.filter((ref) => ref && typeof ref.id === 'string' && Array.isArray(ref.samples)) : []
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function writeReferences(userData: string, refs: ReferenceLap[]): Promise<void> {
  await mkdir(referencesDir(userData), { recursive: true })
  await writeFile(referencesPath(userData), `${JSON.stringify(refs, null, 2)}\n`, 'utf8')
}

async function saveReference(userData: string, ref: ReferenceLap): Promise<ReferenceLapSummary> {
  const refs = await readReferences(userData)
  refs.unshift(ref)
  await writeReferences(userData, refs)
  return referenceSummary(ref)
}

async function getReference(userData: string, id: string): Promise<ReferenceLap> {
  const refs = await readReferences(userData)
  const ref = refs.find((item) => item.id === id)
  if (!ref) throw new Error('Reference not found.')
  return ref
}

function referenceToAnalysisLap(ref: ReferenceLap, index: number): AnalysisLap {
  const fallbackRef: AnalysisLapRef = { source: 'recording', sessionId: `reference:${ref.id}`, lapIndex: 0, trackKey: ref.trackKey }
  return {
    id: `ref:${ref.id}`,
    ref: ref.ref ?? fallbackRef,
    label: `Reference · ${ref.label}`,
    source: ref.source === 'ibt' ? 'ibt' : 'recording',
    trackName: ref.trackKey,
    carName: ref.carName,
    durationSec: ref.durationSec,
    isBest: true,
    color: colorForIndex(index),
    samples: ref.samples
  }
}

async function resolveAnalysisLaps(
  request: AnalysisRequest,
  userData: string,
  recorder: TelemetryRecorder
): Promise<AnalysisLap[]> {
  if (!request || !Array.isArray(request.laps) || request.laps.length === 0) {
    throw new Error('At least one lap must be selected for analysis.')
  }
  if (request.laps.length > MAX_LAPS_PER_ANALYSIS) {
    throw new Error(`Limit of ${MAX_LAPS_PER_ANALYSIS} laps per analysis exceeded.`)
  }
  const resolvedLaps: AnalysisLap[] = []
  for (let i = 0; i < request.laps.length; i += 1) {
    const ref = request.laps[i]
    try {
      const lap = await buildAnalysisLap(ref, i, userData, recorder)
      if (lap) resolvedLaps.push(lap)
    } catch (error) {
      console.warn('[recording-analysis] failed to load lap:', error)
    }
  }
  if (resolvedLaps.length === 0) {
    throw new Error('No valid lap could be loaded for analysis.')
  }
  return resolvedLaps
}

function durationFromSamples(samples: AnalysisLapSample[]): number | undefined {
  const first = samples.find((sample) => typeof sample.currentLapTimeSec === 'number')
  const last = [...samples].reverse().find((sample) => typeof sample.currentLapTimeSec === 'number')
  if (!first || !last || first.currentLapTimeSec === undefined || last.currentLapTimeSec === undefined) return undefined
  const duration = last.currentLapTimeSec - first.currentLapTimeSec
  return Number.isFinite(duration) && duration > 0 ? duration : undefined
}

async function buildAnalysisLap(
  ref: AnalysisLapRef,
  index: number,
  userData: string,
  recorder: TelemetryRecorder
): Promise<AnalysisLap | null> {
  if (ref.source === 'recording') {
    const samples = await recorder.getLap(ref.sessionId, ref.lapIndex)
    if (samples.length === 0) return null
    const sidecar = await readTrackSidecar(userData, ref.sessionId)
    const sessions = await recorder.listSessions()
    const session = sessions.find((s) => s.id === ref.sessionId)
    const lapMeta = session?.laps.find((l) => l.lapIndex === ref.lapIndex)
    const lapNumber = lapMeta?.lapNumber ?? ref.lapIndex + 1
    const trackName = sidecar?.trackName
    const carName = sidecar?.carName
    const when = session ? new Date(session.startedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ref.sessionId
    return {
      id: `rec:${ref.sessionId}:${ref.lapIndex}`,
      ref,
      label: `Recording · ${when} · Lap ${lapNumber}`,
      source: 'recording',
      trackName,
      carName,
      lapNumber,
      durationSec: lapMeta?.durationSec,
      isBest: false,
      color: colorForIndex(index),
      samples: samples.map(recordingSampleToAnalysis)
    }
  }

  const resolved = ensureIbtPath(ref.path)
  const data = await parseIbtLap(resolved, ref.lapIndex)
  if (data.samples.length === 0) return null
  return {
    id: `ibt:${resolved}:${ref.lapIndex}`,
    ref: { ...ref, path: resolved },
    label: `${basename(resolved)} · Lap ${data.lap.lapNumber ?? data.lap.lapIndex + 1}`,
    source: 'ibt',
    trackName: data.trackName,
    carName: data.carName,
    lapNumber: data.lap.lapNumber,
    durationSec: data.lap.durationSec,
    isBest: false,
    color: colorForIndex(index),
    samples: data.samples.map(ibtSampleToAnalysis)
  }
}

async function listTracks(
  userData: string,
  recorder: TelemetryRecorder,
  folder?: string
): Promise<TrackOption[]> {
  const map = new Map<string, TrackOption>()

  const sessions = await recorder.listSessions()
  for (const session of sessions) {
    const sidecar = await readTrackSidecar(userData, session.id)
    const label = trackLabelOf(sidecar?.trackName)
    const key = trackKeyOf(sidecar?.trackName)
    const lapCount = session.laps.filter((l) => l.complete).length
    const entry = map.get(key) ?? { key, label, sources: [], lapCount: 0 }
    if (!entry.sources.includes('recording')) entry.sources = [...entry.sources, 'recording']
    entry.lapCount += lapCount
    map.set(key, entry)
  }

  const ibtDir = folder?.trim() || DEFAULT_IBT_FOLDER
  if (isAllowedFolder(ibtDir)) {
    try {
      const files = await listIbtFiles(ibtDir)
      for (const file of files) {
        try {
          const summary = await parseIbtSummary(file.path)
          const label = trackLabelOf(summary.trackName)
          const key = trackKeyOf(summary.trackName)
          const lapCount = summary.laps.filter((l) => l.complete).length
          const entry = map.get(key) ?? { key, label, sources: [], lapCount: 0 }
          if (!entry.sources.includes('ibt')) entry.sources = [...entry.sources, 'ibt']
          entry.lapCount += lapCount
          map.set(key, entry)
        } catch {
          // Arquivos corrompidos não impedem a listagem do resto
        }
      }
    } catch {
      // Pasta inacessível: best-effort
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.key === '__unknown__') return 1
    if (b.key === '__unknown__') return -1
    return a.label.localeCompare(b.label, 'pt-BR')
  })
}

export interface RecordingLifecycleRecorder {
  status(): RecordingStatus
  start(
    options?: RecordingStartOptions,
    isCurrent?: () => boolean,
    contextKey?: string | null
  ): Promise<RecordingStatus>
  cancelPendingStart(): void
  settlePendingStart(): Promise<void>
  quiesce(): void
  stop(): Promise<RecordingStatus>
  deleteSession(sessionId: string): Promise<void>
  onSnapshot(snapshot: TelemetrySnapshot | null): void
}

export type RecordingLifecycleMode = 'live' | 'suspended' | 'stopped'

export interface RecordingReconcileTarget {
  mode: RecordingLifecycleMode
  recording: boolean
  context: LiveTelemetryContext | null
  snapshot: TelemetrySnapshot | null
  options: RecordingStartOptions
}

interface DesiredRecordingTarget extends RecordingReconcileTarget {
  automatic: boolean
  operation: string
}

interface ReconcileWaiter {
  version: number
  resolve(status: RecordingStatus): void
  reject(error: unknown): void
}

function sameRecordingTarget(left: RecordingReconcileTarget, right: RecordingReconcileTarget): boolean {
  const sameContext =
    (!left.context && !right.context) || sameLiveTelemetryContext(left.context, right.context)
  return (
    left.mode === right.mode &&
    left.recording === right.recording &&
    sameContext &&
    left.options.sampleRateHz === right.options.sampleRateHz
  )
}

function sameRecordingSessionContext(
  left: LiveTelemetryContext | null | undefined,
  right: LiveTelemetryContext | null | undefined
): boolean {
  if (!left || !right) return false
  if (left.connectionEpoch !== right.connectionEpoch) return false
  if (left.sessionIdentity !== right.sessionIdentity) return false
  return left.sessionIdentity !== undefined || left.token === right.token
}

function recordingContextKey(context: LiveTelemetryContext): string {
  return `${context.connectionEpoch}:${context.revision}:${context.token}:${context.sessionIdentity ?? ''}`
}

export class RecordingLifecycleCoordinator {
  private desired: DesiredRecordingTarget = {
    mode: 'stopped',
    recording: false,
    context: null,
    snapshot: null,
    options: {},
    automatic: true,
    operation: 'recording initialization'
  }
  private desiredVersion = 0
  private reconciledVersion = 0
  private activeContext: LiveTelemetryContext | null = null
  private lifecycleQueue: Promise<void> | null = null
  private readonly waiters: ReconcileWaiter[] = []
  private closed = false
  private seedNextStart = false
  private pendingFinalizationSessionId: string | null = null
  private pendingFinalizationFailure: unknown
  private readonly terminalFailures: unknown[] = []

  constructor(
    private readonly recorder: RecordingLifecycleRecorder,
    private readonly enricher: RecordingSessionEnricher,
    private readonly getLatestSnapshot: () => TelemetrySnapshot | null,
    private readonly broadcastStatus: () => void,
    private readonly reportFailure: (operation: string, error: unknown) => void
  ) {}

  requestAutomatic(target: RecordingReconcileTarget, operation: string): void {
    this.updateTarget(target, true, operation, false)
  }

  requestUser(target: RecordingReconcileTarget, operation: string): Promise<RecordingStatus> {
    if (this.closed) return Promise.reject(new Error('Recording lifecycle is shutting down.'))
    return this.updateTarget(target, false, operation, true) ?? Promise.resolve(this.recorder.status())
  }

  observeLiveSnapshot(snapshot: TelemetrySnapshot, context: LiveTelemetryContext): void {
    if (this.closed || !sameRecordingSessionContext(this.activeContext, context)) return
    this.activeContext = { ...context }
    this.recorder.onSnapshot(snapshot)
    const activeSessionId = this.recorder.status().activeSession?.id
    if (activeSessionId) this.enricher.observe(activeSessionId, snapshot)
  }

  observeNonLiveSnapshot(snapshot: TelemetrySnapshot | null): void {
    if (this.closed) return
    this.recorder.onSnapshot(snapshot)
    this.enricher.pause(this.recorder.status().activeSession?.id)
  }

  resumeActiveEnricher(): void {
    if (this.closed) return
    const activeSessionId = this.recorder.status().activeSession?.id
    if (activeSessionId) this.enricher.resume(activeSessionId)
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (this.closed) throw new Error('Recording lifecycle is shutting down.')
    if (this.recorder.status().activeSession?.id === sessionId) {
      throw new Error('Cannot delete an active recording')
    }
    await this.enricher.forget(sessionId)
    await this.recorder.deleteSession(sessionId)
  }

  quiesce(): void {
    if (this.closed) return
    this.closed = true
    this.recorder.quiesce()
    this.enricher.closeIntake()
    this.recorder.cancelPendingStart()
    this.desired = {
      mode: 'stopped',
      recording: false,
      context: null,
      snapshot: null,
      options: this.desired.options,
      automatic: true,
      operation: 'recording teardown'
    }
    this.desiredVersion += 1
  }

  async shutdown(): Promise<void> {
    if (!this.closed) this.quiesce()
    this.launchWorker()
    await this.whenIdle()
    if (this.recorder.status().recording || this.pendingFinalizationSessionId) {
      this.desiredVersion += 1
      this.launchWorker()
      await this.whenIdle()
    }
    let enricherFailure: unknown
    try {
      await this.enricher.quiesce()
      this.pendingFinalizationSessionId = null
      this.pendingFinalizationFailure = undefined
    } catch (error) {
      enricherFailure = error
    }
    if (this.recorder.status().recording || this.pendingFinalizationSessionId) {
      enricherFailure ??= this.pendingFinalizationFailure ??
        new Error('Active recording metadata or sidecar could not be finalized during teardown.')
    }
    const failures = [...this.terminalFailures]
    if (enricherFailure) failures.push(enricherFailure)
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Recording persistence teardown failed.')
    }
  }

  async whenIdle(): Promise<void> {
    while (this.lifecycleQueue) {
      const queue = this.lifecycleQueue
      await queue
      if (this.lifecycleQueue === queue) await Promise.resolve()
    }
  }

  private updateTarget(
    target: RecordingReconcileTarget,
    automatic: boolean,
    operation: string,
    force: boolean
  ): Promise<RecordingStatus> | undefined {
    if (this.closed) return undefined
    const previous = this.desired
    const changed = !sameRecordingTarget(previous, target)
    const shouldQueue = changed || force || (!this.lifecycleQueue && !this.targetSatisfied(target))

    if (!shouldQueue) {
      this.desired = { ...previous, snapshot: target.snapshot }
      return undefined
    }

    this.desired = {
      ...target,
      context: target.context ? { ...target.context } : null,
      automatic,
      operation
    }
    const version = ++this.desiredVersion
    if (changed) this.recorder.cancelPendingStart()

    let request: Promise<RecordingStatus> | undefined
    if (!automatic) {
      request = new Promise<RecordingStatus>((resolve, reject) => {
        this.waiters.push({ version, resolve, reject })
      })
    }
    this.launchWorker()
    return request
  }

  private targetSatisfied(target: RecordingReconcileTarget): boolean {
    if (target.mode === 'suspended') return true
    if (target.mode === 'stopped' || !target.recording) {
      return !this.recorder.status().recording && !this.pendingFinalizationSessionId
    }
    return (
      !this.pendingFinalizationSessionId &&
      this.recorder.status().recording &&
      sameRecordingSessionContext(this.activeContext, target.context)
    )
  }

  private launchWorker(): void {
    if (this.lifecycleQueue || this.reconciledVersion >= this.desiredVersion) return
    this.lifecycleQueue = this.createWorker()
  }

  private createWorker(): Promise<void> {
    let queue!: Promise<void>
    queue = this.runWorker()
      .catch((error: unknown) => {
        this.report(this.desired.operation, error)
        if (this.closed) this.rememberTerminalFailure(error)
        this.reconciledVersion = this.desiredVersion
        this.settleWaiters(this.reconciledVersion, error)
      })
      .then(() => {
        if (this.lifecycleQueue !== queue) return
        if (this.reconciledVersion < this.desiredVersion) {
          this.lifecycleQueue = this.createWorker()
        } else {
          this.lifecycleQueue = null
        }
      })
    return queue
  }

  private async runWorker(): Promise<void> {
    while (this.reconciledVersion < this.desiredVersion) {
      const version = this.desiredVersion
      const target = this.desired
      let failure: unknown
      try {
        await this.reconcile(target, version)
      } catch (error) {
        failure = error
        this.report(target.operation, error)
      }
      this.reconciledVersion = version
      this.settleWaiters(version, failure)
    }
  }

  private async reconcile(target: DesiredRecordingTarget, version: number): Promise<void> {
    if (target.mode === 'suspended') {
      this.recorder.cancelPendingStart()
      await this.recorder.settlePendingStart()
      return
    }
    if (target.mode === 'stopped' || !target.recording) {
      this.seedNextStart = false
      await this.stopAndFinalize()
      return
    }
    if (!target.context || !target.snapshot) return

    if (this.pendingFinalizationSessionId) await this.stopAndFinalize()
    if (
      this.recorder.status().recording &&
      !sameRecordingSessionContext(this.activeContext, target.context)
    ) {
      this.seedNextStart = true
      await this.stopAndFinalize()
    }
    if (!this.targetIsCurrent(target, version)) return

    if (!this.recorder.status().recording) {
      const status = await this.recorder.start(
        target.options,
        () => this.targetIsCurrent(target, version),
        recordingContextKey(target.context)
      )
      if (!status.recording) return
    }
    if (!this.targetIsCurrent(target, version)) return

    this.activeContext = { ...target.context }
    if (this.seedNextStart) {
      const latestSnapshot =
        sameLiveTelemetryContext(this.desired.context, target.context) && this.desired.snapshot
          ? this.desired.snapshot
          : target.snapshot
      this.recorder.onSnapshot(latestSnapshot)
      const activeSessionId = this.recorder.status().activeSession?.id
      if (activeSessionId) this.enricher.observe(activeSessionId, latestSnapshot)
      this.seedNextStart = false
    }
    this.broadcastStatus()
  }

  private targetIsCurrent(target: DesiredRecordingTarget, version: number): boolean {
    return (
      !this.closed &&
      version === this.desiredVersion &&
      this.desired.mode === 'live' &&
      this.desired.recording &&
      sameLiveTelemetryContext(this.desired.context, target.context) &&
      isCurrentLiveTelemetryContext(this.getLatestSnapshot(), target.context)
    )
  }

  private async stopAndFinalize(): Promise<void> {
    this.recorder.cancelPendingStart()
    const previous = this.recorder.status().activeSession?.id ?? this.pendingFinalizationSessionId
    let stopFailure: unknown
    let finalizeFailure: unknown
    try {
      await this.recorder.stop()
    } catch (error) {
      stopFailure = error
    }

    const stopped = !this.recorder.status().recording
    if (stopped) this.activeContext = null
    if (previous && stopped) {
      this.pendingFinalizationSessionId = previous
      try {
        await this.enricher.finalize(previous)
        this.pendingFinalizationSessionId = null
        this.pendingFinalizationFailure = undefined
      } catch (error) {
        finalizeFailure = error
        this.pendingFinalizationFailure = error
      }
    }
    this.broadcastStatus()

    if (stopFailure && stopped) this.rememberTerminalFailure(stopFailure)
    if (stopFailure) throw stopFailure
    if (finalizeFailure) throw finalizeFailure
  }

  private rememberTerminalFailure(error: unknown): void {
    if (!this.terminalFailures.includes(error)) this.terminalFailures.push(error)
  }

  private settleWaiters(version: number, failure?: unknown): void {
    const due = this.waiters.filter((waiter) => waiter.version <= version)
    if (due.length === 0) return
    for (const waiter of due) {
      const index = this.waiters.indexOf(waiter)
      if (index >= 0) this.waiters.splice(index, 1)
      if (failure) waiter.reject(failure)
      else waiter.resolve(this.recorder.status())
    }
  }

  private report(operation: string, error: unknown): void {
    try {
      this.reportFailure(operation, error)
    } catch {
      // Diagnostics must not break the resolved lifecycle queue tail.
    }
  }
}

export function register(ctx: ModuleContext): void {
  const userData = ctx.app.getPath('userData')
  const recorder = new TelemetryRecorder(userData)
  const enricher = new SessionEnricher(userData)
  let unitSystem: UnitSystem = 'metric'
  settingsEvents.onChanged((settings) => {
    unitSystem = settings.unitSystem
  })

  // Persisted recording config (auto-record default ON). Loaded async; we gate
  // auto-start on `configLoaded` so a snapshot arriving in the tiny load window
  // never auto-starts for a user who saved autoRecord:false (R19-m3).
  let recordingConfig: RecordingConfig = { ...DEFAULT_RECORDING_CONFIG }
  let configLoaded = false
  // Latch: once the user manually stops (or auto-record is off), suppress
  // auto-restart until telemetry disconnects (a new session). Without this the
  // very next snapshot would re-start recording, making "Parar gravação" appear
  // to do nothing while auto-record is on (R19-M1).
  let autoStartSuppressed = false
  let recordingIntent = false
  let recordingOptions: RecordingStartOptions = { sampleRateHz: AUTO_RECORD_SAMPLE_RATE_HZ }
  let lastLiveContext: LiveTelemetryContext | null = null
  let lastLiveSnapshot: TelemetrySnapshot | null = null
  const liveGate = new LiveTelemetryGate()

  const broadcastStatus = (): void => {
    ctx.broadcast('recording:statusChanged', recorder.status())
  }

  const reportLifecycleFailure = (operation: string, error: unknown): void => {
    logger.warn('recording-analysis', `${operation} failed`, {
      message: error instanceof Error ? error.message : String(error)
    })
  }

  const lifecycle = new RecordingLifecycleCoordinator(
    recorder,
    enricher,
    () => ctx.telemetryHub.getLatest(),
    broadcastStatus,
    reportLifecycleFailure
  )

  const liveTarget = (
    snapshot: TelemetrySnapshot,
    context: LiveTelemetryContext,
    recording = recordingIntent
  ): RecordingReconcileTarget => ({
    mode: 'live',
    recording,
    context,
    snapshot,
    options: { ...recordingOptions }
  })

  const suspendedTarget = (): RecordingReconcileTarget => ({
    mode: 'suspended',
    recording: recordingIntent,
    context: lastLiveContext,
    snapshot: lastLiveSnapshot,
    options: { ...recordingOptions }
  })

  const stoppedTarget = (): RecordingReconcileTarget => ({
    mode: 'stopped',
    recording: false,
    context: null,
    snapshot: null,
    options: { ...recordingOptions }
  })

  const requestAutoRecordingForLatest = (): void => {
    const snapshot = ctx.telemetryHub.getLatest()
    const context = captureLiveTelemetryContext(snapshot)
    if (!snapshot || !context || !recordingConfig.autoRecord || autoStartSuppressed) return
    if (!recordingIntent) {
      recordingIntent = true
      recordingOptions = { sampleRateHz: AUTO_RECORD_SAMPLE_RATE_HZ }
    }
    lastLiveContext = context
    lastLiveSnapshot = snapshot
    lifecycle.requestAutomatic(liveTarget(snapshot, context), 'automatic recording start')
  }

  void loadRecordingConfig(userData).then((loaded) => {
    recordingConfig = loaded
    configLoaded = true
    requestAutoRecordingForLatest()
  }).catch((error: unknown) => {
    reportLifecycleFailure('automatic recording configuration load', error)
  })

  ctx.telemetryHub.on('snapshot', (snapshot) => {
    const live = liveGate.observe(snapshot)
    if (!live.live) {
      lifecycle.observeNonLiveSnapshot(snapshot)
      if (!live.boundary) return
      if (live.state === 'disconnected') {
        autoStartSuppressed = false
        recordingIntent = false
        recordingOptions = { sampleRateHz: AUTO_RECORD_SAMPLE_RATE_HZ }
        lifecycle.requestAutomatic(stoppedTarget(), 'automatic recording finalization')
      } else {
        lifecycle.requestAutomatic(suspendedTarget(), 'automatic recording suspension')
      }
      return
    }
    if (!snapshot || !live.context) return
    if (live.sessionChanged) autoStartSuppressed = false
    if (live.enteredLive) lifecycle.resumeActiveEnricher()
    if (configLoaded && recordingConfig.autoRecord && !autoStartSuppressed && !recordingIntent) {
      recordingIntent = true
      recordingOptions = { sampleRateHz: AUTO_RECORD_SAMPLE_RATE_HZ }
    }
    lastLiveContext = live.context
    lastLiveSnapshot = snapshot
    lifecycle.requestAutomatic(
      liveTarget(snapshot, live.context),
      live.sessionChanged ? 'automatic recording rotation' : 'automatic recording reconciliation'
    )
    lifecycle.observeLiveSnapshot(snapshot, live.context)
  })

  ctx.registerGracefulTeardown(() => lifecycle.quiesce(), 'quiesce')
  ctx.registerGracefulTeardown(() => lifecycle.shutdown(), 'persistence')

  ctx.ipcMain.handle(RECORDING_CHANNELS.getConfig, () => recordingConfig)

  ctx.ipcMain.handle(RECORDING_CHANNELS.setConfig, async (_event, patch?: Partial<RecordingConfig>): Promise<RecordingConfig> => {
    recordingConfig = mergeRecordingConfig(recordingConfig, patch && typeof patch === 'object' ? patch : {})
    await saveRecordingConfig(userData, recordingConfig)
    ctx.broadcast(RECORDING_CHANNELS.configEvent, recordingConfig)
    if (recordingConfig.autoRecord) requestAutoRecordingForLatest()
    return recordingConfig
  })

  ctx.ipcMain.handle(RECORDING_CHANNELS.openFolder, async (): Promise<string> => {
    const dir = recordingsDir(userData)
    await mkdir(dir, { recursive: true })
    // shell.openPath returns '' on success, or an error message string.
    return shell.openPath(dir)
  })

  ctx.ipcMain.handle('recording:start', async (_event, options?: RecordingStartOptions) => {
    // Manual start clears the latch — the user explicitly wants to record again.
    const snapshot = ctx.telemetryHub.getLatest()
    const context = captureLiveTelemetryContext(snapshot)
    if (!snapshot || !context) throw new Error('Recording is available only for live telemetry.')
    autoStartSuppressed = false
    recordingIntent = true
    recordingOptions = { ...(options ?? {}) }
    lastLiveContext = context
    lastLiveSnapshot = snapshot
    return lifecycle.requestUser(liveTarget(snapshot, context), 'user recording start')
  })

  ctx.ipcMain.handle('recording:stop', async () => {
    // Latch off auto-restart until telemetry disconnects, so a manual stop sticks
    // for the rest of the current session even with auto-record enabled (R19-M1).
    autoStartSuppressed = true
    recordingIntent = false
    return lifecycle.requestUser(stoppedTarget(), 'user recording stop')
  })

  ctx.ipcMain.handle('recording:status', () => recorder.status())
  ctx.ipcMain.handle('recording:listSessions', async () => {
    const sessions = await recorder.listSessions()
    return Promise.all(
      sessions.map(async (session): Promise<RecordingSessionSummary & EnricherEntry> => {
        const sidecar = await readTrackSidecar(userData, session.id)
        return { ...session, ...(sidecar ?? {}) }
      })
    )
  })
  ctx.ipcMain.handle('recording:getLap', (_event, sessionId: string, lapIndex: number) =>
    recorder.getLap(sessionId, lapIndex)
  )
  ctx.ipcMain.handle('recording:deleteSession', async (_event, sessionId: string) => {
    await lifecycle.deleteSession(sessionId)
    return recorder.listSessions()
  })

  ctx.ipcMain.handle('recording:listIbt', async (_event, folder?: string) => listIbtFiles(folder ?? ''))
  ctx.ipcMain.handle('recording:loadIbt', async (_event, path: string) => {
    const resolved = ensureIbtPath(path)
    const summary = await parseIbtSummary(resolved)
    return summaryToFileSummary(summary)
  })
  ctx.ipcMain.handle('recording:listTracks', async (_event, folder?: string) =>
    listTracks(userData, recorder, folder)
  )
  ctx.ipcMain.handle('recording:defaultIbtFolder', () => DEFAULT_IBT_FOLDER)

  ctx.ipcMain.handle('recording:references:list', async (): Promise<ReferenceLapSummary[]> => {
    const refs = await readReferences(userData)
    return refs.map(referenceSummary)
  })

  ctx.ipcMain.handle('recording:references:get', async (_event, id: string): Promise<ReferenceLap> =>
    getReference(userData, id)
  )

  ctx.ipcMain.handle('recording:references:delete', async (_event, id: string): Promise<ReferenceLapSummary[]> => {
    const refs = await readReferences(userData)
    await writeReferences(userData, refs.filter((ref) => ref.id !== id))
    return (await readReferences(userData)).map(referenceSummary)
  })

  ctx.ipcMain.handle(
    'recording:references:saveFromLap',
    async (_event, input: AnalysisLapRef | { ref: AnalysisLapRef; label?: string }, labelArg?: string): Promise<ReferenceLapSummary> => {
      if (!input || typeof input !== 'object') throw new Error('Invalid lap reference.')
      const ref = 'ref' in input ? input.ref : input
      const label = 'ref' in input ? input.label : labelArg
      const lap = await buildAnalysisLap(ref, 0, userData, recorder)
      if (!lap) throw new Error('Invalid lap for reference.')
      const reference: ReferenceLap = {
        id: randomUUID(),
        label: label?.trim() || `${lap.trackName ?? 'Pista'} · ${lap.label}`,
        trackKey: ref.trackKey ?? trackKeyOf(lap.trackName),
        carName: lap.carName,
        createdAt: Date.now(),
        source: lap.source,
        ref,
        durationSec: lap.durationSec,
        samples: downsampleSamples(lap.samples)
      }
      return saveReference(userData, reference)
    }
  )

  ctx.ipcMain.handle(
    'recording:importCsv',
    async (_event, path: string): Promise<{ summary: ReferenceLapSummary; samples: AnalysisLapSample[] }> => {
      if (typeof path !== 'string' || path.trim().length === 0) throw new Error('Invalid CSV path.')
      const resolved = resolve(path)
      if (!resolved.toLowerCase().endsWith('.csv')) throw new Error('File must have the .csv extension')
      const samples = parseAnalysisCsv(await readFile(resolved, 'utf8'))
      const reference: ReferenceLap = {
        id: randomUUID(),
        label: basename(resolved),
        createdAt: Date.now(),
        source: 'csv',
        durationSec: durationFromSamples(samples),
        samples: downsampleSamples(samples)
      }
      const summary = await saveReference(userData, reference)
      return { summary, samples: reference.samples }
    }
  )

  ctx.ipcMain.handle('recording:analyze', async (_event, request: AnalysisRequest): Promise<AnalysisResult> => {
    const profile: AnalysisProfile = request.profile ?? 'compareBest'
    const resolvedLaps = await resolveAnalysisLaps(request, userData, recorder)
    const firstWithTrack = resolvedLaps.find((l) => l.trackName)
    const trackLabel = trackLabelOf(firstWithTrack?.trackName)
    const trackKey = request.trackKey ?? trackKeyOf(firstWithTrack?.trackName)
    return analyze(resolvedLaps, profile, { trackKey, trackLabel, unitSystem })
  })

  ctx.ipcMain.handle('recording:insights', async (_event, request: AnalysisRequest): Promise<AnalysisResult> => {
    const profile: AnalysisProfile = request.profile ?? 'lossMap'
    const resolvedLaps = await resolveAnalysisLaps(request, userData, recorder)
    const primaryLapId = resolvedLaps[0].id
    let referenceLapId: string | null = null
    if (request.referenceId) {
      const reference = await getReference(userData, request.referenceId)
      const referenceLap = referenceToAnalysisLap(reference, resolvedLaps.length)
      referenceLapId = referenceLap.id
      resolvedLaps.push(referenceLap)
    }
    const firstWithTrack = resolvedLaps.find((l) => l.trackName)
    const trackLabel = trackLabelOf(firstWithTrack?.trackName)
    const trackKey = request.trackKey ?? trackKeyOf(firstWithTrack?.trackName)
    const result = analyze(resolvedLaps, profile, { trackKey, trackLabel, unitSystem })
    const insights = buildInsights(result, primaryLapId, referenceLapId ?? result.bestLapId, unitSystem)
    return { ...result, insights }
  })
}

export { DEFAULT_IBT_FOLDER }
