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

  describe('AlertsDetector repeat severity', () => {
    it.each([
      ['black', 'critical'],
      ['meatball', 'critical'],
      ['yellow', 'warning']
    ] as const)('preserves %s flag severity from initial event to repeat', (flag, severity) => {
      const detector = new AlertsDetector(config({
        flags: {
          ...DEFAULT_ALERTS_CONFIG.flags,
          enabled: true,
          cooldownMs: 0,
          repeatMs: 1_000
        }
      }))
      const flags = {
        green: false,
        yellow: false,
        blue: false,
        white: false,
        checkered: false,
        red: false,
        black: false,
        meatball: false,
        repair: false,
        disqualify: false,
        greenWhiteCheckered: false,
        [flag]: true
      }

      const initial = detector.process(snapshot(1_000, { flags }))
      const repeat = detector.process(snapshot(2_000, { flags }))

      expect(initial).toHaveLength(1)
      expect(repeat).toHaveLength(1)
      expect(initial[0].severity).toBe(severity)
      expect(repeat[0].severity).toBe(severity)
    })

    it.each([
      [1, 'critical'],
      [3, 'warning']
    ] as const)(
      'preserves incident-limit severity with %i remaining from initial event to repeat',
      (remaining, severity) => {
        const detector = new AlertsDetector(config({
          incidentLimit: {
            ...DEFAULT_ALERTS_CONFIG.incidentLimit,
            enabled: true,
            remainingThreshold: 4,
            cooldownMs: 0,
            repeatMs: 1_000
          }
        }))
        const incidentLimit = 10
        const incidentCount = incidentLimit - remaining

        const initial = detector.process(
          snapshot(1_000, { incidentCount, incidentLimit })
        )
        const repeat = detector.process(
          snapshot(2_000, { incidentCount, incidentLimit })
        )

        expect(initial).toHaveLength(1)
        expect(repeat).toHaveLength(1)
        expect(initial[0].severity).toBe(severity)
        expect(repeat[0].severity).toBe(severity)
      }
    )

    it('emits warning-to-critical incident escalation inside cooldown and repeats critical', () => {
      const detector = new AlertsDetector(config({
        incidentLimit: {
          ...DEFAULT_ALERTS_CONFIG.incidentLimit,
          enabled: true,
          remainingThreshold: 4,
          cooldownMs: 5_000,
          repeatMs: 1_000
        }
      }))

      const warning = detector.process(
        snapshot(1_000, { incidentCount: 7, incidentLimit: 10 })
      )
      const critical = detector.process(
        snapshot(1_100, { incidentCount: 9, incidentLimit: 10 })
      )
      const repeat = detector.process(
        snapshot(6_100, { incidentCount: 9, incidentLimit: 10 })
      )

      expect(warning).toHaveLength(1)
      expect(warning[0].severity).toBe('warning')
      expect(critical).toHaveLength(1)
      expect(critical[0].severity).toBe('critical')
      expect(repeat).toHaveLength(1)
      expect(repeat[0].severity).toBe('critical')
    })

    it('keeps a cooldown-blocked warning transition pending until it emits', () => {
      const detector = new AlertsDetector(config({
        incidentLimit: {
          ...DEFAULT_ALERTS_CONFIG.incidentLimit,
          enabled: true,
          remainingThreshold: 4,
          cooldownMs: 5_000,
          repeatMs: 0
        }
      }))

      expect(detector.process(
        snapshot(1_000, { incidentCount: 6, incidentLimit: 10 })
      )).toHaveLength(1)
      expect(detector.process(
        snapshot(1_100, { incidentCount: 7, incidentLimit: 10 })
      )).toEqual([])
      const admitted = detector.process(
        snapshot(6_000, { incidentCount: 7, incidentLimit: 10 })
      )

      expect(admitted).toHaveLength(1)
      expect(admitted[0]).toMatchObject({
        severity: 'warning',
        context: { count: 7, remaining: 3 }
      })
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
