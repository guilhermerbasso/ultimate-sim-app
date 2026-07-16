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
import {
  STINT_PASSPORT_CONTRACT_VERSION,
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

function reverseMap<T extends string>(map: Record<T, string>, value: unknown, fallback: T): T {
  const entry = Object.entries(map).find(([, proto]) => proto === value)
  return (entry?.[0] as T | undefined) ?? fallback
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

function hexToBase64(value: string): string {
  return Buffer.from(value, 'hex').toString('base64')
}

function base64ToHex(value: unknown): string {
  return typeof value === 'string' ? Buffer.from(value, 'base64').toString('hex') : ''
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
  let factValue: CanonicalFact['value']
  if (json.doubleValue !== undefined) factValue = { kind: 'double', value: numeric(json.doubleValue) }
  else if (json.signedValue !== undefined) factValue = { kind: 'signed', value: text(json.signedValue) }
  else if (json.unsignedValue !== undefined) factValue = { kind: 'unsigned', value: text(json.unsignedValue) }
  else if (json.boolValue !== undefined) factValue = { kind: 'bool', value: bool(json.boolValue) }
  else if (json.stringValue !== undefined) factValue = { kind: 'string', value: text(json.stringValue) }
  else if (json.bytesValue !== undefined) {
    factValue = { kind: 'bytes', value: Uint8Array.from(Buffer.from(text(json.bytesValue), 'base64')) }
  }
  const provenanceJson = object(json.provenance)
  return {
    name: text(json.name),
    canonicalUnit: text(json.canonicalUnit),
    value: factValue,
    provenance: json.provenance
      ? {
          sourceId: text(provenanceJson.sourceId),
          transformId: text(provenanceJson.transformId),
          schemaFingerprint: text(provenanceJson.schemaFingerprint),
          canonicalUnit: text(provenanceJson.canonicalUnit),
          validity: reverseMap(VALIDITY_TO_PROTO, provenanceJson.validity, 'unspecified'),
          nullReason: reverseMap(NULL_REASON_TO_PROTO, provenanceJson.nullReason, 'unspecified'),
          sourceTick: text(provenanceJson.sourceTick),
          observedMonotonicNs: text(provenanceJson.observedMonotonicNs),
          ageMs: text(provenanceJson.ageMs),
          privacyClass: reverseMap(PRIVACY_TO_PROTO, provenanceJson.privacyClass, 'D0')
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
  const json = object(value)
  const interval = object(json.observedInterval)
  const confidence = object(json.confidence)
  return {
    eventId: text(json.eventId),
    eventClass: reverseMap(EVENT_CLASS_TO_PROTO, json.eventClass, 'unspecified'),
    eventType: text(json.eventType),
    sessionRef: text(json.sessionRef),
    actorRef: text(json.actorRef),
    subjectRef: text(json.subjectRef),
    observedInterval: {
      sourceTickStart: text(interval.sourceTickStart),
      sourceTickEnd: text(interval.sourceTickEnd),
      monotonicNsStart: text(interval.monotonicNsStart),
      monotonicNsEnd: text(interval.monotonicNsEnd),
      simTimeMsStart: text(interval.simTimeMsStart),
      simTimeMsEnd: text(interval.simTimeMsEnd)
    },
    facts: array(json.facts).map(factFromJson),
    confidence: {
      value: numeric(confidence.value),
      method: text(confidence.method),
      abstained: bool(confidence.abstained)
    },
    severity: reverseMap(SEVERITY_TO_PROTO, json.severity, 'unspecified'),
    priority: reverseMap(PRIORITY_TO_PROTO, json.priority, 'unspecified'),
    evidenceRefs: array(json.evidenceRefs).map(text),
    policyRef: text(json.policyRef),
    capabilityRef: text(json.capabilityRef),
    consentEpoch: text(json.consentEpoch),
    approvalRef: text(json.approvalRef),
    correlationId: text(json.correlationId),
    dedupeKey: text(json.dedupeKey),
    privacyClass: reverseMap(PRIVACY_TO_PROTO, json.privacyClass, 'D0'),
    integrityFlags: array(json.integrityFlags).map((flag) =>
      reverseMap(INTEGRITY_TO_PROTO, flag, 'unspecified')
    ),
    supersedesEventId: text(json.supersedesEventId),
    sequence: text(json.sequence),
    partitionKey: text(json.partitionKey),
    partitionSeq: text(json.partitionSeq),
    telemetryContext: reverseMap(TELEMETRY_TO_PROTO, json.telemetryContext, 'unspecified'),
    sourceTick: text(json.sourceTick),
    observedMonotonicNs: text(json.observedMonotonicNs),
    ttlMs: text(json.ttlMs)
  }
}

export function encodeRaceOpsEvent(event: CanonicalRaceOpsEvent): Uint8Array {
  return toBinary(raceOpsEventSchema, fromJson(raceOpsEventSchema, raceOpsEventToProtoJson(event)))
}

export function decodeRaceOpsEvent(bytes: Uint8Array): CanonicalRaceOpsEvent {
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
  if (event.eventId !== envelope.id || event.eventType !== envelope.type) {
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
    persisted: passport.persisted
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
  const json = object(value)
  if (!text(json.memberId)) return undefined
  return {
    memberId: text(json.memberId),
    role: reverseMap(ROLE_TO_PROTO, json.role, 'driver')
  }
}

function itemFromJson(value: unknown): PassportItem {
  const json = object(value)
  const evidence = object(json.evidence)
  const verifiedAt = Number(text(json.verifiedAtMs))
  const expiresAt = Number(text(json.expiresAtMs))
  return {
    id: reverseMap(ITEM_ID_TO_PROTO, json.itemId, 'session-identity'),
    status: reverseMap(ITEM_STATUS_TO_PROTO, json.status, 'unknown'),
    owner: ownerFromJson(json.owner),
    detail: text(json.detail),
    overrideReason: text(json.overrideReason) || undefined,
    verifiedAt: verifiedAt > 0 ? verifiedAt : undefined,
    expiresAt: expiresAt > 0 ? expiresAt : undefined,
    evidence: json.evidence
      ? {
          source: text(evidence.source),
          summary: text(evidence.summary),
          contentHash: base64ToHex(evidence.contentSha256),
          capturedAt: Number(text(evidence.capturedAtMs)),
          state: text(evidence.state) === 'retention-redacted'
            ? 'retention-redacted'
            : text(evidence.state) === 'unavailable'
              ? 'unavailable'
              : 'available'
        }
      : undefined,
    revision: Number(text(json.revision))
  }
}

export function stintPassportFromProtoJson(value: JsonValue): StintPassport {
  const json = object(value)
  const identity = object(json.identity)
  const challengeCompletedAt = Number(text(json.challengeCompletedAtMs))
  const closedAt = Number(text(json.closedAtMs))
  return {
    contractVersion: STINT_PASSPORT_CONTRACT_VERSION,
    identity: {
      stintId: text(identity.stintId),
      sessionRef: text(identity.sessionRef),
      trackRef: text(identity.trackRef),
      trackLabel: text(identity.trackLabel),
      carRef: text(identity.carRef),
      carLabel: text(identity.carLabel),
      driverRef: text(identity.driverRef),
      driverLabel: text(identity.driverLabel),
      teamRef: text(identity.teamRef) || undefined,
      teamLabel: text(identity.teamLabel) || undefined,
      startedAt: Number(text(identity.startedAtMs))
    },
    lifecycle: reverseMap(LIFECYCLE_TO_PROTO, json.lifecycle, 'awaiting-checklist'),
    telemetryContext: reverseMap(TELEMETRY_TO_PROTO, json.telemetryContext, 'unknown'),
    items: array(json.items).map(itemFromJson),
    coverage: numeric(json.coverage),
    applicableItems: numeric(json.applicableItems),
    coveredItems: numeric(json.coveredItems),
    challengeCompletedAt: challengeCompletedAt > 0 ? challengeCompletedAt : undefined,
    challengeOwner: ownerFromJson(json.challengeOwner),
    closedAt: closedAt > 0 ? closedAt : undefined,
    closeReason: text(json.closeReason) as StintPassport['closeReason'] || undefined,
    interrupted: bool(json.interrupted),
    persisted: bool(json.persisted)
  }
}

export function encodeStintPassport(passport: StintPassport): Uint8Array {
  return toBinary(stintPassportSchema, fromJson(stintPassportSchema, stintPassportToProtoJson(passport)))
}

export function decodeStintPassport(bytes: Uint8Array): StintPassport {
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
