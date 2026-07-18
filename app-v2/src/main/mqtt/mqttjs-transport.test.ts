import { describe, expect, it } from 'vitest'
import {
  createMqttCapabilityGrant,
  mqttTopics,
  normalizeMqttLocalConfig
} from '../../shared/mqtt'
import { createMqttBrokerAccessSet } from './broker-auth'
import { mqttJsConnectOptions } from './mqttjs-transport'

describe('MQTT.js production transport', () => {
  it('authenticates as the capability principal and carries the current last will', () => {
    const config = normalizeMqttLocalConfig({ enabled: true, instanceId: 'rig-transport' })
    const grant = createMqttCapabilityGrant('target-publisher', config, 1_000)
    const access = createMqttBrokerAccessSet(() => new Uint8Array(32).fill(7))
    const will = {
      topic: mqttTopics(config.instanceId).availability,
      payload: new Uint8Array([1, 2, 3]),
      qos: 1 as const,
      retain: true,
      messageExpirySec: 60
    }

    const options = mqttJsConnectOptions(config, grant, access['target-publisher'], will)
    expect(options.username).toBe(access['target-publisher'].username)
    expect(options.password).toBe(access['target-publisher'].password)
    expect(options.will?.topic).toBe(will.topic)
    expect(options.will?.retain).toBe(true)
    expect(() => mqttJsConnectOptions(config, grant, access['local-reader'], will)).toThrow(
      /authenticated MQTT role access/i
    )
  })
})
