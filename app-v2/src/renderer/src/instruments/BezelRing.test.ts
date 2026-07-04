import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BezelRing } from './BezelRing'

const render = (props: Parameters<typeof BezelRing>[0]): string =>
  renderToStaticMarkup(createElement(BezelRing, props))

describe('BezelRing', () => {
  it('renders layered circles for a chrome bezel', () => {
    const markup = render({ size: 200, kind: 'chrome' })
    expect(markup).toContain('<svg')
    expect((markup.match(/<circle/g) ?? []).length).toBeGreaterThanOrEqual(3)
    expect(markup).toContain('linearGradient')
  })

  it('renders a single face circle for kind=none', () => {
    const markup = render({ size: 120, kind: 'none' })
    expect(markup).toContain('<circle')
  })

  it('adds a carbon-weave pattern when material=carbon', () => {
    const markup = render({ size: 160, material: 'carbon' })
    expect(markup).toContain('<pattern')
  })

  it('renders cleanly at degenerate sizes', () => {
    for (const size of [Number.NaN, 0, -10, 8]) {
      const markup = render({ size: size as number })
      expect(markup).not.toContain('NaN')
      expect(markup).not.toContain('undefined')
    }
  })
})
