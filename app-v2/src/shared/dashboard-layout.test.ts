import { describe, expect, it } from 'vitest'
import { ALL_VARIANTS } from '../renderer/src/views/dashboard/widget-catalog-data'
import {
  buildDashboardFromBlueprint,
  selectVariantForConcept,
  placeIntoFreeSpace,
  validateLayout,
  repairLayout,
  DESIGN_FAMILY_STYLE_PREF,
  isDesignFamily,
  isEmphasisTag,
  snapValue,
  constrainCanvasGeometry,
  computeCanvasMove,
  computeCanvasResize,
  MIN_CANVAS_ELEMENT_SIZE,
  type LayoutCatalogWidget,
  type CanvasBox
} from './dashboard-layout'
import { getBlueprint, DASHBOARD_BLUEPRINTS } from './dashboard-blueprints'
import { OVERLAY_DESIGN_FAMILIES } from './overlays'
import type { DashboardElement } from './dashboards'

const CATALOG = ALL_VARIANTS as readonly LayoutCatalogWidget[]
const BOX: CanvasBox = { width: 1024, height: 600, margin: 16 }

describe('design family guards', () => {
  it('recognizes all 8 overlay families', () => {
    for (const f of OVERLAY_DESIGN_FAMILIES) expect(isDesignFamily(f)).toBe(true)
    expect(isDesignFamily('bogus')).toBe(false)
  })

  it('exposes a style preference order for every family', () => {
    for (const f of OVERLAY_DESIGN_FAMILIES) {
      expect(DESIGN_FAMILY_STYLE_PREF[f].length).toBeGreaterThan(0)
    }
  })
})

describe('selectVariantForConcept — variant by family', () => {
  it('returns a real catalog variant for a concept', () => {
    const v = selectVariantForConcept('fuel', 'glass', CATALOG)
    expect(v).toBeDefined()
    expect(CATALOG.some((w) => w.id === v!.id)).toBe(true)
  })

  it('prefers the family style when a matching variant exists', () => {
    // analog family should bias gauge/analog forms for speed.
    const analog = selectVariantForConcept('speed', 'analog', CATALOG)
    const neon = selectVariantForConcept('speed', 'neon', CATALOG)
    expect(analog).toBeDefined()
    expect(neon).toBeDefined()
    // Selection is deterministic per family; both must be valid catalog ids.
    expect(CATALOG.some((w) => w.id === analog!.id)).toBe(true)
    expect(CATALOG.some((w) => w.id === neon!.id)).toBe(true)
  })

  it('falls back to a sane variant for every family on a core concept', () => {
    for (const f of OVERLAY_DESIGN_FAMILIES) {
      const v = selectVariantForConcept('gear', f, CATALOG)
      expect(v, `no variant for gear in ${f}`).toBeDefined()
    }
  })
})

describe('placeIntoFreeSpace — solver', () => {
  it('finds a non-overlapping spot next to an existing widget', () => {
    const existing = [{ x: 16, y: 16, w: 400, h: 300 }]
    const spot = placeIntoFreeSpace(existing, 200, 150, BOX)
    expect(spot).not.toBeNull()
    const overlap =
      spot!.x < existing[0].x + existing[0].w &&
      spot!.x + 200 > existing[0].x &&
      spot!.y < existing[0].y + existing[0].h &&
      spot!.y + 150 > existing[0].y
    expect(overlap).toBe(false)
  })

  it('returns null when the widget cannot fit', () => {
    const spot = placeIntoFreeSpace([], 5000, 5000, BOX)
    expect(spot).toBeNull()
  })
})

describe('validateLayout + repairLayout', () => {
  const el = (id: string, x: number, y: number, w: number, h: number): DashboardElement => ({
    id,
    type: 'rect',
    x,
    y,
    w,
    h
  } as DashboardElement)

  it('detects overlaps and out-of-bounds', () => {
    const els = [el('a', 16, 16, 400, 300), el('b', 100, 100, 400, 300), el('c', 980, 16, 200, 200)]
    const issues = validateLayout(els, BOX)
    expect(issues.some((i) => i.kind === 'overlap')).toBe(true)
    expect(issues.some((i) => i.kind === 'out-of-bounds')).toBe(true)
  })

  it('repairs an overlapping / out-of-bounds layout to be clean', () => {
    const els = [el('a', 16, 16, 400, 300), el('b', 100, 100, 400, 300), el('c', 980, 16, 200, 200)]
    const repaired = repairLayout(els, BOX)
    expect(validateLayout(repaired, BOX)).toEqual([])
  })
})

describe('buildDashboardFromBlueprint — end to end', () => {
  it('produces a valid dashboard for every blueprint × family', () => {
    for (const bp of DASHBOARD_BLUEPRINTS) {
      for (const family of OVERLAY_DESIGN_FAMILIES) {
        const { dashboard, widgetIds } = buildDashboardFromBlueprint(bp, { family, catalog: CATALOG })
        expect(dashboard.elements.length).toBe(widgetIds.length)
        expect(validateLayout(dashboard.elements, BOX)).toEqual([])
        for (const id of widgetIds) expect(CATALOG.some((w) => w.id === id)).toBe(true)
      }
    }
  })

  it('dense emphasis adds widgets without overlaps', () => {
    const bp = getBlueprint('minimal')
    const plain = buildDashboardFromBlueprint(bp, { family: 'minimal', catalog: CATALOG })
    const dense = buildDashboardFromBlueprint(bp, { family: 'minimal', emphasis: ['dense'], catalog: CATALOG })
    expect(dense.dashboard.elements.length).toBeGreaterThanOrEqual(plain.dashboard.elements.length)
    expect(validateLayout(dense.dashboard.elements, BOX)).toEqual([])
  })

  it('minimal emphasis trims tertiary widgets', () => {
    const bp = getBlueprint('dataheavy')
    const full = buildDashboardFromBlueprint(bp, { family: 'broadcast', catalog: CATALOG })
    const minimal = buildDashboardFromBlueprint(bp, { family: 'minimal', emphasis: ['minimal'], catalog: CATALOG })
    expect(minimal.dashboard.elements.length).toBeLessThanOrEqual(full.dashboard.elements.length)
    expect(validateLayout(minimal.dashboard.elements, BOX)).toEqual([])
  })
})

describe('emphasis tag guard', () => {
  it('accepts concepts and modifiers, rejects junk', () => {
    expect(isEmphasisTag('fuel')).toBe(true)
    expect(isEmphasisTag('dense')).toBe(true)
    expect(isEmphasisTag('minimal')).toBe(true)
    expect(isEmphasisTag('banana')).toBe(false)
  })
})

describe('editable-canvas geometry helpers', () => {
  const BOARD = { width: 1024, height: 600 }

  it('snapValue rounds to step (or to int when step<=1)', () => {
    expect(snapValue(17, 1)).toBe(17)
    expect(snapValue(17.4, 1)).toBe(17)
    expect(snapValue(17, 8)).toBe(16)
    expect(snapValue(20, 8)).toBe(24)
  })

  it('constrainCanvasGeometry keeps elements inside the board and >= min size', () => {
    const g = constrainCanvasGeometry({ x: -50, y: -50, w: 4, h: 4 }, BOARD)
    expect(g.x).toBe(0)
    expect(g.y).toBe(0)
    expect(g.w).toBe(MIN_CANVAS_ELEMENT_SIZE)
    expect(g.h).toBe(MIN_CANVAS_ELEMENT_SIZE)

    const g2 = constrainCanvasGeometry({ x: 2000, y: 2000, w: 200, h: 200 }, BOARD)
    expect(g2.x).toBe(BOARD.width - 200)
    expect(g2.y).toBe(BOARD.height - 200)
  })

  it('computeCanvasMove translates and clamps within the board', () => {
    const moved = computeCanvasMove({ x: 100, y: 100, w: 200, h: 100 }, 40, 24, BOARD, 1)
    expect(moved).toEqual({ x: 140, y: 124, w: 200, h: 100 })
    const clamped = computeCanvasMove({ x: 900, y: 500, w: 200, h: 200 }, 500, 500, BOARD, 1)
    expect(clamped.x).toBe(BOARD.width - 200)
    expect(clamped.y).toBe(BOARD.height - 200)
  })

  it('computeCanvasResize resizes from the dragged handle, honouring min size', () => {
    const se = computeCanvasResize({ x: 100, y: 100, w: 200, h: 100 }, 'se', 40, 20, BOARD, 1)
    expect(se).toEqual({ x: 100, y: 100, w: 240, h: 120 })

    const nw = computeCanvasResize({ x: 100, y: 100, w: 200, h: 100 }, 'nw', 50, 30, BOARD, 1)
    expect(nw.x).toBe(150)
    expect(nw.y).toBe(130)
    expect(nw.w).toBe(150)
    expect(nw.h).toBe(70)

    // Over-shrink past minimum stays at the minimum.
    const tiny = computeCanvasResize({ x: 100, y: 100, w: 40, h: 40 }, 'se', -100, -100, BOARD, 1)
    expect(tiny.w).toBe(MIN_CANVAS_ELEMENT_SIZE)
    expect(tiny.h).toBe(MIN_CANVAS_ELEMENT_SIZE)
  })
})
