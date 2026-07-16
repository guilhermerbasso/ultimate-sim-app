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
