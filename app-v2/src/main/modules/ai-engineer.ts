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
import type { EngineerContext, EngineerToolset, IntentCommandKind } from '../../shared/ai-engineer'
import {
  DEFAULT_ENGINEER_CONFIG,
  ENGINEER_CHANNELS,
  type EngineerAnswer,
  type EngineerAnswerKind,
  type EngineerAnswerSource,
  type EngineerCommandDirective,
  type EngineerConfig,
  type EngineerConfigPatch,
  type EngineerStatus,
  mergeEngineerConfig,
  resolveCommandDirective
} from '../../shared/engineer-ipc'
import type { Logger } from '../../shared/logger'
import { buildContextPack, renderContextText } from '../ai/context-pack'
import { routeIntent } from '../ai/intent-router'
import { getLlmRuntime } from '../ai/llm-runtime'
import { getModelManager } from '../ai/model-manager'
import { buildEngineerTools } from '../ai/tools'
import { logger } from './logger'
import { getLatestPredictions } from './predictions'
import { getLatestCoachFindings } from './proactive-engineer'

const LOG_AREA = 'ai'
const CONFIG_FILE = 'engineer.json'
const MODELS_DIR = 'models'

// Token budget for the rendered context block (kept well under the model's window so
// the persona + tools + answer all fit). The pack itself targets < 400 tokens.
const CONTEXT_MAX_TOKENS = 380

// Throttle the success log so a chatty engineer can't flood the diagnostic log.
const ASK_LOG_THROTTLE_MS = 4000

// Keep the most recent Q&A pairs in memory (the renderer keeps its own scrollback).
const MAX_LOG_ENTRIES = 50

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
  broadcast(channel: string, payload: unknown): void
  /** Starting config (register loads it from disk before constructing). */
  config: EngineerConfig
  saveConfig(config: EngineerConfig): Promise<void> | void
  /** Notified whenever the live config changes (so siblings can read a fresh snapshot). */
  onConfigChange?(config: EngineerConfig): void
  logger?: Logger
  now?(): number
}

export interface EngineerOrchestrator {
  ask(question: string): Promise<EngineerAnswer>
  getStatus(): EngineerStatus
  ensureActiveModel(): Promise<EnsureModelResult>
  getConfig(): EngineerConfig
  setConfig(patch: EngineerConfigPatch): Promise<EngineerConfig>
  cancel(): void
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
  return config.language !== 'en-US'
}

// Tone block keyed by assertiveness — the ONLY part of the persona that changes
// between levels. Everything else (hard rules, brevity) is shared.
const TONE_PT: Record<EngineerConfig['assertiveness'], string> = {
  balanced: 'Você é um engenheiro de corrida experiente e calmo no rádio. Seja direto e útil, sem rodeios.',
  assertive:
    'Você é um engenheiro de corrida EXIGENTE no rádio. Vá direto ao ponto, aponte o erro do piloto sem enrolação e cobre melhora.',
  brutal:
    'Você é um engenheiro de corrida BRUTALMENTE direto no rádio. Aponte o erro na cara do piloto, sem rodeios e SEM elogio de consolação. Cobre que ele conserte agora.'
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
    'Exemplo de tom — P: como tô indo? R: Consistente. Onde o coaching apontar dá pra ganhar — confere os dados.',
    'Exemplo de tom — P: dá pra terminar? R: Depende do combustível; deixa eu checar antes de confirmar.'
  ].join('\n'),
  assertive: [
    'Exemplo de tom — P: como tô indo? R: Tá deixando tempo na mesa. Olha onde o coaching aponta e corrige.',
    'Exemplo de tom — P: e os pneus? R: Vou checar os dados antes de cobrar — sem achismo.'
  ].join('\n'),
  brutal: [
    'Exemplo de tom — P: como tô indo? R: Tá jogando tempo fora. Vê o coaching e conserta agora.',
    'Exemplo de tom — P: dá pra terminar com esse combustível? R: Só depois de eu olhar os números. Sem dado, sem promessa.',
    'Exemplo de tom — P: tá bom? R: Não enrola. Acha onde tá perdendo e ataca.'
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

function personaSystem(config: EngineerConfig): string {
  const level = config.assertiveness
  if (isPt(config)) {
    return [
      TONE_PT[level],
      'Responda SEMPRE em português do Brasil, em no máximo 2 frases curtas, como uma chamada de rádio.',
      'Use as ferramentas disponíveis para checar dados reais (combustível, pneus, gaps, posição, tempos, estratégia, coaching) antes de afirmar números.',
      'Nunca invente dados: se não houver telemetria, diga isso com honestidade.',
      FEWSHOT_PT[level]
    ].join(' ')
  }
  return [
    TONE_EN[level],
    'Always answer in English, in at most 2 short sentences, like a race radio call.',
    'Use the available tools to check real data (fuel, tyres, gaps, position, lap times, strategy, coaching) before stating any numbers.',
    'Never invent data: if there is no telemetry, say so honestly.',
    FEWSHOT_EN[level]
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
  disabled: { pt: 'O engenheiro de IA está desligado. Ative-o nas configurações.', en: 'The AI engineer is turned off. Enable it in settings.' },
  noModel: {
    pt: 'Não consegui carregar o modelo de IA. Verifica a conexão e tenta baixar de novo.',
    en: "Couldn't load the AI model. Check your connection and try downloading it again."
  },
  llmError: { pt: 'Não consegui processar agora. Tenta de novo em instantes.', en: "I couldn't process that right now. Try again shortly." },
  noCommand: { pt: 'Não tenho como fazer isso por aqui ainda.', en: "I can't do that from here yet." }
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

  function finalize(
    question: string,
    text: string,
    kind: EngineerAnswerKind,
    source: EngineerAnswerSource,
    command?: EngineerCommandDirective
  ): EngineerAnswer {
    const answer: EngineerAnswer = {
      id: nextId(),
      at: now(),
      question,
      text,
      speak: config.speakAnswers && text.length > 0,
      lang: config.language,
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

  async function llmAnswer(question: string): Promise<EngineerAnswer> {
    // Create the abort controller FIRST so "Parar" (engineer:cancel) can cancel even the
    // ~1 GB first-run model download — otherwise a surprise download mid online-race could
    // saturate the connection with no way to stop it.
    const controller = new AbortController()
    currentAbort = controller
    try {
      // Lazy model resolution (download-on-first-run with progress + cancellable).
      const ensured = await deps.modelManager.ensureModel(config.modelId, onModelProgress, controller.signal)
      if (!ensured.ok) {
        log?.warn(LOG_AREA, 'ensureModel failed', { modelId: config.modelId, error: ensured.error })
        return finalize(question, pick(config, FALLBACK.noModel), 'error', 'llm')
      }

      deps.runtime.setOptions({
        modelPath: ensured.path,
        modelId: config.modelId,
        maxTokens: config.maxTokens,
        idleUnloadMs: config.idleUnloadMs,
        ...(config.threads > 0 ? { threads: config.threads } : {})
      })

      const snapshot = deps.context.getSnapshot()
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
      const contextText = renderContextText(pack, { maxTokens: CONTEXT_MAX_TOKENS })
      const functions = adaptEngineerTools(buildEngineerTools(deps.context))
      const prompt = `${contextText}\n\n${promptLabel(config)}: ${question}`

      const gen = generationParams(config)
      const result = await deps.runtime.generateWithTools({
        system: personaSystem(config),
        prompt,
        functions,
        maxTokens: gen.maxTokens,
        temperature: gen.temperature,
        signal: controller.signal
      })
      if (!result.ok) {
        log?.warn(LOG_AREA, 'generate failed', { code: result.code })
        return finalize(question, pick(config, FALLBACK.llmError), 'error', 'llm')
      }
      const text = (result.text ?? '').trim() || pick(config, FALLBACK.llmError)
      return finalize(question, text, 'answer', 'llm')
    } catch (error) {
      // The runtime never throws, but keep the orchestrator bullet-proof regardless.
      log?.error(LOG_AREA, 'generate threw', { message: error instanceof Error ? error.message : String(error) })
      return finalize(question, pick(config, FALLBACK.llmError), 'error', 'llm')
    } finally {
      if (currentAbort === controller) currentAbort = null
    }
  }

  function runCommand(question: string, kind: IntentCommandKind, speak: string, args?: Record<string, unknown>): EngineerAnswer {
    const directive = resolveCommandDirective(kind, args)
    if (directive.executable) {
      // Execute by reusing the EXISTING renderer IPC: broadcast the directive and
      // let the EngineerView invoke the same channel the renderer uses today. Main
      // can't reach the other modules' live engines without editing them.
      deps.broadcast(ENGINEER_CHANNELS.command, directive)
      return finalize(question, speak, 'command', 'command', directive)
    }
    // No existing channel (setup.save / lap.mark) — honest spoken reply, no-op.
    return finalize(question, pick(config, FALLBACK.noCommand), 'command', 'command', directive)
  }

  async function ask(rawQuestion: string): Promise<EngineerAnswer> {
    const question = (rawQuestion ?? '').toString().trim()
    if (!question) return finalize('', pick(config, FALLBACK.empty), 'answer', 'system')
    if (!config.enabled) return finalize(question, pick(config, FALLBACK.disabled), 'disabled', 'system')

    const intent = routeIntent(question, deps.context)
    if (intent.type === 'answer') {
      return finalize(question, intent.text, 'answer', 'intent')
    }
    if (intent.type === 'command') {
      return runCommand(question, intent.kind, intent.speak, intent.args)
    }
    return llmAnswer(question)
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
    config = mergeEngineerConfig(config, { ...patch, updatedAt: now() })
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

  return {
    ask,
    getStatus,
    ensureActiveModel,
    getConfig: () => config,
    setConfig,
    cancel,
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

  const orchestrator = createEngineerOrchestrator({
    runtime,
    modelManager,
    context: engineerContext,
    broadcast: (channel, payload) => ctx.broadcast(channel, payload),
    config,
    saveConfig: (next) => saveConfigSync(configPath, next),
    onConfigChange: (next) => {
      activeEngineerConfig = next
    },
    logger
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
