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
 * RC-08 "Rain Line — Changing Wet Conditions" core.
 *
 * The live-only ingest buffer, identity binding, mock/replay refusal, out-of-order and
 * same-timestamp guards and the shared channel receipts are reused verbatim from the RC-01
 * core: that is telemetry-truth machinery, not RC-01 styling, and a fork would silently
 * drift. This module adds only what RC-08's packet needs and the shared layer does not have:
 * the grip-state enum and its source resolution, the grip-adaptive column weighting that IS
 * the artifact's visual thesis, the wet-window crossover, the measured grip history and the
 * three condition-gated alerts.
 *
 * Delta to best is taken from the shared RC-01 model rather than re-read here: RC-01's budget
 * is already the packet's (per sample) and RC-01 already refuses a delta without a real stored
 * best lap, which is exactly packet section 16's rule. Every other RC-08 channel has a packet
 * budget RC-01 does not carry and lives in the aux table below.
 *
 * Four packet contradictions are resolved here, and each one is asserted by the test suite
 * through `RC08_PACKET_OMISSIONS` so a later edit cannot quietly reintroduce them.
 */

/** Packet section 11.1 native canvas, and the section 12.1 app reflow target. */
export const RC08_NATIVE_WIDTH_PX = 800
export const RC08_NATIVE_HEIGHT_PX = 480
export const RC08_NATIVE_TOLERANCE_PX = 1
export const RC08_APP_WIDTH_PX = 1024
export const RC08_APP_HEIGHT_PX = 600

export const RC08_PHONE_MIN_WIDTH_PX = 360
export const RC08_PHONE_MAX_WIDTH_PX = 480
export const RC08_PHONE_MIN_HEIGHT_PX = 650
export const RC08_LANDSCAPE_MIN_WIDTH_PX = 650
export const RC08_LANDSCAPE_MIN_HEIGHT_PX = 360
export const RC08_LANDSCAPE_MAX_HEIGHT_PX = 480

export type Rc08CompactMode = 'phone' | 'landscape' | 'standard'
export type Rc08Layout = 'native' | 'app' | 'compact'

/**
 * The packet requirements this build deliberately does NOT render, with the reason. Each key
 * is asserted by the suite: the omission is part of the contract, not an oversight.
 *
 *  - `shiftArc`      packet 11.4 defines a conservative wet shift-light profile and section 16
 *                    defines the `Shift indicator` channel (computed rpm/maxRpm, gear-aware,
 *                    20 ms, "LED arc dark if RPM invalid"), but section 11.1 defines NO zone
 *                    for the arc anywhere in the 800x480 grammar and section 17's source
 *                    prompt never mentions LEDs. image-qa-v1 measured zero LED segments in
 *                    either edge strip of the approved frame. No geometry is invented: there
 *                    is no `rpm` entry in `RC08_CHANNEL_STALE_MS` and no rev, shift or arc
 *                    element anywhere in the widget or the stylesheet.
 *  - `rainRateNumeral` section 11.5 says the rain rate "is dashed"; sections 16 and 19 both
 *                    require the explicit word `UNAVAILABLE`. 16 and 19 win. The app carries
 *                    no mm/h channel at all — `precipitationPct` is a percentage and a wiper
 *                    input is explicitly forbidden as a source — so the row renders the word
 *                    and never a numeral, on every frame, at every breakpoint.
 *  - `wetWindowReadout` normative override 6: the 50-80 degC wet window is a declared
 *                    CONFIGURATION constant, not telemetry, so neither bound is ever printed.
 *                    Only the measured corner temperature and its crossover side are shown.
 *  - `gripPercentNumeral` section 16 gives the grip channel the unit "% / enum" but sections
 *                    11.1 and 19 render it as a WORD chip plus a hue, and 11.1 allocates no
 *                    zone for a wetness percentage. The raw percentage stays in the model as
 *                    the quantiser's input and is never surfaced as a numeral.
 */
export const RC08_PACKET_OMISSIONS = Object.freeze({
  shiftArc: 'packet 11.4/16 shift indicator: section 11.1 allocates the arc no zone at all',
  rainRateNumeral: 'packet 11.5 "dashed" loses to 16/19 "UNAVAILABLE"; no mm/h channel exists',
  wetWindowReadout: 'packet override 6: the wet window is configuration, never a readout',
  gripPercentNumeral: 'packet 16 unit "% / enum": 11.1 and 19 render the word chip, not a %'
})

// ─────────────────────────────────────────────────────────── grip state

/**
 * Packet section 11.1's explicit state chip. The word is always rendered next to the hue, so
 * grip is never encoded by colour alone (packet 19), and the ordering is the wetness ordering
 * the packet 15 "grip drop" trigger is defined against.
 */
export const RC08_GRIP_STATES = ['DRY', 'DAMP', 'WET', 'FLOOD'] as const
export type Rc08GripState = (typeof RC08_GRIP_STATES)[number]

/** Packet 16's unavailable rendering for the grip channel: the word, never a guess. */
export const RC08_GRIP_UNAVAILABLE = 'UNAVAILABLE'

/**
 * The packet's own "% / enum" quantisation, applied to the measured track-condition feed and
 * to nothing else. Section 16 forbids inferring wetness from lap delta and section 20 repeats
 * it, so `deltaToBestSec`, lap time, wiper state and rain iconography are never inputs here.
 *
 * Each band is `[inclusive lower bound, exclusive upper bound]` of the 0..1 wetness fraction.
 */
export const RC08_GRIP_STATE_BANDS: Readonly<Record<Rc08GripState, readonly [number, number]>> =
  Object.freeze({
    DRY: [0, 0.1],
    DAMP: [0.1, 0.35],
    WET: [0.35, 0.75],
    FLOOD: [0.75, Number.POSITIVE_INFINITY]
  })

/**
 * Grip hue binding. This is a DOCUMENTED PACKET GAP: section 11.3 lists the palette tokens but
 * never binds one to each grip state, so the binding is declared here once and asserted by the
 * suite. `info` #5AB0E6 is reserved for the cold-tyre marker and reused as the DAMP hue because
 * the packet's own DAMP semantics are "cooler than wet blue"; `caution` #F0B93A is reserved for
 * the alert layer alone and is therefore bound to no grip state at all.
 */
export const RC08_GRIP_HUES: Readonly<Record<Rc08GripState, string>> = Object.freeze({
  DRY: '#3CC7B0',
  DAMP: '#5AB0E6',
  WET: '#2E86FF',
  FLOOD: '#F0523E'
})

/** Packet 11.3 tokens, verbatim. The four alert tokens appear only on alert surfaces. */
export const RC08_TOKENS = Object.freeze({
  bg: '#06090C',
  panel: '#0F1620',
  primary: '#E9F1F6',
  secondary: '#7E93A3',
  info: '#5AB0E6',
  normal: '#3CC7B0',
  caution: '#F0B93A',
  danger: '#F0523E',
  signature: '#2E86FF'
})

export type Rc08GripSource = 'sensor' | 'driver' | 'none'

/** The driver toggle packet 11.5 sanctions as the SECOND lawful grip-state source. */
export const RC08_GRIP_TOGGLE_EVENT = 'racecon:rain-line-grip-state'

export function rc08GripRank(state: Rc08GripState | null): number | null {
  if (state === null) return null
  const index = RC08_GRIP_STATES.indexOf(state)
  return index < 0 ? null : index
}

/** Quantises the measured wetness fraction into the packet's enum. Never called on a proxy. */
export function rc08GripStateForWetness(wetnessPct: number | null): Rc08GripState | null {
  if (wetnessPct === null || !finite(wetnessPct) || wetnessPct < 0) return null
  for (const state of RC08_GRIP_STATES) {
    const [low, high] = RC08_GRIP_STATE_BANDS[state]
    if (wetnessPct >= low && wetnessPct < high) return state
  }
  return null
}

/** Only a recognised state word changes the display; an unknown payload is ignored outright. */
export function rc08GripStateFromEvent(detail: unknown): Rc08GripState | 'auto' | null {
  if (detail === 'auto' || detail === null) return 'auto'
  const raw =
    typeof detail === 'string'
      ? detail
      : typeof detail === 'object' && detail !== null && 'state' in detail
        ? (detail as { state?: unknown }).state
        : null
  if (typeof raw !== 'string') return null
  const upper = raw.trim().toUpperCase()
  if (upper === 'AUTO') return 'auto'
  return (RC08_GRIP_STATES as readonly string[]).includes(upper) ? (upper as Rc08GripState) : null
}

// ─────────────────────────────────────────────────────────── channels

/**
 * Packet section 16 freshness budgets. Tyre corners 200 ms, gear 50 ms and speed 100 ms are
 * verbatim. Grip state, TC step, ABS step and brake bias are declared "event" or "on change":
 * they only CHANGE on an event, but every provider that carries them republishes them on each
 * frame, so their budget is a TRANSPORT budget — generous next to the hero channels but
 * finite, so a provider that falls silent ages the value out into its packet degradation
 * instead of freezing on it.
 *
 * There is deliberately NO `rpm` entry (`RC08_PACKET_OMISSIONS.shiftArc`) and NO `rainRate`
 * entry (`RC08_PACKET_OMISSIONS.rainRateNumeral`): the app carries no mm/h source and section
 * 16 forbids estimating one from the wiper input.
 */
export const RC08_CHANNEL_STALE_MS = {
  grip: 2_000,
  tc: 2_000,
  abs: 2_000,
  brakeBias: 2_000,
  tyreFl: 200,
  tyreFr: 200,
  tyreRl: 200,
  tyreRr: 200,
  gear: 50,
  speed: 100
} as const

export type Rc08AuxChannel = keyof typeof RC08_CHANNEL_STALE_MS

/**
 * Packet section 16: speed greys as soon as it misses its 100 ms cadence but only collapses to
 * the three-character dash once the source has been quiet for more than 500 ms.
 */
export const RC08_SPEED_DASH_MS = 500

/** Packet 11.1's tyre grid, in the reference frame's own reading order. */
export const RC08_CORNERS = ['FL', 'FR', 'RL', 'RR'] as const
export type Rc08Corner = (typeof RC08_CORNERS)[number]

export const RC08_CORNER_CHANNELS: Readonly<Record<Rc08Corner, Rc08AuxChannel>> = Object.freeze({
  FL: 'tyreFl',
  FR: 'tyreFr',
  RL: 'tyreRl',
  RR: 'tyreRr'
})

/**
 * Normative override 6: a declared CONFIGURATION constant, never telemetry and never printed.
 * It exists only to decide the packet 15 cold-tyre trigger and the packet 12.1 crossover side.
 */
export const RC08_WET_WINDOW_C = Object.freeze({ minC: 50, maxC: 80 })

/**
 * Packet 11.2's typographic ladder, in pixels on the 800x480 canvas, computed arithmetically
 * from the packet and NOT measured off the approved render. image-qa-v1 normative override 1
 * is explicit: six reference attempts could not hold the delta rung, so the render's 28 px
 * delta is never traced.
 */
export const RC08_TYPE_SCALE_PX = Object.freeze({
  grip: 56,
  delta: 52,
  aid: 48,
  corner: 36,
  secondary: 32,
  label: 18
})

/**
 * Normative override 5: section 10 makes TC and ABS primary while 11.2 sizes the delta above
 * them. The 11.2 sizes are kept and primacy is carried by WEIGHT, POSITION and COLUMN WIDTH
 * instead — the aids sit at the top of the widest column in the heaviest weight the frame uses.
 */
export const RC08_TYPE_WEIGHTS = Object.freeze({
  grip: 800,
  aid: 800,
  delta: 600,
  corner: 600,
  secondary: 600,
  label: 600
})

/** One container-query width unit is one hundredth of the native canvas: 800 / 100 = 8 px. */
export const RC08_CQW_PX = RC08_NATIVE_WIDTH_PX / 100

/** The packet's px ladder expressed in the container units the stylesheet actually uses. */
export function rc08TypeScaleCqw(px: number): number {
  return Math.round((px / RC08_CQW_PX) * 1_000) / 1_000
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

/** An aid step is a rotary position: a non-negative number, or the ECU's own short label. */
function aidLevel(value: unknown): number | string | null {
  if (finite(value) && value >= 0) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 && trimmed.length <= 4 ? trimmed : null
  }
  return null
}

/**
 * Every RC-08 channel is read straight from its own declared source. Nothing is modelled,
 * mirrored or substituted: the grip state comes from the track-condition feed and never from
 * the lap delta, the gear never from RPM or speed, the speed never from RPM times a ratio, the
 * brake bias never from the pedal balance, and each tyre corner strictly from its own sensor.
 */
export function rc08AuxChannelValue(
  snapshot: TelemetrySnapshot,
  channel: Rc08AuxChannel
): number | string | null {
  switch (channel) {
    // Packet 16: the measured track-condition feed, quantised into the packet's own enum.
    // The RANK is the receipt value so a stale receipt still carries a real observed state.
    case 'grip': {
      const state = rc08GripStateForWetness(finite(snapshot.trackWetnessPct) ? snapshot.trackWetnessPct : null)
      return state === null ? null : rc08GripRank(state)
    }
    case 'tc':
      return aidLevel(snapshot.tcLevel)
    case 'abs':
      return aidLevel(snapshot.absLevel)
    case 'brakeBias':
      return finite(snapshot.brakeBiasPct) && snapshot.brakeBiasPct >= 0 && snapshot.brakeBiasPct <= 100
        ? snapshot.brakeBiasPct
        : null
    case 'tyreFl':
      return finite(snapshot.tyres?.lf?.tempC) ? snapshot.tyres!.lf.tempC! : null
    case 'tyreFr':
      return finite(snapshot.tyres?.rf?.tempC) ? snapshot.tyres!.rf.tempC! : null
    case 'tyreRl':
      return finite(snapshot.tyres?.lr?.tempC) ? snapshot.tyres!.lr.tempC! : null
    case 'tyreRr':
      return finite(snapshot.tyres?.rr?.tempC) ? snapshot.tyres!.rr.tempC! : null
    case 'gear':
      return finite(snapshot.gear) && Number.isInteger(snapshot.gear) ? snapshot.gear : null
    case 'speed':
      return finite(snapshot.speedKmh) && snapshot.speedKmh >= 0 ? snapshot.speedKmh : null
  }
  return null
}

/**
 * Packet 15's aids-fault trigger. The app carries no ECU fault-code channel, so the fault is
 * MEASURED from the two aid channels that do exist: the aid's own enable flag positively
 * reporting that the aid is NOT operating while its map channel positively reports a selected
 * non-zero step. Both channels must be present and fresh, so a quiet bus can never raise it —
 * a quiet bus is the packet's "greyed last-known" path instead, and no default is ever assumed.
 *
 * Note that the iRacing provider derives `tcEnabled` from `tcLevel > 0`, so the contradiction
 * cannot arise on that provider. That is the correct outcome: no fault channel, no fault
 * claimed. It is never substituted with a guess.
 */
export function rc08AidFaulted(level: number | string | null, enabled: unknown): boolean {
  if (level === null || typeof enabled !== 'boolean' || enabled) return false
  if (typeof level === 'number') return level > 0
  const upper = level.trim().toUpperCase()
  return upper.length > 0 && upper !== '0' && upper !== 'OFF'
}

/**
 * Receipts for RC-08's own channels, with exactly RC-01's semantics: a receipt is written only
 * when the channel actually reports, so a channel that falls silent ages out and degrades to
 * its packet state instead of freezing on its last value.
 */
export class Rc08AuxBuffer {
  private channelReceipts = new Map<Rc08AuxChannel, Rc01ChannelReceipt>()

  clone(): Rc08AuxBuffer {
    const next = new Rc08AuxBuffer()
    next.channelReceipts = new Map(this.channelReceipts)
    return next
  }

  reset(): void {
    this.channelReceipts = new Map()
  }

  ingest(snapshot: TelemetrySnapshot | null | undefined, receivedAt = rc01MonotonicNow()): void {
    if (!snapshot || !snapshot.connected || !finite(snapshot.timestamp)) return
    const safeReceiptAt = finite(receivedAt) && receivedAt >= 0 ? receivedAt : rc01MonotonicNow()
    for (const channel of Object.keys(RC08_CHANNEL_STALE_MS) as Rc08AuxChannel[]) {
      const value = rc08AuxChannelValue(snapshot, channel)
      if (value === null) continue
      this.channelReceipts.set(
        channel,
        Object.freeze({ value, snapshotTimestamp: snapshot.timestamp, receivedAt: safeReceiptAt })
      )
    }
  }

  receipts(): ReadonlyMap<Rc08AuxChannel, Rc01ChannelReceipt> {
    return new Map(this.channelReceipts)
  }
}

export function createRc08AuxReceipts(
  snapshot: TelemetrySnapshot,
  receivedAt = rc01MonotonicNow()
): ReadonlyMap<Rc08AuxChannel, Rc01ChannelReceipt> {
  const buffer = new Rc08AuxBuffer()
  buffer.ingest(snapshot, receivedAt)
  return buffer.receipts()
}

interface Rc08Reading {
  value: number | string | null
  lastKnown: number | string | null
  stale: boolean
  ageMs: number
}

function auxReading(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc08AuxChannel, Rc01ChannelReceipt>,
  channel: Rc08AuxChannel,
  nowMs: number
): Rc08Reading {
  const raw = snapshot ? rc08AuxChannelValue(snapshot, channel) : null
  const receipt = receipts.get(channel)
  if (raw === null || !receipt) {
    return { value: null, lastKnown: null, stale: false, ageMs: Number.POSITIVE_INFINITY }
  }
  const ageMs = rc01ReceiptAgeMs(receipt, nowMs)
  const stale = ageMs > RC08_CHANNEL_STALE_MS[channel]
  return {
    value: stale ? null : raw,
    lastKnown: typeof receipt.value === 'boolean' ? null : receipt.value,
    stale,
    ageMs
  }
}

// ─────────────────────────────────────────────────────────── adaptive columns

export interface Rc08Rect {
  left: number
  top: number
  width: number
  height: number
}

export type Rc08ZoneId = 'banner' | 'aids' | 'ribbon' | 'pace' | 'tire' | 'timeline' | 'crossover'

export type Rc08ZoneMap = Readonly<Partial<Record<Rc08ZoneId, Rc08Rect>>>

export interface Rc08ColumnWeights {
  aids: number
  pace: number
  tire: number
}

/**
 * THE VISUAL THESIS, expressed as arithmetic rather than as four hand-drawn stylesheets: the
 * column WIDTHS themselves encode the regime. Packet 11.1's published boxes are the WET row —
 * aids 37.5, pace 23.8, tire 30.8 — and every other regime trades width between the aids and
 * the pace column while the thermal column and both gutters stay fixed, so the three widths
 * always sum to exactly `RC08_NATIVE_COLUMN_SPAN`.
 *
 * The `unknown` row is the honest one. With no confirmed grip state there is no regime to
 * encode, so the three columns are EQUAL: the layout states "regime unknown" instead of
 * implying a wet or a dry track. This is the same rule as the chip's `UNAVAILABLE` word.
 */
export const RC08_NATIVE_COLUMN_SPAN = 92.1
export const RC08_NATIVE_LEFT_MARGIN = 2.0
export const RC08_NATIVE_GUTTERS = Object.freeze([2.0, 1.9] as const)

export const RC08_NATIVE_COLUMN_WEIGHTS: Readonly<Record<Rc08GripState | 'unknown', Rc08ColumnWeights>> =
  Object.freeze({
    DRY: { aids: 28.5, pace: 32.8, tire: 30.8 },
    DAMP: { aids: 33.0, pace: 28.3, tire: 30.8 },
    WET: { aids: 37.5, pace: 23.8, tire: 30.8 },
    FLOOD: { aids: 41.5, pace: 19.8, tire: 30.8 },
    unknown: { aids: 30.7, pace: 30.7, tire: 30.7 }
  })

export const RC08_APP_COLUMN_SPAN = 90.6
export const RC08_APP_LEFT_MARGIN = 2.3
export const RC08_APP_GUTTERS = Object.freeze([2.3, 2.4] as const)

export const RC08_APP_COLUMN_WEIGHTS: Readonly<Record<Rc08GripState | 'unknown', Rc08ColumnWeights>> =
  Object.freeze({
    DRY: { aids: 26.5, pace: 32.1, tire: 32.0 },
    DAMP: { aids: 30.9, pace: 27.7, tire: 32.0 },
    WET: { aids: 35.2, pace: 23.4, tire: 32.0 },
    FLOOD: { aids: 39.0, pace: 19.6, tire: 32.0 },
    unknown: { aids: 30.2, pace: 30.2, tire: 30.2 }
  })

/** Packet 11.1 / 12.1 vertical geometry. The banner is full width in both grammars. */
const RC08_NATIVE_BANNER: Rc08Rect = Object.freeze({ left: 2.0, top: 2.1, width: 96.0, height: 6.2 })
const RC08_NATIVE_COLUMN_TOP = 10.4
const RC08_NATIVE_COLUMN_HEIGHT = 85.4
/** Packet 11.1's grip ribbon: 12.5 % of the canvas, NESTED inside the grip/aids column. */
export const RC08_RIBBON_HEIGHT_PCT = 12.5

const RC08_APP_BANNER: Rc08Rect = Object.freeze({ left: 0, top: 0, width: 100, height: 6.0 })
const RC08_APP_COLUMN_TOP = 8.0
const RC08_APP_COLUMN_HEIGHT = 84.0
/** Packet 12.1 halves the thermal column so the app-only timeline can sit beneath it. */
const RC08_APP_TIRE_HEIGHT = 50.0
const RC08_APP_TIMELINE_TOP = 60.7
const RC08_APP_TIMELINE_HEIGHT = 31.3
/** Packet 12.1's per-corner wet/dry crossover panel, NESTED in the lower thermal column. */
export const RC08_CROSSOVER_HEIGHT_PCT = 15.0

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function columnLefts(
  weights: Rc08ColumnWeights,
  leftMargin: number,
  gutters: readonly [number, number]
): { aids: number; pace: number; tire: number } {
  const aids = leftMargin
  const pace = round1(aids + weights.aids + gutters[0])
  const tire = round1(pace + weights.pace + gutters[1])
  return { aids, pace, tire }
}

export function rc08ColumnWeights(
  layout: Rc08Layout,
  regime: Rc08GripState | null
): Rc08ColumnWeights {
  const table = layout === 'app' ? RC08_APP_COLUMN_WEIGHTS : RC08_NATIVE_COLUMN_WEIGHTS
  return table[regime ?? 'unknown']
}

/**
 * Packet 11.2's ladder is specified against packet 11.1's own WET geometry, so that is the
 * reference column set. A regime that NARROWS a column scales that column's type down by the
 * same ratio and never up, which keeps the 11.2 sizes exact wherever the packet specifies them
 * and stops a hero numeral escaping its zone in the narrower regimes. Sizing a hero this way,
 * rather than trusting `overflow: hidden` against a `white-space: nowrap` flex item, is the
 * documented failure mode from the RC-01/RC-02 build.
 */
export function rc08ColumnScale(layout: Rc08Layout, regime: Rc08GripState | null): Rc08ColumnWeights {
  const table = layout === 'app' ? RC08_APP_COLUMN_WEIGHTS : RC08_NATIVE_COLUMN_WEIGHTS
  const weights = table[regime ?? 'unknown']
  const reference = table.WET
  const ratio = (value: number, against: number): number =>
    against <= 0 ? 1 : Math.round(Math.min(1, value / against) * 1_000) / 1_000
  return {
    aids: ratio(weights.aids, reference.aids),
    pace: ratio(weights.pace, reference.pace),
    tire: ratio(weights.tire, reference.tire)
  }
}

/**
 * Packet 11.1's zones for the native canvas, recomputed for the live regime. image-qa-v1
 * normative override 2 is explicit: the approved render drifted up to 2 percentage points
 * horizontally and about 30 px vertically, so those pixels are never traced — the WET row of
 * `RC08_NATIVE_COLUMN_WEIGHTS` reproduces packet 11.1 exactly instead.
 */
export function rc08NativeZones(regime: Rc08GripState | null): Rc08ZoneMap {
  const weights = rc08ColumnWeights('native', regime)
  const lefts = columnLefts(weights, RC08_NATIVE_LEFT_MARGIN, RC08_NATIVE_GUTTERS)
  return Object.freeze({
    banner: RC08_NATIVE_BANNER,
    aids: { left: lefts.aids, top: RC08_NATIVE_COLUMN_TOP, width: weights.aids, height: RC08_NATIVE_COLUMN_HEIGHT },
    ribbon: { left: lefts.aids, top: RC08_NATIVE_COLUMN_TOP, width: weights.aids, height: RC08_RIBBON_HEIGHT_PCT },
    pace: { left: lefts.pace, top: RC08_NATIVE_COLUMN_TOP, width: weights.pace, height: RC08_NATIVE_COLUMN_HEIGHT },
    tire: { left: lefts.tire, top: RC08_NATIVE_COLUMN_TOP, width: weights.tire, height: RC08_NATIVE_COLUMN_HEIGHT }
  })
}

/**
 * Packet 12.1 `adaptive-timeline-reveal`. The width buys two app-only modules the 800x480
 * canvas cannot fit — a measured grip-state history timeline and a per-corner wet/dry
 * crossover panel — while the columns keep reflowing by grip state rather than scaling.
 */
export function rc08AppZones(regime: Rc08GripState | null): Rc08ZoneMap {
  const weights = rc08ColumnWeights('app', regime)
  const lefts = columnLefts(weights, RC08_APP_LEFT_MARGIN, RC08_APP_GUTTERS)
  return Object.freeze({
    banner: RC08_APP_BANNER,
    aids: { left: lefts.aids, top: RC08_APP_COLUMN_TOP, width: weights.aids, height: RC08_APP_COLUMN_HEIGHT },
    ribbon: { left: lefts.aids, top: RC08_APP_COLUMN_TOP, width: weights.aids, height: RC08_RIBBON_HEIGHT_PCT },
    pace: { left: lefts.pace, top: RC08_APP_COLUMN_TOP, width: weights.pace, height: RC08_APP_COLUMN_HEIGHT },
    tire: { left: lefts.tire, top: RC08_APP_COLUMN_TOP, width: weights.tire, height: RC08_APP_TIRE_HEIGHT },
    crossover: {
      left: lefts.tire,
      top: round1(RC08_APP_COLUMN_TOP + RC08_APP_TIRE_HEIGHT - RC08_CROSSOVER_HEIGHT_PCT),
      width: weights.tire,
      height: RC08_CROSSOVER_HEIGHT_PCT
    },
    timeline: {
      left: lefts.tire,
      top: RC08_APP_TIMELINE_TOP,
      width: weights.tire,
      height: RC08_APP_TIMELINE_HEIGHT
    }
  })
}

/**
 * Compact breakpoints are not packet-specified. They keep the adaptive-column grammar and drop
 * only the two app-only modules, so the grip chip, the aids cluster and every corner cell — and
 * therefore all three alert surfaces — stay visible at every size.
 */
function rc08CompactZones(mode: Rc08CompactMode, regime: Rc08GripState | null): Rc08ZoneMap {
  const weights = rc08ColumnWeights('native', regime)
  if (mode === 'phone') {
    // Portrait stacks the three columns into three bands; the width no longer encodes the
    // regime, so the BAND HEIGHTS carry it instead and the ratio is preserved exactly.
    const total = weights.aids + weights.pace + weights.tire
    const usable = 88
    const aidsH = round1((weights.aids / total) * usable)
    const paceH = round1((weights.pace / total) * usable)
    const tireH = round1(usable - aidsH - paceH)
    const top = 8.5
    return Object.freeze({
      banner: { left: 2, top: 1.5, width: 96, height: 5.5 },
      aids: { left: 2, top, width: 96, height: aidsH },
      ribbon: { left: 2, top, width: 96, height: round1(aidsH * 0.28) },
      pace: { left: 2, top: round1(top + aidsH + 0.5), width: 96, height: paceH },
      tire: { left: 2, top: round1(top + aidsH + paceH + 1), width: 96, height: tireH }
    })
  }
  const scale = 96 / (weights.aids + weights.pace + weights.tire + 3.9)
  const aidsW = round1(weights.aids * scale)
  const paceW = round1(weights.pace * scale)
  const tireW = round1(weights.tire * scale)
  const gutter = round1((96 - aidsW - paceW - tireW) / 2)
  const top = mode === 'landscape' ? 10 : 9
  const height = mode === 'landscape' ? 86 : 87
  const paceLeft = round1(2 + aidsW + gutter)
  const tireLeft = round1(paceLeft + paceW + gutter)
  return Object.freeze({
    banner: { left: 2, top: 1.5, width: 96, height: mode === 'landscape' ? 7 : 6 },
    aids: { left: 2, top, width: aidsW, height },
    // Ribbon height 0.18 × column height ensures it exceeds the 7 cqw grip word at every
    // landscape compact aspect ratio (AR ≤ 2.21 at 867×393): 0.18 × 86% × h ≥ 7 × w/100.
    ribbon: { left: 2, top, width: aidsW, height: round1(height * 0.18) },
    pace: { left: paceLeft, top, width: paceW, height },
    tire: { left: tireLeft, top, width: tireW, height }
  })
}

export function rc08ZonesForLayout(
  layout: Rc08Layout,
  compactMode: Rc08CompactMode = 'standard',
  regime: Rc08GripState | null = null
): Rc08ZoneMap {
  if (layout === 'native') return rc08NativeZones(regime)
  if (layout === 'app') return rc08AppZones(regime)
  return rc08CompactZones(compactMode, regime)
}

/** The inline geometry a zone element carries, so CSS and the packet table cannot drift. */
export function rc08ZoneStyle(rect: Rc08Rect | undefined): {
  left: string
  top: string
  width: string
  height: string
} | null {
  if (!rect) return null
  return {
    left: rc08Percent(rect.left),
    top: rc08Percent(rect.top),
    width: rc08Percent(rect.width),
    height: rc08Percent(rect.height)
  }
}

/** Re-expresses a nested packet zone as percentages of its parent zone's own box. */
export function rc08NestedRect(child: Rc08Rect, parent: Rc08Rect): Rc08Rect {
  return {
    left: parent.width === 0 ? 0 : ((child.left - parent.left) / parent.width) * 100,
    top: parent.height === 0 ? 0 : ((child.top - parent.top) / parent.height) * 100,
    width: parent.width === 0 ? 0 : (child.width / parent.width) * 100,
    height: parent.height === 0 ? 0 : (child.height / parent.height) * 100
  }
}

export function rc08RectsOverlap(a: Rc08Rect, b: Rc08Rect): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  )
}

export function rc08RectContains(outer: Rc08Rect, inner: Rc08Rect): boolean {
  return (
    inner.left >= outer.left - 1e-6 &&
    inner.top >= outer.top - 1e-6 &&
    inner.left + inner.width <= outer.left + outer.width + 1e-6 &&
    inner.top + inner.height <= outer.top + outer.height + 1e-6
  )
}

/** A 0..100 coordinate as a CSS percentage, without binary-float noise in the DOM. */
export function rc08Percent(value: number): string {
  const safe = finite(value) ? value : 0
  return `${Math.round(safe * 1_000) / 1_000}%`
}

// ─────────────────────────────────────────────────────────── layout resolution

export function rc08LayoutForContentBox(width: number, height: number): Rc08Layout {
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return 'app'
  if (
    Math.abs(width - RC08_NATIVE_WIDTH_PX) <= RC08_NATIVE_TOLERANCE_PX &&
    Math.abs(height - RC08_NATIVE_HEIGHT_PX) <= RC08_NATIVE_TOLERANCE_PX
  ) {
    return 'native'
  }
  if (width >= RC08_APP_WIDTH_PX - 1 && height >= RC08_APP_HEIGHT_PX - 1) return 'app'
  return 'compact'
}

export function rc08CompactModeForContentBox(width: number, height: number): Rc08CompactMode {
  if (rc08LayoutForContentBox(width, height) !== 'compact') return 'standard'
  if (
    width >= RC08_PHONE_MIN_WIDTH_PX &&
    width <= RC08_PHONE_MAX_WIDTH_PX &&
    height >= RC08_PHONE_MIN_HEIGHT_PX &&
    height / width >= 1.5
  ) {
    return 'phone'
  }
  if (
    width >= RC08_LANDSCAPE_MIN_WIDTH_PX &&
    height >= RC08_LANDSCAPE_MIN_HEIGHT_PX &&
    height <= RC08_LANDSCAPE_MAX_HEIGHT_PX &&
    width / height >= 1.5
  ) {
    return 'landscape'
  }
  return 'standard'
}

export interface Rc08PhoneGeometry {
  inset: number
  bannerHeight: number
  ribbonHeight: number
  rowHeight: number
  cornerHeight: number
  toggleSize: number
}

/**
 * Portrait geometry, in pixels, for the bands the phone stack sizes from the measured box
 * rather than from a percentage. The grip chip keeps its hero rung: it is the one glyph the
 * packet makes the hero of the frame at every canvas size.
 */
export function rc08PhoneGeometryForContentBox(width: number, height: number): Rc08PhoneGeometry | null {
  if (rc08CompactModeForContentBox(width, height) !== 'phone') return null
  const inset = 12
  return {
    inset,
    bannerHeight: Math.max(18, Math.round(height * 0.055)),
    ribbonHeight: Math.max(48, Math.round(height * 0.1)),
    rowHeight: Math.max(34, Math.round(height * 0.07)),
    cornerHeight: Math.max(40, Math.round(height * 0.085)),
    toggleSize: 44
  }
}

// ─────────────────────────────────────────────────────────── measured grip history

/**
 * The packet 12.1 grip-history timeline is MEASURED, never reconstructed. A segment is opened
 * only when a real confirmed grip state is observed and is closed when the state changes or the
 * feed goes away, so a period with no feed leaves a genuine gap in the track rather than being
 * back-filled with the neighbouring state.
 */
export const RC08_GRIP_HISTORY_LIMIT = 32
export const RC08_GRIP_HISTORY_WINDOW_MS = 300_000

export interface Rc08GripSegment {
  state: Rc08GripState
  startedAtMs: number
  endedAtMs: number | null
}

export interface Rc08TimelineSegment {
  state: Rc08GripState
  leftPercent: number
  widthPercent: number
  startedAtMs: number
  endedAtMs: number
}

export class Rc08GripHistory {
  private segments: Rc08GripSegment[] = []

  clone(): Rc08GripHistory {
    const next = new Rc08GripHistory()
    next.segments = this.segments.map((segment) => ({ ...segment }))
    return next
  }

  reset(): void {
    this.segments = []
  }

  observe(input: { nowMs: number; state: Rc08GripState | null }): void {
    const nowMs = finite(input.nowMs) ? input.nowMs : 0
    const open = this.segments.length > 0 ? this.segments[this.segments.length - 1] : null
    if (input.state === null) {
      if (open && open.endedAtMs === null) open.endedAtMs = nowMs
      return
    }
    if (open && open.endedAtMs === null && open.state === input.state) return
    if (open && open.endedAtMs === null) open.endedAtMs = nowMs
    this.segments.push({ state: input.state, startedAtMs: nowMs, endedAtMs: null })
    if (this.segments.length > RC08_GRIP_HISTORY_LIMIT) {
      this.segments = this.segments.slice(this.segments.length - RC08_GRIP_HISTORY_LIMIT)
    }
  }

  entries(): readonly Rc08GripSegment[] {
    return this.segments.map((segment) => ({ ...segment }))
  }
}

/** Clips the measured segments onto the visible window as normalised 0..100 percentages. */
export function rc08TimelineSegments(
  entries: readonly Rc08GripSegment[],
  nowMs: number,
  windowMs = RC08_GRIP_HISTORY_WINDOW_MS
): readonly Rc08TimelineSegment[] {
  if (!finite(nowMs) || !finite(windowMs) || windowMs <= 0) return []
  const from = nowMs - windowMs
  const out: Rc08TimelineSegment[] = []
  for (const entry of entries) {
    const start = Math.max(entry.startedAtMs, from)
    const end = Math.min(entry.endedAtMs ?? nowMs, nowMs)
    if (!finite(start) || !finite(end) || end <= start) continue
    out.push({
      state: entry.state,
      leftPercent: ((start - from) / windowMs) * 100,
      widthPercent: ((end - start) / windowMs) * 100,
      startedAtMs: start,
      endedAtMs: end
    })
  }
  return out
}

// ─────────────────────────────────────────────────────────── alerts

/** Packet 15: grip drop engages after 2 s and needs 4 s of drier readings to clear. */
export const RC08_GRIP_DROP_ENGAGE_MS = 2_000
export const RC08_GRIP_DROP_HYSTERESIS_MS = 4_000
/** Packet 15: a corner must sit below the wet window for 3 s before the marker appears. */
export const RC08_COLD_TYRE_ENGAGE_MS = 3_000
/** Packet 15: an aids fault is an event with a 1 s minimum display. */
export const RC08_AIDS_FAULT_MIN_VISIBLE_MS = 1_000

/**
 * Packet 15 scopes the cold-tyre alert to "grip=WET". FLOOD is the packet's own WETTER state,
 * so the wet regime is declared here as the two wet states and asserted by the suite: a
 * flooded track is not drier than a wet one, and silently dropping the marker at the worst
 * moment would be the failure the alert exists to prevent.
 */
export const RC08_COLD_TYRE_GRIP_STATES: readonly Rc08GripState[] = Object.freeze(['WET', 'FLOOD'])

export type Rc08Aid = 'TC' | 'ABS'

export interface Rc08AlertState {
  gripDrop: {
    active: boolean
    confirmedRank: number | null
    pendingSinceMs: number | null
    recoverySinceMs: number | null
  }
  coldTyres: {
    active: boolean
    pendingSinceMs: Readonly<Partial<Record<Rc08Corner, number>>>
    corners: readonly Rc08Corner[]
  }
  aidsFault: {
    active: boolean
    minimumVisibleUntilMs: number
    aids: readonly Rc08Aid[]
  }
}

export interface Rc08AlertInput {
  nowMs: number
  /** The CONFIRMED grip rank: `null` is a missing or stale feed and can never infer a regime. */
  gripRank: number | null
  /** Corners measured below the wet window this frame; a corner with no sensor is absent. */
  coldCorners: readonly Rc08Corner[]
  /** True only while the grip state is one of `RC08_COLD_TYRE_GRIP_STATES`. */
  wetRegime: boolean
  /** Aids positively reporting the enable/map contradiction with both channels fresh. */
  faultedAids: readonly Rc08Aid[]
}

export function createRc08AlertState(): Rc08AlertState {
  return {
    gripDrop: { active: false, confirmedRank: null, pendingSinceMs: null, recoverySinceMs: null },
    coldTyres: { active: false, pendingSinceMs: {}, corners: [] },
    aidsFault: { active: false, minimumVisibleUntilMs: 0, aids: [] }
  }
}

function cloneRc08AlertState(state: Rc08AlertState): Rc08AlertState {
  return {
    gripDrop: { ...state.gripDrop },
    coldTyres: { ...state.coldTyres, pendingSinceMs: { ...state.coldTyres.pendingSinceMs }, corners: [...state.coldTyres.corners] },
    aidsFault: { ...state.aidsFault, aids: [...state.aidsFault.aids] }
  }
}

/**
 * Every alert is silent until its own trigger fires, carries the packet section 15 debounce and
 * hysteresis, has an explicit clear condition, and is unlatched the moment its input goes
 * missing or stale. No element of the alert layer is ever an always-on decoration.
 */
export function advanceRc08Alerts(state: Rc08AlertState, input: Rc08AlertInput): Rc08AlertState {
  const nowMs = finite(input.nowMs) ? input.nowMs : 0
  const next = cloneRc08AlertState(state)

  // ── Grip drop: 2 s to confirm a WETTER sensor transition, 4 s of drier readings to clear.
  //    A missing or stale grip feed drops the whole baseline — the packet forbids inference,
  //    so nothing is remembered across a gap and no transition is invented across it.
  if (input.gripRank === null) {
    next.gripDrop = { active: false, confirmedRank: null, pendingSinceMs: null, recoverySinceMs: null }
  } else if (next.gripDrop.confirmedRank === null) {
    next.gripDrop = { active: false, confirmedRank: input.gripRank, pendingSinceMs: null, recoverySinceMs: null }
  } else if (input.gripRank > next.gripDrop.confirmedRank) {
    const pendingSinceMs = next.gripDrop.pendingSinceMs ?? nowMs
    const engaged = nowMs - pendingSinceMs >= RC08_GRIP_DROP_ENGAGE_MS
    next.gripDrop = engaged
      ? { active: true, confirmedRank: input.gripRank, pendingSinceMs: null, recoverySinceMs: null }
      : { ...next.gripDrop, pendingSinceMs, recoverySinceMs: null }
  } else if (input.gripRank < next.gripDrop.confirmedRank) {
    const recoverySinceMs = next.gripDrop.recoverySinceMs ?? nowMs
    const cleared = nowMs - recoverySinceMs >= RC08_GRIP_DROP_HYSTERESIS_MS
    next.gripDrop = cleared
      ? { active: false, confirmedRank: input.gripRank, pendingSinceMs: null, recoverySinceMs: null }
      : { ...next.gripDrop, pendingSinceMs: null, recoverySinceMs }
  } else {
    next.gripDrop = { ...next.gripDrop, pendingSinceMs: null, recoverySinceMs: null }
  }

  // ── Cold tyres in the wet: each corner runs its own 3 s debounce, so one cold corner never
  //    marks another. Outside the wet regime, or without a corner sensor, nothing can engage.
  if (!input.wetRegime) {
    next.coldTyres = { active: false, pendingSinceMs: {}, corners: [] }
  } else {
    const pending: Partial<Record<Rc08Corner, number>> = {}
    const corners: Rc08Corner[] = []
    for (const corner of RC08_CORNERS) {
      if (!input.coldCorners.includes(corner)) continue
      const since = next.coldTyres.pendingSinceMs[corner] ?? nowMs
      pending[corner] = since
      if (nowMs - since >= RC08_COLD_TYRE_ENGAGE_MS) corners.push(corner)
    }
    next.coldTyres = { active: corners.length > 0, pendingSinceMs: pending, corners }
  }

  // ── Aids fault: an event alert with a 1 s minimum display. A quiet bus reports no fault at
  //    all, which unlatches it — the packet forbids assuming a default in either direction.
  if (input.faultedAids.length > 0) {
    next.aidsFault = {
      active: true,
      minimumVisibleUntilMs: Math.max(next.aidsFault.minimumVisibleUntilMs, nowMs + RC08_AIDS_FAULT_MIN_VISIBLE_MS),
      aids: [...input.faultedAids]
    }
  } else if (next.aidsFault.active && nowMs < next.aidsFault.minimumVisibleUntilMs) {
    next.aidsFault = { ...next.aidsFault, active: true }
  } else {
    next.aidsFault = { active: false, minimumVisibleUntilMs: 0, aids: [] }
  }

  return next
}

/** A stale, missing or refused input can never leave a condition alert latched on. */
export function clearInvalidRc08Alerts(state: Rc08AlertState, model: Rc08DashboardModel): Rc08AlertState {
  const next = cloneRc08AlertState(state)
  if (model.grip.unavailable || model.grip.stale || model.regime === null) {
    next.gripDrop = { active: false, confirmedRank: null, pendingSinceMs: null, recoverySinceMs: null }
    next.coldTyres = { active: false, pendingSinceMs: {}, corners: [] }
  }
  if (model.tc.field.unavailable && model.abs.field.unavailable) {
    next.aidsFault = { active: false, minimumVisibleUntilMs: 0, aids: [] }
  }
  return next
}

/** The alert lines a surface renders; empty in a silent frame, which is the reference state. */
export function rc08AlertLines(model: Rc08DashboardModel): readonly string[] {
  const lines: string[] = []
  if (model.alerts.gripDrop) lines.push('GRIP DROP')
  if (model.alerts.coldTyres) lines.push('COLD TYRES')
  if (model.alerts.aidsFault) lines.push('AIDS FAULT')
  return lines
}

// ─────────────────────────────────────────────────────────── dashboard model

export interface Rc08GripModel {
  state: Rc08GripState | null
  label: string
  hue: string | null
  source: Rc08GripSource
  sourceLabel: string
  stale: boolean
  unavailable: boolean
  rank: number | null
}

export type Rc08Crossover = 'COLD' | 'WET' | 'DRY' | null

export interface Rc08CornerModel {
  corner: Rc08Corner
  field: Rc01Field
  tempC: number | null
  /** Which side of the never-displayed wet window this corner's OWN sensor measured. */
  crossover: Rc08Crossover
  crossoverLabel: string
  /** True only while the packet 15 cold-tyre alert is latched on this corner. */
  cold: boolean
}

export interface Rc08AidModel {
  field: Rc01Field
  /** True only while this aid positively reports the enable/map contradiction. */
  faulted: boolean
}

export interface Rc08AlertFlags {
  gripDrop: boolean
  coldTyres: boolean
  aidsFault: boolean
}

export interface Rc08DashboardModel {
  grip: Rc08GripModel
  /** The grip state the COLUMN WIDTHS encode; `null` whenever the regime is not confirmed. */
  regime: Rc08GripState | null
  weatherFeed: { available: boolean; label: string }
  /** Packet 16/19: the rain rate has no mm/h source anywhere, so it is always the word. */
  rainRate: Rc01Field
  tc: Rc08AidModel
  abs: Rc08AidModel
  brakeBias: Rc01Field
  delta: Rc01Field
  gear: Rc01Field
  speed: Rc01Field
  corners: readonly Rc08CornerModel[]
  alerts: Rc08AlertFlags
  faultedAids: readonly Rc08Aid[]
  coldCorners: readonly Rc08Corner[]
  auxFresh: Readonly<Record<Rc08AuxChannel, boolean>>
  criticalFresh: Readonly<Record<Rc01ChannelName, boolean>>
}

export interface Rc08ModelOptions {
  alerts?: Rc08AlertState
  /** The packet 11.5 driver toggle; `'auto'` defers to the track-condition feed. */
  driverGripState?: Rc08GripState | 'auto'
}

/** Packet 16: 'N' or the grey '-'; a gear is never blanked silently and never comes from RPM. */
export function rc08DisplayGear(gear: number | null): string {
  if (gear === null || !finite(gear)) return '-'
  if (gear < 0) return 'R'
  if (gear === 0) return 'N'
  return String(Math.trunc(gear))
}

/** Which side of the configured wet window a MEASURED corner temperature sits on. */
export function rc08CrossoverFor(tempC: number | null): Rc08Crossover {
  if (tempC === null || !finite(tempC)) return null
  if (tempC < RC08_WET_WINDOW_C.minC) return 'COLD'
  if (tempC > RC08_WET_WINDOW_C.maxC) return 'DRY'
  return 'WET'
}

function aidModel(reading: Rc08Reading, faulted: boolean): Rc08AidModel {
  // Packet 16: never assume a default aid step. A quiet bus holds the LAST KNOWN step, greyed
  // and flagged stale; a channel that has never reported at all dashes instead.
  if (reading.value !== null) {
    return { field: field(String(reading.value), reading.value, false, false, 'primary'), faulted }
  }
  if (reading.lastKnown !== null) {
    return { field: field(String(reading.lastKnown), reading.lastKnown, true, false, 'muted'), faulted: false }
  }
  return { field: field('--', null, reading.stale, true, 'muted'), faulted: false }
}

/**
 * Projects the shared RC-01 telemetry model into RC-08's wet-adaptive display and adds the
 * condition channels. Nothing is invented, estimated or mirrored: the grip state is never
 * inferred from the lap delta, the rain rate is never derived from a wiper or a precipitation
 * percentage, one tyre corner is never mirrored onto another, and every unavailable channel
 * renders its packet state.
 */
export function createRc08DashboardModel(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc01ChannelName, Rc01ChannelReceipt> = new Map(),
  auxReceipts: ReadonlyMap<Rc08AuxChannel, Rc01ChannelReceipt> = new Map(),
  nowMs = rc01MonotonicNow(),
  options: Rc08ModelOptions = {}
): Rc08DashboardModel {
  const base: Rc01DashboardModel = createRc01DashboardModel(snapshot, receipts, nowMs)
  const safeSnapshot = snapshot && snapshot.connected ? snapshot : null
  const alerts = options.alerts ?? createRc08AlertState()
  const toggle = options.driverGripState ?? 'auto'

  const auxFresh = Object.fromEntries(
    (Object.keys(RC08_CHANNEL_STALE_MS) as Rc08AuxChannel[]).map((channel) => [
      channel,
      auxReading(safeSnapshot, auxReceipts, channel, nowMs).value !== null
    ])
  ) as Record<Rc08AuxChannel, boolean>

  // ── Grip state. Packet 11.5 recognises exactly two lawful sources: the measured
  //    track-condition feed, or an explicit driver toggle. The toggle is an assertion by the
  //    driver and so is never stale; the sensor greys when it ages out and dashes when it has
  //    never reported. Nothing else — never the lap delta, never the wiper, never the sky.
  const gripReading = auxReading(safeSnapshot, auxReceipts, 'grip', nowMs)
  const sensorRank =
    typeof gripReading.value === 'number'
      ? gripReading.value
      : typeof gripReading.lastKnown === 'number'
        ? gripReading.lastKnown
        : null
  const sensorState = sensorRank === null ? null : (RC08_GRIP_STATES[sensorRank] ?? null)
  const toggled = toggle === 'auto' ? null : toggle
  const gripState = toggled ?? sensorState
  const gripSource: Rc08GripSource = toggled !== null ? 'driver' : sensorState !== null ? 'sensor' : 'none'
  const gripStale = gripSource === 'sensor' && gripReading.stale
  const grip: Rc08GripModel = {
    state: gripState,
    label: gripState ?? RC08_GRIP_UNAVAILABLE,
    hue: gripState === null ? null : RC08_GRIP_HUES[gripState],
    source: gripSource,
    sourceLabel: gripSource === 'driver' ? 'DRIVER TOGGLE' : gripSource === 'sensor' ? 'SENSOR' : RC08_GRIP_UNAVAILABLE,
    stale: gripStale,
    unavailable: gripState === null,
    rank: rc08GripRank(gripState)
  }
  // The widths encode a CONFIRMED regime only. A stale or absent grip state falls back to the
  // equal-column layout, which is the geometric form of the chip's UNAVAILABLE word.
  const regime = grip.unavailable || grip.stale ? null : grip.state

  // ── Weather feed honesty banner. The measured track-condition channel is the feed; when it
  //    has never reported, the banner says so in words rather than staying silent.
  const weatherAvailable = sensorState !== null && !gripReading.stale
  const weatherFeed = {
    available: weatherAvailable,
    label: weatherAvailable ? 'WEATHER FEED LIVE' : 'WEATHER FEED UNAVAILABLE'
  }

  // ── Rain rate. See RC08_PACKET_OMISSIONS.rainRateNumeral: there is no mm/h channel, and
  //    section 16 forbids estimating one, so this is the WORD on every frame, for ever.
  const rainRate = field(RC08_GRIP_UNAVAILABLE, null, false, true, 'muted')

  // ── Aids. Both are rotary steps; a quiet bus greys the last known step and flags it stale.
  const tcReading = auxReading(safeSnapshot, auxReceipts, 'tc', nowMs)
  const absReading = auxReading(safeSnapshot, auxReceipts, 'abs', nowMs)
  const tcFaulted = rc08AidFaulted(tcReading.value, safeSnapshot?.tcEnabled)
  const absFaulted = rc08AidFaulted(absReading.value, safeSnapshot?.absEnabled)
  const tc = aidModel(tcReading, tcFaulted)
  const abs = aidModel(absReading, absFaulted)
  const faultedAids: Rc08Aid[] = []
  if (tc.faulted) faultedAids.push('TC')
  if (abs.faulted) faultedAids.push('ABS')

  // ── Brake bias: the adjuster channel, never inferred from the pedal balance.
  const biasReading = auxReading(safeSnapshot, auxReceipts, 'brakeBias', nowMs)
  const brakeBias =
    typeof biasReading.value === 'number'
      ? field(biasReading.value.toFixed(1), biasReading.value, false, false, 'primary')
      : field('--', null, biasReading.stale, true, 'muted')

  // ── Delta comes from the shared RC-01 model: its budget is already the packet's per-sample
  //    rule and it already refuses a delta without a real stored best lap.
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
    typeof gearReading.value === 'number'
      ? field(rc08DisplayGear(gearReading.value), gearReading.value, false, false, 'primary')
      : field('-', null, gearReading.stale, true, 'muted')

  // ── Speed: greys past its 100 ms cadence, collapses to '---' past the 500 ms budget.
  const speedReading = auxReading(safeSnapshot, auxReceipts, 'speed', nowMs)
  const speedDashed = speedReading.value === null && speedReading.ageMs > RC08_SPEED_DASH_MS
  const speed =
    typeof speedReading.value === 'number'
      ? field(String(Math.round(speedReading.value)), speedReading.value, false, false, 'primary')
      : !speedDashed && typeof speedReading.lastKnown === 'number'
        ? field(String(Math.round(speedReading.lastKnown)), speedReading.lastKnown, true, false, 'muted')
        : field('---', null, speedReading.stale, true, 'muted')

  // ── Tyre corners. Each corner is strictly its own sensor: a corner with no reading dashes
  //    and is never filled in from its neighbour, its axle or its opposite side.
  const corners: Rc08CornerModel[] = RC08_CORNERS.map((corner) => {
    const reading = auxReading(safeSnapshot, auxReceipts, RC08_CORNER_CHANNELS[corner], nowMs)
    const tempC = typeof reading.value === 'number' ? reading.value : null
    const crossover = rc08CrossoverFor(tempC)
    return {
      corner,
      field:
        tempC === null
          ? field('--', null, reading.stale, true, 'muted')
          : field(String(Math.round(tempC)), tempC, false, false, 'primary'),
      tempC,
      crossover,
      crossoverLabel: crossover ?? '--',
      cold: alerts.coldTyres.corners.includes(corner)
    }
  })
  const coldCorners = corners
    .filter((entry) => entry.crossover === 'COLD')
    .map((entry) => entry.corner)

  return {
    grip,
    regime,
    weatherFeed,
    rainRate,
    tc,
    abs,
    brakeBias,
    delta,
    gear,
    speed,
    corners,
    alerts: {
      gripDrop: alerts.gripDrop.active,
      coldTyres: alerts.coldTyres.active,
      aidsFault: alerts.aidsFault.active
    },
    faultedAids,
    coldCorners,
    auxFresh,
    criticalFresh: base.criticalFresh
  }
}

/** The alert-layer inputs, all gated on freshness so a frozen frame can never engage anything. */
export function rc08AlertInputForModel(model: Rc08DashboardModel, nowMs: number): Rc08AlertInput {
  const regime = model.regime
  return {
    nowMs,
    gripRank: regime === null ? null : rc08GripRank(regime),
    coldCorners: model.coldCorners,
    wetRegime: regime !== null && RC08_COLD_TYRE_GRIP_STATES.includes(regime),
    faultedAids: model.faultedAids
  }
}

/** Accessible description for the grip chip: the word, its source and its freshness. */
export function rc08GripDescription(model: Rc08GripModel): string {
  if (model.unavailable) return 'Grip state unavailable, no track condition feed'
  const source = model.source === 'driver' ? 'driver toggle' : 'track condition sensor'
  return `Grip state ${model.label} from ${source}${model.stale ? ', stale' : ''}`
}

/** Accessible description for a corner cell: its own temperature and its own crossover side. */
export function rc08CornerDescription(model: Rc08CornerModel): string {
  if (model.tempC === null) return `${model.corner} tyre temperature unavailable`
  const side =
    model.crossover === 'COLD'
      ? 'below the wet window'
      : model.crossover === 'DRY'
        ? 'above the wet window'
        : 'inside the wet window'
  return `${model.corner} tyre ${Math.round(model.tempC)} degrees, ${side}${model.cold ? ', cold in the wet' : ''}`
}

export type { Rc01Field as Rc08Field }
