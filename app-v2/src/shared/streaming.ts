import type { TelemetrySnapshot } from './telemetry'

export const STREAMING_CHANNELS = {
  start: 'streaming:start',
  stop: 'streaming:stop',
  status: 'streaming:status'
} as const

export interface StreamingStartArgs {
  streamSafe?: boolean
  layoutId?: string
  port?: number
  lanEnabled?: boolean
  accessMode?: StreamingAccessMode
  publicBaseUrl?: string
  password?: string
  touchPanelId?: string
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
  warning: string | null
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
  touchPanelId: string | null
  streamSafe: boolean
  clients: number
  devices: StreamingClientInfo[]
  lanEnabled: boolean
  lanAddress: string | null
  accessMode: StreamingAccessMode
  publicBaseUrl: string | null
  passwordEnabled: boolean
  warning: string | null
}

export interface StreamingTelemetryFrame {
  snapshot: TelemetrySnapshot | null
  streamSafe: boolean
  timestamp: number
}
