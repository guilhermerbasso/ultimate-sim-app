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
 * RC-03 "Long Night" core — endurance night-stint DDU.
 *
 * The live-only ingest buffer, identity binding, mock/replay refusal, out-of-order and
 * same-timestamp guards, channel receipts and the gear-aware over-rev hysteresis are reused
 * verbatim from the RC-01 core: they are telemetry-truth machinery, not RC-01 styling, and a
 * fork would silently drift. This module adds only what RC-03's packet requires and RC-01 does
 * not have: the engine-vitals channel set, a widget-measured fuel-burn and stint model, the
 * continuous shift ribbon, and the three trigger-only endurance alerts.
 */

/** Packet section 11.1 native canvas, and the section 12.1 app reflow target. */
export const RC03_NATIVE_WIDTH_PX = 800
export const RC03_NATIVE_HEIGHT_PX = 480
export const RC03_NATIVE_TOLERANCE_PX = 1
export const RC03_APP_WIDTH_PX = 1024
export const RC03_APP_HEIGHT_PX = 600

export const RC03_PHONE_MIN_WIDTH_PX = 360
export const RC03_PHONE_MAX_WIDTH_PX = 480
export const RC03_PHONE_MIN_HEIGHT_PX = 650
export const RC03_LANDSCAPE_MIN_WIDTH_PX = 650
export const RC03_LANDSCAPE_MIN_HEIGHT_PX = 360
export const RC03_LANDSCAPE_MAX_HEIGHT_PX = 480

/**
 * Packet section 16 freshness budgets for the channels RC-01 does not carry. Oil pressure is
 * the tightest because it is the input to the fastest-engaging alert.
 */
export const RC03_AUX_STALE_MS = {
  waterTemp: 500,
  oilPressure: 200,
  oilTemp: 500,
  battery: 500,
  fuelLevel: 500,
  fuelPressure: 500,
  manifoldPressure: 500
} as const

export type Rc03AuxChannel = keyof typeof RC03_AUX_STALE_MS

/** Packet section 15: the fuel window opens at or below the configured pit window, in laps. */
export const RC03_PIT_WINDOW_LAPS = 3
/** Packet section 15: low oil pressure, 1.5 s engage above 3000 rpm, 3 s hold, 3 s recovery. */
export const RC03_OIL_PRESSURE_MIN_BAR = 2
export const RC03_OIL_PRESSURE_RPM_GATE = 3_000
export const RC03_OIL_PRESSURE_ENGAGE_MS = 1_500
export const RC03_OIL_PRESSURE_HOLD_MS = 3_000
export const RC03_OIL_PRESSURE_RECOVER_MS = 3_000
/** Packet section 15: overheat, 3 s engage, cleared below limit-2 for 5 s. */
export const RC03_WATER_LIMIT_C = 105
export const RC03_OVERHEAT_ENGAGE_MS = 3_000
export const RC03_OVERHEAT_CLEAR_MARGIN_C = 2
export const RC03_OVERHEAT_HYSTERESIS_MS = 5_000

/** Rolling window of measured burn laps behind the fuel model. */
export const RC03_BURN_HISTORY_LIMIT = 5
/** A fuel level that rises by more than this is a refuel, not sensor noise. */
export const RC03_REFUEL_TOLERANCE_L = 0.25
/** Backward lap-clock movement beyond this is a pit/session restart, not provider jitter. */
export const RC03_LAP_CLOCK_RESTART_TOLERANCE_SEC = 0.25
/** A timing feed quieter than this can no longer support a live stint or fuel reading. */
export const RC03_STINT_FEED_STALE_MS = 1_000

/**
 * Packet sections 11.5 and 20: brightness is bound to a display-switch event and the night
 * profile is the default, so a cold start can never come up at daytime luminance.
 */
export const RC03_DISPLAY_SWITCH_EVENT = 'racecon:display-switch'
export const RC03_BRIGHTNESS_SCALE = { night: 0.78, day: 1 } as const
export type Rc03BrightnessProfile = keyof typeof RC03_BRIGHTNESS_SCALE
export const RC03_DEFAULT_BRIGHTNESS_PROFILE: Rc03BrightnessProfile = 'night'

/** Packet section 11.5: a soft-key cycles the vitals band between temperatures and pressures. */
export const RC03_VITALS_PAGES = ['temps', 'pressures'] as const
export type Rc03VitalsPage = (typeof RC03_VITALS_PAGES)[number]

export type Rc03CompactMode = 'phone' | 'landscape' | 'standard'
export type Rc03RibbonTone = 'dark' | 'caution' | 'danger'

export interface Rc03Ribbon {
  /** 0..1 of the ribbon track, exactly rpm / maxRpm. Zero whenever RPM is missing or stale. */
  fill: number
  unavailable: boolean
  tone: Rc03RibbonTone
}

export interface Rc03Vital extends Rc01Field {
  channel: Rc03AuxChannel
  label: string
  unit: string
  /** Trigger-only: true only while this gauge's own alert is latched. */
  alert: boolean
}

export interface Rc03FuelBar {
  /** level / capacity, clamped to 0..1. Always zero while the fuel model is uncalibrated. */
  fill: number
  unavailable: boolean
}

export interface Rc03DashboardModel {
  gear: Rc01Field
  delta: Rc01Field
  speed: Rc01Field
  ribbon: Rc03Ribbon
  /**
   * The raw engine speed behind the ribbon. It is deliberately never printed as a numeral —
   * the ribbon is its only visual surface — but the low-oil-pressure gate is defined in RPM,
   * so the alert layer needs the value it is already bound to.
   */
  rpmRaw: number | null
  rpmFresh: boolean
  vitals: readonly Rc03Vital[]
  fuelLaps: Rc01Field
  fuelLevel: Rc01Field
  fuelBar: Rc03FuelBar
  /** 1024x600 only: the measured rolling burn rate and its recent trend. */
  fuelPerLap: Rc01Field
  fuelTrend: readonly number[]
  stintLap: Rc01Field
  stintClock: Rc01Field
  /** 1024x600 only, app-only strategy rail. */
  pitWindowLaps: Rc01Field
  projectedPitLap: Rc01Field
  averagePace: Rc01Field
  /**
   * Tyre temperature has no zone in either the 800x480 grammar or the 1024x600 reflow, so it
   * is omitted from the model entirely rather than having its freshness derived from a proxy.
   */
  criticalFresh: Readonly<Record<Rc01ChannelName, boolean>>
  auxFresh: Readonly<Record<Rc03AuxChannel, boolean>>
}

export interface Rc03PhoneGeometry {
  inset: number
  ribbonTop: number
  ribbonHeight: number
  paceTop: number
  paceHeight: number
  vitalsTop: number
  vitalsHeight: number
  fuelTop: number
  fuelHeight: number
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

function unavailableField(value: string): Rc01Field {
  return field(value, null, false, true, 'muted')
}

/** mm:ss since the stint marker, or the packet's dash placeholder without one. */
export function rc03FormatStintClock(elapsedMs: number | null): string {
  if (elapsedMs === null || !Number.isFinite(elapsedMs) || elapsedMs < 0) return '--:--'
  const totalSeconds = Math.floor(elapsedMs / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds - minutes * 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** m:ss.mmm, used only by the app-only average-pace rail row. */
export function rc03FormatLapTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return '--:--.---'
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  return `${minutes}:${rest.toFixed(3).padStart(6, '0')}`
}

/** A bare signed delta; the unit is rendered as its own label in the pace band. */
export function rc03FormatDelta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '--.---'
  return `${seconds < 0 ? '-' : '+'}${Math.abs(seconds).toFixed(3)}`
}

// ─────────────────────────────────────────────────────────── layout resolution

export function rc03LayoutForContentBox(width: number, height: number): 'native' | 'app' | 'compact' {
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return 'app'
  if (
    Math.abs(width - RC03_NATIVE_WIDTH_PX) <= RC03_NATIVE_TOLERANCE_PX &&
    Math.abs(height - RC03_NATIVE_HEIGHT_PX) <= RC03_NATIVE_TOLERANCE_PX
  ) {
    return 'native'
  }
  if (width >= RC03_APP_WIDTH_PX - 1 && height >= RC03_APP_HEIGHT_PX - 1) return 'app'
  return 'compact'
}

export function rc03CompactModeForContentBox(width: number, height: number): Rc03CompactMode {
  if (rc03LayoutForContentBox(width, height) !== 'compact') return 'standard'
  if (
    width >= RC03_PHONE_MIN_WIDTH_PX &&
    width <= RC03_PHONE_MAX_WIDTH_PX &&
    height >= RC03_PHONE_MIN_HEIGHT_PX &&
    height / width >= 1.5
  ) {
    return 'phone'
  }
  if (
    width >= RC03_LANDSCAPE_MIN_WIDTH_PX &&
    height >= RC03_LANDSCAPE_MIN_HEIGHT_PX &&
    height <= RC03_LANDSCAPE_MAX_HEIGHT_PX &&
    width / height >= 1.5
  ) {
    return 'landscape'
  }
  return 'standard'
}

/**
 * Portrait geometry for the phone breakpoint. The three bands stay horizontal — the night
 * thesis is the band grammar, not the aspect ratio — and every value is derived from the
 * measured content box so the stack stays contained instead of overflowing.
 */
export function rc03PhoneGeometryForContentBox(width: number, height: number): Rc03PhoneGeometry | null {
  if (rc03CompactModeForContentBox(width, height) !== 'phone') return null
  const inset = 12
  const gap = 14
  const ribbonTop = 12
  const ribbonHeight = 18
  const paceTop = ribbonTop + ribbonHeight + gap
  const paceHeight = Math.round(height * 0.26)
  const vitalsTop = paceTop + paceHeight + gap
  const vitalsHeight = Math.round(height * 0.26)
  const fuelTop = vitalsTop + vitalsHeight + gap
  const fuelHeight = Math.max(80, height - fuelTop - inset)
  return { inset, ribbonTop, ribbonHeight, paceTop, paceHeight, vitalsTop, vitalsHeight, fuelTop, fuelHeight }
}

// ─────────────────────────────────────────────────────────── shift ribbon

/**
 * Packet section 11.4: ONE continuous dimmed bar filled left-to-right by rpm / maxRpm. It
 * carries no text, no ticks and no index marks, and it never blinks. Over-rev — reused from
 * RC-01's debounced hysteresis, whose thresholds already match this packet — swaps the fill
 * to the warm-red token; nothing else may colour it.
 */
export function buildRc03Ribbon(rpmRatio: number | null, rpmFresh: boolean, overRevActive = false): Rc03Ribbon {
  if (!rpmFresh || rpmRatio === null || !Number.isFinite(rpmRatio)) {
    return { fill: 0, unavailable: true, tone: 'dark' }
  }
  return {
    fill: Math.min(1, Math.max(0, rpmRatio)),
    unavailable: false,
    tone: overRevActive ? 'danger' : 'caution'
  }
}

// ─────────────────────────────────────────────────────────── auxiliary channels

/**
 * The engine-vitals and fuel-level channels RC-01 does not carry. Every entry is read straight
 * from its own sensor field: nothing is modelled, mirrored or substituted. Oil pressure is the
 * only unit conversion (kPa to bar), which is arithmetic on a real reading, not an estimate.
 */
export function rc03AuxChannelValue(snapshot: TelemetrySnapshot, channel: Rc03AuxChannel): number | null {
  switch (channel) {
    case 'waterTemp':
      return finite(snapshot.waterTempC) ? snapshot.waterTempC : null
    case 'oilTemp':
      return finite(snapshot.oilTempC) ? snapshot.oilTempC : null
    case 'oilPressure':
      return finite(snapshot.oilPressureKpa) && snapshot.oilPressureKpa >= 0 ? snapshot.oilPressureKpa / 100 : null
    // A quiet electrical bus reads zero; the packet requires a dash rather than a nominal 12/13 V.
    case 'battery':
      return finite(snapshot.voltage) && snapshot.voltage > 0 ? snapshot.voltage : null
    case 'fuelLevel':
      return finite(snapshot.fuelLiters) && snapshot.fuelLiters >= 0 ? snapshot.fuelLiters : null
    case 'fuelPressure':
      return finite(snapshot.fuelPressBar) && snapshot.fuelPressBar >= 0 ? snapshot.fuelPressBar : null
    case 'manifoldPressure':
      return finite(snapshot.manifoldPressBar) && snapshot.manifoldPressBar >= 0 ? snapshot.manifoldPressBar : null
  }
}

/**
 * Receipts for RC-03's own channels, with exactly RC-01's semantics: a receipt is written only
 * when the channel actually reports, so a channel that falls silent ages out and degrades to
 * its dash state instead of freezing on its last value.
 *
 * This is deliberately NOT a second ingest buffer. It is only ever fed frames the shared
 * RC-01 buffer has already accepted, so identity binding and mock/replay refusal stay in one
 * place.
 */
export class Rc03AuxBuffer {
  private channelReceipts = new Map<Rc03AuxChannel, Rc01ChannelReceipt>()

  clone(): Rc03AuxBuffer {
    const next = new Rc03AuxBuffer()
    next.channelReceipts = new Map(this.channelReceipts)
    return next
  }

  reset(): void {
    this.channelReceipts = new Map()
  }

  ingest(snapshot: TelemetrySnapshot | null | undefined, receivedAt = rc01MonotonicNow()): void {
    if (!snapshot || !snapshot.connected || !finite(snapshot.timestamp)) return
    const safeReceiptAt = finite(receivedAt) && receivedAt >= 0 ? receivedAt : rc01MonotonicNow()
    for (const channel of Object.keys(RC03_AUX_STALE_MS) as Rc03AuxChannel[]) {
      const value = rc03AuxChannelValue(snapshot, channel)
      if (value === null) continue
      this.channelReceipts.set(
        channel,
        Object.freeze({ value, snapshotTimestamp: snapshot.timestamp, receivedAt: safeReceiptAt })
      )
    }
  }

  receipts(): ReadonlyMap<Rc03AuxChannel, Rc01ChannelReceipt> {
    return new Map(this.channelReceipts)
  }
}

export function createRc03AuxReceipts(
  snapshot: TelemetrySnapshot,
  receivedAt = rc01MonotonicNow()
): ReadonlyMap<Rc03AuxChannel, Rc01ChannelReceipt> {
  const buffer = new Rc03AuxBuffer()
  buffer.ingest(snapshot, receivedAt)
  return buffer.receipts()
}

function auxReading(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc03AuxChannel, Rc01ChannelReceipt>,
  channel: Rc03AuxChannel,
  nowMs: number
): { value: number | null; stale: boolean } {
  const raw = snapshot ? rc03AuxChannelValue(snapshot, channel) : null
  const receipt = receipts.get(channel)
  if (raw === null || !receipt || typeof receipt.value !== 'number') return { value: null, stale: false }
  const stale = rc01ReceiptAgeMs(receipt, nowMs) > RC03_AUX_STALE_MS[channel]
  return { value: stale ? null : raw, stale }
}

function vitalField(
  reading: { value: number | null; stale: boolean },
  format: (value: number) => string,
  alert: boolean
): Rc01Field {
  if (reading.value === null) return field('--', null, reading.stale, true, 'muted')
  return field(format(reading.value), reading.value, false, false, alert ? 'bad' : 'good')
}

// ─────────────────────────────────────────────────────────── stint + fuel model

export interface Rc03StintFuelSample {
  lapDistPct: number | null
  currentLapTimeSec: number | null
  fuelLiters: number | null
  onPitRoad: boolean | null
  refuelServiceActive: boolean | null
  receivedAt: number
}

export interface Rc03StintFuelReading {
  /** True only after an explicit observed pit-exit marker. */
  stintMarked: boolean
  /** The lap in progress within the stint; null without a marker or a live feed. */
  stintLap: number | null
  stintElapsedMs: number | null
  /** Mean of the measured burn laps; null until at least one full lap has been measured. */
  fuelPerLapL: number | null
  measuredBurnLaps: number
  /** Recent measured burn laps, oldest first, for the app-only trend. */
  burnTrend: readonly number[]
  /** Mean of the measured full-lap times since the marker; null until one is measured. */
  averageLapSec: number | null
  /** Increments whenever a refuel invalidates the fuel model, so an alert can unlatch on it. */
  fuelModelSeq: number
}

/**
 * The app has no honest "laps of fuel remaining" channel: a provider's own figure may be a
 * nominal burn rate rather than a measured one, and the packet forbids assuming a nominal
 * burn. So RC-03 measures the burn itself, exactly the way RC-02 measures sector splits.
 *
 * A burn lap is recorded only when BOTH bounding start-finish crossings were actually
 * observed, so a mid-stint mount, an out-lap fragment or a pit reset can never write a
 * truncated consumption into the rolling model. A refuel discards the model outright rather
 * than averaging across a tank change.
 *
 * The stint is likewise never assumed: it starts only at an observed pit-road exit. Without
 * that explicit marker the lap counter and the timer stay at their dash states, so laps are
 * never carried across an unmarked boundary.
 */
export class Rc03StintFuelTracker {
  private lastLapDistPct: number | null = null
  private lastLapTimeSec: number | null = null
  private lastReceivedAt: number | null = null
  private hasFeed = false

  private stintMarked = false
  private stintStartMs: number | null = null
  private crossingsSinceMarker = 0
  private lastOnPitRoad: boolean | null = null

  private lapStartObserved = false
  private fuelAtLapStart: number | null = null
  private burns: number[] = []
  private lapTimes: number[] = []
  private modelSeq = 0

  clone(): Rc03StintFuelTracker {
    const next = new Rc03StintFuelTracker()
    next.lastLapDistPct = this.lastLapDistPct
    next.lastLapTimeSec = this.lastLapTimeSec
    next.lastReceivedAt = this.lastReceivedAt
    next.hasFeed = this.hasFeed
    next.stintMarked = this.stintMarked
    next.stintStartMs = this.stintStartMs
    next.crossingsSinceMarker = this.crossingsSinceMarker
    next.lastOnPitRoad = this.lastOnPitRoad
    next.lapStartObserved = this.lapStartObserved
    next.fuelAtLapStart = this.fuelAtLapStart
    next.burns = [...this.burns]
    next.lapTimes = [...this.lapTimes]
    next.modelSeq = this.modelSeq
    return next
  }

  /** A source or session discontinuity invalidates the stint marker and the whole fuel model. */
  reset(): void {
    this.lastLapDistPct = null
    this.lastLapTimeSec = null
    this.lastReceivedAt = null
    this.hasFeed = false
    this.stintMarked = false
    this.stintStartMs = null
    this.crossingsSinceMarker = 0
    this.lastOnPitRoad = null
    this.lapStartObserved = false
    this.fuelAtLapStart = null
    this.burns = []
    this.lapTimes = []
    this.modelSeq += 1
  }

  /** Discards every measured burn lap. The stint marker survives: only the tank changed. */
  private resetFuelModel(): void {
    this.burns = []
    this.lapStartObserved = false
    this.fuelAtLapStart = null
    this.modelSeq += 1
  }

  /** An observed pit-road exit is the only thing that starts a stint. */
  markStint(atMs: number): void {
    this.stintMarked = true
    this.stintStartMs = finite(atMs) ? atMs : null
    this.crossingsSinceMarker = 0
    this.lapTimes = []
  }

  ingest(sample: Rc03StintFuelSample): void {
    const { lapDistPct, currentLapTimeSec, fuelLiters, onPitRoad, refuelServiceActive, receivedAt } = sample

    if (typeof onPitRoad === 'boolean') {
      if (this.lastOnPitRoad === true && onPitRoad === false) this.markStint(receivedAt)
      // Entering the pit lane ends the stint's measurable fuel history: the tank is about to
      // change and the laps that follow belong to the next stint.
      if (this.lastOnPitRoad === false && onPitRoad === true) {
        this.stintMarked = false
        this.stintStartMs = null
        this.crossingsSinceMarker = 0
        this.resetFuelModel()
      }
      this.lastOnPitRoad = onPitRoad
    }
    if (refuelServiceActive === true) this.resetFuelModel()

    if (
      !finite(lapDistPct) ||
      lapDistPct < 0 ||
      lapDistPct > 1 ||
      !finite(currentLapTimeSec) ||
      currentLapTimeSec < 0
    ) {
      this.hasFeed = false
      return
    }
    this.hasFeed = true
    this.lastReceivedAt = receivedAt

    const level = finite(fuelLiters) && fuelLiters >= 0 ? fuelLiters : null
    // A tank that gains fuel mid-lap is a refuel; averaging across it would fabricate a burn.
    if (level !== null && this.fuelAtLapStart !== null && level > this.fuelAtLapStart + RC03_REFUEL_TOLERANCE_L) {
      this.resetFuelModel()
    }

    if (this.lastLapDistPct === null) {
      this.beginLapInProgress(level)
      this.lastLapDistPct = lapDistPct
      this.lastLapTimeSec = currentLapTimeSec
      return
    }

    // Real lapDistPct is [0, 1): a lap ends by wrapping from a high fraction to a low one.
    const wrapped = lapDistPct + 0.5 < this.lastLapDistPct
    if (wrapped) {
      this.closeLap(level)
      this.lastLapDistPct = lapDistPct
      this.lastLapTimeSec = currentLapTimeSec
      return
    }

    // A pit or session restart rewinds the lap clock without a wrap; provider jitter does not.
    if (this.lastLapTimeSec !== null && currentLapTimeSec < this.lastLapTimeSec - RC03_LAP_CLOCK_RESTART_TOLERANCE_SEC) {
      this.beginLapInProgress(level)
    }

    this.lastLapDistPct = lapDistPct
    this.lastLapTimeSec = currentLapTimeSec
  }

  /** Joins a lap somewhere other than start-finish: nothing in it is measurable. */
  private beginLapInProgress(level: number | null): void {
    this.lapStartObserved = false
    this.fuelAtLapStart = level
  }

  /** Closes a lap at an observed start-finish crossing, recording it only if it was measurable. */
  private closeLap(level: number | null): void {
    if (this.lapStartObserved && this.fuelAtLapStart !== null && level !== null) {
      const burn = this.fuelAtLapStart - level
      if (burn > 0) this.burns = [...this.burns, burn].slice(-RC03_BURN_HISTORY_LIMIT)
    }
    if (this.lapStartObserved && this.stintMarked && this.lastLapTimeSec !== null && this.lastLapTimeSec > 0) {
      this.lapTimes = [...this.lapTimes, this.lastLapTimeSec].slice(-RC03_BURN_HISTORY_LIMIT)
    }
    if (this.stintMarked) this.crossingsSinceMarker += 1
    this.lapStartObserved = true
    this.fuelAtLapStart = level
  }

  private feedFresh(nowMs: number): boolean {
    return this.hasFeed && this.lastReceivedAt !== null && nowMs - this.lastReceivedAt <= RC03_STINT_FEED_STALE_MS
  }

  reading(nowMs: number): Rc03StintFuelReading {
    const fresh = this.feedFresh(nowMs)
    const marked = this.stintMarked && this.stintStartMs !== null
    const elapsed = marked && finite(nowMs) ? Math.max(0, nowMs - (this.stintStartMs as number)) : null
    const mean = (values: readonly number[]): number | null =>
      values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
    return {
      stintMarked: marked,
      // The lap in progress within the stint: observed crossings since the marker, plus one.
      stintLap: marked && fresh ? this.crossingsSinceMarker + 1 : null,
      stintElapsedMs: elapsed,
      fuelPerLapL: fresh ? mean(this.burns) : null,
      measuredBurnLaps: this.burns.length,
      burnTrend: fresh ? [...this.burns] : [],
      averageLapSec: fresh ? mean(this.lapTimes) : null,
      fuelModelSeq: this.modelSeq
    }
  }

  hasTimingFeed(): boolean {
    return this.hasFeed
  }
}

export function createRc03StintFuelReading(): Rc03StintFuelReading {
  return {
    stintMarked: false,
    stintLap: null,
    stintElapsedMs: null,
    fuelPerLapL: null,
    measuredBurnLaps: 0,
    burnTrend: [],
    averageLapSec: null,
    fuelModelSeq: 0
  }
}

// ─────────────────────────────────────────────────────────── trigger-only alerts

export interface Rc03AlertState {
  /** Latched, steady, never blinking. Cleared only by a fuel-model reset or loss of the model. */
  fuelWindow: { active: boolean; modelSeq: number | null }
  oilPressure: {
    active: boolean
    pendingSinceMs: number | null
    recoverySinceMs: number | null
    holdUntilMs: number
    acknowledged: boolean
  }
  overheat: { active: boolean; pendingSinceMs: number | null; recoverySinceMs: number | null; acknowledged: boolean }
}

export interface Rc03AlertInput {
  nowMs: number
  /** Laps of fuel remaining; null whenever the fuel model cannot produce one. */
  fuelLapsRemaining: number | null
  pitWindowLaps: number
  /** Monotone fuel-model generation; a change means a refuel invalidated the model. */
  fuelModelSeq: number
  /** Oil pressure in bar; null when the sensor is invalid or the channel is stale. */
  oilPressureBar: number | null
  /** Engine speed; null when RPM is missing or stale, which disarms the pressure gate. */
  rpm: number | null
  /** Coolant temperature; null when the sensor is invalid or the channel is stale. */
  waterTempC: number | null
}

export function createRc03AlertState(): Rc03AlertState {
  return {
    fuelWindow: { active: false, modelSeq: null },
    oilPressure: { active: false, pendingSinceMs: null, recoverySinceMs: null, holdUntilMs: 0, acknowledged: false },
    overheat: { active: false, pendingSinceMs: null, recoverySinceMs: null, acknowledged: false }
  }
}

export function cloneRc03AlertState(state: Rc03AlertState): Rc03AlertState {
  return {
    fuelWindow: { ...state.fuelWindow },
    oilPressure: { ...state.oilPressure },
    overheat: { ...state.overheat }
  }
}

/**
 * Every alert here is silent until its own trigger fires, carries the packet's debounce and
 * hysteresis, has an explicit clear condition, and is unlatched the moment its input goes
 * missing or stale. None of them blinks: escalation is border shape and brightness only.
 */
export function advanceRc03Alerts(state: Rc03AlertState, input: Rc03AlertInput): Rc03AlertState {
  const nowMs = finite(input.nowMs) ? input.nowMs : 0
  const next = cloneRc03AlertState(state)

  // ── Fuel window: latched and steady, reset by the refuel that rebuilds the fuel model.
  const modelChanged = next.fuelWindow.modelSeq !== null && next.fuelWindow.modelSeq !== input.fuelModelSeq
  if (input.fuelLapsRemaining === null || modelChanged) {
    next.fuelWindow = { active: false, modelSeq: input.fuelLapsRemaining === null ? null : input.fuelModelSeq }
  } else if (next.fuelWindow.active) {
    next.fuelWindow = { active: true, modelSeq: input.fuelModelSeq }
  } else if (input.fuelLapsRemaining <= input.pitWindowLaps) {
    next.fuelWindow = { active: true, modelSeq: input.fuelModelSeq }
  } else {
    next.fuelWindow = { active: false, modelSeq: input.fuelModelSeq }
  }

  // ── Low oil pressure: 1.5 s below threshold above the RPM gate, 3 s hold, 3 s recovery.
  if (input.oilPressureBar === null) {
    next.oilPressure = { active: false, pendingSinceMs: null, recoverySinceMs: null, holdUntilMs: 0, acknowledged: false }
  } else {
    const armed = input.rpm !== null && input.rpm > RC03_OIL_PRESSURE_RPM_GATE
    const low = armed && input.oilPressureBar < RC03_OIL_PRESSURE_MIN_BAR
    if (next.oilPressure.active) {
      if (low) {
        next.oilPressure.recoverySinceMs = null
        next.oilPressure.holdUntilMs = Math.max(next.oilPressure.holdUntilMs, nowMs + RC03_OIL_PRESSURE_HOLD_MS)
      } else {
        const recoverySinceMs = next.oilPressure.recoverySinceMs ?? nowMs
        next.oilPressure.recoverySinceMs = recoverySinceMs
        if (nowMs - recoverySinceMs >= RC03_OIL_PRESSURE_RECOVER_MS && nowMs >= next.oilPressure.holdUntilMs) {
          next.oilPressure = {
            active: false,
            pendingSinceMs: null,
            recoverySinceMs: null,
            holdUntilMs: 0,
            acknowledged: false
          }
        }
      }
    } else if (low) {
      const pendingSinceMs = next.oilPressure.pendingSinceMs ?? nowMs
      if (nowMs - pendingSinceMs >= RC03_OIL_PRESSURE_ENGAGE_MS) {
        next.oilPressure = {
          active: true,
          pendingSinceMs: null,
          recoverySinceMs: null,
          holdUntilMs: nowMs + RC03_OIL_PRESSURE_HOLD_MS,
          acknowledged: false
        }
      } else {
        next.oilPressure.pendingSinceMs = pendingSinceMs
      }
    } else {
      next.oilPressure.pendingSinceMs = null
    }
  }

  // ── Overheat: 3 s above the limit, cleared only below limit-2 for 5 s.
  if (input.waterTempC === null) {
    next.overheat = { active: false, pendingSinceMs: null, recoverySinceMs: null, acknowledged: false }
  } else if (next.overheat.active) {
    if (input.waterTempC < RC03_WATER_LIMIT_C - RC03_OVERHEAT_CLEAR_MARGIN_C) {
      const recoverySinceMs = next.overheat.recoverySinceMs ?? nowMs
      next.overheat.recoverySinceMs = recoverySinceMs
      if (nowMs - recoverySinceMs >= RC03_OVERHEAT_HYSTERESIS_MS) {
        next.overheat = { active: false, pendingSinceMs: null, recoverySinceMs: null, acknowledged: false }
      }
    } else {
      next.overheat.recoverySinceMs = null
    }
  } else if (input.waterTempC > RC03_WATER_LIMIT_C) {
    const pendingSinceMs = next.overheat.pendingSinceMs ?? nowMs
    if (nowMs - pendingSinceMs >= RC03_OVERHEAT_ENGAGE_MS) {
      next.overheat = { active: true, pendingSinceMs: null, recoverySinceMs: null, acknowledged: false }
    } else {
      next.overheat.pendingSinceMs = pendingSinceMs
    }
  } else {
    next.overheat.pendingSinceMs = null
  }

  return next
}

/**
 * Packet section 14 gives the critical band a resettable alarm line. Acknowledging only
 * silences the line: the band border and the brightened gauge stay until the packet's clear
 * condition is met, so an alert can never be dismissed while it is still true.
 */
export function acknowledgeRc03Alarms(state: Rc03AlertState): Rc03AlertState {
  const next = cloneRc03AlertState(state)
  if (next.oilPressure.active) next.oilPressure.acknowledged = true
  if (next.overheat.active) next.overheat.acknowledged = true
  return next
}

/** A stale or unavailable input can never leave an alert latched on. */
export function clearInvalidRc03Alerts(state: Rc03AlertState, model: Rc03DashboardModel): Rc03AlertState {
  const next = cloneRc03AlertState(state)
  const vital = (channel: Rc03AuxChannel): Rc03Vital | undefined => model.vitals.find((entry) => entry.channel === channel)
  const oil = vital('oilPressure')
  const water = vital('waterTemp')
  if (model.fuelLaps.unavailable || model.fuelLaps.stale) next.fuelWindow = { active: false, modelSeq: null }
  if (!oil || oil.unavailable || oil.stale) {
    next.oilPressure = { active: false, pendingSinceMs: null, recoverySinceMs: null, holdUntilMs: 0, acknowledged: false }
  }
  if (!water || water.unavailable || water.stale) {
    next.overheat = { active: false, pendingSinceMs: null, recoverySinceMs: null, acknowledged: false }
  }
  return next
}

export function rc03AlarmLines(state: Rc03AlertState): readonly string[] {
  const lines: string[] = []
  if (state.oilPressure.active && !state.oilPressure.acknowledged) lines.push('LOW OIL PRESS')
  if (state.overheat.active && !state.overheat.acknowledged) lines.push('OVERHEAT')
  return lines
}

// ─────────────────────────────────────────────────────────── interaction reducers

export function rc03NextVitalsPage(page: Rc03VitalsPage): Rc03VitalsPage {
  const index = RC03_VITALS_PAGES.indexOf(page)
  return RC03_VITALS_PAGES[(index + 1) % RC03_VITALS_PAGES.length]
}

/**
 * Packet sections 11.5 and 20 bind brightness to a display-switch event rather than to a
 * guessed ambient reading. An unrecognised or absent payload keeps the night profile.
 */
export function rc03BrightnessFromDisplaySwitch(
  detail: unknown,
  fallback: Rc03BrightnessProfile = RC03_DEFAULT_BRIGHTNESS_PROFILE
): Rc03BrightnessProfile {
  const profile =
    typeof detail === 'string'
      ? detail
      : detail && typeof detail === 'object' && 'profile' in detail
        ? (detail as { profile?: unknown }).profile
        : undefined
  return profile === 'day' || profile === 'night' ? profile : fallback
}

// ─────────────────────────────────────────────────────────── dashboard model

export interface Rc03ModelOptions {
  stintFuel?: Rc03StintFuelReading
  vitalsPage?: Rc03VitalsPage
  alerts?: Rc03AlertState
  overRevActive?: boolean
  pitWindowLaps?: number
}

const VITAL_DEFINITIONS: Record<Rc03VitalsPage, ReadonlyArray<{ channel: Rc03AuxChannel; label: string; unit: string; digits: number }>> = {
  temps: [
    { channel: 'waterTemp', label: 'WATER', unit: 'C', digits: 0 },
    { channel: 'oilPressure', label: 'OIL P', unit: 'BAR', digits: 1 },
    { channel: 'oilTemp', label: 'OIL T', unit: 'C', digits: 0 },
    { channel: 'battery', label: 'BATT', unit: 'V', digits: 1 }
  ],
  pressures: [
    { channel: 'oilPressure', label: 'OIL P', unit: 'BAR', digits: 1 },
    { channel: 'fuelPressure', label: 'FUEL P', unit: 'BAR', digits: 1 },
    { channel: 'manifoldPressure', label: 'MAP', unit: 'BAR', digits: 2 },
    { channel: 'battery', label: 'BATT', unit: 'V', digits: 1 }
  ]
}

/**
 * Projects the shared RC-01 telemetry model into RC-03's presentation and adds the endurance
 * channels. Nothing is invented, estimated or mirrored: every unavailable channel renders its
 * packet dash state, the fuel bar is computed from level over capacity so it can never
 * disagree with the litre readout, and the derived projections (fuel laps, projected pit lap,
 * average pace) exist only while every channel they are bound to is real and fresh.
 */
export function createRc03DashboardModel(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc01ChannelName, Rc01ChannelReceipt> = new Map(),
  auxReceipts: ReadonlyMap<Rc03AuxChannel, Rc01ChannelReceipt> = new Map(),
  nowMs = rc01MonotonicNow(),
  options: Rc03ModelOptions = {}
): Rc03DashboardModel {
  const base: Rc01DashboardModel = createRc01DashboardModel(snapshot, receipts, nowMs)
  const safeSnapshot = snapshot && snapshot.connected ? snapshot : null
  const stintFuel = options.stintFuel ?? createRc03StintFuelReading()
  const page = options.vitalsPage ?? 'temps'
  const alerts = options.alerts ?? createRc03AlertState()
  const pitWindowLaps = finite(options.pitWindowLaps) && options.pitWindowLaps > 0 ? options.pitWindowLaps : RC03_PIT_WINDOW_LAPS

  const auxFresh = Object.fromEntries(
    (Object.keys(RC03_AUX_STALE_MS) as Rc03AuxChannel[]).map((channel) => [
      channel,
      auxReading(safeSnapshot, auxReceipts, channel, nowMs).value !== null
    ])
  ) as Record<Rc03AuxChannel, boolean>

  const vitals: Rc03Vital[] = VITAL_DEFINITIONS[page].map((definition) => {
    const reading = auxReading(safeSnapshot, auxReceipts, definition.channel, nowMs)
    const alert =
      (definition.channel === 'waterTemp' && alerts.overheat.active) ||
      (definition.channel === 'oilPressure' && alerts.oilPressure.active)
    return {
      channel: definition.channel,
      label: definition.label,
      unit: definition.unit,
      alert,
      ...vitalField(reading, (value) => value.toFixed(definition.digits), alert)
    }
  })

  // Packet section 16: the gear channel dashes to a grey '-' and is never derived from RPM or
  // speed. RC-01's own placeholder is an em dash, so RC-03 restates its own.
  const gear = base.gear.unavailable ? unavailableField('-') : base.gear
  const deltaUsable = !base.delta.unavailable && !base.delta.stale && finite(base.delta.raw)
  const delta = deltaUsable
    ? field(rc03FormatDelta(base.delta.raw as number), base.delta.raw, false, false, 'primary')
    : field('--.---', null, base.delta.stale && !base.delta.unavailable, base.delta.unavailable, 'muted')
  const speed = base.speed

  // Fuel calibration: the litre readout and the bar are gated on the SAME preconditions, so
  // the drawn bar length and the printed litres can never contradict each other.
  const levelReading = auxReading(safeSnapshot, auxReceipts, 'fuelLevel', nowMs)
  const capacity = finite(safeSnapshot?.fuelCapacityLiters) && (safeSnapshot?.fuelCapacityLiters as number) > 0
    ? (safeSnapshot?.fuelCapacityLiters as number)
    : null
  const calibrated = levelReading.value !== null && capacity !== null
  // The caution-amber of the fuel typography is packet 11.2 styling, not an alert tone, so it
  // lives in the stylesheet and never travels through the shared field tone union.
  const fuelLevel = calibrated
    ? field((levelReading.value as number).toFixed(1), levelReading.value, false, false, 'primary')
    : field('--', null, levelReading.stale, true, 'muted')
  const fuelBar: Rc03FuelBar = calibrated
    ? { fill: Math.min(1, Math.max(0, (levelReading.value as number) / (capacity as number))), unavailable: false }
    : { fill: 0, unavailable: true }

  // Fuel laps needs a real level and at least one MEASURED burn lap; a nominal rate is never
  // assumed, so the hero dashes until the model has genuinely observed a full lap.
  const fuelLapsRaw =
    levelReading.value !== null && stintFuel.fuelPerLapL !== null && stintFuel.fuelPerLapL > 0
      ? (levelReading.value as number) / stintFuel.fuelPerLapL
      : null
  const fuelLaps = fuelLapsRaw === null
    ? unavailableField('--')
    : field(fuelLapsRaw.toFixed(1), fuelLapsRaw, false, false, 'primary')
  const fuelPerLap = stintFuel.fuelPerLapL === null
    ? unavailableField('--')
    : field(stintFuel.fuelPerLapL.toFixed(2), stintFuel.fuelPerLapL, false, false, 'primary')

  const stintLap = stintFuel.stintLap === null
    ? unavailableField('--')
    : field(String(stintFuel.stintLap), stintFuel.stintLap, false, false, 'primary')
  const stintClock = stintFuel.stintElapsedMs === null
    ? unavailableField('--:--')
    : field(rc03FormatStintClock(stintFuel.stintElapsedMs), stintFuel.stintElapsedMs, false, false, 'primary')

  const projectedPitLapRaw =
    stintFuel.stintLap !== null && fuelLapsRaw !== null ? stintFuel.stintLap + Math.floor(fuelLapsRaw) : null
  const projectedPitLap = projectedPitLapRaw === null
    ? unavailableField('--')
    : field(String(projectedPitLapRaw), projectedPitLapRaw, false, false, 'primary')
  const averagePace = stintFuel.averageLapSec === null
    ? unavailableField('--:--.---')
    : field(rc03FormatLapTime(stintFuel.averageLapSec), stintFuel.averageLapSec, false, false, 'primary')

  return {
    gear,
    delta,
    speed,
    ribbon: buildRc03Ribbon(base.rpmRatio, base.rpmFresh, options.overRevActive ?? false),
    rpmRaw: base.rpmFresh && finite(base.rpm.raw) ? base.rpm.raw : null,
    rpmFresh: base.rpmFresh,
    vitals,
    fuelLaps,
    fuelLevel,
    fuelBar,
    fuelPerLap,
    fuelTrend: stintFuel.burnTrend,
    stintLap,
    stintClock,
    pitWindowLaps: field(String(pitWindowLaps), pitWindowLaps, false, false, 'primary'),
    projectedPitLap,
    averagePace,
    criticalFresh: base.criticalFresh,
    auxFresh
  }
}

/** The alert-layer inputs, all gated on freshness so a frozen frame can never engage anything. */
export function rc03AlertInputForModel(
  model: Rc03DashboardModel,
  stintFuel: Rc03StintFuelReading,
  nowMs: number,
  pitWindowLaps = RC03_PIT_WINDOW_LAPS
): Rc03AlertInput {
  const oil = model.vitals.find((entry) => entry.channel === 'oilPressure')
  const water = model.vitals.find((entry) => entry.channel === 'waterTemp')
  return {
    nowMs,
    fuelLapsRemaining: model.fuelLaps.unavailable || !finite(model.fuelLaps.raw) ? null : model.fuelLaps.raw,
    pitWindowLaps,
    fuelModelSeq: stintFuel.fuelModelSeq,
    oilPressureBar: oil && !oil.unavailable && finite(oil.raw) ? oil.raw : null,
    rpm: model.rpmRaw,
    waterTempC: water && !water.unavailable && finite(water.raw) ? water.raw : null
  }
}

export function rc03RibbonDescription(ribbon: Rc03Ribbon): string {
  if (ribbon.unavailable) return 'Engine RPM ribbon unavailable'
  return `Engine RPM ribbon at ${Math.round(ribbon.fill * 100)} percent${ribbon.tone === 'danger' ? ', over-rev active' : ''}`
}

export function rc03FuelBarDescription(bar: Rc03FuelBar, level: Rc01Field): string {
  if (bar.unavailable) return 'Fuel level unavailable because the fuel model is uncalibrated'
  return `Fuel level ${level.value} litres, ${Math.round(bar.fill * 100)} percent of tank capacity`
}

export type { Rc01Field as Rc03Field }
