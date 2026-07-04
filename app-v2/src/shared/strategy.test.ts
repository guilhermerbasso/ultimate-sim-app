import { describe, expect, it } from 'vitest'
import type { TelemetrySnapshot } from './telemetry'
import {
  DEFAULT_STRATEGY_CONFIG,
  computeFuelProjection,
  computePitWindow,
  computeRaceLapsRemaining,
  computeStrategyPlan,
  computeTyreProjection,
  computeUndercut,
  estimateFreshTyreGainSec,
  mergeStrategyConfig,
  narrateStrategyPlan,
  STRATEGY_CHANNELS,
  type StrategyConfig,
  type StrategyRates
} from './strategy'

// Minimal telemetry factory — fills the required fields so tests only declare
// what they care about.
function snap(partial: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sim: 'mock',
    connected: true,
    timestamp: 1_000,
    speedKmh: 180,
    rpm: 7000,
    gear: 4,
    throttle: 1,
    brake: 0,
    clutch: 0,
    ...partial
  }
}

describe('computeRaceLapsRemaining', () => {
  it('prefers explicit targetLaps minus progress', () => {
    const cfg: StrategyConfig = { ...DEFAULT_STRATEGY_CONFIG, targetLaps: 20 }
    const remaining = computeRaceLapsRemaining(snap({ currentLap: 5, lapDistPct: 0.25 }), cfg, 90)
    // 20 - 5 + 1 - 0.25 = 15.75
    expect(remaining).toBeCloseTo(15.75, 5)
  })

  it('falls back to lapsRemaining from telemetry', () => {
    const remaining = computeRaceLapsRemaining(snap({ lapsRemaining: 12 }), DEFAULT_STRATEGY_CONFIG, 90)
    expect(remaining).toBe(12)
  })

  it('derives laps from session time and lap time', () => {
    const remaining = computeRaceLapsRemaining(snap({ sessionTimeRemainingSec: 900 }), DEFAULT_STRATEGY_CONFIG, 90)
    expect(remaining).toBe(10)
  })

  it('ignores the iRacing 32767 timed-session sentinel and uses session time instead', () => {
    // In a timed session iRacing reports lapsRemaining = 32767 (sentinel). It must
    // NOT be treated as a real lap count (that yielded ~82000 L of fuel-to-finish);
    // fall through to the time-based estimate.
    const remaining = computeRaceLapsRemaining(
      snap({ lapsRemaining: 32767, sessionTimeRemainingSec: 1800 }),
      DEFAULT_STRATEGY_CONFIG,
      90
    )
    expect(remaining).toBe(20)
  })

  it('returns undefined without enough info', () => {
    expect(computeRaceLapsRemaining(snap(), DEFAULT_STRATEGY_CONFIG, undefined)).toBeUndefined()
  })
})

describe('computeFuelProjection', () => {
  const rates: StrategyRates = { fuelPerLap: 2, lapTimeSec: 90 }

  it('computes laps of fuel, margin and fuel-to-finish', () => {
    const fuel = computeFuelProjection(snap({ fuelLiters: 30 }), rates, DEFAULT_STRATEGY_CONFIG, 10)
    expect(fuel.lapsOfFuel).toBe(15)
    // fuelToFinish = 10 * 2 + margin(0.5 lap * 2 = 1) = 21
    expect(fuel.fuelToFinishLiters).toBe(21)
    // marginLiters = 30 - 21 = 9
    expect(fuel.marginLiters).toBe(9)
    // marginLaps = 15 - 10 - 0.5 = 4.5
    expect(fuel.marginLaps).toBe(4.5)
    expect(fuel.canFinish).toBe(true)
    expect(fuel.shortFillLiters).toBe(0)
    expect(fuel.savePerLapLiters).toBe(0)
  })

  it('flags cannot-finish and a fuel-save target when short on fuel', () => {
    const fuel = computeFuelProjection(snap({ fuelLiters: 15 }), rates, DEFAULT_STRATEGY_CONFIG, 10)
    // lapsOfFuel = 7.5, need ~10 laps → cannot finish
    expect(fuel.canFinish).toBe(false)
    expect(fuel.marginLiters).toBeLessThan(0)
    // shortFill = fuelToFinish(21) - fuel(15) = 6
    expect(fuel.shortFillLiters).toBe(6)
    // savePerLap > 0 to stretch the tank to the flag
    expect(fuel.savePerLapLiters).toBeGreaterThan(0)
  })

  it('uses snapshot fuelPerLap when rate is absent', () => {
    const fuel = computeFuelProjection(snap({ fuelLiters: 20, fuelPerLap: 2.5 }), {}, DEFAULT_STRATEGY_CONFIG, 5)
    expect(fuel.fuelPerLap).toBe(2.5)
    expect(fuel.lapsOfFuel).toBe(8)
  })
})

describe('computeTyreProjection', () => {
  it('projects laps to threshold and full stint length', () => {
    // life 0.9, losing 0.05/lap, threshold 0.30 → (0.9-0.3)/0.05 = 12 laps left;
    // a fresh set lasts (1-0.3)/0.05 = 14 laps.
    const tyres = computeTyreProjection({ tyreLifePct: 0.9, tyreWearPerLapPct: 0.05 }, DEFAULT_STRATEGY_CONFIG)
    expect(tyres.lapsToThreshold).toBe(12)
    expect(tyres.stintLaps).toBe(14)
    expect(tyres.lifePct).toBe(0.9)
  })

  it('returns no projection without a wear rate', () => {
    const tyres = computeTyreProjection({ tyreLifePct: 0.8 }, DEFAULT_STRATEGY_CONFIG)
    expect(tyres.lapsToThreshold).toBeUndefined()
    expect(tyres.stintLaps).toBeUndefined()
  })

  it('clamps laps-to-threshold at zero when past the limit', () => {
    const tyres = computeTyreProjection({ tyreLifePct: 0.2, tyreWearPerLapPct: 0.05 }, DEFAULT_STRATEGY_CONFIG)
    expect(tyres.lapsToThreshold).toBe(0)
  })
})

describe('computePitWindow', () => {
  it('is closed when the car can finish without stopping', () => {
    const fuel = computeFuelProjection(snap({ fuelLiters: 40 }), { fuelPerLap: 2 }, DEFAULT_STRATEGY_CONFIG, 10)
    const tyres = computeTyreProjection({}, DEFAULT_STRATEGY_CONFIG)
    const window = computePitWindow(snap({ currentLap: 5 }), fuel, tyres, DEFAULT_STRATEGY_CONFIG)
    expect(window.open).toBe(false)
    expect(window.limitedBy).toBe('none')
  })

  it('opens within the span and reports the limiting constraint (fuel)', () => {
    // 6 laps of fuel, need 30 laps → fuel-limited; optimal in ~5 laps, span 5 → open.
    const fuel = computeFuelProjection(snap({ fuelLiters: 12, currentLap: 3 }), { fuelPerLap: 2 }, DEFAULT_STRATEGY_CONFIG, 30)
    const tyres = computeTyreProjection({}, DEFAULT_STRATEGY_CONFIG)
    const window = computePitWindow(snap({ currentLap: 3 }), fuel, tyres, DEFAULT_STRATEGY_CONFIG)
    expect(window.limitedBy).toBe('fuel')
    expect(window.open).toBe(true)
    expect(window.optimalLap).toBeGreaterThanOrEqual(3)
  })

  it('chooses tyres when they force the earlier stop', () => {
    const fuel = computeFuelProjection(snap({ fuelLiters: 60 }), { fuelPerLap: 2 }, DEFAULT_STRATEGY_CONFIG, 40)
    const tyres = computeTyreProjection({ tyreLifePct: 0.5, tyreWearPerLapPct: 0.1 }, DEFAULT_STRATEGY_CONFIG)
    const window = computePitWindow(snap({ currentLap: 10 }), fuel, tyres, DEFAULT_STRATEGY_CONFIG)
    expect(window.limitedBy).toBe('tyres')
    // (0.5-0.3)/0.1 = 2 laps → open and near
    expect(window.open).toBe(true)
    expect(window.optimalLap).toBe(12)
  })
})

describe('computeUndercut', () => {
  const rates: StrategyRates = { tyreLifePct: 0.5, tyreWearPerLapPct: 0.05, lapTimeSec: 90 }

  it('recommends undercut when the gap to the car ahead is within the fresh-tyre jump', () => {
    // life 0.5 → lost 0.5 → gain = 0.5 * 2.0 = 1.0s; rival ahead 0.8s → net <= 0 → undercut
    const s = snap({ relatives: { ahead: { carIdx: 7, name: 'Rival A', carNumber: '7', gapSec: 0.8 } } })
    const u = computeUndercut(s, rates, DEFAULT_STRATEGY_CONFIG)
    expect(u.available).toBe(true)
    expect(u.gapSec).toBe(0.8)
    expect(u.recommendation).toBe('undercut')
    expect(u.netGapAfterUndercutSec).toBeLessThanOrEqual(0)
  })

  it('recommends track-position when rival ahead is far away', () => {
    const s = snap({ relatives: { ahead: { carIdx: 7, name: 'Rival A', carNumber: '7', gapSec: 40 } } })
    const u = computeUndercut(s, rates, DEFAULT_STRATEGY_CONFIG)
    expect(u.recommendation).toBe('track-position')
  })

  it('recommends overcut for a mid-range gap ahead', () => {
    // gap 10s: > fresh jump (1s) but <= pitLoss (25s) → overcut
    const s = snap({ relatives: { ahead: { carIdx: 7, name: 'Rival A', carNumber: '7', gapSec: 10 } } })
    const u = computeUndercut(s, rates, DEFAULT_STRATEGY_CONFIG)
    expect(u.recommendation).toBe('overcut')
  })

  it('recommends defending when a close rival is behind', () => {
    const s = snap({ relatives: { behind: { carIdx: 9, name: 'Rival B', carNumber: '9', gapSec: 0.6 } } })
    const u = computeUndercut(s, rates, DEFAULT_STRATEGY_CONFIG)
    expect(u.gapSec).toBeLessThan(0)
    expect(u.recommendation).toBe('defend')
  })

  it('honours an explicit rivalCarIdx from the drivers list', () => {
    const s = snap({
      drivers: [
        { carIdx: 2, name: 'P1', carNumber: '2', position: 1, classPosition: 1, classId: 0, isPlayer: false, gapToPlayerSec: 5 },
        { carIdx: 3, name: 'P-self', carNumber: '3', position: 2, classPosition: 2, classId: 0, isPlayer: true }
      ]
    })
    const u = computeUndercut(s, rates, { ...DEFAULT_STRATEGY_CONFIG, rivalCarIdx: 2 })
    expect(u.rivalCarIdx).toBe(2)
    expect(u.rivalName).toBe('P1')
    expect(u.gapSec).toBe(5)
  })

  it('is unavailable without any rival gap', () => {
    const u = computeUndercut(snap(), rates, DEFAULT_STRATEGY_CONFIG)
    expect(u.available).toBe(false)
    expect(u.recommendation).toBe('none')
  })
})

describe('estimateFreshTyreGainSec', () => {
  it('scales with lost life and is clamped to the fall-off ceiling', () => {
    expect(estimateFreshTyreGainSec({ tyreLifePct: 1 })).toBeCloseTo(0.2, 5) // clamp floor
    expect(estimateFreshTyreGainSec({ tyreLifePct: 0.5 })).toBeCloseTo(1, 5)
    expect(estimateFreshTyreGainSec({ tyreLifePct: 0 })).toBeCloseTo(2, 5) // ceiling
  })

  it('uses the default gain without tyre data', () => {
    expect(estimateFreshTyreGainSec({})).toBe(1)
  })
})

describe('computeStrategyPlan', () => {
  it('says box-now when fuel is critical', () => {
    const plan = computeStrategyPlan(
      snap({ fuelLiters: 1.5, currentLap: 18, lapsRemaining: 5 }),
      { fuelPerLap: 2, lapTimeSec: 90 }
    )
    expect(plan.action).toBe('box-now')
    expect(plan.headline).toMatch(/fuel critical/i)
  })

  it('says extend when fuel comfortably covers the finish and tyres unknown', () => {
    const plan = computeStrategyPlan(
      snap({ fuelLiters: 50, currentLap: 2, lapsRemaining: 8 }),
      { fuelPerLap: 2, lapTimeSec: 90 }
    )
    expect(plan.fuel.canFinish).toBe(true)
    expect(plan.action).toBe('extend')
  })

  it('recommends a short-fill for a splash-and-dash finish', () => {
    // need ~3 laps more fuel, tank big → short-fill, not a full tank
    const plan = computeStrategyPlan(
      snap({ fuelLiters: 2, currentLap: 27, lapsRemaining: 3, fuelCapacityLiters: 60 }),
      { fuelPerLap: 2, lapTimeSec: 90 }
    )
    expect(plan.fuel.canFinish).toBe(false)
    expect(plan.action).toBe('short-fill')
    expect(plan.headline).toMatch(/short-fill/i)
  })

  it('is unavailable and noted without telemetry', () => {
    const plan = computeStrategyPlan(snap({ connected: false }), {})
    expect(plan.available).toBe(false)
    expect(plan.connected).toBe(false)
    expect(plan.notes.join(' ')).toMatch(/no telemetry/i)
  })

  it('clamps invalid config into safe ranges', () => {
    const plan = computeStrategyPlan(snap({ fuelLiters: 10 }), { fuelPerLap: 1 }, {
      pitLossSec: -5,
      fuelMarginLaps: -1,
      tyreLifeThresholdPct: 5,
      pitWindowSpanLaps: 0
    })
    expect(plan.config.pitLossSec).toBe(0)
    expect(plan.config.fuelMarginLaps).toBe(0)
    expect(plan.config.tyreLifeThresholdPct).toBeLessThanOrEqual(0.9)
    expect(plan.config.pitWindowSpanLaps).toBeGreaterThanOrEqual(1)
  })
})

describe('mergeStrategyConfig', () => {
  it('defaults useLocalAi to false', () => {
    expect(DEFAULT_STRATEGY_CONFIG.useLocalAi).toBe(false)
    expect(mergeStrategyConfig(DEFAULT_STRATEGY_CONFIG).useLocalAi).toBe(false)
    expect(mergeStrategyConfig(DEFAULT_STRATEGY_CONFIG, undefined).useLocalAi).toBe(false)
    expect(mergeStrategyConfig(DEFAULT_STRATEGY_CONFIG, null).useLocalAi).toBe(false)
  })

  it('persists an explicit useLocalAi toggle', () => {
    expect(mergeStrategyConfig(DEFAULT_STRATEGY_CONFIG, { useLocalAi: true }).useLocalAi).toBe(true)
    const on: StrategyConfig = { ...DEFAULT_STRATEGY_CONFIG, useLocalAi: true }
    expect(mergeStrategyConfig(on, { useLocalAi: false }).useLocalAi).toBe(false)
  })

  it('keeps the base useLocalAi when a narrow patch omits it', () => {
    // The StrategyView sends a numbers-only settings patch on narrate/getPlan;
    // it must not wipe the persisted "usar IA local" preference.
    const on: StrategyConfig = { ...DEFAULT_STRATEGY_CONFIG, useLocalAi: true }
    const merged = mergeStrategyConfig(on, { pitLossSec: 30 })
    expect(merged.useLocalAi).toBe(true)
    expect(merged.pitLossSec).toBe(30)
  })

  it('coerces a non-boolean useLocalAi back to the base value', () => {
    expect(mergeStrategyConfig(DEFAULT_STRATEGY_CONFIG, { useLocalAi: 'sim' as unknown as boolean }).useLocalAi).toBe(false)
  })

  it('clamps invalid numeric fields into safe ranges', () => {
    const merged = mergeStrategyConfig(DEFAULT_STRATEGY_CONFIG, {
      pitLossSec: -5,
      fuelMarginLaps: -1,
      tyreLifeThresholdPct: 5,
      pitWindowSpanLaps: 0
    })
    expect(merged.pitLossSec).toBe(0)
    expect(merged.fuelMarginLaps).toBe(0)
    expect(merged.tyreLifeThresholdPct).toBeLessThanOrEqual(0.9)
    expect(merged.tyreLifeThresholdPct).toBeGreaterThanOrEqual(0.05)
    expect(merged.pitWindowSpanLaps).toBeGreaterThanOrEqual(1)
  })

  it('drops non-positive optional overrides', () => {
    const merged = mergeStrategyConfig(DEFAULT_STRATEGY_CONFIG, { targetLaps: 0, raceTimeMinutes: -3 })
    expect(merged.targetLaps).toBeUndefined()
    expect(merged.raceTimeMinutes).toBeUndefined()
  })

  it('exposes config IPC channel names', () => {
    expect(STRATEGY_CHANNELS.getConfig).toBe('strategy:getConfig')
    expect(STRATEGY_CHANNELS.setConfig).toBe('strategy:setConfig')
    expect(STRATEGY_CHANNELS.configEvent).toBe('strategy:config')
  })
})

describe('narrateStrategyPlan', () => {
  it('produces PT-BR radio text by default', () => {
    const plan = computeStrategyPlan(
      snap({ fuelLiters: 1.5, currentLap: 18, lapsRemaining: 5 }),
      { fuelPerLap: 2, lapTimeSec: 90 }
    )
    const text = narrateStrategyPlan(plan)
    expect(text).toMatch(/box/i)
    expect(text.length).toBeGreaterThan(0)
  })

  it('produces English text on request', () => {
    const plan = computeStrategyPlan(
      snap({ fuelLiters: 50, currentLap: 2, lapsRemaining: 8 }),
      { fuelPerLap: 2, lapTimeSec: 90 }
    )
    const text = narrateStrategyPlan(plan, 'en')
    expect(text).toMatch(/stay out|fuel/i)
  })

  it('handles the disconnected case', () => {
    const plan = computeStrategyPlan(snap({ connected: false }), {})
    expect(narrateStrategyPlan(plan, 'en')).toMatch(/no telemetry/i)
  })
})
