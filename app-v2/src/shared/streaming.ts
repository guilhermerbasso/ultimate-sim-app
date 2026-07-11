import type { TelemetrySnapshot } from './telemetry'

export const STREAMING_CHANNELS = {
  start: 'streaming:start',
  stop: 'streaming:stop',
  status: 'streaming:status',
  selfTest: 'streaming:selftest',
  startTunnel: 'streaming:tunnel:start',
  stopTunnel: 'streaming:tunnel:stop'
} as const

export type StreamingLayoutKind = 'dashboard' | 'touch'

export interface StreamingStartArgs {
  streamSafe?: boolean
  layoutId?: string
  layoutKind?: StreamingLayoutKind
  port?: number
  lanEnabled?: boolean
  accessMode?: StreamingAccessMode
  publicBaseUrl?: string
  password?: string
  touchPanelId?: string
  autoTunnel?: boolean
}

export type StreamingAccessMode = 'local' | 'lan' | 'internet'

export interface StreamingStartResult {
  url: string
  lanUrl: string | null
  touchUrl: string | null
  qrDataUrl: string | null
  touchQrDataUrl: string | null
  port: number
  token: string
  lanEnabled: boolean
  accessMode: StreamingAccessMode
  lanAddress: string | null
  publicBaseUrl: string | null
  password: string | null
  localTestUrl: string | null
  firewallMessage: string | null
  warning: string | null
  autoTunnelAvailable: boolean
  autoTunnelEnabled: boolean
  autoTunnelRunning: boolean
  autoTunnelMessage: string | null
}

export interface StreamingSelfTestResult {
  reachable: boolean
  statusCode: number | null
  message: string
  url: string | null
}

export interface StreamingClientInfo {
  id: number
  address: string
  userAgent: string | null
  connectedAt: number
}

export interface StreamingStatus {
  running: boolean
  url: string | null
  lanUrl: string | null
  touchUrl: string | null
  qrDataUrl: string | null
  touchQrDataUrl: string | null
  port: number | null
  token: string | null
  layoutId: string
  layoutKind: StreamingLayoutKind
  touchPanelId: string | null
  streamSafe: boolean
  clients: number
  devices: StreamingClientInfo[]
  lanEnabled: boolean
  lanAddress: string | null
  accessMode: StreamingAccessMode
  publicBaseUrl: string | null
  password: string | null
  localTestUrl: string | null
  firewallMessage: string | null
  passwordEnabled: boolean
  warning: string | null
  autoTunnelAvailable: boolean
  autoTunnelEnabled: boolean
  autoTunnelRunning: boolean
  autoTunnelMessage: string | null
}

export interface StreamingTelemetryFrame {
  snapshot: TelemetrySnapshot | null
  streamSafe: boolean
  timestamp: number
}
