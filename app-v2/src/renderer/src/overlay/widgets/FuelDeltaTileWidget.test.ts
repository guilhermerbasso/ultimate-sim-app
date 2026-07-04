import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { resolveSkin } from '../../skins'
import { FuelDeltaTileWidget } from './FuelDeltaTileWidget'

// FuelDeltaTileWidget — a focused GT3 fuel-margin strategy tile. Rendered to static
// markup (no JSX, per the suite convention) across null, a comfortable-surplus snapshot,
// a will-run-dry extreme and a zero-burn guard. Asserts the kit guards hold (every
// readout degrades to "—", a zero fuel-per-lap never divides into Infinity, the face
// never leaks NaN / undefined / Infinity) and that the margin tone behaves.

const skin = resolveSkin('gt3', 'generic')
const GREEN = skin.palette.ok
const RED = skin.palette.crit
const config: OverlayWidgetConfig = createDefaultOverlaysConfig().widgets.gt3Cluster

function render(snapshot: TelemetrySnapshot | null): string {
  return renderToStaticMarkup(createElement(FuelDeltaTileWidget, { snapshot, config }))
}

function assertClean(markup: string, ctx: string): void {
  expect(markup.length, `empty render: ${ctx}`).toBeGreaterThan(100)
  expect(markup, `NaN in ${ctx}`).not.toContain('NaN')
  expect(markup, `undefined in ${ctx}`).not.toContain('undefined')
  expect(markup, `Infinity in ${ctx}`).not.toContain('Infinity')
}

const KEY_LABELS = ['Fuel Delta', 'MARGIN', 'FUEL', 'L/LAP', 'TO EMPTY', 'DELTA']

// 60 L, 2.5 L/lap, 20 laps to go → 24 laps to empty, +4.0 lap margin, +10.0 L delta.
const surplus = {
  sim: 'iracing',
  connected: true,
  timestamp: 1,
  fuelLiters: 60,
  fuelPerLap: 2.5,
  lapsRemaining: 20
} as unknown as TelemetrySnapshot

// 3 L, 2.5 L/lap, 20 laps to go → 1.2 laps to empty, deep negative margin → run dry.
const willRunDry = {
  sim: 'iracing',
  connected: true,
  timestamp: 2,
  fuelLiters: 3,
  fuelPerLap: 2.5,
  lapsRemaining: 20
} as unknown as TelemetrySnapshot

// Zero burn must not divide into Infinity laps-to-empty.
const zeroBurn = {
  sim: 'iracing',
  connected: true,
  timestamp: 3,
  fuelLiters: 60,
  fuelPerLap: 0,
  lapsRemaining: 20
} as unknown as TelemetrySnapshot

const CASES: Array<[string, TelemetrySnapshot | null]> = [
  ['null', null],
  ['surplus', surplus],
  ['will-run-dry', willRunDry],
  ['zero-burn', zeroBurn]
]

describe('FuelDeltaTileWidget', () => {
  it('renders every snapshot NaN / undefined / Infinity-free', () => {
    for (const [label, snap] of CASES) {
      let out = ''
      expect(() => { out = render(snap) }, `${label} render`).not.toThrow()
      assertClean(out, label)
    }
  })

  it('degrades a null snapshot to em-dashes with every key label and the condensed token', () => {
    const out = render(null)
    for (const label of KEY_LABELS) {
      expect(out, `missing ${label}`).toContain(label)
    }
    expect(out).toContain('—')
    expect(out).toContain('Saira Condensed')
    expect(out).toContain('<svg') // fuel glyph
  })

  it('shows a comfortable surplus in green with the headline figures', () => {
    const out = render(surplus)
    expect(out).toContain('+4.0') // margin laps
    expect(out).toContain('60.0') // fuel left
    expect(out).toContain('2.50') // burn per lap
    expect(out).toContain('24.0') // laps to empty
    expect(out).toContain('+10.0') // litre delta
    expect(out).toContain('SAFE')
    expect(out, 'surplus → green').toContain(GREEN)
  })

  it('routes MARGIN through SegmentReadout and grid through DataTile (DSEG numerals)', () => {
    const out = render(surplus)
    expect(out, 'DSEG7 numerals in SegmentReadout/DataTile').toContain('DSEG7')
  })

  it('flags a will-run-dry deficit red', () => {
    const out = render(willRunDry)
    expect(out).toContain('SHORT')
    expect(out, 'deficit → red').toContain(RED)
  })

  it('never divides into Infinity when fuel-per-lap is zero', () => {
    const out = render(zeroBurn)
    assertClean(out, 'zero-burn')
    expect(out).toContain('TO EMPTY')
    expect(out).toContain('—') // unknown laps-to-empty, never Infinity
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
