import { describe, expect, it } from 'vitest'
import {
  assertIdentifier,
  canonicalStringify,
  utf8ByteLength
} from './canonical'
import { parseOpaqueAttestation } from './authorities'
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
      'github_pat_abcdef',
      'x:sk-proj-abcdef',
      'prefix:mailto:user@example.com',
      'x:token'
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

  it('restricts opaque attestations to bounded ASCII encoding', () => {
    expect(() =>
      parseOpaqueAttestation({ token: `valid:${'a'.repeat(82)}` }, 'attestation')
    ).not.toThrow()
    expect(() =>
      parseOpaqueAttestation({ token: `bad:${'\ud800'.repeat(80)}` }, 'attestation')
    ).toThrow(/bounded ASCII attestation encoding/i)
  })

  it('rejects unpaired UTF-16 surrogates before canonical expansion', () => {
    expect(() => canonicalStringify({ value: '\ud800' })).toThrow(
      /unpaired UTF-16 surrogates/i
    )
    expect(() => canonicalStringify({ ['\ud800']: 1 })).toThrow(
      /unpaired UTF-16 surrogates/i
    )
    expect(() => canonicalStringify(JSON.parse('{"\\ud800":1}'))).toThrow(
      /unpaired UTF-16 surrogates/i
    )
  })
})
