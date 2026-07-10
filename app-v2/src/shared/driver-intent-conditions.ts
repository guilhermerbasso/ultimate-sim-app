import type { CoachContextSample } from './coach'
import {
  clamp01,
  combineConfidence,
  fuzzyFalling,
  fuzzyRising,
  type IntentEvidence,
  type IntentRule,
  type IntentScore
} from './driver-intent'

function conditionsScore(intent: IntentScore['intent'], confidence: number, evidence: IntentEvidence[]): IntentScore | null {
  const c = clamp01(confidence)
  if (c <= 0) return null
  return { intent, category: 'conditions', confidence: c, evidence }
}

function hasSafetyCarDerivedSignal(ctx: CoachContextSample): boolean {
  return ctx.caution === true || (ctx.paceMode !== undefined && ctx.paceMode !== 'notPacing') || ctx.sessionState === 'paradeLaps'
}

export const CONDITIONS_INTENT_RULES: IntentRule[] = [
  {
    id: 'yellow-flag',
    category: 'conditions',
    label: 'Yellow flag',
    signalsUsed: ['flagYellow', 'caution'],
    evaluate: ({ ctx }) => {
      if (ctx.flagYellow !== true) return null
      return conditionsScore('yellow-flag', ctx.caution === true ? 0.95 : 0.9, [
        { signal: 'flagYellow', detail: 'yellow flag — lift' }
      ])
    }
  },
  {
    id: 'blue-flag',
    category: 'conditions',
    label: 'Blue flag',
    signalsUsed: ['flagBlue'],
    evaluate: ({ ctx }) => {
      if (ctx.flagBlue !== true) return null
      return conditionsScore('blue-flag', 0.9, [{ signal: 'flagBlue', detail: 'blue flag — yield to leaders' }])
    }
  },
  {
    id: 'white-last-lap',
    category: 'conditions',
    label: 'White flag / last lap',
    signalsUsed: ['flagWhite'],
    evaluate: ({ ctx }) => {
      if (ctx.flagWhite !== true) return null
      return conditionsScore('white-last-lap', 0.7, [{ signal: 'flagWhite', detail: 'white flag — last lap context' }])
    }
  },
  {
    id: 'safety-car',
    category: 'conditions',
    label: 'Safety car / pacing',
    signalsUsed: ['caution', 'paceMode', 'sessionState'],
    evaluate: ({ ctx }) => {
      if (!hasSafetyCarDerivedSignal(ctx)) return null
      const evidence: IntentEvidence[] = []
      if (ctx.caution === true) evidence.push({ signal: 'caution', detail: 'derived full-course caution / pace condition' })
      if (ctx.paceMode !== undefined && ctx.paceMode !== 'notPacing') {
        evidence.push({ signal: 'paceMode', detail: `${ctx.paceMode} — pacing, no racing moves` })
      }
      if (ctx.sessionState === 'paradeLaps') {
        evidence.push({ signal: 'sessionState', detail: 'parade laps — pre-racing pace phase' })
      }
      return conditionsScore('safety-car', 0.9, evidence)
    }
  },
  {
    id: 'wet-low-grip',
    category: 'conditions',
    label: 'Wet / low grip',
    signalsUsed: ['trackWetnessPct', 'isRaining', 'gripPct'],
    evaluate: ({ ctx }) => {
      const parts: { weight: number; value: number }[] = []
      const evidence: IntentEvidence[] = []

      if (Number.isFinite(ctx.trackWetnessPct)) {
        const wet = fuzzyRising(ctx.trackWetnessPct as number, 0.2, 0.6)
        if (wet > 0) {
          parts.push({ weight: 1, value: wet })
          evidence.push({ signal: 'trackWetnessPct', detail: `wetness ${(ctx.trackWetnessPct as number).toFixed(2)} — wet track` })
        }
      }
      if (ctx.isRaining === true) {
        parts.push({ weight: 1, value: 0.85 })
        evidence.push({ signal: 'isRaining', detail: 'rain active — reduced grip expected' })
      }
      if (Number.isFinite(ctx.gripPct)) {
        const lowGrip = fuzzyFalling(ctx.gripPct as number, 0.85, 0.98)
        if (lowGrip > 0) {
          parts.push({ weight: 1, value: lowGrip })
          evidence.push({ signal: 'gripPct', detail: `grip ${(ctx.gripPct as number).toFixed(2)} — low grip` })
        }
      }

      if (parts.length === 0) return null
      return conditionsScore('wet-low-grip', Math.min(0.9, combineConfidence(parts)), evidence)
    }
  },
  {
    id: 'track-limits',
    category: 'conditions',
    label: 'Track limits',
    signalsUsed: [],
    evaluate: () => {
      // TODO: Wire a direct off-track / track-limits signal once CoachContextSample exposes one
      // (for example from CarIdxTrackSurface). Keep null for now to avoid false suppression.
      return null
    }
  }
]
