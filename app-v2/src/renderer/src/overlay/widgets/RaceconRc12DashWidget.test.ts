// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOverlayStyle, type OverlayWidgetConfig } from '../../../../shared/overlays'
import type { DriverEntry, TelemetrySnapshot } from '../../../../shared/telemetry'
import { OVERLAY_DASHBOARD_PRESETS } from '../../../../shared/dashboards'
import { PREVIEW_SNAPSHOT } from '../../dashboard/widgets/gt3-theme'
import type { WidgetProps } from './types'
import { RACECON_DISPLAY_CLOCK_INTERVAL_MS, raceconDisplayClockFrozen } from './raceconDisplayClock'
import { WIDGET_COMPONENTS } from './index'
import { RaceconRc12DashWidget } from './RaceconRc12DashWidget'
import { Rc01LiveTelemetryBuffer } from './raceconRc01Core'
import {
  RC12_APP_HEIGHT_PX,
  RC12_APP_ONLY_MODULES,
  RC12_APP_ROW_COUNT,
  RC12_APP_TYPE_SCALE,
  RC12_APP_WIDTH_PX,
  RC12_APP_ZONES_PX,
  RC12_CELL_PADDING_CQW,
  RC12_CHANNEL_STALE_MS,
  RC12_DASH,
  RC12_EVENT_CHANNELS,
  RC12_FASTEST_LAP_HOLD_MS,
  RC12_FASTEST_LAP_LABEL,
  RC12_GAP_UNIT,
  RC12_LANDSCAPE_ROW_COUNT,
  RC12_LEAD_CHANGE_HOLD_MS,
  RC12_LONGEST_CELL_TEXT,
  RC12_NATIVE_HEIGHT_PX,
  RC12_NATIVE_ROW_COLUMN_X1_PX,
  RC12_NATIVE_ROW_COUNT,
  RC12_NATIVE_WIDTH_PX,
  RC12_NATIVE_ZONES_PX,
  RC12_NORMATIVE_OVERRIDES,
  RC12_NO_BATTLE_LABEL,
  RC12_NO_TIMING_LABEL,
  RC12_PACKET_OMISSIONS,
  RC12_PACKET_SAFE_FRAME_PX,
  RC12_PACKET_TOKENS,
  RC12_PACKET_TYPE_SCALE_PX,
  RC12_PHONE_ROW_COUNT,
  RC12_POSITION_CHANGE_HOLD_MS,
  RC12_ROW_COLUMNS,
  RC12_ROW_PADDING_CQW,
  RC12_SAFE_FRAME_PX,
  RC12_SILENT_TOKENS,
  RC12_TAG_GUTTER_PX,
  RC12_TIMING_DELAY_LABEL,
  RC12_TIMING_STALE_MS,
  RC12_TOKENS,
  RC12_TREND_TOKENS,
  RC12_TYPE_CLAMP_PX,
  RC12_TYPE_SCALE_FACTOR,
  RC12_TYPE_SCALE_PX,
  type Rc12Layout,
  type Rc12Rect,
  type Rc12RowColumnId,
  type Rc12TypeRung,
  type Rc12ZoneMap,
  Rc12TimingBuffer,
  advanceRc12Alerts,
  clearInvalidRc12Alerts,
  createRc12AlertState,
  createRc12DashboardModel,
  rc12AlertInputForFrame,
  rc12CompactModeForContentBox,
  rc12FeaturedPair,
  rc12FormatGapSeconds,
  rc12FormatLapTime,
  rc12FormatPosition,
  rc12GlyphAdvancePx,
  rc12LayoutForContentBox,
  rc12MeasuredGapAheadByCar,
  rc12PhoneGeometryForContentBox,
  rc12RectPercent,
  rc12RectsOverlap,
  rc12RowColumnInsetCqw,
  rc12RowColumnWidthPx,
  rc12RowContentWidthPx,
  rc12RowCountForLayout,
  rc12RowDescription,
  rc12RowPitchPx,
  rc12SilentObservation,
  rc12TimingEntries,
  rc12TrendForHistory,
  rc12TypeScaleCqw,
  rc12TypeScalePxForWidth,
  rc12TypeSizePxForCanvas,
  rc12ZoneStyle,
  rc12ZonesForLayout,
  rc12ZonesPxForLayout
} from './raceconRc12Core'

const config: OverlayWidgetConfig = {
  id: 'raceconRc12Dash',
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
 * The stylesheet is read as TEXT, not as a loaded module, because RC-12's colour guarantees are
 * properties of the source itself: `signature`, `info`, `caution` and `danger` may only be
 * referenced inside an alert-scoped rule. Vitest's root is `app-v2`.
 */
const CSS_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/overlay/widgets/raceconRc12.css'),
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

/** The only selectors an alert-layer token may be bound inside. */
const ALERT_SCOPED = /is-fastest|is-lead|rc12-tag|rc12-lead-tag|rc12-delay|data-rc12-change='loss'/

/**
 * The approved RC-12 reference state (attempt-004 governed 800x480,
 * `input/telemetry-frame-featured-battle-p4-p5.json`): a live race with a healthy timing feed, an
 * eight-car board, the observer's car running P5 exactly 0.8 s behind P4 and closing, and P5 having
 * just crossed the line with the session-fastest lap of 1:31.947.
 */
const REFERENCE_LAPS = [92.884, 92.61, 93.055, 92.74, 91.947, 93.48, 93.026, 92.998]

function driver(position: number, overrides: Partial<DriverEntry> = {}): DriverEntry {
  return {
    carIdx: position,
    name: `Entrant ${position}`,
    carNumber: String(position),
    position,
    classPosition: position,
    classId: 1,
    isPlayer: position === 5,
    lastLapTimeSec: REFERENCE_LAPS[position - 1],
    bestLapTimeSec: REFERENCE_LAPS[position - 1] - 0.4,
    ...overrides
  }
}

function board(count = 8, overrides: Record<number, Partial<DriverEntry>> = {}): DriverEntry[] {
  return Array.from({ length: count }, (_unused, index) => driver(index + 1, overrides[index + 1] ?? {}))
}

function snapshot(overrides: Partial<TelemetrySnapshot> = {}, timestamp = 1_411_000): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp,
    sessionUniqueId: 41,
    speedKmh: 214,
    rpm: 7_150,
    gear: 6,
    throttle: 1,
    brake: 0,
    clutch: 0,
    sessionType: 'Race',
    sessionState: 'racing',
    playerCarIdx: 5,
    position: 5,
    drivers: board(),
    relatives: {
      ahead: { carIdx: 4, name: 'Entrant 4', carNumber: '4', position: 4, gapSec: 0.8, lastLapTimeSec: 92.74 },
      behind: { carIdx: 6, name: 'Entrant 6', carNumber: '6', position: 6, gapSec: -3.5, lastLapTimeSec: 93.48 }
    },
    ...overrides
  } as TelemetrySnapshot
}

function markup(value: TelemetrySnapshot | null, cfg = config): string {
  return renderToStaticMarkup(createElement(RaceconRc12DashWidget, { snapshot: value, config: cfg }))
}

function assertClean(value: string): void {
  expect(value).not.toContain('\uFFFD')
  expect(value).not.toContain('NaN')
  expect(value).not.toContain('undefined')
  expect(value).not.toContain('[object Object]')
}

/** One committed frame through the timing buffer, exactly as the widget drives it. */
function ingest(buffer: Rc12TimingBuffer, value: TelemetrySnapshot, receivedAt: number): ReturnType<Rc12TimingBuffer['ingest']> {
  return buffer.ingest(value, receivedAt)
}

function modelFor(
  value: TelemetrySnapshot | null,
  options: Parameters<typeof createRc12DashboardModel>[3] = {},
  nowMs = 0,
  buffer: Rc12TimingBuffer | null = null
): ReturnType<typeof createRc12DashboardModel> {
  return createRc12DashboardModel(value, buffer, nowMs, options)
}

function right(rect: Rc12Rect): number {
  return rect.left + rect.width
}

function bottom(rect: Rc12Rect): number {
  return rect.top + rect.height
}

function allZones(zones: Rc12ZoneMap): Rc12Rect[] {
  return Object.values(zones).filter((rect): rect is Rc12Rect => Boolean(rect))
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

describe('RC-12 registration and preset wiring', () => {
  it('registers the widget component under its canonical id', () => {
    expect(WIDGET_COMPONENTS.raceconRc12Dash).toBe(RaceconRc12DashWidget)
  })

  it('declares exactly one RC-12 full-frame preset directly after RC-11', () => {
    const ids = OVERLAY_DASHBOARD_PRESETS.map((entry) => entry.id)
    expect(ids.filter((id) => id === 'racecon_rc12_dash')).toHaveLength(1)
    expect(ids.indexOf('racecon_rc12_dash')).toBe(ids.indexOf('racecon_rc11_dash') + 1)
    const preset = OVERLAY_DASHBOARD_PRESETS.find((entry) => entry.id === 'racecon_rc12_dash')
    expect(preset?.widgetId).toBe('raceconRc12Dash')
    expect(preset?.name).toBe('RaceCon RC-12 On Air')
    expect(preset?.scaleMode).toBe('stretch')
    expect(preset?.tags).toContain('broadcast')
    expect(preset?.tags).toContain('timing')
    expect(preset?.tags).toContain('leaderboard')
  })
})

describe('RC-12 packet omissions are contractual, not accidental', () => {
  it('records every contradiction resolved by omission', () => {
    expect(Object.keys(RC12_PACKET_OMISSIONS).sort()).toEqual([
      'entrantIdentityChannel',
      'fieldWideIntervalChannel',
      'pitLimiterChannel',
      'sectorAndRollingSplit',
      'sessionClockChannel',
      'tyreAgeAndPitStatus'
    ])
    for (const reason of Object.values(RC12_PACKET_OMISSIONS)) {
      expect(reason.length).toBeGreaterThan(40)
    }
  })

  it('records every packet deviation shipped as a normative override', () => {
    expect(Object.keys(RC12_NORMATIVE_OVERRIDES).sort()).toEqual([
      'closestChromaticPair',
      'fastestLapTagOverlap',
      'gapOverPositionRatio',
      'gapUnit',
      'lastLapInk',
      'panelAltToken',
      'panelFill',
      'sessionClockTitleSafe',
      'typeScale',
      'zoneCoordinates'
    ])
  })

  it('dashes the session clock even when the snapshot carries a session time and a lap count', () => {
    // The snapshot genuinely has these values. Packet 16 has no row for either, so they are not
    // channels this artifact may print, and the ribbon must not quietly start reading them.
    const rich = snapshot({ sessionTimeRemainingSec: 1_820, lapsRemaining: 24, currentLap: 12, completedLaps: 11 })
    const model = modelFor(rich)
    expect(model.sessionClock.time.value).toBe(RC12_DASH.sessionTime)
    expect(model.sessionClock.lapsDone.value).toBe(RC12_DASH.lapCounter)
    expect(model.sessionClock.lapsTotal.value).toBe(RC12_DASH.lapCounter)
    expect(model.sessionClock.time.unavailable).toBe(true)

    const html = markup(rich, nativeConfig)
    expect(html).not.toContain('1820')
    expect(html).not.toContain('>24<')
    expect(html).not.toContain('30:20')
  })

  it('never prints an entrant identity in any badge, on any row or on the battle strip', () => {
    const model = modelFor(snapshot(), { rowCount: 8 })
    for (const row of model.rows) {
      expect(row.badge.value).toBe(RC12_DASH.badge)
      expect(row.badge.unavailable).toBe(true)
    }
    expect(model.battle.lead.badge.value).toBe(RC12_DASH.badge)
    expect(model.battle.trail.badge.value).toBe(RC12_DASH.badge)

    const html = markup(snapshot(), nativeConfig)
    expect(html).not.toContain('Entrant')
    // The badge placeholder is the ONLY 'CAR' string, and it carries no number.
    expect(html).not.toMatch(/CAR\s*(?!--)\d/)
  })

  it('never differences the wrapped on-track relative into a running-order interval', () => {
    // Eight cars all publish gapToPlayerSec. Differencing them would produce seven gaps; the
    // measured channel produces exactly two, so the difference is provably not being taken.
    const withRelatives = snapshot({
      drivers: board(8, Object.fromEntries(board().map((entry) => [entry.position, { gapToPlayerSec: entry.position - 5 }])))
    })
    const entries = rc12TimingEntries(withRelatives)
    const measured = rc12MeasuredGapAheadByCar(withRelatives, entries)
    expect(measured.size).toBe(2)
    expect([...measured.keys()].sort((a, b) => a - b)).toEqual([5, 6])
  })

  it('draws no sector split, rolling split, tyre age, pit status or pit limiter anywhere', () => {
    for (const cfg of [nativeConfig, config]) {
      const html = markup(
        snapshot({ pitLimiter: true, onPitRoad: true, tyres: { lf: { tempC: 84 }, rf: { tempC: 86 }, lr: { tempC: 81 }, rr: { tempC: 83 } } }),
        cfg
      )
      expect(html).not.toMatch(/SECTOR/i)
      expect(html).not.toMatch(/SPLIT/i)
      expect(html).not.toMatch(/LIMITER/i)
      expect(html).not.toMatch(/TYRE|TIRE/i)
      expect(html).not.toMatch(/\bPIT\b/i)
      expect(html).not.toMatch(/STINT|AGE/i)
    }
  })

  it('names the two app-only modules and keeps them out of the 800x480 grammar', () => {
    expect([...RC12_APP_ONLY_MODULES]).toEqual(['battleHistory', 'driverTags'])
    expect(RC12_NATIVE_ZONES_PX.battleHistory).toBeUndefined()
    expect(RC12_APP_ZONES_PX.battleHistory).toBeDefined()

    const native = markup(snapshot(), nativeConfig)
    expect(native).not.toContain('rc12-history')
    expect(native).not.toContain('rc12-driver-tag')

    const app = markup(snapshot(), config)
    expect(app).toContain('rc12-history')
    expect(app).toContain('rc12-driver-tag')
  })
})

describe('RC-12 packet zone geometry', () => {
  it('reproduces packet 11.1 verbatim rather than tracing the render', () => {
    expect(RC12_NATIVE_ZONES_PX).toEqual({
      sessionClock: { x: 40, y: 10, width: 720, height: 18 },
      leaderboard: { x: 40, y: 30, width: 720, height: 240 },
      battleStrip: { x: 40, y: 290, width: 720, height: 120 },
      fastestLapTag: { x: 560, y: 30, width: 200, height: 40 }
    })
  })

  it('reproduces packet 12.1 verbatim, including the app-only gap-history box', () => {
    expect(RC12_APP_ZONES_PX).toEqual({
      sessionClock: { x: 48, y: 10, width: 928, height: 18 },
      leaderboard: { x: 48, y: 32, width: 640, height: 520 },
      battleStrip: { x: 704, y: 32, width: 272, height: 300 },
      battleHistory: { x: 704, y: 344, width: 272, height: 150 },
      fastestLapTag: { x: 704, y: 502, width: 272, height: 40 }
    })
  })

  it('publishes the packet 11.1 origin and size percentages the packet tabulates', () => {
    const zones = rc12ZonesForLayout('native')
    expect(zones.leaderboard).toEqual({ left: 5, top: 6.25, width: 90, height: 50 })
    expect(zones.battleStrip).toEqual({ left: 5, top: 60.416667, width: 90, height: 25 })
    expect(zones.fastestLapTag).toEqual({ left: 70, top: 6.25, width: 25, height: 8.333333 })
    expect(zones.sessionClock).toEqual({ left: 5, top: 2.083333, width: 90, height: 3.75 })
  })

  it('publishes the packet 12.1 percentages', () => {
    const zones = rc12ZonesForLayout('app')
    expect(zones.leaderboard).toEqual({ left: 4.6875, top: 5.333333, width: 62.5, height: 86.666667 })
    expect(zones.battleStrip).toEqual({ left: 68.75, top: 5.333333, width: 26.5625, height: 50 })
    expect(zones.battleHistory).toEqual({ left: 68.75, top: 57.333333, width: 26.5625, height: 25 })
    expect(zones.fastestLapTag).toEqual({ left: 68.75, top: 83.666667, width: 26.5625, height: 6.666667 })
  })

  it('keeps every zone inside the canvas at every breakpoint', () => {
    for (const breakpoint of BREAKPOINTS) {
      const layout = rc12LayoutForContentBox(breakpoint.width, breakpoint.height)
      const compact = rc12CompactModeForContentBox(breakpoint.width, breakpoint.height)
      for (const rect of allZones(rc12ZonesForLayout(layout, compact, breakpoint))) {
        expect(rect.left).toBeGreaterThanOrEqual(0)
        expect(rect.top).toBeGreaterThanOrEqual(0)
        expect(right(rect)).toBeLessThanOrEqual(100.001)
        expect(bottom(rect)).toBeLessThanOrEqual(100.001)
      }
    }
  })

  it('neutralises the packet 11.1 tag/band overlap by stopping the row columns short of the tag', () => {
    const zones = rc12ZonesForLayout('native')
    // The packet's own boxes DO overlap: 200 x 40 = 8,000 px of tag directly over row one.
    expect(rc12RectsOverlap(zones.fastestLapTag!, zones.leaderboard!)).toBe(true)

    // Normative override `fastestLapTagOverlap`: the row COLUMNS end before the tag begins.
    expect(RC12_NATIVE_ROW_COLUMN_X1_PX).toBe(548)
    expect(RC12_NATIVE_ROW_COLUMN_X1_PX).toBeLessThan(RC12_NATIVE_ZONES_PX.fastestLapTag!.x)
    expect(RC12_TAG_GUTTER_PX).toBe(12)
    // 720 band - 548 stop + 40 origin = 212 px of reserved right shoulder, 26.5 % of the canvas.
    expect(rc12RowColumnInsetCqw('native')).toBe(26.5)
    expect(rc12RowColumnInsetCqw('app')).toBe(0)
  })

  it('places the app fastest-lap tag outside the band, so no inset is needed there', () => {
    const zones = rc12ZonesForLayout('app')
    expect(rc12RectsOverlap(zones.fastestLapTag!, zones.leaderboard!)).toBe(false)
    expect(rc12RectsOverlap(zones.battleHistory!, zones.battleStrip!)).toBe(false)
    expect(rc12RectsOverlap(zones.battleHistory!, zones.fastestLapTag!)).toBe(false)
  })

  it('keeps the session ribbon inside the redefined title-safe frame', () => {
    const ribbon = RC12_NATIVE_ZONES_PX.sessionClock!
    // The packet's own frame excludes 10 px of the ribbon: 55.6 % of its height.
    expect(RC12_PACKET_SAFE_FRAME_PX.y).toBe(20)
    expect(RC12_PACKET_SAFE_FRAME_PX.y - ribbon.y).toBe(10)
    expect(Math.round(((RC12_PACKET_SAFE_FRAME_PX.y - ribbon.y) / ribbon.height) * 1_000) / 10).toBe(55.6)

    // Normative override `sessionClockTitleSafe`: the frame top is redefined and every other packet
    // coordinate is untouched, so the 8 x 30 px row pitch survives.
    expect(RC12_SAFE_FRAME_PX).toEqual({ x: 24, y: 8, width: 752, height: 412 })
    for (const zone of Object.values(RC12_NATIVE_ZONES_PX)) {
      expect(zone!.y).toBeGreaterThanOrEqual(RC12_SAFE_FRAME_PX.y)
      expect(zone!.y + zone!.height).toBeLessThanOrEqual(RC12_SAFE_FRAME_PX.y + RC12_SAFE_FRAME_PX.height)
      expect(zone!.x).toBeGreaterThanOrEqual(RC12_SAFE_FRAME_PX.x)
      expect(zone!.x + zone!.width).toBeLessThanOrEqual(RC12_SAFE_FRAME_PX.x + RC12_SAFE_FRAME_PX.width)
    }
  })

  it('emits zone geometry as inline percentages without binary-float noise', () => {
    const style = rc12ZoneStyle(rc12RectPercent(RC12_NATIVE_ZONES_PX.battleStrip!, RC12_NATIVE_WIDTH_PX, RC12_NATIVE_HEIGHT_PX))
    expect(style).toEqual({ left: '5%', top: '60.417%', width: '90%', height: '25%' })
    expect(rc12ZoneStyle(undefined)).toBeNull()
    expect(markup(snapshot(), nativeConfig)).not.toMatch(/\d\.\d{6,}%/)
  })
})

describe('RC-12 row grammar and the positional axis', () => {
  it('gives the packet 11.1 band exactly eight rows on a 30 px pitch', () => {
    expect(RC12_NATIVE_ROW_COUNT).toBe(8)
    expect(rc12RowPitchPx('native')).toBe(30)
    expect(rc12RowPitchPx('native') * RC12_NATIVE_ROW_COUNT).toBe(RC12_NATIVE_ZONES_PX.leaderboard!.height)
  })

  it('reveals a fuller field at 1024x600 rather than scaling the same eight rows', () => {
    expect(RC12_APP_ROW_COUNT).toBe(16)
    expect(RC12_APP_ROW_COUNT).toBeGreaterThan(RC12_NATIVE_ROW_COUNT)
    expect(rc12RowPitchPx('app')).toBe(32.5)
    expect(rc12RowPitchPx('app') * RC12_APP_ROW_COUNT).toBe(RC12_APP_ZONES_PX.leaderboard!.height)
  })

  it('resolves a row count for every breakpoint and never collapses the axis', () => {
    expect(rc12RowCountForLayout('native')).toBe(RC12_NATIVE_ROW_COUNT)
    expect(rc12RowCountForLayout('app')).toBe(RC12_APP_ROW_COUNT)
    expect(rc12RowCountForLayout('compact', 'phone')).toBe(RC12_PHONE_ROW_COUNT)
    expect(rc12RowCountForLayout('compact', 'landscape')).toBe(RC12_LANDSCAPE_ROW_COUNT)
    expect(rc12RowCountForLayout('compact', 'standard')).toBe(RC12_NATIVE_ROW_COUNT)
    for (const layout of ['native', 'app', 'compact'] as Rc12Layout[]) {
      expect(rc12RowCountForLayout(layout)).toBeGreaterThanOrEqual(6)
    }
  })

  it('declares the four packet 11.1 columns as exact, non-overlapping shares of the row', () => {
    expect(RC12_ROW_COLUMNS.map((column) => column.id)).toEqual(['position', 'badge', 'gap', 'lastLap'])
    expect(RC12_ROW_COLUMNS[0].start).toBe(0)
    expect(RC12_ROW_COLUMNS[RC12_ROW_COLUMNS.length - 1].end).toBe(1)
    RC12_ROW_COLUMNS.forEach((column, index) => {
      expect(column.end).toBeGreaterThan(column.start)
      if (index > 0) expect(column.start).toBe(RC12_ROW_COLUMNS[index - 1].end)
    })
    const total = RC12_ROW_COLUMNS.reduce((sum, column) => sum + (column.end - column.start), 0)
    expect(Math.round(total * 1_000) / 1_000).toBe(1)
  })
})

describe('RC-12 type ladder is arithmetic', () => {
  it('keeps the packet 11.2 ratios and states why the absolutes cannot ship', () => {
    // Packet 11.1 implies a 30 px row pitch and 11.2 then asks for glyphs that do not fit it.
    expect(RC12_PACKET_TYPE_SCALE_PX.gap - rc12RowPitchPx('native')).toBe(14)
    expect(RC12_PACKET_TYPE_SCALE_PX.position - rc12RowPitchPx('native')).toBe(10)
    expect(Math.round((14 / 30) * 1_000) / 10).toBe(46.7)
    expect(Math.round((10 / 30) * 1_000) / 10).toBe(33.3)

    // Normative override `gapOverPositionRatio`: the ratio is arithmetic, never traced.
    const packetRatio = RC12_PACKET_TYPE_SCALE_PX.gap / RC12_PACKET_TYPE_SCALE_PX.position
    expect(Math.round(packetRatio * 100) / 100).toBe(1.1)

    // Normative override `typeScale`: the implemented ladder is the packet ladder at x0.5455.
    expect(RC12_TYPE_SCALE_FACTOR).toBe(0.5455)
    expect(Math.round(RC12_PACKET_TYPE_SCALE_PX.gap * RC12_TYPE_SCALE_FACTOR)).toBe(RC12_TYPE_SCALE_PX.gap)
    expect(Math.round(RC12_PACKET_TYPE_SCALE_PX.position * RC12_TYPE_SCALE_FACTOR)).toBe(RC12_TYPE_SCALE_PX.position)
    expect(Math.round(RC12_PACKET_TYPE_SCALE_PX.badge * RC12_TYPE_SCALE_FACTOR)).toBe(RC12_TYPE_SCALE_PX.badge)
    expect(Math.round(RC12_PACKET_TYPE_SCALE_PX.lastLap * RC12_TYPE_SCALE_FACTOR)).toBe(RC12_TYPE_SCALE_PX.lastLap)
    // The battle-gap hero lives outside the band and keeps the packet size unscaled.
    expect(RC12_TYPE_SCALE_PX.battleGap).toBe(RC12_PACKET_TYPE_SCALE_PX.battleGap)
  })

  it('preserves the ranked chain the governance record scored', () => {
    const ladder = RC12_TYPE_SCALE_PX
    expect(ladder.battleGap / ladder.gap).toBeGreaterThanOrEqual(2)
    expect(ladder.gap / ladder.position).toBeGreaterThanOrEqual(0.95)
    expect(ladder.position / ladder.badge).toBeGreaterThanOrEqual(1.15)
    expect(ladder.badge / ladder.lastLap).toBeGreaterThanOrEqual(0.85)
    expect(ladder.badge / ladder.lastLap).toBeLessThanOrEqual(1.18)
  })

  it('expresses the ladder in container units so 1024x600 is the packet 1.28 step', () => {
    expect(RC12_APP_TYPE_SCALE).toBe(1.28)
    expect(rc12TypeScaleCqw(RC12_TYPE_SCALE_PX.gap)).toBe(3)
    expect(rc12TypeScaleCqw(RC12_TYPE_SCALE_PX.position)).toBe(2.75)
    expect(rc12TypeScaleCqw(RC12_TYPE_SCALE_PX.battleGap)).toBe(9)
    for (const rung of Object.keys(RC12_TYPE_SCALE_PX) as (keyof typeof RC12_TYPE_SCALE_PX)[]) {
      expect(rc12TypeScalePxForWidth(RC12_TYPE_SCALE_PX[rung], RC12_NATIVE_WIDTH_PX)).toBe(RC12_TYPE_SCALE_PX[rung])
      expect(rc12TypeScalePxForWidth(RC12_TYPE_SCALE_PX[rung], RC12_APP_WIDTH_PX)).toBe(
        Math.round(RC12_TYPE_SCALE_PX[rung] * RC12_APP_TYPE_SCALE * 1_000) / 1_000
      )
    }
  })

  it('fits every row glyph inside its own row pitch at both packet canvases', () => {
    for (const [layout, canvasWidth] of [
      ['native', RC12_NATIVE_WIDTH_PX],
      ['app', RC12_APP_WIDTH_PX]
    ] as [Rc12Layout, number][]) {
      const pitch = rc12RowPitchPx(layout)
      for (const rung of ['position', 'badge', 'gap', 'lastLap'] as Rc12TypeRung[]) {
        expect(rc12TypeSizePxForCanvas(rung, canvasWidth)).toBeLessThan(pitch)
      }
    }
  })

  /**
   * The `white-space: nowrap` trap. `scrollWidth === clientWidth` even while a nowrap glyph escapes
   * its column, so containment is proved from the geometry: column width against the widest string
   * that column can ever hold. `scrollWidth` is deliberately never read in this file.
   */
  it('fits the widest string of every column inside that column, at both packet canvases', () => {
    // The widget measures with getBoundingClientRect and never reads a scroll or client size, which
    // a nowrap glyph cannot make fail. Comments are stripped first: they deliberately NAME the trap.
    const widget = readFileSync(resolve(process.cwd(), 'src/renderer/src/overlay/widgets/RaceconRc12DashWidget.tsx'), 'utf8')
    const widgetCode = widget.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(widgetCode).toContain('getBoundingClientRect')
    expect(widgetCode).not.toContain('scrollWidth')
    expect(widgetCode).not.toContain('clientWidth')
    for (const [layout, canvasWidth] of [
      ['native', RC12_NATIVE_WIDTH_PX],
      ['app', RC12_APP_WIDTH_PX]
    ] as [Rc12Layout, number][]) {
      for (const column of RC12_ROW_COLUMNS) {
        const rung = column.id as Rc12TypeRung
        const advance = rc12GlyphAdvancePx(RC12_LONGEST_CELL_TEXT[column.id as Rc12RowColumnId], rc12TypeSizePxForCanvas(rung, canvasWidth))
        expect(rc12RowColumnWidthPx(column.id as Rc12RowColumnId, layout)).toBeGreaterThan(advance)
      }
    }
  })

  it('reserves the row shoulder the tag needs, and never lets the columns spill into it', () => {
    const contentNative = rc12RowContentWidthPx('native')
    // 720 band - 212 reserved shoulder - 2 x 0.9 cqw padding.
    expect(contentNative).toBe(493.6)
    expect(contentNative + (rc12RowColumnInsetCqw('native') / 100) * RC12_NATIVE_WIDTH_PX).toBeLessThanOrEqual(
      RC12_NATIVE_ZONES_PX.leaderboard!.width
    )
    expect(rc12RowContentWidthPx('app')).toBeCloseTo(640 - 2 * (RC12_ROW_PADDING_CQW / 100) * RC12_APP_WIDTH_PX, 3)
    expect(RC12_CELL_PADDING_CQW).toBe(0.2)
  })

  it('binds each clamp bound to the custom property the stylesheet actually declares', () => {
    for (const [rung, bounds] of Object.entries(RC12_TYPE_CLAMP_PX)) {
      const expression = `clamp(${bounds.min}px, var(${bounds.cssVar}, ${rc12TypeScaleCqw(RC12_TYPE_SCALE_PX[rung as Rc12TypeRung])}cqw), ${bounds.max}px)`
      expect(CSS_DECLARATIONS, `${rung} clamp expression`).toContain(expression)
    }
  })
})

describe('RC-12 colour contract', () => {
  it('binds the packet 11.3 tokens verbatim and adds exactly one surface token', () => {
    expect(RC12_PACKET_TOKENS).toEqual({
      bg: '#0A0E1A',
      panel: '#121A2E',
      primary: '#FFFFFF',
      secondary: '#A9B6CC',
      info: '#4FA8FF',
      normal: '#37D67A',
      caution: '#FFC93C',
      danger: '#FF5470',
      signature: '#00E0C6'
    })
    const added = Object.keys(RC12_TOKENS).filter((token) => !(token in RC12_PACKET_TOKENS))
    expect(added).toEqual(['panelAlt'])
    for (const [token, hex] of Object.entries(RC12_TOKENS)) {
      expect(CSS_DECLARATIONS).toContain(`--rc12-${token === 'panelAlt' ? 'panel-alt' : token}: ${hex.toLowerCase()};`)
    }
  })

  it('references every alert-layer token only inside an alert-scoped rule', () => {
    for (const token of RC12_SILENT_TOKENS) {
      const referencing = cssRules().filter((rule) => rule.body.includes(`var(--rc12-${token})`))
      expect(referencing.length, `${token} must be bound somewhere`).toBeGreaterThan(0)
      for (const rule of referencing) {
        expect(rule.selector, `${token} bound outside an alert rule: ${rule.selector}`).toMatch(ALERT_SCOPED)
      }
    }
  })

  it('keeps `normal` as the gain semantic rather than an alert-only token', () => {
    expect([...RC12_SILENT_TOKENS]).toEqual(['caution', 'danger', 'info', 'signature'])
    expect(RC12_SILENT_TOKENS).not.toContain('normal')
    expect(RC12_TREND_TOKENS.closing).toBe('normal')
    expect(RC12_TREND_TOKENS.opening).toBe('secondary')
    expect(RC12_TREND_TOKENS.holding).toBe('secondary')
    expect(RC12_TREND_TOKENS.unknown).toBe('secondary')
  })

  it('measures zero alert-layer elements while every alert is silent', () => {
    for (const cfg of [nativeConfig, config]) {
      const html = markup(snapshot(), cfg)
      expect(html).not.toContain('rc12-tag')
      expect(html).not.toContain('rc12-delay')
      expect(html).not.toContain('rc12-lead-tag')
      expect(html).not.toContain('data-rc12-change="gain"')
      expect(html).not.toContain('data-rc12-change="loss"')
      expect(html).toContain('data-rc12-alerts="silent"')
    }
  })

  it('carries a word and a glyph with every hue, so no state is read by colour alone', () => {
    const withTrend = createRc12DashboardModel(snapshot(), null, 4_000, {
      history: [
        { receivedAt: 1_500, gapSec: 1.6, pairKey: '4:5' },
        { receivedAt: 3_800, gapSec: 0.8, pairKey: '4:5' }
      ]
    })
    expect(withTrend.battle.trend).toBe('closing')
    expect(withTrend.battle.trendLabel).toBe('CLOSING')
    expect(withTrend.battle.trendGlyph).toBe('\u25B2')
    expect(withTrend.battle.trendToken).toBe('normal')

    const alerts = advanceRc12Alerts(createRc12AlertState(), {
      nowMs: 0,
      hasFeed: true,
      timingStale: false,
      observation: { ...rc12SilentObservation(), timingFresh: true, positionChanges: [{ carIdx: 3, direction: 'loss' }] }
    })
    const model = createRc12DashboardModel(snapshot(), null, 0, { alerts, rowCount: 8 })
    const changed = model.rows.find((row) => row.carIdx === 3)!
    expect(changed.change).toBe('loss')
    expect(rc12RowDescription(changed)).toContain('lost a position')
  })
})

describe('RC-12 telemetry truth table', () => {
  it('orders the board from the timing feed position channel and never from a gap', () => {
    const shuffled = snapshot({
      drivers: [driver(4), driver(1), driver(8), driver(5), driver(2), driver(7), driver(3), driver(6)]
    })
    expect(rc12TimingEntries(shuffled).map((entry) => entry.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('drops the pace car and any entrant the feed gives no position', () => {
    const withPaceCar = snapshot({
      drivers: [
        ...board(),
        { ...driver(9), isPaceCar: true },
        { ...driver(10), position: 0 },
        { ...driver(11), position: 11.5 as number }
      ]
    })
    expect(rc12TimingEntries(withPaceCar)).toHaveLength(8)
  })

  it('dashes the leader gap because the value is undefined, never as a fabricated 0.0', () => {
    const model = modelFor(snapshot(), { rowCount: 8 })
    const leader = model.rows[0]
    expect(leader.position.value).toBe('P1')
    expect(leader.gap.value).toBe(RC12_DASH.gap)
    expect(leader.gap.unavailable).toBe(true)
    expect(leader.gap.raw).toBeNull()
    expect(model.rows.map((row) => row.gap.value)).not.toContain('0.0')
  })

  it('publishes the measured interval on the two rows it genuinely reaches, and dashes the rest', () => {
    const model = modelFor(snapshot(), { rowCount: 8 })
    expect(model.measuredGapCount).toBe(2)
    const numeric = model.rows.filter((row) => !row.gap.unavailable)
    expect(numeric.map((row) => row.position.value)).toEqual(['P5', 'P6'])
    expect(numeric.map((row) => row.gap.value)).toEqual(['0.8', '3.5'])
    for (const row of model.rows.filter((candidate) => !numeric.includes(candidate))) {
      expect(row.gap.value).toBe(RC12_DASH.gap)
    }
  })

  it('refuses the relative interval when the on-track neighbour is not the running-order neighbour', () => {
    // A lapped car is the nearest thing on track; it is not the car ahead in the running order.
    const lapped = snapshot({
      relatives: {
        ahead: { carIdx: 8, name: 'Entrant 8', carNumber: '8', position: 8, gapSec: 0.4 },
        behind: { carIdx: 1, name: 'Entrant 1', carNumber: '1', position: 1, gapSec: -0.9 }
      }
    })
    expect(rc12MeasuredGapAheadByCar(lapped, rc12TimingEntries(lapped)).size).toBe(0)
    expect(rc12FeaturedPair(lapped, rc12TimingEntries(lapped))).toBeNull()
    expect(modelFor(lapped, { rowCount: 8 }).battle.available).toBe(false)
  })

  it('refuses a relative interval with no seconds at all', () => {
    const noGap = snapshot({
      relatives: { ahead: { carIdx: 4, name: 'Entrant 4', carNumber: '4', position: 4 } }
    })
    expect(rc12MeasuredGapAheadByCar(noGap, rc12TimingEntries(noGap)).size).toBe(0)
  })

  it('formats every packet 16 unit exactly, and dashes an unusable value', () => {
    expect(rc12FormatPosition(5)).toBe('P5')
    expect(rc12FormatPosition(0)).toBe(RC12_DASH.position)
    expect(rc12FormatPosition(null)).toBe(RC12_DASH.position)
    expect(rc12FormatPosition(2.5)).toBe(RC12_DASH.position)

    expect(rc12FormatGapSeconds(0.8)).toBe('0.8')
    expect(rc12FormatGapSeconds(11.72)).toBe('11.7')
    expect(rc12FormatGapSeconds(null)).toBe(RC12_DASH.gap)
    expect(rc12FormatGapSeconds(Number.NaN)).toBe(RC12_DASH.gap)

    expect(rc12FormatLapTime(91.947)).toBe('1:31.947')
    expect(rc12FormatLapTime(92.61)).toBe('1:32.610')
    expect(rc12FormatLapTime(0)).toBe(RC12_DASH.lapTime)
    expect(rc12FormatLapTime(null)).toBe(RC12_DASH.lapTime)
    expect(rc12FormatLapTime(59.9999)).toBe('1:00.000')
  })

  it('reproduces the approved frame row for row', () => {
    const model = modelFor(snapshot(), { rowCount: 8 })
    expect(model.rows.map((row) => row.position.value)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'])
    expect(model.rows.map((row) => row.lastLap.value)).toEqual([
      '1:32.884',
      '1:32.610',
      '1:33.055',
      '1:32.740',
      '1:31.947',
      '1:33.480',
      '1:33.026',
      '1:32.998'
    ])
    expect(model.battle.gap.value).toBe('0.8')
    expect(model.battle.unit).toBe(RC12_GAP_UNIT)
    expect(model.battle.lead.position.value).toBe('P4')
    expect(model.battle.trail.position.value).toBe('P5')
  })

  it('dashes a last lap until a lap actually completes, and never carries one across a session', () => {
    const opening = snapshot({ drivers: board(8, { 3: { lastLapTimeSec: undefined }, 4: { lastLapTimeSec: -1 } }) })
    const model = modelFor(opening, { rowCount: 8 })
    expect(model.rows[2].lastLap.value).toBe(RC12_DASH.lapTime)
    expect(model.rows[3].lastLap.value).toBe(RC12_DASH.lapTime)
    expect(model.rows[2].lastLap.unavailable).toBe(true)
  })

  it('keeps gap behind and best lap off the 800x480 grammar and on the app driver tags', () => {
    const native = modelFor(snapshot(), { rowCount: 8, includeAppOnly: false })
    expect(native.battle.lead.gapBehind.unavailable).toBe(true)
    expect(native.battle.lead.bestLap.unavailable).toBe(true)

    const app = modelFor(snapshot(), { rowCount: 16, includeAppOnly: true })
    expect(app.battle.lead.gapBehind.value).toBe('0.8')
    expect(app.battle.lead.bestLap.value).toBe('1:32.340')
    // The interval is published ONCE: it is the trailing car's Gap ahead, not a second number.
    expect(app.battle.trail.gapBehind.unavailable).toBe(true)
  })

  it('renders every rank even when the field is shorter than the board', () => {
    const short = snapshot({ drivers: board(3), relatives: undefined, playerCarIdx: 2, position: 2 })
    const model = modelFor(short, { rowCount: 8 })
    expect(model.rows).toHaveLength(8)
    expect(model.fieldSize).toBe(3)
    for (const row of model.rows.slice(3)) {
      expect(row.carIdx).toBeNull()
      expect(row.position.value).toBe(RC12_DASH.position)
      expect(row.gap.value).toBe(RC12_DASH.gap)
      expect(row.lastLap.value).toBe(RC12_DASH.lapTime)
      expect(row.badge.value).toBe(RC12_DASH.badge)
    }
  })

  it('publishes the complete empty board when the feed is absent entirely', () => {
    const model = modelFor(snapshot({ drivers: undefined, relatives: undefined }), { rowCount: 8 })
    expect(model.hasFeed).toBe(false)
    expect(model.fieldSize).toBe(0)
    expect(model.battle.available).toBe(false)
    expect(model.rows.every((row) => row.position.unavailable)).toBe(true)
    expect(model.timingDelay).toBe(false)
  })

  it('carries the packet 16 freshness budgets verbatim and invents none for the event channels', () => {
    expect(RC12_CHANNEL_STALE_MS).toEqual({ position: 1_000, gapAhead: 1_000, gapBehind: 1_000 })
    expect([...RC12_EVENT_CHANNELS]).toEqual(['lastLapTime', 'bestLapTime', 'sectorSplit', 'rollingSplit', 'pitLimiter'])
    for (const channel of RC12_EVENT_CHANNELS) {
      expect(Object.keys(RC12_CHANNEL_STALE_MS)).not.toContain(channel)
    }
    expect(RC12_TIMING_STALE_MS).toBe(RC12_CHANNEL_STALE_MS.position)
  })

  it('degrades the whole board rather than freezing it silently when the feed ages out', () => {
    const buffer = new Rc12TimingBuffer()
    ingest(buffer, snapshot(), 0)
    expect(buffer.timingAgeMs(900)).toBe(900)
    const input = rc12AlertInputForFrame(rc12SilentObservation(), buffer, 1_800)
    expect(input.timingStale).toBe(true)
    const model = createRc12DashboardModel(snapshot(), buffer, 1_800, { rowCount: 8, timingStale: true })
    expect(model.timingDelay).toBe(true)
    for (const row of model.rows.filter((candidate) => candidate.carIdx !== null)) {
      expect(row.position.stale).toBe(true)
      expect(row.position.tone).toBe('muted')
    }
  })
})

describe('RC-12 featured battle is measured, never predicted', () => {
  it('features the running-order pair the app can actually time', () => {
    const pair = rc12FeaturedPair(snapshot(), rc12TimingEntries(snapshot()))
    expect(pair).toEqual({ leadCarIdx: 4, trailCarIdx: 5, leadPosition: 4, trailPosition: 5, gapSec: 0.8 })
  })

  it('falls back to the car behind when the observer leads its own running-order neighbour', () => {
    const leading = snapshot({
      playerCarIdx: 1,
      drivers: board(8, { 1: { isPlayer: true }, 5: { isPlayer: false } }),
      relatives: { behind: { carIdx: 2, name: 'Entrant 2', carNumber: '2', position: 2, gapSec: -1.4 } }
    })
    expect(rc12FeaturedPair(leading, rc12TimingEntries(leading))).toEqual({
      leadCarIdx: 1,
      trailCarIdx: 2,
      leadPosition: 1,
      trailPosition: 2,
      gapSec: 1.4
    })
  })

  it('publishes the empty strip rather than featuring a pair it cannot time', () => {
    const model = modelFor(snapshot({ relatives: undefined }), { rowCount: 8 })
    expect(model.battle.available).toBe(false)
    expect(model.battle.gap.value).toBe(RC12_DASH.gap)
    expect(model.battle.trend).toBe('unknown')
    expect(markup(snapshot({ relatives: undefined }), nativeConfig)).toContain(RC12_NO_BATTLE_LABEL)
  })

  it('shows no trend at all until two samples of the same pair are inside the window', () => {
    const pair = rc12FeaturedPair(snapshot(), rc12TimingEntries(snapshot()))
    expect(rc12TrendForHistory([], pair, 1_000)).toBe('unknown')
    expect(rc12TrendForHistory([{ receivedAt: 900, gapSec: 0.8, pairKey: '4:5' }], pair, 1_000)).toBe('unknown')
    // A sample of a DIFFERENT pair never contributes to this pair's trend.
    expect(
      rc12TrendForHistory(
        [
          { receivedAt: 800, gapSec: 2.4, pairKey: '5:6' },
          { receivedAt: 900, gapSec: 0.8, pairKey: '4:5' }
        ],
        pair,
        1_000
      )
    ).toBe('unknown')
  })

  it('reads closing, opening and holding from the measured samples only', () => {
    const pair = rc12FeaturedPair(snapshot(), rc12TimingEntries(snapshot()))
    const at = (gap: number, receivedAt: number) => ({ receivedAt, gapSec: gap, pairKey: '4:5' })
    expect(rc12TrendForHistory([at(1.6, 1_000), at(0.8, 3_000)], pair, 3_100)).toBe('closing')
    expect(rc12TrendForHistory([at(0.8, 1_000), at(1.6, 3_000)], pair, 3_100)).toBe('opening')
    expect(rc12TrendForHistory([at(0.8, 1_000), at(0.82, 3_000)], pair, 3_100)).toBe('holding')
    // A sample outside the trend window is not read.
    expect(rc12TrendForHistory([at(1.6, 1_000), at(0.8, 3_000)], pair, 9_000)).toBe('unknown')
  })

  it('records gap history only from observed frames and only for the featured pair', () => {
    const buffer = new Rc12TimingBuffer()
    ingest(buffer, snapshot({}, 1_000), 0)
    ingest(buffer, snapshot({}, 1_100), 200)
    ingest(buffer, snapshot({ relatives: undefined }, 1_200), 400)
    const history = buffer.history()
    expect(history).toHaveLength(2)
    expect(history.every((sample) => sample.pairKey === '4:5')).toBe(true)

    const model = createRc12DashboardModel(snapshot(), buffer, 400, { rowCount: 16, includeAppOnly: true })
    expect(model.history.length).toBe(2)
    expect(model.history[0].x).toBe(0)
    expect(model.history[1].x).toBe(100)
  })

  it('never plots a gap history at 800x480', () => {
    const buffer = new Rc12TimingBuffer()
    ingest(buffer, snapshot({}, 1_000), 0)
    ingest(buffer, snapshot({}, 1_100), 200)
    expect(createRc12DashboardModel(snapshot(), buffer, 200, { rowCount: 8, includeAppOnly: false }).history).toHaveLength(0)
  })
})

describe('RC-12 trigger-only alerts', () => {
  const fresh = { nowMs: 0, hasFeed: true, timingStale: false }

  it('starts silent on every alert', () => {
    const state = createRc12AlertState()
    expect(state.fastestLap).toBeNull()
    expect(state.leadChange).toBeNull()
    expect(state.changes).toHaveLength(0)
    expect(state.timingDelay).toBe(false)
  })

  it('never fires anything from the frame that establishes the baseline', () => {
    const buffer = new Rc12TimingBuffer()
    const observation = ingest(buffer, snapshot(), 0)
    // P5 already holds the session-fastest lap and P1 is already leading, and neither is an event.
    expect(observation.fastestLap).toBeNull()
    expect(observation.leadChange).toBeNull()
    expect(observation.positionChanges).toHaveLength(0)
    expect(observation.timingFresh).toBe(true)

    const alerts = advanceRc12Alerts(createRc12AlertState(), { ...fresh, observation })
    expect(alerts.fastestLap).toBeNull()
    expect(alerts.leadChange).toBeNull()
  })

  it('fires the fastest-lap tag on a genuine improvement, holds 5 s, then retires', () => {
    const buffer = new Rc12TimingBuffer()
    ingest(buffer, snapshot(), 0)
    const improved = ingest(buffer, snapshot({ drivers: board(8, { 7: { lastLapTimeSec: 91.402 } }) }, 1_411_100), 200)
    expect(improved.fastestLap).toEqual({ carIdx: 7, position: 7, lapSec: 91.402 })

    let alerts = advanceRc12Alerts(createRc12AlertState(), { ...fresh, nowMs: 200, observation: improved })
    expect(alerts.fastestLap?.carIdx).toBe(7)
    expect(alerts.fastestLap?.untilMs).toBe(200 + RC12_FASTEST_LAP_HOLD_MS)

    const model = createRc12DashboardModel(snapshot({ drivers: board(8, { 7: { lastLapTimeSec: 91.402 } }) }), buffer, 200, {
      rowCount: 8,
      alerts
    })
    expect(model.tag.showing).toBe(true)
    expect(model.tag.label).toBe(RC12_FASTEST_LAP_LABEL)
    expect(model.tag.position).toBe('P7')
    expect(model.tag.lapTime).toBe('1:31.402')
    expect(model.rows[6].fastestLap).toBe(true)
    expect(model.rows.filter((row) => row.fastestLap)).toHaveLength(1)

    // Still latched one millisecond before the editorial lifetime elapses.
    alerts = advanceRc12Alerts(alerts, { ...fresh, nowMs: 5_199, observation: rc12SilentObservation() })
    expect(alerts.fastestLap).not.toBeNull()
    // And retired on its own the moment it does.
    alerts = advanceRc12Alerts(alerts, { ...fresh, nowMs: 5_200, observation: rc12SilentObservation() })
    expect(alerts.fastestLap).toBeNull()
  })

  it('never re-fires the fastest lap for a time that is not an improvement', () => {
    const buffer = new Rc12TimingBuffer()
    ingest(buffer, snapshot(), 0)
    const slower = ingest(buffer, snapshot({ drivers: board(8, { 2: { lastLapTimeSec: 92.001 } }) }, 1_411_100), 200)
    expect(slower.fastestLap).toBeNull()
    const equal = ingest(buffer, snapshot({}, 1_411_200), 400)
    expect(equal.fastestLap).toBeNull()
  })

  it('fires the lead change only when P1 actually changes, holds 5 s, then retires', () => {
    const buffer = new Rc12TimingBuffer()
    ingest(buffer, snapshot(), 0)
    const swapped = ingest(
      buffer,
      snapshot({ drivers: board(8, { 1: { position: 2 }, 2: { position: 1 } }) }, 1_411_100),
      200
    )
    expect(swapped.leadChange).toEqual({ carIdx: 2 })

    let alerts = advanceRc12Alerts(createRc12AlertState(), { ...fresh, nowMs: 200, observation: swapped })
    expect(alerts.leadChange?.untilMs).toBe(200 + RC12_LEAD_CHANGE_HOLD_MS)
    alerts = advanceRc12Alerts(alerts, { ...fresh, nowMs: 5_200, observation: rc12SilentObservation() })
    expect(alerts.leadChange).toBeNull()
  })

  it('animates a position change for 500 ms with a direction, then releases it', () => {
    const buffer = new Rc12TimingBuffer()
    ingest(buffer, snapshot(), 0)
    const observation = ingest(
      buffer,
      snapshot({ drivers: board(8, { 6: { position: 7 }, 7: { position: 6 } }) }, 1_411_100),
      200
    )
    expect(observation.positionChanges).toEqual([
      { carIdx: 7, direction: 'gain' },
      { carIdx: 6, direction: 'loss' }
    ])

    let alerts = advanceRc12Alerts(createRc12AlertState(), { ...fresh, nowMs: 200, observation })
    expect(alerts.changes.map((change) => change.untilMs)).toEqual([700, 700])
    expect(RC12_POSITION_CHANGE_HOLD_MS).toBe(500)
    alerts = advanceRc12Alerts(alerts, { ...fresh, nowMs: 699, observation: rc12SilentObservation() })
    expect(alerts.changes).toHaveLength(2)
    alerts = advanceRc12Alerts(alerts, { ...fresh, nowMs: 700, observation: rc12SilentObservation() })
    expect(alerts.changes).toHaveLength(0)
  })

  it('unlatches every editorial highlight the moment the feed goes stale, and says TIMING DELAY', () => {
    const latched = advanceRc12Alerts(createRc12AlertState(), {
      ...fresh,
      observation: {
        fastestLap: { carIdx: 5, position: 5, lapSec: 91.947 },
        leadChange: { carIdx: 2 },
        positionChanges: [{ carIdx: 3, direction: 'gain' }],
        timingFresh: true
      }
    })
    expect(latched.fastestLap).not.toBeNull()

    const delayed = advanceRc12Alerts(latched, { nowMs: 1, hasFeed: true, timingStale: true, observation: rc12SilentObservation() })
    expect(delayed.fastestLap).toBeNull()
    expect(delayed.leadChange).toBeNull()
    expect(delayed.changes).toHaveLength(0)
    expect(delayed.timingDelay).toBe(true)
  })

  it('raises no TIMING DELAY when there was never a feed to delay', () => {
    const absent = advanceRc12Alerts(createRc12AlertState(), {
      nowMs: 0,
      hasFeed: false,
      timingStale: true,
      observation: rc12SilentObservation()
    })
    expect(absent.timingDelay).toBe(false)
    const html = markup(snapshot({ drivers: undefined, relatives: undefined }), nativeConfig)
    expect(html).toContain(RC12_NO_TIMING_LABEL)
    expect(html).not.toContain(RC12_TIMING_DELAY_LABEL)
  })

  it('never annotates a car that has left the board', () => {
    const latched = advanceRc12Alerts(createRc12AlertState(), {
      ...fresh,
      observation: {
        fastestLap: { carIdx: 42, position: 3, lapSec: 90.1 },
        leadChange: { carIdx: 42 },
        positionChanges: [{ carIdx: 42, direction: 'gain' }],
        timingFresh: true
      }
    })
    const cleared = clearInvalidRc12Alerts(latched, rc12TimingEntries(snapshot()))
    expect(cleared.fastestLap).toBeNull()
    expect(cleared.leadChange).toBeNull()
    expect(cleared.changes).toHaveLength(0)

    expect(clearInvalidRc12Alerts(latched, []).fastestLap).toBeNull()
  })

  it('gives every alert a visible surface at every breakpoint', () => {
    const alerts = advanceRc12Alerts(createRc12AlertState(), {
      ...fresh,
      observation: {
        fastestLap: { carIdx: 5, position: 5, lapSec: 91.947 },
        leadChange: { carIdx: 1 },
        positionChanges: [{ carIdx: 3, direction: 'gain' }],
        timingFresh: true
      }
    })
    for (const breakpoint of BREAKPOINTS) {
      const layout = rc12LayoutForContentBox(breakpoint.width, breakpoint.height)
      const compact = rc12CompactModeForContentBox(breakpoint.width, breakpoint.height)
      const zones = rc12ZonesForLayout(layout, compact, breakpoint)
      // The fastest-lap tag and the TIMING DELAY note share one zone, and it exists everywhere.
      expect(zones.fastestLapTag, `${breakpoint.width}x${breakpoint.height}`).toBeDefined()
      // The lead-change and position-change surfaces live inside the rows, which exist everywhere.
      const model = createRc12DashboardModel(snapshot(), null, 0, {
        rowCount: rc12RowCountForLayout(layout, compact),
        alerts
      })
      expect(model.rows.some((row) => row.leadChange)).toBe(true)
      expect(model.rows.some((row) => row.change === 'gain')).toBe(true)
      expect(model.tag.showing).toBe(true)
    }
  })

  it('raises no alert at all from a source the shared buffer refuses', () => {
    for (const refused of [snapshot({ sim: 'mock' }), snapshot({ sim: 'replay' })]) {
      const html = markup(refused, nativeConfig)
      expect(html).toContain('data-rc12-alerts="silent"')
      expect(html).not.toContain('rc12-tag')
      expect(html).not.toContain('rc12-delay')
    }
  })
})

describe('RC-12 layout resolution', () => {
  it('resolves the packet breakpoints', () => {
    expect(rc12LayoutForContentBox(800, 480)).toBe('native')
    expect(rc12LayoutForContentBox(801, 481)).toBe('native')
    expect(rc12LayoutForContentBox(1024, 600)).toBe('app')
    expect(rc12LayoutForContentBox(1920, 1080)).toBe('app')
    expect(rc12LayoutForContentBox(640, 520)).toBe('compact')
    expect(rc12LayoutForContentBox(0, 0)).toBe('app')
    expect(rc12LayoutForContentBox(Number.NaN, 480)).toBe('app')
  })

  it('resolves the compact modes', () => {
    expect(rc12CompactModeForContentBox(400, 800)).toBe('phone')
    expect(rc12CompactModeForContentBox(900, 400)).toBe('landscape')
    expect(rc12CompactModeForContentBox(640, 520)).toBe('standard')
    expect(rc12CompactModeForContentBox(1024, 600)).toBe('standard')
    expect(rc12PhoneGeometryForContentBox(400, 800)).not.toBeNull()
    expect(rc12PhoneGeometryForContentBox(900, 400)).toBeNull()
  })

  it('expands rather than scales at 1024x600', () => {
    const native = rc12ZonesPxForLayout('native')
    const app = rc12ZonesPxForLayout('app')
    // A pure scale would multiply every packet 11.1 box by 1.28; the band narrows instead.
    expect(app.leaderboard!.width).toBeLessThan(native.leaderboard!.width * RC12_APP_TYPE_SCALE)
    expect(app.leaderboard!.height).toBeGreaterThan(native.leaderboard!.height * RC12_APP_TYPE_SCALE)
    expect(Object.keys(app).length).toBeGreaterThan(Object.keys(native).length)
  })

  /** The layout claim is read from the BOUNDING RECT, never from a content box or a scroll size. */
  it('resolves its layout from getBoundingClientRect rather than from the configured size', () => {
    const original = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function stub(this: HTMLElement): DOMRect {
      return this.classList.contains('rc12-widget')
        ? ({ width: 800, height: 480, top: 0, left: 0, right: 800, bottom: 480, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
        : ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    }
    try {
      // The config says 1024x600; the measured bounding rect says 800x480 and must win.
      const { container } = render(createElement(RaceconRc12DashWidget, { snapshot: snapshot(), config }))
      const root = container.querySelector('.rc12-widget') as HTMLElement
      expect(root.getAttribute('data-rc12-layout')).toBe('native')
      expect(root.getAttribute('data-rc12-content-width')).toBe('800')
      expect(root.getAttribute('data-rc12-content-height')).toBe('480')
      expect(root.getAttribute('data-rc12-rows')).toBe(String(RC12_NATIVE_ROW_COUNT))
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original
    }
  })
})

describe('RC-12 rendered DOM contract', () => {
  it('renders the widget marker, the layout attributes and every packet zone', () => {
    const html = markup(snapshot(), nativeConfig)
    assertClean(html)
    expect(html).toContain('data-widget="raceconRc12Dash"')
    expect(html).toContain('data-rc12-layout="native"')
    expect(html).toContain('data-rc12-native-size="800x480"')
    expect(html).toContain('data-rc12-buffer-state="accepted"')
    expect(html).toContain('data-rc12-timing="live"')
    for (const zone of ['sessionClock', 'leaderboard', 'battleStrip']) {
      expect(html).toContain(`data-rc12-zone="${zone}"`)
    }
    expect(html).toContain('data-testid="rc12-safe-frame"')
  })

  it('renders exactly the row count its layout declares', () => {
    expect(markup(snapshot(), nativeConfig).match(/data-testid="rc12-row"/g)).toHaveLength(RC12_NATIVE_ROW_COUNT)
    expect(markup(snapshot(), config).match(/data-testid="rc12-row"/g)).toHaveLength(RC12_APP_ROW_COUNT)
  })

  it('renders no cockpit module anywhere: no gear, no RPM, no shift LED, no driver aid', () => {
    for (const cfg of [nativeConfig, config]) {
      const html = markup(snapshot({ gear: 6, rpm: 7_150, tcActive: true, absActive: true, brakeBiasPct: 56 }), cfg)
      expect(html).not.toMatch(/led|shift|rpm|gear|\bTC\b|\bABS\b|bias/i)
    }
  })

  it('renders a dash-only frame with no telemetry at all', () => {
    const html = markup(null, nativeConfig)
    assertClean(html)
    expect(html).toContain('data-rc12-timing="absent"')
    expect(html).toContain(RC12_NO_TIMING_LABEL)
    expect(html).toContain(RC12_NO_BATTLE_LABEL)
    expect(html.match(/data-rc12-row-populated="false"/g)).toHaveLength(RC12_NATIVE_ROW_COUNT)
    expect(html).toContain(RC12_DASH.badge)
    expect(html).toContain(RC12_DASH.lapTime)
  })

  it('refuses mock and replay telemetry and publishes the refusal', () => {
    expect(markup(snapshot({ sim: 'mock' }), nativeConfig)).toContain('data-rc12-buffer-state="mock-telemetry"')
    expect(markup(snapshot({ sim: 'replay' }), nativeConfig)).toContain('data-rc12-buffer-state="replay-telemetry"')
    expect(
      markup(snapshot({ replayContext: { state: 'replay' } as TelemetrySnapshot['replayContext'] }), nativeConfig)
    ).toContain('data-rc12-buffer-state="replay-telemetry"')
    // `replayPlaying` is a raw provider field, not a refusal trigger.
    expect(markup(snapshot({ replayPlaying: true }), nativeConfig)).toContain('data-rc12-buffer-state="accepted"')

    for (const refused of [snapshot({ sim: 'mock' }), snapshot({ sim: 'replay' })]) {
      const html = markup(refused, nativeConfig)
      expect(html).toContain('data-rc12-timing="absent"')
      expect(html.match(/data-rc12-row-populated="false"/g)).toHaveLength(RC12_NATIVE_ROW_COUNT)
    }
  })

  it('exposes the compact mode attribute only in the compact layout', () => {
    expect(markup(snapshot(), nativeConfig)).not.toContain('data-rc12-compact-mode')
    expect(markup(snapshot(), config)).not.toContain('data-rc12-compact-mode')
    const phone = markup(snapshot(), { ...config, position: { x: 0, y: 0, width: 400, height: 800 } })
    expect(phone).toContain('data-rc12-compact-mode="phone"')
    expect(phone.match(/data-testid="rc12-row"/g)).toHaveLength(RC12_PHONE_ROW_COUNT)
  })

  it('renders cleanly at every breakpoint', () => {
    for (const breakpoint of BREAKPOINTS) {
      const html = markup(snapshot(), { ...config, position: { x: 0, y: 0, ...breakpoint } })
      assertClean(html)
      expect(html).toContain('data-widget="raceconRc12Dash"')
      expect(html).toContain('data-rc12-zone="leaderboard"')
      expect(html).toContain('data-rc12-zone="battleStrip"')
    }
  })

  it('surfaces the fastest-lap tag in the DOM once its trigger fires, and not before', () => {
    let clock = 0
    const view = render(
      createElement(RaceconRc12DashWidget, { snapshot: snapshot({}, 1_411_000), config: nativeConfig, monotonicClock: () => clock })
    )
    expect(view.container.querySelector('[data-testid="rc12-tag"]')).toBeNull()

    clock = 200
    view.rerender(
      createElement(RaceconRc12DashWidget, {
        snapshot: snapshot({ drivers: board(8, { 7: { lastLapTimeSec: 91.402 } }) }, 1_411_100),
        config: nativeConfig,
        monotonicClock: () => clock
      })
    )
    const tag = view.container.querySelector('[data-testid="rc12-tag"]')
    expect(tag).not.toBeNull()
    expect(tag?.textContent).toContain(RC12_FASTEST_LAP_LABEL)
    expect(tag?.textContent).toContain('P7')
    expect(view.container.querySelector('.rc12-widget')?.getAttribute('data-rc12-alerts')).toBe('active')
  })

  it('freezes the board with the TIMING DELAY note once the feed ages past its budget', () => {
    vi.useFakeTimers()
    let clock = 0
    const frame = snapshot({}, 1_411_000)
    const view = render(
      createElement(RaceconRc12DashWidget, { snapshot: frame, config: nativeConfig, monotonicClock: () => clock })
    )
    expect(view.container.querySelector('[data-testid="rc12-delay"]')).toBeNull()

    // The provider stops producing frames: no new snapshot arrives and the receipt simply ages out.
    clock = RC12_TIMING_STALE_MS + 500
    act(() => {
      vi.advanceTimersByTime(200)
    })
    const delay = view.container.querySelector('[data-testid="rc12-delay"]')
    expect(delay).not.toBeNull()
    expect(delay?.textContent).toBe(RC12_TIMING_DELAY_LABEL)
    expect(view.container.querySelector('.rc12-widget')?.getAttribute('data-rc12-timing')).toBe('delayed')
    expect(view.container.querySelector('[data-testid="rc12-tag"]')).toBeNull()
  })

  it('describes every row and the battle in words, never by hue', () => {
    const model = modelFor(snapshot(), { rowCount: 8 })
    const leader = rc12RowDescription(model.rows[0])
    expect(leader).toContain('Rank 1')
    expect(leader).toContain('position P1')
    expect(leader).toContain('gap ahead unavailable')
    expect(leader).toContain('last lap 1:32.884')

    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('aria-label="Rank 1, position P1, gap ahead unavailable, last lap 1:32.884."')
    expect(html).toContain('Featured battle, P4 ahead of P5, gap 0.8 seconds')
  })
})

describe('RC-12 display clock freezes in a preview and ages when live', () => {
  const WIDGET_SOURCE = readFileSync(
    resolve(process.cwd(), 'src/renderer/src/overlay/widgets/RaceconRc12DashWidget.tsx'),
    'utf8'
  )
  const GUARD_SOURCE = readFileSync(
    resolve(process.cwd(), 'src/renderer/src/overlay/widgets/raceconDisplayClock.test.ts'),
    'utf8'
  )

  /**
   * Mounts RC-12 on a controllable monotonic clock and steps wall time and that clock together,
   * exactly as `raceconDisplayClock.test.ts` does — but on a snapshot RC-12 genuinely ACCEPTS, so
   * the board has a live timing feed and a real time gate to cross rather than sitting on
   * NO TIMING SOURCE.
   */
  function mountClocked(preview: WidgetProps['preview']): { text: () => string; advance: (ms: number) => void } {
    vi.useFakeTimers()
    let monotonicMs = 0
    const monotonicClock = (): number => monotonicMs
    const view = render(
      createElement(RaceconRc12DashWidget, { snapshot: snapshot(), config: nativeConfig, preview, monotonicClock })
    )
    const step = RACECON_DISPLAY_CLOCK_INTERVAL_MS * 5
    const advance = (ms: number): void => {
      for (let elapsed = 0; elapsed < ms; elapsed += step) {
        act(() => {
          monotonicMs += step
          vi.advanceTimersByTime(step)
        })
      }
    }
    return { text: () => view.container.textContent ?? '', advance }
  }

  it('routes its display clock through the shared hook and owns no interval of its own', () => {
    const code = WIDGET_SOURCE.replace(/\r\n/g, '\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(code).toContain("import { raceconDisplayClockFrozen, useRaceconDisplayClock } from './raceconDisplayClock'")
    expect(code).toContain('const nowMs = useRaceconDisplayClock(monotonicClock, raceconDisplayClockFrozen(preview))')
    expect(code).toMatch(/export function RaceconRc12DashWidget\(\{\n\s*snapshot,\n\s*config,\n\s*preview,\n\s*monotonicClock = rc01MonotonicNow\n\}/)
    // The hook owns the timer. A widget-local one would sit outside the freeze policy entirely.
    expect(code).not.toContain('setInterval')
    expect(code).not.toContain('setTimeout')
    expect(code).not.toContain('requestAnimationFrame')
    expect(code).not.toContain('setNowMs')
    // …and the deferred-work marker is gone: the shared hook exists now.
    expect(WIDGET_SOURCE).not.toContain('TODO(PR #131)')
  })

  it('is enumerated in the shared RaceCon display-clock guard', () => {
    // The guard cross-checks its list against WIDGET_COMPONENTS, and RC-12 is what makes
    // `raceconRc12Dash` a registered RaceCon id. Mirrored here so dropping RC-12 from that list
    // turns RC-12's own suite red as well.
    expect(GUARD_SOURCE).toContain("['raceconRc12Dash', RaceconRc12DashWidget]")
    expect(WIDGET_COMPONENTS.raceconRc12Dash).toBe(RaceconRc12DashWidget)
    expect(raceconDisplayClockFrozen(undefined)).toBe(false)
    expect(raceconDisplayClockFrozen('inert')).toBe(true)
  })

  it('holds an inert preview byte-identical across a 30 s wall-clock advance, feed and all', () => {
    const { text, advance } = mountClocked('inert')
    const mounted = text()
    expect(mounted).toContain('P1')
    expect(mounted).not.toContain(RC12_TIMING_DELAY_LABEL)
    advance(30_000)
    expect(text(), 'RC-12 inert preview text must be byte-identical after 30s').toBe(mounted)
    expect(text()).not.toContain(RC12_TIMING_DELAY_LABEL)
  }, 30_000)

  it('still ages a live render, so a real board reaches its TIMING DELAY gate', () => {
    const { text, advance } = mountClocked(undefined)
    const mounted = text()
    expect(mounted).not.toContain(RC12_TIMING_DELAY_LABEL)
    advance(30_000)
    expect(text(), 'RC-12 live render must still age its frame').not.toBe(mounted)
    expect(text()).toContain(RC12_TIMING_DELAY_LABEL)
  }, 30_000)

  it('starts no timer at all while frozen, and clears the live one on unmount', () => {
    vi.useFakeTimers()
    const frozen = render(
      createElement(RaceconRc12DashWidget, { snapshot: snapshot(), config: nativeConfig, preview: 'inert' })
    )
    expect(vi.getTimerCount()).toBe(0)
    frozen.unmount()

    const clearSpy = vi.spyOn(window, 'clearInterval')
    const live = render(createElement(RaceconRc12DashWidget, { snapshot: snapshot(), config: nativeConfig }))
    expect(vi.getTimerCount()).toBe(1)
    live.unmount()
    expect(clearSpy).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    clearSpy.mockRestore()
  })

  /**
   * The defect `inert-previews.browser.test.ts` catches is TEXT MUTATION under a ticking clock in a
   * gallery preview. RC-12 renders through `renderDashboardElement({ preview: 'inert' })` with the
   * shared `PREVIEW_SNAPSHOT`, whose `sim` is `'mock'` — refused outright by the RC-01 buffer. The
   * freeze above is the real guarantee; this asserts the second, independent one still holds.
   */
  it('renders byte-identical markup at every point on the clock in an inert gallery preview', () => {
    expect(PREVIEW_SNAPSHOT.sim).toBe('mock')
    const frames = [0, 1_000, RC12_TIMING_STALE_MS + 1, 60_000, 3_600_000].map((clock) =>
      renderToStaticMarkup(
        createElement(RaceconRc12DashWidget, {
          snapshot: PREVIEW_SNAPSHOT,
          config: nativeConfig,
          monotonicClock: () => clock
        })
      )
    )
    for (const frame of frames) {
      expect(frame).toBe(frames[0])
      expect(frame).toContain('data-rc12-buffer-state="mock-telemetry"')
      expect(frame).toContain('data-rc12-alerts="silent"')
      expect(frame).toContain('data-rc12-timing="absent"')
      expect(frame).not.toContain(RC12_TIMING_DELAY_LABEL)
    }
  })

  it('never crosses a time-gated threshold from a snapshot the buffer refused', () => {
    for (const refused of [PREVIEW_SNAPSHOT, snapshot({ sim: 'mock' }), snapshot({ sim: 'replay' })]) {
      const early = markup(refused as TelemetrySnapshot, nativeConfig)
      const late = renderToStaticMarkup(
        createElement(RaceconRc12DashWidget, {
          snapshot: refused as TelemetrySnapshot,
          config: nativeConfig,
          monotonicClock: () => 10 * RC12_FASTEST_LAP_HOLD_MS
        })
      )
      expect(late).toBe(early)
    }
  })
})

describe('RC-12 shares the RC-01 fail-closed ingest buffer', () => {  it('accepts a live identified snapshot and rejects an unidentified one', () => {
    const buffer = new Rc01LiveTelemetryBuffer()
    expect(buffer.ingest(snapshot(), 0).reason).toBe('accepted')

    const anonymous = new Rc01LiveTelemetryBuffer()
    expect(anonymous.ingest(snapshot({ sessionUniqueId: undefined, connectionEpoch: undefined }), 0).reason).toBe(
      'missing-source-identity'
    )
  })

  it('does not fork the buffer, the receipts or the identity rules', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/overlay/widgets/raceconRc12Core.ts'), 'utf8')
    expect(source).toContain("from './raceconRc01Core'")
    expect(source).not.toContain('class Rc01LiveTelemetryBuffer')
    expect(source).not.toContain('function rc01SourceIdentity')
    const widget = readFileSync(resolve(process.cwd(), 'src/renderer/src/overlay/widgets/RaceconRc12DashWidget.tsx'), 'utf8')
    expect(widget).toContain('Rc01LiveTelemetryBuffer')
  })

  it('drops the observed order, the observed session best and the gap history when the source changes', () => {
    const buffer = new Rc12TimingBuffer()
    ingest(buffer, snapshot(), 0)
    expect(buffer.sessionBest().lapSec).toBe(91.947)
    expect(buffer.history()).toHaveLength(1)
    buffer.reset()
    expect(buffer.sessionBest().lapSec).toBeNull()
    expect(buffer.history()).toHaveLength(0)
    expect(buffer.timingReceipt()).toBeNull()
    // The next frame is a BASELINE again, so nothing fires from the new source's standing state.
    expect(ingest(buffer, snapshot(), 100).fastestLap).toBeNull()
  })

  it('clones without sharing state, so an abandoned render cannot advance the board', () => {
    const buffer = new Rc12TimingBuffer()
    ingest(buffer, snapshot(), 0)
    const candidate = buffer.clone()
    ingest(candidate, snapshot({ drivers: board(8, { 7: { lastLapTimeSec: 91.402 } }) }, 1_411_100), 200)
    expect(candidate.sessionBest().lapSec).toBe(91.402)
    expect(buffer.sessionBest().lapSec).toBe(91.947)
    expect(buffer.history()).toHaveLength(1)
  })
})
