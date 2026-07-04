// Predictive race STRATEGY — PURE, deterministic projections (F4).
//
// IMPORTANT: this file is dependency-free (no node:*, no electron, no
// node-llama-cpp) exactly like shared/fuel.ts / shared/tire-strategy.ts, so it
// can be imported by main, renderer AND the unit tests without dragging in any
// runtime. It carries ONLY types + pure math.
//
// It COMPLEMENTS the existing fuel-strategy module (src/main/strategy/fuel.ts):
// that engine owns the rolling fuel-use sampling; here we add the predictive
// layer ON TOP — pit window, undercut/overcut vs a chosen rival, tyre stint
// projection, and a single "box now / extend / short-fill" recommendation with
// numbers. The main-process module feeds the already-sampled rates (fuel/lap/
// tyre) into `computeStrategyPlan(...)`; everything below stays a pure function
// of its inputs so it is trivially unit-testable with synthetic telemetry.

import type { TelemetrySnapshot } from './telemetry'

// ─── IPC channels (module + renderer agree on these) ─────────────────────────

export const STRATEGY_CHANNELS = {
  /** Broadcast: throttled live plan. */
  update: 'strategy:update',
  /** invoke(settings?) → StrategyPlan. */
  getPlan: 'strategy:getPlan',
  /** invoke(StrategyNarrateRequest) → StrategyNarration. */
  narrate: 'strategy:narrate',
  /** invoke() → StrategyConfig (persisted, e.g. the "usar IA local" toggle). */
  getConfig: 'strategy:getConfig',
  /** invoke(Partial<StrategyConfig>) → StrategyConfig (sanitized + persisted). */
  setConfig: 'strategy:setConfig',
  /** Broadcast: StrategyConfig changed (keeps every window in sync). */
  configEvent: 'strategy:config'
} as const

export type StrategyChannel = (typeof STRATEGY_CHANNELS)[keyof typeof STRATEGY_CHANNELS]

// ─── Config ──────────────────────────────────────────────────────────────────

export interface StrategyConfig {
  /** Estimated time lost for a pit stop vs staying out (pit-lane delta + service), seconds. */
  pitLossSec: number
  /** Safety buffer kept in the tank, expressed in LAPS of fuel. */
  fuelMarginLaps: number
  /**
   * Tyre LIFE fraction (0..1, 1 = fresh) at/below which the tyres are considered
   * "done" and a stop is called. Mirrors TireStrategySettings.wearThresholdPct.
   */
  tyreLifeThresholdPct: number
  /**
   * Span (in laps) BEFORE the limiting lap at which the pit window is considered
   * "open" (you could pit early to undercut). Default 5.
   */
  pitWindowSpanLaps: number
  /** Optional explicit rival to analyse for undercut/overcut (carIdx). Default: car directly ahead. */
  rivalCarIdx?: number
  /** Optional race-length overrides (mirror FuelStrategySettings). */
  targetLaps?: number
  raceTimeMinutes?: number
  /**
   * Persisted user preference: narrate strategy/incidents with the OPTIONAL local
   * LLM (when a model is already downloaded). Local-only UI toggles used to reset
   * on navigation; persisting it here keeps "usar IA local" sticky across pages.
   */
  useLocalAi: boolean
}

export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  pitLossSec: 25,
  fuelMarginLaps: 0.5,
  tyreLifeThresholdPct: 0.3,
  pitWindowSpanLaps: 5,
  useLocalAi: false
}

/**
 * Sanitize + merge a (partial) strategy config patch onto a base config, clamping
 * every numeric field into its safe range and coercing `useLocalAi` to a boolean.
 * Fields omitted from the patch keep the base value (so a narrow patch — e.g. just
 * the input form's fuel/tyre numbers — never wipes the persisted `useLocalAi`).
 */
export function mergeStrategyConfig(
  base: StrategyConfig,
  patch?: Partial<StrategyConfig> | null
): StrategyConfig {
  const src = patch && typeof patch === 'object' ? patch : {}
  const merged = { ...base, ...src }
  return {
    pitLossSec: Math.max(0, finite(merged.pitLossSec) ? merged.pitLossSec : base.pitLossSec),
    fuelMarginLaps: Math.max(0, finite(merged.fuelMarginLaps) ? merged.fuelMarginLaps : base.fuelMarginLaps),
    tyreLifeThresholdPct: clamp(finite(merged.tyreLifeThresholdPct) ? merged.tyreLifeThresholdPct : base.tyreLifeThresholdPct, 0.05, 0.9),
    pitWindowSpanLaps: Math.max(1, finite(merged.pitWindowSpanLaps) ? Math.round(merged.pitWindowSpanLaps) : base.pitWindowSpanLaps),
    rivalCarIdx: finite(merged.rivalCarIdx) ? merged.rivalCarIdx : undefined,
    targetLaps: positive(merged.targetLaps) ? merged.targetLaps : undefined,
    raceTimeMinutes: positive(merged.raceTimeMinutes) ? merged.raceTimeMinutes : undefined,
    useLocalAi: typeof merged.useLocalAi === 'boolean' ? merged.useLocalAi : base.useLocalAi
  }
}

// Heuristic: full tyre-life pace fall-off (fresh → dead) in seconds/lap. Used only
// to estimate the fresh-tyre OUT-LAP advantage that powers the undercut, and only
// when live wear data is available. Documented + clamped so it can never produce
// silly numbers.
export const TYRE_PACE_FALLOFF_SEC = 2.0
// Fallback fresh-tyre out-lap gain when no tyre data exists at all.
export const DEFAULT_FRESH_TYRE_GAIN_SEC = 1.0

// ─── Rolling rate inputs (fed by the module from the reused calculators) ──────

export interface StrategyRates {
  /** Litres burned per lap (rolling average). */
  fuelPerLap?: number
  /** Representative lap time, seconds. */
  lapTimeSec?: number
  /** Worst-corner tyre LIFE remaining as a 0..1 fraction (1 = fresh). */
  tyreLifePct?: number
  /** Worst-corner tyre life LOST per lap as a 0..1 fraction. */
  tyreWearPerLapPct?: number
}

// ─── Output shapes ─────────────────────────────────────────────────────────────

export type StrategyAction = 'box-now' | 'box-soon' | 'short-fill' | 'extend' | 'hold' | 'unknown'

export interface FuelProjection {
  fuelLiters?: number
  fuelPerLap?: number
  /** How many laps the CURRENT fuel lasts. */
  lapsOfFuel?: number
  raceLapsRemaining?: number
  /** Litres needed to reach the flag (+ margin). */
  fuelToFinishLiters?: number
  /** Margin in LAPS: lapsOfFuel − raceLapsRemaining. */
  marginLaps?: number
  /** Margin in LITRES: fuelLiters − fuelToFinishLiters. */
  marginLiters?: number
  canFinish: boolean
  /** Litres to add at a stop to JUST finish (+ margin), 0 if already enough. */
  shortFillLiters?: number
  /** Fuel-save needed per lap to stretch the current fuel to the flag (0 if canFinish). */
  savePerLapLiters?: number
}

export interface TyreProjection {
  wearPerLapPct?: number
  /** Current worst-corner life remaining, 0..1. */
  lifePct?: number
  /** Laps until the worst corner reaches the life threshold. */
  lapsToThreshold?: number
  /** Total laps a fresh set lasts to the threshold (at the current wear rate). */
  stintLaps?: number
}

export interface PitWindow {
  /** True when you are within `pitWindowSpanLaps` of the limiting lap (and a stop is required). */
  open: boolean
  /** First lap you could reasonably pit (undercut territory). */
  earliestLap?: number
  /** Hard last lap before you run dry / tyres are gone. */
  latestLap?: number
  /** Best lap to pit (stretch the stint to the limit). */
  optimalLap?: number
  /** Laps from now until the optimal lap. */
  lapsUntilOptimal?: number
  /** What forces the stop. */
  limitedBy: 'fuel' | 'tyres' | 'none' | 'unknown'
  reason: string
}

export interface UndercutAnalysis {
  available: boolean
  rivalCarIdx?: number
  rivalName?: string
  /** Player-centric gap: + rival ahead, − rival behind, seconds. */
  gapSec?: number
  pitLossSec?: number
  /** Estimated fresh-tyre OUT-LAP advantage used for the jump, seconds. */
  freshTyreGainSec?: number
  /**
   * Net gap to the rival AFTER an undercut (you pit now, rival pits next lap):
   * gapSec − freshTyreGainSec. ≤ 0 means you emerge AHEAD.
   */
  netGapAfterUndercutSec?: number
  recommendation: 'undercut' | 'overcut' | 'defend' | 'track-position' | 'none'
  summary: string
}

export interface StrategyPlan {
  available: boolean
  connected: boolean
  currentLap?: number
  fuel: FuelProjection
  tyres: TyreProjection
  pitWindow: PitWindow
  undercut: UndercutAnalysis
  action: StrategyAction
  /** Deterministic one-line recommendation WITH numbers (English; the view localises). */
  headline: string
  notes: string[]
  config: StrategyConfig
  updatedAt?: number
}

// ─── numeric helpers ─────────────────────────────────────────────────────────

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0
}

function nonNegativeFinite(value: unknown): value is number {
  return finite(value) && value >= 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

// ─── race-length (mirrors fuel-strategy's priority so all engines agree) ──────

export function computeRaceLapsRemaining(
  snapshot: TelemetrySnapshot | null,
  config: StrategyConfig,
  lapTimeSec?: number
): number | undefined {
  if (positive(config.targetLaps) && positive(snapshot?.currentLap)) {
    const lapProgress = snapshot?.lapDistPct ?? 0
    return Math.max(0, config.targetLaps - (snapshot?.currentLap as number) + 1 - lapProgress)
  }
  if (nonNegativeFinite(snapshot?.lapsRemaining) && (snapshot?.lapsRemaining as number) < 9999) return snapshot?.lapsRemaining as number
  if (positive(config.raceTimeMinutes) && positive(lapTimeSec)) {
    const configuredSeconds = config.raceTimeMinutes * 60
    const remainingSeconds = nonNegativeFinite(snapshot?.sessionTimeRemainingSec)
      ? Math.min(configuredSeconds, snapshot?.sessionTimeRemainingSec as number)
      : configuredSeconds
    return remainingSeconds / (lapTimeSec as number)
  }
  if (nonNegativeFinite(snapshot?.sessionTimeRemainingSec) && positive(lapTimeSec)) {
    return (snapshot?.sessionTimeRemainingSec as number) / (lapTimeSec as number)
  }
  return undefined
}

// ─── fuel projection ────────────────────────────────────────────────────────

export function computeFuelProjection(
  snapshot: TelemetrySnapshot | null,
  rates: StrategyRates,
  config: StrategyConfig,
  raceLapsRemaining: number | undefined
): FuelProjection {
  const fuelLiters = snapshot?.fuelLiters
  const fuelPerLap = positive(rates.fuelPerLap)
    ? rates.fuelPerLap
    : positive(snapshot?.fuelPerLap)
      ? (snapshot?.fuelPerLap as number)
      : undefined

  const lapsOfFuel = positive(fuelPerLap) && finite(fuelLiters) ? (fuelLiters as number) / (fuelPerLap as number) : undefined
  const marginLiters = positive(fuelPerLap) ? (config.fuelMarginLaps * (fuelPerLap as number)) : 0
  const fuelToFinishLiters =
    positive(fuelPerLap) && nonNegativeFinite(raceLapsRemaining)
      ? raceLapsRemaining * (fuelPerLap as number) + marginLiters
      : undefined

  const marginLapsValue =
    finite(lapsOfFuel) && nonNegativeFinite(raceLapsRemaining)
      ? (lapsOfFuel as number) - raceLapsRemaining - config.fuelMarginLaps
      : undefined
  const marginLitersValue = finite(fuelLiters) && finite(fuelToFinishLiters) ? (fuelLiters as number) - fuelToFinishLiters : undefined
  const canFinish = finite(marginLitersValue) ? marginLitersValue >= 0 : false

  const shortFillLiters = finite(fuelToFinishLiters) && finite(fuelLiters)
    ? Math.max(0, fuelToFinishLiters - (fuelLiters as number))
    : undefined

  // Fuel-save needed/lap to stretch the CURRENT tank (minus margin) to the flag.
  const usable = finite(fuelLiters) ? Math.max(0, (fuelLiters as number) - marginLiters) : undefined
  const saveTargetPerLap = finite(usable) && positive(raceLapsRemaining) ? usable / raceLapsRemaining : undefined
  const savePerLapLiters = positive(fuelPerLap) && finite(saveTargetPerLap)
    ? Math.max(0, (fuelPerLap as number) - saveTargetPerLap)
    : undefined

  return {
    fuelLiters: finite(fuelLiters) ? round(fuelLiters as number, 2) : undefined,
    fuelPerLap: finite(fuelPerLap) ? round(fuelPerLap as number, 3) : undefined,
    lapsOfFuel: finite(lapsOfFuel) ? round(lapsOfFuel as number, 2) : undefined,
    raceLapsRemaining: finite(raceLapsRemaining) ? round(raceLapsRemaining as number, 2) : undefined,
    fuelToFinishLiters: finite(fuelToFinishLiters) ? round(fuelToFinishLiters, 2) : undefined,
    marginLaps: finite(marginLapsValue) ? round(marginLapsValue, 2) : undefined,
    marginLiters: finite(marginLitersValue) ? round(marginLitersValue, 2) : undefined,
    canFinish,
    shortFillLiters: finite(shortFillLiters) ? round(shortFillLiters, 2) : undefined,
    savePerLapLiters: canFinish ? 0 : finite(savePerLapLiters) ? round(savePerLapLiters, 3) : undefined
  }
}

// ─── tyre stint projection ────────────────────────────────────────────────────

export function computeTyreProjection(rates: StrategyRates, config: StrategyConfig): TyreProjection {
  const lifePct = finite(rates.tyreLifePct) ? clamp(rates.tyreLifePct as number, 0, 1) : undefined
  const wearPerLapPct = positive(rates.tyreWearPerLapPct) ? (rates.tyreWearPerLapPct as number) : undefined
  const threshold = config.tyreLifeThresholdPct

  const lapsToThreshold =
    finite(lifePct) && positive(wearPerLapPct) ? Math.max(0, ((lifePct as number) - threshold) / (wearPerLapPct as number)) : undefined
  // A FULL fresh-set stint lasts (1 − threshold) / wearPerLap laps at this rate.
  const stintLaps = positive(wearPerLapPct) ? Math.max(0, (1 - threshold) / (wearPerLapPct as number)) : undefined

  return {
    wearPerLapPct: finite(wearPerLapPct) ? round(wearPerLapPct as number, 4) : undefined,
    lifePct: finite(lifePct) ? round(lifePct as number, 3) : undefined,
    lapsToThreshold: finite(lapsToThreshold) ? round(lapsToThreshold, 1) : undefined,
    stintLaps: finite(stintLaps) ? round(stintLaps, 1) : undefined
  }
}

// ─── pit window ────────────────────────────────────────────────────────────────

export function computePitWindow(
  snapshot: TelemetrySnapshot | null,
  fuel: FuelProjection,
  tyres: TyreProjection,
  config: StrategyConfig
): PitWindow {
  const currentLap = positive(snapshot?.currentLap) ? (snapshot?.currentLap as number) : undefined

  // Laps each constraint allows before a stop is forced.
  const fuelStopLaps = finite(fuel.marginLaps) && fuel.canFinish === false
    ? Math.max(0, (fuel.lapsOfFuel ?? 0) - config.fuelMarginLaps)
    : undefined
  const tyreStopLaps = finite(tyres.lapsToThreshold) ? (tyres.lapsToThreshold as number) : undefined

  // The limiting constraint = whichever forces the earliest stop.
  let limitedBy: PitWindow['limitedBy'] = 'unknown'
  let limitingLaps: number | undefined
  if (finite(fuelStopLaps) && finite(tyreStopLaps)) {
    if ((fuelStopLaps as number) <= (tyreStopLaps as number)) {
      limitedBy = 'fuel'
      limitingLaps = fuelStopLaps as number
    } else {
      limitedBy = 'tyres'
      limitingLaps = tyreStopLaps as number
    }
  } else if (finite(fuelStopLaps)) {
    limitedBy = 'fuel'
    limitingLaps = fuelStopLaps as number
  } else if (finite(tyreStopLaps)) {
    limitedBy = 'tyres'
    limitingLaps = tyreStopLaps as number
  }

  // No stop is forced before the flag → window closed (sprint to the end).
  if (!finite(limitingLaps)) {
    const canFinish = fuel.canFinish === true
    return {
      open: false,
      limitedBy: canFinish ? 'none' : 'unknown',
      reason: canFinish ? 'No stop needed — fuel and tyres cover the finish.' : 'Not enough data to size the pit window yet.'
    }
  }

  const lapsUntilOptimal = Math.max(0, Math.floor(limitingLaps as number))
  const optimalLap = finite(currentLap) ? (currentLap as number) + lapsUntilOptimal : undefined
  const earliestLap = finite(optimalLap) ? Math.max(1, (optimalLap as number) - Math.round(config.pitWindowSpanLaps)) : undefined
  // Hard last lap is governed by FUEL running dry (tyres degrade but don't strand you).
  const hardFuelLaps = finite(fuel.lapsOfFuel) ? Math.floor(fuel.lapsOfFuel as number) : lapsUntilOptimal
  const latestLap = finite(currentLap) ? (currentLap as number) + Math.max(lapsUntilOptimal, hardFuelLaps) : undefined

  const open = lapsUntilOptimal <= Math.round(config.pitWindowSpanLaps)
  const reason = open
    ? `Pit window OPEN — pit by lap ${optimalLap ?? '?'} (${limitedBy}).`
    : `Pit window opens in ${Math.max(0, lapsUntilOptimal - Math.round(config.pitWindowSpanLaps))} laps (${limitedBy}).`

  return { open, earliestLap, latestLap, optimalLap, lapsUntilOptimal, limitedBy, reason }
}

// ─── undercut / overcut vs a chosen rival ─────────────────────────────────────

interface RivalPick {
  carIdx?: number
  name?: string
  gapSec?: number
  ahead: boolean
}

function pickRival(snapshot: TelemetrySnapshot | null, config: StrategyConfig): RivalPick {
  if (!snapshot) return { ahead: true }

  // Explicit rival by carIdx (from drivers list).
  if (finite(config.rivalCarIdx) && Array.isArray(snapshot.drivers)) {
    const rival = snapshot.drivers.find((entry) => entry.carIdx === config.rivalCarIdx)
    if (rival && finite(rival.gapToPlayerSec)) {
      const gap = rival.gapToPlayerSec as number
      return { carIdx: rival.carIdx, name: rival.name, gapSec: Math.abs(gap), ahead: gap >= 0 }
    }
    if (rival) return { carIdx: rival.carIdx, name: rival.name, ahead: true }
  }

  // Default: the car directly AHEAD (relatives.ahead) — the natural undercut target.
  const ahead = snapshot.relatives?.ahead
  if (ahead && finite(ahead.gapSec)) {
    return { carIdx: ahead.carIdx, name: ahead.name, gapSec: Math.abs(ahead.gapSec as number), ahead: true }
  }
  // Otherwise the car behind (defending an undercut).
  const behind = snapshot.relatives?.behind
  if (behind && finite(behind.gapSec)) {
    return { carIdx: behind.carIdx, name: behind.name, gapSec: Math.abs(behind.gapSec as number), ahead: false }
  }
  return { ahead: true }
}

export function estimateFreshTyreGainSec(rates: StrategyRates): number {
  // The more life you've already lost, the bigger the out-lap jump on fresh rubber.
  if (finite(rates.tyreLifePct)) {
    const lost = clamp(1 - (rates.tyreLifePct as number), 0, 1)
    return round(clamp(lost * TYRE_PACE_FALLOFF_SEC, 0.2, TYRE_PACE_FALLOFF_SEC), 2)
  }
  return DEFAULT_FRESH_TYRE_GAIN_SEC
}

export function computeUndercut(
  snapshot: TelemetrySnapshot | null,
  rates: StrategyRates,
  config: StrategyConfig
): UndercutAnalysis {
  const rival = pickRival(snapshot, config)
  const pitLossSec = config.pitLossSec
  const freshTyreGainSec = estimateFreshTyreGainSec(rates)

  if (!finite(rival.gapSec)) {
    return {
      available: false,
      rivalCarIdx: rival.carIdx,
      rivalName: rival.name,
      pitLossSec,
      freshTyreGainSec,
      recommendation: 'none',
      summary: 'No rival gap available for undercut maths.'
    }
  }

  const gap = rival.gapSec as number
  // Player-centric signed gap (+ ahead, − behind) for the output.
  const signedGap = rival.ahead ? gap : -gap

  // Undercut model: you pit NOW, the rival pits one lap later. The stops cancel
  // (both lose pitLossSec); the jump is your fresh-tyre OUT-LAP advantage. You
  // emerge ahead when that jump covers the gap. Pit loss is what you'd concede if
  // the rival does NOT respond (track-position fallback).
  const netGapAfterUndercutSec = round(gap - freshTyreGainSec, 2)

  let recommendation: UndercutAnalysis['recommendation']
  let summary: string

  if (rival.ahead) {
    if (netGapAfterUndercutSec <= 0) {
      recommendation = 'undercut'
      summary = `Undercut ${rival.name ?? 'rival'}: ${gap.toFixed(1)}s gap < ${freshTyreGainSec.toFixed(1)}s fresh-tyre jump — pit now to emerge ahead.`
    } else if (gap <= pitLossSec) {
      recommendation = 'overcut'
      summary = `Gap ${gap.toFixed(1)}s too big to undercut (jump ${freshTyreGainSec.toFixed(1)}s); extend and overcut ${rival.name ?? 'rival'}.`
    } else {
      recommendation = 'track-position'
      summary = `Hold track position — ${rival.name ?? 'rival'} is ${gap.toFixed(1)}s up, out of undercut range.`
    }
  } else {
    // Rival BEHIND: they could undercut YOU. Cover if they're within a jump.
    if (gap <= freshTyreGainSec) {
      recommendation = 'defend'
      summary = `Defend the undercut — ${rival.name ?? 'rival'} only ${gap.toFixed(1)}s behind (jump ${freshTyreGainSec.toFixed(1)}s); cover their stop.`
    } else {
      recommendation = 'track-position'
      summary = `${rival.name ?? 'Rival'} ${gap.toFixed(1)}s behind — safe from an immediate undercut.`
    }
  }

  return {
    available: true,
    rivalCarIdx: rival.carIdx,
    rivalName: rival.name,
    gapSec: round(signedGap, 2),
    pitLossSec,
    freshTyreGainSec,
    netGapAfterUndercutSec,
    recommendation,
    summary
  }
}

// ─── recommendation + headline ─────────────────────────────────────────────────

function damageFlagged(snapshot: TelemetrySnapshot | null): boolean {
  return snapshot?.pit?.repairNeeded === true || snapshot?.flags?.meatball === true
}

interface ActionDecision {
  action: StrategyAction
  headline: string
}

export function decideAction(
  snapshot: TelemetrySnapshot | null,
  fuel: FuelProjection,
  tyres: TyreProjection,
  pitWindow: PitWindow,
  undercut: UndercutAnalysis
): ActionDecision {
  if (snapshot?.onPitRoad === true) {
    return { action: 'hold', headline: 'On pit road — execute the stop.' }
  }
  if (damageFlagged(snapshot)) {
    return { action: 'box-now', headline: 'Box now — damage flagged, pit for repairs.' }
  }

  const fuelCritical = finite(fuel.lapsOfFuel) && (fuel.lapsOfFuel as number) < 1
  const tyresGone = finite(tyres.lapsToThreshold) && (tyres.lapsToThreshold as number) <= 0
  if (fuelCritical) {
    return { action: 'box-now', headline: `Box now — fuel critical, ${round(fuel.lapsOfFuel as number, 1)} lap(s) left in the tank.` }
  }
  if (tyresGone) {
    return { action: 'box-now', headline: 'Box now — tyres past their wear limit.' }
  }

  const stopRequired = fuel.canFinish === false || finite(tyres.lapsToThreshold)
  const lapsToOptimal = finite(pitWindow.lapsUntilOptimal) ? (pitWindow.lapsUntilOptimal as number) : undefined

  // Short-fill: a stop is required but the race is short enough that a SPLASH (not a
  // full tank) reaches the flag.
  if (
    fuel.canFinish === false &&
    finite(fuel.shortFillLiters) &&
    positive(fuel.fuelToFinishLiters) &&
    finite(snapshot?.fuelCapacityLiters) &&
    (fuel.fuelToFinishLiters as number) < (snapshot?.fuelCapacityLiters as number)
  ) {
    return {
      action: 'short-fill',
      headline: `Short-fill ${round(fuel.shortFillLiters as number, 1)}L to reach the flag${
        undercut.recommendation === 'undercut' ? ' — undercut is on.' : '.'
      }`
    }
  }

  if (pitWindow.open && stopRequired) {
    if (finite(lapsToOptimal) && (lapsToOptimal as number) <= 1) {
      return { action: 'box-now', headline: `Box this lap — ${pitWindow.limitedBy} window is at its limit.` }
    }
    if (undercut.recommendation === 'undercut') {
      return { action: 'box-soon', headline: undercut.summary }
    }
    if (undercut.recommendation === 'defend') {
      return { action: 'box-soon', headline: undercut.summary }
    }
    return {
      action: 'box-soon',
      headline: `Pit window open — plan the stop by lap ${pitWindow.optimalLap ?? '?'} (${pitWindow.limitedBy}).`
    }
  }

  if (fuel.canFinish === true && !finite(tyres.lapsToThreshold)) {
    const margin = finite(fuel.marginLaps) ? `${round(fuel.marginLaps as number, 1)} lap margin` : 'fuel covers it'
    return { action: 'extend', headline: `Stay out — ${margin} to the flag.` }
  }

  if (finite(lapsToOptimal)) {
    return {
      action: 'extend',
      headline: `Extend — ${lapsToOptimal} more lap(s) before the ${pitWindow.limitedBy} stop.`
    }
  }

  return { action: 'hold', headline: 'Holding station — gathering strategy data.' }
}

// ─── public entry point ─────────────────────────────────────────────────────

export function computeStrategyPlan(
  snapshot: TelemetrySnapshot | null,
  rates: StrategyRates,
  partialConfig?: Partial<StrategyConfig>
): StrategyPlan {
  const config: StrategyConfig = mergeStrategyConfig(DEFAULT_STRATEGY_CONFIG, partialConfig)

  const connected = snapshot?.connected ?? false
  const lapTimeSec = positive(rates.lapTimeSec)
    ? rates.lapTimeSec
    : positive(snapshot?.estimatedLapTimeSec)
      ? (snapshot?.estimatedLapTimeSec as number)
      : positive(snapshot?.bestLapTimeSec)
        ? (snapshot?.bestLapTimeSec as number)
        : positive(snapshot?.lastLapTimeSec)
          ? (snapshot?.lastLapTimeSec as number)
          : undefined

  const raceLapsRemaining = computeRaceLapsRemaining(snapshot, config, lapTimeSec)
  const fuel = computeFuelProjection(snapshot, rates, config, raceLapsRemaining)
  const tyres = computeTyreProjection(rates, config)
  const pitWindow = computePitWindow(snapshot, fuel, tyres, config)
  const undercut = computeUndercut(snapshot, rates, config)
  const { action, headline } = decideAction(snapshot, fuel, tyres, pitWindow, undercut)

  const available = connected && (finite(fuel.lapsOfFuel) || finite(tyres.lapsToThreshold) || nonNegativeFinite(raceLapsRemaining))

  const notes: string[] = []
  if (!connected) notes.push('No telemetry — connect to a sim or use the mock provider.')
  else if (!available) notes.push('Waiting for completed laps to project fuel and tyre rates.')
  if (connected && !positive(fuel.fuelPerLap)) notes.push('Fuel-per-lap not learned yet.')
  if (connected && !positive(tyres.wearPerLapPct)) notes.push('Tyre wear rate not learned yet.')

  return {
    available,
    connected,
    currentLap: snapshot?.currentLap,
    fuel,
    tyres,
    pitWindow,
    undercut,
    action,
    headline,
    notes,
    config,
    updatedAt: snapshot?.timestamp
  }
}

// ─── deterministic narration (race-radio text; LLM is OPTIONAL on top) ────────

export interface StrategyNarrateRequest {
  lang?: 'pt' | 'en'
  /** Caller asks for LLM phrasing; module still falls back to deterministic text. */
  useLlm?: boolean
  settings?: Partial<StrategyConfig>
}

export interface StrategyNarration {
  text: string
  source: 'deterministic' | 'llm'
  plan: StrategyPlan
}

function fmt1(value: number | undefined): string {
  return finite(value) ? (value as number).toFixed(1) : '—'
}

// Pure radio-style phrasing of a plan. ALWAYS works — this is the fallback that
// makes the LLM optional. PT-BR by default (driver radio), EN on request.
export function narrateStrategyPlan(plan: StrategyPlan, lang: 'pt' | 'en' = 'pt'): string {
  if (!plan.connected) {
    return lang === 'pt' ? 'Sem telemetria no momento.' : 'No telemetry right now.'
  }
  const pt = lang === 'pt'
  const parts: string[] = []

  switch (plan.action) {
    case 'box-now':
      parts.push(pt ? 'Box, box! Entrar nos boxes agora.' : 'Box, box! Pit this lap.')
      break
    case 'box-soon':
      parts.push(
        pt
          ? `Prepara o pit — janela aberta${plan.pitWindow.optimalLap ? `, até a volta ${plan.pitWindow.optimalLap}` : ''}.`
          : `Get ready to pit — window open${plan.pitWindow.optimalLap ? `, by lap ${plan.pitWindow.optimalLap}` : ''}.`
      )
      break
    case 'short-fill':
      parts.push(
        pt
          ? `Splash de ${fmt1(plan.fuel.shortFillLiters)} litros e segue até a bandeira.`
          : `Short-fill ${fmt1(plan.fuel.shortFillLiters)} litres and run to the flag.`
      )
      break
    case 'extend':
      parts.push(pt ? 'Segue na pista, ainda não é hora do pit.' : 'Stay out, not time to pit yet.')
      break
    default:
      parts.push(pt ? 'Mantém o ritmo.' : 'Hold your pace.')
  }

  if (finite(plan.fuel.marginLaps)) {
    parts.push(
      pt
        ? `Combustível: ${fmt1(plan.fuel.marginLaps)} voltas de margem.`
        : `Fuel: ${fmt1(plan.fuel.marginLaps)} laps of margin.`
    )
  }
  if (finite(plan.tyres.lapsToThreshold)) {
    parts.push(
      pt
        ? `Pneus: ${fmt1(plan.tyres.lapsToThreshold)} voltas até o limite.`
        : `Tyres: ${fmt1(plan.tyres.lapsToThreshold)} laps to the limit.`
    )
  }
  if (plan.undercut.available && plan.undercut.recommendation === 'undercut') {
    parts.push(
      pt
        ? `Dá o undercut no ${plan.undercut.rivalName ?? 'rival'}.`
        : `Undercut ${plan.undercut.rivalName ?? 'the rival'} is on.`
    )
  } else if (plan.undercut.available && plan.undercut.recommendation === 'defend') {
    parts.push(
      pt
        ? `Cuidado: ${plan.undercut.rivalName ?? 'rival'} pode te dar undercut.`
        : `Watch out: ${plan.undercut.rivalName ?? 'rival'} may undercut you.`
    )
  }

  return parts.join(' ')
}
