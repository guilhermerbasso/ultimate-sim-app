import type { CarLeftRightState, TelemetrySnapshot } from '../../../../shared/telemetry'
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
 * RC-04 "Box Now" core — the pit entry / stop / exit sequence.
 *
 * The live-only ingest buffer, identity binding, mock/replay refusal, out-of-order and
 * same-timestamp guards and the shared channel receipts are reused verbatim from the RC-01
 * core: they are telemetry-truth machinery, not RC-01 styling, and a fork would silently
 * drift. This module adds only what RC-04's packet requires and the shared layer does not
 * have: the five-step phase state machine, the tighter pit-lane channel budgets, the
 * speed-versus-limit safety bar and the three state-gated pit alerts.
 *
 * RC-01's own alert layer (over-rev, delta cliff, zero cross) is deliberately NOT advanced
 * here: packet section 11.4 suppresses shift decisions inside the pit sequence, and none of
 * RC-01's thresholds match this packet's pit-lane triggers.
 */

/** Packet section 11.1 native canvas, and the section 12.1 app reflow target. */
export const RC04_NATIVE_WIDTH_PX = 800
export const RC04_NATIVE_HEIGHT_PX = 480
export const RC04_NATIVE_TOLERANCE_PX = 1
export const RC04_APP_WIDTH_PX = 1024
export const RC04_APP_HEIGHT_PX = 600

export const RC04_PHONE_MIN_WIDTH_PX = 360
export const RC04_PHONE_MAX_WIDTH_PX = 480
export const RC04_PHONE_MIN_HEIGHT_PX = 650
export const RC04_LANDSCAPE_MIN_WIDTH_PX = 650
export const RC04_LANDSCAPE_MIN_HEIGHT_PX = 360
export const RC04_LANDSCAPE_MAX_HEIGHT_PX = 480

// ─────────────────────────────────────────────────────────── phase state machine

/** Packet sections 4 and 11.1: APPROACH -> LIMITER -> BOX -> SERVICE -> RELEASE. */
export const RC04_PHASES = ['approach', 'limiter', 'box', 'service', 'release'] as const
export type Rc04PitPhase = (typeof RC04_PHASES)[number]

export const RC04_PHASE_LABELS: Readonly<Record<Rc04PitPhase, string>> = {
  approach: 'APPROACH',
  limiter: 'LIMITER',
  box: 'BOX',
  service: 'SERVICE',
  release: 'RELEASE'
}

/**
 * Packet section 11.5: the phase advances on a display-switch event as well as on the
 * observed pit signals, so a crew macro can drive the checklist when a provider is quiet.
 * A dedicated event name keeps it from colliding with RC-03's brightness display switch.
 */
export const RC04_PHASE_EVENT = 'racecon:pit-phase'

// ─────────────────────────────────────────────────────────── channels

/**
 * Packet section 16 freshness budgets for the channels RC-01 does not carry at RC-04's
 * cadence. Pit speed is the tightest because it is the input to the safety-critical
 * decision, and the gear lookup is faster still. The pit-limiter bool keeps RC-01's own
 * 300 ms receipt: it is the same ECU channel and re-declaring it would fork the budget.
 */
export const RC04_CHANNEL_STALE_MS = {
  pitSpeed: 100,
  gear: 50,
  fuel: 500,
  proximity: 50,
  /** Event-driven feeds: an enum that only republishes on change still has to age out. */
  gridSlot: 1_000,
  serviceRemaining: 500,
  fuelTarget: 1_000,
  tyreService: 1_000
} as const

export type Rc04AuxChannel = keyof typeof RC04_CHANNEL_STALE_MS

/** A pit feed quieter than this can no longer drive the phase ribbon. */
export const RC04_PIT_FEED_STALE_MS = 1_000

/**
 * Packet section 16: the pit limit is a CONFIGURED datum, not a telemetry channel — no
 * provider in this app publishes one. 60 km/h is the app's own configured default (see
 * `shared/spotter.ts`), and it is clamped to the same 20..120 km/h range.
 */
export const RC04_DEFAULT_PIT_LIMIT_KMH = 60
export const RC04_MIN_PIT_LIMIT_KMH = 20
export const RC04_MAX_PIT_LIMIT_KMH = 120

/**
 * image-qa-v1 residual 1: the bar fill is arithmetic, never traced from the reference.
 * The limit rule sits at a fixed 75 % of the track, so the full scale follows the
 * configured limit and the geometry is stable at any limit.
 */
export const RC04_LIMIT_RULE_FRACTION = 0.75

/** Packet section 14 Attention: amber only in the band just below the limit. */
export const RC04_NEAR_LIMIT_MARGIN_KMH = 3

// ─────────────────────────────────────────────────────────── alert thresholds

/** Packet section 15, pit overspeed: engage 100 ms, release 400 ms, clear below limit-2. */
export const RC04_OVERSPEED_ENGAGE_MS = 100
export const RC04_OVERSPEED_RELEASE_MS = 400
export const RC04_OVERSPEED_CLEAR_MARGIN_KMH = 2
/** Packet section 15, limiter mismatch: 300 ms in the LIMITER phase with the limiter off. */
export const RC04_LIMITER_MISMATCH_ENGAGE_MS = 300
/** Packet section 15, unsafe release: event trigger with a 500 ms minimum display. */
export const RC04_UNSAFE_RELEASE_MIN_VISIBLE_MS = 500
/** RaceCon alarm-layer rule: an alarm cannot be acknowledged before it has been seen. */
export const RC04_ALARM_MIN_VISIBLE_MS = 500

export type Rc04CompactMode = 'phone' | 'landscape' | 'standard'
export type Rc04BarTone = 'unknown' | 'normal' | 'caution' | 'danger'
export type Rc04ActionTone = 'primary' | 'info' | 'danger' | 'signature'

export interface Rc04PhaseStep {
  phase: Rc04PitPhase
  label: string
  index: number
  /** Exactly one step is active, and only the active one is enlarged. */
  active: boolean
  /** Steps already completed in this sequence, collapsed but marked. */
  done: boolean
}

export interface Rc04SpeedBar {
  /** speed / fullScale, clamped to 0..1. Zero whenever the speed source cannot be trusted. */
  fill: number
  /** The limit datum drawn as an explicit rule, always RC04_LIMIT_RULE_FRACTION. */
  limitFraction: number
  fullScaleKmh: number
  tone: Rc04BarTone
  unavailable: boolean
  /** Trigger-only: true only while the debounced overspeed alert is latched. */
  alert: boolean
}

export interface Rc04Limiter {
  value: boolean | null
  stale: boolean
  unavailable: boolean
  /** 'ON' / 'OFF', or the packet's dash when the ECU channel is absent. */
  label: string
  /** Trigger-only: true only while the debounced limiter-mismatch alert is latched. */
  mismatch: boolean
}

export interface Rc04CrewCorner extends Rc01Field {
  corner: 'LF' | 'RF' | 'LR' | 'RR'
}

export interface Rc04ActionLine {
  text: string
  tone: Rc04ActionTone
}

export interface Rc04DashboardModel {
  phase: Rc04PitPhase
  steps: readonly Rc04PhaseStep[]
  /** True only while a real pit feed is driving the ribbon. */
  phaseLive: boolean
  pitSpeed: Rc01Field
  pitLimit: Rc01Field
  pitLimitKmh: number
  speedBar: Rc04SpeedBar
  limiter: Rc04Limiter
  gear: Rc01Field
  fuel: Rc01Field
  stint: Rc01Field
  gridSlot: Rc01Field
  /** SERVICE-phase countdown; bound to the provider's remaining pit-service work timer. */
  serviceRemaining: Rc01Field
  /** 1024x600 service summary: measured elapsed stop time since the observed box entry. */
  stopClock: Rc01Field
  /** 1024x600 service summary: corners the crew actually flagged for service. */
  tyresChanged: Rc01Field
  /** 1024x600 crew column: the fuel the crew is set to add. */
  fuelTarget: Rc01Field
  /** 1024x600 crew column: per-corner wheel service, never mirrored between corners. */
  crew: readonly Rc04CrewCorner[]
  proximity: Rc01Field
  action: Rc04ActionLine
  /**
   * Packet section 11.4: shift LEDs are suppressed for the whole pit sequence and return
   * only after the RELEASE-to-track blend. RC-04 draws no LEDs itself, so this is the
   * signal other surfaces consume — it is never a decoration.
   */
  shiftLedsSuppressed: boolean
  /**
   * Tyre temperature, water temperature and delta to best are packet section 10 tertiary
   * channels with no zone in the 11.1 grammar or the 12.1 reflow (section 18 forbids a tyre
   * mandala and a lap-delta hero outright). They are omitted from the model rather than
   * having their freshness derived from a proxy channel.
   */
  criticalFresh: Readonly<Record<Rc01ChannelName, boolean>>
  auxFresh: Readonly<Record<Rc04AuxChannel, boolean>>
}

export interface Rc04PhoneGeometry {
  inset: number
  ribbonTop: number
  ribbonHeight: number
  barTop: number
  barHeight: number
  limiterTop: number
  limiterHeight: number
  serviceTop: number
  serviceHeight: number
  actionTop: number
  actionHeight: number
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

/** mm:ss since a marker, or the packet's dash placeholder without one. */
export function rc04FormatClock(elapsedMs: number | null): string {
  if (elapsedMs === null || !Number.isFinite(elapsedMs) || elapsedMs < 0) return '--:--'
  const totalSeconds = Math.floor(elapsedMs / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds - minutes * 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/**
 * Packet section 16: the gear comes from the ECU gear channel via the gear lookup table and
 * is NEVER derived from RPM or speed. An absent channel is a grey '-', never a blank.
 */
export function rc04DisplayGear(gear: number | null): string {
  if (gear === null || !Number.isFinite(gear)) return '-'
  if (gear < 0) return 'R'
  if (gear === 0) return 'N'
  return String(Math.trunc(gear))
}

/** The configured pit limit, clamped to the same range the app's spotter accepts. */
export function rc04ResolvePitLimitKmh(limit: number | undefined): number {
  if (!finite(limit)) return RC04_DEFAULT_PIT_LIMIT_KMH
  return Math.min(RC04_MAX_PIT_LIMIT_KMH, Math.max(RC04_MIN_PIT_LIMIT_KMH, limit))
}

/** image-qa-v1 residual 1: fill is `speed / fullScale`, with the rule pinned at 75 %. */
export function rc04BarFullScaleKmh(limitKmh: number): number {
  return rc04ResolvePitLimitKmh(limitKmh) / RC04_LIMIT_RULE_FRACTION
}

// ─────────────────────────────────────────────────────────── layout resolution

export function rc04LayoutForContentBox(width: number, height: number): 'native' | 'app' | 'compact' {
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return 'app'
  if (
    Math.abs(width - RC04_NATIVE_WIDTH_PX) <= RC04_NATIVE_TOLERANCE_PX &&
    Math.abs(height - RC04_NATIVE_HEIGHT_PX) <= RC04_NATIVE_TOLERANCE_PX
  ) {
    return 'native'
  }
  if (width >= RC04_APP_WIDTH_PX - 1 && height >= RC04_APP_HEIGHT_PX - 1) return 'app'
  return 'compact'
}

export function rc04CompactModeForContentBox(width: number, height: number): Rc04CompactMode {
  if (rc04LayoutForContentBox(width, height) !== 'compact') return 'standard'
  if (
    width >= RC04_PHONE_MIN_WIDTH_PX &&
    width <= RC04_PHONE_MAX_WIDTH_PX &&
    height >= RC04_PHONE_MIN_HEIGHT_PX &&
    height / width >= 1.5
  ) {
    return 'phone'
  }
  if (
    width >= RC04_LANDSCAPE_MIN_WIDTH_PX &&
    height >= RC04_LANDSCAPE_MIN_HEIGHT_PX &&
    height <= RC04_LANDSCAPE_MAX_HEIGHT_PX &&
    width / height >= 1.5
  ) {
    return 'landscape'
  }
  return 'standard'
}

/**
 * Portrait geometry. The procedural order — ribbon, safety bar, limiter, service, action —
 * is the thesis, so portrait stacks the same five zones instead of re-ranking them, and
 * every value is derived from the measured content box so the stack stays contained.
 */
export function rc04PhoneGeometryForContentBox(width: number, height: number): Rc04PhoneGeometry | null {
  if (rc04CompactModeForContentBox(width, height) !== 'phone') return null
  const inset = 12
  const gap = 10
  const ribbonTop = 12
  const ribbonHeight = Math.round(height * 0.1)
  const barTop = ribbonTop + ribbonHeight + gap
  const barHeight = Math.round(height * 0.28)
  const limiterTop = barTop + barHeight + gap
  const limiterHeight = Math.round(height * 0.14)
  const serviceTop = limiterTop + limiterHeight + gap
  const serviceHeight = Math.round(height * 0.2)
  const actionTop = serviceTop + serviceHeight + gap
  const actionHeight = Math.max(56, height - actionTop - inset)
  return {
    inset,
    ribbonTop,
    ribbonHeight,
    barTop,
    barHeight,
    limiterTop,
    limiterHeight,
    serviceTop,
    serviceHeight,
    actionTop,
    actionHeight
  }
}

// ─────────────────────────────────────────────────────────── channel extraction

/**
 * Every RC-04 channel is read straight from its own source field. Nothing is modelled,
 * mirrored or substituted, and every accessor returns null rather than a plausible stand-in.
 */
export function rc04AuxChannelValue(
  snapshot: TelemetrySnapshot,
  channel: Rc04AuxChannel
): number | string | null {
  switch (channel) {
    case 'pitSpeed':
      return finite(snapshot.speedKmh) && snapshot.speedKmh >= 0 ? snapshot.speedKmh : null
    case 'gear':
      return finite(snapshot.gear) ? Math.trunc(snapshot.gear) : null
    case 'fuel':
      return finite(snapshot.fuelLiters) && snapshot.fuelLiters >= 0 ? snapshot.fuelLiters : null
    case 'proximity':
      return typeof snapshot.carLeftRight === 'string' ? snapshot.carLeftRight : null
    // Packet section 16: never assume a grid slot. A running position is NOT a grid slot, so
    // the channel exists only while the sim is genuinely inside a start sequence.
    case 'gridSlot':
      return isStartSequence(snapshot) && finite(snapshot.position) && snapshot.position >= 1
        ? Math.trunc(snapshot.position)
        : null
    case 'serviceRemaining':
      return finite(snapshot.repairTimeSec) && snapshot.repairTimeSec >= 0 ? snapshot.repairTimeSec : null
    case 'fuelTarget':
      return finite(snapshot.pitFuelToAddL) && snapshot.pitFuelToAddL >= 0 ? snapshot.pitFuelToAddL : null
    case 'tyreService':
      return Array.isArray(snapshot.pitServiceFlags) ? snapshot.pitServiceFlags.join(',') : null
  }
}

function isStartSequence(snapshot: TelemetrySnapshot): boolean {
  return (
    snapshot.sessionState === 'getInCar' ||
    snapshot.sessionState === 'warmup' ||
    snapshot.sessionState === 'paradeLaps'
  )
}

/** True only when the provider actually reports pit service work in progress. */
export function rc04ServiceActive(snapshot: TelemetrySnapshot | null | undefined): boolean | null {
  if (!snapshot) return null
  const flags = Array.isArray(snapshot.pitServiceFlags) ? snapshot.pitServiceFlags : null
  const stop = typeof snapshot.pitStopActive === 'boolean' ? snapshot.pitStopActive : null
  const refuel = typeof snapshot.refuelServiceActive === 'boolean' ? snapshot.refuelServiceActive : null
  if (flags === null && stop === null && refuel === null) return null
  return Boolean(stop) || Boolean(refuel) || (flags?.length ?? 0) > 0
}

/**
 * Receipts for RC-04's own channels, with exactly RC-01's semantics: a receipt is written
 * only when the channel actually reports, so a channel that falls silent ages out and
 * degrades to its dash state instead of freezing on its last value.
 *
 * This is deliberately NOT a second ingest buffer. It is only ever fed frames the shared
 * RC-01 buffer has already accepted, so identity binding and mock/replay refusal stay in
 * one place.
 */
export class Rc04AuxBuffer {
  private channelReceipts = new Map<Rc04AuxChannel, Rc01ChannelReceipt>()

  clone(): Rc04AuxBuffer {
    const next = new Rc04AuxBuffer()
    next.channelReceipts = new Map(this.channelReceipts)
    return next
  }

  reset(): void {
    this.channelReceipts = new Map()
  }

  ingest(snapshot: TelemetrySnapshot | null | undefined, receivedAt = rc01MonotonicNow()): void {
    if (!snapshot || !snapshot.connected || !finite(snapshot.timestamp)) return
    const safeReceiptAt = finite(receivedAt) && receivedAt >= 0 ? receivedAt : rc01MonotonicNow()
    for (const channel of Object.keys(RC04_CHANNEL_STALE_MS) as Rc04AuxChannel[]) {
      const value = rc04AuxChannelValue(snapshot, channel)
      if (value === null) continue
      this.channelReceipts.set(
        channel,
        Object.freeze({ value, snapshotTimestamp: snapshot.timestamp, receivedAt: safeReceiptAt })
      )
    }
  }

  receipts(): ReadonlyMap<Rc04AuxChannel, Rc01ChannelReceipt> {
    return new Map(this.channelReceipts)
  }
}

export function createRc04AuxReceipts(
  snapshot: TelemetrySnapshot,
  receivedAt = rc01MonotonicNow()
): ReadonlyMap<Rc04AuxChannel, Rc01ChannelReceipt> {
  const buffer = new Rc04AuxBuffer()
  buffer.ingest(snapshot, receivedAt)
  return buffer.receipts()
}

function auxReading(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc04AuxChannel, Rc01ChannelReceipt>,
  channel: Rc04AuxChannel,
  nowMs: number
): { value: number | string | null; stale: boolean } {
  const raw = snapshot ? rc04AuxChannelValue(snapshot, channel) : null
  const receipt = receipts.get(channel)
  if (raw === null || !receipt) return { value: null, stale: false }
  const stale = rc01ReceiptAgeMs(receipt, nowMs) > RC04_CHANNEL_STALE_MS[channel]
  return { value: stale ? null : raw, stale }
}

function numericAux(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc04AuxChannel, Rc01ChannelReceipt>,
  channel: Rc04AuxChannel,
  nowMs: number
): { value: number | null; stale: boolean } {
  const reading = auxReading(snapshot, receipts, channel, nowMs)
  return { value: typeof reading.value === 'number' ? reading.value : null, stale: reading.stale }
}

// ─────────────────────────────────────────────────────────── phase tracker

export interface Rc04PitSequenceSample {
  onPitRoad: boolean | null
  pitLimiter: boolean | null
  inPitStall: boolean | null
  serviceActive: boolean | null
  receivedAt: number
}

export interface Rc04PitSequenceReading {
  phase: Rc04PitPhase
  /** True between an observed pit-road entry and the RELEASE-to-track blend. */
  sequenceActive: boolean
  /** True once the blend back to the track has actually been observed. */
  blendComplete: boolean
  stintMarked: boolean
  stintElapsedMs: number | null
  stopElapsedMs: number | null
  /** True only while the pit feed is fresh enough to drive the ribbon. */
  feedLive: boolean
  /** Steps whose entry event has actually been observed in this sequence. */
  reachedIndex: number
}

export function createRc04PitSequenceReading(): Rc04PitSequenceReading {
  return {
    phase: 'approach',
    sequenceActive: false,
    blendComplete: false,
    stintMarked: false,
    stintElapsedMs: null,
    stopElapsedMs: null,
    feedLive: false,
    reachedIndex: 0
  }
}

/**
 * The pit sequence is a state machine advanced by OBSERVED events only — a limiter engage,
 * a stall arrival, a service signal, a service completion and the pit-road exit — plus the
 * packet 11.5 display-switch override. Nothing advances on a timer, nothing is inferred
 * from a phase the machine did not actually see, and the sequence only ever moves forward
 * until the blend completes and resets it.
 *
 * The stint marker follows the same rule as every other RC packet: it is set only at an
 * observed pit-road exit, so a mid-session mount never invents a stint start.
 */
export class Rc04PitSequenceTracker {
  private phaseIndex = 0
  private sequenceActive = false
  private blendComplete = false

  private lastOnPitRoad: boolean | null = null
  private lastServiceActive: boolean | null = null
  private lastReceivedAt: number | null = null

  private stintStartMs: number | null = null
  private boxEnteredMs: number | null = null

  clone(): Rc04PitSequenceTracker {
    const next = new Rc04PitSequenceTracker()
    next.phaseIndex = this.phaseIndex
    next.sequenceActive = this.sequenceActive
    next.blendComplete = this.blendComplete
    next.lastOnPitRoad = this.lastOnPitRoad
    next.lastServiceActive = this.lastServiceActive
    next.lastReceivedAt = this.lastReceivedAt
    next.stintStartMs = this.stintStartMs
    next.boxEnteredMs = this.boxEnteredMs
    return next
  }

  /** A source or session discontinuity invalidates the whole sequence and the stint marker. */
  reset(): void {
    this.phaseIndex = 0
    this.sequenceActive = false
    this.blendComplete = false
    this.lastOnPitRoad = null
    this.lastServiceActive = null
    this.lastReceivedAt = null
    this.stintStartMs = null
    this.boxEnteredMs = null
  }

  /** Packet 11.5: a display-switch event may snap the ribbon to an explicit step. */
  setPhase(phase: Rc04PitPhase, atMs: number): void {
    const index = RC04_PHASES.indexOf(phase)
    if (index < 0) return
    this.phaseIndex = index
    this.sequenceActive = true
    this.blendComplete = false
    if (index >= 2 && this.boxEnteredMs === null && finite(atMs)) this.boxEnteredMs = atMs
  }

  private advanceTo(index: number, atMs: number): void {
    if (index <= this.phaseIndex) return
    this.phaseIndex = index
    if (index >= 2 && this.boxEnteredMs === null && finite(atMs)) this.boxEnteredMs = atMs
  }

  ingest(sample: Rc04PitSequenceSample): void {
    const { onPitRoad, pitLimiter, inPitStall, serviceActive, receivedAt } = sample
    const at = finite(receivedAt) ? receivedAt : 0

    if (typeof onPitRoad === 'boolean') {
      this.lastReceivedAt = at
      if (onPitRoad && this.lastOnPitRoad !== true) {
        // An observed pit-road entry opens a fresh sequence at step one.
        this.phaseIndex = 0
        this.sequenceActive = true
        this.blendComplete = false
        this.boxEnteredMs = null
        this.lastServiceActive = null
      }
      if (!onPitRoad && this.lastOnPitRoad === true) {
        // The RELEASE-to-track blend: the only thing that marks a stint start, and the only
        // thing that lets the shift LEDs come back.
        this.stintStartMs = at
        this.phaseIndex = 0
        this.sequenceActive = false
        this.blendComplete = true
        this.boxEnteredMs = null
        this.lastServiceActive = null
      }
      this.lastOnPitRoad = onPitRoad
    }

    if (!this.sequenceActive) {
      if (typeof serviceActive === 'boolean') this.lastServiceActive = serviceActive
      return
    }

    if (pitLimiter === true) this.advanceTo(1, at)
    if (inPitStall === true) this.advanceTo(2, at)
    if (serviceActive === true) this.advanceTo(3, at)
    // Service completion is an observed falling edge, never an assumption that it "must" be done.
    if (this.phaseIndex === 3 && serviceActive === false && this.lastServiceActive === true) {
      this.advanceTo(4, at)
    }
    if (typeof serviceActive === 'boolean') this.lastServiceActive = serviceActive
  }

  private feedFresh(nowMs: number): boolean {
    return this.lastReceivedAt !== null && finite(nowMs) && nowMs - this.lastReceivedAt <= RC04_PIT_FEED_STALE_MS
  }

  reading(nowMs: number): Rc04PitSequenceReading {
    const marked = this.stintStartMs !== null
    return {
      phase: RC04_PHASES[this.phaseIndex],
      sequenceActive: this.sequenceActive,
      blendComplete: this.blendComplete,
      stintMarked: marked,
      stintElapsedMs: marked && finite(nowMs) ? Math.max(0, nowMs - (this.stintStartMs as number)) : null,
      stopElapsedMs:
        this.boxEnteredMs !== null && finite(nowMs) ? Math.max(0, nowMs - (this.boxEnteredMs as number)) : null,
      feedLive: this.feedFresh(nowMs),
      reachedIndex: this.phaseIndex
    }
  }
}

/** Packet 11.5 display switch: an unrecognised payload never moves the checklist. */
export function rc04PhaseFromEvent(detail: unknown): Rc04PitPhase | null {
  const raw =
    typeof detail === 'string'
      ? detail
      : detail && typeof detail === 'object' && 'phase' in detail
        ? (detail as { phase?: unknown }).phase
        : undefined
  return typeof raw === 'string' && (RC04_PHASES as readonly string[]).includes(raw) ? (raw as Rc04PitPhase) : null
}

export function rc04PhaseSteps(phase: Rc04PitPhase, reachedIndex: number): readonly Rc04PhaseStep[] {
  const activeIndex = RC04_PHASES.indexOf(phase)
  return RC04_PHASES.map((step, index) => ({
    phase: step,
    label: RC04_PHASE_LABELS[step],
    index,
    active: index === activeIndex,
    done: index < Math.min(activeIndex, reachedIndex)
  }))
}

// ─────────────────────────────────────────────────────────── trigger-only alerts

export interface Rc04AlertState {
  /** Packet 15: armed only in the LIMITER phase; 100 ms engage, 400 ms release. */
  overspeed: {
    active: boolean
    pendingSinceMs: number | null
    recoverySinceMs: number | null
    visibleSinceMs: number | null
    acknowledged: boolean
  }
  /** Packet 15: 300 ms in the LIMITER phase with the limiter reported off. */
  limiterMismatch: {
    active: boolean
    pendingSinceMs: number | null
    visibleSinceMs: number | null
    /** Increments once per engage so the badge pulses exactly once, never continuously. */
    pulseSeq: number
    acknowledged: boolean
  }
  /** Packet 15: RELEASE-phase proximity hazard, event trigger, 500 ms minimum display. */
  unsafeRelease: { active: boolean; minimumVisibleUntilMs: number }
}

export interface Rc04AlertInput {
  nowMs: number
  phase: Rc04PitPhase
  /** Pit speed in km/h; null when the speed source is missing or stale. */
  pitSpeedKmh: number | null
  pitLimitKmh: number
  /** ECU pit-limiter status; null when the channel is absent or stale. */
  limiter: boolean | null
  /** Spotter proximity zone; null when there is no radar/proximity channel. */
  proximity: CarLeftRightState | null
}

export function createRc04AlertState(): Rc04AlertState {
  return {
    overspeed: { active: false, pendingSinceMs: null, recoverySinceMs: null, visibleSinceMs: null, acknowledged: false },
    limiterMismatch: { active: false, pendingSinceMs: null, visibleSinceMs: null, pulseSeq: 0, acknowledged: false },
    unsafeRelease: { active: false, minimumVisibleUntilMs: 0 }
  }
}

export function cloneRc04AlertState(state: Rc04AlertState): Rc04AlertState {
  return {
    overspeed: { ...state.overspeed },
    limiterMismatch: { ...state.limiterMismatch },
    unsafeRelease: { ...state.unsafeRelease }
  }
}

/**
 * Every alert is silent until its own trigger fires, is armed only in the phase the packet
 * gates it to, carries the packet's debounce and hysteresis, has an explicit clear
 * condition, and is unlatched the moment its input goes missing or stale.
 *
 * A stale speed source unlatches the overspeed alert but must NOT be read as "under the
 * limit": the bar renders its unknown dash state rather than the green resting state, which
 * is where packet section 15's "do not assume safe" rule is actually discharged.
 */
export function advanceRc04Alerts(state: Rc04AlertState, input: Rc04AlertInput): Rc04AlertState {
  const nowMs = finite(input.nowMs) ? input.nowMs : 0
  const next = cloneRc04AlertState(state)
  const limit = rc04ResolvePitLimitKmh(input.pitLimitKmh)

  // ── Pit overspeed: armed only while the LIMITER phase is the active step.
  const overspeedArmed = input.phase === 'limiter' && input.pitSpeedKmh !== null
  if (!overspeedArmed) {
    next.overspeed = {
      active: false,
      pendingSinceMs: null,
      recoverySinceMs: null,
      visibleSinceMs: null,
      acknowledged: false
    }
  } else {
    const speed = input.pitSpeedKmh as number
    const over = speed > limit
    if (next.overspeed.active) {
      if (speed < limit - RC04_OVERSPEED_CLEAR_MARGIN_KMH) {
        const recoverySinceMs = next.overspeed.recoverySinceMs ?? nowMs
        next.overspeed.recoverySinceMs = recoverySinceMs
        if (nowMs - recoverySinceMs >= RC04_OVERSPEED_RELEASE_MS) {
          next.overspeed = {
            active: false,
            pendingSinceMs: null,
            recoverySinceMs: null,
            visibleSinceMs: null,
            acknowledged: false
          }
        }
      } else {
        next.overspeed.recoverySinceMs = null
      }
    } else if (over) {
      const pendingSinceMs = next.overspeed.pendingSinceMs ?? nowMs
      if (nowMs - pendingSinceMs >= RC04_OVERSPEED_ENGAGE_MS) {
        next.overspeed = {
          active: true,
          pendingSinceMs: null,
          recoverySinceMs: null,
          visibleSinceMs: nowMs,
          acknowledged: false
        }
      } else {
        next.overspeed.pendingSinceMs = pendingSinceMs
      }
    } else {
      next.overspeed.pendingSinceMs = null
    }
  }

  // ── Limiter mismatch: never fires on an absent channel, because "unknown" is not "off".
  const mismatchArmed = input.phase === 'limiter' && input.limiter !== null
  if (!mismatchArmed) {
    next.limiterMismatch = {
      active: false,
      pendingSinceMs: null,
      visibleSinceMs: null,
      pulseSeq: next.limiterMismatch.pulseSeq,
      acknowledged: false
    }
  } else if (next.limiterMismatch.active) {
    if (input.limiter === true) {
      next.limiterMismatch = {
        active: false,
        pendingSinceMs: null,
        visibleSinceMs: null,
        pulseSeq: next.limiterMismatch.pulseSeq,
        acknowledged: false
      }
    }
  } else if (input.limiter === false) {
    const pendingSinceMs = next.limiterMismatch.pendingSinceMs ?? nowMs
    if (nowMs - pendingSinceMs >= RC04_LIMITER_MISMATCH_ENGAGE_MS) {
      next.limiterMismatch = {
        active: true,
        pendingSinceMs: null,
        visibleSinceMs: nowMs,
        pulseSeq: next.limiterMismatch.pulseSeq + 1,
        acknowledged: false
      }
    } else {
      next.limiterMismatch.pendingSinceMs = pendingSinceMs
    }
  } else {
    next.limiterMismatch.pendingSinceMs = null
  }

  // ── Unsafe release: an event, held for a minimum display time so it cannot flash past.
  const hazardArmed = input.phase === 'release' && input.proximity !== null
  const hazard = hazardArmed && input.proximity !== 'clear'
  if (!hazardArmed) {
    next.unsafeRelease = { active: false, minimumVisibleUntilMs: 0 }
  } else if (hazard) {
    next.unsafeRelease = {
      active: true,
      minimumVisibleUntilMs: Math.max(next.unsafeRelease.minimumVisibleUntilMs, nowMs + RC04_UNSAFE_RELEASE_MIN_VISIBLE_MS)
    }
  } else if (next.unsafeRelease.active && nowMs >= next.unsafeRelease.minimumVisibleUntilMs) {
    next.unsafeRelease = { active: false, minimumVisibleUntilMs: 0 }
  }

  return next
}

/**
 * Packet section 14 gives the critical state a resettable alarm. Acknowledging only silences
 * the alarm LINE: the red bar, the badge state and the imperative action text stay until the
 * packet's own clear condition is met, so an alert can never be dismissed while it is true.
 * An alarm cannot be acknowledged before its minimum display time has elapsed.
 */
export function acknowledgeRc04Alarms(state: Rc04AlertState, nowMs: number): Rc04AlertState {
  const next = cloneRc04AlertState(state)
  const settled = (visibleSinceMs: number | null): boolean =>
    visibleSinceMs !== null && finite(nowMs) && nowMs - visibleSinceMs >= RC04_ALARM_MIN_VISIBLE_MS
  if (next.overspeed.active && settled(next.overspeed.visibleSinceMs)) next.overspeed.acknowledged = true
  if (next.limiterMismatch.active && settled(next.limiterMismatch.visibleSinceMs)) {
    next.limiterMismatch.acknowledged = true
  }
  return next
}

/** A stale or unavailable input can never leave an alert latched on. */
export function clearInvalidRc04Alerts(state: Rc04AlertState, model: Rc04DashboardModel): Rc04AlertState {
  const next = cloneRc04AlertState(state)
  if (model.pitSpeed.unavailable || model.pitSpeed.stale || model.phase !== 'limiter') {
    next.overspeed = {
      active: false,
      pendingSinceMs: null,
      recoverySinceMs: null,
      visibleSinceMs: null,
      acknowledged: false
    }
  }
  if (model.limiter.unavailable || model.limiter.stale || model.phase !== 'limiter') {
    next.limiterMismatch = {
      active: false,
      pendingSinceMs: null,
      visibleSinceMs: null,
      pulseSeq: next.limiterMismatch.pulseSeq,
      acknowledged: false
    }
  }
  if (model.proximity.unavailable || model.proximity.stale || model.phase !== 'release') {
    next.unsafeRelease = { active: false, minimumVisibleUntilMs: 0 }
  }
  return next
}

export function rc04AlarmLines(state: Rc04AlertState): readonly string[] {
  const lines: string[] = []
  if (state.overspeed.active && !state.overspeed.acknowledged) lines.push('PIT OVERSPEED')
  if (state.limiterMismatch.active && !state.limiterMismatch.acknowledged) lines.push('LIMITER OFF')
  return lines
}

/**
 * Packet section 11.1: exactly one imperative line for the current step. The alert layer
 * overrides it — the packet's own wording for the critical case — and otherwise it is the
 * plain verb for the active phase (section 19).
 */
export function rc04ActionLine(
  phase: Rc04PitPhase,
  alerts: Rc04AlertState,
  releaseAcknowledged = false
): Rc04ActionLine {
  if (alerts.overspeed.active) return { text: 'LIFT - PIT LIMIT', tone: 'danger' }
  if (alerts.limiterMismatch.active) return { text: 'ENGAGE LIMITER', tone: 'danger' }
  switch (phase) {
    case 'approach':
      return { text: 'PIT ENTRY - LIFT', tone: 'signature' }
    case 'limiter':
      return { text: 'HOLD LIMITER', tone: 'primary' }
    case 'box':
      return { text: 'STOP IN BOX', tone: 'primary' }
    case 'service':
      return { text: 'HOLD BRAKE', tone: 'primary' }
    case 'release':
      return releaseAcknowledged ? { text: 'GO - LANE CLEAR', tone: 'info' } : { text: 'RELEASE WHEN CLEAR', tone: 'info' }
  }
}

// ─────────────────────────────────────────────────────────── dashboard model

export interface Rc04ModelOptions {
  sequence?: Rc04PitSequenceReading
  alerts?: Rc04AlertState
  pitLimitKmh?: number
  releaseAcknowledged?: boolean
}

const CREW_CORNERS = [
  { corner: 'LF', flag: 'lf' },
  { corner: 'RF', flag: 'rf' },
  { corner: 'LR', flag: 'lr' },
  { corner: 'RR', flag: 'rr' }
] as const

const PROXIMITY_LABELS: Readonly<Record<CarLeftRightState, string>> = {
  clear: 'CLEAR',
  left: 'LEFT',
  right: 'RIGHT',
  both: 'BOTH'
}

/**
 * Projects the shared RC-01 telemetry model into RC-04's presentation and adds the pit-lane
 * channels. Nothing is invented, estimated or mirrored: every unavailable channel renders
 * its packet dash state, the safety bar is computed as `speed / fullScale` so the drawn fill
 * can never disagree with the printed number, and no derived value exists unless every
 * channel it is bound to is real and fresh.
 */
export function createRc04DashboardModel(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc01ChannelName, Rc01ChannelReceipt> = new Map(),
  auxReceipts: ReadonlyMap<Rc04AuxChannel, Rc01ChannelReceipt> = new Map(),
  nowMs = rc01MonotonicNow(),
  options: Rc04ModelOptions = {}
): Rc04DashboardModel {
  const base: Rc01DashboardModel = createRc01DashboardModel(snapshot, receipts, nowMs)
  const safeSnapshot = snapshot && snapshot.connected ? snapshot : null
  const sequence = options.sequence ?? createRc04PitSequenceReading()
  const alerts = options.alerts ?? createRc04AlertState()
  const pitLimitKmh = rc04ResolvePitLimitKmh(options.pitLimitKmh)
  const fullScaleKmh = rc04BarFullScaleKmh(pitLimitKmh)

  const auxFresh = Object.fromEntries(
    (Object.keys(RC04_CHANNEL_STALE_MS) as Rc04AuxChannel[]).map((channel) => [
      channel,
      auxReading(safeSnapshot, auxReceipts, channel, nowMs).value !== null
    ])
  ) as Record<Rc04AuxChannel, boolean>

  // ── Pit speed vs the configured limit. Packet 16: never estimate; dash if the source is stale.
  const speedReading = numericAux(safeSnapshot, auxReceipts, 'pitSpeed', nowMs)
  const pitSpeed =
    speedReading.value === null
      ? field('--', null, speedReading.stale, true, 'muted')
      : field(String(Math.round(speedReading.value)), speedReading.value, false, false, 'primary')
  const pitLimit = field(String(Math.round(pitLimitKmh)), pitLimitKmh, false, false, 'primary')

  const speedBar: Rc04SpeedBar = {
    fill:
      speedReading.value === null ? 0 : Math.min(1, Math.max(0, speedReading.value / fullScaleKmh)),
    limitFraction: RC04_LIMIT_RULE_FRACTION,
    fullScaleKmh,
    // An unusable speed source is 'unknown', never 'normal': the packet forbids assuming safe.
    tone:
      speedReading.value === null
        ? 'unknown'
        : speedReading.value > pitLimitKmh
          ? 'danger'
          : speedReading.value >= pitLimitKmh - RC04_NEAR_LIMIT_MARGIN_KMH
            ? 'caution'
            : 'normal',
    unavailable: speedReading.value === null,
    alert: alerts.overspeed.active
  }

  // ── Pit limiter: the shared RC-01 receipt, because it is the same ECU channel.
  const limiter: Rc04Limiter = {
    value: base.pitLimiter.value,
    stale: base.pitLimiter.stale,
    unavailable: base.pitLimiter.unavailable,
    label: base.pitLimiter.unavailable ? '--' : base.pitLimiter.value ? 'ON' : 'OFF',
    mismatch: alerts.limiterMismatch.active
  }

  // ── Gear: the ECU channel at RC-04's own 50 ms budget, never derived from RPM or speed.
  const gearReading = numericAux(safeSnapshot, auxReceipts, 'gear', nowMs)
  const gear =
    gearReading.value === null
      ? field('-', null, gearReading.stale, true, 'muted')
      : field(rc04DisplayGear(gearReading.value), gearReading.value, false, false, 'primary')

  // ── Fuel: a litre figure is legitimate only against a calibrated tank model.
  const fuelReading = numericAux(safeSnapshot, auxReceipts, 'fuel', nowMs)
  const capacity =
    finite(safeSnapshot?.fuelCapacityLiters) && (safeSnapshot?.fuelCapacityLiters as number) > 0
      ? (safeSnapshot?.fuelCapacityLiters as number)
      : null
  const fuel =
    fuelReading.value === null || capacity === null
      ? field('--', null, fuelReading.stale, true, 'muted')
      : field(String(Math.round(fuelReading.value)), fuelReading.value, false, false, 'primary')

  const stint =
    sequence.stintElapsedMs === null
      ? unavailableField('--:--')
      : field(rc04FormatClock(sequence.stintElapsedMs), sequence.stintElapsedMs, false, false, 'primary')

  // ── Grid slot: exactly the two-character placeholder, never letter-spaced (image-qa note 3).
  const gridReading = numericAux(safeSnapshot, auxReceipts, 'gridSlot', nowMs)
  const gridSlot =
    gridReading.value === null
      ? field('--', null, gridReading.stale, true, 'muted')
      : field(String(Math.trunc(gridReading.value)), gridReading.value, false, false, 'primary')

  const serviceReading = numericAux(safeSnapshot, auxReceipts, 'serviceRemaining', nowMs)
  const serviceRemaining =
    serviceReading.value === null
      ? field('--:--', null, serviceReading.stale, true, 'muted')
      : field(rc04FormatClock(serviceReading.value * 1_000), serviceReading.value, false, false, 'primary')

  const stopClock =
    sequence.stopElapsedMs === null
      ? unavailableField('--:--')
      : field(rc04FormatClock(sequence.stopElapsedMs), sequence.stopElapsedMs, false, false, 'primary')

  const fuelTargetReading = numericAux(safeSnapshot, auxReceipts, 'fuelTarget', nowMs)
  const fuelTarget =
    fuelTargetReading.value === null
      ? field('--', null, fuelTargetReading.stale, true, 'muted')
      : field(fuelTargetReading.value.toFixed(1), fuelTargetReading.value, false, false, 'primary')

  // ── Crew column: per-corner service flags. A missing flag list dashes every corner
  //    independently; one corner is never mirrored onto another.
  const serviceFlagReading = auxReading(safeSnapshot, auxReceipts, 'tyreService', nowMs)
  const serviceFlags =
    typeof serviceFlagReading.value === 'string'
      ? serviceFlagReading.value.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean)
      : null
  const crew: Rc04CrewCorner[] = CREW_CORNERS.map(({ corner, flag }) => {
    if (serviceFlags === null) {
      return { corner, ...field('--', null, serviceFlagReading.stale, true, 'muted') }
    }
    const serviced = serviceFlags.includes(flag)
    return { corner, ...field(serviced ? 'SET' : 'NO', serviced ? flag : null, false, false, serviced ? 'good' : 'muted') }
  })
  const tyresChanged =
    serviceFlags === null
      ? field('--', null, serviceFlagReading.stale, true, 'muted')
      : field(
          `${serviceFlags.filter((entry) => CREW_CORNERS.some(({ flag }) => flag === entry)).length}/4`,
          serviceFlags.length,
          false,
          false,
          'primary'
        )

  // ── Spotter proximity: 'NO DATA' when there is no radar channel, never a guessed neighbour.
  const proximityReading = auxReading(safeSnapshot, auxReceipts, 'proximity', nowMs)
  const proximityValue =
    typeof proximityReading.value === 'string' && proximityReading.value in PROXIMITY_LABELS
      ? (proximityReading.value as CarLeftRightState)
      : null
  const proximity =
    proximityValue === null
      ? field('NO DATA', null, proximityReading.stale, true, 'muted')
      : field(
          PROXIMITY_LABELS[proximityValue],
          proximityValue,
          false,
          false,
          proximityValue === 'clear' ? 'good' : 'bad'
        )

  return {
    phase: sequence.phase,
    steps: rc04PhaseSteps(sequence.phase, sequence.reachedIndex),
    phaseLive: sequence.feedLive,
    pitSpeed,
    pitLimit,
    pitLimitKmh,
    speedBar,
    limiter,
    gear,
    fuel,
    stint,
    gridSlot,
    serviceRemaining,
    stopClock,
    tyresChanged,
    fuelTarget,
    crew,
    proximity,
    action: rc04ActionLine(sequence.phase, alerts, options.releaseAcknowledged ?? false),
    shiftLedsSuppressed: sequence.sequenceActive,
    criticalFresh: base.criticalFresh,
    auxFresh
  }
}

/** The alert-layer inputs, all gated on freshness so a frozen frame can never engage anything. */
export function rc04AlertInputForModel(model: Rc04DashboardModel, nowMs: number): Rc04AlertInput {
  return {
    nowMs,
    phase: model.phase,
    pitSpeedKmh: model.pitSpeed.unavailable || model.pitSpeed.stale || !finite(model.pitSpeed.raw)
      ? null
      : model.pitSpeed.raw,
    pitLimitKmh: model.pitLimitKmh,
    limiter: model.limiter.unavailable || model.limiter.stale ? null : model.limiter.value,
    proximity:
      model.proximity.unavailable || model.proximity.stale || typeof model.proximity.raw !== 'string'
        ? null
        : (model.proximity.raw as CarLeftRightState)
  }
}

export function rc04SpeedBarDescription(bar: Rc04SpeedBar, speed: Rc01Field, limit: Rc01Field): string {
  if (bar.unavailable) return 'Pit speed unavailable; limit state unknown'
  return `Pit speed ${speed.value} of ${limit.value} kilometres per hour, ${
    bar.tone === 'danger' ? 'over the pit limit' : 'under the pit limit'
  }`
}

export function rc04PhaseDescription(model: Rc04DashboardModel): string {
  return `Pit phase ${RC04_PHASE_LABELS[model.phase]}, step ${RC04_PHASES.indexOf(model.phase) + 1} of ${
    RC04_PHASES.length
  }`
}

export type { Rc01Field as Rc04Field }
