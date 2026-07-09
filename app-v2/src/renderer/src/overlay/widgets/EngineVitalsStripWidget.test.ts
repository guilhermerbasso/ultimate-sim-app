import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig, OVERLAY_WIDGETS } from '../../../../shared/overlays'
import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { widgetSupportedSims } from '../../../../shared/sim-coverage'
import { resolveSkin } from '../../skins'
import { EngineVitalsStripWidget } from './EngineVitalsStripWidget'

const config: OverlayWidgetConfig = createDefaultOverlaysConfig().widgets.engineVitalsStrip
const skin = resolveSkin('gt3', 'generic')

function render(snapshot: TelemetrySnapshot | null): string {
  return renderToStaticMarkup(createElement(EngineVitalsStripWidget, { snapshot, config }))
}

function assertClean(markup: string, ctx: string): void {
  expect(markup.length, `empty render: ${ctx}`).toBeGreaterThan(100)
  expect(markup, `NaN in ${ctx}`).not.toContain('NaN')
  expect(markup, `undefined in ${ctx}`).not.toContain('undefined')
  expect(markup, `Infinity in ${ctx}`).not.toContain('Infinity')
}

const healthy = {
  sim: 'iracing', connected: true, timestamp: 1,
  rpm: 5800,
  waterTempC: 88, oilTempC: 95, oilPressureKpa: 420,
  fuelLiters: 30, fuelCapacityLiters: 60
} as unknown as TelemetrySnapshot

const alarm = {
  sim: 'iracing', connected: true, timestamp: 2,
  rpm: 7000,
  waterTempC: 118, oilTempC: 142, oilPressureKpa: 180,
  fuelLiters: 5, fuelCapacityLiters: 60
} as unknown as TelemetrySnapshot

const extreme = {
  sim: 'iracing', connected: true, timestamp: 3,
  rpm: 0,
  waterTempC: 200, oilTempC: 250, oilPressureKpa: 0,
  fuelLiters: 0, fuelCapacityLiters: 60
} as unknown as TelemetrySnapshot

const CASES: Array<[string, TelemetrySnapshot | null]> = [
  ['null', null],
  ['healthy', healthy],
  ['alarm', alarm],
  ['extreme', extreme]
]

describe('EngineVitalsStripWidget', () => {
  it('renders every snapshot NaN / undefined / Infinity-free', () => {
    for (const [label, snap] of CASES) {
      let out = ''
      expect(() => { out = render(snap) }, `${label} render`).not.toThrow()
      assertClean(out, label)
    }
  })

  it('degrades a null snapshot to "—" with all vital labels present', () => {
    const out = render(null)
    for (const label of ['WATER T', 'OIL T', 'OIL P', 'FUEL']) {
      expect(out, `missing ${label}`).toContain(label)
    }
    expect(out).toContain('—')
  })

  it('routes default vitals through the DataField instrument with a level bar', () => {
    const out = render(alarm)
    expect(out, 'vital label in output').toContain('WATER T')
    expect(out, 'numeric value in DSEG').toContain(skin.segment.numeric)
    expect(out, 'level bar track').toContain('data-widget="engineVitalsStrip"')
  })

  it('shows healthy numeric values in the output', () => {
    const out = render(healthy)
    assertClean(out, 'healthy')
    expect(out).toContain('88')
    expect(out).toContain('95')
    expect(out).toContain('4.2')
  })

  it('does not alarm on zero oil pressure while engine is not spinning (rpm≤1200)', () => {
    const stationary = { ...healthy, rpm: 0, oilPressureKpa: 0 } as unknown as TelemetrySnapshot
    const out = render(stationary)
    assertClean(out, 'stationary')
  })

  it('stays NaN-free on extreme values (over-limit temps, zero fuel)', () => {
    const out = render(extreme)
    assertClean(out, 'extreme')
    expect(out).toContain('0')
  })

  it('is registered per-yes with requires=[waterTempC,oilTempC,oilPressureKpa]', () => {
    const def = OVERLAY_WIDGETS.find(w => w.id === 'engineVitalsStrip')
    expect(def, 'engineVitalsStrip not registered').toBeTruthy()
    expect(def?.requires).toEqual(['waterTempC', 'oilTempC', 'oilPressureKpa'])
    expect(widgetSupportedSims(def?.requires)).toEqual(['iracing'])
  })
})
