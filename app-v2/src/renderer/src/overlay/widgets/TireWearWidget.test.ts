import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { resolveSkin } from '../../skins'
import { TireWearWidget } from './TireWearWidget'

// TireWearWidget — wear/condition may arrive as a 0..1 fraction OR already 0..100.
// Normalize defensively so we never print "8200%". Missing → '—'.

const base = createDefaultOverlaysConfig().widgets.gt3Cluster
const skin = resolveSkin('gt3', 'generic')

function cfg(stylePreset: string): OverlayWidgetConfig {
  return { ...base, stylePreset } as OverlayWidgetConfig
}

function snap(wear: number | undefined): TelemetrySnapshot {
  const tyre = wear === undefined ? {} : { wearPct: wear }
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1,
    tyres: { lf: tyre, rf: tyre, lr: tyre, rr: tyre }
  } as unknown as TelemetrySnapshot
}

function render(snapshot: TelemetrySnapshot | null, stylePreset = 'minimal'): string {
  return renderToStaticMarkup(createElement(TireWearWidget, { snapshot, config: cfg(stylePreset) }))
}

describe('TireWearWidget wear-scale normalization', () => {
  it('treats a 0..1 fraction as a percentage (0.82 → 82%)', () => {
    const out = render(snap(0.82))
    expect(out).toContain('82%')
    expect(out).not.toContain('8200%')
  })

  it('routes life cells through a DSEG numeric face', () => {
    const out = render(snap(0.82))
    expect(out, 'DSEG7 numerals').toContain(skin.segment.numeric)
  })

  it('passes through an already-percent value (82 → 82%, never 8200%)', () => {
    const out = render(snap(82))
    expect(out).toContain('82%')
    expect(out).not.toContain('8200%')
  })

  it('clamps out-of-range values to 100%', () => {
    const out = render(snap(150))
    expect(out).toContain('100%')
  })

  it('renders "—" when wear is missing', () => {
    const out = render(snap(undefined))
    expect(out).toContain('—')
  })
})
