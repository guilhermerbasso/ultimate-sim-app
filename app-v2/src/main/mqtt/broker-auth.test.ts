import { describe, expect, it } from 'vitest'
import {
  createMqttCapabilityGrant,
  normalizeMqttLocalConfig
} from '../../shared/mqtt'
import {
  buildMosquittoPasswordFiles,
  buildMqttClientAccessDocument,
  createMqttBrokerAccessSet,
  parseMqttBrokerAccessSet,
  validateMqttTransportAccess,
  verifyMosquittoPasswordHash
} from './broker-auth'

function deterministicRandom(): (size: number) => Uint8Array {
  let call = 1
  return (size) => {
    const bytes = Uint8Array.from({ length: size }, (_, index) => (call + index) % 256)
    call += 17
    return bytes
  }
}

describe('local MQTT broker role access', () => {
  it('creates distinct role secrets and never exports the publisher secret', () => {
    const config = normalizeMqttLocalConfig({
      enabled: true,
      commandsEnabled: true,
      instanceId: 'rig-auth'
    })
    const access = createMqttBrokerAccessSet(deterministicRandom())
    const clients = buildMqttClientAccessDocument(config, access)
    const serializedClients = JSON.stringify(clients)

    expect(new Set(Object.values(access).map((entry) => entry.password)).size).toBe(3)
    expect(parseMqttBrokerAccessSet(JSON.parse(JSON.stringify(access)))).toEqual(access)
    expect(serializedClients).not.toContain(access['target-publisher'].password)
    expect(serializedClients).toContain(access['local-reader'].password)
    expect(serializedClients).toContain(access['local-command'].password)
  })

  it('writes Mosquitto-compatible PBKDF2 files without plaintext secrets', () => {
    const access = createMqttBrokerAccessSet(deterministicRandom())
    const files = buildMosquittoPasswordFiles(
      access,
      (size) => new Uint8Array(size).fill(199)
    )
    const roles = [
      ['mqtt-publisher.passwd', 'target-publisher'],
      ['mqtt-reader.passwd', 'local-reader'],
      ['mqtt-command.passwd', 'local-command']
    ] as const

    for (const [file, principal] of roles) {
      const [username, encoded] = files[file].trim().split(':')
      expect(username).toBe(access[principal].username)
      expect(encoded).toMatch(/^\$7\$100000\$/)
      expect(encoded).not.toContain(access[principal].password)
      expect(verifyMosquittoPasswordHash(access[principal].password, encoded)).toBe(true)
      expect(verifyMosquittoPasswordHash('wrong-password', encoded)).toBe(false)
    }
  })

  it('binds transport access to the capability principal', () => {
    const config = normalizeMqttLocalConfig({ enabled: true, instanceId: 'rig-bound' })
    const access = createMqttBrokerAccessSet(deterministicRandom())
    const grant = createMqttCapabilityGrant('target-publisher', config, 1_000)

    expect(validateMqttTransportAccess(grant, access['target-publisher'])).toEqual(
      access['target-publisher']
    )
    expect(() => validateMqttTransportAccess(grant, access['local-reader'])).toThrow(
      /authenticated MQTT role access/i
    )
  })
})
