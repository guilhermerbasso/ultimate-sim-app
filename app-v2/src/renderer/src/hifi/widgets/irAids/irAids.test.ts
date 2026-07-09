import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { IR_AIDS_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return IR_AIDS_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h })))
}

describe('IR_AIDS_WIDGETS', () => {
  it('has unique ids', () => {
    const ids = IR_AIDS_WIDGETS.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every widget requires the iRacing driver-aid fields', () => {
    const fields = new Set(IR_AIDS_WIDGETS.flatMap((w) => w.requires))
    for (const f of ['absActive', 'absEnabled', 'absCutPct', 'tcActive', 'tcEnabled', 'handbrake', 'engineWarnings']) {
      expect(fields.has(f as keyof TelemetrySnapshot)).toBe(true)
    }
  })

  it('renders base, null, all-on, and extreme invalid snapshots without unsafe tokens', () => {
    const allOn: TelemetrySnapshot = {
      ...baseSnapshot(),
      absActive: true,
      absCutPct: 12,
      tcActive: true,
      handbrake: 0.7,
      engineWarnings: {
        waterTemp: true,
        fuelPressure: true,
        oilPressure: true,
        oilTemp: false,
        stalled: true,
        pitLimiter: true,
        revLimiter: false,
        mandRepair: false,
        optRepair: true
      }
    }
    const extreme: TelemetrySnapshot = {
      ...baseSnapshot(),
      handbrake: Number.NaN,
      absCutPct: Number.POSITIVE_INFINITY
    }

    for (const markup of [...renderAll(baseSnapshot()), ...renderAll(null), ...renderAll(allOn), ...renderAll(extreme)]) {
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })

  it('renders ABS active and inactive as distinct tell-tale states', () => {
    const abs = IR_AIDS_WIDGETS.find((widget) => widget.id === 'absState')
    expect(abs).toBeTruthy()
    const size = abs?.defaultSize ?? { w: 320, h: 240 }
    const on = renderToStaticMarkup(createElement(abs?.render ?? IR_AIDS_WIDGETS[0].render, { snapshot: { ...baseSnapshot(), absActive: true, absCutPct: 12 } as TelemetrySnapshot, width: size.w, height: size.h }))
    const off = renderToStaticMarkup(createElement(abs?.render ?? IR_AIDS_WIDGETS[0].render, { snapshot: { ...baseSnapshot(), absActive: false, absCutPct: 0 } as TelemetrySnapshot, width: size.w, height: size.h }))

    expect(on).not.toBe(off)
    expect(on).toContain('ABS')
    expect(off).toContain('ABS')
  })
})
