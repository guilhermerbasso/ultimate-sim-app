import { describe, expect, it } from 'vitest'
import type { RadarCarEntry, TelemetrySnapshot } from './telemetry'
import {
  DEFAULT_SPOTTER_3D_CONFIG,
  computeSpatialCues,
  mergeSpotter3DConfig,
  proximityFromDistance,
  sideFromPan,
  smoothScalar
} from './spotter3d'

function snap(partial: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1_000,
    speedKmh: 150,
    rpm: 6000,
    gear: 4,
    throttle: 0.5,
    brake: 0,
    clutch: 0,
    ...partial
  }
}

function radar(partial: Partial<RadarCarEntry> = {}): RadarCarEntry {
  return { carIdx: 1, relativeX: 0, relativeY: 0, ...partial }
}

describe('sideFromPan', () => {
  it('classifies left/center/right', () => {
    expect(sideFromPan(-0.8)).toBe('left')
    expect(sideFromPan(0)).toBe('center')
    expect(sideFromPan(0.8)).toBe('right')
  })
})

describe('computeSpatialCues — radar', () => {
  it('returns nothing when disconnected or empty', () => {
    expect(computeSpatialCues(null, DEFAULT_SPOTTER_3D_CONFIG)).toEqual([])
    expect(computeSpatialCues(snap({ connected: false }), DEFAULT_SPOTTER_3D_CONFIG)).toEqual([])
    expect(computeSpatialCues(snap(), DEFAULT_SPOTTER_3D_CONFIG)).toEqual([])
  })

  it('places a car on the correct side and pans by relativeX', () => {
    const left = computeSpatialCues(snap({ radarCars: [radar({ carIdx: 5, relativeX: -6, relativeY: 0 })] }), DEFAULT_SPOTTER_3D_CONFIG)
    expect(left).toHaveLength(1)
    expect(left[0].side).toBe('left')
    expect(left[0].pan).toBeLessThan(0)
    expect(left[0].id).toBe(5)

    const right = computeSpatialCues(snap({ radarCars: [radar({ relativeX: 6 })] }), DEFAULT_SPOTTER_3D_CONFIG)
    expect(right[0].side).toBe('right')
    expect(right[0].pan).toBeGreaterThan(0)
  })

  it('drops cars beyond max distance and ranks alongside cars higher', () => {
    const cfg = mergeSpotter3DConfig(DEFAULT_SPOTTER_3D_CONFIG, { maxDistanceM: 30, maxVoices: 5 })
    const cues = computeSpatialCues(
      snap({
        radarCars: [
          radar({ carIdx: 1, relativeX: 2, relativeY: 0 }), // alongside, close
          radar({ carIdx: 2, relativeX: 2, relativeY: 20 }), // far ahead
          radar({ carIdx: 3, relativeX: 1, relativeY: 100 }) // out of range
        ]
      }),
      cfg
    )
    const ids = cues.map((c) => c.id)
    expect(ids).toContain(1)
    expect(ids).toContain(2)
    expect(ids).not.toContain(3)
    // The alongside car is the strongest cue.
    expect(cues[0].id).toBe(1)
    expect(cues[0].intensity).toBeGreaterThan(cues[1].intensity)
  })

  it('caps the number of cues at maxVoices', () => {
    const cfg = mergeSpotter3DConfig(DEFAULT_SPOTTER_3D_CONFIG, { maxVoices: 2 })
    const cues = computeSpatialCues(
      snap({ radarCars: [radar({ carIdx: 1, relativeX: 1 }), radar({ carIdx: 2, relativeX: 2 }), radar({ carIdx: 3, relativeX: 3 })] }),
      cfg
    )
    expect(cues.length).toBeLessThanOrEqual(2)
  })
})

describe('computeSpatialCues — CarLeftRight fallback', () => {
  it('synthesises cues from the authoritative side flag when no radar exists', () => {
    expect(computeSpatialCues(snap({ carLeftRight: 'left' }), DEFAULT_SPOTTER_3D_CONFIG).map((c) => c.side)).toEqual(['left'])
    expect(computeSpatialCues(snap({ carLeftRight: 'right' }), DEFAULT_SPOTTER_3D_CONFIG).map((c) => c.side)).toEqual(['right'])
    const both = computeSpatialCues(snap({ carLeftRight: 'both' }), DEFAULT_SPOTTER_3D_CONFIG)
    expect(both.map((c) => c.side).sort()).toEqual(['left', 'right'])
    expect(computeSpatialCues(snap({ carLeftRight: 'clear' }), DEFAULT_SPOTTER_3D_CONFIG)).toEqual([])
  })
})

describe('computeSpatialCues — relatives front/back fallback (no radar)', () => {
  it('images a car ahead as front (z>0) and a car behind as back (z<0) from the gap', () => {
    const cues = computeSpatialCues(
      snap({
        speedKmh: 180,
        relatives: {
          ahead: { carIdx: 11, name: 'Ahead', carNumber: '11', gapSec: 0.5 },
          behind: { carIdx: 12, name: 'Behind', carNumber: '12', gapSec: -0.5 }
        }
      }),
      DEFAULT_SPOTTER_3D_CONFIG
    )
    const ahead = cues.find((c) => c.id === 11)
    const behind = cues.find((c) => c.id === 12)
    expect(ahead).toBeDefined()
    expect(ahead?.front).toBe(true)
    expect(ahead?.z).toBeGreaterThan(0)
    expect(ahead?.side).toBe('center') // relatives carry no L/R offset
    expect(ahead?.pan).toBe(0)
    expect(behind).toBeDefined()
    expect(behind?.front).toBe(false)
    expect(behind?.z).toBeLessThan(0)
  })

  it('prefers relatives (front/back) over the CarLeftRight flag when both exist', () => {
    const cues = computeSpatialCues(
      snap({ speedKmh: 180, carLeftRight: 'left', relatives: { ahead: { carIdx: 3, name: 'A', carNumber: '3', gapSec: 0.4 } } }),
      DEFAULT_SPOTTER_3D_CONFIG
    )
    expect(cues).toHaveLength(1)
    expect(cues[0].id).toBe(3)
    expect(cues[0].z).toBeGreaterThan(0)
  })

  it('ignores relatives whose gap maps beyond max distance', () => {
    const cues = computeSpatialCues(
      snap({ speedKmh: 200, relatives: { ahead: { carIdx: 9, name: 'A', carNumber: '9', gapSec: 5 } } }),
      DEFAULT_SPOTTER_3D_CONFIG
    )
    expect(cues).toEqual([])
  })
})

describe('computeSpatialCues — no radar / no relatives → CarLeftRight L/R only (z≈0)', () => {
  it('keeps left/right imaging with no front/back (z≈0) when only CarLeftRight is known', () => {
    const left = computeSpatialCues(snap({ carLeftRight: 'left' }), DEFAULT_SPOTTER_3D_CONFIG)
    expect(left).toHaveLength(1)
    expect(left[0].side).toBe('left')
    expect(left[0].pan).toBeLessThan(0)
    expect(left[0].z).toBe(0)
    expect(left[0].front).toBe(true)

    const right = computeSpatialCues(snap({ carLeftRight: 'right' }), DEFAULT_SPOTTER_3D_CONFIG)
    expect(right[0].side).toBe('right')
    expect(right[0].pan).toBeGreaterThan(0)
    expect(right[0].z).toBe(0)
  })
})

describe('cueFromRadarCar — z falls back to the signed gap when relativeY is ~0', () => {
  it('derives front/back from gapSec when relativeY collapses to zero', () => {
    const ahead = computeSpatialCues(snap({ speedKmh: 180, radarCars: [radar({ carIdx: 21, relativeX: 1, relativeY: 0, gapSec: 0.3 })] }), DEFAULT_SPOTTER_3D_CONFIG)
    expect(ahead[0].front).toBe(true)
    expect(ahead[0].z).toBeGreaterThan(0)

    const behind = computeSpatialCues(snap({ speedKmh: 180, radarCars: [radar({ carIdx: 22, relativeX: 1, relativeY: 0, gapSec: -0.3 })] }), DEFAULT_SPOTTER_3D_CONFIG)
    expect(behind[0].front).toBe(false)
    expect(behind[0].z).toBeLessThan(0)
  })
})

describe('mergeSpotter3DConfig', () => {
  it('clamps numeric fields and stamps updatedAt', () => {
    const merged = mergeSpotter3DConfig(DEFAULT_SPOTTER_3D_CONFIG, { enabled: true, masterVolume: 9, maxVoices: 99 })
    expect(merged.enabled).toBe(true)
    expect(merged.masterVolume).toBe(1)
    expect(merged.maxVoices).toBe(6)
    expect(merged.updatedAt).toBeGreaterThan(0)
  })
})

describe('default config', () => {
  it('is enabled by default so the spatial spotter runs automatically', () => {
    expect(DEFAULT_SPOTTER_3D_CONFIG.enabled).toBe(true)
  })
})

describe('proximityFromDistance — distance → gain mapping', () => {
  it('is 1 on top of you, ~0.5 at half range and 0 at/after max', () => {
    expect(proximityFromDistance(0, 30)).toBe(1)
    expect(proximityFromDistance(15, 30)).toBeCloseTo(0.5, 5)
    expect(proximityFromDistance(30, 30)).toBe(0)
    expect(proximityFromDistance(100, 30)).toBe(0) // clamped, never negative
  })

  it('is monotonically decreasing with distance', () => {
    const near = proximityFromDistance(5, 40)
    const mid = proximityFromDistance(20, 40)
    const far = proximityFromDistance(35, 40)
    expect(near).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(far)
  })

  it('handles non-finite / invalid inputs without NaN', () => {
    expect(proximityFromDistance(Number.NaN, 30)).toBe(0)
    expect(proximityFromDistance(10, 0)).toBe(0)
  })
})

describe('smoothScalar — clamping & smoothing', () => {
  it('snaps to next on the first (non-finite prev) sample', () => {
    expect(smoothScalar(Number.NaN, 5, 0.2)).toBe(5)
  })

  it('keeps prev when alpha is 0 and jumps to next when alpha is 1', () => {
    expect(smoothScalar(2, 8, 0)).toBe(2)
    expect(smoothScalar(2, 8, 1)).toBe(8)
  })

  it('eases toward next and clamps alpha out of range', () => {
    expect(smoothScalar(0, 10, 0.5)).toBe(5)
    expect(smoothScalar(0, 10, 2)).toBe(10) // alpha clamped to 1
    expect(smoothScalar(0, 10, -1)).toBe(0) // alpha clamped to 0
  })
})

describe('computeSpatialCues — front/back disambiguation', () => {
  it('marks cars ahead as front and cars behind as not front', () => {
    const ahead = computeSpatialCues(snap({ radarCars: [radar({ carIdx: 7, relativeX: 1, relativeY: 6 })] }), DEFAULT_SPOTTER_3D_CONFIG)
    expect(ahead[0].front).toBe(true)
    expect(ahead[0].z).toBeGreaterThan(0)

    const behind = computeSpatialCues(snap({ radarCars: [radar({ carIdx: 8, relativeX: 1, relativeY: -6 })] }), DEFAULT_SPOTTER_3D_CONFIG)
    expect(behind[0].front).toBe(false)
    expect(behind[0].z).toBeLessThan(0)
  })

  it('treats the CarLeftRight fallback (alongside) as front', () => {
    const cues = computeSpatialCues(snap({ carLeftRight: 'left' }), DEFAULT_SPOTTER_3D_CONFIG)
    expect(cues[0].front).toBe(true)
  })
})

describe('computeSpatialCues — silence', () => {
  it('produces no cues (silent) when there are no nearby cars', () => {
    expect(computeSpatialCues(snap({ radarCars: [] }), DEFAULT_SPOTTER_3D_CONFIG)).toEqual([])
    expect(computeSpatialCues(snap({ carLeftRight: 'clear' }), DEFAULT_SPOTTER_3D_CONFIG)).toEqual([])
  })
})
