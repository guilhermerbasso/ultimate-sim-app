import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig, OVERLAY_WIDGETS } from '../../../../shared/overlays'
import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import type { PaceMode, TelemetrySnapshot } from '../../../../shared/telemetry'
import { resolveSkin } from '../../skins'
import { PaceRestartWidget } from './PaceRestartWidget'

// PaceRestartWidget — pace formation MODE + active pace FLAGS for iRacing restarts.
// Rendered to static markup (no JSX, per the suite convention) across null, every pace
// mode, single + multiple pace flags and an empty flag list. Asserts the missing mode
// degrades to "—", flags render as labelled chips (FREE PASS the one green grant), and an
// empty flag list reads "NONE" — never NaN / undefined.

const config: OverlayWidgetConfig = createDefaultOverlaysConfig().widgets.paceRestart
const GREEN = resolveSkin('gt3', 'generic').palette.ok

function render(snapshot: TelemetrySnapshot | null): string {
  return renderToStaticMarkup(createElement(PaceRestartWidget, { snapshot, config }))
}

function assertClean(markup: string, ctx: string): void {
  expect(markup.length, `empty render: ${ctx}`).toBeGreaterThan(80)
  expect(markup, `NaN in ${ctx}`).not.toContain('NaN')
  expect(markup, `undefined in ${ctx}`).not.toContain('undefined')
  expect(markup, `Infinity in ${ctx}`).not.toContain('Infinity')
}

function snap(paceMode: PaceMode, paceFlags: string[] = []): TelemetrySnapshot {
  return { sim: 'iracing', connected: true, timestamp: 1, paceMode, paceFlags } as unknown as TelemetrySnapshot
}

const MODE_LABELS: Record<PaceMode, string> = {
  singleFileStart: 'SINGLE FILE · START',
  doubleFileStart: 'DOUBLE FILE · START',
  singleFileRestart: 'SINGLE FILE · RESTART',
  doubleFileRestart: 'DOUBLE FILE · RESTART',
  notPacing: 'NOT PACING'
}

describe('PaceRestartWidget', () => {
  it('renders null + every mode NaN / undefined / Infinity-free', () => {
    const cases: Array<[string, TelemetrySnapshot | null]> = [
      ['null', null],
      ...(Object.keys(MODE_LABELS) as PaceMode[]).map((m) => [m, snap(m)] as [string, TelemetrySnapshot])
    ]
    for (const [label, s] of cases) {
      let out = ''
      expect(() => { out = render(s) }, `${label} render`).not.toThrow()
      assertClean(out, label)
    }
  })

  it('degrades a null snapshot to "—" with the title and a NONE flags row', () => {
    const out = render(null)
    expect(out).toContain('Pace / Restart')
    expect(out).toContain('—')
    expect(out).toContain('data-widget="paceRestart"')
    expect(out).toContain('NONE')
    expect(out).toContain('<svg')
  })

  it('shows the correct label for every pace mode', () => {
    for (const [mode, label] of Object.entries(MODE_LABELS) as [PaceMode, string][]) {
      expect(render(snap(mode)), `label for ${mode}`).toContain(label)
    }
  })

  it('renders active pace flags as labelled chips', () => {
    const out = render(snap('doubleFileRestart', ['endOfLine', 'wavedAround']))
    expect(out).toContain('<svg')
    expect(out).toContain('END OF LINE')
    expect(out).toContain('WAVED AROUND')
    expect(out).not.toContain('NONE')
  })

  it('paints the FREE PASS grant green and reads NONE with no flags', () => {
    expect(render(snap('singleFileRestart', ['freePass'])), 'free pass is the green grant').toContain(GREEN)
    expect(render(snap('singleFileRestart', []))).toContain('NONE')
  })

  it('is registered per-sim with requires=[paceMode] (iRacing-tagged)', () => {
    const def = OVERLAY_WIDGETS.find((w) => w.id === 'paceRestart')
    expect(def, 'paceRestart not registered in OVERLAY_WIDGETS').toBeTruthy()
    expect(def?.requires).toEqual(['paceMode'])
  })
})
