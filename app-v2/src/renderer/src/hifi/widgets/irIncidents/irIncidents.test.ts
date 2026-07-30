import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { IR_INCIDENTS_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return IR_INCIDENTS_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h })))
}

describe('IR_INCIDENTS_WIDGETS', () => {
  it('has unique ids', () => {
    const ids = IR_INCIDENTS_WIDGETS.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every widget requires the surfaced iRacing incident fields', () => {
    const fields = new Set(IR_INCIDENTS_WIDGETS.flatMap((w) => w.requires))
    for (const f of ['incidentCountMy', 'incidentLimit', 'incidentCountTeam', 'fastRepairsAvailable', 'fastRepairsUsed']) {
      expect(fields.has(f as keyof TelemetrySnapshot)).toBe(true)
    }
  })

  it('renders base, null, data, and extreme invalid snapshots without unsafe tokens', () => {
    const data: TelemetrySnapshot = {
      ...baseSnapshot(),
      incidentCountMy: 4,
      incidentLimit: 17,
      incidentCountTeam: 9,
      fastRepairsAvailable: 2,
      fastRepairsUsed: 1
    }
    const extreme: TelemetrySnapshot = {
      ...baseSnapshot(),
      incidentCountMy: Number.NaN,
      incidentLimit: Number.POSITIVE_INFINITY,
      incidentCountTeam: Number.NEGATIVE_INFINITY,
      fastRepairsAvailable: Number.NaN,
      fastRepairsUsed: Number.POSITIVE_INFINITY
    }

    for (const markup of [...renderAll(baseSnapshot()), ...renderAll(null), ...renderAll(data), ...renderAll(extreme)]) {
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })

  it('shows numbers with data and an em-dash for null snapshots', () => {
    const mine = IR_INCIDENTS_WIDGETS[0]
    const repair = IR_INCIDENTS_WIDGETS[2]
    const data = {
      ...baseSnapshot(),
      incidentCountMy: 4,
      incidentLimit: 17,
      incidentCountTeam: 9,
      fastRepairsAvailable: 2,
      fastRepairsUsed: 1
    } as TelemetrySnapshot

    const withData = renderToStaticMarkup(createElement(mine.render, { snapshot: data, width: mine.defaultSize.w, height: mine.defaultSize.h }))
    expect(withData).toContain('4x')
    expect(withData).toContain('17')

    const repairWithData = renderToStaticMarkup(createElement(repair.render, { snapshot: data, width: repair.defaultSize.w, height: repair.defaultSize.h }))
    expect(repairWithData).toContain('2')

    const missing = renderToStaticMarkup(createElement(mine.render, { snapshot: null, width: mine.defaultSize.w, height: mine.defaultSize.h }))
    expect(missing).toContain('—')
  })
})
