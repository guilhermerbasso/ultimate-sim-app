// Renderer-side PREDICTIONS helper (WS-H consumer of the WS-G contract).
//
// Two responsibilities, both PURE of any color/React-layout opinion so the same
// logic powers BOTH the overlay widgets (overlay/widgets/PredictionWidgets.tsx)
// and the dashboard widgets (dashboard/widgets/new-widgets-predictions.tsx):
//
//   1. A tiny external store + `usePredictionsSnapshot()` hook that subscribes to
//      the `predictions:snapshot` broadcast and seeds from `predictions:get`
//      (mirrors lib/telemetry.ts). SSR-safe: the initial value is read
//      synchronously from the module store so server/test renders have data when
//      `applyPredictionsSnapshot()` was called first; the live wiring happens in
//      an effect (skipped during static markup).
//
//   2. Pure "view" builders that turn a `PredictionsSnapshot` into glanceable
//      strings + a SEMANTIC tone (`good | caution | alert | neutral`) + a 0..1
//      magnitude. Each consumer maps the tone to its OWN color token so the
//      warm/cool rule (warm = bad / under threat, cool-green = good / closing-in)
//      stays consistent without this module importing either color system.

import { useEffect, useState } from 'react'
import {
  PREDICTIONS_CHANNELS,
  type CatchEstimate,
  type PredictionsSnapshot
} from '../../../shared/predictions'

export type { PredictionsSnapshot } from '../../../shared/predictions'
export { PREDICTIONS_CHANNELS } from '../../../shared/predictions'

// ─── External store + hook ───────────────────────────────────────────────────

let storeSnapshot: PredictionsSnapshot | null = null
let wired = false
const listeners = new Set<() => void>()

/** Read the latest predictions snapshot held by the module store. */
export function getPredictionsStoreSnapshot(): PredictionsSnapshot | null {
  return storeSnapshot
}

/**
 * Push a snapshot into the store + notify subscribers. Called by the live IPC
 * wiring and directly by tests/harnesses to seed a deterministic value.
 */
export function applyPredictionsSnapshot(snapshot: PredictionsSnapshot | null): void {
  storeSnapshot = snapshot
  for (const listener of listeners) listener()
}

function ensureWired(): void {
  if (wired) return
  if (typeof window === 'undefined' || !window.ipc) return
  wired = true
  window.ipc.subscribe<PredictionsSnapshot | null>(PREDICTIONS_CHANNELS.snapshot, applyPredictionsSnapshot)
  void window.ipc
    .invoke<PredictionsSnapshot | null>(PREDICTIONS_CHANNELS.get)
    .then(applyPredictionsSnapshot)
    .catch(() => undefined)
}

/**
 * Subscribe to the live predictions snapshot. SSR/test-safe: the initial render
 * reads the store synchronously (seedable via `applyPredictionsSnapshot`) and the
 * IPC wiring only attaches inside the effect.
 */
export function usePredictionsSnapshot(): PredictionsSnapshot | null {
  const [snapshot, setSnapshot] = useState<PredictionsSnapshot | null>(getPredictionsStoreSnapshot())
  useEffect(() => {
    ensureWired()
    const listener = (): void => setSnapshot(getPredictionsStoreSnapshot())
    listeners.add(listener)
    listener()
    return () => {
      listeners.delete(listener)
    }
  }, [])
  return snapshot
}

// ─── Pure formatting helpers ─────────────────────────────────────────────────

const DASH = '—'

function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(1, Math.max(0, v))
}

/** A short seconds readout: 8.4 / 12.7 / 99+ (never a raw NaN). */
export function fmtSeconds(sec: number | null | undefined): string {
  if (!isNum(sec)) return DASH
  const v = Math.abs(sec)
  if (v >= 100) return '99+'
  if (v >= 10) return v.toFixed(1)
  return v.toFixed(1)
}

/** Laps readout: 3.2 laps style (one decimal, clamped). */
export function fmtLaps(laps: number | null | undefined): string {
  if (!isNum(laps)) return DASH
  const v = Math.abs(laps)
  if (v >= 100) return '99+'
  return v.toFixed(1)
}

/** A signed laps readout (+2.1 / −0.7) for fuel/finish margins. */
export function fmtSignedLaps(laps: number | null | undefined): string {
  if (!isNum(laps)) return DASH
  const sign = laps >= 0 ? '+' : '−'
  return `${sign}${Math.abs(laps).toFixed(1)}`
}

/** A signed litres readout (+1.8 / −3.4). */
export function fmtSignedL(litres: number | null | undefined): string {
  if (!isNum(litres)) return DASH
  const sign = litres >= 0 ? '+' : '−'
  return `${sign}${Math.abs(litres).toFixed(1)}`
}

/** Lap time as m:ss.mmm (e.g. 1:32.481) or s.mmm for sub-minute. */
export function fmtLapTime(sec: number | null | undefined): string {
  if (!isNum(sec) || sec <= 0) return DASH
  const minutes = Math.floor(sec / 60)
  const seconds = sec - minutes * 60
  if (minutes <= 0) return seconds.toFixed(3)
  return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`
}

export function fmtPct(frac: number | null | undefined): string {
  if (!isNum(frac)) return DASH
  return `${Math.round(clamp01(frac) * 100)}%`
}

export function fmtPerLap(sec: number | null | undefined): string {
  if (!isNum(sec)) return DASH
  return sec.toFixed(2)
}

// ─── Semantic tone (consumers map tone → their own warm/cool color token) ────

export type PredTone = 'good' | 'caution' | 'alert' | 'neutral'

/** Shared shape every view builder returns — glanceable + tone + 0..1 fill. */
export interface PredView {
  /** True when there is meaningful data to show (else render a calm placeholder). */
  has: boolean
  /** Big headline number (already formatted). */
  value: string
  /** Headline unit (s, lap, s/lap…). */
  unit?: string
  /** One-line context under the headline. */
  sub: string
  /** Magnitude 0..1 for bars/segments/arcs. */
  fill: number
  /** Semantic tone — consumers pick the actual color. */
  tone: PredTone
  /** True when `fill` itself represents a GOOD magnitude (keeps heatmaps cool). */
  good: boolean
}

const PT_LABELS: Record<'low' | 'ok' | 'high', string> = { low: 'baixa', ok: 'ok', high: 'alta' }
const TT_LABELS: Record<'cold' | 'optimal' | 'hot', string> = { cold: 'fria', optimal: 'ideal', hot: 'quente' }

/** "Tempo p/ alcançar" — time/laps to REACH the car ahead. Good = closing in. */
export function catchAheadView(catch_?: CatchEstimate): PredView {
  if (!catch_ || !isNum(catch_.etaSec) || catch_.lowConfidence) {
    return { has: false, value: DASH, unit: 's', sub: 'sem alvo à frente', fill: 0, tone: 'neutral', good: false }
  }
  // Closer to catching (fewer laps) → fuller bar; this is the desirable state.
  const fill = isNum(catch_.etaLaps) ? clamp01(1 - catch_.etaLaps / 10) : 0.5
  const closing = isNum(catch_.closingSecPerLap) ? `${catch_.closingSecPerLap.toFixed(2)}s/v` : DASH
  return {
    has: true,
    value: fmtSeconds(catch_.etaSec),
    unit: 's',
    sub: `${fmtLaps(catch_.etaLaps)} voltas · fecha ${closing}`,
    fill,
    tone: 'good',
    good: true
  }
}

/** "Tempo p/ ser alcançado" — time for the car BEHIND to reach you. A threat. */
export function caughtBehindView(catch_?: CatchEstimate): PredView {
  if (!catch_ || !isNum(catch_.etaSec) || catch_.lowConfidence) {
    return { has: false, value: DASH, unit: 's', sub: 'sem ameaça atrás', fill: 0, tone: 'neutral', good: false }
  }
  const laps = isNum(catch_.etaLaps) ? catch_.etaLaps : 99
  // Sooner they reach you → fuller (and hotter) bar.
  const fill = clamp01(1 - laps / 10)
  // < ~2 laps to be caught is an alert; otherwise a caution.
  const tone: PredTone = laps <= 2 ? 'alert' : 'caution'
  const closing = isNum(catch_.closingSecPerLap) ? `${catch_.closingSecPerLap.toFixed(2)}s/v` : DASH
  return {
    has: true,
    value: fmtSeconds(catch_.etaSec),
    unit: 's',
    sub: `${fmtLaps(catch_.etaLaps)} voltas · fecha ${closing}`,
    fill,
    tone,
    good: false
  }
}

/** "Combustível até o fim" — finish margin in laps/L. Red when negative. */
export function fuelView(snapshot: PredictionsSnapshot | null): PredView {
  const fuel = snapshot?.fuel
  if (!fuel) {
    return { has: false, value: DASH, unit: 'v', sub: 'sem dados de consumo', fill: 0, tone: 'neutral', good: false }
  }
  const left = isNum(fuel.lapsLeftAtPace) ? `${fuel.lapsLeftAtPace.toFixed(1)}v no tanque` : ''
  // Unknown race distance ⇒ margin is undefined. Show the tank laps (when known)
  // in a NEUTRAL tone — never caution/alert — so "distância desconhecida" can't
  // masquerade as a 0-lap fuel-critical margin.
  if (!isNum(fuel.finishMarginLaps)) {
    return {
      has: isNum(fuel.lapsLeftAtPace),
      value: DASH,
      unit: 'v',
      sub: left || 'sem dados de consumo',
      fill: 0,
      tone: 'neutral',
      good: false
    }
  }
  const margin = fuel.finishMarginLaps
  const tone: PredTone = margin < 0 ? 'alert' : margin < 1 ? 'caution' : 'good'
  // Map a −3..+3 lap margin onto a 0..1 fill (centre ≈ break-even).
  const fill = clamp01((margin + 3) / 6)
  const litres = fmtSignedL(fuel.finishMarginL)
  return {
    has: true,
    value: fmtSignedLaps(margin),
    unit: 'v',
    sub: `${litres} L${left ? ` · ${left}` : ''}`,
    fill,
    tone,
    good: margin >= 1
  }
}

/** "Pneu: desgaste/penhasco" — deg s/lap + laps-to-cliff + pressure/temp state. */
export function tireView(snapshot: PredictionsSnapshot | null): PredView {
  const tire = snapshot?.tire
  if (!tire || !isNum(tire.degSecPerLap)) {
    return { has: false, value: DASH, unit: 's/v', sub: 'sem dados de pneu', fill: 0, tone: 'neutral', good: false }
  }
  const cliff = tire.lapsToCliff
  const pressOff = tire.pressureState !== 'ok'
  const tempOff = tire.tempState !== 'optimal'
  let tone: PredTone = 'good'
  if ((isNum(cliff) && cliff <= 2) || tire.degSecPerLap >= 0.4) tone = 'alert'
  else if ((isNum(cliff) && cliff <= 5) || tire.degSecPerLap >= 0.2 || pressOff || tempOff) tone = 'caution'
  // More degradation → fuller (hotter) bar; cap at ~0.6 s/lap.
  const fill = clamp01(tire.degSecPerLap / 0.6)
  const cliffTxt = isNum(cliff) ? `penhasco ~${Math.max(0, Math.round(cliff))}v` : 'penhasco —'
  const stateTxt = `P:${PT_LABELS[tire.pressureState]} T:${TT_LABELS[tire.tempState]}`
  return {
    has: true,
    value: fmtPerLap(tire.degSecPerLap),
    unit: 's/v',
    sub: `${cliffTxt} · ${stateTxt}`,
    fill,
    tone,
    good: false
  }
}

/** "Pace projetado" — projected clean lap + confidence. Cool only when trusted. */
export function paceView(snapshot: PredictionsSnapshot | null): PredView {
  const pace = snapshot?.pace
  if (!pace || !isNum(pace.projectedLapSec)) {
    return { has: false, value: DASH, sub: 'sem pace projetado', fill: 0, tone: 'neutral', good: false }
  }
  const conf = isNum(pace.confidence) ? clamp01(pace.confidence) : 0
  // Confidence drives the bar; only a high-confidence projection keys cool/green.
  const tone: PredTone = conf >= 0.66 ? 'good' : 'neutral'
  return {
    has: true,
    value: fmtLapTime(pace.projectedLapSec),
    sub: `confiança ${fmtPct(conf)}`,
    fill: conf,
    tone,
    good: conf >= 0.66
  }
}
