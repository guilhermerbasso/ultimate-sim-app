// STINT/SESSION DEBRIEF module (WS-I) — main process.
//
// register(ctx) detects stint/session boundaries, snapshots the ended session's
// deterministic Coach + Predictions facts, composes the debrief in main, and
// persists it independently of whether the Coach view is mounted. The immutable
// `debrief:trigger` broadcast remains available for diagnostics/compatibility.
//
// The composition itself is fully deterministic (`composeDebrief` in
// shared/stint-debrief.ts). The local Qwen LLM is OPTIONAL and only PHRASES the
// deterministic facts ON DEMAND (`useLlm`), reusing the shared `getLlmRuntime`
// singleton and only when a model is already on disk — it is NEVER loaded or run
// from the telemetry loop, and ALWAYS falls back to the deterministic text.

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ModuleContext } from '../module-context'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { UnitSystem } from '../../shared/units'
import {
  DEBRIEF_CHANNELS,
  composeDebrief,
  debriefLlmFacts,
  type DebriefGenerateRequest,
  type DebriefReason,
  type DebriefTriggerPayload,
  type StintDebrief
} from '../../shared/stint-debrief'
import { getLlmRuntime } from '../ai/llm-runtime'
import { getModelManager } from '../ai/model-manager'
import { logger } from './logger'
import { settingsEvents } from '../settings/events'
import { LiveTelemetryGate } from '../../shared/replay'
import { speechLanguageFromAppLanguage, type SpeechLanguage } from '../../shared/tts-voice'
import { getLatestPredictions } from './predictions'
import { getLatestCoachFindings } from './proactive-engineer'

const LOG_AREA = 'ai'
// Hard cap so an optional LLM phrasing stays a SHORT debrief, never an essay.
const PHRASE_MAX_TOKENS = 160
// Only treat a pit-in as a stint boundary once the driver has actually run laps.
const MIN_STINT_LAPS = 2
const LAST_DEBRIEF_FILE = 'stint-debrief.json'

export interface StintDebriefDependencies {
  phrase?(system: string, prompt: string): Promise<string | null>
  loadPersisted?(filePath: string): Promise<unknown>
  writePersisted?(filePath: string, payload: string): Promise<void>
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

// ─── stint/session boundary detection (telemetry-driven) ──────────────────────

interface BoundaryState {
  prevOnPitRoad: boolean
  prevConnected: boolean
  prevSessionType?: string
  prevTrackName?: string
  lapAtStintStart: number
  lastLap: number
}

interface DebriefSnapshotMetadata {
  trackName?: string
  carName?: string
  sessionType?: string
  completedLaps?: number
  currentLap?: number
  bestLapTimeSec?: number
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
  const candidate = value as Partial<StintDebrief>
  if (
    !finite(candidate.generatedAt) ||
    typeof candidate.text !== 'string' ||
    !Array.isArray(candidate.bullets) ||
    !candidate.bullets.every((bullet) => typeof bullet === 'string') ||
    (candidate.source !== 'deterministic' && candidate.source !== 'llm') ||
    (candidate.reason !== 'manual' && candidate.reason !== 'stint-end' && candidate.reason !== 'session-end')
  ) {
    return null
  }
  if (
    candidate.language !== undefined &&
    candidate.language !== 'pt-BR' &&
    candidate.language !== 'en-US'
  ) {
    return null
  }
  return {
    ...(cloneJson(candidate) as StintDebrief),
    language: candidate.language ?? 'en-US'
  }
}

function triggerPayload(
  reason: Exclude<DebriefReason, 'manual'>,
  snapshot: DebriefSnapshotMetadata | null
): DebriefTriggerPayload {
  return {
    reason,
    findings: cloneJson(getLatestCoachFindings()),
    predictions: cloneJson(getLatestPredictions()),
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

function debriefSnapshotMetadata(snapshot: TelemetrySnapshot): DebriefSnapshotMetadata {
  return {
    trackName: snapshot.trackName,
    carName: snapshot.carName,
    sessionType: snapshot.sessionType,
    completedLaps: snapshot.completedLaps,
    currentLap: snapshot.currentLap,
    bestLapTimeSec: snapshot.bestLapTimeSec
  }
}

// ─── registration ─────────────────────────────────────────────────────────────

export function register(ctx: ModuleContext, dependencies: StintDebriefDependencies = {}): void {
  let latest: StintDebrief | null = null
  let latestVersion = 0
  let latestAcceptedVersion = 0
  let unitSystem: UnitSystem = 'metric'
  let language: SpeechLanguage = 'en-US'
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
  settingsEvents.onChanged((settings) => {
    unitSystem = settings.unitSystem
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
      : readFile(filePath, 'utf8').then((raw) => JSON.parse(raw) as unknown)
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
    visibility: DebriefVisibility
  ): Promise<StintDebrief> => {
    const reason: DebriefReason = immutableRequest.sessionInfo?.reason ?? 'manual'
    const compositionLanguage = language
    const composition = composeDebrief(
      immutableRequest.findings,
      immutableRequest.predictions,
      immutableRequest.sessionInfo,
      unitSystem,
      compositionLanguage
    )

    let text = composition.text
    let source: StintDebrief['source'] = 'deterministic'

    if (!automatic && immutableRequest.useLlm === true) {
      const facts = debriefLlmFacts(composition)
      if (facts.trim().length > 0) {
        const { system, prompt } = phrasePrompt(facts, unitSystem, compositionLanguage)
        const llmText = await (dependencies.phrase ?? tryLlmPhrase)(system, prompt)
        if (llmText) {
          text = llmText
          source = 'llm'
        }
      }
    }

    const next: StintDebrief = {
      generatedAt: Date.now(),
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
    automatic = false
  ): Promise<StintDebrief> => {
    if (intakeClosed) return Promise.reject(new Error('Stint debrief lifecycle is shutting down.'))
    const acceptedVersion = ++latestAcceptedVersion
    const immutableRequest = cloneJson(request)
    const visibility = createVisibility(acceptedVersion)
    const operation = Promise.resolve().then(async () => {
      await loadPromise
      return composeAndPersist(immutableRequest, automatic, acceptedVersion, visibility)
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
  let suspendedTrigger: DebriefTriggerPayload | null = null
  const emitTrigger = (payload: DebriefTriggerPayload): void => {
    if (intakeClosed) return
    const immutable = cloneJson(payload)
    ctx.broadcast(DEBRIEF_CHANNELS.trigger, immutable)
    void acceptComposition(
      {
        findings: immutable.findings,
        predictions: immutable.predictions,
        sessionInfo: immutable.sessionInfo,
        useLlm: false
      },
      true
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
        if (reason) emitTrigger(triggerPayload(reason, lastLiveSnapshot))
        else if (suspendedTrigger) emitTrigger(suspendedTrigger)
        suspendedTrigger = null
      } else if (live.boundary && boundary.prevConnected && lastLiveSnapshot) {
        suspendedTrigger = triggerPayload('session-end', lastLiveSnapshot)
      }
      if (live.boundary) Object.assign(boundary, newBoundaryState())
      return
    }
    if (!snapshot) return
    if (live.boundary) {
      if (live.sessionChanged) {
        if (suspendedTrigger) emitTrigger(suspendedTrigger)
        else if (boundary.prevConnected && lastLiveSnapshot) {
          emitTrigger(triggerPayload('session-end', lastLiveSnapshot))
        }
      }
      suspendedTrigger = null
      Object.assign(boundary, newBoundaryState())
    }
    const reason = detectBoundary(boundary, snapshot)
    if (reason) {
      emitTrigger(triggerPayload(
        reason,
        reason === 'session-end' ? lastLiveSnapshot : debriefSnapshotMetadata(snapshot)
      ))
    }
    lastLiveSnapshot = debriefSnapshotMetadata(snapshot)
  })

  ctx.ipcMain.handle(
    DEBRIEF_CHANNELS.generate,
    (_event, request?: DebriefGenerateRequest): Promise<StintDebrief> =>
      acceptComposition(request)
  )

  ctx.ipcMain.handle(DEBRIEF_CHANNELS.last, () => readLatestAcceptedVisibility())
  ctx.registerGracefulTeardown(() => {
    intakeClosed = true
    closing = true
  }, 'quiesce')
  ctx.registerGracefulTeardown(async () => {
    await loadPromise
    while (inFlightCompositions.size > 0) {
      await Promise.allSettled([...inFlightCompositions])
    }
    await writeQueue
    await retryLatestFailedWrite()
    await readLatestAcceptedVisibility()
  }, 'persistence')
}
