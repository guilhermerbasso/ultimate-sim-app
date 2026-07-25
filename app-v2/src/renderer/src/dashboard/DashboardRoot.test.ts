import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderDashboardElement, resolveDashboardCanvasRenderModel } from './DashboardRoot'
import { displayUnitLabel, resolveBinding } from './binding'
import { PREVIEW_SNAPSHOT } from './widgets/gt3-theme'
import { UnitSystemProvider } from '../lib/units'
import { SHIFT_STROBE_BLUE } from '../lib/rev-lights'
import { DEFAULT_ALERTS_CONFIG, type AlertsConfig } from '../../../shared/alerts'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import type { UnitSystem } from '../../../shared/units'
import {
  dashboardStorageValidationResult,
  type Dashboard,
  type DashboardElement,
  type DashboardElementStyle,
  type DashboardElementType
} from '../../../shared/dashboards'

// Build a builtin board element and render it exactly as production does (the
// exported renderDashboardElement reuses the real ElementSwitcher → primitives).
function el(
  type: DashboardElementType,
  style: DashboardElementStyle = {},
  binding?: string,
  w = 140,
  h = 140
): DashboardElement {
  return { id: `e-${type}`, type, x: 0, y: 0, w, h, binding, style }
}

function markup(
  type: DashboardElementType,
  style: DashboardElementStyle = {},
  binding?: string,
  snap: typeof PREVIEW_SNAPSHOT | null = PREVIEW_SNAPSHOT,
  unitSystem: UnitSystem = 'metric'
): string {
  return renderToStaticMarkup(
    createElement(
      UnitSystemProvider,
      { initialUnitSystem: unitSystem },
      renderDashboardElement({ element: el(type, style, binding), snapshot: snap })
    )
  )
}

function dashboardAlertMarkup(
  moduleId: 'alertShiftFlash' | 'alertLowFuel' | 'alert2BlueFlag',
  snapshot: TelemetrySnapshot,
  alertsConfig: AlertsConfig
): string {
  const element: DashboardElement = {
    id: `dashboard-${moduleId}`,
    type: 'overlaywidget',
    x: 0,
    y: 0,
    w: moduleId === 'alertShiftFlash' ? 1000 : 360,
    h: moduleId === 'alertShiftFlash' ? 36 : moduleId === 'alert2BlueFlag' ? 210 : 200,
    style: {},
    widgetId: `hifi:${moduleId}`,
    hifiModuleId: moduleId
  }
  return renderToStaticMarkup(
    createElement(
      UnitSystemProvider,
      { initialUnitSystem: 'metric' },
      renderDashboardElement({
        element,
        snapshot,
        preview: 'inert',
        alertsConfig
      })
    )
  )
}

describe('dashboard overlaywidget resolution', () => {
  it('resolves and renders the live RaceCon RC-01 full-frame widget', () => {
    const element: DashboardElement = {
      id: 'racecon-rc01', type: 'overlaywidget', x: 0, y: 0, w: 1024, h: 600,
      widgetId: 'raceconRc01Dash', style: { background: '#000000', borderWidth: 0, radius: 0 }
    }
    const snapshot = { ...PREVIEW_SNAPSHOT, timestamp: Date.now(), sessionUniqueId: 101 }
    const output = renderToStaticMarkup(renderDashboardElement({ element, snapshot }))
    expect(output).toContain('data-widget="raceconRc01Dash"')
    expect(output).toContain('SPEED')
    expect(output).not.toContain('Unknown widget')
  })

  it('resolves and renders the live RaceCon RC-02 full-frame widget', () => {
    const element: DashboardElement = {
      id: 'racecon-rc02', type: 'overlaywidget', x: 0, y: 0, w: 1024, h: 600,
      widgetId: 'raceconRc02Dash', style: { background: '#000000', borderWidth: 0, radius: 0 }
    }
    const snapshot = { ...PREVIEW_SNAPSHOT, timestamp: Date.now(), sessionUniqueId: 102 }
    const output = renderToStaticMarkup(renderDashboardElement({ element, snapshot }))
    expect(output).toContain('data-widget="raceconRc02Dash"')
    expect(output).toContain('DELTA')
    expect(output).not.toContain('Unknown widget')
  })

  it('resolves and renders the live RaceCon RC-04 full-frame widget', () => {
    const element: DashboardElement = {
      id: 'racecon-rc04', type: 'overlaywidget', x: 0, y: 0, w: 1024, h: 600,
      widgetId: 'raceconRc04Dash', style: { background: '#000000', borderWidth: 0, radius: 0 }
    }
    const snapshot = { ...PREVIEW_SNAPSHOT, timestamp: Date.now(), sessionUniqueId: 104 }
    const output = renderToStaticMarkup(renderDashboardElement({ element, snapshot }))
    expect(output).toContain('data-widget="raceconRc04Dash"')
    expect(output).toContain('PIT SPEED')
    expect(output).not.toContain('Unknown widget')
  })

  it('treats RC-04 as a responsive full-frame instrument at the native and app sizes', () => {
    const element: DashboardElement = {
      id: 'racecon-rc04', type: 'overlaywidget', x: 0, y: 0, w: 1024, h: 600,
      widgetId: 'raceconRc04Dash', style: { background: '#000000', borderWidth: 0, radius: 0 }
    }
    const dashboard: Dashboard = {
      id: 'racecon_rc04_dash',
      name: 'RaceCon RC-04 Box Now',
      width: 1024,
      height: 600,
      bg: '#0A0D10',
      scaleMode: 'stretch',
      elements: [element]
    }

    const native = resolveDashboardCanvasRenderModel(dashboard, { width: 800, height: 480 })
    expect(native.baseWidth).toBe(800)
    expect(native.baseHeight).toBe(480)
    expect(native.dashboard.elements[0]).toMatchObject({ x: 0, y: 0, w: 800, h: 480 })
    // The stored preset must never be mutated by the responsive render model.
    expect(dashboard.elements[0]).toMatchObject({ x: 0, y: 0, w: 1024, h: 600 })

    const app = resolveDashboardCanvasRenderModel(dashboard, { width: 1024, height: 600 })
    expect(app.baseWidth).toBe(1024)
    expect(app.dashboard.elements[0]).toMatchObject({ w: 1024, h: 600 })
  })

  it('resolves and renders the live RaceCon RC-05 full-frame widget', () => {
    const element: DashboardElement = {
      id: 'racecon-rc05', type: 'overlaywidget', x: 0, y: 0, w: 1024, h: 600,
      widgetId: 'raceconRc05Dash', style: { background: '#000000', borderWidth: 0, radius: 0 }
    }
    const snapshot = { ...PREVIEW_SNAPSHOT, timestamp: Date.now(), sessionUniqueId: 105 }
    const output = renderToStaticMarkup(renderDashboardElement({ element, snapshot }))
    expect(output).toContain('data-widget="raceconRc05Dash"')
    expect(output).toContain('DELTA')
    expect(output).not.toContain('Unknown widget')
  })

  it('treats RC-05 as a responsive full-frame instrument at the native and app sizes', () => {
    const element: DashboardElement = {
      id: 'racecon-rc05', type: 'overlaywidget', x: 0, y: 0, w: 1024, h: 600,
      widgetId: 'raceconRc05Dash', style: { background: '#000000', borderWidth: 0, radius: 0 }
    }
    const dashboard: Dashboard = {
      id: 'racecon_rc05_dash',
      name: 'RaceCon RC-05 Thermal Window',
      width: 1024,
      height: 600,
      bg: '#0D0B0A',
      scaleMode: 'stretch',
      elements: [element]
    }

    const native = resolveDashboardCanvasRenderModel(dashboard, { width: 800, height: 480 })
    expect(native.baseWidth).toBe(800)
    expect(native.baseHeight).toBe(480)
    expect(native.dashboard.elements[0]).toMatchObject({ x: 0, y: 0, w: 800, h: 480 })
    // The stored preset must never be mutated by the responsive render model.
    expect(dashboard.elements[0]).toMatchObject({ x: 0, y: 0, w: 1024, h: 600 })

    const app = resolveDashboardCanvasRenderModel(dashboard, { width: 1024, height: 600 })
    expect(app.baseWidth).toBe(1024)
    expect(app.dashboard.elements[0]).toMatchObject({ w: 1024, h: 600 })
  })

  it('treats RC-02 as a responsive full-frame instrument at the native and app sizes', () => {
    const element: DashboardElement = {
      id: 'racecon-rc02', type: 'overlaywidget', x: 0, y: 0, w: 1024, h: 600,
      widgetId: 'raceconRc02Dash', style: { background: '#000000', borderWidth: 0, radius: 0 }
    }
    const dashboard: Dashboard = {
      id: 'racecon_rc02_dash',
      name: 'RaceCon RC-02 Purple Lap',
      width: 1024,
      height: 600,
      bg: '#05070C',
      scaleMode: 'stretch',
      elements: [element]
    }

    const native = resolveDashboardCanvasRenderModel(dashboard, { width: 800, height: 480 })
    expect(native.baseWidth).toBe(800)
    expect(native.baseHeight).toBe(480)
    expect(native.dashboard).not.toBe(dashboard)
    expect(native.dashboard.elements[0]).toMatchObject({ x: 0, y: 0, w: 800, h: 480 })
    // The stored preset must never be mutated by the responsive render model.
    expect(dashboard.elements[0]).toMatchObject({ x: 0, y: 0, w: 1024, h: 600 })

    const app = resolveDashboardCanvasRenderModel(dashboard, { width: 1024, height: 600 })
    expect(app.baseWidth).toBe(1024)
    expect(app.dashboard.elements[0]).toMatchObject({ w: 1024, h: 600 })

    // Without a viewport the model must fall through to the authored size unchanged.
    expect(resolveDashboardCanvasRenderModel(dashboard).dashboard).toBe(dashboard)
  })

  it('renders an exact full-frame RC-01 model at the target CSS-pixel size without mutating the preset', () => {
    const element: DashboardElement = {
      id: 'racecon-rc01', type: 'overlaywidget', x: 0, y: 0, w: 1024, h: 600,
      widgetId: 'raceconRc01Dash', style: { background: '#000000', borderWidth: 0, radius: 0 }
    }
    const dashboard: Dashboard = {
      id: 'racecon_rc01_dash',
      name: 'RaceCon RC-01 Apex Strike',
      width: 1024,
      height: 600,
      bg: '#0C0F13',
      scaleMode: 'stretch',
      elements: [element]
    }

    const native = resolveDashboardCanvasRenderModel(dashboard, { width: 800, height: 480 })
    expect(native.baseWidth).toBe(800)
    expect(native.baseHeight).toBe(480)
    expect(native.scaleMode).toBe('stretch')
    expect(native.dashboard).not.toBe(dashboard)
    expect(native.dashboard.elements[0]).toMatchObject({ x: 0, y: 0, w: 800, h: 480 })
    expect(dashboard).toMatchObject({ width: 1024, height: 600, elements: [{ w: 1024, h: 600 }] })

    const ordinary: Dashboard = {
      ...dashboard,
      id: 'ordinary',
      elements: [{ ...element, widgetId: 'gridStackDash' }]
    }
    const fixed = resolveDashboardCanvasRenderModel(ordinary, { width: 800, height: 480 })
    expect(fixed.dashboard).toBe(ordinary)
    expect(fixed).toMatchObject({ baseWidth: 1024, baseHeight: 600, scaleMode: 'stretch' })
  })
})

describe('dashboard measurement units', () => {
  it('converts a unit-only label together with its speed value', () => {
    const out = markup('value', { label: 'KM/H', suffix: 'km/h' }, 'speedKmh', PREVIEW_SNAPSHOT, 'imperial')
    expect(out).toContain('mph')
    expect(out).not.toContain('KM/H')
  })

  it('treats the normalized oil-pressure snapshot field as canonical kPa', () => {
    const result = resolveBinding('ir:OilPressure', { ...PREVIEW_SNAPSHOT, oilPressureKpa: 500 }, 'imperial')
    expect(result.displayNumeric).toBeCloseTo(72.5189, 3)
    expect(result.unit).toBe('psi')
  })

  it('resolves a migrated legacy empty binding as deterministic unbound output', () => {
    const legacy: Dashboard = {
      id: 'legacy-render-binding',
      name: 'Legacy renderer binding',
      width: 1024,
      height: 600,
      bg: '#000',
      elements: [el('value', {}, '')]
    }
    const migrated = dashboardStorageValidationResult(legacy)
    expect(migrated.status).toBe('migrated')
    if (migrated.status !== 'migrated') throw new Error(migrated.status === 'quarantine' ? migrated.error : 'Expected migration')
    expect(migrated.dashboard.elements[0].binding).toBeUndefined()
    expect(resolveBinding(migrated.dashboard.elements[0].binding, PREVIEW_SNAPSHOT)).toEqual({ text: '' })
  })

  it('converts units embedded in dashboard labels and titles', () => {
    expect(displayUnitLabel('TYRE °C', undefined, undefined, 'imperial')).toBe('TYRE °F')
    expect(displayUnitLabel('FUEL (L)', 'fuelLitersStr', undefined, 'imperial')).toBe('FUEL (gal)')
    expect(displayUnitLabel('Fuel/lap (L)', 'fuelPerLap', undefined, 'imperial')).toBe('Fuel/lap (gal)')
    expect(displayUnitLabel('Speed (km/h)', 'speedKmh', undefined, 'imperial')).toBe('Speed (mph)')
  })
})

describe('dashboard-embedded alert policy', () => {
  it('uses configured shift rpmPct when shiftIndicatorPct is below threshold', () => {
    const alertsConfig = {
      ...DEFAULT_ALERTS_CONFIG,
      shiftPoint: {
        ...DEFAULT_ALERTS_CONFIG.shiftPoint,
        shiftIndicatorPct: 0.99,
        rpmPct: 0.9
      }
    }
    const snapshot = {
      ...PREVIEW_SNAPSHOT,
      shiftIndicatorPct: 0.5,
      rpm: 7300,
      maxRpm: 8000,
      revLights: undefined
    }

    expect(dashboardAlertMarkup('alertShiftFlash', snapshot, alertsConfig))
      .toContain(SHIFT_STROBE_BLUE)
    expect(dashboardAlertMarkup('alertShiftFlash', {
      ...snapshot,
      shiftIndicatorPct: 1,
      rpm: 8000
    }, {
      ...alertsConfig,
      shiftPoint: { ...alertsConfig.shiftPoint, enabled: false }
    })).not.toContain(SHIFT_STROBE_BLUE)
    expect(dashboardAlertMarkup('alertShiftFlash', {
      ...snapshot,
      connected: false,
      shiftIndicatorPct: 1,
      rpm: 8000
    }, alertsConfig)).not.toContain(SHIFT_STROBE_BLUE)
  })

  it('uses provider blink for the shift alert overlay', () => {
    const providerOff = {
      ...PREVIEW_SNAPSHOT,
      shiftIndicatorPct: 0.999,
      rpm: 7999,
      maxRpm: 8000,
      revLights: { pct: 0.999, blink: false }
    }
    expect(dashboardAlertMarkup('alertShiftFlash', providerOff, DEFAULT_ALERTS_CONFIG))
      .not.toContain(SHIFT_STROBE_BLUE)

    const providerOn = {
      ...PREVIEW_SNAPSHOT,
      shiftIndicatorPct: 0.2,
      rpm: 2000,
      maxRpm: 8000,
      revLights: { pct: 0.2, blink: true }
    }
    expect(dashboardAlertMarkup('alertShiftFlash', providerOn, DEFAULT_ALERTS_CONFIG))
      .toContain(SHIFT_STROBE_BLUE)
  })

  it('uses configured low-fuel lapsThreshold', () => {
    const snapshot = {
      ...PREVIEW_SNAPSHOT,
      fuelLapsRemaining: 4
    }
    const hidden = dashboardAlertMarkup('alertLowFuel', snapshot, {
      ...DEFAULT_ALERTS_CONFIG,
      lowFuel: { ...DEFAULT_ALERTS_CONFIG.lowFuel, lapsThreshold: 3 }
    })
    const visible = dashboardAlertMarkup('alertLowFuel', snapshot, {
      ...DEFAULT_ALERTS_CONFIG,
      lowFuel: { ...DEFAULT_ALERTS_CONFIG.lowFuel, lapsThreshold: 5 }
    })
    const disabled = dashboardAlertMarkup('alertLowFuel', snapshot, {
      ...DEFAULT_ALERTS_CONFIG,
      lowFuel: {
        ...DEFAULT_ALERTS_CONFIG.lowFuel,
        enabled: false,
        lapsThreshold: 5
      }
    })
    const disconnected = dashboardAlertMarkup(
      'alertLowFuel',
      { ...snapshot, connected: false },
      {
        ...DEFAULT_ALERTS_CONFIG,
        lowFuel: { ...DEFAULT_ALERTS_CONFIG.lowFuel, lapsThreshold: 5 }
      }
    )

    expect(hidden).not.toContain('LAPS')
    expect(visible).toContain('4.0')
    expect(disabled).not.toContain('LAPS')
    expect(disconnected).not.toContain('LAPS')
  })

  it('hides disconnected semantic alert widgets', () => {
    const snapshot = {
      ...PREVIEW_SNAPSHOT,
      flags: { ...PREVIEW_SNAPSHOT.flags!, blue: true }
    }
    expect(dashboardAlertMarkup(
      'alert2BlueFlag',
      snapshot,
      DEFAULT_ALERTS_CONFIG
    )).toContain('BLUE FLAG')
    expect(dashboardAlertMarkup(
      'alert2BlueFlag',
      { ...snapshot, connected: false },
      DEFAULT_ALERTS_CONFIG
    )).not.toContain('BLUE FLAG')
  })
})

// ── v2.37.0 builtin element renderers now route through the instrument set ────
// gauge → AnalogDial, shiftlights → RevLedBar (default-on). The continuous bar
// family (bar/barv/dualbar) is parity-safe: legacy CSS fill by default, modelled
// RevLedBar only when the board author opts in via style.instrument.
describe('builtin gauge element renders an AnalogDial', () => {
  it('draws the bezel arc track + anti-aliased needle', () => {
    const out = markup('gauge', {}, 'lapDistPct')
    expect(out).toContain('role="img"') // AnalogDial root svg
    expect(out).toContain('<path') // d3 arc track
    expect(out).toContain('<polygon') // needle
  })

  it('overlays the binding text in DSEG numerals', () => {
    const out = markup('gauge', {}, 'lapDistPct')
    expect(out).toContain('DSEG7Classic-Regular')
  })

  it('needle colour follows the element fill/needle style', () => {
    const out = markup('gauge', { needleColor: '#abcdef' }, 'lapDistPct')
    expect(out).toContain('#abcdef')
  })

  it('is NaN-safe and shows the em-dash with no telemetry', () => {
    const out = markup('gauge', {}, 'lapDistPct', null)
    expect(out).not.toMatch(/NaN|undefined/)
    expect(out).toContain('—')
  })
})

describe('builtin shiftlights element renders a RevLedBar', () => {
  it('draws modelled LEDs with bloom at high shift', () => {
    const out = markup('shiftlights', {}, 'shiftPct')
    expect(out).toContain('role="img"')
    expect(out).toContain('feGaussianBlur') // bloom (glow default on)
  })

  it('honours the glow=false toggle (LEDs but no bloom)', () => {
    const out = markup('shiftlights', { instrument: { glow: false } }, 'shiftPct')
    expect(out).not.toContain('feGaussianBlur')
  })

  it('is NaN-safe without telemetry', () => {
    expect(markup('shiftlights', {}, 'shiftPct', null)).not.toMatch(/NaN|undefined/)
  })

  it('uses provider blink before its configured percentage fallback', () => {
    const providerOff = {
      ...PREVIEW_SNAPSHOT,
      shiftIndicatorPct: 0.999,
      revLights: { pct: 0.999, blink: false }
    } as typeof PREVIEW_SNAPSHOT
    const providerOn = {
      ...PREVIEW_SNAPSHOT,
      shiftIndicatorPct: 0.2,
      revLights: { pct: 0.2, blink: true }
    } as typeof PREVIEW_SNAPSHOT

    expect(markup('shiftlights', {}, 'shiftPct', providerOff)).not.toContain(SHIFT_STROBE_BLUE)
    expect(markup('shiftlights', {}, 'shiftPct', providerOn)).toContain(SHIFT_STROBE_BLUE)
    expect(markup('shiftlights', {}, 'shiftPct', providerOn)).toContain('repeatCount="indefinite"')
    expect(markup('shiftlights', {}, 'shiftPct', {
      ...PREVIEW_SNAPSHOT,
      shiftIndicatorPct: 1,
      revLights: { pct: 1 }
    } as typeof PREVIEW_SNAPSHOT)).toContain(SHIFT_STROBE_BLUE)
  })
})

describe('continuous bar elements are parity-safe (legacy by default, RevLed opt-in)', () => {
  it('bar keeps the lightweight CSS fill by default (no instrument svg)', () => {
    const out = markup('bar', {}, 'lapDistPct')
    expect(out).toContain('dash-bar')
    expect(out).not.toContain('role="img"')
  })

  it('bar routes through RevLedBar when style.instrument.template === "revled"', () => {
    const out = markup('bar', { instrument: { template: 'revled' } }, 'lapDistPct')
    expect(out).toContain('role="img"')
  })

  it('bar also opts in when instrument.parts.led is present', () => {
    const out = markup('bar', { instrument: { parts: { led: { segments: 10 } } } }, 'lapDistPct')
    expect(out).toContain('role="img"')
  })

  it('barv stays legacy by default and opts into RevLedBar on request', () => {
    expect(markup('barv', {}, 'lapDistPct')).toContain('dash-barv')
    expect(markup('barv', { instrument: { template: 'revled' } }, 'lapDistPct')).toContain('role="img"')
  })

  it('dualbar stays legacy by default and opts into RevLedBar on request', () => {
    expect(markup('dualbar', {}, 'lapDistPct')).toContain('dash-dualbar')
    expect(markup('dualbar', { instrument: { template: 'revled' } }, 'lapDistPct')).toContain('role="img"')
  })
})

describe('all builtin board element types still render (parse/render parity)', () => {
  const BUILTIN_TYPES: DashboardElementType[] = [
    'text',
    'rect',
    'bar',
    'barv',
    'dualbar',
    'deltabar',
    'shiftlights',
    'gauge',
    'map',
    'radar',
    'image',
    'flag',
    'trace',
    'table',
    'standings'
  ]
  for (const type of BUILTIN_TYPES) {
    it(`renders ${type} with and without telemetry`, () => {
      expect(() => {
        renderToStaticMarkup(renderDashboardElement({ element: el(type, {}, 'lapDistPct'), snapshot: PREVIEW_SNAPSHOT }))
        renderToStaticMarkup(renderDashboardElement({ element: el(type, {}, 'lapDistPct'), snapshot: null }))
      }).not.toThrow()
    })
  }
})
