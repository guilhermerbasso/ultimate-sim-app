import {
  coachDimensionForKind,
  type CoachCornerMetrics,
  type CoachFinding,
  type CoachFindingKind,
  type CoachPhase,
  type CoachReferenceLap,
  type CoachReport
} from './coach'
import type { TelemetrySnapshot } from './telemetry'
import { formatMeasurement, type UnitSystem } from './units'

export type RacecraftQuestionIntent = 'overtake' | 'pull-away'
export type RacecraftAdviceMode = 'overtake' | 'defend' | 'lap-improvement'
export type RacecraftGapTrend = 'closing' | 'opening' | 'stable' | 'unknown'
export type CoachTrackCondition = 'dry' | 'intermediate' | 'wet' | 'drying'
export type CoachAdviceLanguage = 'en-US' | 'pt-BR'

export interface CoachGapSample {
  at: number
  aheadSec?: number
  behindSec?: number
  aheadCarIdx?: number
  behindCarIdx?: number
}

export interface RacecraftAdviceContext {
  findings?: readonly CoachFinding[]
  cornerMetrics?: readonly CoachCornerMetrics[]
  reference?: CoachReferenceLap | null
  gaps?: readonly CoachGapSample[]
  currentGapAheadSec?: number
  currentGapBehindSec?: number
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
  text: string
}

export interface RacecraftAdvice {
  intent: RacecraftQuestionIntent
  mode: RacecraftAdviceMode
  opponentData: 'timing-only' | 'unavailable'
  gapSec?: number
  gapTrend: RacecraftGapTrend
  items: RacecraftAdviceItem[]
  honestyNote: string
  text: string
}

export interface CoachComparableIdentity {
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
  sessionType?: string
  lapNumber?: number
  lapTimeSec?: number
  valid: boolean
  identity: CoachComparableIdentity
  findings: CoachFinding[]
  cornerMetrics: CoachCornerMetrics[]
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
  currentSessionLapCount: number
  source: 'history' | 'current-session' | 'none'
  condition: CoachTrackCondition
  items: QualiSummaryItem[]
  text: string
}

const MAX_RACECRAFT_ITEMS = 3
const MIN_GAP_TREND_DELTA_SEC = 0.15
const MIN_GAP_TREND_WINDOW_MS = 1000

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
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
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
  const wetness = finite(input.trackWetnessPct) ? Math.max(0, Math.min(1, input.trackWetnessPct)) : 0
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

export function coachLapHistoryEntry(
  snapshot: TelemetrySnapshot,
  report: CoachReport,
  valid: boolean,
  at = snapshot.timestamp || Date.now(),
  identity = coachComparableIdentityFromSnapshot(snapshot)
): CoachLapHistoryEntry {
  return {
    id: `${snapshot.sessionUniqueId ?? 'session'}:${report.lapNumber ?? at}`,
    at,
    sessionId: finite(snapshot.sessionUniqueId) ? snapshot.sessionUniqueId : undefined,
    sessionType: snapshot.sessionType,
    lapNumber: report.lapNumber,
    lapTimeSec: report.lapTimeSec,
    valid,
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
  if (!normalize(current.trackName) || normalize(current.trackName) !== normalize(candidate.trackName)) return false
  if (
    !normalize(current.trackConfigName) ||
    normalize(current.trackConfigName) !== normalize(candidate.trackConfigName)
  ) return false

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

export function comparableCoachLaps(
  current: CoachComparableIdentity,
  laps: readonly CoachLapHistoryEntry[]
): CoachLapHistoryEntry[] {
  return laps.filter((lap) => lap.valid && areCoachLapsComparable(current, lap.identity))
}

export function detectRacecraftQuestion(question: string): RacecraftQuestionIntent | null {
  const q = normalize(question)
  if (!q) return null
  const overtake =
    /\b(overtake|pass the car ahead|pass car ahead|how (?:do|can|should) i pass|how (?:do|can|should) i overtake)\b/.test(q) ||
    /\b(como (?:eu )?(?:passo|passar|ultrapasso|ultrapassar)|passar o carro da frente|ultrapassar o carro da frente)\b/.test(q)
  if (overtake) return 'overtake'
  const pullAway =
    /\b(pull away|open (?:a )?gap|gap the car behind|lose the car behind|drop the car behind)\b/.test(q) ||
    /\b(como (?:eu )?(?:abro|abrir|aumento|aumentar) (?:(?:a|o) )?(?:distancia|vantagem|gap)|afastar o carro de tras|escapar do carro de tras)\b/.test(q)
  return pullAway ? 'pull-away' : null
}

export function analyzeGapTrend(
  samples: readonly CoachGapSample[] | undefined,
  side: 'ahead' | 'behind',
  currentGapSec?: number
): { gapSec?: number; trend: RacecraftGapTrend; deltaSec?: number; windowSec?: number } {
  const key = side === 'ahead' ? 'aheadSec' : 'behindSec'
  const carKey = side === 'ahead' ? 'aheadCarIdx' : 'behindCarIdx'
  const allUsable = (samples ?? [])
    .filter((sample) => finite(sample.at) && positiveGap(sample[key]) !== undefined)
    .slice()
    .sort((a, b) => a.at - b.at)
  const latestCarIdx = allUsable.length > 0 ? allUsable[allUsable.length - 1][carKey] : undefined
  const usable = finite(latestCarIdx)
    ? allUsable.filter((sample) => sample[carKey] === latestCarIdx)
    : allUsable
  const fallback = positiveGap(currentGapSec)
  const latest = fallback ?? (usable.length > 0 ? positiveGap(usable[usable.length - 1][key]) : undefined)
  if (usable.length < 2) return { gapSec: latest, trend: 'unknown' }
  const first = usable[0]
  const last = usable[usable.length - 1]
  const windowMs = last.at - first.at
  if (windowMs < MIN_GAP_TREND_WINDOW_MS) return { gapSec: latest, trend: 'unknown' }
  const firstGap = positiveGap(first[key])
  const lastGap = positiveGap(last[key])
  if (firstGap === undefined || lastGap === undefined) return { gapSec: latest, trend: 'unknown' }
  const deltaSec = lastGap - firstGap
  const trend =
    Math.abs(deltaSec) < MIN_GAP_TREND_DELTA_SEC
      ? 'stable'
      : deltaSec < 0
        ? 'closing'
        : 'opening'
  return { gapSec: latest ?? lastGap, trend, deltaSec, windowSec: windowMs / 1000 }
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
  const pt = language === 'pt-BR'
  switch (kind) {
    case 'brake-early':
      return hasValidReference
        ? pt
          ? 'freie mais tarde, usando sua referência válida'
          : 'brake later toward your valid-lap reference'
        : pt
          ? 'freie um pouco mais tarde, uma etapa por vez'
          : 'brake later, one step at a time'
    case 'brake-late':
    case 'trail-brake-lock':
    case 'abs-overuse':
      return pt ? 'freie um pouco antes e solte o pedal de forma progressiva' : 'brake a touch earlier and release the pedal progressively'
    case 'steering-early':
      return pt ? 'atrase o turn-in e faça um arco limpo' : 'delay turn-in and use one clean arc'
    case 'steering-late':
      return pt ? 'antecipe um pouco o turn-in' : 'turn in a touch earlier'
    case 'steering-busy':
      return pt ? 'faça uma única entrada, sem correções' : 'use one clean steering arc'
    case 'steering-insufficient':
      return pt ? 'adicione steering para apontar o carro ao apex' : 'add steering so the car points to the apex'
    case 'throttle-early':
    case 'tc-overuse':
      return pt ? 'espere o carro apontar e aplique throttle de forma progressiva' : 'wait for rotation, then squeeze the throttle progressively'
    case 'throttle-late':
    case 'throttle-hesitation':
      return pt ? 'retorne ao throttle mais cedo e sem hesitar' : 'return to throttle earlier and commit'
    case 'coast':
      return pt ? 'conecte a soltura do freio ao retorno do throttle' : 'connect brake release directly to throttle return'
    case 'time-loss':
      return hasValidReference
        ? pt
          ? 'iguale sua referência válida de entrada, apex e saída'
          : 'match your valid-lap entry, apex, and exit reference'
        : pt
          ? 'reduza a perda medida entre entrada, apex e saída'
          : 'reduce the measured loss across entry, apex, and exit'
    case 'inconsistency':
      return pt ? 'repita os mesmos pontos de freada e turn-in' : 'repeat the same brake and turn-in points'
    case 'min-speed-gain':
    case 'brake-gain':
    case 'throttle-gain':
    case 'good':
      return pt ? 'mantenha essa referência' : 'keep that reference'
  }
}

function expectedBenefit(
  mode: RacecraftAdviceMode,
  phase: CoachPhase,
  language: CoachAdviceLanguage
): string {
  const pt = language === 'pt-BR'
  if (mode === 'overtake') {
    if (phase === 'entry') return pt ? 'fechar na freada sem devolver tempo no apex' : 'close under braking without giving the time back at the apex'
    if (phase === 'exit') return pt ? 'levar mais speed para a reta e criar uma ultrapassagem mais segura' : 'carry more speed onto the straight and create a safer passing run'
    return pt ? 'preservar speed mínima para sair mais perto no vácuo' : 'preserve minimum speed so the draft is stronger on exit'
  }
  if (mode === 'defend') {
    if (phase === 'exit') return pt ? 'abrir o gap pela aceleração, sem sacrificar a linha' : 'build the gap through acceleration instead of sacrificing the line'
    return pt ? 'proteger o apex e negar uma saída melhor ao carro de trás' : 'protect the apex and deny the car behind a better exit'
  }
  if (phase === 'exit') return pt ? 'melhorar a saída e reduzir seu próprio tempo de volta' : 'improve exit quality and lower your own lap time'
  if (phase === 'entry') return pt ? 'reduzir a perda na entrada sem comprometer o apex' : 'reduce the entry loss without compromising the apex'
  return pt ? 'carregar mais speed pelo apex e reduzir o tempo de volta' : 'carry more speed through the apex and lower your lap time'
}

function tractionQuality(finding: CoachFinding, metrics: CoachCornerMetrics | undefined) {
  if (finding.kind === 'tc-overuse' || finding.kind === 'throttle-early') return 'tc-limited' as const
  if (finding.kind === 'throttle-late' || finding.kind === 'throttle-hesitation') return 'delayed' as const
  if (finding.kind === 'coast') return 'disconnected' as const
  if (finite(metrics?.tcActivePct) && metrics.tcActivePct >= 0.15) return 'tc-limited' as const
  if (phaseForFinding(finding) === 'exit' && finite(metrics?.tcActivePct) && metrics.tcActivePct <= 0.05) return 'clean' as const
  return undefined
}

function locationKey(finding: Pick<CoachFinding, 'corner' | 'sector'>): string {
  return finite(finding.corner) ? `c${finding.corner}` : `s${finding.sector}`
}

function candidateKey(finding: CoachFinding): string {
  const dimension = coachDimensionForKind(finding.kind) ?? finding.kind
  return `${locationKey(finding)}:${dimension}`
}

function actionableFindings(findings: readonly CoachFinding[] | undefined): CoachFinding[] {
  const best = new Map<string, CoachFinding>()
  for (const finding of findings ?? []) {
    if (finding.context === true || finding.severity === 'good' || finding.sign === 'gain') continue
    if (!(finding.estTimeLossSec > 0)) continue
    const key = candidateKey(finding)
    const previous = best.get(key)
    if (
      !previous ||
      finding.estTimeLossSec > previous.estTimeLossSec ||
      (finding.estTimeLossSec === previous.estTimeLossSec && finding.kind < previous.kind)
    ) {
      best.set(key, finding)
    }
  }

  const selected = [...best.values()]
  const specificLocations = new Set(selected.filter((finding) => finding.kind !== 'time-loss').map(locationKey))
  return selected.filter((finding) => finding.kind !== 'time-loss' || !specificLocations.has(locationKey(finding)))
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

function metricSnippet(
  evidence: RacecraftAdviceEvidence,
  phase: CoachPhase,
  kind: CoachFindingKind,
  language: CoachAdviceLanguage,
  unitSystem: UnitSystem
): string {
  const pt = language === 'pt-BR'
  const parts: string[] = []
  const speed = (label: string, current: number | undefined, reference: number | undefined): string | undefined => {
    if (!finite(current)) return undefined
    const currentReading = formatMeasurement(current, 'speed-kmh', unitSystem, { decimals: 0 })
    return finite(reference)
      ? `${label} ${currentReading.display} vs ${formatMeasurement(reference, 'speed-kmh', unitSystem, { decimals: 0 }).display} ${currentReading.unit}`
      : `${label} ${currentReading.display} ${currentReading.unit}`
  }
  const point = (label: string, current: number | undefined, reference: number | undefined): string | undefined => {
    if (!finite(current)) return undefined
    return finite(reference)
      ? `${label} ${formatPct(current)} ${pt ? 'volta' : 'lap'} vs ${formatPct(reference)}`
      : `${label} ${formatPct(current)} ${pt ? 'volta' : 'lap'}`
  }
  if (phase === 'entry') {
    const entry = speed(pt ? 'entrada' : 'entry', evidence.entrySpeedKmh, evidence.referenceEntrySpeedKmh)
    if (entry) parts.push(entry)
    const dimension = coachDimensionForKind(kind)
    const timing =
      dimension === 'steering-timing'
        ? point('turn-in', evidence.turnInPct, evidence.referenceTurnInPct)
        : point(pt ? 'ponto de freada' : 'brake point', evidence.brakePointPct, evidence.referenceBrakePointPct) ??
          point('turn-in', evidence.turnInPct, evidence.referenceTurnInPct)
    if (timing) parts.push(timing)
  } else if (phase === 'mid') {
    const apex = speed('apex', evidence.apexSpeedKmh, evidence.referenceApexSpeedKmh)
    if (apex) parts.push(apex)
  } else {
    const exit = speed(pt ? 'saída' : 'exit', evidence.exitSpeedKmh, evidence.referenceExitSpeedKmh)
    if (exit) parts.push(exit)
    const throttle = point(
      pt ? 'retorno ao throttle' : 'throttle return',
      evidence.throttleReturnPct,
      evidence.referenceThrottleReturnPct
    )
    if (throttle) parts.push(throttle)
    else if (evidence.tractionQuality) parts.push(`${pt ? 'tração' : 'traction'} ${evidence.tractionQuality}`)
  }
  return parts.slice(0, 2).join(', ')
}

function findingEvidence(
  finding: CoachFinding,
  metrics: CoachCornerMetrics | undefined,
  reference: CoachCornerMetrics | undefined,
  gapSec: number | undefined,
  gapTrend: RacecraftGapTrend
): RacecraftAdviceEvidence {
  return {
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
    referenceTurnInPct: reference?.steerStartPct,
    referenceThrottleReturnPct: reference?.throttleStartPct,
    tractionQuality: tractionQuality(finding, metrics),
    gapSec,
    gapTrend
  }
}

function locator(finding: Pick<CoachFinding, 'corner' | 'sector'>, language: CoachAdviceLanguage): string {
  const sector = language === 'pt-BR' ? 'Setor' : 'Sector'
  if (finite(finding.corner)) return `Turn ${finding.corner} (${sector} ${finding.sector})`
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
  unitSystem: UnitSystem
): RacecraftAdviceItem {
  const phase = phaseForFinding(finding)
  const hasValidReference =
    reference !== undefined ||
    finite(finding.metrics.refMinSpeedKmh) ||
    finite(finding.metrics.refBrakeStartPct) ||
    finite(finding.metrics.refSteerStartPct) ||
    finite(finding.metrics.refThrottleStartPct)
  const action = actionForKind(finding.kind, language, hasValidReference)
  const benefit = expectedBenefit(mode, phase, language)
  const evidence = findingEvidence(finding, metrics, reference, gapSec, gapTrend)
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
  const pt = language === 'pt-BR'
  const label =
    mode === 'overtake'
      ? 'OVERTAKE'
      : mode === 'defend'
        ? 'DEFEND'
        : pt
          ? 'MELHORIA DE VOLTA'
          : 'LAP IMPROVEMENT'
  const target = intent === 'overtake' ? (pt ? 'à frente' : 'ahead') : pt ? 'atrás' : 'behind'
  if (!finite(gapSec)) {
    return `${label} — ${pt ? `sem gap confiável para o carro ${target} e sem inputs do rival` : `no reliable car-${target} gap or opponent controls`}.`
  }
  const trendText =
    trend === 'unknown'
      ? ''
      : `, ${pt ? ({ closing: 'fechando', opening: 'abrindo', stable: 'estável' } as const)[trend] : trend}`
  return `${label} — ${pt ? 'gap' : 'gap'} ${target} ${gapSec.toFixed(1)}s${trendText}; ${pt ? 'sem inputs do rival' : 'opponent controls are unavailable'}.`
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
  const gap = analyzeGapTrend(context.gaps, side, currentGap)
  const mode: RacecraftAdviceMode =
    intent === 'overtake' &&
      finite(gap.gapSec) &&
      (gap.gapSec <= 3 || gap.trend === 'closing')
      ? 'overtake'
      : intent === 'pull-away' &&
          finite(gap.gapSec) &&
          (gap.gapSec <= 1.6 || gap.trend === 'closing')
        ? 'defend'
        : 'lap-improvement'

  const metricsByCorner = new Map<number, CoachCornerMetrics>()
  for (const metrics of context.cornerMetrics ?? []) metricsByCorner.set(metrics.corner, metrics)
  const referenceByCorner = new Map<number, CoachCornerMetrics>()
  for (const metrics of context.reference?.corners ?? []) referenceByCorner.set(metrics.corner, metrics)

  const maxItems = Math.max(1, Math.min(MAX_RACECRAFT_ITEMS, Math.floor(opts.maxItems ?? MAX_RACECRAFT_ITEMS)))
  const ranked = actionableFindings(context.findings)
    .sort(
      (a, b) =>
        adviceScore(b, mode) - adviceScore(a, mode) ||
        locationKey(a).localeCompare(locationKey(b)) ||
        a.kind.localeCompare(b.kind)
    )

  const onePerLocation = new Map<string, CoachFinding>()
  for (const finding of ranked) {
    const key = locationKey(finding)
    if (!onePerLocation.has(key)) onePerLocation.set(key, finding)
  }
  const items = [...onePerLocation.values()]
    .slice(0, maxItems)
    .map((finding, index) =>
      buildAdviceItem(
        finding,
        index + 1,
        mode,
        language,
        finite(finding.corner) ? metricsByCorner.get(finding.corner) : undefined,
        finite(finding.corner) ? referenceByCorner.get(finding.corner) : undefined,
        gap.gapSec,
        gap.trend,
        unitSystem
      )
    )

  const header = racecraftHeader(intent, mode, gap.gapSec, gap.trend, language)
  const noEvidence =
    language === 'pt-BR'
      ? 'Complete uma volta válida para eu montar um plano específico por curva.'
      : 'Complete a valid lap before I give a corner-specific plan.'
  const text = items.length > 0 ? `${header} ${items.map((item) => `${item.priority}) ${item.text}`).join(' ')}` : `${header} ${noEvidence}`
  return {
    intent,
    mode,
    opponentData: finite(gap.gapSec) ? 'timing-only' : 'unavailable',
    gapSec: gap.gapSec,
    gapTrend: gap.trend,
    items,
    honestyNote:
      language === 'pt-BR'
        ? 'O rival só fornece gap/posição/radar; o plano usa sua telemetria, referências válidas e tendência de gap.'
        : 'The opponent only supplies gap/position/radar; the plan uses player telemetry, valid references, and gap trend.',
    text
  }
}

interface QualiPattern {
  finding: CoachFinding
  metrics?: CoachCornerMetrics
  lapsSeen: number
  totalLossSec: number
}

function qualiPatterns(laps: readonly CoachLapHistoryEntry[]): QualiPattern[] {
  const exact = new Map<string, QualiPattern>()
  for (const lap of laps) {
    for (const finding of actionableFindings(lap.findings)) {
      const key = `${locationKey(finding)}:${finding.kind}`
      const previous = exact.get(key)
      const metrics = finite(finding.corner)
        ? lap.cornerMetrics.find((candidate) => candidate.corner === finding.corner)
        : undefined
      if (previous) {
        previous.lapsSeen += 1
        previous.totalLossSec += finding.estTimeLossSec
        if (finding.estTimeLossSec > previous.finding.estTimeLossSec) {
          previous.finding = finding
          previous.metrics = metrics
        }
      } else {
        exact.set(key, { finding, metrics, lapsSeen: 1, totalLossSec: finding.estTimeLossSec })
      }
    }
  }

  const noContradictions = new Map<string, QualiPattern>()
  for (const pattern of exact.values()) {
    const key = candidateKey(pattern.finding)
    const previous = noContradictions.get(key)
    const average = pattern.totalLossSec / pattern.lapsSeen
    const previousAverage = previous ? previous.totalLossSec / previous.lapsSeen : -1
    if (
      !previous ||
      pattern.lapsSeen > previous.lapsSeen ||
      (pattern.lapsSeen === previous.lapsSeen && average > previousAverage)
    ) {
      noContradictions.set(key, pattern)
    }
  }

  const selected = [...noContradictions.values()]
  const specificLocations = new Set(
    selected.filter((pattern) => pattern.finding.kind !== 'time-loss').map((pattern) => locationKey(pattern.finding))
  )
  return selected.filter(
    (pattern) => pattern.finding.kind !== 'time-loss' || !specificLocations.has(locationKey(pattern.finding))
  )
}

function conditionLabel(condition: CoachTrackCondition, language: CoachAdviceLanguage): string {
  if (language === 'en-US') return condition
  return ({ dry: 'seco', intermediate: 'intermediário', wet: 'molhado', drying: 'secando' } as const)[condition]
}

export function buildQualiStartSummary(request: QualiStartSummaryRequest): QualiStartSummary {
  const language = request.language ?? 'en-US'
  const unitSystem = request.unitSystem ?? 'metric'
  const minComparableLaps = Math.max(1, Math.floor(request.minComparableLaps ?? 3))
  const maxItems = Math.max(1, Math.min(MAX_RACECRAFT_ITEMS, Math.floor(request.maxItems ?? MAX_RACECRAFT_ITEMS)))
  const history = comparableCoachLaps(request.current, request.history)
  const currentSession = comparableCoachLaps(request.current, request.currentSession ?? [])
  const sufficientHistory = history.length >= minComparableLaps
  const source: QualiStartSummary['source'] = sufficientHistory
    ? 'history'
    : currentSession.length > 0
      ? 'current-session'
      : 'none'
  const dataset = source === 'history' ? history : source === 'current-session' ? currentSession : []
  const minSeen = source === 'history' ? Math.max(2, Math.ceil(dataset.length / 2)) : 1
  const patterns = qualiPatterns(dataset)
    .filter((pattern) => pattern.lapsSeen >= minSeen)
    .sort((a, b) => {
      const aAvg = a.totalLossSec / a.lapsSeen
      const bAvg = b.totalLossSec / b.lapsSeen
      return (
        b.lapsSeen / dataset.length * bAvg -
          a.lapsSeen / dataset.length * aAvg ||
        locationKey(a.finding).localeCompare(locationKey(b.finding))
      )
    })
    .slice(0, maxItems)

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
      unitSystem
    )
    const averageLossSec = pattern.totalLossSec / pattern.lapsSeen
    const prefix =
      source === 'history'
        ? language === 'pt-BR'
          ? `recorrente em ${pattern.lapsSeen}/${dataset.length} voltas válidas (~${averageLossSec.toFixed(2)}s)`
          : `recurring in ${pattern.lapsSeen}/${dataset.length} valid laps (~${averageLossSec.toFixed(2)}s)`
        : language === 'pt-BR'
          ? `sessão atual (~${averageLossSec.toFixed(2)}s)`
          : `current session (~${averageLossSec.toFixed(2)}s)`
    return {
      ...base,
      lapsSeen: pattern.lapsSeen,
      lapsCompared: dataset.length,
      averageLossSec,
      text: `${locator(pattern.finding, language)} — ${prefix}: ${base.action}; ${base.expectedBenefit}.`
    }
  })

  const condition = conditionLabel(request.current.condition, language)
  let header: string
  if (source === 'history') {
    header =
      language === 'pt-BR'
        ? `QUALI — ${history.length} voltas válidas comparáveis no ${condition}.`
        : `QUALIFY — ${history.length} comparable valid ${condition} laps.`
  } else if (source === 'current-session') {
    header =
      language === 'pt-BR'
        ? `QUALI — histórico comparável insuficiente (${history.length}/${minComparableLaps}); usando só ${currentSession.length} volta(s) válida(s) da sessão atual.`
        : `QUALIFY — insufficient comparable history (${history.length}/${minComparableLaps}); using only ${currentSession.length} valid current-session lap(s).`
  } else {
    header =
      language === 'pt-BR'
        ? `QUALI — histórico comparável insuficiente (${history.length}/${minComparableLaps}) e nenhuma volta válida na sessão atual.`
        : `QUALIFY — insufficient comparable history (${history.length}/${minComparableLaps}) and no valid current-session lap yet.`
  }

  const noPattern =
    source === 'history'
      ? language === 'pt-BR'
        ? 'Nenhum erro recorrente tem evidência suficiente para ser chamado de padrão pessoal.'
        : 'No recurring loss has enough evidence to call it a personal pattern.'
      : language === 'pt-BR'
        ? 'Ainda não há perda acionável repetida para resumir.'
        : 'There is no repeated actionable loss to summarize yet.'
  const text = items.length > 0 ? `${header} ${items.map((item) => `${item.priority}) ${item.text}`).join(' ')}` : `${header} ${noPattern}`

  return {
    sufficientHistory,
    comparableLapCount: history.length,
    currentSessionLapCount: currentSession.length,
    source,
    condition: request.current.condition,
    items,
    text
  }
}
