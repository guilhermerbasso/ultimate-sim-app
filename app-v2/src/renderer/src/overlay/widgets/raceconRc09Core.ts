import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import {
  RC01_MIN_STREAM_FRESH_MS,
  type Rc01ChannelName,
  type Rc01ChannelReceipt,
  type Rc01DashboardModel,
  type Rc01Field,
  createRc01DashboardModel,
  rc01MonotonicNow,
  rc01ReceiptAgeMs,
  rc01ShiftThresholdForGear
} from './raceconRc01Core'

/**
 * RC-09 "Stage Time — Rally Stage & Co-Driver Timing" core.
 *
 * The live-only ingest buffer, identity binding, mock/replay refusal, out-of-order and
 * same-timestamp guards, the shared channel receipts and the gear-aware shift point are reused
 * verbatim from the RC-01 core: that is telemetry-truth machinery, not RC-01 styling, and a fork
 * would silently drift. This module adds only what RC-09's packet needs and the shared layer does
 * not have: the linear stage-timeline geometry, the roadbook-sourced co-driver pace note, the
 * measured note-severity profile that IS the 1024x600 expansion, the shallow shift arc that
 * packet 11.4 places at the support-strip edge, and the three waypoint/condition alerts.
 *
 * The rolling split is taken from the shared RC-01 model rather than re-read here: RC-01's delta
 * budget already matches the packet's "on split" cadence and RC-01 already refuses a delta without
 * a real stored reference lap, which is exactly packet section 16's "'--' if no split feed" rule.
 * Engine speed is likewise the shared `rpm` channel, whose 200 ms budget is packet 16's verbatim
 * "freeze value + gray tint when stale > 200 ms".
 *
 * Four packet contradictions are resolved by omission and each one is asserted by the test suite
 * through `RC09_PACKET_OMISSIONS`, so a later edit cannot quietly reintroduce them.
 */

/** Packet section 11.1 native canvas, and the section 12.1 app reflow target. */
export const RC09_NATIVE_WIDTH_PX = 800
export const RC09_NATIVE_HEIGHT_PX = 480
export const RC09_NATIVE_TOLERANCE_PX = 1
export const RC09_APP_WIDTH_PX = 1024
export const RC09_APP_HEIGHT_PX = 600

export const RC09_PHONE_MIN_WIDTH_PX = 360
export const RC09_PHONE_MAX_WIDTH_PX = 480
export const RC09_PHONE_MIN_HEIGHT_PX = 650
export const RC09_LANDSCAPE_MIN_WIDTH_PX = 650
export const RC09_LANDSCAPE_MIN_HEIGHT_PX = 360
export const RC09_LANDSCAPE_MAX_HEIGHT_PX = 480

export type Rc09CompactMode = 'phone' | 'landscape' | 'standard'
export type Rc09Layout = 'native' | 'app' | 'compact'

/**
 * The packet requirements this build deliberately does NOT render, with the reason. Each key is
 * asserted by the suite: the omission is part of the contract, not an oversight.
 *
 *  - `stageDistanceReadout` sections 10 and 11.1 make "distance-to-finish" secondary telemetry and
 *                    give the timeline "a moving distance marker", but section 16 defines NO
 *                    stage-distance or stage-position channel and the app carries none either.
 *                    `lapDistPct` / `lapDistanceM` are CIRCUIT lap-distance channels; binding one
 *                    to a rally stage would be exactly the mirroring section 16 forbids. The
 *                    readout is therefore the dash `--.- KM` on every frame, and the travelled
 *                    fill and the marker are withheld entirely. image-qa-v1 truth-table gap 1 is
 *                    explicit that the reference marker's 68 % position is composition only and
 *                    is not a governed value, so it is never traced — `rc09StageProgress` is the
 *                    arithmetic that would place it once a real channel exists.
 *  - `noteDistanceReadout` section 11.1 requires the note tile to carry "distance to it" and
 *                    section 15 requires the caution alert to show a "distance countdown", but
 *                    section 16 defines no distance-to-waypoint channel. Both surfaces render the
 *                    dash `--- M`; no metre value is ever synthesised from a note index.
 *  - `fuelReadout`   section 16 defines the Fuel level channel with a `--` dash state, but the
 *                    800x480 grammar of section 11.1 and the 1024x600 grammar of section 12.1
 *                    both allocate it NO zone. Per the tertiary-field rule it is omitted from the
 *                    model rather than surfaced or proxied: there is no `fuel` entry in
 *                    `RC09_CHANNEL_STALE_MS` and no fuel element in the widget or the stylesheet.
 *  - `signatureAccent` the `signature` token `#E8B84B` sits only 33 apart in RGB and 3.7 degrees
 *                    apart in hue from `caution` `#EEA82F` — indistinguishable at panel size and
 *                    unused in the approved reference. It is declared in `RC09_TOKENS` for
 *                    palette completeness and is bound to NO surface, so it can never carry
 *                    meaning. TOKEN-RETUNE RECOMMENDATION: RC-09's palette needs `signature`
 *                    moved at least ~25 degrees off `caution` (or dropped) before any future
 *                    revision may use it as a semantic accent.
 */
export const RC09_PACKET_OMISSIONS = Object.freeze({
  stageDistanceReadout:
    'packet 10/11.1 distance-to-finish: section 16 defines no stage-distance channel, so the readout dashes and the marker is withheld',
  noteDistanceReadout:
    'packet 11.1/15 distance-to-note: section 16 defines no distance-to-waypoint channel, so both surfaces dash',
  fuelReadout:
    'packet 16 fuel level: sections 11.1 and 12.1 allocate the channel no zone in either grammar',
  signatureAccent:
    'packet 11.3 signature #E8B84B is 3.7 degrees of hue from caution #EEA82F: bound to no surface, retune recommended'
})

/** Packet 11.3 tokens, verbatim. `signature` is declared and deliberately never bound. */
export const RC09_TOKENS = Object.freeze({
  bg: '#0C0A07',
  panel: '#1A140D',
  primary: '#F6EEDF',
  secondary: '#B0997C',
  info: '#46B5C0',
  normal: '#57C06A',
  caution: '#EEA82F',
  danger: '#E7452F',
  signature: '#E8B84B'
})

// ─────────────────────────────────────────────────────────── channels

/**
 * Packet section 16 freshness budgets for the channels RC-01 does not already carry with the
 * packet's own budget. Gear 50 ms, speed 100 ms and water 500 ms are verbatim. The stage timer is
 * declared "per sample", which is a TRANSPORT budget: the timing source republishes it on every
 * frame, so `RC01_MIN_STREAM_FRESH_MS` (the slowest provider cadence plus its jitter allowance) is
 * the point past which the source has genuinely fallen silent and the hero clock must degrade
 * instead of freezing on a number that is no longer true.
 *
 * The rolling split and the engine speed are NOT here: both come from the shared RC-01 model,
 * whose `delta` (250 ms, and refused outright without a stored reference lap) and `rpm` (200 ms)
 * budgets already are the packet's. There is deliberately no `fuel` entry
 * (`RC09_PACKET_OMISSIONS.fuelReadout`) and no `stageDistance` entry
 * (`RC09_PACKET_OMISSIONS.stageDistanceReadout`).
 */
export const RC09_CHANNEL_STALE_MS = {
  stageTimer: RC01_MIN_STREAM_FRESH_MS,
  speed: 100,
  gear: 50,
  water: 500
} as const

export type Rc09AuxChannel = keyof typeof RC09_CHANNEL_STALE_MS

/**
 * Packet section 16: speed greys as soon as it misses its 100 ms cadence but only collapses to
 * the three-character dash once the source has been quiet for more than 500 ms.
 */
export const RC09_SPEED_DASH_MS = 500

/** Packet 16 dash states, verbatim, so the widget and the suite cannot drift from the table. */
export const RC09_DASH = Object.freeze({
  stageTimer: '--:--.-',
  split: '--',
  speed: '---',
  gear: '-',
  water: '--',
  distanceToFinish: '--.- KM',
  noteDistance: '--- M'
})

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

/**
 * Every RC-09 aux channel is read straight from its own declared source. Nothing is modelled,
 * mirrored or substituted: the stage clock is the timing source's own measured elapsed time and is
 * never predicted, the gear never comes from RPM or speed, the speed never from RPM times a ratio,
 * and the coolant temperature strictly from its own sensor.
 */
export function rc09AuxChannelValue(
  snapshot: TelemetrySnapshot,
  channel: Rc09AuxChannel
): number | string | null {
  switch (channel) {
    // Packet 16: the timing source's MEASURED running time on the current timed segment. It is
    // never extrapolated between samples and never predicted forward to a finish line.
    case 'stageTimer':
      return finite(snapshot.currentLapTimeSec) && snapshot.currentLapTimeSec >= 0
        ? snapshot.currentLapTimeSec
        : null
    case 'speed':
      return finite(snapshot.speedKmh) && snapshot.speedKmh >= 0 ? snapshot.speedKmh : null
    case 'gear':
      return finite(snapshot.gear) && Number.isInteger(snapshot.gear) ? snapshot.gear : null
    case 'water':
      return finite(snapshot.waterTempC) ? snapshot.waterTempC : null
  }
  return null
}

/**
 * `RC09_PACKET_OMISSIONS.stageDistanceReadout`, expressed as a function so the absence is MEASURED
 * by the suite rather than asserted about a comment. There is no rally stage-distance source in
 * the app: `lapDistPct`, `lapDistanceM` and `trackLengthKm` describe a closed circuit lap, and
 * section 16 forbids mirroring one channel onto another, so this returns null for every snapshot.
 */
export function rc09StageDistanceM(_snapshot: TelemetrySnapshot | null): number | null {
  return null
}

/** The same, for the stage's total length: no rally stage definition exists in the app. */
export function rc09StageLengthM(_snapshot: TelemetrySnapshot | null): number | null {
  return null
}

/**
 * Normative override 4: the travelled fill and the marker are COMPUTED, never measured off the
 * approved render. This is that arithmetic. It is exercised by the suite and used by the widget,
 * and it yields null — an absent fill and an absent marker — for as long as the channels above
 * report nothing, which is the packet's own "never invent" rule applied to geometry.
 */
export function rc09StageProgress(distanceM: number | null, lengthM: number | null): number | null {
  if (!finite(distanceM) || !finite(lengthM) || lengthM <= 0 || distanceM < 0) return null
  return Math.min(1, Math.max(0, distanceM / lengthM))
}

// ─────────────────────────────────────────────────────────── co-driver roadbook

/**
 * Packet 11.5, 16 and 20: a pace note comes ONLY from a loaded roadbook and is never auto
 * generated. The app has no roadbook telemetry channel, so the single lawful source is an explicit
 * load by the crew — the same shape as a RaceCon GPS trigger firing at a roadbook coordinate. Until
 * that happens the note cue is BLANK, which is the packet's own unavailable rendering.
 */
export const RC09_ROADBOOK_EVENT = 'racecon:stage-time-roadbook'

/** Packet 13's "Caution acknowledge control": the macro-button that marks a caution seen. */
export const RC09_CAUTION_ACK_EVENT = 'racecon:stage-time-caution-ack'

/** The generic direction families the note glyph is drawn from. Never roadbook symbology. */
export const RC09_NOTE_GLYPHS = ['left', 'right', 'straight', 'hazard', 'none'] as const
export type Rc09NoteGlyph = (typeof RC09_NOTE_GLYPHS)[number]

export interface Rc09PaceNote {
  /** The co-driver's call, exactly as the roadbook delivered it. Never composed here. */
  text: string
  /** True only when the roadbook itself flags the waypoint as a hazard. */
  hazard: boolean
  /** Monotonic waypoint index; a new index is how "waypoint passed" is observed. */
  sequence: number
}

const NOTE_TEXT_PATTERN = /^[A-Z0-9 /+-]{1,16}$/

/**
 * Only a well-formed roadbook payload changes the display; anything else is ignored outright, so a
 * malformed feed leaves the cue blank rather than printing a fragment the co-driver never called.
 */
export function rc09PaceNoteFromEvent(detail: unknown): Rc09PaceNote | 'clear' | null {
  if (detail === null || detail === 'clear') return 'clear'
  const source =
    typeof detail === 'string'
      ? { note: detail }
      : typeof detail === 'object' && detail !== null
        ? (detail as { note?: unknown; text?: unknown; hazard?: unknown; sequence?: unknown })
        : null
  if (!source) return null
  const raw = typeof source.note === 'string' ? source.note : typeof source.text === 'string' ? source.text : null
  if (raw === null) return null
  const text = raw.trim().toUpperCase().replace(/\s+/g, ' ')
  if (!NOTE_TEXT_PATTERN.test(text)) return null
  const sequence = finite(source.sequence) && source.sequence >= 0 ? Math.trunc(source.sequence) : 0
  return { text, hazard: source.hazard === true, sequence }
}

/** The glyph family for a call, from its own leading direction word. Shape, never colour alone. */
export function rc09NoteGlyph(note: Rc09PaceNote | null): Rc09NoteGlyph {
  if (note === null) return 'none'
  if (note.hazard) return 'hazard'
  const head = note.text.split(' ')[0]
  if (head === 'LEFT' || head === 'L') return 'left'
  if (head === 'RIGHT' || head === 'R') return 'right'
  if (head === 'STRAIGHT' || head === 'ST') return 'straight'
  return 'hazard'
}

/**
 * The severity grade the co-driver actually called, 1..6, or null when the note carries no grade.
 * It is READ from the note text and never inferred from speed, gear or corner radius.
 */
export function rc09NoteSeverity(note: Rc09PaceNote | null): number | null {
  if (note === null) return null
  const match = /(?:^|\s)([1-6])(?:\s|$)/.exec(note.text)
  return match ? Number(match[1]) : null
}

export const RC09_NOTE_SEVERITY_MIN = 1
export const RC09_NOTE_SEVERITY_MAX = 6

// ─────────────────────────────────────────────────────────── measured note profile

/**
 * The packet 12.1 stage-profile strip is MEASURED from the notes the roadbook actually delivered,
 * in arrival order. A note the crew never received leaves a genuine gap rather than being
 * interpolated from its neighbours, and an ungraded call is recorded as ungraded rather than being
 * assigned a plausible severity.
 */
export const RC09_NOTE_HISTORY_LIMIT = 24

export interface Rc09NoteSegment {
  sequence: number
  text: string
  severity: number | null
  hazard: boolean
}

export class Rc09NoteHistory {
  private segments: Rc09NoteSegment[] = []

  clone(): Rc09NoteHistory {
    const next = new Rc09NoteHistory()
    next.segments = this.segments.map((segment) => ({ ...segment }))
    return next
  }

  reset(): void {
    this.segments = []
  }

  observe(note: Rc09PaceNote | null): void {
    if (note === null) return
    const last = this.segments.length > 0 ? this.segments[this.segments.length - 1] : null
    if (last && last.sequence === note.sequence && last.text === note.text) return
    this.segments.push({
      sequence: note.sequence,
      text: note.text,
      severity: rc09NoteSeverity(note),
      hazard: note.hazard
    })
    if (this.segments.length > RC09_NOTE_HISTORY_LIMIT) {
      this.segments = this.segments.slice(this.segments.length - RC09_NOTE_HISTORY_LIMIT)
    }
  }

  entries(): readonly Rc09NoteSegment[] {
    return this.segments.map((segment) => ({ ...segment }))
  }
}

export interface Rc09ProfileBar {
  sequence: number
  text: string
  severity: number | null
  hazard: boolean
  leftPercent: number
  widthPercent: number
  /** 0..100 of the strip height; an ungraded call keeps a flat neutral stub, never a guess. */
  heightPercent: number
}

/** Lays the measured note segments across the app-only strip as normalised percentages. */
export function rc09ProfileBars(entries: readonly Rc09NoteSegment[]): readonly Rc09ProfileBar[] {
  if (entries.length === 0) return []
  const width = 100 / entries.length
  const span = RC09_NOTE_SEVERITY_MAX - RC09_NOTE_SEVERITY_MIN
  return entries.map((entry, index) => ({
    sequence: entry.sequence,
    text: entry.text,
    severity: entry.severity,
    hazard: entry.hazard,
    leftPercent: round3(index * width),
    widthPercent: round3(width),
    heightPercent:
      entry.severity === null
        ? 12
        : round3(20 + ((RC09_NOTE_SEVERITY_MAX - entry.severity) / span) * 80)
  }))
}

// ─────────────────────────────────────────────────────────── shift arc

/** image-qa-v1 measured 9 discs (4 lit + 5 unlit) in the approved frame. */
export const RC09_LED_COUNT = 9

/**
 * Normative override 3. Packet 11.4 asks for an arc and the reference renders an almost flat row
 * (1 px rise), so a REAL shallow arc is drawn instead: a symmetric parabola whose outer discs sit
 * `RC09_LED_ARC_RISE_PCT` above the centre disc, expressed as a percentage of the LED strip's own
 * height so it survives every breakpoint. Packet 11.4 also places the arc at the SUPPORT-STRIP
 * edge, because the top of the canvas is owned by the stage timeline.
 */
export const RC09_LED_ARC_RISE_PCT = 18

export function rc09LedArcOffsetPct(index: number, count = RC09_LED_COUNT, rise = RC09_LED_ARC_RISE_PCT): number {
  if (!Number.isInteger(index) || index < 0 || index >= count || count < 2) return 0
  const normalised = (index / (count - 1)) * 2 - 1
  return round3(rise * normalised * normalised)
}

/** Half the horizontal span the arc occupies inside its strip, as a percentage of the strip. */
export const RC09_LED_ARC_HALF_SPAN_PCT = 44

/** Even horizontal spacing across the arc, so the disc pitch is arithmetic and not hand-placed. */
export function rc09LedLeftPct(index: number, count = RC09_LED_COUNT): number {
  if (!Number.isInteger(index) || index < 0 || index >= count || count < 2) return 50
  const normalised = (index / (count - 1)) * 2 - 1
  return round3(50 + normalised * RC09_LED_ARC_HALF_SPAN_PCT)
}

export type Rc09LedTone = 'dark' | 'normal' | 'caution' | 'danger'

export interface Rc09Led {
  index: number
  active: boolean
  tone: Rc09LedTone
  /** Percentage of the strip height this disc is lifted by the arc. */
  arcOffsetPct: number
}

/**
 * Packet 16's shift indicator: computed rpm / maxRpm, gear-aware, and DARK whenever the RPM
 * channel is invalid or stale. Packet 11.4 asks for a "rugged, high-visibility pattern", so the
 * ramp runs across the WHOLE band rather than only the top of it — on a stage the arc doubles as
 * a continuous engine-speed cue between note calls. The lit band is the `normal` token for the
 * first two thirds, so a routine stage frame contains no alert-family pixels at all; only the top
 * discs warm up, and only as a genuine shift cue driven by a fresh RPM reading.
 *
 * The approved reference measures 4 of 9 discs lit at rpm 3400 / maxRpm 7600 in gear 4, which is
 * exactly `floor(min(1, 0.4474 / 0.92) * 9)`; the arithmetic is the packet's, not the picture's.
 */
export function buildRc09LedStates(
  rpmRatio: number | null,
  rpmFresh: boolean,
  gear: number | null = null
): readonly Rc09Led[] {
  const threshold = rc01ShiftThresholdForGear(gear)
  const usable = rpmFresh && rpmRatio !== null && Number.isFinite(rpmRatio) && rpmRatio >= 0
  const progress = usable ? Math.min(1, Math.max(0, rpmRatio / Math.max(threshold, 0.0001))) : 0
  const litCount = usable ? Math.min(RC09_LED_COUNT, Math.floor(progress * RC09_LED_COUNT)) : 0
  return Array.from({ length: RC09_LED_COUNT }, (_unused, index) => {
    const arcOffsetPct = rc09LedArcOffsetPct(index)
    if (index >= litCount) return { index, active: false, tone: 'dark' as const, arcOffsetPct }
    const tone: Rc09LedTone = index < 6 ? 'normal' : index < 8 ? 'caution' : 'danger'
    return { index, active: true, tone, arcOffsetPct }
  })
}

/** The gear-aware shift point; the physics are shared with RC-01. */
export function rc09ShiftThresholdForGear(gear: number | null): number {
  return rc01ShiftThresholdForGear(gear)
}

// ─────────────────────────────────────────────────────────── zones

export interface Rc09Rect {
  left: number
  top: number
  width: number
  height: number
}

export type Rc09ZoneId = 'timeline' | 'clock' | 'split' | 'note' | 'splitNote' | 'profile' | 'support'

export type Rc09ZoneMap = Readonly<Partial<Record<Rc09ZoneId, Rc09Rect>>>

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function round3(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

/**
 * PACKET BUG, deliberately not reproduced. Section 11.1 gives the note cue tile y=220 h=120, which
 * ends at y=340 while the support strip starts at y=320 — a 20 px overlap on the native canvas, or
 * 4.2 percentage points. The tile is therefore 20.0 % tall (ending at 65.8 %, exactly where
 * image-qa-v1 truth-table gap 3 records the approved reference resolving it) instead of the
 * packet's 25.0 %. Every other 11.1 coordinate is used verbatim.
 */
export const RC09_NOTE_TILE_HEIGHT_PCT = 20.0
export const RC09_NOTE_TILE_PACKET_HEIGHT_PCT = 25.0

/**
 * Packet 11.1's zones for the 800x480 native canvas, verbatim. image-qa-v1 normative override 2 is
 * explicit: the approved render drifts up to +6.46 pp (stage-clock height) and +6.25 pp (timeline
 * height) against these numbers, so the render's pixels are never traced.
 */
export const RC09_NATIVE_ZONES: Rc09ZoneMap = Object.freeze({
  timeline: Object.freeze({ left: 2.0, top: 8.3, width: 96.0, height: 12.5 }),
  clock: Object.freeze({ left: 2.0, top: 25.0, width: 52.5, height: 37.5 }),
  split: Object.freeze({ left: 57.0, top: 25.0, width: 41.0, height: 18.8 }),
  note: Object.freeze({ left: 57.0, top: 45.8, width: 41.0, height: RC09_NOTE_TILE_HEIGHT_PCT }),
  support: Object.freeze({ left: 2.0, top: 66.7, width: 96.0, height: 29.2 })
})

/**
 * Packet 12.1's `stage-profile-reveal`. The width buys ONE module the 800x480 canvas cannot fit —
 * a stage-profile strip aligned to the timeline — while the linear stage metaphor is preserved
 * rather than rescaled. The packet publishes the split chip and the note tile as a single
 * 54.7 / 16.0, 43.0 x 36.7 box; they are laid side by side inside it, so `splitNote` is a NESTED
 * container zone rather than a sixth top-level rect.
 */
export const RC09_APP_SPLIT_NOTE_BOX: Rc09Rect = Object.freeze({
  left: 54.7,
  top: 16.0,
  width: 43.0,
  height: 36.7
})

const RC09_APP_SPLIT_NOTE_GUTTER_PCT = 1.1

export const RC09_APP_ZONES: Rc09ZoneMap = Object.freeze({
  timeline: Object.freeze({ left: 0, top: 0, width: 100, height: 12.0 }),
  clock: Object.freeze({ left: 2.3, top: 16.0, width: 50.8, height: 36.7 }),
  splitNote: RC09_APP_SPLIT_NOTE_BOX,
  split: Object.freeze({
    left: RC09_APP_SPLIT_NOTE_BOX.left,
    top: RC09_APP_SPLIT_NOTE_BOX.top,
    width: RC09_APP_SPLIT_NOTE_BOX.width,
    height: round1((RC09_APP_SPLIT_NOTE_BOX.height - RC09_APP_SPLIT_NOTE_GUTTER_PCT) / 2)
  }),
  note: Object.freeze({
    left: RC09_APP_SPLIT_NOTE_BOX.left,
    top: round1(
      RC09_APP_SPLIT_NOTE_BOX.top + (RC09_APP_SPLIT_NOTE_BOX.height + RC09_APP_SPLIT_NOTE_GUTTER_PCT) / 2
    ),
    width: RC09_APP_SPLIT_NOTE_BOX.width,
    height: round1((RC09_APP_SPLIT_NOTE_BOX.height - RC09_APP_SPLIT_NOTE_GUTTER_PCT) / 2)
  }),
  profile: Object.freeze({ left: 2.3, top: 56.0, width: 95.3, height: 20.0 }),
  support: Object.freeze({ left: 2.3, top: 78.7, width: 95.3, height: 18.3 })
})

/**
 * Compact breakpoints are not packet-specified. They keep the linear stage grammar and drop only
 * the app-only stage-profile strip, so the timeline, the stage clock, the split chip, the note cue
 * and the support minis — and therefore all three alert surfaces — stay visible at every size.
 */
function rc09CompactZones(mode: Rc09CompactMode): Rc09ZoneMap {
  if (mode === 'phone') {
    return Object.freeze({
      timeline: Object.freeze({ left: 2, top: 1.5, width: 96, height: 9 }),
      clock: Object.freeze({ left: 2, top: 12, width: 96, height: 24 }),
      split: Object.freeze({ left: 2, top: 37.5, width: 96, height: 15 }),
      note: Object.freeze({ left: 2, top: 54, width: 96, height: 18 }),
      support: Object.freeze({ left: 2, top: 73.5, width: 96, height: 25 })
    })
  }
  if (mode === 'landscape') {
    return Object.freeze({
      timeline: Object.freeze({ left: 2, top: 2, width: 96, height: 13 }),
      clock: Object.freeze({ left: 2, top: 17, width: 52.5, height: 44 }),
      split: Object.freeze({ left: 56.5, top: 17, width: 41.5, height: 20 }),
      note: Object.freeze({ left: 56.5, top: 38.5, width: 41.5, height: 22.5 }),
      support: Object.freeze({ left: 2, top: 63, width: 96, height: 34 })
    })
  }
  return Object.freeze({
    timeline: Object.freeze({ left: 2, top: 2, width: 96, height: 12 }),
    clock: Object.freeze({ left: 2, top: 16, width: 52.5, height: 38 }),
    split: Object.freeze({ left: 56.5, top: 16, width: 41.5, height: 18 }),
    note: Object.freeze({ left: 56.5, top: 35.5, width: 41.5, height: 18.5 }),
    support: Object.freeze({ left: 2, top: 56, width: 96, height: 41 })
  })
}

export function rc09ZonesForLayout(layout: Rc09Layout, compactMode: Rc09CompactMode = 'standard'): Rc09ZoneMap {
  if (layout === 'native') return RC09_NATIVE_ZONES
  if (layout === 'app') return RC09_APP_ZONES
  return rc09CompactZones(compactMode)
}

/** A 0..100 coordinate as a CSS percentage, without binary-float noise in the DOM. */
export function rc09Percent(value: number): string {
  return `${round3(finite(value) ? value : 0)}%`
}

/** The inline geometry a zone element carries, so CSS and the packet table cannot drift. */
export function rc09ZoneStyle(rect: Rc09Rect | undefined): {
  left: string
  top: string
  width: string
  height: string
} | null {
  if (!rect) return null
  return {
    left: rc09Percent(rect.left),
    top: rc09Percent(rect.top),
    width: rc09Percent(rect.width),
    height: rc09Percent(rect.height)
  }
}

export function rc09RectsOverlap(a: Rc09Rect, b: Rc09Rect): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  )
}

export function rc09RectContains(outer: Rc09Rect, inner: Rc09Rect): boolean {
  return (
    inner.left >= outer.left - 1e-6 &&
    inner.top >= outer.top - 1e-6 &&
    inner.left + inner.width <= outer.left + outer.width + 1e-6 &&
    inner.top + inner.height <= outer.top + outer.height + 1e-6
  )
}

// ─────────────────────────────────────────────────────────── typography

/**
 * Packet 11.2's ladder, in pixels on the 800x480 canvas, computed arithmetically from the packet
 * and NOT measured off the approved render. image-qa-v1 normative override 1 is explicit: the
 * reference sets the split at only 1.083x the support numbers instead of the packet's 1.60x, and
 * that frame must not be traced. `label` is not a packet rung; it is declared here once as the
 * smallest tier so the label-to-value ratio is a constant rather than a per-rule guess.
 */
export const RC09_TYPE_SCALE_PX = Object.freeze({
  clock: 150,
  split: 64,
  note: 40,
  support: 40,
  label: 18
})

/** One container-query width unit is one hundredth of the native canvas: 800 / 100 = 8 px. */
export const RC09_CQW_PX = RC09_NATIVE_WIDTH_PX / 100

/** The packet's px ladder expressed in the container units the stylesheet actually uses. */
export function rc09TypeScaleCqw(px: number): number {
  return round3(px / RC09_CQW_PX)
}

/**
 * The documented RC-01/RC-02 sizing trap: `white-space: nowrap` lets a flex item's min-content
 * width exceed its column, so `overflow: hidden` never clips and every `scrollWidth` check passes
 * while the hero numeral collides with its neighbour. Packet 11.2's 150 px stage clock is exactly
 * that case — seven glyphs of `04:12.6` at 150 px need about 470 px and packet 11.1 gives the
 * clock zone only 420 px — so the rendered size is `min(packet rung, zone fit)` and the fit is
 * computed here, arithmetically, from the ZONE the packet itself publishes. The packet rung stays
 * the specification and the ceiling; it is never exceeded, and it is honoured verbatim by every
 * other rung, which all fit.
 */
export const RC09_GLYPH_ADVANCE_EM = 0.56
export const RC09_ZONE_GUTTER_CQW = 1.4

export function rc09FitFontCqw(
  zoneWidthPct: number,
  glyphCount: number,
  gutterCqw = RC09_ZONE_GUTTER_CQW,
  advanceEm = RC09_GLYPH_ADVANCE_EM
): number {
  if (!finite(zoneWidthPct) || !finite(glyphCount) || glyphCount <= 0 || advanceEm <= 0) return 0
  const usable = zoneWidthPct - 2 * Math.max(0, gutterCqw)
  return usable <= 0 ? 0 : round3(usable / (glyphCount * advanceEm))
}

/** The size a rung actually renders at: the packet rung, capped by its zone's arithmetic fit. */
export function rc09RungCqw(px: number, zoneWidthPct: number, glyphCount: number): number {
  return round3(Math.min(rc09TypeScaleCqw(px), rc09FitFontCqw(zoneWidthPct, glyphCount)))
}

// ─────────────────────────────────────────────────────────── layout resolution

export function rc09LayoutForContentBox(width: number, height: number): Rc09Layout {
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return 'app'
  if (
    Math.abs(width - RC09_NATIVE_WIDTH_PX) <= RC09_NATIVE_TOLERANCE_PX &&
    Math.abs(height - RC09_NATIVE_HEIGHT_PX) <= RC09_NATIVE_TOLERANCE_PX
  ) {
    return 'native'
  }
  if (width >= RC09_APP_WIDTH_PX - 1 && height >= RC09_APP_HEIGHT_PX - 1) return 'app'
  return 'compact'
}

export function rc09CompactModeForContentBox(width: number, height: number): Rc09CompactMode {
  if (rc09LayoutForContentBox(width, height) !== 'compact') return 'standard'
  if (
    width >= RC09_PHONE_MIN_WIDTH_PX &&
    width <= RC09_PHONE_MAX_WIDTH_PX &&
    height >= RC09_PHONE_MIN_HEIGHT_PX &&
    height / width >= 1.5
  ) {
    return 'phone'
  }
  if (
    width >= RC09_LANDSCAPE_MIN_WIDTH_PX &&
    height >= RC09_LANDSCAPE_MIN_HEIGHT_PX &&
    height <= RC09_LANDSCAPE_MAX_HEIGHT_PX &&
    width / height >= 1.5
  ) {
    return 'landscape'
  }
  return 'standard'
}

export interface Rc09PhoneGeometry {
  inset: number
  timelineHeight: number
  clockHeight: number
  chipHeight: number
  ledSize: number
}

/** Portrait geometry, in pixels, for the bands the phone stack sizes from the measured box. */
export function rc09PhoneGeometryForContentBox(width: number, height: number): Rc09PhoneGeometry | null {
  if (rc09CompactModeForContentBox(width, height) !== 'phone') return null
  return {
    inset: 12,
    timelineHeight: Math.max(40, Math.round(height * 0.075)),
    clockHeight: Math.max(72, Math.round(height * 0.2)),
    chipHeight: Math.max(48, Math.round(height * 0.12)),
    ledSize: Math.max(10, Math.round(width * 0.035))
  }
}

// ─────────────────────────────────────────────────────────── alerts

/** Packet 15: a caution waypoint is an EVENT with a 2 s minimum display. */
export const RC09_CAUTION_MIN_VISIBLE_MS = 2_000
/** Packet 15: a rolling split above +2.0 s must hold for 1 s before the chip escalates. */
export const RC09_SPLIT_LOSS_THRESHOLD_SEC = 2.0
export const RC09_SPLIT_LOSS_ENGAGE_MS = 1_000
/** Packet 15: an out-of-range mechanical reading must hold for 3 s before the mini escalates. */
export const RC09_MECHANICAL_ENGAGE_MS = 3_000

/**
 * Declared CONFIGURATION, never telemetry and never printed. These bounds exist only to decide the
 * packet 15 mechanical trigger; the display shows the MEASURED value and the alert line, never the
 * bounds themselves. The oil-pressure bound is additionally gated on a fresh engine speed above
 * `RC09_OIL_PRESSURE_MIN_RPM`, because a stopped engine reads zero and would otherwise raise a
 * mechanical warning for a car that is simply not running.
 */
export const RC09_WATER_RANGE_C = Object.freeze({ minC: 60, maxC: 110 })
export const RC09_OIL_PRESSURE_RANGE_KPA = Object.freeze({ minKpa: 150, maxKpa: 800 })
export const RC09_OIL_PRESSURE_MIN_RPM = 1_200

export const RC09_MECHANICAL_FAULTS = ['WATER', 'OIL'] as const
export type Rc09MechanicalFault = (typeof RC09_MECHANICAL_FAULTS)[number]

export interface Rc09AlertState {
  cautionWaypoint: {
    active: boolean
    minimumVisibleUntilMs: number
    sequence: number | null
    acknowledgedSequence: number | null
  }
  splitLoss: {
    active: boolean
    pendingSinceMs: number | null
  }
  mechanical: {
    active: boolean
    pendingSinceMs: Readonly<Partial<Record<Rc09MechanicalFault, number>>>
    faults: readonly Rc09MechanicalFault[]
  }
}

export interface Rc09AlertInput {
  nowMs: number
  /** The sequence of the hazard waypoint the roadbook reports reached; null when there is none. */
  hazardSequence: number | null
  /** The sequence the crew acknowledged with the packet 13 macro button. */
  acknowledgedSequence: number | null
  /** The MEASURED rolling split in seconds; null whenever there is no reference or it is stale. */
  splitSec: number | null
  /** Readings positively measured outside their declared range this frame. */
  outOfRange: readonly Rc09MechanicalFault[]
}

export function createRc09AlertState(): Rc09AlertState {
  return {
    cautionWaypoint: { active: false, minimumVisibleUntilMs: 0, sequence: null, acknowledgedSequence: null },
    splitLoss: { active: false, pendingSinceMs: null },
    mechanical: { active: false, pendingSinceMs: {}, faults: [] }
  }
}

function cloneRc09AlertState(state: Rc09AlertState): Rc09AlertState {
  return {
    cautionWaypoint: { ...state.cautionWaypoint },
    splitLoss: { ...state.splitLoss },
    mechanical: {
      ...state.mechanical,
      pendingSinceMs: { ...state.mechanical.pendingSinceMs },
      faults: [...state.mechanical.faults]
    }
  }
}

/**
 * Every alert is silent until its own trigger fires, carries the packet section 15 debounce and
 * hysteresis, has an explicit clear condition, and is unlatched the moment its input goes missing
 * or stale. No element of the alert layer is ever an always-on decoration.
 */
export function advanceRc09Alerts(state: Rc09AlertState, input: Rc09AlertInput): Rc09AlertState {
  const nowMs = finite(input.nowMs) ? input.nowMs : 0
  const next = cloneRc09AlertState(state)

  // ── Caution waypoint: an EVENT alert with a 2 s minimum display. It is raised only by the
  //    roadbook reporting a hazard waypoint reached, clears when the waypoint is passed (the
  //    roadbook stops reporting it, or reports the next one) and can be dismissed early by the
  //    packet 13 acknowledge macro — but never before the 2 s minimum has elapsed.
  const acknowledged =
    input.acknowledgedSequence !== null && input.acknowledgedSequence === input.hazardSequence
  if (input.hazardSequence !== null && !acknowledged) {
    const changed = next.cautionWaypoint.sequence !== input.hazardSequence
    next.cautionWaypoint = {
      active: true,
      minimumVisibleUntilMs: changed
        ? nowMs + RC09_CAUTION_MIN_VISIBLE_MS
        : Math.max(next.cautionWaypoint.minimumVisibleUntilMs, nowMs + RC09_CAUTION_MIN_VISIBLE_MS),
      sequence: input.hazardSequence,
      acknowledgedSequence: input.acknowledgedSequence
    }
  } else if (next.cautionWaypoint.active && nowMs < next.cautionWaypoint.minimumVisibleUntilMs) {
    next.cautionWaypoint = { ...next.cautionWaypoint, acknowledgedSequence: input.acknowledgedSequence }
  } else {
    next.cautionWaypoint = {
      active: false,
      minimumVisibleUntilMs: 0,
      sequence: null,
      acknowledgedSequence: input.acknowledgedSequence
    }
  }

  // ── Split loss: above +2.0 s for a continuous 1 s. A missing or stale split cannot engage it
  //    and unlatches it at once, because the packet forbids predicting a split across a gap.
  if (input.splitSec === null || input.splitSec <= RC09_SPLIT_LOSS_THRESHOLD_SEC) {
    next.splitLoss = { active: false, pendingSinceMs: null }
  } else {
    const pendingSinceMs = next.splitLoss.pendingSinceMs ?? nowMs
    next.splitLoss = {
      active: nowMs - pendingSinceMs >= RC09_SPLIT_LOSS_ENGAGE_MS,
      pendingSinceMs
    }
  }

  // ── Mechanical warning: each reading runs its own 3 s debounce, so a hot coolant sample never
  //    escalates the oil line. A sensor that is absent or stale is simply not in `outOfRange`, so
  //    a quiet bus greys the mini rather than claiming a fault it cannot measure.
  const pending: Partial<Record<Rc09MechanicalFault, number>> = {}
  const faults: Rc09MechanicalFault[] = []
  for (const fault of RC09_MECHANICAL_FAULTS) {
    if (!input.outOfRange.includes(fault)) continue
    const since = next.mechanical.pendingSinceMs[fault] ?? nowMs
    pending[fault] = since
    if (nowMs - since >= RC09_MECHANICAL_ENGAGE_MS) faults.push(fault)
  }
  next.mechanical = { active: faults.length > 0, pendingSinceMs: pending, faults }

  return next
}

/** A stale, missing or refused input can never leave an alert latched on. */
export function clearInvalidRc09Alerts(state: Rc09AlertState, model: Rc09DashboardModel): Rc09AlertState {
  const next = cloneRc09AlertState(state)
  if (!model.roadbookLoaded) {
    next.cautionWaypoint = {
      active: false,
      minimumVisibleUntilMs: 0,
      sequence: null,
      acknowledgedSequence: next.cautionWaypoint.acknowledgedSequence
    }
  }
  if (model.split.unavailable || model.split.stale) {
    next.splitLoss = { active: false, pendingSinceMs: null }
  }
  if (model.water.unavailable && model.oilPressureKpa === null) {
    next.mechanical = { active: false, pendingSinceMs: {}, faults: [] }
  }
  return next
}

/** The alert lines a surface renders; empty in a silent frame, which is the reference state. */
export function rc09AlertLines(model: Rc09DashboardModel): readonly string[] {
  const lines: string[] = []
  if (model.alerts.cautionWaypoint) lines.push('CAUTION WAYPOINT')
  if (model.alerts.splitLoss) lines.push('SPLIT LOSS')
  if (model.alerts.mechanical) lines.push(`${model.mechanicalFaults.join(' ')} WARNING`)
  return lines
}

// ─────────────────────────────────────────────────────────── dashboard model

export type Rc09SplitDirection = 'gaining' | 'losing' | 'level' | 'none'

export interface Rc09NoteModel {
  note: Rc09PaceNote | null
  /** Packet 16: blank, literally, whenever no roadbook is loaded. Never auto-generated. */
  text: string
  blank: boolean
  hazard: boolean
  glyph: Rc09NoteGlyph
  severity: number | null
}

export interface Rc09StageModel {
  distanceM: number | null
  lengthM: number | null
  /** `null` for as long as no stage-distance channel exists: no fill, no marker, no guess. */
  progress: number | null
  available: boolean
  sourceLabel: string
}

export interface Rc09AlertFlags {
  cautionWaypoint: boolean
  splitLoss: boolean
  mechanical: boolean
}

export interface Rc09DashboardModel {
  stageTimer: Rc01Field
  split: Rc01Field
  splitDirection: Rc09SplitDirection
  note: Rc09NoteModel
  noteDistance: Rc01Field
  distanceToFinish: Rc01Field
  stage: Rc09StageModel
  speed: Rc01Field
  gear: Rc01Field
  water: Rc01Field
  rpm: Rc01Field
  rpmRatio: number | null
  rpmFresh: boolean
  shiftGear: number | null
  shiftThreshold: number
  leds: readonly Rc09Led[]
  roadbookLoaded: boolean
  /** The MEASURED oil pressure, or null; it has no zone and is only a mechanical-alert input. */
  oilPressureKpa: number | null
  outOfRange: readonly Rc09MechanicalFault[]
  mechanicalFaults: readonly Rc09MechanicalFault[]
  alerts: Rc09AlertFlags
  auxFresh: Readonly<Record<Rc09AuxChannel, boolean>>
  criticalFresh: Readonly<Record<Rc01ChannelName, boolean>>
}

export interface Rc09ModelOptions {
  alerts?: Rc09AlertState
  /** The loaded roadbook's current call. `null` is "no roadbook", which renders blank. */
  paceNote?: Rc09PaceNote | null
}

interface Rc09Reading {
  value: number | string | null
  lastKnown: number | string | null
  stale: boolean
  ageMs: number
}

/**
 * Receipts for RC-09's own channels, with exactly RC-01's semantics: a receipt is written only
 * when the channel actually reports, so a channel that falls silent ages out and degrades to its
 * packet state instead of freezing on its last value.
 */
export class Rc09AuxBuffer {
  private channelReceipts = new Map<Rc09AuxChannel, Rc01ChannelReceipt>()

  clone(): Rc09AuxBuffer {
    const next = new Rc09AuxBuffer()
    next.channelReceipts = new Map(this.channelReceipts)
    return next
  }

  reset(): void {
    this.channelReceipts = new Map()
  }

  ingest(snapshot: TelemetrySnapshot | null | undefined, receivedAt = rc01MonotonicNow()): void {
    if (!snapshot || !snapshot.connected || !finite(snapshot.timestamp)) return
    const safeReceiptAt = finite(receivedAt) && receivedAt >= 0 ? receivedAt : rc01MonotonicNow()
    for (const channel of Object.keys(RC09_CHANNEL_STALE_MS) as Rc09AuxChannel[]) {
      const value = rc09AuxChannelValue(snapshot, channel)
      if (value === null) continue
      this.channelReceipts.set(
        channel,
        Object.freeze({ value, snapshotTimestamp: snapshot.timestamp, receivedAt: safeReceiptAt })
      )
    }
  }

  receipts(): ReadonlyMap<Rc09AuxChannel, Rc01ChannelReceipt> {
    return new Map(this.channelReceipts)
  }
}

export function createRc09AuxReceipts(
  snapshot: TelemetrySnapshot,
  receivedAt = rc01MonotonicNow()
): ReadonlyMap<Rc09AuxChannel, Rc01ChannelReceipt> {
  const buffer = new Rc09AuxBuffer()
  buffer.ingest(snapshot, receivedAt)
  return buffer.receipts()
}

function auxReading(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc09AuxChannel, Rc01ChannelReceipt>,
  channel: Rc09AuxChannel,
  nowMs: number
): Rc09Reading {
  const raw = snapshot ? rc09AuxChannelValue(snapshot, channel) : null
  const receipt = receipts.get(channel)
  if (raw === null || !receipt) {
    return { value: null, lastKnown: null, stale: false, ageMs: Number.POSITIVE_INFINITY }
  }
  const ageMs = rc01ReceiptAgeMs(receipt, nowMs)
  const stale = ageMs > RC09_CHANNEL_STALE_MS[channel]
  return {
    value: stale ? null : raw,
    lastKnown: typeof receipt.value === 'boolean' ? null : receipt.value,
    stale,
    ageMs
  }
}

/**
 * Packet 16's `mm:ss.m`. Never predicted, never extrapolated: this formats a MEASURED elapsed at
 * the packet's own tenth-of-a-second resolution, rounding the sample rather than truncating the
 * binary-float residue of a value the timing source published as an exact tenth.
 */
export function rc09FormatStageTime(seconds: number | null): string {
  if (!finite(seconds) || seconds < 0) return RC09_DASH.stageTimer
  const totalTenths = Math.round(seconds * 10)
  const minutes = Math.floor(totalTenths / 600)
  const rest = (totalTenths - minutes * 600) / 10
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`
}

/** Packet 16/19: the sign is a literal character, so the split is never carried by hue alone. */
export function rc09FormatSplit(seconds: number | null): string {
  if (!finite(seconds)) return RC09_DASH.split
  const rounded = Math.round(seconds * 10) / 10
  if (rounded === 0) return '0.0'
  return `${rounded > 0 ? '+' : '-'}${Math.abs(rounded).toFixed(1)}`
}

/** Packet 16: 'N' or the grey '-'; a gear is never blanked silently and never comes from RPM. */
export function rc09DisplayGear(gear: number | null): string {
  if (gear === null || !finite(gear)) return RC09_DASH.gear
  if (gear < 0) return 'R'
  if (gear === 0) return 'N'
  return String(Math.trunc(gear))
}

/** Which mechanical readings are positively MEASURED outside their declared configuration range. */
export function rc09OutOfRangeFaults(input: {
  waterTempC: number | null
  oilPressureKpa: number | null
  rpm: number | null
  rpmFresh: boolean
}): readonly Rc09MechanicalFault[] {
  const faults: Rc09MechanicalFault[] = []
  if (
    finite(input.waterTempC) &&
    (input.waterTempC < RC09_WATER_RANGE_C.minC || input.waterTempC > RC09_WATER_RANGE_C.maxC)
  ) {
    faults.push('WATER')
  }
  // A stopped or unmeasured engine cannot report an oil-pressure fault: zero pressure at rest is
  // the correct reading, not a warning, so the engine must positively be turning to be judged.
  const running = input.rpmFresh && finite(input.rpm) && input.rpm >= RC09_OIL_PRESSURE_MIN_RPM
  if (
    running &&
    finite(input.oilPressureKpa) &&
    (input.oilPressureKpa < RC09_OIL_PRESSURE_RANGE_KPA.minKpa ||
      input.oilPressureKpa > RC09_OIL_PRESSURE_RANGE_KPA.maxKpa)
  ) {
    faults.push('OIL')
  }
  return faults
}

/**
 * Projects the shared RC-01 telemetry model into RC-09's linear stage display and adds the rally
 * channels. Nothing is invented, estimated or mirrored: the stage clock is never predicted, the
 * split is never estimated without a stored reference, the pace note is never generated, the
 * distance-to-finish and distance-to-note have no channel and therefore always dash, and every
 * unavailable channel renders its packet state.
 */
export function createRc09DashboardModel(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc01ChannelName, Rc01ChannelReceipt> = new Map(),
  auxReceipts: ReadonlyMap<Rc09AuxChannel, Rc01ChannelReceipt> = new Map(),
  nowMs = rc01MonotonicNow(),
  options: Rc09ModelOptions = {}
): Rc09DashboardModel {
  const base: Rc01DashboardModel = createRc01DashboardModel(snapshot, receipts, nowMs)
  const safeSnapshot = snapshot && snapshot.connected ? snapshot : null
  const alerts = options.alerts ?? createRc09AlertState()
  const paceNote = options.paceNote ?? null

  const auxFresh = Object.fromEntries(
    (Object.keys(RC09_CHANNEL_STALE_MS) as Rc09AuxChannel[]).map((channel) => [
      channel,
      auxReading(safeSnapshot, auxReceipts, channel, nowMs).value !== null
    ])
  ) as Record<Rc09AuxChannel, boolean>

  // ── Stage clock: the timing source's own measured elapsed time. A source that falls silent
  //    collapses to the packet dash rather than freezing on a clock that has stopped being true.
  const stageReading = auxReading(safeSnapshot, auxReceipts, 'stageTimer', nowMs)
  const stageTimer =
    typeof stageReading.value === 'number'
      ? field(rc09FormatStageTime(stageReading.value), stageReading.value, false, false, 'primary')
      : field(RC09_DASH.stageTimer, null, stageReading.stale, true, 'muted')

  // ── Rolling split. The shared RC-01 delta already refuses to exist without a stored reference
  //    lap and already carries the packet's cadence, so it is projected rather than re-derived.
  const splitRaw = base.delta.raw
  const splitUsable = !base.delta.unavailable && !base.delta.stale && finite(splitRaw)
  const splitSec = splitUsable ? (splitRaw as number) : null
  const splitLoss = alerts.splitLoss.active
  const split = splitUsable
    ? field(
        rc09FormatSplit(splitSec),
        splitSec,
        false,
        false,
        splitLoss ? 'bad' : (splitSec as number) < 0 ? 'good' : 'primary'
      )
    : field(RC09_DASH.split, null, base.delta.stale, base.delta.unavailable, 'muted')
  const splitDirection: Rc09SplitDirection = !splitUsable
    ? 'none'
    : (splitSec as number) < 0
      ? 'gaining'
      : (splitSec as number) > 0
        ? 'losing'
        : 'level'

  // ── Co-driver pace note. Packet 16 and 20: blank unless a roadbook is loaded, and never
  //    auto-generated. There is no fallback text and no placeholder call.
  const note: Rc09NoteModel = {
    note: paceNote,
    text: paceNote?.text ?? '',
    blank: paceNote === null,
    hazard: paceNote?.hazard === true,
    glyph: rc09NoteGlyph(paceNote),
    severity: rc09NoteSeverity(paceNote)
  }

  // ── The two readouts with no channel at all. See RC09_PACKET_OMISSIONS: they dash for ever and
  //    are never filled from a lap-distance percentage or a note index.
  const stageDistanceM = rc09StageDistanceM(safeSnapshot)
  const stageLengthM = rc09StageLengthM(safeSnapshot)
  const stageProgress = rc09StageProgress(stageDistanceM, stageLengthM)
  const stage: Rc09StageModel = {
    distanceM: stageDistanceM,
    lengthM: stageLengthM,
    progress: stageProgress,
    available: stageProgress !== null,
    sourceLabel: stageProgress === null ? 'NO STAGE DISTANCE SOURCE' : 'STAGE DISTANCE LIVE'
  }
  const distanceToFinish = field(RC09_DASH.distanceToFinish, null, false, true, 'muted')
  const noteDistance = field(RC09_DASH.noteDistance, null, false, true, 'muted')

  // ── Speed: greys past its 100 ms cadence, collapses to '---' past the 500 ms budget.
  const speedReading = auxReading(safeSnapshot, auxReceipts, 'speed', nowMs)
  const speedDashed = speedReading.value === null && speedReading.ageMs > RC09_SPEED_DASH_MS
  const speed =
    typeof speedReading.value === 'number'
      ? field(String(Math.round(speedReading.value)), speedReading.value, false, false, 'primary')
      : !speedDashed && typeof speedReading.lastKnown === 'number'
        ? field(String(Math.round(speedReading.lastKnown)), speedReading.lastKnown, true, false, 'muted')
        : field(RC09_DASH.speed, null, speedReading.stale, true, 'muted')

  // ── Gear: the ECU gear channel, never derived from RPM or speed, never blanked silently.
  const gearReading = auxReading(safeSnapshot, auxReceipts, 'gear', nowMs)
  const gear =
    typeof gearReading.value === 'number'
      ? field(rc09DisplayGear(gearReading.value), gearReading.value, false, false, 'primary')
      : field(RC09_DASH.gear, null, gearReading.stale, true, 'muted')

  // ── Water: its own sensor, greyed and dashed when invalid; never estimated from oil or air.
  const waterReading = auxReading(safeSnapshot, auxReceipts, 'water', nowMs)
  const waterFaulted = alerts.mechanical.faults.includes('WATER')
  const water =
    typeof waterReading.value === 'number'
      ? field(
          String(Math.round(waterReading.value)),
          waterReading.value,
          false,
          false,
          waterFaulted ? 'bad' : 'primary'
        )
      : field(RC09_DASH.water, null, waterReading.stale, true, 'muted')

  // ── Engine speed and the shift arc come from the shared RC-01 channel: its 200 ms budget IS
  //    packet 16's, and the arc is dark whenever that channel is invalid or stale.
  const leds = buildRc09LedStates(base.rpmFresh ? base.rpmRatio : null, base.rpmFresh, base.shiftGear)

  const oilPressureKpa = finite(safeSnapshot?.oilPressureKpa) ? safeSnapshot!.oilPressureKpa! : null
  const outOfRange = rc09OutOfRangeFaults({
    waterTempC: typeof waterReading.value === 'number' ? waterReading.value : null,
    oilPressureKpa,
    rpm: typeof base.rpm.raw === 'number' ? base.rpm.raw : null,
    rpmFresh: base.rpmFresh
  })

  return {
    stageTimer,
    split,
    splitDirection,
    note,
    noteDistance,
    distanceToFinish,
    stage,
    speed,
    gear,
    water,
    rpm: base.rpm,
    rpmRatio: base.rpmRatio,
    rpmFresh: base.rpmFresh,
    shiftGear: base.shiftGear,
    shiftThreshold: base.shiftThreshold,
    leds,
    roadbookLoaded: paceNote !== null,
    oilPressureKpa,
    outOfRange,
    mechanicalFaults: alerts.mechanical.faults,
    alerts: {
      cautionWaypoint: alerts.cautionWaypoint.active,
      splitLoss: alerts.splitLoss.active,
      mechanical: alerts.mechanical.active
    },
    auxFresh,
    criticalFresh: base.criticalFresh
  }
}

/** The alert-layer inputs, all gated on freshness so a frozen frame can never engage anything. */
export function rc09AlertInputForModel(
  model: Rc09DashboardModel,
  nowMs: number,
  acknowledgedSequence: number | null = null
): Rc09AlertInput {
  const hazard = model.note.note !== null && model.note.hazard ? model.note.note.sequence : null
  const splitSec =
    model.split.unavailable || model.split.stale || typeof model.split.raw !== 'number'
      ? null
      : model.split.raw
  return {
    nowMs,
    hazardSequence: hazard,
    acknowledgedSequence,
    splitSec,
    outOfRange: model.outOfRange
  }
}

/** Accessible description for the stage clock, its source and its freshness. */
export function rc09StageTimerDescription(model: Rc09DashboardModel): string {
  if (model.stageTimer.unavailable) return 'Stage time unavailable, stage clock not armed'
  return `Stage time ${model.stageTimer.value}${model.stageTimer.stale ? ', stale' : ''}`
}

/** Accessible description for the split chip: the sign in words, never the hue alone. */
export function rc09SplitDescription(model: Rc09DashboardModel): string {
  if (model.split.unavailable) return 'Rolling split unavailable, no reference run'
  if (model.split.stale) return 'Rolling split stale'
  const side =
    model.splitDirection === 'gaining'
      ? 'gaining on the reference'
      : model.splitDirection === 'losing'
        ? 'losing to the reference'
        : 'level with the reference'
  return `Rolling split ${model.split.value} seconds, ${side}`
}

/** Accessible description for the note cue: the call in words plus its glyph family. */
export function rc09NoteDescription(model: Rc09NoteModel): string {
  if (model.blank) return 'Pace note blank, no roadbook loaded'
  return `Pace note ${model.text}${model.hazard ? ', hazard waypoint' : ''}`
}

export type { Rc01Field as Rc09Field }
