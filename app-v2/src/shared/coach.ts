import type { CarLeftRightState, Corners, PaceMode, SessionState, TelemetrySnapshot, TyreInfo } from './telemetry'
import type { DriverIntentRegistry, IntentCategory, IntentId } from './driver-intent'
import type { CoachBaseline } from './coach-baseline'
import { applyIntentGate } from './coach-intent-gate'
import type { SpeechLanguage } from './tts-voice'
import { formatMeasurement, type UnitSystem } from './units'

export type CoachSeverity = 'high' | 'med' | 'low' | 'good'

export type CoachIssueKind =
  | 'braking'
  | 'throttle'
  | 'coast'
  | 'steering'
  | 'abs'
  | 'tc'
  | 'consistency'
  | 'optimal'

export interface CoachTip {
  id: string
  kind: CoachIssueKind
  sector?: number
  /**
   * 1-based CORNER number (Turn N) from the track's corner map, when the Live
   * Coach has learned one. Preferred over `sector` for the spoken locator so the
   * driver hears "Turn 3" rather than "Sector 2". Undefined when running in the
   * sector-only fallback (no corner map yet).
   */
  corner?: number
  severity: CoachSeverity
  message: string
  estTimeLossSec?: number
  evidence?: string
  createdAt: number
  /**
   * Terse PT-BR imperative correction — ONLY what to do better, e.g.
   * "brake earlier", "turn in earlier", "acelere antes". This is what the Live Coach
   * SPEAKS (see `coachSpeakText`); the descriptive `message` stays on-screen.
   * Carried from the live analyzer, which knows the direction (late vs early)
   * of each mistake. When absent, `coachActionPhrase` derives a coarse fallback
   * from `kind`.
   */
  action?: string
}

export interface CoachSettings {
  speakTopTip: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Persisted coach config (mirrors the Voice Spotter config lifecycle in
// src/shared/spotter.ts + src/main/modules/spotter.ts). A single JSON file in
// userData survives reloads/navigation so the user's choices stick:
//   • `enabled`      — the Live Coach ENGINE auto-runs whenever telemetry is live.
//     ON by default so a fresh install coaches/speaks without the user clicking
//     "Iniciar". The user can turn it off (the "Iniciar/Parar" button toggles it).
//   • `speakTopTip`  — Live Coach speaks the worst live tip out loud. ON by
//     default so the user hears coaching without flipping a switch first.
//   • `phraseWithAi` — the Coach view's "Frasear com IA" checkbox (local LLM
//     phrasing of findings). Previously local-only React state that reset on
//     navigation; now persisted here.
// ─────────────────────────────────────────────────────────────────────────────
export interface CoachConfig {
  version: 1
  enabled: boolean
  speakTopTip: boolean
  phraseWithAi: boolean
  updatedAt: number
}

export const DEFAULT_COACH_CONFIG: CoachConfig = {
  version: 1,
  enabled: true,
  speakTopTip: true,
  phraseWithAi: false,
  updatedAt: 0
}

export type CoachConfigPatch = {
  version?: 1
  enabled?: boolean
  speakTopTip?: boolean
  phraseWithAi?: boolean
  updatedAt?: number
}

/** Sanitize + layer a patch onto a base coach config (drops unknown/garbage fields). */
export function mergeCoachConfig(base: CoachConfig, patch: CoachConfigPatch): CoachConfig {
  return {
    version: 1,
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : base.enabled,
    speakTopTip: typeof patch.speakTopTip === 'boolean' ? patch.speakTopTip : base.speakTopTip,
    phraseWithAi: typeof patch.phraseWithAi === 'boolean' ? patch.phraseWithAi : base.phraseWithAi,
    updatedAt: Date.now()
  }
}

/**
 * Payload of `coach:speak` (COACH_CHANNELS.speak) — a self-initiated Live Coach
 * radio call. Emitted by the main coach engine when `speakTopTip` is on; consumed
 * GLOBALLY in App.tsx → speakViaTts so it is spoken on ANY screen (mirrors the AI
 * Engineer's `engineer:proactive`). `lang` is the language used to compose the
 * line and drives the matching TTS voice/fallback.
 */
export interface CoachSpeakEvent {
  /** The line to speak. */
  text: string
  /** 1..10 priority (high-severity tips speak louder/sooner). */
  priority: number
  /** Source tip id, for renderer de-duplication. */
  tipId: string
  /** Language the text was composed in (drives the spoken voice). */
  lang: 'pt-BR' | 'en-US'
  /** Which subsystem produced this call-out (for the TTS/observability log). */
  source: 'coach'
  /** 1-based corner number this call-out is about, when corner-scoped. */
  corner?: number
}

export interface CoachStatus {
  running: boolean
  startedAt?: number
  sampleCount: number
  lastUpdatedAt?: number
  settings: CoachSettings
}

export interface CoachTipsPayload {
  status: CoachStatus
  tips: CoachTip[]
}

export const COACH_CHANNELS = {
  start: 'coach:start',
  stop: 'coach:stop',
  tips: 'coach:tips',
  updated: 'coach:updated',
  // Main → Renderer: a spoken Live Coach call-out (consumed globally in App.tsx).
  speak: 'coach:speak',
  // Persisted coach config (speakTopTip + phraseWithAi). Mirrors SPOTTER_CHANNELS.
  getConfig: 'coach:getConfig',
  setConfig: 'coach:setConfig',
  configEvent: 'coach:config',
  // ── F2 lap coach + setup advisor (on-demand, deterministic-first) ──
  getReport: 'coach:getReport',
  lastFindings: 'coach:lastFindings',
  explain: 'coach:explain',
  report: 'coach:report'
} as const

// ─────────────────────────────────────────────────────────────────────────────
// F2 — Lap coach analysis (PURE, deterministic, unit-tested).
//
// This block is the "brain" of the AI Coach: it turns a buffered lap of reduced
// telemetry frames into ranked, specific findings (braking too early/late, mid
// corner coasting, throttle hesitation, ABS/TC overuse, busy steering, biggest
// time-loss zones, inconsistency vs best). It is intentionally framework- and
// LLM-free so it runs CPU-cheap inside the telemetry path and is trivially
// testable. The local LLM (optional) only PHRASES a finding on demand — every
// finding already carries deterministic `title`/`detail`/`evidence` text.
// ─────────────────────────────────────────────────────────────────────────────

/** Corner/lap phase a sample belongs to. */
export type CoachPhase = 'entry' | 'mid' | 'exit'

/**
 * Per-sample CONTEXT frame — the racecraft / management / session / conditions
 * signals the intent classifier reads to tell a DELIBERATE line change from an
 * ERROR. Every field is optional so hand-built samples, legacy paths and providers
 * that omit a signal simply leave it undefined (→ no suppression). Populated by
 * `coachContextFromSnapshot`. See docs/coach-intent-research.md §5.
 */
export interface CoachContextSample {
  // ── Racecraft (other cars) ──
  /** Decided spotter side from the iRacing CarLeftRight flag. */
  carLeftRight?: CarLeftRightState
  /** Cars on the busy side (1 or 2), from CarLeftRight. */
  carsAlongsideCount?: number
  /** Absolute track-time gap to the car AHEAD (s). */
  gapAheadSec?: number
  /** Absolute track-time gap to the car BEHIND (s). */
  gapBehindSec?: number
  /** Closest radar contact distance (m) across all radar cars (iRacing approx). */
  radarClosestMeters?: number
  // ── Flags / session phase ──
  flagYellow?: boolean
  flagBlue?: boolean
  flagWhite?: boolean
  flagGreen?: boolean
  flagCheckered?: boolean
  /** Derived full-course caution / pace (yellow OR paceMode≠notPacing OR parade). */
  caution?: boolean
  sessionState?: SessionState
  paceMode?: PaceMode
  sessionType?: string
  onPitRoad?: boolean
  lapsRemaining?: number
  sessionTimeRemainingSec?: number
  // ── Management (fuel / tyres / brakes) ──
  fuelLevelPct?: number
  fuelPerLap?: number
  /** Max tyre wear across the four corners (%). */
  tyreWearMaxPct?: number
  /** Max tyre core temp across the four corners (°C). */
  tyreTempMaxC?: number
  /** Max brake temp across the four corners (°C). */
  brakeTempMaxC?: number
  // ── Track conditions ──
  trackWetnessPct?: number
  gripPct?: number
  isRaining?: boolean
}

/** A single buffered telemetry frame reduced to what the analyzer needs. */
export interface CoachLapSample {
  /** Epoch ms (monotonic enough for dt integration). */
  t: number
  /** 0..1 fraction of the lap. */
  lapDistPct: number
  speedKmh: number
  throttle: number // 0..1
  brake: number // 0..1
  clutch: number // 0..1
  steerAbsDeg: number
  latAbsG: number
  longAccelG: number
  gear: number
  rpm: number
  absActive: boolean
  tcActive: boolean
  /** Running delta to the driver's best lap, when the sim provides it. */
  deltaToBestSec?: number
  /**
   * Optional CONTEXT frame (racecraft / management / session / conditions). When
   * present, the intent classifier uses it to tell a deliberate line change from
   * an error. Undefined on hand-built samples and legacy paths (no suppression).
   */
  ctx?: CoachContextSample
}

/** A completed lap, ready for analysis. */
export interface CoachLapBuffer {
  lapNumber?: number
  lapTimeSec?: number
  bestLapTimeSec?: number
  sectorCount: number
  samples: CoachLapSample[]
}

/** What a single finding is about. */
export type CoachFindingKind =
  | 'brake-early'
  | 'brake-late'
  | 'throttle-early'
  | 'throttle-late'
  | 'steering-early'
  | 'steering-late'
  | 'trail-brake-lock'
  | 'coast'
  | 'throttle-hesitation'
  | 'abs-overuse'
  | 'tc-overuse'
  | 'steering-busy'
  | 'steering-insufficient'
  | 'inconsistency'
  | 'time-loss'
  // ── BIDIRECTIONAL positives (gains vs a reference lap) ──
  | 'min-speed-gain'
  | 'brake-gain'
  | 'throttle-gain'
  | 'good'

/**
 * The sign of a finding's time impact:
 *   • `loss` — the driver LOST time here (red on the heatmap).
 *   • `gain` — the driver GAINED time here vs the reference (blue on the heatmap).
 * `good`/clean findings carry no sign (neutral / green).
 */
export type CoachFindingSign = 'loss' | 'gain'

/** Set of kinds that represent a POSITIVE finding (something the driver did well). */
export const GAIN_FINDING_KINDS: ReadonlySet<CoachFindingKind> = new Set<CoachFindingKind>([
  'min-speed-gain',
  'brake-gain',
  'throttle-gain'
])

/** One specific, ranked piece of coaching. */
export interface CoachFinding {
  id: string
  kind: CoachFindingKind
  phase?: CoachPhase
  /** 1-based sector. */
  sector: number
  /**
   * 1-based CORNER number (Turn N) from the track's corner map, when one is
   * available. Undefined for sector-only findings (no corner map) and for the
   * lap-global `inconsistency` finding.
   */
  corner?: number
  /** Corner extent (0..1) the finding belongs to, mirrored from the corner map. */
  cornerPctStart?: number
  cornerPctEnd?: number
  /** Lap-distance window the finding covers (0..1). */
  zonePctStart: number
  zonePctEnd: number
  severity: CoachSeverity
  /** Estimated time lost to this issue, seconds (>0). `good`/`gain` findings are 0. */
  estTimeLossSec: number
  /**
   * Signed time impact, seconds: NEGATIVE for a loss, POSITIVE for a gain, 0 for
   * a clean/`good` finding. This is the value the heatmap (WS-M) colours by.
   * Always set by `makeFinding`; optional only so legacy literals stay valid.
   */
  estTimeDeltaSec?: number
  /** `loss` | `gain`; undefined for neutral `good` findings. */
  sign?: CoachFindingSign
  /** Short deterministic headline (PT-BR). */
  title: string
  /** Deterministic advice (PT-BR). */
  detail: string
  /**
   * Plain PT-BR explanation of WHY (for a loss: what went wrong + how to fix; for
   * a gain: what the driver did well so they can REPLICATE it). Defaults to
   * `detail` when not set explicitly. Always set by `makeFinding`; optional only
   * so legacy literals stay valid.
   */
  explanation?: string
  /** Measured numbers backing the finding (PT-BR). */
  evidence: string
  /** Raw metrics so the optional LLM can phrase without re-deriving anything. */
  metrics: Record<string, number>
  /**
   * Intent-classifier confidence (0..1) that this finding is a REAL error. Set by
   * the intent gate (see coach-intent-gate.ts). Below the UI sensitivity threshold
   * → silenced. Undefined on legacy paths that never ran the gate.
   */
  confidence?: number
  /**
   * When a legitimate DRIVER intent explains this event, its id (e.g. 'attack',
   * 'lift-and-coast', 'yellow-flag'). Present on findings demoted to CONTEXT.
   */
  intent?: IntentId
  /** Category of the recognized intent (racecraft / management / conditions). */
  intentCategory?: IntentCategory
  /** Human-readable evidence lines the classifier used (for the tip + LLM phrasing). */
  intentEvidence?: string[]
  /**
   * True when this is NOT an error but neutral CONTEXT — a deliberate choice the
   * classifier recognized (e.g. "defensive line, car on the right"). Context items
   * are never ranked or spoken as mistakes.
   */
  context?: boolean
}

// ─── Spoken corrective phrases (terse, improvement-only imperatives) ──────────
// The Live Coach SPEAKS only a short PT-BR correction — what to do better, NOT a
// description of the mistake or the estimated time loss. These maps are the
// single source of truth so the spoken call-out stays consistent with what the
// live analyzer detected, and are pure/unit-testable.

/**
 * Terse PT-BR imperative correction for a DIRECTIONAL finding kind. The live
 * analyzer tags each tip with the matching `action` derived from one of these,
 * so "braked late" → "brake earlier" rather than a vague "freada".
 */
export function coachActionForFindingKind(kind: CoachFindingKind): string {
  switch (kind) {
    case 'brake-late':
      return 'brake earlier'
    case 'brake-early':
      return 'freie mais tarde'
    case 'throttle-late':
      return 'acelere antes'
    case 'throttle-early':
      return 'acelere mais tarde'
    case 'steering-late':
      return 'turn in earlier'
    case 'steering-early':
      return 'vire mais tarde'
    case 'trail-brake-lock':
      return 'release the brake as you turn'
    case 'coast':
      return 'do not coast — brake or accelerate'
    case 'throttle-hesitation':
      return 'commit to throttle'
    case 'abs-overuse':
      return 'release the brake'
    case 'tc-overuse':
      return 'smooth the throttle on exit'
    case 'steering-busy':
      return 'smooth the entry, one arc'
    case 'steering-insufficient':
      return 'more steering'
    case 'inconsistency':
      return 'repita os mesmos pontos de freada'
    case 'min-speed-gain':
    case 'brake-gain':
    case 'throttle-gain':
    case 'good':
      return 'hold the pace'
    case 'time-loss':
      return 'find more time here'
  }
}

/**
 * Coarse fallback when a live tip only carries the broad `CoachIssueKind`
 * without a stored directional `action`. Picks the safest terse imperative.
 */
export function coachActionForCoarseKind(kind: CoachIssueKind): string {
  switch (kind) {
    case 'braking':
      return 'brake earlier'
    case 'throttle':
      return 'acelere antes'
    case 'coast':
      return 'do not coast — brake or accelerate'
    case 'steering':
      return 'smooth the entry, one arc'
    case 'abs':
      return 'release the brake'
    case 'tc':
      return 'smooth the throttle on exit'
    case 'consistency':
      return 'repita os mesmos pontos de freada'
    case 'optimal':
      return 'hold the pace'
  }
}

/**
 * Resolve the terse spoken correction for a tip: its directional `action` when
 * the live analyzer supplied one, else a coarse fallback from `kind`.
 */
export function coachActionPhrase(tip: CoachTip): string {
  const action = tip.action?.trim()
  return action && action.length > 0 ? action : coachActionForCoarseKind(tip.kind)
}

/** Capitalize the first letter of a phrase (leaves the rest untouched). */
function capitalizeFirst(text: string): string {
  return text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text
}

/**
 * Build the TERSE Live Coach spoken call-out: a locator (the numbered CORNER when
 * the tip has one, else the timing SECTOR) + the imperative correction, e.g.
 * "Turn 3, brake earlier.", "Sector 3, brake earlier." or "Freie antes." when there is
 * no locator. `tip.corner` is a 1-based corner number (from the corner map);
 * `tip.sector` is a 1-based TIMING sector (matches the "Sector"/`S{n}` label in the
 * UI). Deliberately OMITS any "Live coach" prefix and the "Perda estimada …" suffix
 * — the driver should hear only what to do better.
 */
export function coachSpeakText(tip: CoachTip): string {
  const action = coachActionPhrase(tip)
  if (tip.corner !== undefined && Number.isFinite(tip.corner) && tip.sector !== undefined && Number.isFinite(tip.sector)) {
    return `Turn ${tip.corner} (Sector ${tip.sector}), ${action}.`
  }
  if (tip.corner !== undefined && Number.isFinite(tip.corner)) {
    return `Turn ${tip.corner}, ${action}.`
  }
  if (tip.sector !== undefined && Number.isFinite(tip.sector)) {
    return `Sector ${tip.sector}, ${action}.`
  }
  return `${capitalizeFirst(action)}.`
}

// ─── Per-corner COMPOSITE advice (multi-dimension spoken line) ────────────────
// The Live Coach speaks one short line PER CORNER that can combine several
// independent mistakes the driver made there, e.g. "Turn 3: brake earlier, vire
// antes, throttle later." To do that without repeating itself we group findings
// by the DRIVING DIMENSION they touch (brake point, turn-in timing, steering
// angle, throttle application, mid-corner rotation, stability), keep only the
// worst finding per dimension, and phrase each as a terse imperative.

/** The driving dimension a finding speaks to (so a corner line keeps one per dimension). */
export type CoachDimension = 'brake' | 'steering-timing' | 'steering-angle' | 'throttle' | 'rotation' | 'stability'

/** Map a finding kind to the driving dimension it belongs to (null = not coachable here). */
export function coachDimensionForKind(kind: CoachFindingKind): CoachDimension | null {
  switch (kind) {
    case 'brake-early':
    case 'brake-late':
    case 'trail-brake-lock':
    case 'abs-overuse':
      return 'brake'
    case 'steering-early':
    case 'steering-late':
      return 'steering-timing'
    case 'steering-busy':
    case 'steering-insufficient':
      return 'steering-angle'
    case 'throttle-early':
    case 'throttle-late':
    case 'throttle-hesitation':
    case 'tc-overuse':
      return 'throttle'
    case 'coast':
      return 'rotation'
    case 'inconsistency':
      return 'stability'
    case 'time-loss':
    case 'min-speed-gain':
    case 'brake-gain':
    case 'throttle-gain':
    case 'good':
      return null
  }
}

/**
 * Terse PT-BR correction for a COMPOSITE corner line — what to do better in two or
 * three words so several can be chained. Uses the antes/depois pairing the driver
 * asked for ("brake earlier", "vire depois", "throttle later") and the steering-angle
 * wording ("more steering", "steering mais suave"). Distinct from
 * `coachActionForFindingKind` (which the single-tip spoken path pins) so each path
 * can evolve independently.
 */
export function coachComposeAction(kind: CoachFindingKind, language: SpeechLanguage = 'pt-BR'): string {
  const pt = language === 'pt-BR'
  switch (kind) {
    case 'brake-late':
      return pt ? 'freie antes' : 'brake earlier'
    case 'brake-early':
      return pt ? 'freie mais tarde' : 'brake later'
    case 'trail-brake-lock':
      return pt ? 'solte o freio ao virar' : 'release the brake as you turn'
    case 'abs-overuse':
      return pt ? 'use menos freio' : 'release the brake'
    case 'steering-late':
      return pt ? 'vire antes' : 'turn in earlier'
    case 'steering-early':
      return pt ? 'vire depois' : 'turn in later'
    case 'steering-insufficient':
      return pt ? 'vire mais o volante' : 'more steering'
    case 'steering-busy':
      return pt ? 'faça menos correções no volante' : 'smooth the steering'
    case 'throttle-late':
      return pt ? 'acelere antes' : 'throttle earlier'
    case 'throttle-early':
      return pt ? 'acelere mais tarde' : 'throttle later'
    case 'throttle-hesitation':
      return pt ? 'confie no acelerador' : 'commit to throttle'
    case 'tc-overuse':
      return pt ? 'acelere mais suave na saída' : 'smooth the throttle on exit'
    case 'coast':
      return pt ? 'não deixe o carro rolar' : 'do not coast'
    case 'inconsistency':
      return pt ? 'repita os pontos de freada' : 'repeat the braking points'
    case 'time-loss':
      return pt ? 'ganhe mais tempo aqui' : 'find more time here'
    case 'min-speed-gain':
    case 'brake-gain':
    case 'throttle-gain':
    case 'good':
      return pt ? 'mantenha o ritmo' : 'hold the pace'
  }
}

function groundedDimensionPhrase(kind: CoachFindingKind): string {
  switch (kind) {
    case 'brake-late':
      return 'freando tarde'
    case 'brake-early':
      return 'freando cedo'
    case 'trail-brake-lock':
    case 'abs-overuse':
      return 'travando ou abusando do freio'
    case 'steering-late':
      return 'virando tarde'
    case 'steering-early':
      return 'virando cedo'
    case 'steering-insufficient':
      return 'virando pouco o volante'
    case 'steering-busy':
      return 'mexendo demais no volante'
    case 'throttle-late':
      return 'acelerando tarde'
    case 'throttle-early':
      return 'acelerando cedo'
    case 'throttle-hesitation':
      return 'hesitando no acelerador'
    case 'tc-overuse':
      return 'acionando muito o controle de tração'
    case 'coast':
      return 'ficando em coast'
    case 'inconsistency':
      return 'inconsistente'
    case 'time-loss':
      return 'perdendo tempo'
    case 'min-speed-gain':
    case 'brake-gain':
    case 'throttle-gain':
    case 'good':
      return 'bom ganho'
  }
}

function findingLocatorText(finding: CoachFinding): string {
  const hasCorner = finding.corner !== undefined && Number.isFinite(finding.corner)
  const hasSector = finding.sector !== undefined && Number.isFinite(finding.sector)
  if (hasCorner && hasSector) return `Turn ${finding.corner} (Setor ${finding.sector})`
  if (hasCorner) return `Turn ${finding.corner}`
  if (hasSector) return `Setor ${finding.sector}`
  return 'Trecho'
}

/** PURE: detailed, evidence-grounded PT-BR line for one gated finding. */
export function groundedFindingText(finding: CoachFinding): string {
  const locator = findingLocatorText(finding)
  const issue = finding.title?.trim() || groundedDimensionPhrase(finding.kind)
  const loss =
    Number.isFinite(finding.estTimeLossSec) && finding.estTimeLossSec > 0
      ? ` — perdeu ${finding.estTimeLossSec.toFixed(1)}s`
      : ''
  const evidence = finding.evidence?.trim()
  const evidenceText = evidence ? ` (${evidence})` : ''
  const discarded = (finding.intentEvidence ?? []).map((line) => line.trim()).filter((line) => line.length > 0)
  const discardedText = discarded.length > 0 ? ` (descartado: ${discarded.join('; ')})` : ''
  return `${locator}: ${issue}${loss}${evidenceText}${discardedText}.`
}

/** A composed, ready-to-speak per-corner (or per-sector) coaching line. */
export interface ComposedCornerAdvice {
  /** 1-based corner number when the advice is corner-scoped. */
  corner?: number
  /** 1-based sector for the advice when known. */
  sector?: number
  /** Ordered terse corrections, one per driving dimension, worst-first. */
  actions: string[]
  /** The finding kinds the actions came from (parallel to `actions`). */
  kinds: CoachFindingKind[]
  /** Worst single dimension's estimated time loss (drives severity). */
  worstLossSec: number
  /** Sum of the selected dimensions' estimated time loss. */
  totalLossSec: number
  severity: CoachSeverity
  /** Full spoken line, e.g. "Turn 3: brake earlier, turn in earlier, throttle later." */
  text: string
}

/**
 * PURE: combine the loss findings that share a corner (or sector) into ONE spoken
 * line that lists up to `maxDims` corrections — one per driving dimension, ranked by
 * the time each costs. Gains / `good` / zero-loss findings are ignored. Returns null
 * when there is nothing actionable. The `where` locator decides the prefix:
 * "Turn N: …" when a corner is given, "Sector N: …" for a sector, bare imperative
 * otherwise.
 */
export function composeCornerAdvice(
  findings: CoachFinding[],
  where: { corner?: number; sector?: number } = {},
  opts: { maxDims?: number; language?: 'pt-BR' | 'en-US' } = {}
): ComposedCornerAdvice | null {
  const maxDims = Math.max(1, Math.floor(opts.maxDims ?? 3))
  const language = opts.language ?? 'pt-BR'
  const pt = language === 'pt-BR'
  // Keep the worst finding per dimension (so we never say "brake earlier" twice).
  const worstPerDim = new Map<CoachDimension, CoachFinding>()
  for (const f of findings) {
    if (f.severity === 'good' || f.sign === 'gain') continue
    if (!(f.estTimeLossSec > 0)) continue
    const dim = coachDimensionForKind(f.kind)
    if (!dim) continue
    const prev = worstPerDim.get(dim)
    if (!prev || f.estTimeLossSec > prev.estTimeLossSec) worstPerDim.set(dim, f)
  }
  if (worstPerDim.size === 0) {
    // FALLBACK — the corner/sector has no specific actionable dimension (brake /
    // steering / throttle), but it STILL lost real time (kind 'time-loss', e.g. a low
    // apex min-speed). Speak the generic "find more time here" cue rather than going
    // silent (a v2.36.0 regression). This branch is only reached when NO specific
    // dimension exists, so it can never crowd out or duplicate "brake earlier" etc.
    const tl = findings
      .filter((f) => f.kind === 'time-loss' && f.sign !== 'gain' && f.estTimeLossSec > 0)
      .sort((a, b) => b.estTimeLossSec - a.estTimeLossSec)[0]
    if (!tl) return null
    const action = coachComposeAction(tl.kind, language)
    const worstLossSec = tl.estTimeLossSec
    const sector = where.sector !== undefined && Number.isFinite(where.sector) ? where.sector : tl.sector
    let text: string
    if (where.corner !== undefined && Number.isFinite(where.corner)) {
      text =
        sector !== undefined && Number.isFinite(sector)
          ? `${pt ? 'Curva' : 'Turn'} ${where.corner} (${pt ? 'Setor' : 'Sector'} ${sector}): ${action}.`
          : `${pt ? 'Curva' : 'Turn'} ${where.corner}: ${action}.`
    } else if (sector !== undefined && Number.isFinite(sector)) {
      text = `${pt ? 'Setor' : 'Sector'} ${sector}: ${action}.`
    } else {
      text = `${capitalizeFirst(action)}.`
    }
    return {
      corner: where.corner,
      sector,
      actions: [action],
      kinds: [tl.kind],
      worstLossSec,
      totalLossSec: worstLossSec,
      severity: severityForLoss(worstLossSec),
      text
    }
  }

  const ordered = Array.from(worstPerDim.values())
    .sort((a, b) => b.estTimeLossSec - a.estTimeLossSec)
    .slice(0, maxDims)

  const actions = ordered.map((f) => coachComposeAction(f.kind, language))
  const kinds = ordered.map((f) => f.kind)
  const worstLossSec = ordered[0].estTimeLossSec
  const totalLossSec = ordered.reduce((sum, f) => sum + f.estTimeLossSec, 0)
  const severity = severityForLoss(worstLossSec)
  const sector = where.sector !== undefined && Number.isFinite(where.sector) ? where.sector : ordered[0].sector

  const body = actions.join(', ')
  let text: string
  if (where.corner !== undefined && Number.isFinite(where.corner)) {
    text =
      sector !== undefined && Number.isFinite(sector)
        ? `${pt ? 'Curva' : 'Turn'} ${where.corner} (${pt ? 'Setor' : 'Sector'} ${sector}): ${body}.`
        : `${pt ? 'Curva' : 'Turn'} ${where.corner}: ${body}.`
  } else if (sector !== undefined && Number.isFinite(sector)) {
    text = `${pt ? 'Setor' : 'Sector'} ${sector}: ${body}.`
  } else {
    text = `${capitalizeFirst(body)}.`
  }

  return {
    corner: where.corner,
    sector,
    actions,
    kinds,
    worstLossSec,
    totalLossSec,
    severity,
    text
  }
}

// ─── Corner map contract (shared, framework-free) ────────────────────────────
// A minimal, structural view of a track's corner map that the PURE analyzer can
// consume without depending on the main-process corner-map module. The
// main-process `Corner` type (src/main/track-map/corner-map.ts) is structurally
// assignable to `CoachCornerRef`.

/** One numbered corner (Turn N) with its lap-distance extent. */
export interface CoachCornerRef {
  /** 1-based corner number. */
  index: number
  startPct: number
  apexPct: number
  endPct: number
}

/** A track's ordered list of numbered corners. */
export interface CoachCornerMap {
  corners: CoachCornerRef[]
}

/** The corner that owns `lapDistPct` (within its extent), or null on a straight. */
export function cornerOf(map: CoachCornerMap | null | undefined, lapDistPct: number): CoachCornerRef | null {
  if (!map || !Array.isArray(map.corners) || map.corners.length === 0) return null
  if (!Number.isFinite(lapDistPct)) return null
  const pct = Math.max(0, Math.min(0.999999, lapDistPct))
  for (const c of map.corners) {
    if (pct >= c.startPct && pct < c.endPct) return c
  }
  return null
}

/** Per-corner measured metrics for one lap — the comparison unit for gains/losses. */
export interface CoachCornerMetrics {
  /** 1-based corner number. */
  corner: number
  minSpeedKmh: number
  entrySpeedKmh: number
  /** Speed at the end of the numbered corner extent, when sampled. */
  exitSpeedKmh?: number
  /** lapDistPct where braking began inside the corner window (undefined if none). */
  brakeStartPct?: number
  /** lapDistPct where throttle was (re)applied on exit (undefined if none). */
  throttleStartPct?: number
  /** lapDistPct where the committed turn-in happened (undefined if none). */
  steerStartPct?: number
  /** Fraction of samples in the corner where TC was intervening (0..1). */
  tcActivePct?: number
}

/** A reference lap reduced to per-corner metrics (the driver's best, typically). */
export interface CoachReferenceLap {
  corners: CoachCornerMetrics[]
}

/** Per-sector roll-up shown above the findings list. */
export interface CoachSectorSummary {
  sector: number
  /** Measured time lost in the sector vs best (delta-derived; 0 when unknown). */
  timeLossSec: number
  minSpeedKmh: number
  /** Fraction of the sector spent on the brake / coasting / on throttle (0..1). */
  brakePct: number
  coastPct: number
  throttlePct: number
  absSec: number
  tcSec: number
  /** True when the sector is clean and not losing time (render it green). */
  benchmark: boolean
}

/** Lap-to-lap consistency rating. */
export interface CoachConsistency {
  laps: number
  meanLapSec: number
  stdevSec: number
  rating: 'tight' | 'ok' | 'loose'
}

/** Full deterministic coaching report for one completed lap. */
export interface CoachReport {
  generatedAt: number
  lapNumber?: number
  lapTimeSec?: number
  bestLapTimeSec?: number
  deltaToBestSec?: number
  sampleCount: number
  sectors: CoachSectorSummary[]
  /** Ranked worst-first; `good`/`gain` findings sink to the bottom. */
  findings: CoachFinding[]
  /**
   * The numbered corners (Turn 1..N) the findings were mapped against, when a
   * corner map was supplied. Empty when running sector-only. Consumed by the
   * track heatmap (WS-M) and the per-corner debrief (WS-I).
   */
  corners: CoachCornerRef[]
  /** Per-corner measured metrics for THIS lap (min speed, brake/throttle points). */
  cornerMetrics: CoachCornerMetrics[]
  consistency?: CoachConsistency
  /** One-line PT-BR headline. */
  summary: string
}

/** Tunable thresholds for the analyzer (exported so tests + module share one source). */
export interface CoachAnalysisConfig {
  sectorCount: number
  brakeOn: number
  throttleOn: number
  coastThrottle: number
  coastBrake: number
  minSpeedForCoastKmh: number
  coastLatG: number
  minCoastMs: number
  trailSteerDeg: number
  trailLatG: number
  trailAbsMs: number
  lateBrake: number
  lateAbsMs: number
  earlyCoastMs: number
  earlyMaxBrake: number
  earlyMinBrakeMs: number
  hesitationLoMs: number
  hesitationLatG: number
  absSectorMs: number
  tcSectorMs: number
  steerBusyScore: number
  /** Min accumulated under-rotation score before a `steering-insufficient` finding fires. */
  steerInsufficientScore: number
  timeLossBins: number
  minTimeLossSec: number
  goodLossSec: number
  // ── Corner-relative timing + bidirectional thresholds ──
  /** Steering (deg) considered a committed turn-in (for steering-early/late). */
  steerTurnInDeg: number
  /** Expected wheel angle (deg) per 1.0 G of lateral load — the under-rotation reference. */
  steerLoadDeg: number
  /** lapDistPct margin around the corner reference before timing is flagged. */
  cornerTimingMarginPct: number
  /** Min-speed delta (km/h) vs reference before a gain/loss is emitted. */
  minSpeedDeltaKmh: number
  /** Brake/throttle point delta (lapDistPct) vs reference before a gain is emitted. */
  cornerPointDeltaPct: number
  /** Rough seconds gained/lost per km/h of corner min-speed delta. */
  secPerKmhDelta: number
}

export const DEFAULT_COACH_ANALYSIS: CoachAnalysisConfig = {
  sectorCount: 3,
  brakeOn: 0.12,
  throttleOn: 0.2,
  coastThrottle: 0.08,
  coastBrake: 0.05,
  minSpeedForCoastKmh: 80,
  coastLatG: 0.45,
  minCoastMs: 350,
  trailSteerDeg: 16,
  trailLatG: 0.8,
  trailAbsMs: 250,
  lateBrake: 0.9,
  lateAbsMs: 450,
  earlyCoastMs: 600,
  earlyMaxBrake: 0.62,
  earlyMinBrakeMs: 700,
  hesitationLoMs: 600,
  hesitationLatG: 0.6,
  absSectorMs: 900,
  tcSectorMs: 900,
  steerBusyScore: 140,
  steerInsufficientScore: 90,
  timeLossBins: 6,
  minTimeLossSec: 0.05,
  goodLossSec: 0.03,
  steerTurnInDeg: 8,
  steerLoadDeg: 12,
  cornerTimingMarginPct: 0.02,
  minSpeedDeltaKmh: 3,
  cornerPointDeltaPct: 0.02,
  secPerKmhDelta: 0.012
}

/** Clamp to [0,1], treating non-finite as 0. */
function clamp01(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback
}

/** Severity for an estimated time loss (mirrors the live-tip thresholds). */
export function severityForLoss(lossSec: number, good = false): CoachSeverity {
  if (good) return 'good'
  if (lossSec >= 0.18) return 'high'
  if (lossSec >= 0.07) return 'med'
  return 'low'
}

/** 1-based sector index for a lap-distance fraction. */
export function sectorOf(lapDistPct: number, sectorCount: number): number {
  if (!Number.isFinite(lapDistPct)) return 1
  const pct = Math.max(0, Math.min(0.999999, lapDistPct))
  return Math.max(1, Math.min(sectorCount, Math.floor(pct * sectorCount) + 1))
}

/** Phase (entry/mid/exit) for a single sample. */
export function phaseForSample(sample: CoachLapSample, cfg: CoachAnalysisConfig = DEFAULT_COACH_ANALYSIS): CoachPhase {
  if (sample.brake > cfg.brakeOn) return 'entry'
  if (sample.throttle > cfg.throttleOn) return 'exit'
  return 'mid'
}

/** Reduce a raw telemetry snapshot into a coach sample (null when unusable). */
export function coachSampleFromSnapshot(snapshot: TelemetrySnapshot | null | undefined): CoachLapSample | null {
  if (!snapshot || snapshot.connected === false) return null
  if (snapshot.lapDistPct === undefined || !Number.isFinite(snapshot.lapDistPct)) return null
  if (!Number.isFinite(snapshot.speedKmh)) return null
  return {
    t: snapshot.timestamp || Date.now(),
    lapDistPct: clamp01(snapshot.lapDistPct),
    speedKmh: snapshot.speedKmh,
    throttle: clamp01(snapshot.throttle),
    brake: clamp01(snapshot.brake),
    clutch: clamp01(snapshot.clutch),
    steerAbsDeg: Math.abs(finiteOr(snapshot.steerAngleDeg, 0)),
    latAbsG: Math.abs(finiteOr(snapshot.latAccelG, 0)),
    longAccelG: finiteOr(snapshot.longAccelG, 0),
    gear: Math.trunc(finiteOr(snapshot.gear, 0)),
    rpm: finiteOr(snapshot.rpm, 0),
    absActive: snapshot.absActive === true,
    tcActive: snapshot.tcActive === true,
    deltaToBestSec: snapshot.deltaToBestSec !== undefined && Number.isFinite(snapshot.deltaToBestSec) ? snapshot.deltaToBestSec : undefined,
    ctx: coachContextFromSnapshot(snapshot)
  }
}

/** Max finite value across the four corners (undefined when none present). */
function maxOfCorners(c: Corners<number> | undefined): number | undefined {
  if (!c) return undefined
  const vals = [c.lf, c.rf, c.lr, c.rr].filter((v): v is number => Number.isFinite(v))
  return vals.length ? Math.max(...vals) : undefined
}

/** Max finite value of one TyreInfo field across the four corners. */
function maxTyreField(t: Corners<TyreInfo> | undefined, key: 'wearPct' | 'tempC'): number | undefined {
  if (!t) return undefined
  const vals = [t.lf, t.rf, t.lr, t.rr]
    .map((x) => (x ? x[key] : undefined))
    .filter((v): v is number => Number.isFinite(v))
  return vals.length ? Math.max(...vals) : undefined
}

/** Closest radar contact distance (m) across all radar cars (iRacing approx). */
function radarClosestMeters(cars: TelemetrySnapshot['radarCars']): number | undefined {
  if (!Array.isArray(cars) || cars.length === 0) return undefined
  let best: number | undefined
  for (const car of cars) {
    if (!Number.isFinite(car.relativeX) || !Number.isFinite(car.relativeY)) continue
    const d = Math.hypot(car.relativeX, car.relativeY)
    if (best === undefined || d < best) best = d
  }
  return best
}

/**
 * Build the per-sample CONTEXT frame from a raw snapshot: racecraft (cars around),
 * flags/session phase, management (fuel/tyres/brakes) and track conditions. Returns
 * undefined when nothing is populated so legacy/hand-built paths stay identical.
 * Pure + defensive (every read is guarded) so providers can omit any signal.
 */
export function coachContextFromSnapshot(snapshot: TelemetrySnapshot | null | undefined): CoachContextSample | undefined {
  if (!snapshot) return undefined
  const ctx: CoachContextSample = {}
  // ── Racecraft ──
  if (snapshot.carLeftRight !== undefined) ctx.carLeftRight = snapshot.carLeftRight
  if (Number.isFinite(snapshot.carLeftRightCount)) ctx.carsAlongsideCount = snapshot.carLeftRightCount
  const ahead = snapshot.relatives?.ahead?.gapSec
  if (Number.isFinite(ahead)) ctx.gapAheadSec = Math.abs(ahead as number)
  const behind = snapshot.relatives?.behind?.gapSec
  if (Number.isFinite(behind)) ctx.gapBehindSec = Math.abs(behind as number)
  const radar = radarClosestMeters(snapshot.radarCars)
  if (radar !== undefined) ctx.radarClosestMeters = radar
  // ── Flags / session ──
  if (snapshot.flags) {
    ctx.flagYellow = snapshot.flags.yellow === true
    ctx.flagBlue = snapshot.flags.blue === true
    ctx.flagWhite = snapshot.flags.white === true
    ctx.flagGreen = snapshot.flags.green === true
    ctx.flagCheckered = snapshot.flags.checkered === true
  }
  if (snapshot.sessionState !== undefined) ctx.sessionState = snapshot.sessionState
  if (snapshot.paceMode !== undefined) ctx.paceMode = snapshot.paceMode
  if (snapshot.flags !== undefined || snapshot.paceMode !== undefined || snapshot.sessionState !== undefined) {
    ctx.caution =
      snapshot.flags?.yellow === true ||
      (snapshot.paceMode !== undefined && snapshot.paceMode !== 'notPacing') ||
      snapshot.sessionState === 'paradeLaps'
  }
  if (snapshot.sessionType !== undefined) ctx.sessionType = snapshot.sessionType
  if (snapshot.onPitRoad !== undefined) ctx.onPitRoad = snapshot.onPitRoad === true
  if (Number.isFinite(snapshot.lapsRemaining)) ctx.lapsRemaining = snapshot.lapsRemaining
  if (Number.isFinite(snapshot.sessionTimeRemainingSec)) ctx.sessionTimeRemainingSec = snapshot.sessionTimeRemainingSec
  // ── Management ──
  if (Number.isFinite(snapshot.fuelLevelPct)) ctx.fuelLevelPct = snapshot.fuelLevelPct
  if (Number.isFinite(snapshot.fuelPerLap)) ctx.fuelPerLap = snapshot.fuelPerLap
  const wear = maxTyreField(snapshot.tyres, 'wearPct')
  if (wear !== undefined) ctx.tyreWearMaxPct = wear
  const tyreTemp = maxTyreField(snapshot.tyres, 'tempC')
  if (tyreTemp !== undefined) ctx.tyreTempMaxC = tyreTemp
  const brakeTemp = maxOfCorners(snapshot.brakeTempC)
  if (brakeTemp !== undefined) ctx.brakeTempMaxC = brakeTemp
  // ── Conditions ──
  if (Number.isFinite(snapshot.trackWetnessPct)) ctx.trackWetnessPct = snapshot.trackWetnessPct
  if (Number.isFinite(snapshot.gripPct)) ctx.gripPct = snapshot.gripPct
  if (snapshot.isRaining !== undefined) ctx.isRaining = snapshot.isRaining === true
  return Object.keys(ctx).length > 0 ? ctx : undefined
}

/** dt (ms) between consecutive samples, clamped so a stutter never dominates. */
function deltaMs(prev: CoachLapSample, cur: CoachLapSample): number {
  return Math.max(0, Math.min(250, cur.t - prev.t))
}

interface BrakingZone {
  startIdx: number
  endIdx: number
  startPct: number
  endPct: number
  durMs: number
  maxBrake: number
  maxSteerDeg: number
  maxLatG: number
  absMs: number
  entrySpeedKmh: number
  minSpeedKmh: number
  coastAfterMs: number
}

/** Contiguous runs where the driver is on the brake. */
export function detectBrakingZones(
  samples: CoachLapSample[],
  cfg: CoachAnalysisConfig = DEFAULT_COACH_ANALYSIS
): BrakingZone[] {
  const zones: BrakingZone[] = []
  let i = 0
  while (i < samples.length) {
    if (samples[i].brake <= cfg.brakeOn) {
      i += 1
      continue
    }
    const startIdx = i
    let durMs = 0
    let maxBrake = 0
    let maxSteerDeg = 0
    let maxLatG = 0
    let absMs = 0
    let minSpeedKmh = Number.POSITIVE_INFINITY
    while (i < samples.length && samples[i].brake > cfg.brakeOn) {
      const s = samples[i]
      const dt = i > startIdx ? deltaMs(samples[i - 1], s) : 0
      durMs += dt
      maxBrake = Math.max(maxBrake, s.brake)
      maxSteerDeg = Math.max(maxSteerDeg, s.steerAbsDeg)
      maxLatG = Math.max(maxLatG, s.latAbsG)
      if (s.absActive) absMs += dt
      minSpeedKmh = Math.min(minSpeedKmh, s.speedKmh)
      i += 1
    }
    const endIdx = i - 1
    // Measure any coast (off both pedals) between brake release and throttle pickup.
    let coastAfterMs = 0
    let j = i
    while (j < samples.length && samples[j].throttle <= cfg.throttleOn && samples[j].brake <= cfg.brakeOn) {
      coastAfterMs += deltaMs(samples[j - 1], samples[j])
      j += 1
    }
    zones.push({
      startIdx,
      endIdx,
      startPct: samples[startIdx].lapDistPct,
      endPct: samples[endIdx].lapDistPct,
      durMs,
      maxBrake,
      maxSteerDeg,
      maxLatG,
      absMs,
      entrySpeedKmh: samples[startIdx].speedKmh,
      minSpeedKmh: minSpeedKmh === Number.POSITIVE_INFINITY ? samples[endIdx].speedKmh : minSpeedKmh,
      coastAfterMs
    })
  }
  return zones
}

interface CoastZone {
  startPct: number
  endPct: number
  durMs: number
  maxLatG: number
  sector: number
}

/** Contiguous runs of coasting (off throttle AND off brake) above a speed floor. */
export function detectCoastZones(
  samples: CoachLapSample[],
  cfg: CoachAnalysisConfig = DEFAULT_COACH_ANALYSIS
): CoastZone[] {
  const zones: CoastZone[] = []
  let i = 0
  const isCoast = (s: CoachLapSample): boolean =>
    s.throttle <= cfg.coastThrottle && s.brake <= cfg.coastBrake && s.speedKmh >= cfg.minSpeedForCoastKmh
  while (i < samples.length) {
    if (!isCoast(samples[i])) {
      i += 1
      continue
    }
    const startIdx = i
    let durMs = 0
    let maxLatG = 0
    while (i < samples.length && isCoast(samples[i])) {
      const dt = i > startIdx ? deltaMs(samples[i - 1], samples[i]) : 0
      durMs += dt
      maxLatG = Math.max(maxLatG, samples[i].latAbsG)
      i += 1
    }
    const endIdx = i - 1
    const midPct = (samples[startIdx].lapDistPct + samples[endIdx].lapDistPct) / 2
    zones.push({
      startPct: samples[startIdx].lapDistPct,
      endPct: samples[endIdx].lapDistPct,
      durMs,
      maxLatG,
      sector: sectorOf(midPct, cfg.sectorCount)
    })
  }
  return zones
}

interface SectorAccum {
  sector: number
  totalMs: number
  brakeMs: number
  coastMs: number
  throttleMs: number
  absMs: number
  tcMs: number
  minSpeedKmh: number
  steerBusyScore: number
  steerInsufficientScore: number
  firstDelta?: number
  lastDelta?: number
}

function accumulateSectors(samples: CoachLapSample[], cfg: CoachAnalysisConfig): Map<number, SectorAccum> {
  const map = new Map<number, SectorAccum>()
  const get = (sector: number): SectorAccum => {
    let a = map.get(sector)
    if (!a) {
      a = { sector, totalMs: 0, brakeMs: 0, coastMs: 0, throttleMs: 0, absMs: 0, tcMs: 0, minSpeedKmh: Number.POSITIVE_INFINITY, steerBusyScore: 0, steerInsufficientScore: 0 }
      map.set(sector, a)
    }
    return a
  }
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i]
    const a = get(sectorOf(s.lapDistPct, cfg.sectorCount))
    const dt = i > 0 ? deltaMs(samples[i - 1], s) : 0
    a.totalMs += dt
    if (s.brake > cfg.brakeOn) a.brakeMs += dt
    if (s.throttle <= cfg.coastThrottle && s.brake <= cfg.coastBrake && s.speedKmh >= cfg.minSpeedForCoastKmh) a.coastMs += dt
    if (s.throttle > cfg.throttleOn) a.throttleMs += dt
    if (s.absActive) a.absMs += dt
    if (s.tcActive) a.tcMs += dt
    a.minSpeedKmh = Math.min(a.minSpeedKmh, s.speedKmh)
    if (i > 0 && s.speedKmh > 55 && s.latAbsG > 0.35) {
      const dSteer = Math.abs(s.steerAbsDeg - samples[i - 1].steerAbsDeg)
      if (dSteer > 6) a.steerBusyScore += dSteer * (1 + s.latAbsG)
    }
    // Under-rotation (virando POUCO): a clearly loaded corner (high lateral demand)
    // where the wheel is held FAR BELOW the lock that load warrants — the driver needs
    // MORE steering. The inverse of the busy score. Conservatively gated: real pace,
    // high lateral G, and an UPPER speed bound (fast aero corners pull high G with
    // little lock, so the linear load model over-predicts there); only GROSS
    // under-rotation (wheel < 60% of expected) accumulates, so a correctly-driven fast
    // sweeper never flags. Straights, slow corners and direct-steering cars never flag.
    if (i > 0 && s.speedKmh > 55 && s.speedKmh < 200 && s.latAbsG > 0.6) {
      const expectedDeg = s.latAbsG * cfg.steerLoadDeg
      if (s.steerAbsDeg < expectedDeg * 0.6) a.steerInsufficientScore += (expectedDeg - s.steerAbsDeg) * s.latAbsG
    }
    if (s.deltaToBestSec !== undefined) {
      if (a.firstDelta === undefined) a.firstDelta = s.deltaToBestSec
      a.lastDelta = s.deltaToBestSec
    }
  }
  return map
}

/** Per-sector summary (delta-derived time loss when the sim exposes the delta). */
export function summarizeSectors(
  buffer: CoachLapBuffer,
  cfg: CoachAnalysisConfig = DEFAULT_COACH_ANALYSIS
): CoachSectorSummary[] {
  const merged: CoachAnalysisConfig = { ...cfg, sectorCount: buffer.sectorCount || cfg.sectorCount }
  const map = accumulateSectors(buffer.samples, merged)
  const out: CoachSectorSummary[] = []
  for (let sector = 1; sector <= merged.sectorCount; sector += 1) {
    const a = map.get(sector)
    if (!a || a.totalMs <= 0) {
      out.push({ sector, timeLossSec: 0, minSpeedKmh: 0, brakePct: 0, coastPct: 0, throttlePct: 0, absSec: 0, tcSec: 0, benchmark: false })
      continue
    }
    const timeLossSec = a.firstDelta !== undefined && a.lastDelta !== undefined ? Math.max(0, a.lastDelta - a.firstDelta) : 0
    const benchmark = timeLossSec <= merged.goodLossSec && a.absMs < merged.absSectorMs && a.tcMs < merged.tcSectorMs && a.coastMs < merged.minCoastMs
    out.push({
      sector,
      timeLossSec,
      minSpeedKmh: a.minSpeedKmh === Number.POSITIVE_INFINITY ? 0 : a.minSpeedKmh,
      brakePct: a.brakeMs / a.totalMs,
      coastPct: a.coastMs / a.totalMs,
      throttlePct: a.throttleMs / a.totalMs,
      absSec: a.absMs / 1000,
      tcSec: a.tcMs / 1000,
      benchmark
    })
  }
  return out
}

let findingSeq = 0

/** Optional, additive fields for a finding (corner, sign override, gain delta, explanation). */
interface FindingExtra {
  corner?: number
  cornerPctStart?: number
  cornerPctEnd?: number
  /** Override the sign (defaults: gain kinds → 'gain', good → undefined, else 'loss'). */
  sign?: CoachFindingSign
  /** Positive seconds for a GAIN finding (sets estTimeDeltaSec > 0; loss stays 0). */
  estTimeGainSec?: number
  /** Override the severity (gains default to 'good' so they never read as a mistake). */
  severity?: CoachSeverity
  /** Plain PT-BR "why/how" (defaults to `detail`). */
  explanation?: string
}

function makeFinding(
  kind: CoachFindingKind,
  sector: number,
  zone: { start: number; end: number },
  estTimeLossSec: number,
  phase: CoachPhase | undefined,
  title: string,
  detail: string,
  evidence: string,
  metrics: Record<string, number>,
  good = false,
  extra: FindingExtra = {}
): CoachFinding {
  findingSeq += 1
  const isGain = GAIN_FINDING_KINDS.has(kind) || extra.sign === 'gain'
  const sign: CoachFindingSign | undefined = extra.sign ?? (isGain ? 'gain' : good || kind === 'good' ? undefined : 'loss')
  const lossSec = isGain || good ? 0 : Math.max(0, estTimeLossSec)
  const gainSec = isGain ? Math.max(0, extra.estTimeGainSec ?? estTimeLossSec) : 0
  const estTimeDeltaSec = isGain ? gainSec : -lossSec
  // Gains never read as a mistake: keep them out of the loss-ranked / spoken paths
  // by defaulting their severity to 'good'.
  const severity = extra.severity ?? (isGain ? 'good' : severityForLoss(estTimeLossSec, good))
  return {
    id: `${kind}:s${sector}${extra.corner ? `:c${extra.corner}` : ''}:${findingSeq}`,
    kind,
    phase,
    sector,
    corner: extra.corner,
    cornerPctStart: extra.cornerPctStart,
    cornerPctEnd: extra.cornerPctEnd,
    zonePctStart: zone.start,
    zonePctEnd: zone.end,
    severity,
    estTimeLossSec: lossSec,
    estTimeDeltaSec,
    sign,
    title,
    detail,
    explanation: extra.explanation ?? detail,
    evidence,
    metrics
  }
}

/**
 * Rank findings worst-first; `good`/`gain` sink to the bottom. Keeps one per
 * (kind, sector, CORNER) so multiple corners in the same sector each survive.
 */
export function rankFindings(findings: CoachFinding[]): CoachFinding[] {
  const best = new Map<string, CoachFinding>()
  for (const f of findings) {
    const key = `${f.kind}:${f.sector}:${f.corner ?? ''}`
    const prev = best.get(key)
    if (!prev) {
      best.set(key, f)
      continue
    }
    // For gains keep the BIGGEST gain; for losses keep the BIGGEST loss.
    const better = f.sign === 'gain' ? (f.estTimeDeltaSec ?? 0) > (prev.estTimeDeltaSec ?? 0) : f.estTimeLossSec > prev.estTimeLossSec
    if (better) best.set(key, f)
  }
  return Array.from(best.values()).sort((a, b) => {
    const aLow = a.severity === 'good' ? 1 : 0
    const bLow = b.severity === 'good' ? 1 : 0
    if (aLow !== bLow) return aLow - bLow
    return b.estTimeLossSec - a.estTimeLossSec
  })
}

/** Optional inputs that unlock per-corner + bidirectional analysis. */
export interface AnalyzeLapOptions {
  /** Numbered corner map for the track; enables corner numbers + timing kinds. */
  cornerMap?: CoachCornerMap | null
  /** Reference lap (per-corner metrics) to compare against for gains/losses. */
  reference?: CoachReferenceLap | null
  /**
   * Driver-intent registry. When present, analyzeLap runs the INTENT GATE so
   * deliberate racecraft / management / condition choices are demoted to neutral
   * context (or silenced) instead of flagged as errors. Omitted → legacy behavior.
   */
  registry?: DriverIntentRegistry
  /** Personal baseline (car+track) enabling lap-to-lap repetition gating. */
  baseline?: CoachBaseline
  /** Confidence a legitimate intent needs to suppress a finding (default 0.6). */
  intentThreshold?: number
  /** Min error-confidence to keep an error audible (default 0.4; UI sensitivity). */
  minConfidence?: number
  /** Display units for human-readable detail/evidence strings; metrics stay canonical. */
  unitSystem?: UnitSystem
}

/** PURE: turn a buffered lap into ranked findings. */
export function analyzeLap(
  buffer: CoachLapBuffer,
  cfg: CoachAnalysisConfig = DEFAULT_COACH_ANALYSIS,
  opts: AnalyzeLapOptions = {}
): CoachFinding[] {
  const samples = buffer.samples
  if (samples.length < 4) return []
  const merged: CoachAnalysisConfig = { ...cfg, sectorCount: buffer.sectorCount || cfg.sectorCount }
  const cornerMap = opts.cornerMap ?? null
  const findings: CoachFinding[] = []

  // ── Braking zones → early / late / trail-brake lock ──
  for (const z of detectBrakingZones(samples, merged)) {
    const sector = sectorOf((z.startPct + z.endPct) / 2, merged.sectorCount)
    const zone = { start: z.startPct, end: z.endPct }
    const m = {
      maxBrakePct: Math.round(z.maxBrake * 100),
      maxSteerDeg: Math.round(z.maxSteerDeg),
      maxLatG: Number(z.maxLatG.toFixed(2)),
      brakeMs: Math.round(z.durMs),
      absMs: Math.round(z.absMs),
      coastAfterMs: Math.round(z.coastAfterMs),
      entrySpeedKmh: Math.round(z.entrySpeedKmh),
      minSpeedKmh: Math.round(z.minSpeedKmh)
    }
    if (z.maxBrake > 0.7 && (z.maxSteerDeg > merged.trailSteerDeg || z.maxLatG > merged.trailLatG) && z.absMs > merged.trailAbsMs) {
      const loss = 0.06 + z.absMs / 4000
      findings.push(makeFinding('trail-brake-lock', sector, zone, loss, 'entry',
        `Trail-brake travando — Sector ${sector}`,
        'You are still carrying too much brake while turning; ABS fires and the front axle locks. Release the brake progressively as you add steering.',
        `Brake ${m.maxBrakePct}% with steering ${m.maxSteerDeg}° / ${m.maxLatG}G, ABS ${(z.absMs / 1000).toFixed(1)}s`, m))
    } else if (z.maxBrake >= merged.lateBrake && z.absMs > merged.lateAbsMs) {
      const loss = 0.07 + z.absMs / 3500
      findings.push(makeFinding('brake-late', sector, zone, loss, 'entry',
        `Late/hard braking demais — Sector ${sector}`,
        'A very high brake peak with prolonged ABS points to late braking and straight-line lockup. Brake earlier and modulate pressure so the tire does not lock.',
        `Pico ${m.maxBrakePct}%, ABS ${(z.absMs / 1000).toFixed(1)}s, min ${formatMeasurement(m.minSpeedKmh, 'speed-kmh', opts.unitSystem ?? 'metric', { decimals: 0, includeUnit: true }).display}`, m))
    } else if (z.coastAfterMs > merged.earlyCoastMs && z.durMs > merged.earlyMinBrakeMs && z.maxBrake < merged.earlyMaxBrake) {
      const loss = z.coastAfterMs / 1000 * 0.3 + z.durMs / 1000 * 0.12
      findings.push(makeFinding('brake-early', sector, zone, loss, 'entry',
        `Freada cedo — Sector ${sector}`,
        'You braked early and coasted to the turn. Carry more speed to the braking point and shorten time on the pedal.',
        `Brake ${(z.durMs / 1000).toFixed(1)}s (pico ${m.maxBrakePct}%) + ${(z.coastAfterMs / 1000).toFixed(1)}s coasting`, m))
    }
  }

  // ── Coast zones → mid-corner coasting / lift-and-coast time loss ──
  for (const c of detectCoastZones(samples, merged)) {
    if (c.durMs < merged.minCoastMs) continue
    const loss = c.durMs / 1000 * 0.35
    const loaded = c.maxLatG >= merged.coastLatG
    const m = { coastMs: Math.round(c.durMs), maxLatG: Number(c.maxLatG.toFixed(2)) }
    findings.push(makeFinding('coast', c.sector, { start: c.startPct, end: c.endPct }, loss, loaded ? 'mid' : 'exit',
      loaded ? `Coasting mid-corner — Sector ${c.sector}` : `Lift-and-coast custando tempo — Sector ${c.sector}`,
      loaded
        ? 'There is dead time with the car loaded and no pedal at the apex. Keep a trace of brake on entry and pick up throttle earlier on exit.'
        : 'Section with no brake or throttle. Decide: brake or accelerate — avoid coasting in this zone.',
      `${(c.durMs / 1000).toFixed(1)}s sem pedal a ${m.maxLatG}G`, m))
  }

  // ── Exit throttle hesitation ──
  for (const h of detectThrottleHesitation(samples, merged)) {
    const sector = sectorOf((h.startPct + h.endPct) / 2, merged.sectorCount)
    const loss = h.durMs / 1000 * 0.3
    const m = { hesitationMs: Math.round(h.durMs), avgThrottlePct: Math.round(h.avgThrottle * 100) }
    findings.push(makeFinding('throttle-hesitation', sector, { start: h.startPct, end: h.endPct }, loss, 'exit',
      `Hesitant exit — Sector ${sector}`,
      'You are stuck at partial throttle on exit. Open the steering and commit to throttle earlier with a decisive ramp to 100%.',
      `${(h.durMs / 1000).toFixed(1)}s em ~${m.avgThrottlePct}% de acelerador`, m))
  }

  // ── Per-sector: ABS / TC overuse + busy steering ──
  const sectors = accumulateSectors(samples, merged)
  for (const a of sectors.values()) {
    const span = sectorSpan(a.sector, merged.sectorCount)
    if (a.absMs > merged.absSectorMs) {
      const loss = a.absMs / 9000
      findings.push(makeFinding('abs-overuse', a.sector, span, loss, 'entry',
        `ABS acionando demais — Sector ${a.sector}`,
        'ABS is active too long: release brake pressure before the apex so the tire keeps rotating and actually slows the car.',
        `ABS ${(a.absMs / 1000).toFixed(1)}s no sector`, { absMs: Math.round(a.absMs) }))
    }
    if (a.tcMs > merged.tcSectorMs) {
      const loss = a.tcMs / 10000
      findings.push(makeFinding('tc-overuse', a.sector, span, loss, 'exit',
        `TC cutting on exit — Sector ${a.sector}`,
        'Traction control is cutting too much on exit: straighten the car more before going 100% and be smoother with your foot to avoid triggering TC.',
        `TC ${(a.tcMs / 1000).toFixed(1)}s no sector`, { tcMs: Math.round(a.tcMs) }))
    }
    if (a.steerBusyScore > merged.steerBusyScore) {
      const loss = Math.min(0.18, a.steerBusyScore / 1600)
      findings.push(makeFinding('steering-busy', a.sector, span, loss, 'mid',
        `Volante muito agitado — Sector ${a.sector}`,
        'Too many steering corrections scrub the tire and kill minimum speed. Smooth the entry and aim for one steering arc.',
        `Correction score ${Math.round(a.steerBusyScore)}`, { steerScore: Math.round(a.steerBusyScore) }))
    }
    if (a.steerInsufficientScore > merged.steerInsufficientScore) {
      const loss = Math.min(0.15, a.steerInsufficientScore / 1800)
      findings.push(makeFinding('steering-insufficient', a.sector, span, loss, 'mid',
        `Virando pouco — Sector ${a.sector}`,
        'Not enough steering for the turn: the car is loaded but you do not add enough angle and run wide on exit. Add more steering and let the car point to the apex.',
        `Under-rotation score ${Math.round(a.steerInsufficientScore)}`, { steerInsufficientScore: Math.round(a.steerInsufficientScore) }))
    }
  }

  // ── Biggest time-loss zone (delta-derived) ──
  const lossZone = biggestTimeLossZone(samples, merged)
  if (lossZone && lossZone.lossSec >= merged.minTimeLossSec) {
    const sector = sectorOf((lossZone.startPct + lossZone.endPct) / 2, merged.sectorCount)
    findings.push(makeFinding('time-loss', sector, { start: lossZone.startPct, end: lossZone.endPct }, lossZone.lossSec, undefined,
      `Maior perda de tempo — Sector ${sector}`,
      'This is where you lose the most against your best lap. Focus braking and throttle pickup references here first.',
      `${lossZone.lossSec.toFixed(2)}s perdidos entre ${Math.round(lossZone.startPct * 100)}% e ${Math.round(lossZone.endPct * 100)}% da lap`,
      { lossSec: Number(lossZone.lossSec.toFixed(3)) }))
  }

  // ── Good sectors (clean + not losing time, and no issue already flagged) ──
  const issueSectors = new Set(findings.map((f) => f.sector))
  for (const s of summarizeSectors(buffer, merged)) {
    if (issueSectors.has(s.sector)) continue
    if (s.benchmark && (s.brakePct > 0 || s.throttlePct > 0)) {
      const span = sectorSpan(s.sector, merged.sectorCount)
      findings.push(makeFinding('good', s.sector, span, 0, undefined,
        `Sector ${s.sector} no pace`,
        'No relevant loss and clean inputs here. Keep the references and smoothness.',
        s.timeLossSec > 0 ? `+${s.timeLossSec.toFixed(2)}s vs best` : 'At best-lap level', {}, true))
    }
  }

  // ── Corner-relative timing (steering + throttle) — needs a corner map ──
  if (cornerMap && cornerMap.corners.length > 0) {
    for (const f of detectCornerTimingFindings(samples, cornerMap, merged)) findings.push(f)
  }

  // ── BIDIRECTIONAL: gains/losses vs a reference lap, per corner ──
  if (cornerMap && cornerMap.corners.length > 0 && opts.reference) {
    const current = computeCornerMetrics(samples, cornerMap, merged)
    for (const f of bidirectionalCornerFindings(current, opts.reference, cornerMap, merged, opts.unitSystem)) findings.push(f)
  }

  // Attach the corner number (+ extent) to every finding from the corner map.
  decorateCorners(findings, cornerMap)

  // ── INTENT GATE (decision core) ── demote deliberate choices to context / silence
  // low-confidence errors. No-op when no registry is supplied or (in the gate) when
  // there is neither a context frame nor a baseline — so legacy laps are untouched.
  const gated = opts.registry
    ? applyIntentGate(findings, samples, opts.registry, {
        intentThreshold: opts.intentThreshold,
        minConfidence: opts.minConfidence,
        baseline: opts.baseline,
        lap: buffer.lapNumber,
        unitSystem: opts.unitSystem
      })
    : findings

  return rankFindings(gated)
}

/** Mutates each finding, mapping its zone midpoint to a numbered corner (when known). */
function decorateCorners(findings: CoachFinding[], cornerMap: CoachCornerMap | null): void {
  if (!cornerMap || cornerMap.corners.length === 0) return
  for (const f of findings) {
    if (f.corner !== undefined) continue // already corner-scoped (timing / gain)
    if (f.kind === 'inconsistency') continue // lap-global, no corner
    const mid = (f.zonePctStart + f.zonePctEnd) / 2
    const c = cornerOf(cornerMap, mid)
    if (c) {
      f.corner = c.index
      f.cornerPctStart = c.startPct
      f.cornerPctEnd = c.endPct
    }
  }
}

function sectorSpan(sector: number, sectorCount: number): { start: number; end: number } {
  const width = 1 / sectorCount
  return { start: (sector - 1) * width, end: sector * width }
}

// ─── Corner-relative metrics + timing + bidirectional gains/losses (PURE) ─────

/** Samples whose lapDistPct falls inside a (padded) corner window, in lap order. */
function samplesInCorner(samples: CoachLapSample[], corner: CoachCornerRef, padPct: number): CoachLapSample[] {
  const lo = corner.startPct - padPct
  const hi = corner.endPct + padPct
  return samples.filter((s) => s.lapDistPct >= lo && s.lapDistPct <= hi)
}

/**
 * lapDistPct where throttle is (re)applied for real. We scan from the moment the
 * driver got on the BRAKE (off-throttle to brake) so the throttle held on the
 * approach straight is never mistaken for a corner throttle application; when there
 * is no braking in the window we fall back to the apex.
 */
function throttleReapplyPct(win: CoachLapSample[], cfg: CoachAnalysisConfig, apexIdx: number): number | undefined {
  const brakeIdx = win.findIndex((s) => s.brake > cfg.brakeOn)
  const from = brakeIdx >= 0 ? brakeIdx : apexIdx
  return win.slice(from).find((s) => s.throttle > cfg.throttleOn && s.brake <= cfg.brakeOn)?.lapDistPct
}

/** PURE: per-corner measured metrics for one lap (min speed, brake/throttle/turn-in points). */
export function computeCornerMetrics(
  samples: CoachLapSample[],
  cornerMap: CoachCornerMap,
  cfg: CoachAnalysisConfig = DEFAULT_COACH_ANALYSIS
): CoachCornerMetrics[] {
  const out: CoachCornerMetrics[] = []
  for (const corner of cornerMap.corners) {
    const win = samplesInCorner(samples, corner, cfg.cornerTimingMarginPct)
    if (win.length === 0) continue
    const exact = samplesInCorner(samples, corner, 0)
    const speedWindow = exact.length > 0 ? exact : win
    let minSpeedKmh = Number.POSITIVE_INFINITY
    let apexIdx = 0
    win.forEach((s, i) => {
      if (s.speedKmh < minSpeedKmh) {
        minSpeedKmh = s.speedKmh
        apexIdx = i
      }
    })
    const entrySpeedKmh = speedWindow[0].speedKmh
    const exitSpeedKmh = speedWindow[speedWindow.length - 1].speedKmh
    const brakeStartPct = win.find((s) => s.brake > cfg.brakeOn)?.lapDistPct
    const steerStartPct = win.find((s) => s.steerAbsDeg > cfg.steerTurnInDeg)?.lapDistPct
    const throttleStartPct = throttleReapplyPct(win, cfg, apexIdx)
    const tcActivePct = speedWindow.filter((s) => s.tcActive).length / speedWindow.length
    out.push({
      corner: corner.index,
      minSpeedKmh: Math.round(minSpeedKmh === Number.POSITIVE_INFINITY ? 0 : minSpeedKmh),
      entrySpeedKmh: Math.round(entrySpeedKmh),
      exitSpeedKmh: Math.round(exitSpeedKmh),
      brakeStartPct,
      throttleStartPct,
      steerStartPct,
      tcActivePct
    })
  }
  return out
}

/** PURE: steering + throttle TIMING mistakes, judged against each corner's geometry. */
export function detectCornerTimingFindings(
  samples: CoachLapSample[],
  cornerMap: CoachCornerMap,
  cfg: CoachAnalysisConfig = DEFAULT_COACH_ANALYSIS
): CoachFinding[] {
  const out: CoachFinding[] = []
  const margin = cfg.cornerTimingMarginPct
  // The detection window looks further back/ahead than the margin so an EARLY
  // turn-in / throttle (before entry by more than `margin`) is actually visible.
  const lookback = Math.max(margin * 4, 0.05)
  for (const corner of cornerMap.corners) {
    const win = samplesInCorner(samples, corner, lookback)
    if (win.length === 0) continue
    const sector = sectorOf(corner.apexPct, cfg.sectorCount)
    const span = { start: corner.startPct, end: corner.endPct }
    const cornerExtra = { corner: corner.index, cornerPctStart: corner.startPct, cornerPctEnd: corner.endPct }

    // Turn-in timing vs the corner ENTRY.
    const steerStartPct = win.find((s) => s.steerAbsDeg > cfg.steerTurnInDeg)?.lapDistPct
    if (steerStartPct !== undefined) {
      const delta = steerStartPct - corner.startPct
      if (delta < -margin) {
        const loss = timingLoss(-delta)
        out.push(makeFinding('steering-early', sector, span, loss, 'entry',
          `Volante cedo — Turn ${corner.index}`,
          'You turned in before the entry point and pointed the car too early, running wide on exit. Delay turn-in and use a later tip-in reference.',
          `Turn-in at ${pct(steerStartPct)} (${pct(Math.abs(delta))} before turn entry)`,
          { steerStartPct: round3(steerStartPct), deltaPct: round3(delta) }, false, { ...cornerExtra, explanation: 'Turned in too early — delay entry so you do not run wide on exit.' }))
      } else if (delta > margin) {
        const loss = timingLoss(delta)
        out.push(makeFinding('steering-late', sector, span, loss, 'entry',
          `Volante tarde — Turn ${corner.index}`,
          'Turn-in came late: the car entered straight and you had to correct at the apex. Move tip-in slightly earlier for a cleaner arc.',
          `Turn-in at ${pct(steerStartPct)} (${pct(delta)} after turn entry)`,
          { steerStartPct: round3(steerStartPct), deltaPct: round3(delta) }, false, { ...cornerExtra, explanation: 'Turned in late — move entry earlier for one clean arc.' }))
      }
    }

    // Throttle timing vs the APEX (early = on power before apex; late = too cautious).
    let apexIdx = 0
    let minSpeed = Number.POSITIVE_INFINITY
    win.forEach((s, i) => {
      if (s.speedKmh < minSpeed) {
        minSpeed = s.speedKmh
        apexIdx = i
      }
    })
    // Throttle reapplication (scanned from the brake point so the approach straight
    // throttle is ignored): early = before the apex, late = well after the exit.
    const throttleStartPct = throttleReapplyPct(win, cfg, apexIdx)
    if (throttleStartPct !== undefined) {
      const fromApex = throttleStartPct - corner.apexPct
      if (fromApex < -margin) {
        const loss = timingLoss(-fromApex)
        out.push(makeFinding('throttle-early', sector, span, loss, 'mid',
          `Acelerou cedo — Turn ${corner.index}`,
          'You got to throttle before the apex and pushed the car wide, washing out the front on exit. Wait for the apex and for the car to point before accelerating.',
          `Throttle at ${pct(throttleStartPct)} (${pct(Math.abs(fromApex))} before apex)`,
          { throttleStartPct: round3(throttleStartPct), deltaPct: round3(fromApex) }, false, { ...cornerExtra, explanation: 'Got to throttle too early — wait for the apex before opening throttle.' }))
      } else if (throttleStartPct - corner.endPct > margin) {
        const loss = timingLoss(throttleStartPct - corner.endPct)
        out.push(makeFinding('throttle-late', sector, span, loss, 'exit',
          `Acelerou tarde — Turn ${corner.index}`,
          'Throttle pickup came too late on exit. As soon as the car points, commit to throttle earlier with a decisive ramp.',
          `Throttle at ${pct(throttleStartPct)} (${pct(throttleStartPct - corner.endPct)} after exit)`,
          { throttleStartPct: round3(throttleStartPct), deltaPct: round3(throttleStartPct - corner.endPct) }, false, { ...cornerExtra, explanation: 'Got to throttle late — pick it up earlier on exit.' }))
      }
    }
  }
  return out
}

/** A small, deterministic seconds estimate for a timing error of `deltaPct` lap-fraction. */
function timingLoss(deltaPct: number): number {
  return Math.min(0.2, Math.max(0, deltaPct) * 3)
}

function pct(value: number): string {
  return `${Math.round(value * 1000) / 10}%`
}

function round3(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0
}

/**
 * PURE: bidirectional per-corner findings vs a reference lap. Emits GAINS (blue —
 * what the driver did well to REPLICATE: more min speed, braked later & made it,
 * earlier throttle) and reference-derived LOSSES (red — notably lower min speed),
 * each carrying a SIGN, a signed `estTimeDeltaSec`, and a PT-BR `explanation`.
 */
export function bidirectionalCornerFindings(
  current: CoachCornerMetrics[],
  reference: CoachReferenceLap,
  cornerMap: CoachCornerMap,
  cfg: CoachAnalysisConfig = DEFAULT_COACH_ANALYSIS,
  unitSystem: UnitSystem = 'metric'
): CoachFinding[] {
  const out: CoachFinding[] = []
  const refByCorner = new Map<number, CoachCornerMetrics>()
  for (const r of reference.corners) refByCorner.set(r.corner, r)
  const cornerByIndex = new Map<number, CoachCornerRef>()
  for (const c of cornerMap.corners) cornerByIndex.set(c.index, c)

  for (const cur of current) {
    const ref = refByCorner.get(cur.corner)
    const corner = cornerByIndex.get(cur.corner)
    if (!ref || !corner) continue
    const span = { start: corner.startPct, end: corner.endPct }
    const sector = sectorOf(corner.apexPct, cfg.sectorCount)
    const cornerExtra = { corner: cur.corner, cornerPctStart: corner.startPct, cornerPctEnd: corner.endPct }

    // ── Min-speed: gain (faster) or loss (slower) vs the reference apex speed ──
    const speedDelta = cur.minSpeedKmh - ref.minSpeedKmh
    const currentSpeed = formatMeasurement(cur.minSpeedKmh, 'speed-kmh', unitSystem, { decimals: 0 })
    const referenceSpeed = formatMeasurement(ref.minSpeedKmh, 'speed-kmh', unitSystem, { decimals: 0 })
    const deltaSpeed = formatMeasurement(speedDelta, 'speed-kmh', unitSystem, { decimals: 0, signed: true })
    const speedUnit = currentSpeed.unit
    if (speedDelta >= cfg.minSpeedDeltaKmh) {
      const gain = Math.min(0.4, speedDelta * cfg.secPerKmhDelta)
      out.push(makeFinding('min-speed-gain', sector, span, 0, 'mid',
        `Mais speed na Turn ${cur.corner}`,
        `You carried ${deltaSpeed.display.replace(/^\+/, '')} ${speedUnit} more minimum speed than the reference. Keep trusting the entry here.`,
        `Vmin ${currentSpeed.display} ${speedUnit} vs ${referenceSpeed.display} ${speedUnit} (${deltaSpeed.display})`,
        { minSpeedKmh: cur.minSpeedKmh, refMinSpeedKmh: ref.minSpeedKmh, deltaKmh: speedDelta }, false,
        { ...cornerExtra, estTimeGainSec: gain, explanation: `Carried ${deltaSpeed.display.replace(/^\+/, '')} ${speedUnit} more minimum speed — repeat that entry.` }))
    } else if (speedDelta <= -cfg.minSpeedDeltaKmh) {
      const loss = Math.min(0.4, -speedDelta * cfg.secPerKmhDelta)
      out.push(makeFinding('time-loss', sector, span, loss, 'mid',
        `Menos speed na Turn ${cur.corner}`,
        `You carried ${deltaSpeed.display.replace(/^-/, '')} ${speedUnit} less minimum speed than the reference. Carry more entry speed and release the brake earlier.`,
        `Vmin ${currentSpeed.display} ${speedUnit} vs ${referenceSpeed.display} ${speedUnit} (${deltaSpeed.display})`,
        { minSpeedKmh: cur.minSpeedKmh, refMinSpeedKmh: ref.minSpeedKmh, deltaKmh: speedDelta }, false,
        { ...cornerExtra, explanation: `Lost ${deltaSpeed.display.replace(/^-/, '')} ${speedUnit} of minimum speed — carry more speed on entry.` }))
    }

    // ── Braked later AND still kept the apex speed → a clean, replicable gain ──
    if (
      cur.brakeStartPct !== undefined &&
      ref.brakeStartPct !== undefined &&
      cur.brakeStartPct - ref.brakeStartPct >= cfg.cornerPointDeltaPct &&
      speedDelta >= -cfg.minSpeedDeltaKmh
    ) {
      const d = cur.brakeStartPct - ref.brakeStartPct
      out.push(makeFinding('brake-gain', sector, span, 0, 'entry',
        `Freada mais tarde na Turn ${cur.corner}`,
        `You managed to brake ${pct(d)} later than the reference and still made the turn. Keep that braking reference.`,
        `Brake at ${pct(cur.brakeStartPct)} vs ${pct(ref.brakeStartPct)} (+${pct(d)})`,
        { brakeStartPct: round3(cur.brakeStartPct), refBrakeStartPct: round3(ref.brakeStartPct), deltaPct: round3(d) }, false,
        { ...cornerExtra, estTimeGainSec: timingLoss(d), explanation: `Braked ${pct(d)} later successfully — keep that reference.` }))
    }

    // ── Got to throttle earlier on exit → replicable gain ──
    if (
      cur.throttleStartPct !== undefined &&
      ref.throttleStartPct !== undefined &&
      ref.throttleStartPct - cur.throttleStartPct >= cfg.cornerPointDeltaPct
    ) {
      const d = ref.throttleStartPct - cur.throttleStartPct
      out.push(makeFinding('throttle-gain', sector, span, 0, 'exit',
        `Acelerou mais cedo na Turn ${cur.corner}`,
        `You opened throttle ${pct(d)} earlier than the reference on exit. Great — keep it up.`,
        `Throttle at ${pct(cur.throttleStartPct)} vs ${pct(ref.throttleStartPct)} (-${pct(d)})`,
        { throttleStartPct: round3(cur.throttleStartPct), refThrottleStartPct: round3(ref.throttleStartPct), deltaPct: round3(d) }, false,
        { ...cornerExtra, estTimeGainSec: timingLoss(d), explanation: `Picked up throttle ${pct(d)} earlier — repeat that exit.` }))
    }
  }
  return out
}


interface HesitationZone {
  startPct: number
  endPct: number
  durMs: number
  avgThrottle: number
}

function detectThrottleHesitation(samples: CoachLapSample[], cfg: CoachAnalysisConfig): HesitationZone[] {
  const zones: HesitationZone[] = []
  let i = 0
  const isHes = (s: CoachLapSample): boolean =>
    s.throttle > cfg.coastThrottle && s.throttle < 0.62 && s.brake <= cfg.coastBrake && s.latAbsG < cfg.hesitationLatG && s.speedKmh > 60
  while (i < samples.length) {
    if (!isHes(samples[i])) {
      i += 1
      continue
    }
    const startIdx = i
    let durMs = 0
    let throttleSum = 0
    let count = 0
    while (i < samples.length && isHes(samples[i])) {
      durMs += i > startIdx ? deltaMs(samples[i - 1], samples[i]) : 0
      throttleSum += samples[i].throttle
      count += 1
      i += 1
    }
    if (durMs >= cfg.hesitationLoMs) {
      zones.push({
        startPct: samples[startIdx].lapDistPct,
        endPct: samples[i - 1].lapDistPct,
        durMs,
        avgThrottle: count > 0 ? throttleSum / count : 0
      })
    }
  }
  return zones
}

interface TimeLossZone {
  startPct: number
  endPct: number
  lossSec: number
}

function biggestTimeLossZone(samples: CoachLapSample[], cfg: CoachAnalysisConfig): TimeLossZone | null {
  const withDelta = samples.filter((s) => s.deltaToBestSec !== undefined)
  if (withDelta.length < 4) return null
  const bins = Math.max(2, cfg.timeLossBins)
  let best: TimeLossZone | null = null
  for (let b = 0; b < bins; b += 1) {
    const lo = b / bins
    const hi = (b + 1) / bins
    const inBin = withDelta.filter((s) => s.lapDistPct >= lo && s.lapDistPct < hi)
    if (inBin.length < 2) continue
    const loss = (inBin[inBin.length - 1].deltaToBestSec as number) - (inBin[0].deltaToBestSec as number)
    if (loss > 0 && (!best || loss > best.lossSec)) {
      best = { startPct: inBin[0].lapDistPct, endPct: inBin[inBin.length - 1].lapDistPct, lossSec: loss }
    }
  }
  return best
}

/** PURE: lap-to-lap consistency from a list of recent lap times. */
export function analyzeConsistency(lapTimesSec: number[]): CoachConsistency | undefined {
  const valid = lapTimesSec.filter((t) => Number.isFinite(t) && t > 0)
  if (valid.length < 3) return undefined
  const mean = valid.reduce((sum, v) => sum + v, 0) / valid.length
  const variance = valid.reduce((sum, v) => sum + (v - mean) ** 2, 0) / valid.length
  const stdev = Math.sqrt(variance)
  const rating: CoachConsistency['rating'] = stdev <= 0.2 ? 'tight' : stdev <= 0.45 ? 'ok' : 'loose'
  return { laps: valid.length, meanLapSec: mean, stdevSec: stdev, rating }
}

/** PURE: assemble the full coaching report for one lap. */
export function buildCoachReport(
  buffer: CoachLapBuffer,
  opts: {
    recentLapTimesSec?: number[]
    cfg?: CoachAnalysisConfig
    now?: number
    /** Numbered corner map for the track — enables per-corner findings + timing kinds. */
    cornerMap?: CoachCornerMap | null
    /** Reference lap (per-corner metrics) — enables bidirectional gains/losses. */
    reference?: CoachReferenceLap | null
    /** Driver-intent registry — enables the intent gate (context/silence). */
    registry?: DriverIntentRegistry
    /** Personal baseline (car+track) — enables lap-to-lap repetition gating. */
    baseline?: CoachBaseline
    /** Confidence a legitimate intent needs to suppress a finding (default 0.6). */
    intentThreshold?: number
    /** Min error-confidence to keep an error audible (default 0.4; UI sensitivity). */
    minConfidence?: number
    /** Display units for human-readable detail/evidence strings; metrics stay canonical. */
    unitSystem?: UnitSystem
  } = {}
): CoachReport {
  const cfg = opts.cfg ?? DEFAULT_COACH_ANALYSIS
  const cornerMap = opts.cornerMap ?? null
  const findings = analyzeLap(buffer, cfg, {
    cornerMap,
    reference: opts.reference ?? null,
    registry: opts.registry,
    baseline: opts.baseline,
    intentThreshold: opts.intentThreshold,
    minConfidence: opts.minConfidence,
    unitSystem: opts.unitSystem
  })
  const sectors = summarizeSectors(buffer, cfg)
  const consistency = analyzeConsistency(opts.recentLapTimesSec ?? [])
  // Surface lap-to-lap inconsistency as a ranked finding so it competes for the
  // driver's attention against the per-corner issues.
  const ranked =
    consistency && consistency.rating === 'loose'
      ? rankFindings([
          ...findings,
          makeFinding('inconsistency', 0, { start: 0, end: 1 }, Math.min(0.5, consistency.stdevSec), undefined,
            'Lap-to-lap inconsistency',
            'Your laps vary quite a bit. Before chasing more pace, repeat the same braking points and references to lower the deviation.',
            `Standard deviation ${consistency.stdevSec.toFixed(2)}s over the last ${consistency.laps} laps`,
            { stdevSec: Number(consistency.stdevSec.toFixed(3)), laps: consistency.laps })
        ])
      : findings
  const last = buffer.samples[buffer.samples.length - 1]
  const deltaFromSample = last?.deltaToBestSec
  const deltaFromTimes =
    buffer.lapTimeSec !== undefined && buffer.bestLapTimeSec !== undefined
      ? buffer.lapTimeSec - buffer.bestLapTimeSec
      : undefined
  const deltaToBestSec = deltaFromSample ?? deltaFromTimes
  const cornerMetrics = cornerMap ? computeCornerMetrics(buffer.samples, cornerMap, cfg) : []
  return {
    generatedAt: opts.now ?? Date.now(),
    lapNumber: buffer.lapNumber,
    lapTimeSec: buffer.lapTimeSec,
    bestLapTimeSec: buffer.bestLapTimeSec,
    deltaToBestSec,
    sampleCount: buffer.samples.length,
    sectors,
    findings: ranked,
    corners: cornerMap ? cornerMap.corners : [],
    cornerMetrics,
    consistency,
    summary: summarizeReport(ranked, deltaToBestSec, consistency)
  }
}

function summarizeReport(findings: CoachFinding[], deltaToBestSec: number | undefined, consistency?: CoachConsistency): string {
  const issues = findings.filter((f) => f.severity !== 'good')
  const totalLoss = issues.reduce((sum, f) => sum + f.estTimeLossSec, 0)
  const deltaTxt = deltaToBestSec !== undefined ? `${deltaToBestSec >= 0 ? '+' : ''}${deltaToBestSec.toFixed(2)}s vs best` : 'no reference delta'
  if (issues.length === 0) {
    return `Lap limpa — ${deltaTxt}. Nenhuma perda relevante detectada.`
  }
  const top = issues[0]
  const consistencyTxt = consistency ? `, consistency ${consistency.rating}` : ''
  return `${deltaTxt}${consistencyTxt}. Maior ganho: ${top.title.toLowerCase()} (~${top.estTimeLossSec.toFixed(2)}s); ${issues.length} pontos somam ~${totalLoss.toFixed(2)}s.`
}

/** Deterministic, LLM-free phrasing for a finding (used as the `coach:explain` fallback). */
export function deterministicPhrasing(
  finding: CoachFinding,
  language: 'pt-BR' | 'en-US' = 'pt-BR'
): string {
  const pt = language === 'pt-BR'
  const where = finding.corner
    ? `${pt ? 'Curva' : 'Turn'} ${finding.corner}`
    : finding.sector
      ? `${pt ? 'Setor' : 'Sector'} ${finding.sector}`
      : ''
  const action = capitalizeFirst(coachComposeAction(finding.kind, language))
  const impactTxt =
    finding.sign === 'gain'
      ? ` ${pt ? 'Ganho estimado' : 'Estimated gain'} ~${(finding.estTimeDeltaSec ?? 0).toFixed(2)}s.`
      : finding.severity === 'good'
        ? ''
        : ` ${pt ? 'Perda estimada' : 'Estimated loss'} ~${finding.estTimeLossSec.toFixed(2)}s.`
  const head = where ? `${where}: ${action}` : action
  return `${head}.${impactTxt}`.trim()
}

// ─── coach:explain IPC contract ─────────────────────────────────────────────────

export interface CoachExplainRequest {
  /** Either a finding id from the latest report, or an inline finding. */
  findingId?: string
  finding?: CoachFinding
  /** Try the local LLM to phrase it (falls back to deterministic when off/slow). */
  useLlm?: boolean
}

export interface CoachExplainResult {
  text: string
  source: 'llm' | 'deterministic'
  findingId?: string
}

/** Lightweight payload for `coach:lastFindings` / `coach:report`. */
export interface CoachReportPayload {
  report: CoachReport | null
  /** Setup advisor output for the latest lap (see setup-advisor.ts). */
  setup: import('./setup-advisor').SetupReport | null
}
