import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayStylePresetId, OverlayWidgetId } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { RevCometWidget, GearRingWidget, FlagIconStackWidget } from './FuturisticOverlayWidgets'
import { WIDGET_COMPONENTS } from './index'
import { DASH } from './dashboard-tiles'

const defaults = createDefaultOverlaysConfig()
const FAMILIES: OverlayStylePresetId[] = ['minimal', 'neon', 'glass', 'broadcast', 'terminal', 'bauhaus', 'analog', 'heatmap']
const FUTURE_IDS: OverlayWidgetId[] = [
  'revComet', 'sideRadarGlyph', 'orbitRadar', 'relativeBeacons', 'relativeLadder',
  'deltaNeedle', 'deltaRibbon', 'gearRing', 'speedGlyph', 'fuelOrb', 'fuelPips', 'inputsVector',
  'inputsScope', 'tyreHaloGrid', 'brakeHeatTiles', 'trackRibbonFuture', 'trackSectorPulse',
  'weatherGripGlyph', 'flagIconStack'
]
const NUMERIC_IDS = new Set<OverlayWidgetId>(['gearRing', 'speedGlyph', 'fuelOrb', 'fuelPips', 'trackSectorPulse', 'weatherGripGlyph'])

function sample(): TelemetrySnapshot {
  return {
    sim: 'iracing', connected: true, timestamp: 1, gear: 4, speedKmh: 187, rpm: 7200, maxRpm: 9000,
    shiftIndicatorPct: 0.72, fuelLiters: 18.4, fuelCapacityLiters: 80, fuelPerLap: 2.7,
    deltaToBestSec: -0.123, throttle: 0.82, brake: 0.13, clutch: 0, steerAngleDeg: -14,
    lapDistPct: 0.42, trackWetnessPct: 0.2, gripPct: 0.93, flags: { blue: true }, pitLimiter: true,
    tyres: { lf: { tempC: 82, wearPct: 0.91 }, rf: { tempC: 84, wearPct: 0.9 }, lr: { tempC: 79, wearPct: 0.94 }, rr: { tempC: 81, wearPct: 0.93 } },
    brakeTempC: { lf: 320, rf: 315, lr: 280, rr: 278 },
    radarCars: [{ carIdx: 2, relativeX: 3, relativeY: 2, classColor: '#ffb000' }],
    drivers: [{ carIdx: 1, isPlayer: true, lapDistPct: 0.42 }, { carIdx: 2, lapDistPct: 0.46, classColor: '#ffb000' }],
    relatives: { ahead: { carIdx: 2, gapSec: 1.2, classColor: '#ffb000' }, behind: { carIdx: 3, gapSec: -1.8, classColor: '#ff6a00' } }
  } as unknown as TelemetrySnapshot
}

function extreme(): TelemetrySnapshot {
  return { ...sample(), gear: Number.NaN, speedKmh: Number.POSITIVE_INFINITY, rpm: Number.NaN, maxRpm: 0, fuelLiters: Number.NaN, fuelPerLap: Number.POSITIVE_INFINITY, deltaToBestSec: Number.NaN, tyres: { lf: { tempC: Number.NaN, wearPct: Number.NaN } }, brakeTempC: { lf: Number.POSITIVE_INFINITY } } as unknown as TelemetrySnapshot
}

function renderId(id: OverlayWidgetId, snapshot: TelemetrySnapshot | null, family: OverlayStylePresetId): string {
  return renderToStaticMarkup(createElement(WIDGET_COMPONENTS[id], { snapshot, config: { ...defaults.widgets[id], stylePreset: family } }))
}

function expectClean(markup: string): void {
  expect(markup).not.toContain('NaN')
  expect(markup).not.toContain('undefined')
  expect(markup).not.toContain('Infinity')
}

describe('Futuristic overlay widgets instrument conversion', () => {
  it('keeps key exports wired into WIDGET_COMPONENTS', () => {
    expect(WIDGET_COMPONENTS.revComet).toBe(RevCometWidget)
    expect(WIDGET_COMPONENTS.gearRing).toBe(GearRingWidget)
    expect(WIDGET_COMPONENTS.flagIconStack).toBe(FlagIconStackWidget)
  })

  it('renders every futuristic widget across style families without invalid numerics', () => {
    const normalSnap = sample()
    const extremeSnap = extreme()
    for (const id of FUTURE_IDS) for (const family of FAMILIES) for (const snap of [null, normalSnap, extremeSnap]) {
      const markup = renderId(id, snap, family)
      expect(markup.length, `${id}/${family}`).toBeGreaterThan(10)
      expectClean(markup)
      if (NUMERIC_IDS.has(id) && snap !== null && snap !== extremeSnap) expect(markup, `${id}/${family} DSEG`).toContain('DSEG7Classic')
    }
  })

  it('uses instrument tiles/readouts and telltale alarm glyphs for focal visuals', () => {
    expect(renderId('fuelPips', sample(), 'minimal')).toContain('aria-label="FUEL LAPS')
    expect(renderId('speedGlyph', sample(), 'analog')).toContain('DSEG7Classic')
    const flags = renderId('flagIconStack', sample(), 'minimal')
    expect(flags).toContain('aria-label="alarms"')
    expect(flags).toContain('d=')
    expect(flags).toContain(DASH.blue)
  })

  it('uses em dash for missing readouts', () => {
    expect(renderId('fuelPips', null, 'minimal')).toContain('—')
    expect(renderId('gearRing', null, 'minimal')).toContain('—')
  })
})
