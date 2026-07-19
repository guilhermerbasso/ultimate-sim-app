import { randomUUID } from 'node:crypto'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import {
  MQTT_COMMAND_CACHE_SIZE,
  MQTT_COMMAND_CAPABILITIES,
  MQTT_CONTRACT_VERSION,
  MQTT_MAX_QUEUE_DEPTH,
  MQTT_ROLE_POLICY_ID,
  authorizeMqttOperation,
  buildMqttCloudEvent,
  createMqttCapabilityGrant,
  emptyMqttHealthMetrics,
  mqttBrokerUrls,
  mqttContractSummary,
  mqttEventsFromTelemetryTransition,
  mqttSchemaAnnouncement,
  mqttSessionRef,
  mqttTopicPolicy,
  mqttTopics,
  normalizeMqttLocalConfig,
  parseMqttCloudEvent,
  projectMqttSession,
  projectMqttTelemetry,
  serializeMqttPayload,
  stableMqttJson,
  validateRetainedPublication,
  type MqttAvailabilityData,
  type MqttCapabilityGrant,
  type MqttCloudEvent,
  type MqttCommandCapability,
  type MqttCommandRequestData,
  type MqttCommandResultData,
  type MqttConnectorHealthData,
  type MqttContractSummary,
  type MqttEnvelopeContext,
  type MqttLocalConfig,
  type MqttPayloadData,
  type MqttQos,
  type MqttRaceEventData,
  type MqttSchemaKind,
  type MqttTargetStatus
} from '../../shared/mqtt'
import type { MqttTransportAccess } from './broker-auth'

export interface MqttTransportPacket {
  topic: string
  payload: Uint8Array
  qos: MqttQos
  retain: boolean
  messageExpirySec?: number
}

export interface MqttIncomingPacket extends MqttTransportPacket {
  dup: boolean
  principal?: string
}

export interface MqttTransportHandlers {
  onConnect(sessionPresent: boolean): void
  onDisconnect(error?: Error): void
  onMessage(packet: MqttIncomingPacket): void
}

export interface MqttTransport {
  connect(): void
  publish(packet: MqttTransportPacket): Promise<void>
  subscribe(topicFilter: string, qos: MqttQos): Promise<void>
  setWill(packet: MqttTransportPacket): void
  close(): Promise<void>
}

export type MqttTransportFactory = (
  config: MqttLocalConfig,
  grant: MqttCapabilityGrant,
  will: MqttTransportPacket,
  handlers: MqttTransportHandlers,
  access?: MqttTransportAccess
) => MqttTransport

export type MqttCommandHandler = (
  args: Readonly<Record<string, string | number | boolean>>
) => Promise<string | void> | string | void

export interface MqttTargetOptions {
  now?: () => number
  monotonicNs?: () => bigint
  commandHandlers?: Partial<Record<MqttCommandCapability, MqttCommandHandler>>
  onStatus?: (status: MqttTargetStatus) => void
  runId?: string
  setupDirectory?: string
}

interface QueuedPublication {
  kind: MqttSchemaKind
  envelope: MqttCloudEvent
  packet: MqttTransportPacket
  expiresAt: number
  epoch: number
}

interface CachedCommandResult {
  result: MqttCommandResultData
  expiresAt: number
}

interface InFlightCommand {
  epoch: number
  promise: Promise<MqttCommandResultData>
}

const CRITICAL_QUEUE_KINDS = new Set<MqttSchemaKind>([
  'availability',
  'session',
  'health',
  'announcement'
])
const NONCRITICAL_QUEUE_LIMIT = MQTT_MAX_QUEUE_DEPTH - CRITICAL_QUEUE_KINDS.size

function cloneConfig(config: MqttLocalConfig): MqttLocalConfig {
  return { ...config }
}

function cloneMetrics(status: MqttTargetStatus): MqttTargetStatus {
  return {
    ...status,
    config: cloneConfig(status.config),
    metrics: { ...status.metrics }
  }
}

function envelopeExpiresAt(envelope: MqttCloudEvent): number {
  return 'expiresAt' in envelope.data && typeof envelope.data.expiresAt === 'number'
    ? envelope.data.expiresAt
    : Number.MAX_SAFE_INTEGER
}

function compactError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/g, ' ').trim().slice(0, 512)
}

export class MqttCertificationTarget {
  private config = normalizeMqttLocalConfig(undefined)
  private status: MqttTargetStatus
  private grant: MqttCapabilityGrant | null = null
  private transport: MqttTransport | null = null
  private queue: QueuedPublication[] = []
  private drainingEpochs = new Set<number>()
  private stopped = true
  private sequence = 0
  private eventSequence = 0
  private latestSnapshot: TelemetrySnapshot | null = null
  private previousSnapshot: TelemetrySnapshot | null = null
  private lastTelemetryPublishAt = Number.NEGATIVE_INFINITY
  private lastSessionPublishAt = Number.NEGATIVE_INFINITY
  private lastSessionSignature = ''
  private commandResults = new Map<string, CachedCommandResult>()
  private commandInFlight = new Map<string, InFlightCommand>()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private commandWindowStartedAt = Number.NEGATIVE_INFINITY
  private commandWindowCount = 0
  private lifecycleEpoch = 0
  private resyncingEpochs = new Set<number>()
  private publishTails = new WeakMap<MqttTransport, Promise<void>>()
  private transportAccess: MqttTransportAccess | undefined
  private readonly now: () => number
  private readonly monotonicNs: () => bigint
  private readonly commandHandlers: Partial<Record<MqttCommandCapability, MqttCommandHandler>>
  private readonly onStatus?: (status: MqttTargetStatus) => void
  private readonly runId: string

  constructor(
    private readonly transportFactory: MqttTransportFactory,
    options: MqttTargetOptions = {}
  ) {
    this.now = options.now ?? Date.now
    this.monotonicNs = options.monotonicNs ?? (() => process.hrtime.bigint())
    this.commandHandlers = options.commandHandlers ?? {}
    this.onStatus = options.onStatus
    this.runId = options.runId ?? randomUUID()
    const urls = mqttBrokerUrls(this.config)
    this.status = {
      config: cloneConfig(this.config),
      state: 'disabled',
      brokerUrl: urls.publisher,
      readerUrl: urls.reader,
      commandUrl: urls.command,
      setupDirectory: options.setupDirectory,
      connected: false,
      generation: 0,
      queueDepth: 0,
      commandsSubscribed: false,
      metrics: emptyMqttHealthMetrics()
    }
  }

  getConfig(): MqttLocalConfig {
    return cloneConfig(this.config)
  }

  getStatus(): MqttTargetStatus {
    this.status.queueDepth = this.queue.length
    return cloneMetrics(this.status)
  }

  getContract(): MqttContractSummary {
    return mqttContractSummary(this.config)
  }

  getCapabilityGrant(): MqttCapabilityGrant | null {
    return this.grant
      ? { ...this.grant, capabilities: [...this.grant.capabilities] }
      : null
  }

  async start(
    configInput: unknown,
    access?: MqttTransportAccess
  ): Promise<MqttTargetStatus> {
    if (this.transport) await this.stop(true)
    const epoch = ++this.lifecycleEpoch
    this.config = normalizeMqttLocalConfig(configInput)
    this.transportAccess = access ? { ...access } : undefined
    const urls = mqttBrokerUrls(this.config)
    this.status = {
      config: cloneConfig(this.config),
      state: this.config.enabled ? 'connecting' : 'disabled',
      brokerUrl: urls.publisher,
      readerUrl: urls.reader,
      commandUrl: urls.command,
      setupDirectory: this.status.setupDirectory,
      connected: false,
      generation: this.status.generation,
      queueDepth: 0,
      commandsSubscribed: false,
      metrics: this.status.metrics
    }
    this.stopped = !this.config.enabled
    this.queue = []
    this.previousSnapshot = null
    this.lastSessionSignature = ''
    this.commandResults.clear()
    this.commandInFlight.clear()
    this.commandWindowStartedAt = Number.NEGATIVE_INFINITY
    this.commandWindowCount = 0
    if (!this.config.enabled) {
      this.notify()
      return this.getStatus()
    }

    const now = this.now()
    this.status.generation += 1
    this.grant = createMqttCapabilityGrant('target-publisher', this.config, now, 365 * 24 * 60 * 60 * 1000)
    const will = this.availabilityPacket('offline', now)
    try {
      this.transport = this.transportFactory(
        this.config,
        this.grant,
        will,
        {
          onConnect: (sessionPresent) => {
            void this.handleConnect(sessionPresent, epoch)
          },
          onDisconnect: (error) => this.handleDisconnect(error, epoch),
          onMessage: (packet) => {
            void this.handleIncoming(packet, epoch)
          }
        },
        this.transportAccess
      )
      this.transport.connect()
    } catch (error) {
      this.transport = null
      this.grant.revoked = true
      this.markError(error)
      return this.getStatus()
    }
    this.startHeartbeat()
    this.notify()
    return this.getStatus()
  }

  async reconnect(): Promise<MqttTargetStatus> {
    const config = this.getConfig()
    const access = this.transportAccess ? { ...this.transportAccess } : undefined
    return this.start(config, access)
  }

  async stop(publishOffline = true): Promise<MqttTargetStatus> {
    this.lifecycleEpoch += 1
    this.stopped = true
    this.stopHeartbeat()
    if (this.status.state !== 'disabled') {
      this.status.state = 'stopping'
      this.notify()
    }
    const transport = this.transport
    const grant = this.grant
    if (transport && publishOffline && this.status.connected && grant && !grant.revoked) {
      try {
        await this.clearRetainedSlots(transport, grant)
        await this.publishTransport(transport, this.availabilityPacket('offline', this.now()))
      } catch {
        this.status.metrics.publishFailures += 1
      }
    }
    this.grant && (this.grant.revoked = true)
    this.queue = []
    this.status.queueDepth = 0
    this.status.commandsSubscribed = false
    this.status.connected = false
    this.transport = null
    this.transportAccess = undefined
    if (transport) {
      try {
        await transport.close()
      } catch {
        this.status.metrics.publishFailures += 1
      }
    }
    this.status.state = 'disabled'
    this.notify()
    return this.getStatus()
  }

  revokeEgress(): void {
    if (this.grant) this.grant.revoked = true
    void this.drain()
  }

  ingestTelemetry(snapshot: TelemetrySnapshot | null): void {
    const now = this.now()
    const events = mqttEventsFromTelemetryTransition(
      this.previousSnapshot,
      snapshot,
      this.eventSequence,
      now
    )
    this.eventSequence += events.length
    this.previousSnapshot = snapshot
    this.latestSnapshot = snapshot
    for (const event of events) this.publishRaceEvent(event)

    if (snapshot?.connected) {
      const intervalMs = 1000 / this.config.telemetryRateHz
      if (now - this.lastTelemetryPublishAt >= intervalMs) {
        this.lastTelemetryPublishAt = now
        this.publishTelemetryState(snapshot, now)
      } else {
        this.status.metrics.rateLimited += 1
      }
    }

    const session = projectMqttSession(snapshot, now, this.config.retainedMaxAgeMs)
    const signature = stableMqttJson({
      ...session,
      observedAt: 0,
      expiresAt: 0,
      stale: false
    })
    if (
      signature !== this.lastSessionSignature &&
      now - this.lastSessionPublishAt >= 500
    ) {
      this.lastSessionSignature = signature
      this.lastSessionPublishAt = now
      this.publishSessionState(session)
    }
    this.notify()
  }

  publishRaceEvent(event: MqttRaceEventData): void {
    const topics = mqttTopics(this.config.instanceId)
    const scopedEvent: MqttRaceEventData = {
      ...event,
      eventId: `${this.runId}:${event.eventId}`,
      dedupeKey: `${this.runId}:${event.dedupeKey}`
    }
    this.enqueueEnvelope(topics.event(scopedEvent.eventType), 'event', scopedEvent, {
      sessionId: scopedEvent.sessionRef,
      partitionKey: `session:${scopedEvent.sessionRef}`,
      correlationId: scopedEvent.sessionRef,
      subject: scopedEvent.eventType
    })
  }

  async flush(): Promise<void> {
    for (let i = 0; i < 100; i += 1) {
      await Promise.resolve()
      if (
        !this.drainingEpochs.has(this.lifecycleEpoch) &&
        (!this.status.connected || this.queue.length === 0)
      ) return
    }
  }

  private availabilityPacket(
    state: MqttAvailabilityData['status'],
    observedAt: number
  ): MqttTransportPacket {
    if (!this.grant) {
      this.grant = createMqttCapabilityGrant(
        'target-publisher',
        this.config,
        observedAt,
        365 * 24 * 60 * 60 * 1000
      )
    }
    const data: MqttAvailabilityData = {
      schemaVersion: MQTT_CONTRACT_VERSION,
      status: state,
      instanceId: this.config.instanceId,
      observedAt,
      expiresAt:
        state === 'offline'
          ? observedAt + 365 * 24 * 60 * 60 * 1000
          : observedAt + this.config.retainedMaxAgeMs,
      generation: this.status.generation
    }
    const envelope = this.createEnvelope('availability', data, {
      sessionId: '',
      partitionKey: `mqtt:${this.config.instanceId}`,
      subject: this.config.instanceId,
      stale: false
    })
    return this.packetFor(mqttTopics(this.config.instanceId).availability, envelope)
  }

  private async handleConnect(_sessionPresent: boolean, epoch: number): Promise<void> {
    if (epoch !== this.lifecycleEpoch || this.stopped || !this.transport || !this.grant) return
    this.resyncingEpochs.add(epoch)
    const wasReconnect = this.status.state === 'reconnecting'
    this.status.connected = true
    this.status.state = 'online'
    this.status.lastConnectedAt = this.now()
    this.status.lastError = undefined
    if (wasReconnect) this.status.metrics.reconnects += 1
    this.status.metrics.resyncs += 1
    try {
      await this.clearRetainedSlots(this.transport, this.grant)
      if (epoch !== this.lifecycleEpoch || this.stopped || !this.transport) return
      if (this.config.commandsEnabled) {
        try {
          const topics = mqttTopics(this.config.instanceId)
          for (const capability of MQTT_COMMAND_CAPABILITIES) {
            await this.transport.subscribe(topics.command(capability), 1)
          }
          if (epoch !== this.lifecycleEpoch || this.stopped) return
          this.status.commandsSubscribed = true
        } catch (error) {
          if (epoch !== this.lifecycleEpoch || this.stopped) return
          this.status.commandsSubscribed = false
          this.markError(error)
        }
      }
      const now = this.now()
      this.enqueuePacket(this.availabilityPacket('online', now), 'availability')
      this.publishAnnouncement(now)
      if (this.latestSnapshot) {
        this.publishSessionState(projectMqttSession(this.latestSnapshot, now, this.config.retainedMaxAgeMs))
        if (this.latestSnapshot.connected) this.publishTelemetryState(this.latestSnapshot, now)
      }
      this.publishHealth(now)
      this.notify()
    } finally {
      this.resyncingEpochs.delete(epoch)
    }
    if (epoch !== this.lifecycleEpoch || this.stopped) return
    await this.drain()
  }

  private handleDisconnect(error: Error | undefined, epoch: number): void {
    if (epoch !== this.lifecycleEpoch || this.stopped) return
    this.status.connected = false
    this.status.commandsSubscribed = false
    this.status.state = 'reconnecting'
    this.status.generation += 1
    try {
      this.transport?.setWill(this.availabilityPacket('offline', this.now()))
    } catch (willError) {
      this.status.lastError = compactError(willError)
    }
    if (error) this.status.lastError = compactError(error)
    this.notify()
  }

  private async clearRetainedSlots(
    transport: MqttTransport,
    grant: MqttCapabilityGrant
  ): Promise<void> {
    const topics = mqttTopics(this.config.instanceId)
    const retainedTopics = [topics.availability, topics.session, topics.health, topics.announcement]
    for (const topic of retainedTopics) {
      const decision = authorizeMqttOperation(grant, 'publish', topic, this.config, this.now())
      if (!decision.allowed) {
        this.status.metrics.denied += 1
        continue
      }
      try {
        await this.publishTransport(
          transport,
          { topic, payload: new Uint8Array(), qos: 1, retain: true }
        )
        this.status.metrics.staleRetainedCleared += 1
      } catch (error) {
        this.status.metrics.publishFailures += 1
        this.status.lastError = compactError(error)
        break
      }
    }
  }

  private publishTelemetryState(snapshot: TelemetrySnapshot, observedAt: number): void {
    const data = projectMqttTelemetry(snapshot, observedAt)
    this.enqueueEnvelope(mqttTopics(this.config.instanceId).telemetry, 'telemetry', data, {
      sessionId: mqttSessionRef(snapshot),
      partitionKey: `session:${mqttSessionRef(snapshot)}`,
      subject: 'telemetry',
      stale: data.stale
    })
  }

  private publishSessionState(data: ReturnType<typeof projectMqttSession>): void {
    this.enqueueEnvelope(mqttTopics(this.config.instanceId).session, 'session', data, {
      sessionId: data.sessionRef,
      partitionKey: `session:${data.sessionRef}`,
      subject: 'session',
      stale: data.stale
    })
  }

  private publishAnnouncement(observedAt: number): void {
    const data = mqttSchemaAnnouncement(observedAt)
    this.enqueueEnvelope(mqttTopics(this.config.instanceId).announcement, 'announcement', data, {
      sessionId: '',
      partitionKey: `mqtt:${this.config.instanceId}`,
      subject: 'schema'
    })
  }

  private publishHealth(observedAt: number): void {
    const data: MqttConnectorHealthData = {
      schemaVersion: MQTT_CONTRACT_VERSION,
      observedAt,
      expiresAt: observedAt + this.config.retainedMaxAgeMs,
      state: this.status.state,
      queueDepth: this.queue.length,
      circuit:
        this.status.state === 'error'
          ? 'open'
          : this.status.state === 'reconnecting' || this.status.state === 'connecting'
            ? 'half-open'
            : 'closed',
      metrics: { ...this.status.metrics }
    }
    this.enqueueEnvelope(mqttTopics(this.config.instanceId).health, 'health', data, {
      sessionId: '',
      partitionKey: `mqtt:${this.config.instanceId}`,
      subject: 'health'
    })
  }

  private enqueueEnvelope<T extends MqttPayloadData>(
    topic: string,
    kind: MqttSchemaKind,
    data: T,
    context: Pick<
      MqttEnvelopeContext,
      'sessionId' | 'partitionKey' | 'correlationId' | 'causationId' | 'subject' | 'stale' | 'gap'
    >
  ): void {
    if (!this.grant || this.grant.revoked) {
      this.status.metrics.denied += 1
      return
    }
    const envelope = this.createEnvelope(kind, data, context)
    let packet: MqttTransportPacket
    try {
      packet = this.packetFor(topic, envelope)
      validateRetainedPublication(topic, packet.retain, envelope, this.config, this.now())
    } catch (error) {
      if (error instanceof Error && error.message.includes('bytes')) this.status.metrics.oversized += 1
      else this.status.metrics.schemaRejects += 1
      this.status.lastError = compactError(error)
      return
    }
    this.enqueuePacket(packet, kind, envelope)
  }

  private createEnvelope<T extends MqttPayloadData>(
    kind: MqttSchemaKind,
    data: T,
    context: Pick<
      MqttEnvelopeContext,
      'sessionId' | 'partitionKey' | 'correlationId' | 'causationId' | 'subject' | 'stale' | 'gap'
    >
  ): MqttCloudEvent<T> {
    this.sequence += 1
    const observedAt = 'observedAt' in data ? data.observedAt : this.now()
    return buildMqttCloudEvent(kind, data, {
      id: `${this.config.instanceId}:${this.runId}:${kind}:${this.sequence}`,
      instanceId: this.config.instanceId,
      sequence: String(this.sequence),
      sourceTick: String(observedAt),
      monotonicNs: this.monotonicNs().toString(),
      sessionId: context.sessionId,
      correlationId: context.correlationId,
      causationId: context.causationId,
      partitionKey: context.partitionKey,
      partitionSeq: String(this.sequence),
      privacyClass: 'D2',
      capabilityGrantId: this.grant?.id ?? '',
      consentEpoch: '0',
      approvalId: '',
      subject: context.subject,
      stale: context.stale,
      derived: true,
      gap: context.gap,
      observedAt
    })
  }

  private packetFor(topic: string, envelope: MqttCloudEvent): MqttTransportPacket {
    const policy = mqttTopicPolicy(topic, this.config.instanceId)
    if (!policy) throw new Error(`Unknown MQTT topic: ${topic}`)
    const maxBytes = Math.min(this.config.maxPayloadBytes, policy.maxBytes)
    return {
      topic,
      payload: serializeMqttPayload(envelope, maxBytes),
      qos: policy.qos,
      retain: policy.retained,
      messageExpirySec: policy.messageExpirySec
    }
  }

  private enqueuePacket(
    packet: MqttTransportPacket,
    kind: MqttSchemaKind,
    existingEnvelope?: MqttCloudEvent
  ): void {
    if (!this.grant) {
      this.status.metrics.denied += 1
      return
    }
    const decision = authorizeMqttOperation(this.grant, 'publish', packet.topic, this.config, this.now())
    if (!decision.allowed) {
      this.status.metrics.denied += 1
      this.status.lastError = decision.reason
      return
    }
    let envelope = existingEnvelope
    if (!envelope) {
      const policy = mqttTopicPolicy(packet.topic, this.config.instanceId)
      if (!policy?.schemaKind) return
      envelope = parseMqttCloudEvent(packet.payload, policy.schemaKind)
    }
    const entry: QueuedPublication = {
      kind,
      envelope,
      packet,
      expiresAt: envelopeExpiresAt(envelope),
      epoch: this.lifecycleEpoch
    }
    const coalescible =
      kind === 'availability' ||
      kind === 'telemetry' ||
      kind === 'session' ||
      kind === 'health' ||
      kind === 'announcement'
    if (coalescible) {
      const existingIndex = this.queue.findIndex((entry) => entry.packet.topic === packet.topic)
      if (existingIndex >= 0) {
        this.queue[existingIndex] = entry
        this.status.metrics.coalesced += 1
        this.status.queueDepth = this.queue.length
        void this.drain()
        return
      }
    }
    if (this.insertQueueEntry(entry)) void this.drain()
  }

  private insertQueueEntry(entry: QueuedPublication, front = false): boolean {
    const critical = CRITICAL_QUEUE_KINDS.has(entry.kind)
    const limit = critical ? MQTT_MAX_QUEUE_DEPTH : NONCRITICAL_QUEUE_LIMIT
    if (this.queue.length >= limit) {
      if (critical) {
        const replaceable = this.queue.findIndex(
          (queued) => !CRITICAL_QUEUE_KINDS.has(queued.kind)
        )
        if (replaceable >= 0) {
          this.queue.splice(replaceable, 1)
          this.status.metrics.overloadDropped += 1
        } else {
          this.status.metrics.overloadDropped += 1
          this.status.queueDepth = this.queue.length
          return false
        }
      } else {
        this.status.metrics.overloadDropped += 1
        this.status.queueDepth = this.queue.length
        return false
      }
    }

    if (front) {
      this.queue.unshift(entry)
    } else if (critical) {
      const firstNoncritical = this.queue.findIndex(
        (queued) => !CRITICAL_QUEUE_KINDS.has(queued.kind)
      )
      if (firstNoncritical >= 0) this.queue.splice(firstNoncritical, 0, entry)
      else this.queue.push(entry)
    } else {
      this.queue.push(entry)
    }
    this.status.queueDepth = this.queue.length
    return true
  }

  private async drain(): Promise<void> {
    const epoch = this.lifecycleEpoch
    if (
      this.drainingEpochs.has(epoch) ||
      this.resyncingEpochs.has(epoch) ||
      !this.status.connected ||
      !this.transport ||
      !this.grant
    ) return
    const transport = this.transport
    const grant = this.grant
    let retryBlocked = false
    this.drainingEpochs.add(epoch)
    try {
      while (
        epoch === this.lifecycleEpoch &&
        this.status.connected &&
        this.transport === transport &&
        this.grant === grant &&
        this.queue.length > 0
      ) {
        const entry = this.queue.shift()
        if (!entry) break
        this.status.queueDepth = this.queue.length
        if (entry.epoch !== epoch) continue
        const now = this.now()
        if (now >= entry.expiresAt) {
          this.status.metrics.overloadDropped += 1
          continue
        }
        const decision = authorizeMqttOperation(grant, 'publish', entry.packet.topic, this.config, now)
        if (!decision.allowed) {
          this.status.metrics.denied += 1
          this.status.lastError = decision.reason
          continue
        }
        try {
          await this.publishTransport(transport, entry.packet)
          if (
            epoch !== this.lifecycleEpoch ||
            this.transport !== transport ||
            this.grant !== grant
          ) {
            break
          }
          this.status.metrics.published += 1
          this.status.lastMessageAt = now
        } catch (error) {
          if (
            epoch !== this.lifecycleEpoch ||
            this.transport !== transport ||
            this.grant !== grant
          ) {
            break
          }
          this.status.metrics.publishFailures += 1
          this.status.lastError = compactError(error)
          this.insertQueueEntry(entry, true)
          retryBlocked = true
          break
        }
      }
    } finally {
      this.drainingEpochs.delete(epoch)
      this.status.queueDepth = this.queue.length
      if (epoch === this.lifecycleEpoch) this.notify()
      if (
        !retryBlocked &&
        epoch !== this.lifecycleEpoch &&
        this.status.connected &&
        this.queue.length > 0
      ) {
        void this.drain()
      }
    }
  }

  private async handleIncoming(packet: MqttIncomingPacket, epoch: number): Promise<void> {
    if (epoch !== this.lifecycleEpoch || this.stopped) return
    this.status.metrics.received += 1
    if (!this.config.commandsEnabled || packet.retain) {
      this.status.metrics.denied += 1
      this.notify()
      return
    }
    if (packet.principal && packet.principal !== 'local-command') {
      this.status.metrics.denied += 1
      this.notify()
      return
    }
    const topics = mqttTopics(this.config.instanceId)
    if (!packet.topic.startsWith(`${topics.root}/command/`)) {
      this.status.metrics.denied += 1
      this.notify()
      return
    }
    let envelope: MqttCloudEvent<MqttCommandRequestData>
    try {
      envelope = parseMqttCloudEvent<MqttCommandRequestData>(packet.payload, 'command')
    } catch (error) {
      this.status.metrics.schemaRejects += 1
      this.status.lastError = compactError(error)
      this.notify()
      return
    }
    const expectedGrant = createMqttCapabilityGrant('local-command', this.config, envelope.data.issuedAt)
    if (
      envelope.rolepolicyid !== MQTT_ROLE_POLICY_ID ||
      envelope.capgrantid !== expectedGrant.id ||
      packet.topic !== topics.command(envelope.data.capability)
    ) {
      this.status.metrics.denied += 1
      this.notify()
      return
    }
    if (!this.consumeCommandRate(this.now())) {
      this.status.metrics.rateLimited += 1
      this.status.metrics.denied += 1
      this.notify()
      return
    }
    this.pruneCommandCache()
    const cached = this.commandResults.get(envelope.data.requestId)
    if (cached) {
      this.status.metrics.duplicates += 1
      await this.publishCommandResult({ ...cached.result, duplicate: true }, epoch)
      if (epoch !== this.lifecycleEpoch || this.stopped) return
      this.notify()
      return
    }
    const inFlight = this.commandInFlight.get(envelope.data.requestId)
    if (inFlight?.epoch === epoch) {
      this.status.metrics.duplicates += 1
      const result = await inFlight.promise
      if (epoch !== this.lifecycleEpoch || this.stopped) return
      await this.publishCommandResult({ ...result, duplicate: true }, epoch)
      if (epoch !== this.lifecycleEpoch || this.stopped) return
      this.notify()
      return
    }

    const inFlightEntry: InFlightCommand = {
      epoch,
      promise: this.executeCommand(envelope.data, epoch)
    }
    this.commandInFlight.set(envelope.data.requestId, inFlightEntry)
    let result: MqttCommandResultData
    try {
      result = await inFlightEntry.promise
    } finally {
      if (this.commandInFlight.get(envelope.data.requestId) === inFlightEntry) {
        this.commandInFlight.delete(envelope.data.requestId)
      }
    }
    if (epoch !== this.lifecycleEpoch || this.stopped) return
    const now = this.now()
    this.commandResults.set(envelope.data.requestId, {
      result,
      expiresAt: Math.min(result.expiresAt, now + 5 * 60_000)
    })
    while (this.commandResults.size > MQTT_COMMAND_CACHE_SIZE) {
      const oldest = this.commandResults.keys().next().value as string | undefined
      if (!oldest) break
      this.commandResults.delete(oldest)
    }
    await this.publishCommandResult(result, epoch)
    if (epoch !== this.lifecycleEpoch || this.stopped) return
    this.notify()
  }

  private async executeCommand(
    request: MqttCommandRequestData,
    epoch: number
  ): Promise<MqttCommandResultData> {
    if (epoch !== this.lifecycleEpoch || this.stopped) {
      return this.commandResult(request, 'denied', 'Command lifecycle is no longer current.')
    }
    const now = this.now()
    if (now < request.issuedAt - 5_000 || now >= request.expiresAt) {
      return this.commandResult(request, 'expired', 'Command request expired.')
    }
    const handler = this.commandHandlers[request.capability]
    if (!handler) {
      return this.commandResult(request, 'unsupported', 'Capability is not available in this build.')
    }
    try {
      const message = await handler(Object.freeze({ ...request.args }))
      if (epoch !== this.lifecycleEpoch || this.stopped) {
        return this.commandResult(request, 'denied', 'Command lifecycle changed before completion.')
      }
      return this.commandResult(request, 'ok', message || 'Command completed.')
    } catch (error) {
      return this.commandResult(request, 'failed', compactError(error))
    }
  }

  private commandResult(
    request: MqttCommandRequestData,
    status: MqttCommandResultData['status'],
    message: string
  ): MqttCommandResultData {
    const now = this.now()
    return {
      schemaVersion: MQTT_CONTRACT_VERSION,
      requestId: request.requestId,
      capability: request.capability,
      observedAt: now,
      expiresAt: now + 30_000,
      status,
      duplicate: false,
      message: message.slice(0, 512)
    }
  }

  private async publishCommandResult(
    result: MqttCommandResultData,
    epoch: number
  ): Promise<void> {
    if (epoch !== this.lifecycleEpoch || this.stopped) return
    this.enqueueEnvelope(mqttTopics(this.config.instanceId).result(result.requestId), 'result', result, {
      sessionId: '',
      partitionKey: `command:${result.requestId}`,
      correlationId: result.requestId,
      subject: result.capability
    })
    await this.drain()
  }

  private pruneCommandCache(): void {
    const now = this.now()
    for (const [requestId, entry] of this.commandResults) {
      if (now >= entry.expiresAt) this.commandResults.delete(requestId)
    }
  }

  private consumeCommandRate(now: number): boolean {
    if (now - this.commandWindowStartedAt >= 1_000) {
      this.commandWindowStartedAt = now
      this.commandWindowCount = 0
    }
    if (this.commandWindowCount >= 4) return false
    this.commandWindowCount += 1
    return true
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    const epoch = this.lifecycleEpoch
    const intervalMs = Math.max(5_000, Math.floor(this.config.retainedMaxAgeMs / 2))
    this.heartbeatTimer = setInterval(() => {
      if (epoch !== this.lifecycleEpoch || !this.status.connected || this.stopped) return
      const now = this.now()
      this.enqueuePacket(this.availabilityPacket('online', now), 'availability')
      this.publishAnnouncement(now)
      if (this.latestSnapshot) {
        this.publishSessionState(
          projectMqttSession(this.latestSnapshot, now, this.config.retainedMaxAgeMs)
        )
      }
      this.publishHealth(now)
    }, intervalMs)
    this.heartbeatTimer.unref?.()
  }

  private publishTransport(
    transport: MqttTransport,
    packet: MqttTransportPacket
  ): Promise<void> {
    const previous = this.publishTails.get(transport) ?? Promise.resolve()
    const operation = previous
      .catch(() => undefined)
      .then(() => transport.publish(packet))
    this.publishTails.set(transport, operation)
    return operation
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  private markError(error: unknown): void {
    this.status.connected = false
    this.status.state = 'error'
    this.status.lastError = compactError(error)
    this.notify()
  }

  private notify(): void {
    this.status.config = cloneConfig(this.config)
    this.status.queueDepth = this.queue.length
    try {
      this.onStatus?.(this.getStatus())
    } catch {
      // Status observers must not affect the connector.
    }
  }
}
