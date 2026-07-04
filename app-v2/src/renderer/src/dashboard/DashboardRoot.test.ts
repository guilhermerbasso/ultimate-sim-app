import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderDashboardElement } from './DashboardRoot'
import { PREVIEW_SNAPSHOT } from './widgets/gt3-theme'
import type {
  DashboardElement,
  DashboardElementStyle,
  DashboardElementType
} from '../../../shared/dashboards'

// Build a builtin board element and render it exactly as production does (the
// exported renderDashboardElement reuses the real ElementSwitcher → primitives).
function el(
  type: DashboardElementType,
  style: DashboardElementStyle = {},
  binding?: string,
  w = 140,
  h = 140
): DashboardElement {
  return { id: `e-${type}`, type, x: 0, y: 0, w, h, binding, style }
}

function markup(
  type: DashboardElementType,
  style: DashboardElementStyle = {},
  binding?: string,
  snap: typeof PREVIEW_SNAPSHOT | null = PREVIEW_SNAPSHOT
): string {
  return renderToStaticMarkup(renderDashboardElement({ element: el(type, style, binding), snapshot: snap }))
}

// ── v2.37.0 builtin element renderers now route through the instrument set ────
// gauge → AnalogDial, shiftlights → RevLedBar (default-on). The continuous bar
// family (bar/barv/dualbar) is parity-safe: legacy CSS fill by default, modelled
// RevLedBar only when the board author opts in via style.instrument.
describe('builtin gauge element renders an AnalogDial', () => {
  it('draws the bezel arc track + anti-aliased needle', () => {
    const out = markup('gauge', {}, 'lapDistPct')
    expect(out).toContain('role="img"') // AnalogDial root svg
    expect(out).toContain('<path') // d3 arc track
    expect(out).toContain('<polygon') // needle
  })

  it('overlays the binding text in DSEG numerals', () => {
    const out = markup('gauge', {}, 'lapDistPct')
    expect(out).toContain('DSEG7Classic-Regular')
  })

  it('needle colour follows the element fill/needle style', () => {
    const out = markup('gauge', { needleColor: '#abcdef' }, 'lapDistPct')
    expect(out).toContain('#abcdef')
  })

  it('is NaN-safe and shows the em-dash with no telemetry', () => {
    const out = markup('gauge', {}, 'lapDistPct', null)
    expect(out).not.toMatch(/NaN|undefined/)
    expect(out).toContain('—')
  })
})

describe('builtin shiftlights element renders a RevLedBar', () => {
  it('draws modelled LEDs with bloom at high shift', () => {
    const out = markup('shiftlights', {}, 'shiftPct')
    expect(out).toContain('role="img"')
    expect(out).toContain('feGaussianBlur') // bloom (glow default on)
  })

  it('honours the glow=false toggle (LEDs but no bloom)', () => {
    const out = markup('shiftlights', { instrument: { glow: false } }, 'shiftPct')
    expect(out).not.toContain('feGaussianBlur')
  })

  it('is NaN-safe without telemetry', () => {
    expect(markup('shiftlights', {}, 'shiftPct', null)).not.toMatch(/NaN|undefined/)
  })
})

describe('continuous bar elements are parity-safe (legacy by default, RevLed opt-in)', () => {
  it('bar keeps the lightweight CSS fill by default (no instrument svg)', () => {
    const out = markup('bar', {}, 'lapDistPct')
    expect(out).toContain('dash-bar')
    expect(out).not.toContain('role="img"')
  })

  it('bar routes through RevLedBar when style.instrument.template === "revled"', () => {
    const out = markup('bar', { instrument: { template: 'revled' } }, 'lapDistPct')
    expect(out).toContain('role="img"')
  })

  it('bar also opts in when instrument.parts.led is present', () => {
    const out = markup('bar', { instrument: { parts: { led: { segments: 10 } } } }, 'lapDistPct')
    expect(out).toContain('role="img"')
  })

  it('barv stays legacy by default and opts into RevLedBar on request', () => {
    expect(markup('barv', {}, 'lapDistPct')).toContain('dash-barv')
    expect(markup('barv', { instrument: { template: 'revled' } }, 'lapDistPct')).toContain('role="img"')
  })

  it('dualbar stays legacy by default and opts into RevLedBar on request', () => {
    expect(markup('dualbar', {}, 'lapDistPct')).toContain('dash-dualbar')
    expect(markup('dualbar', { instrument: { template: 'revled' } }, 'lapDistPct')).toContain('role="img"')
  })
})

describe('all builtin board element types still render (parse/render parity)', () => {
  const BUILTIN_TYPES: DashboardElementType[] = [
    'text',
    'rect',
    'bar',
    'barv',
    'dualbar',
    'deltabar',
    'shiftlights',
    'gauge',
    'map',
    'radar',
    'image',
    'flag',
    'trace',
    'table',
    'standings'
  ]
  for (const type of BUILTIN_TYPES) {
    it(`renders ${type} with and without telemetry`, () => {
      expect(() => {
        renderToStaticMarkup(renderDashboardElement({ element: el(type, {}, 'lapDistPct'), snapshot: PREVIEW_SNAPSHOT }))
        renderToStaticMarkup(renderDashboardElement({ element: el(type, {}, 'lapDistPct'), snapshot: null }))
      }).not.toThrow()
    })
  }
})
