import { describe, expect, it } from 'vitest'
import type { TelemetrySnapshot } from './telemetry'
import {
  DEFAULT_HAPTICS_ZONAL_CONFIG,
  HAPTIC_EVENT_IDS,
  HAPTIC_ZONE_IDS,
  computeZonalHaptics,
  deriveZonalEvents,
  effectiveEventLevel,
  mapEventsToZones,
  mergeHapticsZonalConfig,
  rawEventsForTest,
  type HapticsZonalConfig
} from './haptics-zonal'

function snap(partial: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1_000,
    speedKmh: 100,
    rpm: 5000,
    gear: 3,
    throttle: 0,
    brake: 0,
    clutch: 0,
    ...partial
  }
}

// Enabled config helper (the shipped default is enabled:false so output is silent).
function cfg(patch: Parameters<typeof mergeHapticsZonalConfig>[1] = {}): HapticsZonalConfig {
  return mergeHapticsZonalConfig(DEFAULT_HAPTICS_ZONAL_CONFIG, { enabled: true, muted: false, ...patch })
}

describe('deriveZonalEvents — telemetry → raw event intensities', () => {
  it('returns all-zero events when disconnected or null', () => {
    const zero = deriveZonalEvents(null, null)
    for (const id of HAPTIC_EVENT_IDS) expect(zero[id]).toBe(0)
    const disc = deriveZonalEvents(snap({ connected: false }), null)
    for (const id of HAPTIC_EVENT_IDS) expect(disc[id]).toBe(0)
  })

  it('fires gearshift on a gear change and not otherwise', () => {
    const prev = snap({ gear: 3, timestamp: 1_000 })
    const shifted = deriveZonalEvents(snap({ gear: 4, timestamp: 1_100 }), prev)
    expect(shifted.gearshift).toBe(1)
    const steady = deriveZonalEvents(snap({ gear: 3, timestamp: 1_100 }), prev)
    expect(steady.gearshift).toBe(0)
  })

  it('ramps redline with rpm fraction (rpm/maxRpm)', () => {
    expect(deriveZonalEvents(snap({ rpm: 7600, maxRpm: 8000 }), null).redline).toBe(0) // 0.95 floor
    expect(deriveZonalEvents(snap({ rpm: 8000, maxRpm: 8000 }), null).redline).toBeCloseTo(1, 5)
    expect(deriveZonalEvents(snap({ rpm: 7800, maxRpm: 8000 }), null).redline).toBeCloseTo(0.5, 1)
  })

  it('derives lockup under heavy braking without a hard impact', () => {
    // ~ -15 m/s² decel: above the lock window, below the 18 m/s² impact floor.
    const prev = snap({ speedKmh: 108, timestamp: 1_000, brake: 1 })
    const curr = snap({ speedKmh: 102.6, timestamp: 1_100, brake: 1, throttle: 0 })
    const events = deriveZonalEvents(curr, prev)
    expect(events.lockup).toBeGreaterThan(0.4)
    expect(events.wheelspin).toBe(0)
    expect(events.contact).toBe(0)
  })

  it('derives wheelspin when traction control cuts on throttle', () => {
    const events = deriveZonalEvents(snap({ throttle: 1, brake: 0, tcActive: true }), null)
    expect(events.wheelspin).toBeGreaterThanOrEqual(0.6)
    expect(events.lockup).toBe(0)
  })

  it('derives a contact spike on a sudden large deceleration', () => {
    // ~ -50 m/s² over 0.1s, brake low so it reads as contact, not lockup.
    const prev = snap({ speedKmh: 200, timestamp: 1_000, brake: 0 })
    const curr = snap({ speedKmh: 182, timestamp: 1_100, brake: 0, throttle: 0 })
    expect(deriveZonalEvents(curr, prev).contact).toBeGreaterThan(0.3)
  })
})

describe('effectiveEventLevel — per-event gate', () => {
  it('is silent below threshold and when disabled', () => {
    expect(effectiveEventLevel(0.1, { enabled: true, gain: 1, threshold: 0.2, zones: { seat: 1, pedalLeft: 0, pedalRight: 0, wheel: 0 } })).toBe(0)
    expect(effectiveEventLevel(1, { enabled: false, gain: 1, threshold: 0, zones: { seat: 1, pedalLeft: 0, pedalRight: 0, wheel: 0 } })).toBe(0)
  })

  it('re-normalizes across [threshold,1] and scales by gain', () => {
    const level = effectiveEventLevel(0.6, { enabled: true, gain: 0.5, threshold: 0.2, zones: { seat: 1, pedalLeft: 0, pedalRight: 0, wheel: 0 } })
    // (0.6-0.2)/(1-0.2) = 0.5, * gain 0.5 = 0.25
    expect(level).toBeCloseTo(0.25, 5)
  })
})

describe('mapEventsToZones — routing onto zones', () => {
  it('routes gearshift mostly to the wheel zone', () => {
    const frame = mapEventsToZones(rawEventsForTest('gearshift'), cfg())
    expect(frame.zones.wheel).toBeGreaterThan(0)
    expect(frame.zones.wheel).toBeGreaterThan(frame.zones.seat)
    expect(frame.zones.wheel).toBeGreaterThan(frame.zones.pedalLeft)
  })

  it('routes redline to the wheel and not the pedals', () => {
    const frame = mapEventsToZones(rawEventsForTest('redline'), cfg())
    expect(frame.zones.wheel).toBeGreaterThan(0)
    expect(frame.zones.pedalLeft).toBe(0)
    expect(frame.zones.pedalRight).toBe(0)
  })

  it('routes contact to every zone (whole-body jolt)', () => {
    const frame = mapEventsToZones(rawEventsForTest('contact'), cfg())
    for (const id of HAPTIC_ZONE_IDS) expect(frame.zones[id]).toBeGreaterThan(0)
  })

  it('silences everything when muted or globally disabled', () => {
    const muted = mapEventsToZones(rawEventsForTest('contact'), cfg({ muted: true }))
    for (const id of HAPTIC_ZONE_IDS) expect(muted.zones[id]).toBe(0)
    for (const id of HAPTIC_EVENT_IDS) expect(muted.events[id]).toBe(0)
    const disabled = mapEventsToZones(rawEventsForTest('contact'), mergeHapticsZonalConfig(DEFAULT_HAPTICS_ZONAL_CONFIG, { enabled: false }))
    for (const id of HAPTIC_ZONE_IDS) expect(disabled.zones[id]).toBe(0)
  })

  it('respects a disabled zone and per-zone gain', () => {
    const off = mapEventsToZones(rawEventsForTest('contact'), cfg({ zones: { seat: { enabled: false } } }))
    expect(off.zones.seat).toBe(0)
    expect(off.zones.wheel).toBeGreaterThan(0)

    const full = mapEventsToZones(rawEventsForTest('contact'), cfg({ masterGain: 1, zones: { seat: { gain: 1 } } }))
    const half = mapEventsToZones(rawEventsForTest('contact'), cfg({ masterGain: 1, zones: { seat: { gain: 0.5 } } }))
    expect(half.zones.seat).toBeCloseTo(full.zones.seat * 0.5, 5)
  })

  it('scales output with masterGain', () => {
    const full = mapEventsToZones(rawEventsForTest('contact'), cfg({ masterGain: 1 }))
    const half = mapEventsToZones(rawEventsForTest('contact'), cfg({ masterGain: 0.5 }))
    expect(half.zones.wheel).toBeCloseTo(full.zones.wheel * 0.5, 5)
  })
})

describe('computeZonalHaptics — end to end', () => {
  it('lights the wheel on a gearshift through the full pipeline', () => {
    const prev = snap({ gear: 3, timestamp: 1_000 })
    const curr = snap({ gear: 4, timestamp: 1_100 })
    const frame = computeZonalHaptics(curr, prev, cfg())
    expect(frame.events.gearshift).toBeGreaterThan(0)
    expect(frame.zones.wheel).toBeGreaterThan(0)
  })
})

describe('mergeHapticsZonalConfig — persistence merge', () => {
  it('applies and clamps patches and stamps updatedAt', () => {
    const merged = mergeHapticsZonalConfig(DEFAULT_HAPTICS_ZONAL_CONFIG, {
      enabled: true,
      masterGain: 5, // clamps to 1
      minIntervalMs: 1, // clamps to 30
      events: { kerb: { gain: -1, zones: { seat: 9 } } }, // clamps to 0..1
      zones: { wheel: { label: '  Rim  ' } }
    })
    expect(merged.enabled).toBe(true)
    expect(merged.masterGain).toBe(1)
    expect(merged.minIntervalMs).toBe(30)
    expect(merged.events.kerb.gain).toBe(0)
    expect(merged.events.kerb.zones.seat).toBe(1)
    expect(merged.zones.wheel.label).toBe('Rim')
    expect(merged.updatedAt).toBeGreaterThan(0)
  })

  it('merges the optional Arduino buzzer block with clamped frequency', () => {
    const merged = mergeHapticsZonalConfig(DEFAULT_HAPTICS_ZONAL_CONFIG, {
      arduino: { enabled: true, deviceId: ' dev-1 ', frequencyHz: 999 }
    })
    expect(merged.arduino.enabled).toBe(true)
    expect(merged.arduino.deviceId).toBe('dev-1')
    expect(merged.arduino.frequencyHz).toBe(200)
  })
})
