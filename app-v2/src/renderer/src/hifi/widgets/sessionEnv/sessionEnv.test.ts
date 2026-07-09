import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { SESSION_ENV_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return SESSION_ENV_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h })))
}

describe('SESSION_ENV_WIDGETS', () => {
  it('has unique ids', () => {
    const ids = SESSION_ENV_WIDGETS.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('renders base, null, and extreme invalid snapshots without unsafe tokens', () => {
    const extreme: TelemetrySnapshot = {
      ...baseSnapshot(),
      flags: undefined,
      pitLimiter: undefined,
      incidentCount: Number.NaN,
      airTempC: Number.POSITIVE_INFINITY,
      trackTempC: Number.NEGATIVE_INFINITY,
      trackWetnessPct: Number.NaN,
      gripPct: Number.POSITIVE_INFINITY,
      lapDistPct: Number.NaN,
      latAccelG: Number.NaN,
      longAccelG: Number.NEGATIVE_INFINITY,
      sessionType: undefined,
      currentLap: Number.NaN,
      lapsRemaining: Number.POSITIVE_INFINITY,
      sessionTimeRemainingSec: Number.NEGATIVE_INFINITY
    }

    for (const markup of [...renderAll(baseSnapshot()), ...renderAll(null), ...renderAll(extreme)]) {
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })
})
