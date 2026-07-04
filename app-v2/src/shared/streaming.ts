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
}

export interface StreamingStartResult {
  url: string
  port: number
  token: string
}

export interface StreamingStatus {
  running: boolean
  url: string | null
  port: number | null
  token: string | null
  layoutId: string
  streamSafe: boolean
  clients: number
}

export interface StreamingTelemetryFrame {
  snapshot: TelemetrySnapshot | null
  streamSafe: boolean
  timestamp: number
}
