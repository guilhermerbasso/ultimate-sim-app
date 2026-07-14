import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { INPUTS_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return INPUTS_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h })))
}

describe('INPUTS_WIDGETS', () => {
  it('has unique ids', () => {
    const ids = INPUTS_WIDGETS.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('renders base, null, and extreme invalid snapshots without unsafe tokens', () => {
    const extreme = {
      ...baseSnapshot(),
      throttle: Number.NaN,
      brake: Number.POSITIVE_INFINITY,
      clutch: Number.NEGATIVE_INFINITY,
      steerAngleDeg: Number.NaN
    }

    for (const markup of [...renderAll(baseSnapshot()), ...renderAll(null), ...renderAll(extreme)]) {
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })

  it('keeps 100% readouts inset for the shared throttle, brake, and clutch layout', () => {
    const fullInput = { ...baseSnapshot(), throttle: 1, brake: 1, clutch: 1 } as TelemetrySnapshot

    for (const id of ['throttle', 'brake', 'clutch']) {
      const widget = INPUTS_WIDGETS.find((candidate) => candidate.id === id)
      expect(widget, `missing ${id}`).toBeTruthy()
      if (!widget) continue

      const markup = renderToStaticMarkup(createElement(widget.render, {
        snapshot: fullInput,
        width: widget.defaultSize.w,
        height: widget.defaultSize.h
      }))
      const readout = markup.match(/<text[^>]*x="([^"]+)"[^>]*y="118"[^>]*font-size="([^"]+)"[^>]*>100<\/text>/)
      expect(readout, `${id} full-scale readout`).toBeTruthy()
      if (!readout) continue

      expect(Number(readout[1])).toBeLessThan(widget.defaultSize.w - 45)
      expect(Number(readout[2])).toBeGreaterThanOrEqual(28)
      expect(Number(readout[2])).toBeLessThan(42)
    }
  })

  it('fits the full-scale readout when the shared input widget narrows to 140px', () => {
    const widget = INPUTS_WIDGETS.find((candidate) => candidate.id === 'throttle')
    expect(widget).toBeTruthy()
    if (!widget) return

    const markup = renderToStaticMarkup(createElement(widget.render, {
      snapshot: { ...baseSnapshot(), throttle: 1 } as TelemetrySnapshot,
      width: 140,
      height: widget.defaultSize.h
    }))
    const readout = markup.match(/<text[^>]*x="([^"]+)"[^>]*y="118"[^>]*font-size="([^"]+)"[^>]*>100<\/text>/)
    expect(readout).toBeTruthy()
    if (!readout) return

    const x = Number(readout[1])
    const size = Number(readout[2])
    expect(size).toBeGreaterThanOrEqual(18)
    expect(size).toBeLessThanOrEqual(19)
    expect(x + (3 * size) / 2).toBeLessThanOrEqual(134)
  })
})
