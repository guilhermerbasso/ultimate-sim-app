import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig, OVERLAY_WIDGETS } from '../../../../shared/overlays'
import type { OverlayStylePresetId, OverlayWidgetConfig } from '../../../../shared/overlays'
import type { CarLeftRightState, TelemetrySnapshot } from '../../../../shared/telemetry'
import { resolveSkin } from '../../skins'
import { SideProximityWidget } from './SideProximityWidget'
import { WIDGET_COMPONENTS } from './index'

const skin = resolveSkin('gt3', 'generic')

const config: OverlayWidgetConfig = createDefaultOverlaysConfig().widgets.sideProximity
const FAMILIES: OverlayStylePresetId[] = ['minimal', 'neon', 'glass', 'broadcast', 'terminal', 'bauhaus', 'analog', 'heatmap']

function render(snapshot: TelemetrySnapshot | null, stylePreset: OverlayStylePresetId = 'minimal'): string {
  return renderToStaticMarkup(createElement(SideProximityWidget, { snapshot, config: { ...config, stylePreset } }))
}

function assertClean(markup: string, ctx: string): void {
  expect(markup.length, `empty render: ${ctx}`).toBeGreaterThan(80)
  expect(markup, `NaN in ${ctx}`).not.toContain('NaN')
  expect(markup, `undefined in ${ctx}`).not.toContain('undefined')
  expect(markup, `Infinity in ${ctx}`).not.toContain('Infinity')
}

function snap(carLeftRight: CarLeftRightState, carLeftRightCount?: number): TelemetrySnapshot {
  return { sim: 'iracing', connected: true, timestamp: 1, carLeftRight, carLeftRightCount } as unknown as TelemetrySnapshot
}

const CASES: Array<[string, TelemetrySnapshot | null]> = [
  ['null', null],
  ['clear', snap('clear')],
  ['one-left', snap('left', 1)],
  ['two-left', snap('left', 2)],
  ['one-right', snap('right', 1)],
  ['two-right', snap('right', 2)],
  ['both', snap('both', 1)]
]

describe('SideProximityWidget', () => {
  it('is registered in the overlay widget component map', () => {
    expect(WIDGET_COMPONENTS.sideProximity).toBe(SideProximityWidget)
  })

  it('renders a root svg, a DSEG count badge for two cars, and red only when occupied', () => {
    const twoLeft = render(snap('left', 2), 'analog')
    assertClean(twoLeft, 'instrument two-left')
    expect(twoLeft).toContain('<svg')
    expect(twoLeft).toContain(skin.segment.numeric)
    expect(twoLeft, 'occupied side burns red').toContain(skin.palette.crit)

    const clear = render(snap('clear'), 'analog')
    assertClean(clear, 'instrument clear')
    expect(clear, 'a clear track never burns red').not.toContain(skin.palette.crit)
  })

  it('renders every case NaN / undefined / Infinity-free', () => {
    for (const [label, s] of CASES) {
      let out = ''
      expect(() => { out = render(s) }, `${label} render`).not.toThrow()
      assertClean(out, label)
    }
  })

  it('degrades a null snapshot to a dim "—" callout with the caption', () => {
    const out = render(null)
    expect(out).toContain('SIDE PROXIMITY')
    expect(out).toContain('—')
    expect(out).toContain('<svg')
  })

  it('reads CLEAR (green) when nothing is alongside', () => {
    const out = render(snap('clear'))
    expect(out).toContain('CLEAR')
    expect(out, 'clear is the good state → green').toContain(skin.palette.ok)
  })

  it('distinguishes one car from two on the busy side and burns red', () => {
    const oneLeft = render(snap('left', 1))
    expect(oneLeft).toContain('CAR LEFT')
    expect(oneLeft, 'occupied side → red').toContain(skin.palette.crit)
    expect(oneLeft, 'a car alongside is never a good (green) state').not.toContain(skin.palette.ok)

    const twoLeft = render(snap('left', 2))
    expect(twoLeft).toContain('2 LEFT')

    const oneRight = render(snap('right', 1))
    expect(oneRight).toContain('CAR RIGHT')
    const twoRight = render(snap('right', 2))
    expect(twoRight).toContain('2 RIGHT')
  })

  it('calls a car on each side 3 WIDE', () => {
    const out = render(snap('both', 1))
    expect(out).toContain('3 WIDE')
    expect(out).toContain(skin.palette.crit)
  })

  it('renders every style family without changing side-proximity behavior', () => {
    for (const family of FAMILIES) {
      assertClean(render(snap('both', 1), family), `${family} occupied`)
      assertClean(render(snap('clear'), family), `${family} clear`)
    }
  })

  it('is registered per-sim with requires=[carLeftRightCount] (iRacing-tagged)', () => {
    const def = OVERLAY_WIDGETS.find((w) => w.id === 'sideProximity')
    expect(def, 'sideProximity not registered in OVERLAY_WIDGETS').toBeTruthy()
    expect(def?.requires).toEqual(['carLeftRightCount'])
  })
})
