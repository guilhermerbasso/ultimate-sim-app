import { describe, expect, it } from 'vitest'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import { FuelStrategyCalculator } from './fuel'

function snapshot(
  lap: number,
  fuelLiters: number,
  overrides: Partial<TelemetrySnapshot> = {}
): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: lap * 100_000,
    speedKmh: 180,
    rpm: 6000,
    gear: 3,
    throttle: 0.8,
    brake: 0,
    clutch: 0,
    currentLap: lap,
    fuelLiters,
    lastLapTimeSec: 100,
    ...overrides
  }
}

describe('FuelStrategyCalculator truthful lap samples', () => {
  it('keeps canonical litres/lap authoritative and discards the attach transition', () => {
    const calculator = new FuelStrategyCalculator()

    expect(calculator.update(snapshot(4, 20, { fuelPerLapLiters: 2 })))
      .toMatchObject({ usedPerLap: 2, samples: [] })
    expect(calculator.update(snapshot(5, 18.8, { fuelPerLapLiters: 2 })))
      .toMatchObject({ usedPerLap: 2, samples: [] })

    const fullLap = calculator.update(snapshot(6, 16.8, {
      fuelPerLapLiters: 2
    }))
    expect(fullLap.usedPerLap).toBe(2)
    expect(fullLap.samples).toEqual([
      { lap: 5, usedLiters: 2, lapTimeSec: 100 }
    ])
  })

  it('does not add or average a refueled lap over clean provider telemetry', () => {
    const calculator = new FuelStrategyCalculator()
    calculator.update(snapshot(4, 24, { fuelPerLapLiters: 2 }))
    calculator.update(snapshot(5, 22, { fuelPerLapLiters: 2 }))
    calculator.update(snapshot(6, 20, { fuelPerLapLiters: 2 }))
    calculator.update(snapshot(6, 10, { fuelPerLapLiters: 2 }))

    const refueledBoundary = calculator.update(snapshot(7, 17, {
      fuelPerLapLiters: 2
    }))
    expect(refueledBoundary.usedPerLap).toBe(2)
    expect(refueledBoundary.samples).toEqual([
      { lap: 5, usedLiters: 2, lapTimeSec: 100 }
    ])
  })
})
