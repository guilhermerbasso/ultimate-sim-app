import { describe, expect, it } from 'vitest'
import type { TelemetrySnapshot } from './telemetry'
import { CoachSessionKeyTracker, coachSessionKey, normalizedIdentityPart } from './coach-session-key'

// SYNTHETIC EVIDENCE: hand-built snapshots, not a real capture. They exercise the
// transitions §24-17 names — track, track configuration, car, session and condition —
// which cannot be produced on demand from a real session.

function snap(over: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 0,
    speedKmh: 200,
    rpm: 8000,
    gear: 4,
    throttle: 1,
    brake: 0,
    clutch: 0,
    steerAngleDeg: 0,
    latAccelG: 0,
    longAccelG: 0,
    onPitRoad: false,
    sessionType: 'Practice',
    trackName: 'Spa-Francorchamps',
    trackConfigName: 'Grand Prix',
    carName: 'Ferrari 488 GT3 Evo',
    currentLap: 3,
    lapDistPct: 0.4,
    ...over
  } as TelemetrySnapshot
}

describe('coachSessionKey — §24-17 reset triggers', () => {
  it('is stable across ordinary frames of the same session', () => {
    const a = coachSessionKey(snap({ timestamp: 1000, lapDistPct: 0.1, currentLap: 3 }))
    const b = coachSessionKey(snap({ timestamp: 9000, lapDistPct: 0.9, currentLap: 7 }))
    expect(a).toBe(b)
  })

  it.each([
    ['track', { trackName: 'Monza' }],
    ['track configuration', { trackConfigName: 'Endurance' }],
    ['car', { carName: 'Porsche 992 GT3 R' }],
    ['session type', { sessionType: 'Race' }],
    ['session id', { sessionUniqueId: 77 }],
    ['simulator', { sim: 'acc' as const }]
  ])('changes when the %s changes', (_label, override) => {
    expect(coachSessionKey(snap(override))).not.toBe(coachSessionKey(snap()))
  })

  it('changes when the player moves to a different car class', () => {
    const gt3 = snap({
      playerCarIdx: 0,
      drivers: [{ carIdx: 0, name: 'P', carNumber: '1', position: 1, classPosition: 1, classId: 7, isPlayer: true }]
    })
    const gt4 = snap({
      playerCarIdx: 0,
      drivers: [{ carIdx: 0, name: 'P', carNumber: '1', position: 1, classPosition: 1, classId: 9, isPlayer: true }]
    })
    expect(coachSessionKey(gt4)).not.toBe(coachSessionKey(gt3))
  })

  it('changes when the track goes from dry to wet', () => {
    const dry = coachSessionKey(snap({ trackWetnessPct: 0, isRaining: false }))
    const wet = coachSessionKey(snap({ trackWetnessPct: 0.85, isRaining: true }))
    expect(wet).not.toBe(dry)
  })

  it('accepts a caller-stabilised condition so a drying track does not flicker the key', () => {
    const a = coachSessionKey(snap({ trackWetnessPct: 0.2 }), { condition: 'drying' })
    const b = coachSessionKey(snap({ trackWetnessPct: 0.18 }), { condition: 'drying' })
    expect(a).toBe(b)
  })

  it('includes the provider session identity so a new session on the same track resets', () => {
    const first = coachSessionKey(snap(), { sessionIdentity: '1:100:5:0' })
    const second = coachSessionKey(snap(), { sessionIdentity: '1:100:5:1' })
    expect(second).not.toBe(first)
  })

  it('treats a missing trackConfigName consistently rather than as a distinct layout', () => {
    expect(coachSessionKey(snap({ trackConfigName: undefined }))).toBe(coachSessionKey(snap({ trackConfigName: '  ' })))
  })

  it('normalises case and whitespace so cosmetic metadata differences do not reset context', () => {
    expect(normalizedIdentityPart('  Spa-Francorchamps  ')).toBe('spa-francorchamps')
    expect(coachSessionKey(snap({ trackName: 'SPA-FRANCORCHAMPS' }))).toBe(coachSessionKey(snap()))
  })

  it('returns an empty key for a null snapshot', () => {
    expect(coachSessionKey(null)).toBe('')
    expect(coachSessionKey(undefined)).toBe('')
  })
})

describe('CoachSessionKeyTracker', () => {
  it('does not report the FIRST session as a change', () => {
    const tracker = new CoachSessionKeyTracker()
    expect(tracker.observe(snap())).toBe(false)
    expect(tracker.key()).not.toBe('')
  })

  it('reports a change exactly once per transition', () => {
    const tracker = new CoachSessionKeyTracker()
    tracker.observe(snap())
    expect(tracker.observe(snap({ carName: 'BMW M4 GT3' }))).toBe(true)
    expect(tracker.observe(snap({ carName: 'BMW M4 GT3' }))).toBe(false)
  })

  it('reports a change when the car swaps inside ONE session — the case a replay session identity misses', () => {
    const tracker = new CoachSessionKeyTracker()
    const identity = '1:100:5:0'
    tracker.observe(snap(), { sessionIdentity: identity })
    // Same sim session, same track, different car: iRacing's replaySessionIdentity
    // (SessionID:SubSessionID:SessionUniqueID:SessionNum) is IDENTICAL here.
    expect(tracker.observe(snap({ carName: 'Audi R8 LMS GT3' }), { sessionIdentity: identity })).toBe(true)
  })

  it('reports a change when the track goes wet inside ONE session, once the condition holds', () => {
    const tracker = new CoachSessionKeyTracker({ confirmFrames: 3 })
    const identity = '1:100:5:0'
    tracker.observe(snap({ trackWetnessPct: 0, isRaining: false }), { sessionIdentity: identity })
    const wet = snap({ trackWetnessPct: 0.9, isRaining: true })
    expect(tracker.observe(wet, { sessionIdentity: identity })).toBe(false)
    expect(tracker.observe(wet, { sessionIdentity: identity })).toBe(false)
    expect(tracker.observe(wet, { sessionIdentity: identity })).toBe(true)
    expect(tracker.observe(wet, { sessionIdentity: identity })).toBe(false)
  })

  it('does NOT wipe context when the condition flickers around a band threshold', () => {
    const tracker = new CoachSessionKeyTracker({ confirmFrames: 3 })
    const dry = snap({ trackWetnessPct: 0, isRaining: false })
    const wet = snap({ trackWetnessPct: 0.9, isRaining: true })
    tracker.observe(dry)
    for (let i = 0; i < 20; i += 1) {
      expect(tracker.observe(i % 2 === 0 ? wet : dry)).toBe(false)
    }
  })

  it('resets IMMEDIATELY on a discrete change, without waiting for confirmation frames', () => {
    const tracker = new CoachSessionKeyTracker({ confirmFrames: 100 })
    tracker.observe(snap())
    expect(tracker.observe(snap({ trackName: 'Monza' }))).toBe(true)
  })

  it('does not discard context on a momentary disconnect (null snapshot)', () => {
    const tracker = new CoachSessionKeyTracker()
    tracker.observe(snap())
    const before = tracker.key()
    expect(tracker.observe(null)).toBe(false)
    expect(tracker.key()).toBe(before)
    expect(tracker.observe(snap())).toBe(false)
  })

  it('reports a change again after an explicit reset only when the key really differs', () => {
    const tracker = new CoachSessionKeyTracker()
    tracker.observe(snap())
    tracker.reset()
    expect(tracker.observe(snap({ trackName: 'Monza' }))).toBe(false)
    expect(tracker.observe(snap())).toBe(true)
  })
})
