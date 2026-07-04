import { describe, expect, it } from 'vitest'
import type { EngineerContext } from '../../shared/ai-engineer'
import type { CoachTip } from '../../shared/coach'
import type { FuelStrategyState } from '../../shared/fuel'
import type { LapTimingState } from '../../shared/laptiming'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { TireStrategyState } from '../../shared/tire-strategy'
import { routeIntent } from './intent-router'

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

function ctx(snap: TelemetrySnapshot | null = snapshot()): EngineerContext {
  return {
    getSnapshot: () => snap,
    getFuelState: () => fuelState,
    getTireState: () => tireState,
    getLapTiming: () => lapState,
    getCoachTips: () => coachTips
  }
}

describe('routeIntent — PT-BR questions', () => {
  it('answers fuel level (quanto de combustível?)', () => {
    const r = routeIntent('Quanto de combustível?', ctx())
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.category).toBe('fuel')
    expect(r.lang).toBe('pt')
    expect(r.text).toContain('Combustível')
  })

  it('answers "dá pra terminar?" with the finish verdict first', () => {
    const r = routeIntent('Dá pra terminar?', ctx())
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.category).toBe('fuel')
    expect(r.text).toContain('Dá pra terminar')
  })

  it('answers a pit question (boxes agora?)', () => {
    const r = routeIntent('Boxes agora?', ctx())
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.category).toBe('pit')
    expect(r.lang).toBe('pt')
  })

  it('answers gap ahead (gap pra frente)', () => {
    const r = routeIntent('Gap pra frente', ctx())
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.category).toBe('gap')
    expect(r.text).toContain('frente')
    expect(r.text).toContain('1.2')
  })

  it('answers gap behind (gap pra trás)', () => {
    const r = routeIntent('Gap pra trás', ctx())
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.category).toBe('gap')
    expect(r.text).toContain('Atrás')
    expect(r.text).toContain('0.8')
  })

  it('answers laps remaining deterministically — no LLM (quantas voltas faltam?)', () => {
    const r = routeIntent('Quantas voltas faltam?', ctx())
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.category).toBe('laps')
    expect(r.text).toContain('13')
  })

  it('laps: treats the iRacing 32767 sentinel (timed/unlimited) as no real lap count', () => {
    const r = routeIntent('Quantas voltas faltam?', ctx(snapshot({ lapsRemaining: 32767 })))
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.category).toBe('laps')
    expect(r.text).not.toContain('32767')
    expect(r.text.toLowerCase()).toContain('tempo')
  })

  it('answers position (qual minha posição?)', () => {
    const r = routeIntent('Qual minha posição?', ctx())
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.category).toBe('position')
    expect(r.text).toContain('P4')
  })

  it('answers delta (como tá meu tempo?)', () => {
    const r = routeIntent('Como tá meu tempo?', ctx())
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.category).toBe('delta')
    expect(r.text).toContain('melhor')
  })

  it('answers tyres (como estão os pneus?)', () => {
    const r = routeIntent('Como estão os pneus?', ctx())
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.category).toBe('tyres')
    expect(r.text).toContain('RF')
  })

  it('answers weather (tá chovendo?)', () => {
    const r = routeIntent('Tá chovendo?', ctx())
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.category).toBe('weather')
    expect(r.text).toContain('Pista')
  })
})

describe('routeIntent — English questions', () => {
  it('answers fuel?', () => {
    const r = routeIntent('fuel?', ctx())
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.category).toBe('fuel')
    expect(r.lang).toBe('en')
    expect(r.text).toContain('Fuel')
  })

  it('answers "should I pit?"', () => {
    const r = routeIntent('Should I pit?', ctx())
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.category).toBe('pit')
    expect(r.lang).toBe('en')
  })
})

describe('routeIntent — voice commands', () => {
  const cases: Array<[string, string, string | undefined]> = [
    ['próximo dashboard', 'dashboard.next', 'dash:cycleNext'],
    ['dashboard anterior', 'dashboard.prev', 'dash:cyclePrev'],
    ['salvar setup', 'setup.save', 'setups:save'],
    ['marcar volta', 'lap.mark', 'lap:mark'],
    ['resetar combustível', 'fuel.reset', 'fuel:reset'],
    ['ativa rev-lights', 'revlights.enable', 'revlights:setEnabled'],
    ['desativa rev-lights', 'revlights.disable', 'revlights:setEnabled']
  ]

  for (const [phrase, kind, actionHint] of cases) {
    it(`maps "${phrase}" → ${kind}`, () => {
      const r = routeIntent(phrase, ctx())
      expect(r.type).toBe('command')
      if (r.type !== 'command') return
      expect(r.kind).toBe(kind)
      expect(r.speak.length).toBeGreaterThan(0)
      if (actionHint) expect(r.actionHint).toBe(actionHint)
    })
  }

  it('passes the enabled flag for rev-lights enable/disable', () => {
    const on = routeIntent('liga as rev-lights', ctx())
    const off = routeIntent('desliga as rev-lights', ctx())
    if (on.type === 'command') expect(on.args).toEqual({ enabled: true })
    if (off.type === 'command') expect(off.args).toEqual({ enabled: false })
  })
})

describe('routeIntent — passthrough', () => {
  it('returns passthrough for an unknown question', () => {
    expect(routeIntent('Qual a cor do céu?', ctx()).type).toBe('passthrough')
  })

  it('returns passthrough for empty input', () => {
    expect(routeIntent('   ', ctx()).type).toBe('passthrough')
  })

  it('still answers (gracefully) when telemetry is offline', () => {
    const r = routeIntent('quanto de combustível?', ctx(snapshot({ connected: false })))
    expect(r.type).toBe('answer')
  })
})
