import { describe, expect, it } from 'vitest'
import {
  assertIdentifier,
  canonicalStringify,
  utf8ByteLength
} from './canonical'
import { createArtifactPlan } from './plan'
import { makePlan } from './test-fixtures'

describe('bounded canonical validation', () => {
  it('preserves own __proto__ fields instead of collapsing distinct hashes', () => {
    const value = JSON.parse('{"safe":1,"__proto__":{"polluted":true}}') as unknown
    expect(canonicalStringify(value)).toBe(
      '{"__proto__":{"polluted":true},"safe":1}'
    )
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
  })
  it('rejects URI schemes and common opaque-secret shapes in identifiers', () => {
    for (const value of [
      'mailto:user@example.com',
      'ftp:example.com',
      'sk-proj-abcdef',
      'github_pat_abcdef'
    ]) {
      expect(() => assertIdentifier(value, 'test identifier')).toThrow(
        /forbidden URL, credential, or environment-secret/i
      )
    }
  })

  it('rejects sparse arrays before normalization and reports real UTF-8 bytes', () => {
    const plan = makePlan()
    const sparseStyles = new Array(50)
    expect(() =>
      createArtifactPlan({
        registryHash: plan.registryHash,
        styles: sparseStyles,
        concepts: plan.concepts,
        triggerFamilies: plan.triggerFamilies
      })
    ).toThrow(/cannot be sparse/i)
    expect(() => canonicalStringify(new Array(1))).toThrow(/cannot be sparse/i)
    expect(utf8ByteLength('\u0800')).toBe(3)
  })
})
