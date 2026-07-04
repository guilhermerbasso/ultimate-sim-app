import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { SessionWeatherWidget } from './SessionWeatherWidget'

const base = createDefaultOverlaysConfig().widgets.gt3Cluster
const FAMILIES = ['minimal', 'glass', 'broadcast', 'terminal', 'bauhaus', 'analog', 'heatmap', 'neon']

function cfg(stylePreset: string): OverlayWidgetConfig {
  return { ...base, stylePreset } as OverlayWidgetConfig
}

function render(snapshot: TelemetrySnapshot | null, stylePreset = 'minimal'): string {
  return renderToStaticMarkup(createElement(SessionWeatherWidget, { snapshot, config: cfg(stylePreset) }))
}

function assertClean(markup: string, ctx: string): void {
  expect(markup.length, `empty render: ${ctx}`).toBeGreaterThan(100)
  expect(markup, `NaN in ${ctx}`).not.toContain('NaN')
  expect(markup, `undefined in ${ctx}`).not.toContain('undefined')
  expect(markup, `Infinity in ${ctx}`).not.toContain('Infinity')
}

const dryDay = {
  sim: 'iracing',
  connected: true,
  timestamp: 1,
  sessionType: 'Practice',
  sessionTimeRemainingSec: 1800,
  trackName: 'Interlagos',
  currentLap: 7,
  currentLapTimeSec: 82.345,
  incidentCount: 0,
  incidentLimit: 17,
  trackTempC: 31,
  isRaining: false,
  trackWetnessPct: 0.02,
  sessionTimeOfDay: 15 * 3600
} as unknown as TelemetrySnapshot

const wetNight = {
  ...dryDay,
  timestamp: 2,
  sessionType: 'Race',
  sessionTimeRemainingSec: 5400,
  isRaining: true,
  weatherDeclaredWet: true,
  trackWetnessPct: 0.7,
  incidentCount: 5,
  trackTempC: 47,
  sessionTimeOfDay: 23 * 3600
} as unknown as TelemetrySnapshot

const extreme = {
  sim: 'iracing',
  connected: true,
  timestamp: 3,
  sessionTimeRemainingSec: Number.POSITIVE_INFINITY,
  currentLap: Number.NaN,
  currentLapTimeSec: Number.NEGATIVE_INFINITY,
  incidentCount: Number.POSITIVE_INFINITY,
  incidentLimit: Number.NaN,
  trackTempC: Number.NaN,
  trackWetnessPct: Number.POSITIVE_INFINITY,
  isRaining: undefined,
  sessionTimeOfDay: Number.NaN
} as unknown as TelemetrySnapshot

describe('SessionWeatherWidget', () => {
  it('renders null and extreme inputs as clean missing data', () => {
    for (const [label, snap] of [['null', null], ['extreme', extreme]] as const) {
      const out = render(snap)
      assertClean(out, label)
      expect(out).toContain('—')
    }
  })

  it('renders weather/session readouts with instrument SVG, DataTile aria labels and DSEG', () => {
    const out = render(dryDay)
    expect(out).toContain('<svg')
    expect(out).toContain('DSEG7')
    expect(out).toContain('VOLTA')
    expect(out).toContain('PISTA')
    expect(out).toContain('31')
    expect(out).toContain('Interlagos')
    expect(out).toContain('Seco')
  })

  it('renders rain/dry and day/night telltale states', () => {
    const wet = render(wetNight)
    const dry = render(dryDay)
    expect(wet).toContain('Chuva')
    expect(wet).toContain('data-rain="1"')
    expect(wet).toContain('data-headlight="1"')
    expect(dry).toContain('Seco')
    expect(dry).toContain('data-rain="0"')
  })

  it('renders across every overlay design family', () => {
    for (const family of FAMILIES) {
      assertClean(render(dryDay, family), `${family}-dry`)
      assertClean(render(wetNight, family), `${family}-wet`)
    }
  })
})
