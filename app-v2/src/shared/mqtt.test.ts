import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'
import type { TelemetrySnapshot } from './telemetry'
import {
  DEFAULT_MQTT_LOCAL_CONFIG,
  MQTT_COMMAND_CAPABILITIES,
  MQTT_SCHEMA_FINGERPRINTS,
  MQTT_SCHEMA_IDS,
  MqttContractError,
  authorizeMqttOperation,
  buildMosquittoAclFiles,
  buildMosquittoLoopbackConfig,
  buildMqttCloudEvent,
  createMqttCapabilityGrant,
  mqttTopics,
  normalizeMqttLocalConfig,
  parseMqttCloudEvent,
  projectMqttTelemetry,
  retainedEnvelopeIsFresh,
  serializeMqttPayload,
  stableMqttJson,
  validateRetainedPublication,
  type MqttSchemaKind,
  type MqttSessionStateData
} from './mqtt'

function snapshot(overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 10_000,
    speedKmh: 180,
    rpm: 7200,
    gear: 4,
    throttle: 0.8,
    brake: 0,
    clutch: 0,
    driverName: 'Private Driver',
    drivers: [
      {
        carIdx: 1,
        name: 'Private Driver',
        carNumber: '007',
        position: 1,
        classPosition: 1,
        classId: 1,
        iRating: 9000,
        isPlayer: true
      }
    ],
    ...overrides
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, entry]) => [key, canonical(entry)])
    )
  }
  return value
}

describe('local MQTT v1 contracts', () => {
  it('is disabled and loopback-only with no credential surface', () => {
    const config = normalizeMqttLocalConfig(undefined)
    expect(config).toEqual(DEFAULT_MQTT_LOCAL_CONFIG)
    expect(config.enabled).toBe(false)
    expect(config.host).toBe('127.0.0.1')
    expect(() => normalizeMqttLocalConfig({ host: '192.168.1.10' })).toThrow(/loopback/i)
    expect(() => normalizeMqttLocalConfig({ password: 'do-not-serialize' })).toThrow(MqttContractError)
    expect(stableMqttJson(config)).not.toMatch(/password|token|secret|credential/i)
  })

  it('enforces per-topic capabilities and keeps commands default-off', () => {
    const now = 20_000
    const config = normalizeMqttLocalConfig({ enabled: true, instanceId: 'rig-a' })
    const topics = mqttTopics(config.instanceId)
    const publisher = createMqttCapabilityGrant('target-publisher', config, now)
    const reader = createMqttCapabilityGrant('local-reader', config, now)
    const command = createMqttCapabilityGrant('local-command', config, now)

    expect(authorizeMqttOperation(publisher, 'publish', topics.telemetry, config, now).allowed).toBe(true)
    expect(authorizeMqttOperation(publisher, 'publish', topics.command('app.overlay.show'), config, now).allowed).toBe(false)
    expect(authorizeMqttOperation(reader, 'subscribe', topics.stateFilter, config, now).allowed).toBe(true)
    expect(authorizeMqttOperation(reader, 'subscribe', topics.commandFilter, config, now).allowed).toBe(false)
    expect(authorizeMqttOperation(reader, 'publish', topics.telemetry, config, now).allowed).toBe(false)
    expect(authorizeMqttOperation(command, 'publish', topics.command('app.overlay.show'), config, now).allowed).toBe(false)

    const commandsEnabled = normalizeMqttLocalConfig({ ...config, commandsEnabled: true })
    const enabledGrant = createMqttCapabilityGrant('local-command', commandsEnabled, now)
    expect(
      authorizeMqttOperation(
        enabledGrant,
        'publish',
        mqttTopics(commandsEnabled.instanceId).command('app.overlay.show'),
        commandsEnabled,
        now
      ).allowed
    ).toBe(true)
    expect(MQTT_COMMAND_CAPABILITIES).toEqual(['app.overlay.show', 'app.overlay.hide'])
  })

  it('materializes a D2 telemetry diode view without identity or secret fields', () => {
    const projected = projectMqttTelemetry(
      snapshot({ driverName: 'Never publish me' }) as TelemetrySnapshot & { accessToken?: string },
      10_100
    )
    const envelope = buildMqttCloudEvent('telemetry', projected, {
      id: 'telemetry-1',
      instanceId: 'simrig',
      sequence: '1',
      sourceTick: '10000',
      monotonicNs: '1',
      sessionId: 'iracing:session-1',
      partitionKey: 'session:1',
      partitionSeq: '1',
      capabilityGrantId: 'mqtt-target-publisher-simrig-1',
      observedAt: 10_100
    })
    const serialized = new TextDecoder().decode(serializeMqttPayload(envelope, 8192))
    expect(serialized).not.toContain('Private Driver')
    expect(serialized).not.toContain('iRating')
    expect(serialized).not.toMatch(/accessToken|password|credential/)
    expect(() =>
      serializeMqttPayload({ ...envelope, data: { ...projected, apiToken: 'forbidden' } }, 8192)
    ).toThrow(/Secret-like field/)
  })

  it('rejects schema drift before a payload reaches a consumer', () => {
    const data = projectMqttTelemetry(snapshot(), 10_100)
    const envelope = buildMqttCloudEvent('telemetry', data, {
      id: 'telemetry-2',
      instanceId: 'simrig',
      sequence: '2',
      sourceTick: '10000',
      monotonicNs: '2',
      sessionId: 'iracing:session-1',
      partitionKey: 'session:1',
      partitionSeq: '2',
      capabilityGrantId: 'mqtt-target-publisher-simrig-1',
      observedAt: 10_100
    })
    const drifted = { ...envelope, dataschema: 'urn:ultimate-sim:mqtt:v2:telemetry-state' }
    expect(() =>
      parseMqttCloudEvent(serializeMqttPayload(drifted, 8192), 'telemetry')
    ).toThrow(/schema drift/i)
    expect(() =>
      parseMqttCloudEvent(
        serializeMqttPayload({ ...envelope, data: { ...data, futureField: 1 } }, 8192),
        'telemetry'
      )
    ).toThrow(/Unknown telemetry payload field/)
  })

  it('rejects stale retained state and forbids retaining fast telemetry', () => {
    const config = normalizeMqttLocalConfig({ enabled: true })
    const session: MqttSessionStateData = {
      schemaVersion: 1,
      observedAt: 1_000,
      expiresAt: 2_000,
      sim: 'iracing',
      connected: true,
      sessionRef: 'iracing:session-1',
      stale: false
    }
    const envelope = buildMqttCloudEvent('session', session, {
      id: 'session-1',
      instanceId: config.instanceId,
      sequence: '1',
      sourceTick: '1000',
      monotonicNs: '1',
      sessionId: session.sessionRef,
      partitionKey: 'session:1',
      partitionSeq: '1',
      capabilityGrantId: 'mqtt-target-publisher-simrig-1',
      observedAt: 1_000
    })
    expect(retainedEnvelopeIsFresh(envelope, 3_000, config.retainedMaxAgeMs)).toBe(false)
    expect(() =>
      validateRetainedPublication(mqttTopics(config.instanceId).session, true, envelope, config, 3_000)
    ).toThrow(/stale/i)

    const telemetry = buildMqttCloudEvent('telemetry', projectMqttTelemetry(snapshot(), 1_100), {
      id: 'telemetry-3',
      instanceId: config.instanceId,
      sequence: '3',
      sourceTick: '1000',
      monotonicNs: '3',
      sessionId: 'iracing:session-1',
      partitionKey: 'session:1',
      partitionSeq: '3',
      capabilityGrantId: 'mqtt-target-publisher-simrig-1',
      observedAt: 1_100
    })
    expect(() =>
      validateRetainedPublication(mqttTopics(config.instanceId).telemetry, true, telemetry, config, 1_100)
    ).toThrow(/Retained flag/)
  })

  it('keeps committed schema fingerprints synchronized with canonical JSON', () => {
    const files: Record<MqttSchemaKind, string> = {
      availability: 'availability.schema.json',
      telemetry: 'telemetry-state.schema.json',
      session: 'session-state.schema.json',
      event: 'race-event.schema.json',
      health: 'connector-health.schema.json',
      announcement: 'schema-announcement.schema.json',
      command: 'command-request.schema.json',
      result: 'command-result.schema.json'
    }
    for (const [kind, file] of Object.entries(files) as Array<[MqttSchemaKind, string]>) {
      const schema = JSON.parse(
        readFileSync(new URL(`../../../contracts/mqtt/v1/schemas/${file}`, import.meta.url), 'utf8')
      ) as { $id?: string }
      const fingerprint = createHash('sha256')
        .update(JSON.stringify(canonical(schema)))
        .digest('hex')
      expect(schema.$id).toBe(MQTT_SCHEMA_IDS[kind])
      expect(fingerprint).toBe(MQTT_SCHEMA_FINGERPRINTS[kind])
    }
  })

  it('generates a loopback-only broker profile with commands absent by default', () => {
    const config = buildMosquittoLoopbackConfig(DEFAULT_MQTT_LOCAL_CONFIG)
    const acl = buildMosquittoAclFiles(DEFAULT_MQTT_LOCAL_CONFIG)
    expect(config).toContain('listener 1883 127.0.0.1')
    expect(config).toContain('listener 1884 127.0.0.1')
    expect(config).not.toContain('listener 1885')
    expect(config).not.toContain('0.0.0.0')
    expect(config).toContain('allow_anonymous false')
    expect(config).toContain('password_file mqtt-publisher.passwd')
    expect(config).toContain('password_file mqtt-reader.passwd')
    expect(config).not.toMatch(/token|cloud/i)
    expect(acl['mqtt-publisher.acl']).toContain('user ultimate-sim-target')
    expect(acl['mqtt-reader.acl']).toContain('user ultimate-sim-reader')
    expect(acl['mqtt-command.acl']).toContain('user ultimate-sim-command')
  })

  it('ships a parseable AsyncAPI contract with loopback-only servers', () => {
    const source = readFileSync(
      new URL('../../../contracts/mqtt/v1/asyncapi.yaml', import.meta.url),
      'utf8'
    )
    const document = YAML.parse(source) as {
      asyncapi?: string
      servers?: Record<string, { host?: string }>
      channels?: Record<string, { address?: string }>
      components?: {
        schemas?: {
          cloudEvent?: { required?: string[] }
        }
      }
    }
    expect(document.asyncapi).toBe('3.0.0')
    expect(Object.values(document.servers ?? {}).every((server) => server.host?.startsWith('127.0.0.1:'))).toBe(true)
    expect(document.channels?.telemetry?.address).toContain('/v1/')
    expect(document.channels?.event?.address).toContain('/event/')
    expect(source).not.toContain('0.0.0.0')
    expect(source).toContain('type: userPassword')
    expect(document.components?.schemas?.cloudEvent?.required).toEqual(
      expect.arrayContaining([
        'sourcetick',
        'sessionid',
        'correlationid',
        'causationid',
        'consentepoch',
        'approvalid'
      ])
    )
  })
})
