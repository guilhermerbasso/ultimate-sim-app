// Shared types and IPC channel names for the SimHub import feature.
// Importable by renderer, preload, and main without electron/node dependencies.

import type { MatrixLayout } from './rgb-matrix'
import type { BoardId, DeviceProfile } from './devices'

// ─── IPC channels ─────────────────────────────────────────────────────────────

export const SIMHUB_CHANNELS = {
  /** Renderer → Main: detect SimHub install and parse its config (read-only). */
  detect: 'simhub:detect',
  /** Renderer → Main: import and persist a DeviceProfile from SimHub config. */
  import: 'simhub:import'
} as const

export type SimHubChannel = (typeof SIMHUB_CHANNELS)[keyof typeof SIMHUB_CHANNELS]

// ─── Parsed config (returned by detect) ──────────────────────────────────────

export interface SimHubMatrixConfig {
  enabled: boolean
  dataPin: number
  serpentine: boolean
  serpentineRev: boolean
  leftRightMirror: boolean
}

export interface SimHubParsedSetup {
  simhubBoardId: string
  board: BoardId
  title: string
  serialPort: string
  matrix: SimHubMatrixConfig
}

export interface SimHubDetectResult {
  found: true
  configPath: string
  parsed: SimHubParsedSetup
}

export interface SimHubDetectMiss {
  found: false
  reason: string
}

export type SimHubDetection = SimHubDetectResult | SimHubDetectMiss

// ─── Import result ────────────────────────────────────────────────────────────

export interface SimHubImportResult {
  profile: DeviceProfile
  layout: MatrixLayout
}
