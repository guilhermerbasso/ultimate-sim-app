export const OBS_LOCAL_CHANNELS = {
  startFeed: 'obs-local:feed:start',
  stopFeed: 'obs-local:feed:stop',
  connect: 'obs-local:control:connect',
  disconnect: 'obs-local:control:disconnect',
  command: 'obs-local:control:command',
  refreshHealth: 'obs-local:control:health',
  setManualOverride: 'obs-local:control:manual-override',
  status: 'obs-local:status'
} as const

export const OBS_LOCAL_PROTOCOL_VERSION = 1

export interface ObsLocalFeedStartArgs {
  layoutId: string
  port?: number
}

export interface ObsSceneAllowlistEntry {
  sceneName: string
  sourceNames: string[]
}

export interface ObsLocalConnectArgs {
  host?: string
  port?: number
  password: string
  allowNonLoopback?: boolean
  scenes: ObsSceneAllowlistEntry[]
}

export type ObsLocalOperation =
  | {
      kind: 'set-source-visibility'
      sourceName: string
      visible: boolean
    }
  | {
      kind: 'save-replay-buffer'
      raceClockSec?: number
    }
  | {
      kind: 'undo'
      targetRequestId: string
    }

export interface ObsLocalCommand {
  requestId: string
  issuedAtMs: number
  sceneName: string
  operation: ObsLocalOperation
}

export type ObsLocalCommandDenyReason =
  | 'invalid-request'
  | 'offline'
  | 'capability-mismatch'
  | 'stale-health'
  | 'manual-override'
  | 'request-expired'
  | 'request-replayed'
  | 'rate-limited'
  | 'scene-not-allowed'
  | 'source-not-allowed'
  | 'wrong-scene'
  | 'replay-buffer-inactive'
  | 'timeline-unavailable'
  | 'undo-unavailable'
  | 'transport-error'

export type ObsTimelineReplayState = 'live' | 'replay' | 'unknown'
export type ObsTimelineSource = 'recording-timecode' | 'connector-monotonic'

export interface ObsTimelineMapping {
  raceClockSec: number
  telemetryTimestampMs: number
  observedAtMonotonicMs: number
  obsTimelineMs: number
  offsetMs: number
  source: ObsTimelineSource
  replayState: ObsTimelineReplayState
  sessionIdentity: string | null
}

export interface ObsLocalCommandResult {
  ok: boolean
  requestId: string
  message: string
  reason?: ObsLocalCommandDenyReason
  reversible: boolean
  previousValue?: boolean
  timeline?: ObsTimelineMapping
  latencyMs: number
}

export interface ObsCapabilityHandshake {
  protocolVersion: number
  rpcVersion: number
  obsVersion: string
  obsWebSocketVersion: string
  availableRequests: string[]
  negotiatedAtMs: number
}

export type ObsLocalControlState =
  | 'offline'
  | 'connecting'
  | 'ready'
  | 'capability-mismatch'
  | 'error'

export type ObsLocalHealthState = 'offline' | 'fresh' | 'stale' | 'degraded'

export interface ObsLocalLatencyMetrics {
  samples: number
  lastMs: number | null
  p95Ms: number | null
  maxMs: number | null
}

export interface ObsLocalMetrics {
  connectAttempts: number
  connectSuccesses: number
  connectFailures: number
  healthChecks: number
  healthFailures: number
  commandsAccepted: number
  commandsDenied: number
  commandsRateLimited: number
  replayRejects: number
  wrongSceneRejects: number
  staleHealthRejects: number
  offlineRejects: number
  capabilityRejects: number
  transportFailures: number
  latency: ObsLocalLatencyMetrics
}

export interface ObsLocalFeedStatus {
  running: boolean
  url: string | null
  bindAddress: '127.0.0.1' | null
  port: number | null
  portMode: 'ephemeral' | 'explicit' | null
  allowedLayoutIds: string[]
  readOnly: true
  clients: number
  health: 'offline' | 'fresh'
}

export interface ObsLocalControlStatus {
  state: ObsLocalControlState
  health: ObsLocalHealthState
  endpoint: string | null
  loopback: boolean
  explicitNonLoopback: boolean
  currentProgramScene: string | null
  sceneAllowlist: ObsSceneAllowlistEntry[]
  handshake: ObsCapabilityHandshake | null
  missingCapabilities: string[]
  manualOverride: boolean
  lastHealthAtMs: number | null
  healthAgeMs: number | null
  lastTimeline: ObsTimelineMapping | null
  lastError: string | null
  metrics: ObsLocalMetrics
}

export interface ObsLocalStatus {
  protocolVersion: typeof OBS_LOCAL_PROTOCOL_VERSION
  feed: ObsLocalFeedStatus
  control: ObsLocalControlStatus
}
