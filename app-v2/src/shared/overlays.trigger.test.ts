import { describe, expect, it } from 'vitest'
import { DEFAULT_ALERTS_CONFIG } from './alerts'
import { evaluateOverlayTrigger, sanitizeOverlayTrigger } from './overlays'
import type { TelemetrySnapshot } from './telemetry'

function snap(partial: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return { sim: 'iracing', connected: true, timestamp: 1, ...partial } as TelemetrySnapshot
}

describe('evaluateOverlayTrigger', () => {
  it('always / null => visible', () => {
    expect(evaluateOverlayTrigger(null, null)).toBe(true)
    expect(evaluateOverlayTrigger({ kind: 'always' }, null)).toBe(true)
  })

  it('non-always with no snapshot => hidden', () => {
    expect(evaluateOverlayTrigger({ kind: 'pitLimiter' }, null)).toBe(false)
    expect(evaluateOverlayTrigger({ kind: 'never' }, snap())).toBe(false)
  })

  it('car left/right respects the decided side', () => {
    const s = { ...snap({}), carLeftRight: 'left' } as TelemetrySnapshot
    expect(evaluateOverlayTrigger({ kind: 'carLeft' }, s)).toBe(true)
    expect(evaluateOverlayTrigger({ kind: 'carRight' }, s)).toBe(false)
    expect(evaluateOverlayTrigger({ kind: 'carLeftOrRight' }, s)).toBe(true)
    const both = { ...snap({}), carLeftRight: 'both' } as TelemetrySnapshot
    expect(evaluateOverlayTrigger({ kind: 'carLeft' }, both)).toBe(true)
    expect(evaluateOverlayTrigger({ kind: 'carRight' }, both)).toBe(true)
  })

  it('proximity fires when a car is within the threshold', () => {
    const near = { ...snap({}), relatives: { behind: { carIdx: 3, name: 'x', carNumber: '3', gapSec: -0.4 } } } as TelemetrySnapshot
    expect(evaluateOverlayTrigger({ kind: 'proximity' }, near)).toBe(true)
    const far = { ...snap({}), relatives: { behind: { carIdx: 3, name: 'x', carNumber: '3', gapSec: -1.8 } } } as TelemetrySnapshot
    expect(evaluateOverlayTrigger({ kind: 'proximity' }, far)).toBe(false)
    expect(evaluateOverlayTrigger({ kind: 'proximity', thresholdSec: 2 }, far)).toBe(true)
  })

  it('shiftPoint uses AlertsConfig and ignores the deprecated per-trigger fallback', () => {
    const config = {
      ...DEFAULT_ALERTS_CONFIG,
      shiftPoint: {
        ...DEFAULT_ALERTS_CONFIG.shiftPoint,
        shiftIndicatorPct: 0.8,
        rpmPct: 0.9
      }
    }
    expect(evaluateOverlayTrigger(
      { kind: 'shiftPoint', shiftPct: 0.99 },
      snap({ shiftIndicatorPct: 0.81, rpm: 6000, maxRpm: 8000 }),
      config
    )).toBe(true)
    expect(evaluateOverlayTrigger(
      { kind: 'shiftPoint' },
      snap({ shiftIndicatorPct: 0.79, rpm: 6000, maxRpm: 8000 }),
      config
    )).toBe(false)
    expect(evaluateOverlayTrigger(
      { kind: 'shiftPoint' },
      snap({ shiftIndicatorPct: undefined, rpm: 7300, maxRpm: 8000 }),
      config
    )).toBe(true)
  })

  it('pitLimiter / flag', () => {
    expect(evaluateOverlayTrigger({ kind: 'pitLimiter' }, { ...snap({}), pitLimiter: true } as TelemetrySnapshot)).toBe(true)
    const yellow = {
      ...snap({}),
      flags: { green: false, yellow: true, blue: false, white: false, checkered: false, red: false, black: false, meatball: false, repair: false, disqualify: false, greenWhiteCheckered: false }
    } as TelemetrySnapshot
    expect(evaluateOverlayTrigger({ kind: 'flag' }, yellow)).toBe(true)
    const greenOnly = {
      ...snap({}),
      flags: { green: true, yellow: false, blue: false, white: false, checkered: false, red: false, black: false, meatball: false, repair: false, disqualify: false, greenWhiteCheckered: false }
    } as TelemetrySnapshot
    expect(evaluateOverlayTrigger({ kind: 'flag' }, greenOnly)).toBe(false)
  })

  it('lowFuel uses canonical laps and the AlertsConfig threshold', () => {
    const config = {
      ...DEFAULT_ALERTS_CONFIG,
      lowFuel: { ...DEFAULT_ALERTS_CONFIG.lowFuel, lapsThreshold: 4 }
    }
    expect(evaluateOverlayTrigger(
      { kind: 'lowFuel', lapsToEmpty: 1 },
      snap({ fuelLapsRemaining: 3.5 }),
      config
    )).toBe(true)
    expect(evaluateOverlayTrigger(
      { kind: 'lowFuel' },
      snap({ fuelLiters: 8, fuelPerLapLiters: 2 }),
      config
    )).toBe(false)
    expect(evaluateOverlayTrigger(
      { kind: 'lowFuel' },
      snap({ fuelLiters: 4, fuelPerLap: 2, fuelPerLapKg: 2 }),
      config
    )).toBe(false)
    expect(evaluateOverlayTrigger(
      { kind: 'lowFuel' },
      snap({ fuelLapsRemaining: Number.NaN }),
      config
    )).toBe(false)
    expect(evaluateOverlayTrigger(
      { kind: 'lowFuel' },
      snap({ connected: false, fuelLapsRemaining: 1 }),
      config
    )).toBe(false)
    expect(evaluateOverlayTrigger(
      { kind: 'lowFuel' },
      snap({ fuelLapsRemaining: 1 }),
      {
        ...config,
        lowFuel: { ...config.lowFuel, enabled: false }
      }
    )).toBe(false)
  })
})

describe('sanitizeOverlayTrigger', () => {
  it('accepts a valid trigger and rejects junk', () => {
    expect(sanitizeOverlayTrigger({ kind: 'proximity', thresholdSec: 0.6 })).toEqual({ kind: 'proximity', thresholdSec: 0.6 })
    expect(sanitizeOverlayTrigger({ kind: 'semantic', semantic: 'drs' })).toEqual({ kind: 'semantic', semantic: 'drs' })
    expect(sanitizeOverlayTrigger({ kind: 'never' })).toEqual({ kind: 'never' })
    expect(sanitizeOverlayTrigger({ kind: 'semantic', semantic: 'unknown' })).toBeNull()
    expect(sanitizeOverlayTrigger({ kind: 'nope' })).toBeNull()
    expect(sanitizeOverlayTrigger(null)).toBeNull()
    expect(sanitizeOverlayTrigger('x')).toBeNull()
  })
})
