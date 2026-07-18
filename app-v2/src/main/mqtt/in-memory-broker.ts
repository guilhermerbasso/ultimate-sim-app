import {
  MqttContractError,
  authorizeMqttOperation,
  mqttTopicPolicy,
  parseMqttCloudEvent,
  validateRetainedPublication,
  type MqttCapabilityGrant,
  type MqttLocalConfig,
  type MqttQos
} from '../../shared/mqtt'
import type {
  MqttIncomingPacket,
  MqttTransport,
  MqttTransportFactory,
  MqttTransportHandlers,
  MqttTransportPacket
} from './target'
import type { MqttBrokerAccessSet, MqttTransportAccess } from './broker-auth'

interface BrokerClient {
  id: number
  config: MqttLocalConfig
  grant: MqttCapabilityGrant
  will: MqttTransportPacket
  handlers: MqttTransportHandlers
  access?: MqttTransportAccess
  connected: boolean
  subscriptions: Map<string, MqttQos>
}

function clonePacket(packet: MqttTransportPacket): MqttTransportPacket {
  return {
    ...packet,
    payload: packet.payload.slice()
  }
}

function topicMatches(filter: string, topic: string): boolean {
  const filterParts = filter.split('/')
  const topicParts = topic.split('/')
  for (let index = 0; index < filterParts.length; index += 1) {
    const part = filterParts[index]
    if (part === '#') return index === filterParts.length - 1
    if (index >= topicParts.length) return false
    if (part !== '+' && part !== topicParts[index]) return false
  }
  return filterParts.length === topicParts.length
}

export class InMemoryMqttBroker {
  private clients = new Map<number, BrokerClient>()
  private retained = new Map<string, MqttTransportPacket>()
  private published: Array<MqttTransportPacket & { principal: string }> = []
  private nextClientId = 1
  private online = true
  private publishGate: Promise<void> | null = null
  private releasePublishGate: (() => void) | null = null
  duplicateQos1 = false

  constructor(
    private readonly now: () => number = Date.now,
    private readonly expectedAccess?: MqttBrokerAccessSet
  ) {}

  readonly transportFactory: MqttTransportFactory = (config, grant, will, handlers, access) =>
    this.createTransport(config, grant, will, handlers, access)

  createTransport(
    config: MqttLocalConfig,
    grant: MqttCapabilityGrant,
    will: MqttTransportPacket,
    handlers: MqttTransportHandlers,
    access?: MqttTransportAccess
  ): MqttTransport {
    const client: BrokerClient = {
      id: this.nextClientId++,
      config,
      grant,
      will: clonePacket(will),
      handlers,
      access: access ? { ...access } : undefined,
      connected: false,
      subscriptions: new Map()
    }
    this.clients.set(client.id, client)
    return {
      connect: () => this.connect(client),
      publish: (packet) => this.publish(client, packet),
      subscribe: (filter, qos) => this.subscribe(client, filter, qos),
      setWill: (packet) => {
        client.will = clonePacket(packet)
      },
      close: () => this.close(client)
    }
  }

  pausePublishing(): () => void {
    if (!this.publishGate) {
      this.publishGate = new Promise<void>((resolve) => {
        this.releasePublishGate = resolve
      })
    }
    return () => {
      this.releasePublishGate?.()
      this.releasePublishGate = null
      this.publishGate = null
    }
  }

  setOnline(online: boolean): void {
    if (this.online === online) return
    this.online = online
    if (!online) {
      for (const client of this.clients.values()) {
        if (!client.connected) continue
        client.connected = false
        this.applyPacket(client, client.will, false)
        client.handlers.onDisconnect(new Error('In-memory broker offline.'))
      }
      return
    }
    for (const client of this.clients.values()) {
      client.connected = true
      client.handlers.onConnect(false)
    }
  }

  restart(): void {
    this.setOnline(false)
    this.setOnline(true)
  }

  seedRetained(packet: MqttTransportPacket): void {
    if (!packet.retain) throw new Error('Seed packet must be retained.')
    this.retained.set(packet.topic, clonePacket(packet))
  }

  retainedPacket(topic: string): MqttTransportPacket | undefined {
    const packet = this.retained.get(topic)
    return packet ? clonePacket(packet) : undefined
  }

  publishedPackets(topic?: string): Array<MqttTransportPacket & { principal: string }> {
    return this.published
      .filter((packet) => !topic || packet.topic === topic)
      .map((packet) => ({ ...packet, payload: packet.payload.slice() }))
  }

  inject(packet: MqttTransportPacket, principal = 'rogue-local-process'): void {
    for (const subscriber of this.clients.values()) {
      if (!subscriber.connected) continue
      for (const [filter] of subscriber.subscriptions) {
        if (!topicMatches(filter, packet.topic)) continue
        this.deliver(subscriber, packet, false, principal)
        break
      }
    }
  }

  private connect(client: BrokerClient): void {
    if (this.expectedAccess) {
      const expected = this.expectedAccess[client.grant.principal]
      if (
        !client.access ||
        client.access.principal !== client.grant.principal ||
        client.access.username !== expected.username ||
        client.access.password !== expected.password
      ) {
        throw new MqttContractError('In-memory broker authentication failed.', 'acl-denied')
      }
    }
    if (!this.online) {
      client.handlers.onDisconnect(new Error('In-memory broker offline.'))
      return
    }
    client.connected = true
    client.handlers.onConnect(false)
  }

  private async close(client: BrokerClient): Promise<void> {
    client.connected = false
    this.clients.delete(client.id)
  }

  private async publish(client: BrokerClient, packet: MqttTransportPacket): Promise<void> {
    if (this.publishGate) await this.publishGate
    if (!this.online || !client.connected) throw new Error('In-memory MQTT client is disconnected.')
    const decision = authorizeMqttOperation(
      client.grant,
      'publish',
      packet.topic,
      client.config,
      this.now()
    )
    if (!decision.allowed) throw new MqttContractError(decision.reason, 'acl-denied')
    const policy = mqttTopicPolicy(packet.topic, client.config.instanceId)
    if (!policy) throw new MqttContractError('Unknown topic.', 'invalid-topic')
    if (packet.payload.byteLength > Math.min(policy.maxBytes, client.config.maxPayloadBytes)) {
      throw new MqttContractError('Packet exceeds the topic size limit.', 'oversized')
    }
    if (packet.payload.byteLength > 0 && policy.schemaKind) {
      const envelope = parseMqttCloudEvent(packet.payload, policy.schemaKind)
      validateRetainedPublication(packet.topic, packet.retain, envelope, client.config, this.now())
    }
    this.applyPacket(client, packet, true)
  }

  private applyPacket(client: BrokerClient, packet: MqttTransportPacket, record: boolean): void {
    const stored = clonePacket(packet)
    if (record) this.published.push({ ...stored, principal: client.grant.principal })
    if (stored.retain) {
      if (stored.payload.byteLength === 0) this.retained.delete(stored.topic)
      else this.retained.set(stored.topic, stored)
    }
    if (stored.payload.byteLength === 0) return
    for (const subscriber of this.clients.values()) {
      if (!subscriber.connected) continue
      for (const [filter] of subscriber.subscriptions) {
        if (!topicMatches(filter, stored.topic)) continue
        const decision = authorizeMqttOperation(
          subscriber.grant,
          'subscribe',
          filter,
          subscriber.config,
          this.now()
        )
        if (!decision.allowed) continue
        this.deliver(subscriber, stored, false, client.grant.principal)
        break
      }
    }
  }

  private async subscribe(client: BrokerClient, filter: string, qos: MqttQos): Promise<void> {
    if (!this.online || !client.connected) throw new Error('In-memory MQTT client is disconnected.')
    const decision = authorizeMqttOperation(
      client.grant,
      'subscribe',
      filter,
      client.config,
      this.now()
    )
    if (!decision.allowed) throw new MqttContractError(decision.reason, 'acl-denied')
    client.subscriptions.set(filter, qos)
    for (const packet of this.retained.values()) {
      if (topicMatches(filter, packet.topic)) {
        this.deliver(client, { ...packet, retain: true }, false, 'retained-store')
      }
    }
  }

  private deliver(
    client: BrokerClient,
    packet: MqttTransportPacket,
    dup: boolean,
    principal: string
  ): void {
    const incoming: MqttIncomingPacket = {
      ...clonePacket(packet),
      dup,
      principal
    }
    queueMicrotask(() => client.handlers.onMessage(incoming))
    if (this.duplicateQos1 && packet.qos === 1 && !dup) {
      const duplicate: MqttIncomingPacket = {
        ...clonePacket(packet),
        dup: true,
        principal
      }
      queueMicrotask(() => client.handlers.onMessage(duplicate))
    }
  }
}
