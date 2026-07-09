import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { resolveSkin } from '../../skins'
import { WeatherWidget } from './WeatherWidget'

const skin = resolveSkin('gt3', 'generic')
const GREEN = skin.palette.ok
const base = createDefaultOverlaysConfig().widgets.gt3Cluster
const COLD_BLUE = '#5b8cff'
const FAMILIES = ['minimal', 'glass', 'broadcast', 'terminal', 'bauhaus', 'analog', 'heatmap', 'neon']

function cfg(stylePreset: string): OverlayWidgetConfig {
  return { ...base, stylePreset } as OverlayWidgetConfig
}

function render(snapshot: TelemetrySnapshot | null, stylePreset = 'minimal'): string {
  return renderToStaticMarkup(createElement(WeatherWidget, { snapshot, config: cfg(stylePreset) }))
}

function assertClean(markup: string, ctx: string): void {
  expect(markup.length, `empty render: ${ctx}`).toBeGreaterThan(100)
  expect(markup, `NaN in ${ctx}`).not.toContain('NaN')
  expect(markup, `undefined in ${ctx}`).not.toContain('undefined')
  expect(markup, `Infinity in ${ctx}`).not.toContain('Infinity')
}

const dry = {
  sim: 'iracing',
  connected: true,
  timestamp: 1,
  isRaining: false,
  trackWetnessPct: 0.05,
  gripPct: 0.95,
  airTempC: 22,
  trackTempC: 30,
  sessionTimeOfDay: 14 * 3600
} as unknown as TelemetrySnapshot

const rainNight = {
  ...dry,
  timestamp: 2,
  isRaining: true,
  trackWetnessPct: 0.62,
  gripPct: 0.54,
  airTempC: 18,
  trackTempC: 46,
  weatherDeclaredWet: true,
  sessionTimeOfDay: 22 * 3600
} as unknown as TelemetrySnapshot

const noGrip = {
  sim: 'iracing',
  connected: true,
  timestamp: 3,
  isRaining: false
} as unknown as TelemetrySnapshot

const extreme = {
  sim: 'iracing',
  connected: true,
  timestamp: 4,
  isRaining: false,
  trackWetnessPct: Number.NaN,
  gripPct: Number.POSITIVE_INFINITY,
  airTempC: Number.NEGATIVE_INFINITY,
  trackTempC: Number.NaN,
  sessionTimeOfDay: Number.POSITIVE_INFINITY
} as unknown as TelemetrySnapshot

describe('WeatherWidget missing-data hygiene', () => {
  it('does not claim "Dry" or fabricate 0% wet / 100% grip when weather is absent', () => {
    const out = render(null)
    assertClean(out, 'null')
    expect(out, 'no confident dry').not.toContain('Dry')
    expect(out, 'no fake full grip').not.toContain('>100%')
    expect(out).toContain('—')
  })

  it('renders grip as "—" when the grip field is missing (not 100%)', () => {
    const out = render(noGrip)
    assertClean(out, 'noGrip')
    expect(out).toContain('—')
    expect(out).not.toContain('>100%')
  })

  it('renders a known dry snapshot with instrument SVG DataTiles and DSEG numeric faces', () => {
    const out = render(dry)
    expect(out).toContain('<svg')
    expect(out).toContain('DSEG7')
    expect(out).toContain('AIR')
    expect(out).toContain('22')
    expect(out).toContain('TRACK')
    expect(out).toContain('30')
    expect(out).toContain('Dry')
    expect(out).toContain('95')
  })

  it('renders rain/night state through active telltales only when active', () => {
    const wet = render(rainNight)
    const day = render(dry)
    expect(wet).toContain('Rain')
    expect(wet).toContain('data-rain="1"')
    expect(wet).toContain('data-headlight="1"')
    expect(day).toContain('data-rain="0"')
  })

  it('renders every design family without leaking invalid numbers', () => {
    for (const family of FAMILIES) {
      assertClean(render(rainNight, family), family)
      assertClean(render(extreme, family), `${family}-extreme`)
    }
  })

  it('uses no decorative cool blue for low wetness (heatmap family)', () => {
    const out = render(dry, 'heatmap')
    expect(out).not.toContain(COLD_BLUE)
    expect(out).toContain(GREEN)
  })
})
