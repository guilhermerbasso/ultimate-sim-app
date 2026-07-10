import { describe, expect, it } from 'vitest'
import type { CoachContextSample } from './coach'
import type { IntentEventContext, IntentId } from './driver-intent'
import { CONDITIONS_INTENT_RULES } from './driver-intent-conditions'

function event(ctx: CoachContextSample): IntentEventContext {
  return {
    finding: {
      kind: 'brake-early',
      sector: 1,
      zonePctStart: 0.1,
      zonePctEnd: 0.2,
      estTimeLossSec: 0.2
    },
    samples: [],
    window: { startIdx: 0, endIdx: 0 },
    ctx
  }
}

function rule(id: IntentId) {
  const found = CONDITIONS_INTENT_RULES.find((r) => r.id === id)
  if (!found) throw new Error(`Missing rule ${id}`)
  return found
}

describe('CONDITIONS_INTENT_RULES', () => {
  it('returns null for every rule in dry green-flag context', () => {
    const dryGreen = event({
      flagGreen: true,
      flagYellow: false,
      flagBlue: false,
      flagWhite: false,
      caution: false,
      paceMode: 'notPacing',
      sessionState: 'racing',
      trackWetnessPct: 0,
      gripPct: 1,
      isRaining: false
    })

    for (const r of CONDITIONS_INTENT_RULES) {
      expect(r.evaluate(dryGreen), r.id).toBeNull()
    }
  })

  it('fires yellow-flag when yellow flag is active', () => {
    const score = rule('yellow-flag').evaluate(event({ flagYellow: true }))

    expect(score?.intent).toBe('yellow-flag')
    expect(score?.category).toBe('conditions')
    expect(score?.confidence).toBe(0.9)
    expect(score?.evidence[0]?.detail).toContain('yellow flag')
  })

  it('returns null for yellow-flag when yellow flag is absent', () => {
    expect(rule('yellow-flag').evaluate(event({ flagYellow: false }))).toBeNull()
  })

  it('raises yellow-flag confidence when caution also applies', () => {
    expect(rule('yellow-flag').evaluate(event({ flagYellow: true, caution: true }))?.confidence).toBe(0.95)
  })

  it('fires blue-flag when blue flag is active', () => {
    const score = rule('blue-flag').evaluate(event({ flagBlue: true }))

    expect(score?.intent).toBe('blue-flag')
    expect(score?.confidence).toBe(0.9)
    expect(score?.evidence[0]?.detail).toContain('yield')
  })

  it('returns null for blue-flag when blue flag is absent', () => {
    expect(rule('blue-flag').evaluate(event({ flagBlue: false }))).toBeNull()
  })

  it('fires white-last-lap as a weaker last-lap suppressor', () => {
    const score = rule('white-last-lap').evaluate(event({ flagWhite: true }))

    expect(score?.intent).toBe('white-last-lap')
    expect(score?.confidence).toBe(0.7)
    expect(score?.evidence[0]?.detail).toContain('last lap')
  })

  it('returns null for white-last-lap when white flag is absent', () => {
    expect(rule('white-last-lap').evaluate(event({ flagWhite: false }))).toBeNull()
  })

  it('fires safety-car from derived pace mode', () => {
    const score = rule('safety-car').evaluate(event({ paceMode: 'singleFileRestart' }))

    expect(score?.intent).toBe('safety-car')
    expect(score?.confidence).toBe(0.9)
    expect(score?.evidence.map((e) => e.signal)).toContain('paceMode')
  })

  it('returns null for safety-car when not pacing and racing normally', () => {
    expect(rule('safety-car').evaluate(event({ caution: false, paceMode: 'notPacing', sessionState: 'racing' }))).toBeNull()
  })

  it('fires wet-low-grip for moderate wetness', () => {
    const score = rule('wet-low-grip').evaluate(event({ trackWetnessPct: 0.5 }))

    expect(score?.intent).toBe('wet-low-grip')
    expect(score?.confidence).toBeCloseTo(0.75)
    expect(score?.evidence[0]?.signal).toBe('trackWetnessPct')
  })

  it('returns null for wet-low-grip when dry, not raining and full grip', () => {
    expect(rule('wet-low-grip').evaluate(event({ trackWetnessPct: 0, isRaining: false, gripPct: 1 }))).toBeNull()
  })

  it('keeps track-limits wired as a null stub until a direct signal exists', () => {
    expect(rule('track-limits').evaluate(event({}))).toBeNull()
  })
})
