import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { SHIFT_STROBE_BLUE } from '../../lib/rev-lights'
import { ShiftPointBarWidget } from './ShiftPointBarWidget'

const baseConfig: OverlayWidgetConfig = createDefaultOverlaysConfig().widgets.shiftPointBar

function render(
  snapshot: TelemetrySnapshot | null,
  position: OverlayWidgetConfig['position'] = baseConfig.position
): string {
  return renderToStaticMarkup(createElement(ShiftPointBarWidget, {
    snapshot,
    config: { ...baseConfig, position }
  }))
}

const midBand = {
  sim: 'iracing',
  connected: true,
  timestamp: 1,
  rpm: 7800,
  gear: 4,
  shiftIndicatorPct: 0.6
} as unknown as TelemetrySnapshot

const redline = {
  sim: 'iracing',
  connected: true,
  timestamp: 2,
  rpm: 8950,
  gear: 5,
  shiftIndicatorPct: 0.99,
  revLights: { blink: true }
} as unknown as TelemetrySnapshot

describe('ShiftPointBarWidget', () => {
  it('renders null and live snapshots without unsafe tokens or redundant text', () => {
    for (const snapshot of [null, midBand, redline]) {
      const out = render(snapshot)
      expect(out.length).toBeGreaterThan(100)
      expect(out).not.toMatch(/NaN|undefined|Infinity/)
      expect(out).not.toContain('<text')
      expect(out).not.toContain('RPM')
      expect(out).not.toContain('GEAR')
    }
  })

  it('uses the shared strong-blue uniform strobe only at the shift point', () => {
    const mid = render(midBand)
    expect(mid).not.toContain(SHIFT_STROBE_BLUE)
    expect(mid).not.toContain('repeatCount="indefinite"')

    const shift = render(redline)
    expect(shift).toContain(SHIFT_STROBE_BLUE)
    expect(shift).toContain('data-rev-shift="strobe"')
    expect(shift).toContain('repeatCount="indefinite"')
  })

  it('preserves width when only height shrinks', () => {
    const tall = render(midBand, { x: 0, y: 0, width: 900, height: 90 })
    const short = render(midBand, { x: 0, y: 0, width: 900, height: 24 })
    expect(tall).toContain('viewBox="0 0 900 90"')
    expect(short).toContain('viewBox="0 0 900 24"')
    expect(short).toContain('preserveAspectRatio="none"')
  })

  it('stays brand-neutral', () => {
    const out = render(redline)
    for (const mark of ['MoTeC', 'MOTEC', 'Cosworth', 'AiM', 'Bosch']) {
      expect(out).not.toContain(mark)
    }
  })
})
