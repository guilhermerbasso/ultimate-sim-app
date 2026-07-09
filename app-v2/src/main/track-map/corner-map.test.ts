import { describe, expect, it } from 'vitest'
import {
  buildCornerMap,
  cornerAt,
  cornerConfigKey,
  cornerIndexAt,
  detectCorners,
  isValidCornerMap,
  trackLayoutKey,
  DEFAULT_CORNER_MAP_CONFIG,
  type CornerSample
} from './corner-map'

// ─── Synthetic lap ────────────────────────────────────────────────────────────
// A closed lap (lapDistPct 0..1) sampled at `n` even points. Each corner is a
// Gaussian-ish speed dip centred on an apex pct, with brake rising into the apex
// and throttle rising out of it — exactly the shape the detector keys on.

interface CornerSpec {
  apex: number
  minSpeed: number
  /** half-width of the corner in lapDistPct. */
  width: number
}

function syntheticLap(corners: CornerSpec[], n = 400, straightSpeed = 250): CornerSample[] {
  const samples: CornerSample[] = []
  for (let i = 0; i < n; i += 1) {
    const pct = i / n
    // Find the nearest corner influence (wrap-aware).
    let speed = straightSpeed
    let brake = 0
    let throttle = 1
    let steer = 0
    for (const c of corners) {
      const d = Math.min(Math.abs(pct - c.apex), 1 - Math.abs(pct - c.apex))
      if (d < c.width) {
        const k = 1 - d / c.width // 0..1, peaks at apex
        const dip = (straightSpeed - c.minSpeed) * k
        speed = Math.min(speed, straightSpeed - dip)
        // Brake before apex, throttle after; steering peaks at apex.
        steer = Math.max(steer, 35 * k)
        if (pct <= c.apex) {
          brake = Math.max(brake, 0.9 * k)
          throttle = Math.min(throttle, 1 - k)
        } else {
          throttle = Math.max(0, Math.min(throttle, k < 0.9 ? 1 : 0.2))
        }
      }
    }
    samples.push({ lapDistPct: pct, speedKmh: speed, brake, throttle, steerAbsDeg: steer })
  }
  return samples
}

describe('detectCorners', () => {
  it('numbers corners sequentially along lapDistPct (Turn 1..N)', () => {
    const lap = syntheticLap([
      { apex: 0.2, minSpeed: 80, width: 0.06 },
      { apex: 0.5, minSpeed: 60, width: 0.06 },
      { apex: 0.8, minSpeed: 100, width: 0.06 }
    ])
    const corners = detectCorners(lap)
    expect(corners.length).toBe(3)
    // Sequential 1-based numbering, ascending apex.
    expect(corners.map((c) => c.index)).toEqual([1, 2, 3])
    const apexes = corners.map((c) => c.apexPct)
    expect(apexes[0]).toBeLessThan(apexes[1])
    expect(apexes[1]).toBeLessThan(apexes[2])
    // Apexes land near the synthetic minima.
    expect(corners[0].apexPct).toBeGreaterThan(0.15)
    expect(corners[0].apexPct).toBeLessThan(0.25)
    expect(corners[1].apexPct).toBeGreaterThan(0.45)
    expect(corners[1].apexPct).toBeLessThan(0.55)
  })

  it('returns no corners for a flat-out lap (no speed dips)', () => {
    const flat: CornerSample[] = []
    for (let i = 0; i < 200; i += 1) flat.push({ lapDistPct: i / 200, speedKmh: 240, brake: 0, throttle: 1, steerAbsDeg: 0 })
    expect(detectCorners(flat)).toEqual([])
  })

  it('has each corner entry < apex < exit', () => {
    const lap = syntheticLap([
      { apex: 0.3, minSpeed: 70, width: 0.07 },
      { apex: 0.7, minSpeed: 90, width: 0.07 }
    ])
    for (const c of detectCorners(lap)) {
      expect(c.startPct).toBeLessThanOrEqual(c.apexPct)
      expect(c.apexPct).toBeLessThanOrEqual(c.endPct)
      expect(c.minSpeedKmh).toBeGreaterThan(0)
    }
  })
})

describe('cornerAt / cornerIndexAt (lapDistPct → corner)', () => {
  const lap = syntheticLap([
    { apex: 0.2, minSpeed: 80, width: 0.06 },
    { apex: 0.5, minSpeed: 60, width: 0.06 },
    { apex: 0.8, minSpeed: 100, width: 0.06 }
  ])
  const corners = detectCorners(lap)

  it('maps an apex point to its own corner', () => {
    expect(cornerIndexAt(corners, 0.2)).toBe(1)
    expect(cornerIndexAt(corners, 0.5)).toBe(2)
    expect(cornerIndexAt(corners, 0.8)).toBe(3)
  })

  it('returns null on a straight (between corners)', () => {
    expect(cornerAt(corners, 0.0)).toBeNull()
    expect(cornerAt(corners, 0.35)).toBeNull()
    expect(cornerIndexAt(corners, 0.99)).toBeNull()
  })

  it('corner extents do not overlap', () => {
    for (let i = 1; i < corners.length; i += 1) {
      expect(corners[i].startPct).toBeGreaterThanOrEqual(corners[i - 1].endPct)
    }
  })
})

describe('buildCornerMap / isValidCornerMap / cornerConfigKey', () => {
  it('builds a valid persisted map with a stable config key', () => {
    const lap = syntheticLap([{ apex: 0.4, minSpeed: 75, width: 0.07 }])
    const map = buildCornerMap('Interlagos', lap)
    expect(isValidCornerMap(map)).toBe(true)
    expect(map.trackName).toBe('Interlagos')
    expect(map.configKey).toBe(cornerConfigKey(DEFAULT_CORNER_MAP_CONFIG))
    expect(map.corners.length).toBe(1)
    expect(map.sampleCount).toBe(lap.length)
  })

  it('rejects malformed records', () => {
    expect(isValidCornerMap(null)).toBe(false)
    expect(isValidCornerMap({})).toBe(false)
    expect(isValidCornerMap({ version: 2, corners: [] })).toBe(false)
  })
})

// N1 — corner maps must not bleed across track LAYOUTS.
describe('trackLayoutKey + per-layout corner maps', () => {
  it('is just the track name when there is no layout (backward-compatible)', () => {
    expect(trackLayoutKey('Silverstone Circuit')).toBe('Silverstone Circuit')
    expect(trackLayoutKey('Silverstone Circuit', '')).toBe('Silverstone Circuit')
    expect(trackLayoutKey('Silverstone Circuit', '   ')).toBe('Silverstone Circuit')
    expect(trackLayoutKey('  Silverstone Circuit  ', null)).toBe('Silverstone Circuit')
  })

  it('produces distinct keys for two layouts of one track', () => {
    const gp = trackLayoutKey('Silverstone Circuit', 'Grand Prix')
    const intl = trackLayoutKey('Silverstone Circuit', 'International')
    expect(gp).toBe('Silverstone Circuit :: Grand Prix')
    expect(intl).toBe('Silverstone Circuit :: International')
    expect(gp).not.toBe(intl)
  })

  it('buildCornerMap records the layout and stays a valid map', () => {
    const lap = syntheticLap([{ apex: 0.4, minSpeed: 75, width: 0.07 }])
    const gp = buildCornerMap('Silverstone Circuit', lap, DEFAULT_CORNER_MAP_CONFIG, 1, 'Grand Prix')
    expect(isValidCornerMap(gp)).toBe(true)
    expect(gp.trackConfigName).toBe('Grand Prix')
    // Same track name + same detection config, but the LAYOUT must distinguish them.
    const plain = buildCornerMap('Silverstone Circuit', lap)
    expect(plain.trackConfigName).toBeUndefined()
    expect(isValidCornerMap(plain)).toBe(true)
    expect(trackLayoutKey(gp.trackName, gp.trackConfigName)).not.toBe(
      trackLayoutKey(plain.trackName, plain.trackConfigName)
    )
  })

  it('a blank layout is normalised away (no trackConfigName field)', () => {
    const lap = syntheticLap([{ apex: 0.4, minSpeed: 75, width: 0.07 }])
    const map = buildCornerMap('Silverstone Circuit', lap, DEFAULT_CORNER_MAP_CONFIG, 1, '   ')
    expect(map.trackConfigName).toBeUndefined()
  })
})
