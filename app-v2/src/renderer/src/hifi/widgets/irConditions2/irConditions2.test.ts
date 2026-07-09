import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { IR_CONDITIONS2_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return IR_CONDITIONS2_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h })))
}

describe('IR_CONDITIONS2_WIDGETS', () => {
  it('has unique ids', () => {
    const ids = IR_CONDITIONS2_WIDGETS.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every widget requires the iRacing condition fields', () => {
    const fields = new Set(IR_CONDITIONS2_WIDGETS.flatMap((w) => w.requires))
    for (const f of ['isRaining', 'weatherDeclaredWet', 'trackSurfaceMaterial']) {
      expect(fields.has(f as keyof TelemetrySnapshot)).toBe(true)
    }
  })

  it('renders base, null, all-on, and extreme invalid snapshots without unsafe tokens', () => {
    const allOn: TelemetrySnapshot = {
      ...baseSnapshot(),
      isRaining: true,
      weatherDeclaredWet: true,
      trackSurfaceMaterial: 12
    }
    const extreme: TelemetrySnapshot = {
      ...baseSnapshot(),
      trackSurfaceMaterial: Number.NaN
    }

    for (const markup of [...renderAll(baseSnapshot()), ...renderAll(null), ...renderAll(allOn), ...renderAll(extreme)]) {
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })

  it('renders rain true and false as distinct tell-tale states', () => {
    const rain = IR_CONDITIONS2_WIDGETS.find((widget) => widget.id === 'rainState')
    expect(rain).toBeTruthy()
    const size = rain?.defaultSize ?? { w: 360, h: 300 }
    const wet = renderToStaticMarkup(createElement(rain?.render ?? IR_CONDITIONS2_WIDGETS[0].render, { snapshot: { ...baseSnapshot(), isRaining: true } as TelemetrySnapshot, width: size.w, height: size.h }))
    const dry = renderToStaticMarkup(createElement(rain?.render ?? IR_CONDITIONS2_WIDGETS[0].render, { snapshot: { ...baseSnapshot(), isRaining: false } as TelemetrySnapshot, width: size.w, height: size.h }))

    expect(wet).not.toBe(dry)
    expect(wet).toContain('WET')
    expect(dry).toContain('DRY')
  })
})
