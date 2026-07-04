import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayStylePresetId } from '../../../../shared/overlays'
import type { RadarCarEntry, TelemetrySnapshot } from '../../../../shared/telemetry'
import { resolveSkin } from '../../skins'
import { ProximityRadarWidget } from './ProximityRadarWidget'
import { WIDGET_COMPONENTS } from './index'

const baseConfig = createDefaultOverlaysConfig().widgets.proximityRadar
const skin = resolveSkin('gt3', 'generic')
const FAMILIES: OverlayStylePresetId[] = ['minimal', 'neon', 'glass', 'broadcast', 'terminal', 'bauhaus', 'analog', 'heatmap']

function car(carIdx: number, relativeX: number, relativeY: number, classColor = '#ff6a00'): RadarCarEntry {
  return { carIdx, name: `Car ${carIdx}`, relativeX, relativeY, classColor }
}

function snapshot(radarCars?: RadarCarEntry[]): TelemetrySnapshot {
  return { sim: 'iracing', connected: true, timestamp: 1, radarCars } as unknown as TelemetrySnapshot
}

function render(s: TelemetrySnapshot | null, stylePreset: OverlayStylePresetId): string {
  return renderToStaticMarkup(createElement(ProximityRadarWidget, { snapshot: s, config: { ...baseConfig, stylePreset } }))
}

function assertClean(markup: string, ctx: string): void {
  expect(markup.length, `empty render: ${ctx}`).toBeGreaterThan(80)
  expect(markup, `NaN in ${ctx}`).not.toContain('NaN')
  expect(markup, `undefined in ${ctx}`).not.toContain('undefined')
  expect(markup, `Infinity in ${ctx}`).not.toContain('Infinity')
}

describe('ProximityRadarWidget', () => {
  it('is registered in the overlay widget component map', () => {
    expect(WIDGET_COMPONENTS.proximityRadar).toBe(ProximityRadarWidget)
  })

  it('renders single-root SVG, DSEG readouts, radar field, and threat-coloured blips', () => {
    const markup = render(snapshot([car(1, -2.2, 0.4), car(2, 3.1, -1.1), car(3, 1.5, 18)]), 'analog')
    assertClean(markup, 'analog populated')
    expect(markup).toContain('<svg')
    expect(markup).toContain(skin.segment.numeric)
    expect(markup).toMatch(/carbon|track|cars/i)
    expect(markup).toContain('data-widget="proximityRadar"')
    expect(markup, 'alongside car painted red').toContain('#ff2d2d')
  })

  it('renders null and extreme proximity inputs without leaking invalid numbers and shows missing as dash', () => {
    const empty = render(null, 'minimal')
    assertClean(empty, 'null')
    expect(empty).toContain('—')

    const bad = render(snapshot([car(1, Number.NaN, 0), car(2, Number.POSITIVE_INFINITY, 1), car(3, -4, Number.NEGATIVE_INFINITY)]), 'heatmap')
    assertClean(bad, 'bad telemetry')
    expect(bad).toContain('—')
  })

  it('renders every supported family with several nearby cars and with none', () => {
    for (const family of FAMILIES) {
      assertClean(render(snapshot([car(1, -2, 0), car(2, 2, 1), car(3, 0.5, 14)]), family), `${family} cars`)
      assertClean(render(snapshot([]), family), `${family} none`)
    }
  })
})
