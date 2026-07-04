import { describe, expect, it } from 'vitest'
import { PaceLearner, featureRow } from './pace-learner'
import type { PaceFeatures } from './predictions'

// Helper: generate a synthetic "ground-truth" lap from a known linear model so
// we can assert the learner recovers it.
function syntheticLap(stint: number, fuelL: number, tempC: number, wear: number): number {
  // base 90s; +0.05s per stint lap (tyre deg); +0.02s per litre of fuel;
  // +1.5s per full wear; small temp effect.
  return 90 + 0.05 * stint + 0.02 * fuelL + 1.5 * wear + 0.01 * (tempC - 25)
}

function feat(stint: number, fuelL: number, tempC: number, wear: number): PaceFeatures {
  return { recentLapTimes: [], lapsOnStint: stint, fuelLevelL: fuelL, trackTempC: tempC, tyreWearPct: wear }
}

describe('featureRow', () => {
  it('prepends a bias term and centers/scales features deterministically', () => {
    const row = featureRow(feat(0, 40, 25, 0))
    expect(row[0]).toBe(1) // bias
    // at reference values every regressor is ~0
    expect(row[1]).toBeCloseTo(0, 9) // wear
    expect(row[2]).toBeCloseTo(0, 9) // fuel (40 == ref)
    expect(row[3]).toBeCloseTo(0, 9) // stint 0
    expect(row[4]).toBeCloseTo(0, 9) // temp (25 == ref)
  })

  it('maps missing optional features to neutral 0 contributions', () => {
    const row = featureRow({ recentLapTimes: [] })
    expect(row).toEqual([1, 0, 0, 0, 0])
  })

  it('clamps wear into 0..1', () => {
    expect(featureRow(feat(0, 40, 25, 2))[1]).toBe(1)
    expect(featureRow(feat(0, 40, 25, -1))[1]).toBe(0)
  })
})

describe('PaceLearner.update / predict', () => {
  it('starts with zero confidence and no samples', () => {
    const l = new PaceLearner()
    expect(l.sampleCount).toBe(0)
    expect(l.predict(feat(0, 40, 25, 0)).confidence).toBe(0)
  })

  it('learns a linear lap-time model from clean laps', () => {
    const l = new PaceLearner()
    // Deterministic PRNG so feature dimensions vary INDEPENDENTLY — otherwise
    // collinear inputs make individual coefficients unidentifiable.
    let seed = 12345
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    let accepted = 0
    for (let i = 0; i < 60; i++) {
      const stint = Math.floor(rnd() * 30)
      const fuel = 5 + rnd() * 60
      const temp = 18 + rnd() * 20
      const wear = rnd()
      const lap = syntheticLap(stint, fuel, temp, wear)
      if (l.update(feat(stint, fuel, temp, wear), lap)) accepted++
    }
    expect(accepted).toBeGreaterThan(40)
    // Predict an arbitrary point and compare with ground truth.
    const truth = syntheticLap(10, 30, 25, 0.25)
    const pred = l.predict(feat(10, 30, 25, 0.25))
    expect(pred.lapSec).toBeCloseTo(truth, 0)
    expect(pred.confidence).toBeGreaterThan(0.5)
  })

  it('confidence grows with sample count', () => {
    const l = new PaceLearner()
    const confidences: number[] = []
    let fuel = 50
    for (let stint = 0; stint < 25; stint++) {
      const lap = syntheticLap(stint, fuel, 25, 0)
      l.update(feat(stint, fuel, 25, 0), lap)
      confidences.push(l.confidence())
      fuel = Math.max(5, fuel - 1.5)
    }
    // monotonic non-decreasing-ish: last >> first
    expect(confidences[confidences.length - 1]).toBeGreaterThan(confidences[MIN_INDEX])
  })
})

const MIN_INDEX = 5

describe('PaceLearner outlier guard', () => {
  it('rejects non-finite and insane lap times', () => {
    const l = new PaceLearner()
    expect(l.update(feat(0, 40, 25, 0), Number.NaN)).toBe(false)
    expect(l.update(feat(0, 40, 25, 0), 0)).toBe(false)
    expect(l.update(feat(0, 40, 25, 0), 99999)).toBe(false)
    expect(l.sampleCount).toBe(0)
  })

  it('rejects a wild in/out lap far from the recent median', () => {
    const l = new PaceLearner()
    for (let i = 0; i < 8; i++) l.update(feat(i, 40, 25, 0), 90 + 0.05 * i)
    const before = l.sampleCount
    // a pit/out lap that is +30s — must be rejected.
    const accepted = l.update(feat(8, 40, 25, 0), 122)
    expect(accepted).toBe(false)
    expect(l.sampleCount).toBe(before)
    expect(l.isOutlier(122)).toBe(true)
    // a normal lap is still accepted.
    expect(l.update(feat(8, 40, 25, 0), 90.4)).toBe(true)
  })
})

describe('PaceLearner degradation / lapsToCliff', () => {
  it('recovers a positive degradation slope', () => {
    const l = new PaceLearner()
    let fuel = 60
    for (let stint = 0; stint < 25; stint++) {
      const lap = 90 + 0.08 * stint + 0.02 * fuel
      l.update(feat(stint, fuel, 25, 0), lap)
      fuel = Math.max(5, fuel - 2)
    }
    const slope = l.degradationSlopeSecPerLap()
    expect(slope).not.toBeNull()
    expect(slope as number).toBeGreaterThan(0)
  })

  it('returns null slope before enough stint spread', () => {
    const l = new PaceLearner()
    expect(l.degradationSlopeSecPerLap()).toBeNull()
  })

  it('lapsToCliff decreases as the stint progresses', () => {
    const l = new PaceLearner()
    let fuel = 60
    for (let stint = 0; stint < 25; stint++) {
      const lap = 90 + 0.1 * stint + 0.02 * fuel
      l.update(feat(stint, fuel, 25, 0), lap)
      fuel = Math.max(5, fuel - 2)
    }
    const early = l.lapsToCliff(feat(2, 30, 25, 0))
    const late = l.lapsToCliff(feat(15, 30, 25, 0))
    expect(early).not.toBeNull()
    expect(late).not.toBeNull()
    expect(late as number).toBeLessThan(early as number)
    expect(late as number).toBeGreaterThanOrEqual(0)
  })

  it('returns null cliff when degradation is negligible', () => {
    const l = new PaceLearner()
    // flat pace: no degradation.
    for (let stint = 0; stint < 20; stint++) l.update(feat(stint, 30, 25, 0), 90)
    expect(l.lapsToCliff(feat(5, 30, 25, 0))).toBeNull()
  })
})

describe('PaceLearner persistence', () => {
  it('round-trips through JSON and keeps predicting identically', () => {
    const l = new PaceLearner()
    let fuel = 55
    for (let stint = 0; stint < 18; stint++) {
      l.update(feat(stint, fuel, 25, stint / 40), syntheticLap(stint, fuel, 25, stint / 40))
      fuel = Math.max(5, fuel - 1.5)
    }
    const state = l.toJSON()
    const json = JSON.stringify(state)
    const restored = PaceLearner.fromJSON(JSON.parse(json))
    expect(restored.sampleCount).toBe(l.sampleCount)
    const f = feat(9, 25, 25, 0.2)
    expect(restored.predict(f).lapSec).toBeCloseTo(l.predict(f).lapSec, 9)
    expect(restored.degradationSlopeSecPerLap()).toBeCloseTo(
      l.degradationSlopeSecPerLap() as number,
      9
    )
  })

  it('returns a fresh learner for corrupt/empty state (never throws)', () => {
    expect(PaceLearner.fromJSON(null).sampleCount).toBe(0)
    expect(PaceLearner.fromJSON({ garbage: true }).sampleCount).toBe(0)
    expect(PaceLearner.fromJSON('nope').sampleCount).toBe(0)
  })

  it('continues learning after a reload', () => {
    const l = new PaceLearner()
    for (let stint = 0; stint < 10; stint++) l.update(feat(stint, 40, 25, 0), 90 + 0.05 * stint)
    const restored = PaceLearner.fromJSON(l.toJSON())
    const ok = restored.update(feat(10, 40, 25, 0), 90.5)
    expect(ok).toBe(true)
    expect(restored.sampleCount).toBe(11)
  })
})
