// ─────────────────────────────────────────────────────────────────────────────
// F2 — Setup advisor (PURE, deterministic, unit-tested).
//
// Maps observable symptoms (handling balance per phase + tyre temperature
// profiles + cold pressures + brake bias) into concrete, directional setup
// suggestions with a plain-language rationale. It is deliberately conservative
// and framework-free: every rule returns a SMALL/MEDIUM directional change plus
// alternatives, never a magic number — the driver still validates on track.
//
// Tyre temps are expressed as inner / middle / outer ACROSS THE TREAD (already
// normalised per corner by the caller, so "inner" always means the edge toward
// the car centreline). That keeps the camber/pressure logic car-agnostic.
// ─────────────────────────────────────────────────────────────────────────────

import type { CoachPhase } from './coach'

export type SetupArea =
  | 'aero'
  | 'arb'
  | 'springs'
  | 'dampers'
  | 'differential'
  | 'tyres'
  | 'brakes'
  | 'alignment'
  | 'ride-height'

export type SetupDirection = 'increase' | 'decrease' | 'soften' | 'stiffen' | 'forward' | 'rearward' | 'adjust'

export type SetupMagnitude = 'small' | 'medium' | 'large'

export interface SetupAdjustment {
  area: SetupArea
  direction: SetupDirection
  magnitude: SetupMagnitude
  /** Human-readable instruction (PT-BR). */
  change: string
}

export type SetupSymptomKind =
  | 'understeer-entry'
  | 'understeer-mid'
  | 'understeer-exit'
  | 'oversteer-entry'
  | 'oversteer-mid'
  | 'oversteer-exit'
  | 'tyre-overheat'
  | 'tyre-cold'
  | 'tyre-temp-imbalance-lr'
  | 'camber-excess'
  | 'camber-lack'
  | 'pressure-high'
  | 'pressure-low'
  | 'brake-lock-front'
  | 'brake-lock-rear'

export type SetupCorner = 'lf' | 'rf' | 'lr' | 'rr' | 'front' | 'rear' | 'left' | 'right' | 'all'

export type SetupConfidence = 'low' | 'med' | 'high'

export interface SetupSuggestion {
  id: string
  symptom: SetupSymptomKind
  phase?: CoachPhase
  corner?: SetupCorner
  confidence: SetupConfidence
  /** Why this symptom was flagged + what the change does (PT-BR). */
  rationale: string
  /** Measured numbers backing the suggestion (PT-BR). */
  evidence: string
  primary: SetupAdjustment
  alternatives: SetupAdjustment[]
  metrics: Record<string, number>
}

export interface SetupReport {
  generatedAt: number
  suggestions: SetupSuggestion[]
  /** Short PT-BR headline. */
  summary: string
}

/** Tread temps for a single tyre (inner = edge toward car centre). */
export interface TyreTreadTemps {
  innerC?: number
  middleC?: number
  outerC?: number
  /** Optional single core temp when the sim only exposes one value. */
  coreC?: number
  pressureKpa?: number
  wearPct?: number
}

export interface CornerTyres {
  lf?: TyreTreadTemps
  rf?: TyreTreadTemps
  lr?: TyreTreadTemps
  rr?: TyreTreadTemps
}

/** Per-phase balance signal: positive = oversteer (loose), negative = understeer (push). */
export interface SetupBalanceSignal {
  phase: CoachPhase
  /** -1..1 — sign is the balance, magnitude is confidence/strength. */
  bias: number
  evidence?: string
}

export interface SetupAdvisorInput {
  tyres?: CornerTyres
  brakeBiasPct?: number
  balance?: SetupBalanceSignal[]
}

export interface SetupAdvisorConfig {
  /** Ideal tyre tread temperature window (°C). */
  tempLowC: number
  tempHighC: number
  /** Inner-vs-outer delta that flags camber (°C). */
  camberDeltaC: number
  /** Middle-vs-edges delta that flags pressure (°C). */
  pressureDeltaC: number
  /** Left-vs-right axle average delta that flags imbalance (°C). */
  lrDeltaC: number
  /** |bias| above which a balance signal becomes a suggestion. */
  balanceThreshold: number
  /** |bias| above which confidence is "high". */
  balanceStrong: number
}

export const DEFAULT_SETUP_ADVISOR: SetupAdvisorConfig = {
  tempLowC: 70,
  tempHighC: 100,
  camberDeltaC: 12,
  pressureDeltaC: 8,
  lrDeltaC: 12,
  balanceThreshold: 0.25,
  balanceStrong: 0.6
}

let setupSeq = 0
function suggestion(
  symptom: SetupSymptomKind,
  confidence: SetupConfidence,
  rationale: string,
  evidence: string,
  primary: SetupAdjustment,
  alternatives: SetupAdjustment[],
  metrics: Record<string, number>,
  extras: { phase?: CoachPhase; corner?: SetupCorner } = {}
): SetupSuggestion {
  setupSeq += 1
  return {
    id: `${symptom}:${extras.corner ?? extras.phase ?? 'x'}:${setupSeq}`,
    symptom,
    phase: extras.phase,
    corner: extras.corner,
    confidence,
    rationale,
    evidence,
    primary,
    alternatives,
    metrics
  }
}

function avgTread(t: TyreTreadTemps): number | undefined {
  const vals = [t.innerC, t.middleC, t.outerC].filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (vals.length > 0) return vals.reduce((s, v) => s + v, 0) / vals.length
  return typeof t.coreC === 'number' && Number.isFinite(t.coreC) ? t.coreC : undefined
}

function cornerLabel(c: 'lf' | 'rf' | 'lr' | 'rr'): string {
  return { lf: 'diant. esq.', rf: 'diant. dir.', lr: 'tras. esq.', rr: 'tras. dir.' }[c]
}

/** PURE: tyre-temperature + pressure + camber advice for the four corners. */
export function adviseFromTyres(
  tyres: CornerTyres | undefined,
  cfg: SetupAdvisorConfig = DEFAULT_SETUP_ADVISOR
): SetupSuggestion[] {
  if (!tyres) return []
  const out: SetupSuggestion[] = []
  const corners: Array<'lf' | 'rf' | 'lr' | 'rr'> = ['lf', 'rf', 'lr', 'rr']

  for (const c of corners) {
    const t = tyres[c]
    if (!t) continue
    const label = cornerLabel(c)
    const avg = avgTread(t)

    // Pressure from the tread profile: middle hotter than edges = over-inflated.
    if (typeof t.innerC === 'number' && typeof t.middleC === 'number' && typeof t.outerC === 'number') {
      const edges = (t.innerC + t.outerC) / 2
      const mid = t.middleC
      if (mid - edges >= cfg.pressureDeltaC) {
        out.push(
          suggestion('pressure-high', 'high',
            `${label}: center of the tire is much hotter than the edges - pressure is too high, reducing the contact patch. Lowering cold pressure will settle the tire.`,
            `Center ${Math.round(mid)} deg C vs edges ${Math.round(edges)} deg C (delta ${Math.round(mid - edges)} deg C)`,
            { area: 'tyres', direction: 'decrease', magnitude: 'small', change: `Lower ${label} cold tire pressure ~0.5-1.0 psi` },
            [{ area: 'tyres', direction: 'decrease', magnitude: 'medium', change: 'Repeat until the temperature profile is flat (center matches edges)' }],
            { middleC: Math.round(mid), edgesC: Math.round(edges), deltaC: Math.round(mid - edges) }, { corner: c })
        )
      } else if (edges - mid >= cfg.pressureDeltaC) {
        out.push(
          suggestion('pressure-low', 'high',
            `${label}: edges are hotter than the center - pressure is too low, so the tire rolls over and flexes. Raising cold pressure stabilizes the carcass.`,
            `Edges ${Math.round(edges)} deg C vs center ${Math.round(mid)} deg C (delta ${Math.round(edges - mid)} deg C)`,
            { area: 'tyres', direction: 'increase', magnitude: 'small', change: `Increase ${label} cold tire pressure ~0.5-1.0 psi` },
            [{ area: 'tyres', direction: 'increase', magnitude: 'medium', change: 'Repeat until the center matches the edges' }],
            { middleC: Math.round(mid), edgesC: Math.round(edges), deltaC: Math.round(edges - mid) }, { corner: c })
        )
      }

      // Camber from inner-vs-outer: inner much hotter = too much negative camber.
      if (t.innerC - t.outerC >= cfg.camberDeltaC) {
        out.push(
          suggestion('camber-excess', 'med',
            `${label}: inner edge is much hotter - too much negative camber for this track. Reducing camber spreads the temperature better.`,
            `Inner ${Math.round(t.innerC)} deg C vs outer ${Math.round(t.outerC)} deg C (delta ${Math.round(t.innerC - t.outerC)} deg C)`,
            { area: 'alignment', direction: 'decrease', magnitude: 'small', change: `Reduce negative camber on ${label} ~0.2-0.4 deg` },
            [{ area: 'tyres', direction: 'increase', magnitude: 'small', change: 'As a fallback, raise pressure slightly to heat the center' }],
            { innerC: Math.round(t.innerC), outerC: Math.round(t.outerC), deltaC: Math.round(t.innerC - t.outerC) }, { corner: c })
        )
      } else if (t.outerC - t.innerC >= cfg.camberDeltaC) {
        out.push(
          suggestion('camber-lack', 'med',
            `${label}: outer edge is much hotter - not enough negative camber, so the tire loads the outside edge in the corner. More camber widens the cornering footprint.`,
            `Outer ${Math.round(t.outerC)} deg C vs inner ${Math.round(t.innerC)} deg C (delta ${Math.round(t.outerC - t.innerC)} deg C)`,
            { area: 'alignment', direction: 'increase', magnitude: 'small', change: `Increase negative camber on ${label} ~0.2-0.4 deg` },
            [],
            { innerC: Math.round(t.innerC), outerC: Math.round(t.outerC), deltaC: Math.round(t.outerC - t.innerC) }, { corner: c })
        )
      }
    }

    // Absolute temperature window.
    if (avg !== undefined) {
      if (avg >= cfg.tempHighC + 8) {
        out.push(
          suggestion('tyre-overheat', 'med',
            `${label}: tire overheating (${Math.round(avg)} deg C), above the ideal window. Lower pressure, reduce aero load on that axle, or smooth your inputs so the rubber does not degrade.`,
            `Average ${Math.round(avg)} deg C (target ${cfg.tempLowC}-${cfg.tempHighC} deg C)`,
            { area: 'tyres', direction: 'decrease', magnitude: 'small', change: `Lower ${label} cold pressure and/or reduce load on that axle` },
            [{ area: 'aero', direction: 'decrease', magnitude: 'small', change: 'Slightly reduce wing/splitter on the affected axle' }],
            { avgC: Math.round(avg) }, { corner: c })
        )
      } else if (avg <= cfg.tempLowC - 8) {
        out.push(
          suggestion('tyre-cold', 'med',
            `${label}: tire is cold (${Math.round(avg)} deg C), below the ideal window - low grip and slow warmup. Raise pressure, add load to that axle, or consider a softer compound.`,
            `Average ${Math.round(avg)} deg C (target ${cfg.tempLowC}-${cfg.tempHighC} deg C)`,
            { area: 'tyres', direction: 'increase', magnitude: 'small', change: `Increase ${label} cold pressure to generate more heat` },
            [{ area: 'arb', direction: 'stiffen', magnitude: 'small', change: 'Move more load to that axle (bar/spring)' }],
            { avgC: Math.round(avg) }, { corner: c })
        )
      }
    }
  }

  // Left-vs-right axle imbalance (per axle).
  out.push(...axleImbalance('front', tyres.lf, tyres.rf, cfg))
  out.push(...axleImbalance('rear', tyres.lr, tyres.rr, cfg))

  return out
}

function axleImbalance(
  axle: 'front' | 'rear',
  left: TyreTreadTemps | undefined,
  right: TyreTreadTemps | undefined,
  cfg: SetupAdvisorConfig
): SetupSuggestion[] {
  if (!left || !right) return []
  const la = avgTread(left)
  const ra = avgTread(right)
  if (la === undefined || ra === undefined) return []
  const delta = la - ra
  if (Math.abs(delta) < cfg.lrDeltaC) return []
  const hotter = delta > 0 ? 'left' : 'right'
  const axleTxt = axle === 'front' ? 'front' : 'rear'
  return [
    suggestion('tyre-temp-imbalance-lr', 'low',
      `Axle ${axleTxt}: the ${hotter} side is much hotter - a typical L/R imbalance from tracks with more corners in one direction or from cross-weight/ride height. Check corner weights and cold pressures by side.`,
      `Delta ${Math.round(Math.abs(delta))} deg C between ${axleTxt} axle tires (L ${Math.round(la)} deg C / R ${Math.round(ra)} deg C)`,
      { area: 'ride-height', direction: 'adjust', magnitude: 'small', change: `Adjust cross-weight/ride height to balance the ${axleTxt} axle` },
      [{ area: 'tyres', direction: 'adjust', magnitude: 'small', change: `Equalize cold pressures on the ${axleTxt} axle to compensate for the hot side` }],
      { leftC: Math.round(la), rightC: Math.round(ra), deltaC: Math.round(Math.abs(delta)) }, { corner: axle })
  ]
}

const BALANCE_RULES: Record<
  string,
  { symptom: SetupSymptomKind; rationale: string; primary: SetupAdjustment; alternatives: SetupAdjustment[] }
> = {
  'understeer-entry': {
    symptom: 'understeer-entry',
    rationale: 'Entry understeer (the car will not turn while braking): not enough front support in the braking phase. Softening the front or moving brake bias rearward brings the nose back.',
    primary: { area: 'arb', direction: 'soften', magnitude: 'small', change: 'Soften the front anti-roll bar 1 click' },
    alternatives: [
      { area: 'brakes', direction: 'rearward', magnitude: 'small', change: 'Move brake bias ~1% rearward' },
      { area: 'springs', direction: 'soften', magnitude: 'small', change: 'Slightly soften the front springs' }
    ]
  },
  'understeer-mid': {
    symptom: 'understeer-mid',
    rationale: 'Mid-corner understeer (washing wide at the apex): not enough steady-state front grip. More front aero or a softer front increases bite.',
    primary: { area: 'aero', direction: 'increase', magnitude: 'small', change: 'Increase front wing/splitter 1 point' },
    alternatives: [
      { area: 'arb', direction: 'stiffen', magnitude: 'small', change: 'Stiffen the rear anti-roll bar 1 click' },
      { area: 'alignment', direction: 'increase', magnitude: 'small', change: 'Add a little front negative camber' }
    ]
  },
  'understeer-exit': {
    symptom: 'understeer-exit',
    rationale: 'Exit understeer (pushes on throttle): the differential locks too much under power and drags the front. Opening the power diff or softening the rear frees the nose.',
    primary: { area: 'differential', direction: 'decrease', magnitude: 'small', change: 'Reduce differential lock on acceleration (power ramp)' },
    alternatives: [
      { area: 'arb', direction: 'soften', magnitude: 'small', change: 'Soften the rear anti-roll bar 1 click' },
      { area: 'aero', direction: 'decrease', magnitude: 'small', change: 'Slightly reduce rear wing to free rotation' }
    ]
  },
  'oversteer-entry': {
    symptom: 'oversteer-entry',
    rationale: 'Entry oversteer (rear steps out on braking/lift): not enough rear stability on decel. More rear wing, a softer rear, or forward brake bias holds the rear.',
    primary: { area: 'arb', direction: 'soften', magnitude: 'small', change: 'Soften the rear anti-roll bar 1 click' },
    alternatives: [
      { area: 'aero', direction: 'increase', magnitude: 'small', change: 'Increase rear wing 1 point' },
      { area: 'brakes', direction: 'forward', magnitude: 'small', change: 'Move brake bias ~1% forward' }
    ]
  },
  'oversteer-mid': {
    symptom: 'oversteer-mid',
    rationale: 'Mid-corner oversteer (rear slides in steady-state): not enough rear grip under load. More rear wing or a softer rear stabilizes it.',
    primary: { area: 'aero', direction: 'increase', magnitude: 'small', change: 'Increase rear wing 1 point' },
    alternatives: [
      { area: 'arb', direction: 'soften', magnitude: 'small', change: 'Soften the rear anti-roll bar 1 click' },
      { area: 'arb', direction: 'stiffen', magnitude: 'small', change: 'Alternatively, stiffen the front anti-roll bar 1 click' }
    ]
  },
  'oversteer-exit': {
    symptom: 'oversteer-exit',
    rationale: 'Exit oversteer (rear steps out on throttle): not enough rear traction. More rear grip (wing/softer spring) and a less aggressive diff control the exit.',
    primary: { area: 'aero', direction: 'increase', magnitude: 'small', change: 'Increase rear wing 1 point for traction' },
    alternatives: [
      { area: 'arb', direction: 'soften', magnitude: 'small', change: 'Soften the rear anti-roll bar 1 click' },
      { area: 'differential', direction: 'decrease', magnitude: 'small', change: 'Reduce differential lock on acceleration' }
    ]
  }
}

/** PURE: turn per-phase balance signals into setup suggestions. */
export function adviseFromHandling(
  balance: SetupBalanceSignal[] | undefined,
  cfg: SetupAdvisorConfig = DEFAULT_SETUP_ADVISOR
): SetupSuggestion[] {
  if (!balance) return []
  const out: SetupSuggestion[] = []
  for (const sig of balance) {
    if (!Number.isFinite(sig.bias) || Math.abs(sig.bias) < cfg.balanceThreshold) continue
    const kind: SetupSymptomKind = `${sig.bias > 0 ? 'oversteer' : 'understeer'}-${sig.phase}` as SetupSymptomKind
    const rule = BALANCE_RULES[kind]
    if (!rule) continue
    const confidence: SetupConfidence = Math.abs(sig.bias) >= cfg.balanceStrong ? 'high' : 'med'
    out.push(
      suggestion(rule.symptom, confidence, rule.rationale,
        sig.evidence ?? `Trend is ${sig.bias > 0 ? 'oversteer' : 'understeer'} in the ${phaseLabel(sig.phase)} phase (bias ${sig.bias.toFixed(2)})`,
        rule.primary, rule.alternatives, { bias: Number(sig.bias.toFixed(2)) }, { phase: sig.phase })
    )
  }
  return out
}

function phaseLabel(phase: CoachPhase): string {
  return phase === 'entry' ? 'entry' : phase === 'mid' ? 'mid-corner' : 'exit'
}

/** PURE: optional brake-bias nudge from explicit lock symptoms. */
export function adviseFromBrakeBias(
  input: { frontLock?: boolean; rearLock?: boolean; brakeBiasPct?: number },
  _cfg: SetupAdvisorConfig = DEFAULT_SETUP_ADVISOR
): SetupSuggestion[] {
  const out: SetupSuggestion[] = []
  const biasTxt = input.brakeBiasPct !== undefined ? ` (current bias ${input.brakeBiasPct.toFixed(0)}% front)` : ''
  if (input.frontLock) {
    out.push(
      suggestion('brake-lock-front', 'med',
        `FRONT lockup under braking: too much front brake. Moving brake bias rearward balances braking${biasTxt}.`,
        `Front lock detected${biasTxt}`,
        { area: 'brakes', direction: 'rearward', magnitude: 'small', change: 'Move brake bias ~1-2% rearward' },
        [{ area: 'brakes', direction: 'decrease', magnitude: 'small', change: 'Slightly reduce maximum brake pressure' }],
        { brakeBiasPct: input.brakeBiasPct ?? 0 }, { corner: 'front' })
    )
  }
  if (input.rearLock) {
    out.push(
      suggestion('brake-lock-rear', 'med',
        `REAR lockup under braking (rear unstable on the brakes): too much rear brake. Moving brake bias forward stabilizes it${biasTxt}.`,
        `Rear lock detected${biasTxt}`,
        { area: 'brakes', direction: 'forward', magnitude: 'small', change: 'Move brake bias ~1-2% forward' },
        [{ area: 'aero', direction: 'increase', magnitude: 'small', change: 'More rear wing helps stabilize braking' }],
        { brakeBiasPct: input.brakeBiasPct ?? 0 }, { corner: 'rear' })
    )
  }
  return out
}

function confidenceRank(c: SetupConfidence): number {
  return c === 'high' ? 3 : c === 'med' ? 2 : 1
}

/** PURE: assemble the full setup report from all available signals. */
export function buildSetupReport(
  input: SetupAdvisorInput & { frontLock?: boolean; rearLock?: boolean },
  opts: { cfg?: SetupAdvisorConfig; now?: number } = {}
): SetupReport {
  const cfg = opts.cfg ?? DEFAULT_SETUP_ADVISOR
  const suggestions = [
    ...adviseFromHandling(input.balance, cfg),
    ...adviseFromTyres(input.tyres, cfg),
    ...adviseFromBrakeBias({ frontLock: input.frontLock, rearLock: input.rearLock, brakeBiasPct: input.brakeBiasPct }, cfg)
  ].sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence))
  return {
    generatedAt: opts.now ?? Date.now(),
    suggestions,
    summary: summarizeSetup(suggestions)
  }
}

function summarizeSetup(suggestions: SetupSuggestion[]): string {
  if (suggestions.length === 0) return 'No setup adjustments recommended with the current data - car is balanced and tires are in the window.'
  const top = suggestions[0]
  return `${suggestions.length} setup adjustment(s) suggested. Priority: ${top.primary.change.toLowerCase()} - ${shortSymptom(top.symptom)}.`
}

function shortSymptom(symptom: SetupSymptomKind): string {
  const map: Record<SetupSymptomKind, string> = {
    'understeer-entry': 'entry understeer',
    'understeer-mid': 'mid-corner understeer',
    'understeer-exit': 'exit understeer',
    'oversteer-entry': 'entry oversteer',
    'oversteer-mid': 'mid-corner oversteer',
    'oversteer-exit': 'exit oversteer',
    'tyre-overheat': 'overheating tire',
    'tyre-cold': 'cold tire',
    'tyre-temp-imbalance-lr': 'L/R imbalance',
    'camber-excess': 'too much camber',
    'camber-lack': 'not enough camber',
    'pressure-high': 'pressure high',
    'pressure-low': 'pressure low',
    'brake-lock-front': 'front lockup',
    'brake-lock-rear': 'rear lockup'
  }
  return map[symptom]
}
