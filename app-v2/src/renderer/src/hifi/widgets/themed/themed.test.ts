import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { SHIFT_STROBE_BLUE } from '../../../lib/rev-lights'
import { THEMED_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return THEMED_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h })))
}

function renderWidget(id: string, snapshot: TelemetrySnapshot): string {
  const widget = THEMED_WIDGETS.find((candidate) => candidate.id === id)
  expect(widget, `missing ${id}`).toBeTruthy()
  return renderToStaticMarkup(createElement(widget!.render, {
    snapshot,
    width: widget!.defaultSize.w,
    height: widget!.defaultSize.h
  }))
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
      rpm: 2000,
      maxRpm: 8500,
      shiftIndicatorPct: 0.2,
      revLights: { pct: 0.2, blink: true },
      gear: 4,
      speedKmh: 184,
      waterTempC: 92,
      oilTempC: 104
    }
    const midShift = {
      ...highShift,
      rpm: 8400,
      shiftIndicatorPct: 0.999,
      revLights: { pct: 0.999, blink: false }
    }

    for (const markup of renderAll(highShift)) {
      expect(markup).toContain(SHIFT_STROBE_BLUE)
      expect(markup).toContain('repeatCount="indefinite"')
    }

    for (const markup of renderAll(midShift)) {
      expect(markup).not.toContain(SHIFT_STROBE_BLUE)
      expect(markup).not.toContain('repeatCount="indefinite"')
    }
  })

  it('keeps signature-cluster RPM arcs calibrated while their mini strips strobe', () => {
    const snapshot = {
      ...baseSnapshot(),
      rpm: 4250,
      maxRpm: 8500,
      shiftIndicatorPct: 0.2,
      revLights: { pct: 0.2, blink: true }
    } as TelemetrySnapshot

    for (const id of ['clusterFerrari', 'clusterPorsche', 'clusterAmg', 'clusterMclaren', 'clusterCorvette', 'clusterLambo']) {
      const markup = renderWidget(id, snapshot)
      expect(markup, id).toContain('data-rpm-pct="0.5000"')
      expect(markup, id).toContain('dur="0.14s"')
    }
  })
})
