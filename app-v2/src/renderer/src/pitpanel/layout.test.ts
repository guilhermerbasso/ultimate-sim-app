import { describe, expect, it } from 'vitest'
import {
  PIT_MACRO_COLUMNS,
  PIT_SCREEN_HEIGHT_PX,
  PIT_SECTIONS,
  PIT_TOUCH_TARGET_MIN_PX,
  computePitLayout,
  findOverlaps,
  macroButtonWidthPx,
  pitCardInnerWidthPx,
  pitLayoutRowCount,
  rectsOverlap,
  sectionHeightPx
} from './layout'

describe('pit panel layout', () => {
  it('places every section exactly once in the wide (3-col) layout', () => {
    const placements = computePitLayout(3)
    expect(placements).toHaveLength(PIT_SECTIONS.length)
    const ids = placements.map((p) => p.id).sort()
    const expected = PIT_SECTIONS.map((s) => s.id).sort()
    expect(ids).toEqual(expected)
  })

  it('has NO overlapping sections in the wide layout (the IMG_3279 bug)', () => {
    const overlaps = findOverlaps(computePitLayout(3))
    expect(overlaps).toEqual([])
  })

  it('has no overlaps in the single-column stack layout', () => {
    const overlaps = findOverlaps(computePitLayout(1))
    expect(overlaps).toEqual([])
  })

  it('stacks all sections in one column when narrow', () => {
    const placements = computePitLayout(1)
    expect(placements.every((p) => p.column === 1)).toBe(true)
    expect(pitLayoutRowCount(placements)).toBe(PIT_SECTIONS.length)
  })

  it('keeps the wide layout fully packed (8 rows, every column filled)', () => {
    // The taller fuel/chat spans grow the grid from 3 → 8 `1fr` rows. Because the
    // rows are fractional they always fit the 1024×600 panel; content that exceeds
    // a card scrolls inside it (see pitpanel.css), so no card overflows the screen.
    expect(pitLayoutRowCount(computePitLayout(3))).toBe(8)
  })

  it('detects deliberately overlapping rectangles', () => {
    const a = { id: 'fuel' as const, column: 1, row: 1, columnSpan: 2, rowSpan: 2 }
    const b = { id: 'tyres' as const, column: 2, row: 2, columnSpan: 2, rowSpan: 2 }
    expect(findOverlaps([a, b])).toEqual([['fuel', 'tyres']])
  })

  it('treats grid rectangles as half-open (adjacent cells do not overlap)', () => {
    expect(rectsOverlap({ x0: 1, y0: 1, x1: 2, y1: 2 }, { x0: 2, y0: 1, x1: 3, y1: 2 })).toBe(false)
    expect(rectsOverlap({ x0: 1, y0: 1, x1: 3, y1: 2 }, { x0: 2, y0: 1, x1: 4, y1: 2 })).toBe(true)
  })
})

describe('pit panel card heights (fuel CTA above the fold)', () => {
  const placements = computePitLayout(3)
  const rowCount = pitLayoutRowCount(placements)
  // Conservative available grid height: screen minus shell padding + header band.
  const availableHeight = PIT_SCREEN_HEIGHT_PX - 80
  const heightOf = (id: string): number => {
    const p = placements.find((pl) => pl.id === id)!
    return sectionHeightPx(p.rowSpan, rowCount, availableHeight)
  }

  it('gives fuel and chat a taller span than a single equal row', () => {
    const fuel = placements.find((p) => p.id === 'fuel')!
    const chat = placements.find((p) => p.id === 'chat')!
    expect(fuel.rowSpan).toBeGreaterThanOrEqual(3)
    expect(chat.rowSpan).toBeGreaterThanOrEqual(3)
  })

  it('gives fuel and chat room for at least three stacked touch targets', () => {
    // Enough height for e.g. readout + a stepper row + the pinned CTA / macros.
    const minAdequate = 3 * PIT_TOUCH_TARGET_MIN_PX
    expect(heightOf('fuel')).toBeGreaterThanOrEqual(minAdequate)
    expect(heightOf('chat')).toBeGreaterThanOrEqual(minAdequate)
  })

  it('keeps tyres the tallest card and does not starve the replay transport', () => {
    expect(heightOf('tyres')).toBeGreaterThan(heightOf('fuel'))
    // Replay keeps a real 2-row band instead of being squeezed to one row.
    const replay = placements.find((p) => p.id === 'replay')!
    expect(replay.rowSpan).toBeGreaterThanOrEqual(2)
    expect(heightOf('replay')).toBeGreaterThanOrEqual(2 * PIT_TOUCH_TARGET_MIN_PX)
  })
})

describe('pit panel touch targets (≥56px)', () => {
  it('sizes chat macro keys at least 56px wide on the 1/3-width card', () => {
    const width = macroButtonWidthPx(pitCardInnerWidthPx(), PIT_MACRO_COLUMNS)
    expect(width).toBeGreaterThanOrEqual(PIT_TOUCH_TARGET_MIN_PX)
  })

  it('widens each macro key by dropping from 5 → 4 columns', () => {
    const fourCol = macroButtonWidthPx(pitCardInnerWidthPx(), 4)
    const fiveCol = macroButtonWidthPx(pitCardInnerWidthPx(), 5)
    expect(fourCol).toBeGreaterThan(fiveCol)
    expect(fourCol).toBeGreaterThanOrEqual(PIT_TOUCH_TARGET_MIN_PX)
    expect(PIT_MACRO_COLUMNS).toBe(4)
  })
})
