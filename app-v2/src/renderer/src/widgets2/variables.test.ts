import { describe, expect, it } from 'vitest'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import { readVariable, type WidgetVariable } from './variables'

function snapshot(): TelemetrySnapshot {
  return {
    sim: 'none',
    connected: true,
    timestamp: 0,
    speedKmh: 0,
    rpm: 0,
    gear: 0,
    throttle: 0,
    brake: 0,
    clutch: 0
  }
}

describe('readVariable thresholds', () => {
  it('does not mark invert variables as crit when only warnFrom is defined', () => {
    const variable: WidgetVariable = {
      id: 'invert-warn-only',
      label: 'Invert Warn Only',
      group: 'fuel',
      unit: '%',
      min: 0,
      max: 100,
      decimals: 0,
      invert: true,
      warnFrom: 0.3,
      read: () => 20
    }

    expect(readVariable(variable, snapshot()).state).toBe('warn')
  })

  it('keeps crit behavior for invert variables that define redlineFrom', () => {
    const variable: WidgetVariable = {
      id: 'invert-both',
      label: 'Invert Both',
      group: 'fuel',
      unit: '%',
      min: 0,
      max: 100,
      decimals: 0,
      invert: true,
      warnFrom: 0.3,
      redlineFrom: 0.1,
      read: () => 5
    }

    expect(readVariable(variable, snapshot()).state).toBe('crit')
  })
})
