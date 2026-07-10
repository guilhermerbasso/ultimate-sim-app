import { describe, expect, it } from 'vitest'
import type { Corner } from '../main/track-map/corner-map'
import {
  buildTrackCatalog,
  equalSectorStarts,
  isValidTrackCatalog,
  locate,
  sectorOfPct,
  type TrackCatalog
} from './track-catalog'

function corner(index: number, startPct: number, apexPct: number, endPct: number): Corner {
  return {
    index,
    startPct,
    apexPct,
    endPct,
    minSpeedKmh: 100,
    entrySpeedKmh: 150,
    exitSpeedKmh: 160
  }
}

describe('sectorOfPct', () => {
  it('honours official uneven sector start fractions', () => {
    const starts = [0, 0.35, 0.65]
    expect(sectorOfPct(0.1, starts)).toBe(1)
    expect(sectorOfPct(0.5, starts)).toBe(2)
    expect(sectorOfPct(0.8, starts)).toBe(3)
  })

  it('falls back to equal thirds for empty sector starts', () => {
    expect(sectorOfPct(0.1, [])).toBe(1)
    expect(sectorOfPct(0.5, [])).toBe(2)
    expect(sectorOfPct(0.8, [])).toBe(3)
  })

  it('sorts starts and wraps lap-distance values', () => {
    expect(sectorOfPct(1.1, [0.65, 0, 0.35])).toBe(1)
    expect(sectorOfPct(-0.2, [0.65, 0, 0.35])).toBe(3)
  })
})

describe('buildTrackCatalog', () => {
  it('maps each turn apex to its official sector', () => {
    const catalog = buildTrackCatalog('Road Atlanta', [corner(13, 0.76, 0.8, 0.84)], [0, 0.35, 0.65], undefined, 123)

    expect(catalog.trackLayoutKey).toBe('Road Atlanta')
    expect(catalog.generatedAt).toBe(123)
    expect(catalog.corners[0]).toMatchObject({ turn: 13, apexPct: 0.8, sector: 3 })
  })
})

describe('locate', () => {
  const catalog = buildTrackCatalog(
    'Interlagos',
    [corner(1, 0.05, 0.1, 0.15), corner(13, 0.76, 0.8, 0.84)],
    [0, 0.35, 0.65],
    'GP',
    456
  )

  it('returns turn and sector inside a corner extent', () => {
    expect(locate(catalog, 0.79)).toEqual({ turn: 13, sector: 3 })
  })

  it('returns only the sector on a straight', () => {
    const result = locate(catalog, 0.5)
    expect(result.turn).toBeUndefined()
    expect(result.sector).toBe(2)
  })
})

describe('isValidTrackCatalog', () => {
  const valid: TrackCatalog = buildTrackCatalog('Spa', [corner(1, 0.1, 0.12, 0.15)], equalSectorStarts(3), undefined, 789)

  it('accepts a valid persisted catalog shape', () => {
    expect(isValidTrackCatalog(valid)).toBe(true)
  })

  it('rejects invalid persisted catalog shapes', () => {
    expect(isValidTrackCatalog(null)).toBe(false)
    expect(isValidTrackCatalog({ ...valid, version: 2 })).toBe(false)
    expect(isValidTrackCatalog({ ...valid, corners: [{ ...valid.corners[0], sector: 0 }] })).toBe(false)
    expect(isValidTrackCatalog({ ...valid, sectorStartsPct: [0, Number.NaN] })).toBe(false)
  })
})
