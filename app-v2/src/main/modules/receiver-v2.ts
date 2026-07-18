import { randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import WebSocket, { WebSocketServer, type RawData } from 'ws'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import {
  RECEIVER_CAPABILITIES,
  RECEIVER_DEFAULT_HZ,
  RECEIVER_HEARTBEAT_MS,
  RECEIVER_LATENCY_BUDGET_MS,
  RECEIVER_MAX_CLIENT_MESSAGE_BYTES,
  RECEIVER_MAX_SERVER_MESSAGE_BYTES,
  RECEIVER_MIN_HZ,
  RECEIVER_PROTOCOL_VERSION,
  RECEIVER_RELIABILITY_TARGET_PCT,
  RECEIVER_SCHEMA_VERSION,
  RECEIVER_SETUP_BUDGET_MS,
  RECEIVER_SUBPROTOCOL,
  createReceiverTelemetryData,
  negotiateReceiverRate,
  parseReceiverClientMessage,
  summarizeReceiverLatencies,
  type ReceiverClientMessage,
  type ReceiverErrorMessage,
  type ReceiverHelloMessage,
  type ReceiverServerMessage,
  type ReceiverSnapshotMessage,
  type ReceiverTelemetryMessage,
  type ReceiverV2ClientInfo,
  type ReceiverV2Metrics
} from '../../shared/receiver-v2'

const MAX_CLIENTS = 8
const MAX_CLIENTS_PER_ADDRESS = 4
const MAX_PARTITIONS = 16
const HELLO_TIMEOUT_MS = 3_000
const CONTROL_WINDOW_MS = 10_000
const MAX_CONTROL_MESSAGES_PER_WINDOW = 160
const MAX_RESYNC_REQUESTS_PER_WINDOW = 8
const RECONNECT_GRACE_MS = 2 * 60 * 1000
const MAX_HISTORY_FRAMES = 240
const MAX_HISTORY_BYTES = 512 * 1024
const SOFT_BUFFERED_BYTES = 64 * 1024
const HARD_BUFFERED_BYTES = 256 * 1024
const MAX_LATENCY_SAMPLES = 512

interface ReceiverGatewayLogger {
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void
}

export interface ReceiverUpgradeContext {
  sessionId: string
  address: string
  userAgent: string | null
}

interface StoredFrame {
  sequence: number
  sentAt: number
  data: ReturnType<typeof createReceiverTelemetryData>
  bytes: number
}

interface ReceiverPartition {
  sessionId: string
  publicId: string
  sequence: number
  rateHz: number
  nextSendAt: number
  history: StoredFrame[]
  historyBytes: number
  connection: ReceiverConnection | null
  disconnectedAt: number | null
  readyOnce: boolean
}

interface ReceiverConnection {
  socket: WebSocket
  partition: ReceiverPartition
  address: string
  userAgent: string | null
  connectedAt: number
  clientName: string | null
  phase: 'hello' | 'ready'
  maxPayloadBytes: number
  lastAckSequence: number
  lastPongAt: number
  controlWindowStartedAt: number
  controlMessages: number
  resyncRequests: number
  deliveredAt: Map<number, number>
  helloTimer: ReturnType<typeof setTimeout>
}

export interface ReceiverV2GatewayOptions {
  getSnapshot(): TelemetrySnapshot | null
  now?: () => number
  logger?: ReceiverGatewayLogger
}

function noOpLogger(): ReceiverGatewayLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  }
}

function rawDataBytes(data: RawData): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data))
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

function rejectUpgrade(socket: Duplex, statusCode: number, message: string): void {
  const body = `${message}\n`
  try {
    socket.write(
      `HTTP/1.1 ${statusCode} ${message}\r\n` +
      'Connection: close\r\n' +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
      body
    )
  } finally {
    socket.destroy()
  }
}

export class ReceiverV2Gateway {
  private readonly getSnapshot: () => TelemetrySnapshot | null
  private readonly now: () => number
  private readonly log: ReceiverGatewayLogger
  private readonly webSocketServer: WebSocketServer
  private readonly partitions = new Map<string, ReceiverPartition>()
  private readonly connections = new Map<WebSocket, ReceiverConnection>()
  private readonly latencySamples: number[] = []
  private sampleTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private startedAt: number | null = null
  private firstPairedAt: number | null = null
  private firstReadyAt: number | null = null
  private connectionsTotal = 0
  private reconnects = 0
  private resyncs = 0
  private replayedFrames = 0
  private telemetryFrames = 0
  private droppedFrames = 0
  private slowConsumerDisconnects = 0

  constructor(options: ReceiverV2GatewayOptions) {
    this.getSnapshot = options.getSnapshot
    this.now = options.now ?? Date.now
    this.log = options.logger ?? noOpLogger()
    this.webSocketServer = new WebSocketServer({
      noServer: true,
      clientTracking: false,
      maxPayload: RECEIVER_MAX_CLIENT_MESSAGE_BYTES,
      perMessageDeflate: false,
      handleProtocols: (protocols) => protocols.has(RECEIVER_SUBPROTOCOL) ? RECEIVER_SUBPROTOCOL : false
    })
  }

  start(): void {
    if (this.sampleTimer) return
    this.startedAt = this.now()
    this.sampleTimer = setInterval(() => this.sample(), Math.round(1000 / 60))
    this.heartbeatTimer = setInterval(() => this.heartbeat(), RECEIVER_HEARTBEAT_MS)
    this.sampleTimer.unref?.()
    this.heartbeatTimer.unref?.()
  }

  markPaired(): void {
    if (this.firstPairedAt === null) this.firstPairedAt = this.now()
  }

  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    context: ReceiverUpgradeContext
  ): void {
    const protocols = String(request.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    if (!protocols.includes(RECEIVER_SUBPROTOCOL)) {
      rejectUpgrade(socket, 426, 'WebSocket subprotocol required')
      return
    }
    if (this.connections.size >= MAX_CLIENTS) {
      rejectUpgrade(socket, 503, 'Receiver capacity reached')
      return
    }
    const addressConnections = [...this.connections.values()].filter((connection) => connection.address === context.address).length
    if (addressConnections >= MAX_CLIENTS_PER_ADDRESS) {
      rejectUpgrade(socket, 429, 'Receiver rate limit reached')
      return
    }
    if (!this.partitions.has(context.sessionId) && this.partitions.size >= MAX_PARTITIONS) {
      rejectUpgrade(socket, 503, 'Receiver partition capacity reached')
      return
    }
    this.webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      this.accept(webSocket, context)
    })
  }

  stop(): void {
    if (this.sampleTimer) clearInterval(this.sampleTimer)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.sampleTimer = null
    this.heartbeatTimer = null
    for (const connection of this.connections.values()) {
      clearTimeout(connection.helloTimer)
      try {
        connection.socket.close(1001, 'Receiver gateway stopped')
      } catch {
        connection.socket.terminate()
      }
    }
    this.connections.clear()
    this.partitions.clear()
    this.webSocketServer.close()
  }

  clients(): ReceiverV2ClientInfo[] {
    return [...this.connections.values()]
      .filter((connection) => connection.phase === 'ready')
      .map((connection) => ({
        id: connection.partition.publicId,
        address: connection.address,
        userAgent: connection.userAgent,
        connectedAt: connection.connectedAt,
        clientName: connection.clientName,
        rateHz: connection.partition.rateHz,
        lastAckSequence: connection.lastAckSequence
      }))
  }

  metrics(): ReceiverV2Metrics {
    const latency = summarizeReceiverLatencies(this.latencySamples)
    const setupTimeMs = this.startedAt !== null && this.firstReadyAt !== null
      ? Math.max(0, this.firstReadyAt - this.startedAt)
      : null
    const attemptedFrames = this.telemetryFrames + this.droppedFrames
    const reliabilityPct = attemptedFrames === 0
      ? 100
      : Math.round((this.telemetryFrames / attemptedFrames) * 10_000) / 100
    return {
      startedAt: this.startedAt,
      firstPairedAt: this.firstPairedAt,
      firstReadyAt: this.firstReadyAt,
      setupTimeMs,
      setupBudgetMs: RECEIVER_SETUP_BUDGET_MS,
      setupBudgetPassed: setupTimeMs === null ? null : setupTimeMs <= RECEIVER_SETUP_BUDGET_MS,
      activeClients: this.clients().length,
      connections: this.connectionsTotal,
      reconnects: this.reconnects,
      resyncs: this.resyncs,
      replayedFrames: this.replayedFrames,
      telemetryFrames: this.telemetryFrames,
      droppedFrames: this.droppedFrames,
      slowConsumerDisconnects: this.slowConsumerDisconnects,
      latencySamples: latency.count,
      latencyP50Ms: latency.p50,
      latencyP95Ms: latency.p95,
      latencyMaxMs: latency.max,
      latencyBudgetMs: RECEIVER_LATENCY_BUDGET_MS,
      latencyBudgetPassed: latency.count < 10 || latency.p95 === null ? null : latency.p95 <= RECEIVER_LATENCY_BUDGET_MS,
      reliabilityPct,
      reliabilityTargetPct: RECEIVER_RELIABILITY_TARGET_PCT,
      reliabilityPassed: attemptedFrames === 0 ? null : reliabilityPct >= RECEIVER_RELIABILITY_TARGET_PCT
    }
  }

  private accept(socket: WebSocket, context: ReceiverUpgradeContext): void {
    const now = this.now()
    const partition = this.partition(context.sessionId)
    if (partition.connection) {
      try {
        partition.connection.socket.close(4001, 'Receiver session moved to a new connection')
      } catch {
        partition.connection.socket.terminate()
      }
    }
    const helloTimer = setTimeout(() => {
      this.closeWithError(connection, 'hello_timeout', 'Receiver hello timed out.', false, 1008)
    }, HELLO_TIMEOUT_MS)
    helloTimer.unref?.()
    const connection: ReceiverConnection = {
      socket,
      partition,
      address: context.address,
      userAgent: context.userAgent,
      connectedAt: now,
      clientName: null,
      phase: 'hello',
      maxPayloadBytes: RECEIVER_MAX_SERVER_MESSAGE_BYTES,
      lastAckSequence: 0,
      lastPongAt: now,
      controlWindowStartedAt: now,
      controlMessages: 0,
      resyncRequests: 0,
      deliveredAt: new Map(),
      helloTimer
    }
    partition.connection = connection
    partition.disconnectedAt = null
    this.connections.set(socket, connection)
    this.connectionsTotal += 1
    socket.on('message', (data, isBinary) => this.onMessage(connection, data, isBinary))
    socket.on('pong', () => {
      connection.lastPongAt = this.now()
    })
    socket.on('close', () => this.onClose(connection))
    socket.on('error', (error) => {
      this.log.warn('receiver websocket error', {
        id: partition.publicId,
        address: context.address,
        message: error.message
      })
    })
    this.log.info('receiver websocket connected', {
      id: partition.publicId,
      address: context.address,
      connections: this.connections.size
    })
  }

  private partition(sessionId: string): ReceiverPartition {
    const existing = this.partitions.get(sessionId)
    if (existing) return existing
    const created: ReceiverPartition = {
      sessionId,
      publicId: randomBytes(9).toString('base64url'),
      sequence: 0,
      rateHz: RECEIVER_DEFAULT_HZ,
      nextSendAt: 0,
      history: [],
      historyBytes: 0,
      connection: null,
      disconnectedAt: null,
      readyOnce: false
    }
    this.partitions.set(sessionId, created)
    return created
  }

  private onMessage(connection: ReceiverConnection, data: RawData, isBinary: boolean): void {
    if (isBinary) {
      this.closeWithError(connection, 'binary_not_supported', 'Receiver v2 JSON accepts text frames only.', false, 1003)
      return
    }
    if (!this.consumeControlBudget(connection)) {
      this.closeWithError(connection, 'control_rate_limit', 'Receiver control rate limit exceeded.', true, 1008)
      return
    }
    const parsed = parseReceiverClientMessage(rawDataBytes(data))
    if (!parsed.ok) {
      this.closeWithError(connection, parsed.code, parsed.message, false, 1008)
      return
    }
    this.handleMessage(connection, parsed.value)
  }

  private consumeControlBudget(connection: ReceiverConnection): boolean {
    const now = this.now()
    if (now - connection.controlWindowStartedAt >= CONTROL_WINDOW_MS) {
      connection.controlWindowStartedAt = now
      connection.controlMessages = 0
      connection.resyncRequests = 0
    }
    connection.controlMessages += 1
    return connection.controlMessages <= MAX_CONTROL_MESSAGES_PER_WINDOW
  }

  private handleMessage(connection: ReceiverConnection, message: ReceiverClientMessage): void {
    if (connection.phase === 'hello') {
      if (message.type !== 'hello') {
        this.closeWithError(connection, 'hello_required', 'The first receiver message must be hello.', false, 1002)
        return
      }
      this.handleHello(connection, message)
      return
    }
    if (message.type === 'hello') {
      this.closeWithError(connection, 'hello_duplicate', 'Hello may be sent only once per connection.', false, 1002)
      return
    }
    if (message.type === 'ack') {
      this.handleAck(connection, message.sequence)
      return
    }
    connection.resyncRequests += 1
    if (connection.resyncRequests > MAX_RESYNC_REQUESTS_PER_WINDOW) {
      this.closeWithError(connection, 'resync_rate_limit', 'Too many resync requests.', true, 1008)
      return
    }
    this.resyncs += 1
    this.sendReplayOrSnapshot(connection, message.afterSequence, 'resync')
  }

  private handleHello(connection: ReceiverConnection, hello: ReceiverHelloMessage): void {
    if (!hello.protocolVersions.includes(RECEIVER_PROTOCOL_VERSION)) {
      this.closeWithError(connection, 'unsupported_protocol', 'Receiver protocol v2 is required.', false, 1002)
      return
    }
    if (!hello.schemaVersions.includes(RECEIVER_SCHEMA_VERSION)) {
      this.closeWithError(connection, 'unsupported_schema', 'Receiver telemetry schema v1 is required.', false, 1002)
      return
    }
    if (!hello.capabilities.includes('telemetry.fast.v1')) {
      this.closeWithError(connection, 'missing_capability', 'telemetry.fast.v1 capability is required.', false, 1002)
      return
    }
    clearTimeout(connection.helloTimer)
    connection.phase = 'ready'
    connection.clientName = hello.client.name ?? hello.client.id
    connection.maxPayloadBytes = Math.min(hello.maxPayloadBytes, RECEIVER_MAX_SERVER_MESSAGE_BYTES)
    connection.partition.rateHz = negotiateReceiverRate(hello.requestedHz)
    connection.partition.nextSendAt = this.now()
    connection.partition.readyOnce = true
    if (hello.resumeFrom !== undefined) this.reconnects += 1
    if (this.firstReadyAt === null) this.firstReadyAt = this.now()
    this.send(connection, {
      type: 'welcome',
      protocolVersion: RECEIVER_PROTOCOL_VERSION,
      schemaVersion: RECEIVER_SCHEMA_VERSION,
      capabilities: [...RECEIVER_CAPABILITIES],
      sessionId: connection.partition.publicId,
      rateHz: connection.partition.rateHz,
      maxPayloadBytes: connection.maxPayloadBytes,
      heartbeatMs: RECEIVER_HEARTBEAT_MS,
      highWater: connection.partition.sequence,
      serverTime: this.now(),
      readOnly: true,
      commands: false
    })
    this.send(connection, {
      type: 'rate',
      rateHz: connection.partition.rateHz,
      reason: 'negotiated'
    })
    if (hello.resumeFrom !== undefined) {
      this.sendReplayOrSnapshot(connection, hello.resumeFrom, 'reconnect')
    } else {
      this.sendSnapshot(connection, 'initial')
    }
    this.log.info('receiver hello negotiated', {
      id: connection.partition.publicId,
      client: connection.clientName,
      rateHz: connection.partition.rateHz,
      resumeFrom: hello.resumeFrom ?? null
    })
  }

  private handleAck(connection: ReceiverConnection, sequence: number): void {
    const partition = connection.partition
    if (sequence > partition.sequence) {
      this.closeWithError(connection, 'ack_ahead', 'Ack sequence is ahead of the receiver high-water mark.', false, 1008)
      return
    }
    connection.lastAckSequence = Math.max(connection.lastAckSequence, sequence)
    const deliveredAt = connection.deliveredAt.get(sequence)
    if (deliveredAt === undefined) return
    const latency = this.now() - deliveredAt
    if (!Number.isFinite(latency) || latency < 0 || latency > RECONNECT_GRACE_MS) return
    for (const deliveredSequence of connection.deliveredAt.keys()) {
      if (deliveredSequence <= sequence) connection.deliveredAt.delete(deliveredSequence)
    }
    this.latencySamples.push(latency)
    while (this.latencySamples.length > MAX_LATENCY_SAMPLES) this.latencySamples.shift()
  }

  private sendReplayOrSnapshot(
    connection: ReceiverConnection,
    afterSequence: number,
    reason: 'reconnect' | 'resync'
  ): void {
    const partition = connection.partition
    if (afterSequence === partition.sequence) {
      this.send(connection, {
        type: 'resync-complete',
        highWater: partition.sequence,
        replayed: 0,
        snapshot: false
      })
      return
    }
    const frames = partition.history.filter((frame) => frame.sequence > afterSequence)
    const replayAvailable = afterSequence < partition.sequence &&
      frames.length > 0 &&
      frames[0].sequence === afterSequence + 1 &&
      frames[frames.length - 1].sequence === partition.sequence
    if (!replayAvailable) {
      this.sendSnapshot(connection, 'replay-unavailable')
      this.send(connection, {
        type: 'resync-complete',
        highWater: partition.sequence,
        replayed: 0,
        snapshot: true
      })
      return
    }
    for (const frame of frames) {
      if (this.send(connection, {
        type: 'telemetry',
        sequence: frame.sequence,
        sentAt: frame.sentAt,
        replay: true,
        data: frame.data
      })) this.replayedFrames += 1
    }
    this.send(connection, {
      type: 'resync-complete',
      highWater: partition.sequence,
      replayed: frames.length,
      snapshot: false
    })
    this.log.info('receiver replay completed', {
      id: partition.publicId,
      reason,
      afterSequence,
      highWater: partition.sequence,
      replayed: frames.length
    })
  }

  private sendSnapshot(connection: ReceiverConnection, reason: ReceiverSnapshotMessage['reason']): void {
    const partition = connection.partition
    this.send(connection, {
      type: 'snapshot',
      sequence: partition.sequence,
      highWater: partition.sequence,
      sentAt: this.now(),
      reason,
      data: createReceiverTelemetryData(this.getSnapshot(), this.now())
    })
  }

  private sample(): void {
    const now = this.now()
    const data = createReceiverTelemetryData(this.getSnapshot(), now)
    for (const [sessionId, partition] of this.partitions) {
      if (!partition.connection && (
        !partition.readyOnce ||
        partition.disconnectedAt === null ||
        now - partition.disconnectedAt > RECONNECT_GRACE_MS
      )) {
        this.partitions.delete(sessionId)
        continue
      }
      if (now < partition.nextSendAt) continue
      partition.nextSendAt = now + (1000 / partition.rateHz)
      partition.sequence += 1
      const message: ReceiverTelemetryMessage = {
        type: 'telemetry',
        sequence: partition.sequence,
        sentAt: now,
        replay: false,
        data
      }
      const bytes = Buffer.byteLength(JSON.stringify(message))
      const frame: StoredFrame = {
        sequence: message.sequence,
        sentAt: message.sentAt,
        data: message.data,
        bytes
      }
      partition.history.push(frame)
      partition.historyBytes += bytes
      while (partition.history.length > MAX_HISTORY_FRAMES || partition.historyBytes > MAX_HISTORY_BYTES) {
        const removed = partition.history.shift()
        if (removed) partition.historyBytes -= removed.bytes
      }
      const connection = partition.connection
      if (!connection || connection.phase !== 'ready') continue
      if (connection.socket.bufferedAmount > HARD_BUFFERED_BYTES) {
        this.droppedFrames += 1
        this.slowConsumerDisconnects += 1
        this.closeWithError(connection, 'slow_consumer', 'Receiver could not keep up with the bounded stream.', true, 1013)
        continue
      }
      if (connection.socket.bufferedAmount > SOFT_BUFFERED_BYTES) {
        this.droppedFrames += 1
        if (partition.rateHz > RECEIVER_MIN_HZ) {
          partition.rateHz = RECEIVER_MIN_HZ
          this.send(connection, { type: 'rate', rateHz: partition.rateHz, reason: 'backpressure' })
        }
        continue
      }
      if (this.send(connection, message)) this.telemetryFrames += 1
      else this.droppedFrames += 1
    }
  }

  private heartbeat(): void {
    const now = this.now()
    for (const connection of this.connections.values()) {
      if (now - connection.lastPongAt > RECEIVER_HEARTBEAT_MS * 3) {
        this.closeWithError(connection, 'heartbeat_timeout', 'Receiver heartbeat timed out.', true, 1001)
        continue
      }
      if (connection.socket.readyState === WebSocket.OPEN) {
        try {
          connection.socket.ping()
        } catch {
          connection.socket.terminate()
        }
      }
    }
  }

  private send(connection: ReceiverConnection, message: ReceiverServerMessage): boolean {
    if (connection.socket.readyState !== WebSocket.OPEN) return false
    const serialized = JSON.stringify(message)
    if (Buffer.byteLength(serialized) > connection.maxPayloadBytes) {
      this.closeWithError(connection, 'server_payload_limit', 'Negotiated receiver payload limit was exceeded.', false, 1009)
      return false
    }
    try {
      connection.socket.send(serialized)
      if (message.type === 'telemetry') {
        connection.deliveredAt.set(message.sequence, this.now())
        while (connection.deliveredAt.size > 256) {
          const oldest = connection.deliveredAt.keys().next().value as number | undefined
          if (oldest === undefined) break
          connection.deliveredAt.delete(oldest)
        }
      }
      return true
    } catch (error) {
      this.log.warn('receiver send failed', {
        id: connection.partition.publicId,
        message: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  private closeWithError(
    connection: ReceiverConnection,
    code: string,
    message: string,
    retryable: boolean,
    closeCode: number
  ): void {
    const error: ReceiverErrorMessage = { type: 'error', code, message, retryable }
    this.send(connection, error)
    try {
      connection.socket.close(closeCode, code.slice(0, 100))
    } catch {
      connection.socket.terminate()
    }
  }

  private onClose(connection: ReceiverConnection): void {
    clearTimeout(connection.helloTimer)
    this.connections.delete(connection.socket)
    if (connection.partition.connection === connection) {
      connection.partition.connection = null
      if (connection.partition.readyOnce) {
        connection.partition.disconnectedAt = this.now()
      } else {
        this.partitions.delete(connection.partition.sessionId)
      }
    }
    this.log.info('receiver websocket disconnected', {
      id: connection.partition.publicId,
      address: connection.address,
      connections: this.connections.size
    })
  }
}
