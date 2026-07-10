// The DECISION CORE — the "golden rule" gate that turns a list of candidate loss
// findings into (a) real errors worth speaking, (b) neutral CONTEXT (a deliberate
// choice the intent classifier recognized), or (c) SILENCE (dropped). It is the
// bridge between the deterministic analyzer (analyzeLap) and the driver-intent
// registry. See docs/coach-intent-research.md §4.
//
// GOLDEN RULE — a candidate loss becomes a spoken finding only when:
//   1. NO legitimate intent explains it with confidence ≥ intentThreshold, AND
//   2. it REPEATS lap-to-lap (when a personal baseline is available), AND
//   3. there is real measured time loss,
// and the resulting error-confidence is ≥ the (UI-tunable) minConfidence. Otherwise
// the event is demoted to context or silenced. Silence > noise.
//
// ZERO-REGRESSION GUARANTEE: when NO sample carries a context frame AND no baseline
// is supplied (e.g. legacy/hand-built laps in the existing test-suite), the gate is
// a pure no-op and returns the findings untouched.
//
// PURE + dependency-light (`import type` from coach so there is no runtime cycle).

import type { CoachFinding, CoachLapSample } from './coach'
import type { CoachBaseline } from './coach-baseline'
import { isRepeated } from './coach-baseline'
import {
  buildIntentEvent,
  combineConfidence,
  DEFAULT_INTENT_THRESHOLD,
  fuzzyRising,
  type DriverIntentRegistry
} from './driver-intent'

export interface IntentGateOptions {
  /** Confidence a legitimate intent needs to SUPPRESS a finding (default 0.6). */
  intentThreshold?: number
  /** Min error-confidence to KEEP (speak) an error finding (default 0.4). Higher =
   *  stricter = more silence. The UI sensitivity slider maps onto this. */
  minConfidence?: number
  /** Personal baseline (car+track) enabling lap-to-lap repetition gating. */
  baseline?: CoachBaseline
  /** Current lap number (diagnostic only). */
  lap?: number
}

/** Default min error-confidence to keep a finding audible. */
export const DEFAULT_MIN_CONFIDENCE = 0.4

/**
 * Map a user-facing SENSITIVITY (0..1) to the gate's `minConfidence`. Higher
 * sensitivity → lower minConfidence → the coach speaks more (less silence). The
 * default sensitivity 0.6 maps to the default minConfidence 0.4.
 */
export function sensitivityToMinConfidence(sensitivity: number): number {
  const s = Number.isFinite(sensitivity) ? Math.max(0, Math.min(1, sensitivity)) : 0.6
  return Math.max(0.05, Math.min(0.9, 0.7 - 0.5 * s))
}

/** A stable key for a finding's (kind, corner|sector) — shared by the gate and the
 *  baseline's repetition tracker so "same event lap-to-lap" lines up. */
export function eventKeyForFinding(f: Pick<CoachFinding, 'kind' | 'corner' | 'sector'>): string {
  return `${f.kind}:${f.corner !== undefined ? `c${f.corner}` : `s${f.sector}`}`
}

/** A loss finding is a candidate for the intent gate; good/gain/zero-loss are not. */
function isLossCandidate(f: CoachFinding): boolean {
  return f.sign === 'loss' && f.severity !== 'good' && f.estTimeLossSec > 0
}

/**
 * Apply the golden-rule gate to a lap's findings. Returns a NEW array; input
 * findings are not mutated (context/error findings are shallow-cloned with the
 * intent metadata attached; silenced findings are omitted).
 */
export function applyIntentGate(
  findings: CoachFinding[],
  samples: CoachLapSample[],
  registry: DriverIntentRegistry,
  opts: IntentGateOptions = {}
): CoachFinding[] {
  const hasContext = Array.isArray(samples) && samples.some((s) => s?.ctx !== undefined)
  // Zero-regression no-op: nothing to reason about → leave findings untouched.
  if (!hasContext && !opts.baseline) return findings

  const intentThreshold = opts.intentThreshold ?? DEFAULT_INTENT_THRESHOLD
  const minConfidence = opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE
  const out: CoachFinding[] = []

  for (const f of findings) {
    if (!isLossCandidate(f)) {
      out.push(f)
      continue
    }
    const event = buildIntentEvent(
      {
        kind: f.kind,
        sector: f.sector,
        corner: f.corner,
        zonePctStart: f.zonePctStart,
        zonePctEnd: f.zonePctEnd,
        estTimeLossSec: f.estTimeLossSec,
        phase: f.phase
      },
      samples
    )
    if (!event) {
      out.push(f)
      continue
    }

    const evaln = registry.classify(event, { threshold: intentThreshold })

    // Repetition weight: with a baseline, a repeated event is much more likely a
    // real error; a one-off is likely noise. Without a baseline we cannot confirm
    // repetition, so we neither strongly confirm nor suppress (0.7).
    let repetitionWeight = 0.7
    if (opts.baseline) {
      repetitionWeight = isRepeated(opts.baseline.repetition, eventKeyForFinding(f)) ? 1 : 0.3
    }

    const notIntentional = 1 - evaln.confidence
    const lossWeight = fuzzyRising(f.estTimeLossSec, 0.05, 0.3)
    const errorConfidence = combineConfidence([
      { weight: 2, value: notIntentional },
      { weight: 1, value: lossWeight },
      { weight: 1, value: repetitionWeight }
    ])

    if (evaln.isIntentional) {
      // A legitimate intent explains it → demote to neutral CONTEXT (never spoken as
      // a mistake). Keep the row for optional display, but neutralize its severity/sign
      // so ranking + spoken paths skip it.
      out.push({
        ...f,
        confidence: errorConfidence,
        intent: evaln.intent,
        intentCategory: evaln.category,
        intentEvidence: evaln.evidence.map((e) => e.detail),
        context: true,
        severity: 'good',
        sign: undefined,
        estTimeDeltaSec: 0
      })
      continue
    }

    // No intent explains it → a candidate ERROR. Attach confidence + what was ruled
    // out (for grounded phrasing). Silence low-confidence errors entirely.
    if (errorConfidence < minConfidence) {
      continue
    }
    out.push({
      ...f,
      confidence: errorConfidence,
      intentEvidence:
        evaln.candidates.length > 0
          ? evaln.candidates.slice(0, 2).map((c) => `ruled out ${c.intent} (${Math.round(c.confidence * 100)}%)`)
          : undefined
    })
  }

  return out
}

/** Collect the event keys of this lap's loss/context findings, for the baseline's
 *  repetition tracker (call recordLapEvents with the result). */
export function findingEventKeys(findings: CoachFinding[]): string[] {
  return findings.filter((f) => f.sign === 'loss' || f.context === true).map((f) => eventKeyForFinding(f))
}
