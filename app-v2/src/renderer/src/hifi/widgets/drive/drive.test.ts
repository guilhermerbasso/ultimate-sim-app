import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { SHIFT_STROBE_BLUE } from '../../../lib/rev-lights'
import { DRIVE_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return DRIVE_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h })))
}

describe('DRIVE_WIDGETS', () => {
  it('has unique ids', () => {
    const ids = DRIVE_WIDGETS.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('renders base, null, and extreme invalid snapshots without unsafe tokens', () => {
    const extreme = {
      ...baseSnapshot(),
      speedKmh: Number.NaN,
      rpm: Number.POSITIVE_INFINITY,
      maxRpm: Number.NEGATIVE_INFINITY,
      gear: Number.NaN,
      shiftIndicatorPct: Number.POSITIVE_INFINITY
    }

    for (const markup of [...renderAll(baseSnapshot()), ...renderAll(null), ...renderAll(extreme)]) {
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })

  it('registers the rev-lights variants with required tags and renders them', () => {
    const variants = [
      { id: 'revlightsGradient', tags: ['rev-lights', 'gradient', 'rpm', 'shift'] },
      { id: 'revlightsLedStrip', tags: ['rev-lights', 'led-strip', 'rpm', 'shift'] },
      { id: 'revlightsLedBar', tags: ['rev-lights', 'led-bar', 'rpm', 'shift'] },
      { id: 'revlightsMustang', tags: ['rev-lights', 'mustang', 'rpm', 'shift', 'center'] }
    ]

    for (const variant of variants) {
      const widget = DRIVE_WIDGETS.find((candidate) => candidate.id === variant.id)
      expect(widget).toBeDefined()
      expect(widget?.category).toBe('drive')
      expect(widget?.tags).toEqual(expect.arrayContaining(variant.tags))

      const markup = renderToStaticMarkup(createElement(widget!.render, { snapshot: baseSnapshot(), width: widget!.defaultSize.w, height: widget!.defaultSize.h }))
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })

  it('uses the shared strong-blue strobe across every rev/RPM light strip', () => {
    const ids = ['rpmBar', 'revlights', 'revlightsGradient', 'revlightsLedStrip', 'revlightsLedBar', 'revlightsMustang']
    const shift = { ...baseSnapshot(), shiftIndicatorPct: 1 }
    const mid = { ...baseSnapshot(), shiftIndicatorPct: 0.6 }

    for (const id of ids) {
      const widget = DRIVE_WIDGETS.find((candidate) => candidate.id === id)!
      const shifted = renderToStaticMarkup(createElement(widget.render, { snapshot: shift, width: 1000, height: 36 }))
      const normal = renderToStaticMarkup(createElement(widget.render, { snapshot: mid, width: 1000, height: 36 }))
      expect(shifted, id).toContain(SHIFT_STROBE_BLUE)
      expect(shifted, id).toContain('repeatCount="indefinite"')
      expect(shifted, id).toContain('viewBox="0 0 1000 36"')
      expect(normal, id).not.toContain(SHIFT_STROBE_BLUE)
      expect(normal, id).not.toContain('repeatCount="indefinite"')
    }
  })
})
