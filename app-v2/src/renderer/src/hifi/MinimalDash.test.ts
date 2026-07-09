import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import { baseSnapshot } from '../../../shared/telemetry-scenarios'
import { MinimalDash } from './MinimalDash'

function expectSafeMarkup(snapshot: TelemetrySnapshot): void {
  const markup = renderToStaticMarkup(createElement(MinimalDash, { snapshot }))
  expect(markup.length).toBeGreaterThan(1000)
  expect(markup).not.toContain('NaN')
  expect(markup).not.toContain('undefined')
  expect(markup).not.toContain('Infinity')
}

describe('MinimalDash', () => {
  it('renders a non-empty safe SVG from the base telemetry scenario', () => {
    expectSafeMarkup(baseSnapshot())
  })

  it('renders a non-empty safe SVG with NaN numeric fields and absent optionals', () => {
    const extreme: TelemetrySnapshot = {
      sim: 'replay',
      connected: false,
      timestamp: Number.NaN,
      speedKmh: Number.NaN,
      rpm: Number.NaN,
      gear: Number.NaN,
      throttle: Number.NaN,
      brake: Number.NaN,
      clutch: Number.NaN,
      shiftIndicatorPct: Number.NaN,
      currentLapTimeSec: Number.NaN,
      deltaToBestSec: Number.NaN,
      fuelLiters: Number.NaN,
      fuelPerLap: Number.NaN,
      position: Number.NaN,
      totalCars: Number.NaN
    }

    expectSafeMarkup(extreme)
  })
})
