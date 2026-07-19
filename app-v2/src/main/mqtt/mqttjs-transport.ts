import { connect, type IClientOptions, type MqttClient } from 'mqtt'
import { mqttBrokerUrls, type MqttCapabilityGrant, type MqttLocalConfig } from '../../shared/mqtt'
import {
  validateMqttTransportAccess,
  type MqttTransportAccess
} from './broker-auth'
import type {
  MqttIncomingPacket,
  MqttTransport,
  MqttTransportFactory,
  MqttTransportHandlers,
  MqttTransportPacket
} from './target'

interface MqttJsPublishPacket {
  qos: number
  retain: boolean
  dup: boolean
  properties?: {
    messageExpiryInterval?: number
  }
}

export function mqttJsIncomingPacket(
  topic: string,
  payload: Uint8Array,
  packet: MqttJsPublishPacket
): MqttIncomingPacket {
  return {
    topic,
    payload: new Uint8Array(payload),
    qos: packet.qos === 1 ? 1 : 0,
    retain: packet.retain,
    dup: packet.dup,
    messageExpirySec: packet.properties?.messageExpiryInterval
  }
}

function mqttWill(packet: MqttTransportPacket): NonNullable<IClientOptions['will']> {
  return {
    topic: packet.topic,
    payload: Buffer.from(packet.payload),
    qos: packet.qos,
    retain: packet.retain,
    properties: packet.messageExpirySec
      ? { messageExpiryInterval: packet.messageExpirySec }
      : undefined
  }
}

export function mqttJsConnectOptions(
  config: MqttLocalConfig,
  grant: MqttCapabilityGrant,
  accessInput: MqttTransportAccess | undefined,
  will: MqttTransportPacket
): IClientOptions {
  const access = validateMqttTransportAccess(grant, accessInput)
  return {
    protocolVersion: 5,
    clean: true,
    clientId: `ultimate-sim-${config.instanceId}-mqtt-v1`,
    username: access.username,
    password: access.password,
    keepalive: 15,
    connectTimeout: 5_000,
    reconnectPeriod: 0,
    resubscribe: false,
    queueQoSZero: false,
    properties: {
      sessionExpiryInterval: 0,
      receiveMaximum: 16,
      maximumPacketSize: config.maxPayloadBytes
    },
    will: mqttWill(will)
  }
}

class MqttJsTransport implements MqttTransport {
  private client: MqttClient | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelayMs: number
  private stopped = false
  private outage = false
  private pendingError: Error | undefined

  constructor(
    private readonly config: MqttLocalConfig,
    private readonly grant: MqttCapabilityGrant,
    private readonly access: MqttTransportAccess | undefined,
    private will: MqttTransportPacket,
    private readonly handlers: MqttTransportHandlers
  ) {
    this.reconnectDelayMs = config.reconnectMinMs
  }

  connect(): void {
    if (this.client) return
    this.stopped = false
    const url = mqttBrokerUrls(this.config).publisher
    const client = connect(
      url,
      mqttJsConnectOptions(this.config, this.grant, this.access, this.will)
    )
    this.client = client

    client.on('connect', (packet) => {
      this.clearReconnectTimer()
      this.reconnectDelayMs = this.config.reconnectMinMs
      this.outage = false
      this.pendingError = undefined
      this.handlers.onConnect(packet.sessionPresent)
    })
    client.on('message', (topic, payload, packet) => {
      this.handlers.onMessage(mqttJsIncomingPacket(topic, payload, packet))
    })
    client.on('error', (error) => {
      this.pendingError = error
    })
    client.on('offline', () => this.handleOutage())
    client.on('close', () => this.handleOutage())
  }

  async publish(packet: MqttTransportPacket): Promise<void> {
    const client = this.client
    if (!client?.connected) throw new Error('Local MQTT broker is not connected.')
    await client.publishAsync(packet.topic, Buffer.from(packet.payload), {
      qos: packet.qos,
      retain: packet.retain,
      properties: packet.messageExpirySec
        ? {
            messageExpiryInterval: packet.messageExpirySec,
            payloadFormatIndicator: true,
            contentType: 'application/cloudevents+json'
          }
        : {
            payloadFormatIndicator: true,
            contentType: 'application/cloudevents+json'
          }
    })
  }

  async subscribe(topicFilter: string, qos: 0 | 1): Promise<void> {
    const client = this.client
    if (!client?.connected) throw new Error('Local MQTT broker is not connected.')
    await client.subscribeAsync(topicFilter, { qos })
  }

  setWill(packet: MqttTransportPacket): void {
    this.will = {
      ...packet,
      payload: packet.payload.slice()
    }
    if (this.client) this.client.options.will = mqttWill(this.will)
  }

  async close(): Promise<void> {
    this.stopped = true
    this.clearReconnectTimer()
    const client = this.client
    this.client = null
    if (client) await client.endAsync(false)
  }

  private handleOutage(): void {
    if (this.stopped) return
    if (!this.outage) {
      this.outage = true
      this.handlers.onDisconnect(this.pendingError)
    }
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer || !this.client) return
    const delay = this.reconnectDelayMs
    this.reconnectDelayMs = Math.min(
      this.config.reconnectMaxMs,
      Math.max(this.config.reconnectMinMs, this.reconnectDelayMs * 2)
    )
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.stopped) this.client?.reconnect()
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }
}

export const createMqttJsTransport: MqttTransportFactory = (
  config: MqttLocalConfig,
  grant: MqttCapabilityGrant,
  will: MqttTransportPacket,
  handlers: MqttTransportHandlers,
  access?: MqttTransportAccess
) => new MqttJsTransport(config, grant, access, will, handlers)
