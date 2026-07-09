import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig, OVERLAY_WIDGETS } from '../../../../shared/overlays'
import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import type { EngineWarnings, TelemetrySnapshot } from '../../../../shared/telemetry'
import { DASH } from './dashboard-tiles'
import { EngineTellTalesWidget } from './EngineTellTalesWidget'

// EngineTellTalesWidget — FIA-style engine warning lamp grid driven by the decoded
// iRacing EngineWarnings bitfield. Rendered to static markup (no JSX, per the suite
// convention) across null, an all-clear sheet, every individual warning bit and an
// all-on extreme. Asserts the guards hold (missing field → dim "—", never NaN /
// undefined), that each lit lamp paints its severity colour, and that the registry
// glyphs render.

const config: OverlayWidgetConfig = createDefaultOverlaysConfig().widgets.engineTellTales

function render(snapshot: TelemetrySnapshot | null): string {
  return renderToStaticMarkup(createElement(EngineTellTalesWidget, { snapshot, config }))
}

function assertClean(markup: string, ctx: string): void {
  expect(markup.length, `empty render: ${ctx}`).toBeGreaterThan(100)
  expect(markup, `NaN in ${ctx}`).not.toContain('NaN')
  expect(markup, `undefined in ${ctx}`).not.toContain('undefined')
  expect(markup, `Infinity in ${ctx}`).not.toContain('Infinity')
}

const ALL_FALSE: EngineWarnings = {
  waterTemp: false,
  fuelPressure: false,
  oilPressure: false,
  oilTemp: false,
  stalled: false,
  pitLimiter: false,
  revLimiter: false,
  mandRepair: false,
  optRepair: false
}

function withWarning(key: keyof EngineWarnings): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1,
    engineWarnings: { ...ALL_FALSE, [key]: true }
  } as unknown as TelemetrySnapshot
}

const clear = {
  sim: 'iracing',
  connected: true,
  timestamp: 1,
  engineWarnings: { ...ALL_FALSE }
} as unknown as TelemetrySnapshot

const allOn = {
  sim: 'iracing',
  connected: true,
  timestamp: 1,
  engineWarnings: {
    waterTemp: true,
    fuelPressure: true,
    oilPressure: true,
    oilTemp: true,
    stalled: true,
    pitLimiter: true,
    revLimiter: true,
    mandRepair: true,
    optRepair: true
  }
} as unknown as TelemetrySnapshot

const WARNING_KEYS: (keyof EngineWarnings)[] = [
  'waterTemp', 'fuelPressure', 'oilPressure', 'oilTemp', 'stalled',
  'pitLimiter', 'revLimiter', 'mandRepair', 'optRepair'
]

// Bits that burn red (hard faults) vs amber (advisory) — mirrors the widget's table.
const RED_KEYS: (keyof EngineWarnings)[] = ['oilPressure', 'waterTemp', 'oilTemp', 'fuelPressure', 'stalled', 'mandRepair']
const AMBER_KEYS: (keyof EngineWarnings)[] = ['revLimiter', 'pitLimiter', 'optRepair']

describe('EngineTellTalesWidget', () => {
  it('renders null / clear / each-bit / all-on NaN-undefined-Infinity-free', () => {
    const cases: Array<[string, TelemetrySnapshot | null]> = [
      ['null', null],
      ['clear', clear],
      ['all-on', allOn],
      ...WARNING_KEYS.map((k) => [`bit-${k}`, withWarning(k)] as [string, TelemetrySnapshot])
    ]
    for (const [label, snap] of cases) {
      let out = ''
      expect(() => { out = render(snap) }, `${label} render`).not.toThrow()
      assertClean(out, label)
    }
  })

  it('degrades a null snapshot to dim labelled registry glyphs', () => {
    const out = render(null)
    expect(out).toContain('OIL P')
    expect(out).toContain('PIT')
    expect(out).toContain('<svg')
  })

  it('routes warning lamps and status through instrument primitives', () => {
    const out = render(withWarning('oilPressure'))
    expect(out).toContain('aria-label="OIL P"')
    expect(out).toContain('aria-pressed="true"')
  })

  it('keeps all-clear lamps neutral chrome (not decorative green)', () => {
    const out = render(clear)
    expect(out, 'clear sheet is dimmed neutral chrome, not decorative green').toContain('rgba(150,162,178,0.42)')
    expect(out, 'no decorative green on the all-clear panel').not.toContain(DASH.green)
  })

  it('lights a red lamp colour for each hard-fault bit', () => {
    for (const key of RED_KEYS) {
      const out = render(withWarning(key))
      expect(out, `${key} should paint red`).toContain(DASH.red)
    }
  })

  it('lights an amber lamp colour for each advisory bit', () => {
    for (const key of AMBER_KEYS) {
      const out = render(withWarning(key))
      expect(out, `${key} should paint amber`).toContain(DASH.amber)
    }
  })

  it('counts active warnings and flags red as worst when any hard fault is set', () => {
    const out = render(allOn)
    expect(out).toContain('REPAIR')
    expect(out).toContain(DASH.red)
  })

  it('is registered per-yes with requires=[engineWarnings] (iRacing-tagged)', () => {
    const def = OVERLAY_WIDGETS.find((w) => w.id === 'engineTellTales')
    expect(def, 'engineTellTales not registered in OVERLAY_WIDGETS').toBeTruthy()
    expect(def?.requires).toEqual(['engineWarnings'])
  })
})
