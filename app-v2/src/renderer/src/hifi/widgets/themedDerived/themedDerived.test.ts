import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { THEMED_DERIVED_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/
const CARS = ['Ferrari', 'Porsche', 'Amg', 'Mclaren', 'Corvette', 'Lambo']
const BASES = ['slipAngle', 'steeringLock', 'rotationRates', 'carAttitude', 'fuelLapsLeft', 'sunPosition', 'gpsHeading', 'raceControlFlags', 'shiftPoint', 'engineTelltale', 'spotterRaw', 'sessionTag']

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

function renderWidget(widget: (typeof THEMED_DERIVED_WIDGETS)[number], snapshot: TelemetrySnapshot | null): string {
  return renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h }))
}

describe('THEMED_DERIVED_WIDGETS', () => {
  it('generates 72 widgets (12 derived × 6 cars) with unique ids', () => {
    expect(THEMED_DERIVED_WIDGETS).toHaveLength(72)
    const ids = THEMED_DERIVED_WIDGETS.map((w) => w.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has one widget per base × car with matching id and requires', () => {
    for (const base of BASES) {
      for (const car of CARS) {
        const id = `${base}${car}`
        const widget = THEMED_DERIVED_WIDGETS.find((w) => w.id === id)
        expect(widget, `missing themed widget ${id}`).toBeTruthy()
        expect(widget?.tags).toContain('themed')
        expect(widget?.tags).toContain('derived')
        expect(widget?.requires.length).toBeGreaterThan(0)
      }
    }
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

    for (const snapshot of [baseSnapshot(), null, dataSnapshot(), extreme]) {
      for (const widget of THEMED_DERIVED_WIDGETS) {
        const markup = renderWidget(widget, snapshot)
        expect(markup.length).toBeGreaterThan(80)
        expect(markup, `${widget.id} emitted unsafe token`).not.toMatch(badTokens)
      }
    }
  })
})
