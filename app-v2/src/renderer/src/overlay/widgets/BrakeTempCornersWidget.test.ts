import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { resolveSkin } from '../../skins'
import { BrakeTempCornersWidget } from './BrakeTempCornersWidget'

const skin = resolveSkin('gt3', 'generic')
const COOL_BLUE = '#00BFFF'

// BrakeTempCornersWidget — a focused GT3 2×2 brake-disc temperature readout. Rendered to
// static markup (no JSX, per the suite convention) across null, a populated in-window
// snapshot, an overheating extreme and a cold-discs case. Asserts the kit guards hold
// (every corner degrades to "—", the face never leaks NaN / undefined / Infinity) and
// that the cold / optimal / hot colour bands behave.

const config: OverlayWidgetConfig = createDefaultOverlaysConfig().widgets.gt3Cluster

function render(snapshot: TelemetrySnapshot | null): string {
  return renderToStaticMarkup(createElement(BrakeTempCornersWidget, { snapshot, config }))
}

function assertClean(markup: string, ctx: string): void {
  expect(markup.length, `empty render: ${ctx}`).toBeGreaterThan(100)
  expect(markup, `NaN in ${ctx}`).not.toContain('NaN')
  expect(markup, `undefined in ${ctx}`).not.toContain('undefined')
  expect(markup, `Infinity in ${ctx}`).not.toContain('Infinity')
}

const populated = {
  sim: 'iracing',
  connected: true,
  timestamp: 1,
  brakeTempC: { lf: 420, rf: 430, lr: 380, rr: 400 }
} as unknown as TelemetrySnapshot

const overheating = {
  sim: 'iracing',
  connected: true,
  timestamp: 2,
  brakeTempC: { lf: 880, rf: 905, lr: 820, rr: 860 }
} as unknown as TelemetrySnapshot

const coldDiscs = {
  sim: 'iracing',
  connected: true,
  timestamp: 3,
  brakeTempC: { lf: 120, rf: 130, lr: 110, rr: 125 }
} as unknown as TelemetrySnapshot

const CASES: Array<[string, TelemetrySnapshot | null]> = [
  ['null', null],
  ['populated', populated],
  ['overheating', overheating],
  ['cold', coldDiscs]
]

describe('BrakeTempCornersWidget', () => {
  it('renders every snapshot NaN / undefined / Infinity-free', () => {
    for (const [label, snap] of CASES) {
      let out = ''
      expect(() => { out = render(snap) }, `${label} render`).not.toThrow()
      assertClean(out, label)
    }
  })

  it('degrades a null snapshot to em-dashes with the DSEG numeric token and brake glyph', () => {
    const out = render(null)
    expect(out).toContain('BRAKE TEMP')
    expect(out).toContain('DISC')
    expect(out).toContain('°C')
    expect(out).toContain('Optimal 200')
    expect(out).toContain('PEAK')
    expect(out).toContain('—')
    expect(out).toContain(skin.segment.numeric)
    expect(out).toContain('<svg')
  })

  it('shows in-window discs with a green good-state hue and the hottest corner peak', () => {
    const out = render(populated)
    expect(out).toContain('420')
    expect(out).toContain('430') // peak
    expect(out, 'optimal → green').toContain(skin.palette.ok)
  })

  it('routes per-corner brake cells through a DSEG numeric face', () => {
    const out = render(populated)
    expect(out, 'DSEG7 numerals').toContain(skin.segment.numeric)
    expect(out, 'DISC header').toContain('DISC')
    expect(out, '°C unit').toContain('°C')
  })

  it('paints overheating corners red', () => {
    const out = render(overheating)
    expect(out).toContain('905')
    expect(out, 'over the hot threshold → red').toContain(skin.palette.crit)
  })

  it('paints cold discs dim chrome, never a decorative cool blue', () => {
    const out = render(coldDiscs)
    expect(out).toContain('120')
    expect(out, 'below the window → dim chrome').toContain(skin.palette.textDim)
    expect(out, 'cold must not use a decorative cool blue').not.toContain(COOL_BLUE)
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
