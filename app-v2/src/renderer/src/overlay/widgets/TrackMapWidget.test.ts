import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayStylePresetId } from '../../../../shared/overlays'
import type { DriverEntry, TelemetrySnapshot } from '../../../../shared/telemetry'
import { TrackMapWidget } from './TrackMapWidget'
import { WIDGET_COMPONENTS } from './index'

const baseConfig = createDefaultOverlaysConfig().widgets.trackMap
const FAMILIES: OverlayStylePresetId[] = ['minimal', 'neon', 'glass', 'broadcast', 'terminal', 'bauhaus', 'analog', 'heatmap']

function driver(carIdx: number, lapDistPct: number | undefined, isPlayer = false): DriverEntry {
  return {
    carIdx,
    name: `Driver ${carIdx}`,
    carNumber: `${carIdx}`,
    position: carIdx,
    classPosition: carIdx,
    classId: 1,
    isPlayer,
    lapDistPct,
    classColor: isPlayer ? '#ff6a00' : '#e7f2ff'
  }
}

function snapshot(overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1,
    trackName: 'Okayama',
    lapDistPct: 0.42,
    playerCarIdx: 7,
    drivers: [driver(7, 0.42, true), driver(12, 0.44), driver(21, 0.39)],
    ...overrides
  } as unknown as TelemetrySnapshot
}

function render(s: TelemetrySnapshot | null, stylePreset: OverlayStylePresetId): string {
  return renderToStaticMarkup(createElement(TrackMapWidget, { snapshot: s, config: { ...baseConfig, stylePreset } }))
}

function assertClean(markup: string, ctx: string): void {
  expect(markup.length, `empty render: ${ctx}`).toBeGreaterThan(80)
  expect(markup, `NaN in ${ctx}`).not.toContain('NaN')
  expect(markup, `undefined in ${ctx}`).not.toContain('undefined')
  expect(markup, `Infinity in ${ctx}`).not.toContain('Infinity')
}

describe('TrackMapWidget', () => {
  it('is registered in the overlay widget component map', () => {
    expect(WIDGET_COMPONENTS.trackMap).toBe(TrackMapWidget)
  })

  it('keeps the map SVG while adding material framing and DSEG lap readouts', () => {
    const markup = render(snapshot(), 'analog')
    assertClean(markup, 'analog')
    expect(markup).toContain('<svg')
    expect(markup).toContain('track map material frame')
    expect(markup).toContain('DSEG7')
    expect(markup).toMatch(/carbon|lap/i)
  })

  it('renders null and extreme lap/map inputs without invalid numbers and shows missing as dash', () => {
    const empty = render(null, 'minimal')
    assertClean(empty, 'null')
    expect(empty).toContain('—')

    const bad = render(snapshot({ lapDistPct: Number.POSITIVE_INFINITY, drivers: [driver(7, Number.NaN, true), driver(8, Number.NEGATIVE_INFINITY)] }), 'heatmap')
    assertClean(bad, 'bad telemetry')
    expect(bad).toContain('—')
  })

  it('renders every supported family with nearby drivers and with none', () => {
    for (const family of FAMILIES) {
      assertClean(render(snapshot(), family), `${family} drivers`)
      assertClean(render(snapshot({ drivers: [] }), family), `${family} none`)
    }
  })
})
