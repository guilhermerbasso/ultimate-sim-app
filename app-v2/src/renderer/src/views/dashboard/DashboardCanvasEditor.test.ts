import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DashboardElement } from '../../../../shared/dashboards'
import { CanvasElementVisual } from './DashboardCanvasEditor'

// Regression for "dashboards sem nada dentro": the full-frame dashboard presets
// embed a single `overlaywidget` element carrying a `widgetId`. The editor / IA
// preview canvas dispatches through `renderGt3Widget`, which only knows the
// semantic GT3 element types — so 'overlaywidget' used to fall back to a gray
// FallbackTile (empty). CanvasElementVisual must now mount the real overlay widget
// (mirroring DashboardRoot's live ElementOverlayWidget).

function overlayEl(widgetId: string | undefined, name = 'GT3 — Grid'): DashboardElement {
  return {
    id: 'el-overlay',
    type: 'overlaywidget',
    x: 0,
    y: 0,
    w: 1024,
    h: 600,
    widgetId: widgetId as DashboardElement['widgetId'],
    name,
    style: { background: '#000000', borderWidth: 0, radius: 0 }
  }
}

function render(el: DashboardElement): string {
  return renderToStaticMarkup(createElement(CanvasElementVisual, { element: el }))
}

describe('CanvasElementVisual — overlaywidget embedding (Phase 0)', () => {
  it('mounts the real overlay widget for a known widgetId (not the gray fallback)', () => {
    const markup = render(overlayEl('gridStackDash'))
    // Real GridStackDash content includes its dense GT3 labels.
    expect(markup.length).toBeGreaterThan(200)
    expect(markup).toContain('DELTA')
    expect(markup).toContain('FUEL')
    // The FallbackTile would render only the element name in a sunken tile — the
    // live widget renders far more than that.
    expect(markup).not.toContain('var(--surface-sunken)')
  })

  it('renders real content for every full-frame preset widgetId', () => {
    const ids = ['gridStackDash', 'gridProDash', 'bosch296Dash', 'ringDash', 'lmuEnduranceDash', 'lmuStintDash', 'raceconRc01Dash', 'raceconRc02Dash']
    for (const id of ids) {
      const markup = render(overlayEl(id, id))
      expect(markup.length, `empty render for ${id}`).toBeGreaterThan(150)
      expect(markup, `NaN leaked for ${id}`).not.toContain('NaN')
      expect(markup, `undefined leaked for ${id}`).not.toContain('undefined')
    }
  })

  it('falls back to a labelled tile when the widgetId is missing/unknown', () => {
    const missing = render(overlayEl(undefined, 'Broken Preset'))
    expect(missing).toContain('Broken Preset')
    const unknown = render(overlayEl('doesNotExist', 'Unknown Preset'))
    expect(unknown).toContain('Unknown Preset')
  })
})
