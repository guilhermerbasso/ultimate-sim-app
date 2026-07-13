export interface ReplayContextInputs {
  simMode?: string
  isReplayPlaying?: boolean
  replaySessionNum?: number
  replayFrameNum?: number
  replayFrameNumEnd?: number
  sessionTime?: number
  replaySessionTime?: number
}

export type ReplayContextReason =
  | 'confirmed-live'
  | 'replay-playing'
  | 'replay-sim-mode'
  | 'cursor-behind-live'
  | 'invalid-metadata'
  | 'no-replay-evidence'

export interface ReplayContext {
  active: boolean
  revision: number
  reason: ReplayContextReason
  inputs: ReplayContextInputs
}

function finite(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizedInputs(inputs: ReplayContextInputs): ReplayContextInputs {
  const simMode = typeof inputs.simMode === 'string' ? inputs.simMode.trim().toLowerCase() : ''
  return {
    simMode: simMode || undefined,
    isReplayPlaying: typeof inputs.isReplayPlaying === 'boolean' ? inputs.isReplayPlaying : undefined,
    replaySessionNum: finite(inputs.replaySessionNum),
    replayFrameNum: finite(inputs.replayFrameNum),
    replayFrameNumEnd: finite(inputs.replayFrameNumEnd),
    sessionTime: finite(inputs.sessionTime),
    replaySessionTime: finite(inputs.replaySessionTime)
  }
}

function cursorBehindLive(inputs: ReplayContextInputs): boolean {
  const frameCursorValid = Number.isInteger(inputs.replayFrameNum) && (inputs.replayFrameNum ?? -1) >= 0
  const framesBehind = Number.isInteger(inputs.replayFrameNumEnd) && (inputs.replayFrameNumEnd ?? 0) > 0
  const timeBehind = inputs.sessionTime !== undefined
    && inputs.replaySessionTime !== undefined
    && inputs.replaySessionTime < inputs.sessionTime
  return (frameCursorValid && framesBehind) || timeBehind
}

export function resolveReplayContext(
  rawInputs: ReplayContextInputs,
  previous?: Pick<ReplayContext, 'active' | 'revision'>
): ReplayContext {
  const inputs = normalizedInputs(rawInputs)
  const explicitMetadataValid = inputs.simMode !== undefined
    && typeof inputs.isReplayPlaying === 'boolean'
    && Number.isInteger(inputs.replaySessionNum)
    && (inputs.replaySessionNum ?? -2) >= -1

  let active = false
  let reason: ReplayContextReason = 'invalid-metadata'

  if (explicitMetadataValid) {
    if (inputs.simMode === 'full' && inputs.isReplayPlaying === false && inputs.replaySessionNum === -1) {
      reason = 'confirmed-live'
    } else if ((inputs.replaySessionNum ?? -1) < 0) {
      reason = 'invalid-metadata'
    } else if (inputs.isReplayPlaying) {
      active = true
      reason = 'replay-playing'
    } else if (inputs.simMode === 'replay') {
      active = true
      reason = 'replay-sim-mode'
    } else if (cursorBehindLive(inputs)) {
      active = true
      reason = 'cursor-behind-live'
    } else {
      reason = 'no-replay-evidence'
    }
  }

  const previousRevision = previous?.revision ?? 0
  const revision = previous && previous.active !== active ? previousRevision + 1 : previousRevision
  return { active, revision, reason, inputs }
}
