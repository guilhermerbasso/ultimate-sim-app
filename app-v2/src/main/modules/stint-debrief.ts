// STINT/SESSION DEBRIEF module (WS-I) — main process.
//
// register(ctx) subscribes to the telemetry hub ONLY to DETECT a stint/session
// boundary (pit-in after a real stint, or a session/track change). On a boundary
// it broadcasts `debrief:trigger` so the renderer (which already holds the live
// Coach findings + PredictionsSnapshot) auto-generates the debrief — this keeps
// the module fully decoupled from the coach / predictions modules.
//
// The composition itself is fully deterministic (`composeDebrief` in
// shared/stint-debrief.ts). The local Qwen LLM is OPTIONAL and only PHRASES the
// deterministic facts ON DEMAND (`useLlm`), reusing the shared `getLlmRuntime`
// singleton and only when a model is already on disk — it is NEVER loaded or run
// from the telemetry loop, and ALWAYS falls back to the deterministic text.

import type { ModuleContext } from '../module-context'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { UnitSystem } from '../../shared/units'
import {
  DEBRIEF_CHANNELS,
  composeDebrief,
  debriefLlmFacts,
  type DebriefGenerateRequest,
  type DebriefReason,
  type StintDebrief
} from '../../shared/stint-debrief'
import { getLlmRuntime } from '../ai/llm-runtime'
import { getModelManager } from '../ai/model-manager'
import { logger } from './logger'
import { settingsEvents } from '../settings/events'

const LOG_AREA = 'ai'
// Hard cap so an optional LLM phrasing stays a SHORT debrief, never an essay.
const PHRASE_MAX_TOKENS = 160
// Only treat a pit-in as a stint boundary once the driver has actually run laps.
const MIN_STINT_LAPS = 2

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

function phrasePrompt(facts: string, unitSystem: UnitSystem): { system: string; prompt: string } {
  const units = unitSystem === 'imperial' ? 'Use US customary units only.' : 'Use metric units only.'
  const system =
    'You are a race engineer on the radio. Rewrite the debrief below in ' +
    'American English, in 2 to 4 short sentences, with a calm, executive, ' +
    'encouraging tone. Mention where the driver lost time, where they did well, and the ' +
    `strategy points. Do NOT invent numbers or turns — use only the given facts. ${units}`
  return { system, prompt: `${facts}\n\nDebrief:` }
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
function detectBoundary(state: BoundaryState, snap: TelemetrySnapshot | null): DebriefReason | null {
  if (!snap) {
    if (state.prevConnected) {
      state.prevConnected = false
      return 'session-end'
    }
    return null
  }

  const lap = finite(snap.currentLap) ? snap.currentLap : state.lastLap
  let reason: DebriefReason | null = null

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

// ─── registration ─────────────────────────────────────────────────────────────

export function register(ctx: ModuleContext): void {
  let latest: StintDebrief | null = null
  let unitSystem: UnitSystem = 'metric'
  settingsEvents.onChanged((settings) => {
    unitSystem = settings.unitSystem
  })
  const boundary = newBoundaryState()

  ctx.telemetryHub.on('snapshot', (snapshot: TelemetrySnapshot | null) => {
    const reason = detectBoundary(boundary, snapshot)
    if (reason) {
      // The renderer holds the live findings + predictions; ask it to compose.
      ctx.broadcast(DEBRIEF_CHANNELS.trigger, { reason })
    }
  })

  ctx.ipcMain.handle(DEBRIEF_CHANNELS.generate, async (_event, request?: DebriefGenerateRequest): Promise<StintDebrief> => {
    const reason: DebriefReason = request?.sessionInfo?.reason ?? 'manual'
    const composition = composeDebrief(request?.findings, request?.predictions, request?.sessionInfo, unitSystem)

    let text = composition.text
    let source: StintDebrief['source'] = 'deterministic'

    if (request?.useLlm === true) {
      const facts = debriefLlmFacts(composition)
      if (facts.trim().length > 0) {
        const { system, prompt } = phrasePrompt(facts, unitSystem)
        const llmText = await tryLlmPhrase(system, prompt)
        if (llmText) {
          text = llmText
          source = 'llm'
        }
      }
    }

    latest = {
      generatedAt: Date.now(),
      text,
      bullets: composition.bullets,
      source,
      reason,
      sessionInfo: request?.sessionInfo
    }
    ctx.broadcast(DEBRIEF_CHANNELS.updated, latest)
    return latest
  })

  ctx.ipcMain.handle(DEBRIEF_CHANNELS.last, () => latest)
}
