import { describe, expect, it } from 'vitest'
import {
  RECEIVER_LATENCY_BUDGET_MS,
  RECEIVER_MAX_CLIENT_MESSAGE_BYTES,
  RECEIVER_PROTOCOL_VERSION,
  RECEIVER_SCHEMA_VERSION,
  createReceiverTelemetryData,
  negotiateReceiverRate,
  parseReceiverClientMessage,
  parseReceiverServerMessage,
  summarizeReceiverLatencies
} from './receiver-v2'

describe('receiver v2 bounded protocol', () => {
  it('accepts a bounded hello and rejects commands, extra fields, and oversized messages', () => {
    const hello = parseReceiverClientMessage(JSON.stringify({
      type: 'hello',
      protocolVersions: [RECEIVER_PROTOCOL_VERSION],
      schemaVersions: [RECEIVER_SCHEMA_VERSION],
      capabilities: ['telemetry.fast.v1', 'ack', 'resync'],
      requestedHz: 20,
      maxPayloadBytes: 8_192,
      client: { id: 'browser-1', name: 'Test browser', version: '1' }
    }))
    expect(hello.ok).toBe(true)

    expect(parseReceiverClientMessage(JSON.stringify({
      type: 'command',
      action: 'launch-process'
    }))).toMatchObject({ ok: false, code: 'data_diode' })

    expect(parseReceiverClientMessage(JSON.stringify({
      type: 'ack',
      sequence: 1,
      command: 'hidden'
    }))).toMatchObject({ ok: false, code: 'schema_ack' })

    expect(parseReceiverClientMessage('x'.repeat(RECEIVER_MAX_CLIENT_MESSAGE_BYTES + 1)))
      .toMatchObject({ ok: false, code: 'message_size' })
  })

  it('publishes a fixed, privacy-bounded telemetry schema', () => {
    const payload = createReceiverTelemetryData({
      sim: 'iracing',
      connected: true,
      timestamp: 123,
      speedKmh: 999,
      rpm: 99_999,
      gear: 99,
      throttle: 2,
      brake: -1,
      clutch: 0.5,
      driverName: 'Private Driver',
      trackName: 'Private League Track',
      drivers: [{ name: 'Private Rival' }]
    } as never, 500)

    expect(payload).toMatchObject({
      sim: 'iracing',
      speedKmh: 600,
      rpm: 30_000,
      gear: 20,
      throttle: 1,
      brake: 0,
      clutch: 0.5
    })
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toMatch(/Private Driver|Private Rival|Private League Track/)
    expect(serialized.length).toBeLessThan(2_048)
  })

  it('fails closed on incompatible or expanded server schemas', () => {
    const valid = JSON.stringify({
      type: 'welcome',
      protocolVersion: RECEIVER_PROTOCOL_VERSION,
      schemaVersion: RECEIVER_SCHEMA_VERSION,
      capabilities: ['telemetry.fast.v1', 'ack', 'resync', 'metrics'],
      sessionId: 'receiver-session',
      rateHz: 20,
      maxPayloadBytes: 8_192,
      heartbeatMs: 5_000,
      highWater: 0,
      serverTime: 1,
      readOnly: true,
      commands: false
    })
    expect(parseReceiverServerMessage(valid)?.type).toBe('welcome')
    expect(parseReceiverServerMessage(valid.replace('"commands":false', '"commands":true'))).toBeNull()
    expect(parseReceiverServerMessage(valid.replace('"schemaVersion":1', '"schemaVersion":99'))).toBeNull()
    expect(parseReceiverServerMessage(valid.replace('"commands":false', '"commands":false,"extra":"nope"'))).toBeNull()
    const welcome = JSON.parse(valid) as Record<string, unknown>
    for (const capabilities of [
      [],
      ['ack', 'resync'],
      ['telemetry.fast.v1', 'telemetry.fast.v1']
    ]) {
      expect(parseReceiverServerMessage(JSON.stringify({ ...welcome, capabilities }))).toBeNull()
    }
  })

  it('clamps negotiated rate and evaluates the local latency budget at p95', () => {
    expect(negotiateReceiverRate(1)).toBe(20)
    expect(negotiateReceiverRate(42)).toBe(42)
    expect(negotiateReceiverRate(999)).toBe(60)

    const passing = summarizeReceiverLatencies([18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40])
    expect(passing.p95).toBeLessThanOrEqual(RECEIVER_LATENCY_BUDGET_MS)

    const failing = summarizeReceiverLatencies([20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 250])
    expect(failing.p95).toBeGreaterThan(RECEIVER_LATENCY_BUDGET_MS)
  })
})
