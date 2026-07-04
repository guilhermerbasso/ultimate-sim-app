import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderGt3Widget } from './gt3-widgets'
import { PREVIEW_SNAPSHOT } from './gt3-theme'
import { TELEMETRY_WIDGET_TYPES } from './new-widgets-telemetry'
import { FUTURISTIC_WIDGET_TYPES } from './new-widgets-futuristic'
import { MINIMAL_WIDGET_TYPES } from './new-widgets-minimal'
import { WIDGET_SLOTS, type DashboardElement, type DashboardElementStyle, type DashboardElementType } from '../../../../shared/dashboards'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'

// Every wave-16 widget id (telemetry + futuristic + minimalist).
const NEW_TYPES: DashboardElementType[] = [
  ...TELEMETRY_WIDGET_TYPES,
  ...FUTURISTIC_WIDGET_TYPES,
  ...MINIMAL_WIDGET_TYPES
] as DashboardElementType[]

// A snapshot that exercises the NEW iRacing telemetry fields the telemetry
// widgets read. Built on the shared PREVIEW so the unrelated fields are present.
const NEW_SNAP: TelemetrySnapshot = {
  ...PREVIEW_SNAPSHOT,
  ersBatteryPct: 0.62,
  pushToPass: true,
  pushToPassCount: 4,
  weatherDeclaredWet: false,
  trackSurfaceMaterial: 1, // asphalt
  weightPenaltyKg: 15,
  powerAdjustPct: -2,
  sessionTimeOfDay: 53_000,
  tireColdPressuresKpa: { lf: 165, rf: 168, lr: 160, rr: 163 },
  pit: { repairNeeded: false, optRepairNeeded: true, pitsOpen: true, inPitStall: false, svStatus: 0 }
}

// A snapshot where the wet/penalty/off-track branches are taken instead.
const WET_SNAP: TelemetrySnapshot = {
  ...NEW_SNAP,
  ersBatteryPct: 0.08,
  pushToPass: false,
  pushToPassCount: 0,
  weatherDeclaredWet: true,
  isRaining: true,
  trackWetnessPct: 0.8,
  trackSurfaceMaterial: 15, // grass (off-track)
  powerAdjustPct: 1.5,
  pit: { repairNeeded: true, optRepairNeeded: false, pitsOpen: false, inPitStall: true }
}

function el(type: DashboardElementType, style: DashboardElementStyle, binding?: string, w = 220, h = 160): DashboardElement {
  return { id: `e-${type}`, type, x: 0, y: 0, w, h, binding, style }
}

function markup(type: DashboardElementType, style: DashboardElementStyle, snapshot: TelemetrySnapshot | null, binding?: string): string {
  const node = renderGt3Widget({ element: el(type, style, binding), snapshot })
  return node ? renderToStaticMarkup(node) : ''
}

describe('wave-16 widgets — registration', () => {
  it('declares exactly 30 new widget kinds (15 futuristic / 15 minimalist)', () => {
    expect(NEW_TYPES.length).toBe(30)
    const minimal = NEW_TYPES.filter((t) => t.endsWith('-minimal')).length
    const futuristic = NEW_TYPES.filter((t) => t.endsWith('-futuristic')).length
    expect(minimal).toBe(15)
    expect(futuristic).toBe(15)
  })

  it('every new kind has a unique id', () => {
    expect(new Set(NEW_TYPES).size).toBe(NEW_TYPES.length)
  })

  it('every new kind exposes editable text slots in WIDGET_SLOTS (incl. a value slot)', () => {
    for (const type of NEW_TYPES) {
      const slots = (WIDGET_SLOTS[type] ?? []).map((d) => d.slot)
      expect(slots.length, `${type} has no slots`).toBeGreaterThan(0)
      expect(slots, `${type} missing value slot`).toContain('value')
    }
  })
})

describe('wave-16 widgets — dispatch + safe rendering', () => {
  it('dispatches every new kind to a component (non-null) via renderGt3Widget', () => {
    for (const type of NEW_TYPES) {
      const node = renderGt3Widget({ element: el(type, {}, 'rpmPct'), snapshot: NEW_SNAP })
      expect(node, `kind ${type} did not dispatch`).not.toBeNull()
    }
  })

  it('renders to non-empty markup for new / wet / preview / null snapshots without NaN', () => {
    for (const type of NEW_TYPES) {
      for (const [name, snap] of [['new', NEW_SNAP], ['wet', WET_SNAP], ['preview', PREVIEW_SNAPSHOT], ['null', null]] as const) {
        const out = markup(type, {}, snap, 'rpmPct')
        expect(out.length, `empty render for ${type} (${name})`).toBeGreaterThan(10)
        expect(out, `NaN in ${type} (${name})`).not.toContain('NaN')
        expect(out, `Infinity in ${type} (${name})`).not.toContain('Infinity')
        expect(out, `undefined leaked in ${type} (${name})`).not.toContain('undefined')
      }
    }
  })

  it('survives non-finite new-telemetry inputs (no NaN/Infinity in geometry)', () => {
    const broken: TelemetrySnapshot = {
      ...NEW_SNAP,
      ersBatteryPct: Number.NaN,
      pushToPassCount: Number.POSITIVE_INFINITY,
      trackWetnessPct: Number.NaN,
      weightPenaltyKg: Number.POSITIVE_INFINITY,
      powerAdjustPct: Number.NaN,
      sessionTimeOfDay: Number.NaN,
      tireColdPressuresKpa: { lf: Number.NaN, rf: 168, lr: Number.POSITIVE_INFINITY, rr: 163 }
    }
    for (const type of NEW_TYPES) {
      const out = markup(type, {}, broken, 'rpmPct')
      expect(out, `NaN in ${type}`).not.toContain('NaN')
      expect(out, `Infinity in ${type}`).not.toContain('Infinity')
    }
  })
})

describe('wave-16 widgets — colour rule (warm chrome/penalties, cool only for "good")', () => {
  const GREEN = '#1AFF6E' // GT3.green — reserved for "good" states
  const RED = '#FF2200' // GT3.red — penalties / bad states
  const AMBER = '#FFB800' // GT3.amber — caution / penalties
  const ORANGE = '#FF7A00' // GT3.orange — off-track caution

  it('ERS battery: green when charged, red when nearly empty', () => {
    expect(markup('ers-bar-futuristic', {}, NEW_SNAP)).toContain(GREEN)
    expect(markup('ers-bar-futuristic', {}, WET_SNAP)).toContain(RED)
  })

  it('push-to-pass: green when active, red when depleted', () => {
    expect(markup('p2p-futuristic', {}, NEW_SNAP)).toContain(GREEN)
    expect(markup('p2p-futuristic', {}, WET_SNAP)).toContain(RED)
  })

  it('weather: green when dry, amber when declared wet', () => {
    expect(markup('weather-status-futuristic', {}, NEW_SNAP)).toContain(GREEN)
    expect(markup('weather-status-futuristic', {}, WET_SNAP)).toContain(AMBER)
  })

  it('track surface: green on asphalt, orange off-track (grass)', () => {
    expect(markup('track-surface-futuristic', {}, NEW_SNAP)).toContain(GREEN)
    expect(markup('track-surface-futuristic', {}, WET_SNAP)).toContain(ORANGE)
  })

  it('BoP: amber ballast penalty + red power cut; green power boost', () => {
    const cut = markup('bop-futuristic', {}, NEW_SNAP) // +15kg, -2%
    expect(cut).toContain(AMBER)
    expect(cut).toContain(RED)
    expect(markup('bop-futuristic', {}, WET_SNAP)).toContain(GREEN) // +1.5%
  })

  it('pit status: green when pits open, red when shut', () => {
    expect(markup('pit-status-futuristic', {}, NEW_SNAP)).toContain(GREEN)
    expect(markup('pit-status-futuristic', {}, WET_SNAP)).toContain(RED)
  })
})

describe('wave-16 widgets — per-slot font overrides reach the rendered value', () => {
  // The round-15 rule: every telemetry/readout text must route through
  // resolveSlotStyle so the inspector's font colour + size controls take effect.
  for (const type of NEW_TYPES) {
    it(`${type} honours a value-slot fontColor + fontSize override`, () => {
      const base = markup(type, {}, NEW_SNAP, 'rpmPct')
      const styled = markup(type, { slots: { value: { fontColor: '#123456', fontSize: 41 } } }, NEW_SNAP, 'rpmPct')
      // Back-compat: the default render carries none of the override values.
      expect(base, `${type} default already had the override colour`).not.toContain('#123456')
      // The override reaches the rendered value text — SVG (<text fill=…>) or
      // HTML (<span style="color:…">) form.
      expect(styled, `${type} value colour not applied`).toContain('#123456')
      const hasSize = styled.includes('font-size="41"') || styled.includes('font-size:41px')
      expect(hasSize, `${type} value font-size not applied`).toBe(true)
    })
  }
})

describe('wave-16 widgets — style.instrument opt-in routes through instrument primitives', () => {
  const INST: DashboardElementStyle = { instrument: {} }

  it('dial families (rings/arcs/ers-radial) → AnalogDial DSEG readout', () => {
    for (const type of ['neon-ring-futuristic', 'segmented-gauge-futuristic', 'arc-minimal', 'ers-radial-futuristic', 'ers-radial-minimal'] as DashboardElementType[]) {
      const out = markup(type, INST, NEW_SNAP, 'rpmPct')
      expect(out, `${type} not a dial`).toContain('DSEG7Classic-Regular')
      expect(out, `NaN in ${type}`).not.toContain('NaN')
    }
  })

  it('bar families (neon/hairline/dot/ers) → RevLedBar with bloom', () => {
    for (const type of ['neon-bar-futuristic', 'hairline-bar-minimal', 'dot-gauge-minimal', 'ers-bar-futuristic', 'ers-bar-minimal'] as DashboardElementType[]) {
      const out = markup(type, INST, NEW_SNAP, 'rpmPct')
      expect(out, `${type} not a rev bar`).toContain('rev lights')
      expect(out, `${type} no bloom`).toContain('feGaussianBlur')
      expect(out, `NaN in ${type}`).not.toContain('NaN')
    }
  })

  it('readout families (clock/typo) → SegmentReadout DSEG', () => {
    for (const type of ['clock-futuristic', 'clock-minimal', 'typo-readout-minimal'] as DashboardElementType[]) {
      const out = markup(type, INST, NEW_SNAP, 'rpmPct')
      expect(out, `${type} not a segment readout`).toContain('DSEG')
      expect(out, `NaN in ${type}`).not.toContain('NaN')
    }
  })

  it('tile families (hud/grid/mono/stacked) → DataTile svg surface', () => {
    for (const type of ['hud-tile-futuristic', 'grid-gauge-futuristic', 'mono-tile-minimal', 'stacked-readout-minimal'] as DashboardElementType[]) {
      const out = markup(type, INST, NEW_SNAP, 'rpmPct')
      expect(out, `${type} not a tile`).toContain('<svg')
      expect(out, `NaN in ${type}`).not.toContain('NaN')
    }
  })

  it('lamp families (pit/weather/p2p) → TelltaleBank', () => {
    for (const type of ['pit-status-futuristic', 'pit-status-minimal', 'weather-status-futuristic', 'p2p-futuristic'] as DashboardElementType[]) {
      const out = markup(type, INST, NEW_SNAP, 'rpmPct')
      expect(out, `${type} not a telltale bank`).toContain('telltales')
    }
  })

  it('missing channels render the em-dash placeholder, never NaN (instrument dials/readouts)', () => {
    for (const type of ['ers-radial-minimal', 'clock-minimal'] as DashboardElementType[]) {
      const out = markup(type, INST, null, 'rpmPct')
      expect(out, `${type} missing not handled`).toContain('—')
      expect(out, `NaN in ${type}`).not.toContain('NaN')
    }
  })

  it('instrument opt-in is a no-op when absent (back-compat fallback differs)', () => {
    const base = markup('neon-ring-futuristic', {}, NEW_SNAP, 'rpmPct')
    const inst = markup('neon-ring-futuristic', INST, NEW_SNAP, 'rpmPct')
    expect(base).not.toEqual(inst)
    expect(base).not.toContain('aria-label="rev lights"')
  })
})
