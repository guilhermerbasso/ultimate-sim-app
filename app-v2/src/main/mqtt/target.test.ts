import { describe, expect, it, vi } from 'vitest'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import {
  buildMqttCloudEvent,
  createMqttCapabilityGrant,
  mqttTopics,
  normalizeMqttLocalConfig,
  parseMqttCloudEvent,
  retainedEnvelopeIsFresh,
  serializeMqttPayload,
  type MqttAvailabilityData,
  type MqttCommandRequestData,
  type MqttCommandResultData,
  type MqttRaceEventData,
  type MqttSessionStateData
} from '../../shared/mqtt'
import { InMemoryMqttBroker } from './in-memory-broker'
import { createMqttBrokerAccessSet } from './broker-auth'
import {
  MqttCertificationTarget,
  type MqttIncomingPacket,
  type MqttTransport,
  type MqttTransportPacket
} from './target'

function snapshot(now: number, overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: now,
    speedKmh: 210,
    rpm: 8100,
    gear: 5,
    throttle: 0.9,
    brake: 0,
    clutch: 0,
    sessionUniqueId: 42,
    sessionType: 'Race',
    sessionState: 'racing',
    currentLap: 12,
    lapsRemaining: 24,
    position: 3,
    classPosition: 2,
    fuelLiters: 47,
    ...overrides
  }
}

async function settle(target: MqttCertificationTarget): Promise<void> {
  for (let index = 0; index < 24; index += 1) {
    await Promise.resolve()
    await target.flush()
  }
}

function inertWill(topic: string): MqttTransportPacket {
  return {
    topic,
    payload: new Uint8Array(),
    qos: 0,
    retain: false
  }
}

function brokerAccess() {
  let seed = 1
  return createMqttBrokerAccessSet((size) => {
    const value = seed
    seed += 1
    return new Uint8Array(size).fill(value)
  })
}

function commandPacket(
  config: ReturnType<typeof normalizeMqttLocalConfig>,
  now: number,
  requestId: string,
  capability: MqttCommandRequestData['capability'] = 'app.overlay.show'
): { packet: MqttTransportPacket; grant: ReturnType<typeof createMqttCapabilityGrant> } {
  const grant = createMqttCapabilityGrant('local-command', config, now)
  const data: MqttCommandRequestData = {
    schemaVersion: 1,
    requestId,
    capability,
    issuedAt: now,
    expiresAt: now + 10_000,
    args: { id: 'gear-speed' }
  }
  const envelope = buildMqttCloudEvent('command', data, {
    id: `command:${requestId}`,
    instanceId: config.instanceId,
    sequence: '1',
    sourceTick: String(now),
    monotonicNs: String(now * 1_000_000),
    sessionId: '',
    correlationId: requestId,
    partitionKey: `command:${requestId}`,
    partitionSeq: '1',
    privacyClass: 'D1',
    capabilityGrantId: grant.id,
    observedAt: now,
    subject: capability
  })
  return {
    grant,
    packet: {
      topic: mqttTopics(config.instanceId).command(capability),
      payload: serializeMqttPayload(envelope, 4096),
      qos: 1,
      retain: false,
      messageExpirySec: 15
    }
  }
}

function raceEvent(index: number, now: number, fact = `event-${index}`): MqttRaceEventData {
  return {
    schemaVersion: 1,
    eventId: `event-${index}`,
    eventType: 'warning',
    observedAt: now,
    expiresAt: now + 30_000,
    severity: 'warning',
    sessionRef: 'iracing:session-42',
    dedupeKey: `event-${index}`,
    facts: { warning: fact }
  }
}

describe('MQTT certification target conformance', () => {
  it('blocks ACL bypasses at broker and target boundaries', async () => {
    let now = 100_000
    const config = normalizeMqttLocalConfig({
      enabled: true,
      commandsEnabled: true,
      instanceId: 'rig-acl'
    })
    const access = brokerAccess()
    const broker = new InMemoryMqttBroker(() => now, access)
    const effect = vi.fn()
    const target = new MqttCertificationTarget(broker.transportFactory, {
      now: () => now,
      monotonicNs: () => BigInt(now) * 1_000_000n,
      commandHandlers: { 'app.overlay.show': effect }
    })
    await target.start(config, access['target-publisher'])
    await settle(target)

    const readerGrant = createMqttCapabilityGrant('local-reader', config, now)
    const reader = broker.createTransport(
      config,
      readerGrant,
      inertWill(mqttTopics(config.instanceId).health),
      { onConnect: () => {}, onDisconnect: () => {}, onMessage: () => {} },
      access['local-reader']
    )
    reader.connect()
    await expect(
      reader.publish({
        topic: mqttTopics(config.instanceId).telemetry,
        payload: new Uint8Array(),
        qos: 0,
        retain: false
      })
    ).rejects.toMatchObject({ code: 'acl-denied' })

    const impersonator = broker.createTransport(
      config,
      createMqttCapabilityGrant('target-publisher', config, now),
      inertWill(mqttTopics(config.instanceId).availability),
      { onConnect: () => {}, onDisconnect: () => {}, onMessage: () => {} },
      access['local-reader']
    )
    expect(() => impersonator.connect()).toThrow(/authentication failed/i)

    const valid = commandPacket(config, now, 'acl-bypass')
    broker.inject(valid.packet, 'rogue-local-process')
    await settle(target)
    expect(effect).not.toHaveBeenCalled()
    expect(target.getStatus().metrics.denied).toBeGreaterThan(0)
  })

  it('clears stale retained state and republishes a fresh generation on connect', async () => {
    let now = 200_000
    const config = normalizeMqttLocalConfig({ enabled: true, instanceId: 'rig-retained' })
    const broker = new InMemoryMqttBroker(() => now)
    const target = new MqttCertificationTarget(broker.transportFactory, {
      now: () => now,
      monotonicNs: () => BigInt(now) * 1_000_000n
    })
    target.ingestTelemetry(snapshot(now))

    const staleData: MqttSessionStateData = {
      schemaVersion: 1,
      observedAt: now - 60_000,
      expiresAt: now - 1,
      sim: 'iracing',
      connected: true,
      sessionRef: 'iracing:old-session',
      stale: false
    }
    const staleEnvelope = buildMqttCloudEvent('session', staleData, {
      id: 'stale-session',
      instanceId: config.instanceId,
      sequence: '1',
      sourceTick: String(staleData.observedAt),
      monotonicNs: '1',
      sessionId: staleData.sessionRef,
      partitionKey: 'session:old',
      partitionSeq: '1',
      capabilityGrantId: createMqttCapabilityGrant('target-publisher', config, now).id,
      observedAt: staleData.observedAt
    })
    broker.seedRetained({
      topic: mqttTopics(config.instanceId).session,
      payload: serializeMqttPayload(staleEnvelope, 8192),
      qos: 1,
      retain: true
    })

    await target.start(config)
    await settle(target)

    const retained = broker.retainedPacket(mqttTopics(config.instanceId).session)
    expect(retained).toBeDefined()
    const fresh = parseMqttCloudEvent<MqttSessionStateData>(retained!.payload, 'session')
    expect(fresh.data.sessionRef).toBe('iracing:session-42')
    expect(retainedEnvelopeIsFresh(fresh, now, config.retainedMaxAgeMs)).toBe(true)
    expect(target.getStatus().metrics.staleRetainedCleared).toBeGreaterThanOrEqual(4)
  })

  it('deduplicates duplicate QoS 1 commands and returns an idempotent result', async () => {
    let now = 300_000
    const config = normalizeMqttLocalConfig({
      enabled: true,
      commandsEnabled: true,
      instanceId: 'rig-qos'
    })
    const broker = new InMemoryMqttBroker(() => now)
    broker.duplicateQos1 = true
    const effect = vi.fn(() => 'Overlay shown.')
    const target = new MqttCertificationTarget(broker.transportFactory, {
      now: () => now,
      monotonicNs: () => BigInt(now) * 1_000_000n,
      commandHandlers: { 'app.overlay.show': effect }
    })
    await target.start(config)
    await settle(target)

    const request = commandPacket(config, now, 'qos-duplicate')
    const results: MqttIncomingPacket[] = []
    const client: MqttTransport = broker.createTransport(
      config,
      request.grant,
      inertWill(mqttTopics(config.instanceId).result('client-offline')),
      {
        onConnect: () => {},
        onDisconnect: () => {},
        onMessage: (packet) => results.push(packet)
      }
    )
    client.connect()
    await client.subscribe(mqttTopics(config.instanceId).resultFilter, 1)
    await client.publish(request.packet)
    await settle(target)

    expect(effect).toHaveBeenCalledTimes(1)
    expect(target.getStatus().metrics.duplicates).toBe(1)
    const decoded = results.map((packet) =>
      parseMqttCloudEvent<MqttCommandResultData>(packet.payload, 'result')
    )
    expect(decoded.some((envelope) => envelope.data.status === 'ok')).toBe(true)
    expect(decoded.some((envelope) => envelope.data.duplicate)).toBe(true)
  })

  it('rejects schema drift injected below broker validation', async () => {
    let now = 400_000
    const config = normalizeMqttLocalConfig({
      enabled: true,
      commandsEnabled: true,
      instanceId: 'rig-schema'
    })
    const broker = new InMemoryMqttBroker(() => now)
    const effect = vi.fn()
    const target = new MqttCertificationTarget(broker.transportFactory, {
      now: () => now,
      monotonicNs: () => BigInt(now) * 1_000_000n,
      commandHandlers: { 'app.overlay.show': effect }
    })
    await target.start(config)
    await settle(target)

    const request = commandPacket(config, now, 'schema-drift')
    const parsed = JSON.parse(new TextDecoder().decode(request.packet.payload)) as Record<string, unknown>
    parsed.schemafp = '0'.repeat(64)
    broker.inject({
      ...request.packet,
      payload: new TextEncoder().encode(JSON.stringify(parsed))
    }, 'local-command')
    await settle(target)

    expect(effect).not.toHaveBeenCalled()
    expect(target.getStatus().metrics.schemaRejects).toBe(1)
  })

  it('bounds overload, coalesces state, and rejects oversized payloads', async () => {
    let now = 500_000
    const config = normalizeMqttLocalConfig({ enabled: true, instanceId: 'rig-load' })
    const broker = new InMemoryMqttBroker(() => now)
    const target = new MqttCertificationTarget(broker.transportFactory, {
      now: () => now,
      monotonicNs: () => BigInt(now) * 1_000_000n
    })
    await target.start(config)
    await settle(target)

    const release = broker.pausePublishing()
    for (let index = 0; index < 200; index += 1) target.publishRaceEvent(raceEvent(index, now))
    await Promise.resolve()
    const saturated = target.getStatus()
    expect(saturated.queueDepth).toBeLessThanOrEqual(64)
    expect(saturated.metrics.overloadDropped).toBeGreaterThan(0)

    target.publishRaceEvent(raceEvent(999, now, 'x'.repeat(20_000)))
    expect(target.getStatus().metrics.oversized).toBe(1)

    release()
    await settle(target)
    expect(target.getStatus().queueDepth).toBe(0)
  })

  it('rate-limits command bursts without widening the capability set', async () => {
    let now = 550_000
    const config = normalizeMqttLocalConfig({
      enabled: true,
      commandsEnabled: true,
      instanceId: 'rig-command-rate'
    })
    const broker = new InMemoryMqttBroker(() => now)
    const effect = vi.fn()
    const target = new MqttCertificationTarget(broker.transportFactory, {
      now: () => now,
      monotonicNs: () => BigInt(now) * 1_000_000n,
      commandHandlers: { 'app.overlay.show': effect }
    })
    await target.start(config)
    await settle(target)

    const first = commandPacket(config, now, 'rate-0')
    const client = broker.createTransport(
      config,
      first.grant,
      inertWill(mqttTopics(config.instanceId).result('client-offline')),
      { onConnect: () => {}, onDisconnect: () => {}, onMessage: () => {} }
    )
    client.connect()
    for (let index = 0; index < 6; index += 1) {
      await client.publish(commandPacket(config, now, `rate-${index}`).packet)
    }
    await settle(target)

    expect(effect).toHaveBeenCalledTimes(4)
    expect(target.getStatus().metrics.rateLimited).toBe(2)
    expect(target.getStatus().metrics.denied).toBeGreaterThanOrEqual(2)
  })

  it('resyncs retained state after a broker restart without affecting telemetry ingestion', async () => {
    let now = 600_000
    const config = normalizeMqttLocalConfig({ enabled: true, instanceId: 'rig-restart' })
    const broker = new InMemoryMqttBroker(() => now)
    const target = new MqttCertificationTarget(broker.transportFactory, {
      now: () => now,
      monotonicNs: () => BigInt(now) * 1_000_000n
    })
    await target.start(config)
    target.ingestTelemetry(snapshot(now))
    await settle(target)
    const before = target.getStatus()

    now += 1_000
    broker.restart()
    target.ingestTelemetry(snapshot(now, { speedKmh: 220 }))
    await settle(target)

    const after = target.getStatus()
    expect(after.state).toBe('online')
    expect(after.metrics.reconnects).toBeGreaterThan(before.metrics.reconnects)
    expect(after.metrics.resyncs).toBeGreaterThan(before.metrics.resyncs)
    expect(
      broker.publishedPackets(mqttTopics(config.instanceId).telemetry).length
    ).toBeGreaterThan(0)
  })

  it('cancels queued egress after capability revocation', async () => {
    let now = 700_000
    const config = normalizeMqttLocalConfig({ enabled: true, instanceId: 'rig-revoke' })
    const broker = new InMemoryMqttBroker(() => now)
    broker.setOnline(false)
    const target = new MqttCertificationTarget(broker.transportFactory, {
      now: () => now,
      monotonicNs: () => BigInt(now) * 1_000_000n
    })
    await target.start(config)
    target.publishRaceEvent(raceEvent(1, now))
    target.revokeEgress()
    broker.setOnline(true)
    await settle(target)

    expect(
      broker.publishedPackets(mqttTopics(config.instanceId).event('warning'))
    ).toHaveLength(0)
    expect(target.getStatus().metrics.denied).toBeGreaterThan(0)
  })

  it('publishes offline before disable or reconfigure and aligns reconnect wills', async () => {
    let now = 800_000
    const configA = normalizeMqttLocalConfig({ enabled: true, instanceId: 'rig-life-a' })
    const configB = normalizeMqttLocalConfig({ enabled: true, instanceId: 'rig-life-b' })
    const broker = new InMemoryMqttBroker(() => now)
    const target = new MqttCertificationTarget(broker.transportFactory, {
      now: () => now,
      monotonicNs: () => BigInt(now) * 1_000_000n
    })

    await target.start(configA)
    await settle(target)
    const onlineA = parseMqttCloudEvent<MqttAvailabilityData>(
      broker.retainedPacket(mqttTopics(configA.instanceId).availability)!.payload,
      'availability'
    )
    expect(onlineA.data.status).toBe('online')

    await target.start({ ...configA, enabled: false })
    await settle(target)
    const disabledA = parseMqttCloudEvent<MqttAvailabilityData>(
      broker.retainedPacket(mqttTopics(configA.instanceId).availability)!.payload,
      'availability'
    )
    expect(disabledA.data.status).toBe('offline')

    now += 1_000
    await target.start(configB)
    await settle(target)
    const firstOnlineB = parseMqttCloudEvent<MqttAvailabilityData>(
      broker.retainedPacket(mqttTopics(configB.instanceId).availability)!.payload,
      'availability'
    )

    now += 1_000
    broker.restart()
    await settle(target)
    const reconnectedB = parseMqttCloudEvent<MqttAvailabilityData>(
      broker.retainedPacket(mqttTopics(configB.instanceId).availability)!.payload,
      'availability'
    )
    expect(reconnectedB.data.status).toBe('online')
    expect(reconnectedB.data.generation).toBeGreaterThan(firstOnlineB.data.generation)

    now += 1_000
    broker.setOnline(false)
    await Promise.resolve()
    const reconnectWill = parseMqttCloudEvent<MqttAvailabilityData>(
      broker.retainedPacket(mqttTopics(configB.instanceId).availability)!.payload,
      'availability'
    )
    expect(reconnectWill.data.status).toBe('offline')
    expect(reconnectWill.data.generation).toBe(reconnectedB.data.generation)
  })

  it('keeps offline as the final retained state when disable races resync', async () => {
    let now = 850_000
    const config = normalizeMqttLocalConfig({ enabled: true, instanceId: 'rig-stop-race' })
    const broker = new InMemoryMqttBroker(() => now)
    const target = new MqttCertificationTarget(broker.transportFactory, {
      now: () => now,
      monotonicNs: () => BigInt(now) * 1_000_000n
    })
    const release = broker.pausePublishing()

    await target.start(config)
    const disabling = target.start({ ...config, enabled: false })
    await Promise.resolve()
    release()
    await disabling
    await settle(target)

    const retained = broker.retainedPacket(mqttTopics(config.instanceId).availability)
    expect(retained).toBeDefined()
    const availability = parseMqttCloudEvent<MqttAvailabilityData>(
      retained!.payload,
      'availability'
    )
    expect(availability.data.status).toBe('offline')
  })

  it('reserves overload capacity for retained critical state', async () => {
    let now = 900_000
    const config = normalizeMqttLocalConfig({ enabled: true, instanceId: 'rig-priority' })
    const broker = new InMemoryMqttBroker(() => now)
    const target = new MqttCertificationTarget(broker.transportFactory, {
      now: () => now,
      monotonicNs: () => BigInt(now) * 1_000_000n
    })
    await target.start(config)
    await settle(target)

    const release = broker.pausePublishing()
    for (let index = 0; index < 200; index += 1) {
      target.publishRaceEvent(raceEvent(index, now))
    }
    target.ingestTelemetry(snapshot(now, { sessionUniqueId: 99, currentLap: 1 }))
    broker.restart()
    const saturated = target.getStatus()
    expect(saturated.queueDepth).toBeLessThanOrEqual(64)
    expect(saturated.metrics.overloadDropped).toBeGreaterThan(0)

    release()
    await settle(target)
    const topics = mqttTopics(config.instanceId)
    const retainedSession = broker.retainedPacket(topics.session)
    expect(broker.retainedPacket(topics.availability)).toBeDefined()
    expect(broker.retainedPacket(topics.health)).toBeDefined()
    expect(broker.retainedPacket(topics.announcement)).toBeDefined()
    expect(retainedSession).toBeDefined()
    const session = parseMqttCloudEvent<MqttSessionStateData>(retainedSession!.payload, 'session')
    expect(session.data.sessionRef).toBe('iracing:session-99')
  })

  it('drops command completions from an obsolete configuration epoch', async () => {
    let now = 1_000_000
    let completeHandler: ((message: string) => void) | undefined
    const pending = new Promise<string>((resolve) => {
      completeHandler = resolve
    })
    const effect = vi.fn(() => pending)
    const configA = normalizeMqttLocalConfig({
      enabled: true,
      commandsEnabled: true,
      instanceId: 'rig-epoch-a'
    })
    const configB = normalizeMqttLocalConfig({
      enabled: true,
      commandsEnabled: true,
      instanceId: 'rig-epoch-b'
    })
    const broker = new InMemoryMqttBroker(() => now)
    const target = new MqttCertificationTarget(broker.transportFactory, {
      now: () => now,
      monotonicNs: () => BigInt(now) * 1_000_000n,
      commandHandlers: { 'app.overlay.show': effect }
    })
    await target.start(configA)
    await settle(target)

    const request = commandPacket(configA, now, 'epoch-command')
    const client = broker.createTransport(
      configA,
      request.grant,
      inertWill(mqttTopics(configA.instanceId).result('client-offline')),
      { onConnect: () => {}, onDisconnect: () => {}, onMessage: () => {} }
    )
    client.connect()
    await client.publish(request.packet)
    for (let index = 0; index < 12 && effect.mock.calls.length === 0; index += 1) {
      await Promise.resolve()
    }
    expect(effect).toHaveBeenCalledTimes(1)

    now += 1_000
    await target.start(configB)
    await settle(target)
    completeHandler?.('Old command completed.')
    await settle(target)

    expect(
      broker.publishedPackets(mqttTopics(configA.instanceId).result('epoch-command'))
    ).toHaveLength(0)
    expect(
      broker.publishedPackets(mqttTopics(configB.instanceId).result('epoch-command'))
    ).toHaveLength(0)
  })
})
