import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WidgetGallery, WidgetMini } from './widget-catalog'
import {
  ALL_VARIANTS,
  GT3_PANEL,
  GT3_STROKE,
  NEW_VARIANTS,
  NEW_WIDGET_KINDS,
  WIDGET_CATALOG,
  filterHiddenVariants,
  partitionByAdvanced,
  variantToElement,
  type NormalizedVariant
} from './widget-catalog-data'
import {
  WIDGET_CATEGORY_ORDER,
  WIDGET_CLUSTER_LABELS,
  WIDGET_CLUSTER_ORDER,
  WIDGET_STYLE_ORDER,
  availableCategories,
  availableClusters,
  availableStyles,
  filterVariants,
  groupVariantsByCategory,
  groupVariantsByCluster,
  matchesQuery,
  type WidgetTaxon
} from '../../../../shared/widget-taxonomy'
import { sanitizeCustomOverlayWidget } from '../../../../shared/overlays'

describe('filterHiddenVariants', () => {
  it('removes hidden catalog entries and restores them when the id leaves the set', () => {
    const sample = ALL_VARIANTS.slice(0, 3)
    const hidden = new Set([sample[1].id])
    expect(filterHiddenVariants(sample, hidden).map((variant) => variant.id)).toEqual([sample[0].id, sample[2].id])
    hidden.delete(sample[1].id)
    expect(filterHiddenVariants(sample, hidden)).toHaveLength(3)
  })
})

describe('round-7 new widget variants', () => {
  it('adds at least 50 brand-new variants', () => {
    expect(NEW_VARIANTS.length).toBeGreaterThanOrEqual(50)
  })

  it('every new variant has a unique id, a category and a style', () => {
    const ids = new Set<string>()
    for (const v of NEW_VARIANTS) {
      expect(v.id, `duplicate id ${v.id}`).not.toBe('')
      expect(ids.has(v.id), `duplicate id ${v.id}`).toBe(false)
      ids.add(v.id)
      expect(WIDGET_CATEGORY_ORDER).toContain(v.category)
      expect(WIDGET_STYLE_ORDER).toContain(v.styleFamily)
      expect(v.w).toBeGreaterThan(0)
      expect(v.h).toBeGreaterThan(0)
    }
  })

  it('exercises every new widget KIND at least once', () => {
    const usedTypes = new Set(NEW_VARIANTS.map((v) => v.type))
    for (const kind of NEW_WIDGET_KINDS) {
      expect(usedTypes.has(kind), `no variant uses kind ${kind}`).toBe(true)
    }
  })

  it('covers all the required style families', () => {
    const styles = new Set(NEW_VARIANTS.map((v) => v.styleFamily))
    for (const fam of ['analog', 'digital', 'clean', 'graph', 'chart', 'bar', 'ring', 'led', 'heatmap', 'status'] as const) {
      expect(styles.has(fam), `missing style family ${fam}`).toBe(true)
    }
  })

  it('produces a valid DashboardElement for every new kind via variantToElement', () => {
    for (const kind of NEW_WIDGET_KINDS) {
      const variant = NEW_VARIANTS.find((v) => v.type === kind)
      expect(variant, `no variant for kind ${kind}`).toBeTruthy()
      if (!variant) continue
      const el = variantToElement(variant, 12, 34)
      expect(el.id).toMatch(/^el-/)
      expect(el.type).toBe(kind)
      expect(el.x).toBe(12)
      expect(el.y).toBe(34)
      expect(el.w).toBe(variant.w)
      expect(el.h).toBe(variant.h)
      expect(el.binding).toBe(variant.binding)
      expect(el.name).toBe(variant.label)
      expect(typeof el.style).toBe('object')
      // The copied style must be a distinct object (no shared mutable reference).
      expect(el.style).not.toBe(variant.style)
    }
  })
})

describe('catalog categorization (new + existing)', () => {
  it('every catalog variant ends up with a valid category and style', () => {
    expect(ALL_VARIANTS.length).toBeGreaterThan(0)
    for (const v of ALL_VARIANTS) {
      expect(WIDGET_CATEGORY_ORDER, `bad category on ${v.id}`).toContain(v.category)
      expect(WIDGET_STYLE_ORDER, `bad style on ${v.id}`).toContain(v.styleFamily)
    }
  })

  it('represents all 12 categories at least once', () => {
    const cats = new Set(ALL_VARIANTS.map((v) => v.category))
    for (const c of WIDGET_CATEGORY_ORDER) {
      expect(cats.has(c), `category not represented: ${c}`).toBe(true)
    }
  })

  it('keeps variant ids unique across the whole catalog', () => {
    const ids = ALL_VARIANTS.map((v) => v.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('flattens exactly the WIDGET_CATALOG groups into ALL_VARIANTS', () => {
    const flat = WIDGET_CATALOG.reduce((n, g) => n + g.variants.length, 0)
    expect(ALL_VARIANTS.length).toBe(flat)
  })
})

describe('rich-overlay catalog identity contract', () => {
  const elements = ALL_VARIANTS.map((variant) => variantToElement(variant, 0, 0))
  const withWidgetId = elements.filter((element) => typeof element.widgetId === 'string')
  const withHifiModuleId = elements.filter((element) => typeof element.hifiModuleId === 'string')

  // N/N manifest gate: count changes require intentional manifest review.
  // Revised from 862 to 863 by the RaceCon RC-02 full-frame preset.
  // Revised from 863 to 864 by the RaceCon RC-04 full-frame preset.
  // Revised from 864 to 865 by the RaceCon RC-05 full-frame preset.
  // Revised from 865 to 866 by the RaceCon RC-06 full-frame preset.
  // Revised from 866 to 867 by the RaceCon RC-07 full-frame preset.
  it('contains exactly 867 widgetId and 838 hifiModuleId variants', () => {
    expect(withWidgetId).toHaveLength(867)
    expect(withHifiModuleId).toHaveLength(838)
  })

  it('preserves every catalog identity through variantToElement and sanitization', () => {
    expect(withWidgetId.map((element) => sanitizeCustomOverlayWidget(element)?.widgetId))
      .toEqual(withWidgetId.map((element) => element.widgetId))
    expect(withHifiModuleId.map((element) => sanitizeCustomOverlayWidget(element)?.hifiModuleId))
      .toEqual(withHifiModuleId.map((element) => element.hifiModuleId))
  })
})

describe('widget preview thumbnails', () => {
  it('renders a non-empty preview container for every catalog variant', () => {
    for (const variant of ALL_VARIANTS) {
      const markup = renderToStaticMarkup(createElement(WidgetMini, { variant }))
      expect(markup, `${variant.id} did not render a preview root`).toContain('data-widget-preview="true"')
      expect(
        markup.includes('data-widget-preview-live="true"') || markup.includes('data-widget-preview-fallback='),
        `${variant.id} rendered neither a live preview nor a fallback`
      ).toBe(true)
      expect(markup.length, `${variant.id} rendered an unexpectedly tiny preview`).toBeGreaterThan(180)
    }
  }, 15_000)

  it('uses a representative dashboard glyph for overlay-widget variants instead of a blank label tile', () => {
    const overlay = ALL_VARIANTS.find((variant) => variant.type === 'overlaywidget')
    expect(overlay).toBeTruthy()
    if (!overlay) return

    const markup = renderToStaticMarkup(createElement(WidgetMini, { variant: overlay }))
    expect(markup).toContain('data-widget-preview-fallback="overlaywidget"')
    expect(markup).toContain('data-widget-preview-glyph="dashboard"')
  })
})

// ─── Pure search/filter logic ────────────────────────────────────────────────
const SAMPLE: WidgetTaxon[] = [
  { id: 'a', label: 'Speed dial', category: 'Speed/Engine', styleFamily: 'analog', tags: ['speed', 'needle'] },
  { id: 'b', label: 'RPM ring', category: 'Speed/Engine', styleFamily: 'ring', tags: ['rpm'] },
  { id: 'c', label: 'Fuel donut', category: 'Fuel', styleFamily: 'chart', tags: ['fuel', 'pie'] },
  { id: 'd', label: 'Throttle sparkline', category: 'Inputs', styleFamily: 'graph', tags: ['throttle', 'sparkline'] },
  { id: 'e', label: 'Tyre heatmap', category: 'Tyres/Brakes', styleFamily: 'heatmap', tags: ['tyre', 'temp'] }
]

describe('filterVariants / matchesQuery', () => {
  it('returns everything for an empty query', () => {
    expect(filterVariants(SAMPLE, {})).toHaveLength(SAMPLE.length)
    expect(filterVariants(SAMPLE, { search: '   ' })).toHaveLength(SAMPLE.length)
  })

  it('matches the free-text search against label (case-insensitive)', () => {
    const out = filterVariants(SAMPLE, { search: 'DIAL' })
    expect(out.map((v) => v.id)).toEqual(['a'])
  })

  it('matches the category name in the free-text search', () => {
    // "speed" hits both the label of `a` and the Speed/Engine category of `a`+`b`.
    expect(filterVariants(SAMPLE, { search: 'speed' }).map((v) => v.id)).toEqual(['a', 'b'])
  })

  it('matches against tags', () => {
    const out = filterVariants(SAMPLE, { search: 'sparkline' })
    expect(out.map((v) => v.id)).toEqual(['d'])
  })

  it('matches against category and style names', () => {
    expect(filterVariants(SAMPLE, { search: 'fuel' }).map((v) => v.id)).toEqual(['c'])
    expect(filterVariants(SAMPLE, { search: 'heatmap' }).map((v) => v.id)).toEqual(['e'])
  })

  it('applies AND semantics across multiple tokens', () => {
    expect(filterVariants(SAMPLE, { search: 'speed needle' }).map((v) => v.id)).toEqual(['a'])
    expect(filterVariants(SAMPLE, { search: 'speed donut' })).toHaveLength(0)
  })

  it('filters by category facet', () => {
    expect(filterVariants(SAMPLE, { category: 'Speed/Engine' }).map((v) => v.id)).toEqual(['a', 'b'])
  })

  it('filters by style facet', () => {
    expect(filterVariants(SAMPLE, { styleFamily: 'graph' }).map((v) => v.id)).toEqual(['d'])
  })

  it('combines facets and search (intersection)', () => {
    expect(filterVariants(SAMPLE, { category: 'Speed/Engine', styleFamily: 'ring' }).map((v) => v.id)).toEqual(['b'])
    expect(filterVariants(SAMPLE, { category: 'Speed/Engine', search: 'rpm' }).map((v) => v.id)).toEqual(['b'])
    expect(filterVariants(SAMPLE, { category: 'Fuel', styleFamily: 'analog' })).toHaveLength(0)
  })

  it('matchesQuery agrees with filterVariants', () => {
    const q = { search: 'tyre' }
    expect(SAMPLE.filter((v) => matchesQuery(v, q))).toEqual(filterVariants(SAMPLE, q))
  })
})

describe('groupVariantsByCategory', () => {
  it('groups in canonical category order and drops empties', () => {
    const sections = groupVariantsByCategory(SAMPLE)
    expect(sections.map((s) => s.category)).toEqual(['Speed/Engine', 'Fuel', 'Tyres/Brakes', 'Inputs'])
    expect(sections[0].variants.map((v) => v.id)).toEqual(['a', 'b'])
  })

  it('preserves the total count and never emits empty sections', () => {
    const sections = groupVariantsByCategory(ALL_VARIANTS as NormalizedVariant[])
    const total = sections.reduce((n, s) => n + s.variants.length, 0)
    expect(total).toBe(ALL_VARIANTS.length)
    for (const s of sections) expect(s.variants.length).toBeGreaterThan(0)
  })
})

describe('available facet helpers', () => {
  it('lists only categories/styles that actually appear, in canonical order', () => {
    const cats = availableCategories(ALL_VARIANTS)
    expect(cats).toEqual(WIDGET_CATEGORY_ORDER.filter((c) => cats.includes(c)))
    const styles = availableStyles(ALL_VARIANTS)
    expect(styles).toEqual(WIDGET_STYLE_ORDER.filter((s) => styles.includes(s)))
    expect(styles).toContain('analog')
    expect(styles).toContain('digital')
    expect(styles).toContain('graph')
    expect(styles).toContain('chart')
  })
})

// ─── Catalog redesign: curated-first, warm chrome, matte surfaces, DSEG ───────
describe('catalog redesign — surfaces & typography', () => {
  it('uses matte-black panels and a hairline stroke (not blue-gray)', () => {
    expect(GT3_PANEL).toBe('#000000')
    expect(GT3_STROKE).toBe('#1F1F1F')
  })

  it('no catalog variant pins the value font to Segoe UI (numerals fall to DSEG)', () => {
    // Covers both gt3() and irValueStyle() dropping the fontFamily default.
    for (const v of ALL_VARIANTS) {
      const ff = (v.style as { fontFamily?: string }).fontFamily
      expect(ff, `${v.id} still sets a fontFamily (${ff})`).toBeUndefined()
    }
  })

  it('the raw iRacing channel tiles specifically drop Segoe UI', () => {
    const speed = ALL_VARIANTS.find((v) => v.id === 'ir-Speed')
    expect(speed).toBeTruthy()
    expect((speed?.style as { fontFamily?: string }).fontFamily).toBeUndefined()
  })
})

describe('catalog redesign — advanced demotion of raw iRacing channels', () => {
  const { curated, advanced } = partitionByAdvanced(ALL_VARIANTS)

  it('flags every raw iRacing channel tile as advanced (≈201 of them)', () => {
    // Every advanced variant is an ir-* channel binding ir:<id>.
    for (const v of advanced) {
      expect(v.advanced).toBe(true)
      expect(v.id.startsWith('ir-')).toBe(true)
      expect(v.binding?.startsWith('ir:')).toBe(true)
    }
    expect(advanced.length).toBeGreaterThanOrEqual(180)
  })

  it('keeps curated GT3 widgets out of the advanced bucket', () => {
    const curatedIds = new Set(curated.map((v) => v.id))
    for (const id of ['shiftbar-18', 'gearcluster', 'deltatile', 'speed-clean', 'tyres-clean']) {
      expect(curatedIds.has(id), `${id} should be curated, not advanced`).toBe(true)
    }
    for (const v of curated) expect(v.advanced ?? false).toBe(false)
  })

  it('marks the generated channel groups (not the curated groups) as advanced', () => {
    const advancedGroups = WIDGET_CATALOG.filter((g) => g.advanced)
    expect(advancedGroups.length).toBeGreaterThan(0)
    for (const g of advancedGroups) {
      expect(g.id.startsWith('ir-')).toBe(true)
      for (const v of g.variants) expect(v.advanced).toBe(true)
    }
    // Curated/featured groups stay primary.
    expect(WIDGET_CATALOG.find((g) => g.id === 'gt3')?.advanced ?? false).toBe(false)
    expect(WIDGET_CATALOG.find((g) => g.id === 'curated-core')?.advanced ?? false).toBe(false)
  })

  it('reaches every variant via curated ∪ advanced (nothing deleted)', () => {
    expect(curated.length + advanced.length).toBe(ALL_VARIANTS.length)
  })
})

describe('catalog redesign — hardware/use-case clusters', () => {
  it('exposes the Full-Frame + DDU cluster taxonomy', () => {
    expect(WIDGET_CLUSTER_ORDER).toContain('Full-Frame Dashboards')
    expect(WIDGET_CLUSTER_ORDER).toContain('DDU / Cluster')
    expect(WIDGET_CLUSTER_ORDER).toContain('Tell-tales / Warning lamps')
  })

  it('tags curated widgets with real-cluster groupings', () => {
    const byId = new Map(ALL_VARIANTS.map((v) => [v.id, v]))
    expect(byId.get('shiftbar-18')?.cluster).toBe('DDU / Cluster')
    expect(byId.get('deltatile')?.cluster).toBe('Timing / Delta')
    expect(byId.get('fuelstint')?.cluster).toBe('Stint / Endurance')
    expect(byId.get('tyregrid-temp')?.cluster).toBe('Tyre / Brake')
  })

  it('groups by cluster in canonical order and only over clustered variants', () => {
    const sections = groupVariantsByCluster(ALL_VARIANTS)
    expect(sections.length).toBeGreaterThan(0)
    const order = sections.map((s) => s.cluster)
    expect(order).toEqual(WIDGET_CLUSTER_ORDER.filter((c) => order.includes(c)))
    const clusters = availableClusters(ALL_VARIANTS)
    expect(clusters.length).toBeGreaterThan(0)
  })
})

describe('catalog redesign — warm-chrome accents & standard shift zones', () => {
  it('keeps decorative iRacing channel accents warm (no cool/green/teal/purple/blue)', () => {
    const { advanced } = partitionByAdvanced(ALL_VARIANTS)
    const coolDecorative = new Set(['#00E7FF', '#2FFF67', '#35F2B8', '#A86BFF', '#158BFF'])
    for (const v of advanced) {
      const accent = (v.style as { accentColor?: string }).accentColor
      if (accent) expect(coolDecorative.has(accent), `${v.id} uses cool accent ${accent}`).toBe(false)
    }
  })

  it('adds a shiftbar LedShiftBar variant with standard green→amber→red zones (no blue fill)', () => {
    const byId = new Map(ALL_VARIANTS.map((v) => [v.id, v]))
    const shiftbar = byId.get('shiftbar-led')
    expect(shiftbar?.type).toBe('shiftbar')
    const legacy = byId.get('shiftlights')
    expect(legacy).toBeTruthy()
    const fill = (legacy?.style as { fillColor?: string }).fillColor
    expect(fill).toBe('#2FFF67') // standard green base, not the old #3ea0ff blue
    expect((legacy?.style as { warnColor?: string }).warnColor).toBe('#FFB000')
    expect((legacy?.style as { dangerColor?: string }).dangerColor).toBe('#FF2436')
  })
})

describe('WidgetGallery — curated-first, advanced collapsed', () => {
  function render(): string {
    return renderToStaticMarkup(createElement(WidgetGallery, { onAdd: () => {} }))
  }

  it('leads with the featured "Curated GT3" section and a yes filter row', () => {
    const html = render()
    expect(html).toContain('Curated GT3')
    expect(html).toContain('Sim') // per-yes coverage filter preserved
  })

  it('demotes the raw channels behind a collapsed "Canais iRacing avancados" accordion', () => {
    const html = render()
    expect(html).toContain('Canais iRacing avancados')
    // Collapsed by default: an iRacing-only raw channel (StrengthOfField) is not
    // rendered until the accordion is expanded — so the wall of tiles is hidden.
    expect(html).not.toContain('StrengthOfField')
  })
})

// ─── A2: cluster-driven gallery (the QA blocker — was dormant) ────────────────
describe('catalog — curated widgets sectioned by hardware cluster', () => {
  const { curated } = partitionByAdvanced(ALL_VARIANTS)

  it('groups curated widgets by cluster (a known variant lands under its cluster)', () => {
    const sections = groupVariantsByCluster(curated)
    const byCluster = new Map(sections.map((s) => [s.cluster, s.variants.map((v) => v.id)]))
    // shiftbar-18 → DDU / Cluster, fuelstint → Stint / Endurance, tyregrid-temp → Tyre / Brake.
    expect(byCluster.get('DDU / Cluster')).toContain('shiftbar-18')
    expect(byCluster.get('Stint / Endurance')).toContain('fuelstint')
    expect(byCluster.get('Tyre / Brake')).toContain('tyregrid-temp')
    // Sections are emitted in canonical cluster order.
    const order = sections.map((s) => s.cluster)
    expect(order).toEqual(WIDGET_CLUSTER_ORDER.filter((c) => order.includes(c)))
  })

  it('availableClusters drives the chip row and includes Full-Frame Dashboards', () => {
    const clusters = availableClusters(ALL_VARIANTS)
    expect(clusters).toEqual(WIDGET_CLUSTER_ORDER.filter((c) => clusters.includes(c)))
    expect(clusters).toContain('Full-Frame Dashboards')
    expect(clusters).toContain('DDU / Cluster')
    // The rendered gallery surfaces a Cluster chip row + the cluster section headers.
    const html = renderToStaticMarkup(createElement(WidgetGallery, { onAdd: () => {} }))
    expect(html).toContain('Cluster')
    expect(html).toContain(WIDGET_CLUSTER_LABELS['Full-Frame Dashboards'])
    expect(html).toContain(WIDGET_CLUSTER_LABELS['DDU / Cluster'])
  })

  it("the 'Full-Frame Dashboards' cluster is non-empty (the overlay presets)", () => {
    const fullFrame = curated.filter((v) => v.cluster === 'Full-Frame Dashboards')
    // Intentional manifest revision: 13 to 14 by the RaceCon RC-04 full-frame preset.
    // Intentional manifest revision: 14 to 15 by the RaceCon RC-05 full-frame preset.
    // Intentional manifest revision: 15 to 16 by the RaceCon RC-06 full-frame preset.
    // Intentional manifest revision: 16 to 17 by the RaceCon RC-07 full-frame preset.
    expect(fullFrame.length).toBe(17)
    for (const v of fullFrame) {
      expect(v.type).toBe('overlaywidget')
      expect(v.widgetId, `${v.id} missing widgetId`).toBeTruthy()
      // Every full-frame dashboard must declare at least one supported live sim.
      expect((v as NormalizedVariant).supportedSims.length).toBeGreaterThan(0)
    }
    const section = groupVariantsByCluster(curated).find((s) => s.cluster === 'Full-Frame Dashboards')
    expect(section?.variants.length).toBe(17)
  })

  it('surfaces RaceCon RC-01 in the full-frame gallery and search taxonomy', () => {
    const rc01 = ALL_VARIANTS.find((variant) => variant.id === 'dash-racecon_rc01_dash')
    expect(rc01).toMatchObject({
      type: 'overlaywidget',
      widgetId: 'raceconRc01Dash',
      cluster: 'Full-Frame Dashboards'
    })
    expect(matchesQuery(rc01!, { search: 'rc-01' })).toBe(true)
    expect(matchesQuery(rc01!, { search: 'racecon' })).toBe(true)
    expect(rc01!.supportedSims).toEqual(['iracing', 'acc', 'ams2'])
    expect(variantToElement(rc01!, 0, 0).widgetId).toBe('raceconRc01Dash')
  })

  it('surfaces RaceCon RC-02 in the full-frame gallery and search taxonomy', () => {
    const rc02 = ALL_VARIANTS.find((variant) => variant.id === 'dash-racecon_rc02_dash')
    expect(rc02).toMatchObject({
      type: 'overlaywidget',
      widgetId: 'raceconRc02Dash',
      cluster: 'Full-Frame Dashboards'
    })
    expect(matchesQuery(rc02!, { search: 'rc-02' })).toBe(true)
    expect(matchesQuery(rc02!, { search: 'racecon' })).toBe(true)
    expect(matchesQuery(rc02!, { search: 'qualifying' })).toBe(true)
    // RC-02 refuses mock/replay telemetry, so it is identity-scoped exactly like RC-01.
    expect(rc02!.supportedSims).toEqual(['iracing', 'acc', 'ams2'])
    expect(variantToElement(rc02!, 0, 0).widgetId).toBe('raceconRc02Dash')
  })

  it('surfaces RaceCon RC-04 in the full-frame gallery and search taxonomy', () => {
    const rc04 = ALL_VARIANTS.find((variant) => variant.id === 'dash-racecon_rc04_dash')
    expect(rc04).toMatchObject({
      type: 'overlaywidget',
      widgetId: 'raceconRc04Dash',
      cluster: 'Full-Frame Dashboards'
    })
    expect(matchesQuery(rc04!, { search: 'rc-04' })).toBe(true)
    expect(matchesQuery(rc04!, { search: 'racecon' })).toBe(true)
    expect(matchesQuery(rc04!, { search: 'pit' })).toBe(true)
    // RC-04 refuses mock/replay telemetry, so it is identity-scoped exactly like RC-01.
    expect(rc04!.supportedSims).toEqual(['iracing', 'acc', 'ams2'])
    expect(variantToElement(rc04!, 0, 0).widgetId).toBe('raceconRc04Dash')
  })

  it('surfaces RaceCon RC-05 in the full-frame gallery and search taxonomy', () => {
    const rc05 = ALL_VARIANTS.find((variant) => variant.id === 'dash-racecon_rc05_dash')
    expect(rc05).toMatchObject({
      type: 'overlaywidget',
      widgetId: 'raceconRc05Dash',
      cluster: 'Full-Frame Dashboards'
    })
    expect(matchesQuery(rc05!, { search: 'rc-05' })).toBe(true)
    expect(matchesQuery(rc05!, { search: 'racecon' })).toBe(true)
    expect(matchesQuery(rc05!, { search: 'tyres' })).toBe(true)
    // RC-05 refuses mock/replay telemetry, so it is identity-scoped exactly like RC-01.
    expect(rc05!.supportedSims).toEqual(['iracing', 'acc', 'ams2'])
    expect(variantToElement(rc05!, 0, 0).widgetId).toBe('raceconRc05Dash')
  })

  it('surfaces RaceCon RC-06 in the full-frame gallery and search taxonomy', () => {
    const rc06 = ALL_VARIANTS.find((variant) => variant.id === 'dash-racecon_rc06_dash')
    expect(rc06).toMatchObject({
      type: 'overlaywidget',
      widgetId: 'raceconRc06Dash',
      cluster: 'Full-Frame Dashboards'
    })
    expect(matchesQuery(rc06!, { search: 'rc-06' })).toBe(true)
    expect(matchesQuery(rc06!, { search: 'racecon' })).toBe(true)
    expect(matchesQuery(rc06!, { search: 'fuel' })).toBe(true)
    // RC-06 refuses mock/replay telemetry, so it is identity-scoped exactly like RC-01.
    expect(rc06!.supportedSims).toEqual(['iracing', 'acc', 'ams2'])
    expect(variantToElement(rc06!, 0, 0).widgetId).toBe('raceconRc06Dash')
  })

  it('surfaces RaceCon RC-07 in the full-frame gallery and search taxonomy', () => {
    const rc07 = ALL_VARIANTS.find((variant) => variant.id === 'dash-racecon_rc07_dash')
    expect(rc07).toMatchObject({
      type: 'overlaywidget',
      widgetId: 'raceconRc07Dash',
      cluster: 'Full-Frame Dashboards'
    })
    expect(matchesQuery(rc07!, { search: 'rc-07' })).toBe(true)
    expect(matchesQuery(rc07!, { search: 'racecon' })).toBe(true)
    expect(matchesQuery(rc07!, { search: 'radar' })).toBe(true)
    expect(matchesQuery(rc07!, { search: 'traffic' })).toBe(true)
    // RC-07 refuses mock/replay telemetry, so it is identity-scoped exactly like RC-01.
    expect(rc07!.supportedSims).toEqual(['iracing', 'acc', 'ams2'])
    expect(variantToElement(rc07!, 0, 0).widgetId).toBe('raceconRc07Dash')
  })

  it('full-frame variants carry their widgetId through variantToElement', () => {
    const ff = ALL_VARIANTS.find((v) => v.cluster === 'Full-Frame Dashboards')
    expect(ff).toBeTruthy()
    if (!ff) return
    const el = variantToElement(ff, 0, 0)
    expect(el.type).toBe('overlaywidget')
    expect((el as { widgetId?: string }).widgetId).toBe(ff.widgetId)
  })

  it('every clustered curated variant is reachable via cluster ∪ category fallback', () => {
    const clusterSections = groupVariantsByCluster(curated)
    const fallbackSections = groupVariantsByCategory(curated.filter((v) => !v.cluster))
    const seen = new Set<string>()
    for (const s of clusterSections) for (const v of s.variants) seen.add(v.id)
    for (const s of fallbackSections) for (const v of s.variants) seen.add(v.id)
    // No curated widget is dropped by the cluster-first sectioning.
    expect(seen.size).toBe(curated.length)
  })
})

describe('catalog — predictors use warm chrome (no decorative green/cyan)', () => {
  it('no predictor variant pins a static green/cyan accent', () => {
    const predictors = ALL_VARIANTS.filter((v) => v.id.startsWith('pred-'))
    expect(predictors.length).toBeGreaterThan(0)
    const coolDecorative = new Set(['#2FFF67', '#00E7FF', '#35F2B8', '#158BFF'])
    for (const v of predictors) {
      const accent = (v.style as { accentColor?: string }).accentColor
      expect(coolDecorative.has(accent ?? ''), `${v.id} uses cool accent ${accent}`).toBe(false)
    }
  })

  it('catch-ahead / fuel-margin / pace specifically dropped green/cyan', () => {
    const byId = new Map(ALL_VARIANTS.map((v) => [v.id, v]))
    for (const id of ['pred-catch-ahead-fut', 'pred-fuel-margin-min', 'pred-pace-fut', 'pred-pace-min']) {
      const accent = (byId.get(id)?.style as { accentColor?: string }).accentColor
      expect(accent).not.toBe('#2FFF67')
      expect(accent).not.toBe('#00E7FF')
    }
  })
})
