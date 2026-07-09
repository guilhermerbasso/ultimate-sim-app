import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../shared/telemetry-scenarios'
import { BroadcastDash } from './BroadcastDash'
import type { DriverEntry, TelemetrySnapshot } from '../../../shared/telemetry'

function drivers(): DriverEntry[] {
  return [
    { carIdx: 1, position: 1, classPosition: 1, classId: 1, carNumber: '27', name: 'M. Andersson', className: 'PRO', classColor: '#6b2aa8', gapToPlayerSec: 0, lastLapTimeSec: 85.314, isPlayer: true },
    { carIdx: 2, position: 2, classPosition: 2, classId: 1, carNumber: '18', name: 'T. Bell', className: 'PRO', classColor: '#c93429', gapToPlayerSec: -1.842, lastLapTimeSec: 85.672, isPlayer: false },
    { carIdx: 3, position: 3, classPosition: 3, classId: 1, carNumber: '64', name: 'L. Martin', className: 'PRO', classColor: '#2b74bd', gapToPlayerSec: -4.317, lastLapTimeSec: 83.842, isPlayer: false }
  ]
}

function expectClean(snapshot: TelemetrySnapshot): void {
  const markup = renderToStaticMarkup(createElement(BroadcastDash, { snapshot }))
  expect(markup.length).toBeGreaterThan(1000)
  expect(markup).not.toContain('NaN')
  expect(markup).not.toContain('undefined')
  expect(markup).not.toContain('Infinity')
}

describe('BroadcastDash', () => {
  it('renders clean markup with populated broadcast standings', () => {
    expectClean({ ...baseSnapshot(), currentLapTimeSec: 84.537, lastLapTimeSec: 85.314, deltaToBestSec: -0.777, drivers: drivers() })
  })

  it('renders clean skeleton markup without drivers', () => {
    const snapshot = baseSnapshot()
    delete snapshot.drivers
    expectClean(snapshot)
  })

  it('renders clean markup for extreme telemetry values', () => {
    expectClean({
      ...baseSnapshot(),
      currentLap: Number.NaN,
      lapsRemaining: Number.NaN,
      position: Number.NaN,
      totalCars: Number.NaN,
      currentLapTimeSec: Number.NaN,
      lastLapTimeSec: Number.NaN,
      deltaToBestSec: Number.POSITIVE_INFINITY,
      drivers: [
        { carIdx: 0, position: Number.NaN, classPosition: Number.NaN, classId: 0, carNumber: '', name: '', classColor: 'bad', gapToPlayerSec: Number.NaN, lastLapTimeSec: Number.NaN, isPlayer: true }
      ]
    })
  })
})
