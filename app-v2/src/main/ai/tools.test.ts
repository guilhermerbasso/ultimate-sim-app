import { describe, expect, it } from 'vitest'
import type { EngineerContext } from '../../shared/ai-engineer'
import type { CoachTip } from '../../shared/coach'
import type { CoachFinding } from '../../shared/coach'
import type { FuelStrategyState } from '../../shared/fuel'
import type { LapTimingState } from '../../shared/laptiming'
import type { PackEvent } from '../../shared/ai-engineer'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { TireStrategyState } from '../../shared/tire-strategy'
import { TOOL_NAMES, buildEngineerTools, engineerContextFromSnapshot } from './tools'
import type {
  CarTrackToolResult,
  CoachFindingsToolResult,
  CoachTipsToolResult,
  DeltaToolResult,
  FuelToolResult,
  GapsToolResult,
  PositionToolResult,
  RecentEventsToolResult,
  StrategyToolResult,
  TyresToolResult,
  WeatherToolResult
} from '../../shared/ai-engineer'

function snapshot(overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1_000_000,
    speedKmh: 210,
    rpm: 9000,
    gear: 4,
    throttle: 1,
    brake: 0,
    clutch: 0,
    sessionType: 'Race',
    carName: 'Ferrari 296 GT3',
    trackName: 'Spa',
    currentLap: 12,
    lapsRemaining: 13,
    position: 4,
    classPosition: 2,
    totalCars: 20,
    lastLapTimeSec: 138.4,
    bestLapTimeSec: 137.9,
    estimatedLapTimeSec: 138.6,
    deltaToBestSec: 0.5,
    fuelLiters: 34.2,
    fuelPerLap: 2.1,
    tyres: {
      lf: { tempC: 88, wearPct: 0.92 },
      rf: { tempC: 95, wearPct: 0.85 },
      lr: { tempC: 86, wearPct: 0.9 },
      rr: { tempC: 90, wearPct: 0.89 }
    },
    airTempC: 24,
    trackTempC: 31,
    trackWetnessPct: 0.05,
    isRaining: false,
    weatherDeclaredWet: false,
    trackSurfaceMaterial: 1,
    onPitRoad: false,
    pit: { repairNeeded: false, optRepairNeeded: false, pitsOpen: true, inPitStall: false },
    relatives: {
      ahead: { carIdx: 1, name: 'Senna', carNumber: '12', gapSec: 1.2 },
      behind: { carIdx: 2, name: 'Hakkinen', carNumber: '3', gapSec: -0.8 }
    },
    ...overrides
  }
}

const fuelState: FuelStrategyState = {
  connected: true,
  currentLap: 12,
  fuelLiters: 34.2,
  usedPerLap: 2.1,
  samples: [],
  lapsLeftWithFuel: 14.3,
  raceLapsRemaining: 13,
  fuelToFinish: 30.3,
  fuelDeltaToFinish: 3.9,
  saveNeededPerLap: 0.08,
  pitWindow: { canFinish: true, status: 'save', latestLap: 26 },
  stint: {},
  settings: { fuelMarginLiters: 3 }
}

const tireState: TireStrategyState = {
  connected: true,
  currentLap: 12,
  corners: {
    lf: { wearPct: 92 },
    rf: { wearPct: 85, lapsToThreshold: 9 },
    lr: { wearPct: 90 },
    rr: { wearPct: 89 }
  },
  worstCorner: 'rf',
  recommendedPitLap: 23,
  lapsRemainingOnTyres: 9,
  estimated: false,
  notes: [],
  settings: { wearThresholdPct: 0.3 }
}

const lapState: LapTimingState = {
  connected: true,
  currentLap: 12,
  bestLap: 137.9,
  lastLap: 138.4,
  predicted: 138.6,
  deltaBest: 0.5,
  sectors: []
}

const coachTips: CoachTip[] = [
  { id: 'live:braking:s1', kind: 'braking', sector: 1, severity: 'high', message: 'Brake later T1', createdAt: 1 }
]

const events: PackEvent[] = [
  { at: 1, kind: 'flag', text: 'Yellow in S2' },
  { at: 2, kind: 'pit', text: 'Pit window open' }
]

function makeFinding(sector: number, estTimeLossSec: number, kind: CoachFinding['kind'] = 'brake-late'): CoachFinding {
  return {
    id: `${kind}-s${sector}-${estTimeLossSec}`,
    kind,
    sector,
    zonePctStart: 0,
    zonePctEnd: 0.1,
    severity: 'med',
    estTimeLossSec,
    title: `S${sector} issue`,
    detail: 'detail',
    evidence: 'evidence',
    metrics: {}
  }
}

// Worst-first, includes a `good` finding that must always be dropped.
const coachFindings: CoachFinding[] = [
  makeFinding(2, 0.5),
  makeFinding(1, 0.4),
  makeFinding(3, 0.3),
  makeFinding(4, 0.2),
  makeFinding(5, 0.1),
  makeFinding(6, 0, 'good')
]

function fullCtx(snap: TelemetrySnapshot | null = snapshot()): EngineerContext {
  return {
    getSnapshot: () => snap,
    getFuelState: () => fuelState,
    getTireState: () => tireState,
    getLapTiming: () => lapState,
    getCoachTips: () => coachTips,
    getCoachFindings: () => coachFindings,
    getRecentEvents: () => events
  }
}

describe('buildEngineerTools', () => {
  it('exposes every declared tool with a description + object params schema', () => {
    const tools = buildEngineerTools(fullCtx())
    for (const name of TOOL_NAMES) {
      expect(tools[name]).toBeDefined()
      expect(tools[name].name).toBe(name)
      expect(tools[name].description.length).toBeGreaterThan(0)
      expect(tools[name].parameters.type).toBe('object')
    }
  })

  it('getFuelState returns structured fuel facts', async () => {
    const r = (await buildEngineerTools(fullCtx()).getFuelState.run({})) as FuelToolResult
    expect(r.available).toBe(true)
    expect(r.fuelLiters).toBe(34.2)
    expect(r.fuelPerLap).toBe(2.1)
    expect(r.lapsLeft).toBe(14.3)
    expect(r.canFinish).toBe(true)
    expect(r.status).toBe('save')
    expect(r.summary).toContain('34.2L')
  })

  it('getDelta returns delta + trend', async () => {
    const r = (await buildEngineerTools(fullCtx()).getDelta.run({})) as DeltaToolResult
    expect(r.available).toBe(true)
    expect(r.deltaToBestSec).toBe(0.5)
    expect(r.bestLapSec).toBe(137.9)
    expect(r.trend).toBe('losing')
  })

  it('getStrategy returns a deterministic pit recommendation', async () => {
    const r = (await buildEngineerTools(fullCtx()).getStrategy.run({})) as StrategyToolResult
    expect(typeof r.recommendPit).toBe('boolean')
    expect(r.recommendPit).toBe(false)
    expect(r.fuelStatus).toBe('save')
    expect(r.tyreLapsLeft).toBe(9)
    expect(r.reason.length).toBeGreaterThan(0)
  })

  it('getPosition returns overall + class position', async () => {
    const r = (await buildEngineerTools(fullCtx()).getPosition.run({})) as PositionToolResult
    expect(r).toMatchObject({ available: true, position: 4, classPosition: 2, totalCars: 20 })
  })

  it('getGaps returns ahead + behind with names and respects the side arg', async () => {
    const tools = buildEngineerTools(fullCtx())
    const both = (await tools.getGaps.run({})) as GapsToolResult
    expect(both).toMatchObject({ available: true, aheadSec: 1.2, behindSec: 0.8, aheadName: 'Senna', behindName: 'Hakkinen' })
    const aheadOnly = (await tools.getGaps.run({ side: 'ahead' })) as GapsToolResult
    expect(aheadOnly.summary).toContain('ahead 1.2s')
    expect(aheadOnly.summary).not.toContain('behind')
  })

  it('getTyres returns per-corner temps/wear + worst corner', async () => {
    const r = (await buildEngineerTools(fullCtx()).getTyres.run({})) as TyresToolResult
    expect(r.available).toBe(true)
    expect(r.corners).toHaveLength(4)
    expect(r.worstCorner).toBe('RF')
    expect(r.lapsLeft).toBe(9)
    expect(r.estimated).toBe(false)
    const rf = r.corners.find((c) => c.id === 'RF')
    expect(rf).toMatchObject({ tempC: 95, wearPct: 85, lapsToThreshold: 9 })
  })

  it('getWeather returns air/track temps + dry verdict', async () => {
    const r = (await buildEngineerTools(fullCtx()).getWeather.run({})) as WeatherToolResult
    expect(r).toMatchObject({ available: true, airTempC: 24, trackTempC: 31, declaredWet: false })
    expect(r.summary).toContain('dry')
  })

  it('getCarTrack returns car/track/sim/session', async () => {
    const r = (await buildEngineerTools(fullCtx()).getCarTrack.run({})) as CarTrackToolResult
    expect(r).toMatchObject({ available: true, car: 'Ferrari 296 GT3', track: 'Spa', sim: 'iracing', sessionType: 'Race' })
  })

  it('getRecentEvents returns the recent event log', async () => {
    const r = (await buildEngineerTools(fullCtx()).getRecentEvents.run({})) as RecentEventsToolResult
    expect(r.events).toHaveLength(2)
    expect(r.summary).toContain('Pit window open')
  })

  it('getCoachTips returns current coach tips', async () => {
    const r = (await buildEngineerTools(fullCtx()).getCoachTips.run({})) as CoachTipsToolResult
    expect(r.tips).toHaveLength(1)
    expect(r.tips[0]).toMatchObject({ severity: 'high', message: 'Brake later T1', sector: 1 })
  })

  it('getCoachFindings returns the top-3 actionable findings by default (drops `good`)', async () => {
    const r = (await buildEngineerTools(fullCtx()).getCoachFindings.run({})) as CoachFindingsToolResult
    expect(r.available).toBe(true)
    expect(r.findings).toHaveLength(3)
    expect(r.findings.map((f) => f.sector)).toEqual([2, 1, 3])
    expect(r.findings.some((f) => f.kind === 'good')).toBe(false)
  })

  it('getCoachFindings honours `limit`, clamped to 1..10', async () => {
    const tools = buildEngineerTools(fullCtx())
    const one = (await tools.getCoachFindings.run({ limit: 1 })) as CoachFindingsToolResult
    expect(one.findings).toHaveLength(1)
    expect(one.findings[0].sector).toBe(2)
    // 5 actionable findings available; a huge limit is clamped to ≤10 → returns all 5.
    const many = (await tools.getCoachFindings.run({ limit: 999 })) as CoachFindingsToolResult
    expect(many.findings).toHaveLength(5)
    // Zero / negative falls back to the default of 3.
    const zero = (await tools.getCoachFindings.run({ limit: 0 })) as CoachFindingsToolResult
    expect(zero.findings).toHaveLength(3)
  })

  it('getCoachFindings reports unavailable when there is no coaching yet', async () => {
    const tools = buildEngineerTools({ getSnapshot: () => snapshot() })
    const r = (await tools.getCoachFindings.run({})) as CoachFindingsToolResult
    expect(r.available).toBe(false)
    expect(r.findings).toHaveLength(0)
  })

  it('degrades gracefully with only a bare snapshot context (no engine getters)', async () => {
    const tools = buildEngineerTools(engineerContextFromSnapshot(snapshot()))
    const fuel = (await tools.getFuelState.run({})) as FuelToolResult
    expect(fuel.available).toBe(true)
    expect(fuel.fuelLiters).toBe(34.2)
    const coach = (await tools.getCoachTips.run({})) as CoachTipsToolResult
    expect(coach.tips).toHaveLength(0)
  })

  it('reports unavailable when telemetry is offline', async () => {
    const tools = buildEngineerTools(engineerContextFromSnapshot(null))
    const fuel = (await tools.getFuelState.run({})) as FuelToolResult
    expect(fuel.available).toBe(false)
    const pos = (await tools.getPosition.run({})) as PositionToolResult
    expect(pos.available).toBe(false)
  })
})
