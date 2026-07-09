import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../shared/telemetry-scenarios'
import { EngineerDash } from './EngineerDash'
import type { TelemetrySnapshot } from '../../../shared/telemetry'

function expectClean(markup: string): void {
  expect(markup.length).toBeGreaterThan(1000)
  expect(markup).not.toContain('NaN')
  expect(markup).not.toContain('undefined')
  expect(markup).not.toContain('Infinity')
}

function makeHistory(): TelemetrySnapshot[] {
  return Array.from({ length: 64 }, (_, i) => {
    const s = baseSnapshot()
    const t = i / 63
    const wave = 0.5 + 0.5 * Math.sin(t * Math.PI * 4)
    s.speedKmh = 80 + wave * 180
    s.throttle = wave
    s.brake = Math.max(0, Math.sin(t * Math.PI * 8 - 1)) ** 4
    s.rpm = 2800 + wave * 4700
    s.gear = Math.round(2 + wave * 4)
    s.latAccelG = Math.sin(t * Math.PI * 8) * 1.1
    s.longAccelG = s.brake > 0.1 ? -1.4 * s.brake : s.throttle * 0.55
    return s
  })
}

describe('EngineerDash', () => {
  it('renders a clean SVG without history', () => {
    expectClean(renderToStaticMarkup(createElement(EngineerDash, { snapshot: baseSnapshot() })))
  })

  it('renders a clean SVG with extreme values and history', () => {
    const extreme = {
      ...baseSnapshot(),
      speedKmh: Number.NaN,
      rpm: Number.NaN,
      gear: Number.NaN,
      throttle: Number.NaN,
      brake: Number.NaN,
      latAccelG: Number.NaN,
      longAccelG: Number.NaN,
      currentLap: Number.NaN,
      lastLapTimeSec: Number.NaN,
      bestLapTimeSec: Number.NaN,
      deltaToBestSec: Number.NaN,
      tyres: {
        lf: { tempC: Number.NaN },
        rf: { tempC: Number.NaN },
        lr: { tempC: Number.NaN },
        rr: { tempC: Number.NaN }
      }
    } as TelemetrySnapshot

    expectClean(renderToStaticMarkup(createElement(EngineerDash, { snapshot: extreme, history: makeHistory() })))
  })
})
