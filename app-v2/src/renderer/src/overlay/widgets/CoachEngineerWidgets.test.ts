import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayWidgetId } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { WIDGET_COMPONENTS } from './index'

const IDS: OverlayWidgetId[] = ['coachTips', 'coachFindings', 'coachSectorGraph', 'engineerFeed']
const defaults = createDefaultOverlaysConfig()
const emptySnapshot = { sim: 'iracing', connected: false, timestamp: 0 } as unknown as TelemetrySnapshot
const badSnapshot = { sim: 'iracing', connected: true, timestamp: 1, speedKmh: Number.POSITIVE_INFINITY } as unknown as TelemetrySnapshot

function renderId(id: OverlayWidgetId, snapshot: TelemetrySnapshot | null): string {
  return renderToStaticMarkup(createElement(WIDGET_COMPONENTS[id], { snapshot, config: defaults.widgets[id] }))
}
function clean(out: string): void {
  expect(out).not.toContain('NaN')
  expect(out).not.toContain('undefined')
  expect(out).not.toContain('Infinity')
}

describe('WS-WIDGETS coach/engineer overlays instrument conversion', () => {
  it('registers all 4 overlays in the widget component map', () => {
    for (const id of IDS) expect(typeof WIDGET_COMPONENTS[id], `dispatcher missing ${id}`).toBe('function')
  })

  it('renders graceful empty states with DataTile/telltale SVG and no invalid numerics', () => {
    for (const id of IDS) for (const snap of [emptySnapshot, badSnapshot, null]) {
      const out = renderId(id, snap)
      expect(out.length, `empty render ${id}`).toBeGreaterThan(10)
      expect(out).toContain('<svg')
      expect(out).toContain('DSEG7Classic')
      expect(out).toContain('aria-label=')
      clean(out)
    }
  })

  it('shows the PT-BR empty copy when there is no coach/engineer data', () => {
    expect(renderId('coachTips', null)).toContain('No tips yet')
    expect(renderId('coachFindings', null)).toContain('No analysis yet')
    expect(renderId('coachSectorGraph', null)).toContain('No sectors yet')
    expect(renderId('engineerFeed', null)).toContain('No messages yet')
  })

  it('uses the condensed motorsport font token and avoids Segoe UI fallback', () => {
    for (const id of IDS) {
      const out = renderId(id, null)
      expect(out).not.toContain('Segoe UI')
      expect(out).toContain('var(--rc-cond')
    }
  })
})
