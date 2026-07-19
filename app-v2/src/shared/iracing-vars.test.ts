import { describe, expect, it } from 'vitest'
import { buildIracingExpressionScope, IRACING_VARIABLES } from './iracing-vars'
import type { TelemetrySnapshot } from './telemetry'

describe('iRacing expression DRS compatibility', () => {
  it('keeps DRS_Status boolean and exposes the normalized enum separately', () => {
    const status = IRACING_VARIABLES.find((variable) => variable.id === 'DRS_Status')
    const state = IRACING_VARIABLES.find((variable) => variable.id === 'DRS_State')
    expect(status?.telemetryField).toBe('drs')
    expect(state?.telemetryField).toBe('drsState')

    const snapshot = {
      sim: 'iracing',
      connected: true,
      timestamp: 1,
      speedKmh: 0,
      rpm: 0,
      gear: 0,
      throttle: 0,
      brake: 0,
      clutch: 0,
      drs: true,
      drsState: 3
    } satisfies TelemetrySnapshot

    expect(buildIracingExpressionScope(snapshot, ['DRS_Status', 'DRS_State'])).toEqual({
      DRS_Status: true,
      DRS_State: 3
    })
  })

  describe('iRacing shift RPM mapping', () => {
    it('maps DriverCarSLShiftRPM to raw shiftRpm instead of maxRpm', () => {
      const shift = IRACING_VARIABLES.find((variable) => variable.id === 'DriverCarSLShiftRPM')
      expect(shift?.telemetryField).toBe('shiftRpm')

      const snapshot = {
        sim: 'iracing',
        connected: true,
        timestamp: 1,
        speedKmh: 0,
        rpm: 6690,
        gear: 3,
        throttle: 0,
        brake: 0,
        clutch: 0,
        shiftRpm: 6690,
        maxRpm: 7500
      } satisfies TelemetrySnapshot

      expect(buildIracingExpressionScope(snapshot, ['DriverCarSLShiftRPM'])).toEqual({
        DriverCarSLShiftRPM: 6690
      })
    })
  })
})
