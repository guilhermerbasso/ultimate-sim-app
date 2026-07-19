import {
  createIncidentCaptureSessionIdentity,
  type IncidentCaptureSessionIdentity
} from '../../shared/incidents'
import type { TelemetrySnapshot } from '../../shared/telemetry'

export interface IncidentSessionObservation {
  identity: IncidentCaptureSessionIdentity | null
  changed: boolean
  tentative: boolean
}

const RESET_CONFIRMATION_FRAMES = 3
const RESET_CONFIRMATION_WINDOW_MS = 5_000

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
  return false
}

function providerMetadataChanged(previous: TelemetrySnapshot, current: TelemetrySnapshot): boolean {
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
  const lapClockReset =
    finite(previous.currentLapTimeSec) &&
    finite(current.currentLapTimeSec) &&
    previous.currentLapTimeSec >= 10 &&
    current.currentLapTimeSec <= 2 &&
    previous.currentLapTimeSec - current.currentLapTimeSec >= 8
  const phaseRestart =
    (previous.sessionState === 'checkered' || previous.sessionState === 'coolDown') &&
    (current.sessionState === 'getInCar' ||
      current.sessionState === 'warmup' ||
      current.sessionState === 'paradeLaps' ||
      current.sessionState === 'racing')
  const remainingRestart =
    finite(previous.sessionTimeRemainingSec) &&
    finite(current.sessionTimeRemainingSec) &&
    current.sessionTimeRemainingSec - previous.sessionTimeRemainingSec >= 30 &&
    (previous.sessionTimeRemainingSec <= 5 ||
      completedReset ||
      lapReset ||
      lapClockReset ||
      phaseRestart)
  return providerMetadataChanged(previous, current) ||
    elapsedReset ||
    remainingRestart ||
    phaseRestart ||
    (completedReset && lapReset)
}

export class IncidentCaptureSessionLifecycle {
  private generation = 0
  private current: IncidentCaptureSessionIdentity | null = null
  private stable: TelemetrySnapshot | null = null
  private candidate: {
    baseline: TelemetrySnapshot
    count: number
    startedAt: number
  } | null = null

  observe(snapshot: TelemetrySnapshot | null): IncidentSessionObservation {
    if (!snapshot?.connected) {
      const changed = this.current !== null
      this.current = null
      this.stable = null
      this.candidate = null
      return { identity: null, changed, tentative: false }
    }
    if (!this.current || !this.stable) {
      this.generation += 1
      this.current = Object.freeze(
        createIncidentCaptureSessionIdentity(snapshot, snapshot.timestamp, this.generation)
      )
      this.stable = { ...snapshot }
      return { identity: { ...this.current }, changed: true, tentative: false }
    }

    if (explicitIdentityChanged(this.stable, snapshot)) {
      this.generation += 1
      this.current = Object.freeze(
        createIncidentCaptureSessionIdentity(snapshot, snapshot.timestamp, this.generation)
      )
      this.stable = { ...snapshot }
      this.candidate = null
      return { identity: { ...this.current }, changed: true, tentative: false }
    }

    if (this.candidate) {
      const withinWindow = snapshot.timestamp - this.candidate.startedAt <= RESET_CONFIRMATION_WINDOW_MS
      if (withinWindow && sessionResetDetected(this.candidate.baseline, snapshot)) {
        this.candidate.count += 1
        if (this.candidate.count >= RESET_CONFIRMATION_FRAMES) {
          this.generation += 1
          this.current = Object.freeze(
            createIncidentCaptureSessionIdentity(snapshot, snapshot.timestamp, this.generation)
          )
          this.stable = { ...snapshot }
          this.candidate = null
          return { identity: { ...this.current }, changed: true, tentative: false }
        }
        return { identity: { ...this.current }, changed: false, tentative: true }
      }
      this.candidate = null
      this.stable = { ...snapshot }
      return { identity: { ...this.current }, changed: false, tentative: false }
    }

    if (sessionResetDetected(this.stable, snapshot)) {
      this.candidate = {
        baseline: { ...this.stable },
        count: 1,
        startedAt: snapshot.timestamp
      }
      return { identity: { ...this.current }, changed: false, tentative: true }
    }

    this.stable = { ...snapshot }
    return {
      identity: this.current ? { ...this.current } : null,
      changed: false,
      tentative: false
    }
  }
}
