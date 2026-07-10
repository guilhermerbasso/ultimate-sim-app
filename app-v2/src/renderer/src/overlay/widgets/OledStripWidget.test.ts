import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig, OVERLAY_WIDGETS } from '../../../../shared/overlays'
import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { widgetSupportedSims } from '../../../../shared/sim-coverage'
import { DASH } from './dashboard-tiles'
import { OledStripWidget } from './OledStripWidget'

const config: OverlayWidgetConfig = createDefaultOverlaysConfig().widgets.oledStrip

function render(snapshot: TelemetrySnapshot | null): string {
  return renderToStaticMarkup(createElement(OledStripWidget, { snapshot, config }))
}

function assertClean(markup: string, ctx: string): void {
  expect(markup.length, `empty render: ${ctx}`).toBeGreaterThan(100)
  expect(markup, `NaN in ${ctx}`).not.toContain('NaN')
  expect(markup, `undefined in ${ctx}`).not.toContain('undefined')
  expect(markup, `Infinity in ${ctx}`).not.toContain('Infinity')
}

const populated = {
  sim: 'acc', connected: true, timestamp: 1,
  gear: 4, speedKmh: 198.7, rpm: 7200, maxRpm: 8500,
  shiftIndicatorPct: 0.7, deltaToBestSec: -0.08, fuelLiters: 33.6
} as unknown as TelemetrySnapshot

const extreme = {
  sim: 'iracing', connected: true, timestamp: 1,
  gear: 0, speedKmh: 0, rpm: 0, maxRpm: 9000,
  shiftIndicatorPct: 1.2, deltaToBestSec: 3.91, fuelLiters: 0
} as unknown as TelemetrySnapshot

describe('OledStripWidget', () => {
  it('renders null / populated / extreme snapshots NaN-undefined-Infinity-free', () => {
    for (const [label, snap] of [
      ['null', null],
      ['populated', populated],
      ['extreme', extreme]
    ] as Array<[string, TelemetrySnapshot | null]>) {
      let out = ''
      expect(() => { out = render(snap) }, `${label} render`).not.toThrow()
      assertClean(out, label)
    }
  })

  it('degrades a null snapshot to "—" with visible segments + LED bar present', () => {
    const out = render(null)
    expect(out).toContain('GEAR')
    expect(out).toContain('DELTA')
    expect(out).toContain('FUEL')
    expect(out).toContain('—')
    expect(out).toContain('led-shift-bar')
  })

  it('shows gear / rounded speed / fuel and greens the delta only when up', () => {
    const out = render(populated)
    expect(out).toContain('>4<')
    expect(out).toContain('199')
    expect(out).toContain('33.6')
    expect(out, 'up lap → green delta').toContain(DASH.green)
    expect(render(extreme), 'down lap → amber delta').toContain(DASH.amber)
  })

  it('uses DSEG for numerals and condensed (--rc-cond) for labels', () => {
    const out = render(populated)
    expect(out).toContain('DSEG7Classic-Regular')
    expect(out).toContain('--rc-cond')
    expect(out, 'speed numeral DSEG').toMatch(/DSEG7Classic-Regular[^>]*>199/)
    expect(out, 'fuel numeral DSEG').toMatch(/DSEG7Classic-Regular[^>]*>33\.6/)
  })

  it('is registered per-yes with requires=[gear,speedKmh] → available on every yes', () => {
    const def = OVERLAY_WIDGETS.find((w) => w.id === 'oledStrip')
    expect(def?.requires).toEqual(['gear', 'speedKmh'])
    expect(widgetSupportedSims(def?.requires)).toEqual(['iracing', 'acc', 'ac', 'ams2', 'lmu'])
  })
})
