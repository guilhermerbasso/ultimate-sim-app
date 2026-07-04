import { describe, expect, it } from 'vitest'
import {
  GHOST_SAMPLE_COUNT,
  SHARE_PACK_MAGIC,
  SHARE_PACK_VERSION,
  SharePackError,
  buildGhostLap,
  compareGhosts,
  isSharePack,
  parseSharePack,
  serializeSharePack,
  summarizeSharePack,
  validateSharePack,
  type GhostLap,
  type RawGhostSample,
  type SharePack
} from './community'

function ghostPack(overrides: Partial<SharePack> = {}): SharePack {
  return {
    magic: SHARE_PACK_MAGIC,
    version: SHARE_PACK_VERSION,
    kind: 'ghost',
    id: 'ghost-1',
    meta: { createdAt: 1_700_000_000_000, sim: 'iracing', car: 'MX-5', track: 'Lime Rock', author: 'Gui' },
    ghost: {
      lapTimeSec: 60,
      sampleCount: 3,
      samples: [
        { lapDistPct: 0.0, speedKmh: 100, throttle: 1, brake: 0, steer: -2, rpm: 5000, gear: 3 },
        { lapDistPct: 0.5, speedKmh: 120, throttle: 1, brake: 0, steer: 0, rpm: 6000, gear: 4 },
        { lapDistPct: 0.99, speedKmh: 90, throttle: 0, brake: 1, steer: 5, rpm: 4000, gear: 2 }
      ]
    },
    ...overrides
  }
}

function telemetryPack(): SharePack {
  return {
    magic: SHARE_PACK_MAGIC,
    version: SHARE_PACK_VERSION,
    kind: 'telemetry',
    id: 'telemetry-1',
    meta: { createdAt: 1_700_000_000_000, sim: 'acc' },
    telemetry: {
      durationSec: 2,
      sampleCount: 2,
      samples: [
        { t: 0, speedKmh: 80, lapDistPct: 0.1, throttle: 0.5, brake: 0, rpm: 4000, gear: 3, steer: 1 },
        { t: 1000, speedKmh: 95, lapDistPct: 0.2 }
      ]
    }
  }
}

function setupPack(): SharePack {
  return {
    magic: SHARE_PACK_MAGIC,
    version: SHARE_PACK_VERSION,
    kind: 'setup',
    id: 'setup-1',
    meta: { createdAt: 1_700_000_000_000, car: 'GT3', track: 'Spa' },
    setup: {
      format: 'sto',
      fileName: 'spa-quali.sto',
      raw: '[Aero]\nWing: 8\n',
      sections: { Aero: { Wing: '8' }, Tires: { Pressure: '27.5' } }
    }
  }
}

describe('serialize/parse round-trip', () => {
  it('round-trips a ghost pack byte-for-byte through serialize → parse', () => {
    const pack = ghostPack()
    expect(parseSharePack(serializeSharePack(pack))).toEqual(pack)
  })

  it('round-trips a telemetry pack', () => {
    const pack = telemetryPack()
    expect(parseSharePack(serializeSharePack(pack))).toEqual(pack)
  })

  it('round-trips a setup pack', () => {
    const pack = setupPack()
    expect(parseSharePack(serializeSharePack(pack))).toEqual(pack)
  })

  it('accepts an already-parsed object as well as a JSON string', () => {
    const pack = ghostPack()
    expect(parseSharePack(pack)).toEqual(pack)
  })

  it('produces indented JSON carrying the magic marker', () => {
    const json = serializeSharePack(ghostPack())
    expect(json).toContain(`"magic": "${SHARE_PACK_MAGIC}"`)
    expect(json).toContain('\n')
  })

  it('drops unknown/garbage extra fields on parse (normalization)', () => {
    const dirty = { ...ghostPack(), somethingExtra: 'nope', meta: { createdAt: 1, evil: true } }
    const parsed = parseSharePack(dirty as unknown)
    expect(parsed).not.toHaveProperty('somethingExtra')
    expect(parsed.meta).not.toHaveProperty('evil')
  })
})

describe('version + structural rejection', () => {
  it('rejects an unsupported (future) version', () => {
    const bad = { ...ghostPack(), version: SHARE_PACK_VERSION + 1 }
    expect(() => parseSharePack(bad as unknown)).toThrow(SharePackError)
    expect(() => parseSharePack(bad as unknown)).toThrow(/version/i)
  })

  it('rejects an old version (0)', () => {
    const bad = { ...ghostPack(), version: 0 }
    expect(() => parseSharePack(bad as unknown)).toThrow(/version/i)
  })

  it('rejects a missing/incorrect magic marker', () => {
    const bad = { ...ghostPack(), magic: 'totally-not-simshare' }
    expect(() => parseSharePack(bad as unknown)).toThrow(/magic/i)
  })

  it('rejects an unknown kind', () => {
    const bad = { ...ghostPack(), kind: 'mystery' }
    expect(() => parseSharePack(bad as unknown)).toThrow(/kind/i)
  })

  it('rejects a missing id', () => {
    const bad = ghostPack()
    delete (bad as Partial<SharePack>).id
    expect(() => parseSharePack(bad as unknown)).toThrow(/id/i)
  })

  it('rejects invalid JSON text', () => {
    expect(() => parseSharePack('{not json')).toThrow(/JSON/i)
  })

  it('rejects a ghost pack with no samples array', () => {
    const bad = { ...ghostPack(), ghost: { sampleCount: 0 } }
    expect(() => parseSharePack(bad as unknown)).toThrow(/samples/i)
  })

  it('rejects meta without a numeric createdAt', () => {
    const bad = { ...ghostPack(), meta: { sim: 'iracing' } }
    expect(() => parseSharePack(bad as unknown)).toThrow(/createdAt/i)
  })

  it('serialize also validates and throws on a malformed pack', () => {
    const bad = { ...ghostPack(), magic: 'x' } as unknown as SharePack
    expect(() => serializeSharePack(bad)).toThrow(SharePackError)
  })

  it('isSharePack is a non-throwing guard', () => {
    expect(isSharePack(ghostPack())).toBe(true)
    expect(isSharePack({ magic: 'nope' })).toBe(false)
    expect(isSharePack(null)).toBe(false)
  })

  it('validateSharePack rejects non-objects', () => {
    expect(() => validateSharePack(42)).toThrow(SharePackError)
    expect(() => validateSharePack(null)).toThrow(SharePackError)
  })
})

describe('buildGhostLap', () => {
  it('resamples a raw cloud onto a uniform grid of GHOST_SAMPLE_COUNT samples', () => {
    const raw: RawGhostSample[] = Array.from({ length: 37 }, (_, i) => ({
      lapDistPct: i / 37,
      speedKmh: 100 + i,
      throttle: 1,
      brake: 0,
      steer: 0
    }))
    const ghost = buildGhostLap(raw, { lapTimeSec: 90 })
    expect(ghost.sampleCount).toBe(GHOST_SAMPLE_COUNT)
    expect(ghost.samples).toHaveLength(GHOST_SAMPLE_COUNT)
    expect(ghost.lapTimeSec).toBe(90)
    // grid centers are strictly ascending in (0,1)
    for (let i = 1; i < ghost.samples.length; i += 1) {
      expect(ghost.samples[i].lapDistPct).toBeGreaterThan(ghost.samples[i - 1].lapDistPct)
    }
    expect(ghost.samples[0].lapDistPct).toBeGreaterThan(0)
    expect(ghost.samples[ghost.samples.length - 1].lapDistPct).toBeLessThan(1)
  })

  it('derives lapTimeSec from currentLapTimeSec span when not given', () => {
    const raw: RawGhostSample[] = [
      { lapDistPct: 0.0, speedKmh: 100, throttle: 1, brake: 0, currentLapTimeSec: 10 },
      { lapDistPct: 0.5, speedKmh: 100, throttle: 1, brake: 0, currentLapTimeSec: 40 },
      { lapDistPct: 0.9, speedKmh: 100, throttle: 1, brake: 0, currentLapTimeSec: 70 }
    ]
    const ghost = buildGhostLap(raw, { gridSize: 8 })
    expect(ghost.lapTimeSec).toBe(60)
  })

  it('omits rpm/gear when the source never carried them, and keeps steer at 0', () => {
    const raw: RawGhostSample[] = [
      { lapDistPct: 0.1, speedKmh: 100, throttle: 1, brake: 0 },
      { lapDistPct: 0.9, speedKmh: 110, throttle: 1, brake: 0 }
    ]
    const ghost = buildGhostLap(raw, { gridSize: 4 })
    expect(ghost.samples[0]).not.toHaveProperty('rpm')
    expect(ghost.samples[0]).not.toHaveProperty('gear')
    expect(ghost.samples[0].steer).toBe(0)
  })

  it('clamps out-of-range inputs and drops non-finite samples', () => {
    const raw: RawGhostSample[] = [
      { lapDistPct: -1, speedKmh: -50, throttle: 2, brake: -3, steer: 0 },
      { lapDistPct: 2, speedKmh: 200, throttle: 5, brake: 9, steer: 0 },
      { lapDistPct: Number.NaN, speedKmh: 100, throttle: 1, brake: 0 }
    ]
    const ghost = buildGhostLap(raw, { gridSize: 4 })
    for (const s of ghost.samples) {
      expect(s.lapDistPct).toBeGreaterThanOrEqual(0)
      expect(s.lapDistPct).toBeLessThanOrEqual(1)
      expect(s.throttle).toBeGreaterThanOrEqual(0)
      expect(s.throttle).toBeLessThanOrEqual(1)
      expect(s.brake).toBeGreaterThanOrEqual(0)
      expect(s.brake).toBeLessThanOrEqual(1)
      expect(s.speedKmh).toBeGreaterThanOrEqual(0)
    }
  })

  it('a freshly built ghost is a valid ghost payload for a pack', () => {
    const raw: RawGhostSample[] = Array.from({ length: 10 }, (_, i) => ({
      lapDistPct: i / 10,
      speedKmh: 120,
      throttle: 1,
      brake: 0
    }))
    const pack = ghostPack({ ghost: buildGhostLap(raw, { lapTimeSec: 75, gridSize: 16 }) })
    expect(() => serializeSharePack(pack)).not.toThrow()
  })
})

describe('compareGhosts', () => {
  function flatGhost(speedKmh: number, lapTimeSec: number): GhostLap {
    return buildGhostLap(
      Array.from({ length: 50 }, (_, i) => ({ lapDistPct: i / 50, speedKmh, throttle: 1, brake: 0 })),
      { lapTimeSec, gridSize: 50 }
    )
  }

  it('reports a near-zero delta for two identical ghosts', () => {
    const ghost = flatGhost(120, 80)
    const result = compareGhosts(ghost, ghost)
    expect(result.bins.length).toBe(GHOST_SAMPLE_COUNT)
    expect(Math.abs(result.totalDeltaSec)).toBeLessThan(1e-6)
    expect(result.gainSec).toBeLessThan(1e-6)
    expect(result.lossSec).toBeLessThan(1e-6)
  })

  it('negative total delta means A (you) is faster than the imported ghost B', () => {
    const fast = flatGhost(120, 80) // A: quicker lap
    const slow = flatGhost(100, 90) // B: slower lap
    const result = compareGhosts(fast, slow)
    expect(result.totalDeltaSec).toBeCloseTo(80 - 90, 5)
    expect(result.totalDeltaSec).toBeLessThan(0)
    expect(result.lapTimeASec).toBe(80)
    expect(result.lapTimeBSec).toBe(90)
    // overall you gained time vs the ghost
    expect(result.gainSec).toBeGreaterThan(result.lossSec)
  })

  it('positive total delta means A is slower than B', () => {
    const result = compareGhosts(flatGhost(100, 90), flatGhost(120, 80))
    expect(result.totalDeltaSec).toBeCloseTo(90 - 80, 5)
    expect(result.lossSec).toBeGreaterThan(result.gainSec)
  })

  it('localizes where A gains vs loses and finds the biggest gain region', () => {
    // A is much faster in the first half, slightly slower in the second half.
    const a = buildGhostLap(
      Array.from({ length: 100 }, (_, i) => ({
        lapDistPct: i / 100,
        speedKmh: i < 50 ? 200 : 90,
        throttle: 1,
        brake: 0
      })),
      { lapTimeSec: 100, gridSize: 100 }
    )
    const b = buildGhostLap(
      Array.from({ length: 100 }, (_, i) => ({
        lapDistPct: i / 100,
        speedKmh: i < 50 ? 100 : 100,
        throttle: 1,
        brake: 0
      })),
      { lapTimeSec: 100, gridSize: 100 }
    )
    const result = compareGhosts(a, b)
    expect(result.gainSec).toBeGreaterThan(0)
    expect(result.lossSec).toBeGreaterThan(0)
    expect(result.bestGain).toBeDefined()
    expect(result.worstLoss).toBeDefined()
    // The biggest gain happens in the fast first half (low lapDistPct).
    expect(result.bestGain!.deltaSec).toBeLessThan(0)
    expect(result.bestGain!.fromPct).toBeLessThan(0.5)
    // The loss happens in the slower second half (high lapDistPct).
    expect(result.worstLoss!.deltaSec).toBeGreaterThan(0)
    expect(result.worstLoss!.toPct).toBeGreaterThan(0.5)
  })

  it('cumulative delta is monotonic across a region where A is uniformly faster', () => {
    const result = compareGhosts(flatGhost(130, 70), flatGhost(100, 90))
    const deltas = result.bins.map((b) => b.deltaSec)
    for (let i = 1; i < deltas.length; i += 1) {
      expect(deltas[i]).toBeLessThanOrEqual(deltas[i - 1] + 1e-9)
    }
    // every bin shows A faster on the speed channel
    expect(result.bins.every((b) => b.speedDeltaKmh > 0)).toBe(true)
  })

  it('returns an empty, safe result when a ghost has too few samples', () => {
    const tiny: GhostLap = { lapTimeSec: 60, sampleCount: 1, samples: [{ lapDistPct: 0.5, speedKmh: 100, throttle: 1, brake: 0, steer: 0 }] }
    const result = compareGhosts(tiny, flatGhost(100, 60))
    expect(result.bins).toHaveLength(0)
    expect(result.totalDeltaSec).toBe(0)
    expect(result.gainSec).toBe(0)
    expect(result.lossSec).toBe(0)
  })
})

describe('summarizeSharePack', () => {
  it('summarizes a ghost pack with its lap time + sample count', () => {
    const summary = summarizeSharePack(ghostPack())
    expect(summary).toMatchObject({ id: 'ghost-1', kind: 'ghost', car: 'MX-5', track: 'Lime Rock', lapTimeSec: 60, sampleCount: 3 })
  })

  it('summarizes a setup pack with section count and no lap time', () => {
    const summary = summarizeSharePack(setupPack())
    expect(summary.kind).toBe('setup')
    expect(summary.sampleCount).toBe(2)
    expect(summary.lapTimeSec).toBeUndefined()
  })

  it('summarizes a telemetry pack sample count', () => {
    const summary = summarizeSharePack(telemetryPack())
    expect(summary.kind).toBe('telemetry')
    expect(summary.sampleCount).toBe(2)
  })
})
