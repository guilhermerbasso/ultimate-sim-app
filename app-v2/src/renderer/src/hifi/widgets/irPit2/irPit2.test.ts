import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { IR_PIT2_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return IR_PIT2_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h })))
}

describe('IR_PIT2_WIDGETS', () => {
  it('has unique ids', () => {
    const ids = IR_PIT2_WIDGETS.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('requires the iRacing pit fields', () => {
    const fields = new Set(IR_PIT2_WIDGETS.flatMap((w) => w.requires))
    for (const f of ['onPitRoad', 'pitLimiter', 'pitServiceFlags', 'pit']) {
      expect(fields.has(f as keyof TelemetrySnapshot)).toBe(true)
    }
  })

  it('renders base, null, active, and off snapshots without unsafe tokens', () => {
    const active: TelemetrySnapshot = {
      ...baseSnapshot(),
      onPitRoad: true,
      pitLimiter: true,
      pitServiceFlags: ['fuel', 'lf', 'rf'],
      pit: { repairNeeded: true, optRepairNeeded: false, pitsOpen: true, inPitStall: false, svStatus: 1 }
    }
    const off: TelemetrySnapshot = {
      ...baseSnapshot(),
      onPitRoad: false,
      pitLimiter: false,
      pitServiceFlags: [],
      pit: { repairNeeded: false, optRepairNeeded: false, pitsOpen: false, inPitStall: false, svStatus: 0 }
    }

    for (const markup of [...renderAll(baseSnapshot()), ...renderAll(null), ...renderAll(active), ...renderAll(off)]) {
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })

  it('renders pitRoad active and off as distinct states', () => {
    const pitRoad = IR_PIT2_WIDGETS.find((widget) => widget.id === 'pitRoad')
    expect(pitRoad).toBeTruthy()
    const size = pitRoad?.defaultSize ?? { w: 340, h: 300 }
    const active = renderToStaticMarkup(createElement(pitRoad?.render ?? IR_PIT2_WIDGETS[0].render, { snapshot: { ...baseSnapshot(), onPitRoad: true, pitLimiter: true } as TelemetrySnapshot, width: size.w, height: size.h }))
    const off = renderToStaticMarkup(createElement(pitRoad?.render ?? IR_PIT2_WIDGETS[0].render, { snapshot: { ...baseSnapshot(), onPitRoad: false, pitLimiter: false } as TelemetrySnapshot, width: size.w, height: size.h }))

    expect(active).not.toBe(off)
    expect(active).toContain('LIMITER')
    expect(off).toContain('OFF')
  })
})
