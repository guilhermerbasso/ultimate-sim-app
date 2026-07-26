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
 * RC-05 "Thermal Window" core — the four-corner tyre temperature / pressure mandala.
 *
 * The live-only ingest buffer, identity binding, mock/replay refusal, out-of-order and
 * same-timestamp guards and the shared channel receipts are reused verbatim from the RC-01
 * core: that is telemetry-truth machinery, not RC-01 styling, and a fork would silently
 * drift. This module adds only what RC-05's packet requires and the shared layer does not
 * have: the radial gauge scale, the temperature and pressure window bands, the per-corner
 * hysteresis controller and the three window alerts.
 *
 * RC-01's own alert layer (over-rev, delta cliff, zero cross, pit limiter) is deliberately
 * NOT advanced here. Packet section 16 declares no RPM channel at all, so the section 11.4
 * "optional shift edge cue" has no data source and no rev cue is drawn; inventing an RPM
 * binding to light one would be exactly the fabrication the truth table forbids.
 */

/** Packet section 11.1 native canvas, and the section 12.1 app reflow target. */
export const RC05_NATIVE_WIDTH_PX = 800
export const RC05_NATIVE_HEIGHT_PX = 480
export const RC05_NATIVE_TOLERANCE_PX = 1
export const RC05_APP_WIDTH_PX = 1024
export const RC05_APP_HEIGHT_PX = 600

export const RC05_PHONE_MIN_WIDTH_PX = 360
export const RC05_PHONE_MAX_WIDTH_PX = 480
export const RC05_PHONE_MIN_HEIGHT_PX = 650
export const RC05_LANDSCAPE_MIN_WIDTH_PX = 650
export const RC05_LANDSCAPE_MIN_HEIGHT_PX = 360
export const RC05_LANDSCAPE_MAX_HEIGHT_PX = 480

export const RC05_CORNERS = ['LF', 'RF', 'LR', 'RR'] as const
export type Rc05CornerId = (typeof RC05_CORNERS)[number]

// ─────────────────────────────────────────────────────────── gauge scale

/**
 * Packet section 11.1 / section 13: a 240-degree arc with the gap at the bottom. Angles are
 * measured from twelve o'clock and increase clockwise, so unit 0 sits at the bottom-left
 * end of the arc, unit 50 at the top, and unit 100 at the bottom-right end.
 */
export const RC05_ARC_SWEEP_DEG = 240
export const RC05_ARC_START_DEG = -(RC05_ARC_SWEEP_DEG / 2)

/** Units 0..100 map linearly onto 60..120 degC (image-qa-v1 implementation note 1). */
export const RC05_TEMP_SCALE_MIN_C = 60
export const RC05_TEMP_SCALE_MAX_C = 120
/** Packet section 14: the target window, drawn as a band with bracket ticks at both ends. */
export const RC05_TEMP_WINDOW_MIN_C = 80
export const RC05_TEMP_WINDOW_MAX_C = 100

/** Packet section 13: the inner pressure ring and its target band. */
export const RC05_PRESSURE_SCALE_MIN_BAR = 1.6
export const RC05_PRESSURE_SCALE_MAX_BAR = 2.2
export const RC05_PRESSURE_WINDOW_MIN_BAR = 1.85
export const RC05_PRESSURE_WINDOW_MAX_BAR = 2.0

/** Gauge geometry, expressed in the 0..100 square viewBox each corner draws into. */
export const RC05_GAUGE_VIEWBOX = 100
export const RC05_GAUGE_CENTRE = 50
export const RC05_TEMP_ARC_RADIUS = 41
export const RC05_TEMP_ARC_WIDTH = 7
export const RC05_WINDOW_ARC_WIDTH = 11
export const RC05_TICK_INNER_RADIUS = 34
export const RC05_TICK_OUTER_RADIUS = 47
export const RC05_POINTER_APEX_RADIUS = 34
export const RC05_POINTER_BASE_RADIUS = 46
export const RC05_POINTER_HALF_ANGLE_DEG = 4.5
export const RC05_PRESSURE_ARC_RADIUS = 28
export const RC05_PRESSURE_ARC_WIDTH = 4
export const RC05_PRESSURE_MARK_INNER_RADIUS = 24
export const RC05_PRESSURE_MARK_OUTER_RADIUS = 32

// ─────────────────────────────────────────────────────────── channels

/**
 * Packet section 16 freshness budgets. Tyre and brake temperature are the 200 ms hero
 * channels, TPMS is a 1 s bus, the gear lookup is the fastest feed and speed is 100 ms.
 *
 * The per-lap channels (wear, fuel laps) are values that only CHANGE once a lap but are
 * republished on every frame by the providers that carry them, so their budget is a
 * transport budget: deliberately generous next to the hero channels, but still finite so a
 * silent provider ages the value out instead of freezing it.
 */
export const RC05_CHANNEL_STALE_MS = {
  tyreTempLf: 200,
  tyreTempRf: 200,
  tyreTempLr: 200,
  tyreTempRr: 200,
  tyrePressureLf: 1_000,
  tyrePressureRf: 1_000,
  tyrePressureLr: 1_000,
  tyrePressureRr: 1_000,
  brakeTempLf: 200,
  brakeTempRf: 200,
  brakeTempLr: 200,
  brakeTempRr: 200,
  tcStep: 1_000,
  wear: 2_000,
  gear: 50,
  speed: 100,
  fuelLaps: 2_000,
  slip: 200
} as const

export type Rc05AuxChannel = keyof typeof RC05_CHANNEL_STALE_MS

/**
 * Packet section 16: speed greys as soon as it misses its 100 ms cadence, but only collapses
 * to the three-character dash once the source has been quiet for more than 500 ms.
 */
export const RC05_SPEED_DASH_MS = 500

/** Packet section 12.1: the app-only trend column keeps this many observed laps per corner. */
export const RC05_TREND_LAP_LIMIT = 8

// ─────────────────────────────────────────────────────────── alert thresholds

/** Packet section 15, corner overheat: 2 s engage, 4 s hysteresis back inside the window. */
export const RC05_OVERHEAT_ENGAGE_MS = 2_000
export const RC05_OVERHEAT_HYSTERESIS_MS = 4_000
/** Packet section 15, pressure out-of-window: 3 s engage, clears on return to the band. */
export const RC05_PRESSURE_ENGAGE_MS = 3_000
/** Packet section 15, cold graining: 3 s engage, clears when temp rises into the window. */
export const RC05_COLD_GRAINING_ENGAGE_MS = 3_000

export type Rc05CompactMode = 'phone' | 'landscape' | 'standard'
export type Rc05Emphasis = 'temperature' | 'pressure'
export type Rc05TempBand = 'unknown' | 'cold' | 'window' | 'hot'
export type Rc05PressureBand = 'unknown' | 'low' | 'window' | 'high'

/**
 * Packet section 11.5: a soft-key toggles each corner between temperature and pressure
 * emphasis. A dedicated event name keeps it from colliding with the other RaceCon displays.
 */
export const RC05_EMPHASIS_EVENT = 'racecon:thermal-emphasis'

export function rc05EmphasisFromEvent(detail: unknown): Rc05Emphasis | null {
  if (detail === 'temperature' || detail === 'pressure') return detail
  if (detail && typeof detail === 'object' && 'emphasis' in detail) {
    const value = (detail as { emphasis?: unknown }).emphasis
    if (value === 'temperature' || value === 'pressure') return value
  }
  return null
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

// ─────────────────────────────────────────────────────────── gauge maths

/**
 * image-qa-v1 implementation note 1: the reference drifts — LF and RR both landed on unit
 * 51.5 despite being 2 degC apart. Every angle below is therefore computed arithmetically
 * from the declared scale, so a 1 degC difference always produces the same 1.667-unit
 * difference and corner ordering can never collapse.
 */
export function rc05TempUnit(tempC: number | null): number | null {
  if (!finite(tempC)) return null
  return ((tempC - RC05_TEMP_SCALE_MIN_C) * 100) / (RC05_TEMP_SCALE_MAX_C - RC05_TEMP_SCALE_MIN_C)
}

export function rc05PressureUnit(bar: number | null): number | null {
  if (!finite(bar)) return null
  return (
    ((bar - RC05_PRESSURE_SCALE_MIN_BAR) * 100) /
    (RC05_PRESSURE_SCALE_MAX_BAR - RC05_PRESSURE_SCALE_MIN_BAR)
  )
}

export function rc05ClampUnit(unit: number | null): number | null {
  if (!finite(unit)) return null
  return Math.min(100, Math.max(0, unit))
}

/** image-qa-v1 note 2: the window ends are the configured bounds, never the rendered ~32/~67. */
export const RC05_TEMP_WINDOW_MIN_UNIT = rc05TempUnit(RC05_TEMP_WINDOW_MIN_C) as number
export const RC05_TEMP_WINDOW_MAX_UNIT = rc05TempUnit(RC05_TEMP_WINDOW_MAX_C) as number
export const RC05_PRESSURE_WINDOW_MIN_UNIT = rc05PressureUnit(RC05_PRESSURE_WINDOW_MIN_BAR) as number
export const RC05_PRESSURE_WINDOW_MAX_UNIT = rc05PressureUnit(RC05_PRESSURE_WINDOW_MAX_BAR) as number

export function rc05UnitAngleDeg(unit: number): number {
  const clamped = Math.min(100, Math.max(0, finite(unit) ? unit : 0))
  return RC05_ARC_START_DEG + (clamped * RC05_ARC_SWEEP_DEG) / 100
}

export interface Rc05Point {
  x: number
  y: number
}

export function rc05PolarPoint(radius: number, unit: number, centre = RC05_GAUGE_CENTRE): Rc05Point {
  return rc05PolarPointAtAngle(radius, rc05UnitAngleDeg(unit), centre)
}

function rc05PolarPointAtAngle(radius: number, angleDeg: number, centre = RC05_GAUGE_CENTRE): Rc05Point {
  const radians = (angleDeg * Math.PI) / 180
  return {
    x: round3(centre + radius * Math.sin(radians)),
    y: round3(centre - radius * Math.cos(radians))
  }
}

function round3(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

/** A clockwise SVG arc between two scale units at a fixed radius. */
export function rc05ArcPath(radius: number, startUnit: number, endUnit: number, centre = RC05_GAUGE_CENTRE): string {
  const from = Math.min(100, Math.max(0, startUnit))
  const to = Math.min(100, Math.max(0, endUnit))
  const start = rc05PolarPoint(radius, from, centre)
  const end = rc05PolarPoint(radius, to, centre)
  const largeArc = Math.abs(rc05UnitAngleDeg(to) - rc05UnitAngleDeg(from)) > 180 ? 1 : 0
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`
}

/** A straight radial tick, used for the two window brackets and the pressure marker. */
export function rc05TickPath(innerRadius: number, outerRadius: number, unit: number, centre = RC05_GAUGE_CENTRE): string {
  const inner = rc05PolarPoint(innerRadius, unit, centre)
  const outer = rc05PolarPoint(outerRadius, unit, centre)
  return `M ${inner.x} ${inner.y} L ${outer.x} ${outer.y}`
}

/** The filled triangular temperature pointer, apex pointing in at the computed unit. */
export function rc05PointerPoints(unit: number, centre = RC05_GAUGE_CENTRE): string {
  const angle = rc05UnitAngleDeg(unit)
  const apex = rc05PolarPointAtAngle(RC05_POINTER_APEX_RADIUS, angle, centre)
  const left = rc05PolarPointAtAngle(RC05_POINTER_BASE_RADIUS, angle - RC05_POINTER_HALF_ANGLE_DEG, centre)
  const right = rc05PolarPointAtAngle(RC05_POINTER_BASE_RADIUS, angle + RC05_POINTER_HALF_ANGLE_DEG, centre)
  return `${apex.x},${apex.y} ${left.x},${left.y} ${right.x},${right.y}`
}

export function rc05TempBand(tempC: number | null): Rc05TempBand {
  if (!finite(tempC)) return 'unknown'
  if (tempC < RC05_TEMP_WINDOW_MIN_C) return 'cold'
  if (tempC > RC05_TEMP_WINDOW_MAX_C) return 'hot'
  return 'window'
}

export function rc05PressureBand(bar: number | null): Rc05PressureBand {
  if (!finite(bar)) return 'unknown'
  if (bar < RC05_PRESSURE_WINDOW_MIN_BAR) return 'low'
  if (bar > RC05_PRESSURE_WINDOW_MAX_BAR) return 'high'
  return 'window'
}

// ─────────────────────────────────────────────────────────── layout resolution

export function rc05LayoutForContentBox(width: number, height: number): 'native' | 'app' | 'compact' {
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return 'app'
  if (
    Math.abs(width - RC05_NATIVE_WIDTH_PX) <= RC05_NATIVE_TOLERANCE_PX &&
    Math.abs(height - RC05_NATIVE_HEIGHT_PX) <= RC05_NATIVE_TOLERANCE_PX
  ) {
    return 'native'
  }
  if (width >= RC05_APP_WIDTH_PX - 1 && height >= RC05_APP_HEIGHT_PX - 1) return 'app'
  return 'compact'
}

export function rc05CompactModeForContentBox(width: number, height: number): Rc05CompactMode {
  if (rc05LayoutForContentBox(width, height) !== 'compact') return 'standard'
  if (
    width >= RC05_PHONE_MIN_WIDTH_PX &&
    width <= RC05_PHONE_MAX_WIDTH_PX &&
    height >= RC05_PHONE_MIN_HEIGHT_PX &&
    height / width >= 1.5
  ) {
    return 'phone'
  }
  if (
    width >= RC05_LANDSCAPE_MIN_WIDTH_PX &&
    height >= RC05_LANDSCAPE_MIN_HEIGHT_PX &&
    height <= RC05_LANDSCAPE_MAX_HEIGHT_PX &&
    width / height >= 1.5
  ) {
    return 'landscape'
  }
  return 'standard'
}

export interface Rc05PhoneGeometry {
  inset: number
  mandalaTop: number
  mandalaHeight: number
  deltaTop: number
  deltaHeight: number
  contextTop: number
  contextHeight: number
  legendTop: number
  legendHeight: number
  toggleSize: number
}

/**
 * Portrait geometry. The mandala stays the hero and stays square, so the four corners keep
 * their physical wheel mapping; the delta, the context minis and the legend stack below it.
 * Every value derives from the measured content box so the stack always stays contained.
 */
export function rc05PhoneGeometryForContentBox(width: number, height: number): Rc05PhoneGeometry | null {
  if (rc05CompactModeForContentBox(width, height) !== 'phone') return null
  const inset = 12
  const gap = 10
  const mandalaTop = 14
  const mandalaHeight = Math.min(Math.round(height * 0.46), Math.max(120, width - inset * 2))
  const deltaTop = mandalaTop + mandalaHeight + gap
  const deltaHeight = Math.round(height * 0.12)
  const contextTop = deltaTop + deltaHeight + gap
  const contextHeight = Math.round(height * 0.18)
  const legendTop = contextTop + contextHeight + gap
  const legendHeight = Math.max(48, height - legendTop - inset)
  return {
    inset,
    mandalaTop,
    mandalaHeight,
    deltaTop,
    deltaHeight,
    contextTop,
    contextHeight,
    legendTop,
    legendHeight,
    toggleSize: 44
  }
}

// ─────────────────────────────────────────────────────────── channel extraction

const TYRE_TEMP_CHANNELS: Readonly<Record<Rc05CornerId, Rc05AuxChannel>> = {
  LF: 'tyreTempLf',
  RF: 'tyreTempRf',
  LR: 'tyreTempLr',
  RR: 'tyreTempRr'
}

const TYRE_PRESSURE_CHANNELS: Readonly<Record<Rc05CornerId, Rc05AuxChannel>> = {
  LF: 'tyrePressureLf',
  RF: 'tyrePressureRf',
  LR: 'tyrePressureLr',
  RR: 'tyrePressureRr'
}

const BRAKE_TEMP_CHANNELS: Readonly<Record<Rc05CornerId, Rc05AuxChannel>> = {
  LF: 'brakeTempLf',
  RF: 'brakeTempRf',
  LR: 'brakeTempLr',
  RR: 'brakeTempRr'
}

const KPA_PER_BAR = 100

function tyreCorner(snapshot: TelemetrySnapshot, corner: Rc05CornerId) {
  switch (corner) {
    case 'LF':
      return snapshot.tyres?.lf
    case 'RF':
      return snapshot.tyres?.rf
    case 'LR':
      return snapshot.tyres?.lr
    case 'RR':
      return snapshot.tyres?.rr
  }
}

function brakeCorner(snapshot: TelemetrySnapshot, corner: Rc05CornerId): number | undefined {
  switch (corner) {
    case 'LF':
      return snapshot.brakeTempC?.lf
    case 'RF':
      return snapshot.brakeTempC?.rf
    case 'LR':
      return snapshot.brakeTempC?.lr
    case 'RR':
      return snapshot.brakeTempC?.rr
  }
}

/**
 * Packet section 16: the TC step is an integer switch index. A provider may publish it as a
 * number or as the ASCII index of a rotary position, but anything that is not an integer
 * index is refused rather than coerced into a plausible step.
 */
export function rc05TcStep(value: number | string | undefined): number | null {
  if (finite(value)) return Number.isInteger(value) && value >= 0 ? value : null
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10)
  return null
}

/**
 * Every RC-05 channel is read straight from its own source field. Nothing is modelled,
 * mirrored or substituted, and every accessor returns null rather than a plausible stand-in.
 * In particular a corner's pressure is NEVER derived from its temperature, and no corner is
 * ever filled in from the opposite side.
 */
export function rc05AuxChannelValue(snapshot: TelemetrySnapshot, channel: Rc05AuxChannel): number | null {
  for (const corner of RC05_CORNERS) {
    if (TYRE_TEMP_CHANNELS[corner] === channel) {
      const temp = tyreCorner(snapshot, corner)?.tempC
      return finite(temp) ? temp : null
    }
    if (TYRE_PRESSURE_CHANNELS[corner] === channel) {
      const kpa = tyreCorner(snapshot, corner)?.pressureKpa
      return finite(kpa) && kpa > 0 ? kpa / KPA_PER_BAR : null
    }
    if (BRAKE_TEMP_CHANNELS[corner] === channel) {
      const brake = brakeCorner(snapshot, corner)
      return finite(brake) ? brake : null
    }
  }
  switch (channel) {
    case 'tcStep':
      return rc05TcStep(snapshot.tcLevel)
    // Packet section 16: the wear figure is a MODEL output, legitimate only when the model is
    // calibrated for the whole car. A partial corner set would misstate the car, so the
    // channel exists only when all four corners publish a wear fraction.
    case 'wear': {
      const wears = RC05_CORNERS.map((corner) => tyreCorner(snapshot, corner)?.wearPct)
      if (!wears.every((value) => finite(value) && value >= 0 && value <= 1)) return null
      return Math.max(...(wears as number[]))
    }
    case 'gear':
      return finite(snapshot.gear) && Number.isInteger(snapshot.gear) ? snapshot.gear : null
    case 'speed':
      return finite(snapshot.speedKmh) && snapshot.speedKmh >= 0 ? snapshot.speedKmh : null
    // Packet section 16: never project laps before a measured burn rate exists. The observed
    // per-lap consumption is the gate, not the projection itself.
    case 'fuelLaps':
      return finite(snapshot.fuelPerLapLiters) &&
        snapshot.fuelPerLapLiters > 0 &&
        finite(snapshot.fuelLapsRemaining) &&
        snapshot.fuelLapsRemaining >= 0
        ? snapshot.fuelLapsRemaining
        : null
    // The cold-graining trigger needs a real slip signal. `tcActive` is the app's own
    // traction-loss channel; without it the alert simply cannot arm.
    case 'slip':
      return typeof snapshot.tcActive === 'boolean' ? (snapshot.tcActive ? 1 : 0) : null
  }
  return null
}

/**
 * Receipts for RC-05's own channels, with exactly RC-01's semantics: a receipt is written
 * only when the channel actually reports, so a channel that falls silent ages out and
 * degrades to its dash state instead of freezing on its last value.
 *
 * This is deliberately NOT a second ingest buffer. It is only ever fed frames the shared
 * RC-01 buffer has already accepted, so identity binding and mock/replay refusal stay in
 * one place.
 */
export class Rc05AuxBuffer {
  private channelReceipts = new Map<Rc05AuxChannel, Rc01ChannelReceipt>()

  clone(): Rc05AuxBuffer {
    const next = new Rc05AuxBuffer()
    next.channelReceipts = new Map(this.channelReceipts)
    return next
  }

  reset(): void {
    this.channelReceipts = new Map()
  }

  ingest(snapshot: TelemetrySnapshot | null | undefined, receivedAt = rc01MonotonicNow()): void {
    if (!snapshot || !snapshot.connected || !finite(snapshot.timestamp)) return
    const safeReceiptAt = finite(receivedAt) && receivedAt >= 0 ? receivedAt : rc01MonotonicNow()
    for (const channel of Object.keys(RC05_CHANNEL_STALE_MS) as Rc05AuxChannel[]) {
      const value = rc05AuxChannelValue(snapshot, channel)
      if (value === null) continue
      this.channelReceipts.set(
        channel,
        Object.freeze({ value, snapshotTimestamp: snapshot.timestamp, receivedAt: safeReceiptAt })
      )
    }
  }

  receipts(): ReadonlyMap<Rc05AuxChannel, Rc01ChannelReceipt> {
    return new Map(this.channelReceipts)
  }
}

export function createRc05AuxReceipts(
  snapshot: TelemetrySnapshot,
  receivedAt = rc01MonotonicNow()
): ReadonlyMap<Rc05AuxChannel, Rc01ChannelReceipt> {
  const buffer = new Rc05AuxBuffer()
  buffer.ingest(snapshot, receivedAt)
  return buffer.receipts()
}

interface Rc05Reading {
  value: number | null
  /** The last accepted value, used only where the packet sanctions a last-known display. */
  lastKnown: number | null
  stale: boolean
  ageMs: number
}

function auxReading(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc05AuxChannel, Rc01ChannelReceipt>,
  channel: Rc05AuxChannel,
  nowMs: number
): Rc05Reading {
  const raw = snapshot ? rc05AuxChannelValue(snapshot, channel) : null
  const receipt = receipts.get(channel)
  if (raw === null || !receipt) return { value: null, lastKnown: null, stale: false, ageMs: Number.POSITIVE_INFINITY }
  const ageMs = rc01ReceiptAgeMs(receipt, nowMs)
  const stale = ageMs > RC05_CHANNEL_STALE_MS[channel]
  return {
    value: stale ? null : raw,
    lastKnown: typeof receipt.value === 'number' ? receipt.value : null,
    stale,
    ageMs
  }
}

// ─────────────────────────────────────────────────────────── per-corner alerts

export interface Rc05CornerAlertState {
  overheat: { active: boolean; pendingSinceMs: number | null; recoverySinceMs: number | null }
  pressure: {
    active: boolean
    side: 'low' | 'high' | null
    pendingSinceMs: number | null
    pendingSide: 'low' | 'high' | null
  }
  coldGraining: { active: boolean; pendingSinceMs: number | null }
}

export type Rc05AlertState = Readonly<Record<Rc05CornerId, Rc05CornerAlertState>>

export interface Rc05CornerAlertInput {
  tempC: number | null
  pressureBar: number | null
  /** null whenever the traction-loss channel is missing, which disarms cold graining. */
  slipHigh: boolean | null
}

export interface Rc05AlertInput {
  nowMs: number
  corners: Readonly<Record<Rc05CornerId, Rc05CornerAlertInput>>
}

function createRc05CornerAlertState(): Rc05CornerAlertState {
  return {
    overheat: { active: false, pendingSinceMs: null, recoverySinceMs: null },
    pressure: { active: false, side: null, pendingSinceMs: null, pendingSide: null },
    coldGraining: { active: false, pendingSinceMs: null }
  }
}

export function createRc05AlertState(): Rc05AlertState {
  return {
    LF: createRc05CornerAlertState(),
    RF: createRc05CornerAlertState(),
    LR: createRc05CornerAlertState(),
    RR: createRc05CornerAlertState()
  }
}

function cloneCorner(state: Rc05CornerAlertState): Rc05CornerAlertState {
  return {
    overheat: { ...state.overheat },
    pressure: { ...state.pressure },
    coldGraining: { ...state.coldGraining }
  }
}

export function cloneRc05AlertState(state: Rc05AlertState): Rc05AlertState {
  return {
    LF: cloneCorner(state.LF),
    RF: cloneCorner(state.RF),
    LR: cloneCorner(state.LR),
    RR: cloneCorner(state.RR)
  }
}

function advanceCorner(
  state: Rc05CornerAlertState,
  input: Rc05CornerAlertInput,
  nowMs: number
): Rc05CornerAlertState {
  const next = cloneCorner(state)

  // ── Corner overheat: 2 s above the hot edge, 4 s back inside the window to clear.
  if (input.tempC === null) {
    next.overheat = { active: false, pendingSinceMs: null, recoverySinceMs: null }
  } else if (next.overheat.active) {
    const backInWindow = rc05TempBand(input.tempC) === 'window'
    if (backInWindow) {
      const recoverySinceMs = next.overheat.recoverySinceMs ?? nowMs
      next.overheat.recoverySinceMs = recoverySinceMs
      if (nowMs - recoverySinceMs >= RC05_OVERHEAT_HYSTERESIS_MS) {
        next.overheat = { active: false, pendingSinceMs: null, recoverySinceMs: null }
      }
    } else {
      next.overheat.recoverySinceMs = null
    }
  } else if (input.tempC > RC05_TEMP_WINDOW_MAX_C) {
    const pendingSinceMs = next.overheat.pendingSinceMs ?? nowMs
    if (nowMs - pendingSinceMs >= RC05_OVERHEAT_ENGAGE_MS) {
      next.overheat = { active: true, pendingSinceMs: null, recoverySinceMs: null }
    } else {
      next.overheat.pendingSinceMs = pendingSinceMs
    }
  } else {
    next.overheat.pendingSinceMs = null
  }

  // ── Pressure out-of-window: 3 s engage on the offending side, clears on return to the band.
  if (input.pressureBar === null) {
    next.pressure = { active: false, side: null, pendingSinceMs: null, pendingSide: null }
  } else {
    const band = rc05PressureBand(input.pressureBar)
    const side = band === 'low' ? 'low' : band === 'high' ? 'high' : null
    if (next.pressure.active) {
      if (side === null) {
        next.pressure = { active: false, side: null, pendingSinceMs: null, pendingSide: null }
      } else {
        next.pressure.side = side
      }
    } else if (side === null) {
      next.pressure.pendingSinceMs = null
      next.pressure.pendingSide = null
    } else {
      const pendingSinceMs = next.pressure.pendingSide === side ? (next.pressure.pendingSinceMs ?? nowMs) : nowMs
      if (nowMs - pendingSinceMs >= RC05_PRESSURE_ENGAGE_MS) {
        next.pressure = { active: true, side, pendingSinceMs: null, pendingSide: null }
      } else {
        next.pressure.pendingSinceMs = pendingSinceMs
        next.pressure.pendingSide = side
      }
    }
  }

  // ── Cold graining: 3 s below the cold edge WITH a real high-slip signal.
  if (input.tempC === null || input.slipHigh === null) {
    next.coldGraining = { active: false, pendingSinceMs: null }
  } else if (next.coldGraining.active) {
    if (input.tempC >= RC05_TEMP_WINDOW_MIN_C) next.coldGraining = { active: false, pendingSinceMs: null }
  } else if (input.tempC < RC05_TEMP_WINDOW_MIN_C && input.slipHigh) {
    const pendingSinceMs = next.coldGraining.pendingSinceMs ?? nowMs
    if (nowMs - pendingSinceMs >= RC05_COLD_GRAINING_ENGAGE_MS) {
      next.coldGraining = { active: true, pendingSinceMs: null }
    } else {
      next.coldGraining.pendingSinceMs = pendingSinceMs
    }
  } else {
    next.coldGraining.pendingSinceMs = null
  }

  return next
}

/**
 * Every alert is silent until its own trigger fires, carries the packet's debounce and
 * hysteresis, has an explicit clear condition, and is unlatched the moment its input goes
 * missing or stale. Each corner is advanced independently: a hot LF can never light RF.
 */
export function advanceRc05Alerts(state: Rc05AlertState, input: Rc05AlertInput): Rc05AlertState {
  const nowMs = finite(input.nowMs) ? input.nowMs : 0
  return {
    LF: advanceCorner(state.LF, input.corners.LF, nowMs),
    RF: advanceCorner(state.RF, input.corners.RF, nowMs),
    LR: advanceCorner(state.LR, input.corners.LR, nowMs),
    RR: advanceCorner(state.RR, input.corners.RR, nowMs)
  }
}

// ─────────────────────────────────────────────────────────── trend history

export interface Rc05TrendSample {
  lap: number
  temps: Readonly<Record<Rc05CornerId, number | null>>
}

/**
 * Packet section 12.1: the app-only trend column shows per-corner temperature over recent
 * laps. There is no per-lap tyre-history channel in this app, so the history is MEASURED:
 * a sample is written only when a lap boundary is actually observed on a mounted session,
 * and only for the corners whose temperature was fresh at that instant.
 *
 * The first observed lap number is recorded WITHOUT emitting a sample, exactly as RC-02
 * refuses a sector whose opening crossing it did not see: otherwise a mid-lap mount writes
 * a truncated fragment into the history and it never leaves the column.
 */
export class Rc05TrendRecorder {
  private lastLap: number | null = null
  private samples: Rc05TrendSample[] = []

  clone(): Rc05TrendRecorder {
    const next = new Rc05TrendRecorder()
    next.lastLap = this.lastLap
    next.samples = this.samples.slice()
    return next
  }

  reset(): void {
    this.lastLap = null
    this.samples = []
  }

  observe(lap: number | null, temps: Readonly<Record<Rc05CornerId, number | null>>): void {
    if (!finite(lap) || !Number.isInteger(lap) || lap < 0) return
    if (this.lastLap === null) {
      this.lastLap = lap
      return
    }
    if (lap <= this.lastLap) {
      // A lap counter that goes backwards means a new session or a reset; drop the history
      // rather than stitching two stints into one trend.
      if (lap < this.lastLap) {
        this.samples = []
      }
      this.lastLap = lap
      return
    }
    this.lastLap = lap
    this.samples.push({
      lap,
      temps: Object.freeze({ LF: temps.LF, RF: temps.RF, LR: temps.LR, RR: temps.RR })
    })
    if (this.samples.length > RC05_TREND_LAP_LIMIT) {
      this.samples = this.samples.slice(this.samples.length - RC05_TREND_LAP_LIMIT)
    }
  }

  history(): readonly Rc05TrendSample[] {
    return this.samples.slice()
  }
}

/** Per-corner trend series, always the same length, with nulls where nothing was measured. */
export interface Rc05TrendSeries {
  corner: Rc05CornerId
  points: readonly (number | null)[]
  /** True only once at least one real measurement exists for this corner. */
  measured: boolean
}

export function rc05TrendSeries(history: readonly Rc05TrendSample[]): readonly Rc05TrendSeries[] {
  return RC05_CORNERS.map((corner) => {
    const points = history.map((sample) => sample.temps[corner])
    return { corner, points, measured: points.some((value) => value !== null) }
  })
}

// ─────────────────────────────────────────────────────────── dashboard model

export interface Rc05Corner {
  corner: Rc05CornerId
  temp: Rc01Field
  tempC: number | null
  tempUnit: number | null
  tempBand: Rc05TempBand
  pressure: Rc01Field
  pressureBar: number | null
  pressureUnit: number | null
  pressureBand: Rc05PressureBand
  /** Trigger-only: true only while the debounced alert is latched for THIS corner. */
  overheat: boolean
  coldGraining: boolean
  pressureAlert: 'none' | 'low' | 'high'
  /** Packet 11.5 zoom-on-change: only a corner that left its window is enlarged. */
  zoom: boolean
}

export interface Rc05Axle {
  axle: 'F' | 'R'
  value: Rc01Field
}

export interface Rc05DashboardModel {
  corners: readonly Rc05Corner[]
  delta: Rc01Field
  tc: Rc01Field
  brakes: readonly Rc05Axle[]
  wear: Rc01Field
  /** Packet section 16: the wear module is hidden outright when the model is uncalibrated. */
  wearAvailable: boolean
  gear: Rc01Field
  speed: Rc01Field
  fuelLaps: Rc01Field
  emphasis: Rc05Emphasis
  /**
   * The cold-graining trigger's slip input. `null` whenever the traction-loss channel is
   * absent or stale, which disarms the alert instead of reading "no slip".
   */
  slipHigh: boolean | null
  trend: readonly Rc05TrendSeries[]
  /** True once at least one lap boundary has actually been observed on this session. */
  trendMeasured: boolean
  criticalFresh: Readonly<Record<Rc01ChannelName, boolean>>
  auxFresh: Readonly<Record<Rc05AuxChannel, boolean>>
}

export interface Rc05ModelOptions {
  alerts?: Rc05AlertState
  emphasis?: Rc05Emphasis
  trend?: readonly Rc05TrendSample[]
}

const AXLE_CORNERS: Readonly<Record<'F' | 'R', readonly [Rc05CornerId, Rc05CornerId]>> = {
  F: ['LF', 'RF'],
  R: ['LR', 'RR']
}

/**
 * Projects the shared RC-01 telemetry model into RC-05's presentation and adds the thermal
 * channels. Nothing is invented, estimated or mirrored: each corner reads only its own
 * sensor, a pressure is never derived from a temperature, and every unavailable channel
 * renders its packet dash state rather than a plausible number.
 */
export function createRc05DashboardModel(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc01ChannelName, Rc01ChannelReceipt> = new Map(),
  auxReceipts: ReadonlyMap<Rc05AuxChannel, Rc01ChannelReceipt> = new Map(),
  nowMs = rc01MonotonicNow(),
  options: Rc05ModelOptions = {}
): Rc05DashboardModel {
  const base: Rc01DashboardModel = createRc01DashboardModel(snapshot, receipts, nowMs)
  const safeSnapshot = snapshot && snapshot.connected ? snapshot : null
  const alerts = options.alerts ?? createRc05AlertState()
  const emphasis = options.emphasis ?? 'temperature'
  const trendHistory = options.trend ?? []

  const auxFresh = Object.fromEntries(
    (Object.keys(RC05_CHANNEL_STALE_MS) as Rc05AuxChannel[]).map((channel) => [
      channel,
      auxReading(safeSnapshot, auxReceipts, channel, nowMs).value !== null
    ])
  ) as Record<Rc05AuxChannel, boolean>

  // ── Four independent corners. A missing sensor dashes that corner and nothing else.
  const corners: Rc05Corner[] = RC05_CORNERS.map((corner) => {
    const tempReading = auxReading(safeSnapshot, auxReceipts, TYRE_TEMP_CHANNELS[corner], nowMs)
    const pressureReading = auxReading(safeSnapshot, auxReceipts, TYRE_PRESSURE_CHANNELS[corner], nowMs)
    const cornerAlerts = alerts[corner]

    const tempC = tempReading.value
    const temp =
      tempC === null
        ? field('--', null, tempReading.stale, true, 'muted')
        : field(String(Math.round(tempC)), tempC, false, false, 'primary')

    const pressureBar = pressureReading.value
    const pressure =
      pressureBar === null
        ? field('--', null, pressureReading.stale, true, 'muted')
        : field(pressureBar.toFixed(2), pressureBar, false, false, 'primary')

    return {
      corner,
      temp,
      tempC,
      tempUnit: rc05ClampUnit(rc05TempUnit(tempC)),
      tempBand: rc05TempBand(tempC),
      pressure,
      pressureBar,
      pressureUnit: rc05ClampUnit(rc05PressureUnit(pressureBar)),
      pressureBand: rc05PressureBand(pressureBar),
      overheat: cornerAlerts.overheat.active,
      coldGraining: cornerAlerts.coldGraining.active,
      pressureAlert: cornerAlerts.pressure.active ? (cornerAlerts.pressure.side ?? 'none') : 'none',
      zoom: cornerAlerts.overheat.active || cornerAlerts.coldGraining.active
    }
  })

  // ── Delta to best: RC-01 already refuses a delta without a stored best lap; RC-05 only
  //    re-formats it so the unit can sit in its own label, exactly as the packet types it.
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

  // ── TC step: packet section 16 keeps the LAST KNOWN step greyed and flagged when the bus
  //    goes quiet, because a default step would be a fabricated switch position.
  const tcReading = auxReading(safeSnapshot, auxReceipts, 'tcStep', nowMs)
  const tcShown = tcReading.value ?? (tcReading.stale ? tcReading.lastKnown : null)
  const tc =
    tcShown === null
      ? field('--', null, tcReading.stale, true, 'muted')
      : field(String(Math.trunc(tcShown)), tcShown, tcReading.stale, false, tcReading.stale ? 'muted' : 'primary')

  // ── Brake temperature per axle. The axle figure is the hotter of its two MEASURED corners
  //    and exists only when both corner sensors report: half an axle is not an axle, and
  //    packet section 16 forbids estimating the missing side.
  const brakes: Rc05Axle[] = (['F', 'R'] as const).map((axle) => {
    const readings = AXLE_CORNERS[axle].map((corner) =>
      auxReading(safeSnapshot, auxReceipts, BRAKE_TEMP_CHANNELS[corner], nowMs)
    )
    const stale = readings.some((reading) => reading.stale)
    const values = readings.map((reading) => reading.value)
    if (values.some((value) => value === null)) {
      return { axle, value: field('--', null, stale, true, 'muted') }
    }
    const hottest = Math.max(...(values as number[]))
    return { axle, value: field(String(Math.round(hottest)), hottest, false, false, 'primary') }
  })

  // ── Wear estimate: a model output, so it is labelled EST by the view and hidden outright
  //    when the model is uncalibrated (i.e. when any corner does not publish a wear fraction).
  const wearReading = auxReading(safeSnapshot, auxReceipts, 'wear', nowMs)
  const wearAvailable = wearReading.value !== null
  const wear = wearAvailable
    ? field(String(Math.round((wearReading.value as number) * 100)), wearReading.value, false, false, 'primary')
    : field('--', null, wearReading.stale, true, 'muted')

  // ── Gear: the ECU gear channel, never derived from RPM or speed.
  const gearReading = auxReading(safeSnapshot, auxReceipts, 'gear', nowMs)
  const gear =
    gearReading.value === null
      ? field('-', null, gearReading.stale, true, 'muted')
      : field(rc05DisplayGear(gearReading.value), gearReading.value, false, false, 'primary')

  // ── Speed: greys past its 100 ms cadence and collapses to '---' past 500 ms.
  const speedReading = auxReading(safeSnapshot, auxReceipts, 'speed', nowMs)
  const speedDashed = speedReading.value === null && speedReading.ageMs > RC05_SPEED_DASH_MS
  const speed =
    speedReading.value !== null
      ? field(String(Math.round(speedReading.value)), speedReading.value, false, false, 'primary')
      : !speedDashed && speedReading.lastKnown !== null
        ? field(String(Math.round(speedReading.lastKnown)), speedReading.lastKnown, true, false, 'muted')
        : field('---', null, speedReading.stale, true, 'muted')

  const fuelReading = auxReading(safeSnapshot, auxReceipts, 'fuelLaps', nowMs)
  const fuelLaps =
    fuelReading.value === null
      ? field('--', null, fuelReading.stale, true, 'muted')
      : field(fuelReading.value.toFixed(1), fuelReading.value, false, false, 'primary')

  const slipReading = auxReading(safeSnapshot, auxReceipts, 'slip', nowMs)

  return {
    corners,
    delta,
    tc,
    brakes,
    wear,
    wearAvailable,
    gear,
    speed,
    fuelLaps,
    emphasis,
    slipHigh: slipReading.value === null ? null : slipReading.value === 1,
    trend: rc05TrendSeries(trendHistory),
    trendMeasured: trendHistory.length > 0,
    criticalFresh: base.criticalFresh,
    auxFresh
  }
}

/** Packet section 16: 'N' or the grey '-'; a gear is never blanked silently. */
export function rc05DisplayGear(gear: number | null): string {
  if (gear === null || !finite(gear)) return '-'
  if (gear < 0) return 'R'
  if (gear === 0) return 'N'
  return String(Math.trunc(gear))
}

/** The alert-layer inputs, all gated on freshness so a frozen frame can never engage anything. */
export function rc05AlertInputForModel(model: Rc05DashboardModel, nowMs: number): Rc05AlertInput {
  const corners = Object.fromEntries(
    model.corners.map((corner) => [
      corner.corner,
      {
        tempC: corner.temp.unavailable || corner.temp.stale ? null : corner.tempC,
        pressureBar: corner.pressure.unavailable || corner.pressure.stale ? null : corner.pressureBar,
        slipHigh: model.slipHigh
      } satisfies Rc05CornerAlertInput
    ])
  ) as Record<Rc05CornerId, Rc05CornerAlertInput>
  return { nowMs, corners }
}

/** A stale or unavailable input can never leave an alert latched on. */
export function clearInvalidRc05Alerts(state: Rc05AlertState, model: Rc05DashboardModel): Rc05AlertState {
  const next = cloneRc05AlertState(state)
  for (const corner of model.corners) {
    const cornerState = next[corner.corner]
    if (corner.temp.unavailable || corner.temp.stale) {
      cornerState.overheat = { active: false, pendingSinceMs: null, recoverySinceMs: null }
      cornerState.coldGraining = { active: false, pendingSinceMs: null }
    }
    if (model.slipHigh === null) {
      cornerState.coldGraining = { active: false, pendingSinceMs: null }
    }
    if (corner.pressure.unavailable || corner.pressure.stale) {
      cornerState.pressure = { active: false, side: null, pendingSinceMs: null, pendingSide: null }
    }
  }
  return next
}

/** The alert lines a surface renders; empty in a silent frame, which is the reference state. */
export function rc05AlertLines(model: Rc05DashboardModel): readonly string[] {
  const lines: string[] = []
  for (const corner of model.corners) {
    if (corner.overheat) lines.push(`${corner.corner} OVERHEAT`)
    if (corner.coldGraining) lines.push(`${corner.corner} COLD`)
    if (corner.pressureAlert !== 'none') {
      lines.push(`${corner.corner} PRESS ${corner.pressureAlert === 'low' ? 'LOW' : 'HIGH'}`)
    }
  }
  return lines
}

export function rc05CornerDescription(corner: Rc05Corner): string {
  const temp = corner.temp.unavailable
    ? 'temperature unavailable'
    : `${corner.temp.value} degrees${corner.temp.stale ? ' stale' : ''}`
  const pressure = corner.pressure.unavailable
    ? 'pressure unavailable'
    : `${corner.pressure.value} bar${corner.pressure.stale ? ' stale' : ''}`
  const band =
    corner.tempBand === 'unknown'
      ? 'window unknown'
      : corner.tempBand === 'window'
        ? 'inside the window'
        : corner.tempBand === 'hot'
          ? 'above the window'
          : 'below the window'
  return `${corner.corner} tyre ${temp}, ${pressure}, ${band}`
}

export type { Rc01Field as Rc05Field }
