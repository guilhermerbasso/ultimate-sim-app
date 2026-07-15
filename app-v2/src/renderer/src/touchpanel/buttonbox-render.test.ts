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

  it('renders rocker and LED-ring material chrome', () => {
    const panel = createButtonBoxPanel({
      columns: 2,
      rows: 1,
      buttons: [
        { label: 'TC-', material: 'rocker', borderColor: '#22d3ee' },
        { label: 'RADIO', material: 'led_ring', borderColor: '#f59e0b' }
      ]
    })
    const html = renderToStaticMarkup(createElement(ButtonBoxRenderer, { panel, interactive: false }))
    expect(html).toContain('bb-mat-rocker')
    expect(html).toContain('bb-rocker-plus')
    expect(html).toContain('bb-mat-led_ring')
    expect(html).toContain('bb-led-ring')
  })

  it('matches the semantic control-family renderer snapshot', () => {
    const none = { kind: 'none' } as const
    const panel = createButtonBoxPanel({
      id: 'semantic-snapshot',
      columns: 4,
      rows: 2,
      buttons: [
        { id: 'momentary', label: 'PIT', shape: 'round', control: { kind: 'momentary', action: none } },
        { id: 'toggle', label: 'LIGHTS', shape: 'pill', state: { active: true }, control: { kind: 'latching-toggle', onAction: none, offAction: none } },
        { id: 'rocker', label: 'TC', shape: 'rocker', control: { kind: 'two-position-rocker', negativeAction: none, positiveAction: none, negativeLabel: 'TC down', positiveLabel: 'TC up' } },
        { id: 'guard', label: 'IGNITION', shape: 'guarded', control: { kind: 'guarded-two-step', action: none, armTimeoutMs: 4000 } },
        { id: 'rotary', label: 'ABS', shape: 'rotary', control: { kind: 'rotary', decrementAction: none, incrementAction: none, decrementLabel: 'ABS down', incrementLabel: 'ABS up', repeat: { delayMs: 420, intervalMs: 120 } } },
        { id: 'selector', label: 'MAP', control: { kind: 'selector', initialChoiceId: 'map-1', choices: [{ id: 'map-1', label: 'MAP 1', value: '1', action: none }, { id: 'map-2', label: 'MAP 2', value: '2', action: none }] } },
        { id: 'status', label: 'ENGINE', shape: 'status', state: { warning: true }, control: { kind: 'status-led', value: 'HOT' } },
        { id: 'value', label: 'FUEL', shape: 'wide', control: { kind: 'value-tile', value: '52.1', unit: 'L' } }
      ]
    })
    const html = renderToStaticMarkup(createElement(ButtonBoxRenderer, { panel, interactive: false }))
    expect(html).toMatchSnapshot()
  })})
