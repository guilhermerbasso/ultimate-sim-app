// Local LLM runtime for the "AI Race Engineer" — main process ONLY.
//
// node-llama-cpp is a NATIVE module: it is imported here and NOWHERE ELSE (and
// only lazily, via dynamic import inside the loader, so the native binary is not
// touched until the very first generation). The renderer must never import this.
//
// RESOURCE-MINIMAL GUARANTEES (see the matching guards below):
//   • CPU-ONLY ALWAYS  — getLlama({ gpu: false }) + loadModel({ gpuLayers: 0 }).
//                        The sim owns the GPU; we never touch it.
//   • LAZY-LOAD        — nothing loads at startup; the model loads on the FIRST
//                        generate() call.
//   • IDLE-UNLOAD      — after `idleUnloadMs` with no work, the context+model are
//                        disposed (frees ~1.2GB) and transparently reloaded later.
//   • SINGLE IN-FLIGHT — every generation is serialized through a promise queue;
//                        two inferences never run at once (would spike CPU).
//   • BOUNDED          — small contextSize, capped threads, capped maxTokens, and
//                        a per-generation time budget.
//   • NEVER THROWS     — all paths are wrapped; failures surface as a Result, so a
//                        missing/broken model can never crash the app.

import { cpus } from 'node:os'
import {
  LLM_DEFAULTS,
  type GenerateErrorCode,
  type GenerateRequest,
  type GenerateResult,
  type GenerateStopReason,
  type LlmRuntimeOptions,
  type LlmRuntimeStatus,
  type LlmStatus
} from '../../shared/ai'
import type { LogArea, Logger } from '../../shared/logger'

const LOG_AREA: LogArea = 'ai'

// ─── Backend seam (so tests run without the native module) ───────────────────────
// Structural subset of node-llama-cpp we depend on. The default loader dynamically
// imports the real module; tests inject a fake.

export interface LlamaSequenceLike {
  dispose(): void
  readonly tokenMeter?: { readonly usedOutputTokens: number; readonly usedInputTokens: number }
}

export interface LlamaContextLike {
  getSequence(): LlamaSequenceLike
  dispose(): Promise<void>
}

export interface LlamaContextCreateOptions {
  contextSize?: number
  threads?: number
  sequences?: number
}

export interface LlamaModelLike {
  createContext(options: LlamaContextCreateOptions): Promise<LlamaContextLike>
  dispose(): Promise<void>
}

export interface LlamaLoadModelOptions {
  modelPath: string
  gpuLayers: number
}

export interface LlamaInstanceLike {
  loadModel(options: LlamaLoadModelOptions): Promise<LlamaModelLike>
  dispose(): Promise<void>
}

export interface ChatPromptLike {
  maxTokens?: number
  temperature?: number
  functions?: unknown
  signal?: AbortSignal
}

export interface ChatPromptMeta {
  responseText: string
  response: unknown[]
  stopReason?: string
}

export interface ChatSessionLike {
  promptWithMeta(prompt: string, options?: ChatPromptLike): Promise<ChatPromptMeta>
  dispose(options?: { disposeSequence?: boolean }): void
}

export interface LlamaGetOptions {
  gpu: false
}

export interface LlamaBackend {
  getLlama(options: LlamaGetOptions): Promise<LlamaInstanceLike>
  createChatSession(args: { contextSequence: LlamaSequenceLike; systemPrompt?: string }): ChatSessionLike
}

export type LlamaBackendLoader = () => Promise<LlamaBackend>

// Real backend: a lazy dynamic import so the native addon is only loaded on first
// use. This is the ONLY place node-llama-cpp is referenced.
const defaultBackendLoader: LlamaBackendLoader = async () => {
  const nlc = await import('node-llama-cpp')
  return {
    getLlama: (options) => nlc.getLlama(options) as unknown as Promise<LlamaInstanceLike>,
    createChatSession: ({ contextSequence, systemPrompt }) =>
      new nlc.LlamaChatSession({
        // contextSequence is opaque to us; it came straight from the real context.
        contextSequence: contextSequence as never,
        systemPrompt
      }) as unknown as ChatSessionLike
  }
}

export interface LlmRuntimeDeps {
  /** Override the node-llama-cpp backend (tests inject a fake). */
  backendLoader?: LlamaBackendLoader
  /** App logger (area 'ai'). Defaults to a silent logger. */
  logger?: Logger
  /** Injectable clock for tests. */
  now?: () => number
}

// ─── Errors ───────────────────────────────────────────────────────────────────────

class LlmError extends Error {
  constructor(
    readonly code: GenerateErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'LlmError'
  }
}

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {}
}

// Generation timings are logged at most this often (success path) so a chatty race
// engineer doesn't flood the diagnostic log. Errors are always logged.
const GENERATE_LOG_THROTTLE_MS = 5000

// CPU-ONLY time budget. This runtime forces gpu:false everywhere (the sim owns the GPU),
// and CPU inference is far slower than GPU. The shared LLM_DEFAULTS.maxGenerateMs (20s) is
// sized for GPU and routinely truncates legitimate CPU answers ("generation timed out" —
// see the P1 log evidence). Default to a 90s CPU budget instead; callers may still tighten
// or relax it per-runtime via LlmRuntimeOptions.maxGenerateMs.
export const DEFAULT_CPU_MAX_GENERATE_MS = 90_000

interface LoadedState {
  backend: LlamaBackend
  llama: LlamaInstanceLike
  model: LlamaModelLike
  context: LlamaContextLike
}

// ─── Pure helpers (exported for unit tests) ─────────────────────────────────────────

/** CPU threads default: leave 2 cores for the sim, never exceed 4, never below 1. */
export function resolveThreads(cpuCount: number): number {
  if (!Number.isFinite(cpuCount) || cpuCount <= 0) return 1
  return Math.min(4, Math.max(1, Math.floor(cpuCount) - 2))
}

function clampMaxTokens(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  // Hard ceiling so a caller can't request a runaway CPU generation.
  return Math.min(512, Math.floor(value))
}

function normalizeStopReason(reason: string | undefined): GenerateStopReason {
  switch (reason) {
    case 'eogToken':
    case 'maxTokens':
    case 'stopGenerationTrigger':
    case 'customStopTrigger':
    case 'functionCalls':
    case 'abort':
      return reason
    default:
      return 'unknown'
  }
}

/**
 * True when a model-LOAD error is node-llama-cpp's `NoBinaryFoundError` — i.e. it could
 * not locate a prebuilt native llama backend matching the running Electron/OS/arch ABI.
 * Matches on the error class name first, with a defensive message regex in case the class
 * name is lost across a serialization/IPC boundary. Pure + exported for unit testing.
 */
export function isNoBinaryError(name: string | undefined, message: string | undefined): boolean {
  const haystack = `${name ?? ''} ${message ?? ''}`
  return (
    name === 'NoBinaryFoundError' ||
    /NoBinaryFoundError/i.test(haystack) ||
    /no\s+(?:matching\s+)?(?:pre-?built\s+)?binar(?:y|ies)\s+(?:was\s+)?found/i.test(haystack)
  )
}

/**
 * Classify a model/backend LOAD failure into a distinct error code + actionable message.
 *
 * `NoBinaryFoundError` means the win-x64 `llama-addon.node` was not packaged/unpacked into
 * the app (see electron-builder.yml asarUnpack + scripts/fetch-win-llama.sh). That is a
 * PACKAGING/install problem, NOT a corrupt/truncated GGUF (the model-manager validates the
 * file size separately), so it gets its own `backend_missing` code + a "reinstall/rebuild"
 * message instead of the generic `load_failed` the UI treats as a re-download case.
 *
 * Pure + exported for unit testing.
 */
export function classifyLoadError(error: unknown): { code: GenerateErrorCode; message: string } {
  const name = error instanceof Error ? error.name : ''
  const raw = error instanceof Error ? error.message : String(error ?? '')
  if (isNoBinaryError(name, raw)) {
    return {
      code: 'backend_missing',
      message:
        'AI native runtime missing: the on-device llama backend binary was not found for ' +
        'this platform. Reinstall or rebuild the app to restore local AI features.'
    }
  }
  return { code: 'load_failed', message: raw || 'model load failed' }
}

export interface ResolvedLlmOptions {
  modelPath: string | null
  modelId?: string
  threads: number
  contextSize: number
  maxTokens: number
  temperature: number
  idleUnloadMs: number
  maxGenerateMs: number
}

function detectCpuCount(): number {
  try {
    return cpus().length
  } catch {
    return 2
  }
}

export function resolveOptions(
  options: LlmRuntimeOptions | undefined,
  previous?: ResolvedLlmOptions
): ResolvedLlmOptions {
  const base: ResolvedLlmOptions = previous ?? {
    modelPath: null,
    modelId: undefined,
    threads: resolveThreads(detectCpuCount()),
    contextSize: LLM_DEFAULTS.contextSize,
    maxTokens: LLM_DEFAULTS.maxTokens,
    temperature: LLM_DEFAULTS.temperature,
    idleUnloadMs: LLM_DEFAULTS.idleUnloadMs,
    maxGenerateMs: DEFAULT_CPU_MAX_GENERATE_MS
  }
  if (!options) return base
  return {
    modelPath: options.modelPath !== undefined ? options.modelPath || null : base.modelPath,
    modelId: options.modelId !== undefined ? options.modelId : base.modelId,
    threads:
      typeof options.threads === 'number' && options.threads > 0
        ? Math.min(16, Math.floor(options.threads))
        : base.threads,
    contextSize:
      typeof options.contextSize === 'number' && options.contextSize > 0
        ? Math.floor(options.contextSize)
        : base.contextSize,
    maxTokens: clampMaxTokens(options.maxTokens, base.maxTokens),
    temperature:
      typeof options.temperature === 'number' && options.temperature >= 0
        ? options.temperature
        : base.temperature,
    idleUnloadMs:
      typeof options.idleUnloadMs === 'number' && options.idleUnloadMs >= 0
        ? Math.floor(options.idleUnloadMs)
        : base.idleUnloadMs,
    maxGenerateMs:
      typeof options.maxGenerateMs === 'number' && options.maxGenerateMs > 0
        ? Math.floor(options.maxGenerateMs)
        : base.maxGenerateMs
  }
}

/** Fields whose change requires a reload of the already-loaded model. */
export function requiresReload(prev: ResolvedLlmOptions, next: ResolvedLlmOptions): boolean {
  return (
    prev.modelPath !== next.modelPath ||
    // modelId-aware: switching the active tier (Light/Balanced/Quality) must force a
    // reload even if the resolved modelPath was not re-supplied in the same patch (e.g.
    // the new model isn't on disk yet). The next generate() resolves + loads the new
    // file. Without this, selecting an already-downloaded model would silently keep the
    // previously loaded one until an app restart.
    (next.modelId !== undefined && prev.modelId !== next.modelId) ||
    prev.threads !== next.threads ||
    prev.contextSize !== next.contextSize
  )
}

// ─── Runtime ────────────────────────────────────────────────────────────────────────

export class LlmRuntime {
  private opts: ResolvedLlmOptions
  private readonly backendLoader: LlamaBackendLoader
  private readonly log: Logger
  private readonly now: () => number

  private backend: LlamaBackend | null = null
  private loaded: LoadedState | null = null
  private loadPromise: Promise<LoadedState> | null = null
  private status: LlmStatus = 'unloaded'
  private disposed = false

  private loadedAt: number | null = null
  private lastUsedAt: number | null = null
  private totalGenerations = 0
  private lastGenerateLogAt = 0

  // Single in-flight serialization.
  private chain: Promise<unknown> = Promise.resolve()
  private waiting = 0
  private running = false

  private idleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options?: LlmRuntimeOptions, deps?: LlmRuntimeDeps) {
    this.opts = resolveOptions(options)
    this.backendLoader = deps?.backendLoader ?? defaultBackendLoader
    this.log = deps?.logger ?? silentLogger
    this.now = deps?.now ?? (() => Date.now())
  }

  // ── Status ──────────────────────────────────────────────────────────────────────

  isReady(): boolean {
    return this.loaded !== null && !this.disposed
  }

  isLoading(): boolean {
    return this.loadPromise !== null
  }

  isBusy(): boolean {
    return this.running || this.isLoading()
  }

  getStatus(): LlmRuntimeStatus {
    return {
      status: this.status,
      ready: this.isReady(),
      loading: this.isLoading(),
      busy: this.isBusy(),
      modelPath: this.opts.modelPath,
      loadedAt: this.loadedAt,
      lastUsedAt: this.lastUsedAt,
      totalGenerations: this.totalGenerations,
      queueLength: this.waiting
    }
  }

  getOptions(): ResolvedLlmOptions {
    return { ...this.opts }
  }

  // ── Configuration ────────────────────────────────────────────────────────────────

  // Update tunables. Model-affecting changes (modelPath/threads/contextSize) while
  // loaded trigger a transparent unload so the next generate() reloads with them.
  setOptions(patch: LlmRuntimeOptions): void {
    const next = resolveOptions(patch, this.opts)
    const needsReload = this.loaded !== null && requiresReload(this.opts, next)
    this.opts = next
    if (needsReload) {
      this.log.info(LOG_AREA, 'options changed — scheduling reload', {
        modelPath: next.modelPath,
        threads: next.threads,
        contextSize: next.contextSize
      })
      void this.unload()
    }
  }

  // ── Generation ───────────────────────────────────────────────────────────────────

  generate(request: GenerateRequest): Promise<GenerateResult> {
    return this.enqueue(() => this.runGenerate(request))
  }

  // Tool/function-calling variant: the model may call any of `functions` (a record
  // of node-llama-cpp `defineChatSessionFunction(...)` / `defineTool(...)` objects)
  // during generation; node-llama-cpp executes the handlers and continues, and the
  // final `text` already reflects their results.
  generateWithTools(request: GenerateRequest): Promise<GenerateResult> {
    return this.enqueue(() => this.runGenerate(request))
  }

  private async runGenerate(request: GenerateRequest): Promise<GenerateResult> {
    if (this.disposed) return { ok: false, error: 'runtime disposed', code: 'disposed' }
    if (request.signal?.aborted) return { ok: false, error: 'aborted before start', code: 'aborted' }
    if (typeof request.prompt !== 'string' || request.prompt.length === 0) {
      return { ok: false, error: 'empty prompt', code: 'generate_failed' }
    }

    let loaded: LoadedState
    try {
      loaded = await this.ensureLoaded()
    } catch (error) {
      const { code, message } = toLlmError(error, 'load_failed')
      this.status = 'error'
      this.log.error(LOG_AREA, 'model load failed', { code, message })
      return { ok: false, error: message, code }
    }

    const start = this.now()
    this.status = 'generating'
    let sequence: LlamaSequenceLike | null = null
    let session: ChatSessionLike | null = null
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.opts.maxGenerateMs)
    if (typeof timer === 'object' && timer && 'unref' in timer) {
      ;(timer as { unref?: () => void }).unref?.()
    }
    const onCallerAbort = (): void => controller.abort()
    request.signal?.addEventListener('abort', onCallerAbort, { once: true })

    try {
      sequence = loaded.context.getSequence()
      session = loaded.backend.createChatSession({
        contextSequence: sequence,
        systemPrompt: request.system
      })
      const maxTokens = clampMaxTokens(request.maxTokens, this.opts.maxTokens)
      const meta = await session.promptWithMeta(request.prompt, {
        maxTokens,
        temperature:
          typeof request.temperature === 'number' ? request.temperature : this.opts.temperature,
        functions: request.functions as unknown,
        signal: controller.signal
      })

      const ms = this.now() - start
      const tokens = sequence.tokenMeter?.usedOutputTokens
      const functionCalls = countFunctionCalls(meta.response)
      this.totalGenerations++
      this.lastUsedAt = this.now()
      this.logGenerate(ms, tokens, functionCalls, meta.stopReason)
      return {
        ok: true,
        text: meta.responseText ?? '',
        tokens,
        ms,
        functionCalls,
        stopReason: normalizeStopReason(meta.stopReason),
        modelId: this.opts.modelId
      }
    } catch (error) {
      if (request.signal?.aborted && !timedOut) {
        return { ok: false, error: 'aborted', code: 'aborted' }
      }
      if (timedOut) {
        this.log.warn(LOG_AREA, 'generation timed out', { maxGenerateMs: this.opts.maxGenerateMs })
        return { ok: false, error: 'generation timed out', code: 'timeout' }
      }
      const { message } = toLlmError(error, 'generate_failed')
      this.log.error(LOG_AREA, 'generation failed', { message })
      return { ok: false, error: message, code: 'generate_failed' }
    } finally {
      clearTimeout(timer)
      request.signal?.removeEventListener('abort', onCallerAbort)
      // Dispose the per-call session AND its sequence so KV-cache state never
      // bleeds between turns (each generate is an independent one-shot).
      try {
        if (session) {
          session.dispose({ disposeSequence: true })
        } else if (sequence) {
          // Session never got constructed — dispose the orphan sequence directly so
          // a `sequences: 1` context can hand out the next one.
          sequence.dispose()
        }
      } catch {
        // ignore — disposal must never throw into the caller
      }
      if (!this.disposed) this.status = this.loaded ? 'ready' : 'unloaded'
    }
  }

  // ── Loading / unloading ─────────────────────────────────────────────────────────

  private ensureLoaded(): Promise<LoadedState> {
    if (this.disposed) return Promise.reject(new LlmError('disposed', 'runtime disposed'))
    if (this.loaded) return Promise.resolve(this.loaded)
    if (!this.opts.modelPath) {
      return Promise.reject(new LlmError('no_model', 'no model path configured'))
    }
    if (!this.loadPromise) {
      this.status = 'loading'
      this.loadPromise = this.doLoad().finally(() => {
        this.loadPromise = null
      })
    }
    return this.loadPromise
  }

  private async doLoad(): Promise<LoadedState> {
    const modelPath = this.opts.modelPath
    if (!modelPath) throw new LlmError('no_model', 'no model path configured')
    const start = this.now()
    let llama: LlamaInstanceLike | null = null
    let model: LlamaModelLike | null = null
    let context: LlamaContextLike | null = null
    try {
      if (!this.backend) this.backend = await this.backendLoader()
      const backend = this.backend
      // CPU-ONLY: never negotiate a GPU.
      llama = await backend.getLlama({ gpu: false })
      // CPU-ONLY: zero offloaded layers.
      model = await llama.loadModel({ modelPath, gpuLayers: 0 })
      context = await model.createContext({
        contextSize: this.opts.contextSize,
        threads: this.opts.threads,
        sequences: 1
      })
      const loaded: LoadedState = { backend, llama, model, context }
      this.loaded = loaded
      this.loadedAt = this.now()
      this.status = 'ready'
      this.log.info(LOG_AREA, 'model loaded', {
        ms: this.now() - start,
        modelPath,
        modelId: this.opts.modelId,
        threads: this.opts.threads,
        contextSize: this.opts.contextSize,
        gpu: false
      })
      this.armIdleTimer()
      return loaded
    } catch (error) {
      // Roll back any partial allocation so a retry starts clean.
      await safeDisposeContext(context)
      await safeDisposeModel(model)
      await safeDisposeLlama(llama)
      this.loaded = null
      this.loadedAt = null
      this.status = 'error'
      if (error instanceof LlmError) throw error
      // Distinguish a missing native backend (NoBinaryFoundError — the win-x64 llama-addon
      // wasn't packaged/unpacked) from a generic load failure, so the UI can prompt a
      // reinstall/rebuild instead of re-validating/re-downloading the GGUF file.
      const { code, message } = classifyLoadError(error)
      throw new LlmError(code, message)
    }
  }

  // Free the model + context (≈1.2GB) but keep the runtime usable — the next
  // generate() reloads transparently. Idempotent and never throws.
  async unload(): Promise<void> {
    // Serialize teardown with generations so we NEVER dispose a native context mid-
    // inference (an addon crash that would take down overlays + iFlag mid-race). If work
    // is in-flight or queued (e.g. the user changes threads / switches model DURING an
    // open-ended answer → setOptions → unload), run the teardown as a queued task so it
    // lands AFTER the current generation. Otherwise tear down immediately. The idle timer
    // already pre-checks running/waiting, so its call lands on the fast path.
    if (this.running || this.waiting > 0) {
      await this.enqueue(() => this.unloadNow())
      return
    }
    await this.unloadNow()
  }

  private async unloadNow(): Promise<void> {
    this.clearIdleTimer()
    const loaded = this.loaded
    this.loaded = null
    this.loadedAt = null
    if (!loaded) {
      if (!this.disposed) this.status = 'unloaded'
      return
    }
    const start = this.now()
    await safeDisposeContext(loaded.context)
    await safeDisposeModel(loaded.model)
    await safeDisposeLlama(loaded.llama)
    if (!this.disposed) this.status = 'unloaded'
    this.log.info(LOG_AREA, 'model unloaded', { ms: this.now() - start })
  }

  // Permanent teardown: unload AND drop the backend. After dispose the runtime
  // rejects further work.
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.unload()
    this.backend = null
    this.status = 'disposed'
    this.log.info(LOG_AREA, 'runtime disposed')
  }

  // ── Internals ────────────────────────────────────────────────────────────────────

  // Serialize every unit of work so at most ONE load-or-generate runs at a time.
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    this.waiting++
    // A queued call must not be unloaded out from under it.
    this.clearIdleTimer()
    const result = this.chain.then(
      () => {
        this.waiting--
        this.running = true
        return task()
      },
      () => {
        this.waiting--
        this.running = true
        return task()
      }
    )
    const settled = result.then(
      () => this.afterTask(),
      () => this.afterTask()
    )
    // Keep the chain alive regardless of individual task outcome.
    this.chain = settled
    return result
  }

  private afterTask(): void {
    this.running = false
    // Only re-arm idle-unload once the queue has fully drained.
    if (this.waiting === 0 && !this.running) this.armIdleTimer()
  }

  private armIdleTimer(): void {
    this.clearIdleTimer()
    if (this.disposed) return
    if (this.opts.idleUnloadMs <= 0) return
    if (!this.loaded) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      // Don't unload mid-flight; if work arrived, the timer was cleared already.
      if (this.running || this.waiting > 0) return
      this.log.info(LOG_AREA, 'idle timeout — unloading model', {
        idleUnloadMs: this.opts.idleUnloadMs
      })
      void this.unload()
    }, this.opts.idleUnloadMs)
    if (typeof this.idleTimer === 'object' && this.idleTimer && 'unref' in this.idleTimer) {
      ;(this.idleTimer as { unref?: () => void }).unref?.()
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private logGenerate(
    ms: number,
    tokens: number | undefined,
    functionCalls: number,
    stopReason: string | undefined
  ): void {
    const at = this.now()
    // Throttle the success path so a chatty engineer doesn't flood the log; always
    // log the first call after a load and slow calls.
    const slow = ms > 2000
    if (!slow && at - this.lastGenerateLogAt < GENERATE_LOG_THROTTLE_MS) return
    this.lastGenerateLogAt = at
    this.log.info(LOG_AREA, 'generation complete', {
      ms,
      tokens,
      tokensPerSec: tokens && ms > 0 ? Math.round((tokens / ms) * 1000) : undefined,
      functionCalls,
      stopReason,
      total: this.totalGenerations
    })
  }
}

// ─── Disposal helpers (never throw) ─────────────────────────────────────────────────

async function safeDisposeContext(context: LlamaContextLike | null): Promise<void> {
  if (!context) return
  try {
    await context.dispose()
  } catch {
    // ignore
  }
}

async function safeDisposeModel(model: LlamaModelLike | null): Promise<void> {
  if (!model) return
  try {
    await model.dispose()
  } catch {
    // ignore
  }
}

async function safeDisposeLlama(llama: LlamaInstanceLike | null): Promise<void> {
  if (!llama) return
  try {
    await llama.dispose()
  } catch {
    // ignore
  }
}

function countFunctionCalls(response: unknown[] | undefined): number {
  if (!Array.isArray(response)) return 0
  let count = 0
  for (const item of response) {
    if (item && typeof item === 'object' && (item as { type?: unknown }).type === 'functionCall') {
      count++
    }
  }
  return count
}

function toLlmError(error: unknown, fallback: GenerateErrorCode): { code: GenerateErrorCode; message: string } {
  if (error instanceof LlmError) return { code: error.code, message: error.message }
  if (error instanceof Error) return { code: fallback, message: error.message }
  return { code: fallback, message: String(error) }
}

// ─── Singleton accessor ─────────────────────────────────────────────────────────────

let instance: LlmRuntime | null = null

// App-wide singleton. The orchestrator should call this once with the resolved
// model path + the app logger, then everyone else reuses it.
export function getLlmRuntime(options?: LlmRuntimeOptions, deps?: LlmRuntimeDeps): LlmRuntime {
  if (!instance) {
    instance = new LlmRuntime(options, deps)
  } else if (options) {
    instance.setOptions(options)
  }
  return instance
}

// Tear down and clear the singleton (used by tests and app teardown).
export async function resetLlmRuntime(): Promise<void> {
  if (instance) {
    await instance.dispose()
    instance = null
  }
}
