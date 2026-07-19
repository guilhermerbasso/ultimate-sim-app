import {
  createIncidentCaptureSessionIdentity,
  type IncidentCaptureSessionIdentity
} from '../../shared/incidents'
import type { TelemetrySnapshot } from '../../shared/telemetry'

export interface IncidentSessionObservation {
  identity: IncidentCaptureSessionIdentity | null
  changed: boolean
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalized(value: string | undefined): string | undefined {
  const result = value?.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
  return result || undefined
}

function changedWhenBothKnown(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalized(left)
  const normalizedRight = normalized(right)
  return normalizedLeft !== undefined &&
    normalizedRight !== undefined &&
    normalizedLeft !== normalizedRight
}

function explicitIdentityChanged(
  previous: TelemetrySnapshot,
  current: TelemetrySnapshot
): boolean {
  if (previous.sim !== current.sim) return true
  if (
    finite(previous.sessionUniqueId) &&
    finite(current.sessionUniqueId) &&
    Math.trunc(previous.sessionUniqueId) !== Math.trunc(current.sessionUniqueId)
  ) {
    return true
  }
  if (
    finite(previous.sessionNumber) &&
    finite(current.sessionNumber) &&
    Math.trunc(previous.sessionNumber) !== Math.trunc(current.sessionNumber)
  ) {
    return true
  }
  return changedWhenBothKnown(previous.sessionType, current.sessionType) ||
    changedWhenBothKnown(previous.trackName, current.trackName) ||
    changedWhenBothKnown(previous.trackConfigName, current.trackConfigName)
}

function sessionResetDetected(previous: TelemetrySnapshot, current: TelemetrySnapshot): boolean {
  const completedReset =
    finite(previous.completedLaps) &&
    finite(current.completedLaps) &&
    previous.completedLaps >= 1 &&
    current.completedLaps === 0
  const lapReset =
    finite(previous.currentLap) &&
    finite(current.currentLap) &&
    previous.currentLap > 1 &&
    current.currentLap <= 1
  const elapsedReset =
    finite(previous.sessionTimeSec) &&
    finite(current.sessionTimeSec) &&
    previous.sessionTimeSec >= 30 &&
    current.sessionTimeSec <= 5 &&
    previous.sessionTimeSec - current.sessionTimeSec >= 30
  const remainingRestart =
    finite(previous.sessionTimeRemainingSec) &&
    finite(current.sessionTimeRemainingSec) &&
    current.sessionTimeRemainingSec - previous.sessionTimeRemainingSec >= 30 &&
    (previous.sessionTimeRemainingSec <= 5 || completedReset || lapReset)
  return elapsedReset || remainingRestart || (completedReset && lapReset)
}

export class IncidentCaptureSessionLifecycle {
  private generation = 0
  private current: IncidentCaptureSessionIdentity | null = null
  private previous: TelemetrySnapshot | null = null

  observe(snapshot: TelemetrySnapshot | null): IncidentSessionObservation {
    if (!snapshot?.connected) {
      const changed = this.current !== null
      this.current = null
      this.previous = null
      return { identity: null, changed }
    }
    const changed = !this.current ||
      !this.previous ||
      explicitIdentityChanged(this.previous, snapshot) ||
      sessionResetDetected(this.previous, snapshot)
    if (changed) {
      this.generation += 1
      this.current = Object.freeze(
        createIncidentCaptureSessionIdentity(snapshot, snapshot.timestamp, this.generation)
      )
    }
    this.previous = { ...snapshot }
    return {
      identity: this.current ? { ...this.current } : null,
      changed
    }
  }
}
