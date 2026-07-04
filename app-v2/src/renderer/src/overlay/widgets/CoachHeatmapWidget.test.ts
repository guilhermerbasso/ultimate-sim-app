import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayStylePresetId } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { CoachHeatmapWidget } from './CoachHeatmapWidget'
import { WIDGET_COMPONENTS } from './index'

const defaults = createDefaultOverlaysConfig()
const FAMILIES: OverlayStylePresetId[] = ['minimal', 'neon', 'glass', 'broadcast', 'terminal', 'bauhaus', 'analog', 'heatmap']
function snap(lapDistPct?: number): TelemetrySnapshot { return { sim: 'iracing', connected: true, timestamp: 1, lapDistPct } as unknown as TelemetrySnapshot }
function render(family: OverlayStylePresetId, snapshot: TelemetrySnapshot | null): string {
  return renderToStaticMarkup(createElement(CoachHeatmapWidget, { snapshot, config: { ...defaults.widgets.coachHeatmap, stylePreset: family } }))
}
function clean(out: string): void {
  expect(out).not.toContain('NaN')
  expect(out).not.toContain('undefined')
  expect(out).not.toContain('Infinity')
}

describe('CoachHeatmapWidget instrument conversion', () => {
  it('is registered', () => {
    expect(WIDGET_COMPONENTS.coachHeatmap).toBe(CoachHeatmapWidget)
  })
  it('keeps heatmap geometry while adding lap DataTile and advisory lamp across families', () => {
    for (const family of FAMILIES) for (const s of [null, snap(0.42), snap(Number.NaN)]) {
      const out = render(family, s)
      expect(out).toContain('<svg')
      expect(out).toContain('DSEG7Classic')
      expect(out).toContain('aria-label="LAP')
      clean(out)
    }
  })
})
