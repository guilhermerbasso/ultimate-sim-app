import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { COMPARE_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return COMPARE_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h })))
}

function renderWidget(id: string, snapshot: TelemetrySnapshot): string {
  const widget = COMPARE_WIDGETS.find((candidate) => candidate.id === id)
  expect(widget, `missing ${id}`).toBeTruthy()
  if (!widget) return ''
  return renderToStaticMarkup(createElement(widget.render, {
    snapshot,
    width: widget.defaultSize.w,
    height: widget.defaultSize.h
  }))
}

describe('COMPARE_WIDGETS', () => {
  it('exports unique broadcast-comparison modules incl. the full dash', () => {
    const ids = COMPARE_WIDGETS.map((widget) => widget.id)
    expect(ids.length).toBeGreaterThanOrEqual(9)
    expect(new Set(ids).size).toBe(ids.length)
    expect(COMPARE_WIDGETS.every((widget) => widget.category === 'compare')).toBe(true)
    expect(COMPARE_WIDGETS.every((widget) => widget.tags.includes('compare') && widget.tags.includes('ir'))).toBe(true)
    expect(ids).toContain('cmpDash')
    for (const single of ['cmpDriverBlock', 'cmpRefBlock', 'cmpGap', 'cmpStyleBars', 'cmpZoneMap', 'cmpSpeedTrace', 'cmpDeltaTrace']) {
      expect(ids).toContain(single)
    }
  })

  it('renders null and populated snapshots without unsafe tokens', () => {
    const populated: TelemetrySnapshot = {
      ...baseSnapshot(),
      sim: 'iracing',
      driverName: 'DRIVER',
      position: 3,
      speedKmh: 214,
      throttle: 0.82,
      brake: 0.04,
      latAccelG: 1.1,
      lapDistPct: 0.42,
      currentLapTimeSec: 54.31,
      lastLapTimeSec: 112.8,
      bestLapTimeSec: 111.9,
      deltaToBestSec: -0.16
    }

    for (const markup of [...renderAll(null), ...renderAll(populated)]) {
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })

  it('fits a double-digit signed gap with its unit', () => {
    const markup = renderWidget('cmpGap', { ...baseSnapshot(), deltaToBestSec: 10 } as TelemetrySnapshot)
    const value = markup.match(/<text[^>]*font-size="([^"]+)"[^>]*>\+10\.000/)
    expect(value).toBeTruthy()
    expect(Number(value?.[1])).toBeLessThanOrEqual(48)
  })
})
