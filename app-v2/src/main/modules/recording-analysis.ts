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
  TrackOption
} from '../../shared/recording'
import {
  DEFAULT_RECORDING_CONFIG,
  RECORDING_CHANNELS,
  mergeRecordingConfig
} from '../../shared/recording'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { ModuleContext } from '../module-context'
import { TelemetryRecorder } from '../recording/recorder'
import { analyze, colorForIndex } from '../analysis/engine'
import { parseAnalysisCsv } from '../analysis/csv'
import { buildInsights } from '../analysis/insights'
import { parseIbtLap, parseIbtSummary, type IbtSummary, type IbtTickSample } from '../analysis/ibt'

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

interface EnricherEntry {
  trackName?: string
  trackShortName?: string
  carName?: string
  sim?: string
}

class SessionEnricher {
  private readonly userData: string
  private readonly pending = new Map<string, NodeJS.Timeout>()
  private readonly cache = new Map<string, EnricherEntry>()

  constructor(userData: string) {
    this.userData = userData
  }

  observe(sessionId: string, snapshot: TelemetrySnapshot | null): void {
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

  finalize(sessionId: string): void {
    this.flush(sessionId).catch(() => undefined)
  }

  private scheduleFlush(sessionId: string): void {
    const existing = this.pending.get(sessionId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.pending.delete(sessionId)
      this.flush(sessionId).catch(() => undefined)
    }, 500)
    timer.unref?.()
    this.pending.set(sessionId, timer)
  }

  private async flush(sessionId: string): Promise<void> {
    const entry = this.cache.get(sessionId)
    if (!entry) return
    const dir = join(this.userData, 'recordings', sessionId)
    try {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'track.json'), `${JSON.stringify(entry, null, 2)}\n`, 'utf8')
    } catch (error) {
      console.warn('[recording-analysis] track sidecar flush failed:', error)
    }
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
  if (typeof path !== 'string' || path.length === 0) throw new Error('Caminho .ibt inválido')
  const resolved = resolve(path)
  if (!resolved.toLowerCase().endsWith('.ibt')) throw new Error('Arquivo precisa ter extensão .ibt')
  return resolved
}

async function listIbtFiles(folder: string): Promise<IbtFileInfo[]> {
  const dir = folder?.trim() || DEFAULT_IBT_FOLDER
  if (!isAllowedFolder(dir)) throw new Error('Pasta inválida')
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
  // recentes primeiro — o usuário quase sempre quer a última sessão.
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
  if (!ref) throw new Error('Referência não encontrada.')
  return ref
}

function referenceToAnalysisLap(ref: ReferenceLap, index: number): AnalysisLap {
  const fallbackRef: AnalysisLapRef = { source: 'recording', sessionId: `reference:${ref.id}`, lapIndex: 0, trackKey: ref.trackKey }
  return {
    id: `ref:${ref.id}`,
    ref: ref.ref ?? fallbackRef,
    label: `Referência · ${ref.label}`,
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
    throw new Error('Pelo menos uma volta deve ser selecionada para análise.')
  }
  if (request.laps.length > MAX_LAPS_PER_ANALYSIS) {
    throw new Error(`Limite de ${MAX_LAPS_PER_ANALYSIS} voltas por análise excedido.`)
  }
  const resolvedLaps: AnalysisLap[] = []
  for (let i = 0; i < request.laps.length; i += 1) {
    const ref = request.laps[i]
    try {
      const lap = await buildAnalysisLap(ref, i, userData, recorder)
      if (lap) resolvedLaps.push(lap)
    } catch (error) {
      console.warn('[recording-analysis] falha ao carregar volta:', error)
    }
  }
  if (resolvedLaps.length === 0) {
    throw new Error('Nenhuma volta válida pôde ser carregada para análise.')
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
      label: `Gravação · ${when} · Volta ${lapNumber}`,
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
    label: `${basename(resolved)} · Volta ${data.lap.lapNumber ?? data.lap.lapIndex + 1}`,
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

export function register(ctx: ModuleContext): void {
  const userData = ctx.app.getPath('userData')
  const recorder = new TelemetryRecorder(userData)
  const enricher = new SessionEnricher(userData)

  // Persisted recording config (auto-record default ON). Loaded async; we gate
  // auto-start on `configLoaded` so a snapshot arriving in the tiny load window
  // never auto-starts for a user who saved autoRecord:false (R19-m3).
  let recordingConfig: RecordingConfig = { ...DEFAULT_RECORDING_CONFIG }
  let configLoaded = false
  let autoStarting = false
  // Latch: once the user manually stops (or auto-record is off), suppress
  // auto-restart until telemetry disconnects (a new session). Without this the
  // very next snapshot would re-start recording, making "Parar gravação" appear
  // to do nothing while auto-record is on (R19-M1).
  let autoStartSuppressed = false

  void loadRecordingConfig(userData).then((loaded) => {
    recordingConfig = loaded
    configLoaded = true
  })

  const broadcastStatus = (): void => {
    ctx.broadcast('recording:statusChanged', recorder.status())
  }

  // Auto-start: when autoRecord is on, telemetry is live, and nothing is recording
  // yet, kick off a recording. start() is async + idempotent (returns current
  // status if already active), so we guard with `autoStarting` to avoid launching
  // multiple concurrent starts from the high-frequency snapshot stream.
  const maybeAutoStart = (snapshot: TelemetrySnapshot | null): void => {
    // Telemetry disconnected → this session is over. Clear the manual-stop latch
    // so the NEXT session (reconnect) can auto-start again.
    if (!snapshot?.connected) {
      autoStartSuppressed = false
      return
    }
    if (!configLoaded) return
    if (!recordingConfig.autoRecord) return
    if (autoStartSuppressed) return
    if (autoStarting || recorder.status().recording) return
    autoStarting = true
    void recorder
      .start({ sampleRateHz: AUTO_RECORD_SAMPLE_RATE_HZ })
      .then(() => broadcastStatus())
      .catch((error: unknown) => {
        console.warn('[recording-analysis] auto-start failed:', error)
      })
      .finally(() => {
        autoStarting = false
      })
  }

  ctx.telemetryHub.on('snapshot', (snapshot) => {
    maybeAutoStart(snapshot)
    recorder.onSnapshot(snapshot)
    const status = recorder.status()
    if (status.recording && status.activeSession) {
      enricher.observe(status.activeSession.id, snapshot)
    }
  })

  ctx.ipcMain.handle(RECORDING_CHANNELS.getConfig, () => recordingConfig)

  ctx.ipcMain.handle(RECORDING_CHANNELS.setConfig, async (_event, patch?: Partial<RecordingConfig>): Promise<RecordingConfig> => {
    recordingConfig = mergeRecordingConfig(recordingConfig, patch && typeof patch === 'object' ? patch : {})
    await saveRecordingConfig(userData, recordingConfig)
    ctx.broadcast(RECORDING_CHANNELS.configEvent, recordingConfig)
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
    autoStartSuppressed = false
    const status = await recorder.start(options)
    broadcastStatus()
    return status
  })

  ctx.ipcMain.handle('recording:stop', async () => {
    // Latch off auto-restart until telemetry disconnects, so a manual stop sticks
    // for the rest of the current session even with auto-record enabled (R19-M1).
    autoStartSuppressed = true
    const previous = recorder.status().activeSession?.id
    const status = await recorder.stop()
    if (previous) enricher.finalize(previous)
    broadcastStatus()
    return status
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
    await recorder.deleteSession(sessionId)
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
      if (!input || typeof input !== 'object') throw new Error('Referência de volta inválida.')
      const ref = 'ref' in input ? input.ref : input
      const label = 'ref' in input ? input.label : labelArg
      const lap = await buildAnalysisLap(ref, 0, userData, recorder)
      if (!lap) throw new Error('Volta inválida para referência.')
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
      if (typeof path !== 'string' || path.trim().length === 0) throw new Error('Caminho CSV inválido.')
      const resolved = resolve(path)
      if (!resolved.toLowerCase().endsWith('.csv')) throw new Error('Arquivo precisa ter extensão .csv')
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
    return analyze(resolvedLaps, profile, { trackKey, trackLabel })
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
    const result = analyze(resolvedLaps, profile, { trackKey, trackLabel })
    const insights = buildInsights(result, primaryLapId, referenceLapId ?? result.bestLapId)
    return { ...result, insights }
  })
}

export { DEFAULT_IBT_FOLDER }
