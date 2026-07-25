// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOverlayStyle, type OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { OVERLAY_DASHBOARD_PRESETS } from '../../../../shared/dashboards'
import { WIDGET_COMPONENTS } from './index'
import { RaceconRc03DashWidget } from './RaceconRc03DashWidget'
import { Rc01LiveTelemetryBuffer, createRc01ChannelReceipts } from './raceconRc01Core'
import {
  RC03_OIL_PRESSURE_ENGAGE_MS,
  RC03_OIL_PRESSURE_MIN_BAR,
  RC03_OIL_PRESSURE_RECOVER_MS,
  RC03_OIL_PRESSURE_RPM_GATE,
  RC03_OVERHEAT_ENGAGE_MS,
  RC03_OVERHEAT_HYSTERESIS_MS,
  RC03_PIT_WINDOW_LAPS,
  RC03_WATER_LIMIT_C,
  type Rc03AlertInput,
  type Rc03StintFuelSample,
  Rc03StintFuelTracker,
  acknowledgeRc03Alarms,
  advanceRc03Alerts,
  buildRc03Ribbon,
  clearInvalidRc03Alerts,
  createRc03AlertState,
  createRc03AuxReceipts,
  createRc03DashboardModel,
  rc03AlarmLines,
  rc03BrightnessFromDisplaySwitch,
  rc03CompactModeForContentBox,
  rc03FormatDelta,
  rc03FormatLapTime,
  rc03FormatStintClock,
  rc03LayoutForContentBox,
  rc03NextVitalsPage,
  rc03PhoneGeometryForContentBox
} from './raceconRc03Core'

const config: OverlayWidgetConfig = {
  id: 'raceconRc03Dash',
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
 * The RC-03 approved reference state: mid-stint at night, 41.8 L of a 110 L tank, 6048 of
 * 8400 rpm, every vitals sensor valid.
 */
function snapshot(overrides: Partial<TelemetrySnapshot> = {}, timestamp = 2_512_000): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp,
    sessionUniqueId: 88,
    speedKmh: 218,
    rpm: 6_048,
    maxRpm: 8_400,
    gear: 4,
    throttle: 0.72,
    brake: 0,
    clutch: 0,
    sessionType: 'Race',
    currentLapTimeSec: 44.2,
    bestLapTimeSec: 118.4,
    deltaToBestSec: -0.112,
    lapDistPct: 0.37,
    waterTempC: 92,
    oilTempC: 108,
    oilPressureKpa: 460,
    voltage: 13.4,
    fuelLiters: 41.8,
    fuelCapacityLiters: 110,
    onPitRoad: false,
    pitLimiter: false,
    ...overrides
  } as TelemetrySnapshot
}

function markup(value: TelemetrySnapshot | null, cfg = config): string {
  return renderToStaticMarkup(createElement(RaceconRc03DashWidget, { snapshot: value, config: cfg }))
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
  options: Parameters<typeof createRc03DashboardModel>[4] = {},
  receiptsAtMs = nowMs
): ReturnType<typeof createRc03DashboardModel> {
  const receipts = value ? createRc01ChannelReceipts(value, receiptsAtMs) : new Map()
  const aux = value ? createRc03AuxReceipts(value, receiptsAtMs) : new Map()
  return createRc03DashboardModel(value, receipts, aux, nowMs, options)
}

function alertInput(overrides: Partial<Rc03AlertInput> = {}): Rc03AlertInput {
  return {
    nowMs: 0,
    fuelLapsRemaining: null,
    pitWindowLaps: RC03_PIT_WINDOW_LAPS,
    fuelModelSeq: 0,
    oilPressureBar: null,
    rpm: null,
    waterTempC: null,
    ...overrides
  }
}

describe('RC-03 registration and preset wiring', () => {
  it('registers the widget component under its canonical id', () => {
    expect(WIDGET_COMPONENTS.raceconRc03Dash).toBe(RaceconRc03DashWidget)
  })

  it('declares exactly one RC-03 full-frame preset directly after RC-02', () => {
    const ids = OVERLAY_DASHBOARD_PRESETS.map((preset) => preset.id)
    expect(ids.filter((id) => id === 'racecon_rc03_dash')).toHaveLength(1)
    expect(ids.indexOf('racecon_rc03_dash')).toBe(ids.indexOf('racecon_rc02_dash') + 1)
    const preset = OVERLAY_DASHBOARD_PRESETS.find((entry) => entry.id === 'racecon_rc03_dash')
    expect(preset?.widgetId).toBe('raceconRc03Dash')
    expect(preset?.name).toBe('RaceCon RC-03 Long Night')
    expect(preset?.scaleMode).toBe('stretch')
    expect(preset?.tags).toContain('endurance')
    expect(preset?.tags).toContain('night')
  })
})

describe('RC-03 shift ribbon', () => {
  it('is one continuous bar filled by rpm over maxRpm, never a discrete LED set', () => {
    const ribbon = buildRc03Ribbon(6_048 / 8_400, true)
    expect(ribbon.fill).toBeCloseTo(0.72, 10)
    expect(ribbon.unavailable).toBe(false)
    // The model exposes a single scalar fill, not an array of elements.
    expect(Array.isArray(ribbon as unknown as unknown[])).toBe(false)
  })

  it('clamps outside the zero-to-one range instead of overflowing its track', () => {
    expect(buildRc03Ribbon(1.4, true).fill).toBe(1)
    expect(buildRc03Ribbon(-0.2, true).fill).toBe(0)
  })

  it('empties and greys the ribbon when RPM is missing or stale', () => {
    expect(buildRc03Ribbon(null, true)).toMatchObject({ fill: 0, unavailable: true, tone: 'dark' })
    expect(buildRc03Ribbon(0.9, false)).toMatchObject({ fill: 0, unavailable: true, tone: 'dark' })
  })

  it('escalates to the warm-red token only while over-rev is latched', () => {
    expect(buildRc03Ribbon(0.99, true, false).tone).toBe('caution')
    expect(buildRc03Ribbon(0.99, true, true).tone).toBe('danger')
  })
})

describe('RC-03 measured fuel and stint model', () => {
  const base: Rc03StintFuelSample = {
    lapDistPct: 0.5,
    currentLapTimeSec: 60,
    fuelLiters: 50,
    onPitRoad: false,
    refuelServiceActive: false,
    receivedAt: 0
  }
  const feed = (tracker: Rc03StintFuelTracker, over: Partial<Rc03StintFuelSample>): void =>
    tracker.ingest({ ...base, ...over })

  /** Runs one full lap ending at an observed start-finish crossing. */
  function runLap(
    tracker: Rc03StintFuelTracker,
    { fuelAtEnd, lapTimeSec = 118, receivedAt = 0 }: { fuelAtEnd: number; lapTimeSec?: number; receivedAt?: number }
  ): void {
    feed(tracker, { lapDistPct: 0.5, currentLapTimeSec: lapTimeSec / 2, fuelLiters: fuelAtEnd + 0.5, receivedAt })
    feed(tracker, { lapDistPct: 0.95, currentLapTimeSec: lapTimeSec, fuelLiters: fuelAtEnd, receivedAt })
    feed(tracker, { lapDistPct: 0.01, currentLapTimeSec: 0, fuelLiters: fuelAtEnd, receivedAt })
  }

  /** Joins mid-track and crosses start-finish once, leaving a measurable lap start. */
  function joinThenCross(tracker: Rc03StintFuelTracker, fuel = 50, receivedAt = 0): void {
    feed(tracker, { lapDistPct: 0.8, currentLapTimeSec: 90, fuelLiters: fuel, receivedAt })
    feed(tracker, { lapDistPct: 0.01, currentLapTimeSec: 0, fuelLiters: fuel, receivedAt })
  }

  it('never projects a burn rate before a full lap has actually been measured', () => {
    const tracker = new Rc03StintFuelTracker()
    expect(tracker.reading(0).fuelPerLapL).toBeNull()
    joinThenCross(tracker)
    // The lap that was joined mid-track is not measurable, so it must record nothing.
    expect(tracker.reading(0).fuelPerLapL).toBeNull()
    expect(tracker.reading(0).measuredBurnLaps).toBe(0)
  })

  it('records a burn only between two observed start-finish crossings', () => {
    const tracker = new Rc03StintFuelTracker()
    joinThenCross(tracker, 50)
    runLap(tracker, { fuelAtEnd: 47.6 })
    expect(tracker.reading(0).measuredBurnLaps).toBe(1)
    expect(tracker.reading(0).fuelPerLapL).toBeCloseTo(2.4, 6)
  })

  it('averages the rolling window over several measured laps', () => {
    const tracker = new Rc03StintFuelTracker()
    joinThenCross(tracker, 50)
    runLap(tracker, { fuelAtEnd: 47.5 })
    runLap(tracker, { fuelAtEnd: 45.0 })
    expect(tracker.reading(0).measuredBurnLaps).toBe(2)
    expect(tracker.reading(0).fuelPerLapL).toBeCloseTo(2.5, 6)
    expect(tracker.reading(0).burnTrend).toHaveLength(2)
  })

  it('discards the whole fuel model when the tank is refuelled', () => {
    const tracker = new Rc03StintFuelTracker()
    joinThenCross(tracker, 50)
    runLap(tracker, { fuelAtEnd: 47.5 })
    const before = tracker.reading(0)
    expect(before.fuelPerLapL).not.toBeNull()
    // A tank that gains fuel is a refuel; averaging across it would fabricate a burn rate.
    feed(tracker, { lapDistPct: 0.2, currentLapTimeSec: 20, fuelLiters: 90 })
    const after = tracker.reading(0)
    expect(after.fuelPerLapL).toBeNull()
    expect(after.measuredBurnLaps).toBe(0)
    expect(after.fuelModelSeq).not.toBe(before.fuelModelSeq)
  })

  it('also discards the model on an explicit refuel service flag', () => {
    const tracker = new Rc03StintFuelTracker()
    joinThenCross(tracker, 50)
    runLap(tracker, { fuelAtEnd: 47.5 })
    feed(tracker, { refuelServiceActive: true })
    expect(tracker.reading(0).fuelPerLapL).toBeNull()
  })

  it('leaves the stint unmarked until an observed pit exit', () => {
    const tracker = new Rc03StintFuelTracker()
    joinThenCross(tracker)
    runLap(tracker, { fuelAtEnd: 47.5 })
    const reading = tracker.reading(0)
    // Laps were measured, but without a marker they belong to no stint.
    expect(reading.stintMarked).toBe(false)
    expect(reading.stintLap).toBeNull()
    expect(reading.stintElapsedMs).toBeNull()
  })

  it('starts the stint at an observed pit-road exit and counts only laps after it', () => {
    const tracker = new Rc03StintFuelTracker()
    feed(tracker, { onPitRoad: true, receivedAt: 1_000 })
    feed(tracker, { onPitRoad: false, receivedAt: 2_000 })
    expect(tracker.reading(2_000)).toMatchObject({ stintMarked: true, stintLap: 1, stintElapsedMs: 0 })
    joinThenCross(tracker, 50, 2_000)
    runLap(tracker, { fuelAtEnd: 47.5, receivedAt: 2_000 })
    expect(tracker.reading(2_000).stintLap).toBe(3)
    expect(tracker.reading(120_000 + 2_000 - 1_000).stintElapsedMs).toBe(119_000)
  })

  it('never carries laps across a pit entry: the marker and the model are both dropped', () => {
    const tracker = new Rc03StintFuelTracker()
    feed(tracker, { onPitRoad: true, receivedAt: 1_000 })
    feed(tracker, { onPitRoad: false, receivedAt: 2_000 })
    joinThenCross(tracker, 50, 2_000)
    runLap(tracker, { fuelAtEnd: 47.5, receivedAt: 2_000 })
    expect(tracker.reading(2_000).stintLap).toBe(3)
    feed(tracker, { onPitRoad: true, receivedAt: 3_000 })
    const reading = tracker.reading(3_000)
    expect(reading.stintMarked).toBe(false)
    expect(reading.stintLap).toBeNull()
    expect(reading.fuelPerLapL).toBeNull()
  })

  it('measures average pace only from laps run entirely inside the marked stint', () => {
    const tracker = new Rc03StintFuelTracker()
    expect(tracker.reading(0).averageLapSec).toBeNull()
    feed(tracker, { onPitRoad: true, receivedAt: 0 })
    feed(tracker, { onPitRoad: false, receivedAt: 0 })
    joinThenCross(tracker, 50)
    runLap(tracker, { fuelAtEnd: 47.5, lapTimeSec: 118.4 })
    expect(tracker.reading(0).averageLapSec).toBeCloseTo(118.4, 6)
  })

  it('dashes every measured value once the timing feed goes quiet', () => {
    const tracker = new Rc03StintFuelTracker()
    feed(tracker, { onPitRoad: true, receivedAt: 5_000 })
    feed(tracker, { onPitRoad: false, receivedAt: 5_000 })
    joinThenCross(tracker, 50, 5_000)
    runLap(tracker, { fuelAtEnd: 47.5, receivedAt: 5_000 })
    expect(tracker.reading(5_000).fuelPerLapL).not.toBeNull()
    // A frozen feed must degrade visibly rather than keep serving the last measurement.
    const quiet = tracker.reading(7_000)
    expect(quiet.fuelPerLapL).toBeNull()
    expect(quiet.stintLap).toBeNull()
    expect(quiet.averageLapSec).toBeNull()
  })

  it('never treats a missing timing feed as a lap', () => {
    const tracker = new Rc03StintFuelTracker()
    tracker.ingest({ ...base, lapDistPct: null, currentLapTimeSec: null })
    expect(tracker.hasTimingFeed()).toBe(false)
    expect(tracker.reading(0).measuredBurnLaps).toBe(0)
  })

  it('drops the marker and every measurement on reset', () => {
    const tracker = new Rc03StintFuelTracker()
    feed(tracker, { onPitRoad: true, receivedAt: 0 })
    feed(tracker, { onPitRoad: false, receivedAt: 0 })
    joinThenCross(tracker)
    runLap(tracker, { fuelAtEnd: 47.5 })
    tracker.reset()
    expect(tracker.reading(0)).toMatchObject({ stintMarked: false, stintLap: null, fuelPerLapL: null })
    expect(tracker.hasTimingFeed()).toBe(false)
  })

  it('clones without sharing mutable state', () => {
    const tracker = new Rc03StintFuelTracker()
    joinThenCross(tracker, 50)
    const copy = tracker.clone()
    runLap(copy, { fuelAtEnd: 47.5 })
    expect(copy.reading(0).measuredBurnLaps).toBe(1)
    expect(tracker.reading(0).measuredBurnLaps).toBe(0)
  })
})

describe('RC-03 fuel-window alert', () => {
  it('stays silent above the configured pit window and latches at or below it', () => {
    let state = createRc03AlertState()
    state = advanceRc03Alerts(state, alertInput({ fuelLapsRemaining: 12.4 }))
    expect(state.fuelWindow.active).toBe(false)
    state = advanceRc03Alerts(state, alertInput({ nowMs: 1_000, fuelLapsRemaining: 3 }))
    expect(state.fuelWindow.active).toBe(true)
  })

  it('is latched and steady: it does not drop out when the estimate wobbles back up', () => {
    let state = advanceRc03Alerts(createRc03AlertState(), alertInput({ fuelLapsRemaining: 2.4 }))
    expect(state.fuelWindow.active).toBe(true)
    state = advanceRc03Alerts(state, alertInput({ nowMs: 2_000, fuelLapsRemaining: 3.4 }))
    expect(state.fuelWindow.active).toBe(true)
  })

  it('clears when a refuel rebuilds the fuel model', () => {
    let state = advanceRc03Alerts(createRc03AlertState(), alertInput({ fuelLapsRemaining: 2.4 }))
    state = advanceRc03Alerts(state, alertInput({ nowMs: 1_000, fuelLapsRemaining: 2.4 }))
    expect(state.fuelWindow.active).toBe(true)
    state = advanceRc03Alerts(state, alertInput({ nowMs: 2_000, fuelLapsRemaining: 24, fuelModelSeq: 1 }))
    expect(state.fuelWindow.active).toBe(false)
  })

  it('unlatches whenever the fuel model can no longer produce a laps figure', () => {
    let state = advanceRc03Alerts(createRc03AlertState(), alertInput({ fuelLapsRemaining: 2.4 }))
    expect(state.fuelWindow.active).toBe(true)
    state = advanceRc03Alerts(state, alertInput({ nowMs: 1_000, fuelLapsRemaining: null }))
    expect(state.fuelWindow.active).toBe(false)
  })
})

describe('RC-03 low oil pressure alert', () => {
  const low = { oilPressureBar: RC03_OIL_PRESSURE_MIN_BAR - 0.8, rpm: RC03_OIL_PRESSURE_RPM_GATE + 2_000 }

  it('engages only after the full debounce above the RPM gate', () => {
    let state = createRc03AlertState()
    state = advanceRc03Alerts(state, alertInput({ nowMs: 0, ...low }))
    expect(state.oilPressure.active).toBe(false)
    state = advanceRc03Alerts(state, alertInput({ nowMs: RC03_OIL_PRESSURE_ENGAGE_MS - 1, ...low }))
    expect(state.oilPressure.active).toBe(false)
    state = advanceRc03Alerts(state, alertInput({ nowMs: RC03_OIL_PRESSURE_ENGAGE_MS, ...low }))
    expect(state.oilPressure.active).toBe(true)
  })

  it('never engages below the RPM gate, where low pressure is normal', () => {
    let state = createRc03AlertState()
    for (const nowMs of [0, 2_000, 10_000]) {
      state = advanceRc03Alerts(state, alertInput({ nowMs, oilPressureBar: 0.4, rpm: RC03_OIL_PRESSURE_RPM_GATE - 500 }))
    }
    expect(state.oilPressure.active).toBe(false)
  })

  it('holds for three seconds and only clears after three seconds of recovery', () => {
    let state = createRc03AlertState()
    state = advanceRc03Alerts(state, alertInput({ nowMs: 0, ...low }))
    state = advanceRc03Alerts(state, alertInput({ nowMs: RC03_OIL_PRESSURE_ENGAGE_MS, ...low }))
    expect(state.oilPressure.active).toBe(true)
    const recovered = { oilPressureBar: 4.6, rpm: RC03_OIL_PRESSURE_RPM_GATE + 2_000 }
    state = advanceRc03Alerts(state, alertInput({ nowMs: 2_000, ...recovered }))
    expect(state.oilPressure.active).toBe(true)
    state = advanceRc03Alerts(state, alertInput({ nowMs: 2_000 + RC03_OIL_PRESSURE_RECOVER_MS - 1, ...recovered }))
    expect(state.oilPressure.active).toBe(true)
    state = advanceRc03Alerts(state, alertInput({ nowMs: 2_000 + RC03_OIL_PRESSURE_RECOVER_MS, ...recovered }))
    expect(state.oilPressure.active).toBe(false)
  })

  it('unlatches immediately when the sensor becomes invalid or stale', () => {
    let state = createRc03AlertState()
    state = advanceRc03Alerts(state, alertInput({ nowMs: 0, ...low }))
    state = advanceRc03Alerts(state, alertInput({ nowMs: RC03_OIL_PRESSURE_ENGAGE_MS, ...low }))
    expect(state.oilPressure.active).toBe(true)
    state = advanceRc03Alerts(state, alertInput({ nowMs: 5_000, oilPressureBar: null, rpm: 6_000 }))
    expect(state.oilPressure.active).toBe(false)
  })
})

describe('RC-03 overheat alert', () => {
  const hot = { waterTempC: RC03_WATER_LIMIT_C + 5 }

  it('engages only after three seconds above the limit', () => {
    let state = createRc03AlertState()
    state = advanceRc03Alerts(state, alertInput({ nowMs: 0, ...hot }))
    expect(state.overheat.active).toBe(false)
    state = advanceRc03Alerts(state, alertInput({ nowMs: RC03_OVERHEAT_ENGAGE_MS - 1, ...hot }))
    expect(state.overheat.active).toBe(false)
    state = advanceRc03Alerts(state, alertInput({ nowMs: RC03_OVERHEAT_ENGAGE_MS, ...hot }))
    expect(state.overheat.active).toBe(true)
  })

  it('holds inside the hysteresis band and clears only below limit minus two for five seconds', () => {
    let state = createRc03AlertState()
    state = advanceRc03Alerts(state, alertInput({ nowMs: 0, ...hot }))
    state = advanceRc03Alerts(state, alertInput({ nowMs: RC03_OVERHEAT_ENGAGE_MS, ...hot }))
    expect(state.overheat.active).toBe(true)
    // Inside the hysteresis band the alert must stay engaged.
    state = advanceRc03Alerts(state, alertInput({ nowMs: 4_000, waterTempC: RC03_WATER_LIMIT_C - 1 }))
    expect(state.overheat.active).toBe(true)
    const cool = { waterTempC: RC03_WATER_LIMIT_C - 3 }
    state = advanceRc03Alerts(state, alertInput({ nowMs: 5_000, ...cool }))
    expect(state.overheat.active).toBe(true)
    state = advanceRc03Alerts(state, alertInput({ nowMs: 5_000 + RC03_OVERHEAT_HYSTERESIS_MS - 1, ...cool }))
    expect(state.overheat.active).toBe(true)
    state = advanceRc03Alerts(state, alertInput({ nowMs: 5_000 + RC03_OVERHEAT_HYSTERESIS_MS, ...cool }))
    expect(state.overheat.active).toBe(false)
  })

  it('unlatches immediately when the coolant sensor becomes invalid or stale', () => {
    let state = createRc03AlertState()
    state = advanceRc03Alerts(state, alertInput({ nowMs: 0, ...hot }))
    state = advanceRc03Alerts(state, alertInput({ nowMs: RC03_OVERHEAT_ENGAGE_MS, ...hot }))
    expect(state.overheat.active).toBe(true)
    state = advanceRc03Alerts(state, alertInput({ nowMs: 6_000, waterTempC: null }))
    expect(state.overheat.active).toBe(false)
  })
})

describe('RC-03 alarm line and stale-input unlatching', () => {
  it('lists only alarms that are actually latched, and never blinks them', () => {
    expect(rc03AlarmLines(createRc03AlertState())).toEqual([])
    let state = createRc03AlertState()
    state = advanceRc03Alerts(state, alertInput({ nowMs: 0, waterTempC: 120 }))
    state = advanceRc03Alerts(state, alertInput({ nowMs: RC03_OVERHEAT_ENGAGE_MS, waterTempC: 120 }))
    expect(rc03AlarmLines(state)).toEqual(['OVERHEAT'])
  })

  it('acknowledging silences the line but never the latched alert itself', () => {
    let state = createRc03AlertState()
    state = advanceRc03Alerts(state, alertInput({ nowMs: 0, waterTempC: 120 }))
    state = advanceRc03Alerts(state, alertInput({ nowMs: RC03_OVERHEAT_ENGAGE_MS, waterTempC: 120 }))
    const acknowledged = acknowledgeRc03Alarms(state)
    expect(rc03AlarmLines(acknowledged)).toEqual([])
    expect(acknowledged.overheat.active).toBe(true)
    // A fresh engage after a clear must re-arm the line.
    let recleared = advanceRc03Alerts(acknowledged, alertInput({ nowMs: 20_000, waterTempC: null }))
    expect(recleared.overheat.active).toBe(false)
    recleared = advanceRc03Alerts(recleared, alertInput({ nowMs: 21_000, waterTempC: 120 }))
    recleared = advanceRc03Alerts(recleared, alertInput({ nowMs: 21_000 + RC03_OVERHEAT_ENGAGE_MS, waterTempC: 120 }))
    expect(rc03AlarmLines(recleared)).toEqual(['OVERHEAT'])
  })

  it('clears every alert whose gauge has degraded to its dash state', () => {
    const latched = {
      fuelWindow: { active: true, modelSeq: 0 },
      oilPressure: { active: true, pendingSinceMs: null, recoverySinceMs: null, holdUntilMs: 0, acknowledged: false },
      overheat: { active: true, pendingSinceMs: null, recoverySinceMs: null, acknowledged: false }
    }
    const blind = modelFor(snapshot({ waterTempC: undefined, oilPressureKpa: undefined }))
    const cleared = clearInvalidRc03Alerts(latched, blind)
    expect(cleared.oilPressure.active).toBe(false)
    expect(cleared.overheat.active).toBe(false)
    expect(cleared.fuelWindow.active).toBe(false)
  })
})

describe('RC-03 telemetry truth', () => {
  it('computes the fuel bar from level over capacity, never from the reference render', () => {
    const model = modelFor(snapshot())
    // 41.8 L of a 110 L tank is 38.0 %, not the 43.48 % the approved artifact happens to draw.
    expect(model.fuelBar.fill).toBeCloseTo(0.38, 6)
    expect(model.fuelBar.unavailable).toBe(false)
    expect(model.fuelLevel.value).toBe('41.8')
  })

  it('dashes the fuel level and empties the bar while the fuel model is uncalibrated', () => {
    const model = modelFor(snapshot({ fuelCapacityLiters: undefined }))
    expect(model.fuelLevel).toMatchObject({ unavailable: true, value: '--' })
    expect(model.fuelBar).toMatchObject({ unavailable: true, fill: 0 })
  })

  it('dashes fuel laps and fuel per lap until a burn lap has genuinely been measured', () => {
    const model = modelFor(snapshot())
    expect(model.fuelLaps).toMatchObject({ unavailable: true, value: '--' })
    expect(model.fuelPerLap).toMatchObject({ unavailable: true, value: '--' })
    const measured = modelFor(snapshot(), 0, {
      stintFuel: {
        stintMarked: true,
        stintLap: 18,
        stintElapsedMs: 2_512_000,
        fuelPerLapL: 3.37,
        measuredBurnLaps: 4,
        burnTrend: [3.4, 3.3, 3.4, 3.38],
        averageLapSec: 118.4,
        fuelModelSeq: 0
      }
    })
    expect(measured.fuelLaps.value).toBe('12.4')
    expect(measured.fuelPerLap.value).toBe('3.37')
  })

  it('dashes the stint lap and the stint timer without an explicit marker', () => {
    const model = modelFor(snapshot())
    expect(model.stintLap).toMatchObject({ unavailable: true, value: '--' })
    expect(model.stintClock).toMatchObject({ unavailable: true, value: '--:--' })
  })

  it('shows N or a grey dash for gear and never derives it from RPM or speed', () => {
    expect(modelFor(snapshot({ gear: 0 })).gear.value).toBe('N')
    expect(modelFor(snapshot({ gear: -1 })).gear.value).toBe('R')
    const missing = modelFor(snapshot({ gear: undefined }))
    expect(missing.gear).toMatchObject({ unavailable: true, value: '-' })
    // RPM and speed are still present, so a derived gear would have been possible here.
    expect(missing.speed.unavailable).toBe(false)
    expect(missing.ribbon.unavailable).toBe(false)
  })

  it('dashes the delta until a stored best exists', () => {
    expect(modelFor(snapshot()).delta.value).toBe('-0.112')
    expect(modelFor(snapshot({ bestLapTimeSec: undefined })).delta).toMatchObject({ unavailable: true, value: '--.---' })
    expect(modelFor(snapshot({ deltaToBestSec: undefined })).delta).toMatchObject({ unavailable: true, value: '--.---' })
  })

  it('greys each vital independently and never substitutes one sensor for another', () => {
    const model = modelFor(snapshot({ oilTempC: undefined, voltage: undefined }))
    const byChannel = Object.fromEntries(model.vitals.map((vital) => [vital.channel, vital]))
    expect(byChannel.waterTemp.value).toBe('92')
    expect(byChannel.oilPressure.value).toBe('4.6')
    expect(byChannel.oilTemp).toMatchObject({ unavailable: true, value: '--' })
    expect(byChannel.battery).toMatchObject({ unavailable: true, value: '--' })
    // Oil temperature must never fall back to the water sensor.
    expect(byChannel.oilTemp.raw).toBeNull()
  })

  it('treats a quiet electrical bus as unavailable rather than a nominal voltage', () => {
    const model = modelFor(snapshot({ voltage: 0 }))
    expect(model.vitals.find((vital) => vital.channel === 'battery')).toMatchObject({ unavailable: true, value: '--' })
  })

  it('degrades every stale vital to its dash state instead of freezing it', () => {
    // Receipts taken at t=0 and read 60 s later: every vitals channel is long stale.
    const stale = modelFor(snapshot(), 60_000, {}, 0)
    for (const vital of stale.vitals) {
      expect(vital.unavailable).toBe(true)
      expect(vital.value).toBe('--')
    }
    expect(stale.ribbon.unavailable).toBe(true)
    expect(stale.fuelLevel.unavailable).toBe(true)
  })

  it('omits tyre temperature entirely: it has no zone in either layout', () => {
    const model = modelFor(snapshot())
    expect('tyres' in model).toBe(false)
    expect(JSON.stringify(model)).not.toContain('LF')
  })

  it('projects the pit lap and the average pace only from real measured inputs', () => {
    const bare = modelFor(snapshot())
    expect(bare.projectedPitLap).toMatchObject({ unavailable: true, value: '--' })
    expect(bare.averagePace).toMatchObject({ unavailable: true, value: '--:--.---' })
    const measured = modelFor(snapshot(), 0, {
      stintFuel: {
        stintMarked: true,
        stintLap: 18,
        stintElapsedMs: 2_512_000,
        fuelPerLapL: 3.37,
        measuredBurnLaps: 4,
        burnTrend: [3.4],
        averageLapSec: 118.4,
        fuelModelSeq: 0
      }
    })
    expect(measured.projectedPitLap.value).toBe('30')
    expect(measured.averagePace.value).toBe('1:58.400')
  })

  it('cycles the vitals band between temperatures and pressures without inventing a channel', () => {
    expect(rc03NextVitalsPage('temps')).toBe('pressures')
    expect(rc03NextVitalsPage('pressures')).toBe('temps')
    const temps = modelFor(snapshot(), 0, { vitalsPage: 'temps' })
    expect(temps.vitals.map((vital) => vital.channel)).toEqual(['waterTemp', 'oilPressure', 'oilTemp', 'battery'])
    const pressures = modelFor(snapshot(), 0, { vitalsPage: 'pressures' })
    expect(pressures.vitals.map((vital) => vital.channel)).toEqual([
      'oilPressure',
      'fuelPressure',
      'manifoldPressure',
      'battery'
    ])
    // The pressure channels this provider does not expose must dash, not borrow another gauge.
    expect(pressures.vitals[1]).toMatchObject({ unavailable: true, value: '--' })
    expect(pressures.vitals[2]).toMatchObject({ unavailable: true, value: '--' })
  })

  it('formats every RC-03 readout deterministically', () => {
    expect(rc03FormatStintClock(2_512_000)).toBe('41:52')
    expect(rc03FormatStintClock(null)).toBe('--:--')
    expect(rc03FormatStintClock(Number.NaN)).toBe('--:--')
    expect(rc03FormatDelta(-0.112)).toBe('-0.112')
    expect(rc03FormatDelta(0.5)).toBe('+0.500')
    expect(rc03FormatDelta(null)).toBe('--.---')
    expect(rc03FormatLapTime(118.4)).toBe('1:58.400')
    expect(rc03FormatLapTime(null)).toBe('--:--.---')
  })

  it('keeps the night brightness profile unless a display-switch event says otherwise', () => {
    expect(rc03BrightnessFromDisplaySwitch(undefined)).toBe('night')
    expect(rc03BrightnessFromDisplaySwitch({ profile: 'day' })).toBe('day')
    expect(rc03BrightnessFromDisplaySwitch('night')).toBe('night')
    expect(rc03BrightnessFromDisplaySwitch({ profile: 'sunglasses' })).toBe('night')
  })
})

describe('RC-03 responsive contract', () => {
  it('resolves the native, app and compact layouts from the content box', () => {
    expect(rc03LayoutForContentBox(800, 480)).toBe('native')
    expect(rc03LayoutForContentBox(801, 481)).toBe('native')
    expect(rc03LayoutForContentBox(1024, 600)).toBe('app')
    expect(rc03LayoutForContentBox(1440, 900)).toBe('app')
    expect(rc03LayoutForContentBox(393, 759)).toBe('compact')
    expect(rc03LayoutForContentBox(0, 0)).toBe('app')
  })

  it('classifies phone and landscape compact modes', () => {
    expect(rc03CompactModeForContentBox(393, 759)).toBe('phone')
    expect(rc03CompactModeForContentBox(412, 867)).toBe('phone')
    expect(rc03CompactModeForContentBox(759, 393)).toBe('landscape')
    expect(rc03CompactModeForContentBox(867, 412)).toBe('landscape')
    expect(rc03CompactModeForContentBox(640, 520)).toBe('standard')
    expect(rc03CompactModeForContentBox(1024, 600)).toBe('standard')
  })

  it('emits contained portrait band geometry only at the phone breakpoint', () => {
    expect(rc03PhoneGeometryForContentBox(1024, 600)).toBeNull()
    for (const [width, height] of [
      [393, 759],
      [412, 867]
    ] as const) {
      const geometry = rc03PhoneGeometryForContentBox(width, height)
      expect(geometry).not.toBeNull()
      // Every band must start below the previous one and the stack must fit the canvas.
      expect(geometry!.paceTop).toBeGreaterThan(geometry!.ribbonTop + geometry!.ribbonHeight)
      expect(geometry!.vitalsTop).toBeGreaterThan(geometry!.paceTop + geometry!.paceHeight)
      expect(geometry!.fuelTop).toBeGreaterThan(geometry!.vitalsTop + geometry!.vitalsHeight)
      expect(geometry!.fuelTop + geometry!.fuelHeight).toBeLessThanOrEqual(height)
    }
  })
})

describe('RC-03 rendering', () => {
  it('renders the canonical DOM contract with one continuous ribbon and four vitals', () => {
    const html = markup(snapshot())
    assertClean(html)
    expect(html).toContain('data-widget="raceconRc03Dash"')
    expect(html).toContain('data-testid="rc03-ribbon"')
    expect(html.match(/data-testid="rc03-ribbon-fill"/g) ?? []).toHaveLength(1)
    expect(html.match(/data-testid="rc03-vital"/g) ?? []).toHaveLength(4)
    expect(html).toContain('data-testid="rc03-fuel-bar-fill"')
    expect(html).toContain('data-testid="rc03-stint-clock"')
    expect(html).toContain('data-testid="rc03-soft-key"')
    expect(html).toContain('data-rc03-brightness="night"')
    // No hero column, no vertical spine and no discrete LED strip.
    expect(html).not.toContain('rc03-led')
    expect(html).not.toContain('rc03-spine')
  })

  it('carries the three calm bands and the app-only strategy rail', () => {
    const html = markup(snapshot())
    expect(html).toContain('data-rc03-band="pace"')
    expect(html).toContain('data-rc03-band="vitals"')
    expect(html).toContain('data-rc03-band="fuel"')
    expect(html).toContain('data-testid="rc03-rail"')
    expect(html).toContain('data-testid="rc03-fuel-trend"')
  })

  it('never prints an RPM numeral: the ribbon is the only RPM surface', () => {
    const html = markup(snapshot())
    expect(html).not.toContain('6,048')
    expect(html).not.toContain('>6048<')
  })

  it('keeps every alert silent when nothing has triggered', () => {
    const html = markup(snapshot())
    expect(html).toContain('data-rc03-fuel-window="false"')
    expect(html).toContain('data-rc03-oil-alarm="false"')
    expect(html).toContain('data-rc03-overheat="false"')
    expect(html).not.toContain('PIT WINDOW')
    expect(html).not.toContain('data-testid="rc03-alarm-line"')
  })

  it('renders a clean, dash-only frame with no telemetry at all', () => {
    const html = markup(null)
    assertClean(html)
    expect(html).not.toContain('data-rc03-buffer-state="accepted"')
    expect(html).toContain('--:--')
    expect(html).toContain('--.---')
    expect(html.match(/data-testid="rc03-vital"/g) ?? []).toHaveLength(4)
    expect(html).toContain('data-unavailable="true"')
  })

  it('refuses mock and replay telemetry and raises no alert from it', () => {
    for (const value of [
      snapshot({ sim: 'mock' } as Partial<TelemetrySnapshot>),
      snapshot({ replayContext: { state: 'replay' } } as unknown as Partial<TelemetrySnapshot>)
    ]) {
      const html = markup(value)
      assertClean(html)
      expect(html).not.toContain('data-rc03-buffer-state="accepted"')
      expect(html).toContain('data-rc03-fuel-window="false"')
      expect(html).not.toContain('PIT WINDOW')
    }
  })

  it('marks the native 800x480 contract only at that exact size', () => {
    const native = { ...config, position: { x: 0, y: 0, width: 800, height: 480 } }
    expect(markup(snapshot(), native)).toContain('data-rc03-native-size="800x480"')
    expect(markup(snapshot())).not.toContain('data-rc03-native-size')
  })

  it('exposes the compact mode attribute only in the compact layout', () => {
    const phone = { ...config, position: { x: 0, y: 0, width: 393, height: 759 } }
    expect(markup(snapshot(), phone)).toContain('data-rc03-compact-mode="phone"')
    expect(markup(snapshot())).not.toContain('data-rc03-compact-mode')
  })
})

describe('RC-03 shares the RC-01 fail-closed ingest buffer', () => {
  it('accepts a live identified snapshot and rejects an unidentified one', () => {
    const buffer = new Rc01LiveTelemetryBuffer()
    expect(buffer.ingest(snapshot(), 1_000).accepted).toBe(true)
    const orphan = new Rc01LiveTelemetryBuffer()
    expect(orphan.ingest(snapshot({ sessionUniqueId: undefined, connectionEpoch: undefined }), 1_000).accepted).toBe(false)
  })
})

/**
 * The alert surfaces cannot be reached by a single static render: every one of them requires
 * evidence accumulated across frames, which is exactly the packet's point. These drive the
 * real component over a real frame sequence so the alert markup can never become dead code.
 */
describe('RC-03 live alert surfaces', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  function mount(): {
    push: (atMs: number, overrides: Partial<TelemetrySnapshot>) => void
    root: () => HTMLElement
    view: ReturnType<typeof render>
  } {
    vi.useFakeTimers()
    let monotonicMs = 0
    const monotonicClock = (): number => monotonicMs
    const view = render(
      createElement(RaceconRc03DashWidget, { snapshot: snapshot({ lapDistPct: 0.9 }, 1_000), config, monotonicClock })
    )
    const push = (atMs: number, overrides: Partial<TelemetrySnapshot>): void => {
      const elapsed = atMs - monotonicMs
      monotonicMs = atMs
      act(() => {
        vi.advanceTimersByTime(elapsed)
      })
      view.rerender(
        createElement(RaceconRc03DashWidget, { snapshot: snapshot(overrides, 1_000 + atMs), config, monotonicClock })
      )
    }
    return { push, root: () => view.container.querySelector<HTMLElement>('.rc03-widget')!, view }
  }

  it('keeps every alert surface absent while nothing has triggered', () => {
    const { root, view } = mount()
    expect(root().dataset.rc03FuelWindow).toBe('false')
    expect(root().dataset.rc03Overheat).toBe('false')
    expect(root().dataset.rc03OilAlarm).toBe('false')
    expect(view.container.querySelector('[data-testid="rc03-alarm-line"]')).toBeNull()
    expect(view.container.querySelector('[data-testid="rc03-pit-window"]')).toBeNull()
    expect(view.container.querySelector('[data-rc03-band="vitals"]')?.getAttribute('data-rc03-alarm')).toBe('none')
  })

  it('opens the fuel window only after two measured burn laps put it inside the window', () => {
    const { push, root, view } = mount()
    // Two observed start-finish crossings with a real level drop between them.
    push(100, { lapDistPct: 0.01, fuelLiters: 15 })
    push(200, { lapDistPct: 0.5, fuelLiters: 13.5 })
    push(300, { lapDistPct: 0.95, fuelLiters: 12 })
    push(400, { lapDistPct: 0.01, fuelLiters: 12 })
    // 12 L at a measured 3 L/lap is 4 laps: still outside the 3-lap window.
    expect(view.getByLabelText('Fuel laps remaining 4.0')).toBeTruthy()
    expect(root().dataset.rc03FuelWindow).toBe('false')

    push(500, { lapDistPct: 0.5, fuelLiters: 10.5 })
    push(600, { lapDistPct: 0.95, fuelLiters: 9 })
    push(700, { lapDistPct: 0.01, fuelLiters: 9 })
    expect(view.getByLabelText('Fuel laps remaining 3.0')).toBeTruthy()
    expect(root().dataset.rc03FuelWindow).toBe('true')
    expect(view.container.querySelector('[data-testid="rc03-pit-window"]')?.textContent).toBe('PIT WINDOW')
    expect(view.container.querySelector('[data-rc03-band="fuel"]')?.getAttribute('data-rc03-window')).toBe('open')
  })

  it('raises the overheat surface only after three seconds above the limit, and never blinks', () => {
    const { push, root, view } = mount()
    for (let atMs = 100; atMs <= 3_000; atMs += 100) {
      push(atMs, { lapDistPct: 0.5, waterTempC: RC03_WATER_LIMIT_C + 13 })
    }
    // The debounce starts at the first hot frame (t=100), so t=3000 is still 100 ms short.
    expect(root().dataset.rc03Overheat).toBe('false')
    push(3_100, { lapDistPct: 0.5, waterTempC: RC03_WATER_LIMIT_C + 13 })
    expect(root().dataset.rc03Overheat).toBe('true')
    expect(view.container.querySelector('[data-rc03-band="vitals"]')?.getAttribute('data-rc03-alarm')).toBe('overheat')
    expect(view.container.querySelector('[data-testid="rc03-alarm-line"]')?.textContent).toContain('OVERHEAT')
    expect(view.container.querySelector('[data-channel="waterTemp"]')?.getAttribute('data-alert')).toBe('true')
    // Escalation is border and brightness only: nothing in the alert layer animates.
    expect(view.container.innerHTML).not.toContain('animation')
  })

  it('unlatches the overheat surface the moment the coolant sensor stops reporting', () => {
    const { push, root } = mount()
    for (let atMs = 100; atMs <= 3_100; atMs += 100) {
      push(atMs, { lapDistPct: 0.5, waterTempC: RC03_WATER_LIMIT_C + 13 })
    }
    expect(root().dataset.rc03Overheat).toBe('true')
    push(3_200, { lapDistPct: 0.5, waterTempC: undefined })
    expect(root().dataset.rc03Overheat).toBe('false')
  })

  it('starts the stint clock and the lap counter only at an observed pit exit', () => {
    const { push, view } = mount()
    push(100, { lapDistPct: 0.5, onPitRoad: false })
    expect(view.getByLabelText('Stint lap unavailable')).toBeTruthy()
    expect(view.getByLabelText('Stint timer unavailable')).toBeTruthy()
    push(200, { lapDistPct: 0.5, onPitRoad: true })
    push(300, { lapDistPct: 0.5, onPitRoad: false })
    expect(view.getByLabelText('Stint lap 1')).toBeTruthy()
    expect(view.getByLabelText('Stint timer 00:00')).toBeTruthy()
  })
})
