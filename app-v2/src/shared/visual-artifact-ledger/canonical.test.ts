import { describe, expect, it } from 'vitest'
import {
  assertIdentifier,
  canonicalStringify,
  deepFreeze,
  sha256Hex,
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

  it('ignores inherited toJSON hooks and encodes only deterministic own data', () => {
    const objectDescriptor = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'toJSON'
    )
    const arrayDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      'toJSON'
    )
    Object.defineProperty(Object.prototype, 'toJSON', {
      configurable: true,
      value: () => ({ forged: 'object' })
    })
    Object.defineProperty(Array.prototype, 'toJSON', {
      configurable: true,
      value: () => ['forged-array']
    })
    try {
      const value = { items: [{ b: 2, a: 1 }] }
      expect(canonicalStringify(value)).toBe(
        '{"items":[{"a":1,"b":2}]}'
      )
      expect(sha256Hex(value)).toBe(
        sha256Hex({ items: [{ a: 1, b: 2 }] })
      )
      expect(() =>
        canonicalStringify({ toJSON: () => ({ forged: true }) })
      ).toThrow(/plain objects|JSON-compatible/i)
    } finally {
      if (objectDescriptor) {
        Object.defineProperty(Object.prototype, 'toJSON', objectDescriptor)
      } else {
        Reflect.deleteProperty(Object.prototype, 'toJSON')
      }
      if (arrayDescriptor) {
        Object.defineProperty(Array.prototype, 'toJSON', arrayDescriptor)
      } else {
        Reflect.deleteProperty(Array.prototype, 'toJSON')
      }
    }
  })

  it('does not consult inherited array iteration or string serialization helpers', () => {
    const iteratorDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      Symbol.iterator
    )!
    const charCodeAtDescriptor = Object.getOwnPropertyDescriptor(
      String.prototype,
      'charCodeAt'
    )!
    let iteratorCalls = 0
    let charCodeAtCalls = 0
    let serialized = ''
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true,
      writable: true,
      value: () => {
        iteratorCalls += 1
        throw new Error('inherited array iterator executed')
      }
    })
    Object.defineProperty(String.prototype, 'charCodeAt', {
      configurable: true,
      writable: true,
      value: () => {
        charCodeAtCalls += 1
        throw new Error('inherited string helper executed')
      }
    })
    try {
      serialized = canonicalStringify({ z: ['\u0800'], a: 1 })
    } finally {
      Object.defineProperty(
        Array.prototype,
        Symbol.iterator,
        iteratorDescriptor
      )
      Object.defineProperty(
        String.prototype,
        'charCodeAt',
        charCodeAtDescriptor
      )
    }

    expect(serialized).toBe('{"a":1,"z":["\u0800"]}')
    expect(iteratorCalls).toBe(0)
    expect(charCodeAtCalls).toBe(0)
  })

  it('rejects proxies and accessors without invoking their traps or getters', () => {
    let getterReads = 0
    const accessor = {} as Record<string, unknown>
    Object.defineProperty(accessor, 'value', {
      enumerable: true,
      get: () => {
        getterReads += 1
        return 'forged'
      }
    })
    expect(() => canonicalStringify(accessor)).toThrow(
      /plain object|data field/i
    )
    expect(getterReads).toBe(0)

    const accessorArray = [1]
    Object.defineProperty(accessorArray, '0', {
      enumerable: true,
      get: () => {
        getterReads += 1
        return 2
      }
    })
    expect(() => canonicalStringify(accessorArray)).toThrow(
      /enumerable data field/i
    )
    expect(getterReads).toBe(0)

    let proxyTraps = 0
    const proxy = new Proxy(
      { value: 1 },
      {
        getPrototypeOf: () => {
          proxyTraps += 1
          return Object.prototype
        },
        ownKeys: () => {
          proxyTraps += 1
          return ['value']
        },
        get: (target, key, receiver) => {
          proxyTraps += 1
          return Reflect.get(target, key, receiver)
        }
      }
    )
    expect(() => canonicalStringify(proxy)).toThrow(/Prox(?:y|ies)/i)
    expect(() => deepFreeze(proxy)).toThrow(/Proxy/i)
    expect(proxyTraps).toBe(0)
  })

  it('snapshots opaque attestations only from getter-free own data', () => {
    let reads = 0
    const accessor = {} as Record<string, unknown>
    Object.defineProperty(accessor, 'token', {
      enumerable: true,
      get: () => {
        reads += 1
        return `valid:${'a'.repeat(82)}`
      }
    })
    expect(() => parseOpaqueAttestation(accessor, 'attestation')).toThrow(
      /plain object/i
    )
    expect(reads).toBe(0)

    const proxy = new Proxy(
      { token: `valid:${'a'.repeat(82)}` },
      {
        get: (target, key, receiver) => {
          reads += 1
          return Reflect.get(target, key, receiver)
        }
      }
    )
    expect(() => parseOpaqueAttestation(proxy, 'attestation')).toThrow(
      /plain object/i
    )
    expect(reads).toBe(0)
  })
})
