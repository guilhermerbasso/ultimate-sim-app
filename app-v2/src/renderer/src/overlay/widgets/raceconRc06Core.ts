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
 * RC-06 "Save Mode — Fuel & Lift-and-Coast Strategy" core.
 *
 * The live-only ingest buffer, identity binding, mock/replay refusal, out-of-order and
 * same-timestamp guards and the shared channel receipts are reused verbatim from the RC-01
 * core: that is telemetry-truth machinery, not RC-01 styling, and a fork would silently
 * drift. This module adds only what RC-06's packet needs and the shared layer does not have:
 * the ledger's plan-input class, the signed balance, the lift-and-coast track, the per-lap
 * accounting ledger with its refuel reset, and the three budget-deviation alerts.
 *
 * Two hard boundaries, both from packet section 16:
 *
 *  - Section 16 declares **no RPM channel**, so the packet 11.4 slim rev cue / short-shift
 *    marker has no data source and is not drawn anywhere. Lighting it would mean putting a
 *    value on screen with no source, unit or staleness rule.
 *  - Section 16 declares **no lap-distance channel**, so the packet 11.5 distance-to-plan
 *    soft-key mode cannot be derived. The `LIFT PT` field renders the two-character dash
 *    forever; the app's own `lapDistanceM` is deliberately NOT bound, because the packet
 *    truth table is the contract and it does not sanction that source.
 *
 * The left ledger column is a third source class: `target L/lap`, `plan laps` and `pit lap`
 * are engineer-set **strategy plan inputs**, not telemetry. They are dashed until a plan is
 * loaded and are never inferred from the car.
 */

/** Packet section 11.1 native canvas, and the section 12.1 app reflow target. */
export const RC06_NATIVE_WIDTH_PX = 800
export const RC06_NATIVE_HEIGHT_PX = 480
export const RC06_NATIVE_TOLERANCE_PX = 1
export const RC06_APP_WIDTH_PX = 1024
export const RC06_APP_HEIGHT_PX = 600

export const RC06_PHONE_MIN_WIDTH_PX = 360
export const RC06_PHONE_MAX_WIDTH_PX = 480
export const RC06_PHONE_MIN_HEIGHT_PX = 650
export const RC06_LANDSCAPE_MIN_WIDTH_PX = 650
export const RC06_LANDSCAPE_MIN_HEIGHT_PX = 360
export const RC06_LANDSCAPE_MAX_HEIGHT_PX = 480

export type Rc06CompactMode = 'phone' | 'landscape' | 'standard'
export type Rc06Layout = 'native' | 'app' | 'compact'

// ─────────────────────────────────────────────────────────── channels

/**
 * Packet section 16 freshness budgets, verbatim: gear 50 ms, speed 100 ms, fuel level and
 * water temperature 500 ms, position 1 s.
 *
 * The two per-lap fuel channels only CHANGE once a lap but are republished on every frame by
 * the providers that carry them, so their budget is a transport budget: deliberately generous
 * next to the hero channels, but still finite so a silent provider ages the value out into
 * its dash state instead of freezing it. The lap counter shares that transport budget.
 */
export const RC06_CHANNEL_STALE_MS = {
  burnRate: 2_000,
  lapsRemaining: 2_000,
  fuelLevel: 500,
  currentLap: 2_000,
  gear: 50,
  speed: 100,
  waterTemp: 500,
  position: 1_000
} as const

export type Rc06AuxChannel = keyof typeof RC06_CHANNEL_STALE_MS

/**
 * Packet section 16: speed greys as soon as it misses its 100 ms cadence, but only collapses
 * to the three-character dash once the source has been quiet for more than 500 ms.
 */
export const RC06_SPEED_DASH_MS = 500

// ─────────────────────────────────────────────────────────── ledger arithmetic

/**
 * Packet 11.5 / section 20: the balance is an accounting figure with multi-lap hysteresis, so
 * it needs a tolerance band rather than a bare sign test. A quarter of a lap of margin is the
 * smallest deviation an endurance fuel plan acts on.
 */
export const RC06_BALANCE_TOLERANCE_LAPS = 0.25

/** Packet section 15: over-saving fires only once the projected surplus exceeds a full lap. */
export const RC06_OVER_SAVE_LAPS = 1

/** Packet section 15: "behind fuel plan" clears after two consecutive in-tolerance laps. */
export const RC06_BEHIND_PLAN_CLEAR_LAPS = 2

/** Packet section 15: the fuel-model-invalid note engages after two seconds of no valid model. */
export const RC06_FUEL_MODEL_ENGAGE_MS = 2_000

/**
 * The lift track is a +/- 0.20 L/lap saving scale (image-qa-v1, "lift track marker" line).
 * Full deflection is one END of the track, so the whole track spans 0.40 L/lap.
 */
export const RC06_LIFT_FULL_DEFLECTION_L = 0.2

/**
 * image-qa-v1 residual 1 is a normative override: the reference render puts the plan datum at
 * unit 40, which inflates the proportional reading. The product places the datum at exactly
 * the middle of the track and computes the marker arithmetically. These pixels are never traced.
 */
export const RC06_LIFT_PLAN_FRACTION = 0.5

/** A measured refuel: the tank gained more than this between two accepted frames. */
export const RC06_REFUEL_RISE_L = 0.5

/** Packet 12.1: the app-only burn-trend chart keeps this many observed laps. */
export const RC06_TREND_LAP_LIMIT = 10

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

function signed(value: number, digits: number): string {
  return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(digits)}`
}

// ─────────────────────────────────────────────────────────── strategy plan inputs

/**
 * Packet 11.1 gives the left column `target fuel/lap`, `target laps` and `planned pit lap`.
 * None of them is telemetry: they are engineer-set plan constants, and packet section 16 has
 * no channel for any of them. They therefore arrive as an explicit plan object and dash until
 * one is loaded. Nothing here is ever inferred from the car.
 */
export interface Rc06Plan {
  targetBurnLPerLap: number | null
  pitLap: number | null
}

export const RC06_EMPTY_PLAN: Rc06Plan = Object.freeze({ targetBurnLPerLap: null, pitLap: null })

/** Packet 11.5: a soft-key switches the lift cue between litres-to-plan and distance-to-plan. */
export const RC06_LIFT_MODE_EVENT = 'racecon:save-mode-lift'
/** The engineer's plan is pushed in on its own event so it can change mid-stint. */
export const RC06_PLAN_EVENT = 'racecon:save-mode-plan'

export type Rc06LiftMode = 'liters' | 'distance'

export function rc06LiftModeFromEvent(detail: unknown): Rc06LiftMode | null {
  if (detail === 'liters' || detail === 'distance') return detail
  if (detail && typeof detail === 'object' && 'mode' in detail) {
    const value = (detail as { mode?: unknown }).mode
    if (value === 'liters' || value === 'distance') return value
  }
  return null
}

/**
 * A plan payload is accepted only when it is structurally a plan. An unrecognised payload
 * returns null and never mutates the loaded plan; an explicit null field clears that input,
 * which is how "no plan loaded" is expressed rather than by inventing a nominal target.
 */
export function rc06PlanFromEvent(detail: unknown): Rc06Plan | null {
  if (!detail || typeof detail !== 'object') return null
  const record = detail as { targetBurnLPerLap?: unknown; pitLap?: unknown }
  if (!('targetBurnLPerLap' in record) && !('pitLap' in record)) return null
  const target = record.targetBurnLPerLap
  const pitLap = record.pitLap
  const targetOk = target === null || target === undefined || (finite(target) && target > 0)
  const pitLapOk =
    pitLap === null || pitLap === undefined || (finite(pitLap) && Number.isInteger(pitLap) && pitLap > 0)
  if (!targetOk || !pitLapOk) return null
  return {
    targetBurnLPerLap: finite(target) && target > 0 ? target : null,
    pitLap: finite(pitLap) && Number.isInteger(pitLap) && pitLap > 0 ? pitLap : null
  }
}

export function rc06PlanLoaded(plan: Rc06Plan): boolean {
  return plan.targetBurnLPerLap !== null || plan.pitLap !== null
}

/**
 * Plan laps are the laps still to run to the planned pit lap. They need BOTH an engineer pit
 * lap and a live lap counter; either one missing dashes the row rather than guessing a stint
 * length. A pit lap already behind the car yields zero, never a negative countdown.
 */
export function rc06PlanLaps(pitLap: number | null, currentLap: number | null): number | null {
  if (!finite(pitLap) || !finite(currentLap)) return null
  return Math.max(0, Math.trunc(pitLap) - Math.trunc(currentLap))
}

/**
 * The signed running balance: measured laps of fuel in the tank minus the plan laps still to
 * run. Both inputs must be real, so no measured burn rate and no plan means no balance.
 */
export function rc06Balance(lapsRemaining: number | null, planLaps: number | null): number | null {
  if (!finite(lapsRemaining) || !finite(planLaps)) return null
  return lapsRemaining - planLaps
}

/**
 * Packet 12.1's projected pit ladder: the lap the tank actually runs dry on, which is only
 * meaningful once a burn rate has been measured AND a live lap counter exists. It is a
 * projection bound to two real channels, never a nominal stint length.
 */
export function rc06ProjectedDryLap(currentLap: number | null, lapsRemaining: number | null): number | null {
  if (!finite(currentLap) || !finite(lapsRemaining)) return null
  return Math.trunc(currentLap) + Math.floor(lapsRemaining)
}

/**
 * image-qa-v1 residual 1: the plan datum sits at exactly the middle of the track and the
 * marker at `0.5 + (target - actual) / (2 * fullDeflection)`, clamped onto the track. A
 * positive saving (burning less than target) moves the marker to the ahead-of-plan side.
 */
export function rc06LiftMarkerFraction(
  targetBurn: number | null,
  actualBurn: number | null,
  fullDeflection = RC06_LIFT_FULL_DEFLECTION_L
): number | null {
  if (!finite(targetBurn) || !finite(actualBurn) || !finite(fullDeflection) || fullDeflection <= 0) return null
  const raw = RC06_LIFT_PLAN_FRACTION + (targetBurn - actualBurn) / (2 * fullDeflection)
  return Math.min(1, Math.max(0, raw))
}

// ─────────────────────────────────────────────────────────── zone geometry

export interface Rc06Rect {
  left: number
  top: number
  width: number
  height: number
}

export type Rc06ZoneId = 'peripheral' | 'target' | 'balance' | 'delta' | 'actual' | 'trend' | 'lift'

export type Rc06ZoneMap = Readonly<Partial<Record<Rc06ZoneId, Rc06Rect>>>

/**
 * Packet 11.1, verbatim percentages. image-qa-v1 residual 2 is a normative override: the
 * reference render drifts down by up to 7.7 pp, so these are the packet coordinates and NOT
 * the rendered pixels.
 *
 * The peripheral strip is not a packet zone. Packet section 10 lists speed, water temperature
 * and position as tertiary and packet 11.1 allocates them no zone at all, so they live in the
 * band above the ledger that the packet leaves unallocated, carrying their truth-table dash
 * states instead of being dropped.
 */
export const RC06_NATIVE_ZONES: Readonly<Record<Exclude<Rc06ZoneId, 'trend'>, Rc06Rect>> = Object.freeze({
  peripheral: { left: 2.0, top: 0.8, width: 96.0, height: 6.5 },
  target: { left: 2.0, top: 8.3, width: 30.0, height: 62.5 },
  balance: { left: 33.5, top: 12.5, width: 33.0, height: 37.5 },
  delta: { left: 33.5, top: 52.1, width: 33.0, height: 18.8 },
  actual: { left: 68.0, top: 8.3, width: 30.0, height: 62.5 },
  lift: { left: 2.0, top: 73.3, width: 96.0, height: 12.5 }
})

/**
 * Packet 12.1 `ledger-trend-reveal`, verbatim percentages. The width buys two things the
 * 800x480 canvas has no room for: the app-only per-lap fuel-trend chart, and a projected pit
 * ladder inside the wider target column.
 *
 * Packet 12.1 gives the delta mini NO app zone of its own, so it is folded into the enlarged
 * balance hero: its rect is nested strictly inside the balance rect, which the test suite
 * asserts arithmetically.
 */
export const RC06_APP_ZONES: Readonly<Record<Rc06ZoneId, Rc06Rect>> = Object.freeze({
  peripheral: { left: 2.3, top: 0.6, width: 95.3, height: 5.3 },
  target: { left: 2.3, top: 6.7, width: 29.3, height: 66.7 },
  balance: { left: 34.0, top: 10.0, width: 32.0, height: 43.3 },
  delta: { left: 34.0, top: 38.0, width: 32.0, height: 14.0 },
  actual: { left: 68.4, top: 6.7, width: 29.3, height: 66.7 },
  trend: { left: 34.0, top: 56.7, width: 32.0, height: 30.0 },
  lift: { left: 2.3, top: 90.0, width: 95.3, height: 8.0 }
})

/**
 * Compact breakpoints are not packet-specified. They keep the ledger grammar — target and
 * actual either side of a signed balance over a full-width lift bar — and drop only the
 * app-only trend chart, so every alert keeps a visible surface at every size.
 */
const RC06_PHONE_ZONES: Readonly<Record<Exclude<Rc06ZoneId, 'trend'>, Rc06Rect>> = Object.freeze({
  peripheral: { left: 2, top: 1, width: 96, height: 5 },
  balance: { left: 2, top: 7, width: 96, height: 21 },
  target: { left: 2, top: 29, width: 47, height: 33 },
  actual: { left: 51, top: 29, width: 47, height: 33 },
  delta: { left: 2, top: 63, width: 96, height: 13 },
  lift: { left: 2, top: 78, width: 96, height: 18 }
})

const RC06_LANDSCAPE_ZONES: Readonly<Record<Exclude<Rc06ZoneId, 'trend'>, Rc06Rect>> = Object.freeze({
  peripheral: { left: 2, top: 1, width: 96, height: 6 },
  target: { left: 2, top: 8, width: 29, height: 64 },
  balance: { left: 33, top: 10, width: 34, height: 38 },
  delta: { left: 33, top: 50, width: 34, height: 22 },
  actual: { left: 69, top: 8, width: 29, height: 64 },
  lift: { left: 2, top: 74, width: 96, height: 22 }
})

const RC06_STANDARD_ZONES: Readonly<Record<Exclude<Rc06ZoneId, 'trend'>, Rc06Rect>> = Object.freeze({
  peripheral: { left: 2, top: 1, width: 96, height: 6 },
  target: { left: 2, top: 8, width: 30, height: 58 },
  balance: { left: 34, top: 10, width: 32, height: 36 },
  delta: { left: 34, top: 47, width: 32, height: 19 },
  actual: { left: 68, top: 8, width: 30, height: 58 },
  lift: { left: 2, top: 68, width: 96, height: 28 }
})

export function rc06ZonesForLayout(layout: Rc06Layout, compactMode: Rc06CompactMode = 'standard'): Rc06ZoneMap {
  if (layout === 'native') return RC06_NATIVE_ZONES
  if (layout === 'app') return RC06_APP_ZONES
  if (compactMode === 'phone') return RC06_PHONE_ZONES
  if (compactMode === 'landscape') return RC06_LANDSCAPE_ZONES
  return RC06_STANDARD_ZONES
}

/** The inline geometry a zone element carries, so CSS and the packet table cannot drift. */
export function rc06ZoneStyle(rect: Rc06Rect | undefined): {
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

export function rc06RectContains(outer: Rc06Rect, inner: Rc06Rect): boolean {
  return (
    inner.left >= outer.left &&
    inner.top >= outer.top &&
    inner.left + inner.width <= outer.left + outer.width &&
    inner.top + inner.height <= outer.top + outer.height
  )
}

/**
 * A 0..1 track fraction as a CSS percentage. Rounded to three decimals so binary-float noise
 * from the marker arithmetic never leaks into the DOM as `75.00000000000003%`.
 */
export function rc06TrackPercent(fraction: number): string {
  const clamped = Math.min(1, Math.max(0, finite(fraction) ? fraction : 0))
  return `${Math.round(clamped * 100_000) / 1_000}%`
}

// ─────────────────────────────────────────────────────────── layout resolution

export function rc06LayoutForContentBox(width: number, height: number): Rc06Layout {
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return 'app'
  if (
    Math.abs(width - RC06_NATIVE_WIDTH_PX) <= RC06_NATIVE_TOLERANCE_PX &&
    Math.abs(height - RC06_NATIVE_HEIGHT_PX) <= RC06_NATIVE_TOLERANCE_PX
  ) {
    return 'native'
  }
  if (width >= RC06_APP_WIDTH_PX - 1 && height >= RC06_APP_HEIGHT_PX - 1) return 'app'
  return 'compact'
}

export function rc06CompactModeForContentBox(width: number, height: number): Rc06CompactMode {
  if (rc06LayoutForContentBox(width, height) !== 'compact') return 'standard'
  if (
    width >= RC06_PHONE_MIN_WIDTH_PX &&
    width <= RC06_PHONE_MAX_WIDTH_PX &&
    height >= RC06_PHONE_MIN_HEIGHT_PX &&
    height / width >= 1.5
  ) {
    return 'phone'
  }
  if (
    width >= RC06_LANDSCAPE_MIN_WIDTH_PX &&
    height >= RC06_LANDSCAPE_MIN_HEIGHT_PX &&
    height <= RC06_LANDSCAPE_MAX_HEIGHT_PX &&
    width / height >= 1.5
  ) {
    return 'landscape'
  }
  return 'standard'
}

export interface Rc06PhoneGeometry {
  inset: number
  balanceHeight: number
  columnHeight: number
  deltaHeight: number
  liftHeight: number
  trackHeight: number
  toggleSize: number
}

/**
 * Portrait geometry, in pixels, for the zones the phone stack sizes from the measured box
 * rather than from a percentage. Every band is derived from the box so the stack always fits.
 */
export function rc06PhoneGeometryForContentBox(width: number, height: number): Rc06PhoneGeometry | null {
  if (rc06CompactModeForContentBox(width, height) !== 'phone') return null
  const inset = 12
  const balanceHeight = Math.round(height * 0.21)
  const columnHeight = Math.round(height * 0.33)
  const deltaHeight = Math.round(height * 0.13)
  const liftHeight = Math.round(height * 0.18)
  return {
    inset,
    balanceHeight,
    columnHeight,
    deltaHeight,
    liftHeight,
    trackHeight: Math.max(10, Math.round(liftHeight * 0.22)),
    toggleSize: 44
  }
}

// ─────────────────────────────────────────────────────────── channel extraction

/**
 * Every RC-06 channel is read straight from its own declared source. Nothing is modelled,
 * mirrored or substituted.
 *
 * `fuelPerLapLiters` is the app's OBSERVED burn rate — the FuelLevel delta averaged across
 * completed laps — which is exactly packet section 16's "computed rolling burn rate". The
 * deprecated ambiguous `fuelPerLap` and the kilogram channel are deliberately NOT accepted:
 * a unit-converted mass would be an estimate of litres, and section 16 forbids estimating a
 * burn rate.
 */
export function rc06AuxChannelValue(snapshot: TelemetrySnapshot, channel: Rc06AuxChannel): number | null {
  switch (channel) {
    case 'burnRate': {
      const burn = snapshot.fuelPerLapLiters
      return finite(burn) && burn > 0 ? burn : null
    }
    // Packet section 16: never project laps before a measured burn rate exists, and never
    // state litres without a calibrated tank. Both gates apply before any projection.
    case 'lapsRemaining': {
      const burn = snapshot.fuelPerLapLiters
      const litres = snapshot.fuelLiters
      if (!finite(burn) || burn <= 0 || !finite(litres) || litres < 0) return null
      const provided = snapshot.fuelLapsRemaining
      if (finite(provided) && provided >= 0) return provided
      return litres / burn
    }
    case 'fuelLevel': {
      const litres = snapshot.fuelLiters
      return finite(litres) && litres >= 0 ? litres : null
    }
    case 'currentLap': {
      const lap = snapshot.currentLap
      return finite(lap) && Number.isInteger(lap) && lap >= 0 ? lap : null
    }
    case 'gear':
      return finite(snapshot.gear) && Number.isInteger(snapshot.gear) ? snapshot.gear : null
    case 'speed':
      return finite(snapshot.speedKmh) && snapshot.speedKmh >= 0 ? snapshot.speedKmh : null
    case 'waterTemp':
      return finite(snapshot.waterTempC) ? snapshot.waterTempC : null
    case 'position':
      return finite(snapshot.position) && Number.isInteger(snapshot.position) && snapshot.position > 0
        ? snapshot.position
        : null
  }
  return null
}

/**
 * Receipts for RC-06's own channels, with exactly RC-01's semantics: a receipt is written only
 * when the channel actually reports, so a channel that falls silent ages out and degrades to
 * its dash state instead of freezing on its last value.
 *
 * This is deliberately NOT a second ingest buffer. It is only ever fed frames the shared RC-01
 * buffer has already accepted, so identity binding and mock/replay refusal stay in one place.
 */
export class Rc06AuxBuffer {
  private channelReceipts = new Map<Rc06AuxChannel, Rc01ChannelReceipt>()

  clone(): Rc06AuxBuffer {
    const next = new Rc06AuxBuffer()
    next.channelReceipts = new Map(this.channelReceipts)
    return next
  }

  reset(): void {
    this.channelReceipts = new Map()
  }

  ingest(snapshot: TelemetrySnapshot | null | undefined, receivedAt = rc01MonotonicNow()): void {
    if (!snapshot || !snapshot.connected || !finite(snapshot.timestamp)) return
    const safeReceiptAt = finite(receivedAt) && receivedAt >= 0 ? receivedAt : rc01MonotonicNow()
    for (const channel of Object.keys(RC06_CHANNEL_STALE_MS) as Rc06AuxChannel[]) {
      const value = rc06AuxChannelValue(snapshot, channel)
      if (value === null) continue
      this.channelReceipts.set(
        channel,
        Object.freeze({ value, snapshotTimestamp: snapshot.timestamp, receivedAt: safeReceiptAt })
      )
    }
  }

  receipts(): ReadonlyMap<Rc06AuxChannel, Rc01ChannelReceipt> {
    return new Map(this.channelReceipts)
  }
}

export function createRc06AuxReceipts(
  snapshot: TelemetrySnapshot,
  receivedAt = rc01MonotonicNow()
): ReadonlyMap<Rc06AuxChannel, Rc01ChannelReceipt> {
  const buffer = new Rc06AuxBuffer()
  buffer.ingest(snapshot, receivedAt)
  return buffer.receipts()
}

interface Rc06Reading {
  value: number | null
  lastKnown: number | null
  stale: boolean
  ageMs: number
}

function auxReading(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc06AuxChannel, Rc01ChannelReceipt>,
  channel: Rc06AuxChannel,
  nowMs: number
): Rc06Reading {
  const raw = snapshot ? rc06AuxChannelValue(snapshot, channel) : null
  const receipt = receipts.get(channel)
  if (raw === null || !receipt) {
    return { value: null, lastKnown: null, stale: false, ageMs: Number.POSITIVE_INFINITY }
  }
  const ageMs = rc01ReceiptAgeMs(receipt, nowMs)
  const stale = ageMs > RC06_CHANNEL_STALE_MS[channel]
  return {
    value: stale ? null : raw,
    lastKnown: typeof receipt.value === 'number' ? receipt.value : null,
    stale,
    ageMs
  }
}

// ─────────────────────────────────────────────────────────── per-lap accounting ledger

export interface Rc06LapSample {
  lap: number
  burn: number | null
  balance: number | null
}

/**
 * Packet 11.5 / section 20: the ledger settles per completed lap, and a refuel recalculates
 * the plan. There is no per-lap accounting channel in this app, so the cadence is MEASURED:
 * a sample is written only when a lap boundary is actually observed on a mounted session.
 *
 * The first observed lap number is recorded WITHOUT emitting a sample, exactly as RC-02
 * refuses a sector whose opening crossing it did not see: a mid-lap mount would otherwise
 * write a truncated fragment into the accounting history and poison the alert hysteresis.
 */
export class Rc06LapLedger {
  private lastLap: number | null = null
  private lastFuelL: number | null = null
  private samples: Rc06LapSample[] = []
  private refuelCount = 0

  clone(): Rc06LapLedger {
    const next = new Rc06LapLedger()
    next.lastLap = this.lastLap
    next.lastFuelL = this.lastFuelL
    next.samples = this.samples.slice()
    next.refuelCount = this.refuelCount
    return next
  }

  reset(): void {
    this.lastLap = null
    this.lastFuelL = null
    this.samples = []
    this.refuelCount = 0
  }

  observe(input: {
    lap: number | null
    fuelLevelL: number | null
    burn: number | null
    balance: number | null
    refuelSignal: boolean
  }): void {
    // ── Refuel: the plan is re-based, so every settled lap of the previous load is dropped.
    //    A measured tank rise counts, and so does an explicit refuel service flag; nothing
    //    else is treated as a refuel.
    const measuredRise =
      finite(this.lastFuelL) && finite(input.fuelLevelL) && input.fuelLevelL - this.lastFuelL > RC06_REFUEL_RISE_L
    if (input.refuelSignal || measuredRise) {
      this.samples = []
      this.refuelCount += 1
    }
    if (finite(input.fuelLevelL)) this.lastFuelL = input.fuelLevelL

    if (!finite(input.lap) || !Number.isInteger(input.lap) || input.lap < 0) return
    if (this.lastLap === null) {
      this.lastLap = input.lap
      return
    }
    if (input.lap <= this.lastLap) {
      // A lap counter that goes backwards means a new session or a reset; drop the ledger
      // rather than stitching two stints into one running balance.
      if (input.lap < this.lastLap) this.samples = []
      this.lastLap = input.lap
      return
    }
    this.lastLap = input.lap
    this.samples.push({ lap: input.lap, burn: input.burn, balance: input.balance })
    if (this.samples.length > RC06_TREND_LAP_LIMIT) {
      this.samples = this.samples.slice(this.samples.length - RC06_TREND_LAP_LIMIT)
    }
  }

  history(): readonly Rc06LapSample[] {
    return this.samples.slice()
  }

  latest(): Rc06LapSample | null {
    return this.samples.length > 0 ? this.samples[this.samples.length - 1] : null
  }

  refuels(): number {
    return this.refuelCount
  }
}

/**
 * A refuel is an explicit provider statement, never an inference. `refuelServiceActive` is the
 * app's own dedicated flag; a fuel entry in the pit service list counts only while a stop is
 * actually active. Everything else is left to the measured tank rise in the ledger.
 */
export function rc06RefuelSignal(snapshot: TelemetrySnapshot | null): boolean {
  if (!snapshot) return false
  if (snapshot.refuelServiceActive === true) return true
  const flags = snapshot.pitServiceFlags
  return snapshot.pitStopActive === true && Array.isArray(flags) && flags.includes('fuel')
}

// ─────────────────────────────────────────────────────────── trigger-only alerts

export interface Rc06AlertState {
  /** Packet section 15: per-lap latch with a two-lap hysteresis back inside tolerance. */
  behindPlan: { active: boolean; clearLaps: number }
  /** Packet section 15: per-lap latch, cleared as soon as the surplus is back to plan. */
  overSaving: { active: boolean }
  /** Packet section 15: a two-second time debounce, cleared by a valid calibrated reading. */
  fuelModelInvalid: { active: boolean; pendingSinceMs: number | null }
  /** The newest lap already accounted for, so one boundary can never latch twice. */
  lastProcessedLap: number | null
}

export interface Rc06AlertInput {
  nowMs: number
  /** The newest settled lap sample; null until a lap boundary has actually been observed. */
  lapSample: Rc06LapSample | null
  /** False whenever the balance cannot be computed at all, which disarms both plan alerts. */
  balanceAvailable: boolean
  /** False until a burn rate has genuinely been measured; over-saving stays hidden. */
  burnRateMeasured: boolean
  /** False when the fuel source is uncalibrated or its signal is lost. */
  fuelModelValid: boolean
}

export function createRc06AlertState(): Rc06AlertState {
  return {
    behindPlan: { active: false, clearLaps: 0 },
    overSaving: { active: false },
    fuelModelInvalid: { active: false, pendingSinceMs: null },
    lastProcessedLap: null
  }
}

export function cloneRc06AlertState(state: Rc06AlertState): Rc06AlertState {
  return {
    behindPlan: { ...state.behindPlan },
    overSaving: { ...state.overSaving },
    fuelModelInvalid: { ...state.fuelModelInvalid },
    lastProcessedLap: state.lastProcessedLap
  }
}

/**
 * Every alert is silent until its own trigger fires, carries the packet's debounce and
 * hysteresis, has an explicit clear condition, and is unlatched the moment its input goes
 * missing or stale. The two plan alerts advance on the ACCOUNTING cadence — once per observed
 * lap boundary — so a mid-lap wobble can never swing the cue; only the fuel-model note runs on
 * a wall-clock debounce, because a lost signal is not a per-lap event.
 */
export function advanceRc06Alerts(state: Rc06AlertState, input: Rc06AlertInput): Rc06AlertState {
  const nowMs = finite(input.nowMs) ? input.nowMs : 0
  const next = cloneRc06AlertState(state)

  // ── Fuel model invalid: 2 s engage, cleared immediately by a valid calibrated reading.
  if (input.fuelModelValid) {
    next.fuelModelInvalid = { active: false, pendingSinceMs: null }
  } else {
    const pendingSinceMs = next.fuelModelInvalid.pendingSinceMs ?? nowMs
    if (nowMs - pendingSinceMs >= RC06_FUEL_MODEL_ENGAGE_MS) {
      next.fuelModelInvalid = { active: true, pendingSinceMs }
    } else {
      next.fuelModelInvalid = { active: false, pendingSinceMs }
    }
  }

  // ── Both plan alerts are disarmed outright without a projection to judge.
  if (!input.balanceAvailable || !input.burnRateMeasured) {
    next.behindPlan = { active: false, clearLaps: 0 }
    next.overSaving = { active: false }
    return next
  }

  const sample = input.lapSample
  if (!sample || sample.lap === next.lastProcessedLap) return next
  next.lastProcessedLap = sample.lap

  const balance = sample.balance
  if (!finite(balance)) {
    next.behindPlan = { active: false, clearLaps: 0 }
    next.overSaving = { active: false }
    return next
  }

  // ── Behind fuel plan: the projection is short of the pit lap beyond tolerance.
  if (balance < -RC06_BALANCE_TOLERANCE_LAPS) {
    next.behindPlan = { active: true, clearLaps: 0 }
  } else if (next.behindPlan.active) {
    const clearLaps = next.behindPlan.clearLaps + 1
    next.behindPlan =
      clearLaps >= RC06_BEHIND_PLAN_CLEAR_LAPS ? { active: false, clearLaps: 0 } : { active: true, clearLaps }
  }

  // ── Over-saving: a projected surplus of more than a full lap beyond plan.
  next.overSaving = { active: balance > RC06_OVER_SAVE_LAPS }

  return next
}

/** A stale, missing or uncalibrated input can never leave a plan alert latched on. */
export function clearInvalidRc06Alerts(state: Rc06AlertState, model: Rc06DashboardModel): Rc06AlertState {
  const next = cloneRc06AlertState(state)
  if (model.balance.laps === null || !model.burnRateMeasured) {
    next.behindPlan = { active: false, clearLaps: 0 }
    next.overSaving = { active: false }
  }
  if (!model.burnRateMeasured) next.overSaving = { active: false }
  return next
}

/** The alert lines a surface renders; empty in a silent frame, which is the reference state. */
export function rc06AlertLines(model: Rc06DashboardModel): readonly string[] {
  const lines: string[] = []
  if (model.alerts.behindPlan) lines.push('SAVE MORE')
  if (model.alerts.overSaving) lines.push('PUSH OK')
  if (model.alerts.fuelModelInvalid) lines.push('FUEL MODEL INVALID')
  return lines
}

// ─────────────────────────────────────────────────────────── dashboard model

export type Rc06BalanceTone = 'normal' | 'caution' | 'danger' | 'muted'
export type Rc06BalanceSign = 'surplus' | 'deficit' | 'flat' | 'unknown'

export interface Rc06BalanceModel {
  field: Rc01Field
  laps: number | null
  sign: Rc06BalanceSign
  /** Packet 19: the arrow is a SHAPE, so plan status is never carried by colour alone. */
  arrow: 'up' | 'down' | 'none'
  tone: Rc06BalanceTone
}

export interface Rc06LiftModel {
  mode: Rc06LiftMode
  modeLabel: string
  value: Rc01Field
  unit: string
  savingLPerLap: number | null
  /** 0..1 along the track, or null when there is nothing honest to place. */
  markerFraction: number | null
  planFraction: number
  /** Packet 11.5's distance-to-plan mode: no lap-distance channel exists, so it stays dashed. */
  point: Rc01Field
  coach: 'SAVE MORE' | 'PUSH OK' | null
}

export interface Rc06AlertFlags {
  behindPlan: boolean
  overSaving: boolean
  fuelModelInvalid: boolean
}

export interface Rc06DashboardModel {
  /** Plan inputs — engineer-set constants, dashed until a plan is loaded. */
  targetBurn: Rc01Field
  planLaps: Rc01Field
  pitLap: Rc01Field
  planLoaded: boolean
  /** Packet 12.1 app-only pit ladder: the projected dry lap against the planned pit lap. */
  projectedDryLap: Rc01Field
  /** Telemetry ledger. */
  actualBurn: Rc01Field
  lapsRemaining: Rc01Field
  fuelLevel: Rc01Field
  balance: Rc06BalanceModel
  delta: Rc01Field
  bestLap: Rc01Field
  gear: Rc01Field
  speed: Rc01Field
  waterTemp: Rc01Field
  position: Rc01Field
  lift: Rc06LiftModel
  alerts: Rc06AlertFlags
  /** True only once a rolling burn rate has genuinely been measured. */
  burnRateMeasured: boolean
  /** False whenever the fuel source is uncalibrated or its signal is lost. */
  fuelModelValid: boolean
  /** Packet 12.1 app-only burn trend; measured per observed lap, never synthesised. */
  trend: readonly Rc06LapSample[]
  trendMeasured: boolean
  currentLap: number | null
  criticalFresh: Readonly<Record<Rc01ChannelName, boolean>>
  auxFresh: Readonly<Record<Rc06AuxChannel, boolean>>
}

export interface Rc06ModelOptions {
  plan?: Rc06Plan
  alerts?: Rc06AlertState
  liftMode?: Rc06LiftMode
  ledger?: readonly Rc06LapSample[]
}

/**
 * Projects the shared RC-01 telemetry model into RC-06's ledger and adds the fuel-strategy
 * channels. Nothing is invented, estimated or mirrored: a plan input is never inferred from
 * the car, a projection never exists without a measured burn rate, and every unavailable
 * channel renders its packet dash state rather than a plausible number.
 */
export function createRc06DashboardModel(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc01ChannelName, Rc01ChannelReceipt> = new Map(),
  auxReceipts: ReadonlyMap<Rc06AuxChannel, Rc01ChannelReceipt> = new Map(),
  nowMs = rc01MonotonicNow(),
  options: Rc06ModelOptions = {}
): Rc06DashboardModel {
  const base: Rc01DashboardModel = createRc01DashboardModel(snapshot, receipts, nowMs)
  const safeSnapshot = snapshot && snapshot.connected ? snapshot : null
  const plan = options.plan ?? RC06_EMPTY_PLAN
  const alerts = options.alerts ?? createRc06AlertState()
  const liftMode = options.liftMode ?? 'liters'
  const ledger = options.ledger ?? []

  const auxFresh = Object.fromEntries(
    (Object.keys(RC06_CHANNEL_STALE_MS) as Rc06AuxChannel[]).map((channel) => [
      channel,
      auxReading(safeSnapshot, auxReceipts, channel, nowMs).value !== null
    ])
  ) as Record<Rc06AuxChannel, boolean>

  // ── Telemetry ledger: the burn rate gates everything downstream of it.
  const burnReading = auxReading(safeSnapshot, auxReceipts, 'burnRate', nowMs)
  const burnRateMeasured = burnReading.value !== null
  const actualBurn = burnRateMeasured
    ? field((burnReading.value as number).toFixed(2), burnReading.value, false, false, 'primary')
    : field('--', null, burnReading.stale, true, 'muted')

  const lapsReading = auxReading(safeSnapshot, auxReceipts, 'lapsRemaining', nowMs)
  const lapsRemaining =
    lapsReading.value === null
      ? field('--', null, lapsReading.stale, true, 'muted')
      : field(lapsReading.value.toFixed(1), lapsReading.value, false, false, 'primary')

  const fuelReading = auxReading(safeSnapshot, auxReceipts, 'fuelLevel', nowMs)
  const fuelLevel =
    fuelReading.value === null
      ? field('--', null, fuelReading.stale, true, 'muted')
      : field(fuelReading.value.toFixed(1), fuelReading.value, false, false, 'primary')

  const lapReading = auxReading(safeSnapshot, auxReceipts, 'currentLap', nowMs)
  const currentLap = lapReading.value === null ? null : Math.trunc(lapReading.value)

  // ── Plan inputs. These are NOT telemetry; they are dashed until an engineer loads a plan.
  const targetBurn =
    plan.targetBurnLPerLap === null
      ? field('--', null, false, true, 'muted')
      : field(plan.targetBurnLPerLap.toFixed(2), plan.targetBurnLPerLap, false, false, 'primary')

  const pitLap =
    plan.pitLap === null
      ? field('--', null, false, true, 'muted')
      : field(String(Math.trunc(plan.pitLap)), plan.pitLap, false, false, 'primary')

  const planLapsValue = rc06PlanLaps(plan.pitLap, currentLap)
  const planLaps =
    planLapsValue === null
      ? field('--', null, lapReading.stale && plan.pitLap !== null, true, 'muted')
      : field(String(planLapsValue), planLapsValue, false, false, 'primary')

  const dryLapValue = rc06ProjectedDryLap(currentLap, lapsReading.value)
  const projectedDryLap =
    dryLapValue === null
      ? field('--', null, lapsReading.stale || lapReading.stale, true, 'muted')
      : field(String(dryLapValue), dryLapValue, false, false, 'primary')

  // ── The hero: measured laps of fuel minus the plan laps still to run.
  const balanceLaps = rc06Balance(lapsReading.value, planLapsValue)
  const behindPlan = alerts.behindPlan.active
  const balanceSign: Rc06BalanceSign =
    balanceLaps === null
      ? 'unknown'
      : balanceLaps > RC06_BALANCE_TOLERANCE_LAPS
        ? 'surplus'
        : balanceLaps < -RC06_BALANCE_TOLERANCE_LAPS
          ? 'deficit'
          : 'flat'
  const balanceTone: Rc06BalanceTone =
    balanceLaps === null
      ? 'muted'
      : behindPlan
        ? 'danger'
        : balanceLaps < 0
          ? 'caution'
          : 'normal'
  const balance: Rc06BalanceModel = {
    field:
      balanceLaps === null
        ? field('--', null, lapsReading.stale, true, 'muted')
        : field(signed(balanceLaps, 1), balanceLaps, false, false, balanceLaps < 0 ? 'bad' : 'good'),
    laps: balanceLaps,
    sign: balanceSign,
    arrow: balanceLaps === null ? 'none' : balanceLaps < 0 ? 'down' : balanceLaps > 0 ? 'up' : 'none',
    tone: balanceTone
  }

  // ── Delta to best: RC-01 already refuses a delta without a real stored best lap. RC-06 only
  //    re-signs it so the unit can sit in its own label, exactly as the packet types it.
  const deltaRaw = base.delta.raw
  const delta =
    base.delta.unavailable || base.delta.stale || !finite(deltaRaw)
      ? field('--.---', null, base.delta.stale, base.delta.unavailable, 'muted')
      : field(signed(deltaRaw, 2), deltaRaw, false, false, deltaRaw < 0 ? 'good' : deltaRaw > 0 ? 'bad' : 'primary')

  // ── Gear: the ECU gear channel via the lookup table, never derived from RPM or speed.
  const gearReading = auxReading(safeSnapshot, auxReceipts, 'gear', nowMs)
  const gear =
    gearReading.value === null
      ? field('-', null, gearReading.stale, true, 'muted')
      : field(rc06DisplayGear(gearReading.value), gearReading.value, false, false, 'primary')

  // ── Speed: greys past its 100 ms cadence and collapses to '---' past the 500 ms budget.
  const speedReading = auxReading(safeSnapshot, auxReceipts, 'speed', nowMs)
  const speedDashed = speedReading.value === null && speedReading.ageMs > RC06_SPEED_DASH_MS
  const speed =
    speedReading.value !== null
      ? field(String(Math.round(speedReading.value)), speedReading.value, false, false, 'primary')
      : !speedDashed && speedReading.lastKnown !== null
        ? field(String(Math.round(speedReading.lastKnown)), speedReading.lastKnown, true, false, 'muted')
        : field('---', null, speedReading.stale, true, 'muted')

  const waterReading = auxReading(safeSnapshot, auxReceipts, 'waterTemp', nowMs)
  const waterTemp =
    waterReading.value === null
      ? field('--', null, waterReading.stale, true, 'muted')
      : field(String(Math.round(waterReading.value)), waterReading.value, false, false, 'primary')

  const positionReading = auxReading(safeSnapshot, auxReceipts, 'position', nowMs)
  const position =
    positionReading.value === null
      ? field('--', null, positionReading.stale, true, 'muted')
      : field(String(Math.trunc(positionReading.value)), positionReading.value, false, false, 'primary')

  // ── The lift-and-coast cue. The litres mode is derivable from the plan target and the
  //    measured burn; the distance mode is not derivable at all (no lap-distance channel), so
  //    it stays dashed rather than drawing a plausible metre count.
  const saving =
    plan.targetBurnLPerLap !== null && burnReading.value !== null
      ? plan.targetBurnLPerLap - burnReading.value
      : null
  const liftPoint = field('--', null, false, true, 'muted')
  const liftValue =
    liftMode === 'distance'
      ? liftPoint
      : saving === null
        ? field('--', null, burnReading.stale, true, 'muted')
        : field(signed(saving, 2), saving, false, false, saving >= 0 ? 'good' : 'bad')
  const lift: Rc06LiftModel = {
    mode: liftMode,
    modeLabel: liftMode === 'liters' ? 'L/PLAN' : 'DIST',
    value: liftValue,
    unit: liftMode === 'liters' ? 'L' : 'M',
    savingLPerLap: saving,
    markerFraction: rc06LiftMarkerFraction(plan.targetBurnLPerLap, burnReading.value),
    planFraction: RC06_LIFT_PLAN_FRACTION,
    point: liftPoint,
    coach: alerts.behindPlan.active ? 'SAVE MORE' : alerts.overSaving.active ? 'PUSH OK' : null
  }

  // Packet section 15: "fuel source uncalibrated / signal lost". Both the tank reading and the
  // rolling burn rate must be real for the ledger's fuel model to be considered calibrated.
  const fuelModelValid = burnRateMeasured && fuelReading.value !== null

  return {
    targetBurn,
    planLaps,
    pitLap,
    planLoaded: rc06PlanLoaded(plan),
    projectedDryLap,
    actualBurn,
    lapsRemaining,
    fuelLevel,
    balance,
    delta,
    bestLap: base.best,
    gear,
    speed,
    waterTemp,
    position,
    lift,
    alerts: {
      behindPlan: alerts.behindPlan.active,
      overSaving: alerts.overSaving.active,
      fuelModelInvalid: alerts.fuelModelInvalid.active
    },
    burnRateMeasured,
    fuelModelValid,
    trend: ledger.slice(),
    trendMeasured: ledger.length > 0,
    currentLap,
    criticalFresh: base.criticalFresh,
    auxFresh
  }
}

/** Packet section 16: 'N' or the grey '-'; a gear is never blanked silently. */
export function rc06DisplayGear(gear: number | null): string {
  if (gear === null || !finite(gear)) return '-'
  if (gear < 0) return 'R'
  if (gear === 0) return 'N'
  return String(Math.trunc(gear))
}

/** The alert-layer inputs, all gated on freshness so a frozen frame can never engage anything. */
export function rc06AlertInputForModel(
  model: Rc06DashboardModel,
  latestLap: Rc06LapSample | null,
  nowMs: number
): Rc06AlertInput {
  return {
    nowMs,
    lapSample: latestLap,
    balanceAvailable: model.balance.laps !== null,
    burnRateMeasured: model.burnRateMeasured,
    fuelModelValid: model.fuelModelValid
  }
}

/** Accessible description for the signed balance: sign, arrow and magnitude, never colour. */
export function rc06BalanceDescription(balance: Rc06BalanceModel): string {
  if (balance.laps === null) return 'Fuel balance to plan unavailable'
  const direction =
    balance.sign === 'surplus' ? 'ahead of plan' : balance.sign === 'deficit' ? 'behind plan' : 'on plan'
  return `Fuel balance ${balance.field.value} laps, ${direction}`
}

export type { Rc01Field as Rc06Field }
