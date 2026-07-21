// STINT DEBRIEF — renderer helper (WS-I).
//
// Thin client for the `debrief:` module. Historical requests use an opaque archive
// ID and never gather live state. Compatibility manual requests gather the live Coach
// findings (`coach:lastFindings`) + latest PredictionsSnapshot (`predictions:get`)
// and hand them to `debrief:generate`. Automatic boundary debriefs are composed
// and persisted in main, so renderer mounting never controls their lifecycle.
//
// All composition is deterministic in shared/stint-debrief.ts; `useLlm` only
// asks the local model to PHRASE, always falling back to the deterministic text.

import { COACH_CHANNELS, type CoachFinding } from '../../../shared/coach'
import { PREDICTIONS_CHANNELS, type PredictionsSnapshot } from '../../../shared/predictions'
import {
  DEBRIEF_CHANNELS,
  type DebriefArchiveGenerateResult,
  type DebriefArchiveSummary,
  type DebriefArchiveUpdatedPayload,
  type DebriefReason,
  type DebriefSessionInfo,
  type DebriefTriggerPayload,
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
  /** Immutable ended-session snapshot supplied by the main-process boundary detector. */
  trigger?: DebriefTriggerPayload
}

/**
 * Gather the live findings + predictions and compose a debrief in the main
 * process. Returns the composed debrief (also broadcast on `debrief:updated`).
 */
export async function generateDebrief(options: GenerateDebriefOptions = {}): Promise<StintDebrief | null> {
  const reason = options.trigger?.reason ?? options.reason ?? 'manual'
  const [findings, predictions] = options.trigger
    ? [options.trigger.findings, options.trigger.predictions]
    : await Promise.all([gatherFindings(), gatherPredictions()])
  try {
    return await invoke<StintDebrief>(DEBRIEF_CHANNELS.generate, {
      findings,
      predictions,
      sessionInfo: options.trigger?.sessionInfo ?? currentSessionInfo(reason),
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

/** List durable ended-session analysis snapshots, newest first. */
export function listDebriefArchive(): Promise<DebriefArchiveSummary[]> {
  return invoke<DebriefArchiveSummary[]>(DEBRIEF_CHANNELS.archiveList)
}

/** Generate strictly from one persisted opaque session ID (never from live state). */
export function generateArchivedDebrief(
  sessionId: string,
  useLlm = false
): Promise<DebriefArchiveGenerateResult> {
  return invoke<DebriefArchiveGenerateResult>(DEBRIEF_CHANNELS.archiveGenerate, {
    sessionId,
    useLlm
  })
}

/** Refresh archive summaries only after the main process reports a durable capture. */
export function subscribeDebriefArchive(
  callback: (payload: DebriefArchiveUpdatedPayload) => void
): () => void {
  return window.ipc.subscribe<DebriefArchiveUpdatedPayload>(
    DEBRIEF_CHANNELS.archiveUpdated,
    (payload) => {
      if (payload) callback(payload)
    }
  )
}

/** Subscribe to freshly composed debriefs (`debrief:updated`). */
export function subscribeDebrief(callback: (debrief: StintDebrief) => void): () => void {
  return window.ipc.subscribe<StintDebrief>(DEBRIEF_CHANNELS.updated, (payload) => {
    if (payload) callback(payload)
  })
}

/**
 * Subscribe to the immutable ended-session payload for compatibility/diagnostics.
 * Main has already generated the deterministic debrief before this is observed.
 */
export function subscribeDebriefTrigger(callback: (payload: DebriefTriggerPayload) => void): () => void {
  return window.ipc.subscribe<DebriefTriggerPayload>(DEBRIEF_CHANNELS.trigger, (payload) => {
    if (payload) callback(payload)
  })
}
