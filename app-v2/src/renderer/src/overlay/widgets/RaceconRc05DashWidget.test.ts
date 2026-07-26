// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOverlayStyle, type OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { OVERLAY_DASHBOARD_PRESETS } from '../../../../shared/dashboards'
import { WIDGET_COMPONENTS } from './index'
import { RaceconRc05DashWidget } from './RaceconRc05DashWidget'
import { Rc01LiveTelemetryBuffer, createRc01ChannelReceipts } from './raceconRc01Core'
import {
  RC05_ARC_START_DEG,
  RC05_ARC_SWEEP_DEG,
  RC05_COLD_GRAINING_ENGAGE_MS,
  RC05_CORNERS,
  RC05_EMPHASIS_EVENT,
  RC05_OVERHEAT_ENGAGE_MS,
  RC05_OVERHEAT_HYSTERESIS_MS,
  RC05_PRESSURE_ENGAGE_MS,
  RC05_PRESSURE_SCALE_MAX_BAR,
  RC05_PRESSURE_SCALE_MIN_BAR,
  RC05_PRESSURE_WINDOW_MAX_BAR,
  RC05_PRESSURE_WINDOW_MAX_UNIT,
  RC05_PRESSURE_WINDOW_MIN_BAR,
  RC05_PRESSURE_WINDOW_MIN_UNIT,
  RC05_SPEED_DASH_MS,
  RC05_TEMP_SCALE_MAX_C,
  RC05_TEMP_SCALE_MIN_C,
  RC05_TEMP_WINDOW_MAX_C,
  RC05_TEMP_WINDOW_MAX_UNIT,
  RC05_TEMP_WINDOW_MIN_C,
  RC05_TEMP_WINDOW_MIN_UNIT,
  RC05_TREND_LAP_LIMIT,
  type Rc05AlertInput,
  type Rc05CornerId,
  Rc05TrendRecorder,
  advanceRc05Alerts,
  clearInvalidRc05Alerts,
  createRc05AlertState,
  createRc05AuxReceipts,
  createRc05DashboardModel,
  rc05AlertInputForModel,
  rc05AlertLines,
  rc05ArcPath,
  rc05CompactModeForContentBox,
  rc05DisplayGear,
  rc05EmphasisFromEvent,
  rc05LayoutForContentBox,
  rc05PhoneGeometryForContentBox,
  rc05PointerPoints,
  rc05PolarPoint,
  rc05PressureBand,
  rc05PressureUnit,
  rc05TcStep,
  rc05TempBand,
  rc05TempUnit,
  rc05TickPath,
  rc05TrendSeries,
  rc05UnitAngleDeg
} from './raceconRc05Core'

const config: OverlayWidgetConfig = {
  id: 'raceconRc05Dash',
  enabled: true,
  locked: true,
  favorite: false,
  position: { x: 0, y: 0, width: 1024, height: 600 },
  opacity: 100,
  stylePreset: 'minimal',
  style: createDefaultOverlayStyle(),
  display: null
}

/**
 * The RC-05 approved reference state (attempt-006 governed 800x480): LF 88 C / 1.93 bar,
 * RF 94 C / 1.97 bar, LR 85 C / 1.90 bar and RR 86 C with NO TPMS, delta +0.137 s, TC step 5,
 * front brakes 412 C, rear brakes 388 C and an 18 % wear estimate. Every corner is inside
 * both windows, so the reference frame is alert-silent.
 */
function snapshot(overrides: Partial<TelemetrySnapshot> = {}, timestamp = 3_112_000): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp,
    sessionUniqueId: 75,
    speedKmh: 178,
    rpm: 6_800,
    maxRpm: 8_400,
    gear: 4,
    throttle: 0.82,
    brake: 0,
    clutch: 0,
    sessionType: 'Race',
    sessionState: 'racing',
    currentLap: 14,
    deltaToBestSec: 0.137,
    bestLapTimeSec: 104.53,
    tcLevel: 5,
    tcActive: false,
    fuelLiters: 46,
    fuelPerLapLiters: 3.1,
    fuelLapsRemaining: 14.8,
    brakeTempC: { lf: 412, rf: 405, lr: 388, rr: 380 },
    tyres: {
      lf: { tempC: 88, pressureKpa: 193, wearPct: 0.18 },
      rf: { tempC: 94, pressureKpa: 197, wearPct: 0.16 },
      lr: { tempC: 85, pressureKpa: 190, wearPct: 0.12 },
      // The reference deliberately shows one corner with no TPMS at all.
      rr: { tempC: 86, wearPct: 0.14 }
    },
    ...overrides
  } as TelemetrySnapshot
}

function markup(value: TelemetrySnapshot | null, cfg = config): string {
  return renderToStaticMarkup(createElement(RaceconRc05DashWidget, { snapshot: value, config: cfg }))
}

function assertClean(value: string): void {
  expect(value).not.toContain('\uFFFD')
  expect(value).not.toContain('NaN')
  expect(value).not.toContain('undefined')
  expect(value).not.toContain('[object Object]')
}

function modelFor(
  value: TelemetrySnapshot | null,
  nowMs = 0,
  options: Parameters<typeof createRc05DashboardModel>[4] = {},
  receiptsAtMs = nowMs
): ReturnType<typeof createRc05DashboardModel> {
  const receipts = value ? createRc01ChannelReceipts(value, receiptsAtMs) : new Map()
  const aux = value ? createRc05AuxReceipts(value, receiptsAtMs) : new Map()
  return createRc05DashboardModel(value, receipts, aux, nowMs, options)
}

function corner(
  model: ReturnType<typeof createRc05DashboardModel>,
  id: Rc05CornerId
): ReturnType<typeof createRc05DashboardModel>['corners'][number] {
  return model.corners.find((entry) => entry.corner === id)!
}

function alertInput(
  overrides: Partial<Record<Rc05CornerId, Partial<Rc05AlertInput['corners'][Rc05CornerId]>>> = {},
  nowMs = 0
): Rc05AlertInput {
  const base = { tempC: null, pressureBar: null, slipHigh: null }
  return {
    nowMs,
    corners: {
      LF: { ...base, ...overrides.LF },
      RF: { ...base, ...overrides.RF },
      LR: { ...base, ...overrides.LR },
      RR: { ...base, ...overrides.RR }
    }
  }
}

describe('RC-05 registration and preset wiring', () => {
  it('registers the widget component under its canonical id', () => {
    expect(WIDGET_COMPONENTS.raceconRc05Dash).toBe(RaceconRc05DashWidget)
  })

  it('declares exactly one RC-05 full-frame preset directly after RC-04', () => {
    const ids = OVERLAY_DASHBOARD_PRESETS.map((preset) => preset.id)
    expect(ids.filter((id) => id === 'racecon_rc05_dash')).toHaveLength(1)
    expect(ids.indexOf('racecon_rc05_dash')).toBe(ids.indexOf('racecon_rc04_dash') + 1)
    const preset = OVERLAY_DASHBOARD_PRESETS.find((entry) => entry.id === 'racecon_rc05_dash')
    expect(preset?.widgetId).toBe('raceconRc05Dash')
    expect(preset?.name).toBe('RaceCon RC-05 Thermal Window')
    expect(preset?.scaleMode).toBe('stretch')
    expect(preset?.tags).toContain('racecon')
    expect(preset?.tags).toContain('tyres')
  })
})

describe('RC-05 gauge model is computed, never traced', () => {
  it('maps units 0..100 onto the declared 60..120 degC arc scale', () => {
    expect(rc05TempUnit(RC05_TEMP_SCALE_MIN_C)).toBe(0)
    expect(rc05TempUnit(RC05_TEMP_SCALE_MAX_C)).toBe(100)
    expect(rc05TempUnit(90)).toBeCloseTo(50, 6)
    // The packet's own pointer rule: (T - 60) / 0.6.
    for (const tempC of [61, 74, 88, 94, 118]) {
      expect(rc05TempUnit(tempC)).toBeCloseTo((tempC - 60) / 0.6, 6)
    }
    expect(rc05TempUnit(null)).toBeNull()
  })

  it('places the window band exactly on the configured 80 and 100 degC bounds', () => {
    // image-qa-v1 note 2: the reference drew ~32 / ~67; the product uses the configured bounds.
    expect(RC05_TEMP_WINDOW_MIN_UNIT).toBeCloseTo(33.3333, 3)
    expect(RC05_TEMP_WINDOW_MAX_UNIT).toBeCloseTo(66.6667, 3)
    expect(rc05TempUnit(RC05_TEMP_WINDOW_MIN_C)).toBe(RC05_TEMP_WINDOW_MIN_UNIT)
    expect(rc05TempUnit(RC05_TEMP_WINDOW_MAX_C)).toBe(RC05_TEMP_WINDOW_MAX_UNIT)
  })

  it('never collapses two corners that differ by a single degree', () => {
    // image-qa-v1 note 1: the reference put LF and RR on the same unit despite 2 degC apart.
    const lf = rc05TempUnit(88) as number
    const rr = rc05TempUnit(86) as number
    expect(lf).not.toBe(rr)
    expect(lf - rr).toBeCloseTo(2 / 0.6, 6)
    expect((rc05TempUnit(91) as number) - (rc05TempUnit(90) as number)).toBeCloseTo(1 / 0.6, 6)
  })

  it('sweeps 240 degrees with the gap at the bottom', () => {
    expect(RC05_ARC_SWEEP_DEG).toBe(240)
    expect(RC05_ARC_START_DEG).toBe(-120)
    expect(rc05UnitAngleDeg(0)).toBe(-120)
    expect(rc05UnitAngleDeg(50)).toBe(0)
    expect(rc05UnitAngleDeg(100)).toBe(120)
    // Unit 50 is straight up; the two ends sit symmetrically below the centre line.
    const top = rc05PolarPoint(40, 50)
    expect(top.x).toBeCloseTo(50, 6)
    expect(top.y).toBeCloseTo(10, 6)
    const start = rc05PolarPoint(40, 0)
    const end = rc05PolarPoint(40, 100)
    expect(start.y).toBeCloseTo(end.y, 6)
    expect(start.y).toBeGreaterThan(50)
    expect(start.x).toBeLessThan(50)
    expect(end.x).toBeGreaterThan(50)
  })

  it('clamps out-of-scale readings onto the arc instead of drawing off it', () => {
    expect(rc05UnitAngleDeg(-40)).toBe(-120)
    expect(rc05UnitAngleDeg(180)).toBe(120)
    const path = rc05ArcPath(40, -20, 140)
    expect(path).toContain('A 40 40 0 1 1')
  })

  it('emits a three-point pointer polygon that moves with the temperature', () => {
    const cool = rc05PointerPoints(rc05TempUnit(84) as number)
    const hot = rc05PointerPoints(rc05TempUnit(96) as number)
    expect(cool.split(' ')).toHaveLength(3)
    expect(hot.split(' ')).toHaveLength(3)
    expect(cool).not.toBe(hot)
  })

  it('draws the two window brackets as straight radial ticks at the window bounds', () => {
    const low = rc05TickPath(34, 47, RC05_TEMP_WINDOW_MIN_UNIT)
    const high = rc05TickPath(34, 47, RC05_TEMP_WINDOW_MAX_UNIT)
    expect(low.startsWith('M ')).toBe(true)
    expect(low).toContain(' L ')
    expect(low).not.toBe(high)
  })

  it('maps the inner pressure ring onto 1.60..2.20 bar with a 1.85..2.00 band', () => {
    expect(rc05PressureUnit(RC05_PRESSURE_SCALE_MIN_BAR)).toBe(0)
    expect(rc05PressureUnit(RC05_PRESSURE_SCALE_MAX_BAR)).toBe(100)
    expect(RC05_PRESSURE_WINDOW_MIN_UNIT).toBeCloseTo(41.6667, 3)
    expect(RC05_PRESSURE_WINDOW_MAX_UNIT).toBeCloseTo(66.6667, 3)
    expect(rc05PressureUnit(RC05_PRESSURE_WINDOW_MIN_BAR)).toBe(RC05_PRESSURE_WINDOW_MIN_UNIT)
    expect(rc05PressureUnit(RC05_PRESSURE_WINDOW_MAX_BAR)).toBe(RC05_PRESSURE_WINDOW_MAX_UNIT)
    expect(rc05PressureUnit(null)).toBeNull()
  })

  it('classifies the temperature and pressure bands from the configured windows', () => {
    expect(rc05TempBand(79.9)).toBe('cold')
    expect(rc05TempBand(80)).toBe('window')
    expect(rc05TempBand(100)).toBe('window')
    expect(rc05TempBand(100.1)).toBe('hot')
    expect(rc05TempBand(null)).toBe('unknown')
    expect(rc05PressureBand(1.84)).toBe('low')
    expect(rc05PressureBand(1.85)).toBe('window')
    expect(rc05PressureBand(2.0)).toBe('window')
    expect(rc05PressureBand(2.01)).toBe('high')
    expect(rc05PressureBand(null)).toBe('unknown')
  })
})

describe('RC-05 telemetry truth table', () => {
  it('renders the approved reference frame exactly as measured', () => {
    const model = modelFor(snapshot())
    expect(corner(model, 'LF').temp.value).toBe('88')
    expect(corner(model, 'LF').pressure.value).toBe('1.93')
    expect(corner(model, 'RF').temp.value).toBe('94')
    expect(corner(model, 'RF').pressure.value).toBe('1.97')
    expect(corner(model, 'LR').temp.value).toBe('85')
    expect(corner(model, 'LR').pressure.value).toBe('1.90')
    expect(corner(model, 'RR').temp.value).toBe('86')
    expect(model.delta.value).toBe('+0.137')
    expect(model.tc.value).toBe('5')
    expect(model.brakes.map((axle) => axle.value.value)).toEqual(['412', '388'])
    expect(model.wear.value).toBe('18')
    expect(model.wearAvailable).toBe(true)
  })

  it('renders every packet dash state when no channel is available at all', () => {
    const model = modelFor(null)
    for (const id of RC05_CORNERS) {
      expect(corner(model, id).temp.value).toBe('--')
      expect(corner(model, id).temp.unavailable).toBe(true)
      expect(corner(model, id).pressure.value).toBe('--')
      expect(corner(model, id).pressure.unavailable).toBe(true)
      expect(corner(model, id).tempUnit).toBeNull()
      expect(corner(model, id).pressureUnit).toBeNull()
    }
    expect(model.delta.value).toBe('--.---')
    expect(model.tc.value).toBe('--')
    expect(model.brakes.map((axle) => axle.value.value)).toEqual(['--', '--'])
    expect(model.wearAvailable).toBe(false)
    expect(model.gear.value).toBe('-')
    expect(model.speed.value).toBe('---')
    expect(model.fuelLaps.value).toBe('--')
    expect(model.slipHigh).toBeNull()
  })

  it('never mirrors a missing corner temperature from the opposite side', () => {
    const model = modelFor(
      snapshot({
        tyres: {
          lf: { tempC: 88, pressureKpa: 193, wearPct: 0.18 },
          rf: { pressureKpa: 197, wearPct: 0.16 },
          lr: { tempC: 85, pressureKpa: 190, wearPct: 0.12 },
          rr: { tempC: 86, wearPct: 0.14 }
        }
      } as Partial<TelemetrySnapshot>)
    )
    expect(corner(model, 'RF').temp.value).toBe('--')
    expect(corner(model, 'RF').temp.unavailable).toBe(true)
    expect(corner(model, 'RF').tempUnit).toBeNull()
    expect(corner(model, 'RF').tempBand).toBe('unknown')
    // Its neighbours are untouched.
    expect(corner(model, 'LF').temp.value).toBe('88')
    expect(corner(model, 'LR').temp.value).toBe('85')
  })

  it('never estimates a pressure from a temperature and leaves the ring bare without TPMS', () => {
    const model = modelFor(snapshot())
    const rr = corner(model, 'RR')
    expect(rr.temp.value).toBe('86')
    expect(rr.pressure.value).toBe('--')
    expect(rr.pressure.unavailable).toBe(true)
    expect(rr.pressureUnit).toBeNull()
    expect(rr.pressureBand).toBe('unknown')
  })

  it('refuses a delta without a stored best lap', () => {
    const model = modelFor(snapshot({ bestLapTimeSec: undefined } as Partial<TelemetrySnapshot>))
    expect(model.delta.value).toBe('--.---')
    expect(model.delta.unavailable).toBe(true)
    expect(modelFor(snapshot({ deltaToBestSec: undefined } as Partial<TelemetrySnapshot>)).delta.value).toBe('--.---')
  })

  it('signs the delta and never prints a unit suffix inside the numeral', () => {
    expect(modelFor(snapshot({ deltaToBestSec: -0.482 } as Partial<TelemetrySnapshot>)).delta.value).toBe('-0.482')
    expect(modelFor(snapshot({ deltaToBestSec: 0 } as Partial<TelemetrySnapshot>)).delta.value).toBe('+0.000')
    expect(modelFor(snapshot()).delta.value).not.toContain('S')
  })

  it('holds the last known TC step greyed and flagged when the bus goes quiet', () => {
    const model = modelFor(snapshot(), 3_000, {}, 0)
    expect(model.tc.value).toBe('5')
    expect(model.tc.stale).toBe(true)
    expect(model.tc.unavailable).toBe(false)
    expect(model.tc.tone).toBe('muted')
  })

  it('never assumes a default TC step and prints no suffix', () => {
    const model = modelFor(snapshot({ tcLevel: undefined } as Partial<TelemetrySnapshot>))
    expect(model.tc.value).toBe('--')
    expect(model.tc.unavailable).toBe(true)
    expect(rc05TcStep(undefined)).toBeNull()
    expect(rc05TcStep(2.5)).toBeNull()
    expect(rc05TcStep('map 3')).toBeNull()
    expect(rc05TcStep('4')).toBe(4)
    expect(rc05TcStep(0)).toBe(0)
  })

  it('dashes an axle brake temperature unless both of its sensors report', () => {
    const model = modelFor(
      snapshot({ brakeTempC: { lf: 412, lr: 388, rr: 380 } } as unknown as Partial<TelemetrySnapshot>)
    )
    expect(model.brakes[0].value.value).toBe('--')
    expect(model.brakes[0].value.unavailable).toBe(true)
    // The rear axle still has both of its own sensors, so it is unaffected.
    expect(model.brakes[1].value.value).toBe('388')
  })

  it('hides the wear estimate outright when the model is uncalibrated', () => {
    const model = modelFor(
      snapshot({
        tyres: {
          lf: { tempC: 88, pressureKpa: 193, wearPct: 0.18 },
          rf: { tempC: 94, pressureKpa: 197 },
          lr: { tempC: 85, pressureKpa: 190, wearPct: 0.12 },
          rr: { tempC: 86, wearPct: 0.14 }
        }
      } as Partial<TelemetrySnapshot>)
    )
    expect(model.wearAvailable).toBe(false)
    expect(model.wear.value).toBe('--')
    expect(markup(snapshot({
      tyres: {
        lf: { tempC: 88, pressureKpa: 193 },
        rf: { tempC: 94, pressureKpa: 197 },
        lr: { tempC: 85, pressureKpa: 190 },
        rr: { tempC: 86 }
      }
    } as Partial<TelemetrySnapshot>))).not.toContain('data-testid="rc05-wear"')
  })

  it('never derives the gear from RPM or speed and greys a missing channel', () => {
    expect(modelFor(snapshot({ gear: undefined } as Partial<TelemetrySnapshot>)).gear.value).toBe('-')
    expect(modelFor(snapshot({ gear: 0 } as Partial<TelemetrySnapshot>)).gear.value).toBe('N')
    expect(modelFor(snapshot({ gear: -1 } as Partial<TelemetrySnapshot>)).gear.value).toBe('R')
    expect(rc05DisplayGear(null)).toBe('-')
    expect(rc05DisplayGear(0)).toBe('N')
    expect(rc05DisplayGear(6)).toBe('6')
  })

  it('greys speed past its cadence and dashes it only past the 500 ms budget', () => {
    const fresh = modelFor(snapshot())
    expect(fresh.speed.value).toBe('178')
    expect(fresh.speed.stale).toBe(false)

    const greyed = modelFor(snapshot(), 300, {}, 0)
    expect(greyed.speed.value).toBe('178')
    expect(greyed.speed.stale).toBe(true)
    expect(greyed.speed.tone).toBe('muted')

    const dashed = modelFor(snapshot(), RC05_SPEED_DASH_MS + 50, {}, 0)
    expect(dashed.speed.value).toBe('---')
    expect(dashed.speed.unavailable).toBe(true)
  })

  it('refuses a fuel-laps projection until a burn rate has actually been measured', () => {
    expect(modelFor(snapshot()).fuelLaps.value).toBe('14.8')
    expect(
      modelFor(snapshot({ fuelPerLapLiters: undefined } as Partial<TelemetrySnapshot>)).fuelLaps.value
    ).toBe('--')
    expect(modelFor(snapshot({ fuelPerLapLiters: 0 } as Partial<TelemetrySnapshot>)).fuelLaps.value).toBe('--')
    expect(
      modelFor(snapshot({ fuelLapsRemaining: undefined } as Partial<TelemetrySnapshot>)).fuelLaps.value
    ).toBe('--')
  })

  it('degrades every channel to its dash state once its own budget has expired', () => {
    // 1.5 s past the receipts: tyre temps (200 ms), TPMS (1 s) and brakes (200 ms) all expire.
    const model = modelFor(snapshot(), 1_500, {}, 0)
    for (const id of RC05_CORNERS) {
      expect(corner(model, id).temp.value).toBe('--')
      expect(corner(model, id).temp.stale).toBe(true)
      expect(corner(model, id).pressure.value).toBe('--')
      expect(corner(model, id).tempUnit).toBeNull()
    }
    expect(model.brakes.every((axle) => axle.value.value === '--')).toBe(true)
  })

  it('disarms the cold-graining slip input when the traction-loss channel is absent', () => {
    expect(modelFor(snapshot()).slipHigh).toBe(false)
    expect(modelFor(snapshot({ tcActive: true } as Partial<TelemetrySnapshot>)).slipHigh).toBe(true)
    expect(modelFor(snapshot({ tcActive: undefined } as Partial<TelemetrySnapshot>)).slipHigh).toBeNull()
  })
})

describe('RC-05 trigger-only alerts', () => {
  const state = createRc05AlertState()

  it('starts silent for every corner', () => {
    for (const id of RC05_CORNERS) {
      expect(state[id].overheat.active).toBe(false)
      expect(state[id].pressure.active).toBe(false)
      expect(state[id].coldGraining.active).toBe(false)
    }
    expect(rc05AlertLines(modelFor(snapshot()))).toEqual([])
  })

  it('engages a corner overheat only after the 2 s debounce', () => {
    let next = advanceRc05Alerts(state, alertInput({ LF: { tempC: 106 } }, 0))
    expect(next.LF.overheat.active).toBe(false)
    next = advanceRc05Alerts(next, alertInput({ LF: { tempC: 106 } }, RC05_OVERHEAT_ENGAGE_MS - 1))
    expect(next.LF.overheat.active).toBe(false)
    next = advanceRc05Alerts(next, alertInput({ LF: { tempC: 106 } }, RC05_OVERHEAT_ENGAGE_MS))
    expect(next.LF.overheat.active).toBe(true)
    // The other three corners stay silent: a hot LF never lights RF.
    expect(next.RF.overheat.active).toBe(false)
    expect(next.LR.overheat.active).toBe(false)
    expect(next.RR.overheat.active).toBe(false)
  })

  it('restarts the overheat debounce when the corner dips back into the window', () => {
    let next = advanceRc05Alerts(state, alertInput({ RF: { tempC: 104 } }, 0))
    next = advanceRc05Alerts(next, alertInput({ RF: { tempC: 95 } }, 1_500))
    next = advanceRc05Alerts(next, alertInput({ RF: { tempC: 104 } }, 1_600))
    next = advanceRc05Alerts(next, alertInput({ RF: { tempC: 104 } }, 1_600 + RC05_OVERHEAT_ENGAGE_MS - 1))
    expect(next.RF.overheat.active).toBe(false)
    next = advanceRc05Alerts(next, alertInput({ RF: { tempC: 104 } }, 1_600 + RC05_OVERHEAT_ENGAGE_MS))
    expect(next.RF.overheat.active).toBe(true)
  })

  it('holds the overheat alert through the full 4 s hysteresis before clearing', () => {
    let next = advanceRc05Alerts(state, alertInput({ LR: { tempC: 108 } }, 0))
    next = advanceRc05Alerts(next, alertInput({ LR: { tempC: 108 } }, RC05_OVERHEAT_ENGAGE_MS))
    expect(next.LR.overheat.active).toBe(true)

    const engagedAt = RC05_OVERHEAT_ENGAGE_MS
    next = advanceRc05Alerts(next, alertInput({ LR: { tempC: 94 } }, engagedAt + 100))
    next = advanceRc05Alerts(next, alertInput({ LR: { tempC: 94 } }, engagedAt + RC05_OVERHEAT_HYSTERESIS_MS))
    expect(next.LR.overheat.active).toBe(true)
    next = advanceRc05Alerts(next, alertInput({ LR: { tempC: 94 } }, engagedAt + 100 + RC05_OVERHEAT_HYSTERESIS_MS))
    expect(next.LR.overheat.active).toBe(false)
  })

  it('restarts the hysteresis if the corner leaves the window again', () => {
    let next = advanceRc05Alerts(state, alertInput({ RR: { tempC: 110 } }, 0))
    next = advanceRc05Alerts(next, alertInput({ RR: { tempC: 110 } }, RC05_OVERHEAT_ENGAGE_MS))
    next = advanceRc05Alerts(next, alertInput({ RR: { tempC: 92 } }, 3_000))
    next = advanceRc05Alerts(next, alertInput({ RR: { tempC: 110 } }, 5_000))
    next = advanceRc05Alerts(next, alertInput({ RR: { tempC: 92 } }, 6_000))
    next = advanceRc05Alerts(next, alertInput({ RR: { tempC: 92 } }, 6_000 + RC05_OVERHEAT_HYSTERESIS_MS - 1))
    expect(next.RR.overheat.active).toBe(true)
    next = advanceRc05Alerts(next, alertInput({ RR: { tempC: 92 } }, 6_000 + RC05_OVERHEAT_HYSTERESIS_MS))
    expect(next.RR.overheat.active).toBe(false)
  })

  it('unlatches the overheat alert the moment the sensor goes missing', () => {
    let next = advanceRc05Alerts(state, alertInput({ LF: { tempC: 112 } }, 0))
    next = advanceRc05Alerts(next, alertInput({ LF: { tempC: 112 } }, RC05_OVERHEAT_ENGAGE_MS))
    expect(next.LF.overheat.active).toBe(true)
    next = advanceRc05Alerts(next, alertInput({ LF: { tempC: null } }, RC05_OVERHEAT_ENGAGE_MS + 10))
    expect(next.LF.overheat.active).toBe(false)
  })

  it('engages a pressure alert after 3 s on the offending side and clears on return', () => {
    let next = advanceRc05Alerts(state, alertInput({ LF: { pressureBar: 1.72 } }, 0))
    expect(next.LF.pressure.active).toBe(false)
    next = advanceRc05Alerts(next, alertInput({ LF: { pressureBar: 1.72 } }, RC05_PRESSURE_ENGAGE_MS - 1))
    expect(next.LF.pressure.active).toBe(false)
    next = advanceRc05Alerts(next, alertInput({ LF: { pressureBar: 1.72 } }, RC05_PRESSURE_ENGAGE_MS))
    expect(next.LF.pressure.active).toBe(true)
    expect(next.LF.pressure.side).toBe('low')
    next = advanceRc05Alerts(next, alertInput({ LF: { pressureBar: 1.93 } }, RC05_PRESSURE_ENGAGE_MS + 1))
    expect(next.LF.pressure.active).toBe(false)
    expect(next.LF.pressure.side).toBeNull()
  })

  it('restarts the pressure debounce when the offending side flips', () => {
    let next = advanceRc05Alerts(state, alertInput({ RF: { pressureBar: 1.7 } }, 0))
    next = advanceRc05Alerts(next, alertInput({ RF: { pressureBar: 2.15 } }, 2_900))
    next = advanceRc05Alerts(next, alertInput({ RF: { pressureBar: 2.15 } }, 2_900 + RC05_PRESSURE_ENGAGE_MS - 1))
    expect(next.RF.pressure.active).toBe(false)
    next = advanceRc05Alerts(next, alertInput({ RF: { pressureBar: 2.15 } }, 2_900 + RC05_PRESSURE_ENGAGE_MS))
    expect(next.RF.pressure.active).toBe(true)
    expect(next.RF.pressure.side).toBe('high')
  })

  it('never raises a pressure alert on a corner with no TPMS', () => {
    let next = state
    for (const nowMs of [0, 5_000, 10_000]) {
      next = advanceRc05Alerts(next, alertInput({ RR: { pressureBar: null } }, nowMs))
    }
    expect(next.RR.pressure.active).toBe(false)
  })

  it('engages cold graining only with a real high-slip signal and clears when temp rises', () => {
    let next = advanceRc05Alerts(state, alertInput({ LR: { tempC: 68, slipHigh: true } }, 0))
    next = advanceRc05Alerts(next, alertInput({ LR: { tempC: 68, slipHigh: true } }, RC05_COLD_GRAINING_ENGAGE_MS - 1))
    expect(next.LR.coldGraining.active).toBe(false)
    next = advanceRc05Alerts(next, alertInput({ LR: { tempC: 68, slipHigh: true } }, RC05_COLD_GRAINING_ENGAGE_MS))
    expect(next.LR.coldGraining.active).toBe(true)
    next = advanceRc05Alerts(next, alertInput({ LR: { tempC: 82, slipHigh: true } }, RC05_COLD_GRAINING_ENGAGE_MS + 1))
    expect(next.LR.coldGraining.active).toBe(false)
  })

  it('never raises cold graining from a cold tyre alone or from a missing slip channel', () => {
    let coldOnly = state
    let noSlipChannel = state
    for (const nowMs of [0, 4_000, 8_000]) {
      coldOnly = advanceRc05Alerts(coldOnly, alertInput({ LF: { tempC: 62, slipHigh: false } }, nowMs))
      noSlipChannel = advanceRc05Alerts(noSlipChannel, alertInput({ LF: { tempC: 62, slipHigh: null } }, nowMs))
    }
    expect(coldOnly.LF.coldGraining.active).toBe(false)
    expect(noSlipChannel.LF.coldGraining.active).toBe(false)
  })

  it('drops every latched alert when the model says the input is no longer usable', () => {
    let latched = advanceRc05Alerts(state, alertInput({ LF: { tempC: 112, pressureBar: 1.6, slipHigh: true } }, 0))
    latched = advanceRc05Alerts(
      latched,
      alertInput({ LF: { tempC: 112, pressureBar: 1.6, slipHigh: true } }, 6_000)
    )
    expect(latched.LF.overheat.active).toBe(true)
    expect(latched.LF.pressure.active).toBe(true)

    // A frame whose channels have all aged out must unlatch everything.
    const staleModel = modelFor(snapshot(), 4_000, { alerts: latched }, 0)
    const cleared = clearInvalidRc05Alerts(latched, staleModel)
    expect(cleared.LF.overheat.active).toBe(false)
    expect(cleared.LF.pressure.active).toBe(false)
    expect(cleared.LF.coldGraining.active).toBe(false)
  })

  it('unlatches cold graining when the slip channel itself disappears', () => {
    let latched = advanceRc05Alerts(state, alertInput({ RF: { tempC: 66, slipHigh: true } }, 0))
    latched = advanceRc05Alerts(latched, alertInput({ RF: { tempC: 66, slipHigh: true } }, RC05_COLD_GRAINING_ENGAGE_MS))
    expect(latched.RF.coldGraining.active).toBe(true)
    const model = modelFor(
      snapshot({ tcActive: undefined } as Partial<TelemetrySnapshot>),
      0,
      { alerts: latched }
    )
    expect(clearInvalidRc05Alerts(latched, model).RF.coldGraining.active).toBe(false)
  })

  it('projects the latched alerts onto the corners and the alert lines', () => {
    let latched = advanceRc05Alerts(state, alertInput({ RF: { tempC: 108, pressureBar: 2.14 } }, 0))
    latched = advanceRc05Alerts(latched, alertInput({ RF: { tempC: 108, pressureBar: 2.14 } }, 6_000))
    const model = modelFor(snapshot({ tyres: {
      lf: { tempC: 88, pressureKpa: 193, wearPct: 0.18 },
      rf: { tempC: 108, pressureKpa: 214, wearPct: 0.16 },
      lr: { tempC: 85, pressureKpa: 190, wearPct: 0.12 },
      rr: { tempC: 86, wearPct: 0.14 }
    } } as Partial<TelemetrySnapshot>), 0, { alerts: latched })
    expect(corner(model, 'RF').overheat).toBe(true)
    expect(corner(model, 'RF').zoom).toBe(true)
    expect(corner(model, 'RF').pressureAlert).toBe('high')
    expect(corner(model, 'LF').zoom).toBe(false)
    expect(rc05AlertLines(model)).toEqual(['RF OVERHEAT', 'RF PRESS HIGH'])
  })

  it('builds its alert inputs only from fresh, available channels', () => {
    const stale = rc05AlertInputForModel(modelFor(snapshot(), 4_000, {}, 0), 4_000)
    for (const id of RC05_CORNERS) {
      expect(stale.corners[id].tempC).toBeNull()
      expect(stale.corners[id].pressureBar).toBeNull()
    }
    const fresh = rc05AlertInputForModel(modelFor(snapshot()), 0)
    expect(fresh.corners.LF.tempC).toBe(88)
    expect(fresh.corners.RR.pressureBar).toBeNull()
  })
})

describe('RC-05 measured lap trend', () => {
  const temps = (lf: number | null, rf: number | null, lr: number | null, rr: number | null) => ({
    LF: lf,
    RF: rf,
    LR: lr,
    RR: rr
  })

  it('refuses to record anything before a lap boundary is actually observed', () => {
    const recorder = new Rc05TrendRecorder()
    recorder.observe(14, temps(88, 94, 85, 86))
    // A mid-lap mount only learns the lap number; it never writes a truncated fragment.
    expect(recorder.history()).toEqual([])
    recorder.observe(14, temps(89, 95, 86, 87))
    expect(recorder.history()).toEqual([])
  })

  it('records exactly one sample per observed lap boundary', () => {
    const recorder = new Rc05TrendRecorder()
    recorder.observe(14, temps(88, 94, 85, 86))
    recorder.observe(15, temps(90, 96, 87, 88))
    recorder.observe(16, temps(91, 97, 88, 89))
    expect(recorder.history().map((sample) => sample.lap)).toEqual([15, 16])
    expect(recorder.history()[0].temps.LF).toBe(90)
  })

  it('writes a null for a corner whose sensor was silent at the boundary', () => {
    const recorder = new Rc05TrendRecorder()
    recorder.observe(14, temps(88, 94, 85, 86))
    recorder.observe(15, temps(90, null, 87, 88))
    expect(recorder.history()[0].temps.RF).toBeNull()
    const series = rc05TrendSeries(recorder.history())
    expect(series.find((entry) => entry.corner === 'RF')?.measured).toBe(false)
    expect(series.find((entry) => entry.corner === 'LF')?.measured).toBe(true)
  })

  it('drops the history rather than stitching two stints together', () => {
    const recorder = new Rc05TrendRecorder()
    recorder.observe(14, temps(88, 94, 85, 86))
    recorder.observe(15, temps(90, 96, 87, 88))
    expect(recorder.history()).toHaveLength(1)
    recorder.observe(2, temps(70, 71, 72, 73))
    expect(recorder.history()).toEqual([])
  })

  it('bounds the ring at the packet lap limit', () => {
    const recorder = new Rc05TrendRecorder()
    recorder.observe(0, temps(80, 80, 80, 80))
    for (let lap = 1; lap <= RC05_TREND_LAP_LIMIT + 5; lap += 1) {
      recorder.observe(lap, temps(80 + lap, 80, 80, 80))
    }
    expect(recorder.history()).toHaveLength(RC05_TREND_LAP_LIMIT)
    expect(recorder.history()[0].lap).toBe(RC05_TREND_LAP_LIMIT + 5 - RC05_TREND_LAP_LIMIT + 1)
  })

  it('ignores a lap channel that is missing or nonsensical', () => {
    const recorder = new Rc05TrendRecorder()
    recorder.observe(null, temps(88, 94, 85, 86))
    recorder.observe(Number.NaN, temps(88, 94, 85, 86))
    recorder.observe(2.5, temps(88, 94, 85, 86))
    expect(recorder.history()).toEqual([])
  })

  it('reports an unmeasured trend as pending, never as a plausible curve', () => {
    const model = modelFor(snapshot())
    expect(model.trendMeasured).toBe(false)
    expect(model.trend.every((series) => series.measured === false)).toBe(true)
  })
})

describe('RC-05 responsive contract', () => {
  it('resolves the native, app and compact layouts from the content box', () => {
    expect(rc05LayoutForContentBox(800, 480)).toBe('native')
    expect(rc05LayoutForContentBox(801, 479)).toBe('native')
    expect(rc05LayoutForContentBox(1024, 600)).toBe('app')
    expect(rc05LayoutForContentBox(1600, 900)).toBe('app')
    expect(rc05LayoutForContentBox(640, 360)).toBe('compact')
    expect(rc05LayoutForContentBox(0, 0)).toBe('app')
  })

  it('classifies phone and landscape compact modes', () => {
    expect(rc05CompactModeForContentBox(393, 759)).toBe('phone')
    expect(rc05CompactModeForContentBox(412, 867)).toBe('phone')
    expect(rc05CompactModeForContentBox(759, 393)).toBe('landscape')
    expect(rc05CompactModeForContentBox(867, 412)).toBe('landscape')
    expect(rc05CompactModeForContentBox(700, 600)).toBe('standard')
    expect(rc05CompactModeForContentBox(1024, 600)).toBe('standard')
  })

  it('emits contained portrait geometry only at the phone breakpoint', () => {
    expect(rc05PhoneGeometryForContentBox(1024, 600)).toBeNull()
    expect(rc05PhoneGeometryForContentBox(759, 393)).toBeNull()
    for (const [width, height] of [
      [393, 759],
      [412, 867],
      [360, 780]
    ]) {
      const geometry = rc05PhoneGeometryForContentBox(width, height)!
      expect(geometry).not.toBeNull()
      // Every stacked zone must fit inside the measured box, in order, without overlap.
      expect(geometry.mandalaTop).toBeGreaterThan(0)
      expect(geometry.mandalaHeight).toBeGreaterThan(0)
      expect(geometry.deltaTop).toBeGreaterThanOrEqual(geometry.mandalaTop + geometry.mandalaHeight)
      expect(geometry.contextTop).toBeGreaterThanOrEqual(geometry.deltaTop + geometry.deltaHeight)
      expect(geometry.legendTop).toBeGreaterThanOrEqual(geometry.contextTop + geometry.contextHeight)
      expect(geometry.legendTop + geometry.legendHeight).toBeLessThanOrEqual(height)
      // The mandala stays square-capable inside the portrait width.
      expect(geometry.mandalaHeight).toBeLessThanOrEqual(Math.max(120, width - geometry.inset * 2))
      // The soft key stays a real touch target.
      expect(geometry.toggleSize).toBeGreaterThanOrEqual(44)
    }
  })

  it('accepts only the emphasis payloads it recognises', () => {
    expect(rc05EmphasisFromEvent('pressure')).toBe('pressure')
    expect(rc05EmphasisFromEvent('temperature')).toBe('temperature')
    expect(rc05EmphasisFromEvent({ emphasis: 'pressure' })).toBe('pressure')
    expect(rc05EmphasisFromEvent('rpm')).toBeNull()
    expect(rc05EmphasisFromEvent(undefined)).toBeNull()
  })
})

describe('RC-05 rendering', () => {
  it('renders the canonical DOM contract with four independent corner gauges', () => {
    const html = markup(snapshot())
    assertClean(html)
    expect(html).toContain('data-widget="raceconRc05Dash"')
    expect(html.match(/data-testid="rc05-corner"/g) ?? []).toHaveLength(4)
    expect(html.match(/data-testid="rc05-gauge"/g) ?? []).toHaveLength(4)
    expect(html.match(/data-testid="rc05-window-band"/g) ?? []).toHaveLength(4)
    // Two bracket ticks per gauge, exactly as the reference measured.
    expect(html.match(/data-testid="rc05-window-tick"/g) ?? []).toHaveLength(8)
    expect(html.match(/data-testid="rc05-pointer"/g) ?? []).toHaveLength(4)
    expect(html.match(/data-testid="rc05-pressure-ring"/g) ?? []).toHaveLength(4)
    // Three corners have TPMS in the reference frame; RR's ring stays bare.
    expect(html.match(/data-testid="rc05-pressure-mark"/g) ?? []).toHaveLength(3)
    expect(html).toContain('data-testid="rc05-delta"')
    expect(html).toContain('data-testid="rc05-aids"')
    expect(html).toContain('data-testid="rc05-legend"')
    expect(html).toContain('data-testid="rc05-wear"')
    expect(html).toContain('data-testid="rc05-trend"')
    expect(html).toContain('data-testid="rc05-peripheral"')
    for (const id of RC05_CORNERS) {
      expect(html).toContain(`data-rc05-corner="${id}"`)
    }
  })

  it('draws no shift LED strip and no rev cue at all', () => {
    const html = markup(snapshot())
    // Packet section 16 declares no RPM channel, so section 11.4's optional edge cue has no
    // data source and must not exist.
    expect(html).not.toContain('rc05-led')
    expect(html).not.toContain('rc05-rev')
    expect(html).not.toContain('data-rc05-shift')
    expect(html).not.toContain('SHIFT')
    expect(html).not.toContain('RPM')
  })

  it('keeps every alert silent in the reference frame', () => {
    const html = markup(snapshot())
    expect(html).toContain('data-rc05-alerts="silent"')
    expect(html).toContain('data-rc05-alert-corners=""')
    expect(html).not.toContain('data-testid="rc05-alert-line"')
    expect(html).toContain('data-rc05-overheat="false"')
    expect(html).not.toContain('data-rc05-overheat="true"')
    expect(html).not.toContain('data-rc05-zoom="true"')
    expect(html).not.toContain('data-rc05-pressure-alert="low"')
    expect(html).not.toContain('data-rc05-pressure-alert="high"')
  })

  it('renders every corner band and the reference readouts', () => {
    const html = markup(snapshot())
    expect(html.match(/data-rc05-band="window"/g) ?? []).toHaveLength(4)
    expect(html).toContain('>88<')
    expect(html).toContain('>1.93<')
    expect(html).toContain('>94<')
    expect(html).toContain('>+0.137<')
    expect(html).toContain('>412<')
    expect(html).toContain('>18<')
    expect(html).toContain('WEAR EST')
    // RR carries the bare dash and a bare ring.
    expect(html).toContain('data-rc05-pressure-band="unknown"')
  })

  it('renders a clean, dash-only frame with no telemetry at all', () => {
    const html = markup(null)
    assertClean(html)
    expect(html).not.toContain('data-rc05-buffer-state="accepted"')
    expect(html.match(/data-testid="rc05-corner"/g) ?? []).toHaveLength(4)
    expect(html.match(/data-testid="rc05-pointer"/g) ?? []).toHaveLength(0)
    expect(html.match(/data-testid="rc05-pressure-mark"/g) ?? []).toHaveLength(0)
    expect(html).toContain('--.---')
    expect(html).toContain('aria-label="LF tyre temperature unavailable"')
    expect(html).not.toContain('data-testid="rc05-wear"')
    expect(html).toContain('data-rc05-alerts="silent"')
  })

  it('refuses mock and replay telemetry and raises no alert from it', () => {
    for (const value of [
      snapshot({ sim: 'mock' } as Partial<TelemetrySnapshot>),
      snapshot({ replayContext: { state: 'replay' } } as unknown as Partial<TelemetrySnapshot>)
    ]) {
      const html = markup(value)
      assertClean(html)
      expect(html).not.toContain('data-rc05-buffer-state="accepted"')
      expect(html).toContain('data-rc05-alerts="silent"')
      // The refused frame must not leak its telemetry into the readouts.
      expect(html).not.toContain('>88<')
      expect(html).not.toContain('>1.93<')
      expect(html).not.toContain('>+0.137<')
    }
  })

  it('marks the native 800x480 contract only at that exact size', () => {
    const native = { ...config, position: { x: 0, y: 0, width: 800, height: 480 } }
    expect(markup(snapshot(), native)).toContain('data-rc05-native-size="800x480"')
    expect(markup(snapshot())).not.toContain('data-rc05-native-size')
  })

  it('exposes the compact mode attribute only in the compact layout', () => {
    const phone = { ...config, position: { x: 0, y: 0, width: 393, height: 759 } }
    expect(markup(snapshot(), phone)).toContain('data-rc05-compact-mode="phone"')
    expect(markup(snapshot())).not.toContain('data-rc05-compact-mode')
  })
})

describe('RC-05 shares the RC-01 fail-closed ingest buffer', () => {
  it('accepts a live identified snapshot and rejects an unidentified one', () => {
    const buffer = new Rc01LiveTelemetryBuffer()
    expect(buffer.ingest(snapshot(), 1_000).accepted).toBe(true)
    const orphan = new Rc01LiveTelemetryBuffer()
    expect(
      orphan.ingest(snapshot({ sessionUniqueId: undefined, connectionEpoch: undefined }), 1_000).accepted
    ).toBe(false)
  })
})

/**
 * The alert surfaces and the measured trend cannot be reached by a single static render:
 * both require evidence accumulated across frames, which is exactly the packet's point.
 * These drive the real component over a real frame sequence so the alert and trend markup
 * can never become dead code.
 */
describe('RC-05 live thermal surfaces', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  /**
   * Frames are pushed at a realistic 10 Hz. That matters: the tyre-temperature budget is
   * 200 ms, so a test that jumped straight to the debounce deadline would age the channel
   * out and correctly find the alert disarmed rather than engaged.
   */
  function mount(initial: Partial<TelemetrySnapshot> = {}): {
    push: (atMs: number, overrides: Partial<TelemetrySnapshot>) => void
    root: () => HTMLElement
    view: ReturnType<typeof render>
  } {
    vi.useFakeTimers()
    let monotonicMs = 0
    const monotonicClock = (): number => monotonicMs
    const view = render(
      createElement(RaceconRc05DashWidget, { snapshot: snapshot(initial, 1_000), config, monotonicClock })
    )
    const frame = (overrides: Partial<TelemetrySnapshot>): void => {
      view.rerender(
        createElement(RaceconRc05DashWidget, {
          snapshot: snapshot(overrides, 1_000 + monotonicMs),
          config,
          monotonicClock
        })
      )
    }
    const push = (atMs: number, overrides: Partial<TelemetrySnapshot>): void => {
      if (atMs <= monotonicMs) {
        frame(overrides)
        return
      }
      while (monotonicMs < atMs) {
        const step = Math.min(100, atMs - monotonicMs)
        monotonicMs += step
        act(() => {
          vi.advanceTimersByTime(step)
        })
        frame(overrides)
      }
    }
    return { push, root: () => view.container.querySelector<HTMLElement>('.rc05-widget')!, view }
  }

  const hotLf = (tempC: number): Partial<TelemetrySnapshot> =>
    ({
      tyres: {
        lf: { tempC, pressureKpa: 193, wearPct: 0.18 },
        rf: { tempC: 94, pressureKpa: 197, wearPct: 0.16 },
        lr: { tempC: 85, pressureKpa: 190, wearPct: 0.12 },
        rr: { tempC: 86, wearPct: 0.14 }
      }
    }) as Partial<TelemetrySnapshot>

  it('keeps every alert surface absent while nothing has triggered', () => {
    const { root, view } = mount()
    expect(root().dataset.rc05Alerts).toBe('silent')
    expect(view.container.querySelector('[data-testid="rc05-alert-line"]')).toBeNull()
    expect(view.container.querySelectorAll('[data-rc05-zoom="true"]')).toHaveLength(0)
  })

  it('escalates a single corner after the debounce and leaves its neighbours untouched', () => {
    const { push, root, view } = mount()
    push(500, hotLf(107))
    // The debounce runs from the FIRST hot frame at 100 ms, so it cannot have engaged yet.
    expect(root().dataset.rc05Alerts).toBe('silent')
    push(100 + RC05_OVERHEAT_ENGAGE_MS, hotLf(107))
    expect(root().dataset.rc05Alerts).toBe('active')
    expect(root().dataset.rc05AlertCorners).toBe('LF')
    const lf = view.container.querySelector<HTMLElement>('[data-rc05-corner="LF"]')!
    const rf = view.container.querySelector<HTMLElement>('[data-rc05-corner="RF"]')!
    expect(lf.dataset.rc05Overheat).toBe('true')
    expect(lf.dataset.rc05Zoom).toBe('true')
    expect(rf.dataset.rc05Overheat).toBe('false')
    expect(rf.dataset.rc05Zoom).toBe('false')
    expect(view.container.querySelector('[data-testid="rc05-alert-line"]')?.textContent).toContain('LF OVERHEAT')
  })

  it('holds the escalation through the hysteresis and clears it afterwards', () => {
    const { push, root } = mount()
    const engagedAt = 100 + RC05_OVERHEAT_ENGAGE_MS
    push(engagedAt, hotLf(107))
    expect(root().dataset.rc05Alerts).toBe('active')
    const recoveredAt = engagedAt + 100
    push(recoveredAt, hotLf(92))
    push(recoveredAt + RC05_OVERHEAT_HYSTERESIS_MS - 100, hotLf(92))
    expect(root().dataset.rc05Alerts).toBe('active')
    push(recoveredAt + RC05_OVERHEAT_HYSTERESIS_MS, hotLf(92))
    expect(root().dataset.rc05Alerts).toBe('silent')
  })

  it('unlatches the escalation and dashes the corner when its sensor drops out', () => {
    const { push, root, view } = mount()
    const engagedAt = 100 + RC05_OVERHEAT_ENGAGE_MS
    push(engagedAt, hotLf(107))
    expect(root().dataset.rc05Alerts).toBe('active')
    push(engagedAt + 100, {
      tyres: {
        lf: { pressureKpa: 193, wearPct: 0.18 },
        rf: { tempC: 94, pressureKpa: 197, wearPct: 0.16 },
        lr: { tempC: 85, pressureKpa: 190, wearPct: 0.12 },
        rr: { tempC: 86, wearPct: 0.14 }
      }
    } as Partial<TelemetrySnapshot>)
    expect(root().dataset.rc05Alerts).toBe('silent')
    const lf = view.container.querySelector<HTMLElement>('[data-rc05-corner="LF"]')!
    expect(lf.dataset.rc05Overheat).toBe('false')
    expect(lf.dataset.rc05Band).toBe('unknown')
    expect(lf.querySelector('[data-testid="rc05-pointer"]')).toBeNull()
  })

  it('records a measured trend only once real lap boundaries have been observed', () => {
    const { push, root, view } = mount()
    expect(root().dataset.rc05Trend).toBe('pending')
    push(1_000, { currentLap: 15 })
    expect(root().dataset.rc05Trend).toBe('measured')
    const rows = view.container.querySelectorAll('[data-testid="rc05-trend-row"]')
    expect(rows).toHaveLength(4)
    expect(view.container.querySelector('[data-rc05-corner="LF"][data-testid="rc05-trend-row"]')?.textContent).toContain(
      '88'
    )
  })

  it('toggles the soft-key emphasis and answers the display-switch event', () => {
    const { root, view } = mount()
    expect(root().dataset.rc05Emphasis).toBe('temperature')
    fireEvent.click(view.container.querySelector('[data-testid="rc05-soft-key"]')!)
    expect(root().dataset.rc05Emphasis).toBe('pressure')
    act(() => {
      window.dispatchEvent(new CustomEvent(RC05_EMPHASIS_EVENT, { detail: 'temperature' }))
    })
    expect(root().dataset.rc05Emphasis).toBe('temperature')
    act(() => {
      window.dispatchEvent(new CustomEvent(RC05_EMPHASIS_EVENT, { detail: 'nonsense' }))
    })
    expect(root().dataset.rc05Emphasis).toBe('temperature')
  })

  it('raises a pressure escalation on the offending side only', () => {
    const lowRf = {
      tyres: {
        lf: { tempC: 88, pressureKpa: 193, wearPct: 0.18 },
        rf: { tempC: 94, pressureKpa: 168, wearPct: 0.16 },
        lr: { tempC: 85, pressureKpa: 190, wearPct: 0.12 },
        rr: { tempC: 86, wearPct: 0.14 }
      }
    } as Partial<TelemetrySnapshot>
    const { push, view } = mount(lowRf)
    push(RC05_PRESSURE_ENGAGE_MS - 100, lowRf)
    expect(view.container.querySelector<HTMLElement>('[data-rc05-corner="RF"]')!.dataset.rc05PressureAlert).toBe('none')
    push(RC05_PRESSURE_ENGAGE_MS, lowRf)
    expect(view.container.querySelector<HTMLElement>('[data-rc05-corner="RF"]')!.dataset.rc05PressureAlert).toBe('low')
    expect(view.container.querySelector<HTMLElement>('[data-rc05-corner="LF"]')!.dataset.rc05PressureAlert).toBe('none')
  })

  it('clears the measured trend and the latched alerts on a source discontinuity', () => {
    const { push, root } = mount()
    push(1_000, { currentLap: 15 })
    expect(root().dataset.rc05Trend).toBe('measured')
    push(1_100, { sessionUniqueId: 999 } as Partial<TelemetrySnapshot>)
    expect(root().dataset.rc05Trend).toBe('pending')
    expect(root().dataset.rc05Alerts).toBe('silent')
  })
})
