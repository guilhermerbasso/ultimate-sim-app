import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayStylePresetId } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { TeamFuelWidget } from './TeamFuelWidget'
import { WIDGET_COMPONENTS } from './index'

const defaults = createDefaultOverlaysConfig()
const FAMILIES: OverlayStylePresetId[] = ['minimal', 'neon', 'glass', 'broadcast', 'terminal', 'bauhaus', 'analog', 'heatmap']
const emptySnapshot = { sim: 'iracing', connected: false, timestamp: 0 } as unknown as TelemetrySnapshot

function render(family: OverlayStylePresetId): string {
  return renderToStaticMarkup(createElement(TeamFuelWidget, { snapshot: emptySnapshot, config: { ...defaults.widgets.teamFuel, stylePreset: family } }))
}
function clean(out: string): void {
  expect(out).not.toContain('NaN')
  expect(out).not.toContain('undefined')
  expect(out).not.toContain('Infinity')
}

describe('TeamFuelWidget instrument conversion', () => {
  it('is registered', () => {
    expect(WIDGET_COMPONENTS.teamFuel).toBe(TeamFuelWidget)
  })
  it('renders team DataTile/lamp SVG across families and keeps empty state safe', () => {
    for (const family of FAMILIES) {
      const out = render(family)
      expect(out).toContain('<svg')
      expect(out).toContain('DSEG7')
      expect(out).toContain('TEAM')
      expect(out.toLowerCase()).toContain('room offline')
      clean(out)
    }
  })
})
