import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { CARS_REAL_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return CARS_REAL_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h })))
}

describe('CARS_REAL_WIDGETS', () => {
  it('exports unique car modules (Ferrari 296, Porsche Cup, Mustang GTD, ...)', () => {
    const ids = CARS_REAL_WIDGETS.map((widget) => widget.id)
    expect(ids.length).toBeGreaterThanOrEqual(33)
    expect(new Set(ids).size).toBe(ids.length)
    expect(CARS_REAL_WIDGETS.every((widget) => widget.category === 'cars')).toBe(true)
    expect(CARS_REAL_WIDGETS.every((widget) => widget.tags.includes('car') && widget.tags.includes('ir'))).toBe(true)
    for (const dashId of ['f296Dash', 'pcupDash', 'gtdDash']) {
      expect(ids).toContain(dashId)
    }
  })

  it('renders null and populated snapshots without unsafe tokens', () => {
    const populated: TelemetrySnapshot = {
      ...baseSnapshot(),
      sim: 'iracing',
      rpm: 8100,
      maxRpm: 8500,
      shiftIndicatorPct: 0.93,
      gear: 4,
      speedKmh: 213,
      fuelLiters: 48,
      tcLevel: 4,
      absLevel: 2,
      engineMap: 3,
      lastLapTimeSec: 112.8,
      deltaToBestSec: -0.16
    }

    for (const markup of [...renderAll(null), ...renderAll(populated)]) {
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })
})
