import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { DASH } from './dashboard-tiles'
import { ShiftPointBarWidget } from './ShiftPointBarWidget'

// ShiftPointBarWidget — a standalone oversized GT3 shift ladder + RPM/gear readout.
// Rendered to static markup (no JSX, per the suite convention) across null, a mid-band
// snapshot and a redline extreme. Asserts the kit guards hold (gear/rpm degrade to "—",
// the face never leaks NaN / undefined / Infinity), that the shared LedShiftBar drives
// the ladder, and that the redline flips to the blink/red state.

const config: OverlayWidgetConfig = createDefaultOverlaysConfig().widgets.gt3Cluster

function render(snapshot: TelemetrySnapshot | null): string {
  return renderToStaticMarkup(createElement(ShiftPointBarWidget, { snapshot, config }))
}

function assertClean(markup: string, ctx: string): void {
  expect(markup.length, `empty render: ${ctx}`).toBeGreaterThan(100)
  expect(markup, `NaN in ${ctx}`).not.toContain('NaN')
  expect(markup, `undefined in ${ctx}`).not.toContain('undefined')
  expect(markup, `Infinity in ${ctx}`).not.toContain('Infinity')
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

const CASES: Array<[string, TelemetrySnapshot | null]> = [
  ['null', null],
  ['mid-band', midBand],
  ['redline', redline]
]

describe('ShiftPointBarWidget', () => {
  it('renders every snapshot NaN / undefined / Infinity-free', () => {
    for (const [label, snap] of CASES) {
      let out = ''
      expect(() => { out = render(snap) }, `${label} render`).not.toThrow()
      assertClean(out, label)
    }
  })

  it('degrades a null snapshot to em-dashes (condensed face, never garbled DSEG) with the shared LED ladder', () => {
    const out = render(null)
    expect(out).toContain('RPM')
    expect(out).toContain('GEAR')
    expect(out).toContain('—')
    // With no telemetry there is no numeric value, so the em-dash gear routes to the
    // condensed face — the DSEG (rc-num) face would garble the "—" glyph.
    expect(out).toMatch(/DSEG14Classic-Regular[^>]*>—</)
    expect(out, 'em-dash gear must not render in the DSEG face').not.toMatch(/font-family="&#x27;DSEG7Classic-Regular&#x27;[^"]*">—</)
    expect(out).toContain('led-shift-bar') // shared data-driven ladder
    expect(out).toContain('<svg')
  })

  it('shows live RPM + gear in the mid band without the redline flash', () => {
    const out = render(midBand)
    expect(out).toContain('DSEG7Classic-Regular')
    expect(out).toContain('7800')
    expect(out).toContain('>4<') // gear value
    expect(out).not.toContain('is-blink')
  })

  it('flashes the redline (blink + red chrome) past the shift point', () => {
    const out = render(redline)
    expect(out).toContain('8950')
    expect(out).toContain('is-blink')
    expect(out, 'redline → red').toContain(DASH.red)
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

// Big gear readout: digits → DSEG (rc-num) face; N / R → condensed (rc-cond)
// face, never the 7-seg face (which garbles letters).
describe('ShiftPointBarWidget — big-gear font discipline', () => {
  it('routes a digit gear to the DSEG (rc-num) face', () => {
    const out = render({ ...midBand, gear: 4 } as TelemetrySnapshot)
    expect(out).toMatch(/DSEG7Classic-Regular[^>]*>4</)
  })

  it('routes neutral (N) to the condensed face, never DSEG', () => {
    const out = render({ ...midBand, gear: 0 } as TelemetrySnapshot)
    expect(out).toContain('>N<')
    expect(out).toMatch(/DSEG14Classic-Regular[^>]*>N</)
    expect(out, 'N must not render in the DSEG face').not.toMatch(/font-family="&#x27;DSEG7Classic-Regular&#x27;[^"]*">N</)
  })

  it('routes reverse (R) to the condensed face, never DSEG', () => {
    const out = render({ ...midBand, gear: -1 } as TelemetrySnapshot)
    expect(out).toContain('>R<')
    expect(out).toMatch(/DSEG14Classic-Regular[^>]*>R</)
    expect(out, 'R must not render in the DSEG face').not.toMatch(/font-family="&#x27;DSEG7Classic-Regular&#x27;[^"]*">R</)
  })
})
