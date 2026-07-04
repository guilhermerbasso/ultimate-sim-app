import { describe, expect, it } from 'vitest'
import {
  adviseFromBrakeBias,
  adviseFromHandling,
  adviseFromTyres,
  buildSetupReport,
  type SetupBalanceSignal,
  type SetupSuggestion
} from './setup-advisor'

function symptoms(s: SetupSuggestion[]): string[] {
  return s.map((x) => x.symptom)
}

describe('adviseFromHandling — balance → setup', () => {
  it('recommends a rear-grip change for power oversteer on exit', () => {
    const balance: SetupBalanceSignal[] = [{ phase: 'exit', bias: 0.7 }]
    const out = adviseFromHandling(balance)
    expect(symptoms(out)).toContain('oversteer-exit')
    const s = out[0]
    expect(s.confidence).toBe('high')
    // Primary change should be about rear grip (rear wing / soften rear / diff).
    expect(s.primary.area === 'aero' || s.primary.area === 'arb' || s.primary.area === 'differential').toBe(true)
    expect(s.rationale.length).toBeGreaterThan(10)
  })

  it('recommends front-grip / softer front for entry understeer', () => {
    const out = adviseFromHandling([{ phase: 'entry', bias: -0.4 }])
    expect(symptoms(out)).toContain('understeer-entry')
    expect(out[0].primary.direction).toBe('soften')
    expect(out[0].confidence).toBe('med')
  })

  it('covers all six phase×balance combinations', () => {
    const phases = ['entry', 'mid', 'exit'] as const
    for (const phase of phases) {
      expect(symptoms(adviseFromHandling([{ phase, bias: 0.5 }]))).toContain(`oversteer-${phase}`)
      expect(symptoms(adviseFromHandling([{ phase, bias: -0.5 }]))).toContain(`understeer-${phase}`)
    }
  })

  it('ignores weak balance signals below the threshold', () => {
    expect(adviseFromHandling([{ phase: 'mid', bias: 0.1 }])).toHaveLength(0)
    expect(adviseFromHandling([{ phase: 'mid', bias: Number.NaN }])).toHaveLength(0)
  })
})

describe('adviseFromTyres — pressure from the tread profile', () => {
  it('flags over-inflation when the centre is hotter than the edges', () => {
    const out = adviseFromTyres({ lf: { innerC: 80, middleC: 100, outerC: 80 } })
    const p = out.find((s) => s.symptom === 'pressure-high')
    expect(p).toBeDefined()
    expect(p?.primary.direction).toBe('decrease')
    expect(p?.corner).toBe('lf')
  })

  it('flags under-inflation when the edges are hotter than the centre', () => {
    const out = adviseFromTyres({ rf: { innerC: 100, middleC: 80, outerC: 100 } })
    const p = out.find((s) => s.symptom === 'pressure-low')
    expect(p).toBeDefined()
    expect(p?.primary.direction).toBe('increase')
  })

  it('does not flag pressure when the tread profile is flat', () => {
    const out = adviseFromTyres({ lr: { innerC: 90, middleC: 92, outerC: 89 } })
    expect(symptoms(out)).not.toContain('pressure-high')
    expect(symptoms(out)).not.toContain('pressure-low')
  })
})

describe('adviseFromTyres — camber from inner vs outer', () => {
  it('flags too much negative camber when the inner edge runs hot', () => {
    const out = adviseFromTyres({ lf: { innerC: 105, middleC: 92, outerC: 85 } })
    const c = out.find((s) => s.symptom === 'camber-excess')
    expect(c).toBeDefined()
    expect(c?.primary.area).toBe('alignment')
    expect(c?.primary.direction).toBe('decrease')
  })

  it('flags a lack of camber when the outer edge runs hot', () => {
    const out = adviseFromTyres({ rf: { innerC: 85, middleC: 92, outerC: 105 } })
    const c = out.find((s) => s.symptom === 'camber-lack')
    expect(c).toBeDefined()
    expect(c?.primary.direction).toBe('increase')
  })
})

describe('adviseFromTyres — temperature window + L/R imbalance', () => {
  it('flags an overheating tyre above the window', () => {
    const out = adviseFromTyres({ rr: { innerC: 118, middleC: 120, outerC: 119 } })
    expect(symptoms(out)).toContain('tyre-overheat')
  })

  it('flags a cold tyre below the window', () => {
    const out = adviseFromTyres({ lr: { innerC: 58, middleC: 60, outerC: 59 } })
    expect(symptoms(out)).toContain('tyre-cold')
  })

  it('flags a left/right axle temperature imbalance', () => {
    const out = adviseFromTyres({
      lf: { innerC: 110, middleC: 110, outerC: 110 },
      rf: { innerC: 85, middleC: 85, outerC: 85 }
    })
    const imb = out.find((s) => s.symptom === 'tyre-temp-imbalance-lr')
    expect(imb).toBeDefined()
    expect(imb?.corner).toBe('front')
  })

  it('returns nothing when no tyre data is provided', () => {
    expect(adviseFromTyres(undefined)).toHaveLength(0)
    expect(adviseFromTyres({})).toHaveLength(0)
  })
})

describe('adviseFromBrakeBias', () => {
  it('moves bias rearward for front lock-up', () => {
    const out = adviseFromBrakeBias({ frontLock: true, brakeBiasPct: 58 })
    const s = out.find((x) => x.symptom === 'brake-lock-front')
    expect(s?.primary.direction).toBe('rearward')
  })
  it('moves bias forward for rear lock-up', () => {
    const out = adviseFromBrakeBias({ rearLock: true })
    const s = out.find((x) => x.symptom === 'brake-lock-rear')
    expect(s?.primary.direction).toBe('forward')
  })
  it('says nothing without a lock symptom', () => {
    expect(adviseFromBrakeBias({})).toHaveLength(0)
  })
})

describe('buildSetupReport', () => {
  it('merges handling + tyre + brake signals and sorts by confidence', () => {
    const report = buildSetupReport({
      balance: [{ phase: 'exit', bias: 0.8 }],
      tyres: { lf: { innerC: 80, middleC: 100, outerC: 80 } },
      brakeBiasPct: 56,
      frontLock: true
    })
    expect(report.suggestions.length).toBeGreaterThanOrEqual(3)
    // Highest-confidence suggestion is first.
    expect(report.suggestions[0].confidence).toBe('high')
    expect(report.summary).toMatch(/ajuste/i)
  })

  it('produces a balanced-car summary when there is nothing to flag', () => {
    const report = buildSetupReport({ balance: [], tyres: {} })
    expect(report.suggestions).toHaveLength(0)
    expect(report.summary).toMatch(/equilibrado/i)
  })
})
