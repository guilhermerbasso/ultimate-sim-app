import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ALERTS_CONFIG,
  type AlertsConfig
} from '../../shared/alerts'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import { AlertsDetector } from './detector'

function config(overrides: Partial<AlertsConfig> = {}): AlertsConfig {
  return {
    ...DEFAULT_ALERTS_CONFIG,
    pitLimiter: { ...DEFAULT_ALERTS_CONFIG.pitLimiter, enabled: false },
    flags: { ...DEFAULT_ALERTS_CONFIG.flags, enabled: false },
    lowFuel: { ...DEFAULT_ALERTS_CONFIG.lowFuel, enabled: false },
    shiftPoint: { ...DEFAULT_ALERTS_CONFIG.shiftPoint, enabled: false },
    incidentLimit: { ...DEFAULT_ALERTS_CONFIG.incidentLimit, enabled: false },
    tyrePressure: { ...DEFAULT_ALERTS_CONFIG.tyrePressure!, enabled: false },
    tyreTemp: { ...DEFAULT_ALERTS_CONFIG.tyreTemp!, enabled: false },
    brakeTemp: { ...DEFAULT_ALERTS_CONFIG.brakeTemp!, enabled: false },
    drsAvailable: { ...DEFAULT_ALERTS_CONFIG.drsAvailable!, enabled: false },
    blueFlag: { ...DEFAULT_ALERTS_CONFIG.blueFlag!, enabled: false },
    ...overrides
  }
}

function snapshot(
  timestamp: number,
  overrides: Partial<TelemetrySnapshot> = {}
): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp,
    speedKmh: 180,
    rpm: 6000,
    gear: 3,
    throttle: 0.8,
    brake: 0,
    clutch: 0,
    ...overrides
  }
}

describe('AlertsDetector threshold truth', () => {
  it('uses the configured low-fuel threshold with canonical laps remaining', () => {
    const detector = new AlertsDetector(config({
      lowFuel: { ...DEFAULT_ALERTS_CONFIG.lowFuel, enabled: true, lapsThreshold: 4 }
    }))

    expect(detector.process(snapshot(1000, { fuelLapsRemaining: 4.5 }))).toEqual([])
    const events = detector.process(snapshot(2000, { fuelLapsRemaining: 3.5 }))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'lowFuel',
      context: { value: 3.5, threshold: 4, unit: 'laps' }
    })
  })

  it('does not treat kg/lap as litres/lap and hides missing or invalid fuel data', () => {
    const detector = new AlertsDetector(config({
      lowFuel: { ...DEFAULT_ALERTS_CONFIG.lowFuel, enabled: true, lapsThreshold: 3 }
    }))

    expect(detector.process(snapshot(1000, {
      fuelLiters: 4,
      fuelPerLap: 2,
      fuelPerLapKg: 2
    }))).toEqual([])
    expect(detector.process(snapshot(2000, {
      fuelLiters: Number.NaN,
      fuelPerLapLiters: 2
    }))).toEqual([])
    expect(detector.process(snapshot(3000, {
      fuelLiters: 4,
      fuelPerLapLiters: 0
    }))).toEqual([])
  })

  it('uses configured shift thresholds instead of an internal 0.97 fallback', () => {
    const detector = new AlertsDetector(config({
      shiftPoint: {
        ...DEFAULT_ALERTS_CONFIG.shiftPoint,
        enabled: true,
        shiftIndicatorPct: 0.8,
        rpmPct: 0.9
      }
    }))

    expect(detector.process(snapshot(1000, {
      shiftIndicatorPct: 0.79,
      maxRpm: 8000
    }))).toEqual([])
    expect(detector.process(snapshot(2000, {
      shiftIndicatorPct: 0.81,
      maxRpm: 8000
    }))).toEqual([
      expect.objectContaining({ type: 'shiftPoint' })
    ])
  })

  it('uses provider blink before percentage shift thresholds', () => {
    const detector = new AlertsDetector(config({
      shiftPoint: { ...DEFAULT_ALERTS_CONFIG.shiftPoint, enabled: true }
    }))

    expect(detector.process(snapshot(1000, {
      shiftIndicatorPct: 0.999,
      rpm: 7999,
      maxRpm: 8000,
      revLights: { pct: 0.999, blink: false }
    }))).toEqual([])

    expect(detector.process(snapshot(2000, {
      shiftIndicatorPct: 0.2,
      rpm: 2000,
      maxRpm: 8000,
      revLights: { pct: 0.2, blink: true }
    }))).toEqual([
      expect.objectContaining({ type: 'shiftPoint' })
    ])
  })

  it('ignores iRacing garage cold pressure for live tyre-pressure alerts', () => {
    const detector = new AlertsDetector(config({
      tyrePressure: {
        ...DEFAULT_ALERTS_CONFIG.tyrePressure!,
        enabled: true,
        minKpa: 150,
        maxKpa: 230
      }
    }))

    expect(detector.process(snapshot(1000, {
      tireColdPressuresKpa: { lf: 100, rf: 100, lr: 100, rr: 100 },
      tyres: { lf: { tempC: 80 }, rf: {}, lr: {}, rr: {} }
    }))).toEqual([])
    expect(detector.process(snapshot(2000, {
      tireColdPressuresKpa: { lf: 100, rf: 100, lr: 100, rr: 100 },
      tyres: { lf: { pressureKpa: 140 }, rf: {}, lr: {}, rr: {} }
    }))).toEqual([
      expect.objectContaining({
        type: 'tyrePressure',
        context: {
          corner: 'lf',
          direction: 'low',
          value: 140,
          threshold: 150,
          unit: 'kPa'
        }
      })
    ])
  })
})
