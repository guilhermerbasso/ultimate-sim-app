import type { Flags, TelemetrySnapshot } from './telemetry'

export const MQTT_CONTRACT_VERSION = 1 as const
export const MQTT_TOPIC_VERSION = 'v1' as const
export const MQTT_TOPIC_PREFIX = `ultimate-sim/${MQTT_TOPIC_VERSION}` as const
export const MQTT_ROLE_POLICY_ID = 'mqtt.local.connector.v1' as const
export const MQTT_PRODUCER_ID = 'ultimate-sim.mqtt-target.v1' as const
export const MQTT_CAPABILITY_EPOCH = 1 as const
export const MQTT_MAX_QUEUE_DEPTH = 64 as const
export const MQTT_COMMAND_CACHE_SIZE = 256 as const
export const MQTT_INSTANCE_ID_PATTERN = '[a-z0-9](?:[a-z0-9_-]{0,30}[a-z0-9])?' as const

export const MQTT_CHANNELS = {
  getConfig: 'mqtt:config:get',
  setConfig: 'mqtt:config:set',
  status: 'mqtt:status',
  statusChanged: 'mqtt:status-changed',
  reconnect: 'mqtt:reconnect',
  contract: 'mqtt:contract'
} as const

export type MqttQos = 0 | 1
export type MqttPrivacyClass = 'D0' | 'D1' | 'D2' | 'D3' | 'D4' | 'D5'
export type MqttConnectionState =
  | 'disabled'
  | 'connecting'
  | 'online'
  | 'reconnecting'
  | 'stopping'
  | 'error'
export type MqttEventType = 'flag' | 'pit' | 'warning' | 'disconnect' | 'session'
export type MqttCommandCapability =
  | 'app.overlay.show'
  | 'app.overlay.hide'
export type MqttSchemaKind =
  | 'availability'
  | 'telemetry'
  | 'session'
  | 'event'
  | 'health'
  | 'announcement'
  | 'command'
  | 'result'
export type MqttPrincipal = 'target-publisher' | 'local-reader' | 'local-command'
export const MQTT_BROKER_USERNAMES: Readonly<Record<MqttPrincipal, string>> = Object.freeze({
  'target-publisher': 'ultimate-sim-target',
  'local-reader': 'ultimate-sim-reader',
  'local-command': 'ultimate-sim-command'
})
export type MqttAclOperation = 'publish' | 'subscribe'
export type MqttCapability =
  | 'mqtt.publish.availability'
  | 'mqtt.publish.telemetry'
  | 'mqtt.publish.session'
  | 'mqtt.publish.event'
  | 'mqtt.publish.health'
  | 'mqtt.publish.announcement'
  | 'mqtt.publish.result'
  | 'mqtt.subscribe.command'
  | 'mqtt.read.local'
  | 'mqtt.command.local'

export const MQTT_EVENT_TYPES: readonly MqttEventType[] = [
  'flag',
  'pit',
  'warning',
  'disconnect',
  'session'
] as const

export const MQTT_COMMAND_CAPABILITIES: readonly MqttCommandCapability[] = [
  'app.overlay.show',
  'app.overlay.hide'
] as const

export const MQTT_SCHEMA_IDS: Record<MqttSchemaKind, string> = {
  availability: 'urn:ultimate-sim:mqtt:v1:availability',
  telemetry: 'urn:ultimate-sim:mqtt:v1:telemetry-state',
  session: 'urn:ultimate-sim:mqtt:v1:session-state',
  event: 'urn:ultimate-sim:mqtt:v1:race-event',
  health: 'urn:ultimate-sim:mqtt:v1:connector-health',
  announcement: 'urn:ultimate-sim:mqtt:v1:schema-announcement',
  command: 'urn:ultimate-sim:mqtt:v1:command-request',
  result: 'urn:ultimate-sim:mqtt:v1:command-result'
}

export const MQTT_EVENT_NAMES: Record<MqttSchemaKind, string> = {
  availability: 'ultimate.sim.mqtt.availability.v1',
  telemetry: 'ultimate.sim.telemetry.state.v1',
  session: 'ultimate.sim.race.state.v1',
  event: 'ultimate.sim.race.event.v1',
  health: 'ultimate.sim.connector.health.v1',
  announcement: 'ultimate.sim.schema.announcement.v1',
  command: 'ultimate.sim.command.request.v1',
  result: 'ultimate.sim.command.result.v1'
}

// SHA-256 of the canonical JSON schema documents in contracts/mqtt/v1/schemas.
export const MQTT_SCHEMA_FINGERPRINTS: Record<MqttSchemaKind, string> = {
  availability: '665d2e58e55428dd2054b19e06a89b8401027d1403c142b74ed80adef785641c',
  telemetry: 'ea9e46612676cdd3ed4bd2e5e7f8728adf29119a05f8a5cbba5a1e9255a85961',
  session: '56ad29478ee4a3ba4880b98592c30b7fc5225ccf7d86f5ef7124f6e3234ee0dd',
  event: '1c5e228272089520974c3ad99e5639b53648a3e266562ec94f771ff05a775755',
  health: '032692822d34e468824e3188c8c848e4ebad71bfdc137657ee045f6fe729c446',
  announcement: '1c2073da02a1740b3712b29f2022ec001afdedcd2bb6b1b39dae5e779dc77c2d',
  command: '1aecd84e7ee42bd214493fc0025dcd60a58e045852a1c6c02179827ed0ae82eb',
  result: 'e365779fe61fe705a6bf42f3af5e5236a940e6e023a2002d8d08b34f7198268a'
}

export interface MqttLocalConfig {
  version: typeof MQTT_CONTRACT_VERSION
  enabled: boolean
  host: '127.0.0.1' | '::1'
  port: number
  instanceId: string
  commandsEnabled: boolean
  telemetryRateHz: number
  maxPayloadBytes: number
  retainedMaxAgeMs: number
  reconnectMinMs: number
  reconnectMaxMs: number
}

export const DEFAULT_MQTT_LOCAL_CONFIG: MqttLocalConfig = {
  version: MQTT_CONTRACT_VERSION,
  enabled: false,
  host: '127.0.0.1',
  port: 1883,
  instanceId: 'simrig',
  commandsEnabled: false,
  telemetryRateHz: 10,
  maxPayloadBytes: 16 * 1024,
  retainedMaxAgeMs: 30_000,
  reconnectMinMs: 1_000,
  reconnectMaxMs: 15_000
}

export interface MqttCapabilityGrant {
  id: string
  principal: MqttPrincipal
  instanceId: string
  capabilities: MqttCapability[]
  issuedAt: number
  expiresAt: number
  epoch: number
  revoked: boolean
}

export interface MqttAclDecision {
  allowed: boolean
  capability?: MqttCapability
  reason: string
}

export interface MqttTopicPolicy {
  schemaKind?: MqttSchemaKind
  qos: MqttQos
  retained: boolean
  maxRateHz: number
  maxBytes: number
  messageExpirySec?: number
}

export interface MqttTopics {
  root: string
  availability: string
  telemetry: string
  session: string
  health: string
  announcement: string
  event(type: MqttEventType): string
  command(capability: MqttCommandCapability): string
  result(requestId: string): string
  stateFilter: string
  eventFilter: string
  commandFilter: string
  resultFilter: string
  readerFilters: readonly string[]
}

export interface MqttAvailabilityData {
  schemaVersion: typeof MQTT_CONTRACT_VERSION
  status: 'online' | 'offline'
  instanceId: string
  observedAt: number
  expiresAt: number
  generation: number
}

export interface MqttTelemetryStateData {
  schemaVersion: typeof MQTT_CONTRACT_VERSION
  observedAt: number
  expiresAt: number
  sim: string
  connected: boolean
  speedMps: number
  rpm: number
  gear: number
  throttleRatio: number
  brakeRatio: number
  clutchRatio: number
  lapDistanceRatio?: number
  deltaToBestSec?: number
  fuelLiters?: number
  activeFlags: string[]
  stale: boolean
}

export interface MqttSessionStateData {
  schemaVersion: typeof MQTT_CONTRACT_VERSION
  observedAt: number
  expiresAt: number
  sim: string
  connected: boolean
  sessionRef: string
  sessionType?: string
  sessionState?: string
  carName?: string
  trackName?: string
  trackConfigName?: string
  currentLap?: number
  lapsRemaining?: number
  position?: number
  classPosition?: number
  fuelLiters?: number
  trackTempC?: number
  airTempC?: number
  wetnessRatio?: number
  raining?: boolean
  primaryFlag?: string
  stale: boolean
}

export interface MqttRaceEventData {
  schemaVersion: typeof MQTT_CONTRACT_VERSION
  eventId: string
  eventType: MqttEventType
  observedAt: number
  expiresAt: number
  severity: 'info' | 'notice' | 'warning'
  sessionRef: string
  dedupeKey: string
  facts: Record<string, string | number | boolean>
}

export interface MqttHealthMetrics {
  published: number
  received: number
  denied: number
  duplicates: number
  schemaRejects: number
  staleRetainedCleared: number
  rateLimited: number
  oversized: number
  overloadDropped: number
  coalesced: number
  reconnects: number
  resyncs: number
  publishFailures: number
}

export interface MqttConnectorHealthData {
  schemaVersion: typeof MQTT_CONTRACT_VERSION
  observedAt: number
  expiresAt: number
  state: MqttConnectionState
  queueDepth: number
  circuit: 'closed' | 'open' | 'half-open'
  metrics: MqttHealthMetrics
}

export interface MqttSchemaAnnouncementData {
  schemaVersion: typeof MQTT_CONTRACT_VERSION
  observedAt: number
  expiresAt: number
  topicVersion: typeof MQTT_TOPIC_VERSION
  schemas: Array<{
    kind: MqttSchemaKind
    id: string
    fingerprint: string
  }>
}

export interface MqttCommandRequestData {
  schemaVersion: typeof MQTT_CONTRACT_VERSION
  requestId: string
  capability: MqttCommandCapability
  issuedAt: number
  expiresAt: number
  args: Record<string, string | number | boolean>
}

export interface MqttCommandResultData {
  schemaVersion: typeof MQTT_CONTRACT_VERSION
  requestId: string
  capability: MqttCommandCapability
  observedAt: number
  expiresAt: number
  status: 'ok' | 'denied' | 'expired' | 'unsupported' | 'failed'
  duplicate: boolean
  message: string
}

export type MqttPayloadData =
  | MqttAvailabilityData
  | MqttTelemetryStateData
  | MqttSessionStateData
  | MqttRaceEventData
  | MqttConnectorHealthData
  | MqttSchemaAnnouncementData
  | MqttCommandRequestData
  | MqttCommandResultData

export interface MqttCloudEvent<T extends MqttPayloadData = MqttPayloadData> {
  specversion: '1.0'
  id: string
  source: string
  type: string
  subject?: string
  time: string
  datacontenttype: 'application/json'
  dataschema: string
  sequence: string
  sourcetick: string
  monotonicns: string
  sessionid: string
  producerid: string
  schemafp: string
  correlationid: string
  causationid: string
  privacyclass: MqttPrivacyClass
  rolepolicyid: string
  capgrantid: string
  consentepoch: string
  approvalid: string
  partitionkey: string
  partitionseq: string
  stale: boolean
  derived: boolean
  gap: boolean
  data: T
}

export interface MqttEnvelopeContext {
  id: string
  instanceId: string
  sequence: string
  sourceTick: string
  monotonicNs: string
  sessionId: string
  correlationId?: string
  causationId?: string
  partitionKey: string
  partitionSeq: string
  privacyClass?: MqttPrivacyClass
  capabilityGrantId: string
  consentEpoch?: string
  approvalId?: string
  subject?: string
  stale?: boolean
  derived?: boolean
  gap?: boolean
  observedAt: number
}

export interface MqttTargetStatus {
  config: MqttLocalConfig
  state: MqttConnectionState
  brokerUrl: string
  readerUrl: string
  commandUrl: string
  setupDirectory?: string
  connected: boolean
  generation: number
  queueDepth: number
  commandsSubscribed: boolean
  lastConnectedAt?: number
  lastMessageAt?: number
  lastError?: string
  metrics: MqttHealthMetrics
}

export interface MqttContractSummary {
  version: typeof MQTT_CONTRACT_VERSION
  localOnly: true
  userSuppliedCredentialsSupported: false
  defaultEnabled: false
  topics: {
    availability: string
    telemetry: string
    session: string
    events: string
    health: string
    announcement: string
    commands: string
    results: string
  }
  broker: {
    publisherUrl: string
    readerUrl: string
    commandUrl: string
    authentication: 'generated-local-role-secrets'
    listenerCapabilities: Record<MqttPrincipal, string[]>
  }
  retainedRules: string[]
  limits: {
    telemetryRateHz: number
    commandRateHz: number
    commandBurst: number
    maxPayloadBytes: number
    queueDepth: number
  }
}

export interface MqttRoleViewPolicy {
  id: typeof MQTT_ROLE_POLICY_ID
  version: typeof MQTT_CONTRACT_VERSION
  role: 'connector'
  maxPrivacyClass: 'D2'
  exportScope: 'local-only'
  telemetryFields: readonly string[]
  sessionFields: readonly string[]
  eventTypes: readonly MqttEventType[]
  commands: readonly MqttCommandCapability[]
  defaultCommandAccess: 'deny'
}

export const MQTT_ROLE_VIEW_POLICY: MqttRoleViewPolicy = Object.freeze({
  id: MQTT_ROLE_POLICY_ID,
  version: MQTT_CONTRACT_VERSION,
  role: 'connector',
  maxPrivacyClass: 'D2',
  exportScope: 'local-only',
  telemetryFields: Object.freeze([
    'sim',
    'connected',
    'speedMps',
    'rpm',
    'gear',
    'throttleRatio',
    'brakeRatio',
    'clutchRatio',
    'lapDistanceRatio',
    'deltaToBestSec',
    'fuelLiters',
    'activeFlags'
  ]),
  sessionFields: Object.freeze([
    'sim',
    'connected',
    'sessionRef',
    'sessionType',
    'sessionState',
    'carName',
    'trackName',
    'trackConfigName',
    'currentLap',
    'lapsRemaining',
    'position',
    'classPosition',
    'fuelLiters',
    'trackTempC',
    'airTempC',
    'wetnessRatio',
    'raining',
    'primaryFlag'
  ]),
  eventTypes: MQTT_EVENT_TYPES,
  commands: MQTT_COMMAND_CAPABILITIES,
  defaultCommandAccess: 'deny'
})

export class MqttContractError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid-config'
      | 'invalid-topic'
      | 'acl-denied'
      | 'schema-drift'
      | 'stale-retained'
      | 'oversized'
      | 'secret-field'
      | 'invalid-payload'
  ) {
    super(message)
    this.name = 'MqttContractError'
  }
}

const SECRET_KEY = /(?:password|passwd|secret|token|credential|authorization|cookie|privatekey|apikey)/i
const INSTANCE_ID = new RegExp(`^${MQTT_INSTANCE_ID_PATTERN}$`)
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/
const TOPIC_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const ENVELOPE_KEYS = new Set([
  'specversion',
  'id',
  'source',
  'type',
  'subject',
  'time',
  'datacontenttype',
  'dataschema',
  'sequence',
  'sourcetick',
  'monotonicns',
  'sessionid',
  'producerid',
  'schemafp',
  'correlationid',
  'causationid',
  'privacyclass',
  'rolepolicyid',
  'capgrantid',
  'consentepoch',
  'approvalid',
  'partitionkey',
  'partitionseq',
  'stale',
  'derived',
  'gap',
  'data'
])
const PAYLOAD_KEYS: Record<MqttSchemaKind, ReadonlySet<string>> = {
  availability: new Set(['schemaVersion', 'status', 'instanceId', 'observedAt', 'expiresAt', 'generation']),
  telemetry: new Set([
    'schemaVersion',
    'observedAt',
    'expiresAt',
    'sim',
    'connected',
    'speedMps',
    'rpm',
    'gear',
    'throttleRatio',
    'brakeRatio',
    'clutchRatio',
    'lapDistanceRatio',
    'deltaToBestSec',
    'fuelLiters',
    'activeFlags',
    'stale'
  ]),
  session: new Set([
    'schemaVersion',
    'observedAt',
    'expiresAt',
    'sim',
    'connected',
    'sessionRef',
    'sessionType',
    'sessionState',
    'carName',
    'trackName',
    'trackConfigName',
    'currentLap',
    'lapsRemaining',
    'position',
    'classPosition',
    'fuelLiters',
    'trackTempC',
    'airTempC',
    'wetnessRatio',
    'raining',
    'primaryFlag',
    'stale'
  ]),
  event: new Set([
    'schemaVersion',
    'eventId',
    'eventType',
    'observedAt',
    'expiresAt',
    'severity',
    'sessionRef',
    'dedupeKey',
    'facts'
  ]),
  health: new Set(['schemaVersion', 'observedAt', 'expiresAt', 'state', 'queueDepth', 'circuit', 'metrics']),
  announcement: new Set(['schemaVersion', 'observedAt', 'expiresAt', 'topicVersion', 'schemas']),
  command: new Set(['schemaVersion', 'requestId', 'capability', 'issuedAt', 'expiresAt', 'args']),
  result: new Set([
    'schemaVersion',
    'requestId',
    'capability',
    'observedAt',
    'expiresAt',
    'status',
    'duplicate',
    'message'
  ])
}

export function emptyMqttHealthMetrics(): MqttHealthMetrics {
  return {
    published: 0,
    received: 0,
    denied: 0,
    duplicates: 0,
    schemaRejects: 0,
    staleRetainedCleared: 0,
    rateLimited: 0,
    oversized: 0,
    overloadDropped: 0,
    coalesced: 0,
    reconnects: 0,
    resyncs: 0,
    publishFailures: 0
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function optionalFinite(value: unknown): number | undefined {
  return finite(value) ? value : undefined
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function integerInRange(value: unknown, fallback: number, min: number, max: number): number {
  return finite(value) && Number.isInteger(value) ? clamp(value, min, max) : fallback
}

function normalizeLoopbackHost(value: unknown): MqttLocalConfig['host'] {
  if (value === '::1') return '::1'
  if (value === '127.0.0.1' || value === 'localhost' || value === undefined) return '127.0.0.1'
  throw new MqttContractError('MQTT broker must be bound to loopback.', 'invalid-config')
}

export function assertNoSecretKeys(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretKeys(entry, `${path}[${index}]`))
    return
  }
  if (!isRecord(value)) return
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      throw new MqttContractError(`Secret-like field is forbidden at ${path}.${key}.`, 'secret-field')
    }
    assertNoSecretKeys(entry, `${path}.${key}`)
  }
}

export function normalizeMqttLocalConfig(value: unknown): MqttLocalConfig {
  if (value !== undefined) assertNoSecretKeys(value)
  const input = isRecord(value) ? value : {}
  const instanceId =
    typeof input.instanceId === 'string' && INSTANCE_ID.test(input.instanceId)
      ? input.instanceId
      : DEFAULT_MQTT_LOCAL_CONFIG.instanceId
  const port = integerInRange(input.port, DEFAULT_MQTT_LOCAL_CONFIG.port, 1, 65533)
  const reconnectMinMs = integerInRange(
    input.reconnectMinMs,
    DEFAULT_MQTT_LOCAL_CONFIG.reconnectMinMs,
    250,
    30_000
  )
  const reconnectMaxMs = Math.max(
    reconnectMinMs,
    integerInRange(
      input.reconnectMaxMs,
      DEFAULT_MQTT_LOCAL_CONFIG.reconnectMaxMs,
      reconnectMinMs,
      120_000
    )
  )
  return {
    version: MQTT_CONTRACT_VERSION,
    enabled: input.enabled === true,
    host: normalizeLoopbackHost(input.host),
    port,
    instanceId,
    commandsEnabled: input.commandsEnabled === true,
    telemetryRateHz: integerInRange(
      input.telemetryRateHz,
      DEFAULT_MQTT_LOCAL_CONFIG.telemetryRateHz,
      1,
      10
    ),
    maxPayloadBytes: integerInRange(
      input.maxPayloadBytes,
      DEFAULT_MQTT_LOCAL_CONFIG.maxPayloadBytes,
      1024,
      64 * 1024
    ),
    retainedMaxAgeMs: integerInRange(
      input.retainedMaxAgeMs,
      DEFAULT_MQTT_LOCAL_CONFIG.retainedMaxAgeMs,
      5_000,
      5 * 60_000
    ),
    reconnectMinMs,
    reconnectMaxMs
  }
}

function brokerUrl(host: MqttLocalConfig['host'], port: number): string {
  return `mqtt://${host === '::1' ? '[::1]' : host}:${port}`
}

export function mqttBrokerUrls(config: MqttLocalConfig): {
  publisher: string
  reader: string
  command: string
} {
  return {
    publisher: brokerUrl(config.host, config.port),
    reader: brokerUrl(config.host, config.port + 1),
    command: brokerUrl(config.host, config.port + 2)
  }
}

function safeTopicSegment(value: string, label: string): string {
  if (!TOPIC_SEGMENT.test(value) || value.includes('+') || value.includes('#')) {
    throw new MqttContractError(`Invalid MQTT ${label}.`, 'invalid-topic')
  }
  return value
}

export function mqttTopics(instanceId: string): MqttTopics {
  if (!INSTANCE_ID.test(instanceId)) throw new MqttContractError('Invalid MQTT instance ID.', 'invalid-topic')
  const root = `${MQTT_TOPIC_PREFIX}/${instanceId}`
  const availability = `${root}/availability`
  const telemetry = `${root}/state/telemetry`
  const session = `${root}/state/session`
  const health = `${root}/health`
  const announcement = `${root}/schema/announcement`
  const stateFilter = `${root}/state/+`
  const eventFilter = `${root}/event/+`
  const commandFilter = `${root}/command/+`
  const resultFilter = `${root}/result/+`
  return {
    root,
    availability,
    telemetry,
    session,
    health,
    announcement,
    event: (type) => `${root}/event/${type}`,
    command: (capability) => `${root}/command/${capability}`,
    result: (requestId) => `${root}/result/${safeTopicSegment(requestId, 'request ID')}`,
    stateFilter,
    eventFilter,
    commandFilter,
    resultFilter,
    readerFilters: [availability, stateFilter, eventFilter, health, announcement, resultFilter]
  }
}

export function mqttTopicPolicy(topic: string, instanceId: string): MqttTopicPolicy | null {
  const topics = mqttTopics(instanceId)
  if (topic === topics.availability) {
    return { schemaKind: 'availability', qos: 1, retained: true, maxRateHz: 1, maxBytes: 4096, messageExpirySec: 60 }
  }
  if (topic === topics.telemetry) {
    return { schemaKind: 'telemetry', qos: 0, retained: false, maxRateHz: 10, maxBytes: 8192, messageExpirySec: 2 }
  }
  if (topic === topics.session) {
    return { schemaKind: 'session', qos: 1, retained: true, maxRateHz: 2, maxBytes: 8192, messageExpirySec: 60 }
  }
  if (topic === topics.health) {
    return { schemaKind: 'health', qos: 1, retained: true, maxRateHz: 1, maxBytes: 8192, messageExpirySec: 60 }
  }
  if (topic === topics.announcement) {
    return { schemaKind: 'announcement', qos: 1, retained: true, maxRateHz: 0.2, maxBytes: 12 * 1024, messageExpirySec: 300 }
  }
  if (topic.startsWith(`${topics.root}/event/`)) {
    const type = topic.slice(`${topics.root}/event/`.length)
    if (MQTT_EVENT_TYPES.includes(type as MqttEventType)) {
      return { schemaKind: 'event', qos: 1, retained: false, maxRateHz: 10, maxBytes: 8192, messageExpirySec: 30 }
    }
  }
  if (topic.startsWith(`${topics.root}/command/`)) {
    const capability = topic.slice(`${topics.root}/command/`.length)
    if (MQTT_COMMAND_CAPABILITIES.includes(capability as MqttCommandCapability)) {
      return { schemaKind: 'command', qos: 1, retained: false, maxRateHz: 2, maxBytes: 4096, messageExpirySec: 15 }
    }
  }
  if (topic.startsWith(`${topics.root}/result/`)) {
    const requestId = topic.slice(`${topics.root}/result/`.length)
    if (REQUEST_ID.test(requestId)) {
      return { schemaKind: 'result', qos: 1, retained: false, maxRateHz: 10, maxBytes: 4096, messageExpirySec: 30 }
    }
  }
  return null
}

function requiredCapability(
  principal: MqttPrincipal,
  operation: MqttAclOperation,
  topic: string,
  config: MqttLocalConfig
): MqttCapability | null {
  const topics = mqttTopics(config.instanceId)
  const allowlistedCommandTopic = MQTT_COMMAND_CAPABILITIES.some(
    (capability) => topic === topics.command(capability)
  )
  if (principal === 'target-publisher') {
    if (operation === 'subscribe') {
      return allowlistedCommandTopic && config.commandsEnabled ? 'mqtt.subscribe.command' : null
    }
    if (topic === topics.availability) return 'mqtt.publish.availability'
    if (topic === topics.telemetry) return 'mqtt.publish.telemetry'
    if (topic === topics.session) return 'mqtt.publish.session'
    if (topic === topics.health) return 'mqtt.publish.health'
    if (topic === topics.announcement) return 'mqtt.publish.announcement'
    if (topic.startsWith(`${topics.root}/event/`)) return 'mqtt.publish.event'
    if (topic.startsWith(`${topics.root}/result/`)) return 'mqtt.publish.result'
    return null
  }
  if (principal === 'local-reader') {
    if (operation !== 'subscribe') return null
    if (topics.readerFilters.includes(topic)) return 'mqtt.read.local'
    const policy = mqttTopicPolicy(topic, config.instanceId)
    return policy && policy.schemaKind !== 'command' ? 'mqtt.read.local' : null
  }
  if (principal === 'local-command') {
    if (!config.commandsEnabled) return null
    if (operation === 'publish' && allowlistedCommandTopic) return 'mqtt.command.local'
    if (operation === 'subscribe' && (topic === topics.resultFilter || topic.startsWith(`${topics.root}/result/`))) {
      return 'mqtt.command.local'
    }
  }
  return null
}

export function authorizeMqttOperation(
  grant: MqttCapabilityGrant,
  operation: MqttAclOperation,
  topic: string,
  config: MqttLocalConfig,
  now: number
): MqttAclDecision {
  if (grant.revoked) return { allowed: false, reason: 'Capability grant is revoked.' }
  if (grant.epoch !== MQTT_CAPABILITY_EPOCH) return { allowed: false, reason: 'Capability epoch is stale.' }
  if (grant.instanceId !== config.instanceId) return { allowed: false, reason: 'Cross-instance topic access denied.' }
  if (now < grant.issuedAt || now >= grant.expiresAt) return { allowed: false, reason: 'Capability grant is not current.' }
  const root = `${MQTT_TOPIC_PREFIX}/${config.instanceId}/`
  if (!topic.startsWith(root)) return { allowed: false, reason: 'Topic is outside the granted instance.' }
  const capability = requiredCapability(grant.principal, operation, topic, config)
  if (!capability) return { allowed: false, reason: 'Topic operation is not allowlisted.' }
  if (!grant.capabilities.includes(capability)) {
    return { allowed: false, capability, reason: `Missing capability ${capability}.` }
  }
  return { allowed: true, capability, reason: 'Allowed by local MQTT capability policy.' }
}

export function createMqttCapabilityGrant(
  principal: MqttPrincipal,
  config: MqttLocalConfig,
  now: number,
  lifetimeMs = 24 * 60 * 60 * 1000
): MqttCapabilityGrant {
  const capabilities: Record<MqttPrincipal, MqttCapability[]> = {
    'target-publisher': [
      'mqtt.publish.availability',
      'mqtt.publish.telemetry',
      'mqtt.publish.session',
      'mqtt.publish.event',
      'mqtt.publish.health',
      'mqtt.publish.announcement',
      'mqtt.publish.result',
      'mqtt.subscribe.command'
    ],
    'local-reader': ['mqtt.read.local'],
    'local-command': ['mqtt.command.local']
  }
  return {
    id: `mqtt-${principal}-${config.instanceId}-${MQTT_CAPABILITY_EPOCH}`,
    principal,
    instanceId: config.instanceId,
    capabilities: capabilities[principal],
    issuedAt: now,
    expiresAt: now + lifetimeMs,
    epoch: MQTT_CAPABILITY_EPOCH,
    revoked: false
  }
}

function activeFlags(flags: Flags | undefined): string[] {
  if (!flags) return []
  return Object.entries(flags)
    .filter(([, active]) => active)
    .map(([name]) => name)
    .sort()
}

export function primaryTelemetryFlag(flags: Flags | undefined): string | undefined {
  if (!flags) return undefined
  const priority: Array<keyof Flags> = [
    'red',
    'black',
    'meatball',
    'yellow',
    'blue',
    'white',
    'checkered',
    'green'
  ]
  return priority.find((flag) => flags[flag])
}

export function mqttSessionRef(snapshot: TelemetrySnapshot | null): string {
  if (!snapshot) return 'none:disconnected'
  if (Number.isSafeInteger(snapshot.sessionUniqueId) && (snapshot.sessionUniqueId ?? -1) >= 0) {
    return `${snapshot.sim}:session-${snapshot.sessionUniqueId}`
  }
  return `${snapshot.sim}:local-session`
}

export function projectMqttTelemetry(
  snapshot: TelemetrySnapshot,
  observedAt: number,
  ttlMs = 2_000
): MqttTelemetryStateData {
  return {
    schemaVersion: MQTT_CONTRACT_VERSION,
    observedAt,
    expiresAt: observedAt + ttlMs,
    sim: snapshot.sim,
    connected: snapshot.connected,
    speedMps: clamp(snapshot.speedKmh / 3.6, 0, 250),
    rpm: clamp(snapshot.rpm, 0, 30_000),
    gear: clamp(Math.trunc(snapshot.gear), -1, 20),
    throttleRatio: clamp(snapshot.throttle, 0, 1),
    brakeRatio: clamp(snapshot.brake, 0, 1),
    clutchRatio: clamp(snapshot.clutch, 0, 1),
    lapDistanceRatio: optionalFinite(snapshot.lapDistPct),
    deltaToBestSec: optionalFinite(snapshot.deltaToBestSec),
    fuelLiters: optionalFinite(snapshot.fuelLiters),
    activeFlags: activeFlags(snapshot.flags),
    stale: observedAt - snapshot.timestamp > ttlMs
  }
}

export function projectMqttSession(
  snapshot: TelemetrySnapshot | null,
  observedAt: number,
  ttlMs = 30_000
): MqttSessionStateData {
  return {
    schemaVersion: MQTT_CONTRACT_VERSION,
    observedAt,
    expiresAt: observedAt + ttlMs,
    sim: snapshot?.sim ?? 'none',
    connected: snapshot?.connected ?? false,
    sessionRef: mqttSessionRef(snapshot),
    sessionType: snapshot?.sessionType,
    sessionState: snapshot?.sessionState,
    carName: snapshot?.carName,
    trackName: snapshot?.trackName,
    trackConfigName: snapshot?.trackConfigName,
    currentLap: optionalFinite(snapshot?.currentLap),
    lapsRemaining: optionalFinite(snapshot?.lapsRemaining),
    position: optionalFinite(snapshot?.position),
    classPosition: optionalFinite(snapshot?.classPosition),
    fuelLiters: optionalFinite(snapshot?.fuelLiters),
    trackTempC: optionalFinite(snapshot?.trackTempC),
    airTempC: optionalFinite(snapshot?.airTempC),
    wetnessRatio: optionalFinite(snapshot?.trackWetnessPct),
    raining: snapshot?.isRaining,
    primaryFlag: primaryTelemetryFlag(snapshot?.flags),
    stale: snapshot ? observedAt - snapshot.timestamp > ttlMs : true
  }
}

function eventData(
  type: MqttEventType,
  sequence: string,
  snapshot: TelemetrySnapshot | null,
  observedAt: number,
  facts: Record<string, string | number | boolean>,
  severity: MqttRaceEventData['severity'] = 'notice'
): MqttRaceEventData {
  const sessionRef = mqttSessionRef(snapshot)
  const eventId = `${sessionRef}:${type}:${sequence}`
  return {
    schemaVersion: MQTT_CONTRACT_VERSION,
    eventId,
    eventType: type,
    observedAt,
    expiresAt: observedAt + 30_000,
    severity,
    sessionRef,
    dedupeKey: eventId,
    facts
  }
}

function warningNames(snapshot: TelemetrySnapshot | null): string[] {
  if (!snapshot?.engineWarnings) return []
  return Object.entries(snapshot.engineWarnings)
    .filter(([, active]) => active)
    .map(([name]) => name)
    .sort()
}

export function mqttEventsFromTelemetryTransition(
  previous: TelemetrySnapshot | null,
  next: TelemetrySnapshot | null,
  sequenceStart: number,
  observedAt: number
): MqttRaceEventData[] {
  const events: MqttRaceEventData[] = []
  let sequence = sequenceStart
  const add = (
    type: MqttEventType,
    facts: Record<string, string | number | boolean>,
    severity?: MqttRaceEventData['severity']
  ): void => {
    sequence += 1
    events.push(eventData(type, String(sequence), next ?? previous, observedAt, facts, severity))
  }
  if (previous?.connected && !next?.connected) {
    add('disconnect', { sim: previous.sim, reason: 'source-disconnected' }, 'warning')
  }
  if (!previous?.connected && next?.connected) {
    add('session', { state: 'connected', sim: next.sim })
  }
  const previousFlag = primaryTelemetryFlag(previous?.flags)
  const nextFlag = primaryTelemetryFlag(next?.flags)
  if (next?.connected && previousFlag !== nextFlag) {
    add('flag', { previous: previousFlag ?? 'none', current: nextFlag ?? 'none' })
  }
  if (next?.connected && previous?.onPitRoad !== next.onPitRoad) {
    add('pit', { onPitRoad: next.onPitRoad === true })
  }
  if (next?.connected && previous?.sessionState !== next.sessionState) {
    add('session', { previous: previous?.sessionState ?? 'unknown', current: next.sessionState ?? 'unknown' })
  }
  const beforeWarnings = new Set(warningNames(previous))
  for (const warning of warningNames(next)) {
    if (!beforeWarnings.has(warning)) add('warning', { warning }, 'warning')
  }
  return events
}

export function buildMqttCloudEvent<T extends MqttPayloadData>(
  kind: MqttSchemaKind,
  data: T,
  context: MqttEnvelopeContext
): MqttCloudEvent<T> {
  const stale = context.stale ?? ('stale' in data && data.stale === true)
  return {
    specversion: '1.0',
    id: context.id,
    source: `urn:ultimate-sim:instance:${context.instanceId}`,
    type: MQTT_EVENT_NAMES[kind],
    subject: context.subject,
    time: new Date(context.observedAt).toISOString(),
    datacontenttype: 'application/json',
    dataschema: MQTT_SCHEMA_IDS[kind],
    sequence: context.sequence,
    sourcetick: context.sourceTick,
    monotonicns: context.monotonicNs,
    sessionid: context.sessionId,
    producerid: MQTT_PRODUCER_ID,
    schemafp: MQTT_SCHEMA_FINGERPRINTS[kind],
    correlationid: context.correlationId ?? '',
    causationid: context.causationId ?? '',
    privacyclass: context.privacyClass ?? 'D2',
    rolepolicyid: MQTT_ROLE_POLICY_ID,
    capgrantid: context.capabilityGrantId,
    consentepoch: context.consentEpoch ?? '0',
    approvalid: context.approvalId ?? '',
    partitionkey: context.partitionKey,
    partitionseq: context.partitionSeq,
    stale,
    derived: context.derived ?? true,
    gap: context.gap ?? false,
    data
  }
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

function canonicalJson(value: unknown): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (finite(value)) return value
  if (Array.isArray(value)) return value.map((entry) => canonicalJson(entry))
  if (!isRecord(value)) throw new MqttContractError('Payload contains a non-JSON value.', 'invalid-payload')
  const result: Record<string, JsonValue> = {}
  for (const key of Object.keys(value).sort()) {
    const entry = value[key]
    if (entry !== undefined) result[key] = canonicalJson(entry)
  }
  return result
}

export function stableMqttJson(value: unknown): string {
  return JSON.stringify(canonicalJson(value))
}

export function serializeMqttPayload(value: unknown, maxBytes: number): Uint8Array {
  assertNoSecretKeys(value)
  const encoded = new TextEncoder().encode(stableMqttJson(value))
  if (encoded.byteLength > maxBytes) {
    throw new MqttContractError(
      `MQTT payload is ${encoded.byteLength} bytes; limit is ${maxBytes}.`,
      'oversized'
    )
  }
  return encoded
}

interface StringFieldOptions {
  minLength?: number
  maxLength?: number
  pattern?: RegExp
}

interface NumberFieldOptions {
  integer?: boolean
  min?: number
  max?: number
}

const MQTT_CONNECTION_STATES = new Set<MqttConnectionState>([
  'disabled',
  'connecting',
  'online',
  'reconnecting',
  'stopping',
  'error'
])
const MQTT_RESULT_STATUSES = new Set<MqttCommandResultData['status']>([
  'ok',
  'denied',
  'expired',
  'unsupported',
  'failed'
])
const MQTT_SCHEMA_KINDS = new Set<MqttSchemaKind>([
  'availability',
  'telemetry',
  'session',
  'event',
  'health',
  'announcement',
  'command',
  'result'
])
const MQTT_HEALTH_METRIC_KEYS: ReadonlyArray<keyof MqttHealthMetrics> = [
  'published',
  'received',
  'denied',
  'duplicates',
  'schemaRejects',
  'staleRetainedCleared',
  'rateLimited',
  'oversized',
  'overloadDropped',
  'coalesced',
  'reconnects',
  'resyncs',
  'publishFailures'
]

function hasField(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function stringField(
  value: Record<string, unknown>,
  key: string,
  options: StringFieldOptions = {}
): string {
  const field = value[key]
  if (typeof field !== 'string') {
    throw new MqttContractError(`Missing string field ${key}.`, 'invalid-payload')
  }
  if (
    (options.minLength !== undefined && field.length < options.minLength) ||
    (options.maxLength !== undefined && field.length > options.maxLength) ||
    (options.pattern && !options.pattern.test(field))
  ) {
    throw new MqttContractError(`Invalid string field ${key}.`, 'invalid-payload')
  }
  return field
}

function optionalStringField(
  value: Record<string, unknown>,
  key: string,
  options: StringFieldOptions = {}
): void {
  if (hasField(value, key)) stringField(value, key, options)
}

function numberField(
  value: Record<string, unknown>,
  key: string,
  options: NumberFieldOptions = {}
): number {
  const field = value[key]
  if (
    !finite(field) ||
    (options.integer && !Number.isInteger(field)) ||
    (options.min !== undefined && field < options.min) ||
    (options.max !== undefined && field > options.max)
  ) {
    throw new MqttContractError(`Missing or invalid numeric field ${key}.`, 'invalid-payload')
  }
  return field
}

function optionalNumberField(
  value: Record<string, unknown>,
  key: string,
  options: NumberFieldOptions = {}
): void {
  if (hasField(value, key)) numberField(value, key, options)
}

function booleanField(value: Record<string, unknown>, key: string): boolean {
  if (typeof value[key] !== 'boolean') {
    throw new MqttContractError(`Missing boolean field ${key}.`, 'invalid-payload')
  }
  return value[key] as boolean
}

function optionalBooleanField(value: Record<string, unknown>, key: string): void {
  if (hasField(value, key)) booleanField(value, key)
}

function recordField(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const field = value[key]
  if (!isRecord(field)) {
    throw new MqttContractError(`Missing object field ${key}.`, 'invalid-payload')
  }
  return field
}

function assertObjectKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new MqttContractError(`Unknown ${label} field ${key}.`, 'schema-drift')
    }
  }
}

function scalarMapField(
  value: Record<string, unknown>,
  key: string,
  maxProperties: number
): void {
  const field = recordField(value, key)
  if (Object.keys(field).length > maxProperties) {
    throw new MqttContractError(`${key} exceeds its property limit.`, 'invalid-payload')
  }
  for (const entry of Object.values(field)) {
    if (typeof entry !== 'string' && typeof entry !== 'boolean' && !finite(entry)) {
      throw new MqttContractError(`${key} values must be JSON scalars.`, 'invalid-payload')
    }
  }
}

function validatePayloadData(kind: MqttSchemaKind, data: Record<string, unknown>): void {
  assertObjectKeys(data, PAYLOAD_KEYS[kind], `${kind} payload`)
  if (data.schemaVersion !== MQTT_CONTRACT_VERSION) {
    throw new MqttContractError('Unsupported MQTT payload schema version.', 'schema-drift')
  }

  if (kind === 'availability') {
    if (data.status !== 'online' && data.status !== 'offline') {
      throw new MqttContractError('Invalid availability status.', 'invalid-payload')
    }
    stringField(data, 'instanceId', { minLength: 1, maxLength: 32, pattern: INSTANCE_ID })
    numberField(data, 'observedAt', { integer: true, min: 0 })
    numberField(data, 'expiresAt', { integer: true, min: 0 })
    numberField(data, 'generation', { integer: true, min: 0 })
    return
  }

  if (kind === 'telemetry') {
    numberField(data, 'observedAt', { integer: true, min: 0 })
    numberField(data, 'expiresAt', { integer: true, min: 0 })
    stringField(data, 'sim', { minLength: 1, maxLength: 32 })
    booleanField(data, 'connected')
    numberField(data, 'speedMps', { min: 0, max: 250 })
    numberField(data, 'rpm', { min: 0, max: 30_000 })
    numberField(data, 'gear', { integer: true, min: -1, max: 20 })
    numberField(data, 'throttleRatio', { min: 0, max: 1 })
    numberField(data, 'brakeRatio', { min: 0, max: 1 })
    numberField(data, 'clutchRatio', { min: 0, max: 1 })
    const flags = data.activeFlags
    if (
      !Array.isArray(flags) ||
      flags.length > 16 ||
      flags.some((flag) => typeof flag !== 'string' || flag.length > 32) ||
      new Set(flags).size !== flags.length
    ) {
      throw new MqttContractError('Invalid telemetry activeFlags.', 'invalid-payload')
    }
    booleanField(data, 'stale')
    optionalNumberField(data, 'lapDistanceRatio', { min: 0, max: 1 })
    optionalNumberField(data, 'deltaToBestSec')
    optionalNumberField(data, 'fuelLiters', { min: 0 })
    return
  }

  if (kind === 'session') {
    numberField(data, 'observedAt', { integer: true, min: 0 })
    numberField(data, 'expiresAt', { integer: true, min: 0 })
    stringField(data, 'sim', { minLength: 1, maxLength: 32 })
    booleanField(data, 'connected')
    stringField(data, 'sessionRef', { minLength: 1, maxLength: 128 })
    booleanField(data, 'stale')
    optionalStringField(data, 'sessionType', { maxLength: 64 })
    optionalStringField(data, 'sessionState', { maxLength: 64 })
    optionalStringField(data, 'carName', { maxLength: 128 })
    optionalStringField(data, 'trackName', { maxLength: 128 })
    optionalStringField(data, 'trackConfigName', { maxLength: 128 })
    optionalNumberField(data, 'currentLap', { min: 0 })
    optionalNumberField(data, 'lapsRemaining', { min: 0 })
    optionalNumberField(data, 'position', { min: 0 })
    optionalNumberField(data, 'classPosition', { min: 0 })
    optionalNumberField(data, 'fuelLiters', { min: 0 })
    optionalNumberField(data, 'trackTempC')
    optionalNumberField(data, 'airTempC')
    optionalNumberField(data, 'wetnessRatio', { min: 0, max: 1 })
    optionalBooleanField(data, 'raining')
    optionalStringField(data, 'primaryFlag', { maxLength: 32 })
    return
  }

  if (kind === 'event') {
    stringField(data, 'eventId', { minLength: 1, maxLength: 256 })
    const eventType = stringField(data, 'eventType')
    if (!MQTT_EVENT_TYPES.includes(eventType as MqttEventType)) {
      throw new MqttContractError('Unknown race event type.', 'schema-drift')
    }
    numberField(data, 'observedAt', { integer: true, min: 0 })
    numberField(data, 'expiresAt', { integer: true, min: 0 })
    const severity = stringField(data, 'severity')
    if (!['info', 'notice', 'warning'].includes(severity)) {
      throw new MqttContractError('Invalid race event severity.', 'invalid-payload')
    }
    stringField(data, 'sessionRef', { minLength: 1, maxLength: 128 })
    stringField(data, 'dedupeKey', { minLength: 1, maxLength: 256 })
    scalarMapField(data, 'facts', 24)
    return
  }

  if (kind === 'health') {
    numberField(data, 'observedAt', { integer: true, min: 0 })
    numberField(data, 'expiresAt', { integer: true, min: 0 })
    const state = stringField(data, 'state')
    if (!MQTT_CONNECTION_STATES.has(state as MqttConnectionState)) {
      throw new MqttContractError('Invalid connector state.', 'invalid-payload')
    }
    numberField(data, 'queueDepth', { integer: true, min: 0, max: MQTT_MAX_QUEUE_DEPTH })
    const circuit = stringField(data, 'circuit')
    if (!['closed', 'open', 'half-open'].includes(circuit)) {
      throw new MqttContractError('Invalid connector circuit state.', 'invalid-payload')
    }
    const metrics = recordField(data, 'metrics')
    assertObjectKeys(metrics, new Set<string>(MQTT_HEALTH_METRIC_KEYS), 'health metric')
    for (const key of MQTT_HEALTH_METRIC_KEYS) {
      numberField(metrics, key, { integer: true, min: 0 })
    }
    return
  }

  if (kind === 'announcement') {
    numberField(data, 'observedAt', { integer: true, min: 0 })
    numberField(data, 'expiresAt', { integer: true, min: 0 })
    if (data.topicVersion !== MQTT_TOPIC_VERSION) {
      throw new MqttContractError('Invalid schema announcement topic version.', 'schema-drift')
    }
    const schemas = data.schemas
    if (!Array.isArray(schemas) || schemas.length !== MQTT_SCHEMA_KINDS.size) {
      throw new MqttContractError('Invalid schema announcement list.', 'invalid-payload')
    }
    const schemaKeys = new Set(['kind', 'id', 'fingerprint'])
    const announcedKinds = new Set<MqttSchemaKind>()
    for (const schema of schemas) {
      if (!isRecord(schema)) {
        throw new MqttContractError('Invalid schema announcement entry.', 'invalid-payload')
      }
      assertObjectKeys(schema, schemaKeys, 'schema announcement')
      const schemaKind = stringField(schema, 'kind')
      if (!MQTT_SCHEMA_KINDS.has(schemaKind as MqttSchemaKind)) {
        throw new MqttContractError('Unknown announced schema kind.', 'schema-drift')
      }
      if (announcedKinds.has(schemaKind as MqttSchemaKind)) {
        throw new MqttContractError('Duplicate announced schema kind.', 'invalid-payload')
      }
      announcedKinds.add(schemaKind as MqttSchemaKind)
      stringField(schema, 'id', { minLength: 1, maxLength: 128 })
      stringField(schema, 'fingerprint', { pattern: /^[a-f0-9]{64}$/ })
    }
    if (announcedKinds.size !== MQTT_SCHEMA_KINDS.size) {
      throw new MqttContractError('Incomplete schema announcement list.', 'invalid-payload')
    }
    return
  }

  if (kind === 'command') {
    const requestId = stringField(data, 'requestId')
    const capability = stringField(data, 'capability')
    if (!REQUEST_ID.test(requestId)) {
      throw new MqttContractError('Invalid command request ID.', 'invalid-payload')
    }
    if (!MQTT_COMMAND_CAPABILITIES.includes(capability as MqttCommandCapability)) {
      throw new MqttContractError('Command capability is not allowlisted.', 'acl-denied')
    }
    numberField(data, 'issuedAt', { integer: true, min: 0 })
    numberField(data, 'expiresAt', { integer: true, min: 0 })
    scalarMapField(data, 'args', 16)
    return
  }

  const requestId = stringField(data, 'requestId')
  const capability = stringField(data, 'capability')
  const status = stringField(data, 'status')
  if (!REQUEST_ID.test(requestId)) {
    throw new MqttContractError('Invalid command result request ID.', 'invalid-payload')
  }
  if (!MQTT_COMMAND_CAPABILITIES.includes(capability as MqttCommandCapability)) {
    throw new MqttContractError('Unknown command result capability.', 'schema-drift')
  }
  if (!MQTT_RESULT_STATUSES.has(status as MqttCommandResultData['status'])) {
    throw new MqttContractError('Unknown command result status.', 'schema-drift')
  }
  numberField(data, 'observedAt', { integer: true, min: 0 })
  numberField(data, 'expiresAt', { integer: true, min: 0 })
  booleanField(data, 'duplicate')
  stringField(data, 'message', { maxLength: 512 })
}

export function parseMqttCloudEvent<T extends MqttPayloadData>(
  payload: Uint8Array,
  kind: MqttSchemaKind
): MqttCloudEvent<T> {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(payload))
  } catch {
    throw new MqttContractError('MQTT payload is not valid JSON.', 'invalid-payload')
  }
  assertNoSecretKeys(parsed)
  if (!isRecord(parsed)) throw new MqttContractError('MQTT envelope must be an object.', 'invalid-payload')
  for (const key of Object.keys(parsed)) {
    if (!ENVELOPE_KEYS.has(key)) throw new MqttContractError(`Unknown envelope field ${key}.`, 'schema-drift')
  }
  if (
    parsed.specversion !== '1.0' ||
    parsed.datacontenttype !== 'application/json' ||
    parsed.dataschema !== MQTT_SCHEMA_IDS[kind] ||
    parsed.type !== MQTT_EVENT_NAMES[kind] ||
    parsed.schemafp !== MQTT_SCHEMA_FINGERPRINTS[kind] ||
    parsed.producerid !== MQTT_PRODUCER_ID ||
    parsed.rolepolicyid !== MQTT_ROLE_POLICY_ID
  ) {
    throw new MqttContractError('MQTT envelope schema drift detected.', 'schema-drift')
  }
  for (const key of [
    'id',
    'source',
    'time',
    'sequence',
    'sourcetick',
    'monotonicns',
    'sessionid',
    'producerid',
    'correlationid',
    'causationid',
    'privacyclass',
    'rolepolicyid',
    'capgrantid',
    'consentepoch',
    'approvalid',
    'partitionkey',
    'partitionseq'
  ]) {
    stringField(parsed, key)
  }
  optionalStringField(parsed, 'subject')
  if (!['D0', 'D1', 'D2', 'D3', 'D4', 'D5'].includes(parsed.privacyclass as string)) {
    throw new MqttContractError('Invalid MQTT privacy class.', 'invalid-payload')
  }
  booleanField(parsed, 'stale')
  booleanField(parsed, 'derived')
  booleanField(parsed, 'gap')
  if (!isRecord(parsed.data)) throw new MqttContractError('MQTT envelope data must be an object.', 'invalid-payload')
  validatePayloadData(kind, parsed.data)
  return parsed as unknown as MqttCloudEvent<T>
}

export function retainedEnvelopeIsFresh(
  envelope: MqttCloudEvent,
  now: number,
  retainedMaxAgeMs: number
): boolean {
  if (!('expiresAt' in envelope.data) || !finite(envelope.data.expiresAt)) return false
  if (
    'status' in envelope.data &&
    envelope.data.status === 'offline'
  ) {
    return !envelope.stale && now < envelope.data.expiresAt
  }
  const observedAt = 'observedAt' in envelope.data && finite(envelope.data.observedAt)
    ? envelope.data.observedAt
    : Date.parse(envelope.time)
  return (
    !envelope.stale &&
    finite(observedAt) &&
    now - observedAt <= retainedMaxAgeMs &&
    now < envelope.data.expiresAt
  )
}

export function validateRetainedPublication(
  topic: string,
  retained: boolean,
  envelope: MqttCloudEvent,
  config: MqttLocalConfig,
  now: number
): void {
  const policy = mqttTopicPolicy(topic, config.instanceId)
  if (!policy) throw new MqttContractError('Unknown MQTT topic.', 'invalid-topic')
  if (retained !== policy.retained) {
    throw new MqttContractError('Retained flag violates the topic contract.', 'invalid-payload')
  }
  if (retained && !retainedEnvelopeIsFresh(envelope, now, config.retainedMaxAgeMs)) {
    throw new MqttContractError('Retained payload is stale.', 'stale-retained')
  }
}

export function mqttSchemaAnnouncement(observedAt: number, ttlMs = 5 * 60_000): MqttSchemaAnnouncementData {
  return {
    schemaVersion: MQTT_CONTRACT_VERSION,
    observedAt,
    expiresAt: observedAt + ttlMs,
    topicVersion: MQTT_TOPIC_VERSION,
    schemas: (Object.keys(MQTT_SCHEMA_IDS) as MqttSchemaKind[]).map((kind) => ({
      kind,
      id: MQTT_SCHEMA_IDS[kind],
      fingerprint: MQTT_SCHEMA_FINGERPRINTS[kind]
    }))
  }
}

export function mqttContractSummary(configInput: MqttLocalConfig): MqttContractSummary {
  const config = normalizeMqttLocalConfig(configInput)
  const topics = mqttTopics(config.instanceId)
  const urls = mqttBrokerUrls(config)
  return {
    version: MQTT_CONTRACT_VERSION,
    localOnly: true,
    userSuppliedCredentialsSupported: false,
    defaultEnabled: false,
    topics: {
      availability: topics.availability,
      telemetry: topics.telemetry,
      session: topics.session,
      events: `${topics.root}/event/<flag|pit|warning|disconnect|session>`,
      health: topics.health,
      announcement: topics.announcement,
      commands: `${topics.root}/command/<allowlisted-capability>`,
      results: `${topics.root}/result/<request-id>`
    },
    broker: {
      publisherUrl: urls.publisher,
      readerUrl: urls.reader,
      commandUrl: urls.command,
      authentication: 'generated-local-role-secrets',
      listenerCapabilities: {
        'target-publisher': [
          'publish availability/state/event/health/schema/result',
          'subscribe command only when explicitly enabled'
        ],
        'local-reader': ['subscribe availability/state/event/health/schema/result', 'no publish'],
        'local-command': ['publish allowlisted command topics', 'subscribe matching result topics']
      }
    },
    retainedRules: [
      'Availability, session state, health and schema announcement are retained with explicit expiry.',
      'Telemetry fast state, events, commands and results are never retained.',
      'A bounded heartbeat refreshes retained online state; the offline last-will uses MQTT message expiry.',
      'Reconnect clears known retained slots before publishing a fresh generation.',
      'Stale retained envelopes are rejected and tombstoned.'
    ],
    limits: {
      telemetryRateHz: config.telemetryRateHz,
      commandRateHz: 2,
      commandBurst: 4,
      maxPayloadBytes: config.maxPayloadBytes,
      queueDepth: MQTT_MAX_QUEUE_DEPTH
    }
  }
}

export function buildMosquittoLoopbackConfig(configInput: MqttLocalConfig): string {
  const config = normalizeMqttLocalConfig(configInput)
  const lines = [
    '# Ultimate Sim App MQTT v1 local-only certification broker',
    'per_listener_settings true',
    'persistence false',
    `max_packet_size ${config.maxPayloadBytes}`,
    `message_size_limit ${config.maxPayloadBytes}`,
    `max_queued_messages ${MQTT_MAX_QUEUE_DEPTH}`,
    '',
    `listener ${config.port} ${config.host}`,
    'allow_anonymous false',
    'password_file mqtt-publisher.passwd',
    'acl_file mqtt-publisher.acl',
    '',
    `listener ${config.port + 1} ${config.host}`,
    'allow_anonymous false',
    'password_file mqtt-reader.passwd',
    'acl_file mqtt-reader.acl'
  ]
  if (config.commandsEnabled) {
    lines.push(
      '',
      `listener ${config.port + 2} ${config.host}`,
      'allow_anonymous false',
      'password_file mqtt-command.passwd',
      'acl_file mqtt-command.acl'
    )
  }
  return lines.join('\n')
}

export function buildMosquittoAclFiles(configInput: MqttLocalConfig): Record<string, string> {
  const config = normalizeMqttLocalConfig(configInput)
  const root = mqttTopics(config.instanceId).root
  return {
    'mqtt-publisher.acl': [
      `user ${MQTT_BROKER_USERNAMES['target-publisher']}`,
      `topic write ${root}/availability`,
      `topic write ${root}/state/+`,
      `topic write ${root}/event/+`,
      `topic write ${root}/health`,
      `topic write ${root}/schema/announcement`,
      `topic write ${root}/result/+`,
      ...MQTT_COMMAND_CAPABILITIES.map(
        (capability) => `topic read ${root}/command/${capability}`
      )
    ].join('\n'),
    'mqtt-reader.acl': [
      `user ${MQTT_BROKER_USERNAMES['local-reader']}`,
      `topic read ${root}/availability`,
      `topic read ${root}/state/+`,
      `topic read ${root}/event/+`,
      `topic read ${root}/health`,
      `topic read ${root}/schema/announcement`,
      `topic read ${root}/result/+`
    ].join('\n'),
    'mqtt-command.acl': [
      `user ${MQTT_BROKER_USERNAMES['local-command']}`,
      ...MQTT_COMMAND_CAPABILITIES.map(
        (capability) => `topic write ${root}/command/${capability}`
      ),
      `topic read ${root}/result/+`
    ].join('\n')
  }
}
