// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOverlayStyle, type OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { OVERLAY_DASHBOARD_PRESETS } from '../../../../shared/dashboards'
import { WIDGET_COMPONENTS } from './index'
import { RaceconRc07DashWidget } from './RaceconRc07DashWidget'
import { Rc01LiveTelemetryBuffer, createRc01ChannelReceipts } from './raceconRc01Core'
import {
  RC07_APP_ZONES,
  RC07_BLUE_FLAG_MIN_VISIBLE_MS,
  RC07_CHANNEL_STALE_MS,
  RC07_CLASS_CODES,
  RC07_CLOSING_DEADBAND_S_PER_S,
  RC07_CLOSING_SAMPLE_MIN_MS,
  RC07_FAST_CLOSING_ENGAGE_MS,
  RC07_FAST_CLOSING_RATE_S_PER_S,
  RC07_FAST_CLOSING_RELEASE_MS,
  RC07_FLAG_NO_SIGNAL,
  RC07_IMMINENT_ENGAGE_MS,
  RC07_NATIVE_ZONES,
  RC07_PACKET_OMISSIONS,
  RC07_RADAR_CONTACT_LIMIT,
  RC07_RADAR_CRITICAL_FRACTION,
  RC07_RADAR_INNER_RING_UNITS,
  RC07_RADAR_MIN_BLIP_UNITS,
  RC07_RADAR_MIN_SEPARATION_UNITS,
  RC07_RADAR_OUTER_RING_UNITS,
  RC07_RADAR_PLOT_UNITS,
  RC07_RADAR_RANGES_M,
  RC07_RADAR_RANGE_EVENT,
  RC07_SPEED_DASH_MS,
  RC07_SPOTTER_ZONES,
  type Rc07AlertInput,
  Rc07ClosingTracker,
  type Rc07Rect,
  type Rc07ZoneMap,
  advanceRc07Alerts,
  clearInvalidRc07Alerts,
  createRc07AlertState,
  createRc07AuxReceipts,
  createRc07DashboardModel,
  rc07AlertInputForModel,
  rc07AlertLines,
  rc07AuxChannelValue,
  rc07AutoRangeIndex,
  rc07ClassCodeForId,
  rc07ClassOrder,
  rc07CompactModeForContentBox,
  rc07CriticalSide,
  rc07DirectionGlyph,
  rc07DisplayGear,
  rc07FlagCode,
  rc07LayoutForContentBox,
  rc07Percent,
  rc07PhoneGeometryForContentBox,
  rc07RadarBlips,
  rc07RadarContacts,
  rc07RangeIndexFromEvent,
  rc07RawRadiusUnits,
  rc07SeparatedRadii,
  rc07TowerRows,
  rc07ZoneStyle,
  rc07ZonesForLayout
} from './raceconRc07Core'

const config: OverlayWidgetConfig = {
  id: 'raceconRc07Dash',
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
 * The approved RC-07 reference state (attempt-004 governed 800x480,
 * `input/telemetry-frame-multiclass-rejoin.json`): a multiclass rejoin on the first flying lap
 * of a new stint after a driver change. Own car is Class B, a Class A prototype is closing
 * from behind-left at 0.8 s, a Class C car is being caught ahead-right at 1.4 s, race control
 * reads green and all three packet section 15 alerts are ARMED and SILENT.
 *
 * The frame's radar is declared in RADAR UNITS. At the 80 m range this build selects for
 * 178 km/h, one unit is 1.6 m, so the metre coordinates below reproduce the approved radii:
 *
 *   Class A behind-left   hypot(20.8, 35.2) = 40.89 m -> 25.55 units (approved 25.0)
 *   Class C ahead-right   hypot(25.6, 48.0) = 54.40 m -> 34.00 units (approved 34.0)
 *   Class B ahead-left    hypot(35.2, 57.6) = 67.50 m -> 42.19 units (approved 42.2)
 *   Class B behind-right  hypot(33.6, 60.8) = 69.47 m -> 43.42 units, raised to 45.19 by the
 *                         3-unit rank separation, which is exactly the guard that stops the
 *                         ordering collapsing the way reference attempts 001 and 003 did.
 */
const REFERENCE_RADAR = [
  { carIdx: 11, name: 'A-behind-left', relativeX: -20.8, relativeY: -35.2, gapSec: -0.8 },
  { carIdx: 12, name: 'B-behind-right', relativeX: 33.6, relativeY: -60.8, gapSec: -2.6 },
  { carIdx: 13, name: 'C-ahead-right', relativeX: 25.6, relativeY: 48, gapSec: 1.4 },
  { carIdx: 14, name: 'B-ahead-left', relativeX: -35.2, relativeY: 57.6, gapSec: 2.9 }
]

const REFERENCE_DRIVERS = [
  { carIdx: 7, name: 'Own', carNumber: '77', position: 14, classPosition: 5, classId: 20, isPlayer: true },
  { carIdx: 11, name: 'A1', carNumber: '2', position: 3, classPosition: 3, classId: 10, isPlayer: false, gapToPlayerSec: -0.8 },
  { carIdx: 12, name: 'B1', carNumber: '18', position: 16, classPosition: 6, classId: 20, isPlayer: false, gapToPlayerSec: -2.6 },
  { carIdx: 13, name: 'C1', carNumber: '54', position: 13, classPosition: 2, classId: 30, isPlayer: false, gapToPlayerSec: 1.4 },
  { carIdx: 14, name: 'B2', carNumber: '9', position: 12, classPosition: 4, classId: 20, isPlayer: false, gapToPlayerSec: 2.9 }
]

const GREEN_FLAGS = {
  green: true,
  yellow: false,
  blue: false,
  white: false,
  checkered: false,
  red: false,
  black: false,
  meatball: false,
  repair: false,
  disqualify: false,
  greenWhiteCheckered: false
}

function snapshot(overrides: Partial<TelemetrySnapshot> = {}, timestamp = 5_070_000): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp,
    sessionUniqueId: 77,
    speedKmh: 178,
    gear: 4,
    throttle: 0.58,
    brake: 0,
    clutch: 0,
    sessionType: 'Race',
    sessionState: 'racing',
    currentLap: 31,
    position: 14,
    playerCarIdx: 7,
    flags: GREEN_FLAGS,
    raceControlState: 'known',
    carLeftRight: 'clear',
    drivers: REFERENCE_DRIVERS,
    relatives: {
      behind: { carIdx: 11, name: 'A1', carNumber: '2', gapSec: -0.8 },
      ahead: { carIdx: 13, name: 'C1', carNumber: '54', gapSec: 1.4 }
    },
    radarCars: REFERENCE_RADAR,
    ...overrides
  } as TelemetrySnapshot
}

function markup(value: TelemetrySnapshot | null, cfg = config): string {
  return renderToStaticMarkup(createElement(RaceconRc07DashWidget, { snapshot: value, config: cfg }))
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
  options: Parameters<typeof createRc07DashboardModel>[4] = {},
  receiptsAtMs = nowMs
): ReturnType<typeof createRc07DashboardModel> {
  const receipts = value ? createRc01ChannelReceipts(value, receiptsAtMs) : new Map()
  const aux = value ? createRc07AuxReceipts(value, receiptsAtMs) : new Map()
  return createRc07DashboardModel(value, receipts, aux, nowMs, options)
}

function alertInput(overrides: Partial<Rc07AlertInput> = {}): Rc07AlertInput {
  return {
    nowMs: 0,
    blueFlag: false,
    radarAvailable: true,
    closingRateBehind: 0,
    closingContactInRange: true,
    criticalSide: null,
    ...overrides
  }
}

function right(rect: Rc07Rect): number {
  return rect.left + rect.width
}

function bottom(rect: Rc07Rect): number {
  return rect.top + rect.height
}

function overlaps(a: Rc07Rect, b: Rc07Rect): boolean {
  return a.left < right(b) && right(a) > b.left && a.top < bottom(b) && bottom(a) > b.top
}

function zoneList(zones: Rc07ZoneMap): Rc07Rect[] {
  return Object.values(zones).filter((rect): rect is Rc07Rect => Boolean(rect))
}

describe('RC-07 registration and preset wiring', () => {
  it('registers the widget component under its canonical id', () => {
    expect(WIDGET_COMPONENTS.raceconRc07Dash).toBe(RaceconRc07DashWidget)
  })

  it('declares exactly one RC-07 full-frame preset directly after RC-06', () => {
    const ids = OVERLAY_DASHBOARD_PRESETS.map((preset) => preset.id)
    expect(ids.filter((id) => id === 'racecon_rc07_dash')).toHaveLength(1)
    expect(ids.indexOf('racecon_rc07_dash')).toBe(ids.indexOf('racecon_rc06_dash') + 1)
    const preset = OVERLAY_DASHBOARD_PRESETS.find((entry) => entry.id === 'racecon_rc07_dash')
    expect(preset?.widgetId).toBe('raceconRc07Dash')
    expect(preset?.name).toBe('RaceCon RC-07 Blue Flags')
    expect(preset?.scaleMode).toBe('stretch')
    expect(preset?.tags).toContain('racecon')
    expect(preset?.tags).toContain('radar')
  })
})

describe('RC-07 radar geometry is computed, never traced', () => {
  it('places both range rings at the configured range fractions, exactly 2.00 apart', () => {
    expect(RC07_RADAR_INNER_RING_UNITS).toBe(20)
    expect(RC07_RADAR_OUTER_RING_UNITS).toBe(40)
    expect(RC07_RADAR_OUTER_RING_UNITS / RC07_RADAR_INNER_RING_UNITS).toBe(2)
    // image-qa-v1 residual 2: the reference drew them at 17.3 / 35.4 and is never traced.
    expect(RC07_RADAR_INNER_RING_UNITS).not.toBe(17.3)
    expect(RC07_RADAR_OUTER_RING_UNITS).not.toBe(35.4)
  })

  it('derives each radius arithmetically from that contact"s own distance', () => {
    expect(rc07RawRadiusUnits(40, 80)).toBeCloseTo(25, 6)
    expect(rc07RawRadiusUnits(80, 80)).toBeCloseTo(50, 6)
    // Beyond the range the plot edge is the honest answer, never a wrapped or scaled radius.
    expect(rc07RawRadiusUnits(400, 80)).toBe(RC07_RADAR_PLOT_UNITS)
    expect(rc07RawRadiusUnits(0, 80)).toBe(0)
  })

  it('keeps the ordering strictly monotonic even when every contact is at one distance', () => {
    // This is the exact failure of reference attempts 001 and 003: four blips, one radius.
    const collapsed = rc07SeparatedRadii([30, 30, 30, 30])
    for (let i = 1; i < collapsed.length; i += 1) {
      expect(collapsed[i] - collapsed[i - 1]).toBeGreaterThanOrEqual(RC07_RADAR_MIN_SEPARATION_UNITS - 1e-9)
    }
    expect(collapsed[collapsed.length - 1] - collapsed[0]).toBeGreaterThanOrEqual(9)
  })

  it('never lets the separation escape the plot, however many contacts pile onto the edge', () => {
    const crowded = rc07SeparatedRadii(new Array(RC07_RADAR_CONTACT_LIMIT).fill(RC07_RADAR_PLOT_UNITS))
    expect(crowded).toHaveLength(RC07_RADAR_CONTACT_LIMIT)
    for (const radius of crowded) {
      expect(radius).toBeGreaterThanOrEqual(RC07_RADAR_MIN_BLIP_UNITS)
      expect(radius).toBeLessThanOrEqual(RC07_RADAR_PLOT_UNITS)
    }
    for (let i = 1; i < crowded.length; i += 1) {
      expect(crowded[i]).toBeGreaterThan(crowded[i - 1])
    }
  })

  it('only ever raises a radius, so a blip is never drawn nearer than it truly is', () => {
    const raw = [10, 10.5, 11, 40]
    const separated = rc07SeparatedRadii(raw)
    for (let i = 0; i < raw.length; i += 1) {
      expect(separated[i]).toBeGreaterThanOrEqual(raw[i] - 1e-9)
    }
  })

  it('never draws a blip under the own-car marker', () => {
    expect(rc07SeparatedRadii([0])[0]).toBe(RC07_RADAR_MIN_BLIP_UNITS)
  })

  it('reproduces the approved reference frame"s radii, spread and ring occupancy', () => {
    const order = rc07ClassOrder(snapshot())
    const contacts = rc07RadarContacts(snapshot(), order)!
    const blips = rc07RadarBlips(contacts, 80)
    expect(blips).toHaveLength(4)
    const radii = blips.map((blip) => blip.radiusUnits)
    expect(radii[0]).toBeCloseTo(25.55, 1)
    expect(radii[1]).toBeCloseTo(34.0, 1)
    expect(radii[2]).toBeCloseTo(42.19, 1)
    expect(radii[3]).toBeCloseTo(45.19, 1)
    // image-qa-v1: the accepted frame carries a radial spread of 19.9 across four blips.
    expect(radii[3] - radii[0]).toBeGreaterThanOrEqual(12)
    // image-qa-v1: zero blips inside the 20-unit critical zone, so the alert stays silent.
    expect(radii.filter((radius) => radius < RC07_RADAR_INNER_RING_UNITS)).toHaveLength(0)
    expect(rc07CriticalSide(blips)).toBeNull()
  })

  it('maps class, side and longitudinal position exactly as the reference frame declares', () => {
    const order = rc07ClassOrder(snapshot())
    const blips = rc07RadarBlips(rc07RadarContacts(snapshot(), order)!, 80)
    expect(blips.map((blip) => [blip.classCode, blip.side, blip.longitudinal])).toEqual([
      ['A', 'left', 'behind'],
      ['C', 'right', 'ahead'],
      ['B', 'left', 'ahead'],
      ['B', 'right', 'behind']
    ])
    // Packet 19: every blip carries its own side glyph, so side is never position-only.
    expect(blips.map((blip) => blip.arrow)).toEqual(['\u25C0', '\u25B6', '\u25C0', '\u25B6'])
  })

  it('converts polar coordinates into plot percentages with the own car at the centre', () => {
    const blips = rc07RadarBlips(
      [
        { carIdx: 1, relativeXM: 0, relativeYM: 40, distanceM: 40, gapSec: null, classCode: 'A' },
        { carIdx: 2, relativeXM: 60, relativeYM: 0, distanceM: 60, gapSec: null, classCode: 'B' }
      ],
      80
    )
    expect(blips[0].xPercent).toBeCloseTo(50, 6)
    expect(blips[0].yPercent).toBeCloseTo(25, 6)
    expect(blips[1].xPercent).toBeCloseTo(87.5, 6)
    expect(blips[1].yPercent).toBeCloseTo(50, 6)
  })

  it('marks criticality from the true distance, never from the plotted radius', () => {
    const criticalM = 80 * RC07_RADAR_CRITICAL_FRACTION
    const blips = rc07RadarBlips(
      [
        { carIdx: 1, relativeXM: -4, relativeYM: -6, distanceM: 7.2, gapSec: null, classCode: 'A' },
        { carIdx: 2, relativeXM: 60, relativeYM: 0, distanceM: 60, gapSec: null, classCode: 'B' }
      ],
      80
    )
    expect(criticalM).toBe(32)
    expect(blips[0].critical).toBe(true)
    expect(blips[1].critical).toBe(false)
    expect(rc07CriticalSide(blips)).toBe('left')
  })

  it('reports both sides when the critical zone is occupied left and right', () => {
    const blips = rc07RadarBlips(
      [
        { carIdx: 1, relativeXM: -3, relativeYM: 1, distanceM: 3.2, gapSec: null, classCode: 'A' },
        { carIdx: 2, relativeXM: 3, relativeYM: -1, distanceM: 3.2, gapSec: null, classCode: 'B' }
      ],
      80
    )
    expect(rc07CriticalSide(blips)).toBe('both')
  })

  it('keeps only the nearest contacts when the field is denser than the plot can separate', () => {
    const many = Array.from({ length: 14 }, (_, index) => ({
      carIdx: index,
      relativeXM: 2 + index,
      relativeYM: 0,
      distanceM: 2 + index,
      gapSec: null,
      classCode: null
    }))
    const blips = rc07RadarBlips(many, 80)
    expect(blips).toHaveLength(RC07_RADAR_CONTACT_LIMIT)
    expect(blips[0].distanceM).toBe(2)
  })

  it('auto-ranges from speed and falls back to the default range without it', () => {
    expect(rc07AutoRangeIndex(40)).toBe(0)
    expect(rc07AutoRangeIndex(178)).toBe(1)
    expect(rc07AutoRangeIndex(260)).toBe(2)
    expect(rc07AutoRangeIndex(null)).toBeNull()
    expect(RC07_RADAR_RANGES_M[1]).toBe(80)
  })

  it('accepts only the soft-key range payloads it recognises', () => {
    expect(rc07RangeIndexFromEvent('auto')).toBe('auto')
    expect(rc07RangeIndexFromEvent(2)).toBe(2)
    expect(rc07RangeIndexFromEvent({ rangeIndex: 0 })).toBe(0)
    expect(rc07RangeIndexFromEvent(9)).toBeNull()
    expect(rc07RangeIndexFromEvent('near')).toBeNull()
    expect(rc07RangeIndexFromEvent(null)).toBeNull()
  })
})

describe('RC-07 generic class tokens are bound to a real channel', () => {
  it('assigns letters to the distinct class ids the timing feed actually reports', () => {
    const order = rc07ClassOrder(snapshot())
    expect(order).toEqual([10, 20, 30])
    expect(rc07ClassCodeForId(10, order)).toBe('A')
    expect(rc07ClassCodeForId(20, order)).toBe('B')
    expect(rc07ClassCodeForId(30, order)).toBe('C')
  })

  it('never guesses a letter for a class the feed does not identify', () => {
    const order = rc07ClassOrder(snapshot())
    expect(rc07ClassCodeForId(999, order)).toBeNull()
    expect(rc07ClassCodeForId(null, order)).toBeNull()
    expect(rc07ClassOrder(null)).toEqual([])
    expect(rc07ClassOrder(snapshot({ drivers: undefined }))).toEqual([])
  })

  it('runs out of letters rather than inventing one for a tenth class', () => {
    const order = Array.from({ length: 10 }, (_, index) => index)
    expect(rc07ClassCodeForId(RC07_CLASS_CODES.length - 1, order)).toBe('F')
    expect(rc07ClassCodeForId(RC07_CLASS_CODES.length, order)).toBeNull()
  })
})

describe('RC-07 packet zone geometry', () => {
  it('uses the packet 11.1 coordinates for the native canvas, not the rendered pixels', () => {
    expect(RC07_NATIVE_ZONES.flag).toEqual({ left: 2.0, top: 2.1, width: 47.5, height: 5.0 })
    expect(RC07_NATIVE_ZONES.radar).toEqual({ left: 2.0, top: 8.3, width: 47.5, height: 83.3 })
    expect(RC07_NATIVE_ZONES.behind).toEqual({ left: 51.5, top: 8.3, width: 46.5, height: 31.3 })
    expect(RC07_NATIVE_ZONES.ahead).toEqual({ left: 51.5, top: 41.7, width: 46.5, height: 29.1 })
    expect(RC07_NATIVE_ZONES.self).toEqual({ left: 51.5, top: 72.9, width: 46.5, height: 18.8 })
    // image-qa-v1 residual 1: the render inflated the ribbon to 8.7 % and split at 53.6 %.
    expect(RC07_NATIVE_ZONES.flag.height).not.toBeCloseTo(8.7, 1)
    expect(RC07_NATIVE_ZONES.behind.left).not.toBeCloseTo(54.9, 1)
  })

  it('keeps the packet section 10 hierarchy in the right-hand column heights', () => {
    expect(RC07_NATIVE_ZONES.behind.height).toBeGreaterThan(RC07_NATIVE_ZONES.ahead.height)
    expect(RC07_NATIVE_ZONES.ahead.height).toBeGreaterThan(RC07_NATIVE_ZONES.self.height)
    // The radar is primary: it owns the whole left half and outranks every scalar panel.
    expect(RC07_NATIVE_ZONES.radar.height).toBeGreaterThan(RC07_NATIVE_ZONES.behind.height)
    expect(RC07_NATIVE_ZONES.radar.width).toBeGreaterThan(RC07_NATIVE_ZONES.behind.width * 0.99)
  })

  it('uses the packet 12.1 coordinates for the app canvas and reveals the tower', () => {
    expect(RC07_APP_ZONES.radar).toEqual({ left: 2.3, top: 8.0, width: 44.9, height: 84.0 })
    expect(RC07_APP_ZONES.behind).toEqual({ left: 49.2, top: 8.0, width: 29.3, height: 28.3 })
    expect(RC07_APP_ZONES.ahead).toEqual({ left: 49.2, top: 38.7, width: 29.3, height: 25.0 })
    expect(RC07_APP_ZONES.self).toEqual({ left: 49.2, top: 66.0, width: 29.3, height: 26.0 })
    expect(RC07_APP_ZONES.tower).toEqual({ left: 80.1, top: 8.0, width: 17.6, height: 84.0 })
  })

  it('reveals the app-only nearest-cars tower at exactly one breakpoint', () => {
    expect(rc07ZonesForLayout('app').tower).toBeDefined()
    expect(rc07ZonesForLayout('native').tower).toBeUndefined()
    expect(rc07ZonesForLayout('compact', 'phone').tower).toBeUndefined()
    expect(rc07ZonesForLayout('compact', 'landscape').tower).toBeUndefined()
    expect(rc07ZonesForLayout('compact', 'standard').tower).toBeUndefined()
  })

  it('contains every zone inside the canvas at every breakpoint', () => {
    const maps: Rc07ZoneMap[] = [
      rc07ZonesForLayout('native'),
      rc07ZonesForLayout('app'),
      rc07ZonesForLayout('compact', 'phone'),
      rc07ZonesForLayout('compact', 'landscape'),
      rc07ZonesForLayout('compact', 'standard')
    ]
    for (const map of maps) {
      for (const rect of zoneList(map)) {
        expect(rect.left).toBeGreaterThanOrEqual(0)
        expect(rect.top).toBeGreaterThanOrEqual(0)
        expect(right(rect)).toBeLessThanOrEqual(100)
        expect(bottom(rect)).toBeLessThanOrEqual(100)
      }
    }
  })

  it('keeps every zone disjoint at every breakpoint', () => {
    const maps: Rc07ZoneMap[] = [
      rc07ZonesForLayout('native'),
      rc07ZonesForLayout('app'),
      rc07ZonesForLayout('compact', 'phone'),
      rc07ZonesForLayout('compact', 'landscape'),
      rc07ZonesForLayout('compact', 'standard')
    ]
    for (const map of maps) {
      const rects = zoneList(map)
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          expect(overlaps(rects[i], rects[j])).toBe(false)
        }
      }
    }
  })

  it('keeps every alert surface present at every breakpoint', () => {
    // Blue flag rides the ribbon, fast-closing the gap-behind panel, imminent the radar.
    for (const map of [
      rc07ZonesForLayout('native'),
      rc07ZonesForLayout('app'),
      rc07ZonesForLayout('compact', 'phone'),
      rc07ZonesForLayout('compact', 'landscape'),
      rc07ZonesForLayout('compact', 'standard')
    ]) {
      expect(map.flag).toBeDefined()
      expect(map.behind).toBeDefined()
      expect(map.radar).toBeDefined()
    }
  })

  it('emits the zone rect as inline percentages', () => {
    expect(rc07ZoneStyle(RC07_NATIVE_ZONES.radar)).toEqual({
      left: '2%',
      top: '8.3%',
      width: '47.5%',
      height: '83.3%'
    })
    expect(rc07ZoneStyle(undefined)).toBeNull()
  })

  it('emits a plot coordinate as a clean percentage with no float noise', () => {
    expect(rc07Percent(50 + 0.1 + 0.2)).toBe('50.3%')
    expect(rc07Percent(Number.NaN)).toBe('0%')
  })
})

describe('RC-07 telemetry truth table', () => {
  it('renders the approved reference frame exactly as measured', () => {
    const model = modelFor(snapshot())
    expect(model.flag.label).toBe('GREEN')
    expect(model.behind.field.value).toBe('0.8')
    expect(model.behind.classLabel).toBe('A')
    expect(model.ahead.field.value).toBe('1.4')
    expect(model.ahead.classLabel).toBe('C')
    expect(model.position.value).toBe('14')
    // The stored best was reset at the driver change, so the packet forbids any delta.
    expect(model.delta.value).toBe('--.---')
    expect(model.gear.value).toBe('4')
    // Tertiary, and with no measured consumption lap this stint it would dash anyway.
    expect(model.fuelLaps.value).toBe('--')
    expect(model.radar.available).toBe(true)
    expect(model.radar.blips).toHaveLength(4)
    expect(model.radar.rangeM).toBe(80)
    expect(model.radar.rangeSource).toBe('auto')
    expect(model.alerts).toEqual({ blueFlag: false, fastClosing: false, imminent: false })
  })

  it('renders every packet dash state when no channel is available at all', () => {
    const model = modelFor(null)
    expect(model.flag.label).toBe(RC07_FLAG_NO_SIGNAL)
    expect(model.flag.unavailable).toBe(true)
    expect(model.behind.field.value).toBe('--.-')
    expect(model.ahead.field.value).toBe('--.-')
    expect(model.position.value).toBe('--')
    expect(model.delta.value).toBe('--.---')
    expect(model.gear.value).toBe('-')
    expect(model.speed.value).toBe('---')
    expect(model.fuelLaps.value).toBe('--')
    expect(model.spotter.label).toBe('NO DATA')
    expect(model.radar.available).toBe(false)
    expect(model.radar.status).toBe('NO DATA')
    expect(model.radar.blips).toHaveLength(0)
  })

  it('hides the radar rather than drawing a phantom when the source is missing', () => {
    const model = modelFor(snapshot({ radarCars: undefined }))
    expect(model.radar.available).toBe(false)
    expect(model.radar.blips).toHaveLength(0)
    // The gaps are still live, and they are NEVER used to reconstruct a blip.
    expect(model.behind.field.value).toBe('0.8')
    expect(model.ahead.field.value).toBe('1.4')
  })

  it('distinguishes an empty live radar from a missing radar source', () => {
    const model = modelFor(snapshot({ radarCars: [] }))
    expect(model.radar.available).toBe(true)
    expect(model.radar.status).toBe('LIVE')
    expect(model.radar.blips).toHaveLength(0)
  })

  it('never assumes green when the race-control feed is missing or unrecognised', () => {
    expect(modelFor(snapshot({ flags: undefined })).flag.label).toBe(RC07_FLAG_NO_SIGNAL)
    expect(modelFor(snapshot({ raceControlState: 'unknown' })).flag.label).toBe(RC07_FLAG_NO_SIGNAL)
    expect(rc07FlagCode(snapshot({ flags: undefined }))).toBeNull()
    expect(rc07FlagCode(snapshot({ raceControlState: 'unknown' }))).toBeNull()
    expect(rc07FlagCode(null)).toBeNull()
  })

  it('reads an all-clear recognised race-control state as a positively reported green', () => {
    const clear = { ...GREEN_FLAGS, green: false }
    expect(rc07FlagCode(snapshot({ flags: clear }))).toBe('GREEN')
  })

  it('resolves the flag ribbon by packet precedence', () => {
    const withFlag = (patch: Record<string, boolean>): TelemetrySnapshot =>
      snapshot({ flags: { ...GREEN_FLAGS, green: false, ...patch } } as Partial<TelemetrySnapshot>)
    expect(rc07FlagCode(withFlag({ blue: true }))).toBe('BLUE')
    expect(rc07FlagCode(withFlag({ blue: true, yellow: true }))).toBe('BLUE')
    expect(rc07FlagCode(withFlag({ blue: true, red: true }))).toBe('RED')
    expect(rc07FlagCode(withFlag({ blue: true, black: true }))).toBe('BLACK')
    expect(rc07FlagCode(withFlag({ yellow: true }))).toBe('YELLOW')
    expect(rc07FlagCode(withFlag({ checkered: true }))).toBe('CHECKERED')
    expect(rc07FlagCode(withFlag({ white: true }))).toBe('WHITE')
  })

  it('never estimates a gap from the radar and dashes a missing timing feed', () => {
    const model = modelFor(snapshot({ relatives: undefined }))
    expect(model.behind.field.value).toBe('--.-')
    expect(model.behind.field.unavailable).toBe(true)
    expect(model.ahead.field.value).toBe('--.-')
    // The radar is still live and populated; it is never allowed to fill the gap panels.
    expect(model.radar.blips).toHaveLength(4)
    expect(model.behind.classCode).toBeNull()
  })

  it('reads the interval as a magnitude whichever sign the provider carries', () => {
    expect(rc07AuxChannelValue(snapshot(), 'gapBehind')).toBeCloseTo(0.8, 6)
    const positive = snapshot({
      relatives: { behind: { carIdx: 11, name: 'A1', carNumber: '2', gapSec: 0.8 }, ahead: undefined }
    } as Partial<TelemetrySnapshot>)
    expect(rc07AuxChannelValue(positive, 'gapBehind')).toBeCloseTo(0.8, 6)
  })

  it('refuses a delta without a stored best lap and never extrapolates one', () => {
    expect(modelFor(snapshot({ deltaToBestSec: -0.31 })).delta.value).toBe('--.---')
    const withBest = modelFor(snapshot({ deltaToBestSec: -0.31, bestLapTimeSec: 111.204 }))
    expect(withBest.delta.value).toBe('-0.310')
    expect(withBest.delta.tone).toBe('good')
  })

  it('dashes position when there is no timing feed and never infers it from gaps', () => {
    expect(modelFor(snapshot({ position: undefined })).position.value).toBe('--')
  })

  it('never derives the gear from RPM or speed and greys a missing channel', () => {
    expect(modelFor(snapshot({ gear: undefined })).gear.value).toBe('-')
    expect(rc07DisplayGear(0)).toBe('N')
    expect(rc07DisplayGear(-1)).toBe('R')
    expect(rc07DisplayGear(null)).toBe('-')
    // A live RPM with no gear channel must not synthesise a gear.
    expect(modelFor(snapshot({ gear: undefined, rpm: 7_400, maxRpm: 8_600 })).gear.value).toBe('-')
  })

  it('greys speed past its cadence and dashes it only past the 500 ms budget', () => {
    const greyed = modelFor(snapshot(), RC07_CHANNEL_STALE_MS.speed + 50, {}, 0)
    expect(greyed.speed.stale).toBe(true)
    expect(greyed.speed.value).toBe('178')
    const dashed = modelFor(snapshot(), RC07_SPEED_DASH_MS + 50, {}, 0)
    expect(dashed.speed.value).toBe('---')
    expect(dashed.speed.unavailable).toBe(true)
  })

  it('never projects fuel laps before a measured consumption lap exists', () => {
    expect(modelFor(snapshot({ fuelLapsRemaining: 12.4 })).fuelLaps.value).toBe('--')
    expect(
      modelFor(snapshot({ fuelLapsRemaining: 12.4, fuelPerLapLiters: 2.6 })).fuelLaps.value
    ).toBe('12.4')
  })

  it('shows NO DATA for the spotter zone rather than guessing a neighbour', () => {
    expect(modelFor(snapshot({ carLeftRight: undefined })).spotter.label).toBe('NO DATA')
    expect(modelFor(snapshot({ carLeftRight: 'left' })).spotter.label).toBe('LEFT')
    expect(modelFor(snapshot({ carLeftRight: 'both' })).spotter.label).toBe('BOTH')
    expect(RC07_SPOTTER_ZONES).toEqual(['clear', 'left', 'right', 'both'])
  })

  it('degrades every channel to its dash state once its own budget has expired', () => {
    const stalest = Math.max(...Object.values(RC07_CHANNEL_STALE_MS)) + 100
    const model = modelFor(snapshot(), stalest, {}, 0)
    expect(model.radar.available).toBe(false)
    expect(model.flag.label).toBe(RC07_FLAG_NO_SIGNAL)
    expect(model.behind.field.value).toBe('--.-')
    expect(model.ahead.field.value).toBe('--.-')
    expect(model.gear.value).toBe('-')
    expect(model.speed.value).toBe('---')
    expect(model.spotter.label).toBe('NO DATA')
    expect(Object.values(model.auxFresh).every((fresh) => fresh === false)).toBe(true)
  })

  it('ages the radar out at 50 ms and the gaps at a full second, exactly as the packet says', () => {
    expect(RC07_CHANNEL_STALE_MS.radar).toBe(50)
    expect(RC07_CHANNEL_STALE_MS.gapBehind).toBe(1_000)
    expect(RC07_CHANNEL_STALE_MS.gapAhead).toBe(1_000)
    expect(RC07_CHANNEL_STALE_MS.gear).toBe(50)
    expect(RC07_CHANNEL_STALE_MS.spotter).toBe(50)
    const atGapEdge = modelFor(snapshot(), 900, {}, 0)
    expect(atGapEdge.radar.available).toBe(false)
    expect(atGapEdge.behind.field.value).toBe('0.8')
  })

  it('reads every channel from its own declared source and nothing else', () => {
    const frame = snapshot()
    expect(rc07AuxChannelValue(frame, 'radar')).toBe(4)
    expect(rc07AuxChannelValue(frame, 'gapAhead')).toBeCloseTo(1.4, 6)
    expect(rc07AuxChannelValue(frame, 'gear')).toBe(4)
    expect(rc07AuxChannelValue(frame, 'speed')).toBe(178)
    expect(rc07AuxChannelValue(frame, 'fuelLaps')).toBeNull()
    expect(rc07AuxChannelValue(frame, 'spotter')).toBe(0)
    expect(rc07AuxChannelValue(snapshot({ radarCars: undefined }), 'radar')).toBeNull()
  })
})

describe('RC-07 packet contradictions are resolved by omission, not invention', () => {
  it('declares no engine-speed channel anywhere in the truth table', () => {
    // Packet 11.4 asks for a shift/over-rev edge cue; packet 16 gives it no channel.
    const channels = Object.keys(RC07_CHANNEL_STALE_MS)
    expect(channels).not.toContain('rpm')
    expect(channels).not.toContain('engineSpeed')
    expect(channels).not.toContain('shift')
    expect(RC07_PACKET_OMISSIONS.shiftCue).toContain('no engine-speed channel')
  })

  it('renders the closing cue as a direction glyph with no numeral at all', () => {
    expect(rc07DirectionGlyph('closing')).toBe('\u25B2')
    expect(rc07DirectionGlyph('opening')).toBe('\u25BC')
    expect(rc07DirectionGlyph('steady')).toBe('\u25AC')
    expect(rc07DirectionGlyph('unknown')).toBe('\u2013')
    for (const direction of ['closing', 'opening', 'steady', 'unknown'] as const) {
      expect(rc07DirectionGlyph(direction)).not.toMatch(/[0-9]/)
    }
    expect(RC07_PACKET_OMISSIONS.closingRateNumeral).toContain('no closing-rate channel')
  })

  it('documents the two remaining contradictions it deliberately does not render', () => {
    expect(RC07_PACKET_OMISSIONS.passAdvice).toContain('whether to pass')
    expect(RC07_PACKET_OMISSIONS.rangeSoftKeyLegend).toContain('no legend zone')
  })
})

describe('RC-07 closing direction is measured, never invented', () => {
  it('needs two samples a real interval apart before it says anything', () => {
    const tracker = new Rc07ClosingTracker()
    tracker.observe({ nowMs: 0, behind: 1.2, ahead: 2 })
    expect(tracker.rate('behind')).toBeNull()
    expect(tracker.direction('behind')).toBe('unknown')
    tracker.observe({ nowMs: RC07_CLOSING_SAMPLE_MIN_MS - 10, behind: 1.1, ahead: 2 })
    expect(tracker.rate('behind')).toBeNull()
  })

  it('computes the first difference of the interval over the elapsed window', () => {
    const tracker = new Rc07ClosingTracker()
    tracker.observe({ nowMs: 0, behind: 1.2, ahead: 2 })
    tracker.observe({ nowMs: 500, behind: 1.0, ahead: 2 })
    tracker.observe({ nowMs: 1_000, behind: 0.8, ahead: 2 })
    // 0.2 s of interval lost across 0.5 s of time.
    expect(tracker.rate('behind')).toBeCloseTo(0.4, 6)
    expect(tracker.direction('behind')).toBe('closing')
    expect(tracker.direction('ahead')).toBe('steady')
  })

  it('reads a lengthening interval as opening and a still one as steady', () => {
    const tracker = new Rc07ClosingTracker()
    tracker.observe({ nowMs: 0, behind: 0.8, ahead: 1.4 })
    tracker.observe({ nowMs: 500, behind: 1.2, ahead: 1.4 })
    tracker.observe({ nowMs: 1_000, behind: 1.6, ahead: 1.4 })
    expect(tracker.direction('behind')).toBe('opening')
    expect(Math.abs(tracker.rate('ahead')!)).toBeLessThanOrEqual(RC07_CLOSING_DEADBAND_S_PER_S)
  })

  it('says nothing at all when either end of the window has no interval', () => {
    const tracker = new Rc07ClosingTracker()
    tracker.observe({ nowMs: 0, behind: null, ahead: 1.4 })
    tracker.observe({ nowMs: 500, behind: 1.0, ahead: 1.4 })
    tracker.observe({ nowMs: 1_000, behind: 0.8, ahead: 1.4 })
    expect(tracker.rate('behind')).toBeCloseTo(0.4, 6)
    const broken = new Rc07ClosingTracker()
    broken.observe({ nowMs: 0, behind: 1.2, ahead: null })
    broken.observe({ nowMs: 500, behind: 1.0, ahead: null })
    broken.observe({ nowMs: 1_000, behind: 0.8, ahead: null })
    expect(broken.rate('ahead')).toBeNull()
    expect(broken.direction('ahead')).toBe('unknown')
  })

  it('drops a stale window rather than dividing by a gap that is far too long', () => {
    const tracker = new Rc07ClosingTracker()
    tracker.observe({ nowMs: 0, behind: 1.2, ahead: 2 })
    tracker.observe({ nowMs: 60_000, behind: 0.8, ahead: 2 })
    tracker.observe({ nowMs: 120_000, behind: 0.4, ahead: 2 })
    expect(tracker.rate('behind')).toBeNull()
  })

  it('clones and resets without sharing state', () => {
    const tracker = new Rc07ClosingTracker()
    tracker.observe({ nowMs: 0, behind: 1.2, ahead: 2 })
    tracker.observe({ nowMs: 500, behind: 1.0, ahead: 2 })
    tracker.observe({ nowMs: 1_000, behind: 0.8, ahead: 2 })
    const clone = tracker.clone()
    clone.reset()
    expect(clone.rate('behind')).toBeNull()
    expect(tracker.rate('behind')).toBeCloseTo(0.4, 6)
  })

  it('drops the direction entirely when the interval itself is unavailable', () => {
    const model = modelFor(snapshot({ relatives: undefined }), 0, { behindDirection: 'closing' })
    expect(model.behind.direction).toBe('unknown')
    expect(model.behind.directionGlyph).toBe('\u2013')
  })
})

describe('RC-07 trigger-only alerts', () => {
  it('starts silent with nothing latched', () => {
    const state = createRc07AlertState()
    expect(state.blueFlag.active).toBe(false)
    expect(state.fastClosing.active).toBe(false)
    expect(state.imminent.active).toBe(false)
    expect(rc07AlertLines(modelFor(snapshot()))).toEqual([])
  })

  it('gates the blue-flag chip on the flag event and holds it for a full second', () => {
    let state = advanceRc07Alerts(createRc07AlertState(), alertInput({ nowMs: 0, blueFlag: true }))
    expect(state.blueFlag.active).toBe(true)
    // The flag clears immediately, but the minimum display keeps the chip up for 1 s.
    state = advanceRc07Alerts(state, alertInput({ nowMs: 200, blueFlag: false }))
    expect(state.blueFlag.active).toBe(true)
    state = advanceRc07Alerts(state, alertInput({ nowMs: RC07_BLUE_FLAG_MIN_VISIBLE_MS - 1, blueFlag: false }))
    expect(state.blueFlag.active).toBe(true)
    state = advanceRc07Alerts(state, alertInput({ nowMs: RC07_BLUE_FLAG_MIN_VISIBLE_MS, blueFlag: false }))
    expect(state.blueFlag.active).toBe(false)
  })

  it('never raises or holds the blue-flag chip on a missing flag feed', () => {
    let state = advanceRc07Alerts(createRc07AlertState(), alertInput({ nowMs: 0, blueFlag: true }))
    expect(state.blueFlag.active).toBe(true)
    // A lost feed unlatches immediately: it can neither assume clear nor invent a duty.
    state = advanceRc07Alerts(state, alertInput({ nowMs: 100, blueFlag: null }))
    expect(state.blueFlag.active).toBe(false)
    state = advanceRc07Alerts(state, alertInput({ nowMs: 200, blueFlag: null }))
    expect(state.blueFlag.active).toBe(false)
  })

  it('engages fast-closing only after the 300 ms debounce', () => {
    const fast = { closingRateBehind: RC07_FAST_CLOSING_RATE_S_PER_S + 0.1 }
    let state = advanceRc07Alerts(createRc07AlertState(), alertInput({ nowMs: 0, ...fast }))
    expect(state.fastClosing.active).toBe(false)
    state = advanceRc07Alerts(state, alertInput({ nowMs: RC07_FAST_CLOSING_ENGAGE_MS - 1, ...fast }))
    expect(state.fastClosing.active).toBe(false)
    state = advanceRc07Alerts(state, alertInput({ nowMs: RC07_FAST_CLOSING_ENGAGE_MS, ...fast }))
    expect(state.fastClosing.active).toBe(true)
  })

  it('holds fast-closing through the full 600 ms release hysteresis', () => {
    const fast = { closingRateBehind: RC07_FAST_CLOSING_RATE_S_PER_S + 0.1 }
    let state = advanceRc07Alerts(createRc07AlertState(), alertInput({ nowMs: 0, ...fast }))
    state = advanceRc07Alerts(state, alertInput({ nowMs: 300, ...fast }))
    expect(state.fastClosing.active).toBe(true)
    state = advanceRc07Alerts(state, alertInput({ nowMs: 400, closingRateBehind: 0.01 }))
    expect(state.fastClosing.active).toBe(true)
    state = advanceRc07Alerts(state, alertInput({ nowMs: 400 + RC07_FAST_CLOSING_RELEASE_MS - 1, closingRateBehind: 0.01 }))
    expect(state.fastClosing.active).toBe(true)
    state = advanceRc07Alerts(state, alertInput({ nowMs: 400 + RC07_FAST_CLOSING_RELEASE_MS, closingRateBehind: 0.01 }))
    expect(state.fastClosing.active).toBe(false)
  })

  it('restarts the release hysteresis when the car closes again mid-release', () => {
    const fast = { closingRateBehind: RC07_FAST_CLOSING_RATE_S_PER_S + 0.1 }
    let state = advanceRc07Alerts(createRc07AlertState(), alertInput({ nowMs: 0, ...fast }))
    state = advanceRc07Alerts(state, alertInput({ nowMs: 300, ...fast }))
    state = advanceRc07Alerts(state, alertInput({ nowMs: 400, closingRateBehind: 0 }))
    state = advanceRc07Alerts(state, alertInput({ nowMs: 700, ...fast }))
    expect(state.fastClosing.releaseSinceMs).toBeNull()
    state = advanceRc07Alerts(state, alertInput({ nowMs: 1_100, closingRateBehind: 0 }))
    expect(state.fastClosing.active).toBe(true)
  })

  it('disarms fast-closing without a radar, without a contact behind or without a rate', () => {
    const fast = { closingRateBehind: RC07_FAST_CLOSING_RATE_S_PER_S + 0.1 }
    let state = advanceRc07Alerts(createRc07AlertState(), alertInput({ nowMs: 0, ...fast }))
    state = advanceRc07Alerts(state, alertInput({ nowMs: 300, ...fast }))
    expect(state.fastClosing.active).toBe(true)
    expect(advanceRc07Alerts(state, alertInput({ nowMs: 400, ...fast, radarAvailable: false })).fastClosing.active).toBe(false)
    expect(advanceRc07Alerts(state, alertInput({ nowMs: 400, ...fast, closingContactInRange: false })).fastClosing.active).toBe(false)
    expect(advanceRc07Alerts(state, alertInput({ nowMs: 400, closingRateBehind: null })).fastClosing.active).toBe(false)
  })

  it('engages imminent proximity after 100 ms and clears the instant the zone empties', () => {
    let state = advanceRc07Alerts(createRc07AlertState(), alertInput({ nowMs: 0, criticalSide: 'left' }))
    expect(state.imminent.active).toBe(false)
    state = advanceRc07Alerts(state, alertInput({ nowMs: RC07_IMMINENT_ENGAGE_MS - 1, criticalSide: 'left' }))
    expect(state.imminent.active).toBe(false)
    state = advanceRc07Alerts(state, alertInput({ nowMs: RC07_IMMINENT_ENGAGE_MS, criticalSide: 'left' }))
    expect(state.imminent.active).toBe(true)
    expect(state.imminent.side).toBe('left')
    // No release hysteresis: the packet clears it as soon as the object leaves.
    state = advanceRc07Alerts(state, alertInput({ nowMs: 150, criticalSide: null }))
    expect(state.imminent.active).toBe(false)
    expect(state.imminent.side).toBeNull()
  })

  it('hides imminent proximity entirely when the radar is unavailable', () => {
    let state = advanceRc07Alerts(createRc07AlertState(), alertInput({ nowMs: 0, criticalSide: 'right' }))
    state = advanceRc07Alerts(state, alertInput({ nowMs: 200, criticalSide: 'right' }))
    expect(state.imminent.active).toBe(true)
    state = advanceRc07Alerts(state, alertInput({ nowMs: 300, criticalSide: 'right', radarAvailable: false }))
    expect(state.imminent.active).toBe(false)
  })

  it('unlatches every alert whose input has gone stale or missing', () => {
    const latched = {
      blueFlag: { active: true, minimumVisibleUntilMs: 10_000 },
      fastClosing: { active: true, pendingSinceMs: 0, releaseSinceMs: null },
      imminent: { active: true, pendingSinceMs: 0, side: 'left' as const }
    }
    const noFlag = clearInvalidRc07Alerts(latched, modelFor(snapshot({ flags: undefined })))
    expect(noFlag.blueFlag.active).toBe(false)
    const noRadar = clearInvalidRc07Alerts(latched, modelFor(snapshot({ radarCars: undefined })))
    expect(noRadar.fastClosing.active).toBe(false)
    expect(noRadar.imminent.active).toBe(false)
    const noGap = clearInvalidRc07Alerts(latched, modelFor(snapshot({ relatives: undefined })))
    expect(noGap.fastClosing.active).toBe(false)
    // A frozen frame past every budget cannot hold anything on either.
    const stale = clearInvalidRc07Alerts(latched, modelFor(snapshot(), 10_000, {}, 0))
    expect(stale.blueFlag.active).toBe(false)
    expect(stale.fastClosing.active).toBe(false)
    expect(stale.imminent.active).toBe(false)
  })

  it('builds its alert inputs only from fresh, available channels', () => {
    const live = rc07AlertInputForModel(modelFor(snapshot()), 0.3, 100)
    expect(live).toMatchObject({
      nowMs: 100,
      blueFlag: false,
      radarAvailable: true,
      closingRateBehind: 0.3,
      closingContactInRange: true,
      criticalSide: null
    })
    const blue = rc07AlertInputForModel(
      modelFor(snapshot({ flags: { ...GREEN_FLAGS, green: false, blue: true } } as Partial<TelemetrySnapshot>)),
      null,
      0
    )
    expect(blue.blueFlag).toBe(true)
    const noFeed = rc07AlertInputForModel(modelFor(snapshot({ flags: undefined })), null, 0)
    expect(noFeed.blueFlag).toBeNull()
    const noGap = rc07AlertInputForModel(modelFor(snapshot({ relatives: undefined })), 0.9, 0)
    expect(noGap.closingRateBehind).toBeNull()
  })

  it('projects the latched alerts onto the model and the alert lines', () => {
    const alerts = {
      blueFlag: { active: true, minimumVisibleUntilMs: 10_000 },
      fastClosing: { active: true, pendingSinceMs: 0, releaseSinceMs: null },
      imminent: { active: true, pendingSinceMs: 0, side: 'left' as const }
    }
    const model = modelFor(snapshot(), 0, { alerts })
    expect(model.alerts).toEqual({ blueFlag: true, fastClosing: true, imminent: true })
    expect(model.flag.duty).toBe(true)
    expect(model.behind.highlight).toBe(true)
    // The gap-ahead panel is never an alert surface for the closing-behind alert.
    expect(model.ahead.highlight).toBe(false)
    expect(rc07AlertLines(model)).toEqual(['BLUE', 'CLOSING', 'PROXIMITY'])
  })
})

describe('RC-07 nearest-cars tower is a timing tower', () => {
  it('orders the nearest cars by their own timing interval', () => {
    const rows = rc07TowerRows(snapshot(), rc07ClassOrder(snapshot()))
    expect(rows.map((row) => row.carNumber)).toEqual(['2', '54', '18', '9'])
    expect(rows.map((row) => row.classLabel)).toEqual(['A', 'C', 'B', 'B'])
    expect(rows[0].gapField.value).toBe('-0.8')
    expect(rows[1].gapField.value).toBe('+1.4')
  })

  it('excludes the player and any car without a real interval', () => {
    const rows = rc07TowerRows(snapshot(), rc07ClassOrder(snapshot()))
    expect(rows.some((row) => row.carIdx === 7)).toBe(false)
    const sparse = rc07TowerRows(
      snapshot({ drivers: [{ carIdx: 3, name: 'X', carNumber: '3', position: 2, classPosition: 1, classId: 10, isPlayer: false }] } as Partial<TelemetrySnapshot>),
      [10]
    )
    expect(sparse).toEqual([])
  })

  it('is empty rather than reconstructed from the radar when the timing feed is absent', () => {
    const model = modelFor(snapshot({ drivers: undefined }))
    expect(model.tower).toEqual([])
    expect(model.towerAvailable).toBe(false)
    expect(model.radar.blips).toHaveLength(4)
  })
})

describe('RC-07 responsive contract', () => {
  it('resolves the native, app and compact layouts from the content box', () => {
    expect(rc07LayoutForContentBox(800, 480)).toBe('native')
    expect(rc07LayoutForContentBox(801, 481)).toBe('native')
    expect(rc07LayoutForContentBox(1024, 600)).toBe('app')
    expect(rc07LayoutForContentBox(1023, 599)).toBe('app')
    expect(rc07LayoutForContentBox(900, 500)).toBe('compact')
    expect(rc07LayoutForContentBox(0, 0)).toBe('app')
  })

  it('classifies phone and landscape compact modes', () => {
    expect(rc07CompactModeForContentBox(390, 844)).toBe('phone')
    expect(rc07CompactModeForContentBox(844, 390)).toBe('landscape')
    expect(rc07CompactModeForContentBox(900, 500)).toBe('standard')
    expect(rc07CompactModeForContentBox(1024, 600)).toBe('standard')
  })

  it('emits contained portrait geometry only at the phone breakpoint', () => {
    expect(rc07PhoneGeometryForContentBox(844, 390)).toBeNull()
    expect(rc07PhoneGeometryForContentBox(1024, 600)).toBeNull()
    const geometry = rc07PhoneGeometryForContentBox(390, 844)!
    expect(geometry.inset).toBe(12)
    // The radar stays square and inside the narrow axis, so no angle is ever distorted.
    expect(geometry.radarSize).toBeLessThanOrEqual(390 - geometry.inset * 2)
    expect(geometry.flagHeight + geometry.gapHeight + geometry.selfHeight + geometry.radarSize).toBeLessThanOrEqual(844)
    expect(geometry.softKeySize).toBeGreaterThanOrEqual(44)
  })
})

describe('RC-07 rendering', () => {
  it('renders the canonical DOM contract as a split awareness display', () => {
    const html = markup(snapshot())
    assertClean(html)
    expect(html).toContain('data-widget="raceconRc07Dash"')
    expect(html).toContain('data-rc07-layout="app"')
    expect(html).toContain('data-rc07-zone="radar"')
    expect(html).toContain('data-rc07-zone="behind"')
    expect(html).toContain('data-rc07-zone="ahead"')
    expect(html).toContain('data-rc07-zone="self"')
    expect(html).toContain('data-rc07-zone="flag"')
    expect(html).toContain('data-testid="rc07-radar-plot"')
    expect(html).toContain('data-testid="rc07-own-car"')
    expect(html).toContain('data-rc07-ring="inner"')
    expect(html).toContain('data-rc07-ring="outer"')
  })

  it('renders the approved reference readouts', () => {
    const html = markup(snapshot(), nativeConfig)
    assertClean(html)
    expect(html).toContain('>GREEN<')
    expect(html).toContain('>0.8<')
    expect(html).toContain('>1.4<')
    expect(html).toContain('>14<')
    expect(html).toContain('>--.---<')
    expect(html).toContain('data-rc07-native-size="800x480"')
  })

  it('draws exactly the contacts the radar reports, never one more', () => {
    const view = render(createElement(RaceconRc07DashWidget, { snapshot: snapshot(), config }))
    const blips = view.container.querySelectorAll('[data-testid="rc07-blip"]')
    expect(blips).toHaveLength(4)
    const radii = [...blips].map((blip) => Number((blip as HTMLElement).dataset.rc07Radius))
    for (let i = 1; i < radii.length; i += 1) {
      expect(radii[i]).toBeGreaterThan(radii[i - 1])
    }
    expect([...blips].map((blip) => (blip as HTMLElement).dataset.rc07Class)).toEqual(['A', 'C', 'B', 'B'])
    cleanup()
  })

  it('shows NO DATA and no blip at all when the radar source is missing', () => {
    const view = render(
      createElement(RaceconRc07DashWidget, { snapshot: snapshot({ radarCars: undefined }), config })
    )
    expect(view.container.querySelectorAll('[data-testid="rc07-blip"]')).toHaveLength(0)
    expect(view.container.querySelector('[data-testid="rc07-radar-nodata"]')?.textContent).toBe('NO DATA')
    expect(view.container.querySelector('[data-testid="rc07-radar-plot"]')).toBeNull()
    cleanup()
  })

  it('draws no shift LED, rev bar or over-rev segment anywhere', () => {
    const html = markup(snapshot(), nativeConfig).toLowerCase()
    expect(html).not.toContain('led')
    expect(html).not.toContain('rpm')
    expect(html).not.toContain('shift')
    expect(html).not.toContain('rev-')
    expect(html).not.toContain('over-rev')
  })

  it('prints no closing-rate numeral beside the direction glyph', () => {
    const view = render(createElement(RaceconRc07DashWidget, { snapshot: snapshot(), config }))
    const glyph = view.container.querySelector('[data-testid="rc07-behind-direction"]')!
    expect(glyph.textContent).not.toMatch(/[0-9]/)
    expect(glyph.getAttribute('aria-label')).toContain('interval')
    cleanup()
  })

  it('renders no PASS or HOLD advice on the gap-ahead panel', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).not.toContain('PASS')
    expect(html).not.toContain('HOLD')
    expect(html).not.toContain('YIELD')
  })

  it('keeps every alert surface absent in the silent reference frame', () => {
    const view = render(createElement(RaceconRc07DashWidget, { snapshot: snapshot(), config }))
    const root = view.container.querySelector<HTMLElement>('.rc07-widget')!
    expect(root.dataset.rc07Alerts).toBe('silent')
    expect(root.dataset.rc07AlertKeys).toBe('')
    expect(view.container.querySelector('[data-testid="rc07-flag-duty"]')).toBeNull()
    expect(view.container.querySelector('[data-testid="rc07-radar-edge"]')).toBeNull()
    expect(view.container.querySelector('[data-rc07-zone="behind"]')?.getAttribute('data-rc07-highlight')).toBe('false')
    cleanup()
  })

  it('reveals the app-only nearest-cars tower at 1024x600 and nowhere else', () => {
    expect(markup(snapshot(), config)).toContain('data-rc07-zone="tower"')
    expect(markup(snapshot(), nativeConfig)).not.toContain('data-rc07-zone="tower"')
    expect(markup(snapshot(), { ...config, position: { x: 0, y: 0, width: 390, height: 844 } })).not.toContain(
      'data-rc07-zone="tower"'
    )
  })

  it('renders a clean, dash-only frame with no telemetry at all', () => {
    const html = markup(null, nativeConfig)
    assertClean(html)
    expect(html).toContain('NO SIGNAL')
    expect(html).toContain('NO DATA')
    expect(html).toContain('--.-')
    expect(html).toContain('--.---')
    expect(html).toContain('data-rc07-alerts="silent"')
    expect(html).not.toContain('data-testid="rc07-blip"')
  })

  it('refuses mock and replay telemetry and raises no alert from it', () => {
    for (const refused of [
      snapshot({ sim: 'mock' }),
      snapshot({ replayContext: { state: 'replay' } } as Partial<TelemetrySnapshot>)
    ]) {
      const html = markup(refused, nativeConfig)
      assertClean(html)
      expect(html).toContain('NO SIGNAL')
      expect(html).toContain('data-rc07-alerts="silent"')
      expect(html).not.toContain('data-testid="rc07-blip"')
      expect(html).not.toContain('>GREEN<')
    }
    // `replayPlaying` is a raw provider field, not a refusal trigger.
    expect(markup(snapshot({ replayPlaying: true } as Partial<TelemetrySnapshot>), nativeConfig)).toContain('>GREEN<')
  })

  it('exposes the compact mode attribute only in the compact layout', () => {
    expect(markup(snapshot(), { ...config, position: { x: 0, y: 0, width: 390, height: 844 } })).toContain(
      'data-rc07-compact-mode="phone"'
    )
    expect(markup(snapshot(), nativeConfig)).not.toContain('data-rc07-compact-mode')
  })
})

describe('RC-07 shares the RC-01 fail-closed ingest buffer', () => {
  it('accepts a live identified snapshot and rejects an unidentified one', () => {
    const buffer = new Rc01LiveTelemetryBuffer()
    expect(buffer.ingest(snapshot(), 0).reason).toBe('accepted')
    expect(buffer.ingest(snapshot({ sim: 'mock' }, 5_070_100), 100).reason).toBe('mock-telemetry')
    expect(buffer.ingest(snapshot({ sessionUniqueId: undefined }, 5_070_200), 200).reason).toBe(
      'missing-source-identity'
    )
  })
})

describe('RC-07 live traffic surfaces', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  function mount(initial: Partial<TelemetrySnapshot> = {}, cfg = config): {
    push: (atMs: number, overrides: Partial<TelemetrySnapshot> | ((ms: number) => Partial<TelemetrySnapshot>)) => void
    root: () => HTMLElement
    view: ReturnType<typeof render>
  } {
    vi.useFakeTimers()
    let monotonicMs = 0
    const monotonicClock = (): number => monotonicMs
    const view = render(
      createElement(RaceconRc07DashWidget, {
        snapshot: snapshot(initial, 1_000),
        config: cfg,
        monotonicClock
      })
    )
    const frame = (overrides: Partial<TelemetrySnapshot>): void => {
      view.rerender(
        createElement(RaceconRc07DashWidget, {
          snapshot: snapshot(overrides, 1_000 + monotonicMs),
          config: cfg,
          monotonicClock
        })
      )
    }
    // Frames are pushed at 20 Hz so the 50 ms radar budget is never missed between steps: a
    // test that jumped straight to a deadline would correctly find the alerts disarmed.
    const push = (
      atMs: number,
      overrides: Partial<TelemetrySnapshot> | ((ms: number) => Partial<TelemetrySnapshot>)
    ): void => {
      const at = (ms: number): Partial<TelemetrySnapshot> =>
        typeof overrides === 'function' ? overrides(ms) : overrides
      if (atMs <= monotonicMs) {
        frame(at(monotonicMs))
        return
      }
      while (monotonicMs < atMs) {
        const step = Math.min(50, atMs - monotonicMs)
        monotonicMs += step
        act(() => {
          vi.advanceTimersByTime(step)
        })
        frame(at(monotonicMs))
      }
    }
    return { push, root: () => view.container.querySelector<HTMLElement>('.rc07-widget')!, view }
  }

  const withGapBehind = (gapBehind: number): Partial<TelemetrySnapshot> => ({
    relatives: {
      behind: { carIdx: 11, name: 'A1', carNumber: '2', gapSec: -gapBehind },
      ahead: { carIdx: 13, name: 'C1', carNumber: '54', gapSec: 1.4 }
    }
  })

  /**
   * A continuously shrinking interval behind: 1.20 s losing 0.40 s of interval per second,
   * comfortably past the packet 15 engage threshold. It is a RAMP rather than a staircase
   * because the alert measures a first difference over a real window, and a staircase would
   * read zero as soon as both ends of that window landed on the same step.
   */
  const CLOSING_RATE = 0.0004
  const closingRamp = (ms: number): Partial<TelemetrySnapshot> => withGapBehind(1.2 - CLOSING_RATE * ms)
  const settledGap = (atMs: number) => (): Partial<TelemetrySnapshot> =>
    withGapBehind(1.2 - CLOSING_RATE * atMs)

  it('keeps every alert surface absent while nothing has triggered', () => {
    const { root, view } = mount()
    expect(root().dataset.rc07Alerts).toBe('silent')
    expect(view.container.querySelector('[data-testid="rc07-flag-duty"]')).toBeNull()
    expect(view.container.querySelector('[data-testid="rc07-radar-edge"]')).toBeNull()
    expect(root().dataset.rc07Radar).toBe('live')
    expect(root().dataset.rc07Flag).toBe('GREEN')
  })

  it('latches the BLUE gate chip on the flag event and holds it a full second', () => {
    const { push, root, view } = mount()
    const blue = { flags: { ...GREEN_FLAGS, green: false, blue: true } } as Partial<TelemetrySnapshot>
    push(100, blue)
    expect(root().dataset.rc07AlertKeys).toContain('BLUE')
    const chip = view.container.querySelector('[data-testid="rc07-flag-duty"]')!
    expect(chip.textContent).toContain('BLUE')
    // The flag drops but the minimum display holds the chip.
    push(300, {})
    expect(view.container.querySelector('[data-testid="rc07-flag-duty"]')).not.toBeNull()
    push(1_200, {})
    expect(view.container.querySelector('[data-testid="rc07-flag-duty"]')).toBeNull()
    expect(root().dataset.rc07Flag).toBe('GREEN')
  })

  it('shows NO SIGNAL and drops the chip when the race-control feed disappears', () => {
    const { push, root, view } = mount({ flags: { ...GREEN_FLAGS, green: false, blue: true } })
    push(100, { flags: { ...GREEN_FLAGS, green: false, blue: true } })
    expect(view.container.querySelector('[data-testid="rc07-flag-duty"]')).not.toBeNull()
    push(200, { flags: undefined })
    expect(root().dataset.rc07Flag).toBe('no-signal')
    expect(view.container.querySelector('[data-testid="rc07-flag-state"]')?.textContent).toBe('NO SIGNAL')
    expect(view.container.querySelector('[data-testid="rc07-flag-duty"]')).toBeNull()
  })

  it('highlights the gap-behind panel only after the closing debounce', () => {
    const { push, root, view } = mount(closingRamp(0))
    const panel = (): HTMLElement => view.container.querySelector<HTMLElement>('[data-rc07-zone="behind"]')!
    // The first measurable window closes at 250 ms, so the 300 ms debounce ends at 550 ms.
    push(400, closingRamp)
    expect(panel().dataset.rc07Highlight).toBe('false')
    push(800, closingRamp)
    expect(panel().dataset.rc07Highlight).toBe('true')
    expect(root().dataset.rc07AlertKeys).toContain('CLOSING')
    expect(view.container.querySelector('[data-testid="rc07-behind-direction"]')?.getAttribute('data-rc07-direction')).toBe(
      'closing'
    )
  })

  it('releases the closing highlight only after the full 600 ms hysteresis', () => {
    const { push, view } = mount(closingRamp(0))
    const panel = (): HTMLElement => view.container.querySelector<HTMLElement>('[data-rc07-zone="behind"]')!
    push(800, closingRamp)
    expect(panel().dataset.rc07Highlight).toBe('true')
    // The car settles at the interval it had reached: the rate decays to zero.
    push(1_400, settledGap(800))
    expect(panel().dataset.rc07Highlight).toBe('true')
    push(2_000, settledGap(800))
    expect(panel().dataset.rc07Highlight).toBe('false')
  })

  it('raises the red radar edge on the side carrying a critical contact', () => {
    const { push, root, view } = mount()
    const alongside = {
      radarCars: [{ carIdx: 11, name: 'A1', relativeX: -3.2, relativeY: -1.5, gapSec: -0.2 }]
    } as Partial<TelemetrySnapshot>
    push(50, alongside)
    push(200, alongside)
    const edge = view.container.querySelector<HTMLElement>('[data-testid="rc07-radar-edge"]')!
    expect(edge).not.toBeNull()
    expect(edge.dataset.rc07Side).toBe('left')
    expect(root().dataset.rc07AlertKeys).toContain('PROXIMITY')
    expect(root().dataset.rc07CriticalSide).toBe('left')
    // The blip itself is outlined too, so the state is never carried by hue alone.
    expect(view.container.querySelector<HTMLElement>('[data-testid="rc07-blip"]')!.dataset.rc07Critical).toBe('true')
  })

  it('hides the proximity alert entirely when the radar source drops out', () => {
    const { push, view } = mount()
    const alongside = {
      radarCars: [{ carIdx: 11, name: 'A1', relativeX: -3.2, relativeY: -1.5, gapSec: -0.2 }]
    } as Partial<TelemetrySnapshot>
    push(50, alongside)
    push(200, alongside)
    expect(view.container.querySelector('[data-testid="rc07-radar-edge"]')).not.toBeNull()
    push(300, { radarCars: undefined })
    expect(view.container.querySelector('[data-testid="rc07-radar-edge"]')).toBeNull()
    expect(view.container.querySelector('[data-testid="rc07-radar-nodata"]')).not.toBeNull()
  })

  it('auto-ranges with speed and answers the soft-key range event', () => {
    const { push, root } = mount()
    expect(root().dataset.rc07RadarRange).toBe('80')
    expect(root().dataset.rc07RadarRangeSource).toBe('auto')
    push(100, { speedKmh: 260 })
    expect(root().dataset.rc07RadarRange).toBe('160')
    act(() => {
      window.dispatchEvent(new CustomEvent(RC07_RADAR_RANGE_EVENT, { detail: 0 }))
    })
    expect(root().dataset.rc07RadarRange).toBe('40')
    expect(root().dataset.rc07RadarRangeSource).toBe('manual')
    act(() => {
      window.dispatchEvent(new CustomEvent(RC07_RADAR_RANGE_EVENT, { detail: 'nonsense' }))
    })
    expect(root().dataset.rc07RadarRange).toBe('40')
    act(() => {
      window.dispatchEvent(new CustomEvent(RC07_RADAR_RANGE_EVENT, { detail: 'auto' }))
    })
    expect(root().dataset.rc07RadarRangeSource).toBe('auto')
  })

  it('cycles the radar range from the unlabelled soft-key on the plot', () => {
    const { root, view } = mount()
    const plot = view.container.querySelector('[data-testid="rc07-radar-plot"]')!
    act(() => {
      fireEvent.click(plot)
    })
    expect(root().dataset.rc07RadarRange).toBe('40')
    expect(root().dataset.rc07RadarRangeSource).toBe('manual')
  })

  it('falls back to the default range without a speed channel, and says so', () => {
    const { root } = mount({ speedKmh: undefined })
    expect(root().dataset.rc07RadarRange).toBe(String(RC07_RADAR_RANGES_M[1]))
    expect(root().dataset.rc07RadarRangeSource).toBe('default')
  })

  it('clears the measured closing window and every latched alert on a source discontinuity', () => {
    const { push, root, view } = mount(closingRamp(0))
    push(800, closingRamp)
    expect(root().dataset.rc07AlertKeys).toContain('CLOSING')
    // A new session id is a different car: nothing measured before it may survive.
    push(900, (ms) => ({ ...closingRamp(ms), sessionUniqueId: 91 }))
    expect(root().dataset.rc07Alerts).toBe('silent')
    expect(view.container.querySelector('[data-rc07-zone="behind"]')?.getAttribute('data-rc07-highlight')).toBe('false')
  })

  it('keeps the hero numerals inside their own zone at the native canvas', () => {
    const { view } = mount({}, nativeConfig)
    const behind = view.container.querySelector<HTMLElement>('[data-rc07-zone="behind"]')!
    const value = view.container.querySelector<HTMLElement>('[data-testid="rc07-behind-value"]')!
    // jsdom reports zero-size rects, so this asserts the containment CONTRACT: the numeral is
    // a flex child with min-width: 0 inside an overflow-hidden zone, never a nowrap escapee.
    expect(behind.style.width).toBe('46.5%')
    expect(value.className).toContain('rc07-gap-value')
    expect(behind.getAttribute('data-rc07-zone')).toBe('behind')
  })
})
