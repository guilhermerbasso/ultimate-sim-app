import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AnalogDial } from './AnalogDial'

const render = (props: Parameters<typeof AnalogDial>[0]): string =>
  renderToStaticMarkup(createElement(AnalogDial, props))

describe('AnalogDial', () => {
  it('renders an svg gauge with a needle and arc', () => {
    const markup = render({ value: 50, min: 0, max: 100 })
    expect(markup).toContain('<svg')
    expect(markup).toContain('rotate(') // needle transform
    expect(markup).toContain('<path') // d3-shape value arc
  })

  it('clamps the needle to the sweep ends for out-of-range values', () => {
    const high = render({ value: 99999, min: 0, max: 100, startAngleDeg: -135, endAngleDeg: 135 })
    expect(high).toContain('rotate(135)')
    const low = render({ value: -500, min: 0, max: 100, startAngleDeg: -135, endAngleDeg: 135 })
    expect(low).toContain('rotate(-135)')
  })

  it('honours a custom sweep angle', () => {
    const markup = render({ value: 100, min: 0, max: 100, startAngleDeg: -90, endAngleDeg: 90 })
    expect(markup).toContain('rotate(90)')
  })

  it('renders cleanly (no NaN/undefined) at null/extreme values', () => {
    for (const value of [Number.NaN, -1e9, 0, 1e9, Infinity]) {
      const markup = render({ value: value as number, min: 0, max: 100, unit: 'C', label: 'WATER' })
      expect(markup).not.toContain('NaN')
      expect(markup).not.toContain('undefined')
    }
  })

  it('supports a damped needle without throwing', () => {
    const markup = render({ value: 70, min: 0, max: 100, damp: 0.6 })
    expect(markup).toContain('rotate(')
  })

  it('renders a DSEG value readout when showValue', () => {
    const markup = render({ value: 42, showValue: true })
    expect(markup).toContain('DSEG7Classic-Regular')
    expect(markup).toContain('42')
  })

  it('is a pure function of props (no render-body mutation / accumulation)', () => {
    // A damped needle used to mutate a ref during render; the step now lives in an
    // effect, so two identical renders must be byte-for-byte identical.
    const props = { value: 70, min: 0, max: 100, damp: 0.6 } as const
    expect(render(props)).toBe(render(props))
    // On a fresh mount the damped angle equals the target (prev === target).
    expect(render(props)).toContain('rotate(54)') // frac 0.7 over −135..135 → 54°
  })

  it('draws a graduated tick scale (+ redline band) so it reads as a tach', () => {
    const markup = render({ value: 80, min: 0, max: 100, showTicks: true, redlineFrom: 95 })
    // TickScale emits multiple stroked tick paths and uses the FONT_TECH label face.
    expect((markup.match(/<path/g) ?? []).length).toBeGreaterThan(5)
    expect(markup).toContain('Rajdhani') // FONT_TECH token on tick labels
  })

  it('omits tick marks when showTicks is false', () => {
    const withTicks = render({ value: 80, showTicks: true })
    const noTicks = render({ value: 80, showTicks: false })
    expect((noTicks.match(/<path/g) ?? []).length).toBeLessThan(
      (withTicks.match(/<path/g) ?? []).length
    )
  })
})
