import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig, OVERLAY_WIDGETS } from '../../../../shared/overlays'
import type { OverlayWidgetId } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import {
  energyTone,
  hasAnyPressure,
  hasBop,
  kpaToPsi,
  pitHeadline,
  pitServiceInfo,
  pressureCorners,
  pushToPassState,
  surfaceTone,
  timeOfDayInfo
} from './raceControl'
import { WIDGET_COMPONENTS } from './index'
import { UnitSystemProvider } from '../../lib/units'
import type { UnitSystem } from '../../../../shared/units'

// The 20 overlays added by the R16 batch, grouped by intended visual style.
const FUTURISTIC_IDS: OverlayWidgetId[] = [
  'ersBattery',
  'ersFlow',
  'pushToPassHud',
  'pitStatusHud',
  'coldPressureGrid',
  'trackClock',
  'wetRadar',
  'surfaceScope',
  'neonGearBar',
  'apexRadar'
]
const MINIMALIST_IDS: OverlayWidgetId[] = [
  'ersBar',
  'pushToPassPips',
  'pitTicket',
  'coldPressureCard',
  'sessionClock',
  'wetTag',
  'surfaceTag',
  'bopBadge',
  'deltaBar',
  'lapReadout'
]
const NEW_IDS: OverlayWidgetId[] = [...FUTURISTIC_IDS, ...MINIMALIST_IDS]

const defaults = createDefaultOverlaysConfig()

// A representative snapshot exercising every new telemetry field at once.
const fullSnapshot = {
  sim: 'iracing',
  connected: true,
  timestamp: 1,
  speedKmh: 214,
  rpm: 8200,
  maxRpm: 9000,
  gear: 4,
  shiftIndicatorPct: 0.88,
  throttle: 0.9,
  brake: 0,
  clutch: 0,
  ersBatteryPct: 0.82,
  pushToPass: false,
  pushToPassCount: 4,
  weatherDeclaredWet: true,
  trackWetnessPct: 0.45,
  isRaining: true,
  trackSurfaceMaterial: 16,
  weightPenaltyKg: 25,
  powerAdjustPct: -3,
  sessionTimeOfDay: 14 * 3600 + 1800,
  tireColdPressuresKpa: { lf: 165, rf: 168, lr: 158, rr: 159 },
  pit: { repairNeeded: false, optRepairNeeded: false, pitsOpen: true, inPitStall: false, svStatus: 0 },
  deltaToBestSec: -0.25,
  lastLapTimeSec: 91.234,
  bestLapTimeSec: 90.984,
  radarCars: [
    { carIdx: 2, relativeX: -2.1, relativeY: 1.5, classColor: '#49C5B1' },
    { carIdx: 3, relativeX: 7.5, relativeY: -10, classColor: '#ff6a00' }
  ]
} as unknown as TelemetrySnapshot

// Everything optional left undefined — the new-telemetry fields are all missing.
const emptySnapshot = { sim: 'iracing', connected: false, timestamp: 0 } as unknown as TelemetrySnapshot

function renderId(id: OverlayWidgetId, snapshot: TelemetrySnapshot | null, unitSystem: UnitSystem = 'metric'): string {
  const Component = WIDGET_COMPONENTS[id]
  const config = defaults.widgets[id]
  return renderToStaticMarkup(
    createElement(UnitSystemProvider, { initialUnitSystem: unitSystem }, createElement(Component, { snapshot, config }))
  )
}

function assertClean(markup: string, ctx: string): void {
  expect(markup.length, `empty render: ${ctx}`).toBeGreaterThan(10)
  expect(markup, `NaN in ${ctx}`).not.toContain('NaN')
  expect(markup, `Infinity in ${ctx}`).not.toContain('Infinity')
  expect(markup, `undefined in ${ctx}`).not.toContain('undefined')
}

describe('R16 overlays registration', () => {
  it('registers all 20 new overlays in the widget component map', () => {
    for (const id of NEW_IDS) {
      expect(typeof WIDGET_COMPONENTS[id], `dispatcher missing ${id}`).toBe('function')
    }
  })

  it('lists each new overlay in OVERLAY_WIDGETS metadata with a title + default size', () => {
    for (const id of NEW_IDS) {
      const def = OVERLAY_WIDGETS.find((widget) => widget.id === id)
      expect(def, `registry missing ${id}`).toBeTruthy()
      expect(def?.title.length ?? 0, `title for ${id}`).toBeGreaterThan(0)
      expect(def?.description.length ?? 0, `description for ${id}`).toBeGreaterThan(0)
      expect(def?.defaultPosition.width ?? 0, `width for ${id}`).toBeGreaterThan(0)
      expect(def?.defaultPosition.height ?? 0, `height for ${id}`).toBeGreaterThan(0)
    }
  })

  it('default overlays config carries every new overlay disabled by default', () => {
    for (const id of NEW_IDS) {
      expect(defaults.widgets[id]?.id, `config id for ${id}`).toBe(id)
      expect(defaults.widgets[id]?.enabled, `default enabled for ${id}`).toBe(false)
    }
  })
})

describe('R16 overlays render without throwing', () => {
  for (const id of NEW_IDS) {
    it(`${id} renders for full, empty and null snapshots`, () => {
      let full = ''
      let empty = ''
      let none = ''
      expect(() => { full = renderId(id, fullSnapshot) }, `${id} full`).not.toThrow()
      expect(() => { empty = renderId(id, emptySnapshot) }, `${id} empty`).not.toThrow()
      expect(() => { none = renderId(id, null) }, `${id} null`).not.toThrow()
      assertClean(full, `${id} full`)
      assertClean(empty, `${id} empty`)
      assertClean(none, `${id} null`)
    })
  }
})

describe('R16 overlays surface the right telemetry', () => {
  it('ERS overlays show the battery percentage and degrade to a no-ERS label', () => {
    expect(renderId('ersBattery', fullSnapshot)).toContain('82')
    expect(renderId('ersBattery', emptySnapshot)).toContain('NO ERS')
    expect(renderId('ersBar', fullSnapshot)).toContain('82')
  })

  it('Push-to-Pass overlays show the remaining count and ready/active state', () => {
    const hud = renderId('pushToPassHud', fullSnapshot)
    expect(hud).toContain('P2P')
    expect(hud).toContain('READY')
    expect(hud).toContain('4')
    const active = renderId('pushToPassHud', { ...fullSnapshot, pushToPass: true } as TelemetrySnapshot)
    expect(active).toContain('BOOST')
  })

  it('Wet overlays escalate to a declared-wet alert', () => {
    expect(renderId('wetRadar', fullSnapshot)).toContain('WET DECLARED')
    expect(renderId('wetTag', fullSnapshot)).toContain('WET')
    // A genuinely dry (connected, not-raining) track reads DRY; a disconnected/no-data
    // snapshot correctly reads "—" (unknown) rather than falsely claiming DRY.
    const drySnapshot = {
      ...fullSnapshot,
      weatherDeclaredWet: false,
      isRaining: false,
      trackWetnessPct: 0
    } as unknown as TelemetrySnapshot
    expect(renderId('wetTag', drySnapshot)).toContain('DRY')
  })

  it('Surface overlays label the current material and flag off-track', () => {
    expect(renderId('surfaceScope', fullSnapshot)).toContain('GRASS')
    expect(renderId('surfaceTag', fullSnapshot)).toContain('GRASS')
    expect(renderId('surfaceScope', emptySnapshot)).toContain('SURF')
  })

  it('Pit overlays show pits-open as the good state', () => {
    expect(renderId('pitStatusHud', fullSnapshot)).toContain('pits open')
    expect(renderId('pitTicket', fullSnapshot)).toContain('pits open')
    const repair = renderId('pitStatusHud', {
      ...fullSnapshot,
      pit: { repairNeeded: true, optRepairNeeded: false, pitsOpen: false, inPitStall: false }
    } as TelemetrySnapshot)
    expect(repair).toContain('repair required')
  })

  it('BoP badge shows ballast and power penalties', () => {
    const badge = renderId('bopBadge', fullSnapshot)
    expect(badge).toContain('+25')
    expect(badge).toContain('-3')
  })

  it('Cold pressure overlays convert kPa to psi', () => {
    expect(renderId('coldPressureCard', fullSnapshot, 'imperial')).toContain('23.9')
    expect(renderId('coldPressureGrid', fullSnapshot, 'imperial')).toContain('23.9')
  })

  it('Session clocks render the time of day', () => {
    expect(renderId('sessionClock', fullSnapshot)).toContain('14:30')
    expect(renderId('trackClock', fullSnapshot)).toContain('14:30')
  })

  it('Lap + delta readouts show a faster (negative) delta', () => {
    expect(renderId('deltaBar', fullSnapshot)).toContain('-0.250')
    expect(renderId('lapReadout', fullSnapshot)).toContain('-0.250')
  })
})

describe('raceControl helpers', () => {
  it('energyTone maps charge to good/low and null for missing ERS', () => {
    expect(energyTone(0.9)).toBe('good')
    expect(energyTone(0.2)).toBe('low')
    expect(energyTone(0)).toBe('empty')
    expect(energyTone(undefined)).toBeNull()
  })

  it('pushToPassState distinguishes none / ready / active / depleted', () => {
    expect(pushToPassState(undefined, undefined)).toBe('none')
    expect(pushToPassState(false, 3)).toBe('ready')
    expect(pushToPassState(true, 3)).toBe('active')
    expect(pushToPassState(false, 0)).toBe('depleted')
  })

  it('pit helpers prioritise mandatory repair and mark pits open as good', () => {
    expect(pitServiceInfo(2).tone).toBe('good')
    expect(pitServiceInfo(100).tone).toBe('error')
    expect(pitHeadline({ repairNeeded: true, optRepairNeeded: false, pitsOpen: true, inPitStall: false }).tone).toBe('alert')
    expect(pitHeadline({ repairNeeded: false, optRepairNeeded: false, pitsOpen: true, inPitStall: false }).tone).toBe('good')
    expect(pitHeadline(undefined).tone).toBe('idle')
  })

  it('surfaceTone treats asphalt as on-track and grass as off', () => {
    expect(surfaceTone('asphalt')).toBe('track')
    expect(surfaceTone('kerb')).toBe('kerb')
    expect(surfaceTone('grass')).toBe('off')
    expect(surfaceTone(undefined)).toBe('track')
  })

  it('pressure helpers convert units and flag outliers', () => {
    expect(kpaToPsi(165)).toBeCloseTo(23.9, 1)
    expect(kpaToPsi(undefined)).toBeNull()
    expect(hasAnyPressure(undefined)).toBe(false)
    expect(hasAnyPressure({ lf: 165, rf: 168, lr: 158, rr: 159 })).toBe(true)
    const corners = pressureCorners({ lf: 165, rf: 200, lr: 165, rr: 165 })
    expect(corners.find((corner) => corner.key === 'rf')?.outlier).toBe(true)
    expect(corners.find((corner) => corner.key === 'lf')?.outlier).toBe(false)
  })

  it('timeOfDayInfo classifies day vs night and BoP detects a handicap', () => {
    expect(timeOfDayInfo(14 * 3600)?.night).toBe(false)
    expect(timeOfDayInfo(23 * 3600)?.night).toBe(true)
    expect(timeOfDayInfo(undefined)).toBeNull()
    expect(hasBop(25, 0)).toBe(true)
    expect(hasBop(0, 0)).toBe(false)
  })
})
