import { describe, expect, it } from 'vitest'
import type { TelemetrySnapshot } from './telemetry'
import {
  DEFAULT_INCIDENT_CONFIG,
  buildIncidentWindow,
  classifyIncident,
  createIncidentCaptureSessionIdentity,
  detectIncidents,
  incidentCaptureSessionKey,
  summarizeIncident,
  toClipMeta,
  toIncidentSample,
  type IncidentSample
} from './incidents'

function snap(partial: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sim: 'mock',
    connected: true,
    timestamp: 0,
    speedKmh: 180,
    rpm: 7000,
    gear: 4,
    throttle: 1,
    brake: 0,
    clutch: 0,
    ...partial
  }
}

// iRacing PlayerTrackSurfaceMaterial: 15..18 → grass, 1..4 → asphalt.
const GRASS = 15
const ASPHALT = 1

describe('classifyIncident', () => {
  it('detects a spin from high yaw rate while moving', () => {
    const event = classifyIncident(snap({ timestamp: 0, speedKmh: 120 }), snap({ timestamp: 33, yawRateRadSec: 2.0, speedKmh: 120 }))
    expect(event?.type).toBe('spin')
    expect(event?.metrics.yawRateRadSec).toBeCloseTo(2.0, 5)
  })

  it('ignores yaw twitches below the moving-speed floor', () => {
    const event = classifyIncident(snap({ timestamp: 0, speedKmh: 5 }), snap({ timestamp: 33, yawRateRadSec: 2.0, speedKmh: 5 }))
    expect(event).toBeNull()
  })

  it('detects off-track on the transition onto grass', () => {
    const prev = snap({ timestamp: 0, trackSurfaceMaterial: ASPHALT, speedKmh: 160 })
    const curr = snap({ timestamp: 33, trackSurfaceMaterial: GRASS, speedKmh: 160 })
    const event = classifyIncident(prev, curr)
    expect(event?.type).toBe('off-track')
    expect(event?.metrics.surface).toBe('grass')
    expect(event?.severity).toBe('major')
  })

  it('does not re-fire off-track while staying on grass', () => {
    const prev = snap({ timestamp: 0, trackSurfaceMaterial: GRASS })
    const curr = snap({ timestamp: 33, trackSurfaceMaterial: GRASS })
    expect(classifyIncident(prev, curr)).toBeNull()
  })

  it('detects contact from a sudden speed drop', () => {
    const prev = snap({ timestamp: 0, speedKmh: 200 })
    const curr = snap({ timestamp: 33, speedKmh: 168 }) // −32 km/h
    const event = classifyIncident(prev, curr)
    expect(event?.type).toBe('contact')
    expect(event?.metrics.speedDropKmh).toBeCloseTo(32, 1)
  })

  it('detects contact from a g spike', () => {
    const prev = snap({ timestamp: 0, longAccelG: 0 })
    const curr = snap({ timestamp: 33, longAccelG: -3.2 })
    const event = classifyIncident(prev, curr)
    expect(event?.type).toBe('contact')
    expect(event?.metrics.gSpike).toBeGreaterThanOrEqual(2.5)
  })

  it('detects a lockup from hard braking and a deceleration jerk', () => {
    const prev = snap({ timestamp: 0, brake: 0.9, longAccelG: -0.2, speedKmh: 160 })
    const curr = snap({ timestamp: 33, brake: 0.95, longAccelG: -2.0, speedKmh: 158 })
    const event = classifyIncident(prev, curr)
    expect(event?.type).toBe('lockup')
    expect(event?.metrics.brake).toBeCloseTo(0.95, 2)
  })

  it('never flags incidents while on pit road', () => {
    const curr = snap({ timestamp: 33, yawRateRadSec: 3, speedKmh: 120, onPitRoad: true })
    expect(classifyIncident(snap({ timestamp: 0 }), curr)).toBeNull()
  })

  it('ignores contact/lockup across a stale frame gap', () => {
    const prev = snap({ timestamp: 0, speedKmh: 200 })
    const curr = snap({ timestamp: 5000, speedKmh: 150 }) // 5s gap → not a real spike
    expect(classifyIncident(prev, curr)).toBeNull()
  })

  it('prefers the most severe candidate when several fire', () => {
    // Big g spike (contact, major) + mild yaw (spin) → contact wins.
    const prev = snap({ timestamp: 0, longAccelG: 0, yawRateRadSec: 0 })
    const curr = snap({ timestamp: 33, longAccelG: -4, yawRateRadSec: 1.3, speedKmh: 120 })
    const event = classifyIncident(prev, curr)
    expect(event?.type).toBe('contact')
  })
})

describe('detectIncidents', () => {
  it('scans a buffer and returns a clip per incident with a window', () => {
    const samples: TelemetrySnapshot[] = [
      snap({ timestamp: 0, speedKmh: 200 }),
      snap({ timestamp: 33, speedKmh: 198 }),
      snap({ timestamp: 66, speedKmh: 160 }), // contact (−38)
      snap({ timestamp: 99, speedKmh: 158 })
    ]
    const clips = detectIncidents(samples, { preMs: 100, postMs: 100 })
    expect(clips).toHaveLength(1)
    expect(clips[0].type).toBe('contact')
    expect(clips[0].window.length).toBeGreaterThan(0)
    // trigger sample is included in the window
    expect(clips[0].window[clips[0].triggerIndex].t).toBe(66)
    expect(clips[0].id).toContain('contact')
  })

  it('dedupes incidents of the same type within minGapMs', () => {
    const samples: TelemetrySnapshot[] = [
      snap({ timestamp: 0, speedKmh: 120 }),
      snap({ timestamp: 100, yawRateRadSec: 2, speedKmh: 120 }),
      snap({ timestamp: 200, yawRateRadSec: 2, speedKmh: 120 }), // within 3s → deduped
      snap({ timestamp: 4000, yawRateRadSec: 2, speedKmh: 120 }) // >3s → new
    ]
    const clips = detectIncidents(samples)
    expect(clips.filter((c) => c.type === 'spin')).toHaveLength(2)
  })

  it('returns no clips for clean laps', () => {
    const samples: TelemetrySnapshot[] = [
      snap({ timestamp: 0, speedKmh: 200, trackSurfaceMaterial: ASPHALT }),
      snap({ timestamp: 33, speedKmh: 201, trackSurfaceMaterial: ASPHALT }),
      snap({ timestamp: 66, speedKmh: 200, trackSurfaceMaterial: ASPHALT })
    ]
    expect(detectIncidents(samples)).toHaveLength(0)
  })

  it('detects multiple distinct incident types in one buffer', () => {
    const samples: TelemetrySnapshot[] = [
      snap({ timestamp: 0, trackSurfaceMaterial: ASPHALT, speedKmh: 200 }),
      snap({ timestamp: 33, trackSurfaceMaterial: GRASS, speedKmh: 190 }), // off-track
      snap({ timestamp: 3500, yawRateRadSec: 2.4, speedKmh: 120, trackSurfaceMaterial: ASPHALT }) // spin
    ]
    const clips = detectIncidents(samples)
    const types = clips.map((c) => c.type).sort()
    expect(types).toEqual(['off-track', 'spin'])
  })

  it('binds generated clips to an immutable capture-session identity', () => {
    const session = createIncidentCaptureSessionIdentity(snap({
      timestamp: 1_000,
      sim: 'iracing',
      sessionUniqueId: 4242,
      sessionNumber: 3,
      sessionType: 'Race',
      trackName: 'Spa'
    }))
    const clips = detectIncidents([
      snap({ timestamp: 1_000, speedKmh: 200 }),
      snap({ timestamp: 1_033, speedKmh: 160 })
    ], { captureSession: session })

    expect(clips[0].captureSession).toEqual(session)
    expect(incidentCaptureSessionKey(snap({
      timestamp: 9_999,
      sim: 'iracing',
      sessionUniqueId: 4242,
      trackName: 'Changed display label'
    }))).toBe('iracing:unique:4242')
  })
})

describe('buildIncidentWindow', () => {
  const samples: IncidentSample[] = Array.from({ length: 10 }, (_unused, index) => ({ t: index * 100 }))

  it('slices the pre/post window around the trigger', () => {
    const { window, triggerIndex } = buildIncidentWindow(samples, 500, 200, 200)
    expect(window.map((s) => s.t)).toEqual([300, 400, 500, 600, 700])
    expect(window[triggerIndex].t).toBe(500)
  })

  it('falls back to the nearest sample when the exact trigger is absent', () => {
    const { window, triggerIndex } = buildIncidentWindow(samples, 450, 200, 200)
    expect(window[triggerIndex].t).toBe(400) // nearest to 450 within the slice
  })
})

describe('summaries + meta', () => {
  it('toIncidentSample compacts a snapshot', () => {
    const sample = toIncidentSample(snap({ timestamp: 123, currentLap: 4, brake: 0.5, trackSurfaceMaterial: GRASS }))
    expect(sample.t).toBe(123)
    expect(sample.lap).toBe(4)
    expect(sample.brake).toBe(0.5)
    expect(sample.surface).toBe('grass')
  })

  it('summarizeIncident produces PT-BR and EN text', () => {
    const [clip] = detectIncidents([
      snap({ timestamp: 0, speedKmh: 200 }),
      snap({ timestamp: 33, speedKmh: 160, currentLap: 7, lapDistPct: 0.5 })
    ])
    expect(clip).toBeDefined()
    expect(summarizeIncident(clip, 'pt')).toMatch(/contato|impacto/i)
    expect(summarizeIncident(clip, 'en')).toMatch(/contact|impact/i)
  })

  it('toClipMeta drops the window but keeps a sample count', () => {
    const [clip] = detectIncidents([
      snap({ timestamp: 0, speedKmh: 200 }),
      snap({ timestamp: 33, speedKmh: 160 })
    ])
    const meta = toClipMeta(clip)
    expect(meta.sampleCount).toBe(clip.window.length)
    expect('window' in meta).toBe(false)
  })
})

describe('config thresholds are respected', () => {
  it('uses a custom yaw threshold', () => {
    const cfg = { ...DEFAULT_INCIDENT_CONFIG, spinYawRateRadSec: 3 }
    expect(classifyIncident(snap({ timestamp: 0, speedKmh: 120 }), snap({ timestamp: 33, yawRateRadSec: 2.5, speedKmh: 120 }), cfg)).toBeNull()
    expect(classifyIncident(snap({ timestamp: 0, speedKmh: 120 }), snap({ timestamp: 33, yawRateRadSec: 3.5, speedKmh: 120 }), cfg)?.type).toBe('spin')
  })
})
