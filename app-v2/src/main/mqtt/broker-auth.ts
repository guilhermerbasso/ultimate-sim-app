import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  MQTT_BROKER_USERNAMES,
  MqttContractError,
  mqttBrokerUrls,
  type MqttCapabilityGrant,
  type MqttLocalConfig,
  type MqttPrincipal
} from '../../shared/mqtt'

const MOSQUITTO_PBKDF2_ITERATIONS = 100_000
const MOSQUITTO_HASH_BYTES = 64
const MOSQUITTO_SALT_BYTES = 64

type RandomBytes = (size: number) => Uint8Array

export interface MqttTransportAccess {
  principal: MqttPrincipal
  username: string
  password: string
}

export type MqttBrokerAccessSet = Record<MqttPrincipal, MqttTransportAccess>

export interface MqttClientAccessDocument {
  version: 1
  localOnly: true
  reader: {
    url: string
    username: string
    password: string
  }
  command?: {
    url: string
    username: string
    password: string
  }
}

function defaultRandomBytes(size: number): Uint8Array {
  return randomBytes(size)
}

function passwordFrom(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

function validAccess(
  value: unknown,
  principal: MqttPrincipal
): value is MqttTransportAccess {
  if (!value || typeof value !== 'object') return false
  const access = value as Partial<MqttTransportAccess>
  return (
    access.principal === principal &&
    access.username === MQTT_BROKER_USERNAMES[principal] &&
    typeof access.password === 'string' &&
    access.password.length >= 32 &&
    !/[\r\n:]/.test(access.password)
  )
}

export function parseMqttBrokerAccessSet(value: unknown): MqttBrokerAccessSet | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<Record<MqttPrincipal, unknown>>
  if (
    !validAccess(record['target-publisher'], 'target-publisher') ||
    !validAccess(record['local-reader'], 'local-reader') ||
    !validAccess(record['local-command'], 'local-command')
  ) {
    return null
  }
  return {
    'target-publisher': { ...record['target-publisher'] },
    'local-reader': { ...record['local-reader'] },
    'local-command': { ...record['local-command'] }
  }
}

export function createMqttBrokerAccessSet(
  random: RandomBytes = defaultRandomBytes
): MqttBrokerAccessSet {
  const create = (principal: MqttPrincipal): MqttTransportAccess => ({
    principal,
    username: MQTT_BROKER_USERNAMES[principal],
    password: passwordFrom(random(32))
  })
  return {
    'target-publisher': create('target-publisher'),
    'local-reader': create('local-reader'),
    'local-command': create('local-command')
  }
}

export function validateMqttTransportAccess(
  grant: MqttCapabilityGrant,
  access: MqttTransportAccess | undefined
): MqttTransportAccess {
  if (!access || !validAccess(access, grant.principal)) {
    throw new MqttContractError('Authenticated MQTT role access is required.', 'acl-denied')
  }
  return { ...access }
}

export function mosquittoPasswordHash(
  password: string,
  saltInput: Uint8Array = defaultRandomBytes(MOSQUITTO_SALT_BYTES),
  iterations = MOSQUITTO_PBKDF2_ITERATIONS
): string {
  const salt = Buffer.from(saltInput)
  if ((salt.byteLength !== 12 && salt.byteLength !== MOSQUITTO_SALT_BYTES) || iterations < 1) {
    throw new Error('Invalid Mosquitto password hash parameters.')
  }
  const hash = pbkdf2Sync(password, salt, iterations, MOSQUITTO_HASH_BYTES, 'sha512')
  return `$7$${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyMosquittoPasswordHash(password: string, encoded: string): boolean {
  const parts = encoded.split('$')
  if (parts.length !== 5 || parts[0] !== '' || parts[1] !== '7') return false
  const iterations = Number(parts[2])
  if (!Number.isInteger(iterations) || iterations < 1) return false
  try {
    const salt = Buffer.from(parts[3], 'base64')
    const expected = Buffer.from(parts[4], 'base64')
    const actual = pbkdf2Sync(password, salt, iterations, expected.byteLength, 'sha512')
    return expected.byteLength === MOSQUITTO_HASH_BYTES && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

export function buildMosquittoPasswordFiles(
  access: MqttBrokerAccessSet,
  random: RandomBytes = defaultRandomBytes
): Record<string, string> {
  const entry = (principal: MqttPrincipal): string => {
    const role = access[principal]
    return `${role.username}:${mosquittoPasswordHash(role.password, random(MOSQUITTO_SALT_BYTES))}\n`
  }
  return {
    'mqtt-publisher.passwd': entry('target-publisher'),
    'mqtt-reader.passwd': entry('local-reader'),
    'mqtt-command.passwd': entry('local-command')
  }
}

export function buildMqttClientAccessDocument(
  config: MqttLocalConfig,
  access: MqttBrokerAccessSet
): MqttClientAccessDocument {
  const urls = mqttBrokerUrls(config)
  return {
    version: 1,
    localOnly: true,
    reader: {
      url: urls.reader,
      username: access['local-reader'].username,
      password: access['local-reader'].password
    },
    ...(config.commandsEnabled
      ? {
          command: {
            url: urls.command,
            username: access['local-command'].username,
            password: access['local-command'].password
          }
        }
      : {})
  }
}
