import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RevLedBar } from './RevLedBar'
import { gt3Base } from '../skins/tokens'
import { SHIFT_STROBE_BLUE } from '../lib/rev-lights'

const render = (props: Parameters<typeof RevLedBar>[0]): string =>
  renderToStaticMarkup(createElement(RevLedBar, props))

describe('RevLedBar', () => {
  it('renders an svg with the requested segment count', () => {
    const markup = render({ pct: 0.5, segments: 12 })
    expect(markup).toContain('<svg')
    // 12 LEDs → at least 12 circle faces (off LEDs draw one circle each).
    expect((markup.match(/<circle/g) ?? []).length).toBeGreaterThanOrEqual(12)
  })

  it('includes an feGaussianBlur LED bloom when glow is on', () => {
    const markup = render({ pct: 0.9, segments: 10, glow: true })
    expect(markup).toContain('feGaussianBlur')
    expect(markup).toContain('filter')
  })

  it('omits the bloom filter when glow is off', () => {
    const markup = render({ pct: 0.9, segments: 10, glow: false })
    expect(markup).not.toContain('feGaussianBlur')
  })

  it('turns every LED strong blue and strobes uniformly at the shift point', () => {
    const markup = render({ pct: 1, segments: 8, redlineFlash: true, flashOn: true, flashAt: 0.9 })
    expect(markup).toContain(SHIFT_STROBE_BLUE)
    expect(markup).toContain('data-rev-shift="strobe"')
    expect(markup).toContain('repeatCount="indefinite"')
    expect((markup.match(new RegExp(SHIFT_STROBE_BLUE, 'g')) ?? []).length).toBeGreaterThanOrEqual(8)
  })

  it('does not flash when below flashAt', () => {
    const markup = render({ pct: 0.6, segments: 8, redlineFlash: true, flashAt: 0.97 })
    expect(markup).toContain('data-rev-shift="normal"')
    expect(markup).not.toContain('repeatCount="indefinite"')
    expect(markup).not.toContain(SHIFT_STROBE_BLUE)
  })

  it('renders cleanly (no NaN/undefined) at null/extreme values', () => {
    for (const pct of [Number.NaN, -5, 0, 1, 99, Infinity]) {
      const markup = render({ pct: pct as number, segments: 15 })
      expect(markup).not.toContain('NaN')
      expect(markup).not.toContain('undefined')
    }
  })

  it('supports bar and trapezoid shapes', () => {
    expect(render({ pct: 0.7, segments: 6, shape: 'bar' })).toContain('<rect')
    expect(render({ pct: 0.7, segments: 6, shape: 'trapezoid' })).toContain('<polygon')
  })

  it('never renders negative geometry for a narrow, dense bar (gap*segments > width)', () => {
    for (const shape of ['led', 'bar', 'trapezoid'] as const) {
      const markup = render({ pct: 0.8, segments: 30, width: 10, height: 6, gap: 4, shape })
      // No geometry attribute (r/rx/width/height/x/y/cx/cy) may carry a negative
      // plain number. (Filter regions like x="-35%" are percentages and allowed.)
      expect(markup, `negative dim in ${shape}`).not.toMatch(/="-[\d.]+"/)
      // Polygon/points must not contain negative coordinates either.
      expect(markup, `negative point in ${shape}`).not.toMatch(/[ ,]-[\d.]+[ ,"]/)
      expect(markup, `NaN in ${shape}`).not.toContain('NaN')
      expect(markup, `undefined in ${shape}`).not.toContain('undefined')
    }
  })

  it('maps a skin LedProfile with correct zone boundaries (not shifted a full zone)', () => {
    // gt3 profile zones: green ≤0.55, amber ≤0.80, red ≤0.98. At pct=0.92 the
    // upper LEDs must reach RED (#DC2626) — regression guard for the upTo→start
    // off-by-one that left the bar amber/green until ~80%.
    const hot = render({ pct: 0.95, profile: gt3Base.led, redlineFlash: false, glow: false })
    expect(hot.toUpperCase()).toContain('#DC2626')
    // A low rev fraction stays green (no red lit).
    const cold = render({ pct: 0.25, profile: gt3Base.led, redlineFlash: false, glow: false })
    expect(cold.toUpperCase()).not.toContain('#DC2626')
    expect(cold.toUpperCase()).toContain('#16A34A')
  })
})
