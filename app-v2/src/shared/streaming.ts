import type { Dashboard } from './dashboards'
import type { TelemetrySnapshot } from './telemetry'
import type { ButtonBoxPanel, TouchActionPhase } from './touch-panel'
import type { ReceiverV2Status } from './receiver-v2'

export const STREAMING_CHANNELS = {
  start: 'streaming:start',
  stop: 'streaming:stop',
  status: 'streaming:status',
  selfTest: 'streaming:selftest',
  startTunnel: 'streaming:tunnel:start',
  stopTunnel: 'streaming:tunnel:stop',
  rotateReceiverPairing: 'streaming:receiver:pairing:rotate'
} as const

export type StreamingLayoutKind = 'dashboard' | 'touch'

export interface StreamingStartArgs {
  streamSafe?: boolean
  layoutId?: string
  layoutKind?: StreamingLayoutKind
  presentationProfileId?: string
  port?: number
  lanEnabled?: boolean
  accessMode?: StreamingAccessMode
  publicBaseUrl?: string
  password?: string
  touchPanelId?: string
  autoTunnel?: boolean
}

export type StreamingAccessMode = 'local' | 'lan' | 'internet'

export type StreamingTouchRole = 'viewer' | 'touch-controller'
export type StreamingTouchHealth = 'read-only' | 'ready' | 'degraded'

export interface StreamingTouchCapability {
  id: string
  controlId: string
  zone: string
  phases: TouchActionPhase[]
}

export interface StreamingTouchInteractionSession {
  interactive: boolean
  indicator: 'INTERACTIVE TOUCH'
  role: StreamingTouchRole
  health: StreamingTouchHealth
  targetId: string
  csrfToken: string
  nonce: string
  expiresAt: number
  leaseExpiresAt: number
  capabilities: StreamingTouchCapability[]
  activeControls: number
  lastFeedback: string | null
}

export interface StreamingTouchPanelPayload {
  panel: ButtonBoxPanel
  interaction: StreamingTouchInteractionSession
}

export interface StreamingTouchActionRequest {
  targetId: string
  capabilityId: string
  phase: TouchActionPhase
  nonce: string
}

export interface StreamingTouchActionResponse {
  ok: boolean
  message: string
  health: StreamingTouchHealth
  nextNonce: string
  leaseExpiresAt: number
  controlId?: string
  phase?: TouchActionPhase
  activeControls: number
}

export interface StreamingTouchHealthResponse {
  interactive: boolean
  indicator: 'INTERACTIVE TOUCH'
  role: StreamingTouchRole
  health: StreamingTouchHealth
  targetId: string
  expiresAt: number
  leaseExpiresAt: number
  activeControls: number
  lastFeedback: string | null
}

export const STREAMING_EXPRESSION_EXCLUSION_MESSAGE =
  'Expression placements and resolved expression values are excluded from browser streaming.'

export interface StreamingDashboardPayload {
  dashboard: Dashboard
  expressionContent: {
    mode: 'excluded'
    message: string
  }
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
  receiverV2: ReceiverV2Status
  presentationProfileId: string | null
}

export interface StreamingSelfTestResult {
  reachable: boolean
  statusCode: number | null
  message: string
  url: string | null
  stage: StreamingSelfTestStage
  resourceCount?: number
}

export type StreamingSelfTestStage =
  | 'server'
  | 'document'
  | 'session'
  | 'assets'
  | 'ping'
  | 'authentication'
  | 'target'
  | 'receiver'
  | 'sse'
  | 'complete'

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
  receiverV2: ReceiverV2Status
  presentationProfileId: string | null
  interactive: boolean
  interactionHealth: StreamingTouchHealth
  interactiveCapabilities: number
  activeInteractions: number
  lastInteractionFeedback: string | null
}

export interface StreamingTelemetryFrame {
  snapshot: TelemetrySnapshot | null
  streamSafe: boolean
  timestamp: number
}
