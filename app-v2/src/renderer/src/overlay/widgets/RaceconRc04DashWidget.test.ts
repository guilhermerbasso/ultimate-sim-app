// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOverlayStyle, type OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { OVERLAY_DASHBOARD_PRESETS } from '../../../../shared/dashboards'
import { WIDGET_COMPONENTS } from './index'
import { RaceconRc04DashWidget } from './RaceconRc04DashWidget'
import { Rc01LiveTelemetryBuffer, createRc01ChannelReceipts } from './raceconRc01Core'
import {
  RC04_ALARM_MIN_VISIBLE_MS,
  RC04_DEFAULT_PIT_LIMIT_KMH,
  RC04_LIMITER_MISMATCH_ENGAGE_MS,
  RC04_LIMIT_RULE_FRACTION,
  RC04_NEAR_LIMIT_MARGIN_KMH,
  RC04_OVERSPEED_CLEAR_MARGIN_KMH,
  RC04_OVERSPEED_ENGAGE_MS,
  RC04_OVERSPEED_RELEASE_MS,
  RC04_PHASES,
  RC04_PHASE_EVENT,
  RC04_UNSAFE_RELEASE_MIN_VISIBLE_MS,
  type Rc04AlertInput,
  type Rc04PitSequenceSample,
  Rc04PitSequenceTracker,
  acknowledgeRc04Alarms,
  advanceRc04Alerts,
  clearInvalidRc04Alerts,
  createRc04AlertState,
  createRc04AuxReceipts,
  createRc04DashboardModel,
  rc04ActionLine,
  rc04AlarmLines,
  rc04BarFullScaleKmh,
  rc04CompactModeForContentBox,
  rc04DisplayGear,
  rc04FormatClock,
  rc04LayoutForContentBox,
  rc04PhaseFromEvent,
  rc04PhaseSteps,
  rc04PhoneGeometryForContentBox,
  rc04ResolvePitLimitKmh,
  rc04ServiceActive
} from './raceconRc04Core'

const config: OverlayWidgetConfig = {
  id: 'raceconRc04Dash',
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
 * The RC-04 approved reference state: LIMITER phase, 6.2 s past the pit-entry line, 52 km/h
 * against a 60 km/h limit with the limiter engaged, 68 L in a calibrated tank, second gear
 * and no start-sequence feed (so the grid slot dashes).
 */
function snapshot(overrides: Partial<TelemetrySnapshot> = {}, timestamp = 2_058_000): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp,
    sessionUniqueId: 74,
    speedKmh: 52,
    rpm: 4_200,
    maxRpm: 8_400,
    gear: 2,
    throttle: 0.18,
    brake: 0,
    clutch: 0,
    sessionType: 'Race',
    sessionState: 'racing',
    fuelLiters: 68,
    fuelCapacityLiters: 110,
    onPitRoad: true,
    pitLimiter: true,
    ...overrides
  } as TelemetrySnapshot
}

function markup(value: TelemetrySnapshot | null, cfg = config): string {
  return renderToStaticMarkup(createElement(RaceconRc04DashWidget, { snapshot: value, config: cfg }))
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
  options: Parameters<typeof createRc04DashboardModel>[4] = {},
  receiptsAtMs = nowMs
): ReturnType<typeof createRc04DashboardModel> {
  const receipts = value ? createRc01ChannelReceipts(value, receiptsAtMs) : new Map()
  const aux = value ? createRc04AuxReceipts(value, receiptsAtMs) : new Map()
  return createRc04DashboardModel(value, receipts, aux, nowMs, options)
}

function alertInput(overrides: Partial<Rc04AlertInput> = {}): Rc04AlertInput {
  return {
    nowMs: 0,
    phase: 'limiter',
    pitSpeedKmh: null,
    pitLimitKmh: RC04_DEFAULT_PIT_LIMIT_KMH,
    limiter: null,
    proximity: null,
    ...overrides
  }
}

function sequence(
  overrides: Partial<ReturnType<Rc04PitSequenceTracker['reading']>> = {}
): ReturnType<Rc04PitSequenceTracker['reading']> {
  return {
    phase: 'limiter',
    sequenceActive: true,
    blendComplete: false,
    stintMarked: true,
    stintElapsedMs: 2_058_000,
    stopElapsedMs: null,
    feedLive: true,
    reachedIndex: 1,
    ...overrides
  }
}

/** A snapshot overlay that puts the car in its own pit stall with a complete PitStatus. */
function inStall(extra: Partial<TelemetrySnapshot> = {}): Partial<TelemetrySnapshot> {
  return {
    onPitRoad: true,
    pitLimiter: true,
    pit: { repairNeeded: false, optRepairNeeded: false, pitsOpen: true, inPitStall: true },
    ...extra
  }
}

describe('RC-04 registration and preset wiring', () => {
  it('registers the widget component under its canonical id', () => {
    expect(WIDGET_COMPONENTS.raceconRc04Dash).toBe(RaceconRc04DashWidget)
  })

  it('declares exactly one RC-04 full-frame preset directly after RC-03', () => {
    const ids = OVERLAY_DASHBOARD_PRESETS.map((preset) => preset.id)
    expect(ids.filter((id) => id === 'racecon_rc04_dash')).toHaveLength(1)
    expect(ids.indexOf('racecon_rc04_dash')).toBe(ids.indexOf('racecon_rc03_dash') + 1)
    const preset = OVERLAY_DASHBOARD_PRESETS.find((entry) => entry.id === 'racecon_rc04_dash')
    expect(preset?.widgetId).toBe('raceconRc04Dash')
    expect(preset?.name).toBe('RaceCon RC-04 Box Now')
    expect(preset?.scaleMode).toBe('stretch')
    expect(preset?.tags).toContain('racecon')
    expect(preset?.tags).toContain('pit')
  })
})

describe('RC-04 phase state machine', () => {
  const base: Rc04PitSequenceSample = {
    onPitRoad: false,
    pitLimiter: false,
    inPitStall: false,
    serviceActive: false,
    receivedAt: 0
  }
  const feed = (tracker: Rc04PitSequenceTracker, over: Partial<Rc04PitSequenceSample>): void =>
    tracker.ingest({ ...base, ...over })

  it('exposes exactly the packet five steps in order', () => {
    expect(RC04_PHASES).toEqual(['approach', 'limiter', 'box', 'service', 'release'])
  })

  it('enlarges exactly one step and collapses the other four', () => {
    for (const phase of RC04_PHASES) {
      const steps = rc04PhaseSteps(phase, RC04_PHASES.indexOf(phase))
      expect(steps).toHaveLength(5)
      expect(steps.filter((step) => step.active)).toHaveLength(1)
      expect(steps.find((step) => step.active)?.phase).toBe(phase)
    }
  })

  it('stays inert until a pit road is actually observed', () => {
    const tracker = new Rc04PitSequenceTracker()
    feed(tracker, { onPitRoad: null, pitLimiter: true, inPitStall: true, serviceActive: true })
    const reading = tracker.reading(0)
    expect(reading.phase).toBe('approach')
    expect(reading.sequenceActive).toBe(false)
    expect(reading.stintMarked).toBe(false)
  })

  it('advances only on observed events, one step at a time', () => {
    const tracker = new Rc04PitSequenceTracker()
    feed(tracker, { onPitRoad: true, receivedAt: 1_000 })
    expect(tracker.reading(1_000).phase).toBe('approach')
    expect(tracker.reading(1_000).sequenceActive).toBe(true)

    feed(tracker, { onPitRoad: true, pitLimiter: true, receivedAt: 1_100 })
    expect(tracker.reading(1_100).phase).toBe('limiter')

    feed(tracker, { onPitRoad: true, pitLimiter: true, inPitStall: true, receivedAt: 1_200 })
    expect(tracker.reading(1_200).phase).toBe('box')

    feed(tracker, { onPitRoad: true, pitLimiter: true, inPitStall: true, serviceActive: true, receivedAt: 1_300 })
    expect(tracker.reading(1_300).phase).toBe('service')

    // The RELEASE step needs an observed service COMPLETION, not merely a quiet frame.
    feed(tracker, { onPitRoad: true, pitLimiter: true, inPitStall: true, serviceActive: false, receivedAt: 1_400 })
    expect(tracker.reading(1_400).phase).toBe('release')
  })

  it('never walks backwards inside a sequence when a signal flickers', () => {
    const tracker = new Rc04PitSequenceTracker()
    feed(tracker, { onPitRoad: true, receivedAt: 0 })
    feed(tracker, { onPitRoad: true, pitLimiter: true, inPitStall: true, receivedAt: 100 })
    expect(tracker.reading(100).phase).toBe('box')
    feed(tracker, { onPitRoad: true, pitLimiter: false, inPitStall: false, receivedAt: 200 })
    expect(tracker.reading(200).phase).toBe('box')
  })

  it('marks the stint and restores the shift LEDs only at the observed blend to track', () => {
    const tracker = new Rc04PitSequenceTracker()
    feed(tracker, { onPitRoad: true, receivedAt: 1_000 })
    feed(tracker, { onPitRoad: true, pitLimiter: true, inPitStall: true, serviceActive: true, receivedAt: 2_000 })
    expect(tracker.reading(2_000).stintMarked).toBe(false)
    expect(tracker.reading(2_000).sequenceActive).toBe(true)

    feed(tracker, { onPitRoad: false, receivedAt: 3_000 })
    const blended = tracker.reading(3_000)
    expect(blended.blendComplete).toBe(true)
    expect(blended.sequenceActive).toBe(false)
    expect(blended.stintMarked).toBe(true)
    expect(blended.stintElapsedMs).toBe(0)
    expect(blended.phase).toBe('approach')
  })

  it('measures the stop clock from the observed box arrival, never from a guess', () => {
    const tracker = new Rc04PitSequenceTracker()
    expect(tracker.reading(0).stopElapsedMs).toBeNull()
    feed(tracker, { onPitRoad: true, receivedAt: 0 })
    expect(tracker.reading(500).stopElapsedMs).toBeNull()
    feed(tracker, { onPitRoad: true, pitLimiter: true, inPitStall: true, receivedAt: 1_000 })
    expect(tracker.reading(1_030).stopElapsedMs).toBe(30)
  })

  it('degrades the ribbon to idle when the pit feed falls silent', () => {
    const tracker = new Rc04PitSequenceTracker()
    feed(tracker, { onPitRoad: true, receivedAt: 0 })
    expect(tracker.reading(500).feedLive).toBe(true)
    expect(tracker.reading(5_000).feedLive).toBe(false)
  })

  it('clears the whole sequence on a source discontinuity', () => {
    const tracker = new Rc04PitSequenceTracker()
    feed(tracker, { onPitRoad: true, pitLimiter: true, receivedAt: 0 })
    tracker.reset()
    expect(tracker.reading(0)).toMatchObject({ phase: 'approach', sequenceActive: false, stintMarked: false })
  })

  it('accepts a display-switch phase and ignores anything it does not recognise', () => {
    expect(rc04PhaseFromEvent('box')).toBe('box')
    expect(rc04PhaseFromEvent({ phase: 'release' })).toBe('release')
    expect(rc04PhaseFromEvent({ phase: 'burnout' })).toBeNull()
    expect(rc04PhaseFromEvent(undefined)).toBeNull()
    const tracker = new Rc04PitSequenceTracker()
    tracker.setPhase('service', 400)
    expect(tracker.reading(400).phase).toBe('service')
  })
})

describe('RC-04 speed-versus-limit safety bar', () => {
  it('computes the fill arithmetically as speed over full scale', () => {
    // image-qa-v1 residual 1: 52 km/h on a 0-80 scale is exactly 65 % of the track.
    expect(rc04BarFullScaleKmh(60)).toBe(80)
    const model = modelFor(snapshot(), 0, { sequence: sequence() })
    expect(model.speedBar.fill).toBeCloseTo(0.65, 10)
    expect(model.speedBar.limitFraction).toBe(RC04_LIMIT_RULE_FRACTION)
    expect(model.pitSpeed.value).toBe('52')
    expect(model.pitLimit.value).toBe('60')
  })

  it('keeps the limit rule at three quarters of the track for any configured limit', () => {
    for (const limit of [30, 60, 80, 120]) {
      const model = modelFor(snapshot(), 0, { sequence: sequence(), pitLimitKmh: limit })
      expect(model.speedBar.limitFraction).toBe(0.75)
      expect(model.speedBar.fullScaleKmh).toBeCloseTo(limit / 0.75, 10)
    }
  })

  it('clamps the fill instead of overflowing the track', () => {
    const model = modelFor(snapshot({ speedKmh: 400 }), 0, { sequence: sequence() })
    expect(model.speedBar.fill).toBe(1)
  })

  it('is green strictly under the limit, amber near it and red strictly over it', () => {
    expect(modelFor(snapshot({ speedKmh: 40 }), 0, { sequence: sequence() }).speedBar.tone).toBe('normal')
    expect(
      modelFor(snapshot({ speedKmh: RC04_DEFAULT_PIT_LIMIT_KMH - RC04_NEAR_LIMIT_MARGIN_KMH }), 0, {
        sequence: sequence()
      }).speedBar.tone
    ).toBe('caution')
    expect(modelFor(snapshot({ speedKmh: 60 }), 0, { sequence: sequence() }).speedBar.tone).toBe('caution')
    expect(modelFor(snapshot({ speedKmh: 61 }), 0, { sequence: sequence() }).speedBar.tone).toBe('danger')
  })

  it('never assumes safe when the speed source is stale: it goes unknown, not green', () => {
    const stale = modelFor(snapshot(), 5_000, { sequence: sequence() }, 0)
    expect(stale.pitSpeed).toMatchObject({ value: '--', unavailable: true })
    expect(stale.speedBar.tone).toBe('unknown')
    expect(stale.speedBar.unavailable).toBe(true)
    expect(stale.speedBar.fill).toBe(0)
  })

  it('clamps a nonsensical configured limit into the app-supported range', () => {
    expect(rc04ResolvePitLimitKmh(undefined)).toBe(60)
    expect(rc04ResolvePitLimitKmh(5)).toBe(20)
    expect(rc04ResolvePitLimitKmh(400)).toBe(120)
  })
})

describe('RC-04 telemetry truth table', () => {
  it('renders every packet dash state when no channel is available at all', () => {
    const model = modelFor(null)
    expect(model.pitSpeed).toMatchObject({ value: '--', unavailable: true })
    expect(model.limiter).toMatchObject({ label: '--', unavailable: true })
    expect(model.gear).toMatchObject({ value: '-', unavailable: true })
    expect(model.fuel).toMatchObject({ value: '--', unavailable: true })
    expect(model.stint).toMatchObject({ value: '--:--', unavailable: true })
    expect(model.gridSlot).toMatchObject({ value: '--', unavailable: true })
    expect(model.serviceRemaining).toMatchObject({ value: '--:--', unavailable: true })
    expect(model.proximity).toMatchObject({ value: 'NO DATA', unavailable: true })
    expect(model.fuelTarget).toMatchObject({ value: '--', unavailable: true })
    for (const corner of model.crew) expect(corner).toMatchObject({ value: '--', unavailable: true })
  })

  it('emits the exact two-character dash for an unavailable grid slot', () => {
    // image-qa-v1 residual 3: the reference letter-spaces it; the widget must not.
    const model = modelFor(snapshot(), 0, { sequence: sequence() })
    expect(model.gridSlot.value).toBe('--')
    expect(model.gridSlot.value).toHaveLength(2)
  })

  it('publishes a grid slot only inside a real start sequence', () => {
    const racing = modelFor(snapshot({ sessionState: 'racing', position: 7 }), 0, { sequence: sequence() })
    expect(racing.gridSlot).toMatchObject({ value: '--', unavailable: true })
    const grid = modelFor(snapshot({ sessionState: 'paradeLaps', position: 7 }), 0, { sequence: sequence() })
    expect(grid.gridSlot).toMatchObject({ value: '7', unavailable: false })
  })

  it('never derives the gear from RPM or speed and greys a missing channel', () => {
    expect(rc04DisplayGear(2)).toBe('2')
    expect(rc04DisplayGear(0)).toBe('N')
    expect(rc04DisplayGear(-1)).toBe('R')
    expect(rc04DisplayGear(null)).toBe('-')
    const missing = modelFor(snapshot({ gear: undefined, rpm: 8_000, speedKmh: 52 }), 0, { sequence: sequence() })
    expect(missing.gear).toMatchObject({ value: '-', unavailable: true, tone: 'muted' })
  })

  it('dashes fuel until the tank model is calibrated', () => {
    expect(modelFor(snapshot(), 0, { sequence: sequence() }).fuel.value).toBe('68')
    const uncalibrated = modelFor(snapshot({ fuelCapacityLiters: undefined }), 0, { sequence: sequence() })
    expect(uncalibrated.fuel).toMatchObject({ value: '--', unavailable: true })
  })

  it('hides the limiter state rather than assuming it when the ECU channel is absent', () => {
    const absent = modelFor(snapshot({ pitLimiter: undefined }), 0, { sequence: sequence() })
    expect(absent.limiter).toMatchObject({ value: null, unavailable: true, label: '--' })
    const off = modelFor(snapshot({ pitLimiter: false }), 0, { sequence: sequence() })
    expect(off.limiter).toMatchObject({ value: false, unavailable: false, label: 'OFF' })
  })

  it('requires an explicit marker before it shows a stint time', () => {
    expect(rc04FormatClock(2_058_000)).toBe('34:18')
    expect(rc04FormatClock(null)).toBe('--:--')
    expect(rc04FormatClock(Number.NaN)).toBe('--:--')
    const unmarked = modelFor(snapshot(), 0, { sequence: sequence({ stintElapsedMs: null }) })
    expect(unmarked.stint).toMatchObject({ value: '--:--', unavailable: true })
    expect(modelFor(snapshot(), 0, { sequence: sequence() }).stint.value).toBe('34:18')
  })

  it('reports NO DATA rather than guessing a neighbouring car', () => {
    expect(modelFor(snapshot(), 0, { sequence: sequence() }).proximity.value).toBe('NO DATA')
    const clear = modelFor(snapshot({ carLeftRight: 'clear' }), 0, { sequence: sequence() })
    expect(clear.proximity).toMatchObject({ value: 'CLEAR', unavailable: false, tone: 'good' })
    const left = modelFor(snapshot({ carLeftRight: 'left' }), 0, { sequence: sequence() })
    expect(left.proximity).toMatchObject({ value: 'LEFT', tone: 'bad' })
  })

  it('keeps every crew corner independent and never mirrors one onto another', () => {
    const model = modelFor(snapshot({ pitServiceFlags: ['fuel', 'lf', 'rr'] }), 0, { sequence: sequence() })
    expect(model.crew.map((corner) => `${corner.corner}:${corner.value}`)).toEqual([
      'LF:SET',
      'RF:NO',
      'LR:NO',
      'RR:SET'
    ])
    expect(model.tyresChanged.value).toBe('2/4')
  })

  it('dashes every crew corner when the provider publishes no service flags', () => {
    const model = modelFor(snapshot(), 0, { sequence: sequence() })
    for (const corner of model.crew) expect(corner).toMatchObject({ value: '--', unavailable: true })
    expect(model.tyresChanged).toMatchObject({ value: '--', unavailable: true })
  })

  it('surfaces a service countdown only from a real remaining-work channel', () => {
    expect(modelFor(snapshot(), 0, { sequence: sequence() }).serviceRemaining.value).toBe('--:--')
    const timed = modelFor(snapshot({ repairTimeSec: 26 }), 0, { sequence: sequence() })
    expect(timed.serviceRemaining).toMatchObject({ value: '00:26', unavailable: false })
  })

  it('degrades every channel to its dash state once its own budget has expired', () => {
    // Receipts taken at t=0 and read 60 s later: every RC-04 channel is long stale.
    const stale = modelFor(snapshot({ carLeftRight: 'clear', pitServiceFlags: ['lf'] }), 60_000, {}, 0)
    expect(stale.pitSpeed.unavailable).toBe(true)
    expect(stale.gear.unavailable).toBe(true)
    expect(stale.fuel.unavailable).toBe(true)
    expect(stale.proximity.unavailable).toBe(true)
    expect(stale.limiter.unavailable || stale.limiter.stale).toBe(true)
    for (const corner of stale.crew) expect(corner.unavailable).toBe(true)
  })

  it('omits tyre temperature, water temperature and delta to best: they have no zone', () => {
    const model = modelFor(snapshot({ waterTempC: 92, deltaToBestSec: -0.2 }), 0, { sequence: sequence() })
    expect('tyres' in model).toBe(false)
    expect('waterTemp' in model).toBe(false)
    expect('delta' in model).toBe(false)
    expect(JSON.stringify(model)).not.toContain('-0.2')
  })

  it('reads the pit service state only from channels the provider actually publishes', () => {
    expect(rc04ServiceActive(snapshot())).toBeNull()
    expect(rc04ServiceActive(snapshot({ pitStopActive: false }))).toBe(false)
    expect(rc04ServiceActive(snapshot({ pitServiceFlags: ['fuel'] }))).toBe(true)
    expect(rc04ServiceActive(snapshot({ refuelServiceActive: true }))).toBe(true)
    expect(rc04ServiceActive(null)).toBeNull()
  })
})

describe('RC-04 trigger-only alerts', () => {
  it('starts silent', () => {
    const state = createRc04AlertState()
    expect(state.overspeed.active).toBe(false)
    expect(state.limiterMismatch.active).toBe(false)
    expect(state.unsafeRelease.active).toBe(false)
    expect(rc04AlarmLines(state)).toEqual([])
  })

  it('arms the overspeed alert only in the LIMITER phase', () => {
    let state = createRc04AlertState()
    for (const phase of ['approach', 'box', 'service', 'release'] as const) {
      state = advanceRc04Alerts(createRc04AlertState(), alertInput({ phase, pitSpeedKmh: 90, nowMs: 0 }))
      state = advanceRc04Alerts(state, alertInput({ phase, pitSpeedKmh: 90, nowMs: 5_000 }))
      expect(state.overspeed.active).toBe(false)
    }
  })

  it('engages the overspeed alert after the 100 ms debounce, not before', () => {
    let state = advanceRc04Alerts(createRc04AlertState(), alertInput({ pitSpeedKmh: 72, nowMs: 0 }))
    expect(state.overspeed.active).toBe(false)
    state = advanceRc04Alerts(state, alertInput({ pitSpeedKmh: 72, nowMs: RC04_OVERSPEED_ENGAGE_MS - 1 }))
    expect(state.overspeed.active).toBe(false)
    state = advanceRc04Alerts(state, alertInput({ pitSpeedKmh: 72, nowMs: RC04_OVERSPEED_ENGAGE_MS }))
    expect(state.overspeed.active).toBe(true)
    expect(rc04AlarmLines(state)).toContain('PIT OVERSPEED')
  })

  it('holds the overspeed alert until speed is below limit-2 for the release window', () => {
    let state = advanceRc04Alerts(createRc04AlertState(), alertInput({ pitSpeedKmh: 72, nowMs: 0 }))
    state = advanceRc04Alerts(state, alertInput({ pitSpeedKmh: 72, nowMs: 100 }))
    expect(state.overspeed.active).toBe(true)

    // Merely dropping under the limit is not the clear condition; it must go below limit-2.
    state = advanceRc04Alerts(state, alertInput({ pitSpeedKmh: RC04_DEFAULT_PIT_LIMIT_KMH - 1, nowMs: 2_000 }))
    expect(state.overspeed.active).toBe(true)

    const clear = RC04_DEFAULT_PIT_LIMIT_KMH - RC04_OVERSPEED_CLEAR_MARGIN_KMH - 1
    state = advanceRc04Alerts(state, alertInput({ pitSpeedKmh: clear, nowMs: 3_000 }))
    expect(state.overspeed.active).toBe(true)
    state = advanceRc04Alerts(state, alertInput({ pitSpeedKmh: clear, nowMs: 3_000 + RC04_OVERSPEED_RELEASE_MS - 1 }))
    expect(state.overspeed.active).toBe(true)
    state = advanceRc04Alerts(state, alertInput({ pitSpeedKmh: clear, nowMs: 3_000 + RC04_OVERSPEED_RELEASE_MS }))
    expect(state.overspeed.active).toBe(false)
  })

  it('unlatches the overspeed alert the moment the speed source goes missing', () => {
    let state = advanceRc04Alerts(createRc04AlertState(), alertInput({ pitSpeedKmh: 72, nowMs: 0 }))
    state = advanceRc04Alerts(state, alertInput({ pitSpeedKmh: 72, nowMs: 100 }))
    expect(state.overspeed.active).toBe(true)
    state = advanceRc04Alerts(state, alertInput({ pitSpeedKmh: null, nowMs: 150 }))
    expect(state.overspeed.active).toBe(false)
  })

  it('engages the limiter mismatch after 300 ms and clears the instant the limiter engages', () => {
    let state = advanceRc04Alerts(createRc04AlertState(), alertInput({ limiter: false, nowMs: 0 }))
    expect(state.limiterMismatch.active).toBe(false)
    state = advanceRc04Alerts(state, alertInput({ limiter: false, nowMs: RC04_LIMITER_MISMATCH_ENGAGE_MS - 1 }))
    expect(state.limiterMismatch.active).toBe(false)
    state = advanceRc04Alerts(state, alertInput({ limiter: false, nowMs: RC04_LIMITER_MISMATCH_ENGAGE_MS }))
    expect(state.limiterMismatch.active).toBe(true)
    // One pulse per engage, never a repeating strobe.
    expect(state.limiterMismatch.pulseSeq).toBe(1)

    state = advanceRc04Alerts(state, alertInput({ limiter: true, nowMs: 500 }))
    expect(state.limiterMismatch.active).toBe(false)
    expect(state.limiterMismatch.pulseSeq).toBe(1)
  })

  it('never raises a limiter mismatch from an absent limiter channel', () => {
    let state = createRc04AlertState()
    for (const nowMs of [0, 500, 5_000]) {
      state = advanceRc04Alerts(state, alertInput({ limiter: null, nowMs }))
    }
    expect(state.limiterMismatch.active).toBe(false)
  })

  it('holds the unsafe-release block for its minimum display time and clears with the hazard', () => {
    let state = advanceRc04Alerts(
      createRc04AlertState(),
      alertInput({ phase: 'release', proximity: 'left', nowMs: 0 })
    )
    expect(state.unsafeRelease.active).toBe(true)
    state = advanceRc04Alerts(state, alertInput({ phase: 'release', proximity: 'clear', nowMs: 100 }))
    expect(state.unsafeRelease.active).toBe(true)
    state = advanceRc04Alerts(
      state,
      alertInput({ phase: 'release', proximity: 'clear', nowMs: RC04_UNSAFE_RELEASE_MIN_VISIBLE_MS })
    )
    expect(state.unsafeRelease.active).toBe(false)
  })

  it('arms the unsafe-release alert only in the RELEASE phase and only with a real channel', () => {
    const wrongPhase = advanceRc04Alerts(createRc04AlertState(), alertInput({ phase: 'box', proximity: 'both' }))
    expect(wrongPhase.unsafeRelease.active).toBe(false)
    const noChannel = advanceRc04Alerts(createRc04AlertState(), alertInput({ phase: 'release', proximity: null }))
    expect(noChannel.unsafeRelease.active).toBe(false)
  })

  it('silences the alarm line on acknowledgement without clearing the escalation', () => {
    let state = advanceRc04Alerts(createRc04AlertState(), alertInput({ pitSpeedKmh: 72, nowMs: 0 }))
    state = advanceRc04Alerts(state, alertInput({ pitSpeedKmh: 72, nowMs: 100 }))
    // The minimum display time has to elapse before an alarm can be acknowledged at all.
    const tooEarly = acknowledgeRc04Alarms(state, 200)
    expect(tooEarly.overspeed.acknowledged).toBe(false)
    const acked = acknowledgeRc04Alarms(state, 100 + RC04_ALARM_MIN_VISIBLE_MS)
    expect(acked.overspeed.acknowledged).toBe(true)
    expect(acked.overspeed.active).toBe(true)
    expect(rc04AlarmLines(acked)).toEqual([])
  })

  it('drops every latched alert when the model says the input is no longer usable', () => {
    const latched = {
      ...createRc04AlertState(),
      overspeed: {
        active: true,
        pendingSinceMs: null,
        recoverySinceMs: null,
        visibleSinceMs: 0,
        acknowledged: false
      },
      limiterMismatch: { active: true, pendingSinceMs: null, visibleSinceMs: 0, pulseSeq: 1, acknowledged: false },
      unsafeRelease: { active: true, minimumVisibleUntilMs: 0 }
    }
    const stale = modelFor(snapshot(), 60_000, { sequence: sequence() }, 0)
    const cleared = clearInvalidRc04Alerts(latched, stale)
    expect(cleared.overspeed.active).toBe(false)
    expect(cleared.limiterMismatch.active).toBe(false)
    expect(cleared.unsafeRelease.active).toBe(false)
  })

  it('gives every phase its own imperative and lets the alert layer override it', () => {
    const quiet = createRc04AlertState()
    expect(rc04ActionLine('approach', quiet).text).toBe('PIT ENTRY - LIFT')
    expect(rc04ActionLine('limiter', quiet).text).toBe('HOLD LIMITER')
    expect(rc04ActionLine('box', quiet).text).toBe('STOP IN BOX')
    expect(rc04ActionLine('service', quiet).text).toBe('HOLD BRAKE')
    expect(rc04ActionLine('release', quiet).text).toBe('RELEASE WHEN CLEAR')
    expect(rc04ActionLine('release', quiet, true).text).toBe('GO - LANE CLEAR')

    const overspeed = { ...quiet, overspeed: { ...quiet.overspeed, active: true } }
    expect(rc04ActionLine('limiter', overspeed)).toMatchObject({ text: 'LIFT - PIT LIMIT', tone: 'danger' })
    const mismatch = { ...quiet, limiterMismatch: { ...quiet.limiterMismatch, active: true } }
    expect(rc04ActionLine('limiter', mismatch)).toMatchObject({ text: 'ENGAGE LIMITER', tone: 'danger' })
  })
})

describe('RC-04 responsive contract', () => {
  it('resolves the native, app and compact layouts from the content box', () => {
    expect(rc04LayoutForContentBox(800, 480)).toBe('native')
    expect(rc04LayoutForContentBox(801, 481)).toBe('native')
    expect(rc04LayoutForContentBox(1024, 600)).toBe('app')
    expect(rc04LayoutForContentBox(1440, 900)).toBe('app')
    expect(rc04LayoutForContentBox(393, 759)).toBe('compact')
    expect(rc04LayoutForContentBox(0, 0)).toBe('app')
  })

  it('classifies phone and landscape compact modes', () => {
    expect(rc04CompactModeForContentBox(393, 759)).toBe('phone')
    expect(rc04CompactModeForContentBox(412, 867)).toBe('phone')
    expect(rc04CompactModeForContentBox(759, 393)).toBe('landscape')
    expect(rc04CompactModeForContentBox(867, 412)).toBe('landscape')
    expect(rc04CompactModeForContentBox(640, 520)).toBe('standard')
    expect(rc04CompactModeForContentBox(1024, 600)).toBe('standard')
  })

  it('emits contained portrait geometry only at the phone breakpoint', () => {
    expect(rc04PhoneGeometryForContentBox(1024, 600)).toBeNull()
    for (const [width, height] of [
      [393, 759],
      [412, 867]
    ] as const) {
      const geometry = rc04PhoneGeometryForContentBox(width, height)
      expect(geometry).not.toBeNull()
      // The five procedural zones keep their order and the stack must fit the canvas.
      expect(geometry!.barTop).toBeGreaterThan(geometry!.ribbonTop + geometry!.ribbonHeight)
      expect(geometry!.limiterTop).toBeGreaterThan(geometry!.barTop + geometry!.barHeight)
      expect(geometry!.serviceTop).toBeGreaterThan(geometry!.limiterTop + geometry!.limiterHeight)
      expect(geometry!.actionTop).toBeGreaterThan(geometry!.serviceTop + geometry!.serviceHeight)
      expect(geometry!.actionTop + geometry!.actionHeight).toBeLessThanOrEqual(height)
    }
  })
})

describe('RC-04 rendering', () => {
  it('renders the canonical DOM contract with five steps and one enlarged', () => {
    const html = markup(snapshot())
    assertClean(html)
    expect(html).toContain('data-widget="raceconRc04Dash"')
    expect(html.match(/data-testid="rc04-step"/g) ?? []).toHaveLength(5)
    expect(html.match(/data-active="true"/g) ?? []).toHaveLength(1)
    expect(html.match(/data-testid="rc04-step-caret"/g) ?? []).toHaveLength(1)
    expect(html).toContain('data-testid="rc04-bar-fill"')
    expect(html).toContain('data-testid="rc04-limit-rule"')
    expect(html).toContain('data-testid="rc04-limiter-badge"')
    expect(html).toContain('data-testid="rc04-service-tile"')
    expect(html).toContain('data-testid="rc04-action-line"')
    expect(html).toContain('data-testid="rc04-crew-column"')
    expect(html.match(/data-testid="rc04-crew-corner"/g) ?? []).toHaveLength(4)
  })

  it('never draws a shift LED strip and reports the suppression state', () => {
    const html = markup(snapshot())
    expect(html).not.toContain('rc04-led')
    expect(html).not.toContain('data-testid="rc04-led"')
    // The reference frame is inside the pit sequence, so the LEDs stay suppressed.
    expect(html).toContain('data-rc04-shift-leds="suppressed"')
    // With no telemetry at all no pit context has been observed, so nothing is suppressed.
    expect(markup(null)).toContain('data-rc04-shift-leds="restored"')
  })

  it('keeps every alert silent when nothing has triggered', () => {
    const html = markup(snapshot())
    expect(html).toContain('data-rc04-overspeed="false"')
    expect(html).toContain('data-rc04-limiter-mismatch="false"')
    expect(html).toContain('data-rc04-unsafe-release="false"')
    expect(html).not.toContain('data-testid="rc04-hold-block"')
    expect(html).not.toContain('data-testid="rc04-alarm-line"')
    expect(html).not.toContain('LIFT - PIT LIMIT')
  })

  it('renders a clean, dash-only frame with no telemetry at all', () => {
    const html = markup(null)
    assertClean(html)
    expect(html).not.toContain('data-rc04-buffer-state="accepted"')
    expect(html).toContain('--:--')
    expect(html.match(/data-testid="rc04-crew-corner"/g) ?? []).toHaveLength(4)
    expect(html).toContain('aria-label="LF wheel service unavailable"')
    expect(html.match(/data-testid="rc04-step"/g) ?? []).toHaveLength(5)
    expect(html).toContain('data-rc04-phase="approach"')
  })

  it('refuses mock and replay telemetry and raises no alert from it', () => {
    for (const value of [
      snapshot({ sim: 'mock' } as Partial<TelemetrySnapshot>),
      snapshot({ replayContext: { state: 'replay' } } as unknown as Partial<TelemetrySnapshot>)
    ]) {
      const html = markup(value)
      assertClean(html)
      expect(html).not.toContain('data-rc04-buffer-state="accepted"')
      expect(html).toContain('data-rc04-overspeed="false"')
      expect(html).toContain('data-rc04-phase="approach"')
      // The refused frame must not leak its telemetry into the readouts.
      expect(html).not.toContain('>52<')
    }
  })

  it('marks the native 800x480 contract only at that exact size', () => {
    const native = { ...config, position: { x: 0, y: 0, width: 800, height: 480 } }
    expect(markup(snapshot(), native)).toContain('data-rc04-native-size="800x480"')
    expect(markup(snapshot())).not.toContain('data-rc04-native-size')
  })

  it('exposes the compact mode attribute only in the compact layout', () => {
    const phone = { ...config, position: { x: 0, y: 0, width: 393, height: 759 } }
    expect(markup(snapshot(), phone)).toContain('data-rc04-compact-mode="phone"')
    expect(markup(snapshot())).not.toContain('data-rc04-compact-mode')
  })
})

describe('RC-04 shares the RC-01 fail-closed ingest buffer', () => {
  it('accepts a live identified snapshot and rejects an unidentified one', () => {
    const buffer = new Rc01LiveTelemetryBuffer()
    expect(buffer.ingest(snapshot(), 1_000).accepted).toBe(true)
    const orphan = new Rc01LiveTelemetryBuffer()
    expect(orphan.ingest(snapshot({ sessionUniqueId: undefined, connectionEpoch: undefined }), 1_000).accepted).toBe(
      false
    )
  })
})

/**
 * The phase machine and the alert surfaces cannot be reached by a single static render:
 * every one of them requires evidence accumulated across frames, which is exactly the
 * packet's point. These drive the real component over a real frame sequence so the phase
 * and alert markup can never become dead code.
 */
describe('RC-04 live pit sequence surfaces', () => {
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
      createElement(RaceconRc04DashWidget, {
        snapshot: snapshot({ onPitRoad: false, pitLimiter: false }, 1_000),
        config,
        monotonicClock
      })
    )
    const push = (atMs: number, overrides: Partial<TelemetrySnapshot>): void => {
      const elapsed = atMs - monotonicMs
      monotonicMs = atMs
      act(() => {
        vi.advanceTimersByTime(elapsed)
      })
      view.rerender(
        createElement(RaceconRc04DashWidget, { snapshot: snapshot(overrides, 1_000 + atMs), config, monotonicClock })
      )
    }
    return { push, root: () => view.container.querySelector<HTMLElement>('.rc04-widget')!, view }
  }

  it('keeps every alert surface absent while nothing has triggered', () => {
    const { root, view } = mount()
    expect(root().dataset.rc04Overspeed).toBe('false')
    expect(root().dataset.rc04LimiterMismatch).toBe('false')
    expect(root().dataset.rc04UnsafeRelease).toBe('false')
    expect(view.container.querySelector('[data-testid="rc04-hold-block"]')).toBeNull()
    expect(view.container.querySelector('[data-testid="rc04-alarm-line"]')).toBeNull()
  })

  it('walks the checklist through every step from observed pit signals', () => {
    const { push, root, view } = mount()
    push(100, { onPitRoad: true, pitLimiter: false })
    expect(root().dataset.rc04Phase).toBe('approach')
    expect(root().dataset.rc04ShiftLeds).toBe('suppressed')

    push(200, { onPitRoad: true, pitLimiter: true })
    expect(root().dataset.rc04Phase).toBe('limiter')

    push(300, inStall())
    expect(root().dataset.rc04Phase).toBe('box')

    push(400, inStall({ pitServiceFlags: ['fuel', 'lf', 'rf'] }))
    expect(root().dataset.rc04Phase).toBe('service')

    push(500, inStall({ pitServiceFlags: [] }))
    expect(root().dataset.rc04Phase).toBe('release')
    // The RELEASE step surfaces the proximity channel, and dashes it honestly when absent.
    expect(view.container.querySelector('[data-testid="rc04-lane"]')?.textContent).toContain('NO DATA')

    // The blend back to the track ends the sequence and returns the shift LEDs.
    push(600, { onPitRoad: false, pitLimiter: false })
    expect(root().dataset.rc04Phase).toBe('approach')
    expect(root().dataset.rc04ShiftLeds).toBe('restored')
  })

  it('raises the overspeed surface only in the limiter phase, after the debounce', () => {
    const { push, root, view } = mount()
    // A realistic 50 ms provider cadence: the 100 ms pit-speed budget stays satisfied.
    push(50, { onPitRoad: true, pitLimiter: false, speedKmh: 80 })
    // APPROACH: the alert is out of scope even though the car is well over the limit.
    expect(root().dataset.rc04Phase).toBe('approach')
    expect(root().dataset.rc04Overspeed).toBe('false')

    push(100, { onPitRoad: true, pitLimiter: true, speedKmh: 80 })
    expect(root().dataset.rc04Phase).toBe('limiter')
    expect(root().dataset.rc04Overspeed).toBe('false')

    push(150, { onPitRoad: true, pitLimiter: true, speedKmh: 80 })
    push(200, { onPitRoad: true, pitLimiter: true, speedKmh: 80 })
    expect(root().dataset.rc04Overspeed).toBe('true')
    expect(view.container.querySelector('[data-testid="rc04-action-text"]')?.textContent).toBe('LIFT - PIT LIMIT')
    expect(view.container.querySelector('[data-testid="rc04-speed-zone"]')?.getAttribute('data-alert')).toBe('true')
    expect(view.container.querySelector('[data-testid="rc04-alarm-line"]')?.textContent).toContain('PIT OVERSPEED')
  })

  it('unlatches the overspeed surface and refuses to look safe when speed goes stale', () => {
    const { push, root, view } = mount()
    push(50, { onPitRoad: true, pitLimiter: true, speedKmh: 80 })
    push(100, { onPitRoad: true, pitLimiter: true, speedKmh: 80 })
    push(150, { onPitRoad: true, pitLimiter: true, speedKmh: 80 })
    push(200, { onPitRoad: true, pitLimiter: true, speedKmh: 80 })
    expect(root().dataset.rc04Overspeed).toBe('true')

    push(250, { onPitRoad: true, pitLimiter: true, speedKmh: undefined })
    expect(root().dataset.rc04Overspeed).toBe('false')
    const zone = view.container.querySelector('[data-testid="rc04-speed-zone"]')
    expect(zone?.getAttribute('data-tone')).toBe('unknown')
    expect(zone?.getAttribute('data-unavailable')).toBe('true')
  })

  it('raises the limiter mismatch after 300 ms and clears it when the limiter engages', () => {
    const { push, root, view } = mount()
    push(50, { onPitRoad: true, pitLimiter: false, speedKmh: 40 })
    expect(root().dataset.rc04Phase).toBe('approach')

    // A display-switch event puts the checklist on LIMITER without a limiter engage.
    act(() => {
      window.dispatchEvent(new CustomEvent(RC04_PHASE_EVENT, { detail: { phase: 'limiter' } }))
    })
    push(100, { onPitRoad: true, pitLimiter: false, speedKmh: 40 })
    expect(root().dataset.rc04Phase).toBe('limiter')
    expect(root().dataset.rc04LimiterMismatch).toBe('false')

    for (let atMs = 150; atMs <= 400; atMs += 50) {
      push(atMs, { onPitRoad: true, pitLimiter: false, speedKmh: 40 })
    }
    expect(root().dataset.rc04LimiterMismatch).toBe('true')
    expect(view.container.querySelector('[data-testid="rc04-limiter-badge"]')?.getAttribute('data-mismatch')).toBe(
      'true'
    )
    expect(view.container.querySelector('[data-testid="rc04-action-text"]')?.textContent).toBe('ENGAGE LIMITER')

    push(450, { onPitRoad: true, pitLimiter: true, speedKmh: 40 })
    expect(root().dataset.rc04LimiterMismatch).toBe('false')
  })

  it('greys the limiter badge instead of claiming a state when the channel is absent', () => {
    const { push, root, view } = mount()
    push(100, { onPitRoad: true, pitLimiter: undefined })
    expect(view.container.querySelector('[data-testid="rc04-limiter-badge"]')?.getAttribute('data-state')).toBe(
      'unknown'
    )
    expect(root().dataset.rc04LimiterMismatch).toBe('false')
  })

  it('blocks release with an orange HOLD over the action line while a hazard is present', () => {
    const { push, root, view } = mount()
    push(100, { onPitRoad: true, pitLimiter: true })
    push(200, inStall())
    push(300, inStall({ pitStopActive: true }))
    push(400, inStall({ pitStopActive: false, carLeftRight: 'left' }))
    expect(root().dataset.rc04Phase).toBe('release')
    expect(root().dataset.rc04UnsafeRelease).toBe('true')
    expect(view.container.querySelector('[data-testid="rc04-hold-block"]')?.textContent).toContain('HOLD')
    // The macro cannot acknowledge a release while the inhibitor is live.
    expect(view.container.querySelector<HTMLButtonElement>('[data-testid="rc04-macro"]')?.disabled).toBe(true)

    push(1_000, inStall({ pitStopActive: false, carLeftRight: 'clear' }))
    expect(root().dataset.rc04UnsafeRelease).toBe('false')
    const macro = view.container.querySelector<HTMLButtonElement>('[data-testid="rc04-macro"]')
    expect(macro?.disabled).toBe(false)
    act(() => {
      fireEvent.click(macro!)
    })
    expect(view.container.querySelector('[data-testid="rc04-action-text"]')?.textContent).toBe('GO - LANE CLEAR')
  })

  it('starts the stint clock only at an observed pit exit', () => {
    const { push, view } = mount()
    push(100, { onPitRoad: true })
    expect(view.getByLabelText('Stint timer unavailable')).toBeTruthy()
    push(200, { onPitRoad: false })
    expect(view.getByLabelText('Stint timer 00:00')).toBeTruthy()
  })
})
