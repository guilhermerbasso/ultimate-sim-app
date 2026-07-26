// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOverlayStyle, type OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'
import { RaceconRc15DashWidget } from './RaceconRc15DashWidget'
import { RACECON_DISPLAY_CLOCK_INTERVAL_MS, raceconDisplayClockFrozen } from './raceconDisplayClock'
import { Rc01LiveTelemetryBuffer } from './raceconRc01Core'
import {
  RC15_ALERT_LABELS,
  RC15_APP_PAN_STACK_GUTTER_PX,
  RC15_APP_PAN_STACK_PX,
  RC15_APP_TYPE_SCALE,
  RC15_APP_ZONES_PX,
  RC15_BALANCE_EXTREME_CORNERS,
  RC15_BALANCE_EXTREME_INDEX,
  RC15_BALANCE_MIN_LAT_G,
  RC15_BALANCE_SMOOTHING_MS,
  RC15_BALANCE_WORD_DEADBAND,
  RC15_BEAM_FULL_TRAVEL_DEG,
  RC15_BIAS_ADJUST_EPSILON,
  RC15_BIAS_LOST_ENGAGE_MS,
  RC15_BRAKE_BAR_CELLS,
  RC15_BRAKE_BAR_CELL_C,
  RC15_BRAKE_HOT_CLEAR_C,
  RC15_BRAKE_HOT_ENGAGE_MS,
  RC15_BRAKE_HOT_HYSTERESIS_MS,
  RC15_BRAKE_HOT_LIMIT_C,
  RC15_CAP_HEIGHT_RATIO,
  RC15_CHANNEL_STALE_MS,
  RC15_CORNER_COLUMNS,
  RC15_CORNER_ENTER_LAT_G,
  RC15_CORNER_EXIT_LAT_G,
  RC15_CORNER_MIN_SAMPLES,
  RC15_CQW_PX,
  RC15_DASH,
  RC15_LABELS,
  RC15_MIN_ALERT_DELTA_E76,
  RC15_MIN_ALERT_HUE_SEPARATION_DEG,
  RC15_NATIVE_ZONES_PX,
  RC15_PACKET_DANGER,
  RC15_PACKET_NATIVE_ZONES_PX,
  RC15_PACKET_OMISSIONS,
  RC15_SILENT_TOKENS,
  RC15_STEER_FULL_SCALE_DEG,
  RC15_TOKENS,
  RC15_TYPE_SCALE_PX,
  RC15_YAW_FULL_SCALE_RAD_S,
  type Rc15AlertInput,
  type Rc15CornerSample,
  type Rc15Layout,
  type Rc15Rect,
  type Rc15ScoredCorner,
  type Rc15ZoneMap,
  Rc15BiasTracker,
  Rc15CornerBuffer,
  advanceRc15Alerts,
  clearInvalidRc15Alerts,
  createRc15AlertState,
  createRc15ChannelReceipts,
  createRc15DashboardModel,
  rc15AlertFlags,
  rc15AlertInputForModel,
  rc15AlertTokens,
  rc15BalanceIndex,
  rc15BalanceWord,
  rc15BeamAngleDeg,
  rc15BrakeBarLitCells,
  rc15CapHeightPx,
  rc15ChannelValue,
  rc15CompactModeForContentBox,
  rc15DeltaE76,
  rc15FormatIndex,
  rc15HueSeparation,
  rc15LayoutForContentBox,
  rc15MarkerOffsetPct,
  rc15PatternFingerprint,
  rc15PhoneGeometryForContentBox,
  rc15RectPercent,
  rc15RectsOverlap,
  rc15SmoothBalance,
  rc15TrackPositionFraction,
  rc15TrendLapNumber,
  rc15TypeScaleCqw,
  rc15TypeScalePxForWidth,
  rc15ZoneStyle,
  rc15ZonesForLayout
} from './raceconRc15Core'

/**
 * RC-15 ships as the four widget-owned files only. Registration — the `OverlayWidgetId` union
 * member, the `OVERLAY_DASHBOARD_PRESETS` entry, the `EMBEDDED` contract row, the `WIDGET_COMPONENTS`
 * map entry, `RESPONSIVE_FULL_FRAME_WIDGET_IDS`, `IDENTITY_SCOPED_WIDGET_IDS` and the regenerated
 * identity catalog — lands in a separate catalog-wiring change that registers several new widgets at
 * once. This suite therefore asserts NOTHING about the registry: an assertion here would either fail
 * before that change lands or have to be rewritten after it, and neither is a useful contract.
 */

/**
 * The `OverlayWidgetId` union member lands in the separate catalog-wiring change, so the literal is
 * carried through `string` here. Once the union gains `'raceconRc15Dash'` this narrowing cast is a
 * no-op and still compiles, which keeps this suite independent of the registry it does not assert.
 */
const RC15_WIDGET_ID = 'raceconRc15Dash' as string as OverlayWidgetConfig['id']

const config: OverlayWidgetConfig = {
  id: RC15_WIDGET_ID,
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
 * The stylesheet is read as TEXT, not as a loaded module, because three of RC-15's guarantees are
 * properties of the source itself: `danger` and `caution` may only be referenced inside an
 * alert-scoped rule, `normal` may not be referenced at all, and `signature` may be bound to brake
 * heat and nothing else. Vitest's root is `app-v2`.
 */
const CSS_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/overlay/widgets/raceconRc15.css'),
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
const ALERT_SCOPES = /is-hot|rc15-pan-alert|is-pegged|is-dashed/

/**
 * The approved RC-15 reference state (attempt-001 governed 800x480, the adjudication winner): a
 * balance-tuning lap with the front axle at 428 degC, the rear at 391 degC, the bias at 56.4 % front
 * and the beam tending UNDER. All three packet section 15 alerts are ARMED and SILENT.
 */
function snapshot(overrides: Partial<TelemetrySnapshot> = {}, timestamp = 1_411_000): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp,
    sessionUniqueId: 41,
    currentLap: 12,
    gear: 4,
    rpm: 7_150,
    maxRpm: 8_600,
    speedKmh: 168,
    throttle: 0.2,
    brake: 0.4,
    clutch: 0,
    steerAngleDeg: 38,
    latAccelG: 1.32,
    longAccelG: -0.4,
    yawRateRadSec: 0.18,
    brakeBiasPct: 56.4,
    brakeTempC: { lf: 430, rf: 426, lr: 393, rr: 389 },
    sessionType: 'Practice',
    sessionState: 'racing',
    playerCarIdx: 4,
    ...overrides
  } as TelemetrySnapshot
}

function markup(value: TelemetrySnapshot | null, cfg = config): string {
  return renderToStaticMarkup(createElement(RaceconRc15DashWidget, { snapshot: value, config: cfg }))
}

/**
 * Comfortably past every time gate RC-15 owns: the 20 ms steering, lateral-G and yaw budgets and
 * the 200 ms brake-temperature budgets, plus both alert debounces.
 */
const PAST_EVERY_RC15_THRESHOLD_MS = 30_000

/**
 * Mounts RC-15 on a controllable monotonic clock and steps wall time and that clock together,
 * exactly as a real render observes them, mirroring the family-wide `raceconDisplayClock` guard.
 */
function mountLive(preview: WidgetProps['preview']): { text: () => string; advance: (ms: number) => void } {
  vi.useFakeTimers()
  let monotonicMs = 0
  const view = render(
    createElement(RaceconRc15DashWidget, {
      snapshot: snapshot(),
      config,
      preview,
      monotonicClock: () => monotonicMs
    })
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

function assertClean(value: string): void {
  expect(value).not.toContain('\uFFFD')
  expect(value).not.toContain('NaN')
  expect(value).not.toContain('undefined')
  expect(value).not.toContain('[object Object]')
}

function modelFor(
  value: TelemetrySnapshot | null,
  nowMs = 0,
  options: Parameters<typeof createRc15DashboardModel>[3] = {},
  receiptsAtMs = nowMs
): ReturnType<typeof createRc15DashboardModel> {
  const receipts = value ? createRc15ChannelReceipts(value, receiptsAtMs) : new Map()
  return createRc15DashboardModel(value, receipts, nowMs, options)
}

function scoredCorner(overrides: Partial<Rc15ScoredCorner> = {}, ordinal = 1): Rc15ScoredCorner {
  return {
    ordinal,
    index: -0.34,
    frontTempC: 428,
    rearTempC: 391,
    sampleCount: 12,
    closedAt: ordinal * 1_000,
    ...overrides
  }
}

function cornerSample(overrides: Partial<Rc15CornerSample> = {}, index = 0): Rc15CornerSample {
  return {
    timestamp: 1_000 + index * 20,
    receivedAt: index * 20,
    latG: 0.6,
    index: -0.34,
    frontTempC: 428,
    rearTempC: 391,
    ...overrides
  }
}

function alertInput(overrides: Partial<Rc15AlertInput> = {}): Rc15AlertInput {
  return {
    nowMs: 0,
    frontTempC: 428,
    rearTempC: 391,
    balanceIndex: -0.34,
    scoredCorners: [],
    biasAvailable: true,
    biasEverReported: true,
    ...overrides
  }
}

function right(rect: Rc15Rect): number {
  return rect.left + rect.width
}

function bottom(rect: Rc15Rect): number {
  return rect.top + rect.height
}

function allZones(zones: Rc15ZoneMap): Rc15Rect[] {
  return Object.values(zones).filter((rect): rect is Rc15Rect => Boolean(rect))
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

describe('RC-15 packet deviations are contractual, not accidental', () => {
  it('records every packet defect and every omission it resolves', () => {
    expect(Object.keys(RC15_PACKET_OMISSIONS).sort()).toEqual(
      [
        'alertThresholdValues',
        'balanceOverBrakeTempRatio',
        'biasBlockAppReflow',
        'biasZoneUndersized',
        'brakeTrendLapAxis',
        'cornerIdentity',
        'cornerMapGeometry',
        'cornerStripSoftKey',
        'dangerSignatureSeparability',
        'deltaToBestZone',
        'heatBarScaleUnbacked',
        'heatBarSegmentCounts',
        'panBeamOverlap',
        'revCue',
        'steerLatGAtApp',
        'tyreGearSpeedZones',
        'typeScaleAsCapHeights',
        'yawChannelRow'
      ].sort()
    )
    for (const reason of Object.values(RC15_PACKET_OMISSIONS)) {
      expect(reason.length).toBeGreaterThan(40)
    }
    expect(Object.isFrozen(RC15_PACKET_OMISSIONS)).toBe(true)
  })

  it('measures the missing track-position and lap channels rather than asserting a comment', () => {
    expect(rc15TrackPositionFraction(snapshot())).toBeNull()
    expect(rc15TrackPositionFraction(null)).toBeNull()
    expect(rc15TrendLapNumber(snapshot({ currentLap: 31 }))).toBeNull()
    expect(rc15TrendLapNumber(null)).toBeNull()
  })

  it('moves both pans clear of the beam and grows the bias zone, per overrides 1 and 2', () => {
    const packetFront = RC15_PACKET_NATIVE_ZONES_PX.frontPan!
    const packetRear = RC15_PACKET_NATIVE_ZONES_PX.rearPan!
    const beam = RC15_PACKET_NATIVE_ZONES_PX.beam!
    // The defect: each packet pan reaches 10 px into the beam zone.
    expect(packetFront.x + packetFront.width).toBeGreaterThan(beam.x)
    expect(packetRear.x).toBeLessThan(beam.x + beam.width)

    const front = RC15_NATIVE_ZONES_PX.frontPan!
    const rear = RC15_NATIVE_ZONES_PX.rearPan!
    expect(front.x + front.width).toBe(beam.x)
    expect(rear.x).toBe(beam.x + beam.width)
    expect(front.x).toBe(800 - (rear.x + rear.width))
    expect(front.width).toBe(packetFront.width)
    expect(rear.width).toBe(packetRear.width)

    const bias = RC15_NATIVE_ZONES_PX.bias!
    const packetBias = RC15_PACKET_NATIVE_ZONES_PX.bias!
    expect(packetBias.height).toBeLessThan(RC15_TYPE_SCALE_PX.bias + 2 * RC15_TYPE_SCALE_PX.cornerStrip)
    expect(bias.width).toBeGreaterThan(packetBias.width)
    expect(bias.height).toBeGreaterThan(packetBias.height)
    expect({ x: bias.x, y: bias.y, width: bias.width, height: bias.height }).toEqual({
      x: 220,
      y: 212,
      width: 360,
      height: 104
    })
  })

  it('retunes danger away from signature, adjudicating on hue and dE76 and never on RGB distance', () => {
    // The packet's own pair fails: dE76 12.95 with 7.23 degrees of hue separation.
    expect(rc15DeltaE76(RC15_TOKENS.signature, RC15_PACKET_DANGER)).toBeLessThan(RC15_MIN_ALERT_DELTA_E76)
    expect(rc15HueSeparation(RC15_TOKENS.signature, RC15_PACKET_DANGER)).toBeLessThan(
      RC15_MIN_ALERT_HUE_SEPARATION_DEG
    )

    expect(rc15DeltaE76(RC15_TOKENS.signature, RC15_TOKENS.danger)).toBeGreaterThanOrEqual(
      RC15_MIN_ALERT_DELTA_E76
    )
    expect(rc15HueSeparation(RC15_TOKENS.signature, RC15_TOKENS.danger)).toBeGreaterThanOrEqual(
      RC15_MIN_ALERT_HUE_SEPARATION_DEG
    )
    expect(rc15DeltaE76(RC15_TOKENS.signature, RC15_TOKENS.caution)).toBeGreaterThanOrEqual(
      RC15_MIN_ALERT_DELTA_E76
    )
  })
})

describe('RC-15 packet zone geometry', () => {
  it('reproduces the corrected packet 11.1 boxes rather than tracing the render', () => {
    expect(RC15_NATIVE_ZONES_PX).toEqual({
      frontPan: { x: 60, y: 80, width: 120, height: 120 },
      beam: { x: 180, y: 60, width: 440, height: 150 },
      rearPan: { x: 620, y: 80, width: 120, height: 120 },
      bias: { x: 220, y: 212, width: 360, height: 104 },
      strip: { x: 16, y: 320, width: 768, height: 140 }
    })
  })

  it('publishes the brief section 2.1 origin and size percentages', () => {
    const zones = rc15ZonesForLayout('native')
    expect(zones.frontPan).toEqual({ left: 7.5, top: 16.666667, width: 15, height: 25 })
    expect(zones.beam).toEqual({ left: 22.5, top: 12.5, width: 55, height: 31.25 })
    expect(zones.rearPan).toEqual({ left: 77.5, top: 16.666667, width: 15, height: 25 })
    expect(zones.bias).toEqual({ left: 27.5, top: 44.166667, width: 45, height: 21.666667 })
    expect(zones.strip).toEqual({ left: 2, top: 66.666667, width: 96, height: 29.166667 })
  })

  it('publishes the packet 12.1 percentages and keeps the declared composite pan box intact', () => {
    const zones = rc15ZonesForLayout('app')
    expect(zones.beam).toEqual(rc15RectPercent(RC15_APP_ZONES_PX.beam!, 1024, 600))
    expect(zones.bias).toEqual(rc15RectPercent(RC15_APP_ZONES_PX.bias!, 1024, 600))
    expect(zones.cornerMap).toEqual(rc15RectPercent(RC15_APP_ZONES_PX.cornerMap!, 1024, 600))
    expect(zones.brakeTrend).toEqual(rc15RectPercent(RC15_APP_ZONES_PX.brakeTrend!, 1024, 600))

    // The two rendered pans union to exactly the declared (40, 70, 240, 180) stacked box.
    const front = RC15_APP_ZONES_PX.frontPan!
    const rear = RC15_APP_ZONES_PX.rearPan!
    expect(front.x).toBe(RC15_APP_PAN_STACK_PX.x)
    expect(rear.x).toBe(RC15_APP_PAN_STACK_PX.x)
    expect(front.width).toBe(RC15_APP_PAN_STACK_PX.width)
    expect(rear.width).toBe(RC15_APP_PAN_STACK_PX.width)
    expect(front.y).toBe(RC15_APP_PAN_STACK_PX.y)
    expect(rear.y + rear.height).toBe(RC15_APP_PAN_STACK_PX.y + RC15_APP_PAN_STACK_PX.height)
    expect(rear.y - (front.y + front.height)).toBe(RC15_APP_PAN_STACK_GUTTER_PX)
  })

  it('keeps every zone inside the canvas and never overlaps two zones, at every breakpoint', () => {
    for (const size of BREAKPOINTS) {
      const layout = rc15LayoutForContentBox(size.width, size.height)
      const zones = rc15ZonesForLayout(layout, rc15CompactModeForContentBox(size.width, size.height), size)
      const rects = allZones(zones)
      expect(rects.length).toBeGreaterThanOrEqual(5)
      for (const rect of rects) {
        expect(rect.left).toBeGreaterThanOrEqual(0)
        expect(rect.top).toBeGreaterThanOrEqual(0)
        expect(right(rect)).toBeLessThanOrEqual(100.0001)
        expect(bottom(rect)).toBeLessThanOrEqual(100.0001)
      }
      for (let a = 0; a < rects.length; a += 1) {
        for (let b = a + 1; b < rects.length; b += 1) {
          expect(rc15RectsOverlap(rects[a], rects[b])).toBe(false)
        }
      }
    }
  })

  it('emits zone geometry as inline percentages without binary-float noise', () => {
    const style = rc15ZoneStyle(rc15ZonesForLayout('native').bias)
    expect(style).toEqual({ left: '27.5%', top: '44.167%', width: '45%', height: '21.667%' })
    expect(rc15ZoneStyle(undefined)).toBeNull()
    for (const value of Object.values(style!)) {
      expect(value).toMatch(/^-?\d+(?:\.\d{1,3})?%$/)
    }
  })
})

describe('RC-15 type ladder is arithmetic', () => {
  it('sets the packet 11.2 ladder and never derives it from the render', () => {
    expect(RC15_TYPE_SCALE_PX).toEqual({ bias: 72, balanceIndex: 48, brakeTemp: 44, cornerStrip: 30 })
    expect(RC15_TYPE_SCALE_PX.bias).toBeGreaterThan(RC15_TYPE_SCALE_PX.balanceIndex)
    // Normative override 5: the impossible 1.091x step becomes "at least as tall as".
    expect(RC15_TYPE_SCALE_PX.balanceIndex).toBeGreaterThanOrEqual(RC15_TYPE_SCALE_PX.brakeTemp)
    expect(RC15_TYPE_SCALE_PX.brakeTemp).toBeGreaterThan(RC15_TYPE_SCALE_PX.cornerStrip)
  })

  it('implements the 11.2 sizes as cap heights at 0.75 of the em, per override 3', () => {
    expect(RC15_CAP_HEIGHT_RATIO).toBe(0.75)
    expect(rc15CapHeightPx(RC15_TYPE_SCALE_PX.bias)).toBe(54)
    expect(rc15CapHeightPx(RC15_TYPE_SCALE_PX.balanceIndex)).toBe(36)
    expect(rc15CapHeightPx(RC15_TYPE_SCALE_PX.brakeTemp)).toBe(33)
    // As line boxes the beam stack would not fit its 150 px zone; as cap heights it does.
    const beamStack =
      rc15CapHeightPx(RC15_TYPE_SCALE_PX.balanceIndex) + rc15CapHeightPx(RC15_TYPE_SCALE_PX.cornerStrip)
    expect(beamStack).toBeLessThan(RC15_NATIVE_ZONES_PX.beam!.height)
  })

  it('expresses the ladder in container units so 1024x600 is the packet 1.28 step', () => {
    expect(RC15_CQW_PX).toBe(8)
    expect(rc15TypeScaleCqw(RC15_TYPE_SCALE_PX.bias)).toBe(9)
    expect(rc15TypeScaleCqw(RC15_TYPE_SCALE_PX.balanceIndex)).toBe(6)
    expect(rc15TypeScaleCqw(RC15_TYPE_SCALE_PX.brakeTemp)).toBe(5.5)
    expect(rc15TypeScaleCqw(RC15_TYPE_SCALE_PX.cornerStrip)).toBe(3.75)
    expect(RC15_APP_TYPE_SCALE).toBe(1.28)
    for (const px of Object.values(RC15_TYPE_SCALE_PX)) {
      expect(rc15TypeScalePxForWidth(px, 800)).toBe(px)
      expect(rc15TypeScalePxForWidth(px, 1024)).toBeCloseTo(px * RC15_APP_TYPE_SCALE, 3)
    }
  })

  it('caps the hero numeral below its own zone width so nowrap cannot push it out', () => {
    // The sizing trap: a numeral is only safe if its clamp maximum is smaller than the zone it
    // lives in on every canvas the widget can be given, because `overflow: hidden` will not clip a
    // `white-space: nowrap` flex item that has outgrown its column.
    const biasRule = cssRules().find((rule) => rule.selector === '.rc15-bias-value')
    expect(biasRule).toBeDefined()
    const max = Number(/clamp\([\s\S]*?,\s*(\d+)px\)\s*;/.exec(biasRule!.body)?.[1])
    expect(max).toBe(96)
    expect(rc15TypeScalePxForWidth(RC15_TYPE_SCALE_PX.bias, 1024)).toBeLessThan(max)
    // Four glyphs plus the unit at the clamp maximum still sit inside the 464 px app bias zone.
    expect(max * 0.62 * 4).toBeLessThan(RC15_APP_ZONES_PX.bias!.width)
    // Override 3: every hero numeral's line box is the cap height, not the em.
    for (const selector of ['.rc15-bias-value', '.rc15-beam-index', '.rc15-pan-value']) {
      const rule = cssRules().find((entry) => entry.selector === selector)
      expect(rule?.body).toContain(`line-height: ${RC15_CAP_HEIGHT_RATIO}`)
    }
  })
})

describe('RC-15 colour contract', () => {
  it('binds the packet 11.3 tokens verbatim, with danger as the single recorded deviation', () => {
    expect(RC15_TOKENS).toEqual({
      bg: '#0F0C0C',
      panel: '#1C1414',
      primary: '#F3ECEC',
      secondary: '#A8988F',
      info: '#3FB0D2',
      normal: '#4CC084',
      caution: '#FF9E2C',
      danger: '#FF1F5B',
      signature: '#FF5E3A'
    })
    for (const [name, hex] of Object.entries(RC15_TOKENS)) {
      if (name === 'danger') continue
      expect(CSS_DECLARATIONS.toLowerCase()).toContain(hex.toLowerCase())
    }
    expect(CSS_DECLARATIONS.toLowerCase()).toContain(RC15_TOKENS.danger.toLowerCase())
    expect(CSS_DECLARATIONS.toLowerCase()).not.toContain(RC15_PACKET_DANGER.toLowerCase())
  })

  it('references every alert token only inside an alert-scoped rule, and normal never at all', () => {
    const rules = cssRules()
    expect(rules.length).toBeGreaterThan(20)
    for (const token of RC15_SILENT_TOKENS) {
      const binding = `var(--rc15-${token})`
      const bound = rules.filter((rule) => rule.body.includes(binding))
      if (token === 'normal') {
        expect(bound).toHaveLength(0)
        continue
      }
      expect(bound.length).toBeGreaterThan(0)
      for (const rule of bound) {
        expect(rule.selector).toMatch(ALERT_SCOPES)
      }
    }
  })

  it('binds signature to brake heat and to nothing else', () => {
    const bound = cssRules().filter((rule) => rule.body.includes('var(--rc15-signature)'))
    expect(bound.length).toBeGreaterThan(0)
    for (const rule of bound) {
      expect(rule.selector).toMatch(/rc15-pan-value|rc15-pan-cell|rc15-trend-front/)
    }
  })

  it('measures zero alert-token pixels while every alert is silent', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('data-rc15-alerts="silent"')
    expect(html).not.toContain(RC15_LABELS.brakeHot)
    expect(html).toContain('data-rc15-pan-hot="false"')
    expect(html).toContain('data-rc15-beam-pegged="false"')
    expect(html).toContain('data-rc15-bias-dashed="false"')
    expect(html).not.toContain('is-hot')
    expect(html).not.toContain('is-pegged')
    expect(html).not.toContain('is-dashed')
  })
})

describe('RC-15 computed chassis balance index', () => {
  it('refuses to label balance without valid steering AND yaw inputs', () => {
    expect(rc15BalanceIndex({ steeringDeg: null, yawRateRadSec: 0.4, latG: 1.2 })).toBeNull()
    expect(rc15BalanceIndex({ steeringDeg: 40, yawRateRadSec: null, latG: 1.2 })).toBeNull()
    expect(rc15BalanceIndex({ steeringDeg: 40, yawRateRadSec: 0.4, latG: null })).toBeNull()
    expect(rc15BalanceIndex({ steeringDeg: Number.NaN, yawRateRadSec: 0.4, latG: 1.2 })).toBeNull()
  })

  it('refuses to label balance below a genuine cornering load', () => {
    const below = RC15_BALANCE_MIN_LAT_G - 0.01
    expect(rc15BalanceIndex({ steeringDeg: 40, yawRateRadSec: 0.4, latG: below })).toBeNull()
    expect(rc15BalanceIndex({ steeringDeg: 40, yawRateRadSec: 0.4, latG: -below })).toBeNull()
    expect(rc15BalanceIndex({ steeringDeg: 40, yawRateRadSec: 0.4, latG: RC15_BALANCE_MIN_LAT_G })).not.toBeNull()
  })

  it('reads more steering than yaw as UNDER and more yaw than steering as OVER', () => {
    const under = rc15BalanceIndex({ steeringDeg: 120, yawRateRadSec: 0.2, latG: 1.2 })!
    expect(under).toBeLessThan(0)
    expect(rc15BalanceWord(under)).toBe('UNDER')

    const over = rc15BalanceIndex({ steeringDeg: 20, yawRateRadSec: 1.0, latG: 1.2 })!
    expect(over).toBeGreaterThan(0)
    expect(rc15BalanceWord(over)).toBe('OVER')

    const neutral = rc15BalanceIndex({
      steeringDeg: RC15_STEER_FULL_SCALE_DEG * 0.4,
      yawRateRadSec: RC15_YAW_FULL_SCALE_RAD_S * 0.4,
      latG: 1.2
    })!
    expect(neutral).toBe(0)
    expect(rc15BalanceWord(neutral)).toBe('LEVEL')
  })

  it('reads the same balance whichever sign convention the sim uses for steering and yaw', () => {
    const rightHand = rc15BalanceIndex({ steeringDeg: 90, yawRateRadSec: 0.3, latG: 1.1 })
    const leftHand = rc15BalanceIndex({ steeringDeg: -90, yawRateRadSec: -0.3, latG: -1.1 })
    const mixed = rc15BalanceIndex({ steeringDeg: -90, yawRateRadSec: 0.3, latG: 1.1 })
    expect(leftHand).toBe(rightHand)
    expect(mixed).toBe(rightHand)
  })

  it('clamps the index to the declared range and formats it with its sign', () => {
    expect(rc15BalanceIndex({ steeringDeg: 100_000, yawRateRadSec: 0.0001, latG: 1.2 })).toBe(-1)
    expect(rc15BalanceIndex({ steeringDeg: 0.0001, yawRateRadSec: 100, latG: 1.2 })).toBe(1)
    expect(rc15FormatIndex(-0.34)).toBe('-0.34')
    expect(rc15FormatIndex(0.38)).toBe('+0.38')
    expect(rc15FormatIndex(null)).toBe(RC15_DASH.index)
  })

  it('tilts the beam by index times 12 degrees of full travel, and pegs only when latched', () => {
    expect(RC15_BEAM_FULL_TRAVEL_DEG).toBe(12)
    expect(rc15BeamAngleDeg(-0.34)).toBe(-4.08)
    expect(rc15BeamAngleDeg(0.5)).toBe(6)
    expect(rc15BeamAngleDeg(null)).toBe(0)
    expect(rc15BeamAngleDeg(-0.6, true)).toBe(-RC15_BEAM_FULL_TRAVEL_DEG)
    expect(rc15BeamAngleDeg(0.6, true)).toBe(RC15_BEAM_FULL_TRAVEL_DEG)
  })

  it('applies the packet 11.5 hysteresis controller and never smooths across a dropout', () => {
    expect(rc15SmoothBalance(null, -0.4, 20)).toBe(-0.4)
    const oneStep = rc15SmoothBalance(0, -1, RC15_BALANCE_SMOOTHING_MS)!
    expect(oneStep).toBeGreaterThan(-1)
    expect(oneStep).toBeLessThan(0)
    expect(rc15SmoothBalance(0, -1, RC15_BALANCE_SMOOTHING_MS * 10)!).toBeLessThan(oneStep)
    // A dropout produces a dropout, never a carried-forward value.
    expect(rc15SmoothBalance(-0.4, null, 20)).toBeNull()
    expect(rc15SmoothBalance(-0.4, -0.9, 0)).toBe(-0.4)
  })

  it('holds a deadband so a level beam reads LEVEL rather than flickering under and over', () => {
    expect(rc15BalanceWord(RC15_BALANCE_WORD_DEADBAND - 0.001)).toBe('LEVEL')
    expect(rc15BalanceWord(-(RC15_BALANCE_WORD_DEADBAND - 0.001))).toBe('LEVEL')
    expect(rc15BalanceWord(RC15_BALANCE_WORD_DEADBAND)).toBe('OVER')
    expect(rc15BalanceWord(-RC15_BALANCE_WORD_DEADBAND)).toBe('UNDER')
    expect(rc15BalanceWord(null)).toBeNull()
  })
})

describe('RC-15 telemetry truth table', () => {
  it('reads every channel from its own declared source', () => {
    const value = snapshot()
    expect(rc15ChannelValue(value, 'steering')).toBe(38)
    expect(rc15ChannelValue(value, 'latG')).toBe(1.32)
    expect(rc15ChannelValue(value, 'yawRate')).toBe(0.18)
    expect(rc15ChannelValue(value, 'brakeBias')).toBe(56.4)
    expect(rc15ChannelValue(value, 'brakeTempLf')).toBe(430)
    expect(rc15ChannelValue(value, 'brakeTempRr')).toBe(389)
  })

  it('carries the packet section 16 freshness budgets verbatim', () => {
    expect(RC15_CHANNEL_STALE_MS).toEqual({
      steering: 20,
      latG: 20,
      yawRate: 20,
      brakeTempLf: 200,
      brakeTempRf: 200,
      brakeTempLr: 200,
      brakeTempRr: 200
    })
    // Brake bias is "on change" and therefore has no age budget at all.
    expect(Object.keys(RC15_CHANNEL_STALE_MS)).not.toContain('brakeBias')
  })

  it('reproduces the approved reference frame deterministically', () => {
    const model = modelFor(snapshot())
    expect(model.frontPan.temperature.value).toBe('428')
    expect(model.rearPan.temperature.value).toBe('391')
    expect(model.bias.value.value).toBe('56.4')
    expect(model.bias.unit).toBe('% FRONT')
    expect(model.steering.value).toBe('38')
    expect(model.latG.value).toBe('1.32')
    expect(model.balance.index.value).toBe(rc15FormatIndex(model.balance.index.raw as number))
    expect(model.balance.word).toBe('UNDER')
    expect(model.alerts.any).toBe(false)
  })

  it('publishes an axle temperature only when both of its corners report', () => {
    const halfFront = modelFor(snapshot({ brakeTempC: { rf: 426, lr: 393, rr: 389 } } as Partial<TelemetrySnapshot>))
    expect(halfFront.frontPan.temperature.unavailable).toBe(true)
    expect(halfFront.frontPan.temperature.value).toBe(RC15_DASH.brakeTemp)
    expect(halfFront.frontPan.litCells).toBe(0)
    // The rear axle is untouched: one axle's loss never borrows the other's reading.
    expect(halfFront.rearPan.temperature.value).toBe('391')
  })

  it('never mirrors one brake corner onto another, and never estimates from usage', () => {
    const asymmetric = modelFor(
      snapshot({ brakeTempC: { lf: 500, rf: 300, lr: 393, rr: 389 } } as Partial<TelemetrySnapshot>)
    )
    expect(asymmetric.frontPan.temperature.value).toBe('400')
    const noSensors = modelFor(snapshot({ brakeTempC: undefined, brake: 1 } as Partial<TelemetrySnapshot>))
    expect(noSensors.frontPan.temperature.unavailable).toBe(true)
    expect(noSensors.rearPan.temperature.unavailable).toBe(true)
    expect(noSensors.frontPan.litCells).toBe(0)
    expect(noSensors.rearPan.litCells).toBe(0)
  })

  it('degrades a channel that falls silent rather than freezing it', () => {
    const value = snapshot()
    const fresh = modelFor(value, 0)
    expect(fresh.steering.unavailable).toBe(false)

    const aged = modelFor(value, RC15_CHANNEL_STALE_MS.steering + 1, {}, 0)
    expect(aged.steering.unavailable).toBe(true)
    expect(aged.steering.value).toBe(RC15_DASH.steering)
    // Balance depends on steering, so it dashes with it rather than holding the last angle.
    expect(aged.balance.available).toBe(false)
    expect(aged.balance.index.value).toBe(RC15_DASH.index)
    expect(aged.balance.word).toBeNull()
    expect(aged.balance.beamDeg).toBe(0)
  })

  it('never infers brake bias, and dashes the readout when the channel is unavailable', () => {
    const model = modelFor(snapshot({ brakeBiasPct: undefined } as Partial<TelemetrySnapshot>))
    expect(model.bias.value.unavailable).toBe(true)
    expect(model.bias.value.value).toBe(RC15_DASH.bias)
    expect(model.bias.hint.value).toBe(RC15_DASH.hint)
    expect(model.bias.direction).toBeNull()
  })

  it('never reads a channel the packet gives no zone: no delta, no tyre, no gear, no speed', () => {
    const html = markup(
      snapshot({
        deltaToBestSec: -1.234,
        tyres: { lf: { tempC: 84 }, rf: { tempC: 86 }, lr: { tempC: 81 }, rr: { tempC: 83 } }
      } as Partial<TelemetrySnapshot>),
      nativeConfig
    )
    expect(html).not.toContain('1.234')
    expect(html).not.toContain('86')
    expect(html).not.toContain('168')
    expect(html).not.toContain('7150')
    assertClean(html)
  })
})

describe('RC-15 brake pans', () => {
  it('draws exactly ten equal cells in both pans, per normative override 8', () => {
    const model = modelFor(snapshot())
    expect(RC15_BRAKE_BAR_CELLS).toBe(10)
    expect(model.frontPan.cells).toHaveLength(RC15_BRAKE_BAR_CELLS)
    expect(model.rearPan.cells).toHaveLength(RC15_BRAKE_BAR_CELLS)
    expect(model.frontPan.cells.length).toBe(model.rearPan.cells.length)
  })

  it('lights min(10, floor(t / 50)), so 428 gives 8 and 391 gives 7', () => {
    expect(RC15_BRAKE_BAR_CELL_C).toBe(50)
    expect(rc15BrakeBarLitCells(428)).toBe(8)
    expect(rc15BrakeBarLitCells(391)).toBe(7)
    expect(rc15BrakeBarLitCells(0)).toBe(0)
    expect(rc15BrakeBarLitCells(null)).toBe(0)
    expect(rc15BrakeBarLitCells(9_000)).toBe(RC15_BRAKE_BAR_CELLS)

    const model = modelFor(snapshot())
    expect(model.frontPan.litCells).toBe(8)
    expect(model.rearPan.litCells).toBe(7)
    expect(model.frontPan.cells.filter((cell) => cell.lit)).toHaveLength(8)
  })

  it('ties the bar full scale to the section 15 hot limit so bar and alarm are one event', () => {
    expect(RC15_BRAKE_BAR_CELL_C * RC15_BRAKE_BAR_CELLS).toBe(RC15_BRAKE_HOT_LIMIT_C)
    expect(rc15BrakeBarLitCells(RC15_BRAKE_HOT_LIMIT_C)).toBe(RC15_BRAKE_BAR_CELLS)
    expect(rc15BrakeBarLitCells(RC15_BRAKE_HOT_LIMIT_C - 1)).toBe(RC15_BRAKE_BAR_CELLS - 1)
    expect(RC15_BRAKE_HOT_CLEAR_C).toBeLessThan(RC15_BRAKE_HOT_LIMIT_C)
  })
})

describe('RC-15 corner scoring is measured, never assumed', () => {
  function drive(buffer: Rc15CornerBuffer, loads: readonly number[], index: number | null = -0.6): void {
    loads.forEach((latG, position) => {
      buffer.ingest(cornerSample({ latG, index }, position))
    })
  }

  it('records a corner only when both its entry and its exit crossing were observed', () => {
    const buffer = new Rc15CornerBuffer()
    drive(buffer, [0.1, 0.6, 0.7, 0.8, 0.7, 0.6, 0.1])
    const corners = buffer.corners()
    expect(corners).toHaveLength(1)
    expect(corners[0].ordinal).toBe(1)
    expect(corners[0].sampleCount).toBeGreaterThanOrEqual(RC15_CORNER_MIN_SAMPLES)
  })

  it('discards the corner a mid-corner mount landed inside, rather than scoring a fragment', () => {
    const buffer = new Rc15CornerBuffer()
    // The very first sample is already loaded: the entry crossing was never seen.
    drive(buffer, [0.9, 0.8, 0.7, 0.6, 0.5, 0.1])
    expect(buffer.corners()).toHaveLength(0)
    // The next, fully observed corner scores normally.
    drive(buffer, [0.6, 0.7, 0.8, 0.7, 0.1])
    expect(buffer.corners()).toHaveLength(1)
  })

  it('needs the entry gate, not merely the exit gate, to open a corner', () => {
    const buffer = new Rc15CornerBuffer()
    const between = (RC15_CORNER_ENTER_LAT_G + RC15_CORNER_EXIT_LAT_G) / 2
    drive(buffer, [0.1, between, between, between, between, 0.1])
    expect(buffer.corners()).toHaveLength(0)
  })

  it('drops a corner too short to be a corner', () => {
    const buffer = new Rc15CornerBuffer()
    drive(buffer, [0.1, 0.6, 0.7, 0.1])
    expect(buffer.corners()).toHaveLength(0)
  })

  it('abandons the corner in progress when the gate channel itself drops out', () => {
    const buffer = new Rc15CornerBuffer()
    drive(buffer, [0.1, 0.6, 0.7, 0.8])
    buffer.ingest(cornerSample({ latG: null }, 4))
    drive(buffer, [0.6, 0.1])
    expect(buffer.corners()).toHaveLength(0)
  })

  it('scores the corner from the samples it actually saw, and dashes an index it never had', () => {
    const buffer = new Rc15CornerBuffer()
    drive(buffer, [0.1, 0.6, 0.7, 0.8, 0.7, 0.1], null)
    const [corner] = buffer.corners()
    expect(corner.index).toBeNull()
    expect(corner.frontTempC).toBe(428)
    expect(corner.rearTempC).toBe(391)
  })

  it('bounds the scored-corner history and returns the newest six in reading order', () => {
    const buffer = new Rc15CornerBuffer()
    for (let lap = 0; lap < 40; lap += 1) drive(buffer, [0.1, 0.6, 0.7, 0.8, 0.7, 0.1])
    expect(buffer.corners().length).toBeLessThanOrEqual(24)
    const recent = buffer.recent()
    expect(recent).toHaveLength(RC15_CORNER_COLUMNS)
    expect(recent[recent.length - 1].ordinal).toBe(40)
  })

  it('computes a marker offset arithmetically and prints the index under every column', () => {
    expect(rc15MarkerOffsetPct(-0.5)).toBe(-25)
    expect(rc15MarkerOffsetPct(0.38)).toBe(19)
    expect(rc15MarkerOffsetPct(null)).toBeNull()

    const model = modelFor(snapshot(), 0, {
      scoredCorners: [scoredCorner({ index: -0.5 }, 1), scoredCorner({ index: null }, 2)]
    })
    expect(model.corners).toHaveLength(RC15_CORNER_COLUMNS)
    const filled = model.corners.filter((column) => column.scored)
    expect(filled).toHaveLength(2)
    expect(filled[0].markerOffsetPct).toBe(-25)
    // The dropout column draws its datum tick with NO marker and never interpolates a neighbour.
    expect(filled[1].markerOffsetPct).toBeNull()
    expect(filled[1].index.value).toBe(RC15_DASH.index)
  })

  it('right-aligns the strip so the single current-corner underline is always on column six', () => {
    const model = modelFor(snapshot(), 0, { scoredCorners: [scoredCorner({}, 1), scoredCorner({}, 2)] })
    const current = model.corners.filter((column) => column.current)
    expect(current).toHaveLength(1)
    expect(current[0].id).toBe(`c${RC15_CORNER_COLUMNS}`)
    expect(current[0].ordinal).toBe(2)
    for (const column of model.corners.slice(0, RC15_CORNER_COLUMNS - 2)) {
      expect(column.scored).toBe(false)
      expect(column.index.value).toBe(RC15_DASH.index)
      expect(column.frontTemp.value).toBe(RC15_DASH.brakeTemp)
      expect(column.markerOffsetPct).toBeNull()
    }
  })

  it('never underlines a column with no corner behind it', () => {
    const model = modelFor(snapshot(), 0, { scoredCorners: [] })
    expect(model.corners.filter((column) => column.current)).toHaveLength(0)
    expect(model.corners.every((column) => column.label.startsWith('C'))).toBe(true)
  })
})

describe('RC-15 brake-bias adjust hint', () => {
  it('measures the last adjustment from the channel itself and names its direction', () => {
    const tracker = new Rc15BiasTracker()
    tracker.ingest(56.8)
    expect(tracker.lastAdjustment()).toBeNull()
    tracker.ingest(56.4)
    expect(tracker.lastAdjustment()).toEqual({ direction: 'REAR', magnitude: 0.4 })
    tracker.ingest(57.0)
    expect(tracker.lastAdjustment()).toEqual({ direction: 'FRONT', magnitude: 0.6 })
  })

  it('ignores channel noise below the adjuster resolution', () => {
    const tracker = new Rc15BiasTracker()
    tracker.ingest(56.4)
    tracker.ingest(56.4 + RC15_BIAS_ADJUST_EPSILON / 2)
    expect(tracker.lastAdjustment()).toBeNull()
  })

  it('never invents an adjustment it did not observe, and resets with the source', () => {
    const tracker = new Rc15BiasTracker()
    tracker.ingest(null)
    expect(tracker.everReported()).toBe(false)
    tracker.ingest(56.4)
    tracker.ingest(55.4)
    expect(tracker.lastAdjustment()).not.toBeNull()
    tracker.reset()
    expect(tracker.lastAdjustment()).toBeNull()
    expect(tracker.everReported()).toBe(false)

    const model = modelFor(snapshot(), 0, { biasAdjustment: null })
    expect(model.bias.hint.unavailable).toBe(true)
    expect(model.bias.hint.value).toBe(RC15_DASH.hint)
  })

  it('renders the observed adjustment as a direction word plus a magnitude', () => {
    const model = modelFor(snapshot(), 0, { biasAdjustment: { direction: 'REAR', magnitude: 0.4 } })
    expect(model.bias.hint.value).toBe('REAR 0.4')
    expect(model.bias.direction).toBe('REAR')
  })
})

describe('RC-15 trigger-only alerts', () => {
  it('starts silent on every alert', () => {
    const flags = rc15AlertFlags(createRc15AlertState())
    expect(flags).toEqual({
      brakeHotFront: false,
      brakeHotRear: false,
      balanceExtreme: false,
      balanceExtremeSide: null,
      biasUnavailable: false,
      any: false
    })
    expect(rc15AlertTokens(flags)).toBe('silent')
    expect(Object.keys(RC15_ALERT_LABELS).sort()).toEqual(['balanceExtreme', 'biasUnavailable', 'brakeHot'])
  })

  it('engages brake overheat only after its two-second debounce', () => {
    const hot = RC15_BRAKE_HOT_LIMIT_C + 20
    let state = createRc15AlertState()
    state = advanceRc15Alerts(state, alertInput({ nowMs: 0, frontTempC: hot }))
    expect(state.brakeHot.front.active).toBe(false)
    state = advanceRc15Alerts(state, alertInput({ nowMs: RC15_BRAKE_HOT_ENGAGE_MS - 1, frontTempC: hot }))
    expect(state.brakeHot.front.active).toBe(false)
    state = advanceRc15Alerts(state, alertInput({ nowMs: RC15_BRAKE_HOT_ENGAGE_MS, frontTempC: hot }))
    expect(state.brakeHot.front.active).toBe(true)
    // The rear axle has its own independent timer and is still silent.
    expect(state.brakeHot.rear.active).toBe(false)
  })

  it('holds brake overheat through its four-second hysteresis and clears only below the re-entry threshold', () => {
    const hot = RC15_BRAKE_HOT_LIMIT_C + 20
    let state = createRc15AlertState()
    state = advanceRc15Alerts(state, alertInput({ nowMs: 0, frontTempC: hot }))
    state = advanceRc15Alerts(state, alertInput({ nowMs: RC15_BRAKE_HOT_ENGAGE_MS, frontTempC: hot }))
    expect(state.brakeHot.front.active).toBe(true)

    // Between the clear threshold and the limit: still engaged, no chatter.
    const between = RC15_BRAKE_HOT_CLEAR_C + 10
    state = advanceRc15Alerts(state, alertInput({ nowMs: 3_000, frontTempC: between }))
    expect(state.brakeHot.front.active).toBe(true)

    const cool = RC15_BRAKE_HOT_CLEAR_C - 10
    state = advanceRc15Alerts(state, alertInput({ nowMs: 4_000, frontTempC: cool }))
    expect(state.brakeHot.front.active).toBe(true)
    state = advanceRc15Alerts(
      state,
      alertInput({ nowMs: 4_000 + RC15_BRAKE_HOT_HYSTERESIS_MS - 1, frontTempC: cool })
    )
    expect(state.brakeHot.front.active).toBe(true)
    state = advanceRc15Alerts(
      state,
      alertInput({ nowMs: 4_000 + RC15_BRAKE_HOT_HYSTERESIS_MS, frontTempC: cool })
    )
    expect(state.brakeHot.front.active).toBe(false)
  })

  it('unlatches brake overheat the moment its own sensor goes missing, and never estimates', () => {
    const hot = RC15_BRAKE_HOT_LIMIT_C + 20
    let state = createRc15AlertState()
    state = advanceRc15Alerts(state, alertInput({ nowMs: 0, frontTempC: hot }))
    state = advanceRc15Alerts(state, alertInput({ nowMs: RC15_BRAKE_HOT_ENGAGE_MS, frontTempC: hot }))
    expect(state.brakeHot.front.active).toBe(true)
    state = advanceRc15Alerts(state, alertInput({ nowMs: 2_100, frontTempC: null }))
    expect(state.brakeHot.front.active).toBe(false)
    expect(state.brakeHot.front.aboveSinceMs).toBeNull()
  })

  it('latches balance extreme over three consecutive corners on the same side', () => {
    const under = (ordinal: number): Rc15ScoredCorner =>
      scoredCorner({ index: -(RC15_BALANCE_EXTREME_INDEX + 0.1) }, ordinal)
    let state = createRc15AlertState()
    state = advanceRc15Alerts(state, alertInput({ scoredCorners: [under(1), under(2)] }))
    expect(state.balanceExtreme.active).toBe(false)
    state = advanceRc15Alerts(state, alertInput({ scoredCorners: [under(1), under(2), under(3)] }))
    expect(state.balanceExtreme.active).toBe(true)
    expect(state.balanceExtreme.side).toBe('UNDER')
    expect(state.balanceExtreme.latchedOrdinal).toBe(3)
    expect(RC15_BALANCE_EXTREME_CORNERS).toBe(3)
  })

  it('breaks the run when one corner sits on the other side, exactly as the approved frame does', () => {
    const beyond = RC15_BALANCE_EXTREME_INDEX + 0.1
    const corners = [
      scoredCorner({ index: -beyond }, 1),
      scoredCorner({ index: beyond }, 2),
      scoredCorner({ index: -beyond }, 3)
    ]
    const state = advanceRc15Alerts(createRc15AlertState(), alertInput({ scoredCorners: corners }))
    expect(state.balanceExtreme.active).toBe(false)
  })

  it('breaks the run on a corner whose index was never valid', () => {
    const beyond = RC15_BALANCE_EXTREME_INDEX + 0.1
    const corners = [
      scoredCorner({ index: -beyond }, 1),
      scoredCorner({ index: null }, 2),
      scoredCorner({ index: -beyond }, 3)
    ]
    const state = advanceRc15Alerts(createRc15AlertState(), alertInput({ scoredCorners: corners }))
    expect(state.balanceExtreme.active).toBe(false)
  })

  it('clears balance extreme when the index returns to the band, and unlatches when it goes invalid', () => {
    const under = (ordinal: number): Rc15ScoredCorner =>
      scoredCorner({ index: -(RC15_BALANCE_EXTREME_INDEX + 0.1) }, ordinal)
    const latched = advanceRc15Alerts(
      createRc15AlertState(),
      alertInput({ scoredCorners: [under(1), under(2), under(3)] })
    )
    expect(latched.balanceExtreme.active).toBe(true)

    const returned = advanceRc15Alerts(latched, alertInput({ scoredCorners: [], balanceIndex: -0.1 }))
    expect(returned.balanceExtreme.active).toBe(false)

    const invalid = advanceRc15Alerts(latched, alertInput({ scoredCorners: [], balanceIndex: null }))
    expect(invalid.balanceExtreme.active).toBe(false)

    const held = advanceRc15Alerts(
      latched,
      alertInput({ scoredCorners: [], balanceIndex: -(RC15_BALANCE_EXTREME_INDEX + 0.2) })
    )
    expect(held.balanceExtreme.active).toBe(true)
  })

  it('engages bias unavailable one second after a real loss, and never without one', () => {
    let state = createRc15AlertState()
    // A sim that never publishes a bias adjuster shows the truth-table dash with NO alert.
    state = advanceRc15Alerts(state, alertInput({ nowMs: 10_000, biasAvailable: false, biasEverReported: false }))
    expect(state.biasUnavailable.active).toBe(false)

    state = advanceRc15Alerts(state, alertInput({ nowMs: 0, biasAvailable: false }))
    expect(state.biasUnavailable.active).toBe(false)
    state = advanceRc15Alerts(state, alertInput({ nowMs: RC15_BIAS_LOST_ENGAGE_MS - 1, biasAvailable: false }))
    expect(state.biasUnavailable.active).toBe(false)
    state = advanceRc15Alerts(state, alertInput({ nowMs: RC15_BIAS_LOST_ENGAGE_MS, biasAvailable: false }))
    expect(state.biasUnavailable.active).toBe(true)

    state = advanceRc15Alerts(state, alertInput({ nowMs: 5_000, biasAvailable: true }))
    expect(state.biasUnavailable.active).toBe(false)
  })

  it('drops any alert the model can no longer justify', () => {
    const hot = RC15_BRAKE_HOT_LIMIT_C + 20
    let state = createRc15AlertState()
    state = advanceRc15Alerts(state, alertInput({ nowMs: 0, frontTempC: hot, rearTempC: hot }))
    state = advanceRc15Alerts(
      state,
      alertInput({ nowMs: RC15_BRAKE_HOT_ENGAGE_MS, frontTempC: hot, rearTempC: hot })
    )
    expect(state.brakeHot.front.active).toBe(true)

    const blind = modelFor(snapshot({ brakeTempC: undefined, steerAngleDeg: undefined } as Partial<TelemetrySnapshot>))
    const cleared = clearInvalidRc15Alerts(state, blind)
    expect(cleared.brakeHot.front.active).toBe(false)
    expect(cleared.brakeHot.rear.active).toBe(false)
    expect(cleared.balanceExtreme.active).toBe(false)
  })

  it('binds the alert inputs to fresh channels only', () => {
    const value = snapshot()
    const stale = modelFor(value, 1_000, {}, 0)
    const input = rc15AlertInputForModel(stale, 1_000, [], true)
    expect(input.frontTempC).toBeNull()
    expect(input.rearTempC).toBeNull()
    expect(input.balanceIndex).toBeNull()

    const fresh = rc15AlertInputForModel(modelFor(value, 0), 0, [], true)
    expect(fresh.frontTempC).toBe(428)
    expect(fresh.biasAvailable).toBe(true)
  })

  it('gives every alert a visible surface at every breakpoint', () => {
    const hotSnapshot = snapshot({
      brakeTempC: { lf: 620, rf: 618, lr: 610, rr: 608 },
      brakeBiasPct: 56.4
    } as Partial<TelemetrySnapshot>)
    for (const size of BREAKPOINTS) {
      const html = markup(hotSnapshot, { ...config, position: { x: 0, y: 0, ...size } })
      // The pans, the beam and the bias block — the three alert surfaces — exist at every size.
      expect(html).toContain('data-rc15-pan="front"')
      expect(html).toContain('data-rc15-pan="rear"')
      expect(html).toContain('data-rc15-zone="beam"')
      expect(html).toContain('data-rc15-zone="bias"')
      assertClean(html)
    }
  })
})

describe('RC-15 layout resolution', () => {
  it('resolves the packet breakpoints', () => {
    expect(rc15LayoutForContentBox(800, 480)).toBe('native')
    expect(rc15LayoutForContentBox(801, 479)).toBe('native')
    expect(rc15LayoutForContentBox(1024, 600)).toBe('app')
    expect(rc15LayoutForContentBox(1920, 1080)).toBe('app')
    expect(rc15LayoutForContentBox(640, 520)).toBe('compact')
    expect(rc15LayoutForContentBox(0, 0)).toBe('app')
  })

  it('resolves the compact modes', () => {
    expect(rc15CompactModeForContentBox(400, 800)).toBe('phone')
    expect(rc15CompactModeForContentBox(900, 400)).toBe('landscape')
    expect(rc15CompactModeForContentBox(640, 520)).toBe('standard')
    expect(rc15CompactModeForContentBox(800, 480)).toBe('standard')
    expect(rc15PhoneGeometryForContentBox(400, 800)).not.toBeNull()
    expect(rc15PhoneGeometryForContentBox(800, 480)).toBeNull()
  })

  it('expands rather than scales at 1024x600', () => {
    const native = rc15ZonesForLayout('native')
    const app = rc15ZonesForLayout('app')
    expect(native.cornerMap).toBeUndefined()
    expect(native.brakeTrend).toBeUndefined()
    expect(app.cornerMap).toBeDefined()
    expect(app.brakeTrend).toBeDefined()
    // A uniform scale would preserve every percentage; a reflow does not.
    expect(app.beam).not.toEqual(native.beam)
    expect(app.strip).toBeUndefined()
  })
})

describe('RC-15 rendered DOM contract', () => {
  it('renders the widget marker, the layout attributes and every packet zone', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('data-widget="raceconRc15Dash"')
    expect(html).toContain('data-rc15-layout="native"')
    expect(html).toContain('data-rc15-native-size="800x480"')
    expect(html).toContain('data-rc15-content-width="800"')
    expect(html).toContain('data-rc15-content-height="480"')
    for (const zone of ['beam', 'frontPan', 'rearPan', 'bias', 'strip']) {
      expect(html).toContain(`data-rc15-zone="${zone}"`)
    }
    expect(html).not.toContain('data-rc15-zone="cornerMap"')
    expect(html).not.toContain('data-rc15-zone="brakeTrend"')
    assertClean(html)
  })

  it('reveals the corner map and the brake trend only at 1024x600', () => {
    const app = markup(snapshot(), config)
    expect(app).toContain('data-rc15-zone="cornerMap"')
    expect(app).toContain('data-rc15-zone="brakeTrend"')
    expect(app).toContain(RC15_LABELS.noTrackMap)
    // Packet 12.1 drops the strip; steering and lateral G move onto the corner-map header (gap 3).
    expect(app).not.toContain('data-rc15-zone="strip"')
    expect(app).toContain('data-testid="rc15-steering"')
    expect(app).toContain('data-testid="rc15-latg"')
  })

  it('labels the balance index as computed and prints the word beside it', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain(RC15_LABELS.computed)
    expect(html).toContain(RC15_LABELS.balance)
    expect(html).toContain('data-rc15-balance="UNDER"')
    expect(html).toMatch(/data-rc15-beam-deg="-?\d+(?:\.\d+)?"/)
  })

  it('renders no shift LED arc, no rev cue and no tyre mandala anywhere', () => {
    const html = markup(snapshot(), config)
    expect(html.toLowerCase()).not.toContain('led')
    expect(html.toLowerCase()).not.toContain('shift')
    expect(html.toLowerCase()).not.toContain('rev')
    expect(html.toLowerCase()).not.toContain('rpm')
    expect(html.toLowerCase()).not.toContain('tyre')
    expect(html.toLowerCase()).not.toContain('tire')
  })

  it('renders exactly six corner columns with ten heat cells in each pan', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html.split('data-testid="rc15-corner"').length - 1).toBe(RC15_CORNER_COLUMNS)
    expect(html.split('data-testid="rc15-pan-cell"').length - 1).toBe(RC15_BRAKE_BAR_CELLS * 2)
    expect(html).toContain('data-rc15-pan-cells="10"')
  })

  it('renders a dash-only frame with no telemetry at all', () => {
    const html = markup(null, nativeConfig)
    expect(html).toContain('data-widget="raceconRc15Dash"')
    expect(html).toContain('data-rc15-alerts="silent"')
    expect(html).toContain('data-rc15-balance="unavailable"')
    expect(html).toContain('data-rc15-scored-corners="0"')
    expect(html).toContain(RC15_DASH.index)
    expect(html).toContain(RC15_LABELS.noCorners)
    expect(html).toContain('data-rc15-pan-lit="0"')
    assertClean(html)
  })

  it('refuses mock and replay telemetry and raises no alert from it', () => {
    const mock = markup(snapshot({ sim: 'mock' } as Partial<TelemetrySnapshot>), nativeConfig)
    expect(mock).toContain('data-rc15-buffer-state="mock-telemetry"')
    expect(mock).toContain('data-rc15-alerts="silent"')
    expect(mock).toContain('data-rc15-balance="unavailable"')
    expect(mock).toContain('data-rc15-scored-corners="0"')
    expect(mock).toContain(RC15_DASH.bias)

    const replay = markup(
      snapshot({ replayContext: { state: 'replay' } } as Partial<TelemetrySnapshot>),
      nativeConfig
    )
    expect(replay).toContain('data-rc15-buffer-state="replay-telemetry"')
    expect(replay).toContain('data-rc15-alerts="silent"')
    expect(replay).toContain('data-rc15-scored-corners="0"')
    expect(replay).toContain(RC15_DASH.bias)
  })

  it('exposes the compact mode attribute only in the compact layout', () => {
    const compact = markup(snapshot(), { ...config, position: { x: 0, y: 0, width: 640, height: 520 } })
    expect(compact).toContain('data-rc15-layout="compact"')
    expect(compact).toContain('data-rc15-compact-mode="standard"')
    expect(markup(snapshot(), nativeConfig)).not.toContain('data-rc15-compact-mode')
  })

  it('renders cleanly at every breakpoint', () => {
    for (const size of BREAKPOINTS) {
      const html = markup(snapshot(), { ...config, position: { x: 0, y: 0, ...size } })
      expect(html).toContain('data-widget="raceconRc15Dash"')
      assertClean(html)
    }
  })

  it('describes the balance, the pans and the corners in words, never by hue', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('Computed chassis balance index')
    expect(html).toContain('Front axle brake temperature')
    expect(html).toContain('heat cells')
    expect(html).toContain('not yet scored')
    // No rendered string names a colour: every state is a word, a count or an angle.
    expect(html).not.toMatch(/\b(red|orange|green|amber|yellow|colou?r)\b/i)
  })

  it('keeps a colour-free fingerprint that separates every state', () => {
    const silent = rc15PatternFingerprint(modelFor(snapshot()))
    expect(silent).toContain('word:UNDER')
    expect(silent).toContain('front:8/10')
    expect(silent).toContain('rear:7/10')
    expect(silent).toContain('alerts:silent')

    const blind = rc15PatternFingerprint(modelFor(null))
    expect(blind).toContain('word:none')
    expect(blind).toContain('beam:x')
    expect(blind).not.toBe(silent)
  })
})

describe('RC-15 shares the RC-01 fail-closed ingest buffer', () => {
  it('accepts a live identified snapshot and rejects an unidentified one', () => {
    const buffer = new Rc01LiveTelemetryBuffer()
    expect(buffer.ingest(snapshot(), 0).accepted).toBe(true)
    expect(buffer.ingest(snapshot({ sim: 'mock' } as Partial<TelemetrySnapshot>), 100).reason).toBe(
      'mock-telemetry'
    )
    expect(
      buffer.ingest(snapshot({ replayContext: { state: 'replay' } } as Partial<TelemetrySnapshot>), 200).reason
    ).toBe('replay-telemetry')
  })

  it('does not fork the buffer, the receipts or the freshness helper', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/overlay/widgets/raceconRc15Core.ts'),
      'utf8'
    )
    expect(source).toContain("from './raceconRc01Core'")
    expect(source).toContain('rc01ReceiptAgeMs')
    expect(source).toContain('rc01MonotonicNow')
    expect(source).not.toContain('class Rc01LiveTelemetryBuffer')
    expect(source).not.toContain('function rc01SourceIdentity')
  })

  it('drops every acquired score when the source is refused', () => {
    const html = markup(snapshot({ sim: 'mock' } as Partial<TelemetrySnapshot>), nativeConfig)
    expect(html).toContain('data-rc15-scored-corners="0"')
    expect(html).toContain('data-rc15-beam-pegged="false"')
    expect(html).toContain('data-rc15-bias-available="false"')
  })
})

describe('RC-15 uses the shared RaceCon display clock', () => {
  it('routes its clock through useRaceconDisplayClock and owns no interval of its own', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/overlay/widgets/RaceconRc15DashWidget.tsx'),
      'utf8'
    )
    expect(source).toContain("from './raceconDisplayClock'")
    expect(source).toContain('useRaceconDisplayClock(monotonicClock, raceconDisplayClockFrozen(preview))')
    // The family-wide fix owns the interval now: a hand-rolled one here would tick in a preview.
    expect(source).not.toContain('setInterval')
    expect(source).not.toContain('setNowMs')
  })

  it('holds a byte-identical frame in an inert preview, past every time gate it owns', () => {
    expect(raceconDisplayClockFrozen(undefined)).toBe(false)
    expect(raceconDisplayClockFrozen('inert')).toBe(true)

    const { text, advance } = mountLive('inert')
    const mounted = text()
    advance(PAST_EVERY_RC15_THRESHOLD_MS)
    expect(text()).toBe(mounted)
  })

  it('still ages a live frame, so a real dashboard degrades its channels on schedule', () => {
    const { text, advance } = mountLive(undefined)
    const mounted = text()
    expect(mounted).toContain('38')
    expect(mounted).toContain('1.32')
    advance(PAST_EVERY_RC15_THRESHOLD_MS)
    const aged = text()
    expect(aged).not.toBe(mounted)
    // Every channel that HAS a section 16 age budget is past it, so all of them dash and the
    // computed index — which needs valid steering and yaw — refuses to label balance at all.
    expect(aged).not.toContain('38')
    expect(aged).not.toContain('1.32')
    expect(aged).not.toContain('428')
    expect(aged).toContain(RC15_DASH.index)
    // Brake bias is section 16 "on change" and therefore has no age budget: it is still printed,
    // and it degrades only when the source stops publishing it, never on elapsed time alone.
    expect(aged).toContain('56.4')
  })
})
