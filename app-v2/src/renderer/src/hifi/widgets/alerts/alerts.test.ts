import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { OverlayTriggerKind } from '../../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { SHIFT_STROBE_BLUE } from '../../../lib/rev-lights'
import { ALERTS_WIDGETS } from './index'

const validTriggerKinds: OverlayTriggerKind[] = ['always', 'carLeft', 'carRight', 'carLeftOrRight', 'proximity', 'shiftPoint', 'pitLimiter', 'flag', 'lowFuel']
const badTokens = /NaN|undefined|Infinity/

function populatedSnapshot(): TelemetrySnapshot {
  return {
    ...baseSnapshot(),
    carLeftRight: 'both',
    radarCars: [{ carIdx: 7, relativeX: 3.2, relativeY: 0.4, gapSec: 0.28 }],
    relatives: {
      ahead: { carIdx: 3, name: 'Ahead', carNumber: '3', gapSec: 0.44 },
      behind: { carIdx: 4, name: 'Behind', carNumber: '4', gapSec: 0.8 }
    },
    shiftIndicatorPct: 1,
    pitLimiter: true,
    flags: { green: false, yellow: true, blue: false, white: false, checkered: false, red: false, black: false, meatball: false, repair: false, disqualify: false, greenWhiteCheckered: false },
    fuelLiters: 4.6,
    fuelPerLap: 2
  }
}

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return ALERTS_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h })))
}

describe('ALERTS_WIDGETS', () => {
  it('declares exactly seven alert modules with default triggers', () => {
    expect(ALERTS_WIDGETS).toHaveLength(7)
    expect(ALERTS_WIDGETS.map((widget) => widget.id)).toEqual([
      'alertCarLeft',
      'alertCarRight',
      'alertProximityRadar',
      'alertShiftFlash',
      'alertPitLimiter',
      'alertFlag',
      'alertLowFuel'
    ])

    for (const widget of ALERTS_WIDGETS) {
      expect(widget.category).toBe('alerts')
      expect(widget.defaultTrigger).toBeDefined()
      expect(validTriggerKinds).toContain(widget.defaultTrigger?.kind)
    }
  })

  it('renders null and populated snapshots without throwing or unsafe tokens', () => {
    for (const markup of [...renderAll(null), ...renderAll(populatedSnapshot())]) {
      expect(markup).not.toMatch(badTokens)
    }
  })

  it('renders the shift alert only as the shared full blue strobe', () => {
    const widget = ALERTS_WIDGETS.find((candidate) => candidate.id === 'alertShiftFlash')!
    const render = (snapshot: TelemetrySnapshot): string =>
      renderToStaticMarkup(createElement(widget.render, { snapshot, width: 1000, height: 36 }))

    expect(render({ ...populatedSnapshot(), shiftIndicatorPct: 0.6 })).not.toContain(SHIFT_STROBE_BLUE)
    const shift = render(populatedSnapshot())
    expect(shift).toContain(SHIFT_STROBE_BLUE)
    expect(shift).toContain('repeatCount="indefinite"')
  })
})
