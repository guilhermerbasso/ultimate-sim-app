import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { TYRES_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return TYRES_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h })))
}

describe('TYRES_WIDGETS', () => {
  it('has unique ids', () => {
    const ids = TYRES_WIDGETS.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('renders base, null, and extreme invalid snapshots without unsafe tokens', () => {
    const extreme: TelemetrySnapshot = {
      ...baseSnapshot(),
      tyres: {
        lf: { tempC: Number.NaN, tempLeftC: Number.POSITIVE_INFINITY, pressureKpa: Number.NaN, wearPct: Number.NaN },
        rf: { tempC: Number.POSITIVE_INFINITY, tempMiddleC: Number.NaN, pressureKpa: Number.POSITIVE_INFINITY, wearPct: Number.POSITIVE_INFINITY },
        lr: { tempC: Number.NEGATIVE_INFINITY, tempRightC: Number.POSITIVE_INFINITY, pressureKpa: Number.NEGATIVE_INFINITY, wearPct: Number.NEGATIVE_INFINITY },
        rr: { tempC: Number.NaN, surfaceTempLeftC: Number.NaN, surfaceTempMiddleC: Number.POSITIVE_INFINITY, surfaceTempRightC: Number.NEGATIVE_INFINITY, pressureKpa: Number.NaN, wearPct: Number.NaN }
      }
    }

    for (const markup of [...renderAll(baseSnapshot()), ...renderAll(null), ...renderAll(extreme)]) {
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })
})
