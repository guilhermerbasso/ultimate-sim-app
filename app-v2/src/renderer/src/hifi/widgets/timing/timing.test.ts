import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { TIMING_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return TIMING_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h })))
}

describe('TIMING_WIDGETS', () => {
  it('has unique ids', () => {
    const ids = TIMING_WIDGETS.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('renders base, null, and extreme invalid snapshots without unsafe tokens', () => {
    const extreme = {
      ...baseSnapshot(),
      deltaToBestSec: Number.NaN,
      deltaToSessionBestSec: Number.POSITIVE_INFINITY,
      currentLapTimeSec: Number.NEGATIVE_INFINITY,
      lastLapTimeSec: Number.NaN,
      bestLapTimeSec: Number.POSITIVE_INFINITY,
      currentLap: Number.NaN,
      lapsRemaining: Number.NEGATIVE_INFINITY,
      sessionTimeRemainingSec: Number.POSITIVE_INFINITY,
      position: Number.NaN,
      classPosition: Number.POSITIVE_INFINITY,
      totalCars: Number.NEGATIVE_INFINITY
    }

    for (const markup of [...renderAll(baseSnapshot()), ...renderAll(null), ...renderAll(extreme)]) {
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })
})
