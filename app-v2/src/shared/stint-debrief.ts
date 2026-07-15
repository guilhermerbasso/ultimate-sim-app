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
// a SHORT pt-BR debrief: an executive `text` paragraph + concise `bullets`.
//
// The local Qwen LLM (main/modules/stint-debrief.ts) only PHRASES this on demand
// and ALWAYS falls back to the deterministic `text` here — the model is never
// loaded or run from the telemetry loop.

import { coachComposeAction, type CoachFinding } from './coach'
import type { PredictionsSnapshot } from './predictions'
import { formatMeasurement, type UnitSystem } from './units'

// ─── IPC channels (all under the `debrief:` preload allowlist prefix) ─────────

export const DEBRIEF_CHANNELS = {
  /** invoke(DebriefGenerateRequest) → StintDebrief. */
  generate: 'debrief:generate',
  /** invoke() → StintDebrief | null (the last one composed). */
  last: 'debrief:last',
  /** Broadcast: a freshly composed debrief (after a generate). */
  updated: 'debrief:updated',
  /** Broadcast: stint/session ended — the renderer should auto-generate. */
  trigger: 'debrief:trigger'
} as const

export type DebriefChannel = (typeof DEBRIEF_CHANNELS)[keyof typeof DEBRIEF_CHANNELS]

// ─── Contract types ──────────────────────────────────────────────────────────

/** Why a debrief was produced. */
export type DebriefReason = 'stint-end' | 'session-end' | 'manual'
export type DebriefLanguage = 'pt-BR' | 'en-US'

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
  /** Executive pt-BR paragraph (deterministic). */
  text: string
  /** Concise pt-BR bullets (losses, gains, strategy). */
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

/** The composed debrief, broadcast on `debrief:updated` and returned by IPC. */
export interface StintDebrief extends DebriefComposition {
  generatedAt: number
  /** Whether the `text` was phrased by the LLM or is the deterministic fallback. */
  source: 'deterministic' | 'llm'
  language: DebriefLanguage
  reason: DebriefReason
  sessionInfo?: DebriefSessionInfo
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

/** "0,12" with a comma decimal (pt-BR), N decimals. */
function num(value: number, decimals = 2): string {
  return value.toFixed(decimals).replace('.', ',')
}

/** Seconds → "1:23,456" (lap time) or "—". */
export function formatLapTime(seconds: number | undefined): string {
  if (!finite(seconds) || seconds <= 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  const sStr = num(s, 3).padStart(6, '0')
  return `${m}:${sStr}`
}

/** Where a finding happened — prefer the WS-E corner, fall back to the sector. */
export function findingLocation(finding: CoachFinding, language: DebriefLanguage = 'pt-BR'): string {
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

function headlineFor(finding: CoachFinding, language: DebriefLanguage): string {
  return coachComposeAction(finding.kind, language)
}

function bulletForLoss(finding: CoachFinding, language: DebriefLanguage): string {
  const loc = findingLocation(finding, language)
  const mag = lossMagnitudeSec(finding)
  const suffix = mag > 0 ? ` (−${num(mag)} s)` : ''
  return `${loc}: ${headlineFor(finding, language)}${suffix}`
}

function bulletForGain(finding: CoachFinding, language: DebriefLanguage): string {
  const loc = findingLocation(finding, language)
  const mag = gainMagnitudeSec(finding)
  const suffix = mag > 0 ? ` (+${num(mag)} s)` : ''
  return `${loc}: ${headlineFor(finding, language)}${suffix}`
}

const PRESSURE_LABEL_PT: Record<string, string> = { low: 'baixa', ok: 'ideal', high: 'alta' }
const PRESSURE_LABEL_EN: Record<string, string> = { low: 'low', ok: 'ok', high: 'high' }
const TEMP_LABEL_PT: Record<string, string> = { cold: 'fria', optimal: 'ideal', hot: 'quente' }
const TEMP_LABEL_EN: Record<string, string> = { cold: 'cold', optimal: 'ideal', hot: 'hot' }

/** One short pt-BR strategy line from the predictions, or null when no signal. */
export function strategyNote(
  predictions: PredictionsSnapshot | null | undefined,
  unitSystem: UnitSystem = 'metric',
  language: DebriefLanguage = 'pt-BR'
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
      parts.push(pt ? `combustível: margem de ${num(m, 1)} voltas até o fim${volume}` : `fuel: margin of ${num(m, 1)} laps to the end${volume}`)
    } else {
      const volume = finite(fuel.finishMarginL)
        ? `, ${pt ? 'faltam' : 'short'} ~${formatMeasurement(Math.abs(fuel.finishMarginL), 'fuel-volume-l', unitSystem, { decimals: 1, includeUnit: true }).display}`
        : ''
      parts.push(
        pt
          ? `combustível: déficit de ${num(Math.abs(m), 1)} voltas${volume} — precisa economizar ou parar`
          : `fuel: deficit of ${num(Math.abs(m), 1)} laps${volume} - needs saving/stopping`
      )
    }
  }

  const tire = predictions.tire
  if (tire) {
    const tParts: string[] = []
    if (finite(tire.degSecPerLap) && tire.degSecPerLap > 0) tParts.push(pt ? `perda ~${num(tire.degSecPerLap)} s por volta` : `loss ~${num(tire.degSecPerLap)} s/lap`)
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
    parts.push(`${pt ? 'ritmo projetado' : 'projected pace'} ${formatLapTime(pace.projectedLapSec)}`)
  }

  if (parts.length === 0) return null
  return parts.join('; ')
}

// ─── the pure composer ───────────────────────────────────────────────────────

/** Max losses / gains we surface so the debrief stays a SHORT radio-style note. */
const MAX_LOSSES = 3
const MAX_GAINS = 2

function sessionHeader(info: DebriefSessionInfo | undefined, language: DebriefLanguage): string | null {
  if (!info) return null
  const pt = language === 'pt-BR'
  const bits: string[] = []
  if (info.trackName) bits.push(info.trackName)
  if (info.carName) bits.push(info.carName)
  if (info.sessionType) bits.push(info.sessionType)
  const meta: string[] = []
  if (finite(info.lapsCompleted) && info.lapsCompleted > 0) meta.push(`${Math.round(info.lapsCompleted)} ${pt ? 'voltas' : 'laps'}`)
  if (finite(info.bestLapTimeSec) && info.bestLapTimeSec > 0) meta.push(`${pt ? 'melhor' : 'best'} ${formatLapTime(info.bestLapTimeSec)}`)
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
  language: DebriefLanguage = 'pt-BR'
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
