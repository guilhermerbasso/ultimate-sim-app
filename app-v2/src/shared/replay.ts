/** Treats a replay clock lag above the observed ~1s live-edge skew as behind live. */
export const REPLAY_LIVE_TIME_TOLERANCE_SEC = 1.25

export type ReplaySimMode = 'full' | 'replay'
export type ReplayContextState = 'live' | 'replay' | 'unknown'

export interface ReplayContextInputs {
  simMode?: ReplaySimMode
  isReplayPlaying?: boolean
  replaySessionNum?: number
  replayFrameNum?: number
  /** Frames remaining to the replay tape end/live edge, not an absolute frame number. */
  replayFrameNumEnd?: number
  sessionTime?: number
  replaySessionTime?: number
}

export type ReplayContextSource = Partial<Record<keyof ReplayContextInputs, unknown>>

export type ReplayContextReason = 'confirmed-live' | 'replay-playing' | 'replay-sim-mode' | 'cursor-behind-live'
  | 'missing-metadata' | 'invalid-metadata' | 'contradictory-metadata'

export type ReplayResolution = { state: ReplayContextState; reason: ReplayContextReason; inputs: ReplayContextInputs }

export type ReplayContextIdentity = { sessionIdentity?: string; connectionEpoch: number }

export type ReplayContext = ReplayResolution & ReplayContextIdentity & { active: boolean; revision: number; token: string }

export interface ReplayAwareTelemetrySnapshot {
  connected?: boolean
  sim?: string
  sessionUniqueId?: number
  replayContext?: ReplayContext
}

export type LiveTelemetryState = ReplayContextState | 'disconnected'

export interface LiveTelemetryContext {
  state: 'live'
  revision: number
  token: string
  connectionEpoch: number
  sessionIdentity?: string
}

export interface LiveTelemetryDecision {
  state: LiveTelemetryState
  live: boolean
  boundary: boolean
  enteredLive: boolean
  enteredNonLive: boolean
  sessionChanged: boolean
  context: LiveTelemetryContext | null
}

export const REPLAY_SPEECH_CANCEL_CHANNELS = {
  coach: 'coach:cancelSpeech',
  engineer: 'engineer:cancelSpeech',
  spotter: 'spotter:cancelSpeech'
} as const

/** Track-map replay gating is intentionally owned by the stacked track-layout-safety predecessor. */
export const REPLAY_GATING_PREDECESSORS = {
  trackMap: 'guilhermerbasso/track-layout-safety'
} as const

export type ReplaySpeechOwner = keyof typeof REPLAY_SPEECH_CANCEL_CHANNELS

export interface ReplaySpeechCancelEvent {
  owner: ReplaySpeechOwner
  state: Exclude<LiveTelemetryState, 'live'>
  revision?: number
}

type Checked<T> = { value?: T; missing: boolean; invalid: boolean }

function checked<T>(raw: unknown, guard: (value: unknown) => value is T): Checked<T> {
  if (raw === undefined || raw === null) return { missing: true, invalid: false }
  return guard(raw)
    ? { value: raw, missing: false, invalid: false }
    : { missing: false, invalid: true }
}

function simMode(raw: unknown): Checked<ReplaySimMode> {
  if (raw === undefined || raw === null) return { missing: true, invalid: false }
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return value === 'full' || value === 'replay'
    ? { value, missing: false, invalid: false }
    : { missing: false, invalid: true }
}

function integer(raw: unknown, min: number): Checked<number> {
  return checked(raw, (value): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min)
}

export function liveTelemetryState(snapshot: ReplayAwareTelemetrySnapshot | null | undefined): LiveTelemetryState {
  if (!snapshot?.connected) return 'disconnected'
  return snapshot.replayContext?.state ?? 'live'
}

export function captureLiveTelemetryContext(
  snapshot: ReplayAwareTelemetrySnapshot | null | undefined
): LiveTelemetryContext | null {
  if (liveTelemetryState(snapshot) !== 'live') return null
  const context = snapshot?.replayContext
  if (context) {
    return {
      state: 'live',
      revision: context.revision,
      token: context.token,
      connectionEpoch: context.connectionEpoch,
      sessionIdentity: context.sessionIdentity
    }
  }
  const sim = snapshot?.sim ?? 'telemetry'
  const session = Number.isFinite(snapshot?.sessionUniqueId) ? snapshot?.sessionUniqueId : 'session'
  return { state: 'live', revision: 0, token: `${sim}:${session}`, connectionEpoch: 0 }
}

export function sameLiveTelemetryContext(
  left: LiveTelemetryContext | null | undefined,
  right: LiveTelemetryContext | null | undefined
): boolean {
  return Boolean(
    left &&
    right &&
    left.revision === right.revision &&
    left.token === right.token &&
    left.connectionEpoch === right.connectionEpoch &&
    left.sessionIdentity === right.sessionIdentity
  )
}

export function isCurrentLiveTelemetryContext(
  snapshot: ReplayAwareTelemetrySnapshot | null | undefined,
  captured: LiveTelemetryContext | null | undefined
): boolean {
  return sameLiveTelemetryContext(captureLiveTelemetryContext(snapshot), captured)
}

export function isLiveTelemetrySnapshot<T extends ReplayAwareTelemetrySnapshot>(
  snapshot: T | null | undefined
): snapshot is T {
  return liveTelemetryState(snapshot) === 'live'
}

export class LiveTelemetryGate {
  private previousKey: string | undefined
  private lastLiveContext: LiveTelemetryContext | null = null

  observe(snapshot: ReplayAwareTelemetrySnapshot | null | undefined): LiveTelemetryDecision {
    const state = liveTelemetryState(snapshot)
    const raw = snapshot?.replayContext
    const context = captureLiveTelemetryContext(snapshot)
    const key = raw
      ? `${state}:${raw.connectionEpoch}:${raw.revision}:${raw.sessionIdentity ?? ''}`
      : `${state}:${context?.token ?? ''}`
    const first = this.previousKey === undefined
    const boundary = first ? state !== 'live' : key !== this.previousKey
    const sessionChanged = Boolean(
      context &&
      this.lastLiveContext &&
      (
        context.connectionEpoch !== this.lastLiveContext.connectionEpoch ||
        context.sessionIdentity !== this.lastLiveContext.sessionIdentity ||
        (!raw && context.token !== this.lastLiveContext.token)
      )
    )
    this.previousKey = key
    if (context) this.lastLiveContext = context

    return {
      state,
      live: state === 'live',
      boundary,
      enteredLive: state === 'live' && boundary,
      enteredNonLive: state !== 'live' && boundary,
      sessionChanged,
      context
    }
  }
}

export function resolveReplayContext(raw: ReplayContextSource): ReplayResolution {
  const mode = simMode(raw.simMode)
  const playing = checked(raw.isReplayPlaying, (value): value is boolean => typeof value === 'boolean')
  const session = integer(raw.replaySessionNum, -1)
  const frame = integer(raw.replayFrameNum, 0)
  const frameEnd = integer(raw.replayFrameNumEnd, 0)
  const sessionTime = checked(raw.sessionTime, (value): value is number => typeof value === 'number' && Number.isFinite(value))
  const replayTime = checked(raw.replaySessionTime, (value): value is number => typeof value === 'number' && Number.isFinite(value))
  const fields = [mode, playing, session, frame, frameEnd, sessionTime, replayTime]
  const inputs: ReplayContextInputs = {
    simMode: mode.value,
    isReplayPlaying: playing.value,
    replaySessionNum: session.value,
    replayFrameNum: frame.value,
    replayFrameNumEnd: frameEnd.value,
    sessionTime: sessionTime.value,
    replaySessionTime: replayTime.value
  }
  const timeDelta = sessionTime.value !== undefined && replayTime.value !== undefined
    ? sessionTime.value - replayTime.value
    : undefined

  const complete = fields.every((field) => !field.missing && !field.invalid)
  if (complete
    && mode.value === 'full'
    && playing.value === false
    && session.value === -1) {
    return { state: 'live', reason: 'confirmed-live', inputs }
  }
  if (playing.value === true) return { state: 'replay', reason: 'replay-playing', inputs }
  if (mode.value === 'replay') return { state: 'replay', reason: 'replay-sim-mode', inputs }
  if ((session.value ?? -1) >= 0
    && ((frameEnd.value ?? 0) > 1 || (timeDelta !== undefined && timeDelta > REPLAY_LIVE_TIME_TOLERANCE_SEC))) {
    return { state: 'replay', reason: 'cursor-behind-live', inputs }
  }

  const reason: ReplayContextReason = fields.some((field) => field.invalid)
    ? 'invalid-metadata'
    : fields.some((field) => field.missing)
      ? 'missing-metadata'
      : 'contradictory-metadata'
  return { state: 'unknown', reason, inputs }
}

export class ReplayContextTracker {
  private revision = 0
  private current: ReplayContext | undefined
  private replayLatched = false
  private lastValidReplaySessionNum: number | undefined
  private initialized = false

  update(raw: ReplayContextSource, identity: ReplayContextIdentity): ReplayContext {
    const sessionIdentity = typeof identity.sessionIdentity === 'string' && identity.sessionIdentity.trim()
      ? identity.sessionIdentity.trim()
      : undefined
    const connectionEpoch = Number.isSafeInteger(identity.connectionEpoch) && identity.connectionEpoch >= 0
      ? identity.connectionEpoch
      : 0
    const previous = this.current
    const replaySessionNum = integer(raw.replaySessionNum, -1).value
    if (previous && (previous.sessionIdentity !== sessionIdentity || previous.connectionEpoch !== connectionEpoch)) {
      this.replayLatched = false; this.lastValidReplaySessionNum = undefined
    }
    const validReplaySessionNum = replaySessionNum !== undefined && replaySessionNum >= 0 ? replaySessionNum : undefined
    if (this.lastValidReplaySessionNum !== undefined && validReplaySessionNum !== undefined && this.lastValidReplaySessionNum !== validReplaySessionNum) this.replayLatched = false
    const resolution = resolveReplayContext(raw)
    if (resolution.state === 'replay') this.replayLatched = true
    else if (resolution.state === 'live') this.replayLatched = false
    this.lastValidReplaySessionNum = resolution.state === 'live' ? undefined : validReplaySessionNum ?? this.lastValidReplaySessionNum
    const active = resolution.state === 'replay' || (resolution.state === 'unknown' && this.replayLatched)
    const changed = previous !== undefined && (
      previous.active !== active
      || previous.state !== resolution.state
      || previous.reason !== resolution.reason
      || previous.inputs.replaySessionNum !== resolution.inputs.replaySessionNum
      || previous.sessionIdentity !== sessionIdentity
      || previous.connectionEpoch !== connectionEpoch
    )
    if (changed) this.revision += 1
    this.current = {
      ...resolution,
      active,
      revision: this.revision,
      token: `${connectionEpoch}:${this.revision}`,
      sessionIdentity,
      connectionEpoch
    }
    this.initialized = true
    return this.current
  }

  reset(): void {
    if (this.initialized) this.revision += 1
    this.current = undefined
    this.replayLatched = false
    this.lastValidReplaySessionNum = undefined
  }
}
