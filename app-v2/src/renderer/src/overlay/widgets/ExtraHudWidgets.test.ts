import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayStylePresetId } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { NeonGearBarWidget, ApexRadarWidget, DeltaBarWidget, LapReadoutWidget } from './ExtraHudWidgets'
import { WIDGET_COMPONENTS } from './index'

const defaults = createDefaultOverlaysConfig()
const FAMILIES: OverlayStylePresetId[] = ['minimal', 'neon', 'glass', 'broadcast', 'terminal', 'bauhaus', 'analog', 'heatmap']
const widgets = [
  ['neonGearBar', NeonGearBarWidget],
  ['apexRadar', ApexRadarWidget],
  ['deltaBar', DeltaBarWidget],
  ['lapReadout', LapReadoutWidget]
] as const

function snap(): TelemetrySnapshot {
  return { sim: 'iracing', connected: true, timestamp: 1, gear: 5, speedKmh: 214, shiftIndicatorPct: 0.8, deltaToBestSec: -0.12, lastLapTimeSec: 91.234, bestLapTimeSec: 90.123, radarCars: [{ carIdx: 7, relativeX: 2, relativeY: 1 }] } as unknown as TelemetrySnapshot
}
function bad(): TelemetrySnapshot {
  return { ...snap(), gear: Number.NaN, speedKmh: Number.POSITIVE_INFINITY, rpm: Number.NaN, maxRpm: 0, deltaToBestSec: Number.NaN, lastLapTimeSec: Number.POSITIVE_INFINITY } as unknown as TelemetrySnapshot
}
function render(Component: (props: any) => any, family: OverlayStylePresetId, snapshot: TelemetrySnapshot | null): string {
  return renderToStaticMarkup(createElement(Component, { snapshot, config: { ...defaults.widgets.neonGearBar, stylePreset: family } }))
}
function clean(markup: string): void {
  expect(markup).not.toContain('NaN')
  expect(markup).not.toContain('undefined')
  expect(markup).not.toContain('Infinity')
}

describe('ExtraHudWidgets instrument conversion', () => {
  it('keeps every extra HUD widget registered', () => {
    for (const [id, Component] of widgets) expect(WIDGET_COMPONENTS[id]).toBe(Component)
  })
  it('renders instrument SVG, DSEG readouts, and clean fallback values across families', () => {
    const normalSnap = snap()
    const badSnap = bad()
    for (const [, Component] of widgets) for (const family of FAMILIES) for (const s of [null, normalSnap, badSnap]) {
      const out = render(Component, family, s)
      clean(out)
      if (Component !== ApexRadarWidget && s !== null && s !== badSnap) expect(out).toContain('DSEG7Classic')
    }
  })
  it('emits DataTile aria labels and lamp glyphs where converted', () => {
    expect(render(NeonGearBarWidget, 'minimal', snap())).toContain('aria-label="SPD')
    expect(render(ApexRadarWidget, 'minimal', snap())).toContain('aria-label="ALONGSIDE"')
    expect(render(DeltaBarWidget, 'minimal', null)).toContain('—')
  })
})
