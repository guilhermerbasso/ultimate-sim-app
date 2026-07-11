// Deterministic Context Pack builder.
//
// `buildContextPack(snapshot, extras)` pre-digests the live session into a SMALL
// structured object; `renderContextText(pack)` flattens it into a short plain
// text block for the tiny LLM's prompt (aim < ~400 tokens). Everything here is
// pure and unit-testable — no node-llama-cpp, no Electron, no live engine
// instances. Engine states (fuel/tyre/lap/coach) are passed in via `extras`; if
// absent we derive what we can from the raw snapshot.
//
// The per-field derivation helpers are exported so the intent router and the
// tools layer reuse the exact same logic (single source of truth).

import type {
  ContextPack,
  ContextPackExtras,
  FuelStatus,
  PackCarTrack,
  PackCoachFinding,
  PackEvent,
  PackFuel,
  PackGaps,
  PackHybrid,
  PackPit,
  PackPosition,
  PackSession,
  PackTyres,
  PackWeather,
  SessionKind,
  SessionPhase
} from '../../shared/ai-engineer'
import { formatMeasurement, type UnitSystem } from '../../shared/units'
import type { CoachFinding, CoachTip } from '../../shared/coach'
import { groundedFindingText } from '../../shared/coach'
import type { FuelStrategyState } from '../../shared/fuel'
import type { LapTimingState } from '../../shared/laptiming'
import type { PredictionsSnapshot } from '../../shared/predictions'
import type { TelemetrySnapshot, TyreInfo } from '../../shared/telemetry'
import { formatTimeOfDay, trackSurfaceMaterialLabel } from '../../shared/telemetry'
import type { TireStrategyState } from '../../shared/tire-strategy'

const DEFAULT_MAX_EVENTS = 3
const DEFAULT_MAX_TOKENS = 400

// ─── small numeric / formatting helpers ──────────────────────────────────────

export function isFiniteNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isPositive(value: unknown): value is number {
  return isFiniteNum(value) && value > 0
}

export function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** "1:23.456" / "59.812" for a lap-time in seconds. */
export function formatLapTime(sec: number | undefined): string | undefined {
  if (!isPositive(sec)) return undefined
  const minutes = Math.floor(sec / 60)
  const seconds = sec - minutes * 60
  if (minutes <= 0) return seconds.toFixed(3)
  return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`
}

/** "+0.42s" / "-1.10s" for a signed delta in seconds. */
export function formatSignedSec(sec: number | undefined, digits = 2): string | undefined {
  if (!isFiniteNum(sec)) return undefined
  const sign = sec > 0 ? '+' : sec < 0 ? '-' : ''
  return `${sign}${Math.abs(sec).toFixed(digits)}s`
}

// ─── per-field derivations (pure) ────────────────────────────────────────────

export function deriveSessionKind(rawType: string | undefined): SessionKind {
  if (!rawType) return 'unknown'
  const t = rawType.toLowerCase()
  if (t.includes('race')) return 'race'
  if (t.includes('qual') || t.includes('lone') || t.includes('open qual')) return 'qualify'
  if (t.includes('warm')) return 'warmup'
  if (t.includes('practice') || t.includes('test') || t.includes('offline')) return 'practice'
  return 'unknown'
}

export function deriveSessionPhase(snapshot: TelemetrySnapshot | null): SessionPhase {
  if (!snapshot?.connected) return 'unknown'
  if (snapshot.flags?.checkered) return 'finished'
  if (snapshot.onPitRoad === true || snapshot.pit?.inPitStall === true) return 'pit'
  if (snapshot.flags?.green === true) return 'green'
  if (isPositive(snapshot.currentLap)) return 'green'
  return 'pre'
}

export function deriveCarTrack(snapshot: TelemetrySnapshot | null): PackCarTrack {
  return {
    car: snapshot?.carName || undefined,
    track: snapshot?.trackName || undefined,
    sim: snapshot?.sim && snapshot.sim !== 'none' ? snapshot.sim : undefined
  }
}

export function deriveSession(snapshot: TelemetrySnapshot | null, fuel?: FuelStrategyState | null): PackSession {
  const rawType = snapshot?.sessionType
  const lapsRemaining = isFiniteNum(snapshot?.lapsRemaining)
    ? snapshot?.lapsRemaining
    : isFiniteNum(fuel?.raceLapsRemaining)
      ? Math.round(fuel?.raceLapsRemaining as number)
      : undefined
  const totalLaps = isPositive(snapshot?.currentLap) && isFiniteNum(lapsRemaining)
    ? (snapshot?.currentLap as number) + (lapsRemaining as number)
    : undefined
  return {
    kind: deriveSessionKind(rawType),
    rawType: rawType || undefined,
    phase: deriveSessionPhase(snapshot),
    lap: isPositive(snapshot?.currentLap) ? snapshot?.currentLap : undefined,
    totalLaps,
    lapsRemaining,
    timeRemainingSec: isFiniteNum(snapshot?.sessionTimeRemainingSec) ? snapshot?.sessionTimeRemainingSec : undefined,
    timeOfDay: formatTimeOfDay(snapshot?.sessionTimeOfDay)
  }
}

export function derivePosition(snapshot: TelemetrySnapshot | null): PackPosition {
  return {
    position: isPositive(snapshot?.position) ? snapshot?.position : undefined,
    classPosition: isPositive(snapshot?.classPosition) ? snapshot?.classPosition : undefined,
    totalCars: isPositive(snapshot?.totalCars) ? snapshot?.totalCars : undefined
  }
}

export function deriveTiming(snapshot: TelemetrySnapshot | null, lap?: LapTimingState | null) {
  const lastSec = isPositive(lap?.lastLap) ? lap?.lastLap : isPositive(snapshot?.lastLapTimeSec) ? snapshot?.lastLapTimeSec : undefined
  const bestSec = isPositive(lap?.bestLap) ? lap?.bestLap : isPositive(snapshot?.bestLapTimeSec) ? snapshot?.bestLapTimeSec : undefined
  const predictedSec = isPositive(lap?.predicted)
    ? lap?.predicted
    : isPositive(snapshot?.estimatedLapTimeSec)
      ? snapshot?.estimatedLapTimeSec
      : undefined
  const deltaSec = isFiniteNum(lap?.deltaBest)
    ? lap?.deltaBest
    : isFiniteNum(snapshot?.deltaToBestSec)
      ? snapshot?.deltaToBestSec
      : undefined
  return { lastSec, bestSec, predictedSec, deltaSec }
}

export function deriveFuel(snapshot: TelemetrySnapshot | null, fuel?: FuelStrategyState | null): PackFuel {
  const liters = isFiniteNum(fuel?.fuelLiters) ? fuel?.fuelLiters : isFiniteNum(snapshot?.fuelLiters) ? snapshot?.fuelLiters : undefined
  const perLap = isPositive(fuel?.usedPerLap) ? fuel?.usedPerLap : isPositive(snapshot?.fuelPerLap) ? snapshot?.fuelPerLap : undefined
  const raceLapsRemaining = isFiniteNum(fuel?.raceLapsRemaining)
    ? fuel?.raceLapsRemaining
    : isFiniteNum(snapshot?.lapsRemaining)
      ? snapshot?.lapsRemaining
      : undefined
  const lapsLeft = isFiniteNum(fuel?.lapsLeftWithFuel)
    ? fuel?.lapsLeftWithFuel
    : isPositive(perLap) && isFiniteNum(liters)
      ? (liters as number) / (perLap as number)
      : undefined
  const toFinishLiters = isFiniteNum(fuel?.fuelToFinish)
    ? fuel?.fuelToFinish
    : isPositive(perLap) && isFiniteNum(raceLapsRemaining)
      ? (raceLapsRemaining as number) * (perLap as number)
      : undefined
  const deltaToFinishLiters = isFiniteNum(fuel?.fuelDeltaToFinish)
    ? fuel?.fuelDeltaToFinish
    : isFiniteNum(liters) && isFiniteNum(toFinishLiters)
      ? (liters as number) - (toFinishLiters as number)
      : undefined
  const canFinish = fuel?.pitWindow?.canFinish ?? (isFiniteNum(lapsLeft) && isFiniteNum(raceLapsRemaining) ? lapsLeft >= raceLapsRemaining : undefined)
  return {
    liters: isFiniteNum(liters) ? round(liters, 1) : undefined,
    perLap: isFiniteNum(perLap) ? round(perLap, 2) : undefined,
    lapsLeft: isFiniteNum(lapsLeft) ? round(lapsLeft, 1) : undefined,
    raceLapsRemaining: isFiniteNum(raceLapsRemaining) ? round(raceLapsRemaining, 1) : undefined,
    toFinishLiters: isFiniteNum(toFinishLiters) ? round(toFinishLiters, 1) : undefined,
    deltaToFinishLiters: isFiniteNum(deltaToFinishLiters) ? round(deltaToFinishLiters, 1) : undefined,
    saveTargetPerLap: isPositive(fuel?.saveNeededPerLap) ? round(fuel?.saveNeededPerLap as number, 2) : undefined,
    canFinish,
    status: fuel?.pitWindow?.status
  }
}

function tyreTemp(info: TyreInfo | undefined): number | undefined {
  if (!info) return undefined
  if (isFiniteNum(info.tempC)) return info.tempC
  if (isFiniteNum(info.tempMiddleC)) return info.tempMiddleC
  if (isFiniteNum(info.surfaceTempMiddleC)) return info.surfaceTempMiddleC
  const sides = [info.tempLeftC, info.tempRightC, info.surfaceTempLeftC, info.surfaceTempRightC].filter(isFiniteNum)
  if (sides.length > 0) return sides.reduce((a, b) => a + b, 0) / sides.length
  return undefined
}

export function deriveTyres(snapshot: TelemetrySnapshot | null, tire?: TireStrategyState | null): PackTyres {
  const corners: Array<'lf' | 'rf' | 'lr' | 'rr'> = ['lf', 'rf', 'lr', 'rr']
  const out: PackTyres = { estimated: tire?.estimated ?? undefined }
  for (const id of corners) {
    const temp = tyreTemp(snapshot?.tyres?.[id])
    // Strategy wear is a 0..100 "remaining life" scale; snapshot wearPct is 0..1.
    const stratWear = tire?.corners?.[id]?.wearPct
    const snapWear = snapshot?.tyres?.[id]?.wearPct
    const wearPct = isFiniteNum(stratWear) ? stratWear : isFiniteNum(snapWear) ? round(snapWear * 100, 0) : undefined
    if (isFiniteNum(temp) || isFiniteNum(wearPct)) {
      out[id] = {
        tempC: isFiniteNum(temp) ? round(temp, 0) : undefined,
        wearPct: isFiniteNum(wearPct) ? round(wearPct, 0) : undefined
      }
    }
  }
  out.worst = tire?.worstCorner ? tire.worstCorner.toUpperCase() : undefined
  out.lapsLeft = isFiniteNum(tire?.lapsRemainingOnTyres) ? round(tire?.lapsRemainingOnTyres as number, 1) : undefined
  return out
}

export function deriveGaps(snapshot: TelemetrySnapshot | null): PackGaps {
  const ahead = snapshot?.relatives?.ahead
  const behind = snapshot?.relatives?.behind
  return {
    aheadSec: isFiniteNum(ahead?.gapSec) ? round(Math.abs(ahead?.gapSec as number), 2) : undefined,
    behindSec: isFiniteNum(behind?.gapSec) ? round(Math.abs(behind?.gapSec as number), 2) : undefined,
    aheadName: ahead?.name || undefined,
    behindName: behind?.name || undefined
  }
}

export function deriveHybrid(snapshot: TelemetrySnapshot | null): PackHybrid | undefined {
  const hasErs = isFiniteNum(snapshot?.ersBatteryPct)
  const hasP2p = typeof snapshot?.pushToPass === 'boolean' || isFiniteNum(snapshot?.pushToPassCount)
  if (!hasErs && !hasP2p) return undefined
  return {
    ersBatteryPct: hasErs ? round((snapshot?.ersBatteryPct as number) * 100, 0) : undefined,
    p2pAvailable: typeof snapshot?.pushToPass === 'boolean' ? snapshot?.pushToPass : undefined,
    p2pActive: snapshot?.pushToPass === true ? true : undefined,
    p2pCount: isFiniteNum(snapshot?.pushToPassCount) ? snapshot?.pushToPassCount : undefined
  }
}

export function deriveWeather(snapshot: TelemetrySnapshot | null): PackWeather {
  const wetness = isFiniteNum(snapshot?.trackWetnessPct) ? round(snapshot?.trackWetnessPct * 100, 0) : undefined
  return {
    airTempC: isFiniteNum(snapshot?.airTempC) ? round(snapshot?.airTempC, 0) : undefined,
    trackTempC: isFiniteNum(snapshot?.trackTempC) ? round(snapshot?.trackTempC, 0) : undefined,
    wetnessPct: wetness,
    raining: typeof snapshot?.isRaining === 'boolean' ? snapshot?.isRaining : undefined,
    declaredWet: typeof snapshot?.weatherDeclaredWet === 'boolean' ? snapshot?.weatherDeclaredWet : undefined,
    surface: trackSurfaceMaterialLabel(snapshot?.trackSurfaceMaterial)
  }
}

export function derivePit(
  snapshot: TelemetrySnapshot | null,
  fuel?: FuelStrategyState | null,
  tire?: TireStrategyState | null
): PackPit {
  const fuelPitLap = fuel?.pitWindow?.latestLap
  const tyrePitLap = tire?.recommendedPitLap
  const recommendedLap = isFiniteNum(fuelPitLap) && isFiniteNum(tyrePitLap)
    ? Math.min(fuelPitLap, tyrePitLap)
    : (fuelPitLap ?? tyrePitLap ?? undefined)
  return {
    onPitRoad: typeof snapshot?.onPitRoad === 'boolean' ? snapshot?.onPitRoad : undefined,
    pitsOpen: typeof snapshot?.pit?.pitsOpen === 'boolean' ? snapshot?.pit?.pitsOpen : undefined,
    limiter: typeof snapshot?.pitLimiter === 'boolean' ? snapshot?.pitLimiter : undefined,
    recommendedLap: isFiniteNum(recommendedLap) ? recommendedLap : undefined,
    window: fuel?.pitWindow?.status
  }
}

export function deriveActiveFlags(snapshot: TelemetrySnapshot | null): string[] {
  const f = snapshot?.flags
  if (!f) return []
  const out: string[] = []
  if (f.checkered) out.push('checkered')
  if (f.red) out.push('red')
  if (f.yellow) out.push('yellow')
  if (f.blue) out.push('blue')
  if (f.white) out.push('white')
  if (f.black) out.push('black')
  if (f.meatball) out.push('meatball')
  if (f.repair) out.push('repair')
  if (f.disqualify) out.push('dq')
  if (f.greenWhiteCheckered) out.push('gwc')
  return out
}

// Build a few "recent notable events" from explicit events + top coach tips.
function deriveEvents(snapshot: TelemetrySnapshot | null, extras: ContextPackExtras | undefined, maxEvents: number): PackEvent[] {
  const events: PackEvent[] = [...(extras?.events ?? [])]
  const tips: CoachTip[] = extras?.coachTips ?? []
  const now = extras?.now ?? snapshot?.timestamp ?? 0
  for (const tip of tips.slice(0, 2)) {
    events.push({ at: tip.createdAt || now, kind: 'coach', text: tip.message })
  }
  // newest last; keep the final `maxEvents`.
  events.sort((a, b) => (a.at || 0) - (b.at || 0))
  return events.slice(-maxEvents)
}

// Compact the top deterministic coach findings (worst-first) for the COACHING block.
const DEFAULT_MAX_COACH_FINDINGS = 3
function deriveCoachFindings(extras: ContextPackExtras | undefined): PackCoachFinding[] | undefined {
  const raw: CoachFinding[] = extras?.coachFindings ?? []
  const actionable = raw.filter((f) => f.kind !== 'good' && f.context !== true)
  if (actionable.length === 0) return undefined
  return actionable.slice(0, DEFAULT_MAX_COACH_FINDINGS).map((f) => ({
    sector: f.sector,
    kind: f.kind,
    severity: f.severity,
    estTimeLossSec: round(f.estTimeLossSec, 2),
    title: f.title,
    groundedText: groundedFindingText(f),
    confidence: isFiniteNum(f.confidence) ? round(f.confidence, 2) : undefined,
    intent: f.intent,
    intentCategory: f.intentCategory,
    intentEvidence: f.intentEvidence
  }))
}

// Compact the WS-G predictions snapshot into a single readable line (or undefined).
function derivePredictions(extras: ContextPackExtras | undefined): string | undefined {
  const snap: PredictionsSnapshot | null | undefined = extras?.predictions
  if (!snap) return undefined
  const parts: string[] = []
  if (snap.catchAhead) parts.push(`catch ahead ~${snap.catchAhead.etaLaps.toFixed(1)} laps`)
  if (snap.caughtBehind) parts.push(`caught ~${snap.caughtBehind.etaLaps.toFixed(1)} laps`)
  const margin = snap.fuel.finishMarginLaps
  if (isFiniteNum(margin)) {
    parts.push(margin >= 0 ? `fuel +${margin.toFixed(1)} laps` : `fuel ${margin.toFixed(1)} laps short`)
  } else if (isFiniteNum(snap.fuel.lapsLeftAtPace)) {
    parts.push(`fuel ${snap.fuel.lapsLeftAtPace.toFixed(1)} laps in tank (race distance unknown)`)
  }
  if (isFiniteNum(snap.tire.lapsToCliff)) parts.push(`cliff ~${(snap.tire.lapsToCliff as number).toFixed(0)} laps`)
  const pace = formatLapTime(snap.pace.projectedLapSec)
  if (pace) parts.push(`pace ${pace} (${Math.round(snap.pace.confidence * 100)}%)`)
  return parts.length ? parts.join(' · ') : undefined
}

export interface PitRecommendation {
  recommendPit: boolean
  reason: string
  fuelStatus?: FuelStatus
  fuelLapsLeft?: number
  tyreLapsLeft?: number
  recommendedPitLap?: number
}

// Deterministic pit call from fuel + tyre engine states (+ damage flags). Pure;
// reused by the strategy tool and the intent router so both agree.
export function computePitRecommendation(
  snapshot: TelemetrySnapshot | null,
  fuel?: FuelStrategyState | null,
  tire?: TireStrategyState | null
): PitRecommendation {
  const fuelPack = deriveFuel(snapshot, fuel)
  const tyreLapsLeft = isFiniteNum(tire?.lapsRemainingOnTyres) ? round(tire?.lapsRemainingOnTyres as number, 1) : undefined
  const recommendedPitLap = derivePit(snapshot, fuel, tire).recommendedLap
  const damage = snapshot?.pit?.repairNeeded === true || snapshot?.flags?.meatball === true

  let recommendPit = false
  let reason = 'No need to pit yet.'

  if (snapshot?.onPitRoad === true) {
    reason = 'Already on pit road.'
  } else if (damage) {
    recommendPit = true
    reason = 'Pit for repairs — damage flagged.'
  } else if (fuelPack.status === 'critical' || (isFiniteNum(fuelPack.lapsLeft) && fuelPack.lapsLeft < 1)) {
    recommendPit = true
    reason = 'Pit now — fuel critical.'
  } else if (fuelPack.status === 'pit-required' || fuelPack.canFinish === false) {
    recommendPit = true
    reason = 'Pit required — not enough fuel to finish.'
  } else if (isFiniteNum(tyreLapsLeft) && tyreLapsLeft <= 1) {
    recommendPit = true
    reason = 'Pit soon — tyres past their window.'
  } else if (fuelPack.status === 'save') {
    reason = 'Stay out and save fuel to make the finish.'
  } else if (fuelPack.canFinish === true) {
    reason = 'Stay out — fuel covers the finish.'
  }

  return {
    recommendPit,
    reason,
    fuelStatus: fuelPack.status,
    fuelLapsLeft: fuelPack.lapsLeft,
    tyreLapsLeft,
    recommendedPitLap
  }
}

// ─── public builder + renderer ───────────────────────────────────────────────

export function buildContextPack(snapshot: TelemetrySnapshot | null, extras?: ContextPackExtras): ContextPack {
  const maxEvents = isPositive(extras?.maxEvents) ? Math.floor(extras?.maxEvents as number) : DEFAULT_MAX_EVENTS
  const generatedAt = extras?.now ?? snapshot?.timestamp ?? 0

  const pack: ContextPack = {
    car: deriveCarTrack(snapshot),
    session: deriveSession(snapshot, extras?.fuel),
    position: derivePosition(snapshot),
    timing: deriveTiming(snapshot, extras?.lap),
    fuel: deriveFuel(snapshot, extras?.fuel),
    tyres: deriveTyres(snapshot, extras?.tire),
    gaps: deriveGaps(snapshot),
    hybrid: deriveHybrid(snapshot),
    weather: deriveWeather(snapshot),
    pit: derivePit(snapshot, extras?.fuel, extras?.tire),
    flags: deriveActiveFlags(snapshot),
    events: deriveEvents(snapshot, extras, maxEvents),
    coachFindings: deriveCoachFindings(extras),
    predictions: derivePredictions(extras),
    referenceLap: extras?.referenceLapLabel ?? undefined,
    connected: snapshot?.connected ?? false,
    generatedAt,
    estimatedTokens: 0
  }

  pack.estimatedTokens = estimateTokens(renderContextText(pack))
  return pack
}

// Rough token estimate: ~4 chars/token. Good enough to keep the pack budgeted.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

interface RenderOptions {
  maxTokens?: number
  unitSystem?: UnitSystem
}

export function renderContextText(pack: ContextPack, options?: RenderOptions): string {
  const maxTokens = isPositive(options?.maxTokens) ? (options?.maxTokens as number) : DEFAULT_MAX_TOKENS
  const lines = renderLines(pack, options?.unitSystem ?? 'metric')
  let text = lines.join('\n')
  // Token-budget guard: drop the least-critical sections (events, then weather
  // detail) until we fit. The core race-engineer lines always stay.
  if (estimateTokens(text) > maxTokens) {
    const trimmed = lines.filter((l) => !l.startsWith('EVENTS') && !l.startsWith('- '))
    text = trimmed.join('\n')
  }
  return text
}

function renderLines(pack: ContextPack, unitSystem: UnitSystem): string[] {
  const lines: string[] = []

  if (!pack.connected) lines.push('STATUS: telemetry offline')

  const ct: string[] = []
  if (pack.car.car) ct.push(pack.car.car)
  if (pack.car.track) ct.push(`@ ${pack.car.track}`)
  if (pack.car.sim) ct.push(`(${pack.car.sim})`)
  if (ct.length) lines.push(`CAR/TRACK: ${ct.join(' ')}`)

  const s = pack.session
  const sParts: string[] = [s.kind]
  if (s.rawType && s.kind === 'unknown') sParts[0] = s.rawType
  sParts.push(`phase ${s.phase}`)
  if (isPositive(s.lap)) sParts.push(s.totalLaps ? `lap ${s.lap}/${s.totalLaps}` : `lap ${s.lap}`)
  if (isFiniteNum(s.lapsRemaining)) sParts.push(`${round(s.lapsRemaining, 0)} to go`)
  else if (isFiniteNum(s.timeRemainingSec)) sParts.push(`${Math.floor(s.timeRemainingSec / 60)}min left`)
  if (s.timeOfDay) sParts.push(`tod ${s.timeOfDay}`)
  lines.push(`SESSION: ${sParts.join(' · ')}`)

  const p = pack.position
  if (isPositive(p.position) || isPositive(p.classPosition)) {
    const parts: string[] = []
    if (isPositive(p.position)) parts.push(`P${p.position}`)
    if (isPositive(p.classPosition)) parts.push(`cls P${p.classPosition}`)
    if (isPositive(p.totalCars)) parts.push(`of ${p.totalCars}`)
    lines.push(`POS: ${parts.join(' ')}`)
  }

  const t = pack.timing
  if (t.lastSec || t.bestSec || isFiniteNum(t.deltaSec)) {
    const parts: string[] = []
    if (t.lastSec) parts.push(`last ${formatLapTime(t.lastSec)}`)
    if (t.bestSec) parts.push(`best ${formatLapTime(t.bestSec)}`)
    if (isFiniteNum(t.deltaSec)) parts.push(`Δ ${formatSignedSec(t.deltaSec)}`)
    if (t.predictedSec) parts.push(`pred ${formatLapTime(t.predictedSec)}`)
    lines.push(`LAP: ${parts.join(' ')}`)
  }

  const f = pack.fuel
  if (isFiniteNum(f.liters) || isFiniteNum(f.lapsLeft)) {
    const parts: string[] = []
    if (isFiniteNum(f.liters)) parts.push(formatMeasurement(f.liters, 'fuel-volume-l', unitSystem, { decimals: 1, trimTrailingZeros: true, includeUnit: true }).display)
    if (isFiniteNum(f.perLap)) parts.push(formatMeasurement(f.perLap, 'fuel-per-lap-l', unitSystem, { decimals: 2, trimTrailingZeros: true, includeUnit: true }).display)
    if (isFiniteNum(f.lapsLeft)) parts.push(`${f.lapsLeft} laps left`)
    if (isFiniteNum(f.toFinishLiters)) parts.push(`need ${formatMeasurement(f.toFinishLiters, 'fuel-volume-l', unitSystem, { decimals: 1, trimTrailingZeros: true, includeUnit: true }).display}`)
    if (isFiniteNum(f.deltaToFinishLiters)) parts.push(formatMeasurement(f.deltaToFinishLiters, 'fuel-volume-l', unitSystem, { decimals: 1, trimTrailingZeros: true, signed: true, includeUnit: true }).display)
    if (f.status) parts.push(f.status)
    if (isFiniteNum(f.saveTargetPerLap) && f.saveTargetPerLap > 0) parts.push(`save ${formatMeasurement(f.saveTargetPerLap, 'fuel-per-lap-l', unitSystem, { decimals: 2, trimTrailingZeros: true, includeUnit: true }).display}`)
    lines.push(`FUEL: ${parts.join(' · ')}`)
  }

  const ty = pack.tyres
  const tyParts: string[] = []
  for (const id of ['lf', 'rf', 'lr', 'rr'] as const) {
    const corner = ty[id]
    if (!corner) continue
    const bits: string[] = []
    if (isFiniteNum(corner.tempC)) bits.push(formatMeasurement(corner.tempC, 'temperature-c', unitSystem, { decimals: 0, includeUnit: true }).display)
    if (isFiniteNum(corner.wearPct)) bits.push(`${corner.wearPct}%`)
    if (bits.length) tyParts.push(`${id.toUpperCase()} ${bits.join('/')}`)
  }
  if (tyParts.length) {
    if (ty.worst) tyParts.push(`worst ${ty.worst}`)
    if (isFiniteNum(ty.lapsLeft)) tyParts.push(`${ty.lapsLeft} laps left`)
    lines.push(`TYRES: ${tyParts.join(' · ')}`)
  }

  const g = pack.gaps
  if (isFiniteNum(g.aheadSec) || isFiniteNum(g.behindSec)) {
    const parts: string[] = []
    if (isFiniteNum(g.aheadSec)) parts.push(`ahead ${g.aheadSec}s${g.aheadName ? ` (${g.aheadName})` : ''}`)
    if (isFiniteNum(g.behindSec)) parts.push(`behind ${g.behindSec}s${g.behindName ? ` (${g.behindName})` : ''}`)
    lines.push(`GAPS: ${parts.join(' · ')}`)
  }

  const h = pack.hybrid
  if (h) {
    const parts: string[] = []
    if (isFiniteNum(h.ersBatteryPct)) parts.push(`ERS ${h.ersBatteryPct}%`)
    if (h.p2pActive) parts.push('P2P active')
    else if (h.p2pAvailable) parts.push('P2P ready')
    if (isFiniteNum(h.p2pCount)) parts.push(`x${h.p2pCount}`)
    if (parts.length) lines.push(`HYBRID: ${parts.join(' · ')}`)
  }

  const w = pack.weather
  if (isFiniteNum(w.airTempC) || isFiniteNum(w.trackTempC) || typeof w.raining === 'boolean' || isFiniteNum(w.wetnessPct)) {
    const parts: string[] = []
    if (isFiniteNum(w.airTempC)) parts.push(`air ${formatMeasurement(w.airTempC, 'temperature-c', unitSystem, { decimals: 0, includeUnit: true }).display}`)
    if (isFiniteNum(w.trackTempC)) parts.push(`track ${formatMeasurement(w.trackTempC, 'temperature-c', unitSystem, { decimals: 0, includeUnit: true }).display}`)
    const wet = w.declaredWet || w.raining === true || (isFiniteNum(w.wetnessPct) && w.wetnessPct >= 15)
    parts.push(wet ? `wet${isFiniteNum(w.wetnessPct) ? ` ${w.wetnessPct}%` : ''}` : 'dry')
    if (w.surface) parts.push(w.surface)
    lines.push(`WEATHER: ${parts.join(' · ')}`)
  }

  const pit = pack.pit
  if (pit.onPitRoad === true || isFiniteNum(pit.recommendedLap) || pit.window) {
    const parts: string[] = []
    if (pit.onPitRoad === true) parts.push('on pit road')
    else if (pit.pitsOpen === false) parts.push('pits closed')
    if (isFiniteNum(pit.recommendedLap)) parts.push(`rec lap ${pit.recommendedLap}`)
    if (pit.window) parts.push(`window ${pit.window}`)
    if (parts.length) lines.push(`PIT: ${parts.join(' · ')}`)
  }

  if (pack.flags.length) lines.push(`FLAGS: ${pack.flags.join(', ')}`)
  if (pack.referenceLap) lines.push(`REFERENCE: ${pack.referenceLap}`)

  if (pack.coachFindings && pack.coachFindings.length) {
    const parts = pack.coachFindings.map((f) => {
      const meta: string[] = [`severity ${f.severity}`]
      if (isFiniteNum(f.confidence)) meta.push(`confidence ${Math.round(f.confidence * 100)}%`)
      if (f.intent) meta.push(`intent ${f.intent}${f.intentCategory ? `/${f.intentCategory}` : ''}`)
      return `${f.groundedText} [${meta.join(', ')}]`
    })
    lines.push(`COACHING: ${parts.join(' · ')}`)
  }

  if (pack.predictions) lines.push(`PREDICTIONS: ${pack.predictions}`)

  if (pack.events.length) {
    lines.push('EVENTS:')
    for (const ev of pack.events) lines.push(`- ${ev.text}${ev.kind ? ` (${ev.kind})` : ''}`)
  }

  return lines
}
