import { describe, expect, it } from 'vitest'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import {
  activeCornerFlags,
  canSendPitCommands,
  chatMacroNumbers,
  clampFuel,
  isServiceFlagged,
  stepFuel,
  stepPressure
} from './state'

function snap(partial: Partial<TelemetrySnapshot>): TelemetrySnapshot {
  return { sim: 'iracing', connected: true, timestamp: 0, speedKmh: 0, rpm: 0, gear: 0, throttle: 0, brake: 0, clutch: 0, ...partial } as TelemetrySnapshot
}

describe('canSendPitCommands gating', () => {
  it('requires both control connected and live telemetry', () => {
    expect(canSendPitCommands({ available: true, connected: true }, snap({ connected: true }))).toBe(true)
  })

  it('blocks when the broadcast control is not connected', () => {
    expect(canSendPitCommands({ available: true, connected: false }, snap({ connected: true }))).toBe(false)
  })

  it('blocks when telemetry is not live (off track)', () => {
    expect(canSendPitCommands({ available: true, connected: true }, snap({ connected: false }))).toBe(false)
    expect(canSendPitCommands({ available: true, connected: true }, null)).toBe(false)
  })

  it('blocks when status is missing', () => {
    expect(canSendPitCommands(null, snap({ connected: true }))).toBe(false)
  })
})

describe('pressure stepper', () => {
  it('rounds and clamps to the KPa window', () => {
    expect(stepPressure(165, 1)).toBe(166)
    expect(stepPressure(165, -1)).toBe(164)
    expect(stepPressure(100, -5)).toBe(100)
    expect(stepPressure(250, 5)).toBe(250)
  })

  it('honors custom bounds', () => {
    expect(stepPressure(120, 100, 100, 130)).toBe(130)
  })
})

describe('fuel stepper', () => {
  it('clamps to >= 0 and rounds', () => {
    expect(stepFuel(10, 5)).toBe(15)
    expect(stepFuel(2, -10)).toBe(0)
    expect(clampFuel(10.6)).toBe(11)
  })
})

describe('pit service flag decoding', () => {
  it('maps pitServiceFlags into per-corner booleans', () => {
    const flags = activeCornerFlags(snap({ pitServiceFlags: ['fuel', 'lf', 'RR'] }))
    expect(flags).toEqual({ lf: true, rf: false, lr: false, rr: true })
  })

  it('detects an arbitrary service flag case-insensitively', () => {
    expect(isServiceFlagged(snap({ pitServiceFlags: ['fastRepair'] }), 'fastrepair')).toBe(true)
    expect(isServiceFlagged(snap({ pitServiceFlags: [] }), 'fuel')).toBe(false)
    expect(isServiceFlagged(null, 'fuel')).toBe(false)
  })
})

describe('chat macros', () => {
  it('enumerates macros 1..15', () => {
    const macros = chatMacroNumbers()
    expect(macros).toHaveLength(15)
    expect(macros[0]).toBe(1)
    expect(macros[14]).toBe(15)
  })
})
