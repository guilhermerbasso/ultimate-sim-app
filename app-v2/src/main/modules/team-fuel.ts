import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import Bonjour, { type Browser, type Service } from 'bonjour-service'
import WebSocket, { WebSocketServer } from 'ws'
import type { RawData } from 'ws'
import type { TeamFuelMode, TeamFuelPeer, TeamFuelPitWindow, TeamFuelStartArgs, TeamFuelStatus } from '../../shared/team-fuel'
import { TEAM_FUEL_CHANNELS } from '../../shared/team-fuel'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { ModuleContext } from '../module-context'

const SERVICE_TYPE = 'usateamfuel'
const PROTOCOL_VERSION = '1'
const BROADCAST_INTERVAL_MS = 1000
const STALE_PEER_MS = 15_000
const MAX_MESSAGE_BYTES = 8192
const MAX_PEERS = 32
const MAX_FUTURE_SKEW_MS = 5000
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

type PeerSocket = WebSocket & { teamFuelAuthed?: boolean; teamFuelPeerId?: string; teamFuelNonce?: string }

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function optionalFinite(value: unknown): value is number | undefined {
  return value === undefined || finite(value)
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
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

function serviceAddress(service: Service): string | undefined {
  const addresses = service.addresses ?? []
  return addresses.find((address) => /^\d+\.\d+\.\d+\.\d+$/.test(address)) ?? addresses[0] ?? service.referer?.address
}

function isPitWindow(value: unknown): value is TeamFuelPitWindow {
  if (value === undefined) return true
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  const status = item.status
  return optionalFinite(item.latestLap) && optionalFinite(item.lapsUntilPit) && (status === undefined || status === 'unknown' || status === 'safe' || status === 'save' || status === 'pit-required' || status === 'critical')
}

function isPeer(value: unknown): value is TeamFuelPeer {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.peerId === 'string' && item.peerId.length > 0 && item.peerId.length <= 80 &&
    typeof item.driverName === 'string' && item.driverName.length > 0 && item.driverName.length <= 120 &&
    optionalFinite(item.custId) && optionalFinite(item.sessionUniqueId) && optionalFinite(item.fuelLiters) &&
    optionalFinite(item.fuelPerLap) && optionalFinite(item.lapsRemaining) && optionalFinite(item.stintTargetLaps) &&
    finite(item.ts) && item.ts > 0 && item.ts <= Date.now() + MAX_FUTURE_SKEW_MS && isPitWindow(item.pitWindow)
}

function parseWire(data: RawData, expectedRoomHash: string): WireMessage | null {
  const bytes = typeof data === 'string' ? Buffer.byteLength(data) : Buffer.isBuffer(data) ? data.byteLength : 0
  if (bytes > MAX_MESSAGE_BYTES) return null
  try {
    const raw = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : null
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed.roomHash !== expectedRoomHash) return null
    if (parsed.type === 'challenge' && typeof parsed.nonce === 'string' && /^[a-f0-9]{32,128}$/i.test(parsed.nonce)) {
      return { type: 'challenge', roomHash: expectedRoomHash, nonce: parsed.nonce }
    }
    if (parsed.type === 'hello' && typeof parsed.peerId === 'string' && parsed.peerId.length > 0 && parsed.peerId.length <= 80 &&
      typeof parsed.auth === 'string' && /^[a-f0-9]{64}$/i.test(parsed.auth)) {
      return { type: 'hello', roomHash: expectedRoomHash, peerId: parsed.peerId, auth: parsed.auth }
    }
    if (parsed.type === 'state' && isPeer(parsed.peer)) return { type: 'state', roomHash: expectedRoomHash, peer: parsed.peer }
    if (parsed.type === 'leave' && typeof parsed.peerId === 'string' && parsed.peerId.length > 0 && parsed.peerId.length <= 80) {
      return { type: 'leave', roomHash: expectedRoomHash, peerId: parsed.peerId }
    }
  } catch {
    return null
  }
  return null
}

function send(ws: WebSocket, message: WireMessage): void {
  if (ws.readyState !== WebSocket.OPEN) return
  try {
    ws.send(JSON.stringify(message))
  } catch {
    // LAN sharing is best-effort.
  }
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

function peersEqual(a: TeamFuelPeer | undefined, b: TeamFuelPeer): boolean {
  return a?.peerId === b.peerId && a.driverName === b.driverName && a.custId === b.custId &&
    a.sessionUniqueId === b.sessionUniqueId && a.fuelLiters === b.fuelLiters &&
    a.fuelPerLap === b.fuelPerLap && a.lapsRemaining === b.lapsRemaining &&
    a.stintTargetLaps === b.stintTargetLaps && a.ts === b.ts && a.local === b.local &&
    a.pitWindow?.latestLap === b.pitWindow?.latestLap &&
    a.pitWindow?.lapsUntilPit === b.pitWindow?.lapsUntilPit &&
    a.pitWindow?.status === b.pitWindow?.status
}

class TeamFuelController {
  private readonly ctx: ModuleContext
  private readonly peerId = randomUUID()
  private peers = new Map<string, TeamFuelPeer>()
  private state: TeamFuelStatus['state'] = 'stopped'
  private mode: TeamFuelMode | undefined
  private hash: string | undefined
  private roomKey: string | undefined
  private driverName = 'Driver'
  private bonjour: Bonjour | null = null
  private service: Service | null = null
  private browser: Browser | null = null
  private server: WebSocketServer | null = null
  private client: WebSocket | null = null
  private lastService: Service | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private error: string | undefined

  constructor(ctx: ModuleContext) {
    this.ctx = ctx
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
    this.driverName = sanitizeString(args.driverName ?? this.ctx.telemetryHub.getLatest()?.driverName ?? 'Driver', 'Driver')
    this.state = this.mode === 'host' ? 'hosting' : 'joining'
    this.error = undefined
    this.peers.clear()
    this.updateLocalPeer()

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

  private async startHost(): Promise<void> {
    if (!this.hash || !this.bonjour) return
    this.server = new WebSocketServer({ port: 0, host: '0.0.0.0' })
    this.server.on('connection', (socket) => this.handleServerConnection(socket as PeerSocket))
    this.server.on('error', (error) => {
      this.error = error.message
      this.state = 'error'
      this.broadcastPeers()
    })
    await new Promise<void>((resolve, reject) => {
      this.server?.once('listening', resolve)
      this.server?.once('error', reject)
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
    if (serviceRoomHash(service) !== this.hash) return
    const address = serviceAddress(service)
    if (!address || !service.port) return
    this.lastService = service
    this.clearReconnectTimer()
    try {
      const ws = new WebSocket(`ws://${address}:${service.port}`) as PeerSocket
      this.client = ws
      ws.on('open', () => {
        this.state = 'connected'
        this.broadcastPeers()
      })
      ws.on('message', (data) => this.handleClientMessage(data))
      ws.on('close', () => {
        if (this.client === ws) this.client = null
        if (this.state !== 'stopped') {
          this.state = 'joining'
          this.scheduleReconnect()
        }
        this.broadcastPeers()
      })
      ws.on('error', () => {
        if (this.client === ws) this.client = null
      })
    } catch {
      // Off-LAN or blocked mDNS/socket should not crash the app.
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.state === 'stopped' || this.mode !== 'join' || !this.lastService || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.state === 'stopped' || this.mode !== 'join' || !this.lastService) return
      this.maybeConnect(this.lastService)
    }, RECONNECT_BACKOFF_MS)
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private handleServerConnection(socket: PeerSocket): void {
    if (this.hash) {
      socket.teamFuelNonce = randomBytes(24).toString('hex')
      send(socket, { type: 'challenge', roomHash: this.hash, nonce: socket.teamFuelNonce })
    }
    socket.on('message', (data) => {
      if (!this.hash || !this.roomKey) return
      const message = parseWire(data, this.hash)
      if (!message) return
      if (message.type === 'hello') {
        if (socket.teamFuelAuthed) return
        if (!socket.teamFuelNonce || !safeEqualHex(message.auth, authHmac(this.roomKey, socket.teamFuelNonce))) {
          socket.close()
          return
        }
        if (!this.peers.has(message.peerId) && this.peers.size >= MAX_PEERS) {
          socket.close()
          return
        }
        socket.teamFuelAuthed = true
        socket.teamFuelPeerId = message.peerId
        for (const peer of this.peersList()) send(socket, { type: 'state', roomHash: this.hash, peer })
        return
      }
      if (!socket.teamFuelAuthed) return
      if (message.type === 'state') {
        if (!socket.teamFuelPeerId) return
        const peer = { ...message.peer, peerId: socket.teamFuelPeerId, local: false }
        if (!this.peers.has(peer.peerId) && this.peers.size >= MAX_PEERS) return
        if (!peersEqual(this.peers.get(peer.peerId), peer)) {
          this.peers.set(peer.peerId, peer)
          this.relay({ type: 'state', roomHash: this.hash, peer }, socket)
          this.broadcastPeers()
        }
      } else if (message.type === 'leave') {
        if (!socket.teamFuelPeerId) return
        const peerId = socket.teamFuelPeerId
        if (this.peers.delete(peerId)) {
          this.relay({ type: 'leave', roomHash: this.hash, peerId }, socket)
          this.broadcastPeers()
        }
      }
    })
    socket.on('close', () => {
      if (socket.teamFuelPeerId) {
        if (this.peers.delete(socket.teamFuelPeerId)) this.broadcastPeers()
      }
    })
    socket.on('error', () => undefined)
  }

  private handleClientMessage(data: RawData): void {
    if (!this.hash) return
    const message = parseWire(data, this.hash)
    if (!message) return
    if (message.type === 'challenge') {
      if (!this.roomKey) return
      send(this.client as WebSocket, { type: 'hello', roomHash: this.hash, peerId: this.peerId, auth: authHmac(this.roomKey, message.nonce) })
      this.sendLocalState()
    } else if (message.type === 'state') {
      const peer = { ...message.peer, local: message.peer.peerId === this.peerId }
      if (!this.peers.has(peer.peerId) && this.peers.size >= MAX_PEERS) return
      if (!peersEqual(this.peers.get(peer.peerId), peer)) {
        this.peers.set(peer.peerId, peer)
        this.broadcastPeers()
      }
    } else if (message.type === 'leave') {
      if (this.peers.delete(message.peerId)) this.broadcastPeers()
    }
  }

  private tick(): void {
    this.updateLocalPeer()
    this.pruneStalePeers()
    this.sendLocalState()
    this.broadcastPeers()
  }

  private updateLocalPeer(): void {
    const snapshot = this.ctx.telemetryHub.getLatest()
    const fuelLiters = firstFinite(snapshot?.fuelLiters)
    const fuelPerLap = firstFinite(snapshot?.fuelPerLap)
    const lapsRemaining = firstFinite(snapshot?.lapsRemaining, finite(fuelLiters) && finite(fuelPerLap) && fuelPerLap > 0 ? fuelLiters / fuelPerLap : undefined)
    const stintTargetLaps = finite(fuelLiters) && finite(fuelPerLap) && fuelPerLap > 0 ? Math.floor(fuelLiters / fuelPerLap) : undefined
    this.peers.set(this.peerId, {
      peerId: this.peerId,
      driverName: sanitizeString(snapshot?.driverName ?? this.driverName, this.driverName),
      custId: localCustId(snapshot),
      sessionUniqueId: snapshot?.sessionUniqueId,
      fuelLiters: finite(fuelLiters) ? round(fuelLiters, 2) : undefined,
      fuelPerLap: finite(fuelPerLap) ? round(fuelPerLap, 3) : undefined,
      lapsRemaining: finite(lapsRemaining) ? round(lapsRemaining, 2) : undefined,
      stintTargetLaps: finite(stintTargetLaps) ? stintTargetLaps : undefined,
      pitWindow: finite(stintTargetLaps) ? { lapsUntilPit: stintTargetLaps, status: stintTargetLaps < 2 ? 'critical' : 'unknown' } : undefined,
      ts: Date.now(),
      local: true
    })
  }

  private sendLocalState(): void {
    if (!this.hash) return
    const peer = this.peers.get(this.peerId)
    if (!peer) return
    const message: WireState = { type: 'state', roomHash: this.hash, peer }
    if (this.mode === 'host') {
      this.relay(message)
    } else if (this.client) {
      send(this.client, message)
    }
  }

  private sendLeave(): void {
    if (!this.hash) return
    const message: WireLeave = { type: 'leave', roomHash: this.hash, peerId: this.peerId }
    if (this.mode === 'host') this.relay(message)
    else if (this.client) send(this.client, message)
  }

  private relay(message: WireMessage, except?: WebSocket): void {
    for (const client of this.server?.clients ?? []) {
      if (client !== except) send(client, message)
    }
  }

  private pruneStalePeers(): void {
    const now = Date.now()
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
    const address = this.server?.address()
    if (!address || typeof address === 'string') return undefined
    return (address as AddressInfo).port
  }

  private async disposeNetwork(): Promise<void> {
    this.clearReconnectTimer()
    this.browser?.stop()
    this.browser = null
    if (this.service) {
      try { this.service.stop() } catch { /* best-effort */ }
    }
    this.service = null
    if (this.client) {
      try { this.client.close() } catch { /* best-effort */ }
    }
    this.client = null
    if (this.server) {
      const server = this.server
      for (const client of server.clients) client.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    this.server = null
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
