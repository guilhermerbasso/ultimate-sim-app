import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  EnsureModelResult,
  GenerateRequest,
  GenerateResult,
  LlmRuntimeStatus,
  ModelId,
  ModelStatus
} from '../../shared/ai'
import type { EngineerContext } from '../../shared/ai-engineer'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import {
  DEFAULT_ENGINEER_CONFIG,
  DEFAULT_PRESET_QUESTIONS,
  ENGINEER_CHANNELS,
  ENGINEER_LIMITS,
  ENGINEER_PUSH_TO_TALK_ACTION_ID,
  type EngineerConfig,
  listEngineerActions,
  mergeEngineerConfig,
  presetActionId,
  resolveEngineerAction,
  sanitizeButtonBinding,
  sanitizePresetQuestions
} from '../../shared/engineer-ipc'
import {
  adaptEngineerTools,
  createEngineerOrchestrator,
  type EngineerOrchestratorDeps,
  generationParams
} from './ai-engineer'
import { buildEngineerTools } from '../ai/tools'

// ─── Fakes (no real model, no Electron) ──────────────────────────────────────

const READY_STATUS: LlmRuntimeStatus = {
  status: 'unloaded',
  ready: false,
  loading: false,
  busy: false,
  modelPath: null,
  loadedAt: null,
  lastUsedAt: null,
  totalGenerations: 0,
  queueLength: 0
}

function makeRuntime(text = 'engineer response') {
  return {
    generateWithTools: vi.fn(
      async (_req: GenerateRequest): Promise<GenerateResult> => ({ ok: true, text, tokens: 12, ms: 7, functionCalls: 0, stopReason: 'eogToken' })
    ),
    getStatus: () => READY_STATUS,
    setOptions: vi.fn(),
    unload: vi.fn(async () => undefined)
  }
}

function makeModelManager(modelId: ModelId) {
  const present: ModelStatus = {
    id: modelId,
    label: 'Fake',
    uri: 'hf:fake',
    fileName: 'fake.gguf',
    approxBytes: 1,
    quant: 'Q4_K_M',
    license: 'Apache-2.0',
    contextSize: 2048,
    tier: 'balanced',
    present: true,
    active: true,
    path: '/models/fake.gguf'
  }
  return {
    ensureModel: vi.fn(async (id?: ModelId): Promise<EnsureModelResult> => ({ ok: true, id: id ?? modelId, path: '/models/fake.gguf', cached: true })),
    listModels: () => [present],
    getActiveModelId: () => modelId,
    setActiveModel: vi.fn(() => true),
    getActiveModelPath: () => '/models/fake.gguf'
  }
}

interface Harness {
  deps: EngineerOrchestratorDeps
  runtime: ReturnType<typeof makeRuntime>
  modelManager: ReturnType<typeof makeModelManager>
  broadcast: ReturnType<typeof vi.fn>
  saveConfig: ReturnType<typeof vi.fn>
}

function makeHarness(overrides?: { config?: Partial<EngineerConfig>; snapshot?: TelemetrySnapshot | null }): Harness {
  const config: EngineerConfig = { ...DEFAULT_ENGINEER_CONFIG, ...overrides?.config }
  const runtime = makeRuntime()
  const modelManager = makeModelManager(config.modelId)
  const broadcast = vi.fn()
  const saveConfig = vi.fn(async () => undefined)
  const context: EngineerContext = { getSnapshot: () => overrides?.snapshot ?? null }
  const deps: EngineerOrchestratorDeps = {
    runtime,
    modelManager,
    context,
    broadcast,
    config,
    saveConfig,
    now: () => 1000
  }
  return { deps, runtime, modelManager, broadcast, saveConfig }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('createEngineerOrchestrator.ask', () => {
  let h: Harness
  beforeEach(() => {
    h = makeHarness()
  })

  it('answers a deterministic intent question WITHOUT loading the LLM', async () => {
    const orch = createEngineerOrchestrator(h.deps)
    const answer = await orch.ask('boxes agora?')

    expect(h.runtime.generateWithTools).not.toHaveBeenCalled()
    expect(h.modelManager.ensureModel).not.toHaveBeenCalled()
    expect(answer.kind).toBe('answer')
    expect(answer.source).toBe('intent')
    // No telemetry → deterministic "no data" reply (English default).
    expect(answer.text).toBe('No telemetry right now.')
    expect(h.broadcast).toHaveBeenCalledWith(ENGINEER_CHANNELS.answer, expect.objectContaining({ source: 'intent' }))
  })

  it('routes an open-ended question through the LLM exactly once, with tools + context', async () => {
    const orch = createEngineerOrchestrator(h.deps)
    const answer = await orch.ask('What do you think of my race so far?')

    expect(h.modelManager.ensureModel).toHaveBeenCalledTimes(1)
    expect(h.runtime.generateWithTools).toHaveBeenCalledTimes(1)

    const req = h.runtime.generateWithTools.mock.calls[0][0] as GenerateRequest
    // All 12 read-only engineer tools are exposed to the model.
    expect(Object.keys(req.functions ?? {})).toHaveLength(12)
    // Context block + the user question are both in the prompt.
    expect(req.prompt).toContain('Question:')
    expect(req.prompt).toContain('What do you think')
    expect(req.system).toContain('engineer')
    // Brutal (the default) stays at a LOW temperature so tool-calls stay reliable.
    expect(req.temperature).toBeLessThanOrEqual(0.3)

    expect(answer.source).toBe('llm')
    expect(answer.kind).toBe('answer')
    expect(answer.text).toBe('engineer response')
    // The answer carries its language so the renderer can pick the right TTS voice.
    expect(answer.lang).toBe('en-US')
  })

  it('selects an English persona for en-US LLM answers', async () => {
    const harness = makeHarness({ config: { language: 'en-US' } })
    const orch = createEngineerOrchestrator(harness.deps)

    await orch.ask('Give me a qualitative read on my race craft')

    const req = harness.runtime.generateWithTools.mock.calls[0][0] as GenerateRequest
    expect(req.system).toContain('Always answer in English')
    expect(req.system).not.toContain('American English')
  })

  it('selects a PT-BR persona for pt-BR LLM answers', async () => {
    const harness = makeHarness({ config: { language: 'pt-BR' } })
    const orch = createEngineerOrchestrator(harness.deps)

    await orch.ask('Quero uma leitura qualitativa livre da minha pilotagem')

    const req = harness.runtime.generateWithTools.mock.calls[0][0] as GenerateRequest
    expect(req.system).toContain('Responda sempre em PT-BR')
    expect(req.system).toContain('Você é um engenheiro de corrida')
    expect(req.system).not.toContain('Always answer in American English')
  })

  it('executes a command intent by broadcasting the existing-IPC directive (no LLM)', async () => {
    const orch = createEngineerOrchestrator(h.deps)
    const answer = await orch.ask('next dashboard')

    expect(h.runtime.generateWithTools).not.toHaveBeenCalled()
    expect(answer.kind).toBe('command')
    expect(answer.command).toMatchObject({ kind: 'dashboard.next', channel: 'app:dash:cycle', args: ['next'], executable: true })
    expect(answer.text).toBe('Next dashboard.')
    expect(h.broadcast).toHaveBeenCalledWith(
      ENGINEER_CHANNELS.command,
      expect.objectContaining({ kind: 'dashboard.next', channel: 'app:dash:cycle' })
    )
  })

  it('maps revlights enable to the setEnabled directive', async () => {
    const orch = createEngineerOrchestrator(h.deps)
    const answer = await orch.ask('ligar revlights')

    expect(answer.kind).toBe('command')
    expect(answer.command).toMatchObject({ kind: 'revlights.enable', channel: 'revlights:setEnabled', args: [true] })
    expect(h.broadcast).toHaveBeenCalledWith(ENGINEER_CHANNELS.command, expect.objectContaining({ kind: 'revlights.enable' }))
  })

  it('gives an honest reply (no broadcast) for a command with no existing IPC channel', async () => {
    const orch = createEngineerOrchestrator(h.deps)
    const answer = await orch.ask('salvar setup')

    expect(answer.kind).toBe('command')
    expect(answer.command).toMatchObject({ kind: 'setup.save', channel: null, executable: false })
    expect(answer.text).toBe("I can't do that from here yet.")
    expect(h.broadcast).not.toHaveBeenCalledWith(ENGINEER_CHANNELS.command, expect.anything())
  })

  it('short-circuits with a friendly note when disabled', async () => {
    const harness = makeHarness({ config: { enabled: false } })
    const orch = createEngineerOrchestrator(harness.deps)
    const answer = await orch.ask('boxes agora?')

    expect(answer.kind).toBe('disabled')
    expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
    expect(answer.text).toContain('turned off')
  })

  it('falls back gracefully when the model cannot be ensured', async () => {
    const harness = makeHarness()
    harness.modelManager.ensureModel.mockResolvedValueOnce({ ok: false, id: harness.deps.config.modelId, error: 'offline' })
    const orch = createEngineerOrchestrator(harness.deps)
    const answer = await orch.ask('me explica a strategy ideal pra hoje')

    expect(answer.kind).toBe('error')
    expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
    expect(answer.text.length).toBeGreaterThan(0)
  })
})

describe('createEngineerOrchestrator.setConfig', () => {
  it('round-trips, persists, and re-targets the runtime + model', async () => {
    const h = makeHarness()
    const orch = createEngineerOrchestrator(h.deps)

    const next = await orch.setConfig({ language: 'en-US', maxTokens: 222, threads: 3, modelId: 'qwen2.5-0.5b-instruct-q4' })

    expect(next.language).toBe('en-US')
    expect(next.maxTokens).toBe(222)
    expect(next.threads).toBe(3)
    expect(next.modelId).toBe('qwen2.5-0.5b-instruct-q4')
    expect(orch.getConfig().language).toBe('en-US')
    expect(h.saveConfig).toHaveBeenCalledWith(expect.objectContaining({ language: 'en-US', maxTokens: 222 }))
    expect(h.modelManager.setActiveModel).toHaveBeenCalledWith('qwen2.5-0.5b-instruct-q4')
    expect(h.runtime.setOptions).toHaveBeenCalled()
    expect(h.broadcast).toHaveBeenCalledWith(ENGINEER_CHANNELS.statusEvent, expect.objectContaining({ enabled: true }))
  })

  it('honors speakAnswers=false by not marking answers spoken', async () => {
    const h = makeHarness({ config: { speakAnswers: false } })
    const orch = createEngineerOrchestrator(h.deps)
    const answer = await orch.ask('boxes agora?')
    expect(answer.speak).toBe(false)
  })

  it('switching modelId re-targets the runtime with the new modelId so it reloads', async () => {
    const h = makeHarness({ config: { modelId: 'qwen2.5-1.5b-instruct-q4' } })
    const orch = createEngineerOrchestrator(h.deps)

    await orch.setConfig({ modelId: 'llama-3.2-3b-instruct-q4' })

    expect(h.modelManager.setActiveModel).toHaveBeenCalledWith('llama-3.2-3b-instruct-q4')
    // setOptions must carry the new modelId so requiresReload (modelId-aware) fires —
    // the running model switches without an app restart.
    expect(h.runtime.setOptions).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'llama-3.2-3b-instruct-q4' }))
  })
})

describe('engineer config — proactive default', () => {
  it('defaults proactiveCoaching ON (corner+directional coaching in races; Live Coach yields in races)', () => {
    expect(DEFAULT_ENGINEER_CONFIG.proactiveCoaching).toBe(true)
    expect(DEFAULT_ENGINEER_CONFIG.enabled).toBe(true)
  })
})

describe('sanitizePresetQuestions', () => {
  it('drops blank/invalid entries, dedupes ids, and clamps lengths', () => {
    const out = sanitizePresetQuestions([
      { id: 'a', label: 'A', text: 'first' },
      { id: 'a', label: 'dup', text: 'duplicate id ignored' },
      { id: '', label: 'no id', text: 'x' },
      { id: 'b', label: '', text: '   ' }, // blank text → dropped
      { id: 'c', label: 'x'.repeat(99), text: 'y'.repeat(999) },
      null,
      'nope'
    ] as never)
    expect(out.map((q) => q.id)).toEqual(['a', 'c'])
    const c = out.find((q) => q.id === 'c')
    expect(c?.label.length).toBeLessThanOrEqual(ENGINEER_LIMITS.presetLabelMax)
    expect(c?.text.length).toBeLessThanOrEqual(ENGINEER_LIMITS.presetTextMax)
  })

  it('caps the number of presets', () => {
    const many = Array.from({ length: ENGINEER_LIMITS.presetQuestionsMax + 5 }, (_, i) => ({ id: `p${i}`, label: `L${i}`, text: `t${i}` }))
    expect(sanitizePresetQuestions(many)).toHaveLength(ENGINEER_LIMITS.presetQuestionsMax)
  })

  it('returns [] for non-arrays', () => {
    expect(sanitizePresetQuestions(undefined)).toEqual([])
    expect(sanitizePresetQuestions({} as never)).toEqual([])
  })
})

describe('sanitizeButtonBinding', () => {
  it('accepts a valid binding and rejects bad ones', () => {
    expect(sanitizeButtonBinding({ buttonIndex: 3, gamepadIndex: 1, gamepadId: 'pad' })).toEqual({
      buttonIndex: 3,
      gamepadIndex: 1,
      gamepadId: 'pad'
    })
    expect(sanitizeButtonBinding({ buttonIndex: -1 })).toBeNull()
    expect(sanitizeButtonBinding({})).toBeNull()
    expect(sanitizeButtonBinding(null)).toBeNull()
  })
})

describe('mergeEngineerConfig — presets + button bindings', () => {
  it('seeds default presets and empty bindings', () => {
    expect(DEFAULT_ENGINEER_CONFIG.presetQuestions.length).toBe(DEFAULT_PRESET_QUESTIONS.length)
    expect(DEFAULT_ENGINEER_CONFIG.buttonBindings).toEqual({ pushToTalk: null, presets: {} })
  })

  it('sanitizes preset patches and keeps only bindings for surviving presets', () => {
    const withPresets = mergeEngineerConfig(DEFAULT_ENGINEER_CONFIG, {
      presetQuestions: [
        { id: 'keep', label: 'Keep', text: 'still here?' },
        { id: 'drop', label: 'Drop', text: 'going away' }
      ],
      buttonBindings: { pushToTalk: { buttonIndex: 2 }, presets: { keep: { buttonIndex: 5 }, drop: { buttonIndex: 6 } } }
    })
    expect(withPresets.buttonBindings.presets).toHaveProperty('keep')
    expect(withPresets.buttonBindings.presets).toHaveProperty('drop')

    // Removing the 'drop' preset must drop its dangling button binding.
    const afterRemoval = mergeEngineerConfig(withPresets, {
      presetQuestions: [{ id: 'keep', label: 'Keep', text: 'still here?' }]
    })
    expect(afterRemoval.buttonBindings.presets).toHaveProperty('keep')
    expect(afterRemoval.buttonBindings.presets).not.toHaveProperty('drop')
    expect(afterRemoval.buttonBindings.pushToTalk).toEqual({ buttonIndex: 2 })
  })
})

describe('engineer actions', () => {
  it('lists push-to-talk first, then one action per preset, with bindings', () => {
    const config = mergeEngineerConfig(DEFAULT_ENGINEER_CONFIG, {
      presetQuestions: [{ id: 'fuel', label: 'Fuel', text: 'fuel ok?' }],
      buttonBindings: { pushToTalk: { buttonIndex: 1 }, presets: { fuel: { buttonIndex: 9 } } }
    })
    const actions = listEngineerActions(config)
    expect(actions[0]).toMatchObject({ id: ENGINEER_PUSH_TO_TALK_ACTION_ID, kind: 'pushToTalk', binding: { buttonIndex: 1 } })
    expect(actions[1]).toMatchObject({ id: presetActionId('fuel'), kind: 'askPreset', presetId: 'fuel', binding: { buttonIndex: 9 } })
  })

  it('resolves an action id into an executable directive', () => {
    const config = mergeEngineerConfig(DEFAULT_ENGINEER_CONFIG, {
      presetQuestions: [{ id: 'fuel', label: 'Fuel', text: 'fuel ok?' }]
    })
    expect(resolveEngineerAction(config, ENGINEER_PUSH_TO_TALK_ACTION_ID)).toEqual({ kind: 'pushToTalk' })
    expect(resolveEngineerAction(config, presetActionId('fuel'))).toEqual({ kind: 'askPreset', presetId: 'fuel', text: 'fuel ok?' })
    expect(resolveEngineerAction(config, presetActionId('missing'))).toBeNull()
    expect(resolveEngineerAction(config, 'totally.unknown')).toBeNull()
  })
})

describe('mergeEngineerConfig', () => {
  it('clamps and validates fields', () => {
    expect(mergeEngineerConfig(DEFAULT_ENGINEER_CONFIG, { threads: -5 }).threads).toBe(0)
    expect(mergeEngineerConfig(DEFAULT_ENGINEER_CONFIG, { threads: 99 }).threads).toBe(8)
    expect(mergeEngineerConfig(DEFAULT_ENGINEER_CONFIG, { maxTokens: 9999 }).maxTokens).toBe(512)
    expect(mergeEngineerConfig(DEFAULT_ENGINEER_CONFIG, { maxTokens: 1 }).maxTokens).toBe(32)
    // Invalid language ignored → keeps base.
    expect(mergeEngineerConfig(DEFAULT_ENGINEER_CONFIG, { language: 'xx' as unknown as 'pt-BR' }).language).toBe('en-US')
  })
})

describe('generationParams — assertiveness tuning', () => {
  const base = DEFAULT_ENGINEER_CONFIG

  it('keeps brutal AND assertive at a low temperature (<= 0.3) for tool-call reliability', () => {
    expect(generationParams({ ...base, assertiveness: 'brutal' }).temperature).toBeLessThanOrEqual(0.3)
    expect(generationParams({ ...base, assertiveness: 'assertive' }).temperature).toBeLessThanOrEqual(0.3)
    expect(generationParams({ ...base, assertiveness: 'balanced' }).temperature).toBeLessThanOrEqual(0.2)
  })

  it('caps brutal shorter so it stays a blunt one-liner', () => {
    const brutal = generationParams({ ...base, assertiveness: 'brutal', maxTokens: 512 })
    expect(brutal.maxTokens).toBe(100)
    const balanced = generationParams({ ...base, assertiveness: 'balanced', maxTokens: 512 })
    expect(balanced.maxTokens).toBe(512)
  })
})

describe('adaptEngineerTools', () => {
  it('maps every engineer tool into a node-llama-cpp function shape', async () => {
    const ctx: EngineerContext = { getSnapshot: () => null }
    const functions = adaptEngineerTools(buildEngineerTools(ctx))
    const names = Object.keys(functions)
    expect(names).toHaveLength(12)
    for (const name of names) {
      expect(typeof functions[name].handler).toBe('function')
      expect(functions[name].params).toBeDefined()
      expect(typeof functions[name].description).toBe('string')
    }
    // A handler runs the underlying tool and returns its result object.
    const fuel = await functions.getFuelState.handler({})
    expect(fuel).toHaveProperty('summary')
  })
})
