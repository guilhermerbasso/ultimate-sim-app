import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { IR_SESSION2_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return IR_SESSION2_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h })))
}

describe('IR_SESSION2_WIDGETS', () => {
  it('has unique ids', () => {
    const ids = IR_SESSION2_WIDGETS.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every widget requires a real session telemetry field', () => {
    const fields = new Set(IR_SESSION2_WIDGETS.flatMap((w) => w.requires))
    for (const f of ['strengthOfField', 'sessionTimeOfDay', 'weightPenaltyKg', 'powerAdjustPct']) {
      expect(fields.has(f as keyof TelemetrySnapshot)).toBe(true)
    }
  })

  it('renders base, null, and extreme invalid snapshots without unsafe tokens', () => {
    const extreme: TelemetrySnapshot = {
      ...baseSnapshot(),
      strengthOfField: Number.NaN,
      sessionTimeOfDay: Number.POSITIVE_INFINITY,
      weightPenaltyKg: Number.NEGATIVE_INFINITY,
      powerAdjustPct: Number.POSITIVE_INFINITY
    }

    for (const markup of [...renderAll(baseSnapshot()), ...renderAll(null), ...renderAll(extreme)]) {
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })

  it('shows a value with data and an em-dash when the field is missing', () => {
    const sof = IR_SESSION2_WIDGETS[0]
    const size = sof.defaultSize
    const withData = renderToStaticMarkup(
      createElement(sof.render, { snapshot: { ...baseSnapshot(), strengthOfField: 3250 } as TelemetrySnapshot, width: size.w, height: size.h })
    )
    expect(withData).toContain('3250')
    const missing = renderToStaticMarkup(createElement(sof.render, { snapshot: null, width: size.w, height: size.h }))
    expect(missing).toContain('—')
  })

  it('fits a five-digit strength of field inside the default viewBox', () => {
    const sof = IR_SESSION2_WIDGETS[0]
    const size = sof.defaultSize
    const markup = renderToStaticMarkup(
      createElement(sof.render, { snapshot: { ...baseSnapshot(), strengthOfField: 10000 } as TelemetrySnapshot, width: size.w, height: size.h })
    )
    const value = markup.match(/<text[^>]*font-size="([^"]+)"[^>]*>10000<\/text>/)
    expect(value).toBeTruthy()
    expect(Number(value?.[1])).toBeLessThanOrEqual(78)
  })
})
