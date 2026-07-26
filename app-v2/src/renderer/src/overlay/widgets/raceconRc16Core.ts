import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import {
  type Rc01ChannelName,
  type Rc01ChannelReceipt,
  type Rc01DashboardModel,
  type Rc01Field,
  createRc01DashboardModel,
  rc01MonotonicNow,
  rc01ReceiptAgeMs
} from './raceconRc01Core'

/**
 * RaceCon RC-16 "Learn Lines - Novice Coaching & Consistency".
 *
 * A calm coaching page, not a driver attack page. Packet section 1 title is authoritative; the
 * informal alias "Learn Lines" on its own is not a title and is never used alone in code or UI.
 *
 * RC-16 shares RC-01's fail-closed ingest machinery verbatim — `Rc01LiveTelemetryBuffer`, its
 * receipts, `createRc01DashboardModel` and `rc01FieldDescription` — so mock and replay telemetry are
 * refused, a source discontinuity quarantines the stream, and the delta / RPM / best-lap channels
 * carry RC-01's freshness budgets rather than a fork of them. Only the coaching layer is new:
 * the lap ledger, the dispersion window, the throttle-smoothness integrator, the ring geometry and
 * the single-cue selector.
 *
 * THREE THINGS THIS ARTIFACT MEASURES RATHER THAN READS, and the guards that keep them honest:
 *
 *  1. **Consistency band** is lap-time dispersion over a trailing 3-lap window. A lap enters the
 *     ledger only when the widget OBSERVED the lap counter advance while the buffer was live, so a
 *     mid-session mount can never inherit a previous session's laps, and the >= 3-lap gate is a gate
 *     on genuinely observed laps.
 *  2. **Throttle smoothness** is a pedal-rate integral. It is published for a lap only when that lap
 *     was observed from its FIRST frame and the throttle channel never gapped inside it — a
 *     mid-lap mount or a dropout produces `null`, never a partial grade. Packet 16 defines the unit
 *     as "index" with no range and no formula, so the scale is declared here (see
 *     `RC16_PACKET_OMISSIONS.smoothnessIndexScale`).
 *  3. **Ring tightness** is the encoded quantity. The mint ring's radius is an arithmetic function
 *     of the dispersion and is clamped so its outer edge can never come closer than
 *     `RC16_RING_MIN_SEPARATION_PX` to the guide circle: the encoding physically cannot collapse.
 *     With no dispersion the mint ring is ABSENT, never parked at a plausible radius.
 *
 * Every packet contradiction resolved by omission or by an explicit normative override is recorded
 * in `RC16_PACKET_OMISSIONS` and asserted by the suite, so none of them can be silently dropped.
 */

// ──────────────────────────────────────────────────────────── canonical identity

/**
 * The canonical literals the catalog wiring PR registers. They live here so the widget, the suite
 * and the wiring PR read one source of truth: this branch deliberately does not widen
 * `OverlayWidgetId`, add a preset or touch the identity catalog, because those shared files are
 * owned by the separate wiring change that registers every new widget at once.
 */
export const RC16_WIDGET_ID = 'raceconRc16Dash'
export const RC16_PRESET_ID = 'racecon_rc16_dash'
export const RC16_DISPLAY_NAME = 'RaceCon RC-16 Learn Lines - Novice Coaching & Consistency'

// ──────────────────────────────────────────────────────────── canvas and breakpoints

export const RC16_NATIVE_WIDTH_PX = 800
export const RC16_NATIVE_HEIGHT_PX = 480
export const RC16_NATIVE_TOLERANCE_PX = 1
export const RC16_APP_WIDTH_PX = 1024
export const RC16_APP_HEIGHT_PX = 600

export const RC16_PHONE_MIN_WIDTH_PX = 360
export const RC16_PHONE_MAX_WIDTH_PX = 480
export const RC16_PHONE_MIN_HEIGHT_PX = 650
export const RC16_LANDSCAPE_MIN_WIDTH_PX = 650
export const RC16_LANDSCAPE_MIN_HEIGHT_PX = 360
export const RC16_LANDSCAPE_MAX_HEIGHT_PX = 480

export type Rc16Layout = 'native' | 'app' | 'compact'
export type Rc16CompactMode = 'phone' | 'landscape' | 'standard'

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function round3(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

// ──────────────────────────────────────────────────────────── packet omissions and overrides

/**
 * Every RC-16 packet contradiction, resolved in code rather than by editing the packet. The packet
 * files are left byte-identical by instruction; this constant IS the deviation record and the suite
 * asserts every key, so an omission cannot be quietly deleted with the behaviour it documents.
 */
export const RC16_PACKET_OMISSIONS = Object.freeze({
  shiftLightZone:
    'OV-1 / ZG-1: packet 11.4, 14 and the section 15 Gentle over-rev alert all require shift lights, and 16 defines Engine RPM, but neither 11.1 nor 12.1 gives them a zone: no LED arc and no shift zone is invented, and the over-rev alert surfaces as the soft upshift CUE the alert table itself specifies, inside the existing packet 11.1 cue-card zone',
  deltaAppZone:
    'OV-2 / ZG-4: Delta to best is a section 10 PRIMARY channel with a zone at 800x480 and none at all in 12.1, so a primary channel would vanish as the view grows: RC-16 publishes the strip beneath the cue card, x=716 y=400 w=260 h=160, as the 1024x600 Delta zone rather than letting implementers improvise',
  typeScaleStep:
    'OV-4: packet 11.2 steps Delta 44 px to Smoothness 40 px, only 2.88 px of cap height and unmeasurable in a raster render: the ladder is implemented ARITHMETICALLY from 11.2 verbatim (56/44/40/34/28) and is therefore strictly ordered and unit-tested, so the packet-owner re-spacing OV-4 recommends is not applied to the DOM',
  labelTypeRank:
    'packet 11.2 sizes five VALUE ranks and no label rank, while the approved brief requires one shared label size smaller than every value it labels: RC16_LABEL_PX = 18 is declared here as the single label rung',
  normalToken:
    'OV-5: packet 11.3 normal #46D08A and signature #7AE0B0 are dE76 17.28 apart with 2.19 degrees of hue, so they merge under deuteranopia and defeat packet 19: normal is declared for completeness and NEVER referenced, the ring uses signature alone and the smoothness fill uses info',
  dangerToken:
    'packet 14 states there is no harsh critical state by design and 18 forbids aggressive red warnings, so danger #F0603E is declared for completeness and never referenced: RC-16 has no red surface at all',
  consistencyRecap:
    'OV-6: packet 11.2 prints the consistency band in the ring centre and 11.1 prints it again in the Lap summary: both surfaces render ONE model field instance so they can never diverge',
  deltaRowHeight:
    'OV-7: the 800x480 Delta calm zone is 60 px tall and 11.2 asks for 44 px type, which needs 76.2 px stacked and does not fit: label, value and unit are set on ONE inline row, and the placeholder is standardised to two decimals (--.--) to match the two-decimal value',
  cueCornerId:
    'OV-8: packet 11.1 examples the cue "BRAKE EARLIER T4" but section 16 defines no corner or segment channel: no cue names a corner, and the cue words are coaching copy from the 11.5 biggest-opportunity selector, never telemetry',
  cornerSpeedAndGearZone:
    'ZG-2: Minimum corner speed and Gear are section 10 SECONDARY telemetry with no zone on either canvas: neither is rendered and neither is derived from another channel, rather than inventing the unallocated lower-right strip',
  speedRpmBestLapZone:
    'ZG-3: Speed, Engine RPM and Best lap time are section 10 TERTIARY with no zone on either canvas: none is printed. Best lap is still required internally as the Delta reference and RPM as the over-rev trigger, so their greyed and frozen staleness renderings have no visible surface',
  consistencyHistoryDepth:
    'ZG-5: the 12.1 Consistency history needs a per-lap band SERIES and section 16 defines the band as a single per-lap value with no retention depth: RC-16 publishes a 20-lap window, every point inherits the >= 3-lap gate, and a missing lap is drawn as a gap and never interpolated across',
  focusSelectorZone:
    'ZG-6: section 13 lists a Focus-area selector and 11.5 a macro button, and no zone exists for either: the selector is a purely off-screen input so the packet 11.1 five-zone geometry is preserved intact',
  smoothnessIndexScale:
    'packet 16 gives Throttle smoothness the unit "index" with no range, no formula and no threshold: RC-16 declares a 0-100 index measured as mean absolute pedal travel per second against RC16_SMOOTHNESS_FULL_SCALE_PCT_PER_S, and the packet owner must ratify the scale',
  brakeSmoothness:
    'packet 15 triggers Rough input on a "throttle/brake smoothness metric" while section 16 defines a THROTTLE smoothness channel only: the metric is measured from throttle alone and no brake term is invented'
})

// ──────────────────────────────────────────────────────────── palette

/** Packet 11.3, verbatim. */
export const RC16_TOKENS = Object.freeze({
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

export type Rc16Token = keyof typeof RC16_TOKENS

/** Zero pixels of any of these while every alert is silent — no alert token is decoration. */
export const RC16_SILENT_TOKENS = Object.freeze(['normal', 'caution', 'danger'] as const)

/** Declared for packet completeness and never referenced by any rule. See OV-5 and packet 14. */
export const RC16_UNUSED_TOKENS = Object.freeze(['normal', 'danger'] as const)

// ──────────────────────────────────────────────────────────── typography

/** Packet 11.2 verbatim, in 800x480 pixels. See `RC16_PACKET_OMISSIONS.typeScaleStep`. */
export const RC16_TYPE_SCALE_PX = Object.freeze({
  ringValue: 56,
  delta: 44,
  smoothness: 40,
  cue: 34,
  summary: 28
})

/** The one label rung. Packet 11.2 sizes no label; the brief requires a single shared size. */
export const RC16_LABEL_PX = 18

/** Descending rank order the suite asserts is strict. */
export const RC16_TYPE_RANK_ORDER = Object.freeze(['ringValue', 'delta', 'smoothness', 'cue', 'summary'] as const)

export const RC16_CQW_PX = RC16_NATIVE_WIDTH_PX / 100

export function rc16TypeScaleCqw(px: number): number {
  return round3(px / RC16_CQW_PX)
}

export function rc16TypeScalePxForWidth(px: number, canvasWidthPx: number): number {
  return round3((rc16TypeScaleCqw(px) * canvasWidthPx) / 100)
}

// ──────────────────────────────────────────────────────────── zone geometry

export interface Rc16RectPx {
  x: number
  y: number
  width: number
  height: number
}

export interface Rc16Rect {
  left: number
  top: number
  width: number
  height: number
}

export type Rc16ZoneId = 'ring' | 'smoothness' | 'cue' | 'delta' | 'summary' | 'history'
export type Rc16ZoneMapPx = Readonly<Partial<Record<Rc16ZoneId, Rc16RectPx>>>
export type Rc16ZoneMap = Readonly<Partial<Record<Rc16ZoneId, Rc16Rect>>>

/** Packet 11.1, verbatim. Five zones, 49.06 % coverage — the calm empty half is deliberate. */
export const RC16_NATIVE_ZONES_PX: Rc16ZoneMapPx = Object.freeze({
  ring: Object.freeze({ x: 270, y: 50, width: 260, height: 260 }),
  smoothness: Object.freeze({ x: 40, y: 80, width: 200, height: 200 }),
  cue: Object.freeze({ x: 560, y: 80, width: 200, height: 200 }),
  delta: Object.freeze({ x: 300, y: 320, width: 200, height: 60 }),
  summary: Object.freeze({ x: 40, y: 320, width: 240, height: 120 })
})

/**
 * Packet 12.1 verbatim for five zones, plus the Delta zone the packet omits. See OV-2: Delta is a
 * section 10 PRIMARY channel and must not vanish when the view grows, so RC-16 publishes the strip
 * beneath the cue card and mirrors the Lap summary rectangle on the opposite side.
 */
export const RC16_APP_DELTA_ZONE_PX: Rc16RectPx = Object.freeze({ x: 716, y: 400, width: 260, height: 160 })

export const RC16_APP_ZONES_PX: Rc16ZoneMapPx = Object.freeze({
  ring: Object.freeze({ x: 372, y: 60, width: 300, height: 300 }),
  smoothness: Object.freeze({ x: 48, y: 80, width: 260, height: 300 }),
  cue: Object.freeze({ x: 716, y: 80, width: 260, height: 300 }),
  history: Object.freeze({ x: 372, y: 380, width: 300, height: 180 }),
  summary: Object.freeze({ x: 48, y: 400, width: 260, height: 160 }),
  delta: RC16_APP_DELTA_ZONE_PX
})

/** Packet 12.1 expansion model `coaching-history-reveal`: the history never enters 800x480. */
export const RC16_APP_ONLY_ZONES = Object.freeze(['history'] as const)

export const RC16_ZONE_IDS = Object.freeze([
  'ring',
  'smoothness',
  'cue',
  'delta',
  'summary',
  'history'
] as const)

export function rc16LayoutForContentBox(width: number, height: number): Rc16Layout {
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return 'app'
  if (
    Math.abs(width - RC16_NATIVE_WIDTH_PX) <= RC16_NATIVE_TOLERANCE_PX &&
    Math.abs(height - RC16_NATIVE_HEIGHT_PX) <= RC16_NATIVE_TOLERANCE_PX
  ) {
    return 'native'
  }
  if (width >= RC16_APP_WIDTH_PX - 1 && height >= RC16_APP_HEIGHT_PX - 1) return 'app'
  return 'compact'
}

export function rc16CompactModeForContentBox(width: number, height: number): Rc16CompactMode {
  if (rc16LayoutForContentBox(width, height) !== 'compact') return 'standard'
  if (
    width >= RC16_PHONE_MIN_WIDTH_PX &&
    width <= RC16_PHONE_MAX_WIDTH_PX &&
    height >= RC16_PHONE_MIN_HEIGHT_PX &&
    height / width >= 1.5
  ) {
    return 'phone'
  }
  if (
    width >= RC16_LANDSCAPE_MIN_WIDTH_PX &&
    height >= RC16_LANDSCAPE_MIN_HEIGHT_PX &&
    height <= RC16_LANDSCAPE_MAX_HEIGHT_PX &&
    width / height >= 1.5
  ) {
    return 'landscape'
  }
  return 'standard'
}

/**
 * Compact grammars reflow — they are not a uniform scale of 800x480. The consistency history is an
 * app-only reveal (packet 12.1) and is absent from every compact mode as well as from the native
 * canvas, so the calm single-ring single-cue composition survives every breakpoint.
 */
function rc16CompactZonesPx(mode: Rc16CompactMode, width: number, height: number): Rc16ZoneMapPx {
  const rect = (x: number, y: number, w: number, h: number): Rc16RectPx =>
    Object.freeze({ x: round3(width * x), y: round3(height * y), width: round3(width * w), height: round3(height * h) })

  if (mode === 'phone') {
    return Object.freeze({
      smoothness: rect(0.04, 0.03, 0.44, 0.16),
      cue: rect(0.52, 0.03, 0.44, 0.16),
      ring: rect(0.15, 0.22, 0.7, 0.4),
      delta: rect(0.15, 0.64, 0.7, 0.1),
      summary: rect(0.04, 0.76, 0.92, 0.2)
    })
  }
  if (mode === 'landscape') {
    return Object.freeze({
      smoothness: rect(0.03, 0.08, 0.22, 0.6),
      ring: rect(0.3, 0.05, 0.4, 0.66),
      cue: rect(0.75, 0.08, 0.22, 0.6),
      delta: rect(0.3, 0.74, 0.4, 0.2),
      summary: rect(0.03, 0.72, 0.25, 0.24)
    })
  }
  return Object.freeze({
    smoothness: rect(0.04, 0.06, 0.24, 0.44),
    ring: rect(0.32, 0.04, 0.36, 0.5),
    cue: rect(0.72, 0.06, 0.24, 0.44),
    delta: rect(0.32, 0.58, 0.36, 0.14),
    summary: rect(0.04, 0.56, 0.26, 0.36)
  })
}

function canvasSizePx(layout: Rc16Layout): { width: number; height: number } {
  return layout === 'app'
    ? { width: RC16_APP_WIDTH_PX, height: RC16_APP_HEIGHT_PX }
    : { width: RC16_NATIVE_WIDTH_PX, height: RC16_NATIVE_HEIGHT_PX }
}

export function rc16ZonesPxForLayout(
  layout: Rc16Layout,
  compactMode: Rc16CompactMode = 'standard',
  box: { width: number; height: number } = canvasSizePx(layout)
): Rc16ZoneMapPx {
  if (layout === 'native') return RC16_NATIVE_ZONES_PX
  if (layout === 'app') return RC16_APP_ZONES_PX
  return rc16CompactZonesPx(compactMode, box.width, box.height)
}

export function rc16RectPercent(rect: Rc16RectPx, canvasWidth: number, canvasHeight: number): Rc16Rect {
  return {
    left: round6((rect.x / canvasWidth) * 100),
    top: round6((rect.y / canvasHeight) * 100),
    width: round6((rect.width / canvasWidth) * 100),
    height: round6((rect.height / canvasHeight) * 100)
  }
}

export function rc16ZonesForLayout(
  layout: Rc16Layout,
  compactMode: Rc16CompactMode = 'standard',
  box: { width: number; height: number } = canvasSizePx(layout)
): Rc16ZoneMap {
  const canvas = layout === 'compact' ? box : canvasSizePx(layout)
  const source = rc16ZonesPxForLayout(layout, compactMode, box)
  const out: Partial<Record<Rc16ZoneId, Rc16Rect>> = {}
  for (const id of RC16_ZONE_IDS) {
    const rect = source[id]
    if (rect) out[id] = rc16RectPercent(rect, canvas.width, canvas.height)
  }
  return Object.freeze(out)
}

export function rc16Percent(value: number): string {
  return `${round3(value)}%`
}

export function rc16ZoneStyle(
  rect: Rc16Rect | undefined
): { left: string; top: string; width: string; height: string } | null {
  if (!rect) return null
  return {
    left: rc16Percent(rect.left),
    top: rc16Percent(rect.top),
    width: rc16Percent(rect.width),
    height: rc16Percent(rect.height)
  }
}

export function rc16RectsOverlap(a: Rc16Rect, b: Rc16Rect): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  )
}

// ──────────────────────────────────────────────────────────── consistency ring geometry

/**
 * Brief section 2, in canvas-width percentages: common centre 50.00 % / 37.50 %, guide radius
 * 15.00 %, mint stroke 1.50 %, inner disc 10.50 %, nominal mint mid radius 12.00 % giving an 18 px
 * radial gap at 800x480.
 */
export const RC16_RING_CENTRE_X_PCT = 50
export const RC16_RING_CENTRE_Y_PCT = 37.5
export const RC16_RING_GUIDE_RADIUS_PCT = 15
export const RC16_RING_STROKE_PCT = 1.5
export const RC16_RING_DISC_RADIUS_PCT = 10.5
export const RC16_RING_NOMINAL_MID_RADIUS_PCT = 12

/**
 * Brief section 1: the encoded quantity can never collapse, so the mint ring's OUTER edge stops
 * 8 px short of the guide circle at 800x480. 8 px is 1.00 % of the canvas width, which puts the
 * widest mint mid radius at 15.00 - 1.00 - 0.75 = 13.25 %. The tightest radius keeps the mint
 * ring's INNER edge 2 px clear of the inner disc.
 */
export const RC16_RING_MIN_SEPARATION_PX = 8
export const RC16_RING_MAX_MID_RADIUS_PCT = 13.25
export const RC16_RING_MIN_MID_RADIUS_PCT = 11.5

/**
 * Dispersion mapped onto the radius. Chosen so the approved reference frame's 0.42 s band lands on
 * the packet's nominal 12.00 % mid radius to within 0.01 pp, and so a wider band always pushes the
 * mint ring OUTWARD — packet 11.1: the smaller the radial gap, the wider the dispersion.
 */
export const RC16_DISPERSION_FULL_SCALE_S = 1.5

export interface Rc16Ring {
  centreXPct: number
  centreYPct: number
  guideRadiusPct: number
  discRadiusPct: number
  strokePct: number
  midRadiusPct: number | null
  outerRadiusPct: number | null
  innerRadiusPct: number | null
  gapPct: number | null
  gapPx: number | null
  available: boolean
}

export function rc16RingMidRadiusPct(dispersionSec: number | null): number | null {
  if (!finite(dispersionSec) || dispersionSec < 0) return null
  const span = RC16_RING_MAX_MID_RADIUS_PCT - RC16_RING_MIN_MID_RADIUS_PCT
  const fraction = clamp(dispersionSec / RC16_DISPERSION_FULL_SCALE_S, 0, 1)
  return round3(RC16_RING_MIN_MID_RADIUS_PCT + fraction * span)
}

/**
 * The whole ring assembly. With no dispersion the mint ring is ABSENT — the guide circle and the
 * inner disc still render the structure, but nothing is parked at a plausible radius, because a
 * radius IS the value on this artifact.
 */
export function rc16RingGeometry(dispersionSec: number | null): Rc16Ring {
  const mid = rc16RingMidRadiusPct(dispersionSec)
  if (mid === null) {
    return {
      centreXPct: RC16_RING_CENTRE_X_PCT,
      centreYPct: RC16_RING_CENTRE_Y_PCT,
      guideRadiusPct: RC16_RING_GUIDE_RADIUS_PCT,
      discRadiusPct: RC16_RING_DISC_RADIUS_PCT,
      strokePct: RC16_RING_STROKE_PCT,
      midRadiusPct: null,
      outerRadiusPct: null,
      innerRadiusPct: null,
      gapPct: null,
      gapPx: null,
      available: false
    }
  }
  const half = RC16_RING_STROKE_PCT / 2
  const outer = round3(mid + half)
  const gapPct = round3(RC16_RING_GUIDE_RADIUS_PCT - outer)
  return {
    centreXPct: RC16_RING_CENTRE_X_PCT,
    centreYPct: RC16_RING_CENTRE_Y_PCT,
    guideRadiusPct: RC16_RING_GUIDE_RADIUS_PCT,
    discRadiusPct: RC16_RING_DISC_RADIUS_PCT,
    strokePct: RC16_RING_STROKE_PCT,
    midRadiusPct: mid,
    outerRadiusPct: outer,
    innerRadiusPct: round3(mid - half),
    gapPct,
    gapPx: round3((gapPct / 100) * RC16_NATIVE_WIDTH_PX),
    available: true
  }
}

/**
 * The ring draws into its own square zone with `preserveAspectRatio`, so a canvas-width percentage
 * becomes a viewBox radius by rescaling against the zone's own width. That is what keeps all three
 * circles TRUE circles on a 5:3 canvas and at every compact breakpoint.
 */
export function rc16RingViewBoxRadius(canvasPct: number): number {
  const zone = RC16_NATIVE_ZONES_PX.ring
  if (!zone) return 0
  return round3(((canvasPct / 100) * RC16_NATIVE_WIDTH_PX * 100) / zone.width)
}

// ──────────────────────────────────────────────────────────── channels and freshness

/**
 * Packet section 16 freshness budgets, verbatim. Only `delta`, `rpm` and `bestLap` have a bound
 * surface or trigger; `gear`, `speed` and their staleness renderings have no zone on either canvas
 * (ZG-2 / ZG-3) and are therefore never drawn.
 */
export const RC16_PACKET_FRESHNESS_MS = Object.freeze({
  gear: 50,
  speed: 100,
  speedStale: 500,
  rpm: 20,
  rpmStale: 200,
  delta: 250,
  bestLap: 2_000,
  lastLap: 2_000
})

/** The one channel RC-01's receipt set does not already carry. */
export const RC16_CHANNEL_STALE_MS = {
  lastLap: RC16_PACKET_FRESHNESS_MS.lastLap
} as const

export type Rc16AuxChannel = keyof typeof RC16_CHANNEL_STALE_MS

export function rc16AuxChannelValue(snapshot: TelemetrySnapshot, channel: Rc16AuxChannel): number | null {
  if (channel === 'lastLap') {
    const value = snapshot.lastLapTimeSec
    return finite(value) && value > 0 ? value : null
  }
  return null
}

/**
 * The lap identity RC-16 counts on. `currentLap` is preferred because a change in the lap IN
 * PROGRESS is exactly the laptrigger event; `completedLaps` is the fallback for providers that omit
 * it. Never derived from lap distance, session time or anything else.
 */
export function rc16LapCounter(snapshot: TelemetrySnapshot | null | undefined): number | null {
  if (!snapshot) return null
  const current = snapshot.currentLap
  if (finite(current) && Number.isInteger(current) && current >= 0) return current
  const completed = snapshot.completedLaps
  if (finite(completed) && Number.isInteger(completed) && completed >= 0) return completed
  return null
}

// ──────────────────────────────────────────────────────────── coaching buffer

export interface Rc16LapRecord {
  readonly lap: number
  readonly lapTimeSec: number
  /** null whenever the lap was not observed from its first frame or the throttle channel gapped. */
  readonly smoothnessIndex: number | null
  readonly receivedAt: number
}

/** ZG-5: the published retention depth for the 12.1 consistency history. */
export const RC16_LAP_HISTORY_LIMIT = 20

/** Packet 16 / 15: consistency needs at least three laps and a three-lap window. */
export const RC16_CONSISTENCY_MIN_LAPS = 3
export const RC16_CONSISTENCY_WINDOW_LAPS = 3

/**
 * Smoothness scale. Packet 16 says "index" and nothing else, so RC-16 declares it: mean absolute
 * throttle travel per second across the lap, where 200 %/s of pedal travel is index 0 and a
 * perfectly held pedal is index 100. See `RC16_PACKET_OMISSIONS.smoothnessIndexScale`.
 */
export const RC16_SMOOTHNESS_FULL_SCALE_PCT_PER_S = 200
export const RC16_SMOOTHNESS_MIN_SAMPLES = 8
export const RC16_SMOOTHNESS_MAX_SAMPLE_GAP_MS = 1_000

export function rc16SmoothnessIndex(meanRatePctPerSec: number | null): number | null {
  if (!finite(meanRatePctPerSec) || meanRatePctPerSec < 0) return null
  return Math.round(clamp(100 * (1 - meanRatePctPerSec / RC16_SMOOTHNESS_FULL_SCALE_PCT_PER_S), 0, 100))
}

function throttleFraction(snapshot: TelemetrySnapshot): number | null {
  const value = snapshot.throttle
  return finite(value) ? clamp(value, 0, 1) : null
}

/**
 * The coaching ledger: observed laps, their times, and the smoothness measured inside them.
 *
 * It is cloned-then-committed exactly like RC-01's buffer so a StrictMode double render or an
 * abandoned concurrent render can never advance real state, and it is reset whenever the shared
 * ingest buffer refuses a frame, so a new source never inherits the previous session's laps.
 */
export class Rc16CoachingBuffer {
  private records: Rc16LapRecord[] = []
  private channelReceipts = new Map<Rc16AuxChannel, Rc01ChannelReceipt>()
  private lapNumber: number | null = null
  private observedWhole = false
  private travelSum = 0
  private intervalSumMs = 0
  private sampleCount = 0
  private throttleGap = false
  private previousThrottle: number | null = null
  private previousReceivedAt: number | null = null

  clone(): Rc16CoachingBuffer {
    const next = new Rc16CoachingBuffer()
    next.records = [...this.records]
    next.channelReceipts = new Map(this.channelReceipts)
    next.lapNumber = this.lapNumber
    next.observedWhole = this.observedWhole
    next.travelSum = this.travelSum
    next.intervalSumMs = this.intervalSumMs
    next.sampleCount = this.sampleCount
    next.throttleGap = this.throttleGap
    next.previousThrottle = this.previousThrottle
    next.previousReceivedAt = this.previousReceivedAt
    return next
  }

  reset(): void {
    this.records = []
    this.channelReceipts = new Map()
    this.lapNumber = null
    this.observedWhole = false
    this.resetLapAccumulator(false)
  }

  private resetLapAccumulator(observedWhole: boolean): void {
    this.observedWhole = observedWhole
    this.travelSum = 0
    this.intervalSumMs = 0
    this.sampleCount = 0
    this.throttleGap = false
    this.previousThrottle = null
    this.previousReceivedAt = null
  }

  private lapSmoothness(): number | null {
    if (this.throttleGap) return null
    if (!this.observedWhole) return null
    if (this.sampleCount < RC16_SMOOTHNESS_MIN_SAMPLES) return null
    if (this.intervalSumMs <= 0) return null
    const meanRate = (this.travelSum * 100) / (this.intervalSumMs / 1_000)
    return rc16SmoothnessIndex(meanRate)
  }

  ingest(snapshot: TelemetrySnapshot | null | undefined, receivedAt: number = rc01MonotonicNow()): void {
    if (!snapshot || !snapshot.connected || !finite(snapshot.timestamp)) return

    for (const channel of Object.keys(RC16_CHANNEL_STALE_MS) as Rc16AuxChannel[]) {
      const value = rc16AuxChannelValue(snapshot, channel)
      if (value === null) continue
      this.channelReceipts.set(channel, {
        snapshotTimestamp: snapshot.timestamp,
        receivedAt,
        value
      })
    }

    const lap = rc16LapCounter(snapshot)
    if (lap === null) {
      // No lap identity means no laptrigger. Nothing can be attributed to a lap, so the accumulator
      // is discarded rather than credited to whatever lap arrives next.
      this.resetLapAccumulator(false)
      this.lapNumber = null
      return
    }

    if (this.lapNumber === null) {
      // Mounted mid-lap: the lap in progress was NOT observed from its first frame, so its
      // smoothness can never be published.
      this.lapNumber = lap
      this.resetLapAccumulator(false)
    } else if (lap !== this.lapNumber) {
      const closed = this.lapNumber
      const lapTimeSec = rc16AuxChannelValue(snapshot, 'lastLap')
      if (lapTimeSec !== null) {
        this.records = [
          ...this.records,
          { lap: closed, lapTimeSec: round3(lapTimeSec), smoothnessIndex: this.lapSmoothness(), receivedAt }
        ].slice(-RC16_LAP_HISTORY_LIMIT)
      }
      this.lapNumber = lap
      // The NEW lap begins at the frame that opened it, so it is observed whole.
      this.resetLapAccumulator(true)
    }

    const throttle = throttleFraction(snapshot)
    if (throttle === null) {
      this.throttleGap = true
      this.previousThrottle = null
      this.previousReceivedAt = null
      return
    }
    if (this.previousThrottle !== null && this.previousReceivedAt !== null) {
      const dt = receivedAt - this.previousReceivedAt
      if (dt > 0 && dt <= RC16_SMOOTHNESS_MAX_SAMPLE_GAP_MS) {
        this.travelSum += Math.abs(throttle - this.previousThrottle)
        this.intervalSumMs += dt
        this.sampleCount += 1
      }
    }
    this.previousThrottle = throttle
    this.previousReceivedAt = receivedAt
  }

  laps(): readonly Rc16LapRecord[] {
    return this.records
  }

  receipts(): ReadonlyMap<Rc16AuxChannel, Rc01ChannelReceipt> {
    return this.channelReceipts
  }

  /** True once a lap has been observed from its first frame, so its smoothness may be published. */
  observedWholeLap(): boolean {
    return this.observedWhole
  }

  currentLap(): number | null {
    return this.lapNumber
  }
}

export function createRc16AuxReceipts(
  snapshot: TelemetrySnapshot,
  receivedAt: number = rc01MonotonicNow()
): ReadonlyMap<Rc16AuxChannel, Rc01ChannelReceipt> {
  const buffer = new Rc16CoachingBuffer()
  buffer.ingest(snapshot, receivedAt)
  return buffer.receipts()
}

// ──────────────────────────────────────────────────────────── consistency window and history

/**
 * Lap-time dispersion across the trailing 3-lap window, in seconds. Returns null until three laps
 * have genuinely been observed — packet 16: never present consistency before enough laps.
 */
export function rc16DispersionSec(
  laps: readonly Rc16LapRecord[],
  endIndex: number = laps.length - 1,
  window: number = RC16_CONSISTENCY_WINDOW_LAPS
): number | null {
  if (endIndex < window - 1 || endIndex >= laps.length) return null
  if (laps.length < RC16_CONSISTENCY_MIN_LAPS) return null
  const slice = laps.slice(endIndex - window + 1, endIndex + 1)
  if (slice.length < window) return null
  const times = slice.map((entry) => entry.lapTimeSec)
  return round3(Math.max(...times) - Math.min(...times))
}

export interface Rc16HistoryPoint {
  readonly lap: number
  readonly dispersionSec: number | null
  readonly available: boolean
  /** True when the ledger holds no record for this lap number: drawn as a gap, never bridged. */
  readonly gap: boolean
}

/**
 * ZG-5: the per-lap band series. Every point inherits the >= 3-lap gate, and a lap the widget never
 * observed is published as an explicit gap rather than interpolated across.
 */
export function rc16ConsistencyHistory(laps: readonly Rc16LapRecord[]): readonly Rc16HistoryPoint[] {
  if (laps.length === 0) return Object.freeze([])
  const firstLap = laps[0].lap
  const lastLap = laps[laps.length - 1].lap
  if (lastLap < firstLap) return Object.freeze([])
  const points: Rc16HistoryPoint[] = []
  const start = Math.max(firstLap, lastLap - RC16_LAP_HISTORY_LIMIT + 1)
  for (let lap = start; lap <= lastLap; lap += 1) {
    const index = laps.findIndex((entry) => entry.lap === lap)
    if (index < 0) {
      points.push(Object.freeze({ lap, dispersionSec: null, available: false, gap: true }))
      continue
    }
    const dispersion = rc16DispersionSec(laps, index)
    points.push(
      Object.freeze({ lap, dispersionSec: dispersion, available: dispersion !== null, gap: false })
    )
  }
  return Object.freeze(points)
}

// ──────────────────────────────────────────────────────────── dash states and formatters

export const RC16_DASH = Object.freeze({
  consistency: '--',
  smoothness: '--',
  /** OV-7: two decimals, so the placeholder and the value have the same width. */
  delta: '--.--',
  lapTime: '--:--.---',
  cue: '--'
})

export const RC16_NO_CUE_NOTICE = 'NO COACHING SOURCE'
export const RC16_NO_HISTORY_NOTICE = 'NO LAP HISTORY'
export const RC16_CONSISTENCY_GATE_NOTICE = 'NEEDS 3 LAPS'
export const RC16_SMOOTHNESS_GATE_NOTICE = 'NEEDS A FULL LAP'

export function rc16FormatDispersion(seconds: number | null): string {
  if (!finite(seconds) || seconds < 0) return RC16_DASH.consistency
  return seconds.toFixed(2)
}

export function rc16FormatSmoothness(index: number | null): string {
  if (!finite(index)) return RC16_DASH.smoothness
  return String(Math.round(clamp(index, 0, 100)))
}

export function rc16FormatDelta(seconds: number | null): string {
  if (!finite(seconds)) return RC16_DASH.delta
  return `${seconds >= 0 ? '+' : '-'}${Math.abs(seconds).toFixed(2)}`
}

export function rc16FormatLapTime(seconds: number | null): string {
  if (!finite(seconds) || seconds <= 0) return RC16_DASH.lapTime
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  const whole = Math.floor(rest)
  const millis = Math.round((rest - whole) * 1_000)
  const carrySecond = millis === 1_000
  return `${minutes}:${String(carrySecond ? whole + 1 : whole).padStart(2, '0')}.${String(
    carrySecond ? 0 : millis
  ).padStart(3, '0')}`
}

function field(
  value: string,
  raw: number | string | null,
  stale = false,
  unavailable = false,
  tone: Rc01Field['tone'] = 'primary'
): Rc01Field {
  return { value, raw, stale, unavailable, tone }
}

// ──────────────────────────────────────────────────────────── the single coaching cue

export type Rc16FocusArea = 'braking' | 'throttle' | 'line'

export const RC16_FOCUS_AREAS = Object.freeze(['braking', 'throttle', 'line'] as const)

export function rc16NextFocusArea(area: Rc16FocusArea): Rc16FocusArea {
  const index = RC16_FOCUS_AREAS.indexOf(area)
  return RC16_FOCUS_AREAS[(index + 1) % RC16_FOCUS_AREAS.length]
}

export type Rc16CueId =
  | 'overRev'
  | 'roughInput'
  | 'consistencyBraking'
  | 'consistencyThrottle'
  | 'consistencyLine'
  | 'focusBraking'
  | 'focusThrottle'
  | 'focusLine'
  | 'unavailable'

export type Rc16CueIcon = 'upshift' | 'smooth' | 'ring' | 'line' | 'none'

/**
 * Packet 11.5: exactly one cue, chosen by biggest opportunity. OV-8: no cue names a corner, because
 * section 16 defines no corner or segment channel. Two short lines, never a sentence.
 */
export const RC16_CUES: Readonly<
  Record<Rc16CueId, { readonly lines: readonly [string, string]; readonly icon: Rc16CueIcon }>
> = Object.freeze({
  overRev: Object.freeze({ lines: Object.freeze(['EASE OFF', 'UPSHIFT'] as const), icon: 'upshift' as const }),
  roughInput: Object.freeze({ lines: Object.freeze(['SMOOTH', 'THE THROTTLE'] as const), icon: 'smooth' as const }),
  consistencyBraking: Object.freeze({ lines: Object.freeze(['BRAKE', 'EARLIER'] as const), icon: 'ring' as const }),
  consistencyThrottle: Object.freeze({ lines: Object.freeze(['FEED', 'THE THROTTLE'] as const), icon: 'ring' as const }),
  consistencyLine: Object.freeze({ lines: Object.freeze(['HOLD', 'YOUR LINE'] as const), icon: 'ring' as const }),
  focusBraking: Object.freeze({ lines: Object.freeze(['STEADY', 'BRAKING'] as const), icon: 'line' as const }),
  focusThrottle: Object.freeze({ lines: Object.freeze(['STEADY', 'THROTTLE'] as const), icon: 'line' as const }),
  focusLine: Object.freeze({ lines: Object.freeze(['REPEAT', 'THE LINE'] as const), icon: 'line' as const }),
  unavailable: Object.freeze({ lines: Object.freeze([RC16_DASH.cue, RC16_DASH.cue] as const), icon: 'none' as const })
})

export interface Rc16Cue {
  id: Rc16CueId
  lines: readonly [string, string]
  icon: Rc16CueIcon
  /** True only when an alert selected this cue. The resting cue is a layout zone, not the alert layer. */
  alert: boolean
  available: boolean
  notice: string | null
}

export interface Rc16CueInput {
  live: boolean
  focusArea: Rc16FocusArea
  overRev: boolean
  roughInput: boolean
  consistencyDrop: boolean
}

const RC16_CONSISTENCY_CUE_BY_FOCUS: Readonly<Record<Rc16FocusArea, Rc16CueId>> = Object.freeze({
  braking: 'consistencyBraking',
  throttle: 'consistencyThrottle',
  line: 'consistencyLine'
})

const RC16_FOCUS_CUE_BY_FOCUS: Readonly<Record<Rc16FocusArea, Rc16CueId>> = Object.freeze({
  braking: 'focusBraking',
  throttle: 'focusThrottle',
  line: 'focusLine'
})

function cueFor(id: Rc16CueId, alert: boolean, notice: string | null = null): Rc16Cue {
  const entry = RC16_CUES[id]
  return {
    id,
    lines: entry.lines,
    icon: entry.icon,
    alert,
    available: id !== 'unavailable',
    notice
  }
}

/**
 * Exactly one cue. The ladder is the packet 11.5 biggest-opportunity rule made deterministic:
 * a safety nudge outranks a technique nudge, which outranks a consistency nudge, which outranks the
 * resting focus-area encouragement. With no live frame the card publishes its empty state instead of
 * printing coaching copy nobody earned.
 */
export function rc16SelectCue(input: Rc16CueInput): Rc16Cue {
  if (!input.live) return cueFor('unavailable', false, RC16_NO_CUE_NOTICE)
  if (input.overRev) return cueFor('overRev', true)
  if (input.roughInput) return cueFor('roughInput', true)
  if (input.consistencyDrop) return cueFor(RC16_CONSISTENCY_CUE_BY_FOCUS[input.focusArea], true)
  return cueFor(RC16_FOCUS_CUE_BY_FOCUS[input.focusArea], false)
}

// ──────────────────────────────────────────────────────────── trigger-only alerts

export type Rc16AlertId = 'consistencyDrop' | 'roughInput' | 'gentleOverRev'

export const RC16_ALERT_IDS = Object.freeze(['consistencyDrop', 'roughInput', 'gentleOverRev'] as const)

/** Packet 15, verbatim. RC-01's over-rev release is 250 ms, so RC-16 does not reuse that machine. */
export const RC16_OVER_REV_ENTER_RATIO = 0.99
export const RC16_OVER_REV_EXIT_RATIO = 0.95
export const RC16_OVER_REV_ATTACK_MS = 60
export const RC16_OVER_REV_RELEASE_MS = 300

/** Consistency drop: per lap, over the 3-lap window. The margin keeps sampling noise silent. */
export const RC16_CONSISTENCY_DROP_MARGIN_S = 0.1

/** Rough input: per lap, with hysteresis so one clean lap is required to clear it. */
export const RC16_ROUGH_INPUT_ENTER_INDEX = 60
export const RC16_ROUGH_INPUT_EXIT_INDEX = 68

export interface Rc16AlertState {
  consistencyDrop: { active: boolean; lapsEvaluated: number; previousDispersionSec: number | null }
  roughInput: { active: boolean; lapsEvaluated: number }
  gentleOverRev: { active: boolean; pendingSinceMs: number | null; recoverySinceMs: number | null }
}

export interface Rc16AlertInput {
  nowMs: number
  lapCount: number
  dispersionSec: number | null
  smoothnessIndex: number | null
  rpmRatio: number | null
  rpmFresh: boolean
}

export function createRc16AlertState(): Rc16AlertState {
  return {
    consistencyDrop: { active: false, lapsEvaluated: 0, previousDispersionSec: null },
    roughInput: { active: false, lapsEvaluated: 0 },
    gentleOverRev: { active: false, pendingSinceMs: null, recoverySinceMs: null }
  }
}

/**
 * All three RC-16 alerts start silent and stay silent until their own trigger fires.
 *
 * The two coaching alerts are debounced BY THE LAP: their state advances only when the lap count
 * changes, which is precisely the packet's "per lap" debounce and makes a mid-lap flicker
 * impossible. The over-rev alert is the only time-domain machine, with the packet's 60 ms attack and
 * 300 ms release and a 99 % / 95 % hysteresis band.
 */
export function advanceRc16Alerts(state: Rc16AlertState, input: Rc16AlertInput): Rc16AlertState {
  const next: Rc16AlertState = {
    consistencyDrop: { ...state.consistencyDrop },
    roughInput: { ...state.roughInput },
    gentleOverRev: { ...state.gentleOverRev }
  }

  if (input.lapCount !== next.consistencyDrop.lapsEvaluated) {
    const dispersion = input.dispersionSec
    const previous = next.consistencyDrop.previousDispersionSec
    if (dispersion === null) {
      next.consistencyDrop.active = false
    } else if (previous === null) {
      next.consistencyDrop.active = false
    } else if (dispersion > previous + RC16_CONSISTENCY_DROP_MARGIN_S) {
      next.consistencyDrop.active = true
    } else if (dispersion <= previous) {
      next.consistencyDrop.active = false
    }
    next.consistencyDrop.previousDispersionSec = dispersion
    next.consistencyDrop.lapsEvaluated = input.lapCount
  }

  if (input.lapCount !== next.roughInput.lapsEvaluated) {
    const index = input.smoothnessIndex
    if (index === null) {
      next.roughInput.active = false
    } else if (index < RC16_ROUGH_INPUT_ENTER_INDEX) {
      next.roughInput.active = true
    } else if (index >= RC16_ROUGH_INPUT_EXIT_INDEX) {
      next.roughInput.active = false
    }
    next.roughInput.lapsEvaluated = input.lapCount
  }

  const ratio = input.rpmRatio
  if (!input.rpmFresh || !finite(ratio)) {
    next.gentleOverRev = { active: false, pendingSinceMs: null, recoverySinceMs: null }
  } else if (ratio > RC16_OVER_REV_ENTER_RATIO) {
    next.gentleOverRev.recoverySinceMs = null
    if (next.gentleOverRev.active) {
      next.gentleOverRev.pendingSinceMs = null
    } else {
      const since = next.gentleOverRev.pendingSinceMs ?? input.nowMs
      next.gentleOverRev.pendingSinceMs = since
      if (input.nowMs - since >= RC16_OVER_REV_ATTACK_MS) {
        next.gentleOverRev.active = true
        next.gentleOverRev.pendingSinceMs = null
      }
    }
  } else if (ratio < RC16_OVER_REV_EXIT_RATIO) {
    next.gentleOverRev.pendingSinceMs = null
    if (next.gentleOverRev.active) {
      const since = next.gentleOverRev.recoverySinceMs ?? input.nowMs
      next.gentleOverRev.recoverySinceMs = since
      if (input.nowMs - since >= RC16_OVER_REV_RELEASE_MS) {
        next.gentleOverRev.active = false
        next.gentleOverRev.recoverySinceMs = null
      }
    }
  } else {
    // Inside the hysteresis band: hold whatever is latched and abandon both pending timers.
    next.gentleOverRev.pendingSinceMs = null
    next.gentleOverRev.recoverySinceMs = null
  }

  return next
}

/** Every alert is unlatched by a stale or missing input, never left latched on dead telemetry. */
export function clearInvalidRc16Alerts(state: Rc16AlertState, model: Rc16DashboardModel): Rc16AlertState {
  const next: Rc16AlertState = {
    consistencyDrop: { ...state.consistencyDrop },
    roughInput: { ...state.roughInput },
    gentleOverRev: { ...state.gentleOverRev }
  }
  if (model.consistency.unavailable || model.consistency.stale) {
    next.consistencyDrop.active = false
  }
  if (model.smoothness.unavailable || model.smoothness.stale) {
    next.roughInput.active = false
  }
  if (!model.rpmFresh) {
    next.gentleOverRev = { active: false, pendingSinceMs: null, recoverySinceMs: null }
  }
  return next
}

export function rc16AlertInputForModel(model: Rc16DashboardModel, nowMs: number): Rc16AlertInput {
  return {
    nowMs,
    lapCount: model.lapCount,
    dispersionSec: model.dispersionSec,
    smoothnessIndex: model.smoothnessIndex,
    rpmRatio: model.rpmRatio,
    rpmFresh: model.rpmFresh
  }
}

export function rc16AlertFlags(state: Rc16AlertState): Readonly<Record<Rc16AlertId, boolean>> {
  return Object.freeze({
    consistencyDrop: state.consistencyDrop.active,
    roughInput: state.roughInput.active,
    gentleOverRev: state.gentleOverRev.active
  })
}

// ──────────────────────────────────────────────────────────── dashboard model

export interface Rc16SummaryRow {
  readonly id: 'lastLap' | 'consistency'
  readonly label: string
  readonly unit: string
  readonly value: Rc01Field
}

export interface Rc16DashboardModel {
  /** ONE instance, rendered by both the ring centre and the summary recap. See OV-6. */
  consistency: Rc01Field
  smoothness: Rc01Field
  delta: Rc01Field
  lastLap: Rc01Field
  ring: Rc16Ring
  /** Bound to the same number the smoothness numeral prints, so the two can never disagree. */
  smoothnessFillPct: number
  cue: Rc16Cue
  focusArea: Rc16FocusArea
  history: readonly Rc16HistoryPoint[]
  historyAvailable: boolean
  historyNotice: string | null
  summaryRows: readonly Rc16SummaryRow[]
  lapCount: number
  dispersionSec: number | null
  smoothnessIndex: number | null
  alerts: Readonly<Record<Rc16AlertId, boolean>>
  alertsSilent: boolean
  rpmRatio: number | null
  rpmFresh: boolean
  criticalFresh: Readonly<Record<Rc01ChannelName, boolean>>
}

export interface Rc16ModelOptions {
  laps?: readonly Rc16LapRecord[]
  alerts?: Rc16AlertState
  focusArea?: Rc16FocusArea
  /** Packet 12.1: the consistency history is an app-only reveal. */
  includeHistory?: boolean
}

export function createRc16DashboardModel(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc01ChannelName, Rc01ChannelReceipt> = new Map(),
  auxReceipts: ReadonlyMap<Rc16AuxChannel, Rc01ChannelReceipt> = new Map(),
  nowMs: number = rc01MonotonicNow(),
  options: Rc16ModelOptions = {}
): Rc16DashboardModel {
  const base: Rc01DashboardModel = createRc01DashboardModel(snapshot, receipts, nowMs)
  const live = Boolean(snapshot?.connected)
  const laps = options.laps ?? []
  const alerts = options.alerts ?? createRc16AlertState()
  const focusArea = options.focusArea ?? 'braking'

  const dispersionSec = rc16DispersionSec(laps)
  const consistency =
    dispersionSec === null
      ? field(RC16_DASH.consistency, null, false, true, 'muted')
      : field(rc16FormatDispersion(dispersionSec), round2(dispersionSec), false, false, 'primary')

  const lastCompleted = laps.length > 0 ? laps[laps.length - 1] : null
  const smoothnessIndex = lastCompleted?.smoothnessIndex ?? null
  const smoothness =
    smoothnessIndex === null
      ? field(RC16_DASH.smoothness, null, false, true, 'muted')
      : field(rc16FormatSmoothness(smoothnessIndex), smoothnessIndex, false, false, 'primary')

  // Packet 16: never show a delta without a real stored best lap, and never extrapolate one.
  const deltaRaw = snapshot?.deltaToBestSec
  const deltaUsable =
    live && !base.best.unavailable && !base.delta.unavailable && !base.delta.stale && finite(deltaRaw)
  const delta = deltaUsable
    ? field(rc16FormatDelta(round3(deltaRaw as number)), round2(deltaRaw as number), false, false, 'primary')
    : field(RC16_DASH.delta, null, live && base.delta.stale, true, 'muted')

  const lastLapReceipt = auxReceipts.get('lastLap')
  const lastLapAgeMs = rc01ReceiptAgeMs(lastLapReceipt, nowMs)
  const lastLapValue = finite(lastLapReceipt?.value) ? (lastLapReceipt?.value as number) : null
  const lastLapStale = lastLapValue !== null && lastLapAgeMs > RC16_CHANNEL_STALE_MS.lastLap
  const lastLap =
    !live || lastLapValue === null
      ? field(RC16_DASH.lapTime, null, false, true, 'muted')
      : field(
          rc16FormatLapTime(lastLapValue),
          round3(lastLapValue),
          lastLapStale,
          false,
          lastLapStale ? 'muted' : 'primary'
        )

  const flags = rc16AlertFlags(alerts)
  const cue = rc16SelectCue({
    live,
    focusArea,
    overRev: flags.gentleOverRev,
    roughInput: flags.roughInput,
    consistencyDrop: flags.consistencyDrop
  })

  const history = options.includeHistory ? rc16ConsistencyHistory(laps) : Object.freeze([])
  const historyAvailable = history.some((point) => point.available)

  return {
    consistency,
    smoothness,
    delta,
    lastLap,
    ring: rc16RingGeometry(dispersionSec),
    smoothnessFillPct: smoothnessIndex === null ? 0 : round1(clamp(smoothnessIndex, 0, 100)),
    cue,
    focusArea,
    history,
    historyAvailable,
    historyNotice: options.includeHistory && !historyAvailable ? RC16_NO_HISTORY_NOTICE : null,
    summaryRows: Object.freeze([
      Object.freeze({ id: 'lastLap' as const, label: 'LAST LAP', unit: '', value: lastLap }),
      // OV-6: the SAME field instance the ring centre renders.
      Object.freeze({ id: 'consistency' as const, label: 'BAND', unit: 'S', value: consistency })
    ]),
    lapCount: laps.length,
    dispersionSec,
    smoothnessIndex,
    alerts: flags,
    alertsSilent: !flags.consistencyDrop && !flags.roughInput && !flags.gentleOverRev,
    rpmRatio: base.rpmRatio,
    rpmFresh: base.rpmFresh,
    criticalFresh: base.criticalFresh
  }
}

// ──────────────────────────────────────────────────────────── accessible descriptions

export function rc16CueDescription(cue: Rc16Cue): string {
  if (!cue.available) return `Coaching cue unavailable, ${RC16_NO_CUE_NOTICE.toLowerCase()}`
  const words = cue.lines.join(' ')
  return cue.alert ? `Coaching cue, ${words}, prompted by a coaching alert` : `Coaching cue, ${words}`
}

export function rc16RingDescription(model: Rc16DashboardModel): string {
  if (!model.ring.available) {
    return `Consistency ring unavailable, ${RC16_CONSISTENCY_GATE_NOTICE.toLowerCase()}`
  }
  return `Consistency ring, band ${model.consistency.value} seconds, ring gap ${model.ring.gapPct} percent of the canvas width`
}

export function rc16SummaryDescription(row: Rc16SummaryRow): string {
  const suffix = row.unit ? ` ${row.unit.toLowerCase()}` : ''
  if (row.value.unavailable) return `${row.label} unavailable`
  if (row.value.stale) return `${row.label} stale; last known value ${row.value.value}${suffix}`
  return `${row.label} ${row.value.value}${suffix}`
}

/**
 * A hue-stripped fingerprint. Packet 19 requires consistency to be legible by ring TIGHTNESS and
 * smoothness by FILL LEVEL, so two different states must produce two different fingerprints with no
 * colour information in them at all.
 */
export function rc16PatternFingerprint(model: Rc16DashboardModel): string {
  const ring = model.ring.available ? `r${model.ring.midRadiusPct}/g${model.ring.gapPct}` : 'r-/g-'
  const fill = model.smoothness.unavailable ? 'f-' : `f${model.smoothnessFillPct}`
  const cue = `${model.cue.id}${model.cue.alert ? '!' : ''}`
  const history = model.history.map((point) => (point.gap ? 'x' : point.available ? 'o' : '.')).join('')
  return `ring:${ring} fill:${fill} cue:${cue} laps:${model.lapCount} history:${history}`
}

export type { Rc01Field as Rc16Field }
