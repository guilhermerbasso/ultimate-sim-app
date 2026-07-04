import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { resolveSkin } from '../../skins'
import { TyresBrakesWidget } from './TyresBrakesWidget'

const skin = resolveSkin('gt3', 'generic')

// TyresBrakesWidget — defends the tyre-life scale (providers send 0..1 OR 0..100, so a
// 0.82 fraction and a literal 82 must both render "82", never "8200%"), and applies the
// GT3 colour rule: cold tyres read dim chrome, not a decorative cool blue.

const base = createDefaultOverlaysConfig().widgets.gt3Cluster
const COLD_BLUE = '#5b8cff'
const DIM_CHROME = '#8a8a8a'

function cfg(stylePreset: string): OverlayWidgetConfig {
  return { ...base, stylePreset } as OverlayWidgetConfig
}

function snap(wearPct: number, tempC = 80): TelemetrySnapshot {
  const tyre = { tempC, pressureKpa: 170, wearPct }
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1,
    tyres: { lf: tyre, rf: tyre, lr: tyre, rr: tyre },
    brakeTempC: { lf: 400, rf: 400, lr: 400, rr: 400 }
  } as unknown as TelemetrySnapshot
}

function render(snapshot: TelemetrySnapshot | null, stylePreset = 'minimal'): string {
  return renderToStaticMarkup(createElement(TyresBrakesWidget, { snapshot, config: cfg(stylePreset) }))
}

describe('TyresBrakesWidget wear-scale normalization', () => {
  it('renders a 0..1 fraction as a percentage (0.82 → 82, not 0.82)', () => {
    const out = render(snap(0.82))
    expect(out).toContain('82')
    expect(out).not.toContain('0.82')
  })

  it('treats an already-scaled 0..100 value as percent (82 → 82, not 8200)', () => {
    const out = render(snap(82))
    expect(out).toContain('82')
    expect(out, 'no 8200% explosion').not.toContain('8200')
  })

  it('clamps an over-range value to 100', () => {
    const out = render(snap(150))
    expect(out).toContain('100')
    expect(out).not.toContain('15000')
  })
})

describe('TyresBrakesWidget colour rule', () => {
  it('paints cold tyres dim chrome, never a decorative cool blue', () => {
    const out = render(snap(50, 45))
    expect(out, 'cold → dim chrome').toContain(DIM_CHROME)
    expect(out, 'cold must not be cool blue').not.toContain(COLD_BLUE)
  })

  it('degrades missing corners to em-dashes', () => {
    const out = render(null)
    expect(out).toContain('—')
    expect(out).not.toContain('NaN')
  })

  it('routes minimal per-corner cells through a DSEG numeric face with metric labels', () => {
    const out = render(snap(0.82))
    expect(out, 'DSEG7 numerals').toContain(skin.segment.numeric)
    expect(out, 'TYRE label').toContain('TYRE')
    expect(out, 'BRK label').toContain('BRK')
    expect(out, 'PRS label').toContain('PRS')
    expect(out, 'LIFE label').toContain('LIFE')
  })
})
