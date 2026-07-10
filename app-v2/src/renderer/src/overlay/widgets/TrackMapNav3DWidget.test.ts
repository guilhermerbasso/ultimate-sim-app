import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { DriverEntry, TelemetrySnapshot } from '../../../../shared/telemetry'
import { TrackMapNav3DWidget } from './TrackMapNav3DWidget'
import { WIDGET_COMPONENTS } from './index'

const baseConfig = createDefaultOverlaysConfig().widgets.trackMapNav3D

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
    classColor: isPlayer ? '#45e9ff' : '#b05cff'
  }
}

function snapshot(): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1,
    speedKmh: 124,
    rpm: 7200,
    gear: 3,
    throttle: 0.7,
    brake: 0,
    clutch: 0,
    trackName: 'Spa-Francorchamps',
    lapDistPct: 0.42,
    playerCarIdx: 7,
    drivers: [driver(7, 0.42, true), driver(12, 0.44), driver(21, 0.38)]
  } as TelemetrySnapshot
}

function render(s: TelemetrySnapshot | null): string {
  return renderToStaticMarkup(createElement(TrackMapNav3DWidget, { snapshot: s, config: baseConfig }))
}

describe('TrackMapNav3DWidget', () => {
  it('is registered in the overlay widget component map', () => {
    expect(WIDGET_COMPONENTS.trackMapNav3D).toBe(TrackMapNav3DWidget)
  })

  it('SSR-renders the SVG track-map fallback without telemetry', () => {
    const markup = render(null)
    expect(markup).toContain('data-widget="trackMapNav3D"')
    expect(markup).toContain('data-fallback="svg"')
    expect(markup).toContain('<svg')
    expect(markup).not.toContain('NaN')
    expect(markup).not.toContain('Infinity')
  })

  it('SSR-renders the SVG track-map fallback with populated telemetry', () => {
    const markup = render(snapshot())
    expect(markup).toContain('data-widget="trackMapNav3D"')
    expect(markup).toContain('data-widget="trackMap"')
    expect(markup).toContain('<svg')
    expect(markup).not.toContain('NaN')
    expect(markup).not.toContain('Infinity')
  })
})
