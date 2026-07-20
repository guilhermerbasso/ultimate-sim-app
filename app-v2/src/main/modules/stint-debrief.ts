// STINT/SESSION DEBRIEF module (WS-I) — main process.
//
// register(ctx) detects stint/session boundaries, snapshots the ended session's
// deterministic Coach + Predictions facts, composes the debrief in main, and
// persists the automatic last debrief plus a bounded immutable analysis archive,
// independently of whether the Coach view is mounted. The immutable
// `debrief:trigger` broadcast remains available for diagnostics/compatibility.
//
// The composition itself is fully deterministic (`composeDebrief` in
// shared/stint-debrief.ts). The local Qwen LLM is OPTIONAL and only PHRASES the
// deterministic facts ON DEMAND (`useLlm`), reusing the shared `getLlmRuntime`
// singleton and only when a model is already on disk — it is NEVER loaded or run
// from the telemetry loop, and ALWAYS falls back to the deterministic text.

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { ModuleContext } from '../module-context'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { UnitSystem } from '../../shared/units'
import {
  DEBRIEF_ARCHIVE_RECORD_SCHEMA,
  DEBRIEF_ARCHIVE_MAX_RECORD_BYTES,
  DEBRIEF_ARCHIVE_VERSION,
  DEBRIEF_CHANNELS,
  composeDebrief,
  debriefAnalysisStatus,
  debriefLlmFacts,
  debriefSetupStatus,
  normalizeDebriefArchiveGenerateRequest,
  normalizeDebriefArchiveRecord,
  normalizeStintDebrief,
  type DebriefArchiveGenerateResult,
  type DebriefArchiveRecord,
  type DebriefGenerateRequest,
  type DebriefReason,
  type DebriefTriggerPayload,
  type StintDebrief
} from '../../shared/stint-debrief'
import { getLlmRuntime } from '../ai/llm-runtime'
import { getModelManager } from '../ai/model-manager'
import { logger } from './logger'
import { settingsEvents } from '../settings/events'
import { LiveTelemetryGate, type LiveTelemetryContext } from '../../shared/replay'
import { speechLanguageFromAppLanguage, type SpeechLanguage } from '../../shared/tts-voice'
import { coachComparableIdentityFromSnapshot } from '../../shared/coach-racecraft'
import { getLatestPredictions } from './predictions'
import {
  getLatestLapCoachAnalysis,
  type LapCoachFindingsContext
} from './coach'
import {
  getLatestCoachFindingsForContext,
  type FindingsContext
} from './proactive-engineer'
import type { SetupReport } from '../../shared/setup-advisor'
import type { AppLanguage } from '../../shared/settings'
import {
  StintDebriefArchiveStore,
  type StintDebriefArchivePersistence
} from './stint-debrief-archive'

const LOG_AREA = 'ai'
// Hard cap so an optional LLM phrasing stays a SHORT debrief, never an essay.
const PHRASE_MAX_TOKENS = 160
// Only treat a pit-in as a stint boundary once the driver has actually run laps.
const MIN_STINT_LAPS = 2
const LAST_DEBRIEF_FILE = 'stint-debrief.json'
const DEBRIEF_ARCHIVE_FILE = 'stint-debrief-archive.json'

export interface StintDebriefDependencies {
  phrase?(system: string, prompt: string): Promise<string | null>
  loadPersisted?(filePath: string): Promise<unknown>
  writePersisted?(filePath: string, payload: string): Promise<void>
  getFindings?(snapshot?: LapCoachFindingsContext | null): DebriefTriggerPayload['findings']
  getAnalysis?(snapshot?: LapCoachFindingsContext | null): {
    findings: DebriefTriggerPayload['findings']
    setup: SetupReport | null
  }
  getPredictions?(context?: LiveTelemetryContext | null): DebriefTriggerPayload['predictions']
  loadArchive?: StintDebriefArchivePersistence['load']
  writeArchive?: StintDebriefArchivePersistence['write']
  createArchiveId?(): string
  now?(): number
}

type DebriefVisibilityState = 'pending' | 'durable' | 'failed' | 'superseded'

interface DebriefVisibility {
  generation: number
  state: DebriefVisibilityState
  debrief?: StintDebrief
  error?: unknown
  completion: Promise<void>
  complete(): void
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

// ─── optional LLM phrasing (deterministic fallback always works) ──────────────

async function tryLlmPhrase(system: string, prompt: string): Promise<string | null> {
  try {
    // Only phrase with the model if it is ALREADY present on disk — never trigger
    // a (~1 GB) download from a debrief, and never block on the network.
    const modelPath = getModelManager().getActiveModelPath()
    if (!modelPath) return null

    const runtime = getLlmRuntime()
    runtime.setOptions({ modelPath, maxTokens: PHRASE_MAX_TOKENS, temperature: 0.3 })
    const result = await runtime.generate({ system, prompt, maxTokens: PHRASE_MAX_TOKENS, temperature: 0.3 })
    if (result.ok) {
      const text = (result.text ?? '').trim()
      return text.length > 0 ? text : null
    }
    return null
  } catch (error) {
    logger.warn(LOG_AREA, 'debrief phrase LLM unavailable', { message: error instanceof Error ? error.message : String(error) })
    return null
  }
}

function phrasePrompt(
  facts: string,
  unitSystem: UnitSystem,
  language: SpeechLanguage
): { system: string; prompt: string } {
  const pt = language === 'pt-BR'
  const units =
    unitSystem === 'imperial'
      ? pt
        ? 'Use somente unidades imperiais dos EUA.'
        : 'Use US customary units only.'
      : pt
        ? 'Use somente unidades métricas.'
        : 'Use metric units only.'
  const system = pt
    ? `Você é um engenheiro de corrida no rádio. Reescreva o resumo abaixo em português do Brasil, em 2 a 4 frases curtas, com tom calmo, executivo e encorajador. Diga onde o piloto perdeu tempo, onde foi bem e os pontos de estratégia. Não invente números nem curvas — use somente os fatos fornecidos. ${units}`
    : `You are a race engineer on the radio. Rewrite the debrief below in American English, in 2 to 4 short sentences, with a calm, executive, encouraging tone. Mention where the driver lost time, where they did well, and the strategy points. Do NOT invent numbers or turns — use only the given facts. ${units}`
  return { system, prompt: `${facts}\n\n${pt ? 'Resumo' : 'Debrief'}:` }
}

/**
 * Historical phrasing is accepted only when its normalized content is unchanged.
 * Any attempted omission, reordering, or addition falls back to the persisted
 * deterministic paragraph, so a model cannot synthesize a setup recommendation.
 */
function safeHistoricalPhrase(source: string, candidate: string): string | null {
  const text = candidate.trim()
  if (!text || text.length > 16_384) return null
  const normalize = (value: string): string =>
    value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
  return normalize(text) === normalize(source) ? text : null
}

function historicalPhrasePrompt(
  paragraph: string,
  unitSystem: UnitSystem,
  language: SpeechLanguage
): { system: string; prompt: string } {
  const base = phrasePrompt(paragraph, unitSystem, language)
  const extractive = language === 'pt-BR'
    ? 'Retorne o parágrafo fornecido exatamente como está, sem acrescentar, omitir ou reordenar conteúdo.'
    : 'Return the supplied paragraph exactly as written, without adding, omitting, or reordering content.'
  return { ...base, system: `${base.system} ${extractive}` }
}

// ─── stint/session boundary detection (telemetry-driven) ──────────────────────

interface BoundaryState {
  prevOnPitRoad: boolean
  prevConnected: boolean
  prevSessionType?: string
  prevTrackName?: string
  lapAtStintStart: number
  lastLap: number
}

interface DebriefSnapshotMetadata extends LapCoachFindingsContext, FindingsContext {
  sim?: TelemetrySnapshot['sim']
  trackId?: string | number
  trackName?: string
  trackConfigName?: string
  carName?: string
  carPath?: string
  sessionType?: string
  sessionUniqueId?: number
  sessionIdentity?: string
  connectionEpoch?: number
  trackWetnessPct?: number
  isRaining?: boolean
  weatherDeclaredWet?: boolean
  completedLaps?: number
  currentLap?: number
  bestLapTimeSec?: number
  liveContext?: LiveTelemetryContext
}

interface CapturedDebriefMetadata {
  language: SpeechLanguage
  unitSystem: UnitSystem
  appLanguage: AppLanguage
  locale: string
}

interface CapturedBoundary {
  capturedAt: number
  trigger: DebriefTriggerPayload
  setup: SetupReport | null
  metadata: CapturedDebriefMetadata
}

function newBoundaryState(): BoundaryState {
  return {
    prevOnPitRoad: false,
    prevConnected: false,
    prevSessionType: undefined,
    prevTrackName: undefined,
    lapAtStintStart: 0,
    lastLap: 0
  }
}

/** Decide whether this snapshot crosses a stint/session boundary. */
function detectBoundary(state: BoundaryState, snap: TelemetrySnapshot | null): Exclude<DebriefReason, 'manual'> | null {
  if (!snap) {
    if (state.prevConnected) {
      state.prevConnected = false
      return 'session-end'
    }
    return null
  }

  const lap = finite(snap.currentLap) ? snap.currentLap : state.lastLap
  if (!state.prevConnected) {
    state.prevOnPitRoad = snap.onPitRoad === true
    state.prevConnected = snap.connected !== false
    state.prevSessionType = snap.sessionType
    state.prevTrackName = snap.trackName
    state.lapAtStintStart = lap
    state.lastLap = lap
    return null
  }
  let reason: Exclude<DebriefReason, 'manual'> | null = null

  // Session/track CHANGED (new session, switched track) → session boundary.
  const sessionChanged =
    (state.prevConnected && snap.sessionType !== undefined && state.prevSessionType !== undefined && snap.sessionType !== state.prevSessionType) ||
    (snap.trackName !== undefined && state.prevTrackName !== undefined && snap.trackName !== state.prevTrackName)
  if (sessionChanged) reason = 'session-end'

  // Pit-in after a real stint (onPitRoad false→true) → stint boundary.
  const pitIn = snap.onPitRoad === true && state.prevOnPitRoad === false
  if (!reason && pitIn && lap - state.lapAtStintStart >= MIN_STINT_LAPS) reason = 'stint-end'

  // Advance bookkeeping.
  if (snap.onPitRoad === true && state.prevOnPitRoad === false) {
    // entering pit — next stint starts when we leave.
  }
  if (snap.onPitRoad === false && state.prevOnPitRoad === true) {
    state.lapAtStintStart = lap
  }
  state.prevOnPitRoad = snap.onPitRoad === true
  state.prevConnected = snap.connected !== false
  state.prevSessionType = snap.sessionType
  state.prevTrackName = snap.trackName
  state.lastLap = lap

  return reason
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function normalizePersistedStintDebrief(value: unknown): StintDebrief | null {
  if (!value || typeof value !== 'object') return null
  const candidate = cloneJson(value as Partial<StintDebrief>)
  return normalizeStintDebrief({
    ...candidate,
    language: candidate.language ?? 'en-US'
  })
}

function triggerPayload(
  reason: Exclude<DebriefReason, 'manual'>,
  snapshot: DebriefSnapshotMetadata | null,
  findings: DebriefTriggerPayload['findings'],
  predictions: DebriefTriggerPayload['predictions']
): DebriefTriggerPayload {
  return {
    reason,
    findings: cloneJson(findings),
    predictions: cloneJson(predictions),
    sessionInfo: {
      trackName: snapshot?.trackName,
      carName: snapshot?.carName,
      sessionType: snapshot?.sessionType,
      lapsCompleted: finite(snapshot?.completedLaps) ? snapshot?.completedLaps : snapshot?.currentLap,
      bestLapTimeSec: snapshot?.bestLapTimeSec,
      reason
    }
  }
}

function debriefSnapshotMetadata(
  snapshot: TelemetrySnapshot,
  liveContext: LiveTelemetryContext | null
): DebriefSnapshotMetadata {
  return {
    sim: snapshot.sim,
    trackId: snapshot.trackId,
    trackName: snapshot.trackName,
    trackConfigName: snapshot.trackConfigName,
    carName: snapshot.carName,
    carPath: snapshot.carPath,
    sessionType: snapshot.sessionType,
    sessionUniqueId: snapshot.sessionUniqueId,
    sessionIdentity: snapshot.replayContext?.sessionIdentity,
    connectionEpoch: snapshot.replayContext?.connectionEpoch,
    condition: coachComparableIdentityFromSnapshot(snapshot).condition,
    trackWetnessPct: snapshot.trackWetnessPct,
    isRaining: snapshot.isRaining,
    weatherDeclaredWet: snapshot.weatherDeclaredWet,
    completedLaps: snapshot.completedLaps,
    currentLap: snapshot.currentLap,
    bestLapTimeSec: snapshot.bestLapTimeSec,
    ...(liveContext ? { liveContext: { ...liveContext } } : {})
  }
}

function getAutomaticDebriefAnalysis(
  snapshot?: DebriefSnapshotMetadata | null
): { findings: DebriefTriggerPayload['findings']; setup: SetupReport | null } {
  const lapAnalysis = getLatestLapCoachAnalysis(snapshot)
  if (lapAnalysis) return lapAnalysis
  return { findings: getLatestCoachFindingsForContext(snapshot), setup: null }
}

function normalizedLocale(locale: string | null | undefined, fallback: SpeechLanguage): string {
  const value = locale?.trim()
  return value ? value.slice(0, 64) : fallback
}

function createOpaqueArchiveId(factory?: () => string): string {
  const candidate = factory
    ? factory()
    : `debrief_${randomUUID().replaceAll('-', '')}`
  if (!/^debrief_[A-Za-z0-9_-]{16,96}$/.test(candidate)) {
    throw new Error('Stint debrief archive ID factory returned an invalid opaque ID.')
  }
  return candidate
}

function legacyArchiveId(debrief: StintDebrief): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(debrief))
    .digest('hex')
    .slice(0, 32)
  return `debrief_legacy_${digest}`
}

function archiveRecordFromBoundary(
  capture: CapturedBoundary,
  debrief: StintDebrief,
  id: string
): DebriefArchiveRecord {
  const record = normalizeDebriefArchiveRecord({
    schema: DEBRIEF_ARCHIVE_RECORD_SCHEMA,
    version: DEBRIEF_ARCHIVE_VERSION,
    id,
    capturedAt: capture.capturedAt,
    reason: capture.trigger.reason,
    sessionInfo: capture.trigger.sessionInfo,
    findings: capture.trigger.findings,
    predictions: capture.trigger.predictions,
    setup: capture.setup,
    debrief,
    language: capture.metadata.language,
    unitSystem: capture.metadata.unitSystem,
    appLanguage: capture.metadata.appLanguage,
    locale: capture.metadata.locale,
    captureSource: 'boundary',
    metadataQuality: 'captured'
  })
  if (!record) throw new Error('Captured stint debrief archive record failed strict validation.')
  return record
}

function archiveRecordFromLegacy(debrief: StintDebrief): DebriefArchiveRecord {
  const sessionInfo = {
    ...(debrief.sessionInfo ?? {}),
    reason: debrief.reason
  }
  const record = normalizeDebriefArchiveRecord({
    schema: DEBRIEF_ARCHIVE_RECORD_SCHEMA,
    version: DEBRIEF_ARCHIVE_VERSION,
    id: legacyArchiveId(debrief),
    capturedAt: debrief.generatedAt,
    reason: debrief.reason,
    sessionInfo,
    findings: [],
    predictions: null,
    setup: null,
    debrief: {
      ...debrief,
      sessionInfo
    },
    language: debrief.language,
    unitSystem: 'metric',
    appLanguage: debrief.language === 'pt-BR' ? 'pt-BR' : 'en',
    locale: debrief.language,
    captureSource: 'legacy-last-debrief',
    metadataQuality: 'legacy-defaults'
  })
  if (!record) throw new Error('Legacy stint debrief could not be migrated safely.')
  return record
}

// ─── registration ─────────────────────────────────────────────────────────────

export function register(ctx: ModuleContext, dependencies: StintDebriefDependencies = {}): void {
  let latest: StintDebrief | null = null
  let latestVersion = 0
  let latestAcceptedVersion = 0
  let unitSystem: UnitSystem = 'metric'
  let language: SpeechLanguage = 'en-US'
  let appLanguage: AppLanguage = 'auto'
  let intakeClosed = false
  let closing = false
  let writeSequence = 0
  let writeQueue: Promise<void> = Promise.resolve()
  let latestFailedWrite: {
    version: number
    debrief: StintDebrief
    error: unknown
    visibility: DebriefVisibility
  } | null = null
  let latestAcceptedVisibility: DebriefVisibility | null = null
  const inFlightCompositions = new Set<Promise<StintDebrief>>()
  const filePath = join(ctx.app.getPath('userData'), LAST_DEBRIEF_FILE)
  const archivePath = join(ctx.app.getPath('userData'), DEBRIEF_ARCHIVE_FILE)
  const archiveStore = new StintDebriefArchiveStore(archivePath, {
    load: dependencies.loadArchive,
    write: dependencies.writeArchive
  })
  const now = dependencies.now ?? Date.now
  const phrase = async (system: string, prompt: string): Promise<string | null> => {
    try {
      return await (dependencies.phrase ?? tryLlmPhrase)(system, prompt)
    } catch (error) {
      logger.warn(LOG_AREA, 'debrief phrase LLM failed; using deterministic fallback', {
        message: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }
  const offSettings = settingsEvents.onChanged((settings) => {
    unitSystem = settings.unitSystem
    appLanguage = settings.language
    language = speechLanguageFromAppLanguage(settings.language, ctx.app.getLocale())
  })

  const beginVisibilityAttempt = (visibility: DebriefVisibility): void => {
    let complete!: () => void
    visibility.state = 'pending'
    visibility.error = undefined
    visibility.completion = new Promise<void>((resolve) => {
      complete = resolve
    })
    visibility.complete = complete
  }

  const createVisibility = (generation: number): DebriefVisibility => {
    const visibility: DebriefVisibility = {
      generation,
      state: 'pending',
      completion: Promise.resolve(),
      complete: () => undefined
    }
    beginVisibilityAttempt(visibility)
    return visibility
  }

  const completeVisibility = (
    visibility: DebriefVisibility,
    state: Exclude<DebriefVisibilityState, 'pending'>,
    debrief?: StintDebrief,
    error?: unknown
  ): void => {
    visibility.state = state
    visibility.debrief = debrief
    visibility.error = error
    visibility.complete()
  }

  const loadPromise = (
    dependencies.loadPersisted
      ? dependencies.loadPersisted(filePath)
      : readFile(filePath, 'utf8').then((raw) => {
          if (Buffer.byteLength(raw, 'utf8') > DEBRIEF_ARCHIVE_MAX_RECORD_BYTES) {
            throw new Error('Persisted stint debrief exceeds its local storage size cap.')
          }
          return JSON.parse(raw) as unknown
        })
  )
    .then((parsed) => {
      const persisted = normalizePersistedStintDebrief(parsed)
      if (latestVersion === 0 && persisted) latest = persisted
    })
    .catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return
      logger.warn(LOG_AREA, 'failed to load persisted stint debrief', {
        message: error instanceof Error ? error.message : String(error)
      })
    })

  const archiveInitialization = Promise.all([loadPromise, archiveStore.ready()])
    .then(async () => {
      if (latest && await archiveStore.wasMissingOnLoad()) {
        await archiveStore.migrate(archiveRecordFromLegacy(latest))
      }
    })
    .catch((error: unknown) => {
      logger.warn(LOG_AREA, 'failed to initialize persisted stint debrief archive', {
        message: error instanceof Error ? error.message : String(error)
      })
    })

  const writePersisted = dependencies.writePersisted ?? (async (
    targetPath: string,
    payload: string
  ): Promise<void> => {
    const tempPath = `${targetPath}.${process.pid}.${++writeSequence}.tmp`
    try {
      await mkdir(dirname(targetPath), { recursive: true })
      await writeFile(tempPath, payload, 'utf8')
      await rename(tempPath, targetPath)
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined)
      throw error
    }
  })

  const persist = (
    debrief: StintDebrief,
    version: number,
    visibility: DebriefVisibility
  ): Promise<void> => {
    const immutableDebrief = cloneJson(debrief)
    const payload = `${JSON.stringify(immutableDebrief, null, 2)}\n`
    const operation = writeQueue.then(() => writePersisted(filePath, payload))
    const trackedOperation = operation.then(
      () => {
        if (latestFailedWrite && latestFailedWrite.version <= version) latestFailedWrite = null
      },
      (error: unknown) => {
        if (!latestFailedWrite || version >= latestFailedWrite.version) {
          latestFailedWrite = {
            version,
            debrief: immutableDebrief,
            error,
            visibility
          }
        }
        throw error
      }
    )
    writeQueue = trackedOperation.then(
      () => undefined,
      () => undefined
    )
    return trackedOperation
  }

  const commitDurable = (
    debrief: StintDebrief,
    version: number,
    broadcast: boolean
  ): void => {
    if (version !== latestAcceptedVersion) return
    latestVersion = Math.max(latestVersion + 1, version)
    latest = cloneJson(debrief)
    if (broadcast && !intakeClosed && !closing) {
      ctx.broadcast(DEBRIEF_CHANNELS.updated, cloneJson(debrief))
    }
  }

  const retryLatestFailedWrite = async (): Promise<void> => {
    const failed = latestFailedWrite
    if (!failed) return
    beginVisibilityAttempt(failed.visibility)
    try {
      await persist(failed.debrief, failed.version, failed.visibility)
    } catch {
      // The preserved error below is the authoritative teardown failure.
    }
    await writeQueue
    if (latestFailedWrite) {
      completeVisibility(
        latestFailedWrite.visibility,
        'failed',
        latestFailedWrite.debrief,
        latestFailedWrite.error
      )
      const message = latestFailedWrite.error instanceof Error
        ? latestFailedWrite.error.message
        : String(latestFailedWrite.error)
      throw new Error(`Stint debrief durability failed during teardown: ${message}`, {
        cause: latestFailedWrite.error
      })
    }
    commitDurable(failed.debrief, failed.version, false)
    completeVisibility(failed.visibility, 'durable', failed.debrief)
  }

  const composeAndPersist = async (
    immutableRequest: DebriefGenerateRequest,
    automatic: boolean,
    acceptedVersion: number,
    visibility: DebriefVisibility,
    capturedMetadata?: CapturedDebriefMetadata,
    capturedAt?: number
  ): Promise<StintDebrief> => {
    const reason: DebriefReason = immutableRequest.sessionInfo?.reason ?? 'manual'
    const compositionLanguage = capturedMetadata?.language ?? language
    const compositionUnitSystem = capturedMetadata?.unitSystem ?? unitSystem
    const composition = composeDebrief(
      immutableRequest.findings,
      immutableRequest.predictions,
      immutableRequest.sessionInfo,
      compositionUnitSystem,
      compositionLanguage
    )

    let text = composition.text
    let source: StintDebrief['source'] = 'deterministic'

    if (!automatic && immutableRequest.useLlm === true) {
      const facts = debriefLlmFacts(composition)
      if (facts.trim().length > 0) {
        const { system, prompt } = phrasePrompt(facts, compositionUnitSystem, compositionLanguage)
        const llmText = await phrase(system, prompt)
        if (llmText) {
          text = llmText
          source = 'llm'
        }
      }
    }

    const next: StintDebrief = {
      generatedAt: capturedAt ?? now(),
      text,
      bullets: [...composition.bullets],
      source,
      language: compositionLanguage,
      reason,
      sessionInfo: immutableRequest.sessionInfo ? cloneJson(immutableRequest.sessionInfo) : undefined
    }
    if (acceptedVersion !== latestAcceptedVersion) {
      completeVisibility(visibility, 'superseded')
      return cloneJson(next)
    }
    await persist(next, acceptedVersion, visibility)
    completeVisibility(visibility, 'durable', next)
    commitDurable(next, acceptedVersion, true)
    return cloneJson(next)
  }

  const acceptComposition = (
    request: DebriefGenerateRequest = {},
    automatic = false,
    capturedMetadata?: CapturedDebriefMetadata,
    capturedAt?: number
  ): Promise<StintDebrief> => {
    if (intakeClosed) return Promise.reject(new Error('Stint debrief lifecycle is shutting down.'))
    const acceptedVersion = ++latestAcceptedVersion
    const immutableRequest = cloneJson(request)
    const visibility = createVisibility(acceptedVersion)
    const operation = Promise.resolve().then(async () => {
      await loadPromise
      return composeAndPersist(
        immutableRequest,
        automatic,
        acceptedVersion,
        visibility,
        capturedMetadata,
        capturedAt
      )
    }).catch((error: unknown) => {
      if (visibility.state === 'pending') {
        const failedDebrief = latestFailedWrite?.visibility === visibility
          ? latestFailedWrite.debrief
          : undefined
        completeVisibility(visibility, 'failed', failedDebrief, error)
      }
      throw error
    })
    latestAcceptedVisibility = visibility
    inFlightCompositions.add(operation)
    void operation.then(
      () => inFlightCompositions.delete(operation),
      () => inFlightCompositions.delete(operation)
    )
    return operation
  }

  const readLatestAcceptedVisibility = async (): Promise<StintDebrief | null> => {
    await loadPromise
    while (latestAcceptedVisibility) {
      const visibility = latestAcceptedVisibility
      const generation = visibility.generation
      const completion = visibility.completion
      await completion
      if (
        latestAcceptedVisibility?.generation !== generation ||
        visibility.completion !== completion
      ) {
        continue
      }
      if (visibility.state === 'durable' && visibility.debrief) {
        return cloneJson(visibility.debrief)
      }
      if (visibility.state === 'failed') {
        throw visibility.error ?? new Error('Latest stint debrief did not become durable.')
      }
      throw new Error('Latest stint debrief visibility did not settle durably.')
    }
    return latest ? cloneJson(latest) : null
  }

  const boundary = newBoundaryState()
  const liveGate = new LiveTelemetryGate()
  let lastLiveSnapshot: DebriefSnapshotMetadata | null = null
  let suspendedTrigger: CapturedBoundary | null = null
  const inFlightArchiveWrites = new Set<Promise<void>>()
  const getAnalysis = dependencies.getAnalysis ?? (
    dependencies.getFindings
      ? (snapshot?: DebriefSnapshotMetadata | null) => ({
          findings: dependencies.getFindings?.(snapshot) ?? [],
          setup: null
        })
      : getAutomaticDebriefAnalysis
  )
  const getPredictions = dependencies.getPredictions ?? getLatestPredictions
  const captureMetadata = (): CapturedDebriefMetadata => ({
    language,
    unitSystem,
    appLanguage,
    locale: normalizedLocale(ctx.app.getLocale(), language)
  })
  const createCapturedBoundary = (
    reason: Exclude<DebriefReason, 'manual'>,
    snapshot: DebriefSnapshotMetadata | null
  ): CapturedBoundary => {
    const analysis = getAnalysis(snapshot)
    return {
      capturedAt: now(),
      trigger: triggerPayload(
        reason,
        snapshot,
        analysis.findings,
        getPredictions(snapshot?.liveContext)
      ),
      setup: cloneJson(analysis.setup),
      metadata: captureMetadata()
    }
  }
  const composeCapturedDebrief = (capture: CapturedBoundary): StintDebrief => {
    const composition = composeDebrief(
      capture.trigger.findings,
      capture.trigger.predictions,
      capture.trigger.sessionInfo,
      capture.metadata.unitSystem,
      capture.metadata.language
    )
    return {
      generatedAt: capture.capturedAt,
      text: composition.text,
      bullets: [...composition.bullets],
      source: 'deterministic',
      language: capture.metadata.language,
      reason: capture.trigger.reason,
      sessionInfo: cloneJson(capture.trigger.sessionInfo)
    }
  }
  const emitTrigger = (capture: CapturedBoundary): void => {
    if (intakeClosed) return
    const immutable = cloneJson(capture)
    ctx.broadcast(DEBRIEF_CHANNELS.trigger, immutable.trigger)
    try {
      const archivedDebrief = composeCapturedDebrief(immutable)
      const archiveRecord = archiveRecordFromBoundary(
        immutable,
        archivedDebrief,
        createOpaqueArchiveId(dependencies.createArchiveId)
      )
      const archiveOperation = (async () => {
        await archiveInitialization
        const result = await archiveStore.append(archiveRecord)
        if (result.inserted && !intakeClosed && !closing) {
          ctx.broadcast(DEBRIEF_CHANNELS.archiveUpdated, {
            latest: result.summary,
            count: result.count
          })
        }
      })()
      inFlightArchiveWrites.add(archiveOperation)
      void archiveOperation.then(
        () => inFlightArchiveWrites.delete(archiveOperation),
        (error: unknown) => {
          inFlightArchiveWrites.delete(archiveOperation)
          logger.warn(LOG_AREA, 'automatic stint debrief archive persistence failed', {
            message: error instanceof Error ? error.message : String(error)
          })
        }
      )
    } catch (error) {
      logger.warn(LOG_AREA, 'automatic stint debrief archive capture failed', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
    void acceptComposition(
      {
        findings: immutable.trigger.findings,
        predictions: immutable.trigger.predictions,
        sessionInfo: immutable.trigger.sessionInfo,
        useLlm: false
      },
      true,
      immutable.metadata,
      immutable.capturedAt
    ).catch((error: unknown) => {
      logger.warn(LOG_AREA, 'automatic stint debrief persistence failed', {
        message: error instanceof Error ? error.message : String(error)
      })
    })
  }

  ctx.telemetryHub.on('snapshot', (snapshot: TelemetrySnapshot | null) => {
    if (intakeClosed) return
    const live = liveGate.observe(snapshot)
    if (!live.live) {
      if (live.state === 'disconnected') {
        const reason = detectBoundary(boundary, null)
        if (reason) emitTrigger(createCapturedBoundary(reason, lastLiveSnapshot))
        else if (suspendedTrigger) emitTrigger(suspendedTrigger)
        suspendedTrigger = null
      } else if (live.boundary && boundary.prevConnected && lastLiveSnapshot) {
        suspendedTrigger = createCapturedBoundary('session-end', lastLiveSnapshot)
      }
      if (live.boundary) Object.assign(boundary, newBoundaryState())
      return
    }
    if (!snapshot) return
    if (live.boundary) {
      if (live.sessionChanged) {
        if (suspendedTrigger) emitTrigger(suspendedTrigger)
        else if (boundary.prevConnected && lastLiveSnapshot) {
          emitTrigger(createCapturedBoundary('session-end', lastLiveSnapshot))
        }
        Object.assign(boundary, newBoundaryState())
      }
      suspendedTrigger = null
    }
    const reason = detectBoundary(boundary, snapshot)
    if (reason) {
      emitTrigger(createCapturedBoundary(
        reason,
        reason === 'session-end'
          ? lastLiveSnapshot
          : debriefSnapshotMetadata(snapshot, live.context)
      ))
    }
    lastLiveSnapshot = debriefSnapshotMetadata(snapshot, live.context)
  })

  ctx.ipcMain.handle(
    DEBRIEF_CHANNELS.generate,
    (_event, request?: DebriefGenerateRequest): Promise<StintDebrief> =>
      acceptComposition(request)
  )

  ctx.ipcMain.handle(DEBRIEF_CHANNELS.last, () => readLatestAcceptedVisibility())
  ctx.ipcMain.handle(DEBRIEF_CHANNELS.archiveList, async () => {
    await archiveInitialization
    return archiveStore.list()
  })
  ctx.ipcMain.handle(
    DEBRIEF_CHANNELS.archiveGenerate,
    async (_event, rawRequest: unknown): Promise<DebriefArchiveGenerateResult> => {
      if (intakeClosed) {
        throw new Error('Stint debrief archive lifecycle is shutting down.')
      }
      const request = normalizeDebriefArchiveGenerateRequest(rawRequest)
      if (!request) throw new Error('Historical debrief request or session ID is invalid.')
      await archiveInitialization
      const record = await archiveStore.get(request.sessionId)
      let debrief = cloneJson(record.debrief)
      if (request.useLlm === true && record.debrief.source === 'deterministic') {
        const { system, prompt } = historicalPhrasePrompt(
          record.debrief.text,
          record.unitSystem,
          record.language
        )
        const phrased = await phrase(system, prompt)
        const safePhrase = phrased
          ? safeHistoricalPhrase(record.debrief.text, phrased)
          : null
        if (safePhrase) {
          const validated = normalizeStintDebrief({
            ...record.debrief,
            generatedAt: now(),
            text: safePhrase,
            source: 'llm'
          })
          if (validated) debrief = validated
        }
      }
      return {
        sessionId: record.id,
        debrief,
        setup: cloneJson(record.setup),
        captureSource: record.captureSource,
        setupStatus: debriefSetupStatus(record),
        analysisStatus: debriefAnalysisStatus(record)
      }
    }
  )
  ctx.registerGracefulTeardown(() => {
    intakeClosed = true
    closing = true
    offSettings()
  }, 'quiesce')
  ctx.registerGracefulTeardown(async () => {
    await loadPromise
    await archiveInitialization
    while (inFlightCompositions.size > 0) {
      await Promise.allSettled([...inFlightCompositions])
    }
    while (inFlightArchiveWrites.size > 0) {
      await Promise.allSettled([...inFlightArchiveWrites])
    }
    archiveStore.quiesce()
    await writeQueue
    const durability = await Promise.allSettled([
      retryLatestFailedWrite(),
      archiveStore.dispose()
    ])
    const failures = durability
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason)
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Stint debrief persistence failed during teardown.')
    }
    await readLatestAcceptedVisibility()
  }, 'persistence')
}
