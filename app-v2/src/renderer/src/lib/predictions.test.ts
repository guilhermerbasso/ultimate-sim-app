import { describe, expect, it } from 'vitest'
import type { CatchEstimate, PredictionsSnapshot } from '../../../shared/predictions'
import { catchAheadView, caughtBehindView, fuelView } from './predictions'

function snapshot(overrides: Partial<PredictionsSnapshot> = {}): PredictionsSnapshot {
  return {
    fuel: { lapsLeftAtPace: 10, finishMarginLaps: 2, finishMarginL: 4 },
    tire: { degSecPerLap: 0.1, pressureState: 'ok', tempState: 'optimal' },
    pace: { projectedLapSec: 90, confidence: 0.8 },
    ...overrides
  }
}

describe('fuelView — unknown race distance (M2)', () => {
  it('renders NEUTRAL (never caution/alert) when the margin is undefined', () => {
    const v = fuelView(snapshot({ fuel: { lapsLeftAtPace: 6.0 } }))
    expect(v.tone).toBe('neutral')
    expect(v.value).toBe('—')
    // It still surfaces the tank laps we DO know.
    expect(v.sub).toContain('6.0v no tanque')
    expect(v.has).toBe(true)
  })

  it('still colours a known negative margin as alert', () => {
    const v = fuelView(snapshot({ fuel: { lapsLeftAtPace: 5, finishMarginLaps: -1.5, finishMarginL: -3 } }))
    expect(v.tone).toBe('alert')
  })

  it('falls back to a calm placeholder with no fuel block at all', () => {
    const v = fuelView({ ...snapshot(), fuel: undefined as unknown as PredictionsSnapshot['fuel'] })
    expect(v.has).toBe(false)
    expect(v.tone).toBe('neutral')
  })
})

describe('catch views — low-confidence (barely-closing) cars (S5)', () => {
  const strong: CatchEstimate = { carIdx: 2, gapSec: 2, closingSecPerLap: 0.5, etaSec: 360, etaLaps: 4 }
  const weak: CatchEstimate = { carIdx: 2, gapSec: 2, closingSecPerLap: 0.06, etaSec: 3000, etaLaps: 33, lowConfidence: true }

  it('catchAheadView hides a low-confidence estimate as "—"/neutral', () => {
    expect(catchAheadView(weak).has).toBe(false)
    expect(catchAheadView(weak).value).toBe('—')
    expect(catchAheadView(weak).tone).toBe('neutral')
    // A confident estimate still renders.
    expect(catchAheadView(strong).has).toBe(true)
  })

  it('caughtBehindView hides a low-confidence threat as "—"/neutral', () => {
    expect(caughtBehindView(weak).has).toBe(false)
    expect(caughtBehindView(weak).tone).toBe('neutral')
    expect(caughtBehindView(strong).has).toBe(true)
  })
})
