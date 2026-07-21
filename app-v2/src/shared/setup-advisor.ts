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
import { formatMeasurement, psiToKpa, type UnitSystem } from './units'

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

export const SETUP_AREA_VALUES: readonly SetupArea[] = [
  'aero', 'arb', 'springs', 'dampers', 'differential', 'tyres', 'brakes', 'alignment', 'ride-height'
]
export const SETUP_DIRECTION_VALUES: readonly SetupDirection[] = [
  'increase', 'decrease', 'soften', 'stiffen', 'forward', 'rearward', 'adjust'
]
export const SETUP_MAGNITUDE_VALUES: readonly SetupMagnitude[] = ['small', 'medium', 'large']

export const SETUP_ADJUSTMENT_SPECS = {
  'tyre-pressure-decrease-cold': { area: 'tyres', direction: 'decrease', magnitude: 'small' },
  'tyre-pressure-decrease-repeat': { area: 'tyres', direction: 'decrease', magnitude: 'medium' },
  'tyre-pressure-increase-cold': { area: 'tyres', direction: 'increase', magnitude: 'small' },
  'tyre-pressure-increase-repeat': { area: 'tyres', direction: 'increase', magnitude: 'medium' },
  'camber-negative-decrease': { area: 'alignment', direction: 'decrease', magnitude: 'small' },
  'tyre-pressure-increase-camber-fallback': { area: 'tyres', direction: 'increase', magnitude: 'small' },
  'camber-negative-increase': { area: 'alignment', direction: 'increase', magnitude: 'small' },
  'tyre-pressure-decrease-overheat': { area: 'tyres', direction: 'decrease', magnitude: 'small' },
  'axle-aero-load-decrease': { area: 'aero', direction: 'decrease', magnitude: 'small' },
  'tyre-pressure-increase-heat': { area: 'tyres', direction: 'increase', magnitude: 'small' },
  'axle-load-increase': { area: 'arb', direction: 'stiffen', magnitude: 'small' },
  'cross-weight-adjust': { area: 'ride-height', direction: 'adjust', magnitude: 'small' },
  'axle-pressure-equalize': { area: 'tyres', direction: 'adjust', magnitude: 'small' },
  'front-arb-soften': { area: 'arb', direction: 'soften', magnitude: 'small' },
  'brake-bias-rearward': { area: 'brakes', direction: 'rearward', magnitude: 'small' },
  'front-springs-soften': { area: 'springs', direction: 'soften', magnitude: 'small' },
  'front-aero-increase': { area: 'aero', direction: 'increase', magnitude: 'small' },
  'rear-arb-stiffen': { area: 'arb', direction: 'stiffen', magnitude: 'small' },
  'front-camber-increase': { area: 'alignment', direction: 'increase', magnitude: 'small' },
  'power-diff-lock-decrease': { area: 'differential', direction: 'decrease', magnitude: 'small' },
  'rear-arb-soften': { area: 'arb', direction: 'soften', magnitude: 'small' },
  'rear-aero-decrease': { area: 'aero', direction: 'decrease', magnitude: 'small' },
  'rear-aero-increase': { area: 'aero', direction: 'increase', magnitude: 'small' },
  'brake-bias-forward': { area: 'brakes', direction: 'forward', magnitude: 'small' },
  'front-arb-stiffen': { area: 'arb', direction: 'stiffen', magnitude: 'small' },
  'brake-pressure-decrease': { area: 'brakes', direction: 'decrease', magnitude: 'small' }
} as const satisfies Record<string, {
  area: SetupArea
  direction: SetupDirection
  magnitude: SetupMagnitude
}>

export type SetupAdjustmentCode = keyof typeof SETUP_ADJUSTMENT_SPECS
export const SETUP_ADJUSTMENT_CODES = Object.freeze(
  Object.keys(SETUP_ADJUSTMENT_SPECS) as SetupAdjustmentCode[]
)

export interface SetupAdjustment {
  /** Stable structured instruction code. Legacy archives may not contain one. */
  code?: SetupAdjustmentCode
  area: SetupArea
  direction: SetupDirection
  magnitude: SetupMagnitude
  /** Legacy/internal prose. Persisted UI must localize from code + metrics instead. */
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

export const SETUP_SYMPTOM_VALUES: readonly SetupSymptomKind[] = [
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
]
export const SETUP_CORNER_VALUES: readonly SetupCorner[] = [
  'lf', 'rf', 'lr', 'rr', 'front', 'rear', 'left', 'right', 'all'
]
export const SETUP_PHASE_VALUES: readonly CoachPhase[] = ['entry', 'mid', 'exit']

export const SETUP_SUGGESTION_ADJUSTMENT_CODES: Record<
  SetupSymptomKind,
  { primary: readonly SetupAdjustmentCode[]; alternatives: readonly SetupAdjustmentCode[] }
> = {
  'understeer-entry': {
    primary: ['front-arb-soften'],
    alternatives: ['brake-bias-rearward', 'front-springs-soften']
  },
  'understeer-mid': {
    primary: ['front-aero-increase'],
    alternatives: ['rear-arb-stiffen', 'front-camber-increase']
  },
  'understeer-exit': {
    primary: ['power-diff-lock-decrease'],
    alternatives: ['rear-arb-soften', 'rear-aero-decrease']
  },
  'oversteer-entry': {
    primary: ['rear-arb-soften'],
    alternatives: ['rear-aero-increase', 'brake-bias-forward']
  },
  'oversteer-mid': {
    primary: ['rear-aero-increase'],
    alternatives: ['rear-arb-soften', 'front-arb-stiffen']
  },
  'oversteer-exit': {
    primary: ['rear-aero-increase'],
    alternatives: ['rear-arb-soften', 'power-diff-lock-decrease']
  },
  'tyre-overheat': {
    primary: ['tyre-pressure-decrease-overheat'],
    alternatives: ['axle-aero-load-decrease']
  },
  'tyre-cold': {
    primary: ['tyre-pressure-increase-heat'],
    alternatives: ['axle-load-increase']
  },
  'tyre-temp-imbalance-lr': {
    primary: ['cross-weight-adjust'],
    alternatives: ['axle-pressure-equalize']
  },
  'camber-excess': {
    primary: ['camber-negative-decrease'],
    alternatives: ['tyre-pressure-increase-camber-fallback']
  },
  'camber-lack': {
    primary: ['camber-negative-increase'],
    alternatives: []
  },
  'pressure-high': {
    primary: ['tyre-pressure-decrease-cold'],
    alternatives: ['tyre-pressure-decrease-repeat']
  },
  'pressure-low': {
    primary: ['tyre-pressure-increase-cold'],
    alternatives: ['tyre-pressure-increase-repeat']
  },
  'brake-lock-front': {
    primary: ['brake-bias-rearward'],
    alternatives: ['brake-pressure-decrease']
  },
  'brake-lock-rear': {
    primary: ['brake-bias-forward'],
    alternatives: ['rear-aero-increase']
  }
}

export interface SetupSuggestion {
  id: string
  symptom: SetupSymptomKind
  phase?: CoachPhase
  corner?: SetupCorner
  confidence: SetupConfidence
  /** Legacy/internal prose; persisted UI localizes from symptom + metrics. */
  rationale: string
  /** Legacy/internal prose; persisted UI localizes measured metrics instead. */
  evidence: string
  primary: SetupAdjustment
  alternatives: SetupAdjustment[]
  metrics: Record<string, number>
}

export interface SetupReport {
  generatedAt: number
  suggestions: SetupSuggestion[]
  /** Legacy/internal headline; persisted UI does not render it. */
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
function adjustment(code: SetupAdjustmentCode, change: string): SetupAdjustment {
  return { code, ...SETUP_ADJUSTMENT_SPECS[code], change }
}

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

function tempText(valueC: number, unitSystem: UnitSystem): string {
  return formatMeasurement(valueC, 'temperature-c', unitSystem, { decimals: 0, includeUnit: true }).display
}

function tempDeltaText(deltaC: number, unitSystem: UnitSystem): string {
  const value = unitSystem === 'imperial' ? deltaC * 9 / 5 : deltaC
  return `${Math.round(value)} ${unitSystem === 'imperial' ? '°F' : '°C'}`
}

function tempRangeText(lowC: number, highC: number, unitSystem: UnitSystem): string {
  const low = formatMeasurement(lowC, 'temperature-c', unitSystem, { decimals: 0 })
  const high = formatMeasurement(highC, 'temperature-c', unitSystem, { decimals: 0 })
  return `${low.display}-${high.display} ${low.unit}`
}

function pressureAdjustmentText(unitSystem: UnitSystem): string {
  const low = formatMeasurement(psiToKpa(0.5), 'pressure-kpa', unitSystem, { decimals: 1 })
  const high = formatMeasurement(psiToKpa(1), 'pressure-kpa', unitSystem, { decimals: 1 })
  return `${low.display}-${high.display} ${low.unit}`
}

/** PURE: tyre-temperature + pressure + camber advice for the four corners. */
export function adviseFromTyres(
  tyres: CornerTyres | undefined,
  cfg: SetupAdvisorConfig = DEFAULT_SETUP_ADVISOR,
  unitSystem: UnitSystem = 'metric'
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
            `Center ${tempText(mid, unitSystem)} vs edges ${tempText(edges, unitSystem)} (delta ${tempDeltaText(mid - edges, unitSystem)})`,
            adjustment('tyre-pressure-decrease-cold', `Lower ${label} cold tire pressure ~${pressureAdjustmentText(unitSystem)}`),
            [adjustment('tyre-pressure-decrease-repeat', 'Repeat until the temperature profile is flat (center matches edges)')],
            { middleC: Math.round(mid), edgesC: Math.round(edges), deltaC: Math.round(mid - edges) }, { corner: c })
        )
      } else if (edges - mid >= cfg.pressureDeltaC) {
        out.push(
          suggestion('pressure-low', 'high',
            `${label}: edges are hotter than the center - pressure is too low, so the tire rolls over and flexes. Raising cold pressure stabilizes the carcass.`,
            `Edges ${tempText(edges, unitSystem)} vs center ${tempText(mid, unitSystem)} (delta ${tempDeltaText(edges - mid, unitSystem)})`,
            adjustment('tyre-pressure-increase-cold', `Increase ${label} cold tire pressure ~${pressureAdjustmentText(unitSystem)}`),
            [adjustment('tyre-pressure-increase-repeat', 'Repeat until the center matches the edges')],
            { middleC: Math.round(mid), edgesC: Math.round(edges), deltaC: Math.round(edges - mid) }, { corner: c })
        )
      }

      // Camber from inner-vs-outer: inner much hotter = too much negative camber.
      if (t.innerC - t.outerC >= cfg.camberDeltaC) {
        out.push(
          suggestion('camber-excess', 'med',
            `${label}: inner edge is much hotter - too much negative camber for this track. Reducing camber spreads the temperature better.`,
            `Inner ${tempText(t.innerC, unitSystem)} vs outer ${tempText(t.outerC, unitSystem)} (delta ${tempDeltaText(t.innerC - t.outerC, unitSystem)})`,
            adjustment('camber-negative-decrease', `Reduce negative camber on ${label} ~0.2-0.4 deg`),
            [adjustment('tyre-pressure-increase-camber-fallback', 'As a fallback, raise pressure slightly to heat the center')],
            { innerC: Math.round(t.innerC), outerC: Math.round(t.outerC), deltaC: Math.round(t.innerC - t.outerC) }, { corner: c })
        )
      } else if (t.outerC - t.innerC >= cfg.camberDeltaC) {
        out.push(
          suggestion('camber-lack', 'med',
            `${label}: outer edge is much hotter - not enough negative camber, so the tire loads the outside edge in the corner. More camber widens the cornering footprint.`,
            `Outer ${tempText(t.outerC, unitSystem)} vs inner ${tempText(t.innerC, unitSystem)} (delta ${tempDeltaText(t.outerC - t.innerC, unitSystem)})`,
            adjustment('camber-negative-increase', `Increase negative camber on ${label} ~0.2-0.4 deg`),
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
            `${label}: tire overheating (${tempText(avg, unitSystem)}), above the ideal window. Lower pressure, reduce aero load on that axle, or smooth your inputs so the rubber does not degrade.`,
            `Average ${tempText(avg, unitSystem)} (target ${tempRangeText(cfg.tempLowC, cfg.tempHighC, unitSystem)})`,
            adjustment('tyre-pressure-decrease-overheat', `Lower ${label} cold pressure and/or reduce load on that axle`),
            [adjustment('axle-aero-load-decrease', 'Slightly reduce wing/splitter on the affected axle')],
            { avgC: Math.round(avg) }, { corner: c })
        )
      } else if (avg <= cfg.tempLowC - 8) {
        out.push(
          suggestion('tyre-cold', 'med',
            `${label}: tire is cold (${tempText(avg, unitSystem)}), below the ideal window - low grip and slow warmup. Raise pressure, add load to that axle, or consider a softer compound.`,
            `Average ${tempText(avg, unitSystem)} (target ${tempRangeText(cfg.tempLowC, cfg.tempHighC, unitSystem)})`,
            adjustment('tyre-pressure-increase-heat', `Increase ${label} cold pressure to generate more heat`),
            [adjustment('axle-load-increase', 'Move more load to that axle (bar/spring)')],
            { avgC: Math.round(avg) }, { corner: c })
        )
      }
    }
  }

  // Left-vs-right axle imbalance (per axle).
  out.push(...axleImbalance('front', tyres.lf, tyres.rf, cfg, unitSystem))
  out.push(...axleImbalance('rear', tyres.lr, tyres.rr, cfg, unitSystem))

  return out
}

function axleImbalance(
  axle: 'front' | 'rear',
  left: TyreTreadTemps | undefined,
  right: TyreTreadTemps | undefined,
  cfg: SetupAdvisorConfig,
  unitSystem: UnitSystem
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
      `Delta ${tempDeltaText(Math.abs(delta), unitSystem)} between ${axleTxt} axle tires (L ${tempText(la, unitSystem)} / R ${tempText(ra, unitSystem)})`,
      adjustment('cross-weight-adjust', `Adjust cross-weight/ride height to balance the ${axleTxt} axle`),
      [adjustment('axle-pressure-equalize', `Equalize cold pressures on the ${axleTxt} axle to compensate for the hot side`)],
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
    primary: adjustment('front-arb-soften', 'Soften the front anti-roll bar 1 click'),
    alternatives: [
      adjustment('brake-bias-rearward', 'Move brake bias ~1% rearward'),
      adjustment('front-springs-soften', 'Slightly soften the front springs')
    ]
  },
  'understeer-mid': {
    symptom: 'understeer-mid',
    rationale: 'Mid-corner understeer (washing wide at the apex): not enough steady-state front grip. More front aero or a softer front increases bite.',
    primary: adjustment('front-aero-increase', 'Increase front wing/splitter 1 point'),
    alternatives: [
      adjustment('rear-arb-stiffen', 'Stiffen the rear anti-roll bar 1 click'),
      adjustment('front-camber-increase', 'Add a little front negative camber')
    ]
  },
  'understeer-exit': {
    symptom: 'understeer-exit',
    rationale: 'Exit understeer (pushes on throttle): the differential locks too much under power and drags the front. Opening the power diff or softening the rear frees the nose.',
    primary: adjustment('power-diff-lock-decrease', 'Reduce differential lock on acceleration (power ramp)'),
    alternatives: [
      adjustment('rear-arb-soften', 'Soften the rear anti-roll bar 1 click'),
      adjustment('rear-aero-decrease', 'Slightly reduce rear wing to free rotation')
    ]
  },
  'oversteer-entry': {
    symptom: 'oversteer-entry',
    rationale: 'Entry oversteer (rear steps out on braking/lift): not enough rear stability on decel. More rear wing, a softer rear, or forward brake bias holds the rear.',
    primary: adjustment('rear-arb-soften', 'Soften the rear anti-roll bar 1 click'),
    alternatives: [
      adjustment('rear-aero-increase', 'Increase rear wing 1 point'),
      adjustment('brake-bias-forward', 'Move brake bias ~1% forward')
    ]
  },
  'oversteer-mid': {
    symptom: 'oversteer-mid',
    rationale: 'Mid-corner oversteer (rear slides in steady-state): not enough rear grip under load. More rear wing or a softer rear stabilizes it.',
    primary: adjustment('rear-aero-increase', 'Increase rear wing 1 point'),
    alternatives: [
      adjustment('rear-arb-soften', 'Soften the rear anti-roll bar 1 click'),
      adjustment('front-arb-stiffen', 'Alternatively, stiffen the front anti-roll bar 1 click')
    ]
  },
  'oversteer-exit': {
    symptom: 'oversteer-exit',
    rationale: 'Exit oversteer (rear steps out on throttle): not enough rear traction. More rear grip (wing/softer spring) and a less aggressive diff control the exit.',
    primary: adjustment('rear-aero-increase', 'Increase rear wing 1 point for traction'),
    alternatives: [
      adjustment('rear-arb-soften', 'Soften the rear anti-roll bar 1 click'),
      adjustment('power-diff-lock-decrease', 'Reduce differential lock on acceleration')
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
        adjustment('brake-bias-rearward', 'Move brake bias ~1-2% rearward'),
        [adjustment('brake-pressure-decrease', 'Slightly reduce maximum brake pressure')],
        {
          lockSignal: 1,
          ...(input.brakeBiasPct !== undefined ? { brakeBiasPct: input.brakeBiasPct } : {})
        }, { corner: 'front' })
    )
  }
  if (input.rearLock) {
    out.push(
      suggestion('brake-lock-rear', 'med',
        `REAR lockup under braking (rear unstable on the brakes): too much rear brake. Moving brake bias forward stabilizes it${biasTxt}.`,
        `Rear lock detected${biasTxt}`,
        adjustment('brake-bias-forward', 'Move brake bias ~1-2% forward'),
        [adjustment('rear-aero-increase', 'More rear wing helps stabilize braking')],
        {
          lockSignal: 1,
          ...(input.brakeBiasPct !== undefined ? { brakeBiasPct: input.brakeBiasPct } : {})
        }, { corner: 'rear' })
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
  opts: { cfg?: SetupAdvisorConfig; now?: number; unitSystem?: UnitSystem } = {}
): SetupReport {
  const cfg = opts.cfg ?? DEFAULT_SETUP_ADVISOR
  const suggestions = [
    ...adviseFromHandling(input.balance, cfg),
    ...adviseFromTyres(input.tyres, cfg, opts.unitSystem ?? 'metric'),
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
