// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOverlayStyle, type OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { OVERLAY_DASHBOARD_PRESETS } from '../../../../shared/dashboards'
import { WIDGET_COMPONENTS } from './index'
import { RaceconRc09DashWidget } from './RaceconRc09DashWidget'
import { Rc01LiveTelemetryBuffer, createRc01ChannelReceipts } from './raceconRc01Core'
import {
  RC09_APP_SPLIT_NOTE_BOX,
  RC09_APP_ZONES,
  RC09_CAUTION_ACK_EVENT,
  RC09_CAUTION_MIN_VISIBLE_MS,
  RC09_CHANNEL_STALE_MS,
  RC09_CQW_PX,
  RC09_DASH,
  RC09_LED_ARC_RISE_PCT,
  RC09_LED_COUNT,
  RC09_MECHANICAL_ENGAGE_MS,
  RC09_MECHANICAL_FAULTS,
  RC09_NATIVE_ZONES,
  RC09_NOTE_HISTORY_LIMIT,
  RC09_NOTE_TILE_HEIGHT_PCT,
  RC09_NOTE_TILE_PACKET_HEIGHT_PCT,
  RC09_OIL_PRESSURE_MIN_RPM,
  RC09_OIL_PRESSURE_RANGE_KPA,
  RC09_PACKET_OMISSIONS,
  RC09_ROADBOOK_EVENT,
  RC09_SPEED_DASH_MS,
  RC09_SPLIT_LOSS_ENGAGE_MS,
  RC09_SPLIT_LOSS_THRESHOLD_SEC,
  RC09_TOKENS,
  RC09_TYPE_SCALE_PX,
  RC09_WATER_RANGE_C,
  type Rc09AlertInput,
  Rc09AuxBuffer,
  Rc09NoteHistory,
  type Rc09PaceNote,
  type Rc09Rect,
  type Rc09ZoneMap,
  advanceRc09Alerts,
  buildRc09LedStates,
  clearInvalidRc09Alerts,
  createRc09AlertState,
  createRc09AuxReceipts,
  createRc09DashboardModel,
  rc09AlertInputForModel,
  rc09AlertLines,
  rc09AuxChannelValue,
  rc09CompactModeForContentBox,
  rc09DisplayGear,
  rc09FitFontCqw,
  rc09FormatSplit,
  rc09FormatStageTime,
  rc09LayoutForContentBox,
  rc09LedArcOffsetPct,
  rc09LedLeftPct,
  rc09NoteGlyph,
  rc09NoteSeverity,
  rc09OutOfRangeFaults,
  rc09PaceNoteFromEvent,
  rc09Percent,
  rc09PhoneGeometryForContentBox,
  rc09ProfileBars,
  rc09RectContains,
  rc09RungCqw,
  rc09ShiftThresholdForGear,
  rc09StageDistanceM,
  rc09StageLengthM,
  rc09StageProgress,
  rc09TypeScaleCqw,
  rc09ZoneStyle,
  rc09ZonesForLayout
} from './raceconRc09Core'

const config: OverlayWidgetConfig = {
  id: 'raceconRc09Dash',
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
 * The approved RC-09 reference state (attempt-004 governed 800x480,
 * `input/telemetry-frame-stage-04m12s.json`): mid special stage at 04:12.6, gaining 1.4 s on the
 * reference run, a routine `RIGHT 4` note, 112 km/h in 4th, water 88 degC, 3400 of 7600 rpm, and
 * all three packet section 15 alerts ARMED and SILENT.
 *
 * `deltaToBestSec` plus `bestLapTimeSec` are the rolling split's source: the shared RC-01 channel
 * refuses to publish a delta without a stored reference run, which IS packet 16's rule.
 */
function snapshot(overrides: Partial<TelemetrySnapshot> = {}, timestamp = 4_212_600): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp,
    sessionUniqueId: 91,
    currentLapTimeSec: 252.6,
    deltaToBestSec: -1.4,
    bestLapTimeSec: 254.0,
    speedKmh: 112,
    gear: 4,
    rpm: 3_400,
    maxRpm: 7_600,
    waterTempC: 88,
    throttle: 0.61,
    brake: 0,
    clutch: 0,
    sessionType: 'Practice',
    sessionState: 'racing',
    playerCarIdx: 2,
    ...overrides
  } as TelemetrySnapshot
}

/** The reference frame's own co-driver call, exactly as a loaded roadbook would deliver it. */
const REFERENCE_NOTE: Rc09PaceNote = { text: 'RIGHT 4', hazard: false, sequence: 12 }

function markup(value: TelemetrySnapshot | null, cfg = config): string {
  return renderToStaticMarkup(createElement(RaceconRc09DashWidget, { snapshot: value, config: cfg }))
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
  options: Parameters<typeof createRc09DashboardModel>[4] = {},
  receiptsAtMs = nowMs
): ReturnType<typeof createRc09DashboardModel> {
  const receipts = value ? createRc01ChannelReceipts(value, receiptsAtMs) : new Map()
  const aux = value ? createRc09AuxReceipts(value, receiptsAtMs) : new Map()
  return createRc09DashboardModel(value, receipts, aux, nowMs, options)
}

function alertInput(overrides: Partial<Rc09AlertInput> = {}): Rc09AlertInput {
  return {
    nowMs: 0,
    hazardSequence: null,
    acknowledgedSequence: null,
    splitSec: null,
    outOfRange: [],
    ...overrides
  }
}

function right(rect: Rc09Rect): number {
  return rect.left + rect.width
}

function bottom(rect: Rc09Rect): number {
  return rect.top + rect.height
}

function overlaps(a: Rc09Rect, b: Rc09Rect): boolean {
  return a.left < right(b) && right(a) > b.left && a.top < bottom(b) && bottom(a) > b.top
}

/** The nested packet zones, which contain other rects rather than being disjoint from them. */
const NESTED_ZONES = ['splitNote'] as const

function topLevelZones(zones: Rc09ZoneMap): Rc09Rect[] {
  return Object.entries(zones)
    .filter(([id]) => !(NESTED_ZONES as readonly string[]).includes(id))
    .map(([, rect]) => rect)
    .filter((rect): rect is Rc09Rect => Boolean(rect))
}

function allZones(zones: Rc09ZoneMap): Rc09Rect[] {
  return Object.values(zones).filter((rect): rect is Rc09Rect => Boolean(rect))
}

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

describe('RC-09 registration and preset wiring', () => {
  it('registers the widget component under its canonical id', () => {
    expect(WIDGET_COMPONENTS.raceconRc09Dash).toBe(RaceconRc09DashWidget)
  })

  it('declares exactly one RC-09 full-frame preset directly after RC-08', () => {
    const ids = OVERLAY_DASHBOARD_PRESETS.map((entry) => entry.id)
    expect(ids.filter((id) => id === 'racecon_rc09_dash')).toHaveLength(1)
    expect(ids.indexOf('racecon_rc09_dash')).toBe(ids.indexOf('racecon_rc08_dash') + 1)
    const preset = OVERLAY_DASHBOARD_PRESETS.find((entry) => entry.id === 'racecon_rc09_dash')
    expect(preset?.widgetId).toBe('raceconRc09Dash')
    expect(preset?.name).toBe('RaceCon RC-09 Stage Time')
    expect(preset?.scaleMode).toBe('stretch')
    expect(preset?.tags).toContain('rally')
    expect(preset?.tags).toContain('stage')
  })
})

describe('RC-09 packet zone geometry', () => {
  it('reproduces packet 11.1 verbatim, except the note tile the packet overlaps', () => {
    expect(RC09_NATIVE_ZONES.timeline).toEqual({ left: 2.0, top: 8.3, width: 96.0, height: 12.5 })
    expect(RC09_NATIVE_ZONES.clock).toEqual({ left: 2.0, top: 25.0, width: 52.5, height: 37.5 })
    expect(RC09_NATIVE_ZONES.split).toEqual({ left: 57.0, top: 25.0, width: 41.0, height: 18.8 })
    expect(RC09_NATIVE_ZONES.note).toEqual({ left: 57.0, top: 45.8, width: 41.0, height: 20.0 })
    expect(RC09_NATIVE_ZONES.support).toEqual({ left: 2.0, top: 66.7, width: 96.0, height: 29.2 })
    // The 800x480 grammar has no stage-profile strip: packet 12.1 makes it app-only.
    expect(RC09_NATIVE_ZONES.profile).toBeUndefined()
  })

  it('does not reproduce the packet 11.1 note-tile bug that overlaps the support strip', () => {
    // Packet 11.1 publishes y=220 h=120 for the note tile and y=320 for the support strip: a
    // 20 px overlap on the native canvas. The tile is 20.0 % tall instead, ending at 65.8 %.
    expect(RC09_NOTE_TILE_PACKET_HEIGHT_PCT).toBe(25.0)
    expect(RC09_NOTE_TILE_HEIGHT_PCT).toBe(20.0)
    const packetTile: Rc09Rect = { ...RC09_NATIVE_ZONES.note!, height: RC09_NOTE_TILE_PACKET_HEIGHT_PCT }
    expect(overlaps(packetTile, RC09_NATIVE_ZONES.support!)).toBe(true)
    expect(overlaps(RC09_NATIVE_ZONES.note!, RC09_NATIVE_ZONES.support!)).toBe(false)
    expect(bottom(RC09_NATIVE_ZONES.note!)).toBeCloseTo(65.8, 6)
    // The overlap the packet would have caused is 4.1 pp of a 480 px canvas: the 20 px the
    // packet's own pixel coordinates state (note y=220 h=120 ends at 340, support starts at 320).
    expect(Math.round((bottom(packetTile) - RC09_NATIVE_ZONES.support!.top) * 4.8)).toBe(20)
  })

  it('reproduces packet 12.1 verbatim and reveals the app-only stage-profile strip', () => {
    expect(RC09_APP_ZONES.timeline).toEqual({ left: 0, top: 0, width: 100, height: 12.0 })
    expect(RC09_APP_ZONES.clock).toEqual({ left: 2.3, top: 16.0, width: 50.8, height: 36.7 })
    expect(RC09_APP_ZONES.splitNote).toEqual({ left: 54.7, top: 16.0, width: 43.0, height: 36.7 })
    expect(RC09_APP_ZONES.profile).toEqual({ left: 2.3, top: 56.0, width: 95.3, height: 20.0 })
    expect(RC09_APP_ZONES.support).toEqual({ left: 2.3, top: 78.7, width: 95.3, height: 18.3 })
  })

  it('lays the split chip and the note tile inside packet 12.1"s single published box', () => {
    expect(rc09RectContains(RC09_APP_SPLIT_NOTE_BOX, RC09_APP_ZONES.split!)).toBe(true)
    expect(rc09RectContains(RC09_APP_SPLIT_NOTE_BOX, RC09_APP_ZONES.note!)).toBe(true)
    expect(overlaps(RC09_APP_ZONES.split!, RC09_APP_ZONES.note!)).toBe(false)
    expect(RC09_APP_ZONES.split!.top).toBe(RC09_APP_SPLIT_NOTE_BOX.top)
    expect(bottom(RC09_APP_ZONES.note!)).toBeCloseTo(bottom(RC09_APP_SPLIT_NOTE_BOX), 6)
  })

  it('contains every zone inside the canvas at every breakpoint', () => {
    for (const size of BREAKPOINTS) {
      const layout = rc09LayoutForContentBox(size.width, size.height)
      const mode = rc09CompactModeForContentBox(size.width, size.height)
      for (const rect of allZones(rc09ZonesForLayout(layout, mode))) {
        expect(rect.left).toBeGreaterThanOrEqual(0)
        expect(rect.top).toBeGreaterThanOrEqual(0)
        expect(right(rect)).toBeLessThanOrEqual(100)
        expect(bottom(rect)).toBeLessThanOrEqual(100)
        expect(rect.width).toBeGreaterThan(0)
        expect(rect.height).toBeGreaterThan(0)
      }
    }
  })

  it('keeps every top-level zone disjoint at every breakpoint', () => {
    for (const size of BREAKPOINTS) {
      const layout = rc09LayoutForContentBox(size.width, size.height)
      const mode = rc09CompactModeForContentBox(size.width, size.height)
      const rects = topLevelZones(rc09ZonesForLayout(layout, mode))
      for (let a = 0; a < rects.length; a += 1) {
        for (let b = a + 1; b < rects.length; b += 1) {
          expect(
            overlaps(rects[a], rects[b]),
            `${size.width}x${size.height} zones ${a}/${b} overlap`
          ).toBe(false)
        }
      }
    }
  })

  it('carries the stage hierarchy at every breakpoint: timeline above clock above support', () => {
    for (const size of BREAKPOINTS) {
      const layout = rc09LayoutForContentBox(size.width, size.height)
      const mode = rc09CompactModeForContentBox(size.width, size.height)
      const zones = rc09ZonesForLayout(layout, mode)
      expect(bottom(zones.timeline!)).toBeLessThanOrEqual(zones.clock!.top)
      expect(bottom(zones.clock!)).toBeLessThanOrEqual(zones.support!.top)
      // Packet 7: the split chip sits directly over the note tile in every grammar.
      expect(bottom(zones.split!)).toBeLessThanOrEqual(zones.note!.top)
      // The stage clock is the hero, so it always owns more area than the split chip.
      expect(zones.clock!.width * zones.clock!.height).toBeGreaterThan(zones.split!.width * zones.split!.height)
    }
  })

  it('emits inline percentages without binary-float noise', () => {
    expect(rc09Percent(45.8)).toBe('45.8%')
    expect(rc09Percent(1 / 3)).toBe('0.333%')
    expect(rc09Percent(Number.NaN)).toBe('0%')
    expect(rc09ZoneStyle(RC09_NATIVE_ZONES.note)).toEqual({
      left: '57%',
      top: '45.8%',
      width: '41%',
      height: '20%'
    })
    expect(rc09ZoneStyle(undefined)).toBeNull()
  })
})

describe('RC-09 typographic ladder is computed from packet 11.2, not from the render', () => {
  it('keeps the packet 11.2 px ladder verbatim', () => {
    expect(RC09_TYPE_SCALE_PX.clock).toBe(150)
    expect(RC09_TYPE_SCALE_PX.split).toBe(64)
    expect(RC09_TYPE_SCALE_PX.note).toBe(40)
    expect(RC09_TYPE_SCALE_PX.support).toBe(40)
    expect(RC09_CQW_PX).toBe(8)
    expect(rc09TypeScaleCqw(RC09_TYPE_SCALE_PX.clock)).toBe(18.75)
    expect(rc09TypeScaleCqw(RC09_TYPE_SCALE_PX.split)).toBe(8)
  })

  it('refuses the render"s compressed hierarchy: split stays 1.6x the support numbers', () => {
    // image-qa-v1 normative override 1: the approved frame renders the split at only 1.083x the
    // support text. The packet's own ratio is kept instead and the picture is not traced.
    expect(RC09_TYPE_SCALE_PX.split / RC09_TYPE_SCALE_PX.support).toBeCloseTo(1.6, 6)
    expect(RC09_TYPE_SCALE_PX.clock).toBeGreaterThan(RC09_TYPE_SCALE_PX.split)
    expect(RC09_TYPE_SCALE_PX.note).toBe(RC09_TYPE_SCALE_PX.support)
    expect(RC09_TYPE_SCALE_PX.label).toBeLessThan(RC09_TYPE_SCALE_PX.support)
  })

  it('caps the hero by its own zone so a nowrap numeral cannot escape packet 11.1"s box', () => {
    // The documented RC-01/RC-02 trap: seven glyphs of `04:12.6` at 150 px need about 470 px and
    // packet 11.1 gives the clock zone 420 px, so the rendered size is min(rung, zone fit).
    const clockZone = RC09_NATIVE_ZONES.clock!.width
    const fit = rc09FitFontCqw(clockZone, 7)
    expect(fit).toBeLessThan(rc09TypeScaleCqw(RC09_TYPE_SCALE_PX.clock))
    expect(rc09RungCqw(RC09_TYPE_SCALE_PX.clock, clockZone, 7)).toBe(fit)
    // The rendered numeral fits its zone by construction, in cqw and therefore at every size.
    expect(fit * 7 * 0.56).toBeLessThanOrEqual(clockZone)
  })

  it('honours the packet rung verbatim for every other rung, because they all fit', () => {
    expect(rc09RungCqw(RC09_TYPE_SCALE_PX.split, RC09_NATIVE_ZONES.split!.width, 6)).toBe(
      rc09TypeScaleCqw(RC09_TYPE_SCALE_PX.split)
    )
    expect(rc09RungCqw(RC09_TYPE_SCALE_PX.note, RC09_NATIVE_ZONES.note!.width, 9)).toBe(
      rc09TypeScaleCqw(RC09_TYPE_SCALE_PX.note)
    )
    expect(rc09RungCqw(RC09_TYPE_SCALE_PX.support, RC09_NATIVE_ZONES.support!.width / 3, 4)).toBe(
      rc09TypeScaleCqw(RC09_TYPE_SCALE_PX.support)
    )
  })

  it('refuses a nonsense fit request rather than emitting an infinite size', () => {
    expect(rc09FitFontCqw(0, 7)).toBe(0)
    expect(rc09FitFontCqw(41, 0)).toBe(0)
    expect(rc09FitFontCqw(Number.NaN, 7)).toBe(0)
  })
})

describe('RC-09 telemetry truth table', () => {
  it('renders the approved reference frame exactly as measured', () => {
    const model = modelFor(snapshot(), 0, { paceNote: REFERENCE_NOTE })
    expect(model.stageTimer.value).toBe('04:12.6')
    expect(model.split.value).toBe('-1.4')
    expect(model.splitDirection).toBe('gaining')
    expect(model.split.tone).toBe('good')
    expect(model.note.text).toBe('RIGHT 4')
    expect(model.note.blank).toBe(false)
    expect(model.note.glyph).toBe('right')
    expect(model.speed.value).toBe('112')
    expect(model.gear.value).toBe('4')
    expect(model.water.value).toBe('88')
    // The two readouts with no channel dash, exactly as the reference frame records them.
    expect(model.distanceToFinish.value).toBe('--.- KM')
    expect(model.noteDistance.value).toBe('--- M')
    // image-qa-v1: 4 of 9 discs lit, all in the `normal` family.
    expect(model.leds.filter((led) => led.active)).toHaveLength(4)
    expect(model.leds.filter((led) => led.active).every((led) => led.tone === 'normal')).toBe(true)
    // The whole alert layer is armed and silent in the reference frame.
    expect(rc09AlertLines(model)).toEqual([])
  })

  it('renders every packet dash state when no channel is available at all', () => {
    const model = modelFor(
      snapshot({
        currentLapTimeSec: undefined,
        deltaToBestSec: undefined,
        bestLapTimeSec: undefined,
        speedKmh: undefined,
        gear: undefined,
        waterTempC: undefined,
        rpm: undefined,
        maxRpm: undefined
      })
    )
    expect(model.stageTimer.value).toBe(RC09_DASH.stageTimer)
    expect(model.stageTimer.unavailable).toBe(true)
    expect(model.split.value).toBe(RC09_DASH.split)
    expect(model.split.unavailable).toBe(true)
    expect(model.splitDirection).toBe('none')
    expect(model.speed.value).toBe(RC09_DASH.speed)
    expect(model.gear.value).toBe(RC09_DASH.gear)
    expect(model.water.value).toBe(RC09_DASH.water)
    expect(model.distanceToFinish.value).toBe(RC09_DASH.distanceToFinish)
    expect(model.noteDistance.value).toBe(RC09_DASH.noteDistance)
    // Packet 16: the arc is dark whenever RPM is invalid.
    expect(model.leds.every((led) => !led.active && led.tone === 'dark')).toBe(true)
    // Packet 16 and 20: the note is blank, never a placeholder call.
    expect(model.note.blank).toBe(true)
    expect(model.note.text).toBe('')
    expect(model.roadbookLoaded).toBe(false)
  })

  it('formats the stage clock as mm:ss.m and never predicts one', () => {
    expect(rc09FormatStageTime(252.6)).toBe('04:12.6')
    expect(rc09FormatStageTime(0)).toBe('00:00.0')
    expect(rc09FormatStageTime(9.04)).toBe('00:09.0')
    expect(rc09FormatStageTime(603.94)).toBe('10:03.9')
    expect(rc09FormatStageTime(null)).toBe(RC09_DASH.stageTimer)
    expect(rc09FormatStageTime(Number.NaN)).toBe(RC09_DASH.stageTimer)
    expect(rc09FormatStageTime(-1)).toBe(RC09_DASH.stageTimer)
  })

  it('dashes the stage clock when the timing source falls silent, never freezing on it', () => {
    const value = snapshot()
    const receipts = createRc01ChannelReceipts(value, 0)
    const aux = createRc09AuxReceipts(value, 0)
    const quiet = createRc09DashboardModel(value, receipts, aux, RC09_CHANNEL_STALE_MS.stageTimer + 1)
    expect(quiet.stageTimer.value).toBe(RC09_DASH.stageTimer)
    expect(quiet.stageTimer.stale).toBe(true)
    expect(quiet.stageTimer.tone).toBe('muted')
  })

  it('formats the rolling split with a literal sign, so hue is never the only cue', () => {
    expect(rc09FormatSplit(-1.4)).toBe('-1.4')
    expect(rc09FormatSplit(2.44)).toBe('+2.4')
    expect(rc09FormatSplit(0)).toBe('0.0')
    expect(rc09FormatSplit(null)).toBe(RC09_DASH.split)
    expect(rc09FormatSplit(Number.NaN)).toBe(RC09_DASH.split)
  })

  it('refuses a split without a stored reference run, exactly as packet 16 requires', () => {
    const noReference = modelFor(snapshot({ bestLapTimeSec: undefined }))
    expect(noReference.split.value).toBe(RC09_DASH.split)
    expect(noReference.split.unavailable).toBe(true)
    expect(noReference.splitDirection).toBe('none')
    const noFeed = modelFor(snapshot({ deltaToBestSec: undefined }))
    expect(noFeed.split.value).toBe(RC09_DASH.split)
    expect(noFeed.split.unavailable).toBe(true)
  })

  it('greys the speed past its cadence and dashes it past the packet budget', () => {
    const value = snapshot()
    const receipts = createRc01ChannelReceipts(value, 0)
    const aux = createRc09AuxReceipts(value, 0)
    const greyed = createRc09DashboardModel(value, receipts, aux, RC09_CHANNEL_STALE_MS.speed + 1)
    expect(greyed.speed.value).toBe('112')
    expect(greyed.speed.stale).toBe(true)
    expect(greyed.speed.tone).toBe('muted')
    const dashed = createRc09DashboardModel(value, receipts, aux, RC09_SPEED_DASH_MS + 1)
    expect(dashed.speed.value).toBe(RC09_DASH.speed)
    expect(dashed.speed.unavailable).toBe(true)
  })

  it('never derives the gear from RPM or speed and never blanks it silently', () => {
    expect(rc09DisplayGear(4)).toBe('4')
    expect(rc09DisplayGear(0)).toBe('N')
    expect(rc09DisplayGear(-1)).toBe('R')
    expect(rc09DisplayGear(null)).toBe(RC09_DASH.gear)
    const noGear = modelFor(snapshot({ gear: undefined }))
    expect(noGear.gear.value).toBe(RC09_DASH.gear)
    expect(noGear.gear.unavailable).toBe(true)
    expect(noGear.speed.value).toBe('112')
    expect(rc09AuxChannelValue(snapshot({ gear: 3.5 }), 'gear')).toBeNull()
  })

  it('greys the water reading when its own sensor is invalid, never estimating it', () => {
    const invalid = modelFor(snapshot({ waterTempC: undefined, oilTempC: 104 }))
    expect(invalid.water.value).toBe(RC09_DASH.water)
    expect(invalid.water.unavailable).toBe(true)
    expect(invalid.water.tone).toBe('muted')
  })

  it('freezes and greys the engine speed past 200 ms, per packet 16', () => {
    const value = snapshot()
    const receipts = createRc01ChannelReceipts(value, 0)
    const aux = createRc09AuxReceipts(value, 0)
    const stale = createRc09DashboardModel(value, receipts, aux, 201)
    expect(stale.rpm.stale).toBe(true)
    expect(stale.rpmFresh).toBe(false)
    // Packet 16: the shift arc goes dark the moment the RPM channel cannot be trusted.
    expect(stale.leds.every((led) => !led.active)).toBe(true)
  })

  it('reads each aux channel strictly from its own source', () => {
    expect(rc09AuxChannelValue(snapshot(), 'stageTimer')).toBe(252.6)
    expect(rc09AuxChannelValue(snapshot(), 'speed')).toBe(112)
    expect(rc09AuxChannelValue(snapshot(), 'gear')).toBe(4)
    expect(rc09AuxChannelValue(snapshot(), 'water')).toBe(88)
    expect(rc09AuxChannelValue(snapshot({ currentLapTimeSec: -3 }), 'stageTimer')).toBeNull()
    expect(rc09AuxChannelValue(snapshot({ speedKmh: -1 }), 'speed')).toBeNull()
    expect(rc09AuxChannelValue(snapshot({ waterTempC: Number.NaN }), 'water')).toBeNull()
  })

  it('ages a channel out of the aux buffer instead of freezing on its last value', () => {
    const buffer = new Rc09AuxBuffer()
    buffer.ingest(snapshot(), 0)
    expect(buffer.receipts().get('water')?.value).toBe(88)
    // A snapshot without the channel writes no receipt, so the old one simply ages out.
    buffer.ingest(snapshot({ waterTempC: undefined }, 4_212_700), 100)
    expect(buffer.receipts().get('water')?.receivedAt).toBe(0)
    buffer.reset()
    expect(buffer.receipts().size).toBe(0)
  })
})

describe('RC-09 packet contradictions are resolved by omission, not invention', () => {
  it('documents every contradiction it deliberately does not render', () => {
    expect(Object.keys(RC09_PACKET_OMISSIONS).sort()).toEqual([
      'fuelReadout',
      'noteDistanceReadout',
      'signatureAccent',
      'stageDistanceReadout'
    ])
    for (const reason of Object.values(RC09_PACKET_OMISSIONS)) {
      expect(typeof reason).toBe('string')
      expect(reason.length).toBeGreaterThan(20)
    }
  })

  it('declares no stage-distance channel, so the marker can never be traced from the render', () => {
    expect(Object.keys(RC09_CHANNEL_STALE_MS)).not.toContain('stageDistance')
    expect(RC09_PACKET_OMISSIONS.stageDistanceReadout).toContain('16')
    // A circuit lap-distance percentage is NOT a rally stage position: mirroring it would be
    // exactly the invention section 16 forbids, so the lookups refuse it outright.
    const circuit = snapshot({ lapDistPct: 0.68, lapDistanceM: 3_400, trackLengthKm: 5.0 })
    expect(rc09StageDistanceM(circuit)).toBeNull()
    expect(rc09StageLengthM(circuit)).toBeNull()
    const model = modelFor(circuit)
    expect(model.stage.progress).toBeNull()
    expect(model.stage.available).toBe(false)
    expect(model.stage.sourceLabel).toBe('NO STAGE DISTANCE SOURCE')
    expect(model.distanceToFinish.value).toBe(RC09_DASH.distanceToFinish)
  })

  it('computes the fill and the marker arithmetically for the day the channel arrives', () => {
    // Normative override 4: computed, never measured off the picture. The reference's 0.68 is
    // composition only, and this is the arithmetic that would place a real marker.
    expect(rc09StageProgress(6_800, 10_000)).toBeCloseTo(0.68, 10)
    expect(rc09StageProgress(0, 10_000)).toBe(0)
    expect(rc09StageProgress(12_000, 10_000)).toBe(1)
    expect(rc09StageProgress(null, 10_000)).toBeNull()
    expect(rc09StageProgress(6_800, null)).toBeNull()
    expect(rc09StageProgress(6_800, 0)).toBeNull()
    expect(rc09StageProgress(-5, 10_000)).toBeNull()
  })

  it('declares no distance-to-waypoint channel, so both surfaces dash', () => {
    expect(Object.keys(RC09_CHANNEL_STALE_MS)).not.toContain('noteDistance')
    expect(RC09_PACKET_OMISSIONS.noteDistanceReadout).toContain('16')
    const model = modelFor(snapshot(), 0, { paceNote: { text: 'CAUTION', hazard: true, sequence: 3 } })
    expect(model.noteDistance.value).toBe('--- M')
    expect(model.noteDistance.unavailable).toBe(true)
    expect(model.noteDistance.raw).toBeNull()
  })

  it('declares no fuel channel, because neither grammar gives fuel a zone', () => {
    expect(Object.keys(RC09_CHANNEL_STALE_MS)).not.toContain('fuel')
    expect(RC09_PACKET_OMISSIONS.fuelReadout).toContain('11.1')
    const model = modelFor(snapshot({ fuelLiters: 32.4 }))
    expect(model).not.toHaveProperty('fuel')
    const html = markup(snapshot({ fuelLiters: 32.4 }), nativeConfig)
    expect(html).not.toContain('rc09-fuel')
    expect(html).not.toContain('FUEL')
    expect(html).not.toContain('32.4')
  })

  it('binds the signature token to nothing, because it is not separable from caution', () => {
    expect(RC09_TOKENS.signature).toBe('#E8B84B')
    expect(RC09_TOKENS.caution).toBe('#EEA82F')
    expect(RC09_PACKET_OMISSIONS.signatureAccent).toContain('caution')
    // 0xE8-0xEE + 0xB8-0xA8 + 0x4B-0x2F = 6 + 16 + 28 = 50 city-block, 33 in Euclidean RGB.
    const rgb = (hex: string): number[] => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16))
    const [sr, sg, sb] = rgb(RC09_TOKENS.signature)
    const [cr, cg, cb] = rgb(RC09_TOKENS.caution)
    expect(Math.round(Math.hypot(sr - cr, sg - cg, sb - cb))).toBe(33)
    const html = markup(snapshot(), nativeConfig)
    expect(html.toLowerCase()).not.toContain('e8b84b')
    expect(html).not.toContain('rc09-signature')
  })

  it('renders no lap, position, gap-to-rival, radar or timing-tower module anywhere', () => {
    const html = markup(snapshot({ position: 3, lapDistPct: 0.68 }), nativeConfig)
    for (const banned of ['LAP', 'POSITION', 'GAP', 'RADAR', 'TOWER', 'P03']) {
      expect(html).not.toContain(banned)
    }
  })
})

describe('RC-09 co-driver notes come only from a loaded roadbook', () => {
  it('accepts only the roadbook payloads it recognises', () => {
    expect(rc09PaceNoteFromEvent('RIGHT 4')).toEqual({ text: 'RIGHT 4', hazard: false, sequence: 0 })
    expect(rc09PaceNoteFromEvent({ note: ' left 3 ', sequence: 7 })).toEqual({
      text: 'LEFT 3',
      hazard: false,
      sequence: 7
    })
    expect(rc09PaceNoteFromEvent({ text: 'CAUTION CREST', hazard: true, sequence: 8 })).toEqual({
      text: 'CAUTION CREST',
      hazard: true,
      sequence: 8
    })
    expect(rc09PaceNoteFromEvent('clear')).toBe('clear')
    expect(rc09PaceNoteFromEvent(null)).toBe('clear')
    // Anything malformed leaves the cue blank rather than printing a fragment.
    expect(rc09PaceNoteFromEvent('')).toBeNull()
    expect(rc09PaceNoteFromEvent('   ')).toBeNull()
    expect(rc09PaceNoteFromEvent('RIGHT 4 OVER A LONG CREST INTO')).toBeNull()
    expect(rc09PaceNoteFromEvent({ severity: 4 })).toBeNull()
    expect(rc09PaceNoteFromEvent(4)).toBeNull()
  })

  it('draws the glyph from the call"s own direction word and never from telemetry', () => {
    expect(rc09NoteGlyph({ text: 'RIGHT 4', hazard: false, sequence: 0 })).toBe('right')
    expect(rc09NoteGlyph({ text: 'LEFT 2', hazard: false, sequence: 0 })).toBe('left')
    expect(rc09NoteGlyph({ text: 'STRAIGHT 300', hazard: false, sequence: 0 })).toBe('straight')
    expect(rc09NoteGlyph({ text: 'RIGHT 4', hazard: true, sequence: 0 })).toBe('hazard')
    expect(rc09NoteGlyph(null)).toBe('none')
  })

  it('reads the severity the co-driver actually called, never inferring one', () => {
    expect(rc09NoteSeverity({ text: 'RIGHT 4', hazard: false, sequence: 0 })).toBe(4)
    expect(rc09NoteSeverity({ text: '1 LEFT', hazard: false, sequence: 0 })).toBe(1)
    expect(rc09NoteSeverity({ text: 'CREST', hazard: false, sequence: 0 })).toBeNull()
    expect(rc09NoteSeverity({ text: 'STRAIGHT 300', hazard: false, sequence: 0 })).toBeNull()
    expect(rc09NoteSeverity(null)).toBeNull()
  })

  it('keeps the cue blank until a roadbook is loaded, on every telemetry frame', () => {
    const fast = modelFor(snapshot({ speedKmh: 180, gear: 6 }))
    expect(fast.note.blank).toBe(true)
    expect(fast.note.text).toBe('')
    expect(fast.note.glyph).toBe('none')
    expect(fast.roadbookLoaded).toBe(false)
  })
})

describe('RC-09 stage profile is measured, never reconstructed', () => {
  it('opens a segment only for a note the roadbook actually delivered', () => {
    const history = new Rc09NoteHistory()
    history.observe(null)
    expect(history.entries()).toHaveLength(0)
    history.observe({ text: 'RIGHT 4', hazard: false, sequence: 1 })
    history.observe({ text: 'RIGHT 4', hazard: false, sequence: 1 })
    history.observe({ text: 'LEFT 2', hazard: false, sequence: 2 })
    const entries = history.entries()
    expect(entries).toHaveLength(2)
    expect(entries.map((entry) => entry.text)).toEqual(['RIGHT 4', 'LEFT 2'])
    expect(entries.map((entry) => entry.severity)).toEqual([4, 2])
  })

  it('records an ungraded call as ungraded rather than assigning a plausible severity', () => {
    const history = new Rc09NoteHistory()
    history.observe({ text: 'CREST', hazard: false, sequence: 1 })
    expect(history.entries()[0].severity).toBeNull()
    const bars = rc09ProfileBars(history.entries())
    expect(bars[0].severity).toBeNull()
    expect(bars[0].heightPercent).toBe(12)
  })

  it('bounds the history and clones without sharing state', () => {
    const history = new Rc09NoteHistory()
    for (let index = 0; index < RC09_NOTE_HISTORY_LIMIT + 6; index += 1) {
      history.observe({ text: `RIGHT ${(index % 6) + 1}`, hazard: false, sequence: index })
    }
    expect(history.entries()).toHaveLength(RC09_NOTE_HISTORY_LIMIT)
    const clone = history.clone()
    clone.observe({ text: 'LEFT 1', hazard: false, sequence: 999 })
    expect(history.entries().at(-1)?.text).not.toBe('LEFT 1')
    history.reset()
    expect(history.entries()).toHaveLength(0)
  })

  it('lays the measured notes across the strip and makes a tighter corner taller', () => {
    const bars = rc09ProfileBars([
      { sequence: 1, text: 'RIGHT 1', severity: 1, hazard: false },
      { sequence: 2, text: 'LEFT 6', severity: 6, hazard: false }
    ])
    expect(bars).toHaveLength(2)
    expect(bars[0].leftPercent).toBe(0)
    expect(bars[1].leftPercent).toBe(50)
    expect(bars[0].widthPercent).toBe(50)
    expect(bars[0].heightPercent).toBeGreaterThan(bars[1].heightPercent)
    expect(rc09ProfileBars([])).toEqual([])
  })
})

describe('RC-09 shift arc is a real arc at the support-strip edge', () => {
  it('draws a genuine shallow arc rather than the reference"s flat row', () => {
    // Normative override 3: the approved frame measured a 1 px rise. A real arc is drawn instead.
    expect(RC09_LED_ARC_RISE_PCT).toBeGreaterThan(1)
    const offsets = Array.from({ length: RC09_LED_COUNT }, (_unused, index) => rc09LedArcOffsetPct(index))
    expect(offsets[0]).toBe(RC09_LED_ARC_RISE_PCT)
    expect(offsets.at(-1)).toBe(RC09_LED_ARC_RISE_PCT)
    expect(offsets[(RC09_LED_COUNT - 1) / 2]).toBe(0)
    // Symmetric, and monotonically rising away from the centre disc.
    for (let index = 0; index < RC09_LED_COUNT; index += 1) {
      expect(offsets[index]).toBeCloseTo(offsets[RC09_LED_COUNT - 1 - index], 6)
    }
    for (let index = (RC09_LED_COUNT - 1) / 2; index < RC09_LED_COUNT - 1; index += 1) {
      expect(offsets[index + 1]).toBeGreaterThan(offsets[index])
    }
    expect(rc09LedArcOffsetPct(-1)).toBe(0)
    expect(rc09LedArcOffsetPct(RC09_LED_COUNT)).toBe(0)
  })

  it('spaces the discs arithmetically rather than hand-placing them', () => {
    expect(rc09LedLeftPct(0)).toBe(6)
    expect(rc09LedLeftPct((RC09_LED_COUNT - 1) / 2)).toBe(50)
    expect(rc09LedLeftPct(RC09_LED_COUNT - 1)).toBe(94)
    const pitch = rc09LedLeftPct(1) - rc09LedLeftPct(0)
    for (let index = 1; index < RC09_LED_COUNT - 1; index += 1) {
      expect(rc09LedLeftPct(index + 1) - rc09LedLeftPct(index)).toBeCloseTo(pitch, 6)
    }
  })

  it('lights the discs from the packet"s gear-aware rpm/maxRpm and nothing else', () => {
    expect(rc09ShiftThresholdForGear(4)).toBe(0.92)
    // The approved reference frame: 3400 / 7600 in 4th gear is 4 of 9 discs.
    expect(buildRc09LedStates(3_400 / 7_600, true, 4).filter((led) => led.active)).toHaveLength(4)
    expect(buildRc09LedStates(0.95, true, 4).filter((led) => led.active)).toHaveLength(RC09_LED_COUNT)
    expect(buildRc09LedStates(0, true, 4).filter((led) => led.active)).toHaveLength(0)
    // Packet 16: never light the arc from a guessed RPM.
    expect(buildRc09LedStates(0.95, false, 4).every((led) => !led.active)).toBe(true)
    expect(buildRc09LedStates(null, true, 4).every((led) => !led.active)).toBe(true)
    expect(buildRc09LedStates(Number.NaN, true, 4).every((led) => !led.active)).toBe(true)
  })

  it('keeps the ramp free of alert colours until the top of the band', () => {
    const mid = buildRc09LedStates(0.5, true, 4)
    expect(mid.filter((led) => led.active).every((led) => led.tone === 'normal')).toBe(true)
    const top = buildRc09LedStates(1, true, 4)
    expect(top[8].tone).toBe('danger')
    expect(top[6].tone).toBe('caution')
    expect(top[5].tone).toBe('normal')
  })
})

describe('RC-09 trigger-only alerts', () => {
  it('starts silent, with no alert latched by construction', () => {
    const state = createRc09AlertState()
    expect(state.cautionWaypoint.active).toBe(false)
    expect(state.splitLoss.active).toBe(false)
    expect(state.mechanical.active).toBe(false)
    expect(rc09AlertLines(modelFor(snapshot(), 0, { paceNote: REFERENCE_NOTE }))).toEqual([])
  })

  it('raises the caution waypoint on the roadbook event and holds it for 2 s minimum', () => {
    let state = createRc09AlertState()
    state = advanceRc09Alerts(state, alertInput({ nowMs: 0, hazardSequence: 5 }))
    expect(state.cautionWaypoint.active).toBe(true)
    expect(state.cautionWaypoint.sequence).toBe(5)
    // The waypoint is passed at 500 ms, but the packet's minimum display keeps it up.
    state = advanceRc09Alerts(state, alertInput({ nowMs: 500, hazardSequence: null }))
    expect(state.cautionWaypoint.active).toBe(true)
    state = advanceRc09Alerts(
      state,
      alertInput({ nowMs: RC09_CAUTION_MIN_VISIBLE_MS + 1, hazardSequence: null })
    )
    expect(state.cautionWaypoint.active).toBe(false)
    expect(state.cautionWaypoint.sequence).toBeNull()
  })

  it('lets the acknowledge macro dismiss a caution, but never before the 2 s minimum', () => {
    let state = createRc09AlertState()
    state = advanceRc09Alerts(state, alertInput({ nowMs: 0, hazardSequence: 5 }))
    state = advanceRc09Alerts(state, alertInput({ nowMs: 300, hazardSequence: 5, acknowledgedSequence: 5 }))
    expect(state.cautionWaypoint.active).toBe(true)
    state = advanceRc09Alerts(
      state,
      alertInput({ nowMs: RC09_CAUTION_MIN_VISIBLE_MS + 1, hazardSequence: 5, acknowledgedSequence: 5 })
    )
    expect(state.cautionWaypoint.active).toBe(false)
    // Acknowledging an older waypoint cannot silence the NEXT one.
    state = advanceRc09Alerts(
      state,
      alertInput({ nowMs: 5_000, hazardSequence: 6, acknowledgedSequence: 5 })
    )
    expect(state.cautionWaypoint.active).toBe(true)
    expect(state.cautionWaypoint.sequence).toBe(6)
  })

  it('engages the split loss only above +2.0 s and only after 1 s', () => {
    let state = createRc09AlertState()
    state = advanceRc09Alerts(state, alertInput({ nowMs: 0, splitSec: RC09_SPLIT_LOSS_THRESHOLD_SEC }))
    expect(state.splitLoss.active).toBe(false)
    state = advanceRc09Alerts(state, alertInput({ nowMs: 0, splitSec: 2.4 }))
    expect(state.splitLoss.active).toBe(false)
    state = advanceRc09Alerts(state, alertInput({ nowMs: RC09_SPLIT_LOSS_ENGAGE_MS - 1, splitSec: 2.4 }))
    expect(state.splitLoss.active).toBe(false)
    state = advanceRc09Alerts(state, alertInput({ nowMs: RC09_SPLIT_LOSS_ENGAGE_MS, splitSec: 2.4 }))
    expect(state.splitLoss.active).toBe(true)
    // Recovery clears it at once: the packet's clear condition is "split recovers".
    state = advanceRc09Alerts(state, alertInput({ nowMs: RC09_SPLIT_LOSS_ENGAGE_MS + 1, splitSec: 1.2 }))
    expect(state.splitLoss.active).toBe(false)
    expect(state.splitLoss.pendingSinceMs).toBeNull()
  })

  it('unlatches the split loss the moment the split feed goes away', () => {
    let state = createRc09AlertState()
    state = advanceRc09Alerts(state, alertInput({ nowMs: 0, splitSec: 3.5 }))
    state = advanceRc09Alerts(state, alertInput({ nowMs: RC09_SPLIT_LOSS_ENGAGE_MS, splitSec: 3.5 }))
    expect(state.splitLoss.active).toBe(true)
    state = advanceRc09Alerts(state, alertInput({ nowMs: RC09_SPLIT_LOSS_ENGAGE_MS + 10, splitSec: null }))
    expect(state.splitLoss.active).toBe(false)
  })

  it('engages a mechanical warning per reading after 3 s and clears back in range', () => {
    let state = createRc09AlertState()
    state = advanceRc09Alerts(state, alertInput({ nowMs: 0, outOfRange: ['WATER'] }))
    expect(state.mechanical.active).toBe(false)
    state = advanceRc09Alerts(state, alertInput({ nowMs: RC09_MECHANICAL_ENGAGE_MS - 1, outOfRange: ['WATER'] }))
    expect(state.mechanical.active).toBe(false)
    state = advanceRc09Alerts(state, alertInput({ nowMs: RC09_MECHANICAL_ENGAGE_MS, outOfRange: ['WATER'] }))
    expect(state.mechanical.active).toBe(true)
    expect(state.mechanical.faults).toEqual(['WATER'])
    // The oil line runs its own debounce and is not marked by the coolant fault.
    state = advanceRc09Alerts(
      state,
      alertInput({ nowMs: RC09_MECHANICAL_ENGAGE_MS + 10, outOfRange: ['WATER', 'OIL'] })
    )
    expect(state.mechanical.faults).toEqual(['WATER'])
    state = advanceRc09Alerts(state, alertInput({ nowMs: 2 * RC09_MECHANICAL_ENGAGE_MS + 20, outOfRange: ['WATER', 'OIL'] }))
    expect(state.mechanical.faults).toEqual([...RC09_MECHANICAL_FAULTS])
    state = advanceRc09Alerts(state, alertInput({ nowMs: 2 * RC09_MECHANICAL_ENGAGE_MS + 30, outOfRange: [] }))
    expect(state.mechanical.active).toBe(false)
    expect(state.mechanical.faults).toEqual([])
  })

  it('judges a mechanical reading only against its declared configuration range', () => {
    expect(RC09_WATER_RANGE_C).toEqual({ minC: 60, maxC: 110 })
    expect(
      rc09OutOfRangeFaults({ waterTempC: 88, oilPressureKpa: 420, rpm: 3_400, rpmFresh: true })
    ).toEqual([])
    expect(
      rc09OutOfRangeFaults({ waterTempC: 118, oilPressureKpa: 420, rpm: 3_400, rpmFresh: true })
    ).toEqual(['WATER'])
    expect(
      rc09OutOfRangeFaults({
        waterTempC: 88,
        oilPressureKpa: RC09_OIL_PRESSURE_RANGE_KPA.minKpa - 1,
        rpm: 3_400,
        rpmFresh: true
      })
    ).toEqual(['OIL'])
    // A sensor that never reported cannot raise a fault it cannot measure.
    expect(rc09OutOfRangeFaults({ waterTempC: null, oilPressureKpa: null, rpm: null, rpmFresh: false })).toEqual([])
    // A stopped engine reads zero pressure; that is the correct reading, not a warning.
    expect(
      rc09OutOfRangeFaults({ waterTempC: 88, oilPressureKpa: 0, rpm: RC09_OIL_PRESSURE_MIN_RPM - 1, rpmFresh: true })
    ).toEqual([])
    expect(rc09OutOfRangeFaults({ waterTempC: 88, oilPressureKpa: 0, rpm: 3_400, rpmFresh: false })).toEqual([])
  })

  it('never prints the configured ranges: only the measured value and the alert line', () => {
    const view = render(createElement(RaceconRc09DashWidget, { snapshot: snapshot(), config: nativeConfig }))
    const text = view.container.textContent ?? ''
    expect(text).not.toContain(String(RC09_WATER_RANGE_C.minC))
    expect(text).not.toContain(String(RC09_WATER_RANGE_C.maxC))
    expect(text).not.toContain(String(RC09_OIL_PRESSURE_RANGE_KPA.minKpa))
    expect(text).toContain('88')
  })

  it('clears every alert whose input is missing, stale or refused', () => {
    let state = createRc09AlertState()
    state = advanceRc09Alerts(state, alertInput({ nowMs: 0, hazardSequence: 4, splitSec: 3.2, outOfRange: ['WATER'] }))
    state = advanceRc09Alerts(
      state,
      alertInput({ nowMs: 4_000, hazardSequence: 4, splitSec: 3.2, outOfRange: ['WATER'] })
    )
    expect(state.cautionWaypoint.active).toBe(true)
    expect(state.splitLoss.active).toBe(true)
    expect(state.mechanical.active).toBe(true)

    const blind = modelFor(
      snapshot({ deltaToBestSec: undefined, bestLapTimeSec: undefined, waterTempC: undefined })
    )
    const cleared = clearInvalidRc09Alerts(state, blind)
    expect(cleared.cautionWaypoint.active).toBe(false)
    expect(cleared.splitLoss.active).toBe(false)
    expect(cleared.mechanical.active).toBe(false)
  })

  it('derives every alert input from the model, gated on freshness', () => {
    const hazard = modelFor(snapshot(), 0, { paceNote: { text: 'CAUTION', hazard: true, sequence: 9 } })
    const input = rc09AlertInputForModel(hazard, 1_000, 9)
    expect(input.hazardSequence).toBe(9)
    expect(input.acknowledgedSequence).toBe(9)
    expect(input.splitSec).toBe(-1.4)
    expect(input.outOfRange).toEqual([])
    // A routine note is not a hazard, so it can never raise the caution waypoint.
    const routine = rc09AlertInputForModel(modelFor(snapshot(), 0, { paceNote: REFERENCE_NOTE }), 0)
    expect(routine.hazardSequence).toBeNull()
    // A stale split cannot engage the split-loss alert.
    const value = snapshot({ deltaToBestSec: 4.4 })
    const stale = createRc09DashboardModel(
      value,
      createRc01ChannelReceipts(value, 0),
      createRc09AuxReceipts(value, 0),
      5_000
    )
    expect(rc09AlertInputForModel(stale, 5_000).splitSec).toBeNull()
  })

  it('surfaces every alert line in words, never in colour alone', () => {
    const alerts = advanceRc09Alerts(
      advanceRc09Alerts(
        createRc09AlertState(),
        alertInput({ nowMs: 0, hazardSequence: 2, splitSec: 4, outOfRange: ['WATER'] })
      ),
      alertInput({ nowMs: 4_000, hazardSequence: 2, splitSec: 4, outOfRange: ['WATER'] })
    )
    const model = modelFor(snapshot({ waterTempC: 120, deltaToBestSec: 4 }), 0, {
      alerts,
      paceNote: { text: 'CAUTION', hazard: true, sequence: 2 }
    })
    expect(rc09AlertLines(model)).toEqual(['CAUTION WAYPOINT', 'SPLIT LOSS', 'WATER WARNING'])
  })
})

describe('RC-09 responsive contract', () => {
  it('resolves the native, app and compact layouts from the content box', () => {
    expect(rc09LayoutForContentBox(800, 480)).toBe('native')
    expect(rc09LayoutForContentBox(801, 479)).toBe('native')
    expect(rc09LayoutForContentBox(1024, 600)).toBe('app')
    expect(rc09LayoutForContentBox(1920, 1080)).toBe('app')
    expect(rc09LayoutForContentBox(640, 520)).toBe('compact')
    expect(rc09LayoutForContentBox(0, 0)).toBe('app')
  })

  it('classifies phone and landscape compact modes', () => {
    expect(rc09CompactModeForContentBox(400, 800)).toBe('phone')
    expect(rc09CompactModeForContentBox(900, 400)).toBe('landscape')
    expect(rc09CompactModeForContentBox(640, 520)).toBe('standard')
    expect(rc09CompactModeForContentBox(1024, 600)).toBe('standard')
  })

  it('emits portrait geometry only at the phone breakpoint', () => {
    expect(rc09PhoneGeometryForContentBox(1024, 600)).toBeNull()
    expect(rc09PhoneGeometryForContentBox(900, 400)).toBeNull()
    const geometry = rc09PhoneGeometryForContentBox(400, 800)
    expect(geometry).not.toBeNull()
    expect(geometry!.inset).toBe(12)
    expect(geometry!.clockHeight).toBeGreaterThan(geometry!.chipHeight)
  })

  it('reflows rather than scaling: the app adds a module the native canvas does not have', () => {
    const native = rc09ZonesForLayout('native')
    const app = rc09ZonesForLayout('app')
    expect(native.profile).toBeUndefined()
    expect(app.profile).toBeTruthy()
    // A uniform scale would keep every proportion; the app timeline is full-bleed instead.
    expect(app.timeline!.width).toBe(100)
    expect(native.timeline!.width).toBe(96)
    for (const mode of ['standard', 'landscape', 'phone'] as const) {
      expect(rc09ZonesForLayout('compact', mode).profile).toBeUndefined()
    }
  })

  it('keeps all three alert surfaces present at every breakpoint', () => {
    for (const size of BREAKPOINTS) {
      const layout = rc09LayoutForContentBox(size.width, size.height)
      const mode = rc09CompactModeForContentBox(size.width, size.height)
      const zones = rc09ZonesForLayout(layout, mode)
      // caution waypoint lives in the note tile, split loss in the split chip, mechanical in the
      // support strip — all three exist in every grammar.
      expect(zones.note).toBeTruthy()
      expect(zones.split).toBeTruthy()
      expect(zones.support).toBeTruthy()
    }
  })
})

describe('RC-09 rendering', () => {
  it('renders the canonical DOM contract as a linear stage display', () => {
    const html = markup(snapshot(), nativeConfig)
    assertClean(html)
    expect(html).toContain('data-widget="raceconRc09Dash"')
    expect(html).toContain('data-rc09-layout="native"')
    expect(html).toContain('data-rc09-native-size="800x480"')
    expect(html).toContain('data-rc09-zone="timeline"')
    expect(html).toContain('data-rc09-zone="clock"')
    expect(html).toContain('data-rc09-zone="split"')
    expect(html).toContain('data-rc09-zone="note"')
    expect(html).toContain('data-rc09-zone="support"')
    expect(html).toContain('STAGE TIME')
    expect(html).toContain('SPLIT')
    expect(html).toContain('NOTE')
    expect(html).toContain('SPEED')
    expect(html).toContain('GEAR')
    expect(html).toContain('WATER')
  })

  it('renders the packet 11.1 zone geometry inline, including the corrected note tile', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('left:2%;top:8.3%;width:96%;height:12.5%')
    expect(html).toContain('left:2%;top:25%;width:52.5%;height:37.5%')
    expect(html).toContain('left:57%;top:25%;width:41%;height:18.8%')
    expect(html).toContain('left:57%;top:45.8%;width:41%;height:20%')
    expect(html).toContain('left:2%;top:66.7%;width:96%;height:29.2%')
    // The packet's own 25 % tile would have written this instead, and it overlaps the strip.
    expect(html).not.toContain('top:45.8%;width:41%;height:25%')
  })

  it('renders the water unit as degC, per normative override 6', () => {
    const view = render(createElement(RaceconRc09DashWidget, { snapshot: snapshot(), config: nativeConfig }))
    const water = view.container.querySelector('[data-rc09-mini="water"]')
    expect(water?.textContent).toContain('degC')
    expect(view.container.querySelector('[data-testid="rc09-water"]')?.textContent).toBe('88')
  })

  it('dashes both channel-less readouts and draws no marker at the reference"s 68 %', () => {
    const view = render(
      createElement(RaceconRc09DashWidget, {
        snapshot: snapshot({ lapDistPct: 0.68, lapDistanceM: 3_400 }),
        config: nativeConfig
      })
    )
    expect(view.container.querySelector('[data-testid="rc09-distance-to-finish"]')?.textContent).toBe(
      'TO FIN --.- KM'
    )
    expect(view.container.querySelector('[data-testid="rc09-note-distance"]')?.textContent).toBe('--- M')
    expect(view.container.querySelector('[data-testid="rc09-timeline-marker"]')).toBeNull()
    expect(view.container.querySelector('[data-testid="rc09-timeline-fill"]')).toBeNull()
    expect(view.container.querySelector('[data-testid="rc09-timeline-empty"]')?.textContent).toBe(
      'NO STAGE DISTANCE SOURCE'
    )
    expect(view.container.querySelector('.rc09-widget')?.getAttribute('data-rc09-stage-source')).toBe(
      'unavailable'
    )
  })

  it('renders the shift arc at the support-strip edge with a real per-disc rise', () => {
    const view = render(createElement(RaceconRc09DashWidget, { snapshot: snapshot(), config: nativeConfig }))
    const support = view.container.querySelector('[data-testid="rc09-support"]')!
    const arc = support.querySelector('[data-testid="rc09-arc"]')
    expect(arc).not.toBeNull()
    const leds = view.container.querySelectorAll<HTMLElement>('[data-testid="rc09-led"]')
    expect(leds).toHaveLength(RC09_LED_COUNT)
    expect(arc?.getAttribute('data-rc09-lit')).toBe('4')
    expect(leds[0].style.bottom).toBe(`${RC09_LED_ARC_RISE_PCT}%`)
    expect(leds[(RC09_LED_COUNT - 1) / 2].style.bottom).toBe('0%')
    expect(leds[0].dataset.rc09LedTone).toBe('normal')
    expect(leds[8].dataset.rc09LedTone).toBe('dark')
  })

  it('keeps every alert surface absent in the silent reference frame', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('data-rc09-alerts="silent"')
    expect(html).not.toContain('data-testid="rc09-caution-waypoint"')
    expect(html).not.toContain('data-testid="rc09-split-loss"')
    expect(html).not.toContain('data-testid="rc09-mechanical"')
    expect(html).not.toContain('data-rc09-caution="true"')
    expect(html).not.toContain('data-rc09-faulted="true"')
  })

  it('reveals the stage-profile strip only at 1024x600', () => {
    const app = markup(snapshot(), config)
    expect(app).toContain('data-rc09-layout="app"')
    expect(app).toContain('data-testid="rc09-profile"')
    expect(app).toContain('STAGE PROFILE')
    expect(app).toContain('NO ROADBOOK')

    const native = markup(snapshot(), nativeConfig)
    expect(native).not.toContain('data-testid="rc09-profile"')
    expect(native).not.toContain('STAGE PROFILE')
  })

  it('renders a clean, dash-only frame with no telemetry at all', () => {
    const html = markup(null, nativeConfig)
    assertClean(html)
    expect(html).toContain('data-widget="raceconRc09Dash"')
    expect(html).toContain('data-rc09-roadbook="absent"')
    expect(html).toContain('data-rc09-stage-source="unavailable"')
    expect(html).toContain('data-rc09-alerts="silent"')
    expect(html).toContain('--:--.-')
    expect(html).toContain('--.- KM')
    expect(html).toContain('--- M')
  })

  it('refuses mock and replay telemetry and raises no alert from it', () => {
    const mock = markup(snapshot({ sim: 'mock' } as Partial<TelemetrySnapshot>), nativeConfig)
    expect(mock).toContain('data-rc09-buffer-state="mock-telemetry"')
    expect(mock).toContain('--:--.-')
    expect(mock).toContain('data-rc09-alerts="silent"')

    const replay = markup(
      snapshot({ replayContext: { state: 'replay' } } as Partial<TelemetrySnapshot>),
      nativeConfig
    )
    expect(replay).toContain('data-rc09-buffer-state="replay-telemetry"')
    expect(replay).toContain('--:--.-')
    expect(replay).toContain('data-rc09-alerts="silent"')
  })

  it('exposes the compact mode attribute only in the compact layout', () => {
    const compact = markup(snapshot(), { ...config, position: { x: 0, y: 0, width: 640, height: 520 } })
    expect(compact).toContain('data-rc09-layout="compact"')
    expect(compact).toContain('data-rc09-compact-mode="standard"')
    expect(markup(snapshot(), nativeConfig)).not.toContain('data-rc09-compact-mode')
  })
})

describe('RC-09 shares the RC-01 fail-closed ingest buffer', () => {
  it('accepts a live identified snapshot and rejects an unidentified one', () => {
    const buffer = new Rc01LiveTelemetryBuffer()
    expect(buffer.ingest(snapshot(), 0).accepted).toBe(true)
    const orphan = new Rc01LiveTelemetryBuffer()
    const result = orphan.ingest(snapshot({ sessionUniqueId: undefined } as Partial<TelemetrySnapshot>), 0)
    expect(result.accepted).toBe(false)
  })
})

describe('RC-09 live stage surfaces', () => {
  /**
   * Frames are pushed at 20 Hz so the packet's tightest budget (the 50 ms gear channel) is never
   * missed between steps: a test that jumped straight to a deadline would correctly find every
   * alert disarmed by staleness rather than by its own trigger.
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
      createElement(RaceconRc09DashWidget, {
        snapshot: snapshot(initial, 1_000),
        config: cfg,
        monotonicClock
      })
    )
    const frame = (value: TelemetrySnapshot | null): void => {
      view.rerender(createElement(RaceconRc09DashWidget, { snapshot: value, config: cfg, monotonicClock }))
    }
    const push = (atMs: number, overrides?: Partial<TelemetrySnapshot>): void => {
      if (overrides) current = { ...current, ...overrides }
      if (atMs <= monotonicMs) {
        frame(snapshot(current, 1_000 + monotonicMs))
        return
      }
      while (monotonicMs < atMs) {
        const step = Math.min(40, atMs - monotonicMs)
        monotonicMs += step
        act(() => {
          vi.advanceTimersByTime(step)
        })
        frame(snapshot(current, 1_000 + monotonicMs))
      }
    }
    return { push, frame, root: () => view.container.querySelector<HTMLElement>('.rc09-widget')!, view }
  }

  function loadRoadbook(detail: unknown): void {
    act(() => {
      window.dispatchEvent(new CustomEvent(RC09_ROADBOOK_EVENT, { detail }))
    })
  }

  function acknowledgeCaution(): void {
    act(() => {
      window.dispatchEvent(new CustomEvent(RC09_CAUTION_ACK_EVENT))
    })
  }

  it('reproduces the approved reference frame: gaining split, routine note, silent alerts', () => {
    const { root, view } = mount()
    loadRoadbook({ note: 'RIGHT 4', sequence: 12 })
    const q = (id: string): string => view.container.querySelector(`[data-testid="${id}"]`)?.textContent ?? ''
    expect(q('rc09-stage-timer')).toBe('04:12.6')
    expect(q('rc09-split-value')).toBe('-1.4')
    expect(q('rc09-note-value')).toBe('RIGHT 4')
    expect(q('rc09-note-distance')).toBe('--- M')
    expect(q('rc09-distance-to-finish')).toBe('TO FIN --.- KM')
    expect(q('rc09-speed')).toBe('112')
    expect(q('rc09-gear')).toBe('4')
    expect(q('rc09-water')).toBe('88')
    expect(root().dataset.rc09SplitState).toBe('gaining')
    expect(root().dataset.rc09Roadbook).toBe('loaded')
    expect(root().dataset.rc09Alerts).toBe('silent')
    expect(view.container.querySelector('[data-testid="rc09-note-glyph"]')?.getAttribute('data-rc09-glyph')).toBe(
      'right'
    )
  })

  it('keeps the note cue blank until the roadbook is loaded and blanks it again on unload', () => {
    const { root, view } = mount()
    expect(root().dataset.rc09Roadbook).toBe('absent')
    expect(view.container.querySelector('[data-testid="rc09-note-value"]')?.textContent).toBe('')
    expect(view.container.querySelector('[data-testid="rc09-note-glyph"]')).toBeNull()
    loadRoadbook({ note: 'LEFT 3', sequence: 1 })
    expect(view.container.querySelector('[data-testid="rc09-note-value"]')?.textContent).toBe('LEFT 3')
    loadRoadbook('clear')
    expect(root().dataset.rc09Roadbook).toBe('absent')
    expect(view.container.querySelector('[data-testid="rc09-note-value"]')?.textContent).toBe('')
  })

  it('ignores a malformed roadbook payload outright rather than printing a fragment', () => {
    const { root, view } = mount()
    loadRoadbook({ note: 'RIGHT 4', sequence: 2 })
    loadRoadbook({ severity: 5 })
    expect(view.container.querySelector('[data-testid="rc09-note-value"]')?.textContent).toBe('RIGHT 4')
    expect(root().dataset.rc09Roadbook).toBe('loaded')
  })

  it('raises the caution waypoint from a roadbook hazard and dismisses it with the macro', () => {
    const { push, root, view } = mount()
    loadRoadbook({ note: 'CAUTION CREST', hazard: true, sequence: 4 })
    expect(root().dataset.rc09Alerts).toBe('active')
    expect(root().dataset.rc09AlertKeys).toContain('CAUTION WAYPOINT')
    expect(view.container.querySelector('[data-testid="rc09-caution-waypoint"]')?.textContent).toBe(
      'CAUTION --- M'
    )
    expect(view.container.querySelector('[data-testid="rc09-note-glyph"]')?.getAttribute('data-rc09-glyph')).toBe(
      'hazard'
    )
    // The macro cannot dismiss it before the packet's 2 s minimum display.
    acknowledgeCaution()
    expect(root().dataset.rc09Alerts).toBe('active')
    push(RC09_CAUTION_MIN_VISIBLE_MS + 200)
    expect(root().dataset.rc09Alerts).toBe('silent')
    expect(view.container.querySelector('[data-testid="rc09-caution-waypoint"]')).toBeNull()
  })

  it('escalates the split chip only after the packet debounce and de-escalates on recovery', () => {
    const { push, root, view } = mount({ deltaToBestSec: 3.1 })
    push(RC09_SPLIT_LOSS_ENGAGE_MS - 200)
    expect(root().dataset.rc09Alerts).toBe('silent')
    expect(view.container.querySelector('[data-testid="rc09-split-loss"]')).toBeNull()
    push(RC09_SPLIT_LOSS_ENGAGE_MS + 200)
    expect(root().dataset.rc09Alerts).toBe('active')
    expect(view.container.querySelector('[data-testid="rc09-split-loss"]')?.textContent).toBe('SPLIT LOSS')
    expect(view.container.querySelector('[data-testid="rc09-split"]')?.getAttribute('data-rc09-split-loss')).toBe(
      'true'
    )
    // Packet 19: the sign character and the arrow direction carry the meaning, not the hue.
    expect(view.container.querySelector('[data-testid="rc09-split-value"]')?.textContent).toBe('+3.1')
    expect(
      view.container.querySelector('[data-testid="rc09-split-arrow"]')?.getAttribute('data-rc09-direction')
    ).toBe('losing')
    push(RC09_SPLIT_LOSS_ENGAGE_MS + 400, { deltaToBestSec: 0.4 })
    expect(root().dataset.rc09Alerts).toBe('silent')
  })

  it('escalates the water mini only after 3 s and draws its red line on that mini alone', () => {
    const { push, root, view } = mount({ waterTempC: 121 })
    push(RC09_MECHANICAL_ENGAGE_MS - 200)
    expect(root().dataset.rc09Alerts).toBe('silent')
    push(RC09_MECHANICAL_ENGAGE_MS + 200)
    expect(root().dataset.rc09Alerts).toBe('active')
    expect(view.container.querySelector('[data-testid="rc09-mechanical"]')?.textContent).toBe('WATER WARNING')
    expect(view.container.querySelector('[data-testid="rc09-mini-line-water"]')).not.toBeNull()
    expect(view.container.querySelector('[data-testid="rc09-mini-line-speed"]')).toBeNull()
    expect(view.container.querySelector('[data-rc09-mini="speed"]')?.getAttribute('data-rc09-faulted')).toBe(
      'false'
    )
    push(RC09_MECHANICAL_ENGAGE_MS + 400, { waterTempC: 92 })
    expect(root().dataset.rc09Alerts).toBe('silent')
  })

  it('drops the roadbook profile and every alert when the source is refused mid-stage', () => {
    const { frame, root, view } = mount({ deltaToBestSec: 3.1 }, config)
    loadRoadbook({ note: 'RIGHT 4', sequence: 1 })
    expect(view.container.querySelectorAll('[data-testid="rc09-profile-bar"]')).toHaveLength(1)
    frame(snapshot({ sim: 'mock' } as Partial<TelemetrySnapshot>, 2_000))
    expect(root().dataset.rc09BufferState).toBe('mock-telemetry')
    expect(root().dataset.rc09Alerts).toBe('silent')
    expect(view.container.querySelector('[data-testid="rc09-profile-empty"]')?.textContent).toBe('NO ROADBOOK')
  })

  it('builds the app-only profile from the notes the roadbook actually delivered', () => {
    const { view } = mount({}, config)
    loadRoadbook({ note: 'RIGHT 4', sequence: 1 })
    loadRoadbook({ note: 'LEFT 1', sequence: 2 })
    loadRoadbook({ note: 'CREST', sequence: 3 })
    const bars = view.container.querySelectorAll<HTMLElement>('[data-testid="rc09-profile-bar"]')
    expect(bars).toHaveLength(3)
    expect(bars[0].dataset.rc09Severity).toBe('4')
    expect(bars[1].dataset.rc09Severity).toBe('1')
    expect(bars[2].dataset.rc09Severity).toBe('ungraded')
    expect(Number.parseFloat(bars[1].style.height)).toBeGreaterThan(Number.parseFloat(bars[0].style.height))
  })

  it('degrades the hero clock instead of freezing it when the timing source falls silent', () => {
    const { push, frame, view } = mount()
    push(200)
    expect(view.container.querySelector('[data-testid="rc09-stage-timer"]')?.textContent).toBe('04:12.6')
    // The provider keeps publishing, but without the timing channel.
    frame(snapshot({ currentLapTimeSec: undefined }, 2_000))
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(view.container.querySelector('[data-testid="rc09-stage-timer"]')?.textContent).toBe('--:--.-')
  })
})
