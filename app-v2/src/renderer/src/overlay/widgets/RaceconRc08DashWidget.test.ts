// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOverlayStyle, type OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { OVERLAY_DASHBOARD_PRESETS } from '../../../../shared/dashboards'
import { WIDGET_COMPONENTS } from './index'
import { RaceconRc08DashWidget } from './RaceconRc08DashWidget'
import { Rc01LiveTelemetryBuffer, createRc01ChannelReceipts } from './raceconRc01Core'
import {
  RC08_AIDS_FAULT_MIN_VISIBLE_MS,
  RC08_APP_COLUMN_SPAN,
  RC08_APP_COLUMN_WEIGHTS,
  RC08_CHANNEL_STALE_MS,
  RC08_COLD_TYRE_ENGAGE_MS,
  RC08_COLD_TYRE_GRIP_STATES,
  RC08_CORNERS,
  RC08_CORNER_CHANNELS,
  RC08_GRIP_DROP_ENGAGE_MS,
  RC08_GRIP_DROP_HYSTERESIS_MS,
  RC08_GRIP_HISTORY_LIMIT,
  RC08_GRIP_HISTORY_WINDOW_MS,
  RC08_GRIP_HUES,
  RC08_GRIP_STATES,
  RC08_GRIP_STATE_BANDS,
  RC08_GRIP_TOGGLE_EVENT,
  RC08_GRIP_UNAVAILABLE,
  RC08_NATIVE_COLUMN_SPAN,
  RC08_NATIVE_COLUMN_WEIGHTS,
  RC08_PACKET_OMISSIONS,
  RC08_RIBBON_HEIGHT_PCT,
  RC08_SPEED_DASH_MS,
  RC08_TOKENS,
  RC08_TYPE_SCALE_PX,
  RC08_TYPE_WEIGHTS,
  RC08_WET_WINDOW_C,
  type Rc08AlertInput,
  Rc08GripHistory,
  type Rc08GripState,
  type Rc08Rect,
  type Rc08ZoneMap,
  advanceRc08Alerts,
  clearInvalidRc08Alerts,
  createRc08AlertState,
  createRc08AuxReceipts,
  createRc08DashboardModel,
  rc08AidFaulted,
  rc08AlertInputForModel,
  rc08AlertLines,
  rc08AuxChannelValue,
  rc08ColumnScale,
  rc08ColumnWeights,
  rc08CompactModeForContentBox,
  rc08CrossoverFor,
  rc08DisplayGear,
  rc08GripRank,
  rc08GripStateForWetness,
  rc08GripStateFromEvent,
  rc08LayoutForContentBox,
  rc08NestedRect,
  rc08Percent,
  rc08PhoneGeometryForContentBox,
  rc08TimelineSegments,
  rc08TypeScaleCqw,
  rc08ZoneStyle,
  rc08ZonesForLayout
} from './raceconRc08Core'

const config: OverlayWidgetConfig = {
  id: 'raceconRc08Dash',
  enabled: true,
  locked: true,
  favorite: false,
  position: { x: 0, y: 0, width: 1024, height: 600 },
  opacity: 100,
  stylePreset: 'minimal',
  style: createDefaultOverlayStyle(),
  display: null
}

const nativeConfig: OverlayWidgetConfig = {
  ...config,
  position: { x: 0, y: 0, width: 800, height: 480 }
}

/**
 * The approved RC-08 reference state (attempt-004 governed 800x480,
 * `input/telemetry-frame-wet-lap14.json`): a wet lap 14 on a track with NO weather feed at all.
 * The grip state is the driver's own WET assertion, the weather banner says UNAVAILABLE, the
 * rain-rate row says UNAVAILABLE, three tyre corners report and the right rear does not, and
 * all three packet section 15 alerts are ARMED and SILENT.
 *
 * `trackWetnessPct` is deliberately absent: that IS the reference frame's condition, and it is
 * why the banner and the rain row both carry the honesty word.
 */
function snapshot(overrides: Partial<TelemetrySnapshot> = {}, timestamp = 5_080_000): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp,
    sessionUniqueId: 88,
    speedKmh: 128,
    gear: 3,
    throttle: 0.34,
    brake: 0,
    clutch: 0,
    sessionType: 'Race',
    sessionState: 'racing',
    currentLap: 14,
    position: 9,
    playerCarIdx: 4,
    tcLevel: 6,
    absLevel: 4,
    brakeBiasPct: 54.5,
    deltaToBestSec: 2.418,
    bestLapTimeSec: 105.204,
    tyres: {
      lf: { tempC: 63 },
      rf: { tempC: 61 },
      lr: { tempC: 58 },
      rr: {}
    },
    ...overrides
  } as TelemetrySnapshot
}

/** The same frame with a live track-condition feed, so the grip state comes from the sensor. */
function sensorSnapshot(wetnessPct = 0.52, overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return snapshot({ trackWetnessPct: wetnessPct, ...overrides })
}

function markup(value: TelemetrySnapshot | null, cfg = config): string {
  return renderToStaticMarkup(createElement(RaceconRc08DashWidget, { snapshot: value, config: cfg }))
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
  options: Parameters<typeof createRc08DashboardModel>[4] = {},
  receiptsAtMs = nowMs
): ReturnType<typeof createRc08DashboardModel> {
  const receipts = value ? createRc01ChannelReceipts(value, receiptsAtMs) : new Map()
  const aux = value ? createRc08AuxReceipts(value, receiptsAtMs) : new Map()
  return createRc08DashboardModel(value, receipts, aux, nowMs, options)
}

function alertInput(overrides: Partial<Rc08AlertInput> = {}): Rc08AlertInput {
  return {
    nowMs: 0,
    gripRank: null,
    coldCorners: [],
    wetRegime: false,
    faultedAids: [],
    ...overrides
  }
}

function right(rect: Rc08Rect): number {
  return rect.left + rect.width
}

function bottom(rect: Rc08Rect): number {
  return rect.top + rect.height
}

function overlaps(a: Rc08Rect, b: Rc08Rect): boolean {
  return a.left < right(b) && right(a) > b.left && a.top < bottom(b) && bottom(a) > b.top
}

/** The nested packet zones, which are contained in a parent rather than disjoint from it. */
const NESTED_ZONES = ['ribbon', 'crossover'] as const

function topLevelZones(zones: Rc08ZoneMap): Rc08Rect[] {
  return Object.entries(zones)
    .filter(([id]) => !(NESTED_ZONES as readonly string[]).includes(id))
    .map(([, rect]) => rect)
    .filter((rect): rect is Rc08Rect => Boolean(rect))
}

function allZones(zones: Rc08ZoneMap): Rc08Rect[] {
  return Object.values(zones).filter((rect): rect is Rc08Rect => Boolean(rect))
}

const REGIMES: readonly (Rc08GripState | null)[] = [...RC08_GRIP_STATES, null]

const BREAKPOINTS: readonly { width: number; height: number }[] = [
  { width: 800, height: 480 },
  { width: 1024, height: 600 },
  { width: 1920, height: 1080 },
  { width: 400, height: 800 },
  { width: 900, height: 400 },
  { width: 640, height: 520 }
]

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('RC-08 registration and preset wiring', () => {
  it('registers the widget component under its canonical id', () => {
    expect(WIDGET_COMPONENTS.raceconRc08Dash).toBe(RaceconRc08DashWidget)
  })

  it('declares exactly one RC-08 full-frame preset directly after RC-07', () => {
    const ids = OVERLAY_DASHBOARD_PRESETS.map((entry) => entry.id)
    expect(ids.filter((id) => id === 'racecon_rc08_dash')).toHaveLength(1)
    expect(ids.indexOf('racecon_rc08_dash')).toBe(ids.indexOf('racecon_rc07_dash') + 1)
    const preset = OVERLAY_DASHBOARD_PRESETS.find((entry) => entry.id === 'racecon_rc08_dash')
    expect(preset?.widgetId).toBe('raceconRc08Dash')
    expect(preset?.name).toBe('RaceCon RC-08 Rain Line')
    expect(preset?.scaleMode).toBe('stretch')
  })
})

describe('RC-08 grip state is bound to a real source, never inferred', () => {
  it('quantises the measured wetness fraction into the packet enum and nothing else', () => {
    expect(rc08GripStateForWetness(0)).toBe('DRY')
    expect(rc08GripStateForWetness(0.09)).toBe('DRY')
    expect(rc08GripStateForWetness(0.1)).toBe('DAMP')
    expect(rc08GripStateForWetness(0.34)).toBe('DAMP')
    expect(rc08GripStateForWetness(0.35)).toBe('WET')
    expect(rc08GripStateForWetness(0.74)).toBe('WET')
    expect(rc08GripStateForWetness(0.75)).toBe('FLOOD')
    expect(rc08GripStateForWetness(1)).toBe('FLOOD')
  })

  it('refuses to name a grip state without a measurement', () => {
    expect(rc08GripStateForWetness(null)).toBeNull()
    expect(rc08GripStateForWetness(Number.NaN)).toBeNull()
    expect(rc08GripStateForWetness(-0.2)).toBeNull()
  })

  it('covers the whole 0..1 range with contiguous, non-overlapping bands', () => {
    let cursor = 0
    for (const state of RC08_GRIP_STATES) {
      const [low, high] = RC08_GRIP_STATE_BANDS[state]
      expect(low).toBe(cursor)
      expect(high).toBeGreaterThan(low)
      cursor = high
    }
    expect(cursor).toBe(Number.POSITIVE_INFINITY)
  })

  it('never infers the grip state from the lap delta, the speed or the gear', () => {
    // A huge positive delta on a bone-dry track must not read as a wetter regime.
    const model = modelFor(sensorSnapshot(0.02, { deltaToBestSec: 9.9, speedKmh: 40, gear: 1 }))
    expect(model.grip.state).toBe('DRY')
    expect(model.grip.source).toBe('sensor')
    // And with no wetness channel at all the display refuses to name a state.
    const blind = modelFor(snapshot({ deltaToBestSec: 9.9 }))
    expect(blind.grip.state).toBeNull()
    expect(blind.grip.label).toBe(RC08_GRIP_UNAVAILABLE)
    expect(blind.grip.source).toBe('none')
  })

  it('accepts the packet 11.5 driver toggle as the second lawful source', () => {
    const model = modelFor(snapshot(), 0, { driverGripState: 'WET' })
    expect(model.grip.state).toBe('WET')
    expect(model.grip.source).toBe('driver')
    expect(model.grip.sourceLabel).toBe('DRIVER TOGGLE')
    // The toggle is an assertion by the driver and outranks the sensor while it is held.
    const overridden = modelFor(sensorSnapshot(0.02), 0, { driverGripState: 'FLOOD' })
    expect(overridden.grip.state).toBe('FLOOD')
    expect(overridden.grip.source).toBe('driver')
  })

  it('accepts only the grip payloads it recognises', () => {
    expect(rc08GripStateFromEvent('WET')).toBe('WET')
    expect(rc08GripStateFromEvent('  flood ')).toBe('FLOOD')
    expect(rc08GripStateFromEvent({ state: 'damp' })).toBe('DAMP')
    expect(rc08GripStateFromEvent('auto')).toBe('auto')
    expect(rc08GripStateFromEvent(null)).toBe('auto')
    expect(rc08GripStateFromEvent('SOAKED')).toBeNull()
    expect(rc08GripStateFromEvent(3)).toBeNull()
    expect(rc08GripStateFromEvent({ level: 'WET' })).toBeNull()
  })

  it('binds one hue to every grip state and reserves caution for the alert layer', () => {
    // A documented packet gap: 11.3 lists the tokens but binds none of them to a grip state.
    expect(RC08_GRIP_HUES).toEqual({
      DRY: RC08_TOKENS.normal,
      DAMP: RC08_TOKENS.info,
      WET: RC08_TOKENS.signature,
      FLOOD: RC08_TOKENS.danger
    })
    expect(Object.values(RC08_GRIP_HUES)).not.toContain(RC08_TOKENS.caution)
    for (const state of RC08_GRIP_STATES) {
      // Packet 19: the word is always present, so the hue is never the only channel.
      expect(state).toMatch(/^[A-Z]+$/)
      expect(RC08_GRIP_HUES[state]).toMatch(/^#[0-9A-F]{6}$/)
    }
  })

  it('greys a stale sensor state and dashes one that never reported', () => {
    const value = sensorSnapshot(0.52)
    const stale = modelFor(value, RC08_CHANNEL_STALE_MS.grip + 1, {}, 0)
    expect(stale.grip.state).toBe('WET')
    expect(stale.grip.stale).toBe(true)
    // A stale grip state can no longer justify a regime, so the columns go equal.
    expect(stale.regime).toBeNull()
    expect(stale.weatherFeed.available).toBe(false)

    const missing = modelFor(snapshot())
    expect(missing.grip.unavailable).toBe(true)
    expect(missing.grip.stale).toBe(false)
    expect(missing.regime).toBeNull()
  })
})

describe('RC-08 adaptive columns encode the regime', () => {
  it('reproduces packet 11.1 exactly at the wet regime', () => {
    const zones = rc08ZonesForLayout('native', 'standard', 'WET')
    expect(zones.banner).toEqual({ left: 2.0, top: 2.1, width: 96.0, height: 6.2 })
    expect(zones.aids).toEqual({ left: 2.0, top: 10.4, width: 37.5, height: 85.4 })
    expect(zones.pace).toEqual({ left: 41.5, top: 10.4, width: 23.8, height: 85.4 })
    expect(zones.tire).toEqual({ left: 67.2, top: 10.4, width: 30.8, height: 85.4 })
    expect(zones.ribbon).toEqual({ left: 2.0, top: 10.4, width: 37.5, height: RC08_RIBBON_HEIGHT_PCT })
  })

  it('reproduces packet 12.1 exactly at the wet regime and reveals both app modules', () => {
    const zones = rc08ZonesForLayout('app', 'standard', 'WET')
    expect(zones.banner).toEqual({ left: 0, top: 0, width: 100, height: 6.0 })
    expect(zones.aids).toEqual({ left: 2.3, top: 8.0, width: 35.2, height: 84.0 })
    expect(zones.pace).toEqual({ left: 39.8, top: 8.0, width: 23.4, height: 84.0 })
    expect(zones.tire).toEqual({ left: 65.6, top: 8.0, width: 32.0, height: 50.0 })
    expect(zones.timeline).toEqual({ left: 65.6, top: 60.7, width: 32.0, height: 31.3 })
    expect(zones.crossover).toBeTruthy()
  })

  it('makes the aids column widest and the pace column narrowest in the wet', () => {
    for (const layout of ['native', 'app'] as const) {
      const wet = rc08ColumnWeights(layout, 'WET')
      expect(wet.aids).toBeGreaterThan(wet.pace)
      expect(wet.aids).toBeGreaterThan(wet.tire)
      expect(wet.tire).toBeGreaterThan(wet.pace)
    }
  })

  it('returns the pace column as the track dries', () => {
    for (const layout of ['native', 'app'] as const) {
      const dry = rc08ColumnWeights(layout, 'DRY')
      expect(dry.pace).toBeGreaterThan(dry.aids)
    }
  })

  it('widens the aids column monotonically with wetness and narrows the pace column', () => {
    for (const table of [RC08_NATIVE_COLUMN_WEIGHTS, RC08_APP_COLUMN_WEIGHTS]) {
      for (let index = 1; index < RC08_GRIP_STATES.length; index += 1) {
        const drier = table[RC08_GRIP_STATES[index - 1]]
        const wetter = table[RC08_GRIP_STATES[index]]
        expect(wetter.aids).toBeGreaterThan(drier.aids)
        expect(wetter.pace).toBeLessThan(drier.pace)
      }
    }
  })

  it('states an unconfirmed regime as three EQUAL columns rather than implying one', () => {
    const native = rc08ColumnWeights('native', null)
    expect(native.aids).toBe(native.pace)
    expect(native.pace).toBe(native.tire)
    const app = rc08ColumnWeights('app', null)
    expect(app.aids).toBe(app.pace)
    expect(app.pace).toBe(app.tire)
  })

  it('conserves the total column span in every regime, so the reflow is a reweighting', () => {
    for (const regime of REGIMES) {
      const native = rc08ColumnWeights('native', regime)
      expect(native.aids + native.pace + native.tire).toBeCloseTo(RC08_NATIVE_COLUMN_SPAN, 6)
      const app = rc08ColumnWeights('app', regime)
      expect(app.aids + app.pace + app.tire).toBeCloseTo(RC08_APP_COLUMN_SPAN, 6)
    }
  })

  it('never moves the outer edge of the layout, however the regime reweights it', () => {
    for (const regime of REGIMES) {
      const native = rc08ZonesForLayout('native', 'standard', regime)
      expect(right(native.tire!)).toBeCloseTo(98.0, 6)
      expect(native.aids!.left).toBe(2.0)
      const app = rc08ZonesForLayout('app', 'standard', regime)
      expect(right(app.tire!)).toBeCloseTo(97.6, 6)
      expect(app.aids!.left).toBe(2.3)
    }
  })

  it('scales a narrowed column"s type down and never up, so a hero cannot escape its zone', () => {
    const wet = rc08ColumnScale('native', 'WET')
    expect(wet).toEqual({ aids: 1, pace: 1, tire: 1 })
    const flood = rc08ColumnScale('native', 'FLOOD')
    // FLOOD narrows the pace column, so the delta shrinks with it.
    expect(flood.pace).toBeLessThan(1)
    expect(flood.aids).toBe(1)
    const dry = rc08ColumnScale('native', 'DRY')
    // DRY widens the pace column; the packet's 11.2 size is a ceiling, never a floor.
    expect(dry.pace).toBe(1)
    expect(dry.aids).toBeLessThan(1)
  })
})

describe('RC-08 packet zone geometry', () => {
  it('contains every zone inside the canvas at every breakpoint and every regime', () => {
    for (const regime of REGIMES) {
      for (const size of BREAKPOINTS) {
        const layout = rc08LayoutForContentBox(size.width, size.height)
        const mode = rc08CompactModeForContentBox(size.width, size.height)
        for (const rect of allZones(rc08ZonesForLayout(layout, mode, regime))) {
          expect(rect.left).toBeGreaterThanOrEqual(0)
          expect(rect.top).toBeGreaterThanOrEqual(0)
          expect(right(rect)).toBeLessThanOrEqual(100)
          expect(bottom(rect)).toBeLessThanOrEqual(100)
          expect(rect.width).toBeGreaterThan(0)
          expect(rect.height).toBeGreaterThan(0)
        }
      }
    }
  })

  it('keeps every top-level zone disjoint at every breakpoint and every regime', () => {
    for (const regime of REGIMES) {
      for (const size of BREAKPOINTS) {
        const layout = rc08LayoutForContentBox(size.width, size.height)
        const mode = rc08CompactModeForContentBox(size.width, size.height)
        const rects = topLevelZones(rc08ZonesForLayout(layout, mode, regime))
        for (let a = 0; a < rects.length; a += 1) {
          for (let b = a + 1; b < rects.length; b += 1) {
            expect(
              overlaps(rects[a], rects[b]),
              `${size.width}x${size.height} ${regime ?? 'unknown'} zones ${a}/${b} overlap`
            ).toBe(false)
          }
        }
      }
    }
  })

  it('nests the grip ribbon inside the aids column exactly as packet 11.1 says', () => {
    for (const regime of REGIMES) {
      for (const size of BREAKPOINTS) {
        const layout = rc08LayoutForContentBox(size.width, size.height)
        const mode = rc08CompactModeForContentBox(size.width, size.height)
        const zones = rc08ZonesForLayout(layout, mode, regime)
        const nested = rc08NestedRect(zones.ribbon!, zones.aids!)
        expect(nested.left).toBeCloseTo(0, 6)
        expect(nested.top).toBeCloseTo(0, 6)
        expect(nested.width).toBeCloseTo(100, 6)
        expect(nested.height).toBeGreaterThan(0)
        expect(nested.height).toBeLessThanOrEqual(100)
      }
    }
  })

  it('nests the app-only crossover panel inside the thermal column', () => {
    for (const regime of REGIMES) {
      const zones = rc08ZonesForLayout('app', 'standard', regime)
      const nested = rc08NestedRect(zones.crossover!, zones.tire!)
      expect(nested.left).toBeCloseTo(0, 6)
      expect(nested.width).toBeCloseTo(100, 6)
      expect(bottom(nested)).toBeCloseTo(100, 6)
    }
  })

  it('keeps the alert surfaces present at every breakpoint', () => {
    for (const size of BREAKPOINTS) {
      const layout = rc08LayoutForContentBox(size.width, size.height)
      const mode = rc08CompactModeForContentBox(size.width, size.height)
      const zones = rc08ZonesForLayout(layout, mode, 'WET')
      // grip drop lives on the ribbon and the aids width; cold tyres on the thermal column;
      // aids fault on the aids column. All three exist everywhere.
      expect(zones.ribbon).toBeTruthy()
      expect(zones.aids).toBeTruthy()
      expect(zones.tire).toBeTruthy()
    }
  })

  it('emits the zone rect as inline percentages', () => {
    expect(rc08ZoneStyle({ left: 2, top: 10.4, width: 37.5, height: 85.4 })).toEqual({
      left: '2%',
      top: '10.4%',
      width: '37.5%',
      height: '85.4%'
    })
    expect(rc08ZoneStyle(undefined)).toBeNull()
  })

  it('emits a coordinate as a clean percentage with no float noise', () => {
    expect(rc08Percent(33.333333333)).toBe('33.333%')
    expect(rc08Percent(Number.NaN)).toBe('0%')
  })
})

describe('RC-08 typographic ladder is computed from packet 11.2, not from the render', () => {
  it('holds the packet ladder in strict descending order', () => {
    expect(RC08_TYPE_SCALE_PX.grip).toBe(56)
    expect(RC08_TYPE_SCALE_PX.delta).toBe(52)
    expect(RC08_TYPE_SCALE_PX.aid).toBe(48)
    expect(RC08_TYPE_SCALE_PX.corner).toBe(36)
    expect(RC08_TYPE_SCALE_PX.secondary).toBe(32)
    expect(RC08_TYPE_SCALE_PX.label).toBe(18)
    const ladder = [
      RC08_TYPE_SCALE_PX.grip,
      RC08_TYPE_SCALE_PX.delta,
      RC08_TYPE_SCALE_PX.aid,
      RC08_TYPE_SCALE_PX.corner,
      RC08_TYPE_SCALE_PX.secondary,
      RC08_TYPE_SCALE_PX.label
    ]
    for (let index = 1; index < ladder.length; index += 1) {
      expect(ladder[index]).toBeLessThan(ladder[index - 1])
    }
  })

  it('never copies the approved render"s 28 px delta', () => {
    // image-qa-v1 normative override 1: six attempts could not hold this rung, so the packet
    // wins and the reference pixels are not traced.
    expect(RC08_TYPE_SCALE_PX.delta).not.toBe(28)
    expect(RC08_TYPE_SCALE_PX.delta).toBeGreaterThan(RC08_TYPE_SCALE_PX.aid)
  })

  it('carries packet section 10"s TC/ABS primacy through weight, not through size', () => {
    // Normative override 5: keep 11.2's sizes, carry primacy with weight and position.
    expect(RC08_TYPE_SCALE_PX.aid).toBeLessThan(RC08_TYPE_SCALE_PX.delta)
    expect(RC08_TYPE_WEIGHTS.aid).toBeGreaterThan(RC08_TYPE_WEIGHTS.delta)
    expect(RC08_TYPE_WEIGHTS.grip).toBeGreaterThanOrEqual(RC08_TYPE_WEIGHTS.aid)
  })

  it('converts the px ladder into container units against the native canvas', () => {
    expect(rc08TypeScaleCqw(56)).toBe(7)
    expect(rc08TypeScaleCqw(52)).toBe(6.5)
    expect(rc08TypeScaleCqw(48)).toBe(6)
    expect(rc08TypeScaleCqw(36)).toBe(4.5)
    expect(rc08TypeScaleCqw(32)).toBe(4)
    expect(rc08TypeScaleCqw(18)).toBe(2.25)
  })
})

describe('RC-08 telemetry truth table', () => {
  it('renders the approved reference frame exactly as measured', () => {
    const model = modelFor(snapshot(), 0, { driverGripState: 'WET' })
    expect(model.grip.label).toBe('WET')
    expect(model.grip.sourceLabel).toBe('DRIVER TOGGLE')
    expect(model.weatherFeed.label).toBe('WEATHER FEED UNAVAILABLE')
    expect(model.rainRate.value).toBe('UNAVAILABLE')
    expect(model.tc.field.value).toBe('6')
    expect(model.abs.field.value).toBe('4')
    expect(model.brakeBias.value).toBe('54.5')
    expect(model.gear.value).toBe('3')
    expect(model.delta.value).toBe('+2.418')
    expect(model.speed.value).toBe('128')
    expect(model.corners.map((corner) => corner.field.value)).toEqual(['63', '61', '58', '--'])
    // The whole alert layer is armed and silent in the reference frame.
    expect(rc08AlertLines(model)).toEqual([])
  })

  it('renders every packet dash state when no channel is available at all', () => {
    const model = modelFor(snapshot({
      tcLevel: undefined,
      absLevel: undefined,
      brakeBiasPct: undefined,
      deltaToBestSec: undefined,
      bestLapTimeSec: undefined,
      gear: undefined,
      speedKmh: undefined,
      tyres: undefined
    }))
    expect(model.grip.label).toBe(RC08_GRIP_UNAVAILABLE)
    expect(model.weatherFeed.label).toBe('WEATHER FEED UNAVAILABLE')
    expect(model.rainRate.value).toBe('UNAVAILABLE')
    expect(model.tc.field.value).toBe('--')
    expect(model.abs.field.value).toBe('--')
    expect(model.brakeBias.value).toBe('--')
    expect(model.delta.value).toBe('--.---')
    expect(model.gear.value).toBe('-')
    expect(model.speed.value).toBe('---')
    expect(model.corners.map((corner) => corner.field.value)).toEqual(['--', '--', '--', '--'])
    for (const corner of model.corners) expect(corner.crossover).toBeNull()
  })

  it('states UNAVAILABLE for the rain rate on every frame, because no mm/h channel exists', () => {
    // Section 16 forbids estimating rain from the wiper, and `precipitationPct` is a percentage,
    // not a rate: converting one into the other would be exactly the invention the packet bans.
    const drenched = modelFor(sensorSnapshot(0.95, { precipitationPct: 0.8, isRaining: true }))
    expect(drenched.rainRate.value).toBe('UNAVAILABLE')
    expect(drenched.rainRate.unavailable).toBe(true)
    expect(drenched.rainRate.raw).toBeNull()
  })

  it('holds the last-known aid step greyed when the bus goes quiet, never a default', () => {
    const value = snapshot()
    const receipts = createRc01ChannelReceipts(value, 0)
    const aux = createRc08AuxReceipts(value, 0)
    const quiet = createRc08DashboardModel(value, receipts, aux, RC08_CHANNEL_STALE_MS.tc + 1)
    expect(quiet.tc.field.value).toBe('6')
    expect(quiet.tc.field.stale).toBe(true)
    expect(quiet.tc.field.tone).toBe('muted')
    expect(quiet.abs.field.value).toBe('4')
    expect(quiet.abs.field.stale).toBe(true)
    // A channel that has NEVER reported dashes; it does not fall back to a nominal step.
    const never = modelFor(snapshot({ tcLevel: undefined, absLevel: undefined }))
    expect(never.tc.field.value).toBe('--')
    expect(never.tc.field.unavailable).toBe(true)
    expect(never.abs.field.value).toBe('--')
  })

  it('accepts an ECU aid label as a step and rejects a meaningless one', () => {
    expect(rc08AuxChannelValue(snapshot({ tcLevel: 'M2' }), 'tc')).toBe('M2')
    expect(rc08AuxChannelValue(snapshot({ tcLevel: '   ' }), 'tc')).toBeNull()
    expect(rc08AuxChannelValue(snapshot({ tcLevel: Number.NaN }), 'tc')).toBeNull()
    expect(rc08AuxChannelValue(snapshot({ absLevel: -1 }), 'abs')).toBeNull()
  })

  it('dashes the brake bias rather than inferring it from the pedal balance', () => {
    const model = modelFor(snapshot({ brakeBiasPct: undefined, brake: 0.9, throttle: 0 }))
    expect(model.brakeBias.value).toBe('--')
    expect(model.brakeBias.unavailable).toBe(true)
    expect(rc08AuxChannelValue(snapshot({ brakeBiasPct: 140 }), 'brakeBias')).toBeNull()
  })

  it('refuses a delta without a stored best lap and never extrapolates one', () => {
    const model = modelFor(snapshot({ bestLapTimeSec: undefined }))
    expect(model.delta.value).toBe('--.---')
    expect(model.delta.unavailable).toBe(true)
    const negative = modelFor(snapshot({ deltaToBestSec: -0.412 }))
    expect(negative.delta.value).toBe('-0.412')
    expect(negative.delta.tone).toBe('good')
  })

  it('never derives the gear from RPM or speed and greys a missing channel', () => {
    const model = modelFor(snapshot({ gear: undefined, rpm: 7_600, maxRpm: 8_000, speedKmh: 210 }))
    expect(model.gear.value).toBe('-')
    expect(model.gear.unavailable).toBe(true)
    expect(rc08DisplayGear(0)).toBe('N')
    expect(rc08DisplayGear(-1)).toBe('R')
    expect(rc08DisplayGear(4)).toBe('4')
    expect(rc08DisplayGear(null)).toBe('-')
  })

  it('greys speed past its cadence and dashes it only past the 500 ms budget', () => {
    const value = snapshot()
    const receipts = createRc01ChannelReceipts(value, 0)
    const aux = createRc08AuxReceipts(value, 0)
    const greyed = createRc08DashboardModel(value, receipts, aux, RC08_CHANNEL_STALE_MS.speed + 50)
    expect(greyed.speed.value).toBe('128')
    expect(greyed.speed.stale).toBe(true)
    const dashed = createRc08DashboardModel(value, receipts, aux, RC08_SPEED_DASH_MS + 10)
    expect(dashed.speed.value).toBe('---')
    expect(dashed.speed.unavailable).toBe(true)
  })

  it('never mirrors one tyre corner onto another', () => {
    const model = modelFor(snapshot())
    const rr = model.corners.find((corner) => corner.corner === 'RR')
    expect(rr?.field.value).toBe('--')
    expect(rr?.tempC).toBeNull()
    expect(rr?.crossover).toBeNull()
    // The three live corners keep their own distinct readings.
    expect(model.corners.filter((corner) => corner.tempC !== null).map((corner) => corner.tempC)).toEqual([63, 61, 58])
  })

  it('degrades every channel to its packet state once its own budget has expired', () => {
    const value = sensorSnapshot(0.52)
    const receipts = createRc01ChannelReceipts(value, 0)
    const aux = createRc08AuxReceipts(value, 0)
    const aged = createRc08DashboardModel(value, receipts, aux, 60_000)
    expect(aged.grip.stale).toBe(true)
    expect(aged.regime).toBeNull()
    expect(aged.speed.value).toBe('---')
    expect(aged.gear.value).toBe('-')
    expect(aged.brakeBias.value).toBe('--')
    for (const corner of aged.corners) expect(corner.field.value).toBe('--')
    expect(Object.values(aged.auxFresh).every((fresh) => fresh === false)).toBe(true)
  })

  it('ages the tyres at 200 ms, the gear at 50 ms and the speed at 100 ms, per the packet', () => {
    expect(RC08_CHANNEL_STALE_MS.gear).toBe(50)
    expect(RC08_CHANNEL_STALE_MS.speed).toBe(100)
    for (const corner of RC08_CORNERS) {
      expect(RC08_CHANNEL_STALE_MS[RC08_CORNER_CHANNELS[corner]]).toBe(200)
    }
  })

  it('reads every channel from its own declared source and nothing else', () => {
    const value = sensorSnapshot(0.52)
    expect(rc08AuxChannelValue(value, 'grip')).toBe(rc08GripRank('WET'))
    expect(rc08AuxChannelValue(value, 'tc')).toBe(6)
    expect(rc08AuxChannelValue(value, 'abs')).toBe(4)
    expect(rc08AuxChannelValue(value, 'brakeBias')).toBe(54.5)
    expect(rc08AuxChannelValue(value, 'tyreFl')).toBe(63)
    expect(rc08AuxChannelValue(value, 'tyreFr')).toBe(61)
    expect(rc08AuxChannelValue(value, 'tyreRl')).toBe(58)
    expect(rc08AuxChannelValue(value, 'tyreRr')).toBeNull()
    expect(rc08AuxChannelValue(value, 'gear')).toBe(3)
    expect(rc08AuxChannelValue(value, 'speed')).toBe(128)
  })

  it('measures the crossover side from the corner"s own temperature', () => {
    expect(rc08CrossoverFor(RC08_WET_WINDOW_C.minC - 1)).toBe('COLD')
    expect(rc08CrossoverFor(RC08_WET_WINDOW_C.minC)).toBe('WET')
    expect(rc08CrossoverFor(RC08_WET_WINDOW_C.maxC)).toBe('WET')
    expect(rc08CrossoverFor(RC08_WET_WINDOW_C.maxC + 1)).toBe('DRY')
    expect(rc08CrossoverFor(null)).toBeNull()
  })
})

describe('RC-08 packet contradictions are resolved by omission, not invention', () => {
  it('declares no engine-speed channel and no shift geometry anywhere', () => {
    expect(Object.keys(RC08_CHANNEL_STALE_MS)).not.toContain('rpm')
    expect(Object.keys(RC08_CHANNEL_STALE_MS)).not.toContain('shift')
    const zones = rc08ZonesForLayout('native', 'standard', 'WET')
    expect(Object.keys(zones)).not.toContain('shift')
    expect(RC08_PACKET_OMISSIONS.shiftArc).toContain('11.1')
  })

  it('declares no rain-rate channel, so the row can only ever be the word', () => {
    expect(Object.keys(RC08_CHANNEL_STALE_MS)).not.toContain('rainRate')
    expect(RC08_PACKET_OMISSIONS.rainRateNumeral).toContain('UNAVAILABLE')
  })

  it('documents every contradiction it deliberately does not render', () => {
    expect(Object.keys(RC08_PACKET_OMISSIONS).sort()).toEqual([
      'gripPercentNumeral',
      'rainRateNumeral',
      'shiftArc',
      'wetWindowReadout'
    ])
    for (const reason of Object.values(RC08_PACKET_OMISSIONS)) {
      expect(typeof reason).toBe('string')
      expect(reason.length).toBeGreaterThan(20)
    }
  })

  it('keeps the wet window as configuration and never as a readout', () => {
    expect(RC08_WET_WINDOW_C).toEqual({ minC: 50, maxC: 80 })
    // The bounds must not reach the screen as text: only the MEASURED corner temperature and
    // the crossover side are ever displayed.
    const view = render(createElement(RaceconRc08DashWidget, { snapshot: sensorSnapshot(0.52), config }))
    const text = view.container.textContent ?? ''
    expect(text).not.toContain(String(RC08_WET_WINDOW_C.minC))
    expect(text).not.toContain(String(RC08_WET_WINDOW_C.maxC))
    expect(text).toContain('CROSSOVER')
  })
})

describe('RC-08 grip history is measured, never reconstructed', () => {
  it('opens a segment only for a confirmed state and closes it on a change', () => {
    const history = new Rc08GripHistory()
    history.observe({ nowMs: 0, state: 'DAMP' })
    history.observe({ nowMs: 1_000, state: 'DAMP' })
    history.observe({ nowMs: 2_000, state: 'WET' })
    const entries = history.entries()
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({ state: 'DAMP', startedAtMs: 0, endedAtMs: 2_000 })
    expect(entries[1]).toEqual({ state: 'WET', startedAtMs: 2_000, endedAtMs: null })
  })

  it('leaves a real gap when the grip feed goes away rather than back-filling it', () => {
    const history = new Rc08GripHistory()
    history.observe({ nowMs: 0, state: 'WET' })
    history.observe({ nowMs: 1_000, state: null })
    history.observe({ nowMs: 5_000, state: 'WET' })
    const segments = rc08TimelineSegments(history.entries(), 6_000, 10_000)
    expect(segments).toHaveLength(2)
    expect(segments[0].endedAtMs).toBe(1_000)
    expect(segments[1].startedAtMs).toBe(5_000)
    // The gap is real: the two segments do not touch.
    expect(segments[1].leftPercent).toBeGreaterThan(segments[0].leftPercent + segments[0].widthPercent)
  })

  it('clips the visible window and stays inside 0..100', () => {
    const history = new Rc08GripHistory()
    history.observe({ nowMs: 0, state: 'DRY' })
    const segments = rc08TimelineSegments(history.entries(), 10_000, 4_000)
    expect(segments).toHaveLength(1)
    expect(segments[0].leftPercent).toBeCloseTo(0, 6)
    expect(segments[0].widthPercent).toBeCloseTo(100, 6)
  })

  it('bounds the ring and clones and resets without sharing state', () => {
    const history = new Rc08GripHistory()
    for (let index = 0; index < RC08_GRIP_HISTORY_LIMIT + 8; index += 1) {
      history.observe({ nowMs: index * 100, state: RC08_GRIP_STATES[index % RC08_GRIP_STATES.length] })
    }
    expect(history.entries()).toHaveLength(RC08_GRIP_HISTORY_LIMIT)
    const copy = history.clone()
    copy.reset()
    expect(copy.entries()).toHaveLength(0)
    expect(history.entries()).toHaveLength(RC08_GRIP_HISTORY_LIMIT)
  })

  it('says nothing at all when no grip state has ever been confirmed', () => {
    expect(rc08TimelineSegments(new Rc08GripHistory().entries(), 1_000)).toEqual([])
    expect(rc08TimelineSegments([], Number.NaN, RC08_GRIP_HISTORY_WINDOW_MS)).toEqual([])
  })
})

describe('RC-08 trigger-only alerts', () => {
  it('starts silent with nothing latched', () => {
    const state = createRc08AlertState()
    expect(state.gripDrop.active).toBe(false)
    expect(state.coldTyres.active).toBe(false)
    expect(state.aidsFault.active).toBe(false)
  })

  it('engages the grip drop only after the 2 s confirmation', () => {
    let state = createRc08AlertState()
    state = advanceRc08Alerts(state, alertInput({ nowMs: 0, gripRank: 1 }))
    expect(state.gripDrop.active).toBe(false)
    expect(state.gripDrop.confirmedRank).toBe(1)
    state = advanceRc08Alerts(state, alertInput({ nowMs: 100, gripRank: 2 }))
    expect(state.gripDrop.active).toBe(false)
    state = advanceRc08Alerts(state, alertInput({ nowMs: 100 + RC08_GRIP_DROP_ENGAGE_MS - 1, gripRank: 2 }))
    expect(state.gripDrop.active).toBe(false)
    state = advanceRc08Alerts(state, alertInput({ nowMs: 100 + RC08_GRIP_DROP_ENGAGE_MS, gripRank: 2 }))
    expect(state.gripDrop.active).toBe(true)
    expect(state.gripDrop.confirmedRank).toBe(2)
  })

  it('holds the grip drop through the full 4 s drier hysteresis', () => {
    let state = createRc08AlertState()
    state = advanceRc08Alerts(state, alertInput({ nowMs: 0, gripRank: 1 }))
    state = advanceRc08Alerts(state, alertInput({ nowMs: 100, gripRank: 2 }))
    state = advanceRc08Alerts(state, alertInput({ nowMs: 2_100, gripRank: 2 }))
    expect(state.gripDrop.active).toBe(true)
    state = advanceRc08Alerts(state, alertInput({ nowMs: 3_000, gripRank: 1 }))
    expect(state.gripDrop.active).toBe(true)
    state = advanceRc08Alerts(state, alertInput({ nowMs: 3_000 + RC08_GRIP_DROP_HYSTERESIS_MS - 1, gripRank: 1 }))
    expect(state.gripDrop.active).toBe(true)
    state = advanceRc08Alerts(state, alertInput({ nowMs: 3_000 + RC08_GRIP_DROP_HYSTERESIS_MS, gripRank: 1 }))
    expect(state.gripDrop.active).toBe(false)
    expect(state.gripDrop.confirmedRank).toBe(1)
  })

  it('restarts the drier hysteresis when the track wets up again mid-recovery', () => {
    let state = createRc08AlertState()
    state = advanceRc08Alerts(state, alertInput({ nowMs: 0, gripRank: 1 }))
    state = advanceRc08Alerts(state, alertInput({ nowMs: 100, gripRank: 2 }))
    state = advanceRc08Alerts(state, alertInput({ nowMs: 2_100, gripRank: 2 }))
    state = advanceRc08Alerts(state, alertInput({ nowMs: 3_000, gripRank: 1 }))
    state = advanceRc08Alerts(state, alertInput({ nowMs: 5_000, gripRank: 2 }))
    expect(state.gripDrop.recoverySinceMs).toBeNull()
    state = advanceRc08Alerts(state, alertInput({ nowMs: 8_500, gripRank: 1 }))
    expect(state.gripDrop.active).toBe(true)
  })

  it('never engages or holds the grip drop on a missing or stale grip feed', () => {
    let state = createRc08AlertState()
    state = advanceRc08Alerts(state, alertInput({ nowMs: 0, gripRank: 1 }))
    state = advanceRc08Alerts(state, alertInput({ nowMs: 100, gripRank: 3 }))
    state = advanceRc08Alerts(state, alertInput({ nowMs: 5_000, gripRank: 3 }))
    expect(state.gripDrop.active).toBe(true)
    state = advanceRc08Alerts(state, alertInput({ nowMs: 5_100, gripRank: null }))
    expect(state.gripDrop.active).toBe(false)
    expect(state.gripDrop.confirmedRank).toBeNull()
    // And nothing is remembered across the gap: the next reading is a new baseline only.
    state = advanceRc08Alerts(state, alertInput({ nowMs: 9_000, gripRank: 3 }))
    expect(state.gripDrop.active).toBe(false)
  })

  it('engages the cold-tyre marker per corner after 3 s and clears on re-entry', () => {
    let state = createRc08AlertState()
    state = advanceRc08Alerts(state, alertInput({ nowMs: 0, wetRegime: true, coldCorners: ['FL'] }))
    expect(state.coldTyres.active).toBe(false)
    state = advanceRc08Alerts(state, alertInput({ nowMs: RC08_COLD_TYRE_ENGAGE_MS - 1, wetRegime: true, coldCorners: ['FL'] }))
    expect(state.coldTyres.active).toBe(false)
    state = advanceRc08Alerts(state, alertInput({ nowMs: RC08_COLD_TYRE_ENGAGE_MS, wetRegime: true, coldCorners: ['FL'] }))
    expect(state.coldTyres.active).toBe(true)
    expect(state.coldTyres.corners).toEqual(['FL'])
    state = advanceRc08Alerts(state, alertInput({ nowMs: 4_000, wetRegime: true, coldCorners: [] }))
    expect(state.coldTyres.active).toBe(false)
  })

  it('runs an independent debounce per corner, so one cold corner never marks another', () => {
    let state = createRc08AlertState()
    state = advanceRc08Alerts(state, alertInput({ nowMs: 0, wetRegime: true, coldCorners: ['FL'] }))
    state = advanceRc08Alerts(state, alertInput({ nowMs: 1_000, wetRegime: true, coldCorners: ['FL', 'RR'] }))
    state = advanceRc08Alerts(state, alertInput({ nowMs: 3_000, wetRegime: true, coldCorners: ['FL', 'RR'] }))
    expect(state.coldTyres.corners).toEqual(['FL'])
    state = advanceRc08Alerts(state, alertInput({ nowMs: 4_000, wetRegime: true, coldCorners: ['FL', 'RR'] }))
    expect(state.coldTyres.corners).toEqual(['FL', 'RR'])
  })

  it('scopes the cold-tyre alert to the wet regime, flood included', () => {
    expect(RC08_COLD_TYRE_GRIP_STATES).toEqual(['WET', 'FLOOD'])
    let state = createRc08AlertState()
    state = advanceRc08Alerts(state, alertInput({ nowMs: 0, wetRegime: false, coldCorners: ['FL'] }))
    state = advanceRc08Alerts(state, alertInput({ nowMs: 10_000, wetRegime: false, coldCorners: ['FL'] }))
    expect(state.coldTyres.active).toBe(false)
  })

  it('holds an aids fault for its full minimum display and then clears', () => {
    let state = createRc08AlertState()
    state = advanceRc08Alerts(state, alertInput({ nowMs: 0, faultedAids: ['TC'] }))
    expect(state.aidsFault.active).toBe(true)
    expect(state.aidsFault.aids).toEqual(['TC'])
    state = advanceRc08Alerts(state, alertInput({ nowMs: RC08_AIDS_FAULT_MIN_VISIBLE_MS - 1, faultedAids: [] }))
    expect(state.aidsFault.active).toBe(true)
    state = advanceRc08Alerts(state, alertInput({ nowMs: RC08_AIDS_FAULT_MIN_VISIBLE_MS, faultedAids: [] }))
    expect(state.aidsFault.active).toBe(false)
  })

  it('raises an aids fault only on a positively reported contradiction, never on silence', () => {
    // The map reports a selected step while the enable flag reports the aid is not operating.
    expect(rc08AidFaulted(6, false)).toBe(true)
    expect(rc08AidFaulted('M2', false)).toBe(true)
    // A quiet bus, an off map or an operating aid are all NOT faults.
    expect(rc08AidFaulted(null, false)).toBe(false)
    expect(rc08AidFaulted(6, undefined)).toBe(false)
    expect(rc08AidFaulted(6, true)).toBe(false)
    expect(rc08AidFaulted(0, false)).toBe(false)
    expect(rc08AidFaulted('OFF', false)).toBe(false)
  })

  it('unlatches every alert whose input has gone stale or missing', () => {
    const latched = {
      gripDrop: { active: true, confirmedRank: 2, pendingSinceMs: null, recoverySinceMs: null },
      coldTyres: { active: true, pendingSinceMs: { FL: 0 }, corners: ['FL' as const] },
      aidsFault: { active: true, minimumVisibleUntilMs: 9_999, aids: ['TC' as const] }
    }
    const blind = modelFor(snapshot({ tcLevel: undefined, absLevel: undefined }))
    const cleared = clearInvalidRc08Alerts(latched, blind)
    expect(cleared.gripDrop.active).toBe(false)
    expect(cleared.coldTyres.active).toBe(false)
    expect(cleared.aidsFault.active).toBe(false)
  })

  it('builds its alert inputs only from a confirmed regime and fresh channels', () => {
    const cold = modelFor(sensorSnapshot(0.52, { tyres: { lf: { tempC: 41 }, rf: { tempC: 61 }, lr: { tempC: 58 }, rr: {} } }))
    const input = rc08AlertInputForModel(cold, 1_000)
    expect(input.gripRank).toBe(rc08GripRank('WET'))
    expect(input.wetRegime).toBe(true)
    expect(input.coldCorners).toEqual(['FL'])
    expect(input.faultedAids).toEqual([])

    const blind = modelFor(snapshot())
    const blindInput = rc08AlertInputForModel(blind, 1_000)
    expect(blindInput.gripRank).toBeNull()
    expect(blindInput.wetRegime).toBe(false)
  })

  it('projects the latched alerts onto the model and the alert lines', () => {
    const alerts = {
      gripDrop: { active: true, confirmedRank: 2, pendingSinceMs: null, recoverySinceMs: null },
      coldTyres: { active: true, pendingSinceMs: { FL: 0 }, corners: ['FL' as const] },
      aidsFault: { active: true, minimumVisibleUntilMs: 9_999, aids: ['ABS' as const] }
    }
    const model = modelFor(sensorSnapshot(0.52), 0, { alerts })
    expect(model.alerts).toEqual({ gripDrop: true, coldTyres: true, aidsFault: true })
    expect(rc08AlertLines(model)).toEqual(['GRIP DROP', 'COLD TYRES', 'AIDS FAULT'])
    expect(model.corners.find((corner) => corner.corner === 'FL')?.cold).toBe(true)
    expect(model.corners.find((corner) => corner.corner === 'FR')?.cold).toBe(false)
  })
})

describe('RC-08 responsive contract', () => {
  it('resolves the native, app and compact layouts from the content box', () => {
    expect(rc08LayoutForContentBox(800, 480)).toBe('native')
    expect(rc08LayoutForContentBox(801, 479)).toBe('native')
    expect(rc08LayoutForContentBox(1024, 600)).toBe('app')
    expect(rc08LayoutForContentBox(1920, 1080)).toBe('app')
    expect(rc08LayoutForContentBox(640, 520)).toBe('compact')
    expect(rc08LayoutForContentBox(0, 0)).toBe('app')
  })

  it('classifies phone and landscape compact modes', () => {
    expect(rc08CompactModeForContentBox(400, 800)).toBe('phone')
    expect(rc08CompactModeForContentBox(900, 400)).toBe('landscape')
    expect(rc08CompactModeForContentBox(640, 520)).toBe('standard')
    expect(rc08CompactModeForContentBox(1024, 600)).toBe('standard')
  })

  it('emits portrait geometry only at the phone breakpoint', () => {
    expect(rc08PhoneGeometryForContentBox(1024, 600)).toBeNull()
    expect(rc08PhoneGeometryForContentBox(900, 400)).toBeNull()
    const geometry = rc08PhoneGeometryForContentBox(400, 800)
    expect(geometry).not.toBeNull()
    expect(geometry!.inset).toBe(12)
    expect(geometry!.toggleSize).toBe(44)
    expect(geometry!.ribbonHeight).toBeGreaterThan(geometry!.rowHeight)
  })
})

describe('RC-08 rendering', () => {
  it('renders the canonical DOM contract as a grip-adaptive column display', () => {
    const html = markup(sensorSnapshot(0.52), nativeConfig)
    assertClean(html)
    expect(html).toContain('data-widget="raceconRc08Dash"')
    expect(html).toContain('data-rc08-layout="native"')
    expect(html).toContain('data-rc08-native-size="800x480"')
    expect(html).toContain('data-rc08-zone="banner"')
    expect(html).toContain('data-rc08-zone="ribbon"')
    expect(html).toContain('data-rc08-zone="aids"')
    expect(html).toContain('data-rc08-zone="pace"')
    expect(html).toContain('data-rc08-zone="tire"')
    expect(html).toContain('GRIP SOURCE')
    expect(html).toContain('GRIP STATE')
    expect(html).toContain('BRAKE BIAS')
    expect(html).toContain('RAIN RATE')
    expect(html).toContain('DELTA TO BEST')
    expect(html).toContain('TIRE TEMP')
  })

  it('renders the packet 11.1 column widths for the live regime', () => {
    const wet = markup(sensorSnapshot(0.52), nativeConfig)
    expect(wet).toContain('data-rc08-regime="WET"')
    expect(wet).toContain('data-rc08-column-widths="37.5/23.8/30.8"')
    expect(wet).toContain('width:37.5%')
    expect(wet).toContain('width:23.8%')

    const dry = markup(sensorSnapshot(0.02), nativeConfig)
    expect(dry).toContain('data-rc08-regime="DRY"')
    expect(dry).toContain('data-rc08-column-widths="28.5/32.8/30.8"')
  })

  it('states an unconfirmed regime as three equal columns', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('data-rc08-regime="unknown"')
    expect(html).toContain('data-rc08-column-widths="30.7/30.7/30.7"')
    expect(html).toContain('data-rc08-grip="unavailable"')
  })

  it('renders the weather-honesty banner and the rain-rate word, never a rain numeral', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('WEATHER FEED UNAVAILABLE')
    expect(html).toContain('data-rc08-weather="unavailable"')
    // Two honesty words: the banner's and the rain-rate row's.
    expect(html.match(/UNAVAILABLE/g)?.length).toBeGreaterThanOrEqual(2)
    const view = render(createElement(RaceconRc08DashWidget, { snapshot: snapshot(), config: nativeConfig }))
    const rain = view.container.querySelector('[data-testid="rc08-rain"]')
    expect(rain?.textContent).toBe('UNAVAILABLE')
    // No digit ever reaches the rain-rate row: there is no mm/h channel to print.
    expect(view.container.querySelector('[data-rc08-row="rain"]')?.textContent).not.toMatch(/[0-9]/)
  })

  it('draws no shift LED, rev bar or over-rev segment anywhere', () => {
    const html = markup(sensorSnapshot(0.52, { rpm: 7_900, maxRpm: 8_000 }), nativeConfig)
    expect(html).not.toContain('rc08-led')
    expect(html).not.toContain('rc08-shift')
    expect(html).not.toContain('rc08-rev')
    expect(html).not.toContain('data-rc08-zone="shift"')
  })

  it('keeps every alert surface absent in the silent reference frame', () => {
    const html = markup(sensorSnapshot(0.52), nativeConfig)
    expect(html).toContain('data-rc08-alerts="silent"')
    expect(html).not.toContain('rc08-aids-fault')
    expect(html).not.toContain('rc08-corner-cold')
    expect(html).not.toContain('data-rc08-cold="true"')
    expect(html).not.toContain('data-rc08-faulted="true"')
  })

  it('reveals both app-only modules at 1024x600 and neither at 800x480', () => {
    const app = markup(sensorSnapshot(0.52), config)
    expect(app).toContain('data-rc08-layout="app"')
    expect(app).toContain('data-testid="rc08-timeline"')
    expect(app).toContain('data-testid="rc08-crossover"')
    expect(app).toContain('GRIP HISTORY')
    expect(app).toContain('CROSSOVER')

    const native = markup(sensorSnapshot(0.52), nativeConfig)
    expect(native).not.toContain('data-testid="rc08-timeline"')
    expect(native).not.toContain('data-testid="rc08-crossover"')
    expect(native).not.toContain('GRIP HISTORY')
    expect(native).not.toContain('CROSSOVER')
  })

  it('renders a clean, dash-only frame with no telemetry at all', () => {
    const html = markup(null, nativeConfig)
    assertClean(html)
    expect(html).toContain('data-widget="raceconRc08Dash"')
    expect(html).toContain('data-rc08-grip="unavailable"')
    expect(html).toContain('data-rc08-regime="unknown"')
    expect(html).toContain('data-rc08-alerts="silent"')
    expect(html).toContain('UNAVAILABLE')
  })

  it('refuses mock and replay telemetry and raises no alert from it', () => {
    const mock = markup(sensorSnapshot(0.9, { sim: 'mock' } as Partial<TelemetrySnapshot>), nativeConfig)
    expect(mock).toContain('data-rc08-buffer-state="mock-telemetry"')
    expect(mock).toContain('data-rc08-grip="unavailable"')
    expect(mock).toContain('data-rc08-alerts="silent"')

    const replay = markup(
      sensorSnapshot(0.9, { replayContext: { state: 'replay' } } as Partial<TelemetrySnapshot>),
      nativeConfig
    )
    expect(replay).toContain('data-rc08-buffer-state="replay-telemetry"')
    expect(replay).toContain('data-rc08-grip="unavailable"')
    expect(replay).toContain('data-rc08-alerts="silent"')
  })

  it('exposes the compact mode attribute only in the compact layout', () => {
    const compact = markup(sensorSnapshot(0.52), { ...config, position: { x: 0, y: 0, width: 640, height: 520 } })
    expect(compact).toContain('data-rc08-layout="compact"')
    expect(compact).toContain('data-rc08-compact-mode="standard"')
    expect(markup(sensorSnapshot(0.52), nativeConfig)).not.toContain('data-rc08-compact-mode')
  })
})

describe('RC-08 shares the RC-01 fail-closed ingest buffer', () => {
  it('accepts a live identified snapshot and rejects an unidentified one', () => {
    const buffer = new Rc01LiveTelemetryBuffer()
    expect(buffer.ingest(sensorSnapshot(0.52), 0).accepted).toBe(true)
    const orphan = new Rc01LiveTelemetryBuffer()
    const result = orphan.ingest(
      sensorSnapshot(0.52, { sessionUniqueId: undefined } as Partial<TelemetrySnapshot>),
      0
    )
    expect(result.accepted).toBe(false)
  })
})

describe('RC-08 live wet surfaces', () => {
  /**
   * Frames are pushed at 20 Hz so the packet's tightest budget (the 50 ms gear channel) is
   * never missed between steps: a test that jumped straight to a deadline would correctly find
   * every alert disarmed by staleness rather than by its own trigger.
   */
  function mount(initial: Partial<TelemetrySnapshot> = {}, cfg = nativeConfig): {
    push: (atMs: number, overrides?: Partial<TelemetrySnapshot>) => void
    frame: (value: TelemetrySnapshot | null) => void
    root: () => HTMLElement
    view: ReturnType<typeof render>
  } {
    vi.useFakeTimers()
    let monotonicMs = 0
    let current = initial
    const monotonicClock = (): number => monotonicMs
    const view = render(
      createElement(RaceconRc08DashWidget, {
        snapshot: snapshot(initial, 1_000),
        config: cfg,
        monotonicClock
      })
    )
    const frame = (value: TelemetrySnapshot | null): void => {
      view.rerender(createElement(RaceconRc08DashWidget, { snapshot: value, config: cfg, monotonicClock }))
    }
    const push = (atMs: number, overrides?: Partial<TelemetrySnapshot>): void => {
      if (overrides) current = { ...current, ...overrides }
      if (atMs <= monotonicMs) {
        frame(snapshot(current, 1_000 + monotonicMs))
        return
      }
      while (monotonicMs < atMs) {
        const step = Math.min(50, atMs - monotonicMs)
        monotonicMs += step
        act(() => {
          vi.advanceTimersByTime(step)
        })
        frame(snapshot(current, 1_000 + monotonicMs))
      }
    }
    return { push, frame, root: () => view.container.querySelector<HTMLElement>('.rc08-widget')!, view }
  }

  function toggleGrip(state: Rc08GripState | 'auto'): void {
    act(() => {
      window.dispatchEvent(new CustomEvent(RC08_GRIP_TOGGLE_EVENT, { detail: state }))
    })
  }

  it('reproduces the approved reference frame: driver toggle, no weather feed, silent alerts', () => {
    const { root, view } = mount()
    toggleGrip('WET')
    expect(root().dataset.rc08Grip).toBe('WET')
    expect(root().dataset.rc08GripSource).toBe('driver')
    expect(root().dataset.rc08Weather).toBe('unavailable')
    expect(root().dataset.rc08Regime).toBe('WET')
    expect(root().dataset.rc08Alerts).toBe('silent')
    const q = (id: string): string => view.container.querySelector(`[data-testid="${id}"]`)?.textContent ?? ''
    expect(q('rc08-grip')).toBe('WET')
    expect(q('rc08-grip-source')).toBe('DRIVER TOGGLE')
    expect(q('rc08-weather-feed')).toBe('WEATHER FEED UNAVAILABLE')
    expect(q('rc08-tc')).toBe('6')
    expect(q('rc08-abs')).toBe('4')
    expect(q('rc08-bias')).toBe('54.5')
    expect(q('rc08-rain')).toBe('UNAVAILABLE')
    expect(q('rc08-gear')).toBe('3')
    expect(q('rc08-delta')).toBe('+2.418')
    expect(q('rc08-speed')).toBe('128')
    expect(q('rc08-corner-FL')).toBe('63')
    expect(q('rc08-corner-RR')).toBe('--')
    expect(view.container.querySelectorAll('[data-testid="rc08-corner"]')).toHaveLength(4)
    expect(view.container.querySelector('[data-testid="rc08-aids-fault"]')).toBeNull()
    expect(view.container.querySelector('[data-testid="rc08-corner-cold"]')).toBeNull()
  })

  it('reflows the columns when the driver confirms a wetter regime', () => {
    const { root, view } = mount()
    expect(root().dataset.rc08ColumnWidths).toBe('30.7/30.7/30.7')
    toggleGrip('DRY')
    expect(root().dataset.rc08ColumnWidths).toBe('28.5/32.8/30.8')
    toggleGrip('FLOOD')
    expect(root().dataset.rc08ColumnWidths).toBe('41.5/19.8/30.8')
    const aids = view.container.querySelector<HTMLElement>('[data-testid="rc08-aids"]')!
    const pace = view.container.querySelector<HTMLElement>('[data-testid="rc08-pace"]')!
    expect(aids.style.width).toBe('41.5%')
    expect(pace.style.width).toBe('19.8%')
  })

  it('hands the display back to the sensor when the driver toggle returns to auto', () => {
    const { root } = mount({ trackWetnessPct: 0.02 })
    expect(root().dataset.rc08Grip).toBe('DRY')
    expect(root().dataset.rc08GripSource).toBe('sensor')
    toggleGrip('FLOOD')
    expect(root().dataset.rc08GripSource).toBe('driver')
    expect(root().dataset.rc08Grip).toBe('FLOOD')
    toggleGrip('auto')
    expect(root().dataset.rc08GripSource).toBe('sensor')
    expect(root().dataset.rc08Grip).toBe('DRY')
  })

  it('ignores an unrecognised toggle payload outright', () => {
    const { root } = mount({ trackWetnessPct: 0.52 })
    act(() => {
      window.dispatchEvent(new CustomEvent(RC08_GRIP_TOGGLE_EVENT, { detail: 'SOAKED' }))
    })
    expect(root().dataset.rc08Grip).toBe('WET')
    expect(root().dataset.rc08GripSource).toBe('sensor')
  })

  it('marks a cold corner only after the packet debounce and only on that corner', () => {
    const { push, root, view } = mount({
      trackWetnessPct: 0.52,
      tyres: { lf: { tempC: 41 }, rf: { tempC: 61 }, lr: { tempC: 58 }, rr: {} }
    })
    push(RC08_COLD_TYRE_ENGAGE_MS - 200)
    expect(root().dataset.rc08Alerts).toBe('silent')
    expect(view.container.querySelector('[data-testid="rc08-corner-cold"]')).toBeNull()

    push(RC08_COLD_TYRE_ENGAGE_MS + 200)
    expect(root().dataset.rc08AlertKeys).toContain('COLD TYRES')
    expect(view.container.querySelector('[data-rc08-corner="FL"]')?.getAttribute('data-rc08-cold')).toBe('true')
    expect(view.container.querySelector('[data-rc08-corner="FR"]')?.getAttribute('data-rc08-cold')).toBe('false')

    // The corner rises back into the window and the marker clears immediately.
    push(RC08_COLD_TYRE_ENGAGE_MS + 400, {
      tyres: { lf: { tempC: 62 }, rf: { tempC: 61 }, lr: { tempC: 58 }, rr: {} }
    })
    expect(root().dataset.rc08Alerts).toBe('silent')
  })

  it('never marks a cold corner outside the wet regime', () => {
    const { push, root } = mount({
      trackWetnessPct: 0.02,
      tyres: { lf: { tempC: 41 }, rf: { tempC: 61 }, lr: { tempC: 58 }, rr: {} }
    })
    push(RC08_COLD_TYRE_ENGAGE_MS + 1_000)
    expect(root().dataset.rc08Regime).toBe('DRY')
    expect(root().dataset.rc08Alerts).toBe('silent')
  })

  it('widens the aids column when a confirmed wetter transition latches the grip drop', () => {
    const { push, root } = mount({ trackWetnessPct: 0.2 })
    push(200)
    expect(root().dataset.rc08Regime).toBe('DAMP')
    expect(root().dataset.rc08Alerts).toBe('silent')
    push(400, { trackWetnessPct: 0.52 })
    expect(root().dataset.rc08Regime).toBe('WET')
    // The reflow is immediate; the ALERT still waits out its 2 s confirmation.
    expect(root().dataset.rc08ColumnWidths).toBe('37.5/23.8/30.8')
    expect(root().dataset.rc08Alerts).toBe('silent')
    push(400 + RC08_GRIP_DROP_ENGAGE_MS + 200)
    expect(root().dataset.rc08AlertKeys).toContain('GRIP DROP')
  })

  it('raises the red aids note only on a positively reported aid contradiction', () => {
    const { root, view } = mount({ trackWetnessPct: 0.52, tcEnabled: false } as Partial<TelemetrySnapshot>)
    expect(root().dataset.rc08AlertKeys).toContain('AIDS FAULT')
    expect(view.container.querySelector('[data-testid="rc08-aids-fault"]')?.textContent).toBe('TC FAULT')
    expect(view.container.querySelector('[data-rc08-row="tc"]')?.getAttribute('data-rc08-faulted')).toBe('true')
    expect(view.container.querySelector('[data-rc08-row="abs"]')?.getAttribute('data-rc08-faulted')).toBe('false')
  })

  it('reports no aids fault at all when the aid channels are simply quiet', () => {
    const { root, view } = mount({ trackWetnessPct: 0.52, tcLevel: undefined, absLevel: undefined })
    expect(root().dataset.rc08Alerts).toBe('silent')
    expect(view.container.querySelector('[data-testid="rc08-aids-fault"]')).toBeNull()
    expect(view.container.querySelector('[data-testid="rc08-tc"]')?.textContent).toBe('--')
  })

  it('builds the app-only grip timeline from the states it actually observed', () => {
    const { push, view } = mount({ trackWetnessPct: 0.2 }, config)
    push(1_000)
    push(3_000, { trackWetnessPct: 0.52 })
    const segments = Array.from(view.container.querySelectorAll('[data-testid="rc08-timeline-segment"]'))
    expect(segments.length).toBeGreaterThanOrEqual(2)
    const states = segments.map((node) => node.getAttribute('data-rc08-grip'))
    expect(states).toContain('DAMP')
    expect(states).toContain('WET')
  })

  it('says UNAVAILABLE on the timeline until a grip state has actually been confirmed', () => {
    const { push, view } = mount({}, config)
    push(1_000)
    expect(view.container.querySelector('[data-testid="rc08-timeline-empty"]')?.textContent).toBe('UNAVAILABLE')
    expect(view.container.querySelectorAll('[data-testid="rc08-timeline-segment"]')).toHaveLength(0)
  })

  it('clears the measured grip history and every latched alert on a source discontinuity', () => {
    const { push, frame, root, view } = mount({ trackWetnessPct: 0.52 }, config)
    push(2_000)
    expect(view.container.querySelectorAll('[data-testid="rc08-timeline-segment"]').length).toBeGreaterThan(0)

    frame(snapshot({ trackWetnessPct: 0.52, sim: 'mock' } as Partial<TelemetrySnapshot>, 3_000))
    expect(root().dataset.rc08BufferState).toBe('mock-telemetry')
    expect(root().dataset.rc08Alerts).toBe('silent')
    expect(root().dataset.rc08Grip).toBe('unavailable')
    expect(view.container.querySelector('[data-testid="rc08-timeline-empty"]')?.textContent).toBe('UNAVAILABLE')
  })

  it('keeps every zone inside the widget box at the native canvas, in every regime', () => {
    const { root, view } = mount()
    for (const regime of RC08_GRIP_STATES) {
      toggleGrip(regime)
      expect(root().dataset.rc08Regime).toBe(regime)
      for (const zone of Array.from(view.container.querySelectorAll<HTMLElement>('[data-rc08-zone]'))) {
        if (!zone.style.left) continue
        expect(Number.parseFloat(zone.style.left) + Number.parseFloat(zone.style.width)).toBeLessThanOrEqual(100.001)
        expect(Number.parseFloat(zone.style.top) + Number.parseFloat(zone.style.height)).toBeLessThanOrEqual(100.001)
      }
    }
  })
})
