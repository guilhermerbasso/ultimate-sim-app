import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { BRAKES_ENGINE_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return BRAKES_ENGINE_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h })))
}

describe('BRAKES_ENGINE_WIDGETS', () => {
  it('has unique ids', () => {
    const ids = BRAKES_ENGINE_WIDGETS.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('renders base, null, and extreme invalid snapshots without unsafe tokens', () => {
    const extreme: TelemetrySnapshot = {
      ...baseSnapshot(),
      brakeTempC: {
        lf: Number.NaN,
        rf: Number.POSITIVE_INFINITY,
        lr: Number.NEGATIVE_INFINITY,
        rr: Number.NaN
      },
      brakeBiasPct: Number.NaN,
      oilTempC: Number.POSITIVE_INFINITY,
      waterTempC: Number.NEGATIVE_INFINITY,
      oilPressureKpa: Number.NaN,
      tcLevel: Number.NaN,
      absLevel: Number.POSITIVE_INFINITY,
      engineMap: Number.NEGATIVE_INFINITY,
      ersBatteryPct: Number.NaN
    }

    for (const markup of [...renderAll(baseSnapshot()), ...renderAll(null), ...renderAll(extreme)]) {
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })
})
