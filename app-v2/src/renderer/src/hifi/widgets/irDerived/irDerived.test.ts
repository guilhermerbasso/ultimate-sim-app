import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { IR_DERIVED_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function dataSnapshot(): TelemetrySnapshot {
  return {
    ...baseSnapshot(),
    velocityX: 42,
    velocityY: 3.5,
    steerAngleDeg: 120,
    steeringAngleMaxDeg: 360,
    yawRateRadSec: 0.4,
    pitchRateRadSec: -0.1,
    rollRateRadSec: 0.05,
    pitchRad: 0.03,
    rollRad: -0.02,
    yawRad: 1.2,
    fuelLiters: 40,
    fuelPerLapKg: 2.6,
    solarAltitudeRad: 0.6,
    solarAzimuthRad: 2.1,
    lat: -23.701,
    lon: -46.699,
    yawNorth: 0.8,
    sessionFlagsRaw: 0x00000004,
    shiftRpm: 7200,
    rpm: 7300,
    maxRpm: 7800,
    engineRunning: true,
    carLeftRightRaw: 5,
    sessionUniqueId: 123456
  }
}

function renderWidget(widget: (typeof IR_DERIVED_WIDGETS)[number], snapshot: TelemetrySnapshot | null): string {
  return renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h }))
}

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return IR_DERIVED_WIDGETS.map((widget) => renderWidget(widget, snapshot))
}

describe('IR_DERIVED_WIDGETS', () => {
  it('has unique ids', () => {
    const ids = IR_DERIVED_WIDGETS.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('requires the expected combined telemetry fields', () => {
    const byId = new Map(IR_DERIVED_WIDGETS.map((w) => [w.id, w.requires]))
    expect(byId.get('slipAngle')).toEqual(['velocityX', 'velocityY'])
    expect(byId.get('steeringLock')).toEqual(['steerAngleDeg', 'steeringAngleMaxDeg'])
    expect(byId.get('rotationRates')).toEqual(['yawRateRadSec', 'pitchRateRadSec', 'rollRateRadSec'])
    expect(byId.get('carAttitude')).toEqual(['pitchRad', 'rollRad', 'yawRad'])
    expect(byId.get('fuelLapsLeft')).toEqual(['fuelLiters', 'fuelPerLapKg'])
    expect(byId.get('sunPosition')).toEqual(['solarAltitudeRad', 'solarAzimuthRad'])
    expect(byId.get('gpsHeading')).toEqual(['lat', 'lon', 'yawNorth'])
    expect(byId.get('raceControlFlags')).toEqual(['sessionFlagsRaw'])
    expect(byId.get('shiftPoint')).toEqual(['shiftRpm', 'rpm', 'maxRpm'])
    expect(byId.get('engineTelltale')).toEqual(['engineRunning', 'rpm'])
    expect(byId.get('spotterRaw')).toEqual(['carLeftRightRaw'])
    expect(byId.get('sessionTag')).toEqual(['sessionUniqueId'])
  })

  it('renders base, null, data, and extreme invalid snapshots without unsafe tokens', () => {
    const extreme = {
      ...baseSnapshot(),
      velocityX: Number.NaN,
      velocityY: Number.POSITIVE_INFINITY,
      steerAngleDeg: Number.NaN,
      steeringAngleMaxDeg: 0,
      yawRateRadSec: Number.POSITIVE_INFINITY,
      pitchRateRadSec: Number.NaN,
      rollRateRadSec: Number.NEGATIVE_INFINITY,
      pitchRad: Number.NaN,
      rollRad: Number.POSITIVE_INFINITY,
      yawRad: Number.NaN,
      fuelLiters: Number.NaN,
      fuelPerLapKg: 0,
      solarAltitudeRad: Number.NaN,
      solarAzimuthRad: Number.POSITIVE_INFINITY,
      lat: Number.NaN,
      lon: Number.NEGATIVE_INFINITY,
      yawNorth: Number.NaN,
      sessionFlagsRaw: Number.NaN,
      shiftRpm: Number.NaN,
      rpm: Number.NaN,
      maxRpm: 0,
      engineRunning: undefined,
      carLeftRightRaw: Number.NaN,
      sessionUniqueId: Number.POSITIVE_INFINITY
    } as TelemetrySnapshot

    for (const markup of [...renderAll(baseSnapshot()), ...renderAll(null), ...renderAll(dataSnapshot()), ...renderAll(extreme)]) {
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })

  it('shows expected derived data states and neutral/null states', () => {
    const withData = renderAll(dataSnapshot()).join('\n')
    expect(withData).toContain('LAPS LEFT')
    expect(withData).toContain('GREEN')
    expect(withData).toContain('SHIFT')
    expect(withData).toContain('RUN')
    expect(withData).toContain('2 CARS L')
    expect(withData).toContain('#123456')

    const nullMarkup = renderAll(null).join('\n')
    expect(nullMarkup).toContain('—')
  })

  it('fits the six-digit session id inside its tag backing', () => {
    const widget = IR_DERIVED_WIDGETS.find((candidate) => candidate.id === 'sessionTag')
    expect(widget).toBeTruthy()
    if (!widget) return

    const markup = renderWidget(widget, { ...baseSnapshot(), sessionUniqueId: 990217 } as TelemetrySnapshot)
    const tag = markup.match(/<text[^>]*y="142"[^>]*font-size="([^"]+)"[^>]*>#990217<\/text>/)
    expect(tag).toBeTruthy()
    expect(Number(tag?.[1])).toBeGreaterThanOrEqual(48)
    expect(Number(tag?.[1])).toBeLessThanOrEqual(51)
  })
})
