import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PREDICTION_TUNABLES,
  catchEstimate,
  computePredictions,
  fuelPrediction,
  gapClosingSecPerLap,
  isRealLapCount,
  lapsToCliffHeuristic,
  linearSlope,
  pressureStateFor,
  projectedLapFromRecent,
  tempStateFor,
  theilSenSlope,
  tireDegSecPerLap,
  type GapSample,
  type PaceModel,
  type PredictionInputs
} from './predictions'

describe('linearSlope', () => {
  it('returns null with < 2 points or no x spread', () => {
    expect(linearSlope([])).toBeNull()
    expect(linearSlope([{ x: 1, y: 2 }])).toBeNull()
    expect(
      linearSlope([
        { x: 5, y: 1 },
        { x: 5, y: 9 }
      ])
    ).toBeNull()
  })

  it('recovers a known slope', () => {
    const slope = linearSlope([
      { x: 0, y: 0 },
      { x: 1, y: 2 },
      { x: 2, y: 4 }
    ])
    expect(slope).toBeCloseTo(2, 6)
  })
})

describe('theilSenSlope', () => {
  it('returns null with < 2 points or no x spread', () => {
    expect(theilSenSlope([])).toBeNull()
    expect(theilSenSlope([{ x: 1, y: 2 }])).toBeNull()
    expect(theilSenSlope([{ x: 5, y: 1 }, { x: 5, y: 9 }])).toBeNull()
  })

  it('recovers a known slope and ignores a single gross outlier (vs least-squares)', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 30 }, // outlier
      { x: 4, y: 4 },
      { x: 5, y: 5 }
    ]
    expect(theilSenSlope(pts)).toBeCloseTo(1, 6) // robust median slope
    expect(linearSlope(pts)).toBeGreaterThan(1.5) // least-squares is dragged up
  })
})

describe('gapClosingSecPerLap', () => {
  it('is positive when the gap is shrinking (catching)', () => {
    const samples: GapSample[] = [
      { lap: 1, gapSec: 3.0 },
      { lap: 2, gapSec: 2.5 },
      { lap: 3, gapSec: 2.0 }
    ]
    // gap drops 0.5s/lap → closing 0.5s/lap.
    expect(gapClosingSecPerLap(samples)).toBeCloseTo(0.5, 6)
  })

  it('is negative when the gap is growing (dropping away)', () => {
    const samples: GapSample[] = [
      { lap: 1, gapSec: 1.0 },
      { lap: 2, gapSec: 1.6 },
      { lap: 3, gapSec: 2.2 }
    ]
    expect(gapClosingSecPerLap(samples)).toBeCloseTo(-0.6, 6)
  })

  it('returns null with too little / sentinel data', () => {
    expect(gapClosingSecPerLap(undefined)).toBeNull()
    expect(gapClosingSecPerLap([{ lap: 1, gapSec: 2 }])).toBeNull()
    expect(
      gapClosingSecPerLap([
        { lap: 1, gapSec: 32767 },
        { lap: 2, gapSec: 32767 }
      ])
    ).toBeNull()
  })
})

describe('catchEstimate', () => {
  it('produces eta only when closing fast enough', () => {
    const est = catchEstimate(7, 2.0, 0.5, 90)
    expect(est).toBeDefined()
    expect(est?.carIdx).toBe(7)
    expect(est?.etaLaps).toBeCloseTo(4, 6) // 2.0 / 0.5
    expect(est?.etaSec).toBeCloseTo(360, 6) // 4 laps * 90s
  })

  it('returns undefined when not closing / closing below threshold', () => {
    expect(catchEstimate(7, 2.0, -0.5, 90)).toBeUndefined()
    expect(catchEstimate(7, 2.0, 0.001, 90)).toBeUndefined()
  })

  it('returns undefined for insane inputs', () => {
    expect(catchEstimate(undefined, 2, 0.5, 90)).toBeUndefined()
    expect(catchEstimate(7, 0, 0.5, 90)).toBeUndefined()
    expect(catchEstimate(7, 32767, 0.5, 90)).toBeUndefined()
    expect(catchEstimate(7, 2, null, 90)).toBeUndefined()
  })

  it('flags a barely-closing car as lowConfidence (absurd ETA must be hideable)', () => {
    // Above the noise floor (0.05) but below the confidence floor (0.12): the ETA
    // balloons (2.0 / 0.06 ≈ 33 laps) and must be marked low-confidence.
    const weak = catchEstimate(7, 2.0, 0.06, 90)
    expect(weak).toBeDefined()
    expect(weak?.lowConfidence).toBe(true)
    // A confidently-closing car carries no lowConfidence flag.
    const strong = catchEstimate(7, 2.0, 0.5, 90)
    expect(strong?.lowConfidence).toBeUndefined()
  })
})

describe('fuelPrediction', () => {
  it('computes laps-left + margins from fuel and lap-based race', () => {
    const f = fuelPrediction({ fuelLevelL: 20, fuelPerLap: 2, lapsRemaining: 8 })
    expect(f.lapsLeftAtPace).toBe(10) // 20 / 2
    expect(f.finishMarginLaps).toBe(2) // 10 - 8
    expect(f.finishMarginL).toBe(4) // 20 - 8*2
  })

  it('shows a deficit when short to the end', () => {
    const f = fuelPrediction({ fuelLevelL: 10, fuelPerLap: 2, lapsRemaining: 8 })
    expect(f.lapsLeftAtPace).toBe(5)
    expect(f.finishMarginLaps).toBe(-3)
    expect(f.finishMarginL).toBe(-6)
  })

  it('ignores the 32767 sentinel and derives laps from session time', () => {
    const f = fuelPrediction({
      fuelLevelL: 20,
      fuelPerLap: 2,
      lapsRemaining: 32767,
      sessionTimeRemainingSec: 900,
      lapTimeSec: 90
    })
    // 900 / 90 = 10 race laps remaining; 20/2 = 10 laps of fuel → margin 0.
    expect(f.lapsLeftAtPace).toBe(10)
    expect(f.finishMarginLaps).toBe(0)
    expect(f.finishMarginL).toBe(0)
  })

  it('returns NO margin (undefined) when the race distance is unknown', () => {
    // No real lap count and no session-time/lap-time to derive one → margins must
    // be undefined so consumers never read a phantom 0-lap "fuel critical".
    const f = fuelPrediction({ fuelLevelL: 20, fuelPerLap: 2 })
    expect(f.lapsLeftAtPace).toBe(10)
    expect(f.finishMarginLaps).toBeUndefined()
    expect(f.finishMarginL).toBeUndefined()
  })

  it('never throws / returns only laps-left without data', () => {
    const f = fuelPrediction({})
    expect(f.lapsLeftAtPace).toBe(0)
    expect(f.finishMarginLaps).toBeUndefined()
    expect(f.finishMarginL).toBeUndefined()
  })
})

describe('tireDegSecPerLap', () => {
  it('is positive when lap times trend slower', () => {
    expect(tireDegSecPerLap([90.0, 90.2, 90.4, 90.6])).toBeCloseTo(0.2, 3)
  })

  it('clamps improving laps to 0 and early-outs on too few samples', () => {
    expect(tireDegSecPerLap([90.6, 90.4, 90.2])).toBe(0)
    expect(tireDegSecPerLap([90, 90])).toBe(0)
  })

  it('is ROBUST to a single traffic/incident outlier lap (no phantom cliff)', () => {
    // Flat pace with ONE traffic-held lap (+6s) in the middle. A least-squares
    // slope would read this as degradation; the Theil–Sen median must not.
    const deg = tireDegSecPerLap([90.0, 90.0, 90.0, 96.0, 90.0, 90.0])
    expect(deg).toBe(0)
    // And therefore no cliff is produced from it.
    expect(lapsToCliffHeuristic(deg, undefined)).toBeUndefined()
  })

  it('still detects genuine degradation through one outlier', () => {
    // A real rising trend with one anomalous fast lap still reads as slowing.
    const deg = tireDegSecPerLap([90.0, 90.2, 90.4, 88.0, 90.8, 91.0])
    expect(deg).toBeGreaterThan(0)
  })
})

describe('pressure / temp windows', () => {
  it('classifies pressure relative to cold pressure', () => {
    expect(pressureStateFor(160, 165)).toBe('low')
    expect(pressureStateFor(175, 165)).toBe('ok')
    expect(pressureStateFor(210, 165)).toBe('high')
  })

  it('falls back to absolute window without cold pressure', () => {
    expect(pressureStateFor(150, undefined)).toBe('low')
    expect(pressureStateFor(185, undefined)).toBe('ok')
    expect(pressureStateFor(220, undefined)).toBe('high')
  })

  it('classifies tyre temperature', () => {
    expect(tempStateFor(60)).toBe('cold')
    expect(tempStateFor(85)).toBe('optimal')
    expect(tempStateFor(110)).toBe('hot')
    expect(tempStateFor(undefined)).toBe('optimal')
  })
})

describe('lapsToCliffHeuristic', () => {
  it('derives laps from the deg rate', () => {
    // cliffDegSec 0.8 / 0.2 deg = 4 laps.
    expect(lapsToCliffHeuristic(0.2, undefined)).toBeCloseTo(4, 3)
  })

  it('returns 0 when tyres are already worn out', () => {
    expect(lapsToCliffHeuristic(0, 0.95)).toBe(0)
  })

  it('returns undefined with no measurable degradation', () => {
    expect(lapsToCliffHeuristic(0, 0.3)).toBeUndefined()
  })
})

describe('projectedLapFromRecent', () => {
  it('trims outliers and reports confidence', () => {
    const p = projectedLapFromRecent([90.0, 90.1, 89.9, 95.0, 90.0, 90.1])
    // The 95.0 outlier is trimmed away.
    expect(p.projectedLapSec).toBeLessThan(91)
    expect(p.confidence).toBeGreaterThan(0)
    expect(p.confidence).toBeLessThanOrEqual(1)
  })

  it('handles empty / single inputs', () => {
    expect(projectedLapFromRecent([])).toEqual({ projectedLapSec: 0, confidence: 0 })
    expect(projectedLapFromRecent([88.5]).projectedLapSec).toBe(88.5)
  })
})

describe('isRealLapCount', () => {
  it('guards the 32767 / >= 9999 sentinel', () => {
    expect(isRealLapCount(12)).toBe(true)
    expect(isRealLapCount(0)).toBe(true)
    expect(isRealLapCount(9999)).toBe(false)
    expect(isRealLapCount(32767)).toBe(false)
    expect(isRealLapCount(-1)).toBe(false)
    expect(isRealLapCount(undefined)).toBe(false)
  })
})

describe('computePredictions (assembler)', () => {
  const baseInputs: PredictionInputs = {
    aheadCarIdx: 3,
    aheadGapSamples: [
      { lap: 1, gapSec: 3.0 },
      { lap: 2, gapSec: 2.5 },
      { lap: 3, gapSec: 2.0 }
    ],
    behindCarIdx: 9,
    behindGapSamples: [
      { lap: 1, gapSec: 1.0 },
      { lap: 2, gapSec: 1.6 },
      { lap: 3, gapSec: 2.2 }
    ],
    fuelLevelL: 20,
    fuelPerLap: 2,
    lapsRemaining: 8,
    recentLapTimes: [90.0, 90.2, 90.4, 90.6],
    tyres: [
      { pressureKpa: 175, coldPressureKpa: 165, tempC: 85, wearPct: 0.4 },
      { pressureKpa: 175, coldPressureKpa: 165, tempC: 85, wearPct: 0.4 },
      { pressureKpa: 175, coldPressureKpa: 165, tempC: 85, wearPct: 0.4 },
      { pressureKpa: 220, coldPressureKpa: 165, tempC: 110, wearPct: 0.4 }
    ],
    trackTempC: 30,
    lapsOnStint: 4
  }

  it('emits catchAhead (you are faster) but not caughtBehind (he is dropping)', () => {
    const snap = computePredictions(baseInputs)
    expect(snap.catchAhead).toBeDefined()
    expect(snap.catchAhead?.carIdx).toBe(3)
    expect(snap.caughtBehind).toBeUndefined()
  })

  it('emits caughtBehind when the chaser is closing', () => {
    const inputs: PredictionInputs = {
      ...baseInputs,
      behindGapSamples: [
        { lap: 1, gapSec: 2.5 },
        { lap: 2, gapSec: 2.0 },
        { lap: 3, gapSec: 1.5 }
      ]
    }
    const snap = computePredictions(inputs)
    expect(snap.caughtBehind).toBeDefined()
    expect(snap.caughtBehind?.carIdx).toBe(9)
  })

  it('always populates fuel / tire / pace deterministically', () => {
    const snap = computePredictions(baseInputs)
    expect(snap.fuel.lapsLeftAtPace).toBe(10)
    expect(snap.fuel.finishMarginLaps).toBe(2)
    expect(snap.tire.degSecPerLap).toBeCloseTo(0.2, 3)
    expect(snap.tire.pressureState).toBe('high') // worst corner wins
    expect(snap.tire.tempState).toBe('hot')
    expect(snap.pace.projectedLapSec).toBeGreaterThan(89)
  })

  it('lets a PaceModel refine pace + lapsToCliff, falling back when null', () => {
    const model: PaceModel = {
      predictLapSec: () => 88.123,
      lapsToCliff: () => 6
    }
    const snap = computePredictions(baseInputs, model)
    expect(snap.pace.projectedLapSec).toBe(88.123)
    expect(snap.pace.confidence).toBeGreaterThanOrEqual(0.5)
    expect(snap.tire.lapsToCliff).toBe(6)

    const nullModel: PaceModel = { predictLapSec: () => null, lapsToCliff: () => null }
    const snap2 = computePredictions(baseInputs, nullModel)
    expect(snap2.pace.projectedLapSec).toBeGreaterThan(89) // deterministic
  })

  it('never throws on empty inputs', () => {
    const snap = computePredictions({})
    expect(snap.fuel).toBeDefined()
    expect(snap.tire).toBeDefined()
    expect(snap.pace).toEqual({ projectedLapSec: 0, confidence: 0 })
    expect(snap.catchAhead).toBeUndefined()
    expect(snap.caughtBehind).toBeUndefined()
  })

  it('survives a throwing PaceModel (deterministic fallback)', () => {
    const model: PaceModel = {
      predictLapSec: () => {
        throw new Error('boom')
      },
      lapsToCliff: () => {
        throw new Error('boom')
      }
    }
    const snap = computePredictions(baseInputs, model)
    expect(snap.pace.projectedLapSec).toBeGreaterThan(89)
  })
})

describe('DEFAULT_PREDICTION_TUNABLES', () => {
  it('exposes sane defaults', () => {
    expect(DEFAULT_PREDICTION_TUNABLES.minClosingSecPerLap).toBeGreaterThan(0)
    expect(DEFAULT_PREDICTION_TUNABLES.cliffDegSec).toBeGreaterThan(0)
    // The confidence floor must sit ABOVE the noise floor so a barely-closing car
    // is emitted-but-flagged rather than fully trusted.
    expect(DEFAULT_PREDICTION_TUNABLES.confidentClosingSecPerLap).toBeGreaterThan(
      DEFAULT_PREDICTION_TUNABLES.minClosingSecPerLap
    )
  })
})
