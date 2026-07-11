import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SHIFT_ZONES,
  LedShiftBar,
  REDLINE_FLASH_COLOR,
  clampPct,
  litCount,
  zoneColorAt
} from './LedShiftBar'

describe('LedShiftBar math', () => {
  it('clamps pct to [0,1] and guards NaN', () => {
    expect(clampPct(-1)).toBe(0)
    expect(clampPct(2)).toBe(1)
    expect(clampPct(Number.NaN)).toBe(0)
    expect(clampPct(0.4)).toBeCloseTo(0.4)
  })

  it('lights the proportional number of LEDs', () => {
    expect(litCount(0, 15)).toBe(0)
    expect(litCount(1, 15)).toBe(15)
    expect(litCount(0.5, 10)).toBe(5)
  })

  it('maps fraction to the right colour zone', () => {
    expect(zoneColorAt(0)).toBe(DEFAULT_SHIFT_ZONES[0].color)
    expect(zoneColorAt(0.6)).toBe('#ffb000')
    expect(zoneColorAt(0.95)).toBe('#ff2d2d')
  })
})

describe('LedShiftBar render', () => {
  it('renders a stretchable svg with one core rect per segment', () => {
    const markup = renderToStaticMarkup(createElement(LedShiftBar, { pct: 0.5, segments: 12 }))
    expect(markup).toContain('<svg')
    expect(markup).toContain('preserveAspectRatio="none"')
    // 12 cores + lit blooms; at least 12 rects present
    expect((markup.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(12)
  })

  it('models each LED as a bloomed dome (radial "on" gradient + feGaussianBlur bloom)', () => {
    const markup = renderToStaticMarkup(createElement(LedShiftBar, { pct: 0.6, segments: 12 }))
    // Lit LEDs carry a radial-gradient dome + a gaussian bloom.
    expect(markup).toContain('<radialGradient')
    expect(markup).toContain('feGaussianBlur')
    expect(markup).toMatch(/filter="url\(#[^)]+-bloom\)"/)
  })

  it('uses ONE shared bloom layer for the whole bar (bounded 60Hz cost, not per-LED)', () => {
    const markup = renderToStaticMarkup(createElement(LedShiftBar, { pct: 1, segments: 15 }))
    // A single filter def + a single feGaussianBlur, referenced exactly once (on the
    // grouped blur layer) regardless of how many LEDs are lit.
    expect((markup.match(/<filter/g) ?? []).length).toBe(1)
    expect((markup.match(/<feGaussianBlur/g) ?? []).length).toBe(1)
    expect((markup.match(/filter="url\(#[^)]+-bloom\)"/g) ?? []).length).toBe(1)
  })

  it('gives unlit LEDs a diffuse "off" muscle + dark stroke (no bloom)', () => {
    const markup = renderToStaticMarkup(createElement(LedShiftBar, { pct: 0, segments: 8 }))
    // Off gradient present, dark per-LED stroke, and no bloom filter when nothing lit.
    expect(markup).toMatch(/fill="url\(#[^)]+-off\)"/)
    expect(markup).toContain('stroke="#1a1a1a"')
    expect(markup).not.toContain('feGaussianBlur')
  })

  it('turns every LED strong blue and strobes uniformly when shifting', () => {
    const markup = renderToStaticMarkup(
      createElement(LedShiftBar, { pct: 1, segments: 8, blink: true })
    )
    expect(markup).toContain('is-blink')
    expect(markup).toContain(REDLINE_FLASH_COLOR)
    expect(markup).toContain('repeatCount="indefinite"')
    expect(markup).toContain('data-rev-shift="strobe"')
  })

  it('an empty bar lights no bloom (only dimmed off-dome cores)', () => {
    const markup = renderToStaticMarkup(createElement(LedShiftBar, { pct: 0, segments: 10 }))
    // off LEDs draw exactly one rect each; no bloom pass with nothing lit.
    expect((markup.match(/<rect/g) ?? []).length).toBe(10)
    expect(markup).not.toContain('feGaussianBlur')
  })

  it('renders cleanly (no NaN/undefined) at null/extreme values', () => {
    for (const pct of [Number.NaN, -5, 0, 1, 99, Infinity]) {
      const markup = renderToStaticMarkup(
        createElement(LedShiftBar, { pct: pct as number, segments: 15 })
      )
      expect(markup).not.toContain('NaN')
      expect(markup).not.toContain('undefined')
    }
  })
})
