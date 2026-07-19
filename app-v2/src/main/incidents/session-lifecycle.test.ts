import { describe, expect, it } from 'vitest'
import type { SimId, TelemetrySnapshot } from '../../shared/telemetry'
import { IncidentCaptureSessionLifecycle } from './session-lifecycle'

function snapshot(sim: SimId, partial: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sim,
    connected: true,
    timestamp: 1_000,
    speedKmh: 120,
    rpm: 6_000,
    gear: 3,
    throttle: 0.5,
    brake: 0,
    clutch: 0,
    sessionType: 'Race',
    trackName: 'Spa',
    sessionTimeRemainingSec: 300,
    currentLap: 1,
    completedLaps: 0,
    ...partial
  }
}

describe('IncidentCaptureSessionLifecycle', () => {
  it.each(['acc', 'ac', 'ams2', 'lmu'] as const)(
    'creates a new %s capture session for consecutive identical-metadata races',
    (sim) => {
      const lifecycle = new IncidentCaptureSessionLifecycle()
      const first = lifecycle.observe(snapshot(sim, {
        timestamp: 1_000,
        sessionTimeRemainingSec: 5,
        currentLap: 6,
        completedLaps: 5,
        sessionTimeSec: sim === 'lmu' ? 3_600 : undefined
      }))
      const transient = lifecycle.observe(snapshot(sim, {
        timestamp: 1_033,
        trackName: undefined,
        sessionTimeRemainingSec: 6,
        currentLap: 6,
        completedLaps: 5,
        currentLapTimeSec: 0,
        sessionTimeSec: sim === 'lmu' ? 3_601 : undefined
      }))
      const second = lifecycle.observe(snapshot(sim, {
        timestamp: 2_000,
        sessionTimeRemainingSec: 300,
        currentLap: 1,
        completedLaps: 0,
        sessionTimeSec: sim === 'lmu' ? 0 : undefined
      }))

      expect(transient.changed).toBe(false)
      expect(transient.identity?.captureSessionId).toBe(first.identity?.captureSessionId)
      expect(second.changed).toBe(true)
      expect(second.identity?.captureSessionId).not.toBe(first.identity?.captureSessionId)
      expect(second.identity?.lifecycleGeneration).toBe(2)
    }
  )

  it('increments the main-owned generation on authoritative disconnect/reconnect', () => {
    const lifecycle = new IncidentCaptureSessionLifecycle()
    const first = lifecycle.observe(snapshot('acc'))
    lifecycle.observe(null)
    const second = lifecycle.observe(snapshot('acc', { timestamp: 2_000 }))

    expect(first.identity?.lifecycleGeneration).toBe(1)
    expect(second.identity?.lifecycleGeneration).toBe(2)
    expect(second.identity?.captureSessionId).not.toBe(first.identity?.captureSessionId)
  })
})
