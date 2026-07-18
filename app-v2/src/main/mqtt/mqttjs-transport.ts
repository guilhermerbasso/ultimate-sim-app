import { connect, type MqttClient } from 'mqtt'
import { mqttBrokerUrls, type MqttCapabilityGrant, type MqttLocalConfig } from '../../shared/mqtt'
import type {
  MqttTransport,
  MqttTransportFactory,
  MqttTransportHandlers,
  MqttTransportPacket
} from './target'

class MqttJsTransport implements MqttTransport {
  private client: MqttClient | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelayMs: number
  private stopped = false
  private outage = false
  private pendingError: Error | undefined

  constructor(
    private readonly config: MqttLocalConfig,
    private readonly will: MqttTransportPacket,
    private readonly handlers: MqttTransportHandlers
  ) {
    this.reconnectDelayMs = config.reconnectMinMs
  }

  connect(): void {
    if (this.client) return
    this.stopped = false
    const url = mqttBrokerUrls(this.config).publisher
    const client = connect(url, {
      protocolVersion: 5,
      clean: true,
      clientId: `ultimate-sim-${this.config.instanceId}-mqtt-v1`,
      keepalive: 15,
      connectTimeout: 5_000,
      reconnectPeriod: 0,
      resubscribe: false,
      queueQoSZero: false,
      properties: {
        sessionExpiryInterval: 0,
        receiveMaximum: 16,
        maximumPacketSize: this.config.maxPayloadBytes
      },
      will: {
        topic: this.will.topic,
        payload: Buffer.from(this.will.payload),
        qos: this.will.qos,
        retain: this.will.retain,
        properties: this.will.messageExpirySec
          ? { messageExpiryInterval: this.will.messageExpirySec }
          : undefined
      }
    })
    this.client = client

    client.on('connect', (packet) => {
      this.clearReconnectTimer()
      this.reconnectDelayMs = this.config.reconnectMinMs
      this.outage = false
      this.pendingError = undefined
      this.handlers.onConnect(packet.sessionPresent)
    })
    client.on('message', (topic, payload, packet) => {
      this.handlers.onMessage({
        topic,
        payload: new Uint8Array(payload),
        qos: packet.qos === 1 ? 1 : 0,
        retain: packet.retain,
        dup: packet.dup,
        messageExpirySec: packet.properties?.messageExpiryInterval
      })
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
  _grant: MqttCapabilityGrant,
  will: MqttTransportPacket,
  handlers: MqttTransportHandlers
) => new MqttJsTransport(config, will, handlers)
