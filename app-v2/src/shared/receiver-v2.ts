import type { SimId, TelemetrySnapshot } from './telemetry'

export const RECEIVER_PROTOCOL_VERSION = 2
export const RECEIVER_SCHEMA_VERSION = 1
export const RECEIVER_SUBPROTOCOL = 'ultimate-sim-receiver-v2'
export const RECEIVER_MIN_HZ = 20
export const RECEIVER_MAX_HZ = 60
export const RECEIVER_DEFAULT_HZ = 20
export const RECEIVER_MAX_CLIENT_MESSAGE_BYTES = 4_096
export const RECEIVER_MAX_SERVER_MESSAGE_BYTES = 16_384
export const RECEIVER_HEARTBEAT_MS = 5_000
export const RECEIVER_SETUP_BUDGET_MS = 5 * 60 * 1000
export const RECEIVER_LATENCY_BUDGET_MS = 100
export const RECEIVER_RELIABILITY_TARGET_PCT = 99

export const RECEIVER_CAPABILITIES = [
  'telemetry.fast.v1',
  'ack',
  'resync',
  'metrics'
] as const

export type ReceiverCapability = (typeof RECEIVER_CAPABILITIES)[number]
export type ReceiverTransportProfile = 'local-development' | 'https-wss' | 'blocked'

export interface ReceiverClientDescriptor {
  id: string
  name?: string
  version?: string
}

export interface ReceiverHelloMessage {
  type: 'hello'
  protocolVersions: number[]
  schemaVersions: number[]
  capabilities: ReceiverCapability[]
  requestedHz: number
  maxPayloadBytes: number
  resumeFrom?: number
  client: ReceiverClientDescriptor
}

export interface ReceiverAckMessage {
  type: 'ack'
  sequence: number
}

export interface ReceiverResyncMessage {
  type: 'resync'
  afterSequence: number
  reason: 'gap' | 'reconnect' | 'manual'
}

export type ReceiverClientMessage =
  | ReceiverHelloMessage
  | ReceiverAckMessage
  | ReceiverResyncMessage

export interface ReceiverTelemetryFlags {
  green: boolean
  yellow: boolean
  blue: boolean
  white: boolean
  checkered: boolean
  red: boolean
}

export interface ReceiverTelemetryData {
  connected: boolean
  sim: SimId
  sampleTimestamp: number
  speedKmh: number
  rpm: number
  gear: number
  throttle: number
  brake: number
  clutch: number
  fuelLiters: number | null
  fuelLapsRemaining: number | null
  lap: number | null
  position: number | null
  classPosition: number | null
  deltaToBestSec: number | null
  sessionTimeRemainingSec: number | null
  pitLimiter: boolean
  onPitRoad: boolean
  carLeftRight: 'clear' | 'left' | 'right' | 'both'
  flags: ReceiverTelemetryFlags
}

export interface ReceiverWelcomeMessage {
  type: 'welcome'
  protocolVersion: typeof RECEIVER_PROTOCOL_VERSION
  schemaVersion: typeof RECEIVER_SCHEMA_VERSION
  capabilities: ReceiverCapability[]
  sessionId: string
  rateHz: number
  maxPayloadBytes: number
  heartbeatMs: number
  highWater: number
  serverTime: number
  readOnly: true
  commands: false
}

export interface ReceiverTelemetryMessage {
  type: 'telemetry'
  sequence: number
  sentAt: number
  replay: boolean
  data: ReceiverTelemetryData
}

export interface ReceiverSnapshotMessage {
  type: 'snapshot'
  sequence: number
  highWater: number
  sentAt: number
  reason: 'initial' | 'reconnect' | 'resync' | 'replay-unavailable'
  data: ReceiverTelemetryData
}

export interface ReceiverResyncCompleteMessage {
  type: 'resync-complete'
  highWater: number
  replayed: number
  snapshot: boolean
}

export interface ReceiverRateMessage {
  type: 'rate'
  rateHz: number
  reason: 'negotiated' | 'backpressure'
}

export interface ReceiverErrorMessage {
  type: 'error'
  code: string
  message: string
  retryable: boolean
}

export type ReceiverServerMessage =
  | ReceiverWelcomeMessage
  | ReceiverTelemetryMessage
  | ReceiverSnapshotMessage
  | ReceiverResyncCompleteMessage
  | ReceiverRateMessage
  | ReceiverErrorMessage

export interface ReceiverV2ClientInfo {
  id: string
  address: string
  userAgent: string | null
  connectedAt: number
  clientName: string | null
  rateHz: number
  lastAckSequence: number
}

export interface ReceiverV2Metrics {
  startedAt: number | null
  firstPairedAt: number | null
  firstReadyAt: number | null
  setupTimeMs: number | null
  setupBudgetMs: number
  setupBudgetPassed: boolean | null
  activeClients: number
  connections: number
  reconnects: number
  resyncs: number
  replayedFrames: number
  telemetryFrames: number
  droppedFrames: number
  slowConsumerDisconnects: number
  latencySamples: number
  latencyP50Ms: number | null
  latencyP95Ms: number | null
  latencyMaxMs: number | null
  latencyBudgetMs: number
  latencyBudgetPassed: boolean | null
  reliabilityPct: number
  reliabilityTargetPct: number
  reliabilityPassed: boolean | null
}

export interface ReceiverV2Status {
  enabled: boolean
  protocolVersion: number
  schemaVersion: number
  capabilities: ReceiverCapability[]
  minHz: number
  maxHz: number
  transportProfile: ReceiverTransportProfile
  bindAddress: string | null
  baseUrl: string | null
  pairingUrl: string | null
  localPairingUrl: string | null
  pairingExpiresAt: number | null
  pairingConsumed: boolean
  blockedReason: string | null
  readOnly: true
  commandsEnabled: false
  secretInQuery: false
  clients: ReceiverV2ClientInfo[]
  metrics: ReceiverV2Metrics
}

export interface ReceiverPairStatusResponse {
  authenticated: boolean
  passwordRequired: boolean
  protocolVersion: number
  schemaVersion: number
  capabilities: ReceiverCapability[]
  minHz: number
  maxHz: number
  maxPayloadBytes: number
  heartbeatMs: number
  transportProfile: ReceiverTransportProfile
  readOnly: true
  commandsEnabled: false
}

export type ReceiverParseResult =
  | { ok: true; value: ReceiverClientMessage }
  | { ok: false; code: string; message: string }

const SIM_IDS = new Set<SimId>(['iracing', 'acc', 'ac', 'ams2', 'lmu', 'mock', 'replay', 'none'])
const CAPABILITIES = new Set<string>(RECEIVER_CAPABILITIES)
const CAR_SIDES = new Set(['clear', 'left', 'right', 'both'])
const RESYNC_REASONS = new Set(['gap', 'reconnect', 'manual'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed)
  return Object.keys(value).every((key) => allowedKeys.has(key))
}

function boundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
}

function boundedNumberArray(value: unknown, maxItems: number, min: number, max: number): value is number[] {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.length <= maxItems &&
    value.every((item) => boundedInteger(item, min, max))
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function parseHello(value: Record<string, unknown>): ReceiverParseResult {
  if (!hasOnlyKeys(value, [
    'type',
    'protocolVersions',
    'schemaVersions',
    'capabilities',
    'requestedHz',
    'maxPayloadBytes',
    'resumeFrom',
    'client'
  ])) {
    return { ok: false, code: 'schema_extra_field', message: 'Hello contains an unsupported field.' }
  }
  if (!boundedNumberArray(value.protocolVersions, 4, 1, 16)) {
    return { ok: false, code: 'schema_protocol_versions', message: 'protocolVersions must contain 1-4 bounded integers.' }
  }
  if (!boundedNumberArray(value.schemaVersions, 4, 1, 16)) {
    return { ok: false, code: 'schema_versions', message: 'schemaVersions must contain 1-4 bounded integers.' }
  }
  if (!Array.isArray(value.capabilities) ||
      value.capabilities.length === 0 ||
      value.capabilities.length > RECEIVER_CAPABILITIES.length ||
      !value.capabilities.every((item) => typeof item === 'string' && CAPABILITIES.has(item)) ||
      new Set(value.capabilities).size !== value.capabilities.length) {
    return { ok: false, code: 'schema_capabilities', message: 'capabilities contains an unsupported or duplicate capability.' }
  }
  if (!boundedInteger(value.requestedHz, 1, RECEIVER_MAX_HZ)) {
    return { ok: false, code: 'schema_rate', message: `requestedHz must be between 1 and ${RECEIVER_MAX_HZ}.` }
  }
  if (!boundedInteger(value.maxPayloadBytes, 1_024, RECEIVER_MAX_SERVER_MESSAGE_BYTES)) {
    return { ok: false, code: 'schema_payload', message: 'maxPayloadBytes is outside the supported range.' }
  }
  if (value.resumeFrom !== undefined && !boundedInteger(value.resumeFrom, 0, Number.MAX_SAFE_INTEGER)) {
    return { ok: false, code: 'schema_cursor', message: 'resumeFrom must be a non-negative safe integer.' }
  }
  if (!isRecord(value.client) ||
      !hasOnlyKeys(value.client, ['id', 'name', 'version']) ||
      !boundedString(value.client.id, 1, 64) ||
      (value.client.name !== undefined && !boundedString(value.client.name, 1, 64)) ||
      (value.client.version !== undefined && !boundedString(value.client.version, 1, 32))) {
    return { ok: false, code: 'schema_client', message: 'client metadata is invalid or too large.' }
  }
  return {
    ok: true,
    value: {
      type: 'hello',
      protocolVersions: value.protocolVersions,
      schemaVersions: value.schemaVersions,
      capabilities: value.capabilities as ReceiverCapability[],
      requestedHz: value.requestedHz,
      maxPayloadBytes: value.maxPayloadBytes,
      ...(value.resumeFrom === undefined ? {} : { resumeFrom: value.resumeFrom }),
      client: {
        id: value.client.id,
        ...(value.client.name === undefined ? {} : { name: value.client.name }),
        ...(value.client.version === undefined ? {} : { version: value.client.version })
      }
    }
  }
}

export function parseReceiverClientMessage(input: string | Uint8Array): ReceiverParseResult {
  const size = typeof input === 'string' ? utf8ByteLength(input) : input.byteLength
  if (size === 0 || size > RECEIVER_MAX_CLIENT_MESSAGE_BYTES) {
    return { ok: false, code: 'message_size', message: `Message must be 1-${RECEIVER_MAX_CLIENT_MESSAGE_BYTES} bytes.` }
  }
  let value: unknown
  try {
    value = JSON.parse(typeof input === 'string' ? input : new TextDecoder().decode(input))
  } catch {
    return { ok: false, code: 'invalid_json', message: 'Message is not valid JSON.' }
  }
  if (!isRecord(value) || typeof value.type !== 'string') {
    return { ok: false, code: 'schema_message', message: 'Message must be a typed object.' }
  }
  if (value.type === 'hello') return parseHello(value)
  if (value.type === 'ack') {
    if (!hasOnlyKeys(value, ['type', 'sequence']) ||
        !boundedInteger(value.sequence, 0, Number.MAX_SAFE_INTEGER)) {
      return { ok: false, code: 'schema_ack', message: 'Ack must contain one bounded sequence.' }
    }
    return { ok: true, value: { type: 'ack', sequence: value.sequence } }
  }
  if (value.type === 'resync') {
    if (!hasOnlyKeys(value, ['type', 'afterSequence', 'reason']) ||
        !boundedInteger(value.afterSequence, 0, Number.MAX_SAFE_INTEGER) ||
        typeof value.reason !== 'string' ||
        !RESYNC_REASONS.has(value.reason)) {
      return { ok: false, code: 'schema_resync', message: 'Resync request is invalid.' }
    }
    return {
      ok: true,
      value: {
        type: 'resync',
        afterSequence: value.afterSequence,
        reason: value.reason as ReceiverResyncMessage['reason']
      }
    }
  }
  return { ok: false, code: 'data_diode', message: 'Only hello, ack, and resync controls are accepted.' }
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: unknown, min: number, max: number, fallback = 0): number {
  return Math.max(min, Math.min(max, finite(value, fallback)))
}

function nullable(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(min, Math.min(max, value))
}

function nullableInteger(value: unknown, min: number, max: number): number | null {
  const normalized = nullable(value, min, max)
  return normalized === null ? null : Math.round(normalized)
}

export function createReceiverTelemetryData(
  snapshot: TelemetrySnapshot | null,
  now = Date.now()
): ReceiverTelemetryData {
  const side = snapshot?.carLeftRight
  return {
    connected: snapshot?.connected === true,
    sim: snapshot && SIM_IDS.has(snapshot.sim) ? snapshot.sim : 'none',
    sampleTimestamp: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(finite(snapshot?.timestamp, now)))),
    speedKmh: Math.round(clamp(snapshot?.speedKmh, 0, 600) * 10) / 10,
    rpm: Math.round(clamp(snapshot?.rpm, 0, 30_000)),
    gear: Math.round(clamp(snapshot?.gear, -1, 20)),
    throttle: Math.round(clamp(snapshot?.throttle, 0, 1) * 1000) / 1000,
    brake: Math.round(clamp(snapshot?.brake, 0, 1) * 1000) / 1000,
    clutch: Math.round(clamp(snapshot?.clutch, 0, 1) * 1000) / 1000,
    fuelLiters: nullable(snapshot?.fuelLiters, 0, 1_000),
    fuelLapsRemaining: nullable(snapshot?.fuelLapsRemaining, 0, 10_000),
    lap: nullableInteger(snapshot?.currentLap, 0, 1_000_000),
    position: nullableInteger(snapshot?.position, 1, 1_000),
    classPosition: nullableInteger(snapshot?.classPosition, 1, 1_000),
    deltaToBestSec: nullable(snapshot?.deltaToBestSec, -3_600, 3_600),
    sessionTimeRemainingSec: nullable(snapshot?.sessionTimeRemainingSec, 0, 31_536_000),
    pitLimiter: snapshot?.pitLimiter === true,
    onPitRoad: snapshot?.onPitRoad === true,
    carLeftRight: side && CAR_SIDES.has(side) ? side : 'clear',
    flags: {
      green: snapshot?.flags?.green === true,
      yellow: snapshot?.flags?.yellow === true,
      blue: snapshot?.flags?.blue === true,
      white: snapshot?.flags?.white === true,
      checkered: snapshot?.flags?.checkered === true,
      red: snapshot?.flags?.red === true
    }
  }
}

export function negotiateReceiverRate(requestedHz: number): number {
  return Math.max(RECEIVER_MIN_HZ, Math.min(RECEIVER_MAX_HZ, Math.round(requestedHz)))
}

export function summarizeReceiverLatencies(samples: readonly number[]): {
  count: number
  p50: number | null
  p95: number | null
  max: number | null
} {
  const sorted = samples
    .filter((sample) => Number.isFinite(sample) && sample >= 0)
    .map((sample) => Math.round(sample * 10) / 10)
    .sort((a, b) => a - b)
  if (sorted.length === 0) return { count: 0, p50: null, p95: null, max: null }
  const percentile = (ratio: number): number => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]
  return {
    count: sorted.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted[sorted.length - 1]
  }
}

export function isReceiverTelemetryData(value: unknown): value is ReceiverTelemetryData {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'connected',
    'sim',
    'sampleTimestamp',
    'speedKmh',
    'rpm',
    'gear',
    'throttle',
    'brake',
    'clutch',
    'fuelLiters',
    'fuelLapsRemaining',
    'lap',
    'position',
    'classPosition',
    'deltaToBestSec',
    'sessionTimeRemainingSec',
    'pitLimiter',
    'onPitRoad',
    'carLeftRight',
    'flags'
  ])) return false
  const nullableNumber = (input: unknown): boolean => input === null || (typeof input === 'number' && Number.isFinite(input))
  return typeof value.connected === 'boolean' &&
    typeof value.sim === 'string' &&
    SIM_IDS.has(value.sim as SimId) &&
    typeof value.sampleTimestamp === 'number' &&
    Number.isFinite(value.sampleTimestamp) &&
    typeof value.speedKmh === 'number' &&
    Number.isFinite(value.speedKmh) &&
    typeof value.rpm === 'number' &&
    Number.isFinite(value.rpm) &&
    typeof value.gear === 'number' &&
    Number.isFinite(value.gear) &&
    typeof value.throttle === 'number' &&
    Number.isFinite(value.throttle) &&
    typeof value.brake === 'number' &&
    Number.isFinite(value.brake) &&
    typeof value.clutch === 'number' &&
    Number.isFinite(value.clutch) &&
    nullableNumber(value.fuelLiters) &&
    nullableNumber(value.fuelLapsRemaining) &&
    nullableNumber(value.lap) &&
    nullableNumber(value.position) &&
    nullableNumber(value.classPosition) &&
    nullableNumber(value.deltaToBestSec) &&
    nullableNumber(value.sessionTimeRemainingSec) &&
    typeof value.pitLimiter === 'boolean' &&
    typeof value.onPitRoad === 'boolean' &&
    typeof value.carLeftRight === 'string' &&
    CAR_SIDES.has(value.carLeftRight) &&
    isRecord(value.flags) &&
    hasOnlyKeys(value.flags, ['green', 'yellow', 'blue', 'white', 'checkered', 'red']) &&
    Object.values(value.flags).every((flag) => typeof flag === 'boolean')
}

export function parseReceiverServerMessage(input: string): ReceiverServerMessage | null {
  const size = utf8ByteLength(input)
  if (size === 0 || size > RECEIVER_MAX_SERVER_MESSAGE_BYTES) return null
  let value: unknown
  try {
    value = JSON.parse(input)
  } catch {
    return null
  }
  if (!isRecord(value) || typeof value.type !== 'string') return null
  if (value.type === 'telemetry') {
    if (!hasOnlyKeys(value, ['type', 'sequence', 'sentAt', 'replay', 'data']) ||
        !boundedInteger(value.sequence, 0, Number.MAX_SAFE_INTEGER) ||
        !boundedInteger(value.sentAt, 0, Number.MAX_SAFE_INTEGER) ||
        typeof value.replay !== 'boolean' ||
        !isReceiverTelemetryData(value.data)) return null
    return value as unknown as ReceiverTelemetryMessage
  }
  if (value.type === 'snapshot') {
    if (!hasOnlyKeys(value, ['type', 'sequence', 'highWater', 'sentAt', 'reason', 'data']) ||
        !boundedInteger(value.sequence, 0, Number.MAX_SAFE_INTEGER) ||
        !boundedInteger(value.highWater, 0, Number.MAX_SAFE_INTEGER) ||
        !boundedInteger(value.sentAt, 0, Number.MAX_SAFE_INTEGER) ||
        !['initial', 'reconnect', 'resync', 'replay-unavailable'].includes(String(value.reason)) ||
        !isReceiverTelemetryData(value.data)) return null
    return value as unknown as ReceiverSnapshotMessage
  }
  if (value.type === 'welcome') {
    if (!hasOnlyKeys(value, [
      'type',
      'protocolVersion',
      'schemaVersion',
      'capabilities',
      'sessionId',
      'rateHz',
      'maxPayloadBytes',
      'heartbeatMs',
      'highWater',
      'serverTime',
      'readOnly',
      'commands'
    ]) ||
        value.protocolVersion !== RECEIVER_PROTOCOL_VERSION ||
        value.schemaVersion !== RECEIVER_SCHEMA_VERSION ||
        !Array.isArray(value.capabilities) ||
        value.capabilities.length === 0 ||
        value.capabilities.length !== new Set(value.capabilities).size ||
        !value.capabilities.every((item) => typeof item === 'string' && CAPABILITIES.has(item)) ||
        !(value.capabilities as string[]).includes('telemetry.fast.v1') ||
        !boundedString(value.sessionId, 8, 128) ||
        !boundedInteger(value.rateHz, RECEIVER_MIN_HZ, RECEIVER_MAX_HZ) ||
        !boundedInteger(value.maxPayloadBytes, 1_024, RECEIVER_MAX_SERVER_MESSAGE_BYTES) ||
        !boundedInteger(value.heartbeatMs, 1_000, 60_000) ||
        !boundedInteger(value.highWater, 0, Number.MAX_SAFE_INTEGER) ||
        !boundedInteger(value.serverTime, 0, Number.MAX_SAFE_INTEGER) ||
        value.readOnly !== true ||
        value.commands !== false) return null
    return value as unknown as ReceiverWelcomeMessage
  }
  if (value.type === 'resync-complete') {
    if (!hasOnlyKeys(value, ['type', 'highWater', 'replayed', 'snapshot']) ||
        !boundedInteger(value.highWater, 0, Number.MAX_SAFE_INTEGER) ||
        !boundedInteger(value.replayed, 0, 10_000) ||
        typeof value.snapshot !== 'boolean') return null
    return value as unknown as ReceiverResyncCompleteMessage
  }
  if (value.type === 'rate') {
    if (!hasOnlyKeys(value, ['type', 'rateHz', 'reason']) ||
        !boundedInteger(value.rateHz, RECEIVER_MIN_HZ, RECEIVER_MAX_HZ) ||
        !['negotiated', 'backpressure'].includes(String(value.reason))) return null
    return value as unknown as ReceiverRateMessage
  }
  if (value.type === 'error') {
    if (!hasOnlyKeys(value, ['type', 'code', 'message', 'retryable']) ||
        !boundedString(value.code, 1, 64) ||
        !boundedString(value.message, 1, 256) ||
        typeof value.retryable !== 'boolean') return null
    return value as unknown as ReceiverErrorMessage
  }
  return null
}
