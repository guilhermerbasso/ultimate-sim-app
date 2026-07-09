import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { IR_TIMING2_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return IR_TIMING2_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h })))
}

describe('IR_TIMING2_WIDGETS', () => {
  it('has unique ids', () => {
    const ids = IR_TIMING2_WIDGETS.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every widget requires the expected v6-surfaced telemetry field', () => {
    const expected: Record<string, keyof TelemetrySnapshot> = {
      deltaToOptimal: 'deltaToOptimalSec',
      deltaToSessionOptimal: 'deltaToSessionOptimalSec',
      deltaToDriverBest: 'deltaToDriverBestSec',
      estimatedLap: 'estimatedLapTimeSec'
    }

    for (const widget of IR_TIMING2_WIDGETS) {
      expect(widget.requires).toContain(expected[widget.id])
    }
  })

  it('renders base, null, and extreme invalid snapshots without unsafe tokens', () => {
    const extreme: TelemetrySnapshot = {
      ...baseSnapshot(),
      deltaToOptimalSec: Number.NaN,
      deltaToSessionOptimalSec: Number.POSITIVE_INFINITY,
      deltaToDriverBestSec: Number.NEGATIVE_INFINITY,
      estimatedLapTimeSec: Number.NaN
    }

    for (const markup of [...renderAll(baseSnapshot()), ...renderAll(null), ...renderAll(extreme)]) {
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })

  it('shows a value with positive data and an em-dash when the field is missing', () => {
    const delta = IR_TIMING2_WIDGETS[1]
    const size = delta.defaultSize
    const withData = renderToStaticMarkup(
      createElement(delta.render, { snapshot: { ...baseSnapshot(), deltaToSessionOptimalSec: 0.21 } as TelemetrySnapshot, width: size.w, height: size.h })
    )
    expect(withData).toContain('+0.21')
    const missing = renderToStaticMarkup(createElement(delta.render, { snapshot: null, width: size.w, height: size.h }))
    expect(missing).toContain('—')
  })
})
