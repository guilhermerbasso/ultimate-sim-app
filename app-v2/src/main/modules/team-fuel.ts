import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import Bonjour, { type Browser, type Service } from 'bonjour-service'
import WebSocket, { WebSocketServer } from 'ws'
import type { RawData } from 'ws'
import type { TeamFuelMode, TeamFuelPeer, TeamFuelPitWindow, TeamFuelStartArgs, TeamFuelStatus } from '../../shared/team-fuel'
import { TEAM_FUEL_CHANNELS } from '../../shared/team-fuel'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { ModuleContext } from '../module-context'
import { captureLiveTelemetryContext, isLiveTelemetrySnapshot, LiveTelemetryGate } from '../../shared/replay'

const SERVICE_TYPE = 'usateamfuel'
const PROTOCOL_VERSION = '1'
const BROADCAST_INTERVAL_MS = 1000
const STALE_PEER_MS = 15_000
const MAX_MESSAGE_BYTES = 8192
const MAX_PEERS = 32
const MAX_RAW_SOCKETS = 32
const MAX_FUTURE_SKEW_MS = 5000
const HANDSHAKE_DEADLINE_MS = 5000
const RECONNECT_BACKOFF_MS = 1000

interface WireChallenge {
  type: 'challenge'
  roomHash: string
  nonce: string
}

interface WireHello {
  type: 'hello'
  roomHash: string
  peerId: string
  auth: string
}

interface WireState {
  type: 'state'
  roomHash: string
  peer: TeamFuelPeer
}

interface WireLeave {
  type: 'leave'
  roomHash: string
  peerId: string
}

type WireMessage = WireChallenge | WireHello | WireState | WireLeave

type ClientPhase = 'connecting' | 'helloSent' | 'v1Ready'
interface LegacyPeerProbation {
  liveGeneration: number
  lastTs: number
  admitted: boolean
}

type PeerSocket = WebSocket & {
  teamFuelAuthed?: boolean
  teamFuelPeerId?: string
  teamFuelNonce?: string
  teamFuelPhase?: ClientPhase
  teamFuelGeneration?: number
  teamFuelLiveGeneration?: number
  teamFuelHandshakeTimer?: ReturnType<typeof setTimeout>
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function optionalFinite(value: unknown): value is number | undefined {
  return value === undefined || finite(value)
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function hasOnlyKeys(value: unknown, required: string[], optional: string[] = []): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.hasOwn(item, key)) && Object.keys(item).every((key) => allowed.has(key))
}

function sanitizeString(value: string, fallback: string, maxLength = 80): string {
  const trimmed = value.trim()
  return (trimmed.length > 0 ? trimmed : fallback).slice(0, maxLength)
}

function roomHash(roomKey: string): string {
  return createHash('sha256').update(roomKey.trim(), 'utf8').digest('hex').slice(0, 16)
}

function authHmac(roomKey: string, nonce: string): string {
  return createHmac('sha256', roomKey).update(nonce, 'utf8').digest('hex')
}

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  return left.length === right.length && timingSafeEqual(left, right)
}

function readTxt(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  if (Array.isArray(value) && value.length > 0) return readTxt(value[0])
  return undefined
}

function serviceRoomHash(service: Service): string | undefined {
  const txt = service.txt as Record<string, unknown> | undefined
  return readTxt(txt?.room)
}

function serviceVersion(service: Service): string | undefined {
  const txt = service.txt as Record<string, unknown> | undefined
  return readTxt(txt?.version)
}

function serviceAddress(service: Service): string | undefined {
  const addresses = service.addresses ?? []
  return addresses.find((address) => /^\d+\.\d+\.\d+\.\d+$/.test(address)) ?? addresses[0] ?? service.referer?.address
}

function isPitWindow(value: unknown): value is TeamFuelPitWindow {
  if (value === undefined) return true
  if (!hasOnlyKeys(value, [], ['latestLap', 'lapsUntilPit', 'status'])) return false
  const item = value as Record<string, unknown>
  const status = item.status
  return optionalFinite(item.latestLap) && optionalFinite(item.lapsUntilPit) && (status === undefined || status === 'unknown' || status === 'safe' || status === 'save' || status === 'pit-required' || status === 'critical')
}

function isPeer(value: unknown): value is TeamFuelPeer {
  if (!hasOnlyKeys(value, ['peerId', 'driverName', 'ts'], [
    'custId', 'sessionUniqueId', 'fuelLiters', 'fuelPerLap', 'lapsRemaining',
    'stintTargetLaps', 'pitWindow', 'local'
  ])) return false
  const item = value as Record<string, unknown>
  return typeof item.peerId === 'string' && item.peerId.length > 0 && item.peerId.length <= 80 &&
    typeof item.driverName === 'string' && item.driverName.length > 0 && item.driverName.length <= 120 &&
    optionalFinite(item.custId) && optionalFinite(item.sessionUniqueId) && optionalFinite(item.fuelLiters) &&
    optionalFinite(item.fuelPerLap) && optionalFinite(item.lapsRemaining) && optionalFinite(item.stintTargetLaps) &&
    finite(item.ts) && item.ts > 0 && item.ts <= Date.now() + MAX_FUTURE_SKEW_MS && isPitWindow(item.pitWindow) &&
    (item.local === undefined || typeof item.local === 'boolean')
}

type WireRawData = RawData | ArrayBufferView | string

function rawDataByteLength(data: WireRawData): number {
  if (typeof data === 'string') return Buffer.byteLength(data)
  if (!Array.isArray(data)) return data.byteLength
  let bytes = 0
  for (const chunk of data) {
    bytes += chunk.byteLength
    if (bytes > MAX_MESSAGE_BYTES) break
  }
  return bytes
}

export function parseWire(data: WireRawData, expectedRoomHash: string): WireMessage | null {
  const bytes = rawDataByteLength(data)
  if (bytes === 0 || bytes > MAX_MESSAGE_BYTES) return null
  try {
    const raw = typeof data === 'string'
      ? data
      : Buffer.isBuffer(data)
        ? data.toString('utf8')
        : Array.isArray(data)
          ? Buffer.concat(data, bytes).toString('utf8')
          : ArrayBuffer.isView(data)
            ? Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8')
            : Buffer.from(data).toString('utf8')
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!hasOnlyKeys(parsed, ['type', 'roomHash'], ['nonce', 'peerId', 'auth', 'peer'])) return null
    if (parsed.roomHash !== expectedRoomHash) return null
    if (parsed.type === 'challenge' && hasOnlyKeys(parsed, ['type', 'roomHash', 'nonce']) &&
      typeof parsed.nonce === 'string' && /^[a-f0-9]{32,128}$/i.test(parsed.nonce)) {
      return { type: 'challenge', roomHash: expectedRoomHash, nonce: parsed.nonce }
    }
    if (parsed.type === 'hello' && hasOnlyKeys(parsed, ['type', 'roomHash', 'peerId', 'auth']) &&
      typeof parsed.peerId === 'string' && parsed.peerId.length > 0 && parsed.peerId.length <= 80 &&
      typeof parsed.auth === 'string' && /^[a-f0-9]{64}$/i.test(parsed.auth)) {
      return { type: 'hello', roomHash: expectedRoomHash, peerId: parsed.peerId, auth: parsed.auth }
    }
    if (parsed.type === 'state' && hasOnlyKeys(parsed, ['type', 'roomHash', 'peer']) && isPeer(parsed.peer)) {
      return { type: 'state', roomHash: expectedRoomHash, peer: parsed.peer }
    }
    if (parsed.type === 'leave' && hasOnlyKeys(parsed, ['type', 'roomHash', 'peerId']) &&
      typeof parsed.peerId === 'string' && parsed.peerId.length > 0 && parsed.peerId.length <= 80) {
      return { type: 'leave', roomHash: expectedRoomHash, peerId: parsed.peerId }
    }
  } catch {
    return null
  }
  return null
}

function send(ws: WebSocket, message: WireMessage): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false
  try {
    ws.send(JSON.stringify(message))
    return true
  } catch {
    return false
  }
}

function clearHandshakeDeadline(socket: PeerSocket): void {
  if (!socket.teamFuelHandshakeTimer) return
  clearTimeout(socket.teamFuelHandshakeTimer)
  delete socket.teamFuelHandshakeTimer
}

function forceTerminate(socket: WebSocket): void {
  try { socket.terminate() } catch { /* best-effort */ }
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function firstFinite(...values: Array<number | undefined>): number | undefined {
  return values.find((value) => finite(value))
}

function localCustId(snapshot: TelemetrySnapshot | null): number | undefined {
  return snapshot?.drivers?.find((driver) => driver.isPlayer)?.custId
}

function telemetryForGate(snapshot: TelemetrySnapshot | null): TelemetrySnapshot | null {
  if (snapshot && (snapshot as { connected?: boolean }).connected === undefined) {
    return { ...snapshot, connected: true }
  }
  return snapshot
}

function peersEqual(a: TeamFuelPeer | undefined, b: TeamFuelPeer): boolean {
  return a?.peerId === b.peerId && a.driverName === b.driverName && a.custId === b.custId &&
    a.sessionUniqueId === b.sessionUniqueId && a.fuelLiters === b.fuelLiters &&
    a.fuelPerLap === b.fuelPerLap && a.lapsRemaining === b.lapsRemaining &&
    a.stintTargetLaps === b.stintTargetLaps && a.ts === b.ts && a.local === b.local &&
    a.pitWindow?.latestLap === b.pitWindow?.latestLap &&
    a.pitWindow?.lapsUntilPit === b.pitWindow?.lapsUntilPit &&
    a.pitWindow?.status === b.pitWindow?.status
}

function validSessionUniqueId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function peerMatchesLocalSession(local: TeamFuelPeer | undefined, remote: TeamFuelPeer): boolean {
  return local?.local === true &&
    validSessionUniqueId(local.sessionUniqueId) &&
    validSessionUniqueId(remote.sessionUniqueId) &&
    remote.sessionUniqueId === local.sessionUniqueId
}

export class TeamFuelController {
  private readonly ctx: ModuleContext
  private readonly liveGate = new LiveTelemetryGate()
  private readonly peerId = randomUUID()
  private peers = new Map<string, TeamFuelPeer>()
  private state: TeamFuelStatus['state'] = 'stopped'
  private mode: TeamFuelMode | undefined
  private hash: string | undefined
  private roomKey: string | undefined
  private configuredDriverName: string | undefined
  private bonjour: Bonjour | null = null
  private service: Service | null = null
  private browser: Browser | null = null
  private server: WebSocketServer | null = null
  private httpServer: HttpServer | null = null
  private rawSockets = new Set<Duplex>()
  private rawSocketDeadlines = new Map<Duplex, ReturnType<typeof setTimeout>>()
  private client: WebSocket | null = null
  private clientGeneration = 0
  private lastService: Service | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private error: string | undefined
  private liveContextActive = false
  private liveGeneration = 0
  private legacyProbations = new Map<PeerSocket, Map<string, LegacyPeerProbation>>()

  constructor(ctx: ModuleContext) {
    this.ctx = ctx
    const initial = this.liveGate.observe(telemetryForGate(ctx.telemetryHub.getLatest()))
    this.liveContextActive = initial.live
    if (initial.boundary) this.liveGeneration += 1
    ctx.telemetryHub.on?.('snapshot', (snapshot) => this.onTelemetry(snapshot))
  }

  async start(args: TeamFuelStartArgs): Promise<TeamFuelStatus> {
    await this.stop()
    const normalizedKey = typeof args.roomKey === 'string' ? args.roomKey.trim() : ''
    if (!normalizedKey) {
      this.state = 'error'
      this.error = 'Room key is required.'
      return this.status()
    }

    this.mode = args.mode === 'host' ? 'host' : 'join'
    this.roomKey = normalizedKey
    this.hash = roomHash(normalizedKey)
    const requestedDriverName = typeof args.driverName === 'string' ? args.driverName.trim() : ''
    this.configuredDriverName = requestedDriverName
      ? sanitizeString(requestedDriverName, 'Driver')
      : undefined
    this.state = this.mode === 'host' ? 'hosting' : 'joining'
    this.error = undefined
    this.peers.clear()
    this.updateLocalPeer(this.ctx.telemetryHub.getLatest())

    try {
      this.bonjour = new Bonjour(undefined, () => undefined)
      if (this.mode === 'host') await this.startHost()
      else this.startJoin()
      this.timer = setInterval(() => this.tick(), BROADCAST_INTERVAL_MS)
      this.broadcastPeers()
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      this.state = 'error'
      await this.disposeNetwork()
      this.broadcastPeers()
    }
    return this.status()
  }

  async stop(): Promise<TeamFuelPeer[]> {
    if (this.hash) this.sendLeave()
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.state = 'stopped'
    this.clearReconnectTimer()
    await this.disposeNetwork()
    this.peers.clear()
    this.mode = undefined
    this.hash = undefined
    this.roomKey = undefined
    this.configuredDriverName = undefined
    this.error = undefined
    this.ctx.broadcast(TEAM_FUEL_CHANNELS.updated, [])
    return []
  }

  status(): TeamFuelStatus {
    return {
      state: this.state,
      mode: this.mode,
      roomHash: this.hash,
      port: this.serverPort(),
      peers: this.peersList(),
      error: this.error
    }
  }

  peersList(): TeamFuelPeer[] {
    return [...this.peers.values()].sort((a, b) => (b.local ? 1 : 0) - (a.local ? 1 : 0) || a.driverName.localeCompare(b.driverName))
  }

  private isActive(): boolean {
    return this.state === 'hosting' || this.state === 'joining' || this.state === 'connected'
  }

  private async startHost(): Promise<void> {
    if (!this.hash || !this.bonjour) return
    const wsServer = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES })
    const httpServer = createServer({
      headersTimeout: HANDSHAKE_DEADLINE_MS,
      requestTimeout: HANDSHAKE_DEADLINE_MS,
      keepAliveTimeout: HANDSHAKE_DEADLINE_MS
    }, (_request, response) => {
      response.writeHead(426, { Connection: 'close' })
      response.end()
    })
    this.server = wsServer
    this.httpServer = httpServer
    wsServer.on('connection', (socket) => this.handleServerConnection(socket as PeerSocket))
    wsServer.on('error', (error) => {
      if (this.server !== wsServer) return
      this.error = error.message
      this.state = 'error'
      this.broadcastPeers()
    })
    httpServer.on('connection', (socket) => this.trackRawSocket(socket))
    httpServer.on('clientError', (_error, socket) => this.destroyRawSocket(socket))
    httpServer.on('upgrade', (request, socket, head) => {
      if (this.httpServer !== httpServer || this.server !== wsServer || !this.rawSockets.has(socket)) {
        this.destroyRawSocket(socket)
        return
      }
      try {
        wsServer.handleUpgrade(request, socket, head, (webSocket) => {
          this.clearRawSocketDeadline(socket)
          wsServer.emit('connection', webSocket, request)
        })
      } catch {
        this.destroyRawSocket(socket)
      }
    })
    httpServer.on('error', (error) => {
      if (this.httpServer !== httpServer) return
      this.error = error.message
      this.state = 'error'
      this.broadcastPeers()
    })
    await new Promise<void>((resolve, reject) => {
      httpServer.once('listening', resolve)
      httpServer.once('error', reject)
      httpServer.listen(0, '0.0.0.0')
    })
    const port = this.serverPort()
    if (!port) throw new Error('WebSocket server did not expose a port.')
    this.service = this.bonjour.publish({
      name: `Ultimate Sim Team Fuel ${this.hash}`,
      type: SERVICE_TYPE,
      protocol: 'tcp',
      port,
      txt: { room: this.hash, version: PROTOCOL_VERSION }
    })
  }

  private startJoin(): void {
    if (!this.hash || !this.bonjour) return
    this.browser = this.bonjour.find({ type: SERVICE_TYPE, protocol: 'tcp' }, (service) => this.maybeConnect(service))
    for (const service of this.browser.services) this.maybeConnect(service)
  }

  private maybeConnect(service: Service): void {
    if (!this.hash || !this.roomKey || this.client?.readyState === WebSocket.OPEN || this.client?.readyState === WebSocket.CONNECTING) return
    if (serviceRoomHash(service) !== this.hash || serviceVersion(service) !== PROTOCOL_VERSION) return
    const address = serviceAddress(service)
    if (!address || !service.port) return
    this.lastService = service
    this.clearReconnectTimer()
    const generation = ++this.clientGeneration
    try {
      const ws = new WebSocket(`ws://${address}:${service.port}`, { maxPayload: MAX_MESSAGE_BYTES }) as PeerSocket
      ws.teamFuelGeneration = generation
      ws.teamFuelLiveGeneration = this.liveGeneration
      ws.teamFuelPhase = 'connecting'
      this.resetLegacyProbation(ws)
      this.client = ws
      ws.teamFuelHandshakeTimer = setTimeout(() => this.handleClientTimeout(ws, generation), HANDSHAKE_DEADLINE_MS)
      ws.on('open', () => {
        if (this.isCurrentClient(ws, generation)) this.broadcastPeers()
      })
      ws.on('message', (data) => this.handleClientMessage(ws, generation, data))
      ws.on('close', () => this.handleClientClose(ws, generation))
      ws.on('error', () => undefined)
    } catch {
      // Off-LAN or blocked mDNS/socket should not crash the app.
      this.scheduleReconnect(generation)
    }
  }

  private scheduleReconnect(generation = this.clientGeneration): void {
    if (this.state === 'stopped' || this.mode !== 'join' || !this.lastService || this.reconnectTimer ||
      generation !== this.clientGeneration) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.state === 'stopped' || this.mode !== 'join' || !this.lastService ||
        generation !== this.clientGeneration) return
      this.maybeConnect(this.lastService)
    }, RECONNECT_BACKOFF_MS)
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private trackRawSocket(socket: Duplex): void {
    socket.on('error', () => undefined)
    if (this.rawSockets.size >= MAX_RAW_SOCKETS) {
      socket.destroy()
      return
    }
    this.rawSockets.add(socket)
    this.rawSocketDeadlines.set(socket, setTimeout(() => this.destroyRawSocket(socket), HANDSHAKE_DEADLINE_MS))
    socket.once('close', () => this.releaseRawSocket(socket))
  }

  private clearRawSocketDeadline(socket: Duplex): void {
    const timer = this.rawSocketDeadlines.get(socket)
    if (timer) clearTimeout(timer)
    this.rawSocketDeadlines.delete(socket)
  }

  private releaseRawSocket(socket: Duplex): void {
    this.clearRawSocketDeadline(socket)
    this.rawSockets.delete(socket)
  }

  private destroyRawSocket(socket: Duplex): void {
    this.releaseRawSocket(socket)
    if (!socket.destroyed) socket.destroy()
  }

  private closePeerSocket(socket: PeerSocket): Promise<void> {
    clearHandshakeDeadline(socket)
    if (socket.readyState === WebSocket.CLOSED) return Promise.resolve()
    return new Promise((resolve) => {
      let settled = false
      const done = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        forceTerminate(socket)
        done()
      }, 250)
      socket.once('close', done)
      try { socket.close() } catch { forceTerminate(socket); done() }
    })
  }

  private handleServerConnection(socket: PeerSocket): void {
    socket.teamFuelAuthed = false
    socket.teamFuelLiveGeneration = this.liveGeneration
    this.resetLegacyProbation(socket)
    socket.teamFuelHandshakeTimer = setTimeout(() => {
      delete socket.teamFuelHandshakeTimer
      if (!socket.teamFuelAuthed) forceTerminate(socket)
    }, HANDSHAKE_DEADLINE_MS)
    if (this.hash) {
      socket.teamFuelNonce = randomBytes(24).toString('hex')
      send(socket, { type: 'challenge', roomHash: this.hash, nonce: socket.teamFuelNonce })
    }
    socket.on('message', (data) => {
      if (!this.hash || !this.roomKey) return
      if (socket.teamFuelLiveGeneration !== this.liveGeneration) {
        forceTerminate(socket)
        return
      }
      const message = parseWire(data, this.hash)
      if (!message) return
      if (message.type === 'hello') {
        if (socket.teamFuelAuthed) return
        if (!socket.teamFuelNonce || !safeEqualHex(message.auth, authHmac(this.roomKey, socket.teamFuelNonce))) {
          clearHandshakeDeadline(socket)
          forceTerminate(socket)
          return
        }
        if (!this.peers.has(message.peerId) && this.peers.size >= MAX_PEERS) {
          socket.close()
          return
        }
        socket.teamFuelAuthed = true
        socket.teamFuelPeerId = message.peerId
        this.resetLegacyProbation(socket)
        clearHandshakeDeadline(socket)
        for (const peer of this.peersList()) send(socket, { type: 'state', roomHash: this.hash, peer })
        return
      }
      if (!socket.teamFuelAuthed) return
      if (!this.isActive() || !this.liveContextActive) return
      if (message.type === 'state') {
        if (!socket.teamFuelPeerId) return
        const accepted = this.acceptInboundPeer(socket, message.peer, socket.teamFuelPeerId)
        if (!accepted) return
        const peer = { ...accepted, local: false }
        if (!this.peers.has(peer.peerId) && this.peers.size >= MAX_PEERS) return
        if (!peersEqual(this.peers.get(peer.peerId), peer)) {
          this.peers.set(peer.peerId, peer)
          this.relay({ type: 'state', roomHash: this.hash, peer }, socket)
          this.broadcastPeers()
        }
      } else if (message.type === 'leave') {
        if (!socket.teamFuelPeerId) return
        const peerId = socket.teamFuelPeerId
        this.legacyProbations.get(socket)?.delete(peerId)
        if (this.peers.delete(peerId)) {
          this.relay({ type: 'leave', roomHash: this.hash, peerId }, socket)
          this.broadcastPeers()
        }
      }
    })
    socket.on('close', () => {
      clearHandshakeDeadline(socket)
      this.legacyProbations.delete(socket)
      if (socket.teamFuelLiveGeneration === this.liveGeneration && socket.teamFuelPeerId) {
        if (this.peers.delete(socket.teamFuelPeerId)) this.broadcastPeers()
      }
    })
    socket.on('error', () => undefined)
  }

  private isCurrentClient(socket: PeerSocket, generation: number): boolean {
    return this.client === socket && this.clientGeneration === generation && socket.teamFuelGeneration === generation
  }

  private handleClientTimeout(socket: PeerSocket, generation: number): void {
    delete socket.teamFuelHandshakeTimer
    if (this.isCurrentClient(socket, generation) && socket.teamFuelPhase !== 'v1Ready') forceTerminate(socket)
  }

  private handleClientClose(socket: PeerSocket, generation: number): void {
    clearHandshakeDeadline(socket)
    if (!this.isCurrentClient(socket, generation)) return
    this.client = null
    this.legacyProbations.delete(socket)
    this.clearRemotePeers()
    if (this.state !== 'stopped') {
      this.state = 'joining'
      this.scheduleReconnect(generation)
    }
    this.broadcastPeers()
  }

  private handleClientMessage(socket: PeerSocket, generation: number, data: RawData): void {
    if (!this.hash || !this.isCurrentClient(socket, generation)) return
    if (socket.teamFuelLiveGeneration !== this.liveGeneration) {
      forceTerminate(socket)
      return
    }
    const message = parseWire(data, this.hash)
    if (!message) return
    if (message.type === 'challenge') {
      if (!this.roomKey || socket.teamFuelPhase !== 'connecting') return
      this.resetLegacyProbation(socket)
      socket.teamFuelPhase = 'helloSent'
      if (!send(socket, { type: 'hello', roomHash: this.hash, peerId: this.peerId, auth: authHmac(this.roomKey, message.nonce) })) {
        forceTerminate(socket)
        return
      }
      socket.teamFuelPhase = 'v1Ready'
      clearHandshakeDeadline(socket)
      this.state = 'connected'
      this.broadcastPeers()
      this.sendLocalState()
    } else if (socket.teamFuelPhase === 'v1Ready' && this.isActive() && this.liveContextActive &&
      this.peers.has(this.peerId) && message.type === 'state') {
      const accepted = this.acceptInboundPeer(socket, message.peer, message.peer.peerId)
      if (!accepted) return
      const peer = { ...accepted, local: accepted.peerId === this.peerId }
      if (!this.peers.has(peer.peerId) && this.peers.size >= MAX_PEERS) return
      if (!peersEqual(this.peers.get(peer.peerId), peer)) {
        this.peers.set(peer.peerId, peer)
        this.broadcastPeers()
      }
    } else if (socket.teamFuelPhase === 'v1Ready' && this.isActive() && this.liveContextActive && message.type === 'leave') {
      this.legacyProbations.get(socket)?.delete(message.peerId)
      if (this.peers.delete(message.peerId)) this.broadcastPeers()
    }
  }

  private tick(): void {
    if (!this.isActive() || !this.liveContextActive) return
    if (!this.updateLocalPeer(this.ctx.telemetryHub.getLatest())) {
      const hadPeers = this.peers.size > 0
      this.peers.clear()
      if (hadPeers) this.broadcastPeers()
      return
    }
    this.pruneStalePeers()
    this.sendLocalState()
    this.broadcastPeers()
  }

  private onTelemetry(snapshot: TelemetrySnapshot | null): void {
    const live = this.liveGate.observe(telemetryForGate(snapshot))
    this.liveContextActive = live.live
    if (!live.boundary) return

    this.liveGeneration += 1
    this.legacyProbations.clear()
    this.invalidateBoundaryTransports()
    this.peers.clear()
    if (!this.isActive()) return
    if (live.live) this.updateLocalPeer(snapshot)
    this.broadcastPeers()
  }

  private updateLocalPeer(snapshot: TelemetrySnapshot | null): boolean {
    snapshot = telemetryForGate(snapshot)
    if (!this.isActive() || !this.liveContextActive || !isLiveTelemetrySnapshot(snapshot)) {
      this.peers.delete(this.peerId)
      return false
    }
    const liveContext = captureLiveTelemetryContext(snapshot)
    const sessionUniqueId = firstFinite(snapshot.sessionUniqueId)
    const fuelLiters = firstFinite(snapshot?.fuelLiters)
    const snapshotDriverName = typeof snapshot.driverName === 'string' && snapshot.driverName.trim()
      ? sanitizeString(snapshot.driverName, 'Driver')
      : undefined
    const existingLocal = this.peers.get(this.peerId)
    const driverName = snapshotDriverName ?? existingLocal?.driverName ?? this.configuredDriverName
    if (!liveContext || !validSessionUniqueId(sessionUniqueId) || !driverName || !finite(fuelLiters) || fuelLiters < 0) {
      this.peers.delete(this.peerId)
      return false
    }
    const fuelPerLap = firstFinite(snapshot?.fuelPerLap)
    const lapsRemaining = firstFinite(snapshot?.lapsRemaining, finite(fuelLiters) && finite(fuelPerLap) && fuelPerLap > 0 ? fuelLiters / fuelPerLap : undefined)
    const stintTargetLaps = finite(fuelLiters) && finite(fuelPerLap) && fuelPerLap > 0 ? Math.floor(fuelLiters / fuelPerLap) : undefined
    this.peers.set(this.peerId, {
      peerId: this.peerId,
      driverName,
      custId: localCustId(snapshot),
      sessionUniqueId,
      fuelLiters: finite(fuelLiters) ? round(fuelLiters, 2) : undefined,
      fuelPerLap: finite(fuelPerLap) ? round(fuelPerLap, 3) : undefined,
      lapsRemaining: finite(lapsRemaining) ? round(lapsRemaining, 2) : undefined,
      stintTargetLaps: finite(stintTargetLaps) ? stintTargetLaps : undefined,
      pitWindow: finite(stintTargetLaps) ? { lapsUntilPit: stintTargetLaps, status: stintTargetLaps < 2 ? 'critical' : 'unknown' } : undefined,
      ts: Date.now(),
      local: true
    })
    return true
  }

  private sendLocalState(): void {
    if (!this.isActive() || !this.liveContextActive || !this.hash) return
    const peer = this.peers.get(this.peerId)
    if (!peer) return
    const message: WireState = { type: 'state', roomHash: this.hash, peer }
    if (this.mode === 'host') {
      this.relay(message)
    } else if (this.client &&
      (this.client as PeerSocket).teamFuelPhase === 'v1Ready' &&
      (this.client as PeerSocket).teamFuelLiveGeneration === this.liveGeneration) {
      send(this.client, message)
    }
  }

  private sendLeave(): void {
    if (!this.hash) return
    const message: WireLeave = { type: 'leave', roomHash: this.hash, peerId: this.peerId }
    if (this.mode === 'host') this.relay(message)
    else if (this.client &&
      (this.client as PeerSocket).teamFuelPhase === 'v1Ready' &&
      (this.client as PeerSocket).teamFuelLiveGeneration === this.liveGeneration) {
      send(this.client, message)
    }
  }

  private relay(message: WireState | WireLeave, except?: WebSocket): void {
    for (const client of this.server?.clients ?? []) {
      const socket = client as PeerSocket
      if (client !== except &&
        socket.teamFuelAuthed === true &&
        socket.teamFuelLiveGeneration === this.liveGeneration) {
        send(client, message)
      }
    }
  }

  private invalidateBoundaryTransports(): void {
    for (const client of this.server?.clients ?? []) {
      clearHandshakeDeadline(client as PeerSocket)
      forceTerminate(client)
    }

    const reconnect = this.isActive() && this.mode === 'join' && this.lastService
    this.clearReconnectTimer()
    const client = this.client as PeerSocket | null
    this.client = null
    const generation = ++this.clientGeneration
    if (client) {
      clearHandshakeDeadline(client)
      forceTerminate(client)
    }
    if (reconnect) {
      this.state = 'joining'
      this.scheduleReconnect(generation)
    }
  }

  private acceptInboundPeer(socket: PeerSocket, remote: TeamFuelPeer, peerId: string): TeamFuelPeer | null {
    const local = this.peers.get(this.peerId)
    if (!local?.local || !validSessionUniqueId(local.sessionUniqueId)) return null

    const now = Date.now()
    this.pruneLegacyProbations(now)
    const probation = this.legacyProbations.get(socket) ?? new Map<string, LegacyPeerProbation>()
    if (!this.legacyProbations.has(socket)) this.legacyProbations.set(socket, probation)
    const existingProbation = probation.get(peerId)
    if (!this.peers.has(peerId) && !existingProbation &&
      this.peers.size + this.pendingLegacyPeerCount() >= MAX_PEERS) {
      return null
    }

    if (remote.sessionUniqueId !== undefined) {
      if (!peerMatchesLocalSession(local, remote)) return null
      probation.delete(peerId)
      return { ...remote, peerId }
    }

    if (now - remote.ts > STALE_PEER_MS) return null
    if (!existingProbation || existingProbation.liveGeneration !== this.liveGeneration) {
      probation.set(peerId, {
        liveGeneration: this.liveGeneration,
        lastTs: remote.ts,
        admitted: false
      })
      return null
    }
    if (remote.ts <= existingProbation.lastTs) return null

    existingProbation.lastTs = remote.ts
    existingProbation.admitted = true
    return { ...remote, peerId, sessionUniqueId: local.sessionUniqueId }
  }

  private pendingLegacyPeerCount(): number {
    this.pruneLegacyProbations(Date.now())
    const pending = new Set<string>()
    for (const probation of this.legacyProbations.values()) {
      for (const [peerId, state] of probation) {
        if (state.liveGeneration === this.liveGeneration && !state.admitted && !this.peers.has(peerId)) {
          pending.add(peerId)
        }
      }
    }
    return pending.size
  }

  private resetLegacyProbation(socket: PeerSocket): void {
    this.legacyProbations.set(socket, new Map())
  }

  private pruneLegacyProbations(now: number): void {
    for (const probation of this.legacyProbations.values()) {
      for (const [peerId, state] of probation) {
        if (now - state.lastTs > STALE_PEER_MS) probation.delete(peerId)
      }
    }
  }

  private clearRemotePeers(): boolean {
    let changed = false
    for (const [peerId, peer] of this.peers) {
      if (peer.local) continue
      this.peers.delete(peerId)
      changed = true
    }
    return changed
  }

  private pruneStalePeers(): void {
    const now = Date.now()
    this.pruneLegacyProbations(now)
    let changed = false
    for (const [peerId, peer] of this.peers) {
      if (peer.local) continue
      if (now - peer.ts > STALE_PEER_MS) {
        this.peers.delete(peerId)
        changed = true
      }
    }
    if (changed) this.broadcastPeers()
  }

  private broadcastPeers(): void {
    this.ctx.broadcast(TEAM_FUEL_CHANNELS.updated, this.peersList())
  }

  private serverPort(): number | undefined {
    const address = this.httpServer?.address()
    if (!address || typeof address === 'string') return undefined
    return (address as AddressInfo).port
  }

  private async disposeNetwork(): Promise<void> {
    this.clearReconnectTimer()
    this.legacyProbations.clear()
    this.browser?.stop()
    this.browser = null
    if (this.service) {
      try { this.service.stop() } catch { /* best-effort */ }
    }
    this.service = null
    const client = this.client as PeerSocket | null
    this.client = null
    this.clientGeneration += 1
    if (client) {
      clearHandshakeDeadline(client)
      try { client.close() } catch { /* best-effort */ }
    }
    const server = this.server
    const httpServer = this.httpServer
    this.server = null
    this.httpServer = null
    const httpClosed = new Promise<void>((resolve) => {
      if (!httpServer) {
        resolve()
        return
      }
      try { httpServer.close(() => resolve()) } catch { resolve() }
    })
    for (const socket of [...this.rawSocketDeadlines.keys()]) this.destroyRawSocket(socket)
    if (server) {
      await Promise.all([...server.clients].map((socket) => this.closePeerSocket(socket as PeerSocket)))
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    for (const socket of [...this.rawSockets]) this.destroyRawSocket(socket)
    await httpClosed
    if (this.bonjour) {
      await new Promise<void>((resolve) => this.bonjour?.destroy(() => resolve()))
    }
    this.bonjour = null
    this.lastService = null
  }
}

export function register(ctx: ModuleContext): void {
  const controller = new TeamFuelController(ctx)

  ctx.ipcMain.handle(TEAM_FUEL_CHANNELS.start, (_event, args: TeamFuelStartArgs) => controller.start(args))
  ctx.ipcMain.handle(TEAM_FUEL_CHANNELS.stop, () => controller.stop())
  ctx.ipcMain.handle(TEAM_FUEL_CHANNELS.state, () => controller.peersList())

  ctx.app.on('before-quit', () => {
    void controller.stop()
  })
}
