import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { FuelWidget } from './FuelWidget'

// FuelWidget — missing fuel/capacity must read as a neutral '—' tank, never a confident
// red 0% / "000%". A known snapshot still renders the litres and percentage.

const base = createDefaultOverlaysConfig().widgets.gt3Cluster

function cfg(stylePreset: string): OverlayWidgetConfig {
  return { ...base, stylePreset } as OverlayWidgetConfig
}

function render(snapshot: TelemetrySnapshot | null, stylePreset = 'terminal'): string {
  return renderToStaticMarkup(createElement(FuelWidget, { snapshot, config: cfg(stylePreset) }))
}

function assertClean(markup: string, ctx: string): void {
  expect(markup.length, `empty render: ${ctx}`).toBeGreaterThan(100)
  expect(markup, `NaN in ${ctx}`).not.toContain('NaN')
  expect(markup, `undefined in ${ctx}`).not.toContain('undefined')
  expect(markup, `Infinity in ${ctx}`).not.toContain('Infinity')
}

const known = {
  sim: 'iracing',
  connected: true,
  timestamp: 1,
  fuelLiters: 30,
  fuelCapacityLiters: 60,
  fuelPerLap: 3
} as unknown as TelemetrySnapshot

describe('FuelWidget missing-data hygiene', () => {
  it('renders a neutral em-dash tank (no "000%"/"0%") when fuel/capacity are unknown', () => {
    const out = render(null, 'terminal')
    expect(out).toContain('—')
    expect(out, 'no fake 000% reserve').not.toContain('000%')
    expect(out, 'no confident 0% level').not.toContain('>0%')
    expect(out, 'no NaN').not.toContain('NaN')
  })

  it('does not paint the bad/red tone for an unknown level', () => {
    const out = render(null, 'minimal')
    expect(out, 'unknown level must not read as a critical/red tank').not.toContain('is-bad')
  })

  it('renders the litres and percentage for a known snapshot', () => {
    const out = render(known, 'terminal')
    expect(out).toContain('30.0')
    expect(out).toContain('50%')
  })

  it('routes the analog family through the SVG gauge + DSEG readout', () => {
    const out = render(known, 'analog')
    assertClean(out, 'analog known')
    expect(out, 'root svg').toContain('<svg')
    expect(out, 'fuel level bar').toContain('50%')
    expect(out, 'DSEG7 numerals').toContain('DSEG7')
    expect(out, 'fuel litres value').toContain('30.0')
  })

  it('analog null snapshot degrades cleanly and still draws the gauge', () => {
    const out = render(null, 'analog')
    assertClean(out, 'analog null')
    expect(out, 'root svg still draws').toContain('<svg')
    expect(out, 'null shows dash').toContain('—')
  })
})
