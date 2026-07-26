import type { RadarCarEntry, TelemetrySnapshot } from '../../../../shared/telemetry'
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
 * RC-07 "Blue Flags — Dense Traffic & Multiclass Awareness" core.
 *
 * The live-only ingest buffer, identity binding, mock/replay refusal, out-of-order and
 * same-timestamp guards and the shared channel receipts are reused verbatim from the RC-01
 * core: that is telemetry-truth machinery, not RC-01 styling, and a fork would silently
 * drift. This module adds only what RC-07's packet needs and the shared layer does not have:
 * the proximity radar's arithmetic geometry, the class-code tokens, the flag ribbon state
 * machine, the closing-direction first difference and the three traffic alerts.
 *
 * Position and delta are taken from the shared RC-01 model rather than re-read here: RC-01's
 * budgets are already the packet's (position 1 s, delta per sample) and RC-01 already refuses
 * a delta without a real stored best lap, which is exactly packet section 16's rule. Every
 * other RC-07 channel has a packet budget RC-01 does not carry and lives in the aux table.
 *
 * Four packet contradictions are resolved here, and each one is asserted by the test suite
 * through `RC07_PACKET_OMISSIONS` so a later edit cannot quietly reintroduce them.
 */

/** Packet section 11.1 native canvas, and the section 12.1 app reflow target. */
export const RC07_NATIVE_WIDTH_PX = 800
export const RC07_NATIVE_HEIGHT_PX = 480
export const RC07_NATIVE_TOLERANCE_PX = 1
export const RC07_APP_WIDTH_PX = 1024
export const RC07_APP_HEIGHT_PX = 600

export const RC07_PHONE_MIN_WIDTH_PX = 360
export const RC07_PHONE_MAX_WIDTH_PX = 480
export const RC07_PHONE_MIN_HEIGHT_PX = 650
export const RC07_LANDSCAPE_MIN_WIDTH_PX = 650
export const RC07_LANDSCAPE_MIN_HEIGHT_PX = 360
export const RC07_LANDSCAPE_MAX_HEIGHT_PX = 480

export type Rc07CompactMode = 'phone' | 'landscape' | 'standard'
export type Rc07Layout = 'native' | 'app' | 'compact'

/**
 * The packet requirements this build deliberately does NOT render, with the reason. Each key
 * is asserted by the suite: the omission is part of the contract, not an oversight.
 *
 *  - `shiftCue`      packet 11.4 demotes shift LEDs to a slim edge cue and keeps an over-rev
 *                    segment, but packet section 16 defines NO engine-speed channel. There is
 *                    no rpm entry in `RC07_CHANNEL_STALE_MS` and no rev element anywhere.
 *  - `closingRateNumeral` packet 11.1 and 15 both reference a "closing rate", but section 16
 *                    defines no channel for it. It is rendered as a direction-only glyph
 *                    derived from the SIGN of the gap first difference, with no numeral.
 *  - `passAdvice`    packet 11.1 says the gap-ahead panel shows "whether to pass" and defines
 *                    no rule anywhere for that decision, so no PASS/HOLD text exists.
 *  - `rangeSoftKeyLegend` packet 11.5 defines a radar-range soft-key but packet 11.1 allocates
 *                    no legend zone for it, so the key is bound and unlabelled.
 */
export const RC07_PACKET_OMISSIONS = Object.freeze({
  shiftCue: 'packet 11.4 shift/over-rev edge cue: section 16 defines no engine-speed channel',
  closingRateNumeral: 'packet 11.1/15 closing rate: section 16 defines no closing-rate channel',
  passAdvice: 'packet 11.1 "whether to pass": no rule is defined anywhere in the packet',
  rangeSoftKeyLegend: 'packet 11.5 radar-range soft-key: packet 11.1 allocates it no legend zone'
})

// ─────────────────────────────────────────────────────────── channels

/**
 * Packet section 16 freshness budgets, verbatim: proximity radar 50 ms, gap behind and gap
 * ahead 1 s, gear 50 ms, speed 100 ms, spotter proximity zone 50 ms.
 *
 * `flag` and `fuelLaps` are event / per-lap channels: they only CHANGE on an event or a lap,
 * but every provider that carries them republishes them on each frame, so their budget is a
 * TRANSPORT budget — generous next to the hero channels but finite, so a provider that falls
 * silent ages the value out into its dash state instead of freezing on it. For the flag that
 * is the packet's "never assume green" rule expressed as staleness: a silent race-control
 * feed becomes NO SIGNAL, it does not keep showing the last green it saw for ever.
 */
export const RC07_CHANNEL_STALE_MS = {
  radar: 50,
  gapBehind: 1_000,
  gapAhead: 1_000,
  flag: 2_000,
  gear: 50,
  speed: 100,
  fuelLaps: 2_000,
  spotter: 50
} as const

export type Rc07AuxChannel = keyof typeof RC07_CHANNEL_STALE_MS

/**
 * Packet section 16: speed greys as soon as it misses its 100 ms cadence but only collapses
 * to the three-character dash once the source has been quiet for more than 500 ms.
 */
export const RC07_SPEED_DASH_MS = 500

// ─────────────────────────────────────────────────────────── class tokens

/**
 * Packet section 8 requires GENERIC class tokens tied to no real series. The letter is an
 * ordinal label assigned to the distinct class ids the timing feed actually reports, in
 * ascending id order, so it is bound to a real channel and is stable for a session. A car
 * whose class id is missing gets no letter and renders the dash badge; it is never guessed.
 */
export const RC07_CLASS_CODES = ['A', 'B', 'C', 'D', 'E', 'F'] as const
export type Rc07ClassCode = (typeof RC07_CLASS_CODES)[number]

/** Packet 11.3 fixes the class hues, so the provider's own class colour is deliberately unused. */
export type Rc07ClassTone = 'info' | 'normal' | 'signature' | 'secondary' | 'unknown'

const RC07_CLASS_TONES: Readonly<Record<Rc07ClassCode, Rc07ClassTone>> = Object.freeze({
  A: 'info',
  B: 'normal',
  C: 'signature',
  D: 'secondary',
  E: 'secondary',
  F: 'secondary'
})

export function rc07ClassTone(code: Rc07ClassCode | null): Rc07ClassTone {
  return code === null ? 'unknown' : RC07_CLASS_TONES[code]
}

/** Packet 19: the badge always carries a letter, so class is never encoded by hue alone. */
export function rc07ClassLabel(code: Rc07ClassCode | null): string {
  return code ?? '--'
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
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

/** The distinct class ids the timing feed reports this frame, ascending. */
export function rc07ClassOrder(snapshot: TelemetrySnapshot | null): readonly number[] {
  const drivers = snapshot?.drivers
  if (!Array.isArray(drivers)) return []
  const ids = new Set<number>()
  for (const driver of drivers) {
    const id = driver?.classId
    if (finite(id) && Number.isInteger(id)) ids.add(id)
  }
  return [...ids].sort((a, b) => a - b)
}

export function rc07ClassCodeForId(
  classId: number | null | undefined,
  order: readonly number[]
): Rc07ClassCode | null {
  if (!finite(classId)) return null
  const index = order.indexOf(classId)
  if (index < 0 || index >= RC07_CLASS_CODES.length) return null
  return RC07_CLASS_CODES[index]
}

/** The class id the timing feed carries for a car index, or null when the feed does not say. */
export function rc07ClassIdForCar(snapshot: TelemetrySnapshot | null, carIdx: number | null): number | null {
  if (!snapshot || !finite(carIdx)) return null
  const drivers = snapshot.drivers
  if (!Array.isArray(drivers)) return null
  const entry = drivers.find((driver) => driver?.carIdx === carIdx)
  return entry && finite(entry.classId) ? entry.classId : null
}

export function rc07ClassCodeForCar(
  snapshot: TelemetrySnapshot | null,
  carIdx: number | null,
  order: readonly number[]
): Rc07ClassCode | null {
  return rc07ClassCodeForId(rc07ClassIdForCar(snapshot, carIdx), order)
}

// ─────────────────────────────────────────────────────────── radar geometry

/**
 * The radar plot is expressed in RADAR UNITS: the own-car marker sits at 0 and the plot edge
 * at `RC07_RADAR_PLOT_UNITS`, so one unit is one percent of the radar box's half width and a
 * blip's polar coordinates convert to CSS percentages without a second scale factor.
 */
export const RC07_RADAR_PLOT_UNITS = 50

/**
 * Packet 11.5 auto-ranges the radar with speed. The two range rings are drawn at fixed
 * FRACTIONS of the configured range — 40 % and 80 %, i.e. 20 and 40 units, the exact 2.00
 * ratio the packet configures — so the rings always mean the same thing relative to the
 * current range. image-qa-v1 residual 2 is a normative override: the reference render put
 * them at 17.3 and 35.4 units and those pixels are never traced.
 */
export const RC07_RADAR_INNER_RING_FRACTION = 0.4
export const RC07_RADAR_OUTER_RING_FRACTION = 0.8
export const RC07_RADAR_INNER_RING_UNITS = RC07_RADAR_PLOT_UNITS * RC07_RADAR_INNER_RING_FRACTION
export const RC07_RADAR_OUTER_RING_UNITS = RC07_RADAR_PLOT_UNITS * RC07_RADAR_OUTER_RING_FRACTION

/**
 * The critical zone IS the inner ring. Tying the packet 15 "critical distance" to the drawn
 * ring rather than to a fixed metre count is deliberate: with an auto-ranged radar a fixed
 * metre threshold would make the ring the driver sees and the alert that fires disagree
 * whenever the range changed, and the ring is the only cue the driver can actually read.
 */
export const RC07_RADAR_CRITICAL_FRACTION = RC07_RADAR_INNER_RING_FRACTION

/** A blip is never drawn under the own-car marker, and never outside the plot. */
export const RC07_RADAR_MIN_BLIP_UNITS = 6

/**
 * The minimum radial gap between consecutively-ranked blips. This is what makes the ordering
 * STRUCTURALLY impossible to collapse: attempts 001 and 003 of the reference both put every
 * blip on effectively one radius, so the radius carried no information at all.
 */
export const RC07_RADAR_MIN_SEPARATION_UNITS = 3

/** Packet 11.5: the soft-key cycles these ranges; auto mode picks one from speed. */
export const RC07_RADAR_RANGES_M = [40, 80, 160] as const
export const RC07_RADAR_DEFAULT_RANGE_INDEX = 1
export const RC07_RADAR_AUTO_RANGE_KMH = [80, 200] as const

/** More contacts than this cannot be separated legibly, so the nearest ones are kept. */
export const RC07_RADAR_CONTACT_LIMIT = 8

/** Lateral dead band, in metres, inside which a contact counts as directly ahead/behind. */
export const RC07_RADAR_SIDE_DEADBAND_M = 0.6

export const RC07_RADAR_RANGE_EVENT = 'racecon:blue-flags-radar-range'

export type Rc07RadarSide = 'left' | 'right' | 'center'
export type Rc07Longitudinal = 'ahead' | 'behind'
export type Rc07CriticalSide = 'left' | 'right' | 'both'

export interface Rc07Contact {
  carIdx: number | null
  relativeXM: number
  relativeYM: number
  distanceM: number
  gapSec: number | null
  classCode: Rc07ClassCode | null
}

export interface Rc07Blip extends Rc07Contact {
  rank: number
  radiusUnits: number
  angleDeg: number
  xPercent: number
  yPercent: number
  side: Rc07RadarSide
  longitudinal: Rc07Longitudinal
  critical: boolean
  /** Packet 19: the side is carried by a glyph, never by the blip's position alone. */
  arrow: '\u25C0' | '\u25B6' | '\u25B2' | '\u25BC'
}

/**
 * Packet 11.5's auto-range. The range is a DISPLAY SCALE, not a telemetry value: choosing a
 * default when speed is unavailable invents nothing, and the model reports which of `auto`,
 * `manual` and `default` produced the range so the choice is never silent.
 */
export function rc07AutoRangeIndex(speedKmh: number | null): number | null {
  if (!finite(speedKmh) || speedKmh < 0) return null
  const [slow, fast] = RC07_RADAR_AUTO_RANGE_KMH
  if (speedKmh < slow) return 0
  if (speedKmh < fast) return 1
  return 2
}

export function rc07RangeIndexFromEvent(detail: unknown): number | 'auto' | null {
  if (detail === 'auto') return 'auto'
  if (finite(detail) && Number.isInteger(detail) && detail >= 0 && detail < RC07_RADAR_RANGES_M.length) {
    return detail
  }
  if (detail && typeof detail === 'object' && 'rangeIndex' in detail) {
    return rc07RangeIndexFromEvent((detail as { rangeIndex?: unknown }).rangeIndex)
  }
  return null
}

/**
 * The reason attempts 001 and 003 were rejected: every blip landed on one radius, so the
 * distance the radar encodes carried no information. Each radius is therefore computed
 * ARITHMETICALLY from the contact's own distance, and then raised — never lowered — by the
 * minimum amount needed to keep consecutive ranks apart.
 *
 * The construction is monotone by proof, not by inspection. With `n` contacts, ranked by true
 * distance, `step = min(MIN_SEPARATION, (PLOT - MIN_BLIP) / (n - 1))` and rank `k` is confined
 * to `[max(MIN_BLIP, r(k-1) + step), PLOT - (n - 1 - k) * step]`. That upper bound reserves
 * exactly enough headroom for every remaining rank, so the window is never empty and
 * `r(k) >= r(k-1) + step` holds for every k. Ordering can therefore never collapse, whatever
 * the distances are — including the degenerate frame where every contact is at one distance.
 *
 * The floor only ever RAISES a radius, so a blip is never drawn nearer than it truly is;
 * criticality is consequently taken from the true distance and carried on the blip itself,
 * never inferred from where the blip landed.
 */
export function rc07SeparatedRadii(radii: readonly number[]): number[] {
  const n = radii.length
  if (n === 0) return []
  const step =
    n === 1
      ? 0
      : Math.min(
          RC07_RADAR_MIN_SEPARATION_UNITS,
          (RC07_RADAR_PLOT_UNITS - RC07_RADAR_MIN_BLIP_UNITS) / (n - 1)
        )
  const out: number[] = []
  let previous = Number.NEGATIVE_INFINITY
  for (let rank = 0; rank < n; rank += 1) {
    const lo = Math.max(RC07_RADAR_MIN_BLIP_UNITS, previous + step)
    const hi = RC07_RADAR_PLOT_UNITS - (n - 1 - rank) * step
    const value = Math.min(Math.max(radii[rank], lo), hi)
    out.push(value)
    previous = value
  }
  return out
}

/** The raw proportional radius: distance over range, clamped to the plot. */
export function rc07RawRadiusUnits(distanceM: number, rangeM: number): number {
  if (!finite(distanceM) || !finite(rangeM) || rangeM <= 0) return RC07_RADAR_PLOT_UNITS
  return Math.min(1, Math.max(0, distanceM / rangeM)) * RC07_RADAR_PLOT_UNITS
}

function sideFor(relativeXM: number): Rc07RadarSide {
  if (relativeXM < -RC07_RADAR_SIDE_DEADBAND_M) return 'left'
  if (relativeXM > RC07_RADAR_SIDE_DEADBAND_M) return 'right'
  return 'center'
}

function arrowFor(side: Rc07RadarSide, longitudinal: Rc07Longitudinal): Rc07Blip['arrow'] {
  if (side === 'left') return '\u25C0'
  if (side === 'right') return '\u25B6'
  return longitudinal === 'ahead' ? '\u25B2' : '\u25BC'
}

/**
 * Reads the radar source. An ABSENT `radarCars` array means the source is missing and the
 * radar must hide; an EMPTY array is a live source truthfully reporting no traffic, which is
 * a completely different state and must not be confused with it.
 */
export function rc07RadarContacts(
  snapshot: TelemetrySnapshot | null,
  order: readonly number[] = []
): readonly Rc07Contact[] | null {
  if (!snapshot) return null
  const cars = snapshot.radarCars
  if (!Array.isArray(cars)) return null
  const contacts: Rc07Contact[] = []
  for (const car of cars as RadarCarEntry[]) {
    if (!car || !finite(car.relativeX) || !finite(car.relativeY)) continue
    const distanceM = Math.hypot(car.relativeX, car.relativeY)
    if (!finite(distanceM)) continue
    contacts.push({
      carIdx: finite(car.carIdx) ? car.carIdx : null,
      relativeXM: car.relativeX,
      relativeYM: car.relativeY,
      distanceM,
      gapSec: finite(car.gapSec) ? car.gapSec : null,
      classCode: rc07ClassCodeForCar(snapshot, finite(car.carIdx) ? car.carIdx : null, order)
    })
  }
  return contacts
}

export function rc07RadarBlips(contacts: readonly Rc07Contact[], rangeM: number): readonly Rc07Blip[] {
  const ordered = [...contacts]
    .sort((a, b) => a.distanceM - b.distanceM || (a.carIdx ?? 0) - (b.carIdx ?? 0))
    .slice(0, RC07_RADAR_CONTACT_LIMIT)
  const radii = rc07SeparatedRadii(ordered.map((contact) => rc07RawRadiusUnits(contact.distanceM, rangeM)))
  const criticalM = rangeM * RC07_RADAR_CRITICAL_FRACTION
  return ordered.map((contact, rank) => {
    // `relativeY` is positive ahead, so the plot angle is measured clockwise from straight
    // ahead and the vertical axis is inverted into CSS's top-down percentage space.
    const angleRad = Math.atan2(contact.relativeXM, contact.relativeYM)
    const radiusUnits = radii[rank]
    const longitudinal: Rc07Longitudinal = contact.relativeYM >= 0 ? 'ahead' : 'behind'
    const side = sideFor(contact.relativeXM)
    return {
      ...contact,
      rank,
      radiusUnits,
      angleDeg: (angleRad * 180) / Math.PI,
      xPercent: 50 + Math.sin(angleRad) * radiusUnits,
      yPercent: 50 - Math.cos(angleRad) * radiusUnits,
      side,
      longitudinal,
      critical: contact.distanceM <= criticalM,
      arrow: arrowFor(side, longitudinal)
    }
  })
}

/** The side(s) carrying a contact inside the critical zone, which is what packet 15 alerts on. */
export function rc07CriticalSide(blips: readonly Rc07Blip[]): Rc07CriticalSide | null {
  let left = false
  let right = false
  for (const blip of blips) {
    if (!blip.critical) continue
    if (blip.side === 'left') left = true
    else if (blip.side === 'right') right = true
    else {
      left = true
      right = true
    }
  }
  if (left && right) return 'both'
  if (left) return 'left'
  if (right) return 'right'
  return null
}

// ─────────────────────────────────────────────────────────── flag ribbon

export type Rc07FlagCode =
  | 'GREEN'
  | 'BLUE'
  | 'YELLOW'
  | 'WHITE'
  | 'RED'
  | 'CHECKERED'
  | 'BLACK'
  | 'MEATBALL'

/**
 * Ribbon precedence. Red and the two penalty flags outrank everything; RC-07's own blue duty
 * flag outranks the track-condition flags below it, because the packet's whole thesis is that
 * blue-flag duty is the state the driver must not miss.
 */
export const RC07_FLAG_PRIORITY: readonly Rc07FlagCode[] = [
  'RED',
  'BLACK',
  'MEATBALL',
  'BLUE',
  'YELLOW',
  'CHECKERED',
  'WHITE',
  'GREEN'
]

export const RC07_FLAG_NO_SIGNAL = 'NO SIGNAL'

/**
 * Packet section 16: never assume green when the flag feed is missing. `null` means NO
 * SIGNAL and is returned whenever the provider omits the flags object outright or reports
 * `raceControlState: 'unknown'`, i.e. it could not recognise the raw race-control value.
 *
 * An all-false flags object with a RECOGNISED race-control state is not a missing feed: it is
 * a positive report that no flag is raised, which is the definition of a green track. That
 * distinction is the whole point of `raceControlState`.
 */
export function rc07FlagCode(snapshot: TelemetrySnapshot | null): Rc07FlagCode | null {
  if (!snapshot) return null
  if (snapshot.raceControlState === 'unknown') return null
  const flags = snapshot.flags
  if (!flags || typeof flags !== 'object') return null
  if (flags.red) return 'RED'
  if (flags.black || flags.disqualify) return 'BLACK'
  if (flags.meatball || flags.repair) return 'MEATBALL'
  if (flags.blue) return 'BLUE'
  if (flags.yellow) return 'YELLOW'
  if (flags.checkered || flags.greenWhiteCheckered) return 'CHECKERED'
  if (flags.white) return 'WHITE'
  return 'GREEN'
}

export type Rc07FlagTone = 'normal' | 'info' | 'caution' | 'danger' | 'signature' | 'primary' | 'muted'

const RC07_FLAG_TONES: Readonly<Record<Rc07FlagCode, Rc07FlagTone>> = Object.freeze({
  GREEN: 'normal',
  BLUE: 'info',
  YELLOW: 'caution',
  WHITE: 'primary',
  RED: 'danger',
  CHECKERED: 'primary',
  BLACK: 'danger',
  MEATBALL: 'signature'
})

export interface Rc07FlagModel {
  code: Rc07FlagCode | null
  label: string
  tone: Rc07FlagTone
  stale: boolean
  unavailable: boolean
  /** True only while the blue-flag alert is latched, never as decoration. */
  duty: boolean
}

// ─────────────────────────────────────────────────────────── closing direction

export type Rc07ClosingDirection = 'closing' | 'opening' | 'steady' | 'unknown'

/**
 * Packet contradiction 2. Sections 11.1 and 15 want a closing rate; section 16 defines no
 * channel for one. The interval first difference over a real elapsed window is an honest
 * measurement of channels that DO exist, so it drives the direction glyph and the alert
 * threshold — but the glyph is direction only and no closing-rate numeral is ever rendered.
 */
export const RC07_CLOSING_SAMPLE_MIN_MS = 250
export const RC07_CLOSING_SAMPLE_MAX_MS = 3_000
export const RC07_CLOSING_DEADBAND_S_PER_S = 0.02
export const RC07_FAST_CLOSING_RATE_S_PER_S = 0.15
/** Bounds the measured window's ring; 3 s of 60 Hz frames fits comfortably inside it. */
export const RC07_CLOSING_HISTORY_LIMIT = 240

export interface Rc07IntervalSample {
  nowMs: number
  behind: number | null
  ahead: number | null
}

/** An interval is a magnitude; providers differ on whether the car behind reports negative. */
export function rc07Interval(value: number | null): number | null {
  return finite(value) ? Math.abs(value) : null
}

/**
 * A sliding window over the gap channel. The anchor is the NEWEST sample at least
 * `RC07_CLOSING_SAMPLE_MIN_MS` older than the current one, so the measurement is stable at any
 * provider cadence rather than depending on frames arriving exactly a window apart.
 *
 * It is deliberately NOT a second ingest buffer: it is only ever fed frames the shared RC-01
 * buffer has already accepted, and it resets whenever that buffer refuses one, so a new source
 * never inherits the previous car's closing history.
 */
export class Rc07ClosingTracker {
  private history: Rc07IntervalSample[] = []

  clone(): Rc07ClosingTracker {
    const next = new Rc07ClosingTracker()
    next.history = this.history.slice()
    return next
  }

  reset(): void {
    this.history = []
  }

  observe(sample: Rc07IntervalSample): void {
    if (!finite(sample.nowMs)) return
    const last = this.history.at(-1)
    if (last && sample.nowMs <= last.nowMs) return
    this.history.push(sample)
    // Anything older than the window can never anchor a measurement again.
    while (this.history.length > 1 && sample.nowMs - this.history[0].nowMs > RC07_CLOSING_SAMPLE_MAX_MS) {
      this.history.shift()
    }
    if (this.history.length > RC07_CLOSING_HISTORY_LIMIT) {
      this.history.splice(0, this.history.length - RC07_CLOSING_HISTORY_LIMIT)
    }
  }

  /** Positive means the interval is SHORTENING, in seconds of interval per second of time. */
  rate(edge: 'behind' | 'ahead'): number | null {
    const current = this.history.at(-1)
    if (!current) return null
    const to = rc07Interval(current[edge])
    if (to === null) return null
    for (let index = this.history.length - 2; index >= 0; index -= 1) {
      const candidate = this.history[index]
      const dt = current.nowMs - candidate.nowMs
      if (dt < RC07_CLOSING_SAMPLE_MIN_MS) continue
      if (dt > RC07_CLOSING_SAMPLE_MAX_MS) return null
      const from = rc07Interval(candidate[edge])
      if (from === null) return null
      return ((from - to) * 1_000) / dt
    }
    return null
  }

  direction(edge: 'behind' | 'ahead'): Rc07ClosingDirection {
    const rate = this.rate(edge)
    if (rate === null) return 'unknown'
    if (rate > RC07_CLOSING_DEADBAND_S_PER_S) return 'closing'
    if (rate < -RC07_CLOSING_DEADBAND_S_PER_S) return 'opening'
    return 'steady'
  }

  samples(): readonly Rc07IntervalSample[] {
    return this.history.slice()
  }
}

/** Packet 19: the direction is a SHAPE, and it never carries a number. */
export function rc07DirectionGlyph(direction: Rc07ClosingDirection): string {
  if (direction === 'closing') return '\u25B2'
  if (direction === 'opening') return '\u25BC'
  if (direction === 'steady') return '\u25AC'
  return '\u2013'
}

export function rc07DirectionLabel(direction: Rc07ClosingDirection): string {
  if (direction === 'closing') return 'interval shortening'
  if (direction === 'opening') return 'interval lengthening'
  if (direction === 'steady') return 'interval steady'
  return 'interval trend unavailable'
}

// ─────────────────────────────────────────────────────────── zone geometry

export interface Rc07Rect {
  left: number
  top: number
  width: number
  height: number
}

export type Rc07ZoneId = 'flag' | 'radar' | 'behind' | 'ahead' | 'self' | 'tower'

export type Rc07ZoneMap = Readonly<Partial<Record<Rc07ZoneId, Rc07Rect>>>

/**
 * Packet 11.1, verbatim percentages of the 800x480 canvas. image-qa-v1 residual 1 is a
 * normative override: the reference render inflates the flag ribbon to 8.7 % against the
 * specified 5.0 %, moves the column split to 53.6/54.9 % against 49.5/51.5 % and runs the
 * layout to 97.7 % of height against 91.7 %. Those pixels are never traced.
 */
export const RC07_NATIVE_ZONES: Readonly<Record<Exclude<Rc07ZoneId, 'tower'>, Rc07Rect>> = Object.freeze({
  flag: { left: 2.0, top: 2.1, width: 47.5, height: 5.0 },
  radar: { left: 2.0, top: 8.3, width: 47.5, height: 83.3 },
  behind: { left: 51.5, top: 8.3, width: 46.5, height: 31.3 },
  ahead: { left: 51.5, top: 41.7, width: 46.5, height: 29.1 },
  self: { left: 51.5, top: 72.9, width: 46.5, height: 18.8 }
})

/**
 * Packet 12.1 `tower-reveal`, verbatim percentages. The width buys the app-only class-coded
 * nearest-cars tower; the split spatial/scalar structure is preserved rather than scaled.
 *
 * Packet 12.1 gives the flag no zone of its own and instead folds it into the taller self
 * strip. The ribbon therefore keeps the band above the radar that 12.1 leaves unallocated —
 * the blue-flag alert must not become LESS prominent on the larger canvas — and the self
 * strip additionally carries the flag word exactly as 12.1 specifies.
 */
export const RC07_APP_ZONES: Readonly<Record<Rc07ZoneId, Rc07Rect>> = Object.freeze({
  flag: { left: 2.3, top: 1.0, width: 95.4, height: 5.5 },
  radar: { left: 2.3, top: 8.0, width: 44.9, height: 84.0 },
  behind: { left: 49.2, top: 8.0, width: 29.3, height: 28.3 },
  ahead: { left: 49.2, top: 38.7, width: 29.3, height: 25.0 },
  self: { left: 49.2, top: 66.0, width: 29.3, height: 26.0 },
  tower: { left: 80.1, top: 8.0, width: 17.6, height: 84.0 }
})

/**
 * Compact breakpoints are not packet-specified. They keep the split grammar — radar against
 * stacked class-coded gap panels over a self strip — and drop only the app-only tower, so all
 * three alerts keep a visible surface at every size.
 */
const RC07_PHONE_ZONES: Readonly<Record<Exclude<Rc07ZoneId, 'tower'>, Rc07Rect>> = Object.freeze({
  flag: { left: 2, top: 1, width: 96, height: 5 },
  radar: { left: 2, top: 7, width: 96, height: 45 },
  behind: { left: 2, top: 53.5, width: 47, height: 21 },
  ahead: { left: 51, top: 53.5, width: 47, height: 21 },
  self: { left: 2, top: 76, width: 96, height: 20 }
})

const RC07_LANDSCAPE_ZONES: Readonly<Record<Exclude<Rc07ZoneId, 'tower'>, Rc07Rect>> = Object.freeze({
  flag: { left: 2, top: 1.5, width: 47, height: 7 },
  radar: { left: 2, top: 10, width: 47, height: 86 },
  behind: { left: 51, top: 10, width: 47, height: 28 },
  ahead: { left: 51, top: 40, width: 47, height: 26 },
  self: { left: 51, top: 68, width: 47, height: 28 }
})

const RC07_STANDARD_ZONES: Readonly<Record<Exclude<Rc07ZoneId, 'tower'>, Rc07Rect>> = Object.freeze({
  flag: { left: 2, top: 1.5, width: 96, height: 6 },
  radar: { left: 2, top: 9, width: 48, height: 87 },
  behind: { left: 52, top: 9, width: 46, height: 28 },
  ahead: { left: 52, top: 39, width: 46, height: 26 },
  self: { left: 52, top: 67, width: 46, height: 29 }
})

export function rc07ZonesForLayout(layout: Rc07Layout, compactMode: Rc07CompactMode = 'standard'): Rc07ZoneMap {
  if (layout === 'native') return RC07_NATIVE_ZONES
  if (layout === 'app') return RC07_APP_ZONES
  if (compactMode === 'phone') return RC07_PHONE_ZONES
  if (compactMode === 'landscape') return RC07_LANDSCAPE_ZONES
  return RC07_STANDARD_ZONES
}

/** The inline geometry a zone element carries, so CSS and the packet table cannot drift. */
export function rc07ZoneStyle(rect: Rc07Rect | undefined): {
  left: string
  top: string
  width: string
  height: string
} | null {
  if (!rect) return null
  return {
    left: `${rect.left}%`,
    top: `${rect.top}%`,
    width: `${rect.width}%`,
    height: `${rect.height}%`
  }
}

export function rc07RectsOverlap(a: Rc07Rect, b: Rc07Rect): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  )
}

/** A 0..100 plot coordinate as a CSS percentage, without binary-float noise in the DOM. */
export function rc07Percent(value: number): string {
  const safe = finite(value) ? value : 0
  return `${Math.round(safe * 1_000) / 1_000}%`
}

// ─────────────────────────────────────────────────────────── layout resolution

export function rc07LayoutForContentBox(width: number, height: number): Rc07Layout {
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return 'app'
  if (
    Math.abs(width - RC07_NATIVE_WIDTH_PX) <= RC07_NATIVE_TOLERANCE_PX &&
    Math.abs(height - RC07_NATIVE_HEIGHT_PX) <= RC07_NATIVE_TOLERANCE_PX
  ) {
    return 'native'
  }
  if (width >= RC07_APP_WIDTH_PX - 1 && height >= RC07_APP_HEIGHT_PX - 1) return 'app'
  return 'compact'
}

export function rc07CompactModeForContentBox(width: number, height: number): Rc07CompactMode {
  if (rc07LayoutForContentBox(width, height) !== 'compact') return 'standard'
  if (
    width >= RC07_PHONE_MIN_WIDTH_PX &&
    width <= RC07_PHONE_MAX_WIDTH_PX &&
    height >= RC07_PHONE_MIN_HEIGHT_PX &&
    height / width >= 1.5
  ) {
    return 'phone'
  }
  if (
    width >= RC07_LANDSCAPE_MIN_WIDTH_PX &&
    height >= RC07_LANDSCAPE_MIN_HEIGHT_PX &&
    height <= RC07_LANDSCAPE_MAX_HEIGHT_PX &&
    width / height >= 1.5
  ) {
    return 'landscape'
  }
  return 'standard'
}

export interface Rc07PhoneGeometry {
  inset: number
  flagHeight: number
  radarSize: number
  gapHeight: number
  selfHeight: number
  softKeySize: number
}

/**
 * Portrait geometry, in pixels, for the bands the phone stack sizes from the measured box
 * rather than from a percentage. The radar stays square — a stretched radar would misreport
 * the angle of every contact — so its size is bounded by the narrower axis.
 */
export function rc07PhoneGeometryForContentBox(width: number, height: number): Rc07PhoneGeometry | null {
  if (rc07CompactModeForContentBox(width, height) !== 'phone') return null
  const inset = 12
  const radarSize = Math.max(120, Math.min(Math.round(width - inset * 2), Math.round(height * 0.45)))
  return {
    inset,
    flagHeight: Math.max(18, Math.round(height * 0.05)),
    radarSize,
    gapHeight: Math.round(height * 0.21),
    selfHeight: Math.round(height * 0.2),
    softKeySize: 44
  }
}

// ─────────────────────────────────────────────────────────── channel extraction

/** Packet section 16's spotter enum. The app also decides `both`, which is a third real side. */
export const RC07_SPOTTER_ZONES = ['clear', 'left', 'right', 'both'] as const
export type Rc07SpotterZone = (typeof RC07_SPOTTER_ZONES)[number]

/**
 * Every RC-07 channel is read straight from its own declared source. Nothing is modelled,
 * mirrored or substituted. In particular the gap channels are the TIMING feed intervals and
 * are never estimated from the radar geometry, and the radar is never reconstructed from the
 * gaps: packet section 16 forbids both directions explicitly.
 */
export function rc07AuxChannelValue(snapshot: TelemetrySnapshot, channel: Rc07AuxChannel): number | null {
  switch (channel) {
    // The contact COUNT is the receipt value; zero is a live source reporting clear traffic.
    case 'radar':
      return Array.isArray(snapshot.radarCars) ? snapshot.radarCars.length : null
    case 'gapBehind':
      return rc07Interval(snapshot.relatives?.behind?.gapSec ?? null)
    case 'gapAhead':
      return rc07Interval(snapshot.relatives?.ahead?.gapSec ?? null)
    case 'flag': {
      const code = rc07FlagCode(snapshot)
      return code === null ? null : RC07_FLAG_PRIORITY.indexOf(code)
    }
    case 'gear':
      return finite(snapshot.gear) && Number.isInteger(snapshot.gear) ? snapshot.gear : null
    case 'speed':
      return finite(snapshot.speedKmh) && snapshot.speedKmh >= 0 ? snapshot.speedKmh : null
    // Packet section 16: '--' until at least one measured consumption lap exists, so the
    // projection is gated on a real observed burn rate and never on a nominal tank model.
    case 'fuelLaps': {
      const burn = snapshot.fuelPerLapLiters
      const laps = snapshot.fuelLapsRemaining
      if (!finite(burn) || burn <= 0) return null
      return finite(laps) && laps >= 0 ? laps : null
    }
    case 'spotter': {
      const zone = snapshot.carLeftRight
      const index = RC07_SPOTTER_ZONES.indexOf(zone as Rc07SpotterZone)
      return index < 0 ? null : index
    }
  }
  return null
}

/**
 * Receipts for RC-07's own channels, with exactly RC-01's semantics: a receipt is written only
 * when the channel actually reports, so a channel that falls silent ages out and degrades to
 * its dash state instead of freezing on its last value.
 */
export class Rc07AuxBuffer {
  private channelReceipts = new Map<Rc07AuxChannel, Rc01ChannelReceipt>()

  clone(): Rc07AuxBuffer {
    const next = new Rc07AuxBuffer()
    next.channelReceipts = new Map(this.channelReceipts)
    return next
  }

  reset(): void {
    this.channelReceipts = new Map()
  }

  ingest(snapshot: TelemetrySnapshot | null | undefined, receivedAt = rc01MonotonicNow()): void {
    if (!snapshot || !snapshot.connected || !finite(snapshot.timestamp)) return
    const safeReceiptAt = finite(receivedAt) && receivedAt >= 0 ? receivedAt : rc01MonotonicNow()
    for (const channel of Object.keys(RC07_CHANNEL_STALE_MS) as Rc07AuxChannel[]) {
      const value = rc07AuxChannelValue(snapshot, channel)
      if (value === null) continue
      this.channelReceipts.set(
        channel,
        Object.freeze({ value, snapshotTimestamp: snapshot.timestamp, receivedAt: safeReceiptAt })
      )
    }
  }

  receipts(): ReadonlyMap<Rc07AuxChannel, Rc01ChannelReceipt> {
    return new Map(this.channelReceipts)
  }
}

export function createRc07AuxReceipts(
  snapshot: TelemetrySnapshot,
  receivedAt = rc01MonotonicNow()
): ReadonlyMap<Rc07AuxChannel, Rc01ChannelReceipt> {
  const buffer = new Rc07AuxBuffer()
  buffer.ingest(snapshot, receivedAt)
  return buffer.receipts()
}

interface Rc07Reading {
  value: number | null
  lastKnown: number | null
  stale: boolean
  ageMs: number
}

function auxReading(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc07AuxChannel, Rc01ChannelReceipt>,
  channel: Rc07AuxChannel,
  nowMs: number
): Rc07Reading {
  const raw = snapshot ? rc07AuxChannelValue(snapshot, channel) : null
  const receipt = receipts.get(channel)
  if (raw === null || !receipt) {
    return { value: null, lastKnown: null, stale: false, ageMs: Number.POSITIVE_INFINITY }
  }
  const ageMs = rc01ReceiptAgeMs(receipt, nowMs)
  const stale = ageMs > RC07_CHANNEL_STALE_MS[channel]
  return {
    value: stale ? null : raw,
    lastKnown: typeof receipt.value === 'number' ? receipt.value : null,
    stale,
    ageMs
  }
}

// ─────────────────────────────────────────────────────────── alerts

export const RC07_BLUE_FLAG_MIN_VISIBLE_MS = 1_000
export const RC07_FAST_CLOSING_ENGAGE_MS = 300
export const RC07_FAST_CLOSING_RELEASE_MS = 600
export const RC07_IMMINENT_ENGAGE_MS = 100

export interface Rc07AlertState {
  blueFlag: { active: boolean; minimumVisibleUntilMs: number }
  fastClosing: { active: boolean; pendingSinceMs: number | null; releaseSinceMs: number | null }
  imminent: { active: boolean; pendingSinceMs: number | null; side: Rc07CriticalSide | null }
}

export interface Rc07AlertInput {
  nowMs: number
  /** `null` is a MISSING flag feed, which can neither engage nor hold the duty alert. */
  blueFlag: boolean | null
  radarAvailable: boolean
  /** Positive means the interval behind is shortening; `null` means not measurable yet. */
  closingRateBehind: number | null
  /** Packet 15 scopes the alert to a car actually inside the radar range. */
  closingContactInRange: boolean
  criticalSide: Rc07CriticalSide | null
}

export function createRc07AlertState(): Rc07AlertState {
  return {
    blueFlag: { active: false, minimumVisibleUntilMs: 0 },
    fastClosing: { active: false, pendingSinceMs: null, releaseSinceMs: null },
    imminent: { active: false, pendingSinceMs: null, side: null }
  }
}

function cloneRc07AlertState(state: Rc07AlertState): Rc07AlertState {
  return {
    blueFlag: { ...state.blueFlag },
    fastClosing: { ...state.fastClosing },
    imminent: { ...state.imminent }
  }
}

/**
 * Every alert is silent until its own trigger fires, carries the packet section 15 debounce
 * and hysteresis, has an explicit clear condition, and is unlatched the moment its input goes
 * missing or stale. No element of the alert layer is ever an always-on decoration.
 */
export function advanceRc07Alerts(state: Rc07AlertState, input: Rc07AlertInput): Rc07AlertState {
  const nowMs = finite(input.nowMs) ? input.nowMs : 0
  const next = cloneRc07AlertState(state)

  // ── Blue-flag duty: an event alert with a 1 s minimum display. A MISSING feed unlatches it
  //    outright — the packet forbids assuming clear, and it equally forbids inventing a duty.
  if (input.blueFlag === null) {
    next.blueFlag = { active: false, minimumVisibleUntilMs: 0 }
  } else if (input.blueFlag) {
    next.blueFlag = {
      active: true,
      minimumVisibleUntilMs: Math.max(next.blueFlag.minimumVisibleUntilMs, nowMs + RC07_BLUE_FLAG_MIN_VISIBLE_MS)
    }
  } else if (next.blueFlag.active && nowMs < next.blueFlag.minimumVisibleUntilMs) {
    next.blueFlag = { ...next.blueFlag, active: true }
  } else {
    next.blueFlag = { active: false, minimumVisibleUntilMs: 0 }
  }

  // ── Fast closing behind: 300 ms to engage, 600 ms of hysteresis to release. Without the
  //    radar, without a contact in range or without a measurable rate there is nothing to
  //    judge, so the alert is disarmed rather than held on its last decision.
  if (!input.radarAvailable || !input.closingContactInRange || input.closingRateBehind === null) {
    next.fastClosing = { active: false, pendingSinceMs: null, releaseSinceMs: null }
  } else if (input.closingRateBehind > RC07_FAST_CLOSING_RATE_S_PER_S) {
    const pendingSinceMs = next.fastClosing.pendingSinceMs ?? nowMs
    const engaged = next.fastClosing.active || nowMs - pendingSinceMs >= RC07_FAST_CLOSING_ENGAGE_MS
    next.fastClosing = { active: engaged, pendingSinceMs, releaseSinceMs: null }
  } else if (next.fastClosing.active) {
    const releaseSinceMs = next.fastClosing.releaseSinceMs ?? nowMs
    const released = nowMs - releaseSinceMs >= RC07_FAST_CLOSING_RELEASE_MS
    next.fastClosing = released
      ? { active: false, pendingSinceMs: null, releaseSinceMs: null }
      : { active: true, pendingSinceMs: null, releaseSinceMs }
  } else {
    next.fastClosing = { active: false, pendingSinceMs: null, releaseSinceMs: null }
  }

  // ── Imminent proximity: 100 ms to engage, cleared the instant the object leaves the zone,
  //    and hidden entirely when the radar source is unavailable.
  if (!input.radarAvailable || input.criticalSide === null) {
    next.imminent = { active: false, pendingSinceMs: null, side: null }
  } else {
    const pendingSinceMs = next.imminent.pendingSinceMs ?? nowMs
    const engaged = next.imminent.active || nowMs - pendingSinceMs >= RC07_IMMINENT_ENGAGE_MS
    next.imminent = { active: engaged, pendingSinceMs, side: engaged ? input.criticalSide : null }
  }

  return next
}

/** A stale, missing or refused input can never leave a traffic alert latched on. */
export function clearInvalidRc07Alerts(state: Rc07AlertState, model: Rc07DashboardModel): Rc07AlertState {
  const next = cloneRc07AlertState(state)
  if (model.flag.unavailable || model.flag.code === null) {
    next.blueFlag = { active: false, minimumVisibleUntilMs: 0 }
  }
  if (!model.radar.available) {
    next.fastClosing = { active: false, pendingSinceMs: null, releaseSinceMs: null }
    next.imminent = { active: false, pendingSinceMs: null, side: null }
  }
  if (model.behind.field.unavailable) {
    next.fastClosing = { active: false, pendingSinceMs: null, releaseSinceMs: null }
  }
  return next
}

/** The alert lines a surface renders; empty in a silent frame, which is the reference state. */
export function rc07AlertLines(model: Rc07DashboardModel): readonly string[] {
  const lines: string[] = []
  if (model.alerts.blueFlag) lines.push('BLUE')
  if (model.alerts.fastClosing) lines.push('CLOSING')
  if (model.alerts.imminent) lines.push('PROXIMITY')
  return lines
}

// ─────────────────────────────────────────────────────────── dashboard model

export interface Rc07GapPanel {
  field: Rc01Field
  seconds: number | null
  classCode: Rc07ClassCode | null
  classLabel: string
  classTone: Rc07ClassTone
  direction: Rc07ClosingDirection
  directionGlyph: string
  directionLabel: string
  /** True only while the packet 15 fast-closing alert is latched on this panel. */
  highlight: boolean
}

export interface Rc07RadarModel {
  available: boolean
  status: 'LIVE' | 'NO DATA'
  blips: readonly Rc07Blip[]
  contactCount: number
  rangeM: number
  rangeIndex: number
  rangeSource: 'auto' | 'manual' | 'default'
  plotUnits: number
  innerRingUnits: number
  outerRingUnits: number
  criticalDistanceM: number
  criticalSide: Rc07CriticalSide | null
  stale: boolean
}

export interface Rc07SpotterModel {
  zone: Rc07SpotterZone | null
  label: string
  unavailable: boolean
  stale: boolean
}

export interface Rc07TowerRow {
  carIdx: number | null
  carNumber: string
  classCode: Rc07ClassCode | null
  classLabel: string
  classTone: Rc07ClassTone
  gapField: Rc01Field
  gapSec: number
}

export interface Rc07AlertFlags {
  blueFlag: boolean
  fastClosing: boolean
  imminent: boolean
}

export interface Rc07DashboardModel {
  flag: Rc07FlagModel
  radar: Rc07RadarModel
  behind: Rc07GapPanel
  ahead: Rc07GapPanel
  position: Rc01Field
  delta: Rc01Field
  gear: Rc01Field
  speed: Rc01Field
  fuelLaps: Rc01Field
  spotter: Rc07SpotterModel
  /** Packet 12.1 app-only nearest-cars tower; empty whenever the timing feed cannot fill it. */
  tower: readonly Rc07TowerRow[]
  towerAvailable: boolean
  alerts: Rc07AlertFlags
  classOrder: readonly number[]
  auxFresh: Readonly<Record<Rc07AuxChannel, boolean>>
  criticalFresh: Readonly<Record<Rc01ChannelName, boolean>>
}

export interface Rc07ModelOptions {
  alerts?: Rc07AlertState
  /** `'auto'` follows speed; an integer is the soft-key's manual override. */
  rangeIndex?: number | 'auto'
  behindDirection?: Rc07ClosingDirection
  aheadDirection?: Rc07ClosingDirection
}

export const RC07_TOWER_ROW_LIMIT = 5

function gapPanel(
  reading: Rc07Reading,
  classCode: Rc07ClassCode | null,
  direction: Rc07ClosingDirection,
  highlight: boolean
): Rc07GapPanel {
  const seconds = reading.value
  return {
    field:
      seconds === null
        ? field('--.-', null, reading.stale, true, 'muted')
        : field(seconds.toFixed(1), seconds, false, false, 'primary'),
    seconds,
    classCode: seconds === null ? null : classCode,
    classLabel: rc07ClassLabel(seconds === null ? null : classCode),
    classTone: rc07ClassTone(seconds === null ? null : classCode),
    // Without a live interval there is nothing to take a first difference of.
    direction: seconds === null ? 'unknown' : direction,
    directionGlyph: rc07DirectionGlyph(seconds === null ? 'unknown' : direction),
    directionLabel: rc07DirectionLabel(seconds === null ? 'unknown' : direction),
    highlight
  }
}

/**
 * Packet 12.1's nearest-cars tower. It is a TIMING tower: the rows come from the timing feed's
 * own interval to the player, ordered by absolute interval, never from the radar geometry.
 */
export function rc07TowerRows(
  snapshot: TelemetrySnapshot | null,
  order: readonly number[],
  limit = RC07_TOWER_ROW_LIMIT
): readonly Rc07TowerRow[] {
  const drivers = snapshot?.drivers
  if (!Array.isArray(drivers)) return []
  const playerIdx = finite(snapshot?.playerCarIdx) ? snapshot!.playerCarIdx : null
  const rows = drivers
    .filter(
      (driver) =>
        driver &&
        !driver.isPlayer &&
        !driver.isPaceCar &&
        driver.carIdx !== playerIdx &&
        finite(driver.gapToPlayerSec)
    )
    .map((driver) => {
      const gapSec = driver.gapToPlayerSec as number
      const classCode = rc07ClassCodeForId(driver.classId, order)
      return {
        carIdx: finite(driver.carIdx) ? driver.carIdx : null,
        carNumber: typeof driver.carNumber === 'string' && driver.carNumber.length > 0 ? driver.carNumber : '--',
        classCode,
        classLabel: rc07ClassLabel(classCode),
        classTone: rc07ClassTone(classCode),
        gapField: field(`${gapSec >= 0 ? '+' : '-'}${Math.abs(gapSec).toFixed(1)}`, gapSec, false, false, 'primary'),
        gapSec
      }
    })
    .sort((a, b) => Math.abs(a.gapSec) - Math.abs(b.gapSec) || (a.carIdx ?? 0) - (b.carIdx ?? 0))
  return rows.slice(0, limit)
}

/**
 * Projects the shared RC-01 telemetry model into RC-07's awareness display and adds the
 * traffic channels. Nothing is invented, estimated or mirrored: the radar is hidden rather
 * than populated with a phantom, the flag never defaults to green, a gap is never estimated
 * from the radar and every unavailable channel renders its packet dash state.
 */
export function createRc07DashboardModel(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc01ChannelName, Rc01ChannelReceipt> = new Map(),
  auxReceipts: ReadonlyMap<Rc07AuxChannel, Rc01ChannelReceipt> = new Map(),
  nowMs = rc01MonotonicNow(),
  options: Rc07ModelOptions = {}
): Rc07DashboardModel {
  const base: Rc01DashboardModel = createRc01DashboardModel(snapshot, receipts, nowMs)
  const safeSnapshot = snapshot && snapshot.connected ? snapshot : null
  const alerts = options.alerts ?? createRc07AlertState()
  const requestedRange = options.rangeIndex ?? 'auto'

  const auxFresh = Object.fromEntries(
    (Object.keys(RC07_CHANNEL_STALE_MS) as Rc07AuxChannel[]).map((channel) => [
      channel,
      auxReading(safeSnapshot, auxReceipts, channel, nowMs).value !== null
    ])
  ) as Record<Rc07AuxChannel, boolean>

  const classOrder = rc07ClassOrder(safeSnapshot)

  // ── Speed: greys past its 100 ms cadence, collapses to '---' past the 500 ms budget. It is
  //    also the auto-range input, and an unavailable speed falls back to the default range
  //    rather than to a guessed one.
  const speedReading = auxReading(safeSnapshot, auxReceipts, 'speed', nowMs)
  const speedDashed = speedReading.value === null && speedReading.ageMs > RC07_SPEED_DASH_MS
  const speed =
    speedReading.value !== null
      ? field(String(Math.round(speedReading.value)), speedReading.value, false, false, 'primary')
      : !speedDashed && speedReading.lastKnown !== null
        ? field(String(Math.round(speedReading.lastKnown)), speedReading.lastKnown, true, false, 'muted')
        : field('---', null, speedReading.stale, true, 'muted')

  const autoIndex = rc07AutoRangeIndex(speedReading.value)
  const rangeIndex =
    requestedRange === 'auto' ? (autoIndex ?? RC07_RADAR_DEFAULT_RANGE_INDEX) : requestedRange
  const safeRangeIndex =
    Number.isInteger(rangeIndex) && rangeIndex >= 0 && rangeIndex < RC07_RADAR_RANGES_M.length
      ? rangeIndex
      : RC07_RADAR_DEFAULT_RANGE_INDEX
  const rangeSource: Rc07RadarModel['rangeSource'] =
    requestedRange !== 'auto' ? 'manual' : autoIndex === null ? 'default' : 'auto'
  const rangeM = RC07_RADAR_RANGES_M[safeRangeIndex]

  // ── Radar. An absent source hides the plot; an empty live source draws an empty plot. The
  //    two are never conflated, and a blip is never synthesised from the gap channels.
  const radarReading = auxReading(safeSnapshot, auxReceipts, 'radar', nowMs)
  const contacts = radarReading.value === null ? null : rc07RadarContacts(safeSnapshot, classOrder)
  const blips = contacts === null ? [] : rc07RadarBlips(contacts, rangeM)
  const criticalSide = rc07CriticalSide(blips)
  const radar: Rc07RadarModel = {
    available: contacts !== null,
    status: contacts !== null ? 'LIVE' : 'NO DATA',
    blips,
    contactCount: blips.length,
    rangeM,
    rangeIndex: safeRangeIndex,
    rangeSource,
    plotUnits: RC07_RADAR_PLOT_UNITS,
    innerRingUnits: RC07_RADAR_INNER_RING_UNITS,
    outerRingUnits: RC07_RADAR_OUTER_RING_UNITS,
    criticalDistanceM: rangeM * RC07_RADAR_CRITICAL_FRACTION,
    criticalSide,
    stale: radarReading.stale
  }

  // ── Flag ribbon. A missing or unrecognised race-control feed is NO SIGNAL, never green.
  const flagReading = auxReading(safeSnapshot, auxReceipts, 'flag', nowMs)
  const flagCode = flagReading.value === null ? null : rc07FlagCode(safeSnapshot)
  const flag: Rc07FlagModel = {
    code: flagCode,
    label: flagCode ?? RC07_FLAG_NO_SIGNAL,
    tone: flagCode === null ? 'muted' : RC07_FLAG_TONES[flagCode],
    stale: flagReading.stale,
    unavailable: flagCode === null,
    duty: alerts.blueFlag.active
  }

  // ── Gap panels. These are the TIMING feed intervals; the class badge is the timing feed's
  //    own class id for that car, mapped onto the packet's generic letters.
  const behindReading = auxReading(safeSnapshot, auxReceipts, 'gapBehind', nowMs)
  const aheadReading = auxReading(safeSnapshot, auxReceipts, 'gapAhead', nowMs)
  const behind = gapPanel(
    behindReading,
    rc07ClassCodeForCar(safeSnapshot, safeSnapshot?.relatives?.behind?.carIdx ?? null, classOrder),
    options.behindDirection ?? 'unknown',
    alerts.fastClosing.active
  )
  const ahead = gapPanel(
    aheadReading,
    rc07ClassCodeForCar(safeSnapshot, safeSnapshot?.relatives?.ahead?.carIdx ?? null, classOrder),
    options.aheadDirection ?? 'unknown',
    false
  )

  // ── Position and delta come from the shared RC-01 model: its budgets are already the
  //    packet's, and it already refuses a delta without a real stored best lap.
  const positionRaw = base.position.raw
  const position =
    base.position.unavailable || !finite(positionRaw)
      ? field('--', null, base.position.stale, true, 'muted')
      : field(String(Math.trunc(positionRaw)), positionRaw, base.position.stale, false, base.position.stale ? 'muted' : 'primary')

  const deltaRaw = base.delta.raw
  const delta =
    base.delta.unavailable || base.delta.stale || !finite(deltaRaw)
      ? field('--.---', null, base.delta.stale, base.delta.unavailable, 'muted')
      : field(
          `${deltaRaw >= 0 ? '+' : '-'}${Math.abs(deltaRaw).toFixed(3)}`,
          deltaRaw,
          false,
          false,
          deltaRaw < 0 ? 'good' : deltaRaw > 0 ? 'bad' : 'primary'
        )

  // ── Gear: the ECU gear channel, never derived from RPM or speed, never blanked silently.
  const gearReading = auxReading(safeSnapshot, auxReceipts, 'gear', nowMs)
  const gear =
    gearReading.value === null
      ? field('-', null, gearReading.stale, true, 'muted')
      : field(rc07DisplayGear(gearReading.value), gearReading.value, false, false, 'primary')

  const fuelReading = auxReading(safeSnapshot, auxReceipts, 'fuelLaps', nowMs)
  const fuelLaps =
    fuelReading.value === null
      ? field('--', null, fuelReading.stale, true, 'muted')
      : field(fuelReading.value.toFixed(1), fuelReading.value, false, false, 'primary')

  const spotterReading = auxReading(safeSnapshot, auxReceipts, 'spotter', nowMs)
  const spotterZone =
    spotterReading.value === null ? null : (RC07_SPOTTER_ZONES[spotterReading.value] ?? null)
  const spotter: Rc07SpotterModel = {
    zone: spotterZone,
    label: spotterZone === null ? 'NO DATA' : spotterZone.toUpperCase(),
    unavailable: spotterZone === null,
    stale: spotterReading.stale
  }

  const tower = rc07TowerRows(safeSnapshot, classOrder)

  return {
    flag,
    radar,
    behind,
    ahead,
    position,
    delta,
    gear,
    speed,
    fuelLaps,
    spotter,
    tower,
    towerAvailable: tower.length > 0,
    alerts: {
      blueFlag: alerts.blueFlag.active,
      fastClosing: alerts.fastClosing.active,
      imminent: alerts.imminent.active
    },
    classOrder,
    auxFresh,
    criticalFresh: base.criticalFresh
  }
}

/** Packet section 16: 'N' or the grey '-'; a gear is never blanked silently. */
export function rc07DisplayGear(gear: number | null): string {
  if (gear === null || !finite(gear)) return '-'
  if (gear < 0) return 'R'
  if (gear === 0) return 'N'
  return String(Math.trunc(gear))
}

/** The alert-layer inputs, all gated on freshness so a frozen frame can never engage anything. */
export function rc07AlertInputForModel(
  model: Rc07DashboardModel,
  closingRateBehind: number | null,
  nowMs: number
): Rc07AlertInput {
  const contactBehind = model.radar.blips.some((blip) => blip.longitudinal === 'behind')
  return {
    nowMs,
    blueFlag: model.flag.code === null ? null : model.flag.code === 'BLUE',
    radarAvailable: model.radar.available,
    closingRateBehind: model.behind.field.unavailable ? null : closingRateBehind,
    closingContactInRange: contactBehind,
    criticalSide: model.radar.criticalSide
  }
}

/** Accessible description for a gap panel: class, interval and trend, never colour. */
export function rc07GapDescription(label: string, panel: Rc07GapPanel): string {
  if (panel.seconds === null) return `${label} interval unavailable`
  const klass = panel.classCode === null ? 'unknown class' : `class ${panel.classCode}`
  return `${label} ${panel.field.value} seconds, ${klass}, ${panel.directionLabel}`
}

/** Accessible description for a radar blip: class, side, longitudinal position and distance. */
export function rc07BlipDescription(blip: Rc07Blip): string {
  const klass = blip.classCode === null ? 'unknown class' : `class ${blip.classCode}`
  const side = blip.side === 'center' ? 'directly' : blip.side
  return `${klass} ${side} ${blip.longitudinal}, ${Math.round(blip.distanceM)} metres${blip.critical ? ', critical proximity' : ''}`
}

export type { Rc01Field as Rc07Field }
