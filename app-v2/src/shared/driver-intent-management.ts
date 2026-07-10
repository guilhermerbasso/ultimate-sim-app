import {
  clamp01,
  combineConfidence,
  fuzzyFalling,
  fuzzyRising,
  fuzzyTrapezoid,
  type IntentEventContext,
  type IntentEvidence,
  type IntentRule,
  type IntentScore
} from './driver-intent'
import type { CoachFindingKind, CoachPhase } from './coach'

const SOFT_SAVE_FINDINGS: ReadonlySet<CoachFindingKind> = new Set<CoachFindingKind>([
  'coast',
  'steering-insufficient',
  'throttle-hesitation'
])

function finiteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x)
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`
}

function celsius(x: number): string {
  return `${Math.round(x)}°C`
}

function score(intent: IntentScore['intent'], confidence: number, evidence: IntentEvidence[]): IntentScore | null {
  const c = clamp01(confidence)
  return c > 0 ? { intent, category: 'management', confidence: c, evidence } : null
}

function phaseConfidence(phase: CoachPhase | undefined): number {
  if (phase === 'exit') return 1
  if (phase === 'mid') return 0.75
  if (phase === 'entry') return 0.45
  return 0.85
}

function liftAndCoastRule(): IntentRule {
  return {
    id: 'lift-and-coast',
    category: 'management',
    label: 'Lift-and-coast fuel saving',
    signalsUsed: ['finding.kind', 'finding.phase', 'fuelLevelPct', 'lapsRemaining'],
    evaluate(event: IntentEventContext): IntentScore | null {
      try {
        if (event.finding.kind !== 'coast') return null

        const evidence: IntentEvidence[] = [{ signal: 'finding.kind', detail: 'lift-and-coast candidate' }]
        const fuel = event.ctx.fuelLevelPct
        const laps = event.ctx.lapsRemaining
        const fuelSave =
          finiteNumber(fuel) ? fuzzyFalling(fuel, 0.12, 0.35) : 0
        const stintEnd =
          finiteNumber(laps) ? fuzzyFalling(laps, 1, 4) : 0
        const managementNeed = Math.max(fuelSave, stintEnd)

        if (managementNeed < 0.3) return null

        if (finiteNumber(fuel)) evidence.push({ signal: 'fuelLevelPct', detail: `fuel ${pct(fuel)} near stint end` })
        if (finiteNumber(laps)) evidence.push({ signal: 'lapsRemaining', detail: `${laps.toFixed(1)} laps remaining` })
        if (event.finding.phase) evidence.push({ signal: 'finding.phase', detail: `${event.finding.phase} phase coast` })

        const confidence = combineConfidence([
          { weight: 0.45, value: 1 },
          { weight: 0.45, value: managementNeed },
          { weight: 0.1, value: phaseConfidence(event.finding.phase) }
        ])

        return score('lift-and-coast', confidence, evidence)
      } catch {
        return null
      }
    }
  }
}

function tyreBrakeSaveRule(): IntentRule {
  return {
    id: 'tyre-brake-save',
    category: 'management',
    label: 'Tyre/brake saving',
    signalsUsed: ['finding.kind', 'estTimeLossSec', 'tyreWearMaxPct', 'tyreTempMaxC', 'brakeTempMaxC'],
    evaluate(event: IntentEventContext): IntentScore | null {
      try {
        if (!SOFT_SAVE_FINDINGS.has(event.finding.kind)) return null

        const evidence: IntentEvidence[] = [{ signal: 'finding.kind', detail: `soft reduced-pace finding: ${event.finding.kind}` }]
        const wear = event.ctx.tyreWearMaxPct
        const tyreTemp = event.ctx.tyreTempMaxC
        const brakeTemp = event.ctx.brakeTempMaxC
        const wearScore = finiteNumber(wear) ? fuzzyRising(wear, 60, 95) : 0
        const tyreTempScore = finiteNumber(tyreTemp) ? fuzzyRising(tyreTemp, 95, 115) : 0
        const brakeTempScore = finiteNumber(brakeTemp) ? fuzzyRising(brakeTemp, 550, 750) : 0
        const componentNeed = Math.max(wearScore, tyreTempScore, brakeTempScore)

        if (componentNeed < 0.3) return null

        if (finiteNumber(wear) && wearScore === componentNeed) {
          evidence.push({ signal: 'tyreWearMaxPct', detail: `tyres worn ${Math.round(wear)}%` })
        }
        if (finiteNumber(tyreTemp) && tyreTempScore === componentNeed) {
          evidence.push({ signal: 'tyreTempMaxC', detail: `tyres hot at ${celsius(tyreTemp)}` })
        }
        if (finiteNumber(brakeTemp) && brakeTempScore === componentNeed) {
          evidence.push({ signal: 'brakeTempMaxC', detail: `brakes hot at ${celsius(brakeTemp)}` })
        }

        const loss = event.finding.estTimeLossSec
        const lowLoss = finiteNumber(loss) ? fuzzyTrapezoid(loss, -0.01, 0, 0.8, 1.5) : 0.6
        if (finiteNumber(loss)) evidence.push({ signal: 'estTimeLossSec', detail: `${loss.toFixed(2)}s low-loss management pace` })

        const confidence = combineConfidence([
          { weight: 0.35, value: 1 },
          { weight: 0.5, value: componentNeed },
          { weight: 0.15, value: lowLoss }
        ])

        return score('tyre-brake-save', confidence, evidence)
      } catch {
        return null
      }
    }
  }
}

function outInLapRule(): IntentRule {
  return {
    id: 'out-in-lap',
    category: 'management',
    label: 'Out-lap / in-lap / warm-up / cool-down',
    signalsUsed: ['sessionState', 'onPitRoad'],
    evaluate(event: IntentEventContext): IntentScore | null {
      try {
        const state = event.ctx.sessionState
        const evidence: IntentEvidence[] = []
        const confidenceParts: { weight: number; value: number }[] = []

        if (state === 'warmup' || state === 'paradeLaps' || state === 'getInCar' || state === 'coolDown') {
          evidence.push({ signal: 'sessionState', detail: `${state} session phase, no coaching` })
          confidenceParts.push({ weight: 1, value: state === 'warmup' || state === 'paradeLaps' ? 0.9 : 0.85 })
        }
        if (event.ctx.onPitRoad === true) {
          evidence.push({ signal: 'onPitRoad', detail: 'car is on pit road / out-in lap' })
          confidenceParts.push({ weight: 1, value: 0.95 })
        }

        if (confidenceParts.length === 0) return null

        return score('out-in-lap', combineConfidence(confidenceParts), evidence)
      } catch {
        return null
      }
    }
  }
}

function mechanicalRule(): IntentRule {
  return {
    id: 'mechanical',
    category: 'management',
    label: 'Mechanical damage caution',
    signalsUsed: ['mechanicalDamage'],
    evaluate(event: IntentEventContext): IntentScore | null {
      try {
        // TODO: Wire to an explicit future damage/meatball/repair-required context flag.
        // Until that signal exists, never infer mechanical intent from weak proxies.
        const futureCtx = event.ctx as typeof event.ctx & { mechanicalDamage?: boolean }
        if (futureCtx.mechanicalDamage !== true) return null

        return score('mechanical', 0.9, [
          { signal: 'mechanicalDamage', detail: 'explicit mechanical damage flag set' }
        ])
      } catch {
        return null
      }
    }
  }
}

export const MANAGEMENT_INTENT_RULES: IntentRule[] = [
  liftAndCoastRule(),
  tyreBrakeSaveRule(),
  outInLapRule(),
  mechanicalRule()
]
