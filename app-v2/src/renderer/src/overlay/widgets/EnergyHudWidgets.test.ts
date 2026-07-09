import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayStylePresetId, OverlayWidgetId } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { WIDGET_COMPONENTS } from './index'
import { ErsBarWidget, ErsBatteryWidget, ErsFlowWidget, PushToPassHudWidget, PushToPassPipsWidget } from './EnergyHudWidgets'

const defaults = createDefaultOverlaysConfig()
const FAMILIES: OverlayStylePresetId[] = ['minimal', 'neon', 'glass', 'broadcast', 'terminal', 'bauhaus', 'analog', 'heatmap']
const IDS: OverlayWidgetId[] = ['ersBar', 'ersBattery', 'ersFlow', 'pushToPassHud', 'pushToPassPips']

function snap(): TelemetrySnapshot {
  return { sim: 'iracing', connected: true, timestamp: 1, ersBatteryPct: 0.68, pushToPass: true, pushToPassCount: 4 } as unknown as TelemetrySnapshot
}
function bad(): TelemetrySnapshot {
  return { sim: 'iracing', connected: true, timestamp: 1, ersBatteryPct: Number.NaN, pushToPass: false, pushToPassCount: Number.POSITIVE_INFINITY } as unknown as TelemetrySnapshot
}
function renderId(id: OverlayWidgetId, family: OverlayStylePresetId, snapshot: TelemetrySnapshot | null): string {
  return renderToStaticMarkup(createElement(WIDGET_COMPONENTS[id], { snapshot, config: { ...defaults.widgets[id], stylePreset: family } }))
}
function clean(out: string): void {
  expect(out).not.toContain('NaN')
  expect(out).not.toContain('undefined')
  expect(out).not.toContain('Infinity')
}

describe('EnergyHudWidgets instrument conversion', () => {
  it('registers all energy widgets', () => {
    expect(WIDGET_COMPONENTS.ersBar).toBe(ErsBarWidget)
    expect(WIDGET_COMPONENTS.ersBattery).toBe(ErsBatteryWidget)
    expect(WIDGET_COMPONENTS.ersFlow).toBe(ErsFlowWidget)
    expect(WIDGET_COMPONENTS.pushToPassHud).toBe(PushToPassHudWidget)
    expect(WIDGET_COMPONENTS.pushToPassPips).toBe(PushToPassPipsWidget)
  })
  it('renders DSEG DataTiles, SVG LED bars/lamps, and no invalid numerics across families', () => {
    const normalSnap = snap()
    const badSnap = bad()
    for (const id of IDS) for (const family of FAMILIES) for (const s of [null, normalSnap, badSnap]) {
      const out = renderId(id, family, s)
      expect(out).toContain('<svg')
      if (s !== null && s !== badSnap) expect(out).toContain('DSEG7Classic')
      expect(out).toContain('aria-label=')
      clean(out)
    }
  })
  it('uses em dash for missing energy/P2P data', () => {
    expect(renderId('ersBattery', 'minimal', null)).toContain('—')
    expect(renderId('pushToPassHud', 'minimal', null)).toContain('—')
  })
  it('renders opaque stretch panels for energy/P2P widgets', () => {
    for (const id of IDS) {
      const out = renderId(id, 'minimal', snap())
      expect(out).toContain('preserveAspectRatio="none"')
      expect(out).toContain('fill-opacity="1"')
    }
  })
})
