/**
 * RaceCon RC-17 "High Line — Oval Spotter Awareness" — core model.
 *
 * Packet: `session-files/racecon-20/RC-17/ARTIFACT-PACKET.md`
 * (sha256 eabd7933f3330da28773cfd8a7346d49c3941ba9d8a30af553dcf9c168429592, left unmodified).
 * Approved reference: attempt-005 `transform/rc17-attempt005-governed-800x480.png`
 * (sha256 7ad2df1e21aea8d8bea1574f7daea517e6446cd9315db6f2b0969aa921c2bda7), whose
 * `image-qa-v1.md` verdict is APPROVED with zero blocking failures.
 *
 * The packet beats the reference image. Every zone rectangle, colour token, type size and ring
 * radius below is arithmetic from packet 11.1 / 11.2 / 11.3 / 12.1, never traced off the render
 * (brief normative overrides OV-1, OV-3, OV-5). The telemetry machinery is RC-01's and is
 * imported, never forked.
 */
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import {
  RC01_MIN_STREAM_FRESH_MS,
  type Rc01ChannelName,
  type Rc01ChannelReceipt,
  type Rc01DashboardModel,
  type Rc01Field,
  createRc01DashboardModel,
  rc01MonotonicNow,
  rc01ReceiptAgeMs
} from './raceconRc01Core'

export const RC17_NATIVE_WIDTH_PX = 800
export const RC17_NATIVE_HEIGHT_PX = 480
export const RC17_NATIVE_TOLERANCE_PX = 1
export const RC17_APP_WIDTH_PX = 1024
export const RC17_APP_HEIGHT_PX = 600

export const RC17_PHONE_MIN_WIDTH_PX = 360
export const RC17_PHONE_MAX_WIDTH_PX = 480
export const RC17_PHONE_MIN_HEIGHT_PX = 650
export const RC17_LANDSCAPE_MIN_WIDTH_PX = 650
export const RC17_LANDSCAPE_MIN_HEIGHT_PX = 360
export const RC17_LANDSCAPE_MAX_HEIGHT_PX = 480

export type Rc17CompactMode = 'phone' | 'landscape' | 'standard'
export type Rc17Layout = 'native' | 'app' | 'compact'

/** Packet 11.3, verbatim. OV-5: the render's #FD437B is never sampled; the token is used. */
export const RC17_TOKENS = Object.freeze({
  bg: '#0B0C10',
  panel: '#14171F',
  primary: '#EEF0F5',
  secondary: '#8A90A0',
  info: '#4A9CE0',
  normal: '#46C070',
  caution: '#FFB82E',
  danger: '#FF4436',
  signature: '#FF5AA0'
})

/**
 * Everything the packet asks for that this app cannot honestly supply, with the rule applied
 * instead. Each entry is a NORMATIVE OVERRIDE: the structure is still rendered, but it publishes
 * an honest empty state rather than a plausible number. The packet file itself is never edited.
 */
export const RC17_PACKET_OMISSIONS = Object.freeze({
  lineChoice:
    'GAP-1 packet 10/11.1/11.2 make the high/low line cue PRIMARY and give it the 40 px slot, but section 16 declares no channel and the app has none: the recommendation slot dashes for ever and HIGH/LOW render identically dim with no selection marker.',
  laneUsageHistory:
    'GAP-1/OV-12 packet 12.1 lane-usage history depends on the same absent lane channel, so the app-only module renders its structure with ZERO rows and the honest NO LANE SOURCE word.',
  insideOutsideWording:
    "GAP-4 packet 11.1/19 spell the flags CAR INSIDE / CAR OUTSIDE, but the app's authoritative proximity channel is car-relative left/right and NO channel reports the oval's turn direction; calling left 'inside' would be an invention, so the flags spell the side the channel can assert and the 9 / 3 o'clock sector positions are kept exactly.",
  behindSectorSource:
    "GAP-4 packet 16's 'enum L/R/clear' has no member for the 6 o'clock sector, so BEHIND is bound to the proximity radar's own geometry instead and dashes whenever the radar is absent or stale — it is never inferred from the spotter enum.",
  closingRateChannel:
    'GAP-2 packet 11.1 requires a closing rate and 15 thresholds an alert on it, yet section 16 declares no channel. It is MEASURED from consecutive radar ranges of the SAME car and dashes until two such samples exist inside the sample window; it is never estimated from speed, gap or position.',
  closingThreshold:
    'GAP-2 packet 15 names no fast-closing threshold, so RC17_FAST_CLOSING_MPS is a declared CONFIGURATION constant in metres per second, never telemetry and never printed.',
  radarEnvelope:
    "GAP-2 packet 16 types the radar 'enum + angle' but names no range, so RC17_RADAR_RANGE_M is declared CONFIGURATION in metres; contacts outside it are not plotted rather than being squashed onto the rim.",
  revScaleEnd:
    'GAP-6 packet 11.4 needs a rev scale end that exists nowhere in the packet. The cue is rpm / maxRpm from the real channel pair and is hidden outright when maxRpm is absent; it is never a hard-coded redline.',
  proximityCadence:
    "GAP-8 packet 16's 50 ms proximity and radar freshness is below this app's slowest stream cadence plus its jitter budget, so both are floored at RC01_MIN_STREAM_FRESH_MS; the packet value would report a healthy feed as permanently stale.",
  tertiaryZone:
    'GAP-5 packet 11.1 and 12.1 give gear, engine RPM and water temperature NO zone on either canvas although 16 declares all three and 10 lists them as tertiary. Both canvases get a governed tertiary strip in space the packet leaves unassigned.',
  sideFlagAppZone:
    'GAP-7 packet 12.1 drops the persistent side flags although 19 makes them an accessibility requirement and 15 makes them an alert surface, so the app canvas gets a governed flag band in its unassigned top strip.',
  softKeyToggle:
    "GAP-1 packet 11.5's soft key toggles line-choice guidance; with no line channel there is nothing to toggle, so no control is rendered rather than shipping a dead key.",
  threeWideEnum:
    "GAP-3 packet 16's declared enum cannot express both sides at once, so 15's three-wide alert would be unimplementable. This app's decided-side channel DOES carry a 'both' member, so the alert is implemented from it — and it is gated on that channel, never on the radar."
})

// ─────────────────────────────────────────────────────────────────── channels

/** Packet 11.1's three data sectors. 12 o'clock is structural heading, never data (OV-10). */
export const RC17_SECTORS = ['LEFT', 'RIGHT', 'BEHIND'] as const
export type Rc17Sector = (typeof RC17_SECTORS)[number]

/** The two sectors packet 15's 'Car alongside' and 'Three-wide risk' alerts can occupy. */
export const RC17_SIDES = ['LEFT', 'RIGHT'] as const
export type Rc17Side = (typeof RC17_SIDES)[number]

export type Rc17Quadrant = Rc17Sector | 'HEADING'
export const RC17_QUADRANTS: readonly Rc17Quadrant[] = Object.freeze(['HEADING', 'RIGHT', 'BEHIND', 'LEFT'])

/** Clock-face position of each data sector, exactly as packet 11.1 assigns them. */
export const RC17_SECTOR_CLOCK: Readonly<Record<Rc17Sector, number>> = Object.freeze({
  LEFT: 9,
  RIGHT: 3,
  BEHIND: 6
})

/** The decided-side enum this app publishes, in rank order. Index 0 is a real 'clear' reading. */
export const RC17_SPOTTER_ZONES = ['clear', 'left', 'right', 'both'] as const
export type Rc17SpotterZone = (typeof RC17_SPOTTER_ZONES)[number]

/** Packet 16 freshness for the proximity pair, before the app's stream floor is applied. */
export const RC17_PACKET_PROXIMITY_FRESH_MS = 50

/**
 * RC-17's own channels. `spotter` and `radar` are floored at the app's slowest stream cadence
 * plus its jitter budget (`RC17_PACKET_OMISSIONS.proximityCadence`); `water` takes packet 16's
 * 500 ms unchanged. Speed, gap ahead, position, gear and RPM are NOT here — RC-01 already owns
 * them with thresholds that match packet 16 exactly, so they are reused rather than duplicated.
 */
export const RC17_CHANNEL_STALE_MS = {
  spotter: Math.max(RC17_PACKET_PROXIMITY_FRESH_MS, RC01_MIN_STREAM_FRESH_MS),
  radar: Math.max(RC17_PACKET_PROXIMITY_FRESH_MS, RC01_MIN_STREAM_FRESH_MS),
  water: 500
} as const

export type Rc17AuxChannel = keyof typeof RC17_CHANNEL_STALE_MS

/** Declared CONFIGURATION, never telemetry, never printed. See the omissions above. */
export const RC17_RADAR_RANGE_M = 25
export const RC17_FAST_CLOSING_MPS = 2.5
/** A closing rate is only measurable between two samples of one car inside this window. */
export const RC17_CLOSING_SAMPLE_MAX_GAP_MS = 600
/** Below this separation the range difference is noise, not a rate. */
export const RC17_CLOSING_SAMPLE_MIN_DT_MS = 80
/** How many range samples one car keeps; a 600 ms window at 60 Hz needs about 36. */
export const RC17_CLOSING_SAMPLE_LIMIT = 48
/** How long a measured rate stays usable before it must be re-measured. */
export const RC17_CLOSING_RATE_HOLD_MS = 600
/** The ring plots the nearest contacts; the app-only pack map plots more of them. */
export const RC17_RING_MAX_CONTACTS = 6
export const RC17_PACK_MAP_MAX_CONTACTS = 12

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** RC-17 reuses RC-01's field shape verbatim; the alias exists only so call sites read RC-17. */
export type Rc17Field = Rc01Field

function field(
  value: string,
  raw: number | string | null,
  stale = false,
  isUnavailable = false,
  tone: Rc01Field['tone'] = 'primary'
): Rc01Field {
  return { value, raw, stale, unavailable: isUnavailable, tone }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Every RC-17 channel is read straight from its own declared source. The spotter side is never
 * inferred from the radar, the radar is never synthesised from the spotter side, the closing
 * rate is never taken from speed or gap, and the water temperature is never estimated.
 */
export function rc17AuxChannelValue(snapshot: TelemetrySnapshot, channel: Rc17AuxChannel): number | null {
  switch (channel) {
    // Packet 16 "Spotter proximity zone". A 'clear' reading is a real reading and ranks 0, so a
    // live feed reporting no neighbour is distinguishable from a feed that is not there at all.
    case 'spotter': {
      const index = RC17_SPOTTER_ZONES.indexOf(snapshot.carLeftRight as Rc17SpotterZone)
      return index < 0 ? null : index
    }
    // Packet 16 "Proximity radar". An empty array is a live radar reporting zero contacts.
    case 'radar':
      return Array.isArray(snapshot.radarCars) ? snapshot.radarCars.length : null
    case 'water':
      return finite(snapshot.waterTempC) ? snapshot.waterTempC : null
  }
  return null
}

/**
 * Receipts for RC-17's own channels with exactly RC-01's semantics: a receipt is written only
 * when the channel actually reports, so a channel that falls silent ages out and degrades to its
 * packet state instead of freezing on its last value.
 */
export class Rc17AuxBuffer {
  private channelReceipts = new Map<Rc17AuxChannel, Rc01ChannelReceipt>()

  clone(): Rc17AuxBuffer {
    const next = new Rc17AuxBuffer()
    next.channelReceipts = new Map(this.channelReceipts)
    return next
  }

  reset(): void {
    this.channelReceipts = new Map()
  }

  ingest(snapshot: TelemetrySnapshot | null | undefined, receivedAt = rc01MonotonicNow()): void {
    if (!snapshot || !snapshot.connected || !finite(snapshot.timestamp)) return
    const safeReceiptAt = finite(receivedAt) && receivedAt >= 0 ? receivedAt : rc01MonotonicNow()
    for (const channel of Object.keys(RC17_CHANNEL_STALE_MS) as Rc17AuxChannel[]) {
      const value = rc17AuxChannelValue(snapshot, channel)
      if (value === null) continue
      this.channelReceipts.set(
        channel,
        Object.freeze({ value, snapshotTimestamp: snapshot.timestamp, receivedAt: safeReceiptAt })
      )
    }
  }

  receipts(): ReadonlyMap<Rc17AuxChannel, Rc01ChannelReceipt> {
    return new Map(this.channelReceipts)
  }
}

export function createRc17AuxReceipts(
  snapshot: TelemetrySnapshot,
  receivedAt = rc01MonotonicNow()
): ReadonlyMap<Rc17AuxChannel, Rc01ChannelReceipt> {
  const buffer = new Rc17AuxBuffer()
  buffer.ingest(snapshot, receivedAt)
  return buffer.receipts()
}

interface Rc17Reading {
  value: number | null
  stale: boolean
  reported: boolean
}

function auxReading(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc17AuxChannel, Rc01ChannelReceipt>,
  channel: Rc17AuxChannel,
  nowMs: number
): Rc17Reading {
  const raw = snapshot ? rc17AuxChannelValue(snapshot, channel) : null
  const receipt = receipts.get(channel)
  if (raw === null || !receipt) return { value: null, stale: false, reported: false }
  const stale = rc01ReceiptAgeMs(receipt, nowMs) > RC17_CHANNEL_STALE_MS[channel]
  return { value: stale ? null : raw, stale, reported: true }
}

// ───────────────────────────────────────────────────────────── radar geometry

export interface Rc17RadarContact {
  carIdx: number
  /** Metres, left negative / right positive, exactly as the provider publishes it. */
  relativeXM: number
  /** Metres, ahead positive / behind negative, exactly as the provider publishes it. */
  relativeYM: number
  rangeM: number
  /** Clock angle in SVG convention: 0 is 3 o'clock and the angle grows clockwise. */
  angleDeg: number
  quadrant: Rc17Quadrant
}

/** Packet 11.1's four 90-degree quadrants, split by the hairlines at 45/135/225/315. */
export function rc17QuadrantForAngle(angleDeg: number): Rc17Quadrant {
  const normalised = ((angleDeg % 360) + 360) % 360
  if (normalised >= 45 && normalised < 135) return 'BEHIND'
  if (normalised >= 135 && normalised < 225) return 'LEFT'
  if (normalised >= 225 && normalised < 315) return 'HEADING'
  return 'RIGHT'
}

/**
 * Packet 16 "Proximity radar": the real relative-position feed, never a phantom. A car outside
 * the declared envelope is DROPPED rather than pinned to the rim, because pinning it would
 * assert a proximity the channel does not report.
 */
export function rc17RadarContacts(
  snapshot: TelemetrySnapshot | null,
  rangeLimitM = RC17_RADAR_RANGE_M
): readonly Rc17RadarContact[] {
  const cars = snapshot?.radarCars
  if (!Array.isArray(cars)) return []
  const contacts: Rc17RadarContact[] = []
  for (const car of cars) {
    if (!car || !finite(car.relativeX) || !finite(car.relativeY) || !finite(car.carIdx)) continue
    const rangeM = Math.hypot(car.relativeX, car.relativeY)
    if (!finite(rangeM) || rangeM > rangeLimitM) continue
    // Screen vector: x grows right, y grows down, so "ahead" is negative y.
    const angleDeg = ((Math.atan2(-car.relativeY, car.relativeX) * 180) / Math.PI + 360) % 360
    contacts.push({
      carIdx: car.carIdx,
      relativeXM: car.relativeX,
      relativeYM: car.relativeY,
      rangeM: round2(rangeM),
      angleDeg: round2(angleDeg),
      quadrant: rc17QuadrantForAngle(angleDeg)
    })
  }
  return contacts.sort((a, b) => a.rangeM - b.rangeM)
}

/**
 * Packet 15's closing rate, MEASURED. `RC17_PACKET_OMISSIONS.closingRateChannel`: the packet
 * declares no channel, so the rate is the first difference of one car's OWN radar range. Two
 * samples of the same `carIdx` must fall inside the sample window; a car that disappears, a
 * frame that skips, or a first sighting produce NO rate at all rather than a plausible one.
 */
export interface Rc17ClosingRate {
  sector: Rc17Sector
  carIdx: number
  mps: number
  measuredAtMs: number
}

export class Rc17ClosingTracker {
  private samples = new Map<number, { rangeM: number; atMs: number }[]>()
  private measured = new Map<Rc17Sector, Rc17ClosingRate>()

  clone(): Rc17ClosingTracker {
    const next = new Rc17ClosingTracker()
    next.samples = new Map(Array.from(this.samples, ([carIdx, history]) => [carIdx, [...history]]))
    next.measured = new Map(this.measured)
    return next
  }

  reset(): void {
    this.samples = new Map()
    this.measured = new Map()
  }

  /**
   * The rate is measured over a WINDOW, not between adjacent frames: this app's slowest stream
   * cadence is coarser than the minimum separation a range difference needs to be signal rather
   * than quantisation noise, so consecutive frames alone could never measure anything at all.
   */
  observe(nowMs: number, contacts: readonly Rc17RadarContact[]): void {
    if (!finite(nowMs)) return
    const nextSamples = new Map<number, { rangeM: number; atMs: number }[]>()
    const fastest = new Map<Rc17Sector, Rc17ClosingRate>()
    for (const contact of contacts) {
      // A car that was not reported last frame loses its whole history: a gap in the radar must
      // leave a gap in the measurement, never a rate smeared across the missing time.
      const history = (this.samples.get(contact.carIdx) ?? []).filter(
        (sample) => nowMs - sample.atMs <= RC17_CLOSING_SAMPLE_MAX_GAP_MS && nowMs - sample.atMs >= 0
      )
      const anchor = history.find((sample) => nowMs - sample.atMs >= RC17_CLOSING_SAMPLE_MIN_DT_MS)
      history.push({ rangeM: contact.rangeM, atMs: nowMs })
      nextSamples.set(contact.carIdx, history.slice(-RC17_CLOSING_SAMPLE_LIMIT))

      const sector = contact.quadrant === 'HEADING' ? null : contact.quadrant
      if (sector === null || !anchor) continue
      const mps = round2(((anchor.rangeM - contact.rangeM) * 1_000) / (nowMs - anchor.atMs))
      const held = fastest.get(sector)
      if (!held || mps > held.mps) {
        fastest.set(sector, { sector, carIdx: contact.carIdx, mps, measuredAtMs: nowMs })
      }
    }
    this.samples = nextSamples
    this.measured = fastest
  }

  /** Only rates measured recently enough to still describe the present are returned. */
  rates(nowMs: number): Readonly<Partial<Record<Rc17Sector, Rc17ClosingRate>>> {
    const live: Partial<Record<Rc17Sector, Rc17ClosingRate>> = {}
    for (const [sector, rate] of this.measured) {
      if (!finite(nowMs) || nowMs - rate.measuredAtMs > RC17_CLOSING_RATE_HOLD_MS) continue
      live[sector] = rate
    }
    return live
  }
}

// ──────────────────────────────────────────────────────────── ring geometry

/**
 * OV-3: the whole assembly, heading tick included, must fit inside packet 11.1's 260x260 zone.
 * The reference render's 149.5 px outer circle overhangs it and is never traced. OV-2: the own
 * car marker sits on the exact centre, not 13.5 px off it.
 */
export const RC17_RING = Object.freeze({
  viewBox: 260,
  centre: 130,
  outerRadius: 114,
  innerRadius: 86,
  bandWidth: 28,
  wordRadius: 100,
  ownCarRadius: 9,
  contactRadius: 7,
  contactMinRadius: 20,
  headingTickInner: 118,
  headingTickOuter: 128
})

/**
 * Each sector word is drawn to a FIXED advance width so it can never depend on which font the
 * host resolved. The left and right words sit 100 units off centre, so their whole budget is the
 * remaining 30 units either side minus a margin; the behind word has the full width available.
 */
export const RC17_SECTOR_WORD_LENGTH: Readonly<Record<Rc17Sector, number>> = Object.freeze({
  LEFT: 48,
  RIGHT: 48,
  BEHIND: 68
})

/** Packet 11.1's quadrant boundaries, in the SVG angle convention. */
export const RC17_QUADRANT_ARCS: Readonly<Record<Rc17Quadrant, readonly [number, number]>> = Object.freeze({
  RIGHT: [-45, 45],
  BEHIND: [45, 135],
  LEFT: [135, 225],
  HEADING: [225, 315]
})

export function rc17RingPoint(angleDeg: number, radius: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180
  return {
    x: round2(RC17_RING.centre + radius * Math.cos(rad)),
    y: round2(RC17_RING.centre + radius * Math.sin(rad))
  }
}

/** One 90-degree annulus sector of the proximity ring, as an SVG path. */
export function rc17QuadrantPath(quadrant: Rc17Quadrant): string {
  const [from, to] = RC17_QUADRANT_ARCS[quadrant]
  const outerFrom = rc17RingPoint(from, RC17_RING.outerRadius)
  const outerTo = rc17RingPoint(to, RC17_RING.outerRadius)
  const innerTo = rc17RingPoint(to, RC17_RING.innerRadius)
  const innerFrom = rc17RingPoint(from, RC17_RING.innerRadius)
  const ro = RC17_RING.outerRadius
  const ri = RC17_RING.innerRadius
  return [
    `M ${outerFrom.x} ${outerFrom.y}`,
    `A ${ro} ${ro} 0 0 1 ${outerTo.x} ${outerTo.y}`,
    `L ${innerTo.x} ${innerTo.y}`,
    `A ${ri} ${ri} 0 0 0 ${innerFrom.x} ${innerFrom.y}`,
    'Z'
  ].join(' ')
}

/** OV-11: the sector word rides its own arc, so a 260 px zone never has to fit two beside it. */
export function rc17SectorWordPoint(sector: Rc17Sector): { x: number; y: number } {
  const [from, to] = RC17_QUADRANT_ARCS[sector]
  return rc17RingPoint((from + to) / 2, RC17_RING.wordRadius)
}

/**
 * Where a contact plots inside the ring. The radius is its MEASURED range mapped onto the inner
 * field, floored clear of the own-car marker so no neighbour is ever drawn on top of the driver.
 */
export function rc17ContactPoint(contact: Rc17RadarContact, rangeLimitM = RC17_RADAR_RANGE_M): { x: number; y: number } {
  const usable = RC17_RING.innerRadius - RC17_RING.contactRadius - 6
  const span = Math.max(0, usable - RC17_RING.contactMinRadius)
  const ratio = rangeLimitM > 0 ? clamp(contact.rangeM / rangeLimitM, 0, 1) : 0
  return rc17RingPoint(contact.angleDeg, RC17_RING.contactMinRadius + ratio * span)
}

// ─────────────────────────────────────────────────────────────── type ladder

/**
 * Packet 11.2 in pixels on the 800x480 canvas, arithmetic and NOT measured off the render.
 * `flag`, `tertiary` and `label` are declared here because 11.2 omits them (GAP-8); each sits
 * strictly BELOW the smallest packet rung so no declared size can outrank a packet one — the
 * approved frame ranks its sector word above its side flag for the same reason.
 * OV-7: these are SLOT sizes. A dashed slot keeps its size and its dash is never enlarged.
 *
 * `sector` is the one ring-relative rung: it is 20 px exactly on the native canvas, where 11.2
 * is defined, and thereafter scales with the ring because packet 12.1 enlarges the clock. The
 * stylesheet caps the ring so that word can never overtake the largest live-data rung, `pace`.
 */
export const RC17_TYPE_SCALE_PX = Object.freeze({
  closing: 44,
  line: 40,
  pace: 34,
  sector: 20,
  flag: 18,
  tertiary: 15,
  label: 13
})

/** One container-query width unit is one hundredth of the native canvas: 800 / 100 = 8 px. */
export const RC17_CQW_PX = RC17_NATIVE_WIDTH_PX / 100

export function rc17TypeScaleCqw(px: number): number {
  return Math.round((px / RC17_CQW_PX) * 1_000) / 1_000
}

// ────────────────────────────────────────────────────────────────── zones

export interface Rc17Rect {
  left: number
  top: number
  width: number
  height: number
}

export type Rc17ZoneId = 'flags' | 'line' | 'clock' | 'closing' | 'pace' | 'tertiary' | 'packMap' | 'lane'

export type Rc17ZoneMap = Readonly<Partial<Record<Rc17ZoneId, Rc17Rect>>>

function pctRect(x: number, y: number, w: number, h: number, canvasW: number, canvasH: number): Rc17Rect {
  return {
    left: round2((x / canvasW) * 100),
    top: round2((y / canvasH) * 100),
    width: round2((w / canvasW) * 100),
    height: round2((h / canvasH) * 100)
  }
}

function nativeRect(x: number, y: number, w: number, h: number): Rc17Rect {
  return pctRect(x, y, w, h, RC17_NATIVE_WIDTH_PX, RC17_NATIVE_HEIGHT_PX)
}

function appRect(x: number, y: number, w: number, h: number): Rc17Rect {
  return pctRect(x, y, w, h, RC17_APP_WIDTH_PX, RC17_APP_HEIGHT_PX)
}

/**
 * Packet 11.1 verbatim, plus the one governed addition the brief records: gear, RPM and water
 * are declared channels and section 10 tertiary items with no zone anywhere (GAP-5), so they get
 * a strip in the 800x80 band the packet leaves unassigned beneath the pace strip.
 */
export const RC17_NATIVE_ZONES: Rc17ZoneMap = Object.freeze({
  flags: nativeRect(40, 50, 200, 30),
  line: nativeRect(40, 90, 200, 180),
  clock: nativeRect(270, 50, 260, 260),
  closing: nativeRect(560, 90, 200, 180),
  pace: nativeRect(40, 320, 720, 80),
  tertiary: nativeRect(40, 410, 720, 50)
})

/**
 * Packet 12.1 `pack-map-reveal`. Width buys the pack map and the lane-usage history; the clock
 * stays the hero. Two governed additions fill space 12.1 leaves unassigned: the side flags,
 * which 12.1 drops although 19 makes them an accessibility requirement (GAP-7), take the top
 * band; the tertiary strip takes the 260x180 block at the bottom right (GAP-5). The packet's
 * single "Line + closing" rectangle is split into its two named halves so each keeps its own
 * zone and the fast-closing alert keeps a surface of its own.
 */
export const RC17_APP_ZONES: Rc17ZoneMap = Object.freeze({
  flags: appRect(48, 12, 300, 36),
  packMap: appRect(48, 60, 300, 300),
  clock: appRect(372, 60, 300, 300),
  line: appRect(716, 60, 260, 145),
  closing: appRect(716, 215, 260, 145),
  lane: appRect(372, 380, 300, 180),
  pace: appRect(48, 400, 300, 160),
  tertiary: appRect(716, 380, 260, 180)
})

/**
 * Compact breakpoints are not packet-specified. They keep every packet 11.1 module and drop only
 * the two 12.1 app-only ones, so all three packet 15 alert surfaces — the lit sector, the
 * persistent flag and the closing panel — stay visible at every size.
 */
function rc17CompactZones(mode: Rc17CompactMode): Rc17ZoneMap {
  if (mode === 'phone') {
    return Object.freeze({
      flags: { left: 2, top: 2, width: 96, height: 5 },
      clock: { left: 2, top: 8, width: 96, height: 40 },
      line: { left: 2, top: 49.5, width: 47, height: 12 },
      closing: { left: 51, top: 49.5, width: 47, height: 12 },
      pace: { left: 2, top: 63, width: 96, height: 14 },
      tertiary: { left: 2, top: 78.5, width: 96, height: 10 }
    })
  }
  if (mode === 'landscape') {
    return Object.freeze({
      flags: { left: 2, top: 3, width: 24, height: 8 },
      line: { left: 2, top: 13, width: 24, height: 40 },
      clock: { left: 30, top: 3, width: 40, height: 62 },
      closing: { left: 74, top: 13, width: 24, height: 40 },
      pace: { left: 2, top: 68, width: 96, height: 16 },
      tertiary: { left: 2, top: 86, width: 96, height: 11 }
    })
  }
  return Object.freeze({
    flags: { left: 2, top: 2.5, width: 24, height: 7 },
    line: { left: 2, top: 11.5, width: 24, height: 42 },
    clock: { left: 30, top: 2.5, width: 40, height: 63 },
    closing: { left: 74, top: 11.5, width: 24, height: 42 },
    pace: { left: 2, top: 68, width: 96, height: 17 },
    tertiary: { left: 2, top: 87, width: 96, height: 10 }
  })
}

export function rc17ZonesForLayout(layout: Rc17Layout, compactMode: Rc17CompactMode = 'standard'): Rc17ZoneMap {
  if (layout === 'native') return RC17_NATIVE_ZONES
  if (layout === 'app') return RC17_APP_ZONES
  return rc17CompactZones(compactMode)
}

/** The inline geometry a zone element carries, so CSS and the packet table cannot drift. */
export function rc17ZoneStyle(rect: Rc17Rect | undefined): {
  left: string
  top: string
  width: string
  height: string
} | null {
  if (!rect) return null
  return {
    left: rc17Percent(rect.left),
    top: rc17Percent(rect.top),
    width: rc17Percent(rect.width),
    height: rc17Percent(rect.height)
  }
}

export function rc17RectsOverlap(a: Rc17Rect, b: Rc17Rect): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  )
}

export function rc17Percent(value: number): string {
  const safe = finite(value) ? value : 0
  return `${Math.round(safe * 1_000) / 1_000}%`
}

export function rc17LayoutForContentBox(width: number, height: number): Rc17Layout {
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return 'app'
  if (
    Math.abs(width - RC17_NATIVE_WIDTH_PX) <= RC17_NATIVE_TOLERANCE_PX &&
    Math.abs(height - RC17_NATIVE_HEIGHT_PX) <= RC17_NATIVE_TOLERANCE_PX
  ) {
    return 'native'
  }
  if (width >= RC17_APP_WIDTH_PX - 1 && height >= RC17_APP_HEIGHT_PX - 1) return 'app'
  return 'compact'
}

export function rc17CompactModeForContentBox(width: number, height: number): Rc17CompactMode {
  if (rc17LayoutForContentBox(width, height) !== 'compact') return 'standard'
  if (
    width >= RC17_PHONE_MIN_WIDTH_PX &&
    width <= RC17_PHONE_MAX_WIDTH_PX &&
    height >= RC17_PHONE_MIN_HEIGHT_PX &&
    height / width >= 1.5
  ) {
    return 'phone'
  }
  if (
    width >= RC17_LANDSCAPE_MIN_WIDTH_PX &&
    height >= RC17_LANDSCAPE_MIN_HEIGHT_PX &&
    height <= RC17_LANDSCAPE_MAX_HEIGHT_PX &&
    width / height >= 1.5
  ) {
    return 'landscape'
  }
  return 'standard'
}

export interface Rc17PhoneGeometry {
  inset: number
  flagHeight: number
  rowHeight: number
  tertiaryHeight: number
}

/** Portrait band heights in pixels, measured from the real box rather than from a percentage. */
export function rc17PhoneGeometryForContentBox(width: number, height: number): Rc17PhoneGeometry | null {
  if (rc17CompactModeForContentBox(width, height) !== 'phone') return null
  return {
    inset: 12,
    flagHeight: Math.max(22, Math.round(height * 0.045)),
    rowHeight: Math.max(34, Math.round(height * 0.07)),
    tertiaryHeight: Math.max(30, Math.round(height * 0.06))
  }
}

// ───────────────────────────────────────────────────────────────── alerts

/** Packet 15 debounce and hysteresis, verbatim. */
export const RC17_ALONGSIDE_RELEASE_MS = 300
export const RC17_FAST_CLOSING_ENGAGE_MS = 200
export const RC17_THREE_WIDE_ENGAGE_MS = 150

export interface Rc17AlertState {
  carAlongside: {
    active: boolean
    sides: readonly Rc17Side[]
    releaseSinceMs: number | null
  }
  fastClosing: {
    active: boolean
    sector: Rc17Sector | null
    pendingSector: Rc17Sector | null
    pendingSinceMs: number | null
  }
  threeWide: {
    active: boolean
    pendingSinceMs: number | null
  }
}

export interface Rc17AlertInput {
  nowMs: number
  /**
   * The sides the spotter zone POSITIVELY reports this frame; `[]` is a live 'clear' reading and
   * `null` is no usable channel at all. A `null` can never leave an alert latched, and it is
   * never rendered as 'clear'.
   */
  occupiedSides: readonly Rc17Side[] | null
  /** MEASURED closing rates per sector, m/s. Absent whenever the radar could not measure one. */
  closingMps: Readonly<Partial<Record<Rc17Sector, number>>>
  /** True only while the radar channel is present and fresh. */
  radarAvailable: boolean
}

export function createRc17AlertState(): Rc17AlertState {
  return {
    carAlongside: { active: false, sides: [], releaseSinceMs: null },
    fastClosing: { active: false, sector: null, pendingSector: null, pendingSinceMs: null },
    threeWide: { active: false, pendingSinceMs: null }
  }
}

function cloneRc17AlertState(state: Rc17AlertState): Rc17AlertState {
  return {
    carAlongside: { ...state.carAlongside, sides: [...state.carAlongside.sides] },
    fastClosing: { ...state.fastClosing },
    threeWide: { ...state.threeWide }
  }
}

/**
 * Every alert is silent until its own trigger fires, carries packet 15's debounce and hysteresis,
 * has an explicit clear condition, and is unlatched the moment its input goes missing or stale.
 * Nothing in the alert layer is ever an always-on decoration.
 */
export function advanceRc17Alerts(state: Rc17AlertState, input: Rc17AlertInput): Rc17AlertState {
  const nowMs = finite(input.nowMs) ? input.nowMs : 0
  const next = cloneRc17AlertState(state)

  // ── Car alongside: persistent while true, with packet 15's 300 ms RELEASE hysteresis so a car
  //    hovering on the sector edge cannot flicker the flag. A missing channel drops it at once —
  //    packet 16 forbids showing 'clear', and the display says NO DATA instead of holding a lie.
  if (input.occupiedSides === null) {
    next.carAlongside = { active: false, sides: [], releaseSinceMs: null }
  } else if (input.occupiedSides.length > 0) {
    next.carAlongside = { active: true, sides: [...input.occupiedSides], releaseSinceMs: null }
  } else if (next.carAlongside.active) {
    const releaseSinceMs = next.carAlongside.releaseSinceMs ?? nowMs
    next.carAlongside =
      nowMs - releaseSinceMs >= RC17_ALONGSIDE_RELEASE_MS
        ? { active: false, sides: [], releaseSinceMs: null }
        : { ...next.carAlongside, releaseSinceMs }
  } else {
    next.carAlongside = { active: false, sides: [], releaseSinceMs: null }
  }

  // ── Fast closing: 200 ms engage on a MEASURED rate above the declared threshold; the alert
  //    clears the instant the rate drops back, and a radar that is gone hides it entirely.
  const qualifying = input.radarAvailable ? fastestQualifyingSector(input.closingMps) : null
  if (qualifying === null) {
    next.fastClosing = { active: false, sector: null, pendingSector: null, pendingSinceMs: null }
  } else {
    const restart = next.fastClosing.pendingSector !== qualifying || next.fastClosing.pendingSinceMs === null
    const pendingSinceMs = restart ? nowMs : (next.fastClosing.pendingSinceMs as number)
    const engaged = nowMs - pendingSinceMs >= RC17_FAST_CLOSING_ENGAGE_MS
    next.fastClosing = {
      active: engaged,
      sector: engaged ? qualifying : null,
      pendingSector: qualifying,
      pendingSinceMs
    }
  }

  // ── Three-wide risk: 150 ms engage while BOTH sides are occupied, cleared the moment one of
  //    them empties. Gated on the spotter channel, which is the only channel that can assert it.
  const bothOccupied =
    input.occupiedSides !== null &&
    input.occupiedSides.includes('LEFT') &&
    input.occupiedSides.includes('RIGHT')
  if (!bothOccupied) {
    next.threeWide = { active: false, pendingSinceMs: null }
  } else {
    const pendingSinceMs = next.threeWide.pendingSinceMs ?? nowMs
    next.threeWide = {
      active: nowMs - pendingSinceMs >= RC17_THREE_WIDE_ENGAGE_MS,
      pendingSinceMs
    }
  }

  return next
}

function fastestQualifyingSector(rates: Readonly<Partial<Record<Rc17Sector, number>>>): Rc17Sector | null {
  let best: Rc17Sector | null = null
  let bestRate = RC17_FAST_CLOSING_MPS
  for (const sector of RC17_SECTORS) {
    const rate = rates[sector]
    if (!finite(rate) || rate <= bestRate) continue
    best = sector
    bestRate = rate
  }
  return best
}

/** A stale, missing or refused input can never leave a condition alert latched on. */
export function clearInvalidRc17Alerts(state: Rc17AlertState, model: Rc17DashboardModel): Rc17AlertState {
  const next = cloneRc17AlertState(state)
  if (model.spotter.unavailable || model.spotter.stale) {
    next.carAlongside = { active: false, sides: [], releaseSinceMs: null }
    next.threeWide = { active: false, pendingSinceMs: null }
  }
  if (!model.radar.available) {
    next.fastClosing = { active: false, sector: null, pendingSector: null, pendingSinceMs: null }
  }
  return next
}

/** The alert lines a surface renders; empty in a silent frame, which is the reference state. */
export function rc17AlertLines(model: Rc17DashboardModel): readonly string[] {
  const lines: string[] = []
  if (model.alerts.carAlongside) lines.push('CAR ALONGSIDE')
  if (model.alerts.fastClosing) lines.push('FAST CLOSING')
  if (model.alerts.threeWide) lines.push('THREE WIDE')
  return lines
}

// ─────────────────────────────────────────────────────────── dashboard model

export const RC17_NO_DATA = 'NO DATA'
export const RC17_NO_LANE_SOURCE = 'NO LANE SOURCE'
export const RC17_NO_RADAR_SOURCE = 'NO RADAR SOURCE'

export interface Rc17SpotterModel {
  zone: Rc17SpotterZone | null
  /** The sides the raw channel reports right now, before the alert hysteresis is applied. */
  sides: readonly Rc17Side[]
  stale: boolean
  unavailable: boolean
}

export interface Rc17SectorModel {
  sector: Rc17Sector
  clockPosition: number
  path: string
  word: { x: number; y: number }
  /** The fixed advance width the word is drawn to, so no host font can widen it out of the zone. */
  wordLength: number
  occupied: boolean
  unavailable: boolean
  /** OV-11: a clear sector carries no word at all; only occupied and unavailable ones do. */
  label: string
  tone: 'signature' | 'info' | 'danger' | 'muted' | 'clear'
}

export interface Rc17RadarModel {
  available: boolean
  stale: boolean
  reported: boolean
  label: string
  contacts: readonly Rc17RadarContact[]
}

export interface Rc17ClosingModel {
  rate: Rc17Field
  side: Rc17Field
  highlighted: boolean
  arrow: '' | 'LEFT' | 'RIGHT' | 'BEHIND'
}

export interface Rc17LineModel {
  recommendation: Rc17Field
  options: readonly { key: 'HIGH' | 'LOW'; selected: boolean }[]
}

export interface Rc17FlagModel {
  text: string
  kind: 'none' | 'occupied' | 'three-wide' | 'unavailable'
}

export interface Rc17AlertFlags {
  carAlongside: boolean
  fastClosing: boolean
  threeWide: boolean
}

export interface Rc17DashboardModel {
  spotter: Rc17SpotterModel
  sectors: readonly Rc17SectorModel[]
  radar: Rc17RadarModel
  packMap: { available: boolean; label: string; contacts: readonly Rc17RadarContact[] }
  lane: { available: boolean; label: string; rows: readonly string[] }
  line: Rc17LineModel
  closing: Rc17ClosingModel
  flag: Rc17FlagModel
  speed: Rc17Field
  gapAhead: Rc17Field
  position: Rc17Field
  gear: Rc17Field
  rpm: Rc17Field
  /** Packet 11.4's thin rev cue: rpm / maxRpm, or `null` when either channel is missing. */
  revFill: number | null
  water: Rc17Field
  alerts: Rc17AlertFlags
  auxFresh: Readonly<Record<Rc17AuxChannel, boolean>>
  criticalFresh: Readonly<Record<Rc01ChannelName, boolean>>
}

export interface Rc17ModelOptions {
  alerts?: Rc17AlertState
  closingRates?: Readonly<Partial<Record<Rc17Sector, Rc17ClosingRate>>>
}

export function rc17SidesForZone(zone: Rc17SpotterZone | null): readonly Rc17Side[] {
  if (zone === 'left') return ['LEFT']
  if (zone === 'right') return ['RIGHT']
  if (zone === 'both') return ['LEFT', 'RIGHT']
  return []
}

/** Packet 16: 'N' or the grey '-'; a gear is never blanked silently and never comes from RPM. */
export function rc17DisplayGear(gear: number | null): string {
  if (gear === null || !finite(gear)) return '-'
  if (gear < 0) return 'R'
  if (gear === 0) return 'N'
  return String(Math.trunc(gear))
}

/**
 * `RC17_PACKET_OMISSIONS.insideOutsideWording`: the flag spells the side the channel can assert.
 * The word is what carries the side for accessibility (packet 19), never the colour.
 */
export function rc17FlagTextForSides(sides: readonly Rc17Side[]): string {
  if (sides.includes('LEFT') && sides.includes('RIGHT')) return 'CARS BOTH SIDES'
  if (sides.includes('LEFT')) return 'CAR LEFT'
  if (sides.includes('RIGHT')) return 'CAR RIGHT'
  return ''
}

/**
 * Re-expresses one of RC-01's fields in RC-17's packet 16 format. A stale or absent channel
 * collapses to its declared dash and never keeps a plausible number on screen.
 */
function dashOnStale(base: Rc01Field, dash: string, format: (raw: number) => string): Rc01Field {
  if (base.unavailable || typeof base.raw !== 'number') return field(dash, null, false, true, 'muted')
  if (base.stale) return field(dash, base.raw, true, false, 'muted')
  return field(format(base.raw), base.raw, false, false, 'primary')
}

export function rc17SectorDescription(sector: Rc17SectorModel): string {
  if (sector.unavailable) return `${sector.sector} sector no data`
  return sector.occupied ? `Car ${sector.sector.toLowerCase()}` : `${sector.sector} sector clear`
}

/**
 * Projects RC-01's shared telemetry model into RC-17's oval spotter display. Nothing is invented,
 * estimated or mirrored: the sector occupancy comes only from the decided-side channel, the
 * behind sector only from the radar's own geometry, the closing rate only from measured radar
 * ranges, and every channel the app does not carry publishes its honest empty state.
 */
export function createRc17DashboardModel(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc01ChannelName, Rc01ChannelReceipt> = new Map(),
  auxReceipts: ReadonlyMap<Rc17AuxChannel, Rc01ChannelReceipt> = new Map(),
  nowMs = rc01MonotonicNow(),
  options: Rc17ModelOptions = {}
): Rc17DashboardModel {
  const base: Rc01DashboardModel = createRc01DashboardModel(snapshot, receipts, nowMs)
  const safeSnapshot = snapshot && snapshot.connected ? snapshot : null
  const alerts = options.alerts ?? createRc17AlertState()
  const closingRates = options.closingRates ?? {}

  const auxFresh = Object.fromEntries(
    (Object.keys(RC17_CHANNEL_STALE_MS) as Rc17AuxChannel[]).map((channel) => [
      channel,
      auxReading(safeSnapshot, auxReceipts, channel, nowMs).value !== null
    ])
  ) as Record<Rc17AuxChannel, boolean>

  // ── Spotter proximity zone. The only channel allowed to assert a side.
  const spotterReading = auxReading(safeSnapshot, auxReceipts, 'spotter', nowMs)
  const spotterZone =
    spotterReading.value === null ? null : (RC17_SPOTTER_ZONES[spotterReading.value] ?? null)
  const spotter: Rc17SpotterModel = {
    zone: spotterZone,
    sides: rc17SidesForZone(spotterZone),
    stale: spotterReading.stale,
    unavailable: !spotterReading.reported || spotterZone === null
  }

  // ── Proximity radar. An empty contact list on a live radar is a real 'nobody there'; a radar
  //    that never reported is unavailable and hides the plot rather than drawing an empty truth.
  const radarReading = auxReading(safeSnapshot, auxReceipts, 'radar', nowMs)
  const radarAvailable = radarReading.value !== null
  const contacts = radarAvailable ? rc17RadarContacts(safeSnapshot) : []
  const radar: Rc17RadarModel = {
    available: radarAvailable,
    stale: radarReading.stale,
    reported: radarReading.reported,
    label: radarAvailable ? 'RADAR LIVE' : RC17_NO_RADAR_SOURCE,
    contacts: contacts.slice(0, RC17_RING_MAX_CONTACTS)
  }

  // ── Sectors. Left and right follow the ALERT, so the packet 15 release hysteresis moves the
  //    glow and the flag together; behind follows the radar, which is the only channel that can
  //    address 6 o'clock at all.
  const litSides = alerts.carAlongside.active ? alerts.carAlongside.sides : []
  const behindOccupied = radarAvailable && contacts.some((contact) => contact.quadrant === 'BEHIND')
  const sectors: readonly Rc17SectorModel[] = RC17_SECTORS.map((sector) => {
    const side: Rc17Side | null = sector === 'BEHIND' ? null : sector
    const unavailable = side === null ? !radarAvailable : spotter.unavailable || spotter.stale
    const occupied = unavailable ? false : side === null ? behindOccupied : litSides.includes(side)
    const threeWideSector = alerts.threeWide.active && side !== null
    return {
      sector,
      clockPosition: RC17_SECTOR_CLOCK[sector],
      path: rc17QuadrantPath(sector),
      word: rc17SectorWordPoint(sector),
      wordLength: RC17_SECTOR_WORD_LENGTH[sector],
      occupied,
      unavailable,
      label: unavailable ? '--' : occupied ? sector : '',
      tone: unavailable
        ? 'muted'
        : !occupied
          ? 'clear'
          : threeWideSector
            ? 'danger'
            : sector === 'BEHIND'
              ? 'info'
              : 'signature'
    }
  })

  // ── The persistent flag. It follows the alert, not the raw channel, so it holds through the
  //    300 ms release exactly as packet 15 requires, and says NO DATA rather than 'clear'.
  const flag: Rc17FlagModel = alerts.threeWide.active
    ? { text: 'THREE WIDE', kind: 'three-wide' }
    : spotter.unavailable || spotter.stale
      ? { text: RC17_NO_DATA, kind: 'unavailable' }
      : litSides.length > 0
        ? { text: rc17FlagTextForSides(litSides), kind: 'occupied' }
        : { text: '', kind: 'none' }

  // ── Line choice. GAP-1: no channel exists, so the slot dashes and neither option is marked.
  const line: Rc17LineModel = {
    recommendation: field('--', null, false, true, 'muted'),
    options: [
      { key: 'HIGH', selected: false },
      { key: 'LOW', selected: false }
    ]
  }

  // ── Closing. GAP-2: MEASURED from radar ranges, never estimated. The panel highlights only
  //    while the packet 15 alert is latched, so it is never an always-on decoration.
  const closingSector = alerts.fastClosing.active ? alerts.fastClosing.sector : null
  const bestRate = closingSector ? closingRates[closingSector] : fastestMeasuredRate(closingRates)
  const closing: Rc17ClosingModel = {
    rate:
      radarAvailable && bestRate
        ? field(bestRate.mps.toFixed(1), bestRate.mps, false, false, 'primary')
        : field('--.-', null, false, true, 'muted'),
    side:
      radarAvailable && bestRate
        ? field(bestRate.sector, bestRate.sector, false, false, 'primary')
        : field('--', null, false, true, 'muted'),
    highlighted: alerts.fastClosing.active,
    arrow: alerts.fastClosing.active && closingSector ? closingSector : ''
  }

  const speed = dashOnStale(base.speed, '---', (raw) => String(Math.round(raw)))
  const gapAhead = dashOnStale(base.gapAhead, '--.-', (raw) => Math.abs(raw).toFixed(1))
  const position = dashOnStale(base.position, '--', (raw) => String(Math.trunc(raw)))
  const gear =
    base.gear.unavailable || base.gear.stale || typeof base.gear.raw !== 'number'
      ? field('-', null, base.gear.stale, true, 'muted')
      : field(rc17DisplayGear(base.gear.raw), base.gear.raw, false, false, 'primary')
  // Packet 16 RPM: freeze the last-known value and grey it; RC-01 already holds the receipt
  // value through a dropout, so the only change here is dropping the thousands separator.
  const rpm =
    base.rpm.unavailable || typeof base.rpm.raw !== 'number'
      ? field('----', null, false, true, 'muted')
      : field(String(Math.round(base.rpm.raw)), base.rpm.raw, base.rpm.stale, false, base.rpm.stale ? 'muted' : 'primary')
  const revFill = base.rpmFresh && base.rpmRatio !== null ? round2(clamp(base.rpmRatio, 0, 1)) : null

  const waterReading = auxReading(safeSnapshot, auxReceipts, 'water', nowMs)
  const water =
    waterReading.value === null
      ? field('--', null, waterReading.stale, !waterReading.reported, 'muted')
      : field(String(Math.round(waterReading.value)), waterReading.value, false, false, 'primary')

  return {
    spotter,
    sectors,
    radar,
    // Packet 12.1's pack map is the same real radar feed, plotted wider. With no radar it shows
    // ZERO rows and says so; it never fabricates a pack (packet 18: "no fabricated cars").
    packMap: {
      available: radarAvailable,
      label: radarAvailable ? 'PACK' : RC17_NO_RADAR_SOURCE,
      contacts: radarAvailable ? contacts.slice(0, RC17_PACK_MAP_MAX_CONTACTS) : []
    },
    // GAP-1 again: lane usage needs the line channel that does not exist, so the module renders
    // its structure with zero rows rather than inventing a lane history.
    lane: { available: false, label: RC17_NO_LANE_SOURCE, rows: [] },
    line,
    closing,
    flag,
    speed,
    gapAhead,
    position,
    gear,
    rpm,
    revFill,
    water,
    alerts: {
      carAlongside: alerts.carAlongside.active,
      fastClosing: alerts.fastClosing.active,
      threeWide: alerts.threeWide.active
    },
    auxFresh,
    criticalFresh: base.criticalFresh
  }
}

function fastestMeasuredRate(
  rates: Readonly<Partial<Record<Rc17Sector, Rc17ClosingRate>>>
): Rc17ClosingRate | null {
  let best: Rc17ClosingRate | null = null
  for (const sector of RC17_SECTORS) {
    const rate = rates[sector]
    if (!rate) continue
    if (!best || rate.mps > best.mps) best = rate
  }
  return best
}

/** The alert-layer input a rendered frame implies, so the two passes cannot disagree. */
export function rc17AlertInputForModel(
  model: Rc17DashboardModel,
  nowMs: number,
  closingRates: Readonly<Partial<Record<Rc17Sector, Rc17ClosingRate>>> = {}
): Rc17AlertInput {
  const mps: Partial<Record<Rc17Sector, number>> = {}
  for (const sector of RC17_SECTORS) {
    const rate = closingRates[sector]
    if (rate) mps[sector] = rate.mps
  }
  return {
    nowMs,
    occupiedSides: model.spotter.unavailable || model.spotter.stale ? null : model.spotter.sides,
    closingMps: mps,
    radarAvailable: model.radar.available
  }
}

export type { Rc01Field }

