// Adaptive dashboard engine (PURE, deterministic, dependency-free).
//
// Given a live TelemetrySnapshot (and/or an explicit session phase) this returns
// an "emphasis plan": which dashboard concepts to EMPHASIZE, SHOW or HIDE. The
// rules are 100% deterministic — no LLM — so the same input always yields the
// same plan. The Dashboard AI view consumes the plan to re-rank/clean up a live
// layout ("adaptive mode"), and the builder can seed phase-appropriate widgets.
//
// React/Electron/node-free: importable by main, renderer and unit tests.

import { DEFAULT_ALERTS_CONFIG } from './alerts'
import {
  fuelLapsRemainingOf,
  isQualifyingLikeSessionKind,
  sessionKindForSnapshot,
  type TelemetrySnapshot
} from './telemetry'
import type { DashboardElement, DashboardElementType } from './dashboards'
import type { AdaptiveBlink, AdaptiveElementRule, AdaptiveMomentFrame, DashboardAdaptiveConfig } from './dashboards'
import { createElementId } from './dashboards'
import { DASHBOARD_CONCEPT_LIST, conceptForElement, type DashboardConcept } from './dashboard-nl'
import {
  raceMomentPreset,
  type RaceMoment,
  type RaceMomentColor,
  type RaceMomentState,
  type SalientStyleFamily
} from './race-moment'
import { isLiveTelemetrySnapshot } from './replay'

// Session "phase" the dashboard adapts to. This combines session KIND (practice/
// qualifying/race) with lifecycle state (formation lap, in the pits).
export type AdaptivePhase = 'practice' | 'qualifying' | 'race' | 'pit' | 'formation' | 'warmup' | 'unknown'

export type Emphasis = 'emphasize' | 'show' | 'hide'

export interface AdaptivePlan {
  phase: AdaptivePhase
  /** Emphasis decision for every known concept. */
  byConcept: Record<DashboardConcept, Emphasis>
  emphasize: DashboardConcept[]
  show: DashboardConcept[]
  hide: DashboardConcept[]
  /** Short human-readable explanation (PT-BR) for the UI. */
  reason: string
  /**
   * OPTIONAL micro "race moment" layer (see race-moment.ts). Additive: existing
   * consumers ignore it; the applier uses it for promote/demote/recolor/tween.
   * Attach it with `withRaceMoment(plan, state)`.
   */
  momentLayer?: MomentLayer
}

// ─── Micro "race moment" layer ───────────────────────────────────────────────

export type MomentAction = 'promote' | 'demote' | 'normal'

/** The resolved micro layer the renderer applies on top of the macro plan. */
export interface MomentLayer {
  moment: RaceMoment
  color: RaceMomentColor
  label: string
  promote: DashboardConcept[]
  demote: DashboardConcept[]
  heroStyleFamily?: SalientStyleFamily
  /** Micro action per concept (promote/demote/normal). */
  byConcept: Record<DashboardConcept, MomentAction>
}

/** What the applier resolves for a single element from the moment layer. */
export interface MomentApply {
  action: MomentAction
  color: RaceMomentColor
  /** Visual scale multiplier for the renderer (CSS transform, NOT a relayout). */
  scale: number
  /** Opacity multiplier — demoted widgets dim, never disappear. */
  opacity: number
  /** Optional higher-salience style hint for a hero widget. */
  heroStyleFamily?: SalientStyleFamily
}

const MOMENT_PROMOTE_SCALE = 1.12
const MOMENT_DEMOTE_SCALE = 0.92
const MOMENT_DEMOTE_OPACITY = 0.5
/** Anti-flicker: never promote more than this many widgets at once. */
const MAX_PROMOTED_ELEMENTS = 3

/** Build a `MomentLayer` from a resolved `RaceMomentState` (or null → none). */
export function momentLayerFor(state: RaceMomentState | null | undefined): MomentLayer | null {
  if (!state) return null
  const preset = raceMomentPreset(state.moment)
  const promote = preset.promote.slice(0, 3)
  const demote = preset.demote
  const byConcept = {} as Record<DashboardConcept, MomentAction>
  for (const concept of DASHBOARD_CONCEPT_LIST) {
    if (promote.includes(concept)) byConcept[concept] = 'promote'
    else if (demote.includes(concept)) byConcept[concept] = 'demote'
    else byConcept[concept] = 'normal'
  }
  return {
    moment: state.moment,
    color: state.color,
    label: preset.label,
    promote,
    demote,
    heroStyleFamily: preset.heroStyleFamily,
    byConcept
  }
}

/** Return a NEW plan with the micro moment layer attached (input untouched). */
export function withRaceMoment(plan: AdaptivePlan, state: RaceMomentState | null | undefined): AdaptivePlan {
  const layer = momentLayerFor(state)
  if (!layer) return plan
  return { ...plan, momentLayer: layer }
}

// ─── Phase detection ─────────────────────────────────────────────────────────

function isPositiveNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

/**
 * Derive the adaptive phase from a snapshot. Being on pit road / in the stall /
 * with the limiter on always wins (you want pit + tyre info regardless of the
 * session). A race session whose lap counter has not started yet is treated as a
 * formation/parade lap.
 */
export function resolveAdaptivePhase(snapshot: TelemetrySnapshot | null | undefined): AdaptivePhase {
  if (!isLiveTelemetrySnapshot(snapshot)) return 'unknown'
  if (snapshot.onPitRoad === true || snapshot.pit?.inPitStall === true || snapshot.pitLimiter === true) return 'pit'
  const kind = sessionKindForSnapshot(snapshot)
  if (kind === 'race') {
    const notStarted = !isPositiveNum(snapshot.currentLap)
    if (notStarted && snapshot.flags?.checkered !== true) return 'formation'
    return 'race'
  }
  if (isQualifyingLikeSessionKind(kind)) return 'qualifying'
  if (kind === 'warmup') return 'warmup'
  if (kind === 'practice') return 'practice'
  return 'unknown'
}

// ─── Per-phase rules ─────────────────────────────────────────────────────────
// For each phase we declare which concepts to EMPHASIZE and which to HIDE.
// Everything not listed defaults to SHOW (neutral). 'unknown' shows everything.

interface PhaseRule {
  emphasize: DashboardConcept[]
  hide: DashboardConcept[]
}

const PHASE_RULES: Record<AdaptivePhase, PhaseRule> = {
  practice: {
    emphasize: ['tyres', 'enginetemps', 'delta', 'laptime'],
    hide: ['position', 'gaps', 'relatives', 'standings', 'radar', 'incidents', 'flags', 'pit']
  },
  qualifying: {
    emphasize: ['delta', 'laptime'],
    hide: ['fuel', 'position', 'gaps', 'relatives', 'standings', 'radar', 'incidents', 'pit', 'enginetemps', 'assists']
  },
  race: {
    emphasize: ['position', 'gaps', 'fuel'],
    hide: ['inputs', 'steering', 'gforce', 'enginetemps', 'assists']
  },
  pit: {
    emphasize: ['pit', 'tyres', 'fuel'],
    hide: ['delta', 'laptime', 'shift', 'inputs', 'steering', 'gforce', 'radar', 'gaps', 'relatives', 'trackmap', 'rpm']
  },
  formation: {
    emphasize: ['position', 'flags', 'tyres'],
    hide: ['delta', 'laptime', 'shift', 'inputs', 'steering', 'gforce']
  },
  warmup: {
    emphasize: ['tyres', 'fuel', 'delta'],
    hide: ['radar', 'incidents', 'steering', 'gforce']
  },
  unknown: {
    emphasize: [],
    hide: []
  }
}

const PHASE_LABEL: Record<AdaptivePhase, string> = {
  practice: 'Practice',
  qualifying: 'Qualifying',
  race: 'Race',
  pit: 'Pit / box',
  formation: 'Formation lap',
  warmup: 'Warmup',
  unknown: 'Unknown session'
}

const PHASE_FOCUS: Record<AdaptivePhase, string> = {
  practice: 'tires, temperatures, and delta to dial in the car',
  qualifying: 'delta and lap time for the hot lap',
  race: 'position, gaps, and fuel',
  pit: 'pit status, tires, and fuel',
  formation: 'position, flags, and tire warmup',
  warmup: 'tires, fuel, and delta',
  unknown: 'overview (all widgets)'
}

// ─── Snapshot-driven overrides ───────────────────────────────────────────────

function anyFlagActive(snapshot: TelemetrySnapshot): boolean {
  const f = snapshot.flags
  if (!f) return false
  return Boolean(f.yellow || f.red || f.blue || f.black || f.meatball || f.checkered || f.greenWhiteCheckered)
}

function isWet(snapshot: TelemetrySnapshot): boolean {
  if (snapshot.isRaining === true || snapshot.weatherDeclaredWet === true) return true
  return isPositiveNum(snapshot.trackWetnessPct) && (snapshot.trackWetnessPct ?? 0) > 0.1
}

function fuelIsLow(snapshot: TelemetrySnapshot, threshold: number): boolean {
  const lapsLeft = fuelLapsRemainingOf(snapshot)
  return lapsLeft !== undefined && lapsLeft < threshold
}

// ─── Plan builder ────────────────────────────────────────────────────────────

export interface PlanOptions {
  /** Force a phase instead of deriving it from the snapshot. */
  phase?: AdaptivePhase
  /** Apply live snapshot overrides (flags/rain/low-fuel). Default true. */
  dynamic?: boolean
  /** Alert policy threshold for the low-fuel emphasis override. */
  lowFuelLapsThreshold?: number
}

/**
 * Build the deterministic emphasis plan for the snapshot/phase. Live overrides
 * (flags raised, rain, low fuel) promote the relevant concept to EMPHASIZE.
 */
export function planAdaptiveDashboard(snapshot: TelemetrySnapshot | null | undefined, opts: PlanOptions = {}): AdaptivePlan {
  const liveSnapshot = isLiveTelemetrySnapshot(snapshot) ? snapshot : null
  const phase = opts.phase ?? resolveAdaptivePhase(liveSnapshot)
  const rule = PHASE_RULES[phase]
  const emphasize = new Set<DashboardConcept>(rule.emphasize)
  const hide = new Set<DashboardConcept>(rule.hide)

  const extras: string[] = []
  if ((opts.dynamic ?? true) && liveSnapshot) {
    if (anyFlagActive(liveSnapshot)) {
      emphasize.add('flags')
      hide.delete('flags')
      extras.push('active flag')
    }
    if (isWet(liveSnapshot)) {
      emphasize.add('weather')
      hide.delete('weather')
      extras.push('wet track')
    }
    if (
      fuelIsLow(
        liveSnapshot,
        opts.lowFuelLapsThreshold ?? DEFAULT_ALERTS_CONFIG.lowFuel.lapsThreshold
      )
    ) {
      emphasize.add('fuel')
      hide.delete('fuel')
      extras.push('low fuel')
    }
  }

  // A concept can't be both emphasized and hidden — emphasize wins.
  for (const c of emphasize) hide.delete(c)

  const byConcept = {} as Record<DashboardConcept, Emphasis>
  const emphasizeList: DashboardConcept[] = []
  const showList: DashboardConcept[] = []
  const hideList: DashboardConcept[] = []
  for (const concept of DASHBOARD_CONCEPT_LIST) {
    let e: Emphasis = 'show'
    if (emphasize.has(concept)) e = 'emphasize'
    else if (hide.has(concept)) e = 'hide'
    byConcept[concept] = e
    if (e === 'emphasize') emphasizeList.push(concept)
    else if (e === 'hide') hideList.push(concept)
    else showList.push(concept)
  }

  const base = `${PHASE_LABEL[phase]}: foco em ${PHASE_FOCUS[phase]}.`
  const reason = extras.length > 0 ? `${base} Ajustes ao vivo: ${extras.join(', ')}.` : base

  return { phase, byConcept, emphasize: emphasizeList, show: showList, hide: hideList, reason }
}

// ─── Applying a plan to a concrete layout ────────────────────────────────────

const EMPHASIS_Z_BOOST = 1000

export interface ApplyOptions {
  /** Hide elements whose concept is HIDDEN (sets visible=false). Default true. */
  applyHide?: boolean
  /** Raise zIndex of EMPHASIZED elements so they sit on top. Default true. */
  applyEmphasis?: boolean
}

export interface EmphasizedElement {
  element: DashboardElement
  concept: DashboardConcept | undefined
  emphasis: Emphasis
  /** Micro moment decision for this element (present iff plan.momentLayer set). */
  moment?: MomentApply
}

/**
 * Re-rank a live element list per the plan. Pure: returns NEW elements; the
 * input is never mutated. Emphasized elements get a zIndex boost; hidden ones
 * get visible=false. Elements whose concept can't be inferred are left as-is.
 *
 * When `plan.momentLayer` is set, each element ALSO gets a `moment` decision
 * (promote/demote/normal + colour + scale + opacity). Positions (x/y/w/h) are
 * NEVER touched — promotion is a CSS transform/scale the renderer tweens — so a
 * mid-lap moment switch can never relayout the board.
 */
export function applyAdaptivePlan(elements: readonly DashboardElement[], plan: AdaptivePlan, opts: ApplyOptions = {}): EmphasizedElement[] {
  const applyHide = opts.applyHide ?? true
  const applyEmphasis = opts.applyEmphasis ?? true
  const layer = plan.momentLayer
  let promotedCount = 0
  return elements.map((el) => {
    const concept = conceptForElement(el)
    const emphasis: Emphasis = concept ? plan.byConcept[concept] ?? 'show' : 'show'
    let element = el
    if (emphasis === 'hide' && applyHide) {
      element = { ...el, visible: false }
    } else if (emphasis === 'emphasize' && applyEmphasis) {
      element = { ...el, visible: el.visible === false ? false : true, style: { ...el.style, zIndex: (el.style.zIndex ?? 0) + EMPHASIS_Z_BOOST } }
    }

    let moment: MomentApply | undefined
    if (layer) {
      let action: MomentAction = concept ? layer.byConcept[concept] ?? 'normal' : 'normal'
      // Cap the number of promoted widgets to avoid a busy, flickery board.
      if (action === 'promote') {
        if (promotedCount < MAX_PROMOTED_ELEMENTS && element.visible !== false) promotedCount += 1
        else action = 'normal'
      }
      moment = {
        action,
        color: layer.color,
        scale: action === 'promote' ? MOMENT_PROMOTE_SCALE : action === 'demote' ? MOMENT_DEMOTE_SCALE : 1,
        opacity: action === 'demote' ? MOMENT_DEMOTE_OPACITY : 1,
        heroStyleFamily: action === 'promote' ? layer.heroStyleFamily : undefined
      }
    }
    return { element, concept, emphasis, moment }
  })
}

/** Convenience: the concepts a phase wants to emphasize, ready to seed a build. */
export function emphasizedConceptsForPhase(phase: AdaptivePhase): DashboardConcept[] {
  return [...PHASE_RULES[phase].emphasize]
}

// ─── USER adaptive rules (per-moment show/hide + emphasis + blink) ────────────
//
// The built-in plan above is the deterministic baseline. On TOP of it the user
// can attach `DashboardAdaptiveConfig` rules (owned by the editor) that target
// concrete elements BY ID for each race-moment / session-phase id. When the
// dashboard has `adaptive.enabled`, DashboardRoot applies every rule whose moment
// is currently active (see `detectActiveMoments` in race-moment.ts).
//
// PRECEDENCE: rules are processed in `config.rules` ARRAY ORDER. When several
// active rules touch the SAME element field (visible / emphasis / blink) or the
// whole-dashboard blink, the LATER rule in the array wins. So put your highest
// priority rule LAST. This is independent of which moments happen to be active,
// keeping the result deterministic.

/** The user's resolved decision for ONE element (merged across active rules). */
export interface UserElementApply {
  /** Explicit visibility override; undefined = defer to the built-in plan. */
  visible?: boolean
  /** Emphasis multiplier: >1 scales up + raises z; undefined = none. */
  emphasis?: number
  /** Blink directive for this element. */
  blink?: AdaptiveBlink
}

function mergeUserElementRule(prev: UserElementApply, er: AdaptiveElementRule): UserElementApply {
  return {
    visible: er.visible !== undefined ? er.visible : prev.visible,
    emphasis: er.emphasis !== undefined ? er.emphasis : prev.emphasis,
    blink: er.blink !== undefined ? er.blink : prev.blink
  }
}

/**
 * Merge the user's per-element rules for every ACTIVE moment, honouring array
 * order (later active rule wins per field). Returns a map elementId → apply for
 * only the elements that at least one active rule targets.
 */
export function resolveUserElementRules(
  config: DashboardAdaptiveConfig | null | undefined,
  activeMoments: ReadonlySet<string>
): Map<string, UserElementApply> {
  const out = new Map<string, UserElementApply>()
  if (!config?.enabled || !config.rules) return out
  for (const rule of config.rules) {
    if (rule.enabled === false) continue
    if (!activeMoments.has(rule.moment)) continue
    if (!rule.elements) continue
    for (const [elementId, er] of Object.entries(rule.elements)) {
      out.set(elementId, mergeUserElementRule(out.get(elementId) ?? {}, er))
    }
  }
  return out
}

/**
 * The winning whole-dashboard blink across the active rules (later active rule
 * with a `blinkDashboard` wins). Undefined when none applies.
 */
export function resolveDashboardBlink(
  config: DashboardAdaptiveConfig | null | undefined,
  activeMoments: ReadonlySet<string>
): AdaptiveBlink | undefined {
  if (!config?.enabled || !config.rules) return undefined
  let winner: AdaptiveBlink | undefined
  for (const rule of config.rules) {
    if (rule.enabled === false) continue
    if (!activeMoments.has(rule.moment)) continue
    if (rule.blinkDashboard) winner = rule.blinkDashboard
  }
  return winner
}

/**
 * The winning per-moment FRAME across the active rules (later active rule with a
 * `frame` wins — same array-order precedence as element rules / dashboard blink).
 * Undefined when no active rule carries a frame → callers fall back to the base
 * dashboard layout (back-compat). A frame must have a non-empty `elements` list
 * to win; an empty frame is ignored so a half-authored frame never blanks out
 * the board.
 */
export function resolveActiveFrame(
  config: DashboardAdaptiveConfig | null | undefined,
  activeMoments: ReadonlySet<string>
): AdaptiveMomentFrame | undefined {
  if (!config?.enabled || !config.rules) return undefined
  let winner: AdaptiveMomentFrame | undefined
  for (const rule of config.rules) {
    if (rule.enabled === false) continue
    if (!activeMoments.has(rule.moment)) continue
    if (rule.frame && rule.frame.elements.length > 0) winner = rule.frame
  }
  return winner
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Sanitize/clamp/assign-id the elements of a per-moment FRAME before render.
 *
 * `frame.elements` come straight from `dashboard.adaptive.rules[].frame` and —
 * unlike the base `dashboard.elements` — are NEVER processed by the main-process
 * `normalizeDashboard`. A hand-edited or imported config could carry a malformed
 * frame element (missing/non-string `type`, NaN/negative geometry, missing id);
 * this drops those and clamps the survivors so a bad frame can never crash or
 * corrupt the runtime. Unknown (but well-formed) widget types are KEPT — the
 * renderer already falls back gracefully for types it doesn't recognise, so we
 * avoid maintaining a drift-prone allow-list here. Pure: input never mutated.
 */
export function sanitizeFrameElements(elements: readonly DashboardElement[]): DashboardElement[] {
  const out: DashboardElement[] = []
  for (const raw of elements) {
    if (!raw || typeof raw !== 'object') continue
    const candidate = raw as Partial<DashboardElement>
    if (typeof candidate.type !== 'string' || !candidate.type) continue
    if (!isFiniteNumber(candidate.x) || !isFiniteNumber(candidate.y)) continue
    if (!isFiniteNumber(candidate.w) || !isFiniteNumber(candidate.h)) continue
    if (candidate.w <= 0 || candidate.h <= 0) continue
    out.push({
      ...candidate,
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : createElementId(),
      type: candidate.type as DashboardElementType,
      x: Math.max(0, Math.round(candidate.x)),
      y: Math.max(0, Math.round(candidate.y)),
      w: Math.max(1, Math.round(candidate.w)),
      h: Math.max(1, Math.round(candidate.h)),
      style: candidate.style && typeof candidate.style === 'object' ? candidate.style : {}
    } as DashboardElement)
  }
  return out
}

/** A fully-resolved element ready for the adaptive renderer. */
export interface AdaptiveRuntimeElement {
  /** Element with `visible` synced to the FINAL decision (built-in + user). */
  element: DashboardElement
  emphasis: Emphasis
  /** Micro moment decision (present iff plan.momentLayer set). */
  moment?: MomentApply
  /** Merged user decision for this element (present iff a rule targets it). */
  user?: UserElementApply
  /** Final visibility decision (false → renderer should skip it). */
  hidden: boolean
}

export interface AdaptiveRuntimeResult {
  elements: AdaptiveRuntimeElement[]
  /** Whole-dashboard blink to apply this tick (undefined → none). */
  dashboardBlink?: AdaptiveBlink
  /** True when a per-moment FRAME is driving the element list (full swap). */
  frameActive: boolean
  /** Background override from the active frame (undefined → keep dashboard bg). */
  frameBg?: string
}

/**
 * One-stop resolver for the adaptive renderer.
 *
 * 1. PER-MOMENT FRAME (full layout swap): if an active moment's rule carries a
 *    `frame`, that frame's element list REPLACES `baseElements` (the highest-
 *    precedence/last active frame wins, mirroring the element/blink array-order
 *    rule). Frame elements are sanitized (id/type/geometry) first; if they all
 *    drop out the base layout is used. With no active frame the base dashboard
 *    layout is used (back-compat).
 * 2. Apply the built-in deterministic plan to whichever element list is in play.
 *    When a frame is AUTHORITATIVE the plan's HIDE pass is suppressed
 *    (`applyHide:false`) so the phase plan can never blank out widgets the user
 *    deliberately placed in that frame — the authored layout wins. Emphasis,
 *    user per-element rules and blink still apply on top.
 * 3. Layer the USER per-element rules for the active moments on top (visibility,
 *    emphasis multipliers, blink), and pick the winning whole-dashboard blink.
 *
 * Pure: input elements/frames are never mutated. Positions are NEVER touched —
 * only visibility / emphasis / blink change — EXCEPT that a frame swaps the whole
 * element list (an intentional, authored layout change for that single moment).
 */
export function resolveAdaptiveRuntime(
  baseElements: readonly DashboardElement[],
  plan: AdaptivePlan,
  config: DashboardAdaptiveConfig | null | undefined,
  activeMoments: ReadonlySet<string>,
  opts: ApplyOptions = {}
): AdaptiveRuntimeResult {
  const frame = resolveActiveFrame(config, activeMoments)
  const frameElements = frame ? sanitizeFrameElements(frame.elements) : null
  const frameActive = frameElements !== null && frameElements.length > 0
  const elements = frameActive ? frameElements : baseElements
  // A frame is AUTHORITATIVE: never let the deterministic phase plan hide the
  // widgets the user authored for this moment.
  const planOpts: ApplyOptions = frameActive ? { ...opts, applyHide: false } : opts
  const base = applyAdaptivePlan(elements, plan, planOpts)
  const userMap = resolveUserElementRules(config, activeMoments)
  const out: AdaptiveRuntimeElement[] = base.map((b) => {
    const user = userMap.get(b.element.id)
    let hidden = b.element.visible === false
    if (user?.visible === true) hidden = false
    else if (user?.visible === false) hidden = true
    // Keep `element.visible` consistent with the final decision so the shared
    // ElementSwitcher (which skips visible===false) honours a forced show/hide.
    const element = b.element.visible === false && !hidden ? { ...b.element, visible: true } : b.element
    return { element, emphasis: b.emphasis, moment: b.moment, user, hidden }
  })
  return {
    elements: out,
    dashboardBlink: resolveDashboardBlink(config, activeMoments),
    frameActive,
    frameBg: frameActive ? frame?.bg : undefined
  }
}
