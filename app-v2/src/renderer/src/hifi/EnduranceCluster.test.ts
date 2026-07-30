import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import { baseSnapshot } from '../../../shared/telemetry-scenarios'
import { EnduranceCluster } from './EnduranceCluster'

function expectSafeMarkup(snapshot: TelemetrySnapshot): void {
  const markup = renderToStaticMarkup(createElement(EnduranceCluster, { snapshot }))
  expect(markup.length).toBeGreaterThan(1000)
  expect(markup).not.toContain('NaN')
  expect(markup).not.toContain('undefined')
  expect(markup).not.toContain('Infinity')
}

describe('EnduranceCluster', () => {
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
      clutch: Number.NaN
    }

    expectSafeMarkup(extreme)
  })
})
