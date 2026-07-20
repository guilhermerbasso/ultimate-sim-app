import type { ObsCapabilityHandshake } from '../../shared/obs-local'

export const OBS_LOCAL_REQUIRED_REQUESTS = [
  'GetVersion',
  'GetStats',
  'GetCurrentProgramScene',
  'GetSceneItemId',
  'GetSceneItemEnabled',
  'SetSceneItemEnabled',
  'GetReplayBufferStatus',
  'SaveReplayBuffer',
  'GetRecordStatus'
] as const

export interface ObsAdapterConnectOptions {
  endpoint: string
  password: string
  timeoutMs: number
}

export interface ObsWebSocketAdapter {
  connect(options: ObsAdapterConnectOptions): Promise<ObsCapabilityHandshake>
  disconnect(): Promise<void>
  isConnected(): boolean
  request<T = Record<string, unknown>>(requestType: string, requestData?: Record<string, unknown>): Promise<T>
}

export interface ObsLocalClock {
  wallNowMs(): number
  monotonicNowMs(): number
}

export const SYSTEM_OBS_LOCAL_CLOCK: ObsLocalClock = {
  wallNowMs: () => Date.now(),
  monotonicNowMs: () => performance.now()
}

export interface ObsAdapterFactory {
  (): ObsWebSocketAdapter
}
