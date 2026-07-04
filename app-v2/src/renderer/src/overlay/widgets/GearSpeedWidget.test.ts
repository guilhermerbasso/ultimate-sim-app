import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayStylePresetId, OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { GearSpeedWidget } from './GearSpeedWidget'

const base = createDefaultOverlaysConfig().widgets.gearSpeed

function cfg(stylePreset: OverlayStylePresetId): OverlayWidgetConfig {
  return { ...base, stylePreset }
}

function render(snapshot: TelemetrySnapshot | null, stylePreset: OverlayStylePresetId = 'minimal'): string {
  return renderToStaticMarkup(createElement(GearSpeedWidget, { snapshot, config: cfg(stylePreset) }))
}

const snap = (gear: number, speedKmh: number | undefined): TelemetrySnapshot =>
  ({ connected: true, gear, speedKmh, rpm: 6000, maxRpm: 9000 } as unknown as TelemetrySnapshot)

describe('GearSpeedWidget — gear font discipline', () => {
  it('routes a digit gear to the DSEG face', () => {
    const out = render(snap(4, 210))
    expect(out).toMatch(/DSEG7Classic-Regular[^>]*>4</)
  })

  it('routes a neutral gear (N) to the 14-seg face, never primary 7-seg', () => {
    const out = render(snap(0, 210))
    expect(out, 'N rendered').toContain('>N<')
    expect(out, 'N uses 14-seg face').toMatch(/DSEG14Classic-Regular[^>]*>N</)
    expect(out, 'N must not use the 7-seg numeral face').not.toMatch(/DSEG7Classic-Regular', 'Cascadia Code'[^>]*>N</)
  })

  it('routes a reverse gear (R) to the 14-seg face, never primary 7-seg', () => {
    const out = render(snap(-1, 210))
    expect(out).toContain('>R<')
    expect(out).toMatch(/DSEG14Classic-Regular[^>]*>R</)
    expect(out).not.toMatch(/DSEG7Classic-Regular', 'Cascadia Code'[^>]*>R</)
  })
})

describe('GearSpeedWidget — missing speed', () => {
  it('degrades a missing speed to an em-dash, never a misleading 0', () => {
    const out = render(snap(3, undefined))
    expect(out, 'speed slot shows em-dash').toContain('rc-min-val')
    expect(out, 'speed em-dash present').toContain('—')
  })

  it('degrades a null snapshot to an em-dash speed', () => {
    const out = render(null)
    expect(out).toContain('rc-min-val')
    expect(out).toContain('—')
  })

  it('renders a real speed when present', () => {
    const out = render(snap(3, 247))
    expect(out).toContain('247')
  })
})

describe('GearSpeedWidget — no decorative glow on normal readouts', () => {
  for (const preset of ['minimal', 'neon', 'analog', 'glass', 'bauhaus', 'heatmap'] as const) {
    it(`emits no inline text/box shadow in the ${preset} family at normal revs`, () => {
      const out = render(snap(4, 180), preset)
      expect(out, 'no inline text-shadow').not.toContain('text-shadow')
      expect(out, 'no inline box-shadow').not.toContain('box-shadow')
    })
  }
})
