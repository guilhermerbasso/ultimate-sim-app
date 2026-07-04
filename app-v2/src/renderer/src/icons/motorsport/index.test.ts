import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  MOTORSPORT_ICONS,
  MOTORSPORT_ICON_IDS,
  MotorsportGlyph,
  type MotorsportIconId
} from './index'

describe('motorsport icon registry', () => {
  it('exposes every icon id in the registry', () => {
    expect(MOTORSPORT_ICON_IDS.length).toBe(Object.keys(MOTORSPORT_ICONS).length)
    expect(MOTORSPORT_ICON_IDS).toContain('flag-checkered')
    expect(MOTORSPORT_ICON_IDS).toContain('tc-off')
    expect(MOTORSPORT_ICON_IDS).toContain('pit-limiter')
  })

  it('renders a valid <svg> for every icon', () => {
    for (const id of MOTORSPORT_ICON_IDS) {
      const markup = renderToStaticMarkup(createElement(MOTORSPORT_ICONS[id]))
      expect(markup, id).toContain('<svg')
      expect(markup, id).toContain('viewBox="0 0 24 24"')
    }
  })

  it('drives hue through currentColor (parent-controlled)', () => {
    const markup = renderToStaticMarkup(createElement(MOTORSPORT_ICONS['flag-yellow']))
    expect(markup).toContain('currentColor')
  })

  it('forwards svg props (style/className) through each glyph', () => {
    const markup = renderToStaticMarkup(
      createElement(MOTORSPORT_ICONS.abs, { className: 'sym-ico', width: 28 })
    )
    expect(markup).toContain('class="sym-ico"')
    expect(markup).toContain('width="28"')
  })

  it('MotorsportGlyph resolves a known id and returns null for an unknown one', () => {
    const ok = renderToStaticMarkup(createElement(MotorsportGlyph, { id: 'flag-red' }))
    expect(ok).toContain('<svg')
    const bad = renderToStaticMarkup(
      createElement(MotorsportGlyph, { id: 'does-not-exist' as MotorsportIconId })
    )
    expect(bad).toBe('')
  })
})
