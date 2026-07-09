import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { IR_SESSIONINFO_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return IR_SESSIONINFO_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h })))
}

describe('IR_SESSIONINFO_WIDGETS', () => {
  it('has unique ids', () => {
    const ids = IR_SESSIONINFO_WIDGETS.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every widget requires the iRacing session info fields', () => {
    const fields = new Set(IR_SESSIONINFO_WIDGETS.flatMap((w) => w.requires))
    for (const f of ['sessionState', 'paceMode', 'paceFlags', 'carName', 'carPath', 'trackName', 'trackConfigName']) {
      expect(fields.has(f as keyof TelemetrySnapshot)).toBe(true)
    }
  })

  it('renders base, null, data, and long car snapshots without unsafe tokens', () => {
    const data = {
      ...baseSnapshot(),
      sessionState: 4,
      paceMode: 1,
      paceFlags: 0x0001,
      carName: 'Ferrari 296 GT3',
      carPath: 'ferrari296gt3',
      trackName: 'Spa',
      trackConfigName: 'Grand Prix'
    } as unknown as TelemetrySnapshot
    const longCar = {
      ...data,
      carName: 'Ferrari 296 GT3 Extremely Long Endurance Team Prototype Name With Sponsor Pack',
      trackName: 'Circuit de Spa-Francorchamps Very Long Historic Endurance Layout',
      trackConfigName: 'Grand Prix International Endurance Configuration'
    } as unknown as TelemetrySnapshot

    for (const markup of [...renderAll(baseSnapshot()), ...renderAll(null), ...renderAll(data), ...renderAll(longCar)]) {
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })

  it('renders decoded labels and names for data and em dashes for null', () => {
    const data = {
      ...baseSnapshot(),
      sessionState: 4,
      paceMode: 1,
      paceFlags: 0,
      carName: 'Ferrari 296 GT3',
      carPath: 'ferrari296gt3',
      trackName: 'Spa',
      trackConfigName: 'Grand Prix'
    } as unknown as TelemetrySnapshot
    const dataMarkup = renderAll(data).join('\n')
    const nullMarkup = renderAll(null).join('\n')

    expect(dataMarkup).toContain('RACING')
    expect(dataMarkup).toContain('DOUBLE-FILE')
    expect(dataMarkup).toContain('Ferrari 296 GT3')
    expect(dataMarkup).toContain('Spa')
    expect(dataMarkup).toContain('GRAND PRIX')
    expect(nullMarkup).toContain('—')
  })
})
