import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { SHIFT_STROBE_BLUE } from '../../../lib/rev-lights'
import { CARS_REAL_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return CARS_REAL_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h })))
}

function renderWidget(id: string, snapshot: TelemetrySnapshot, width?: number, height?: number): string {
  const widget = CARS_REAL_WIDGETS.find((candidate) => candidate.id === id)
  expect(widget, `missing ${id}`).toBeTruthy()
  if (!widget) return ''
  return renderToStaticMarkup(createElement(widget.render, {
    snapshot,
    width: width ?? widget.defaultSize.w,
    height: height ?? widget.defaultSize.h
  }))
}

describe('CARS_REAL_WIDGETS', () => {
  it('exports unique car modules (Ferrari 296, Porsche Cup, Mustang GTD, ...)', () => {
    const ids = CARS_REAL_WIDGETS.map((widget) => widget.id)
    expect(ids.length).toBeGreaterThanOrEqual(66)
    expect(new Set(ids).size).toBe(ids.length)
    expect(CARS_REAL_WIDGETS.every((widget) => widget.category === 'cars')).toBe(true)
    expect(CARS_REAL_WIDGETS.every((widget) => widget.tags.includes('car') && widget.tags.includes('ir'))).toBe(true)
    for (const dashId of ['f296Dash', 'pcupDash', 'gtdDash', 'cvDash', 'lhDash', 'f488Dash']) {
      expect(ids).toContain(dashId)
    }
  })

  it('renders null and populated snapshots without unsafe tokens', () => {
    const populated: TelemetrySnapshot = {
      ...baseSnapshot(),
      sim: 'iracing',
      rpm: 8100,
      maxRpm: 8500,
      shiftIndicatorPct: 0.93,
      gear: 4,
      speedKmh: 213,
      fuelLiters: 48,
      tcLevel: 4,
      absLevel: 2,
      engineMap: 3,
      lastLapTimeSec: 112.8,
      deltaToBestSec: -0.16
    }

    for (const markup of [...renderAll(null), ...renderAll(populated)]) {
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })

  it('fits a three-digit Lamborghini fuel value without using the maximum readout size', () => {
    const markup = renderWidget('lhDash', { ...baseSnapshot(), fuelLiters: 100 } as TelemetrySnapshot)
    const value = markup.match(/<text[^>]*font-size="([^"]+)"[^>]*>100\.0<\/text>/)
    expect(value).toBeTruthy()
    expect(Number(value?.[1])).toBeLessThanOrEqual(32)
  })

  it('keeps Ferrari position self-explanatory without a redundant POS title', () => {
    const markup = renderWidget('f488Position', { ...baseSnapshot(), position: 4, totalCars: 24 } as TelemetrySnapshot)
    expect(markup).toContain('P4 / 24')
    expect(markup).not.toContain('>POS</text>')
  })

  it('uses provider blink across every car-real rev/shift renderer', () => {
    const ids = [
      'f296Dash', 'f296RevLights',
      'pcupDash', 'pcupRevBar',
      'gtdDash', 'gtdArcTach',
      'cvDash', 'cvRevLights', 'cvRpmBar',
      'lhDash', 'lhRevLights', 'lhRpm',
      'f488Dash', 'f488RevLights', 'f488RpmBar'
    ]
    const providerOff = {
      ...baseSnapshot(),
      rpm: 8400,
      maxRpm: 8500,
      shiftIndicatorPct: 0.999,
      revLights: { pct: 0.999, blink: false }
    } as TelemetrySnapshot
    const providerOn = {
      ...baseSnapshot(),
      rpm: 2000,
      maxRpm: 8500,
      shiftIndicatorPct: 0.2,
      revLights: { pct: 0.2, blink: true }
    } as TelemetrySnapshot
    const revPctOnlyOff = { ...providerOff, shiftIndicatorPct: undefined } as TelemetrySnapshot
    const revPctOnlyOn = { ...providerOn, shiftIndicatorPct: undefined } as TelemetrySnapshot

    for (const [source, normalSnapshot, shiftedSnapshot] of [
      ['shiftIndicatorPct', providerOff, providerOn],
      ['revLights.pct fallback', revPctOnlyOff, revPctOnlyOn]
    ] as const) {
      for (const id of ids) {
        const normal = renderWidget(id, normalSnapshot)
        const shifted = renderWidget(id, shiftedSnapshot)
        const label = `${id} (${source})`
        expect(normal, label).not.toContain('repeatCount="indefinite"')
        expect(shifted, label).toContain(SHIFT_STROBE_BLUE)
        expect(shifted, label).toContain('repeatCount="indefinite"')
        expect(
          (shifted.match(new RegExp(SHIFT_STROBE_BLUE, 'g')) ?? []).length,
          label
        ).toBeGreaterThan((normal.match(new RegExp(SHIFT_STROBE_BLUE, 'g')) ?? []).length)
      }
    }
  })
})
