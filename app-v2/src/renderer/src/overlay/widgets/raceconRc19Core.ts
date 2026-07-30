import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { fuelLapsRemainingOf, fuelPerLapLitersOf } from '../../../../shared/telemetry'
import {
  type Rc01ChannelReceipt,
  type Rc01Field,
  rc01MonotonicNow,
  rc01ReceiptAgeMs
} from './raceconRc01Core'

/**
 * RC-19 "Hand Over — Endurance Driver-Swap Handover" core.
 *
 * The live-only ingest buffer, identity binding, mock/replay refusal, out-of-order and
 * same-timestamp guards, the shared channel receipts and the accessible-name formatter are
 * reused verbatim from the RC-01 core: that is telemetry-truth machinery, not RC-01 styling,
 * and a fork would silently drift. This module adds only what RC-19's packet needs and the
 * shared layer does not have: the crew-input checklist board, the readiness gate that is
 * derived arithmetically from it, the measured stint boundary, the carried-fault map and the
 * three confirmation-gated alerts of packet section 15.
 *
 * RC-19 is a PROCEDURAL page. Packet 11.4 states "No shift LEDs" and packet 10 suppresses the
 * live shift/gear/pace heroes because the car is stationary in the box, so there is no rev,
 * gear, speed, LED or delta element anywhere in this module, the widget or the stylesheet.
 *
 * Every packet requirement that no channel can feed is recorded in `RC19_PACKET_OMISSIONS`
 * and asserted by the suite, so a later edit cannot quietly invent a value for it.
 */

// ─────────────────────────────────────────────────────────── canvases

/** Packet section 11.1 native canvas, and the section 12.1 app reflow target. */
export const RC19_NATIVE_WIDTH_PX = 800
export const RC19_NATIVE_HEIGHT_PX = 480
export const RC19_NATIVE_TOLERANCE_PX = 1
export const RC19_APP_WIDTH_PX = 1024
export const RC19_APP_HEIGHT_PX = 600

export const RC19_PHONE_MIN_WIDTH_PX = 360
export const RC19_PHONE_MAX_WIDTH_PX = 480
export const RC19_PHONE_MIN_HEIGHT_PX = 650
export const RC19_LANDSCAPE_MIN_WIDTH_PX = 650
export const RC19_LANDSCAPE_MIN_HEIGHT_PX = 360
export const RC19_LANDSCAPE_MAX_HEIGHT_PX = 480

export type Rc19Layout = 'native' | 'app' | 'compact'
export type Rc19CompactMode = 'phone' | 'landscape' | 'standard'

/** Packet section 16's dash placeholder, verbatim: two short hyphens, never a zero or N/A. */
export const RC19_DASH = '--'

// ─────────────────────────────────────────────────────────── packet omissions

/**
 * What this build deliberately does NOT render, and why. Each key is asserted by the suite:
 * the omission is part of the contract, not an oversight. Every entry names the packet gap
 * recorded in the approved attempt-003 implementation brief.
 *
 *  - `checklistChannel` (GAP-1) "Handover checklist state" is packet 10's FIRST primary entry
 *    and drives the header, the six rows, the readiness gate and section 15's first alert, yet
 *    section 16 defines no row for it at all — no source, no unit, no freshness. It is
 *    therefore not telemetry here: every item starts PENDING and only an explicit crew macro
 *    input confirms it. Nothing auto-confirms, and a source discontinuity resets the board.
 *  - `driverIdentity` the packet is a DRIVER handover but section 16 supplies no outgoing or
 *    incoming driver channel, no stint number and no handover countdown. None is synthesised;
 *    the columns carry car state and crew confirmations only.
 *  - `absStep` / `engineMapStep` / `brakeBiasStep` (GAP-3) packet 11.1 names "current settings
 *    (TC/ABS/map/bias)" but section 16 defines ONLY "Traction control level". The three
 *    unbacked cells render the dash. The app's own `absLevel`, `engineMap` and `brakeBiasPct`
 *    are deliberately NOT bound: section 16 is the truth table, and surfacing a channel it
 *    never sanctioned is the same class of error as inventing one.
 *  - `targetLaps` / `fuelPlan` / `tyrePlan` / `weatherNote` (GAP-4) the entire next-stint
 *    column has no channels. Section 16 defines none of the four, and section 15's "Fuel plan
 *    invalid" alert presumes a plan value nothing can produce. All four render the dash; the
 *    plan is never computed from the measured burn rate multiplied by an absent target.
 *  - `stintPlanTimeline` packet 12.1 allocates an app-only stint-plan timeline zone. With no
 *    plan channel behind it (GAP-4) the zone renders its structure and the honest empty state
 *    — zero segments and the word `NO STINT PLAN SOURCE` — never a drawn plan.
 *  - `tyreSetIdentity` (GAP-10) "tires set" in the 11.1 car-state prose has no set-identity
 *    channel. The tyre row is the per-corner TPMS pressures, the only backed reading.
 *  - `deltaToBest` packet 10 lists it as tertiary, section 16 explicitly permits "hide", and
 *    packet 10 suppresses live pace because the car is stationary. Hidden on every canvas.
 *  - `tertiaryOnNative` (GAP-6) water temperature and battery voltage are named in packet 10
 *    and defined in section 16 but neither 11.1 nor 12.1 gives them a zone. Normative override
 *    OV-6 puts them on the app canvas only; the native canvas has no room and hides them.
 */
export const RC19_PACKET_OMISSIONS = Object.freeze({
  checklistChannel:
    'packet GAP-1: section 16 defines no handover-checklist row; items are crew macro input, PENDING until confirmed, never auto-confirmed',
  driverIdentity:
    'packet section 16 supplies no driver name, stint number or handover countdown; none is synthesised',
  absStep: 'packet GAP-3: 11.1 names ABS but section 16 defines no ABS channel, so the cell is "--"',
  engineMapStep: 'packet GAP-3: 11.1 names MAP but section 16 defines no engine-map channel, so the cell is "--"',
  brakeBiasStep: 'packet GAP-3: 11.1 names BIAS but section 16 defines no brake-bias channel, so the cell is "--"',
  targetLaps: 'packet GAP-4: section 16 defines no target-laps channel; never derived from fuel laps',
  fuelPlan: 'packet GAP-4: section 16 defines no fuel-plan channel; never burn rate x an absent target',
  tyrePlan: 'packet GAP-4: section 16 defines no tyre-plan channel, so the row is "--"',
  weatherNote: 'packet GAP-4: section 16 defines no weather-note channel, so the row is "--"',
  stintPlanTimeline:
    'packet 12.1 allocates the timeline a zone but GAP-4 leaves it no channel; the structure renders zero segments and NO STINT PLAN SOURCE',
  tyreSetIdentity: 'packet GAP-10: no tyre-set-identity channel exists; the tyre row is the per-corner TPMS pressures',
  deltaToBest: 'packet 10 tertiary with no zone; section 16 permits hide and packet 10 suppresses live pace',
  tertiaryOnNative:
    'packet GAP-6: water temperature and battery voltage have no 11.1 zone; normative override OV-6 surfaces them on the app canvas only'
})

// ─────────────────────────────────────────────────────────── registration facts

/**
 * The registration literals the separate catalog wiring PR must add. They live here so the
 * wiring agent reads facts instead of re-deriving them, and so this suite can assert that the
 * widget's own idea of its identity never drifts from what was published.
 *
 * This module deliberately does NOT import `OverlayWidgetId`: the union does not carry
 * `raceconRc19Dash` yet, and adding it is the wiring PR's job, not this one's.
 */
export const RC19_WIDGET_ID = 'raceconRc19Dash' as const
export const RC19_PRESET_ID = 'racecon_rc19_dash' as const
export const RC19_PRESET_NAME = 'RaceCon RC-19 Hand Over' as const

export const RC19_REGISTRATION = Object.freeze({
  /** `src/shared/overlays.ts` — add to the `OverlayWidgetId` union, NOT to `OVERLAY_WIDGETS`. */
  overlayWidgetIdUnionMember: RC19_WIDGET_ID,
  /** `src/renderer/src/overlay/widgets/index.ts` — `WIDGET_COMPONENTS` entry. */
  widgetComponentsKey: RC19_WIDGET_ID,
  widgetComponentsExport: 'RaceconRc19DashWidget',
  /** `src/shared/dashboards.ts` — append to `OVERLAY_DASHBOARD_PRESETS`. */
  preset: Object.freeze({
    id: RC19_PRESET_ID,
    name: RC19_PRESET_NAME,
    widgetId: RC19_WIDGET_ID,
    description:
      'Full-screen RC-19 endurance driver-swap handover: readiness gate, crew-confirmed swap checklist, car state at handover and the next-stint plan, with dashed honest states for every field the packet leaves unbacked.',
    tags: Object.freeze(['racecon', 'dashboard', 'fullscreen', 'telemetry']),
    scaleMode: 'stretch'
  }),
  /** `src/shared/dashboard-overlay-embed.test.ts` — the matching `EMBEDDED` row, same index. */
  embedRow: Object.freeze({
    id: RC19_PRESET_ID,
    widgetId: RC19_WIDGET_ID,
    name: RC19_PRESET_NAME,
    family: 'racecon'
  }),
  /** `src/renderer/src/dashboard/DashboardRoot.tsx` — `RESPONSIVE_FULL_FRAME_WIDGET_IDS`. */
  responsiveFullFrame: true,
  /** `src/renderer/src/views/dashboard/widget-catalog-data.ts` — `IDENTITY_SCOPED_WIDGET_IDS`. */
  identityScoped: true,
  /** `src/renderer/src/views/dashboard/DashboardCanvasEditor.test.ts` — render-smoke list. */
  canvasEditorSmoke: true,
  /** `src/main/dashboards/manager.test.ts` — preset-lifecycle describe. */
  managerLifecycle: true
})

// ─────────────────────────────────────────────────────────── palette and type

/** Packet section 11.3 tokens, verbatim. `caution` and `danger` belong to the alert layer. */
export const RC19_TOKENS = Object.freeze({
  bg: '#0A0D11',
  panel: '#151B22',
  primary: '#EAEFF3',
  secondary: '#8B99A6',
  info: '#40BEDC',
  normal: '#46C86E',
  caution: '#FFB52E',
  danger: '#FF3F30',
  signature: '#34E0C0'
})

/**
 * Packet 11.2's typographic ladder in pixels on the 800x480 canvas, taken from the packet's
 * own 40 / 30 / 24 / 15 nominals and NOT measured off the approved render: normative override
 * OV-3 is explicit that the render's cap heights are never traced, and OV-13 requires one
 * rank-3 size held everywhere, so the checklist item word, the checklist state word, the
 * outstanding count, `NONE ACTIVE` and `CONFIRM READY` all sit on `item`.
 *
 * OV-11: the packet provides no size between a primary and a secondary column value, so the
 * section 10 hierarchy is carried by column position and by `primary` vs `secondary` colour.
 */
export const RC19_TYPE_SCALE_PX = Object.freeze({
  readiness: 40,
  value: 30,
  item: 24,
  label: 15
})

/** One container-query width unit is one hundredth of the native canvas: 800 / 100 = 8 px. */
export const RC19_CQW_PX = RC19_NATIVE_WIDTH_PX / 100

/** The packet's px ladder expressed in the container units the stylesheet actually uses. */
export function rc19TypeScaleCqw(px: number): number {
  return Math.round((px / RC19_CQW_PX) * 1_000) / 1_000
}

// ─────────────────────────────────────────────────────────── checklist (GAP-1)

/**
 * Packet 11.1's swap checklist: "seat, belts, wheel, drinks, radio, mirrors", rendered in the
 * approved frame's reading order. Packet 14 makes a missing SAFETY confirmation the critical
 * case, and packet 15's first alert names belts and seat, so exactly those two are critical.
 */
export const RC19_CHECKLIST_ITEMS = Object.freeze([
  Object.freeze({ id: 'SEAT', label: 'SEAT', critical: true }),
  Object.freeze({ id: 'BELTS', label: 'BELTS', critical: true }),
  Object.freeze({ id: 'WHEEL', label: 'WHEEL', critical: false }),
  Object.freeze({ id: 'RADIO', label: 'RADIO', critical: false }),
  Object.freeze({ id: 'DRINKS', label: 'DRINKS', critical: false }),
  Object.freeze({ id: 'MIRRORS', label: 'MIRRORS', critical: false })
] as const)

export type Rc19ChecklistItemId = (typeof RC19_CHECKLIST_ITEMS)[number]['id']

export const RC19_CHECKLIST_ITEM_IDS: readonly Rc19ChecklistItemId[] = Object.freeze(
  RC19_CHECKLIST_ITEMS.map((item) => item.id)
)

export const RC19_CRITICAL_ITEM_IDS: readonly Rc19ChecklistItemId[] = Object.freeze(
  RC19_CHECKLIST_ITEMS.filter((item) => item.critical).map((item) => item.id)
)

export type Rc19ChecklistState = 'PENDING' | 'CONFIRMED'

/** Packet 11.3 GAP-9 assigns PENDING no hue; `secondary` is bound here, never `caution`. */
export const RC19_STATE_GLYPH: Readonly<Record<Rc19ChecklistState, string>> = Object.freeze({
  CONFIRMED: '\u2713',
  PENDING: '\u2715'
})

/** The crew macro bus. Packet 11.5: items move pending -> confirmed via crew macro inputs. */
export const RC19_CONFIRM_EVENT = 'racecon:hand-over-confirm'

export type Rc19CrewCommand =
  | { kind: 'set'; item: Rc19ChecklistItemId; state: Rc19ChecklistState }
  | { kind: 'latch' }
  | { kind: 'reset' }

function isChecklistItemId(value: string): value is Rc19ChecklistItemId {
  return (RC19_CHECKLIST_ITEM_IDS as readonly string[]).includes(value)
}

/**
 * Only a recognised crew macro changes the board. An unknown payload is ignored outright, so
 * a stray event on the bus can never confirm a safety item on the incoming driver's behalf.
 */
export function rc19CrewCommandFromEvent(detail: unknown): Rc19CrewCommand | null {
  if (typeof detail === 'string') {
    const upper = detail.trim().toUpperCase()
    if (upper === 'RESET') return { kind: 'reset' }
    if (upper === 'CONFIRM-READY' || upper === 'CONFIRM READY') return { kind: 'latch' }
    return isChecklistItemId(upper) ? { kind: 'set', item: upper, state: 'CONFIRMED' } : null
  }
  if (typeof detail !== 'object' || detail === null) return null
  const record = detail as { item?: unknown; state?: unknown; command?: unknown }
  if (typeof record.command === 'string') {
    const upper = record.command.trim().toUpperCase()
    if (upper === 'RESET') return { kind: 'reset' }
    if (upper === 'CONFIRM-READY' || upper === 'CONFIRM READY' || upper === 'LATCH') return { kind: 'latch' }
    return null
  }
  if (typeof record.item !== 'string') return null
  const item = record.item.trim().toUpperCase()
  if (!isChecklistItemId(item)) return null
  const raw = typeof record.state === 'string' ? record.state.trim().toUpperCase() : 'CONFIRMED'
  if (raw !== 'CONFIRMED' && raw !== 'PENDING') return null
  return { kind: 'set', item, state: raw }
}

/**
 * The crew-input board. It is NOT telemetry (GAP-1): every item starts PENDING, only an
 * explicit crew macro confirms one, and the ready latch cannot be armed while anything is
 * outstanding. `reset()` is called whenever the live buffer refuses a frame or the telemetry
 * source changes, so a new car never inherits the previous crew's confirmations.
 */
export class Rc19ChecklistBoard {
  private states = new Map<Rc19ChecklistItemId, Rc19ChecklistState>()
  private latched = false

  clone(): Rc19ChecklistBoard {
    const next = new Rc19ChecklistBoard()
    next.states = new Map(this.states)
    next.latched = this.latched
    return next
  }

  reset(): void {
    this.states = new Map()
    this.latched = false
  }

  stateOf(item: Rc19ChecklistItemId): Rc19ChecklistState {
    return this.states.get(item) ?? 'PENDING'
  }

  snapshot(): Readonly<Record<Rc19ChecklistItemId, Rc19ChecklistState>> {
    const out = {} as Record<Rc19ChecklistItemId, Rc19ChecklistState>
    for (const id of RC19_CHECKLIST_ITEM_IDS) out[id] = this.stateOf(id)
    return Object.freeze(out)
  }

  outstanding(): readonly Rc19ChecklistItemId[] {
    return RC19_CHECKLIST_ITEM_IDS.filter((id) => this.stateOf(id) !== 'CONFIRMED')
  }

  criticalOutstanding(): readonly Rc19ChecklistItemId[] {
    return RC19_CRITICAL_ITEM_IDS.filter((id) => this.stateOf(id) !== 'CONFIRMED')
  }

  /** Packet 11.5: the confirm control latches ready, and only once nothing is outstanding. */
  readyLatched(): boolean {
    return this.latched && this.outstanding().length === 0
  }

  apply(command: Rc19CrewCommand): Rc19ChecklistBoard {
    const next = this.clone()
    if (command.kind === 'reset') {
      next.reset()
      return next
    }
    if (command.kind === 'latch') {
      // Gated: the macro is inert while any item is outstanding, so READY is never latched
      // over an unconfirmed item.
      if (next.outstanding().length === 0) next.latched = true
      return next
    }
    next.states.set(command.item, command.state)
    // Retracting a confirmation drops the latch: a re-opened item invalidates READY.
    if (command.state === 'PENDING') next.latched = false
    return next
  }
}

export interface Rc19Readiness {
  ready: boolean
  word: 'READY' | 'NOT READY'
  outstandingCount: number
  outstanding: readonly Rc19ChecklistItemId[]
  criticalOutstanding: readonly Rc19ChecklistItemId[]
  latched: boolean
}

/**
 * OV-12: the outstanding count and the header state are ONE derived quantity computed
 * arithmetically from the item states, never read off a rendered layout.
 */
export function rc19ReadinessFor(board: Rc19ChecklistBoard): Rc19Readiness {
  const outstanding = board.outstanding()
  const criticalOutstanding = board.criticalOutstanding()
  const ready = outstanding.length === 0 && board.readyLatched()
  return {
    ready,
    word: ready ? 'READY' : 'NOT READY',
    outstandingCount: outstanding.length,
    outstanding,
    criticalOutstanding,
    latched: board.readyLatched()
  }
}

// ─────────────────────────────────────────────────────────── channels

/**
 * Packet section 16 freshness budgets. Tyre pressure 1 s, water temperature 500 ms and battery
 * voltage 500 ms are verbatim. The channels section 16 declares "event", "on change" or
 * "per lap" only CHANGE on those boundaries, but every provider republishes them on each
 * frame, so their budget is a TRANSPORT budget: generous, but finite, so a provider that falls
 * silent ages the value into its packet degradation instead of freezing on it.
 *
 * `pitContext` has no section 16 row of its own — it is the measured handover context that
 * makes packet 15's first alert trigger-only instead of an always-on decoration, and it is
 * read strictly from the pit-presence channels the app already publishes.
 */
export const RC19_TRANSPORT_BUDGET_MS = 2_000

export const RC19_CHANNEL_STALE_MS = {
  fuelLaps: RC19_TRANSPORT_BUDGET_MS,
  fuelPerLap: RC19_TRANSPORT_BUDGET_MS,
  tyreLf: 1_000,
  tyreRf: 1_000,
  tyreLr: 1_000,
  tyreRr: 1_000,
  tc: RC19_TRANSPORT_BUDGET_MS,
  lapCounter: RC19_TRANSPORT_BUDGET_MS,
  faults: RC19_TRANSPORT_BUDGET_MS,
  waterTemp: 500,
  voltage: 500,
  pitContext: 1_000
} as const

export type Rc19Channel = keyof typeof RC19_CHANNEL_STALE_MS

/** Packet 11.1's tyre grid, in the approved frame's own reading order. */
export const RC19_CORNERS = ['LF', 'RF', 'LR', 'RR'] as const
export type Rc19Corner = (typeof RC19_CORNERS)[number]

export const RC19_CORNER_CHANNELS: Readonly<Record<Rc19Corner, Rc19Channel>> = Object.freeze({
  LF: 'tyreLf',
  RF: 'tyreRf',
  LR: 'tyreLr',
  RR: 'tyreRr'
})

/** Packet section 16 gives tyre pressure in bar; the app publishes kPa. A unit conversion. */
export const RC19_KPA_PER_BAR = 100

/**
 * Packet section 16's fault map is "ECU + chassis fault channels". The app publishes an ECU
 * warning bitfield and a chassis damage percentage, and those two ARE the fault channels.
 *
 * `pitLimiter` and `revLimiter` are deliberately excluded: they are operating states a healthy
 * car reports constantly, and briefing the incoming driver that the pit limiter is on as a
 * "carried fault" would be exactly the invented fault packet 18 and 20 forbid.
 */
export const RC19_FAULT_WARNINGS = Object.freeze([
  'waterTemp',
  'fuelPressure',
  'oilPressure',
  'oilTemp',
  'stalled',
  'mandRepair',
  'optRepair'
] as const)

export type Rc19FaultWarning = (typeof RC19_FAULT_WARNINGS)[number]

export const RC19_FAULT_LABELS: Readonly<Record<Rc19FaultWarning | 'DAMAGE', string>> = Object.freeze({
  waterTemp: 'WATER TEMP',
  fuelPressure: 'FUEL PRESS',
  oilPressure: 'OIL PRESS',
  oilTemp: 'OIL TEMP',
  stalled: 'STALLED',
  mandRepair: 'MAND REPAIR',
  optRepair: 'OPT REPAIR',
  DAMAGE: 'DAMAGE'
})

/** Packet section 16's "NONE ACTIVE": a present channel reporting an enum, not an assumption. */
export const RC19_FAULTS_NONE = 'NONE ACTIVE'
/** The word a missing fault channel renders. Nothing unmonitored is ever drawn as healthy. */
export const RC19_FAULTS_NO_SOURCE = 'NO FAULT SOURCE'
/** The honest empty state for the packet 12.1 stint-plan timeline (GAP-4). */
export const RC19_TIMELINE_NO_SOURCE = 'NO STINT PLAN SOURCE'

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

/** An ECU rotary position: a non-negative number, or the ECU's own short label. */
function stepValue(value: unknown): number | string | null {
  if (finite(value) && value >= 0) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 && trimmed.length <= 4 ? trimmed : null
  }
  return null
}

function tyrePressureBar(kpa: unknown): number | null {
  return finite(kpa) && kpa > 0 ? kpa / RC19_KPA_PER_BAR : null
}

/**
 * Packet section 16's fault map, read strictly from the two fault channels the app publishes.
 * `null` means the channel does not exist at all, which is the packet's "hidden if no fault
 * channel"; an empty array means a present channel reporting zero active faults.
 */
export function rc19ActiveFaults(snapshot: TelemetrySnapshot | null): readonly string[] | null {
  if (!snapshot) return null
  const warnings = snapshot.engineWarnings
  const damage = finite(snapshot.damagePct) && snapshot.damagePct >= 0 ? snapshot.damagePct : null
  if (!warnings && damage === null) return null
  const active: string[] = []
  if (warnings) {
    for (const key of RC19_FAULT_WARNINGS) {
      if (warnings[key] === true) active.push(RC19_FAULT_LABELS[key])
    }
  }
  if (damage !== null && damage > 0) active.push(RC19_FAULT_LABELS.DAMAGE)
  return Object.freeze(active)
}

/**
 * The measured handover context: is the car in its pit box right now? `null` is "no channel",
 * and a display with no pit channel keeps packet 15's safety alert silent rather than raising
 * a red item on a car that may well be on track.
 */
export function rc19InBox(snapshot: TelemetrySnapshot | null): boolean | null {
  if (!snapshot) return null
  if (typeof snapshot.pit?.inPitStall === 'boolean') return snapshot.pit.inPitStall
  if (typeof snapshot.onPitRoad === 'boolean') return snapshot.onPitRoad
  return null
}

/** Which laptrigger counter this provider publishes. Differencing one field cancels its offset. */
export type Rc19LapCounterField = 'completedLaps' | 'currentLap'

export function rc19LapCounterField(snapshot: TelemetrySnapshot | null): Rc19LapCounterField | null {
  if (!snapshot) return null
  if (finite(snapshot.completedLaps) && snapshot.completedLaps >= 0) return 'completedLaps'
  if (finite(snapshot.currentLap) && snapshot.currentLap >= 0) return 'currentLap'
  return null
}

/**
 * Every RC-19 channel is read straight from its own declared source. Nothing is modelled,
 * mirrored or substituted: a tyre corner comes strictly from its OWN sensor and never from a
 * neighbour, the fuel laps never from the tank level without a measured burn rate, the TC step
 * never from a default, and the fault map never from a flag that is not a fault.
 */
export function rc19ChannelValue(snapshot: TelemetrySnapshot, channel: Rc19Channel): number | string | null {
  switch (channel) {
    // Packet 16: "'--' until >= 1 measured consumption lap". The receipt exists only when a
    // measured burn rate exists, so the laps figure can never precede its own model.
    case 'fuelLaps': {
      if (fuelPerLapLitersOf(snapshot) === undefined) return null
      const laps = fuelLapsRemainingOf(snapshot)
      return laps !== undefined && laps >= 0 ? laps : null
    }
    case 'fuelPerLap': {
      const burn = fuelPerLapLitersOf(snapshot)
      return burn !== undefined && burn > 0 ? burn : null
    }
    case 'tyreLf':
      return tyrePressureBar(snapshot.tyres?.lf?.pressureKpa)
    case 'tyreRf':
      return tyrePressureBar(snapshot.tyres?.rf?.pressureKpa)
    case 'tyreLr':
      return tyrePressureBar(snapshot.tyres?.lr?.pressureKpa)
    case 'tyreRr':
      return tyrePressureBar(snapshot.tyres?.rr?.pressureKpa)
    case 'tc':
      return stepValue(snapshot.tcLevel)
    case 'lapCounter': {
      const source = rc19LapCounterField(snapshot)
      if (source === null) return null
      const raw = source === 'completedLaps' ? snapshot.completedLaps : snapshot.currentLap
      return finite(raw) ? raw : null
    }
    case 'faults': {
      const active = rc19ActiveFaults(snapshot)
      return active === null ? null : active.length
    }
    case 'waterTemp':
      return finite(snapshot.waterTempC) ? snapshot.waterTempC : null
    case 'voltage':
      return finite(snapshot.voltage) && snapshot.voltage >= 0 ? snapshot.voltage : null
    case 'pitContext': {
      const inBox = rc19InBox(snapshot)
      return inBox === null ? null : inBox ? 1 : 0
    }
  }
  return null
}

/**
 * Receipts for RC-19's own channels, with exactly RC-01's semantics: a receipt is written only
 * when the channel actually reports, so a channel that falls silent ages out and degrades to
 * its packet state instead of freezing on its last value.
 */
export class Rc19ChannelBuffer {
  private channelReceipts = new Map<Rc19Channel, Rc01ChannelReceipt>()

  clone(): Rc19ChannelBuffer {
    const next = new Rc19ChannelBuffer()
    next.channelReceipts = new Map(this.channelReceipts)
    return next
  }

  reset(): void {
    this.channelReceipts = new Map()
  }

  ingest(snapshot: TelemetrySnapshot | null | undefined, receivedAt = rc01MonotonicNow()): void {
    if (!snapshot || !snapshot.connected || !finite(snapshot.timestamp)) return
    const safeReceiptAt = finite(receivedAt) && receivedAt >= 0 ? receivedAt : rc01MonotonicNow()
    for (const channel of Object.keys(RC19_CHANNEL_STALE_MS) as Rc19Channel[]) {
      const value = rc19ChannelValue(snapshot, channel)
      if (value === null) continue
      this.channelReceipts.set(
        channel,
        Object.freeze({ value, snapshotTimestamp: snapshot.timestamp, receivedAt: safeReceiptAt })
      )
    }
  }

  receipts(): ReadonlyMap<Rc19Channel, Rc01ChannelReceipt> {
    return new Map(this.channelReceipts)
  }
}

export function createRc19Receipts(
  snapshot: TelemetrySnapshot,
  receivedAt = rc01MonotonicNow()
): ReadonlyMap<Rc19Channel, Rc01ChannelReceipt> {
  const buffer = new Rc19ChannelBuffer()
  buffer.ingest(snapshot, receivedAt)
  return buffer.receipts()
}

export interface Rc19Reading {
  value: number | string | null
  lastKnown: number | string | null
  stale: boolean
  present: boolean
}

export function rc19Reading(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc19Channel, Rc01ChannelReceipt>,
  channel: Rc19Channel,
  nowMs: number
): Rc19Reading {
  const raw = snapshot ? rc19ChannelValue(snapshot, channel) : null
  const receipt = receipts.get(channel)
  if (raw === null || !receipt) return { value: null, lastKnown: null, stale: false, present: false }
  const stale = rc01ReceiptAgeMs(receipt, nowMs) > RC19_CHANNEL_STALE_MS[channel]
  return {
    value: stale ? null : raw,
    lastKnown: typeof receipt.value === 'boolean' ? null : receipt.value,
    stale,
    present: true
  }
}

// ─────────────────────────────────────────────────────────── measured stint

/**
 * Packet section 16: "Stint lap count | Laptrigger count since stint start | '--' if stint
 * start not marked | Never carry laps across an unmarked stint boundary."
 *
 * The app publishes no stint-start marker, so the boundary is MEASURED: a stint begins at an
 * OBSERVED pit exit, the frame on which the pit-presence channel transitions from in-box to
 * on-track. A widget mounted mid-stint has observed no such transition, so the stint start is
 * unmarked and the count dashes forever rather than inheriting the session's lap total.
 *
 * The count is a DIFFERENCE of one laptrigger field against itself, so the constant offset
 * between `completedLaps` and `currentLap` cancels exactly. If a provider switches fields
 * mid-stint the offset would not cancel, so the boundary is dropped and the count dashes.
 */
export class Rc19StintTracker {
  private startCounter: number | null = null
  private startField: Rc19LapCounterField | null = null
  private lastInBox: boolean | null = null

  clone(): Rc19StintTracker {
    const next = new Rc19StintTracker()
    next.startCounter = this.startCounter
    next.startField = this.startField
    next.lastInBox = this.lastInBox
    return next
  }

  reset(): void {
    this.startCounter = null
    this.startField = null
    this.lastInBox = null
  }

  observe(snapshot: TelemetrySnapshot | null): void {
    if (!snapshot) return
    const inBox = rc19InBox(snapshot)
    const counterField = rc19LapCounterField(snapshot)
    const counter = counterField === null ? null : rc19ChannelValue(snapshot, 'lapCounter')

    if (this.startField !== null && counterField !== this.startField) {
      // The provider changed laptrigger field: the recorded boundary no longer differences.
      this.startCounter = null
      this.startField = null
    }

    if (inBox !== null && counterField !== null && finite(counter)) {
      // A stint starts at the observed pit exit, never at mount and never at a guess.
      if (this.lastInBox === true && inBox === false) {
        this.startCounter = counter
        this.startField = counterField
      }
    }
    if (inBox !== null) this.lastInBox = inBox
  }

  /** `null` whenever the stint start was never observed — the packet's unmarked boundary. */
  lapsSinceStart(snapshot: TelemetrySnapshot | null): number | null {
    if (!snapshot || this.startCounter === null || this.startField === null) return null
    const counterField = rc19LapCounterField(snapshot)
    if (counterField !== this.startField) return null
    const counter = rc19ChannelValue(snapshot, 'lapCounter')
    if (!finite(counter)) return null
    const laps = counter - this.startCounter
    return laps >= 0 ? Math.floor(laps) : null
  }

  marked(): boolean {
    return this.startCounter !== null
  }
}

// ─────────────────────────────────────────────────────────── zones

export interface Rc19Rect {
  left: number
  top: number
  width: number
  height: number
}

export type Rc19ZoneId =
  | 'header'
  | 'carState'
  | 'carStateBody'
  | 'tertiary'
  | 'checklist'
  | 'checklistList'
  | 'confirm'
  | 'nextStint'
  | 'timeline'

export type Rc19ZoneMap = Readonly<Partial<Record<Rc19ZoneId, Rc19Rect>>>

/**
 * A packet pixel rectangle as canvas percentages. The EDGES are rounded, not the sizes, so a
 * nested zone's floor lands exactly on its parent's floor: rounding width and height
 * independently pushes a child 0.001 pp past its parent and turns an exact packet containment
 * into a spurious overflow.
 */
function pctRect(x: number, y: number, w: number, h: number, canvasW: number, canvasH: number): Rc19Rect {
  const round = (value: number): number => Math.round(value * 1_000) / 1_000
  const left = round((x / canvasW) * 100)
  const top = round((y / canvasH) * 100)
  const right = round(((x + w) / canvasW) * 100)
  const bottom = round(((y + h) / canvasH) * 100)
  return { left, top, width: round(right - left), height: round(bottom - top) }
}

function nativeRect(x: number, y: number, w: number, h: number): Rc19Rect {
  return pctRect(x, y, w, h, RC19_NATIVE_WIDTH_PX, RC19_NATIVE_HEIGHT_PX)
}

function appRect(x: number, y: number, w: number, h: number): Rc19Rect {
  return pctRect(x, y, w, h, RC19_APP_WIDTH_PX, RC19_APP_HEIGHT_PX)
}

/**
 * Packet 11.1 verbatim, converted arithmetically from its own pixel rectangles, with the alert
 * floor band of `RC19_NATIVE_ALERT_FLOOR_PX` reserved below the columns. OV-3: the approved render
 * drifts up to 2.50 pp on the panels and 5.62 pp on the confirm control, and those pixels are
 * never traced.
 *
 * OV-2: the confirm control is 100 % contained in the checklist column, so it is a CHILD
 * sub-zone and the six rows are reserved to the `checklistList` area above it.
 *
 * OV-15: packet 11.1 runs the columns to y=460 and leaves 20 px of bare `bg` below them, which is
 * where the alert strip lives. The strip measures 24.50 px tall at 800x480, so it started at
 * y=455.50 and overlapped the confirm control by 3.47 px whenever an alert was up — measured with
 * `getBoundingClientRect` in the handover state. `RC19_COMPACT_ALERT_FLOOR_PCT` already reserves
 * exactly this band on the compact canvases; the native canvas is given the same reservation in
 * pixels instead of percent, which lifts the column floor from 460 to 450 and moves the confirm
 * control and the checklist list up with it. Nothing else moves and no type step changes.
 */
export const RC19_NATIVE_ALERT_FLOOR_PX = 30

export const RC19_NATIVE_ZONES: Rc19ZoneMap = Object.freeze({
  header: nativeRect(16, 12, 768, 44),
  carState: nativeRect(16, 66, 250, 384),
  carStateBody: nativeRect(16, 66, 250, 384),
  checklist: nativeRect(282, 66, 236, 384),
  checklistList: nativeRect(282, 66, 236, 334),
  confirm: nativeRect(282, 400, 236, 50),
  nextStint: nativeRect(534, 66, 250, 384)
})

/**
 * Packet 12.1 verbatim plus the two governed additions the packet omits:
 *  - OV-1 the confirm control, which packet 12.1 gives no app zone at all, nested at the floor
 *    of the app checklist column exactly as on the native canvas;
 *  - OV-6 the tertiary strip carrying water temperature and battery voltage (GAP-6), nested at
 *    the floor of the app car-state column, which is the only canvas with room for them.
 *
 * The header goes edge to edge here and is inset on the native canvas: that alone makes this a
 * reflow rather than a scale, and the app additionally reveals the stint-plan timeline.
 */
export const RC19_APP_ZONES: Rc19ZoneMap = Object.freeze({
  header: appRect(0, 0, 1024, 52),
  carState: appRect(24, 64, 320, 500),
  carStateBody: appRect(24, 64, 320, 416),
  tertiary: appRect(24, 480, 320, 84),
  checklist: appRect(360, 64, 300, 500),
  checklistList: appRect(360, 64, 300, 430),
  confirm: appRect(360, 502, 300, 54),
  nextStint: appRect(676, 64, 324, 340),
  timeline: appRect(676, 420, 324, 144)
})

/**
 * The compact canvases the packet never specifies. The three-column procedural spine is the
 * artifact's auditable structure, so it survives every canvas that can hold three columns;
 * only the phone stacks it, and the app-only timeline and tertiary strip never appear.
 *
 * The packet's own canvases leave 20 px (native) and 36 px (app) of bare `bg` below the
 * columns, which is where the alert strip lives. The native band was 4 px too short for the
 * 24.50 px strip and is now reserved explicitly as `RC19_NATIVE_ALERT_FLOOR_PX`. A compact canvas
 * has no such gift at all, so the columns are shortened to reserve one: a real-browser audit
 * measured the strip covering the FAULTS row and the CONFIRM READY label at 812x375 and 640x520
 * before this reservation.
 */
export const RC19_COMPACT_ALERT_FLOOR_PCT = 9

export function rc19CompactZones(mode: Rc19CompactMode): Rc19ZoneMap {
  if (mode === 'phone') {
    return Object.freeze({
      header: { left: 3, top: 1.5, width: 94, height: 7 },
      carState: { left: 3, top: 10, width: 94, height: 28 },
      carStateBody: { left: 3, top: 10, width: 94, height: 28 },
      checklist: { left: 3, top: 39.5, width: 94, height: 37 },
      checklistList: { left: 3, top: 39.5, width: 94, height: 28.5 },
      confirm: { left: 3, top: 69, width: 94, height: 7.5 },
      nextStint: { left: 3, top: 78, width: 94, height: 17.5 }
    })
  }
  const headerHeight = mode === 'landscape' ? 11 : 9
  const top = headerHeight + 4
  const height = 100 - RC19_COMPACT_ALERT_FLOOR_PCT - top
  return Object.freeze({
    header: { left: 2, top: 2, width: 96, height: headerHeight },
    carState: { left: 2, top, width: 31.25, height },
    carStateBody: { left: 2, top, width: 31.25, height },
    checklist: { left: 35.25, top, width: 29.5, height },
    checklistList: { left: 35.25, top, width: 29.5, height: Math.round(height * 0.85 * 1_000) / 1_000 },
    confirm: {
      left: 35.25,
      top: Math.round((top + height * 0.87) * 1_000) / 1_000,
      width: 29.5,
      height: Math.round(height * 0.13 * 1_000) / 1_000
    },
    nextStint: { left: 66.75, top, width: 31.25, height }
  })
}

export function rc19ZonesForLayout(layout: Rc19Layout, compactMode: Rc19CompactMode = 'standard'): Rc19ZoneMap {
  if (layout === 'native') return RC19_NATIVE_ZONES
  if (layout === 'app') return RC19_APP_ZONES
  return rc19CompactZones(compactMode)
}

/** The inline geometry a zone element carries, so CSS and the packet table cannot drift. */
export function rc19ZoneStyle(
  rect: Rc19Rect | undefined
): { left: string; top: string; width: string; height: string } | null {
  if (!rect) return null
  return {
    left: rc19Percent(rect.left),
    top: rc19Percent(rect.top),
    width: rc19Percent(rect.width),
    height: rc19Percent(rect.height)
  }
}

/** Re-expresses a nested packet zone as percentages of its parent zone's own box. */
export function rc19NestedRect(child: Rc19Rect, parent: Rc19Rect): Rc19Rect {
  return {
    left: parent.width === 0 ? 0 : ((child.left - parent.left) / parent.width) * 100,
    top: parent.height === 0 ? 0 : ((child.top - parent.top) / parent.height) * 100,
    width: parent.width === 0 ? 0 : (child.width / parent.width) * 100,
    height: parent.height === 0 ? 0 : (child.height / parent.height) * 100
  }
}

export function rc19RectsOverlap(a: Rc19Rect, b: Rc19Rect): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  )
}

export function rc19RectContains(outer: Rc19Rect, inner: Rc19Rect): boolean {
  return (
    inner.left >= outer.left - 1e-6 &&
    inner.top >= outer.top - 1e-6 &&
    inner.left + inner.width <= outer.left + outer.width + 1e-6 &&
    inner.top + inner.height <= outer.top + outer.height + 1e-6
  )
}

/** A 0..100 coordinate as a CSS percentage, without binary-float noise in the DOM. */
export function rc19Percent(value: number): string {
  const safe = finite(value) ? value : 0
  return `${Math.round(safe * 1_000) / 1_000}%`
}

// ─────────────────────────────────────────────────────────── layout resolution

export function rc19LayoutForContentBox(width: number, height: number): Rc19Layout {
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return 'app'
  if (
    Math.abs(width - RC19_NATIVE_WIDTH_PX) <= RC19_NATIVE_TOLERANCE_PX &&
    Math.abs(height - RC19_NATIVE_HEIGHT_PX) <= RC19_NATIVE_TOLERANCE_PX
  ) {
    return 'native'
  }
  if (width >= RC19_APP_WIDTH_PX - 1 && height >= RC19_APP_HEIGHT_PX - 1) return 'app'
  return 'compact'
}

export function rc19CompactModeForContentBox(width: number, height: number): Rc19CompactMode {
  if (rc19LayoutForContentBox(width, height) !== 'compact') return 'standard'
  if (
    width >= RC19_PHONE_MIN_WIDTH_PX &&
    width <= RC19_PHONE_MAX_WIDTH_PX &&
    height >= RC19_PHONE_MIN_HEIGHT_PX &&
    height / width >= 1.5
  ) {
    return 'phone'
  }
  if (
    width >= RC19_LANDSCAPE_MIN_WIDTH_PX &&
    height >= RC19_LANDSCAPE_MIN_HEIGHT_PX &&
    height <= RC19_LANDSCAPE_MAX_HEIGHT_PX &&
    width / height >= 1.5
  ) {
    return 'landscape'
  }
  return 'standard'
}

export interface Rc19PhoneGeometry {
  inset: number
  headerHeight: number
  rowHeight: number
  checkRowHeight: number
  confirmHeight: number
}

/** Portrait geometry, in pixels, for the bands the phone stack sizes from the measured box. */
export function rc19PhoneGeometryForContentBox(width: number, height: number): Rc19PhoneGeometry | null {
  if (rc19CompactModeForContentBox(width, height) !== 'phone') return null
  return {
    inset: 10,
    headerHeight: Math.max(30, Math.round(height * 0.06)),
    rowHeight: Math.max(22, Math.round(height * 0.035)),
    checkRowHeight: Math.max(28, Math.round(height * 0.042)),
    confirmHeight: Math.max(36, Math.round(height * 0.055))
  }
}

// ─────────────────────────────────────────────────────────── alerts

/**
 * Packet 15's carried fault is "latched, shown to the incoming driver", so once it engages it
 * holds for at least this long even if the ECU drops the bit for a frame; only a channel
 * reporting zero active faults clears it, and a missing or stale channel unlatches it.
 */
export const RC19_CARRIED_FAULT_MIN_VISIBLE_MS = 1_000

/**
 * Packet 15's safety alert debounce column reads "blocks ready until confirmed": it is a GATE,
 * not a timer, so it engages on the frame its trigger is met and holds until the crew confirms.
 */
export const RC19_SAFETY_ITEM_ENGAGE_MS = 0

export interface Rc19AlertState {
  safetyItem: {
    active: boolean
    items: readonly Rc19ChecklistItemId[]
    pendingSinceMs: number | null
  }
  carriedFault: {
    active: boolean
    faults: readonly string[]
    minimumVisibleUntilMs: number
  }
  fuelPlanInvalid: {
    active: boolean
  }
}

export interface Rc19AlertInput {
  nowMs: number
  /**
   * The MEASURED handover context: `true` in the box, `false` on track, `null` with no pit
   * channel at all. Only `true` can arm the safety alert, which is what keeps it trigger-only
   * instead of a red decoration on every fresh mount.
   */
  handoverActive: boolean | null
  /** Critical items still PENDING this frame. Never inferred; read from the crew board. */
  criticalPending: readonly Rc19ChecklistItemId[]
  /** `null` = no fault channel at all; `[]` = a present channel reporting zero active faults. */
  activeFaults: readonly string[] | null
  /** True only while a MEASURED burn model exists and is fresh. */
  burnModelValid: boolean
  /**
   * True only while the display has a live telemetry frame at all. A blank or refused display
   * cannot evaluate the fuel plan, so the alert stays SILENT rather than asserting a verdict
   * about a stint plan nothing on screen can see.
   */
  telemetryPresent: boolean
}

export function createRc19AlertState(): Rc19AlertState {
  return {
    safetyItem: { active: false, items: [], pendingSinceMs: null },
    carriedFault: { active: false, faults: [], minimumVisibleUntilMs: 0 },
    fuelPlanInvalid: { active: false }
  }
}

function cloneRc19AlertState(state: Rc19AlertState): Rc19AlertState {
  return {
    safetyItem: { ...state.safetyItem, items: [...state.safetyItem.items] },
    carriedFault: { ...state.carriedFault, faults: [...state.carriedFault.faults] },
    fuelPlanInvalid: { ...state.fuelPlanInvalid }
  }
}

/**
 * Every alert is silent until its own trigger fires, carries the packet section 15 hysteresis,
 * has an explicit clear condition, and is unlatched the moment its input goes missing or stale.
 * No element of the alert layer is ever an always-on decoration.
 */
export function advanceRc19Alerts(state: Rc19AlertState, input: Rc19AlertInput): Rc19AlertState {
  const nowMs = finite(input.nowMs) ? input.nowMs : 0
  const next = cloneRc19AlertState(state)

  // ── Safety item unconfirmed: a critical item still PENDING during a MEASURED handover.
  //    Without a pit channel there is no handover to gate, so the alert cannot arm at all —
  //    a checklist page opened on a moving car is not a driver swap.
  if (input.handoverActive !== true || input.criticalPending.length === 0) {
    next.safetyItem = { active: false, items: [], pendingSinceMs: null }
  } else {
    const pendingSinceMs = next.safetyItem.pendingSinceMs ?? nowMs
    const engaged = nowMs - pendingSinceMs >= RC19_SAFETY_ITEM_ENGAGE_MS
    next.safetyItem = {
      active: engaged,
      items: engaged ? [...input.criticalPending] : [],
      pendingSinceMs
    }
  }

  // ── Carried fault: latched from the outgoing stint, cleared only when the fault channel
  //    itself reports zero active faults. A missing channel never invents one, and never
  //    leaves a previously latched chip on screen either.
  if (input.activeFaults === null) {
    next.carriedFault = { active: false, faults: [], minimumVisibleUntilMs: 0 }
  } else if (input.activeFaults.length > 0) {
    next.carriedFault = {
      active: true,
      faults: [...input.activeFaults],
      minimumVisibleUntilMs: Math.max(next.carriedFault.minimumVisibleUntilMs, nowMs + RC19_CARRIED_FAULT_MIN_VISIBLE_MS)
    }
  } else if (next.carriedFault.active && nowMs < next.carriedFault.minimumVisibleUntilMs) {
    next.carriedFault = { ...next.carriedFault, active: true }
  } else {
    next.carriedFault = { active: false, faults: [], minimumVisibleUntilMs: 0 }
  }

  // ── Fuel plan invalid: "engage on load", so no debounce at all. It is a statement about the
  //    BURN MODEL, not about the plan value, which dashes for the separate GAP-4 reason. A
  //    display with no telemetry frame at all cannot make that statement, so it stays silent.
  next.fuelPlanInvalid = { active: input.telemetryPresent && !input.burnModelValid }

  return next
}

/** A stale, missing or refused input can never leave a condition alert latched on. */
export function clearInvalidRc19Alerts(state: Rc19AlertState, model: Rc19DashboardModel): Rc19AlertState {
  const next = cloneRc19AlertState(state)
  if (model.handover.inBox !== true) {
    next.safetyItem = { active: false, items: [], pendingSinceMs: null }
  }
  if (!model.faults.available) {
    next.carriedFault = { active: false, faults: [], minimumVisibleUntilMs: 0 }
  }
  if (!model.telemetryPresent) {
    next.fuelPlanInvalid = { active: false }
  }
  return next
}

/** The alert lines a surface renders; empty in a silent frame, which is the reference state. */
export function rc19AlertLines(model: Rc19DashboardModel): readonly string[] {
  const lines: string[] = []
  if (model.alerts.safetyItem) lines.push('SAFETY ITEM UNCONFIRMED')
  if (model.alerts.carriedFault) lines.push('CARRIED FAULT')
  if (model.alerts.fuelPlanInvalid) lines.push('FUEL PLAN INVALID')
  return lines
}

export function rc19AlertInputForModel(
  model: Rc19DashboardModel,
  nowMs: number,
  board: Rc19ChecklistBoard
): Rc19AlertInput {
  return {
    nowMs,
    handoverActive: model.handover.inBox,
    criticalPending: board.criticalOutstanding(),
    activeFaults: model.faults.available ? model.faults.active : null,
    burnModelValid: model.burnModelValid,
    telemetryPresent: model.telemetryPresent
  }
}

// ─────────────────────────────────────────────────────────── dashboard model

export type Rc19Field = Rc01Field

export interface Rc19ChecklistRow {
  id: Rc19ChecklistItemId
  label: string
  critical: boolean
  state: Rc19ChecklistState
  glyph: string
  /** Packet 14: highlight is reserved for unconfirmed CRITICAL items during a handover. */
  blocking: boolean
}

export interface Rc19CornerModel {
  corner: Rc19Corner
  field: Rc19Field
}

export interface Rc19FaultModel {
  available: boolean
  active: readonly string[]
  label: string
  stale: boolean
}

export interface Rc19HandoverModel {
  /** `null` means the app publishes no pit-presence channel on this provider. */
  inBox: boolean | null
  stale: boolean
  label: string
}

export interface Rc19AlertFlags {
  safetyItem: boolean
  carriedFault: boolean
  fuelPlanInvalid: boolean
}

/**
 * The packet 12.1 stint-plan timeline's segment shape. It is declared so the app zone renders
 * real structure, and it is ALWAYS empty: GAP-4 leaves the plan no channel, and a drawn
 * segment would be a fabricated strategy. See `RC19_PACKET_OMISSIONS.stintPlanTimeline`.
 */
export interface Rc19TimelineSegment {
  label: string
  startLap: number
  endLap: number
}

export interface Rc19DashboardModel {
  readiness: Rc19Readiness
  checklist: readonly Rc19ChecklistRow[]
  confirmEnabled: boolean
  confirmLabel: string
  fuelLaps: Rc19Field
  tyres: readonly Rc19CornerModel[]
  tc: Rc19Field
  abs: Rc19Field
  engineMap: Rc19Field
  brakeBias: Rc19Field
  stintLaps: Rc19Field
  faults: Rc19FaultModel
  targetLaps: Rc19Field
  fuelPerLap: Rc19Field
  fuelPlan: Rc19Field
  tyrePlan: Rc19Field
  weatherNote: Rc19Field
  waterTemp: Rc19Field
  voltage: Rc19Field
  burnModelValid: boolean
  /** False whenever the buffer refused the frame or there is no telemetry at all. */
  telemetryPresent: boolean
  handover: Rc19HandoverModel
  timelineSegments: readonly Rc19TimelineSegment[]
  timelineLabel: string
  alerts: Rc19AlertFlags
}

export interface Rc19ModelOptions {
  board?: Rc19ChecklistBoard
  alerts?: Rc19AlertState
  stint?: Rc19StintTracker
}

/** GAP-3 and GAP-4: a field the packet demands and section 16 never gave a channel. */
function unbacked(): Rc19Field {
  return field(RC19_DASH, null, false, true, 'muted')
}

function numeric(reading: Rc19Reading, digits: number, tone: Rc01Field['tone'] = 'primary'): Rc19Field {
  if (!reading.present) return field(RC19_DASH, null, false, true, 'muted')
  if (reading.stale || reading.value === null) return field(RC19_DASH, null, true, false, 'muted')
  const raw = typeof reading.value === 'number' ? reading.value : Number(reading.value)
  if (!finite(raw)) return field(RC19_DASH, null, false, true, 'muted')
  return field(raw.toFixed(digits), raw, false, false, tone)
}

export function createRc19DashboardModel(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc19Channel, Rc01ChannelReceipt> = new Map(),
  nowMs: number = rc01MonotonicNow(),
  options: Rc19ModelOptions = {}
): Rc19DashboardModel {
  const board = options.board ?? new Rc19ChecklistBoard()
  const alerts = options.alerts ?? createRc19AlertState()
  const readiness = rc19ReadinessFor(board)

  const read = (channel: Rc19Channel): Rc19Reading => rc19Reading(snapshot, receipts, channel, nowMs)

  const pit = read('pitContext')
  const inBox = pit.present && !pit.stale ? pit.value === 1 : null
  const handover: Rc19HandoverModel = {
    inBox,
    stale: pit.stale,
    label: inBox === null ? 'NO PIT SOURCE' : inBox ? 'IN BOX' : 'ON TRACK'
  }

  const checklist: Rc19ChecklistRow[] = RC19_CHECKLIST_ITEMS.map((item) => {
    const state = board.stateOf(item.id)
    return {
      id: item.id,
      label: item.label,
      critical: item.critical,
      state,
      glyph: RC19_STATE_GLYPH[state],
      blocking: item.critical && state !== 'CONFIRMED' && alerts.safetyItem.active
    }
  })

  const tyres: Rc19CornerModel[] = RC19_CORNERS.map((corner) => ({
    corner,
    field: numeric(read(RC19_CORNER_CHANNELS[corner]), 2)
  }))

  const tcReading = read('tc')
  // Packet 16: "last-known grayed if bus quiet"; never a default step.
  const tc: Rc19Field = !tcReading.present
    ? field(RC19_DASH, null, false, true, 'muted')
    : tcReading.stale
      ? field(String(tcReading.lastKnown ?? RC19_DASH), tcReading.lastKnown, true, false, 'muted')
      : field(String(tcReading.value), tcReading.value, false, false, 'primary')

  const faultChannel = read('faults')
  const activeFaults = snapshot ? rc19ActiveFaults(snapshot) : null
  const faultsAvailable = faultChannel.present && activeFaults !== null
  const latchedFaults = alerts.carriedFault.active ? alerts.carriedFault.faults : []
  const shownFaults = faultsAvailable ? (activeFaults ?? []) : []
  const faults: Rc19FaultModel = {
    available: faultsAvailable,
    active: faultsAvailable ? (shownFaults.length > 0 ? shownFaults : latchedFaults) : [],
    label: !faultsAvailable
      ? RC19_FAULTS_NO_SOURCE
      : faultChannel.stale
        ? RC19_DASH
        : shownFaults.length > 0
          ? shownFaults.join(' / ')
          : RC19_FAULTS_NONE,
    stale: faultChannel.stale
  }

  const stintTracker = options.stint
  const stintLapsRaw = stintTracker ? stintTracker.lapsSinceStart(snapshot) : null
  const lapCounter = read('lapCounter')
  const stintLaps: Rc19Field =
    stintLapsRaw === null
      ? field(RC19_DASH, null, false, true, 'muted')
      : lapCounter.stale
        ? field(String(stintLapsRaw), stintLapsRaw, true, false, 'muted')
        : field(String(stintLapsRaw), stintLapsRaw, false, false, 'primary')

  const burnReading = read('fuelPerLap')
  const burnModelValid = burnReading.present && !burnReading.stale && burnReading.value !== null

  return {
    readiness,
    checklist,
    confirmEnabled: readiness.outstandingCount === 0 && !readiness.latched,
    confirmLabel: 'CONFIRM READY',
    fuelLaps: numeric(read('fuelLaps'), 1),
    tyres,
    tc,
    // GAP-3: packet 11.1 demands these three cells and section 16 supplies no channel.
    abs: unbacked(),
    engineMap: unbacked(),
    brakeBias: unbacked(),
    stintLaps,
    faults,
    // GAP-4: the entire next-stint plan has no channel; only the measured burn rate is real.
    targetLaps: unbacked(),
    fuelPerLap: numeric(burnReading, 2),
    fuelPlan: unbacked(),
    tyrePlan: unbacked(),
    weatherNote: unbacked(),
    // OV-6: tertiary channels exist in section 16 but have a zone only on the app canvas.
    waterTemp: numeric(read('waterTemp'), 0),
    voltage: numeric(read('voltage'), 1),
    burnModelValid,
    telemetryPresent: snapshot !== null,
    handover,
    timelineSegments: [],
    timelineLabel: RC19_TIMELINE_NO_SOURCE,
    alerts: {
      safetyItem: alerts.safetyItem.active,
      carriedFault: alerts.carriedFault.active,
      fuelPlanInvalid: alerts.fuelPlanInvalid.active
    }
  }
}

/** Packet 19: checklist state is glyph + word + hue, so the accessible name states both. */
export function rc19ChecklistDescription(row: Rc19ChecklistRow): string {
  const blocking = row.blocking ? ', blocking ready' : ''
  return `${row.label}: ${row.state}${row.critical ? ', critical' : ''}${blocking}`
}

/** Packet 19: readiness is spelled out and the count is spelled out beside it. */
export function rc19ReadinessDescription(readiness: Rc19Readiness): string {
  return `Handover ${readiness.word}, ${readiness.outstandingCount} outstanding`
}
