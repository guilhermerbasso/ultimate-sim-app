export const PHASE02_CONTRACT_VERSION = 1 as const

export type DataValidity = 'unspecified' | 'valid' | 'stale' | 'missing' | 'invalid'
export type NullReason =
  | 'unspecified'
  | 'not-available'
  | 'not-applicable'
  | 'source-disconnected'
  | 'redacted'
  | 'out-of-range'
export type PrivacyClass = 'D0' | 'D1' | 'D2' | 'D3' | 'D4' | 'D5'
export type RaceOpsEventClass =
  | 'unspecified'
  | 'fact'
  | 'inference'
  | 'recommendation'
  | 'decision'
  | 'action'
  | 'outcome'
  | 'disclosure'
export type RaceOpsSeverity = 'unspecified' | 'info' | 'notice' | 'warning' | 'critical'
export type RaceOpsPriority = 'unspecified' | 'background' | 'normal' | 'high' | 'immediate'
export type TelemetryContext = 'unspecified' | 'live' | 'replay' | 'unknown'
export type IntegrityFlag =
  | 'unspecified'
  | 'stale'
  | 'gap'
  | 'derived'
  | 'redacted'
  | 'externally-attested'

export interface ProvenanceReference {
  sourceId: string
  transformId: string
  schemaFingerprint: string
  canonicalUnit: string
  validity: DataValidity
  nullReason: NullReason
  sourceTick: string
  observedMonotonicNs: string
  ageMs: string
  privacyClass: PrivacyClass
}
export type CanonicalFactValue =
  | { kind: 'double'; value: number }
  | { kind: 'signed'; value: string }
  | { kind: 'unsigned'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'string'; value: string }
  | { kind: 'bytes'; value: Uint8Array }

export interface CanonicalFact {
  name: string
  canonicalUnit: string
  value?: CanonicalFactValue
  provenance?: ProvenanceReference
}

export interface ObservedInterval {
  sourceTickStart: string
  sourceTickEnd: string
  monotonicNsStart: string
  monotonicNsEnd: string
  simTimeMsStart: string
  simTimeMsEnd: string
}

export interface Confidence {
  value: number
  method: string
  abstained: boolean
}

export interface CanonicalRaceOpsEvent {
  eventId: string
  eventClass: RaceOpsEventClass
  eventType: string
  sessionRef: string
  actorRef: string
  subjectRef: string
  observedInterval: ObservedInterval
  facts: CanonicalFact[]
  confidence: Confidence
  severity: RaceOpsSeverity
  priority: RaceOpsPriority
  evidenceRefs: string[]
  policyRef: string
  capabilityRef: string
  consentEpoch: string
  approvalRef: string
  correlationId: string
  dedupeKey: string
  privacyClass: PrivacyClass
  integrityFlags: IntegrityFlag[]
  supersedesEventId: string
  sequence: string
  partitionKey: string
  partitionSeq: string
  telemetryContext: TelemetryContext
  sourceTick: string
  observedMonotonicNs: string
  ttlMs: string
}

export interface RaceOpsCloudEvent {
  specversion: '1.0'
  id: string
  source: string
  type: string
  subject?: string
  time?: string
  datacontenttype: 'application/x-protobuf'
  dataschema: 'urn:ultimate-sim:raceops:v1:race-ops-event'
  sequence: string
  sourcetick: string
  monotonicns: string
  sessionid: string
  producerid: string
  schemafp: string
  correlationid: string
  causationid: string
  privacyclass: string
  rolepolicyid: string
  capgrantid: string
  consentepoch: string
  approvalid: string
  partitionkey: string
  partitionseq: string
  stale: boolean
  derived: boolean
  gap: boolean
  data: Uint8Array
}

export function emptyObservedInterval(): ObservedInterval {
  return {
    sourceTickStart: '0',
    sourceTickEnd: '0',
    monotonicNsStart: '0',
    monotonicNsEnd: '0',
    simTimeMsStart: '0',
    simTimeMsEnd: '0'
  }
}

export function emptyConfidence(): Confidence {
  return { value: 0, method: 'not-applicable', abstained: true }
}

export function canonicalFactValue(fact: CanonicalFact | undefined): unknown {
  if (!fact?.value) return undefined
  return fact.value.value
}

export function canonicalFactsByName(
  facts: readonly CanonicalFact[]
): ReadonlyMap<string, CanonicalFact> {
  return new Map(facts.map((fact) => [fact.name, fact]))
}
