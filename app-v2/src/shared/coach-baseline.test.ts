import { describe, expect, it } from 'vitest'
import {
  isOutlier,
  isRepeated,
  recordLapEvents,
  updateRobustMetric,
  type RepetitionTracker,
  type RobustMetric
} from './coach-baseline'

describe('coach baseline robust metrics', () => {
  it('keeps a brand-new metric empty when sample is invalid', () => {
    const metric = updateRobustMetric(undefined, Number.NaN)
    expect(metric.n).toBe(0)
    expect(metric.samples).toEqual([])
  })

  it('updates median/MAD and EMA toward repeated clean samples', () => {
    let metric: RobustMetric | undefined
    for (const sample of [99, 100, 101, 100, 100, 101, 99]) {
      metric = updateRobustMetric(metric, sample)
    }

    expect(metric?.n).toBe(7)
    expect(metric?.median).toBe(100)
    expect(metric?.mad).toBe(1)
    expect(metric?.ema).toBeCloseTo(99.9, 0)
  })

  it('rejects a spike as a robust z-score outlier', () => {
    let metric: RobustMetric | undefined
    for (const sample of [100, 101, 99, 100, 101, 99, 100]) {
      metric = updateRobustMetric(metric, sample)
    }

    expect(metric).toBeDefined()
    expect(isOutlier(metric as RobustMetric, 130)).toBe(true)
    expect(isOutlier(metric as RobustMetric, 101)).toBe(false)
  })
})

describe('coach baseline repetition tracker', () => {
  it('returns true for 2 of the last 3 laps', () => {
    let tracker: RepetitionTracker = { laps: [] }
    tracker = recordLapEvents(tracker, 1, ['braking:turn-1'])
    tracker = recordLapEvents(tracker, 2, [])
    tracker = recordLapEvents(tracker, 3, ['braking:turn-1'])

    expect(isRepeated(tracker, 'braking:turn-1')).toBe(true)
  })

  it('returns false for 1 of the last 3 laps', () => {
    let tracker: RepetitionTracker = { laps: [] }
    tracker = recordLapEvents(tracker, 1, ['braking:turn-1'])
    tracker = recordLapEvents(tracker, 2, [])
    tracker = recordLapEvents(tracker, 3, [])

    expect(isRepeated(tracker, 'braking:turn-1')).toBe(false)
  })
})
