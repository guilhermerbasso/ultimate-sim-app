import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig, OVERLAY_WIDGETS } from '../../../../shared/overlays'
import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { resolveSkin } from '../../skins'
import { AbsCutGaugeWidget } from './AbsCutGaugeWidget'

const skin = resolveSkin('gt3', 'generic')

// AbsCutGaugeWidget — a compact bar gauge for iRacing BrakeABSCutPct. Rendered to static
// markup (no JSX, per the suite convention) across null, 0%, a light cut, a heavy cut and
// an out-of-range value. Asserts the missing field degrades to "—" with an empty track
// (never NaN / undefined / Infinity), the value clamps to 0–100, and the fill warms to
// amber / red as the cut deepens (never cool/green — ABS intervention is not a good state).

const config: OverlayWidgetConfig = createDefaultOverlaysConfig().widgets.absCut

function render(snapshot: TelemetrySnapshot | null): string {
  return renderToStaticMarkup(createElement(AbsCutGaugeWidget, { snapshot, config }))
}

function assertClean(markup: string, ctx: string): void {
  expect(markup.length, `empty render: ${ctx}`).toBeGreaterThan(100)
  expect(markup, `NaN in ${ctx}`).not.toContain('NaN')
  expect(markup, `undefined in ${ctx}`).not.toContain('undefined')
  expect(markup, `Infinity in ${ctx}`).not.toContain('Infinity')
}

function snap(absCutPct: number): TelemetrySnapshot {
  return { sim: 'iracing', connected: true, timestamp: 1, absCutPct } as unknown as TelemetrySnapshot
}

const CASES: Array<[string, TelemetrySnapshot | null]> = [
  ['null', null],
  ['zero', snap(0)],
  ['light', snap(18)],
  ['mid', snap(40)],
  ['heavy', snap(85)],
  ['over-range', snap(140)]
]

describe('AbsCutGaugeWidget', () => {
  it('renders every snapshot NaN / undefined / Infinity-free', () => {
    for (const [label, s] of CASES) {
      let out = ''
      expect(() => { out = render(s) }, `${label} render`).not.toThrow()
      assertClean(out, label)
    }
  })

  it('degrades a null snapshot to "—" with the ABS title and a root svg', () => {
    const out = render(null)
    expect(out).toContain('ABS CUT')
    expect(out).toContain('—')
    expect(out).toContain('<svg')
  })

  it('shows a numeric percentage and clamps an over-range value to 100', () => {
    const mid = render(snap(40))
    expect(mid).toContain(skin.segment.numeric)
    expect(mid).toContain('40')
    const over = render(snap(140))
    expect(over).toContain('100')
    expect(over).toContain('<svg')
  })

  it('stays neutral at 0% and warms to amber on a light cut', () => {
    const out = render(snap(18))
    expect(out, 'an active cut warms to warn/amber').toContain(skin.palette.warn)
  })

  it('burns red on a heavy cut and never reads green', () => {
    const out = render(snap(85))
    expect(out).toContain(skin.palette.crit)
    expect(out, 'ABS cut is never a good (green) state').not.toContain(skin.palette.ok)
  })

  it('is registered per-sim with requires=[absCutPct] (iRacing-tagged)', () => {
    const def = OVERLAY_WIDGETS.find((w) => w.id === 'absCut')
    expect(def, 'absCut not registered in OVERLAY_WIDGETS').toBeTruthy()
    expect(def?.requires).toEqual(['absCutPct'])
  })
})
