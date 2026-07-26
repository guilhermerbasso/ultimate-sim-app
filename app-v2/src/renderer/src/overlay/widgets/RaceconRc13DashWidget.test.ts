// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOverlayStyle, type OverlayWidgetConfig } from '../../../../shared/overlays'
import type { Flags, TelemetrySnapshot } from '../../../../shared/telemetry'
import { OVERLAY_DASHBOARD_PRESETS } from '../../../../shared/dashboards'
import { WIDGET_COMPONENTS } from './index'
import type { WidgetProps } from './types'
import { RACECON_DISPLAY_CLOCK_INTERVAL_MS, raceconDisplayClockFrozen } from './raceconDisplayClock'
import { RaceconRc13DashWidget } from './RaceconRc13DashWidget'
import {
  RC01_CHANNEL_STALE_MS,
  Rc01LiveTelemetryBuffer,
  type Rc01MonotonicClock,
  createRc01ChannelReceipts
} from './raceconRc01Core'
import {
  RC13_ALERT_LABELS,
  RC13_APP_ONLY_MODULES,
  RC13_APP_TYPE_SCALE,
  RC13_APP_ZONES_PX,
  RC13_CHANNEL_STALE_MS,
  RC13_CQW_PX,
  RC13_DASH,
  RC13_EXPANSION_MODEL,
  RC13_FLAG_LABELS,
  RC13_GAP_HISTORY_LIMIT,
  RC13_GAP_HISTORY_MS,
  RC13_NATIVE_ZONES_PX,
  RC13_NO_QUEUE_SOURCE,
  RC13_NO_RESTART_ZONE_SOURCE,
  RC13_NO_WINDOW_SOURCE,
  RC13_OVERTAKE_ENGAGE_MS,
  RC13_OVERTAKE_GAP_ENTER_SEC,
  RC13_OVERTAKE_GAP_EXIT_SEC,
  RC13_OVERTAKE_MIN_CLOSING_SEC,
  RC13_OVERTAKE_MIN_SPEED_KMH,
  RC13_PACKET_OMISSIONS,
  RC13_RESTART_LABELS,
  RC13_RESTART_MIN_VISIBLE_MS,
  RC13_SILENT_TOKENS,
  RC13_SPEED_DASH_MS,
  RC13_TOKENS,
  RC13_TOKEN_COLLISION,
  RC13_TYPE_RANKS,
  RC13_TYPE_SCALE_PX,
  RC13_WINDOW_DIVIDER_UNIT,
  RC13_WINDOW_MEASURED,
  RC13_WINDOW_VIOLATION_ENGAGE_MS,
  RC13_WINDOW_VIOLATION_HYSTERESIS_MS,
  RC13_WINDOW_WORD_CENTRE_UNIT,
  RC13_WINDOW_ZONE_WORDS,
  RC13_ZONE_ORDER,
  type Rc13AlertInput,
  Rc13AuxBuffer,
  Rc13QueueBuffer,
  type Rc13Rect,
  type Rc13ZoneMap,
  advanceRc13Alerts,
  clearInvalidRc13Alerts,
  createRc13AlertState,
  createRc13AuxReceipts,
  createRc13DashboardModel,
  rc13ActiveAlerts,
  rc13AlertInputForModel,
  rc13AuxChannelValue,
  rc13CompactModeForContentBox,
  rc13FlagDescription,
  rc13FormatGapAhead,
  rc13FormatPosition,
  rc13FormatScDelta,
  rc13FormatSpeed,
  rc13GapClosingSec,
  rc13LayoutForContentBox,
  rc13OvertakePatternActive,
  rc13OvertakePatternNormalised,
  rc13PatternFingerprint,
  rc13PhoneGeometryForContentBox,
  rc13QueueTrainRows,
  rc13RectPercent,
  rc13RectsOverlap,
  rc13RestartDescription,
  rc13RestartStateFromSnapshot,
  rc13RestartZoneLabel,
  rc13ScDeltaSec,
  rc13ScWindowBoundsSec,
  rc13TrackFlagFromSnapshot,
  rc13TypeScaleCqw,
  rc13TypeScalePxForWidth,
  rc13WindowDescription,
  rc13WindowMarkerUnit,
  rc13WindowZoneForDelta,
  rc13WindowZones,
  rc13ZoneStyle,
  rc13ZonesForLayout
} from './raceconRc13Core'

/**
 * RC-13 was delivered as CORE ONLY (PR #139). The widget id, the dashboard preset, the responsive
 * full-frame membership, the identity-scoped membership and the identity catalog are all shared-file
 * changes and landed together in the separate catalog wiring PR. `raceconRc13Dash` is now a member of
 * `OverlayWidgetId`, so the assertions below are the post-wiring direction: RC-13 IS reachable from
 * the catalog. The `config.id` cast is kept only because `RC13_WIDGET_ID` is a local `string` here.
 *
 * RC-13 also CONSUMES two shared modules that already existed on `main` — `raceconRc01Core` and the
 * family display clock — and still adds nothing to any shared file itself.
 */
const RC13_WIDGET_ID = 'raceconRc13Dash'
const RC13_PRESET_ID = 'racecon_rc13_dash'

const config: OverlayWidgetConfig = {
  id: RC13_WIDGET_ID as OverlayWidgetConfig['id'],
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
 * The stylesheet is read as TEXT, not as a loaded module, because three of RC-13's guarantees are
 * properties of the source itself: the three alert tokens may only be referenced inside a
 * state-scoped rule, `signature` may never appear in an alert rule, and no hero may be sized in
 * anything but container units. Vitest's root is `app-v2`.
 */
const CSS_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/overlay/widgets/raceconRc13.css'),
  'utf8'
)

/**
 * The stylesheet with its comments stripped. The comments deliberately NAME the forbidden bindings,
 * so every rule below is asserted against the declarations alone, never against the prose.
 */
const CSS_DECLARATIONS = CSS_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')

const WIDGET_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/overlay/widgets/RaceconRc13DashWidget.tsx'),
  'utf8'
)

const CORE_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/overlay/widgets/raceconRc13Core.ts'),
  'utf8'
)

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

function flags(overrides: Partial<Flags> = {}): Flags {
  return {
    green: false,
    yellow: false,
    blue: false,
    white: false,
    checkered: false,
    red: false,
    black: false,
    meatball: false,
    repair: false,
    disqualify: false,
    greenWhiteCheckered: false,
    ...overrides
  }
}

/**
 * The approved RC-13 reference state (attempt-002 governed 800x480,
 * `input/telemetry-frame-fcy-lap03.json`): lap 3 of a full-course caution, race control reporting
 * SC DEPLOYED behind a YELLOW flag, the driver seventh in the queue 2.4 s behind the car ahead at
 * 104 km/h, and NO stored best lap yet — so the lap delta is the packet's `--.---`. All three packet
 * section 15 alerts are ARMED and SILENT.
 */
function snapshot(overrides: Partial<TelemetrySnapshot> = {}, timestamp = 1_303_000): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp,
    sessionUniqueId: 13,
    currentLap: 3,
    gear: 3,
    rpm: 4_100,
    maxRpm: 7_800,
    speedKmh: 104,
    throttle: 0.22,
    brake: 0,
    clutch: 0,
    position: 7,
    paceMode: 'singleFileStart',
    raceControlState: 'known',
    flags: flags({ yellow: true }),
    relatives: { ahead: { carIdx: 9, name: 'Car Ahead', carNumber: '11', gapSec: 2.4 } },
    sessionType: 'Race',
    sessionState: 'racing',
    playerCarIdx: 4,
    ...overrides
  } as TelemetrySnapshot
}

function markup(value: TelemetrySnapshot | null, cfg = config): string {
  return renderToStaticMarkup(createElement(RaceconRc13DashWidget, { snapshot: value, config: cfg }))
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
  options: Parameters<typeof createRc13DashboardModel>[4] = {},
  receiptsAtMs = nowMs
): ReturnType<typeof createRc13DashboardModel> {
  const receipts = value ? createRc01ChannelReceipts(value, receiptsAtMs) : new Map()
  const aux = value ? createRc13AuxReceipts(value, receiptsAtMs) : new Map()
  return createRc13DashboardModel(value, receipts, aux, nowMs, options)
}

function alertInput(overrides: Partial<Rc13AlertInput> = {}): Rc13AlertInput {
  return {
    nowMs: 0,
    windowZone: null,
    restartState: 'scDeployed',
    gapAheadSec: null,
    gapClosingSec: null,
    speedKmh: 104,
    neutralised: true,
    ...overrides
  }
}

function right(rect: Rc13Rect): number {
  return rect.left + rect.width
}

function bottom(rect: Rc13Rect): number {
  return rect.top + rect.height
}

function allZones(zones: Rc13ZoneMap): Rc13Rect[] {
  return Object.values(zones).filter((rect): rect is Rc13Rect => Boolean(rect))
}

const BREAKPOINTS: readonly { width: number; height: number }[] = [
  { width: 800, height: 480 },
  { width: 1024, height: 600 },
  { width: 1920, height: 1080 },
  { width: 400, height: 800 },
  { width: 900, height: 400 },
  { width: 640, height: 520 }
]

/**
 * Comfortably past every time gate RC-13 owns: the 2 s restart-state and track-flag event budgets,
 * the 1 s queue-gap and position budgets and the 500 ms speed dash threshold.
 */
const PAST_EVERY_THRESHOLD_MS = 30_000

/**
 * Mounts RC-13 on a controllable monotonic clock and steps wall time and that clock together,
 * exactly as a real render observes them — the same harness shape the family-wide
 * `raceconDisplayClock.test.ts` uses, so the two guards cannot drift.
 */
function mountOnClock(preview: WidgetProps['preview']): { text: () => string; advance: (ms: number) => void } {
  vi.useFakeTimers()
  let monotonicMs = 0
  const monotonicClock: Rc01MonotonicClock = () => monotonicMs
  const view = render(
    createElement(RaceconRc13DashWidget, { snapshot: snapshot(), config, preview, monotonicClock })
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

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('RC-13 is registered in the catalog by the wiring PR', () => {
  it('is reachable from the shared registry and the preset table', () => {
    expect(Object.keys(WIDGET_COMPONENTS)).toContain(RC13_WIDGET_ID)
    const preset = OVERLAY_DASHBOARD_PRESETS.find((entry) => entry.id === RC13_PRESET_ID)
    expect(preset).toBeDefined()
    expect(preset?.widgetId).toBe(RC13_WIDGET_ID)
    expect(preset?.scaleMode).toBe('stretch')
  })

  it('names the widget id its own DOM already claims, so the wiring PR had one unambiguous target', () => {
    expect(markup(snapshot(), nativeConfig)).toContain(`data-widget="${RC13_WIDGET_ID}"`)
  })

  it('renders standalone, adding no shared-file change of its own', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('class="rc13-widget"')
    assertClean(html)
  })
})

describe('RC-13 packet omissions are contractual, not accidental', () => {
  it('records every contradiction resolved by omission or by a normative override', () => {
    expect(Object.keys(RC13_PACKET_OMISSIONS).sort()).toEqual([
      'cautionSignatureDelta',
      'deltaBestNoZone',
      'overtakeThresholds',
      'queueTrainChannel',
      'restartZoneChannel',
      'scDeltaChannel',
      'scWindowTargetChannel',
      'shiftLedZone',
      'statusHeaderTypeFit',
      'tertiaryChannelsNoZone',
      'windowViolationDebounce'
    ])
    for (const reason of Object.values(RC13_PACKET_OMISSIONS)) {
      expect(reason.length).toBeGreaterThan(40)
    }
  })

  it('measures the missing safety-car delta channel rather than asserting a comment', () => {
    for (const frame of [
      snapshot(),
      snapshot({ deltaToBestSec: -0.42, bestLapTimeSec: 94.1 }),
      snapshot({ speedKmh: 0 }),
      null
    ]) {
      expect(rc13ScDeltaSec(frame)).toBeNull()
    }
  })

  it('measures the missing legal-window bounds, so no zone can ever be declared legal', () => {
    for (const frame of [snapshot(), snapshot({ paceMode: 'singleFileRestart' }), null]) {
      expect(rc13ScWindowBoundsSec(frame)).toBeNull()
      expect(rc13WindowZoneForDelta(rc13ScDeltaSec(frame), rc13ScWindowBoundsSec(frame))).toBeNull()
    }
  })

  it('never mirrors the lap delta into the safety-car gauge', () => {
    const model = modelFor(snapshot({ deltaToBestSec: -1.75, bestLapTimeSec: 92.4 }))
    expect(model.deltaBest.value).toBe('-1.750')
    expect(model.scWindow.delta.value).toBe(RC13_DASH.scDelta)
    expect(model.scWindow.delta.unavailable).toBe(true)
    expect(model.scWindow.markerUnit).toBeNull()
    // Normative override N4 as source: the safety-car delta function has no body but `return null`,
    // so no edit can quietly wire the lap delta into the gauge without changing this assertion.
    expect(CORE_SOURCE).toMatch(
      /export function rc13ScDeltaSec\([^)]*\): number \| null \{\s*return null\s*\}/u
    )
    expect(CORE_SOURCE).toMatch(
      /export function rc13ScWindowBoundsSec\([^)]*\): Rc13WindowBounds \| null \{\s*return null\s*\}/u
    )
  })

  it('measures the missing restart-zone and queue-train channels', () => {
    for (const frame of [snapshot(), snapshot({ lapDistPct: 0.42, lapDistanceM: 1_800 }), null]) {
      expect(rc13RestartZoneLabel(frame)).toBeNull()
      expect(rc13QueueTrainRows(frame)).toHaveLength(0)
    }
  })

  it('gives the shift indicator no zone, no arc and no numeral anywhere in the frame', () => {
    for (const cfg of [nativeConfig, config]) {
      const html = markup(snapshot({ rpm: 7_600, maxRpm: 7_800 }), cfg)
      expect(html).not.toContain('rc13-led')
      expect(html).not.toContain('data-rc13-led')
      expect(html).not.toContain('SHIFT')
      expect(html).not.toContain('RPM')
      expect(html).not.toContain('7600')
      expect(html).not.toContain('7,600')
    }
    expect(CSS_DECLARATIONS).not.toContain('.rc13-led')
    expect(CSS_DECLARATIONS).not.toContain('.rc13-shift')
  })

  it('omits the tertiary channels entirely rather than proxying their freshness', () => {
    const model = modelFor(
      snapshot({
        waterTempC: 92,
        fuelLapsRemaining: 14,
        tyres: { lf: { tempC: 78 }, rf: { tempC: 80 }, lr: { tempC: 76 }, rr: { tempC: 77 } }
      })
    )
    expect(model).not.toHaveProperty('waterTemp')
    expect(model).not.toHaveProperty('tyres')
    expect(model).not.toHaveProperty('fuelLaps')
    expect(Object.keys(RC13_CHANNEL_STALE_MS)).not.toContain('waterTemp')
    const html = markup(
      snapshot({ waterTempC: 92, fuelLapsRemaining: 14 }),
      nativeConfig
    )
    expect(html).not.toContain('92')
    expect(html).not.toContain('WATER')
    expect(html).not.toContain('FUEL')
    expect(html).not.toContain('TYRE')
  })
})

describe('RC-13 packet zone geometry', () => {
  it('reproduces packet 11.1 verbatim rather than tracing the approved render', () => {
    expect(RC13_NATIVE_ZONES_PX).toEqual({
      status: { x: 16, y: 12, width: 768, height: 50 },
      window: { x: 16, y: 74, width: 500, height: 220 },
      queue: { x: 528, y: 74, width: 256, height: 220 },
      restart: { x: 16, y: 306, width: 768, height: 90 },
      pace: { x: 16, y: 404, width: 768, height: 60 }
    })
    // Image-QA defect R2: the approved render's header sits 8 px below its packet zone floor.
    expect(RC13_NATIVE_ZONES_PX.status?.y).toBe(12)
    expect(RC13_NATIVE_ZONES_PX.status?.y).not.toBe(20)
  })

  it('publishes the packet 11.1 origin and size percentages the brief tabulates', () => {
    const zones = rc13ZonesForLayout('native')
    expect(zones.status).toEqual({ left: 2, top: 2.5, width: 96, height: 10.416667 })
    expect(zones.window).toEqual({ left: 2, top: 15.416667, width: 62.5, height: 45.833333 })
    expect(zones.queue).toEqual({ left: 66, top: 15.416667, width: 32, height: 45.833333 })
    expect(zones.restart).toEqual({ left: 2, top: 63.75, width: 96, height: 18.75 })
    expect(zones.pace).toEqual({ left: 2, top: 84.166667, width: 96, height: 12.5 })
  })

  it('publishes packet 12.1 verbatim and takes the header edge to edge', () => {
    expect(RC13_APP_ZONES_PX).toEqual({
      status: { x: 0, y: 0, width: 1_024, height: 56 },
      window: { x: 24, y: 72, width: 600, height: 280 },
      queue: { x: 648, y: 72, width: 352, height: 280 },
      restart: { x: 24, y: 368, width: 976, height: 120 },
      pace: { x: 24, y: 500, width: 976, height: 72 }
    })
    const zones = rc13ZonesForLayout('app')
    expect(zones.status).toEqual({ left: 0, top: 0, width: 100, height: 9.333333 })
    expect(zones.window).toEqual({ left: 2.34375, top: 12, width: 58.59375, height: 46.666667 })
    expect(zones.queue).toEqual({ left: 63.28125, top: 12, width: 34.375, height: 46.666667 })
    expect(zones.restart).toEqual({ left: 2.34375, top: 61.333333, width: 95.3125, height: 20 })
    expect(zones.pace).toEqual({ left: 2.34375, top: 83.333333, width: 95.3125, height: 12 })
  })

  it('keeps the vertical gaps the brief records between the five stacked zones', () => {
    const stack = RC13_NATIVE_ZONES_PX
    expect(stack.window!.y - (stack.status!.y + stack.status!.height)).toBe(12)
    expect(stack.restart!.y - (stack.window!.y + stack.window!.height)).toBe(12)
    expect(stack.restart!.y - (stack.queue!.y + stack.queue!.height)).toBe(12)
    expect(stack.pace!.y - (stack.restart!.y + stack.restart!.height)).toBe(8)
  })

  it('keeps every zone inside the canvas and never overlaps two zones, at every breakpoint', () => {
    for (const box of BREAKPOINTS) {
      const layout = rc13LayoutForContentBox(box.width, box.height)
      const mode = rc13CompactModeForContentBox(box.width, box.height)
      const zones = rc13ZonesForLayout(layout, mode, box)
      const rects = allZones(zones)
      expect(rects).toHaveLength(RC13_ZONE_ORDER.length)
      for (const rect of rects) {
        expect(rect.left).toBeGreaterThanOrEqual(0)
        expect(rect.top).toBeGreaterThanOrEqual(0)
        expect(right(rect)).toBeLessThanOrEqual(100.001)
        expect(bottom(rect)).toBeLessThanOrEqual(100.001)
      }
      for (let a = 0; a < rects.length; a += 1) {
        for (let b = a + 1; b < rects.length; b += 1) {
          expect(rc13RectsOverlap(rects[a], rects[b])).toBe(false)
        }
      }
    }
  })

  it('keeps the procedure stack in reading order at every breakpoint', () => {
    for (const box of BREAKPOINTS) {
      const layout = rc13LayoutForContentBox(box.width, box.height)
      const mode = rc13CompactModeForContentBox(box.width, box.height)
      const zones = rc13ZonesForLayout(layout, mode, box)
      expect(zones.status!.top).toBeLessThan(zones.window!.top)
      expect(bottom(zones.window!)).toBeLessThanOrEqual(zones.restart!.top)
      expect(bottom(zones.restart!)).toBeLessThanOrEqual(zones.pace!.top)
    }
  })

  it('emits zone geometry as inline percentages without binary-float noise', () => {
    const zones = rc13ZonesForLayout('native')
    expect(rc13ZoneStyle(zones.window)).toEqual({
      left: '2%',
      top: '15.417%',
      width: '62.5%',
      height: '45.833%'
    })
    expect(rc13ZoneStyle(undefined)).toBeNull()
    expect(markup(snapshot(), nativeConfig)).not.toContain('0000000')
  })

  it('converts a packet pixel box to canvas percentages arithmetically', () => {
    expect(rc13RectPercent({ x: 16, y: 12, width: 768, height: 50 }, 800, 480)).toEqual({
      left: 2,
      top: 2.5,
      width: 96,
      height: 10.416667
    })
  })
})

describe('RC-13 type ladder is arithmetic', () => {
  it('sets the packet 11.2 ladder at 80 / 64 / 40 / 32 / 28 px and never from the render', () => {
    expect(RC13_TYPE_SCALE_PX).toEqual({
      windowDelta: 80,
      queueGap: 64,
      scStatus: 40,
      restart: 32,
      pace: 28
    })
    // Normative override N5 explicitly refuses the approved derivative's measured ladder.
    expect(Object.values(RC13_TYPE_SCALE_PX)).not.toContain(146.2)
    expect(Object.values(RC13_TYPE_SCALE_PX)).not.toContain(137.5)
  })

  it('asserts normative override N5: no two adjacent ranks equal, none reversed', () => {
    const ladder = RC13_TYPE_RANKS.map((rank) => RC13_TYPE_SCALE_PX[rank])
    for (let index = 1; index < ladder.length; index += 1) {
      expect(ladder[index]).toBeLessThan(ladder[index - 1])
    }
    expect(new Set(ladder).size).toBe(ladder.length)
  })

  it('expresses the ladder in container units so 1024x600 is the packet 1.28 step', () => {
    expect(RC13_CQW_PX).toBe(8)
    expect(RC13_APP_TYPE_SCALE).toBe(1.28)
    expect(rc13TypeScaleCqw(RC13_TYPE_SCALE_PX.windowDelta)).toBe(10)
    expect(rc13TypeScaleCqw(RC13_TYPE_SCALE_PX.queueGap)).toBe(8)
    expect(rc13TypeScaleCqw(RC13_TYPE_SCALE_PX.scStatus)).toBe(5)
    expect(rc13TypeScaleCqw(RC13_TYPE_SCALE_PX.restart)).toBe(4)
    expect(rc13TypeScaleCqw(RC13_TYPE_SCALE_PX.pace)).toBe(3.5)
    for (const rank of RC13_TYPE_RANKS) {
      const px = RC13_TYPE_SCALE_PX[rank]
      expect(rc13TypeScalePxForWidth(px, 800)).toBe(px)
      expect(rc13TypeScalePxForWidth(px, 1_024)).toBe(Math.round(px * RC13_APP_TYPE_SCALE * 1_000) / 1_000)
    }
  })

  it('binds every rung of the ladder from the model, never from a hard-coded stylesheet size', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('--rc13-type-window:10cqw')
    expect(html).toContain('--rc13-type-gap:8cqw')
    expect(html).toContain('--rc13-type-status:5cqw')
    expect(html).toContain('--rc13-type-restart:4cqw')
    expect(html).toContain('--rc13-type-pace:3.5cqw')
  })

  it('keeps every clamp bound the same multiple of its rung, so a clamp can never re-rank the ladder', () => {
    const clamps = [...CSS_DECLARATIONS.matchAll(/clamp\(\s*([\d.]+)px,\s*var\(--rc13-type-([a-z]+)[^)]*\)[^,]*,\s*([\d.]+)px\s*\)/gu)]
    expect(clamps.length).toBe(5)
    const seen = new Map<string, { floor: number; ceiling: number }>()
    for (const entry of clamps) {
      seen.set(entry[2], { floor: Number(entry[1]), ceiling: Number(entry[3]) })
    }
    const rungs: Record<string, number> = {
      window: RC13_TYPE_SCALE_PX.windowDelta,
      gap: RC13_TYPE_SCALE_PX.queueGap,
      status: RC13_TYPE_SCALE_PX.scStatus,
      restart: RC13_TYPE_SCALE_PX.restart,
      pace: RC13_TYPE_SCALE_PX.pace
    }
    for (const [name, px] of Object.entries(rungs)) {
      const bound = seen.get(name)
      expect(bound).toBeDefined()
      expect(bound!.floor).toBeCloseTo((px / RC13_CQW_PX) * 2, 6)
      expect(bound!.ceiling).toBeCloseTo((px / RC13_CQW_PX) * 15, 6)
    }
  })
})

describe('RC-13 colour contract', () => {
  it('binds the packet 11.3 tokens verbatim', () => {
    expect(RC13_TOKENS).toEqual({
      bg: '#0B0D0F',
      panel: '#17140D',
      primary: '#FFF6E6',
      secondary: '#A99C82',
      info: '#46B0E0',
      normal: '#46C46E',
      caution: '#FFC400',
      danger: '#FF3B30',
      signature: '#FFD100'
    })
    for (const [name, hex] of Object.entries(RC13_TOKENS)) {
      expect(CSS_DECLARATIONS.toLowerCase()).toContain(`--rc13-${name}: ${hex.toLowerCase()};`)
    }
    // Image-QA defect R1: the approved render's panel fill drifts to #11100A. The token wins.
    expect(CSS_DECLARATIONS.toLowerCase()).not.toContain('#11100a')
  })

  it('references every alert token only inside a state-scoped rule', () => {
    const scoped = (selector: string): boolean =>
      selector.includes('[data-rc13-alert=') || selector.includes("[data-rc13-window-zone-active='true']")
    let referenced = 0
    for (const rule of cssRules()) {
      for (const token of RC13_SILENT_TOKENS) {
        if (!rule.body.includes(`var(--rc13-${token})`)) continue
        referenced += 1
        expect(scoped(rule.selector)).toBe(true)
      }
    }
    expect(referenced).toBeGreaterThanOrEqual(RC13_SILENT_TOKENS.length)
  })

  it('never lets the signature token carry alert meaning, because it collides with caution', () => {
    expect(RC13_TOKEN_COLLISION.pair).toEqual(['caution', 'signature'])
    expect(RC13_TOKEN_COLLISION.deltaE00).toBeLessThan(RC13_TOKEN_COLLISION.perceptualFloor)
    for (const rule of cssRules()) {
      if (!rule.body.includes('var(--rc13-signature)')) continue
      expect(rule.selector).not.toContain('[data-rc13-alert=')
      expect(rule.selector).not.toContain('rc13-alert')
    }
  })

  it('renders zero alert-layer markup while every alert is silent', () => {
    for (const cfg of [nativeConfig, config]) {
      const html = markup(snapshot(), cfg)
      expect(html).toContain('data-rc13-alerts="silent"')
      expect(html).not.toContain('data-rc13-alert=')
      expect(html).not.toContain('class="rc13-alert"')
      expect(html).not.toContain('data-rc13-window-zone-active="true"')
    }
  })

  it('carries over / in / under by the WORD, not by hue', () => {
    expect(RC13_WINDOW_ZONE_WORDS).toEqual({ over: 'LIFT', in: 'IN WINDOW', under: 'CATCH UP' })
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('LIFT')
    expect(html).toContain('IN WINDOW')
    expect(html).toContain('CATCH UP')
  })
})

describe('RC-13 delta-window gauge geometry', () => {
  it('computes the three zones at 0-34 / 34-66 / 66-100 with word centres at 17 / 50 / 83', () => {
    expect(RC13_WINDOW_DIVIDER_UNIT).toEqual([34, 66])
    expect(RC13_WINDOW_WORD_CENTRE_UNIT).toEqual([17, 50, 83])
    const zones = rc13WindowZones()
    expect(zones.map((zone) => [zone.from, zone.to])).toEqual([
      [0, 34],
      [34, 66],
      [66, 100]
    ])
    expect(zones.map((zone) => zone.centre)).toEqual([17, 50, 83])
    for (const zone of zones) {
      expect(zone.centre).toBe((zone.from + zone.to) / 2)
    }
  })

  it('never adopts the approved render measured dividers or word centres', () => {
    expect(RC13_WINDOW_MEASURED.dividerUnit).toEqual([33.6, 67.19])
    expect(RC13_WINDOW_MEASURED.wordCentreUnit).toEqual([16.74, 51.24, 84.05])
    expect([...RC13_WINDOW_DIVIDER_UNIT]).not.toEqual([...RC13_WINDOW_MEASURED.dividerUnit])
    expect([...RC13_WINDOW_WORD_CENTRE_UNIT]).not.toEqual([...RC13_WINDOW_MEASURED.wordCentreUnit])
  })

  it('resolves the zone from a signed delta and its bounds, and null from either missing', () => {
    const bounds = { min: -1, max: 1 }
    expect(rc13WindowZoneForDelta(-2, bounds)).toBe('over')
    expect(rc13WindowZoneForDelta(0, bounds)).toBe('in')
    expect(rc13WindowZoneForDelta(-1, bounds)).toBe('in')
    expect(rc13WindowZoneForDelta(1, bounds)).toBe('in')
    expect(rc13WindowZoneForDelta(2, bounds)).toBe('under')
    expect(rc13WindowZoneForDelta(null, bounds)).toBeNull()
    expect(rc13WindowZoneForDelta(0, null)).toBeNull()
    expect(rc13WindowZoneForDelta(0, { min: 1, max: 1 })).toBeNull()
  })

  it('maps a delta onto the bar so each zone word centre is exactly one window width of violation', () => {
    const bounds = { min: -1, max: 1 }
    expect(rc13WindowMarkerUnit(-1, bounds)).toBe(34)
    expect(rc13WindowMarkerUnit(0, bounds)).toBe(50)
    expect(rc13WindowMarkerUnit(1, bounds)).toBe(66)
    expect(rc13WindowMarkerUnit(-2, bounds)).toBe(RC13_WINDOW_WORD_CENTRE_UNIT[0])
    expect(rc13WindowMarkerUnit(2, bounds)).toBe(RC13_WINDOW_WORD_CENTRE_UNIT[2])
    expect(rc13WindowMarkerUnit(-9, bounds)).toBe(0)
    expect(rc13WindowMarkerUnit(9, bounds)).toBe(100)
    expect(rc13WindowMarkerUnit(null, bounds)).toBeNull()
    expect(rc13WindowMarkerUnit(0, null)).toBeNull()
  })

  it('renders the bar structure with three bands, three words, no active band and no marker', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html.match(/data-testid="rc13-window-zone"/gu)).toHaveLength(3)
    expect(html.match(/data-testid="rc13-window-zone-word"/gu)).toHaveLength(3)
    expect(html).toContain('data-rc13-window-marker="none"')
    expect(html).not.toContain('data-testid="rc13-window-marker"')
    expect(html).toContain(RC13_NO_WINDOW_SOURCE)
    expect(html).toContain(`>${RC13_DASH.scDelta}<`)
  })
})

describe('RC-13 telemetry truth table', () => {
  it('reads every channel from its own declared source', () => {
    const frame = snapshot()
    expect(rc13AuxChannelValue(frame, 'restartState')).toBe('scDeployed')
    expect(rc13AuxChannelValue(frame, 'trackFlag')).toBe('yellow')
    expect(rc13AuxChannelValue(frame, 'speed')).toBe(104)
    expect(rc13AuxChannelValue(frame, 'rpm')).toBe(4_100)
  })

  it('carries the packet section 16 freshness budgets and defers the rest to RC-01', () => {
    expect(RC13_CHANNEL_STALE_MS).toEqual({ restartState: 2_000, trackFlag: 2_000, speed: 100, rpm: 20 })
    expect(RC13_SPEED_DASH_MS).toBe(500)
    // Position, gap ahead, delta and best lap already carry section 16's budgets in the shared layer.
    expect(RC01_CHANNEL_STALE_MS.position).toBe(1_000)
    expect(RC01_CHANNEL_STALE_MS.gapAhead).toBe(1_000)
    expect(RC01_CHANNEL_STALE_MS.delta).toBe(250)
    expect(RC01_CHANNEL_STALE_MS.bestLap).toBe(2_000)
    expect(Object.keys(RC13_CHANNEL_STALE_MS)).not.toContain('position')
    expect(Object.keys(RC13_CHANNEL_STALE_MS)).not.toContain('gapAhead')
  })

  it('reproduces the approved frame deterministically', () => {
    const model = modelFor(snapshot())
    expect(model.restart.value).toBe(RC13_RESTART_LABELS.scDeployed)
    expect(model.flag.value).toBe(RC13_FLAG_LABELS.yellow)
    expect(model.deltaBest.value).toBe(RC13_DASH.deltaBest)
    expect(model.gapAhead.value).toBe('2.4')
    expect(model.position.value).toBe('7')
    expect(model.speed.value).toBe('104')
    expect(model.scWindow.delta.value).toBe(RC13_DASH.scDelta)
    expect(model.activeAlerts).toEqual([])
  })

  it('derives the restart status from the race-control restart feed and nothing else', () => {
    expect(rc13RestartStateFromSnapshot(snapshot({ paceMode: 'singleFileRestart' }))).toBe('restartImminent')
    expect(rc13RestartStateFromSnapshot(snapshot({ paceMode: 'doubleFileRestart' }))).toBe('restartImminent')
    expect(rc13RestartStateFromSnapshot(snapshot({ paceMode: 'singleFileStart' }))).toBe('scDeployed')
    expect(rc13RestartStateFromSnapshot(snapshot({ paceMode: 'doubleFileStart' }))).toBe('scDeployed')
    expect(rc13RestartStateFromSnapshot(snapshot({ paceMode: 'notPacing' }))).toBe('green')
    // No feed at all, however much other race context exists.
    expect(
      rc13RestartStateFromSnapshot(
        snapshot({ paceMode: undefined, sessionState: 'racing', currentLap: 9, flags: flags({ green: true }) })
      )
    ).toBeNull()
  })

  it('shows UNKNOWN without a restart feed, and never assumes restart timing', () => {
    const model = modelFor(snapshot({ paceMode: undefined }))
    expect(model.restart.state).toBe('unknown')
    expect(model.restart.value).toBe(RC13_DASH.restart)
    expect(model.restart.unavailable).toBe(true)
    expect(model.neutralised).toBe(true)
    expect(model.muted).toBe(true)
  })

  it('degrades a restart feed that falls silent to UNKNOWN instead of freezing it on GREEN', () => {
    const frame = snapshot({ paceMode: 'notPacing' })
    expect(modelFor(frame).restart.value).toBe(RC13_RESTART_LABELS.green)
    const stale = modelFor(frame, RC13_CHANNEL_STALE_MS.restartState + 1, {}, 0)
    expect(stale.restart.value).toBe(RC13_DASH.restart)
    expect(stale.restart.stale).toBe(true)
    expect(stale.restart.state).toBe('unknown')
    expect(stale.muted).toBe(true)
  })

  it('never assumes green when the flag feed is missing or race control declares itself unknown', () => {
    expect(rc13TrackFlagFromSnapshot(snapshot({ flags: undefined }))).toBeNull()
    expect(rc13TrackFlagFromSnapshot(snapshot({ raceControlState: 'unknown' }))).toBeNull()
    for (const frame of [snapshot({ flags: undefined }), snapshot({ raceControlState: 'unknown' })]) {
      const model = modelFor(frame)
      expect(model.flag.value).toBe(RC13_DASH.flag)
      expect(model.flag.flag).toBeNull()
    }
    expect(rc13TrackFlagFromSnapshot(snapshot({ flags: flags() }))).toBe('none')
  })

  it('ranks the marshalling feed by severity and never mirrors one flag onto another', () => {
    expect(rc13TrackFlagFromSnapshot(snapshot({ flags: flags({ red: true, yellow: true }) }))).toBe('red')
    expect(rc13TrackFlagFromSnapshot(snapshot({ flags: flags({ yellow: true, green: true }) }))).toBe('yellow')
    expect(rc13TrackFlagFromSnapshot(snapshot({ flags: flags({ blue: true }) }))).toBe('blue')
    expect(rc13TrackFlagFromSnapshot(snapshot({ flags: flags({ green: true }) }))).toBe('green')
  })

  it('greys speed past its cadence and dashes it past the 500 ms budget', () => {
    const frame = snapshot()
    expect(modelFor(frame).speed.value).toBe('104')
    const grey = modelFor(frame, RC13_CHANNEL_STALE_MS.speed + 1, {}, 0)
    expect(grey.speed.value).toBe('104')
    expect(grey.speed.stale).toBe(true)
    const dashed = modelFor(frame, RC13_SPEED_DASH_MS + 1, {}, 0)
    expect(dashed.speed.value).toBe(RC13_DASH.speed)
    expect(dashed.speed.stale).toBe(true)
  })

  it('never estimates speed from RPM times a ratio', () => {
    const model = modelFor(snapshot({ speedKmh: undefined, rpm: 6_400, maxRpm: 7_800, gear: 4 }))
    expect(model.speed.value).toBe(RC13_DASH.speed)
    expect(model.speed.unavailable).toBe(true)
  })

  it('refuses a lap delta without a real reference lap and never extrapolates one', () => {
    expect(modelFor(snapshot({ deltaToBestSec: -0.4 })).deltaBest.value).toBe(RC13_DASH.deltaBest)
    expect(modelFor(snapshot({ bestLapTimeSec: 93.2 })).deltaBest.value).toBe(RC13_DASH.deltaBest)
    const both = modelFor(snapshot({ deltaToBestSec: 0.184, bestLapTimeSec: 93.2 }))
    expect(both.deltaBest.value).toBe('+0.184')
  })

  it('dashes the queue gap when the timing feed is absent and never estimates it from speed', () => {
    const model = modelFor(snapshot({ relatives: undefined, speedKmh: 180 }))
    expect(model.gapAhead.value).toBe(RC13_DASH.gapAhead)
    expect(model.gapAhead.unavailable).toBe(true)
    const stale = modelFor(snapshot(), RC01_CHANNEL_STALE_MS.gapAhead + 1, {}, 0)
    expect(stale.gapAhead.value).toBe(RC13_DASH.gapAhead)
    expect(stale.gapAhead.stale).toBe(true)
  })

  it('dashes the position when the timing feed is absent and never infers it from gaps', () => {
    const model = modelFor(
      snapshot({ position: undefined, relatives: { ahead: { carIdx: 9, name: 'a', carNumber: '11', gapSec: 2.4 } } })
    )
    expect(model.position.value).toBe(RC13_DASH.position)
    expect(model.position.unavailable).toBe(true)
    const stale = modelFor(snapshot(), RC01_CHANNEL_STALE_MS.position + 1, {}, 0)
    expect(stale.position.value).toBe(RC13_DASH.position)
  })

  it('formats every channel exactly as packet 16 declares its dash state', () => {
    expect(rc13FormatScDelta(null)).toBe('--.-')
    expect(rc13FormatScDelta(-0.4)).toBe('-0.4')
    expect(rc13FormatScDelta(0)).toBe('+0.0')
    expect(rc13FormatGapAhead(null)).toBe('--.-')
    expect(rc13FormatGapAhead(2.44)).toBe('2.4')
    expect(rc13FormatPosition(null)).toBe('--')
    expect(rc13FormatPosition(0)).toBe('--')
    expect(rc13FormatPosition(7)).toBe('7')
    expect(rc13FormatSpeed(null)).toBe('---')
    expect(rc13FormatSpeed(-1)).toBe('---')
    expect(rc13FormatSpeed(104.4)).toBe('104')
  })

  it('un-mutes the pace strip only on a CONFIRMED green', () => {
    expect(modelFor(snapshot({ paceMode: 'notPacing' })).muted).toBe(false)
    expect(modelFor(snapshot({ paceMode: 'singleFileRestart' })).muted).toBe(true)
    expect(modelFor(snapshot({ paceMode: undefined })).muted).toBe(true)
  })

  it('arms the section 13 re-arm controller only at a confirmed green with a fresh RPM', () => {
    expect(modelFor(snapshot({ paceMode: 'notPacing' })).shiftArmed).toBe(true)
    expect(modelFor(snapshot()).shiftArmed).toBe(false)
    expect(modelFor(snapshot({ paceMode: 'notPacing', maxRpm: undefined })).shiftArmed).toBe(false)
    const staleRpm = modelFor(snapshot({ paceMode: 'notPacing' }), RC13_CHANNEL_STALE_MS.rpm + 1, {}, 0)
    expect(staleRpm.shiftArmed).toBe(false)
  })

  it('writes an aux receipt only when the channel genuinely reports', () => {
    const buffer = new Rc13AuxBuffer()
    buffer.ingest(snapshot({ paceMode: undefined, flags: undefined }), 0)
    expect(buffer.receipts().has('restartState')).toBe(false)
    expect(buffer.receipts().has('trackFlag')).toBe(false)
    expect(buffer.receipts().has('speed')).toBe(true)
    buffer.ingest(snapshot(), 10)
    expect(buffer.receipts().get('restartState')?.value).toBe('scDeployed')
    buffer.reset()
    expect(buffer.receipts().size).toBe(0)
    const disconnected = new Rc13AuxBuffer()
    disconnected.ingest(snapshot({ connected: false }), 0)
    expect(disconnected.receipts().size).toBe(0)
  })
})

describe('RC-13 queue-gap observation', () => {
  it('records only readings the timing feed actually published', () => {
    const buffer = new Rc13QueueBuffer()
    buffer.ingest(snapshot(), 0)
    buffer.ingest(snapshot({ relatives: undefined }, 1_303_020), 20)
    buffer.ingest(snapshot({ relatives: { ahead: { carIdx: 9, name: 'a', carNumber: '11', gapSec: 2.1 } } }, 1_303_040), 40)
    expect(buffer.history().map((entry) => entry.gapSec)).toEqual([2.4, 2.1])
  })

  it('needs two bounding observations before it will call the queue closing', () => {
    expect(rc13GapClosingSec([])).toBeNull()
    expect(rc13GapClosingSec([{ gapSec: 2.4, receivedAt: 0 }])).toBeNull()
    expect(
      rc13GapClosingSec([
        { gapSec: 2.4, receivedAt: 0 },
        { gapSec: 2.4, receivedAt: 0 }
      ])
    ).toBeNull()
    expect(
      rc13GapClosingSec([
        { gapSec: 2.4, receivedAt: 0 },
        { gapSec: 2.0, receivedAt: 500 }
      ])
    ).toBe(0.4)
    expect(
      rc13GapClosingSec([
        { gapSec: 2.0, receivedAt: 0 },
        { gapSec: 2.4, receivedAt: 500 }
      ])
    ).toBe(-0.4)
  })

  it('drops observations older than its window and never grows without limit', () => {
    const buffer = new Rc13QueueBuffer()
    buffer.ingest(snapshot(), 0)
    buffer.ingest(snapshot({}, 1_303_100), RC13_GAP_HISTORY_MS + 1)
    expect(buffer.history()).toHaveLength(1)
    const long = new Rc13QueueBuffer()
    for (let index = 0; index < RC13_GAP_HISTORY_LIMIT + 40; index += 1) {
      long.ingest(snapshot({}, 1_303_000 + index), index * 2)
    }
    expect(long.history().length).toBeLessThanOrEqual(RC13_GAP_HISTORY_LIMIT)
  })

  it('refuses an out-of-order observation and clears on reset', () => {
    const buffer = new Rc13QueueBuffer()
    buffer.ingest(snapshot(), 100)
    buffer.ingest(snapshot({}, 1_303_050), 40)
    expect(buffer.history()).toHaveLength(1)
    buffer.reset()
    expect(buffer.history()).toHaveLength(0)
  })
})

describe('RC-13 trigger-only alerts', () => {
  it('starts silent on every alert', () => {
    const state = createRc13AlertState()
    expect(state.windowViolation.active).toBe(false)
    expect(state.restartImminent.active).toBe(false)
    expect(state.overtakeReminder.active).toBe(false)
    expect(rc13ActiveAlerts(state)).toEqual([])
  })

  it('resolves the packet 15 debounce contradiction to 500 ms engage and 1 s hysteresis', () => {
    expect(RC13_WINDOW_VIOLATION_ENGAGE_MS).toBe(500)
    expect(RC13_WINDOW_VIOLATION_HYSTERESIS_MS).toBe(1_000)
    expect(RC13_RESTART_MIN_VISIBLE_MS).toBe(2_000)
    expect(RC13_OVERTAKE_ENGAGE_MS).toBe(400)
  })

  it('engages the window violation only after its 500 ms debounce', () => {
    let state = createRc13AlertState()
    state = advanceRc13Alerts(state, alertInput({ nowMs: 0, windowZone: 'over' }))
    expect(state.windowViolation.active).toBe(false)
    state = advanceRc13Alerts(state, alertInput({ nowMs: 499, windowZone: 'over' }))
    expect(state.windowViolation.active).toBe(false)
    state = advanceRc13Alerts(state, alertInput({ nowMs: 500, windowZone: 'over' }))
    expect(state.windowViolation.active).toBe(true)
  })

  it('holds the violation through its 1 s hysteresis and clears only after it', () => {
    let state = createRc13AlertState()
    state = advanceRc13Alerts(state, alertInput({ nowMs: 0, windowZone: 'under' }))
    state = advanceRc13Alerts(state, alertInput({ nowMs: 500, windowZone: 'under' }))
    expect(state.windowViolation.active).toBe(true)
    state = advanceRc13Alerts(state, alertInput({ nowMs: 1_000, windowZone: 'in' }))
    expect(state.windowViolation.active).toBe(true)
    state = advanceRc13Alerts(state, alertInput({ nowMs: 1_999, windowZone: 'in' }))
    expect(state.windowViolation.active).toBe(true)
    state = advanceRc13Alerts(state, alertInput({ nowMs: 2_000, windowZone: 'in' }))
    expect(state.windowViolation.active).toBe(false)
  })

  it('restarts the hysteresis when the delta drifts back out of the window', () => {
    let state = createRc13AlertState()
    state = advanceRc13Alerts(state, alertInput({ nowMs: 0, windowZone: 'over' }))
    state = advanceRc13Alerts(state, alertInput({ nowMs: 500, windowZone: 'over' }))
    state = advanceRc13Alerts(state, alertInput({ nowMs: 900, windowZone: 'in' }))
    state = advanceRc13Alerts(state, alertInput({ nowMs: 1_000, windowZone: 'over' }))
    expect(state.windowViolation.recoverySinceMs).toBeNull()
    state = advanceRc13Alerts(state, alertInput({ nowMs: 1_900, windowZone: 'in' }))
    expect(state.windowViolation.active).toBe(true)
  })

  it('unlatches the violation the moment the window has no zone, and never assumes legal', () => {
    let state = createRc13AlertState()
    state = advanceRc13Alerts(state, alertInput({ nowMs: 0, windowZone: 'over' }))
    state = advanceRc13Alerts(state, alertInput({ nowMs: 500, windowZone: 'over' }))
    expect(state.windowViolation.active).toBe(true)
    state = advanceRc13Alerts(state, alertInput({ nowMs: 600, windowZone: null }))
    expect(state.windowViolation.active).toBe(false)
  })

  it('keeps the window violation permanently silent in the app, because its channels do not exist', () => {
    let state = createRc13AlertState()
    for (let nowMs = 0; nowMs <= 5_000; nowMs += 100) {
      const model = modelFor(snapshot({}, 1_303_000 + nowMs), nowMs)
      state = advanceRc13Alerts(state, rc13AlertInputForModel(model, nowMs))
      expect(state.windowViolation.active).toBe(false)
    }
  })

  it('engages the restart banner on the event and holds it for its 2 s minimum display', () => {
    let state = createRc13AlertState()
    state = advanceRc13Alerts(state, alertInput({ nowMs: 0, restartState: 'restartImminent' }))
    expect(state.restartImminent.active).toBe(true)
    expect(state.restartImminent.minimumVisibleUntilMs).toBe(RC13_RESTART_MIN_VISIBLE_MS)
    state = advanceRc13Alerts(state, alertInput({ nowMs: 100, restartState: 'green' }))
    expect(state.restartImminent.active).toBe(true)
    state = advanceRc13Alerts(state, alertInput({ nowMs: 1_999, restartState: 'green' }))
    expect(state.restartImminent.active).toBe(true)
    state = advanceRc13Alerts(state, alertInput({ nowMs: 2_000, restartState: 'green' }))
    expect(state.restartImminent.active).toBe(false)
  })

  it('clears the restart banner when the safety car is redeployed', () => {
    let state = createRc13AlertState()
    state = advanceRc13Alerts(state, alertInput({ nowMs: 0, restartState: 'restartImminent' }))
    state = advanceRc13Alerts(state, alertInput({ nowMs: 2_500, restartState: 'scDeployed' }))
    expect(state.restartImminent.active).toBe(false)
  })

  it('unlatches the restart banner outright when the restart feed goes missing', () => {
    let state = createRc13AlertState()
    state = advanceRc13Alerts(state, alertInput({ nowMs: 0, restartState: 'restartImminent' }))
    expect(state.restartImminent.active).toBe(true)
    state = advanceRc13Alerts(state, alertInput({ nowMs: 200, restartState: null }))
    expect(state.restartImminent.active).toBe(false)
  })

  it('declares the packet 15 overtake pattern as reviewable numbers rather than a vibe', () => {
    expect(RC13_OVERTAKE_GAP_ENTER_SEC).toBe(0.4)
    expect(RC13_OVERTAKE_GAP_EXIT_SEC).toBe(0.8)
    expect(RC13_OVERTAKE_MIN_CLOSING_SEC).toBe(0.05)
    expect(RC13_OVERTAKE_MIN_SPEED_KMH).toBe(40)
    expect(RC13_OVERTAKE_GAP_EXIT_SEC).toBeGreaterThan(RC13_OVERTAKE_GAP_ENTER_SEC)
  })

  it('engages the overtake reminder only after 400 ms of a genuinely closing queue', () => {
    const closing = { gapAheadSec: 0.3, gapClosingSec: 0.2, speedKmh: 70, neutralised: true }
    expect(rc13OvertakePatternActive(alertInput(closing))).toBe(true)
    let state = createRc13AlertState()
    state = advanceRc13Alerts(state, alertInput({ ...closing, nowMs: 0 }))
    expect(state.overtakeReminder.active).toBe(false)
    state = advanceRc13Alerts(state, alertInput({ ...closing, nowMs: 399 }))
    expect(state.overtakeReminder.active).toBe(false)
    state = advanceRc13Alerts(state, alertInput({ ...closing, nowMs: 400 }))
    expect(state.overtakeReminder.active).toBe(true)
  })

  it('clears the overtake reminder when the pattern normalises past its exit gap', () => {
    const closing = { gapAheadSec: 0.3, gapClosingSec: 0.2, speedKmh: 70, neutralised: true }
    let state = createRc13AlertState()
    state = advanceRc13Alerts(state, alertInput({ ...closing, nowMs: 0 }))
    state = advanceRc13Alerts(state, alertInput({ ...closing, nowMs: 400 }))
    expect(state.overtakeReminder.active).toBe(true)
    state = advanceRc13Alerts(state, alertInput({ ...closing, nowMs: 600, gapAheadSec: 0.5 }))
    expect(state.overtakeReminder.active).toBe(true)
    state = advanceRc13Alerts(state, alertInput({ ...closing, nowMs: 800, gapAheadSec: 0.9 }))
    expect(state.overtakeReminder.active).toBe(false)
  })

  it('never raises the overtake reminder without a gap feed, a closing trend, speed or a caution', () => {
    const base = { gapAheadSec: 0.3, gapClosingSec: 0.2, speedKmh: 70, neutralised: true }
    expect(rc13OvertakePatternActive(alertInput({ ...base, gapAheadSec: null }))).toBe(false)
    expect(rc13OvertakePatternActive(alertInput({ ...base, gapClosingSec: null }))).toBe(false)
    expect(rc13OvertakePatternActive(alertInput({ ...base, gapClosingSec: 0.01 }))).toBe(false)
    expect(rc13OvertakePatternActive(alertInput({ ...base, speedKmh: 10 }))).toBe(false)
    expect(rc13OvertakePatternActive(alertInput({ ...base, speedKmh: null }))).toBe(false)
    expect(rc13OvertakePatternActive(alertInput({ ...base, neutralised: false }))).toBe(false)
    expect(rc13OvertakePatternActive(alertInput({ ...base, gapAheadSec: 1.2 }))).toBe(false)
  })

  it('treats the pattern as normalised at green, so a restart never leaves a reminder latched', () => {
    const closing = { gapAheadSec: 0.3, gapClosingSec: 0.2, speedKmh: 70 }
    expect(rc13OvertakePatternNormalised(alertInput({ ...closing, neutralised: false }))).toBe(true)
    let state = createRc13AlertState()
    state = advanceRc13Alerts(state, alertInput({ ...closing, neutralised: true, nowMs: 0 }))
    state = advanceRc13Alerts(state, alertInput({ ...closing, neutralised: true, nowMs: 400 }))
    expect(state.overtakeReminder.active).toBe(true)
    state = advanceRc13Alerts(state, alertInput({ ...closing, neutralised: false, nowMs: 500 }))
    expect(state.overtakeReminder.active).toBe(false)
  })

  it('unlatches every alert whose published channel goes stale or missing', () => {
    const engaged = {
      windowViolation: { active: true, pendingSinceMs: null, recoverySinceMs: null },
      restartImminent: { active: true, minimumVisibleUntilMs: 10_000 },
      overtakeReminder: { active: true, pendingSinceMs: null }
    }
    const staleFeeds = clearInvalidRc13Alerts(engaged, modelFor(snapshot(), 4_000, {}, 0))
    expect(staleFeeds.windowViolation.active).toBe(false)
    expect(staleFeeds.restartImminent.active).toBe(false)
    expect(staleFeeds.overtakeReminder.active).toBe(false)
    const missing = clearInvalidRc13Alerts(engaged, modelFor(null))
    expect(rc13ActiveAlerts(missing)).toEqual([])
  })

  it('binds the alert inputs to what the model published, never to the raw snapshot', () => {
    const fresh = rc13AlertInputForModel(modelFor(snapshot()), 0, [
      { gapSec: 2.6, receivedAt: 0 },
      { gapSec: 2.4, receivedAt: 100 }
    ])
    expect(fresh.restartState).toBe('scDeployed')
    expect(fresh.gapAheadSec).toBe(2.4)
    expect(fresh.gapClosingSec).toBeCloseTo(0.2, 6)
    expect(fresh.speedKmh).toBe(104)
    expect(fresh.windowZone).toBeNull()
    const stale = rc13AlertInputForModel(modelFor(snapshot(), 4_000, {}, 0), 4_000, [])
    expect(stale.restartState).toBeNull()
    expect(stale.gapAheadSec).toBeNull()
    expect(stale.speedKmh).toBeNull()
  })

  it('gives every alert a visible surface at every breakpoint', () => {
    const engaged = {
      windowViolation: { active: true, pendingSinceMs: null, recoverySinceMs: null },
      restartImminent: { active: true, minimumVisibleUntilMs: 10_000 },
      overtakeReminder: { active: true, pendingSinceMs: null }
    }
    for (const box of BREAKPOINTS) {
      const layout = rc13LayoutForContentBox(box.width, box.height)
      const mode = rc13CompactModeForContentBox(box.width, box.height)
      const zones = rc13ZonesForLayout(layout, mode, box)
      // The three alert surfaces live in the header, the window gauge and the restart block, and all
      // three zones exist in every grammar.
      expect(zones.status).toBeDefined()
      expect(zones.window).toBeDefined()
      expect(zones.restart).toBeDefined()
    }
    const model = createRc13DashboardModel(snapshot(), createRc01ChannelReceipts(snapshot(), 0), createRc13AuxReceipts(snapshot(), 0), 0, {
      alerts: engaged
    })
    expect(model.activeAlerts).toEqual(['windowViolation', 'restartImminent', 'overtakeReminder'])
    for (const cfg of [nativeConfig, config]) {
      const html = renderToStaticMarkup(
        createElement(RaceconRc13DashWidget, { snapshot: snapshot(), config: cfg })
      )
      expect(html).toContain('data-rc13-alerts="silent"')
    }
    for (const label of Object.values(RC13_ALERT_LABELS)) {
      expect(label).toMatch(/^[A-Z ]+$/u)
    }
  })
})

describe('RC-13 layout resolution', () => {
  it('resolves the packet breakpoints', () => {
    expect(rc13LayoutForContentBox(800, 480)).toBe('native')
    expect(rc13LayoutForContentBox(799, 479)).toBe('native')
    expect(rc13LayoutForContentBox(1_024, 600)).toBe('app')
    expect(rc13LayoutForContentBox(1_920, 1_080)).toBe('app')
    expect(rc13LayoutForContentBox(640, 520)).toBe('compact')
    expect(rc13LayoutForContentBox(0, 0)).toBe('app')
    expect(rc13LayoutForContentBox(Number.NaN, 480)).toBe('app')
  })

  it('resolves the compact modes', () => {
    expect(rc13CompactModeForContentBox(400, 800)).toBe('phone')
    expect(rc13CompactModeForContentBox(900, 400)).toBe('landscape')
    expect(rc13CompactModeForContentBox(640, 520)).toBe('standard')
    expect(rc13CompactModeForContentBox(800, 480)).toBe('standard')
    expect(rc13PhoneGeometryForContentBox(400, 800)).toEqual({
      inset: 8,
      headerHeight: 40,
      labelHeight: 18,
      barHeight: 40
    })
    expect(rc13PhoneGeometryForContentBox(900, 400)).toBeNull()
  })

  it('expands rather than scales at 1024x600', () => {
    expect(RC13_EXPANSION_MODEL).toBe('queue-map-reveal')
    expect(RC13_APP_ONLY_MODULES).toEqual(['queueTrain', 'restartSketch'])
    const native = rc13ZonesForLayout('native')
    const app = rc13ZonesForLayout('app')
    // A uniform scale would keep every zone's percentage identical. The header alone proves it is not.
    expect(app.status).not.toEqual(native.status)
    expect(app.status!.left).toBe(0)
    expect(app.status!.width).toBe(100)
    const nativeHtml = markup(snapshot(), nativeConfig)
    const appHtml = markup(snapshot(), config)
    expect(nativeHtml).not.toContain('data-testid="rc13-train"')
    expect(nativeHtml).not.toContain('data-testid="rc13-restart-sketch"')
    expect(nativeHtml).not.toContain(RC13_NO_QUEUE_SOURCE)
    expect(appHtml).toContain('data-testid="rc13-train"')
    expect(appHtml).toContain('data-testid="rc13-restart-sketch"')
    expect(appHtml).toContain(RC13_NO_QUEUE_SOURCE)
    expect(appHtml).toContain('data-rc13-train-rows="0"')
  })
})

describe('RC-13 rendered DOM contract', () => {
  it('renders the widget marker, the layout attributes and every packet zone', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain(`data-widget="${RC13_WIDGET_ID}"`)
    expect(html).toContain('data-rc13-layout="native"')
    expect(html).toContain('data-rc13-native-size="800x480"')
    expect(html).toContain('data-rc13-buffer-state="accepted"')
    expect(html).toContain('data-rc13-restart="scDeployed"')
    expect(html).toContain('data-rc13-flag="yellow"')
    expect(html).toContain('data-rc13-window-zone="none"')
    expect(html).toContain('data-rc13-window-available="false"')
    expect(html).toContain('data-rc13-muted="true"')
    expect(html).toContain('data-rc13-shift-armed="false"')
    expect(html).toContain('data-rc13-content-width="800"')
    expect(html).toContain('data-rc13-content-height="480"')
    for (const zone of RC13_ZONE_ORDER) {
      expect(html).toContain(`data-rc13-zone="${zone}"`)
    }
    assertClean(html)
  })

  it('renders exactly one panel per packet zone', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html.match(/class="rc13-panel/gu)).toHaveLength(RC13_ZONE_ORDER.length)
  })

  it('renders no driver-DDU hero the packet forbids', () => {
    const html = markup(snapshot(), config)
    expect(html).not.toContain('GEAR')
    expect(html).not.toContain('rc13-led')
    expect(html).not.toContain('shift-bar')
  })

  it('publishes the honest empty state for every structure section 16 cannot feed', () => {
    const html = markup(snapshot(), config)
    expect(html).toContain(RC13_NO_WINDOW_SOURCE)
    expect(html).toContain(RC13_NO_RESTART_ZONE_SOURCE)
    expect(html).toContain(RC13_NO_QUEUE_SOURCE)
    expect(html).toContain('data-rc13-restart-zone-available="false"')
    expect(html).toContain('data-rc13-train-available="false"')
    expect(html).toContain('data-rc13-sketch-markers="0"')
  })

  it('renders a dash-only frame with no telemetry at all', () => {
    const html = markup(null, nativeConfig)
    expect(html).toContain(`>${RC13_DASH.restart}<`)
    expect(html).toContain(`>${RC13_DASH.flag}<`)
    expect(html).toContain(`>${RC13_DASH.scDelta}<`)
    expect(html).toContain(`>${RC13_DASH.deltaBest}<`)
    expect(html).toContain(`>${RC13_DASH.gapAhead}<`)
    expect(html).toContain(`>${RC13_DASH.position}<`)
    expect(html).toContain(`>${RC13_DASH.speed}<`)
    expect(html).toContain('data-rc13-alerts="silent"')
    expect(html).toContain('data-rc13-muted="true"')
    assertClean(html)
  })

  it('refuses mock and replay telemetry and raises no alert from it', () => {
    const mock = markup(snapshot({ sim: 'mock' }), nativeConfig)
    expect(mock).toContain('data-rc13-buffer-state="mock-telemetry"')
    expect(mock).toContain(`>${RC13_DASH.restart}<`)
    expect(mock).toContain('data-rc13-alerts="silent"')

    const replaySim = markup(snapshot({ sim: 'replay' }), nativeConfig)
    expect(replaySim).toContain('data-rc13-buffer-state="replay-telemetry"')

    const replayContext = markup(
      snapshot({ replayContext: { state: 'replay' } as TelemetrySnapshot['replayContext'] }),
      nativeConfig
    )
    expect(replayContext).toContain('data-rc13-buffer-state="replay-telemetry"')

    // `replayPlaying` is a raw provider field, not a refusal trigger.
    const playing = markup(snapshot({ replayPlaying: true }), nativeConfig)
    expect(playing).toContain('data-rc13-buffer-state="accepted"')
  })

  it('refuses a snapshot with no source identity', () => {
    const buffer = new Rc01LiveTelemetryBuffer()
    expect(buffer.ingest(snapshot({ sessionUniqueId: undefined }), 0).reason).toBe('missing-source-identity')
    expect(buffer.ingest(snapshot(), 0).reason).toBe('accepted')
  })

  it('exposes the compact mode attribute only in the compact layout', () => {
    expect(markup(snapshot(), nativeConfig)).not.toContain('data-rc13-compact-mode')
    expect(markup(snapshot(), config)).not.toContain('data-rc13-compact-mode')
    const compact = markup(snapshot(), { ...config, position: { x: 0, y: 0, width: 900, height: 400 } })
    expect(compact).toContain('data-rc13-compact-mode="landscape"')
  })

  it('renders cleanly at every breakpoint', () => {
    for (const box of BREAKPOINTS) {
      const html = markup(snapshot(), { ...config, position: { x: 0, y: 0, ...box } })
      assertClean(html)
      expect(html).toContain('class="rc13-widget"')
    }
  })

  it('describes the restart status, the flag and the window in words, never by hue', () => {
    const model = modelFor(snapshot())
    expect(rc13RestartDescription(model)).toBe('Restart status SC DEPLOYED')
    expect(rc13FlagDescription(model)).toBe('Track flag YELLOW')
    expect(rc13WindowDescription(model)).toBe(
      `Safety-car delta window unavailable, ${RC13_NO_WINDOW_SOURCE.toLowerCase()}`
    )
    const blind = modelFor(snapshot({ paceMode: undefined, flags: undefined }))
    expect(rc13RestartDescription(blind)).toBe('Restart status unavailable, no race-control feed')
    expect(rc13FlagDescription(blind)).toBe('Track flag no signal, race-control feed absent')
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('aria-label="Restart status SC DEPLOYED"')
    expect(html).toContain('aria-label="Track flag YELLOW"')
  })

  it('keeps a colour-free fingerprint that separates two compliance states', () => {
    const deployed = rc13PatternFingerprint(modelFor(snapshot()))
    const restarting = rc13PatternFingerprint(modelFor(snapshot({ paceMode: 'singleFileRestart' })))
    const blind = rc13PatternFingerprint(modelFor(snapshot({ paceMode: undefined, flags: undefined })))
    expect(deployed).not.toBe(restarting)
    expect(deployed).not.toBe(blind)
    expect(blind).toContain('restart:unknown')
    expect(blind).toContain('flag:no-signal')
    expect(deployed).toContain('window:none')
    expect(deployed).toContain('marker:none')
    expect(deployed).toContain('alerts:silent')
  })
})

describe('RC-13 sizing discipline', () => {
  it('measures its own box with getBoundingClientRect and never with scrollWidth', () => {
    expect(WIDGET_SOURCE).toContain('getBoundingClientRect()')
    expect(WIDGET_SOURCE).not.toContain('scrollWidth')
    expect(WIDGET_SOURCE).not.toContain('offsetWidth')
    expect(CORE_SOURCE).not.toContain('scrollWidth')
  })

  it('resolves its layout from the measured bounding rect, not from the configured size', () => {
    const rect = {
      width: 800,
      height: 480,
      top: 0,
      left: 0,
      right: 800,
      bottom: 480,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    try {
      // The config says 1024x600, which would resolve `app`. The measured rect says otherwise.
      const { container } = render(createElement(RaceconRc13DashWidget, { snapshot: snapshot(), config }))
      const root = container.querySelector('.rc13-widget')
      expect(root?.getAttribute('data-rc13-layout')).toBe('native')
      expect(root?.getAttribute('data-rc13-content-width')).toBe('800')
      expect(root?.getAttribute('data-rc13-content-height')).toBe('480')
    } finally {
      spy.mockRestore()
    }
  })

  it('sizes both heroes in the same container unit their zone width is expressed in', () => {
    expect(CSS_DECLARATIONS).toMatch(/\.rc13-window-delta\s*\{[^}]*var\(--rc13-type-window/u)
    expect(CSS_DECLARATIONS).toMatch(/\.rc13-queue-gap\s*\{[^}]*var\(--rc13-type-gap/u)
    expect(CSS_DECLARATIONS).not.toMatch(/font-size:\s*\d+px/u)
  })

  it('keeps every nowrap hero inside its packet zone at every breakpoint', () => {
    /**
     * `white-space: nowrap` defeats `overflow: hidden`, so containment cannot be proved by a
     * `scrollWidth` comparison — the trap the SOP records. It is proved arithmetically instead: both
     * heroes are sized in `cqw`, the same unit the zone widths resolve from, so the ratio of numeral
     * width to zone width is a CONSTANT and one calculation covers every canvas size. The advance
     * factor is a deliberately pessimistic 0.62 em per glyph for a condensed tabular face.
     */
    const advanceEm = 0.62
    const heroes = [
      { zone: 'window' as const, cqw: rc13TypeScaleCqw(RC13_TYPE_SCALE_PX.windowDelta), longest: '-88.8'.length },
      { zone: 'queue' as const, cqw: rc13TypeScaleCqw(RC13_TYPE_SCALE_PX.queueGap), longest: '88.8'.length }
    ]
    for (const box of BREAKPOINTS) {
      const layout = rc13LayoutForContentBox(box.width, box.height)
      const mode = rc13CompactModeForContentBox(box.width, box.height)
      const zones = rc13ZonesForLayout(layout, mode, box)
      for (const hero of heroes) {
        const zoneWidthPx = (zones[hero.zone]!.width / 100) * box.width
        const fontPx = (hero.cqw / 100) * box.width
        const heroWidthPx = fontPx * advanceEm * hero.longest
        // 1.6 cqw of padding on each side of the panel, matching the stylesheet.
        const usablePx = zoneWidthPx - 2 * ((1.6 / 100) * box.width)
        expect(heroWidthPx).toBeLessThan(usablePx)
      }
    }
  })
})

describe('RC-13 shares the RC-01 fail-closed ingest buffer', () => {
  it('does not fork the buffer, the receipts or the shared channels', () => {
    expect(CORE_SOURCE).toContain("from './raceconRc01Core'")
    expect(CORE_SOURCE).toContain('createRc01DashboardModel')
    expect(CORE_SOURCE).not.toContain('class Rc13LiveTelemetryBuffer')
    expect(CORE_SOURCE).not.toContain('sourceIdentity')
    expect(WIDGET_SOURCE).toContain('new Rc01LiveTelemetryBuffer()')
  })

  it('clears the aux receipts and the observed gap history when the source is refused', () => {
    const refused = markup(snapshot({ sim: 'mock' }), nativeConfig)
    expect(refused).toContain(`>${RC13_DASH.gapAhead}<`)
    expect(refused).toContain(`>${RC13_DASH.speed}<`)
    expect(refused).toContain(`>${RC13_DASH.restart}<`)
    expect(refused).toContain('data-rc13-alerts="silent"')
  })

  it('advances its receipt clock from arrivals, never from the display clock', () => {
    expect(WIDGET_SOURCE).toContain('const arrivalMs = useMemo(() => monotonicClock(), [monotonicClock, snapshot, snapshot?.timestamp])')
  })
})

/**
 * The family-wide preview-clock fix landed on `main` ahead of RC-13's core branch. RC-13 is now in
 * the enumeration inside `raceconDisplayClock.test.ts` — the wiring PR added `raceconRc13Dash` to
 * `OverlayWidgetId` and to that file's `RACECON_WIDGETS` roster — so the family contract is enforced
 * centrally. These local checks are kept because they are artifact-specific: they assert RC-13's own
 * source shape (no leftover interval) and its own packet-16 no-feed degradation, which the shared
 * roster test does not look at.
 */
describe('RC-13 shares the family display clock', () => {
  it('uses the shared hook and the shared freeze policy, with no local interval left behind', () => {
    expect(WIDGET_SOURCE).toContain(
      "import { raceconDisplayClockFrozen, useRaceconDisplayClock } from './raceconDisplayClock'"
    )
    expect(WIDGET_SOURCE).toContain(
      'const nowMs = useRaceconDisplayClock(monotonicClock, raceconDisplayClockFrozen(preview))'
    )
    expect(WIDGET_SOURCE).toMatch(/^\s*preview,$/mu)
    expect(WIDGET_SOURCE).not.toContain('setInterval')
    expect(WIDGET_SOURCE).not.toContain('clearInterval')
    expect(WIDGET_SOURCE).not.toContain('setNowMs')
  })

  it('obeys the family policy that any non-live render freezes', () => {
    expect(raceconDisplayClockFrozen(undefined)).toBe(false)
    expect(raceconDisplayClockFrozen('inert')).toBe(true)
  })

  it('never advances an inert preview past a time gate', () => {
    const { text, advance } = mountOnClock('inert')
    const mounted = text()
    expect(mounted).toContain(RC13_RESTART_LABELS.scDeployed)
    advance(PAST_EVERY_THRESHOLD_MS)
    expect(text()).toBe(mounted)
  }, 30_000)

  it('keeps the live display clock ticking so a real dashboard still ages its frame', () => {
    const { text, advance } = mountOnClock(undefined)
    const mounted = text()
    advance(PAST_EVERY_THRESHOLD_MS)
    const aged = text()
    expect(aged).not.toBe(mounted)
    // Every RC-13 channel degrades to its packet-16 no-feed state rather than freezing on a value
    // that would read as current under caution.
    expect(aged).toContain(RC13_DASH.restart)
    expect(aged).toContain(RC13_DASH.flag)
    expect(aged).toContain(RC13_DASH.speed)
    expect(aged).toContain(RC13_DASH.gapAhead)
    expect(aged).not.toContain(RC13_RESTART_LABELS.scDeployed)
  }, 30_000)
})
