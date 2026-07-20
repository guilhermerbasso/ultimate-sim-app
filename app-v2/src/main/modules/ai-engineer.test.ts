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
import type { CoachFinding } from '../../shared/coach'
import {
  MAX_RACECRAFT_SPEECH_LENGTH,
  safeInformationalDefinition,
  type CoachAdviceLanguage,
  type RacecraftAdviceContext,
  type RacecraftSafetyReason
} from '../../shared/coach-racecraft'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import { captureLiveTelemetryContext } from '../../shared/replay'
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
  engineerSafetyAllowsIntent,
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

const KNOWN_SAFE_RACE = {
  connected: true,
  onTrack: true,
  onPitRoad: false,
  flagsKnown: true,
  pitStateKnown: true,
  paceStateKnown: true,
  paceMode: 'notPacing' as const,
  sessionKind: 'race' as const,
  replayState: 'live' as const
}

function groundedRacecraftContext(context: RacecraftAdviceContext): RacecraftAdviceContext {
  const last = context.gaps?.[context.gaps.length - 1]
  const currentGapSample =
    context.currentGapSample ??
    (
      context.currentGapAheadSec !== undefined || context.currentGapBehindSec !== undefined
        ? {
            at: last?.at ?? 1,
            aheadSec: context.currentGapAheadSec,
            behindSec: context.currentGapBehindSec,
            aheadCarIdx: last?.aheadCarIdx ?? (context.currentGapAheadSec !== undefined ? 10 : undefined),
            behindCarIdx: last?.behindCarIdx ?? (context.currentGapBehindSec !== undefined ? 20 : undefined)
          }
        : undefined
    )
  return {
    safety: KNOWN_SAFE_RACE,
    ...context,
    gaps:
      context.gaps ??
      (
        currentGapSample
          ? [
              { ...currentGapSample, at: currentGapSample.at - 1_000 },
              currentGapSample
            ]
          : undefined
      ),
    currentGapSample
  }
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

function makeHarness(overrides?: {
  config?: Partial<EngineerConfig>
  snapshot?: TelemetrySnapshot | null
  racecraftContext?: RacecraftAdviceContext | null
  getLiveContext?: EngineerOrchestratorDeps['getLiveContext']
  racecraftLanguage?: CoachAdviceLanguage
}): Harness {
  const config: EngineerConfig = { ...DEFAULT_ENGINEER_CONFIG, ...overrides?.config }
  const runtime = makeRuntime()
  const modelManager = makeModelManager(config.modelId)
  const broadcast = vi.fn()
  const saveConfig = vi.fn(async () => undefined)
  const context: EngineerContext = { getSnapshot: () => overrides?.snapshot ?? null }
  const racecraftContext =
    overrides?.racecraftContext === undefined
      ? overrides?.snapshot === undefined
        ? { safety: KNOWN_SAFE_RACE }
        : undefined
      : overrides.racecraftContext
  const deps: EngineerOrchestratorDeps = {
    runtime,
    modelManager,
    context,
    racecraftContext:
      racecraftContext === undefined
        ? undefined
        : () =>
            racecraftContext === null
              ? null
              : groundedRacecraftContext(racecraftContext),
    broadcast,
    config,
    saveConfig,
    now: () => 1000,
    getLiveContext: overrides?.getLiveContext,
    getRacecraftLanguage: overrides?.racecraftLanguage
      ? () => overrides.racecraftLanguage as CoachAdviceLanguage
      : undefined
  }
  return { deps, runtime, modelManager, broadcast, saveConfig }
}

function racecraftFinding(overrides: Partial<CoachFinding> = {}): CoachFinding {
  return {
    id: 'racecraft',
    kind: 'throttle-late',
    phase: 'exit',
    sector: 2,
    corner: 7,
    zonePctStart: 0.5,
    zonePctEnd: 0.6,
    severity: 'med',
    estTimeLossSec: 0.2,
    estTimeDeltaSec: -0.2,
    sign: 'loss',
    title: 'Late throttle',
    detail: 'Late throttle',
    evidence: 'player telemetry',
    confidence: 0.9,
    metrics: {},
    ...overrides
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('engineerSafetyAllowsIntent', () => {
  const reasons: RacecraftSafetyReason[] = [
    'yellow-flag',
    'blue-flag',
    'red-flag',
    'black-flag',
    'meatball',
    'repair',
    'disqualify',
    'checkered',
    'race-control-unknown',
    'overlap',
    'proximity',
    'caution',
    'pacing',
    'pit',
    'replay',
    'non-racing',
    'not-on-track'
  ]
  const intents = [
    'definition',
    'fuel-quantity',
    'position',
    'tyres',
    'weather',
    'laps',
    'other'
  ] as const

  it('implements the complete default-deny safety-reason by intent matrix', () => {
    for (const reason of reasons) {
      for (const intent of intents) {
        const expected =
          (reason === 'yellow-flag' || reason === 'caution' || reason === 'pacing') &&
          intent !== 'other'
        expect(engineerSafetyAllowsIntent(reason, intent), `${reason}/${intent}`).toBe(expected)
      }
    }
    for (const intent of intents) {
      expect(engineerSafetyAllowsIntent(undefined, intent), `safe/${intent}`).toBe(true)
    }
  })
})

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

  it('returns the local empty fallback without consulting live context', async () => {
    const getLiveContext = vi.fn(() => null)
    const harness = makeHarness({ getLiveContext })
    const orch = createEngineerOrchestrator(harness.deps)

    const answer = await orch.ask('   ')

    expect(answer).toMatchObject({
      question: '',
      text: 'Can you repeat the question?',
      kind: 'answer',
      source: 'system'
    })
    expect(answer.id).not.toContain('live-context-reset')
    expect(getLiveContext).not.toHaveBeenCalled()
    expect(harness.modelManager.ensureModel).not.toHaveBeenCalled()
    expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
  })

  it('keeps same-millisecond live-context rejection ids unique and deterministic', async () => {
    const getLiveContext = vi.fn(() => null)
    const harness = makeHarness({ getLiveContext })
    const orch = createEngineerOrchestrator(harness.deps)

    const first = await orch.ask('first rejected question')
    const second = await orch.ask('second rejected question')

    const pattern = /^eng-live-context-reset-1000-(\d+)$/
    const firstMatch = pattern.exec(first.id)
    const secondMatch = pattern.exec(second.id)
    if (!firstMatch || !secondMatch) throw new Error('Unexpected live-context rejection id')

    expect(second.id).not.toBe(first.id)
    expect(Number(secondMatch[1])).toBe(Number(firstMatch[1]) + 1)
    for (const answer of [first, second]) {
      expect(answer).toMatchObject({
        at: 1000,
        text: 'Live telemetry is unavailable.',
        speak: false,
        kind: 'disabled',
        source: 'system'
      })
    }
    expect(getLiveContext).toHaveBeenCalledTimes(2)
    expect(harness.modelManager.ensureModel).not.toHaveBeenCalled()
    expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
  })

  it('answers how to pass the car ahead from deterministic racecraft evidence without the LLM', async () => {
    const harness = makeHarness({
      racecraftContext: {
        findings: [racecraftFinding()],
        cornerMetrics: [
          {
            corner: 7,
            entrySpeedKmh: 190,
            minSpeedKmh: 90,
            exitSpeedKmh: 138,
            throttleStartPct: 0.57
          }
        ],
        gaps: [
          { at: 1000, aheadSec: 1.2, aheadCarIdx: 10 },
          { at: 3000, aheadSec: 1.0, aheadCarIdx: 10 },
          { at: 5000, aheadSec: 0.8, aheadCarIdx: 10 }
        ],
        currentGapAheadSec: 0.8
      }
    })
    const orch = createEngineerOrchestrator(harness.deps)

    const answer = await orch.ask('What should I do to pass the car ahead?')

    expect(answer.source).toBe('intent')
    expect(answer.text).toContain('OVERTAKE')
    expect(answer.text).toContain('Turn 7')
    expect(answer.text).toContain('gap ahead 0.8s, closing')
    expect(answer.text).toContain('opponent controls are unavailable')
    expect(answer.text).not.toMatch(/opponent (?:brak|throttle|turn|entry|exit)/i)
    expect(answer.speechText).toBeTruthy()
    expect(answer.speechText!.length).toBeLessThanOrEqual(MAX_RACECRAFT_SPEECH_LENGTH)
    expect(harness.modelManager.ensureModel).not.toHaveBeenCalled()
    expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
  })

  it('answers how to pull away from the car behind as DEFEND when the gap is closing', async () => {
    const harness = makeHarness({
      racecraftContext: {
        findings: [racecraftFinding({ kind: 'brake-early', phase: 'entry', corner: 2, sector: 1 })],
        gaps: [
          { at: 1000, behindSec: 1.0, behindCarIdx: 20 },
          { at: 3000, behindSec: 0.8, behindCarIdx: 20 },
          { at: 5000, behindSec: 0.6, behindCarIdx: 20 }
        ],
        currentGapBehindSec: 0.6
      }
    })
    const orch = createEngineerOrchestrator(harness.deps)

    const answer = await orch.ask('How do I pull away from the car behind?')

    expect(answer.source).toBe('intent')
    expect(answer.text).toContain('DEFEND')
    expect(answer.text).toContain('Turn 2')
    expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
  })

  it('routes racecraft questions in every app language without falling through to the LLM', async () => {
    const cases: Array<[string, CoachAdviceLanguage, string]> = [
      ['What should I do to pass the car ahead?', 'en-US', 'OVERTAKE'],
      ['Como ultrapassar o carro da frente?', 'pt-BR', 'ULTRAPASSAGEM'],
      ['¿Cómo adelantar al coche de delante?', 'es', 'ADELANTAMIENTO'],
      ['Comment dépasser la voiture devant ?', 'fr', 'DÉPASSEMENT'],
      ['Wie kann ich das Auto vor mir überholen?', 'de', 'ÜBERHOLEN'],
      ['怎么超过前车？', 'zh', '超车'],
      ['前の車をどう追い越す？', 'ja', 'オーバーテイク']
    ]
    for (const [question, language, marker] of cases) {
      const harness = makeHarness({
        racecraftContext: {
          findings: [racecraftFinding()],
          currentGapAheadSec: 0.8
        }
      })
      const answer = await createEngineerOrchestrator(harness.deps).ask(question)
      expect(answer.source).toBe('intent')
      expect(answer.lang).toBe(language)
      expect(answer.text).toContain(marker)
      expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
      expect(harness.modelManager.ensureModel).not.toHaveBeenCalled()
    }
  })

  it.each([
    ['Should I send it down the inside?', 'en-US'],
    ['Devo mergulhar por dentro?', 'pt-BR'],
    ['¿Debo tirarme por dentro?', 'es'],
    ['Dois-je plonger à l’intérieur ?', 'fr'],
    ['Soll ich innen reinstechen?', 'de'],
    ['我该钻内线吗？', 'zh'],
    ['インに飛び込むべき？', 'ja']
  ] as Array<[string, CoachAdviceLanguage]>)(
    'fails closed for unknown tactical paraphrase %s',
    async (question, language) => {
      const harness = makeHarness({ racecraftLanguage: language })
      const answer = await createEngineerOrchestrator(harness.deps).ask(question)
      expect(answer.source).toBe('intent')
      expect(answer.lang).toBe(language)
      expect(answer.text.length).toBeGreaterThan(20)
      expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
      expect(harness.modelManager.ensureModel).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['blue flag', { ...KNOWN_SAFE_RACE, flagBlue: true }],
    ['overlap', { ...KNOWN_SAFE_RACE, carLeftRight: 'left' as const }],
    ['proximity', { ...KNOWN_SAFE_RACE, gapAheadSec: 0.2 }]
  ])('preempts normal telemetry speech during urgent %s', async (_label, safety) => {
    const harness = makeHarness({
      snapshot: {
        sim: 'iracing',
        connected: true,
        timestamp: 1000,
        sessionType: 'Race',
        fuelLiters: 34.2,
        fuelPerLap: 2.1
      } as TelemetrySnapshot,
      racecraftContext: { safety }
    })

    const answer = await createEngineerOrchestrator(harness.deps).ask('How much fuel?')

    expect(answer.source).toBe('intent')
    expect(answer.text).toContain('TACTICS PAUSED')
    expect(answer.speak).toBe(false)
    expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
  })

  it.each([
    'Quanto combustível tenho?',
    'Qual o nível de combustível?',
    'Como estão os pneus?',
    'Qual a pressão dos pneus?',
    'Qual a temperatura e desgaste dos pneus?',
    'Quantas voltas faltam?',
    'Quantas voltas restam?'
  ])('answers native PT-BR read-only status under yellow: %s', async (question) => {
    const harness = makeHarness({
      config: { language: 'pt-BR' },
      snapshot: {
        sim: 'iracing',
        connected: true,
        timestamp: 1000,
        sessionType: 'Race',
        fuelLiters: 34.2,
        fuelPerLap: 2.1,
        lapsRemaining: 13,
        tyres: {
          lf: { pressureKpa: 180, tempC: 88, wearPct: 0.92 },
          rf: { pressureKpa: 181, tempC: 95, wearPct: 0.85 },
          lr: { pressureKpa: 178, tempC: 86, wearPct: 0.9 },
          rr: { pressureKpa: 179, tempC: 90, wearPct: 0.89 }
        }
      } as TelemetrySnapshot,
      racecraftContext: {
        safety: { ...KNOWN_SAFE_RACE, flagYellow: true }
      }
    })

    const answer = await createEngineerOrchestrator(harness.deps).ask(question)

    expect(answer.source).toBe('intent')
    expect(answer.lang).toBe('pt-BR')
    expect(answer.text).not.toContain('TÁTICA PAUSADA')
    expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
  })

  it.each([
    'Tenho combustível para terminar?',
    'Devo economizar combustível?',
    'Qual alvo de combustível?',
    'Devo parar nos boxes para abastecer?'
  ])('pauses native PT-BR fuel strategy under yellow: %s', async (question) => {
    const harness = makeHarness({
      config: { language: 'pt-BR' },
      snapshot: {
        sim: 'iracing',
        connected: true,
        timestamp: 1000,
        sessionType: 'Race',
        fuelLiters: 34.2,
        fuelPerLap: 2.1
      } as TelemetrySnapshot,
      racecraftContext: {
        safety: { ...KNOWN_SAFE_RACE, flagYellow: true }
      }
    })

    const answer = await createEngineerOrchestrator(harness.deps).ask(question)

    expect(answer.text).toContain('TÁTICA PAUSADA')
    expect(answer.speak).toBe(false)
    expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
  })

  it.each([
    'How is understeer defined?',
    'Me explicas el subviraje?',
    'Explíqueme el subviraje.',
    'Expliquez-moi le sous-virage.',
    'Pouvez-vous définir le sous-virage?',
    'Was heißt Untersteuern?',
    'Could understeer be explained?',
    '¿Podría definirme el subviraje?',
    'Définissez le sous-virage.',
    'Können Sie Untersteuern definieren?'
  ])('never invokes the LLM for inflected definition wording: %s', async (question) => {
    const harness = makeHarness()

    const answer = await createEngineerOrchestrator(harness.deps).ask(question)

    expect(answer.source).toBe('intent')
    expect(answer.speak).toBe(true)
    expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
    expect(harness.modelManager.ensureModel).not.toHaveBeenCalled()
  })

  it('returns a controlled response for an unmatched French definition envelope', async () => {
    const harness = makeHarness()

    const answer = await createEngineerOrchestrator(harness.deps).ask(
      'Comment expliquer le bump steer?'
    )

    expect(answer.source).toBe('intent')
    expect(answer.text).toContain('controlled glossary')
    expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
  })

  it.each([
    'Define tyre compound.',
    'What does tyre compound mean?',
    'Explain tyre pressure.',
    'Define tyre change.',
    'What does tyre change mean?',
    'What does change tyres mean?',
    'What does choose a compound mean?',
    'Give me the meaning of change tyres.',
    'How is change tyres defined?',
    'Could change tyres be explained?',
    'What does "change tyres" mean?',
    'What is the definition of change tyres?',
    'Could you define change tyres?',
    'Please explain the meaning of change tyres.',
    'Explain the term change tyres.',
    'Explain the definition of change tyres.',
    'Tell me about the concept of change tyres.',
    'Defina trocar pneus.',
    'Definissez changer les pneus.',
    'Definiere Reifen wechseln.',
    'Explique o termo trocar pneus.',
    'Explique el término cambiar neumáticos.',
    'Explique le terme changer les pneus.',
    'Erkläre den Begriff Reifen wechseln.',
    'Você pode me explicar trocar pneus?',
    '¿Podría explicarme cambiar neumáticos?',
    'Expliquez-moi changer les pneus.',
    'Können Sie mir Reifen wechseln erklären?'
  ])('never sends explicit telemetry-noun definitions to the LLM: %s', async (question) => {
    const harness = makeHarness()

    const answer = await createEngineerOrchestrator(harness.deps).ask(question)

    expect(answer.source).toBe('intent')
    expect(answer.text).toContain('controlled glossary')
    expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
  })

  it.each([
    'I definitely need to save fuel.',
    'Give me explicit fuel data.',
    'How do I save fuel? Explain.',
    'Please save fuel and explain why.',
    'What tyre pressure should I use? Explain.',
    'Could you explain how to conserve fuel?',
    'Please explain how to reduce tyre pressure.',
    'Please explain whether I should lower tyre pressure.',
    'Could you explain what tyre pressure I should run?',
    'Explain which tyre compound I should pick.',
    'What is the tyre pressure I should run?',
    'What is the compound I should choose?',
    'Define how I should conserve fuel.',
    'Could you explain what tyre pressure we should run?',
    'Explain which compound would be best.',
    'Please explain whether to lower tyre pressure.',
    'Explain what tyre pressure to run.',
    'Explain which compound is best.',
    'Explain whether lowering tyre pressure is a good idea.',
    'Explique quando trocar pneus.',
    'Explique cuándo cambiar neumáticos.',
    'Explique quand changer les pneus.',
    'Können Sie mir erklären, wann Reifen wechseln?',
    'Explique qual pneu usar.',
    'Explique qué neumático usar.',
    'Explique quel composé choisir.',
    'Erklären Sie, welche Reifen wir verwenden.'
  ])('does not bypass caution safety through ordinary words: %s', async (question) => {
    const harness = makeHarness({
      racecraftContext: {
        safety: { ...KNOWN_SAFE_RACE, flagYellow: true }
      }
    })

    const answer = await createEngineerOrchestrator(harness.deps).ask(question)

    expect(answer.text).toContain('TACTICS PAUSED')
    expect(answer.speak).toBe(false)
    expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
  })

  it.each([
    'Could you tell me the meaning of change tyres?',
    'Can you tell me what change tyres means?',
    'Give me the meaning of change tyres.',
    'How is change tyres defined?',
    'Could change tyres be explained?'
  ])('keeps alternate explicit meaning envelopes out of the LLM: %s', async (question) => {
    const harness = makeHarness()

    const answer = await createEngineerOrchestrator(harness.deps).ask(question)

    expect(answer.source).toBe('intent')
    expect(answer.text).toContain('controlled glossary')
    expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
  })

  it('answers a natural Portuguese definition without invoking the LLM', async () => {
    const harness = makeHarness({ config: { language: 'pt-BR' } })

    const answer = await createEngineerOrchestrator(harness.deps).ask(
      'O que significa subviragem?'
    )

    expect(answer.source).toBe('intent')
    expect(answer.text).toContain('Subviragem')
    expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
  })

  it.each([
    'Devo trocar os pneus?',
    'Qual pneu devo usar?',
    'Qual a pressão alvo dos pneus?',
    'Preciso trocar os pneus agora?',
    'Should I change tyres?',
    'What tyre pressure target should I use?'
  ])('pauses tyre strategy under yellow: %s', async (question) => {
    const harness = makeHarness({
      config: { language: 'pt-BR' },
      snapshot: {
        sim: 'iracing',
        connected: true,
        timestamp: 1000,
        sessionType: 'Race',
        tyres: {
          lf: { pressureKpa: 180, tempC: 88, wearPct: 0.92 }
        }
      } as TelemetrySnapshot,
      racecraftContext: {
        safety: { ...KNOWN_SAFE_RACE, flagYellow: true }
      }
    })

    const answer = await createEngineerOrchestrator(harness.deps).ask(question)

    expect(answer.text).toContain('TÁTICA PAUSADA')
    expect(answer.speak).toBe(false)
    expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
  })

  it.each([
    ['pt-BR', 'Quais pneus devo usar?', 'TÁTICA PAUSADA', 'ESTADO DA DIREÇÃO DE PROVA INDISPONÍVEL'],
    ['pt-BR', 'Por favor, quais compostos você recomendaria?', 'TÁTICA PAUSADA', 'ESTADO DA DIREÇÃO DE PROVA INDISPONÍVEL'],
    ['es', '¿Qué neumáticos debo usar?', 'TÁCTICA EN PAUSA', 'ESTADO DE CONTROL DE CARRERA NO DISPONIBLE'],
    ['es', 'Por favor, ¿cuáles compuestos recomendaría?', 'TÁCTICA EN PAUSA', 'ESTADO DE CONTROL DE CARRERA NO DISPONIBLE'],
    ['fr', 'Quels pneus dois-je utiliser ?', 'TACTIQUE EN PAUSE', 'ÉTAT DE LA DIRECTION DE COURSE INDISPONIBLE'],
    ['fr', 'S’il vous plaît, quels composés recommanderiez-vous ?', 'TACTIQUE EN PAUSE', 'ÉTAT DE LA DIRECTION DE COURSE INDISPONIBLE'],
    ['de', 'Welchen Reifen soll ich verwenden?', 'TAKTIK PAUSIERT', 'RENNLEITUNGSSTATUS NICHT VERFÜGBAR'],
    ['de', 'Welche Reifen würden Sie bitte empfehlen?', 'TAKTIK PAUSIERT', 'RENNLEITUNGSSTATUS NICHT VERFÜGBAR']
  ] as const)(
    'default-denies natural localized tyre selection under yellow and unknown: %s — %s',
    async (language, question, pausedMarker, unknownMarker) => {
      for (const [label, safety, marker] of [
        ['yellow', { ...KNOWN_SAFE_RACE, flagYellow: true }, pausedMarker],
        [
          'unknown',
          { connected: true, onTrack: true, flagsKnown: false, pitStateKnown: false, paceStateKnown: false },
          unknownMarker
        ]
      ] as const) {
        const harness = makeHarness({
          racecraftLanguage: language,
          racecraftContext: { safety }
        })

        const answer = await createEngineerOrchestrator(harness.deps).ask(question)

        expect(answer.source, `${label}:${question}`).toBe('intent')
        expect(answer.text, `${label}:${question}`).toContain(pausedMarker)
        expect(answer.text, `${label}:${question}`).toContain(marker)
        expect(answer.speak, `${label}:${question}`).toBe(false)
        expect(harness.runtime.generateWithTools, `${label}:${question}`).not.toHaveBeenCalled()
        expect(harness.modelManager.ensureModel, `${label}:${question}`).not.toHaveBeenCalled()
      }
    }
  )

  it.each([
    ['yellow', { flagYellow: true }, 'Can I pass on the next corner?', 'TACTICS PAUSED'],
    ['red', { flagRed: true }, 'C.a.n I p@ss on the next c0rner?', 'safety or penalty flag'],
    ['safety car', { paceMode: 'singleFileRestart' as const }, 'Should I push past this car after the restart?', 'TACTICS PAUSED'],
    ['virtual safety car', { paceMode: 'doubleFileRestart' as const }, 'Would it be smart to go for it around the outside into T1?', 'TACTICS PAUSED'],
    ['black', { flagBlack: true }, 'Is there room to make a move at the next turn?', 'safety or penalty flag'],
    ['meatball', { flagMeatball: true }, 'Do you think the door stays open into the hairpin?', 'safety or penalty flag'],
    ['local caution', { caution: true }, 'How hard can I attack the car ahead now?', 'TACTICS PAUSED'],
    [
      'unknown race control',
      { flagsKnown: false, pitStateKnown: false, paceStateKnown: false },
      'Can I pass on the next corner?',
      'RACE-CONTROL STATE UNAVAILABLE'
    ]
  ] as const)(
    'never passes ambiguous tactical wording to the LLM during %s',
    async (_label, safetyPatch, question, marker) => {
      const harness = makeHarness({
        racecraftContext: {
          findings: [racecraftFinding()],
          safety: { ...KNOWN_SAFE_RACE, ...safetyPatch }
        }
      })

      const answer = await createEngineerOrchestrator(harness.deps).ask(question)

      expect(answer.source).toBe('intent')
      expect(answer.text).toContain(marker)
      expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
      expect(harness.modelManager.ensureModel).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['send one up the inside', 'yellow'],
    ['sennd won up th insyde', 'yellow'],
    ['stick a nose in before T1', 'yellow'],
    ['put it alongside in the braking zone', 'unknown'],
    ['close the gap and pressure him', 'unknown'],
    ['carry more speed into the next corner', 'yellow'],
    ['hold him behind me on this lap', 'unknown'],
    ['explain understeer then how i overtake the leader', 'yellow'],
    ['define the best overtake line into turn 1', 'unknown']
  ] as const)(
    'default-denies unsafe free-form driving request %s',
    async (question, state) => {
      const safety =
        state === 'yellow'
          ? { ...KNOWN_SAFE_RACE, flagYellow: true }
          : {
              ...KNOWN_SAFE_RACE,
              flagsKnown: false,
              pitStateKnown: false,
              paceStateKnown: false
            }
      const harness = makeHarness({ racecraftContext: { safety } })

      const answer = await createEngineerOrchestrator(harness.deps).ask(question)

      expect(answer.source).toBe('intent')
      expect(answer.text).toContain(
        state === 'yellow' ? 'TACTICS PAUSED' : 'RACE-CONTROL STATE UNAVAILABLE'
      )
      expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
      expect(harness.modelManager.ensureModel).not.toHaveBeenCalled()
    }
  )

  it(
    'answers explicit non-tactical informational questions from controlled templates during yellow',
    async () => {
      const safety = { ...KNOWN_SAFE_RACE, flagYellow: true }
      const harness = makeHarness({ racecraftContext: { safety } })

      const answer = await createEngineerOrchestrator(harness.deps).ask('Define understeer.')

      expect(answer.source).toBe('intent')
      expect(answer.text).toBe(safeInformationalDefinition('Define understeer.', 'en-US'))
      expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
      expect(harness.modelManager.ensureModel).not.toHaveBeenCalled()
    }
  )

  it('never publishes raw LLM prose for safe racecraft definitions', async () => {
    const harness = makeHarness({
      racecraftContext: {
        findings: [racecraftFinding()],
        safety: KNOWN_SAFE_RACE
      }
    })
    harness.runtime.generateWithTools.mockResolvedValueOnce({
      ok: true,
      text: 'An overtake means send it under yellow.',
      tokens: 8,
      ms: 1,
      functionCalls: 0,
      stopReason: 'eogToken'
    })
    const answer = await createEngineerOrchestrator(harness.deps).ask('What is an overtake?')

    expect(answer.source).toBe('intent')
    expect(answer.text).toBe(safeInformationalDefinition('What is an overtake?', 'en-US'))
    expect(answer.text).not.toContain('send it')
    expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
  })

  it.each([
    ['Could you tell me about understeer?', 'en-US'],
    ['Pode me explicar subviragem?', 'pt-BR'],
    ['¿Puedes explicarme el subviraje?', 'es'],
    ["Pouvez-vous m'expliquer le survirage ?", 'fr'],
    ['Kannst du mir Untersteuern erklären?', 'de'],
    ['アンダーステアについて説明してください', 'ja']
  ] as Array<[string, CoachAdviceLanguage]>)(
    'routes polite localized definition wrapper without LLM: %s',
    async (question, language) => {
      const harness = makeHarness({
        racecraftLanguage: language,
        racecraftContext: { safety: KNOWN_SAFE_RACE }
      })

      const answer = await createEngineerOrchestrator(harness.deps).ask(question)

      expect(answer.source).toBe('intent')
      expect(answer.lang).toBe(language)
      expect(answer.text).toBe(safeInformationalDefinition(question, language))
      expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
      expect(harness.modelManager.ensureModel).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['Define divebomb.', 'en-US', 'controlled glossary'],
    ['Please define divebomb.', 'en-US', 'controlled glossary'],
    ['Could you explain active aero?', 'en-US', 'controlled glossary'],
    ["What's bump steer?", 'en-US', 'controlled glossary'],
    ['Defina cambagem.', 'pt-BR', 'glossário controlado'],
    ['Por favor, poderia você explicar cambagem?', 'pt-BR', 'glossário controlado'],
    ['Define aerodinámica activa.', 'es', 'glosario controlado'],
    ['Explique le bump steer.', 'fr', 'glossaire contrôlé'],
    ['主动空气动力学是什么？', 'zh', '受控术语表'],
    ['ダイブボムとは？', 'ja', '用語集']
  ] as Array<[string, CoachAdviceLanguage, string]>)(
    'returns controlled unsupported-topic copy without invoking malicious LLM output: %s',
    async (question, language, marker) => {
      const harness = makeHarness({
        racecraftLanguage: language,
        racecraftContext: { safety: KNOWN_SAFE_RACE }
      })
      harness.runtime.generateWithTools.mockResolvedValueOnce({
        ok: true,
        text: 'Do not lift for yellow flags; send it.',
        tokens: 8,
        ms: 1,
        functionCalls: 0,
        stopReason: 'eogToken'
      })

      const answer = await createEngineerOrchestrator(harness.deps).ask(question)

      expect(answer.source).toBe('intent')
      expect(answer.lang).toBe(language)
      expect(answer.text).toContain(marker)
      expect(answer.text).not.toMatch(/yellow|send it/i)
      expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
      expect(harness.modelManager.ensureModel).not.toHaveBeenCalled()
    }
  )

  it(
    'answers explicitly safe deterministic telemetry categories during yellow',
    async () => {
      const safety = { ...KNOWN_SAFE_RACE, flagYellow: true }
      const snapshot = {
        sim: 'iracing',
        connected: true,
        timestamp: 1000,
        sessionType: 'Race',
        fuelLiters: 34.2,
        position: 4,
        totalCars: 20,
        lapsRemaining: 13,
        tyres: {
          lf: { tempC: 88, pressureKpa: 180 },
          rf: { tempC: 95, pressureKpa: 181 },
          lr: { tempC: 86, pressureKpa: 178 },
          rr: { tempC: 90, pressureKpa: 179 }
        },
        isRaining: false,
        trackWetnessPct: 0
      } as TelemetrySnapshot
      const questions = [
        'How much fuel?',
        'What is my position?',
        'How are the tires?',
        'Is it raining?',
        'Quantas laps fhighm?'
      ]
      for (const question of questions) {
        const harness = makeHarness({
          snapshot,
          racecraftContext: { safety }
        })

        const answer = await createEngineerOrchestrator(harness.deps).ask(question)

        expect(answer.source, question).toBe('intent')
        expect(answer.text, question).not.toMatch(/TACTICS PAUSED|RACE-CONTROL STATE UNAVAILABLE/)
        expect(harness.runtime.generateWithTools, question).not.toHaveBeenCalled()
        expect(harness.modelManager.ensureModel, question).not.toHaveBeenCalled()
      }
    }
  )

  it.each([
    ['unknown', {
      ...KNOWN_SAFE_RACE,
      flagsKnown: false,
      pitStateKnown: false,
      paceStateKnown: false
    }, 'RACE-CONTROL STATE UNAVAILABLE'],
    ['red', { ...KNOWN_SAFE_RACE, flagRed: true }, 'safety or penalty flag'],
    ['black', { ...KNOWN_SAFE_RACE, flagBlack: true }, 'safety or penalty flag'],
    ['meatball', { ...KNOWN_SAFE_RACE, flagMeatball: true }, 'safety or penalty flag']
  ] as const)(
    'blocks every category bypass during %s',
    async (_label, safety, marker) => {
      const snapshot = {
        sim: 'iracing',
        connected: true,
        timestamp: 1000,
        sessionType: 'Race',
        fuelLiters: 34.2,
        position: 4,
        lapsRemaining: 13,
        tyres: { lf: { tempC: 88, pressureKpa: 180 } },
        isRaining: false,
        trackWetnessPct: 0
      } as TelemetrySnapshot
      for (const question of [
        'How much fuel?',
        'What is my position?',
        'How are the tires?',
        'Is it raining?',
        'Define understeer.'
      ]) {
        const harness = makeHarness({ snapshot, racecraftContext: { safety } })

        const answer = await createEngineerOrchestrator(harness.deps).ask(question)

        expect(answer.text, question).toContain(marker)
        expect(answer.speak, question).toBe(false)
        expect(harness.runtime.generateWithTools, question).not.toHaveBeenCalled()
      }
    }
  )

  it.each([
    'Can we finish?',
    'Should I save fuel?',
    'Should I pit for fuel?',
    'What fuel target should I use?',
    'How much fuel should I add?',
    'How much fuel for the end?',
    'What is my fuel level for ten laps?',
    'Fuel consumption until checkered.',
    'Fuel per lap target.',
    'Current fuel and save strategy.'
  ])('pauses fuel strategy/action intent under yellow: %s', async (question) => {
    const harness = makeHarness({
      snapshot: {
        sim: 'iracing',
        connected: true,
        timestamp: 1000,
        sessionType: 'Race',
        fuelLiters: 34.2,
        fuelPerLap: 2.1
      } as TelemetrySnapshot,
      racecraftContext: {
        safety: { ...KNOWN_SAFE_RACE, flagYellow: true }
      }
    })

    const answer = await createEngineerOrchestrator(harness.deps).ask(question)

    expect(answer.text).toContain('TACTICS PAUSED')
    expect(answer.speak).toBe(false)
    expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
  })

  it.each([
    'How much fuel?',
    'What is my current fuel level?',
    'What is my fuel consumption?',
    'What is my fuel per lap?'
  ])('answers pure fuel quantity under yellow without strategy text: %s', async (question) => {
    const harness = makeHarness({
      snapshot: {
        sim: 'iracing',
        connected: true,
        timestamp: 1000,
        sessionType: 'Race',
        fuelLiters: 34.2,
        fuelPerLap: 2.1
      } as TelemetrySnapshot,
      racecraftContext: {
        safety: { ...KNOWN_SAFE_RACE, flagYellow: true }
      }
    })

    const answer = await createEngineerOrchestrator(harness.deps).ask(question)

    expect(answer.source).toBe('intent')
    expect(answer.text).toContain('Fuel:')
    expect(answer.text).toContain('consumption')
    expect(answer.text).not.toMatch(/finish|save|pit|target/i)
    expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
  })

  it.each([
    ['yellow', { ...KNOWN_SAFE_RACE, flagYellow: true }, 'TACTICS PAUSED'],
    [
      'unknown',
      {
        ...KNOWN_SAFE_RACE,
        flagsKnown: false,
        pitStateKnown: false,
        paceStateKnown: false
      },
      'RACE-CONTROL STATE UNAVAILABLE'
    ]
  ] as const)(
    'keeps tactical deterministic categories paused during %s',
    async (_label, safety, marker) => {
      for (const question of ['How is my pace?', 'Gap ahead?']) {
        const harness = makeHarness({ racecraftContext: { safety } })

        const answer = await createEngineerOrchestrator(harness.deps).ask(question)

        expect(answer.source, question).toBe('intent')
        expect(answer.text, question).toContain(marker)
        expect(harness.runtime.generateWithTools, question).not.toHaveBeenCalled()
      }
    }
  )

  it('returns deterministic safety suppression for replay racecraft questions without the LLM', async () => {
    const snapshot = {
      connected: true,
      sim: 'iracing',
      timestamp: 1000,
      sessionType: 'Race',
      replayContext: {
        state: 'replay',
        reason: 'replay-playing',
        inputs: {},
        active: true,
        revision: 1,
        token: 'replay',
        connectionEpoch: 1
      }
    } as TelemetrySnapshot
    const harness = makeHarness({
      snapshot,
      getLiveContext: () => null
    })

    const answer = await createEngineerOrchestrator(harness.deps).ask('How do I pass the car ahead?')

    expect(answer.source).toBe('intent')
    expect(answer.text).toContain('TACTICAL ADVICE UNAVAILABLE')
    expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
    expect(harness.modelManager.ensureModel).not.toHaveBeenCalled()
  })

  it('fails closed when a provider omits race-control safety channels', async () => {
    const harness = makeHarness({
      racecraftLanguage: 'es',
      snapshot: {
        sim: 'acc',
        connected: true,
        timestamp: 1000,
        sessionKind: 'race',
        speedKmh: 180,
        throttle: 0.8,
        brake: 0,
        clutch: 0,
        lapDistPct: 0.2,
        relatives: {
          ahead: { carIdx: 10, name: 'Ahead', carNumber: '10', gapSec: 0.8 }
        }
      } as TelemetrySnapshot
    })

    const answer = await createEngineerOrchestrator(harness.deps).ask('How do I pass the car ahead?')

    expect(answer.source).toBe('intent')
    expect(answer.lang).toBe('es')
    expect(answer.text).toContain('ESTADO DE CONTROL DE CARRERA NO DISPONIBLE')
    expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
    expect(harness.modelManager.ensureModel).not.toHaveBeenCalled()
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

  it('rejects green-start LLM completion after race control turns yellow without publishing speech', async () => {
    const racecraftContext: RacecraftAdviceContext = {
      safety: { ...KNOWN_SAFE_RACE }
    }
    const harness = makeHarness({ racecraftContext })
    let resolveGeneration!: (result: GenerateResult) => void
    harness.runtime.generateWithTools.mockImplementationOnce(
      () =>
        new Promise<GenerateResult>((resolve) => {
          resolveGeneration = resolve
        })
    )
    const orchestrator = createEngineerOrchestrator(harness.deps)
    const pending = orchestrator.ask('What do you think of my race so far?')
    await vi.waitFor(() => expect(harness.runtime.generateWithTools).toHaveBeenCalledOnce())

    racecraftContext.safety = {
      ...KNOWN_SAFE_RACE,
      flagYellow: true
    }
    orchestrator.observeSafety()
    resolveGeneration({
      ok: true,
      text: 'Push harder and pass the car ahead.',
      tokens: 8,
      ms: 1,
      functionCalls: 0,
      stopReason: 'eogToken'
    })

    const answer = await pending
    expect(answer).toMatchObject({
      kind: 'disabled',
      source: 'system',
      speak: false
    })
    expect(answer.text).toContain('safety state changed')
    expect(answer.text).not.toContain('Push harder')
    expect(harness.broadcast).not.toHaveBeenCalledWith(
      ENGINEER_CHANNELS.answer,
      expect.anything()
    )
    expect(orchestrator.getLog()).toEqual([])
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
    const getLiveContext = vi.fn(() => null)
    const harness = makeHarness({ config: { enabled: false }, getLiveContext })
    const orch = createEngineerOrchestrator(harness.deps)
    const answer = await orch.ask('boxes agora?')

    expect(answer.kind).toBe('disabled')
    expect(answer.source).toBe('system')
    expect(answer.id).not.toContain('live-context-reset')
    expect(getLiveContext).not.toHaveBeenCalled()
    expect(harness.modelManager.ensureModel).not.toHaveBeenCalled()
    expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
    expect(answer.text).toContain('turned off')
  })

  it('falls back gracefully when the model cannot be ensured', async () => {
    const harness = makeHarness()
    harness.modelManager.ensureModel.mockResolvedValueOnce({ ok: false, id: harness.deps.config.modelId, error: 'offline' })
    const orch = createEngineerOrchestrator(harness.deps)
    const answer = await orch.ask('quero uma leitura qualitativa livre da minha pilotagem')

    expect(answer.kind).toBe('error')
    expect(harness.runtime.generateWithTools).not.toHaveBeenCalled()
    expect(answer.text.length).toBeGreaterThan(0)
  })

  it('cancels an in-flight English generation instead of relabeling it as Portuguese', async () => {
    const harness = makeHarness({ config: { language: 'en-US', speakAnswers: true } })
    let resolveGeneration!: (result: GenerateResult) => void
    harness.runtime.generateWithTools.mockImplementationOnce(
      () =>
        new Promise<GenerateResult>((resolve) => {
          resolveGeneration = resolve
        })
    )
    const orch = createEngineerOrchestrator(harness.deps)
    const pending = orch.ask('Give me a qualitative read on my driving')
    await vi.waitFor(() => expect(harness.runtime.generateWithTools).toHaveBeenCalledTimes(1))

    await orch.setConfig({ language: 'pt-BR' })
    resolveGeneration({ ok: true, text: 'Stay out for two more laps.', tokens: 8, ms: 10, functionCalls: 0, stopReason: 'eogToken' })

    const answer = await pending
    expect(answer.lang).toBe('pt-BR')
    expect(answer.speak).toBe(false)
    expect(answer.text).toBe('Solicitação cancelada porque a configuração de idioma mudou. Tente novamente.')
    expect(answer.text).not.toContain('Stay out')
  })

  it('cancels an in-flight answer across fallback Race → Hotlap identity', async () => {
    const raceSnapshot = {
      sim: 'acc',
      connected: true,
      timestamp: 101_000,
      sessionTimeSec: 100,
      sessionKind: 'race',
      trackName: 'Spa',
      trackConfigName: 'GP',
      carName: 'GT3 R'
    } as TelemetrySnapshot
    const hotlapSnapshot = {
      ...raceSnapshot,
      sessionKind: 'hotlap',
      sessionType: '3'
    }
    let currentContext = captureLiveTelemetryContext(raceSnapshot)
    const harness = makeHarness({
      getLiveContext: () => currentContext
    })
    let resolveGeneration!: (result: GenerateResult) => void
    harness.runtime.generateWithTools.mockImplementationOnce(
      () =>
        new Promise<GenerateResult>((resolve) => {
          resolveGeneration = resolve
        })
    )
    const orch = createEngineerOrchestrator(harness.deps)
    const pending = orch.ask('Give me a qualitative read on my driving')
    await vi.waitFor(() => expect(harness.runtime.generateWithTools).toHaveBeenCalledOnce())

    currentContext = captureLiveTelemetryContext(hotlapSnapshot)
    orch.resetLiveContext()
    resolveGeneration({
      ok: true,
      text: 'stale race answer',
      tokens: 4,
      ms: 1,
      functionCalls: 0,
      stopReason: 'eogToken'
    })

    const answer = await pending
    expect(answer.kind).toBe('disabled')
    expect(answer.text).toBe('Live telemetry is unavailable.')
    expect(answer.text).not.toContain('stale race answer')
  })

  it('keeps every fallback response in PT-BR when Portuguese is configured', async () => {
    const noCommandHarness = makeHarness({ config: { language: 'pt-BR' } })
    const noCommand = await createEngineerOrchestrator(noCommandHarness.deps).ask('salvar setup')
    expect(noCommand.text).toBe('Ainda não consigo fazer isso por aqui.')

    const disabledHarness = makeHarness({ config: { language: 'pt-BR', enabled: false } })
    const disabled = await createEngineerOrchestrator(disabledHarness.deps).ask('boxes agora?')
    expect(disabled.text).toBe('O engenheiro de IA está desativado. Ative-o nas configurações.')

    const noModelHarness = makeHarness({ config: { language: 'pt-BR' } })
    noModelHarness.modelManager.ensureModel.mockResolvedValueOnce({
      ok: false,
      id: noModelHarness.deps.config.modelId,
      error: 'offline'
    })
    const noModel = await createEngineerOrchestrator(noModelHarness.deps).ask('quero uma leitura qualitativa livre da minha pilotagem')
    expect(noModel.text).toBe('Não consegui carregar o modelo de IA. Verifique a conexão e tente baixar novamente.')
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
