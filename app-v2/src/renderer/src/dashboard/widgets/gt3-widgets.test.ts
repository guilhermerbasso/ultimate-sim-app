import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { computeFuelStintLayout, renderGt3Widget, GT3_WIDGET_TYPES } from './gt3-widgets'
import { PREVIEW_SNAPSHOT } from './gt3-theme'
import { WIDGET_SLOTS, type DashboardElement, type DashboardElementStyle, type DashboardElementType } from '../../../../shared/dashboards'
import { createElement } from 'react'
import { MotorsportGlyph, type MotorsportIconId } from '../../icons/motorsport'
import { computeFit } from '../../skins/FitText'
import { SHIFT_STROBE_BLUE } from '../../lib/rev-lights'

function el(type: DashboardElementType, style: DashboardElementStyle, binding?: string, w = 220, h = 160): DashboardElement {
  return { id: `e-${type}`, type, x: 0, y: 0, w, h, binding, style }
}

function markup(type: DashboardElementType, style: DashboardElementStyle, binding?: string, w = 220, h = 160): string {
  const node = renderGt3Widget({ element: el(type, style, binding, w, h), snapshot: PREVIEW_SNAPSHOT })
  return node ? renderToStaticMarkup(node) : ''
}

function markupWithSnapshot(
  type: DashboardElementType,
  style: DashboardElementStyle,
  binding: string | undefined,
  snapshot: typeof PREVIEW_SNAPSHOT | null
): string {
  const node = renderGt3Widget({ element: el(type, style, binding), snapshot })
  return node ? renderToStaticMarkup(node) : ''
}

// ── The round-15 bug: widgets whose text was hard-coded ignored slot styling, so
// changing letter colour/size in the inspector was a visual no-op. Each fix routes
// the previously-raw text through resolveSlotStyle and exposes a slot for it.
describe('previously hard-coded GT3 text now honours font colour + size', () => {
  it('trackmini routes its % readout through the value slot (SVG <text>)', () => {
    const base = markup('trackmini', {}, 'lapDistPct')
    const styled = markup('trackmini', { slots: { value: { fontColor: '#123456', fontSize: 41 } } }, 'lapDistPct')
    expect(base).not.toContain('#123456')
    expect(base).not.toContain('font-size="41"')
    expect(styled).toContain('fill="#123456"')
    expect(styled).toContain('font-size="41"')
  })

  it('inputbars routes the per-channel % value through the value slot', () => {
    const base = markup('inputbars', {})
    const styled = markup('inputbars', { slots: { value: { fontColor: '#654321', fontSize: 27 } } })
    expect(base).not.toContain('#654321')
    expect(styled).toContain('#654321')
    expect(styled).toContain('font-size:27px')
  })

  it('curated metric widgets (speed-clean) route the hero value through the value slot', () => {
    const base = markup('speed-clean', {}, 'speedKmh')
    const styled = markup('speed-clean', { slots: { value: { fontColor: '#abcdef', fontSize: 39 } } }, 'speedKmh')
    expect(base).not.toContain('#abcdef')
    expect(styled).toContain('#abcdef')
    expect(styled).toContain('font-size="39"')
  })

  it('enginetemps routes each TempCard value through the value slot', () => {
    const base = markup('enginetemps', {})
    const styled = markup('enginetemps', { slots: { value: { fontColor: '#0fa9c2' } } })
    expect(base).not.toContain('#0fa9c2')
    expect(styled).toContain('#0fa9c2')
  })

  it('the generic value widget honours the decimals + prefix granular controls', () => {
    const base = markup('value', {}, 'speedKmh')
    const styled = markup('value', { decimals: 2, prefix: '≈' }, 'speedKmh')
    // PREVIEW speed is an integer-ish reading; decimals forces fixed places.
    expect(styled).toContain('≈')
    expect(styled).toMatch(/\.\d{2}/)
    expect(base).not.toContain('≈')
  })

  it('tyres-elaborate routes the corner pressure/wear sub-line through the sub slot', () => {
    // The sub-line (pressure · wear) only renders on a tall enough tyre card.
    const styled = markup('tyres-elaborate', { slots: { sub: { fontColor: '#ff8800', fontSize: 13 } } }, undefined, 240, 280)
    expect(styled).toContain('#ff8800')
    expect(styled).toContain('font-size:13px')
  })
})

describe('FuelStint compact column layout', () => {
  for (const [label, w, h] of [['tile', 300, 92], ['wide', 340, 110], ['endurance', 320, 120]] as const) {
    it(`keeps the fuel-per-lap value and unit legible and compact at ${label} size`, () => {
      const layout = computeFuelStintLayout(w, h)
      const unitFit = computeFit(null, 'L/lap', layout.perLapUnitBoxW, layout.perLapUnitBoxH, 13, 16, 'squeeze')
      expect(unitFit.didFit).toBe(true)
      expect(unitFit.fontPx).toBeGreaterThanOrEqual(13)

      // fuelstint and x4-fuelstint-tile both render at 300×92 in drive/redline.
      // Use the bundled DSEG font's Chromium-measured advance so this catches the
      // runtime data-didfit="0" regression that the SSR fallback underestimates.
      let measuredFontPx = 13
      const dsegMeasurement = {
        setAttribute: (name: string, value: string) => {
          if (name === 'font-size') measuredFontPx = Number(value)
        },
        getComputedTextLength: () => measuredFontPx * (31.828125 / 13)
      } as unknown as SVGTextElement
      const valueBoxW = layout.halfSide - layout.perLapUnitBoxW - 2
      const valueBoxH = layout.perLapUnitBoxH / 0.6
      const valueFit = computeFit(dsegMeasurement, '2.86', valueBoxW, valueBoxH, 13, valueBoxH * 0.8, 'squeeze')
      expect(valueFit.didFit).toBe(true)
      expect(valueFit.fontPx).toBeGreaterThanOrEqual(13)
    })
  }
})

// The v2.35.0 GT3 typography fix: the generic value widget chooses its VALUE-slot
// font by CONTENT, not by the root style. A numeric reading renders in DSEG
// (seven-seg) and textual/missing readings render in the condensed face — and a
// root `fontFamily` (e.g. a catalog tile's "Segoe UI") must NEVER leak onto the
// value slot, which previously forced DSEG onto text and let Segoe override DSEG.
describe('value widget picks its readout font from content (DSEG numerals only)', () => {
  it('a numeric reading renders the value in DSEG', () => {
    const out = markup('value', {}, 'speedKmh')
    expect(out).toMatch(/<text[^>]*font-family="[^"]*DSEG7Classic-Regular[^"]*"[^>]*>236<\/text>/)
    // The converted unit is intentionally rendered separately in a legible
    // condensed face; only the numeric value belongs on the segment font.
    expect(out).toContain('>km/h</text>')
  })

  it('a textual reading renders the value in the condensed face, not DSEG', () => {
    // carName resolves to "GT3" — letters must NOT be forced into seven-seg.
    const out = markup('value', {}, 'carName')
    expect(out).toContain('Chakra Petch')
    expect(out).not.toContain('DSEG7Classic-Regular')
  })

  it('a root style fontFamily does NOT override the DSEG value font', () => {
    // The catalog "Segoe UI" regression: a root font must not reach the value slot.
    const out = markup('value', { fontFamily: 'Segoe UI' }, 'speedKmh')
    expect(out).toContain('DSEG7Classic-Regular')
    expect(out).not.toContain('Segoe UI')
  })

  it('an explicit per-slot value font still wins over the content-aware default', () => {
    const out = markup('value', { slots: { value: { fontFamily: 'Courier New' } } }, 'speedKmh')
    expect(out).toContain('Courier New')
    expect(out).not.toContain('DSEG7Classic-Regular')
  })
})

// The inspector only surfaces a per-text editor for types present in WIDGET_SLOTS,
// so every textual widget MUST declare its slots (otherwise font colour/size are
// unreachable from the UI — the user-reported symptom).
describe('WIDGET_SLOTS exposes editable text for every fixed widget', () => {
  const expected: Record<string, string[]> = {
    trackmini: ['value'],
    inputbars: ['label', 'value'],
    steering: ['label', 'value'],
    setupstrip: ['label', 'value'],
    enginetemps: ['label', 'value', 'unit'],
    gforcemeter: ['label', 'value'],
    'speed-clean': ['header', 'value', 'unit'],
    'speed-elaborate': ['header', 'value', 'unit'],
    'tyres-clean': ['header', 'label', 'value', 'sub'],
    'tyres-elaborate': ['header', 'label', 'value', 'sub'],
    'relatives-elaborate': ['header', 'value', 'gap', 'label'],
    'radar-clean': ['label'],
    'temps-elaborate': ['header', 'label', 'value']
  }
  for (const [type, want] of Object.entries(expected)) {
    it(`declares slots for ${type}`, () => {
      const got = (WIDGET_SLOTS[type] ?? []).map((d) => d.slot)
      for (const slot of want) expect(got, `${type} missing slot ${slot}`).toContain(slot)
    })
  }

  it('declares both -clean and -elaborate keys for every curated concept', () => {
    const concepts = ['speed', 'gear', 'rpm', 'delta', 'fuel', 'lap', 'position', 'flags', 'abs', 'tc', 'map', 'bb', 'pitlimiter', 'incidents', 'clutch', 'drs', 'tyres', 'relatives', 'radar', 'trackmap', 'inputs', 'temps']
    for (const c of concepts) {
      expect((WIDGET_SLOTS[`${c}-clean`] ?? []).length, `${c}-clean`).toBeGreaterThan(0)
      expect((WIDGET_SLOTS[`${c}-elaborate`] ?? []).length, `${c}-elaborate`).toBeGreaterThan(0)
    }
  })
})

// The ~26 inline header/watermark glyphs that duplicated the shared motorsport
// registry now render straight from it (single source of truth), so warning
// lights + flags read identically across dashboards and overlays. Pure gauge
// geometry (speedo arc, gear, lap, delta, podium…) has no registry twin and stays
// inline on its 64-grid.
describe('registry-backed GT3 glyphs render from the shared motorsport icon set', () => {
  // The registry's inner geometry (paths / circles / text) for an icon id. The
  // widget re-renders the exact same <MotorsportGlyph>, only adding size/colour
  // props to the outer <svg>, so the children markup must appear verbatim in the
  // widget output. Works for path-based AND text-based glyphs (abs, pit-limiter).
  function registryInner(id: MotorsportIconId): string {
    const full = renderToStaticMarkup(createElement(MotorsportGlyph, { id }))
    return full.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
  }

  // The canonical first <path d> the registry draws for a given icon id.
  function registryPath(id: MotorsportIconId): string {
    const m = renderToStaticMarkup(createElement(MotorsportGlyph, { id })).match(/ d="([^"]+)"/)
    if (!m) throw new Error(`registry icon "${id}" has no <path d>`)
    return m[1]
  }

  // [widget type → the registry icon its header/watermark glyph must now draw]
  // NOTE: abs / pit-limiter are intentionally absent. Their registry glyphs bake a
  // hard-coded sub-10px <text> ("ABS"/"PIT") into the 24-grid icon, which the
  // legibility linter flags at any render size, and the icon set is off-limits. The
  // curated abs/pitlimiter tiles therefore drop the watermark and surface the assist
  // name as a first-class ≥11px FitText instead (asserted separately below).
  const CASES: Array<[string, MotorsportIconId]> = [
    ['fuel-elaborate', 'fuel'],
    ['tc-elaborate', 'tc'],
    ['drs-elaborate', 'drs'],
    ['bb-elaborate', 'brake-bias'],
    ['tyres-elaborate', 'tyre'],
    ['temps-elaborate', 'temp'],
    ['weather', 'rain'],
    ['brakegrid', 'brake']
  ]

  for (const [type, id] of CASES) {
    it(`${type} draws the canonical "${id}" glyph`, () => {
      let out = ''
      expect(() => { out = markup(type as DashboardElementType, {}) }, `${type} render`).not.toThrow()
      expect(out.length, `${type} produced markup`).toBeGreaterThan(10)
      expect(out, `${type} → registry ${id}`).toContain(registryInner(id))
    })
  }

  // The assist tiles whose registry glyph embeds illegible micro-text now render the
  // tag through legible SVG text and NEVER re-introduce the off-limits sub-10px glyph.
  it('abs/pitlimiter curated tiles show a legible tag and drop the sub-10px glyph text', () => {
    const abs = markup('abs-elaborate' as DashboardElementType, {})
    expect(abs).toContain('ABS')
    expect(abs, 'abs must not re-introduce the 8px registry glyph text').not.toContain('font-size="8"')
    const pit = markup('pitlimiter-elaborate' as DashboardElementType, {})
    expect(pit).toContain('PIT')
    expect(pit, 'pit must not re-introduce the 7px registry glyph text').not.toContain('font-size="7"')
  })

  it('renders an actual registry <path> (fuel tank geometry) straight from the icon set', () => {
    const out = markup('fuel-elaborate' as DashboardElementType, {})
    expect(out).toContain(`d="${registryPath('fuel')}"`)
  })

  it('leaves pure gauge geometry inline (the speedo arc is NOT a registry icon)', () => {
    const speed = markup('speed-elaborate' as DashboardElementType, {})
    expect(speed).toContain('viewBox="0 0 64 64"') // inline 64-grid glyph preserved
    expect(speed).toContain('M9 45a23 23 0 0 1 46 0') // speedo arc geometry intact
    expect(speed).not.toContain(`d="${registryPath('fuel')}"`)
  })
})

// ── v2.37.0 instrument-primitive conversion ──────────────────────────────────
// The headline cluster widgets now render through the modelled SVG instruments
// (AnalogDial / RevLedBar / SegmentReadout) for real-car fidelity, while still
// honouring each element's existing `style` AND the additive `style.instrument`
// knobs. Parity-safe: unconverted widgets keep their legacy renderers.
describe('GT3 cluster widgets route through the instrument primitives', () => {
  it('valuegauge renders an AnalogDial (bezel arc track + needle)', () => {
    const out = markup('valuegauge', {}, 'lapDistPct')
    expect(out).toContain('role="img"') // AnalogDial root <svg role="img">
    expect(out).toContain('<path') // d3 arc track + value fill
    expect(out).toContain('<polygon') // anti-aliased Needle
  })

  it('valuegauge needle colour follows the element accent style (user-editable)', () => {
    const out = markup('valuegauge', { accentColor: '#abcdef' }, 'lapDistPct')
    expect(out).toContain('#abcdef')
  })

  it('valuegauge honours instrument.parts.dial overrides without throwing', () => {
    const out = markup(
      'valuegauge',
      { instrument: { parts: { dial: { majorTicks: 5, warnFrom: 70, redlineFrom: 90 } } } },
      'lapDistPct'
    )
    expect(out).toContain('role="img"')
    expect(out).not.toMatch(/NaN|undefined/)
  })

  it('shiftbar renders a RevLedBar with LED bloom at high shift', () => {
    // PREVIEW shiftIndicatorPct ≈ 0.86 → LEDs lit; glow defaults on → bloom filter.
    const out = markup('shiftbar', {}, 'shiftPct')
    expect(out).toContain('feGaussianBlur') // bloom filter primitive
    expect(out).toMatch(/url\(#[^)]*-bloom\)/) // lit LEDs reference the bloom
  })

  it('shiftbar honours instrument.glow=false (LEDs but no bloom)', () => {
    const out = markup('shiftbar', { instrument: { glow: false } }, 'shiftPct')
    expect(out).not.toContain('feGaussianBlur')
  })

  it('uses provider blink for shiftbar and gearcluster shift strips', () => {
    const providerOff = {
      ...PREVIEW_SNAPSHOT,
      shiftIndicatorPct: 0.999,
      revLights: { pct: 0.999, blink: false }
    } as typeof PREVIEW_SNAPSHOT
    const providerOn = {
      ...PREVIEW_SNAPSHOT,
      shiftIndicatorPct: 0.2,
      revLights: { pct: 0.2, blink: true }
    } as typeof PREVIEW_SNAPSHOT

    for (const type of ['shiftbar', 'gearcluster'] as DashboardElementType[]) {
      const normal = markupWithSnapshot(type, {}, type === 'shiftbar' ? 'shiftPct' : undefined, providerOff)
      const shifted = markupWithSnapshot(type, {}, type === 'shiftbar' ? 'shiftPct' : undefined, providerOn)
      expect(normal, type).not.toContain(SHIFT_STROBE_BLUE)
      expect(normal, type).not.toContain('repeatCount="indefinite"')
      expect(shifted, type).toContain(SHIFT_STROBE_BLUE)
      expect(shifted, type).toContain('repeatCount="indefinite"')
    }
  })

  it('gearcluster (clean) renders DSEG gear + speed via SegmentReadout', () => {
    const out = markup('gearcluster', {}, 'gear')
    expect(out).toContain('DSEG7Classic-Regular') // numeric gear/speed → seven-seg
    expect(out).toContain('role="img"') // the RevLedBar shift strip
  })

  it('gearcluster (showRpm) renders an AnalogDial tachometer', () => {
    const out = markup('gearcluster', { showRpm: true })
    expect(out).toContain('role="img"')
    expect(out).toContain('<polygon') // tach needle
  })
})

describe('instrument conversions are NaN-safe and honour missing → —', () => {
  function rawMarkup(type: DashboardElementType, style: DashboardElementStyle, binding: string | undefined, snap: typeof PREVIEW_SNAPSHOT | null) {
    const node = renderGt3Widget({ element: el(type, style, binding), snapshot: snap })
    return node ? renderToStaticMarkup(node) : ''
  }

  it('valuegauge with a null snapshot produces no NaN/undefined', () => {
    expect(rawMarkup('valuegauge', {}, 'lapDistPct', null)).not.toMatch(/NaN|undefined/)
  })

  it('gearcluster with a null snapshot shows the em-dash gear and no NaN', () => {
    const out = rawMarkup('gearcluster', {}, undefined, null)
    expect(out).not.toMatch(/NaN|undefined/)
    expect(out).toContain('—')
  })

  it('shiftbar with no telemetry clamps to empty without NaN', () => {
    expect(rawMarkup('shiftbar', {}, 'shiftPct', null)).not.toMatch(/NaN|undefined/)
  })

  it('gearcluster showRpm with a null snapshot is NaN-safe', () => {
    expect(rawMarkup('gearcluster', { showRpm: true }, undefined, null)).not.toMatch(/NaN|undefined/)
  })
})

describe('every GT3 widget type still renders (parity-safe, no throws)', () => {
  for (const type of GT3_WIDGET_TYPES) {
    it(`renders ${type} with and without telemetry`, () => {
      expect(() => {
        const a = renderGt3Widget({ element: el(type as DashboardElementType, {}), snapshot: PREVIEW_SNAPSHOT })
        if (a) renderToStaticMarkup(a)
        const b = renderGt3Widget({ element: el(type as DashboardElementType, {}), snapshot: null })
        if (b) renderToStaticMarkup(b)
      }).not.toThrow()
    })
  }
})
