import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TickScale, pointOnArc } from './TickScale'
import { Needle } from './Needle'

const renderTicks = (props: Parameters<typeof TickScale>[0]): string =>
  renderToStaticMarkup(createElement(TickScale, props))
const renderNeedle = (props: Parameters<typeof Needle>[0]): string =>
  renderToStaticMarkup(createElement(Needle, props))

describe('TickScale', () => {
  it('renders major tick paths and labels via d3-shape line', () => {
    const markup = renderTicks({
      cx: 100,
      cy: 100,
      radius: 90,
      startAngleDeg: -135,
      endAngleDeg: 135,
      majorTicks: 5,
      min: 0,
      max: 200
    })
    expect(markup).toContain('<path')
    expect(markup).toContain('200') // top-of-scale label
  })

  it('renders minor ticks between majors', () => {
    const markup = renderTicks({
      cx: 50,
      cy: 50,
      radius: 40,
      startAngleDeg: -120,
      endAngleDeg: 120,
      majorTicks: 3,
      minorPerMajor: 4,
      showLabels: false
    })
    expect((markup.match(/<path/g) ?? []).length).toBeGreaterThan(3)
  })

  it('pointOnArc puts 0° straight up and 90° to the right', () => {
    const [ux, uy] = pointOnArc(0, 0, 10, 0)
    expect(Math.round(ux)).toBe(0)
    expect(Math.round(uy)).toBe(-10)
    const [rx, ry] = pointOnArc(0, 0, 10, 90)
    expect(Math.round(rx)).toBe(10)
    expect(Math.abs(Math.round(ry))).toBe(0)
  })

  it('renders cleanly at degenerate inputs', () => {
    const markup = renderTicks({
      cx: 0,
      cy: 0,
      radius: Number.NaN,
      startAngleDeg: Number.NaN,
      endAngleDeg: Number.NaN,
      majorTicks: 0
    })
    expect(markup).not.toContain('NaN')
    expect(markup).not.toContain('undefined')
  })
})

describe('Needle', () => {
  it('renders a rotated needle polygon and hub', () => {
    const markup = renderNeedle({ cx: 100, cy: 100, length: 80, angleDeg: 45 })
    expect(markup).toContain('rotate(45)')
    expect(markup).toContain('<polygon')
    expect(markup).toContain('<circle')
  })

  it('renders cleanly at degenerate inputs', () => {
    const markup = renderNeedle({ cx: 0, cy: 0, length: Number.NaN, angleDeg: Number.NaN })
    expect(markup).not.toContain('NaN')
    expect(markup).not.toContain('undefined')
  })
})
