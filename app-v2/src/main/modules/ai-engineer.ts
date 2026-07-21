// AI Race Engineer orchestrator — main process ONLY.
//
// Wires the already-built local-LLM pieces (llm-runtime, model-manager) and the
// deterministic layer (context-pack, intent-router, tools) into a text-first
// "ask → answer" feature, exposed over `engineer:` IPC. Everything is lazy:
// nothing loads a model until the user asks an open-ended question or explicitly
// downloads. Voice / push-to-talk is a SEPARATE later agent — this is the text
// path, with a clean seam (the `engineer:command` broadcast + EngineerAnswer.speak).
//
// The pure orchestration logic lives in `createEngineerOrchestrator(deps)` so it
// is unit-testable with a FAKE runtime/model-manager (no native model, no Electron).
// `register(ctx)` builds the real dependencies from the module context and binds
// the IPC handlers.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ModuleContext } from '../module-context'
import {
  type AiToolDefinition,
  type AiToolParamsSchema,
  type EnsureModelResult,
  type GenerateRequest,
  type GenerateResult,
  type LlmRuntimeOptions,
  type LlmRuntimeStatus,
  type ModelDownloadProgress,
  type ModelId,
  type ModelProgressListener,
  type ModelStatus,
  defineTool
} from '../../shared/ai'
import type {
  EngineerContext,
  EngineerToolset,
  IntentAnswerLang,
  IntentCategory,
  IntentCommandKind
} from '../../shared/ai-engineer'
import {
  buildRacecraftAdvice,
  coachAdviceLanguageFromAppLanguage,
  controlledDefinitionResponse,
  detectRacecraftLikeQuestionLanguage,
  detectRacecraftQuestionWithLanguage,
  detectTyreSelectionQuestionLanguage,
  isPureDefinitionRequest,
  racecraftClarificationText,
  racecraftSafetyFromSnapshot,
  racecraftSafetyMessage,
  racecraftSafetyReason,
  recognizeAnchoredTyreStatusQuery,
  safeInformationalDefinition,
  type CoachAdviceLanguage,
  type RacecraftAdviceContext,
  type RacecraftSafetyContext,
  type RacecraftSafetyReason
} from '../../shared/coach-racecraft'
import {
  DEFAULT_ENGINEER_CONFIG,
  ENGINEER_CHANNELS,
  type EngineerAnswer,
  type EngineerAnswerKind,
  type EngineerAnswerSource,
  type EngineerCommandDirective,
  type EngineerConfig,
  type EngineerConfigPatch,
  type EngineerMessageLanguage,
  type EngineerStatus,
  mergeEngineerConfig,
  resolveCommandDirective
} from '../../shared/engineer-ipc'
import type { Logger } from '../../shared/logger'
import { speechLanguageFromAppLanguage } from '../../shared/tts-voice'
import { buildContextPack, deriveFuel, renderContextText } from '../ai/context-pack'
import { routeIntent } from '../ai/intent-router'
import { getLlmRuntime } from '../ai/llm-runtime'
import { getModelManager } from '../ai/model-manager'
import { buildEngineerTools } from '../ai/tools'
import { settingsEvents } from '../settings/events'
import { logger } from './logger'
import { getLatestPredictions } from './predictions'
import { getLatestCoachFindings, getLatestCoachRacecraftContext } from './proactive-engineer'
import { formatMeasurement, type UnitSystem } from '../../shared/units'
import {
  captureLiveTelemetryContext,
  LiveTelemetryGate,
  sameLiveTelemetryContext,
  type LiveTelemetryContext
} from '../../shared/replay'

const LOG_AREA = 'ai'
const CONFIG_FILE = 'engineer.json'
const MODELS_DIR = 'models'

function engineerMessageLanguageForIntent(
  language: IntentAnswerLang
): EngineerMessageLanguage {
  if (language === 'en') return 'en-US'
  if (language === 'pt') return 'pt-BR'
  return language
}

// Token budget for the rendered context block (kept well under the model's window so
// the persona + tools + answer all fit). The pack itself targets < 400 tokens.
const CONTEXT_MAX_TOKENS = 380

// Throttle the success log so a chatty engineer can't flood the diagnostic log.
const ASK_LOG_THROTTLE_MS = 4000

// Keep the most recent Q&A pairs in memory (the renderer keeps its own scrollback).
const MAX_LOG_ENTRIES = 50
let liveContextRejectionSeq = 0
const SAFE_DETERMINISTIC_INTENT_CATEGORIES = new Set<IntentCategory>([
  'position',
  'weather',
  'laps'
])
export type EngineerSafetyIntent =
  | 'definition'
  | 'fuel-quantity'
  | 'position'
  | 'tyres'
  | 'weather'
  | 'laps'
  | 'other'

export function engineerSafetyAllowsIntent(
  reason: RacecraftSafetyReason | undefined,
  intent: EngineerSafetyIntent
): boolean {
  if (reason === undefined) return true
  if (reason === 'race-control-unknown') return intent === 'tyres'
  if (reason !== 'yellow-flag' && reason !== 'caution' && reason !== 'pacing') {
    return false
  }
  return (
    intent === 'definition' ||
    intent === 'fuel-quantity' ||
    intent === 'position' ||
    intent === 'tyres' ||
    intent === 'weather' ||
    intent === 'laps'
  )
}

function isReadOnlyFuelQuantityQuestion(question: string): boolean {
  const q = question
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const english = [
    /^(?:fuel|current fuel|fuel level|fuel remaining|fuel in the tank)$/,
    /^how much fuel(?: is left)?$/,
    /^what (?:is|s) (?:my |the )?(?:current )?(?:fuel|fuel level|fuel remaining)$/,
    /^(?:fuel consumption|fuel burn|fuel per lap)$/,
    /^what (?:is|s) my (?:fuel consumption|fuel burn|fuel per lap)$/
  ]
  const portuguese = [
    /^(?:combustivel|combustivel atual|nivel de combustivel|combustivel restante)$/,
    /^quanto combustivel(?: resta| tenho| ha no tanque)?$/,
    /^qual (?:e )?o (?:meu )?(?:combustivel atual|nivel de combustivel|combustivel restante)$/,
    /^(?:consumo de combustivel|combustivel por volta)$/,
    /^qual (?:e )?o (?:meu )?(?:consumo de combustivel|combustivel por volta)$/
  ]
  return [...english, ...portuguese].some((pattern) => pattern.test(q))
}

function isSafeDeterministicAnswer(
  category: IntentCategory,
  question: string
): boolean {
  if (category === 'fuel') return isReadOnlyFuelQuantityQuestion(question)
  if (category === 'tyres') return recognizeAnchoredTyreStatusQuery(question) !== null
  return SAFE_DETERMINISTIC_INTENT_CATEGORIES.has(category)
}

function safetyIntentForAnswer(
  category: IntentCategory,
  question: string
): EngineerSafetyIntent {
  if (category === 'fuel') {
    return isReadOnlyFuelQuantityQuestion(question) ? 'fuel-quantity' : 'other'
  }
  if (category === 'tyres') {
    return recognizeAnchoredTyreStatusQuery(question) ? 'tyres' : 'other'
  }
  if (
    category === 'position' ||
    category === 'weather' ||
    category === 'laps'
  ) return category
  return 'other'
}

function fuelQuantityAnswer(
  context: EngineerContext,
  language: EngineerMessageLanguage,
  unitSystem: UnitSystem
): string {
  const fuel = deriveFuel(context.getSnapshot(), context.getFuelState?.())
  const parts: string[] = []
  if (typeof fuel.liters === 'number' && Number.isFinite(fuel.liters)) {
    parts.push(
      `${language === 'pt-BR' ? 'Combustível' : 'Fuel'}: ${
        formatMeasurement(fuel.liters, 'fuel-volume-l', unitSystem, {
          decimals: 1,
          trimTrailingZeros: true,
          includeUnit: true
        }).display
      }`
    )
  }
  if (typeof fuel.perLap === 'number' && Number.isFinite(fuel.perLap)) {
    parts.push(
      `${language === 'pt-BR' ? 'consumo' : 'consumption'} ${
        formatMeasurement(fuel.perLap, 'fuel-per-lap-l', unitSystem, {
          decimals: 2,
          trimTrailingZeros: true,
          includeUnit: true
        }).display
      }`
    )
  }
  if (parts.length > 0) return `${parts.join(' · ')}.`
  return language === 'pt-BR'
    ? 'Ainda não há quantidades de combustível disponíveis.'
    : 'Fuel quantities are not available yet.'
}

// ─── Injectable dependency seams (tests pass fakes) ───────────────────────────

export interface EngineerRuntimeLike {
  generateWithTools(request: GenerateRequest): Promise<GenerateResult>
  getStatus(): LlmRuntimeStatus
  setOptions(patch: LlmRuntimeOptions): void
  unload(): Promise<void>
}

export interface EngineerModelManagerLike {
  ensureModel(id?: ModelId, onProgress?: ModelProgressListener, signal?: AbortSignal): Promise<EnsureModelResult>
  listModels(): ModelStatus[]
  getActiveModelId(): ModelId
  setActiveModel(id: ModelId): boolean
  getActiveModelPath(): string | null
}

export interface EngineerOrchestratorDeps {
  runtime: EngineerRuntimeLike
  modelManager: EngineerModelManagerLike
  context: EngineerContext
  /** Rich deterministic player/reference/gap evidence for racecraft questions. */
  racecraftContext?(): RacecraftAdviceContext | null | undefined
  broadcast(channel: string, payload: unknown): void
  /** Starting config (register loads it from disk before constructing). */
  config: EngineerConfig
  saveConfig(config: EngineerConfig): Promise<void> | void
  /** Notified whenever the live config changes (so siblings can read a fresh snapshot). */
  onConfigChange?(config: EngineerConfig): void
  logger?: Logger
  now?(): number
  getUnitSystem?(): UnitSystem
  getRacecraftLanguage?(): CoachAdviceLanguage
  /** Canonical live context used to reject replay/unknown and stale async answers. */
  getLiveContext?(): LiveTelemetryContext | null
}

export interface EngineerOrchestrator {
  ask(question: string): Promise<EngineerAnswer>
  getStatus(): EngineerStatus
  ensureActiveModel(): Promise<EnsureModelResult>
  getConfig(): EngineerConfig
  setConfig(patch: EngineerConfigPatch): Promise<EngineerConfig>
  cancel(): void
  observeSafety(): void
  resetLiveContext(): void
  getLog(): EngineerAnswer[]
}

// ─── Persona + fallback copy (PT-BR default, EN when configured) ───────────────
//
// The persona is ASSERTIVENESS-AWARE: a single builder produces three selectable
// voices (balanced / assertive / brutal). `brutal` (the default) is the bluntest
// radio engineer possible for a 1.5B local model — tuned purely via persona +
// few-shot + generation params, never weight fine-tuning. The hard rules (use
// tools for real numbers, never invent, stay SHORT) hold at every level.

// Process-local snapshot of the live engineer config so SIBLING main modules
// (proactive-engineer) can read enabled / proactiveCoaching / language /
// assertiveness without touching engineer.json or the orchestrator instance.
let activeEngineerConfig: EngineerConfig = { ...DEFAULT_ENGINEER_CONFIG }

/** Latest persisted engineer config (read by the proactive coaching module). */
export function getEngineerConfigSnapshot(): EngineerConfig {
  return activeEngineerConfig
}

function isPt(config: EngineerConfig): boolean {
  return config.language === 'pt-BR'
}

// Tone block keyed by assertiveness — the ONLY part of the persona that changes
// between levels. Everything else (hard rules, brevity) is shared.
const TONE_PT: Record<EngineerConfig['assertiveness'], string> = {
  balanced: 'Você é um engenheiro de corrida experiente e calmo no rádio. Seja direto e útil, sem enrolação.',
  assertive:
    'Você é um engenheiro de corrida EXIGENTE no rádio. Vá direto ao ponto, aponte claramente o erro do piloto e cobre melhora.',
  brutal:
    'Você é um engenheiro de corrida BRUTALMENTE direto no rádio. Aponte o erro do piloto sem enrolação e SEM elogio de consolo. Cobre correção agora.'
}

const TONE_EN: Record<EngineerConfig['assertiveness'], string> = {
  balanced: 'You are an experienced, calm race engineer on the radio. Be direct and useful, no waffle.',
  assertive: 'You are a DEMANDING race engineer on the radio. Get straight to the point, call out the mistake and push for more.',
  brutal:
    'You are a BRUTALLY blunt race engineer on the radio. Call out the mistake to the driver directly, no waffle and NO consolation praise. Demand that they fix it now.'
}

// Style-only few-shot pairs. They demonstrate the blunt CADENCE *and* the correct
// behaviour — defer to the tools/coaching for real numbers — WITHOUT inventing any
// specific figures (which on a 1.5B model would teach hallucination and undercut the
// "never invent / call the tools" rule, especially at the punchier temperatures).
const FEWSHOT_PT: Record<EngineerConfig['assertiveness'], string> = {
  balanced: [
    'Exemplo de tom — P: como estou? R: Consistente. Onde o coaching apontar, há tempo a ganhar — confira os dados.',
    'Exemplo de tom — P: dá para terminar? R: Depende do combustível; vou checar antes de confirmar.'
  ].join('\n'),
  assertive: [
    'Exemplo de tom — P: como estou? R: Você está deixando tempo na mesa. Olhe onde o coaching apontou e corrija.',
    'Exemplo de tom — P: e os pneus? R: Vou checar os dados antes de te cobrar — sem chute.'
  ].join('\n'),
  brutal: [
    'Exemplo de tom — P: como estou? R: Você está jogando tempo fora. Veja o coaching e corrija agora.',
    'Exemplo de tom — P: terminamos com esse combustível? R: Só depois de checar os números. Sem dado, sem promessa.',
    'Exemplo de tom — P: está bom? R: Não alivie. Ache onde está perdendo tempo e ataque.'
  ].join('\n')
}

const FEWSHOT_EN: Record<EngineerConfig['assertiveness'], string> = {
  balanced: [
    'Tone example — Q: how am I doing? A: Consistent. There is time where the coaching flags it — check the data.',
    'Tone example — Q: can I finish? A: Depends on fuel; let me check before I confirm.'
  ].join('\n'),
  assertive: [
    'Tone example — Q: how am I doing? A: You are leaving time on the table. Look where the coaching points and fix it.',
    'Tone example — Q: tyres? A: I will check the data before I push you — no guessing.'
  ].join('\n'),
  brutal: [
    'Tone example — Q: how am I doing? A: You are throwing time away. Check the coaching and fix it now.',
    'Tone example — Q: can I finish on this fuel? A: Only after I check the numbers. No data, no promise.',
    'Tone example — Q: am I good? A: Quit stalling. Find where you are losing and attack it.'
  ].join('\n')
}

function personaSystem(config: EngineerConfig, unitSystem: UnitSystem = 'metric'): string {
  const level = config.assertiveness
  return [
    pick(config, { pt: TONE_PT[level], en: TONE_EN[level] }),
    pick(config, {
      pt: 'Responda sempre em PT-BR, em no máximo 2 frases curtas, como uma chamada de rádio.',
      en: 'Always answer in English, in at most 2 short sentences, like a race radio call.'
    }),
    pick(config, {
      pt: 'Use as ferramentas disponíveis para checar dados reais (combustível, pneus, gaps, posição, tempos de volta, estratégia, coaching) antes de citar números.',
      en: 'Use the available tools to check real data (fuel, tyres, gaps, position, lap times, strategy, coaching) before stating any numbers.'
    }),
    pick(config, {
      pt: 'Nunca invente dados: se a telemetria estiver indisponível, diga isso honestamente.',
      en: 'Never invent data: if there is no telemetry, say so honestly.'
    }),
    pick(config, {
      pt: 'Para COACHING, não reavalie, não decida e não invente causa: apenas reformule os achados determinísticos fornecidos, podendo citar confiança e intenção descartada.',
      en: 'For COACHING, do not re-decide, judge, or invent causes: only rephrase the provided deterministic findings, and you may cite confidence and discarded intent.'
    }),
    unitSystem === 'imperial'
      ? pick(config, { pt: 'Use somente unidades imperiais dos EUA: mph, °F, psi, galões US, milhas e pés.', en: 'Use US customary units only: mph, °F, psi, US gallons, miles and feet.' })
      : pick(config, { pt: 'Use somente unidades métricas: km/h, °C, bar ou kPa, litros e quilômetros.', en: 'Use metric units only: km/h, °C, bar or kPa, liters and kilometers.' }),
    pick(config, { pt: FEWSHOT_PT[level], en: FEWSHOT_EN[level] })
  ].join(' ')
}

// Per-assertiveness generation tuning. Brutal/assertive stay at a LOW temperature
// (<= 0.3) so the blunt persona never trades away tool-call reliability or invents
// numbers on a 1.5B model; brutal is just capped shorter so it stays a one-liner.
export function generationParams(config: EngineerConfig): { temperature: number; maxTokens: number } {
  switch (config.assertiveness) {
    case 'brutal':
      return { temperature: 0.3, maxTokens: Math.min(config.maxTokens, 100) }
    case 'assertive':
      return { temperature: 0.3, maxTokens: Math.min(config.maxTokens, 130) }
    case 'balanced':
    default:
      return { temperature: 0.2, maxTokens: config.maxTokens }
  }
}

function promptLabel(config: EngineerConfig): string {
  return isPt(config) ? 'Pergunta' : 'Question'
}

const FALLBACK = {
  empty: { pt: 'Pode repetir a pergunta?', en: 'Can you repeat the question?' },
  disabled: { pt: 'O engenheiro de IA está desativado. Ative-o nas configurações.', en: 'The AI engineer is turned off. Enable it in settings.' },
  noModel: {
    pt: 'Não consegui carregar o modelo de IA. Verifique a conexão e tente baixar novamente.',
    en: "Couldn't load the AI model. Check your connection and try downloading it again."
  },
  llmError: { pt: 'Não consegui processar isso agora. Tente novamente em instantes.', en: "I couldn't process that right now. Try again shortly." },
  noCommand: { pt: 'Ainda não consigo fazer isso por aqui.', en: "I can't do that from here yet." }
} as const

function pick(config: EngineerConfig, copy: { pt: string; en: string }): string {
  return isPt(config) ? copy.pt : copy.en
}

// ─── Tool adaptation (EngineerTool → node-llama-cpp function shape) ────────────
//
// node-llama-cpp consumes a record of `{ description, params, handler }` objects
// (identical to what `defineChatSessionFunction(...)` returns). We build that shape
// with the dependency-free `defineTool` helper from shared/ai.ts so NO native module
// is imported here — the runtime stays lazy-loaded until the first generation.

export function adaptEngineerTools(toolset: EngineerToolset): Record<string, AiToolDefinition> {
  const functions: Record<string, AiToolDefinition> = {}
  for (const [name, tool] of Object.entries(toolset)) {
    functions[name] = defineTool({
      description: tool.description,
      params: tool.parameters as unknown as AiToolParamsSchema,
      handler: (params: unknown) => tool.run((params ?? {}) as Record<string, unknown>)
    })
  }
  return functions
}

// ─── Orchestrator factory ──────────────────────────────────────────────────────

export function createEngineerOrchestrator(deps: EngineerOrchestratorDeps): EngineerOrchestrator {
  const now = deps.now ?? (() => Date.now())
  const log = deps.logger
  let config = deps.config
  deps.onConfigChange?.(config)
  const recent: EngineerAnswer[] = []
  let currentAbort: AbortController | null = null
  let configRevision = 0
  let languageRevision = 0
  let safetyRevision = 0
  let lastSafetyKey: string | undefined
  let seq = 0
  let lastAskLogAt = 0

  function nextId(): string {
    seq += 1
    return `eng-${now()}-${seq}`
  }

  function record(answer: EngineerAnswer): void {
    recent.push(answer)
    if (recent.length > MAX_LOG_ENTRIES) recent.splice(0, recent.length - MAX_LOG_ENTRIES)
  }

  function contextIsCurrent(context: LiveTelemetryContext | null): boolean {
    return !deps.getLiveContext || sameLiveTelemetryContext(deps.getLiveContext(), context)
  }

  function rejectedAnswer(question: string): EngineerAnswer {
    const at = now()
    liveContextRejectionSeq += 1
    return {
      id: `eng-live-context-reset-${at}-${liveContextRejectionSeq}`,
      at,
      question,
      text: isPt(config) ? 'Telemetria ao vivo indisponível.' : 'Live telemetry is unavailable.',
      speak: false,
      lang: config.language,
      kind: 'disabled',
      source: 'system'
    }
  }

  function generationSafetyContext(): RacecraftSafetyContext {
    const snapshot = deps.context.getSnapshot()
    if (snapshot) return racecraftSafetyFromSnapshot(snapshot)
    const published = deps.racecraftContext?.()
    return published?.safety ??
      { connected: false, onTrack: false, replayState: 'unknown' }
  }

  function generationSafetyKey(safety: RacecraftSafetyContext): string {
    return JSON.stringify([
      safety.connected,
      safety.onTrack,
      safety.onPitRoad,
      safety.flagYellow,
      safety.flagBlue,
      safety.flagRed,
      safety.flagBlack,
      safety.flagMeatball,
      safety.flagRepair,
      safety.flagDisqualify,
      safety.flagCheckered,
      safety.flagsKnown,
      safety.raceControlUnknownReason,
      safety.pitStateKnown,
      safety.paceStateKnown,
      safety.caution,
      safety.paceMode,
      safety.sessionState,
      safety.sessionKind,
      safety.replayState,
      safety.carLeftRight,
      (safety.carsAlongsideCount ?? 0) > 0,
      safety.radarClosestMeters !== undefined && safety.radarClosestMeters <= 8,
      safety.gapAheadSec !== undefined && safety.gapAheadSec <= 0.35,
      safety.gapBehindSec !== undefined && safety.gapBehindSec <= 0.35
    ])
  }

  function observeGenerationSafety(): {
    key: string
    revision: number
    reason?: RacecraftSafetyReason
  } {
    const safety = generationSafetyContext()
    const key = generationSafetyKey(safety)
    if (lastSafetyKey === undefined) {
      lastSafetyKey = key
    } else if (lastSafetyKey !== key) {
      lastSafetyKey = key
      safetyRevision += 1
      currentAbort?.abort()
    }
    return {
      key,
      revision: safetyRevision,
      reason: racecraftSafetyReason(safety)
    }
  }

  function safetyChangedAnswer(question: string): EngineerAnswer {
    return {
      id: nextId(),
      at: now(),
      question,
      text:
        config.language === 'pt-BR'
          ? 'A condição de segurança mudou. Faça a pergunta novamente quando a telemetria estabilizar.'
          : 'The safety state changed. Ask again after live telemetry stabilizes.',
      speak: false,
      lang: config.language,
      kind: 'disabled',
      source: 'system'
    }
  }

  function cancelledForConfigChange(question: string): EngineerAnswer {
    const answer: EngineerAnswer = {
      id: nextId(),
      at: now(),
      question,
      text:
        config.language === 'pt-BR'
          ? 'Solicitação cancelada porque a configuração de idioma mudou. Tente novamente.'
          : 'Request cancelled because the language setting changed. Please try again.',
      speak: false,
      lang: config.language,
      kind: 'disabled',
      source: 'system'
    }
    record(answer)
    deps.broadcast(ENGINEER_CHANNELS.answer, answer)
    return answer
  }

  function publishAnswer(
    question: string,
    text: string,
    kind: EngineerAnswerKind,
    source: EngineerAnswerSource,
    command?: EngineerCommandDirective,
    language: EngineerMessageLanguage = config.language,
    speechText?: string,
    speakOverride?: boolean
  ): EngineerAnswer {
    const answer: EngineerAnswer = {
      id: nextId(),
      at: now(),
      question,
      text,
      speechText,
      speak: speakOverride ?? (config.speakAnswers && text.length > 0),
      lang: language,
      kind,
      source,
      command
    }
    record(answer)
    const at = now()
    if (kind === 'error' || at - lastAskLogAt >= ASK_LOG_THROTTLE_MS) {
      lastAskLogAt = at
      log?.[kind === 'error' ? 'warn' : 'info'](LOG_AREA, 'engineer answer', {
        kind,
        source,
        qLen: question.length,
        aLen: text.length
      })
    }
    deps.broadcast(ENGINEER_CHANNELS.answer, answer)
    return answer
  }

  function finalize(
    question: string,
    text: string,
    kind: EngineerAnswerKind,
    source: EngineerAnswerSource,
    command: EngineerCommandDirective | undefined,
    context: LiveTelemetryContext | null,
    language?: EngineerMessageLanguage,
    speechText?: string,
    speakOverride?: boolean
  ): EngineerAnswer {
    if (!contextIsCurrent(context)) return rejectedAnswer(question)
    return publishAnswer(
      question,
      text,
      kind,
      source,
      command,
      language,
      speechText,
      speakOverride
    )
  }

  function applyRuntimeOptions(): void {
    const patch: LlmRuntimeOptions = {
      modelId: config.modelId,
      maxTokens: config.maxTokens,
      idleUnloadMs: config.idleUnloadMs
    }
    if (config.threads > 0) patch.threads = config.threads
    const path = deps.modelManager.getActiveModelPath()
    if (path) patch.modelPath = path
    deps.runtime.setOptions(patch)
  }

  function onModelProgress(progress: ModelDownloadProgress): void {
    deps.broadcast(ENGINEER_CHANNELS.modelProgress, progress)
  }

  async function llmAnswer(question: string, context: LiveTelemetryContext | null): Promise<EngineerAnswer> {
    // Create the abort controller FIRST so "Parar" (engineer:cancel) can cancel even the
    // ~1 GB first-run model download — otherwise a surprise download mid online-race could
    // saturate the connection with no way to stop it.
    const controller = new AbortController()
    currentAbort = controller
    const requestConfig = config
    const requestRevision = configRevision
    const requestLanguageRevision = languageRevision
    const requestSafety = observeGenerationSafety()
    const requestConfigIsCurrent = (): boolean => configRevision === requestRevision
    const requestLanguageIsCurrent = (): boolean =>
      languageRevision === requestLanguageRevision
    const requestSafetyIsCurrent = (): boolean => {
      const current = observeGenerationSafety()
      return (
        current.revision === requestSafety.revision &&
        current.key === requestSafety.key &&
        current.reason === undefined
      )
    }
    if (requestSafety.reason !== undefined) return safetyChangedAnswer(question)
    try {
      // Lazy model resolution (download-on-first-run with progress + cancellable).
      const ensured = await deps.modelManager.ensureModel(
        requestConfig.modelId,
        (progress) => {
          if (
            contextIsCurrent(context) &&
            requestConfigIsCurrent() &&
            requestLanguageIsCurrent() &&
            requestSafetyIsCurrent()
          ) deps.broadcast(ENGINEER_CHANNELS.modelProgress, progress)
        },
        controller.signal
      )
      if (!contextIsCurrent(context)) return rejectedAnswer(question)
      if (!requestConfigIsCurrent()) return cancelledForConfigChange(question)
      if (!requestLanguageIsCurrent()) return cancelledForConfigChange(question)
      if (!requestSafetyIsCurrent()) return safetyChangedAnswer(question)
      if (!ensured.ok) {
        log?.warn(LOG_AREA, 'ensureModel failed', { modelId: requestConfig.modelId, error: ensured.error })
        return finalize(question, pick(requestConfig, FALLBACK.noModel), 'error', 'llm', undefined, context)
      }

      deps.runtime.setOptions({
        modelPath: ensured.path,
        modelId: requestConfig.modelId,
        maxTokens: requestConfig.maxTokens,
        idleUnloadMs: requestConfig.idleUnloadMs,
        ...(requestConfig.threads > 0 ? { threads: requestConfig.threads } : {})
      })

      const snapshot = deps.context.getSnapshot()
      const unitSystem = deps.getUnitSystem?.() ?? 'metric'
      const pack = buildContextPack(snapshot, {
        fuel: deps.context.getFuelState?.(),
        tire: deps.context.getTireState?.(),
        lap: deps.context.getLapTiming?.(),
        coachTips: deps.context.getCoachTips?.(),
        coachFindings: deps.context.getCoachFindings?.(),
        events: deps.context.getRecentEvents?.(),
        referenceLapLabel: deps.context.getReferenceLapLabel?.(),
        predictions: deps.context.getPredictions?.()
      })
      const contextText = renderContextText(pack, { maxTokens: CONTEXT_MAX_TOKENS, unitSystem })
      const functions = adaptEngineerTools(buildEngineerTools(deps.context, unitSystem))
      const prompt = `${contextText}\n\n${promptLabel(requestConfig)}: ${question}`

      const gen = generationParams(requestConfig)
      const result = await deps.runtime.generateWithTools({
        system: personaSystem(requestConfig, unitSystem),
        prompt,
        functions,
        maxTokens: gen.maxTokens,
        temperature: gen.temperature,
        signal: controller.signal
      })
      if (!contextIsCurrent(context)) return rejectedAnswer(question)
      if (!requestConfigIsCurrent()) return cancelledForConfigChange(question)
      if (!requestLanguageIsCurrent()) return cancelledForConfigChange(question)
      if (!requestSafetyIsCurrent()) return safetyChangedAnswer(question)
      if (!result.ok) {
        log?.warn(LOG_AREA, 'generate failed', { code: result.code })
        return finalize(question, pick(requestConfig, FALLBACK.llmError), 'error', 'llm', undefined, context)
      }
      const text = (result.text ?? '').trim() || pick(requestConfig, FALLBACK.llmError)
      return finalize(question, text, 'answer', 'llm', undefined, context)
    } catch (error) {
      // The runtime never throws, but keep the orchestrator bullet-proof regardless.
      if (!contextIsCurrent(context)) return rejectedAnswer(question)
      if (!requestConfigIsCurrent()) return cancelledForConfigChange(question)
      if (!requestLanguageIsCurrent()) return cancelledForConfigChange(question)
      if (!requestSafetyIsCurrent()) return safetyChangedAnswer(question)
      log?.error(LOG_AREA, 'generate threw', { message: error instanceof Error ? error.message : String(error) })
      return finalize(question, pick(requestConfig, FALLBACK.llmError), 'error', 'llm', undefined, context)
    } finally {
      if (currentAbort === controller) {
        currentAbort = null
      }
    }
  }

  function runCommand(
    question: string,
    kind: IntentCommandKind,
    speak: string,
    args: Record<string, unknown> | undefined,
    context: LiveTelemetryContext | null
  ): EngineerAnswer {
    const directive = resolveCommandDirective(kind, args)
    if (directive.executable) {
      // Execute by reusing the EXISTING renderer IPC: broadcast the directive and
      // let the EngineerView invoke the same channel the renderer uses today. Main
      // can't reach the other modules' live engines without editing them.
      if (!contextIsCurrent(context)) return rejectedAnswer(question)
      deps.broadcast(ENGINEER_CHANNELS.command, directive)
      return finalize(question, speak, 'command', 'command', directive, context)
    }
    // No existing channel (setup.save / lap.mark) — honest spoken reply, no-op.
    return finalize(question, pick(config, FALLBACK.noCommand), 'command', 'command', directive, context)
  }

  async function ask(rawQuestion: string): Promise<EngineerAnswer> {
    const question = (rawQuestion ?? '').toString().trim()
    if (!question) return publishAnswer('', pick(config, FALLBACK.empty), 'answer', 'system')
    if (!config.enabled) return publishAnswer(question, pick(config, FALLBACK.disabled), 'disabled', 'system')

    const detectedRacecraft = detectRacecraftQuestionWithLanguage(question)
    const racecraftLikeLanguage = detectRacecraftLikeQuestionLanguage(question)
    const tyreSelectionLanguage = detectTyreSelectionQuestionLanguage(question)
    const adviceLanguage =
      deps.getRacecraftLanguage?.() ??
      detectedRacecraft?.language ??
      racecraftLikeLanguage ??
      coachAdviceLanguageFromAppLanguage(config.language)
    const context = deps.getLiveContext?.() ?? null
    const unitSystem = deps.getUnitSystem?.() ?? 'metric'
    const snapshot = deps.context.getSnapshot()
    const fallbackGapSample = snapshot
      ? {
          at: snapshot.timestamp,
          aheadSec: Number.isFinite(snapshot.relatives?.ahead?.gapSec)
            ? Math.abs(snapshot.relatives!.ahead!.gapSec as number)
            : undefined,
          behindSec: Number.isFinite(snapshot.relatives?.behind?.gapSec)
            ? Math.abs(snapshot.relatives!.behind!.gapSec as number)
            : undefined,
          aheadCarIdx: snapshot.relatives?.ahead?.carIdx,
          behindCarIdx: snapshot.relatives?.behind?.carIdx
        }
      : undefined
    const hasFallbackRelative =
      fallbackGapSample?.aheadSec !== undefined ||
      fallbackGapSample?.behindSec !== undefined
    const makeFallbackContext = (): RacecraftAdviceContext => ({
      findings: deps.context.getCoachFindings?.() ?? [],
      gaps: hasFallbackRelative && fallbackGapSample ? [fallbackGapSample] : [],
      currentGapSample: hasFallbackRelative ? fallbackGapSample : undefined,
      currentGapAheadSec: Number.isFinite(snapshot?.relatives?.ahead?.gapSec)
        ? Math.abs(snapshot!.relatives!.ahead!.gapSec as number)
        : undefined,
      currentGapBehindSec: Number.isFinite(snapshot?.relatives?.behind?.gapSec)
        ? Math.abs(snapshot!.relatives!.behind!.gapSec as number)
        : undefined,
      safety: snapshot
        ? racecraftSafetyFromSnapshot(snapshot)
        : { connected: false, onTrack: false, replayState: 'unknown' },
      trackId: snapshot?.trackId,
      sim: snapshot?.sim,
      trackName: snapshot?.trackName,
      trackConfigName: snapshot?.trackConfigName,
      carName: snapshot?.carName,
      carPath: snapshot?.carPath
    })
    if (tyreSelectionLanguage) {
      const safety =
        deps.racecraftContext?.()?.safety ??
        makeFallbackContext().safety
      const safetyReason = racecraftSafetyReason(safety)
      if (safetyReason) {
        const text = racecraftSafetyMessage(safetyReason, adviceLanguage)
        return finalize(
          question,
          text,
          'answer',
          'intent',
          undefined,
          context,
          adviceLanguage,
          text,
          false
        )
      }
    }
    const supportedDefinition = safeInformationalDefinition(question, adviceLanguage)
    const controlledDefinition =
      supportedDefinition ??
      controlledDefinitionResponse(question, adviceLanguage)
    if (
      controlledDefinition &&
      isPureDefinitionRequest(question)
    ) {
      const definitionSafety =
        deps.racecraftContext?.()?.safety ??
        makeFallbackContext().safety
      const definitionSafetyReason = racecraftSafetyReason(definitionSafety)
      if (engineerSafetyAllowsIntent(definitionSafetyReason, 'definition')) {
        return finalize(
          question,
          controlledDefinition,
          'answer',
          'intent',
          undefined,
          context,
          adviceLanguage,
          controlledDefinition
        )
      }
    }
    if (deps.getLiveContext && !context) {
      if (detectedRacecraft) {
        const advice = buildRacecraftAdvice(detectedRacecraft.intent, makeFallbackContext(), {
          language: adviceLanguage,
          unitSystem
        })
        return publishAnswer(
          question,
          advice.text,
          'answer',
          'intent',
          undefined,
          adviceLanguage,
          advice.speechText,
          advice.suppressedReason ? false : undefined
        )
      }
      if (racecraftLikeLanguage) {
        const fallbackContext = makeFallbackContext()
        const safetyReason = racecraftSafetyReason(fallbackContext.safety)
        const text = safetyReason
          ? racecraftSafetyMessage(safetyReason, adviceLanguage)
          : racecraftClarificationText(adviceLanguage)
        return publishAnswer(
          question,
          text,
          'answer',
          'intent',
          undefined,
          adviceLanguage,
          text,
          safetyReason ? false : undefined
        )
      }
      return rejectedAnswer(question)
    }
    if (detectedRacecraft) {
      const fallbackContext = makeFallbackContext()
      const advice = buildRacecraftAdvice(
        detectedRacecraft.intent,
        deps.racecraftContext?.() ?? fallbackContext,
        { language: adviceLanguage, unitSystem }
      )
      return finalize(
        question,
        advice.text,
        'answer',
        'intent',
        undefined,
        context,
        adviceLanguage,
        advice.speechText,
        advice.suppressedReason ? false : undefined
      )
    }
    if (racecraftLikeLanguage) {
      const fallbackContext = makeFallbackContext()
      const safety =
        deps.racecraftContext?.()?.safety ??
        fallbackContext.safety
      const safetyReason = racecraftSafetyReason(safety)
      const text = safetyReason
        ? racecraftSafetyMessage(safetyReason, adviceLanguage)
        : racecraftClarificationText(adviceLanguage)
      return finalize(
        question,
        text,
        'answer',
        'intent',
        undefined,
        context,
        adviceLanguage,
        text,
        safetyReason ? false : undefined
      )
    }

    const intent = routeIntent(question, deps.context, isPt(config) ? 'pt' : 'en', unitSystem)
    if (intent.type === 'command') {
      return runCommand(question, intent.kind, intent.speak, intent.args, context)
    }
    const freeFormSafety =
      deps.racecraftContext?.()?.safety ??
      makeFallbackContext().safety
    const freeFormSafetyReason = racecraftSafetyReason(freeFormSafety)
    if (
      intent.type === 'answer' &&
      isSafeDeterministicAnswer(intent.category, question) &&
      engineerSafetyAllowsIntent(
        freeFormSafetyReason,
        safetyIntentForAnswer(intent.category, question)
      )
    ) {
      const text =
        intent.category === 'fuel'
          ? fuelQuantityAnswer(deps.context, config.language, unitSystem)
          : intent.text
      return finalize(
        question,
        text,
        'answer',
        'intent',
        undefined,
        context,
        engineerMessageLanguageForIntent(intent.lang)
      )
    }
    if (freeFormSafetyReason) {
      const text = racecraftSafetyMessage(freeFormSafetyReason, adviceLanguage)
      return finalize(
        question,
        text,
        'answer',
        'intent',
        undefined,
        context,
        adviceLanguage,
        text,
        false
      )
    }
    const definition = controlledDefinition
    if (definition) {
      return finalize(
        question,
        definition,
        'answer',
        'intent',
        undefined,
        context,
        adviceLanguage,
        definition
      )
    }
    if (intent.type === 'answer') {
      return finalize(
        question,
        intent.text,
        'answer',
        'intent',
        undefined,
        context,
        engineerMessageLanguageForIntent(intent.lang)
      )
    }
    return llmAnswer(question, context)
  }

  function getStatus(): EngineerStatus {
    return {
      enabled: config.enabled,
      activeModelId: deps.modelManager.getActiveModelId(),
      runtime: deps.runtime.getStatus(),
      models: deps.modelManager.listModels(),
      config
    }
  }

  async function ensureActiveModel(): Promise<EnsureModelResult> {
    const result = await deps.modelManager.ensureModel(config.modelId, onModelProgress)
    if (result.ok) applyRuntimeOptions()
    deps.broadcast(ENGINEER_CHANNELS.statusEvent, getStatus())
    return result
  }

  async function setConfig(patch: EngineerConfigPatch): Promise<EngineerConfig> {
    const previousModel = config.modelId
    const previousLanguage = config.language
    config = mergeEngineerConfig(config, { ...patch, updatedAt: now() })
    configRevision += 1
    if (config.language !== previousLanguage) languageRevision += 1
    currentAbort?.abort()
    deps.onConfigChange?.(config)
    await deps.saveConfig(config)
    if (config.modelId !== previousModel) {
      deps.modelManager.setActiveModel(config.modelId)
      log?.info(LOG_AREA, 'engineer default model set', { from: previousModel, to: config.modelId })
    }
    applyRuntimeOptions()
    deps.broadcast(ENGINEER_CHANNELS.statusEvent, getStatus())
    log?.info(LOG_AREA, 'engineer config updated', {
      enabled: config.enabled,
      language: config.language,
      modelId: config.modelId
    })
    return config
  }

  function cancel(): void {
    currentAbort?.abort()
  }

  function observeSafety(): void {
    observeGenerationSafety()
  }

  function resetLiveContext(): void {
    currentAbort?.abort()
    currentAbort = null
    recent.splice(0, recent.length)
  }

  return {
    ask,
    getStatus,
    ensureActiveModel,
    getConfig: () => config,
    setConfig,
    cancel,
    observeSafety,
    resetLiveContext,
    getLog: () => recent.slice()
  }
}

// ─── Config persistence (userData/engineer.json) ───────────────────────────────

function loadConfigSync(configPath: string): EngineerConfig {
  try {
    const raw = readFileSync(configPath, 'utf8')
    return mergeEngineerConfig(DEFAULT_ENGINEER_CONFIG, JSON.parse(raw) as EngineerConfigPatch)
  } catch {
    return { ...DEFAULT_ENGINEER_CONFIG }
  }
}

function saveConfigSync(configPath: string, config: EngineerConfig): void {
  try {
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  } catch (error) {
    logger.warn(LOG_AREA, 'failed to persist engineer.json', {
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

// ─── Module registration ───────────────────────────────────────────────────────

export function register(ctx: ModuleContext): void {
  const userData = ctx.app.getPath('userData')
  const configPath = join(userData, CONFIG_FILE)
  const modelsDir = join(userData, MODELS_DIR)
  const config = loadConfigSync(configPath)

  // Singletons — both are cheap to construct; neither touches the native module
  // (node-llama-cpp loads lazily on the first generation only).
  const modelManager = getModelManager({ modelsDir, activeModelId: config.modelId }, { logger })
  const runtime = getLlmRuntime(
    {
      modelId: config.modelId,
      maxTokens: config.maxTokens,
      idleUnloadMs: config.idleUnloadMs,
      ...(config.threads > 0 ? { threads: config.threads } : {})
    },
    { logger }
  )

  // Snapshot-only context: the optional engine getters (fuel/tire/lap/coach) live
  // inside other modules' register() closures and aren't reachable without editing
  // them, so we rely on the snapshot-derived fallbacks in context-pack/tools. The
  // ONE exception is coach findings: the proactive module publishes them to a
  // process-local singleton so the on-demand engineer can cite REAL coaching.
  const engineerContext: EngineerContext = {
    getSnapshot: () => ctx.telemetryHub.getLatest(),
    // Scope the cited findings to the CURRENT car/track so a previous session's
    // coaching is never quoted with confident numbers (see proactive-engineer).
    getCoachFindings: () => getLatestCoachFindings(ctx.telemetryHub.getLatest()),
    // WS-G predictions: the engineer can cite forward-looking estimates (catch
    // ahead/behind, fuel margin, tyre cliff, projected pace) with real numbers.
    getPredictions: () => getLatestPredictions()
  }

  let unitSystem: UnitSystem = 'metric'
  let racecraftLanguage = coachAdviceLanguageFromAppLanguage('auto', ctx.app.getLocale())
  let currentLiveContext = captureLiveTelemetryContext(ctx.telemetryHub.getLatest())
  const orchestrator = createEngineerOrchestrator({
    runtime,
    modelManager,
    context: engineerContext,
    racecraftContext: () => getLatestCoachRacecraftContext(ctx.telemetryHub.getLatest()),
    broadcast: (channel, payload) => ctx.broadcast(channel, payload),
    config,
    saveConfig: (next) => saveConfigSync(configPath, next),
    onConfigChange: (next) => {
      activeEngineerConfig = next
    },
    getUnitSystem: () => unitSystem,
    getRacecraftLanguage: () => racecraftLanguage,
    getLiveContext: () => currentLiveContext,
    logger
  })

  const liveGate = new LiveTelemetryGate()
  ctx.telemetryHub.on('snapshot', (snapshot) => {
    orchestrator.observeSafety()
    const decision = liveGate.observe(snapshot)
    currentLiveContext = decision.context
    if (decision.boundary) orchestrator.resetLiveContext()
  })

  settingsEvents.onChanged((settings) => {
    unitSystem = settings.unitSystem
    racecraftLanguage = coachAdviceLanguageFromAppLanguage(settings.language, ctx.app.getLocale())
    const language = speechLanguageFromAppLanguage(settings.language, ctx.app.getLocale())
    if (orchestrator.getConfig().language !== language) {
      void orchestrator.setConfig({ language })
    }
  })

  ctx.ipcMain.handle(ENGINEER_CHANNELS.ask, (_event, text: unknown) => orchestrator.ask(typeof text === 'string' ? text : String(text ?? '')))
  ctx.ipcMain.handle(ENGINEER_CHANNELS.getStatus, () => orchestrator.getStatus())
  ctx.ipcMain.handle(ENGINEER_CHANNELS.ensureModel, () => orchestrator.ensureActiveModel())
  ctx.ipcMain.handle(ENGINEER_CHANNELS.getConfig, () => orchestrator.getConfig())
  ctx.ipcMain.handle(ENGINEER_CHANNELS.setConfig, (_event, patch: EngineerConfigPatch) => orchestrator.setConfig(patch ?? {}))
  ctx.ipcMain.handle(ENGINEER_CHANNELS.cancel, () => {
    orchestrator.cancel()
    return true
  })

  ctx.app.once('before-quit', () => {
    void runtime.unload()
  })
}
