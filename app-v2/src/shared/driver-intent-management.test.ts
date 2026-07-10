import { describe, expect, it } from 'vitest'
import type { IntentEventContext, IntentRule } from './driver-intent'
import { MANAGEMENT_INTENT_RULES } from './driver-intent-management'

function rule(id: string): IntentRule {
  const found = MANAGEMENT_INTENT_RULES.find((r) => r.id === id)
  if (!found) throw new Error(`missing rule ${id}`)
  return found
}

function event(overrides: Partial<IntentEventContext> = {}): IntentEventContext {
  return {
    finding: {
      kind: 'coast',
      phase: 'exit',
      sector: 1,
      zonePctStart: 0.1,
      zonePctEnd: 0.2,
      estTimeLossSec: 0.4
    },
    samples: [],
    window: { startIdx: 0, endIdx: 0 },
    ctx: {},
    ...overrides
  }
}

describe('management driver intent rules', () => {
  it('fires lift-and-coast for low fuel near stint end', () => {
    const result = rule('lift-and-coast').evaluate(event({
      ctx: { fuelLevelPct: 0.18, lapsRemaining: 2.5, sessionState: 'racing' }
    }))

    expect(result?.intent).toBe('lift-and-coast')
    expect(result?.category).toBe('management')
    expect(result?.confidence).toBeGreaterThan(0.6)
    expect(result?.evidence.some((e) => e.signal === 'fuelLevelPct')).toBe(true)
  })

  it('returns null for high-fuel racing coast', () => {
    const result = rule('lift-and-coast').evaluate(event({
      ctx: { fuelLevelPct: 0.8, lapsRemaining: 12, sessionState: 'racing' }
    }))

    expect(result).toBeNull()
  })

  it('fires tyre-brake-save for a soft finding with hot brakes', () => {
    const result = rule('tyre-brake-save').evaluate(event({
      finding: {
        kind: 'throttle-hesitation',
        phase: 'exit',
        sector: 2,
        zonePctStart: 0.35,
        zonePctEnd: 0.42,
        estTimeLossSec: 0.25
      },
      ctx: { brakeTempMaxC: 720, tyreTempMaxC: 100, tyreWearMaxPct: 45, sessionState: 'racing' }
    }))

    expect(result?.intent).toBe('tyre-brake-save')
    expect(result?.confidence).toBeGreaterThan(0.7)
    expect(result?.evidence.some((e) => e.signal === 'brakeTempMaxC')).toBe(true)
  })

  it('returns null for tyre-brake-save when components are cool and unworn', () => {
    const result = rule('tyre-brake-save').evaluate(event({
      finding: {
        kind: 'steering-insufficient',
        phase: 'mid',
        sector: 1,
        zonePctStart: 0.2,
        zonePctEnd: 0.25,
        estTimeLossSec: 0.3
      },
      ctx: { brakeTempMaxC: 350, tyreTempMaxC: 82, tyreWearMaxPct: 20, sessionState: 'racing' }
    }))

    expect(result).toBeNull()
  })

  it('fires out-in-lap for warmup session state', () => {
    const result = rule('out-in-lap').evaluate(event({
      ctx: { sessionState: 'warmup', onPitRoad: false }
    }))

    expect(result?.intent).toBe('out-in-lap')
    expect(result?.confidence).toBeGreaterThanOrEqual(0.85)
    expect(result?.evidence.some((e) => e.signal === 'sessionState')).toBe(true)
  })

  it('returns null for out-in-lap during racing and not pit road', () => {
    const result = rule('out-in-lap').evaluate(event({
      ctx: { sessionState: 'racing', onPitRoad: false }
    }))

    expect(result).toBeNull()
  })
})
