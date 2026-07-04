import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LlmRuntime,
  resolveThreads,
  resolveOptions,
  requiresReload,
  classifyLoadError,
  isNoBinaryError,
  DEFAULT_CPU_MAX_GENERATE_MS,
  type ChatPromptLike,
  type ChatPromptMeta,
  type ChatSessionLike,
  type LlamaBackend,
  type LlamaBackendLoader,
  type LlamaContextLike,
  type LlamaContextCreateOptions,
  type LlamaInstanceLike,
  type LlamaLoadModelOptions,
  type LlamaModelLike,
  type LlamaSequenceLike
} from './llm-runtime'

// ─── Fake node-llama-cpp backend ─────────────────────────────────────────────────

function realDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

interface Control {
  failGetLlama: boolean
  promptThrows: boolean
  createSessionThrows: boolean
  promptDelayMs: number
  response: unknown[]
  promptImpl?: (prompt: string, opts?: ChatPromptLike) => Promise<ChatPromptMeta>
}

interface Tracker {
  getLlamaCalls: Array<{ gpu: false }>
  loadModelCalls: LlamaLoadModelOptions[]
  createContextCalls: LlamaContextCreateOptions[]
  promptCalls: Array<{ prompt: string; opts?: ChatPromptLike }>
  llamas: FakeLlama[]
  sessions: FakeSession[]
  concurrent: number
  maxConcurrent: number
}

class FakeSequence implements LlamaSequenceLike {
  disposed = false
  readonly tokenMeter = { usedOutputTokens: 7, usedInputTokens: 3 }
  dispose(): void {
    this.disposed = true
  }
}

class FakeContext implements LlamaContextLike {
  disposed = false
  readonly sequences: FakeSequence[] = []
  constructor(readonly createOpts: LlamaContextCreateOptions) {}
  getSequence(): FakeSequence {
    const seq = new FakeSequence()
    this.sequences.push(seq)
    return seq
  }
  async dispose(): Promise<void> {
    this.disposed = true
  }
}

class FakeModel implements LlamaModelLike {
  disposed = false
  readonly contexts: FakeContext[] = []
  constructor(readonly loadOpts: LlamaLoadModelOptions) {}
  async createContext(opts: LlamaContextCreateOptions): Promise<FakeContext> {
    const ctx = new FakeContext(opts)
    this.contexts.push(ctx)
    return ctx
  }
  async dispose(): Promise<void> {
    this.disposed = true
  }
}

class FakeLlama implements LlamaInstanceLike {
  disposed = false
  readonly models: FakeModel[] = []
  constructor(readonly getOpts: { gpu: false }) {}
  async loadModel(opts: LlamaLoadModelOptions): Promise<FakeModel> {
    const model = new FakeModel(opts)
    this.models.push(model)
    return model
  }
  async dispose(): Promise<void> {
    this.disposed = true
  }
}

class FakeSession implements ChatSessionLike {
  disposed = false
  disposeSequenceArg: boolean | undefined
  constructor(
    readonly args: { contextSequence: LlamaSequenceLike; systemPrompt?: string },
    private readonly control: Control,
    private readonly tracker: Tracker
  ) {}
  async promptWithMeta(prompt: string, opts?: ChatPromptLike): Promise<ChatPromptMeta> {
    this.tracker.promptCalls.push({ prompt, opts })
    if (this.control.promptImpl) return this.control.promptImpl(prompt, opts)
    this.tracker.concurrent++
    this.tracker.maxConcurrent = Math.max(this.tracker.maxConcurrent, this.tracker.concurrent)
    if (this.control.promptDelayMs > 0) await realDelay(this.control.promptDelayMs)
    this.tracker.concurrent--
    if (opts?.signal?.aborted) throw new Error('aborted')
    if (this.control.promptThrows) throw new Error('prompt boom')
    return { responseText: `A:${prompt}`, response: this.control.response, stopReason: 'eogToken' }
  }
  dispose(opts?: { disposeSequence?: boolean }): void {
    this.disposed = true
    this.disposeSequenceArg = opts?.disposeSequence
  }
}

function makeBackend(overrides?: Partial<Control>): {
  backendLoader: LlamaBackendLoader
  tracker: Tracker
  control: Control
  loaderCalls: () => number
} {
  const control: Control = {
    failGetLlama: false,
    promptThrows: false,
    createSessionThrows: false,
    promptDelayMs: 0,
    response: [],
    ...overrides
  }
  const tracker: Tracker = {
    getLlamaCalls: [],
    loadModelCalls: [],
    createContextCalls: [],
    promptCalls: [],
    llamas: [],
    sessions: [],
    concurrent: 0,
    maxConcurrent: 0
  }
  let loaderCallCount = 0
  const backend: LlamaBackend = {
    async getLlama(opts) {
      tracker.getLlamaCalls.push(opts)
      if (control.failGetLlama) throw new Error('getLlama boom')
      const llama = new FakeLlama(opts)
      // patch loadModel/createContext to record calls into the shared tracker
      const origLoad = llama.loadModel.bind(llama)
      llama.loadModel = async (o) => {
        tracker.loadModelCalls.push(o)
        const model = await origLoad(o)
        const origCtx = model.createContext.bind(model)
        model.createContext = async (co) => {
          tracker.createContextCalls.push(co)
          return origCtx(co)
        }
        return model
      }
      tracker.llamas.push(llama)
      return llama
    },
    createChatSession(args) {
      if (control.createSessionThrows) throw new Error('createChatSession boom')
      const session = new FakeSession(args, control, tracker)
      tracker.sessions.push(session)
      return session
    }
  }
  const backendLoader: LlamaBackendLoader = async () => {
    loaderCallCount++
    return backend
  }
  return { backendLoader, tracker, control, loaderCalls: () => loaderCallCount }
}

const MODEL_PATH = '/data/models/test.gguf'

function makeRuntime(overrides?: Partial<Control>, opts?: Record<string, unknown>): {
  runtime: LlmRuntime
  tracker: Tracker
  control: Control
  loaderCalls: () => number
} {
  const { backendLoader, tracker, control, loaderCalls } = makeBackend(overrides)
  const runtime = new LlmRuntime(
    { modelPath: MODEL_PATH, threads: 3, contextSize: 1024, maxTokens: 80, idleUnloadMs: 0, ...opts },
    { backendLoader }
  )
  return { runtime, tracker, control, loaderCalls }
}

afterEach(() => {
  vi.useRealTimers()
})

// ─── Pure helpers ─────────────────────────────────────────────────────────────────

describe('resolveThreads', () => {
  it('leaves 2 cores for the sim and caps at 4', () => {
    expect(resolveThreads(8)).toBe(4)
    expect(resolveThreads(6)).toBe(4)
    expect(resolveThreads(4)).toBe(2)
    expect(resolveThreads(2)).toBe(1)
    expect(resolveThreads(1)).toBe(1)
    expect(resolveThreads(0)).toBe(1)
  })
})

describe('resolveOptions', () => {
  it('applies resource-minimal defaults', () => {
    const o = resolveOptions(undefined)
    expect(o.contextSize).toBe(2048)
    expect(o.maxTokens).toBe(150)
    expect(o.idleUnloadMs).toBe(3 * 60 * 1000)
    expect(o.threads).toBeGreaterThanOrEqual(1)
  })

  it('caps maxTokens at the hard ceiling', () => {
    expect(resolveOptions({ maxTokens: 99999 }).maxTokens).toBe(512)
    expect(resolveOptions({ maxTokens: -5 }).maxTokens).toBe(150)
  })
})

describe('requiresReload', () => {
  it('is true when model path / threads / contextSize change', () => {
    const base = resolveOptions({ modelPath: '/a', threads: 2, contextSize: 1024 })
    expect(requiresReload(base, resolveOptions({ modelPath: '/b' }, base))).toBe(true)
    expect(requiresReload(base, resolveOptions({ threads: 3 }, base))).toBe(true)
    expect(requiresReload(base, resolveOptions({ contextSize: 2048 }, base))).toBe(true)
    expect(requiresReload(base, resolveOptions({ maxTokens: 50 }, base))).toBe(false)
  })

  it('is true when the active modelId changes (live tier switch, no restart)', () => {
    const base = resolveOptions({ modelPath: '/a', modelId: 'qwen2.5-1.5b-instruct-q4' })
    // Switching tier (even before the new file is on disk) must force a reload.
    expect(requiresReload(base, resolveOptions({ modelId: 'llama-3.2-3b-instruct-q4' }, base))).toBe(true)
    // Same modelId → no spurious reload.
    expect(requiresReload(base, resolveOptions({ maxTokens: 42 }, base))).toBe(false)
    expect(requiresReload(base, resolveOptions({ modelId: 'qwen2.5-1.5b-instruct-q4' }, base))).toBe(false)
  })
})

// ─── Lazy load ──────────────────────────────────────────────────────────────────────

describe('lazy loading', () => {
  it('does not load the backend until the first generate()', async () => {
    const { runtime, tracker, loaderCalls } = makeRuntime()
    expect(runtime.isReady()).toBe(false)
    expect(loaderCalls()).toBe(0)
    expect(tracker.getLlamaCalls).toHaveLength(0)

    const result = await runtime.generate({ prompt: 'box this lap?' })
    expect(result.ok).toBe(true)
    expect(runtime.isReady()).toBe(true)
    expect(loaderCalls()).toBe(1)
    expect(tracker.getLlamaCalls).toHaveLength(1)
  })
})

// ─── CPU-only guarantees ──────────────────────────────────────────────────────────────

describe('CPU-only guarantees', () => {
  it('always passes gpu:false and gpuLayers:0, and bounded context options', async () => {
    const { runtime, tracker } = makeRuntime()
    await runtime.generate({ prompt: 'hi' })

    expect(tracker.getLlamaCalls[0]).toEqual({ gpu: false })
    expect(tracker.loadModelCalls[0]).toEqual({ modelPath: MODEL_PATH, gpuLayers: 0 })
    expect(tracker.createContextCalls[0]).toEqual({ contextSize: 1024, threads: 3, sequences: 1 })
  })
})

// ─── Bounded generation ───────────────────────────────────────────────────────────────

describe('bounded generation', () => {
  it('caps per-request maxTokens at the ceiling and passes through functions', async () => {
    const { runtime, tracker } = makeRuntime()
    const functions = { lap: { handler: () => 1 } }
    await runtime.generate({ prompt: 'q', maxTokens: 99999, functions })

    const call = tracker.promptCalls[0]
    expect(call.opts?.maxTokens).toBe(512)
    expect(call.opts?.functions).toBe(functions)
  })

  it('uses the configured default maxTokens when none is given', async () => {
    const { runtime, tracker } = makeRuntime()
    await runtime.generate({ prompt: 'q' })
    expect(tracker.promptCalls[0].opts?.maxTokens).toBe(80)
  })

  it('surfaces token count, ms and stopReason from the result', async () => {
    const { runtime } = makeRuntime()
    const r = await runtime.generate({ prompt: 'q' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.text).toBe('A:q')
      expect(r.tokens).toBe(7)
      expect(typeof r.ms).toBe('number')
      expect(r.stopReason).toBe('eogToken')
    }
  })
})

// ─── Single in-flight serialization ────────────────────────────────────────────────────

describe('single in-flight serialization', () => {
  it('never runs two inferences concurrently', async () => {
    const { runtime, tracker } = makeRuntime({ promptDelayMs: 15 })
    const results = await Promise.all([
      runtime.generate({ prompt: 'a' }),
      runtime.generate({ prompt: 'b' }),
      runtime.generate({ prompt: 'c' })
    ])
    expect(results.every((r) => r.ok)).toBe(true)
    expect(tracker.maxConcurrent).toBe(1)
    expect(tracker.sessions).toHaveLength(3)
    expect(runtime.getStatus().totalGenerations).toBe(3)
    expect(runtime.getStatus().queueLength).toBe(0)
  })

  it('unload() during an in-flight generation defers teardown (no dispose mid-inference)', async () => {
    const { runtime, tracker } = makeRuntime({ promptDelayMs: 30 })
    // Start a generation, then ask to unload WHILE it runs (mirrors setOptions/before-quit
    // landing mid-answer). The teardown must serialize behind the running generation — never
    // dispose the native context out from under the eval (which the old unload() did).
    const gen = runtime.generate({ prompt: 'a' })
    await Promise.resolve()
    const unloaded = runtime.unload()
    const result = await gen
    await unloaded
    // The generation completed normally (it wasn't killed by a premature dispose)...
    expect(result.ok).toBe(true)
    expect(tracker.maxConcurrent).toBe(1)
    // ...and the model is unloaded only AFTER it finished.
    expect(runtime.getStatus().ready).toBe(false)
  })

  it('loads the model exactly once across queued calls', async () => {
    const { runtime, tracker } = makeRuntime({ promptDelayMs: 10 })
    await Promise.all([
      runtime.generate({ prompt: 'a' }),
      runtime.generate({ prompt: 'b' })
    ])
    expect(tracker.llamas).toHaveLength(1)
    expect(tracker.createContextCalls).toHaveLength(1)
  })

  it('disposes each per-call session and its sequence (no KV bleed)', async () => {
    const { runtime, tracker } = makeRuntime()
    await runtime.generate({ prompt: 'a' })
    await runtime.generate({ prompt: 'b' })
    expect(tracker.sessions).toHaveLength(2)
    for (const s of tracker.sessions) {
      expect(s.disposed).toBe(true)
      expect(s.disposeSequenceArg).toBe(true)
    }
  })
})

// ─── Idle unload ─────────────────────────────────────────────────────────────────────────

describe('idle unload', () => {
  it('disposes context+model+llama after the idle timeout and reloads on next call', async () => {
    vi.useFakeTimers()
    const { runtime, tracker } = makeRuntime(undefined, { idleUnloadMs: 50 })

    await runtime.generate({ prompt: 'first' })
    expect(runtime.isReady()).toBe(true)
    const firstLlama = tracker.llamas[0]
    expect(firstLlama.disposed).toBe(false)

    await vi.advanceTimersByTimeAsync(60)

    expect(runtime.isReady()).toBe(false)
    expect(firstLlama.disposed).toBe(true)
    expect(firstLlama.models[0].disposed).toBe(true)
    expect(firstLlama.models[0].contexts[0].disposed).toBe(true)
    expect(runtime.getStatus().status).toBe('unloaded')

    // Transparent reload on the next call.
    await runtime.generate({ prompt: 'second' })
    expect(tracker.llamas).toHaveLength(2)
    expect(runtime.isReady()).toBe(true)
  })

  it('does not arm the idle timer when idleUnloadMs is 0', async () => {
    vi.useFakeTimers()
    const { runtime, tracker } = makeRuntime(undefined, { idleUnloadMs: 0 })
    await runtime.generate({ prompt: 'x' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(runtime.isReady()).toBe(true)
    expect(tracker.llamas[0].disposed).toBe(false)
  })
})

// ─── Never throws ─────────────────────────────────────────────────────────────────────────

describe('never throws into callers', () => {
  it('returns a failure result (not a throw) when load fails, then recovers', async () => {
    const { runtime, control, tracker } = makeRuntime({ failGetLlama: true })
    const bad = await runtime.generate({ prompt: 'q' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.code).toBe('load_failed')
    expect(runtime.isReady()).toBe(false)

    // Recover: subsequent call retries the load and succeeds.
    control.failGetLlama = false
    const good = await runtime.generate({ prompt: 'q2' })
    expect(good.ok).toBe(true)
    expect(tracker.llamas).toHaveLength(1)
  })

  it('returns generate_failed when inference throws', async () => {
    const { runtime } = makeRuntime({ promptThrows: true })
    const r = await runtime.generate({ prompt: 'q' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('generate_failed')
    // Model stays loaded for the next attempt.
    expect(runtime.isReady()).toBe(true)
  })

  it('disposes an orphaned sequence when session construction throws', async () => {
    const { runtime, tracker } = makeRuntime({ createSessionThrows: true })
    const r = await runtime.generate({ prompt: 'q' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('generate_failed')
    const seq = tracker.llamas[0].models[0].contexts[0].sequences[0]
    expect(seq.disposed).toBe(true)
    expect(runtime.isReady()).toBe(true)
  })

  it('returns no_model when no model path is configured', async () => {
    const { backendLoader } = makeBackend()
    const runtime = new LlmRuntime({ idleUnloadMs: 0 }, { backendLoader })
    const r = await runtime.generate({ prompt: 'q' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('no_model')
  })

  it('rejects empty prompts without loading', async () => {
    const { runtime, tracker } = makeRuntime()
    const r = await runtime.generate({ prompt: '' })
    expect(r.ok).toBe(false)
    expect(tracker.getLlamaCalls).toHaveLength(0)
  })

  it('honors a pre-aborted signal', async () => {
    const { runtime } = makeRuntime()
    const r = await runtime.generate({ prompt: 'q', signal: AbortSignal.abort() })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('aborted')
  })

  it('times out a runaway generation', async () => {
    const { backendLoader } = makeBackend({ promptDelayMs: 80 })
    const runtime = new LlmRuntime(
      { modelPath: MODEL_PATH, idleUnloadMs: 0, maxGenerateMs: 10 },
      { backendLoader }
    )
    const r = await runtime.generate({ prompt: 'slow' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('timeout')
    // Model stays loaded for the next attempt.
    expect(runtime.isReady()).toBe(true)
  })
})

// ─── unload / dispose idempotency ────────────────────────────────────────────────────────

describe('unload / dispose', () => {
  it('unload() is safe before any load and idempotent', async () => {
    const { runtime } = makeRuntime()
    await runtime.unload()
    await runtime.unload()
    expect(runtime.isReady()).toBe(false)
    expect(runtime.getStatus().status).toBe('unloaded')
  })

  it('dispose() frees resources and rejects further work', async () => {
    const { runtime, tracker } = makeRuntime()
    await runtime.generate({ prompt: 'q' })
    expect(runtime.isReady()).toBe(true)

    await runtime.dispose()
    expect(tracker.llamas[0].disposed).toBe(true)
    expect(runtime.getStatus().status).toBe('disposed')

    const r = await runtime.generate({ prompt: 'after' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('disposed')
  })
})

// ─── setOptions ────────────────────────────────────────────────────────────────────────────

describe('setOptions', () => {
  it('reloads transparently when a model-affecting option changes', async () => {
    const { runtime, tracker } = makeRuntime()
    await runtime.generate({ prompt: 'q' })
    expect(runtime.isReady()).toBe(true)

    runtime.setOptions({ threads: 1 })
    // unload runs synchronously up to its first await → already not ready.
    expect(runtime.isReady()).toBe(false)

    await runtime.generate({ prompt: 'q2' })
    expect(tracker.llamas).toHaveLength(2)
    expect(tracker.createContextCalls[1]).toEqual({ contextSize: 1024, threads: 1, sequences: 1 })
  })

  it('does not reload for a non-model option (maxTokens)', async () => {
    const { runtime, tracker } = makeRuntime()
    await runtime.generate({ prompt: 'q' })
    runtime.setOptions({ maxTokens: 40 })
    expect(runtime.isReady()).toBe(true)
    await runtime.generate({ prompt: 'q2' })
    expect(tracker.llamas).toHaveLength(1)
    expect(tracker.promptCalls[1].opts?.maxTokens).toBe(40)
  })
})

// ─── classifyLoadError (NoBinaryFoundError → backend_missing) ────────────────────────────────

describe('classifyLoadError', () => {
  it('maps node-llama-cpp NoBinaryFoundError (by error name) to backend_missing', () => {
    const err = new Error('No prebuilt binary found for this configuration')
    err.name = 'NoBinaryFoundError'
    const { code, message } = classifyLoadError(err)
    expect(code).toBe('backend_missing')
    expect(message).toMatch(/native runtime missing/i)
    expect(message).toMatch(/reinstall|rebuild/i)
  })

  it('maps NoBinaryFoundError detected in the message (name lost over IPC) to backend_missing', () => {
    const err = new Error('Loading failed: NoBinaryFoundError while resolving win-x64 backend')
    // name stays the generic 'Error' — classification must still catch it via the message.
    expect(err.name).toBe('Error')
    expect(classifyLoadError(err).code).toBe('backend_missing')
  })

  it('maps the human "no matching prebuilt binary found" phrasing to backend_missing', () => {
    expect(classifyLoadError(new Error('no matching prebuilt binary was found')).code).toBe(
      'backend_missing'
    )
    expect(classifyLoadError(new Error('No pre-built binaries found')).code).toBe('backend_missing')
  })

  it('does NOT misclassify an unrelated/corrupt-model load failure (stays load_failed)', () => {
    // A truncated GGUF surfaces as a generic load error — must remain distinct from
    // backend_missing so the UI runs the right recovery (re-download vs reinstall).
    const { code, message } = classifyLoadError(new Error('invalid gguf magic / unexpected EOF'))
    expect(code).toBe('load_failed')
    expect(message).toBe('invalid gguf magic / unexpected EOF')
  })

  it('handles non-Error throwables without crashing', () => {
    expect(classifyLoadError('NoBinaryFoundError').code).toBe('backend_missing')
    expect(classifyLoadError(null).code).toBe('load_failed')
    expect(classifyLoadError(undefined).code).toBe('load_failed')
  })
})

describe('isNoBinaryError', () => {
  it('matches by exact class name', () => {
    expect(isNoBinaryError('NoBinaryFoundError', 'anything')).toBe(true)
  })
  it('matches by message substring', () => {
    expect(isNoBinaryError('Error', '... NoBinaryFoundError ...')).toBe(true)
    expect(isNoBinaryError(undefined, 'no prebuilt binary found')).toBe(true)
  })
  it('returns false for unrelated load errors', () => {
    expect(isNoBinaryError('Error', 'invalid gguf')).toBe(false)
    expect(isNoBinaryError(undefined, undefined)).toBe(false)
  })
})

// ─── Timeout default selection (CPU-only budget) ─────────────────────────────────────────────

describe('resolveOptions — maxGenerateMs default', () => {
  it('defaults to the CPU-only budget (not the GPU-sized 20s) when unspecified', () => {
    expect(DEFAULT_CPU_MAX_GENERATE_MS).toBeGreaterThanOrEqual(60_000)
    expect(resolveOptions(undefined).maxGenerateMs).toBe(DEFAULT_CPU_MAX_GENERATE_MS)
    expect(resolveOptions({ modelPath: '/m.gguf' }).maxGenerateMs).toBe(DEFAULT_CPU_MAX_GENERATE_MS)
  })

  it('honors a caller-supplied positive maxGenerateMs override', () => {
    expect(resolveOptions({ maxGenerateMs: 30_000 }).maxGenerateMs).toBe(30_000)
    expect(resolveOptions({ maxGenerateMs: 5_000 }).maxGenerateMs).toBe(5_000)
  })

  it('ignores invalid (non-positive / non-finite) overrides and keeps the default', () => {
    expect(resolveOptions({ maxGenerateMs: 0 }).maxGenerateMs).toBe(DEFAULT_CPU_MAX_GENERATE_MS)
    expect(resolveOptions({ maxGenerateMs: -1 }).maxGenerateMs).toBe(DEFAULT_CPU_MAX_GENERATE_MS)
    expect(resolveOptions({ maxGenerateMs: Number.NaN }).maxGenerateMs).toBe(
      DEFAULT_CPU_MAX_GENERATE_MS
    )
  })

  it('preserves an existing resolved override when patching unrelated fields', () => {
    const prev = resolveOptions({ maxGenerateMs: 45_000 })
    expect(resolveOptions({ maxTokens: 40 }, prev).maxGenerateMs).toBe(45_000)
  })
})
