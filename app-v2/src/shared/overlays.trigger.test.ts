import { describe, expect, it } from 'vitest'
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

  it('shiftPoint fires above the configured fraction', () => {
    const s = { ...snap({}), shiftIndicatorPct: 0.98 } as TelemetrySnapshot
    expect(evaluateOverlayTrigger({ kind: 'shiftPoint' }, s)).toBe(true)
    const low = { ...snap({}), shiftIndicatorPct: 0.5 } as TelemetrySnapshot
    expect(evaluateOverlayTrigger({ kind: 'shiftPoint' }, low)).toBe(false)
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

  it('lowFuel uses laps-to-empty = fuel / perLap', () => {
    const low = { ...snap({}), fuelLiters: 3, fuelPerLap: 2 } as TelemetrySnapshot // 1.5 laps
    expect(evaluateOverlayTrigger({ kind: 'lowFuel' }, low)).toBe(true)
    const ok = { ...snap({}), fuelLiters: 30, fuelPerLap: 2 } as TelemetrySnapshot // 15 laps
    expect(evaluateOverlayTrigger({ kind: 'lowFuel' }, ok)).toBe(false)
    expect(evaluateOverlayTrigger({ kind: 'lowFuel', lapsToEmpty: 20 }, ok)).toBe(true)
  })
})

describe('sanitizeOverlayTrigger', () => {
  it('accepts a valid trigger and rejects junk', () => {
    expect(sanitizeOverlayTrigger({ kind: 'proximity', thresholdSec: 0.6 })).toEqual({ kind: 'proximity', thresholdSec: 0.6 })
    expect(sanitizeOverlayTrigger({ kind: 'nope' })).toBeNull()
    expect(sanitizeOverlayTrigger(null)).toBeNull()
    expect(sanitizeOverlayTrigger('x')).toBeNull()
  })
})
