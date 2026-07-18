import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  SHIFT_PCT,
  SHIFT_STROBE_BLUE,
  ShiftStrobe,
  resolveRevLightPct,
  resolveRevLightState,
  resolveRpmGaugePct,
  revFill,
  revLightRowLayout
} from './rev-lights'

describe('shared rev-light shift state', () => {
  it('is NaN-safe and applies one strong-blue strobe rule at the shift point', () => {
    expect(resolveRevLightState(Number.NaN)).toEqual({ pct: 0, atShiftPoint: false })
    expect(resolveRevLightState(Number.POSITIVE_INFINITY)).toEqual({ pct: 0, atShiftPoint: false })
    expect(resolveRevLightState(SHIFT_PCT - 0.001).atShiftPoint).toBe(false)
    expect(resolveRevLightState(SHIFT_PCT).atShiftPoint).toBe(true)
    expect(resolveRevLightState(0.2, true).atShiftPoint).toBe(true)
    expect(resolveRevLightState(0.999, false).atShiftPoint).toBe(false)
    expect(resolveRevLightState(0.2, true).atShiftPoint).toBe(true)
    expect(resolveRevLightState(SHIFT_PCT, undefined).atShiftPoint).toBe(true)
    expect(revFill('#ff0000', true)).toBe(SHIFT_STROBE_BLUE)

    const markup = renderToStaticMarkup(createElement('g', null, createElement(ShiftStrobe, { active: true })))
    expect(markup).toContain('<animate')
    expect(markup).toContain('dur="0.14s"')
    expect(markup).toContain('repeatCount="indefinite"')
    expect(renderToStaticMarkup(createElement(ShiftStrobe, { active: false }))).toBe('')
  })

  it('resolves shift-light fills from the canonical top-slice pipeline', () => {
    expect(resolveRevLightPct({
      rpm: 7990,
      maxRpm: 8000,
      shiftIndicatorPct: 0.2,
      revLights: { pct: 0.8 }
    })).toBe(0.2)
    expect(resolveRevLightPct({
      rpm: 7990,
      maxRpm: 8000,
      revLights: { pct: 0.7 }
    })).toBe(0.7)
    expect(resolveRevLightPct({ rpm: 6000, maxRpm: 8000 })).toBe(0)
    expect(resolveRevLightPct({ rpm: 7920, maxRpm: 8000 })).toBe(1)
  })

  it('keeps true RPM gauge calibration independent from shift lights and blink', () => {
    const snapshot = {
      rpm: 4000,
      maxRpm: 8000,
      shiftIndicatorPct: 0.1,
      revLights: { pct: 0.1, blink: true }
    }
    expect(resolveRpmGaugePct(snapshot)).toBe(0.5)
    expect(resolveRpmGaugePct({ rpm: -100, maxRpm: 8000 })).toBe(0)
    expect(resolveRpmGaugePct({ rpm: 9000, maxRpm: 8000 })).toBe(1)
    expect(resolveRpmGaugePct({ rpm: 4000, maxRpm: 0 })).toBe(0)
  })
})

describe('shared rev-light row layout', () => {
  it('fills wider boxes uniformly while height remains independent', () => {
    const narrow = revLightRowLayout(300, 40, 12, { gap: 4, heightRatio: 0.6 })
    const wide = revLightRowLayout(600, 40, 12, { gap: 4, heightRatio: 0.6 })
    const short = revLightRowLayout(600, 16, 12, { gap: 4, heightRatio: 0.6 })

    expect(narrow.positions[0]).toBe(0)
    expect(narrow.positions.at(-1)! + narrow.ledWidth).toBeCloseTo(300)
    expect(wide.positions.at(-1)! + wide.ledWidth).toBeCloseTo(600)
    expect(wide.ledWidth).toBeGreaterThan(narrow.ledWidth)
    expect(wide.gap).toBe(narrow.gap)
    expect(short.ledWidth).toBe(wide.ledWidth)
    expect(short.positions).toEqual(wide.positions)
    expect(short.ledHeight).toBeLessThan(wide.ledHeight)
  })

  it('never returns invalid geometry', () => {
    const layout = revLightRowLayout(Number.NaN, Number.NEGATIVE_INFINITY, Number.NaN, {
      gap: Number.POSITIVE_INFINITY,
      paddingX: Number.NaN,
      heightRatio: Number.NaN
    })
    expect(JSON.stringify(layout)).not.toMatch(/NaN|Infinity/)
    expect(layout.ledWidth).toBeGreaterThan(0)
    expect(layout.ledHeight).toBeGreaterThan(0)
  })
})
