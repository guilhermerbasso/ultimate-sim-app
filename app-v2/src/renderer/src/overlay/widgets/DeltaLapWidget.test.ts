import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayStylePresetId } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { DeltaLapWidget } from './DeltaLapWidget'
import { WIDGET_COMPONENTS } from './index'

const baseConfig = createDefaultOverlaysConfig().widgets.deltaLap

const FAMILIES: OverlayStylePresetId[] = [
  'minimal',
  'neon',
  'glass',
  'broadcast',
  'terminal',
  'bauhaus',
  'analog',
  'heatmap'
]

function render(snapshot: TelemetrySnapshot | null, stylePreset: OverlayStylePresetId): string {
  const config = { ...baseConfig, stylePreset }
  return renderToStaticMarkup(createElement(DeltaLapWidget, { snapshot, config }))
}

// A snapshot with NO delta channel — the unknown-gap case.
const noDelta = {
  sim: 'iracing',
  connected: true,
  timestamp: 1,
  currentLapTimeSec: 12.5
} as unknown as TelemetrySnapshot

const fasterDelta = {
  ...noDelta,
  currentLapTimeSec: 12.345,
  lastLapTimeSec: 13.456,
  bestLapTimeSec: 11.111,
  deltaToBestSec: -0.234
} as unknown as TelemetrySnapshot

const badData = {
  ...noDelta,
  currentLapTimeSec: Number.NaN,
  lastLapTimeSec: Number.POSITIVE_INFINITY,
  bestLapTimeSec: undefined,
  deltaToBestSec: Number.NaN
} as unknown as TelemetrySnapshot

describe('DeltaLapWidget registration', () => {
  it('is wired into the overlay widget component map', () => {
    expect(WIDGET_COMPONENTS.deltaLap).toBe(DeltaLapWidget)
  })
})

describe('DeltaLapWidget missing gap renders an em-dash, never ±0.000', () => {
  it('shows — and never a fabricated ±0.000 / 0.000 when delta is unknown (all families)', () => {
    for (const family of FAMILIES) {
      const markup = render(noDelta, family)
      expect(markup, `em-dash present in ${family}`).toContain('—')
      expect(markup, `no ±0.000 in ${family}`).not.toContain('±0.000')
      expect(markup, `no fabricated 0.000 in ${family}`).not.toContain('0.000')
    }
  })

  it('does not throw and stays clean for null snapshots', () => {
    for (const family of FAMILIES) {
      expect(() => render(null, family), `null ${family}`).not.toThrow()
      const markup = render(null, family)
      expect(markup, `NaN in ${family}`).not.toContain('NaN')
      expect(markup, `undefined in ${family}`).not.toContain('undefined')
      expect(markup, `Infinity in ${family}`).not.toContain('Infinity')
    }
  })

  it('keeps instrument SVG/DSEG readouts and DataTile labels in converted families', () => {
    const markup = render(fasterDelta, 'minimal')
    expect(markup).toContain('<svg')
    expect(markup).toContain('DSEG7')
    expect(markup).toContain('-0.234')
    expect(markup).toContain('0:12.345')
    expect(markup).toContain('0:11.111')
  })

  it('sanitizes extreme/non-finite lap and delta inputs', () => {
    for (const family of FAMILIES) {
      const markup = render(badData, family)
      expect(markup, `dash in ${family}`).toContain('—')
      expect(markup, `NaN in ${family}`).not.toContain('NaN')
      expect(markup, `undefined in ${family}`).not.toContain('undefined')
      expect(markup, `Infinity in ${family}`).not.toContain('Infinity')
    }
  })

  it('still formats a known faster delta with its sign', () => {
    expect(render(fasterDelta, 'minimal')).toContain('-0.234')
    expect(render(fasterDelta, 'terminal')).toContain('-0.234')
  })
})
