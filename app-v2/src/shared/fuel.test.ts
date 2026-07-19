import { describe, expect, it } from 'vitest'
import { FuelLapEstimator } from './fuel'

describe('FuelLapEstimator result isolation', () => {
  it('clones sample objects returned while telemetry is non-live', () => {
    const estimator = new FuelLapEstimator()
    const sessionIdentity = 'session-a'
    estimator.update({
      sessionIdentity,
      live: true,
      currentLap: 1,
      fuelLiters: 10,
      timestamp: 1_000
    })
    estimator.update({
      sessionIdentity,
      live: true,
      currentLap: 2,
      fuelLiters: 8,
      timestamp: 101_000,
      lapTimeSec: 100
    })
    estimator.update({
      sessionIdentity,
      live: true,
      currentLap: 3,
      fuelLiters: 6,
      timestamp: 201_000,
      lapTimeSec: 100
    })

    const paused = estimator.update({ sessionIdentity, live: false })
    expect(paused.samples).toEqual([
      { lap: 2, usedLiters: 2, lapTimeSec: 100 }
    ])
    paused.samples[0].usedLiters = 99
    paused.samples[0].lapTimeSec = 1

    expect(estimator.update({ sessionIdentity, live: false }).samples).toEqual([
      { lap: 2, usedLiters: 2, lapTimeSec: 100 }
    ])
  })
})
