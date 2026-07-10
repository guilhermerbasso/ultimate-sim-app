// Driver-Intent registry — the deterministic, explainable brain that decides
// whether a candidate coaching event is actually a DELIBERATE choice (racecraft,
// management, track/session conditions) rather than an ERROR. It is the core of
// the "context, intent and racecraft awareness" upgrade (see
// docs/coach-intent-research.md). Design:
//
//   • Extensible RULE REGISTRY (Strategy pattern): each intent is a pluggable rule
//     `evaluate(event) → { confidence 0..1, evidence[] } | null`. New intents are
//     added by registering a rule — never by editing this core (no if-else chain).
//   • FUZZY scoring: continuous signals map to a membership degree in [0,1] instead
//     of brittle true/false thresholds (Zadeh fuzzy logic).
//   • SLIDING WINDOW: a rule reasons over the samples inside the event's lap-distance
//     zone (and a little context around it), not a single frame.
//   • EVIDENCE FUSION: weak signals combine into one confidence via a weighted mean.
//   • The winning legitimate intent (if its confidence ≥ threshold) SUPPRESSES the
//     finding; otherwise the event stays a candidate error. `intent-router.ts` is a
//     different concept (USER voice commands) — this file is DRIVER intent.
//
// PURE + dependency-free (only `import type` from coach/telemetry, so there is no
// runtime import cycle) → fully unit-testable.

import type { CoachContextSample, CoachFinding, CoachLapSample, CoachPhase } from './coach'
import type { CarLeftRightState, PaceMode, SessionState } from './telemetry'

// ─── Categories & ids ────────────────────────────────────────────────────────

/** The four catalogue categories (A–D in the research doc). Only `error` findings
 *  survive; the first three are legitimate-intent suppressors. */
export type IntentCategory = 'racecraft' | 'management' | 'conditions' | 'error'

/** Known intents. Extensible: `IntentId` also accepts any other string so a new
 *  rule can introduce its own id without editing this union. */
export type KnownIntentId =
  // A) Racecraft / duel
  | 'attack'
  | 'defend'
  | 'side-by-side'
  | 'avoid-incident'
  | 'being-lapped-blue'
  // B) Management / strategy
  | 'lift-and-coast'
  | 'tyre-brake-save'
  | 'out-in-lap'
  | 'mechanical'
  // C) Track / session conditions
  | 'yellow-flag'
  | 'blue-flag'
  | 'white-last-lap'
  | 'safety-car'
  | 'wet-low-grip'
  | 'track-limits'
  // Sentinel
  | 'none'

// eslint-disable-next-line @typescript-eslint/ban-types
export type IntentId = KnownIntentId | (string & {})

// ─── Evidence, scores & the aggregated decision ─────────────────────────────

/** One human-readable piece of evidence backing a score (surfaced in the tip). */
export interface IntentEvidence {
  /** Signal name, e.g. 'carLeftRight', 'gapAheadSec', 'trackWetnessPct'. */
  signal: string
  /** Plain description, e.g. 'car on the right', 'car ahead within 0.6s'. */
  detail: string
}

/** The result of evaluating ONE intent rule over an event window. */
export interface IntentScore {
  intent: IntentId
  category: IntentCategory
  /** 0..1 fuzzy confidence that this intent explains the event. */
  confidence: number
  evidence: IntentEvidence[]
}

/** The aggregated decision for an event: the winning legitimate intent, if any. */
export interface IntentEvaluation {
  /** True when a legitimate (non-error) intent explains the event ≥ threshold. */
  isIntentional: boolean
  intent: IntentId
  category: IntentCategory
  confidence: number
  evidence: IntentEvidence[]
  /** Every non-null score, ranked best→worst confidence (for explainability). */
  candidates: IntentScore[]
}

/** The finding fields an intent rule is allowed to see (kept minimal & stable). */
export type IntentCandidateFinding = Pick<
  CoachFinding,
  'kind' | 'sector' | 'corner' | 'zonePctStart' | 'zonePctEnd' | 'estTimeLossSec'
> & { phase?: CoachPhase }

/** Everything a rule needs to reason about one candidate event. */
export interface IntentEventContext {
  /** The candidate loss finding under scrutiny. */
  finding: IntentCandidateFinding
  /** The full lap's samples (a rule may inspect a temporal window). */
  samples: CoachLapSample[]
  /** Sample index range [startIdx, endIdx] covering the finding's zone. */
  window: { startIdx: number; endIdx: number }
  /** Context aggregated across the window (worst/most-relevant per signal). */
  ctx: CoachContextSample
}

/** A pluggable intent detector. PURE: same input → same output. */
export interface IntentRule {
  id: IntentId
  category: IntentCategory
  /** Short human label for logs/UI. */
  label: string
  /** Context signal names this rule reads (documentation only). */
  signalsUsed: string[]
  /** Score the event, or return null when the rule does not fire. */
  evaluate(event: IntentEventContext): IntentScore | null
}

// ─── Fuzzy membership helpers (exported for rule authors) ────────────────────

export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}

function lexicalCompare(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/** Rising ramp: 0 at/below `a`, 1 at/above `b`, linear between (a < b). */
export function fuzzyRising(x: number, a: number, b: number): number {
  if (!Number.isFinite(x)) return 0
  if (b <= a) return x >= b ? 1 : 0
  return clamp01((x - a) / (b - a))
}

/** Falling ramp: 1 at/below `a`, 0 at/above `b`, linear between (a < b). */
export function fuzzyFalling(x: number, a: number, b: number): number {
  if (!Number.isFinite(x)) return 0
  if (b <= a) return x <= a ? 1 : 0
  return clamp01((b - x) / (b - a))
}

/** Trapezoid: 0 below `a`, ramps to 1 over [a,b], holds to `c`, ramps to 0 over [c,d]. */
export function fuzzyTrapezoid(x: number, a: number, b: number, c: number, d: number): number {
  return Math.min(fuzzyRising(x, a, b), fuzzyFalling(x, c, d))
}

/** Weighted mean of confidence parts (ignores parts with weight ≤ 0). Result in [0,1]. */
export function combineConfidence(parts: { weight: number; value: number }[]): number {
  let wsum = 0
  let acc = 0
  for (const p of parts) {
    if (!(p.weight > 0)) continue
    wsum += p.weight
    acc += p.weight * clamp01(p.value)
  }
  return wsum > 0 ? clamp01(acc / wsum) : 0
}

// ─── Window & context aggregation ────────────────────────────────────────────

/** Rank a spotter side so we can pick the "busiest" one across a window. */
function sideRank(s: CarLeftRightState | undefined): number {
  switch (s) {
    case 'both':
      return 3
    case 'left':
    case 'right':
      return 2
    case 'clear':
      return 1
    default:
      return 0
  }
}

/** Pick the busiest side seen across the window (both > left/right > clear). */
function busiestSide(states: (CarLeftRightState | undefined)[]): CarLeftRightState | undefined {
  let best: CarLeftRightState | undefined
  let bestRank = -1
  for (const s of states) {
    const r = sideRank(s)
    if (r > bestRank) {
      bestRank = r
      best = s
    }
  }
  return best
}

function minDefined(vals: (number | undefined)[]): number | undefined {
  let best: number | undefined
  for (const v of vals) if (Number.isFinite(v) && (best === undefined || (v as number) < best)) best = v as number
  return best
}

function maxDefined(vals: (number | undefined)[]): number | undefined {
  let best: number | undefined
  for (const v of vals) if (Number.isFinite(v) && (best === undefined || (v as number) > best)) best = v as number
  return best
}

function anyTrue(vals: (boolean | undefined)[]): boolean | undefined {
  let seen = false
  for (const v of vals) {
    if (v === true) return true
    if (v === false) seen = true
  }
  return seen ? false : undefined
}

/**
 * Aggregate the per-sample context frames inside a window into ONE worst/most-
 * relevant context: busiest spotter side, closest gaps/radar, any flag/caution,
 * highest wear/temps, wettest/lowest grip, and the latest session/pace/fuel state.
 * This lets a rule ask "was there a car alongside anywhere in this corner?".
 */
export function mergeContext(samples: CoachLapSample[], startIdx: number, endIdx: number): CoachContextSample {
  const lo = Math.max(0, Math.min(startIdx, endIdx))
  const hi = Math.min(samples.length - 1, Math.max(startIdx, endIdx))
  const ctxs: CoachContextSample[] = []
  for (let i = lo; i <= hi; i += 1) {
    const c = samples[i]?.ctx
    if (c) ctxs.push(c)
  }
  if (ctxs.length === 0) return {}
  const last = ctxs[ctxs.length - 1]
  const merged: CoachContextSample = {}
  const side = busiestSide(ctxs.map((c) => c.carLeftRight))
  if (side !== undefined) merged.carLeftRight = side
  const along = maxDefined(ctxs.map((c) => c.carsAlongsideCount))
  if (along !== undefined) merged.carsAlongsideCount = along
  const gapA = minDefined(ctxs.map((c) => c.gapAheadSec))
  if (gapA !== undefined) merged.gapAheadSec = gapA
  const gapB = minDefined(ctxs.map((c) => c.gapBehindSec))
  if (gapB !== undefined) merged.gapBehindSec = gapB
  const radar = minDefined(ctxs.map((c) => c.radarClosestMeters))
  if (radar !== undefined) merged.radarClosestMeters = radar
  const yellow = anyTrue(ctxs.map((c) => c.flagYellow))
  if (yellow !== undefined) merged.flagYellow = yellow
  const blue = anyTrue(ctxs.map((c) => c.flagBlue))
  if (blue !== undefined) merged.flagBlue = blue
  const white = anyTrue(ctxs.map((c) => c.flagWhite))
  if (white !== undefined) merged.flagWhite = white
  const green = anyTrue(ctxs.map((c) => c.flagGreen))
  if (green !== undefined) merged.flagGreen = green
  const checkered = anyTrue(ctxs.map((c) => c.flagCheckered))
  if (checkered !== undefined) merged.flagCheckered = checkered
  const caution = anyTrue(ctxs.map((c) => c.caution))
  if (caution !== undefined) merged.caution = caution
  const onPit = anyTrue(ctxs.map((c) => c.onPitRoad))
  if (onPit !== undefined) merged.onPitRoad = onPit
  const raining = anyTrue(ctxs.map((c) => c.isRaining))
  if (raining !== undefined) merged.isRaining = raining
  const wet = maxDefined(ctxs.map((c) => c.trackWetnessPct))
  if (wet !== undefined) merged.trackWetnessPct = wet
  const grip = minDefined(ctxs.map((c) => c.gripPct))
  if (grip !== undefined) merged.gripPct = grip
  const wear = maxDefined(ctxs.map((c) => c.tyreWearMaxPct))
  if (wear !== undefined) merged.tyreWearMaxPct = wear
  const tyreTemp = maxDefined(ctxs.map((c) => c.tyreTempMaxC))
  if (tyreTemp !== undefined) merged.tyreTempMaxC = tyreTemp
  const brakeTemp = maxDefined(ctxs.map((c) => c.brakeTempMaxC))
  if (brakeTemp !== undefined) merged.brakeTempMaxC = brakeTemp
  // Session/pace/fuel/laps: take the latest sample's value (most current).
  const sessionState: SessionState | undefined = last.sessionState
  if (sessionState !== undefined) merged.sessionState = sessionState
  const paceMode: PaceMode | undefined = last.paceMode
  if (paceMode !== undefined) merged.paceMode = paceMode
  if (last.sessionType !== undefined) merged.sessionType = last.sessionType
  if (Number.isFinite(last.fuelLevelPct)) merged.fuelLevelPct = last.fuelLevelPct
  if (Number.isFinite(last.fuelPerLap)) merged.fuelPerLap = last.fuelPerLap
  if (Number.isFinite(last.lapsRemaining)) merged.lapsRemaining = last.lapsRemaining
  if (Number.isFinite(last.sessionTimeRemainingSec)) merged.sessionTimeRemainingSec = last.sessionTimeRemainingSec
  return merged
}

/** Locate the sample index range whose lapDistPct falls in the finding's zone. */
export function windowForZone(samples: CoachLapSample[], zoneStart: number, zoneEnd: number): { startIdx: number; endIdx: number } {
  const lo = Math.min(zoneStart, zoneEnd)
  const hi = Math.max(zoneStart, zoneEnd)
  let startIdx = -1
  let endIdx = -1
  for (let i = 0; i < samples.length; i += 1) {
    const pct = samples[i]?.lapDistPct
    if (!Number.isFinite(pct)) continue
    if ((pct as number) >= lo && (pct as number) <= hi) {
      if (startIdx === -1) startIdx = i
      endIdx = i
    }
  }
  if (startIdx === -1) {
    // Fallback: nearest sample to the zone midpoint so a rule still has context.
    const mid = (lo + hi) / 2
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < samples.length; i += 1) {
      const pct = samples[i]?.lapDistPct
      if (!Number.isFinite(pct)) continue
      const d = Math.abs((pct as number) - mid)
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    return { startIdx: bestIdx, endIdx: bestIdx }
  }
  return { startIdx, endIdx }
}

/** Build the full event context for a candidate finding (null when unusable). */
export function buildIntentEvent(finding: IntentCandidateFinding, samples: CoachLapSample[]): IntentEventContext | null {
  if (!Array.isArray(samples) || samples.length === 0) return null
  const window = windowForZone(samples, finding.zonePctStart, finding.zonePctEnd)
  const ctx = mergeContext(samples, window.startIdx, window.endIdx)
  return { finding, samples, window, ctx }
}

// ─── Registry ────────────────────────────────────────────────────────────────

/** Default confidence a legitimate intent needs to SUPPRESS a finding. The UI
 *  sensitivity slider adjusts the effective threshold around this. */
export const DEFAULT_INTENT_THRESHOLD = 0.6

export class DriverIntentRegistry {
  private rules = new Map<IntentId, IntentRule>()

  /** Register one rule. Throws on duplicate id so mistakes surface early. */
  register(rule: IntentRule): this {
    if (this.rules.has(rule.id)) throw new Error(`Duplicate driver-intent rule: ${rule.id}`)
    this.rules.set(rule.id, rule)
    return this
  }

  /** Register many rules at once. */
  registerAll(rules: IntentRule[]): this {
    for (const r of rules) this.register(r)
    return this
  }

  /** All registered rules (registration order). */
  list(): IntentRule[] {
    return [...this.rules.values()]
  }

  get size(): number {
    return this.rules.size
  }

  /**
   * Evaluate every rule over the event and aggregate into a decision. The winner
   * is the highest-confidence legitimate (non-error) intent; `isIntentional` is
   * true when that confidence ≥ `threshold`. Deterministic ordering: confidence
   * desc, then more evidence, then rule id for stability.
   */
  classify(event: IntentEventContext, opts: { threshold?: number } = {}): IntentEvaluation {
    const threshold = opts.threshold ?? DEFAULT_INTENT_THRESHOLD
    const candidates: IntentScore[] = []
    for (const rule of this.rules.values()) {
      let score: IntentScore | null = null
      try {
        score = rule.evaluate(event)
      } catch {
        score = null
      }
      if (score && score.category !== 'error' && score.confidence > 0) {
        candidates.push({ ...score, confidence: clamp01(score.confidence) })
      }
    }
    candidates.sort(
      (a, b) =>
        b.confidence - a.confidence ||
        b.evidence.length - a.evidence.length ||
        lexicalCompare(String(a.intent), String(b.intent))
    )
    const winner = candidates[0]
    if (!winner) {
      return { isIntentional: false, intent: 'none', category: 'error', confidence: 0, evidence: [], candidates }
    }
    return {
      isIntentional: winner.confidence >= threshold,
      intent: winner.intent,
      category: winner.category,
      confidence: winner.confidence,
      evidence: winner.evidence,
      candidates
    }
  }
}
