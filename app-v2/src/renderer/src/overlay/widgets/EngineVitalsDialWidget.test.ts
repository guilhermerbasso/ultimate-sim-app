import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { resolveSkin } from '../../skins'
import { EngineVitalsDialWidget } from './EngineVitalsDialWidget'

// EngineVitalsDialWidget — three compact GT3 arc gauges for water/oil temp + oil
// pressure. Rendered to static markup (no JSX, per the suite convention) across null, a
// healthy snapshot, an alarm extreme and a stationary low-oil-pressure case (engine not
// spinning → no false alarm). Asserts the kit guards hold (every dial degrades to "—",
// the face never leaks NaN / undefined / Infinity) and that the warm-only severity rule
// behaves.

const config: OverlayWidgetConfig = createDefaultOverlaysConfig().widgets.gt3Cluster
const skin = resolveSkin('gt3', 'generic')

function render(snapshot: TelemetrySnapshot | null): string {
  return renderToStaticMarkup(createElement(EngineVitalsDialWidget, { snapshot, config }))
}

function assertClean(markup: string, ctx: string): void {
  expect(markup.length, `empty render: ${ctx}`).toBeGreaterThan(100)
  expect(markup, `NaN in ${ctx}`).not.toContain('NaN')
  expect(markup, `undefined in ${ctx}`).not.toContain('undefined')
  expect(markup, `Infinity in ${ctx}`).not.toContain('Infinity')
}

const KEY_LABELS = ['Engine Vitals', 'Water', 'Oil T', 'Oil P']

const healthy = {
  sim: 'iracing',
  connected: true,
  timestamp: 1,
  rpm: 6000,
  waterTempC: 88,
  oilTempC: 98,
  oilPressureKpa: 450 // 4.5 bar
} as unknown as TelemetrySnapshot

const alarm = {
  sim: 'iracing',
  connected: true,
  timestamp: 2,
  rpm: 6500,
  waterTempC: 120, // red
  oilTempC: 145, // red
  oilPressureKpa: 200 // 2.0 bar, spinning → red
} as unknown as TelemetrySnapshot

// Engine off: oil pressure is 0 but rpm is below the running threshold → no false alarm.
const stationary = {
  sim: 'iracing',
  connected: true,
  timestamp: 3,
  rpm: 0,
  waterTempC: 70,
  oilTempC: 80,
  oilPressureKpa: 0
} as unknown as TelemetrySnapshot

const CASES: Array<[string, TelemetrySnapshot | null]> = [
  ['null', null],
  ['healthy', healthy],
  ['alarm', alarm],
  ['stationary', stationary]
]

describe('EngineVitalsDialWidget', () => {
  it('renders every snapshot NaN / undefined / Infinity-free', () => {
    for (const [label, snap] of CASES) {
      let out = ''
      expect(() => { out = render(snap) }, `${label} render`).not.toThrow()
      assertClean(out, label)
    }
  })

  it('degrades a null snapshot to em-dashes with every dial label and the DSEG token', () => {
    const out = render(null)
    for (const label of KEY_LABELS) {
      expect(out, `missing ${label}`).toContain(label)
    }
    expect(out).toContain('—')
    expect(out).toContain('DSEG14Classic-Regular')
    expect(out).toContain('<svg') // arc gauges
  })

  it('shows healthy vitals (OK) with the bar-converted oil pressure', () => {
    const out = render(healthy)
    expect(out).toContain('DSEG7Classic-Regular')
    expect(out).toContain('88') // water
    expect(out).toContain('98') // oil temp
    expect(out).toContain('4.5') // oil pressure in bar
    expect(out).toContain('OK')
  })

  it('routes the vitals through AnalogDial instrument (bezel + needle + arc)', () => {
    const out = render(healthy)
    expect(out, 'dial aria-label').toContain('aria-label="gauge"')
    expect(out, 'needle polygon').toContain('<polygon')
    expect(out, 'value arc').toMatch(/A[\d.]+,[\d.]+,/)
  })

  it('raises an ALARM and paints red when vitals exceed their danger thresholds', () => {
    const out = render(alarm)
    expect(out).toContain('120')
    expect(out).toContain('ALARM')
    expect(out, 'danger → red').toContain(skin.palette.crit)
  })

  it('does not alarm on zero oil pressure while the engine is not spinning', () => {
    const out = render(stationary)
    assertClean(out, 'stationary')
    expect(out).toContain('OK')
    expect(out, 'no false red alarm').not.toContain(skin.palette.crit)
  })

  it('stays brand-neutral (no MoTeC / Cosworth / AiM / Bosch wordmarks)', () => {
    for (const [, snap] of CASES) {
      const out = render(snap)
      for (const mark of ['MoTeC', 'MOTEC', 'Cosworth', 'AiM', 'Bosch']) {
        expect(out, `brand mark ${mark}`).not.toContain(mark)
      }
    }
  })
})
