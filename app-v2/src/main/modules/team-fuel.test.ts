import { createHash, createHmac } from 'node:crypto'
import { once } from 'node:events'
import { Socket as NetSocket, type AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import { TEAM_FUEL_CHANNELS, type TeamFuelPeer, type TeamFuelStartArgs, type TeamFuelStatus } from '../../shared/team-fuel'
import type { ModuleContext } from '../module-context'
const mdns = vi.hoisted(() => ({
  services: [] as Array<Record<string, unknown>>,
  browsers: [] as Array<{ callback: (service: Record<string, unknown>) => void }>
}))
vi.mock('bonjour-service', () => ({
  default: class {
    publish(): { stop: () => void } { return { stop: () => undefined } }
    find(_query: unknown, callback: (service: Record<string, unknown>) => void): unknown {
      const browser = { services: [...mdns.services], callback, stop: () => undefined }
      mdns.browsers.push(browser)
      return browser
    }
    destroy(callback: () => void): void { callback() }
  }
}))
import { parseWire, register } from './team-fuel'
const KEY = 'containment-room'
const HASH = createHash('sha256').update(KEY).digest('hex').slice(0, 16)
const NONCE = 'ab'.repeat(24)
type Handler = (_event: unknown, args?: TeamFuelStartArgs) => unknown
type TestContext = ModuleContext & { handlers: Map<string, Handler> }
type Wire = { type?: string; nonce?: string; peer?: TeamFuelPeer }
type Probe = { ws: WebSocket; messages: Wire[]; opened: Promise<void>; closed: Promise<number> }
type TcpProbe = { socket: NetSocket; opened: Promise<void>; closed: Promise<void> }
const contexts: TestContext[] = []
const sockets = new Set<WebSocket>()
const tcpSockets = new Set<NetSocket>()
const servers = new Set<WebSocketServer>()
function fakeContext(driverName = 'Local Driver'): TestContext {
  const handlers = new Map<string, Handler>()
  return {
    handlers,
    app: { on: () => undefined },
    ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
    telemetryHub: {
      getLatest: () => ({
        connected: true,
        driverName,
        fuelLiters: 42,
        fuelPerLap: 2.5,
        lapsRemaining: 16.8,
        sessionUniqueId: 7,
        drivers: [{ isPlayer: true, custId: 123 }]
      })
    },
    serialManager: {},
    serialHub: {},
    profileStore: {},
    iracingControl: {},
    getMainWindow: () => null,
    broadcast: () => undefined
  } as unknown as TestContext
}
async function invoke<T>(ctx: TestContext, channel: string, args?: TeamFuelStartArgs): Promise<T> {
  const handler = ctx.handlers.get(channel)
  if (!handler) throw new Error(`Missing handler ${channel}`)
  return await handler({}, args) as T
}
function service(port: number): Record<string, unknown> {
  return { port, addresses: ['127.0.0.1'], txt: { room: HASH, version: '1' } }
}
async function start(mode: 'host' | 'join', port?: number): Promise<{ ctx: TestContext; status: TeamFuelStatus }> {
  if (mode === 'join') mdns.services = [service(port as number)]
  const ctx = fakeContext(mode === 'host' ? 'Host Driver' : 'Join Driver')
  contexts.push(ctx)
  register(ctx)
  const status = await invoke<TeamFuelStatus>(ctx, TEAM_FUEL_CHANNELS.start, { mode, roomKey: KEY })
  return { ctx, status }
}
function probe(port: number): Probe {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  sockets.add(ws)
  const messages: Wire[] = []
  ws.on('message', (data) => {
    try { messages.push(JSON.parse(data.toString()) as Wire) } catch { /* transport tests send junk */ }
  })
  ws.on('error', () => undefined)
  return {
    ws,
    messages,
    opened: new Promise<void>((resolve) => ws.once('open', resolve)),
    closed: new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)))
  }
}
function tcpProbe(port: number, payload?: string): TcpProbe {
  const socket = new NetSocket()
  tcpSockets.add(socket)
  socket.on('error', () => undefined)
  const opened = once(socket, 'connect').then(() => {
    if (payload) socket.write(payload)
  })
  const closed = once(socket, 'close').then(() => undefined)
  socket.connect(port, '127.0.0.1')
  return { socket, opened, closed }
}
async function makeServer(onConnection: (socket: WebSocket) => void): Promise<{ server: WebSocketServer; port: number }> {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  servers.add(server)
  server.on('connection', onConnection)
  await once(server, 'listening')
  return { server, port: (server.address() as AddressInfo).port }
}
function peer(peerId: string, overrides: Partial<TeamFuelPeer> = {}): TeamFuelPeer {
  return { peerId, driverName: peerId, fuelLiters: 20, ts: Date.now(), ...overrides }
}
function send(socket: WebSocket, value: unknown, options?: { fin?: boolean }): void {
  socket.send(typeof value === 'string' ? value : JSON.stringify(value), options ?? {})
}
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
async function waitUntil(check: () => boolean | Promise<boolean>, timeout = 2000): Promise<void> {
  const end = Date.now() + timeout
  while (!await check()) {
    if (Date.now() >= end) throw new Error('Timed out waiting for condition')
    await sleep(10)
  }
}
function within<T>(promise: Promise<T>, timeout = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for event')), timeout)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) }
    )
  })
}
async function challenge(p: Probe): Promise<Wire> {
  await p.opened
  await waitUntil(() => p.messages.some((message) => message.type === 'challenge'))
  return p.messages.find((message) => message.type === 'challenge') as Wire
}
afterEach(async () => {
  for (const socket of tcpSockets) socket.destroy()
  tcpSockets.clear()
  for (const socket of sockets) {
    if (socket.readyState !== WebSocket.CLOSED) {
      try { socket.terminate() } catch { /* best-effort */ }
    }
  }
  sockets.clear()
  for (const ctx of contexts.splice(0)) {
    try { await invoke(ctx, TEAM_FUEL_CHANNELS.stop) } catch { /* best-effort */ }
  }
  for (const server of servers) {
    for (const socket of server.clients) socket.terminate()
    await new Promise<void>((resolve) => {
      try { server.close(() => resolve()) } catch { resolve() }
    })
  }
  servers.clear()
  mdns.services = []
  mdns.browsers = []
})
describe('team fuel V1 containment', () => {
  it('rejects oversized raw variants before concatenation or decoding', () => {
    const concat = vi.spyOn(Buffer, 'concat')
    const from = vi.spyOn(Buffer, 'from')
    const decode = vi.spyOn(Buffer.prototype, 'toString')
    try {
      expect(parseWire(Buffer.alloc(8193), HASH)).toBeNull()
      expect(parseWire([Buffer.alloc(4097), Buffer.alloc(4096)], HASH)).toBeNull()
      expect(parseWire(new ArrayBuffer(8193), HASH)).toBeNull()
      expect(parseWire(new Uint8Array(8193), HASH)).toBeNull()
      expect(concat).not.toHaveBeenCalled()
      expect(from).not.toHaveBeenCalled()
      expect(decode).not.toHaveBeenCalled()
    } finally {
      concat.mockRestore()
      from.mockRestore()
      decode.mockRestore()
    }
  })
  it('decodes typed-array and DataView slices using their view bounds', () => {
    const expected = { type: 'challenge', roomHash: HASH, nonce: NONCE } as const
    const message = Buffer.from(JSON.stringify(expected))
    const backing = new Uint8Array(message.byteLength + 8)
    backing.fill('x'.charCodeAt(0))
    backing.set(message, 4)

    expect(parseWire(new Uint8Array(backing.buffer, 4, message.byteLength), HASH)).toEqual(expected)
    expect(parseWire(new DataView(backing.buffer, 4, message.byteLength), HASH)).toEqual(expected)
  })
  it('stops inspecting Buffer arrays after the cumulative limit is exceeded', () => {
    const sentinel = vi.fn(() => Buffer.alloc(1))
    const chunks = [Buffer.alloc(4097), Buffer.alloc(4096), Buffer.alloc(1)]
    Object.defineProperty(chunks, 2, { configurable: true, get: sentinel })

    expect(parseWire(chunks, HASH)).toBeNull()
    expect(sentinel).not.toHaveBeenCalled()
  })
  it('sends no application state to an unauthenticated socket across ticks', async () => {
    const { status } = await start('host')
    const p = probe(status.port as number)
    await challenge(p)
    await sleep(2100)
    expect(p.messages.map((message) => message.type)).toEqual(['challenge'])
  })
  it('sends state after a valid socket-local hello', async () => {
    const { status } = await start('host')
    const p = probe(status.port as number)
    const hello = await challenge(p)
    send(p.ws, { type: 'hello', roomHash: HASH, peerId: 'old-client', auth: createHmac('sha256', KEY).update(hello.nonce as string).digest('hex') })
    await waitUntil(() => p.messages.some((message) => message.type === 'state'))
    expect(p.messages.find((message) => message.type === 'state')?.peer?.driverName).toBe('Host Driver')
  })
  it('ignores pre-auth state and leave without mutating host peers', async () => {
    const { ctx, status } = await start('host')
    const before = await invoke<TeamFuelPeer[]>(ctx, TEAM_FUEL_CHANNELS.state)
    const p = probe(status.port as number)
    await challenge(p)
    send(p.ws, { type: 'state', roomHash: HASH, peer: peer('intruder') })
    send(p.ws, { type: 'leave', roomHash: HASH, peerId: before[0].peerId })
    await sleep(50)
    expect(await invoke<TeamFuelPeer[]>(ctx, TEAM_FUEL_CHANNELS.state)).toEqual(before)
  })
  it('terminates a wrong HMAC immediately without leaking state', async () => {
    const { status } = await start('host')
    const p = probe(status.port as number)
    await challenge(p)
    send(p.ws, { type: 'hello', roomHash: HASH, peerId: 'bad', auth: '00'.repeat(32) })
    await within(p.closed, 1000)
    expect(p.messages.map((message) => message.type)).toEqual(['challenge'])
  })
  it('force-terminates silent and junk handshakes on both roles at the fixed deadline', async () => {
    const { status } = await start('host')
    const silent = probe(status.port as number)
    const junk = probe(status.port as number)
    await Promise.all([challenge(silent), challenge(junk)])
    const junkTimer = setInterval(() => send(junk.ws, '{}'), 200)
    try {
      let joinClosed!: Promise<number>
      const oldHost = await makeServer((socket) => {
        joinClosed = once(socket, 'close').then(([code]) => code as number)
        const timer = setInterval(() => send(socket, '{}'), 200)
        socket.on('close', () => clearInterval(timer))
      })
      await start('join', oldHost.port)
      await waitUntil(() => Boolean(joinClosed))
      await within(Promise.all([silent.closed, junk.closed, joinClosed]), 6500)
      expect([silent.ws.readyState, junk.ws.readyState]).toEqual([WebSocket.CLOSED, WebSocket.CLOSED])
    } finally {
      clearInterval(junkTimer)
    }
  }, 8000)
  it('rejects the 33rd raw socket and reuses a closed slot', async () => {
    const { status } = await start('host')
    const first = Array.from({ length: 32 }, () => probe(status.port as number))
    await Promise.all(first.map((item) => challenge(item)))
    const rejected = probe(status.port as number)
    await within(rejected.closed, 1000)
    first[0].ws.close()
    await within(first[0].closed)
    await sleep(50)
    const replacement = probe(status.port as number)
    await challenge(replacement)
    expect(replacement.messages[0].type).toBe('challenge')
  })
  it('caps forty idle pre-upgrade TCP connections at thirty-two', async () => {
    const { status } = await start('host')
    const idle = Array.from({ length: 40 }, () => tcpProbe(status.port as number))
    await Promise.allSettled(idle.map((item) => item.opened))
    await waitUntil(() => idle.filter((item) => item.socket.destroyed).length >= 8)
    expect(idle.filter((item) => !item.socket.destroyed).length).toBeLessThanOrEqual(32)
  })
  it('expires partial HTTP handshakes, reuses their slots, and still upgrades valid V1 WebSockets', async () => {
    const { status } = await start('host')
    const partial = Array.from({ length: 32 }, () => tcpProbe(
      status.port as number,
      'GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n'
    ))
    await Promise.all(partial.map((item) => item.opened))
    await sleep(200)
    expect(partial.some((item) => item.socket.destroyed)).toBe(false)
    await within(Promise.all(partial.map((item) => item.closed)), 6500)
    const valid = probe(status.port as number)
    const hello = await challenge(valid)
    send(valid.ws, { type: 'hello', roomHash: HASH, peerId: 'after-timeout', auth: createHmac('sha256', KEY).update(hello.nonce as string).digest('hex') })
    await waitUntil(() => valid.messages.some((message) => message.type === 'state'))
    expect(valid.ws.readyState).toBe(WebSocket.OPEN)
  }, 8000)
  it('stops the owned HTTP server and closes pre-upgrade and upgraded sockets', async () => {
    const { ctx, status } = await start('host')
    const raw = tcpProbe(status.port as number, 'GET / HTTP/1.1\r\nHost: localhost\r\n')
    const upgraded = probe(status.port as number)
    await Promise.all([raw.opened, challenge(upgraded)])
    await invoke(ctx, TEAM_FUEL_CHANNELS.stop)
    await Promise.all([within(raw.closed, 1000), within(upgraded.closed, 1000)])
    expect([raw.socket.destroyed, upgraded.ws.readyState]).toEqual([true, WebSocket.CLOSED])
  })
  it('enforces the fragmented 8192-byte payload limit in both directions', async () => {
    const { status } = await start('host')
    const inbound = probe(status.port as number)
    await challenge(inbound)
    send(inbound.ws, 'x'.repeat(5000), { fin: false })
    send(inbound.ws, 'x'.repeat(4000), { fin: true })
    expect(await within(inbound.closed)).toBe(1009)

    let joinClosed!: Promise<number>
    const oldHost = await makeServer((socket) => {
      joinClosed = once(socket, 'close').then(([code]) => code as number)
      send(socket, 'x'.repeat(5000), { fin: false })
      send(socket, 'x'.repeat(4000), { fin: true })
    })
    await start('join', oldHost.port)
    await waitUntil(() => Boolean(joinClosed))
    expect(await within(joinClosed)).toBe(1009)
  })

  it('sends no state or leave before a valid challenge', async () => {
    const received: Wire[] = []
    let closed!: Promise<unknown>
    const oldHost = await makeServer((socket) => {
      closed = once(socket, 'close')
      socket.on('message', (data) => received.push(JSON.parse(data.toString()) as Wire))
    })
    const { ctx } = await start('join', oldHost.port)
    await waitUntil(() => Boolean(closed))
    await sleep(100)
    expect(received).toEqual([])
    await invoke(ctx, TEAM_FUEL_CHANNELS.stop)
    await within(closed)
    expect(received).toEqual([])
  })

  it('answers only one valid repeated challenge and sends leave only once V1-ready', async () => {
    const received: Wire[] = []
    const oldHost = await makeServer((socket) => {
      socket.on('message', (data) => received.push(JSON.parse(data.toString()) as Wire))
      send(socket, { type: 'challenge', roomHash: HASH, nonce: NONCE, extra: true })
      send(socket, { type: 'state', roomHash: HASH, peer: peer('too-early') })
      setTimeout(() => {
        send(socket, { type: 'challenge', roomHash: HASH, nonce: NONCE })
        send(socket, { type: 'challenge', roomHash: HASH, nonce: NONCE })
      }, 20)
    })
    const { ctx } = await start('join', oldHost.port)
    await waitUntil(() => received.filter((message) => message.type === 'state').length === 1)
    await sleep(50)
    expect(received.map((message) => message.type)).toEqual(['hello', 'state'])
    expect((await invoke<TeamFuelPeer[]>(ctx, TEAM_FUEL_CHANNELS.state)).some((item) => item.peerId === 'too-early')).toBe(false)
    await invoke(ctx, TEAM_FUEL_CHANNELS.stop)
    await waitUntil(() => received.some((message) => message.type === 'leave'))
    expect(received.filter((message) => message.type === 'hello')).toHaveLength(1)
  })

  it('uses a fresh reconnect generation and ignores the stale reconnect path', async () => {
    const connections: Array<{ socket: WebSocket; received: Wire[] }> = []
    const oldHost = await makeServer((socket) => {
      const item = { socket, received: [] as Wire[] }
      connections.push(item)
      socket.on('message', (data) => item.received.push(JSON.parse(data.toString()) as Wire))
      send(socket, { type: 'challenge', roomHash: HASH, nonce: NONCE })
    })
    await start('join', oldHost.port)
    await waitUntil(() => connections[0]?.received.some((message) => message.type === 'state'))
    const oldClosed = once(connections[0].socket, 'close')
    connections[0].socket.close()
    await oldClosed
    await sleep(30)
    mdns.browsers[0].callback(mdns.services[0])
    await waitUntil(() => connections[1]?.received.some((message) => message.type === 'state'))
    await sleep(1200)
    expect(connections).toHaveLength(2)
    expect(connections[1].received.slice(0, 2).map((message) => message.type)).toEqual(['hello', 'state'])
  })

  it('preserves old-client/new-host and old-host/new-client challenge-hello-state sequences', async () => {
    const modernHost = await start('host')
    const oldClient = probe(modernHost.status.port as number)
    const challengeMessage = await challenge(oldClient)
    send(oldClient.ws, { type: 'hello', roomHash: HASH, peerId: 'legacy', auth: createHmac('sha256', KEY).update(challengeMessage.nonce as string).digest('hex') })
    const firstTs = Date.now()
    send(oldClient.ws, { type: 'state', roomHash: HASH, peer: peer('legacy', { ts: firstTs }) })
    await sleep(50)
    expect((await invoke<TeamFuelPeer[]>(modernHost.ctx, TEAM_FUEL_CHANNELS.state)).some((item) => item.peerId === 'legacy')).toBe(false)
    send(oldClient.ws, { type: 'state', roomHash: HASH, peer: peer('legacy', { fuelLiters: 19, ts: firstTs + 1 }) })
    await waitUntil(async () => (await invoke<TeamFuelPeer[]>(modernHost.ctx, TEAM_FUEL_CHANNELS.state)).some((item) => item.peerId === 'legacy'))
    expect((await invoke<TeamFuelPeer[]>(modernHost.ctx, TEAM_FUEL_CHANNELS.state)).find((item) => item.peerId === 'legacy')).toMatchObject({
      fuelLiters: 19,
      sessionUniqueId: 7,
      local: false
    })

    const legacyReceived: Wire[] = []
    const oldHost = await makeServer((socket) => {
      socket.on('message', (data) => legacyReceived.push(JSON.parse(data.toString()) as Wire))
      send(socket, { type: 'challenge', roomHash: HASH, nonce: NONCE })
    })
    await start('join', oldHost.port)
    await waitUntil(() => legacyReceived.some((message) => message.type === 'state'))
    expect(oldClient.messages.some((message) => message.type === 'state')).toBe(true)
    expect(legacyReceived.slice(0, 2).map((message) => message.type)).toEqual(['hello', 'state'])
  })

  it('keeps sessionless legacy peers on probation for identical or older timestamps', async () => {
    const { ctx, status } = await start('host')
    const legacy = probe(status.port as number)
    const challengeMessage = await challenge(legacy)
    send(legacy.ws, {
      type: 'hello',
      roomHash: HASH,
      peerId: 'legacy-probation',
      auth: createHmac('sha256', KEY).update(challengeMessage.nonce as string).digest('hex')
    })
    const ts = Date.now()
    send(legacy.ws, { type: 'state', roomHash: HASH, peer: peer('legacy-probation', { ts }) })
    send(legacy.ws, { type: 'state', roomHash: HASH, peer: peer('legacy-probation', { fuelLiters: 18, ts }) })
    send(legacy.ws, { type: 'state', roomHash: HASH, peer: peer('legacy-probation', { fuelLiters: 17, ts: ts - 1 }) })
    await sleep(50)

    expect((await invoke<TeamFuelPeer[]>(ctx, TEAM_FUEL_CHANNELS.state)).some((item) => item.peerId === 'legacy-probation')).toBe(false)
  })
})
