import type { ObsCapabilityHandshake } from '../../shared/obs-local'
import {
  OBS_LOCAL_REQUIRED_REQUESTS,
  type ObsAdapterConnectOptions,
  type ObsWebSocketAdapter
} from './contracts'

type MockResponse =
  | Record<string, unknown>
  | ((requestData: Record<string, unknown> | undefined) => Record<string, unknown> | Promise<Record<string, unknown>>)

export interface MockObsWebSocketAdapterOptions {
  handshake?: Partial<ObsCapabilityHandshake>
  connectError?: Error
  responses?: Record<string, MockResponse>
}

export interface MockObsRequest {
  requestType: string
  requestData?: Record<string, unknown>
}

export interface MockObsConnectRecord {
  endpoint: string
  timeoutMs: number
  passwordProvided: boolean
}

export class MockObsWebSocketAdapter implements ObsWebSocketAdapter {
  readonly requests: MockObsRequest[] = []
  readonly connectOptions: MockObsConnectRecord[] = []
  private connected = false
  private connectError: Error | undefined
  private readonly responses = new Map<string, MockResponse>()
  private readonly handshake: ObsCapabilityHandshake

  constructor(options: MockObsWebSocketAdapterOptions = {}) {
    this.connectError = options.connectError
    this.handshake = {
      protocolVersion: 1,
      rpcVersion: 1,
      obsVersion: '31.0.0-mock',
      obsWebSocketVersion: '5.6.0-mock',
      availableRequests: [...OBS_LOCAL_REQUIRED_REQUESTS],
      negotiatedAtMs: 0,
      ...options.handshake
    }
    for (const [requestType, response] of Object.entries(options.responses ?? {})) {
      this.responses.set(requestType, response)
    }
  }

  async connect(options: ObsAdapterConnectOptions): Promise<ObsCapabilityHandshake> {
    this.connectOptions.push({
      endpoint: options.endpoint,
      timeoutMs: options.timeoutMs,
      passwordProvided: options.password.length > 0
    })
    if (this.connectError) throw this.connectError
    this.connected = true
    return { ...this.handshake, availableRequests: [...this.handshake.availableRequests] }
  }

  async disconnect(): Promise<void> {
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }

  async request<T = Record<string, unknown>>(
    requestType: string,
    requestData?: Record<string, unknown>
  ): Promise<T> {
    if (!this.connected) throw new Error('Mock OBS adapter is offline.')
    this.requests.push({ requestType, requestData })
    const configured = this.responses.get(requestType)
    if (!configured) return {} as T
    const response = typeof configured === 'function'
      ? await configured(requestData)
      : configured
    return { ...response } as T
  }

  setResponse(requestType: string, response: MockResponse): void {
    this.responses.set(requestType, response)
  }

  setConnectError(error: Error | undefined): void {
    this.connectError = error
  }

  simulateOffline(): void {
    this.connected = false
  }
}
