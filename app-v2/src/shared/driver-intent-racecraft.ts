import type { CoachFindingKind } from './coach'
import type { IntentEventContext, IntentEvidence, IntentRule, IntentScore } from './driver-intent'
import { combineConfidence, fuzzyFalling, fuzzyRising } from './driver-intent'

const ATTACK_KINDS: Partial<Record<CoachFindingKind, number>> = {
  'brake-late': 1,
  'trail-brake-lock': 0.9,
  coast: 0.65
}

const DEFEND_KINDS: Partial<Record<CoachFindingKind, number>> = {
  'steering-insufficient': 1,
  'steering-busy': 0.9,
  coast: 0.75,
  'brake-early': 0.7
}

const AVOID_INCIDENT_KINDS: Partial<Record<CoachFindingKind, number>> = {
  coast: 0.95,
  'steering-busy': 0.9,
  'brake-early': 0.9
}

function finiteNumber(value: number | undefined): value is number {
  return Number.isFinite(value)
}

function score(
  intent: IntentScore['intent'],
  confidence: number,
  evidence: IntentEvidence[]
): IntentScore {
  return { intent, category: 'racecraft', confidence, evidence }
}

function gapDetail(label: string, gapSec: number): IntentEvidence {
  return {
    signal: label,
    detail: `${label === 'gapAheadSec' ? 'car ahead' : 'car behind'} within ${gapSec.toFixed(1)}s`
  }
}

const attackRule: IntentRule = {
  id: 'attack',
  category: 'racecraft',
  label: 'Attack / late-brake racecraft',
  signalsUsed: ['finding.kind', 'gapAheadSec'],
  evaluate(event: IntentEventContext): IntentScore | null {
    const kindScore = ATTACK_KINDS[event.finding.kind] ?? 0
    const gapAheadSec = event.ctx.gapAheadSec
    if (kindScore <= 0 || !finiteNumber(gapAheadSec)) return null

    const gapScore = fuzzyFalling(gapAheadSec, 0.4, 1.6)
    if (gapScore <= 0) return null

    const confidence = combineConfidence([
      { weight: 0.75, value: gapScore },
      { weight: 0.25, value: kindScore }
    ])
    return score('attack', confidence, [
      gapDetail('gapAheadSec', gapAheadSec),
      { signal: 'finding.kind', detail: `${event.finding.kind} matches late-brake/entry attack pattern` }
    ])
  }
}

const defendRule: IntentRule = {
  id: 'defend',
  category: 'racecraft',
  label: 'Defend / defensive line',
  signalsUsed: ['finding.kind', 'gapBehindSec'],
  evaluate(event: IntentEventContext): IntentScore | null {
    const kindScore = DEFEND_KINDS[event.finding.kind] ?? 0
    const gapBehindSec = event.ctx.gapBehindSec
    if (kindScore <= 0 || !finiteNumber(gapBehindSec)) return null

    const gapScore = fuzzyFalling(gapBehindSec, 0.4, 1.6)
    if (gapScore <= 0) return null

    const confidence = combineConfidence([
      { weight: 0.75, value: gapScore },
      { weight: 0.25, value: kindScore }
    ])
    return score('defend', confidence, [
      gapDetail('gapBehindSec', gapBehindSec),
      { signal: 'finding.kind', detail: `${event.finding.kind} matches defensive line/position pattern` }
    ])
  }
}

const sideBySideRule: IntentRule = {
  id: 'side-by-side',
  category: 'racecraft',
  label: 'Side-by-side / give room',
  signalsUsed: ['carLeftRight', 'carsAlongsideCount'],
  evaluate(event: IntentEventContext): IntentScore | null {
    const side = event.ctx.carLeftRight
    if (side !== 'left' && side !== 'right' && side !== 'both') return null

    const sideScore = side === 'both' ? 0.94 : 0.86
    const count = event.ctx.carsAlongsideCount
    const parts = [{ weight: 0.8, value: sideScore }]
    if (finiteNumber(count)) {
      parts.push({ weight: 0.2, value: 0.75 + 0.25 * fuzzyRising(count, 1, 2) })
    }
    const confidence = combineConfidence(parts)
    const sideDetail = side === 'both' ? 'cars alongside on both sides' : `car alongside on the ${side}`

    return score('side-by-side', confidence, [
      { signal: 'carLeftRight', detail: sideDetail },
      ...(finiteNumber(count) ? [{ signal: 'carsAlongsideCount', detail: `${count} car(s) alongside` }] : [])
    ])
  }
}

const avoidIncidentRule: IntentRule = {
  id: 'avoid-incident',
  category: 'racecraft',
  label: 'Avoid incident / survival move',
  signalsUsed: ['finding.kind', 'gapAheadSec', 'radarClosestMeters'],
  evaluate(event: IntentEventContext): IntentScore | null {
    const kindScore = AVOID_INCIDENT_KINDS[event.finding.kind] ?? 0
    if (kindScore <= 0) return null

    const gapAheadSec = event.ctx.gapAheadSec
    const radarClosestMeters = event.ctx.radarClosestMeters
    const aheadScore = finiteNumber(gapAheadSec) ? fuzzyFalling(gapAheadSec, 0.35, 0.75) : 0
    const radarScore = finiteNumber(radarClosestMeters) ? fuzzyFalling(radarClosestMeters, 4, 8) : 0
    const proximityScore = Math.max(aheadScore, radarScore)
    if (proximityScore <= 0) return null

    const confidence = combineConfidence([
      { weight: 0.8, value: proximityScore },
      { weight: 0.2, value: kindScore }
    ])
    const evidence: IntentEvidence[] = [
      { signal: 'finding.kind', detail: `${event.finding.kind} matches sudden lift/steer survival pattern` }
    ]
    if (finiteNumber(gapAheadSec)) evidence.push({ signal: 'gapAheadSec', detail: `car ahead very close at ${gapAheadSec.toFixed(1)}s` })
    if (finiteNumber(radarClosestMeters)) {
      evidence.push({ signal: 'radarClosestMeters', detail: `closest radar contact ${radarClosestMeters.toFixed(1)}m away` })
    }

    return score('avoid-incident', confidence, evidence)
  }
}

export const RACECRAFT_INTENT_RULES: IntentRule[] = [
  attackRule,
  defendRule,
  sideBySideRule,
  avoidIncidentRule
]
