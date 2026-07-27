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

/**
 * RC-20 "Lights Out — Formation, Grid & Start Procedure" core. Twentieth and final artifact of
 * the RaceCon-20 portfolio, approved on attempt-003 after re-adjudication (`image-qa-v2.md`).
 *
 * The live-only ingest buffer, identity binding, mock/replay refusal, out-of-order and
 * same-timestamp guards, the shared channel receipts and the RPM projection are reused verbatim
 * from the RC-01 core: that is telemetry-truth machinery, not RC-01 styling, and a fork would
 * silently drift. Packet section 16's RPM rule — "freeze value + gray tint when stale > 200 ms,
 * never interpolate" — is already exactly what `createRc01DashboardModel` does with its 200 ms
 * `rpm` budget, so it is consumed rather than re-implemented.
 *
 * This module adds only what RC-20's packet needs and the shared layer does not have: the
 * start-light stage enum and its decode from the one genuine start-system feed the app carries,
 * the FORMATION → GRID → LAUNCH display-mode machine, the launch-RPM band, the clutch-bite
 * scale, the grid/formation strip payload, the measured launch review, and the three
 * sequence-gated packet section 15 alerts.
 *
 * Every packet defect resolved here is recorded in `RC20_PACKET_OMISSIONS` and asserted by the
 * suite, so a later edit cannot quietly reintroduce it. No packet file was modified.
 */

// ─────────────────────────────────────────────────────────── canvases

/** Packet section 11.1 native canvas, and the section 12.1 app reflow target. */
export const RC20_NATIVE_WIDTH_PX = 800
export const RC20_NATIVE_HEIGHT_PX = 480
export const RC20_NATIVE_TOLERANCE_PX = 1
export const RC20_APP_WIDTH_PX = 1024
export const RC20_APP_HEIGHT_PX = 600

export const RC20_PHONE_MIN_WIDTH_PX = 360
export const RC20_PHONE_MAX_WIDTH_PX = 480
export const RC20_PHONE_MIN_HEIGHT_PX = 650
export const RC20_LANDSCAPE_MIN_WIDTH_PX = 650
export const RC20_LANDSCAPE_MIN_HEIGHT_PX = 360
export const RC20_LANDSCAPE_MAX_HEIGHT_PX = 480

export type Rc20CompactMode = 'phone' | 'landscape' | 'standard'
export type Rc20Layout = 'native' | 'app' | 'compact'

// ─────────────────────────────────────────────────────────── registration facts

/**
 * The literals the SEPARATE catalog wiring PR must register. They are exported so the wiring
 * agent reads facts from the module it is wiring rather than re-deriving them from the packet.
 * Nothing in this PR registers the widget: it is deliberately not yet reachable from the
 * catalog, which is why these four files collide with no other artifact in flight.
 */
export const RC20_WIDGET_ID = 'raceconRc20Dash'
/**
 * Corrected by the catalog wiring PR from `racecon-rc20-lights-out`. That kebab-case value was the
 * only non-snake_case id among the 31 embedded full-frame presets in `src/shared/dashboards.ts`, and
 * the only RaceCon id not of the form `racecon_rcNN_dash` — RC-01 … RC-19 all use it. Nothing
 * enforces the shape (`fileNameOf` keeps `-`, `STREAM_TARGET_SOURCE_ID` allows it) and kebab-case is
 * used consistently by the unrelated R16 `race-first-*` / `race-chase-*` families, but the preset id
 * is user-facing in three places — the persisted `<id>.json` filename, the `?dash=` query parameter,
 * and the catalog search haystack, which does no `-`/`_` normalisation — so the divergence would have
 * made RC-20 the one family member a `racecon_rc20` search could not find.
 */
export const RC20_DASHBOARD_PRESET_ID = 'racecon_rc20_dash'

export const RC20_REGISTRATION = Object.freeze({
  /** `src/shared/overlays.ts` — new member of the `OverlayWidgetId` literal union. */
  overlayWidgetId: RC20_WIDGET_ID,
  /** NOT added to `OVERLAY_WIDGETS`: full-frame dashboards are excluded from the picker. */
  inOverlayWidgetsPicker: false,
  /** `src/renderer/src/overlay/widgets/index.ts` — `WIDGET_COMPONENTS` entry. */
  widgetComponent: 'RaceconRc20DashWidget',
  /** `src/shared/dashboards.ts` — `OVERLAY_DASHBOARD_PRESETS` entry. */
  presetId: RC20_DASHBOARD_PRESET_ID,
  presetName: 'RaceCon RC-20 Lights Out',
  presetFamily: 'racecon',
  presetScaleMode: 'stretch',
  presetWidth: RC20_APP_WIDTH_PX,
  presetHeight: RC20_APP_HEIGHT_PX,
  /** `src/renderer/src/dashboard/DashboardRoot.tsx` — `RESPONSIVE_FULL_FRAME_WIDGET_IDS`. */
  responsiveFullFrame: true,
  /** `src/renderer/src/views/dashboard/widget-catalog-data.ts` — `IDENTITY_SCOPED_WIDGET_IDS`. */
  identityScoped: true,
  /** `src/shared/dashboard-overlay-embed.test.ts` — `EMBEDDED` row, at the preset's index. */
  embeddedFamily: 'racecon',
  /** `src/renderer/src/views/dashboard/DashboardCanvasEditor.test.ts` — render-smoke list. */
  renderSmoke: true,
  /** Regenerate `dashboard-identity-catalog.generated.ts` with `npm run dashboard:identity-catalog`. */
  regenerateIdentityCatalog: true
})

// ─────────────────────────────────────────────────────────── packet omissions

/**
 * Everything the packet asks for that this build deliberately does NOT render, plus every
 * normative override applied to a defective packet section. Each key is asserted by the suite:
 * the omission is part of the contract, not an oversight. No packet file was modified.
 *
 *  - `startLightLadderStages` packet 11.1 makes the ladder a five-bar build through a start
 *                    sequence and gap G-5 leaves the stage enum undefined. The one genuine
 *                    start-system light feed the app carries is iRacing's `SessionFlags`
 *                    start bitfield, which resolves FOUR states (hidden / ready / set / go) and
 *                    has NO per-light resolution. `S1`..`S4` therefore exist in the enum for a
 *                    future feed and are never produced by the decoder: lighting three of five
 *                    bars for "set" would invent a build the feed cannot support. Section 16 is
 *                    explicit — "Never simulate start lights; keep dark if feed absent".
 *  - `startLightFeedOffIracing` `sessionFlagsRaw` is the iRacing `SessionFlags` bitfield ONLY on
 *                    iRacing; the LMU provider puts `mGamePhase` in the same field. Decoding
 *                    start bits from it on any other sim would read garbage, so the decode is
 *                    hard-gated to `sim === 'iracing'` and every other sim renders the dark
 *                    ladder and the honest `NO START LIGHT FEED` caption.
 *  - `abortStage` gap G-5 asks for an `ABORT` member. It exists in the enum and in the lit-bar
 *                    mapping, but no channel in the app reports a start abort, so the decoder
 *                    never produces it and it is never rendered from thin air.
 *  - `launchRpmTarget` section 16 sources the launch target from an "ECU launch channel" that
 *                    the app does not carry on any provider. Gap G-4 leaves the band ceiling
 *                    undefined and forbids fabricating one. The band is therefore HIDDEN until
 *                    an operator declares it through the section 11.5 launch-arm control, and
 *                    the declared bounds are printed on screen so the over-rev ceiling is
 *                    auditable exactly as the approved frame's `BAND 4650-4950` was.
 *  - `gridSlot` section 16's "Grid slot / start status" carries the mixed unit `enum/int`
 *                    (gap G-8). The two halves are split here: the STATUS half is the real
 *                    start-stage feed, the SLOT half has no channel at all. `position` is the
 *                    RACE position and section 16 says "Never assume a grid slot", so the slot
 *                    cell is the grey dash for ever.
 *  - `waterTempGearFuel` gap G-2: water temperature, gear and fuel level are fully defined in
 *                    section 16 but have NO zone in section 11.1 and NO zone in section 12.1 —
 *                    zoneless on both canvases. They are not rendered and no zone is invented.
 *                    There is deliberately no `waterTemp`, `gear` or `fuel` entry in
 *                    `RC20_CHANNEL_STALE_MS`.
 *  - `shiftLedReturn` sections 11.4 and 20 say normal shift-LED behaviour returns once racing
 *                    begins, but section 11.1 allocates NO zone for a shift arc on either
 *                    canvas — the rev display IS the launch band here. No LED, rev or shift
 *                    element exists in the widget or the stylesheet.
 *  - `wheelspinReview` section 12.1's launch review names "reaction/wheelspin". Section 16
 *                    supplies no wheelspin channel and forbids estimating one, so the review
 *                    publishes the MEASURED reaction plus the RPM and clutch observed at the
 *                    release instant, and never a wheelspin figure.
 *  - `brakeAxleAggregation` section 16 words the brake channel "per axle/corner". The strip
 *                    renders the two AXLE cells the eight-cell budget allows (override NO-7);
 *                    an axle number is published only when BOTH of its corner sensors are
 *                    present and fresh, so one corner is never mirrored onto the axle. All four
 *                    corner sensors are surfaced individually in the 1024x600 warm-up map.
 *  - `ladderGutterNo6` override NO-6: packet 11.1 leaves a 4 px gutter between the mode header
 *                    (y 12-36) and the ladder (y 40) at 800x480, which is not implementable.
 *                    The ladder origin moves to y 48 and its foot stays on the packet's y 340,
 *                    giving a 12 px gutter above and 12 px below.
 *  - `gridStripEightCells` override NO-7: the nine-cell row (SLOT + TIRE C + four corners +
 *                    BRAKE C + two brake cells) measures 801.6 px in a 768 px zone at the
 *                    section 11.2 ~30 px type. The two group tags are dropped for a single
 *                    `DEG C` unit tag, giving exactly eight cells.
 *  - `twoRedTokens` override NO-8: `danger #FF3A2E` and `signature #FF2A2A` are 16.49 apart in
 *                    RGB and 12 in luminance (gap G-1); no pixel test and no driver separates
 *                    them. They are separated SEMANTICALLY instead — `signature` is only ever
 *                    the lit ladder bar, `danger` is only ever the alert layer.
 *  - `appCanvasModeAndSlot` gap G-3: section 12.1 drops the mode indicator (which section 19
 *                    makes an accessibility requirement) and the grid/formation strip from the
 *                    1024x600 reflow. A full-width mode ribbon carrying the slot and start
 *                    status is added above the ladder, and the strip's thermal payload moves
 *                    into the app-only warm-up map.
 *  - `ladderDominanceIsPositional` gap G-9: at 1024x600 the launch band (90,000 px²) is larger
 *                    than the ladder (72,000 px²) while sections 6 and 11 call the ladder
 *                    "central dominant" on both canvases. Dominance is restated as POSITIONAL
 *                    and structural — the ladder is centred on x 50 % and is the tallest zone on
 *                    both canvases — and the packet coordinates are used unchanged (NO-1).
 *  - `expansionIsHeightDriven` gap G-11: section 12 calls `launch-review-reveal` width-driven,
 *                    but both new zones sit in the added HEIGHT band (y 420-570). The added
 *                    width is what lets the mode ribbon absorb the slot and start status.
 *  - `resettableLine` gap G-12: section 14 mentions a "resettable line" with no channel, no
 *                    zone and no control. Nothing is rendered for it.
 *  - `launchArmControlIsExternal` gap G-7: section 13 lists a launch-arm control and section
 *                    11.5 calls it a macro button, but neither zone list gives it a zone. It is
 *                    a HARDWARE/macro control here, delivered as a window event, and occupies
 *                    no pixels on either canvas.
 *  - `warmUpTargetsDeclared` gap G-4 leaves the warm-up targets undefined. They are declared
 *                    CONFIGURATION in `RC20_WARMUP_TARGET_C`, printed with their `DECLARED`
 *                    provenance in the app warm-up map, and never presented as telemetry.
 */
export const RC20_PACKET_OMISSIONS = Object.freeze({
  startLightLadderStages:
    'packet 11.1/G-5 five-stage build: the only real start feed resolves four states, so S1-S4 are never decoded',
  startLightFeedOffIracing:
    'sessionFlagsRaw is the iRacing SessionFlags bitfield only on iRacing; LMU puts mGamePhase there',
  abortStage: 'packet G-5 ABORT member: no channel in the app reports a start abort',
  launchRpmTarget: 'packet 16 ECU launch channel does not exist; the band is operator-declared or hidden',
  gridSlot: 'packet 16/G-8 grid slot: no channel; position is the RACE position and is never assumed to be a slot',
  waterTempGearFuel: 'packet G-2: water temperature, gear and fuel level are zoneless on both canvases',
  shiftLedReturn: 'packet 11.4/20 shift-LED return: section 11.1 allocates the arc no zone on either canvas',
  wheelspinReview: 'packet 12.1 wheelspin review: section 16 supplies no wheelspin channel',
  brakeAxleAggregation: 'packet 16 "per axle/corner": an axle publishes only when BOTH its corners are fresh',
  ladderGutterNo6: 'override NO-6: the packet 11.1 4 px header gutter is not implementable; ladder origin y 48',
  gridStripEightCells: 'override NO-7: the nine-cell strip measures 801.6 px in a 768 px zone; eight cells ship',
  twoRedTokens: 'override NO-8: danger and signature are 16.49 apart in RGB and are separated semantically',
  appCanvasModeAndSlot: 'packet G-3: 12.1 drops the mode indicator and the strip; a mode ribbon carries both',
  ladderDominanceIsPositional: 'packet G-9: dominance is restated as centred and tallest, not largest by area',
  expansionIsHeightDriven: 'packet G-11: launch-review-reveal adds its two modules in the added HEIGHT band',
  resettableLine: 'packet G-12 resettable line: no channel, no zone and no control exist for it',
  launchArmControlIsExternal: 'packet G-7: the launch-arm macro is a hardware control and occupies no pixels',
  warmUpTargetsDeclared: 'packet G-4: the warm-up targets are declared configuration, printed with provenance'
})

// ─────────────────────────────────────────────────────────── palette

/**
 * Packet 11.3 tokens, verbatim, shipped exactly (override NO-5: the reference renderer draws
 * `#12141C` one to four luminance units dark, which is a renderer artefact and not a token
 * change). `panel` − `bg` is a luminance step of 11, above the >= 9 floor RC-18 established.
 *
 * Override NO-8: `danger` and `signature` are 16.49 apart in RGB, so they are separated by
 * MEANING — `signature` is bound to the lit ladder bar and to nothing else, `danger` to the
 * alert layer and to nothing else. A silent frame therefore contains no `danger` pixel at all.
 */
export const RC20_TOKENS = Object.freeze({
  bg: '#08090C',
  panel: '#12141C',
  primary: '#F2F4F8',
  secondary: '#939AAC',
  info: '#4A8CFF',
  normal: '#38D06A',
  caution: '#FFC22E',
  danger: '#FF3A2E',
  signature: '#FF2A2A'
})

/** Override NO-5's measured requirement: the rendered card must clear the canvas by >= 9. */
export const RC20_PANEL_LUMINANCE_STEP = 11
export const RC20_PANEL_LUMINANCE_STEP_MIN = 9

// ─────────────────────────────────────────────────────────── start-light ladder

/**
 * Packet 11.1's ladder is five bars. That count is structural and never varies: a start-lights
 * structure is a counting structure, and the suite asserts exactly five bars in every layout.
 */
export const RC20_LADDER_BAR_COUNT = 5

/**
 * Gap G-5 asks for the stage enum to be enumerated with `RELEASED` explicit. `S1`..`S5` are the
 * five ladder bars; `RELEASED` is lights-out, which EXTINGUISHES the ladder — that is the
 * artifact's own title and the reason the released frame is dark rather than fully lit.
 */
export const RC20_START_STAGES = [
  'DARK',
  'ARMED',
  'S1',
  'S2',
  'S3',
  'S4',
  'S5',
  'RELEASED',
  'ABORT'
] as const
export type Rc20StartStage = (typeof RC20_START_STAGES)[number]

/** Packet 19: the stage is always spelled out, so the ladder is never colour-only. */
export const RC20_STAGE_UNAVAILABLE = '--'

/** Packet 11.5/19: the ladder is a generic training aid and never an official start signal. */
export const RC20_LADDER_DISCLAIMER = 'TRAINING AID'
export const RC20_START_SOURCE_LIVE = 'START LIGHT SOURCE'
export const RC20_START_FEED_UNAVAILABLE = 'NO START LIGHT SOURCE'

/**
 * iRacing `SessionFlags` start bits — the one genuine start-system light state feed the app
 * carries. `StartGo` is 0x80000000, which is negative when the bitfield arrives as a signed
 * int, so every read is normalised with `>>> 0` exactly as the provider's own diagnostics do.
 */
export const RC20_IRACING_START_BITS = Object.freeze({
  startHidden: 0x1000_0000,
  startReady: 0x2000_0000,
  startSet: 0x4000_0000,
  startGo: 0x8000_0000
})

/**
 * How many of the five bars a stage lights. `RELEASED` and `ABORT` light NONE: lights-out is an
 * extinguished ladder, and an aborted start must never look like a building one.
 */
export function rc20LitBarsForStage(stage: Rc20StartStage | null): number {
  switch (stage) {
    case 'S1':
      return 1
    case 'S2':
      return 2
    case 'S3':
      return 3
    case 'S4':
      return 4
    case 'S5':
      return 5
    case 'DARK':
    case 'ARMED':
    case 'RELEASED':
    case 'ABORT':
    case null:
    default:
      return 0
  }
}

/** True only once the release stage has actually been reported by the feed. */
export function rc20StageIsReleased(stage: Rc20StartStage | null): boolean {
  return stage === 'RELEASED'
}

/**
 * Decodes the start stage from the ONLY lawful source. Hard-gated to iRacing: `sessionFlagsRaw`
 * carries `mGamePhase` on the LMU provider and would decode into nonsense. Any other sim, or a
 * missing/non-finite bitfield, returns `null` — the packet's "keep dark if feed absent".
 *
 * `StartSet` maps to `S5` because "set" IS the fully built ladder; `StartReady` maps to `ARMED`
 * because the ladder is live but has not begun to build. The feed has no per-light resolution,
 * so `S1`..`S4` are never produced — see `RC20_PACKET_OMISSIONS.startLightLadderStages`.
 */
export function rc20StartStageFromSnapshot(
  snapshot: TelemetrySnapshot | null | undefined
): Rc20StartStage | null {
  if (!snapshot || snapshot.sim !== 'iracing') return null
  const raw = snapshot.sessionFlagsRaw
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  const bits = raw >>> 0
  if ((bits & RC20_IRACING_START_BITS.startGo) !== 0) return 'RELEASED'
  if ((bits & RC20_IRACING_START_BITS.startSet) !== 0) return 'S5'
  if ((bits & RC20_IRACING_START_BITS.startReady) !== 0) return 'ARMED'
  if ((bits & RC20_IRACING_START_BITS.startHidden) !== 0) return 'DARK'
  return null
}

/** The stage's ordinal in the enum; used only to detect a real forward transition. */
export function rc20StageRank(stage: Rc20StartStage | null): number | null {
  if (stage === null) return null
  const index = RC20_START_STAGES.indexOf(stage)
  return index < 0 ? null : index
}

// ─────────────────────────────────────────────────────────── display mode

/** Packet 11.1's mode indicator. These are DISPLAY states, never telemetry values. */
export const RC20_MODES = ['FORMATION', 'GRID', 'LAUNCH'] as const
export type Rc20Mode = (typeof RC20_MODES)[number]

export const RC20_MODE_UNAVAILABLE = '--'

/** Packet 11.5/13 launch-arm macro. Gap G-7: it is a hardware control and has no zone. */
export const RC20_LAUNCH_CONTROL_EVENT = 'racecon:lights-out-launch'

export interface Rc20LaunchBand {
  minRpm: number
  maxRpm: number
}

export interface Rc20LaunchControl {
  /** `'auto'` defers the mode entirely to the measured feeds; `'armed'` is the macro press. */
  arm: 'auto' | 'armed'
  /** The operator-declared launch band, or `null` while no target has been declared. */
  band: Rc20LaunchBand | null
}

export function createRc20LaunchControl(): Rc20LaunchControl {
  return { arm: 'auto', band: null }
}

/** A band is real only if both bounds are finite, positive and strictly ordered. */
export function rc20LaunchBand(minRpm: unknown, maxRpm: unknown): Rc20LaunchBand | null {
  if (!finite(minRpm) || !finite(maxRpm)) return null
  if (minRpm <= 0 || maxRpm <= minRpm) return null
  return { minRpm, maxRpm }
}

/**
 * Only a recognised payload changes the control; an unknown payload is ignored outright so a
 * stray event can never arm the launch cues or invent a band. Mirrors RC-08's driver toggle.
 */
export function rc20LaunchControlFromEvent(
  detail: unknown,
  current: Rc20LaunchControl
): Rc20LaunchControl | null {
  if (detail === 'auto' || detail === null) return createRc20LaunchControl()
  if (typeof detail === 'string') {
    const command = detail.trim().toUpperCase()
    if (command === 'ARM') return { arm: 'armed', band: current.band }
    if (command === 'DISARM') return { arm: 'auto', band: current.band }
    if (command === 'AUTO') return createRc20LaunchControl()
    return null
  }
  if (typeof detail !== 'object') return null
  const payload = detail as { command?: unknown; bandMinRpm?: unknown; bandMaxRpm?: unknown }
  const hasCommand = typeof payload.command === 'string'
  const hasBand = 'bandMinRpm' in payload || 'bandMaxRpm' in payload
  if (!hasCommand && !hasBand) return null

  let arm = current.arm
  if (hasCommand) {
    const command = String(payload.command).trim().toUpperCase()
    if (command === 'ARM') arm = 'armed'
    else if (command === 'DISARM' || command === 'AUTO') arm = 'auto'
    else return null
  }
  let band = current.band
  if (hasBand) {
    if (payload.bandMinRpm === null || payload.bandMaxRpm === null) band = null
    else {
      const next = rc20LaunchBand(payload.bandMinRpm, payload.bandMaxRpm)
      if (next === null) return null
      band = next
    }
  }
  return { arm, band }
}

export interface Rc20ModeInputs {
  /** The decoded start-light stage, or `null` when no start-system feed exists. */
  stage: Rc20StartStage | null
  /** `sessionState` from the provider, when the session-phase feed exists. */
  sessionPhase: TelemetrySnapshot['sessionState'] | null
  /** True while `paceMode` reports one of the sim's own pacing formations. */
  pacing: boolean
  /** The section 11.5 macro. `'armed'` promotes a measured FORMATION to GRID. */
  arm: 'auto' | 'armed'
}

/**
 * Packet 11.5: the mode advances via display switch/event, so it is a DISPLAY state resolved
 * from real feeds and the driver's own macro — never a telemetry value and never a guess.
 *
 * `DARK` is deliberately NOT evidence of gridding: iRacing keeps `StartHidden` set through
 * green-flag racing, so treating it as a start sequence would park the display in GRID for the
 * whole race. Only `ARMED` and `S1`..`S5` are an active start sequence.
 *
 * With no start feed, no session phase and no pacing report there is nothing to resolve, so the
 * mode is `null` and every launch cue stays disarmed — the packet's own gate.
 */
export function rc20ModeForInputs(inputs: Rc20ModeInputs): Rc20Mode | null {
  const { stage, sessionPhase, pacing, arm } = inputs
  if (stage === 'RELEASED' || sessionPhase === 'racing') return 'LAUNCH'
  if (stage === 'ARMED' || stage === 'S1' || stage === 'S2' || stage === 'S3' || stage === 'S4' || stage === 'S5') {
    return 'GRID'
  }
  if (stage === 'ABORT') return 'GRID'
  const phaseKnown = sessionPhase !== null && sessionPhase !== undefined && sessionPhase !== 'invalid'
  if (arm === 'armed' && (phaseKnown || pacing || stage !== null)) return 'GRID'
  if (sessionPhase === 'paradeLaps' || sessionPhase === 'warmup' || pacing) return 'FORMATION'
  return null
}

/** Packet 11.5/20: launch cues exist only in GRID and LAUNCH. FORMATION never arms them. */
export function rc20LaunchCuesArmed(mode: Rc20Mode | null): boolean {
  return mode === 'GRID' || mode === 'LAUNCH'
}

/** True while the sim reports one of its own pacing formations. Never inferred from speed. */
export function rc20IsPacing(snapshot: TelemetrySnapshot | null | undefined): boolean {
  const mode = snapshot?.paceMode
  return mode === 'singleFileStart' || mode === 'doubleFileStart' || mode === 'singleFileRestart' || mode === 'doubleFileRestart'
}

// ─────────────────────────────────────────────────────────── channels

/**
 * Packet section 16 freshness budgets. The clutch's 20 ms budget is BELOW the transport floor
 * (`RC01_MIN_STREAM_FRESH_MS`, the slowest provider cadence plus its jitter budget), so it is
 * raised to the floor exactly as RC-01 raises the packet's 50 ms gear budget: a budget tighter
 * than the transport would grey a perfectly healthy channel on every other frame.
 *
 * Tyre and brake corners take section 16's 200 ms verbatim. The start stage is declared "event"
 * and is republished on every frame by the provider, so its budget is a TRANSPORT budget —
 * generous, but finite, so a provider that falls silent extinguishes the ladder instead of
 * freezing it on a stage that may already have been released.
 *
 * There is deliberately NO `waterTemp`, `gear` or `fuel` entry (gap G-2, zoneless on both
 * canvases) and no `rpm` entry: RPM is projected by the shared RC-01 model, whose 200 ms budget
 * and freeze-plus-grey degradation are already section 16's rule for it, verbatim.
 */
export const RC20_TRANSPORT_FLOOR_MS = RC01_MIN_STREAM_FRESH_MS
export const RC20_EVENT_TRANSPORT_MS = 1_000

export const RC20_CHANNEL_STALE_MS = {
  startStage: RC20_EVENT_TRANSPORT_MS,
  clutch: RC20_TRANSPORT_FLOOR_MS,
  tyreLf: 200,
  tyreRf: 200,
  tyreLr: 200,
  tyreRr: 200,
  brakeLf: 200,
  brakeRf: 200,
  brakeLr: 200,
  brakeRr: 200
} as const

export type Rc20AuxChannel = keyof typeof RC20_CHANNEL_STALE_MS

/** Packet 11.1's thermal reading order, shared by the strip and the app warm-up map. */
export const RC20_CORNERS = ['LF', 'RF', 'LR', 'RR'] as const
export type Rc20Corner = (typeof RC20_CORNERS)[number]

export const RC20_TYRE_CHANNELS: Readonly<Record<Rc20Corner, Rc20AuxChannel>> = Object.freeze({
  LF: 'tyreLf',
  RF: 'tyreRf',
  LR: 'tyreLr',
  RR: 'tyreRr'
})

export const RC20_BRAKE_CHANNELS: Readonly<Record<Rc20Corner, Rc20AuxChannel>> = Object.freeze({
  LF: 'brakeLf',
  RF: 'brakeRf',
  LR: 'brakeLr',
  RR: 'brakeRr'
})

/** Section 16's "per axle" half. Override NO-7 keeps the strip to two axle cells. */
export const RC20_BRAKE_AXLES = ['FRT', 'REAR'] as const
export type Rc20BrakeAxle = (typeof RC20_BRAKE_AXLES)[number]

export const RC20_BRAKE_AXLE_CORNERS: Readonly<Record<Rc20BrakeAxle, readonly Rc20Corner[]>> =
  Object.freeze({
    FRT: ['LF', 'RF'],
    REAR: ['LR', 'RR']
  })

/**
 * Override NO-7: exactly eight strip cells — SLOT, four tyre corners, two brake axles and the
 * single `DEG C` unit tag. The nine-cell row with the `TIRE C` / `BRAKE C` group tags measures
 * 801.6 px in the 768 px zone at the section 11.2 type size and does not fit.
 */
export const RC20_GRID_STRIP_CELLS = ['SLOT', 'LF', 'RF', 'LR', 'RR', 'FRT', 'REAR', 'DEG C'] as const
export const RC20_GRID_STRIP_CELL_COUNT = RC20_GRID_STRIP_CELLS.length

/**
 * Gap G-4 leaves the warm-up targets undefined. They are declared CONFIGURATION here, not
 * telemetry: they decide the packet 15 cold-warm-up trigger and are printed in the app warm-up
 * map with an explicit `DECLARED` provenance so they can never be mistaken for a measurement.
 */
export const RC20_WARMUP_TARGET_C = Object.freeze({ tyreC: 80, brakeC: 350 })

/** Packet 15's "car moves" threshold, declared numerically because section 15 does not. */
export const RC20_JUMP_START_SPEED_KMH = 1

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

export type Rc20Field = Rc01Field

/**
 * Every RC-20 channel is read straight from its own declared source. Nothing is modelled,
 * mirrored or substituted: the clutch never from the pedal map, each tyre corner strictly from
 * its own sensor, each brake corner strictly from its own sensor, and the start stage strictly
 * from the one provider bitfield that genuinely carries it.
 */
export function rc20AuxChannelValue(
  snapshot: TelemetrySnapshot,
  channel: Rc20AuxChannel
): number | string | null {
  switch (channel) {
    case 'startStage':
      return rc20StartStageFromSnapshot(snapshot)
    // Section 16: the clutch POSITION sensor, 0..1 from the provider, published as a percent.
    case 'clutch':
      return finite(snapshot.clutch) && snapshot.clutch >= 0 && snapshot.clutch <= 1
        ? snapshot.clutch * 100
        : null
    case 'tyreLf':
      return finite(snapshot.tyres?.lf?.tempC) ? snapshot.tyres!.lf.tempC! : null
    case 'tyreRf':
      return finite(snapshot.tyres?.rf?.tempC) ? snapshot.tyres!.rf.tempC! : null
    case 'tyreLr':
      return finite(snapshot.tyres?.lr?.tempC) ? snapshot.tyres!.lr.tempC! : null
    case 'tyreRr':
      return finite(snapshot.tyres?.rr?.tempC) ? snapshot.tyres!.rr.tempC! : null
    case 'brakeLf':
      return finite(snapshot.brakeTempC?.lf) ? snapshot.brakeTempC!.lf : null
    case 'brakeRf':
      return finite(snapshot.brakeTempC?.rf) ? snapshot.brakeTempC!.rf : null
    case 'brakeLr':
      return finite(snapshot.brakeTempC?.lr) ? snapshot.brakeTempC!.lr : null
    case 'brakeRr':
      return finite(snapshot.brakeTempC?.rr) ? snapshot.brakeTempC!.rr : null
  }
  return null
}

/**
 * Receipts for RC-20's own channels, with exactly RC-01's semantics: a receipt is written only
 * when the channel actually reports, so a channel that falls silent ages out and degrades to
 * its packet state instead of freezing on its last value.
 */
export class Rc20AuxBuffer {
  private channelReceipts = new Map<Rc20AuxChannel, Rc01ChannelReceipt>()

  clone(): Rc20AuxBuffer {
    const next = new Rc20AuxBuffer()
    next.channelReceipts = new Map(this.channelReceipts)
    return next
  }

  reset(): void {
    this.channelReceipts = new Map()
  }

  ingest(snapshot: TelemetrySnapshot | null | undefined, receivedAt = rc01MonotonicNow()): void {
    if (!snapshot || !snapshot.connected || !finite(snapshot.timestamp)) return
    const safeReceiptAt = finite(receivedAt) && receivedAt >= 0 ? receivedAt : rc01MonotonicNow()
    for (const channel of Object.keys(RC20_CHANNEL_STALE_MS) as Rc20AuxChannel[]) {
      const value = rc20AuxChannelValue(snapshot, channel)
      if (value === null) continue
      this.channelReceipts.set(
        channel,
        Object.freeze({ value, snapshotTimestamp: snapshot.timestamp, receivedAt: safeReceiptAt })
      )
    }
  }

  receipts(): ReadonlyMap<Rc20AuxChannel, Rc01ChannelReceipt> {
    return new Map(this.channelReceipts)
  }
}

export function createRc20AuxReceipts(
  snapshot: TelemetrySnapshot,
  receivedAt = rc01MonotonicNow()
): ReadonlyMap<Rc20AuxChannel, Rc01ChannelReceipt> {
  const buffer = new Rc20AuxBuffer()
  buffer.ingest(snapshot, receivedAt)
  return buffer.receipts()
}

interface Rc20Reading {
  value: number | string | null
  lastKnown: number | string | null
  stale: boolean
  ageMs: number
}

function auxReading(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc20AuxChannel, Rc01ChannelReceipt>,
  channel: Rc20AuxChannel,
  nowMs: number
): Rc20Reading {
  const raw = snapshot ? rc20AuxChannelValue(snapshot, channel) : null
  const receipt = receipts.get(channel)
  if (raw === null || !receipt) {
    return { value: null, lastKnown: null, stale: false, ageMs: Number.POSITIVE_INFINITY }
  }
  const ageMs = rc01ReceiptAgeMs(receipt, nowMs)
  const stale = ageMs > RC20_CHANNEL_STALE_MS[channel]
  return {
    value: stale ? null : raw,
    lastKnown: typeof receipt.value === 'boolean' ? null : receipt.value,
    stale,
    ageMs
  }
}

// ─────────────────────────────────────────────────────────── bar arithmetic

/**
 * Override NO-4: every fill is COMPUTED, never traced. Across six reference attempts the traced
 * clutch fill error was 0.9 / 5.1 / 4.8 / 5.0 / 2.5 / 1.1 pp and never converged, so the band
 * edges come from `(value - scaleMin) / (scaleMax - scaleMin)` and the clutch fill from
 * `clutchPct / 100`, and the suite asserts both against the numerals they sit beside.
 */
export function rc20ScaleFraction(value: number | null, scaleMin: number, scaleMax: number): number | null {
  if (value === null || !finite(value) || !finite(scaleMin) || !finite(scaleMax)) return null
  if (scaleMax <= scaleMin) return null
  return Math.max(0, Math.min(1, (value - scaleMin) / (scaleMax - scaleMin)))
}

/** A 0..1 fraction as a CSS percentage, without binary-float noise in the DOM. */
export function rc20Percent(value: number): string {
  const safe = finite(value) ? value : 0
  return `${Math.round(safe * 1_000) / 1_000}%`
}

/** The launch track's full-scale RPM. `maxRpm` is a real channel; nothing else is substituted. */
export function rc20LaunchScaleMaxRpm(snapshot: TelemetrySnapshot | null | undefined): number | null {
  const maxRpm = snapshot?.maxRpm
  return finite(maxRpm) && maxRpm > 0 ? maxRpm : null
}

// ─────────────────────────────────────────────────────────── zones

export interface Rc20Rect {
  left: number
  top: number
  width: number
  height: number
}

export type Rc20ZoneId = 'header' | 'ladder' | 'launch' | 'clutch' | 'strip' | 'warmup' | 'review'

export type Rc20ZoneMap = Readonly<Partial<Record<Rc20ZoneId, Rc20Rect>>>

function round3(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

function rect(xPx: number, yPx: number, wPx: number, hPx: number, canvasW: number, canvasH: number): Rc20Rect {
  return {
    left: round3((xPx / canvasW) * 100),
    top: round3((yPx / canvasH) * 100),
    width: round3((wPx / canvasW) * 100),
    height: round3((hPx / canvasH) * 100)
  }
}

/**
 * Packet 11.1's zones for the 800x480 canvas, computed from the packet's own PIXELS and never
 * traced off the approved render (override NO-1: the render drifted up to +28 px vertically and
 * +40 px horizontally). The single deviation is override NO-6: the ladder origin moves from
 * y 40 to y 48 because the packet's 4 px header gutter is not implementable, and its foot stays
 * on the packet's y 340, which leaves 12 px clear above and 12 px clear below.
 */
export const RC20_NATIVE_ZONES: Rc20ZoneMap = Object.freeze({
  header: rect(16, 12, 768, 24, RC20_NATIVE_WIDTH_PX, RC20_NATIVE_HEIGHT_PX),
  ladder: rect(300, 48, 200, 292, RC20_NATIVE_WIDTH_PX, RC20_NATIVE_HEIGHT_PX),
  launch: rect(40, 80, 220, 200, RC20_NATIVE_WIDTH_PX, RC20_NATIVE_HEIGHT_PX),
  clutch: rect(540, 80, 220, 200, RC20_NATIVE_WIDTH_PX, RC20_NATIVE_HEIGHT_PX),
  strip: rect(16, 352, 768, 60, RC20_NATIVE_WIDTH_PX, RC20_NATIVE_HEIGHT_PX)
})

/**
 * Packet 12.1's `launch-review-reveal` reflow, verbatim, plus the gap G-3 mode ribbon that
 * section 12.1 drops and section 19 requires. The ribbon also carries the slot and start status
 * that the 800x480 strip carries, which is what the added WIDTH actually buys (gap G-11); the
 * two genuinely new modules — the formation warm-up map and the post-start launch review — sit
 * in the added HEIGHT band and never appear on the 800x480 canvas.
 *
 * Gap G-9: the ladder is not the largest zone here, so dominance is positional and structural —
 * it is centred on x 50 % and is the tallest zone on the canvas.
 */
export const RC20_APP_ZONES: Rc20ZoneMap = Object.freeze({
  header: rect(48, 6, 928, 30, RC20_APP_WIDTH_PX, RC20_APP_HEIGHT_PX),
  ladder: rect(412, 48, 200, 360, RC20_APP_WIDTH_PX, RC20_APP_HEIGHT_PX),
  launch: rect(48, 80, 300, 300, RC20_APP_WIDTH_PX, RC20_APP_HEIGHT_PX),
  clutch: rect(676, 80, 300, 300, RC20_APP_WIDTH_PX, RC20_APP_HEIGHT_PX),
  warmup: rect(48, 420, 600, 150, RC20_APP_WIDTH_PX, RC20_APP_HEIGHT_PX),
  review: rect(676, 420, 300, 150, RC20_APP_WIDTH_PX, RC20_APP_HEIGHT_PX)
})

/**
 * Compact breakpoints are not packet-specified. They keep the five-zone start grammar and drop
 * only the two app-only modules, so the ladder, the launch band, the clutch bar and the strip —
 * and therefore all three alert surfaces — stay visible at every size.
 */
const RC20_COMPACT_STANDARD_ZONES: Rc20ZoneMap = Object.freeze({
  header: { left: 2, top: 2.5, width: 96, height: 5.5 },
  ladder: { left: 37.5, top: 10.5, width: 25, height: 59 },
  launch: { left: 5, top: 17, width: 27.5, height: 41 },
  clutch: { left: 67.5, top: 17, width: 27.5, height: 41 },
  strip: { left: 2, top: 73, width: 96, height: 14 }
})

const RC20_COMPACT_LANDSCAPE_ZONES: Rc20ZoneMap = Object.freeze({
  header: { left: 2, top: 2, width: 96, height: 6 },
  ladder: { left: 37.5, top: 11, width: 25, height: 58 },
  launch: { left: 5, top: 16, width: 27.5, height: 46 },
  clutch: { left: 67.5, top: 16, width: 27.5, height: 46 },
  strip: { left: 2, top: 72, width: 96, height: 16 }
})

/**
 * Portrait stacks the grammar: the ladder becomes a wide five-bar row across the top, the two
 * side cards sit shoulder to shoulder beneath it, and the strip takes the tall remainder so its
 * eight cells can wrap into a grid rather than being crushed into one 360 px row.
 */
const RC20_COMPACT_PHONE_ZONES: Rc20ZoneMap = Object.freeze({
  header: { left: 2, top: 1.5, width: 96, height: 5 },
  ladder: { left: 2, top: 8.5, width: 96, height: 22 },
  launch: { left: 2, top: 32.5, width: 46.5, height: 24 },
  clutch: { left: 51.5, top: 32.5, width: 46.5, height: 24 },
  strip: { left: 2, top: 58.5, width: 96, height: 39.5 }
})

export function rc20CompactZones(mode: Rc20CompactMode): Rc20ZoneMap {
  if (mode === 'phone') return RC20_COMPACT_PHONE_ZONES
  if (mode === 'landscape') return RC20_COMPACT_LANDSCAPE_ZONES
  return RC20_COMPACT_STANDARD_ZONES
}

export function rc20ZonesForLayout(layout: Rc20Layout, compactMode: Rc20CompactMode = 'standard'): Rc20ZoneMap {
  if (layout === 'native') return RC20_NATIVE_ZONES
  if (layout === 'app') return RC20_APP_ZONES
  return rc20CompactZones(compactMode)
}

/** The inline geometry a zone element carries, so CSS and the packet table cannot drift. */
export function rc20ZoneStyle(rect: Rc20Rect | undefined): {
  left: string
  top: string
  width: string
  height: string
} | null {
  if (!rect) return null
  return {
    left: rc20Percent(rect.left),
    top: rc20Percent(rect.top),
    width: rc20Percent(rect.width),
    height: rc20Percent(rect.height)
  }
}

export function rc20RectsOverlap(a: Rc20Rect, b: Rc20Rect): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  )
}

/** Gap G-9: the ladder's dominance is positional, so its centring is asserted, not its area. */
export function rc20RectCentreX(rect: Rc20Rect): number {
  return round3(rect.left + rect.width / 2)
}

// ─────────────────────────────────────────────────────────── layout resolution

export function rc20LayoutForContentBox(width: number, height: number): Rc20Layout {
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return 'app'
  if (
    Math.abs(width - RC20_NATIVE_WIDTH_PX) <= RC20_NATIVE_TOLERANCE_PX &&
    Math.abs(height - RC20_NATIVE_HEIGHT_PX) <= RC20_NATIVE_TOLERANCE_PX
  ) {
    return 'native'
  }
  if (width >= RC20_APP_WIDTH_PX - 1 && height >= RC20_APP_HEIGHT_PX - 1) return 'app'
  return 'compact'
}

export function rc20CompactModeForContentBox(width: number, height: number): Rc20CompactMode {
  if (rc20LayoutForContentBox(width, height) !== 'compact') return 'standard'
  if (
    width >= RC20_PHONE_MIN_WIDTH_PX &&
    width <= RC20_PHONE_MAX_WIDTH_PX &&
    height >= RC20_PHONE_MIN_HEIGHT_PX &&
    height / width >= 1.5
  ) {
    return 'phone'
  }
  if (
    width >= RC20_LANDSCAPE_MIN_WIDTH_PX &&
    height >= RC20_LANDSCAPE_MIN_HEIGHT_PX &&
    height <= RC20_LANDSCAPE_MAX_HEIGHT_PX &&
    width / height >= 1.5
  ) {
    return 'landscape'
  }
  return 'standard'
}

// ─────────────────────────────────────────────────────────── type scale

/**
 * The section 11.2 typographic ladder, in pixels on the 800x480 canvas, computed arithmetically
 * from the packet and NOT measured off the approved render (override NO-1). Four steps, no
 * ties: launch RPM 64 → clutch 44 → strip values 30 → every label, unit, caption and mode word
 * 17. Adjacent separations are 31.3 % / 31.8 % / 43.3 %, all far above the 8 % floor the
 * re-adjudication set after attempts 004 and 006 returned the chain to a tie and inverted it.
 *
 * Gap G-10: section 11.2 gives the mode header no size at all and calls the ladder "large
 * segments", which is not a type size. The header takes the label step (its 24 px zone caps
 * capitals at about 17 px anyway) and the ladder carries no numeral of its own — its stage
 * caption and its `TRAINING AID` disclaimer are both label-step captions.
 */
export const RC20_TYPE_SCALE_PX = Object.freeze({
  rpm: 64,
  clutch: 44,
  strip: 30,
  label: 17
})

export const RC20_TYPE_SCALE_MIN_SEPARATION_PCT = 8

/** Weight carries the ladder's structural primacy, since it has no numeral to size. */
export const RC20_TYPE_WEIGHTS = Object.freeze({
  rpm: 800,
  clutch: 700,
  strip: 600,
  label: 600
})

/** One container-query width unit is one hundredth of the native canvas: 800 / 100 = 8 px. */
export const RC20_CQW_PX = RC20_NATIVE_WIDTH_PX / 100

/** The packet's px ladder expressed in the container units the stylesheet actually uses. */
export function rc20TypeScaleCqw(px: number): number {
  return Math.round((px / RC20_CQW_PX) * 1_000) / 1_000
}

/** The adjacent separations the suite asserts are strictly descending and never tie. */
export function rc20TypeScaleSeparationsPct(): readonly number[] {
  const steps = [RC20_TYPE_SCALE_PX.rpm, RC20_TYPE_SCALE_PX.clutch, RC20_TYPE_SCALE_PX.strip, RC20_TYPE_SCALE_PX.label]
  const out: number[] = []
  for (let index = 1; index < steps.length; index += 1) {
    out.push(Math.round(((steps[index - 1] - steps[index]) / steps[index - 1]) * 1_000) / 10)
  }
  return out
}

// ─────────────────────────────────────────────────────────── measured launch review

/**
 * Packet 12.1's post-start review is MEASURED, never reconstructed. A reaction is recorded only
 * when BOTH bounding events were observed on this mount — the release itself, and the first
 * movement after it. A display mounted mid-launch has not seen the release, so it records
 * nothing and dashes, rather than writing a truncated fragment that would misreport the driver
 * for the rest of the session. This is the RC-02 sector rule applied to a start.
 */
export const RC20_LAUNCH_REVIEW_MAX_REACTION_MS = 30_000

export interface Rc20LaunchReview {
  /** Milliseconds from the observed release to the first observed movement. */
  reactionMs: number | null
  /** RPM at the observed release instant, from the shared RC-01 RPM projection. */
  releaseRpm: number | null
  /** Clutch percent at the observed release instant, from the clutch position sensor. */
  releaseClutchPct: number | null
  /** True once a release has been observed on this mount. */
  releaseObserved: boolean
}

export interface Rc20LaunchReviewInput {
  nowMs: number
  released: boolean
  speedKmh: number | null
  rpm: number | null
  clutchPct: number | null
}

export class Rc20LaunchReviewBuffer {
  private releaseAtMs: number | null = null
  private releaseRpm: number | null = null
  private releaseClutchPct: number | null = null
  private reactionMs: number | null = null
  private sawPreRelease = false

  clone(): Rc20LaunchReviewBuffer {
    const next = new Rc20LaunchReviewBuffer()
    next.releaseAtMs = this.releaseAtMs
    next.releaseRpm = this.releaseRpm
    next.releaseClutchPct = this.releaseClutchPct
    next.reactionMs = this.reactionMs
    next.sawPreRelease = this.sawPreRelease
    return next
  }

  reset(): void {
    this.releaseAtMs = null
    this.releaseRpm = null
    this.releaseClutchPct = null
    this.reactionMs = null
    this.sawPreRelease = false
  }

  observe(input: Rc20LaunchReviewInput): void {
    const nowMs = finite(input.nowMs) ? input.nowMs : 0
    if (!input.released) {
      this.sawPreRelease = true
      return
    }
    // The release is only a measurable EVENT if this mount also saw the frame before it.
    if (!this.sawPreRelease) return
    if (this.releaseAtMs === null) {
      this.releaseAtMs = nowMs
      this.releaseRpm = input.rpm
      this.releaseClutchPct = input.clutchPct
      return
    }
    if (this.reactionMs !== null) return
    if (input.speedKmh === null || input.speedKmh < RC20_JUMP_START_SPEED_KMH) return
    const elapsed = nowMs - this.releaseAtMs
    if (elapsed < 0 || elapsed > RC20_LAUNCH_REVIEW_MAX_REACTION_MS) return
    this.reactionMs = elapsed
  }

  review(): Rc20LaunchReview {
    return {
      reactionMs: this.reactionMs,
      releaseRpm: this.releaseRpm,
      releaseClutchPct: this.releaseClutchPct,
      releaseObserved: this.releaseAtMs !== null
    }
  }
}

// ─────────────────────────────────────────────────────────── alerts

/** Packet 15: launch over-rev engages after 60 ms and needs 250 ms back in band to clear. */
export const RC20_OVER_REV_ENGAGE_MS = 60
export const RC20_OVER_REV_HYSTERESIS_MS = 250
/** Packet 15: jump-start risk engages after 80 ms of movement before the release stage. */
export const RC20_JUMP_START_ENGAGE_MS = 80
/** Packet 15: a warm-up location must sit below its declared target for 3 s. */
export const RC20_COLD_WARMUP_ENGAGE_MS = 3_000

export type Rc20WarmupLocation = Rc20Corner | Rc20BrakeAxle

export const RC20_WARMUP_LOCATIONS: readonly Rc20WarmupLocation[] = Object.freeze([
  ...RC20_CORNERS,
  ...RC20_BRAKE_AXLES
])

export interface Rc20AlertState {
  launchOverRev: {
    active: boolean
    pendingSinceMs: number | null
    recoverySinceMs: number | null
  }
  jumpStart: {
    active: boolean
    pendingSinceMs: number | null
  }
  coldWarmup: {
    active: boolean
    pendingSinceMs: Readonly<Partial<Record<Rc20WarmupLocation, number>>>
    locations: readonly Rc20WarmupLocation[]
  }
}

export interface Rc20AlertInput {
  nowMs: number
  /** Packet 11.5/20: every launch cue is gated on GRID or LAUNCH. FORMATION arms nothing. */
  armed: boolean
  /** True only when a fresh RPM sits strictly above a DECLARED band ceiling. */
  overBandCeiling: boolean
  /** True while both a fresh RPM and a declared band exist; the over-rev trigger's validity. */
  overRevMeasurable: boolean
  /** True when the car is moving and the start feed has NOT reported the release stage. */
  movingBeforeRelease: boolean
  /** True once the start feed reports `RELEASED`; the packet's explicit clear condition. */
  released: boolean
  /** True while a start-light stage feed exists at all; without it jump-start cannot arm. */
  startFeedPresent: boolean
  /** True only in FORMATION mode, which is the cold-warm-up trigger's own gate. */
  formation: boolean
  /** Locations measured below their declared target this frame; a dashed sensor is absent. */
  coldLocations: readonly Rc20WarmupLocation[]
}

export function createRc20AlertState(): Rc20AlertState {
  return {
    launchOverRev: { active: false, pendingSinceMs: null, recoverySinceMs: null },
    jumpStart: { active: false, pendingSinceMs: null },
    coldWarmup: { active: false, pendingSinceMs: {}, locations: [] }
  }
}

function cloneRc20AlertState(state: Rc20AlertState): Rc20AlertState {
  return {
    launchOverRev: { ...state.launchOverRev },
    jumpStart: { ...state.jumpStart },
    coldWarmup: {
      ...state.coldWarmup,
      pendingSinceMs: { ...state.coldWarmup.pendingSinceMs },
      locations: [...state.coldWarmup.locations]
    }
  }
}

/**
 * Every alert is silent until its own trigger fires, carries the packet section 15 debounce and
 * hysteresis, has an explicit clear condition, and is unlatched the moment its input goes
 * missing, stale or out of sequence. No element of the alert layer is ever a decoration: the
 * approved reference frame is a GRID frame with all three alerts armed and SILENT, and the
 * governance chain measures zero amber and zero green connected components in it.
 */
export function advanceRc20Alerts(state: Rc20AlertState, input: Rc20AlertInput): Rc20AlertState {
  const nowMs = finite(input.nowMs) ? input.nowMs : 0
  const next = cloneRc20AlertState(state)

  // ── Launch over-rev: 60 ms above the DECLARED ceiling to engage, 250 ms back inside the band
  //    to clear. Without a declared band or a fresh RPM the trigger is not measurable at all,
  //    so the alert unlatches rather than holding on a ceiling that no longer exists.
  if (!input.armed || !input.overRevMeasurable) {
    next.launchOverRev = { active: false, pendingSinceMs: null, recoverySinceMs: null }
  } else if (input.overBandCeiling) {
    const pendingSinceMs = next.launchOverRev.pendingSinceMs ?? nowMs
    const engaged = next.launchOverRev.active || nowMs - pendingSinceMs >= RC20_OVER_REV_ENGAGE_MS
    next.launchOverRev = engaged
      ? { active: true, pendingSinceMs: null, recoverySinceMs: null }
      : { active: false, pendingSinceMs, recoverySinceMs: null }
  } else if (next.launchOverRev.active) {
    const recoverySinceMs = next.launchOverRev.recoverySinceMs ?? nowMs
    const cleared = nowMs - recoverySinceMs >= RC20_OVER_REV_HYSTERESIS_MS
    next.launchOverRev = cleared
      ? { active: false, pendingSinceMs: null, recoverySinceMs: null }
      : { active: true, pendingSinceMs: null, recoverySinceMs }
  } else {
    next.launchOverRev = { active: false, pendingSinceMs: null, recoverySinceMs: null }
  }

  // ── Jump-start risk: 80 ms of movement before the release stage. The packet's own clear
  //    condition is the release stage being REACHED, and its unavailable behaviour is to hide
  //    entirely when there is no start-light feed — never to simulate a start signal.
  if (!input.startFeedPresent || !input.armed || input.released) {
    next.jumpStart = { active: false, pendingSinceMs: null }
  } else if (input.movingBeforeRelease) {
    const pendingSinceMs = next.jumpStart.pendingSinceMs ?? nowMs
    const engaged = next.jumpStart.active || nowMs - pendingSinceMs >= RC20_JUMP_START_ENGAGE_MS
    next.jumpStart = engaged ? { active: true, pendingSinceMs: null } : { active: false, pendingSinceMs }
  } else {
    next.jumpStart = { active: false, pendingSinceMs: null }
  }

  // ── Cold warm-up: each location runs its OWN 3 s debounce, so one cold corner never marks
  //    another and a corner with no sensor can never engage. Outside FORMATION the trigger is
  //    gated false, which is exactly why the approved GRID reference frame is silent.
  if (!input.formation) {
    next.coldWarmup = { active: false, pendingSinceMs: {}, locations: [] }
  } else {
    const pending: Partial<Record<Rc20WarmupLocation, number>> = {}
    const locations: Rc20WarmupLocation[] = []
    for (const location of RC20_WARMUP_LOCATIONS) {
      if (!input.coldLocations.includes(location)) continue
      const since = next.coldWarmup.pendingSinceMs[location] ?? nowMs
      pending[location] = since
      if (nowMs - since >= RC20_COLD_WARMUP_ENGAGE_MS) locations.push(location)
    }
    next.coldWarmup = { active: locations.length > 0, pendingSinceMs: pending, locations }
  }

  return next
}

/** A stale, missing or refused input can never leave a sequence alert latched on. */
export function clearInvalidRc20Alerts(state: Rc20AlertState, model: Rc20DashboardModel): Rc20AlertState {
  const next = cloneRc20AlertState(state)
  if (!model.armed || model.band === null || model.rpm.unavailable || model.rpm.stale) {
    next.launchOverRev = { active: false, pendingSinceMs: null, recoverySinceMs: null }
  }
  if (!model.armed || model.stage === null || model.stageStale || rc20StageIsReleased(model.stage)) {
    next.jumpStart = { active: false, pendingSinceMs: null }
  }
  if (model.mode !== 'FORMATION') {
    next.coldWarmup = { active: false, pendingSinceMs: {}, locations: [] }
  }
  return next
}

/** The alert lines a surface renders; empty in a silent frame, which is the reference state. */
export function rc20AlertLines(model: Rc20DashboardModel): readonly string[] {
  const lines: string[] = []
  if (model.alerts.launchOverRev) lines.push('LAUNCH OVER-REV')
  if (model.alerts.jumpStart) lines.push('JUMP START')
  if (model.alerts.coldWarmup) lines.push('COLD WARM-UP')
  return lines
}

/** Projects the rendered model back into the alert layer's own input vocabulary. */
export function rc20AlertInputForModel(model: Rc20DashboardModel, nowMs: number): Rc20AlertInput {
  const rpmValue = typeof model.rpm.raw === 'number' && !model.rpm.stale && !model.rpm.unavailable ? model.rpm.raw : null
  const measurable = rpmValue !== null && model.band !== null
  return {
    nowMs,
    armed: model.armed,
    overBandCeiling: measurable && rpmValue > model.band!.maxRpm,
    overRevMeasurable: measurable,
    movingBeforeRelease:
      model.speedKmh !== null &&
      model.speedKmh >= RC20_JUMP_START_SPEED_KMH &&
      model.stage !== null &&
      !model.stageStale &&
      !rc20StageIsReleased(model.stage),
    released: model.stage !== null && rc20StageIsReleased(model.stage),
    startFeedPresent: model.stage !== null && !model.stageStale,
    formation: model.mode === 'FORMATION',
    coldLocations: model.coldLocations
  }
}

// ─────────────────────────────────────────────────────────── dashboard model

export interface Rc20LadderBar {
  index: number
  lit: boolean
}

export interface Rc20LadderModel {
  stage: Rc20StartStage | null
  stageLabel: string
  litBars: number
  bars: readonly Rc20LadderBar[]
  stale: boolean
  unavailable: boolean
  /** Packet 11.5/19: the disclaimer is rendered on every frame, at every breakpoint. */
  disclaimer: string
  /** The honesty caption shown whenever no start-system feed exists at all. */
  feedLabel: string
}

export interface Rc20BandModel {
  band: Rc20LaunchBand | null
  label: string
  /** `'declared'` while an operator band is live, `'none'` while the target is hidden. */
  source: 'declared' | 'none'
  /** 0..1 positions of the band edges on the track, or `null` without a full-scale RPM. */
  lowFraction: number | null
  highFraction: number | null
}

export interface Rc20WarmupCell {
  location: Rc20WarmupLocation
  kind: 'tyre' | 'brake'
  field: Rc01Field
  tempC: number | null
  targetC: number
  /** True only while the packet 15 cold-warm-up alert is latched on this location. */
  cold: boolean
}

export interface Rc20AlertFlags {
  launchOverRev: boolean
  jumpStart: boolean
  coldWarmup: boolean
}

export interface Rc20DashboardModel {
  mode: Rc20Mode | null
  modeLabel: string
  /** Packet 11.5/20: true only in GRID or LAUNCH, and every launch cue reads it. */
  armed: boolean
  ladder: Rc20LadderModel
  stage: Rc20StartStage | null
  stageStale: boolean
  /** Section 16 verbatim through the shared RC-01 projection: freeze + grey past 200 ms. */
  rpm: Rc01Field
  /** 0..1 needle position on the launch track, or `null` without a real full-scale RPM. */
  rpmFraction: number | null
  scaleMaxRpm: number | null
  scaleLabel: string
  band: Rc20LaunchBand | null
  bandModel: Rc20BandModel
  clutch: Rc01Field
  clutchPct: number | null
  clutchFraction: number | null
  clutchScaleLabel: string
  /** Gap G-8's integer half. No channel exists, so this is the grey dash for ever. */
  gridSlot: Rc01Field
  /** Gap G-8's enum half: the real start-sequence feed, spelled out. */
  startStatus: Rc01Field
  tyres: readonly Rc20WarmupCell[]
  brakeAxles: readonly Rc20WarmupCell[]
  /** Every warm-up location, tyre corners first, in the strip's own reading order. */
  warmup: readonly Rc20WarmupCell[]
  coldLocations: readonly Rc20WarmupLocation[]
  review: Rc20LaunchReview
  reviewFields: { reaction: Rc01Field; rpm: Rc01Field; clutch: Rc01Field }
  /** Alert input only; section 16 lists no speed row and none is ever rendered. */
  speedKmh: number | null
  alerts: Rc20AlertFlags
  auxFresh: Readonly<Record<Rc20AuxChannel, boolean>>
  criticalFresh: Readonly<Record<Rc01ChannelName, boolean>>
}

export interface Rc20ModelOptions {
  alerts?: Rc20AlertState
  /** The packet 11.5 launch-arm macro plus any operator-declared band. */
  control?: Rc20LaunchControl
  review?: Rc20LaunchReview
}

function emptyReview(): Rc20LaunchReview {
  return { reactionMs: null, releaseRpm: null, releaseClutchPct: null, releaseObserved: false }
}

function dash(text = '--'): Rc01Field {
  return field(text, null, false, true, 'muted')
}

/** Packet 19: every state is a WORD, so the ladder is never encoded by colour alone. */
export function rc20StageLabel(stage: Rc20StartStage | null, litBars: number): string {
  if (stage === null) return RC20_STAGE_UNAVAILABLE
  if (stage === 'RELEASED') return 'RELEASED'
  if (stage === 'ABORT') return 'ABORT'
  if (stage === 'DARK') return 'DARK'
  if (stage === 'ARMED') return 'ARMED'
  return `STAGE ${litBars} OF ${RC20_LADDER_BAR_COUNT}`
}

export function rc20LadderBars(litBars: number): readonly Rc20LadderBar[] {
  const lit = finite(litBars) ? Math.max(0, Math.min(RC20_LADDER_BAR_COUNT, Math.trunc(litBars))) : 0
  return Array.from({ length: RC20_LADDER_BAR_COUNT }, (_, index) => ({ index, lit: index < lit }))
}

/** An accessible name for one warm-up cell, including its DECLARED target's provenance. */
export function rc20WarmupDescription(cell: Rc20WarmupCell): string {
  const noun = cell.kind === 'tyre' ? 'Tyre' : 'Brake'
  const state = cell.field.unavailable
    ? 'no sensor'
    : cell.field.stale
      ? `${cell.field.value} degrees, stale`
      : `${cell.field.value} degrees`
  const cold = cell.cold ? ', below declared warm-up target' : ''
  return `${noun} ${cell.location}: ${state}${cold}`
}

function warmupCell(
  location: Rc20WarmupLocation,
  kind: 'tyre' | 'brake',
  reading: Rc20Reading,
  targetC: number,
  cold: boolean
): Rc20WarmupCell {
  if (typeof reading.value === 'number') {
    return {
      location,
      kind,
      field: field(String(Math.round(reading.value)), reading.value, false, false, 'primary'),
      tempC: reading.value,
      targetC,
      cold
    }
  }
  if (typeof reading.lastKnown === 'number') {
    // Section 16: a channel that falls silent greys its LAST KNOWN reading; it never freezes
    // on it silently and it never borrows its neighbour's number.
    return {
      location,
      kind,
      field: field(String(Math.round(reading.lastKnown)), reading.lastKnown, true, false, 'muted'),
      tempC: null,
      targetC,
      cold: false
    }
  }
  return { location, kind, field: dash(), tempC: null, targetC, cold: false }
}

/**
 * Section 16's "per axle/corner" aggregate. An axle publishes ONLY when both of its corner
 * sensors are present and fresh, so a single working corner is never mirrored onto the axle —
 * that is the tyre rule ("never mirror one corner to another") applied to the brake row.
 */
export function rc20AxleTempC(left: number | null, right: number | null): number | null {
  if (left === null || right === null || !finite(left) || !finite(right)) return null
  return (left + right) / 2
}

function formatMs(value: number): string {
  return `${(value / 1_000).toFixed(3)}`
}

/**
 * Projects the shared RC-01 telemetry model into RC-20's start-procedure display and adds the
 * start-sequence channels. Nothing is invented, estimated or mirrored: the start stage comes
 * only from the one provider bitfield that genuinely carries it, the launch target is never
 * fabricated, the grid slot is never assumed from the race position, one tyre corner is never
 * mirrored onto another, a brake axle is never published from one corner, and every unavailable
 * channel renders its packet dash state.
 */
export function createRc20DashboardModel(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc01ChannelName, Rc01ChannelReceipt> = new Map(),
  auxReceipts: ReadonlyMap<Rc20AuxChannel, Rc01ChannelReceipt> = new Map(),
  nowMs = rc01MonotonicNow(),
  options: Rc20ModelOptions = {}
): Rc20DashboardModel {
  const base: Rc01DashboardModel = createRc01DashboardModel(snapshot, receipts, nowMs)
  const safeSnapshot = snapshot && snapshot.connected ? snapshot : null
  const alerts = options.alerts ?? createRc20AlertState()
  const control = options.control ?? createRc20LaunchControl()
  const review = options.review ?? emptyReview()

  const auxFresh = Object.fromEntries(
    (Object.keys(RC20_CHANNEL_STALE_MS) as Rc20AuxChannel[]).map((channel) => [
      channel,
      auxReading(safeSnapshot, auxReceipts, channel, nowMs).value !== null
    ])
  ) as Record<Rc20AuxChannel, boolean>

  // ── Start-light stage. The receipt keeps the observed stage word, so a feed that falls
  //    silent greys out and extinguishes rather than holding a stage that may have released.
  const stageReading = auxReading(safeSnapshot, auxReceipts, 'startStage', nowMs)
  const stage =
    typeof stageReading.value === 'string' && (RC20_START_STAGES as readonly string[]).includes(stageReading.value)
      ? (stageReading.value as Rc20StartStage)
      : null
  const stageStale = stage === null && stageReading.stale
  const litBars = rc20LitBarsForStage(stage)
  const ladder: Rc20LadderModel = {
    stage,
    stageLabel: rc20StageLabel(stage, litBars),
    litBars,
    bars: rc20LadderBars(litBars),
    stale: stageStale,
    unavailable: stage === null,
    disclaimer: RC20_LADDER_DISCLAIMER,
    feedLabel: stage === null ? RC20_START_FEED_UNAVAILABLE : RC20_START_SOURCE_LIVE
  }

  // ── Display mode. A display state, resolved from real feeds and the section 11.5 macro.
  const mode = rc20ModeForInputs({
    stage,
    sessionPhase: safeSnapshot?.sessionState ?? null,
    pacing: rc20IsPacing(safeSnapshot),
    arm: control.arm
  })
  const armed = rc20LaunchCuesArmed(mode)

  // ── Launch RPM. The ACTUAL comes from the shared RC-01 projection, whose 200 ms budget and
  //    freeze-plus-grey degradation are section 16's rule for this channel verbatim. The TARGET
  //    has no channel on any provider and is never fabricated — see the omissions record.
  const rpm = base.rpm
  const scaleMaxRpm = rc20LaunchScaleMaxRpm(safeSnapshot)
  const rpmValue = typeof rpm.raw === 'number' ? rpm.raw : null
  const rpmFraction = scaleMaxRpm === null ? null : rc20ScaleFraction(rpmValue, 0, scaleMaxRpm)
  const scaleLabel = scaleMaxRpm === null ? 'SCALE --' : `SCALE 0-${Math.round(scaleMaxRpm)}`
  const band = control.band
  const bandModel: Rc20BandModel = {
    band,
    label: band === null ? 'BAND --' : `BAND ${Math.round(band.minRpm)}-${Math.round(band.maxRpm)}`,
    source: band === null ? 'none' : 'declared',
    lowFraction: band === null || scaleMaxRpm === null ? null : rc20ScaleFraction(band.minRpm, 0, scaleMaxRpm),
    highFraction: band === null || scaleMaxRpm === null ? null : rc20ScaleFraction(band.maxRpm, 0, scaleMaxRpm)
  }

  // ── Clutch bite. Section 16: '--' if the sensor is absent; never estimated from anything.
  const clutchReading = auxReading(safeSnapshot, auxReceipts, 'clutch', nowMs)
  const clutchPct = typeof clutchReading.value === 'number' ? clutchReading.value : null
  const clutchLastKnown = typeof clutchReading.lastKnown === 'number' ? clutchReading.lastKnown : null
  const clutch =
    clutchPct !== null
      ? field(String(Math.round(clutchPct)), clutchPct, false, false, 'primary')
      : clutchLastKnown !== null
        ? field(String(Math.round(clutchLastKnown)), clutchLastKnown, true, false, 'muted')
        : dash()
  const clutchFraction = clutchPct === null ? null : rc20ScaleFraction(clutchPct, 0, 100)

  // ── Grid slot and start status, split per gap G-8. The slot has NO channel: `position` is
  //    the RACE position and section 16 forbids assuming a slot from it.
  const gridSlot = dash()
  const startStatus = stage === null ? dash() : field(rc20StageLabel(stage, litBars), stage, false, false, 'primary')

  // ── Thermals. Every corner is strictly its own sensor; an axle needs BOTH of its corners.
  const tyreReadings = Object.fromEntries(
    RC20_CORNERS.map((corner) => [corner, auxReading(safeSnapshot, auxReceipts, RC20_TYRE_CHANNELS[corner], nowMs)])
  ) as Record<Rc20Corner, Rc20Reading>
  const brakeReadings = Object.fromEntries(
    RC20_CORNERS.map((corner) => [corner, auxReading(safeSnapshot, auxReceipts, RC20_BRAKE_CHANNELS[corner], nowMs)])
  ) as Record<Rc20Corner, Rc20Reading>

  const coldLocations: Rc20WarmupLocation[] = []
  for (const corner of RC20_CORNERS) {
    const value = tyreReadings[corner].value
    if (typeof value === 'number' && value < RC20_WARMUP_TARGET_C.tyreC) coldLocations.push(corner)
  }
  const axleTemps = Object.fromEntries(
    RC20_BRAKE_AXLES.map((axle) => {
      const [left, right] = RC20_BRAKE_AXLE_CORNERS[axle]
      const leftValue = typeof brakeReadings[left].value === 'number' ? (brakeReadings[left].value as number) : null
      const rightValue = typeof brakeReadings[right].value === 'number' ? (brakeReadings[right].value as number) : null
      return [axle, rc20AxleTempC(leftValue, rightValue)]
    })
  ) as Record<Rc20BrakeAxle, number | null>
  for (const axle of RC20_BRAKE_AXLES) {
    const value = axleTemps[axle]
    if (value !== null && value < RC20_WARMUP_TARGET_C.brakeC) coldLocations.push(axle)
  }

  const latchedCold = alerts.coldWarmup.locations
  const tyres = RC20_CORNERS.map((corner) =>
    warmupCell(corner, 'tyre', tyreReadings[corner], RC20_WARMUP_TARGET_C.tyreC, latchedCold.includes(corner))
  )
  const brakeCorners = RC20_CORNERS.map((corner) =>
    warmupCell(corner, 'brake', brakeReadings[corner], RC20_WARMUP_TARGET_C.brakeC, false)
  )
  const brakeAxles = RC20_BRAKE_AXLES.map((axle) => {
    const value = axleTemps[axle]
    const reading: Rc20Reading =
      value === null
        ? { value: null, lastKnown: null, stale: false, ageMs: Number.POSITIVE_INFINITY }
        : { value, lastKnown: value, stale: false, ageMs: 0 }
    return warmupCell(axle, 'brake', reading, RC20_WARMUP_TARGET_C.brakeC, latchedCold.includes(axle))
  })

  const reviewFields = {
    reaction:
      review.reactionMs === null
        ? dash('--.---')
        : field(formatMs(review.reactionMs), review.reactionMs, false, false, 'primary'),
    rpm:
      review.releaseRpm === null
        ? dash('---')
        : field(Math.round(review.releaseRpm).toLocaleString('en-US'), review.releaseRpm, false, false, 'primary'),
    clutch:
      review.releaseClutchPct === null
        ? dash()
        : field(String(Math.round(review.releaseClutchPct)), review.releaseClutchPct, false, false, 'primary')
  }

  const speedKmh =
    safeSnapshot && base.criticalFresh.speed && typeof base.speed.raw === 'number' ? base.speed.raw : null

  return {
    mode,
    modeLabel: mode ?? RC20_MODE_UNAVAILABLE,
    armed,
    ladder,
    stage,
    stageStale,
    rpm,
    rpmFraction,
    scaleMaxRpm,
    scaleLabel,
    band,
    bandModel,
    clutch,
    clutchPct,
    clutchFraction,
    clutchScaleLabel: 'SCALE 0-100',
    gridSlot,
    startStatus,
    tyres,
    brakeAxles,
    warmup: [...tyres, ...brakeCorners],
    coldLocations,
    review,
    reviewFields,
    speedKmh,
    alerts: {
      launchOverRev: alerts.launchOverRev.active,
      jumpStart: alerts.jumpStart.active,
      coldWarmup: alerts.coldWarmup.active
    },
    auxFresh,
    criticalFresh: base.criticalFresh
  }
}
