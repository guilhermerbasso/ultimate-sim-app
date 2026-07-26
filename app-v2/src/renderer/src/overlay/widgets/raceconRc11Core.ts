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
 * RC-11 "Trace Room — Race Engineer Analysis Wall" core.
 *
 * This is the first NON-DRIVER RaceCon page: an engineer's analysis wall, read between runs. There
 * is no gear hero, no shift LED arc, no rev bar and no oversized single numeral anywhere. Area
 * hierarchy is TRACE-driven (the speed and input plots own 47.9 % of the canvas); numeral hierarchy
 * is TILE-driven (the window-tile values are the tallest glyphs in the frame, per packet 11.2).
 *
 * The live-only ingest buffer, identity binding, mock/replay refusal, out-of-order and
 * same-timestamp guards, the shared channel receipts and the delta channel are reused verbatim from
 * `raceconRc01Core`: that is telemetry-truth machinery, not RC-01 styling, and a fork would
 * silently drift. RC-01's alert layer is deliberately NOT driven from here — RC-11's packet section
 * 15 alerts are post-computed analytical annotations with no live alarm, which is a different
 * contract from RC-01's over-rev / delta-cliff / zero-cross debounces.
 *
 * The single hardest requirement in the artifact is a GENUINELY shared distance axis. Packet 11.1
 * gives zones 1 and 2 a 96.0 % width and zones 3 and 4 a 63.75 % width, so equal plot widths are
 * only achievable by insetting the top two. Every distance-domain plot is therefore pinned to
 * x = 70..520 px at 800x480 and x = 88..718 px at 1024x600, the residual strip of zones 1 and 2 is
 * the legend block, and the scrub cursor is one fraction of that one shared width. Three earlier
 * attempts were rejected for letting the top traces run into the legend, after which a vertical
 * cursor read a different distance in each panel while looking perfectly aligned.
 *
 * Six packet contradictions are resolved by OMISSION and each one is asserted by the test suite
 * through `RC11_PACKET_OMISSIONS`, so a later edit cannot quietly reintroduce them.
 */

// ─────────────────────────────────────────────────────────── canvas + breakpoints

/** Packet section 11 native canvas, and the section 12.1 app reflow target. */
export const RC11_NATIVE_WIDTH_PX = 800
export const RC11_NATIVE_HEIGHT_PX = 480
export const RC11_NATIVE_TOLERANCE_PX = 1
export const RC11_APP_WIDTH_PX = 1024
export const RC11_APP_HEIGHT_PX = 600

export const RC11_PHONE_MIN_WIDTH_PX = 360
export const RC11_PHONE_MAX_WIDTH_PX = 480
export const RC11_PHONE_MIN_HEIGHT_PX = 650
export const RC11_LANDSCAPE_MIN_WIDTH_PX = 650
export const RC11_LANDSCAPE_MIN_HEIGHT_PX = 360
export const RC11_LANDSCAPE_MAX_HEIGHT_PX = 480

export type Rc11CompactMode = 'phone' | 'landscape' | 'standard'
export type Rc11Layout = 'native' | 'app' | 'compact'

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function round3(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

/**
 * The plot span and its insets are the one place in RC-11 where rounding is not free: at 1024 wide
 * the shared right edge is 70.1171875 %, and truncating it to six places moves the drawing region
 * by 5 nanometres in every panel — enough to break a strict pixel-identity assertion. Nine places
 * keeps every packet pixel exact in binary.
 */
function round9(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

// ─────────────────────────────────────────────────────────── packet omissions

/**
 * The packet requirements this build deliberately does NOT render, with the reason. Each key is
 * asserted by the suite: the omission is part of the contract, not an oversight.
 *
 *  - `lapDistanceChannel`  Sections 11, 11.1, 11.5, 12.1 and 17 all organise RC-11 around a shared
 *                          DISTANCE axis, yet section 16 defines no distance channel at all. Nothing
 *                          is invented: the axis is drawn, every one of its ticks renders the dash
 *                          placeholder, and no metre, kilometre, lap or sector number appears
 *                          anywhere in the frame. The trace ordinate is the sample's position inside
 *                          the shared acquisition window — engineer-facing UI state, never a
 *                          distance claim. RESOLUTION REQUESTED FROM THE PACKET OWNER: add a
 *                          `Lap distance` row to section 16 (source, unit m, freshness, invalid
 *                          rendering, never-estimate rule) before any distance numeral is printed.
 *  - `perWheelSpeedChannel` Section 15 triggers the lock-up flag on a "brake trace + wheel-speed
 *                          pattern", but section 16's `Speed` is a single vehicle-level channel with
 *                          no per-corner variant, and the app's telemetry snapshot carries no
 *                          per-wheel rotational speed either. The trigger therefore can never fire:
 *                          `rc11LockUpMarkers` returns an empty list for every input and the flag is
 *                          permanently silent, which is packet 15's own "no marker if wheel-speed
 *                          channel missing". RESOLUTION REQUESTED: add per-wheel wheel speed.
 *  - `rpmZone`             Section 16 defines `Engine RPM` with a 20 ms cadence and a 200 ms
 *                          freeze-and-grey rule, and section 11.4 offers an RPM trace "option", but
 *                          section 11.1 defines no zone for it and 12.1 adds none. RPM is therefore
 *                          not drawn at all — no trace, no numeral, and above all no LED arc, which
 *                          11.4 and the negative prompt both forbid.
 *  - `steeringAt800`       Section 10 makes steering angle secondary telemetry, 11.1 gives it no
 *                          800x480 zone and 12.1 adds it only at 1024x600. Resolved in favour of
 *                          11.1/12.1: the steering trace is app-only and is absent from the native
 *                          and compact grammars entirely.
 *  - `legendDivider`       Normative override 2. The approved render splits zones 1 and 2 into a
 *                          plot rectangle and a legend rectangle with a background gutter — ten
 *                          drawn rectangles against a compliant eight — although each pair's union
 *                          stays inside the declared zone. One `panel` rectangle per zone is built
 *                          with an INTERNAL legend region and no visible divider.
 *  - `fixedTroughCount`    Normative override 5. The reference draws four clearly measurable braking
 *                          troughs where five were specified. Trough count is DATA, not design: the
 *                          traces are drawn from the acquired samples and no fixed number of troughs,
 *                          corners or events is ever synthesised.
 */
export const RC11_PACKET_OMISSIONS = Object.freeze({
  lapDistanceChannel:
    'packet 11/11.1/11.5/12.1/17 organise RC-11 around a distance axis that section 16 never defines: the axis is drawn with every tick dashed and no distance, lap or sector numeral is printed anywhere',
  perWheelSpeedChannel:
    'packet 15 triggers the lock-up flag on a wheel-speed pattern that section 16 never defines: the trigger can never fire and the flag stays permanently silent with no marker',
  rpmZone:
    'packet 16 engine RPM and packet 11.4 rpm-trace option have no zone in 11.1 or 12.1: RPM is not drawn as a trace, a numeral or — above all — an LED arc',
  steeringAt800:
    'packet 10 makes steering secondary while 11.1 gives it no 800x480 zone: the steering trace is app-only and absent from the native and compact grammars',
  legendDivider:
    'packet zones 1 and 2 are one panel each: the render splits them into plot plus legend rectangles, and the divider and background gutter are omitted',
  fixedTroughCount:
    'packet 17 specifies five braking troughs and the render draws four: trough count is data, so no fixed number of troughs is ever synthesised'
})

/** Modules the wider canvas reveals, which must be absent at 800x480. Packet 12.1 expansion model. */
export const RC11_APP_ONLY_MODULES = Object.freeze(['steering', 'sectors'] as const)

// ─────────────────────────────────────────────────────────── tokens

/** Packet 11.3 tokens, verbatim. */
export const RC11_TOKENS = Object.freeze({
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

export type Rc11Token = keyof typeof RC11_TOKENS

/**
 * The three tokens that must measure ZERO pixels in a silent frame. Packet section 15 forbids any
 * alert-layer element being used as decoration, and all three RC-11 alerts are silent by default,
 * so `normal`, `caution` and `danger` may only ever be bound inside an alert-scoped rule.
 */
export const RC11_SILENT_TOKENS = Object.freeze(['normal', 'caution', 'danger'] as const)

/**
 * Packet 11.3's two lap identities. The current lap is `info` cyan and SOLID; the reference lap is
 * `signature` violet and DASHED. Packet 19: the pair is separable by line pattern with no colour
 * perception at all, which is why the style is carried in the model rather than only in CSS.
 */
export const RC11_LAP_TOKENS = Object.freeze({ current: 'info' as const, reference: 'signature' as const })

/**
 * The approved frame's accessibility measurements, recorded so a regression is visible: the current
 * trace is one near-continuous solid stroke, the reference is a dashed stroke of many components.
 */
export const RC11_REFERENCE_ACCESSIBILITY = Object.freeze({
  currentCoverage: 0.979,
  referenceCoverage: 0.772,
  referenceComponents: 91,
  minCurrentCoverage: 0.9,
  maxReferenceCoverage: 0.88,
  minReferenceComponents: 12,
  minBrakeComponents: 8
})

// ─────────────────────────────────────────────────────────── type ladder

/**
 * Normative override 3. Packet 11.2's ladder in pixels on the 800x480 canvas, set ARITHMETICALLY
 * and never measured off the render: all four attempts tied the cursor readout to the trace-legend
 * cap height (14/14, 16/16, 8/8, 15/15 measured), and that reading is not copied.
 *
 * Numeral hierarchy is tile-driven and deliberately counter-intuitive: the window-tile values are
 * the tallest glyphs in the frame even though the traces own the area.
 */
export const RC11_TYPE_SCALE_PX = Object.freeze({
  tileValue: 28,
  cursorReadout: 22,
  traceLegend: 16,
  axisLabel: 14
})

/** Packet 12.1's type step: 1024 / 800. The ladder GROWS with the canvas, it does not re-rank. */
export const RC11_APP_TYPE_SCALE = RC11_APP_WIDTH_PX / RC11_NATIVE_WIDTH_PX

/** One container-query width unit is one hundredth of the native canvas: 800 / 100 = 8 px. */
export const RC11_CQW_PX = RC11_NATIVE_WIDTH_PX / 100

/**
 * The px ladder expressed in the container units the stylesheet actually uses. Because the app
 * canvas is exactly 1.28x the native canvas, ONE cqw ladder satisfies both breakpoints: 28 px at
 * 800 wide and 35.84 px at 1024 wide are the same 3.5 cqw. The suite asserts that identity.
 */
export function rc11TypeScaleCqw(px: number): number {
  return round3(px / RC11_CQW_PX)
}

/** The physical size a rung renders at on a given canvas width, for the arithmetic assertions. */
export function rc11TypeScalePxForWidth(px: number, canvasWidthPx: number): number {
  return round3((rc11TypeScaleCqw(px) * canvasWidthPx) / 100)
}

// ─────────────────────────────────────────────────────────── zones

export interface Rc11RectPx {
  x: number
  y: number
  width: number
  height: number
}

export interface Rc11Rect {
  left: number
  top: number
  width: number
  height: number
}

export type Rc11ZoneId = 'speed' | 'inputs' | 'gear' | 'delta' | 'gg' | 'tiles' | 'sectors'

export type Rc11ZoneMapPx = Readonly<Partial<Record<Rc11ZoneId, Rc11RectPx>>>
export type Rc11ZoneMap = Readonly<Partial<Record<Rc11ZoneId, Rc11Rect>>>

/**
 * Packet 11.1's zones for the 800x480 canvas, in the packet's own pixels. Normative override 1 is
 * explicit that the render is never traced: measured drift reaches -14.58 pp on the G-G origin and
 * +13.33 pp on its height, so the packet boxes win outright.
 *
 * There is deliberately no `sectors` box: the mini-sector table is a 12.1 reveal.
 */
export const RC11_NATIVE_ZONES_PX: Rc11ZoneMapPx = Object.freeze({
  speed: Object.freeze({ x: 16, y: 30, width: 768, height: 120 }),
  inputs: Object.freeze({ x: 16, y: 158, width: 768, height: 110 }),
  gear: Object.freeze({ x: 16, y: 276, width: 510, height: 80 }),
  delta: Object.freeze({ x: 16, y: 362, width: 510, height: 100 }),
  gg: Object.freeze({ x: 540, y: 276, width: 244, height: 110 }),
  tiles: Object.freeze({ x: 540, y: 394, width: 244, height: 68 })
})

/**
 * Packet 12.1's `analysis-table-reveal`. The extra width buys exactly two things — a steering trace
 * inside the inputs overlay and a corner-by-corner time-loss table — and the shared-axis trace wall
 * stays the organising idea. It is an EXPANSION, never a scale.
 *
 * Packet 12.1 declares the gear and delta traces as ONE stacked box at (24, 338, 700, 220). They
 * are rendered as two panels inside that box; `RC11_APP_STACK_PX` records the declared box so the
 * suite can prove the union of the two panels is exactly it.
 */
export const RC11_APP_STACK_PX: Rc11RectPx = Object.freeze({ x: 24, y: 338, width: 700, height: 220 })
export const RC11_APP_STACK_GUTTER_PX = 4

export const RC11_APP_ZONES_PX: Rc11ZoneMapPx = Object.freeze({
  speed: Object.freeze({ x: 24, y: 24, width: 1_000, height: 150 }),
  inputs: Object.freeze({ x: 24, y: 186, width: 700, height: 140 }),
  gear: Object.freeze({ x: 24, y: 338, width: 700, height: 104 }),
  delta: Object.freeze({ x: 24, y: 446, width: 700, height: 112 }),
  gg: Object.freeze({ x: 740, y: 186, width: 284, height: 116 }),
  tiles: Object.freeze({ x: 740, y: 306, width: 284, height: 80 }),
  sectors: Object.freeze({ x: 740, y: 398, width: 284, height: 160 })
})

/**
 * Packet 12.1 declares ONE "G-G + windows" box at (740, 186, 284, 200). The G-G scatter and the
 * window tiles are rendered as two panels inside it; the suite proves their union is exactly it.
 */
export const RC11_APP_GG_WINDOW_PX: Rc11RectPx = Object.freeze({ x: 740, y: 186, width: 284, height: 200 })
export const RC11_APP_GG_WINDOW_GUTTER_PX = 4

/** The four distance-domain panels, in reading order. One cursor ties exactly these together. */
export const RC11_DISTANCE_ZONES = Object.freeze(['speed', 'inputs', 'gear', 'delta'] as const)

export type Rc11PlotId = (typeof RC11_DISTANCE_ZONES)[number]

/**
 * THE most important numbers in RC-11. Every distance-domain plot spans exactly these x pixels, so
 * a vertical cursor reads the SAME ordinate in all four panels. The residual strip of zones 1 and 2
 * is the legend block and no trace may enter it.
 */
export const RC11_NATIVE_PLOT_X0_PX = 70
export const RC11_NATIVE_PLOT_X1_PX = 520
export const RC11_APP_PLOT_X0_PX = 88
export const RC11_APP_PLOT_X1_PX = 718

export interface Rc11PlotSpan {
  x0: number
  x1: number
  width: number
  canvasWidth: number
}

export function rc11PlotSpanPx(layout: Rc11Layout): Rc11PlotSpan {
  if (layout === 'app') {
    return {
      x0: RC11_APP_PLOT_X0_PX,
      x1: RC11_APP_PLOT_X1_PX,
      width: RC11_APP_PLOT_X1_PX - RC11_APP_PLOT_X0_PX,
      canvasWidth: RC11_APP_WIDTH_PX
    }
  }
  return {
    x0: RC11_NATIVE_PLOT_X0_PX,
    x1: RC11_NATIVE_PLOT_X1_PX,
    width: RC11_NATIVE_PLOT_X1_PX - RC11_NATIVE_PLOT_X0_PX,
    canvasWidth: RC11_NATIVE_WIDTH_PX
  }
}

function canvasSizePx(layout: Rc11Layout): { width: number; height: number } {
  return layout === 'app'
    ? { width: RC11_APP_WIDTH_PX, height: RC11_APP_HEIGHT_PX }
    : { width: RC11_NATIVE_WIDTH_PX, height: RC11_NATIVE_HEIGHT_PX }
}

export function rc11ZonesPxForLayout(layout: Rc11Layout): Rc11ZoneMapPx {
  return layout === 'app' ? RC11_APP_ZONES_PX : RC11_NATIVE_ZONES_PX
}

/** A packet pixel box as canvas percentages, which is what the DOM actually carries. */
export function rc11RectPercent(rect: Rc11RectPx, canvasWidth: number, canvasHeight: number): Rc11Rect {
  return {
    left: round6((rect.x / canvasWidth) * 100),
    top: round6((rect.y / canvasHeight) * 100),
    width: round6((rect.width / canvasWidth) * 100),
    height: round6((rect.height / canvasHeight) * 100)
  }
}

/**
 * The compact grammars are not packet-specified. They keep the trace wall — four stacked
 * distance-domain plots over one shared axis — and drop only the two app-only reveals, so the
 * cursor, the DATA GAP band and the lift/coast marker keep a visible surface at every size.
 */
function rc11CompactZonesPx(mode: Rc11CompactMode, width: number, height: number): Rc11ZoneMapPx {
  if (mode === 'phone') {
    return Object.freeze({
      speed: Object.freeze({ x: 0.02 * width, y: 0.03 * height, width: 0.96 * width, height: 0.2 * height }),
      inputs: Object.freeze({ x: 0.02 * width, y: 0.25 * height, width: 0.96 * width, height: 0.18 * height }),
      gear: Object.freeze({ x: 0.02 * width, y: 0.45 * height, width: 0.96 * width, height: 0.12 * height }),
      delta: Object.freeze({ x: 0.02 * width, y: 0.59 * height, width: 0.96 * width, height: 0.16 * height }),
      gg: Object.freeze({ x: 0.02 * width, y: 0.77 * height, width: 0.46 * width, height: 0.2 * height }),
      tiles: Object.freeze({ x: 0.52 * width, y: 0.77 * height, width: 0.46 * width, height: 0.2 * height })
    })
  }
  if (mode === 'landscape') {
    return Object.freeze({
      speed: Object.freeze({ x: 0.02 * width, y: 0.05 * height, width: 0.96 * width, height: 0.24 * height }),
      inputs: Object.freeze({ x: 0.02 * width, y: 0.31 * height, width: 0.96 * width, height: 0.22 * height }),
      gear: Object.freeze({ x: 0.02 * width, y: 0.55 * height, width: 0.638 * width, height: 0.17 * height }),
      delta: Object.freeze({ x: 0.02 * width, y: 0.74 * height, width: 0.638 * width, height: 0.21 * height }),
      gg: Object.freeze({ x: 0.675 * width, y: 0.55 * height, width: 0.305 * width, height: 0.23 * height }),
      tiles: Object.freeze({ x: 0.675 * width, y: 0.8 * height, width: 0.305 * width, height: 0.15 * height })
    })
  }
  return Object.freeze({
    speed: Object.freeze({ x: 0.02 * width, y: 0.04 * height, width: 0.96 * width, height: 0.24 * height }),
    inputs: Object.freeze({ x: 0.02 * width, y: 0.3 * height, width: 0.96 * width, height: 0.22 * height }),
    gear: Object.freeze({ x: 0.02 * width, y: 0.54 * height, width: 0.638 * width, height: 0.16 * height }),
    delta: Object.freeze({ x: 0.02 * width, y: 0.72 * height, width: 0.638 * width, height: 0.2 * height }),
    gg: Object.freeze({ x: 0.675 * width, y: 0.54 * height, width: 0.305 * width, height: 0.22 * height }),
    tiles: Object.freeze({ x: 0.675 * width, y: 0.78 * height, width: 0.305 * width, height: 0.14 * height })
  })
}

/**
 * The compact plot span keeps the same PROPORTIONS as the native grammar so the shared axis
 * survives the reflow: the inset is the native inset expressed as a fraction of the canvas.
 */
export const RC11_COMPACT_PLOT_X0_FRACTION = RC11_NATIVE_PLOT_X0_PX / RC11_NATIVE_WIDTH_PX
export const RC11_COMPACT_PLOT_X1_FRACTION = RC11_NATIVE_PLOT_X1_PX / RC11_NATIVE_WIDTH_PX

export function rc11ZonesForLayout(
  layout: Rc11Layout,
  compactMode: Rc11CompactMode = 'standard',
  box: { width: number; height: number } = canvasSizePx(layout)
): Rc11ZoneMap {
  const size = layout === 'compact' ? box : canvasSizePx(layout)
  const zonesPx =
    layout === 'compact' ? rc11CompactZonesPx(compactMode, size.width, size.height) : rc11ZonesPxForLayout(layout)
  const entries = (Object.keys(zonesPx) as Rc11ZoneId[]).map((id) => [
    id,
    Object.freeze(rc11RectPercent(zonesPx[id] as Rc11RectPx, size.width, size.height))
  ])
  return Object.freeze(Object.fromEntries(entries)) as Rc11ZoneMap
}

/**
 * The plot inset a panel carries, expressed in CONTAINER-QUERY WIDTH UNITS rather than in panel
 * percentages. One cqw is one hundredth of the widget box for every panel, so an inset of
 * `plotX0 - zoneX` cqw resolves to the SAME canvas pixel in a 768 px panel and in a 510 px panel.
 * That is what makes the four drawing regions pixel-identical rather than merely similar.
 */
export interface Rc11PlotInsetCqw {
  left: number
  right: number
}

/** The shared plot span as canvas percentages — the one pair of numbers all four panels obey. */
export function rc11PlotSpanPercent(layout: Rc11Layout): { x0: number; x1: number } {
  if (layout === 'compact') {
    return {
      x0: round9(RC11_COMPACT_PLOT_X0_FRACTION * 100),
      x1: round9(RC11_COMPACT_PLOT_X1_FRACTION * 100)
    }
  }
  const span = rc11PlotSpanPx(layout)
  return {
    x0: round9((span.x0 / span.canvasWidth) * 100),
    x1: round9((span.x1 / span.canvasWidth) * 100)
  }
}

export function rc11PlotInsetCqw(zone: Rc11Rect, layout: Rc11Layout): Rc11PlotInsetCqw {
  const span = rc11PlotSpanPercent(layout)
  return {
    left: round9(span.x0 - zone.left),
    right: round9(zone.left + zone.width - span.x1)
  }
}

/** The plot's drawing region in canvas pixels — the number the suite compares across panels. */
export function rc11PlotRegionPx(layout: Rc11Layout, canvasWidthPx?: number): { x0: number; x1: number } {
  if (layout === 'compact') {
    const width = canvasWidthPx ?? RC11_NATIVE_WIDTH_PX
    return {
      x0: round3(RC11_COMPACT_PLOT_X0_FRACTION * width),
      x1: round3(RC11_COMPACT_PLOT_X1_FRACTION * width)
    }
  }
  const span = rc11PlotSpanPx(layout)
  return { x0: span.x0, x1: span.x1 }
}

/** The canvas x a cursor fraction lands on. Identical in all four panels, by construction. */
export function rc11CursorCanvasXPx(fraction: number, layout: Rc11Layout, canvasWidthPx?: number): number {
  const region = rc11PlotRegionPx(layout, canvasWidthPx)
  const safe = finite(fraction) ? clamp(fraction, 0, 1) : 0
  return round3(region.x0 + safe * (region.x1 - region.x0))
}

export type Rc11LegendPlacement = 'strip' | 'inline'

/**
 * The narrowest residual strip that can still carry a stacked legend block. Below it the legend
 * moves onto the panel's title line instead of being squeezed to nothing: packet 12.1 shrinks the
 * inputs overlay to 700 px while the shared plot still ends at 718, leaving a 6 px strip that no
 * legend can live in. The legend stays INSIDE the same panel either way — normative override 2
 * forbids a second rectangle — and the plot region is never given up to make room for it.
 */
export const RC11_LEGEND_MIN_STRIP_CQW = 8

export function rc11LegendPlacement(zone: Rc11Rect | undefined, layout: Rc11Layout): Rc11LegendPlacement {
  if (!zone) return 'inline'
  return rc11PlotInsetCqw(zone, layout).right >= RC11_LEGEND_MIN_STRIP_CQW ? 'strip' : 'inline'
}

export function rc11RectsOverlap(a: Rc11Rect, b: Rc11Rect): boolean {  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  )
}

/** A 0..100 coordinate as a CSS percentage, without binary-float noise in the DOM. */
export function rc11Percent(value: number): string {
  return `${round3(finite(value) ? value : 0)}%`
}

export function rc11ZoneStyle(rect: Rc11Rect | undefined): {
  left: string
  top: string
  width: string
  height: string
} | null {
  if (!rect) return null
  return {
    left: rc11Percent(rect.left),
    top: rc11Percent(rect.top),
    width: rc11Percent(rect.width),
    height: rc11Percent(rect.height)
  }
}

// ─────────────────────────────────────────────────────────── layout resolution

export function rc11LayoutForContentBox(width: number, height: number): Rc11Layout {
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return 'app'
  if (
    Math.abs(width - RC11_NATIVE_WIDTH_PX) <= RC11_NATIVE_TOLERANCE_PX &&
    Math.abs(height - RC11_NATIVE_HEIGHT_PX) <= RC11_NATIVE_TOLERANCE_PX
  ) {
    return 'native'
  }
  if (width >= RC11_APP_WIDTH_PX - 1 && height >= RC11_APP_HEIGHT_PX - 1) return 'app'
  return 'compact'
}

export function rc11CompactModeForContentBox(width: number, height: number): Rc11CompactMode {
  if (rc11LayoutForContentBox(width, height) !== 'compact') return 'standard'
  if (
    width >= RC11_PHONE_MIN_WIDTH_PX &&
    width <= RC11_PHONE_MAX_WIDTH_PX &&
    height >= RC11_PHONE_MIN_HEIGHT_PX &&
    height / width >= 1.5
  ) {
    return 'phone'
  }
  if (
    width >= RC11_LANDSCAPE_MIN_WIDTH_PX &&
    height >= RC11_LANDSCAPE_MIN_HEIGHT_PX &&
    height <= RC11_LANDSCAPE_MAX_HEIGHT_PX &&
    width / height >= 1.5
  ) {
    return 'landscape'
  }
  return 'standard'
}

export interface Rc11PhoneGeometry {
  inset: number
  legendHeight: number
  axisHeight: number
  tileHeight: number
}

export function rc11PhoneGeometryForContentBox(width: number, height: number): Rc11PhoneGeometry | null {
  if (rc11CompactModeForContentBox(width, height) !== 'phone') return null
  return {
    inset: 8,
    legendHeight: Math.max(16, Math.round(height * 0.026)),
    axisHeight: Math.max(14, Math.round(height * 0.024)),
    tileHeight: Math.max(40, Math.round(height * 0.09))
  }
}

// ─────────────────────────────────────────────────────────── channels

/**
 * Packet section 16 freshness budgets for the channels the shared RC-01 layer does not already
 * carry with RC-11's own budget. Throttle, brake, steering and both IMU axes are the packet's
 * verbatim 20 ms; gear is 50 ms; speed is 100 ms; tyre and brake temperatures are 200 ms.
 *
 * `delta` (250 ms, refused outright without a stored best lap) is NOT here: it comes from the
 * shared RC-01 model, whose budget and never-extrapolate semantics already ARE this packet's.
 * `rpm` is deliberately absent — see `RC11_PACKET_OMISSIONS.rpmZone`.
 */
export const RC11_CHANNEL_STALE_MS = {
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
} as const

export type Rc11AuxChannel = keyof typeof RC11_CHANNEL_STALE_MS

/**
 * Packet 16: speed greys as soon as it misses its 100 ms cadence but only collapses to the
 * three-character dash once the source has been quiet for more than 500 ms.
 */
export const RC11_SPEED_DASH_MS = 500

/** Packet 16 dash states, verbatim, so the widget and the suite cannot drift from the table. */
export const RC11_DASH = Object.freeze({
  speed: '---',
  delta: '--.---',
  gear: '-',
  tyre: '--',
  brakeTemp: '--',
  distance: '--',
  sector: '--.---'
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

/**
 * Every RC-11 channel is read straight from its own declared source. Nothing is modelled, mirrored
 * or substituted: the speed never from RPM times a ratio, the gear never from RPM or speed, the
 * braking never inferred from deceleration, the G never synthesised from speed and radius, the
 * steering never from yaw, and no tyre corner is ever mirrored onto another.
 */
export function rc11AuxChannelValue(
  snapshot: TelemetrySnapshot,
  channel: Rc11AuxChannel
): number | string | null {
  switch (channel) {
    case 'speed':
      return finite(snapshot.speedKmh) && snapshot.speedKmh >= 0 ? snapshot.speedKmh : null
    case 'throttle':
      return finite(snapshot.throttle) ? clamp(snapshot.throttle, 0, 1) * 100 : null
    case 'brake':
      return finite(snapshot.brake) ? clamp(snapshot.brake, 0, 1) * 100 : null
    case 'steering':
      return finite(snapshot.steerAngleDeg) ? snapshot.steerAngleDeg : null
    case 'latG':
      return finite(snapshot.latAccelG) ? snapshot.latAccelG : null
    case 'longG':
      return finite(snapshot.longAccelG) ? snapshot.longAccelG : null
    case 'gear':
      return finite(snapshot.gear) && Number.isInteger(snapshot.gear) ? snapshot.gear : null
    case 'tyreFl':
      return finite(snapshot.tyres?.lf?.tempC) ? (snapshot.tyres!.lf.tempC as number) : null
    case 'tyreFr':
      return finite(snapshot.tyres?.rf?.tempC) ? (snapshot.tyres!.rf.tempC as number) : null
    case 'brakeTempF':
      // Packet 16 window tile 3 is the FRONT-AXLE brake temperature. It exists only when BOTH front
      // corners report: a single corner is one corner's temperature, and publishing it as the axle
      // would be exactly the mirroring the packet forbids.
      return finite(snapshot.brakeTempC?.lf) && finite(snapshot.brakeTempC?.rf)
        ? ((snapshot.brakeTempC!.lf as number) + (snapshot.brakeTempC!.rf as number)) / 2
        : null
  }
  return null
}

/**
 * `RC11_PACKET_OMISSIONS.perWheelSpeedChannel`, expressed as a function so the absence is MEASURED
 * by the suite rather than asserted about a comment. Section 16 defines no per-corner wheel speed
 * and the app's snapshot carries none, so this returns null for every snapshot and every corner and
 * the lock-up trigger can never fire.
 */
export function rc11WheelSpeedKmh(
  _snapshot: TelemetrySnapshot | null,
  _corner: 'lf' | 'rf' | 'lr' | 'rr'
): number | null {
  return null
}

/**
 * `RC11_PACKET_OMISSIONS.lapDistanceChannel`, expressed as a function for the same reason. Section
 * 16 defines no lap-distance channel, so the axis has no values and every tick dashes.
 */
export function rc11LapDistanceM(_snapshot: TelemetrySnapshot | null): number | null {
  return null
}

/** Packet 16: 'N' or the grey '-'; a gear is never blanked silently and never comes from RPM. */
export function rc11DisplayGear(gear: number | null): string {
  if (gear === null || !finite(gear)) return RC11_DASH.gear
  if (gear < 0) return 'R'
  if (gear === 0) return 'N'
  return String(Math.trunc(gear))
}

/** Packet 16: the delta always carries its sign character, at the packet's millisecond precision. */
export function rc11FormatDelta(seconds: number | null): string {
  if (!finite(seconds)) return RC11_DASH.delta
  return `${seconds >= 0 ? '+' : '-'}${Math.abs(seconds).toFixed(3)}`
}

export function rc11FormatTemperature(celsius: number | null): string {
  if (!finite(celsius)) return RC11_DASH.tyre
  return String(Math.round(celsius))
}

// ─────────────────────────────────────────────────────────── receipts

/**
 * Receipts for RC-11's own channels, with exactly RC-01's semantics: a receipt is written only when
 * the channel actually reports, so a channel that falls silent ages out and degrades to its packet
 * state instead of freezing on its last value.
 */
export class Rc11AuxBuffer {
  private channelReceipts = new Map<Rc11AuxChannel, Rc01ChannelReceipt>()

  clone(): Rc11AuxBuffer {
    const next = new Rc11AuxBuffer()
    next.channelReceipts = new Map(this.channelReceipts)
    return next
  }

  reset(): void {
    this.channelReceipts = new Map()
  }

  ingest(snapshot: TelemetrySnapshot | null | undefined, receivedAt = rc01MonotonicNow()): void {
    if (!snapshot || !snapshot.connected || !finite(snapshot.timestamp)) return
    const safeReceiptAt = finite(receivedAt) && receivedAt >= 0 ? receivedAt : rc01MonotonicNow()
    for (const channel of Object.keys(RC11_CHANNEL_STALE_MS) as Rc11AuxChannel[]) {
      const value = rc11AuxChannelValue(snapshot, channel)
      if (value === null) continue
      this.channelReceipts.set(
        channel,
        Object.freeze({ value, snapshotTimestamp: snapshot.timestamp, receivedAt: safeReceiptAt })
      )
    }
  }

  receipts(): ReadonlyMap<Rc11AuxChannel, Rc01ChannelReceipt> {
    return new Map(this.channelReceipts)
  }
}

export function createRc11AuxReceipts(
  snapshot: TelemetrySnapshot,
  receivedAt = rc01MonotonicNow()
): ReadonlyMap<Rc11AuxChannel, Rc01ChannelReceipt> {
  const buffer = new Rc11AuxBuffer()
  buffer.ingest(snapshot, receivedAt)
  return buffer.receipts()
}

interface Rc11Reading {
  value: number | string | null
  lastKnown: number | string | null
  stale: boolean
  ageMs: number
}

function auxReading(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc11AuxChannel, Rc01ChannelReceipt>,
  channel: Rc11AuxChannel,
  nowMs: number
): Rc11Reading {
  const raw = snapshot ? rc11AuxChannelValue(snapshot, channel) : null
  const receipt = receipts.get(channel)
  if (raw === null || !receipt) {
    return { value: null, lastKnown: null, stale: false, ageMs: Number.POSITIVE_INFINITY }
  }
  const ageMs = rc01ReceiptAgeMs(receipt, nowMs)
  const stale = ageMs > RC11_CHANNEL_STALE_MS[channel]
  return {
    value: stale ? null : raw,
    lastKnown: typeof receipt.value === 'boolean' ? null : receipt.value,
    stale,
    ageMs
  }
}

// ─────────────────────────────────────────────────────────── trace acquisition

/**
 * One acquired frame of the analysis wall. Every field is independently nullable: a channel that
 * drops out writes null and the trace BREAKS there. Nothing is ever carried across a dropout, which
 * is packet 15's "never interpolate across the gap" implemented rather than merely quoted.
 */
export interface Rc11TraceSample {
  readonly timestamp: number
  readonly receivedAt: number
  readonly lap: number | null
  readonly speedKmh: number | null
  readonly throttlePct: number | null
  readonly brakePct: number | null
  readonly steeringDeg: number | null
  readonly gear: number | null
  readonly deltaSec: number | null
  readonly latG: number | null
  readonly longG: number | null
}

/** The acquisition window. The traces are read, not watched, so the window is generous. */
export const RC11_TRACE_LIMIT = 360

function traceValue(snapshot: TelemetrySnapshot, channel: Rc11AuxChannel): number | null {
  const value = rc11AuxChannelValue(snapshot, channel)
  return typeof value === 'number' ? value : null
}

export function rc11TraceSampleFor(
  snapshot: TelemetrySnapshot,
  receivedAt: number,
  deltaSec: number | null
): Rc11TraceSample {
  return Object.freeze({
    timestamp: snapshot.timestamp,
    receivedAt,
    lap: finite(snapshot.currentLap) ? Math.trunc(snapshot.currentLap) : null,
    speedKmh: traceValue(snapshot, 'speed'),
    throttlePct: traceValue(snapshot, 'throttle'),
    brakePct: traceValue(snapshot, 'brake'),
    steeringDeg: traceValue(snapshot, 'steering'),
    gear: traceValue(snapshot, 'gear'),
    deltaSec,
    latG: traceValue(snapshot, 'latG'),
    longG: traceValue(snapshot, 'longG')
  })
}

/**
 * A bounded ring of acquired frames plus the reference lap the engineer overlays against. The
 * reference is NEVER synthesised: it is promoted only from a lap this widget observed from its
 * first frame to its last, and only when that lap actually became the stored best.
 */
export class Rc11TraceBuffer {
  private samples: Rc11TraceSample[] = []
  private currentLap: Rc11TraceSample[] = []
  private currentLapNumber: number | null = null
  private currentLapWholeLap = false
  private referenceLap: readonly Rc11TraceSample[] = []
  private referenceBestSec: number | null = null

  clone(): Rc11TraceBuffer {
    const next = new Rc11TraceBuffer()
    next.samples = this.samples.slice()
    next.currentLap = this.currentLap.slice()
    next.currentLapNumber = this.currentLapNumber
    next.currentLapWholeLap = this.currentLapWholeLap
    next.referenceLap = this.referenceLap
    next.referenceBestSec = this.referenceBestSec
    return next
  }

  reset(): void {
    this.samples = []
    this.currentLap = []
    this.currentLapNumber = null
    this.currentLapWholeLap = false
    this.referenceLap = []
    this.referenceBestSec = null
  }

  ingest(
    snapshot: TelemetrySnapshot | null | undefined,
    receivedAt: number,
    deltaSec: number | null
  ): void {
    if (!snapshot || !snapshot.connected || !finite(snapshot.timestamp)) return
    const sample = rc11TraceSampleFor(snapshot, receivedAt, deltaSec)
    this.samples.push(sample)
    if (this.samples.length > RC11_TRACE_LIMIT) {
      this.samples = this.samples.slice(this.samples.length - RC11_TRACE_LIMIT)
    }

    const lap = sample.lap
    if (lap === null) {
      // With no lap counter there is no lap boundary to observe, so no lap can ever be promoted to
      // the reference. The current-lap accumulator is abandoned rather than guessed at.
      this.currentLap = []
      this.currentLapNumber = null
      this.currentLapWholeLap = false
      return
    }

    if (this.currentLapNumber === null) {
      // Mounted mid-lap: this lap was NOT observed from its start, so it can never become the
      // reference. RC-02's lesson — a truncated fragment poisons the reference forever.
      this.currentLapNumber = lap
      this.currentLapWholeLap = false
      this.currentLap = [sample]
      return
    }

    if (lap === this.currentLapNumber) {
      this.currentLap.push(sample)
      if (this.currentLap.length > RC11_TRACE_LIMIT) {
        this.currentLap = this.currentLap.slice(this.currentLap.length - RC11_TRACE_LIMIT)
      }
      return
    }

    // A lap boundary. The lap that just closed is promotable only when it was observed whole AND it
    // genuinely became the stored best lap.
    const closed = this.currentLap.slice()
    const wasWhole = this.currentLapWholeLap
    this.currentLapNumber = lap
    this.currentLapWholeLap = true
    this.currentLap = [sample]

    if (!wasWhole || closed.length < 2) return
    const best = finite(snapshot.bestLapTimeSec) && snapshot.bestLapTimeSec > 0 ? snapshot.bestLapTimeSec : null
    const last = finite(snapshot.lastLapTimeSec) && snapshot.lastLapTimeSec > 0 ? snapshot.lastLapTimeSec : null
    if (best === null || last === null) return
    // The closed lap IS the stored best only when the two agree to the millisecond the sim reports.
    if (Math.abs(best - last) > 0.001) return
    if (this.referenceBestSec !== null && best >= this.referenceBestSec) return
    this.referenceLap = Object.freeze(closed)
    this.referenceBestSec = best
  }

  history(): readonly Rc11TraceSample[] {
    return this.samples.slice()
  }

  reference(): readonly Rc11TraceSample[] {
    return this.referenceLap
  }

  referenceBestLapSec(): number | null {
    return this.referenceBestSec
  }

  observedWholeLap(): boolean {
    return this.currentLapWholeLap
  }
}

// ─────────────────────────────────────────────────────────── plot geometry

export interface Rc11TracePoint {
  x: number
  y: number
}

/** A contiguous run of acquired samples. A dropout ENDS a run; runs are never bridged. */
export type Rc11TraceSegment = readonly Rc11TracePoint[]

/** A dropout span, in the same 0..100 plot units as the traces. Packet 14/15's DATA GAP band. */
export interface Rc11GapBand {
  id: string
  fromX: number
  toX: number
  channel: string
}

export interface Rc11Axis {
  top: number
  bottom: number
  /** The printed tick labels, top first. Never a distance value — see the omissions. */
  labels: readonly string[]
}

/** Packet-deterministic axes, reproduced from the approved frame's own scales. */
export const RC11_SPEED_AXIS: Rc11Axis = Object.freeze({ top: 300, bottom: 0, labels: Object.freeze(['300', '0']) })
export const RC11_INPUT_AXIS: Rc11Axis = Object.freeze({ top: 100, bottom: 0, labels: Object.freeze(['100', '0']) })
export const RC11_DELTA_AXIS: Rc11Axis = Object.freeze({
  top: 0.5,
  bottom: -0.5,
  labels: Object.freeze(['+0.5', '-0.5'])
})
/** The zero rule of the delta plot, in plot units measured from the top. */
export const RC11_DELTA_ZERO_PLOT_UNIT = 50

/** The gear axis floor. The TOP is data: it grows to whatever gear the lap actually used. */
export const RC11_GEAR_AXIS_MIN_TOP = 6
export const RC11_GEAR_AXIS_BOTTOM = 1

/**
 * The steering trace's full-scale lock, in degrees either side of centre. Packet 12.1 puts the
 * steering trace on the SHARED input axis, so the angle is mapped onto that axis's 0..100 rather
 * than given a second scale that the cursor could not read consistently.
 */
export const RC11_STEERING_FULL_SCALE_DEG = 180

export function rc11GearAxis(samples: readonly Rc11TraceSample[]): Rc11Axis {
  let top = RC11_GEAR_AXIS_MIN_TOP
  for (const sample of samples) {
    if (sample.gear !== null && sample.gear > top) top = Math.trunc(sample.gear)
  }
  return Object.freeze({
    top,
    bottom: RC11_GEAR_AXIS_BOTTOM,
    labels: Object.freeze([String(top), String(RC11_GEAR_AXIS_BOTTOM)])
  })
}

/** A value on an axis, as a 0..100 plot unit measured from the TOP of the plot. */
export function rc11PlotY(value: number, axis: Rc11Axis): number {
  const range = axis.top - axis.bottom
  if (!finite(value) || range === 0) return 0
  return round3(clamp(((axis.top - value) / range) * 100, 0, 100))
}

/** The x of a sample inside the shared acquisition window, in 0..100 plot units. */
export function rc11PlotX(index: number, count: number): number {
  if (!finite(index) || !finite(count) || count <= 1) return 0
  return round3(clamp((index / (count - 1)) * 100, 0, 100))
}

/**
 * Builds the drawable runs for one channel. A null sample ENDS the current run and no point is
 * emitted for it, so the renderer physically cannot draw a line across a dropout.
 */
export function rc11TraceSegments(
  samples: readonly Rc11TraceSample[],
  read: (sample: Rc11TraceSample) => number | null,
  axis: Rc11Axis
): readonly Rc11TraceSegment[] {
  const segments: Rc11TracePoint[][] = []
  let openIndex = -1
  for (let index = 0; index < samples.length; index += 1) {
    const value = read(samples[index])
    if (value === null || !finite(value)) {
      openIndex = -1
      continue
    }
    const point = { x: rc11PlotX(index, samples.length), y: rc11PlotY(value, axis) }
    if (openIndex < 0) {
      segments.push([point])
      openIndex = segments.length - 1
      continue
    }
    segments[openIndex].push(point)
  }
  return Object.freeze(segments.map((segment) => Object.freeze(segment)))
}

/**
 * The dropout spans of one channel, as explicit bands. Packet 14: a data-integrity issue greys the
 * affected span and states DATA GAP; it is never smoothed and never interpolated.
 */
export function rc11GapBands(
  samples: readonly Rc11TraceSample[],
  read: (sample: Rc11TraceSample) => number | null,
  channel: string
): readonly Rc11GapBand[] {
  const bands: Rc11GapBand[] = []
  let start = -1
  for (let index = 0; index < samples.length; index += 1) {
    const missing = read(samples[index]) === null
    if (missing && start < 0) start = index
    if (!missing && start >= 0) {
      bands.push({
        id: `${channel}:${start}-${index}`,
        fromX: rc11PlotX(start, samples.length),
        toX: rc11PlotX(index, samples.length),
        channel
      })
      start = -1
    }
  }
  if (start >= 0 && samples.length > 0) {
    bands.push({
      id: `${channel}:${start}-${samples.length - 1}`,
      fromX: rc11PlotX(start, samples.length),
      toX: rc11PlotX(samples.length - 1, samples.length),
      channel
    })
  }
  return Object.freeze(bands)
}

/** Packet 14's band label, printed beside the grey span so the state is not carried by tint alone. */
export const RC11_DATA_GAP_LABEL = 'DATA GAP'

// ─────────────────────────────────────────────────────────── G-G scatter

/**
 * Normative override 4. Both G-G axes carry IDENTICAL units per g, the guide rings are true circles
 * and the g scale is labelled. The approved render is ~7 % anisotropic (cloud aspect 1.069) and
 * carries no numerals on the plot; that anisotropy is a defect and is not reproduced.
 */
export const RC11_GG_FULL_SCALE_G = 2
export const RC11_GG_RING_G: readonly number[] = Object.freeze([1, 2])

export interface Rc11GgPoint {
  /** 0..100 across the square plot; 50/50 is zero g on both axes. */
  x: number
  y: number
  lat: number
  long: number
}

/**
 * Packet 16: a sample is drawn only when BOTH IMU axes report. An invalid IMU HIDES the sample —
 * it is never plotted on one axis with the other assumed to be zero.
 */
export function rc11GgPoints(samples: readonly Rc11TraceSample[]): readonly Rc11GgPoint[] {
  const points: Rc11GgPoint[] = []
  for (const sample of samples) {
    if (sample.latG === null || sample.longG === null) continue
    if (!finite(sample.latG) || !finite(sample.longG)) continue
    points.push({
      x: round3(clamp(50 + (sample.latG / RC11_GG_FULL_SCALE_G) * 50, 0, 100)),
      y: round3(clamp(50 - (sample.longG / RC11_GG_FULL_SCALE_G) * 50, 0, 100)),
      lat: round3(sample.latG),
      long: round3(sample.longG)
    })
  }
  return Object.freeze(points)
}

export interface Rc11GgRing {
  g: number
  /** The ring's diameter as a percentage of the square plot. Equal on both axes, so a true circle. */
  diameterPct: number
  label: string
}

export function rc11GgRings(): readonly Rc11GgRing[] {
  return Object.freeze(
    RC11_GG_RING_G.map((g) =>
      Object.freeze({
        g,
        diameterPct: round3((g / RC11_GG_FULL_SCALE_G) * 100),
        label: `${g.toFixed(1)} G`
      })
    )
  )
}

// ─────────────────────────────────────────────────────────── distance axis

export interface Rc11DistanceTick {
  index: number
  /** The tick's position across the SHARED plot span, in 0..100 plot units. */
  x: number
  /** Always the dash placeholder: section 16 defines no lap-distance channel. */
  label: string
  unavailable: boolean
}

/**
 * Five ticks, matching the approved frame. The tick POSITIONS are axis decoration; their VALUES are
 * data, and there is no data — so every label is the dash placeholder and no distance numeral, lap
 * number or sector number is ever printed. See `RC11_PACKET_OMISSIONS.lapDistanceChannel`.
 */
export const RC11_DISTANCE_TICK_COUNT = 5

export function rc11DistanceTicks(): readonly Rc11DistanceTick[] {
  return Object.freeze(
    Array.from({ length: RC11_DISTANCE_TICK_COUNT }, (_unused, index) =>
      Object.freeze({
        index,
        x: round3(((index + 0.5) / RC11_DISTANCE_TICK_COUNT) * 100),
        label: RC11_DASH.distance,
        unavailable: true
      })
    )
  )
}

// ─────────────────────────────────────────────────────────── mini-sector table

export interface Rc11SectorRow {
  id: string
  label: string
  value: string
  unavailable: boolean
}

/**
 * Packet 12.1's app-only corner-by-corner time-loss table. A mini-sector needs a lap-distance or
 * sector channel to bound it, and section 16 defines neither, so the table publishes NO ROWS: a row
 * count would itself be an invented number, and the brief forbids any sector numeral appearing
 * until the channel exists. The module is present — 12.1 declares its zone — and states its own
 * unavailability in words.
 */
export const RC11_SECTOR_UNAVAILABLE_NOTICE = 'NO SECTOR SOURCE'

export function rc11SectorRows(): readonly Rc11SectorRow[] {
  return Object.freeze([])
}

// ─────────────────────────────────────────────────────────── alerts

export type Rc11AlertId = 'lockUp' | 'liftCoast' | 'dataGap'

export interface Rc11Marker {
  id: string
  alert: Rc11AlertId
  /** The trace the marker annotates. */
  channel: 'brake' | 'throttle'
  /** Position across the SHARED plot span, in 0..100 plot units. */
  x: number
  /** Packet 19: a glyph shape AND a text label, never colour alone. */
  glyph: 'diamond' | 'chevron'
  label: string
  token: Rc11Token
}

export const RC11_ALERT_LABELS = Object.freeze({
  lockUp: 'LOCK UP',
  liftCoast: 'LIFT',
  dataGap: RC11_DATA_GAP_LABEL
})

/**
 * Packet 15's lift/coast trigger: the throttle dips versus the reference in a NON-BRAKING zone. The
 * debounce is a minimum run of consecutive qualifying samples, and the hysteresis is a lower exit
 * threshold so a trace that hovers on the trigger cannot chatter markers into existence.
 */
export const RC11_LIFT_COAST_ENTER_PCT = 12
export const RC11_LIFT_COAST_EXIT_PCT = 6
export const RC11_LIFT_COAST_MIN_SAMPLES = 3
/** A "non-braking zone" is a genuinely released brake pedal, not merely light braking. */
export const RC11_LIFT_COAST_MAX_BRAKE_PCT = 2

export interface Rc11AlertState {
  lockUp: { markers: readonly Rc11Marker[] }
  liftCoast: { markers: readonly Rc11Marker[] }
  dataGap: { bands: readonly Rc11GapBand[] }
  /** Packet 15's clear condition for both computed markers: dismissed by the engineer. */
  dismissed: readonly string[]
}

export interface Rc11AlertInput {
  nowMs: number
  samples: readonly Rc11TraceSample[]
  reference: readonly Rc11TraceSample[]
  throttleAvailable: boolean
  brakeAvailable: boolean
  wheelSpeedAvailable: boolean
}

export function createRc11AlertState(): Rc11AlertState {
  return {
    lockUp: { markers: Object.freeze([]) },
    liftCoast: { markers: Object.freeze([]) },
    dataGap: { bands: Object.freeze([]) },
    dismissed: Object.freeze([])
  }
}

/**
 * Packet 15's lock-up flag. It needs a per-corner wheel-speed pattern; section 16 defines no such
 * channel and the app carries none, so the trigger can never fire and the list is always empty.
 * This is the packet's own "no marker if wheel-speed channel missing", implemented as arithmetic.
 */
export function rc11LockUpMarkers(input: Rc11AlertInput): readonly Rc11Marker[] {
  if (!input.wheelSpeedAvailable) return Object.freeze([])
  return Object.freeze([])
}

/**
 * Packet 15's lift/coast flag, computed offline against the reference lap. Silent unless BOTH the
 * throttle channel and a genuine reference lap exist: with no reference there is nothing to dip
 * against, and with no throttle the packet forbids a marker outright.
 */
export function rc11LiftCoastMarkers(input: Rc11AlertInput): readonly Rc11Marker[] {
  if (!input.throttleAvailable) return Object.freeze([])
  const samples = input.samples
  const reference = input.reference
  if (samples.length < RC11_LIFT_COAST_MIN_SAMPLES || reference.length < 2) return Object.freeze([])

  const markers: Rc11Marker[] = []
  let runStart = -1
  const closeRun = (endIndex: number): void => {
    if (runStart < 0) return
    if (endIndex - runStart >= RC11_LIFT_COAST_MIN_SAMPLES) {
      const midpoint = Math.floor((runStart + endIndex - 1) / 2)
      markers.push({
        id: `liftCoast:${runStart}-${endIndex - 1}`,
        alert: 'liftCoast',
        channel: 'throttle',
        x: rc11PlotX(midpoint, samples.length),
        glyph: 'chevron',
        label: RC11_ALERT_LABELS.liftCoast,
        token: 'caution'
      })
    }
    runStart = -1
  }

  const lastIndex = Math.max(1, samples.length - 1)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]
    const referenceIndex = Math.min(
      reference.length - 1,
      Math.round((index / lastIndex) * (reference.length - 1))
    )
    const current = sample.throttlePct
    const target = reference[referenceIndex]?.throttlePct ?? null
    const brake = sample.brakePct
    if (current === null || target === null || brake === null || brake > RC11_LIFT_COAST_MAX_BRAKE_PCT) {
      closeRun(index)
      continue
    }
    const dip = target - current
    if (runStart < 0) {
      if (dip >= RC11_LIFT_COAST_ENTER_PCT) runStart = index
      continue
    }
    if (dip < RC11_LIFT_COAST_EXIT_PCT) closeRun(index)
  }
  closeRun(samples.length)

  return Object.freeze(markers)
}

/**
 * Every alert is silent until its own trigger fires, carries the packet section 15 debounce and
 * hysteresis, has an explicit clear condition — dismissal by the engineer for both computed
 * markers, valid data resuming for the gap band — and is unlatched the moment its input goes
 * missing. No element of the alert layer is ever an always-on decoration.
 */
export function advanceRc11Alerts(state: Rc11AlertState, input: Rc11AlertInput): Rc11AlertState {
  const dismissed = new Set(state.dismissed)
  const keep = (marker: Rc11Marker): boolean => !dismissed.has(marker.id)

  const lockUp = rc11LockUpMarkers(input).filter(keep)
  const liftCoast = rc11LiftCoastMarkers(input).filter(keep)

  // The DATA GAP band is derived from the acquired samples every frame, so it clears itself the
  // moment valid data resumes. It is not dismissible: a data-integrity defect is not an opinion.
  const bands = input.brakeAvailable || input.throttleAvailable
    ? [
        ...rc11GapBands(input.samples, (sample) => sample.throttlePct, 'throttle'),
        ...rc11GapBands(input.samples, (sample) => sample.brakePct, 'brake'),
        ...rc11GapBands(input.samples, (sample) => sample.speedKmh, 'speed')
      ]
    : rc11GapBands(input.samples, (sample) => sample.speedKmh, 'speed')

  return {
    lockUp: { markers: Object.freeze(lockUp) },
    liftCoast: { markers: Object.freeze(liftCoast) },
    dataGap: { bands: Object.freeze(bands) },
    dismissed: Object.freeze([...dismissed])
  }
}

/** Packet 15: the engineer accepts or dismisses each computed marker; dismissal is the clear. */
export function dismissRc11Marker(state: Rc11AlertState, markerId: string): Rc11AlertState {
  if (state.dismissed.includes(markerId)) return state
  return {
    lockUp: { markers: Object.freeze(state.lockUp.markers.filter((marker) => marker.id !== markerId)) },
    liftCoast: { markers: Object.freeze(state.liftCoast.markers.filter((marker) => marker.id !== markerId)) },
    dataGap: state.dataGap,
    dismissed: Object.freeze([...state.dismissed, markerId])
  }
}

/** A stale, missing or refused input can never leave a marker latched on its trace. */
export function clearInvalidRc11Alerts(state: Rc11AlertState, model: Rc11DashboardModel): Rc11AlertState {
  const throttleDown = model.throttle.unavailable || model.throttle.stale
  const brakeDown = model.brake.unavailable || model.brake.stale
  return {
    lockUp: { markers: brakeDown ? Object.freeze([]) : state.lockUp.markers },
    liftCoast: { markers: throttleDown ? Object.freeze([]) : state.liftCoast.markers },
    dataGap: state.dataGap,
    dismissed: state.dismissed
  }
}

export function rc11AlertMarkers(state: Rc11AlertState): readonly Rc11Marker[] {
  return Object.freeze([...state.lockUp.markers, ...state.liftCoast.markers])
}

// ─────────────────────────────────────────────────────────── dashboard model

export type Rc11SeriesId =
  | 'speedCurrent'
  | 'speedReference'
  | 'throttle'
  | 'brake'
  | 'steering'
  | 'gear'
  | 'delta'

export interface Rc11Series {
  id: Rc11SeriesId
  label: string
  token: Rc11Token
  /** Packet 19: the pair is separable by LINE PATTERN before colour. */
  style: 'solid' | 'dashed'
  channel: Rc11AuxChannel | 'delta'
  available: boolean
  stale: boolean
  /** Packet 16: a lost input flatlines grey rather than disappearing or freezing. */
  flatline: boolean
  /** The gear staircase is stepped; every other trace is interpolated between adjacent samples. */
  stepped: boolean
  segments: readonly Rc11TraceSegment[]
}

export interface Rc11Plot {
  id: Rc11PlotId
  label: string
  unit: string
  axis: Rc11Axis
  /** Plot units from the top, or null when the plot has no signed zero. */
  zeroRuleAt: number | null
  series: readonly Rc11Series[]
  gaps: readonly Rc11GapBand[]
  markers: readonly Rc11Marker[]
  /** Packet 11.3: the delta shading between the two speed traces, at ~18 % `info`. */
  shading: boolean
}

export interface Rc11Tile {
  id: 'tyreFl' | 'tyreFr' | 'brakeTempF'
  label: string
  unit: string
  value: Rc01Field
}

export interface Rc11Cursor {
  /** Engineer-placed UI state, expressed as a fraction of the ONE shared plot width. */
  fraction: number
  /** Plot units, identical in all four distance-domain panels. */
  x: number
  speed: Rc01Field
  delta: Rc01Field
  gear: Rc01Field
}

export interface Rc11ReferenceState {
  /** The engineer's reference-lap toggle. Packet 11.5. */
  enabled: boolean
  /** True only when a lap was genuinely observed whole AND became the stored best. */
  recorded: boolean
  bestLapSec: number | null
}

export interface Rc11AlertFlags {
  lockUp: boolean
  liftCoast: boolean
  dataGap: boolean
}

export interface Rc11DashboardModel {
  speed: Rc01Field
  throttle: Rc01Field
  brake: Rc01Field
  steering: Rc01Field
  gear: Rc01Field
  delta: Rc01Field
  latG: Rc01Field
  longG: Rc01Field
  tiles: readonly Rc11Tile[]
  plots: readonly Rc11Plot[]
  ggPoints: readonly Rc11GgPoint[]
  ggRings: readonly Rc11GgRing[]
  ggAvailable: boolean
  cursor: Rc11Cursor
  distanceTicks: readonly Rc11DistanceTick[]
  sectorRows: readonly Rc11SectorRow[]
  sectorsAvailable: boolean
  reference: Rc11ReferenceState
  alerts: Rc11AlertFlags
  markers: readonly Rc11Marker[]
  gapBands: readonly Rc11GapBand[]
  sampleCount: number
  auxFresh: Readonly<Record<Rc11AuxChannel, boolean>>
  criticalFresh: Readonly<Record<Rc01ChannelName, boolean>>
}

export interface Rc11ModelOptions {
  alerts?: Rc11AlertState
  samples?: readonly Rc11TraceSample[]
  reference?: readonly Rc11TraceSample[]
  referenceBestLapSec?: number | null
  referenceEnabled?: boolean
  cursorFraction?: number
  /** Packet 12.1's steering reveal. App grammar only; 11.1 defines no 800x480 zone for it. */
  includeSteering?: boolean
}

function tile(id: Rc11Tile['id'], label: string, unit: string, value: Rc01Field): Rc11Tile {
  return { id, label, unit, value }
}

function seriesFor(
  id: Rc11SeriesId,
  label: string,
  token: Rc11Token,
  style: Rc11Series['style'],
  channel: Rc11Series['channel'],
  available: boolean,
  stale: boolean,
  stepped: boolean,
  segments: readonly Rc11TraceSegment[]
): Rc11Series {
  return {
    id,
    label,
    token,
    style,
    channel,
    available,
    stale,
    flatline: !available,
    stepped,
    segments
  }
}

/**
 * Projects the shared RC-01 telemetry model plus the acquired trace window into RC-11's analysis
 * wall. Nothing is invented, estimated or mirrored: the speed never comes from RPM times a ratio,
 * the gear never from RPM or speed, the braking never from deceleration, the G never from speed and
 * radius, the steering never from yaw, no tyre corner is ever mirrored onto another, and the delta
 * never exists without a stored reference lap AND the reference toggle enabled.
 */
export function createRc11DashboardModel(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc01ChannelName, Rc01ChannelReceipt> = new Map(),
  auxReceipts: ReadonlyMap<Rc11AuxChannel, Rc01ChannelReceipt> = new Map(),
  nowMs = rc01MonotonicNow(),
  options: Rc11ModelOptions = {}
): Rc11DashboardModel {
  const base: Rc01DashboardModel = createRc01DashboardModel(snapshot, receipts, nowMs)
  const safeSnapshot = snapshot && snapshot.connected ? snapshot : null
  const samples = options.samples ?? []
  const referenceSamples = options.reference ?? []
  const referenceEnabled = options.referenceEnabled ?? true
  const alerts = options.alerts ?? createRc11AlertState()

  const readings = Object.fromEntries(
    (Object.keys(RC11_CHANNEL_STALE_MS) as Rc11AuxChannel[]).map((channel) => [
      channel,
      auxReading(safeSnapshot, auxReceipts, channel, nowMs)
    ])
  ) as Record<Rc11AuxChannel, Rc11Reading>

  const auxFresh = Object.fromEntries(
    (Object.keys(RC11_CHANNEL_STALE_MS) as Rc11AuxChannel[]).map((channel) => [
      channel,
      readings[channel].value !== null
    ])
  ) as Record<Rc11AuxChannel, boolean>

  // ── Speed: greys past its 100 ms cadence, collapses to '---' past the 500 ms budget.
  const speedReading = readings.speed
  const speedDashed = speedReading.value === null && speedReading.ageMs > RC11_SPEED_DASH_MS
  const speed =
    typeof speedReading.value === 'number'
      ? field(String(Math.round(speedReading.value)), speedReading.value, false, false, 'primary')
      : !speedDashed && typeof speedReading.lastKnown === 'number'
        ? field(String(Math.round(speedReading.lastKnown)), speedReading.lastKnown, true, false, 'muted')
        : field(RC11_DASH.speed, null, speedReading.stale, true, 'muted')

  const throttleReading = readings.throttle
  const throttle =
    typeof throttleReading.value === 'number'
      ? field(String(Math.round(throttleReading.value)), throttleReading.value, false, false, 'primary')
      : field(RC11_DASH.tyre, null, throttleReading.stale, true, 'muted')

  const brakeReading = readings.brake
  const brake =
    typeof brakeReading.value === 'number'
      ? field(String(Math.round(brakeReading.value)), brakeReading.value, false, false, 'primary')
      : field(RC11_DASH.tyre, null, brakeReading.stale, true, 'muted')

  const steeringReading = readings.steering
  const steering =
    typeof steeringReading.value === 'number'
      ? field(String(Math.round(steeringReading.value)), steeringReading.value, false, false, 'primary')
      : field(RC11_DASH.speed, null, steeringReading.stale, true, 'muted')

  const gearReading = readings.gear
  const gear =
    typeof gearReading.value === 'number'
      ? field(rc11DisplayGear(gearReading.value), gearReading.value, false, false, 'primary')
      : field(RC11_DASH.gear, null, gearReading.stale, true, 'muted')

  const latReading = readings.latG
  const latG =
    typeof latReading.value === 'number'
      ? field(latReading.value.toFixed(2), latReading.value, false, false, 'primary')
      : field(RC11_DASH.tyre, null, latReading.stale, true, 'muted')

  const longReading = readings.longG
  const longG =
    typeof longReading.value === 'number'
      ? field(longReading.value.toFixed(2), longReading.value, false, false, 'primary')
      : field(RC11_DASH.tyre, null, longReading.stale, true, 'muted')

  // ── Delta: the shared RC-01 channel already refuses to exist without a stored reference lap, and
  //    the reference TOGGLE gates it a second time. Packet 11.5: with the reference off there is
  //    nothing to be a delta against, so it reads '--.---' rather than a delta against nothing.
  const deltaUsable =
    referenceEnabled && !base.delta.unavailable && !base.delta.stale && typeof base.delta.raw === 'number'
  const deltaSec = deltaUsable ? (base.delta.raw as number) : null
  const delta = deltaUsable
    ? field(rc11FormatDelta(deltaSec), deltaSec, false, false, 'primary')
    : field(RC11_DASH.delta, null, base.delta.stale, !referenceEnabled || base.delta.unavailable, 'muted')

  const tyreFlReading = readings.tyreFl
  const tyreFl =
    typeof tyreFlReading.value === 'number'
      ? field(rc11FormatTemperature(tyreFlReading.value), tyreFlReading.value, false, false, 'primary')
      : field(RC11_DASH.tyre, null, tyreFlReading.stale, true, 'muted')

  const tyreFrReading = readings.tyreFr
  const tyreFr =
    typeof tyreFrReading.value === 'number'
      ? field(rc11FormatTemperature(tyreFrReading.value), tyreFrReading.value, false, false, 'primary')
      : field(RC11_DASH.tyre, null, tyreFrReading.stale, true, 'muted')

  const brakeTempReading = readings.brakeTempF
  const brakeTempF =
    typeof brakeTempReading.value === 'number'
      ? field(rc11FormatTemperature(brakeTempReading.value), brakeTempReading.value, false, false, 'primary')
      : field(RC11_DASH.brakeTemp, null, brakeTempReading.stale, true, 'muted')

  const referenceRecorded = referenceSamples.length >= 2
  const referenceVisible = referenceEnabled && referenceRecorded

  const gearAxis = rc11GearAxis(samples)
  const markers = rc11AlertMarkers(alerts)
  const gapBands = alerts.dataGap.bands

  const speedPlot: Rc11Plot = {
    id: 'speed',
    label: 'SPEED',
    unit: 'KM/H',
    axis: RC11_SPEED_AXIS,
    zeroRuleAt: null,
    series: Object.freeze([
      seriesFor(
        'speedCurrent',
        'CURRENT',
        RC11_LAP_TOKENS.current,
        'solid',
        'speed',
        !speed.unavailable,
        speed.stale,
        false,
        rc11TraceSegments(samples, (sample) => sample.speedKmh, RC11_SPEED_AXIS)
      ),
      seriesFor(
        'speedReference',
        'REFERENCE',
        RC11_LAP_TOKENS.reference,
        'dashed',
        'speed',
        referenceVisible,
        false,
        false,
        referenceVisible
          ? rc11TraceSegments(referenceSamples, (sample) => sample.speedKmh, RC11_SPEED_AXIS)
          : Object.freeze([])
      )
    ]),
    gaps: Object.freeze(gapBands.filter((band) => band.channel === 'speed')),
    markers: Object.freeze([]),
    shading: referenceVisible
  }

  // The steering trace is a 1024x600 REVEAL. Packet 11.1 gives steering no 800x480 zone, so it is
  // appended to the inputs overlay only when the caller is on the app grammar — never scaled in.
  // See `RC11_PACKET_OMISSIONS.steeringAt800`.
  const includeSteering = options.includeSteering === true
  const inputSeries: Rc11Series[] = [
    seriesFor(
      'throttle',
      'THROTTLE',
      RC11_LAP_TOKENS.current,
      'solid',
      'throttle',
      !throttle.unavailable,
      throttle.stale,
      false,
      rc11TraceSegments(samples, (sample) => sample.throttlePct, RC11_INPUT_AXIS)
    ),
    seriesFor(
      'brake',
      'BRAKE',
      'primary',
      'dashed',
      'brake',
      !brake.unavailable,
      brake.stale,
      false,
      rc11TraceSegments(samples, (sample) => sample.brakePct, RC11_INPUT_AXIS)
    )
  ]
  if (includeSteering) {
    inputSeries.push(
      seriesFor(
        'steering',
        'STEER',
        'secondary',
        'solid',
        'steering',
        !steering.unavailable,
        steering.stale,
        false,
        rc11TraceSegments(
          samples,
          (sample) =>
            sample.steeringDeg === null
              ? null
              : clamp(50 + (sample.steeringDeg / RC11_STEERING_FULL_SCALE_DEG) * 50, 0, 100),
          RC11_INPUT_AXIS
        )
      )
    )
  }

  const inputsPlot: Rc11Plot = {
    id: 'inputs',
    label: 'THROTTLE %  BRAKE %',
    unit: '%',
    axis: RC11_INPUT_AXIS,
    zeroRuleAt: null,
    series: Object.freeze(inputSeries),
    gaps: Object.freeze(gapBands.filter((band) => band.channel === 'throttle' || band.channel === 'brake')),
    markers: Object.freeze(markers),
    shading: false
  }

  const gearPlot: Rc11Plot = {
    id: 'gear',
    label: 'GEAR',
    unit: '',
    axis: gearAxis,
    zeroRuleAt: null,
    series: Object.freeze([
      seriesFor(
        'gear',
        'GEAR',
        RC11_LAP_TOKENS.current,
        'solid',
        'gear',
        !gear.unavailable,
        gear.stale,
        true,
        rc11TraceSegments(samples, (sample) => sample.gear, gearAxis)
      )
    ]),
    gaps: Object.freeze([]),
    markers: Object.freeze([]),
    shading: false
  }

  const deltaPlot: Rc11Plot = {
    id: 'delta',
    label: 'DELTA',
    unit: 'S',
    axis: RC11_DELTA_AXIS,
    zeroRuleAt: RC11_DELTA_ZERO_PLOT_UNIT,
    series: Object.freeze([
      // Packet 11.3, hard rule 1: the delta trace is `info` cyan along its WHOLE length, above and
      // below the zero rule. It is never traffic-light coloured — those are alert-layer tokens.
      seriesFor(
        'delta',
        'DELTA',
        RC11_LAP_TOKENS.current,
        'solid',
        'delta',
        !delta.unavailable,
        delta.stale,
        false,
        referenceEnabled
          ? rc11TraceSegments(samples, (sample) => sample.deltaSec, RC11_DELTA_AXIS)
          : Object.freeze([])
      )
    ]),
    gaps: Object.freeze([]),
    markers: Object.freeze([]),
    shading: false
  }

  const cursorFraction = finite(options.cursorFraction) ? clamp(options.cursorFraction, 0, 1) : 0.5
  const cursorIndex = samples.length > 0 ? Math.round(cursorFraction * (samples.length - 1)) : -1
  const cursorSample = cursorIndex >= 0 ? samples[cursorIndex] : null

  const cursorSpeed =
    cursorSample && cursorSample.speedKmh !== null && !speed.unavailable
      ? field(String(Math.round(cursorSample.speedKmh)), cursorSample.speedKmh, speed.stale, false, 'primary')
      : speed
  const cursorDelta =
    cursorSample && cursorSample.deltaSec !== null && deltaUsable
      ? field(rc11FormatDelta(cursorSample.deltaSec), cursorSample.deltaSec, false, false, 'primary')
      : delta
  const cursorGear =
    cursorSample && cursorSample.gear !== null && !gear.unavailable
      ? field(rc11DisplayGear(cursorSample.gear), cursorSample.gear, gear.stale, false, 'primary')
      : gear

  const ggPoints = rc11GgPoints(samples)

  return {
    speed,
    throttle,
    brake,
    steering,
    gear,
    delta,
    latG,
    longG,
    tiles: Object.freeze([
      tile('tyreFl', 'TYRE FL', 'C', tyreFl),
      tile('tyreFr', 'TYRE FR', 'C', tyreFr),
      tile('brakeTempF', 'BRAKE F', 'C', brakeTempF)
    ]),
    plots: Object.freeze([speedPlot, inputsPlot, gearPlot, deltaPlot]),
    ggPoints,
    ggRings: rc11GgRings(),
    ggAvailable: !latG.unavailable && !longG.unavailable,
    cursor: {
      fraction: round3(cursorFraction),
      x: round3(cursorFraction * 100),
      speed: cursorSpeed,
      delta: cursorDelta,
      gear: cursorGear
    },
    distanceTicks: rc11DistanceTicks(),
    sectorRows: rc11SectorRows(),
    sectorsAvailable: false,
    reference: {
      enabled: referenceEnabled,
      recorded: referenceRecorded,
      bestLapSec: options.referenceBestLapSec ?? null
    },
    alerts: {
      lockUp: alerts.lockUp.markers.length > 0,
      liftCoast: alerts.liftCoast.markers.length > 0,
      dataGap: gapBands.length > 0
    },
    markers,
    gapBands,
    sampleCount: samples.length,
    auxFresh,
    criticalFresh: base.criticalFresh
  }
}

/** The alert-layer inputs, all gated on freshness so a frozen frame can never engage anything. */
export function rc11AlertInputForModel(
  model: Rc11DashboardModel,
  nowMs: number,
  samples: readonly Rc11TraceSample[],
  reference: readonly Rc11TraceSample[]
): Rc11AlertInput {
  return {
    nowMs,
    samples,
    reference: model.reference.enabled ? reference : [],
    throttleAvailable: !model.throttle.unavailable && !model.throttle.stale,
    brakeAvailable: !model.brake.unavailable && !model.brake.stale,
    // `RC11_PACKET_OMISSIONS.perWheelSpeedChannel`: there is no per-wheel speed anywhere, so the
    // lock-up trigger is structurally unreachable rather than merely unlikely.
    wheelSpeedAvailable: rc11WheelSpeedKmh(null, 'lf') !== null
  }
}

// ─────────────────────────────────────────────────────────── accessible names

/** Accessible description for the cursor readout: the value AND its unit, never the hue. */
export function rc11CursorDescription(model: Rc11DashboardModel): string {
  const speed = model.cursor.speed.unavailable
    ? 'speed unavailable'
    : `speed ${model.cursor.speed.value} kilometres per hour`
  const delta = model.cursor.delta.unavailable
    ? 'delta unavailable, no reference lap'
    : `delta ${model.cursor.delta.value} seconds`
  const gear = model.cursor.gear.unavailable ? 'gear unavailable' : `gear ${model.cursor.gear.value}`
  return `Cursor at ${round1(model.cursor.fraction * 100)} percent of the shared distance axis, ${speed}, ${delta}, ${gear}`
}

/** Accessible description for a trace: the lap it belongs to and its LINE PATTERN, never the hue. */
export function rc11SeriesDescription(series: Rc11Series): string {
  if (!series.available) return `${series.label} unavailable, flatlined and greyed`
  return `${series.label}, ${series.style} line${series.stale ? ', stale' : ''}`
}

/** Accessible description for a window tile: the value, the unit and its availability, in words. */
export function rc11TileDescription(entry: Rc11Tile): string {
  if (entry.value.unavailable) return `${entry.label} unavailable, no sensor`
  return `${entry.label} ${entry.value.value} degrees Celsius${entry.value.stale ? ', stale' : ''}`
}

/**
 * The frame with every hue stripped out. Only line patterns, dash strings, glyph shapes, words and
 * counts survive. Packet 19: the current and reference laps must remain separable here.
 */
export function rc11PatternFingerprint(model: Rc11DashboardModel): string {
  return [
    `plots:${model.plots.map((plot) => `${plot.id}=${plot.series.map((series) => `${series.id}:${series.style}:${series.available ? 'live' : 'flat'}`).join('/')}`).join('|')}`,
    `cursor:${model.cursor.speed.value}/${model.cursor.delta.value}/${model.cursor.gear.value}`,
    `tiles:${model.tiles.map((entry) => `${entry.id}=${entry.value.value}`).join('|')}`,
    `distance:${model.distanceTicks.map((tick) => tick.label).join('')}`,
    `markers:${model.markers.map((marker) => `${marker.glyph}:${marker.label}`).join('+') || 'silent'}`,
    `gaps:${model.gapBands.length > 0 ? RC11_DATA_GAP_LABEL : 'none'}`
  ].join(' ')
}

export type { Rc01Field as Rc11Field }
