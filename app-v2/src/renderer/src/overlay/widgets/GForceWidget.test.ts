import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig, OVERLAY_DESIGN_FAMILIES } from '../../../../shared/overlays'
import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { resolveSkin } from '../../skins'
import { GForceWidget } from './GForceWidget'
import { WIDGET_COMPONENTS } from './index'

const base = createDefaultOverlaysConfig().widgets.gt3Cluster
const skin = resolveSkin('gt3', 'generic')
const banned = ['NaN', 'undefined', 'Infinity']

function cfg(stylePreset: string): OverlayWidgetConfig {
  return { ...base, stylePreset } as OverlayWidgetConfig
}

function render(snapshot: TelemetrySnapshot | null, stylePreset = 'minimal'): string {
  return renderToStaticMarkup(createElement(GForceWidget, { snapshot, config: cfg(stylePreset) }))
}

const loaded = {
  sim: 'iracing',
  connected: true,
  timestamp: 1,
  latAccelG: 1.2,
  longAccelG: -0.5
} as unknown as TelemetrySnapshot

const bad = {
  sim: 'iracing',
  connected: true,
  timestamp: 1,
  latAccelG: Number.NaN,
  longAccelG: Number.POSITIVE_INFINITY
} as unknown as TelemetrySnapshot

describe('GForceWidget instrument conversion and data hygiene', () => {
  it('renders single-root SVG framing, DSEG numerals, and stays registered', () => {
    const out = render(loaded, 'neon')
    expect(out).toContain('<svg')
    expect(out).toContain(skin.segment.numeric)
    expect(out).toContain('data-widget="gforce"')
    expect(out).toContain('+1.20G')
    expect(WIDGET_COMPONENTS.gforce).toBe(GForceWidget)
  })

  it('renders "—" (not "+0.00G") when accel channels are absent or invalid', () => {
    for (const out of [render(null, 'minimal'), render(bad, 'broadcast')]) {
      expect(out).toContain('—')
      expect(out, 'no fake zero G readout').not.toContain('0.00G')
      for (const token of banned) expect(out).not.toContain(token)
    }
  })

  it('renders signed G readouts for a known snapshot', () => {
    const out = render(loaded, 'terminal')
    expect(out).toContain('+1.20G')
    expect(out).toContain('-0.50G')
  })

  it('renders cleanly across every overlay design family (family-independent skin render)', () => {
    for (const family of OVERLAY_DESIGN_FAMILIES) {
      const out = render(loaded, family)
      expect(out).toContain('<svg')
      for (const token of banned) expect(out).not.toContain(token)
    }
  })
})
