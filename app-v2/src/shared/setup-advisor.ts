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
            `${label}: o centro do tire está bem mais quente que as bordas — pressão high demais, reduzindo a área de contato. Baixar a pressão fria assenta o tire.`,
            `Centro ${Math.round(mid)}°C vs bordas ${Math.round(edges)}°C (Δ ${Math.round(mid - edges)}°C)`,
            { area: 'tyres', direction: 'decrease', magnitude: 'small', change: `Reduza a pressão fria do tire ${label} ~0.5–1.0 psi` },
            [{ area: 'tyres', direction: 'decrease', magnitude: 'medium', change: 'Repita até o profile de temperatura ficar plano (centro ≈ bordas)' }],
            { middleC: Math.round(mid), edgesC: Math.round(edges), deltaC: Math.round(mid - edges) }, { corner: c })
        )
      } else if (edges - mid >= cfg.pressureDeltaC) {
        out.push(
          suggestion('pressure-low', 'high',
            `${label}: as bordas estão mais quentes que o centro — pressão baixa demais, o tire "enruga" e flexiona. Subir a pressão fria estabiliza a carcaça.`,
            `Bordas ${Math.round(edges)}°C vs centro ${Math.round(mid)}°C (Δ ${Math.round(edges - mid)}°C)`,
            { area: 'tyres', direction: 'increase', magnitude: 'small', change: `Aumente a pressão fria do tire ${label} ~0.5–1.0 psi` },
            [{ area: 'tyres', direction: 'increase', magnitude: 'medium', change: 'Repita até o centro acompanhar as bordas' }],
            { middleC: Math.round(mid), edgesC: Math.round(edges), deltaC: Math.round(edges - mid) }, { corner: c })
        )
      }

      // Camber from inner-vs-outer: inner much hotter = too much negative camber.
      if (t.innerC - t.outerC >= cfg.camberDeltaC) {
        out.push(
          suggestion('camber-excess', 'med',
            `${label}: a borda interna está bem mais quente — camber negativo em excesso para este traçado. Reduzir o camber distribui melhor a temperatura.`,
            `Interna ${Math.round(t.innerC)}°C vs externa ${Math.round(t.outerC)}°C (Δ ${Math.round(t.innerC - t.outerC)}°C)`,
            { area: 'alignment', direction: 'decrease', magnitude: 'small', change: `Reduza o camber negativo do ${label} ~0.2–0.4°` },
            [{ area: 'tyres', direction: 'increase', magnitude: 'small', change: 'Como paliativo, suba ligeiramente a pressão para aquecer o centro' }],
            { innerC: Math.round(t.innerC), outerC: Math.round(t.outerC), deltaC: Math.round(t.innerC - t.outerC) }, { corner: c })
        )
      } else if (t.outerC - t.innerC >= cfg.camberDeltaC) {
        out.push(
          suggestion('camber-lack', 'med',
            `${label}: a borda externa está bem mais quente — fhigh camber negativo, o tire apoia na borda de fora ao curvar. Mais camber alarga a pegada em curva.`,
            `Externa ${Math.round(t.outerC)}°C vs interna ${Math.round(t.innerC)}°C (Δ ${Math.round(t.outerC - t.innerC)}°C)`,
            { area: 'alignment', direction: 'increase', magnitude: 'small', change: `Aumente o camber negativo do ${label} ~0.2–0.4°` },
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
            `${label}: tire superaquecendo (${Math.round(avg)}°C), acima da janela ideal. Baixe a pressão, reduza carga aerodinâmica nesse eixo ou suavize os inputs para a borracha não degradar.`,
            `Média ${Math.round(avg)}°C (alvo ${cfg.tempLowC}–${cfg.tempHighC}°C)`,
            { area: 'tyres', direction: 'decrease', magnitude: 'small', change: `Reduza a pressão fria do ${label} e/ou alivie a carga desse eixo` },
            [{ area: 'aero', direction: 'decrease', magnitude: 'small', change: 'Reduza levemente a asa/splitter do eixo afetado' }],
            { avgC: Math.round(avg) }, { corner: c })
        )
      } else if (avg <= cfg.tempLowC - 8) {
        out.push(
          suggestion('tyre-cold', 'med',
            `${label}: tire frio (${Math.round(avg)}°C), abaixo da janela ideal — pouca aderência e aquecimento lento. Suba a pressão, aumente a carga nesse eixo ou avalie composto mais macio.`,
            `Média ${Math.round(avg)}°C (alvo ${cfg.tempLowC}–${cfg.tempHighC}°C)`,
            { area: 'tyres', direction: 'increase', magnitude: 'small', change: `Aumente a pressão fria do ${label} para gerar mais calor` },
            [{ area: 'arb', direction: 'stiffen', magnitude: 'small', change: 'Transfira mais carga para esse eixo (barra/mola)' }],
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
  const hotter = delta > 0 ? 'esquerdo' : 'direito'
  const axleTxt = axle === 'front' ? 'dianteiro' : 'traseiro'
  return [
    suggestion('tyre-temp-imbalance-lr', 'low',
      `Eixo ${axleTxt}: o lado ${hotter} está bem mais quente — desequilíbrio L/R típico de pista com mais curvas para um lado ou de cross-weight/altura. Cheque corner weights e pressões frias por lado.`,
      `Δ ${Math.round(Math.abs(delta))}°C entre os tires ${axleTxt}s (esq ${Math.round(la)}°C / dir ${Math.round(ra)}°C)`,
      { area: 'ride-height', direction: 'adjust', magnitude: 'small', change: `Ajuste cross-weight/altura para equilibrar o eixo ${axleTxt}` },
      [{ area: 'tyres', direction: 'adjust', magnitude: 'small', change: `Iguale as pressões frias do eixo ${axleTxt} compensando o lado quente` }],
      { leftC: Math.round(la), rightC: Math.round(ra), deltaC: Math.round(Math.abs(delta)) }, { corner: axle })
  ]
}

const BALANCE_RULES: Record<
  string,
  { symptom: SetupSymptomKind; rationale: string; primary: SetupAdjustment; alternatives: SetupAdjustment[] }
> = {
  'understeer-entry': {
    symptom: 'understeer-entry',
    rationale: 'Subesterço na ENTRADA (o carro não vira ao frear): fhigh apoio dianteiro na fase de brake. Amaciar a frente ou levar o brake mais para trás recupera o bico.',
    primary: { area: 'arb', direction: 'soften', magnitude: 'small', change: 'Amacie a barra estabilizadora dianteira 1 click' },
    alternatives: [
      { area: 'brakes', direction: 'rearward', magnitude: 'small', change: 'Mova o brake bias ~1% para trás' },
      { area: 'springs', direction: 'soften', magnitude: 'small', change: 'Amacie levemente as molas dianteiras' }
    ]
  },
  'understeer-mid': {
    symptom: 'understeer-mid',
    rationale: 'Subesterço no MEIO da curva (lava reto no ápice): fhigh aderência dianteira em regime. Mais asa dianteira ou frente mais macia aumenta a mordida.',
    primary: { area: 'aero', direction: 'increase', magnitude: 'small', change: 'Aumente a asa/splitter dianteira 1 ponto' },
    alternatives: [
      { area: 'arb', direction: 'stiffen', magnitude: 'small', change: 'Enrijeça a barra traseira 1 click' },
      { area: 'alignment', direction: 'increase', magnitude: 'small', change: 'Adicione um pouco de camber negativo dianteiro' }
    ]
  },
  'understeer-exit': {
    symptom: 'understeer-exit',
    rationale: 'Subesterço na SAÍDA (empurra ao acelerar): o diferencial trava demais sob potência e arrasta a frente. Abrir o diff na potência ou amaciar a traseira solta o bico.',
    primary: { area: 'differential', direction: 'decrease', magnitude: 'small', change: 'Reduza o bloqueio do diferencial na aceleração (power ramp)' },
    alternatives: [
      { area: 'arb', direction: 'soften', magnitude: 'small', change: 'Amacie a barra traseira 1 click' },
      { area: 'aero', direction: 'decrease', magnitude: 'small', change: 'Reduza levemente a asa traseira para liberar rotação' }
    ]
  },
  'oversteer-entry': {
    symptom: 'oversteer-entry',
    rationale: 'Sobresterço na ENTRADA (traseira solta ao frear/aliviar): fhigh estabilidade traseira na desaceleração. Mais asa traseira, traseira mais macia ou brake à frente seguram a cauda.',
    primary: { area: 'arb', direction: 'soften', magnitude: 'small', change: 'Amacie a barra estabilizadora traseira 1 click' },
    alternatives: [
      { area: 'aero', direction: 'increase', magnitude: 'small', change: 'Aumente a asa traseira 1 ponto' },
      { area: 'brakes', direction: 'forward', magnitude: 'small', change: 'Mova o brake bias ~1% para frente' }
    ]
  },
  'oversteer-mid': {
    symptom: 'oversteer-mid',
    rationale: 'Sobresterço no MEIO da curva (traseira escorrega em regime): fhigh aderência traseira em apoio. Mais asa traseira ou traseira mais macia estabiliza.',
    primary: { area: 'aero', direction: 'increase', magnitude: 'small', change: 'Aumente a asa traseira 1 ponto' },
    alternatives: [
      { area: 'arb', direction: 'soften', magnitude: 'small', change: 'Amacie a barra traseira 1 click' },
      { area: 'arb', direction: 'stiffen', magnitude: 'small', change: 'Como alternativa, enrijeça a barra dianteira 1 click' }
    ]
  },
  'oversteer-exit': {
    symptom: 'oversteer-exit',
    rationale: 'Sobresterço na SAÍDA (traseira sai de roda livre ao acelerar): tração traseira insuficiente. Mais aderência traseira (asa/mola macia) e diff menos agressivo controlam a saída.',
    primary: { area: 'aero', direction: 'increase', magnitude: 'small', change: 'Aumente a asa traseira 1 ponto para tração' },
    alternatives: [
      { area: 'arb', direction: 'soften', magnitude: 'small', change: 'Amacie a barra traseira 1 click' },
      { area: 'differential', direction: 'decrease', magnitude: 'small', change: 'Reduza o bloqueio do diff na aceleração' }
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
        sig.evidence ?? `Tendência ${sig.bias > 0 ? 'sobresterçante' : 'subesterçante'} na fase de ${phaseLabel(sig.phase)} (bias ${sig.bias.toFixed(2)})`,
        rule.primary, rule.alternatives, { bias: Number(sig.bias.toFixed(2)) }, { phase: sig.phase })
    )
  }
  return out
}

function phaseLabel(phase: CoachPhase): string {
  return phase === 'entry' ? 'entrada' : phase === 'mid' ? 'meio de curva' : 'saída'
}

/** PURE: optional brake-bias nudge from explicit lock symptoms. */
export function adviseFromBrakeBias(
  input: { frontLock?: boolean; rearLock?: boolean; brakeBiasPct?: number },
  _cfg: SetupAdvisorConfig = DEFAULT_SETUP_ADVISOR
): SetupSuggestion[] {
  const out: SetupSuggestion[] = []
  const biasTxt = input.brakeBiasPct !== undefined ? ` (bias atual ${input.brakeBiasPct.toFixed(0)}% frente)` : ''
  if (input.frontLock) {
    out.push(
      suggestion('brake-lock-front', 'med',
        `Travamento DIANTEIRO na freada: peso demais no brake da frente. Levar o brake bias para trás equilibra a frenagem${biasTxt}.`,
        `Trava dianteira detectada${biasTxt}`,
        { area: 'brakes', direction: 'rearward', magnitude: 'small', change: 'Mova o brake bias ~1–2% para trás' },
        [{ area: 'brakes', direction: 'decrease', magnitude: 'small', change: 'Reduza levemente a pressão máxima de brake' }],
        { brakeBiasPct: input.brakeBiasPct ?? 0 }, { corner: 'front' })
    )
  }
  if (input.rearLock) {
    out.push(
      suggestion('brake-lock-rear', 'med',
        `Travamento TRASEIRO na freada (traseira instável ao frear): brake traseiro demais. Levar o brake bias para frente estabiliza${biasTxt}.`,
        `Trava traseira detectada${biasTxt}`,
        { area: 'brakes', direction: 'forward', magnitude: 'small', change: 'Mova o brake bias ~1–2% para frente' },
        [{ area: 'aero', direction: 'increase', magnitude: 'small', change: 'Mais asa traseira ajuda a estabilizar a freada' }],
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
  if (suggestions.length === 0) return 'Nenhum ajuste de setup recomendado com os dados atuais — carro equilibrado e tires na janela.'
  const top = suggestions[0]
  return `${suggestions.length} ajuste(s) sugerido(s). Prioridade: ${top.primary.change.toLowerCase()} — ${shortSymptom(top.symptom)}.`
}

function shortSymptom(symptom: SetupSymptomKind): string {
  const map: Record<SetupSymptomKind, string> = {
    'understeer-entry': 'subesterço de entrada',
    'understeer-mid': 'subesterço de meio',
    'understeer-exit': 'subesterço de saída',
    'oversteer-entry': 'sobresterço de entrada',
    'oversteer-mid': 'sobresterço de meio',
    'oversteer-exit': 'sobresterço de saída',
    'tyre-overheat': 'tire superaquecendo',
    'tyre-cold': 'tire frio',
    'tyre-temp-imbalance-lr': 'desequilíbrio L/R',
    'camber-excess': 'camber em excesso',
    'camber-lack': 'fhigh de camber',
    'pressure-high': 'pressão high',
    'pressure-low': 'pressão baixa',
    'brake-lock-front': 'trava dianteira',
    'brake-lock-rear': 'trava traseira'
  }
  return map[symptom]
}
