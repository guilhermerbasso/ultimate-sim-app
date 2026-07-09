import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { SHIFT_STROBE_BLUE } from '../kit'
import { THEMED_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return THEMED_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h })))
}

describe('THEMED_WIDGETS', () => {
  it('exports 12 unique themed modules', () => {
    expect(THEMED_WIDGETS).toHaveLength(12)
    const ids = THEMED_WIDGETS.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(THEMED_WIDGETS.every((widget) => widget.category === 'themed')).toBe(true)
  })

  it('renders null and populated snapshots without unsafe tokens', () => {
    const populated = {
      ...baseSnapshot(),
      rpm: 7200,
      maxRpm: 8500,
      shiftIndicatorPct: 0.82,
      gear: 4,
      speedKmh: 184,
      waterTempC: 92,
      oilTempC: 104
    }

    for (const markup of [...renderAll(null), ...renderAll(populated)]) {
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })

  it('strobes every themed rev display strong blue only at the shift point', () => {
    const highShift = {
      ...baseSnapshot(),
      rpm: 8400,
      maxRpm: 8500,
      shiftIndicatorPct: 0.99,
      gear: 4,
      speedKmh: 184,
      waterTempC: 92,
      oilTempC: 104
    }
    const midShift = { ...highShift, rpm: 5100, shiftIndicatorPct: 0.6 }

    for (const markup of renderAll(highShift)) {
      expect(markup).toContain(SHIFT_STROBE_BLUE)
      expect(markup).toContain('repeatCount="indefinite"')
    }

    for (const markup of renderAll(midShift)) {
      expect(markup).not.toContain(SHIFT_STROBE_BLUE)
      expect(markup).not.toContain('repeatCount="indefinite"')
    }
  })
})
