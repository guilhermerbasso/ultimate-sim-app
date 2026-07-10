import { describe, expect, it } from 'vitest'
import type { CoachContextSample, CoachFindingKind } from './coach'
import type { IntentEventContext } from './driver-intent'
import { RACECRAFT_INTENT_RULES } from './driver-intent-racecraft'

function event(kind: CoachFindingKind, ctx: CoachContextSample = {}): IntentEventContext {
  return {
    finding: {
      kind,
      sector: 1,
      corner: undefined,
      zonePctStart: 0.2,
      zonePctEnd: 0.25,
      estTimeLossSec: 0.12
    },
    samples: [],
    window: { startIdx: 0, endIdx: 0 },
    ctx
  }
}

function rule(id: string) {
  const found = RACECRAFT_INTENT_RULES.find((r) => r.id === id)
  if (!found) throw new Error(`missing rule ${id}`)
  return found
}

describe('RACECRAFT_INTENT_RULES', () => {
  it('detects attack when late braking with a close car ahead', () => {
    const result = rule('attack').evaluate(event('brake-late', { gapAheadSec: 0.5 }))

    expect(result?.intent).toBe('attack')
    expect(result?.category).toBe('racecraft')
    expect(result?.confidence).toBeGreaterThanOrEqual(0.8)
    expect(result?.evidence.some((e) => e.signal === 'gapAheadSec')).toBe(true)
  })

  it('keeps attack null without a close car ahead', () => {
    expect(rule('attack').evaluate(event('brake-late', {}))).toBeNull()
    expect(rule('attack').evaluate(event('brake-late', { gapAheadSec: 2.2 }))).toBeNull()
  })

  it('detects defend when steering/off-line behavior happens with a close car behind', () => {
    const result = rule('defend').evaluate(event('steering-insufficient', { gapBehindSec: 0.6 }))

    expect(result?.intent).toBe('defend')
    expect(result?.confidence).toBeGreaterThan(0.7)
    expect(result?.evidence.some((e) => e.signal === 'gapBehindSec')).toBe(true)
  })

  it('keeps defend null without a close car behind', () => {
    expect(rule('defend').evaluate(event('steering-busy', {}))).toBeNull()
    expect(rule('defend').evaluate(event('steering-busy', { gapBehindSec: 1.8 }))).toBeNull()
  })

  it('detects side-by-side and names the occupied side', () => {
    const result = rule('side-by-side').evaluate(event('steering-insufficient', { carLeftRight: 'both', carsAlongsideCount: 2 }))

    expect(result?.intent).toBe('side-by-side')
    expect(result?.confidence).toBeGreaterThanOrEqual(0.9)
    expect(result?.evidence.map((e) => e.detail).join(' ')).toContain('both sides')
  })

  it('keeps side-by-side null when the spotter side is clear or absent', () => {
    expect(rule('side-by-side').evaluate(event('coast', {}))).toBeNull()
    expect(rule('side-by-side').evaluate(event('coast', { carLeftRight: 'clear' }))).toBeNull()
  })

  it('detects avoid-incident with high confidence for a survival lift near traffic', () => {
    const result = rule('avoid-incident').evaluate(event('coast', { gapAheadSec: 0.3, radarClosestMeters: 3.5 }))

    expect(result?.intent).toBe('avoid-incident')
    expect(result?.confidence).toBeGreaterThanOrEqual(0.85)
    expect(result?.evidence.some((e) => e.signal === 'radarClosestMeters')).toBe(true)
  })

  it('keeps avoid-incident null without very close traffic', () => {
    expect(rule('avoid-incident').evaluate(event('coast', {}))).toBeNull()
    expect(rule('avoid-incident').evaluate(event('coast', { gapAheadSec: 1.2, radarClosestMeters: 12 }))).toBeNull()
  })

  it('keeps a plain coast with empty context null across all racecraft rules', () => {
    const plainCoast = event('coast', {})

    expect(RACECRAFT_INTENT_RULES.map((r) => r.evaluate(plainCoast))).toEqual([null, null, null, null])
  })
})
