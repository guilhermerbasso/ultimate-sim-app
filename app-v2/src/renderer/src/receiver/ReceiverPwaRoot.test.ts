// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RECEIVER_CAPABILITIES,
  RECEIVER_HEARTBEAT_MS,
  RECEIVER_MAX_CLIENT_MESSAGE_BYTES,
  RECEIVER_MAX_HZ,
  RECEIVER_MAX_SERVER_MESSAGE_BYTES,
  RECEIVER_MIN_HZ,
  RECEIVER_PROTOCOL_VERSION,
  RECEIVER_SCHEMA_VERSION
} from '../../../shared/receiver-v2'
import type { ReceiverTelemetryData } from '../../../shared/receiver-v2'

const serviceWorkerPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../public/receiver/v2/service-worker.js'
)
const receiverRootPath = resolve(dirname(fileURLToPath(import.meta.url)), 'ReceiverPwaRoot.tsx')

const telemetryData: ReceiverTelemetryData = {
  connected: true,
  sim: 'iracing',
  sampleTimestamp: 1,
  speedKmh: 120,
  rpm: 6_000,
  gear: 3,
  throttle: 0.5,
  brake: 0,
  clutch: 0,
  fuelLiters: 20,
  fuelLapsRemaining: 10,
  lap: 2,
  position: 1,
  classPosition: 1,
  deltaToBestSec: 0.1,
  sessionTimeRemainingSec: 600,
  pitLimiter: false,
  onPitRoad: false,
  carLeftRight: 'clear',
  flags: {
    green: true,
    yellow: false,
    blue: false,
    white: false,
    checkered: false,
    red: false
  }
}

class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static readonly instances: MockWebSocket[] = []

  readyState = MockWebSocket.CONNECTING
  readonly sent: string[] = []
  private readonly listeners = new Map<string, Set<(event: Event) => void>>()

  constructor(
    readonly url: string,
    readonly protocol: string
  ) {
    MockWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(code = 1000, reason = ''): void {
    this.readyState = MockWebSocket.CLOSED
    this.emit('close', new CloseEvent('close', { code, reason }))
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN
    this.emit('open', new Event('open'))
  }

  message(body: unknown): void {
    this.emit('message', new MessageEvent('message', { data: JSON.stringify(body) }))
  }

  private emit(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

async function renderOpenReceiverSocket(): Promise<MockWebSocket> {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      authenticated: true,
      passwordRequired: false,
      protocolVersion: RECEIVER_PROTOCOL_VERSION,
      schemaVersion: RECEIVER_SCHEMA_VERSION,
      capabilities: [...RECEIVER_CAPABILITIES],
      minHz: RECEIVER_MIN_HZ,
      maxHz: RECEIVER_MAX_HZ,
      maxPayloadBytes: RECEIVER_MAX_SERVER_MESSAGE_BYTES,
      heartbeatMs: RECEIVER_HEARTBEAT_MS,
      transportProfile: 'local-development',
      readOnly: true,
      commandsEnabled: false
    })
  }))
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)

  const { ReceiverPwaRoot } = await import('./ReceiverPwaRoot')
  render(createElement(ReceiverPwaRoot))
  await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1))
  const socket = MockWebSocket.instances[0]
  socket.open()
  return socket
}

function welcomeMessage(): Record<string, unknown> {
  return {
    type: 'welcome',
    protocolVersion: RECEIVER_PROTOCOL_VERSION,
    schemaVersion: RECEIVER_SCHEMA_VERSION,
    capabilities: [...RECEIVER_CAPABILITIES],
    sessionId: 'receiver-session',
    rateHz: 20,
    maxPayloadBytes: RECEIVER_MAX_SERVER_MESSAGE_BYTES,
    heartbeatMs: RECEIVER_HEARTBEAT_MS,
    highWater: 0,
    serverTime: 1,
    readOnly: true,
    commands: false
  }
}

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
  MockWebSocket.instances.length = 0
})

describe('receiver PWA recovery', () => {
  it('uses the shared client message byte limit', () => {
    const source = readFileSync(receiverRootPath, 'utf8')

    expect(RECEIVER_MAX_CLIENT_MESSAGE_BYTES).toBeGreaterThan(0)
    expect(source).toMatch(/TextEncoder\(\)\.encode\(serialized\)\.length > RECEIVER_MAX_CLIENT_MESSAGE_BYTES/)
    expect(source).not.toMatch(/TextEncoder\(\)\.encode\(serialized\)\.length > 4_096/)
  })

  it('preserves a reverse-proxy prefix when the receiver URL has no trailing slash', async () => {
    const { receiverBaseUrl } = await import('./ReceiverPwaRoot')

    expect(receiverBaseUrl('https://example.test/sim/proxy/receiver/v2').toString())
      .toBe('https://example.test/sim/proxy/receiver/v2/')
    expect(receiverBaseUrl('https://example.test/sim/proxy/receiver/v2/assets/app.js').toString())
      .toBe('https://example.test/sim/proxy/receiver/v2/')
  })

  it('sends only one gap resync until the server completes it', async () => {
    const socket = await renderOpenReceiverSocket()
    socket.message(welcomeMessage())

    const telemetry = (sequence: number, replay = false): void => socket.message({
      type: 'telemetry',
      sequence,
      sentAt: Date.now(),
      replay,
      data: telemetryData
    })
    const resyncs = (): Array<Record<string, unknown>> => socket.sent
      .map((message) => JSON.parse(message) as Record<string, unknown>)
      .filter((message) => message.type === 'resync')

    telemetry(2)
    telemetry(3)
    expect(resyncs()).toEqual([{ type: 'resync', afterSequence: 0, reason: 'gap' }])

    telemetry(1, true)
    telemetry(2, true)
    telemetry(3, true)
    socket.message({ type: 'resync-complete', highWater: 3, replayed: 3, snapshot: false })
    telemetry(5)

    expect(resyncs()).toEqual([
      { type: 'resync', afterSequence: 0, reason: 'gap' },
      { type: 'resync', afterSequence: 3, reason: 'gap' }
    ])
  })

  it('keeps only one reconnect timer pending across repeated triggers', async () => {
    const socket = await renderOpenReceiverSocket()
    vi.useFakeTimers()
    try {
      await act(async () => {
        socket.close(1012, 'service_restart')
        window.dispatchEvent(new Event('online'))
        await vi.advanceTimersByTimeAsync(600)
      })

      expect(MockWebSocket.instances).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears a retryable server error after the next successful welcome', async () => {
    const socket = await renderOpenReceiverSocket()
    socket.message({
      type: 'error',
      code: 'temporarily_unavailable',
      message: 'Receiver is temporarily unavailable.',
      retryable: true
    })
    expect((await screen.findByRole('alert')).textContent).toContain('temporarily unavailable')

    socket.message(welcomeMessage())

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByText('LIVE')).toBeTruthy()
  })

  it('retries initial authorization when an offline browser comes back online', async () => {
    let online = false
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => online
    })
    window.__ULTIMATE_SIM_RECEIVER_PAIRING__ = 'a'.repeat(32)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 403
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          authenticated: false,
          passwordRequired: true,
          protocolVersion: RECEIVER_PROTOCOL_VERSION,
          schemaVersion: RECEIVER_SCHEMA_VERSION,
          capabilities: [...RECEIVER_CAPABILITIES],
          minHz: RECEIVER_MIN_HZ,
          maxHz: RECEIVER_MAX_HZ,
          maxPayloadBytes: RECEIVER_MAX_SERVER_MESSAGE_BYTES,
          heartbeatMs: RECEIVER_HEARTBEAT_MS,
          transportProfile: 'local-development',
          readOnly: true,
          commandsEnabled: false
        })
      })
    vi.stubGlobal('fetch', fetchMock)

    const { ReceiverPwaRoot } = await import('./ReceiverPwaRoot')
    render(createElement(ReceiverPwaRoot))

    expect(await screen.findByText('OFFLINE · STALE')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()

    online = true
    window.dispatchEvent(new Event('online'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/receiver\/v2\/status$/)
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/receiver\/v2\/$/)
    expect(String(fetchMock.mock.calls[2][0])).toMatch(/\/receiver\/v2\/status$/)
    expect(await screen.findByText('PAIRING')).toBeTruthy()
  })

  it('precaches the shell graph and deletes only obsolete receiver caches', () => {
    const source = readFileSync(serviceWorkerPath, 'utf8')

    expect(source).toContain('cacheReceiverShell')
    expect(source).toContain('htmlResources')
    expect(source).toContain('moduleDependencies')
    expect(source).toContain('cssDependencies')
    expect(source).toMatch(/key\.startsWith\(CACHE_PREFIX\)/)
    expect(source).toMatch(/cache\.match\(request\)/)
    expect(source).not.toMatch(/filter\(\(key\) => key !== CACHE_NAME\)/)
  })
})
