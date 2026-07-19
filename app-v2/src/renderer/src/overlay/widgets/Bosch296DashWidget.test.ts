import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { SHIFT_STROBE_BLUE } from '../../lib/rev-lights'
import { Bosch296DashWidget } from './Bosch296DashWidget'

// The widget renders one fixed Bosch-DDU design and reads only telemetry, so any
// concrete registered config is a sufficient WidgetProps carrier.
const config: OverlayWidgetConfig = createDefaultOverlaysConfig().widgets.gt3Cluster

const POP = {
  sim: 'iracing', connected: true, timestamp: 1, speedKmh: 212, rpm: 7200, maxRpm: 9000,
  gear: 3, shiftIndicatorPct: 0.5, brakeBiasPct: 56.5, waterTempC: 92, oilTempC: 110,
  currentLap: 14, fuelLiters: 48.3, fuelCapacityLiters: 100, fuelPerLap: 2.74, lapsRemaining: 17,
  lastLapTimeSec: 93.214, bestLapTimeSec: 92.871, currentLapTimeSec: 40.1,
  deltaToBestSec: -0.35, deltaToSessionBestSec: 0.22, position: 4, totalCars: 20,
  sessionType: 'Race', sessionTimeRemainingSec: 3600, tcLevel: 4, absLevel: 2, engineMap: 5,
  strengthOfField: 2400, airTempC: 24, trackTempC: 31, trackWetnessPct: 0,
  tyres: { lf: { tempC: 88, pressureKpa: 165, wearPct: 4 }, rf: { tempC: 90, pressureKpa: 166, wearPct: 5 },
           lr: { tempC: 86, pressureKpa: 160, wearPct: 6 }, rr: { tempC: 87, pressureKpa: 161, wearPct: 7 } },
  brakeTempC: { lf: 420, rf: 430, lr: 380, rr: 385 },
  flags: {}, relatives: { ahead: { gapSec: 1.2 }, behind: { gapSec: 0.8 } }
} as unknown as TelemetrySnapshot

function render(snapshot: TelemetrySnapshot | null): string {
  return renderToStaticMarkup(createElement(Bosch296DashWidget, { snapshot, config }))
}

function assertClean(markup: string, ctx: string): void {
  expect(markup.length, `empty render: ${ctx}`).toBeGreaterThan(50)
  expect(markup, `NaN in ${ctx}`).not.toContain('NaN')
  expect(markup, `Infinity in ${ctx}`).not.toContain('Infinity')
  expect(markup, `undefined in ${ctx}`).not.toContain('undefined')
  expect(markup, `null literal in ${ctx}`).not.toContain('>null<')
}

describe('Bosch296DashWidget — overflow-safe SVG DDU', () => {
  it('renders a single fit-to-view SVG scene with a stable widget id', () => {
    const m = render(POP)
    assertClean(m, 'populated')
    expect(m).toContain('dr-root')
    expect(m).toContain('data-widget="bosch296Dash"')
    expect(m).toContain('<svg')
    expect(m).toContain('xMidYMid meet')
  })

  it('shows core vehicle + race telemetry via labelled cells', () => {
    const m = render(POP)
    expect(m).toContain('>3<') // gear digit
    expect(m).toContain('212') // speed
    for (const label of ['SPEED', 'WATER', 'OIL', 'FUEL', 'LAP']) {
      expect(m, `missing ${label}`).toContain(label)
    }
  })

  it('routes neutral + reverse gears to N / R', () => {
    expect(render({ ...POP, gear: 0 } as TelemetrySnapshot)).toContain('>N<')
    expect(render({ ...POP, gear: -1 } as TelemetrySnapshot)).toContain('>R<')
  })

  it('degrades every field to an em-dash when disconnected', () => {
    const m = render(null)
    assertClean(m, 'null')
    expect(m).toContain('—')
    expect(m).toContain('data-widget="bosch296Dash"')
  })

  it('keeps the x1000 RPM bar calibrated while provider blink controls only its strobe', () => {
    const providerOff = render({
      ...POP,
      rpm: 4500,
      maxRpm: 9000,
      shiftIndicatorPct: 0.999,
      revLights: { pct: 0.999, blink: false }
    } as TelemetrySnapshot)
    const providerOn = render({
      ...POP,
      rpm: 4500,
      maxRpm: 9000,
      shiftIndicatorPct: 0.2,
      revLights: { pct: 0.2, blink: true }
    } as TelemetrySnapshot)

    for (const markup of [providerOff, providerOn]) {
      expect(markup).toContain('data-rpm-gauge="bosch296-x1000-bar"')
      expect(markup).toContain('data-rpm-pct="0.5000"')
    }
    expect(providerOff).toContain('data-rev-shift="normal"')
    expect(providerOff).not.toContain('dur="0.14s"')
    expect(providerOn).toContain('data-rev-shift="strobe"')
    expect(providerOn).toContain(SHIFT_STROBE_BLUE)
    expect(providerOn).toContain('dur="0.14s"')
  })
})
