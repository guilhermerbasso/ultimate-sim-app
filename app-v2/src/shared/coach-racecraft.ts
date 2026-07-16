import {
  coachDimensionForKind,
  type CoachCornerMetrics,
  type CoachFinding,
  type CoachFindingKind,
  type CoachPhase,
  type CoachReferenceLap,
  type CoachReport
} from './coach'
import type { AppLanguage } from './settings'
import type {
  CarLeftRightState,
  PaceMode,
  SessionKind,
  SessionState,
  SimId,
  TelemetrySnapshot
} from './telemetry'
import { sessionKindForSnapshot, sessionKindFromText } from './telemetry'
import { formatMeasurement, type UnitSystem } from './units'

export type RacecraftQuestionIntent = 'overtake' | 'pull-away'
export type RacecraftAdviceMode = 'overtake' | 'defend' | 'lap-improvement' | 'suppressed'
export type RacecraftGapTrend = 'closing' | 'opening' | 'stable' | 'unknown'
export type CoachTrackCondition = 'dry' | 'intermediate' | 'wet' | 'drying' | 'unknown'
export type CoachAdviceLanguage = 'en-US' | 'pt-BR' | 'es' | 'fr' | 'de' | 'zh' | 'ja'
export type RacecraftEvidenceSource = 'current-lap' | 'history'
export type CoachLapVerification = 'verified-clean' | 'unverified'
export type RacecraftSafetyReason =
  | 'yellow-flag'
  | 'blue-flag'
  | 'red-flag'
  | 'black-flag'
  | 'meatball'
  | 'repair'
  | 'disqualify'
  | 'checkered'
  | 'race-control-unknown'
  | 'overlap'
  | 'proximity'
  | 'caution'
  | 'pacing'
  | 'pit'
  | 'replay'
  | 'non-racing'
  | 'not-on-track'

export interface CoachGapSample {
  at: number
  aheadSec?: number
  behindSec?: number
  aheadCarIdx?: number
  behindCarIdx?: number
}

export interface RacecraftSafetyContext {
  connected?: boolean
  onTrack?: boolean
  onPitRoad?: boolean
  flagYellow?: boolean
  flagBlue?: boolean
  flagRed?: boolean
  flagBlack?: boolean
  flagMeatball?: boolean
  flagRepair?: boolean
  flagDisqualify?: boolean
  flagCheckered?: boolean
  flagsKnown?: boolean
  pitStateKnown?: boolean
  paceStateKnown?: boolean
  carLeftRight?: CarLeftRightState
  carsAlongsideCount?: number
  radarClosestMeters?: number
  gapAheadSec?: number
  gapBehindSec?: number
  caution?: boolean
  paceMode?: PaceMode
  sessionState?: SessionState
  sessionKind?: SessionKind
  sessionType?: string
  replayState?: 'live' | 'replay' | 'unknown'
}

export interface RacecraftAdviceContext {
  findings?: readonly CoachFinding[]
  cornerMetrics?: readonly CoachCornerMetrics[]
  reference?: CoachReferenceLap | null
  historyEvidence?: RacecraftHistoryEvidence | null
  gaps?: readonly CoachGapSample[]
  currentGapSample?: CoachGapSample
  currentGapAheadSec?: number
  currentGapBehindSec?: number
  safety?: RacecraftSafetyContext
  sessionKey?: string
  sessionBoundaryMs?: number
  sim?: SimId
  trackId?: string | number
  trackName?: string
  trackConfigName?: string
  carName?: string
  carPath?: string
  condition?: CoachTrackCondition
}

export interface RacecraftAdviceEvidence {
  entrySpeedKmh?: number
  apexSpeedKmh?: number
  exitSpeedKmh?: number
  brakePointPct?: number
  turnInPct?: number
  throttleReturnPct?: number
  referenceEntrySpeedKmh?: number
  referenceApexSpeedKmh?: number
  referenceExitSpeedKmh?: number
  referenceBrakePointPct?: number
  referenceTurnInPct?: number
  referenceThrottleReturnPct?: number
  tractionQuality?: 'clean' | 'delayed' | 'disconnected' | 'tc-limited'
  gapSec?: number
  gapTrend?: RacecraftGapTrend
  gapConfidence?: number
  source: RacecraftEvidenceSource
  referenceSource?: 'current-best' | 'history-best'
  lapsSeen?: number
  lapsCompared?: number
}

export interface RacecraftAdviceItem {
  priority: number
  kind: CoachFindingKind
  phase: CoachPhase
  corner?: number
  sector: number
  action: string
  expectedBenefit: string
  evidence: RacecraftAdviceEvidence
  source: RacecraftEvidenceSource
  text: string
}

export interface RacecraftAdvice {
  intent: RacecraftQuestionIntent
  mode: RacecraftAdviceMode
  opponentData: 'timing-only' | 'unavailable'
  gapSec?: number
  gapTrend: RacecraftGapTrend
  gapConfidence: number
  evidenceSource: RacecraftEvidenceSource | 'current+history' | 'none'
  comparableHistoryLaps: number
  items: RacecraftAdviceItem[]
  suppressedReason?: RacecraftSafetyReason
  honestyNote: string
  text: string
  speechText: string
  speechItemCount: number
}

export interface CoachComparableIdentity {
  sim?: SimId
  trackId?: string | number
  trackName?: string
  trackConfigName?: string
  carName?: string
  carPath?: string
  carClassId?: number
  carClassName?: string
  condition: CoachTrackCondition
  airTempC?: number
  trackTempC?: number
}

export interface CoachLapHistoryEntry {
  id: string
  at: number
  sessionId?: number
  sessionKey?: string
  sessionBoundaryMs?: number
  sessionKind?: SessionKind
  sessionType?: string
  lapNumber?: number
  lapTimeSec?: number
  valid: boolean
  verification: CoachLapVerification
  identity: CoachComparableIdentity
  findings: CoachFinding[]
  cornerMetrics: CoachCornerMetrics[]
}

export interface RacecraftHistoryPattern {
  finding: CoachFinding
  metrics?: CoachCornerMetrics
  lapsSeen: number
  lapsCompared: number
  averageLossSec: number
  confidence: number
  unverifiedLapsSeen: number
}

export interface RacecraftHistoryEvidence {
  condition: CoachTrackCondition
  comparableLapCount: number
  verifiedLapCount: number
  unverifiedLapCount: number
  sufficientHistory: boolean
  patterns: RacecraftHistoryPattern[]
  reference?: CoachReferenceLap
}

export interface QualiSummaryItem extends RacecraftAdviceItem {
  lapsSeen: number
  lapsCompared: number
  averageLossSec: number
}

export interface QualiStartSummaryRequest {
  current: CoachComparableIdentity
  history: readonly CoachLapHistoryEntry[]
  currentSession?: readonly CoachLapHistoryEntry[]
  minComparableLaps?: number
  maxItems?: number
  language?: CoachAdviceLanguage
  unitSystem?: UnitSystem
}

export interface QualiStartSummary {
  sufficientHistory: boolean
  comparableLapCount: number
  verifiedLapCount: number
  unverifiedLapCount: number
  currentSessionLapCount: number
  source: 'history' | 'current-session' | 'none'
  insufficientReason?: 'identity' | 'condition' | 'laps' | 'confidence'
  condition: CoachTrackCondition
  items: QualiSummaryItem[]
  text: string
}

export const MAX_RACECRAFT_ADVICE_LENGTH = 649
export const MAX_RACECRAFT_SPEECH_LENGTH = 380
export const MAX_QUALI_BRIEFING_LENGTH = 320
export const MIN_HISTORY_COMPARABLE_LAPS = 3
export const MIN_HISTORY_PATTERN_LAPS = 2
export const MIN_HISTORY_OCCURRENCE_RATIO = 0.5
export const MIN_HISTORY_CONFIDENCE = 0.6
const MIN_HISTORY_DIRECTION_CONFIDENCE_MARGIN = 0.1
const MIN_HISTORY_DIRECTION_OCCURRENCE_RATIO = 1.5
const MIN_HISTORY_DIRECTION_SCORE_RATIO = 1.35
const MAX_RACECRAFT_ITEMS = 3
const MAX_QUALI_ITEMS = 2
const MIN_GAP_TREND_DELTA_SEC = 0.15
const MIN_GAP_TREND_WINDOW_MS = 2000
const MIN_GAP_TREND_SAMPLES = 3
const MIN_GAP_TREND_CONFIDENCE = 0.65
const MAX_RELEVANT_GAP_SEC = { ahead: 8, behind: 5 } as const
const MAX_TACTICAL_CLOSING_GAP_SEC = { ahead: 4, behind: 3 } as const
const MIN_STABLE_NON_OVERLAP_SAMPLES = 2
const PROXIMITY_RADAR_METERS = 8
const PROXIMITY_GAP_SEC = 0.35

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function positiveGap(value: unknown): number | undefined {
  return finite(value) ? Math.abs(value) : undefined
}

function normalize(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizedIdentityValue(value: string | number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : normalize(typeof value === 'string' ? value : undefined)
}

export function coachAdviceLanguageFromAppLanguage(
  language: AppLanguage | string | null | undefined,
  systemLocale = 'en-US'
): CoachAdviceLanguage {
  const raw = language === 'auto' || !language ? systemLocale : language
  const normalized = raw.trim().toLowerCase().replace('_', '-')
  if (normalized === 'pt' || normalized.startsWith('pt-')) return 'pt-BR'
  if (normalized === 'es' || normalized.startsWith('es-')) return 'es'
  if (normalized === 'fr' || normalized.startsWith('fr-')) return 'fr'
  if (normalized === 'de' || normalized.startsWith('de-')) return 'de'
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh'
  if (normalized === 'ja' || normalized.startsWith('ja-')) return 'ja'
  return 'en-US'
}

function localized(
  language: CoachAdviceLanguage,
  copy: Record<CoachAdviceLanguage, string>
): string {
  return copy[language]
}

function capText(text: string, maxLength: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxLength) return trimmed
  const hardEnd = Math.max(1, maxLength - 1)
  const wordEnd = trimmed.lastIndexOf(' ', hardEnd)
  const end = wordEnd >= Math.floor(maxLength * 0.7) ? wordEnd : hardEnd
  return `${trimmed.slice(0, end).replace(/[\s,;:—-]+$/u, '')}.`
}

function playerDriver(snapshot: TelemetrySnapshot | null | undefined) {
  if (!snapshot?.drivers) return undefined
  return (
    snapshot.drivers.find((driver) => driver.isPlayer) ??
    snapshot.drivers.find((driver) => snapshot.playerCarIdx !== undefined && driver.carIdx === snapshot.playerCarIdx)
  )
}

export function classifyCoachTrackCondition(input: {
  trackWetnessPct?: number
  isRaining?: boolean
  weatherDeclaredWet?: boolean
  previousTrackWetnessPct?: number
}): CoachTrackCondition {
  const hasWetness = finite(input.trackWetnessPct)
  const hasPositiveWeatherSignal = input.isRaining === true || input.weatherDeclaredWet === true
  if (!hasWetness && !hasPositiveWeatherSignal) return 'unknown'
  const wetness = hasWetness ? Math.max(0, Math.min(1, input.trackWetnessPct as number)) : 0
  const wasWetter =
    finite(input.previousTrackWetnessPct) && input.previousTrackWetnessPct - wetness >= 0.03
  if (
    input.isRaining !== true &&
    wetness > 0.03 &&
    (wasWetter || input.weatherDeclaredWet === true)
  ) {
    return 'drying'
  }
  if (wetness >= 0.6 || (input.isRaining === true && wetness >= 0.35)) return 'wet'
  if (wetness >= 0.08 || input.isRaining === true || input.weatherDeclaredWet === true) return 'intermediate'
  return 'dry'
}

export function coachComparableIdentityFromSnapshot(
  snapshot: TelemetrySnapshot | null | undefined,
  previousTrackWetnessPct?: number
): CoachComparableIdentity {
  const player = playerDriver(snapshot)
  return {
    sim: snapshot?.sim,
    trackId: snapshot?.trackId,
    trackName: snapshot?.trackName,
    trackConfigName: snapshot?.trackConfigName,
    carName: snapshot?.carName,
    carPath: snapshot?.carPath,
    carClassId: finite(player?.classId) ? player.classId : undefined,
    carClassName: player?.className,
    condition: classifyCoachTrackCondition({
      trackWetnessPct: snapshot?.trackWetnessPct,
      isRaining: snapshot?.isRaining,
      weatherDeclaredWet: snapshot?.weatherDeclaredWet,
      previousTrackWetnessPct
    }),
    airTempC: finite(snapshot?.airTempC) ? snapshot.airTempC : undefined,
    trackTempC: finite(snapshot?.trackTempC) ? snapshot.trackTempC : undefined
  }
}

function closestRadarMeters(snapshot: TelemetrySnapshot | null | undefined): number | undefined {
  let closest = Number.POSITIVE_INFINITY
  for (const car of snapshot?.radarCars ?? []) {
    if (!finite(car.relativeX) || !finite(car.relativeY)) continue
    closest = Math.min(closest, Math.hypot(car.relativeX, car.relativeY))
  }
  return closest === Number.POSITIVE_INFINITY ? undefined : closest
}

export function racecraftSafetyFromSnapshot(
  snapshot: TelemetrySnapshot | null | undefined
): RacecraftSafetyContext {
  return {
    connected: snapshot?.connected,
    onTrack: snapshot?.onTrack,
    onPitRoad: snapshot?.onPitRoad ?? snapshot?.pit?.inPitStall,
    flagYellow: snapshot?.flags?.yellow,
    flagBlue: snapshot?.flags?.blue,
    flagRed: snapshot?.flags?.red,
    flagBlack: snapshot?.flags?.black,
    flagMeatball: snapshot?.flags?.meatball,
    flagRepair: snapshot?.flags?.repair,
    flagDisqualify: snapshot?.flags?.disqualify,
    flagCheckered: snapshot?.flags?.checkered,
    flagsKnown: snapshot?.flags !== undefined,
    pitStateKnown:
      typeof snapshot?.onPitRoad === 'boolean' ||
      typeof snapshot?.pit?.inPitStall === 'boolean',
    paceStateKnown: snapshot?.paceMode !== undefined,
    carLeftRight: snapshot?.carLeftRight,
    carsAlongsideCount: finite(snapshot?.carLeftRightCount)
      ? snapshot?.carLeftRightCount
      : undefined,
    radarClosestMeters: closestRadarMeters(snapshot),
    gapAheadSec: finite(snapshot?.relatives?.ahead?.gapSec)
      ? Math.abs(snapshot!.relatives!.ahead!.gapSec as number)
      : undefined,
    gapBehindSec: finite(snapshot?.relatives?.behind?.gapSec)
      ? Math.abs(snapshot!.relatives!.behind!.gapSec as number)
      : undefined,
    caution:
      snapshot?.flags?.yellow === true ||
      (snapshot?.paceMode !== undefined && snapshot.paceMode !== 'notPacing') ||
      snapshot?.sessionState === 'paradeLaps',
    paceMode: snapshot?.paceMode,
    sessionState: snapshot?.sessionState,
    sessionKind: sessionKindForSnapshot(snapshot),
    sessionType: snapshot?.sessionType,
    replayState: snapshot?.replayContext?.state ?? 'live'
  }
}

export function racecraftSafetyReason(
  safety: RacecraftSafetyContext | null | undefined,
  allowedSessionKinds: readonly SessionKind[] = ['race'],
  requireKnownRaceControl = true
): RacecraftSafetyReason | undefined {
  if (!safety) return requireKnownRaceControl ? 'race-control-unknown' : undefined
  if (safety.replayState !== undefined && safety.replayState !== 'live') return 'replay'
  if (safety.connected === false || safety.onTrack === false) return 'not-on-track'
  if (safety.onPitRoad === true) return 'pit'
  if (safety.flagDisqualify === true) return 'disqualify'
  if (safety.flagRed === true) return 'red-flag'
  if (safety.flagBlack === true) return 'black-flag'
  if (safety.flagCheckered === true) return 'checkered'
  if (safety.flagMeatball === true) return 'meatball'
  if (safety.flagRepair === true) return 'repair'
  if (safety.flagYellow === true) return 'yellow-flag'
  if (safety.flagBlue === true) return 'blue-flag'
  if (safety.paceMode !== undefined && safety.paceMode !== 'notPacing') return 'pacing'
  if (safety.caution === true) return 'caution'
  if (
    safety.carLeftRight === 'left' ||
    safety.carLeftRight === 'right' ||
    safety.carLeftRight === 'both' ||
    (finite(safety.carsAlongsideCount) && safety.carsAlongsideCount > 0)
  ) return 'overlap'
  if (
    (finite(safety.radarClosestMeters) && safety.radarClosestMeters <= PROXIMITY_RADAR_METERS) ||
    (finite(safety.gapAheadSec) && safety.gapAheadSec <= PROXIMITY_GAP_SEC) ||
    (finite(safety.gapBehindSec) && safety.gapBehindSec <= PROXIMITY_GAP_SEC)
  ) return 'proximity'
  if (safety.sessionState !== undefined && safety.sessionState !== 'racing') return 'non-racing'
  if (
    safety.sessionKind !== undefined &&
    !allowedSessionKinds.includes(safety.sessionKind)
  ) return 'non-racing'
  if (safety.sessionKind === undefined) {
    const kind = sessionKindFromText(safety.sessionType)
    if (kind !== 'unknown' && !allowedSessionKinds.includes(kind)) return 'non-racing'
    if (kind === 'unknown' && normalize(safety.sessionType)) return 'non-racing'
  }
  if (
    requireKnownRaceControl &&
    (
      safety.flagsKnown !== true ||
      safety.pitStateKnown !== true ||
      safety.paceStateKnown !== true
    )
  ) return 'race-control-unknown'
  return undefined
}

export function coachLapHistoryEntry(
  snapshot: TelemetrySnapshot,
  report: CoachReport,
  valid: boolean,
  at = snapshot.timestamp || Date.now(),
  identity = coachComparableIdentityFromSnapshot(snapshot),
  sessionKey?: string,
  sessionBoundaryMs?: number,
  verification: CoachLapVerification = 'unverified'
): CoachLapHistoryEntry {
  return {
    id: `${snapshot.sessionUniqueId ?? 'session'}:${report.lapNumber ?? at}`,
    at,
    sessionId: finite(snapshot.sessionUniqueId) ? snapshot.sessionUniqueId : undefined,
    sessionKey,
    sessionBoundaryMs,
    sessionKind: sessionKindForSnapshot(snapshot),
    sessionType: snapshot.sessionType,
    lapNumber: report.lapNumber,
    lapTimeSec: report.lapTimeSec,
    valid,
    verification,
    identity: { ...identity },
    findings: report.findings.map((finding) => ({ ...finding, metrics: { ...finding.metrics } })),
    cornerMetrics: report.cornerMetrics.map((metrics) => ({ ...metrics }))
  }
}

export function areCoachLapsComparable(
  current: CoachComparableIdentity,
  candidate: CoachComparableIdentity,
  opts: { airToleranceC?: number; trackToleranceC?: number } = {}
): boolean {
  if (current.condition === 'unknown' || candidate.condition === 'unknown') return false
  if (!current.sim || !candidate.sim || current.sim !== candidate.sim) return false
  const currentTrackId = normalizedIdentityValue(current.trackId)
  const candidateTrackId = normalizedIdentityValue(candidate.trackId)
  const currentTrackName = normalize(current.trackName)
  const candidateTrackName = normalize(candidate.trackName)
  if (currentTrackId && candidateTrackId) {
    if (currentTrackId !== candidateTrackId) return false
  } else if (!currentTrackName || currentTrackName !== candidateTrackName) {
    return false
  }
  if (
    currentTrackId !== candidateTrackId &&
    currentTrackName &&
    candidateTrackName &&
    currentTrackName !== candidateTrackName
  ) return false
  const currentConfig = normalize(current.trackConfigName)
  const candidateConfig = normalize(candidate.trackConfigName)
  if (currentConfig || candidateConfig) {
    if (!currentConfig || !candidateConfig || currentConfig !== candidateConfig) return false
  }

  if (normalize(current.carPath)) {
    if (normalize(current.carPath) !== normalize(candidate.carPath)) return false
  } else if (normalize(current.carName)) {
    if (normalize(current.carName) !== normalize(candidate.carName)) return false
  } else if (finite(current.carClassId)) {
    if (current.carClassId !== candidate.carClassId) return false
  } else {
    return false
  }

  if (finite(current.carClassId) && current.carClassId !== candidate.carClassId) return false
  if (current.condition !== candidate.condition) return false

  const airToleranceC = opts.airToleranceC ?? 5
  if (finite(current.airTempC) || finite(candidate.airTempC)) {
    if (
      !finite(current.airTempC) ||
      !finite(candidate.airTempC) ||
      Math.abs(current.airTempC - candidate.airTempC) > airToleranceC
    ) return false
  }
  const trackToleranceC = opts.trackToleranceC ?? 8
  if (finite(current.trackTempC) || finite(candidate.trackTempC)) {
    if (
      !finite(current.trackTempC) ||
      !finite(candidate.trackTempC) ||
      Math.abs(current.trackTempC - candidate.trackTempC) > trackToleranceC
    ) return false
  }
  return true
}

export function isCoachHistorySessionKind(
  kind: SessionKind | undefined
): kind is 'practice' | 'qualify' | 'race' {
  return kind === 'practice' || kind === 'qualify' || kind === 'race'
}

export function comparableCoachLaps(
  current: CoachComparableIdentity,
  laps: readonly CoachLapHistoryEntry[]
): CoachLapHistoryEntry[] {
  return laps.filter((lap) => {
    const kind = lap.sessionKind ?? sessionKindFromText(lap.sessionType)
    return (
      lap.valid &&
      isCoachHistorySessionKind(kind) &&
      areCoachLapsComparable(current, lap.identity)
    )
  })
}

export interface DetectedRacecraftQuestion {
  intent: RacecraftQuestionIntent
  language: CoachAdviceLanguage
}

export function detectRacecraftQuestionWithLanguage(question: string): DetectedRacecraftQuestion | null {
  const q = normalize(question).replace(/[’']/g, ' ')
  if (!q) return null
  const patterns: ReadonlyArray<{
    language: CoachAdviceLanguage
    overtake: RegExp
    pullAway: RegExp
  }> = [
    {
      language: 'en-US',
      overtake: /\b(overtake|get past (?:the )?car (?:in front|ahead)|get by (?:the )?car (?:in front|ahead)|make a pass on (?:the )?car (?:in front|ahead)|pass (?:the )?car ahead|how (?:do|can|should) i (?:pass|overtake)|what should i do to pass)\b/,
      pullAway: /\b(pull away|open (?:a )?gap|gap the car behind|lose the car behind|drop the car behind)\b/
    },
    {
      language: 'pt-BR',
      overtake: /\b(como (?:eu )?(?:passo|passar|ultrapasso|ultrapassar)|passar pelo carro que esta (?:na minha )?frente|passar o carro da frente|ultrapassar o carro da frente)\b/,
      pullAway: /\b(como (?:eu )?(?:abro|abrir|aumento|aumentar) (?:(?:a|o) )?(?:distancia|vantagem|gap)|afastar o carro de tras|escapar do carro de tras)\b/
    },
    {
      language: 'es',
      overtake: /\b(como (?:puedo |debo )?(?:adelantar|pasar|superar)|superar al coche que tengo delante|adelantar (?:al )?coche de delante|pasar (?:al )?coche de delante)\b/,
      pullAway: /\b(como (?:puedo )?(?:alejarme|escaparme|abrir hueco|aumentar la distancia)|sacarle distancia al coche de detras|alejarme del coche de detras)\b/
    },
    {
      language: 'fr',
      overtake: /\b(comment (?:faire pour )?(?:depasser|passer)|passer la voiture qui me precede|depasser la voiture devant|passer la voiture de devant)\b/,
      pullAway: /\b(comment (?:faire pour )?(?:distancer|semer|creuser l ecart)|distancer la voiture derriere|creuser l ecart avec la voiture derriere)\b/
    },
    {
      language: 'de',
      overtake: /\b(wie (?:kann|soll) ich (?:uberholen|am (?:vorausfahrenden )?auto vor mir vorbeikommen)|wie komme ich am vorausfahrenden auto vorbei|das auto vor mir uberholen)\b/,
      pullAway: /\b(wie (?:kann|soll) ich mich .*absetzen|abstand zum auto hinter mir vergroßern|das auto hinter mir abschutteln)\b/
    },
    {
      language: 'zh',
      overtake: /(怎么|如何).*(超车|超过|超越).*(前车|前面的车|我前面的车)|(超车|超过|超越).*(前车|前面的车|我前面的车)/,
      pullAway: /(怎么|如何).*(甩开|拉开|扩大).*(后车|后面的车|差距)|(甩开|拉开).*(后车|后面的车)/
    },
    {
      language: 'ja',
      overtake: /(どう|どのよう).*(前の車|前車|前を走る車).*(抜く|追い越す)|(前の車|前車|前を走る車).*?(抜|追い越)/,
      pullAway: /(どう|どのよう).*(後ろの車|後続車).*(引き離す|差を広げる)|(後ろの車|後続車).*(どう|どのよう)?.*(引き離す|差を広げる|引き離したい|差を広げたい)/
    }
  ]
  for (const pattern of patterns) {
    if (pattern.overtake.test(q)) return { intent: 'overtake', language: pattern.language }
    if (pattern.pullAway.test(q)) return { intent: 'pull-away', language: pattern.language }
  }
  return null
}

export function detectRacecraftQuestion(question: string): RacecraftQuestionIntent | null {
  return detectRacecraftQuestionWithLanguage(question)?.intent ?? null
}

export function detectRacecraftLikeQuestionLanguage(
  question: string
): CoachAdviceLanguage | null {
  const detected = detectRacecraftQuestionWithLanguage(question)
  if (detected) return detected.language
  const q = normalize(question).replace(/[’']/g, ' ')
  const hints: ReadonlyArray<[CoachAdviceLanguage, RegExp]> = [
    ['en-US', /\b(divebomb|send it|move down the inside|go around the outside|attack the car|defend from the car|make a racing move)\b/],
    ['pt-BR', /\b(mergulhar por dentro|mandar por dentro|atacar o carro|defender do carro|fazer uma manobra)\b/],
    ['es', /\b(tirarme por dentro|lanzarme por dentro|atacar al coche|defenderme del coche|hacer una maniobra)\b/],
    ['fr', /\b(plonger a l interieur|attaquer la voiture|defendre contre la voiture|tenter une manoeuvre)\b/],
    ['de', /\b(innen reinstechen|das auto angreifen|gegen das auto verteidigen|ein rennmanover)\b/],
    ['zh', /(晚刹强攻|钻内线|走外线|攻击前车|防守后车|做赛车动作)/],
    ['ja', /(ダイブボム|飛び込|アウトから行く|前車を攻める|後続車を守る|仕掛ける)/]
  ]
  return hints.find(([, pattern]) => pattern.test(q))?.[0] ?? null
}

export function racecraftClarificationText(language: CoachAdviceLanguage): string {
  return localized(language, {
    'en-US': 'I can only give a grounded plan for passing the car ahead or opening a gap behind. Which one do you mean?',
    'pt-BR': 'Só posso dar um plano fundamentado para passar o carro da frente ou abrir do carro de trás. Qual deles você quer?',
    es: 'Solo puedo dar un plan fundamentado para adelantar al coche de delante o abrir distancia al de detrás. ¿Cuál quieres?',
    fr: 'Je peux seulement donner un plan fondé pour dépasser la voiture devant ou creuser l’écart derrière. Lequel veux-tu ?',
    de: 'Ich kann nur einen belegten Plan zum Überholen des Autos vorn oder zum Absetzen vom Auto hinten geben. Was meinst du?',
    zh: '我只能基于实时证据回答“如何超过前车”或“如何拉开与后车的差距”。你指哪一种？',
    ja: '実データに基づいて答えられるのは「前車を抜く」か「後続車を引き離す」だけです。どちらですか？'
  })
}

export interface RacecraftGapTrendAnalysis {
  gapSec?: number
  trend: RacecraftGapTrend
  confidence: number
  relevant: boolean
  sampleCount: number
  deltaSec?: number
  windowSec?: number
}

function hasCurrentOpponentSample(
  context: RacecraftAdviceContext,
  side: 'ahead' | 'behind'
): boolean {
  const sample = context.currentGapSample
  const latest = context.gaps?.[context.gaps.length - 1]
  const gapKey = side === 'ahead' ? 'aheadSec' : 'behindSec'
  const carKey = side === 'ahead' ? 'aheadCarIdx' : 'behindCarIdx'
  const currentGap = side === 'ahead' ? context.currentGapAheadSec : context.currentGapBehindSec
  const sampleGap = positiveGap(sample?.[gapKey])
  return Boolean(
    sample &&
    latest &&
    finite(sample.at) &&
    sample.at === latest.at &&
    finite(sample[carKey]) &&
    sample[carKey] === latest[carKey] &&
    sampleGap !== undefined &&
    positiveGap(latest[gapKey]) === sampleGap &&
    positiveGap(currentGap) === sampleGap
  )
}

export function analyzeGapTrend(
  samples: readonly CoachGapSample[] | undefined,
  side: 'ahead' | 'behind',
  currentGapSec?: number
): RacecraftGapTrendAnalysis {
  const key = side === 'ahead' ? 'aheadSec' : 'behindSec'
  const carKey = side === 'ahead' ? 'aheadCarIdx' : 'behindCarIdx'
  const maxGapSec = MAX_RELEVANT_GAP_SEC[side]
  const fallback = positiveGap(currentGapSec)
  const ordered = (samples ?? [])
    .filter((sample) => finite(sample.at))
    .slice()
    .sort((a, b) => a.at - b.at)
  const latestSample = ordered[ordered.length - 1]
  const latestCarIdx = latestSample?.[carKey]
  const latestSampleGap = positiveGap(latestSample?.[key])
  const latest = fallback ?? latestSampleGap
  const usable: CoachGapSample[] = []
  if (finite(latestCarIdx) && latestSampleGap !== undefined && latestSampleGap <= maxGapSec) {
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      const sample = ordered[index]
      const gap = positiveGap(sample[key])
      if (
        sample[carKey] !== latestCarIdx ||
        gap === undefined ||
        gap > maxGapSec
      ) break
      usable.unshift(sample)
    }
  }
  const latestRelevant = latest !== undefined && latest <= maxGapSec
  if (!latestRelevant || usable.length < MIN_GAP_TREND_SAMPLES) {
    return { gapSec: latest, trend: 'unknown', confidence: 0, relevant: latestRelevant, sampleCount: usable.length }
  }
  const first = usable[0]
  const last = usable[usable.length - 1]
  const windowMs = last.at - first.at
  if (windowMs < MIN_GAP_TREND_WINDOW_MS) {
    return {
      gapSec: latest,
      trend: 'unknown',
      confidence: 0,
      relevant: true,
      sampleCount: usable.length,
      windowSec: windowMs / 1000
    }
  }
  const firstGap = positiveGap(first[key])
  const lastGap = positiveGap(last[key])
  if (firstGap === undefined || lastGap === undefined) {
    return { gapSec: latest, trend: 'unknown', confidence: 0, relevant: true, sampleCount: usable.length }
  }
  const deltaSec = lastGap - firstGap
  const candidateTrend: RacecraftGapTrend =
    Math.abs(deltaSec) < MIN_GAP_TREND_DELTA_SEC
      ? 'stable'
      : deltaSec < 0
        ? 'closing'
        : 'opening'
  const sampleConfidence = Math.min(1, usable.length / 4)
  const windowConfidence = Math.min(1, windowMs / 4000)
  const deltaConfidence =
    candidateTrend === 'stable'
      ? 1
      : Math.min(1, Math.abs(deltaSec) / 0.4)
  const confidence =
    sampleConfidence * 0.35 +
    windowConfidence * 0.3 +
    deltaConfidence * 0.35
  return {
    gapSec: latest ?? lastGap,
    trend: confidence >= MIN_GAP_TREND_CONFIDENCE ? candidateTrend : 'unknown',
    confidence,
    relevant: true,
    sampleCount: usable.length,
    deltaSec,
    windowSec: windowMs / 1000
  }
}

function phaseForFinding(finding: CoachFinding): CoachPhase {
  if (finding.phase) return finding.phase
  switch (finding.kind) {
    case 'brake-early':
    case 'brake-late':
    case 'trail-brake-lock':
    case 'abs-overuse':
    case 'steering-early':
    case 'steering-late':
    case 'brake-gain':
      return 'entry'
    case 'throttle-early':
    case 'throttle-late':
    case 'throttle-hesitation':
    case 'tc-overuse':
    case 'throttle-gain':
      return 'exit'
    default:
      return 'mid'
  }
}

function actionForKind(
  kind: CoachFindingKind,
  language: CoachAdviceLanguage,
  hasValidReference: boolean
): string {
  switch (kind) {
    case 'brake-early':
      return hasValidReference
        ? localized(language, {
            'en-US': 'brake later toward your valid-lap reference',
            'pt-BR': 'freie mais tarde, usando sua referência válida',
            es: 'frena más tarde hacia tu referencia de vuelta válida',
            fr: 'freine plus tard vers ta référence de tour valide',
            de: 'bremse später in Richtung deiner gültigen Referenzrunde',
            zh: '按你的有效参考圈稍晚刹车',
            ja: '有効な基準ラップに合わせて少し遅くブレーキ'
          })
        : localized(language, {
            'en-US': 'brake later, one step at a time',
            'pt-BR': 'freie um pouco mais tarde, uma etapa por vez',
            es: 'frena un poco más tarde, paso a paso',
            fr: 'freine un peu plus tard, progressivement',
            de: 'bremse schrittweise etwas später',
            zh: '逐步稍晚刹车',
            ja: '段階的に少し遅くブレーキ'
          })
    case 'brake-late':
    case 'trail-brake-lock':
    case 'abs-overuse':
      return localized(language, {
        'en-US': 'brake a touch earlier and release the pedal progressively',
        'pt-BR': 'freie um pouco antes e solte o pedal de forma progressiva',
        es: 'frena un poco antes y suelta el pedal progresivamente',
        fr: 'freine un peu plus tôt et relâche progressivement',
        de: 'bremse etwas früher und löse das Pedal progressiv',
        zh: '稍早刹车并逐步松开踏板',
        ja: '少し早めにブレーキし、徐々にリリース'
      })
    case 'steering-early':
      return localized(language, {
        'en-US': 'delay turn-in and use one clean arc',
        'pt-BR': 'atrase o turn-in e faça um arco limpo',
        es: 'retrasa el giro y usa un arco limpio',
        fr: 'retarde la mise en virage et garde un seul arc',
        de: 'lenke später ein und fahre einen sauberen Bogen',
        zh: '稍晚转向并保持单一顺滑弧线',
        ja: 'ターンインを遅らせ、滑らかな一本のラインで曲がる'
      })
    case 'steering-late':
      return localized(language, {
        'en-US': 'turn in a touch earlier',
        'pt-BR': 'antecipe um pouco o turn-in',
        es: 'gira un poco antes',
        fr: 'mets la voiture en virage un peu plus tôt',
        de: 'lenke etwas früher ein',
        zh: '稍早转向',
        ja: 'ターンインを少し早める'
      })
    case 'steering-busy':
      return localized(language, {
        'en-US': 'use one clean steering arc',
        'pt-BR': 'faça uma única entrada, sem correções',
        es: 'usa un solo arco de dirección limpio',
        fr: 'utilise un seul arc de volant propre',
        de: 'lenke in einem sauberen Bogen',
        zh: '用一次顺滑转向完成弯道',
        ja: '修正を減らし、一度の滑らかな舵角で曲がる'
      })
    case 'steering-insufficient':
      return localized(language, {
        'en-US': 'add steering so the car points to the apex',
        'pt-BR': 'adicione steering para apontar o carro ao apex',
        es: 'añade dirección para apuntar el coche al vértice',
        fr: 'ajoute du volant pour viser la corde',
        de: 'gib mehr Lenkwinkel, damit das Auto zum Scheitel zeigt',
        zh: '增加转向角让车辆指向弯心',
        ja: '舵角を足して車をエイペックスへ向ける'
      })
    case 'throttle-early':
    case 'tc-overuse':
      return localized(language, {
        'en-US': 'wait for rotation, then squeeze the throttle progressively',
        'pt-BR': 'espere o carro apontar e aplique throttle de forma progressiva',
        es: 'espera a que el coche rote y aplica gas progresivamente',
        fr: 'attends la rotation puis remets les gaz progressivement',
        de: 'warte auf die Rotation und gib dann progressiv Gas',
        zh: '等车身转正后再渐进加油',
        ja: '車が向きを変えてから徐々にスロットルを開ける'
      })
    case 'throttle-late':
    case 'throttle-hesitation':
      return localized(language, {
        'en-US': 'return to throttle earlier and commit',
        'pt-BR': 'retorne ao throttle mais cedo e sem hesitar',
        es: 'vuelve al gas antes y sin dudar',
        fr: 'remets les gaz plus tôt et franchement',
        de: 'geh früher und entschlossen ans Gas',
        zh: '更早并果断地恢复油门',
        ja: 'もっと早く迷わずスロットルを戻す'
      })
    case 'coast':
      return localized(language, {
        'en-US': 'connect brake release directly to throttle return',
        'pt-BR': 'conecte a soltura do freio ao retorno do throttle',
        es: 'conecta la suelta del freno directamente con el gas',
        fr: 'enchaîne directement le relâchement du frein et les gaz',
        de: 'verbinde Bremslösen direkt mit dem Gasgeben',
        zh: '松刹车后立即衔接油门',
        ja: 'ブレーキリリースからスロットルへ直接つなぐ'
      })
    case 'time-loss':
      return hasValidReference
        ? localized(language, {
            'en-US': 'match your valid-lap entry, apex, and exit reference',
            'pt-BR': 'iguale sua referência válida de entrada, apex e saída',
            es: 'iguala tu referencia válida de entrada, vértice y salida',
            fr: 'reproduis ta référence valide à l’entrée, à la corde et à la sortie',
            de: 'triff deine gültige Referenz für Eingang, Scheitel und Ausgang',
            zh: '匹配你有效参考圈的入弯、弯心和出弯',
            ja: '有効な基準ラップの進入・エイペックス・立ち上がりに合わせる'
          })
        : localized(language, {
            'en-US': 'reduce the measured loss across entry, apex, and exit',
            'pt-BR': 'reduza a perda medida entre entrada, apex e saída',
            es: 'reduce la pérdida medida entre entrada, vértice y salida',
            fr: 'réduis la perte mesurée entre l’entrée, la corde et la sortie',
            de: 'reduziere den gemessenen Verlust in Eingang, Scheitel und Ausgang',
            zh: '减少入弯、弯心和出弯的实测损失',
            ja: '進入・エイペックス・立ち上がりの実測ロスを減らす'
          })
    case 'inconsistency':
      return localized(language, {
        'en-US': 'repeat the same brake and turn-in points',
        'pt-BR': 'repita os mesmos pontos de freada e turn-in',
        es: 'repite los mismos puntos de frenada y giro',
        fr: 'répète les mêmes points de freinage et de mise en virage',
        de: 'wiederhole dieselben Brems- und Einlenkpunkte',
        zh: '重复相同的刹车点和转向点',
        ja: '同じブレーキポイントとターンインを繰り返す'
      })
    case 'min-speed-gain':
    case 'brake-gain':
    case 'throttle-gain':
    case 'good':
      return localized(language, {
        'en-US': 'keep that reference',
        'pt-BR': 'mantenha essa referência',
        es: 'mantén esa referencia',
        fr: 'garde cette référence',
        de: 'halte diese Referenz',
        zh: '保持这个参考',
        ja: 'その基準を維持する'
      })
  }
}

function expectedBenefit(
  mode: RacecraftAdviceMode,
  phase: CoachPhase,
  language: CoachAdviceLanguage
): string {
  if (mode === 'overtake') {
    if (phase === 'entry') {
      return localized(language, {
        'en-US': 'close under braking without giving the time back at the apex',
        'pt-BR': 'fechar na freada sem devolver tempo no apex',
        es: 'acercarte en la frenada sin devolver tiempo en el vértice',
        fr: 'revenir au freinage sans reperdre le temps à la corde',
        de: 'beim Bremsen aufschließen, ohne am Scheitel Zeit zurückzugeben',
        zh: '在刹车区缩小差距，同时不在弯心丢回时间',
        ja: 'ブレーキングで詰め、エイペックスで時間を返さない'
      })
    }
    if (phase === 'exit') {
      return localized(language, {
        'en-US': 'carry more speed onto the straight and create a safer passing run',
        'pt-BR': 'levar mais speed para a reta e criar uma ultrapassagem mais segura',
        es: 'llevar más velocidad a la recta y preparar un adelantamiento seguro',
        fr: 'emmener plus de vitesse sur la ligne droite et préparer un dépassement sûr',
        de: 'mehr Geschwindigkeit auf die Gerade nehmen und einen sicheren Angriff vorbereiten',
        zh: '把更多速度带上直道，创造更安全的超车机会',
        ja: '直線へ速度を持ち込み、安全なオーバーテイクを作る'
      })
    }
    return localized(language, {
      'en-US': 'preserve minimum speed so the draft is stronger on exit',
      'pt-BR': 'preservar speed mínima para sair mais perto no vácuo',
      es: 'conservar velocidad mínima para salir más cerca en el rebufo',
      fr: 'préserver la vitesse minimale pour sortir plus près dans l’aspiration',
      de: 'Mindestgeschwindigkeit halten, damit der Windschatten am Ausgang stärker ist',
      zh: '保持最低速度，让出弯后的尾流更有效',
      ja: '最低速度を保ち、立ち上がりでスリップを強く使う'
    })
  }
  if (mode === 'defend') {
    if (phase === 'exit') {
      return localized(language, {
        'en-US': 'build the gap through acceleration instead of sacrificing the line',
        'pt-BR': 'abrir o gap pela aceleração, sem sacrificar a linha',
        es: 'abrir el hueco con aceleración sin sacrificar la línea',
        fr: 'creuser l’écart à l’accélération sans sacrifier la trajectoire',
        de: 'den Abstand über Beschleunigung vergrößern, ohne die Linie zu opfern',
        zh: '靠加速拉开差距，不牺牲线路',
        ja: 'ラインを犠牲にせず加速で差を広げる'
      })
    }
    return localized(language, {
      'en-US': 'protect your apex and prevent a stronger run from behind',
      'pt-BR': 'proteger seu apex e impedir uma aproximação mais forte por trás',
      es: 'proteger tu vértice y evitar una mejor salida desde atrás',
      fr: 'protéger ta corde et empêcher une meilleure relance derrière',
      de: 'deinen Scheitel schützen und einen stärkeren Lauf von hinten verhindern',
      zh: '守住弯心，避免后车获得更强的出弯',
      ja: 'エイペックスを守り、後方からの強い立ち上がりを防ぐ'
    })
  }
  if (phase === 'exit') {
    return localized(language, {
      'en-US': 'improve exit quality and lower your own lap time',
      'pt-BR': 'melhorar a saída e reduzir seu próprio tempo de volta',
      es: 'mejorar la salida y bajar tu propio tiempo de vuelta',
      fr: 'améliorer la sortie et réduire ton propre chrono',
      de: 'den Ausgang verbessern und deine eigene Rundenzeit senken',
      zh: '改善出弯并降低自己的圈速',
      ja: '立ち上がりを改善し、自分のラップタイムを縮める'
    })
  }
  if (phase === 'entry') {
    return localized(language, {
      'en-US': 'reduce the entry loss without compromising the apex',
      'pt-BR': 'reduzir a perda na entrada sem comprometer o apex',
      es: 'reducir la pérdida en la entrada sin comprometer el vértice',
      fr: 'réduire la perte à l’entrée sans compromettre la corde',
      de: 'den Verlust am Eingang reduzieren, ohne den Scheitel zu gefährden',
      zh: '减少入弯损失，同时不影响弯心',
      ja: 'エイペックスを崩さず進入ロスを減らす'
    })
  }
  return localized(language, {
    'en-US': 'carry more speed through the apex and lower your lap time',
    'pt-BR': 'carregar mais speed pelo apex e reduzir o tempo de volta',
    es: 'mantener más velocidad en el vértice y bajar el tiempo de vuelta',
    fr: 'garder plus de vitesse à la corde et réduire le chrono',
    de: 'mehr Geschwindigkeit durch den Scheitel tragen und die Rundenzeit senken',
    zh: '在弯心保持更高速度并缩短圈速',
    ja: 'エイペックス速度を上げてラップタイムを縮める'
  })
}

function tractionQuality(finding: CoachFinding, metrics: CoachCornerMetrics | undefined) {
  if (finding.kind === 'tc-overuse' || finding.kind === 'throttle-early') return 'tc-limited' as const
  if (finding.kind === 'throttle-late' || finding.kind === 'throttle-hesitation') return 'delayed' as const
  if (finding.kind === 'coast') return 'disconnected' as const
  if (finite(metrics?.tcActivePct) && metrics.tcActivePct >= 0.15) return 'tc-limited' as const
  if (phaseForFinding(finding) === 'exit' && finite(metrics?.tcActivePct) && metrics.tcActivePct <= 0.05) return 'clean' as const
  return undefined
}

function locationKey(
  finding: Pick<CoachFinding, 'corner' | 'sector' | 'zonePctStart' | 'zonePctEnd'>
): string {
  if (finite(finding.zonePctStart) && finite(finding.zonePctEnd)) {
    const midpoint = (finding.zonePctStart + finding.zonePctEnd) / 2
    if (midpoint >= 0 && midpoint <= 1) return `z${Math.round(midpoint * 40)}`
  }
  return finite(finding.corner) ? `c${finding.corner}` : `s${finding.sector}`
}

function candidateKey(finding: CoachFinding): string {
  const dimension = coachDimensionForKind(finding.kind) ?? finding.kind
  return `${locationKey(finding)}:${dimension}`
}

function sameLocation(
  left: Pick<CoachFinding, 'corner' | 'sector' | 'zonePctStart' | 'zonePctEnd'>,
  right: Pick<CoachFinding, 'corner' | 'sector' | 'zonePctStart' | 'zonePctEnd'>
): boolean {
  if (
    finite(left.zonePctStart) &&
    finite(left.zonePctEnd) &&
    finite(right.zonePctStart) &&
    finite(right.zonePctEnd)
  ) {
    const overlap = Math.min(left.zonePctEnd, right.zonePctEnd) - Math.max(left.zonePctStart, right.zonePctStart)
    const shortest = Math.min(
      Math.max(0.001, left.zonePctEnd - left.zonePctStart),
      Math.max(0.001, right.zonePctEnd - right.zonePctStart)
    )
    if (overlap > 0 && overlap / shortest >= 0.35) return true
  }
  if (finite(left.corner) && finite(right.corner)) return left.corner === right.corner
  return left.sector === right.sector
}

function sameCandidateDimension(left: CoachFinding, right: CoachFinding): boolean {
  return (
    (coachDimensionForKind(left.kind) ?? left.kind) ===
      (coachDimensionForKind(right.kind) ?? right.kind) &&
    sameLocation(left, right)
  )
}

function actionableFindings(findings: readonly CoachFinding[] | undefined): CoachFinding[] {
  const best: CoachFinding[] = []
  for (const finding of findings ?? []) {
    if (finding.context === true || finding.severity === 'good' || finding.sign === 'gain') continue
    if (!(finding.estTimeLossSec > 0)) continue
    const index = best.findIndex((candidate) => sameCandidateDimension(candidate, finding))
    const previous = index >= 0 ? best[index] : undefined
    const confidence = finite(finding.confidence) ? finding.confidence : 0
    const previousConfidence = finite(previous?.confidence) ? previous.confidence : 0
    if (
      !previous ||
      confidence > previousConfidence ||
      (confidence === previousConfidence && finding.estTimeLossSec > previous.estTimeLossSec) ||
      (
        confidence === previousConfidence &&
        finding.estTimeLossSec === previous.estTimeLossSec &&
        finding.kind < previous.kind
      )
    ) {
      if (index >= 0) best[index] = finding
      else best.push(finding)
    }
  }

  const selected = best
  return selected.filter(
    (finding) =>
      finding.kind !== 'time-loss' ||
      !selected.some(
        (specific) =>
          specific.kind !== 'time-loss' &&
          sameLocation(specific, finding)
      )
  )
}

interface RacecraftAdviceCandidate {
  finding: CoachFinding
  metrics?: CoachCornerMetrics
  source: RacecraftEvidenceSource
  lapsSeen?: number
  lapsCompared?: number
  averageLossSec?: number
}

function adviceScore(finding: CoachFinding, mode: RacecraftAdviceMode): number {
  const phase = phaseForFinding(finding)
  const phaseBoost =
    mode === 'overtake'
      ? phase === 'exit'
        ? 0.18
        : phase === 'mid'
          ? 0.08
          : 0.04
      : mode === 'defend'
        ? phase === 'exit'
          ? 0.2
          : 0.06
        : 0
  return finding.estTimeLossSec + phaseBoost
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function tractionQualityLabel(
  quality: NonNullable<RacecraftAdviceEvidence['tractionQuality']>,
  language: CoachAdviceLanguage
): string {
  const copy = {
    clean: { 'en-US': 'clean', 'pt-BR': 'limpa', es: 'limpia', fr: 'propre', de: 'sauber', zh: '稳定', ja: '安定' },
    delayed: { 'en-US': 'delayed', 'pt-BR': 'atrasada', es: 'tardía', fr: 'tardive', de: 'verzögert', zh: '延迟', ja: '遅い' },
    disconnected: { 'en-US': 'disconnected', 'pt-BR': 'desconectada', es: 'desconectada', fr: 'coupée', de: 'unterbrochen', zh: '脱节', ja: '途切れ' },
    'tc-limited': { 'en-US': 'TC-limited', 'pt-BR': 'limitada pelo TC', es: 'limitada por TC', fr: 'limitée par le TC', de: 'durch TC begrenzt', zh: '受TC限制', ja: 'TC制限' }
  } as const
  return copy[quality][language]
}

function metricSnippet(
  evidence: RacecraftAdviceEvidence,
  phase: CoachPhase,
  kind: CoachFindingKind,
  language: CoachAdviceLanguage,
  unitSystem: UnitSystem
): string {
  const parts: string[] = []
  const labels = {
    entry: localized(language, { 'en-US': 'entry', 'pt-BR': 'entrada', es: 'entrada', fr: 'entrée', de: 'Eingang', zh: '入弯', ja: '進入' }),
    apex: localized(language, { 'en-US': 'apex', 'pt-BR': 'apex', es: 'vértice', fr: 'corde', de: 'Scheitel', zh: '弯心', ja: 'エイペックス' }),
    exit: localized(language, { 'en-US': 'exit', 'pt-BR': 'saída', es: 'salida', fr: 'sortie', de: 'Ausgang', zh: '出弯', ja: '立ち上がり' }),
    brake: localized(language, { 'en-US': 'brake point', 'pt-BR': 'ponto de freada', es: 'punto de frenada', fr: 'point de freinage', de: 'Bremspunkt', zh: '刹车点', ja: 'ブレーキポイント' }),
    turnIn: localized(language, { 'en-US': 'turn-in', 'pt-BR': 'turn-in', es: 'giro', fr: 'mise en virage', de: 'Einlenken', zh: '转向点', ja: 'ターンイン' }),
    throttle: localized(language, { 'en-US': 'throttle return', 'pt-BR': 'retorno ao throttle', es: 'retorno al gas', fr: 'remise des gaz', de: 'Gasannahme', zh: '油门恢复点', ja: 'スロットル復帰' }),
    traction: localized(language, { 'en-US': 'traction', 'pt-BR': 'tração', es: 'tracción', fr: 'motricité', de: 'Traktion', zh: '牵引', ja: 'トラクション' }),
    lap: localized(language, { 'en-US': 'lap', 'pt-BR': 'volta', es: 'vuelta', fr: 'tour', de: 'Runde', zh: '圈', ja: 'ラップ' }),
    versus: localized(language, { 'en-US': 'vs', 'pt-BR': 'vs', es: 'vs', fr: 'contre', de: 'gegen', zh: '对比', ja: '対' })
  }
  const speed = (label: string, current: number | undefined, reference: number | undefined): string | undefined => {
    if (!finite(current)) return undefined
    const currentReading = formatMeasurement(current, 'speed-kmh', unitSystem, { decimals: 0 })
    return finite(reference)
      ? `${label} ${currentReading.display} ${currentReading.unit} ${labels.versus} ${formatMeasurement(reference, 'speed-kmh', unitSystem, { decimals: 0 }).display} ${currentReading.unit}`
      : `${label} ${currentReading.display} ${currentReading.unit}`
  }
  const point = (label: string, current: number | undefined, reference: number | undefined): string | undefined => {
    if (!finite(current)) return undefined
    return finite(reference)
      ? `${label} ${formatPct(current)} ${labels.lap} ${labels.versus} ${formatPct(reference)}`
      : `${label} ${formatPct(current)} ${labels.lap}`
  }
  if (phase === 'entry') {
    const entry = speed(labels.entry, evidence.entrySpeedKmh, evidence.referenceEntrySpeedKmh)
    if (entry) parts.push(entry)
    const dimension = coachDimensionForKind(kind)
    const timing =
      dimension === 'steering-timing'
        ? point(labels.turnIn, evidence.turnInPct, evidence.referenceTurnInPct)
        : point(labels.brake, evidence.brakePointPct, evidence.referenceBrakePointPct) ??
          point(labels.turnIn, evidence.turnInPct, evidence.referenceTurnInPct)
    if (timing) parts.push(timing)
  } else if (phase === 'mid') {
    const apex = speed(labels.apex, evidence.apexSpeedKmh, evidence.referenceApexSpeedKmh)
    if (apex) parts.push(apex)
  } else {
    const exit = speed(labels.exit, evidence.exitSpeedKmh, evidence.referenceExitSpeedKmh)
    if (exit) parts.push(exit)
    const throttle = point(
      labels.throttle,
      evidence.throttleReturnPct,
      evidence.referenceThrottleReturnPct
    )
    if (throttle) parts.push(throttle)
    else if (evidence.tractionQuality) {
      parts.push(`${labels.traction} ${tractionQualityLabel(evidence.tractionQuality, language)}`)
    }
  }
  return parts.slice(0, 2).join(', ')
}

function findingEvidence(
  finding: CoachFinding,
  metrics: CoachCornerMetrics | undefined,
  reference: CoachCornerMetrics | undefined,
  gapSec: number | undefined,
  gapTrend: RacecraftGapTrend,
  gapConfidence: number,
  source: RacecraftEvidenceSource,
  referenceSource: RacecraftAdviceEvidence['referenceSource'],
  lapsSeen?: number,
  lapsCompared?: number
): RacecraftAdviceEvidence {
  const evidence: RacecraftAdviceEvidence = {
    entrySpeedKmh: metrics?.entrySpeedKmh ?? (finite(finding.metrics.entrySpeedKmh) ? finding.metrics.entrySpeedKmh : undefined),
    apexSpeedKmh: metrics?.minSpeedKmh ?? (finite(finding.metrics.minSpeedKmh) ? finding.metrics.minSpeedKmh : undefined),
    exitSpeedKmh: metrics?.exitSpeedKmh ?? (finite(finding.metrics.exitSpeedKmh) ? finding.metrics.exitSpeedKmh : undefined),
    brakePointPct: metrics?.brakeStartPct ?? (finite(finding.metrics.brakeStartPct) ? finding.metrics.brakeStartPct : undefined),
    turnInPct: metrics?.steerStartPct ?? (finite(finding.metrics.steerStartPct) ? finding.metrics.steerStartPct : undefined),
    throttleReturnPct:
      metrics?.throttleStartPct ??
      (finite(finding.metrics.throttleStartPct) ? finding.metrics.throttleStartPct : undefined),
    referenceEntrySpeedKmh: reference?.entrySpeedKmh,
    referenceApexSpeedKmh:
      reference?.minSpeedKmh ??
      (finite(finding.metrics.refMinSpeedKmh) ? finding.metrics.refMinSpeedKmh : undefined),
    referenceExitSpeedKmh: reference?.exitSpeedKmh,
    referenceBrakePointPct: reference?.brakeStartPct,
    referenceTurnInPct:
      reference?.steerStartPct ??
      (finite(finding.metrics.refSteerStartPct) ? finding.metrics.refSteerStartPct : undefined),
    referenceThrottleReturnPct:
      reference?.throttleStartPct ??
      (finite(finding.metrics.refThrottleStartPct) ? finding.metrics.refThrottleStartPct : undefined),
    tractionQuality: tractionQuality(finding, metrics),
    gapSec,
    gapTrend,
    gapConfidence,
    source,
    referenceSource: reference ? referenceSource : undefined,
    lapsSeen,
    lapsCompared
  }
  if (!finite(evidence.referenceBrakePointPct) && finite(finding.metrics.refBrakeStartPct)) {
    evidence.referenceBrakePointPct = finding.metrics.refBrakeStartPct
  }
  return sanitizeReferenceEvidence(finding.kind, evidence)
}

function sanitizeReferenceEvidence(
  kind: CoachFindingKind,
  evidence: RacecraftAdviceEvidence
): RacecraftAdviceEvidence {
  const later = (current: number | undefined, reference: number | undefined): boolean =>
    finite(current) && finite(reference) && reference - current >= 0.001
  const earlier = (current: number | undefined, reference: number | undefined): boolean =>
    finite(current) && finite(reference) && current - reference >= 0.001
  const faster = (current: number | undefined, reference: number | undefined): boolean =>
    finite(current) && finite(reference) && reference - current >= 1
  const supported =
    kind === 'brake-early'
      ? later(evidence.brakePointPct, evidence.referenceBrakePointPct)
      : kind === 'brake-late' || kind === 'trail-brake-lock' || kind === 'abs-overuse'
        ? earlier(evidence.brakePointPct, evidence.referenceBrakePointPct)
        : kind === 'steering-early'
          ? later(evidence.turnInPct, evidence.referenceTurnInPct)
          : kind === 'steering-late'
            ? earlier(evidence.turnInPct, evidence.referenceTurnInPct)
            : kind === 'throttle-late' || kind === 'throttle-hesitation'
              ? earlier(evidence.throttleReturnPct, evidence.referenceThrottleReturnPct)
              : kind === 'throttle-early' || kind === 'tc-overuse'
                ? later(evidence.throttleReturnPct, evidence.referenceThrottleReturnPct)
                : faster(evidence.apexSpeedKmh, evidence.referenceApexSpeedKmh) ||
                  faster(evidence.exitSpeedKmh, evidence.referenceExitSpeedKmh) ||
                  faster(evidence.entrySpeedKmh, evidence.referenceEntrySpeedKmh)
  if (supported) return evidence
  return {
    ...evidence,
    referenceEntrySpeedKmh: undefined,
    referenceApexSpeedKmh: undefined,
    referenceExitSpeedKmh: undefined,
    referenceBrakePointPct: undefined,
    referenceTurnInPct: undefined,
    referenceThrottleReturnPct: undefined,
    referenceSource: undefined
  }
}

function locator(finding: Pick<CoachFinding, 'corner' | 'sector'>, language: CoachAdviceLanguage): string {
  const turn = localized(language, { 'en-US': 'Turn', 'pt-BR': 'Curva', es: 'Curva', fr: 'Virage', de: 'Kurve', zh: '弯', ja: 'コーナー' })
  const sector = localized(language, { 'en-US': 'Sector', 'pt-BR': 'Setor', es: 'Sector', fr: 'Secteur', de: 'Sektor', zh: '赛段', ja: 'セクター' })
  if (finite(finding.corner)) return `${turn} ${finding.corner} (${sector} ${finding.sector})`
  return `${sector} ${finding.sector}`
}

function buildAdviceItem(
  finding: CoachFinding,
  priority: number,
  mode: RacecraftAdviceMode,
  language: CoachAdviceLanguage,
  metrics: CoachCornerMetrics | undefined,
  reference: CoachCornerMetrics | undefined,
  gapSec: number | undefined,
  gapTrend: RacecraftGapTrend,
  gapConfidence: number,
  unitSystem: UnitSystem,
  source: RacecraftEvidenceSource,
  referenceSource: RacecraftAdviceEvidence['referenceSource'],
  lapsSeen?: number,
  lapsCompared?: number
): RacecraftAdviceItem {
  const phase = phaseForFinding(finding)
  const evidence = findingEvidence(
    finding,
    metrics,
    reference,
    gapSec,
    gapTrend,
    gapConfidence,
    source,
    referenceSource,
    lapsSeen,
    lapsCompared
  )
  const hasValidReference =
    finite(evidence.referenceEntrySpeedKmh) ||
    finite(evidence.referenceApexSpeedKmh) ||
    finite(evidence.referenceExitSpeedKmh) ||
    finite(evidence.referenceBrakePointPct) ||
    finite(evidence.referenceTurnInPct) ||
    finite(evidence.referenceThrottleReturnPct)
  const action = actionForKind(finding.kind, language, hasValidReference)
  const benefit = expectedBenefit(mode, phase, language)
  const measured = metricSnippet(evidence, phase, finding.kind, language, unitSystem)
  const text = `${locator(finding, language)} — ${measured ? `${measured}: ` : ''}${action}; ${benefit}.`
  return {
    priority,
    kind: finding.kind,
    phase,
    corner: finding.corner,
    sector: finding.sector,
    action,
    expectedBenefit: benefit,
    evidence,
    source,
    text
  }
}

function racecraftHeader(
  intent: RacecraftQuestionIntent,
  mode: RacecraftAdviceMode,
  gapSec: number | undefined,
  trend: RacecraftGapTrend,
  language: CoachAdviceLanguage
): string {
  const label =
    mode === 'overtake'
      ? localized(language, { 'en-US': 'OVERTAKE', 'pt-BR': 'ULTRAPASSAGEM', es: 'ADELANTAMIENTO', fr: 'DÉPASSEMENT', de: 'ÜBERHOLEN', zh: '超车', ja: 'オーバーテイク' })
      : mode === 'defend'
        ? localized(language, { 'en-US': 'DEFEND', 'pt-BR': 'DEFESA', es: 'DEFENSA', fr: 'DÉFENSE', de: 'VERTEIDIGEN', zh: '防守', ja: 'ディフェンス' })
        : localized(language, { 'en-US': 'LAP IMPROVEMENT', 'pt-BR': 'MELHORIA DE VOLTA', es: 'MEJORA DE VUELTA', fr: 'AMÉLIORATION DU TOUR', de: 'RUNDENVERBESSERUNG', zh: '圈速提升', ja: 'ラップ改善' })
  const target = intent === 'overtake'
    ? localized(language, { 'en-US': 'ahead', 'pt-BR': 'à frente', es: 'delante', fr: 'devant', de: 'vorn', zh: '前方', ja: '前方' })
    : localized(language, { 'en-US': 'behind', 'pt-BR': 'atrás', es: 'detrás', fr: 'derrière', de: 'hinten', zh: '后方', ja: '後方' })
  const caveat = localized(language, {
    'en-US': 'opponent controls are unavailable',
    'pt-BR': 'os controles do rival não estão disponíveis',
    es: 'los controles del rival no están disponibles',
    fr: 'les commandes du rival ne sont pas disponibles',
    de: 'die Eingaben des Gegners sind nicht verfügbar',
    zh: '无法获取对手的刹车、转向或油门输入',
    ja: '相手のブレーキ・操舵・スロットル入力は取得できません'
  })
  const gapLabel = localized(language, {
    'en-US': 'gap',
    'pt-BR': 'gap',
    es: 'diferencia',
    fr: 'écart',
    de: 'Abstand',
    zh: '时间差',
    ja: 'ギャップ'
  })
  if (!finite(gapSec)) {
    return `${label} — ${localized(language, {
      'en-US': `no reliable gap to the car ${target}`,
      'pt-BR': `sem gap confiável para o carro ${target}`,
      es: `sin diferencia fiable con el coche de ${target}`,
      fr: `aucun écart fiable avec la voiture ${target}`,
      de: `kein verlässlicher Abstand zum Auto ${target}`,
      zh: `没有与${target}车辆的可靠时间差`,
      ja: `${target}の車との信頼できるギャップがありません`
    })}; ${caveat}.`
  }
  const trendText =
    trend === 'unknown'
      ? ''
      : `, ${({
          closing: localized(language, { 'en-US': 'closing', 'pt-BR': 'fechando', es: 'cerrándose', fr: 'en réduction', de: 'wird kleiner', zh: '正在缩小', ja: '縮小中' }),
          opening: localized(language, { 'en-US': 'opening', 'pt-BR': 'abrindo', es: 'abriéndose', fr: 'en augmentation', de: 'wird größer', zh: '正在扩大', ja: '拡大中' }),
          stable: localized(language, { 'en-US': 'stable', 'pt-BR': 'estável', es: 'estable', fr: 'stable', de: 'stabil', zh: '稳定', ja: '安定' })
        } as const)[trend]}`
  return `${label} — ${gapLabel} ${target} ${gapSec.toFixed(1)}s${trendText}; ${caveat}.`
}

export function racecraftSafetyMessage(
  reason: RacecraftSafetyReason,
  language: CoachAdviceLanguage
): string {
  if (reason === 'race-control-unknown') {
    return localized(language, {
      'en-US': 'RACE-CONTROL STATE UNAVAILABLE — I cannot safely advise a pass or pull-away.',
      'pt-BR': 'ESTADO DA DIREÇÃO DE PROVA INDISPONÍVEL — não posso orientar uma ultrapassagem ou fuga com segurança.',
      es: 'ESTADO DE CONTROL DE CARRERA NO DISPONIBLE — no puedo aconsejar un adelantamiento o escapada con seguridad.',
      fr: 'ÉTAT DE LA DIRECTION DE COURSE INDISPONIBLE — impossible de conseiller un dépassement ou une échappée en sécurité.',
      de: 'RENNLEITUNGSSTATUS NICHT VERFÜGBAR — ich kann kein sicheres Überhol- oder Absetzmanöver empfehlen.',
      zh: '无法获取赛会控制状态——不能安全地建议超车或拉开差距。',
      ja: 'レースコントロール状態を取得できません — 安全に追い越しや引き離しを助言できません。'
    })
  }
  if (reason === 'overlap' || reason === 'proximity') {
    return localized(language, {
      'en-US': 'TACTICS PAUSED — a car is alongside or inside the proximity zone. Hold a predictable line; ask again after stable separation.',
      'pt-BR': 'TÁTICA PAUSADA — há carro lado a lado ou na zona de proximidade. Mantenha uma linha previsível e pergunte após separar.',
      es: 'TÁCTICA EN PAUSA — hay un coche en paralelo o dentro de la zona de proximidad. Mantén una línea predecible y pregunta tras separarte.',
      fr: 'TACTIQUE EN PAUSE — une voiture est côte à côte ou dans la zone de proximité. Garde une ligne prévisible et redemande après séparation.',
      de: 'TAKTIK PAUSIERT — ein Auto ist neben dir oder in der Nahzone. Halte eine berechenbare Linie und frage nach stabiler Trennung erneut.',
      zh: '战术暂停——车辆正并排或处于近距离区域。保持可预测线路，稳定拉开后再询问。',
      ja: '戦術停止 — 車両が並走中または近接範囲内です。予測可能なラインを維持し、安定して離れてから再度確認してください。'
    })
  }
  if (reason === 'blue-flag') {
    return localized(language, {
      'en-US': 'TACTICS PAUSED — blue flag active. Follow race control and manage the faster traffic; no attack or pull-away plan now.',
      'pt-BR': 'TÁTICA PAUSADA — bandeira azul ativa. Siga a direção de prova e administre o tráfego mais rápido; sem plano de ataque ou fuga agora.',
      es: 'TÁCTICA EN PAUSA — bandera azul activa. Sigue dirección de carrera y gestiona el tráfico más rápido; sin plan de ataque o escapada ahora.',
      fr: 'TACTIQUE EN PAUSE — drapeau bleu actif. Suis la direction de course et gère le trafic plus rapide; aucun plan d’attaque maintenant.',
      de: 'TAKTIK PAUSIERT — blaue Flagge aktiv. Befolge die Rennleitung und manage den schnelleren Verkehr; jetzt kein Angriffsplan.',
      zh: '战术暂停——蓝旗生效。服从赛会并处理更快车辆；现在不提供进攻或拉开差距方案。',
      ja: '戦術停止 — ブルーフラッグ中です。レースコントロールに従い、速い車両を処理してください。今は攻防プランを出しません。'
    })
  }
  if (
    reason === 'red-flag' ||
    reason === 'black-flag' ||
    reason === 'meatball' ||
    reason === 'repair' ||
    reason === 'disqualify' ||
    reason === 'checkered'
  ) {
    return localized(language, {
      'en-US': 'TACTICS PAUSED — a safety or penalty flag is active. Follow race control instructions; no attack or pull-away plan now.',
      'pt-BR': 'TÁTICA PAUSADA — bandeira de segurança ou penalidade ativa. Siga a direção de prova; sem plano de ataque ou fuga agora.',
      es: 'TÁCTICA EN PAUSA — bandera de seguridad o sanción activa. Sigue dirección de carrera; sin plan de ataque o escapada.',
      fr: 'TACTIQUE EN PAUSE — drapeau de sécurité ou pénalité actif. Suis la direction de course; aucun plan d’attaque maintenant.',
      de: 'TAKTIK PAUSIERT — Sicherheits- oder Strafsignal aktiv. Befolge die Rennleitung; jetzt kein Angriffs- oder Absetzplan.',
      zh: '战术暂停——安全或处罚旗帜生效。服从赛会指令；现在不提供进攻或拉开差距方案。',
      ja: '戦術停止 — 安全またはペナルティフラッグ中です。レースコントロールに従い、今は攻防プランを出しません。'
    })
  }
  if (reason === 'yellow-flag' || reason === 'caution' || reason === 'pacing') {
    return localized(language, {
      'en-US': 'TACTICS PAUSED — race control or pacing is active. Hold position, follow the rules, and wait for green.',
      'pt-BR': 'TÁTICA PAUSADA — direção de prova ou formação ativa. Mantenha a posição, siga as regras e espere a verde.',
      es: 'TÁCTICA EN PAUSA — control de carrera o formación activos. Mantén la posición, sigue las reglas y espera la verde.',
      fr: 'TACTIQUE EN PAUSE — neutralisation ou formation active. Garde ta position, respecte les règles et attends le vert.',
      de: 'TAKTIK PAUSIERT — Rennleitung oder Formation aktiv. Position halten, Regeln befolgen und auf Grün warten.',
      zh: '战术暂停——赛会控制或编队状态生效。保持位置、遵守规则并等待绿旗。',
      ja: '戦術停止 — レースコントロールまたは隊列走行中です。順位を守り、規則に従ってグリーンを待ってください。'
    })
  }
  return localized(language, {
    'en-US': 'TACTICAL ADVICE UNAVAILABLE — attack and pull-away plans require live, on-track racing.',
    'pt-BR': 'CONSELHO TÁTICO INDISPONÍVEL — planos de ataque e fuga exigem corrida ao vivo e na pista.',
    es: 'CONSEJO TÁCTICO NO DISPONIBLE — los planes de ataque y escapada requieren carrera en vivo y en pista.',
    fr: 'CONSEIL TACTIQUE INDISPONIBLE — les plans d’attaque exigent une course en direct et en piste.',
    de: 'TAKTISCHER RAT NICHT VERFÜGBAR — Angriffspläne erfordern ein Live-Rennen auf der Strecke.',
    zh: '无法提供战术建议——进攻和拉开差距方案仅适用于实时赛道竞速。',
    ja: '戦術アドバイス不可 — 攻防プランはライブのコース上レースでのみ利用できます。'
  })
}

function honestyText(language: CoachAdviceLanguage): string {
  return localized(language, {
    'en-US': 'Only opponent timing/position/radar is available; no opponent brake, steering, or throttle input is inferred.',
    'pt-BR': 'Só há timing/posição/radar do rival; nenhum freio, volante ou acelerador do rival é inferido.',
    es: 'Solo hay tiempos/posición/radar del rival; no se infiere su freno, dirección ni acelerador.',
    fr: 'Seuls le timing, la position et le radar du rival sont disponibles; aucun freinage, volant ou accélérateur rival n’est déduit.',
    de: 'Vom Gegner gibt es nur Timing, Position und Radar; Brems-, Lenk- oder Gaseingaben werden nicht abgeleitet.',
    zh: '仅使用对手的时间差、位置和雷达；不会推断对手的刹车、转向或油门。',
    ja: '相手について使うのはタイミング・位置・レーダーのみで、ブレーキ・操舵・スロットルは推測しません。'
  })
}

export function buildRacecraftAdvice(
  intent: RacecraftQuestionIntent,
  context: RacecraftAdviceContext,
  opts: { language?: CoachAdviceLanguage; maxItems?: number; unitSystem?: UnitSystem } = {}
): RacecraftAdvice {
  const language = opts.language ?? 'en-US'
  const unitSystem = opts.unitSystem ?? 'metric'
  const side = intent === 'overtake' ? 'ahead' : 'behind'
  const currentGap = intent === 'overtake' ? context.currentGapAheadSec : context.currentGapBehindSec
  const safetyReason = racecraftSafetyReason(context.safety)
  if (safetyReason) {
    const gapSec = positiveGap(currentGap)
    const text = capText(racecraftSafetyMessage(safetyReason, language), MAX_RACECRAFT_ADVICE_LENGTH)
    return {
      intent,
      mode: 'suppressed',
      opponentData: finite(gapSec) ? 'timing-only' : 'unavailable',
      gapSec,
      gapTrend: 'unknown',
      gapConfidence: 0,
      evidenceSource: 'none',
      comparableHistoryLaps: 0,
      items: [],
      suppressedReason: safetyReason,
      honestyNote: honestyText(language),
      text,
      speechText: text,
      speechItemCount: 0
    }
  }
  const gap = hasCurrentOpponentSample(context, side)
    ? analyzeGapTrend(context.gaps, side, currentGap)
    : {
        gapSec: undefined,
        trend: 'unknown' as const,
        confidence: 0,
        relevant: false,
        sampleCount: 0
      }
  const confidentlyClosing =
    gap.relevant &&
    gap.trend === 'closing' &&
    gap.confidence >= MIN_GAP_TREND_CONFIDENCE
  const stableNonOverlap = gap.sampleCount >= MIN_STABLE_NON_OVERLAP_SAMPLES
  const mode: RacecraftAdviceMode =
    intent === 'overtake' &&
      gap.relevant &&
      stableNonOverlap &&
      finite(gap.gapSec) &&
      (gap.gapSec <= 3 || (confidentlyClosing && gap.gapSec <= MAX_TACTICAL_CLOSING_GAP_SEC.ahead))
      ? 'overtake'
      : intent === 'pull-away' &&
          gap.relevant &&
          stableNonOverlap &&
          finite(gap.gapSec) &&
          (
            gap.gapSec <= 1.6 ||
            (confidentlyClosing && gap.gapSec <= MAX_TACTICAL_CLOSING_GAP_SEC.behind)
          )
        ? 'defend'
        : 'lap-improvement'

  const metricsByCorner = new Map<number, CoachCornerMetrics>()
  for (const metrics of context.cornerMetrics ?? []) metricsByCorner.set(metrics.corner, metrics)
  const matchingHistory =
    context.historyEvidence &&
    context.historyEvidence.condition !== 'unknown' &&
    (context.condition === undefined || context.condition === context.historyEvidence.condition)
      ? context.historyEvidence
      : null
  const history = matchingHistory?.sufficientHistory ? matchingHistory : null
  const effectiveReference =
    context.reference && context.reference.corners.length > 0
      ? context.reference
      : history?.reference
  const referenceSource: RacecraftAdviceEvidence['referenceSource'] =
    context.reference && context.reference.corners.length > 0
      ? 'current-best'
      : history?.reference
        ? 'history-best'
        : undefined
  const referenceByCorner = new Map<number, CoachCornerMetrics>()
  for (const metrics of effectiveReference?.corners ?? []) referenceByCorner.set(metrics.corner, metrics)

  const maxItems = Math.max(1, Math.min(MAX_RACECRAFT_ITEMS, Math.floor(opts.maxItems ?? MAX_RACECRAFT_ITEMS)))
  const currentCandidates: RacecraftAdviceCandidate[] = actionableFindings(context.findings).map((finding) => ({
    finding,
    metrics: finite(finding.corner) ? metricsByCorner.get(finding.corner) : undefined,
    source: 'current-lap'
  }))
  const historyCandidates: RacecraftAdviceCandidate[] = (history?.patterns ?? [])
    .filter(
      (pattern) =>
        !currentCandidates.some((candidate) =>
          sameCandidateDimension(candidate.finding, pattern.finding)
        )
    )
    .map((pattern) => ({
      finding: pattern.finding,
      metrics: pattern.metrics,
      source: 'history',
      lapsSeen: pattern.lapsSeen,
      lapsCompared: pattern.lapsCompared,
      averageLossSec: pattern.averageLossSec
    }))
  const ranked = [...currentCandidates, ...historyCandidates].sort((a, b) => {
    const aRecurrence =
      a.source === 'history' && finite(a.lapsSeen) && finite(a.lapsCompared) && a.lapsCompared > 0
        ? (a.lapsSeen / a.lapsCompared) * 0.2
        : 0
    const bRecurrence =
      b.source === 'history' && finite(b.lapsSeen) && finite(b.lapsCompared) && b.lapsCompared > 0
        ? (b.lapsSeen / b.lapsCompared) * 0.2
        : 0
    const aFinding =
      a.source === 'history' && finite(a.averageLossSec)
        ? { ...a.finding, estTimeLossSec: a.averageLossSec }
        : a.finding
    const bFinding =
      b.source === 'history' && finite(b.averageLossSec)
        ? { ...b.finding, estTimeLossSec: b.averageLossSec }
        : b.finding
    const aScore = adviceScore(aFinding, mode) + (a.source === 'current-lap' ? 1 : aRecurrence)
    const bScore = adviceScore(bFinding, mode) + (b.source === 'current-lap' ? 1 : bRecurrence)
    return (
      bScore - aScore ||
      locationKey(a.finding).localeCompare(locationKey(b.finding)) ||
      a.finding.kind.localeCompare(b.finding.kind)
    )
  })

  const onePerLocation: RacecraftAdviceCandidate[] = []
  for (const candidate of ranked) {
    if (!onePerLocation.some((selected) => sameLocation(selected.finding, candidate.finding))) {
      onePerLocation.push(candidate)
    }
  }
  const items = onePerLocation
    .slice(0, maxItems)
    .map((candidate, index) =>
      buildAdviceItem(
        candidate.finding,
        index + 1,
        mode,
        language,
        candidate.metrics,
        finite(candidate.finding.corner) ? referenceByCorner.get(candidate.finding.corner) : undefined,
        gap.gapSec,
        gap.trend,
        gap.confidence,
        unitSystem,
        candidate.source,
        referenceSource,
        candidate.lapsSeen,
        candidate.lapsCompared
      )
    )

  const header = racecraftHeader(intent, mode, gap.gapSec, gap.trend, language)
  const noEvidence =
    matchingHistory && !matchingHistory.sufficientHistory
      ? localized(language, {
          'en-US': `Insufficient evidence: ${matchingHistory.comparableLapCount}/${MIN_HISTORY_COMPARABLE_LAPS} comparable completed laps.`,
          'pt-BR': `Evidência insuficiente: ${matchingHistory.comparableLapCount}/${MIN_HISTORY_COMPARABLE_LAPS} voltas completas comparáveis.`,
          es: `Evidencia insuficiente: ${matchingHistory.comparableLapCount}/${MIN_HISTORY_COMPARABLE_LAPS} vueltas completas comparables.`,
          fr: `Données insuffisantes : ${matchingHistory.comparableLapCount}/${MIN_HISTORY_COMPARABLE_LAPS} tours complets comparables.`,
          de: `Unzureichende Daten: ${matchingHistory.comparableLapCount}/${MIN_HISTORY_COMPARABLE_LAPS} vergleichbare vollständige Runden.`,
          zh: `证据不足：只有 ${matchingHistory.comparableLapCount}/${MIN_HISTORY_COMPARABLE_LAPS} 个可比完整圈。`,
          ja: `証拠不足: 比較可能な完走ラップは ${matchingHistory.comparableLapCount}/${MIN_HISTORY_COMPARABLE_LAPS} です。`
        })
      : history && history.comparableLapCount > 0
        ? localized(language, {
            'en-US': 'No recurring high-confidence player loss is supported by the comparable history; complete a current lap to refresh the plan.',
            'pt-BR': 'O histórico comparável não sustenta uma perda recorrente de alta confiança; complete uma volta atual para atualizar o plano.',
            es: 'El historial comparable no respalda una pérdida recurrente de alta confianza; completa una vuelta actual.',
            fr: 'L’historique comparable ne confirme aucune perte récurrente à forte confiance; termine un tour actuel.',
            de: 'Die vergleichbare Historie stützt keinen wiederkehrenden Verlust mit hoher Sicherheit; fahre eine aktuelle Runde.',
            zh: '可比历史不支持高置信度的重复损失；请完成当前有效圈以更新方案。',
            ja: '比較可能な履歴では高信頼の反復ロスを確認できません。現在の有効ラップを完走してください。'
          })
        : localized(language, {
            'en-US': 'Insufficient player evidence: complete a valid lap before a corner-specific plan.',
            'pt-BR': 'Evidência do piloto insuficiente: complete uma volta válida antes de um plano por curva.',
            es: 'Evidencia del piloto insuficiente: completa una vuelta válida antes de un plan por curva.',
            fr: 'Données pilote insuffisantes : termine un tour valide avant un plan par virage.',
            de: 'Unzureichende Fahrerdaten: Fahre eine gültige Runde vor einem kurvenspezifischen Plan.',
            zh: '车手证据不足：完成一个有效圈后才能生成逐弯方案。',
            ja: 'ドライバー証拠が不足しています。コーナー別プランの前に有効ラップを完走してください。'
          })
  const historyUsed =
    items.some((item) => item.source === 'history') ||
    items.some((item) => item.evidence.referenceSource === 'history-best')
  const attribution = historyUsed && history
    ? ` ${localized(language, {
        'en-US': `Player history: ${history.comparableLapCount} comparable completed laps.`,
        'pt-BR': `Histórico próprio: ${history.comparableLapCount} voltas completas comparáveis.`,
        es: `Historial propio: ${history.comparableLapCount} vueltas completas comparables.`,
        fr: `Historique pilote : ${history.comparableLapCount} tours complets comparables.`,
        de: `Eigene Historie: ${history.comparableLapCount} vergleichbare vollständige Runden.`,
        zh: `车手历史：${history.comparableLapCount} 个可比完整圈。`,
        ja: `ドライバー履歴: 比較可能な完走ラップ ${history.comparableLapCount} 周。`
      })}`
    : ''
  let displayedItems = items
  const compose = (list: RacecraftAdviceItem[]): string =>
    list.length > 0
      ? `${header} ${list.map((item) => `${item.priority}) ${item.text}`).join(' ')}${attribution}`
      : `${header} ${noEvidence}`
  while (displayedItems.length > 1 && compose(displayedItems).length > MAX_RACECRAFT_ADVICE_LENGTH) {
    displayedItems = displayedItems.slice(0, -1)
  }
  const text = capText(compose(displayedItems), MAX_RACECRAFT_ADVICE_LENGTH)
  let speechItems = displayedItems.slice(0, 2)
  const composeSpeech = (list: RacecraftAdviceItem[]): string =>
    list.length > 0
      ? `${header} ${list.map((item) => `${item.priority}) ${item.text}`).join(' ')}`
      : `${header} ${noEvidence}`
  while (speechItems.length > 1 && composeSpeech(speechItems).length > MAX_RACECRAFT_SPEECH_LENGTH) {
    speechItems = speechItems.slice(0, -1)
  }
  const speechText = capText(composeSpeech(speechItems), MAX_RACECRAFT_SPEECH_LENGTH)
  const itemSources = new Set(displayedItems.map((item) => item.source))
  const evidenceSource: RacecraftAdvice['evidenceSource'] =
    itemSources.size === 0
      ? 'none'
      : itemSources.size > 1
        ? 'current+history'
        : displayedItems[0].source
  return {
    intent,
    mode,
    opponentData: finite(gap.gapSec) ? 'timing-only' : 'unavailable',
    gapSec: gap.gapSec,
    gapTrend: gap.trend,
    gapConfidence: gap.confidence,
    evidenceSource,
    comparableHistoryLaps: history?.comparableLapCount ?? 0,
    items: displayedItems,
    honestyNote: honestyText(language),
    text,
    speechText,
    speechItemCount: speechItems.length
  }
}

interface QualiPattern {
  finding: CoachFinding
  metrics?: CoachCornerMetrics
  lapsSeen: number
  totalLossSec: number
  totalConfidence: number
  unverifiedLapsSeen: number
}

function qualiPatterns(laps: readonly CoachLapHistoryEntry[]): QualiPattern[] {
  const exact: QualiPattern[] = []
  for (const lap of laps) {
    for (const finding of actionableFindings(lap.findings)) {
      const index = exact.findIndex(
        (candidate) =>
          candidate.finding.kind === finding.kind &&
          sameLocation(candidate.finding, finding)
      )
      const previous = index >= 0 ? exact[index] : undefined
      const metrics = finite(finding.corner)
        ? lap.cornerMetrics.find((candidate) => candidate.corner === finding.corner)
        : undefined
      const verificationFactor = lap.verification === 'verified-clean' ? 1 : 0.5
      const confidence = (finite(finding.confidence) ? finding.confidence : 0) * verificationFactor
      if (previous) {
        previous.lapsSeen += 1
        previous.totalLossSec += finding.estTimeLossSec
        previous.totalConfidence += confidence
        if (lap.verification !== 'verified-clean') previous.unverifiedLapsSeen += 1
        const previousConfidence = finite(previous.finding.confidence) ? previous.finding.confidence : 0
        if (
          confidence > previousConfidence ||
          (confidence === previousConfidence && finding.estTimeLossSec > previous.finding.estTimeLossSec)
        ) {
          previous.finding = finding
          previous.metrics = metrics
        }
      } else {
        exact.push({
          finding,
          metrics,
          lapsSeen: 1,
          totalLossSec: finding.estTimeLossSec,
          totalConfidence: confidence,
          unverifiedLapsSeen: lap.verification === 'verified-clean' ? 0 : 1
        })
      }
    }
  }

  const groups: QualiPattern[][] = []
  for (const pattern of exact) {
    const group = groups.find((candidates) =>
      sameCandidateDimension(candidates[0].finding, pattern.finding)
    )
    if (group) group.push(pattern)
    else groups.push([pattern])
  }

  const selected = groups.flatMap((group) => {
    if (group.length === 1) return group
    const ranked = group.slice().sort((left, right) => {
      const leftConfidence = left.totalConfidence / left.lapsSeen
      const rightConfidence = right.totalConfidence / right.lapsSeen
      const leftAverage = left.totalLossSec / left.lapsSeen
      const rightAverage = right.totalLossSec / right.lapsSeen
      return (
        rightConfidence - leftConfidence ||
        right.lapsSeen - left.lapsSeen ||
        rightAverage - leftAverage ||
        left.finding.kind.localeCompare(right.finding.kind)
      )
    })
    const winner = ranked[0]
    const runnerUp = ranked[1]
    const winnerConfidence = winner.totalConfidence / winner.lapsSeen
    const runnerUpConfidence = runnerUp.totalConfidence / runnerUp.lapsSeen
    const confidenceDominant =
      winnerConfidence - runnerUpConfidence >= MIN_HISTORY_DIRECTION_CONFIDENCE_MARGIN
    const occurrenceDominant =
      winner.lapsSeen / runnerUp.lapsSeen >= MIN_HISTORY_DIRECTION_OCCURRENCE_RATIO
    const winnerScore = winnerConfidence * winner.lapsSeen * (winner.totalLossSec / winner.lapsSeen)
    const runnerUpScore =
      runnerUpConfidence * runnerUp.lapsSeen * (runnerUp.totalLossSec / runnerUp.lapsSeen)
    const scoreDominant =
      runnerUpScore <= 0 || winnerScore / runnerUpScore >= MIN_HISTORY_DIRECTION_SCORE_RATIO
    return confidenceDominant || occurrenceDominant || scoreDominant ? [winner] : []
  })
  return selected.filter(
    (pattern) =>
      pattern.finding.kind !== 'time-loss' ||
      !selected.some(
        (specific) =>
          specific.finding.kind !== 'time-loss' &&
          sameLocation(specific.finding, pattern.finding)
      )
  )
}

export function buildRacecraftHistoryEvidence(
  current: CoachComparableIdentity,
  laps: readonly CoachLapHistoryEntry[],
  opts: { maxPatterns?: number } = {}
): RacecraftHistoryEvidence {
  const comparable = comparableCoachLaps(current, laps)
  const verifiedLapCount = comparable.filter((lap) => lap.verification === 'verified-clean').length
  const unverifiedLapCount = comparable.length - verifiedLapCount
  const maxPatterns = Math.max(1, Math.min(8, Math.floor(opts.maxPatterns ?? 6)))
  const sufficientHistory = comparable.length >= MIN_HISTORY_COMPARABLE_LAPS
  const patterns = sufficientHistory
    ? qualiPatterns(comparable)
    .filter((pattern) => {
      const ratio = pattern.lapsSeen / comparable.length
      const confidence = pattern.totalConfidence / pattern.lapsSeen
      return (
        pattern.lapsSeen >= MIN_HISTORY_PATTERN_LAPS &&
        ratio >= MIN_HISTORY_OCCURRENCE_RATIO &&
        confidence >= MIN_HISTORY_CONFIDENCE
      )
    })
    .sort((a, b) => {
      const aAverage = a.totalLossSec / a.lapsSeen
      const bAverage = b.totalLossSec / b.lapsSeen
      return (
        b.lapsSeen / comparable.length * bAverage -
          a.lapsSeen / comparable.length * aAverage ||
        locationKey(a.finding).localeCompare(locationKey(b.finding)) ||
        a.finding.kind.localeCompare(b.finding.kind)
      )
    })
    .slice(0, maxPatterns)
    .map((pattern): RacecraftHistoryPattern => ({
      finding: { ...pattern.finding, metrics: { ...pattern.finding.metrics } },
      metrics: pattern.metrics ? { ...pattern.metrics } : undefined,
      lapsSeen: pattern.lapsSeen,
      lapsCompared: comparable.length,
      averageLossSec: pattern.totalLossSec / pattern.lapsSeen,
      confidence: pattern.totalConfidence / pattern.lapsSeen,
      unverifiedLapsSeen: pattern.unverifiedLapsSeen
    }))
    : []
  const bestLap = sufficientHistory
    ? comparable
    .filter(
      (lap) =>
        lap.verification === 'verified-clean' &&
        finite(lap.lapTimeSec) &&
        lap.lapTimeSec > 0 &&
        lap.cornerMetrics.length > 0
    )
    .slice()
    .sort((a, b) => (a.lapTimeSec as number) - (b.lapTimeSec as number) || b.at - a.at)[0]
    : undefined

  return {
    condition: current.condition,
    comparableLapCount: comparable.length,
    verifiedLapCount,
    unverifiedLapCount,
    sufficientHistory,
    patterns,
    reference: bestLap
      ? { corners: bestLap.cornerMetrics.map((metrics) => ({ ...metrics })) }
      : undefined
  }
}

function conditionLabel(condition: CoachTrackCondition, language: CoachAdviceLanguage): string {
  const copy: Record<CoachTrackCondition, Record<CoachAdviceLanguage, string>> = {
    dry: { 'en-US': 'dry', 'pt-BR': 'seco', es: 'seco', fr: 'sec', de: 'trocken', zh: '干地', ja: 'ドライ' },
    intermediate: { 'en-US': 'intermediate', 'pt-BR': 'intermediário', es: 'intermedio', fr: 'intermédiaire', de: 'intermediär', zh: '半湿地', ja: 'インターミディエイト' },
    wet: { 'en-US': 'wet', 'pt-BR': 'molhado', es: 'mojado', fr: 'mouillé', de: 'nass', zh: '湿地', ja: 'ウェット' },
    drying: { 'en-US': 'drying', 'pt-BR': 'secando', es: 'secándose', fr: 'séchant', de: 'abtrocknend', zh: '正在变干', ja: '乾きかけ' },
    unknown: { 'en-US': 'unknown', 'pt-BR': 'desconhecido', es: 'desconocido', fr: 'inconnu', de: 'unbekannt', zh: '未知', ja: '不明' }
  }
  return copy[condition][language]
}

function comparableIdentityIssue(identity: CoachComparableIdentity): 'condition' | 'track' | 'car' | null {
  if (identity.condition === 'unknown') return 'condition'
  if (!normalizedIdentityValue(identity.trackId) && !normalize(identity.trackName)) return 'track'
  if (
    !normalize(identity.carPath) &&
    !normalize(identity.carName) &&
    !finite(identity.carClassId)
  ) return 'car'
  return null
}

export function buildQualiStartSummary(request: QualiStartSummaryRequest): QualiStartSummary {
  const language = request.language ?? 'en-US'
  const unitSystem = request.unitSystem ?? 'metric'
  const minComparableLaps = Math.max(
    MIN_HISTORY_COMPARABLE_LAPS,
    Math.floor(request.minComparableLaps ?? MIN_HISTORY_COMPARABLE_LAPS)
  )
  const maxItems = Math.max(1, Math.min(MAX_QUALI_ITEMS, Math.floor(request.maxItems ?? MAX_QUALI_ITEMS)))
  const identityIssue = comparableIdentityIssue(request.current)
  const history = identityIssue ? [] : comparableCoachLaps(request.current, request.history)
  const verifiedHistoryCount = history.filter((lap) => lap.verification === 'verified-clean').length
  const unverifiedHistoryCount = history.length - verifiedHistoryCount
  const currentSession = identityIssue
    ? []
    : comparableCoachLaps(request.current, request.currentSession ?? [])
  const sufficientHistory = history.length >= minComparableLaps
  const source: QualiStartSummary['source'] = sufficientHistory ? 'history' : 'none'
  const patterns = sufficientHistory
    ? qualiPatterns(history)
    .filter((pattern) => {
      const confidence = pattern.totalConfidence / pattern.lapsSeen
      return (
        pattern.lapsSeen >= MIN_HISTORY_PATTERN_LAPS &&
        pattern.lapsSeen / history.length >= MIN_HISTORY_OCCURRENCE_RATIO &&
        confidence >= MIN_HISTORY_CONFIDENCE
      )
    })
    .sort((a, b) => {
      const aAvg = a.totalLossSec / a.lapsSeen
      const bAvg = b.totalLossSec / b.lapsSeen
      return (
        b.lapsSeen / history.length * bAvg -
          a.lapsSeen / history.length * aAvg ||
        locationKey(a.finding).localeCompare(locationKey(b.finding))
      )
    })
    .slice(0, maxItems)
    : []

  const items: QualiSummaryItem[] = patterns.map((pattern, index) => {
    const base = buildAdviceItem(
      pattern.finding,
      index + 1,
      'lap-improvement',
      language,
      pattern.metrics,
      undefined,
      undefined,
      'unknown',
      0,
      unitSystem,
      'history',
      undefined,
      pattern.lapsSeen,
      history.length
    )
    const averageLossSec = pattern.totalLossSec / pattern.lapsSeen
    const prefix = localized(language, {
      'en-US': `${pattern.lapsSeen}/${history.length} laps, ~${averageLossSec.toFixed(2)}s average`,
      'pt-BR': `${pattern.lapsSeen}/${history.length} voltas, média ~${averageLossSec.toFixed(2)}s`,
      es: `${pattern.lapsSeen}/${history.length} vueltas, media ~${averageLossSec.toFixed(2)}s`,
      fr: `${pattern.lapsSeen}/${history.length} tours, moyenne ~${averageLossSec.toFixed(2)}s`,
      de: `${pattern.lapsSeen}/${history.length} Runden, Ø ~${averageLossSec.toFixed(2)}s`,
      zh: `${pattern.lapsSeen}/${history.length} 圈，平均约 ${averageLossSec.toFixed(2)} 秒`,
      ja: `${pattern.lapsSeen}/${history.length} 周、平均約 ${averageLossSec.toFixed(2)} 秒`
    })
    return {
      ...base,
      lapsSeen: pattern.lapsSeen,
      lapsCompared: history.length,
      averageLossSec,
      text: `${locator(pattern.finding, language)} — ${prefix}: ${base.action}; ${base.expectedBenefit}.`
    }
  })

  const condition = conditionLabel(request.current.condition, language)
  const qualify = localized(language, {
    'en-US': 'QUALIFY',
    'pt-BR': 'QUALI',
    es: 'CLASIFICACIÓN',
    fr: 'QUALIFICATIONS',
    de: 'QUALIFYING',
    zh: '排位赛',
    ja: '予選'
  })
  let header: string
  let insufficientReason: QualiStartSummary['insufficientReason']
  if (identityIssue === 'condition') {
    insufficientReason = 'condition'
    header = `${qualify} — ${localized(language, {
      'en-US': 'insufficient evidence: track condition unknown; dry and wet history remain separate.',
      'pt-BR': 'evidência insuficiente: condição da pista desconhecida; histórico seco e molhado permanece separado.',
      es: 'evidencia insuficiente: condición de pista desconocida; no se mezclan vueltas secas y mojadas.',
      fr: 'données insuffisantes : état de piste inconnu; les tours secs et mouillés restent séparés.',
      de: 'unzureichende Daten: Streckenzustand unbekannt; trockene und nasse Runden bleiben getrennt.',
      zh: '证据不足：赛道状况未知；干地和湿地历史不会混合。',
      ja: '証拠不足: 路面状況が不明です。ドライとウェットの履歴は混ぜません。'
    })}`
  } else if (identityIssue) {
    insufficientReason = 'identity'
    header = `${qualify} — ${localized(language, {
      'en-US': 'insufficient evidence: current track or car identity is unavailable.',
      'pt-BR': 'evidência insuficiente: identidade atual de pista ou carro indisponível.',
      es: 'evidencia insuficiente: identidad actual de pista o coche no disponible.',
      fr: 'données insuffisantes : identité actuelle de piste ou de voiture indisponible.',
      de: 'unzureichende Daten: aktuelle Strecken- oder Fahrzeugidentität fehlt.',
      zh: '证据不足：当前赛道或车辆身份不可用。',
      ja: '証拠不足: 現在のコースまたは車両を特定できません。'
    })}`
  } else if (sufficientHistory) {
    const verificationNote =
      unverifiedHistoryCount > 0
        ? ` ${localized(language, {
            'en-US': `${unverifiedHistoryCount} lap(s) unverified; they are down-weighted and never used as a clean benchmark.`,
            'pt-BR': `${unverifiedHistoryCount} volta(s) não verificada(s); peso reduzido e nunca usadas como benchmark limpo.`,
            es: `${unverifiedHistoryCount} vuelta(s) no verificada(s); peso reducido y nunca como referencia limpia.`,
            fr: `${unverifiedHistoryCount} tour(s) non vérifié(s), pondérés à la baisse et jamais utilisés comme référence propre.`,
            de: `${unverifiedHistoryCount} unverifizierte Runde(n), niedriger gewichtet und nie als saubere Referenz genutzt.`,
            zh: `${unverifiedHistoryCount} 个圈未经验证；降低权重且绝不用作干净基准。`,
            ja: `${unverifiedHistoryCount} 周は未検証です。低く重み付けし、クリーン基準には使いません。`
          })}`
        : ''
    header = `${qualify} — ${localized(language, {
      'en-US': `player ${condition} history, ${history.length} comparable completed laps.`,
      'pt-BR': `histórico próprio no ${condition}, ${history.length} voltas completas comparáveis.`,
      es: `historial propio en ${condition}, ${history.length} vueltas completas comparables.`,
      fr: `historique pilote sur piste ${condition}, ${history.length} tours complets comparables.`,
      de: `eigene Historie (${condition}), ${history.length} vergleichbare vollständige Runden.`,
      zh: `车手${condition}历史，${history.length} 个可比完整圈。`,
      ja: `ドライバーの${condition}履歴、比較可能な完走ラップ ${history.length} 周。`
    })}${verificationNote}`
  } else {
    insufficientReason = 'laps'
    header = `${qualify} — ${localized(language, {
      'en-US': `insufficient ${condition} history (${history.length}/${minComparableLaps} completed laps); no personalized briefing.`,
      'pt-BR': `histórico ${condition} insuficiente (${history.length}/${minComparableLaps} voltas completas); sem briefing personalizado.`,
      es: `historial ${condition} insuficiente (${history.length}/${minComparableLaps} vueltas completas); sin informe personalizado.`,
      fr: `historique ${condition} insuffisant (${history.length}/${minComparableLaps} tours complets); aucun briefing personnalisé.`,
      de: `unzureichende ${condition} Historie (${history.length}/${minComparableLaps} vollständige Runden); kein persönliches Briefing.`,
      zh: `${condition}历史不足（${history.length}/${minComparableLaps} 个完整圈）；不生成个性化简报。`,
      ja: `${condition}履歴が不足しています（完走 ${history.length}/${minComparableLaps} 周）。個別ブリーフィングは出しません。`
    })}`
  }

  const noPattern =
    sufficientHistory
      ? localized(language, {
          'en-US': 'No recurring high-confidence loss is supported.',
          'pt-BR': 'Nenhuma perda recorrente de alta confiança é sustentada.',
          es: 'No hay una pérdida recurrente de alta confianza respaldada.',
          fr: 'Aucune perte récurrente à forte confiance n’est confirmée.',
          de: 'Kein wiederkehrender Verlust mit hoher Sicherheit ist belegt.',
          zh: '没有得到支持的高置信度重复损失。',
          ja: '高信頼で繰り返すロスは確認できません。'
        })
      : localized(language, {
          'en-US': 'More condition-matched completed laps are required.',
          'pt-BR': 'São necessárias mais voltas completas nas mesmas condições.',
          es: 'Se necesitan más vueltas completas con las mismas condiciones.',
          fr: 'Il faut davantage de tours complets dans les mêmes conditions.',
          de: 'Mehr vollständige Runden unter gleichen Bedingungen sind nötig.',
          zh: '需要更多相同条件下的完整圈。',
          ja: '同じ条件の完走ラップがさらに必要です。'
        })
  let displayedItems = items
  const compose = (list: QualiSummaryItem[]): string =>
    list.length > 0
      ? `${header} ${list.map((item) => `${item.priority}) ${item.text}`).join(' ')}`
      : `${header} ${noPattern}`
  while (displayedItems.length > 1 && compose(displayedItems).length > MAX_QUALI_BRIEFING_LENGTH) {
    displayedItems = displayedItems.slice(0, -1)
  }
  const text = capText(compose(displayedItems), MAX_QUALI_BRIEFING_LENGTH)
  if (sufficientHistory && patterns.length === 0) insufficientReason = 'confidence'

  return {
    sufficientHistory,
    comparableLapCount: history.length,
    verifiedLapCount: verifiedHistoryCount,
    unverifiedLapCount: unverifiedHistoryCount,
    currentSessionLapCount: currentSession.length,
    source,
    insufficientReason,
    condition: request.current.condition,
    items: displayedItems,
    text
  }
}
