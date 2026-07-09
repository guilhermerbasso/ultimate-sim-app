// MICRO "race moment" layer for the adaptive dashboard (PURE, deterministic).
//
// Where `dashboard-adaptive.ts` decides the MACRO session phase (practice / qual
// / race / pit …) and a coarse emphasis plan, this module adds a fast MICRO layer
// that reacts to the live "moment" of the lap — an incident you are recovering
// from, a safety car, fuel running out, a car closing on you, your flying lap,
// etc. — and promotes / demotes / recolours a handful of widgets accordingly.
//
// Hard rules (so it never flickers):
//   • exactly ONE "hero" moment at a time, chosen by a fixed PRECEDENCE order;
//   • asymmetric Schmitt thresholds (enter ≠ exit) per moment;
//   • a min DWELL on a candidate + a COOLDOWN after every committed switch;
//   • the function is a pure reducer `resolveRaceMoment(snapshot, predictions,
//     prev)` → next state. Anti-flicker timing is encoded in the returned state,
//     so it is correct regardless of how often the caller ticks (recompute at
//     5–10 Hz, NOT per frame).
//
// React/Electron/node-free: importable by main, renderer and unit tests.

import type { TelemetrySnapshot } from './telemetry'
import type { PredictionsSnapshot } from './predictions'
import type { DashboardConcept } from './dashboard-nl'

// ─── Public taxonomy ─────────────────────────────────────────────────────────

/**
 * The mutually-exclusive race moments, written here in PRECEDENCE order (highest
 * first). Only ONE is ever the "hero". `clear-running` is the default tail.
 */
export const RACE_MOMENTS_BY_PRECEDENCE = [
  'incident-recovery',
  'safety-car',
  'fuel-critical',
  'pit-approach',
  'under-pressure',
  'attacking',
  'leading-p1',
  'last-lap',
  'qualifying-lap',
  'out-lap',
  'tire-pressure-low',
  'tire-optimal-temp',
  'clear-running'
] as const

export type RaceMoment = (typeof RACE_MOMENTS_BY_PRECEDENCE)[number]

/**
 * The top critical moments. An escalation TO one of these bypasses the
 * post-switch cooldown (it still respects the tiny `criticalDwellMs`) so a fresh
 * incident / safety car is surfaced immediately instead of waiting out a cooldown
 * from an unrelated earlier switch.
 */
export const CRITICAL_BYPASS_MOMENTS: ReadonlySet<RaceMoment> = new Set<RaceMoment>([
  'incident-recovery',
  'safety-car'
])

/** Colour token a moment paints its hero widgets with. */
export type RaceMomentColor = 'normal' | 'caution' | 'critical' | 'good'

/** Higher-salience widget style a moment may want to swap a hero widget to. */
export type SalientStyleFamily = 'gauge' | 'ring' | 'led' | 'heatmap'

// ─── State carried between ticks (the reducer's "prev") ──────────────────────

export interface RaceMomentState {
  /** Currently committed hero moment. */
  moment: RaceMoment
  /** Colour token for the current moment. */
  color: RaceMomentColor
  /** ms timestamp when the current moment was committed. */
  since: number
  /** ms timestamp of the last committed switch (drives the cooldown). */
  lastSwitchAt: number
  /** Pending candidate awaiting dwell, or null when none. */
  candidate: RaceMoment | null
  /** ms timestamp the current candidate first appeared. */
  candidateSince: number
  // ── edge-detection bookkeeping (not part of the public "decision") ──
  /** Last seen incident counter, to detect a fresh incident. */
  lastIncidentCount: number
  /** ms timestamp of the last incident increment. */
  incidentAt: number
  /** ms timestamp we last left the pit lane (drives the out-lap window). */
  leftPitAt: number
  /** Whether we were on pit road on the previous tick (edge detection). */
  lastOnPitRoad: boolean
  /** ms timestamp the reducer last ran (for caller-side throttling). */
  updatedAt: number
}

export interface RaceMomentTunables {
  /** A candidate must persist this long before it is committed (ms). */
  dwellMs: number
  /**
   * A tiny min dwell for CRITICAL escalations (incident-recovery / safety-car).
   * These bypass the post-switch cooldown but still respect this dwell so a
   * 1-frame blip can't flip the hero.
   */
  criticalDwellMs: number
  /** No further switch is allowed within this window after a switch (ms). */
  cooldownMs: number
  /** How long after an incident we keep "recovering" alive (ms). */
  incidentWindowMs: number
  /** How long after leaving the pits the out-lap moment stays alive (ms). */
  outLapWindowMs: number
  /** Fuel finish-margin (laps) Schmitt band. */
  fuelEnterMarginLaps: number
  fuelExitMarginLaps: number
  /** Catch/caught ETA (laps) Schmitt band. */
  catchEnterEtaLaps: number
  catchExitEtaLaps: number
}

export const DEFAULT_RACE_MOMENT_TUNABLES: RaceMomentTunables = {
  dwellMs: 400,
  criticalDwellMs: 120,
  cooldownMs: 600,
  incidentWindowMs: 6000,
  outLapWindowMs: 45000,
  fuelEnterMarginLaps: 1.0,
  fuelExitMarginLaps: 1.6,
  catchEnterEtaLaps: 2.0,
  catchExitEtaLaps: 3.5
}

// ─── Static per-moment presentation (colour / promote / demote / style) ──────

export interface RaceMomentPreset {
  color: RaceMomentColor
  /** PT-BR label for the UI. */
  label: string
  /** Concepts to promote (size↑/center/recolor). Capped to 3. */
  promote: DashboardConcept[]
  /** Concepts to demote (dim+shrink, never removed). */
  demote: DashboardConcept[]
  /** Optional higher-salience style for the hero widget. */
  heroStyleFamily?: SalientStyleFamily
}

const MOMENT_PRESETS: Record<RaceMoment, RaceMomentPreset> = {
  'incident-recovery': {
    color: 'critical',
    label: 'Recuperando de incidente',
    promote: ['flags', 'radar', 'position'],
    demote: ['delta', 'laptime', 'shift', 'enginetemps'],
    heroStyleFamily: 'led'
  },
  'safety-car': {
    color: 'caution',
    label: 'Safety car / flag amarela',
    promote: ['flags', 'position', 'standings'],
    demote: ['delta', 'laptime', 'shift'],
    heroStyleFamily: 'led'
  },
  'fuel-critical': {
    color: 'critical',
    label: 'Critical fuel',
    promote: ['fuel', 'pit'],
    demote: ['radar', 'steering', 'gforce'],
    heroStyleFamily: 'gauge'
  },
  'pit-approach': {
    color: 'caution',
    label: 'Pit entry / in-lap',
    promote: ['pit', 'fuel', 'tyres'],
    demote: ['delta', 'laptime', 'gaps']
  },
  'under-pressure': {
    color: 'caution',
    label: 'Under pressure (being caught)',
    promote: ['relatives', 'radar', 'gaps'],
    demote: ['enginetemps', 'weather', 'tyres']
  },
  attacking: {
    color: 'good',
    label: 'Atacando (aproximando do da frente)',
    promote: ['gaps', 'relatives', 'delta'],
    demote: ['enginetemps', 'weather']
  },
  'leading-p1': {
    color: 'good',
    label: 'Liderando (P1)',
    promote: ['position', 'gaps', 'fuel'],
    demote: ['radar', 'steering']
  },
  'last-lap': {
    color: 'caution',
    label: 'Last lap',
    promote: ['position', 'gaps', 'flags'],
    demote: ['fuel', 'enginetemps', 'tyres']
  },
  'qualifying-lap': {
    color: 'normal',
    label: 'Flying lap (quali)',
    promote: ['delta', 'laptime'],
    demote: ['fuel', 'position', 'gaps', 'standings', 'relatives']
  },
  'out-lap': {
    color: 'normal',
    label: 'Out-lap (aquecendo)',
    promote: ['tyres', 'brakes'],
    demote: ['gaps', 'standings', 'delta']
  },
  'tire-pressure-low': {
    color: 'caution',
    label: 'Low tire pressure',
    promote: ['tyres'],
    demote: ['gaps', 'standings'],
    heroStyleFamily: 'ring'
  },
  'tire-optimal-temp': {
    color: 'good',
    label: 'Tire in ideal temperature window',
    promote: ['tyres', 'delta'],
    demote: [],
    heroStyleFamily: 'heatmap'
  },
  'clear-running': {
    color: 'normal',
    label: 'Pista livre',
    promote: [],
    demote: []
  }
}

/** The static preset for a moment (colour, label, promote/demote, style). */
export function raceMomentPreset(moment: RaceMoment): RaceMomentPreset {
  return MOMENT_PRESETS[moment]
}

// ─── Derived signals + per-moment Schmitt predicates ─────────────────────────

interface Signals {
  connected: boolean
  isRace: boolean
  isQualify: boolean
  onPitRoad: boolean
  pitLimiter: boolean
  inPitStall: boolean
  lapDistPct: number | null
  position: number | null
  classPosition: number | null
  lapsRemaining: number | null
  white: boolean
  yellow: boolean
  speedKmh: number
  steerDeg: number
  throttle: number
  brake: number
  // Pre-resolved Schmitt booleans (enter = high bar, stay = low bar) so the
  // per-moment predicates stay clean and threshold-free.
  fuelCriticalEnter: boolean
  fuelCriticalStay: boolean
  catchEnter: boolean
  catchStay: boolean
  caughtEnter: boolean
  caughtStay: boolean
  pressureLow: boolean
  tempOptimal: boolean
  incidentRecent: boolean
  recovering: boolean
  outLapActive: boolean
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function sessionIsRace(t: string | undefined): boolean {
  return !!t && t.toLowerCase().includes('race')
}

function sessionIsQualify(t: string | undefined): boolean {
  if (!t) return false
  const s = t.toLowerCase()
  return s.includes('qual') || s.includes('lone') || s.includes('hotlap') || s.includes('hot lap')
}

/** Fuel margin (laps) preferring predictions, falling back to raw telemetry. */
function fuelMargin(snapshot: TelemetrySnapshot, predictions: PredictionsSnapshot | null | undefined): number | null {
  const fromPred = num(predictions?.fuel?.finishMarginLaps)
  if (fromPred != null) return fromPred
  const fuel = num(snapshot.fuelLiters)
  const perLap = num(snapshot.fuelPerLap)
  const lapsRem = num(snapshot.lapsRemaining)
  // Reject the iRacing timed-session sentinel (SessionLapsRemainEx = 32767): without
  // this, a timed RACE reads a huge negative margin → false fuel-critical until the
  // prediction (time-based) arrives. Mirror the codebase's `< 9999` lap-count rule.
  if (fuel == null || perLap == null || perLap <= 0 || lapsRem == null || lapsRem >= 9999) return null
  return fuel / perLap - lapsRem
}

/**
 * A "moment definition" = its enter predicate (high bar, used when it is NOT the
 * hero) and its stay predicate (low bar, used while it IS the hero). The gap
 * between the two is the Schmitt hysteresis that keeps the choice stable.
 */
interface MomentDef {
  enter(s: Signals): boolean
  stay(s: Signals): boolean
}

function buildDefs(): Record<RaceMoment, MomentDef> {
  const same = (p: (s: Signals) => boolean): MomentDef => ({ enter: p, stay: p })
  return {
    'incident-recovery': {
      enter: (s) =>
        s.incidentRecent && (s.speedKmh < 70 || Math.abs(s.steerDeg) > 90 || (s.brake > 0.6 && s.throttle < 0.2)),
      stay: (s) => s.incidentRecent
    },
    'safety-car': same((s) => s.yellow),
    'fuel-critical': {
      enter: (s) => s.isRace && s.fuelCriticalEnter,
      stay: (s) => s.isRace && s.fuelCriticalStay
    },
    'pit-approach': same((s) => s.onPitRoad || s.pitLimiter || s.inPitStall),
    'under-pressure': {
      enter: (s) => s.isRace && s.caughtEnter,
      stay: (s) => s.isRace && s.caughtStay
    },
    attacking: {
      enter: (s) => s.isRace && s.catchEnter,
      stay: (s) => s.isRace && s.catchStay
    },
    'leading-p1': same((s) => s.isRace && (s.position === 1 || s.classPosition === 1)),
    'last-lap': {
      enter: (s) => s.isRace && ((s.lapsRemaining != null && s.lapsRemaining <= 1) || s.white),
      stay: (s) => s.isRace && s.lapsRemaining != null && s.lapsRemaining <= 1
    },
    'qualifying-lap': {
      enter: (s) =>
        s.isQualify &&
        !s.outLapActive &&
        !s.onPitRoad &&
        s.speedKmh > 40 &&
        s.lapDistPct != null &&
        s.lapDistPct > 0.05 &&
        s.lapDistPct < 0.97,
      stay: (s) => s.isQualify && !s.onPitRoad && s.speedKmh > 25
    },
    'out-lap': same((s) => s.outLapActive && !s.onPitRoad),
    'tire-pressure-low': same((s) => s.pressureLow),
    'tire-optimal-temp': same((s) => s.tempOptimal),
    'clear-running': same(() => true)
  }
}

const MOMENT_DEFS = buildDefs()

// ─── The reducer ─────────────────────────────────────────────────────────────

/** A fresh, "pista livre" state at time `now`. */
export function initialRaceMomentState(now = Date.now()): RaceMomentState {
  return {
    moment: 'clear-running',
    color: 'normal',
    since: now,
    lastSwitchAt: 0,
    candidate: null,
    candidateSince: now,
    lastIncidentCount: 0,
    incidentAt: 0,
    leftPitAt: 0,
    lastOnPitRoad: false,
    updatedAt: now
  }
}

export interface ResolveOptions {
  now?: number
  tunables?: Partial<RaceMomentTunables>
}

/**
 * Pure reducer: given the live snapshot + predictions and the PREVIOUS state,
 * return the NEXT state with at most one hero moment, applying precedence,
 * asymmetric Schmitt thresholds, a min dwell and a post-switch cooldown.
 *
 * Throttle the CALLS to 5–10 Hz — the timing maths uses `now`, so the result is
 * correct at any cadence (a faster caller just reacts a hair sooner).
 */
export function resolveRaceMoment(
  snapshot: TelemetrySnapshot | null | undefined,
  predictions: PredictionsSnapshot | null | undefined,
  prev: RaceMomentState | null,
  opts: ResolveOptions = {}
): RaceMomentState {
  const now = opts.now ?? Date.now()
  const tun = { ...DEFAULT_RACE_MOMENT_TUNABLES, ...opts.tunables }
  const base = prev ?? initialRaceMomentState(now)

  if (!snapshot || !snapshot.connected) {
    return {
      ...base,
      moment: 'clear-running',
      color: MOMENT_PRESETS['clear-running'].color,
      candidate: null,
      candidateSince: now,
      updatedAt: now
    }
  }

  // ── edge detection (incident + pit-exit), produced from prev + snapshot ──
  const incidentCount = num(snapshot.incidentCountMy) ?? num(snapshot.incidentCount) ?? base.lastIncidentCount
  let incidentAt = base.incidentAt
  if (incidentCount > base.lastIncidentCount) incidentAt = now

  const onPitRoad = snapshot.onPitRoad === true
  let leftPitAt = base.leftPitAt
  if (base.lastOnPitRoad && !onPitRoad) leftPitAt = now

  const incidentRecent = incidentAt > 0 && now - incidentAt <= tun.incidentWindowMs
  const outLapActive = leftPitAt > 0 && now - leftPitAt <= tun.outLapWindowMs

  const margin = fuelMargin(snapshot, predictions)
  const catchEta = num(predictions?.catchAhead?.etaLaps)
  const caughtEta = num(predictions?.caughtBehind?.etaLaps)

  const s: Signals = {
    connected: true,
    isRace: sessionIsRace(snapshot.sessionType),
    isQualify: sessionIsQualify(snapshot.sessionType),
    onPitRoad,
    pitLimiter: snapshot.pitLimiter === true,
    inPitStall: snapshot.pit?.inPitStall === true,
    lapDistPct: num(snapshot.lapDistPct),
    position: num(snapshot.position),
    classPosition: num(snapshot.classPosition),
    lapsRemaining: num(snapshot.lapsRemaining),
    white: snapshot.flags?.white === true || snapshot.flags?.greenWhiteCheckered === true,
    yellow: snapshot.flags?.yellow === true,
    speedKmh: num(snapshot.speedKmh) ?? 0,
    steerDeg: num(snapshot.steerAngleDeg) ?? 0,
    throttle: num(snapshot.throttle) ?? 0,
    brake: num(snapshot.brake) ?? 0,
    fuelCriticalEnter: margin != null && margin < tun.fuelEnterMarginLaps,
    fuelCriticalStay: margin != null && margin < tun.fuelExitMarginLaps,
    catchEnter: catchEta != null && catchEta <= tun.catchEnterEtaLaps,
    catchStay: catchEta != null && catchEta <= tun.catchExitEtaLaps,
    caughtEnter: caughtEta != null && caughtEta <= tun.catchEnterEtaLaps,
    caughtStay: caughtEta != null && caughtEta <= tun.catchExitEtaLaps,
    pressureLow: predictions?.tire?.pressureState === 'low',
    tempOptimal: predictions?.tire?.tempState === 'optimal',
    incidentRecent,
    recovering: incidentRecent,
    outLapActive
  }

  // ── active set: hero uses its STAY predicate, others their ENTER predicate ──
  const target = pickTarget(s, base.moment)

  // ── commit / dwell / cooldown ──
  const next: RaceMomentState = {
    ...base,
    lastIncidentCount: incidentCount,
    incidentAt,
    leftPitAt,
    lastOnPitRoad: onPitRoad,
    updatedAt: now
  }

  if (target === base.moment) {
    // Hero unchanged — drop any stale candidate, refresh colour.
    next.candidate = null
    next.candidateSince = now
    next.color = MOMENT_PRESETS[target].color
    return next
  }

  // First-ever classification (no real prev) commits immediately.
  if (!prev) {
    next.moment = target
    next.color = MOMENT_PRESETS[target].color
    next.since = now
    next.lastSwitchAt = now
    next.candidate = null
    next.candidateSince = now
    return next
  }

  // A different hero wants in — gate it behind dwell + cooldown.
  if (base.candidate !== target) {
    next.candidate = target
    next.candidateSince = now
  } else {
    next.candidate = base.candidate
    next.candidateSince = base.candidateSince
  }

  // A critical escalation (incident/safety-car) bypasses the post-switch cooldown
  // but still respects a tiny dwell; everything else waits out dwell + cooldown.
  const bypassCooldown = CRITICAL_BYPASS_MOMENTS.has(target)
  const requiredDwellMs = bypassCooldown ? tun.criticalDwellMs : tun.dwellMs
  const dwellOk = now - next.candidateSince >= requiredDwellMs
  const cooldownOk = bypassCooldown || now - base.lastSwitchAt >= tun.cooldownMs
  if (dwellOk && cooldownOk) {
    next.moment = target
    next.color = MOMENT_PRESETS[target].color
    next.since = now
    next.lastSwitchAt = now
    next.candidate = null
    next.candidateSince = now
  } else {
    // Hold the current hero — no flicker.
    next.moment = base.moment
    next.color = MOMENT_PRESETS[base.moment].color
  }
  return next
}

/** Highest-precedence active moment, honouring the asymmetric Schmitt bands. */
function pickTarget(s: Signals, current: RaceMoment): RaceMoment {
  for (const m of RACE_MOMENTS_BY_PRECEDENCE) {
    const def = MOMENT_DEFS[m]
    const active = m === current ? def.stay(s) : def.enter(s)
    if (active) return m
  }
  return 'clear-running'
}

// ─── Targetable moment CATALOG (the user-facing taxonomy, Task 1) ────────────
//
// `RaceMoment` (above) is the SMALL, mutually-exclusive set of "hero" micro
// moments the anti-flicker reducer commits to one-at-a-time. The CATALOG below is
// a MUCH richer, NON-exclusive taxonomy the adaptive EDITOR lists so the user can
// attach show/hide/emphasis/blink rules per moment. Several catalog ids can be
// active at once (e.g. `green` + `mid-race` + `traffic-ahead` + `braking-zone`).
//
// Every existing `RaceMoment` id is also a catalog id (back-compat): a user rule
// keyed by `attacking`, `out-lap`, … keeps working. Ids the runtime cannot yet
// detect from the snapshot are still listed (so the editor can offer them) — they
// simply never become active until detection is added.

/** Coarse grouping for the editor's moment list. */
export type MomentGroup = 'session' | 'lap' | 'situational' | 'micro'

/** PT-BR group headings for the editor UI. */
export const MOMENT_GROUP_LABELS: Record<MomentGroup, string> = {
  session: 'Session phase',
  lap: 'Momento da lap',
  situational: 'Situacional',
  micro: 'Micro-moment (hero)'
}

export interface MomentCatalogEntry {
  id: string
  /** PT-BR short label for the editor. */
  label: string
  /** PT-BR one-line description of when this moment is active. */
  description: string
  group: MomentGroup
  /** False when the runtime cannot yet detect it (editor still lists it). */
  detectable: boolean
}

/**
 * The single, ORDERED catalog of every targetable moment id. Order is editor
 * display order: session phases → lap moments → situational → hero micro moments.
 */
export const MOMENT_CATALOG: readonly MomentCatalogEntry[] = [
  // ── Session / lifecycle phases ──────────────────────────────────────────────
  { id: 'garage', label: 'Garage / stopped in the box', description: 'No live session or stopped in the box before going out.', group: 'session', detectable: true },
  { id: 'practice', label: 'Free practice', description: 'Free practice session.', group: 'session', detectable: true },
  { id: 'qualifying', label: 'Qualifying', description: 'Qualifying session (quali/hotlap).', group: 'session', detectable: true },
  { id: 'warmup', label: 'Warmup', description: 'Session de aquecimento antes da race.', group: 'session', detectable: true },
  { id: 'formation', label: 'Formation lap', description: 'Race has not started yet (formation/grid lap).', group: 'session', detectable: true },
  { id: 'race-start', label: 'Largada', description: 'Primeira lap da race — largada/relargada.', group: 'session', detectable: true },
  { id: 'green', label: 'Bandeira verde', description: 'Pista liberada (flag verde ativa).', group: 'session', detectable: true },
  { id: 'mid-race', label: 'Meio de race', description: 'Race em andamento, fora das laps finais.', group: 'session', detectable: true },
  { id: 'final-laps', label: 'Laps finais', description: 'Fhighm poucas laps para o end (≤ 3).', group: 'session', detectable: true },
  { id: 'last-lap', label: 'Last lap', description: 'Last lap da race (flag branca).', group: 'session', detectable: true },
  { id: 'cooldown', label: 'Cool-down lap', description: 'After the checkered flag (cool-down).', group: 'session', detectable: true },
  { id: 'out-lap', label: 'Out-lap (leaving the box)', description: 'Right after leaving the pits ? warming tires/brakes.', group: 'session', detectable: true },
  { id: 'in-lap', label: 'In-lap (entering the box)', description: 'Heading to the pits (limiter/pit entry).', group: 'session', detectable: true },
  { id: 'pit-window-open', label: 'Janela de pit aberta', description: 'Boxes abertos para stop na race.', group: 'session', detectable: true },
  { id: 'in-pit', label: 'Nos boxes', description: 'No pit lane ou no stall.', group: 'session', detectable: true },
  // ── Lap / corner moments ────────────────────────────────────────────────────
  { id: 'crossing-start-finish', label: 'Cruzando a linha', description: 'Cruzando a linha de chegada/largada.', group: 'lap', detectable: true },
  { id: 'sector-1-entry', label: 'Sector 1 entry', description: 'Start of sector 1 on the lap.', group: 'lap', detectable: true },
  { id: 'sector-2-entry', label: 'Sector 2 entry', description: 'Start of sector 2 on the lap.', group: 'lap', detectable: true },
  { id: 'sector-3-entry', label: 'Sector 3 entry', description: 'Start of sector 3 on the lap.', group: 'lap', detectable: true },
  { id: 'braking-zone', label: 'Zona de frenagem', description: 'Freando forte com pouco acelerador.', group: 'lap', detectable: true },
  { id: 'mid-corner', label: 'Mid-corner', description: 'Loaded steering, at the corner apex.', group: 'lap', detectable: true },
  { id: 'corner-exit', label: 'Corner exit', description: 'Opening steering and getting back to throttle.', group: 'lap', detectable: true },
  { id: 'on-straight', label: 'Na reta', description: 'Volante reto, acelerador a fundo em high.', group: 'lap', detectable: true },
  // ── Situational ─────────────────────────────────────────────────────────────
  { id: 'traffic-ahead', label: 'Traffic ahead', description: 'Car just ahead, within ~1s.', group: 'situational', detectable: true },
  { id: 'being-lapped', label: 'Being lapped', description: 'A faster car is about to lap you (blue flag).', group: 'situational', detectable: true },
  { id: 'lapping', label: 'Lapping backmarker', description: 'Overtaking a car that is laps down.', group: 'situational', detectable: false },
  { id: 'blue-flag', label: 'Blue flag', description: 'Blue flag shown to you.', group: 'situational', detectable: true },
  { id: 'yellow-sector', label: 'Sector amarelo', description: 'Yellow flag em vigor.', group: 'situational', detectable: true },
  { id: 'drs', label: 'DRS available/ativo', description: 'DRS aberto/ativo (carros com DRS).', group: 'situational', detectable: true },
  { id: 'overtake-window', label: 'Overtake window', description: 'Very close to the car ahead (?1 lap to catch).', group: 'situational', detectable: true },
  { id: 'defending', label: 'Defending position', description: 'Car behind is close (< 1s) and closing.', group: 'situational', detectable: true },
  { id: 'attacking', label: 'Atacando', description: 'Aproximando do carro da frente.', group: 'situational', detectable: true },
  { id: 'fuel-save', label: 'Economia de fuel', description: 'Margem de fuel apertada — economizar.', group: 'situational', detectable: true },
  { id: 'push-now', label: 'Empurrar agora', description: 'Fuel folgado nas laps finais — atacar.', group: 'situational', detectable: true },
  { id: 'tyre-cliff', label: 'Tire degradation', description: 'Tire degrading quickly (pace drop).', group: 'situational', detectable: true },
  // ── Hero micro moments (anti-flicker reducer; one at a time) ─────────────────
  { id: 'incident-recovery', label: 'Recovering from incident', description: 'Right after a crash/spin.', group: 'micro', detectable: true },
  { id: 'safety-car', label: 'Safety car / amarela', description: 'Safety car ou flag amarela total.', group: 'micro', detectable: true },
  { id: 'fuel-critical', label: 'Critical fuel', description: 'Fuel may not reach the end.', group: 'micro', detectable: true },
  { id: 'pit-approach', label: 'Pit entry', description: 'Entering pit lane / limiter on.', group: 'micro', detectable: true },
  { id: 'under-pressure', label: 'Under pressure', description: 'Being caught by the car behind.', group: 'micro', detectable: true },
  { id: 'leading-p1', label: 'Liderando (P1)', description: 'Em primeiro na race.', group: 'micro', detectable: true },
  { id: 'qualifying-lap', label: 'Flying lap (quali)', description: 'Timed fast lap in qualifying.', group: 'micro', detectable: true },
  { id: 'tire-pressure-low', label: 'Low tire pressure', description: 'Tire pressures below the window.', group: 'micro', detectable: true },
  { id: 'tire-optimal-temp', label: 'Tire in ideal temperature window', description: 'Tires in the ideal temperature window.', group: 'micro', detectable: true },
  { id: 'clear-running', label: 'Pista livre', description: 'Sem events — pace livre.', group: 'micro', detectable: true }
] as const

/** Fast membership set of every catalog id. */
export const MOMENT_CATALOG_IDS: ReadonlySet<string> = new Set(MOMENT_CATALOG.map((e) => e.id))

const MOMENT_CATALOG_BY_ID: ReadonlyMap<string, MomentCatalogEntry> = new Map(
  MOMENT_CATALOG.map((e) => [e.id, e])
)

/** Catalog entry for an id (or undefined for an unknown id). */
export function momentCatalogEntry(id: string): MomentCatalogEntry | undefined {
  return MOMENT_CATALOG_BY_ID.get(id)
}

/** Best-effort PT-BR label for any moment id (falls back to the raw id). */
export function momentLabel(id: string): string {
  return MOMENT_CATALOG_BY_ID.get(id)?.label ?? id
}

// ─── Multi-moment detection (drives USER rules at runtime) ───────────────────

function sessionIsPractice(t: string | undefined): boolean {
  if (!t) return false
  const s = t.toLowerCase()
  return s.includes('practice') || s.includes('test') || s.includes('offline')
}

function sessionIsWarmup(t: string | undefined): boolean {
  return !!t && t.toLowerCase().includes('warm')
}

export interface ActiveMomentOptions {
  now?: number
  /** Include the hero micro-moment id from `hero` in the set (default true). */
  includeHero?: boolean
}

/**
 * Resolve the FULL set of currently-active catalog moment ids from the live
 * snapshot + predictions + the committed hero state. NON-exclusive: many ids may
 * be active at once. Pure + deterministic; recompute at 5–10 Hz (NOT per frame).
 *
 * This is what the USER rules match against: the editor attaches rules per
 * catalog id, and the runtime applies every rule whose id is in this set.
 */
export function detectActiveMoments(
  snapshot: TelemetrySnapshot | null | undefined,
  predictions: PredictionsSnapshot | null | undefined,
  hero: RaceMomentState | null | undefined,
  opts: ActiveMomentOptions = {}
): Set<string> {
  const active = new Set<string>()
  if (!snapshot || !snapshot.connected) {
    active.add('garage')
    return active
  }

  if ((opts.includeHero ?? true) && hero?.moment) active.add(hero.moment)

  const type = snapshot.sessionType
  const isRace = sessionIsRace(type)
  const isQualify = sessionIsQualify(type)
  const isPractice = sessionIsPractice(type)
  const isWarmup = sessionIsWarmup(type)

  const flags = snapshot.flags
  const checkered = flags?.checkered === true || flags?.greenWhiteCheckered === true
  const onPitRoad = snapshot.onPitRoad === true
  const inPitStall = snapshot.pit?.inPitStall === true
  const pitLimiter = snapshot.pitLimiter === true
  const onPit = onPitRoad || inPitStall || pitLimiter

  const speedKmh = num(snapshot.speedKmh) ?? 0
  const throttle = num(snapshot.throttle) ?? 0
  const brake = num(snapshot.brake) ?? 0
  const steerDeg = Math.abs(num(snapshot.steerAngleDeg) ?? 0)
  const lapDist = num(snapshot.lapDistPct)
  const currentLap = num(snapshot.currentLap)
  const lapsRem = num(snapshot.lapsRemaining)
  const lapsRemValid = lapsRem != null && lapsRem < 9999

  // ── Session / lifecycle ──
  if (isPractice) active.add('practice')
  if (isQualify) active.add('qualifying')
  if (isWarmup) active.add('warmup')
  if (onPit) {
    active.add('in-pit')
    if (pitLimiter || onPitRoad) active.add('in-lap')
  }
  if (speedKmh < 2 && onPit) active.add('garage')
  if (isRace && snapshot.pit?.pitsOpen === true) active.add('pit-window-open')

  if (isRace) {
    const notStarted = !(currentLap != null && currentLap > 0)
    if (notStarted && !checkered) {
      active.add('formation')
    } else {
      if (currentLap != null && currentLap <= 1) active.add('race-start')
      if (flags?.green === true) active.add('green')
      if (lapsRemValid && (lapsRem as number) <= 3) active.add('final-laps')
      else active.add('mid-race')
      if (lapsRemValid && (lapsRem as number) <= 1) active.add('last-lap')
      if (flags?.white === true || flags?.greenWhiteCheckered === true) active.add('last-lap')
      if (checkered) active.add('cooldown')
    }
  }

  // ── Lap / corner moments ──
  if (lapDist != null && !onPitRoad) {
    if (lapDist > 0.985 || lapDist < 0.015) active.add('crossing-start-finish')
    const entryWin = 0.06
    if (lapDist >= 0 && lapDist < entryWin) active.add('sector-1-entry')
    if (lapDist >= 1 / 3 && lapDist < 1 / 3 + entryWin) active.add('sector-2-entry')
    if (lapDist >= 2 / 3 && lapDist < 2 / 3 + entryWin) active.add('sector-3-entry')
  }
  if (!onPitRoad && speedKmh > 20) {
    if (brake > 0.45 && throttle < 0.25) active.add('braking-zone')
    if (steerDeg < 8 && throttle > 0.85 && speedKmh > 80) active.add('on-straight')
    if (steerDeg > 22 && throttle < 0.6 && brake < 0.4) active.add('mid-corner')
    if (steerDeg > 8 && steerDeg < 55 && throttle > 0.55 && brake < 0.1) active.add('corner-exit')
  }

  // ── Situational ──
  if (flags?.blue === true) {
    active.add('blue-flag')
    active.add('being-lapped')
  }
  if (flags?.yellow === true) active.add('yellow-sector')
  if (snapshot.drs === true) active.add('drs')

  const aheadGap = num(snapshot.relatives?.ahead?.gapSec)
  if (aheadGap != null && Math.abs(aheadGap) <= 1.0) active.add('traffic-ahead')
  const behindGap = num(snapshot.relatives?.behind?.gapSec)
  if (behindGap != null && Math.abs(behindGap) <= 1.0) active.add('defending')

  const catchAhead = predictions?.catchAhead
  if (catchAhead && num(catchAhead.etaLaps) != null && (catchAhead.etaLaps as number) <= 1 && (num(catchAhead.gapSec) ?? 99) < 1.2) {
    active.add('overtake-window')
  }
  const caughtBehind = predictions?.caughtBehind
  if (caughtBehind && num(caughtBehind.etaLaps) != null && (caughtBehind.etaLaps as number) <= 1 && (num(caughtBehind.gapSec) ?? 99) < 1.2) {
    active.add('defending')
  }

  const margin = fuelMargin(snapshot, predictions)
  if (isRace && margin != null && margin >= 0.3 && margin < 2.0) active.add('fuel-save')
  if (isRace && margin != null && margin > 2.5 && lapsRemValid && (lapsRem as number) <= 3) active.add('push-now')

  const deg = num(predictions?.tire?.degSecPerLap)
  if (deg != null && deg > 0.25) active.add('tyre-cliff')

  return active
}
