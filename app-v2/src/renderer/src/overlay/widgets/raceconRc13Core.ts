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
 * RC-13 "Hold Order — Safety-Car & Restart Procedure" core.
 *
 * A PROCEDURAL page for a neutralised race. It is not a racing dashboard: the whole point of the
 * artifact is that racing telemetry is muted until green, and the controlling variables are the
 * safety-car delta window, the queue gap and the restart state.
 *
 * The live-only ingest buffer, identity binding, mock/replay refusal, out-of-order and
 * same-timestamp guards, the shared channel receipts and the position / gap-ahead / delta-to-best
 * channels are reused verbatim from `raceconRc01Core`. That is telemetry-truth machinery, not RC-01
 * styling, and a fork would silently drift. RC-01's ALERT layer is deliberately not driven from
 * here: RC-01's over-rev, delta-cliff, zero-cross and pit-limiter debounces are race-pace alerts,
 * and packet section 7 is explicit that RC-13's alert philosophy is compliance-gated — "alerts fire
 * on delta-window violation and restart-imminent, not race thresholds".
 *
 * THE DEFINING PROBLEM OF THIS ARTIFACT. Packet sections 6, 7, 11.1, 11.5, 14, 15 and 17 all build
 * the dominant zone — 45.8 % of the canvas — around a safety-car delta WINDOW, and section 16
 * defines neither an SC delta channel nor an SC delta target. The approved attempt-002 brief records
 * both as no-channel and normative override N4 is explicit: "Render `--.-` with no marker until both
 * the SC delta value and target channels exist. Never mirror Delta to best." So the gauge renders
 * its full structure and its three arithmetic zones, publishes the dash, draws NO marker, and the
 * window-violation alert can never fire. Section 15's own unavailable rule — "never assume legal" —
 * is implemented as arithmetic rather than quoted as a comment.
 *
 * Ten packet contradictions are resolved by OMISSION or by an explicit normative override, and every
 * one is asserted by the suite through `RC13_PACKET_OMISSIONS`, so a later edit cannot quietly
 * reintroduce them.
 */

// ─────────────────────────────────────────────────────────── canvas + breakpoints

/** Packet section 11 native canvas, and the section 12.1 app reflow target. */
export const RC13_NATIVE_WIDTH_PX = 800
export const RC13_NATIVE_HEIGHT_PX = 480
export const RC13_NATIVE_TOLERANCE_PX = 1
export const RC13_APP_WIDTH_PX = 1024
export const RC13_APP_HEIGHT_PX = 600

export const RC13_PHONE_MIN_WIDTH_PX = 360
export const RC13_PHONE_MAX_WIDTH_PX = 480
export const RC13_PHONE_MIN_HEIGHT_PX = 650
export const RC13_LANDSCAPE_MIN_WIDTH_PX = 650
export const RC13_LANDSCAPE_MIN_HEIGHT_PX = 360
export const RC13_LANDSCAPE_MAX_HEIGHT_PX = 480

export type Rc13CompactMode = 'phone' | 'landscape' | 'standard'
export type Rc13Layout = 'native' | 'app' | 'compact'

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
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

// ─────────────────────────────────────────────────────────── packet omissions

/**
 * The packet requirements this build deliberately does NOT render, and the normative overrides it
 * applies where the packet contradicts itself. Each key is asserted by the suite: the omission is
 * part of the contract, not an oversight.
 *
 *  - `scDeltaChannel`        Sections 6, 7, 11.1, 11.5, 14, 15 and 17 organise RC-13 around an SC
 *                            delta value; section 16 defines no such channel and the app's snapshot
 *                            carries none. The gauge draws, the numeral dashes to `--.-`, and NO
 *                            marker is placed. RESOLUTION REQUESTED FROM THE PACKET OWNER: add an
 *                            `SC delta` row to section 16 (source, unit s, freshness, invalid
 *                            rendering, never-estimate rule) before any window numeral is printed.
 *  - `scWindowTargetChannel` The same zone needs the LEGAL WINDOW BOUNDS to say whether the delta is
 *                            over, in or under. Section 16 defines no target channel either, so the
 *                            three zones are drawn as arithmetic structure with no zone active, and
 *                            section 15's "never assume legal" is honoured by construction.
 *  - `restartZoneChannel`    Sections 11.1 and 12.1 put an "expected restart zone" in the restart
 *                            block; section 16 defines no track-position channel. The row renders
 *                            its label, the dash and `NO RESTART ZONE SOURCE`. No corner, marshalling
 *                            post or lap fraction is ever printed.
 *  - `queueTrainChannel`     Section 12.1's app-only reveal is a queue-train mini map of nearby cars;
 *                            section 16 defines no nearby-car, queue or car-count channel. The panel
 *                            renders with ZERO rows and `NO QUEUE SOURCE`: a row count would itself
 *                            be an invented number.
 *  - `shiftLedZone`          Section 16 lists a shift indicator and 11.4 / 13 describe muted-then-
 *                            re-armed LEDs, but 11.1 and 12.1 define no LED zone and the negative
 *                            prompt forbids an "attack-mode shift LED hero". No LED arc, bar or
 *                            numeral is drawn anywhere. The section 13 re-arm controller is modelled
 *                            as STATE only, and arms solely at a confirmed GREEN with a fresh RPM.
 *  - `tertiaryChannelsNoZone` Sections 10 and 16 list water temperature, per-corner tyre temperature
 *                            and fuel laps remaining as tertiary; 11.1 and 12.1 give them no zone.
 *                            They are omitted from the model entirely rather than having their
 *                            freshness derived from a proxy channel.
 *  - `windowViolationDebounce` Section 15 gives the window-violation alert BOTH a "> 1 s outside the
 *                            legal window" trigger AND an "engage 500 ms" debounce, which double-
 *                            counts. Resolved to the debounce column: engage after 500 ms of
 *                            continuous violation, clear after 1 000 ms of continuous compliance.
 *  - `overtakeThresholds`    Section 15's overtake reminder fires on a "speed/gap pattern" for which
 *                            the packet supplies no numbers at all. The enter gap, exit gap, minimum
 *                            closing amount and minimum speed are declared here as exported
 *                            constants so they are reviewable rather than buried in a predicate.
 *  - `cautionSignatureDelta` Section 11.3's `caution #FFC400` and `signature #FFD100` measure
 *                            dE00 4.40 and are not perceptually distinct. `signature` therefore
 *                            never carries alert meaning: alert state is carried by the WORD plus
 *                            the `caution` / `danger` tokens, and `signature` is bound only to
 *                            non-alert chrome.
 *  - `statusHeaderTypeFit`   Section 11.1 gives the header 50 px and 11.2 a ~40 px status word. A
 *                            40 px word at any usable line height plus a stacked label cannot fit
 *                            50 px, so the header label sits INLINE on the status word's own row.
 *  - `deltaBestNoZone`       Section 10 makes `Delta to best` PRIMARY telemetry, and 11.1 and 12.1
 *                            give it no zone of its own. Normative override N4 forbids putting it in
 *                            the SC-window gauge — that gauge is the safety-car delta and mirroring
 *                            the lap delta into it is the single failure the override exists to
 *                            prevent. It is therefore carried in the muted pace strip, which is
 *                            where race-pace telemetry belongs on a neutralised page.
 */
export const RC13_PACKET_OMISSIONS = Object.freeze({
  scDeltaChannel:
    'packet 6/7/11.1/11.5/14/15/17 build the dominant zone on an SC delta that section 16 never defines: the gauge draws, the numeral dashes to --.- and no marker is ever placed',
  scWindowTargetChannel:
    'packet 11.1/15 need legal-window bounds that section 16 never defines: the three zones are arithmetic structure with none active, so the display never assumes legal',
  restartZoneChannel:
    'packet 11.1/12.1 show an expected restart zone that section 16 never defines: the row renders its dash and NO RESTART ZONE SOURCE, and no track position is printed',
  queueTrainChannel:
    'packet 12.1 reveals a queue-train map of nearby cars that section 16 never defines: the panel renders zero rows and NO QUEUE SOURCE, and no car count is synthesised',
  shiftLedZone:
    'packet 16/11.4/13 describe a muted-then-re-armed shift LED that 11.1 and 12.1 give no zone: no LED arc is drawn and the re-arm controller is modelled as state that arms only at confirmed GREEN',
  tertiaryChannelsNoZone:
    'packet 10/16 list water temperature, per-corner tyre temperature and fuel laps remaining with no zone in 11.1 or 12.1: they are omitted from the model rather than proxied',
  windowViolationDebounce:
    'packet 15 gives the window-violation alert both a >1 s trigger and a 500 ms engage debounce: resolved to engage at 500 ms of violation and clear at 1000 ms of compliance',
  overtakeThresholds:
    'packet 15 names an overtake speed/gap pattern with no numbers: the enter gap, exit gap, minimum closing and minimum speed are declared as reviewable exported constants',
  cautionSignatureDelta:
    'packet 11.3 caution #FFC400 and signature #FFD100 measure dE00 4.40: signature never carries alert meaning and is bound only to non-alert chrome',
  statusHeaderTypeFit:
    'packet 11.1 gives the header 50 px while 11.2 asks for a ~40 px word: the header label sits inline on the status row instead of stacked above it',
  deltaBestNoZone:
    'packet 10 makes delta to best primary while 11.1 and 12.1 give it no zone: it is carried in the muted pace strip, never mirrored into the SC-window gauge'
})

/** Modules the wider canvas reveals, which must be absent at 800x480. Packet 12.1 expansion model. */
export const RC13_APP_ONLY_MODULES = Object.freeze(['queueTrain', 'restartSketch'] as const)

/** Packet 12.1 expansion model name. The width buys modules; it never scales the native grammar. */
export const RC13_EXPANSION_MODEL = 'queue-map-reveal'

// ─────────────────────────────────────────────────────────── tokens

/** Packet 11.3 tokens, verbatim. */
export const RC13_TOKENS = Object.freeze({
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

export type Rc13Token = keyof typeof RC13_TOKENS

/**
 * The three tokens that must measure ZERO pixels in a silent frame. Packet section 15 forbids any
 * alert-layer element being used as decoration; all three RC-13 alerts are silent by default and the
 * window gauge has no channel to activate a zone with, so `normal`, `caution` and `danger` may only
 * ever be bound inside a state-scoped rule.
 */
export const RC13_SILENT_TOKENS = Object.freeze(['normal', 'caution', 'danger'] as const)

/**
 * `RC13_PACKET_OMISSIONS.cautionSignatureDelta`, recorded as a measurement so the collision is
 * asserted rather than described. The approved image-QA report measures the pair at dE00 4.40, well
 * under any perceptual-distinctness floor, which is why `signature` carries no alert meaning.
 */
export const RC13_TOKEN_COLLISION = Object.freeze({
  pair: Object.freeze(['caution', 'signature'] as const),
  deltaE00: 4.4,
  perceptualFloor: 10
})

// ─────────────────────────────────────────────────────────── type ladder

/**
 * Normative override N5: "Set the five ranks as explicit type sizes (80, 64, 40, 32, 28 px at
 * 800x480) and assert at build time that no two adjacent ranks are equal and none is reversed."
 * These are packet 11.2's ranks, set ARITHMETICALLY and never measured off the approved render — the
 * approved derivative measures 146.2 / 137.5 / 40.3 / 29.2 / 25.0 px and that reading is not copied.
 *
 * Numeral hierarchy is procedure-driven: the SC delta window is the tallest glyph in the frame even
 * though it can never be fed, because the structure is what tells the driver what is being withheld.
 */
export const RC13_TYPE_SCALE_PX = Object.freeze({
  windowDelta: 80,
  queueGap: 64,
  scStatus: 40,
  restart: 32,
  pace: 28
})

/** The ranks in packet 11.2's declared order, largest first. The suite asserts strict descent. */
export const RC13_TYPE_RANKS = Object.freeze([
  'windowDelta',
  'queueGap',
  'scStatus',
  'restart',
  'pace'
] as const)

/** Packet 12.1's type step: 1024 / 800. The ladder GROWS with the canvas, it does not re-rank. */
export const RC13_APP_TYPE_SCALE = RC13_APP_WIDTH_PX / RC13_NATIVE_WIDTH_PX

/** One container-query width unit is one hundredth of the native canvas: 800 / 100 = 8 px. */
export const RC13_CQW_PX = RC13_NATIVE_WIDTH_PX / 100

/**
 * The px ladder expressed in the container units the stylesheet actually uses. Because the app canvas
 * is exactly 1.28x the native canvas, ONE cqw ladder satisfies both breakpoints: 80 px at 800 wide
 * and 102.4 px at 1024 wide are the same 10 cqw. The suite asserts that identity.
 */
export function rc13TypeScaleCqw(px: number): number {
  return round3(px / RC13_CQW_PX)
}

/** The physical size a rung renders at on a given canvas width, for the arithmetic assertions. */
export function rc13TypeScalePxForWidth(px: number, canvasWidthPx: number): number {
  return round3((rc13TypeScaleCqw(px) * canvasWidthPx) / 100)
}

// ─────────────────────────────────────────────────────────── zones

export interface Rc13RectPx {
  x: number
  y: number
  width: number
  height: number
}

export interface Rc13Rect {
  left: number
  top: number
  width: number
  height: number
}

export type Rc13ZoneId = 'status' | 'window' | 'queue' | 'restart' | 'pace'

export type Rc13ZoneMapPx = Readonly<Partial<Record<Rc13ZoneId, Rc13RectPx>>>
export type Rc13ZoneMap = Readonly<Partial<Record<Rc13ZoneId, Rc13Rect>>>

/**
 * Packet 11.1's zones for the 800x480 canvas, in the packet's own pixels. Normative override N2 is
 * explicit — "Build every zone from packet 11.1 / 12.1 coordinates. Never trace the image." The
 * approved image-QA report records the header block sitting 8 px below its packet zone floor (defect
 * R2); those pixels are not copied.
 */
export const RC13_NATIVE_ZONES_PX: Rc13ZoneMapPx = Object.freeze({
  status: Object.freeze({ x: 16, y: 12, width: 768, height: 50 }),
  window: Object.freeze({ x: 16, y: 74, width: 500, height: 220 }),
  queue: Object.freeze({ x: 528, y: 74, width: 256, height: 220 }),
  restart: Object.freeze({ x: 16, y: 306, width: 768, height: 90 }),
  pace: Object.freeze({ x: 16, y: 404, width: 768, height: 60 })
})

/**
 * Packet 12.1's `queue-map-reveal`. The extra width buys exactly two things — a queue-train mini map
 * inside the gap tile and a restart-zone sketch inside the restart block — and the top-to-bottom
 * compliance stack stays the spine. It is an EXPANSION, never a scale: the header alone goes
 * edge-to-edge at 0/0, 100 % x 9.3 %.
 */
export const RC13_APP_ZONES_PX: Rc13ZoneMapPx = Object.freeze({
  status: Object.freeze({ x: 0, y: 0, width: 1_024, height: 56 }),
  window: Object.freeze({ x: 24, y: 72, width: 600, height: 280 }),
  queue: Object.freeze({ x: 648, y: 72, width: 352, height: 280 }),
  restart: Object.freeze({ x: 24, y: 368, width: 976, height: 120 }),
  pace: Object.freeze({ x: 24, y: 500, width: 976, height: 72 })
})

/** The stack in reading order: hold the window, mind the gap, watch for the restart. */
export const RC13_ZONE_ORDER = Object.freeze(['status', 'window', 'queue', 'restart', 'pace'] as const)

function canvasSizePx(layout: Rc13Layout): { width: number; height: number } {
  return layout === 'app'
    ? { width: RC13_APP_WIDTH_PX, height: RC13_APP_HEIGHT_PX }
    : { width: RC13_NATIVE_WIDTH_PX, height: RC13_NATIVE_HEIGHT_PX }
}

export function rc13ZonesPxForLayout(layout: Rc13Layout): Rc13ZoneMapPx {
  return layout === 'app' ? RC13_APP_ZONES_PX : RC13_NATIVE_ZONES_PX
}

/** A packet pixel box as canvas percentages, which is what the DOM actually carries. */
export function rc13RectPercent(rect: Rc13RectPx, canvasWidth: number, canvasHeight: number): Rc13Rect {
  return {
    left: round6((rect.x / canvasWidth) * 100),
    top: round6((rect.y / canvasHeight) * 100),
    width: round6((rect.width / canvasWidth) * 100),
    height: round6((rect.height / canvasHeight) * 100)
  }
}

/**
 * The compact grammars are not packet-specified. They keep the procedure stack — header, window
 * gauge, queue gap, restart block, muted strip — and drop only the two app-only reveals, so every
 * alert and every truth-table dash keeps a visible surface at every size.
 */
function rc13CompactZonesPx(mode: Rc13CompactMode, width: number, height: number): Rc13ZoneMapPx {
  if (mode === 'phone') {
    return Object.freeze({
      status: Object.freeze({ x: 0.02 * width, y: 0.02 * height, width: 0.96 * width, height: 0.1 * height }),
      window: Object.freeze({ x: 0.02 * width, y: 0.14 * height, width: 0.96 * width, height: 0.32 * height }),
      queue: Object.freeze({ x: 0.02 * width, y: 0.48 * height, width: 0.96 * width, height: 0.2 * height }),
      restart: Object.freeze({ x: 0.02 * width, y: 0.7 * height, width: 0.96 * width, height: 0.16 * height }),
      pace: Object.freeze({ x: 0.02 * width, y: 0.88 * height, width: 0.96 * width, height: 0.1 * height })
    })
  }
  if (mode === 'landscape') {
    return Object.freeze({
      status: Object.freeze({ x: 0.02 * width, y: 0.03 * height, width: 0.96 * width, height: 0.13 * height }),
      window: Object.freeze({ x: 0.02 * width, y: 0.18 * height, width: 0.625 * width, height: 0.44 * height }),
      queue: Object.freeze({ x: 0.66 * width, y: 0.18 * height, width: 0.32 * width, height: 0.44 * height }),
      restart: Object.freeze({ x: 0.02 * width, y: 0.64 * height, width: 0.96 * width, height: 0.19 * height }),
      pace: Object.freeze({ x: 0.02 * width, y: 0.85 * height, width: 0.96 * width, height: 0.12 * height })
    })
  }
  return Object.freeze({
    status: Object.freeze({ x: 0.02 * width, y: 0.025 * height, width: 0.96 * width, height: 0.105 * height }),
    window: Object.freeze({ x: 0.02 * width, y: 0.155 * height, width: 0.625 * width, height: 0.455 * height }),
    queue: Object.freeze({ x: 0.66 * width, y: 0.155 * height, width: 0.32 * width, height: 0.455 * height }),
    restart: Object.freeze({ x: 0.02 * width, y: 0.635 * height, width: 0.96 * width, height: 0.19 * height }),
    pace: Object.freeze({ x: 0.02 * width, y: 0.845 * height, width: 0.96 * width, height: 0.125 * height })
  })
}

export function rc13ZonesForLayout(
  layout: Rc13Layout,
  compactMode: Rc13CompactMode = 'standard',
  box: { width: number; height: number } = canvasSizePx(layout)
): Rc13ZoneMap {
  const size = layout === 'compact' ? box : canvasSizePx(layout)
  const zonesPx =
    layout === 'compact' ? rc13CompactZonesPx(compactMode, size.width, size.height) : rc13ZonesPxForLayout(layout)
  const entries = (Object.keys(zonesPx) as Rc13ZoneId[]).map((id) => [
    id,
    Object.freeze(rc13RectPercent(zonesPx[id] as Rc13RectPx, size.width, size.height))
  ])
  return Object.freeze(Object.fromEntries(entries)) as Rc13ZoneMap
}

export function rc13RectsOverlap(a: Rc13Rect, b: Rc13Rect): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  )
}

/** A 0..100 coordinate as a CSS percentage, without binary-float noise in the DOM. */
export function rc13Percent(value: number): string {
  return `${round3(finite(value) ? value : 0)}%`
}

export function rc13ZoneStyle(rect: Rc13Rect | undefined): {
  left: string
  top: string
  width: string
  height: string
} | null {
  if (!rect) return null
  return {
    left: rc13Percent(rect.left),
    top: rc13Percent(rect.top),
    width: rc13Percent(rect.width),
    height: rc13Percent(rect.height)
  }
}

// ─────────────────────────────────────────────────────────── layout resolution

export function rc13LayoutForContentBox(width: number, height: number): Rc13Layout {
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return 'app'
  if (
    Math.abs(width - RC13_NATIVE_WIDTH_PX) <= RC13_NATIVE_TOLERANCE_PX &&
    Math.abs(height - RC13_NATIVE_HEIGHT_PX) <= RC13_NATIVE_TOLERANCE_PX
  ) {
    return 'native'
  }
  if (width >= RC13_APP_WIDTH_PX - 1 && height >= RC13_APP_HEIGHT_PX - 1) return 'app'
  return 'compact'
}

export function rc13CompactModeForContentBox(width: number, height: number): Rc13CompactMode {
  if (rc13LayoutForContentBox(width, height) !== 'compact') return 'standard'
  if (
    width >= RC13_PHONE_MIN_WIDTH_PX &&
    width <= RC13_PHONE_MAX_WIDTH_PX &&
    height >= RC13_PHONE_MIN_HEIGHT_PX &&
    height / width >= 1.5
  ) {
    return 'phone'
  }
  if (
    width >= RC13_LANDSCAPE_MIN_WIDTH_PX &&
    height >= RC13_LANDSCAPE_MIN_HEIGHT_PX &&
    height <= RC13_LANDSCAPE_MAX_HEIGHT_PX &&
    width / height >= 1.5
  ) {
    return 'landscape'
  }
  return 'standard'
}

export interface Rc13PhoneGeometry {
  inset: number
  headerHeight: number
  labelHeight: number
  barHeight: number
}

export function rc13PhoneGeometryForContentBox(width: number, height: number): Rc13PhoneGeometry | null {
  if (rc13CompactModeForContentBox(width, height) !== 'phone') return null
  return {
    inset: 8,
    headerHeight: Math.max(28, Math.round(height * 0.05)),
    labelHeight: Math.max(14, Math.round(height * 0.022)),
    barHeight: Math.max(26, Math.round(height * 0.05))
  }
}

// ─────────────────────────────────────────────────────────── window gauge geometry

export type Rc13WindowZoneId = 'over' | 'in' | 'under'

/**
 * Normative override N3: "Compute the three zones arithmetically at 0-34, 34-66 and 66-100 units of
 * the bar width, with word centres at 17, 50 and 83. Do not measure them from the image." The
 * approved render measures its dividers at 33.60 and 67.19 and its word centres at 16.74, 51.24 and
 * 84.05; those readings are recorded in `RC13_WINDOW_MEASURED` and are NOT copied.
 */
export const RC13_WINDOW_DIVIDER_UNIT = Object.freeze([34, 66] as const)
export const RC13_WINDOW_WORD_CENTRE_UNIT = Object.freeze([17, 50, 83] as const)

export const RC13_WINDOW_MEASURED = Object.freeze({
  dividerUnit: Object.freeze([33.6, 67.19] as const),
  wordCentreUnit: Object.freeze([16.74, 51.24, 84.05] as const)
})

/**
 * Packet 19: "Over/in/under window shown by bar zone + word (LIFT/CATCH UP), not color only." The
 * word is part of the MODEL, not of the stylesheet, so the guidance survives with zero colour
 * perception and the suite can assert it.
 */
export const RC13_WINDOW_ZONE_WORDS = Object.freeze({
  over: 'LIFT',
  in: 'IN WINDOW',
  under: 'CATCH UP'
})

export interface Rc13WindowZone {
  id: Rc13WindowZoneId
  /** Zone start and end across the bar, in 0..100 bar units. */
  from: number
  to: number
  /** Word centre across the bar, in 0..100 bar units. */
  centre: number
  word: string
  token: Rc13Token
}

/** The three zones, built from the override's arithmetic and never from a measurement. */
export function rc13WindowZones(): readonly Rc13WindowZone[] {
  const [first, second] = RC13_WINDOW_DIVIDER_UNIT
  const [overCentre, inCentre, underCentre] = RC13_WINDOW_WORD_CENTRE_UNIT
  return Object.freeze([
    Object.freeze({
      id: 'over' as const,
      from: 0,
      to: first,
      centre: overCentre,
      word: RC13_WINDOW_ZONE_WORDS.over,
      token: 'danger' as const
    }),
    Object.freeze({
      id: 'in' as const,
      from: first,
      to: second,
      centre: inCentre,
      word: RC13_WINDOW_ZONE_WORDS.in,
      token: 'normal' as const
    }),
    Object.freeze({
      id: 'under' as const,
      from: second,
      to: 100,
      centre: underCentre,
      word: RC13_WINDOW_ZONE_WORDS.under,
      token: 'caution' as const
    })
  ])
}

export interface Rc13WindowBounds {
  /** Lower legal bound in seconds relative to the safety-car target. */
  min: number
  /** Upper legal bound in seconds relative to the safety-car target. */
  max: number
}

/**
 * Which zone a safety-car delta falls in. Signed relative to the target: a NEGATIVE delta is running
 * faster than the safety-car pace and lands in the `over` (too-fast) zone, a POSITIVE delta is too
 * slow and lands in `under`. Returns null whenever either input is missing, so the caller physically
 * cannot render a zone it has no evidence for.
 */
export function rc13WindowZoneForDelta(
  deltaSec: number | null,
  bounds: Rc13WindowBounds | null
): Rc13WindowZoneId | null {
  if (!finite(deltaSec) || !bounds || !finite(bounds.min) || !finite(bounds.max) || bounds.max <= bounds.min) {
    return null
  }
  if (deltaSec < bounds.min) return 'over'
  if (deltaSec > bounds.max) return 'under'
  return 'in'
}

/**
 * Where the marker sits across the bar, in 0..100 bar units. The legal window occupies the middle
 * zone exactly, and one window-width of violation on either side fills the outer zones, so the
 * mapping is continuous and derived only from the declared bounds. Null in, null out — normative
 * override N4 forbids a marker without both channels.
 */
export function rc13WindowMarkerUnit(deltaSec: number | null, bounds: Rc13WindowBounds | null): number | null {
  const zone = rc13WindowZoneForDelta(deltaSec, bounds)
  if (zone === null || !finite(deltaSec) || !bounds) return null
  const [first, second] = RC13_WINDOW_DIVIDER_UNIT
  const span = bounds.max - bounds.min
  if (zone === 'in') {
    return round3(first + ((deltaSec - bounds.min) / span) * (second - first))
  }
  if (zone === 'over') {
    return round3(clamp(first - ((bounds.min - deltaSec) / span) * first, 0, first))
  }
  return round3(clamp(second + ((deltaSec - bounds.max) / span) * (100 - second), second, 100))
}

// ─────────────────────────────────────────────────────────── channels

/**
 * Packet section 16 freshness budgets for the channels the shared RC-01 layer does not already carry
 * with RC-13's own budget.
 *
 * `speed` is the packet's verbatim 100 ms — RC-01 carries speed at 500 ms, which is this packet's
 * DASH threshold, not its grey threshold, so RC-13 owns its own receipt. `rpm` is the packet's
 * verbatim 20 ms and exists ONLY to decide whether the section 13 re-arm controller may arm; no LED
 * is drawn. `restartState` and `trackFlag` are section 16's two event channels: an event still ages,
 * so each carries a budget past which it degrades visibly instead of freezing on its last value.
 *
 * `position`, `gapAhead`, `delta` and `bestLap` are NOT here: RC-01 already carries them at 1 000,
 * 1 000, 250 and 2 000 ms, which are section 16's own budgets, and re-declaring them would be the
 * fork this file exists to avoid.
 */
export const RC13_CHANNEL_STALE_MS = {
  restartState: 2_000,
  trackFlag: 2_000,
  speed: 100,
  rpm: 20
} as const

export type Rc13AuxChannel = keyof typeof RC13_CHANNEL_STALE_MS

/**
 * Packet 16: speed greys as soon as it misses its 100 ms cadence but only collapses to the
 * three-character dash once the source has been quiet for more than 500 ms.
 */
export const RC13_SPEED_DASH_MS = 500

/** Packet 16 dash states, verbatim, so the widget and the suite cannot drift from the table. */
export const RC13_DASH = Object.freeze({
  restart: 'UNKNOWN',
  flag: 'NO SIGNAL',
  scDelta: '--.-',
  deltaBest: '--.---',
  gapAhead: '--.-',
  position: '--',
  speed: '---',
  restartZone: '--'
})

/** The honest empty states for structures the packet demands but section 16 cannot feed. */
export const RC13_NO_WINDOW_SOURCE = 'NO SC WINDOW SOURCE'
export const RC13_NO_QUEUE_SOURCE = 'NO QUEUE SOURCE'
export const RC13_NO_RESTART_ZONE_SOURCE = 'NO RESTART ZONE SOURCE'

export type Rc13RestartState = 'unknown' | 'scDeployed' | 'restartImminent' | 'green'

export const RC13_RESTART_LABELS = Object.freeze({
  unknown: RC13_DASH.restart,
  scDeployed: 'SC DEPLOYED',
  restartImminent: 'RESTART IMMINENT',
  green: 'GREEN'
})

export type Rc13TrackFlag =
  | 'none'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'white'
  | 'red'
  | 'checkered'
  | 'black'
  | 'meatball'

export const RC13_FLAG_LABELS = Object.freeze({
  none: 'NONE',
  green: 'GREEN',
  yellow: 'YELLOW',
  blue: 'BLUE',
  white: 'WHITE',
  red: 'RED',
  checkered: 'CHECKERED',
  black: 'BLACK',
  meatball: 'MEATBALL'
})

/**
 * Packet 16 "Restart / SC status", source "Race-control restart state". The sim's pace mode IS the
 * race-control restart state: it reports the pacing formation the field is being held in and the
 * moment that becomes a restart. Nothing is inferred from lap counters, positions or speeds, and an
 * absent pace mode returns null so the header renders UNKNOWN — packet 20: "Restart status defaults
 * to UNKNOWN without a feed", packet 16: "Never assume restart timing".
 */
export function rc13RestartStateFromSnapshot(snapshot: TelemetrySnapshot | null): Rc13RestartState | null {
  const mode = snapshot?.paceMode
  if (mode === undefined) return null
  switch (mode) {
    case 'singleFileRestart':
    case 'doubleFileRestart':
      return 'restartImminent'
    case 'singleFileStart':
    case 'doubleFileStart':
      return 'scDeployed'
    case 'notPacing':
      return 'green'
  }
  return null
}

/**
 * Packet 16 "Track flag / race-control state". The flag comes from the marshalling feed alone. When
 * race control declares itself unknown, or publishes no flag object at all, the channel is ABSENT
 * and the strip reads NO SIGNAL — packet 16: "Never assume green when the flag feed is missing".
 */
export function rc13TrackFlagFromSnapshot(snapshot: TelemetrySnapshot | null): Rc13TrackFlag | null {
  if (!snapshot || snapshot.raceControlState === 'unknown') return null
  const flags = snapshot.flags
  if (!flags) return null
  if (flags.red) return 'red'
  if (flags.checkered) return 'checkered'
  if (flags.black) return 'black'
  if (flags.meatball) return 'meatball'
  if (flags.yellow) return 'yellow'
  if (flags.blue) return 'blue'
  if (flags.white) return 'white'
  if (flags.green) return 'green'
  return 'none'
}

/**
 * `RC13_PACKET_OMISSIONS.scDeltaChannel`, expressed as a function so the absence is MEASURED by the
 * suite rather than asserted about a comment. Section 16 defines no safety-car delta and the app's
 * snapshot carries none, so this returns null for every snapshot: the gauge dashes and no marker is
 * drawn. Normative override N4 forbids mirroring `Delta to best` into this slot, and nothing here
 * reads `deltaToBestSec`.
 */
export function rc13ScDeltaSec(_snapshot: TelemetrySnapshot | null): number | null {
  return null
}

/**
 * `RC13_PACKET_OMISSIONS.scWindowTargetChannel`, for the same reason. Without bounds there is no
 * legal window, so no zone can ever be active and the display can never assume legal.
 */
export function rc13ScWindowBoundsSec(_snapshot: TelemetrySnapshot | null): Rc13WindowBounds | null {
  return null
}

/**
 * `RC13_PACKET_OMISSIONS.restartZoneChannel`. Section 16 defines no track-position channel, so the
 * expected restart zone has no value and the row renders its dash and its no-source notice.
 */
export function rc13RestartZoneLabel(_snapshot: TelemetrySnapshot | null): string | null {
  return null
}

export interface Rc13TrainRow {
  id: string
  position: string
  gap: string
}

/**
 * `RC13_PACKET_OMISSIONS.queueTrainChannel`. Section 16 defines no nearby-car channel, so the
 * app-only queue-train map has ZERO rows. A fixed row count would itself be an invented number: the
 * packet supplies no car count, so none is drawn.
 */
export function rc13QueueTrainRows(_snapshot: TelemetrySnapshot | null): readonly Rc13TrainRow[] {
  return Object.freeze([])
}

/**
 * Packet 16 dash formats. Every one of these returns the packet's own placeholder for a missing
 * value: no formatter can ever emit a plausible number from nothing.
 */
export function rc13FormatScDelta(seconds: number | null): string {
  if (!finite(seconds)) return RC13_DASH.scDelta
  return `${seconds >= 0 ? '+' : '-'}${Math.abs(seconds).toFixed(1)}`
}

export function rc13FormatDeltaBest(seconds: number | null): string {
  if (!finite(seconds)) return RC13_DASH.deltaBest
  return `${seconds >= 0 ? '+' : '-'}${Math.abs(seconds).toFixed(3)}`
}

export function rc13FormatGapAhead(seconds: number | null): string {
  if (!finite(seconds)) return RC13_DASH.gapAhead
  return Math.abs(seconds).toFixed(1)
}

export function rc13FormatPosition(position: number | null): string {
  if (!finite(position) || !Number.isInteger(position) || position < 1) return RC13_DASH.position
  return String(Math.trunc(position))
}

export function rc13FormatSpeed(kmh: number | null): string {
  if (!finite(kmh) || kmh < 0) return RC13_DASH.speed
  return String(Math.round(kmh))
}

/**
 * Every RC-13 aux channel is read straight from its own declared source. Nothing is modelled,
 * mirrored or substituted: the restart state never from a lap counter, the flag never assumed green,
 * the speed never from RPM times a ratio, and the safety-car window never from the lap delta.
 */
export function rc13AuxChannelValue(
  snapshot: TelemetrySnapshot,
  channel: Rc13AuxChannel
): number | string | null {
  switch (channel) {
    case 'restartState':
      return rc13RestartStateFromSnapshot(snapshot)
    case 'trackFlag':
      return rc13TrackFlagFromSnapshot(snapshot)
    case 'speed':
      return finite(snapshot.speedKmh) && snapshot.speedKmh >= 0 ? snapshot.speedKmh : null
    case 'rpm':
      return finite(snapshot.rpm) && snapshot.rpm >= 0 ? snapshot.rpm : null
  }
  return null
}

// ─────────────────────────────────────────────────────────── receipts

/**
 * Receipts for RC-13's own channels, with exactly RC-01's semantics: a receipt is written only when
 * the channel actually reports, so a channel that falls silent ages out and degrades to its packet
 * state instead of freezing on its last value.
 */
export class Rc13AuxBuffer {
  private channelReceipts = new Map<Rc13AuxChannel, Rc01ChannelReceipt>()

  clone(): Rc13AuxBuffer {
    const next = new Rc13AuxBuffer()
    next.channelReceipts = new Map(this.channelReceipts)
    return next
  }

  reset(): void {
    this.channelReceipts = new Map()
  }

  ingest(snapshot: TelemetrySnapshot | null | undefined, receivedAt = rc01MonotonicNow()): void {
    if (!snapshot || !snapshot.connected || !finite(snapshot.timestamp)) return
    const safeReceiptAt = finite(receivedAt) && receivedAt >= 0 ? receivedAt : rc01MonotonicNow()
    for (const channel of Object.keys(RC13_CHANNEL_STALE_MS) as Rc13AuxChannel[]) {
      const value = rc13AuxChannelValue(snapshot, channel)
      if (value === null) continue
      this.channelReceipts.set(
        channel,
        Object.freeze({ value, snapshotTimestamp: snapshot.timestamp, receivedAt: safeReceiptAt })
      )
    }
  }

  receipts(): ReadonlyMap<Rc13AuxChannel, Rc01ChannelReceipt> {
    return new Map(this.channelReceipts)
  }
}

export function createRc13AuxReceipts(
  snapshot: TelemetrySnapshot,
  receivedAt = rc01MonotonicNow()
): ReadonlyMap<Rc13AuxChannel, Rc01ChannelReceipt> {
  const buffer = new Rc13AuxBuffer()
  buffer.ingest(snapshot, receivedAt)
  return buffer.receipts()
}

interface Rc13Reading {
  value: number | string | null
  lastKnown: number | string | null
  stale: boolean
  ageMs: number
}

function auxReading(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc13AuxChannel, Rc01ChannelReceipt>,
  channel: Rc13AuxChannel,
  nowMs: number
): Rc13Reading {
  const raw = snapshot ? rc13AuxChannelValue(snapshot, channel) : null
  const receipt = receipts.get(channel)
  if (raw === null || !receipt) {
    return { value: null, lastKnown: null, stale: false, ageMs: Number.POSITIVE_INFINITY }
  }
  const ageMs = rc01ReceiptAgeMs(receipt, nowMs)
  const stale = ageMs > RC13_CHANNEL_STALE_MS[channel]
  return {
    value: stale ? null : raw,
    lastKnown: typeof receipt.value === 'boolean' ? null : receipt.value,
    stale,
    ageMs
  }
}

// ─────────────────────────────────────────────────────────── queue observation

/**
 * One OBSERVED gap-ahead reading. The overtake reminder needs to know whether the queue gap is
 * CLOSING, and packet 16 forbids estimating the gap from closing speed alone — so the closing amount
 * is measured between two readings the timing feed genuinely published, never modelled from speed.
 */
export interface Rc13GapObservation {
  readonly gapSec: number
  readonly receivedAt: number
}

/** Three seconds of observations: long enough to see a close, short enough to stay current. */
export const RC13_GAP_HISTORY_MS = 3_000
export const RC13_GAP_HISTORY_LIMIT = 120

/**
 * The observed gap-ahead window. It records ONLY readings the timing feed published, drops readings
 * older than the history window, and is cleared outright whenever the ingest buffer refuses a source
 * — so a new session can never inherit the previous one's closing trend.
 */
export class Rc13QueueBuffer {
  private observations: Rc13GapObservation[] = []

  clone(): Rc13QueueBuffer {
    const next = new Rc13QueueBuffer()
    next.observations = this.observations.slice()
    return next
  }

  reset(): void {
    this.observations = []
  }

  ingest(snapshot: TelemetrySnapshot | null | undefined, receivedAt = rc01MonotonicNow()): void {
    if (!snapshot || !snapshot.connected || !finite(snapshot.timestamp)) return
    const gapSec = snapshot.relatives?.ahead?.gapSec
    if (!finite(gapSec)) return
    const safeReceiptAt = finite(receivedAt) && receivedAt >= 0 ? receivedAt : rc01MonotonicNow()
    const last = this.observations[this.observations.length - 1]
    if (last && safeReceiptAt < last.receivedAt) return
    this.observations.push(Object.freeze({ gapSec, receivedAt: safeReceiptAt }))
    this.observations = this.observations.filter(
      (entry) => safeReceiptAt - entry.receivedAt <= RC13_GAP_HISTORY_MS
    )
    if (this.observations.length > RC13_GAP_HISTORY_LIMIT) {
      this.observations = this.observations.slice(-RC13_GAP_HISTORY_LIMIT)
    }
  }

  history(): readonly Rc13GapObservation[] {
    return Object.freeze(this.observations.slice())
  }
}

/**
 * How much the queue gap has closed across the observed window, in seconds. Positive means closing.
 * It requires BOTH bounding observations to be real readings — a single reading is a gap, not a
 * trend, and returns null rather than a zero that would read as "not closing".
 */
export function rc13GapClosingSec(history: readonly Rc13GapObservation[]): number | null {
  if (history.length < 2) return null
  const first = history[0]
  const last = history[history.length - 1]
  if (!finite(first?.gapSec) || !finite(last?.gapSec)) return null
  if (last.receivedAt <= first.receivedAt) return null
  return round3(first.gapSec - last.gapSec)
}

// ─────────────────────────────────────────────────────────── trigger-only alerts

export type Rc13AlertId = 'windowViolation' | 'restartImminent' | 'overtakeReminder'

export const RC13_ALERT_LABELS = Object.freeze({
  windowViolation: 'WINDOW VIOLATION',
  restartImminent: 'RESTART IMMINENT',
  overtakeReminder: 'NO OVERTAKING'
})

/**
 * Packet 15 window violation. `RC13_PACKET_OMISSIONS.windowViolationDebounce` records the packet's
 * own contradiction; these two constants are the resolution and are asserted by the suite.
 */
export const RC13_WINDOW_VIOLATION_ENGAGE_MS = 500
export const RC13_WINDOW_VIOLATION_HYSTERESIS_MS = 1_000

/** Packet 15 restart imminent: an event with a 2 s minimum display so it cannot flash and vanish. */
export const RC13_RESTART_MIN_VISIBLE_MS = 2_000

/**
 * Packet 15 overtake reminder. `RC13_PACKET_OMISSIONS.overtakeThresholds` records that the packet
 * supplies no numbers; these are the declared ones. The reminder is about a car being CAUGHT under
 * caution, so it needs a small gap, a genuinely closing trend and a car actually moving.
 */
export const RC13_OVERTAKE_ENGAGE_MS = 400
export const RC13_OVERTAKE_GAP_ENTER_SEC = 0.4
export const RC13_OVERTAKE_GAP_EXIT_SEC = 0.8
export const RC13_OVERTAKE_MIN_CLOSING_SEC = 0.05
export const RC13_OVERTAKE_MIN_SPEED_KMH = 40

export interface Rc13AlertState {
  windowViolation: { active: boolean; pendingSinceMs: number | null; recoverySinceMs: number | null }
  restartImminent: { active: boolean; minimumVisibleUntilMs: number }
  overtakeReminder: { active: boolean; pendingSinceMs: number | null }
}

export interface Rc13AlertInput {
  nowMs: number
  /** Null whenever either the SC delta or the window bounds is missing: never assume legal. */
  windowZone: Rc13WindowZoneId | null
  /** The restart feed's state, or null when the feed is absent or stale. */
  restartState: Rc13RestartState | null
  /** Null whenever the timing feed is absent or stale: the reminder is hidden, not guessed. */
  gapAheadSec: number | null
  /** Null whenever the gap has not been observed twice: a single reading is not a trend. */
  gapClosingSec: number | null
  /** Null whenever the speed source is stale or absent. */
  speedKmh: number | null
  /** The race is neutralised: the reminder is about passing UNDER CAUTION, never at green. */
  neutralised: boolean
}

export function createRc13AlertState(): Rc13AlertState {
  return {
    windowViolation: { active: false, pendingSinceMs: null, recoverySinceMs: null },
    restartImminent: { active: false, minimumVisibleUntilMs: 0 },
    overtakeReminder: { active: false, pendingSinceMs: null }
  }
}

function cloneRc13AlertState(state: Rc13AlertState): Rc13AlertState {
  return {
    windowViolation: { ...state.windowViolation },
    restartImminent: { ...state.restartImminent },
    overtakeReminder: { ...state.overtakeReminder }
  }
}

/**
 * Packet 15's overtake pattern, as a predicate rather than a vibe: the car ahead is inside the enter
 * gap AND the gap has genuinely closed by at least the minimum amount across two observed readings
 * AND the car is moving AND the race is neutralised. Any missing input is false, never assumed.
 */
export function rc13OvertakePatternActive(input: Rc13AlertInput): boolean {
  if (!input.neutralised) return false
  if (!finite(input.gapAheadSec) || !finite(input.gapClosingSec) || !finite(input.speedKmh)) return false
  if (input.speedKmh < RC13_OVERTAKE_MIN_SPEED_KMH) return false
  if (input.gapClosingSec < RC13_OVERTAKE_MIN_CLOSING_SEC) return false
  return Math.abs(input.gapAheadSec) <= RC13_OVERTAKE_GAP_ENTER_SEC
}

/** The hysteresis release: the pattern has normalised once the gap opens past the exit threshold. */
export function rc13OvertakePatternNormalised(input: Rc13AlertInput): boolean {
  if (!input.neutralised) return true
  if (!finite(input.gapAheadSec)) return true
  if (Math.abs(input.gapAheadSec) >= RC13_OVERTAKE_GAP_EXIT_SEC) return true
  return finite(input.gapClosingSec) ? input.gapClosingSec < 0 : true
}

/**
 * Every alert is silent until its own trigger fires, carries the packet section 15 debounce and
 * hysteresis, has an explicit clear condition, and is unlatched the moment its input goes stale or
 * missing. No element of the alert layer is ever an always-on decoration.
 */
export function advanceRc13Alerts(state: Rc13AlertState, input: Rc13AlertInput): Rc13AlertState {
  const nowMs = finite(input.nowMs) ? input.nowMs : 0
  const next = cloneRc13AlertState(state)

  // ── Window violation. Trigger: the SC delta sits outside the legal window. Engage after 500 ms of
  // continuous violation; clear only after 1 000 ms of continuous compliance. A missing zone means a
  // missing SC delta or missing bounds, which UNLATCHES rather than holding: never assume legal.
  if (input.windowZone === null) {
    next.windowViolation = { active: false, pendingSinceMs: null, recoverySinceMs: null }
  } else if (input.windowZone === 'in') {
    if (next.windowViolation.active) {
      const recoverySinceMs = next.windowViolation.recoverySinceMs ?? nowMs
      next.windowViolation.recoverySinceMs = recoverySinceMs
      next.windowViolation.pendingSinceMs = null
      if (nowMs - recoverySinceMs >= RC13_WINDOW_VIOLATION_HYSTERESIS_MS) {
        next.windowViolation = { active: false, pendingSinceMs: null, recoverySinceMs: null }
      }
    } else {
      next.windowViolation = { active: false, pendingSinceMs: null, recoverySinceMs: null }
    }
  } else if (next.windowViolation.active) {
    next.windowViolation.recoverySinceMs = null
  } else {
    const pendingSinceMs = next.windowViolation.pendingSinceMs ?? nowMs
    next.windowViolation.pendingSinceMs = pendingSinceMs
    next.windowViolation.recoverySinceMs = null
    if (nowMs - pendingSinceMs >= RC13_WINDOW_VIOLATION_ENGAGE_MS) {
      next.windowViolation = { active: true, pendingSinceMs: null, recoverySinceMs: null }
    }
  }

  // ── Restart imminent. An EVENT, not a threshold: it engages the instant race control publishes the
  // restart state and holds for its 2 s minimum display. It clears on a confirmed GREEN or on the SC
  // being redeployed, and unlatches outright when the restart feed goes missing — an UNKNOWN restart
  // feed can never leave a RESTART IMMINENT banner latched on the header.
  if (input.restartState === null) {
    next.restartImminent = { active: false, minimumVisibleUntilMs: 0 }
  } else if (input.restartState === 'restartImminent') {
    next.restartImminent = {
      active: true,
      minimumVisibleUntilMs: next.restartImminent.active
        ? next.restartImminent.minimumVisibleUntilMs
        : nowMs + RC13_RESTART_MIN_VISIBLE_MS
    }
  } else if (next.restartImminent.active && nowMs < next.restartImminent.minimumVisibleUntilMs) {
    next.restartImminent.active = true
  } else {
    next.restartImminent = { active: false, minimumVisibleUntilMs: 0 }
  }

  // ── Overtake reminder. Engage after 400 ms of the pattern holding; clear when it normalises. With
  // no gap feed the pattern is never active AND never engaged, which is packet 15's "hidden if gap
  // feed absent" implemented as arithmetic.
  if (!finite(input.gapAheadSec)) {
    next.overtakeReminder = { active: false, pendingSinceMs: null }
  } else if (next.overtakeReminder.active) {
    if (rc13OvertakePatternNormalised(input)) {
      next.overtakeReminder = { active: false, pendingSinceMs: null }
    }
  } else if (rc13OvertakePatternActive(input)) {
    const pendingSinceMs = next.overtakeReminder.pendingSinceMs ?? nowMs
    next.overtakeReminder.pendingSinceMs = pendingSinceMs
    if (nowMs - pendingSinceMs >= RC13_OVERTAKE_ENGAGE_MS) {
      next.overtakeReminder = { active: true, pendingSinceMs: null }
    }
  } else {
    next.overtakeReminder = { active: false, pendingSinceMs: null }
  }

  return next
}

/**
 * A stale, missing or refused input can never leave an alert latched. This runs AFTER the model is
 * built, so it sees exactly what the driver sees rather than what the raw snapshot claimed.
 */
export function clearInvalidRc13Alerts(state: Rc13AlertState, model: Rc13DashboardModel): Rc13AlertState {
  const next = cloneRc13AlertState(state)
  if (model.scWindow.zone === null) {
    next.windowViolation = { active: false, pendingSinceMs: null, recoverySinceMs: null }
  }
  if (model.restart.unavailable || model.restart.stale) {
    next.restartImminent = { active: false, minimumVisibleUntilMs: 0 }
  }
  if (model.gapAhead.unavailable || model.gapAhead.stale) {
    next.overtakeReminder = { active: false, pendingSinceMs: null }
  }
  return next
}

export function rc13ActiveAlerts(state: Rc13AlertState): readonly Rc13AlertId[] {
  const active: Rc13AlertId[] = []
  if (state.windowViolation.active) active.push('windowViolation')
  if (state.restartImminent.active) active.push('restartImminent')
  if (state.overtakeReminder.active) active.push('overtakeReminder')
  return Object.freeze(active)
}

// ─────────────────────────────────────────────────────────── dashboard model

export interface Rc13RestartField extends Rc01Field {
  state: Rc13RestartState
}

export interface Rc13FlagField extends Rc01Field {
  flag: Rc13TrackFlag | null
}

export interface Rc13WindowModel {
  /** Always false: section 16 defines neither the SC delta nor its target. */
  available: boolean
  delta: Rc01Field
  bounds: Rc13WindowBounds | null
  /** Null forbids a marker outright — normative override N4. */
  markerUnit: number | null
  zone: Rc13WindowZoneId | null
  zones: readonly Rc13WindowZone[]
  notice: string
}

export interface Rc13RestartZoneModel {
  available: boolean
  value: string
  notice: string
}

export interface Rc13QueueTrainModel {
  available: boolean
  rows: readonly Rc13TrainRow[]
  notice: string
}

export interface Rc13AlertFlags {
  windowViolation: boolean
  restartImminent: boolean
  overtakeReminder: boolean
}

export interface Rc13DashboardModel {
  restart: Rc13RestartField
  flag: Rc13FlagField
  scWindow: Rc13WindowModel
  deltaBest: Rc01Field
  gapAhead: Rc01Field
  position: Rc01Field
  speed: Rc01Field
  restartZone: Rc13RestartZoneModel
  queueTrain: Rc13QueueTrainModel
  /** True unless race control has CONFIRMED green. An unknown feed stays neutralised. */
  neutralised: boolean
  /** Packet 10/19: racing telemetry is visibly de-emphasised while the race is neutralised. */
  muted: boolean
  /**
   * Packet 13's green-restart re-arm controller, modelled as state only — 11.1 and 12.1 give the
   * shift LEDs no zone, so nothing is drawn. Packet 20: "Re-arm shift LEDs only at confirmed GREEN".
   */
  shiftArmed: boolean
  alerts: Rc13AlertFlags
  /** Every alert that is currently engaged, for the DOM's alert-state attribute. */
  activeAlerts: readonly Rc13AlertId[]
}

export interface Rc13ModelOptions {
  alerts?: Rc13AlertState
  /** Observed gap history, used only to decide whether the queue is genuinely closing. */
  gapHistory?: readonly Rc13GapObservation[]
  /** True at the app breakpoint: packet 12.1's queue-train reveal is app-only. */
  includeQueueTrain?: boolean
}

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
 * Re-presents one of RC-01's already-truth-checked fields in RC-13's packet-16 format. The staleness,
 * the unavailability and the refusal all come from the shared layer; only the CHARACTERS are RC-13's.
 * A stale or unavailable field always collapses to the packet dash, never to a retained number that
 * would read as current under caution.
 */
function reformat(
  source: Rc01Field,
  dash: string,
  format: (raw: number) => string,
  tone: Rc01Field['tone'] = 'primary'
): Rc01Field {
  if (source.unavailable) return unavailableField(dash)
  if (source.stale || typeof source.raw !== 'number') return field(dash, null, true, false, 'muted')
  return field(format(source.raw), source.raw, false, false, tone)
}

/**
 * Packet 16 speed: grey as soon as it misses its 100 ms cadence, and collapse to the three-character
 * dash once the source has been quiet for more than 500 ms. Never estimated from RPM times a ratio.
 */
function speedField(reading: Rc13Reading): Rc01Field {
  if (reading.ageMs === Number.POSITIVE_INFINITY && reading.value === null && reading.lastKnown === null) {
    return unavailableField(RC13_DASH.speed)
  }
  if (!reading.stale && typeof reading.value === 'number') {
    return field(rc13FormatSpeed(reading.value), reading.value, false, false, 'primary')
  }
  if (reading.ageMs > RC13_SPEED_DASH_MS) return field(RC13_DASH.speed, null, true, false, 'muted')
  const lastKnown = typeof reading.lastKnown === 'number' ? reading.lastKnown : null
  return field(rc13FormatSpeed(lastKnown), lastKnown, true, false, 'muted')
}

export function createRc13DashboardModel(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc01ChannelName, Rc01ChannelReceipt> = new Map(),
  auxReceipts: ReadonlyMap<Rc13AuxChannel, Rc01ChannelReceipt> = new Map(),
  nowMs = rc01MonotonicNow(),
  options: Rc13ModelOptions = {}
): Rc13DashboardModel {
  const alerts = options.alerts ?? createRc13AlertState()
  const shared: Rc01DashboardModel = createRc01DashboardModel(snapshot, receipts, nowMs)

  const restartReading = auxReading(snapshot, auxReceipts, 'restartState', nowMs)
  const flagReading = auxReading(snapshot, auxReceipts, 'trackFlag', nowMs)
  const speedReading = auxReading(snapshot, auxReceipts, 'speed', nowMs)
  const rpmReading = auxReading(snapshot, auxReceipts, 'rpm', nowMs)

  // Packet 16 / 20: the restart status is UNKNOWN without a feed and UNKNOWN once the feed ages out.
  // It is never carried forward on its last value, because a stale "GREEN" is how a driver gets a
  // penalty for passing under caution.
  const restartState: Rc13RestartState =
    typeof restartReading.value === 'string' && !restartReading.stale
      ? (restartReading.value as Rc13RestartState)
      : 'unknown'
  const restartUnavailable = restartReading.value === null && !restartReading.stale
  const restart: Rc13RestartField = {
    ...(restartUnavailable
      ? unavailableField(RC13_RESTART_LABELS.unknown)
      : restartReading.stale
        ? field(RC13_RESTART_LABELS.unknown, null, true, false, 'muted')
        : field(
            RC13_RESTART_LABELS[restartState],
            restartState,
            false,
            false,
            restartState === 'green' ? 'good' : 'primary'
          )),
    state: restartState
  }

  // Packet 16: never assume green when the flag feed is missing; show the neutral no-signal state.
  const flagValue: Rc13TrackFlag | null =
    typeof flagReading.value === 'string' && !flagReading.stale ? (flagReading.value as Rc13TrackFlag) : null
  const flagUnavailable = flagReading.value === null && !flagReading.stale
  const flag: Rc13FlagField = {
    ...(flagUnavailable
      ? unavailableField(RC13_DASH.flag)
      : flagReading.stale || flagValue === null
        ? field(RC13_DASH.flag, null, true, false, 'muted')
        : field(RC13_FLAG_LABELS[flagValue], flagValue, false, false, 'primary')),
    flag: flagValue
  }

  // Normative override N4. Both inputs are structurally absent, so the delta dashes, the marker is
  // null and no zone is active. Nothing here reads the lap delta.
  const scDeltaSec = rc13ScDeltaSec(snapshot)
  const bounds = rc13ScWindowBoundsSec(snapshot)
  const zone = rc13WindowZoneForDelta(scDeltaSec, bounds)
  const scWindow: Rc13WindowModel = {
    available: scDeltaSec !== null && bounds !== null,
    delta:
      scDeltaSec === null
        ? unavailableField(RC13_DASH.scDelta)
        : field(rc13FormatScDelta(scDeltaSec), scDeltaSec, false, false, 'primary'),
    bounds,
    markerUnit: rc13WindowMarkerUnit(scDeltaSec, bounds),
    zone,
    zones: rc13WindowZones(),
    notice: RC13_NO_WINDOW_SOURCE
  }

  const deltaBest = reformat(shared.delta, RC13_DASH.deltaBest, rc13FormatDeltaBest)
  const gapAhead = reformat(shared.gapAhead, RC13_DASH.gapAhead, rc13FormatGapAhead)
  const position = reformat(shared.position, RC13_DASH.position, rc13FormatPosition)
  const speed = speedField(speedReading)

  const restartZoneLabel = rc13RestartZoneLabel(snapshot)
  const restartZone: Rc13RestartZoneModel = {
    available: restartZoneLabel !== null,
    value: restartZoneLabel ?? RC13_DASH.restartZone,
    notice: RC13_NO_RESTART_ZONE_SOURCE
  }

  const trainRows = options.includeQueueTrain ? rc13QueueTrainRows(snapshot) : Object.freeze([])
  const queueTrain: Rc13QueueTrainModel = {
    available: trainRows.length > 0,
    rows: trainRows,
    notice: RC13_NO_QUEUE_SOURCE
  }

  // Packet 19/20: never assume green. Only a CONFIRMED green un-neutralises the page, so an unknown
  // or stale restart feed keeps the racing telemetry muted rather than quietly releasing it.
  const neutralised = restartState !== 'green'
  const rpmFresh = !rpmReading.stale && typeof rpmReading.value === 'number'
  const shiftArmed = restartState === 'green' && rpmFresh && finite(snapshot?.maxRpm) && snapshot!.maxRpm! > 0

  return {
    restart,
    flag,
    scWindow,
    deltaBest,
    gapAhead,
    position,
    speed,
    restartZone,
    queueTrain,
    neutralised,
    muted: neutralised,
    shiftArmed,
    alerts: {
      windowViolation: alerts.windowViolation.active,
      restartImminent: alerts.restartImminent.active,
      overtakeReminder: alerts.overtakeReminder.active
    },
    activeAlerts: rc13ActiveAlerts(alerts)
  }
}

/**
 * Binds the alert layer to what the model actually PUBLISHED, never to the raw snapshot: a channel
 * that the shared buffer refused, or that aged past its budget, reaches the alert layer as null and
 * therefore unlatches rather than holding.
 */
export function rc13AlertInputForModel(
  model: Rc13DashboardModel,
  nowMs: number,
  gapHistory: readonly Rc13GapObservation[] = []
): Rc13AlertInput {
  const gapUsable = !model.gapAhead.unavailable && !model.gapAhead.stale && typeof model.gapAhead.raw === 'number'
  const speedUsable = !model.speed.unavailable && !model.speed.stale && typeof model.speed.raw === 'number'
  return {
    nowMs,
    windowZone: model.scWindow.zone,
    restartState: model.restart.unavailable || model.restart.stale ? null : model.restart.state,
    gapAheadSec: gapUsable ? (model.gapAhead.raw as number) : null,
    gapClosingSec: gapUsable ? rc13GapClosingSec(gapHistory) : null,
    speedKmh: speedUsable ? (model.speed.raw as number) : null,
    neutralised: model.neutralised
  }
}

// ─────────────────────────────────────────────────────────── accessible descriptions

/** Packet 19: the caution state is spelled out in words, never carried by hue alone. */
export function rc13RestartDescription(model: Rc13DashboardModel): string {
  if (model.restart.unavailable) return 'Restart status unavailable, no race-control feed'
  if (model.restart.stale) return 'Restart status stale, treated as unknown'
  return `Restart status ${model.restart.value}`
}

export function rc13FlagDescription(model: Rc13DashboardModel): string {
  if (model.flag.unavailable || model.flag.stale || model.flag.flag === null) {
    return 'Track flag no signal, race-control feed absent'
  }
  return `Track flag ${model.flag.value}`
}

/** Packet 19: over / in / under is carried by the WORD, before any colour is perceived. */
export function rc13WindowDescription(model: Rc13DashboardModel): string {
  if (!model.scWindow.available || model.scWindow.zone === null) {
    return `Safety-car delta window unavailable, ${RC13_NO_WINDOW_SOURCE.toLowerCase()}`
  }
  return `Safety-car delta ${model.scWindow.delta.value}, ${RC13_WINDOW_ZONE_WORDS[model.scWindow.zone]}`
}

/**
 * A colour-free fingerprint of the frame's compliance state. Two frames that differ only in hue
 * produce the same string; two frames that differ in MEANING never do.
 */
export function rc13PatternFingerprint(model: Rc13DashboardModel): string {
  return [
    `restart:${model.restart.state}`,
    `flag:${model.flag.flag ?? 'no-signal'}`,
    `window:${model.scWindow.zone ?? 'none'}`,
    `marker:${model.scWindow.markerUnit ?? 'none'}`,
    `muted:${model.muted ? 'yes' : 'no'}`,
    `armed:${model.shiftArmed ? 'yes' : 'no'}`,
    `alerts:${model.activeAlerts.join('+') || 'silent'}`
  ].join(' ')
}

export type { Rc01Field as Rc13Field }
