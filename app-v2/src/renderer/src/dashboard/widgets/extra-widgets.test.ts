import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { EXTRA_WIDGET_TYPES, renderExtraWidget } from './extra-widgets'
import { PREVIEW_SNAPSHOT } from './gt3-theme'
import { NEW_VARIANTS, NEW_WIDGET_KINDS, variantToElement } from '../../views/dashboard/widget-catalog-data'
import type { DashboardElement, DashboardElementType } from '../../../../shared/dashboards'

describe('extra-widgets renderer', () => {
  it('renders every new variant to markup with and without telemetry', () => {
    for (const v of NEW_VARIANTS) {
      const el = { ...variantToElement(v, 0, 0), w: 220, h: 170 }
      const withSnap = renderToStaticMarkup(renderExtraWidget({ element: el, snapshot: PREVIEW_SNAPSHOT }))
      const without = renderToStaticMarkup(renderExtraWidget({ element: el, snapshot: null }))
      expect(withSnap.length, `empty render for ${v.id}`).toBeGreaterThan(10)
      expect(without.length, `empty null-render for ${v.id}`).toBeGreaterThan(10)
      // Guard against bad maths leaking into the SVG/markup.
      expect(withSnap, `NaN in ${v.id}`).not.toContain('NaN')
      expect(without, `NaN in null ${v.id}`).not.toContain('NaN')
    }
  })

  it('dispatches every registered extra kind to a component', () => {
    for (const kind of EXTRA_WIDGET_TYPES) {
      const el = variantToElement({ id: kind, label: kind, type: kind, w: 200, h: 160, style: {} }, 0, 0)
      const out = renderExtraWidget({ element: el, snapshot: PREVIEW_SNAPSHOT })
      expect(out, `kind ${kind} did not render`).not.toBeNull()
    }
    // EXTRA_WIDGET_TYPES is the renderer's source of truth; the catalog's
    // NEW_WIDGET_KINDS must match it exactly.
    expect([...EXTRA_WIDGET_TYPES].sort()).toEqual([...NEW_WIDGET_KINDS].sort())
  })

  it('returns null for an unrelated element type', () => {
    const el = variantToElement({ id: 't', label: 't', type: 'text', w: 10, h: 10, style: {} }, 0, 0)
    expect(renderExtraWidget({ element: el, snapshot: null })).toBeNull()
  })
})

describe('progress arcs suppress the 0% stray dot (m4)', () => {
  // strokeLinecap="round" + a "0.00 .." dasharray paints a stray dot at 0%.
  // The widgets now omit the progress circle entirely when frac === 0, so no
  // "0.00" dasharray should ever reach the markup.
  it('donut at 0% draws no round-capped progress arc', () => {
    const el = variantToElement({ id: 'donut', label: 'donut', type: 'donut', w: 160, h: 160, style: {} }, 0, 0)
    const out = renderToStaticMarkup(renderExtraWidget({ element: el, snapshot: null }))
    expect(out).not.toContain('stroke-dasharray="0.00')
    // The background ring is still drawn, so the widget is not blank.
    expect(out).toContain('<circle')
  })

  it('radialbars at 0% draws no round-capped progress arcs', () => {
    const el = variantToElement({ id: 'radialbars', label: 'radialbars', type: 'radialbars', w: 160, h: 160, style: {} }, 0, 0)
    const out = renderToStaticMarkup(renderExtraWidget({ element: el, snapshot: null }))
    expect(out).not.toContain('stroke-dasharray="0.00')
    expect(out).toContain('<circle')
  })
})

describe('GForceMeter survives non-finite accel channels (S1)', () => {
  it('never emits NaN coords when lat/lon accel are NaN or Infinity', () => {
    const el = variantToElement({ id: 'g', label: 'g', type: 'gforcemeter', w: 160, h: 160, style: {} }, 0, 0)
    const snap = { ...PREVIEW_SNAPSHOT, latAccelG: NaN, longAccelG: Number.POSITIVE_INFINITY }
    const out = renderToStaticMarkup(renderExtraWidget({ element: el, snapshot: snap }))
    expect(out).not.toContain('NaN')
    expect(out).not.toContain('Infinity')
  })
})

describe('per-slot font overrides reach the rendered widget (round-8 bug 2)', () => {
  function el(type: DashboardElementType, style: DashboardElement['style']): DashboardElement {
    return { id: `e-${type}`, type, x: 0, y: 0, w: 220, h: 170, binding: 'speedKmh', style }
  }

  it('applies a value-slot font override on an SVG widget (analoggauge) and is a no-op when absent', () => {
    const base = renderToStaticMarkup(renderExtraWidget({ element: el('analoggauge', {}), snapshot: PREVIEW_SNAPSHOT }))
    const styled = renderToStaticMarkup(
      renderExtraWidget({
        element: el('analoggauge', { slots: { value: { fontColor: '#123456', fontFamily: '"Rajdhani", sans-serif', fontSize: 41 } } }),
        snapshot: PREVIEW_SNAPSHOT
      })
    )
    // Back-compat: the default render carries none of the override values.
    expect(base).not.toContain('#123456')
    expect(base).not.toContain('font-size="41"')
    // The override reaches the rendered <text> (fill + size + family).
    expect(styled).toContain('fill="#123456"')
    expect(styled).toContain('font-size="41"')
    expect(styled).toContain('Rajdhani')
  })

  it('applies a value-slot font override on an SVG widget (segmentbars)', () => {
    const styled = renderToStaticMarkup(
      renderExtraWidget({
        element: el('segmentbars', { slots: { value: { fontColor: '#654321', fontSize: 27 } } }),
        snapshot: PREVIEW_SNAPSHOT
      })
    )
    expect(styled).toContain('fill="#654321"')
    expect(styled).toContain('font-size="27"')
  })

  it('applies a label-slot font override on an SVG widget (segmentbars)', () => {
    const styled = renderToStaticMarkup(
      renderExtraWidget({
        element: el('segmentbars', { label: 'BOOST', slots: { label: { fontColor: '#0fa9c2', fontSize: 19 } } }),
        snapshot: PREVIEW_SNAPSHOT
      })
    )
    expect(styled).toContain('fill="#0fa9c2"')
    expect(styled).toContain('font-size="19"')
  })
})

describe('style.instrument opt-in routes extra widgets through instrument primitives', () => {
  function el(type: DashboardElementType, style: DashboardElement['style']): DashboardElement {
    return { id: `i-${type}`, type, x: 0, y: 0, w: 220, h: 170, binding: 'speedKmh', style }
  }

  it('analoggauge → AnalogDial (DSEG readout) only when instrument is set', () => {
    const base = renderToStaticMarkup(renderExtraWidget({ element: el('analoggauge', {}), snapshot: PREVIEW_SNAPSHOT }))
    const inst = renderToStaticMarkup(renderExtraWidget({ element: el('analoggauge', { instrument: {} }), snapshot: PREVIEW_SNAPSHOT }))
    expect(inst).toContain('DSEG7Classic-Regular')
    expect(inst).not.toEqual(base)
    expect(inst).not.toContain('NaN')
  })

  it('linearmeter / ledbar → RevLedBar with bloom filter', () => {
    const inst = renderToStaticMarkup(renderExtraWidget({ element: el('ledbar', { instrument: {} }), snapshot: PREVIEW_SNAPSHOT }))
    expect(inst).toContain('rev lights')
    expect(inst).toContain('feGaussianBlur')
    expect(inst).not.toContain('NaN')
  })

  it('segment7 → SegmentReadout (DSEG)', () => {
    const inst = renderToStaticMarkup(renderExtraWidget({ element: el('segment7', { instrument: {} }), snapshot: PREVIEW_SNAPSHOT }))
    expect(inst).toContain('DSEG')
    expect(inst).not.toContain('NaN')
  })

  it('statuslamp → TelltaleBank', () => {
    const inst = renderToStaticMarkup(renderExtraWidget({ element: el('statuslamp', { instrument: {} }), snapshot: PREVIEW_SNAPSHOT }))
    expect(inst).toContain('telltales')
  })

  it('bigtext → DataTile, missing value renders the em-dash placeholder', () => {
    const inst = renderToStaticMarkup(renderExtraWidget({ element: { ...el('bigtext', { instrument: {} }), binding: undefined }, snapshot: null }))
    expect(inst).toContain('<svg')
    expect(inst).toContain('—')
    expect(inst).not.toContain('NaN')
  })

  it('survives extreme/non-finite channels without leaking NaN (donut, ringgauge)', () => {
    for (const type of ['donut', 'ringgauge'] as DashboardElementType[]) {
      const snap = { ...PREVIEW_SNAPSHOT, speedKmh: Number.POSITIVE_INFINITY }
      const inst = renderToStaticMarkup(renderExtraWidget({ element: el(type, { instrument: {} }), snapshot: snap }))
      expect(inst, `NaN in ${type}`).not.toContain('NaN')
      expect(inst, `Infinity in ${type}`).not.toContain('Infinity')
    }
  })
})
