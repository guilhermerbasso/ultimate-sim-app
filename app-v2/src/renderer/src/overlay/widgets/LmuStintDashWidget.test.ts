import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { LmuStintDashWidget } from './LmuStintDashWidget'

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

function render(snapshot: TelemetrySnapshot | null, cfg: OverlayWidgetConfig = config): string {
  return renderToStaticMarkup(createElement(LmuStintDashWidget, { snapshot, config: cfg }))
}

function assertClean(markup: string, ctx: string): void {
  expect(markup.length, 'empty render: ' + ctx).toBeGreaterThan(50)
  expect(markup, 'NaN in ' + ctx).not.toContain('NaN')
  expect(markup, 'Infinity in ' + ctx).not.toContain('Infinity')
  expect(markup, 'undefined in ' + ctx).not.toContain('undefined')
  expect(markup, 'null literal in ' + ctx).not.toContain('>null<')
}

describe('LmuStintDashWidget — overflow-safe SVG scene', () => {
  it('renders a single fit-to-view SVG scene with a stable widget id', () => {
    const m = render(POP)
    assertClean(m, 'populated')
    expect(m).toContain('dr-root')
    expect(m).toContain('data-widget="lmuStintDash"')
    expect(m).toContain('<svg')
    expect(m).toContain('xMidYMid meet')
  })

  it('shows core telemetry values via labelled cells', () => {
    const m = render(POP)
    expect(m).toContain('48.3')
    expect(m).toContain('P4')
    for (const label of ['SESSION', 'FUEL', 'TYRE', 'AHEAD', 'BEHIND']) {
      expect(m, 'missing ' + label).toContain(label)
    }
  })

  it('degrades every field to an em-dash when disconnected', () => {
    const m = render(null)
    assertClean(m, 'null')
    expect(m).toContain('—')
    expect(m).toContain('data-widget="lmuStintDash"')
  })
})
