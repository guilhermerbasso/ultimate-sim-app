import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import {
  type Rc01ChannelReceipt,
  type Rc01Field,
  rc01MonotonicNow,
  rc01ReceiptAgeMs
} from './raceconRc01Core'

/**
 * RC-15 "On The Nose — Brake & Chassis Balance" core.
 *
 * A handling-tuning page, not a driving page: a tipping balance beam whose angle IS the computed
 * chassis-balance index, flanked by the two brake-temperature pans, over the largest numeral in the
 * frame — the brake bias — and a per-corner balance strip.
 *
 * The live-only ingest buffer, identity binding, mock/replay refusal, out-of-order and
 * same-timestamp guards and the channel-receipt freshness model are reused from `raceconRc01Core`:
 * that is telemetry-truth machinery, not RC-01 styling, and a fork would silently drift.
 * `createRc01DashboardModel` is deliberately NOT called — every field it projects (rev bar, gear,
 * delta, tyres, fuel, position) is a zone RC-15's packet does not define, and the SOP is explicit
 * that a field the layout does not surface is omitted from the model rather than derived from a
 * proxy. RC-01's alert layer is likewise not driven from here: over-rev, delta-cliff, zero-cross and
 * pit-limiter are a different contract from RC-15's three section-15 alerts, whose thresholds,
 * debounces and clear conditions do not match any of them.
 *
 * THE ONE THING THIS FILE EXISTS TO GET RIGHT: the balance index is COMPUTED, and a computed value
 * is only legitimate while every one of its inputs is genuinely valid. Steering, yaw rate and the
 * lateral-G cornering gate must all be present and fresh or the index is `--`, the word is absent,
 * the beam sits level and no corner is scored. Nothing here ever estimates steering from yaw,
 * synthesises lateral G from speed and radius, infers bias from pedal balance, estimates brake
 * temperature from usage, or mirrors one corner onto another.
 */

// ─────────────────────────────────────────────────────────── canvas + breakpoints

/** Packet section 11 native canvas, and the section 12.1 app reflow target. */
export const RC15_NATIVE_WIDTH_PX = 800
export const RC15_NATIVE_HEIGHT_PX = 480
export const RC15_NATIVE_TOLERANCE_PX = 1
export const RC15_APP_WIDTH_PX = 1024
export const RC15_APP_HEIGHT_PX = 600

export const RC15_PHONE_MIN_WIDTH_PX = 360
export const RC15_PHONE_MAX_WIDTH_PX = 480
export const RC15_PHONE_MIN_HEIGHT_PX = 650
export const RC15_LANDSCAPE_MIN_WIDTH_PX = 650
export const RC15_LANDSCAPE_MIN_HEIGHT_PX = 360
export const RC15_LANDSCAPE_MAX_HEIGHT_PX = 480

export type Rc15CompactMode = 'phone' | 'landscape' | 'standard'
export type Rc15Layout = 'native' | 'app' | 'compact'

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

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((total, value) => total + value, 0) / values.length
}

// ─────────────────────────────────────────────────────────── packet omissions and overrides

/**
 * Every packet requirement this build deliberately does NOT render, and every normative override
 * applied to a defective packet instruction, with its reason. Each key is asserted by the suite: the
 * deviation is part of the contract, not an oversight, and a later edit cannot quietly undo it.
 *
 * The packet file itself is never modified — these entries ARE the change record.
 */
export const RC15_PACKET_OMISSIONS = Object.freeze({
  deltaToBestZone:
    'packet 10 makes delta-to-best secondary and 16 gives it a channel, but 11.1 and 12.1 define no zone for it on either canvas: it is omitted outright rather than squeezed into a neighbouring zone',
  tyreGearSpeedZones:
    'packet 10 tertiary tyre temperature, gear and speed have section 16 channels but no zone in 11.1 or 12.1: none of the three is read, drawn or dashed anywhere, and the negative prompt separately forbids a tyre thermal mandala',
  yawChannelRow:
    'packet 16 names yaw as a source of the computed balance index but gives it no row, unit or freshness budget: yaw rate is bound to the tightest declared IMU budget (the 20 ms lateral-G row) and balance is refused outright without it',
  revCue:
    'packet 11.4 asks for a small over-rev edge segment but section 16 defines no RPM or rev-limit channel: nothing is drawn, no LED, no bar, no numeral',
  panBeamOverlap:
    'normative override 1 — packet 11.1 puts each pan 10 x 120 px inside the beam zone: the pans move outward to x=60 and x=620, zero overlap, symmetric 60 px outer margins, every declared width preserved',
  biasZoneUndersized:
    'normative override 2 — the 11.1 bias zone is 200 x 90 px but 11.2 asks for a 72 px numeral plus a label and an adjust hint: the 800x480 bias zone grows to 220, 212, 360, 104, mirroring the 12.1 proportion, and the same correction is applied to the 1024x600 zone, which 12.1 declares at 280, 252, 464, 110 and which grows to 280, 242, 464, 130 into the bare canvas the packet leaves between the beam floor and the corner map',
  biasBlockAppReflow:
    'packet 12.1 grows the bias zone 1.058x while 11.2 grows the type ladder 1.28x, so a three-row bias stack measurably overflows 110 px at 1024x600: the block reflows to put the LAST ADJ hint beside the numeral instead of beneath it, and because a centred two-row block still needed 121.98 px of the 108 px content box the app zone is grown under override 2 rather than the numeral being cut below its 11.2 step',
  typeScaleAsCapHeights:
    'normative override 3 — the 11.2 sizes are implemented as cap heights at 0.75 of the stated em, because as line boxes the beam zone would need 154.6 px inside 150 px',
  dangerSignatureSeparability:
    'normative override 4 — packet 11.3 signature #FF5E3A and danger #FF3B2E are dE76 12.95 apart with 7.23 deg of hue separation, so routine brake heat reads as the alarm: danger is retuned to #FF1F5B (dE76 32.9, 27.0 deg) and every alert keeps its word and shape redundancy',
  balanceOverBrakeTempRatio:
    'normative override 5 — the 11.2 balance-index / brake-temp ratio is 48/44 = 1.091x, which is not reliably renderable: the shippable rule is that the balance index is at least as tall as the brake temperature, asserted arithmetically',
  heatBarSegmentCounts:
    'normative override 8 — the approved frame lights 9 of 11 front cells and 6 of 9 rear against printed 428 and 391 degC, and six attempts disagreed: both pans get exactly ten equal cells lit min(10, floor(t / 50)), so bar and numeral can never contradict one channel',
  heatBarScaleUnbacked:
    'normative override 12 — the 0..500 degC ten-cell pan scale has no packet backing, so it is tied to the section 15 hot limit instead: full scale IS the hot limit, and a pegged bar and a fired alert are the same event',
  alertThresholdValues:
    'gap 5 — packet 15 names a brake hot limit and an under/over balance threshold but gives neither a value or unit: they are declared here as 500 degC and index 0.50 over 3 consecutive scored corners, and published so the packet owner can ratify or correct them',
  cornerIdentity:
    'packet 16 defines no corner, turn or track-position channel, so the strip columns are an observation ordinal over the corners this run actually measured, never a track turn number',
  cornerMapGeometry:
    'packet 12.1 asks for a track corner map but section 16 defines no track geometry, position or lap-distance channel: the app panel renders the observed corner sequence and states NO TRACK MAP SOURCE, and no spatial claim is made',
  brakeTrendLapAxis:
    'packet 12.1 asks for a brake-temp trend over recent laps but section 16 defines no lap channel: the trend runs over the acquisition window, its ticks are dashed and no lap numeral is printed',
  steerLatGAtApp:
    'gap 3 — packet 12.1 drops the per-corner strip and defines no other host for steering and lateral G: rather than let two section 16 channels vanish at 1024x600 they move onto the corner-map header',
  cornerStripSoftKey:
    'packet 11.5 offers a soft-key switching the corner strip between brake temps and balance index: the strip carries both rows at once, exactly as the approved frame does, so there is no mode to switch and no hidden state'
})

/** Modules the wider canvas reveals, which must be absent at 800x480. Packet 12.1 expansion model. */
export const RC15_APP_ONLY_MODULES = Object.freeze(['cornerMap', 'brakeTrend'] as const)

// ─────────────────────────────────────────────────────────── tokens

/**
 * Packet 11.3 tokens. `danger` is the ONE deviation and it is normative override 4: the packet's
 * own `#FF3B2E` sits dE76 12.95 and 7.23 deg from `signature`, so the routine brake-heat colour and
 * the alarm colour are the same colour to a driver at arm's length. The packet value is kept in
 * `RC15_PACKET_DANGER` so the deviation is auditable rather than silent.
 */
export const RC15_TOKENS = Object.freeze({
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

/** Packet 11.3's literal danger token, retained so normative override 4 is measurable. */
export const RC15_PACKET_DANGER = '#FF3B2E'

export type Rc15Token = keyof typeof RC15_TOKENS

/**
 * The three tokens that must measure ZERO pixels in a silent frame. Packet 15 forbids any
 * alert-layer element being used as decoration and all three RC-15 alerts are silent by default, so
 * these may only ever be bound inside an alert-scoped rule. `normal` is never bound at all: packet
 * 14's "normal" state is the absence of an alert, not a green light.
 */
export const RC15_SILENT_TOKENS = Object.freeze(['normal', 'caution', 'danger'] as const)

/** Minimum separations normative override 4 requires between the alarm and the routine heat colour. */
export const RC15_MIN_ALERT_DELTA_E76 = 25
export const RC15_MIN_ALERT_HUE_SEPARATION_DEG = 20

function srgbToLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function hexChannels(hex: string): readonly [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ]
}

function hexToLab(hex: string): readonly [number, number, number] {
  const [r8, g8, b8] = hexChannels(hex)
  const r = srgbToLinear(r8)
  const g = srgbToLinear(g8)
  const b = srgbToLinear(b8)
  const pivot = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const x = pivot((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047)
  const y = pivot(0.2126 * r + 0.7152 * g + 0.0722 * b)
  const z = pivot((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

/** CIE76 colour difference. Override 4 adjudicates alert separability on this, never on RGB distance. */
export function rc15DeltaE76(a: string, b: string): number {
  const left = hexToLab(a)
  const right = hexToLab(b)
  return round2(
    Math.sqrt((left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2 + (left[2] - right[2]) ** 2)
  )
}

export function rc15Hue(hex: string): number {
  const [r8, g8, b8] = hexChannels(hex)
  const r = r8 / 255
  const g = g8 / 255
  const b = b8 / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  if (delta === 0) return 0
  let hue: number
  if (max === r) hue = 60 * (((g - b) / delta) % 6)
  else if (max === g) hue = 60 * ((b - r) / delta + 2)
  else hue = 60 * ((r - g) / delta + 4)
  return round2((hue + 360) % 360)
}

/** The shorter way round the hue circle, which is the only separation a viewer perceives. */
export function rc15HueSeparation(a: string, b: string): number {
  const raw = Math.abs(rc15Hue(a) - rc15Hue(b))
  return round2(raw > 180 ? 360 - raw : raw)
}

// ─────────────────────────────────────────────────────────── type ladder

/**
 * Packet 11.2's ladder in pixels on the 800x480 canvas, set ARITHMETICALLY and never measured off
 * the render. The bias numeral is the tallest glyph in the frame — this is a tuning page, so the
 * number the engineer is about to change outranks the number they are reading.
 */
export const RC15_TYPE_SCALE_PX = Object.freeze({
  bias: 72,
  balanceIndex: 48,
  brakeTemp: 44,
  cornerStrip: 30
})

/** Normative override 3: the 11.2 sizes are cap heights, and a cap height is 0.75 of the em. */
export const RC15_CAP_HEIGHT_RATIO = 0.75

export function rc15CapHeightPx(emPx: number): number {
  return round3(emPx * RC15_CAP_HEIGHT_RATIO)
}

/** Packet 12.1's type step: 1024 / 800. The ladder GROWS with the canvas, it does not re-rank. */
export const RC15_APP_TYPE_SCALE = RC15_APP_WIDTH_PX / RC15_NATIVE_WIDTH_PX

/** One container-query width unit is one hundredth of the native canvas: 800 / 100 = 8 px. */
export const RC15_CQW_PX = RC15_NATIVE_WIDTH_PX / 100

/**
 * The px ladder expressed in the container units the stylesheet actually uses. Because the app
 * canvas is exactly 1.28x the native canvas, ONE cqw ladder satisfies both breakpoints: 72 px at
 * 800 wide and 92.16 px at 1024 wide are the same 9 cqw. The suite asserts that identity.
 */
export function rc15TypeScaleCqw(px: number): number {
  return round3(px / RC15_CQW_PX)
}

export function rc15TypeScalePxForWidth(px: number, canvasWidthPx: number): number {
  return round3((rc15TypeScaleCqw(px) * canvasWidthPx) / 100)
}

// ─────────────────────────────────────────────────────────── zones

export interface Rc15RectPx {
  x: number
  y: number
  width: number
  height: number
}

export interface Rc15Rect {
  left: number
  top: number
  width: number
  height: number
}

export type Rc15ZoneId = 'frontPan' | 'beam' | 'rearPan' | 'bias' | 'strip' | 'cornerMap' | 'brakeTrend'

export type Rc15ZoneMapPx = Readonly<Partial<Record<Rc15ZoneId, Rc15RectPx>>>
export type Rc15ZoneMap = Readonly<Partial<Record<Rc15ZoneId, Rc15Rect>>>

/**
 * Packet 11.1's zones as corrected by normative overrides 1 and 2, in the packet's own pixels.
 * Override 6 is explicit that the render is never traced: measured zone drift in the approved frame
 * reaches +16.50 pp on width, so the corrected packet boxes win outright.
 *
 * There is deliberately no `cornerMap` and no `brakeTrend` box: both are 12.1 reveals.
 */
export const RC15_NATIVE_ZONES_PX: Rc15ZoneMapPx = Object.freeze({
  frontPan: Object.freeze({ x: 60, y: 80, width: 120, height: 120 }),
  beam: Object.freeze({ x: 180, y: 60, width: 440, height: 150 }),
  rearPan: Object.freeze({ x: 620, y: 80, width: 120, height: 120 }),
  bias: Object.freeze({ x: 220, y: 212, width: 360, height: 104 }),
  strip: Object.freeze({ x: 16, y: 320, width: 768, height: 140 })
})

/** Packet 11.1 exactly as written, kept so overrides 1 and 2 are measurable rather than asserted. */
export const RC15_PACKET_NATIVE_ZONES_PX: Rc15ZoneMapPx = Object.freeze({
  frontPan: Object.freeze({ x: 70, y: 80, width: 120, height: 120 }),
  beam: Object.freeze({ x: 180, y: 60, width: 440, height: 150 }),
  rearPan: Object.freeze({ x: 610, y: 80, width: 120, height: 120 }),
  bias: Object.freeze({ x: 300, y: 220, width: 200, height: 90 }),
  strip: Object.freeze({ x: 16, y: 320, width: 768, height: 140 })
})

/**
 * Packet 12.1 declares ONE stacked "Brake pans" box at (40, 70, 240, 180). The front and rear pans
 * are rendered as two panels inside it; the suite proves their union is exactly the declared box.
 */
export const RC15_APP_PAN_STACK_PX: Rc15RectPx = Object.freeze({ x: 40, y: 70, width: 240, height: 180 })
export const RC15_APP_PAN_STACK_GUTTER_PX = 4

/**
 * Packet 12.1's app rectangles, with normative override 2 extended to the app canvas.
 *
 * 12.1 declares the bias zone at (280, 252, 464, 110). Override 2 already grew the NATIVE bias
 * zone because 11.1's 200x90 box cannot hold a 72px numeral plus a label and an adjust hint; the
 * app zone was left at the packet value and hit the same wall one canvas later. Measured at
 * 1024x600: the reflowed block's own content stands 107px tall inside a 108px content box that
 * `align-items: center` splits, so the zone reported `scrollHeight` 115 against `clientHeight` 108
 * — a 7px overrun in both governed states. The block is centred, so the governing inequality is
 * `clientHeight >= 2 * content.scrollHeight - content.height` = 2 * 107 - 92.02 = 121.98px.
 *
 * The packet leaves 132px of bare canvas between the beam floor (y=240) and the corner-map ceiling
 * (y=372), so the zone takes it: y=242, height=130 gives a 128px content box, 6px clear of the
 * measured requirement, with a 2px gutter under the beam. No other zone moves and no type step
 * changes: the type ladder still reads bias 92.16 > balanceIndex 61.44 > brakeTemp 56.32 >
 * cornerIndex 38.4 at this canvas.
 */
export const RC15_APP_ZONES_PX: Rc15ZoneMapPx = Object.freeze({
  frontPan: Object.freeze({ x: 40, y: 70, width: 240, height: 88 }),
  rearPan: Object.freeze({ x: 40, y: 162, width: 240, height: 88 }),
  beam: Object.freeze({ x: 280, y: 60, width: 464, height: 180 }),
  bias: Object.freeze({ x: 280, y: 242, width: 464, height: 130 }),
  cornerMap: Object.freeze({ x: 24, y: 372, width: 600, height: 200 }),
  brakeTrend: Object.freeze({ x: 648, y: 372, width: 352, height: 200 })
})

function canvasSizePx(layout: Rc15Layout): { width: number; height: number } {
  return layout === 'app'
    ? { width: RC15_APP_WIDTH_PX, height: RC15_APP_HEIGHT_PX }
    : { width: RC15_NATIVE_WIDTH_PX, height: RC15_NATIVE_HEIGHT_PX }
}

export function rc15ZonesPxForLayout(layout: Rc15Layout): Rc15ZoneMapPx {
  return layout === 'app' ? RC15_APP_ZONES_PX : RC15_NATIVE_ZONES_PX
}

/** A packet pixel box as canvas percentages, which is what the DOM actually carries. */
export function rc15RectPercent(rect: Rc15RectPx, canvasWidth: number, canvasHeight: number): Rc15Rect {
  return {
    left: round6((rect.x / canvasWidth) * 100),
    top: round6((rect.y / canvasHeight) * 100),
    width: round6((rect.width / canvasWidth) * 100),
    height: round6((rect.height / canvasHeight) * 100)
  }
}

/**
 * The compact grammars are not packet-specified. They keep the scale metaphor — two pans flanking
 * the beam over the bias numeral over the corner strip — and drop only the two app-only reveals, so
 * all three section 15 alerts keep a visible surface at every size.
 */
function rc15CompactZonesPx(mode: Rc15CompactMode, width: number, height: number): Rc15ZoneMapPx {
  if (mode === 'phone') {
    return Object.freeze({
      frontPan: Object.freeze({ x: 0.03 * width, y: 0.04 * height, width: 0.44 * width, height: 0.17 * height }),
      rearPan: Object.freeze({ x: 0.53 * width, y: 0.04 * height, width: 0.44 * width, height: 0.17 * height }),
      beam: Object.freeze({ x: 0.03 * width, y: 0.23 * height, width: 0.94 * width, height: 0.22 * height }),
      bias: Object.freeze({ x: 0.03 * width, y: 0.47 * height, width: 0.94 * width, height: 0.18 * height }),
      strip: Object.freeze({ x: 0.03 * width, y: 0.67 * height, width: 0.94 * width, height: 0.29 * height })
    })
  }
  if (mode === 'landscape') {
    return Object.freeze({
      frontPan: Object.freeze({ x: 0.02 * width, y: 0.06 * height, width: 0.16 * width, height: 0.34 * height }),
      beam: Object.freeze({ x: 0.2 * width, y: 0.05 * height, width: 0.6 * width, height: 0.36 * height }),
      rearPan: Object.freeze({ x: 0.82 * width, y: 0.06 * height, width: 0.16 * width, height: 0.34 * height }),
      bias: Object.freeze({ x: 0.28 * width, y: 0.43 * height, width: 0.44 * width, height: 0.26 * height }),
      strip: Object.freeze({ x: 0.02 * width, y: 0.71 * height, width: 0.96 * width, height: 0.27 * height })
    })
  }
  return Object.freeze({
    frontPan: Object.freeze({ x: 0.03 * width, y: 0.09 * height, width: 0.17 * width, height: 0.25 * height }),
    beam: Object.freeze({ x: 0.22 * width, y: 0.07 * height, width: 0.56 * width, height: 0.31 * height }),
    rearPan: Object.freeze({ x: 0.8 * width, y: 0.09 * height, width: 0.17 * width, height: 0.25 * height }),
    bias: Object.freeze({ x: 0.26 * width, y: 0.4 * height, width: 0.48 * width, height: 0.22 * height }),
    strip: Object.freeze({ x: 0.02 * width, y: 0.65 * height, width: 0.96 * width, height: 0.31 * height })
  })
}

export function rc15ZonesForLayout(
  layout: Rc15Layout,
  compactMode: Rc15CompactMode = 'standard',
  box: { width: number; height: number } = canvasSizePx(layout)
): Rc15ZoneMap {
  const size = layout === 'compact' ? box : canvasSizePx(layout)
  const zonesPx =
    layout === 'compact' ? rc15CompactZonesPx(compactMode, size.width, size.height) : rc15ZonesPxForLayout(layout)
  const entries = (Object.keys(zonesPx) as Rc15ZoneId[]).map((id) => [
    id,
    Object.freeze(rc15RectPercent(zonesPx[id] as Rc15RectPx, size.width, size.height))
  ])
  return Object.freeze(Object.fromEntries(entries)) as Rc15ZoneMap
}

export function rc15RectsOverlap(a: Rc15Rect, b: Rc15Rect): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  )
}

/** A 0..100 coordinate as a CSS percentage, without binary-float noise in the DOM. */
export function rc15Percent(value: number): string {
  return `${round3(finite(value) ? value : 0)}%`
}

export function rc15ZoneStyle(rect: Rc15Rect | undefined): {
  left: string
  top: string
  width: string
  height: string
} | null {
  if (!rect) return null
  return {
    left: rc15Percent(rect.left),
    top: rc15Percent(rect.top),
    width: rc15Percent(rect.width),
    height: rc15Percent(rect.height)
  }
}

// ─────────────────────────────────────────────────────────── layout resolution

export function rc15LayoutForContentBox(width: number, height: number): Rc15Layout {
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return 'app'
  if (
    Math.abs(width - RC15_NATIVE_WIDTH_PX) <= RC15_NATIVE_TOLERANCE_PX &&
    Math.abs(height - RC15_NATIVE_HEIGHT_PX) <= RC15_NATIVE_TOLERANCE_PX
  ) {
    return 'native'
  }
  if (width >= RC15_APP_WIDTH_PX - 1 && height >= RC15_APP_HEIGHT_PX - 1) return 'app'
  return 'compact'
}

export function rc15CompactModeForContentBox(width: number, height: number): Rc15CompactMode {
  if (rc15LayoutForContentBox(width, height) !== 'compact') return 'standard'
  if (
    width >= RC15_PHONE_MIN_WIDTH_PX &&
    width <= RC15_PHONE_MAX_WIDTH_PX &&
    height >= RC15_PHONE_MIN_HEIGHT_PX &&
    height / width >= 1.5
  ) {
    return 'phone'
  }
  if (
    width >= RC15_LANDSCAPE_MIN_WIDTH_PX &&
    height >= RC15_LANDSCAPE_MIN_HEIGHT_PX &&
    height <= RC15_LANDSCAPE_MAX_HEIGHT_PX &&
    width / height >= 1.5
  ) {
    return 'landscape'
  }
  return 'standard'
}

export interface Rc15PhoneGeometry {
  inset: number
  labelHeight: number
  beamHeight: number
  stripRowHeight: number
}

export function rc15PhoneGeometryForContentBox(width: number, height: number): Rc15PhoneGeometry | null {
  if (rc15CompactModeForContentBox(width, height) !== 'phone') return null
  return {
    inset: 8,
    labelHeight: Math.max(14, Math.round(height * 0.022)),
    beamHeight: Math.max(24, Math.round(height * 0.05)),
    stripRowHeight: Math.max(18, Math.round(height * 0.035))
  }
}

// ─────────────────────────────────────────────────────────── channels

/**
 * Packet section 16 freshness budgets, verbatim, for the channels RC-15 actually surfaces.
 *
 * `brakeBias` is deliberately absent: section 16 declares its freshness as "on change", which is not
 * an age budget at all. A channel that only reports on change can never be judged stale by elapsed
 * time — it is valid while the source publishes it and unavailable the moment it stops, which is
 * what `RC15_BIAS_LOST_ENGAGE_MS` then debounces.
 *
 * `yawRate` is present although section 16 gives it no row — see `RC15_PACKET_OMISSIONS.yawChannelRow`.
 * It carries the tightest declared IMU budget rather than a looser invented one.
 */
export const RC15_CHANNEL_STALE_MS = {
  steering: 20,
  latG: 20,
  yawRate: 20,
  brakeTempLf: 200,
  brakeTempRf: 200,
  brakeTempLr: 200,
  brakeTempRr: 200
} as const

export type Rc15Channel = keyof typeof RC15_CHANNEL_STALE_MS | 'brakeBias'

export const RC15_AGED_CHANNELS = Object.freeze(
  Object.keys(RC15_CHANNEL_STALE_MS) as (keyof typeof RC15_CHANNEL_STALE_MS)[]
)

/** Packet 16 dash states, verbatim, so the widget and the suite cannot drift from the table. */
export const RC15_DASH = Object.freeze({
  index: '--',
  brakeTemp: '--',
  bias: '--',
  steering: '--',
  latG: '--',
  hint: '--',
  trend: '--'
})

/** Packet 15 and 19 wording. Every alert is a WORD plus a shape, never a hue on its own. */
export const RC15_LABELS = Object.freeze({
  computed: 'COMPUTED',
  balance: 'CHASSIS BALANCE',
  under: 'UNDER',
  over: 'OVER',
  level: 'LEVEL',
  brakeHot: 'BRAKE HOT',
  biasUnit: '% FRONT',
  biasLabel: 'BRAKE BIAS',
  lastAdjust: 'LAST ADJ',
  frontAxle: 'FRONT',
  rearAxle: 'REAR',
  cornerRow: 'CORNER',
  balanceRow: 'BALANCE',
  indexRow: 'INDEX',
  brakeRow: 'BRAKE F / R',
  steering: 'STEER',
  latG: 'LAT',
  observed: 'OBSERVED',
  noTrackMap: 'NO TRACK MAP SOURCE',
  noTrend: 'NO BRAKE TREND SOURCE',
  noCorners: 'NO SCORED CORNER YET'
})

function field(
  value: string,
  raw: number | string | null,
  stale = false,
  isUnavailable = false,
  tone: Rc01Field['tone'] = 'primary'
): Rc01Field {
  return { value, raw, stale, unavailable: isUnavailable, tone }
}

function unavailableField(value: string): Rc01Field {
  return field(value, null, false, true, 'muted')
}

/**
 * Every RC-15 channel is read straight from its own declared source. Nothing is modelled, mirrored
 * or substituted: brake temperature never from brake usage, bias never from pedal balance, steering
 * never from yaw, lateral G never from speed and radius, and no brake corner is ever mirrored onto
 * another corner or onto the opposite axle.
 */
export function rc15ChannelValue(snapshot: TelemetrySnapshot, channel: Rc15Channel): number | null {
  switch (channel) {
    case 'steering':
      return finite(snapshot.steerAngleDeg) ? (snapshot.steerAngleDeg as number) : null
    case 'latG':
      return finite(snapshot.latAccelG) ? (snapshot.latAccelG as number) : null
    case 'yawRate':
      return finite(snapshot.yawRateRadSec) ? (snapshot.yawRateRadSec as number) : null
    case 'brakeBias':
      return finite(snapshot.brakeBiasPct) ? (snapshot.brakeBiasPct as number) : null
    case 'brakeTempLf':
      return finite(snapshot.brakeTempC?.lf) ? (snapshot.brakeTempC!.lf as number) : null
    case 'brakeTempRf':
      return finite(snapshot.brakeTempC?.rf) ? (snapshot.brakeTempC!.rf as number) : null
    case 'brakeTempLr':
      return finite(snapshot.brakeTempC?.lr) ? (snapshot.brakeTempC!.lr as number) : null
    case 'brakeTempRr':
      return finite(snapshot.brakeTempC?.rr) ? (snapshot.brakeTempC!.rr as number) : null
  }
  return null
}

/**
 * `RC15_PACKET_OMISSIONS.cornerMapGeometry`, expressed as a function so the absence is MEASURED by
 * the suite rather than asserted about a comment. Section 16 defines no track-position, corner or
 * lap-distance channel, so no corner can be placed on a map and no turn can be numbered.
 */
export function rc15TrackPositionFraction(_snapshot: TelemetrySnapshot | null): number | null {
  return null
}

/**
 * `RC15_PACKET_OMISSIONS.brakeTrendLapAxis`, for the same reason: no lap channel is defined for this
 * artifact, so the trend can never be labelled per lap.
 */
export function rc15TrendLapNumber(_snapshot: TelemetrySnapshot | null): number | null {
  return null
}

export function rc15FormatTemperature(celsius: number | null): string {
  if (!finite(celsius)) return RC15_DASH.brakeTemp
  return String(Math.round(celsius))
}

export function rc15FormatBias(percent: number | null): string {
  if (!finite(percent)) return RC15_DASH.bias
  return percent.toFixed(1)
}

export function rc15FormatIndex(index: number | null): string {
  if (!finite(index)) return RC15_DASH.index
  return `${index >= 0 ? '+' : '-'}${Math.abs(index).toFixed(2)}`
}

export function rc15FormatSteering(deg: number | null): string {
  if (!finite(deg)) return RC15_DASH.steering
  return String(Math.round(Math.abs(deg)))
}

export function rc15FormatLatG(g: number | null): string {
  if (!finite(g)) return RC15_DASH.latG
  return Math.abs(g).toFixed(2)
}

// ─────────────────────────────────────────────────────────── receipts

/**
 * Receipts for RC-15's own channels, with exactly RC-01's semantics: a receipt is written only when
 * the channel actually reports, so a channel that falls silent ages out and degrades to its packet
 * dash state instead of freezing on its last value.
 */
export const RC15_CHANNEL_LIST: readonly Rc15Channel[] = Object.freeze([
  ...RC15_AGED_CHANNELS,
  'brakeBias'
] as Rc15Channel[])

export class Rc15ChannelBuffer {
  private channelReceipts = new Map<Rc15Channel, Rc01ChannelReceipt>()

  clone(): Rc15ChannelBuffer {
    const next = new Rc15ChannelBuffer()
    next.channelReceipts = new Map(this.channelReceipts)
    return next
  }

  reset(): void {
    this.channelReceipts = new Map()
  }

  ingest(snapshot: TelemetrySnapshot | null | undefined, receivedAt = rc01MonotonicNow()): void {
    if (!snapshot || !snapshot.connected || !finite(snapshot.timestamp)) return
    const safeReceiptAt = finite(receivedAt) && receivedAt >= 0 ? receivedAt : rc01MonotonicNow()
    for (const channel of RC15_CHANNEL_LIST) {
      const value = rc15ChannelValue(snapshot, channel)
      if (value === null) continue
      this.channelReceipts.set(
        channel,
        Object.freeze({ value, snapshotTimestamp: snapshot.timestamp, receivedAt: safeReceiptAt })
      )
    }
  }

  receipts(): ReadonlyMap<Rc15Channel, Rc01ChannelReceipt> {
    return new Map(this.channelReceipts)
  }
}

export function createRc15ChannelReceipts(
  snapshot: TelemetrySnapshot,
  receivedAt = rc01MonotonicNow()
): ReadonlyMap<Rc15Channel, Rc01ChannelReceipt> {
  const buffer = new Rc15ChannelBuffer()
  buffer.ingest(snapshot, receivedAt)
  return buffer.receipts()
}

interface Rc15Reading {
  value: number | null
  stale: boolean
  ageMs: number
}

/**
 * A channel reading. Note the `brakeBias` branch: its section 16 freshness is "on change", so it is
 * never aged out. Every other channel degrades the instant it misses its declared budget.
 */
function reading(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc15Channel, Rc01ChannelReceipt>,
  channel: Rc15Channel,
  nowMs: number
): Rc15Reading {
  const raw = snapshot ? rc15ChannelValue(snapshot, channel) : null
  const receipt = receipts.get(channel)
  if (raw === null || !receipt) return { value: null, stale: false, ageMs: Number.POSITIVE_INFINITY }
  if (channel === 'brakeBias') return { value: raw, stale: false, ageMs: 0 }
  const ageMs = rc01ReceiptAgeMs(receipt, nowMs)
  const budget = RC15_CHANNEL_STALE_MS[channel as keyof typeof RC15_CHANNEL_STALE_MS]
  const stale = ageMs > budget
  return { value: stale ? null : raw, stale, ageMs }
}

// ─────────────────────────────────────────────────────────── the computed balance index

/**
 * Packet 16 row 1: "Chassis balance index — Computed yaw/steer/slip balance — index (under/over)".
 *
 * The index compares the driver's STEERING DEMAND against the car's YAW RESPONSE, each normalised to
 * its own declared full scale, and reports which one is winning:
 *
 *     index = (yawResponse - steerDemand) / (yawResponse + steerDemand)
 *
 * More yaw than steering is the car rotating more than it is being asked to: positive, OVER, beam
 * right-down. More steering than yaw is the car refusing to rotate: negative, UNDER, beam left-down,
 * which is the approved frame's -0.34 / UNDER / front-down state.
 *
 * Two properties matter. It needs NO vehicle parameter — no wheelbase, no steering ratio, no mass —
 * so nothing about the car is assumed or invented. And it is sign-convention free: both inputs enter
 * as magnitudes, so a sim that reports positive steering to the left and one that reports positive
 * to the right produce the same reading rather than a mirrored one.
 *
 * The lateral-G gate is the packet's "slip" term doing real work: below a genuine cornering load the
 * car is going straight, both magnitudes are noise, and their ratio is meaningless. Balance is then
 * NOT labelled at all — dash, no word, level beam — which is exactly section 16's "never label
 * balance without valid steer/yaw inputs" rather than a plausible number.
 */
export const RC15_STEER_FULL_SCALE_DEG = 180
export const RC15_YAW_FULL_SCALE_RAD_S = 1.2
export const RC15_BALANCE_MIN_LAT_G = 0.25
export const RC15_BALANCE_MIN_DEMAND = 0.02

export interface Rc15BalanceInputs {
  steeringDeg: number | null
  yawRateRadSec: number | null
  latG: number | null
}

export function rc15BalanceIndex(inputs: Rc15BalanceInputs): number | null {
  const { steeringDeg, yawRateRadSec, latG } = inputs
  if (!finite(steeringDeg) || !finite(yawRateRadSec) || !finite(latG)) return null
  if (Math.abs(latG) < RC15_BALANCE_MIN_LAT_G) return null
  const steerDemand = clamp(Math.abs(steeringDeg) / RC15_STEER_FULL_SCALE_DEG, 0, 1)
  const yawResponse = clamp(Math.abs(yawRateRadSec) / RC15_YAW_FULL_SCALE_RAD_S, 0, 1)
  const total = steerDemand + yawResponse
  if (total < RC15_BALANCE_MIN_DEMAND) return null
  return round2(clamp((yawResponse - steerDemand) / total, -1, 1))
}

/**
 * Packet 11.5's hysteresis controller: a single-pole smoother so the beam does not twitch corner to
 * corner. A dropout is NEVER smoothed across — a null input produces a null output and the beam
 * dashes — because carrying the previous index through a gap would be exactly the frozen-stale-data
 * failure section 16 forbids.
 */
export const RC15_BALANCE_SMOOTHING_MS = 400

export function rc15SmoothBalance(
  previous: number | null,
  next: number | null,
  elapsedMs: number
): number | null {
  if (next === null) return null
  if (previous === null || !finite(previous)) return next
  if (!finite(elapsedMs) || elapsedMs <= 0) return previous
  const alpha = 1 - Math.exp(-elapsedMs / RC15_BALANCE_SMOOTHING_MS)
  return round2(previous + clamp(alpha, 0, 1) * (next - previous))
}

/** Packet 14: "beam near level" is its own readable state, so the word band is explicit. */
export const RC15_BALANCE_WORD_DEADBAND = 0.05

export type Rc15BalanceWord = 'UNDER' | 'OVER' | 'LEVEL'

export function rc15BalanceWord(index: number | null): Rc15BalanceWord | null {
  if (!finite(index)) return null
  if (index <= -RC15_BALANCE_WORD_DEADBAND) return 'UNDER'
  if (index >= RC15_BALANCE_WORD_DEADBAND) return 'OVER'
  return 'LEVEL'
}

/** Brief section 4: beam tilt = index x 12 deg of full travel; -0.34 gives 4.08 deg front-down. */
export const RC15_BEAM_FULL_TRAVEL_DEG = 12

export function rc15BeamAngleDeg(index: number | null, pegged = false): number {
  if (!finite(index)) return 0
  if (pegged) return round2(Math.sign(index) * RC15_BEAM_FULL_TRAVEL_DEG)
  return round2(clamp(index, -1, 1) * RC15_BEAM_FULL_TRAVEL_DEG)
}

// ─────────────────────────────────────────────────────────── brake pans

/**
 * Normative overrides 8 and 12. Ten equal cells in BOTH pans, lit `min(10, floor(t / 50))`, and the
 * full scale IS the section 15 hot limit, so a pegged bar and a fired alert are the same event and
 * the bar can never disagree with the numeral beside it.
 */
export const RC15_BRAKE_BAR_CELLS = 10
export const RC15_BRAKE_HOT_LIMIT_C = 500
export const RC15_BRAKE_BAR_CELL_C = RC15_BRAKE_HOT_LIMIT_C / RC15_BRAKE_BAR_CELLS

export function rc15BrakeBarLitCells(celsius: number | null): number {
  if (!finite(celsius) || celsius <= 0) return 0
  return clamp(Math.floor(celsius / RC15_BRAKE_BAR_CELL_C), 0, RC15_BRAKE_BAR_CELLS)
}

export type Rc15Axle = 'front' | 'rear'

/**
 * An axle temperature exists only when BOTH of its corners report. One corner published as the axle
 * would be exactly the mirroring section 16 forbids, and there is no other axle-level sensor.
 */
export function rc15AxleTemperature(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc15Channel, Rc01ChannelReceipt>,
  axle: Rc15Axle,
  nowMs: number
): { value: number | null; stale: boolean } {
  const channels: Rc15Channel[] =
    axle === 'front' ? ['brakeTempLf', 'brakeTempRf'] : ['brakeTempLr', 'brakeTempRr']
  const readings = channels.map((channel) => reading(snapshot, receipts, channel, nowMs))
  const stale = readings.some((entry) => entry.stale)
  const values = readings.flatMap((entry) => (entry.value === null ? [] : [entry.value]))
  if (values.length < channels.length) return { value: null, stale }
  return { value: mean(values), stale }
}

// ─────────────────────────────────────────────────────────── corner scoring

/**
 * A "corner" is MEASURED, never assumed. It opens when the lateral load crosses the entry gate and
 * closes when it falls back below the exit gate, and it is recorded only when BOTH crossings were
 * observed inside the same acquisition run.
 *
 * That last rule is the one that matters: a mid-corner mount would otherwise write a truncated
 * fragment into the scored-corner history and poison the three-corner balance latch for the rest of
 * the session. The same failure cost RC-02 real time and the same guard is applied here.
 */
export const RC15_CORNER_ENTER_LAT_G = 0.45
export const RC15_CORNER_EXIT_LAT_G = 0.3
export const RC15_CORNER_MIN_SAMPLES = 4
export const RC15_CORNER_COLUMNS = 6
export const RC15_CORNER_HISTORY_LIMIT = 24

export interface Rc15CornerSample {
  readonly timestamp: number
  readonly receivedAt: number
  readonly latG: number | null
  readonly index: number | null
  readonly frontTempC: number | null
  readonly rearTempC: number | null
}

export interface Rc15ScoredCorner {
  readonly ordinal: number
  readonly index: number | null
  readonly frontTempC: number | null
  readonly rearTempC: number | null
  readonly sampleCount: number
  readonly closedAt: number
}

/**
 * The corner detector. It is a state machine over acquired samples rather than a filter over a
 * window, because the entry and the exit crossings have to be individually observed for the corner
 * to count at all.
 */
export class Rc15CornerBuffer {
  private open: Rc15CornerSample[] = []
  private inCorner = false
  private sawEntry = false
  private scored: Rc15ScoredCorner[] = []
  private ordinal = 0
  private started = false

  clone(): Rc15CornerBuffer {
    const next = new Rc15CornerBuffer()
    next.open = this.open.slice()
    next.inCorner = this.inCorner
    next.sawEntry = this.sawEntry
    next.scored = this.scored.slice()
    next.ordinal = this.ordinal
    next.started = this.started
    return next
  }

  reset(): void {
    this.open = []
    this.inCorner = false
    this.sawEntry = false
    this.scored = []
    this.ordinal = 0
    this.started = false
  }

  ingest(sample: Rc15CornerSample): void {
    const load = finite(sample.latG) ? Math.abs(sample.latG as number) : null

    // A run that begins already loaded began mid-corner. That corner is never scored: its entry
    // crossing was not observed, so its samples are a fragment, not a corner.
    if (!this.started) {
      this.started = true
      if (load !== null && load >= RC15_CORNER_EXIT_LAT_G) {
        this.inCorner = true
        this.sawEntry = false
      }
    }

    if (load === null) {
      // The gate channel itself dropped out: the corner in progress can no longer be bounded, so it
      // is abandoned rather than closed on a guess.
      this.open = []
      this.inCorner = false
      this.sawEntry = false
      return
    }

    if (!this.inCorner) {
      if (load >= RC15_CORNER_ENTER_LAT_G) {
        this.inCorner = true
        this.sawEntry = true
        this.open = [sample]
      }
      return
    }

    if (load > RC15_CORNER_EXIT_LAT_G) {
      if (this.sawEntry) this.open.push(sample)
      return
    }

    if (this.sawEntry && this.open.length >= RC15_CORNER_MIN_SAMPLES) {
      this.ordinal += 1
      const indices = this.open.flatMap((entry) => (entry.index === null ? [] : [entry.index]))
      const fronts = this.open.flatMap((entry) => (entry.frontTempC === null ? [] : [entry.frontTempC]))
      const rears = this.open.flatMap((entry) => (entry.rearTempC === null ? [] : [entry.rearTempC]))
      const indexMean = mean(indices)
      const frontMean = mean(fronts)
      const rearMean = mean(rears)
      this.scored.push(
        Object.freeze({
          ordinal: this.ordinal,
          index: indexMean === null ? null : round2(indexMean),
          frontTempC: frontMean === null ? null : round1(frontMean),
          rearTempC: rearMean === null ? null : round1(rearMean),
          sampleCount: this.open.length,
          closedAt: sample.receivedAt
        })
      )
      if (this.scored.length > RC15_CORNER_HISTORY_LIMIT) {
        this.scored = this.scored.slice(this.scored.length - RC15_CORNER_HISTORY_LIMIT)
      }
    }
    this.open = []
    this.inCorner = false
    this.sawEntry = false
  }

  corners(): readonly Rc15ScoredCorner[] {
    return this.scored.slice()
  }

  /** The most recent corners, newest last, which is the reading order of the strip. */
  recent(count = RC15_CORNER_COLUMNS): readonly Rc15ScoredCorner[] {
    return this.scored.slice(Math.max(0, this.scored.length - count))
  }
}

/**
 * Normative override 9: a marker offset is `index x halfTrackLength`, computed, never traced. The
 * reference expands the scale near the datum (T2 at -13.5 px against a computed -6) and that
 * reading is not copied. The numeric index is printed under every column unconditionally, which is
 * the override's own answer to a track too short to separate two adjacent markers.
 */
export function rc15MarkerOffsetPct(index: number | null): number | null {
  if (!finite(index)) return null
  return round3(clamp(index, -1, 1) * 50)
}

// ─────────────────────────────────────────────────────────── brake-bias adjust hint

/**
 * The `LAST ADJ` hint is MEASURED from the bias channel itself: it is the signed difference between
 * the current bias and the previous distinct bias this run observed. A bias that has not moved has
 * no last adjustment and dashes — no direction is ever suggested from a balance reading, and no
 * adjustment is ever attributed to a change this widget did not see happen.
 */
export const RC15_BIAS_ADJUST_EPSILON = 0.05

export interface Rc15BiasAdjustment {
  readonly direction: 'FRONT' | 'REAR'
  readonly magnitude: number
}

export class Rc15BiasTracker {
  private last: number | null = null
  private adjustment: Rc15BiasAdjustment | null = null
  private everSeen = false

  clone(): Rc15BiasTracker {
    const next = new Rc15BiasTracker()
    next.last = this.last
    next.adjustment = this.adjustment
    next.everSeen = this.everSeen
    return next
  }

  reset(): void {
    this.last = null
    this.adjustment = null
    this.everSeen = false
  }

  ingest(bias: number | null): void {
    if (bias === null) return
    this.everSeen = true
    if (this.last === null) {
      this.last = bias
      return
    }
    const delta = bias - this.last
    if (Math.abs(delta) < RC15_BIAS_ADJUST_EPSILON) return
    this.adjustment = Object.freeze({
      direction: delta > 0 ? ('FRONT' as const) : ('REAR' as const),
      magnitude: round1(Math.abs(delta))
    })
    this.last = bias
  }

  lastAdjustment(): Rc15BiasAdjustment | null {
    return this.adjustment
  }

  /** Whether a valid bias was ever published on this source, which is what "lost" needs to mean. */
  everReported(): boolean {
    return this.everSeen
  }
}

// ─────────────────────────────────────────────────────────── trigger-only alerts

/**
 * Packet section 15, implemented rather than quoted. All three alerts start silent, each has the
 * packet's debounce or latch, an explicit clear condition, and unlatches the moment its own input
 * goes stale or missing. Nothing in the alert layer is ever an always-on decoration.
 *
 * Gap 5: section 15 names a hot limit and an under/over threshold and gives neither a value. Both
 * are declared here and recorded in `RC15_PACKET_OMISSIONS.alertThresholdValues` so the packet owner
 * can ratify or correct them, rather than being buried in a stylesheet.
 */
export const RC15_BRAKE_HOT_ENGAGE_MS = 2_000
export const RC15_BRAKE_HOT_HYSTERESIS_MS = 4_000
export const RC15_BRAKE_HOT_CLEAR_C = 450
export const RC15_BALANCE_EXTREME_INDEX = 0.5
export const RC15_BALANCE_EXTREME_CORNERS = 3
export const RC15_BIAS_LOST_ENGAGE_MS = 1_000

export type Rc15AlertId = 'brakeHot' | 'balanceExtreme' | 'biasUnavailable'

export const RC15_ALERT_LABELS = Object.freeze({
  brakeHot: RC15_LABELS.brakeHot,
  balanceExtreme: 'BALANCE EXTREME',
  biasUnavailable: 'BIAS UNAVAILABLE'
})

export interface Rc15AxleAlert {
  readonly active: boolean
  readonly aboveSinceMs: number | null
  readonly belowSinceMs: number | null
}

export interface Rc15AlertState {
  readonly brakeHot: Readonly<Record<Rc15Axle, Rc15AxleAlert>>
  readonly balanceExtreme: {
    readonly active: boolean
    readonly side: 'UNDER' | 'OVER' | null
    readonly latchedOrdinal: number | null
  }
  readonly biasUnavailable: {
    readonly active: boolean
    readonly lostSinceMs: number | null
  }
}

const SILENT_AXLE: Rc15AxleAlert = Object.freeze({ active: false, aboveSinceMs: null, belowSinceMs: null })

export function createRc15AlertState(): Rc15AlertState {
  return Object.freeze({
    brakeHot: Object.freeze({ front: SILENT_AXLE, rear: SILENT_AXLE }),
    balanceExtreme: Object.freeze({ active: false, side: null, latchedOrdinal: null }),
    biasUnavailable: Object.freeze({ active: false, lostSinceMs: null })
  })
}

export interface Rc15AlertInput {
  nowMs: number
  frontTempC: number | null
  rearTempC: number | null
  balanceIndex: number | null
  scoredCorners: readonly Rc15ScoredCorner[]
  biasAvailable: boolean
  biasEverReported: boolean
}

function advanceAxle(state: Rc15AxleAlert, temperature: number | null, nowMs: number): Rc15AxleAlert {
  // Unavailable or stale: unlatch outright. Packet 15's unavailable-data rule is an explicit grey
  // dash on the pan and never an estimate, so a missing sensor cannot hold an alarm up either.
  if (temperature === null) return SILENT_AXLE

  if (temperature > RC15_BRAKE_HOT_LIMIT_C) {
    const aboveSinceMs = state.aboveSinceMs ?? nowMs
    const engaged = state.active || nowMs - aboveSinceMs >= RC15_BRAKE_HOT_ENGAGE_MS
    return Object.freeze({ active: engaged, aboveSinceMs, belowSinceMs: null })
  }

  if (!state.active) return Object.freeze({ active: false, aboveSinceMs: null, belowSinceMs: null })

  // Engaged: the packet's hysteresis is a LOWER re-entry threshold held for 4 s, so a temperature
  // hovering on the limit cannot chatter the alarm on and off.
  if (temperature > RC15_BRAKE_HOT_CLEAR_C) {
    return Object.freeze({ active: true, aboveSinceMs: state.aboveSinceMs, belowSinceMs: null })
  }
  const belowSinceMs = state.belowSinceMs ?? nowMs
  if (nowMs - belowSinceMs >= RC15_BRAKE_HOT_HYSTERESIS_MS) return SILENT_AXLE
  return Object.freeze({ active: true, aboveSinceMs: state.aboveSinceMs, belowSinceMs })
}

export function advanceRc15Alerts(state: Rc15AlertState, input: Rc15AlertInput): Rc15AlertState {
  const nowMs = finite(input.nowMs) ? input.nowMs : 0

  const brakeHot = Object.freeze({
    front: advanceAxle(state.brakeHot.front, input.frontTempC, nowMs),
    rear: advanceAxle(state.brakeHot.rear, input.rearTempC, nowMs)
  })

  // Balance extreme latches over CORNERS, not over time: the packet's debounce column says "latched
  // over 3 corners". A run of three consecutive scored corners must all be beyond the threshold and
  // all on the SAME side; one corner on the other side breaks the run outright.
  const recent = input.scoredCorners.slice(-RC15_BALANCE_EXTREME_CORNERS)
  const sides = recent.map((corner) =>
    corner.index === null || Math.abs(corner.index) < RC15_BALANCE_EXTREME_INDEX
      ? null
      : corner.index < 0
        ? ('UNDER' as const)
        : ('OVER' as const)
  )
  const latchedSide =
    recent.length === RC15_BALANCE_EXTREME_CORNERS && sides[0] !== null && sides.every((side) => side === sides[0])
      ? sides[0]
      : null

  let balanceExtreme = state.balanceExtreme
  if (latchedSide !== null) {
    balanceExtreme = Object.freeze({
      active: true,
      side: latchedSide,
      latchedOrdinal: recent[recent.length - 1].ordinal
    })
  } else if (state.balanceExtreme.active) {
    // Clear condition: the index has returned to the band. An index that has gone invalid also
    // clears — section 16 forbids labelling balance without valid steer and yaw inputs, and a
    // latched alarm is a label.
    const back =
      input.balanceIndex === null || Math.abs(input.balanceIndex) < RC15_BALANCE_EXTREME_INDEX
    balanceExtreme = back
      ? Object.freeze({ active: false, side: null, latchedOrdinal: null })
      : state.balanceExtreme
  }

  // Bias unavailable is a LOSS, not an absence: a channel this source never published cannot be
  // "lost", so a sim without a bias adjuster shows the truth-table dash with no alert at all.
  let biasUnavailable = state.biasUnavailable
  if (input.biasAvailable || !input.biasEverReported) {
    biasUnavailable = Object.freeze({ active: false, lostSinceMs: null })
  } else {
    const lostSinceMs = state.biasUnavailable.lostSinceMs ?? nowMs
    biasUnavailable = Object.freeze({
      active: state.biasUnavailable.active || nowMs - lostSinceMs >= RC15_BIAS_LOST_ENGAGE_MS,
      lostSinceMs
    })
  }

  return Object.freeze({ brakeHot, balanceExtreme, biasUnavailable })
}

export interface Rc15AlertFlags {
  readonly brakeHotFront: boolean
  readonly brakeHotRear: boolean
  readonly balanceExtreme: boolean
  readonly balanceExtremeSide: 'UNDER' | 'OVER' | null
  readonly biasUnavailable: boolean
  readonly any: boolean
}

export function rc15AlertFlags(state: Rc15AlertState): Rc15AlertFlags {
  const brakeHotFront = state.brakeHot.front.active
  const brakeHotRear = state.brakeHot.rear.active
  const balanceExtreme = state.balanceExtreme.active
  const biasUnavailable = state.biasUnavailable.active
  return Object.freeze({
    brakeHotFront,
    brakeHotRear,
    balanceExtreme,
    balanceExtremeSide: balanceExtreme ? state.balanceExtreme.side : null,
    biasUnavailable,
    any: brakeHotFront || brakeHotRear || balanceExtreme || biasUnavailable
  })
}

/** The DOM token list the stylesheet scopes every alert-coloured rule to. */
export function rc15AlertTokens(flags: Rc15AlertFlags): string {
  const tokens: string[] = []
  if (flags.brakeHotFront) tokens.push('brake-hot-front')
  if (flags.brakeHotRear) tokens.push('brake-hot-rear')
  if (flags.balanceExtreme) tokens.push('balance-extreme')
  if (flags.biasUnavailable) tokens.push('bias-unavailable')
  return tokens.length > 0 ? tokens.join(' ') : 'silent'
}

// ─────────────────────────────────────────────────────────── model

export interface Rc15HeatCell {
  readonly index: number
  readonly lit: boolean
}

export interface Rc15Pan {
  readonly axle: Rc15Axle
  readonly label: string
  readonly temperature: Rc01Field
  readonly cells: readonly Rc15HeatCell[]
  readonly litCells: number
  readonly hot: boolean
}

export interface Rc15CornerColumn {
  readonly id: string
  readonly label: string
  readonly ordinal: number | null
  readonly index: Rc01Field
  readonly markerOffsetPct: number | null
  readonly frontTemp: Rc01Field
  readonly rearTemp: Rc01Field
  readonly current: boolean
  readonly scored: boolean
}

export interface Rc15TrendPoint {
  readonly index: number
  readonly x: number
  readonly frontY: number | null
  readonly rearY: number | null
}

export interface Rc15Balance {
  readonly index: Rc01Field
  readonly word: Rc15BalanceWord | null
  readonly beamDeg: number
  readonly pegged: boolean
  readonly available: boolean
}

export interface Rc15Bias {
  readonly value: Rc01Field
  readonly unit: string
  readonly hint: Rc01Field
  readonly direction: 'FRONT' | 'REAR' | null
  readonly dashed: boolean
}

export interface Rc15DashboardModel {
  readonly balance: Rc15Balance
  readonly frontPan: Rc15Pan
  readonly rearPan: Rc15Pan
  readonly bias: Rc15Bias
  readonly steering: Rc01Field
  readonly latG: Rc01Field
  readonly corners: readonly Rc15CornerColumn[]
  readonly scoredCornerCount: number
  readonly trend: readonly Rc15TrendPoint[]
  readonly trendAvailable: boolean
  readonly cornerMapAvailable: boolean
  readonly alerts: Rc15AlertFlags
}

export interface Rc15ModelOptions {
  smoothedIndex?: number | null
  scoredCorners?: readonly Rc15ScoredCorner[]
  biasAdjustment?: Rc15BiasAdjustment | null
  trendSamples?: readonly Rc15CornerSample[]
  alerts?: Rc15AlertState
}

/** Packet 12.1's brake-temp trend, plotted on the same 0..hot-limit scale the pans use. */
export const RC15_TREND_LIMIT = 120

function trendY(celsius: number | null): number | null {
  if (!finite(celsius)) return null
  return round3(100 - clamp(celsius / RC15_BRAKE_HOT_LIMIT_C, 0, 1) * 100)
}

function panFor(
  axle: Rc15Axle,
  temperature: number | null,
  stale: boolean,
  hot: boolean
): Rc15Pan {
  const available = temperature !== null
  const litCells = rc15BrakeBarLitCells(temperature)
  const cells = Array.from({ length: RC15_BRAKE_BAR_CELLS }, (_unused, index) =>
    Object.freeze({ index, lit: available && index < litCells })
  )
  return Object.freeze({
    axle,
    label: axle === 'front' ? RC15_LABELS.frontAxle : RC15_LABELS.rearAxle,
    temperature: available
      ? field(rc15FormatTemperature(temperature), temperature, false, false, hot ? 'bad' : 'primary')
      // A sensor that has aged past its 200 ms budget is visibly degraded and distinguishable from
      // one that was never fitted: both dash, but only the stale one carries the stale flag.
      : field(RC15_DASH.brakeTemp, null, stale, true, 'muted'),
    cells: Object.freeze(cells),
    litCells: available ? litCells : 0,
    hot
  })
}

function cornerColumn(
  slot: number,
  corner: Rc15ScoredCorner | null,
  current: boolean
): Rc15CornerColumn {
  const scored = corner !== null
  const index = corner && corner.index !== null
    ? field(rc15FormatIndex(corner.index), corner.index)
    : unavailableField(RC15_DASH.index)
  return Object.freeze({
    id: `c${slot + 1}`,
    label: `C${slot + 1}`,
    ordinal: corner?.ordinal ?? null,
    index,
    markerOffsetPct: corner ? rc15MarkerOffsetPct(corner.index) : null,
    frontTemp: corner && corner.frontTempC !== null
      ? field(rc15FormatTemperature(corner.frontTempC), corner.frontTempC)
      : unavailableField(RC15_DASH.brakeTemp),
    rearTemp: corner && corner.rearTempC !== null
      ? field(rc15FormatTemperature(corner.rearTempC), corner.rearTempC)
      : unavailableField(RC15_DASH.brakeTemp),
    current: current && scored,
    scored
  })
}

/**
 * The whole frame, projected from the snapshot, the receipts and the acquisition state. Every field
 * is either a real reading from its own declared channel or its packet dash state. There is no third
 * option anywhere in this function.
 */
export function createRc15DashboardModel(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc15Channel, Rc01ChannelReceipt>,
  nowMs: number,
  options: Rc15ModelOptions = {}
): Rc15DashboardModel {
  const alerts = rc15AlertFlags(options.alerts ?? createRc15AlertState())
  const steering = reading(snapshot, receipts, 'steering', nowMs)
  const latG = reading(snapshot, receipts, 'latG', nowMs)
  const yawRate = reading(snapshot, receipts, 'yawRate', nowMs)
  const bias = reading(snapshot, receipts, 'brakeBias', nowMs)

  const front = rc15AxleTemperature(snapshot, receipts, 'front', nowMs)
  const rear = rc15AxleTemperature(snapshot, receipts, 'rear', nowMs)

  const liveIndex = rc15BalanceIndex({
    steeringDeg: steering.value,
    yawRateRadSec: yawRate.value,
    latG: latG.value
  })
  const displayedIndex = options.smoothedIndex !== undefined ? options.smoothedIndex : liveIndex
  const indexAvailable = displayedIndex !== null

  const balance: Rc15Balance = Object.freeze({
    index: indexAvailable
      ? field(rc15FormatIndex(displayedIndex), displayedIndex, false, false, alerts.balanceExtreme ? 'bad' : 'primary')
      : unavailableField(RC15_DASH.index),
    word: rc15BalanceWord(displayedIndex),
    beamDeg: rc15BeamAngleDeg(displayedIndex, alerts.balanceExtreme),
    pegged: alerts.balanceExtreme && indexAvailable,
    available: indexAvailable
  })

  const adjustment = options.biasAdjustment ?? null
  const biasModel: Rc15Bias = Object.freeze({
    value: bias.value !== null
      ? field(rc15FormatBias(bias.value), bias.value)
      : unavailableField(RC15_DASH.bias),
    unit: RC15_LABELS.biasUnit,
    hint: adjustment
      ? field(`${adjustment.direction} ${adjustment.magnitude.toFixed(1)}`, adjustment.magnitude)
      : unavailableField(RC15_DASH.hint),
    direction: adjustment?.direction ?? null,
    dashed: alerts.biasUnavailable
  })

  const scored = options.scoredCorners ?? []
  const recent = scored.slice(Math.max(0, scored.length - RC15_CORNER_COLUMNS))
  // The strip is right-aligned to the newest corner: column 6 is always the most recent scored
  // corner and carries the single current-corner underline, and unfilled columns to its left render
  // the datum tick with no marker rather than being packed or hidden.
  const pad = RC15_CORNER_COLUMNS - recent.length
  const corners = Array.from({ length: RC15_CORNER_COLUMNS }, (_unused, slot) =>
    cornerColumn(slot, slot < pad ? null : recent[slot - pad], slot === RC15_CORNER_COLUMNS - 1)
  )

  const trendSamples = (options.trendSamples ?? []).slice(-RC15_TREND_LIMIT)
  const trend = trendSamples.map((sample, index) =>
    Object.freeze({
      index,
      x: round3(trendSamples.length <= 1 ? 0 : (index / (trendSamples.length - 1)) * 100),
      frontY: trendY(sample.frontTempC),
      rearY: trendY(sample.rearTempC)
    })
  )

  return Object.freeze({
    balance,
    frontPan: panFor('front', front.value, front.stale, alerts.brakeHotFront),
    rearPan: panFor('rear', rear.value, rear.stale, alerts.brakeHotRear),
    bias: biasModel,
    steering: steering.value !== null
      ? field(rc15FormatSteering(steering.value), steering.value)
      : unavailableField(RC15_DASH.steering),
    latG: latG.value !== null
      ? field(rc15FormatLatG(latG.value), latG.value)
      : unavailableField(RC15_DASH.latG),
    corners: Object.freeze(corners),
    scoredCornerCount: scored.length,
    trend: Object.freeze(trend),
    trendAvailable: trend.some((point) => point.frontY !== null || point.rearY !== null),
    cornerMapAvailable: scored.length > 0,
    alerts
  })
}

/**
 * Fold the model back into the alert layer's input. Only FRESH readings reach it, so a channel that
 * has aged out cannot hold an alarm engaged, which is the packet's unlatch-on-stale rule.
 */
export function rc15AlertInputForModel(
  model: Rc15DashboardModel,
  nowMs: number,
  scoredCorners: readonly Rc15ScoredCorner[],
  biasEverReported: boolean
): Rc15AlertInput {
  return {
    nowMs,
    frontTempC: typeof model.frontPan.temperature.raw === 'number' ? model.frontPan.temperature.raw : null,
    rearTempC: typeof model.rearPan.temperature.raw === 'number' ? model.rearPan.temperature.raw : null,
    balanceIndex: typeof model.balance.index.raw === 'number' ? model.balance.index.raw : null,
    scoredCorners,
    biasAvailable: !model.bias.value.unavailable,
    biasEverReported
  }
}

/**
 * Anything the model can no longer justify is dropped from the alert state before it renders. This
 * is RC-01's `clearInvalidRc01CurrentAlerts` contract applied to RC-15's three alerts.
 */
export function clearInvalidRc15Alerts(state: Rc15AlertState, model: Rc15DashboardModel): Rc15AlertState {
  const front = model.frontPan.temperature.unavailable ? SILENT_AXLE : state.brakeHot.front
  const rear = model.rearPan.temperature.unavailable ? SILENT_AXLE : state.brakeHot.rear
  const balanceExtreme = model.balance.available
    ? state.balanceExtreme
    : Object.freeze({ active: false, side: null, latchedOrdinal: null })
  return Object.freeze({
    brakeHot: Object.freeze({ front, rear }),
    balanceExtreme,
    biasUnavailable: state.biasUnavailable
  })
}

// ─────────────────────────────────────────────────────────── accessible descriptions

/** Packet 19: the balance is a word and an angle before it is ever a hue. */
export function rc15BalanceDescription(balance: Rc15Balance): string {
  if (!balance.available) return 'Chassis balance index unavailable; steering or yaw inputs invalid'
  const word = balance.word === 'LEVEL' ? 'near level' : `tending ${balance.word?.toLowerCase()}`
  const pegged = balance.pegged ? ', beam pegged' : ''
  return `Computed chassis balance index ${balance.index.value}, ${word}, beam ${balance.beamDeg} degrees${pegged}`
}

export function rc15PanDescription(pan: Rc15Pan): string {
  const axle = pan.axle === 'front' ? 'Front axle' : 'Rear axle'
  if (pan.temperature.unavailable) return `${axle} brake temperature unavailable; no sensor`
  const hot = pan.hot ? `, ${RC15_LABELS.brakeHot}` : ''
  return `${axle} brake temperature ${pan.temperature.value} degrees Celsius, ${pan.litCells} of ${RC15_BRAKE_BAR_CELLS} heat cells${hot}`
}

export function rc15CornerDescription(column: Rc15CornerColumn): string {
  if (!column.scored) return `Corner slot ${column.label} not yet scored`
  const current = column.current ? ', current corner' : ''
  return `Corner ${column.label} balance index ${column.index.value}, brake front ${column.frontTemp.value}, rear ${column.rearTemp.value}${current}`
}

/**
 * A colour-free fingerprint of the frame's state, so the suite can prove the display is readable
 * with no colour perception at all: word, beam sign, lit-cell counts and alert words.
 */
export function rc15PatternFingerprint(model: Rc15DashboardModel): string {
  const beam = model.balance.available ? (model.balance.beamDeg === 0 ? '0' : model.balance.beamDeg > 0 ? '+' : '-') : 'x'
  return [
    `word:${model.balance.word ?? 'none'}`,
    `beam:${beam}`,
    `front:${model.frontPan.litCells}/${RC15_BRAKE_BAR_CELLS}`,
    `rear:${model.rearPan.litCells}/${RC15_BRAKE_BAR_CELLS}`,
    `alerts:${rc15AlertTokens(model.alerts)}`
  ].join('|')
}

export type { Rc01Field as Rc15Field }
