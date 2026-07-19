import { createHash, randomUUID } from 'node:crypto'
import WebSocket, { type RawData } from 'ws'
import type { ObsCapabilityHandshake } from '../../shared/obs-local'
import type { ObsAdapterConnectOptions, ObsWebSocketAdapter } from './contracts'

const MAX_OBS_MESSAGE_BYTES = 1024 * 1024
const REQUEST_TIMEOUT_MS = 5_000

interface ObsWireMessage {
  op: number
  d?: Record<string, unknown>
}

interface PendingRequest {
  resolve(value: Record<string, unknown>): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

interface OpcodeWaiter {
  resolve(data: Record<string, unknown>): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

function sha256Base64(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64')
}

export function createObsAuthentication(password: string, salt: string, challenge: string): string {
  const secret = sha256Base64(`${password}${salt}`)
  return sha256Base64(`${secret}${challenge}`)
}

function wireError(message: string): Error {
  return new Error(`OBS WebSocket protocol error: ${message}`)
}

export class ObsWebSocketV5Adapter implements ObsWebSocketAdapter {
  private socket: WebSocket | null = null
  private connected = false
  private readonly pendingRequests = new Map<string, PendingRequest>()
  private readonly opcodeWaiters = new Map<number, OpcodeWaiter>()

  async connect(options: ObsAdapterConnectOptions): Promise<ObsCapabilityHandshake> {
    if (!options.password.trim()) throw new Error('OBS WebSocket password is required.')
    await this.disconnect()
    const socket = new WebSocket(options.endpoint, {
      maxPayload: MAX_OBS_MESSAGE_BYTES,
      handshakeTimeout: options.timeoutMs
    })
    this.socket = socket
    socket.on('message', (data) => this.handleMessage(data))
    socket.on('close', () => this.handleDisconnect(new Error('OBS WebSocket connection closed.')))
    socket.on('error', () => {
      // The open/close waiters surface a redacted transport error.
    })

    const helloPromise = this.waitForOpcode(0, options.timeoutMs)
    let identifiedPromise: Promise<Record<string, unknown>> | null = null
    try {
      await this.waitForOpen(socket, options.timeoutMs)
      const hello = await helloPromise
      const serverRpcVersion = typeof hello.rpcVersion === 'number' ? hello.rpcVersion : 1
      if (serverRpcVersion < 1) throw wireError(`unsupported RPC version ${serverRpcVersion}`)
      const rpcVersion = 1
      const authentication = hello.authentication
      if (!authentication || typeof authentication !== 'object' || Array.isArray(authentication)) {
        throw wireError('password authentication challenge required')
      }
      const auth = authentication as Record<string, unknown>
      if (
        typeof auth.salt !== 'string' ||
        auth.salt.length === 0 ||
        typeof auth.challenge !== 'string' ||
        auth.challenge.length === 0
      ) {
        throw wireError('invalid authentication challenge')
      }
      const authenticationValue = createObsAuthentication(options.password, auth.salt, auth.challenge)

      identifiedPromise = this.waitForOpcode(2, options.timeoutMs)
      this.send({
        op: 1,
        d: {
          rpcVersion,
          eventSubscriptions: 0,
          authentication: authenticationValue
        }
      })
      await identifiedPromise
      this.connected = true

      const version = await this.request<Record<string, unknown>>('GetVersion')
      return {
        protocolVersion: 1,
        rpcVersion,
        obsVersion: typeof version.obsVersion === 'string' ? version.obsVersion : 'unknown',
        obsWebSocketVersion: typeof version.obsWebSocketVersion === 'string'
          ? version.obsWebSocketVersion
          : typeof hello.obsWebSocketVersion === 'string'
            ? hello.obsWebSocketVersion
            : 'unknown',
        availableRequests: Array.isArray(version.availableRequests)
          ? version.availableRequests.filter((value): value is string => typeof value === 'string')
          : [],
        negotiatedAtMs: Date.now()
      }
    } catch (error) {
      await this.disconnect()
      await Promise.allSettled([
        helloPromise,
        ...(identifiedPromise ? [identifiedPromise] : [])
      ])
      throw error instanceof Error ? error : new Error('OBS WebSocket connection failed.')
    }
  }

  async disconnect(): Promise<void> {
    const socket = this.socket
    this.socket = null
    this.connected = false
    this.rejectPending(new Error('OBS WebSocket disconnected.'))
    if (!socket || socket.readyState === WebSocket.CLOSED) return
    if (socket.readyState === WebSocket.CONNECTING) {
      socket.terminate()
      return
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        socket.terminate()
        resolve()
      }, 500)
      socket.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
      socket.close(1000, 'client disconnect')
    })
  }

  isConnected(): boolean {
    return this.connected && this.socket?.readyState === WebSocket.OPEN
  }

  request<T = Record<string, unknown>>(
    requestType: string,
    requestData?: Record<string, unknown>
  ): Promise<T> {
    if (!this.isConnected()) return Promise.reject(new Error('OBS WebSocket is offline.'))
    const requestId = randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error(`OBS request timed out: ${requestType}`))
      }, REQUEST_TIMEOUT_MS)
      this.pendingRequests.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      })
      try {
        this.send({
          op: 6,
          d: {
            requestType,
            requestId,
            ...(requestData ? { requestData } : {})
          }
        })
      } catch (error) {
        clearTimeout(timer)
        this.pendingRequests.delete(requestId)
        reject(error instanceof Error ? error : new Error(`OBS request failed: ${requestType}`))
      }
    })
  }

  private waitForOpen(socket: WebSocket, timeoutMs: number): Promise<void> {
    if (socket.readyState === WebSocket.OPEN) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('OBS WebSocket connection timed out.'))
      }, timeoutMs)
      const onOpen = (): void => {
        cleanup()
        resolve()
      }
      const onError = (): void => {
        cleanup()
        reject(new Error('OBS WebSocket connection failed.'))
      }
      const onClose = (): void => {
        cleanup()
        reject(new Error('OBS WebSocket closed during connection.'))
      }
      const cleanup = (): void => {
        clearTimeout(timer)
        socket.off('open', onOpen)
        socket.off('error', onError)
        socket.off('close', onClose)
      }
      socket.once('open', onOpen)
      socket.once('error', onError)
      socket.once('close', onClose)
    })
  }

  private waitForOpcode(opcode: number, timeoutMs: number): Promise<Record<string, unknown>> {
    const previous = this.opcodeWaiters.get(opcode)
    if (previous) {
      clearTimeout(previous.timer)
      previous.reject(wireError(`duplicate waiter for opcode ${opcode}`))
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.opcodeWaiters.delete(opcode)
        reject(wireError(`timed out waiting for opcode ${opcode}`))
      }, timeoutMs)
      this.opcodeWaiters.set(opcode, { resolve, reject, timer })
    })
  }

  private send(message: ObsWireMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('OBS WebSocket is not open.')
    }
    this.socket.send(JSON.stringify(message))
  }

  private handleMessage(raw: RawData): void {
    let message: ObsWireMessage
    try {
      message = JSON.parse(raw.toString()) as ObsWireMessage
    } catch {
      this.socket?.close(1002, 'invalid JSON')
      this.handleDisconnect(wireError('invalid JSON message'))
      return
    }
    if (!Number.isInteger(message.op)) {
      this.socket?.close(1002, 'missing opcode')
      this.handleDisconnect(wireError('message opcode missing'))
      return
    }
    const data = message.d ?? {}
    const waiter = this.opcodeWaiters.get(message.op)
    if (waiter) {
      clearTimeout(waiter.timer)
      this.opcodeWaiters.delete(message.op)
      waiter.resolve(data)
      return
    }
    if (message.op !== 7 || typeof data.requestId !== 'string') return
    const pending = this.pendingRequests.get(data.requestId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pendingRequests.delete(data.requestId)
    const status = data.requestStatus
    if (!status || typeof status !== 'object' || (status as Record<string, unknown>).result !== true) {
      const comment = status && typeof status === 'object' && typeof (status as Record<string, unknown>).comment === 'string'
        ? `: ${(status as Record<string, unknown>).comment}`
        : ''
      pending.reject(new Error(`OBS request rejected${comment}`))
      return
    }
    const responseData = data.responseData
    pending.resolve(responseData && typeof responseData === 'object' ? responseData as Record<string, unknown> : {})
  }

  private handleDisconnect(error: Error): void {
    this.connected = false
    this.rejectPending(error)
  }

  private rejectPending(error: Error): void {
    for (const waiter of this.opcodeWaiters.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    this.opcodeWaiters.clear()
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pendingRequests.clear()
  }
}
