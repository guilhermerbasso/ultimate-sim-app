import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { JsonValue } from '@bufbuild/protobuf'
import {
  decodeRaceOpsCloudEvent,
  decodeRaceOpsEvent,
  decodeStintPassport,
  decodeStintPassportN1,
  encodeRaceOpsEvent,
  encodeStintPassport,
  phase02ContractRuntime,
  raceOpsEventFromProtoJson,
  raceOpsEventToCloudEvent,
  raceOpsEventToProtoJson,
  stintPassportFromProtoJson,
  stintPassportProtoJson
} from './raceops-codec'

const testdata = join(process.cwd(), '..', 'contracts', 'testdata')

function json(name: string): JsonValue {
  return JSON.parse(readFileSync(join(testdata, name), 'utf8')) as JsonValue
}

function binary(name: string): Uint8Array {
  return Uint8Array.from(readFileSync(join(testdata, name)))
}

describe('canonical Phase 02 RaceOps runtime mapping', () => {
  it('round-trips every canonical RaceOpsEvent field through ProtoJSON and binary', () => {
    const source = raceOpsEventFromProtoJson(json('race-ops-event-v1.json'))
    const encoded = encodeRaceOpsEvent(source)
    expect(encoded).toEqual(binary('race-ops-event-v1.binpb'))
    const decoded = decodeRaceOpsEvent(encoded)
    expect(decoded).toEqual(source)
    expect(raceOpsEventFromProtoJson(raceOpsEventToProtoJson(decoded))).toEqual(source)
    expect(Object.keys(decoded).sort()).toEqual([
      'actorRef',
      'approvalRef',
      'capabilityRef',
      'confidence',
      'consentEpoch',
      'correlationId',
      'dedupeKey',
      'eventClass',
      'eventId',
      'eventType',
      'evidenceRefs',
      'facts',
      'integrityFlags',
      'observedInterval',
      'observedMonotonicNs',
      'partitionKey',
      'partitionSeq',
      'policyRef',
      'priority',
      'privacyClass',
      'sequence',
      'sessionRef',
      'severity',
      'sourceTick',
      'subjectRef',
      'supersedesEventId',
      'telemetryContext',
      'ttlMs'
    ])
    expect(decoded.facts.map((fact) => fact.value?.kind)).toEqual(
      expect.arrayContaining(['double', 'unsigned', 'signed', 'bool', 'string', 'bytes', undefined])
    )
    expect(decoded.facts.every((fact) =>
      fact.provenance &&
      fact.provenance.validity &&
      fact.provenance.nullReason &&
      fact.provenance.ageMs !== '' &&
      fact.provenance.canonicalUnit === fact.canonicalUnit
    )).toBe(true)
  })

  it('wraps and validates the binary payload with the CloudEvents profile', () => {
    const event = raceOpsEventFromProtoJson(json('race-ops-event-v1.json'))
    const envelope = raceOpsEventToCloudEvent(event, {
      source: 'urn:ultimate-sim:test',
      producerId: 'golden-test',
      causationId: 'cause:1',
      timeMs: 1_000
    })
    expect(envelope.schemafp).toBe(phase02ContractRuntime.descriptorSha256)
    expect(envelope.sequence).toBe(event.sequence)
    expect(envelope.stale).toBe(true)
    expect(envelope.gap).toBe(true)
    expect(envelope.derived).toBe(true)
    expect(decodeRaceOpsCloudEvent(envelope)).toEqual(event)
    expect(() => decodeRaceOpsCloudEvent({ ...envelope, sequence: '1000' })).toThrow(/does not match/i)
    expect(() => decodeRaceOpsCloudEvent({ ...envelope, privacyclass: 'D0' })).toThrow(/does not match/i)
  })

  it('rejects unknown or future canonical enum and version values', () => {
    const eventJson = json('race-ops-event-v1.json') as Record<string, unknown>
    expect(() => raceOpsEventFromProtoJson({
      ...eventJson,
      eventClass: 'RACE_OPS_EVENT_CLASS_FUTURE'
    })).toThrow(/unknown or future/i)
    const passportJson = json('stint-passport-v1.json') as Record<string, unknown>
    expect(() => stintPassportFromProtoJson({
      ...passportJson,
      contractVersion: 2
    })).toThrow(/unsupported/i)
    const items = structuredClone(passportJson.items) as Array<Record<string, unknown>>
    items[0].itemId = 'PASSPORT_ITEM_ID_FUTURE'
    expect(() => stintPassportFromProtoJson({ ...passportJson, items } as unknown as JsonValue)).toThrow(/unknown or future/i)
    const roleItems = structuredClone(passportJson.items) as Array<Record<string, unknown>>
    roleItems[0].owner = { memberId: 'member', role: 'PASSPORT_ROLE_FUTURE' }
    expect(() => stintPassportFromProtoJson({ ...passportJson, items: roleItems } as unknown as JsonValue)).toThrow(/unknown or future/i)
  })
})

describe('Stint Passport ProtoJSON/binary compatibility', () => {
  it('round-trips the 12-item v1 golden fixture exactly', () => {
    const decoded = decodeStintPassport(binary('stint-passport-v1.binpb'))
    const jsonDecoded = stintPassportFromProtoJson(json('stint-passport-v1.json'))
    expect(decoded.items).toHaveLength(12)
    expect(decoded.coverage).toBe(1)
    expect(decoded).toEqual(jsonDecoded)
    expect(encodeStintPassport(decoded)).toEqual(binary('stint-passport-v1.binpb'))
    expect(stintPassportFromProtoJson(stintPassportProtoJson(decoded))).toEqual(decoded)
  })

  it('preserves a reason code independently from the human override reason', () => {
    const decoded = decodeStintPassport(binary('stint-passport-v1.binpb'))
    const passport = {
      ...decoded,
      items: decoded.items.map((item) => item.id === 'fuel-load'
        ? {
            ...item,
            overrideReason: 'Fuel checked by the assigned engineer.',
            reasonCode: 'MANUAL_FUEL_CHECK'
          }
        : item)
    }

    expect(decodeStintPassport(encodeStintPassport(passport))).toEqual(passport)
    expect(stintPassportFromProtoJson(stintPassportProtoJson(passport))).toEqual(passport)
  })

  it('decodes the N-1 sparse fixture with additive defaults', () => {
    const decoded = decodeStintPassportN1(binary('stint-passport-n-1.binpb'))
    expect(decoded.contractVersion).toBe(1)
    expect(decoded.identity.stintId).toBe('stint-n-1')
    expect(decoded.items).toHaveLength(12)
    expect(decoded.items[0].status).toBe('verified')
    expect(decoded.coverage).toBeCloseTo(1 / 12)
    expect(decoded.items.filter((item) => item.status === 'unknown').length).toBeGreaterThan(0)
    expect(() => decodeStintPassport(binary('stint-passport-n-1.binpb'))).toThrow()
  })
})

describe('bounded hostile inputs', () => {
  it('[supported] rejects empty, truncated, malformed-wire, and overlong RaceOps binary', () => {
    const golden = binary('race-ops-event-v1.binpb')
    const cases = [
      { name: 'empty', bytes: new Uint8Array() },
      { name: 'truncated', bytes: golden.slice(0, -1) },
      { name: 'malformed wire type', bytes: Uint8Array.from([0x0f]) },
      {
        name: 'overlong varint',
        bytes: Uint8Array.from([0x08, ...Array<number>(11).fill(0x80)])
      }
    ]

    for (const hostile of cases) {
      expect(() => decodeRaceOpsEvent(hostile.bytes), hostile.name).toThrow()
    }
  })

  it('[supported] rejects future enums and missing canonical RaceOps identity', () => {
    const golden = json('race-ops-event-v1.json') as Record<string, unknown>

    expect(() => raceOpsEventFromProtoJson({
      ...golden,
      eventClass: 'RACE_OPS_EVENT_CLASS_FUTURE'
    })).toThrow(/unknown or future/i)
    expect(() => raceOpsEventFromProtoJson({
      ...golden,
      eventId: ''
    })).toThrow(/missing required canonical identity/i)
  })

  it('[spec-gap] rejects invalid base64, non-finite numbers, and invalid uint strings', () => {
    const source = json('race-ops-event-v1.json') as Record<string, unknown>
    const malformed = [
      {
        name: 'invalid base64',
        mutate(value: Record<string, unknown>) {
          const facts = value.facts as Array<Record<string, unknown>>
          facts[5].bytesValue = '***not-base64***'
        }
      },
      {
        name: 'non-finite confidence',
        mutate(value: Record<string, unknown>) {
          ;(value.confidence as Record<string, unknown>).value = Number.NaN
        }
      },
      {
        name: 'negative unsigned fact',
        mutate(value: Record<string, unknown>) {
          const facts = value.facts as Array<Record<string, unknown>>
          facts[1].unsignedValue = '-1'
        }
      },
      {
        name: 'invalid sequence',
        mutate(value: Record<string, unknown>) {
          value.sequence = 'not-a-uint64'
        }
      }
    ]
    const accepted = malformed
      .filter(({ mutate }) => {
        const candidate = structuredClone(source)
        mutate(candidate)
        try {
          raceOpsEventFromProtoJson(candidate as unknown as JsonValue)
          return true
        } catch {
          return false
        }
      })
      .map(({ name }) => name)

    expect(accepted, 'invalid scalar values accepted by the canonical decoder').toEqual([])
  })

  it('[supported] ignores a small unknown protobuf field without changing known fields', () => {
    const source = raceOpsEventFromProtoJson(json('race-ops-event-v1.json'))
    const encoded = encodeRaceOpsEvent(source)
    const withUnknownField = Uint8Array.from([...encoded, 0xa0, 0x06, 0x01])

    expect(decodeRaceOpsEvent(withUnknownField)).toEqual(source)
    expect(withUnknownField.length).toBe(encoded.length + 3)
  })

  it('[spec-gap] bounds RaceOps repeated fields, duplicate facts, and expansive ProtoJSON', () => {
    const source = json('race-ops-event-v1.json') as Record<string, unknown>
    const firstFact = (source.facts as Array<Record<string, unknown>>)[0]
    const candidates = [
      {
        name: '2049 duplicate facts',
        value: { ...structuredClone(source), facts: Array.from({ length: 2_049 }, () => structuredClone(firstFact)) }
      },
      {
        name: '4097 evidence references',
        value: { ...structuredClone(source), evidenceRefs: Array.from({ length: 4_097 }, (_, index) => `evidence:${index}`) }
      },
      {
        name: '4097 integrity flags',
        value: { ...structuredClone(source), integrityFlags: Array.from({ length: 4_097 }, () => 'INTEGRITY_FLAG_GAP') }
      },
      {
        name: 'expansive nested interval',
        value: {
          ...structuredClone(source),
          observedInterval: {
            sourceTickStart: { nested: Array.from({ length: 4_097 }, () => ({ value: 'x' })) }
          }
        }
      }
    ]
    const started = performance.now()
    const accepted = candidates
      .filter(({ value }) => {
        try {
          raceOpsEventFromProtoJson(value as unknown as JsonValue)
          return true
        } catch {
          return false
        }
      })
      .map(({ name }) => name)

    expect(performance.now() - started).toBeLessThan(1_000)
    expect(accepted, 'unbounded RaceOps inputs accepted').toEqual([])
  })

  it('[supported] rejects empty, truncated, and malformed-wire v1 Passport binary', () => {
    const golden = binary('stint-passport-v1.binpb')
    const cases = [
      { name: 'empty', bytes: new Uint8Array() },
      { name: 'truncated', bytes: golden.slice(0, -1) },
      { name: 'malformed wire type', bytes: Uint8Array.from([0x0f]) }
    ]

    for (const hostile of cases) {
      expect(() => decodeStintPassport(hostile.bytes), hostile.name).toThrow()
    }
  })

  it('[spec-gap] rejects invalid Passport shape, counters, scalar fields, and size', () => {
    const source = json('stint-passport-v1.json') as Record<string, unknown>
    const sourceItems = source.items as Array<Record<string, unknown>>
    const malformed: Array<{ name: string; value: Record<string, unknown> }> = [
      { name: 'zero items', value: { ...structuredClone(source), items: [] } },
      { name: '11 items', value: { ...structuredClone(source), items: structuredClone(sourceItems.slice(0, 11)) } },
      {
        name: '13 items',
        value: { ...structuredClone(source), items: [...structuredClone(sourceItems), structuredClone(sourceItems[0])] }
      },
      {
        name: 'duplicate item IDs',
        value: { ...structuredClone(source), items: [...structuredClone(sourceItems.slice(0, 11)), structuredClone(sourceItems[0])] }
      },
      {
        name: '1024 items',
        value: {
          ...structuredClone(source),
          items: Array.from({ length: 1_024 }, (_, index) =>
            structuredClone(sourceItems[index % sourceItems.length])
          )
        }
      },
      {
        name: 'inconsistent counters',
        value: { ...structuredClone(source), coverage: 0.25, applicableItems: 99, coveredItems: 98 }
      },
      {
        name: 'oversized identity and detail',
        value: {
          ...structuredClone(source),
          identity: { ...(structuredClone(source.identity) as object), stintId: 's'.repeat(262_144) },
          items: sourceItems.map((item, index) =>
            index === 0 ? { ...structuredClone(item), detail: 'd'.repeat(262_144) } : structuredClone(item)
          )
        }
      },
      {
        name: 'invalid evidence base64',
        value: {
          ...structuredClone(source),
          items: sourceItems.map((item, index) =>
            index === 11
              ? {
                  ...structuredClone(item),
                  evidence: {
                    ...(structuredClone(item.evidence) as object),
                    contentSha256: '***not-base64***'
                  }
                }
              : structuredClone(item)
          )
        }
      },
      {
        name: 'invalid identity timestamp',
        value: {
          ...structuredClone(source),
          identity: { ...(structuredClone(source.identity) as object), startedAtMs: 'not-a-uint64' }
        }
      },
      { name: 'NaN coverage', value: { ...structuredClone(source), coverage: Number.NaN } }
    ]
    const accepted = malformed
      .filter(({ value }) => {
        try {
          stintPassportFromProtoJson(value as unknown as JsonValue)
          return true
        } catch {
          return false
        }
      })
      .map(({ name }) => name)

    expect(accepted, 'invalid Passport payloads accepted').toEqual([])
  })

  it('[supported] rejects truncated N-1 binary and a nonzero N-1 contract version', () => {
    const golden = binary('stint-passport-n-1.binpb')
    const futureVersion = golden.slice()
    futureVersion[1] = 1

    expect(() => decodeStintPassportN1(golden.slice(0, -1))).toThrow()
    expect(() => decodeStintPassportN1(futureVersion)).toThrow(/unsupported n-1.*version/i)
  })

  it('[spec-gap] rejects empty and duplicate-ID N-1 payloads', () => {
    const golden = binary('stint-passport-n-1.binpb')
    const duplicateSessionIdentity = Uint8Array.from([
      ...golden,
      0x1a, 0x09,
      0x08, 0x01,
      0x10, 0x02,
      0x1a, 0x03, 0x64, 0x75, 0x70
    ])
    const accepted = [
      { name: 'empty payload', bytes: new Uint8Array() },
      { name: 'duplicate legacy item ID', bytes: duplicateSessionIdentity }
    ]
      .filter(({ bytes }) => {
        try {
          decodeStintPassportN1(bytes)
          return true
        } catch {
          return false
        }
      })
      .map(({ name }) => name)

    expect(accepted, 'malformed N-1 payloads accepted').toEqual([])
  })

  it('[supported] deterministically decodes or rejects a fixed hostile corpus', () => {
    const golden = binary('stint-passport-v1.binpb')
    let state = 0x5eed1234
    const randomBytes = (length: number): Uint8Array => {
      const bytes = new Uint8Array(length)
      for (let index = 0; index < length; index += 1) {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
        bytes[index] = state & 0xff
      }
      return bytes
    }
    const flipped = [0, 10, Math.floor(golden.length / 2)].map((index) => {
      const bytes = golden.slice()
      bytes[index] ^= 0xff
      return bytes
    })
    const corpus = [
      golden.slice(0, 1),
      golden.slice(0, Math.floor(golden.length / 2)),
      golden.slice(0, -1),
      ...flipped,
      Uint8Array.from([...golden, 0xa0, 0x06, 0x01]),
      randomBytes(1),
      randomBytes(8),
      randomBytes(32),
      randomBytes(128)
    ]
    const outcome = (bytes: Uint8Array): { ok: true; value: JsonValue } | { ok: false; error: string } => {
      try {
        return { ok: true, value: stintPassportProtoJson(decodeStintPassport(bytes)) }
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? `${error.name}:${error.message}` : String(error)
        }
      }
    }

    const first = corpus.map(outcome)
    const second = corpus.map(outcome)

    expect(second).toEqual(first)
    expect(first.some((result) => result.ok)).toBe(true)
    expect(first.some((result) => !result.ok)).toBe(true)
  })
})
