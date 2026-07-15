// Proactive AI Race Engineer — PER-SECTOR voice coaching (main process ONLY).
//
// The engineer speaks on its OWN after each sector, calling out the driver's
// biggest mistake in that sector. This module is the deterministic brain behind
// `engineer:proactive`:
//
//   • It watches the telemetry stream for SECTOR-BOUNDARY crossings (computed from
//     `lapDistPct` against EQUAL-width sector boundaries — the same fixed-sector
//     model the Coach module uses; default 3 sectors, and a single sector degrades
//     to a per-LAP call).
//   • It runs the SAME deterministic F2 coach analysis the Coach module uses
//     (`coachSampleFromSnapshot` + `buildCoachReport`) on a rolling lap buffer, so
//     the findings it cites are the REAL coach findings — not invented advice.
//   • On each completed sector it picks the WORST finding for that sector (max
//     estimated time loss / severity) and composes a BRUTAL one-liner with a pure
//     deterministic template. The local LLM is NEVER touched in the telemetry loop;
//     proactive coaching works fully offline.
//
// ARCHITECTURE PRINCIPLE: the LLM is optional. If there is no telemetry or no
// coach finding for the sector, the engineer stays SILENT (it never invents data).
// Qualifying has one deliberate exception: a one-shot, evidence-based start summary.
//
// Out-laps and in-laps are deliberately NOT coached: warm-up behaviour (lift-and-
// coast, early braking to build temperature) is not a mistake. The latest findings
// are published to a process-local singleton — STAMPED with the car + track they
// were measured on — so the on-demand engineer (`ai-engineer.ts`) can cite the very
// same coaching via its `getCoachFindings` getter / tool, and never cites a
// previous session's coaching after a car/track change or a disconnect.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { ModuleContext } from '../module-context'
import {
  type CoachCornerMetrics,
  type CoachCornerRef,
  type CoachDimension,
  type CoachFinding,
  type CoachFindingKind,
  type CoachLapSample,
  type CoachReferenceLap,
  buildCoachReport,
  coachDimensionForKind,
  coachSampleFromSnapshot,
  cornerOf,
  severityForLoss
} from '../../shared/coach'
import {
  buildQualiStartSummary,
  coachComparableIdentityFromSnapshot,
  coachLapHistoryEntry,
  type CoachComparableIdentity,
  type CoachGapSample,
  type CoachLapHistoryEntry,
  type CoachTrackCondition,
  type RacecraftAdviceContext
} from '../../shared/coach-racecraft'
import {
  ENGINEER_CHANNELS,
  type EngineerAssertiveness,
  type EngineerLanguage,
  type EngineerProactiveEvent
} from '../../shared/engineer-ipc'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import { deriveSessionKind } from '../ai/context-pack'
import { getEngineerConfigSnapshot } from './ai-engineer'
import { buildCornerMap, trackLayoutKey, type CornerMapData, type CornerSample } from '../track-map/corner-map'
import { createDefaultIntentRegistry } from '../../shared/driver-intent-catalog'
import { findingEventKeys, sensitivityToMinConfidence } from '../../shared/coach-intent-gate'
import { recordLapEvents } from '../../shared/coach-baseline'
import { CoachBaselineStore, getCoachBaselineStore } from './coach-baselines'
import { logger } from './logger'
import { settingsEvents } from '../settings/events'
import type { UnitSystem } from '../../shared/units'
import { isLiveTelemetrySnapshot, LiveTelemetryGate } from '../../shared/replay'

const LOG_AREA = 'ai'

// One shared, immutable driver-intent registry (racecraft + management + conditions)
// so deliberate choices are demoted to context / silenced instead of flagged.
const intentRegistry = createDefaultIntentRegistry()

// ─── Shared findings singleton (read by the on-demand engineer) ────────────────
//
// Findings are STAMPED with the car + track they were measured on. The getter drops
// them when the live snapshot is a different car/track, so the on-demand engineer
// never cites a previous session's coaching with confident numbers ("never invent").

/** A car/track identity used to scope findings to the session they were measured on. */
export interface FindingsContext {
  carName?: string
  carPath?: string
  trackName?: string
  trackConfigName?: string
  condition?: CoachTrackCondition
}

interface PublishedCoachFindings extends FindingsContext {
  findings: CoachFinding[]
}

let latestCoachFindings: PublishedCoachFindings = { findings: [] }

function samePublishedIdentity(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = (left ?? '').trim().toLowerCase()
  const normalizedRight = (right ?? '').trim().toLowerCase()
  return normalizedLeft.length > 0 && normalizedLeft === normalizedRight
}

function publishedConditionMatches(
  condition: CoachTrackCondition | undefined,
  snapshot: TelemetrySnapshot
): boolean {
  if (condition === undefined) return true
  const direct = coachComparableIdentityFromSnapshot(snapshot).condition
  if (condition === direct) return true
  return (
    condition === 'drying' &&
    snapshot.isRaining !== true &&
    Number.isFinite(snapshot.trackWetnessPct) &&
    (snapshot.trackWetnessPct as number) > 0.03
  )
}

/**
 * Latest deterministic coach findings (worst-first), scoped to the CURRENT session.
 * When `currentSnapshot` is supplied and its car/track differs from the stamped
 * session, returns `[]` (the findings belong to a previous car/track and must not
 * be cited). Empty until a lap completes; cleared on disconnect.
 */
export function getLatestCoachFindings(currentSnapshot?: TelemetrySnapshot | null): CoachFinding[] {
  const { findings, carName, carPath, trackName, trackConfigName, condition } = latestCoachFindings
  if (findings.length === 0) return []
  if (currentSnapshot && !isLiveTelemetrySnapshot(currentSnapshot)) return []
  if (currentSnapshot && currentSnapshot.connected !== false) {
    const liveCar = currentSnapshot.carName
    const liveCarPath = currentSnapshot.carPath
    const liveTrack = currentSnapshot.trackName
    const liveTrackConfig = currentSnapshot.trackConfigName
    if (carPath !== undefined || liveCarPath !== undefined) {
      if (!samePublishedIdentity(carPath, liveCarPath)) return []
    } else if (!samePublishedIdentity(carName, liveCar)) {
      return []
    }
    if (!samePublishedIdentity(trackName, liveTrack)) return []
    if (
      (trackConfigName !== undefined || liveTrackConfig !== undefined) &&
      !samePublishedIdentity(trackConfigName, liveTrackConfig)
    ) return []
    if (!publishedConditionMatches(condition, currentSnapshot)) return []
  }
  return findings
}

function publishCoachFindings(findings: CoachFinding[], context?: FindingsContext): void {
  latestCoachFindings = {
    findings: Array.isArray(findings) ? findings : [],
    carName: context?.carName,
    carPath: context?.carPath,
    trackName: context?.trackName,
    trackConfigName: context?.trackConfigName,
    condition: context?.condition
  }
}

interface PublishedRacecraftContext extends RacecraftAdviceContext {
  findings: CoachFinding[]
  cornerMetrics: CoachCornerMetrics[]
  gaps: CoachGapSample[]
}

let latestRacecraftContext: PublishedRacecraftContext | null = null

function publishCoachRacecraftContext(context: RacecraftAdviceContext | null): void {
  latestRacecraftContext = context
    ? {
        ...context,
        findings: [...(context.findings ?? [])],
        cornerMetrics: [...(context.cornerMetrics ?? [])],
        gaps: [...(context.gaps ?? [])],
        reference: context.reference
          ? { corners: context.reference.corners.map((corner) => ({ ...corner })) }
          : null
      }
    : null
}

export function getLatestCoachRacecraftContext(
  currentSnapshot?: TelemetrySnapshot | null
): RacecraftAdviceContext | null {
  const context = latestRacecraftContext
  if (!context) return null
  if (currentSnapshot && !isLiveTelemetrySnapshot(currentSnapshot)) return null
  if (currentSnapshot && currentSnapshot.connected !== false) {
    if (context.carPath !== undefined || currentSnapshot.carPath !== undefined) {
      if (!samePublishedIdentity(context.carPath, currentSnapshot.carPath)) return null
    } else if (!samePublishedIdentity(context.carName, currentSnapshot.carName)) {
      return null
    }
    if (!samePublishedIdentity(context.trackName, currentSnapshot.trackName)) return null
    if (
      (context.trackConfigName !== undefined || currentSnapshot.trackConfigName !== undefined) &&
      !samePublishedIdentity(context.trackConfigName, currentSnapshot.trackConfigName)
    ) return null
    if (!publishedConditionMatches(context.condition, currentSnapshot)) return null
  }
  return {
    ...context,
    findings: [...context.findings],
    cornerMetrics: [...context.cornerMetrics],
    gaps: [...context.gaps],
    reference: context.reference
      ? { corners: context.reference.corners.map((corner) => ({ ...corner })) }
      : null
  }
}

// ─── Sector geometry (pure) ────────────────────────────────────────────────────

export const DEFAULT_PROACTIVE_SECTOR_COUNT = 3

// iRacing reports 32767 (and other absurd sentinels) for lap counters in TIMED /
// unlimited sessions; the codebase treats anything >= 9999 as "not a real lap".
const LAP_SENTINEL = 9999

/** True when `value` is a genuine lap counter (guards the 32767 timed-session sentinel). */
export function isRealLapCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < LAP_SENTINEL
}

/** Equal-width sector start fractions, e.g. count=3 → [0, 1/3, 2/3]. */
export function equalSectorStarts(count: number): number[] {
  const n = Number.isFinite(count) && count >= 1 ? Math.floor(count) : 1
  const starts: number[] = []
  for (let i = 0; i < n; i += 1) starts.push(i / n)
  return starts
}

/**
 * 1-based sector index for a lap-distance fraction given the session's sector
 * start fractions (ascending, `starts[0]` === 0). Returns the sector whose start
 * is the greatest value <= `lapDistPct`.
 */
export function sectorIndexForPct(lapDistPct: number, starts: number[]): number {
  if (!Array.isArray(starts) || starts.length === 0) return 1
  if (!Number.isFinite(lapDistPct)) return 1
  const pct = Math.max(0, Math.min(0.999999, lapDistPct))
  let sector = 1
  for (let i = 0; i < starts.length; i += 1) {
    if (pct >= starts[i]) sector = i + 1
    else break
  }
  return sector
}

// ─── Sector-boundary crossing tracker (pure) ───────────────────────────────────

export interface SectorTracker {
  /** Last sector index we observed (1-based), or null before the first sample. */
  lastSector: number | null
  /** Last lapDistPct we observed, or null before the first sample. */
  lastPct: number | null
  /** Sectors already announced since the last start/finish crossing (de-dupe). */
  announced: number[]
}

export function createSectorTracker(): SectorTracker {
  return { lastSector: null, lastPct: null, announced: [] }
}

export interface SectorAdvance {
  /** The sector index we are now in (1-based). */
  sector: number
  /** The sector that just COMPLETED (1-based), or null if no boundary was crossed. */
  completedSector: number | null
  /** True when the car crossed the start/finish line (a lap completed). */
  wrapped: boolean
}

/**
 * Advance the tracker with the latest `lapDistPct` and report any sector that just
 * completed. Handles forward boundary crossings, the start/finish WRAP-AROUND, and
 * de-duplicates so jitter at a boundary never fires the same sector twice per lap.
 */
export function advanceSectorTracker(tracker: SectorTracker, lapDistPct: number, starts: number[]): SectorAdvance {
  const sector = sectorIndexForPct(lapDistPct, starts)
  const pct = Number.isFinite(lapDistPct) ? Math.max(0, Math.min(0.999999, lapDistPct)) : 0
  let completedSector: number | null = null
  let wrapped = false

  if (tracker.lastSector !== null && tracker.lastPct !== null) {
    // Wrap-around: a large backward jump in lap distance == crossed start/finish.
    if (tracker.lastPct > 0.5 && pct < tracker.lastPct - 0.5) {
      wrapped = true
      if (!tracker.announced.includes(tracker.lastSector)) completedSector = tracker.lastSector
      tracker.announced = [] // new lap — reset the de-dupe set
    } else if (sector > tracker.lastSector && !tracker.announced.includes(tracker.lastSector)) {
      // Forward boundary: the sector we just LEFT has completed.
      completedSector = tracker.lastSector
      tracker.announced.push(completedSector)
    }
  }

  tracker.lastSector = sector
  tracker.lastPct = pct
  return { sector, completedSector, wrapped }
}

// ─── Corner-boundary crossing tracker (pure) ───────────────────────────────────
//
// Mirrors the sector tracker but keyed on the track's NUMBERED corners (Turn N).
// A corner "completes" when the car EXITS it (leaves the corner's [start,end]
// extent), which is when a per-corner call-out fires.

export interface CornerTracker {
  /** 1-based corner index we last observed, or null on a straight / before first sample. */
  lastCorner: number | null
  /** Last lapDistPct we observed, or null before the first sample. */
  lastPct: number | null
  /** Corners already announced since the last start/finish crossing (de-dupe). */
  announced: number[]
}

export function createCornerTracker(): CornerTracker {
  return { lastCorner: null, lastPct: null, announced: [] }
}

export interface CornerAdvance {
  /** Corner index we are now in (1-based), or null on a straight. */
  corner: number | null
  /** The corner that just COMPLETED (was exited), 1-based, or null. */
  completedCorner: number | null
  /** True when the car crossed the start/finish line (a lap completed). */
  wrapped: boolean
}

function cornerIndexForPct(corners: CoachCornerRef[], lapDistPct: number): number | null {
  return cornerOf({ corners }, lapDistPct)?.index ?? null
}

/** Reduce a buffered lap to the minimal samples the corner-map detector needs. */
function toCornerSamples(samples: CoachLapSample[]): CornerSample[] {
  return samples.map((s) => ({
    lapDistPct: s.lapDistPct,
    speedKmh: s.speedKmh,
    brake: s.brake,
    throttle: s.throttle,
    steerAbsDeg: s.steerAbsDeg
  }))
}

/**
 * Advance the corner tracker with the latest `lapDistPct`, reporting any corner the
 * car just exited. Handles the start/finish wrap-around and de-duplicates so jitter
 * at a corner exit never fires the same corner twice per lap.
 */
export function advanceCornerTracker(
  tracker: CornerTracker,
  lapDistPct: number,
  corners: CoachCornerRef[]
): CornerAdvance {
  const pct = Number.isFinite(lapDistPct) ? Math.max(0, Math.min(0.999999, lapDistPct)) : 0
  const corner = cornerIndexForPct(corners, pct)
  let completedCorner: number | null = null
  let wrapped = false

  if (tracker.lastPct !== null) {
    // Wrap-around: a large backward jump in lap distance == crossed start/finish.
    if (tracker.lastPct > 0.5 && pct < tracker.lastPct - 0.5) {
      wrapped = true
      if (tracker.lastCorner !== null && !tracker.announced.includes(tracker.lastCorner)) {
        completedCorner = tracker.lastCorner
      }
      tracker.announced = [] // new lap — reset the de-dupe set
    } else if (
      tracker.lastCorner !== null &&
      corner !== tracker.lastCorner &&
      !tracker.announced.includes(tracker.lastCorner)
    ) {
      // We just LEFT a corner (into a straight or the next corner): it completed.
      completedCorner = tracker.lastCorner
      tracker.announced.push(completedCorner)
    }
  }

  tracker.lastCorner = corner
  tracker.lastPct = pct
  return { corner, completedCorner, wrapped }
}

// ─── Worst-finding selection (pure) ────────────────────────────────────────────

const SEVERITY_RANK: Record<string, number> = { high: 3, med: 2, low: 1, good: 0 }

/**
 * The single worst REAL finding for a sector: highest estimated time loss, with
 * severity as the tie-break. `good` findings are ignored (nothing to call out).
 * Returns null when the sector has no actionable finding — the caller stays silent.
 */
export function worstFindingForSector(findings: CoachFinding[] | null | undefined, sector: number): CoachFinding | null {
  if (!Array.isArray(findings) || findings.length === 0) return null
  let best: CoachFinding | null = null
  for (const f of findings) {
    if (f.sector !== sector) continue
    if (f.kind === 'good') continue
    if (f.sign === 'gain') continue
    if (!(f.estTimeLossSec > 0) && (SEVERITY_RANK[f.severity] ?? 0) <= 0) continue
    if (best === null) {
      best = f
      continue
    }
    const lossDelta = f.estTimeLossSec - best.estTimeLossSec
    if (lossDelta > 0.0001) best = f
    else if (Math.abs(lossDelta) <= 0.0001 && (SEVERITY_RANK[f.severity] ?? 0) > (SEVERITY_RANK[best.severity] ?? 0)) best = f
  }
  return best
}

/**
 * The single worst REAL finding for a numbered CORNER (Turn N): highest estimated
 * time loss with severity as the tie-break. Gains / `good` findings are ignored.
 * Returns null when the corner has no actionable finding — the caller stays silent.
 */
export function worstFindingForCorner(findings: CoachFinding[] | null | undefined, corner: number): CoachFinding | null {
  if (!Array.isArray(findings) || findings.length === 0) return null
  let best: CoachFinding | null = null
  for (const f of findings) {
    if (f.corner !== corner) continue
    if (f.kind === 'good') continue
    if (f.sign === 'gain') continue
    if (!(f.estTimeLossSec > 0) && (SEVERITY_RANK[f.severity] ?? 0) <= 0) continue
    if (best === null) {
      best = f
      continue
    }
    const lossDelta = f.estTimeLossSec - best.estTimeLossSec
    if (lossDelta > 0.0001) best = f
    else if (Math.abs(lossDelta) <= 0.0001 && (SEVERITY_RANK[f.severity] ?? 0) > (SEVERITY_RANK[best.severity] ?? 0)) best = f
  }
  return best
}

const REASON_PT: Record<CoachFindingKind, string> = {
  'brake-early': 'freando cedo demais',
  'brake-late': 'freando tarde demais',
  'throttle-early': 'acelerando cedo demais',
  'throttle-late': 'acelerando tarde demais',
  'steering-early': 'virando cedo demais',
  'steering-late': 'virando tarde demais',
  'trail-brake-lock': 'travando o freio na entrada',
  coast: 'deixando o carro rolar no meio da curva',
  'throttle-hesitation': 'hesitando para acelerar na saída',
  'abs-overuse': 'forçando o freio até o ABS',
  'tc-overuse': 'acelerando cedo demais e dependendo do controle de tração',
  'steering-busy': 'corrigindo demais o volante',
  'steering-insufficient': 'virando pouco o volante',
  inconsistency: 'inconsistente entre as voltas',
  'time-loss': 'perdendo tempo',
  'min-speed-gain': 'levando mais velocidade ao ápice',
  'brake-gain': 'freando mais tarde com confiança',
  'throttle-gain': 'acelerando antes na saída',
  good: 'limpo'
}

const REASON_EN: Record<CoachFindingKind, string> = {
  'brake-early': 'braking too early',
  'brake-late': 'braking too late',
  'throttle-early': 'getting on the power too early',
  'throttle-late': 'getting on the power too late',
  'steering-early': 'turning in too early',
  'steering-late': 'turning in too late',
  'trail-brake-lock': 'locking the brakes on entry',
  coast: 'coasting mid-corner',
  'throttle-hesitation': 'hesitating on throttle out of the corner',
  'abs-overuse': 'hammering the brakes into ABS',
  'tc-overuse': 'getting on the power too early into the traction control',
  'steering-busy': 'sawing at the wheel',
  'steering-insufficient': 'under-rotating the wheel',
  inconsistency: 'inconsistent lap to lap',
  'time-loss': 'losing time',
  'min-speed-gain': 'carrying more speed at the apex',
  'brake-gain': 'braking later with confidence',
  'throttle-gain': 'getting on the power earlier on exit',
  good: 'clean'
}

function formatLoss(sec: number): string {
  const v = Math.max(0, sec)
  return v >= 0.1 ? v.toFixed(1) : v.toFixed(2)
}

/**
 * Terse, corner-cadence call-out fragments — what to IMPROVE, nothing else.
 * Used by `composeBrutalCornerLine` so a race spits short "Turn N, turn in earlier"
 * cues instead of the verbose sector sentences. Improvement-only: gains and
 * `good` collapse to a neutral "hold the pace" (callers normally skip those).
 */
const IMPROVE_PT: Record<CoachFindingKind, string> = {
  'brake-early': 'freie mais tarde',
  'brake-late': 'freie antes',
  'throttle-early': 'acelere mais tarde',
  'throttle-late': 'acelere antes',
  'steering-early': 'vire mais tarde',
  'steering-late': 'vire antes',
  'trail-brake-lock': 'solte o freio na entrada',
  coast: 'não deixe rolar, ligue a frenagem à aceleração',
  'throttle-hesitation': 'confie no acelerador na saída',
  'abs-overuse': 'use menos freio, evite o ABS',
  'tc-overuse': 'acelere mais suave na saída',
  'steering-busy': 'faça menos correções no volante',
  'steering-insufficient': 'vire mais o volante',
  inconsistency: 'repita a mesma volta',
  'time-loss': 'aumente o ritmo',
  'min-speed-gain': 'mantenha o ritmo',
  'brake-gain': 'mantenha o ritmo',
  'throttle-gain': 'mantenha o ritmo',
  good: 'mantenha o ritmo'
}

const IMPROVE_EN: Record<CoachFindingKind, string> = {
  'brake-early': 'brake later',
  'brake-late': 'brake earlier',
  'throttle-early': 'throttle later',
  'throttle-late': 'throttle earlier',
  'steering-early': 'turn in later',
  'steering-late': 'turn in earlier',
  'trail-brake-lock': 'ease off the brake on entry',
  coast: 'no coasting, connect brake and throttle',
  'throttle-hesitation': 'commit to throttle on exit',
  'abs-overuse': 'less brake, off the ABS',
  'tc-overuse': 'smoother throttle on exit',
  'steering-busy': 'less steering',
  'steering-insufficient': 'more steering',
  inconsistency: 'repeat the same lap',
  'time-loss': 'pick up the pace',
  'min-speed-gain': 'keep it up',
  'brake-gain': 'keep it up',
  'throttle-gain': 'keep it up',
  good: 'keep it up'
}

export interface BrutalLineOptions {
  language: EngineerLanguage
  assertiveness: EngineerAssertiveness
}

/**
 * Compose the spoken/displayed one-liner for a finding. BRUTAL is the bluntest:
 * direct call-out, the number, and a demand to fix it — no praise-padding. All
 * three levels are deterministic and CPU-free (the LLM only optionally rephrases).
 */
export function composeBrutalSectorLine(finding: CoachFinding, opts: BrutalLineOptions): string {
  const pt = opts.language !== 'en-US'
  const reason = (pt ? REASON_PT : REASON_EN)[finding.kind] ?? finding.title
  const hasLoss = finding.estTimeLossSec > 0
  const loss = formatLoss(finding.estTimeLossSec)
  const s = finding.sector

  if (pt) {
    if (opts.assertiveness === 'brutal') {
      return hasLoss
        ? `Setor ${s}: você perdeu ${loss}s ${reason}. Corrija.`
        : `Setor ${s}: ${reason}. Corrija.`
    }
    if (opts.assertiveness === 'assertive') {
      return hasLoss
        ? `Setor ${s}: perdeu ${loss}s ${reason}. Dá para recuperar — foco.`
        : `Setor ${s}: ${reason}. Dá para recuperar — foco.`
    }
    return hasLoss
      ? `Setor ${s}: há cerca de ${loss}s para ganhar porque você está ${reason}. Ajuste na próxima volta.`
      : `Setor ${s}: ${reason}. Ajuste na próxima volta.`
  }

  if (opts.assertiveness === 'brutal') {
    return hasLoss ? `Sector ${s}: you threw away ${loss}s ${reason}. Fix it.` : `Sector ${s}: ${reason}. Fix it.`
  }
  if (opts.assertiveness === 'assertive') {
    return hasLoss
      ? `Sector ${s}: lost ${loss}s ${reason}. You can get that back — focus.`
      : `Sector ${s}: ${reason}. You can get that back — focus.`
  }
  return hasLoss ? `Sector ${s}: about ${loss}s to gain ${reason}. Tidy it up next lap.` : `Sector ${s}: ${reason}. Tidy it up next lap.`
}

/**
 * Per-CORNER variant: terse "Turn N, <melhoria>" cues for race cadence. Unlike
 * the verbose sector line, this surfaces only what to IMPROVE — turn in earlier,
 * more steering, throttle earlier — never praise. Falls back to the full sector
 * line when the finding carries no corner number.
 */
/** "Curva N (Setor M)" in PT-BR / "Turn N (Sector M)" in EN when the sector is known — one locator for
 *  the race phrasing so the driver always hears both the corner and its sector. */
function turnSectorLabel(corner: number, sector: number | undefined, pt: boolean): string {
  if (pt) return sector !== undefined && Number.isFinite(sector) ? `Curva ${corner} (Setor ${sector})` : `Curva ${corner}`
  return sector !== undefined && Number.isFinite(sector) ? `Turn ${corner} (Sector ${sector})` : `Turn ${corner}`
}

export function composeBrutalCornerLine(finding: CoachFinding, opts: BrutalLineOptions): string {
  const pt = opts.language !== 'en-US'
  const improve = (pt ? IMPROVE_PT : IMPROVE_EN)[finding.kind] ?? finding.title
  const hasLoss = finding.estTimeLossSec > 0
  const loss = formatLoss(finding.estTimeLossSec)
  const n = finding.corner

  if (n === undefined) return composeBrutalSectorLine(finding, opts)

  const where = turnSectorLabel(n, finding.sector, pt)
  if (pt) {
    if (opts.assertiveness === 'brutal') {
      return hasLoss ? `${where}, ${improve} — ${loss}s.` : `${where}, ${improve}.`
    }
    if (opts.assertiveness === 'assertive') {
      return hasLoss ? `${where}, ${improve}. Foco — ${loss}s.` : `${where}, ${improve}. Foco.`
    }
    return hasLoss ? `${where}, ${improve} na próxima volta (${loss}s).` : `${where}, ${improve} na próxima volta.`
  }

  if (opts.assertiveness === 'brutal') {
    return hasLoss ? `${where}, ${improve} — ${loss}s.` : `${where}, ${improve}.`
  }
  if (opts.assertiveness === 'assertive') {
    return hasLoss ? `${where}, ${improve}. Focus — ${loss}s.` : `${where}, ${improve}. Focus.`
  }
  return hasLoss ? `${where}, ${improve} next lap (${loss}s).` : `${where}, ${improve} next lap.`
}

/**
 * The worst REAL loss finding PER driving dimension for a corner (brake point,
 * turn-in timing, steering angle, throttle, rotation, stability), ranked by time
 * lost. Lets a single corner call-out chain several independent mistakes
 * ("Turn 3, brake earlier, turn in earlier, throttle later") instead of only the single
 * worst one. Gains / `good` are ignored. Capped at `maxDims`.
 */
export function findingsByDimensionForCorner(
  findings: CoachFinding[] | null | undefined,
  corner: number,
  maxDims = 3
): CoachFinding[] {
  if (!Array.isArray(findings) || findings.length === 0) return []
  const worstPerDim = new Map<CoachDimension, CoachFinding>()
  for (const f of findings) {
    if (f.corner !== corner) continue
    if (f.kind === 'good' || f.sign === 'gain') continue
    if (!(f.estTimeLossSec > 0)) continue
    const dim = coachDimensionForKind(f.kind)
    if (!dim) continue
    const prev = worstPerDim.get(dim)
    if (!prev || f.estTimeLossSec > prev.estTimeLossSec) worstPerDim.set(dim, f)
  }
  const ranked = Array.from(worstPerDim.values())
    .sort((a, b) => b.estTimeLossSec - a.estTimeLossSec)
    .slice(0, Math.max(1, maxDims))
  if (ranked.length > 0) return ranked
  // FALLBACK — no specific dimension finding, but the corner still lost real time
  // (kind 'time-loss', e.g. low min-speed). Surface that single finding so the most
  // important corner cue ("Turn N, find more time here") speaks instead of going
  // silent. Only reached when NO specific dimension exists → never crowds out the
  // actionable cues.
  const timeLoss = findings
    .filter((f) => f.corner === corner && f.kind === 'time-loss' && f.sign !== 'gain' && f.estTimeLossSec > 0)
    .sort((a, b) => b.estTimeLossSec - a.estTimeLossSec)[0]
  return timeLoss ? [timeLoss] : []
}

/**
 * The terse improvement fragment for a finding. Specific dimensions use the
 * IMPROVE map ("brake earlier", "turn in earlier"). The dimension-less `time-loss`
 * fallback uses the same canonical generic cue as the live coach
 * (`coachComposeAction('time-loss')`) so race and practice say the same thing.
 */
function improveFragment(finding: CoachFinding, pt: boolean): string {
  if (finding.kind === 'time-loss') return pt ? 'ganhe mais tempo aqui' : 'find more time here'
  return (pt ? IMPROVE_PT : IMPROVE_EN)[finding.kind] ?? finding.title
}

/**
 * COMPOSITE per-corner cue for a RACE: chains the worst improvement per driving
 * dimension into ONE terse line ("Turn N, brake earlier, turn in earlier, acelere
 * depois — Xs.") so the driver hears every mistake in that corner at once instead
 * of only the single worst. A single SPECIFIC-dimension corner collapses to the exact
 * `composeBrutalCornerLine` phrasing. When a corner's ONLY loss is dimension-less
 * `time-loss` it still speaks the generic "find more time here" cue instead of
 * going silent. Returns '' when nothing is actionable.
 */
export function composeBrutalCornerComposite(
  findings: CoachFinding[],
  corner: number,
  opts: BrutalLineOptions,
  maxDims = 3
): string {
  const ranked = findingsByDimensionForCorner(findings, corner, maxDims)
  if (ranked.length === 0) return ''
  // A single SPECIFIC-dimension finding keeps the exact pinned single-line phrasing.
  if (ranked.length === 1 && ranked[0].kind !== 'time-loss') return composeBrutalCornerLine(ranked[0], opts)

  const pt = opts.language !== 'en-US'
  const fragments = ranked.map((f) => improveFragment(f, pt))
  const body = fragments.join(', ')
  const worstLoss = ranked[0].estTimeLossSec
  const hasLoss = worstLoss > 0
  const loss = formatLoss(worstLoss)
  const where = turnSectorLabel(corner, ranked[0].sector, pt)

  if (pt) {
    if (opts.assertiveness === 'brutal') return hasLoss ? `${where}, ${body} — ${loss}s.` : `${where}, ${body}.`
    if (opts.assertiveness === 'assertive') return hasLoss ? `${where}, ${body}. Foco — ${loss}s.` : `${where}, ${body}. Foco.`
    return hasLoss ? `${where}, ${body} na próxima volta (${loss}s).` : `${where}, ${body} na próxima volta.`
  }
  if (opts.assertiveness === 'brutal') return hasLoss ? `${where}, ${body} — ${loss}s.` : `${where}, ${body}.`
  if (opts.assertiveness === 'assertive') return hasLoss ? `${where}, ${body}. Focus — ${loss}s.` : `${where}, ${body}. Focus.`
  return hasLoss ? `${where}, ${body} next lap (${loss}s).` : `${where}, ${body} next lap.`
}

// ─── Engine ────────────────────────────────────────────────────────────────────

const MIN_LAP_SAMPLES = 30
const MAX_LAP_SAMPLES = 8000
const DEFAULT_MIN_EMIT_INTERVAL_MS = 6000
const DEFAULT_MIN_SPEED_KMH = 5
const MAX_RACECRAFT_HISTORY_LAPS = 120
const MAX_GAP_SAMPLES = 24
const MIN_GAP_SAMPLE_INTERVAL_MS = 500
const RACECRAFT_HISTORY_FILE = 'coach-racecraft-history.json'
const RACECRAFT_HISTORY_VERSION = 1 as const

interface RacecraftHistoryFile {
  version: typeof RACECRAFT_HISTORY_VERSION
  laps: CoachLapHistoryEntry[]
}

const COACH_FINDING_KINDS = new Set<CoachFindingKind>([
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isOptionalFinite(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isStoredFinding(value: unknown): value is CoachFinding {
  if (!isRecord(value) || !COACH_FINDING_KINDS.has(value.kind as CoachFindingKind)) return false
  if (
    typeof value.id !== 'string' ||
    !Number.isFinite(value.sector) ||
    !Number.isFinite(value.zonePctStart) ||
    !Number.isFinite(value.zonePctEnd) ||
    !Number.isFinite(value.estTimeLossSec) ||
    typeof value.title !== 'string' ||
    typeof value.detail !== 'string' ||
    typeof value.evidence !== 'string' ||
    !isRecord(value.metrics)
  ) return false
  return Object.values(value.metrics).every((metric) => typeof metric === 'number' && Number.isFinite(metric))
}

function isStoredCornerMetrics(value: unknown): value is CoachCornerMetrics {
  if (!isRecord(value) || !Number.isFinite(value.corner)) return false
  return Object.entries(value).every(
    ([key, metric]) => key === 'corner' || metric === undefined || (typeof metric === 'number' && Number.isFinite(metric))
  )
}

function isStoredHistoryLap(value: unknown): value is CoachLapHistoryEntry {
  if (!isRecord(value) || !isRecord(value.identity)) return false
  const condition = value.identity.condition
  if (condition !== 'dry' && condition !== 'intermediate' && condition !== 'wet' && condition !== 'drying') return false
  return (
    typeof value.id === 'string' &&
    Number.isFinite(value.at) &&
    value.valid === true &&
    isOptionalFinite(value.sessionId) &&
    isOptionalString(value.sessionType) &&
    isOptionalFinite(value.lapNumber) &&
    isOptionalFinite(value.lapTimeSec) &&
    isOptionalString(value.identity.trackName) &&
    isOptionalString(value.identity.trackConfigName) &&
    isOptionalString(value.identity.carName) &&
    isOptionalString(value.identity.carPath) &&
    isOptionalFinite(value.identity.carClassId) &&
    isOptionalString(value.identity.carClassName) &&
    isOptionalFinite(value.identity.airTempC) &&
    isOptionalFinite(value.identity.trackTempC) &&
    Array.isArray(value.findings) &&
    value.findings.every(isStoredFinding) &&
    Array.isArray(value.cornerMetrics) &&
    value.cornerMetrics.every(isStoredCornerMetrics)
  )
}

function cloneHistory(laps: readonly CoachLapHistoryEntry[]): CoachLapHistoryEntry[] {
  return JSON.parse(JSON.stringify(laps)) as CoachLapHistoryEntry[]
}

export class CoachRacecraftHistoryStore {
  private readonly filePath: string
  private laps: CoachLapHistoryEntry[] = []

  constructor(userDataDir: string) {
    this.filePath = join(userDataDir, RACECRAFT_HISTORY_FILE)
    this.load()
  }

  all(): CoachLapHistoryEntry[] {
    return cloneHistory(this.laps)
  }

  replace(laps: readonly CoachLapHistoryEntry[]): void {
    this.laps = cloneHistory(laps.filter(isStoredHistoryLap).slice(-MAX_RACECRAFT_HISTORY_LAPS))
    const payload: RacecraftHistoryFile = {
      version: RACECRAFT_HISTORY_VERSION,
      laps: this.laps
    }
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    renameSync(tmpPath, this.filePath)
  }

  private load(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown
      if (
        !isRecord(parsed) ||
        parsed.version !== RACECRAFT_HISTORY_VERSION ||
        !Array.isArray(parsed.laps)
      ) return
      this.laps = cloneHistory(
        parsed.laps.filter(isStoredHistoryLap).slice(-MAX_RACECRAFT_HISTORY_LAPS)
      )
    } catch {
      this.laps = []
    }
  }
}

/** Minimal live view of the engineer config the engine needs (read fresh every snapshot). */
export interface ProactiveConfigView {
  enabled: boolean
  proactiveCoaching: boolean
  language: EngineerLanguage
  assertiveness: EngineerAssertiveness
  intentSensitivity: number
}

export interface ProactiveEngineDeps {
  /** Broadcast a proactive call-out (`engineer:proactive`). */
  emit(event: EngineerProactiveEvent): void
  /** Read the live engineer config (enabled / proactiveCoaching / language / assertiveness). */
  getConfig(): ProactiveConfigView
  /** Publish fresh findings (stamped with car/track) to the shared singleton. */
  publishFindings?(findings: CoachFinding[], context?: FindingsContext): void
  /** Publish the richer evidence used by deterministic on-demand racecraft answers. */
  publishRacecraftContext?(context: RacecraftAdviceContext | null): void
  /** Seed comparable valid-lap history from the local store or tests. */
  history?: readonly CoachLapHistoryEntry[]
  /** Persist the bounded valid-lap history after each accepted lap. */
  persistHistory?(history: readonly CoachLapHistoryEntry[]): void
  now?(): number
  minEmitIntervalMs?: number
  minSpeedKmh?: number
  /**
   * Optional per-driver baseline store (car+track). When present, the engine loads
   * the baseline before analysis (enabling lap-to-lap repetition gating in the
   * intent gate) and records this lap's events after analysis. Omitted in tests →
   * the gate runs without repetition data (unchanged behavior).
   */
  baselineStore?: CoachBaselineStore
  /** Number of EQUAL-width sectors (default 3, matching the Coach). 1 → per-lap. */
  sectorCount?: number
  /**
   * Cadence of self-initiated call-outs:
   *   • `'auto'` (default) — CORNER cadence in a RACE ("Turn N"), SECTOR cadence
   *     in practice / qualify / warm-up. Resolved per-session via `cadenceForSession`.
   *   • `'sector'` — always one call-out per completed sector (legacy path).
   *   • `'corner'` — always one call-out per completed CORNER ("Turn N: <erro>"),
   *     using a corner map learned from the first full lap.
   * Either way the engine falls back to the sector path until a corner map exists.
   */
  cadence?: 'sector' | 'corner' | 'auto'
  /**
   * Corner-map builder (defaults to the real `buildCornerMap`). Injectable so tests
   * can supply a deterministic map without the geometry pipeline.
   */
  buildCornerMap?: (trackName: string, samples: CornerSample[]) => CornerMapData
  getUnitSystem?: () => UnitSystem
}

export interface ProactiveEngine {
  onSnapshot(snapshot: TelemetrySnapshot | null): void
  /** Inject findings directly (e.g. from an external `coach:report`). Publishes them too. */
  setFindings(findings: CoachFinding[], context?: FindingsContext): void
  getFindings(): CoachFinding[]
  getHistory(): CoachLapHistoryEntry[]
  reset(): void
}

function sessionAllowsProactive(snapshot: TelemetrySnapshot): boolean {
  const kind = deriveSessionKind(snapshot.sessionType)
  // RACE-ONLY by default: the proactive engineer owns the audio in a race (corner-
  // numbered + directional call-outs) while the Live Coach owns ordinary
  // practice/qualifying call-outs. Restricting recurring proactive speech to races
  // guarantees exactly ONE
  // speaker per session — no double-speak (the Live Coach is muted in races,
  // coach.ts maybeSpeak). A user forcing cadence still routes through this gate.
  return kind === 'race'
}

/**
 * Resolve the effective call-out cadence for a session. `'sector'` / `'corner'`
 * are honoured verbatim; `'auto'` (the default) picks CORNER cadence in a RACE —
 * where the driver wants "Turn 1, Turn 2…" because a sector holds many corners —
 * and SECTOR cadence everywhere else (practice / qualify / warm-up / unknown).
 * This only expresses the PREFERENCE: the engine still needs a learned corner map
 * before corner call-outs fire, so it falls back to sectors until one exists.
 */
export function cadenceForSession(configured: 'sector' | 'corner' | 'auto', sessionType?: string): 'sector' | 'corner' {
  if (configured === 'corner') return 'corner'
  if (configured === 'sector') return 'sector'
  return deriveSessionKind(sessionType) === 'race' ? 'corner' : 'sector'
}

// Laps until the chaser reaches the leader, from their gap and per-lap paces. The
// chaser closes only when its lap time is lower; returns the rounded-up lap count
// while closing, else null. Pure → unit-tested.
export function lapsToCatch(gapSec?: number, chaserLapSec?: number, leaderLapSec?: number): number | null {
  if (!Number.isFinite(gapSec) || !Number.isFinite(chaserLapSec) || !Number.isFinite(leaderLapSec)) return null
  const gap = Math.abs(gapSec as number)
  const perLapGain = (leaderLapSec as number) - (chaserLapSec as number)
  if (perLapGain <= 0.05 || gap <= 0) return null // not closing (or noise)
  return Math.max(1, Math.ceil(gap / perLapGain))
}

export function composeCatchLine(
  direction: 'ahead' | 'behind',
  laps: number,
  language: EngineerLanguage
): string {
  const count = Math.max(1, Math.round(laps))
  const en = language === 'en-US'
  if (direction === 'behind') {
    return en
      ? `Car behind catches you in ${count} lap${count === 1 ? '' : 's'}.`
      : `O carro de trás alcança você em ${count} ${count === 1 ? 'volta' : 'voltas'}.`
  }
  return en
    ? `You catch the car ahead in ${count} lap${count === 1 ? '' : 's'}.`
    : `Você alcança o carro da frente em ${count} ${count === 1 ? 'volta' : 'voltas'}.`
}

export function createProactiveEngine(deps: ProactiveEngineDeps): ProactiveEngine {
  const now = deps.now ?? (() => Date.now())
  const publish = deps.publishFindings ?? publishCoachFindings
  const publishRacecraft = deps.publishRacecraftContext ?? publishCoachRacecraftContext
  const minEmitIntervalMs = deps.minEmitIntervalMs ?? DEFAULT_MIN_EMIT_INTERVAL_MS
  const minSpeedKmh = deps.minSpeedKmh ?? DEFAULT_MIN_SPEED_KMH
  const starts = equalSectorStarts(deps.sectorCount ?? DEFAULT_PROACTIVE_SECTOR_COUNT)
  const cadence: 'sector' | 'corner' | 'auto' =
    deps.cadence === 'corner' || deps.cadence === 'sector' ? deps.cadence : 'auto'
  const buildCornerMapFn = deps.buildCornerMap ?? buildCornerMap
  const baselineStore = deps.baselineStore
  const liveGate = new LiveTelemetryGate()

  const tracker = createSectorTracker()
  const cornerTracker = createCornerTracker()
  // Per-track corner map, learned lazily from the first full lap and reused so
  // corner numbering stays stable for race call-outs and qualifying evidence.
  let cornerMap: CornerMapData | null = null
  let reference: CoachReferenceLap | null = null
  let referenceLapTimeSec: number | undefined
  let latestCornerMetrics: CoachCornerMetrics[] = []
  let buffer: CoachLapSample[] = []
  let findings: CoachFinding[] = []
  let racecraftFindings: CoachFinding[] = []
  const history: CoachLapHistoryEntry[] = (deps.history ?? []).map((lap) => ({
    ...lap,
    identity: { ...lap.identity },
    findings: lap.findings.map((finding) => ({ ...finding, metrics: { ...finding.metrics } })),
    cornerMetrics: lap.cornerMetrics.map((metrics) => ({ ...metrics }))
  }))
  let gapSamples: CoachGapSample[] = []
  let lastSnapshot: TelemetrySnapshot | null = null
  let lastFindingsContext: FindingsContext | undefined
  let activeAnalysisKey: string | null = null
  let activeAnalysisIdentity: CoachComparableIdentity | null = null
  let lapIncidentStart: number | undefined
  let previousTrackWetnessPct: number | undefined
  let conditionIdentityKey: string | null = null
  let stableTrackCondition: CoachTrackCondition | undefined
  let lastSessionKind = deriveSessionKind(undefined)
  let lastQualiSessionKey: string | null = null
  let lastEmitAt = 0
  let lastEmittedFindingId: string | null = null
  let lastLapCount: number | null = null
  let lastBehindN = 99
  let lastAheadN = 99
  // The first flying lap after a pit stop / reconnect is an OUT-LAP (warm-up) and
  // must not be coached or analysed; cleared on the first lap completion after it.
  let outLap = false
  let seq = 0

  function incidentCount(snapshot: TelemetrySnapshot): number | undefined {
    if (Number.isFinite(snapshot.incidentCountMy)) return snapshot.incidentCountMy
    if (Number.isFinite(snapshot.incidentCount)) return snapshot.incidentCount
    return undefined
  }

  function conditionForSnapshot(snapshot: TelemetrySnapshot): CoachTrackCondition {
    const identityKey = [
      normalizedIdentityPart(snapshot.trackName),
      normalizedIdentityPart(snapshot.trackConfigName),
      normalizedIdentityPart(snapshot.carPath || snapshot.carName)
    ].join('::')
    if (conditionIdentityKey !== identityKey) {
      conditionIdentityKey = identityKey
      stableTrackCondition = coachComparableIdentityFromSnapshot(snapshot).condition
      return stableTrackCondition
    }

    const measured = coachComparableIdentityFromSnapshot(snapshot, previousTrackWetnessPct).condition
    const keepDrying =
      stableTrackCondition === 'drying' &&
      measured === 'intermediate' &&
      snapshot.isRaining !== true &&
      Number.isFinite(snapshot.trackWetnessPct) &&
      (snapshot.trackWetnessPct as number) > 0.03
    stableTrackCondition = keepDrying ? 'drying' : measured
    return stableTrackCondition
  }

  function contextForSnapshot(snapshot: TelemetrySnapshot): FindingsContext {
    return {
      carName: snapshot.carName,
      carPath: snapshot.carPath,
      trackName: snapshot.trackName,
      trackConfigName: snapshot.trackConfigName,
      condition: conditionForSnapshot(snapshot)
    }
  }

  function normalizedIdentityPart(value: string | undefined): string {
    return (value ?? '').trim().toLowerCase()
  }

  function analysisKey(snapshot: TelemetrySnapshot): string {
    const identity = coachComparableIdentityFromSnapshot(snapshot, previousTrackWetnessPct)
    return [
      normalizedIdentityPart(identity.trackName),
      normalizedIdentityPart(identity.trackConfigName),
      normalizedIdentityPart(identity.carPath || identity.carName),
      Number.isFinite(identity.carClassId) ? identity.carClassId : '',
      conditionForSnapshot(snapshot)
    ].join('::')
  }

  function ambientIsComparable(
    left: CoachComparableIdentity,
    right: CoachComparableIdentity
  ): boolean {
    const airComparable =
      left.airTempC === undefined && right.airTempC === undefined
        ? true
        : Number.isFinite(left.airTempC) &&
          Number.isFinite(right.airTempC) &&
          Math.abs((left.airTempC as number) - (right.airTempC as number)) <= 5
    const trackComparable =
      left.trackTempC === undefined && right.trackTempC === undefined
        ? true
        : Number.isFinite(left.trackTempC) &&
          Number.isFinite(right.trackTempC) &&
          Math.abs((left.trackTempC as number) - (right.trackTempC as number)) <= 8
    return airComparable && trackComparable
  }

  function publishRacecraftState(snapshot: TelemetrySnapshot | null = lastSnapshot): void {
    const context = snapshot ? contextForSnapshot(snapshot) : lastFindingsContext
    publishRacecraft({
      findings: racecraftFindings,
      cornerMetrics: latestCornerMetrics,
      reference,
      gaps: gapSamples,
      currentGapAheadSec: Number.isFinite(snapshot?.relatives?.ahead?.gapSec)
        ? Math.abs(snapshot!.relatives!.ahead!.gapSec as number)
        : undefined,
      currentGapBehindSec: Number.isFinite(snapshot?.relatives?.behind?.gapSec)
        ? Math.abs(snapshot!.relatives!.behind!.gapSec as number)
        : undefined,
      carName: context?.carName,
      carPath: context?.carPath,
      trackName: context?.trackName,
      trackConfigName: context?.trackConfigName,
      condition: context?.condition
    })
  }

  function setFindings(
    next: CoachFinding[],
    context?: FindingsContext,
    racecraftEvidence: CoachFinding[] = next
  ): void {
    findings = Array.isArray(next) ? next : []
    racecraftFindings = Array.isArray(racecraftEvidence)
      ? racecraftEvidence.map((finding) => ({ ...finding, metrics: { ...finding.metrics } }))
      : []
    lastFindingsContext = context ?? (lastSnapshot ? contextForSnapshot(lastSnapshot) : lastFindingsContext)
    publish(findings, context)
    publishRacecraftState()
  }

  function recordGapSample(snapshot: TelemetrySnapshot): void {
    const aheadSec = Number.isFinite(snapshot.relatives?.ahead?.gapSec)
      ? Math.abs(snapshot.relatives!.ahead!.gapSec as number)
      : undefined
    const behindSec = Number.isFinite(snapshot.relatives?.behind?.gapSec)
      ? Math.abs(snapshot.relatives!.behind!.gapSec as number)
      : undefined
    if (aheadSec === undefined && behindSec === undefined) return
    const at = Number.isFinite(snapshot.timestamp) ? snapshot.timestamp : now()
    const next: CoachGapSample = {
      at,
      aheadSec,
      behindSec,
      aheadCarIdx: snapshot.relatives?.ahead?.carIdx,
      behindCarIdx: snapshot.relatives?.behind?.carIdx
    }
    const previous = gapSamples[gapSamples.length - 1]
    if (previous && at - previous.at < MIN_GAP_SAMPLE_INTERVAL_MS) {
      gapSamples[gapSamples.length - 1] = next
    } else {
      gapSamples.push(next)
      gapSamples = gapSamples.slice(-MAX_GAP_SAMPLES)
    }
  }

  function ensureAnalysisContext(snapshot: TelemetrySnapshot): void {
    const nextKey = analysisKey(snapshot)
    const nextIdentity = coachComparableIdentityFromSnapshot(snapshot, previousTrackWetnessPct)
    nextIdentity.condition = conditionForSnapshot(snapshot)
    const ambientChanged =
      activeAnalysisKey === nextKey &&
      activeAnalysisIdentity !== null &&
      !ambientIsComparable(activeAnalysisIdentity, nextIdentity)
    const keyChanged = activeAnalysisKey !== null && activeAnalysisKey !== nextKey
    if (keyChanged || ambientChanged) {
      reset()
      cornerMap = null
      reference = null
      referenceLapTimeSec = undefined
      latestCornerMetrics = []
      gapSamples = []
      findings = []
      racecraftFindings = []
      lastFindingsContext = contextForSnapshot(snapshot)
      publish([], lastFindingsContext)
    }
    activeAnalysisKey = nextKey
    if (activeAnalysisIdentity === null || keyChanged || ambientChanged) {
      activeAnalysisIdentity = nextIdentity
    }
  }

  function reset(): void {
    tracker.lastSector = null
    tracker.lastPct = null
    tracker.announced = []
    cornerTracker.lastCorner = null
    cornerTracker.lastPct = null
    cornerTracker.announced = []
    buffer = []
    lastLapCount = null
    lastBehindN = 99
    lastAheadN = 99
    lapIncidentStart = undefined
  }

  function resetLiveSession(): void {
    reset()
    lastSnapshot = null
    lastFindingsContext = undefined
    activeAnalysisKey = null
    activeAnalysisIdentity = null
    cornerMap = null
    reference = null
    referenceLapTimeSec = undefined
    latestCornerMetrics = []
    gapSamples = []
    racecraftFindings = []
    previousTrackWetnessPct = undefined
    conditionIdentityKey = null
    stableTrackCondition = undefined
    lastSessionKind = deriveSessionKind(undefined)
    lastQualiSessionKey = null
    lastEmitAt = 0
    lastEmittedFindingId = null
    outLap = true
    setFindings([])
    publishRacecraft(null)
  }

  function finalizeLap(snapshot: TelemetrySnapshot): void {
    if (buffer.length < MIN_LAP_SAMPLES) {
      buffer = []
      lapIncidentStart = incidentCount(snapshot)
      return
    }
    try {
      const lapNumber = isRealLapCount(snapshot.currentLap) ? snapshot.currentLap : undefined
      const lapSamples = buffer.slice()
      if (!cornerMap || cornerMap.corners.length === 0) {
        const learned = buildCornerMapFn(snapshot.trackName ?? 'unknown', toCornerSamples(lapSamples))
        if (learned.corners.length > 0) cornerMap = learned
      }
      const layoutKey = trackLayoutKey(snapshot.trackName ?? '', snapshot.trackConfigName)
      const baseline = baselineStore?.get(layoutKey, snapshot.carName)
      const minConfidence = sensitivityToMinConfidence(deps.getConfig().intentSensitivity)
      const lapTimeSec = Number.isFinite(snapshot.lastLapTimeSec) ? snapshot.lastLapTimeSec : undefined
      const reportInput = {
        sectorCount: starts.length,
        samples: lapSamples,
        lapNumber,
        lapTimeSec,
        bestLapTimeSec: Number.isFinite(snapshot.bestLapTimeSec) ? snapshot.bestLapTimeSec : undefined
      }
      // Keep an ungated evidence view for racecraft/history. The repetition gate is a
      // speech-noise filter; it must not erase the observations used to learn repetition.
      const evidenceReport = buildCoachReport(
        reportInput,
        { cornerMap, reference, registry: intentRegistry, minConfidence, unitSystem: deps.getUnitSystem?.() }
      )
      const report = baseline
        ? buildCoachReport(
          reportInput,
          { cornerMap, reference, registry: intentRegistry, baseline, minConfidence, unitSystem: deps.getUnitSystem?.() }
        )
        : evidenceReport
      const incidentEnd = incidentCount(snapshot)
      const incidentKnownClean =
        lapIncidentStart !== undefined && incidentEnd !== undefined
          ? incidentEnd <= lapIncidentStart
          : snapshot.sim !== 'iracing'
      const hadCaution = lapSamples.some(
        (sample) => sample.ctx?.flagYellow === true || sample.ctx?.caution === true
      )
      const validLap =
        lapTimeSec !== undefined &&
        lapTimeSec > 0 &&
        incidentKnownClean &&
        !hadCaution

      const stamp = contextForSnapshot(snapshot)
      if (validLap) {
        latestCornerMetrics = evidenceReport.cornerMetrics.map((metrics) => ({ ...metrics }))
      }
      setFindings(
        report.findings,
        stamp,
        validLap ? evidenceReport.findings : racecraftFindings
      )
      if (validLap) {
        const identity = coachComparableIdentityFromSnapshot(snapshot, previousTrackWetnessPct)
        identity.condition = conditionForSnapshot(snapshot)
        history.push(coachLapHistoryEntry(snapshot, evidenceReport, true, now(), identity))
        history.splice(0, Math.max(0, history.length - MAX_RACECRAFT_HISTORY_LAPS))
        try {
          deps.persistHistory?.(history)
        } catch (error) {
          logger.warn(LOG_AREA, 'racecraft history persistence failed', {
            message: error instanceof Error ? error.message : String(error)
          })
        }
        if (
          evidenceReport.cornerMetrics.length > 0 &&
          (referenceLapTimeSec === undefined || lapTimeSec < referenceLapTimeSec)
        ) {
          reference = { corners: evidenceReport.cornerMetrics.map((metrics) => ({ ...metrics })) }
          referenceLapTimeSec = lapTimeSec
          publishRacecraftState(snapshot)
        }
      }
      // Learn this lap's events so future laps can tell a repeated issue from noise.
      if (baselineStore && baseline && validLap) {
        const lapForRep = isRealLapCount(snapshot.currentLap) ? (snapshot.currentLap as number) : (lastLapCount ?? 0)
        baselineStore.put({
          ...baseline,
          repetition: recordLapEvents(baseline.repetition, lapForRep, findingEventKeys(evidenceReport.findings))
        })
      }
    } catch (error) {
      logger.warn(LOG_AREA, 'proactive lap analysis failed', { message: error instanceof Error ? error.message : String(error) })
    }
    lapIncidentStart = incidentCount(snapshot)
    buffer = []
  }

  function onLapComplete(snapshot: TelemetrySnapshot): void {
    if (outLap) {
      // Out-lap (post-pit / post-reconnect warm-up): discard WITHOUT analysing so
      // lift-and-coast + cold-tyre braking never become "findings", and clear the
      // flag so the next green lap is coached normally.
      outLap = false
      buffer = []
      lapIncidentStart = incidentCount(snapshot)
      return
    }
    finalizeLap(snapshot)
    maybeEmitCatch(snapshot, deps.getConfig())
  }

  function qualiSessionKey(snapshot: TelemetrySnapshot): string {
    return [
      snapshot.sessionUniqueId ?? 'session',
      normalizedIdentityPart(snapshot.trackName),
      normalizedIdentityPart(snapshot.trackConfigName),
      normalizedIdentityPart(snapshot.carPath || snapshot.carName)
    ].join('::')
  }

  function maybeEmitQualiStart(snapshot: TelemetrySnapshot, config: ProactiveConfigView): void {
    const kind = deriveSessionKind(snapshot.sessionType)
    const key = qualiSessionKey(snapshot)
    const enteringQuali = kind === 'qualify' && (lastSessionKind !== 'qualify' || lastQualiSessionKey !== key)
    lastSessionKind = kind
    if (!enteringQuali) return
    lastQualiSessionKey = key
    if (!config.proactiveCoaching) return

    const sessionId = Number.isFinite(snapshot.sessionUniqueId) ? snapshot.sessionUniqueId : undefined
    const currentSession =
      sessionId === undefined ? [] : history.filter((lap) => lap.sessionId === sessionId)
    const priorHistory =
      sessionId === undefined ? history : history.filter((lap) => lap.sessionId !== sessionId)
    const currentIdentity = coachComparableIdentityFromSnapshot(snapshot, previousTrackWetnessPct)
    currentIdentity.condition = conditionForSnapshot(snapshot)
    const summary = buildQualiStartSummary({
      current: currentIdentity,
      history: priorHistory,
      currentSession,
      language: config.language,
      unitSystem: deps.getUnitSystem?.()
    })
    const top = summary.items[0]
    const at = now()
    seq += 1
    deps.emit({
      id: `eng-quali-${at}-${seq}`,
      at,
      text: summary.text,
      sector: top?.sector ?? 1,
      kind: top?.kind ?? 'time-loss',
      severity: severityForLoss(top?.averageLossSec ?? 0),
      estTimeLossSec: top?.averageLossSec ?? 0,
      speak: true,
      lang: config.language,
      source: 'engineer',
      corner: top?.corner
    })
  }

  // Proactive "who catches whom" callout, evaluated once per completed lap: from my
  // last-lap pace vs the car ahead/behind (gap + their last lap), estimate how many
  // laps until contact and announce at the 5→1 thresholds (only while closing, only
  // when N drops). Debounced per direction so each threshold fires once.
  function maybeEmitCatch(snapshot: TelemetrySnapshot, config: ProactiveConfigView): void {
    if (!config.proactiveCoaching) return
    if (!sessionAllowsProactive(snapshot)) return
    const myLap = snapshot.lastLapTimeSec
    if (!Number.isFinite(myLap) || (myLap ?? 0) <= 0) return
    const behindN = lapsToCatch(snapshot.relatives?.behind?.gapSec, snapshot.relatives?.behind?.lastLapTimeSec, myLap)
    if (behindN !== null && behindN <= 5 && behindN < lastBehindN) {
      emitCatch(composeCatchLine('behind', behindN, config.language), config)
    }
    lastBehindN = behindN ?? 99
    const aheadN = lapsToCatch(snapshot.relatives?.ahead?.gapSec, myLap, snapshot.relatives?.ahead?.lastLapTimeSec)
    if (aheadN !== null && aheadN <= 5 && aheadN < lastAheadN) {
      emitCatch(composeCatchLine('ahead', aheadN, config.language), config)
    }
    lastAheadN = aheadN ?? 99
  }

  function emitCatch(text: string, config: ProactiveConfigView): void {
    const at = now()
    seq += 1
    deps.emit({ id: `eng-catch-${at}-${seq}`, at, text, sector: 1, kind: 'time-loss', severity: 'low', estTimeLossSec: 0, speak: true, lang: config.language, source: 'engineer' })
  }

  function maybeEmit(completedSector: number, snapshot: TelemetrySnapshot, config: ProactiveConfigView): void {
    if (!config.proactiveCoaching) return
    if ((snapshot.speedKmh ?? 0) < minSpeedKmh) return
    if (!sessionAllowsProactive(snapshot)) return

    const finding = worstFindingForSector(findings, completedSector)
    if (!finding) return // no coach data for this sector → stay silent

    const at = now()
    // Anti-spam: respect a minimum interval and never repeat the same finding back-to-back.
    if (at - lastEmitAt < minEmitIntervalMs) return
    if (finding.id === lastEmittedFindingId) return

    const text = composeBrutalSectorLine(finding, { language: config.language, assertiveness: config.assertiveness })
    if (!text) return

    seq += 1
    const event: EngineerProactiveEvent = {
      id: `eng-proactive-${at}-${seq}`,
      at,
      text,
      sector: completedSector,
      kind: finding.kind,
      severity: finding.severity,
      estTimeLossSec: finding.estTimeLossSec,
      speak: true,
      lang: config.language,
      source: 'engineer'
    }
    lastEmitAt = at
    lastEmittedFindingId = finding.id
    deps.emit(event)
  }

  function maybeEmitCorner(completedCorner: number, snapshot: TelemetrySnapshot, config: ProactiveConfigView): void {
    if (!config.proactiveCoaching) return
    if ((snapshot.speedKmh ?? 0) < minSpeedKmh) return
    if (!sessionAllowsProactive(snapshot)) return

    const finding = worstFindingForCorner(findings, completedCorner)
    if (!finding) return // no coach data for this corner → stay silent

    const at = now()
    if (at - lastEmitAt < minEmitIntervalMs) return
    if (finding.id === lastEmittedFindingId) return

    // Compose a COMPOSITE line chaining the worst mistake per dimension for this
    // corner ("Turn N, brake earlier, turn in earlier, throttle later"). Collapses to the
    // single-finding phrasing when only one dimension is off.
    const text = composeBrutalCornerComposite(findings, completedCorner, {
      language: config.language,
      assertiveness: config.assertiveness
    })
    if (!text) return

    seq += 1
    const event: EngineerProactiveEvent = {
      id: `eng-proactive-${at}-${seq}`,
      at,
      text,
      // The IPC event carries the finding's sector (the corner number is in `text`).
      sector: finding.sector,
      kind: finding.kind,
      severity: finding.severity,
      estTimeLossSec: finding.estTimeLossSec,
      speak: true,
      lang: config.language,
      source: 'engineer',
      corner: completedCorner
    }
    lastEmitAt = at
    lastEmittedFindingId = finding.id
    deps.emit(event)
  }

  function onSnapshot(snapshot: TelemetrySnapshot | null): void {
    const live = liveGate.observe(snapshot)
    if (!live.live) {
      if (live.boundary) resetLiveSession()
      return
    }
    if (live.boundary) resetLiveSession()

    const config = deps.getConfig()
    // Fully disabled → do nothing (the on-demand engineer reports "off" anyway).
    if (!config.enabled) return
    if (!snapshot) return

    lastSnapshot = snapshot
    ensureAnalysisContext(snapshot)
    recordGapSample(snapshot)
    maybeEmitQualiStart(snapshot, config)
    if (lapIncidentStart === undefined) lapIncidentStart = incidentCount(snapshot)

    if (snapshot.onPitRoad === true) {
      // In the pits: drop the partial lap (the in-lap slow-down is not a mistake)
      // and mark the next flying lap an out-lap. KEEP the findings — the last green
      // lap's advice is still valid across the stop.
      reset()
      outLap = true
      publishRacecraftState(snapshot)
      previousTrackWetnessPct = Number.isFinite(snapshot.trackWetnessPct)
        ? snapshot.trackWetnessPct
        : previousTrackWetnessPct
      return
    }

    const sample = coachSampleFromSnapshot(snapshot)
    if (!sample) {
      publishRacecraftState(snapshot)
      previousTrackWetnessPct = Number.isFinite(snapshot.trackWetnessPct)
        ? snapshot.trackWetnessPct
        : previousTrackWetnessPct
      return
    }

    const advance = advanceSectorTracker(tracker, sample.lapDistPct, starts)
    // Corner cadence advances a parallel corner tracker (only once a map is learned).
    // `auto` resolves to corner in a race, sector otherwise; either way we still need
    // a learned corner map before corner call-outs can fire.
    const wantCorner = cadenceForSession(cadence, snapshot.sessionType) === 'corner'
    const useCorner = wantCorner && cornerMap !== null && cornerMap.corners.length > 0
    const cornerAdvance = useCorner
      ? advanceCornerTracker(cornerTracker, sample.lapDistPct, cornerMap!.corners)
      : null

    // Lap completion mirrors the Coach (coach.ts crossedLine): prefer the sim lap
    // counter, fall back to the lap-distance wrap, so choppy telemetry that skips
    // the start/finish sample never silently drops a whole lap of analysis.
    const lap = isRealLapCount(snapshot.currentLap) ? snapshot.currentLap : null
    const counterAdvanced = lap !== null && lastLapCount !== null && lap > lastLapCount
    if (lap !== null) lastLapCount = lap

    // A completed lap means the previous lap finished — analyse it FIRST (unless it
    // was an out-lap) so the last sector's call-out cites fresh findings, then start
    // the new lap's buffer clean.
    const wasOutLap = outLap
    if (advance.wrapped || counterAdvanced) {
      // The sim counter can complete a lap the geometric wrap missed (choppy
      // telemetry). The geometric wrap resets the per-lap de-dupe set itself; on a
      // counter-only completion we must reset it too, or the new lap's sectors stay
      // suppressed.
      if (counterAdvanced && !advance.wrapped) {
        tracker.announced = []
        cornerTracker.announced = []
      }
      onLapComplete(snapshot)
    }

    if (buffer.length < MAX_LAP_SAMPLES) buffer.push(sample)

    // Out-laps are never coached (warm-up behaviour is not a mistake). We check BOTH
    // the current `outLap` (mid-lap sectors) AND `wasOutLap` captured before
    // onLapComplete() cleared it — otherwise the out-lap's trailing sector, emitted on
    // the geometric start/finish wrap, would still fire a spurious call-out. The next
    // green lap is unaffected (wasOutLap is false on a normal lap).
    if (!outLap && !wasOutLap) {
      if (cornerAdvance && cornerAdvance.completedCorner !== null) {
        // Per-CORNER cadence: call out the worst finding for the corner just exited.
        maybeEmitCorner(cornerAdvance.completedCorner, snapshot, config)
      } else if (!useCorner && advance.completedSector !== null) {
        // Per-SECTOR cadence (default, or corner cadence before a map exists).
        maybeEmit(advance.completedSector, snapshot, config)
      }
    }
    publishRacecraftState(snapshot)
    previousTrackWetnessPct = Number.isFinite(snapshot.trackWetnessPct)
      ? snapshot.trackWetnessPct
      : previousTrackWetnessPct
  }

  return {
    onSnapshot,
    setFindings,
    getFindings: () => findings,
    getHistory: () =>
      history.map((lap) => ({
        ...lap,
        identity: { ...lap.identity },
        findings: lap.findings.map((finding) => ({ ...finding, metrics: { ...finding.metrics } })),
        cornerMetrics: lap.cornerMetrics.map((metrics) => ({ ...metrics }))
      })),
    reset
  }
}

// ─── Module registration ───────────────────────────────────────────────────────

export function register(ctx: ModuleContext): void {
  let unitSystem: UnitSystem = 'metric'
  settingsEvents.onChanged((settings) => {
    unitSystem = settings.unitSystem
  })
  const userDataDir = ctx.app.getPath('userData')
  const baselineStore = getCoachBaselineStore(userDataDir)
  const historyStore = new CoachRacecraftHistoryStore(userDataDir)
  const engine = createProactiveEngine({
    emit: (event) => ctx.broadcast(ENGINEER_CHANNELS.proactive, event),
    getConfig: () => {
      const cfg = getEngineerConfigSnapshot()
      return {
        enabled: cfg.enabled,
        proactiveCoaching: cfg.proactiveCoaching,
        language: cfg.language,
        assertiveness: cfg.assertiveness,
        intentSensitivity: cfg.intentSensitivity
      }
    },
    publishFindings: publishCoachFindings,
    publishRacecraftContext: publishCoachRacecraftContext,
    baselineStore,
    history: historyStore.all(),
    persistHistory: (history) => historyStore.replace(history),
    getUnitSystem: () => unitSystem
  })

  ctx.telemetryHub.on('snapshot', (snapshot: TelemetrySnapshot | null) => {
    try {
      engine.onSnapshot(snapshot)
    } catch (error) {
      logger.warn(LOG_AREA, 'proactive engineer failed', { message: error instanceof Error ? error.message : String(error) })
    }
  })
}
