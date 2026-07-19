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
    'debounces an early same-metadata %s restart and requires three corroborating frames',
    (sim) => {
      const lifecycle = new IncidentCaptureSessionLifecycle()
      const first = lifecycle.observe(snapshot(sim, {
        timestamp: 1_000,
        sessionTimeRemainingSec: 240,
        currentLap: 1,
        completedLaps: 0,
        currentLapTimeSec: 45,
        sessionTimeSec: sim === 'lmu' ? 45 : undefined
      }))
      const reset1 = lifecycle.observe(snapshot(sim, {
        timestamp: 1_033,
        sessionTimeRemainingSec: 300,
        currentLap: 1,
        completedLaps: 0,
        currentLapTimeSec: 0,
        sessionTimeSec: sim === 'lmu' ? 0 : undefined
      }))
      const reset2 = lifecycle.observe(snapshot(sim, {
        timestamp: 1_066,
        sessionTimeRemainingSec: 300,
        currentLap: 1,
        completedLaps: 0,
        currentLapTimeSec: 1,
        sessionTimeSec: sim === 'lmu' ? 1 : undefined
      }))
      const second = lifecycle.observe(snapshot(sim, {
        timestamp: 1_099,
        sessionTimeRemainingSec: 299,
        currentLap: 1,
        completedLaps: 0,
        currentLapTimeSec: 2,
        sessionTimeSec: sim === 'lmu' ? 2 : undefined
      }))

      expect(reset1).toMatchObject({ changed: false, tentative: true })
      expect(reset2).toMatchObject({ changed: false, tentative: true })
      expect(second.changed).toBe(true)
      expect(second.tentative).toBe(false)
      expect(second.identity?.captureSessionId).not.toBe(first.identity?.captureSessionId)
      expect(second.identity?.lifecycleGeneration).toBe(2)
    }
  )

  it('ignores a single transient reset frame and resumes the original session', () => {
    const lifecycle = new IncidentCaptureSessionLifecycle()
    const first = lifecycle.observe(snapshot('acc', {
      sessionTimeRemainingSec: 240,
      currentLapTimeSec: 45
    }))
    const transient = lifecycle.observe(snapshot('acc', {
      timestamp: 1_033,
      sessionTimeRemainingSec: 300,
      currentLapTimeSec: 0
    }))
    const recovered = lifecycle.observe(snapshot('acc', {
      timestamp: 1_066,
      sessionTimeRemainingSec: 239,
      currentLapTimeSec: 46
    }))

    expect(transient).toMatchObject({ changed: false, tentative: true })
    expect(recovered).toMatchObject({ changed: false, tentative: false })
    expect(recovered.identity?.captureSessionId).toBe(first.identity?.captureSessionId)
  })

  it('ignores repeated mid-session remaining-time corrections without a reset corroborator', () => {
    const lifecycle = new IncidentCaptureSessionLifecycle()
    const first = lifecycle.observe(snapshot('ams2', {
      sessionTimeRemainingSec: 200,
      completedLaps: 3,
      currentLap: 4,
      currentLapTimeSec: 35
    }))
    for (let index = 1; index <= 4; index += 1) {
      const observation = lifecycle.observe(snapshot('ams2', {
        timestamp: 1_000 + index * 33,
        sessionTimeRemainingSec: 260 - index,
        completedLaps: 3,
        currentLap: 4,
        currentLapTimeSec: 35 + index
      }))
      expect(observation).toMatchObject({ changed: false, tentative: false })
      expect(observation.identity?.captureSessionId).toBe(first.identity?.captureSessionId)
    }
  })

  it('switches immediately when a provider supplies a new authoritative session epoch', () => {
    const lifecycle = new IncidentCaptureSessionLifecycle()
    const first = lifecycle.observe(snapshot('iracing', {
      sessionUniqueId: 100,
      sessionNumber: 1
    }))
    const second = lifecycle.observe(snapshot('iracing', {
      timestamp: 1_033,
      sessionUniqueId: 101,
      sessionNumber: 1
    }))

    expect(second).toMatchObject({ changed: true, tentative: false })
    expect(second.identity?.captureSessionId).not.toBe(first.identity?.captureSessionId)
  })

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
