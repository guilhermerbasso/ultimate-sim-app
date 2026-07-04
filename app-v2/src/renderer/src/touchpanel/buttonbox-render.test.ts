import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createButtonBoxPanel } from '../../../shared/touch-panel'
import { ButtonBoxRenderer } from './ButtonBoxRenderer'

describe('ButtonBoxRenderer (static markup)', () => {
  it('renders one <button> per panel button', () => {
    const panel = createButtonBoxPanel({ columns: 3, rows: 2 })
    const html = renderToStaticMarkup(createElement(ButtonBoxRenderer, { panel, interactive: false }))
    const count = (html.match(/<button/g) ?? []).length
    expect(count).toBe(panel.buttons.length)
  })

  it('applies the per-button body and text colours inline', () => {
    const panel = createButtonBoxPanel({
      columns: 1,
      rows: 1,
      buttons: [
        {
          label: 'BOX BOX',
          bodyColor: '#ff0044',
          textColor: '#ffffff',
          borderColor: '#ff88aa'
        }
      ]
    })
    const html = renderToStaticMarkup(createElement(ButtonBoxRenderer, { panel, interactive: false }))
    expect(html).toContain('BOX BOX')
    expect(html).toContain('#ff0044')
    expect(html).toContain('#ff88aa')
  })

  it('renders an <img> face when a button has an image data-URL', () => {
    const panel = createButtonBoxPanel({
      columns: 1,
      rows: 1,
      buttons: [{ label: '', image: 'data:image/png;base64,AAAA' }]
    })
    const html = renderToStaticMarkup(createElement(ButtonBoxRenderer, { panel, interactive: false }))
    expect(html).toContain('<img')
    expect(html).toContain('data:image/png;base64,AAAA')
  })

  it('marks fully blank buttons with the is-empty class', () => {
    const panel = createButtonBoxPanel({
      columns: 1,
      rows: 1,
      buttons: [{ label: '' }]
    })
    const html = renderToStaticMarkup(createElement(ButtonBoxRenderer, { panel, interactive: false }))
    expect(html).toContain('is-empty')
  })

  it('applies custom pressed/active colours as inline CSS vars', () => {
    const panel = createButtonBoxPanel({
      columns: 1,
      rows: 1,
      buttons: [
        {
          label: 'PIT',
          bodyColor: '#101010',
          textColor: '#202020',
          activeColor: '#00ff88',
          activeTextColor: '#ff0088'
        }
      ]
    })
    const html = renderToStaticMarkup(createElement(ButtonBoxRenderer, { panel, interactive: false }))
    expect(html).toContain('--bb-active-bg:#00ff88')
    expect(html).toContain('--bb-active-fg:#ff0088')
  })

  it('falls back the active CSS vars to the button body/text colours', () => {
    const panel = createButtonBoxPanel({
      columns: 1,
      rows: 1,
      buttons: [{ label: 'X', bodyColor: '#abcdef', textColor: '#fedcba' }]
    })
    const html = renderToStaticMarkup(createElement(ButtonBoxRenderer, { panel, interactive: false }))
    expect(html).toContain('--bb-active-bg:#abcdef')
    expect(html).toContain('--bb-active-fg:#fedcba')
  })

  it('honours the row count via grid-template-rows and renders columns*rows cells', () => {
    const panel = createButtonBoxPanel({ columns: 4, rows: 3 })
    const html = renderToStaticMarkup(createElement(ButtonBoxRenderer, { panel, interactive: false }))
    expect(panel.buttons).toHaveLength(12)
    expect((html.match(/<button/g) ?? []).length).toBe(12)
    expect(html).toContain('grid-template-rows:repeat(3')
  })
})
