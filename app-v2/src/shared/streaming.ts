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
  password?: string
  touchPanelId?: string
}

export interface StreamingStartResult {
  url: string
  lanUrl: string | null
  touchUrl: string | null
  qrDataUrl: string | null
  touchQrDataUrl: string | null
  port: number
  token: string
  lanEnabled: boolean
  warning: string | null
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
  lanEnabled: boolean
  lanAddress: string | null
  passwordEnabled: boolean
  warning: string | null
}

export interface StreamingTelemetryFrame {
  snapshot: TelemetrySnapshot | null
  streamSafe: boolean
  timestamp: number
}
