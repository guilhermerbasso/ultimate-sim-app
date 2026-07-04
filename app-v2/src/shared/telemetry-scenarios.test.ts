import { describe, expect, it } from 'vitest'
import {
  TELEMETRY_SCENARIOS,
  TELEMETRY_SCENARIO_IDS,
  baseSnapshot,
  sampleScenario
} from './telemetry-scenarios'

describe('telemetry scenarios', () => {
  it('baseSnapshot is a connected, complete GT3 frame', () => {
    const s = baseSnapshot()
    expect(s.connected).toBe(true)
    expect(s.maxRpm).toBeGreaterThan(s.rpm)
    expect(s.tyres?.lf?.tempC).toBeGreaterThan(0)
    expect(s.brakeTempC?.rf).toBeGreaterThan(0)
  })

  it('every frame sampler is deterministic (same t → identical snapshot)', () => {
    for (const id of TELEMETRY_SCENARIO_IDS) {
      const a = TELEMETRY_SCENARIOS[id].frame(0.5)
      const b = TELEMETRY_SCENARIOS[id].frame(0.5)
      expect(JSON.stringify(a), id).toBe(JSON.stringify(b))
      expect(a.connected, id).toBe(true)
    }
  })

  it('shift-light-sweep ramps shift indicator 0 → 1', () => {
    const sweep = TELEMETRY_SCENARIOS['shift-light-sweep']
    expect(sweep.frame(0).shiftIndicatorPct).toBeCloseTo(0, 5)
    expect(sweep.frame(1).shiftIndicatorPct).toBeCloseTo(1, 5)
    expect(sweep.frame(1).revLights?.blink).toBe(true)
  })

  it('low-fuel drains fuel over the scenario', () => {
    const lf = TELEMETRY_SCENARIOS['low-fuel']
    expect(lf.frame(1).fuelLiters!).toBeLessThan(lf.frame(0).fuelLiters!)
    expect(lf.frame(1).fuelLiters!).toBeLessThan(2)
  })

  it('yellow-flag raises the yellow flag and drops green', () => {
    const y = TELEMETRY_SCENARIOS['yellow-flag'].frame(0.5)
    expect(y.flags?.yellow).toBe(true)
    expect(y.flags?.green).toBe(false)
  })

  it('overheat pushes water/oil temps into the danger band', () => {
    const o = TELEMETRY_SCENARIOS.overheat.frame(1)
    expect(o.waterTempC!).toBeGreaterThanOrEqual(120)
    expect(o.oilTempC!).toBeGreaterThanOrEqual(140)
  })

  it('sampleScenario returns the requested number of frames spanning [0,1]', () => {
    const frames = sampleScenario('flying-lap', 10)
    expect(frames.length).toBe(10)
    expect(frames[0].timestamp).toBe(0)
    expect(frames[9].timestamp).toBeGreaterThan(frames[0].timestamp)
  })
})
