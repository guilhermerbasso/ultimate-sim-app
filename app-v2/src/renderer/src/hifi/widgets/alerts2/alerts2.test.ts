import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { ALERTS2_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function dataSnapshot(): TelemetrySnapshot {
  return {
    ...baseSnapshot(),
    waterTempC: 112,
    oilTempC: 132,
    oilPressureKpa: 92,
    engineWarnings: {
      waterTemp: true,
      fuelPressure: false,
      oilPressure: true,
      oilTemp: true,
      stalled: false,
      pitLimiter: false,
      revLimiter: false,
      mandRepair: false,
      optRepair: false
    },
    trackSurfaceMaterial: 15,
    flags: { ...baseSnapshot().flags!, blue: true },
    tyres: {
      lf: { tempC: 116, surfaceTempLeftC: 118, pressureKpa: 165, wearPct: 0.8 },
      rf: { tempC: 98, pressureKpa: 168, wearPct: 0.76 },
      lr: { tempC: 86, pressureKpa: 162, wearPct: 0.84 },
      rr: { tempC: 92, pressureKpa: 166, wearPct: 0.8 }
    },
    brake: 0.72,
    brakeLinePressBar: { lf: 18, rf: 17, lr: 14, rr: 13 }
  }
}

function renderWidget(widget: (typeof ALERTS2_WIDGETS)[number], snapshot: TelemetrySnapshot | null): string {
  return renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h }))
}

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return ALERTS2_WIDGETS.map((widget) => renderWidget(widget, snapshot))
}

describe('ALERTS2_WIDGETS', () => {
  it('has unique ids', () => {
    const ids = ALERTS2_WIDGETS.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('requires the expected trigger overlay telemetry fields', () => {
    const byId = new Map(ALERTS2_WIDGETS.map((w) => [w.id, w.requires]))
    expect(byId.get('alert2EngineWarning')).toEqual(['engineWarnings'])
    expect(byId.get('alert2WaterTempCritical')).toEqual(['waterTempC', 'engineWarnings'])
    expect(byId.get('alert2OilTempCritical')).toEqual(['oilTempC', 'engineWarnings'])
    expect(byId.get('alert2OilPressureLow')).toEqual(['oilPressureKpa', 'engineWarnings'])
    expect(byId.get('alert2BadSurface')).toEqual(['trackSurfaceMaterial'])
    expect(byId.get('alert2BlueFlag')).toEqual(['flags'])
    expect(byId.get('alert2TyreTempCritical')).toEqual(['tyres'])
    expect(byId.get('alert2BrakePressureLow')).toEqual(['brake', 'brakeLinePressBar'])
  })

  it('uses existing overlay trigger kinds only', () => {
    const byId = new Map(ALERTS2_WIDGETS.map((w) => [w.id, w.defaultTrigger?.kind]))
    expect(byId.get('alert2BlueFlag')).toBe('flag')
    for (const widget of ALERTS2_WIDGETS.filter((w) => w.id !== 'alert2BlueFlag')) {
      expect(widget.defaultTrigger?.kind).toBe('always')
    }
  })

  it('renders base, null, data, and extreme invalid snapshots without unsafe tokens', () => {
    const extreme = {
      ...baseSnapshot(),
      waterTempC: Number.NaN,
      oilTempC: Number.POSITIVE_INFINITY,
      oilPressureKpa: Number.NEGATIVE_INFINITY,
      engineWarnings: undefined,
      trackSurfaceMaterial: Number.NaN,
      flags: undefined,
      tyres: {
        lf: { tempC: Number.NaN, surfaceTempLeftC: Number.POSITIVE_INFINITY },
        rf: { tempC: Number.POSITIVE_INFINITY },
        lr: { tempC: Number.NEGATIVE_INFINITY },
        rr: { tempC: Number.NaN, surfaceTempRightC: Number.NEGATIVE_INFINITY }
      },
      brake: Number.NaN,
      brakeLinePressBar: { lf: Number.NaN, rf: Number.POSITIVE_INFINITY, lr: Number.NEGATIVE_INFINITY, rr: Number.NaN }
    } as TelemetrySnapshot

    for (const markup of [...renderAll(baseSnapshot()), ...renderAll(null), ...renderAll(dataSnapshot()), ...renderAll(extreme)]) {
      expect(markup.length).toBeGreaterThan(80)
      expect(markup).not.toMatch(badTokens)
    }
  })

  it('shows expected active alert states', () => {
    const withData = renderAll(dataSnapshot()).join('\n')
    expect(withData).toContain('ENGINE')
    expect(withData).toContain('WATER')
    expect(withData).toContain('OIL TEMP')
    expect(withData).toContain('OIL PSI')
    expect(withData).toContain('SURFACE')
    expect(withData).toContain('BLUE FLAG')
    expect(withData).toContain('TYRE TEMP')
    expect(withData).toContain('BRAKE PSI')
  })
})
