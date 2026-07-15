import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { IR_ELECTRONICS_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return IR_ELECTRONICS_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h })))
}

describe('IR_ELECTRONICS_WIDGETS', () => {
  it('has unique ids', () => {
    const ids = IR_ELECTRONICS_WIDGETS.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every widget requires the expected iRacing electronics field', () => {
    const fields = new Set(IR_ELECTRONICS_WIDGETS.flatMap((w) => w.requires))
    for (const f of ['drsState', 'pushToPass', 'pushToPassCount']) {
      expect(fields.has(f as keyof TelemetrySnapshot)).toBe(true)
    }
  })

  it('renders base, null, all-on, and extreme invalid snapshots without unsafe tokens', () => {
    const allOn: TelemetrySnapshot = {
      ...baseSnapshot(),
      drs: true,
      drsState: 3,
      pushToPass: true,
      pushToPassCount: 8
    }
    const extreme: TelemetrySnapshot = {
      ...baseSnapshot(),
      pushToPassCount: Number.NaN
    }

    for (const markup of [...renderAll(baseSnapshot()), ...renderAll(null), ...renderAll(allOn), ...renderAll(extreme)]) {
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })

  it('renders all normalized DRS states and the deactivated hold', () => {
    const drs = IR_ELECTRONICS_WIDGETS.find((widget) => widget.id === 'drs')
    expect(drs).toBeTruthy()
    const size = drs?.defaultSize ?? { w: 320, h: 220 }
    const render = (drsState: 0 | 1 | 2 | 3, phase = 'drs-state') =>
      renderToStaticMarkup(createElement(drs?.render ?? IR_ELECTRONICS_WIDGETS[0].render, {
        snapshot: { ...baseSnapshot(), drsState } as TelemetrySnapshot,
        width: size.w,
        height: size.h,
        visibility: { visible: true, active: drsState > 0, held: phase === 'drs-deactivated', phase }
      }))

    expect(render(1)).toContain('AVAILABLE')
    expect(render(2)).toContain('ZONE')
    expect(render(3)).toContain('ACTIVE')
    expect(render(0, 'drs-deactivated')).toContain('DEACTIVATED')
  })
})
