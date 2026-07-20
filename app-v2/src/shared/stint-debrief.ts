// STINT/SESSION DEBRIEF — PURE, deterministic composer (WS-I).
//
// IMPORTANT: this file is dependency-free (no node:*, no electron, no model
// runtime) exactly like shared/predictions.ts / shared/strategy.ts, so it can be
// imported by main, renderer AND the unit tests without dragging in any runtime.
// It carries ONLY the shared CONTRACT TYPES + the pure debrief math.
//
// At the end of a stint/session the AI Coach's deterministic FINDINGS (biggest
// time LOSSES + GAINS — WS-E adds bidirectional, per-corner findings) and the
// PredictionsSnapshot (fuel margin, tyre deg/cliff, pace — WS-G) are folded into
// a SHORT localized debrief: an executive `text` paragraph + concise `bullets`.
//
// The local Qwen LLM (main/modules/stint-debrief.ts) only PHRASES this on demand
// and ALWAYS falls back to the deterministic `text` here — the model is never
// loaded or run from the telemetry loop.

import { coachComposeAction, type CoachFinding } from './coach'
import type { PredictionsSnapshot } from './predictions'
import type { AppLanguage } from './settings'
import type {
  SetupAdjustment,
  SetupReport,
  SetupSuggestion
} from './setup-advisor'
import type { SpeechLanguage } from './tts-voice'
import { formatMeasurement, type UnitSystem } from './units'

// ─── IPC channels (all under the `debrief:` preload allowlist prefix) ─────────

export const DEBRIEF_CHANNELS = {
  /** invoke(DebriefGenerateRequest) → StintDebrief. */
  generate: 'debrief:generate',
  /** invoke() → StintDebrief | null (the last one composed). */
  last: 'debrief:last',
  /** invoke() → DebriefArchiveSummary[] (newest first). */
  archiveList: 'debrief:archive:list',
  /** invoke(DebriefArchiveGenerateRequest) → DebriefArchiveGenerateResult. */
  archiveGenerate: 'debrief:archive:generate',
  /** Broadcast after a newly captured archive record is durable. */
  archiveUpdated: 'debrief:archive:updated',
  /** Broadcast: a freshly composed debrief (after a generate). */
  updated: 'debrief:updated',
  /** Broadcast: immutable ended-session facts; main already auto-generated the debrief. */
  trigger: 'debrief:trigger'
} as const

export type DebriefChannel = (typeof DEBRIEF_CHANNELS)[keyof typeof DEBRIEF_CHANNELS]

// ─── Contract types ──────────────────────────────────────────────────────────

/** Why a debrief was produced. */
export type DebriefReason = 'stint-end' | 'session-end' | 'manual'

/** Lightweight session context shown in the debrief header. */
export interface DebriefSessionInfo {
  trackName?: string
  carName?: string
  sessionType?: string
  /** Laps completed in the stint/session. */
  lapsCompleted?: number
  /** Driver's best lap (seconds) for the stint/session. */
  bestLapTimeSec?: number
  reason?: DebriefReason
}

/** What the pure composer returns. */
export interface DebriefComposition {
  /** Executive localized paragraph (deterministic). */
  text: string
  /** Concise localized bullets (losses, gains, strategy). */
  bullets: string[]
}

/** Request payload for `debrief:generate`. */
export interface DebriefGenerateRequest {
  findings?: CoachFinding[]
  predictions?: PredictionsSnapshot | null
  sessionInfo?: DebriefSessionInfo
  /** When true, try the local LLM to phrase; otherwise return deterministic text. */
  useLlm?: boolean
}

/** Immutable ended-session snapshot carried by `debrief:trigger`. */
export interface DebriefTriggerPayload {
  reason: Exclude<DebriefReason, 'manual'>
  findings: CoachFinding[]
  predictions: PredictionsSnapshot | null
  sessionInfo: DebriefSessionInfo
}

/** The composed debrief, broadcast on `debrief:updated` and returned by IPC. */
export interface StintDebrief extends DebriefComposition {
  generatedAt: number
  /** Whether the `text` was phrased by the LLM or is the deterministic fallback. */
  source: 'deterministic' | 'llm'
  language: SpeechLanguage
  reason: DebriefReason
  sessionInfo?: DebriefSessionInfo
}

export const DEBRIEF_ARCHIVE_SCHEMA = 'ultimate-sim-app.stint-debrief-archive' as const
export const DEBRIEF_ARCHIVE_RECORD_SCHEMA = 'ultimate-sim-app.stint-debrief-analysis' as const
export const DEBRIEF_ARCHIVE_VERSION = 1 as const
export const DEBRIEF_ARCHIVE_MAX_RECORDS = 50
export const DEBRIEF_ARCHIVE_MAX_BYTES = 8 * 1024 * 1024
export const DEBRIEF_ARCHIVE_MAX_RECORD_BYTES = 512 * 1024
export const DEBRIEF_ARCHIVE_ID_PATTERN = /^debrief_[A-Za-z0-9_-]{16,96}$/

export type DebriefCaptureSource = 'boundary' | 'legacy-last-debrief'
export type DebriefMetadataQuality = 'captured' | 'legacy-defaults'
export type DebriefSetupStatus = 'available' | 'insufficient' | 'legacy'
export type DebriefAnalysisStatus = 'available' | 'insufficient' | 'legacy'

/** Immutable, local-only ended-session analysis facts. */
export interface DebriefArchiveRecord {
  schema: typeof DEBRIEF_ARCHIVE_RECORD_SCHEMA
  version: typeof DEBRIEF_ARCHIVE_VERSION
  id: string
  capturedAt: number
  reason: DebriefReason
  sessionInfo: DebriefSessionInfo
  findings: CoachFinding[]
  predictions: PredictionsSnapshot | null
  setup: SetupReport | null
  /** Exact deterministic fallback captured at the boundary (legacy text for migrations). */
  debrief: StintDebrief
  language: SpeechLanguage
  unitSystem: UnitSystem
  appLanguage: AppLanguage
  locale: string
  captureSource: DebriefCaptureSource
  metadataQuality: DebriefMetadataQuality
}

export interface DebriefArchive {
  schema: typeof DEBRIEF_ARCHIVE_SCHEMA
  version: typeof DEBRIEF_ARCHIVE_VERSION
  records: DebriefArchiveRecord[]
}

export interface DebriefArchiveSummary {
  id: string
  capturedAt: number
  reason: DebriefReason
  sessionInfo: DebriefSessionInfo
  language: SpeechLanguage
  unitSystem: UnitSystem
  captureSource: DebriefCaptureSource
  setupStatus: DebriefSetupStatus
  analysisStatus: DebriefAnalysisStatus
}

export interface DebriefArchiveGenerateRequest {
  sessionId: string
  /** The model may phrase only the persisted paragraph; setup remains byte-for-byte factual. */
  useLlm?: boolean
}

export interface DebriefArchiveGenerateResult {
  sessionId: string
  debrief: StintDebrief
  setup: SetupReport | null
  captureSource: DebriefCaptureSource
  setupStatus: DebriefSetupStatus
  analysisStatus: DebriefAnalysisStatus
}

export interface DebriefArchiveUpdatedPayload {
  latest: DebriefArchiveSummary
  count: number
}

/**
 * Forward-compatible view of a finding. WS-E enriches `CoachFinding` with
 * bidirectional signals (a `sign`, a positive `estTimeGainSec`/`deltaSec`, and a
 * `corner` number). We read those defensively so the composer picks up GAINS the
 * moment they exist, without this file having to change.
 */
type EnrichedFinding = CoachFinding & {
  sign?: 'loss' | 'gain'
  estTimeGainSec?: number
  deltaSec?: number
  corner?: number
}

// ─── small pure helpers ──────────────────────────────────────────────────────

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function own(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function boundedString(
  value: unknown,
  maxLength: number,
  options: { allowEmpty?: boolean; trim?: boolean } = {}
): string | null {
  if (typeof value !== 'string' || value.length > maxLength) return null
  const normalized = options.trim === false ? value : value.trim()
  if (!options.allowEmpty && normalized.length === 0) return null
  return normalized
}

function optionalString(
  object: Record<string, unknown>,
  key: string,
  maxLength: number
): string | undefined | null {
  if (!own(object, key) || object[key] === undefined) return undefined
  const value = boundedString(object[key], maxLength)
  return value === null ? null : value
}

function optionalFinite(
  object: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number; integer?: boolean } = {}
): number | undefined | null {
  if (!own(object, key) || object[key] === undefined) return undefined
  const value = object[key]
  if (
    !finite(value) ||
    (options.integer === true && !Number.isSafeInteger(value)) ||
    (options.min !== undefined && value < options.min) ||
    (options.max !== undefined && value > options.max)
  ) {
    return null
  }
  return value
}

function optionalBoolean(
  object: Record<string, unknown>,
  key: string
): boolean | undefined | null {
  if (!own(object, key) || object[key] === undefined) return undefined
  return typeof object[key] === 'boolean' ? object[key] : null
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function utf8Bytes(value: string): number {
  let bytes = 0
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 0x7f) bytes += 1
    else if (codePoint <= 0x7ff) bytes += 2
    else if (codePoint <= 0xffff) bytes += 3
    else bytes += 4
  }
  return bytes
}

function serializedBytes(value: unknown): number {
  try {
    return utf8Bytes(JSON.stringify(value))
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

const DEBRIEF_REASONS: readonly DebriefReason[] = ['stint-end', 'session-end', 'manual']
const MAX_DATE_MS = 8_640_000_000_000_000
const SPEECH_LANGUAGES: readonly SpeechLanguage[] = ['pt-BR', 'en-US']
const UNIT_SYSTEMS: readonly UnitSystem[] = ['metric', 'imperial']
const APP_LANGUAGES: readonly AppLanguage[] = ['auto', 'pt-BR', 'en', 'es', 'fr', 'de', 'zh', 'ja']
const CAPTURE_SOURCES: readonly DebriefCaptureSource[] = ['boundary', 'legacy-last-debrief']
const METADATA_QUALITIES: readonly DebriefMetadataQuality[] = ['captured', 'legacy-defaults']
const FINDING_KINDS = new Set([
  'brake-early',
  'brake-late',
  'throttle-early',
  'throttle-late',
  'steering-early',
  'steering-late',
  'trail-brake-lock',
  'coast',
  'throttle-hesitation',
  'abs-overuse',
  'tc-overuse',
  'steering-busy',
  'steering-insufficient',
  'inconsistency',
  'time-loss',
  'min-speed-gain',
  'brake-gain',
  'throttle-gain',
  'good'
])
const FINDING_PHASES = new Set(['entry', 'mid', 'exit'])
const FINDING_SEVERITIES = new Set(['high', 'med', 'low', 'good'])
const SETUP_SYMPTOMS = new Set([
  'understeer-entry',
  'understeer-mid',
  'understeer-exit',
  'oversteer-entry',
  'oversteer-mid',
  'oversteer-exit',
  'tyre-overheat',
  'tyre-cold',
  'tyre-temp-imbalance-lr',
  'camber-excess',
  'camber-lack',
  'pressure-high',
  'pressure-low',
  'brake-lock-front',
  'brake-lock-rear'
])
const SETUP_CORNERS = new Set(['lf', 'rf', 'lr', 'rr', 'front', 'rear', 'left', 'right', 'all'])
const SETUP_CONFIDENCES = new Set(['low', 'med', 'high'])
const SETUP_AREAS = new Set([
  'aero',
  'arb',
  'springs',
  'dampers',
  'differential',
  'tyres',
  'brakes',
  'alignment',
  'ride-height'
])
const SETUP_DIRECTIONS = new Set([
  'increase',
  'decrease',
  'soften',
  'stiffen',
  'forward',
  'rearward',
  'adjust'
])
const SETUP_MAGNITUDES = new Set(['small', 'medium', 'large'])

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : null
}

function normalizeMetrics(value: unknown, maxEntries = 64): Record<string, number> | null {
  if (!plainObject(value)) return null
  const entries = Object.entries(value)
  if (entries.length > maxEntries) return null
  const metrics: Record<string, number> = {}
  for (const [rawKey, rawValue] of entries) {
    const key = boundedString(rawKey, 80)
    if (key === null || !finite(rawValue)) return null
    metrics[key] = rawValue
  }
  return metrics
}

function normalizeSessionInfo(
  value: unknown,
  expectedReason?: DebriefReason
): DebriefSessionInfo | null {
  if (!plainObject(value)) return null
  const trackName = optionalString(value, 'trackName', 256)
  const carName = optionalString(value, 'carName', 256)
  const sessionType = optionalString(value, 'sessionType', 128)
  const lapsCompleted = optionalFinite(value, 'lapsCompleted', { min: 0, max: 1_000_000 })
  const bestLapTimeSec = optionalFinite(value, 'bestLapTimeSec', { min: 0, max: 86_400 })
  if (
    trackName === null ||
    carName === null ||
    sessionType === null ||
    lapsCompleted === null ||
    bestLapTimeSec === null
  ) {
    return null
  }
  let reason: DebriefReason | undefined
  if (own(value, 'reason') && value.reason !== undefined) {
    reason = enumValue(value.reason, DEBRIEF_REASONS) ?? undefined
    if (!reason) return null
  }
  if (expectedReason && reason && reason !== expectedReason) return null
  return {
    ...(trackName !== undefined ? { trackName } : {}),
    ...(carName !== undefined ? { carName } : {}),
    ...(sessionType !== undefined ? { sessionType } : {}),
    ...(lapsCompleted !== undefined ? { lapsCompleted } : {}),
    ...(bestLapTimeSec !== undefined ? { bestLapTimeSec } : {}),
    ...(reason !== undefined ? { reason } : expectedReason ? { reason: expectedReason } : {})
  }
}

function normalizeFinding(value: unknown): CoachFinding | null {
  if (!plainObject(value)) return null
  const id = boundedString(value.id, 256)
  const kind = boundedString(value.kind, 64)
  const phase = optionalString(value, 'phase', 16)
  const sector = optionalFinite(value, 'sector', { min: 0, max: 100, integer: true })
  const corner = optionalFinite(value, 'corner', { min: 1, max: 1_000, integer: true })
  const cornerPctStart = optionalFinite(value, 'cornerPctStart', { min: 0, max: 1 })
  const cornerPctEnd = optionalFinite(value, 'cornerPctEnd', { min: 0, max: 1 })
  const zonePctStart = optionalFinite(value, 'zonePctStart', { min: 0, max: 1 })
  const zonePctEnd = optionalFinite(value, 'zonePctEnd', { min: 0, max: 1 })
  const severity = boundedString(value.severity, 16)
  const estTimeLossSec = optionalFinite(value, 'estTimeLossSec', { min: 0, max: 3_600 })
  const estTimeDeltaSec = optionalFinite(value, 'estTimeDeltaSec', { min: -3_600, max: 3_600 })
  const sign = optionalString(value, 'sign', 16)
  const title = boundedString(value.title, 1_024, { allowEmpty: true, trim: false })
  const detail = boundedString(value.detail, 4_096, { allowEmpty: true, trim: false })
  const explanation = optionalString(value, 'explanation', 4_096)
  const evidence = boundedString(value.evidence, 4_096, { allowEmpty: true, trim: false })
  const confidence = optionalFinite(value, 'confidence', { min: 0, max: 1 })
  const intent = optionalString(value, 'intent', 128)
  const intentCategory = optionalString(value, 'intentCategory', 64)
  const context = optionalBoolean(value, 'context')
  const metrics = normalizeMetrics(value.metrics)
  if (
    id === null ||
    kind === null ||
    !FINDING_KINDS.has(kind) ||
    phase === null ||
    (phase !== undefined && !FINDING_PHASES.has(phase)) ||
    sector === null ||
    sector === undefined ||
    corner === null ||
    cornerPctStart === null ||
    cornerPctEnd === null ||
    zonePctStart === null ||
    zonePctStart === undefined ||
    zonePctEnd === null ||
    zonePctEnd === undefined ||
    severity === null ||
    !FINDING_SEVERITIES.has(severity) ||
    estTimeLossSec === null ||
    estTimeLossSec === undefined ||
    estTimeDeltaSec === null ||
    sign === null ||
    (sign !== undefined && sign !== 'loss' && sign !== 'gain') ||
    title === null ||
    detail === null ||
    explanation === null ||
    evidence === null ||
    confidence === null ||
    intent === null ||
    intentCategory === null ||
    context === null ||
    metrics === null
  ) {
    return null
  }
  let intentEvidence: string[] | undefined
  if (own(value, 'intentEvidence') && value.intentEvidence !== undefined) {
    if (!Array.isArray(value.intentEvidence) || value.intentEvidence.length > 32) return null
    intentEvidence = []
    for (const raw of value.intentEvidence) {
      const line = boundedString(raw, 1_024, { allowEmpty: true, trim: false })
      if (line === null) return null
      intentEvidence.push(line)
    }
  }
  return {
    id,
    kind: kind as CoachFinding['kind'],
    ...(phase !== undefined ? { phase: phase as CoachFinding['phase'] } : {}),
    sector,
    ...(corner !== undefined ? { corner } : {}),
    ...(cornerPctStart !== undefined ? { cornerPctStart } : {}),
    ...(cornerPctEnd !== undefined ? { cornerPctEnd } : {}),
    zonePctStart,
    zonePctEnd,
    severity: severity as CoachFinding['severity'],
    estTimeLossSec,
    ...(estTimeDeltaSec !== undefined ? { estTimeDeltaSec } : {}),
    ...(sign !== undefined ? { sign: sign as CoachFinding['sign'] } : {}),
    title,
    detail,
    ...(explanation !== undefined ? { explanation } : {}),
    evidence,
    metrics,
    ...(confidence !== undefined ? { confidence } : {}),
    ...(intent !== undefined ? { intent: intent as CoachFinding['intent'] } : {}),
    ...(intentCategory !== undefined
      ? { intentCategory: intentCategory as CoachFinding['intentCategory'] }
      : {}),
    ...(intentEvidence !== undefined ? { intentEvidence } : {}),
    ...(context !== undefined ? { context } : {})
  }
}

function normalizeCatchEstimate(value: unknown): PredictionsSnapshot['catchAhead'] | null {
  if (!plainObject(value)) return null
  const carIdx = optionalFinite(value, 'carIdx', { min: 0, max: 10_000, integer: true })
  const gapSec = optionalFinite(value, 'gapSec', { min: 0, max: 86_400 })
  const closingSecPerLap = optionalFinite(value, 'closingSecPerLap', { min: 0, max: 3_600 })
  const etaSec = optionalFinite(value, 'etaSec', { min: 0, max: 31_536_000 })
  const etaLaps = optionalFinite(value, 'etaLaps', { min: 0, max: 1_000_000 })
  const lowConfidence = optionalBoolean(value, 'lowConfidence')
  if (
    carIdx === null ||
    carIdx === undefined ||
    gapSec === null ||
    gapSec === undefined ||
    closingSecPerLap === null ||
    closingSecPerLap === undefined ||
    etaSec === null ||
    etaSec === undefined ||
    etaLaps === null ||
    etaLaps === undefined ||
    lowConfidence === null
  ) {
    return null
  }
  return {
    carIdx,
    gapSec,
    closingSecPerLap,
    etaSec,
    etaLaps,
    ...(lowConfidence !== undefined ? { lowConfidence } : {})
  }
}

function normalizePredictions(value: unknown): PredictionsSnapshot | null {
  if (!plainObject(value) || !plainObject(value.fuel) || !plainObject(value.tire) || !plainObject(value.pace)) {
    return null
  }
  const lapsLeftAtPace = optionalFinite(value.fuel, 'lapsLeftAtPace', { min: 0, max: 1_000_000 })
  const finishMarginLaps = optionalFinite(value.fuel, 'finishMarginLaps', {
    min: -1_000_000,
    max: 1_000_000
  })
  const finishMarginL = optionalFinite(value.fuel, 'finishMarginL', {
    min: -10_000_000,
    max: 10_000_000
  })
  const degSecPerLap = optionalFinite(value.tire, 'degSecPerLap', { min: 0, max: 3_600 })
  const lapsToCliff = optionalFinite(value.tire, 'lapsToCliff', { min: 0, max: 1_000_000 })
  const pressureState = boundedString(value.tire.pressureState, 16)
  const tempState = boundedString(value.tire.tempState, 16)
  const projectedLapSec = optionalFinite(value.pace, 'projectedLapSec', { min: 0, max: 86_400 })
  const paceConfidence = optionalFinite(value.pace, 'confidence', { min: 0, max: 1 })
  if (
    lapsLeftAtPace === null ||
    lapsLeftAtPace === undefined ||
    finishMarginLaps === null ||
    finishMarginL === null ||
    degSecPerLap === null ||
    degSecPerLap === undefined ||
    lapsToCliff === null ||
    pressureState === null ||
    !['low', 'ok', 'high'].includes(pressureState) ||
    tempState === null ||
    !['cold', 'optimal', 'hot'].includes(tempState) ||
    projectedLapSec === null ||
    projectedLapSec === undefined ||
    paceConfidence === null ||
    paceConfidence === undefined
  ) {
    return null
  }
  let catchAhead: PredictionsSnapshot['catchAhead']
  let caughtBehind: PredictionsSnapshot['caughtBehind']
  if (own(value, 'catchAhead') && value.catchAhead !== undefined) {
    const normalized = normalizeCatchEstimate(value.catchAhead)
    if (!normalized) return null
    catchAhead = normalized
  }
  if (own(value, 'caughtBehind') && value.caughtBehind !== undefined) {
    const normalized = normalizeCatchEstimate(value.caughtBehind)
    if (!normalized) return null
    caughtBehind = normalized
  }
  return {
    ...(catchAhead ? { catchAhead } : {}),
    ...(caughtBehind ? { caughtBehind } : {}),
    fuel: {
      lapsLeftAtPace,
      ...(finishMarginLaps !== undefined ? { finishMarginLaps } : {}),
      ...(finishMarginL !== undefined ? { finishMarginL } : {})
    },
    tire: {
      degSecPerLap,
      ...(lapsToCliff !== undefined ? { lapsToCliff } : {}),
      pressureState: pressureState as PredictionsSnapshot['tire']['pressureState'],
      tempState: tempState as PredictionsSnapshot['tire']['tempState']
    },
    pace: { projectedLapSec, confidence: paceConfidence }
  }
}

function normalizeSetupAdjustment(value: unknown): SetupAdjustment | null {
  if (!plainObject(value)) return null
  const area = boundedString(value.area, 32)
  const direction = boundedString(value.direction, 32)
  const magnitude = boundedString(value.magnitude, 16)
  const change = boundedString(value.change, 2_048, { allowEmpty: true, trim: false })
  if (
    area === null ||
    !SETUP_AREAS.has(area) ||
    direction === null ||
    !SETUP_DIRECTIONS.has(direction) ||
    magnitude === null ||
    !SETUP_MAGNITUDES.has(magnitude) ||
    change === null
  ) {
    return null
  }
  return {
    area: area as SetupAdjustment['area'],
    direction: direction as SetupAdjustment['direction'],
    magnitude: magnitude as SetupAdjustment['magnitude'],
    change
  }
}

function normalizeSetupSuggestion(value: unknown): SetupSuggestion | null {
  if (!plainObject(value)) return null
  const id = boundedString(value.id, 256)
  const symptom = boundedString(value.symptom, 64)
  const phase = optionalString(value, 'phase', 16)
  const corner = optionalString(value, 'corner', 16)
  const confidence = boundedString(value.confidence, 16)
  const rationale = boundedString(value.rationale, 4_096, { allowEmpty: true, trim: false })
  const evidence = boundedString(value.evidence, 4_096, { allowEmpty: true, trim: false })
  const primary = normalizeSetupAdjustment(value.primary)
  const metrics = normalizeMetrics(value.metrics)
  if (
    id === null ||
    symptom === null ||
    !SETUP_SYMPTOMS.has(symptom) ||
    phase === null ||
    (phase !== undefined && !FINDING_PHASES.has(phase)) ||
    corner === null ||
    (corner !== undefined && !SETUP_CORNERS.has(corner)) ||
    confidence === null ||
    !SETUP_CONFIDENCES.has(confidence) ||
    rationale === null ||
    evidence === null ||
    primary === null ||
    metrics === null ||
    !Array.isArray(value.alternatives) ||
    value.alternatives.length > 16
  ) {
    return null
  }
  const alternatives: SetupAdjustment[] = []
  for (const rawAlternative of value.alternatives) {
    const alternative = normalizeSetupAdjustment(rawAlternative)
    if (!alternative) return null
    alternatives.push(alternative)
  }
  return {
    id,
    symptom: symptom as SetupSuggestion['symptom'],
    ...(phase !== undefined ? { phase: phase as SetupSuggestion['phase'] } : {}),
    ...(corner !== undefined ? { corner: corner as SetupSuggestion['corner'] } : {}),
    confidence: confidence as SetupSuggestion['confidence'],
    rationale,
    evidence,
    primary,
    alternatives,
    metrics
  }
}

function normalizeSetupReport(value: unknown): SetupReport | null {
  if (!plainObject(value)) return null
  const generatedAt = optionalFinite(value, 'generatedAt', { min: 0, max: MAX_DATE_MS })
  const summary = boundedString(value.summary, 4_096, { allowEmpty: true, trim: false })
  if (
    generatedAt === null ||
    generatedAt === undefined ||
    summary === null ||
    !Array.isArray(value.suggestions) ||
    value.suggestions.length > 32
  ) {
    return null
  }
  const suggestions: SetupSuggestion[] = []
  for (const rawSuggestion of value.suggestions) {
    const suggestion = normalizeSetupSuggestion(rawSuggestion)
    if (!suggestion) return null
    suggestions.push(suggestion)
  }
  return { generatedAt, suggestions, summary }
}

/** Strictly validate persisted debriefs; invalid or oversized data fails closed. */
export function normalizeStintDebrief(value: unknown): StintDebrief | null {
  if (!plainObject(value)) return null
  const generatedAt = optionalFinite(value, 'generatedAt', { min: 0, max: MAX_DATE_MS })
  const text = boundedString(value.text, 16_384, { allowEmpty: true, trim: false })
  const source = enumValue(value.source, ['deterministic', 'llm'] as const)
  const language = enumValue(value.language, SPEECH_LANGUAGES)
  const reason = enumValue(value.reason, DEBRIEF_REASONS)
  if (
    generatedAt === null ||
    generatedAt === undefined ||
    text === null ||
    source === null ||
    language === null ||
    reason === null ||
    !Array.isArray(value.bullets) ||
    value.bullets.length > 32
  ) {
    return null
  }
  const bullets: string[] = []
  for (const rawBullet of value.bullets) {
    const bullet = boundedString(rawBullet, 4_096, { allowEmpty: true, trim: false })
    if (bullet === null) return null
    bullets.push(bullet)
  }
  let sessionInfo: DebriefSessionInfo | undefined
  if (own(value, 'sessionInfo') && value.sessionInfo !== undefined) {
    const normalized = normalizeSessionInfo(value.sessionInfo, reason)
    if (!normalized) return null
    sessionInfo = normalized
  }
  const normalized: StintDebrief = {
    generatedAt,
    text,
    bullets,
    source,
    language,
    reason,
    ...(sessionInfo ? { sessionInfo } : {})
  }
  return serializedBytes(normalized) <= DEBRIEF_ARCHIVE_MAX_RECORD_BYTES ? normalized : null
}

export function isDebriefArchiveSessionId(value: unknown): value is string {
  return typeof value === 'string' && DEBRIEF_ARCHIVE_ID_PATTERN.test(value)
}

/** Strict renderer-to-main request validator. */
export function normalizeDebriefArchiveGenerateRequest(
  value: unknown
): DebriefArchiveGenerateRequest | null {
  if (!plainObject(value) || !isDebriefArchiveSessionId(value.sessionId)) return null
  if (own(value, 'useLlm') && value.useLlm !== undefined && typeof value.useLlm !== 'boolean') {
    return null
  }
  return {
    sessionId: value.sessionId,
    ...(value.useLlm !== undefined ? { useLlm: value.useLlm as boolean } : {})
  }
}

/** Strict archive-record validator used on load and before every write. */
export function normalizeDebriefArchiveRecord(value: unknown): DebriefArchiveRecord | null {
  if (
    !plainObject(value) ||
    value.schema !== DEBRIEF_ARCHIVE_RECORD_SCHEMA ||
    value.version !== DEBRIEF_ARCHIVE_VERSION ||
    !isDebriefArchiveSessionId(value.id)
  ) {
    return null
  }
  const capturedAt = optionalFinite(value, 'capturedAt', { min: 0, max: MAX_DATE_MS })
  const reason = enumValue(value.reason, DEBRIEF_REASONS)
  const language = enumValue(value.language, SPEECH_LANGUAGES)
  const unitSystem = enumValue(value.unitSystem, UNIT_SYSTEMS)
  const appLanguage = enumValue(value.appLanguage, APP_LANGUAGES)
  const locale = boundedString(value.locale, 64)
  const captureSource = enumValue(value.captureSource, CAPTURE_SOURCES)
  const metadataQuality = enumValue(value.metadataQuality, METADATA_QUALITIES)
  if (
    capturedAt === null ||
    capturedAt === undefined ||
    reason === null ||
    language === null ||
    unitSystem === null ||
    appLanguage === null ||
    locale === null ||
    captureSource === null ||
    metadataQuality === null
  ) {
    return null
  }
  const sessionInfo = normalizeSessionInfo(value.sessionInfo, reason)
  const debrief = normalizeStintDebrief(value.debrief)
  if (
    !sessionInfo ||
    !debrief ||
    debrief.reason !== reason ||
    debrief.language !== language ||
    !Array.isArray(value.findings) ||
    value.findings.length > 128
  ) {
    return null
  }
  const findings: CoachFinding[] = []
  for (const rawFinding of value.findings) {
    const finding = normalizeFinding(rawFinding)
    if (!finding) return null
    findings.push(finding)
  }
  let predictions: PredictionsSnapshot | null
  if (value.predictions === null) predictions = null
  else {
    predictions = normalizePredictions(value.predictions)
    if (!predictions) return null
  }
  let setup: SetupReport | null
  if (value.setup === null) setup = null
  else {
    setup = normalizeSetupReport(value.setup)
    if (!setup) return null
  }
  const normalized: DebriefArchiveRecord = {
    schema: DEBRIEF_ARCHIVE_RECORD_SCHEMA,
    version: DEBRIEF_ARCHIVE_VERSION,
    id: value.id,
    capturedAt,
    reason,
    sessionInfo,
    findings,
    predictions,
    setup,
    debrief,
    language,
    unitSystem,
    appLanguage,
    locale,
    captureSource,
    metadataQuality
  }
  return serializedBytes(normalized) <= DEBRIEF_ARCHIVE_MAX_RECORD_BYTES
    ? cloneJson(normalized)
    : null
}

function archiveOrder(left: DebriefArchiveRecord, right: DebriefArchiveRecord): number {
  return right.capturedAt - left.capturedAt || left.id.localeCompare(right.id)
}

/**
 * Normalize, deduplicate and bound an archive. Any malformed record invalidates
 * the entire payload; valid oversized archives retain only the newest records.
 */
export function normalizeDebriefArchive(value: unknown): DebriefArchive | null {
  if (
    !plainObject(value) ||
    value.schema !== DEBRIEF_ARCHIVE_SCHEMA ||
    value.version !== DEBRIEF_ARCHIVE_VERSION ||
    !Array.isArray(value.records) ||
    value.records.length > 500
  ) {
    return null
  }
  const deduplicated = new Map<string, DebriefArchiveRecord>()
  for (const rawRecord of value.records) {
    const record = normalizeDebriefArchiveRecord(rawRecord)
    if (!record) return null
    const previous = deduplicated.get(record.id)
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(record)) return null
      continue
    }
    deduplicated.set(record.id, record)
  }
  const records = [...deduplicated.values()]
    .sort(archiveOrder)
    .slice(0, DEBRIEF_ARCHIVE_MAX_RECORDS)
  while (
    records.length > 0 &&
    serializedBytes({
      schema: DEBRIEF_ARCHIVE_SCHEMA,
      version: DEBRIEF_ARCHIVE_VERSION,
      records
    }) > DEBRIEF_ARCHIVE_MAX_BYTES
  ) {
    records.pop()
  }
  const normalized: DebriefArchive = {
    schema: DEBRIEF_ARCHIVE_SCHEMA,
    version: DEBRIEF_ARCHIVE_VERSION,
    records
  }
  return serializedBytes(normalized) <= DEBRIEF_ARCHIVE_MAX_BYTES
    ? cloneJson(normalized)
    : null
}

export function createDebriefArchive(
  records: readonly DebriefArchiveRecord[]
): DebriefArchive | null {
  return normalizeDebriefArchive({
    schema: DEBRIEF_ARCHIVE_SCHEMA,
    version: DEBRIEF_ARCHIVE_VERSION,
    records
  })
}

export function debriefSetupStatus(record: DebriefArchiveRecord): DebriefSetupStatus {
  if (record.captureSource === 'legacy-last-debrief') return 'legacy'
  return record.setup && record.setup.suggestions.length > 0 ? 'available' : 'insufficient'
}

export function debriefAnalysisStatus(record: DebriefArchiveRecord): DebriefAnalysisStatus {
  if (record.captureSource === 'legacy-last-debrief') return 'legacy'
  return record.findings.length > 0 || record.predictions !== null ? 'available' : 'insufficient'
}

export function debriefArchiveSummary(record: DebriefArchiveRecord): DebriefArchiveSummary {
  return {
    id: record.id,
    capturedAt: record.capturedAt,
    reason: record.reason,
    sessionInfo: cloneJson(record.sessionInfo),
    language: record.language,
    unitSystem: record.unitSystem,
    captureSource: record.captureSource,
    setupStatus: debriefSetupStatus(record),
    analysisStatus: debriefAnalysisStatus(record)
  }
}

/** Localized fixed-decimal number with no grouping. */
function num(
  value: number,
  decimals = 2,
  language: SpeechLanguage = 'pt-BR'
): string {
  const fixed = value.toFixed(decimals)
  return language === 'pt-BR' ? fixed.replace('.', ',') : fixed
}

/** Seconds → localized "1:23,456"/"1:23.456" lap time, or "—". */
export function formatLapTime(
  seconds: number | undefined,
  language: SpeechLanguage = 'pt-BR'
): string {
  if (!finite(seconds) || seconds <= 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  const sStr = num(s, 3, language).padStart(6, '0')
  return `${m}:${sStr}`
}

/** Where a finding happened — prefer the WS-E corner, fall back to the sector. */
export function findingLocation(finding: CoachFinding, language: SpeechLanguage = 'pt-BR'): string {
  const pt = language === 'pt-BR'
  const corner = (finding as EnrichedFinding).corner
  if (finite(corner) && corner > 0) return `${pt ? 'Curva' : 'Turn'} ${Math.round(corner)}`
  if (finite(finding.sector) && finding.sector > 0) return `${pt ? 'Setor' : 'Sector'} ${finding.sector}`
  return pt ? 'Pista' : 'Track'
}

/** A finding is a GAIN when it praises the driver (good / explicit gain signal). */
export function isGainFinding(finding: CoachFinding): boolean {
  const f = finding as EnrichedFinding
  if (f.sign === 'gain') return true
  if (f.sign === 'loss') return false
  if (finite(f.estTimeGainSec) && f.estTimeGainSec > 0) return true
  return f.kind === 'good' || f.severity === 'good'
}

/** A finding is a LOSS when it costs time and is not a gain. */
export function isLossFinding(finding: CoachFinding): boolean {
  if (isGainFinding(finding)) return false
  return finite(finding.estTimeLossSec) && finding.estTimeLossSec > 0
}

/** Magnitude (seconds) used to rank a gain, worst-first. */
export function gainMagnitudeSec(finding: CoachFinding): number {
  const f = finding as EnrichedFinding
  if (finite(f.estTimeGainSec) && f.estTimeGainSec > 0) return f.estTimeGainSec
  if (finite(f.deltaSec) && f.deltaSec > 0) return f.deltaSec
  return 0
}

/** Magnitude (seconds) used to rank a loss, worst-first. */
export function lossMagnitudeSec(finding: CoachFinding): number {
  return finite(finding.estTimeLossSec) && finding.estTimeLossSec > 0 ? finding.estTimeLossSec : 0
}

function headlineFor(finding: CoachFinding, language: SpeechLanguage): string {
  return coachComposeAction(finding.kind, language)
}

function bulletForLoss(finding: CoachFinding, language: SpeechLanguage): string {
  const loc = findingLocation(finding, language)
  const mag = lossMagnitudeSec(finding)
  const suffix = mag > 0 ? ` (−${num(mag, 2, language)} s)` : ''
  return `${loc}: ${headlineFor(finding, language)}${suffix}`
}

function bulletForGain(finding: CoachFinding, language: SpeechLanguage): string {
  const loc = findingLocation(finding, language)
  const mag = gainMagnitudeSec(finding)
  const suffix = mag > 0 ? ` (+${num(mag, 2, language)} s)` : ''
  return `${loc}: ${headlineFor(finding, language)}${suffix}`
}

const PRESSURE_LABEL_PT: Record<string, string> = { low: 'baixa', ok: 'ideal', high: 'alta' }
const PRESSURE_LABEL_EN: Record<string, string> = { low: 'low', ok: 'ok', high: 'high' }
const TEMP_LABEL_PT: Record<string, string> = { cold: 'fria', optimal: 'ideal', hot: 'quente' }
const TEMP_LABEL_EN: Record<string, string> = { cold: 'cold', optimal: 'ideal', hot: 'hot' }

/** One short localized strategy line from the predictions, or null when no signal. */
export function strategyNote(
  predictions: PredictionsSnapshot | null | undefined,
  unitSystem: UnitSystem = 'metric',
  language: SpeechLanguage = 'pt-BR'
): string | null {
  if (!predictions) return null
  const pt = language === 'pt-BR'
  const parts: string[] = []

  const fuel = predictions.fuel
  if (fuel && finite(fuel.finishMarginLaps)) {
    const m = fuel.finishMarginLaps
    if (m >= 0) {
      const volume = finite(fuel.finishMarginL)
        ? `, ~${formatMeasurement(fuel.finishMarginL, 'fuel-volume-l', unitSystem, { decimals: 1, includeUnit: true }).display} ${pt ? 'restantes' : 'left'}`
        : ''
      parts.push(pt ? `combustível: margem de ${num(m, 1, language)} voltas até o fim${volume}` : `fuel: margin of ${num(m, 1, language)} laps to the end${volume}`)
    } else {
      const volume = finite(fuel.finishMarginL)
        ? `, ${pt ? 'faltam' : 'short'} ~${formatMeasurement(Math.abs(fuel.finishMarginL), 'fuel-volume-l', unitSystem, { decimals: 1, includeUnit: true }).display}`
        : ''
      parts.push(
        pt
          ? `combustível: déficit de ${num(Math.abs(m), 1, language)} voltas${volume} — precisa economizar ou parar`
          : `fuel: deficit of ${num(Math.abs(m), 1, language)} laps${volume} - needs saving/stopping`
      )
    }
  }

  const tire = predictions.tire
  if (tire) {
    const tParts: string[] = []
    if (finite(tire.degSecPerLap) && tire.degSecPerLap > 0) tParts.push(pt ? `perda ~${num(tire.degSecPerLap, 2, language)} s por volta` : `loss ~${num(tire.degSecPerLap, 2, language)} s/lap`)
    if (finite(tire.lapsToCliff) && tire.lapsToCliff > 0) tParts.push(pt ? `~${Math.round(tire.lapsToCliff)} voltas até a queda` : `~${Math.round(tire.lapsToCliff)} laps until drop-off`)
    if (tire.pressureState && tire.pressureState !== 'ok') {
      const label = (pt ? PRESSURE_LABEL_PT : PRESSURE_LABEL_EN)[tire.pressureState] ?? tire.pressureState
      tParts.push(pt ? `pressão ${label}` : `${label} pressure`)
    }
    if (tire.tempState && tire.tempState !== 'optimal') {
      const label = (pt ? TEMP_LABEL_PT : TEMP_LABEL_EN)[tire.tempState] ?? tire.tempState
      tParts.push(pt ? `temperatura ${label}` : `${label} temp`)
    }
    if (tParts.length > 0) parts.push(`${pt ? 'pneus' : 'tire'}: ${tParts.join(', ')}`)
  }

  const pace = predictions.pace
  if (pace && finite(pace.projectedLapSec) && pace.projectedLapSec > 0) {
    parts.push(`${pt ? 'ritmo projetado' : 'projected pace'} ${formatLapTime(pace.projectedLapSec, language)}`)
  }

  if (parts.length === 0) return null
  return parts.join('; ')
}

// ─── the pure composer ───────────────────────────────────────────────────────

/** Max losses / gains we surface so the debrief stays a SHORT radio-style note. */
const MAX_LOSSES = 3
const MAX_GAINS = 2

function sessionHeader(info: DebriefSessionInfo | undefined, language: SpeechLanguage): string | null {
  if (!info) return null
  const pt = language === 'pt-BR'
  const bits: string[] = []
  if (info.trackName) bits.push(info.trackName)
  if (info.carName) bits.push(info.carName)
  if (info.sessionType) bits.push(info.sessionType)
  const meta: string[] = []
  if (finite(info.lapsCompleted) && info.lapsCompleted > 0) meta.push(`${Math.round(info.lapsCompleted)} ${pt ? 'voltas' : 'laps'}`)
  if (finite(info.bestLapTimeSec) && info.bestLapTimeSec > 0) meta.push(`${pt ? 'melhor' : 'best'} ${formatLapTime(info.bestLapTimeSec, language)}`)
  const left = bits.join(' · ')
  const right = meta.length > 0 ? ` (${meta.join(', ')})` : ''
  const body = `${left}${right}`.trim()
  return body.length > 0 ? body : null
}

/**
 * Fold deterministic Coach findings + Predictions into a SHORT pt-BR debrief.
 * Pure and total: empty/garbage inputs degrade gracefully to a friendly line.
 *
 * - Summarizes the biggest LOSSES ("onde perdeu") AND GAINS ("onde foi bem") —
 *   gains are detected generically (WS-E `sign`/`estTimeGainSec`/`good`).
 * - Appends relevant strategy notes from the predictions (fuel/tyre/pace).
 */
export function composeDebrief(
  findings: CoachFinding[] | null | undefined,
  predictions: PredictionsSnapshot | null | undefined,
  sessionInfo?: DebriefSessionInfo,
  unitSystem: UnitSystem = 'metric',
  language: SpeechLanguage = 'pt-BR'
): DebriefComposition {
  const pt = language === 'pt-BR'
  const list = Array.isArray(findings) ? findings : []

  const losses = list
    .filter(isLossFinding)
    .sort((a, b) => lossMagnitudeSec(b) - lossMagnitudeSec(a))
    .slice(0, MAX_LOSSES)

  const gains = list
    .filter(isGainFinding)
    .sort((a, b) => gainMagnitudeSec(b) - gainMagnitudeSec(a))
    .slice(0, MAX_GAINS)

  const strategy = strategyNote(predictions, unitSystem, language)
  const header = sessionHeader(sessionInfo, language)

  const bullets: string[] = []
  for (const f of losses) bullets.push(`⚠ ${bulletForLoss(f, language)}`)
  for (const f of gains) bullets.push(`✅ ${bulletForGain(f, language)}`)
  if (strategy) bullets.push(`📊 ${pt ? 'Estratégia' : 'Strategy'} — ${strategy}`)

  // Graceful empty state: nothing measured at all.
  if (losses.length === 0 && gains.length === 0 && !strategy) {
    const head = header ? `${header}. ` : ''
    return {
      text: `${head}${pt ? 'Ainda não há dados suficientes para um resumo detalhado deste stint. Faça algumas voltas limpas para o Coach analisar.' : 'Not enough data for a detailed debrief of this stint. Run a few clean laps so the Coach can analyze them.'}`.trim(),
      bullets: []
    }
  }

  const lines: string[] = []
  if (header) lines.push(`${pt ? 'Resumo' : 'Debrief'} — ${header}.`)

  if (losses.length > 0) {
    lines.push(
      `${pt ? 'Onde perdeu tempo' : 'Where you lost time'}: ${losses
        .map((f) => `${findingLocation(f, language)} (${headlineFor(f, language)})`)
        .join('; ')}.`
    )
  } else {
    lines.push(pt ? 'Onde perdeu tempo: nenhuma perda relevante — stint limpo.' : 'Where you lost time: nothing significant - clean stint.')
  }

  if (gains.length > 0) {
    lines.push(
      `${pt ? 'Onde foi bem' : 'Where you did well'}: ${gains
        .map((f) => `${findingLocation(f, language)} (${headlineFor(f, language)})`)
        .join('; ')}.`
    )
  }

  if (strategy) lines.push(`${pt ? 'Estratégia' : 'Strategy'}: ${strategy}.`)

  return { text: lines.join(' '), bullets }
}

/**
 * Build the deterministic facts block the LLM phrases from. Reuses the same
 * composition so the model never has to re-derive anything — it ONLY rewrites.
 */
export function debriefLlmFacts(composition: DebriefComposition): string {
  const lines = [composition.text, ...composition.bullets]
  return lines.filter((l) => l && l.trim().length > 0).join('\n')
}
