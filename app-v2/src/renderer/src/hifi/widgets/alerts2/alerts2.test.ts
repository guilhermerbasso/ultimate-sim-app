import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_ALERTS_CONFIG, type AlertsConfig } from '../../../../../shared/alerts'
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

function renderWidget(
  widget: (typeof ALERTS2_WIDGETS)[number],
  snapshot: TelemetrySnapshot | null,
  alertsConfig?: AlertsConfig
): string {
  return renderToStaticMarkup(createElement(widget.render, {
    snapshot,
    width: widget.defaultSize.w,
    height: widget.defaultSize.h,
    alertsConfig
  }))
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

  it('uses a dedicated non-always semantic trigger for every alert', () => {
    const byId = new Map(ALERTS2_WIDGETS.map((widget) => [widget.id, widget.defaultTrigger]))
    for (const widget of ALERTS2_WIDGETS) expect(widget.defaultTrigger?.kind).toBe('semantic')
    expect(byId.get('alert2EngineWarning')?.semantic).toBe('alert2EngineWarning')
    expect(byId.get('alert2WaterTempCritical')?.semantic).toBe('alert2WaterTempCritical')
    expect(byId.get('alert2OilTempCritical')?.semantic).toBe('alert2OilTempCritical')
    expect(byId.get('alert2OilPressureLow')?.semantic).toBe('alert2OilPressureLow')
    expect(byId.get('alert2BadSurface')?.semantic).toBe('alert2BadSurface')
    expect(byId.get('alert2BlueFlag')?.semantic).toBe('alert2BlueFlag')
    expect(byId.get('alert2TyreTempCritical')?.semantic).toBe('alert2TyreTempCritical')
    expect(byId.get('alert2BrakePressureLow')?.semantic).toBe('alert2BrakePressureLow')
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
    expect(withData).toContain('OIL KPA')
    expect(withData).toContain('SURFACE')
    expect(withData).toContain('BLUE FLAG')
    expect(withData).toContain('TYRE TEMP')
    expect(withData).toContain('BRAKE BAR')
  })

  it('uses warning bits and configured tyre/brake thresholds without duplicate fallbacks', () => {
    const byId = new Map(ALERTS2_WIDGETS.map((widget) => [widget.id, widget]))
    const numericOnly = {
      ...dataSnapshot(),
      engineWarnings: undefined,
      waterTempC: 200,
      oilTempC: 200,
      oilPressureKpa: 0
    }
    expect(renderWidget(byId.get('alert2WaterTempCritical')!, numericOnly)).not.toContain('WATER')
    expect(renderWidget(byId.get('alert2OilTempCritical')!, numericOnly)).not.toContain('OIL TEMP')
    expect(renderWidget(byId.get('alert2OilPressureLow')!, numericOnly)).not.toContain('OIL KPA')

    const strict = {
      ...DEFAULT_ALERTS_CONFIG,
      tyreTemp: { ...DEFAULT_ALERTS_CONFIG.tyreTemp!, maxC: 120 },
      brakePressureLow: { brakeInputMin: 0.7, maxLinePressureBar: 10 }
    }
    expect(renderWidget(byId.get('alert2TyreTempCritical')!, dataSnapshot(), strict))
      .not.toContain('TYRE TEMP')
    expect(renderWidget(byId.get('alert2BrakePressureLow')!, dataSnapshot(), strict))
      .not.toContain('BRAKE BAR')

    const permissive = {
      ...strict,
      tyreTemp: { ...strict.tyreTemp, maxC: 117 },
      brakePressureLow: { brakeInputMin: 0.7, maxLinePressureBar: 20 }
    }
    expect(renderWidget(byId.get('alert2TyreTempCritical')!, dataSnapshot(), permissive))
      .toContain('TYRE TEMP')
    expect(renderWidget(byId.get('alert2BrakePressureLow')!, dataSnapshot(), permissive))
      .toContain('BRAKE BAR')
  })
})
