import { describe, it, expect } from 'vitest'
import type { CoachContextSample, CoachLapSample } from './coach'
import {
  DriverIntentRegistry,
  buildIntentEvent,
  clamp01,
  combineConfidence,
  fuzzyFalling,
  fuzzyRising,
  fuzzyTrapezoid,
  mergeContext,
  windowForZone,
  type IntentEventContext,
  type IntentRule,
  type IntentScore
} from './driver-intent'

function mkSample(lapDistPct: number, ctx?: CoachContextSample): CoachLapSample {
  return {
    t: lapDistPct * 1000,
    lapDistPct,
    speedKmh: 150,
    throttle: 0,
    brake: 0,
    clutch: 0,
    steerAbsDeg: 5,
    latAbsG: 0.2,
    longAccelG: 0,
    gear: 4,
    rpm: 7000,
    absActive: false,
    tcActive: false,
    ...(ctx ? { ctx } : {})
  }
}

function mkEvent(over: Partial<IntentEventContext> = {}): IntentEventContext {
  return {
    finding: { kind: 'coast', sector: 2, zonePctStart: 0.4, zonePctEnd: 0.5, estTimeLossSec: 0.2 },
    samples: [],
    window: { startIdx: 0, endIdx: 0 },
    ctx: {},
    ...over
  }
}

describe('fuzzy membership helpers', () => {
  it('clamp01 clamps and guards NaN', () => {
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(2)).toBe(1)
    expect(clamp01(0.4)).toBe(0.4)
    expect(clamp01(Number.NaN)).toBe(0)
  })

  it('fuzzyRising ramps 0→1 across [a,b]', () => {
    expect(fuzzyRising(0.3, 0.4, 1.6)).toBe(0)
    expect(fuzzyRising(1.6, 0.4, 1.6)).toBe(1)
    expect(fuzzyRising(1.0, 0.4, 1.6)).toBeCloseTo(0.5, 5)
  })

  it('fuzzyFalling ramps 1→0 across [a,b]', () => {
    expect(fuzzyFalling(0.3, 0.4, 1.6)).toBe(1)
    expect(fuzzyFalling(1.6, 0.4, 1.6)).toBe(0)
    expect(fuzzyFalling(1.0, 0.4, 1.6)).toBeCloseTo(0.5, 5)
  })

  it('fuzzyTrapezoid holds 1 in the core band', () => {
    expect(fuzzyTrapezoid(0.0, 0.2, 0.4, 0.6, 0.8)).toBe(0)
    expect(fuzzyTrapezoid(0.5, 0.2, 0.4, 0.6, 0.8)).toBe(1)
    expect(fuzzyTrapezoid(0.7, 0.2, 0.4, 0.6, 0.8)).toBeCloseTo(0.5, 5)
  })

  it('combineConfidence is a weighted mean ignoring non-positive weights', () => {
    expect(combineConfidence([{ weight: 1, value: 1 }, { weight: 1, value: 0 }])).toBeCloseTo(0.5, 5)
    expect(combineConfidence([{ weight: 3, value: 1 }, { weight: 1, value: 0 }])).toBeCloseTo(0.75, 5)
    expect(combineConfidence([{ weight: 0, value: 1 }])).toBe(0)
    expect(combineConfidence([])).toBe(0)
  })
})

describe('windowForZone', () => {
  const samples = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map((p) => mkSample(p))

  it('finds the index range inside the zone', () => {
    const w = windowForZone(samples, 0.2, 0.4)
    expect(w.startIdx).toBe(2)
    expect(w.endIdx).toBe(4)
  })

  it('falls back to the nearest sample when the zone is between samples', () => {
    const w = windowForZone(samples, 0.62, 0.64)
    expect(w.startIdx).toBe(6)
    expect(w.endIdx).toBe(6)
  })
})

describe('mergeContext', () => {
  it('aggregates worst/most-relevant signals across the window', () => {
    const samples = [
      mkSample(0.40, { carLeftRight: 'clear', gapAheadSec: 2.0, flagYellow: false, tyreWearMaxPct: 40 }),
      mkSample(0.45, { carLeftRight: 'right', gapAheadSec: 0.6, flagYellow: false, tyreWearMaxPct: 55 }),
      mkSample(0.50, { carLeftRight: 'both', gapAheadSec: 1.2, flagYellow: true, tyreWearMaxPct: 50, sessionState: 'racing' })
    ]
    const merged = mergeContext(samples, 0, 2)
    expect(merged.carLeftRight).toBe('both') // busiest side across window
    expect(merged.gapAheadSec).toBeCloseTo(0.6, 5) // closest
    expect(merged.flagYellow).toBe(true) // any true
    expect(merged.tyreWearMaxPct).toBe(55) // max
    expect(merged.sessionState).toBe('racing') // latest
  })

  it('returns an empty object when no sample carries context', () => {
    expect(mergeContext([mkSample(0.4), mkSample(0.5)], 0, 1)).toEqual({})
  })
})

describe('buildIntentEvent', () => {
  it('locates the window and merges the context frame', () => {
    const samples = [
      mkSample(0.38, { carLeftRight: 'clear' }),
      mkSample(0.42, { carLeftRight: 'left' }),
      mkSample(0.48, { carLeftRight: 'left', gapBehindSec: 0.5 })
    ]
    const event = buildIntentEvent(
      { kind: 'coast', sector: 2, zonePctStart: 0.4, zonePctEnd: 0.5, estTimeLossSec: 0.2 },
      samples
    )
    expect(event).not.toBeNull()
    expect(event!.window.startIdx).toBe(1)
    expect(event!.window.endIdx).toBe(2)
    expect(event!.ctx.carLeftRight).toBe('left')
    expect(event!.ctx.gapBehindSec).toBeCloseTo(0.5, 5)
  })

  it('returns null for empty samples', () => {
    expect(buildIntentEvent({ kind: 'coast', sector: 1, zonePctStart: 0.1, zonePctEnd: 0.2, estTimeLossSec: 0.1 }, [])).toBeNull()
  })
})

describe('DriverIntentRegistry', () => {
  const alwaysHigh: IntentRule = {
    id: 'side-by-side',
    category: 'racecraft',
    label: 'test high',
    signalsUsed: ['carLeftRight'],
    evaluate: (): IntentScore => ({ intent: 'side-by-side', category: 'racecraft', confidence: 0.9, evidence: [{ signal: 'carLeftRight', detail: 'both' }] })
  }
  const alwaysLow: IntentRule = {
    id: 'lift-and-coast',
    category: 'management',
    label: 'test low',
    signalsUsed: ['fuelLevelPct'],
    evaluate: (): IntentScore => ({ intent: 'lift-and-coast', category: 'management', confidence: 0.3, evidence: [] })
  }
  const neverFires: IntentRule = {
    id: 'defend',
    category: 'racecraft',
    label: 'test null',
    signalsUsed: [],
    evaluate: () => null
  }

  it('throws on duplicate rule id', () => {
    const reg = new DriverIntentRegistry().register(alwaysHigh)
    expect(() => reg.register({ ...alwaysHigh })).toThrow(/Duplicate/)
  })

  it('classify picks the highest-confidence legitimate intent and flags intentional above threshold', () => {
    const reg = new DriverIntentRegistry().registerAll([alwaysLow, alwaysHigh, neverFires])
    const evaln = reg.classify(mkEvent(), { threshold: 0.6 })
    expect(evaln.intent).toBe('side-by-side')
    expect(evaln.confidence).toBeCloseTo(0.9, 5)
    expect(evaln.isIntentional).toBe(true)
    expect(evaln.candidates.map((c) => c.intent)).toEqual(['side-by-side', 'lift-and-coast'])
  })

  it('stays below threshold when only weak intents fire', () => {
    const reg = new DriverIntentRegistry().registerAll([alwaysLow])
    const evaln = reg.classify(mkEvent(), { threshold: 0.6 })
    expect(evaln.intent).toBe('lift-and-coast')
    expect(evaln.isIntentional).toBe(false)
  })

  it('returns the none sentinel when no rule fires', () => {
    const reg = new DriverIntentRegistry().register(neverFires)
    const evaln = reg.classify(mkEvent())
    expect(evaln.intent).toBe('none')
    expect(evaln.isIntentional).toBe(false)
    expect(evaln.candidates).toHaveLength(0)
  })

  it('swallows a throwing rule without failing the whole classification', () => {
    const boom: IntentRule = {
      id: 'attack',
      category: 'racecraft',
      label: 'boom',
      signalsUsed: [],
      evaluate: () => {
        throw new Error('boom')
      }
    }
    const reg = new DriverIntentRegistry().registerAll([boom, alwaysHigh])
    const evaln = reg.classify(mkEvent())
    expect(evaln.intent).toBe('side-by-side')
  })
})
