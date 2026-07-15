// Deterministic Intent Router.
//
// `routeIntent(text, ctx)` answers common PT-BR + EN race-engineer questions and
// voice commands WITHOUT touching the LLM. It returns one of:
//   - { type: 'answer' }      → a ready spoken string built from the live engines
//   - { type: 'command' }     → a structured action for the orchestrator to run
//   - { type: 'passthrough' } → nothing matched; fall through to the LLM
//
// Matching is accent-insensitive and synonym-aware but intentionally simple and
// fully unit-testable. No node-llama-cpp, no Electron.

import type {
  EngineerContext,
  IntentAnswer,
  IntentCategory,
  IntentCommand,
  IntentCommandKind,
  IntentLang,
  IntentResult
} from '../../shared/ai-engineer'
import {
  computePitRecommendation,
  deriveFuel,
  deriveGaps,
  derivePosition,
  deriveTiming,
  deriveTyres,
  deriveWeather,
  formatLapTime,
  formatSignedSec,
  isFiniteNum,
  isPositive
} from './context-pack'
import { formatMeasurement, type UnitSystem } from '../../shared/units'

// ─── text normalization ──────────────────────────────────────────────────────

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9\s?-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Whole-word presence test (so "ativa" does NOT match inside "desativa"). */
function hasWord(text: string, ...words: string[]): boolean {
  return words.some((w) => new RegExp(`(^|\\s)${w.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(\\s|$|\\?)`).test(text))
}

/** Substring presence (for multi-word phrases / stems). */
function has(text: string, ...subs: string[]): boolean {
  return subs.some((s) => text.includes(s))
}

const PT_MARKERS = [
  'fuel', 'gasolina', 'tanque', 'boxes', 'frente', 'atras', 'traseira', 'posicao', 'lugar',
  'colocado', 'tire', 'tires', 'borracha', 'rain', 'chovendo', 'weather', 'lap', 'laps', 'proximo',
  'anterior', 'salvar', 'salva', 'marcar', 'marca', 'resetar', 'reseta', 'ativar', 'ativa', 'desativar',
  'desativa', 'quanto', 'devo', 'preciso', 'consigo', 'terminar', 'meu', 'minha', 'qual', 'agora', 'pace'
]
const EN_MARKERS = [
  'fuel', 'tank', 'pit', 'ahead', 'behind', 'front', 'position', 'standing', 'tyre', 'tyres', 'tire',
  'tires', 'rain', 'raining', 'weather', 'wet', 'dry', 'lap', 'next', 'previous', 'save', 'mark', 'reset',
  'enable', 'disable', 'should', 'how', 'pace', 'finish'
]

function detectLang(text: string): IntentLang {
  let pt = 0
  let en = 0
  for (const w of PT_MARKERS) if (hasWord(text, w)) pt += 1
  for (const w of EN_MARKERS) if (hasWord(text, w)) en += 1
  return en >= pt ? 'en' : 'pt'
}

// ─── token groups ────────────────────────────────────────────────────────────

const DASH_NOUNS = ['dashboard', 'dash', 'painel', 'tela', 'hud']
const NEXT_TOKENS = ['proximo', 'next', 'avancar', 'avanca', 'seguinte', 'frente', 'adiante', 'passa', 'passar']
const PREV_TOKENS = ['anterior', 'previous', 'prev', 'lapr', 'lap', 'atras', 'retrocede']

// ─── public entry ────────────────────────────────────────────────────────────

export function routeIntent(rawText: string, ctx: EngineerContext, forcedLang?: IntentLang, unitSystem: UnitSystem = 'metric'): IntentResult {
  const text = normalize(rawText ?? '')
  if (!text) return { type: 'passthrough', reason: 'empty' }
  const lang = forcedLang ?? detectLang(text)

  return (
    matchCommand(text, lang) ??
    matchQuestion(text, lang, ctx, unitSystem) ?? { type: 'passthrough' }
  )
}

// ─── command matching ────────────────────────────────────────────────────────

function command(kind: IntentCommandKind, lang: IntentLang, speakPt: string, speakEn: string, actionHint?: string, args?: Record<string, unknown>): IntentCommand {
  return { type: 'command', kind, lang, speak: lang === 'en' ? speakEn : speakPt, actionHint, args }
}

function matchCommand(text: string, lang: IntentLang): IntentCommand | null {
  // Dashboard cycling
  if (DASH_NOUNS.some((n) => has(text, n))) {
    if (PREV_TOKENS.some((t) => hasWord(text, t))) {
      return command('dashboard.prev', lang, 'Dashboard anterior.', 'Previous dashboard.', 'dash:cyclePrev')
    }
    if (NEXT_TOKENS.some((t) => hasWord(text, t))) {
      return command('dashboard.next', lang, 'Próximo dashboard.', 'Next dashboard.', 'dash:cycleNext')
    }
  }

  // Save setup
  if (hasWord(text, 'salvar', 'salva', 'guardar', 'grava', 'gravar', 'save') && has(text, 'setup', 'config', 'ajuste')) {
    return command('setup.save', lang, 'Salvando o setup.', 'Saving the setup.', 'setups:save')
  }

  // Mark / flag the current lap
  if (hasWord(text, 'marcar', 'marca', 'marque', 'mark', 'flag', 'flagging') && has(text, 'lap', 'lap')) {
    return command('lap.mark', lang, 'Volta marcada.', 'Lap marked.', 'lap:mark')
  }

  // Reset fuel calculation
  if (hasWord(text, 'resetar', 'reseta', 'resete', 'zerar', 'zera', 'reset', 'limpar', 'limpa') && has(text, 'fuel', 'fuel', 'gasolina', 'tanque')) {
    return command('fuel.reset', lang, 'Cálculo de combustível reiniciado.', 'Fuel calculation reset.', 'fuel:reset')
  }

  // Rev-lights toggle — check DISABLE before ENABLE.
  const revNoun = has(text, 'revlight', 'rev light', 'rev-light', 'shift light', 'shift-light', 'shiftlight', 'rpm light', 'luzes de rpm', 'luz de rpm') || hasWord(text, 'revlights')
  if (revNoun) {
    if (hasWord(text, 'desativar', 'desativa', 'desative', 'desligar', 'desliga', 'desligue', 'desabilitar', 'desabilita', 'disable', 'apaga', 'apagar') || has(text, 'turn off')) {
      return command('revlights.disable', lang, 'Rev-lights desativadas.', 'Rev-lights off.', 'revlights:setEnabled', { enabled: false })
    }
    if (hasWord(text, 'ativar', 'ativa', 'ative', 'ligar', 'liga', 'ligue', 'habilitar', 'habilita', 'enable', 'acender', 'acende') || has(text, 'turn on')) {
      return command('revlights.enable', lang, 'Rev-lights ativadas.', 'Rev-lights on.', 'revlights:setEnabled', { enabled: true })
    }
    if (hasWord(text, 'alternar', 'alterna', 'toggle')) {
      return command('revlights.toggle', lang, 'Rev-lights alternadas.', 'Rev-lights toggled.', 'revlights:toggle')
    }
  }

  return null
}

// ─── question matching ───────────────────────────────────────────────────────

function answer(category: IntentCategory, lang: IntentLang, text: string): IntentAnswer {
  return { type: 'answer', category, lang, text }
}

const NO_DATA_PT = 'Sem telemetria no momento.'
const NO_DATA_EN = 'No telemetry right now.'

function matchQuestion(text: string, lang: IntentLang, ctx: EngineerContext, unitSystem: UnitSystem): IntentAnswer | null {
  const snapshot = ctx.getSnapshot()
  const noData = lang === 'en' ? NO_DATA_EN : NO_DATA_PT

  // FUEL (level / can I finish)
  const isFinishQ = has(text, 'da pra terminar', 'da para terminar', 'consigo terminar', 'can we finish', 'can i finish', 'finish the race', 'make it to the end', 'make the finish', 'will i finish', 'enough fuel')
  if (isFinishQ || (hasWord(text, 'fuel', 'fuel', 'gasolina', 'tanque', 'gas') )) {
    if (!snapshot?.connected) return answer('fuel', lang, noData)
    return answer('fuel', lang, buildFuelAnswer(ctx, lang, isFinishQ, unitSystem))
  }

  // PIT (should I box now?)
  if (hasWord(text, 'boxes', 'box', 'pit', 'pitstop', 'stop', 'pitar', 'boxar', 'parar') || has(text, 'pit stop', 'should i pit', 'devo parar', 'preciso parar')) {
    if (!snapshot?.connected) return answer('pit', lang, noData)
    return answer('pit', lang, buildPitAnswer(ctx, lang))
  }

  // GAP (ahead / behind)
  if (hasWord(text, 'gap') || has(text, 'diferenca', 'distancia', 'intervalo')) {
    if (!snapshot?.connected) return answer('gap', lang, noData)
    const wantAhead = has(text, 'frente', 'ahead', 'front', 'lider', 'leader')
    const wantBehind = has(text, 'atras', 'tras', 'behind', 'traseira')
    return answer('gap', lang, buildGapAnswer(ctx, lang, wantAhead, wantBehind))
  }

  // DELTA / pace
  if (has(text, 'delta', 'meu tempo', 'como ta meu tempo', 'como esta meu tempo', 'lap time', 'my lap', 'how is my lap', 'hows my lap', 'how is my pace', 'hows my pace', 'my pace', 'my pace')) {
    if (!snapshot?.connected) return answer('delta', lang, noData)
    return answer('delta', lang, buildDeltaAnswer(ctx, lang))
  }

  // POSITION
  if (has(text, 'posicao', 'position', 'que lugar', 'colocado', 'classificado', 'where am i', 'what place', 'standing')) {
    if (!snapshot?.connected) return answer('position', lang, noData)
    return answer('position', lang, buildPositionAnswer(ctx, lang))
  }

  // LAPS REMAINING — one of the most common race questions; deterministic so the LLM
  // never has to (and can't hallucinate it). Specific phrases so fuel "laps" doesn't trip it.
  if (
    has(
      text,
      'quantas laps fhighm',
      'laps fhighm',
      'laps remaining',
      'laps pra acabar',
      'laps para acabar',
      'laps ate o end',
      'how many laps',
      'laps to go',
      'laps remaining',
      'laps left',
      'laps are left'
    )
  ) {
    if (!snapshot?.connected) return answer('laps', lang, noData)
    return answer('laps', lang, buildLapsAnswer(ctx, lang))
  }

  // TYRES
  if (hasWord(text, 'tire', 'tires', 'tyre', 'tyres', 'tire', 'tires', 'borracha')) {
    if (!snapshot?.connected) return answer('tyres', lang, noData)
    return answer('tyres', lang, buildTyresAnswer(ctx, lang, unitSystem))
  }

  // WEATHER
  if (hasWord(text, 'rain', 'chovendo', 'weather', 'weather', 'rain', 'raining', 'wet', 'dry', 'molhado', 'molhada', 'dry') || has(text, 'pista molhada')) {
    if (!snapshot?.connected) return answer('weather', lang, noData)
    return answer('weather', lang, buildWeatherAnswer(ctx, lang, unitSystem))
  }

  return null
}

// ─── answer builders ─────────────────────────────────────────────────────────

function formatFuelPerLapForSpeech(value: number, unitSystem: UnitSystem, pt: boolean): string {
  const measurement = formatMeasurement(value, 'fuel-per-lap-l', unitSystem, {
    decimals: 2,
    trimTrailingZeros: true,
    includeUnit: !pt
  })
  if (!pt) return measurement.display
  const number = measurement.display.replace('.', ',')
  const singular = measurement.value !== undefined && Math.abs(measurement.value - 1) < 0.0001
  if (unitSystem === 'imperial') return `${number} ${singular ? 'galão' : 'galões'} por volta`
  return `${number} ${singular ? 'litro' : 'litros'} por volta`
}

function buildFuelAnswer(ctx: EngineerContext, lang: IntentLang, finishFirst: boolean, unitSystem: UnitSystem): string {
  const fuel = deriveFuel(ctx.getSnapshot(), ctx.getFuelState?.())
  const pt = lang === 'pt'
  const parts: string[] = []

  if (finishFirst && typeof fuel.canFinish === 'boolean') {
    if (fuel.canFinish) parts.push(pt ? 'Dá para chegar ao fim.' : 'You can make the finish.')
    else parts.push(pt ? 'Não dá para chegar ao fim — será preciso parar nos boxes.' : "You can't make the finish — you'll need to pit.")
  }

  if (isFiniteNum(fuel.liters)) {
    parts.push(`${pt ? 'Combustível' : 'Fuel'}: ${formatMeasurement(fuel.liters, 'fuel-volume-l', unitSystem, { decimals: 1, trimTrailingZeros: true, includeUnit: true }).display}`)
  }
  if (isFiniteNum(fuel.perLap)) {
    const perLap = formatFuelPerLapForSpeech(fuel.perLap, unitSystem, pt)
    parts.push(pt ? `consumo ${perLap}` : perLap)
  }
  if (isFiniteNum(fuel.lapsLeft)) parts.push(pt ? `cerca de ${fuel.lapsLeft} voltas` : `good for ~${fuel.lapsLeft} laps`)

  if (!finishFirst && typeof fuel.canFinish === 'boolean') {
    if (fuel.canFinish) parts.push(pt ? 'combustível suficiente até o fim' : 'enough to finish')
    else parts.push(pt ? 'combustível insuficiente até o fim' : 'not enough to finish')
  }
  if (isFiniteNum(fuel.saveTargetPerLap) && fuel.saveTargetPerLap > 0) {
    const save = formatFuelPerLapForSpeech(fuel.saveTargetPerLap, unitSystem, pt)
    parts.push(pt ? `economize ${save}` : `save ${save}`)
  }

  if (parts.length === 0) return pt ? 'Ainda não há dados de combustível.' : 'No fuel data yet.'
  return `${parts.join(pt ? '. ' : ', ')}.`
}

function buildPitAnswer(ctx: EngineerContext, lang: IntentLang): string {
  const rec = computePitRecommendation(ctx.getSnapshot(), ctx.getFuelState?.(), ctx.getTireState?.())
  const pt = lang === 'pt'
  const parts: string[] = []

  if (rec.recommendPit) parts.push(pt ? 'Sim, pare nos boxes agora.' : 'Yes, pit.')
  else parts.push(pt ? 'Não precisa parar agora.' : 'No need to pit yet.')

  if (rec.fuelStatus === 'save') parts.push(pt ? 'Economize combustível para prolongar o stint.' : 'Save fuel to stretch the stint.')
  if (isFiniteNum(rec.fuelLapsLeft)) parts.push(pt ? `combustível para cerca de ${rec.fuelLapsLeft} voltas` : `fuel for ~${rec.fuelLapsLeft} laps`)
  if (isFiniteNum(rec.tyreLapsLeft)) parts.push(pt ? `pneus para cerca de ${rec.tyreLapsLeft} voltas` : `tyres for ~${rec.tyreLapsLeft} laps`)
  if (isPositive(rec.recommendedPitLap)) parts.push(pt ? `janela na volta ${rec.recommendedPitLap}` : `window on lap ${rec.recommendedPitLap}`)

  return `${parts.join(pt ? '. ' : ', ')}.`
}

function buildGapAnswer(ctx: EngineerContext, lang: IntentLang, wantAhead: boolean, wantBehind: boolean): string {
  const gaps = deriveGaps(ctx.getSnapshot())
  const pt = lang === 'pt'
  const both = wantAhead === wantBehind // both true or both false → report both
  const parts: string[] = []

  if ((wantAhead || both) && isFiniteNum(gaps.aheadSec)) {
    parts.push(pt ? `À frente: ${gaps.aheadSec}s${gaps.aheadName ? ` (${gaps.aheadName})` : ''}` : `Ahead: ${gaps.aheadSec}s${gaps.aheadName ? ` (${gaps.aheadName})` : ''}`)
  }
  if ((wantBehind || both) && isFiniteNum(gaps.behindSec)) {
    parts.push(pt ? `Atrás: ${gaps.behindSec}s${gaps.behindName ? ` (${gaps.behindName})` : ''}` : `Behind: ${gaps.behindSec}s${gaps.behindName ? ` (${gaps.behindName})` : ''}`)
  }

  if (parts.length === 0) return pt ? 'Não há carros próximos agora.' : 'No cars close right now.'
  return `${parts.join('. ')}.`
}

function buildLapsAnswer(ctx: EngineerContext, lang: IntentLang): string {
  const snap = ctx.getSnapshot()
  const pt = lang === 'pt'
  const laps = snap?.lapsRemaining
  // iRacing returns 32767 (and the Ex estimate can be absurd) in TIMED/unlimited sessions
  // and before lap pace is established at the green — exactly when this is most asked. Treat
  // any >= 9999 as "not a real lap count" and fall back to the timed-session message.
  if (!isFiniteNum(laps) || (laps as number) < 0 || (laps as number) >= 9999) {
    return pt ? 'Número de voltas indisponível, talvez seja uma sessão por tempo.' : 'Laps remaining unavailable (timed session?).'
  }
  const n = Math.round(laps as number)
  if (n <= 0) return pt ? 'Última volta.' : 'Last lap.'
  return pt ? `Cerca de ${n} voltas restantes.` : `~${n} laps to go.`
}

function buildPositionAnswer(ctx: EngineerContext, lang: IntentLang): string {
  const pos = derivePosition(ctx.getSnapshot())
  const pt = lang === 'pt'
  if (!isPositive(pos.position) && !isPositive(pos.classPosition)) {
    return pt ? 'Posição indisponível.' : 'Position unavailable.'
  }
  const parts: string[] = []
  if (isPositive(pos.position)) parts.push(pt ? `P${pos.position} no geral` : `P${pos.position} overall`)
  if (isPositive(pos.classPosition)) parts.push(pt ? `P${pos.classPosition} na classe` : `P${pos.classPosition} in class`)
  if (isPositive(pos.totalCars)) parts.push(pt ? `de ${pos.totalCars} carros` : `of ${pos.totalCars} cars`)
  return `${parts.join(pt ? ', ' : ', ')}.`
}

function buildDeltaAnswer(ctx: EngineerContext, lang: IntentLang): string {
  const timing = deriveTiming(ctx.getSnapshot(), ctx.getLapTiming?.())
  const pt = lang === 'pt'
  const parts: string[] = []

  if (isFiniteNum(timing.deltaSec)) {
    const d = timing.deltaSec
    if (d < -0.02) parts.push(pt ? `Você está ${formatSignedSec(d)} — mais rápido que sua melhor volta` : `You're ${formatSignedSec(d)} — faster than your best`)
    else if (d > 0.02) parts.push(pt ? `Você está ${formatSignedSec(d)} acima da sua melhor volta` : `You're ${formatSignedSec(d)} off your best`)
    else parts.push(pt ? 'No ritmo da sua melhor volta' : 'Right on your best pace')
  }
  if (isPositive(timing.lastSec)) parts.push(pt ? `última ${formatLapTime(timing.lastSec)}` : `last ${formatLapTime(timing.lastSec)}`)
  if (isPositive(timing.bestSec)) parts.push(pt ? `melhor ${formatLapTime(timing.bestSec)}` : `best ${formatLapTime(timing.bestSec)}`)

  if (parts.length === 0) return pt ? 'Ainda não há tempo de volta.' : 'No lap-time data yet.'
  return `${parts.join(pt ? '. ' : ', ')}.`
}

function buildTyresAnswer(ctx: EngineerContext, lang: IntentLang, unitSystem: UnitSystem): string {
  const tyres = deriveTyres(ctx.getSnapshot(), ctx.getTireState?.())
  const pt = lang === 'pt'
  const parts: string[] = []
  for (const id of ['lf', 'rf', 'lr', 'rr'] as const) {
    const corner = tyres[id]
    if (!corner) continue
    const bits: string[] = []
    if (isFiniteNum(corner.tempC)) bits.push(formatMeasurement(corner.tempC, 'temperature-c', unitSystem, { decimals: 0, includeUnit: true }).display)
    if (isFiniteNum(corner.wearPct)) bits.push(`${corner.wearPct}%`)
    if (bits.length) parts.push(`${id.toUpperCase()} ${bits.join(' ')}`)
  }
  const head = parts.length ? `${pt ? 'Pneus' : 'Tyres'}: ${parts.join(', ')}` : pt ? 'Sem dados dos pneus' : 'No tyre data'
  const tail: string[] = []
  if (tyres.worst) tail.push(pt ? `pior: ${tyres.worst}` : `worst: ${tyres.worst}`)
  if (isFiniteNum(tyres.lapsLeft)) tail.push(pt ? `cerca de ${tyres.lapsLeft} voltas restantes` : `~${tyres.lapsLeft} laps left`)
  return `${[head, ...tail].join('. ')}.`
}

function buildWeatherAnswer(ctx: EngineerContext, lang: IntentLang, unitSystem: UnitSystem): string {
  const w = deriveWeather(ctx.getSnapshot())
  const pt = lang === 'pt'
  const wet = w.declaredWet === true || w.raining === true || (isFiniteNum(w.wetnessPct) && w.wetnessPct >= 15)
  const parts: string[] = []
  parts.push(wet ? (pt ? 'Pista molhada' : 'Track is wet') : (pt ? 'Pista seca' : 'Track is dry'))
  if (isFiniteNum(w.wetnessPct)) parts.push(pt ? `umidade ${w.wetnessPct}%` : `${w.wetnessPct}% wet`)
  if (isFiniteNum(w.airTempC)) parts.push(`${pt ? 'ar' : 'air'} ${formatMeasurement(w.airTempC, 'temperature-c', unitSystem, { decimals: 0, includeUnit: true }).display}`)
  if (isFiniteNum(w.trackTempC)) parts.push(`${pt ? 'pista' : 'track'} ${formatMeasurement(w.trackTempC, 'temperature-c', unitSystem, { decimals: 0, includeUnit: true }).display}`)
  if (w.declaredWet) parts.push(pt ? 'chuva declarada — pneus de chuva permitidos' : 'wet declared — rain tyres allowed')
  return `${parts.join(pt ? ', ' : ', ')}.`
}
