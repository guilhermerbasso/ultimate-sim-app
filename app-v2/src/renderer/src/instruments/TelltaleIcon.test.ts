import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TelltaleIcon, TelltaleBank } from './TelltaleIcon'

const renderIcon = (props: Parameters<typeof TelltaleIcon>[0]): string =>
  renderToStaticMarkup(createElement(TelltaleIcon, props))
const renderBank = (props: Parameters<typeof TelltaleBank>[0]): string =>
  renderToStaticMarkup(createElement(TelltaleBank, props))

describe('TelltaleIcon', () => {
  it('reuses a registry glyph and renders an svg', () => {
    const markup = renderIcon({ icon: 'abs', active: true })
    expect(markup).toContain('<svg')
  })

  it('glows (feGaussianBlur) only when lit', () => {
    expect(renderIcon({ icon: 'tc', active: true, glow: true })).toContain('feGaussianBlur')
    expect(renderIcon({ icon: 'tc', active: false, glow: true })).not.toContain('feGaussianBlur')
  })

  it('dims inactive lamps and drives hue via currentColor', () => {
    const off = renderIcon({ icon: 'fuel', active: false })
    expect(off).toContain('opacity="0.5"')
    expect(off).toContain('currentColor')
  })

  it('renders cleanly for every degenerate size', () => {
    for (const size of [Number.NaN, 0, -4]) {
      const markup = renderIcon({ icon: 'rain', size: size as number })
      expect(markup).not.toContain('NaN')
      expect(markup).not.toContain('undefined')
    }
  })
})

describe('TelltaleBank', () => {
  it('lays out multiple lamps and glows only the active ones', () => {
    const markup = renderBank({
      lamps: [
        { icon: 'abs', active: true },
        { icon: 'tc', active: false },
        { icon: 'fuel', active: true }
      ],
      columns: 3
    })
    expect(markup).toContain('<svg')
    // two active lamps → two bloom filters present (count opening <filter tags)
    expect((markup.match(/<filter/g) ?? []).length).toBe(2)
  })

  it('tolerates an empty lamp list', () => {
    const markup = renderBank({ lamps: [] })
    expect(markup).toContain('<svg')
    expect(markup).not.toContain('NaN')
  })
})
