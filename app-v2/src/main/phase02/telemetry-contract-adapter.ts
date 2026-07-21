import { createHash } from 'node:crypto'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import {
  emptyConfidence,
  emptyObservedInterval,
  type CanonicalFact,
  type CanonicalFactValue,
  type CanonicalRaceOpsEvent,
  type PrivacyClass,
  type ProvenanceReference,
  type TelemetryContext
} from '../../shared/phase02-contracts'
import { PHASE02_DESCRIPTOR_SHA256 } from './generated/contract-descriptor'

const SOURCE_ID = 'ultimate-sim.telemetry-hub'
const TRANSFORM_ID = 'phase02.telemetry-contract-adapter.v1'
const MAX_LIVE_AGE_MS = 1_000

export interface TelemetryContractAdapterInput {
  snapshot: TelemetrySnapshot | null
  sequence: bigint
  gap: boolean
  processedAtMs: number
  observedMonotonicNs: bigint
}
function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function safeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function privacyRank(value: PrivacyClass): number {
  return value === 'D5' ? 5 : value === 'D4' ? 4 : value === 'D3' ? 3 : value === 'D2' ? 2 : value === 'D1' ? 1 : 0
}

function maxPrivacy(values: PrivacyClass[]): PrivacyClass {
  return values.reduce<PrivacyClass>(
    (highest, value) => privacyRank(value) > privacyRank(highest) ? value : highest,
    'D0'
  )
}

function telemetryContext(snapshot: TelemetrySnapshot | null): TelemetryContext {
  if (!snapshot?.connected) return 'unknown'
  const state = snapshot.replayContext?.state
  return state === 'live' || state === 'replay' || state === 'unknown' ? state : 'live'
}

function sessionIdentity(snapshot: TelemetrySnapshot | null): string {
  const canonical = clean(snapshot?.replayContext?.sessionIdentity)
  if (canonical) return `${snapshot?.sim ?? 'none'}:${canonical}`
  if (safeInteger(snapshot?.sessionUniqueId) && (snapshot?.sessionUniqueId as number) >= 0) {
    return `${snapshot?.sim ?? 'none'}:session-unique:${snapshot?.sessionUniqueId}`
  }
  return ''
}

function opaqueRef(kind: string, value: string): string {
  if (!value) return ''
  return `${kind}:${createHash('sha256').update(`${kind}:${value}`, 'utf8').digest('hex').slice(0, 24)}`
}

function player(snapshot: TelemetrySnapshot | null): NonNullable<TelemetrySnapshot['drivers']>[number] | undefined {
  return snapshot?.drivers?.find((driver) => driver.isPlayer)
}

function provenance(
  input: TelemetryContractAdapterInput,
  unit: string,
  privacyClass: PrivacyClass,
  present: boolean
): ProvenanceReference {
  const sourceTick = finite(input.snapshot?.timestamp)
    ? String(Math.max(0, Math.round(input.snapshot?.timestamp as number)))
    : input.sequence.toString()
  const ageMs = finite(input.snapshot?.timestamp)
    ? Math.max(0, Math.round(input.processedAtMs - (input.snapshot?.timestamp as number)))
    : 0
  return {
    sourceId: SOURCE_ID,
    transformId: TRANSFORM_ID,
    schemaFingerprint: PHASE02_DESCRIPTOR_SHA256,
    canonicalUnit: unit,
    validity: present ? ageMs > MAX_LIVE_AGE_MS ? 'stale' : 'valid' : 'missing',
    nullReason: present
      ? 'unspecified'
      : input.snapshot?.connected === false || input.snapshot === null
        ? 'source-disconnected'
        : 'not-available',
    sourceTick,
    observedMonotonicNs: input.observedMonotonicNs.toString(),
    ageMs: String(ageMs),
    privacyClass
  }
}

function fact(
  input: TelemetryContractAdapterInput,
  name: string,
  unit: string,
  privacyClass: PrivacyClass,
  value: CanonicalFactValue | undefined
): CanonicalFact {
  return {
    name,
    canonicalUnit: unit,
    value,
    provenance: provenance(input, unit, privacyClass, value !== undefined)
  }
}

function stringFact(
  input: TelemetryContractAdapterInput,
  name: string,
  value: unknown,
  privacyClass: PrivacyClass
): CanonicalFact {
  const normalized = clean(value)
  return fact(input, name, 'text', privacyClass, normalized === undefined ? undefined : { kind: 'string', value: normalized })
}

function doubleFact(
  input: TelemetryContractAdapterInput,
  name: string,
  value: unknown,
  unit: string,
  privacyClass: PrivacyClass
): CanonicalFact {
  return fact(input, name, unit, privacyClass, finite(value) ? { kind: 'double', value } : undefined)
}

function unsignedFact(
  input: TelemetryContractAdapterInput,
  name: string,
  value: unknown,
  unit: string,
  privacyClass: PrivacyClass
): CanonicalFact {
  return fact(
    input,
    name,
    unit,
    privacyClass,
    safeInteger(value) && (value as number) >= 0
      ? { kind: 'unsigned', value: String(value) }
      : undefined
  )
}

function boolFact(
  input: TelemetryContractAdapterInput,
  name: string,
  value: unknown,
  privacyClass: PrivacyClass
): CanonicalFact {
  return fact(input, name, 'bool', privacyClass, typeof value === 'boolean' ? { kind: 'bool', value } : undefined)
}

export function telemetrySnapshotToRaceOpsEvent(
  input: TelemetryContractAdapterInput
): CanonicalRaceOpsEvent {
  const snapshot = input.snapshot
  const currentPlayer = player(snapshot)
  const sessionKey = sessionIdentity(snapshot)
  const sessionRef = opaqueRef('session', sessionKey)
  const trackName = clean(snapshot?.trackName)
  const trackConfig = clean(snapshot?.trackConfigName)
  const trackKey = `${snapshot?.sim ?? 'none'}|${trackName ?? ''}|${trackConfig ?? ''}`
  const carName = clean(snapshot?.carName)
  const carPath = clean(snapshot?.carPath)
  const driverName = clean(snapshot?.driverName) ?? clean(currentPlayer?.name)
  const driverKey = safeInteger(currentPlayer?.custId)
    ? `cust:${currentPlayer?.custId}`
    : driverName
      ? `name:${driverName.toLowerCase()}`
      : ''
  const teamName = clean(currentPlayer?.teamName)
  const teamKey = safeInteger(currentPlayer?.teamId)
    ? `team:${currentPlayer?.teamId}`
    : teamName
      ? `name:${teamName.toLowerCase()}`
      : ''
  const context = telemetryContext(snapshot)
  const facts: CanonicalFact[] = [
    boolFact(input, 'telemetry.connected', snapshot?.connected ?? false, 'D1'),
    stringFact(input, 'telemetry.sim', snapshot?.sim, 'D1'),
    stringFact(input, 'session.identity', sessionKey, 'D2'),
    stringFact(input, 'session.type', snapshot?.sessionType, 'D2'),
    stringFact(input, 'session.state', snapshot?.sessionState, 'D2'),
    stringFact(input, 'session.track_name', trackName, 'D2'),
    stringFact(input, 'session.track_config', trackConfig, 'D2'),
    stringFact(input, 'session.track_ref', opaqueRef('track', trackKey), 'D2'),
    stringFact(input, 'car.name', carName, 'D2'),
    stringFact(input, 'car.path', carPath, 'D2'),
    stringFact(input, 'car.ref', opaqueRef('car', `${snapshot?.sim ?? 'none'}|${carPath ?? carName ?? ''}`), 'D2'),
    stringFact(input, 'driver.name', driverName, 'D3'),
    stringFact(input, 'driver.ref', opaqueRef('driver', driverKey), 'D3'),
    unsignedFact(input, 'driver.customer_id', currentPlayer?.custId, 'id', 'D3'),
    stringFact(input, 'team.name', teamName, 'D3'),
    stringFact(input, 'team.ref', opaqueRef('team', teamKey), 'D3'),
    unsignedFact(input, 'team.id', currentPlayer?.teamId, 'id', 'D3'),
    doubleFact(input, 'fuel.liters', snapshot?.fuelLiters, 'L', 'D2'),
    doubleFact(input, 'fuel.per_lap', snapshot?.fuelPerLap, 'L/lap', 'D2'),
    doubleFact(input, 'session.laps_remaining', snapshot?.lapsRemaining, 'lap', 'D2'),
    unsignedFact(input, 'session.current_lap', snapshot?.currentLap, 'lap', 'D2'),
    doubleFact(input, 'weather.track_temp', snapshot?.trackTempC, 'Cel', 'D2'),
    doubleFact(input, 'weather.air_temp', snapshot?.airTempC, 'Cel', 'D2'),
    doubleFact(input, 'weather.wetness', snapshot?.trackWetnessPct, 'ratio', 'D2'),
    boolFact(input, 'weather.raining', snapshot?.isRaining, 'D2'),
    stringFact(input, 'telemetry.context', context, 'D1')
  ]
  const sourceTick = finite(snapshot?.timestamp)
    ? String(Math.max(0, Math.round(snapshot?.timestamp as number)))
    : input.sequence.toString()
  const interval = emptyObservedInterval()
  interval.sourceTickStart = sourceTick
  interval.sourceTickEnd = sourceTick
  interval.monotonicNsStart = input.observedMonotonicNs.toString()
  interval.monotonicNsEnd = input.observedMonotonicNs.toString()
  const flags: CanonicalRaceOpsEvent['integrityFlags'] = []
  if (input.gap) flags.push('gap')
  if (facts.some((candidate) => candidate.provenance?.validity === 'stale')) flags.push('stale')
  flags.push('derived')
  const privacyClass = maxPrivacy(facts.map((candidate) => candidate.provenance?.privacyClass ?? 'D0'))
  return {
    eventId: `phase02-tap-${input.sequence}`,
    eventClass: 'fact',
    eventType: 'ultimate.sim.telemetry.snapshot.v1',
    sessionRef,
    actorRef: 'system:telemetry-contract-adapter',
    subjectRef: opaqueRef('car', `${snapshot?.sim ?? 'none'}|${carPath ?? carName ?? ''}`),
    observedInterval: interval,
    facts,
    confidence: emptyConfidence(),
    severity: 'info',
    priority: 'background',
    evidenceRefs: [],
    policyRef: 'local-only.passport.v1',
    capabilityRef: 'phase02.tap.read-only',
    consentEpoch: '0',
    approvalRef: '',
    correlationId: sessionRef || `disconnected:${input.sequence}`,
    dedupeKey: `${sessionRef || 'disconnected'}:${sourceTick}:${input.sequence}`,
    privacyClass,
    integrityFlags: flags,
    supersedesEventId: '',
    sequence: input.sequence.toString(),
    partitionKey: sessionRef ? `session:${sessionRef}` : 'telemetry:disconnected',
    partitionSeq: input.sequence.toString(),
    telemetryContext: context,
    sourceTick,
    observedMonotonicNs: input.observedMonotonicNs.toString(),
    ttlMs: '2000'
  }
}
