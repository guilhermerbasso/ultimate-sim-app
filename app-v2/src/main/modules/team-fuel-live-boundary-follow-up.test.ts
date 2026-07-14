import { createHash, createHmac } from 'node:crypto'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import { TEAM_FUEL_CHANNELS, type TeamFuelPeer } from '../../shared/team-fuel'
import type { ReplayContext, ReplayContextState } from '../../shared/replay'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { ModuleContext } from '../module-context'

const mdns = vi.hoisted(() => ({
  services: [] as Array<Record<string, unknown>>
}))

vi.mock('bonjour-service', () => ({
  default: class {
    publish(): { stop: () => void } {
      return { stop: () => undefined }
    }

    find(): { services: Array<Record<string, unknown>>; stop: () => void } {
      return { services: [...mdns.services], stop: () => undefined }
    }

    destroy(callback: () => void): void {
      callback()
    }
  }
}))

import { TeamFuelController } from './team-fuel'

const ROOM_KEY = 'boundary-room'
const ROOM_HASH = createHash('sha256').update(ROOM_KEY).digest('hex').slice(0, 16)

interface WireMessage {
  type?: string
  nonce?: string
  peer?: TeamFuelPeer
}

interface ControllerHarness {
  controller: TeamFuelController
  broadcast: ReturnType<typeof vi.fn>
  emit(snapshot: TelemetrySnapshot): void
}

interface Probe {
  socket: WebSocket
  messages: WireMessage[]
}

const controllers = new Set<TeamFuelController>()
const sockets = new Set<WebSocket>()
const servers = new Set<WebSocketServer>()

function replayContext(
  state: ReplayContextState,
  revision: number,
  sessionIdentity: string,
  connectionEpoch: number
): ReplayContext {
  const reason = state === 'live' ? 'confirmed-live' : state === 'replay' ? 'replay-playing' : 'missing-metadata'
  return {
    state,
    reason,
    inputs: {},
    active: state !== 'live',
    revision,
    token: `${connectionEpoch}:${revision}`,
    sessionIdentity,
    connectionEpoch
  }
}

function snapshot(
  state: ReplayContextState,
  revision: number,
  sessionIdentity: string,
  connectionEpoch: number,
  overrides: Partial<TelemetrySnapshot> = {}
): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1_000 + revision * 100,
    speedKmh: 180,
    rpm: 7_000,
    gear: 4,
    throttle: 0.8,
    brake: 0,
    clutch: 0,
    sessionType: 'Race',
    sessionUniqueId: 11,
    driverName: 'Local A',
    fuelLiters: 40,
    fuelPerLap: 2.5,
    lapsRemaining: 16,
    replayContext: replayContext(state, revision, sessionIdentity, connectionEpoch),
    ...overrides
  }
}

function harness(initial: TelemetrySnapshot): ControllerHarness {
  let latest = initial
  let listener: ((snapshot: TelemetrySnapshot | null) => void) | undefined
  const broadcast = vi.fn()
  const ctx = {
    telemetryHub: {
      getLatest: () => latest,
      on: (_event: string, next: (snapshot: TelemetrySnapshot | null) => void) => {
        listener = next
      }
    },
    broadcast
  } as unknown as ModuleContext
  const controller = new TeamFuelController(ctx)
  controllers.add(controller)
  return {
    controller,
    broadcast,
    emit(next) {
      latest = next
      listener?.(next)
    }
  }
}

async function startHost(test: ControllerHarness): Promise<number> {
  const status = await test.controller.start({ mode: 'host', roomKey: ROOM_KEY })
  return status.port as number
}

function addRemotePeer(controller: TeamFuelController, peerId = 'remote-a'): void {
  const peers = (controller as unknown as { peers: Map<string, TeamFuelPeer> }).peers
  peers.set(peerId, {
    peerId,
    driverName: 'Remote A',
    sessionUniqueId: 11,
    fuelLiters: 15,
    ts: Date.now(),
    local: false
  })
}

function expectOnlyCurrentLocal(controller: TeamFuelController, sessionUniqueId: number, fuelLiters: number): void {
  expect(controller.peersList()).toEqual([
    expect.objectContaining({
      driverName: 'Local B',
      sessionUniqueId,
      fuelLiters,
      local: true
    })
  ])
}

async function waitUntil(check: () => boolean, timeout = 2_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition')
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
}

async function connectAndAuthenticate(port: number, peerId: string): Promise<Probe> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`)
  sockets.add(socket)
  const messages: WireMessage[] = []
  socket.on('message', (data) => {
    messages.push(JSON.parse(data.toString()) as WireMessage)
  })
  socket.on('error', () => undefined)
  await new Promise<void>((resolve) => socket.once('open', resolve))
  await waitUntil(() => messages.some((message) => message.type === 'challenge'))
  const nonce = messages.find((message) => message.type === 'challenge')?.nonce as string
  socket.send(JSON.stringify({
    type: 'hello',
    roomHash: ROOM_HASH,
    peerId,
    auth: createHmac('sha256', ROOM_KEY).update(nonce).digest('hex')
  }))
  return { socket, messages }
}

function peerState(peerId: string, sessionUniqueId = 11): Record<string, unknown> {
  return {
    type: 'state',
    roomHash: ROOM_HASH,
    peer: {
      peerId,
      driverName: 'Remote A',
      sessionUniqueId,
      fuelLiters: 15,
      ts: Date.now()
    }
  }
}

function legacyPeerState(peerId: string, ts: number): Record<string, unknown> {
  return {
    type: 'state',
    roomHash: ROOM_HASH,
    peer: {
      peerId,
      driverName: 'Legacy Remote',
      fuelLiters: 15,
      ts
    }
  }
}

function sendPeerState(probe: Probe, peerId: string, sessionUniqueId = 11): void {
  probe.socket.send(JSON.stringify(peerState(peerId, sessionUniqueId)))
}

function sendPeerStateWithoutSession(probe: Probe, peerId: string, ts = Date.now()): void {
  probe.socket.send(JSON.stringify(legacyPeerState(peerId, ts)))
}

async function makeServer(onConnection: (socket: WebSocket) => void): Promise<{ server: WebSocketServer; port: number }> {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  servers.add(server)
  server.on('connection', onConnection)
  await once(server, 'listening')
  return { server, port: (server.address() as AddressInfo).port }
}

function service(port: number): Record<string, unknown> {
  return {
    port,
    addresses: ['127.0.0.1'],
    txt: { room: ROOM_HASH, version: '1' }
  }
}

function protocolHost(
  connections: WebSocket[],
  stateForConnection: (index: number) => Record<string, unknown> = () => peerState('remote-a')
): (socket: WebSocket) => void {
  return (socket) => {
    const index = connections.length
    connections.push(socket)
    socket.send(JSON.stringify({
      type: 'challenge',
      roomHash: ROOM_HASH,
      nonce: 'ab'.repeat(24)
    }))
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as WireMessage
      if (message.type === 'hello') socket.send(JSON.stringify(stateForConnection(index)))
    })
  }
}

function emitDelayedState(socket: WebSocket, peerId: string): void {
  socket.emit('message', Buffer.from(JSON.stringify(peerState(peerId))), false)
}

function currentServerSocket(controller: TeamFuelController): WebSocket {
  const server = (controller as unknown as { server: WebSocketServer }).server
  return [...server.clients][0] as WebSocket
}

function tick(controller: TeamFuelController): void {
  ;(controller as unknown as { tick(): void }).tick()
}

function liveGeneration(controller: TeamFuelController): number {
  return (controller as unknown as { liveGeneration: number }).liveGeneration
}

function sparseLiveB(): TelemetrySnapshot {
  return snapshot('live', 1, 'live-b', 1, {
    sessionUniqueId: undefined,
    driverName: undefined,
    fuelLiters: undefined,
    fuelPerLap: undefined,
    lapsRemaining: undefined
  })
}

function closeEvent(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => socket.once('close', () => resolve()))
}

afterEach(async () => {
  for (const socket of sockets) {
    if (socket.readyState !== WebSocket.CLOSED) {
      try {
        socket.terminate()
      } catch {
        // best-effort cleanup
      }
    }
  }
  sockets.clear()
  for (const controller of controllers) await controller.stop()
  controllers.clear()
  for (const server of servers) {
    for (const socket of server.clients) socket.terminate()
    await new Promise<void>((resolve) => {
      try {
        server.close(() => resolve())
      } catch {
        resolve()
      }
    })
  }
  servers.clear()
  mdns.services = []
})

describe('team fuel canonical live boundaries', () => {
  it.each([
    ['session identity', snapshot('live', 1, 'live-b', 1, {
      sessionUniqueId: 22,
      driverName: 'Local B',
      fuelLiters: 30
    })],
    ['connection epoch', snapshot('live', 1, 'live-a', 2, {
      sessionUniqueId: 22,
      driverName: 'Local B',
      fuelLiters: 30
    })]
  ])('clears remote peers and immediately seeds the current local peer on %s change', async (_name, next) => {
    const test = harness(snapshot('live', 0, 'live-a', 1))
    await startHost(test)
    addRemotePeer(test.controller)
    test.broadcast.mockClear()

    test.emit(next)

    expectOnlyCurrentLocal(test.controller, 22, 30)
    expect(test.broadcast).toHaveBeenLastCalledWith(
      TEAM_FUEL_CHANNELS.updated,
      [expect.objectContaining({ sessionUniqueId: 22, local: true })]
    )
  })

  it('keeps replay isolated and immediately seeds the same live context on resume', async () => {
    const test = harness(snapshot('live', 0, 'live-a', 1))
    await startHost(test)
    addRemotePeer(test.controller)

    test.emit(snapshot('replay', 1, 'live-a', 1, {
      sessionUniqueId: 99,
      driverName: 'Replay Driver',
      fuelLiters: 1
    }))
    expect(test.controller.peersList()).toEqual([])

    test.emit(snapshot('live', 2, 'live-a', 1, {
      sessionUniqueId: 11,
      driverName: 'Local B',
      fuelLiters: 35
    }))

    expectOnlyCurrentLocal(test.controller, 11, 35)
  })

  it('keeps stopped controllers empty across boundaries and ticks', () => {
    const test = harness(snapshot('live', 0, 'live-a', 1))
    test.broadcast.mockClear()
    const initialGeneration = liveGeneration(test.controller)

    tick(test.controller)
    test.emit(snapshot('replay', 1, 'live-a', 1))
    test.emit(snapshot('unknown', 2, 'live-a', 1))
    test.emit(snapshot('live', 3, 'live-b', 1, {
      sessionUniqueId: 22,
      driverName: 'Local B',
      fuelLiters: 30
    }))
    tick(test.controller)

    expect(test.controller.peersList()).toEqual([])
    expect(test.broadcast).not.toHaveBeenCalled()
    expect(liveGeneration(test.controller)).toBe(initialGeneration + 3)
  })

  it('publishes an empty reset instead of reusing sparse live-B metadata from live A', async () => {
    const test = harness(snapshot('live', 0, 'live-a', 1))
    const port = await startHost(test)
    expect(test.controller.peersList()[0]).toMatchObject({
      driverName: 'Local A',
      sessionUniqueId: 11,
      fuelLiters: 40
    })
    test.broadcast.mockClear()

    test.emit(sparseLiveB())
    tick(test.controller)
    const client = await connectAndAuthenticate(port, 'remote-b')
    sendPeerState(client, 'remote-b')
    await new Promise<void>((resolve) => setTimeout(resolve, 50))

    expect(test.controller.peersList()).toEqual([])
    expect(test.broadcast).toHaveBeenLastCalledWith(TEAM_FUEL_CHANNELS.updated, [])
  })

  it('closes old V1 sockets, rejects delayed live-A packets, and reauthenticates cleanly', async () => {
    const test = harness(snapshot('live', 0, 'live-a', 1))
    const port = await startHost(test)
    const oldClient = await connectAndAuthenticate(port, 'remote-a')
    await waitUntil(() => oldClient.messages.some((message) => message.type === 'state'))
    sendPeerState(oldClient, 'remote-a')
    await waitUntil(() => test.controller.peersList().some((peer) => peer.peerId === 'remote-a'))
    const oldServerSocket = currentServerSocket(test.controller)
    const oldClientClosed = closeEvent(oldClient.socket)

    test.emit(snapshot('live', 1, 'live-b', 1, {
      sessionUniqueId: 22,
      driverName: 'Local B',
      fuelLiters: 30
    }))
    await oldClientClosed
    expectOnlyCurrentLocal(test.controller, 22, 30)

    emitDelayedState(oldServerSocket, 'remote-a')
    expectOnlyCurrentLocal(test.controller, 22, 30)

    const client = await connectAndAuthenticate(port, 'new-client')
    await waitUntil(() => client.messages.some((message) => message.type === 'state'))
    const returnedPeers = client.messages
      .filter((message) => message.type === 'state')
      .map((message) => message.peer as TeamFuelPeer)

    expect(returnedPeers).not.toEqual([])
    expect(returnedPeers.every((peer) =>
      peer.local === true &&
      peer.driverName === 'Local B' &&
      peer.sessionUniqueId === 22 &&
      peer.peerId !== 'remote-a'
    )).toBe(true)

    sendPeerStateWithoutSession(client, 'new-client')
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
    expect(test.controller.peersList().some((peer) => peer.peerId === 'new-client')).toBe(false)

    sendPeerState(client, 'new-client', 11)
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
    expect(test.controller.peersList().some((peer) => peer.peerId === 'new-client')).toBe(false)

    sendPeerState(client, 'new-client', 22)
    await waitUntil(() => test.controller.peersList().some((peer) => peer.peerId === 'new-client'))
    expect(test.controller.peersList().find((peer) => peer.peerId === 'new-client')).toMatchObject({
      sessionUniqueId: 22,
      local: false
    })

    const legacyClient = await connectAndAuthenticate(port, 'legacy-client')
    await waitUntil(() => legacyClient.messages.some((message) => message.type === 'state'))
    const legacyTs = Date.now()
    sendPeerStateWithoutSession(legacyClient, 'legacy-client', legacyTs)
    sendPeerStateWithoutSession(legacyClient, 'legacy-client', legacyTs)
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
    expect(test.controller.peersList().some((peer) => peer.peerId === 'legacy-client')).toBe(false)

    sendPeerStateWithoutSession(legacyClient, 'legacy-client', legacyTs + 1)
    await waitUntil(() => test.controller.peersList().some((peer) => peer.peerId === 'legacy-client'))
    expect(test.controller.peersList().find((peer) => peer.peerId === 'legacy-client')).toMatchObject({
      sessionUniqueId: 22,
      local: false
    })
  })

  it('clears client-side remote peers when the authenticated transport disconnects', async () => {
    const connections: WebSocket[] = []
    const remote = await makeServer(protocolHost(connections))
    mdns.services = [service(remote.port)]
    const test = harness(snapshot('live', 0, 'live-a', 1))
    await test.controller.start({ mode: 'join', roomKey: ROOM_KEY })
    await waitUntil(() => test.controller.peersList().some((peer) => peer.peerId === 'remote-a'))

    const disconnected = closeEvent(connections[0])
    connections[0].close()
    await disconnected
    await waitUntil(() => !test.controller.peersList().some((peer) => peer.peerId === 'remote-a'))

    expect(test.controller.peersList()).toEqual([
      expect.objectContaining({ driverName: 'Local A', local: true })
    ])
  })

  it('rejects cached live-A state after the client reconnects in live B', async () => {
    const connections: WebSocket[] = []
    const reconnectTs = Date.now()
    const remote = await makeServer(protocolHost(
      connections,
      (index) => index === 0
        ? peerState('remote-a', 11)
        : legacyPeerState('remote-b', reconnectTs)
    ))
    mdns.services = [service(remote.port)]
    const test = harness(snapshot('live', 0, 'live-a', 1))
    await test.controller.start({ mode: 'join', roomKey: ROOM_KEY })
    await waitUntil(() => test.controller.peersList().some((peer) => peer.peerId === 'remote-a'))
    const disconnected = closeEvent(connections[0])

    test.emit(snapshot('live', 1, 'live-b', 1, {
      sessionUniqueId: 22,
      driverName: 'Local B',
      fuelLiters: 30
    }))
    await disconnected

    expectOnlyCurrentLocal(test.controller, 22, 30)
    await waitUntil(() => connections.length === 2, 2_500)
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
    expectOnlyCurrentLocal(test.controller, 22, 30)

    connections[1].send(JSON.stringify(legacyPeerState('remote-b', reconnectTs)))
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
    expectOnlyCurrentLocal(test.controller, 22, 30)

    connections[1].send(JSON.stringify(legacyPeerState('remote-b', reconnectTs + 1)))
    await waitUntil(() => test.controller.peersList().some((peer) => peer.peerId === 'remote-b'))
    expect(test.controller.peersList().find((peer) => peer.peerId === 'remote-b')).toMatchObject({
      sessionUniqueId: 22,
      local: false
    })
  })
})
