import { describe, expect, it } from 'vitest'
import { ALL_VARIANTS } from '../renderer/src/views/dashboard/widget-catalog-data'
import { dashboardValidationError, type DashboardElementType } from './dashboards'
import {
  buildDashboardFromPhrase,
  buildDashboardFromWidgetIds,
  conceptForElement,
  DASHBOARD_CONCEPT_LIST,
  DEFAULT_WIDGET_IDS,
  detectDetail,
  gridColumns,
  mapPhraseToWidgetIds,
  matchConcepts,
  normalizePhrase,
  packWidgetsIntoGrid,
  resolveWidgetIdForConcept,
  resolveWidgetsByIds,
  type CatalogWidget
} from './dashboard-nl'

// Small fixture so the pure logic is exercised independently of the real catalog.
function widget(id: string, type: DashboardElementType, category: string, extra: Partial<CatalogWidget> = {}): CatalogWidget {
  return { id, type, w: 200, h: 120, style: {}, category, label: id, ...extra }
}

const FIXTURE: CatalogWidget[] = [
  widget('fuelstint', 'fuelstint', 'Fuel', { binding: 'fuelLiters' }),
  widget('positiongaps', 'positiongaps', 'Position/Standings'),
  widget('tyregrid-temp', 'tyregrid', 'Tyres/Brakes'),
  widget('only-fuel', 'value', 'Fuel', { binding: 'fuelPct' }),
  widget('only-weather', 'weather', 'Track/Radar')
]

const catalogIds = new Set(ALL_VARIANTS.map((v) => v.id))

describe('normalizePhrase', () => {
  it('lowercases, strips accents and collapses whitespace', () => {
    expect(normalizePhrase('  Fuel   E   POSIÇÃO ')).toBe('fuel e posicao')
    expect(normalizePhrase('G-Force')).toBe('g-force')
  })
})

describe('detectDetail', () => {
  it('detects elaborate / clean / auto', () => {
    expect(detectDetail('quero um delta detalhado')).toBe('elaborate')
    expect(detectDetail('algo bem clean e minimalista')).toBe('clean')
    expect(detectDetail('fuel e position')).toBe('auto')
  })
})

describe('matchConcepts', () => {
  it('maps PT-BR and EN keywords to the right concepts', () => {
    expect(matchConcepts('fuel')).toContain('fuel')
    expect(matchConcepts('fuel')).toContain('fuel')
    expect(matchConcepts('minha position')).toContain('position')
    expect(matchConcepts('temp de tire')).toContain('tyres')
    expect(matchConcepts('delta')).toContain('delta')
    expect(matchConcepts('gear')).toContain('gear')
    expect(matchConcepts('g-force')).toContain('gforce')
  })

  it('returns concepts in canonical order regardless of phrase order', () => {
    const out = matchConcepts('position, fuel e gear')
    // canonical order: gear (speed group) < fuel < position
    expect(out).toEqual(['gear', 'fuel', 'position'])
  })

  it('returns [] for an empty or unrelated phrase', () => {
    expect(matchConcepts('')).toEqual([])
    expect(matchConcepts('xyzzy qwerty')).toEqual([])
  })
})

describe('resolveWidgetIdForConcept', () => {
  it('prefers explicit preferred ids present in the catalog', () => {
    expect(resolveWidgetIdForConcept('fuel', ALL_VARIANTS)).toBe('fuelstint')
    expect(resolveWidgetIdForConcept('gear', ALL_VARIANTS)).toBe('gearcluster')
  })

  it('honours the detail level by floating the matching suffix', () => {
    expect(resolveWidgetIdForConcept('delta', ALL_VARIANTS, 'elaborate')).toBe('delta-elaborate')
    expect(resolveWidgetIdForConcept('delta', ALL_VARIANTS, 'clean')).toBe('delta-clean')
  })

  it('falls back to a widget in the concept category when no preferred id exists', () => {
    const onlyCategory: CatalogWidget[] = [widget('custom-fuel', 'value', 'Fuel')]
    expect(resolveWidgetIdForConcept('fuel', onlyCategory)).toBe('custom-fuel')
  })

  it('returns undefined when nothing matches', () => {
    expect(resolveWidgetIdForConcept('fuel', [widget('x', 'text', 'Text/Image')])).toBeUndefined()
  })
})

describe('mapPhraseToWidgetIds', () => {
  it('returns only ids that exist in the catalog', () => {
    const ids = mapPhraseToWidgetIds('quero fuel, position e temp de tire', ALL_VARIANTS)
    expect(ids.length).toBeGreaterThanOrEqual(3)
    for (const id of ids) expect(catalogIds.has(id)).toBe(true)
  })

  it('de-duplicates overlapping concepts (position + gaps share positiongaps)', () => {
    const ids = mapPhraseToWidgetIds('position e gap', ALL_VARIANTS)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('respects the max cap', () => {
    const phrase = 'speed gear rpm delta lap fuel tire position radar mapa steering weather'
    const ids = mapPhraseToWidgetIds(phrase, ALL_VARIANTS, { max: 4 })
    expect(ids.length).toBe(4)
  })

  it('returns [] when nothing matches', () => {
    expect(mapPhraseToWidgetIds('nothing relevant here', ALL_VARIANTS)).toEqual([])
  })
})

describe('gridColumns', () => {
  it('computes a near-square grid capped at maxCols', () => {
    expect(gridColumns(1)).toBe(1)
    expect(gridColumns(2)).toBe(2)
    expect(gridColumns(4)).toBe(2)
    expect(gridColumns(5)).toBe(3)
    expect(gridColumns(9)).toBe(3)
    expect(gridColumns(20)).toBe(4)
    expect(gridColumns(20, 6)).toBe(5)
  })
})

describe('packWidgetsIntoGrid', () => {
  function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  }

  it('keeps every widget, inside the canvas, with no overlaps', () => {
    const els = packWidgetsIntoGrid(FIXTURE, { width: 1024, height: 600 })
    expect(els.length).toBe(FIXTURE.length)
    for (const el of els) {
      expect(el.x).toBeGreaterThanOrEqual(0)
      expect(el.y).toBeGreaterThanOrEqual(0)
      expect(el.x + el.w).toBeLessThanOrEqual(1024)
      expect(el.y + el.h).toBeLessThanOrEqual(600)
    }
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        expect(overlaps(els[i], els[j])).toBe(false)
      }
    }
  })

  it('copies type/binding/style and assigns unique ids', () => {
    const els = packWidgetsIntoGrid(FIXTURE)
    expect(els[0].type).toBe('fuelstint')
    expect(els[0].binding).toBe('fuelLiters')
    expect(els[0].style).not.toBe(FIXTURE[0].style)
    expect(new Set(els.map((e) => e.id)).size).toBe(els.length)
  })

  it('preserves overlay widget identities while packing catalog widgets', () => {
    const source = widget('identity-overlay', 'overlaywidget', 'Digital', {
      widgetId: 'hifi:identity-module',
      hifiModuleId: 'identity-module'
    })
    const [element] = packWidgetsIntoGrid([source])
    expect(element).toMatchObject({
      type: 'overlaywidget',
      widgetId: 'hifi:identity-module',
      hifiModuleId: 'identity-module'
    })
  })

  it('returns [] for no widgets', () => {
    expect(packWidgetsIntoGrid([])).toEqual([])
  })
})

describe('resolveWidgetsByIds', () => {
  it('preserves order, de-duplicates and skips unknown ids', () => {
    const out = resolveWidgetsByIds(['positiongaps', 'nope', 'fuelstint', 'positiongaps'], FIXTURE)
    expect(out.map((w) => w.id)).toEqual(['positiongaps', 'fuelstint'])
  })
})

describe('buildDashboardFromWidgetIds', () => {
  it('builds a dashboard whose elements match the resolved ids', () => {
    const dash = buildDashboardFromWidgetIds(['fuelstint', 'positiongaps'], FIXTURE)
    expect(dash.elements.length).toBe(2)
    expect(dash.width).toBe(1024)
    expect(dash.height).toBe(600)
    expect(dash.scaleMode).toBe('fit')
    expect(dash.id).toMatch(/^dash-/)
  })

  it('preserves identities through the real catalog widget-ID generator path', () => {
    const source = ALL_VARIANTS.find((variant) =>
      variant.type === 'overlaywidget' && variant.widgetId?.startsWith('hifi:') && variant.hifiModuleId)
    expect(source).toBeDefined()
    const dashboard = buildDashboardFromWidgetIds([source!.id], ALL_VARIANTS)
    expect(dashboard.elements).toHaveLength(1)
    expect(dashboard.elements[0]).toMatchObject({
      widgetId: source!.widgetId,
      hifiModuleId: source!.hifiModuleId
    })
    expect(dashboardValidationError(dashboard)).toBeNull()
  })
})

describe('buildDashboardFromPhrase', () => {
  it('builds from a real phrase using the real catalog', () => {
    const res = buildDashboardFromPhrase('fuel, position e tire', ALL_VARIANTS)
    expect(res.usedDefault).toBe(false)
    expect(res.widgetIds.length).toBe(res.dashboard.elements.length)
    expect(res.matched).toContain('fuel')
    expect(res.dashboard.name).toContain('AI ·')
    for (const id of res.widgetIds) expect(catalogIds.has(id)).toBe(true)
  })

  it('falls back to the default widget set when nothing matches', () => {
    const res = buildDashboardFromPhrase('zzz nothing zzz', ALL_VARIANTS)
    expect(res.usedDefault).toBe(true)
    expect(res.widgetIds.length).toBeGreaterThan(0)
    const expected = resolveWidgetsByIds(DEFAULT_WIDGET_IDS, ALL_VARIANTS).map((w) => w.id)
    expect(res.widgetIds).toEqual(expected)
  })
})

describe('conceptForElement', () => {
  it('maps by element type', () => {
    expect(conceptForElement({ type: 'fuelstint' })).toBe('fuel')
    expect(conceptForElement({ type: 'gearcluster' })).toBe('gear')
    expect(conceptForElement({ type: 'delta-elaborate' })).toBe('delta')
    expect(conceptForElement({ type: 'pitlimiter-clean' })).toBe('pit')
  })

  it('falls back to the binding for generic widgets', () => {
    expect(conceptForElement({ type: 'value', binding: 'fuelPct' })).toBe('fuel')
    expect(conceptForElement({ type: 'valuebar', binding: 'throttle' })).toBe('inputs')
    expect(conceptForElement({ type: 'value', binding: 'speedKmh' })).toBe('speed')
  })

  it('returns undefined when nothing is inferable', () => {
    expect(conceptForElement({ type: 'rect' })).toBeUndefined()
  })
})

describe('catalog invariants', () => {
  it('every concept resolves to a real catalog widget', () => {
    for (const concept of DASHBOARD_CONCEPT_LIST) {
      const id = resolveWidgetIdForConcept(concept, ALL_VARIANTS)
      expect(id, `concept ${concept} should resolve`).toBeDefined()
      expect(catalogIds.has(id as string)).toBe(true)
    }
  })

  it('the default widget set exists in the catalog', () => {
    for (const id of DEFAULT_WIDGET_IDS) expect(catalogIds.has(id)).toBe(true)
  })
})
