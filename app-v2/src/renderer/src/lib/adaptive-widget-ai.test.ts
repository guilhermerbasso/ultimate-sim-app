import { describe, expect, it } from 'vitest'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import { HIFI_WIDGETS_BY_ID } from '../hifi/widgets/registry'
import { selectAdaptiveWidgets } from './adaptive-widget-ai'

function snap(partial: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 0,
    speedKmh: 0,
    rpm: 0,
    gear: 0,
    throttle: 0,
    brake: 0,
    clutch: 0,
    ...partial
  }
}

describe('selectAdaptiveWidgets', () => {
  it('boosts fuel widgets for low fuel and short fuel range', () => {
    const selected = selectAdaptiveWidgets({
      snapshot: snap({ fuelLiters: 4, fuelCapacityLiters: 80, fuelPerLap: 2.5, lapsRemaining: 5 }),
      ai: null,
      moment: 'fuel-critical',
      maxSlots: 6
    })

    expect(selected.slice(0, 3).some((id) => HIFI_WIDGETS_BY_ID[id]?.category === 'fuel')).toBe(true)
    expect(selected).toContain('fuelLaps')
  })

  it('boosts gap-behind, relative, or radar widgets when a car is close behind', () => {
    const selected = selectAdaptiveWidgets({
      snapshot: snap({
        relatives: { behind: { carIdx: 2, name: 'Rival', carNumber: '7', gapSec: -0.42 } },
        radarCars: [{ carIdx: 2, relativeX: 1.2, relativeY: -5, gapSec: -0.42 }]
      }),
      ai: null,
      moment: 'defending',
      maxSlots: 5
    })

    expect(selected.slice(0, 3).some((id) => ['gapBehind', 'deltaBehind', 'relative', 'radar'].includes(id))).toBe(true)
  })

  it('caps category diversity instead of filling every slot with fuel widgets', () => {
    const selected = selectAdaptiveWidgets({
      snapshot: snap({ fuelLiters: 2, fuelCapacityLiters: 100, fuelPerLap: 2, lapsRemaining: 8 }),
      ai: { strategy: { text: 'Save fuel and box soon', pitInLaps: 1 }, confidence: 0.8 },
      moment: 'fuel-save',
      maxSlots: 8
    })

    const counts = selected.reduce<Record<string, number>>((acc, id) => {
      const category = HIFI_WIDGETS_BY_ID[id]?.category ?? 'unknown'
      acc[category] = (acc[category] ?? 0) + 1
      return acc
    }, {})

    expect(counts.fuel).toBeLessThanOrEqual(2)
    expect(counts.ai).toBeLessThanOrEqual(1)
    expect(Object.keys(counts).length).toBeGreaterThan(2)
  })

  it('respects maxSlots', () => {
    expect(selectAdaptiveWidgets({ snapshot: snap(), ai: null, moment: 'clear-running', maxSlots: 3 })).toHaveLength(3)
    expect(selectAdaptiveWidgets({ snapshot: snap(), ai: null, moment: 'clear-running', maxSlots: 0 })).toEqual([])
  })

  it('is deterministic for the same input', () => {
    const input = {
      snapshot: snap({ deltaToBestSec: -0.5, throttle: 0.9, brake: 0.1 }),
      ai: { coachTip: { text: 'Improve brake release and throttle pickup', confidence: 0.7 } },
      moment: 'qualifying-lap',
      maxSlots: 7
    }

    expect(selectAdaptiveWidgets(input)).toEqual(selectAdaptiveWidgets(input))
  })

  it('does not throw with an empty snapshot', () => {
    expect(() => selectAdaptiveWidgets({ snapshot: null, ai: null, moment: null, maxSlots: 6 })).not.toThrow()
    expect(selectAdaptiveWidgets({ snapshot: null, ai: null, moment: null, maxSlots: 6 }).length).toBeLessThanOrEqual(6)
  })
})
