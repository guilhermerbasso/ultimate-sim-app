import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { IR_VITALS_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return IR_VITALS_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h })))
}

describe('IR_VITALS_WIDGETS', () => {
  it('has unique ids', () => {
    const ids = IR_VITALS_WIDGETS.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every widget requires a real v6-surfaced telemetry field', () => {
    const fields = new Set(IR_VITALS_WIDGETS.flatMap((w) => w.requires))
    for (const f of ['voltage', 'manifoldPressBar', 'fuelPressBar', 'waterLevelL', 'oilLevelL']) {
      expect(fields.has(f as keyof TelemetrySnapshot)).toBe(true)
    }
  })

  it('renders base, null, and extreme invalid snapshots without unsafe tokens', () => {
    const extreme: TelemetrySnapshot = {
      ...baseSnapshot(),
      voltage: Number.NaN,
      manifoldPressBar: Number.POSITIVE_INFINITY,
      fuelPressBar: Number.NEGATIVE_INFINITY,
      waterLevelL: Number.NaN,
      oilLevelL: Number.POSITIVE_INFINITY
    }

    for (const markup of [...renderAll(baseSnapshot()), ...renderAll(null), ...renderAll(extreme)]) {
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })

  it('shows a value with base snapshot data and an em-dash when the field is missing', () => {
    const voltage = IR_VITALS_WIDGETS[0]
    const size = voltage.defaultSize
    const withData = renderToStaticMarkup(
      createElement(voltage.render, { snapshot: { ...baseSnapshot(), voltage: 12.6 } as TelemetrySnapshot, width: size.w, height: size.h })
    )
    expect(withData).toContain('12.6')
    const missing = renderToStaticMarkup(createElement(voltage.render, { snapshot: null, width: size.w, height: size.h }))
    expect(missing).toContain('—')
  })
})
