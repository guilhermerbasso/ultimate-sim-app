// Shared types for the deterministic "AI Race Engineer" layer.
//
// This file is intentionally SEPARATE from `src/shared/ai.ts` (owned by the LLM
// runtime agent for node-llama-cpp / model types). Here we only describe the
// framework-agnostic contracts used by the deterministic pieces:
//   - the compact Context Pack (pre-digested session snapshot for the prompt),
//   - the Intent Router result union (direct answer / command / passthrough),
//   - the typed Tool descriptors + their return shapes,
//   - the read-only EngineerContext adapter the orchestrator wires to its live
//     engine instances.
//
// Nothing here imports node-llama-cpp; the orchestrator adapts `EngineerTool`
// into node-llama-cpp's `defineChatSessionFunction` at call time.

import type { CoachFinding, CoachTip } from './coach'
import type { FuelPitWindow, FuelStrategyState } from './fuel'
import type { LapTimingState } from './laptiming'
import type { SessionKind, TelemetrySnapshot } from './telemetry'
import type { TireStrategyState } from './tire-strategy'

// ─── Session classification ──────────────────────────────────────────────────

export type { SessionKind } from './telemetry'

export type SessionPhase = 'pre' | 'green' | 'pit' | 'finished' | 'unknown'

// Re-export the fuel pit-window status enum so consumers don't need two imports.
export type FuelStatus = FuelPitWindow['status']

// ─── Context Pack (compact, token-budget aware) ──────────────────────────────

export interface PackCarTrack {
  car?: string
  track?: string
  sim?: string
}

export interface PackSession {
  kind: SessionKind
  rawType?: string
  phase: SessionPhase
  lap?: number
  totalLaps?: number
  lapsRemaining?: number
  timeRemainingSec?: number
  timeOfDay?: string
}

export interface PackPosition {
  position?: number
  classPosition?: number
  totalCars?: number
}

export interface PackTiming {
  lastSec?: number
  bestSec?: number
  predictedSec?: number
  deltaSec?: number
}

export interface PackFuel {
  liters?: number
  perLap?: number
  lapsLeft?: number
  raceLapsRemaining?: number
  toFinishLiters?: number
  deltaToFinishLiters?: number
  saveTargetPerLap?: number
  canFinish?: boolean
  status?: FuelStatus
}

export interface PackTyreCorner {
  tempC?: number
  wearPct?: number
  pressureKpa?: number
}

export interface PackTyres {
  lf?: PackTyreCorner
  rf?: PackTyreCorner
  lr?: PackTyreCorner
  rr?: PackTyreCorner
  worst?: string
  lapsLeft?: number
  estimated?: boolean
}

export interface PackGaps {
  aheadSec?: number
  behindSec?: number
  aheadName?: string
  behindName?: string
}

export interface PackHybrid {
  ersBatteryPct?: number
  p2pAvailable?: boolean
  p2pActive?: boolean
  p2pCount?: number
}

export interface PackWeather {
  airTempC?: number
  trackTempC?: number
  wetnessPct?: number
  raining?: boolean
  declaredWet?: boolean
  surface?: string
  condition?: import('./track-wetness').TrackWetnessState
}

export interface PackPit {
  onPitRoad?: boolean
  pitsOpen?: boolean
  limiter?: boolean
  recommendedLap?: number
  window?: FuelStatus
}

export interface PackEvent {
  at: number
  kind: string
  text: string
}

/** Compact per-sector coach finding carried in the context pack (token-budgeted). */
export interface PackCoachFinding {
  sector: number
  kind: string
  severity: string
  estTimeLossSec: number
  title: string
  groundedText: string
  confidence?: number
  intent?: string
  intentCategory?: string
  intentEvidence?: string[]
}

export interface ContextPack {
  car: PackCarTrack
  session: PackSession
  position: PackPosition
  timing: PackTiming
  fuel: PackFuel
  tyres: PackTyres
  gaps: PackGaps
  hybrid?: PackHybrid
  weather: PackWeather
  pit: PackPit
  flags: string[]
  events: PackEvent[]
  /** Top deterministic coach findings (worst-first), when a lap has been analysed. */
  coachFindings?: PackCoachFinding[]
  /** One-line predictions summary (catch ahead/behind, fuel, cliff, pace), when available. */
  predictions?: string
  referenceLap?: string
  connected: boolean
  generatedAt: number
  estimatedTokens: number
}

// Pre-digested engine states the orchestrator passes in. All optional: when a
// state is absent the builder derives what it can straight from the snapshot.
export interface ContextPackExtras {
  fuel?: FuelStrategyState | null
  tire?: TireStrategyState | null
  lap?: LapTimingState | null
  coachTips?: CoachTip[] | null
  /** Latest deterministic F2 coach findings (worst-first) for the COACHING block. */
  coachFindings?: CoachFinding[] | null
  /** Latest WS-G predictions snapshot for a 1-line PREDICTIONS block. */
  predictions?: import('./predictions').PredictionsSnapshot | null
  events?: PackEvent[] | null
  referenceLapLabel?: string | null
  /** Max recent events to keep in the pack (default 3). */
  maxEvents?: number
  /** Override the generation timestamp (tests/determinism). */
  now?: number
}

// ─── Intent Router result union ──────────────────────────────────────────────

export type IntentCategory =
  | 'fuel'
  | 'pit'
  | 'gap'
  | 'position'
  | 'delta'
  | 'tyres'
  | 'weather'
  | 'strategy'
  | 'laps'

export type IntentLang = 'pt' | 'en'

export type IntentCommandKind =
  | 'dashboard.next'
  | 'dashboard.prev'
  | 'setup.save'
  | 'lap.mark'
  | 'fuel.reset'
  | 'revlights.enable'
  | 'revlights.disable'
  | 'revlights.toggle'

export interface IntentAnswer {
  type: 'answer'
  category: IntentCategory
  lang: IntentLang
  text: string
}

export interface IntentCommand {
  type: 'command'
  kind: IntentCommandKind
  lang: IntentLang
  args?: Record<string, unknown>
  /** Canonical app-action hint for the orchestrator (when one exists). */
  actionHint?: string
  /** Short spoken confirmation the engineer can read back. */
  speak: string
}

export interface IntentPassthrough {
  type: 'passthrough'
  reason?: string
}

export type IntentResult = IntentAnswer | IntentCommand | IntentPassthrough

// ─── Tool descriptors (framework-agnostic) ───────────────────────────────────

export interface ToolParamProperty {
  type: 'string' | 'number' | 'boolean'
  description?: string
  enum?: readonly string[]
}

export interface ToolParamsSchema {
  type: 'object'
  properties: Record<string, ToolParamProperty>
  required?: string[]
}

export interface EngineerTool<TArgs = Record<string, unknown>, TResult = unknown> {
  name: string
  description: string
  parameters: ToolParamsSchema
  run(args: TArgs): Promise<TResult>
}

export type EngineerToolset = Record<string, EngineerTool>

// Read-only adapter the orchestrator wires to its live engine instances. Only
// `getSnapshot` is required; the rest let callers feed pre-computed engine
// states so tools mirror the real modules instead of recomputing.
export interface EngineerContext {
  getSnapshot(): TelemetrySnapshot | null
  getFuelState?(): FuelStrategyState | null | undefined
  getTireState?(): TireStrategyState | null | undefined
  getLapTiming?(): LapTimingState | null | undefined
  getCoachTips?(): CoachTip[] | null | undefined
  /**
   * Latest deterministic F2 coach findings (worst-first). Lets the engineer —
   * proactive AND on-demand — cite REAL coaching instead of inventing advice.
   */
  getCoachFindings?(): CoachFinding[] | null | undefined
  getReferenceLapLabel?(): string | null | undefined
  getRecentEvents?(): PackEvent[] | null | undefined
  /**
   * Latest WS-G predictions snapshot (catch ahead/behind, fuel-to-the-end
   * margin, tyre wear/cliff, projected pace). Optional so existing wiring keeps
   * compiling; `null`/`undefined` means "no prediction available".
   */
  getPredictions?(): import('./predictions').PredictionsSnapshot | null | undefined
  now?(): number
}

// ─── Tool return shapes (contract for the orchestrator) ──────────────────────

export interface FuelToolResult {
  available: boolean
  fuelLiters?: number
  fuelPerLap?: number
  lapsLeft?: number
  raceLapsRemaining?: number
  fuelToFinishLiters?: number
  deltaToFinishLiters?: number
  saveTargetPerLap?: number
  canFinish?: boolean
  status?: FuelStatus
  summary: string
}

export interface DeltaToolResult {
  available: boolean
  deltaToBestSec?: number
  lastLapSec?: number
  bestLapSec?: number
  predictedSec?: number
  trend?: 'gaining' | 'losing' | 'flat'
  summary: string
}

export interface StrategyToolResult {
  available: boolean
  recommendPit: boolean
  reason: string
  fuelStatus?: FuelStatus
  fuelLapsLeft?: number
  tyreLapsLeft?: number
  recommendedPitLap?: number
  summary: string
}

export interface GapsToolResult {
  available: boolean
  aheadSec?: number
  behindSec?: number
  aheadName?: string
  behindName?: string
  summary: string
}

export interface PositionToolResult {
  available: boolean
  position?: number
  classPosition?: number
  totalCars?: number
  summary: string
}

export interface TyreCornerToolResult {
  id: string
  tempC?: number
  wearPct?: number
  lapsToThreshold?: number
}

export interface TyresToolResult {
  available: boolean
  corners: TyreCornerToolResult[]
  worstCorner?: string
  lapsLeft?: number
  estimated: boolean
  summary: string
}

export interface WeatherToolResult {
  available: boolean
  airTempC?: number
  trackTempC?: number
  wetnessPct?: number
  raining?: boolean
  declaredWet?: boolean
  surface?: string
  summary: string
}

export interface CarTrackToolResult {
  available: boolean
  car?: string
  track?: string
  sim?: string
  sessionType?: string
  summary: string
}

export interface RecentEventsToolResult {
  events: PackEvent[]
  summary: string
}

export interface CoachTipToolResult {
  severity: string
  message: string
  sector?: number
  kind?: string
}

export interface CoachTipsToolResult {
  tips: CoachTipToolResult[]
  summary: string
}

export interface CoachFindingToolResult {
  kind: string
  sector: number
  severity: string
  estTimeLossSec: number
  title: string
  detail: string
  evidence: string
}

export interface CoachFindingsToolResult {
  available: boolean
  findings: CoachFindingToolResult[]
  summary: string
}

export interface PredictionsToolResult {
  available: boolean
  catchAheadSec?: number
  catchAheadLaps?: number
  catchAheadCarIdx?: number
  caughtBehindSec?: number
  caughtBehindLaps?: number
  caughtBehindCarIdx?: number
  fuelMarginLaps?: number
  fuelMarginL?: number
  tireDegSecPerLap?: number
  lapsToCliff?: number
  pressureState?: string
  tempState?: string
  projectedLapSec?: number
  paceConfidence?: number
  summary: string
}
