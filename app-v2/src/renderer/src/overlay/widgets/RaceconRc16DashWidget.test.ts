// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOverlayStyle, type OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'
import {
  RACECON_DISPLAY_CLOCK_INTERVAL_MS,
  raceconDisplayClockFrozen
} from './raceconDisplayClock'
import {
  RC01_CHANNEL_STALE_MS,
  Rc01LiveTelemetryBuffer,
  type Rc01MonotonicClock,
  createRc01ChannelReceipts
} from './raceconRc01Core'
import { RaceconRc16DashWidget } from './RaceconRc16DashWidget'
import {
  RC16_ALERT_IDS,
  RC16_APP_DELTA_ZONE_PX,
  RC16_APP_ONLY_ZONES,
  RC16_APP_ZONES_PX,
  RC16_CHANNEL_STALE_MS,
  RC16_CONSISTENCY_DROP_MARGIN_S,
  RC16_CONSISTENCY_GATE_NOTICE,
  RC16_CONSISTENCY_MIN_LAPS,
  RC16_CUES,
  RC16_DASH,
  RC16_DISPERSION_FULL_SCALE_S,
  RC16_DISPLAY_NAME,
  RC16_FOCUS_AREAS,
  RC16_LABEL_PX,
  RC16_LAP_HISTORY_LIMIT,
  RC16_NATIVE_ZONES_PX,
  RC16_NO_CUE_NOTICE,
  RC16_NO_HISTORY_NOTICE,
  RC16_OVER_REV_ATTACK_MS,
  RC16_OVER_REV_ENTER_RATIO,
  RC16_OVER_REV_EXIT_RATIO,
  RC16_OVER_REV_RELEASE_MS,
  RC16_PACKET_FRESHNESS_MS,
  RC16_PACKET_OMISSIONS,
  RC16_PRESET_ID,
  RC16_RING_GUIDE_RADIUS_PCT,
  RC16_RING_MAX_MID_RADIUS_PCT,
  RC16_RING_MIN_MID_RADIUS_PCT,
  RC16_RING_MIN_SEPARATION_PX,
  RC16_RING_NOMINAL_MID_RADIUS_PCT,
  RC16_ROUGH_INPUT_ENTER_INDEX,
  RC16_ROUGH_INPUT_EXIT_INDEX,
  RC16_SMOOTHNESS_FULL_SCALE_PCT_PER_S,
  RC16_SMOOTHNESS_GATE_NOTICE,
  RC16_SMOOTHNESS_MIN_SAMPLES,
  RC16_TOKENS,
  RC16_TYPE_RANK_ORDER,
  RC16_TYPE_SCALE_PX,
  RC16_UNUSED_TOKENS,
  RC16_WIDGET_ID,
  RC16_ZONE_IDS,
  type Rc16AlertState,
  type Rc16LapRecord,
  type Rc16Layout,
  type Rc16Rect,
  type Rc16ZoneMap,
  Rc16CoachingBuffer,
  advanceRc16Alerts,
  clearInvalidRc16Alerts,
  createRc16AlertState,
  createRc16AuxReceipts,
  createRc16DashboardModel,
  rc16AlertFlags,
  rc16AlertInputForModel,
  rc16CompactModeForContentBox,
  rc16ConsistencyHistory,
  rc16DispersionSec,
  rc16FormatDelta,
  rc16FormatDispersion,
  rc16FormatLapTime,
  rc16FormatSmoothness,
  rc16LapCounter,
  rc16LayoutForContentBox,
  rc16NextFocusArea,
  rc16PatternFingerprint,
  rc16RingGeometry,
  rc16RingMidRadiusPct,
  rc16RingViewBoxRadius,
  rc16SelectCue,
  rc16SmoothnessIndex,
  rc16TypeScaleCqw,
  rc16TypeScalePxForWidth,
  rc16ZonesForLayout
} from './raceconRc16Core'

const config: OverlayWidgetConfig = {
  // The `raceconRc16Dash` member of `OverlayWidgetId` is added by the separate catalog wiring PR,
  // so this branch names the canonical id through the core constant instead of widening the shared
  // union from here.
  id: RC16_WIDGET_ID as unknown as OverlayWidgetConfig['id'],
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
 * The stylesheet is read as TEXT, not as a loaded module, because four of RC-16's guarantees are
 * properties of the source itself: `normal` and `danger` may never be referenced at all, `caution`
 * may only be referenced inside an engaged-cue rule, and every hero must be sized with a capped
 * `clamp()`. Vitest's root is `app-v2`.
 */
const CSS_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/overlay/widgets/raceconRc16.css'),
  'utf8'
)

/**
 * The stylesheet with its comments stripped. The comments deliberately NAME the forbidden bindings,
 * so every rule below is asserted against the declarations alone, never against the prose.
 */
const CSS_DECLARATIONS = CSS_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')

const CORE_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/overlay/widgets/raceconRc16Core.ts'),
  'utf8'
)

const WIDGET_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/overlay/widgets/RaceconRc16DashWidget.tsx'),
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

/**
 * The approved RC-16 reference state (attempt-002 governed 800x480,
 * `input/telemetry-frame-coaching-lap6.json`): lap 6 in progress of a GT track-day coaching practice
 * run with five laps completed and timed, consistency band 0.42 s, throttle smoothness index 82,
 * delta to best -0.28 s and last lap 1:42.318. All three packet section 15 alerts are ARMED and
 * SILENT.
 */
function snapshot(overrides: Partial<TelemetrySnapshot> = {}, timestamp = 1_606_000): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp,
    sessionUniqueId: 61,
    currentLap: 6,
    completedLaps: 5,
    gear: 3,
    rpm: 6_800,
    maxRpm: 7_400,
    speedKmh: 138,
    throttle: 0.5,
    brake: 0,
    clutch: 0,
    deltaToBestSec: -0.28,
    bestLapTimeSec: 102.04,
    lastLapTimeSec: 102.318,
    sessionType: 'Practice',
    sessionState: 'racing',
    playerCarIdx: 6,
    ...overrides
  } as TelemetrySnapshot
}

function markup(value: TelemetrySnapshot | null, cfg = config): string {
  return renderToStaticMarkup(createElement(RaceconRc16DashWidget, { snapshot: value, config: cfg }))
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
  options: Parameters<typeof createRc16DashboardModel>[4] = {},
  receiptsAtMs = nowMs
): ReturnType<typeof createRc16DashboardModel> {
  const receipts = value ? createRc01ChannelReceipts(value, receiptsAtMs) : new Map()
  const aux = value ? createRc16AuxReceipts(value, receiptsAtMs) : new Map()
  return createRc16DashboardModel(value, receipts, aux, nowMs, options)
}

function lapRecord(overrides: Partial<Rc16LapRecord> = {}): Rc16LapRecord {
  return { lap: 1, lapTimeSec: 102.1, smoothnessIndex: 82, receivedAt: 0, ...overrides }
}

/**
 * The pedal step that produces a target smoothness index at a 50 ms cadence, derived from the
 * declared scale rather than tuned by hand: mean rate = |dThrottle| * 100 / 0.05 s = 2000 |dThrottle|,
 * and index = 100 (1 - rate / RC16_SMOOTHNESS_FULL_SCALE_PCT_PER_S).
 */
function pedalStepForIndex(index: number): number {
  return ((100 - index) / 100) * (RC16_SMOOTHNESS_FULL_SCALE_PCT_PER_S / 2_000)
}

const LAP_FRAMES = 12
const FRAME_STEP_MS = 50

/** Drive one lap's worth of frames into the coaching buffer and return the next clock value. */
function driveLap(
  buffer: Rc16CoachingBuffer,
  lap: number,
  clock: number,
  options: { index?: number; throttleGapAt?: number; frames?: number } = {}
): number {
  const frames = options.frames ?? LAP_FRAMES
  const step = options.index === undefined ? 0 : pedalStepForIndex(options.index)
  let at = clock
  for (let i = 0; i < frames; i += 1) {
    const throttle = options.throttleGapAt === i ? undefined : 0.5 + (i % 2 === 0 ? step : 0)
    buffer.ingest(
      snapshot({ currentLap: lap, throttle } as Partial<TelemetrySnapshot>, 1_600_000 + at),
      at
    )
    at += FRAME_STEP_MS
  }
  return at
}

/** Close the lap in progress by advancing the lap counter and publishing its laptrigger time. */
function closeLap(buffer: Rc16CoachingBuffer, nextLap: number, clock: number, lastLapTimeSec: number): number {
  buffer.ingest(
    snapshot({ currentLap: nextLap, lastLapTimeSec } as Partial<TelemetrySnapshot>, 1_600_000 + clock),
    clock
  )
  return clock + FRAME_STEP_MS
}

/**
 * The approved reference ledger: mounted mid-lap on lap 3, then three genuinely observed laps whose
 * times span exactly 0.42 s and whose last measured smoothness is 82.
 */
function referenceBuffer(): { buffer: Rc16CoachingBuffer; clock: number } {
  const buffer = new Rc16CoachingBuffer()
  let clock = driveLap(buffer, 3, 0, { index: 82 })
  clock = closeLap(buffer, 4, clock, 102.1)
  clock = driveLap(buffer, 4, clock, { index: 82 })
  clock = closeLap(buffer, 5, clock, 102.52)
  clock = driveLap(buffer, 5, clock, { index: 82 })
  clock = closeLap(buffer, 6, clock, 102.318)
  return { buffer, clock }
}

function right(rect: Rc16Rect): number {
  return rect.left + rect.width
}

function bottom(rect: Rc16Rect): number {
  return rect.top + rect.height
}

function allZones(zones: Rc16ZoneMap): { id: string; rect: Rc16Rect }[] {
  return RC16_ZONE_IDS.flatMap((id) => {
    const rect = zones[id]
    return rect ? [{ id, rect }] : []
  })
}

const BREAKPOINTS: readonly { width: number; height: number }[] = [
  { width: 800, height: 480 },
  { width: 1024, height: 600 },
  { width: 1920, height: 1080 },
  { width: 400, height: 800 },
  { width: 900, height: 400 },
  { width: 640, height: 520 }
]

/** Comfortably past every time gate RC-16 owns: the delta receipt at 250 ms and last lap at 2 s. */
const PAST_EVERY_RC16_THRESHOLD_MS = 30_000

/**
 * Mounts RC-16 on a controllable monotonic clock and steps wall time and that clock together,
 * exactly as a real render observes them: the display interval fires several times per step and
 * re-reads the clock, so the widget sees elapsed time rather than one unexplained jump. Mirrors the
 * family-wide guard in `raceconDisplayClock.test.ts`.
 */
function mountLive(preview: WidgetProps['preview']): { text: () => string; advance: (ms: number) => void } {
  vi.useFakeTimers()
  let monotonicMs = 0
  const monotonicClock: Rc01MonotonicClock = () => monotonicMs
  const view = render(
    createElement(RaceconRc16DashWidget, { snapshot: snapshot(), config, preview, monotonicClock })
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

describe('RC-16 core-only delivery publishes the literals the wiring PR needs', () => {
  it('names the canonical widget id, preset id and display name in one place', () => {
    expect(RC16_WIDGET_ID).toBe('raceconRc16Dash')
    expect(RC16_PRESET_ID).toBe('racecon_rc16_dash')
    // Packet section 1 title is authoritative; the bare alias "Learn Lines" is not a title.
    expect(RC16_DISPLAY_NAME).toBe('RaceCon RC-16 Learn Lines - Novice Coaching & Consistency')
    expect(RC16_DISPLAY_NAME).toContain('Novice Coaching & Consistency')
    expect(markup(snapshot(), nativeConfig)).toContain(`data-widget="${RC16_WIDGET_ID}"`)
  })

  it('leaves every shared registration file to the wiring PR', () => {
    // Registration is intentionally absent from this branch: nothing here reaches into the
    // OverlayWidgetId union, the preset registry, the widget registry or the identity catalog.
    expect(CORE_SOURCE).not.toContain('OVERLAY_DASHBOARD_PRESETS')
    expect(CORE_SOURCE).not.toContain('WIDGET_COMPONENTS')
    expect(WIDGET_SOURCE).not.toContain('OVERLAY_DASHBOARD_PRESETS')
    expect(WIDGET_SOURCE).not.toContain('WIDGET_COMPONENTS')
  })
})

describe('RC-16 packet omissions are contractual, not accidental', () => {
  it('records every contradiction resolved by omission or by a normative override', () => {
    expect(Object.keys(RC16_PACKET_OMISSIONS).sort()).toEqual(
      [
        'brakeSmoothness',
        'consistencyHistoryDepth',
        'consistencyRecap',
        'cornerSpeedAndGearZone',
        'cueCornerId',
        'dangerToken',
        'deltaAppZone',
        'deltaRowHeight',
        'focusSelectorZone',
        'labelTypeRank',
        'normalToken',
        'shiftLightZone',
        'smoothnessIndexScale',
        'speedRpmBestLapZone',
        'typeScaleStep'
      ].sort()
    )
    for (const rationale of Object.values(RC16_PACKET_OMISSIONS)) {
      expect(rationale.length).toBeGreaterThan(40)
    }
  })

  it('draws no shift-light arc and no over-rev LED, because neither canvas gives one a zone', () => {
    expect(RC16_ZONE_IDS).not.toContain('shift')
    expect(Object.keys(RC16_NATIVE_ZONES_PX)).not.toContain('shift')
    expect(Object.keys(RC16_APP_ZONES_PX)).not.toContain('shift')
    const html = markup(snapshot({ rpm: 7_390 } as Partial<TelemetrySnapshot>), nativeConfig)
    expect(html).not.toContain('rc16-led')
    expect(html).not.toContain('data-rc16-zone="shift"')
    // The Engine RPM numeral has no zone either (ZG-3), so it is never printed.
    expect(html).not.toContain('7390')
    expect(html).not.toContain('6800')
  })

  it('prints no gear, speed, minimum-corner-speed or best-lap numeral anywhere', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).not.toContain('138')
    expect(html).not.toContain('1:42.040')
    expect(html).not.toContain('data-rc16-zone="gear"')
    expect(html).not.toContain('data-rc16-zone="speed"')
    expect(RC16_PACKET_OMISSIONS.cornerSpeedAndGearZone).toContain('Minimum corner speed')
    expect(RC16_PACKET_OMISSIONS.speedRpmBestLapZone).toContain('Best lap')
  })

  it('never names a corner in a cue, because section 16 defines no corner channel', () => {
    for (const cue of Object.values(RC16_CUES)) {
      for (const line of cue.lines) {
        expect(line).not.toMatch(/\bT\d+\b/)
        expect(line).not.toMatch(/\b(TURN|CORNER|SECTOR)\b/)
      }
    }
    expect(RC16_CUES.consistencyBraking.lines).toEqual(['BRAKE', 'EARLIER'])
  })

  it('keeps the consistency history out of the 800x480 grammar entirely', () => {
    expect(RC16_APP_ONLY_ZONES).toEqual(['history'])
    expect(RC16_NATIVE_ZONES_PX.history).toBeUndefined()
    expect(RC16_APP_ZONES_PX.history).toBeDefined()
    expect(markup(snapshot(), nativeConfig)).not.toContain('data-rc16-zone="history"')
    expect(markup(snapshot(), config)).toContain('data-rc16-zone="history"')
    for (const box of [
      { width: 400, height: 800 },
      { width: 900, height: 400 },
      { width: 640, height: 520 }
    ]) {
      const html = markup(snapshot(), { ...config, position: { x: 0, y: 0, ...box } })
      expect(html).not.toContain('data-rc16-zone="history"')
    }
  })

  it('keeps the focus-area selector off-screen rather than inventing a zone for it', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('data-testid="rc16-focus-selector"')
    const rule = cssRules().find((entry) => entry.selector.includes('.rc16-focus-selector'))
    expect(rule?.body).toContain('clip-path: inset(50%)')
    expect(rule?.body).toContain('width: 1px')
    expect(RC16_ZONE_IDS).not.toContain('focus')
  })
})

describe('RC-16 packet zone geometry', () => {
  it('reproduces packet 11.1 verbatim rather than tracing the approved render', () => {
    expect(RC16_NATIVE_ZONES_PX).toEqual({
      ring: { x: 270, y: 50, width: 260, height: 260 },
      smoothness: { x: 40, y: 80, width: 200, height: 200 },
      cue: { x: 560, y: 80, width: 200, height: 200 },
      delta: { x: 300, y: 320, width: 200, height: 60 },
      summary: { x: 40, y: 320, width: 240, height: 120 }
    })
  })

  it('publishes the packet 11.1 origin and size percentages the brief tabulates', () => {
    const zones = rc16ZonesForLayout('native')
    const round2 = (value: number): number => Math.round(value * 100) / 100
    expect(round2(zones.ring!.left)).toBe(33.75)
    expect(round2(zones.ring!.top)).toBe(10.42)
    expect(round2(right(zones.ring!))).toBe(66.25)
    expect(round2(bottom(zones.ring!))).toBe(64.58)
    expect(round2(zones.smoothness!.left)).toBe(5)
    expect(round2(right(zones.smoothness!))).toBe(30)
    expect(round2(zones.cue!.left)).toBe(70)
    expect(round2(right(zones.cue!))).toBe(95)
    expect(round2(zones.delta!.top)).toBe(66.67)
    expect(round2(bottom(zones.delta!))).toBe(79.17)
    expect(round2(bottom(zones.summary!))).toBe(91.67)
  })

  it('reproduces packet 12.1 verbatim and publishes the Delta zone the packet omits', () => {
    expect(RC16_APP_ZONES_PX.ring).toEqual({ x: 372, y: 60, width: 300, height: 300 })
    expect(RC16_APP_ZONES_PX.smoothness).toEqual({ x: 48, y: 80, width: 260, height: 300 })
    expect(RC16_APP_ZONES_PX.cue).toEqual({ x: 716, y: 80, width: 260, height: 300 })
    expect(RC16_APP_ZONES_PX.history).toEqual({ x: 372, y: 380, width: 300, height: 180 })
    expect(RC16_APP_ZONES_PX.summary).toEqual({ x: 48, y: 400, width: 260, height: 160 })
    // OV-2 / ZG-4: Delta is a section 10 PRIMARY channel and must not vanish as the view grows.
    expect(RC16_APP_ZONES_PX.delta).toEqual(RC16_APP_DELTA_ZONE_PX)
    expect(RC16_APP_DELTA_ZONE_PX).toEqual({ x: 716, y: 400, width: 260, height: 160 })
    expect(RC16_PACKET_OMISSIONS.deltaAppZone).toContain('x=716 y=400 w=260 h=160')
  })

  it('gives the app Delta zone at least the row height OV-7 requires', () => {
    expect(RC16_APP_DELTA_ZONE_PX.height).toBeGreaterThanOrEqual(80)
    expect(RC16_NATIVE_ZONES_PX.delta!.height).toBe(60)
    // The native zone keeps the packet's 60 px, so its row is inline instead of stacked.
    const rule = cssRules().find((entry) => entry.selector.trim() === '.rc16-delta')
    expect(rule?.body).toContain('flex-direction: row')
  })

  it('keeps every zone inside its canvas and never overlaps two zones, at every breakpoint', () => {
    for (const box of BREAKPOINTS) {
      const layout = rc16LayoutForContentBox(box.width, box.height)
      const zones = rc16ZonesForLayout(layout, rc16CompactModeForContentBox(box.width, box.height), box)
      const rects = allZones(zones)
      expect(rects.length).toBeGreaterThanOrEqual(5)
      for (const { id, rect } of rects) {
        expect(rect.left, `${id} left at ${box.width}x${box.height}`).toBeGreaterThanOrEqual(0)
        expect(rect.top, `${id} top at ${box.width}x${box.height}`).toBeGreaterThanOrEqual(0)
        expect(right(rect), `${id} right at ${box.width}x${box.height}`).toBeLessThanOrEqual(100.001)
        expect(bottom(rect), `${id} bottom at ${box.width}x${box.height}`).toBeLessThanOrEqual(100.001)
      }
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const overlap =
            rects[i].rect.left < right(rects[j].rect) &&
            rects[j].rect.left < right(rects[i].rect) &&
            rects[i].rect.top < bottom(rects[j].rect) &&
            rects[j].rect.top < bottom(rects[i].rect)
          expect(
            overlap,
            `${rects[i].id} overlaps ${rects[j].id} at ${box.width}x${box.height}`
          ).toBe(false)
        }
      }
    }
  })

  it('emits zone geometry as inline percentages without binary-float noise', () => {
    const html = markup(snapshot(), nativeConfig)
    const percentages = [...html.matchAll(/(?:left|top|width|height):\s*([-\d.]+)%/g)].map((match) => match[1])
    expect(percentages.length).toBeGreaterThan(0)
    for (const value of percentages) {
      expect(value).not.toMatch(/\.\d{4,}/)
    }
  })
})

describe('RC-16 consistency ring is the encoded quantity', () => {
  it('holds the brief geometry: one centre, a guide circle, a mint band and an inner disc', () => {
    const ring = rc16RingGeometry(0.42)
    expect(ring.centreXPct).toBe(50)
    expect(ring.centreYPct).toBe(37.5)
    expect(ring.guideRadiusPct).toBe(15)
    expect(ring.discRadiusPct).toBe(10.5)
    expect(ring.strokePct).toBe(1.5)
    expect(ring.available).toBe(true)
  })

  it('reproduces the packet nominal 12.00 % mid radius at the approved 0.42 s band', () => {
    const ring = rc16RingGeometry(0.42)
    expect(ring.midRadiusPct).toBeCloseTo(RC16_RING_NOMINAL_MID_RADIUS_PCT, 1)
    // The brief measures an 18 px radial gap at the nominal radius.
    expect(ring.gapPx).toBeCloseTo(18, 0)
  })

  it('can never let the encoded quantity collapse against the guide circle', () => {
    for (const dispersion of [0, 0.42, 1, RC16_DISPERSION_FULL_SCALE_S, 12, 900]) {
      const ring = rc16RingGeometry(dispersion)
      expect(ring.outerRadiusPct!).toBeLessThanOrEqual(RC16_RING_GUIDE_RADIUS_PCT)
      expect(ring.gapPx!).toBeGreaterThanOrEqual(RC16_RING_MIN_SEPARATION_PX - 1e-6)
    }
    const widest = rc16RingGeometry(RC16_DISPERSION_FULL_SCALE_S * 10)
    expect(widest.midRadiusPct).toBe(RC16_RING_MAX_MID_RADIUS_PCT)
    expect(widest.gapPx).toBeCloseTo(RC16_RING_MIN_SEPARATION_PX, 6)
  })

  it('keeps the mint band clear of the inner disc at its tightest', () => {
    const tightest = rc16RingGeometry(0)
    expect(tightest.midRadiusPct).toBe(RC16_RING_MIN_MID_RADIUS_PCT)
    expect(tightest.innerRadiusPct!).toBeGreaterThan(10.5)
  })

  it('tightens as consistency improves and widens as it degrades', () => {
    const tight = rc16RingGeometry(0.1)
    const loose = rc16RingGeometry(0.9)
    expect(loose.midRadiusPct!).toBeGreaterThan(tight.midRadiusPct!)
    // Packet 11.1: the smaller the radial gap, the wider the dispersion.
    expect(loose.gapPct!).toBeLessThan(tight.gapPct!)
    expect(rc16RingMidRadiusPct(0.3)!).toBeLessThan(rc16RingMidRadiusPct(0.6)!)
  })

  it('renders no mint band at all before the >= 3-lap gate opens', () => {
    const ring = rc16RingGeometry(null)
    expect(ring.available).toBe(false)
    expect(ring.midRadiusPct).toBeNull()
    expect(ring.gapPx).toBeNull()
    // The structure still renders — the guide circle and the disc are not the value.
    expect(ring.guideRadiusPct).toBe(15)
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('data-rc16-ring-available="false"')
    expect(html).not.toContain('data-testid="rc16-ring-band"')
    expect(html).toContain('data-testid="rc16-ring-guide"')
    expect(html).toContain('data-testid="rc16-ring-disc"')
  })

  it('draws true circles by rescaling canvas-width percentages into the ring zone', () => {
    // 15 % of 800 px is 120 px in a 260 px zone, which is 46.154 viewBox units from a centre of 50.
    expect(rc16RingViewBoxRadius(RC16_RING_GUIDE_RADIUS_PCT)).toBeCloseTo(46.154, 3)
    expect(rc16RingViewBoxRadius(10.5)).toBeCloseTo(32.308, 3)
    expect(rc16RingViewBoxRadius(RC16_RING_GUIDE_RADIUS_PCT)).toBeLessThan(50)
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"')
  })
})

describe('RC-16 type ladder is arithmetic', () => {
  it('sets the packet 11.2 ladder at 56 / 44 / 40 / 34 / 28 px and never from the render', () => {
    expect(RC16_TYPE_SCALE_PX).toEqual({ ringValue: 56, delta: 44, smoothness: 40, cue: 34, summary: 28 })
    const ordered = RC16_TYPE_RANK_ORDER.map((rank) => RC16_TYPE_SCALE_PX[rank])
    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i], `rank ${RC16_TYPE_RANK_ORDER[i]}`).toBeLessThan(ordered[i - 1])
    }
    expect(RC16_PACKET_OMISSIONS.typeScaleStep).toContain('2.88 px')
  })

  it('keeps every label smaller than every value it labels, at one shared size', () => {
    expect(RC16_LABEL_PX).toBeLessThan(Math.min(...Object.values(RC16_TYPE_SCALE_PX)))
    const labelRules = cssRules().filter((rule) => rule.body.includes('--rc16-type-label'))
    expect(labelRules.length).toBeGreaterThan(0)
    for (const rule of labelRules) {
      expect(rule.body).toContain('2.25cqw')
    }
  })

  it('expresses the ladder in container units so 1024x600 is a uniform 1.28 step', () => {
    expect(rc16TypeScaleCqw(56)).toBe(7)
    expect(rc16TypeScaleCqw(44)).toBe(5.5)
    expect(rc16TypeScaleCqw(40)).toBe(5)
    expect(rc16TypeScaleCqw(34)).toBe(4.25)
    expect(rc16TypeScaleCqw(28)).toBe(3.5)
    for (const rank of RC16_TYPE_RANK_ORDER) {
      const px = RC16_TYPE_SCALE_PX[rank]
      expect(rc16TypeScalePxForWidth(px, 800)).toBeCloseTo(px, 3)
      expect(rc16TypeScalePxForWidth(px, 1_024)).toBeCloseTo(px * 1.28, 3)
    }
  })

  it('caps every hero with a conservative clamp so it cannot escape its zone', () => {
    const heroes = ['.rc16-ring-value', '.rc16-smoothness-value', '.rc16-delta-value', '.rc16-cue-line']
    for (const selector of heroes) {
      const rule = cssRules().find((entry) => entry.selector.trim() === selector)
      expect(rule, selector).toBeDefined()
      expect(rule!.body, selector).toMatch(/font-size:\s*clamp\(/)
      expect(rule!.body, selector).toContain('overflow: hidden')
    }
    // The sizing trap: no hero may be `white-space: nowrap` inside a shared flex row.
    for (const selector of heroes) {
      const rule = cssRules().find((entry) => entry.selector.trim() === selector)
      expect(rule!.body, selector).not.toContain('white-space: nowrap')
    }
    for (const selector of ['.rc16-delta-value', '.rc16-smoothness-value', '.rc16-summary-value']) {
      const rule = cssRules().find((entry) => entry.selector.trim() === selector)
      expect(rule!.body, selector).toContain('min-width: 0')
    }
  })
})

describe('RC-16 colour contract', () => {
  it('binds the packet 11.3 tokens verbatim', () => {
    expect(RC16_TOKENS).toEqual({
      bg: '#0A0E0D',
      panel: '#131C1A',
      primary: '#EAF3F0',
      secondary: '#8AA39C',
      info: '#48C0C8',
      normal: '#46D08A',
      caution: '#F0C23C',
      danger: '#F0603E',
      signature: '#7AE0B0'
    })
    const root = cssRules().find((rule) => rule.selector.trim() === '.rc16-widget')
    expect(root).toBeDefined()
    for (const [name, hex] of Object.entries(RC16_TOKENS)) {
      expect(root!.body.toLowerCase(), name).toContain(`--rc16-${name}: ${hex.toLowerCase()}`)
    }
  })

  it('never references the two tokens the packet defects make unusable', () => {
    expect(RC16_UNUSED_TOKENS).toEqual(['normal', 'danger'])
    for (const token of RC16_UNUSED_TOKENS) {
      expect(CSS_DECLARATIONS, token).not.toContain(`var(--rc16-${token})`)
    }
    expect(RC16_PACKET_OMISSIONS.normalToken).toContain('2.19 degrees')
    expect(RC16_PACKET_OMISSIONS.dangerToken).toContain('no harsh critical state')
  })

  it('references the caution token only from the engaged cue card', () => {
    const referencing = cssRules().filter((rule) => rule.body.includes('var(--rc16-caution)'))
    expect(referencing.length).toBeGreaterThan(0)
    for (const rule of referencing) {
      expect(rule.selector).toContain('.rc16-cue.is-alert')
    }
  })

  it('measures zero alert-layer markup while every alert is silent', () => {
    const { buffer, clock } = referenceBuffer()
    const model = createRc16DashboardModel(
      snapshot(),
      createRc01ChannelReceipts(snapshot(), clock),
      buffer.receipts(),
      clock,
      { laps: buffer.laps() }
    )
    expect(model.alertsSilent).toBe(true)
    expect(model.cue.alert).toBe(false)
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('data-rc16-alerts="silent"')
    expect(html).toContain('data-rc16-cue-alert="false"')
    expect(html).not.toContain('is-alert')
  })

  it('uses signature for the ring and info for the smoothness fill, never the same hue for both', () => {
    const band = cssRules().find((rule) => rule.selector.trim() === '.rc16-ring-band')
    const fill = cssRules().find((rule) => rule.selector.trim() === '.rc16-smoothness-fill')
    expect(band?.body).toContain('var(--rc16-signature)')
    expect(fill?.body).toContain('var(--rc16-info)')
    expect(band?.body).not.toContain('var(--rc16-info)')
  })
})

describe('RC-16 telemetry truth table', () => {
  it('carries the packet section 16 freshness budgets verbatim', () => {
    expect(RC16_PACKET_FRESHNESS_MS).toEqual({
      gear: 50,
      speed: 100,
      speedStale: 500,
      rpm: 20,
      rpmStale: 200,
      delta: 250,
      bestLap: 2_000,
      lastLap: 2_000
    })
    // Every budget with a bound surface or trigger is the SHARED RC-01 budget, never a fork.
    expect(RC16_PACKET_FRESHNESS_MS.rpmStale).toBe(RC01_CHANNEL_STALE_MS.rpm)
    expect(RC16_PACKET_FRESHNESS_MS.delta).toBe(RC01_CHANNEL_STALE_MS.delta)
    expect(RC16_PACKET_FRESHNESS_MS.bestLap).toBe(RC01_CHANNEL_STALE_MS.bestLap)
    expect(RC16_CHANNEL_STALE_MS.lastLap).toBe(RC16_PACKET_FRESHNESS_MS.lastLap)
  })

  it('reproduces the approved reference frame deterministically', () => {
    const { buffer, clock } = referenceBuffer()
    const model = createRc16DashboardModel(
      snapshot(),
      createRc01ChannelReceipts(snapshot(), clock),
      buffer.receipts(),
      clock,
      { laps: buffer.laps() }
    )
    expect(model.consistency.value).toBe('0.42')
    expect(model.smoothness.value).toBe('82')
    expect(model.smoothnessFillPct).toBe(82)
    expect(model.delta.value).toBe('-0.28')
    expect(model.lastLap.value).toBe('1:42.318')
    expect(model.ring.midRadiusPct).toBeCloseTo(12, 1)
    expect(model.lapCount).toBe(3)
  })

  it('dashes the consistency band until three laps have genuinely been observed', () => {
    expect(rc16DispersionSec([])).toBeNull()
    expect(rc16DispersionSec([lapRecord({ lap: 1 }), lapRecord({ lap: 2 })])).toBeNull()
    const three = [
      lapRecord({ lap: 1, lapTimeSec: 102.1 }),
      lapRecord({ lap: 2, lapTimeSec: 102.52 }),
      lapRecord({ lap: 3, lapTimeSec: 102.318 })
    ]
    expect(rc16DispersionSec(three)).toBeCloseTo(0.42, 3)
    expect(RC16_CONSISTENCY_MIN_LAPS).toBe(3)

    const gated = modelFor(snapshot(), 0, { laps: three.slice(0, 2) })
    expect(gated.consistency.value).toBe(RC16_DASH.consistency)
    expect(gated.consistency.unavailable).toBe(true)
    expect(gated.ring.available).toBe(false)
    expect(markup(snapshot(), nativeConfig)).toContain(RC16_CONSISTENCY_GATE_NOTICE)
  })

  it('dashes throttle smoothness until a full lap has been measured', () => {
    const partial = modelFor(snapshot(), 0, { laps: [lapRecord({ smoothnessIndex: null })] })
    expect(partial.smoothness.value).toBe(RC16_DASH.smoothness)
    expect(partial.smoothness.unavailable).toBe(true)
    expect(partial.smoothnessFillPct).toBe(0)
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain(RC16_SMOOTHNESS_GATE_NOTICE)
    expect(html).toContain('data-rc16-smoothness-available="false"')
  })

  it('never lets the smoothness bar disagree with the smoothness numeral', () => {
    for (const index of [0, 17, 50, 82, 100]) {
      const model = modelFor(snapshot(), 0, { laps: [lapRecord({ smoothnessIndex: index })] })
      expect(model.smoothnessFillPct).toBe(index)
      expect(model.smoothness.value).toBe(String(index))
    }
  })

  it('refuses a delta without a real stored best lap, and never extrapolates one', () => {
    const noBest = modelFor(
      snapshot({ bestLapTimeSec: undefined, deltaToBestSec: undefined } as Partial<TelemetrySnapshot>)
    )
    expect(noBest.delta.value).toBe(RC16_DASH.delta)
    expect(noBest.delta.unavailable).toBe(true)

    const noDelta = modelFor(snapshot({ deltaToBestSec: undefined } as Partial<TelemetrySnapshot>))
    expect(noDelta.delta.value).toBe(RC16_DASH.delta)

    const stale = modelFor(snapshot(), RC01_CHANNEL_STALE_MS.delta + 50, {}, 0)
    expect(stale.delta.unavailable).toBe(true)
    expect(stale.delta.value).toBe(RC16_DASH.delta)
  })

  it('standardises the delta on two decimals so its placeholder matches its value width', () => {
    expect(RC16_DASH.delta).toBe('--.--')
    expect(rc16FormatDelta(-0.28)).toBe('-0.28')
    expect(rc16FormatDelta(0.4)).toBe('+0.40')
    expect(rc16FormatDelta(null)).toBe('--.--')
    expect(rc16FormatDelta(-0.28).length).toBe(RC16_DASH.delta.length)
    expect(RC16_PACKET_OMISSIONS.deltaRowHeight).toContain('two decimals')
  })

  it('never traffic-lights the delta, whatever its sign', () => {
    const gaining = modelFor(snapshot({ deltaToBestSec: -0.9 } as Partial<TelemetrySnapshot>))
    const losing = modelFor(snapshot({ deltaToBestSec: 0.9 } as Partial<TelemetrySnapshot>))
    expect(gaining.delta.tone).toBe('primary')
    expect(losing.delta.tone).toBe('primary')
    expect(gaining.delta.value.startsWith('-')).toBe(true)
    expect(losing.delta.value.startsWith('+')).toBe(true)
  })

  it('dashes the last lap until a lap completes and degrades it visibly when it goes stale', () => {
    const empty = modelFor(
      snapshot({ lastLapTimeSec: undefined } as Partial<TelemetrySnapshot>)
    )
    expect(empty.lastLap.value).toBe(RC16_DASH.lapTime)
    expect(empty.lastLap.unavailable).toBe(true)

    const fresh = modelFor(snapshot())
    expect(fresh.lastLap.value).toBe('1:42.318')
    expect(fresh.lastLap.stale).toBe(false)

    const stale = modelFor(snapshot(), RC16_CHANNEL_STALE_MS.lastLap + 100, {}, 0)
    expect(stale.lastLap.stale).toBe(true)
    expect(stale.lastLap.value).toBe('1:42.318')
    expect(stale.lastLap.tone).toBe('muted')
  })

  it('formats lap times as mm:ss.mmm and dashes an impossible one', () => {
    expect(rc16FormatLapTime(102.318)).toBe('1:42.318')
    expect(rc16FormatLapTime(59.999)).toBe('0:59.999')
    expect(rc16FormatLapTime(0)).toBe(RC16_DASH.lapTime)
    expect(rc16FormatLapTime(null)).toBe(RC16_DASH.lapTime)
    expect(rc16FormatDispersion(null)).toBe(RC16_DASH.consistency)
    expect(rc16FormatSmoothness(null)).toBe(RC16_DASH.smoothness)
  })

  it('prints the consistency band from ONE bound field so the two surfaces cannot diverge', () => {
    const { buffer, clock } = referenceBuffer()
    const model = createRc16DashboardModel(
      snapshot(),
      createRc01ChannelReceipts(snapshot(), clock),
      buffer.receipts(),
      clock,
      { laps: buffer.laps() }
    )
    const recap = model.summaryRows.find((row) => row.id === 'consistency')!
    expect(recap.value).toBe(model.consistency)
    expect(recap.value.value).toBe(model.consistency.value)
    expect(RC16_PACKET_OMISSIONS.consistencyRecap).toContain('never diverge')
  })

  it('reads the lap counter only from a genuine lap channel', () => {
    expect(rc16LapCounter(snapshot())).toBe(6)
    expect(rc16LapCounter(snapshot({ currentLap: undefined } as Partial<TelemetrySnapshot>))).toBe(5)
    expect(
      rc16LapCounter(
        snapshot({ currentLap: undefined, completedLaps: undefined } as Partial<TelemetrySnapshot>)
      )
    ).toBeNull()
    expect(rc16LapCounter(null)).toBeNull()
    expect(CORE_SOURCE).not.toContain('lapDistPct')
  })

  it('declares the smoothness scale the packet omits, and applies it arithmetically', () => {
    expect(RC16_SMOOTHNESS_FULL_SCALE_PCT_PER_S).toBe(200)
    expect(rc16SmoothnessIndex(0)).toBe(100)
    expect(rc16SmoothnessIndex(36)).toBe(82)
    expect(rc16SmoothnessIndex(200)).toBe(0)
    expect(rc16SmoothnessIndex(9_999)).toBe(0)
    expect(rc16SmoothnessIndex(null)).toBeNull()
    expect(RC16_PACKET_OMISSIONS.smoothnessIndexScale).toContain('no formula')
  })
})

describe('RC-16 lap ledger is observed, never inherited', () => {
  it('never records the lap that was already in progress when the widget mounted', () => {
    const buffer = new Rc16CoachingBuffer()
    driveLap(buffer, 3, 0, { index: 90 })
    expect(buffer.laps()).toHaveLength(0)
    expect(buffer.observedWholeLap()).toBe(false)
  })

  it('records a lap only on an observed lap-counter advance, with the laptrigger time', () => {
    const buffer = new Rc16CoachingBuffer()
    let clock = driveLap(buffer, 3, 0, { index: 90 })
    clock = closeLap(buffer, 4, clock, 102.1)
    expect(buffer.laps()).toHaveLength(1)
    expect(buffer.laps()[0].lap).toBe(3)
    expect(buffer.laps()[0].lapTimeSec).toBe(102.1)
    // Mounted mid-lap, so this lap's smoothness was measured on partial data and is withheld.
    expect(buffer.laps()[0].smoothnessIndex).toBeNull()
    expect(buffer.observedWholeLap()).toBe(true)
  })

  it('publishes smoothness only for a lap observed from its first frame', () => {
    const buffer = new Rc16CoachingBuffer()
    let clock = driveLap(buffer, 3, 0, { index: 82 })
    clock = closeLap(buffer, 4, clock, 102.1)
    clock = driveLap(buffer, 4, clock, { index: 82 })
    closeLap(buffer, 5, clock, 102.52)
    expect(buffer.laps()[1].smoothnessIndex).toBe(82)
  })

  it('withholds smoothness for a lap whose throttle channel gapped', () => {
    const buffer = new Rc16CoachingBuffer()
    let clock = driveLap(buffer, 3, 0, { index: 82 })
    clock = closeLap(buffer, 4, clock, 102.1)
    clock = driveLap(buffer, 4, clock, { index: 82, throttleGapAt: 5 })
    closeLap(buffer, 5, clock, 102.52)
    expect(buffer.laps()[1].smoothnessIndex).toBeNull()
  })

  it('withholds smoothness for a lap with too few pedal samples to grade', () => {
    const buffer = new Rc16CoachingBuffer()
    let clock = driveLap(buffer, 3, 0, { index: 82 })
    clock = closeLap(buffer, 4, clock, 102.1)
    clock = driveLap(buffer, 4, clock, { index: 82, frames: RC16_SMOOTHNESS_MIN_SAMPLES - 2 })
    closeLap(buffer, 5, clock, 102.52)
    expect(buffer.laps()[1].smoothnessIndex).toBeNull()
  })

  it('never records a lap at all when the provider publishes no lap counter', () => {
    const buffer = new Rc16CoachingBuffer()
    for (let i = 0; i < 40; i += 1) {
      buffer.ingest(
        snapshot({ currentLap: undefined, completedLaps: undefined } as Partial<TelemetrySnapshot>, 1_600_000 + i * 50),
        i * 50
      )
    }
    expect(buffer.laps()).toHaveLength(0)
    expect(rc16DispersionSec(buffer.laps())).toBeNull()
  })

  it('never records a lap the laptrigger did not time', () => {
    const buffer = new Rc16CoachingBuffer()
    let clock = driveLap(buffer, 3, 0, { index: 82 })
    buffer.ingest(
      snapshot({ currentLap: 4, lastLapTimeSec: undefined } as Partial<TelemetrySnapshot>, 1_600_000 + clock),
      clock
    )
    expect(buffer.laps()).toHaveLength(0)
  })

  it('bounds the ledger at the published retention depth', () => {
    const buffer = new Rc16CoachingBuffer()
    let clock = 0
    for (let lap = 1; lap <= RC16_LAP_HISTORY_LIMIT + 6; lap += 1) {
      clock = driveLap(buffer, lap, clock, { index: 90, frames: 3 })
      clock = closeLap(buffer, lap + 1, clock, 102 + (lap % 3) * 0.1)
    }
    expect(buffer.laps()).toHaveLength(RC16_LAP_HISTORY_LIMIT)
  })

  it('drops the whole ledger when the shared buffer refuses the source', () => {
    const { buffer } = referenceBuffer()
    expect(buffer.laps().length).toBeGreaterThan(0)
    buffer.reset()
    expect(buffer.laps()).toHaveLength(0)
    expect(buffer.observedWholeLap()).toBe(false)
    expect(buffer.currentLap()).toBeNull()
  })

  it('clones without sharing state, so a StrictMode double render cannot advance the ledger', () => {
    const { buffer, clock } = referenceBuffer()
    const candidate = buffer.clone()
    closeLap(candidate, 7, clock, 102.44)
    expect(buffer.laps()).toHaveLength(3)
    expect(candidate.laps()).toHaveLength(4)
  })
})

describe('RC-16 consistency window and app-only history', () => {
  it('measures dispersion across the trailing three laps only', () => {
    const laps = [
      lapRecord({ lap: 1, lapTimeSec: 100 }),
      lapRecord({ lap: 2, lapTimeSec: 105 }),
      lapRecord({ lap: 3, lapTimeSec: 102.1 }),
      lapRecord({ lap: 4, lapTimeSec: 102.52 }),
      lapRecord({ lap: 5, lapTimeSec: 102.318 })
    ]
    expect(rc16DispersionSec(laps)).toBeCloseTo(0.42, 3)
    expect(rc16DispersionSec(laps, 2)).toBeCloseTo(5, 3)
  })

  it('gives every history point the same >= 3-lap gate the ring has', () => {
    const laps = [
      lapRecord({ lap: 1, lapTimeSec: 102.1 }),
      lapRecord({ lap: 2, lapTimeSec: 102.3 }),
      lapRecord({ lap: 3, lapTimeSec: 102.2 }),
      lapRecord({ lap: 4, lapTimeSec: 102.5 })
    ]
    const history = rc16ConsistencyHistory(laps)
    expect(history).toHaveLength(4)
    expect(history[0].available).toBe(false)
    expect(history[1].available).toBe(false)
    expect(history[2].available).toBe(true)
    expect(history[3].available).toBe(true)
  })

  it('draws a lap it never observed as a gap and never interpolates across it', () => {
    const laps = [
      lapRecord({ lap: 1, lapTimeSec: 102.1 }),
      lapRecord({ lap: 2, lapTimeSec: 102.3 }),
      lapRecord({ lap: 3, lapTimeSec: 102.2 }),
      lapRecord({ lap: 6, lapTimeSec: 102.5 })
    ]
    const history = rc16ConsistencyHistory(laps)
    expect(history.map((point) => point.lap)).toEqual([1, 2, 3, 4, 5, 6])
    expect(history[3].gap).toBe(true)
    expect(history[4].gap).toBe(true)
    expect(history[3].dispersionSec).toBeNull()
    expect(history[5].gap).toBe(false)
    expect(RC16_PACKET_OMISSIONS.consistencyHistoryDepth).toContain('never interpolated')
  })

  it('publishes no history at all before any lap exists', () => {
    expect(rc16ConsistencyHistory([])).toHaveLength(0)
    const model = modelFor(snapshot(), 0, { includeHistory: true })
    expect(model.history).toHaveLength(0)
    expect(model.historyAvailable).toBe(false)
    expect(model.historyNotice).toBe(RC16_NO_HISTORY_NOTICE)
    expect(markup(snapshot(), config)).toContain(RC16_NO_HISTORY_NOTICE)
  })

  it('builds the history only for the app grammar', () => {
    const laps = [
      lapRecord({ lap: 1, lapTimeSec: 102.1 }),
      lapRecord({ lap: 2, lapTimeSec: 102.3 }),
      lapRecord({ lap: 3, lapTimeSec: 102.2 })
    ]
    expect(modelFor(snapshot(), 0, { laps, includeHistory: false }).history).toHaveLength(0)
    expect(modelFor(snapshot(), 0, { laps, includeHistory: true }).history).toHaveLength(3)
  })
})

describe('RC-16 trigger-only alerts', () => {
  it('starts silent on every alert', () => {
    const state = createRc16AlertState()
    const flags = rc16AlertFlags(state)
    expect(RC16_ALERT_IDS).toEqual(['consistencyDrop', 'roughInput', 'gentleOverRev'])
    for (const id of RC16_ALERT_IDS) {
      expect(flags[id], id).toBe(false)
    }
  })

  it('engages the consistency drop only on a lap boundary and only past its margin', () => {
    const base = { nowMs: 0, smoothnessIndex: 90, rpmRatio: 0.5, rpmFresh: true }
    let state = advanceRc16Alerts(createRc16AlertState(), { ...base, lapCount: 3, dispersionSec: 0.4 })
    expect(state.consistencyDrop.active).toBe(false)

    // Same lap count: the per-lap debounce refuses to re-evaluate mid-lap.
    state = advanceRc16Alerts(state, { ...base, lapCount: 3, dispersionSec: 9 })
    expect(state.consistencyDrop.active).toBe(false)

    // Inside the margin on a new lap: still silent.
    state = advanceRc16Alerts(state, {
      ...base,
      lapCount: 4,
      dispersionSec: 0.4 + RC16_CONSISTENCY_DROP_MARGIN_S - 0.01
    })
    expect(state.consistencyDrop.active).toBe(false)

    state = advanceRc16Alerts(state, { ...base, lapCount: 5, dispersionSec: 1.2 })
    expect(state.consistencyDrop.active).toBe(true)
  })

  it('clears the consistency drop as soon as the band tightens again', () => {
    const base = { nowMs: 0, smoothnessIndex: 90, rpmRatio: 0.5, rpmFresh: true }
    let state = advanceRc16Alerts(createRc16AlertState(), { ...base, lapCount: 3, dispersionSec: 0.4 })
    state = advanceRc16Alerts(state, { ...base, lapCount: 4, dispersionSec: 1.2 })
    expect(state.consistencyDrop.active).toBe(true)
    state = advanceRc16Alerts(state, { ...base, lapCount: 5, dispersionSec: 1.2 })
    expect(state.consistencyDrop.active).toBe(false)
  })

  it('holds the rough-input flag through its hysteresis band and releases above it', () => {
    const base = { nowMs: 0, dispersionSec: 0.4, rpmRatio: 0.5, rpmFresh: true }
    let state = advanceRc16Alerts(createRc16AlertState(), {
      ...base,
      lapCount: 1,
      smoothnessIndex: RC16_ROUGH_INPUT_ENTER_INDEX - 1
    })
    expect(state.roughInput.active).toBe(true)

    // Inside the band: neither entering nor clearing.
    state = advanceRc16Alerts(state, {
      ...base,
      lapCount: 2,
      smoothnessIndex: RC16_ROUGH_INPUT_EXIT_INDEX - 1
    })
    expect(state.roughInput.active).toBe(true)

    state = advanceRc16Alerts(state, {
      ...base,
      lapCount: 3,
      smoothnessIndex: RC16_ROUGH_INPUT_EXIT_INDEX
    })
    expect(state.roughInput.active).toBe(false)
  })

  it('keeps the rough-input flag silent while smoothness is ungraded', () => {
    let state = advanceRc16Alerts(createRc16AlertState(), {
      nowMs: 0,
      lapCount: 1,
      dispersionSec: null,
      smoothnessIndex: null,
      rpmRatio: 0.5,
      rpmFresh: true
    })
    expect(state.roughInput.active).toBe(false)
    state = advanceRc16Alerts(state, {
      nowMs: 0,
      lapCount: 2,
      dispersionSec: null,
      smoothnessIndex: null,
      rpmRatio: 0.5,
      rpmFresh: true
    })
    expect(state.roughInput.active).toBe(false)
  })

  it('engages the gentle over-rev only after its 60 ms attack', () => {
    const base = { lapCount: 0, dispersionSec: null, smoothnessIndex: null, rpmFresh: true }
    let state = advanceRc16Alerts(createRc16AlertState(), {
      ...base,
      nowMs: 1_000,
      rpmRatio: RC16_OVER_REV_ENTER_RATIO + 0.005
    })
    expect(state.gentleOverRev.active).toBe(false)

    state = advanceRc16Alerts(state, {
      ...base,
      nowMs: 1_000 + RC16_OVER_REV_ATTACK_MS - 1,
      rpmRatio: RC16_OVER_REV_ENTER_RATIO + 0.005
    })
    expect(state.gentleOverRev.active).toBe(false)

    state = advanceRc16Alerts(state, {
      ...base,
      nowMs: 1_000 + RC16_OVER_REV_ATTACK_MS,
      rpmRatio: RC16_OVER_REV_ENTER_RATIO + 0.005
    })
    expect(state.gentleOverRev.active).toBe(true)
  })

  it('holds the gentle over-rev through its 300 ms release and its hysteresis band', () => {
    const base = { lapCount: 0, dispersionSec: null, smoothnessIndex: null, rpmFresh: true }
    let state = advanceRc16Alerts(createRc16AlertState(), { ...base, nowMs: 0, rpmRatio: 1.02 })
    state = advanceRc16Alerts(state, { ...base, nowMs: RC16_OVER_REV_ATTACK_MS, rpmRatio: 1.02 })
    expect(state.gentleOverRev.active).toBe(true)

    // Inside the 95 %..99 % band: held, and no release timer runs.
    state = advanceRc16Alerts(state, { ...base, nowMs: 500, rpmRatio: 0.97 })
    expect(state.gentleOverRev.active).toBe(true)

    state = advanceRc16Alerts(state, { ...base, nowMs: 1_000, rpmRatio: RC16_OVER_REV_EXIT_RATIO - 0.01 })
    expect(state.gentleOverRev.active).toBe(true)
    state = advanceRc16Alerts(state, {
      ...base,
      nowMs: 1_000 + RC16_OVER_REV_RELEASE_MS - 1,
      rpmRatio: RC16_OVER_REV_EXIT_RATIO - 0.01
    })
    expect(state.gentleOverRev.active).toBe(true)
    state = advanceRc16Alerts(state, {
      ...base,
      nowMs: 1_000 + RC16_OVER_REV_RELEASE_MS,
      rpmRatio: RC16_OVER_REV_EXIT_RATIO - 0.01
    })
    expect(state.gentleOverRev.active).toBe(false)
  })

  it('unlatches the over-rev the instant RPM goes stale, never leaving it latched on dead data', () => {
    const base = { lapCount: 0, dispersionSec: null, smoothnessIndex: null }
    let state = advanceRc16Alerts(createRc16AlertState(), { ...base, nowMs: 0, rpmRatio: 1.02, rpmFresh: true })
    state = advanceRc16Alerts(state, {
      ...base,
      nowMs: RC16_OVER_REV_ATTACK_MS,
      rpmRatio: 1.02,
      rpmFresh: true
    })
    expect(state.gentleOverRev.active).toBe(true)
    state = advanceRc16Alerts(state, { ...base, nowMs: 200, rpmRatio: 1.02, rpmFresh: false })
    expect(state.gentleOverRev.active).toBe(false)
  })

  it('unlatches every coaching alert whose driving channel goes stale or missing', () => {
    const latched: Rc16AlertState = {
      consistencyDrop: { active: true, lapsEvaluated: 4, previousDispersionSec: 0.4 },
      roughInput: { active: true, lapsEvaluated: 4 },
      gentleOverRev: { active: true, pendingSinceMs: null, recoverySinceMs: null }
    }
    const dashed = modelFor(null)
    const cleared = clearInvalidRc16Alerts(latched, dashed)
    expect(cleared.consistencyDrop.active).toBe(false)
    expect(cleared.roughInput.active).toBe(false)
    expect(cleared.gentleOverRev.active).toBe(false)
  })

  it('binds the alert inputs to the model, never to raw provider fields', () => {
    const { buffer, clock } = referenceBuffer()
    const model = createRc16DashboardModel(
      snapshot(),
      createRc01ChannelReceipts(snapshot(), clock),
      buffer.receipts(),
      clock,
      { laps: buffer.laps() }
    )
    const input = rc16AlertInputForModel(model, clock)
    expect(input.lapCount).toBe(model.lapCount)
    expect(input.dispersionSec).toBe(model.dispersionSec)
    expect(input.smoothnessIndex).toBe(model.smoothnessIndex)
    expect(input.rpmFresh).toBe(model.rpmFresh)
  })

  it('gives every alert a visible surface at every breakpoint', () => {
    const engaged: Rc16AlertState = {
      consistencyDrop: { active: false, lapsEvaluated: 0, previousDispersionSec: null },
      roughInput: { active: false, lapsEvaluated: 0 },
      gentleOverRev: { active: true, pendingSinceMs: null, recoverySinceMs: null }
    }
    const model = modelFor(snapshot(), 0, { alerts: engaged })
    expect(model.alertsSilent).toBe(false)
    expect(model.cue.id).toBe('overRev')
    expect(model.cue.alert).toBe(true)
    // The cue card is a packet 11.1 zone and exists in every grammar, so no alert loses its surface.
    for (const box of BREAKPOINTS) {
      const layout = rc16LayoutForContentBox(box.width, box.height)
      const zones = rc16ZonesForLayout(layout, rc16CompactModeForContentBox(box.width, box.height), box)
      expect(zones.cue, `${box.width}x${box.height}`).toBeDefined()
      const html = markup(snapshot(), { ...config, position: { x: 0, y: 0, ...box } })
      expect(html).toContain('data-testid="rc16-cue-panel"')
    }
  })
})

describe('RC-16 shows exactly one coaching cue', () => {
  it('publishes one cue and only one, whatever fires', () => {
    const cue = rc16SelectCue({
      live: true,
      focusArea: 'braking',
      overRev: true,
      roughInput: true,
      consistencyDrop: true
    })
    expect(cue.id).toBe('overRev')
    expect(cue.lines).toHaveLength(2)
    const html = markup(snapshot(), nativeConfig)
    expect([...html.matchAll(/data-testid="rc16-cue-lines"/g)]).toHaveLength(1)
  })

  it('orders the biggest-opportunity ladder: safety, then technique, then consistency, then focus', () => {
    const input = { live: true, focusArea: 'braking' as const, overRev: false, roughInput: false, consistencyDrop: false }
    expect(rc16SelectCue({ ...input, overRev: true }).id).toBe('overRev')
    expect(rc16SelectCue({ ...input, roughInput: true, consistencyDrop: true }).id).toBe('roughInput')
    expect(rc16SelectCue({ ...input, consistencyDrop: true }).id).toBe('consistencyBraking')
    expect(rc16SelectCue(input).id).toBe('focusBraking')
    expect(rc16SelectCue(input).alert).toBe(false)
  })

  it('follows the focus area the macro button selects', () => {
    for (const area of RC16_FOCUS_AREAS) {
      const cue = rc16SelectCue({
        live: true,
        focusArea: area,
        overRev: false,
        roughInput: false,
        consistencyDrop: true
      })
      expect(cue.id.toLowerCase()).toContain(area === 'line' ? 'line' : area)
    }
    expect(rc16NextFocusArea('braking')).toBe('throttle')
    expect(rc16NextFocusArea('throttle')).toBe('line')
    expect(rc16NextFocusArea('line')).toBe('braking')
  })

  it('publishes an honest empty state instead of coaching copy nobody earned', () => {
    const cue = rc16SelectCue({
      live: false,
      focusArea: 'braking',
      overRev: false,
      roughInput: false,
      consistencyDrop: false
    })
    expect(cue.available).toBe(false)
    expect(cue.lines).toEqual([RC16_DASH.cue, RC16_DASH.cue])
    expect(cue.notice).toBe(RC16_NO_CUE_NOTICE)
    expect(cue.alert).toBe(false)
    const html = markup(null, nativeConfig)
    expect(html).toContain(RC16_NO_CUE_NOTICE)
    expect(html).toContain('data-rc16-cue-available="false"')
  })
})

describe('RC-16 layout resolution', () => {
  it('resolves the packet breakpoints', () => {
    expect(rc16LayoutForContentBox(800, 480)).toBe<Rc16Layout>('native')
    expect(rc16LayoutForContentBox(801, 479)).toBe<Rc16Layout>('native')
    expect(rc16LayoutForContentBox(1_024, 600)).toBe<Rc16Layout>('app')
    expect(rc16LayoutForContentBox(1_023, 599)).toBe<Rc16Layout>('app')
    expect(rc16LayoutForContentBox(900, 500)).toBe<Rc16Layout>('compact')
    expect(rc16LayoutForContentBox(0, 0)).toBe<Rc16Layout>('app')
  })

  it('resolves the compact modes', () => {
    expect(rc16CompactModeForContentBox(400, 800)).toBe('phone')
    expect(rc16CompactModeForContentBox(900, 400)).toBe('landscape')
    expect(rc16CompactModeForContentBox(640, 520)).toBe('standard')
    expect(rc16CompactModeForContentBox(800, 480)).toBe('standard')
    expect(rc16CompactModeForContentBox(1_024, 600)).toBe('standard')
  })

  it('expands rather than scales at 1024x600', () => {
    const native = rc16ZonesForLayout('native')
    const app = rc16ZonesForLayout('app')
    expect(allZones(native)).toHaveLength(5)
    expect(allZones(app)).toHaveLength(6)
    // A uniform scale would preserve every percentage; the app grammar deliberately does not.
    expect(app.ring!.left).not.toBeCloseTo(native.ring!.left, 2)
    expect(app.delta!.left).not.toBeCloseTo(native.delta!.left, 2)
    expect(app.history).toBeDefined()
    expect(native.history).toBeUndefined()
  })
})

describe('RC-16 rendered DOM contract', () => {
  it('renders the widget marker, the layout attributes and every packet zone', () => {
    const html = markup(snapshot(), nativeConfig)
    assertClean(html)
    expect(html).toContain('data-widget="raceconRc16Dash"')
    expect(html).toContain('data-rc16-layout="native"')
    expect(html).toContain('data-rc16-native-size="800x480"')
    expect(html).toContain('data-rc16-content-width="800"')
    expect(html).toContain('data-rc16-content-height="480"')
    for (const zone of ['ring', 'smoothness', 'cue', 'delta', 'summary']) {
      expect(html, zone).toContain(`data-rc16-zone="${zone}"`)
    }
  })

  it('renders exactly two lap-summary rows and no third', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('data-rc16-summary-rows="2"')
    expect([...html.matchAll(/data-testid="rc16-summary-row"/g)]).toHaveLength(2)
    expect(html).toContain('data-rc16-summary="lastLap"')
    expect(html).toContain('data-rc16-summary="consistency"')
  })

  it('renders no driver-DDU hero: no LED arc, no gear digit, no tachometer', () => {
    const html = markup(snapshot(), nativeConfig)
    for (const marker of ['rc16-led', 'rc16-gear', 'rc16-tacho', 'rc16-shift']) {
      expect(html, marker).not.toContain(marker)
    }
  })

  it('renders a dash-only frame with no telemetry at all', () => {
    const html = markup(null, nativeConfig)
    assertClean(html)
    expect(html).toContain(RC16_DASH.consistency)
    expect(html).toContain(RC16_DASH.delta)
    expect(html).toContain(RC16_DASH.lapTime)
    expect(html).toContain('data-rc16-alerts="silent"')
    expect(html).toContain('data-rc16-laps="0"')
    expect(html).toContain('data-rc16-ring-available="false"')
    expect(html).not.toContain('is-alert')
  })

  it('refuses mock and replay telemetry and raises no alert from it', () => {
    const mock = markup(snapshot({ sim: 'mock' } as Partial<TelemetrySnapshot>), nativeConfig)
    expect(mock).toContain('data-rc16-buffer-state="mock-telemetry"')
    expect(mock).toContain(RC16_DASH.delta)
    expect(mock).toContain('data-rc16-alerts="silent"')
    expect(mock).toContain('data-rc16-laps="0"')

    const replay = markup(
      snapshot({ replayContext: { state: 'replay' } } as Partial<TelemetrySnapshot>),
      nativeConfig
    )
    expect(replay).toContain('data-rc16-buffer-state="replay-telemetry"')
    expect(replay).toContain(RC16_DASH.delta)
    expect(replay).toContain('data-rc16-alerts="silent"')
    expect(replay).toContain('data-rc16-laps="0"')
  })

  it('exposes the compact mode attribute only in the compact layout', () => {
    const compact = markup(snapshot(), { ...config, position: { x: 0, y: 0, width: 640, height: 520 } })
    expect(compact).toContain('data-rc16-layout="compact"')
    expect(compact).toContain('data-rc16-compact-mode="standard"')
    expect(markup(snapshot(), nativeConfig)).not.toContain('data-rc16-compact-mode')
  })

  it('renders cleanly at every breakpoint', () => {
    for (const box of BREAKPOINTS) {
      const html = markup(snapshot(), { ...config, position: { x: 0, y: 0, ...box } })
      assertClean(html)
      expect(html).toContain('data-widget="raceconRc16Dash"')
      expect(html).toContain('data-testid="rc16-ring"')
    }
  })

  it('describes the ring, the cue and the summary in words, never by hue', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('Consistency ring')
    expect(html).toContain('Coaching cue')
    expect(html).toContain('Throttle smoothness')
    expect(html).toContain('Coaching focus area')
    for (const hue of ['green', 'teal', 'mint', 'amber', 'red']) {
      expect(html.toLowerCase(), hue).not.toContain(`, ${hue}`)
    }
  })

  it('keeps a pattern fingerprint that separates two states with no colour in it', () => {
    const tight = modelFor(snapshot(), 0, {
      laps: [
        lapRecord({ lap: 1, lapTimeSec: 102.1 }),
        lapRecord({ lap: 2, lapTimeSec: 102.15 }),
        lapRecord({ lap: 3, lapTimeSec: 102.12 })
      ]
    })
    const loose = modelFor(snapshot(), 0, {
      laps: [
        lapRecord({ lap: 1, lapTimeSec: 101 }),
        lapRecord({ lap: 2, lapTimeSec: 103 }),
        lapRecord({ lap: 3, lapTimeSec: 102 })
      ]
    })
    expect(rc16PatternFingerprint(tight)).not.toBe(rc16PatternFingerprint(loose))
    expect(rc16PatternFingerprint(tight)).toContain('ring:r')
    expect(rc16PatternFingerprint(tight)).toContain('fill:f82')
    for (const hue of Object.keys(RC16_TOKENS)) {
      expect(rc16PatternFingerprint(tight), hue).not.toContain(hue)
    }
  })
})

describe('RC-16 shares the RC-01 fail-closed ingest buffer', () => {
  it('accepts a live identified snapshot and rejects an unidentified one', () => {
    const buffer = new Rc01LiveTelemetryBuffer()
    expect(buffer.ingest(snapshot(), 0).accepted).toBe(true)
    const orphan = new Rc01LiveTelemetryBuffer()
    expect(orphan.ingest(snapshot({ sessionUniqueId: undefined } as Partial<TelemetrySnapshot>), 0).accepted).toBe(
      false
    )
  })

  it('does not fork the buffer, the receipts, the alert base or the field formatter', () => {
    expect(CORE_SOURCE).toContain("from './raceconRc01Core'")
    expect(CORE_SOURCE).toContain('createRc01DashboardModel')
    expect(CORE_SOURCE).toContain('rc01ReceiptAgeMs')
    expect(CORE_SOURCE).not.toContain('class Rc16LiveTelemetryBuffer')
    expect(WIDGET_SOURCE).toContain('Rc01LiveTelemetryBuffer')
    expect(WIDGET_SOURCE).toContain('rc01FieldDescription')
  })

  it('takes its display clock from the shared family hook and owns no interval of its own', () => {
    expect(WIDGET_SOURCE).toContain("from './raceconDisplayClock'")
    expect(WIDGET_SOURCE).toContain('useRaceconDisplayClock(monotonicClock, raceconDisplayClockFrozen(preview))')
    // The family fix owns the whole clock: no widget may keep a private interval or seed.
    expect(WIDGET_SOURCE).not.toContain('setInterval')
    expect(WIDGET_SOURCE).not.toContain('clearInterval')
    expect(WIDGET_SOURCE).not.toContain('setNowMs')
    // `preview` is read from the shared WidgetProps, never redeclared locally.
    expect(WIDGET_SOURCE).not.toMatch(/preview\s*\?:/)
    expect(raceconDisplayClockFrozen(undefined)).toBe(false)
    expect(raceconDisplayClockFrozen('inert')).toBe(true)
  })

  /**
   * The defect this replaces was real, not stylistic: an unconditional 100 ms clock ages a static
   * preview frame past its own thresholds and mutates the rendered text at zero IPC, which is what
   * `inert-previews.browser.test.ts` observes as a text diff. RC-16's own gate is the delta receipt,
   * which collapses to its dash state at RC01_CHANNEL_STALE_MS.delta.
   */
  it('holds an inert preview byte-identical past every time gate it owns', () => {
    const { text, advance } = mountLive('inert')
    const mounted = text()
    expect(mounted).toContain('-0.28')
    advance(PAST_EVERY_RC16_THRESHOLD_MS)
    expect(text()).toBe(mounted)
  })

  it('keeps the live display clock ticking so a real dashboard still ages its frame', () => {
    const { text, advance } = mountLive(undefined)
    const mounted = text()
    expect(mounted).toContain('-0.28')
    advance(PAST_EVERY_RC16_THRESHOLD_MS)
    expect(text()).not.toBe(mounted)
    // The delta is the gate that moves: it refuses to keep printing against a stale receipt.
    expect(text()).toContain(RC16_DASH.delta)
  })

  it('freezes at its mount value rather than at zero, so a preview is a real frame', () => {
    const { text } = mountLive('inert')
    // A frozen clock is not a dead widget: the mount frame still renders its live channels.
    expect(text()).toContain('1:42.318')
    expect(text()).toContain('-0.28')
  })

  it('never advances committed state during render', () => {
    expect(WIDGET_SOURCE).toContain('bufferRef.current.clone()')
    expect(WIDGET_SOURCE).toContain('coachingRef.current.clone()')
    expect(WIDGET_SOURCE).toContain('useLayoutEffect')
  })
})
