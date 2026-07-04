import type { SimId } from './telemetry'

export interface RecordingSample {
  timestamp: number
  sessionTimeSec?: number
  lapIndex: number
  lapNumber?: number
  lapDistPct: number
  speedKmh: number
  throttle: number
  brake: number
  deltaToBestSec?: number
  currentLapTimeSec?: number
  rpm?: number
  gear?: number
}

export interface RecordingLapSummary {
  lapIndex: number
  lapNumber?: number
  startedAt: number
  endedAt?: number
  durationSec?: number
  sampleCount: number
  minSpeedKmh?: number
  maxSpeedKmh?: number
  avgSpeedKmh?: number
  bestDeltaToBestSec?: number
  worstDeltaToBestSec?: number
  complete: boolean
}

export interface RecordingSessionSummary {
  id: string
  source: SimId
  startedAt: number
  endedAt?: number
  sampleRateHz: number
  sampleCount: number
  lapCount: number
  laps: RecordingLapSummary[]
}

export interface RecordingStatus {
  recording: boolean
  activeSession: RecordingSessionSummary | null
}

export interface RecordingStartOptions {
  sampleRateHz?: number
}

// ─── Recording config (persisted) ───────────────────────────────────────────────
// Mirrors the spotter module's getConfig/setConfig persistence pattern so the
// "auto-gravar" preference survives reloads. Default ON: the user wants telemetry
// recording enabled by default, auto-starting whenever a session becomes active.

export interface RecordingConfig {
  /** When true, recording auto-starts as soon as live telemetry connects. Default: true. */
  autoRecord: boolean
}

export const DEFAULT_RECORDING_CONFIG: RecordingConfig = {
  autoRecord: true
}

export const RECORDING_CHANNELS = {
  /** invoke() → RecordingConfig (persisted). */
  getConfig: 'recording:getConfig',
  /** invoke(Partial<RecordingConfig>) → RecordingConfig (sanitized + persisted). */
  setConfig: 'recording:setConfig',
  /** Broadcast: RecordingConfig changed. */
  configEvent: 'recording:config',
  /** invoke() → string ('' on success, else an error string from shell.openPath). */
  openFolder: 'recording:openFolder'
} as const

/**
 * Sanitize + merge a (partial) recording config patch onto a base config, coercing
 * `autoRecord` to a boolean. Omitted fields keep the base value.
 */
export function mergeRecordingConfig(
  base: RecordingConfig,
  patch?: Partial<RecordingConfig> | null
): RecordingConfig {
  const src = patch && typeof patch === 'object' ? patch : {}
  const merged = { ...base, ...src }
  return {
    autoRecord: typeof merged.autoRecord === 'boolean' ? merged.autoRecord : base.autoRecord
  }
}

// ─── Análise de telemetria (.ibt + gravações do app) ───────────────────────────
// Tipos compartilhados entre o main (parsers + engine de análise) e o renderer.

export interface IbtFileInfo {
  path: string
  fileName: string
  sizeBytes: number
  modifiedAt: number
  trackName?: string
  trackShortName?: string
  carName?: string
  sessionType?: string
  tickRate?: number
  recordCount?: number
  durationSec?: number
  lapCount?: number
  parseError?: string
}

export interface IbtLapSummary {
  lapIndex: number
  lapNumber?: number
  startedAtSec: number
  endedAtSec?: number
  durationSec?: number
  sampleCount: number
  complete: boolean
}

export interface IbtFileSummary {
  path: string
  fileName: string
  sizeBytes: number
  modifiedAt: number
  tickRate: number
  numVars: number
  recordCount: number
  durationSec?: number
  trackName?: string
  trackShortName?: string
  carName?: string
  sessionType?: string
  laps: IbtLapSummary[]
}

export interface TrackOption {
  key: string
  label: string
  sources: Array<'recording' | 'ibt'>
  lapCount: number
}

export interface RecordingLapRef {
  source: 'recording'
  sessionId: string
  lapIndex: number
  trackKey?: string
}

export interface IbtLapRef {
  source: 'ibt'
  path: string
  lapIndex: number
  trackKey?: string
}

export type AnalysisLapRef = RecordingLapRef | IbtLapRef

export type AnalysisProfile = 'compareBest' | 'optimal' | 'lossMap'

export interface AnalysisLapSample {
  lapDistPct: number
  speedKmh: number
  throttle: number
  brake: number
  currentLapTimeSec?: number
  rpm?: number
  gear?: number
}

export interface AnalysisLap {
  id: string
  ref: AnalysisLapRef
  label: string
  source: 'recording' | 'ibt'
  trackName?: string
  carName?: string
  lapNumber?: number
  durationSec?: number
  isBest: boolean
  color: string
  samples: AnalysisLapSample[]
}

export interface AnalysisDeltaBin {
  distancePct: number
  deltaSec: number
}

export interface AnalysisLapDelta {
  lapId: string
  bins: AnalysisDeltaBin[]
}

export interface AnalysisOptimalSector {
  fromPct: number
  toPct: number
  bestLapId: string
  bestSec: number
}

export interface AnalysisOptimal {
  totalSec: number
  bestLapSec: number
  gainSec: number
  sectors: AnalysisOptimalSector[]
}

export interface LossPointInfo {
  lapId: string
  fromPct: number
  toPct: number
  lossSec: number
  cumLossSec: number
  primaryMaxSpeedKmh: number
  bestMaxSpeedKmh: number
  primaryMinSpeedKmh: number
  bestMinSpeedKmh: number
  primaryAvgThrottle: number
  bestAvgThrottle: number
  primaryMaxBrake: number
  bestMaxBrake: number
  primaryBrakeOnsetPct: number | null
  bestBrakeOnsetPct: number | null
  tips: string[]
}

export interface AnalysisLapLosses {
  lapId: string
  totalLossSec: number
  points: LossPointInfo[]
  summary: string[]
}

export interface AnalysisResult {
  profile: AnalysisProfile
  trackKey?: string
  trackLabel?: string
  laps: AnalysisLap[]
  bestLapId: string | null
  optimal: AnalysisOptimal | null
  deltas: AnalysisLapDelta[]
  losses: AnalysisLapLosses[]
  notes: string[]
  insights?: InsightsResult
}

export interface AnalysisRequest {
  profile: AnalysisProfile
  laps: AnalysisLapRef[]
  trackKey?: string
  referenceId?: string
  withInsights?: boolean
}

export interface ReferenceLap {
  id: string
  label: string
  trackKey?: string
  carName?: string
  createdAt: number
  source: 'recording' | 'ibt' | 'csv'
  ref?: AnalysisLapRef
  durationSec?: number
  samples: AnalysisLapSample[]
}

export interface ReferenceLapSummary {
  id: string
  label: string
  trackKey?: string
  carName?: string
  createdAt: number
  source: 'recording' | 'ibt' | 'csv'
  durationSec?: number
  sampleCount: number
}

export interface CoachingInsight {
  id: string
  severity: 'high' | 'med' | 'low'
  lossSec: number
  atPct: number
  sector?: number
  title: string
  detail: string
}

export interface InsightsResult {
  primaryLapId: string
  referenceLapId: string | null
  totalLossSec: number
  insights: CoachingInsight[]
  summary: string[]
}
