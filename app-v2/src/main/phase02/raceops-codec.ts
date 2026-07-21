import {
  createFileRegistry,
  fromBinary,
  fromJson,
  toBinary,
  toJson,
  type DescMessage,
  type JsonValue
} from '@bufbuild/protobuf'
import { FileDescriptorSetSchema } from '@bufbuild/protobuf/wkt'
import {
  PHASE02_DESCRIPTOR_SHA256,
  phase02DescriptorBytes
} from './generated/contract-descriptor'
import { phase02_n1DescriptorBytes } from './generated/n1-contract-descriptor'
import {
  STINT_PASSPORT_CONTRACT_VERSION,
  STINT_PASSPORT_ITEM_COUNT,
  PASSPORT_ITEM_DEFINITIONS,
  calculatePassportCoverage,
  type PassportItem,
  type PassportItemId,
  type PassportItemStatus,
  type PassportLifecycle,
  type PassportRole,
  type StintPassport
} from '../../shared/stint-passport'
import type {
  CanonicalFact,
  CanonicalRaceOpsEvent,
  DataValidity,
  IntegrityFlag,
  NullReason,
  PrivacyClass,
  RaceOpsCloudEvent,
  RaceOpsEventClass,
  RaceOpsPriority,
  RaceOpsSeverity,
  TelemetryContext
} from '../../shared/phase02-contracts'

const registry = createFileRegistry(fromBinary(FileDescriptorSetSchema, phase02DescriptorBytes()))
const raceOpsEventSchema = requiredMessage('ultimate.sim.raceops.v1.RaceOpsEvent')
const stintPassportSchema = requiredMessage('ultimate.sim.raceops.v1.StintPassport')
const n1Registry = createFileRegistry(fromBinary(FileDescriptorSetSchema, phase02_n1DescriptorBytes()))
const n1StintPassportSchema = (() => {
  const message = n1Registry.getMessage('ultimate.sim.raceops.n1.v1.StintPassport')
  if (!message) throw new Error('Phase 02 N-1 descriptor is missing StintPassport.')
  return message
})()

const MAX_BINARY_BYTES = 5 * 1024 * 1024
const MAX_PROTO_JSON_BYTES = 5 * 1024 * 1024
const MAX_JSON_DEPTH = 32
const MAX_JSON_NODES = 20_000
const MAX_FACTS = 2_048
const MAX_EVIDENCE_REFS = 4_096
const MAX_INTEGRITY_FLAGS = 64
const MAX_TEXT_BYTES = 64 * 1024
const UINT64_MAX = 18_446_744_073_709_551_615n

const EVENT_CLASS_TO_PROTO: Record<RaceOpsEventClass, string> = {
  unspecified: 'RACE_OPS_EVENT_CLASS_UNSPECIFIED',
  fact: 'RACE_OPS_EVENT_CLASS_FACT',
  inference: 'RACE_OPS_EVENT_CLASS_INFERENCE',
  recommendation: 'RACE_OPS_EVENT_CLASS_RECOMMENDATION',
  decision: 'RACE_OPS_EVENT_CLASS_DECISION',
  action: 'RACE_OPS_EVENT_CLASS_ACTION',
  outcome: 'RACE_OPS_EVENT_CLASS_OUTCOME',
  disclosure: 'RACE_OPS_EVENT_CLASS_DISCLOSURE'
}

export function decodeStintPassportN1(bytes: Uint8Array): StintPassport {
  assertBinaryInput(bytes, 'N-1 StintPassport')
  const json = object(toJson(
    n1StintPassportSchema,
    fromBinary(n1StintPassportSchema, bytes),
    { alwaysEmitImplicit: true }
  ))
  if (numeric(json.contractVersion) !== 0) {
    throw new Error(`Unsupported N-1 StintPassport version: ${String(json.contractVersion)}`)
  }
  const identity = object(json.identity)
  const legacyValues = array(json.items)
  if (legacyValues.length === 0 || legacyValues.length > STINT_PASSPORT_ITEM_COUNT) {
    throw new Error('N-1 StintPassport must contain a bounded non-empty item set.')
  }
  const legacyItems = new Map(legacyValues.map((value) => {
    const item = object(value)
    const id = reverseMap(ITEM_ID_TO_PROTO, item.itemId)
    return [
      id,
      {
        id,
        status: reverseMap(ITEM_STATUS_TO_PROTO, item.status),
        detail: boundedText(item.detail, 'N-1 item detail', MAX_TEXT_BYTES),
        verifiedAt: optionalSafeUint(item.capturedAtMs, 'N-1 capturedAtMs'),
        expiresAt: undefined,
        evidence: undefined,
        revision: 1
      } satisfies PassportItem
    ] as const
  }))
  if (legacyItems.size !== legacyValues.length) {
    throw new Error('N-1 StintPassport item IDs must be unique.')
  }
  const startedAt = requiredSafeUint(identity.startedAtMs, 'N-1 startedAtMs')
  const items = PASSPORT_ITEM_DEFINITIONS.map((definition) =>
    legacyItems.get(definition.id) ?? {
      id: definition.id,
      status: 'unknown' as const,
      detail: 'Not present in the explicit N-1 contract.',
      revision: 1
    }
  )
  const coverage = calculatePassportCoverage(items)
  return {
    contractVersion: STINT_PASSPORT_CONTRACT_VERSION,
    identity: {
      stintId: requiredText(identity.stintId, 'N-1 stintId', 512),
      sessionRef: requiredText(identity.sessionRef, 'N-1 sessionRef', 512),
      trackRef: requiredText(identity.trackRef, 'N-1 trackRef', 512),
      trackLabel: boundedText(identity.trackLabel, 'N-1 trackLabel', 4_096),
      carRef: requiredText(identity.carRef, 'N-1 carRef', 512),
      carLabel: boundedText(identity.carLabel, 'N-1 carLabel', 4_096),
      driverRef: requiredText(identity.driverRef, 'N-1 driverRef', 512),
      driverLabel: boundedText(identity.driverLabel, 'N-1 driverLabel', 4_096),
      startedAt
    },
    lifecycle: 'awaiting-checklist',
    telemetryContext: 'live',
    items,
    ...coverage,
    interrupted: false,
    persisted: false,
    revision: 1,
    durability: 'ephemeral'
  }
}
const SEVERITY_TO_PROTO: Record<RaceOpsSeverity, string> = {
  unspecified: 'RACE_OPS_SEVERITY_UNSPECIFIED',
  info: 'RACE_OPS_SEVERITY_INFO',
  notice: 'RACE_OPS_SEVERITY_NOTICE',
  warning: 'RACE_OPS_SEVERITY_WARNING',
  critical: 'RACE_OPS_SEVERITY_CRITICAL'
}
const PRIORITY_TO_PROTO: Record<RaceOpsPriority, string> = {
  unspecified: 'RACE_OPS_PRIORITY_UNSPECIFIED',
  background: 'RACE_OPS_PRIORITY_BACKGROUND',
  normal: 'RACE_OPS_PRIORITY_NORMAL',
  high: 'RACE_OPS_PRIORITY_HIGH',
  immediate: 'RACE_OPS_PRIORITY_IMMEDIATE'
}
const TELEMETRY_TO_PROTO: Record<TelemetryContext, string> = {
  unspecified: 'TELEMETRY_CONTEXT_UNSPECIFIED',
  live: 'TELEMETRY_CONTEXT_LIVE',
  replay: 'TELEMETRY_CONTEXT_REPLAY',
  unknown: 'TELEMETRY_CONTEXT_UNKNOWN'
}
const PRIVACY_TO_PROTO: Record<PrivacyClass, string> = {
  D0: 'PRIVACY_CLASS_D0_PUBLIC',
  D1: 'PRIVACY_CLASS_D1_ACCOUNT',
  D2: 'PRIVACY_CLASS_D2_DRIVER',
  D3: 'PRIVACY_CLASS_D3_TEAM',
  D4: 'PRIVACY_CLASS_D4_SENSITIVE',
  D5: 'PRIVACY_CLASS_D5_RESTRICTED'
}
const VALIDITY_TO_PROTO: Record<DataValidity, string> = {
  unspecified: 'DATA_VALIDITY_UNSPECIFIED',
  valid: 'DATA_VALIDITY_VALID',
  stale: 'DATA_VALIDITY_STALE',
  missing: 'DATA_VALIDITY_MISSING',
  invalid: 'DATA_VALIDITY_INVALID'
}
const NULL_REASON_TO_PROTO: Record<NullReason, string> = {
  unspecified: 'NULL_REASON_UNSPECIFIED',
  'not-available': 'NULL_REASON_NOT_AVAILABLE',
  'not-applicable': 'NULL_REASON_NOT_APPLICABLE',
  'source-disconnected': 'NULL_REASON_SOURCE_DISCONNECTED',
  redacted: 'NULL_REASON_REDACTED',
  'out-of-range': 'NULL_REASON_OUT_OF_RANGE'
}
const INTEGRITY_TO_PROTO: Record<IntegrityFlag, string> = {
  unspecified: 'INTEGRITY_FLAG_UNSPECIFIED',
  stale: 'INTEGRITY_FLAG_STALE',
  gap: 'INTEGRITY_FLAG_GAP',
  derived: 'INTEGRITY_FLAG_DERIVED',
  redacted: 'INTEGRITY_FLAG_REDACTED',
  'externally-attested': 'INTEGRITY_FLAG_EXTERNALLY_ATTESTED'
}

const ROLE_TO_PROTO: Record<PassportRole, string> = {
  driver: 'PASSPORT_ROLE_DRIVER',
  engineer: 'PASSPORT_ROLE_ENGINEER',
  'crew-chief': 'PASSPORT_ROLE_CREW_CHIEF',
  spotter: 'PASSPORT_ROLE_SPOTTER',
  'team-manager': 'PASSPORT_ROLE_TEAM_MANAGER'
}
const ITEM_ID_TO_PROTO: Record<PassportItemId, string> = {
  'session-identity': 'PASSPORT_ITEM_ID_SESSION_IDENTITY',
  'incoming-driver': 'PASSPORT_ITEM_ID_INCOMING_DRIVER',
  'car-track': 'PASSPORT_ITEM_ID_CAR_TRACK',
  'fuel-load': 'PASSPORT_ITEM_ID_FUEL_LOAD',
  'stint-target': 'PASSPORT_ITEM_ID_STINT_TARGET',
  'race-profile': 'PASSPORT_ITEM_ID_RACE_PROFILE',
  'buttonbox-profile': 'PASSPORT_ITEM_ID_BUTTONBOX_PROFILE',
  'required-devices': 'PASSPORT_ITEM_ID_REQUIRED_DEVICES',
  'critical-controls': 'PASSPORT_ITEM_ID_CRITICAL_CONTROLS',
  'audio-comms': 'PASSPORT_ITEM_ID_AUDIO_COMMS',
  'weather-assumption': 'PASSPORT_ITEM_ID_WEATHER_ASSUMPTION',
  'final-acknowledgement': 'PASSPORT_ITEM_ID_FINAL_ACKNOWLEDGEMENT'
}
const ITEM_STATUS_TO_PROTO: Record<PassportItemStatus, string> = {
  unknown: 'PASSPORT_ITEM_STATUS_UNKNOWN',
  verified: 'PASSPORT_ITEM_STATUS_VERIFIED',
  'manual-confirmed': 'PASSPORT_ITEM_STATUS_MANUAL_CONFIRMED',
  'waived-with-reason': 'PASSPORT_ITEM_STATUS_WAIVED_WITH_REASON',
  'not-applicable': 'PASSPORT_ITEM_STATUS_NOT_APPLICABLE',
  mismatch: 'PASSPORT_ITEM_STATUS_MISMATCH',
  expired: 'PASSPORT_ITEM_STATUS_EXPIRED'
}
const LIFECYCLE_TO_PROTO: Record<PassportLifecycle, string> = {
  'awaiting-checklist': 'PASSPORT_LIFECYCLE_AWAITING_CHECKLIST',
  ready: 'PASSPORT_LIFECYCLE_READY',
  closed: 'PASSPORT_LIFECYCLE_CLOSED',
  interrupted: 'PASSPORT_LIFECYCLE_INTERRUPTED'
}

function requiredMessage(typeName: string): DescMessage {
  const message = registry.getMessage(typeName)
  if (!message) throw new Error(`Phase 02 descriptor is missing ${typeName}`)
  return message
}

function reverseMap<T extends string>(map: Record<T, string>, value: unknown): T {
  const entry = Object.entries(map).find(([, proto]) => proto === value)
  if (!entry) throw new Error(`Unknown or future Protobuf enum value: ${String(value)}`)
  return entry[0] as T
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function bool(value: unknown): boolean {
  return value === true
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function assertBinaryInput(bytes: Uint8Array, label: string): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new Error(`${label} binary payload is empty.`)
  }
  if (bytes.byteLength > MAX_BINARY_BYTES) {
    throw new Error(`${label} binary payload exceeds the ${MAX_BINARY_BYTES}-byte limit.`)
  }
}

function assertJsonBounds(value: unknown, label: string): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  let nodes = 0
  let bytes = 0
  while (pending.length > 0) {
    const current = pending.pop()!
    nodes += 1
    if (nodes > MAX_JSON_NODES) throw new Error(`${label} exceeds the JSON node limit.`)
    if (current.depth > MAX_JSON_DEPTH) throw new Error(`${label} exceeds the JSON depth limit.`)
    if (typeof current.value === 'string') {
      bytes += Buffer.byteLength(current.value, 'utf8')
      if (bytes > MAX_PROTO_JSON_BYTES) throw new Error(`${label} exceeds the JSON byte limit.`)
      continue
    }
    if (
      current.value === null ||
      current.value === undefined ||
      typeof current.value === 'boolean'
    ) continue
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value)) throw new Error(`${label} contains a non-finite number.`)
      continue
    }
    if (Array.isArray(current.value)) {
      for (const item of current.value) pending.push({ value: item, depth: current.depth + 1 })
      continue
    }
    if (typeof current.value !== 'object') throw new Error(`${label} contains an invalid JSON value.`)
    const prototype = Object.getPrototypeOf(current.value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${label} contains a non-plain object.`)
    }
    for (const [key, item] of Object.entries(current.value as Record<string, unknown>)) {
      bytes += Buffer.byteLength(key, 'utf8')
      if (bytes > MAX_PROTO_JSON_BYTES) throw new Error(`${label} exceeds the JSON byte limit.`)
      pending.push({ value: item, depth: current.depth + 1 })
    }
  }
}

function boundedText(value: unknown, field: string, maxBytes = MAX_TEXT_BYTES): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`)
  if (Buffer.byteLength(value, 'utf8') > maxBytes) throw new Error(`${field} exceeds its size limit.`)
  return value
}

function requiredText(value: unknown, field: string, maxBytes = MAX_TEXT_BYTES): string {
  const result = boundedText(value, field, maxBytes)
  if (!result) throw new Error(`${field} is required.`)
  return result
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number.`)
  }
  return value
}

function uintString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${field} must be a canonical uint64 string.`)
  }
  if (BigInt(value) > UINT64_MAX) throw new Error(`${field} exceeds uint64.`)
  return value
}

function requiredSafeUint(value: unknown, field: string): number {
  const parsed = BigInt(uintString(value, field))
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${field} exceeds the safe integer range.`)
  return Number(parsed)
}

function optionalSafeUint(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = requiredSafeUint(value, field)
  return parsed > 0 ? parsed : undefined
}

function strictBase64(value: unknown, field: string, expectedBytes?: number): Uint8Array {
  const encoded = boundedText(value, field, MAX_PROTO_JSON_BYTES)
  if (
    encoded.length === 0 ||
    encoded.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  ) {
    throw new Error(`${field} must be canonical base64.`)
  }
  const decoded = Uint8Array.from(Buffer.from(encoded, 'base64'))
  if (Buffer.from(decoded).toString('base64') !== encoded) {
    throw new Error(`${field} must be canonical base64.`)
  }
  if (expectedBytes !== undefined && decoded.byteLength !== expectedBytes) {
    throw new Error(`${field} must contain exactly ${expectedBytes} bytes.`)
  }
  return decoded
}

function hexToBase64(value: string): string {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('SHA-256 content hash must contain 64 hexadecimal characters.')
  return Buffer.from(value, 'hex').toString('base64')
}

function base64ToHex(value: unknown): string {
  return Buffer.from(strictBase64(value, 'contentSha256', 32)).toString('hex')
}

function factToJson(fact: CanonicalFact): Record<string, unknown> {
  const json: Record<string, unknown> = {
    name: fact.name,
    canonicalUnit: fact.canonicalUnit
  }
  if (fact.value) {
    const key = fact.value.kind === 'double'
      ? 'doubleValue'
      : fact.value.kind === 'signed'
        ? 'signedValue'
        : fact.value.kind === 'unsigned'
          ? 'unsignedValue'
          : fact.value.kind === 'bool'
            ? 'boolValue'
            : fact.value.kind === 'string'
              ? 'stringValue'
              : 'bytesValue'
    json[key] = fact.value.kind === 'bytes'
      ? Buffer.from(fact.value.value).toString('base64')
      : fact.value.value
  }
  if (fact.provenance) {
    json.provenance = {
      sourceId: fact.provenance.sourceId,
      transformId: fact.provenance.transformId,
      schemaFingerprint: fact.provenance.schemaFingerprint,
      canonicalUnit: fact.provenance.canonicalUnit,
      validity: VALIDITY_TO_PROTO[fact.provenance.validity],
      nullReason: NULL_REASON_TO_PROTO[fact.provenance.nullReason],
      sourceTick: fact.provenance.sourceTick,
      observedMonotonicNs: fact.provenance.observedMonotonicNs,
      ageMs: fact.provenance.ageMs,
      privacyClass: PRIVACY_TO_PROTO[fact.provenance.privacyClass]
    }
  }
  return json
}

function factFromJson(value: unknown): CanonicalFact {
  const json = object(value)
  const valueFields = [
    'doubleValue',
    'signedValue',
    'unsignedValue',
    'boolValue',
    'stringValue',
    'bytesValue'
  ].filter((field) => json[field] !== undefined)
  if (valueFields.length > 1) throw new Error('Canonical fact contains multiple value variants.')
  let factValue: CanonicalFact['value']
  if (json.doubleValue !== undefined) {
    factValue = { kind: 'double', value: finiteNumber(json.doubleValue, 'fact.doubleValue') }
  } else if (json.signedValue !== undefined) {
    const signed = boundedText(json.signedValue, 'fact.signedValue', 32)
    if (!/^-?(0|[1-9][0-9]*)$/.test(signed)) throw new Error('fact.signedValue must be a canonical int64 string.')
    const parsed = BigInt(signed)
    if (parsed < -9_223_372_036_854_775_808n || parsed > 9_223_372_036_854_775_807n) {
      throw new Error('fact.signedValue exceeds int64.')
    }
    factValue = { kind: 'signed', value: signed }
  } else if (json.unsignedValue !== undefined) {
    factValue = { kind: 'unsigned', value: uintString(json.unsignedValue, 'fact.unsignedValue') }
  } else if (json.boolValue !== undefined) {
    if (typeof json.boolValue !== 'boolean') throw new Error('fact.boolValue must be a boolean.')
    factValue = { kind: 'bool', value: json.boolValue }
  } else if (json.stringValue !== undefined) {
    factValue = { kind: 'string', value: boundedText(json.stringValue, 'fact.stringValue') }
  }
  else if (json.bytesValue !== undefined) {
    factValue = { kind: 'bytes', value: strictBase64(json.bytesValue, 'fact.bytesValue') }
  }
  const provenanceJson = object(json.provenance)
  return {
    name: requiredText(json.name, 'fact.name', 512),
    canonicalUnit: boundedText(json.canonicalUnit, 'fact.canonicalUnit', 256),
    value: factValue,
    provenance: json.provenance
      ? {
          sourceId: requiredText(provenanceJson.sourceId, 'fact.provenance.sourceId', 512),
          transformId: boundedText(provenanceJson.transformId, 'fact.provenance.transformId', 512),
          schemaFingerprint: boundedText(provenanceJson.schemaFingerprint, 'fact.provenance.schemaFingerprint', 512),
          canonicalUnit: boundedText(provenanceJson.canonicalUnit, 'fact.provenance.canonicalUnit', 256),
          validity: reverseMap(VALIDITY_TO_PROTO, provenanceJson.validity),
          nullReason: reverseMap(NULL_REASON_TO_PROTO, provenanceJson.nullReason),
          sourceTick: uintString(provenanceJson.sourceTick, 'fact.provenance.sourceTick'),
          observedMonotonicNs: uintString(provenanceJson.observedMonotonicNs, 'fact.provenance.observedMonotonicNs'),
          ageMs: uintString(provenanceJson.ageMs, 'fact.provenance.ageMs'),
          privacyClass: reverseMap(PRIVACY_TO_PROTO, provenanceJson.privacyClass)
        }
      : undefined
  }
}

export function raceOpsEventToProtoJson(event: CanonicalRaceOpsEvent): JsonValue {
  return {
    eventId: event.eventId,
    eventClass: EVENT_CLASS_TO_PROTO[event.eventClass],
    eventType: event.eventType,
    sessionRef: event.sessionRef,
    actorRef: event.actorRef,
    subjectRef: event.subjectRef,
    observedInterval: {
      sourceTickStart: event.observedInterval.sourceTickStart,
      sourceTickEnd: event.observedInterval.sourceTickEnd,
      monotonicNsStart: event.observedInterval.monotonicNsStart,
      monotonicNsEnd: event.observedInterval.monotonicNsEnd,
      simTimeMsStart: event.observedInterval.simTimeMsStart,
      simTimeMsEnd: event.observedInterval.simTimeMsEnd
    },
    facts: event.facts.map(factToJson),
    confidence: event.confidence,
    severity: SEVERITY_TO_PROTO[event.severity],
    priority: PRIORITY_TO_PROTO[event.priority],
    evidenceRefs: event.evidenceRefs,
    policyRef: event.policyRef,
    capabilityRef: event.capabilityRef,
    consentEpoch: event.consentEpoch,
    approvalRef: event.approvalRef,
    correlationId: event.correlationId,
    dedupeKey: event.dedupeKey,
    privacyClass: PRIVACY_TO_PROTO[event.privacyClass],
    integrityFlags: event.integrityFlags.map((flag) => INTEGRITY_TO_PROTO[flag]),
    supersedesEventId: event.supersedesEventId,
    sequence: event.sequence,
    partitionKey: event.partitionKey,
    partitionSeq: event.partitionSeq,
    telemetryContext: TELEMETRY_TO_PROTO[event.telemetryContext],
    sourceTick: event.sourceTick,
    observedMonotonicNs: event.observedMonotonicNs,
    ttlMs: event.ttlMs
  } as unknown as JsonValue
}

export function raceOpsEventFromProtoJson(value: JsonValue): CanonicalRaceOpsEvent {
  assertJsonBounds(value, 'RaceOpsEvent ProtoJSON')
  const json = object(value)
  const interval = object(json.observedInterval)
  const confidence = object(json.confidence)
  const factsJson = array(json.facts)
  const evidenceRefsJson = array(json.evidenceRefs)
  const integrityFlagsJson = array(json.integrityFlags)
  if (factsJson.length > MAX_FACTS) throw new Error(`RaceOpsEvent facts exceed ${MAX_FACTS}.`)
  if (evidenceRefsJson.length > MAX_EVIDENCE_REFS) {
    throw new Error(`RaceOpsEvent evidence references exceed ${MAX_EVIDENCE_REFS}.`)
  }
  if (integrityFlagsJson.length > MAX_INTEGRITY_FLAGS) {
    throw new Error(`RaceOpsEvent integrity flags exceed ${MAX_INTEGRITY_FLAGS}.`)
  }
  const facts = factsJson.map(factFromJson)
  if (new Set(facts.map((fact) => fact.name)).size !== facts.length) {
    throw new Error('RaceOpsEvent fact names must be unique.')
  }
  const evidenceRefs = evidenceRefsJson.map((item, index) =>
    boundedText(item, `RaceOpsEvent evidenceRefs[${index}]`, 2_048)
  )
  const integrityFlags = integrityFlagsJson.map((flag) =>
    reverseMap(INTEGRITY_TO_PROTO, flag)
  )
  if (new Set(integrityFlags).size !== integrityFlags.length) {
    throw new Error('RaceOpsEvent integrity flags must be unique.')
  }
  const event: CanonicalRaceOpsEvent = {
    eventId: boundedText(json.eventId, 'RaceOpsEvent eventId', 512),
    eventClass: reverseMap(EVENT_CLASS_TO_PROTO, json.eventClass),
    eventType: boundedText(json.eventType, 'RaceOpsEvent eventType', 1_024),
    sessionRef: boundedText(json.sessionRef, 'RaceOpsEvent sessionRef', 1_024),
    actorRef: boundedText(json.actorRef, 'RaceOpsEvent actorRef', 1_024),
    subjectRef: boundedText(json.subjectRef, 'RaceOpsEvent subjectRef', 1_024),
    observedInterval: {
      sourceTickStart: uintString(interval.sourceTickStart, 'RaceOpsEvent observedInterval.sourceTickStart'),
      sourceTickEnd: uintString(interval.sourceTickEnd, 'RaceOpsEvent observedInterval.sourceTickEnd'),
      monotonicNsStart: uintString(interval.monotonicNsStart, 'RaceOpsEvent observedInterval.monotonicNsStart'),
      monotonicNsEnd: uintString(interval.monotonicNsEnd, 'RaceOpsEvent observedInterval.monotonicNsEnd'),
      simTimeMsStart: uintString(interval.simTimeMsStart, 'RaceOpsEvent observedInterval.simTimeMsStart'),
      simTimeMsEnd: uintString(interval.simTimeMsEnd, 'RaceOpsEvent observedInterval.simTimeMsEnd')
    },
    facts,
    confidence: {
      value: finiteNumber(confidence.value, 'RaceOpsEvent confidence.value'),
      method: boundedText(confidence.method, 'RaceOpsEvent confidence.method', 512),
      abstained: (() => {
        if (typeof confidence.abstained !== 'boolean') {
          throw new Error('RaceOpsEvent confidence.abstained must be a boolean.')
        }
        return confidence.abstained
      })()
    },
    severity: reverseMap(SEVERITY_TO_PROTO, json.severity),
    priority: reverseMap(PRIORITY_TO_PROTO, json.priority),
    evidenceRefs,
    policyRef: boundedText(json.policyRef, 'RaceOpsEvent policyRef', 1_024),
    capabilityRef: boundedText(json.capabilityRef, 'RaceOpsEvent capabilityRef', 1_024),
    consentEpoch: uintString(json.consentEpoch, 'RaceOpsEvent consentEpoch'),
    approvalRef: boundedText(json.approvalRef, 'RaceOpsEvent approvalRef', 1_024),
    correlationId: boundedText(json.correlationId, 'RaceOpsEvent correlationId', 1_024),
    dedupeKey: boundedText(json.dedupeKey, 'RaceOpsEvent dedupeKey', 1_024),
    privacyClass: reverseMap(PRIVACY_TO_PROTO, json.privacyClass),
    integrityFlags,
    supersedesEventId: boundedText(json.supersedesEventId, 'RaceOpsEvent supersedesEventId', 512),
    sequence: uintString(json.sequence, 'RaceOpsEvent sequence'),
    partitionKey: boundedText(json.partitionKey, 'RaceOpsEvent partitionKey', 1_024),
    partitionSeq: uintString(json.partitionSeq, 'RaceOpsEvent partitionSeq'),
    telemetryContext: reverseMap(TELEMETRY_TO_PROTO, json.telemetryContext),
    sourceTick: uintString(json.sourceTick, 'RaceOpsEvent sourceTick'),
    observedMonotonicNs: uintString(json.observedMonotonicNs, 'RaceOpsEvent observedMonotonicNs'),
    ttlMs: uintString(json.ttlMs, 'RaceOpsEvent ttlMs')
  }
  if (
    event.eventClass === 'unspecified' ||
    event.severity === 'unspecified' ||
    event.priority === 'unspecified' ||
    event.telemetryContext === 'unspecified'
  ) {
    throw new Error('RaceOpsEvent contains an unspecified required enum.')
  }
  if (!event.eventId || !event.eventType || !event.dedupeKey || !event.partitionKey) {
    throw new Error('RaceOpsEvent is missing required canonical identity fields.')
  }
  if (event.facts.some((fact) => fact.provenance?.validity === 'unspecified')) {
    throw new Error('RaceOpsEvent fact provenance validity is unspecified.')
  }
  return event
}

export function encodeRaceOpsEvent(event: CanonicalRaceOpsEvent): Uint8Array {
  return toBinary(raceOpsEventSchema, fromJson(raceOpsEventSchema, raceOpsEventToProtoJson(event)))
}

export function decodeRaceOpsEvent(bytes: Uint8Array): CanonicalRaceOpsEvent {
  assertBinaryInput(bytes, 'RaceOpsEvent')
  const message = fromBinary(raceOpsEventSchema, bytes)
  return raceOpsEventFromProtoJson(
    toJson(raceOpsEventSchema, message, { alwaysEmitImplicit: true })
  )
}

export function raceOpsEventToCloudEvent(
  event: CanonicalRaceOpsEvent,
  options: {
    source: string
    producerId: string
    causationId?: string
    timeMs?: number
  }
): RaceOpsCloudEvent {
  return {
    specversion: '1.0',
    id: event.eventId,
    source: options.source,
    type: event.eventType,
    subject: event.subjectRef || undefined,
    time: options.timeMs === undefined ? undefined : new Date(options.timeMs).toISOString(),
    datacontenttype: 'application/x-protobuf',
    dataschema: 'urn:ultimate-sim:raceops:v1:race-ops-event',
    sequence: event.sequence,
    sourcetick: event.sourceTick,
    monotonicns: event.observedMonotonicNs,
    sessionid: event.sessionRef,
    producerid: options.producerId,
    schemafp: PHASE02_DESCRIPTOR_SHA256,
    correlationid: event.correlationId,
    causationid: options.causationId ?? '',
    privacyclass: event.privacyClass,
    rolepolicyid: event.policyRef,
    capgrantid: event.capabilityRef,
    consentepoch: event.consentEpoch,
    approvalid: event.approvalRef,
    partitionkey: event.partitionKey,
    partitionseq: event.partitionSeq,
    stale: event.integrityFlags.includes('stale'),
    derived: event.integrityFlags.includes('derived'),
    gap: event.integrityFlags.includes('gap'),
    data: encodeRaceOpsEvent(event)
  }
}

export function decodeRaceOpsCloudEvent(envelope: RaceOpsCloudEvent): CanonicalRaceOpsEvent {
  if (envelope.specversion !== '1.0') throw new Error('Unsupported CloudEvents version.')
  if (envelope.datacontenttype !== 'application/x-protobuf') throw new Error('Unsupported RaceOps content type.')
  if (envelope.dataschema !== 'urn:ultimate-sim:raceops:v1:race-ops-event') {
    throw new Error('Unsupported RaceOps schema.')
  }
  const event = decodeRaceOpsEvent(envelope.data)
  if (
    event.eventId !== envelope.id ||
    event.eventType !== envelope.type ||
    event.subjectRef !== (envelope.subject ?? '') ||
    event.sequence !== envelope.sequence ||
    event.sourceTick !== envelope.sourcetick ||
    event.observedMonotonicNs !== envelope.monotonicns ||
    event.sessionRef !== envelope.sessionid ||
    event.correlationId !== envelope.correlationid ||
    event.privacyClass !== envelope.privacyclass ||
    event.policyRef !== envelope.rolepolicyid ||
    event.capabilityRef !== envelope.capgrantid ||
    event.consentEpoch !== envelope.consentepoch ||
    event.approvalRef !== envelope.approvalid ||
    event.partitionKey !== envelope.partitionkey ||
    event.partitionSeq !== envelope.partitionseq ||
    event.integrityFlags.includes('stale') !== envelope.stale ||
    event.integrityFlags.includes('derived') !== envelope.derived ||
    event.integrityFlags.includes('gap') !== envelope.gap
  ) {
    throw new Error('CloudEvents envelope does not match the RaceOps payload.')
  }
  return event
}

function ownerToJson(owner: PassportItem['owner']): Record<string, unknown> | undefined {
  return owner ? { memberId: owner.memberId, role: ROLE_TO_PROTO[owner.role] } : undefined
}

function itemToJson(item: PassportItem): Record<string, unknown> {
  const json: Record<string, unknown> = {
    itemId: ITEM_ID_TO_PROTO[item.id],
    status: ITEM_STATUS_TO_PROTO[item.status],
    detail: item.detail,
    revision: String(item.revision)
  }
  if (item.owner) json.owner = ownerToJson(item.owner)
  if (item.overrideReason !== undefined) json.overrideReason = item.overrideReason
  if (item.reasonCode !== undefined) json.reasonCode = item.reasonCode
  if (item.verifiedAt !== undefined) json.verifiedAtMs = String(item.verifiedAt)
  if (item.expiresAt !== undefined) json.expiresAtMs = String(item.expiresAt)
  if (item.evidence) {
    json.evidence = {
      source: item.evidence.source,
      summary: item.evidence.summary,
      contentSha256: hexToBase64(item.evidence.contentHash),
      capturedAtMs: String(item.evidence.capturedAt),
      state: item.evidence.state
    }
  }
  return json
}

export function stintPassportToProtoJson(passport: StintPassport): JsonValue {
  const identity: Record<string, unknown> = {
    stintId: passport.identity.stintId,
    sessionRef: passport.identity.sessionRef,
    trackRef: passport.identity.trackRef,
    trackLabel: passport.identity.trackLabel,
    carRef: passport.identity.carRef,
    carLabel: passport.identity.carLabel,
    driverRef: passport.identity.driverRef,
    driverLabel: passport.identity.driverLabel,
    startedAtMs: String(passport.identity.startedAt)
  }
  if (passport.identity.teamRef !== undefined) identity.teamRef = passport.identity.teamRef
  if (passport.identity.teamLabel !== undefined) identity.teamLabel = passport.identity.teamLabel
  const json: Record<string, unknown> = {
    contractVersion: passport.contractVersion,
    identity,
    lifecycle: LIFECYCLE_TO_PROTO[passport.lifecycle],
    telemetryContext: TELEMETRY_TO_PROTO[passport.telemetryContext],
    items: passport.items.map(itemToJson),
    coverage: passport.coverage,
    applicableItems: passport.applicableItems,
    coveredItems: passport.coveredItems,
    interrupted: passport.interrupted,
    persisted: passport.persisted,
    revision: String(passport.revision),
    durability: passport.durability
  }
  if (passport.challengeCompletedAt !== undefined) {
    json.challengeCompletedAtMs = String(passport.challengeCompletedAt)
  }
  if (passport.challengeOwner) json.challengeOwner = ownerToJson(passport.challengeOwner)
  if (passport.closedAt !== undefined) json.closedAtMs = String(passport.closedAt)
  if (passport.closeReason !== undefined) json.closeReason = passport.closeReason
  return json as unknown as JsonValue
}

function ownerFromJson(value: unknown): PassportItem['owner'] {
  if (value === undefined || value === null) return undefined
  const json = object(value)
  const memberId = requiredText(json.memberId, 'Passport owner memberId', 512)
  return {
    memberId,
    role: reverseMap(ROLE_TO_PROTO, json.role)
  }
}

function itemFromJson(value: unknown): PassportItem {
  const json = object(value)
  const evidence = object(json.evidence)
  const verifiedAt = optionalSafeUint(json.verifiedAtMs, 'Passport item verifiedAtMs')
  const expiresAt = optionalSafeUint(json.expiresAtMs, 'Passport item expiresAtMs')
  const revision = requiredSafeUint(json.revision, 'Passport item revision')
  if (revision < 1) throw new Error('Passport item revision must be at least one.')
  const evidenceState = json.evidence
    ? boundedText(evidence.state, 'Passport evidence state', 64)
    : undefined
  if (
    evidenceState !== undefined &&
    evidenceState !== 'available' &&
    evidenceState !== 'retention-redacted' &&
    evidenceState !== 'unavailable'
  ) {
    throw new Error('Passport evidence state is invalid.')
  }
  return {
    id: reverseMap(ITEM_ID_TO_PROTO, json.itemId),
    status: reverseMap(ITEM_STATUS_TO_PROTO, json.status),
    owner: ownerFromJson(json.owner),
    detail: boundedText(json.detail, 'Passport item detail'),
    overrideReason: json.overrideReason === undefined
      ? undefined
      : boundedText(json.overrideReason, 'Passport item overrideReason', 8_192) || undefined,
    reasonCode: json.reasonCode === undefined
      ? undefined
      : boundedText(json.reasonCode, 'Passport item reasonCode', 1_024) || undefined,
    verifiedAt,
    expiresAt,
    evidence: json.evidence
      ? {
          source: requiredText(evidence.source, 'Passport evidence source', 1_024),
          summary: boundedText(evidence.summary, 'Passport evidence summary'),
          contentHash: base64ToHex(evidence.contentSha256),
          capturedAt: requiredSafeUint(evidence.capturedAtMs, 'Passport evidence capturedAtMs'),
          state: evidenceState!
        }
      : undefined,
    revision
  }
}

export function stintPassportFromProtoJson(value: JsonValue): StintPassport {
  assertJsonBounds(value, 'StintPassport ProtoJSON')
  const json = object(value)
  if (numeric(json.contractVersion) !== STINT_PASSPORT_CONTRACT_VERSION) {
    throw new Error(`Unsupported StintPassport contract version: ${String(json.contractVersion)}`)
  }
  const identity = object(json.identity)
  const itemValues = array(json.items)
  if (itemValues.length !== STINT_PASSPORT_ITEM_COUNT) {
    throw new Error(`StintPassport requires exactly ${STINT_PASSPORT_ITEM_COUNT} items.`)
  }
  const items = itemValues.map(itemFromJson)
  const challengeCompletedAt = optionalSafeUint(json.challengeCompletedAtMs, 'StintPassport challengeCompletedAtMs')
  const closedAt = optionalSafeUint(json.closedAtMs, 'StintPassport closedAtMs')
  const revision = requiredSafeUint(json.revision, 'StintPassport revision')
  if (revision < 1) throw new Error('StintPassport revision must be at least one.')
  const coverage = finiteNumber(json.coverage, 'StintPassport coverage')
  if (coverage < 0 || coverage > 1) throw new Error('StintPassport coverage must be between zero and one.')
  const applicableItems = finiteNumber(json.applicableItems, 'StintPassport applicableItems')
  const coveredItems = finiteNumber(json.coveredItems, 'StintPassport coveredItems')
  if (!Number.isInteger(applicableItems) || !Number.isInteger(coveredItems)) {
    throw new Error('StintPassport coverage counters must be integers.')
  }
  const passport: StintPassport = {
    contractVersion: STINT_PASSPORT_CONTRACT_VERSION,
    identity: {
      stintId: requiredText(identity.stintId, 'StintPassport stintId', 512),
      sessionRef: requiredText(identity.sessionRef, 'StintPassport sessionRef', 1_024),
      trackRef: requiredText(identity.trackRef, 'StintPassport trackRef', 1_024),
      trackLabel: boundedText(identity.trackLabel, 'StintPassport trackLabel', 4_096),
      carRef: requiredText(identity.carRef, 'StintPassport carRef', 1_024),
      carLabel: boundedText(identity.carLabel, 'StintPassport carLabel', 4_096),
      driverRef: requiredText(identity.driverRef, 'StintPassport driverRef', 1_024),
      driverLabel: boundedText(identity.driverLabel, 'StintPassport driverLabel', 4_096),
      teamRef: identity.teamRef === undefined
        ? undefined
        : boundedText(identity.teamRef, 'StintPassport teamRef', 1_024) || undefined,
      teamLabel: identity.teamLabel === undefined
        ? undefined
        : boundedText(identity.teamLabel, 'StintPassport teamLabel', 4_096) || undefined,
      startedAt: requiredSafeUint(identity.startedAtMs, 'StintPassport startedAtMs')
    },
    lifecycle: reverseMap(LIFECYCLE_TO_PROTO, json.lifecycle),
    telemetryContext: reverseMap(TELEMETRY_TO_PROTO, json.telemetryContext),
    items,
    coverage,
    applicableItems,
    coveredItems,
    challengeCompletedAt,
    challengeOwner: ownerFromJson(json.challengeOwner),
    closedAt,
    closeReason: json.closeReason === undefined
      ? undefined
      : boundedText(json.closeReason, 'StintPassport closeReason', 64) as StintPassport['closeReason'] || undefined,
    interrupted: (() => {
      if (typeof json.interrupted !== 'boolean') throw new Error('StintPassport interrupted must be a boolean.')
      return json.interrupted
    })(),
    persisted: (() => {
      if (typeof json.persisted !== 'boolean') throw new Error('StintPassport persisted must be a boolean.')
      return json.persisted
    })(),
    revision,
    durability: boundedText(json.durability, 'StintPassport durability', 64) === 'durable'
      ? 'durable'
      : boundedText(json.durability, 'StintPassport durability', 64) === 'failed'
        ? 'failed'
        : boundedText(json.durability, 'StintPassport durability', 64) === 'quarantined'
          ? 'quarantined'
          : boundedText(json.durability, 'StintPassport durability', 64) === 'pending'
            ? 'pending'
            : json.persisted === true
              ? 'durable'
              : 'ephemeral'
  }
  const calculated = calculatePassportCoverage(passport.items)
  if (
    Math.abs(calculated.coverage - passport.coverage) > Number.EPSILON ||
    calculated.applicableItems !== passport.applicableItems ||
    calculated.coveredItems !== passport.coveredItems
  ) {
    throw new Error('StintPassport coverage counters do not match the item set.')
  }
  return passport
}

export function encodeStintPassport(passport: StintPassport): Uint8Array {
  return toBinary(stintPassportSchema, fromJson(stintPassportSchema, stintPassportToProtoJson(passport)))
}

export function decodeStintPassport(bytes: Uint8Array): StintPassport {
  assertBinaryInput(bytes, 'StintPassport')
  const message = fromBinary(stintPassportSchema, bytes)
  return stintPassportFromProtoJson(
    toJson(stintPassportSchema, message, { alwaysEmitImplicit: true })
  )
}

export function stintPassportProtoJson(passport: StintPassport): JsonValue {
  const message = fromJson(stintPassportSchema, stintPassportToProtoJson(passport))
  return toJson(stintPassportSchema, message, { alwaysEmitImplicit: true })
}

export const phase02ContractRuntime = {
  descriptorSha256: PHASE02_DESCRIPTOR_SHA256,
  raceOpsEventType: raceOpsEventSchema.typeName,
  stintPassportType: stintPassportSchema.typeName
} as const
