// STINT DEBRIEF — renderer helper (WS-I).
//
// Thin client for the `debrief:` module. It gathers the live Coach findings
// (`coach:lastFindings`) + the latest PredictionsSnapshot (`predictions:get`) +
// a little session context (telemetry store), hands them to `debrief:generate`,
// and lets the view subscribe to fresh debriefs. The main module auto-fires
// `debrief:trigger` at a stint/session boundary; we respond by generating one.
//
// All composition is deterministic in shared/stint-debrief.ts; `useLlm` only
// asks the local model to PHRASE, always falling back to the deterministic text.

import { COACH_CHANNELS, type CoachFinding } from '../../../shared/coach'
import { PREDICTIONS_CHANNELS, type PredictionsSnapshot } from '../../../shared/predictions'
import {
  DEBRIEF_CHANNELS,
  type DebriefReason,
  type DebriefSessionInfo,
  type StintDebrief
} from '../../../shared/stint-debrief'
import { getTelemetryStoreSnapshot } from './telemetry'

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return window.ipc.invoke<T>(channel, ...args)
}

/** Build the session header from the live telemetry store (best-effort). */
function currentSessionInfo(reason: DebriefReason): DebriefSessionInfo {
  const snap = getTelemetryStoreSnapshot()
  return {
    trackName: snap?.trackName,
    carName: snap?.carName,
    sessionType: snap?.sessionType,
    lapsCompleted: typeof snap?.currentLap === 'number' ? snap.currentLap : undefined,
    bestLapTimeSec: typeof snap?.bestLapTimeSec === 'number' ? snap.bestLapTimeSec : undefined,
    reason
  }
}

async function gatherFindings(): Promise<CoachFinding[]> {
  try {
    const res = await invoke<{ findings?: CoachFinding[] }>(COACH_CHANNELS.lastFindings)
    return Array.isArray(res?.findings) ? res.findings : []
  } catch {
    return []
  }
}

async function gatherPredictions(): Promise<PredictionsSnapshot | null> {
  try {
    return await invoke<PredictionsSnapshot | null>(PREDICTIONS_CHANNELS.get)
  } catch {
    return null
  }
}

export interface GenerateDebriefOptions {
  /** Ask the local model to phrase (falls back to deterministic text). */
  useLlm?: boolean
  /** Why we are generating — defaults to 'manual'. */
  reason?: DebriefReason
}

/**
 * Gather the live findings + predictions and compose a debrief in the main
 * process. Returns the composed debrief (also broadcast on `debrief:updated`).
 */
export async function generateDebrief(options: GenerateDebriefOptions = {}): Promise<StintDebrief | null> {
  const reason = options.reason ?? 'manual'
  const [findings, predictions] = await Promise.all([gatherFindings(), gatherPredictions()])
  try {
    return await invoke<StintDebrief>(DEBRIEF_CHANNELS.generate, {
      findings,
      predictions,
      sessionInfo: currentSessionInfo(reason),
      useLlm: options.useLlm === true
    })
  } catch {
    return null
  }
}

/** Fetch the last composed debrief, if any. */
export function getLastDebrief(): Promise<StintDebrief | null> {
  return invoke<StintDebrief | null>(DEBRIEF_CHANNELS.last).catch(() => null)
}

/** Subscribe to freshly composed debriefs (`debrief:updated`). */
export function subscribeDebrief(callback: (debrief: StintDebrief) => void): () => void {
  return window.ipc.subscribe<StintDebrief>(DEBRIEF_CHANNELS.updated, (payload) => {
    if (payload) callback(payload)
  })
}

/**
 * Subscribe to stint/session-end triggers. The view typically auto-generates a
 * debrief in response. Returns the unsubscribe fn.
 */
export function subscribeDebriefTrigger(callback: (reason: DebriefReason) => void): () => void {
  return window.ipc.subscribe<{ reason?: DebriefReason }>(DEBRIEF_CHANNELS.trigger, (payload) => {
    callback(payload?.reason ?? 'stint-end')
  })
}
