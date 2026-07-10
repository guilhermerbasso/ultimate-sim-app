import { describe, it, expect } from 'vitest'
import type { CoachContextSample, CoachFinding, CoachLapSample } from './coach'
import { emptyBaseline, recordLapEvents } from './coach-baseline'
import { DriverIntentRegistry, type IntentRule } from './driver-intent'
import { applyIntentGate, eventKeyForFinding, findingEventKeys } from './coach-intent-gate'

function mkSample(lapDistPct: number, ctx?: CoachContextSample): CoachLapSample {
  return {
    t: lapDistPct * 1000,
    lapDistPct,
    speedKmh: 150,
    throttle: 0,
    brake: 0,
    clutch: 0,
    steerAbsDeg: 5,
    latAbsG: 0.5,
    longAccelG: 0,
    gear: 4,
    rpm: 7000,
    absActive: false,
    tcActive: false,
    ...(ctx ? { ctx } : {})
  }
}

function mkFinding(over: Partial<CoachFinding> = {}): CoachFinding {
  return {
    id: 'coast:s2:1',
    kind: 'coast',
    phase: 'mid',
    sector: 2,
    zonePctStart: 0.4,
    zonePctEnd: 0.5,
    severity: 'med',
    estTimeLossSec: 0.25,
    estTimeDeltaSec: -0.25,
    sign: 'loss',
    title: 'Coasting mid-corner',
    detail: 'x',
    evidence: 'y',
    metrics: {},
    ...over
  }
}

/** A fake rule with a fixed confidence/category (or null) so we can control the gate. */
function fakeRule(id: string, confidence: number | null, category: IntentRule['category'] = 'racecraft'): IntentRule {
  return {
    id,
    category,
    label: id,
    signalsUsed: [],
    evaluate: () =>
      confidence === null ? null : { intent: id, category, confidence, evidence: [{ signal: 'test', detail: `${id} fired` }] }
  }
}

const windowSamples = [mkSample(0.4, {}), mkSample(0.45, {}), mkSample(0.5, {})]

describe('applyIntentGate — zero-regression no-op', () => {
  it('returns the findings untouched when no sample has context and no baseline', () => {
    const reg = new DriverIntentRegistry().register(fakeRule('side-by-side', 0.9))
    const findings = [mkFinding()]
    const plainSamples = [mkSample(0.4), mkSample(0.45), mkSample(0.5)] // no ctx
    const out = applyIntentGate(findings, plainSamples, reg)
    expect(out).toBe(findings) // same reference → true no-op
  })
})

describe('applyIntentGate — intentional → context', () => {
  it('demotes a loss finding to neutral context when a legitimate intent fires', () => {
    const reg = new DriverIntentRegistry().register(fakeRule('side-by-side', 0.9))
    const out = applyIntentGate([mkFinding()], windowSamples, reg)
    expect(out).toHaveLength(1)
    const f = out[0]
    expect(f.context).toBe(true)
    expect(f.intent).toBe('side-by-side')
    expect(f.intentCategory).toBe('racecraft')
    expect(f.intentEvidence).toEqual(['side-by-side fired'])
    expect(f.severity).toBe('good') // neutralized so spoken/ranked paths skip it
    expect(f.sign).toBeUndefined()
    expect(f.estTimeDeltaSec).toBe(0)
    expect(typeof f.confidence).toBe('number')
  })
})

describe('applyIntentGate — real error kept', () => {
  it('keeps a loss finding as an error (with confidence) when no intent explains it', () => {
    const reg = new DriverIntentRegistry().register(fakeRule('side-by-side', null))
    const out = applyIntentGate([mkFinding({ estTimeLossSec: 0.3 })], windowSamples, reg)
    expect(out).toHaveLength(1)
    expect(out[0].context).toBeUndefined()
    expect(out[0].sign).toBe('loss')
    expect(out[0].confidence).toBeGreaterThan(0.5)
  })

  it('passes good/gain findings through untouched', () => {
    const reg = new DriverIntentRegistry().register(fakeRule('side-by-side', 0.9))
    const good = mkFinding({ kind: 'good', severity: 'good', sign: undefined, estTimeLossSec: 0 })
    const out = applyIntentGate([good], windowSamples, reg)
    expect(out[0]).toBe(good)
  })
})

describe('applyIntentGate — silence', () => {
  it('drops a low-confidence error (partial intent + no repetition + small loss)', () => {
    // Intent confidence 0.5 (< 0.6 threshold → not intentional) but enough to erode
    // error confidence; small loss; baseline present with NO repetition → silenced.
    const reg = new DriverIntentRegistry().register(fakeRule('defend', 0.5))
    const baseline = emptyBaseline('Track :: GP', 'CarX')
    const out = applyIntentGate([mkFinding({ estTimeLossSec: 0.05 })], windowSamples, reg, { baseline, minConfidence: 0.4 })
    expect(out).toHaveLength(0)
  })

  it('keeps the same event when the baseline shows it repeats lap-to-lap', () => {
    const reg = new DriverIntentRegistry().register(fakeRule('defend', 0.5))
    let baseline = emptyBaseline('Track :: GP', 'CarX')
    const key = eventKeyForFinding(mkFinding())
    // Repeat the event across 3 laps → repetition weight climbs → stays audible.
    baseline = { ...baseline, repetition: recordLapEvents(baseline.repetition, 1, [key]) }
    baseline = { ...baseline, repetition: recordLapEvents(baseline.repetition, 2, [key]) }
    baseline = { ...baseline, repetition: recordLapEvents(baseline.repetition, 3, [key]) }
    const out = applyIntentGate([mkFinding({ estTimeLossSec: 0.05 })], windowSamples, reg, { baseline, minConfidence: 0.4 })
    expect(out).toHaveLength(1)
    expect(out[0].sign).toBe('loss')
  })
})

describe('eventKeyForFinding / findingEventKeys', () => {
  it('keys by corner when present, else sector', () => {
    expect(eventKeyForFinding(mkFinding({ corner: 13, sector: 3 }))).toBe('coast:c13')
    expect(eventKeyForFinding(mkFinding({ corner: undefined, sector: 3 }))).toBe('coast:s3')
  })

  it('collects loss + context event keys', () => {
    const keys = findingEventKeys([
      mkFinding({ kind: 'coast', corner: 4 }),
      mkFinding({ kind: 'good', sign: undefined, severity: 'good' }),
      mkFinding({ kind: 'brake-late', corner: 1, sign: undefined, context: true })
    ])
    expect(keys).toEqual(['coast:c4', 'brake-late:c1'])
  })
})
