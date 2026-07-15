import { describe, expect, it } from 'vitest'
import {
  OVERLAY_STYLE_PRESETS,
  OVERLAY_FORMS,
  OVERLAY_WIDGETS,
  OVERLAY_DESIGN_FAMILIES,
  OVERLAY_DESIGN_FAMILY_SPECS,
  OVERLAY_PRESET_FAMILY,
  overlayDesignFamily,
  getOverlayStylePreset,
  createCustomOverlayDef,
  createDefaultOverlaysConfig,
  createRichCustomOverlayDef,
  isRichCustomOverlay,
  sanitizeCustomOverlayWidget,
  sanitizeCustomOverlayWidgets,
  DEFAULT_RICH_OVERLAY_CANVAS,
  type CustomOverlayDef
} from './overlays'
import type { DashboardElement } from './dashboards'

const FUTURISTIC_OVERLAY_IDS = [
  'revComet',
  'sideRadarGlyph',
  'orbitRadar',
  'relativeBeacons',
  'relativeLadder',
  'deltaNeedle',
  'deltaRibbon',
  'gearRing',
  'speedGlyph',
  'fuelOrb',
  'fuelPips',
  'inputsVector',
  'inputsScope',
  'tyreHaloGrid',
  'brakeHeatTiles',
  'trackRibbonFuture',
  'trackSectorPulse',
  'weatherGripGlyph',
  'flagIconStack'
]

describe('futuristic overlay registry', () => {
  it('registers exactly 19 futuristic graphic overlays', () => {
    expect(OVERLAY_WIDGETS.filter((widget) => FUTURISTIC_OVERLAY_IDS.includes(widget.id))).toHaveLength(19)
  })
})

describe('gap overlays registry', () => {
  const GAP_IDS = ['gapAhead', 'gapBehind'] as const

  it('registers the Gap Ahead and Gap Behind overlays with valid default positions', () => {
    for (const id of GAP_IDS) {
      const widget = OVERLAY_WIDGETS.find((item) => item.id === id)
      expect(widget, `missing overlay ${id}`).toBeDefined()
      expect(widget?.title.length, `empty title ${id}`).toBeGreaterThan(0)
      const pos = widget?.defaultPosition
      expect(pos, `missing position ${id}`).toBeDefined()
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        expect(Number.isFinite(pos?.[key]), `non-finite ${key} for ${id}`).toBe(true)
      }
      expect(pos?.width, `zero width ${id}`).toBeGreaterThan(0)
      expect(pos?.height, `zero height ${id}`).toBeGreaterThan(0)
    }
  })

  describe('Release A legacy trigger-only overlays', () => {
    it.each([
      ['flags', 'raceControlFlags'],
      ['flagIconStack', 'raceControlFlags'],
      ['sideRadarGlyph', 'sideProximity'],
      ['pushToPassHud', 'pushToPassState'],
      ['wetTag', 'trackWetness'],
      ['engineTellTales', 'engineWarnings'],
      ['absCut', 'absCut'],
      ['paceRestart', 'paceMode'],
      ['sideProximity', 'sideProximity']
    ] as const)('%s is an alert with a non-always semantic trigger', (id, semantic) => {
      const definition = OVERLAY_WIDGETS.find((entry) => entry.id === id)
      expect(definition?.role).toBe('alert')
      expect(definition?.defaultTrigger).toEqual({ kind: 'semantic', semantic })
      expect(definition?.tags).toEqual(expect.arrayContaining(['trigger-only', 'release-a']))
    })
  })

  it('includes both gap overlays in the default overlays config (disabled by default)', () => {
    const config = createDefaultOverlaysConfig()
    for (const id of GAP_IDS) {
      expect(config.widgets[id]?.id).toBe(id)
      expect(config.widgets[id]?.enabled).toBe(false)
    }
  })
})

// ─── Rich custom overlays (dashboard-widget model) ────────────────────────────

function richWidget(partial: Partial<DashboardElement> = {}): DashboardElement {
  return {
    id: partial.id ?? 'w1',
    type: partial.type ?? 'gauge',
    x: partial.x ?? 10,
    y: partial.y ?? 20,
    w: partial.w ?? 200,
    h: partial.h ?? 120,
    style: partial.style ?? { fillColor: '#ff7a1a' },
    binding: partial.binding,
    name: partial.name
  }
}

describe('rich custom overlay model', () => {
  it('createCustomOverlayDef stays LEGACY when no widgets array is given', () => {
    const def = createCustomOverlayDef({ title: 'Legacy', elements: [] })
    expect(def.widgets).toBeUndefined()
    expect(def.canvasWidth).toBeUndefined()
    expect(isRichCustomOverlay(def)).toBe(false)
  })

  it('createCustomOverlayDef becomes RICH when a widgets array is provided (even empty)', () => {
    const def = createCustomOverlayDef({ title: 'Rich', widgets: [] })
    expect(Array.isArray(def.widgets)).toBe(true)
    expect(def.widgets).toHaveLength(0)
    expect(isRichCustomOverlay(def)).toBe(true)
    // Canvas dims default to the position size.
    expect(def.canvasWidth).toBe(def.position.width)
    expect(def.canvasHeight).toBe(def.position.height)
  })

  it('createRichCustomOverlayDef always carries a widgets array + default canvas', () => {
    const def = createRichCustomOverlayDef()
    expect(isRichCustomOverlay(def)).toBe(true)
    expect(def.widgets).toEqual([])
    expect(def.canvasWidth).toBe(DEFAULT_RICH_OVERLAY_CANVAS.width)
    expect(def.canvasHeight).toBe(DEFAULT_RICH_OVERLAY_CANVAS.height)
    expect(def.enabled).toBe(true)
    expect(def.id.startsWith('custom:')).toBe(true)
  })

  it('createRichCustomOverlayDef preserves provided rich widgets', () => {
    const def = createRichCustomOverlayDef({ widgets: [richWidget({ id: 'g', type: 'gearcluster' })] })
    expect(def.widgets).toHaveLength(1)
    expect(def.widgets?.[0]?.type).toBe('gearcluster')
    expect(isRichCustomOverlay(def)).toBe(true)
  })

  it('isRichCustomOverlay only treats an actual array as rich', () => {
    expect(isRichCustomOverlay(null)).toBe(false)
    expect(isRichCustomOverlay(undefined)).toBe(false)
    expect(isRichCustomOverlay({})).toBe(false)
    expect(isRichCustomOverlay({ widgets: undefined })).toBe(false)
    expect(isRichCustomOverlay({ widgets: [] })).toBe(true)
    expect(isRichCustomOverlay({ widgets: [richWidget()] })).toBe(true)
  })
})

describe('sanitizeCustomOverlayWidget(s)', () => {
  it('returns undefined for a missing / non-array widgets field (keeps legacy)', () => {
    expect(sanitizeCustomOverlayWidgets(undefined)).toBeUndefined()
    expect(sanitizeCustomOverlayWidgets(null)).toBeUndefined()
    expect(sanitizeCustomOverlayWidgets('nope')).toBeUndefined()
    expect(sanitizeCustomOverlayWidgets({})).toBeUndefined()
  })

  it('returns an array (possibly empty) for a present widgets field (marks rich)', () => {
    expect(sanitizeCustomOverlayWidgets([])).toEqual([])
  })

  it('drops invalid widget entries (non-object / missing type)', () => {
    const out = sanitizeCustomOverlayWidgets([richWidget(), null, 42, { x: 1 }, { type: '' }])
    expect(out).toHaveLength(1)
    expect(out?.[0]?.type).toBe('gauge')
  })

  it('clamps geometry and enforces a minimum size', () => {
    const out = sanitizeCustomOverlayWidget({ type: 'rect', x: -999999, y: 5, w: 0, h: -3 })
    expect(out).not.toBeNull()
    expect(out?.x).toBe(-16000)
    expect(out?.w).toBe(1)
    expect(out?.h).toBe(1)
  })

  it('assigns an id when absent and preserves binding/name/visible', () => {
    const out = sanitizeCustomOverlayWidget({ type: 'value', binding: 'ir:Speed', name: 'Speed', visible: false })
    expect(out?.id).toMatch(/^w-/)
    expect(out?.binding).toBe('ir:Speed')
    expect(out?.name).toBe('Speed')
    expect(out?.visible).toBe(false)
  })

  it('deep-clones style independently when it is shared with an extension', () => {
    const shared = { fillColor: '#abc', slots: { value: { fontSize: 20 } } }
    const out = sanitizeCustomOverlayWidget({ type: 'gauge', style: shared, future: shared }) as (DashboardElement & { future: typeof shared }) | null
    expect(out?.style).toEqual(shared); expect(out?.future).toEqual(shared)
    expect(out?.style).not.toBe(shared); expect(out?.future).not.toBe(shared); expect(out?.style).not.toBe(out?.future)
  })

  it('replaces a non-object style with an empty style', () => {
    const out = sanitizeCustomOverlayWidget({ type: 'gauge', style: 'oops' })
    expect(out?.style).toEqual({})
  })

  it('rejects widget arrays above the 200-widget cap', () => {
    const many = Array.from({ length: 201 }, (_, i) => richWidget({ id: `w${i}` }))
    expect(sanitizeCustomOverlayWidgets(many)).toEqual([])
  })

  it('preserves nonblank overlaywidget identities, including future ids', () => {
    const out = sanitizeCustomOverlayWidget({ type: 'overlaywidget', widgetId: 'future:widget-v99', hifiModuleId: 'future-module-v99' })
    expect(out?.widgetId).toBe('future:widget-v99'); expect(out?.hifiModuleId).toBe('future-module-v99')
    expect(sanitizeCustomOverlayWidget({ type: 'overlaywidget', widgetId: ' ', hifiModuleId: 42 })).not.toHaveProperty('widgetId'); expect(sanitizeCustomOverlayWidget({ type: 'gauge', widgetId: 'future:wrong-type' })).not.toHaveProperty('widgetId')
  })

  it('preserves and recursively deep-clones forward-compatible JSON extensions', () => {
    const future = { mode: 'endurance', pages: [1, { alerts: ['fuel', 'tyres'] }], options: { enabled: true, empty: null } }
    const out = sanitizeCustomOverlayWidget({ type: 'gauge', future }) as (DashboardElement & { future: typeof future }) | null
    expect(out?.future).toEqual(future)
    expect(out?.future).not.toBe(future); expect(out?.future.pages).not.toBe(future.pages); expect(out?.future.options).not.toBe(future.options)
  })

  it('skips throwing extension/canonical accessors without invoking them', () => {
    let calls = 0
    const future = { safe: true }
    Object.defineProperty(future, 'boom', { enumerable: true, get() { calls += 1; throw new Error('getter invoked') } })
    const input = { type: 'gauge', future }
    Object.defineProperty(input, 'topBoom', { enumerable: true, get() { calls += 1; throw new Error('getter invoked') } })
    expect(sanitizeCustomOverlayWidget(input)).toMatchObject({ future: { safe: true } })
    const invalid = {}
    Object.defineProperty(invalid, 'type', { enumerable: true, get() { calls += 1; throw new Error('getter invoked') } })
    expect(sanitizeCustomOverlayWidget(invalid)).toBeNull(); expect(calls).toBe(0)
  })

  it('drops unsupported values, keeps safe siblings and rejects non-plain widgets', () => {
    class UnsafeInstance {}
    const future = {
      keep: 'ok', fn: () => true, symbol: Symbol('x'), bigint: BigInt(1), nan: Number.NaN,
      infinity: Number.POSITIVE_INFINITY, date: new Date(), map: new Map(), instance: new UnsafeInstance()
    }
    const out = sanitizeCustomOverlayWidget({ type: 'gauge', future }) as (DashboardElement & { future: unknown }) | null
    expect(out?.future).toEqual({ keep: 'ok' })
    for (const value of [Object.assign(new Date(), { type: 'gauge' }), Object.assign(new Map(), { type: 'gauge' }), new (class { type = 'gauge' })()]) expect(sanitizeCustomOverlayWidget(value)).toBeNull()
  })

  it('drops dangerous keys recursively without prototype pollution', () => {
    const future = JSON.parse('{"safe":{"value":1,"__proto__":{"polluted":true},"constructor":{"polluted":true},"prototype":{"polluted":true}}}')
    const out = sanitizeCustomOverlayWidget({ type: 'gauge', future }) as (DashboardElement & { future: unknown }) | null
    expect(out?.future).toEqual({ safe: { value: 1 } }); expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
  })

  it('drops cyclic extension values', () => {
    const future: Record<string, unknown> = { safe: true }
    future.self = future
    expect(sanitizeCustomOverlayWidget({ type: 'gauge', future })).not.toHaveProperty('future')
  })

  it('drops depth/node/array-amplification extensions without erasing valid style', () => {
    let deep: Record<string, unknown> = { leaf: true }
    for (let i = 0; i < 40; i += 1) deep = { next: deep }
    const wide: Record<string, unknown> = {}
    for (let i = 0; i < 10_001; i += 1) wide[`k${i}`] = i
    const arrays: Record<string, unknown> = {}
    for (let i = 0; i < 4_500; i += 1) arrays[`a${i}`] = new Array(4096)
    const style = { fillColor: '#abc' }
    for (const future of [deep, wide, arrays]) {
      const out = sanitizeCustomOverlayWidget({ id: 'kept', type: 'gauge', style, future })
      expect(out).toMatchObject({ id: 'kept', type: 'gauge' })
      expect(out?.style).toEqual(style)
      expect(out).not.toHaveProperty('future')
    }
  }, 1_000)

  it('rejects 500k arrays before scanning and never invokes getter indexes', () => {
    let calls = 0
    const getter = { enumerable: true, get() { calls += 1; throw new Error('getter invoked') } }
    const huge: unknown[] = []; huge.length = 500_000; Object.defineProperty(huge, '0', getter)
    expect(sanitizeCustomOverlayWidgets(huge)).toEqual([])
    expect(sanitizeCustomOverlayWidget({ type: 'gauge', future: huge })).not.toHaveProperty('future')
    const bounded: unknown[] = []; bounded.length = 1; Object.defineProperty(bounded, '0', getter)
    expect(sanitizeCustomOverlayWidgets(bounded)).toEqual([])
    const out = sanitizeCustomOverlayWidget({ type: 'gauge', future: bounded }) as (DashboardElement & { future: unknown[] }) | null
    expect(out?.future).toHaveLength(1)
    expect(calls).toBe(0)
  }, 1_000)

  it('rejects exponentially shared graphs in bounded time', () => {
    let future: unknown = { leaf: true }
    for (let i = 0; i < 40; i += 1) future = { left: future, right: future }
    const out = sanitizeCustomOverlayWidget({ id: 'kept', type: 'gauge', future })
    expect(out).toMatchObject({ id: 'kept', type: 'gauge' })
    expect(out).not.toHaveProperty('future')
  }, 1_000)

  it('never throws for revoked untrusted proxies', () => {
    const revocable = Proxy.revocable({}, {})
    revocable.revoke()
    expect(() => sanitizeCustomOverlayWidget(revocable.proxy)).not.toThrow()
    expect(() => sanitizeCustomOverlayWidgets(revocable.proxy)).not.toThrow()
  })
})

describe('custom overlay back-compat / migration', () => {
  it('a persisted LEGACY def round-trips through createCustomOverlayDef and stays legacy', () => {
    const persisted = {
      id: 'custom:legacy1',
      title: 'Old',
      enabled: true,
      locked: false,
      opacity: 80,
      elements: [{ expressionId: 'channel:Speed', expression: 'Speed', label: 'Speed' }]
    }
    const def = createCustomOverlayDef(persisted as Partial<CustomOverlayDef>)
    expect(isRichCustomOverlay(def)).toBe(false)
    expect(def.widgets).toBeUndefined()
    expect(def.elements).toHaveLength(1)
    expect(def.elements[0].expressionId).toBe('channel:Speed')
  })

  it('a persisted RICH def round-trips and keeps its widgets + canvas + legacy elements', () => {
    const persisted: Partial<CustomOverlayDef> = {
      id: 'custom:rich1',
      title: 'Dash overlay',
      enabled: true,
      canvasWidth: 1280,
      canvasHeight: 400,
      widgets: [richWidget({ id: 'g', type: 'gearcluster' }), richWidget({ id: 'b', type: 'shiftbar' })],
      elements: []
    }
    const def = createCustomOverlayDef(persisted)
    expect(isRichCustomOverlay(def)).toBe(true)
    expect(def.widgets).toHaveLength(2)
    expect(def.canvasWidth).toBe(1280)
    expect(def.canvasHeight).toBe(400)
    expect(def.elements).toEqual([])
  })
})

describe('overlay design families (vis-families)', () => {
  it('exposes exactly 8 ordered families with no duplicates', () => {
    expect(OVERLAY_DESIGN_FAMILIES).toHaveLength(8)
    expect(new Set(OVERLAY_DESIGN_FAMILIES).size).toBe(8)
    expect([...OVERLAY_DESIGN_FAMILIES]).toEqual([
      'minimal',
      'neon',
      'glass',
      'broadcast',
      'terminal',
      'bauhaus',
      'analog',
      'heatmap'
    ])
  })

  it('maps every selectable style preset to a known family', () => {
    const presetIds = OVERLAY_STYLE_PRESETS.map((preset) => preset.id).sort()
    const mappedIds = Object.keys(OVERLAY_PRESET_FAMILY)
    expect(mappedIds).toEqual(expect.arrayContaining(presetIds))
    for (const [presetId, family] of Object.entries(OVERLAY_PRESET_FAMILY)) {
      expect(OVERLAY_DESIGN_FAMILIES, `bad family for ${presetId}`).toContain(family)
    }
  })

  it('exposes exactly 5 selectable structural forms with distinct families', () => {
    expect(OVERLAY_FORMS).toHaveLength(5)
    expect(OVERLAY_STYLE_PRESETS).toHaveLength(5)
    expect(OVERLAY_FORMS.map((form) => form.id)).toEqual(['minimal', 'broadcast', 'analog', 'heatmap', 'neon'])
    expect(new Set(OVERLAY_FORMS.map((form) => overlayDesignFamily(form.id))).size).toBe(5)
  })

  it('provides a spec for every family (machine-readable mirror of the doc)', () => {
    expect(Object.keys(OVERLAY_DESIGN_FAMILY_SPECS).sort()).toEqual([...OVERLAY_DESIGN_FAMILIES].sort())
    for (const family of OVERLAY_DESIGN_FAMILIES) {
      const spec = OVERLAY_DESIGN_FAMILY_SPECS[family]
      expect(spec.id).toBe(family)
      for (const key of ['title', 'tagline', 'layout', 'typography', 'shape', 'motion', 'shines', 'colorRole'] as const) {
        expect(spec[key].length, `empty ${key} for ${family}`).toBeGreaterThan(0)
      }
    }
  })

  it('resolves known preset ids and falls back to minimal for unknown/missing', () => {
    expect(overlayDesignFamily('terminal')).toBe('terminal')
    expect(overlayDesignFamily('bauhaus')).toBe('bauhaus')
    expect(overlayDesignFamily('analog')).toBe('analog')
    expect(overlayDesignFamily('heatmap')).toBe('heatmap')
    expect(overlayDesignFamily('gulf')).toBe('broadcast')
    expect(overlayDesignFamily('nightStint')).toBe('minimal')
    expect(overlayDesignFamily('does-not-exist')).toBe('minimal')
    expect(overlayDesignFamily(undefined)).toBe('minimal')
    expect(overlayDesignFamily('')).toBe('minimal')
  })

  it('back-compat: legacy structural presets remain accepted for persisted configs', () => {
    expect(overlayDesignFamily('terminal')).toBe('terminal')
    expect(overlayDesignFamily('bauhaus')).toBe('bauhaus')
    expect(overlayDesignFamily('glass')).toBe('glass')
    expect(overlayDesignFamily('analog')).toBe('analog')
    expect(overlayDesignFamily('heatmap')).toBe('heatmap')
    expect(getOverlayStylePreset('terminal').id).toBe('minimal')
    expect(getOverlayStylePreset('bauhaus').id).toBe('broadcast')
    expect(getOverlayStylePreset('glass').id).toBe('minimal')
  })
})

describe('overlay favorite (config-list shortcut flag)', () => {
  it('every built-in widget defaults to favorite=false', () => {
    const config = createDefaultOverlaysConfig()
    for (const widget of OVERLAY_WIDGETS) {
      expect(config.widgets[widget.id].favorite).toBe(false)
    }
  })

  it('createCustomOverlayDef defaults favorite=false and preserves an explicit favorite', () => {
    expect(createCustomOverlayDef({}).favorite).toBe(false)
    expect(createCustomOverlayDef({ favorite: true }).favorite).toBe(true)
  })
})
