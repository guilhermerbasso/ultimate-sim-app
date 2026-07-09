import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { IR_ENV2_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return IR_ENV2_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h })))
}

describe('IR_ENV2_WIDGETS', () => {
  it('has unique ids', () => {
    const ids = IR_ENV2_WIDGETS.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every widget requires a real v6-surfaced environment field', () => {
    const fields = new Set(IR_ENV2_WIDGETS.flatMap((w) => w.requires))
    for (const f of ['fogPct', 'humidityPct', 'windDirRad', 'windSpeedMs', 'solarAltitudeRad']) {
      expect(fields.has(f as keyof TelemetrySnapshot)).toBe(true)
    }
  })

  it('renders base, null, and extreme invalid snapshots without unsafe tokens', () => {
    const extreme: TelemetrySnapshot = {
      ...baseSnapshot(),
      fogPct: Number.NaN,
      humidityPct: Number.POSITIVE_INFINITY,
      windDirRad: Number.NEGATIVE_INFINITY,
      windSpeedMs: Number.NaN,
      solarAltitudeRad: Number.POSITIVE_INFINITY
    }

    for (const markup of [...renderAll(baseSnapshot()), ...renderAll(null), ...renderAll(extreme)]) {
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })

  it('shows a percent value and an em-dash when the field is missing', () => {
    const humidity = IR_ENV2_WIDGETS[1]
    const size = humidity.defaultSize
    const withData = renderToStaticMarkup(
      createElement(humidity.render, { snapshot: { ...baseSnapshot(), humidityPct: 0.62 } as TelemetrySnapshot, width: size.w, height: size.h })
    )
    expect(withData).toContain('62')
    const missing = renderToStaticMarkup(createElement(humidity.render, { snapshot: null, width: size.w, height: size.h }))
    expect(missing).toContain('—')
  })
})
