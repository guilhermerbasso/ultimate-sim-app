import type { DriverEntry, TelemetrySnapshot } from '../../../../shared/telemetry'
import {
  type Rc01ChannelReceipt,
  type Rc01Field,
  type Rc01FieldTone,
  rc01MonotonicNow,
  rc01ReceiptAgeMs
} from './raceconRc01Core'

/**
 * RC-12 "On Air — Broadcast Timing Presentation" core.
 *
 * This is the portfolio's first AUDIENCE-FACING page. It is explicitly not a cockpit display:
 * packet 10 suppresses shift LEDs, gear, RPM and every driver aid, and packet 18's negative prompt
 * forbids them outright. The hierarchy is rank + gap + last lap, framed for a viewer who sees the
 * graphic for a few seconds.
 *
 * The live-only ingest buffer, identity binding, mock/replay refusal, the out-of-order and
 * same-timestamp guards and the shared channel receipts are reused verbatim from `raceconRc01Core`.
 * That is telemetry-truth machinery, not RC-01 styling, and a fork would silently drift. RC-01's
 * alert layer is deliberately NOT driven from here: RC-12's packet section 15 alerts are EDITORIAL
 * highlights on a timing feed (fastest lap, position change, lead change) with 5 s and 500 ms
 * lifetimes, which is a completely different contract from RC-01's over-rev / delta-cliff debounces.
 *
 * The hardest requirement in this artifact is honesty about the timing feed. A broadcast board looks
 * plausible when it is completely fabricated, so every field here is bound to a section 16 channel
 * the app genuinely publishes, and everything else renders the packet dash. Six packet
 * contradictions are resolved by OMISSION and ten by NORMATIVE OVERRIDE; both sets are exported and
 * asserted by the suite, so a later edit cannot quietly reintroduce them.
 */

// ─────────────────────────────────────────────────────────── canvas + breakpoints

/** Packet section 11 native canvas, and the section 12.1 app reflow target. */
export const RC12_NATIVE_WIDTH_PX = 800
export const RC12_NATIVE_HEIGHT_PX = 480
export const RC12_NATIVE_TOLERANCE_PX = 1
export const RC12_APP_WIDTH_PX = 1024
export const RC12_APP_HEIGHT_PX = 600

export const RC12_PHONE_MIN_WIDTH_PX = 360
export const RC12_PHONE_MAX_WIDTH_PX = 480
export const RC12_PHONE_MIN_HEIGHT_PX = 650
export const RC12_LANDSCAPE_MIN_WIDTH_PX = 650
export const RC12_LANDSCAPE_MIN_HEIGHT_PX = 360
export const RC12_LANDSCAPE_MAX_HEIGHT_PX = 480

export type Rc12CompactMode = 'phone' | 'landscape' | 'standard'
export type Rc12Layout = 'native' | 'app' | 'compact'

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

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

// ─────────────────────────────────────────────────────────── packet omissions

/**
 * The packet requirements this build deliberately does NOT render, with the reason. Each key is
 * asserted by the suite: the omission is part of the contract, not an oversight.
 *
 *  - `sessionClockChannel`   Packet 11.1, 12.1 and 17 all demand a session clock ribbon carrying
 *                            session time and laps remaining, yet section 16 defines NEITHER a
 *                            session-time channel nor a lap-count channel. The ribbon is drawn and
 *                            both readouts render their dash forever. The app snapshot does happen
 *                            to expose `sessionTimeRemainingSec` and `lapsRemaining`, and they are
 *                            deliberately not read: a channel absent from section 16 is not a
 *                            channel this artifact may print. RESOLUTION REQUESTED FROM THE PACKET
 *                            OWNER: add `Session time` and `Laps remaining` rows to section 16.
 *  - `entrantIdentityChannel` Packet 11.1, 17 and 20 all demand a name badge per row, yet section 16
 *                            defines no entrant-identity channel, and section 20 forbids real
 *                            entrants outright. Every badge is therefore the neutral placeholder and
 *                            no car number, driver name or team name is ever printed. The rank axis
 *                            still carries the information: position is a real section 16 channel.
 *  - `fieldWideIntervalChannel` Section 16's `Gap ahead` is "timing feed interval to car ahead". The
 *                            app publishes exactly one interval channel — the timing feed's own
 *                            interval between the player and the car directly ahead or behind IN THE
 *                            RUNNING ORDER. It publishes no interval between two arbitrary rows, and
 *                            `DriverEntry.gapToPlayerSec` is a SHORTEST-CIRCULAR on-track relative
 *                            wrapped to half a lap, so differencing two of them is an estimate and
 *                            is refused. Every row the measurement cannot reach dashes `--.-`.
 *  - `sectorAndRollingSplit` `Sector split` and `Rolling split time` have section 16 channels but no
 *                            zone in 11.1 or 12.1, at any breakpoint. They are not drawn at all
 *                            rather than improvised into the band.
 *  - `tyreAgeAndPitStatus`   Section 10 lists tyre age and pit status as tertiary telemetry and
 *                            section 16 gives neither a channel. Never invented, never drawn.
 *  - `pitLimiterChannel`     Section 16 carries the ECU pit-limiter bool with an explicit "hidden if
 *                            status channel absent" rule. A broadcast board covers the whole field
 *                            and no per-car ECU limiter feed exists, so it is hidden.
 */
export const RC12_PACKET_OMISSIONS = Object.freeze({
  sessionClockChannel:
    'packet 11.1/12.1/17 demand a session clock that section 16 gives no session-time and no lap-count channel for: the ribbon is drawn and both readouts dash, and the snapshot session clock is deliberately not read',
  entrantIdentityChannel:
    'packet 11.1/17/20 demand a name badge that section 16 gives no entrant-identity channel for, and section 20 forbids real entrants: every badge is the neutral placeholder and no car number or name is printed',
  fieldWideIntervalChannel:
    'packet 16 gap ahead is an interval to the car ahead and the app measures it only across the player pair: every other row dashes rather than differencing a wrapped on-track relative',
  sectorAndRollingSplit:
    'packet 16 sector split and rolling split time have channels but no zone in 11.1 or 12.1 at any breakpoint: neither is drawn',
  tyreAgeAndPitStatus:
    'packet 10 lists tyre age and pit status as tertiary telemetry that section 16 gives no channel: neither is ever invented or drawn',
  pitLimiterChannel:
    'packet 16 hides the pit limiter when the status channel is absent, and a broadcast board has no per-car ECU limiter feed: it is hidden'
})

/**
 * The packet deviations this build ships DELIBERATELY, each one recorded from the approved
 * attempt-004 governance chain. The packet files are never edited; the deviation lives here and in
 * the pull request instead.
 */
export const RC12_NORMATIVE_OVERRIDES = Object.freeze({
  zoneCoordinates:
    'zone geometry comes from packet 11.1 and 12.1, never traced from the approved render, whose measured drift reaches +10.41 pp on the strip origin',
  typeScale:
    "packet 11.2's absolutes are unimplementable at 800x480 (gap 44 px and position 40 px inside a 30 px row pitch, +46.7 % and +33.3 % overflow): the ratios are implemented at x0.5455 as gap 24, position 22, badge 16, last lap 16, and the battle gap stays 72",
  gapOverPositionRatio:
    'the 1.10x gap-over-position ratio is computed arithmetically from packet 11.2, never measured off the render, which drew 1.000',
  fastestLapTagOverlap:
    'packet 11.1 puts the fastest-lap tag 100 % inside the leaderboard band, 8,000 px of overlap over row one: the row columns end at x=548 so no row text can ever sit under the tag',
  sessionClockTitleSafe:
    'packet 11.1 overhangs the title-safe frame with the session ribbon by 10 px = 55.6 % of its height: the safe frame top is redefined to y=8 and the ribbon, band and strip keep their packet coordinates',
  lastLapInk:
    'packet 10 calls last lap time primary while 11.2 puts it in the smallest tier: the values render in primary #FFFFFF at the 11.2 size',
  gapUnit:
    'packet 16 gives the gap an s unit: rows render bare numerals and the unit is stated once, on the battle strip, exactly as the reference does',
  panelAltToken:
    'the alternating row tint needs a third surface tone that packet 11.3 does not define: an explicit panelAlt token is added rather than improvised per rule',
  closestChromaticPair:
    'signature #00E0C6 against normal #37D67A is the tightest pair at Delta-E76 35.69 and 27.76 deg: no token is retuned and every use carries a word and a glyph as well as a hue',
  panelFill:
    'the panel token is filled with the exact packet 11.3 #121A2E; the approved render lands at #0C1833 and is not traced'
})

/** Modules the wider canvas reveals, which must be absent at 800x480. Packet 12.1 expansion model. */
export const RC12_APP_ONLY_MODULES = Object.freeze(['battleHistory', 'driverTags'] as const)

// ─────────────────────────────────────────────────────────── tokens

/** Packet 11.3 tokens, verbatim. */
export const RC12_PACKET_TOKENS = Object.freeze({
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

/**
 * The implemented palette: packet 11.3 plus the one token normative override `panelAltToken` adds.
 * Packet 11.1 asks for an alternating row tint and 11.3 supplies only ONE surface tone, so the
 * alternate is declared explicitly instead of being improvised per rule.
 */
export const RC12_TOKENS = Object.freeze({
  ...RC12_PACKET_TOKENS,
  panelAlt: '#0E1524'
})

export type Rc12Token = keyof typeof RC12_TOKENS

/**
 * The four tokens that must measure ZERO pixels in a silent frame with a healthy feed. Packet
 * section 15 forbids any alert-layer element being used as decoration:
 *
 *  - `signature` is the fastest-lap tag and its row highlight,
 *  - `info` is the lead-change highlight,
 *  - `caution` is the TIMING DELAY freeze note, an unavailable-data state,
 *  - `danger` is the position-LOSS arrow.
 *
 * `normal` is NOT on this list and is deliberately not an alert token: it is the GAIN semantic,
 * bound both to the battle strip's measured closing cue (packet 11.1's "closing arrow", a data
 * element) and to the position-change gain arrow. The approved attempt-004 frame measures exactly
 * this: signature > 0 because the fastest-lap alert fired, normal > 0 for the closing cue, and
 * info / caution / danger all strictly 0.
 */
export const RC12_SILENT_TOKENS = Object.freeze(['caution', 'danger', 'info', 'signature'] as const)

/**
 * The battle strip's trend cue. Packet 11.1 calls it a "closing arrow": closing is the only state
 * the cue exists to signal, so only closing carries a hue. Opening and holding are rendered in the
 * neutral secondary ink so the LOSS alert token can never appear in a silent frame, and all three
 * carry a WORD and a GLYPH as well, per packet 19.
 */
export const RC12_TREND_TOKENS = Object.freeze({
  closing: 'normal' as const,
  opening: 'secondary' as const,
  holding: 'secondary' as const,
  unknown: 'secondary' as const
})

export const RC12_TREND_GLYPHS = Object.freeze({
  closing: '\u25B2',
  opening: '\u25BC',
  holding: '\u25AC',
  unknown: '\u2014'
})

// ─────────────────────────────────────────────────────────── type ladder

/** Packet 11.2, verbatim, in the packet's own pixels. Kept so the ratios stay arithmetic. */
export const RC12_PACKET_TYPE_SCALE_PX = Object.freeze({
  position: 40,
  badge: 30,
  gap: 44,
  lastLap: 30,
  battleGap: 72
})

/**
 * Normative override `typeScale`. Packet 11.1 gives the band 240 px for 8 rows, a 30 px pitch, and
 * 11.2 then asks for a 44 px gap and a 40 px position inside it — +46.7 % and +33.3 % overflow. The
 * row tier is scaled by 0.5455 so the RATIOS survive and the glyphs fit; the battle-gap hero is
 * outside the band and keeps its packet size.
 */
export const RC12_TYPE_SCALE_FACTOR = 0.5455

/**
 * `lastLap` is deliberately NOT `badge * 1`. Packet 11.2 puts the name badge and the last-lap time
 * in the same tier-4 rung (30 px each), and rendering both from one `2 cqw` value made them
 * byte-identical at every canvas width — badge 16 == lastLap 16 at 800x480, 20.48 == 20.48 at
 * 1024x600, 7.86 == 7.86 at 393x759, 8.24 == 8.24 at 412x867, 15.18 == 15.18 at 759x393 and
 * 17.34 == 17.34 at 867x412. Two readouts at the same size carry no rank at all, and the board's
 * own reading order is badge (who) above last lap (when). The last-lap rung therefore steps down
 * to 14 px — one half-step above the 12 px ribbon that closes the ladder — so the order
 * position 22 > badge 16 > lastLap 14 > ribbon 12 holds with a STRICT inequality at every
 * breakpoint. The normative override `lastLapInk` is untouched: last lap keeps the primary ink
 * that marks it as packet 10's primary reading.
 */
export const RC12_TYPE_SCALE_PX = Object.freeze({
  position: 22,
  badge: 16,
  gap: 24,
  lastLap: 14,
  battleGap: 72,
  ribbon: 12,
  tag: 18
})

/** One container-query width unit is one hundredth of the native canvas: 800 / 100 = 8 px. */
export const RC12_CQW_PX = RC12_NATIVE_WIDTH_PX / 100

/** Packet 12.1's type step: 1024 / 800. The ladder GROWS with the canvas, it does not re-rank. */
export const RC12_APP_TYPE_SCALE = RC12_APP_WIDTH_PX / RC12_NATIVE_WIDTH_PX

/**
 * The px ladder expressed in the container units the stylesheet actually uses. Because the app
 * canvas is exactly 1.28x the native canvas, ONE cqw ladder satisfies both breakpoints: 24 px at
 * 800 wide and 30.72 px at 1024 wide are the same 3 cqw. The suite asserts that identity.
 */
export function rc12TypeScaleCqw(px: number): number {
  return round3(px / RC12_CQW_PX)
}

/** The physical size a rung renders at on a given canvas width, for the arithmetic assertions. */
export function rc12TypeScalePxForWidth(px: number, canvasWidthPx: number): number {
  return round3((rc12TypeScaleCqw(px) * canvasWidthPx) / 100)
}

/**
 * The `clamp()` bounds every rung is rendered inside, and the CSS custom property that carries it.
 *
 * This is the `white-space: nowrap` trap, defused. A nowrap flex item's min-content width exceeds
 * its column, so `overflow: hidden` never clips it and `scrollWidth === clientWidth` even while the
 * glyph physically escapes its box — a hero numeral can collide with its neighbour while every
 * scrollWidth check passes. The mitigation is structural rather than observational: each rung is
 * sized from a cqw value with a CONSERVATIVE maximum, and each row column owns an exact share of the
 * row width. `rc12RowColumnWidthPx` and `rc12GlyphAdvancePx` further down let the suite prove
 * containment arithmetically instead of measuring a number that cannot fail.
 */
export const RC12_TYPE_CLAMP_PX = Object.freeze({
  position: Object.freeze({ min: 7, max: 44, cssVar: '--rc12-type-position' }),
  badge: Object.freeze({ min: 6, max: 32, cssVar: '--rc12-type-badge' }),
  gap: Object.freeze({ min: 7, max: 48, cssVar: '--rc12-type-gap' }),
  // The last-lap bounds are the badge bounds scaled by the same 14/16 the rung is, so the rank
  // cannot collapse by clamping at either end of the range the way a shared bound would.
  lastLap: Object.freeze({ min: 5, max: 28, cssVar: '--rc12-type-last' }),
  battleGap: Object.freeze({ min: 10, max: 96, cssVar: '--rc12-type-battle-gap' }),
  tag: Object.freeze({ min: 6, max: 34, cssVar: '--rc12-type-tag' })
})

export type Rc12TypeRung = keyof typeof RC12_TYPE_CLAMP_PX

/** The size a rung actually renders at on a canvas of a given width, clamp included. */
export function rc12TypeSizePxForCanvas(rung: Rc12TypeRung, canvasWidthPx: number): number {
  const bounds = RC12_TYPE_CLAMP_PX[rung]
  const raw = rc12TypeScalePxForWidth(RC12_TYPE_SCALE_PX[rung], canvasWidthPx)
  return round3(clamp(raw, bounds.min, bounds.max))
}

/**
 * A conservative advance model for the condensed tabular-numeral face this widget uses: no glyph in
 * the permitted set is wider than 0.55 em. The suite compares this against the column width, which
 * is the containment claim `scrollWidth` cannot make.
 */
export const RC12_GLYPH_ADVANCE_RATIO = 0.55

export function rc12GlyphAdvancePx(text: string, fontSizePx: number): number {
  return round3(text.length * RC12_GLYPH_ADVANCE_RATIO * fontSizePx)
}

/**
 * The fastest-lap tag is a FIXED packet box — 200x40 at 800x480, 272x40 at 1024x600 — that has to
 * carry three nowrap strings on one centred line: the editorial word, the position and the lap
 * time. At the packet's 18 px rung the three of them need more width than the box has, and because
 * they are bare flex children they were shrunk below their own text instead: measured
 * scrollWidth − clientWidth of +20/+4/+16 px at 800x480 and +18/+4/+13 px at 1024x600. The four
 * compact viewports give the tag the full content width and are clean.
 *
 * The remedy is the one this module already applies to every other rung: the packet rung is the
 * CEILING, and the rung actually rendered is the packet rung capped by the arithmetic fit of the
 * zone the packet itself publishes. Nothing is widened and no tolerance moves.
 *
 * `RC12_TAG_ADVANCE_EM` is the mean advance of the condensed uppercase face INCLUDING the 0.14 em
 * tracking `.rc12-tag` sets: the three strings measure 228 px at an 18 px rung over 21 glyphs
 * (0.603 em), and 0.62 em is that measurement rounded up so the cap stays conservative.
 */
export const RC12_TAG_ADVANCE_EM = 0.62
export const RC12_TAG_GAP_CQW = 0.6
export const RC12_TAG_BORDER_PX = 2
/** "FASTEST LAP" + "P7" + "1:37.106": the tag's reference content, and the fit's minimum budget. */
export const RC12_TAG_REFERENCE_GLYPHS = 21

export function rc12TagFitCqw(zoneWidthPct: number, glyphCount: number, canvasWidthPx: number): number {
  if (!finite(zoneWidthPct) || !finite(glyphCount) || !finite(canvasWidthPx)) return 0
  if (glyphCount <= 0 || canvasWidthPx <= 0) return 0
  const borderCqw = (RC12_TAG_BORDER_PX / canvasWidthPx) * 100
  const usable = zoneWidthPct - 2 * RC12_TAG_GAP_CQW - borderCqw
  return usable <= 0 ? 0 : round3(usable / (glyphCount * RC12_TAG_ADVANCE_EM))
}

/** The tag rung actually rendered: the packet rung, never exceeded, capped by its own zone. */
export function rc12TagRungCqw(zoneWidthPct: number, glyphCount: number, canvasWidthPx: number): number {
  return round3(
    Math.min(rc12TypeScaleCqw(RC12_TYPE_SCALE_PX.tag), rc12TagFitCqw(zoneWidthPct, glyphCount, canvasWidthPx))
  )
}

// ─────────────────────────────────────────────────────────── zones

export interface Rc12RectPx {
  x: number
  y: number
  width: number
  height: number
}

export interface Rc12Rect {
  left: number
  top: number
  width: number
  height: number
}

export type Rc12ZoneId = 'sessionClock' | 'leaderboard' | 'battleStrip' | 'battleHistory' | 'fastestLapTag'

export type Rc12ZoneMapPx = Readonly<Partial<Record<Rc12ZoneId, Rc12RectPx>>>
export type Rc12ZoneMap = Readonly<Partial<Record<Rc12ZoneId, Rc12Rect>>>

/**
 * Packet 11.1's zones for the 800x480 canvas, in the packet's own pixels. Normative override
 * `zoneCoordinates` is explicit that the render is never traced: measured drift reaches +10.41 pp on
 * the strip origin and +5.21 pp on the band height, so the packet boxes win outright.
 *
 * There is deliberately no `battleHistory` box: the gap-history graphic is a 12.1 reveal.
 */
export const RC12_NATIVE_ZONES_PX: Rc12ZoneMapPx = Object.freeze({
  sessionClock: Object.freeze({ x: 40, y: 10, width: 720, height: 18 }),
  leaderboard: Object.freeze({ x: 40, y: 30, width: 720, height: 240 }),
  battleStrip: Object.freeze({ x: 40, y: 290, width: 720, height: 120 }),
  fastestLapTag: Object.freeze({ x: 560, y: 30, width: 200, height: 40 })
})

/**
 * Packet 12.1's `broadcast-field-reveal`. The extra width buys exactly two things — twice the field
 * on the board and a gap-history graphic for the featured battle — and the leaderboard-plus-lower-
 * third structure is preserved for TV. It is an EXPANSION, never a scale.
 */
export const RC12_APP_ZONES_PX: Rc12ZoneMapPx = Object.freeze({
  sessionClock: Object.freeze({ x: 48, y: 10, width: 928, height: 18 }),
  leaderboard: Object.freeze({ x: 48, y: 32, width: 640, height: 520 }),
  battleStrip: Object.freeze({ x: 704, y: 32, width: 272, height: 300 }),
  battleHistory: Object.freeze({ x: 704, y: 344, width: 272, height: 150 }),
  fastestLapTag: Object.freeze({ x: 704, y: 502, width: 272, height: 40 })
})

/** Packet 11.1's own title-safe frame, kept so the audit can be reproduced from this file. */
export const RC12_PACKET_SAFE_FRAME_PX: Rc12RectPx = Object.freeze({ x: 24, y: 20, width: 752, height: 400 })

/**
 * Normative override `sessionClockTitleSafe`. The packet's session ribbon spans y = 10..28 and its
 * own title-safe frame starts at y = 20, so 10 px — 55.6 % of the ribbon height — sits outside the
 * frame the packet declares. The governance chain offers two fixes; this build takes the one that
 * leaves every other packet coordinate untouched and redefines the frame top to y = 8. Moving the
 * ribbon instead would have forced the band to 224 px and broken 11.1's 8 x 30 px row pitch, which
 * the type ladder in 11.2 is already fighting.
 */
export const RC12_SAFE_FRAME_PX: Rc12RectPx = Object.freeze({ x: 24, y: 8, width: 752, height: 412 })

/**
 * Normative override `fastestLapTagOverlap`. Packet 11.1's fastest-lap tag (560, 30, 200, 40) lies
 * 100 % inside the leaderboard band (40, 30, 720, 240): 8,000 px of overlap directly over row one.
 * The row COLUMNS therefore end at x = 548 and the tag keeps its packet box, leaving a 12 px gutter,
 * so no row text can ever sit under the tag whether it is showing or not.
 */
export const RC12_NATIVE_ROW_COLUMN_X1_PX = 548
export const RC12_TAG_GUTTER_PX = RC12_NATIVE_ZONES_PX.fastestLapTag!.x - RC12_NATIVE_ROW_COLUMN_X1_PX

/** Packet 11.1's ranked rows at 800x480, and packet 12.1's "taller board showing more positions". */
export const RC12_NATIVE_ROW_COUNT = 8
export const RC12_APP_ROW_COUNT = 16
export const RC12_PHONE_ROW_COUNT = 10
export const RC12_LANDSCAPE_ROW_COUNT = 6

/**
 * The four row columns, as fractions of the row's own content width. Packet 11.1: position, generic
 * name badge, gap, last lap. Normative override `lastLapInk` puts the last-lap value in `primary`
 * although 11.2 sizes it with the badge; override `gapUnit` keeps the row gaps as bare numerals.
 */
export const RC12_ROW_COLUMNS = Object.freeze([
  Object.freeze({ id: 'position' as const, label: 'POS', start: 0, end: 0.13, align: 'left' as const, token: 'primary' as const }),
  Object.freeze({ id: 'badge' as const, label: 'CAR', start: 0.13, end: 0.47, align: 'left' as const, token: 'secondary' as const }),
  Object.freeze({ id: 'gap' as const, label: 'GAP', start: 0.47, end: 0.71, align: 'right' as const, token: 'primary' as const }),
  Object.freeze({ id: 'lastLap' as const, label: 'LAST', start: 0.71, end: 1, align: 'right' as const, token: 'primary' as const })
])

export type Rc12RowColumnId = (typeof RC12_ROW_COLUMNS)[number]['id']

function canvasSizePx(layout: Rc12Layout): { width: number; height: number } {
  return layout === 'app'
    ? { width: RC12_APP_WIDTH_PX, height: RC12_APP_HEIGHT_PX }
    : { width: RC12_NATIVE_WIDTH_PX, height: RC12_NATIVE_HEIGHT_PX }
}

export function rc12ZonesPxForLayout(layout: Rc12Layout): Rc12ZoneMapPx {
  return layout === 'app' ? RC12_APP_ZONES_PX : RC12_NATIVE_ZONES_PX
}

/** A packet pixel box as canvas percentages, which is what the DOM actually carries. */
export function rc12RectPercent(rect: Rc12RectPx, canvasWidth: number, canvasHeight: number): Rc12Rect {
  return {
    left: round6((rect.x / canvasWidth) * 100),
    top: round6((rect.y / canvasHeight) * 100),
    width: round6((rect.width / canvasWidth) * 100),
    height: round6((rect.height / canvasHeight) * 100)
  }
}

/**
 * The compact grammars are not packet-specified. They keep the broadcast structure — a session
 * ribbon over a ranked band over a featured-battle lower third — and drop only the two app-only
 * reveals, so the fastest-lap tag, the position-change arrows and the TIMING DELAY note all keep a
 * visible surface at every size.
 */
function rc12CompactZonesPx(mode: Rc12CompactMode, width: number, height: number): Rc12ZoneMapPx {
  if (mode === 'phone') {
    return Object.freeze({
      sessionClock: Object.freeze({ x: 0.04 * width, y: 0.02 * height, width: 0.92 * width, height: 0.035 * height }),
      leaderboard: Object.freeze({ x: 0.04 * width, y: 0.07 * height, width: 0.92 * width, height: 0.58 * height }),
      battleStrip: Object.freeze({ x: 0.04 * width, y: 0.67 * height, width: 0.92 * width, height: 0.24 * height }),
      fastestLapTag: Object.freeze({ x: 0.04 * width, y: 0.93 * height, width: 0.92 * width, height: 0.055 * height })
    })
  }
  if (mode === 'landscape') {
    return Object.freeze({
      sessionClock: Object.freeze({ x: 0.05 * width, y: 0.02 * height, width: 0.9 * width, height: 0.05 * height }),
      leaderboard: Object.freeze({ x: 0.05 * width, y: 0.09 * height, width: 0.56 * width, height: 0.82 * height }),
      battleStrip: Object.freeze({ x: 0.63 * width, y: 0.09 * height, width: 0.32 * width, height: 0.56 * height }),
      fastestLapTag: Object.freeze({ x: 0.63 * width, y: 0.69 * height, width: 0.32 * width, height: 0.1 * height })
    })
  }
  return Object.freeze({
    sessionClock: Object.freeze({ x: 0.05 * width, y: 0.02 * height, width: 0.9 * width, height: 0.04 * height }),
    leaderboard: Object.freeze({ x: 0.05 * width, y: 0.08 * height, width: 0.9 * width, height: 0.52 * height }),
    battleStrip: Object.freeze({ x: 0.05 * width, y: 0.62 * height, width: 0.9 * width, height: 0.26 * height }),
    fastestLapTag: Object.freeze({ x: 0.05 * width, y: 0.9 * height, width: 0.9 * width, height: 0.07 * height })
  })
}

export function rc12ZonesForLayout(
  layout: Rc12Layout,
  compactMode: Rc12CompactMode = 'standard',
  box: { width: number; height: number } = canvasSizePx(layout)
): Rc12ZoneMap {
  const size = layout === 'compact' ? box : canvasSizePx(layout)
  const zonesPx =
    layout === 'compact' ? rc12CompactZonesPx(compactMode, size.width, size.height) : rc12ZonesPxForLayout(layout)
  const entries = (Object.keys(zonesPx) as Rc12ZoneId[]).map((id) => [
    id,
    Object.freeze(rc12RectPercent(zonesPx[id] as Rc12RectPx, size.width, size.height))
  ])
  return Object.freeze(Object.fromEntries(entries)) as Rc12ZoneMap
}

/** Packet 11.1 rows at 800x480, 12.1's fuller field at 1024x600, and the compact reflows. */
export function rc12RowCountForLayout(layout: Rc12Layout, compactMode: Rc12CompactMode = 'standard'): number {
  if (layout === 'app') return RC12_APP_ROW_COUNT
  if (layout === 'native') return RC12_NATIVE_ROW_COUNT
  if (compactMode === 'phone') return RC12_PHONE_ROW_COUNT
  if (compactMode === 'landscape') return RC12_LANDSCAPE_ROW_COUNT
  return RC12_NATIVE_ROW_COUNT
}

/**
 * The row pitch in canvas pixels. The whole type ladder exists to fit inside this number, so it is
 * computed from the packet's own band height rather than chosen: 240 / 8 = 30 px at 800x480 and
 * 520 / 16 = 32.5 px at 1024x600, both comfortably above the 24 px / 30.72 px gap glyph.
 */
export function rc12RowPitchPx(layout: Rc12Layout, compactMode: Rc12CompactMode = 'standard'): number {
  const zone = rc12ZonesPxForLayout(layout).leaderboard
  if (!zone || layout === 'compact') return 0
  return round3(zone.height / rc12RowCountForLayout(layout, compactMode))
}

/**
 * The right inset the row COLUMNS carry, in container-query width units. Normative override
 * `fastestLapTagOverlap`: at 800x480 the columns stop at x = 548 so the packet's fastest-lap tag box
 * can never sit over row text. At 1024x600 the tag is outside the band entirely, so the inset is 0.
 */
export function rc12RowColumnInsetCqw(layout: Rc12Layout): number {
  if (layout !== 'native') return 0
  const band = RC12_NATIVE_ZONES_PX.leaderboard!
  return round3(((band.x + band.width - RC12_NATIVE_ROW_COLUMN_X1_PX) / RC12_NATIVE_WIDTH_PX) * 100)
}

export function rc12RectsOverlap(a: Rc12Rect, b: Rc12Rect): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  )
}

/** A 0..100 coordinate as a CSS percentage, without binary-float noise in the DOM. */
export function rc12Percent(value: number): string {
  return `${round3(finite(value) ? value : 0)}%`
}

export function rc12ZoneStyle(rect: Rc12Rect | undefined): {
  left: string
  top: string
  width: string
  height: string
} | null {
  if (!rect) return null
  return {
    left: rc12Percent(rect.left),
    top: rc12Percent(rect.top),
    width: rc12Percent(rect.width),
    height: rc12Percent(rect.height)
  }
}

// ─────────────────────────────────────────────────────────── layout resolution

export function rc12LayoutForContentBox(width: number, height: number): Rc12Layout {
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return 'app'
  if (
    Math.abs(width - RC12_NATIVE_WIDTH_PX) <= RC12_NATIVE_TOLERANCE_PX &&
    Math.abs(height - RC12_NATIVE_HEIGHT_PX) <= RC12_NATIVE_TOLERANCE_PX
  ) {
    return 'native'
  }
  if (width >= RC12_APP_WIDTH_PX - 1 && height >= RC12_APP_HEIGHT_PX - 1) return 'app'
  return 'compact'
}

export function rc12CompactModeForContentBox(width: number, height: number): Rc12CompactMode {
  if (rc12LayoutForContentBox(width, height) !== 'compact') return 'standard'
  if (
    width >= RC12_PHONE_MIN_WIDTH_PX &&
    width <= RC12_PHONE_MAX_WIDTH_PX &&
    height >= RC12_PHONE_MIN_HEIGHT_PX &&
    height / width >= 1.5
  ) {
    return 'phone'
  }
  if (
    width >= RC12_LANDSCAPE_MIN_WIDTH_PX &&
    height >= RC12_LANDSCAPE_MIN_HEIGHT_PX &&
    height <= RC12_LANDSCAPE_MAX_HEIGHT_PX &&
    width / height >= 1.5
  ) {
    return 'landscape'
  }
  return 'standard'
}

export interface Rc12PhoneGeometry {
  inset: number
  ribbonHeight: number
  rowMinHeight: number
  tagHeight: number
}

export function rc12PhoneGeometryForContentBox(width: number, height: number): Rc12PhoneGeometry | null {
  if (rc12CompactModeForContentBox(width, height) !== 'phone') return null
  return {
    inset: 8,
    ribbonHeight: Math.max(14, Math.round(height * 0.026)),
    rowMinHeight: Math.max(22, Math.round(height * 0.05)),
    tagHeight: Math.max(24, Math.round(height * 0.05))
  }
}

// ─────────────────────────────────────────────────────────── channels

/**
 * Packet section 16 freshness budgets. Position, Gap ahead and Gap behind are the packet's verbatim
 * 1 s. Last lap time, Best lap time, Sector split, Rolling split time and Pit limiter are all
 * EVENT-driven in the packet ("on lap complete", "on sector", "on split", "event") and therefore
 * carry no millisecond budget at all: they are fresh exactly while the feed that carries them is,
 * which is the timing budget below. Inventing a millisecond budget for them would be inventing a
 * freshness rule the packet does not state.
 */
export const RC12_CHANNEL_STALE_MS = {
  position: 1_000,
  gapAhead: 1_000,
  gapBehind: 1_000
} as const

export type Rc12TimedChannel = keyof typeof RC12_CHANNEL_STALE_MS

export const RC12_EVENT_CHANNELS = Object.freeze([
  'lastLapTime',
  'bestLapTime',
  'sectorSplit',
  'rollingSplit',
  'pitLimiter'
] as const)

export type Rc12EventChannel = (typeof RC12_EVENT_CHANNELS)[number]

/**
 * The whole board is one feed. Packet 15 says the board freezes with a TIMING DELAY note when the
 * feed goes stale, and packet 16 gives the feed's own channels a 1 s budget, so the note is raised
 * on exactly that budget rather than on a number of this file's own invention.
 */
export const RC12_TIMING_STALE_MS = RC12_CHANNEL_STALE_MS.position
export const RC12_TIMING_DELAY_LABEL = 'TIMING DELAY'
export const RC12_NO_BATTLE_LABEL = 'NO BATTLE SOURCE'
export const RC12_NO_TIMING_LABEL = 'NO TIMING SOURCE'
export const RC12_FASTEST_LAP_LABEL = 'FASTEST LAP'
export const RC12_LEAD_CHANGE_LABEL = 'LEAD'

/** Packet 16 dash states, verbatim, so the widget and the suite cannot drift from the table. */
export const RC12_DASH = Object.freeze({
  position: '--',
  gap: '--.-',
  lapTime: '--:--.---',
  sessionTime: '--',
  lapCounter: '--',
  /** Packet 20's neutral badge: no entrant identity channel exists, so nothing identifying is shown. */
  badge: 'CAR --'
})

/** Packet 16's `s` unit, stated once on the battle strip per normative override `gapUnit`. */
export const RC12_GAP_UNIT = 'S'

/** The longest string each row column can ever be asked to print. */
export const RC12_LONGEST_CELL_TEXT: Readonly<Record<Rc12RowColumnId, string>> = Object.freeze({
  position: `P${RC12_APP_ROW_COUNT}`,
  badge: RC12_DASH.badge,
  gap: RC12_DASH.gap,
  lastLap: RC12_DASH.lapTime
})

/** The stylesheet's row and cell padding, in container-query width units. */
export const RC12_ROW_PADDING_CQW = 0.9
export const RC12_CELL_PADDING_CQW = 0.2

/** The width the four row columns actually share, in canvas pixels. */
export function rc12RowContentWidthPx(layout: Rc12Layout): number {
  const band = rc12ZonesPxForLayout(layout).leaderboard
  if (!band) return 0
  const canvasWidth = canvasSizePx(layout).width
  const insetPx = (rc12RowColumnInsetCqw(layout) / 100) * canvasWidth
  const paddingPx = 2 * (RC12_ROW_PADDING_CQW / 100) * canvasWidth
  return round3(band.width - insetPx - paddingPx)
}

/** One column's usable width in canvas pixels, its own padding already removed. */
export function rc12RowColumnWidthPx(columnId: Rc12RowColumnId, layout: Rc12Layout): number {
  const column = RC12_ROW_COLUMNS.find((candidate) => candidate.id === columnId)
  if (!column) return 0
  const canvasWidth = canvasSizePx(layout).width
  const share = column.end - column.start
  const padding = 2 * (RC12_CELL_PADDING_CQW / 100) * canvasWidth
  return round3(share * rc12RowContentWidthPx(layout) - padding)
}

function field(
  value: string,
  raw: number | string | null,
  stale = false,
  isUnavailable = false,
  tone: Rc01FieldTone = 'primary'
): Rc01Field {
  return { value, raw, stale, unavailable: isUnavailable, tone }
}

function unavailableField(value: string): Rc01Field {
  return field(value, null, false, true, 'muted')
}

/** Packet 11.1 uses generic P1..Pn; a position that the feed does not supply dashes. */
export function rc12FormatPosition(position: number | null): string {
  if (!finite(position) || position <= 0 || !Number.isInteger(position)) return RC12_DASH.position
  return `P${position}`
}

/** Packet 16 gap unit is seconds at one decimal, which is what the reference frame prints. */
export function rc12FormatGapSeconds(seconds: number | null): string {
  if (!finite(seconds) || seconds < 0) return RC12_DASH.gap
  return Math.abs(seconds).toFixed(1)
}

/** Packet 16 lap-time unit is mm:ss.mmm. A zero or negative lap is not a lap and dashes. */
export function rc12FormatLapTime(seconds: number | null): string {
  if (!finite(seconds) || seconds <= 0) return RC12_DASH.lapTime
  // Rounded to milliseconds FIRST, so a value a fraction under the minute carries into the minute
  // instead of printing an impossible 0:60.000.
  const totalMs = Math.round(seconds * 1_000)
  const minutes = Math.floor(totalMs / 60_000)
  const rest = totalMs - minutes * 60_000
  return `${minutes}:${String(Math.floor(rest / 1_000)).padStart(2, '0')}.${String(rest % 1_000).padStart(3, '0')}`
}

// ─────────────────────────────────────────────────────────── timing feed acquisition

/**
 * One entrant as the timing/scoring feed reports it. `badge` is deliberately absent: section 16
 * defines no entrant-identity channel and section 20 forbids real entrants, so the row badge is a
 * constant placeholder rather than a field on this record. See
 * `RC12_PACKET_OMISSIONS.entrantIdentityChannel`.
 */
export interface Rc12TimingEntry {
  readonly carIdx: number
  readonly position: number
  readonly isPlayer: boolean
  readonly lastLapSec: number | null
  readonly bestLapSec: number | null
}

function lapSeconds(value: unknown): number | null {
  return finite(value) && value > 0 ? value : null
}

function usableDriver(driver: DriverEntry | null | undefined): boolean {
  return Boolean(
    driver &&
      driver.isPaceCar !== true &&
      finite(driver.position) &&
      driver.position > 0 &&
      Number.isInteger(driver.position) &&
      finite(driver.carIdx)
  )
}

/**
 * The running order, straight from the timing/scoring feed's own `position`. Packet 16: "Never infer
 * position from gaps"; the array is ordered by the reported position and never by a lap distance, an
 * estimated time or a gap. The pace car is not an entrant and is dropped.
 */
export function rc12TimingEntries(snapshot: TelemetrySnapshot | null): readonly Rc12TimingEntry[] {
  const drivers = snapshot?.drivers
  if (!Array.isArray(drivers)) return []
  const playerIdx = finite(snapshot?.playerCarIdx) ? snapshot!.playerCarIdx : null
  const rows = drivers
    .filter(usableDriver)
    .map((driver) =>
      Object.freeze({
        carIdx: driver.carIdx,
        position: driver.position,
        isPlayer: driver.isPlayer === true || (playerIdx !== null && driver.carIdx === playerIdx),
        lastLapSec: lapSeconds(driver.lastLapTimeSec),
        bestLapSec: lapSeconds(driver.bestLapTimeSec)
      })
    )
    .sort((a, b) => a.position - b.position || a.carIdx - b.carIdx)
  return Object.freeze(rows)
}

/**
 * The ONE interval this app genuinely measures, per `RC12_PACKET_OMISSIONS.fieldWideIntervalChannel`.
 *
 * `snapshot.relatives` carries the timing feed's own interval between the player and the nearest car
 * ahead and behind ON TRACK. That is only the packet's "interval to the car ahead" when the on-track
 * neighbour is ALSO the running-order neighbour, so the position is checked before the number is
 * accepted — the RC-02 lesson, where a measurement was recorded only when both of its bounding
 * conditions were genuinely observed. Everything else dashes; nothing is differenced out of
 * `gapToPlayerSec`, which is a shortest-circular on-track relative wrapped to half a lap.
 *
 * The returned map is keyed by the TRAILING car, because the packet's channel is that car's own
 * `Gap ahead`. The same measured interval is the leading car's `Gap behind` and is never written
 * into a second field.
 */
export function rc12MeasuredGapAheadByCar(
  snapshot: TelemetrySnapshot | null,
  entries: readonly Rc12TimingEntry[]
): ReadonlyMap<number, number> {
  const measured = new Map<number, number>()
  const player = entries.find((entry) => entry.isPlayer)
  if (!snapshot || !player) return measured

  const ahead = snapshot.relatives?.ahead
  if (ahead && finite(ahead.gapSec) && ahead.gapSec > 0 && ahead.position === player.position - 1) {
    measured.set(player.carIdx, Math.abs(ahead.gapSec))
  }

  const behind = snapshot.relatives?.behind
  if (behind && finite(behind.gapSec) && behind.position === player.position + 1 && finite(behind.carIdx)) {
    measured.set(behind.carIdx, Math.abs(behind.gapSec))
  }

  return measured
}

export type Rc12BattleTrend = 'closing' | 'opening' | 'holding' | 'unknown'

export interface Rc12FeaturedPair {
  readonly leadCarIdx: number
  readonly trailCarIdx: number
  readonly leadPosition: number
  readonly trailPosition: number
  readonly gapSec: number
}

/**
 * Packet 11.1's featured battle: the two cars whose interval this app actually measures. The
 * trailing car owns the gap, which is exactly the packet's `Gap ahead` for that car. If neither the
 * player's car ahead nor its car behind is the running-order neighbour, there is no featured battle
 * and the strip publishes its empty state rather than featuring a pair it cannot time.
 */
export function rc12FeaturedPair(
  snapshot: TelemetrySnapshot | null,
  entries: readonly Rc12TimingEntry[],
  measured: ReadonlyMap<number, number> = rc12MeasuredGapAheadByCar(snapshot, entries)
): Rc12FeaturedPair | null {
  const player = entries.find((entry) => entry.isPlayer)
  if (!player) return null

  const playerGap = measured.get(player.carIdx)
  if (playerGap !== undefined) {
    const lead = entries.find((entry) => entry.position === player.position - 1)
    if (lead) {
      return Object.freeze({
        leadCarIdx: lead.carIdx,
        trailCarIdx: player.carIdx,
        leadPosition: lead.position,
        trailPosition: player.position,
        gapSec: playerGap
      })
    }
  }

  const trail = entries.find((entry) => entry.position === player.position + 1)
  const trailGap = trail ? measured.get(trail.carIdx) : undefined
  if (trail && trailGap !== undefined) {
    return Object.freeze({
      leadCarIdx: player.carIdx,
      trailCarIdx: trail.carIdx,
      leadPosition: player.position,
      trailPosition: trail.position,
      gapSec: trailGap
    })
  }

  return null
}

/** The gap-history window packet 12.1 reveals, and the trend window the closing cue is read from. */
export const RC12_GAP_HISTORY_LIMIT = 120
export const RC12_TREND_WINDOW_MS = 3_000
export const RC12_TREND_EPSILON_SEC = 0.05

export interface Rc12GapSample {
  readonly receivedAt: number
  readonly gapSec: number
  readonly pairKey: string
}

export function rc12PairKey(pair: Rc12FeaturedPair | null): string {
  return pair ? `${pair.leadCarIdx}:${pair.trailCarIdx}` : ''
}

/**
 * The closing cue, measured from this widget's own observation of a real channel and never from a
 * closing speed. A pair with fewer than two samples inside the trend window is `unknown` and the cue
 * renders its dash: packet 16's "never predict a split; show measured only", applied to the trend.
 */
export function rc12TrendForHistory(
  history: readonly Rc12GapSample[],
  pair: Rc12FeaturedPair | null,
  nowMs: number
): Rc12BattleTrend {
  if (!pair) return 'unknown'
  const key = rc12PairKey(pair)
  const window = history.filter(
    (sample) => sample.pairKey === key && finite(sample.receivedAt) && nowMs - sample.receivedAt <= RC12_TREND_WINDOW_MS
  )
  if (window.length < 2) return 'unknown'
  const oldest = window[0].gapSec
  const newest = window[window.length - 1].gapSec
  if (newest < oldest - RC12_TREND_EPSILON_SEC) return 'closing'
  if (newest > oldest + RC12_TREND_EPSILON_SEC) return 'opening'
  return 'holding'
}

export interface Rc12TimingObservation {
  /** A car that has just set a new session-fastest lap, as OBSERVED by this widget. */
  readonly fastestLap: { readonly carIdx: number; readonly position: number; readonly lapSec: number } | null
  readonly positionChanges: readonly { readonly carIdx: number; readonly direction: 'gain' | 'loss' }[]
  readonly leadChange: { readonly carIdx: number } | null
  readonly timingFresh: boolean
}

const SILENT_OBSERVATION: Rc12TimingObservation = Object.freeze({
  fastestLap: null,
  positionChanges: Object.freeze([]),
  leadChange: null,
  timingFresh: false
})

/** The observation a frame that carried no usable feed produces. Exported so callers never fake one. */
export function rc12SilentObservation(): Rc12TimingObservation {
  return SILENT_OBSERVATION
}

/**
 * The timing-feed buffer. It holds only what this widget has genuinely OBSERVED, so no alert can
 * fire from a value that was already true when the board mounted: the first frame that carries a
 * feed establishes the baseline order, the baseline leader and the baseline session-fastest lap
 * silently, and only a change against that baseline is an event.
 *
 * A receipt is written only when the feed actually reports, so a feed that falls silent ages out and
 * raises the packet's TIMING DELAY note instead of freezing on its last values without saying so.
 */
export class Rc12TimingBuffer {
  private receipt: Rc01ChannelReceipt | null = null
  private order = new Map<number, number>()
  private leader: number | null = null
  private sessionBestSec: number | null = null
  private sessionBestCarIdx: number | null = null
  private baseline = false
  private gapHistory: Rc12GapSample[] = []

  clone(): Rc12TimingBuffer {
    const next = new Rc12TimingBuffer()
    next.receipt = this.receipt
    next.order = new Map(this.order)
    next.leader = this.leader
    next.sessionBestSec = this.sessionBestSec
    next.sessionBestCarIdx = this.sessionBestCarIdx
    next.baseline = this.baseline
    next.gapHistory = this.gapHistory.slice()
    return next
  }

  reset(): void {
    this.receipt = null
    this.order = new Map()
    this.leader = null
    this.sessionBestSec = null
    this.sessionBestCarIdx = null
    this.baseline = false
    this.gapHistory = []
  }

  ingest(snapshot: TelemetrySnapshot | null | undefined, receivedAt = rc01MonotonicNow()): Rc12TimingObservation {
    if (!snapshot || !snapshot.connected || !finite(snapshot.timestamp)) return SILENT_OBSERVATION
    const entries = rc12TimingEntries(snapshot)
    if (entries.length === 0) return SILENT_OBSERVATION

    const safeReceiptAt = finite(receivedAt) && receivedAt >= 0 ? receivedAt : rc01MonotonicNow()
    this.receipt = Object.freeze({
      value: entries.length,
      snapshotTimestamp: snapshot.timestamp,
      receivedAt: safeReceiptAt
    })

    const pair = rc12FeaturedPair(snapshot, entries)
    if (pair) {
      this.gapHistory.push(Object.freeze({ receivedAt: safeReceiptAt, gapSec: pair.gapSec, pairKey: rc12PairKey(pair) }))
      if (this.gapHistory.length > RC12_GAP_HISTORY_LIMIT) {
        this.gapHistory = this.gapHistory.slice(this.gapHistory.length - RC12_GAP_HISTORY_LIMIT)
      }
    }

    const nextOrder = new Map(entries.map((entry) => [entry.carIdx, entry.position]))
    const nextLeader = entries.find((entry) => entry.position === 1)?.carIdx ?? null
    const timed = entries.filter((entry) => entry.lastLapSec !== null)
    const quickest = timed.reduce<Rc12TimingEntry | null>(
      (best, entry) => (best === null || (entry.lastLapSec as number) < (best.lastLapSec as number) ? entry : best),
      null
    )

    if (!this.baseline) {
      // Baseline frame. Whatever is already true when the board mounts is NOT an event: an editorial
      // highlight that fires just because a widget was added is exactly the always-on decoration
      // packet 15 forbids.
      this.baseline = true
      this.order = nextOrder
      this.leader = nextLeader
      this.sessionBestSec = quickest?.lastLapSec ?? null
      this.sessionBestCarIdx = quickest?.carIdx ?? null
      return Object.freeze({ ...SILENT_OBSERVATION, timingFresh: true })
    }

    const positionChanges: { carIdx: number; direction: 'gain' | 'loss' }[] = []
    for (const entry of entries) {
      const previous = this.order.get(entry.carIdx)
      if (previous === undefined || previous === entry.position) continue
      positionChanges.push({ carIdx: entry.carIdx, direction: entry.position < previous ? 'gain' : 'loss' })
    }

    const leadChange = nextLeader !== null && this.leader !== null && nextLeader !== this.leader ? { carIdx: nextLeader } : null

    // Packet 15: the trigger is a car setting a NEW session-fastest lap, so the comparison is
    // strictly against the best this widget has already observed. A board that mounts mid-session
    // inherits the standing best silently on its baseline frame and never announces it.
    let fastestLap: Rc12TimingObservation['fastestLap'] = null
    if (quickest && quickest.lastLapSec !== null && (this.sessionBestSec === null || quickest.lastLapSec < this.sessionBestSec)) {
      fastestLap = Object.freeze({ carIdx: quickest.carIdx, position: quickest.position, lapSec: quickest.lastLapSec })
      this.sessionBestSec = quickest.lastLapSec
      this.sessionBestCarIdx = quickest.carIdx
    }

    this.order = nextOrder
    this.leader = nextLeader

    return Object.freeze({
      fastestLap,
      positionChanges: Object.freeze(positionChanges.map((change) => Object.freeze(change))),
      leadChange: leadChange ? Object.freeze(leadChange) : null,
      timingFresh: true
    })
  }

  /** Packet 16: the feed's own 1 s budget decides whether the board is live or delayed. */
  timingAgeMs(nowMs: number): number {
    return rc01ReceiptAgeMs(this.receipt ?? undefined, nowMs)
  }

  timingReceipt(): Rc01ChannelReceipt | null {
    return this.receipt
  }

  history(): readonly Rc12GapSample[] {
    return this.gapHistory.slice()
  }

  sessionBest(): { lapSec: number | null; carIdx: number | null } {
    return { lapSec: this.sessionBestSec, carIdx: this.sessionBestCarIdx }
  }
}

// ─────────────────────────────────────────────────────────── trigger-only alerts

/** Packet 15: the editorial lifetimes, verbatim. */
export const RC12_FASTEST_LAP_HOLD_MS = 5_000
export const RC12_LEAD_CHANGE_HOLD_MS = 5_000
export const RC12_POSITION_CHANGE_HOLD_MS = 500

export interface Rc12RowChange {
  readonly carIdx: number
  readonly direction: 'gain' | 'loss'
  readonly untilMs: number
}

export interface Rc12AlertState {
  readonly fastestLap: { readonly carIdx: number; readonly position: number; readonly lapSec: number; readonly untilMs: number } | null
  readonly leadChange: { readonly carIdx: number; readonly untilMs: number } | null
  readonly changes: readonly Rc12RowChange[]
  readonly timingDelay: boolean
}

export function createRc12AlertState(): Rc12AlertState {
  return Object.freeze({ fastestLap: null, leadChange: null, changes: Object.freeze([]), timingDelay: false })
}

export interface Rc12AlertInput {
  readonly nowMs: number
  readonly observation: Rc12TimingObservation
  /** Packet 15 unavailable-data behaviour: a stale feed unlatches every editorial highlight. */
  readonly timingStale: boolean
  readonly hasFeed: boolean
}

/**
 * Every RC-12 alert is silent until its trigger fires, holds for the packet's editorial lifetime and
 * then retires on its own. There is no manual clear and no always-on element: an alert whose feed
 * goes stale or disappears is unlatched immediately and the board raises the packet's TIMING DELAY
 * note instead, which is an unavailable-data state rather than a warning.
 */
export function advanceRc12Alerts(state: Rc12AlertState, input: Rc12AlertInput): Rc12AlertState {
  const now = finite(input.nowMs) ? input.nowMs : 0

  if (!input.hasFeed || input.timingStale) {
    return Object.freeze({
      fastestLap: null,
      leadChange: null,
      changes: Object.freeze([]),
      timingDelay: input.hasFeed
    })
  }

  const observation = input.observation
  const heldFastest = state.fastestLap && state.fastestLap.untilMs > now ? state.fastestLap : null
  const heldLead = state.leadChange && state.leadChange.untilMs > now ? state.leadChange : null
  const heldChanges = state.changes.filter((change) => change.untilMs > now)

  const fastestLap = observation.fastestLap
    ? Object.freeze({ ...observation.fastestLap, untilMs: now + RC12_FASTEST_LAP_HOLD_MS })
    : heldFastest

  const leadChange = observation.leadChange
    ? Object.freeze({ carIdx: observation.leadChange.carIdx, untilMs: now + RC12_LEAD_CHANGE_HOLD_MS })
    : heldLead

  const changes = observation.positionChanges.length > 0
    ? [
        ...heldChanges.filter((held) => !observation.positionChanges.some((change) => change.carIdx === held.carIdx)),
        ...observation.positionChanges.map((change) =>
          Object.freeze({ carIdx: change.carIdx, direction: change.direction, untilMs: now + RC12_POSITION_CHANGE_HOLD_MS })
        )
      ]
    : heldChanges

  return Object.freeze({
    fastestLap,
    leadChange,
    changes: Object.freeze(changes),
    timingDelay: false
  })
}

/**
 * An editorial highlight may only annotate a car that is still on the board this frame. A row that
 * leaves the field takes its highlight with it rather than leaving a tag pointing at nobody.
 */
export function clearInvalidRc12Alerts(state: Rc12AlertState, entries: readonly Rc12TimingEntry[]): Rc12AlertState {
  if (entries.length === 0) {
    return Object.freeze({ fastestLap: null, leadChange: null, changes: Object.freeze([]), timingDelay: state.timingDelay })
  }
  const known = new Set(entries.map((entry) => entry.carIdx))
  return Object.freeze({
    fastestLap: state.fastestLap && known.has(state.fastestLap.carIdx) ? state.fastestLap : null,
    leadChange: state.leadChange && known.has(state.leadChange.carIdx) ? state.leadChange : null,
    changes: Object.freeze(state.changes.filter((change) => known.has(change.carIdx))),
    timingDelay: state.timingDelay
  })
}

export function rc12AlertInputForFrame(
  observation: Rc12TimingObservation,
  buffer: Rc12TimingBuffer,
  nowMs: number
): Rc12AlertInput {
  const receipt = buffer.timingReceipt()
  return {
    nowMs,
    observation,
    hasFeed: receipt !== null,
    timingStale: receipt === null || buffer.timingAgeMs(nowMs) > RC12_TIMING_STALE_MS
  }
}

// ─────────────────────────────────────────────────────────── dashboard model

export interface Rc12Row {
  readonly rank: number
  readonly carIdx: number | null
  readonly position: Rc01Field
  readonly badge: Rc01Field
  readonly gap: Rc01Field
  readonly lastLap: Rc01Field
  readonly isPlayer: boolean
  readonly isFeatured: boolean
  readonly fastestLap: boolean
  readonly leadChange: boolean
  readonly change: 'gain' | 'loss' | null
}

export interface Rc12BattleCar {
  readonly carIdx: number | null
  readonly position: Rc01Field
  readonly badge: Rc01Field
  readonly lastLap: Rc01Field
  /** Packet 12.1 driver tags only: the channel exists but 11.1 gives it no 800x480 zone. */
  readonly gapBehind: Rc01Field
  readonly bestLap: Rc01Field
}

export interface Rc12Battle {
  readonly available: boolean
  readonly lead: Rc12BattleCar
  readonly trail: Rc12BattleCar
  readonly gap: Rc01Field
  readonly unit: string
  readonly trend: Rc12BattleTrend
  readonly trendToken: Rc12Token
  readonly trendGlyph: string
  readonly trendLabel: string
}

export interface Rc12SessionClock {
  readonly time: Rc01Field
  readonly lapsDone: Rc01Field
  readonly lapsTotal: Rc01Field
}

export interface Rc12Tag {
  readonly showing: boolean
  readonly label: string
  readonly position: string
  readonly lapTime: string
}

export interface Rc12HistoryPoint {
  readonly x: number
  readonly y: number
}

export interface Rc12DashboardModel {
  readonly rows: readonly Rc12Row[]
  readonly rowCount: number
  readonly fieldSize: number
  readonly battle: Rc12Battle
  readonly sessionClock: Rc12SessionClock
  readonly tag: Rc12Tag
  readonly leadTag: Rc12Tag
  readonly timingDelay: boolean
  readonly hasFeed: boolean
  readonly history: readonly Rc12HistoryPoint[]
  readonly measuredGapCount: number
}

export interface Rc12ModelOptions {
  readonly rowCount?: number
  readonly alerts?: Rc12AlertState
  readonly history?: readonly Rc12GapSample[]
  readonly timingStale?: boolean
  readonly includeAppOnly?: boolean
}

function emptyBattleCar(): Rc12BattleCar {
  return {
    carIdx: null,
    position: unavailableField(RC12_DASH.position),
    badge: unavailableField(RC12_DASH.badge),
    lastLap: unavailableField(RC12_DASH.lapTime),
    gapBehind: unavailableField(RC12_DASH.gap),
    bestLap: unavailableField(RC12_DASH.lapTime)
  }
}

function emptyBattle(): Rc12Battle {
  return {
    available: false,
    lead: emptyBattleCar(),
    trail: emptyBattleCar(),
    gap: unavailableField(RC12_DASH.gap),
    unit: RC12_GAP_UNIT,
    trend: 'unknown',
    trendToken: RC12_TREND_TOKENS.unknown,
    trendGlyph: RC12_TREND_GLYPHS.unknown,
    trendLabel: 'NO TREND'
  }
}

const TREND_LABELS: Readonly<Record<Rc12BattleTrend, string>> = Object.freeze({
  closing: 'CLOSING',
  opening: 'OPENING',
  holding: 'HOLDING',
  unknown: 'NO TREND'
})

/**
 * Packet 11.1's ranked rows, always exactly `rowCount` of them so the positional axis cannot
 * collapse when the field is short. A rank with no entrant renders the complete dash row: the SOP's
 * honest empty state, never a plausible fake entrant.
 */
function buildRows(
  entries: readonly Rc12TimingEntry[],
  measured: ReadonlyMap<number, number>,
  alerts: Rc12AlertState,
  pair: Rc12FeaturedPair | null,
  rowCount: number,
  stale: boolean
): readonly Rc12Row[] {
  const tone: Rc01FieldTone = stale ? 'muted' : 'primary'
  return Object.freeze(
    Array.from({ length: rowCount }, (_unused, index) => {
      const entry = entries[index]
      if (!entry) {
        return Object.freeze({
          rank: index + 1,
          carIdx: null,
          position: unavailableField(RC12_DASH.position),
          badge: unavailableField(RC12_DASH.badge),
          gap: unavailableField(RC12_DASH.gap),
          lastLap: unavailableField(RC12_DASH.lapTime),
          isPlayer: false,
          isFeatured: false,
          fastestLap: false,
          leadChange: false,
          change: null
        })
      }

      // Packet 16 extended per the governance chain: the leader has no car ahead, so its gap is not
      // "missing", it is UNDEFINED. The packet dash is used rather than a fabricated 0.0.
      const gapSec = entry.position === 1 ? undefined : measured.get(entry.carIdx)
      const gap =
        gapSec === undefined
          ? unavailableField(RC12_DASH.gap)
          : field(rc12FormatGapSeconds(gapSec), gapSec, stale, false, tone)

      const lastLap =
        entry.lastLapSec === null
          ? unavailableField(RC12_DASH.lapTime)
          : field(rc12FormatLapTime(entry.lastLapSec), entry.lastLapSec, stale, false, tone)

      const change = alerts.changes.find((candidate) => candidate.carIdx === entry.carIdx) ?? null

      return Object.freeze({
        rank: index + 1,
        carIdx: entry.carIdx,
        position: field(rc12FormatPosition(entry.position), entry.position, stale, false, tone),
        // No entrant-identity channel exists: the badge is structural and always the placeholder.
        badge: unavailableField(RC12_DASH.badge),
        gap,
        lastLap,
        isPlayer: entry.isPlayer,
        isFeatured: pair !== null && (pair.leadCarIdx === entry.carIdx || pair.trailCarIdx === entry.carIdx),
        fastestLap: alerts.fastestLap?.carIdx === entry.carIdx,
        leadChange: alerts.leadChange?.carIdx === entry.carIdx,
        change: change ? change.direction : null
      })
    })
  )
}

function battleCar(
  entry: Rc12TimingEntry | undefined,
  gapBehindSec: number | undefined,
  includeAppOnly: boolean,
  stale: boolean
): Rc12BattleCar {
  if (!entry) return emptyBattleCar()
  const tone: Rc01FieldTone = stale ? 'muted' : 'primary'
  return {
    carIdx: entry.carIdx,
    position: field(rc12FormatPosition(entry.position), entry.position, stale, false, tone),
    badge: unavailableField(RC12_DASH.badge),
    lastLap:
      entry.lastLapSec === null
        ? unavailableField(RC12_DASH.lapTime)
        : field(rc12FormatLapTime(entry.lastLapSec), entry.lastLapSec, stale, false, tone),
    // Packet 11.1 gives Gap behind and Best lap no 800x480 zone; 12.1's driver tags are their only
    // surface, so at 800x480 they are not merely dashed, they are not part of the model's payload.
    gapBehind:
      includeAppOnly && gapBehindSec !== undefined
        ? field(rc12FormatGapSeconds(gapBehindSec), gapBehindSec, stale, false, tone)
        : unavailableField(RC12_DASH.gap),
    bestLap:
      includeAppOnly && entry.bestLapSec !== null
        ? field(rc12FormatLapTime(entry.bestLapSec), entry.bestLapSec, stale, false, tone)
        : unavailableField(RC12_DASH.lapTime)
  }
}

/** The app-only gap-history polyline, in 0..100 plot coordinates. Observed samples only. */
function buildHistory(history: readonly Rc12GapSample[], pair: Rc12FeaturedPair | null): readonly Rc12HistoryPoint[] {
  if (!pair) return Object.freeze([])
  const key = rc12PairKey(pair)
  const samples = history.filter((sample) => sample.pairKey === key)
  if (samples.length < 2) return Object.freeze([])
  const values = samples.map((sample) => sample.gapSec)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min
  return Object.freeze(
    samples.map((sample, index) =>
      Object.freeze({
        x: round3((index / (samples.length - 1)) * 100),
        // A larger gap is drawn higher, so a falling line reads as a closing battle.
        y: round3(span <= 0 ? 50 : 100 - ((sample.gapSec - min) / span) * 100)
      })
    )
  )
}

export function createRc12DashboardModel(
  snapshot: TelemetrySnapshot | null,
  buffer: Rc12TimingBuffer | null,
  nowMs = rc01MonotonicNow(),
  options: Rc12ModelOptions = {}
): Rc12DashboardModel {
  const alerts = options.alerts ?? createRc12AlertState()
  const rowCount = options.rowCount ?? RC12_NATIVE_ROW_COUNT
  const includeAppOnly = options.includeAppOnly === true
  const entries = rc12TimingEntries(snapshot)
  const hasFeed = entries.length > 0
  const stale = options.timingStale === true || alerts.timingDelay
  const measured = rc12MeasuredGapAheadByCar(snapshot, entries)
  const pair = rc12FeaturedPair(snapshot, entries, measured)
  const history = options.history ?? buffer?.history() ?? []

  const battle = ((): Rc12Battle => {
    if (!pair) return emptyBattle()
    const lead = entries.find((entry) => entry.carIdx === pair.leadCarIdx)
    const trail = entries.find((entry) => entry.carIdx === pair.trailCarIdx)
    const trend = rc12TrendForHistory(history, pair, nowMs)
    return {
      available: true,
      // The leading car's Gap behind is the SAME measured interval as the trailing car's Gap ahead.
      // It is published once, on the trailing car, and never mirrored into a second numeric field.
      lead: battleCar(lead, pair.gapSec, includeAppOnly, stale),
      trail: battleCar(trail, undefined, includeAppOnly, stale),
      gap: field(rc12FormatGapSeconds(pair.gapSec), pair.gapSec, stale, false, stale ? 'muted' : 'primary'),
      unit: RC12_GAP_UNIT,
      trend,
      trendToken: RC12_TREND_TOKENS[trend],
      trendGlyph: RC12_TREND_GLYPHS[trend],
      trendLabel: TREND_LABELS[trend]
    }
  })()

  const tag: Rc12Tag = alerts.fastestLap
    ? {
        showing: true,
        label: RC12_FASTEST_LAP_LABEL,
        position: rc12FormatPosition(alerts.fastestLap.position),
        lapTime: rc12FormatLapTime(alerts.fastestLap.lapSec)
      }
    : { showing: false, label: RC12_FASTEST_LAP_LABEL, position: '', lapTime: '' }

  const leadTag: Rc12Tag = alerts.leadChange
    ? { showing: true, label: RC12_LEAD_CHANGE_LABEL, position: rc12FormatPosition(1), lapTime: '' }
    : { showing: false, label: RC12_LEAD_CHANGE_LABEL, position: '', lapTime: '' }

  return {
    rows: buildRows(entries, measured, alerts, pair, rowCount, stale),
    rowCount,
    fieldSize: entries.length,
    battle,
    // RC12_PACKET_OMISSIONS.sessionClockChannel: no session-time and no lap-count channel exist in
    // packet 16, so the ribbon publishes its dash forever and reads nothing off the snapshot.
    sessionClock: {
      time: unavailableField(RC12_DASH.sessionTime),
      lapsDone: unavailableField(RC12_DASH.lapCounter),
      lapsTotal: unavailableField(RC12_DASH.lapCounter)
    },
    tag,
    leadTag,
    timingDelay: alerts.timingDelay || (hasFeed && stale),
    hasFeed,
    history: includeAppOnly ? buildHistory(history, pair) : Object.freeze([]),
    measuredGapCount: measured.size
  }
}

// ─────────────────────────────────────────────────────────── accessible names

/** Packet 19: every state is described in words, never by hue. */
export function rc12RowDescription(row: Rc12Row): string {
  const parts = [
    `Rank ${row.rank}`,
    `position ${row.position.unavailable ? 'unavailable' : row.position.value}`,
    `gap ahead ${row.gap.unavailable ? 'unavailable' : `${row.gap.value} seconds`}`,
    `last lap ${row.lastLap.unavailable ? 'unavailable' : row.lastLap.value}`
  ]
  if (row.fastestLap) parts.push('session fastest lap')
  if (row.leadChange) parts.push('lead change')
  if (row.change) parts.push(row.change === 'gain' ? 'gained a position' : 'lost a position')
  if (row.position.stale) parts.push('timing delayed')
  return `${parts.join(', ')}.`
}

export function rc12BattleDescription(battle: Rc12Battle): string {
  if (!battle.available) return `Featured battle unavailable, ${RC12_NO_BATTLE_LABEL}.`
  return `Featured battle, ${battle.lead.position.value} ahead of ${battle.trail.position.value}, gap ${battle.gap.value} seconds, ${battle.trendLabel.toLowerCase()}.`
}

export function rc12PercentOfRow(rank: number, rowCount: number): number {
  if (!finite(rank) || !finite(rowCount) || rowCount <= 0) return 0
  return round3((clamp(rank - 1, 0, rowCount - 1) / rowCount) * 100)
}

export function rc12RowHeightPercent(rowCount: number): number {
  if (!finite(rowCount) || rowCount <= 0) return 100
  return round3(100 / rowCount)
}

/** The measured gap value at one decimal, for the suite's arithmetic assertions. */
export function rc12RoundGap(seconds: number): number {
  return round1(seconds)
}
