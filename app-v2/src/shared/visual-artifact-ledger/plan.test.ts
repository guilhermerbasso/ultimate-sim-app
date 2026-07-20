import { describe, expect, it } from 'vitest'
import {
  APPROVED_EXACT_ARTIFACT_COUNT,
  BASE_ARTIFACT_COUNT,
  MIN_TOTAL_ARTIFACT_COUNT,
  MIN_TRIGGER_ARTIFACT_COUNT
} from './constants'
import {
  createArtifactPlan,
  expectedArtifactIds,
  expectedArtifactSetHash,
  parseArtifactPlan
} from './plan'
import { hashNumber, makePlan } from './test-fixtures'

describe('complete governed artifact plan', () => {
  it('builds the exact 50 × (1 + 143 + 143) base plus 500 triggers', () => {
    const plan = makePlan()
    const ids = expectedArtifactIds(plan)

    expect(plan.counts).toEqual({
      dashboards: 50,
      widgets: 7_150,
      ordinaryOverlays: 7_150,
      triggers: MIN_TRIGGER_ARTIFACT_COUNT,
      base: BASE_ARTIFACT_COUNT,
      total: MIN_TOTAL_ARTIFACT_COUNT
    })
    expect(ids).toHaveLength(MIN_TOTAL_ARTIFACT_COUNT)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toBe('va2:d:style-001')
    expect(ids.at(-1)).toBe('va2:t:style-050:trigger-10')
    expect(expectedArtifactSetHash(plan)).toMatch(/^[a-f0-9]{64}$/)
  })
  it('normalizes identity order deterministically without changing plan hash', () => {
    const plan = makePlan()
    const reordered = createArtifactPlan({
      registryHash: plan.registryHash,
      styles: [...plan.styles].reverse(),
      concepts: [...plan.concepts].reverse(),
      triggerFamilies: [...plan.triggerFamilies].reverse()
    })

    expect(reordered.planHash).toBe(plan.planHash)
    expect(expectedArtifactIds(reordered)).toEqual(expectedArtifactIds(plan))
  })

  it('creates the approved exact 16,600-artifact contract with 45 trigger families', () => {
    const plan = makePlan(45)
    const ids = expectedArtifactIds(plan)
    expect(plan.counts.triggers).toBe(2_250)
    expect(plan.counts.total).toBe(APPROVED_EXACT_ARTIFACT_COUNT)
    expect(ids).toHaveLength(APPROVED_EXACT_ARTIFACT_COUNT)
    expect(ids.at(-1)).toBe('va2:t:style-050:trigger-45')
  })

  it('constructs 16,650 and 17,000 headroom plans', () => {
    expect(makePlan(46).counts.total).toBe(16_650)
    expect(makePlan(53).counts.total).toBe(17_000)
  })

  it('rejects unknown plan and identity fields', () => {
    const plan = makePlan()
    expect(() =>
      createArtifactPlan({
        registryHash: plan.registryHash,
        styles: plan.styles,
        concepts: plan.concepts,
        triggerFamilies: plan.triggerFamilies,
        prompt: 'forbidden body'
      })
    ).toThrow(/unknown field "prompt"/i)

    const styles = plan.styles.map((identity, index) =>
      index === 0 ? { ...identity, alias: 'unknown' } : identity
    )
    expect(() =>
      createArtifactPlan({
        registryHash: plan.registryHash,
        styles,
        concepts: plan.concepts,
        triggerFamilies: plan.triggerFamilies
      })
    ).toThrow(/unknown field "alias"/i)
  })

  it('rejects accessor-backed and proxied identity arrays without invoking attacker code', () => {
    const plan = makePlan()
    const accessorStyles = [...plan.styles]
    let getterReads = 0
    Object.defineProperty(accessorStyles, 0, {
      enumerable: true,
      configurable: true,
      get: () => {
        getterReads += 1
        return plan.styles[0]
      }
    })

    expect(() =>
      createArtifactPlan({
        registryHash: plan.registryHash,
        styles: accessorStyles,
        concepts: plan.concepts,
        triggerFamilies: plan.triggerFamilies
      })
    ).toThrow(/data fields/i)
    expect(getterReads).toBe(0)

    let proxyTraps = 0
    const proxiedConcepts = new Proxy([...plan.concepts], {
      get: (target, property, receiver) => {
        proxyTraps += 1
        return Reflect.get(target, property, receiver)
      }
    })
    expect(() =>
      createArtifactPlan({
        registryHash: plan.registryHash,
        styles: plan.styles,
        concepts: proxiedConcepts,
        triggerFamilies: plan.triggerFamilies
      })
    ).toThrow(/proxi/i)
    expect(proxyTraps).toBe(0)
  })

  it('builds the plan without consulting inherited array iteration', () => {
    const plan = makePlan()
    const iteratorDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      Symbol.iterator
    )!
    let iteratorCalls = 0
    let recreatedHash = ''
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true,
      writable: true,
      value: () => {
        iteratorCalls += 1
        throw new Error('inherited array iterator executed')
      }
    })
    try {
      recreatedHash = createArtifactPlan({
        registryHash: plan.registryHash,
        styles: plan.styles,
        concepts: plan.concepts,
        triggerFamilies: plan.triggerFamilies
      }).planHash
    } finally {
      Object.defineProperty(
        Array.prototype,
        Symbol.iterator,
        iteratorDescriptor
      )
    }

    expect(recreatedHash).toBe(plan.planHash)
    expect(iteratorCalls).toBe(0)
  })

  it('rejects incomplete trigger coverage and plans above resource limits', () => {
    const plan = makePlan()
    expect(() =>
      createArtifactPlan({
        registryHash: plan.registryHash,
        styles: plan.styles,
        concepts: plan.concepts,
        triggerFamilies: plan.triggerFamilies.slice(0, 9)
      })
    ).toThrow(/at least 500 trigger artifacts/i)

    expect(() =>
      createArtifactPlan({
        registryHash: plan.registryHash,
        styles: plan.styles,
        concepts: plan.concepts,
        triggerFamilies: Array.from({ length: 114 }, (_, index) => ({
          id: `trigger-${String(index + 1).padStart(3, '0')}`,
          ordinal: index + 1
        }))
      })
    ).toThrow(/artifact plan total/i)
  })

  it('rejects plan hash, registry hash, and count tampering', () => {
    const plan = makePlan()
    expect(() => parseArtifactPlan({ ...plan, planHash: hashNumber(123) })).toThrow(/plan hash/i)
    expect(() => parseArtifactPlan({ ...plan, registryHash: hashNumber(124) })).toThrow(/plan hash/i)
    expect(() =>
      parseArtifactPlan({ ...plan, counts: { ...plan.counts, total: plan.counts.total - 1 } })
    ).toThrow(/count "total"/i)
  })
})
