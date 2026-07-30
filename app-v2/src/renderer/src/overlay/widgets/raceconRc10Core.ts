import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import {
  type Rc01AlertState,
  type Rc01ChannelName,
  type Rc01ChannelReceipt,
  type Rc01DashboardModel,
  type Rc01Field,
  createRc01DashboardModel,
  rc01MonotonicNow,
  rc01ReceiptAgeMs
} from './raceconRc01Core'

/**
 * RC-10 "Clear Sight — High-Contrast Color-Vision-Safe Driver Display" core.
 *
 * The live-only ingest buffer, identity binding, mock/replay refusal, out-of-order and
 * same-timestamp guards and the shared channel receipts are reused verbatim from the RC-01 core:
 * that is telemetry-truth machinery, not RC-01 styling, and a fork would silently drift.
 *
 * The over-rev alert is likewise NOT re-implemented. Packet section 15 asks for `rpm > 99 %` with a
 * 60 ms debounce clearing below 95 % after 250 ms, and `advanceRc01Alerts` already implements
 * exactly those four numbers, so RC-10 drives the shared alert layer instead of duplicating it.
 * Engine RPM is the shared `rpm` channel, whose 200 ms budget IS packet 16's verbatim "freeze value
 * + gray tint when stale > 200 ms". The lap delta is the shared `delta` channel, which already
 * refuses to publish without a stored reference lap — packet 16's "never show a delta without a
 * real reference lap".
 *
 * This module adds only what is genuinely RC-10's: the accessibility contract. The four-rank
 * shape ladder, the arithmetic nine-segment shift bar, the six-segment fuel bar that must agree
 * with its own numeral, the contrast arithmetic behind the >= 10:1 floor, the colour-blind
 * fingerprint that proves no state is carried by hue alone, and the fuel-low / overheat alerts the
 * shared layer does not have.
 *
 * Five packet contradictions are resolved by omission and each one is asserted by the test suite
 * through `RC10_PACKET_OMISSIONS`, so a later edit cannot quietly reintroduce them.
 */

// ─────────────────────────────────────────────────────────── canvas + breakpoints

/** Packet section 11.1 native canvas, and the section 12.1 app reflow target. */
export const RC10_NATIVE_WIDTH_PX = 800
export const RC10_NATIVE_HEIGHT_PX = 480
export const RC10_NATIVE_TOLERANCE_PX = 1
export const RC10_APP_WIDTH_PX = 1024
export const RC10_APP_HEIGHT_PX = 600

export const RC10_PHONE_MIN_WIDTH_PX = 360
export const RC10_PHONE_MAX_WIDTH_PX = 480
export const RC10_PHONE_MIN_HEIGHT_PX = 650
export const RC10_LANDSCAPE_MIN_WIDTH_PX = 650
export const RC10_LANDSCAPE_MIN_HEIGHT_PX = 360
export const RC10_LANDSCAPE_MAX_HEIGHT_PX = 480

export type Rc10CompactMode = 'phone' | 'landscape' | 'standard'
export type Rc10Layout = 'native' | 'app' | 'compact'

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function round3(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

// ─────────────────────────────────────────────────────────── packet omissions

/**
 * The packet requirements this build deliberately does NOT render, with the reason. Each key is
 * asserted by the suite: the omission is part of the contract, not an oversight.
 *
 *  - `tyreTemperature`  gap G3. Section 10 lists Tire temperature per corner as tertiary and
 *                       section 16 defines its channel, source, unit, staleness and never-mirror
 *                       rule, but section 11.1 gives it NO 800x480 zone and section 12.1 adds none
 *                       at 1024x600. Per the tertiary-field rule it is omitted from the model
 *                       rather than surfaced or proxied: there is no tyre entry in
 *                       `RC10_CHANNEL_STALE_MS`, no tyre field on the model and no tyre element in
 *                       the widget or the stylesheet. RESOLUTION REQUESTED FROM THE PACKET OWNER:
 *                       add a zone at both resolutions, or move it out of section 10.
 *  - `rpmNumeral`       section 16 defines the Engine RPM channel with a 20 ms cadence and a
 *                       200 ms freeze-and-gray rule, but section 11.1 defines no numeric zone for
 *                       it. RPM is therefore expressed ONLY through the shift bar; no RPM numeral
 *                       and no RPM zone marker is drawn anywhere at any breakpoint.
 *  - `alertGlyphsWhileNormal` gap G4. The section 17 source prompt asks the status row to use
 *                       "icon shapes (triangle/octagon) plus words", but section 15 binds the
 *                       triangle to Fuel low and the octagon to Overheat while section 14 requires
 *                       NEUTRAL icons in the Normal state. Drawing either glyph in a silent frame
 *                       would use the alert layer as always-on decoration, which the packet's own
 *                       QA checklist forbids. Both glyphs are therefore omitted while normal, and
 *                       the undocumented neutral rank is supplied here as `RC10_STATUS_LADDER`.
 *  - `singleColumnStack` gap G2. Sections 6, 7 and 17 call the layout a single-column stack while
 *                       the section 11.1 rectangles describe a three-row grid of two tiles, two
 *                       tiles and one full-width row. The coordinates are normative and the
 *                       single-column reading is omitted. RESOLUTION REQUESTED: fix the prose.
 *  - `appStatusRowZone` gap G1. Section 12.1 lists only gear, speed, delta, fuel and the new
 *                       plain-language line, and defines NO 1024x600 zone for Position, Water
 *                       temperature or TC — three channels that section 11.1 does surface. The
 *                       800x480 status ROW is therefore omitted at 1024x600, and all three
 *                       channels are carried explicitly by the plain-language line instead
 *                       (`RC10_APP_STATUS_CARRIAGE`), so the wider canvas never silently drops a
 *                       channel the narrow one shows.
 *  - `gearAwareShiftScaling` section 16 calls the Shift indicator "gear-aware", but the normative
 *                       override pins eight ABSOLUTE ramp thresholds at 50-85 % of `maxRpm` plus a
 *                       cap above 99 % and requires the lit count to be
 *                       `count(threshold <= rpm / maxRpm)`. The absolute table wins; no gear
 *                       dependent rescaling is applied, and `buildRc10ShiftSegments` is proven
 *                       gear-invariant by the suite.
 */
export const RC10_PACKET_OMISSIONS = Object.freeze({
  tyreTemperature:
    'packet 10/16 tyre temperature: sections 11.1 and 12.1 allocate the channel no zone in either grammar, so it is never drawn and never fabricated',
  rpmNumeral:
    'packet 16 engine RPM: section 11.1 defines no numeric zone, so RPM is expressed only through the shift bar and no numeral is printed',
  alertGlyphsWhileNormal:
    'packet 17 triangle/octagon versus packet 14/15: the alert glyphs are omitted while normal, and the undocumented neutral rank is supplied as the hollow ring / solid circle ladder',
  singleColumnStack:
    'packet 6/7/17 single-column prose versus the packet 11.1 rectangles: the coordinates are normative and the single-column reading is omitted',
  appStatusRowZone:
    'packet 12.1 defines no 1024x600 zone for position, water or TC: the 800x480 status row is omitted at app size and all three channels are carried by the plain-language line',
  gearAwareShiftScaling:
    'packet 16 calls the shift indicator gear-aware while the normative override pins eight absolute thresholds: the absolute table wins and no gear rescaling is applied'
})

/**
 * Gap G1's resolution, expressed as data so the suite can MEASURE it rather than trust a comment.
 * Every channel the 800x480 status row surfaces must still be reachable on the wider canvas.
 */
export const RC10_APP_STATUS_CARRIAGE = Object.freeze(['position', 'water', 'tc'] as const)

// ─────────────────────────────────────────────────────────── tokens + contrast

/** Packet 11.3 tokens, verbatim. Normative override N4: never the render's drifted values. */
export const RC10_TOKENS = Object.freeze({
  bg: '#000000',
  panel: '#0B0B0B',
  primary: '#FFFFFF',
  secondary: '#DDDDDD',
  info: '#56B4E9',
  normal: '#009E73',
  caution: '#E69F00',
  danger: '#D55E00',
  signature: '#F0E442'
})

export type Rc10Token = keyof typeof RC10_TOKENS

/**
 * The ONLY tokens ever bound to a text surface. Packet section 19 requires >= 10:1 on the
 * primaries, and `caution` (8.74:1) and `danger` (5.11:1) do not clear that floor against the
 * panel token — so an alert's WORD is drawn in `primary` at 19.68:1 and the alert hue lives in the
 * icon glyph and the pattern, which are non-text graphics judged against the 3:1 graphic floor.
 * That is strictly more faithful to this artifact's thesis than tinting the word: the driver this
 * display exists for reads the word, and the word must be the highest-contrast thing on screen.
 */
export const RC10_TEXT_TOKENS = Object.freeze(['primary', 'secondary'] as const)

/** Packet section 19's floor for anything carrying text. */
export const RC10_MIN_TEXT_CONTRAST = 10
/** The non-text floor for icon fills, bar segments and pattern strokes. */
export const RC10_MIN_GRAPHIC_CONTRAST = 3

function channelLinear(channel: number): number {
  const srgb = channel / 255
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
}

export function rc10ParseHex(hex: string): readonly [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const value = match[1]
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16)
  ] as const
}

/** WCAG relative luminance, so the >= 10:1 claim is arithmetic rather than an assertion. */
export function rc10RelativeLuminance(hex: string): number | null {
  const rgb = rc10ParseHex(hex)
  if (!rgb) return null
  const [r, g, b] = rgb
  return 0.2126 * channelLinear(r) + 0.7152 * channelLinear(g) + 0.0722 * channelLinear(b)
}

/** The WCAG contrast ratio between two opaque tokens, rounded to two places. */
export function rc10ContrastRatio(foreground: string, background: string): number | null {
  const a = rc10RelativeLuminance(foreground)
  const b = rc10RelativeLuminance(background)
  if (a === null || b === null) return null
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100
}

/** Every surface a token may sit on. Both are pure greys, so contrast is the whole separation. */
export const RC10_SURFACE_TOKENS = Object.freeze(['bg', 'panel'] as const)

/** The reference frame's measured primary contrast, recorded so a regression is visible. */
export const RC10_REFERENCE_PRIMARY_CONTRAST = 18.53

// ─────────────────────────────────────────────────────────── status shape ladder

export type Rc10StatusRank = 'none' | 'normal' | 'caution' | 'critical'
export type Rc10StatusShape = 'ring' | 'circle' | 'triangle' | 'octagon'

export interface Rc10StatusRung {
  rank: Rc10StatusRank
  /** The shape sequence FIRST; the colour sequence second. */
  shape: Rc10StatusShape
  filled: boolean
  token: Rc10Token
  /** The word that accompanies the glyph, so the rank is never carried by shape alone either. */
  word: string
}

/**
 * The severity ladder, and the single most important object in this module. Packet gap G4 leaves
 * the neutral rank undocumented — section 17 asks for triangle/octagon, section 15 binds both to
 * alerts and section 14 forbids them while normal — so the hollow ring (no data) and the solid
 * circle (normal) are supplied here and the ladder is complete.
 *
 * Every rung differs from every other rung in SHAPE, in FILL-or-shape, in TOKEN and in WORD. A
 * driver with any colour-vision deficiency reads the rank from the outline alone.
 */
export const RC10_STATUS_LADDER: readonly Rc10StatusRung[] = Object.freeze([
  Object.freeze({ rank: 'none' as const, shape: 'ring' as const, filled: false, token: 'secondary' as const, word: 'NO DATA' }),
  Object.freeze({ rank: 'normal' as const, shape: 'circle' as const, filled: true, token: 'normal' as const, word: 'OK' }),
  Object.freeze({ rank: 'caution' as const, shape: 'triangle' as const, filled: true, token: 'caution' as const, word: 'CAUTION' }),
  Object.freeze({ rank: 'critical' as const, shape: 'octagon' as const, filled: true, token: 'danger' as const, word: 'CRITICAL' })
])

export function rc10StatusRung(rank: Rc10StatusRank): Rc10StatusRung {
  return RC10_STATUS_LADDER.find((rung) => rung.rank === rank) ?? RC10_STATUS_LADDER[0]
}

/**
 * A channel's neutral rank: solid circle when it is genuinely reporting, hollow ring when it is
 * not. Normative override N5: unavailability is carried by token RANK and GLYPH, never by dimming
 * a value below the contrast floor.
 */
export function rc10AvailabilityRank(field: Rc01Field): Rc10StatusRank {
  return field.unavailable ? 'none' : 'normal'
}

// ─────────────────────────────────────────────────────────── channels

/**
 * Packet section 16 freshness budgets for the channels the shared RC-01 layer does not already
 * carry with RC-10's own budget. Gear 50 ms, speed 100 ms and water 500 ms are verbatim. Fuel laps
 * remaining is declared "per lap", which is a TRANSPORT budget — the fuel model republishes on
 * every frame — so `RC01_MIN_STREAM_FRESH_MS`-class slack is not enough and the value simply
 * follows its own source.
 *
 * `rpm` (200 ms), `delta` (250 ms, refused outright without a stored best lap), `position` (1 s)
 * and `tc` (1 s, holding last-known greyed on a quiet bus) are NOT here: all four come from the
 * shared RC-01 model, whose budgets and semantics already ARE this packet's. There is deliberately
 * no tyre entry (`RC10_PACKET_OMISSIONS.tyreTemperature`).
 */
export const RC10_CHANNEL_STALE_MS = {
  gear: 50,
  speed: 100,
  fuelLaps: 1_000,
  water: 500
} as const

export type Rc10AuxChannel = keyof typeof RC10_CHANNEL_STALE_MS

/**
 * Packet section 16: speed greys as soon as it misses its 100 ms cadence but only collapses to the
 * three-character dash once the source has been quiet for more than 500 ms.
 */
export const RC10_SPEED_DASH_MS = 500

/** Packet 16 dash states, verbatim, so the widget and the suite cannot drift from the table. */
export const RC10_DASH = Object.freeze({
  gear: '-',
  speed: '---',
  delta: '--.---',
  fuel: '--',
  position: '--',
  water: '--',
  tc: '--'
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
 * `fuelPerLapLiters` is the app's OBSERVED burn rate — the FuelLevel delta averaged across
 * completed laps — which is exactly packet section 16's "computed fuel model". The deprecated
 * ambiguous `fuelPerLap` and the kilogram channels are deliberately NOT accepted: a unit-converted
 * mass would be an estimate. Without a positive measured burn rate there is no projection at all,
 * which is packet 16's "never project laps before a measured burn rate exists" implemented rather
 * than merely quoted.
 */
export function rc10FuelLapsRemaining(snapshot: TelemetrySnapshot): number | null {
  const burn = snapshot.fuelPerLapLiters
  const litres = snapshot.fuelLiters
  if (!finite(burn) || burn <= 0 || !finite(litres) || litres < 0) return null
  const provided = snapshot.fuelLapsRemaining
  if (finite(provided) && provided >= 0) return provided
  return litres / burn
}

/**
 * Every RC-10 aux channel is read straight from its own declared source. Nothing is modelled,
 * mirrored or substituted: the gear never comes from RPM or speed, the speed never from RPM times
 * a ratio, the coolant temperature strictly from its own sensor, and the fuel projection only from
 * a measured burn rate.
 */
export function rc10AuxChannelValue(
  snapshot: TelemetrySnapshot,
  channel: Rc10AuxChannel
): number | string | null {
  switch (channel) {
    case 'gear':
      return finite(snapshot.gear) && Number.isInteger(snapshot.gear) ? snapshot.gear : null
    case 'speed':
      return finite(snapshot.speedKmh) && snapshot.speedKmh >= 0 ? snapshot.speedKmh : null
    case 'fuelLaps':
      return rc10FuelLapsRemaining(snapshot)
    case 'water':
      return finite(snapshot.waterTempC) ? snapshot.waterTempC : null
  }
  return null
}

/**
 * `RC10_PACKET_OMISSIONS.tyreTemperature`, expressed as a function so the absence is MEASURED by
 * the suite rather than asserted about a comment. Sections 11.1 and 12.1 give tyre temperature no
 * zone at either resolution, so it returns null for every snapshot and every corner.
 */
export function rc10TyreTemperatureC(
  _snapshot: TelemetrySnapshot | null,
  _corner: 'lf' | 'rf' | 'lr' | 'rr'
): number | null {
  return null
}

/** Packet 16: 'N' or the grey '-'; a gear is never blanked silently and never comes from RPM. */
export function rc10DisplayGear(gear: number | null): string {
  if (gear === null || !finite(gear)) return RC10_DASH.gear
  if (gear < 0) return 'R'
  if (gear === 0) return 'N'
  return String(Math.trunc(gear))
}

/** Packet 16/19: the sign is a literal character, so the delta is never carried by hue alone. */
export function rc10FormatDelta(seconds: number | null): string {
  if (!finite(seconds)) return RC10_DASH.delta
  return `${seconds >= 0 ? '+' : '-'}${Math.abs(seconds).toFixed(3)}`
}

/** Packet 16: laps remaining at the fuel model's own resolution. Never rounded up into optimism. */
export function rc10FormatFuelLaps(laps: number | null): string {
  if (!finite(laps) || laps < 0) return RC10_DASH.fuel
  // The projection is settled to three places first, so binary-float residue from `litres / burn`
  // cannot print 8.3 for a tank the model actually measures at 8.4; the truncation to a tenth then
  // guarantees the readout never over-states the fuel that is genuinely left.
  const settled = Math.round(laps * 1_000) / 1_000
  return (Math.floor(settled * 10) / 10).toFixed(1)
}

// ─────────────────────────────────────────────────────────── shift bar

/**
 * Normative override N1. The approved reference renders EIGHT segments; the census across six
 * generations came out 10, 8, 9, 9, 8, 10 and never stabilised, so the count is data-driven here
 * and the picture is never traced. Eight ramp thresholds plus one over-rev cap is nine.
 */
export const RC10_SHIFT_RAMP_THRESHOLDS: readonly number[] = Object.freeze([
  0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85
])
export const RC10_SHIFT_RAMP_COUNT = RC10_SHIFT_RAMP_THRESHOLDS.length
export const RC10_SHIFT_OVER_REV_THRESHOLD = 0.99
export const RC10_SHIFT_SEGMENT_COUNT = RC10_SHIFT_RAMP_COUNT + 1
/** Packet 11.3: ramp steps 1-3 are `info`, steps 4-8 are `normal`. The cap is `danger`, alert-only. */
export const RC10_SHIFT_INFO_SEGMENTS = 3

export type Rc10ShiftKind = 'ramp' | 'cap'
export type Rc10ShiftPattern = 'striped' | 'solid' | 'none'
export type Rc10ShiftTone = 'dark' | 'info' | 'normal' | 'danger'

export interface Rc10ShiftSegment {
  index: number
  kind: Rc10ShiftKind
  active: boolean
  tone: Rc10ShiftTone
  /** Packet 11.4: state is readable by pattern and segment count without red-green perception. */
  pattern: Rc10ShiftPattern
  /** The fraction of maxRpm this segment lights at; null for the cap's alert-driven segment. */
  threshold: number | null
}

/** Packet 16 / normative override N1: `lit = count(rampThreshold[k] <= rpm / maxRpm)`. */
export function rc10ShiftLitRampCount(rpmRatio: number | null, rpmFresh = true): number {
  if (!rpmFresh || !finite(rpmRatio) || rpmRatio < 0) return 0
  return RC10_SHIFT_RAMP_THRESHOLDS.filter((threshold) => threshold <= rpmRatio).length
}

/**
 * The nine-segment bar. It is DARK whenever the RPM channel is invalid or stale — packet 16's
 * "LED arc dark if RPM invalid" and packet 15's "shift bar blank if RPM stale" — and the cap
 * segment lights only while the debounced over-rev alert is genuinely latched, so no element of
 * the alert layer is ever an always-on decoration.
 *
 * There is deliberately no gear term: see `RC10_PACKET_OMISSIONS.gearAwareShiftScaling`.
 */
export function buildRc10ShiftSegments(
  rpmRatio: number | null,
  rpmFresh: boolean,
  overRevActive = false
): readonly Rc10ShiftSegment[] {
  const lit = rc10ShiftLitRampCount(rpmRatio, rpmFresh)
  const ramp = RC10_SHIFT_RAMP_THRESHOLDS.map((threshold, index) => {
    const active = index < lit
    return {
      index,
      kind: 'ramp' as const,
      active,
      tone: active ? (index < RC10_SHIFT_INFO_SEGMENTS ? ('info' as const) : ('normal' as const)) : ('dark' as const),
      pattern: active ? ('striped' as const) : ('none' as const),
      threshold
    }
  })
  const capActive = rpmFresh && overRevActive
  return Object.freeze([
    ...ramp,
    Object.freeze({
      index: RC10_SHIFT_RAMP_COUNT,
      kind: 'cap' as const,
      active: capActive,
      tone: capActive ? ('danger' as const) : ('dark' as const),
      // The cap is the one SOLID segment, so it is separable from the striped ramp by fill alone.
      pattern: capActive ? ('solid' as const) : ('none' as const),
      threshold: null
    })
  ])
}

// ─────────────────────────────────────────────────────────── fuel bar

/** Packet 16 derived geometry: 6 segments, 12.0 laps full scale, 2.0 laps per segment. */
export const RC10_FUEL_SEGMENT_COUNT = 6
export const RC10_FUEL_FULL_SCALE_LAPS = 12
export const RC10_FUEL_LAPS_PER_SEGMENT =
  RC10_FUEL_FULL_SCALE_LAPS / RC10_FUEL_SEGMENT_COUNT

/**
 * Normative override N5, and the defect that got attempt-004 rejected: the bar must AGREE with the
 * numeral printed beside it. `lit = floor(laps / 2.0)`, clamped to the bar, and zero whenever
 * there is no measured burn rate at all.
 */
export function rc10FuelLitSegments(lapsRemaining: number | null): number {
  if (!finite(lapsRemaining) || lapsRemaining < 0) return 0
  return Math.max(0, Math.min(RC10_FUEL_SEGMENT_COUNT, Math.floor(lapsRemaining / RC10_FUEL_LAPS_PER_SEGMENT)))
}

export interface Rc10FuelSegment {
  index: number
  active: boolean
  /** The lap count this segment represents, so the bar is a quantity and not a decoration. */
  fromLaps: number
  toLaps: number
}

export function buildRc10FuelSegments(lapsRemaining: number | null): readonly Rc10FuelSegment[] {
  const lit = rc10FuelLitSegments(lapsRemaining)
  return Object.freeze(
    Array.from({ length: RC10_FUEL_SEGMENT_COUNT }, (_unused, index) =>
      Object.freeze({
        index,
        active: index < lit,
        fromLaps: round1(index * RC10_FUEL_LAPS_PER_SEGMENT),
        toLaps: round1((index + 1) * RC10_FUEL_LAPS_PER_SEGMENT)
      })
    )
  )
}

// ─────────────────────────────────────────────────────────── delta cue

export type Rc10DeltaDirection = 'faster' | 'slower' | 'level' | 'none'
export type Rc10DeltaPattern = 'hatch' | 'dotted' | 'flat' | 'none'
export type Rc10DeltaChevron = 'down' | 'up' | 'level' | 'none'

export interface Rc10DeltaCue {
  direction: Rc10DeltaDirection
  /** The literal character in the value string. Never inferred from the hue. */
  sign: '+' | '-' | ''
  chevron: Rc10DeltaChevron
  /** Packet 11.3: diagonal hatch = faster, dotted = slower. A third, independent cue. */
  pattern: Rc10DeltaPattern
}

/**
 * Packet 19's redundancy rule for the lap delta: explicit sign, plus an up/down chevron, plus a
 * fill pattern, plus a hue. Three of those four survive total colour blindness.
 */
export function rc10DeltaCue(seconds: number | null, available: boolean): Rc10DeltaCue {
  if (!available || !finite(seconds)) {
    return { direction: 'none', sign: '', chevron: 'none', pattern: 'none' }
  }
  if (seconds < 0) return { direction: 'faster', sign: '-', chevron: 'down', pattern: 'hatch' }
  if (seconds > 0) return { direction: 'slower', sign: '+', chevron: 'up', pattern: 'dotted' }
  return { direction: 'level', sign: '+', chevron: 'level', pattern: 'flat' }
}

// ─────────────────────────────────────────────────────────── zones

export interface Rc10Rect {
  left: number
  top: number
  width: number
  height: number
}

export type Rc10ZoneId = 'gear' | 'speed' | 'delta' | 'fuel' | 'status' | 'plain'

export type Rc10ZoneMap = Readonly<Partial<Record<Rc10ZoneId, Rc10Rect>>>

/**
 * Packet 11.1's zones for the 800x480 native canvas, verbatim. Normative override N3 is explicit:
 * the approved render drifts +4.9 / -4.7 / -7.9 / +7.6 pp on the tile widths and puts the row-two
 * split at 59.5 % instead of 67.5 %, so the render's pixels are never traced.
 */
export const RC10_NATIVE_ZONES: Rc10ZoneMap = Object.freeze({
  gear: Object.freeze({ left: 2.0, top: 3.3, width: 47.5, height: 45.8 }),
  speed: Object.freeze({ left: 51.5, top: 3.3, width: 46.5, height: 45.8 }),
  delta: Object.freeze({ left: 2.0, top: 52.5, width: 63.8, height: 25.0 }),
  fuel: Object.freeze({ left: 67.5, top: 52.5, width: 30.5, height: 25.0 }),
  status: Object.freeze({ left: 2.0, top: 80.8, width: 96.0, height: 15.8 })
})

/**
 * Packet 12.1's `legibility-grow-reveal`. The width buys BIGGER TILES and one plain-language
 * status sentence — never more elements, never a denser grid, never a new channel. The 800x480
 * status row has no 12.1 zone (gap G1), so the plain-language line carries position, water and TC
 * as well as the sentence: the same five surfaces, none dropped.
 */
export const RC10_APP_ZONES: Rc10ZoneMap = Object.freeze({
  gear: Object.freeze({ left: 2.3, top: 4.0, width: 46.9, height: 43.3 }),
  speed: Object.freeze({ left: 51.6, top: 4.0, width: 46.1, height: 43.3 }),
  delta: Object.freeze({ left: 2.3, top: 50.0, width: 58.6, height: 25.0 }),
  fuel: Object.freeze({ left: 63.3, top: 50.0, width: 34.4, height: 25.0 }),
  plain: Object.freeze({ left: 2.3, top: 77.7, width: 95.3, height: 18.3 })
})

/**
 * Compact breakpoints are not packet-specified. They keep the three-row grammar and the delta-over
 * fuel asymmetry, and drop only the app-only plain-language line — so the gear tile, the shift bar
 * inside it, the fuel bar and the status strip, and therefore ALL THREE alert surfaces, stay
 * visible at every size.
 */
function rc10CompactZones(mode: Rc10CompactMode): Rc10ZoneMap {
  if (mode === 'phone') {
    return Object.freeze({
      gear: Object.freeze({ left: 2, top: 2, width: 96, height: 26 }),
      speed: Object.freeze({ left: 2, top: 30, width: 96, height: 22 }),
      delta: Object.freeze({ left: 2, top: 54, width: 96, height: 16 }),
      fuel: Object.freeze({ left: 2, top: 72, width: 96, height: 13 }),
      status: Object.freeze({ left: 2, top: 87, width: 96, height: 11 })
    })
  }
  if (mode === 'landscape') {
    return Object.freeze({
      gear: Object.freeze({ left: 2, top: 3, width: 47.5, height: 44 }),
      speed: Object.freeze({ left: 51.5, top: 3, width: 46.5, height: 44 }),
      // The delta and fuel row carries the two tallest stacked readouts of the compact grammar —
      // a caption, a hero numeral and, for fuel, the segment bar and the alert word — inside a
      // tile whose height is a fraction of a canvas that is 2.1x as wide as it is tall. At 26 %
      // the delta numeral's line box ran 5 px past the tile even after the line box was tightened
      // to the gear rung's 0.75. The row takes those 2 points from the two inter-row gutters,
      // which drop from 3 % to 2 %, so no other zone loses a pixel and none of them overlap.
      delta: Object.freeze({ left: 2, top: 49, width: 63.8, height: 28 }),
      fuel: Object.freeze({ left: 67.5, top: 49, width: 30.5, height: 28 }),
      status: Object.freeze({ left: 2, top: 79, width: 96, height: 18 })
    })
  }
  return Object.freeze({
    gear: Object.freeze({ left: 2, top: 3, width: 47.5, height: 42 }),
    speed: Object.freeze({ left: 51.5, top: 3, width: 46.5, height: 42 }),
    delta: Object.freeze({ left: 2, top: 48, width: 63.8, height: 24 }),
    fuel: Object.freeze({ left: 67.5, top: 48, width: 30.5, height: 24 }),
    status: Object.freeze({ left: 2, top: 75, width: 96, height: 22 })
  })
}

export function rc10ZonesForLayout(layout: Rc10Layout, compactMode: Rc10CompactMode = 'standard'): Rc10ZoneMap {
  if (layout === 'native') return RC10_NATIVE_ZONES
  if (layout === 'app') return RC10_APP_ZONES
  return rc10CompactZones(compactMode)
}

/** A 0..100 coordinate as a CSS percentage, without binary-float noise in the DOM. */
export function rc10Percent(value: number): string {
  return `${round3(finite(value) ? value : 0)}%`
}

/** The inline geometry a zone element carries, so CSS and the packet table cannot drift. */
export function rc10ZoneStyle(rect: Rc10Rect | undefined): {
  left: string
  top: string
  width: string
  height: string
} | null {
  if (!rect) return null
  return {
    left: rc10Percent(rect.left),
    top: rc10Percent(rect.top),
    width: rc10Percent(rect.width),
    height: rc10Percent(rect.height)
  }
}

export function rc10RectsOverlap(a: Rc10Rect, b: Rc10Rect): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  )
}

// ─────────────────────────────────────────────────────────── typography

/**
 * Normative override N2. Packet 11.2's ladder in pixels on the 800x480 canvas, computed
 * arithmetically and NOT measured off the approved render: the reference compresses gear/speed to
 * 1.250 against the packet's 1.40 and fuel/status to 1.158 against 1.64, and those cap heights are
 * never traced. `label` is packet 11.2's own "min 24 px labels".
 */
export const RC10_TYPE_SCALE_PX = Object.freeze({
  gear: 210,
  speed: 150,
  delta: 86,
  fuel: 72,
  status: 44,
  label: 24
})

/** One container-query width unit is one hundredth of the native canvas: 800 / 100 = 8 px. */
export const RC10_CQW_PX = RC10_NATIVE_WIDTH_PX / 100

/** The packet's px ladder expressed in the container units the stylesheet actually uses. */
export function rc10TypeScaleCqw(px: number): number {
  return round3(px / RC10_CQW_PX)
}

/**
 * Gap G5, resolved. Packet 11.2's ~210 px gear digit cannot be a CAP HEIGHT inside a 220 px tile
 * that also carries a 24 px shift bar and a 24 px label; read as the NOMINAL type size it gives a
 * ~149 px cap height, which is exactly what the approved reference measures (135 px after the 2/3
 * downsample of a 1200x720 source is ~148 px at 800x480 scale). The arithmetic is asserted by the
 * suite so the reading is recorded rather than assumed.
 */
export const RC10_GEAR_CAP_HEIGHT_RATIO = 0.71
export const RC10_SHIFT_BAR_HEIGHT_PX = 24

export function rc10GearCapHeightPx(nominalPx = RC10_TYPE_SCALE_PX.gear): number {
  return round1(nominalPx * RC10_GEAR_CAP_HEIGHT_RATIO)
}

/**
 * The documented RC-01/RC-02 sizing trap: `white-space: nowrap` lets a flex item's min-content
 * width exceed its column, so `overflow: hidden` never clips and every `scrollWidth` check passes
 * while the hero numeral collides with its neighbour. Each rung is therefore capped by its own
 * zone's arithmetic fit, computed here from the ZONE the packet itself publishes. The packet rung
 * stays the specification and the ceiling and is never exceeded.
 */
export const RC10_GLYPH_ADVANCE_EM = 0.56
export const RC10_ZONE_GUTTER_CQW = 1.4

export function rc10FitFontCqw(
  zoneWidthPct: number,
  glyphCount: number,
  gutterCqw = RC10_ZONE_GUTTER_CQW,
  advanceEm = RC10_GLYPH_ADVANCE_EM
): number {
  if (!finite(zoneWidthPct) || !finite(glyphCount) || glyphCount <= 0 || advanceEm <= 0) return 0
  const usable = zoneWidthPct - 2 * Math.max(0, gutterCqw)
  return usable <= 0 ? 0 : round3(usable / (glyphCount * advanceEm))
}

/** The size a rung actually renders at: the packet rung, capped by its zone's arithmetic fit. */
export function rc10RungCqw(px: number, zoneWidthPct: number, glyphCount: number): number {
  return round3(Math.min(rc10TypeScaleCqw(px), rc10FitFontCqw(zoneWidthPct, glyphCount)))
}

// ─────────────────────────────────────────────────────────── layout resolution

export function rc10LayoutForContentBox(width: number, height: number): Rc10Layout {
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return 'app'
  if (
    Math.abs(width - RC10_NATIVE_WIDTH_PX) <= RC10_NATIVE_TOLERANCE_PX &&
    Math.abs(height - RC10_NATIVE_HEIGHT_PX) <= RC10_NATIVE_TOLERANCE_PX
  ) {
    return 'native'
  }
  if (width >= RC10_APP_WIDTH_PX - 1 && height >= RC10_APP_HEIGHT_PX - 1) return 'app'
  return 'compact'
}

export function rc10CompactModeForContentBox(width: number, height: number): Rc10CompactMode {
  if (rc10LayoutForContentBox(width, height) !== 'compact') return 'standard'
  if (
    width >= RC10_PHONE_MIN_WIDTH_PX &&
    width <= RC10_PHONE_MAX_WIDTH_PX &&
    height >= RC10_PHONE_MIN_HEIGHT_PX &&
    height / width >= 1.5
  ) {
    return 'phone'
  }
  if (
    width >= RC10_LANDSCAPE_MIN_WIDTH_PX &&
    height >= RC10_LANDSCAPE_MIN_HEIGHT_PX &&
    height <= RC10_LANDSCAPE_MAX_HEIGHT_PX &&
    width / height >= 1.5
  ) {
    return 'landscape'
  }
  return 'standard'
}

export interface Rc10PhoneGeometry {
  inset: number
  shiftBarHeight: number
  gearHeight: number
  statusHeight: number
  iconSize: number
}

/** Portrait geometry, in pixels, for the bands the phone stack sizes from the measured box. */
export function rc10PhoneGeometryForContentBox(width: number, height: number): Rc10PhoneGeometry | null {
  if (rc10CompactModeForContentBox(width, height) !== 'phone') return null
  return {
    inset: 12,
    shiftBarHeight: Math.max(14, Math.round(height * 0.028)),
    gearHeight: Math.max(96, Math.round(height * 0.26)),
    statusHeight: Math.max(48, Math.round(height * 0.11)),
    iconSize: Math.max(14, Math.round(width * 0.06))
  }
}

// ─────────────────────────────────────────────────────────── alerts

/**
 * Declared CONFIGURATION, never telemetry and never printed. These bounds exist only to decide the
 * packet 15 triggers; the display shows the MEASURED value and the alert word, never the bounds.
 */
export const RC10_FUEL_RESERVE_LAPS = 3.0
/** Packet 15: "latched, 1-lap hysteresis" — a refuel must buy a whole lap of margin to clear it. */
export const RC10_FUEL_LOW_HYSTERESIS_LAPS = 1.0
export const RC10_OVERHEAT_LIMIT_C = 105
export const RC10_OVERHEAT_ENGAGE_MS = 3_000
export const RC10_OVERHEAT_CLEAR_MS = 5_000
/** Packet 15: the clear condition is "below limit-2", not merely back under the limit. */
export const RC10_OVERHEAT_CLEAR_MARGIN_C = 2

/**
 * Packet 7, 11.5 and 14 require an icon shape AND a word AND a pattern on every alert. Section 15
 * gives the over-rev alert only a segment and a pattern, so the word is supplied here: without it
 * the over-rev state would be the one state on the display readable by hue and position alone.
 * Every word is drawn in the `primary` token at 19.68:1, never in the alert hue.
 */
export const RC10_ALERT_WORDS = Object.freeze({
  fuelLow: 'FUEL LOW',
  overheat: 'HOT',
  overRev: 'OVER REV'
})

export interface Rc10AlertState {
  fuelLow: { active: boolean }
  overheat: { active: boolean; pendingSinceMs: number | null; recoverySinceMs: number | null }
}

export interface Rc10AlertInput {
  nowMs: number
  /** The MEASURED laps remaining, or null whenever there is no measured burn rate or it is stale. */
  fuelLapsRemaining: number | null
  /** The MEASURED coolant temperature, or null whenever the sensor is invalid or stale. */
  waterTempC: number | null
}

export function createRc10AlertState(): Rc10AlertState {
  return {
    fuelLow: { active: false },
    overheat: { active: false, pendingSinceMs: null, recoverySinceMs: null }
  }
}

function cloneRc10AlertState(state: Rc10AlertState): Rc10AlertState {
  return { fuelLow: { ...state.fuelLow }, overheat: { ...state.overheat } }
}

/**
 * Every alert is silent until its own trigger fires, carries the packet section 15 debounce and
 * hysteresis, has an explicit clear condition, and is unlatched the moment its input goes missing
 * or stale. No element of the alert layer is ever an always-on decoration.
 *
 * Over-rev is NOT here: `advanceRc01Alerts` already implements packet 15's 99 % / 60 ms / 95 % /
 * 250 ms exactly, and duplicating it would be the fork the SOP forbids.
 */
export function advanceRc10Alerts(state: Rc10AlertState, input: Rc10AlertInput): Rc10AlertState {
  const nowMs = finite(input.nowMs) ? input.nowMs : 0
  const next = cloneRc10AlertState(state)

  // ── Fuel low: latched at or below the reserve, and cleared only by a refuel that buys a whole
  //    lap of margin back. A fuel model that cannot measure a burn rate publishes null, which
  //    unlatches the alert rather than leaving it stuck on a projection that no longer exists.
  if (input.fuelLapsRemaining === null || !finite(input.fuelLapsRemaining)) {
    next.fuelLow = { active: false }
  } else if (next.fuelLow.active) {
    next.fuelLow = {
      active: input.fuelLapsRemaining < RC10_FUEL_RESERVE_LAPS + RC10_FUEL_LOW_HYSTERESIS_LAPS
    }
  } else {
    next.fuelLow = { active: input.fuelLapsRemaining <= RC10_FUEL_RESERVE_LAPS }
  }

  // ── Overheat: above the limit for a continuous 3 s, cleared by 5 s continuously below
  //    limit-2. A sensor that stops reporting unlatches it at once: the packet forbids claiming a
  //    temperature it cannot measure, in either direction.
  if (input.waterTempC === null || !finite(input.waterTempC)) {
    next.overheat = { active: false, pendingSinceMs: null, recoverySinceMs: null }
  } else if (next.overheat.active) {
    if (input.waterTempC < RC10_OVERHEAT_LIMIT_C - RC10_OVERHEAT_CLEAR_MARGIN_C) {
      const recoverySinceMs = next.overheat.recoverySinceMs ?? nowMs
      next.overheat = { ...next.overheat, recoverySinceMs }
      if (nowMs - recoverySinceMs >= RC10_OVERHEAT_CLEAR_MS) {
        next.overheat = { active: false, pendingSinceMs: null, recoverySinceMs: null }
      }
    } else {
      next.overheat = { ...next.overheat, recoverySinceMs: null }
    }
  } else if (input.waterTempC > RC10_OVERHEAT_LIMIT_C) {
    const pendingSinceMs = next.overheat.pendingSinceMs ?? nowMs
    next.overheat = { ...next.overheat, pendingSinceMs }
    if (nowMs - pendingSinceMs >= RC10_OVERHEAT_ENGAGE_MS) {
      next.overheat = { active: true, pendingSinceMs: null, recoverySinceMs: null }
    }
  } else {
    next.overheat = { ...next.overheat, pendingSinceMs: null }
  }

  return next
}

/** A stale, missing or refused input can never leave an alert latched on. */
export function clearInvalidRc10Alerts(state: Rc10AlertState, model: Rc10DashboardModel): Rc10AlertState {
  const next = cloneRc10AlertState(state)
  if (model.fuel.unavailable || model.fuel.stale) next.fuelLow = { active: false }
  if (model.water.unavailable || model.water.stale) {
    next.overheat = { active: false, pendingSinceMs: null, recoverySinceMs: null }
  }
  return next
}

/** The alert words a surface renders; empty in a silent frame, which is the reference state. */
export function rc10AlertLines(model: Rc10DashboardModel): readonly string[] {
  const lines: string[] = []
  if (model.alerts.overheat) lines.push(RC10_ALERT_WORDS.overheat)
  if (model.alerts.fuelLow) lines.push(RC10_ALERT_WORDS.fuelLow)
  if (model.alerts.overRev) lines.push(RC10_ALERT_WORDS.overRev)
  return lines
}

/**
 * Packet 11.5: "Only one status changes emphasis at a time to reduce cognitive load." The single
 * emphasised zone is chosen by severity — critical overheat, then caution fuel low, then over-rev
 * inside the gear tile — and is null whenever the whole alert layer is silent.
 */
export function rc10EmphasisTarget(model: Rc10DashboardModel): Rc10ZoneId | null {
  if (model.alerts.overheat) return 'status'
  if (model.alerts.fuelLow) return 'fuel'
  if (model.alerts.overRev) return 'gear'
  return null
}

/** The status channels live in the strip at 800x480 and in the plain-language line at 1024x600. */
export function rc10EmphasisZoneForLayout(target: Rc10ZoneId | null, layout: Rc10Layout): Rc10ZoneId | null {
  if (target === null) return null
  if (target === 'status' && layout === 'app') return 'plain'
  return target
}

// ─────────────────────────────────────────────────────────── dashboard model

export interface Rc10AlertFlags {
  fuelLow: boolean
  overheat: boolean
  overRev: boolean
}

export interface Rc10StatusCell {
  id: 'position' | 'water' | 'tc'
  label: string
  unit: string
  value: Rc01Field
  rank: Rc10StatusRank
  rung: Rc10StatusRung
}

export interface Rc10DashboardModel {
  gear: Rc01Field
  speed: Rc01Field
  delta: Rc01Field
  deltaCue: Rc10DeltaCue
  fuel: Rc01Field
  fuelLapsRemaining: number | null
  fuelSegments: readonly Rc10FuelSegment[]
  fuelLitSegments: number
  position: Rc01Field
  water: Rc01Field
  tc: Rc01Field
  statusCells: readonly Rc10StatusCell[]
  rpm: Rc01Field
  rpmRatio: number | null
  rpmFresh: boolean
  shiftSegments: readonly Rc10ShiftSegment[]
  shiftLitRamp: number
  alerts: Rc10AlertFlags
  auxFresh: Readonly<Record<Rc10AuxChannel, boolean>>
  criticalFresh: Readonly<Record<Rc01ChannelName, boolean>>
}

export interface Rc10ModelOptions {
  alerts?: Rc10AlertState
  /** The shared RC-01 alert state, which owns the packet-identical over-rev debounce. */
  sharedAlerts?: Rc01AlertState
}

interface Rc10Reading {
  value: number | string | null
  lastKnown: number | string | null
  stale: boolean
  ageMs: number
}

/**
 * Receipts for RC-10's own channels, with exactly RC-01's semantics: a receipt is written only
 * when the channel actually reports, so a channel that falls silent ages out and degrades to its
 * packet state instead of freezing on its last value.
 */
export class Rc10AuxBuffer {
  private channelReceipts = new Map<Rc10AuxChannel, Rc01ChannelReceipt>()

  clone(): Rc10AuxBuffer {
    const next = new Rc10AuxBuffer()
    next.channelReceipts = new Map(this.channelReceipts)
    return next
  }

  reset(): void {
    this.channelReceipts = new Map()
  }

  ingest(snapshot: TelemetrySnapshot | null | undefined, receivedAt = rc01MonotonicNow()): void {
    if (!snapshot || !snapshot.connected || !finite(snapshot.timestamp)) return
    const safeReceiptAt = finite(receivedAt) && receivedAt >= 0 ? receivedAt : rc01MonotonicNow()
    for (const channel of Object.keys(RC10_CHANNEL_STALE_MS) as Rc10AuxChannel[]) {
      const value = rc10AuxChannelValue(snapshot, channel)
      if (value === null) continue
      this.channelReceipts.set(
        channel,
        Object.freeze({ value, snapshotTimestamp: snapshot.timestamp, receivedAt: safeReceiptAt })
      )
    }
  }

  receipts(): ReadonlyMap<Rc10AuxChannel, Rc01ChannelReceipt> {
    return new Map(this.channelReceipts)
  }
}

export function createRc10AuxReceipts(
  snapshot: TelemetrySnapshot,
  receivedAt = rc01MonotonicNow()
): ReadonlyMap<Rc10AuxChannel, Rc01ChannelReceipt> {
  const buffer = new Rc10AuxBuffer()
  buffer.ingest(snapshot, receivedAt)
  return buffer.receipts()
}

function auxReading(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc10AuxChannel, Rc01ChannelReceipt>,
  channel: Rc10AuxChannel,
  nowMs: number
): Rc10Reading {
  const raw = snapshot ? rc10AuxChannelValue(snapshot, channel) : null
  const receipt = receipts.get(channel)
  if (raw === null || !receipt) {
    return { value: null, lastKnown: null, stale: false, ageMs: Number.POSITIVE_INFINITY }
  }
  const ageMs = rc01ReceiptAgeMs(receipt, nowMs)
  const stale = ageMs > RC10_CHANNEL_STALE_MS[channel]
  return {
    value: stale ? null : raw,
    lastKnown: typeof receipt.value === 'boolean' ? null : receipt.value,
    stale,
    ageMs
  }
}

function statusCell(
  id: Rc10StatusCell['id'],
  label: string,
  unit: string,
  value: Rc01Field,
  rank: Rc10StatusRank
): Rc10StatusCell {
  return { id, label, unit, value, rank, rung: rc10StatusRung(rank) }
}

/**
 * Projects the shared RC-01 telemetry model into RC-10's high-contrast display and adds the
 * accessibility channels. Nothing is invented, estimated or mirrored: the gear never comes from
 * RPM, the speed never from RPM times a ratio, the delta never exists without a stored reference
 * lap, the fuel projection never without a measured burn rate, the position never from gaps, and
 * every unavailable channel renders its packet dash state in the `secondary` token beside a
 * hollow ring — degraded by rank and glyph, never dimmed below the contrast floor.
 */
export function createRc10DashboardModel(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc01ChannelName, Rc01ChannelReceipt> = new Map(),
  auxReceipts: ReadonlyMap<Rc10AuxChannel, Rc01ChannelReceipt> = new Map(),
  nowMs = rc01MonotonicNow(),
  options: Rc10ModelOptions = {}
): Rc10DashboardModel {
  const base: Rc01DashboardModel = createRc01DashboardModel(snapshot, receipts, nowMs)
  const safeSnapshot = snapshot && snapshot.connected ? snapshot : null
  const alerts = options.alerts ?? createRc10AlertState()
  const overRev = options.sharedAlerts?.overRev.active === true && base.rpmFresh

  const auxFresh = Object.fromEntries(
    (Object.keys(RC10_CHANNEL_STALE_MS) as Rc10AuxChannel[]).map((channel) => [
      channel,
      auxReading(safeSnapshot, auxReceipts, channel, nowMs).value !== null
    ])
  ) as Record<Rc10AuxChannel, boolean>

  // ── Gear: the ECU gear channel on its own 50 ms budget. Packet 16: 'N' or the grey '-', never
  //    blanked silently and never derived from RPM or speed.
  const gearReading = auxReading(safeSnapshot, auxReceipts, 'gear', nowMs)
  const gear =
    typeof gearReading.value === 'number'
      ? field(rc10DisplayGear(gearReading.value), gearReading.value, false, false, 'primary')
      : field(RC10_DASH.gear, null, gearReading.stale, true, 'muted')

  // ── Speed: greys past its 100 ms cadence, collapses to '---' past the 500 ms budget.
  const speedReading = auxReading(safeSnapshot, auxReceipts, 'speed', nowMs)
  const speedDashed = speedReading.value === null && speedReading.ageMs > RC10_SPEED_DASH_MS
  const speed =
    typeof speedReading.value === 'number'
      ? field(String(Math.round(speedReading.value)), speedReading.value, false, false, 'primary')
      : !speedDashed && typeof speedReading.lastKnown === 'number'
        ? field(String(Math.round(speedReading.lastKnown)), speedReading.lastKnown, true, false, 'muted')
        : field(RC10_DASH.speed, null, speedReading.stale, true, 'muted')

  // ── Delta: the shared RC-01 channel already refuses to exist without a stored reference lap and
  //    already carries the packet's cadence, so it is reformatted rather than re-derived.
  const deltaUsable = !base.delta.unavailable && !base.delta.stale && typeof base.delta.raw === 'number'
  const deltaSec = deltaUsable ? (base.delta.raw as number) : null
  const delta = deltaUsable
    ? field(rc10FormatDelta(deltaSec), deltaSec, false, false, 'primary')
    : field(RC10_DASH.delta, null, base.delta.stale, base.delta.unavailable, 'muted')
  const deltaCue = rc10DeltaCue(deltaSec, deltaUsable)

  // ── Fuel laps remaining: a projection only where a burn rate was genuinely measured.
  const fuelReading = auxReading(safeSnapshot, auxReceipts, 'fuelLaps', nowMs)
  const fuelLapsRemaining = typeof fuelReading.value === 'number' ? fuelReading.value : null
  const fuel =
    fuelLapsRemaining !== null
      ? field(rc10FormatFuelLaps(fuelLapsRemaining), fuelLapsRemaining, false, false, 'primary')
      : field(RC10_DASH.fuel, null, fuelReading.stale, true, 'muted')
  const fuelSegments = buildRc10FuelSegments(fuelLapsRemaining)
  const fuelLitSegments = rc10FuelLitSegments(fuelLapsRemaining)

  // ── Position: the shared 1 s timing budget, reformatted as the packet's bare integer. Packet
  //    16: '--' if there is no timing feed, and never inferred from gaps.
  const positionUsable =
    !base.position.unavailable && !base.position.stale && typeof base.position.raw === 'number'
  const position = positionUsable
    ? field(String(Math.trunc(base.position.raw as number)), base.position.raw, false, false, 'primary')
    : field(RC10_DASH.position, null, base.position.stale, true, 'muted')

  // ── Water: its own sensor, dashed when invalid; never estimated from oil or air temperature.
  const waterReading = auxReading(safeSnapshot, auxReceipts, 'water', nowMs)
  const water =
    typeof waterReading.value === 'number'
      ? field(String(Math.round(waterReading.value)), waterReading.value, false, false, 'primary')
      : field(RC10_DASH.water, null, waterReading.stale, true, 'muted')

  // ── TC: packet 16's one channel that must NOT dash on a quiet bus — it holds its last known
  //    step, greyed and flagged stale. The shared `tc` field implements exactly that, so it is
  //    reused rather than re-derived; it only dashes when the step was never seen at all.
  const tc = base.tc

  const shiftSegments = buildRc10ShiftSegments(base.rpmFresh ? base.rpmRatio : null, base.rpmFresh, overRev)
  const shiftLitRamp = rc10ShiftLitRampCount(base.rpmFresh ? base.rpmRatio : null, base.rpmFresh)

  const statusCells: readonly Rc10StatusCell[] = Object.freeze([
    statusCell('position', 'POS', '', position, rc10AvailabilityRank(position)),
    statusCell(
      'water',
      'WATER',
      'C',
      water,
      water.unavailable ? 'none' : alerts.overheat.active ? 'critical' : 'normal'
    ),
    statusCell('tc', 'TC', '', tc, rc10AvailabilityRank(tc))
  ])

  return {
    gear,
    speed,
    delta,
    deltaCue,
    fuel,
    fuelLapsRemaining,
    fuelSegments,
    fuelLitSegments,
    position,
    water,
    tc,
    statusCells,
    rpm: base.rpm,
    rpmRatio: base.rpmRatio,
    rpmFresh: base.rpmFresh,
    shiftSegments,
    shiftLitRamp,
    alerts: {
      fuelLow: alerts.fuelLow.active,
      overheat: alerts.overheat.active,
      overRev
    },
    auxFresh,
    criticalFresh: base.criticalFresh
  }
}

/** The alert-layer inputs, all gated on freshness so a frozen frame can never engage anything. */
export function rc10AlertInputForModel(model: Rc10DashboardModel, nowMs: number): Rc10AlertInput {
  return {
    nowMs,
    fuelLapsRemaining:
      model.fuel.unavailable || model.fuel.stale || typeof model.fuel.raw !== 'number'
        ? null
        : model.fuel.raw,
    waterTempC:
      model.water.unavailable || model.water.stale || typeof model.water.raw !== 'number'
        ? null
        : model.water.raw
  }
}

// ─────────────────────────────────────────────────────────── plain-language line

export interface Rc10PlainLanguage {
  /** Packet 12.1's own example shape: `FUEL OK - PUSH`. One sentence, never a paragraph. */
  headline: string
  /** Gap G1: the three channels section 12.1 forgot, carried explicitly rather than dropped. */
  carried: typeof RC10_APP_STATUS_CARRIAGE
}

/**
 * The 1024x600 plain-language status sentence. It states the highest-severity truth on the
 * display in words, so a driver who cannot separate the alert hues still reads the state.
 */
export function rc10PlainLanguage(model: Rc10DashboardModel): Rc10PlainLanguage {
  const headline = model.alerts.overheat
    ? 'HOT - ENGINE OVER TEMPERATURE'
    : model.alerts.fuelLow
      ? 'FUEL LOW - SAVE FUEL'
      : model.alerts.overRev
        ? 'OVER REV - SHIFT UP'
        : model.fuel.unavailable
          ? 'FUEL UNKNOWN - NO MEASURED BURN LAP'
          : 'FUEL OK - PUSH'
  return { headline, carried: RC10_APP_STATUS_CARRIAGE }
}

// ─────────────────────────────────────────────────────────── colour-blind proof

/**
 * The display state with EVERY hue stripped out. Only shapes, counts, words, patterns, dash
 * strings and sign characters survive. Two states that mean different things must produce
 * different fingerprints, or something on this display is readable by colour alone — which is the
 * one failure this artifact exists to make impossible.
 */
export function rc10ColourBlindFingerprint(model: Rc10DashboardModel): string {
  return [
    `gear:${model.gear.value}`,
    `speed:${model.speed.value}`,
    `delta:${model.delta.value}/${model.deltaCue.sign}/${model.deltaCue.chevron}/${model.deltaCue.pattern}`,
    `fuel:${model.fuel.value}/${model.fuelLitSegments}of${RC10_FUEL_SEGMENT_COUNT}`,
    `shift:${model.shiftLitRamp}of${RC10_SHIFT_RAMP_COUNT}/cap:${model.shiftSegments[RC10_SHIFT_RAMP_COUNT].pattern}`,
    `status:${model.statusCells.map((cell) => `${cell.id}=${cell.value.value}:${cell.rung.shape}:${cell.rung.filled ? 'solid' : 'hollow'}`).join('|')}`,
    `alerts:${rc10AlertLines(model).join('+') || 'silent'}`
  ].join(' ')
}

// ─────────────────────────────────────────────────────────── accessible names

/** Accessible description for the gear hero: the packet's own words, never the hue. */
export function rc10GearDescription(model: Rc10DashboardModel): string {
  if (model.gear.unavailable) return 'Gear unavailable, gear channel absent'
  return `Gear ${model.gear.value}${model.gear.stale ? ', stale' : ''}`
}

/** Accessible description for the lap delta: the direction in words, never the hue alone. */
export function rc10DeltaDescription(model: Rc10DashboardModel): string {
  if (model.delta.unavailable) return 'Delta to best unavailable, no stored reference lap'
  if (model.delta.stale) return 'Delta to best stale'
  const side =
    model.deltaCue.direction === 'faster'
      ? 'faster than the best lap'
      : model.deltaCue.direction === 'slower'
        ? 'slower than the best lap'
        : 'level with the best lap'
  return `Delta to best ${model.delta.value} seconds, ${side}`
}

/** Accessible description for the fuel tile: the numeral AND the segment count, in words. */
export function rc10FuelDescription(model: Rc10DashboardModel): string {
  if (model.fuel.unavailable) return 'Fuel laps remaining unavailable, no measured burn lap yet'
  return `Fuel ${model.fuel.value} laps remaining, ${model.fuelLitSegments} of ${RC10_FUEL_SEGMENT_COUNT} segments lit${model.fuel.stale ? ', stale' : ''}`
}

/** Accessible description for a status cell: the rank word plus the shape, never the hue. */
export function rc10StatusDescription(cell: Rc10StatusCell): string {
  const state = cell.value.unavailable
    ? `unavailable, ${cell.rung.word.toLowerCase()}`
    : `${cell.value.value}${cell.unit ? ` ${cell.unit}` : ''}, ${cell.rung.word.toLowerCase()}`
  return `${cell.label} ${state}, ${cell.rung.shape} icon${cell.value.stale ? ', stale' : ''}`
}

export type { Rc01Field as Rc10Field }
