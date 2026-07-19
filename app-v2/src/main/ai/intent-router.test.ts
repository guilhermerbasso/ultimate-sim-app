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

describe('routeIntent -- PT-BR questions', () => {
  it('answers fuel level (how much fuel?)', () => {
    const r = routeIntent('How much fuel?', ctx())
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.category).toBe('fuel')
    expect(r.lang).toBe('en')
    expect(r.text).toContain('Fuel')
  })

  it('answers "can finish?" with the finish verdict first', () => {
    const r = routeIntent('Can we finish?', ctx())
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.category).toBe('fuel')
    expect(r.text).toContain('make the finish')
  })

  it('answers a pit question (boxes agora?)', () => {
    const r = routeIntent('pit now?', ctx())
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.category).toBe('pit')
    expect(r.lang).toBe('en')
  })

  it('answers gap ahead (gap pra frente)', () => {
    const r = routeIntent('Gap pra frente', ctx())
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.category).toBe('gap')
    expect(r.text).toContain('À frente')
    expect(r.text).toContain('1.2')
  })

  it('answers gap behind (gap behind)', () => {
    const r = routeIntent('Gap behind', ctx())
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.category).toBe('gap')
    expect(r.text).toContain('Behind')
    expect(r.text).toContain('0.8')
  })

  it('answers laps remaining deterministically -- no LLM (quantas laps fhighm?)', () => {
    const r = routeIntent('Quantas laps fhighm?', ctx())
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.category).toBe('laps')
    expect(r.text).toContain('13')
  })

  it('laps: treats the iRacing 32767 sentinel (timed/unlimited) as no real lap count', () => {
    const r = routeIntent('Quantas laps fhighm?', ctx(snapshot({ lapsRemaining: 32767 })))
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.category).toBe('laps')
    expect(r.text).not.toContain('32767')
    expect(r.text.toLowerCase()).toContain('sessão por tempo')
  })

  it('answers position (qual minha position?)', () => {
    const r = routeIntent('What is my position?', ctx())
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.category).toBe('position')
    expect(r.text).toContain('P4')
  })

  it('answers delta (how is my pace?)', () => {
    const r = routeIntent('How is my pace?', ctx())
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.category).toBe('delta')
    expect(r.text).toContain('best')
  })

  it('answers tyres (how are the tires?)', () => {
    const r = routeIntent('How are the tires?', ctx())
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.category).toBe('tyres')
    expect(r.text).toContain('RF')
  })

  it('includes available tyre pressures with temperatures and wear', () => {
    const r = routeIntent(
      'How are the tires?',
      ctx(snapshot({
        tyres: {
          lf: { pressureKpa: 180, tempC: 88, wearPct: 0.92 },
          rf: { pressureKpa: 181.2, tempC: 95, wearPct: 0.85 },
          lr: { pressureKpa: 178.4, tempC: 86, wearPct: 0.9 },
          rr: { pressureKpa: 179.6, tempC: 90, wearPct: 0.89 }
        }
      }))
    )
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    for (const id of ['LF', 'RF', 'LR', 'RR']) expect(r.text).toContain(id)
    expect(r.text).toContain('180 kPa')
    expect(r.text).toContain('88 °C')
    expect(r.text).toContain('92%')
  })

  it('formats partial tyre pressure data in imperial units without inventing missing corners', () => {
    const r = routeIntent(
      'How are the tires?',
      ctx(snapshot({
        tyres: {
          lf: { pressureKpa: 180 },
          rf: { tempC: 91 },
          lr: { pressureKpa: Number.NaN },
          rr: {}
        }
      })),
      'en',
      'imperial'
    )
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.text).toContain('LF')
    expect(r.text).toContain('psi')
    expect(r.text).toContain('RF')
    expect(r.text).toContain('°F')
    expect(r.text).not.toContain('NaN')
  })

  it('answers weather (is it raining?)', () => {
    const r = routeIntent('Is it raining?', ctx())
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.category).toBe('weather')
    expect(r.text).toContain('Track')
  })

  it('reports unknown surface instead of dry when rain is false but wetness is absent', () => {
    const r = routeIntent(
      'Is it raining?',
      ctx(snapshot({ isRaining: false, trackWetnessPct: undefined }))
    )
    expect(r.type).toBe('answer')
    if (r.type !== 'answer') return
    expect(r.text).toContain('Track surface is unknown')
    expect(r.text).not.toContain('Track is dry')
  })

  it('phrases engineer telemetry in imperial units', () => {
    const fuel = routeIntent('How much fuel?', ctx(), 'en', 'imperial')
    const weather = routeIntent('Is it raining?', ctx(), 'en', 'imperial')

    expect(fuel.type).toBe('answer')
    expect(weather.type).toBe('answer')
    if (fuel.type !== 'answer' || weather.type !== 'answer') return
    expect(fuel.text).toContain('gal')
    expect(fuel.text).not.toContain('L/lap')
    expect(weather.text).toContain('°F')
    expect(weather.text).not.toContain('°C')
  })
})

describe('routeIntent -- English questions', () => {
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

describe('routeIntent -- forced PT-BR output', () => {
  const answerText = (question: string): string => {
    const result = routeIntent(question, ctx(), 'pt')
    expect(result.type).toBe('answer')
    if (result.type !== 'answer') return ''
    expect(result.lang).toBe('pt')
    return result.text
  }

  it('answers saved English preset questions in the configured Portuguese language', () => {
    const fuel = answerText('How much fuel?')
    expect(fuel).toContain('Combustível')
    expect(fuel).toContain('litros por volta')
    expect(fuel).not.toContain('/lap')
    expect(answerText('Can we finish?')).toContain('Dá para chegar ao fim')
    expect(answerText('Should I pit?')).toMatch(/boxes|parar/)
    expect(answerText('Gap ahead')).toContain('À frente')
    expect(answerText('How many laps?')).toContain('voltas restantes')
    expect(answerText('What is my position?')).toContain('P4')
    expect(answerText('How is my pace?')).toContain('melhor volta')
    expect(answerText('How are the tyres?')).toContain('Pneus')
    expect(answerText('Is it raining?')).toContain('Pista seca')
  })

  it('speaks imperial fuel consumption as galões por volta in Portuguese', () => {
    const result = routeIntent('How much fuel?', ctx(), 'pt', 'imperial')
    expect(result.type).toBe('answer')
    if (result.type !== 'answer') return
    expect(result.text).toContain('galões por volta')
    expect(result.text).not.toContain('gal/lap')
  })

  it('never emits common English radio copy in forced Portuguese answers', () => {
    const combined = [
      answerText('How much fuel?'),
      answerText('Can we finish?'),
      answerText('Should I pit?'),
      answerText('Gap ahead'),
      answerText('How many laps?'),
      answerText('How is my pace?'),
      answerText('How are the tyres?'),
      answerText('Is it raining?')
    ].join(' ')

    expect(combined).not.toMatch(/\b(fuel|finish|ahead|behind|laps|remaining|tyres|track|rain|best|pace|need)\b/i)
  })
})

describe('routeIntent -- voice commands', () => {
  const cases: Array<[string, string, string | undefined]> = [
    ['next dashboard', 'dashboard.next', 'dash:cycleNext'],
    ['dashboard anterior', 'dashboard.prev', 'dash:cyclePrev'],
    ['salvar setup', 'setup.save', 'setups:save'],
    ['mark lap', 'lap.mark', 'lap:mark'],
    ['resetar fuel', 'fuel.reset', 'fuel:reset'],
    ['ativa rev-lights', 'revlights.enable', 'revlights:setEnabled'],
    ['desativa rev-lights', 'revlights.disable', 'revlights:setEnabled']
  ]

  for (const [phrase, kind, actionHint] of cases) {
    it(`maps "${phrase}" -> ${kind}`, () => {
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

  it('keeps executable command confirmations in PT-BR when Portuguese is configured', () => {
    const lap = routeIntent('mark lap', ctx(), 'pt')
    const fuel = routeIntent('resetar gasolina', ctx(), 'pt')
    expect(lap.type).toBe('command')
    expect(fuel.type).toBe('command')
    if (lap.type === 'command') expect(lap.speak).toBe('Volta marcada.')
    if (fuel.type === 'command') expect(fuel.speak).toBe('Cálculo de combustível reiniciado.')
  })
})

describe('routeIntent -- passthrough', () => {
  it('returns passthrough for an unknown question', () => {
    expect(routeIntent('What color is the sky?', ctx()).type).toBe('passthrough')
  })

  it('returns passthrough for empty input', () => {
    expect(routeIntent('   ', ctx()).type).toBe('passthrough')
  })

  it('still answers (gracefully) when telemetry is offline', () => {
    const r = routeIntent('how much fuel?', ctx(snapshot({ connected: false })))
    expect(r.type).toBe('answer')
  })
})
