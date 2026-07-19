import type { ObsTimelineMapping, ObsTimelineReplayState, ObsTimelineSource } from '../../shared/obs-local'
import type { TelemetrySnapshot } from '../../shared/telemetry'

interface TimelineAnchor {
  raceClockSec: number
  telemetryTimestampMs: number
  observedAtMonotonicMs: number
  obsTimelineMs: number
  source: ObsTimelineSource
  replayState: ObsTimelineReplayState
  sessionIdentity: string | null
}

export function parseObsTimecodeMs(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^(\d+):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?$/.exec(value.trim())
  if (!match) return null
  const [, hours, minutes, seconds, fraction = '0'] = match
  const milliseconds = Number(fraction.padEnd(3, '0'))
  return (((Number(hours) * 60 + Number(minutes)) * 60) + Number(seconds)) * 1000 + milliseconds
}

export function telemetryReplayState(snapshot: TelemetrySnapshot): ObsTimelineReplayState {
  const state = snapshot.replayContext?.state
  if (state === 'replay' || snapshot.replayContext?.active || snapshot.replayPlaying) return 'replay'
  if (state === 'unknown') return 'unknown'
  return 'live'
}

export function telemetryRaceClockSec(snapshot: TelemetrySnapshot): number | null {
  const replayTime = snapshot.replayContext?.inputs.replaySessionTime
  const candidate = telemetryReplayState(snapshot) === 'replay'
    ? replayTime ?? snapshot.sessionTimeSec
    : snapshot.sessionTimeSec
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null
}

function sessionIdentity(snapshot: TelemetrySnapshot): string | null {
  const identity = snapshot.replayContext?.sessionIdentity
  if (identity) return identity
  if (Number.isFinite(snapshot.sessionUniqueId)) return `${snapshot.sim}:${snapshot.sessionUniqueId}`
  return null
}

export class ObsTimelineMapper {
  private anchor: TimelineAnchor | null = null

  capture(
    snapshot: TelemetrySnapshot,
    observedAtMonotonicMs: number,
    connectorStartedAtMonotonicMs: number,
    outputTimecode: unknown
  ): ObsTimelineMapping {
    const raceClockSec = telemetryRaceClockSec(snapshot)
    if (raceClockSec === null) throw new Error('Race clock is unavailable in the current telemetry snapshot.')
    const recordTimeMs = parseObsTimecodeMs(outputTimecode)
    const source: ObsTimelineSource = recordTimeMs === null ? 'connector-monotonic' : 'recording-timecode'
    const obsTimelineMs = recordTimeMs ?? Math.max(0, observedAtMonotonicMs - connectorStartedAtMonotonicMs)
    this.anchor = {
      raceClockSec,
      telemetryTimestampMs: Number.isFinite(snapshot.timestamp) ? snapshot.timestamp : Date.now(),
      observedAtMonotonicMs,
      obsTimelineMs,
      source,
      replayState: telemetryReplayState(snapshot),
      sessionIdentity: sessionIdentity(snapshot)
    }
    return this.mappingFromAnchor(raceClockSec)
  }

  mapRaceClock(raceClockSec: number, snapshot: TelemetrySnapshot): ObsTimelineMapping {
    if (!this.anchor) throw new Error('OBS timeline has not been anchored.')
    if (!Number.isFinite(raceClockSec)) throw new Error('Race clock must be finite.')
    const replayState = telemetryReplayState(snapshot)
    const identity = sessionIdentity(snapshot)
    if (replayState !== this.anchor.replayState || identity !== this.anchor.sessionIdentity) {
      throw new Error('Race clock context changed after the OBS timeline anchor.')
    }
    return this.mappingFromAnchor(raceClockSec)
  }

  reset(): void {
    this.anchor = null
  }

  private mappingFromAnchor(raceClockSec: number): ObsTimelineMapping {
    if (!this.anchor) throw new Error('OBS timeline has not been anchored.')
    const obsTimelineMs = this.anchor.obsTimelineMs + ((raceClockSec - this.anchor.raceClockSec) * 1000)
    if (obsTimelineMs < 0) throw new Error('Race clock predates the available OBS timeline.')
    return {
      raceClockSec,
      telemetryTimestampMs: this.anchor.telemetryTimestampMs,
      observedAtMonotonicMs: this.anchor.observedAtMonotonicMs,
      obsTimelineMs,
      offsetMs: obsTimelineMs - (raceClockSec * 1000),
      source: this.anchor.source,
      replayState: this.anchor.replayState,
      sessionIdentity: this.anchor.sessionIdentity
    }
  }
}
