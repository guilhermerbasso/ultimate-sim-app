import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { IR_CHASSIS_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return IR_CHASSIS_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h })))
}

describe('IR_CHASSIS_WIDGETS', () => {
  it('has unique ids', () => {
    const ids = IR_CHASSIS_WIDGETS.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every widget requires a real v6-surfaced telemetry field', () => {
    const fields = new Set(IR_CHASSIS_WIDGETS.flatMap((w) => w.requires))
    for (const f of ['pitchRad', 'rollRad', 'yawRateRadSec', 'steeringTorquePct', 'vertAccelG', 'altitudeM']) {
      expect(fields.has(f as keyof TelemetrySnapshot)).toBe(true)
    }
  })

  it('renders base, null, and extreme invalid snapshots without unsafe tokens', () => {
    const extreme: TelemetrySnapshot = {
      ...baseSnapshot(),
      pitchRad: Number.NaN,
      rollRad: Number.POSITIVE_INFINITY,
      yawRateRadSec: Number.NEGATIVE_INFINITY,
      steeringTorquePct: Number.NaN,
      vertAccelG: Number.POSITIVE_INFINITY,
      altitudeM: Number.NEGATIVE_INFINITY
    }

    for (const markup of [...renderAll(baseSnapshot()), ...renderAll(null), ...renderAll(extreme)]) {
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })

  it('shows values with data and an em-dash or neutral state when data is missing', () => {
    const data = {
      ...baseSnapshot(),
      pitchRad: 0.05,
      rollRad: -0.06,
      yawRateRadSec: 0.4,
      steeringTorquePct: 0.42,
      vertAccelG: 0.9,
      altitudeM: 120
    } as TelemetrySnapshot

    const rendered = renderAll(data).join('')
    expect(rendered).toContain('23')
    expect(rendered).toContain('42')
    expect(rendered).toContain('+0.90')
    expect(rendered).toContain('120')

    const nullRendered = renderAll(null).join('')
    expect(nullRendered).toContain('—')
    expect(nullRendered).toContain('rotate(0 180 150)')
  })
})
