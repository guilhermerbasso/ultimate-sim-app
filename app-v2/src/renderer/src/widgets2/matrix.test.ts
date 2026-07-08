import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import { ALL_WIDGET_SPECS, WIDGET_COUNT, formsForVariable } from './matrix'
import { WIDGET_FORMS } from './forms'
import { WIDGET_VARIABLES } from './variables'
import { MatrixWidget } from './MatrixWidget'

// A deliberately hostile snapshot: required numeric channels are NaN and every
// optional channel is absent, so the render path must never leak NaN/undefined.
const extremeSnapshot = {
  sim: 'none',
  connected: false,
  timestamp: 0,
  speedKmh: Number.NaN,
  rpm: Number.POSITIVE_INFINITY,
  gear: Number.NaN,
  throttle: Number.NaN,
  brake: Number.NaN,
  clutch: Number.NaN
} as unknown as TelemetrySnapshot

function markupFor(spec: (typeof ALL_WIDGET_SPECS)[number], snapshot: TelemetrySnapshot): string {
  return renderToStaticMarkup(createElement(MatrixWidget, { spec, snapshot, width: 200, height: 120 }))
}

describe('widget-matrix factory', () => {
  it('produces at least 250 widgets (variables × forms)', () => {
    expect(WIDGET_COUNT).toBe(WIDGET_VARIABLES.length * WIDGET_FORMS.length)
    expect(WIDGET_COUNT).toBeGreaterThanOrEqual(250)
  })

  it('offers at least 5 visual forms for every telemetry variable', () => {
    expect(WIDGET_FORMS.length).toBeGreaterThanOrEqual(5)
    for (const v of WIDGET_VARIABLES) {
      expect(formsForVariable(v.id).length).toBeGreaterThanOrEqual(5)
    }
  })

  it('has unique, stable spec ids', () => {
    const ids = new Set(ALL_WIDGET_SPECS.map((s) => s.id))
    expect(ids.size).toBe(ALL_WIDGET_SPECS.length)
  })

  it('renders every widget to non-empty, NaN-safe markup (realistic snapshot)', () => {
    const snap = baseSnapshot()
    for (const spec of ALL_WIDGET_SPECS) {
      const html = markupFor(spec, snap)
      expect(html.length, spec.id).toBeGreaterThan(0)
      expect(html.includes('NaN'), spec.id).toBe(false)
      expect(html.includes('undefined'), spec.id).toBe(false)
      expect(html.includes('Infinity'), spec.id).toBe(false)
    }
  })

  it('renders every widget safely for an extreme/empty snapshot', () => {
    for (const spec of ALL_WIDGET_SPECS) {
      const html = markupFor(spec, extremeSnapshot)
      expect(html.length, spec.id).toBeGreaterThan(0)
      expect(html.includes('NaN'), spec.id).toBe(false)
      expect(html.includes('undefined'), spec.id).toBe(false)
      expect(html.includes('Infinity'), spec.id).toBe(false)
    }
  })
})
