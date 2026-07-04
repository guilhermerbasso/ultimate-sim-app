import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { resolveSkin } from '../../skins'
import { TyresDetailWidget } from './TyresDetailWidget'

// TyresDetailWidget — normalizes the tyre-life scale (0..1 OR 0..100 → percentage) and
// refuses to invent a nominal 40°C / 130 kPa reading when temp/pressure are absent: a
// missing channel reads dim chrome + '—', never a decorative green/blue.

const base = createDefaultOverlaysConfig().widgets.gt3Cluster
const skin = resolveSkin('gt3', 'generic')
const COLD_BLUE = '#5b8cff'
const OPTIMAL_GREEN = '#2ee06a'
const DIM_CHROME = '#8a8a8a'

function cfg(stylePreset: string): OverlayWidgetConfig {
  return { ...base, stylePreset } as OverlayWidgetConfig
}

function render(snapshot: TelemetrySnapshot | null, stylePreset = 'minimal'): string {
  return renderToStaticMarkup(createElement(TyresDetailWidget, { snapshot, config: cfg(stylePreset) }))
}

// Only tyre-life present; temp / pressure / brake all absent.
const wearOnly = {
  sim: 'iracing',
  connected: true,
  timestamp: 1,
  tyres: { lf: { wearPct: 0.82 }, rf: { wearPct: 0.82 }, lr: { wearPct: 0.82 }, rr: { wearPct: 0.82 } }
} as unknown as TelemetrySnapshot

// Worn tyre, temp / pressure / brake all absent — life itself is red, so any green in
// the output would have to come from a fabricated nominal temp/pressure reading.
const wornNoChannels = {
  sim: 'iracing',
  connected: true,
  timestamp: 1,
  tyres: { lf: { wearPct: 0.2 }, rf: { wearPct: 0.2 }, lr: { wearPct: 0.2 }, rr: { wearPct: 0.2 } }
} as unknown as TelemetrySnapshot

describe('TyresDetailWidget', () => {
  it('normalizes a 0..1 tyre-life fraction to a percentage (0.82 → 82)', () => {
    const out = render(wearOnly)
    expect(out).toContain('82')
    expect(out).not.toContain('0.82')
  })

  it('routes per-channel meter values through a DSEG numeric face', () => {
    const out = render(wearOnly)
    expect(out, 'DSEG7 numerals').toContain(skin.segment.numeric)
  })

  it('does NOT fabricate a nominal 40°C / 130 kPa for absent temp/pressure', () => {
    const out = render(wornNoChannels)
    // missing temp/pressure must be dim '—', never a confident green optimal or cool blue
    expect(out, 'missing channels stay dim chrome').toContain(DIM_CHROME)
    expect(out, 'no decorative cool blue').not.toContain(COLD_BLUE)
    expect(out, 'absent temp/pressure must not paint optimal green').not.toContain(OPTIMAL_GREEN)
  })

  it('degrades a null snapshot to em-dashes with no fake nominal', () => {
    const out = render(null)
    expect(out).toContain('—')
    expect(out).not.toContain('NaN')
    expect(out).not.toContain(COLD_BLUE)
  })
})
