import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { SHIFT_STROBE_BLUE } from '../../../lib/rev-lights'
import { IR_EXTRA_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function dataSnapshot(): TelemetrySnapshot {
  return {
    ...baseSnapshot(),
    fuelLevelPct: 0.48,
    fuelUsePerHourKg: 3.4,
    brakeLinePressBar: { lf: 62, rf: 60, lr: 44, rr: 45 },
    skies: 1,
    revLights: { pct: 0.9, blink: false },
    carLeftRightCount: 1,
    carLeftRight: 'left'
  }
}

function renderWidget(widget: (typeof IR_EXTRA_WIDGETS)[number], snapshot: TelemetrySnapshot | null): string {
  return renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h }))
}

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return IR_EXTRA_WIDGETS.map((widget) => renderWidget(widget, snapshot))
}

describe('IR_EXTRA_WIDGETS', () => {
  it('has unique ids', () => {
    const ids = IR_EXTRA_WIDGETS.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('requires the expected surfaced telemetry fields', () => {
    const byId = new Map(IR_EXTRA_WIDGETS.map((w) => [w.id, w.requires]))
    expect(byId.get('fuelLevelPct')).toEqual(['fuelLevelPct'])
    expect(byId.get('fuelRate')).toEqual(['fuelUsePerHourKg'])
    expect(byId.get('brakeLinePress')).toEqual(['brakeLinePressBar'])
    expect(byId.get('skies')).toEqual(['skies'])
    expect(byId.get('revLightsBar')).toEqual(['revLights'])
    expect(byId.get('carsAlongside')).toEqual(['carLeftRightCount', 'carLeftRight'])
  })

  it('renders base, null, data, and extreme invalid snapshots without unsafe tokens', () => {
    const extreme = {
      ...baseSnapshot(),
      fuelLevelPct: Number.NaN,
      fuelUsePerHourKg: Number.POSITIVE_INFINITY,
      brakeLinePressBar: { lf: Number.NaN, rf: Number.POSITIVE_INFINITY, lr: Number.NEGATIVE_INFINITY, rr: Number.NaN },
      skies: Number.POSITIVE_INFINITY,
      revLights: { pct: Number.NaN },
      carLeftRightCount: Number.NEGATIVE_INFINITY,
      carLeftRight: 'clear'
    } as TelemetrySnapshot

    for (const markup of [...renderAll(baseSnapshot()), ...renderAll(null), ...renderAll(dataSnapshot()), ...renderAll(extreme)]) {
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })

  it('shows expected data states and neutral/null states', () => {
    const withData = renderAll(dataSnapshot()).join('\n')
    expect(withData).toContain('48')
    expect(withData).toContain('3.4')
    expect(withData).toContain('62')
    expect(withData).toContain('PARTLY')
    expect(withData).toContain('LEFT')

    const nullMarkup = renderAll(null).join('\n')
    expect(nullMarkup).toMatch(/—|CLEAR/)
  })

  it('uses the shared blue strobe for the rev-lights widget', () => {
    const widget = IR_EXTRA_WIDGETS.find((candidate) => candidate.id === 'revLightsBar')!
    const mid = renderWidget(widget, { ...dataSnapshot(), revLights: { pct: 0.6, blink: false } })
    expect(mid).not.toContain(SHIFT_STROBE_BLUE)
    expect(mid).not.toContain('repeatCount="indefinite"')

    const shift = renderWidget(widget, { ...dataSnapshot(), revLights: { pct: 1, blink: true } })
    expect(shift).toContain(SHIFT_STROBE_BLUE)
    expect(shift).toContain('repeatCount="indefinite"')
  })
})
