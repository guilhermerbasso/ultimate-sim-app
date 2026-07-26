// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOverlayStyle, type OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { OVERLAY_DASHBOARD_PRESETS } from '../../../../shared/dashboards'
import { WIDGET_COMPONENTS } from './index'
import { RaceconRc11DashWidget } from './RaceconRc11DashWidget'
import {
  Rc01LiveTelemetryBuffer,
  createRc01ChannelReceipts
} from './raceconRc01Core'
import {
  RC11_ALERT_LABELS,
  RC11_APP_GG_WINDOW_PX,
  RC11_APP_ONLY_MODULES,
  RC11_APP_PLOT_X0_PX,
  RC11_APP_PLOT_X1_PX,
  RC11_APP_STACK_PX,
  RC11_APP_TYPE_SCALE,
  RC11_APP_ZONES_PX,
  RC11_CHANNEL_STALE_MS,
  RC11_CQW_PX,
  RC11_DASH,
  RC11_DATA_GAP_LABEL,
  RC11_DELTA_AXIS,
  RC11_DELTA_ZERO_PLOT_UNIT,
  RC11_DISTANCE_TICK_COUNT,
  RC11_DISTANCE_ZONES,
  RC11_GEAR_AXIS_BOTTOM,
  RC11_GEAR_AXIS_MIN_TOP,
  RC11_GG_FULL_SCALE_G,
  RC11_GG_RING_G,
  RC11_INPUT_AXIS,
  RC11_LAP_TOKENS,
  RC11_LEGEND_MIN_STRIP_CQW,
  RC11_LIFT_COAST_ENTER_PCT,
  RC11_LIFT_COAST_EXIT_PCT,
  RC11_LIFT_COAST_MAX_BRAKE_PCT,
  RC11_LIFT_COAST_MIN_SAMPLES,
  RC11_NATIVE_PLOT_X0_PX,
  RC11_NATIVE_PLOT_X1_PX,
  RC11_NATIVE_ZONES_PX,
  RC11_PACKET_OMISSIONS,
  RC11_REFERENCE_ACCESSIBILITY,
  RC11_SECTOR_UNAVAILABLE_NOTICE,
  RC11_SILENT_TOKENS,
  RC11_SPEED_AXIS,
  RC11_SPEED_DASH_MS,
  RC11_TOKENS,
  RC11_TRACE_LIMIT,
  RC11_TYPE_SCALE_PX,
  type Rc11AlertInput,
  Rc11AuxBuffer,
  type Rc11Layout,
  type Rc11Rect,
  Rc11TraceBuffer,
  type Rc11TraceSample,
  type Rc11ZoneMap,
  advanceRc11Alerts,
  clearInvalidRc11Alerts,
  createRc11AlertState,
  createRc11AuxReceipts,
  createRc11DashboardModel,
  dismissRc11Marker,
  rc11AlertInputForModel,
  rc11AlertMarkers,
  rc11AuxChannelValue,
  rc11CompactModeForContentBox,
  rc11CursorCanvasXPx,
  rc11DisplayGear,
  rc11DistanceTicks,
  rc11FormatDelta,
  rc11GapBands,
  rc11GearAxis,
  rc11GgPoints,
  rc11GgRings,
  rc11LapDistanceM,
  rc11LayoutForContentBox,
  rc11LegendPlacement,
  rc11LiftCoastMarkers,
  rc11LockUpMarkers,
  rc11PatternFingerprint,
  rc11PhoneGeometryForContentBox,
  rc11PlotInsetCqw,
  rc11PlotRegionPx,
  rc11PlotSpanPercent,
  rc11PlotX,
  rc11PlotY,
  rc11RectPercent,
  rc11RectsOverlap,
  rc11SectorRows,
  rc11TraceSegments,
  rc11TypeScaleCqw,
  rc11TypeScalePxForWidth,
  rc11WheelSpeedKmh,
  rc11ZoneStyle,
  rc11ZonesForLayout
} from './raceconRc11Core'

const config: OverlayWidgetConfig = {
  id: 'raceconRc11Dash',
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
 * The stylesheet is read as TEXT, not as a loaded module, because three of RC-11's guarantees are
 * properties of the source itself: `caution` and `danger` may only be referenced inside a marker
 * rule, `normal` may not be referenced at all, and the delta trace must never be bound to any of
 * the three. Vitest's root is `app-v2`.
 */
const CSS_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/overlay/widgets/raceconRc11.css'),
  'utf8'
)

/**
 * The stylesheet with its comments stripped. The comments deliberately NAME the forbidden bindings,
 * so every rule below is asserted against the declarations alone, never against the prose.
 */
const CSS_DECLARATIONS = CSS_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')

function cssRules(): { selector: string; body: string }[] {
  const rules: { selector: string; body: string }[] = []
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match = pattern.exec(CSS_DECLARATIONS)
  while (match) {
    rules.push({ selector: match[1].trim(), body: match[2] })
    match = pattern.exec(CSS_DECLARATIONS)
  }
  return rules
}

/**
 * The approved RC-11 reference state (attempt-004 governed 800x480,
 * `input/telemetry-frame-between-runs-cursor-u62.json`): a lap being studied between runs at the
 * pit wall, cursor placed at 62 % of the shared axis reading 214 km/h and +0.184 s, sixth gear,
 * tyre FL 84 degC, tyre FR 86 degC, and NO front brake-temperature sensor fitted so window tile 3
 * reads the grey dash. All three packet section 15 alerts are ARMED and SILENT.
 */
function snapshot(overrides: Partial<TelemetrySnapshot> = {}, timestamp = 1_411_000): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp,
    sessionUniqueId: 41,
    currentLap: 12,
    gear: 6,
    rpm: 7_150,
    maxRpm: 8_600,
    speedKmh: 214,
    throttle: 1,
    brake: 0,
    clutch: 0,
    steerAngleDeg: -14,
    latAccelG: 0.42,
    longAccelG: 0.31,
    deltaToBestSec: 0.184,
    bestLapTimeSec: 91.6,
    lastLapTimeSec: 91.9,
    tyres: { lf: { tempC: 84 }, rf: { tempC: 86 }, lr: { tempC: 81 }, rr: { tempC: 83 } },
    sessionType: 'Practice',
    sessionState: 'racing',
    playerCarIdx: 4,
    ...overrides
  } as TelemetrySnapshot
}

function markup(value: TelemetrySnapshot | null, cfg = config): string {
  return renderToStaticMarkup(createElement(RaceconRc11DashWidget, { snapshot: value, config: cfg }))
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
  options: Parameters<typeof createRc11DashboardModel>[4] = {},
  receiptsAtMs = nowMs
): ReturnType<typeof createRc11DashboardModel> {
  const receipts = value ? createRc01ChannelReceipts(value, receiptsAtMs) : new Map()
  const aux = value ? createRc11AuxReceipts(value, receiptsAtMs) : new Map()
  return createRc11DashboardModel(value, receipts, aux, nowMs, options)
}

function traceSample(overrides: Partial<Rc11TraceSample> = {}, index = 0): Rc11TraceSample {
  return {
    timestamp: 1_000 + index * 20,
    receivedAt: index * 20,
    lap: 12,
    speedKmh: 200,
    throttlePct: 100,
    brakePct: 0,
    steeringDeg: 0,
    gear: 5,
    deltaSec: 0.1,
    latG: 0.2,
    longG: 0.1,
    ...overrides
  }
}

function series(count: number, build: (index: number) => Partial<Rc11TraceSample>): Rc11TraceSample[] {
  return Array.from({ length: count }, (_unused, index) => traceSample(build(index), index))
}

function alertInput(overrides: Partial<Rc11AlertInput> = {}): Rc11AlertInput {
  return {
    nowMs: 0,
    samples: [],
    reference: [],
    throttleAvailable: true,
    brakeAvailable: true,
    wheelSpeedAvailable: false,
    ...overrides
  }
}

function right(rect: Rc11Rect): number {
  return rect.left + rect.width
}

function bottom(rect: Rc11Rect): number {
  return rect.top + rect.height
}

function allZones(zones: Rc11ZoneMap): Rc11Rect[] {
  return Object.values(zones).filter((rect): rect is Rc11Rect => Boolean(rect))
}

/** The drawing region of one distance-domain panel, in CANVAS pixels. */
function plotRegionForZone(zone: Rc11Rect, layout: Rc11Layout, canvasWidth: number): { x0: number; x1: number } {
  const inset = rc11PlotInsetCqw(zone, layout)
  return {
    x0: (zone.left / 100) * canvasWidth + (inset.left / 100) * canvasWidth,
    x1: ((zone.left + zone.width) / 100) * canvasWidth - (inset.right / 100) * canvasWidth
  }
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

describe('RC-11 registration and preset wiring', () => {
  it('registers the widget component under its canonical id', () => {
    expect(WIDGET_COMPONENTS.raceconRc11Dash).toBe(RaceconRc11DashWidget)
  })

  it('declares exactly one RC-11 full-frame preset directly after RC-10', () => {
    const ids = OVERLAY_DASHBOARD_PRESETS.map((entry) => entry.id)
    expect(ids.filter((id) => id === 'racecon_rc11_dash')).toHaveLength(1)
    expect(ids.indexOf('racecon_rc11_dash')).toBe(ids.indexOf('racecon_rc10_dash') + 1)
    const preset = OVERLAY_DASHBOARD_PRESETS.find((entry) => entry.id === 'racecon_rc11_dash')
    expect(preset?.widgetId).toBe('raceconRc11Dash')
    expect(preset?.name).toBe('RaceCon RC-11 Trace Room')
    expect(preset?.scaleMode).toBe('stretch')
    expect(preset?.tags).toContain('engineer')
    expect(preset?.tags).toContain('analysis')
  })
})

describe('RC-11 packet omissions are contractual, not accidental', () => {
  it('records every contradiction resolved by omission', () => {
    expect(Object.keys(RC11_PACKET_OMISSIONS).sort()).toEqual([
      'fixedTroughCount',
      'lapDistanceChannel',
      'legendDivider',
      'perWheelSpeedChannel',
      'rpmZone',
      'steeringAt800'
    ])
    for (const reason of Object.values(RC11_PACKET_OMISSIONS)) {
      expect(reason.length).toBeGreaterThan(40)
    }
    expect(Object.isFrozen(RC11_PACKET_OMISSIONS)).toBe(true)
  })

  it('measures the missing lap-distance channel rather than asserting a comment', () => {
    expect(rc11LapDistanceM(snapshot())).toBeNull()
    expect(rc11LapDistanceM(null)).toBeNull()
    const ticks = rc11DistanceTicks()
    expect(ticks).toHaveLength(RC11_DISTANCE_TICK_COUNT)
    for (const tick of ticks) {
      expect(tick.label).toBe(RC11_DASH.distance)
      expect(tick.unavailable).toBe(true)
    }
  })

  it('measures the missing per-wheel speed channel, so the lock-up flag can never fire', () => {
    for (const corner of ['lf', 'rf', 'lr', 'rr'] as const) {
      expect(rc11WheelSpeedKmh(snapshot(), corner)).toBeNull()
    }
    expect(rc11LockUpMarkers(alertInput({ wheelSpeedAvailable: false }))).toHaveLength(0)
    // Even if a caller CLAIMS wheel speed is available, there is no channel to compute a pattern
    // from, so the flag stays silent rather than inventing a trigger.
    expect(rc11LockUpMarkers(alertInput({ wheelSpeedAvailable: true }))).toHaveLength(0)
  })

  it('gives RPM no channel, no zone, no numeral and above all no LED arc', () => {
    expect(Object.keys(RC11_CHANNEL_STALE_MS)).not.toContain('rpm')
    expect(RC11_NATIVE_ZONES_PX).not.toHaveProperty('rpm')
    expect(RC11_APP_ZONES_PX).not.toHaveProperty('rpm')
    const html = markup(snapshot(), nativeConfig)
    expect(html).not.toContain('rc11-led')
    expect(html).not.toContain('data-rc11-zone="rpm"')
    expect(html.toUpperCase()).not.toContain('>RPM<')
    expect(CSS_DECLARATIONS).not.toContain('rc11-led')
  })

  it('keeps the steering trace and the mini-sector table out of the 800x480 grammar', () => {
    expect(RC11_APP_ONLY_MODULES).toEqual(['steering', 'sectors'])
    expect(RC11_NATIVE_ZONES_PX).not.toHaveProperty('sectors')
    expect(RC11_APP_ZONES_PX.sectors).toBeDefined()

    const native = markup(snapshot(), nativeConfig)
    expect(native).not.toContain('data-rc11-zone="sectors"')
    expect(native).not.toContain('data-rc11-series="steering"')

    const app = markup(snapshot(), config)
    expect(app).toContain('data-rc11-zone="sectors"')
    expect(app).toContain('data-rc11-series="steering"')
  })
})

describe('RC-11 packet zone geometry', () => {
  it('reproduces packet 11.1 verbatim rather than tracing the render', () => {
    expect(RC11_NATIVE_ZONES_PX.speed).toEqual({ x: 16, y: 30, width: 768, height: 120 })
    expect(RC11_NATIVE_ZONES_PX.inputs).toEqual({ x: 16, y: 158, width: 768, height: 110 })
    expect(RC11_NATIVE_ZONES_PX.gear).toEqual({ x: 16, y: 276, width: 510, height: 80 })
    expect(RC11_NATIVE_ZONES_PX.delta).toEqual({ x: 16, y: 362, width: 510, height: 100 })
    expect(RC11_NATIVE_ZONES_PX.gg).toEqual({ x: 540, y: 276, width: 244, height: 110 })
    expect(RC11_NATIVE_ZONES_PX.tiles).toEqual({ x: 540, y: 394, width: 244, height: 68 })
  })

  it('publishes the packet 11.1 origin and size percentages the brief tabulates', () => {
    const zones = rc11ZonesForLayout('native')
    const round2 = (value: number): number => Math.round(value * 100) / 100
    expect([round2(zones.speed!.left), round2(zones.speed!.top), round2(zones.speed!.width), round2(zones.speed!.height)]).toEqual([2, 6.25, 96, 25])
    expect([round2(zones.inputs!.left), round2(zones.inputs!.top), round2(zones.inputs!.width), round2(zones.inputs!.height)]).toEqual([2, 32.92, 96, 22.92])
    expect([round2(zones.gear!.left), round2(zones.gear!.top), round2(zones.gear!.width), round2(zones.gear!.height)]).toEqual([2, 57.5, 63.75, 16.67])
    expect([round2(zones.delta!.left), round2(zones.delta!.top), round2(zones.delta!.width), round2(zones.delta!.height)]).toEqual([2, 75.42, 63.75, 20.83])
    expect([round2(zones.gg!.left), round2(zones.gg!.top), round2(zones.gg!.width), round2(zones.gg!.height)]).toEqual([67.5, 57.5, 30.5, 22.92])
    expect([round2(zones.tiles!.left), round2(zones.tiles!.top), round2(zones.tiles!.width), round2(zones.tiles!.height)]).toEqual([67.5, 82.08, 30.5, 14.17])
  })

  it('publishes the packet 12.1 percentages and keeps the two declared composite boxes intact', () => {
    const zones = rc11ZonesForLayout('app')
    const round2 = (value: number): number => Math.round(value * 100) / 100
    expect([round2(zones.speed!.left), round2(zones.speed!.top), round2(zones.speed!.width), round2(zones.speed!.height)]).toEqual([2.34, 4, 97.66, 25])
    expect([round2(zones.inputs!.left), round2(zones.inputs!.top), round2(zones.inputs!.width), round2(zones.inputs!.height)]).toEqual([2.34, 31, 68.36, 23.33])
    expect([round2(zones.sectors!.left), round2(zones.sectors!.top), round2(zones.sectors!.width), round2(zones.sectors!.height)]).toEqual([72.27, 66.33, 27.73, 26.67])

    // Packet 12.1 declares gear+delta as ONE stacked box; the two panels' union must be exactly it.
    const gear = RC11_APP_ZONES_PX.gear!
    const delta = RC11_APP_ZONES_PX.delta!
    expect(gear.x).toBe(RC11_APP_STACK_PX.x)
    expect(gear.y).toBe(RC11_APP_STACK_PX.y)
    expect(delta.y + delta.height).toBe(RC11_APP_STACK_PX.y + RC11_APP_STACK_PX.height)
    expect(delta.y - (gear.y + gear.height)).toBe(4)

    // Packet 12.1 likewise declares G-G + windows as one box.
    const gg = RC11_APP_ZONES_PX.gg!
    const tiles = RC11_APP_ZONES_PX.tiles!
    expect(gg.x).toBe(RC11_APP_GG_WINDOW_PX.x)
    expect(gg.y).toBe(RC11_APP_GG_WINDOW_PX.y)
    expect(tiles.y + tiles.height).toBe(RC11_APP_GG_WINDOW_PX.y + RC11_APP_GG_WINDOW_PX.height)
    expect(tiles.y - (gg.y + gg.height)).toBe(4)
  })

  it('keeps every zone inside the canvas and never overlaps two zones, at every breakpoint', () => {
    for (const box of BREAKPOINTS) {
      const layout = rc11LayoutForContentBox(box.width, box.height)
      const zones = rc11ZonesForLayout(layout, rc11CompactModeForContentBox(box.width, box.height), box)
      const rects = allZones(zones)
      expect(rects.length).toBeGreaterThanOrEqual(6)
      for (const rect of rects) {
        expect(rect.left).toBeGreaterThanOrEqual(0)
        expect(rect.top).toBeGreaterThanOrEqual(0)
        expect(right(rect)).toBeLessThanOrEqual(100.001)
        expect(bottom(rect)).toBeLessThanOrEqual(100.001)
      }
      for (let a = 0; a < rects.length; a += 1) {
        for (let b = a + 1; b < rects.length; b += 1) {
          expect(rc11RectsOverlap(rects[a], rects[b]), `${box.width}x${box.height} zones ${a}/${b} overlap`).toBe(false)
        }
      }
    }
  })

  it('emits zone geometry as inline percentages without binary-float noise', () => {
    expect(rc11ZoneStyle(undefined)).toBeNull()
    expect(rc11ZoneStyle({ left: 2, top: 6.25, width: 96, height: 25 })).toEqual({
      left: '2%',
      top: '6.25%',
      width: '96%',
      height: '25%'
    })
    expect(rc11RectPercent({ x: 540, y: 394, width: 244, height: 68 }, 800, 480).left).toBe(67.5)
  })
})

describe('RC-11 shared distance axis — the single hardest requirement', () => {
  it('pins all four distance-domain plots to one pixel-identical drawing region', () => {
    for (const layout of ['native', 'app'] as const) {
      const canvasWidth = layout === 'app' ? 1024 : 800
      const expected =
        layout === 'app'
          ? { x0: RC11_APP_PLOT_X0_PX, x1: RC11_APP_PLOT_X1_PX }
          : { x0: RC11_NATIVE_PLOT_X0_PX, x1: RC11_NATIVE_PLOT_X1_PX }
      const zones = rc11ZonesForLayout(layout)
      const regions = RC11_DISTANCE_ZONES.map((id) => plotRegionForZone(zones[id]!, layout, canvasWidth))

      for (const [index, region] of regions.entries()) {
        expect(region.x0, `${layout} ${RC11_DISTANCE_ZONES[index]} plot x0`).toBeCloseTo(expected.x0, 9)
        expect(region.x1, `${layout} ${RC11_DISTANCE_ZONES[index]} plot x1`).toBeCloseTo(expected.x1, 9)
      }
      // Every pair is identical, not merely close to a nominal target.
      for (let a = 1; a < regions.length; a += 1) {
        expect(regions[a].x0).toBeCloseTo(regions[0].x0, 9)
        expect(regions[a].x1).toBeCloseTo(regions[0].x1, 9)
      }
      expect(rc11PlotRegionPx(layout)).toEqual(expected)
    }
  })

  it('leaves the residual strip of zones 1 and 2 to the legend and never lets a trace enter it', () => {
    const nativeZones = rc11ZonesForLayout('native')
    // 800x480: the legend strip is x = 528..776 — the packet zone right edge minus the plot edge.
    expect(right(nativeZones.speed!) * 8).toBeCloseTo(784, 6)
    expect(RC11_NATIVE_PLOT_X1_PX).toBe(520)
    expect(rc11PlotInsetCqw(nativeZones.speed!, 'native').right * 8).toBeCloseTo(264, 6)
    expect(rc11PlotInsetCqw(nativeZones.gear!, 'native').right * 8).toBeCloseTo(6, 6)

    const appZones = rc11ZonesForLayout('app')
    // 1024x600: the legend strip is x = 726..1016.
    expect(rc11PlotInsetCqw(appZones.speed!, 'app').right * 10.24).toBeCloseTo(1_024 - 718, 6)
    expect(rc11PlotInsetCqw(appZones.inputs!, 'app').right * 10.24).toBeCloseTo(724 - 718, 6)
    expect(rc11PlotSpanPercent('app')).toEqual({ x0: 8.59375, x1: 70.1171875 })
  })

  it('places the cursor at the same canvas pixel in every panel', () => {
    for (const layout of ['native', 'app'] as const) {
      for (const fraction of [0, 0.25, 0.62, 1]) {
        const canvasX = rc11CursorCanvasXPx(fraction, layout)
        const region = rc11PlotRegionPx(layout)
        expect(canvasX).toBeCloseTo(region.x0 + fraction * (region.x1 - region.x0), 6)
        expect(canvasX).toBeGreaterThanOrEqual(region.x0)
        expect(canvasX).toBeLessThanOrEqual(region.x1)
      }
    }
    // Out-of-range scrubs are clamped onto the shared span rather than escaping the plot.
    expect(rc11CursorCanvasXPx(-3, 'native')).toBe(RC11_NATIVE_PLOT_X0_PX)
    expect(rc11CursorCanvasXPx(9, 'native')).toBe(RC11_NATIVE_PLOT_X1_PX)
  })

  it('renders one identical plot region and one identical cursor x in all four DOM panels', () => {
    for (const [cfg, expected] of [
      [nativeConfig, { x0: RC11_NATIVE_PLOT_X0_PX, x1: RC11_NATIVE_PLOT_X1_PX }],
      [config, { x0: RC11_APP_PLOT_X0_PX, x1: RC11_APP_PLOT_X1_PX }]
    ] as const) {
      const html = markup(snapshot(), cfg)
      const x0 = [...html.matchAll(/data-rc11-plot-x0="([-\d.]+)"/g)].map((match) => Number(match[1]))
      const x1 = [...html.matchAll(/data-rc11-plot-x1="([-\d.]+)"/g)].map((match) => Number(match[1]))
      const cursorX = [...html.matchAll(/data-rc11-cursor-x="([-\d.]+)"/g)].map((match) => Number(match[1]))

      expect(x0).toHaveLength(4)
      expect(x1).toHaveLength(4)
      expect(new Set(x0).size).toBe(1)
      expect(new Set(x1).size).toBe(1)
      expect(x0[0]).toBe(expected.x0)
      expect(x1[0]).toBe(expected.x1)
      // Four panels plus the root marker, all agreeing on one cursor pixel.
      expect(cursorX).toHaveLength(5)
      expect(new Set(cursorX).size).toBe(1)
      expect(cursorX[0]).toBe((expected.x0 + expected.x1) / 2)
    }
  })

  it('never gives plot width away to a legend that cannot fit its strip', () => {
    const nativeZones = rc11ZonesForLayout('native')
    expect(rc11LegendPlacement(nativeZones.speed, 'native')).toBe('strip')
    expect(rc11LegendPlacement(nativeZones.inputs, 'native')).toBe('strip')

    const appZones = rc11ZonesForLayout('app')
    expect(rc11LegendPlacement(appZones.speed, 'app')).toBe('strip')
    // Packet 12.1 leaves the 1024x600 inputs overlay a 6 px residual, so the legend moves onto the
    // title line rather than shrinking the shared plot region to make room for itself.
    expect(rc11LegendPlacement(appZones.inputs, 'app')).toBe('inline')
    expect(rc11LegendPlacement(undefined, 'app')).toBe('inline')
    expect(RC11_LEGEND_MIN_STRIP_CQW).toBe(8)

    const app = markup(snapshot(), config)
    expect(app).toContain('data-testid="rc11-legend-inputs"')
    expect(app).toMatch(/rc11-legend-inputs"\s+data-rc11-legend-placement="inline"/)
    expect(app).toMatch(/rc11-legend-speed"\s+data-rc11-legend-placement="strip"/)
  })

  it('gives every panel the same plot inset in container units, whatever its own width', () => {    const zones = rc11ZonesForLayout('native')
    const insets = RC11_DISTANCE_ZONES.map((id) => rc11PlotInsetCqw(zones[id]!, 'native'))
    for (const inset of insets) {
      // The LEFT inset is identical because every zone starts at 2 %; the RIGHT inset differs
      // because the zones differ in width — which is exactly why the inset is applied at all.
      expect(inset.left).toBeCloseTo(6.75, 6)
    }
    expect(insets[0].right).not.toBeCloseTo(insets[2].right, 3)
  })
})

describe('RC-11 type ladder is arithmetic', () => {
  it('sets the packet 11.2 ladder at 28 / 22 / 16 / 14 px and never from the render', () => {
    expect(RC11_TYPE_SCALE_PX).toEqual({ tileValue: 28, cursorReadout: 22, traceLegend: 16, axisLabel: 14 })
    // The tile value is the tallest glyph in the frame; the cursor readout is its OWN rung.
    expect(RC11_TYPE_SCALE_PX.tileValue).toBeGreaterThan(RC11_TYPE_SCALE_PX.cursorReadout)
    expect(RC11_TYPE_SCALE_PX.cursorReadout).toBeGreaterThan(RC11_TYPE_SCALE_PX.traceLegend)
    expect(RC11_TYPE_SCALE_PX.traceLegend).toBeGreaterThan(RC11_TYPE_SCALE_PX.axisLabel)
  })

  it('expresses the ladder in container units so 1024x600 is the packet 1.28 step', () => {
    expect(RC11_CQW_PX).toBe(8)
    expect(RC11_APP_TYPE_SCALE).toBe(1.28)
    expect(rc11TypeScaleCqw(RC11_TYPE_SCALE_PX.tileValue)).toBe(3.5)
    expect(rc11TypeScaleCqw(RC11_TYPE_SCALE_PX.cursorReadout)).toBe(2.75)
    expect(rc11TypeScaleCqw(RC11_TYPE_SCALE_PX.traceLegend)).toBe(2)
    expect(rc11TypeScaleCqw(RC11_TYPE_SCALE_PX.axisLabel)).toBe(1.75)
    for (const rung of Object.values(RC11_TYPE_SCALE_PX)) {
      expect(rc11TypeScalePxForWidth(rung, 800)).toBeCloseTo(rung, 3)
      expect(rc11TypeScalePxForWidth(rung, 1_024)).toBeCloseTo(rung * RC11_APP_TYPE_SCALE, 3)
    }
  })

  it('never sizes the cursor readout from the trace legend', () => {
    const cursorRule = cssRules().find((rule) => rule.selector.includes('.rc11-cursor-readout') && rule.body.includes('font-size'))
    expect(cursorRule?.body).toContain('--rc11-type-cursor')
    expect(cursorRule?.body).not.toContain('--rc11-type-legend')
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('--rc11-type-cursor:2.75cqw')
    expect(html).toContain('--rc11-type-tile:3.5cqw')
  })
})

describe('RC-11 colour contract', () => {
  it('binds the packet 11.3 tokens verbatim', () => {
    expect(RC11_TOKENS).toEqual({
      bg: '#0E1116',
      panel: '#171C24',
      primary: '#E6EBF0',
      secondary: '#8A97A6',
      info: '#4FC3F7',
      normal: '#66BB6A',
      caution: '#FFB300',
      danger: '#EF5350',
      signature: '#AB47BC'
    })
    for (const token of Object.values(RC11_TOKENS)) {
      expect(CSS_DECLARATIONS.toLowerCase()).toContain(token.toLowerCase())
    }
  })

  it('measures zero alert-token pixels while every alert is silent', () => {
    expect(RC11_SILENT_TOKENS).toEqual(['normal', 'caution', 'danger'])
    // `normal` is declared for completeness and never referenced anywhere.
    expect(CSS_DECLARATIONS).not.toContain('var(--rc11-normal)')
    for (const rule of cssRules()) {
      for (const token of ['caution', 'danger']) {
        if (!rule.body.includes(`var(--rc11-${token})`)) continue
        expect(rule.selector, `${token} bound outside the marker layer: ${rule.selector}`).toContain('.rc11-marker')
      }
    }
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('data-rc11-alerts="silent"')
    expect(html).not.toContain('data-testid="rc11-marker"')
  })

  it('never traffic-light colours the delta trace', () => {
    for (const value of [-0.4, 0, 0.4]) {
      const model = modelFor(snapshot({ deltaToBestSec: value }), 0, {
        samples: series(8, (index) => ({ deltaSec: index % 2 === 0 ? 0.2 : -0.2 }))
      })
      const delta = model.plots.find((plot) => plot.id === 'delta')!
      expect(delta.series).toHaveLength(1)
      expect(delta.series[0].token).toBe(RC11_LAP_TOKENS.current)
      expect(RC11_SILENT_TOKENS).not.toContain(delta.series[0].token)
    }
    // And the stylesheet cannot reintroduce it: no trace rule references an alert token.
    for (const rule of cssRules()) {
      if (!rule.selector.includes('.rc11-trace')) continue
      expect(rule.body).not.toContain('var(--rc11-caution)')
      expect(rule.body).not.toContain('var(--rc11-danger)')
      expect(rule.body).not.toContain('var(--rc11-normal)')
    }
  })

  it('keeps the current lap solid and the reference lap dashed, before any colour', () => {
    const reference = series(20, (index) => ({ speedKmh: 180 + index }))
    const model = modelFor(snapshot(), 0, { samples: series(20, (index) => ({ speedKmh: 190 + index })), reference })
    const speed = model.plots.find((plot) => plot.id === 'speed')!
    const current = speed.series.find((entry) => entry.id === 'speedCurrent')!
    const overlay = speed.series.find((entry) => entry.id === 'speedReference')!
    expect(current.style).toBe('solid')
    expect(current.token).toBe('info')
    expect(overlay.style).toBe('dashed')
    expect(overlay.token).toBe('signature')

    const inputs = model.plots.find((plot) => plot.id === 'inputs')!
    expect(inputs.series.find((entry) => entry.id === 'throttle')!.style).toBe('solid')
    expect(inputs.series.find((entry) => entry.id === 'brake')!.style).toBe('dashed')

    expect(RC11_REFERENCE_ACCESSIBILITY.currentCoverage).toBeGreaterThanOrEqual(
      RC11_REFERENCE_ACCESSIBILITY.minCurrentCoverage
    )
    expect(RC11_REFERENCE_ACCESSIBILITY.referenceCoverage).toBeLessThanOrEqual(
      RC11_REFERENCE_ACCESSIBILITY.maxReferenceCoverage
    )
    expect(RC11_REFERENCE_ACCESSIBILITY.referenceComponents).toBeGreaterThanOrEqual(
      RC11_REFERENCE_ACCESSIBILITY.minReferenceComponents
    )
  })
})

describe('RC-11 trace geometry', () => {
  it('maps a channel value onto its axis and a sample onto the shared window', () => {
    expect(rc11PlotY(300, RC11_SPEED_AXIS)).toBe(0)
    expect(rc11PlotY(0, RC11_SPEED_AXIS)).toBe(100)
    expect(rc11PlotY(150, RC11_SPEED_AXIS)).toBe(50)
    expect(rc11PlotY(0, RC11_DELTA_AXIS)).toBe(RC11_DELTA_ZERO_PLOT_UNIT)
    expect(rc11PlotY(100, RC11_INPUT_AXIS)).toBe(0)
    expect(rc11PlotX(0, 5)).toBe(0)
    expect(rc11PlotX(4, 5)).toBe(100)
    expect(rc11PlotX(0, 1)).toBe(0)
  })

  it('drives the gear axis from the data and never from a fixed design number', () => {
    expect(rc11GearAxis([]).top).toBe(RC11_GEAR_AXIS_MIN_TOP)
    expect(rc11GearAxis([]).bottom).toBe(RC11_GEAR_AXIS_BOTTOM)
    expect(rc11GearAxis(series(4, () => ({ gear: 8 }))).top).toBe(8)
    expect(rc11GearAxis(series(4, () => ({ gear: 3 }))).top).toBe(RC11_GEAR_AXIS_MIN_TOP)
  })

  it('breaks a trace at a dropout and never interpolates across it', () => {
    const samples = series(9, (index) => ({ speedKmh: index === 4 || index === 5 ? null : 100 + index }))
    const segments = rc11TraceSegments(samples, (sample) => sample.speedKmh, RC11_SPEED_AXIS)
    expect(segments).toHaveLength(2)
    expect(segments[0]).toHaveLength(4)
    expect(segments[1]).toHaveLength(3)
    // No single segment spans the dropout: the gap is a genuine break in the geometry.
    for (const segment of segments) {
      const xs = segment.map((point) => point.x)
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(rc11PlotX(8, 9))
    }
  })

  it('publishes the dropout as an explicit labelled band', () => {
    const samples = series(9, (index) => ({ speedKmh: index === 4 || index === 5 ? null : 100 + index }))
    const bands = rc11GapBands(samples, (sample) => sample.speedKmh, 'speed')
    expect(bands).toHaveLength(1)
    expect(bands[0].fromX).toBe(rc11PlotX(4, 9))
    expect(bands[0].toX).toBe(rc11PlotX(6, 9))
    expect(bands[0].channel).toBe('speed')
    expect(RC11_DATA_GAP_LABEL).toBe('DATA GAP')

    // A dropout that never recovers still publishes a band, bounded by the window.
    const trailing = series(6, (index) => ({ speedKmh: index >= 3 ? null : 90 }))
    expect(rc11GapBands(trailing, (sample) => sample.speedKmh, 'speed')).toHaveLength(1)
    expect(rc11GapBands(series(6, () => ({ speedKmh: 90 })), (sample) => sample.speedKmh, 'speed')).toHaveLength(0)
  })

  it('bounds the acquisition window and never grows without limit', () => {
    const buffer = new Rc11TraceBuffer()
    for (let index = 0; index < RC11_TRACE_LIMIT + 40; index += 1) {
      buffer.ingest(snapshot({ timestamp: 1_000 + index * 20 }), index * 20, 0.1)
    }
    expect(buffer.history()).toHaveLength(RC11_TRACE_LIMIT)
  })
})

describe('RC-11 G-G scatter', () => {
  it('gives both axes identical units per g and draws true circles with a labelled scale', () => {
    expect(RC11_GG_FULL_SCALE_G).toBe(2)
    const rings = rc11GgRings()
    expect(rings.map((ring) => ring.g)).toEqual([...RC11_GG_RING_G])
    expect(rings.map((ring) => ring.label)).toEqual(['1.0 G', '2.0 G'])
    expect(rings[0].diameterPct).toBe(50)
    expect(rings[1].diameterPct).toBe(100)

    // One g of lateral and one g of longitudinal displace the point by the SAME plot distance.
    const [lateral] = rc11GgPoints([traceSample({ latG: 1, longG: 0 })])
    const [longitudinal] = rc11GgPoints([traceSample({ latG: 0, longG: 1 })])
    expect(lateral.x - 50).toBeCloseTo(50 - longitudinal.y, 9)

    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('data-testid="rc11-gg-ring"')
    expect(html).toContain('1.0 G')
    expect(html).toContain('2.0 G')
    expect(CSS_DECLARATIONS).toContain('aspect-ratio: 1 / 1')
  })

  it('hides a sample whenever either IMU axis is invalid, and never assumes the other', () => {
    expect(rc11GgPoints([traceSample({ latG: null, longG: 0.5 })])).toHaveLength(0)
    expect(rc11GgPoints([traceSample({ latG: 0.5, longG: null })])).toHaveLength(0)
    expect(rc11GgPoints([traceSample({ latG: 0.5, longG: 0.5 })])).toHaveLength(1)

    const model = modelFor(snapshot({ latAccelG: undefined, longAccelG: undefined } as Partial<TelemetrySnapshot>), 0, {
      samples: series(6, () => ({ latG: null, longG: null }))
    })
    expect(model.ggAvailable).toBe(false)
    expect(model.ggPoints).toHaveLength(0)
    expect(model.latG.value).toBe(RC11_DASH.tyre)
    expect(model.longG.value).toBe(RC11_DASH.tyre)
  })
})

describe('RC-11 telemetry truth table', () => {
  it('reads every channel from its own declared source', () => {
    const value = snapshot()
    expect(rc11AuxChannelValue(value, 'speed')).toBe(214)
    expect(rc11AuxChannelValue(value, 'throttle')).toBe(100)
    expect(rc11AuxChannelValue(value, 'brake')).toBe(0)
    expect(rc11AuxChannelValue(value, 'steering')).toBe(-14)
    expect(rc11AuxChannelValue(value, 'latG')).toBe(0.42)
    expect(rc11AuxChannelValue(value, 'longG')).toBe(0.31)
    expect(rc11AuxChannelValue(value, 'gear')).toBe(6)
    expect(rc11AuxChannelValue(value, 'tyreFl')).toBe(84)
    expect(rc11AuxChannelValue(value, 'tyreFr')).toBe(86)
    // No brake-temperature sensor is fitted in the approved reference state.
    expect(rc11AuxChannelValue(value, 'brakeTempF')).toBeNull()
  })

  it('carries the packet section 16 freshness budgets verbatim', () => {
    expect(RC11_CHANNEL_STALE_MS).toEqual({
      speed: 100,
      throttle: 20,
      brake: 20,
      steering: 20,
      latG: 20,
      longG: 20,
      gear: 50,
      tyreFl: 200,
      tyreFr: 200,
      brakeTempF: 200
    })
    expect(RC11_SPEED_DASH_MS).toBe(500)
  })

  it('reproduces the approved frame deterministically', () => {
    const model = modelFor(snapshot(), 0, {
      samples: series(30, (index) => ({ speedKmh: 200 + index, deltaSec: 0.184 })),
      reference: series(30, (index) => ({ speedKmh: 198 + index })),
      cursorFraction: 0.62
    })
    expect(model.speed.value).toBe('214')
    expect(model.gear.value).toBe('6')
    expect(model.cursor.delta.value).toBe('+0.184')
    expect(model.tiles.find((entry) => entry.id === 'tyreFl')!.value.value).toBe('84')
    expect(model.tiles.find((entry) => entry.id === 'tyreFr')!.value.value).toBe('86')
    expect(model.tiles.find((entry) => entry.id === 'brakeTempF')!.value.value).toBe(RC11_DASH.brakeTemp)
    expect(model.plots.find((plot) => plot.id === 'speed')!.axis.labels).toEqual(['300', '0'])
    expect(model.plots.find((plot) => plot.id === 'delta')!.axis.labels).toEqual(['+0.5', '-0.5'])
    expect(model.plots.find((plot) => plot.id === 'delta')!.zeroRuleAt).toBe(RC11_DELTA_ZERO_PLOT_UNIT)
  })

  it('greys speed past its cadence and dashes it past the 500 ms budget', () => {
    const fresh = modelFor(snapshot(), 0)
    expect(fresh.speed.value).toBe('214')
    expect(fresh.speed.stale).toBe(false)

    const greyed = modelFor(snapshot(), 300, {}, 0)
    expect(greyed.speed.value).toBe('214')
    expect(greyed.speed.stale).toBe(true)
    expect(greyed.speed.unavailable).toBe(false)

    const dashed = modelFor(snapshot(), 900, {}, 0)
    expect(dashed.speed.value).toBe(RC11_DASH.speed)
    expect(dashed.speed.unavailable).toBe(true)
  })

  it('never estimates speed from RPM times a ratio', () => {
    const model = modelFor(snapshot({ speedKmh: undefined } as Partial<TelemetrySnapshot>))
    expect(model.speed.value).toBe(RC11_DASH.speed)
    expect(model.speed.unavailable).toBe(true)
    expect(model.speed.raw).toBeNull()
  })

  it('flatlines throttle, brake and steering when the signal is lost', () => {
    const model = modelFor(
      snapshot({ throttle: undefined, brake: undefined, steerAngleDeg: undefined } as Partial<TelemetrySnapshot>),
      0,
      { includeSteering: true, samples: series(6, () => ({ throttlePct: null, brakePct: null, steeringDeg: null })) }
    )
    const inputs = model.plots.find((plot) => plot.id === 'inputs')!
    for (const entry of inputs.series) {
      expect(entry.available).toBe(false)
      expect(entry.flatline).toBe(true)
    }
    const html = markup(
      snapshot({ throttle: undefined, brake: undefined } as Partial<TelemetrySnapshot>),
      nativeConfig
    )
    expect(html).toContain('data-testid="rc11-trace-flatline"')
  })

  it('never derives gear from RPM or speed, and dashes when the channel is absent', () => {
    expect(rc11DisplayGear(null)).toBe(RC11_DASH.gear)
    expect(rc11DisplayGear(0)).toBe('N')
    expect(rc11DisplayGear(-1)).toBe('R')
    expect(rc11DisplayGear(4)).toBe('4')
    const model = modelFor(snapshot({ gear: undefined } as Partial<TelemetrySnapshot>))
    expect(model.gear.value).toBe(RC11_DASH.gear)
    expect(model.gear.unavailable).toBe(true)
  })

  it('refuses a delta without a real reference lap and without the reference enabled', () => {
    expect(rc11FormatDelta(null)).toBe(RC11_DASH.delta)
    expect(rc11FormatDelta(0.184)).toBe('+0.184')
    expect(rc11FormatDelta(-0.184)).toBe('-0.184')

    const noBest = modelFor(snapshot({ bestLapTimeSec: undefined, deltaToBestSec: undefined } as Partial<TelemetrySnapshot>))
    expect(noBest.delta.value).toBe(RC11_DASH.delta)
    expect(noBest.delta.unavailable).toBe(true)

    // Packet 11.5: with the reference toggled off there is nothing to be a delta against.
    const referenceOff = modelFor(snapshot(), 0, { referenceEnabled: false })
    expect(referenceOff.delta.value).toBe(RC11_DASH.delta)
    expect(referenceOff.delta.unavailable).toBe(true)
    expect(referenceOff.plots.find((plot) => plot.id === 'speed')!.shading).toBe(false)
    expect(referenceOff.plots.find((plot) => plot.id === 'speed')!.series[1].available).toBe(false)
  })

  it('never mirrors one tyre corner onto another', () => {
    const model = modelFor(snapshot({ tyres: { lf: { tempC: 84 } } } as unknown as Partial<TelemetrySnapshot>))
    expect(model.tiles.find((entry) => entry.id === 'tyreFl')!.value.value).toBe('84')
    const rf = model.tiles.find((entry) => entry.id === 'tyreFr')!
    expect(rf.value.value).toBe(RC11_DASH.tyre)
    expect(rf.value.unavailable).toBe(true)
    expect(rf.value.raw).toBeNull()
  })

  it('publishes a front brake temperature only when both front corners report', () => {
    const oneCorner = modelFor(
      snapshot({ brakeTempC: { lf: 410 } } as unknown as Partial<TelemetrySnapshot>)
    )
    expect(oneCorner.tiles.find((entry) => entry.id === 'brakeTempF')!.value.value).toBe(RC11_DASH.brakeTemp)

    const bothCorners = modelFor(
      snapshot({ brakeTempC: { lf: 410, rf: 430 } } as unknown as Partial<TelemetrySnapshot>)
    )
    expect(bothCorners.tiles.find((entry) => entry.id === 'brakeTempF')!.value.value).toBe('420')
  })

  it('degrades a channel that falls silent rather than freezing it', () => {
    const buffer = new Rc11AuxBuffer()
    buffer.ingest(snapshot(), 0)
    const receipts = buffer.receipts()
    expect(receipts.get('gear')?.value).toBe(6)
    const stale = createRc11DashboardModel(snapshot(), createRc01ChannelReceipts(snapshot(), 0), receipts, 400)
    expect(stale.gear.value).toBe(RC11_DASH.gear)
    expect(stale.gear.unavailable).toBe(true)
  })

  it('publishes no mini-sector row until a sector source exists', () => {
    expect(rc11SectorRows()).toHaveLength(0)
    const model = modelFor(snapshot())
    expect(model.sectorsAvailable).toBe(false)
    expect(model.sectorRows).toHaveLength(0)
    const html = markup(snapshot(), config)
    expect(html).toContain(RC11_SECTOR_UNAVAILABLE_NOTICE)
    expect(html).toContain('data-rc11-sector-rows="0"')
    // No sector, lap or distance numeral may appear until section 16 defines the channel.
    expect(html).not.toMatch(/data-testid="rc11-sector-row"/)
  })
})

describe('RC-11 reference lap is recorded, never synthesised', () => {
  it('refuses to promote a lap it did not observe from its first frame', () => {
    const buffer = new Rc11TraceBuffer()
    // Mounted mid-lap on lap 12, then lap 13 opens: lap 12 was a fragment and cannot be promoted.
    buffer.ingest(snapshot({ currentLap: 12, timestamp: 1_000 }), 0, 0.1)
    buffer.ingest(snapshot({ currentLap: 12, timestamp: 1_020 }), 20, 0.1)
    buffer.ingest(snapshot({ currentLap: 13, timestamp: 1_040, lastLapTimeSec: 91.6, bestLapTimeSec: 91.6 }), 40, 0.1)
    expect(buffer.reference()).toHaveLength(0)
    expect(buffer.referenceBestLapSec()).toBeNull()
  })

  it('promotes a whole observed lap only when it genuinely became the stored best', () => {
    const buffer = new Rc11TraceBuffer()
    let clock = 0
    const push = (lap: number, extra: Partial<TelemetrySnapshot> = {}): void => {
      clock += 20
      buffer.ingest(snapshot({ currentLap: lap, timestamp: 1_000 + clock, ...extra }), clock, 0.1)
    }
    push(12)
    push(12)
    // Lap 13 is observed whole from here.
    push(13, { lastLapTimeSec: 93.4, bestLapTimeSec: 91.6 })
    push(13)
    push(13)
    // Lap 13 closes and it is NOT the best lap, so nothing is promoted.
    push(14, { lastLapTimeSec: 92.8, bestLapTimeSec: 91.6 })
    expect(buffer.reference()).toHaveLength(0)
    push(14)
    push(14)
    // Lap 14 closes AND becomes the stored best, so it is promoted.
    push(15, { lastLapTimeSec: 90.9, bestLapTimeSec: 90.9 })
    expect(buffer.reference().length).toBeGreaterThanOrEqual(2)
    expect(buffer.referenceBestLapSec()).toBe(90.9)
  })

  it('never records a reference at all when the sim publishes no lap counter', () => {
    const buffer = new Rc11TraceBuffer()
    for (let index = 0; index < 6; index += 1) {
      buffer.ingest(
        snapshot({ currentLap: undefined, timestamp: 1_000 + index * 20 } as Partial<TelemetrySnapshot>),
        index * 20,
        0.1
      )
    }
    expect(buffer.reference()).toHaveLength(0)
    expect(buffer.history()).toHaveLength(6)
  })

  it('drops the recorded reference when the source is refused', () => {
    const buffer = new Rc11TraceBuffer()
    buffer.ingest(snapshot(), 0, 0.1)
    expect(buffer.history()).toHaveLength(1)
    buffer.reset()
    expect(buffer.history()).toHaveLength(0)
    expect(buffer.reference()).toHaveLength(0)
  })
})

describe('RC-11 trigger-only alerts', () => {
  it('starts silent on every alert', () => {
    const state = createRc11AlertState()
    expect(state.lockUp.markers).toHaveLength(0)
    expect(state.liftCoast.markers).toHaveLength(0)
    expect(state.dataGap.bands).toHaveLength(0)
    expect(rc11AlertMarkers(state)).toHaveLength(0)
  })

  it('keeps the lock-up flag permanently silent because its channel does not exist', () => {
    const samples = series(12, () => ({ brakePct: 90, speedKmh: 60 }))
    const advanced = advanceRc11Alerts(createRc11AlertState(), alertInput({ samples, reference: samples }))
    expect(advanced.lockUp.markers).toHaveLength(0)
    expect(RC11_ALERT_LABELS.lockUp).toBe('LOCK UP')
  })

  it('engages the lift/coast flag only after its debounce run', () => {
    const reference = series(12, () => ({ throttlePct: 100 }))
    const shortDip = series(12, (index) => ({
      throttlePct: index >= 4 && index <= 5 ? 100 - RC11_LIFT_COAST_ENTER_PCT - 5 : 100,
      brakePct: 0
    }))
    expect(rc11LiftCoastMarkers(alertInput({ samples: shortDip, reference }))).toHaveLength(0)

    const longDip = series(12, (index) => ({
      throttlePct: index >= 4 && index <= 8 ? 100 - RC11_LIFT_COAST_ENTER_PCT - 5 : 100,
      brakePct: 0
    }))
    const markers = rc11LiftCoastMarkers(alertInput({ samples: longDip, reference }))
    expect(markers).toHaveLength(1)
    expect(markers[0].alert).toBe('liftCoast')
    expect(markers[0].channel).toBe('throttle')
    expect(markers[0].glyph).toBe('chevron')
    expect(markers[0].label).toBe(RC11_ALERT_LABELS.liftCoast)
    expect(RC11_LIFT_COAST_MIN_SAMPLES).toBe(3)
  })

  it('holds a lift/coast run through its hysteresis band and releases below it', () => {
    const reference = series(14, () => ({ throttlePct: 100 }))
    // Enters at a 17 pp dip, then hovers at a 9 pp dip — above the 6 pp exit — so the run HOLDS.
    const held = series(14, (index) => ({
      throttlePct: index < 3 ? 100 : index < 10 ? 100 - (index === 3 ? 17 : 9) : 100,
      brakePct: 0
    }))
    expect(rc11LiftCoastMarkers(alertInput({ samples: held, reference }))).toHaveLength(1)

    // The same entry followed immediately by a full recovery releases before the debounce.
    const released = series(14, (index) => ({
      throttlePct: index === 3 ? 100 - 17 : 100,
      brakePct: 0
    }))
    expect(rc11LiftCoastMarkers(alertInput({ samples: released, reference }))).toHaveLength(0)
    expect(RC11_LIFT_COAST_EXIT_PCT).toBeLessThan(RC11_LIFT_COAST_ENTER_PCT)
  })

  it('never flags a lift inside a braking zone', () => {
    const reference = series(12, () => ({ throttlePct: 100 }))
    const braking = series(12, (index) => ({
      throttlePct: index >= 3 ? 0 : 100,
      brakePct: index >= 3 ? RC11_LIFT_COAST_MAX_BRAKE_PCT + 40 : 0
    }))
    expect(rc11LiftCoastMarkers(alertInput({ samples: braking, reference }))).toHaveLength(0)
  })

  it('raises no lift/coast marker at all when the throttle channel is missing', () => {
    const reference = series(12, () => ({ throttlePct: 100 }))
    const samples = series(12, () => ({ throttlePct: null }))
    expect(rc11LiftCoastMarkers(alertInput({ samples, reference, throttleAvailable: false }))).toHaveLength(0)
    expect(rc11LiftCoastMarkers(alertInput({ samples, reference }))).toHaveLength(0)
  })

  it('raises no lift/coast marker without a genuine reference lap', () => {
    const samples = series(12, (index) => ({ throttlePct: index >= 4 && index <= 9 ? 40 : 100, brakePct: 0 }))
    expect(rc11LiftCoastMarkers(alertInput({ samples, reference: [] }))).toHaveLength(0)
  })

  it('clears a marker when the engineer dismisses it, and never resurrects it', () => {
    const reference = series(12, () => ({ throttlePct: 100 }))
    const samples = series(12, (index) => ({ throttlePct: index >= 4 && index <= 9 ? 60 : 100, brakePct: 0 }))
    const input = alertInput({ samples, reference })
    const engaged = advanceRc11Alerts(createRc11AlertState(), input)
    expect(engaged.liftCoast.markers).toHaveLength(1)

    const dismissedState = dismissRc11Marker(engaged, engaged.liftCoast.markers[0].id)
    expect(dismissedState.liftCoast.markers).toHaveLength(0)
    // The same trigger is still present in the data, and it must stay dismissed.
    const readvanced = advanceRc11Alerts(dismissedState, input)
    expect(readvanced.liftCoast.markers).toHaveLength(0)
    expect(readvanced.dismissed).toContain(engaged.liftCoast.markers[0].id)
  })

  it('unlatches every marker whose channel goes stale or missing', () => {
    const reference = series(12, () => ({ throttlePct: 100 }))
    const samples = series(12, (index) => ({ throttlePct: index >= 4 && index <= 9 ? 60 : 100, brakePct: 0 }))
    const engaged = advanceRc11Alerts(createRc11AlertState(), alertInput({ samples, reference }))
    expect(engaged.liftCoast.markers).toHaveLength(1)

    const model = modelFor(snapshot({ throttle: undefined } as Partial<TelemetrySnapshot>))
    expect(model.throttle.unavailable).toBe(true)
    expect(clearInvalidRc11Alerts(engaged, model).liftCoast.markers).toHaveLength(0)
  })

  it('bands a data gap, clears it when valid data resumes, and never interpolates', () => {
    const dropped = series(10, (index) => ({ speedKmh: index >= 4 && index <= 6 ? null : 180 }))
    const engaged = advanceRc11Alerts(createRc11AlertState(), alertInput({ samples: dropped }))
    expect(engaged.dataGap.bands.length).toBeGreaterThan(0)

    const resumed = advanceRc11Alerts(engaged, alertInput({ samples: series(10, () => ({ speedKmh: 180 })) }))
    expect(resumed.dataGap.bands).toHaveLength(0)

    const model = modelFor(snapshot(), 0, { samples: dropped, alerts: engaged })
    expect(model.alerts.dataGap).toBe(true)
    const speedPlot = model.plots.find((plot) => plot.id === 'speed')!
    expect(speedPlot.gaps.length).toBeGreaterThan(0)
    expect(speedPlot.series[0].segments.length).toBeGreaterThan(1)
  })

  it('binds the alert inputs to fresh channels only', () => {
    const samples = series(6, () => ({}))
    const stale = modelFor(snapshot(), 400, { samples }, 0)
    const input = rc11AlertInputForModel(stale, 400, samples, samples)
    expect(input.throttleAvailable).toBe(false)
    expect(input.brakeAvailable).toBe(false)
    expect(input.wheelSpeedAvailable).toBe(false)
  })

  it('gives every alert a visible surface at every breakpoint', () => {
    const reference = series(12, () => ({ throttlePct: 100 }))
    const samples = series(12, (index) => ({
      throttlePct: index >= 4 && index <= 9 ? 60 : 100,
      brakePct: 0,
      speedKmh: index === 2 ? null : 180
    }))
    const alerts = advanceRc11Alerts(createRc11AlertState(), alertInput({ samples, reference }))
    for (const box of BREAKPOINTS) {
      const layout = rc11LayoutForContentBox(box.width, box.height)
      const zones = rc11ZonesForLayout(layout, rc11CompactModeForContentBox(box.width, box.height), box)
      // The lift/coast marker rides the inputs plot and the DATA GAP band rides the speed plot;
      // both zones exist in every grammar, so no alert loses its surface at any size.
      expect(zones.inputs).toBeDefined()
      expect(zones.speed).toBeDefined()
      const model = createRc11DashboardModel(snapshot(), new Map(), new Map(), 0, { samples, reference, alerts })
      expect(model.markers.length + model.gapBands.length).toBeGreaterThan(0)
    }
  })
})

describe('RC-11 layout resolution', () => {
  it('resolves the packet breakpoints', () => {
    expect(rc11LayoutForContentBox(800, 480)).toBe('native')
    expect(rc11LayoutForContentBox(801, 479)).toBe('native')
    expect(rc11LayoutForContentBox(1_024, 600)).toBe('app')
    expect(rc11LayoutForContentBox(1_920, 1_080)).toBe('app')
    expect(rc11LayoutForContentBox(640, 520)).toBe('compact')
    expect(rc11LayoutForContentBox(0, 0)).toBe('app')
  })

  it('resolves the compact modes', () => {
    expect(rc11CompactModeForContentBox(400, 800)).toBe('phone')
    expect(rc11CompactModeForContentBox(900, 400)).toBe('landscape')
    expect(rc11CompactModeForContentBox(640, 520)).toBe('standard')
    expect(rc11CompactModeForContentBox(800, 480)).toBe('standard')
    expect(rc11PhoneGeometryForContentBox(400, 800)).not.toBeNull()
    expect(rc11PhoneGeometryForContentBox(800, 480)).toBeNull()
  })

  it('expands rather than scales at 1024x600', () => {
    const native = rc11ZonesForLayout('native')
    const app = rc11ZonesForLayout('app')
    // A naive uniform scale would keep every zone's percentage identical. It does not.
    expect(app.speed!.width).not.toBeCloseTo(native.speed!.width, 3)
    expect(Object.keys(app).length).toBe(Object.keys(native).length + 1)
    expect(app.sectors).toBeDefined()
    expect(native.sectors).toBeUndefined()
  })
})

describe('RC-11 rendered DOM contract', () => {
  it('renders the widget marker, the layout attributes and every packet zone', () => {
    const html = markup(snapshot(), nativeConfig)
    assertClean(html)
    expect(html).toContain('data-widget="raceconRc11Dash"')
    expect(html).toContain('data-rc11-layout="native"')
    expect(html).toContain('data-rc11-native-size="800x480"')
    expect(html).toContain('data-rc11-buffer-state="accepted"')
    for (const zone of ['speed', 'inputs', 'gear', 'delta', 'gg', 'tiles']) {
      expect(html).toContain(`data-rc11-zone="${zone}"`)
    }
    expect(html).toContain('data-testid="rc11-distance-axis"')
    expect(html).toContain('data-testid="rc11-cursor"')
    expect(html).toContain('data-testid="rc11-reference-toggle"')
  })

  it('renders no driver-DDU hero and no LED arc anywhere', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).not.toContain('rc11-gear-hero')
    expect(html).not.toContain('rc11-shift')
    expect(html).not.toContain('data-testid="rc11-led"')
    expect(CSS_DECLARATIONS).not.toContain('rc11-shift')
    expect(CSS_DECLARATIONS).not.toContain('rc11-gear-hero')
  })

  it('renders exactly one panel per zone, with the legend held inside it', () => {
    const html = markup(snapshot(), nativeConfig)
    const panels = [...html.matchAll(/data-rc11-panel="/g)]
    expect(panels).toHaveLength(6)
    expect(html).toContain('data-testid="rc11-legend-speed"')
    expect(html).toContain('data-testid="rc11-legend-inputs"')
    expect(CSS_DECLARATIONS).not.toContain('rc11-legend-divider')
  })

  it('renders the distance axis with five dashed ticks and no distance numeral', () => {
    const html = markup(snapshot(), nativeConfig)
    const ticks = [...html.matchAll(/data-testid="rc11-distance-tick"/g)]
    expect(ticks).toHaveLength(RC11_DISTANCE_TICK_COUNT)
    expect(html).toContain('DISTANCE')
    expect(html).not.toMatch(/DISTANCE[\s\S]{0,400}?\d{3,}\s*m/i)
  })

  it('renders a dash-only frame with no telemetry at all', () => {
    const html = markup(null, nativeConfig)
    assertClean(html)
    expect(html).toContain(RC11_DASH.speed)
    expect(html).toContain(RC11_DASH.delta)
    expect(html).toContain(RC11_DASH.tyre)
    expect(html).toContain('data-rc11-alerts="silent"')
    expect(html).not.toContain('data-testid="rc11-marker"')
  })

  it('refuses mock and replay telemetry and raises no alert from it', () => {
    const mock = markup(snapshot({ sim: 'mock' } as Partial<TelemetrySnapshot>), nativeConfig)
    expect(mock).toContain('data-rc11-buffer-state="mock-telemetry"')
    expect(mock).toContain(RC11_DASH.delta)
    expect(mock).toContain('data-rc11-alerts="silent"')
    expect(mock).toContain('data-rc11-samples="0"')

    const replay = markup(
      snapshot({ replayContext: { state: 'replay' } } as Partial<TelemetrySnapshot>),
      nativeConfig
    )
    expect(replay).toContain('data-rc11-buffer-state="replay-telemetry"')
    expect(replay).toContain(RC11_DASH.delta)
    expect(replay).toContain('data-rc11-alerts="silent"')
    expect(replay).toContain('data-rc11-samples="0"')
  })

  it('exposes the compact mode attribute only in the compact layout', () => {
    const compact = markup(snapshot(), { ...config, position: { x: 0, y: 0, width: 640, height: 520 } })
    expect(compact).toContain('data-rc11-layout="compact"')
    expect(compact).toContain('data-rc11-compact-mode="standard"')
    expect(markup(snapshot(), nativeConfig)).not.toContain('data-rc11-compact-mode')
  })

  it('renders cleanly at every breakpoint', () => {
    for (const box of BREAKPOINTS) {
      const html = markup(snapshot(), { ...config, position: { x: 0, y: 0, ...box } })
      assertClean(html)
      expect(html).toContain('data-widget="raceconRc11Dash"')
    }
  })

  it('describes the cursor, the traces and the tiles in words, never by hue', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('Cursor at')
    expect(html).toContain('solid line')
    expect(html).toContain('dashed line')
    expect(html).toContain('degrees Celsius')
    expect(html).toContain('no sensor')
  })

  it('keeps a pattern fingerprint that separates the two laps without any colour', () => {
    const withReference = modelFor(snapshot(), 0, {
      samples: series(10, () => ({})),
      reference: series(10, () => ({}))
    })
    const withoutReference = modelFor(snapshot(), 0, { samples: series(10, () => ({})) })
    expect(rc11PatternFingerprint(withReference)).not.toBe(rc11PatternFingerprint(withoutReference))
    expect(rc11PatternFingerprint(withReference)).toContain('speedCurrent:solid')
    expect(rc11PatternFingerprint(withReference)).toContain('speedReference:dashed')
  })
})

describe('RC-11 shares the RC-01 fail-closed ingest buffer', () => {
  it('accepts a live identified snapshot and rejects an unidentified one', () => {
    const buffer = new Rc01LiveTelemetryBuffer()
    expect(buffer.ingest(snapshot(), 0).accepted).toBe(true)
    const orphan = new Rc01LiveTelemetryBuffer()
    expect(orphan.ingest(snapshot({ sessionUniqueId: undefined } as Partial<TelemetrySnapshot>), 0).accepted).toBe(false)
  })

  it('does not fork the buffer, the receipts or the delta channel', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/overlay/widgets/raceconRc11Core.ts'),
      'utf8'
    )
    expect(source).toContain("from './raceconRc01Core'")
    expect(source).toContain('createRc01DashboardModel')
    expect(source).not.toContain('class Rc11LiveTelemetryBuffer')
  })
})
