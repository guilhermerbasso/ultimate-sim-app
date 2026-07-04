import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig, OVERLAY_DESIGN_FAMILIES } from '../../../../shared/overlays'
import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { InputsTraceWidget } from './InputsTraceWidget'
import { WIDGET_COMPONENTS } from './index'

const base = createDefaultOverlaysConfig().widgets.gt3Cluster
const banned = ['NaN', 'undefined', 'Infinity']

function cfg(stylePreset: string): OverlayWidgetConfig {
  return { ...base, stylePreset } as OverlayWidgetConfig
}

function render(snapshot: TelemetrySnapshot | null, stylePreset = 'minimal'): string {
  return renderToStaticMarkup(createElement(InputsTraceWidget, { snapshot, config: cfg(stylePreset) }))
}

const known = {
  sim: 'iracing',
  connected: true,
  timestamp: 1,
  throttle: 0.62,
  brake: 0.24,
  clutch: 0.08,
  steerAngleDeg: -135
} as unknown as TelemetrySnapshot

const bad = {
  sim: 'iracing',
  connected: true,
  timestamp: 1,
  throttle: Number.NaN,
  brake: Number.POSITIVE_INFINITY,
  clutch: Number.NEGATIVE_INFINITY,
  steerAngleDeg: Number.NaN
} as unknown as TelemetrySnapshot

describe('InputsTraceWidget instrument conversion', () => {
  it('renders SVG trace instruments, DSEG numerals, and DataTile aria labels', () => {
    const out = render(known, 'terminal')
    expect(out).toContain('<svg')
    expect(out).toContain('DSEG7Classic')
    expect(out).toContain('aria-label="THR 62"')
    expect(WIDGET_COMPONENTS.inputsTrace).toBe(InputsTraceWidget)
  })

  it('renders missing and invalid inputs as em dashes without unsafe numeric text', () => {
    for (const out of [render(null, 'minimal'), render(bad, 'analog')]) {
      expect(out).toContain('—')
      for (const token of banned) expect(out).not.toContain(token)
    }
  })

  it('renders every overlay design family', () => {
    for (const family of OVERLAY_DESIGN_FAMILIES) {
      const out = render(known, family)
      expect(out).toContain(`rd2-fam-${family}`)
      for (const token of banned) expect(out).not.toContain(token)
    }
  })
})
