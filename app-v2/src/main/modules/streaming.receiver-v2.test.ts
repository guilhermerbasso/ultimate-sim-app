import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { request, type IncomingHttpHeaders } from 'node:http'
import WebSocket from 'ws'
import {
  RECEIVER_CAPABILITIES,
  RECEIVER_LATENCY_BUDGET_MS,
  RECEIVER_PROTOCOL_VERSION,
  RECEIVER_SCHEMA_VERSION,
  RECEIVER_SUBPROTOCOL,
  type ReceiverServerMessage
} from '../../shared/receiver-v2'
import { STREAMING_CHANNELS, type StreamingStartArgs, type StreamingStartResult, type StreamingStatus } from '../../shared/streaming'
import type { ModuleContext } from '../module-context'

vi.mock('./dashboards', () => ({
  getDashboardManager: () => ({
    listOpen: () => [{ id: 'default' }],
    list: () => [{ id: 'default', name: 'Default', hidden: false }],
    getDashboard: (id: string) => id === 'default' ? { id, name: 'Default', elements: [] } : null
  })
}))

vi.mock('../touchpanel/manager', () => ({
  getTouchPanelManager: () => ({ has: () => false, getPanel: () => null })
}))

import { register } from './streaming'

interface ResponseData {
  statusCode: number
  body: string
  headers: IncomingHttpHeaders
}

interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
}

class MessageInbox {
  private readonly messages: ReceiverServerMessage[] = []
  private readonly waiters: Array<{
    predicate: (message: ReceiverServerMessage) => boolean
    resolve(message: ReceiverServerMessage): void
    reject(error: Error): void
    timer: ReturnType<typeof setTimeout>
  }> = []

  constructor(socket: WebSocket) {
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as ReceiverServerMessage
      const waiterIndex = this.waiters.findIndex((waiter) => waiter.predicate(message))
      if (waiterIndex >= 0) {
        const waiter = this.waiters.splice(waiterIndex, 1)[0]
        clearTimeout(waiter.timer)
        waiter.resolve(message)
      } else {
        this.messages.push(message)
      }
    })
  }

  next<T extends ReceiverServerMessage>(
    predicate: (message: ReceiverServerMessage) => message is T,
    timeoutMs?: number
  ): Promise<T>
  next(
    predicate: (message: ReceiverServerMessage) => boolean,
    timeoutMs?: number
  ): Promise<ReceiverServerMessage>
  next(
    predicate: (message: ReceiverServerMessage) => boolean,
    timeoutMs = 3_000
  ): Promise<ReceiverServerMessage> {
    const index = this.messages.findIndex(predicate)
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0])
    return new Promise((resolveMessage, rejectMessage) => {
      const waiter = {
        predicate,
        resolve: resolveMessage,
        reject: rejectMessage,
        timer: setTimeout(() => {
          const waiterIndex = this.waiters.indexOf(waiter)
          if (waiterIndex >= 0) this.waiters.splice(waiterIndex, 1)
          rejectMessage(new Error('Timed out waiting for receiver message'))
        }, timeoutMs)
      }
      this.waiters.push(waiter)
    })
  }
}

function fakeContext(): ModuleContext & { handlers: Map<string, (_event: unknown, args?: StreamingStartArgs) => unknown> } {
  const handlers = new Map<string, (_event: unknown, args?: StreamingStartArgs) => unknown>()
  return {
    handlers,
    app: { once: () => undefined },
    ipcMain: {
      handle: (channel: string, handler: (_event: unknown, args?: StreamingStartArgs) => unknown) => {
        handlers.set(channel, handler)
      }
    },
    telemetryHub: {
      getLatest: () => ({
        sim: 'iracing',
        connected: true,
        timestamp: Date.now(),
        speedKmh: 210.5,
        rpm: 7_500,
        gear: 5,
        throttle: 0.8,
        brake: 0,
        clutch: 0,
        fuelLiters: 41.2,
        currentLap: 12,
        position: 3,
        classPosition: 2,
        driverName: 'Must Never Leave',
        flags: {
          green: true,
          yellow: false,
          blue: false,
          white: false,
          checkered: false,
          red: false,
          black: false,
          meatball: false,
          repair: false,
          disqualify: false,
          greenWhiteCheckered: false
        }
      })
    },
    serialManager: {},
    serialHub: {},
    profileStore: {},
    iracingControl: {},
    getMainWindow: () => null,
    broadcast: () => undefined
  } as unknown as ModuleContext & { handlers: Map<string, (_event: unknown, args?: StreamingStartArgs) => unknown> }
}

async function invoke<T>(
  ctx: ReturnType<typeof fakeContext>,
  channel: string,
  args?: StreamingStartArgs
): Promise<T> {
  const handler = ctx.handlers.get(channel)
  if (!handler) throw new Error(`missing handler ${channel}`)
  return await handler({}, args) as T
}

function httpRequest(url: string | URL, options: RequestOptions = {}): Promise<ResponseData> {
  return new Promise((resolveResult, rejectResult) => {
    const body = options.body
    const headers = { ...options.headers }
    if (body !== undefined) headers['Content-Length'] = String(Buffer.byteLength(body))
    const req = request(url, { method: options.method ?? 'GET', headers }, (res) => {
      let responseBody = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { responseBody += chunk })
      res.on('end', () => resolveResult({
        statusCode: res.statusCode ?? 0,
        body: responseBody,
        headers: res.headers
      }))
    })
    req.on('error', rejectResult)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

function cookie(response: ResponseData): string {
  const values = response.headers['set-cookie'] ?? []
  const raw = values.find((value) => value.startsWith('ultimate_sim_receiver_session='))
  if (!raw) throw new Error('missing receiver session cookie')
  return raw.split(';', 1)[0]
}

function pairingDetails(started: StreamingStartResult): { baseUrl: URL; code: string } {
  const value = started.receiverV2.pairingUrl
  if (!value) throw new Error('missing receiver pairing URL')
  const pairingUrl = new URL(value)
  const code = new URLSearchParams(pairingUrl.hash.slice(1)).get('pair')
  if (!code) throw new Error('missing receiver pairing code')
  pairingUrl.hash = ''
  return { baseUrl: pairingUrl, code }
}

async function bootstrapAndPair(started: StreamingStartResult): Promise<{ baseUrl: URL; sessionCookie: string }> {
  const { baseUrl, code } = pairingDetails(started)
  const shell = await httpRequest(baseUrl)
  const bootstrapCookie = cookie(shell)
  const paired = await httpRequest(new URL('pair', baseUrl), {
    method: 'POST',
    headers: { Cookie: bootstrapCookie, Origin: baseUrl.origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairingCode: code })
  })
  expect(paired.statusCode).toBe(200)
  return { baseUrl, sessionCookie: cookie(paired) }
}

function openReceiverSocket(baseUrl: URL, sessionCookie: string, origin = baseUrl.origin): Promise<{ socket: WebSocket; inbox: MessageInbox }> {
  const url = new URL('ws', baseUrl)
  url.protocol = 'ws:'
  return new Promise((resolveSocket, rejectSocket) => {
    const socket = new WebSocket(url, RECEIVER_SUBPROTOCOL, {
      headers: { Cookie: sessionCookie, Origin: origin }
    })
    const onError = (error: Error): void => rejectSocket(error)
    socket.once('error', onError)
    socket.once('open', () => {
      socket.off('error', onError)
      resolveSocket({ socket, inbox: new MessageInbox(socket) })
    })
  })
}

function hello(resumeFrom?: number, protocolVersions = [RECEIVER_PROTOCOL_VERSION]): string {
  return JSON.stringify({
    type: 'hello',
    protocolVersions,
    schemaVersions: [RECEIVER_SCHEMA_VERSION],
    capabilities: [...RECEIVER_CAPABILITIES],
    requestedHz: 20,
    maxPayloadBytes: 8_192,
    ...(resumeFrom === undefined ? {} : { resumeFrom }),
    client: { id: 'vitest-browser', name: 'Vitest', version: '1' }
  })
}

describe('streaming receiver v2 certification target', () => {
  let ctx: ReturnType<typeof fakeContext> | null = null

  beforeEach(() => {
    ctx = fakeContext()
    register(ctx)
  })

  afterEach(async () => {
    if (ctx) await invoke<StreamingStatus>(ctx, STREAMING_CHANNELS.stop)
    ctx = null
  })

  it('uses a private default bind, one-use fragment pairing, and fail-closed browser headers', async () => {
    const started = await invoke<StreamingStartResult>(ctx!, STREAMING_CHANNELS.start, { layoutId: 'default' })
    const { baseUrl, code } = pairingDetails(started)

    expect(started.receiverV2.bindAddress).toBe('127.0.0.1')
    expect(started.receiverV2.transportProfile).toBe('local-development')
    expect(new URL(started.receiverV2.pairingUrl!).search).toBe('')
    expect(started.receiverV2.secretInQuery).toBe(false)
    expect(started.receiverV2.commandsEnabled).toBe(false)

    const shell = await httpRequest(baseUrl)
    expect(shell.statusCode).toBe(200)
    expect(shell.headers['content-security-policy']).toMatch(/default-src 'none'.*frame-ancestors 'none'/)
    expect(shell.headers['permissions-policy']).toMatch(/camera=\(\).*serial=\(\)/)
    expect(shell.body).toContain('receiver/v2/bootstrap.js')
    expect(shell.body).not.toContain(code)
    const bootstrapCookie = cookie(shell)
    const unrelatedAsset = await httpRequest(new URL('../../assets/index-private.js', baseUrl), {
      headers: { Cookie: bootstrapCookie }
    })
    expect(unrelatedAsset.statusCode).toBe(403)

    const paired = await httpRequest(new URL('pair', baseUrl), {
      method: 'POST',
      headers: { Cookie: bootstrapCookie, Origin: baseUrl.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode: code })
    })
    expect(paired.statusCode).toBe(200)

    const replayShell = await httpRequest(baseUrl)
    const replay = await httpRequest(new URL('pair', baseUrl), {
      method: 'POST',
      headers: { Cookie: cookie(replayShell), Origin: baseUrl.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode: code })
    })
    expect(replay.statusCode).toBe(409)
  })

  it('rate-limits pairing failures and rejects unauthenticated or cross-origin websocket upgrades', async () => {
    const started = await invoke<StreamingStartResult>(ctx!, STREAMING_CHANNELS.start, { layoutId: 'default' })
    const { baseUrl } = pairingDetails(started)
    const shell = await httpRequest(baseUrl)
    const bootstrapCookie = cookie(shell)
    for (let index = 0; index < 10; index += 1) {
      const failed = await httpRequest(new URL('pair', baseUrl), {
        method: 'POST',
        headers: { Cookie: bootstrapCookie, Origin: baseUrl.origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairingCode: `${'a'.repeat(31)}${index % 10}` })
      })
      expect(failed.statusCode).toBe(403)
    }
    const limited = await httpRequest(new URL('pair', baseUrl), {
      method: 'POST',
      headers: { Cookie: bootstrapCookie, Origin: baseUrl.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode: 'b'.repeat(32) })
    })
    expect(limited.statusCode).toBe(429)

    const wsUrl = new URL('ws', baseUrl)
    wsUrl.protocol = 'ws:'
    const unauthorizedStatus = await new Promise<number>((resolveStatus, rejectStatus) => {
      const socket = new WebSocket(wsUrl, RECEIVER_SUBPROTOCOL, { headers: { Origin: baseUrl.origin } })
      socket.once('unexpected-response', (_request, response) => {
        resolveStatus(response.statusCode ?? 0)
        response.resume()
      })
      socket.once('error', rejectStatus)
    })
    expect(unauthorizedStatus).toBe(401)
  })

  it('fails closed on unsupported versions and command-shaped browser messages', async () => {
    const started = await invoke<StreamingStartResult>(ctx!, STREAMING_CHANNELS.start, { layoutId: 'default' })
    const paired = await bootstrapAndPair(started)

    const wsUrl = new URL('ws', paired.baseUrl)
    wsUrl.protocol = 'ws:'
    const rejectedOriginStatus = await new Promise<number>((resolveStatus, rejectStatus) => {
      const socket = new WebSocket(wsUrl, RECEIVER_SUBPROTOCOL, {
        headers: { Cookie: paired.sessionCookie, Origin: 'https://evil.example' }
      })
      socket.once('unexpected-response', (_request, response) => {
        resolveStatus(response.statusCode ?? 0)
        response.resume()
      })
      socket.once('error', rejectStatus)
    })
    expect(rejectedOriginStatus).toBe(403)

    const incompatible = await openReceiverSocket(paired.baseUrl, paired.sessionCookie)
    incompatible.socket.send(hello(undefined, [1]))
    const versionError = await incompatible.inbox.next((message) => message.type === 'error')
    expect(versionError).toMatchObject({ type: 'error', code: 'unsupported_protocol', retryable: false })

    const valid = await openReceiverSocket(paired.baseUrl, paired.sessionCookie)
    valid.socket.send(hello())
    const welcome = await valid.inbox.next((message) => message.type === 'welcome')
    expect(welcome).toMatchObject({
      type: 'welcome',
      protocolVersion: RECEIVER_PROTOCOL_VERSION,
      schemaVersion: RECEIVER_SCHEMA_VERSION,
      readOnly: true,
      commands: false
    })
    await valid.inbox.next((message) => message.type === 'snapshot')
    valid.socket.send(JSON.stringify({ type: 'command', action: 'control-pc' }))
    const diodeError = await valid.inbox.next((message) => message.type === 'error')
    expect(diodeError).toMatchObject({ type: 'error', code: 'data_diode', retryable: false })
  })

  it('reconnects with a cursor, replays bounded frames, resyncs, and records local latency', async () => {
    const started = await invoke<StreamingStartResult>(ctx!, STREAMING_CHANNELS.start, { layoutId: 'default' })
    const paired = await bootstrapAndPair(started)
    const first = await openReceiverSocket(paired.baseUrl, paired.sessionCookie)
    first.socket.send(hello())
    await first.inbox.next((message) => message.type === 'welcome')
    await first.inbox.next((message) => message.type === 'snapshot')
    const live = await first.inbox.next((message): message is Extract<ReceiverServerMessage, { type: 'telemetry' }> => message.type === 'telemetry')
    expect(JSON.stringify(live)).not.toContain('Must Never Leave')
    first.socket.send(JSON.stringify({ type: 'ack', sequence: live.sequence }))
    first.socket.close(1000, 'test reconnect')

    await new Promise((resolveWait) => setTimeout(resolveWait, 180))

    const second = await openReceiverSocket(paired.baseUrl, paired.sessionCookie)
    second.socket.send(hello(live.sequence))
    await second.inbox.next((message) => message.type === 'welcome')
    const replayed = await second.inbox.next((message): message is Extract<ReceiverServerMessage, { type: 'telemetry' }> => (
      message.type === 'telemetry' && message.replay
    ))
    const completed = await second.inbox.next((message) => message.type === 'resync-complete')
    expect(replayed.sequence).toBeGreaterThan(live.sequence)
    expect(completed).toMatchObject({ type: 'resync-complete', snapshot: false })
    if (completed.type === 'resync-complete') expect(completed.replayed).toBeGreaterThan(0)

    second.socket.send(JSON.stringify({ type: 'ack', sequence: replayed.sequence }))
    second.socket.send(JSON.stringify({ type: 'resync', afterSequence: replayed.sequence, reason: 'manual' }))
    await second.inbox.next((message) => message.type === 'resync-complete')
    await new Promise((resolveWait) => setTimeout(resolveWait, 20))

    const statusResponse = await httpRequest(new URL('status', paired.baseUrl), {
      headers: { Cookie: paired.sessionCookie }
    })
    expect(statusResponse.statusCode).toBe(200)
    const status = await invoke<StreamingStatus>(ctx!, STREAMING_CHANNELS.status)
    expect(status.receiverV2.metrics.reconnects).toBeGreaterThanOrEqual(1)
    expect(status.receiverV2.metrics.replayedFrames).toBeGreaterThan(0)
    expect(status.receiverV2.metrics.resyncs).toBeGreaterThanOrEqual(1)
    expect(status.receiverV2.metrics.latencySamples).toBeGreaterThanOrEqual(1)
  })

  it('meets the local acknowledgement latency budget across a 20 Hz sample window', async () => {
    const started = await invoke<StreamingStartResult>(ctx!, STREAMING_CHANNELS.start, { layoutId: 'default' })
    const paired = await bootstrapAndPair(started)
    const receiver = await openReceiverSocket(paired.baseUrl, paired.sessionCookie)
    receiver.socket.send(hello())
    await receiver.inbox.next((message) => message.type === 'welcome')
    await receiver.inbox.next((message) => message.type === 'snapshot')

    for (let index = 0; index < 20; index += 1) {
      const frame = await receiver.inbox.next((message): message is Extract<ReceiverServerMessage, { type: 'telemetry' }> => (
        message.type === 'telemetry' && !message.replay
      ))
      receiver.socket.send(JSON.stringify({ type: 'ack', sequence: frame.sequence }))
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))

    const status = await invoke<StreamingStatus>(ctx!, STREAMING_CHANNELS.status)
    expect(status.receiverV2.metrics.latencySamples).toBeGreaterThanOrEqual(20)
    expect(status.receiverV2.metrics.latencyP95Ms).toBeLessThanOrEqual(RECEIVER_LATENCY_BUDGET_MS)
    expect(status.receiverV2.metrics.latencyBudgetPassed).toBe(true)
    expect(status.receiverV2.metrics.setupTimeMs).toBeLessThanOrEqual(status.receiverV2.metrics.setupBudgetMs)
    expect(status.receiverV2.metrics.setupBudgetPassed).toBe(true)
  })
})
