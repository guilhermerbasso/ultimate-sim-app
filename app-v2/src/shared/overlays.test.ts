import { describe, expect, it } from 'vitest'
import {
  OVERLAY_STYLE_PRESETS,
  OVERLAY_WIDGETS,
  OVERLAY_DESIGN_FAMILIES,
  OVERLAY_DESIGN_FAMILY_SPECS,
  OVERLAY_PRESET_FAMILY,
  overlayDesignFamily,
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
  'revHalo',
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

const FUTURISTIC_STYLE_IDS = [
  'apexIgnition',
  'ionEmber',
  'vectorPulse',
  'cinderGlass',
  'thermalGhost',
  'emberCircuit',
  'radarClear',
  'orangeCore',
  'blackGold',
  'redlineVoid',
  'amberVector',
  'copperMesh',
  'moltenCarbon',
  'safetyGreen',
  'laserGrid',
  'solarFlare',
  'obsidianRing',
  'brakeGlow',
  'nightStint'
]

describe('futuristic overlay registry', () => {
  it('registers exactly 20 new futuristic graphic overlays', () => {
    expect(OVERLAY_WIDGETS.filter((widget) => FUTURISTIC_OVERLAY_IDS.includes(widget.id))).toHaveLength(20)
  })

  it('registers exactly 19 selectable futuristic style presets', () => {
    expect(OVERLAY_STYLE_PRESETS.filter((preset) => FUTURISTIC_STYLE_IDS.includes(preset.id))).toHaveLength(19)
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

  it('shallow-clones the style object (no shared reference)', () => {
    const style = { fillColor: '#abc', slots: { value: { fontSize: 20 } } }
    const out = sanitizeCustomOverlayWidget({ type: 'gauge', style })
    expect(out?.style).toEqual(style)
    expect(out?.style).not.toBe(style)
  })

  it('replaces a non-object style with an empty style', () => {
    const out = sanitizeCustomOverlayWidget({ type: 'gauge', style: 'oops' })
    expect(out?.style).toEqual({})
  })

  it('caps the number of widgets to a sane maximum', () => {
    const many = Array.from({ length: 500 }, (_, i) => richWidget({ id: `w${i}` }))
    const out = sanitizeCustomOverlayWidgets(many)
    expect(out?.length).toBe(200)
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

  it('maps every style preset to a known family (total coverage, no extras)', () => {
    const presetIds = OVERLAY_STYLE_PRESETS.map((preset) => preset.id).sort()
    const mappedIds = Object.keys(OVERLAY_PRESET_FAMILY).sort()
    expect(mappedIds).toEqual(presetIds)
    for (const [presetId, family] of Object.entries(OVERLAY_PRESET_FAMILY)) {
      expect(OVERLAY_DESIGN_FAMILIES, `bad family for ${presetId}`).toContain(family)
    }
  })

  it('keeps each namesake preset as the archetype of its family', () => {
    for (const family of OVERLAY_DESIGN_FAMILIES) {
      expect(OVERLAY_PRESET_FAMILY[family]).toBe(family)
    }
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

  it('back-compat: the 4 widget-branched presets keep their layout family', () => {
    // Widgets still compare config.stylePreset to these ids today; the helper
    // must agree so a future switch to overlayDesignFamily() is behavior-preserving.
    expect(overlayDesignFamily('terminal')).toBe('terminal')
    expect(overlayDesignFamily('bauhaus')).toBe('bauhaus')
    expect(overlayDesignFamily('analog')).toBe('analog')
    expect(overlayDesignFamily('heatmap')).toBe('heatmap')
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
