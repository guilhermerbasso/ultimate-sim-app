import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
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
})
