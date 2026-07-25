import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import {
  RC01_CHANNEL_STALE_MS,
  type Rc01AcceptedSample,
  type Rc01AlertState,
  type Rc01ChannelName,
  type Rc01ChannelReceipt,
  type Rc01DashboardModel,
  type Rc01Field,
  type Rc01Tyre,
  createRc01DashboardModel,
  rc01ShiftThresholdForGear
} from './raceconRc01Core'

/**
 * RC-02 "Purple Lap" core.
 *
 * The live-only ingest buffer, channel receipts, freshness rules, over-rev hysteresis and
 * delta-history segmentation are reused verbatim from the RC-01 core: they are telemetry
 * truth machinery, not RC-01 styling, and forking them would let the two dashboards drift.
 * This module adds only what RC-02's packet requires and RC-01 does not have: a nine-bar
 * shift row, widget-measured sector splits, a source-bound predicted lap, the personal-best
 * pace alert and the bidirectional delta-spine geometry.
 */

export const RC02_LED_COUNT = 9

/** Packet section 11.1 native canvas, and the 1024x600 app reflow target. */
export const RC02_NATIVE_WIDTH_PX = 800
export const RC02_NATIVE_HEIGHT_PX = 480
export const RC02_NATIVE_TOLERANCE_PX = 1
export const RC02_APP_WIDTH_PX = 1024
export const RC02_APP_HEIGHT_PX = 600

export const RC02_PHONE_MIN_WIDTH_PX = 360
export const RC02_PHONE_MAX_WIDTH_PX = 480
export const RC02_PHONE_MIN_HEIGHT_PX = 650
export const RC02_LANDSCAPE_MIN_WIDTH_PX = 650
export const RC02_LANDSCAPE_MIN_HEIGHT_PX = 360
export const RC02_LANDSCAPE_MAX_HEIGHT_PX = 480

/** Packet section 15: sector loss fires above +0.15 s and latches for 3 s at the crossing. */
export const RC02_SECTOR_LOSS_THRESHOLD_SEC = 0.15
export const RC02_SECTOR_LOSS_HOLD_MS = 3_000
/** Packet section 15: PB pace engages after 400 ms below -0.05 s and clears once the lap falls behind. */
export const RC02_PB_PACE_THRESHOLD_SEC = 0.05
export const RC02_PB_PACE_DEBOUNCE_MS = 400
/** Symmetric full-scale of the bidirectional spine, in seconds either side of the datum. */
export const RC02_SPINE_FULL_SCALE_SEC = 1
/**
 * Widget-measured intermediate sector boundaries as a fraction of lap distance. The third
 * sector is closed by the start-finish crossing itself, because real `lapDistPct` is [0, 1)
 * and therefore never reaches 1.
 */
export const RC02_SECTOR_BOUNDARIES = [1 / 3, 2 / 3] as const
/** A timing feed quieter than this can no longer support a live sector reading. */
export const RC02_SECTOR_FEED_STALE_MS = 1_000
/** Backward lap-clock movement beyond this is a pit/session restart, not provider jitter. */
export const RC02_LAP_CLOCK_RESTART_TOLERANCE_SEC = 0.25

export type Rc02SectorIndex = 0 | 1 | 2
export type Rc02LedTone = 'dark' | 'info' | 'good' | 'caution' | 'danger' | 'signature'
export type Rc02CompactMode = 'phone' | 'landscape' | 'standard'

export interface Rc02Led {
  index: number
  active: boolean
  tone: Rc02LedTone
}

export interface Rc02Sector {
  index: Rc02SectorIndex
  label: 'S1' | 'S2' | 'S3'
  /** Measured sector time for the lap in progress, seconds; null until the sector is crossed. */
  timeSec: number | null
  /** Signed delta against the driver's own best measured sector; null without a reference. */
  deltaSec: number | null
  completed: boolean
  /** Trigger-only: true only while a real loss latch is held. */
  lossActive: boolean
  unavailable: boolean
  value: string
}

export interface Rc02SpineGeometry {
  /** 'up' fills above the datum (time gained), 'down' below it (time lost). */
  direction: 'up' | 'down' | 'flat'
  /** 0..1 of the half-track length; 0 when the delta is unavailable. */
  fill: number
  unavailable: boolean
}

export interface Rc02DashboardModel {
  gear: Rc01Field
  rpm: Rc01Field
  speed: Rc01Field
  /**
   * Note the sign convention: RC-01's field carries an inherited `direction` where a gain is
   * `'down'`. RC-02 deliberately drops it and reads direction only from `spine.direction`,
   * where a gain fills upward per packet section 11.1.
   */
  delta: Rc01Field
  best: Rc01Field
  /** Source-bound: best lap plus delta to best. Unavailable unless both are valid and fresh. */
  predicted: Rc01Field
  /**
   * Current and last lap time are tertiary on-demand fields in the packet and are deliberately
   * NOT surfaced by RC-02. They are omitted from the model rather than derived from a proxy
   * channel, because inferring their freshness from another channel would mirror a channel.
   */
  tyres: readonly Rc01Tyre[]
  sectors: readonly Rc02Sector[]
  spine: Rc02SpineGeometry
  rpmRatio: number | null
  rpmFresh: boolean
  shiftGear: number | null
  shiftThreshold: number
  leds: readonly Rc02Led[]
  criticalFresh: Readonly<Record<Rc01ChannelName, boolean>>
}

export interface Rc02PbPaceState {
  active: boolean
  pendingSinceMs: number | null
}

export interface Rc02PhoneGeometry {
  inset: number
  headTop: number
  headHeight: number
  spineTop: number
  spineHeight: number
  bottomTop: number
  bottomHeight: number
}

/** Recent completed laps, newest first, used only by the 1024x600 sector-history ladder. */
export interface Rc02LapSectors {
  lapOrdinal: number
  sectors: readonly (number | null)[]
  totalSec: number | null
}

export const RC02_LAP_HISTORY_LIMIT = 5

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function field(value: string, raw: number | string | null, stale = false, unavailable = false, tone: Rc01Field['tone'] = 'primary'): Rc01Field {
  return { value, raw, stale, unavailable, tone }
}

/** mm:ss.mmm, or the packet's dash placeholder when there is nothing real to show. */
export function rc02FormatLapTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '--:--.---'
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  return `${minutes}:${rest.toFixed(3).padStart(6, '0')}`
}

export function rc02FormatSignedSeconds(seconds: number | null, digits = 3): string {
  if (seconds === null || !Number.isFinite(seconds)) return '--'
  const sign = seconds > 0 ? '+' : seconds < 0 ? '-' : ''
  return `${sign}${Math.abs(seconds).toFixed(digits)}`
}

/**
 * Nine discrete shift bars. Bands mirror the packet's blue -> green -> amber ramp; the ninth
 * bar is the cap. Over-rev turns the cap red, and personal-best pace tints it violet at the
 * shift point only. Both are trigger states, never decoration.
 */
export function buildRc02LedStates(
  rpmRatio: number | null,
  rpmFresh: boolean,
  overRevActive = false,
  gear: number | null = null,
  pbPaceActive = false
): readonly Rc02Led[] {
  const threshold = rc02ShiftThresholdForGear(gear)
  const usable = rpmFresh && rpmRatio !== null && Number.isFinite(rpmRatio)
  const span = Math.max(0.0001, threshold - 0.55)
  const progress = usable ? Math.min(1, Math.max(0, (rpmRatio - 0.55) / span)) : 0
  const litCount = usable ? Math.min(RC02_LED_COUNT, Math.floor(progress * RC02_LED_COUNT)) : 0
  const atShiftPoint = usable && rpmRatio >= threshold

  return Array.from({ length: RC02_LED_COUNT }, (_unused, index) => {
    const active = index < litCount
    if (!active) return { index, active: false, tone: 'dark' as const }
    const isCap = index === RC02_LED_COUNT - 1
    if (isCap && overRevActive) return { index, active: true, tone: 'danger' as const }
    if (isCap && pbPaceActive && atShiftPoint) return { index, active: true, tone: 'signature' as const }
    const tone: Rc02LedTone = index < 3 ? 'info' : index < 6 ? 'good' : index < 8 ? 'caution' : 'danger'
    return { index, active: true, tone }
  })
}

/** Gear-aware shift point; the physics are shared with RC-01. */
export function rc02ShiftThresholdForGear(gear: number | null): number {
  return rc01ShiftThresholdForGear(gear)
}

export function rc02LayoutForContentBox(width: number, height: number): 'native' | 'app' | 'compact' {
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return 'app'
  if (
    Math.abs(width - RC02_NATIVE_WIDTH_PX) <= RC02_NATIVE_TOLERANCE_PX &&
    Math.abs(height - RC02_NATIVE_HEIGHT_PX) <= RC02_NATIVE_TOLERANCE_PX
  ) {
    return 'native'
  }
  if (width >= RC02_APP_WIDTH_PX - 1 && height >= RC02_APP_HEIGHT_PX - 1) return 'app'
  return 'compact'
}

export function rc02CompactModeForContentBox(width: number, height: number): Rc02CompactMode {
  if (rc02LayoutForContentBox(width, height) !== 'compact') return 'standard'
  if (
    width >= RC02_PHONE_MIN_WIDTH_PX &&
    width <= RC02_PHONE_MAX_WIDTH_PX &&
    height >= RC02_PHONE_MIN_HEIGHT_PX &&
    height / width >= 1.5
  ) {
    return 'phone'
  }
  if (
    width >= RC02_LANDSCAPE_MIN_WIDTH_PX &&
    height >= RC02_LANDSCAPE_MIN_HEIGHT_PX &&
    height <= RC02_LANDSCAPE_MAX_HEIGHT_PX &&
    width / height >= 1.5
  ) {
    return 'landscape'
  }
  return 'standard'
}

/**
 * Bidirectional spine geometry against a symmetric scale, so equal time gained and equal
 * time lost always produce equal fill lengths from a datum at the exact middle of the track.
 */
export function rc02SpineGeometry(delta: Rc01Field): Rc02SpineGeometry {
  if (delta.unavailable || delta.stale || !finite(delta.raw)) {
    return { direction: 'flat', fill: 0, unavailable: true }
  }
  const value = delta.raw
  const fill = Math.min(1, Math.abs(value) / RC02_SPINE_FULL_SCALE_SEC)
  if (value < 0) return { direction: 'up', fill, unavailable: false }
  if (value > 0) return { direction: 'down', fill, unavailable: false }
  return { direction: 'flat', fill: 0, unavailable: false }
}

interface Rc02SectorSlot {
  timeSec: number | null
  deltaSec: number | null
  completed: boolean
  latchedUntilMs: number
}

function emptySlot(): Rc02SectorSlot {
  return { timeSec: null, deltaSec: null, completed: false, latchedUntilMs: 0 }
}

export interface Rc02SectorSample {
  lapDistPct: number | null
  currentLapTimeSec: number | null
  receivedAt: number
}

/**
 * Sector splits have no dedicated telemetry channel, so RC-02 measures them itself between
 * observed lap-distance crossings and compares every sector only against the driver's own
 * best sector measured between the identical pair of crossings.
 *
 * Nothing is ever fabricated. A sector is recorded only when BOTH of its bounding crossings
 * were actually observed on the same lap, so a mid-lap mount, an out-lap fragment or a pit
 * reset can never write a truncated time into the reference bests. Sector three is closed by
 * the start-finish crossing itself, because real `lapDistPct` is [0, 1) and never reaches 1.
 */
export class Rc02SectorTracker {
  private slots: Rc02SectorSlot[] = [emptySlot(), emptySlot(), emptySlot()]
  private bests: Array<number | null> = [null, null, null]
  /** 0 and 1 are the intermediate crossings; 2 means the lap is waiting for start-finish. */
  private nextBoundary = 0
  private sectorStartSec: number | null = null
  /** False while the sector in progress began somewhere other than an observed crossing. */
  private sectorStartObserved = false
  private lastLapDistPct: number | null = null
  private lastLapTimeSec: number | null = null
  private lastReceivedAt: number | null = null
  private hasFeed = false
  private completedLaps: Rc02LapSectors[] = []
  private lapOrdinal = 0

  clone(): Rc02SectorTracker {
    const next = new Rc02SectorTracker()
    next.slots = this.slots.map((slot) => ({ ...slot }))
    next.bests = [...this.bests]
    next.nextBoundary = this.nextBoundary
    next.sectorStartSec = this.sectorStartSec
    next.sectorStartObserved = this.sectorStartObserved
    next.lastLapDistPct = this.lastLapDistPct
    next.lastLapTimeSec = this.lastLapTimeSec
    next.lastReceivedAt = this.lastReceivedAt
    next.hasFeed = this.hasFeed
    next.completedLaps = this.completedLaps.map((lap) => ({ ...lap, sectors: [...lap.sectors] }))
    next.lapOrdinal = this.lapOrdinal
    return next
  }

  /** A source or session discontinuity invalidates every measured sector and every reference. */
  reset(): void {
    this.slots = [emptySlot(), emptySlot(), emptySlot()]
    this.bests = [null, null, null]
    this.nextBoundary = 0
    this.sectorStartSec = null
    this.sectorStartObserved = false
    this.lastLapDistPct = null
    this.lastLapTimeSec = null
    this.lastReceivedAt = null
    this.hasFeed = false
    this.completedLaps = []
    this.lapOrdinal = 0
  }

  /** Only a lap whose three sectors were all genuinely measured enters the history ladder. */
  private archiveLap(): void {
    if (!this.slots.every((slot) => slot.completed && slot.timeSec !== null)) return
    const sectors = this.slots.map((slot) => slot.timeSec)
    const totalSec = (sectors as number[]).reduce((sum, value) => sum + value, 0)
    this.lapOrdinal += 1
    this.completedLaps = [{ lapOrdinal: this.lapOrdinal, sectors, totalSec }, ...this.completedLaps].slice(
      0,
      RC02_LAP_HISTORY_LIMIT
    )
  }

  /** Closes the sector in progress. The measurement is discarded unless its start was observed. */
  private closeSector(index: Rc02SectorIndex, atLapTimeSec: number, receivedAt: number): void {
    if (!this.sectorStartObserved || this.sectorStartSec === null) return
    const sectorTime = atLapTimeSec - this.sectorStartSec
    if (!(sectorTime > 0)) return
    const best = this.bests[index]
    const deltaSec = best === null ? null : sectorTime - best
    this.slots[index] = {
      timeSec: sectorTime,
      deltaSec,
      completed: true,
      latchedUntilMs:
        deltaSec !== null && deltaSec > RC02_SECTOR_LOSS_THRESHOLD_SEC ? receivedAt + RC02_SECTOR_LOSS_HOLD_MS : 0
    }
    this.bests[index] = best === null ? sectorTime : Math.min(best, sectorTime)
  }

  /** Begins a lap that was joined mid-track: nothing before the next crossing is measurable. */
  private joinLapInProgress(lapDistPct: number, lapTimeSec: number): void {
    this.slots = [emptySlot(), emptySlot(), emptySlot()]
    this.sectorStartSec = lapTimeSec
    this.sectorStartObserved = false
    this.nextBoundary = lapDistPct < RC02_SECTOR_BOUNDARIES[0] ? 0 : lapDistPct < RC02_SECTOR_BOUNDARIES[1] ? 1 : 2
  }

  /** Begins a lap at an observed start-finish crossing, so sector one is measurable. */
  private beginLapAtStartFinish(lapTimeSec: number): void {
    this.slots = [emptySlot(), emptySlot(), emptySlot()]
    this.sectorStartSec = lapTimeSec
    this.sectorStartObserved = true
    this.nextBoundary = 0
  }

  ingest(sample: Rc02SectorSample): void {
    const { lapDistPct, currentLapTimeSec, receivedAt } = sample
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

    if (this.sectorStartSec === null) {
      this.joinLapInProgress(lapDistPct, currentLapTimeSec)
      this.lastLapDistPct = lapDistPct
      this.lastLapTimeSec = currentLapTimeSec
      return
    }

    // Start-finish crossing: close sector three with the pre-wrap lap clock, then start a lap.
    // This is checked BEFORE the rewind guard because a legitimate wrap also resets the clock.
    const wrapped = this.lastLapDistPct !== null && lapDistPct + 0.5 < this.lastLapDistPct
    if (wrapped) {
      if (this.nextBoundary === 2 && this.lastLapTimeSec !== null) {
        this.closeSector(2, this.lastLapTimeSec, receivedAt)
      }
      this.archiveLap()
      this.beginLapAtStartFinish(currentLapTimeSec)
      this.lastLapDistPct = lapDistPct
      this.lastLapTimeSec = currentLapTimeSec
      return
    }

    // A pit or session restart rewinds the lap clock without a wrap; jitter does not.
    if (currentLapTimeSec < this.sectorStartSec - RC02_LAP_CLOCK_RESTART_TOLERANCE_SEC) {
      this.joinLapInProgress(lapDistPct, currentLapTimeSec)
      this.lastLapDistPct = lapDistPct
      this.lastLapTimeSec = currentLapTimeSec
      return
    }

    // A sparse feed can skip past both intermediate crossings within one frame.
    while (this.nextBoundary < RC02_SECTOR_BOUNDARIES.length && lapDistPct >= RC02_SECTOR_BOUNDARIES[this.nextBoundary]) {
      this.closeSector(this.nextBoundary as Rc02SectorIndex, currentLapTimeSec, receivedAt)
      this.sectorStartSec = currentLapTimeSec
      this.sectorStartObserved = true
      this.nextBoundary += 1
    }

    this.lastLapDistPct = lapDistPct
    this.lastLapTimeSec = currentLapTimeSec
  }

  /** True only while the timing feed is recent enough to support a live sector reading. */
  private feedFresh(nowMs: number): boolean {
    return this.hasFeed && this.lastReceivedAt !== null && nowMs - this.lastReceivedAt <= RC02_SECTOR_FEED_STALE_MS
  }

  sectors(nowMs: number): readonly Rc02Sector[] {
    const labels = ['S1', 'S2', 'S3'] as const
    const fresh = this.feedFresh(nowMs)
    return this.slots.map((slot, index) => {
      const unavailable = !fresh || !slot.completed || slot.deltaSec === null
      return {
        index: index as Rc02SectorIndex,
        label: labels[index],
        timeSec: slot.timeSec,
        deltaSec: slot.deltaSec,
        completed: slot.completed,
        lossActive: !unavailable && nowMs < slot.latchedUntilMs,
        unavailable,
        value: unavailable ? '--' : rc02FormatSignedSeconds(slot.deltaSec)
      }
    })
  }

  hasTimingFeed(): boolean {
    return this.hasFeed
  }

  /** Recent completed laps, newest first. Empty until a full lap has actually been measured. */
  laps(): readonly Rc02LapSectors[] {
    return this.completedLaps
  }
}

/**
 * Portrait geometry for the phone breakpoint. Every value is derived from the measured
 * content box so the layout stays contained instead of relying on viewport media queries.
 */
export function rc02PhoneGeometryForContentBox(width: number, height: number): Rc02PhoneGeometry | null {
  if (rc02CompactModeForContentBox(width, height) !== 'phone') return null
  const inset = 12
  const headTop = 12
  const headHeight = Math.round(height * 0.19)
  const spineTop = headTop + headHeight + 16
  const bottomHeight = Math.round(height * 0.17)
  const bottomTop = height - bottomHeight - 16
  const spineHeight = Math.max(120, bottomTop - spineTop - 16)
  return { inset, headTop, headHeight, spineTop, spineHeight, bottomTop, bottomHeight }
}

export function createRc02PbPaceState(): Rc02PbPaceState {
  return { active: false, pendingSinceMs: null }
}

export interface Rc02PbPaceInput {
  nowMs: number
  /** Delta to the stored best, seconds; null whenever delta or best is missing or stale. */
  delta: number | null
}

/**
 * Trigger-only personal-best pace. Engages only after the predicted lap has stayed more than
 * 0.05 s under the stored best for 400 ms, and clears as soon as the lap falls behind the
 * best. A missing or stale best or delta clears it immediately: no violet without evidence.
 */
export function advanceRc02PbPace(state: Rc02PbPaceState, input: Rc02PbPaceInput): Rc02PbPaceState {
  const nowMs = finite(input.nowMs) ? input.nowMs : 0
  if (input.delta === null) return { active: false, pendingSinceMs: null }
  if (state.active) {
    return input.delta > 0 ? { active: false, pendingSinceMs: null } : { ...state }
  }
  if (input.delta < -RC02_PB_PACE_THRESHOLD_SEC) {
    const pendingSinceMs = state.pendingSinceMs ?? nowMs
    if (nowMs - pendingSinceMs >= RC02_PB_PACE_DEBOUNCE_MS) return { active: true, pendingSinceMs: null }
    return { active: false, pendingSinceMs }
  }
  return { active: false, pendingSinceMs: null }
}

export function rc02PbPaceDeltaForAlert(sample: Rc01AcceptedSample): number | null {
  return sample.delta !== null && sample.deltaFresh && sample.bestLap !== null && sample.bestLapFresh ? sample.delta : null
}

/** A stale or unavailable input can never leave the PB accent latched on. */
export function clearInvalidRc02PbPace(state: Rc02PbPaceState, model: Rc02DashboardModel): Rc02PbPaceState {
  if (model.delta.unavailable || model.delta.stale || model.best.unavailable || model.best.stale) {
    return { active: false, pendingSinceMs: null }
  }
  return state
}



/**
 * Projects the shared RC-01 telemetry model into RC-02's presentation, adding the
 * source-bound predicted lap, the lap clocks and the measured sectors. No channel is
 * invented, estimated or mirrored: every unavailable value renders as its dash state.
 */
export function createRc02DashboardModel(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc01ChannelName, Rc01ChannelReceipt> = new Map(),
  nowMs: number,
  sectors: readonly Rc02Sector[] = [],
  pbPaceActive = false,
  overRevActive = false
): Rc02DashboardModel {
  const base: Rc01DashboardModel = createRc01DashboardModel(snapshot, receipts, nowMs)

  // RC-02 owns its own numeric presentation: a bare signed delta (the unit is rendered as a
  // separate label on the spine) and a single-digit-minute lap format shared by PRED and BEST.
  // A stale delta shows the dash state so it can never contradict the spine, which treats a
  // stale delta as unavailable.
  const delta = {
    ...base.delta,
    value: base.delta.unavailable || base.delta.stale || !finite(base.delta.raw) ? '--' : rc02FormatSignedSeconds(base.delta.raw)
  }
  const bestRaw = finite(snapshot?.bestLapTimeSec) && (snapshot!.bestLapTimeSec as number) > 0 ? (snapshot!.bestLapTimeSec as number) : null
  const best: Rc01Field = base.best.unavailable || bestRaw === null
    ? field('--:--.---', null, false, true, 'muted')
    : { ...base.best, value: rc02FormatLapTime(bestRaw), raw: bestRaw }

  const deltaUsable = !delta.unavailable && !delta.stale && finite(delta.raw)
  const bestUsable = !best.unavailable && !best.stale && bestRaw !== null
  const predictedSec = deltaUsable && bestUsable ? bestRaw + (delta.raw as number) : null
  const predicted = predictedSec === null
    ? field('--:--.---', null, false, true, 'muted')
    : field(rc02FormatLapTime(predictedSec), predictedSec, false, false, pbPaceActive ? 'good' : 'primary')

  return {
    gear: base.gear,
    rpm: base.rpm,
    speed: base.speed,
    delta,
    best,
    predicted,
    tyres: base.tyres,
    sectors,
    spine: rc02SpineGeometry(delta),
    rpmRatio: base.rpmRatio,
    rpmFresh: base.rpmFresh,
    shiftGear: base.shiftGear,
    shiftThreshold: base.shiftThreshold,
    leds: buildRc02LedStates(base.rpmRatio, base.rpmFresh, overRevActive, base.shiftGear, pbPaceActive),
    criticalFresh: base.criticalFresh
  }
}

export function rc02SectorDescription(sector: Rc02Sector): string {
  if (sector.unavailable) return `${sector.label} split unavailable`
  const direction = (sector.deltaSec ?? 0) > 0 ? 'lost' : (sector.deltaSec ?? 0) < 0 ? 'gained' : 'equal to best'
  const magnitude = Math.abs(sector.deltaSec ?? 0).toFixed(3)
  const suffix = sector.lossActive ? '; sector loss alert active' : ''
  return direction === 'equal to best'
    ? `${sector.label} equal to best sector${suffix}`
    : `${sector.label} ${direction} ${magnitude} seconds versus best sector${suffix}`
}

export function rc02SpineDescription(model: Rc02DashboardModel): string {
  if (model.spine.unavailable) return 'Lap delta unavailable because no fresh valid best lap is available'
  const magnitude = Math.abs(finite(model.delta.raw) ? model.delta.raw : 0).toFixed(3)
  if (model.spine.direction === 'up') return `Ahead of best lap by ${magnitude} seconds`
  if (model.spine.direction === 'down') return `Behind best lap by ${magnitude} seconds`
  return 'Level with best lap'
}

export type { Rc01AlertState as Rc02SharedAlertState, Rc01Field as Rc02Field, Rc01Tyre as Rc02Tyre }
