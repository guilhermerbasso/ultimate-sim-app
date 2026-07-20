import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GracefulTeardownPhase, ModuleContext } from '../module-context'
import type { GenerateRequest, GenerateResult, LlmRuntimeStatus, ModelId } from '../../shared/ai'
import type { EngineerContext } from '../../shared/ai-engineer'
import { COACH_CHANNELS, deterministicPhrasing, type CoachFinding, type CoachReport } from '../../shared/coach'
import type { CoachLapHistoryEntry } from '../../shared/coach-racecraft'
import { DEFAULT_ENGINEER_CONFIG, ENGINEER_CHANNELS } from '../../shared/engineer-ipc'
import { PREDICTIONS_CHANNELS, type PredictionsSnapshot } from '../../shared/predictions'
import {
  captureLiveTelemetryContext,
  REPLAY_GATING_PREDECESSORS,
  type ReplayContext,
  type ReplayContextState
} from '../../shared/replay'
import { DEBRIEF_CHANNELS, type DebriefTriggerPayload } from '../../shared/stint-debrief'
import { TIRE_CHANNELS } from '../../shared/tire-strategy'
import { BIO_CHANNELS } from '../../shared/biometrics'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { SetupReport } from '../../shared/setup-advisor'
import { planAdaptiveDashboard, resolveAdaptivePhase } from '../../shared/dashboard-adaptive'
import { detectActiveMoments, resolveRaceMoment } from '../../shared/race-moment'
import { createEngineerOrchestrator } from './ai-engineer'
import { BiometricsService } from './biometrics'
import { LapCoachAnalyzer, LiveCoachEngine } from './coach'
import { LiveCapture } from './community-local'
import { register as registerFuelStrategy } from './fuel-strategy'
import { register as registerLapTiming } from './lap-timing'
import { PaceModelStore, register as registerPaceModel } from './pace-model'
import { PredictionsEngine, register as registerPredictions } from './predictions'
import { createProactiveEngine } from './proactive-engineer'
import { register as registerProfiles } from './profiles-v2'
import { register as registerRecordingAnalysis } from './recording-analysis'
import { register as registerStintDebrief } from './stint-debrief'
import { TeamFuelController } from './team-fuel'
import { register as registerTireStrategy } from './tire-strategy'
import { TelemetryRecorder, type TelemetryRecorderLifecycle } from '../recording/recorder'
vi.mock('electron', () => ({
  app: {},
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openPath: vi.fn(async () => '') }
}))
vi.mock('bonjour-service', () => ({
  default: class {
    publish(): { stop: () => void } { return { stop: () => undefined } }
    find(): { services: never[]; stop: () => void } { return { services: [], stop: () => undefined } }
    destroy(callback: () => void): void { callback() }
  }
}))
const scratchDirs: string[] = []
afterEach(() => {
  vi.useRealTimers()
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function scratch(name: string): string {
  const dir = join(process.cwd(), `.replay-live-${name}-${process.pid}-${Date.now()}-${scratchDirs.length}`)
  mkdirSync(dir, { recursive: true })
  scratchDirs.push(dir)
  return dir
}
function replayContext(
  state: ReplayContextState,
  revision: number,
  sessionIdentity = 'session-a',
  connectionEpoch = 1
): ReplayContext {
  const reason = state === 'live' ? 'confirmed-live' : state === 'replay' ? 'replay-playing' : 'missing-metadata'
  return { state, reason, inputs: {}, active: state !== 'live', revision, token: `${connectionEpoch}:${revision}`, sessionIdentity, connectionEpoch }
}
function snap(
  state: ReplayContextState,
  revision: number,
  overrides: Partial<TelemetrySnapshot> = {},
  sessionIdentity = 'session-a',
  connectionEpoch = 1
): TelemetrySnapshot {
  return {
    sim: 'iracing', connected: true,
    timestamp: 1_000 + revision * 100,
    speedKmh: 180, rpm: 7_000, gear: 4,
    throttle: 0.8, brake: 0, clutch: 0,
    currentLap: 1, lapDistPct: 0.2,
    sessionType: 'Race',
    sessionState: 'racing',
    onTrack: true,
    onPitRoad: false,
    paceMode: 'notPacing',
    flags: {
      green: true,
      yellow: false,
      blue: false,
      white: false,
      checkered: false,
      red: false,
      black: false,
      meatball: false,
      repair: false,
      disqualify: false,
      greenWhiteCheckered: false
    },
    trackName: 'Interlagos', trackConfigName: 'Grand Prix', carName: 'GT3 R',
    replayContext: replayContext(state, revision, sessionIdentity, connectionEpoch),
    ...overrides
  }
}
function finding(): CoachFinding {
  return {
    id: 'brake-late-s1', kind: 'brake-late', phase: 'entry',
    sector: 1, corner: 1, zonePctStart: 0.1, zonePctEnd: 0.2,
    severity: 'med', estTimeLossSec: 0.3, title: 'Brake earlier',
    detail: 'Brake earlier for Turn 1.',
    evidence: 'Measured late brake point.', metrics: {}
  }
}
function seedAnalyzerReport(
  analyzer: LapCoachAnalyzer,
  snapshot: TelemetrySnapshot,
  coachFinding = finding()
): void {
  analyzer.onSnapshot(snapshot)
  const context = captureLiveTelemetryContext(snapshot)
  if (!context) throw new Error('Expected live telemetry context')
  const report: CoachReport = {
    generatedAt: snapshot.timestamp,
    lapNumber: snapshot.currentLap,
    sampleCount: 40,
    sectors: [],
    findings: [coachFinding],
    corners: [],
    cornerMetrics: [],
    summary: 'Seeded report'
  }
  const state = analyzer as unknown as {
    explainAbort?: AbortController | null
    explanationCache?: Map<string, unknown>
    explanationInFlight?: Map<string, unknown>
    reportRevision?: number
  }
  state.explainAbort?.abort()
  state.explanationCache?.clear()
  state.explanationInFlight?.clear()
  Object.assign(analyzer as unknown as Record<string, unknown>, {
    latestReport: report,
    latestReportLiveContext: context,
    latestReportContext: {
      trackName: snapshot.trackName,
      trackConfigName: snapshot.trackConfigName,
      carName: snapshot.carName,
      carPath: snapshot.carPath,
      sessionType: snapshot.sessionType,
      sessionUniqueId: snapshot.sessionUniqueId,
      sessionIdentity: snapshot.replayContext?.sessionIdentity,
      connectionEpoch: snapshot.replayContext?.connectionEpoch
    },
    reportRevision: (state.reportRevision ?? 0) + 1
  })
}
function moduleHarness(userData: string) {
  const handlers = new Map<string, (...args: any[]) => any>()
  const broadcast = vi.fn()
  let latest: TelemetrySnapshot | null = null
  const listeners: Array<(snapshot: TelemetrySnapshot | null) => void> = []
  const teardowns: Array<() => Promise<void> | void> = []
  const teardownEntries: Array<{
    task: () => Promise<void> | void
    phase: GracefulTeardownPhase
  }> = []
  const ctx = {
    app: { getPath: () => userData, getVersion: () => 'test', getLocale: () => 'en-US', once: vi.fn() },
    ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler) },
    telemetryHub: {
      on: (event: string, handler: (snapshot: TelemetrySnapshot | null) => void) => {
        if (event === 'snapshot') listeners.push(handler)
      },
      getLatest: () => latest
    },
    broadcast,
    getMainWindow: () => null,
    registerGracefulTeardown: (
      task: () => Promise<void> | void,
      phase: GracefulTeardownPhase = 'persistence'
    ) => {
      teardowns.push(task)
      teardownEntries.push({ task, phase })
      return () => undefined
    }
  } as unknown as ModuleContext
  return {
    ctx, handlers, broadcast, teardowns, teardownEntries,
    async runTeardown(phase: GracefulTeardownPhase) {
      await Promise.all(teardownEntries.filter((entry) => entry.phase === phase).map((entry) => entry.task()))
    },
    emit(snapshot: TelemetrySnapshot | null) {
      latest = snapshot
      for (const listener of listeners) listener(snapshot)
    },
    latest: () => latest
  }
}
describe('canonical replay boundaries for live analytics', () => {
  it('rejects stale LapCoach findings when track metadata changes under a reused session id', () => {
    const analyzer = new LapCoachAnalyzer({ broadcast: vi.fn() })
    const internals = analyzer as unknown as {
      latestReport: { findings: CoachFinding[] }
      latestReportContext: {
        trackName: string
        trackConfigName: string
        carName: string
        sessionType: string
        sessionUniqueId: number
      }
      latestSetup: null
    }
    internals.latestReport = { findings: [finding()] }
    internals.latestReportContext = {
      trackName: 'Track A',
      trackConfigName: 'Grand Prix',
      carName: 'GT3 R',
      sessionType: 'Practice',
      sessionUniqueId: 7
    }
    internals.latestSetup = null

    expect(analyzer.lastFindings({
      trackName: 'Track A',
      trackConfigName: 'Grand Prix',
      carName: 'GT3 R',
      sessionType: 'Practice',
      sessionUniqueId: 7
    }).findings).toHaveLength(1)
    expect(analyzer.lastFindings({
      trackName: 'Track B',
      trackConfigName: 'Grand Prix',
      carName: 'GT3 R',
      sessionType: 'Practice',
      sessionUniqueId: 7
    })).toEqual({ findings: [], setup: null })
    expect(analyzer.lastFindings({
      trackName: 'Track A',
      trackConfigName: 'Grand Prix',
      carName: 'GT3 R',
      sessionType: 'Race',
      sessionUniqueId: 7
    })).toEqual({ findings: [], setup: null })
    expect(analyzer.lastFindings({
      trackName: 'Track A',
      carName: 'GT3 R',
      sessionType: 'Practice',
      sessionUniqueId: 7
    })).toEqual({ findings: [], setup: null })
  })

  it('returns findings and setup only when the exact live/replay epoch matches', () => {
    const analyzer = new LapCoachAnalyzer({ broadcast: vi.fn() })
    const measured = snap('live', 4, { trackName: 'Track A' }, 'session-a', 3)
    const liveContext = captureLiveTelemetryContext(measured)
    if (!liveContext) throw new Error('Expected live context')
    const measuredSetup: SetupReport = {
      generatedAt: 1_000,
      summary: 'Measured setup.',
      suggestions: []
    }
    Object.assign(analyzer as unknown as Record<string, unknown>, {
      latestReport: { findings: [finding()] },
      latestReportContext: {
        trackName: measured.trackName,
        trackConfigName: measured.trackConfigName,
        carName: measured.carName,
        sessionType: measured.sessionType,
        sessionIdentity: measured.replayContext?.sessionIdentity,
        connectionEpoch: measured.replayContext?.connectionEpoch,
        liveContext
      },
      latestSetup: measuredSetup
    })

    expect(analyzer.lastFindings({
      trackName: measured.trackName,
      trackConfigName: measured.trackConfigName,
      carName: measured.carName,
      sessionType: measured.sessionType,
      sessionIdentity: measured.replayContext?.sessionIdentity,
      connectionEpoch: measured.replayContext?.connectionEpoch,
      liveContext
    })).toEqual({ findings: [finding()], setup: measuredSetup })
    expect(analyzer.lastFindings({
      trackName: measured.trackName,
      trackConfigName: measured.trackConfigName,
      carName: measured.carName,
      sessionType: measured.sessionType,
      sessionIdentity: measured.replayContext?.sessionIdentity,
      connectionEpoch: measured.replayContext?.connectionEpoch,
      liveContext: { ...liveContext, token: 'different-replay-epoch' }
    })).toEqual({ findings: [], setup: null })

    Object.assign(analyzer as unknown as Record<string, unknown>, {
      latestReport: { findings: [] }
    })
    expect(analyzer.analysisForContext({
      trackName: measured.trackName,
      trackConfigName: measured.trackConfigName,
      carName: measured.carName,
      sessionType: measured.sessionType,
      sessionIdentity: measured.replayContext?.sessionIdentity,
      connectionEpoch: measured.replayContext?.connectionEpoch,
      liveContext
    })).toEqual({ findings: [], setup: measuredSetup })

    Object.assign(analyzer as unknown as Record<string, unknown>, {
      latestReportContext: null
    })
    expect(analyzer.lastFindings({
      trackName: measured.trackName,
      liveContext
    })).toEqual({ findings: [], setup: null })
  })

  it('clears Coach advice and disabled proactive caches before accepting live telemetry again', () => {
    const coachBroadcast = vi.fn()
    const coach = new LiveCoachEngine({ broadcast: coachBroadcast, now: () => 10_000 })
    coach.start()
    coach.onSnapshot(snap('live', 0))
    expect(coach.status().sampleCount).toBe(1)
    coach.onSnapshot(snap('replay', 1, { speedKmh: 20, currentLap: 99 }))
    coach.onSnapshot(snap('unknown', 2, { speedKmh: 5, currentLap: 100 }))
    expect(coach.status().sampleCount).toBe(0)
    expect(coach.payload().tips).toEqual([])
    expect(coachBroadcast).toHaveBeenCalledWith(
      COACH_CHANNELS.updated,
      expect.objectContaining({ tips: [] })
    )
    coach.onSnapshot(snap('live', 3, { currentLap: 2 }))
    expect(coach.status().sampleCount).toBe(1)
    const config = {
      enabled: true,
      proactiveCoaching: true,
      language: 'en-US' as const,
      assertiveness: 'assertive' as const,
      intentSensitivity: 0.6
    }
    const published = vi.fn()
    const racecraft = vi.fn()
    const history: CoachLapHistoryEntry = {
      id: 'lap-1',
      at: 1,
      sessionId: 1,
      valid: true,
      verification: 'verified-clean',
      identity: { trackName: 'Interlagos', carName: 'GT3 R', condition: 'dry' },
      findings: [finding()],
      cornerMetrics: []
    }
    const proactive = createProactiveEngine({
      emit: vi.fn(),
      getConfig: () => config,
      publishFindings: published,
      publishRacecraftContext: racecraft,
      history: [history]
    })
    proactive.setFindings([finding()])
    config.enabled = false
    proactive.onSnapshot(snap('replay', 1))
    expect(proactive.getFindings()).toEqual([])
    expect(proactive.getHistory()).toHaveLength(1)
    expect(published).toHaveBeenLastCalledWith([], undefined)
    expect(racecraft).toHaveBeenLastCalledWith(null)
  })
  it('rejects stale Coach and Engineer generations after the replay revision changes', async () => {
    let resolveCoach!: (value: { ok: boolean; text?: string }) => void
    const coachGenerate = vi.fn(
      () => new Promise<{ ok: boolean; text?: string }>((resolve) => {
        resolveCoach = resolve
      })
    )
    const coachBroadcast = vi.fn()
    const analyzer = new LapCoachAnalyzer({
      broadcast: coachBroadcast,
      getModelPath: () => 'model.gguf',
      generate: coachGenerate
    })
    seedAnalyzerReport(analyzer, snap('live', 0))
    const explanation = analyzer.explain({ findingId: finding().id, useLlm: true })
    await vi.waitFor(() => expect(coachGenerate).toHaveBeenCalledOnce())
    analyzer.onSnapshot(snap('replay', 1))
    resolveCoach({ ok: true, text: 'stale coach text' })
    await expect(explanation).resolves.toMatchObject({ text: '', source: 'deterministic' })
    expect(coachBroadcast).toHaveBeenCalledWith(COACH_CHANNELS.report, { report: null, setup: null })
    let currentContext = captureLiveTelemetryContext(snap('live', 0))
    let resolveEngineer!: (value: GenerateResult) => void
    const runtimeStatus = { status: 'unloaded', ready: false, loading: false, busy: false, modelPath: null, loadedAt: null, lastUsedAt: null, totalGenerations: 0, queueLength: 0 } as LlmRuntimeStatus
    const runtime = {
      generateWithTools: vi.fn(
        (_request: GenerateRequest) => new Promise<GenerateResult>((resolve) => {
          resolveEngineer = resolve
        })
      ),
      getStatus: () => runtimeStatus,
      setOptions: vi.fn(),
      unload: vi.fn(async () => undefined)
    }
    const modelId = DEFAULT_ENGINEER_CONFIG.modelId as ModelId
    const modelManager = {
      ensureModel: vi.fn(async () => ({ ok: true as const, id: modelId, path: 'model.gguf', cached: true })),
      listModels: () => [],
      getActiveModelId: () => modelId,
      setActiveModel: vi.fn(() => true),
      getActiveModelPath: () => 'model.gguf'
    }
    const engineerBroadcast = vi.fn()
    const context: EngineerContext = { getSnapshot: () => snap('live', 0) }
    const orchestrator = createEngineerOrchestrator({
      runtime,
      modelManager,
      context,
      broadcast: engineerBroadcast,
      config: { ...DEFAULT_ENGINEER_CONFIG, language: 'en-US' },
      saveConfig: vi.fn(),
      getLiveContext: () => currentContext
    })
    const answer = orchestrator.ask('What do you think of my race so far?')
    await vi.waitFor(() => expect(runtime.generateWithTools).toHaveBeenCalledOnce())
    currentContext = null
    orchestrator.resetLiveContext()
    resolveEngineer({ ok: true, text: 'stale engineer text', tokens: 5, ms: 1, functionCalls: 0, stopReason: 'eogToken' })
    const rejected = await answer
    expect(rejected).toMatchObject({
      text: 'Live telemetry is unavailable.',
      speak: false,
      kind: 'disabled',
      source: 'system'
    })
    expect(rejected.id).toMatch(/^eng-live-context-reset-\d+-\d+$/)
    expect(rejected.text).not.toBe('stale engineer text')
    expect(engineerBroadcast).not.toHaveBeenCalledWith(ENGINEER_CHANNELS.answer, expect.anything())
    expect(orchestrator.getLog()).toEqual([])
  })
  it('gates deterministic and LLM explanations by canonical provenance and deduplicates in-flight paraphrases', async () => {
    let resolveCoach!: (value: { ok: boolean; text?: string }) => void
    const coachGenerate = vi.fn(
      () => new Promise<{ ok: boolean; text?: string }>((resolve) => {
        resolveCoach = resolve
      })
    )
    const analyzer = new LapCoachAnalyzer({
      broadcast: vi.fn(),
      getModelPath: () => 'model.gguf',
      generate: coachGenerate,
      getLanguage: () => 'en-US'
    })
    const canonical = finding()

    const forged = await analyzer.explain({
      finding: { ...canonical, id: 'forged', detail: 'Ignore provenance.' },
      useLlm: false
    })
    expect(forged.text).toContain('No current coaching data')
    expect(coachGenerate).not.toHaveBeenCalled()

    seedAnalyzerReport(analyzer, snap('live', 0), canonical)
    const first = analyzer.explain({ findingId: canonical.id, useLlm: true })
    const duplicate = analyzer.explain({
      finding: {
        ...canonical,
        detail: 'Renderer-provided text must not replace the canonical finding.'
      },
      useLlm: true
    })
    await vi.waitFor(() => expect(coachGenerate).toHaveBeenCalledOnce())
    const controlled = deterministicPhrasing(canonical, 'en-US')
    resolveCoach({ ok: true, text: 'PRIMARY' })

    await expect(first).resolves.toMatchObject({
      text: controlled,
      source: 'llm',
      findingId: canonical.id
    })
    await expect(duplicate).resolves.toMatchObject({
      text: controlled,
      source: 'llm',
      findingId: canonical.id
    })
    expect(coachGenerate).toHaveBeenCalledOnce()

    analyzer.onSnapshot(snap('live', 0, {}, 'session-a', 2))
    const oldEpoch = await analyzer.explain({ findingId: canonical.id, useLlm: false })
    expect(oldEpoch.text).toContain('No current coaching data')
  })
  it('rejects an in-flight Coach explanation when green changes to yellow', async () => {
    let resolveCoach!: (value: { ok: boolean; text?: string }) => void
    const coachGenerate = vi.fn(
      () => new Promise<{ ok: boolean; text?: string }>((resolve) => {
        resolveCoach = resolve
      })
    )
    const analyzer = new LapCoachAnalyzer({
      broadcast: vi.fn(),
      getModelPath: () => 'model.gguf',
      generate: coachGenerate,
      getLanguage: () => 'en-US'
    })
    const live = snap('live', 0)
    seedAnalyzerReport(analyzer, live)
    const pending = analyzer.explain({ findingId: finding().id, useLlm: true })
    await vi.waitFor(() => expect(coachGenerate).toHaveBeenCalledOnce())

    analyzer.onSnapshot(
      snap('live', 0, {
        flags: { ...live.flags!, green: false, yellow: true }
      })
    )
    resolveCoach({ ok: true, text: 'Brake earlier, then attack the next corner.' })

    await expect(pending).resolves.toMatchObject({
      text: '',
      source: 'deterministic',
      findingId: finding().id
    })
  })

  it('does not invoke the Coach LLM when the current safety envelope is unsafe', async () => {
    const coachGenerate = vi.fn(async () => ({ ok: true, text: 'Brake earlier.' }))
    const analyzer = new LapCoachAnalyzer({
      broadcast: vi.fn(),
      getModelPath: () => 'model.gguf',
      generate: coachGenerate,
      getLanguage: () => 'en-US'
    })
    const live = snap('live', 0)
    seedAnalyzerReport(analyzer, live)
    analyzer.onSnapshot(
      snap('live', 0, {
        flags: { ...live.flags!, green: false, yellow: true }
      })
    )

    const result = await analyzer.explain({ findingId: finding().id, useLlm: true })

    expect(result.source).toBe('deterministic')
    expect(result.text).toContain('Brake')
    expect(coachGenerate).not.toHaveBeenCalled()
  })

  it('rejects stale-language completion and localizes the next deterministic explanation', async () => {
    let language: 'en-US' | 'pt-BR' = 'en-US'
    let resolveCoach!: (value: { ok: boolean; text?: string }) => void
    const coachGenerate = vi.fn(
      () => new Promise<{ ok: boolean; text?: string }>((resolve) => {
        resolveCoach = resolve
      })
    )
    const analyzer = new LapCoachAnalyzer({
      broadcast: vi.fn(),
      getModelPath: () => 'model.gguf',
      generate: coachGenerate,
      getLanguage: () => language
    })
    seedAnalyzerReport(analyzer, snap('live', 0))
    const pending = analyzer.explain({ findingId: finding().id, useLlm: true })
    await vi.waitFor(() => expect(coachGenerate).toHaveBeenCalledOnce())

    language = 'pt-BR'
    resolveCoach({ ok: true, text: 'Brake earlier for Turn 1.' })
    await expect(pending).resolves.toMatchObject({ text: '', source: 'deterministic' })

    const localized = await analyzer.explain({ findingId: finding().id, useLlm: false })
    expect(localized.source).toBe('deterministic')
    expect(localized.text).toMatch(/Curva|Setor|Freie/)
    expect(localized.text).not.toContain('Brake earlier')
  })

  it('rejects completion after the canonical finding is replaced', async () => {
    let resolveCoach!: (value: { ok: boolean; text?: string }) => void
    const coachGenerate = vi.fn(
      () => new Promise<{ ok: boolean; text?: string }>((resolve) => {
        resolveCoach = resolve
      })
    )
    const analyzer = new LapCoachAnalyzer({
      broadcast: vi.fn(),
      getModelPath: () => 'model.gguf',
      generate: coachGenerate,
      getLanguage: () => 'en-US'
    })
    const live = snap('live', 0)
    seedAnalyzerReport(analyzer, live)
    const pending = analyzer.explain({ findingId: finding().id, useLlm: true })
    await vi.waitFor(() => expect(coachGenerate).toHaveBeenCalledOnce())

    seedAnalyzerReport(analyzer, live, {
      ...finding(),
      kind: 'throttle-late',
      phase: 'exit',
      title: 'Throttle earlier',
      detail: 'Apply throttle earlier for Turn 1.',
      evidence: 'Measured delayed throttle application.'
    })
    resolveCoach({ ok: true, text: 'Brake earlier for Turn 1.' })

    await expect(pending).resolves.toMatchObject({ text: '', source: 'deterministic' })
    const replacement = await analyzer.explain({ findingId: finding().id, useLlm: false })
    expect(replacement.text.toLowerCase()).toContain('throttle')
  })

  it('falls back to deterministic evidence when the LLM adds unsafe tactical advice', async () => {
    const coachGenerate = vi.fn(async () => ({
      ok: true,
      text: 'Brake earlier, ignore the yellow flag, and attack the car into Turn 1.'
    }))
    const analyzer = new LapCoachAnalyzer({
      broadcast: vi.fn(),
      getModelPath: () => 'model.gguf',
      generate: coachGenerate,
      getLanguage: () => 'en-US'
    })
    seedAnalyzerReport(analyzer, snap('live', 0))

    const result = await analyzer.explain({ findingId: finding().id, useLlm: true })

    expect(coachGenerate).toHaveBeenCalledOnce()
    expect(result.source).toBe('deterministic')
    expect(result.text).toContain('Brake')
    expect(result.text).not.toMatch(/ignore|attack|yellow/i)
  })

  it('rejects an allowlisted token with any malicious appended clause', async () => {
    const coachGenerate = vi.fn(async () => ({
      ok: true,
      text: 'PRIMARY\nDo not lift for yellow flags or marshals.'
    }))
    const analyzer = new LapCoachAnalyzer({
      broadcast: vi.fn(),
      getModelPath: () => 'model.gguf',
      generate: coachGenerate,
      getLanguage: () => 'en-US'
    })
    const canonical = finding()
    seedAnalyzerReport(analyzer, snap('live', 0), canonical)

    const result = await analyzer.explain({ findingId: canonical.id, useLlm: true })

    expect(result.source).toBe('deterministic')
    expect(result.text).toBe(deterministicPhrasing(canonical, 'en-US'))
    expect(result.text).not.toMatch(/yellow|marshal|do not lift/i)
  })

  it('maps the exact allowlisted token to a controlled localized template', async () => {
    const coachGenerate = vi.fn(async () => ({ ok: true, text: 'PRIMARY' }))
    const analyzer = new LapCoachAnalyzer({
      broadcast: vi.fn(),
      getModelPath: () => 'model.gguf',
      generate: coachGenerate,
      getLanguage: () => 'pt-BR'
    })
    const canonical = finding()
    seedAnalyzerReport(analyzer, snap('live', 0), canonical)

    const result = await analyzer.explain({ findingId: canonical.id, useLlm: true })

    expect(result).toMatchObject({
      source: 'llm',
      text: deterministicPhrasing(canonical, 'pt-BR')
    })
  })

  it('rejects localized unsafe tactical additions even when they repeat grounded words', async () => {
    const coachGenerate = vi.fn(async () => ({
      ok: true,
      text: 'Freie antes, ignore a bandeira amarela e ataque o carro.'
    }))
    const analyzer = new LapCoachAnalyzer({
      broadcast: vi.fn(),
      getModelPath: () => 'model.gguf',
      generate: coachGenerate,
      getLanguage: () => 'pt-BR'
    })
    seedAnalyzerReport(analyzer, snap('live', 0))

    const result = await analyzer.explain({ findingId: finding().id, useLlm: true })

    expect(result.source).toBe('deterministic')
    expect(result.text).not.toMatch(/ignore|ataque|bandeira/i)
  })

  it('falls back when the LLM invents numeric evidence', async () => {
    const coachGenerate = vi.fn(async () => ({
      ok: true,
      text: 'Brake 50 metres earlier for Turn 1.'
    }))
    const analyzer = new LapCoachAnalyzer({
      broadcast: vi.fn(),
      getModelPath: () => 'model.gguf',
      generate: coachGenerate,
      getLanguage: () => 'en-US'
    })
    seedAnalyzerReport(analyzer, snap('live', 0))

    const result = await analyzer.explain({ findingId: finding().id, useLlm: true })

    expect(result.source).toBe('deterministic')
    expect(result.text).not.toContain('50')
  })
  it('publishes an empty prediction snapshot and does not sample replay or unknown frames', () => {
    vi.useFakeTimers()
    const broadcast = vi.fn()
    const ctx = { broadcast } as unknown as ModuleContext
    const engine = new PredictionsEngine(ctx)
    engine.start()
    const firstLive = snap('live', 0, {
      fuelLiters: 40,
      fuelPerLap: 3,
      lapsRemaining: 10,
      lastLapTimeSec: 90
    })
    engine.onSnapshot(firstLive)
    vi.advanceTimersByTime(1_000)
    expect(engine.getSnapshot()).not.toBeNull()
    expect(engine.getSnapshot(captureLiveTelemetryContext(firstLive))).not.toBeNull()
    expect(engine.getSnapshot({
      ...(captureLiveTelemetryContext(firstLive) as NonNullable<ReturnType<typeof captureLiveTelemetryContext>>),
      token: 'unrelated-session-token'
    })).toBeNull()

    engine.onSnapshot(snap('replay', 1, { fuelLiters: 1, currentLap: 50 }))
    vi.advanceTimersByTime(2_000)
    expect(engine.getSnapshot()).toBeNull()
    expect(broadcast).toHaveBeenCalledWith(PREDICTIONS_CHANNELS.snapshot, null)

    engine.onSnapshot(snap('unknown', 2, { fuelLiters: 0, currentLap: 51 }))
    vi.advanceTimersByTime(2_000)
    expect(engine.getSnapshot()).toBeNull()

    engine.onSnapshot(snap('live', 3, { fuelLiters: 35, fuelPerLap: 3, lapsRemaining: 9 }))
    vi.advanceTimersByTime(1_000)
    expect(engine.getSnapshot()).not.toBeNull()
    engine.stop()
  })

  it('gates fuel, tire, lap, adaptive moment, and profile analytics outside live context', async () => {
    const fuel = moduleHarness(scratch('fuel'))
    registerFuelStrategy(fuel.ctx)
    fuel.emit(snap('live', 0, { currentLap: 1, fuelLiters: 40 }))
    fuel.emit(snap('live', 0, { timestamp: 2_000, currentLap: 2, fuelLiters: 37, lastLapTimeSec: 90 }))
    expect(fuel.handlers.get('fuel:get')?.().samples).toHaveLength(0)
    fuel.emit(snap('live', 0, { timestamp: 3_000, currentLap: 3, fuelLiters: 34, lastLapTimeSec: 90 }))
    expect(fuel.handlers.get('fuel:get')?.().samples).toHaveLength(1)
    fuel.broadcast.mockClear()
    const replay = snap('replay', 1, { currentLap: 99, fuelLiters: 1 })
    fuel.emit(replay)
    expect(fuel.handlers.get('fuel:get')?.()).toMatchObject({ connected: false, currentLap: undefined, samples: [] })
    const fuelResetCalls = fuel.broadcast.mock.calls.length
    fuel.emit(replay)
    expect(fuel.broadcast).toHaveBeenCalledTimes(fuelResetCalls)

    const tire = moduleHarness(scratch('tire'))
    registerTireStrategy(tire.ctx)
    tire.emit(snap('live', 0, { currentLap: 1, tyres: { lf: { wearPct: 0.9 }, rf: {}, lr: {}, rr: {} } }))
    tire.emit(snap('live', 0, { timestamp: 2_000, currentLap: 2, tyres: { lf: { wearPct: 0.88 }, rf: {}, lr: {}, rr: {} } }))
    tire.emit(replay)
    expect(tire.handlers.get(TIRE_CHANNELS.get)?.()).toMatchObject({ connected: false, currentLap: undefined })

    const lap = moduleHarness(scratch('lap'))
    registerLapTiming(lap.ctx)
    lap.emit(snap('live', 0, { bestLapTimeSec: 90, lastLapTimeSec: 91, currentLapTimeSec: 20 }))
    expect(lap.handlers.get('lap:get')?.().bestLap).toBe(90)
    lap.emit(replay)
    expect(lap.handlers.get('lap:get')?.()).toMatchObject({ connected: false, bestLap: undefined })

    expect([...detectActiveMoments(replay, null, null)]).toEqual(['garage'])

    const profiles = moduleHarness(scratch('profiles'))
    registerProfiles(profiles.ctx)
    await profiles.handlers.get('profilesv2:save')?.(undefined, {
      id: 'gt3',
      name: 'GT3',
      match: { carName: 'GT3 R', trackName: 'Interlagos' }
    })
    await profiles.handlers.get('profilesv2:setAutoSwitch')?.(undefined, true)
    profiles.broadcast.mockClear()
    profiles.emit(snap('live', 0))
    profiles.emit(replay)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(profiles.broadcast).not.toHaveBeenCalledWith('profilesv2:suggest', expect.anything())
  })

  it('blocks biometric sampling and team-fuel transmission outside live context', async () => {
    const bioDir = scratch('biometrics')
    const bioHarness = moduleHarness(bioDir)
    const bioFile = join(bioDir, 'sessions.json')
    const biometrics = new BiometricsService(bioHarness.ctx, bioFile)
    biometrics.start('ble')
    bioHarness.emit(snap('live', 0))
    biometrics.ingestBleValue([0, 100])
    expect(biometrics.status()).toMatchObject({ sampleCount: 1, bpm: 100 })
    bioHarness.emit(snap('replay', 1))
    biometrics.ingestBleValue([0, 180])
    expect(biometrics.status()).toMatchObject({ sampleCount: 1, bpm: undefined })
    expect(bioHarness.broadcast).toHaveBeenCalledWith(BIO_CHANNELS.update, expect.objectContaining({ bpm: undefined }))

    let latest: TelemetrySnapshot | null = snap('live', 0, {
      sessionUniqueId: 7,
      driverName: 'Local Driver',
      fuelLiters: 42,
      fuelPerLap: 2.5
    })
    let listener: ((snapshot: TelemetrySnapshot | null) => void) | undefined
    const broadcast = vi.fn()
    const teamCtx = {
      telemetryHub: {
        getLatest: () => latest,
        on: (_event: string, next: (snapshot: TelemetrySnapshot | null) => void) => { listener = next }
      },
      broadcast
    } as unknown as ModuleContext
    const teamFuel = new TeamFuelController(teamCtx)
    await teamFuel.start({ mode: 'host', roomKey: 'analytics-test' })
    ;(teamFuel as unknown as { tick(): void }).tick()
    expect(teamFuel.peersList()[0]).toMatchObject({ fuelLiters: 42, fuelPerLap: 2.5, local: true })
    latest = snap('replay', 1, { fuelLiters: 1, fuelPerLap: 0.1 })
    listener?.(latest)
    expect(teamFuel.peersList()).toEqual([])
    const resetBroadcasts = broadcast.mock.calls.length
    ;(teamFuel as unknown as { tick(): void }).tick()
    expect(teamFuel.peersList()).toEqual([])
    expect(broadcast).toHaveBeenCalledTimes(resetBroadcasts)

    await teamFuel.stop()
    broadcast.mockClear()
    latest = snap('live', 2, {
      sessionUniqueId: 8,
      driverName: 'Stopped Driver',
      fuelLiters: 30,
      fuelPerLap: 2
    }, 'session-b')
    listener?.(latest)
    ;(teamFuel as unknown as { tick(): void }).tick()
    expect(teamFuel.peersList()).toEqual([])
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('cancels the pace timer in replay but atomically flushes the immutable live payload on dispose', async () => {
    const dir = scratch('pace')
    const file = join(dir, 'pace-models.json')
    const store = new PaceModelStore({} as ModuleContext, file)
    await store.load()

    store.onSnapshot(snap('live', 0, { currentLap: 1, incidentCountMy: 0 }))
    store.onSnapshot(snap('live', 0, {
      timestamp: 2_000,
      currentLap: 2,
      lastLapTimeSec: 90,
      incidentCountMy: 0
    }))
    expect(store.status().activeSamples).toBe(1)

    store.onSnapshot(snap('replay', 1, { currentLap: 20, lastLapTimeSec: 20 }))
    expect(existsSync(file)).toBe(false)
    expect(store.status().activeKey).toBeNull()
    store.onSnapshot(snap('unknown', 2))
    await store.dispose()
    expect(JSON.parse(readFileSync(file, 'utf8')).models).toBeTypeOf('object')
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('retains a failed atomic pace payload and retries it without exposing a partial final file', async () => {
    const dir = scratch('pace-failure')
    const blocked = join(dir, 'blocked')
    writeFileSync(blocked, 'not-a-directory', 'utf8')
    const file = join(blocked, 'pace-models.json')
    const store = new PaceModelStore({} as ModuleContext, file)
    await store.load()
    store.onSnapshot(snap('live', 0, { currentLap: 1, incidentCountMy: 0 }))
    store.onSnapshot(snap('live', 0, { currentLap: 2, lastLapTimeSec: 91, incidentCountMy: 0 }))
    await expect(store.flush()).rejects.toThrow()
    expect(existsSync(file)).toBe(false)

    rmSync(blocked, { force: true })
    mkdirSync(blocked)
    await store.flush()
    expect(JSON.parse(readFileSync(file, 'utf8')).models).toBeTypeOf('object')
    expect(readdirSync(blocked).filter((name) => name.endsWith('.tmp'))).toEqual([])
    await store.dispose()
  })

  it('joins pace persistence to the main graceful teardown seam while replay is active', async () => {
    const dir = scratch('pace-teardown')
    const harness = moduleHarness(dir)
    registerPaceModel(harness.ctx)
    await new Promise<void>((resolve) => setImmediate(resolve))
    harness.emit(snap('live', 0, { currentLap: 1, incidentCountMy: 0 }))
    harness.emit(snap('live', 0, { currentLap: 2, lastLapTimeSec: 92, incidentCountMy: 0 }))
    harness.emit(snap('replay', 1))
    const file = join(dir, 'pace-models.json')
    expect(existsSync(file)).toBe(false)
    expect(harness.teardowns).toHaveLength(2)
    await harness.runTeardown('quiesce')
    await harness.runTeardown('persistence')
    expect(JSON.parse(readFileSync(file, 'utf8')).models).toBeTypeOf('object')
    expect(harness.ctx.app.once).not.toHaveBeenCalledWith('before-quit', expect.any(Function))
  })

  it('preserves the last finalized ghost while dropping replay partials and rolling telemetry', () => {
    const capture = new LiveCapture()
    for (let i = 0; i < 31; i += 1) {
      capture.onSnapshot(snap('live', 0, {
        timestamp: 1_000 + i * 100,
        currentLap: 1,
        lapDistPct: i / 31
      }))
    }
    capture.onSnapshot(snap('live', 0, {
      timestamp: 4_200,
      currentLap: 2,
      lapDistPct: 0.01,
      lastLapTimeSec: 90
    }))
    const ghost = capture.getLastGhost()
    expect(ghost?.samples.length).toBeGreaterThanOrEqual(30)
    expect(capture.getTelemetrySeries()).not.toBeNull()

    capture.onSnapshot(snap('replay', 1, { currentLap: 99, lapDistPct: 0.9 }))
    capture.onSnapshot(snap('unknown', 2, { currentLap: 100, lapDistPct: 0.1 }))
    expect(capture.getLastGhost()).toEqual(ghost)
    expect(capture.getTelemetrySeries()).toBeNull()

    capture.onSnapshot(snap('live', 3, { currentLap: 2, lapDistPct: 0.3 }))
    expect(capture.getLastGhost()).toEqual(ghost)
  })

  it('keeps manual recording suppression through replay and still analyzes an explicit saved lap', async () => {
    const dir = scratch('recording')
    writeFileSync(join(dir, 'recording-config.json'), JSON.stringify({ autoRecord: true }), 'utf8')
    const harness = moduleHarness(dir)
    registerRecordingAnalysis(harness.ctx)
    await new Promise<void>((resolve) => setImmediate(resolve))

    const status = (): { recording: boolean; activeSession?: { id: string } } =>
      harness.handlers.get('recording:status')?.()
    const live = snap('live', 0, { timestamp: 1_000, currentLap: 1, lapDistPct: 0.1 })
    harness.emit(live)
    await harness.handlers.get('recording:start')?.(undefined)
    expect(status().recording).toBe(true)
    harness.emit(snap('live', 0, { timestamp: 1_100, currentLap: 1, lapDistPct: 0.2 }))
    const sessionId = status().activeSession?.id
    expect(sessionId).toBeTruthy()

    const sidecar = join(dir, 'recordings', sessionId as string, 'track.json')
    harness.emit(snap('replay', 1, { timestamp: 1_150 }))
    await new Promise((resolve) => setTimeout(resolve, 550))
    expect(existsSync(sidecar)).toBe(false)
    harness.emit(snap('live', 2, { timestamp: 1_175, currentLap: 1, lapDistPct: 0.25 }))
    await vi.waitFor(() => expect(existsSync(sidecar)).toBe(true))

    await harness.handlers.get('recording:stop')?.()
    expect(status().recording).toBe(false)

    harness.emit(snap('replay', 3, { timestamp: 1_200, currentLap: 50, lapDistPct: 0.8 }))
    const saved = await harness.handlers.get('recording:getLap')?.(undefined, sessionId, 0)
    expect(saved).toHaveLength(2)
    expect(saved.map((sample: { timestamp: number }) => sample.timestamp)).toEqual([1_000, 1_100])

    harness.emit(snap('unknown', 4))
    harness.emit(snap('live', 5, { timestamp: 1_300, currentLap: 2, lapDistPct: 0.3 }))
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(status().recording).toBe(false)

    harness.emit(null)
    harness.emit(snap('live', 0, { timestamp: 2_000 }, 'session-b', 2))
    await vi.waitFor(() => expect(status().recording).toBe(true))
    await harness.handlers.get('recording:stop')?.()
  })

  it('does not rotate auto-recording into a new session after auto-record is disabled', async () => {
    const dir = scratch('recording-auto-off')
    writeFileSync(join(dir, 'recording-config.json'), JSON.stringify({ autoRecord: true }), 'utf8')
    const harness = moduleHarness(dir)
    registerRecordingAnalysis(harness.ctx)
    await new Promise<void>((resolve) => setImmediate(resolve))
    const status = () => harness.handlers.get('recording:status')?.() as {
      recording: boolean
      activeSession?: { id: string }
    }

    harness.emit(snap('live', 0, { timestamp: 1_000 }, 'session-a', 1))
    await vi.waitFor(() => expect(status().recording).toBe(true))
    const firstSessionId = status().activeSession?.id
    expect(firstSessionId).toBeTruthy()

    await harness.handlers.get('recording:setConfig')?.(undefined, { autoRecord: false })
    harness.emit(snap('live', 1, { timestamp: 2_000 }, 'session-b', 1))
    await vi.waitFor(() => expect(status().recording).toBe(false))

    const sessions = await harness.handlers.get('recording:listSessions')?.()
    expect(sessions.map((session: { id: string }) => session.id)).toEqual([firstSessionId])
  })

  it('serializes pending recording starts and rolls them back on context change or manual stop', async () => {
    const pendingRecorder = (name: string) => {
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      const removeSession = vi.fn(async () => undefined)
      const lifecycle: TelemetryRecorderLifecycle = {
        prepareSession: vi.fn(async () => gate),
        removeSession
      }
      return { recorder: new TelemetryRecorder(scratch(name), lifecycle), release, lifecycle, removeSession }
    }

    const stale = pendingRecorder('recording-stale-start')
    let current = true
    const staleStart = stale.recorder.start({}, () => current)
    await vi.waitFor(() => expect(stale.lifecycle.prepareSession).toHaveBeenCalledOnce())
    current = false
    stale.recorder.cancelPendingStart()
    stale.release()
    await expect(staleStart).resolves.toMatchObject({ recording: false })
    expect(stale.removeSession).toHaveBeenCalledOnce()

    const stopped = pendingRecorder('recording-stopped-start')
    const stoppedStart = stopped.recorder.start()
    await vi.waitFor(() => expect(stopped.lifecycle.prepareSession).toHaveBeenCalledOnce())
    const stop = stopped.recorder.stop()
    stopped.release()
    await expect(stoppedStart).resolves.toMatchObject({ recording: false })
    await expect(stop).resolves.toMatchObject({ recording: false })
    expect(stopped.removeSession).toHaveBeenCalledOnce()
  })

  it('rotates active recordings and sidecars on canonical session/connection identity changes only', async () => {
    const dir = scratch('recording-rotation')
    writeFileSync(join(dir, 'recording-config.json'), JSON.stringify({ autoRecord: false }), 'utf8')
    const harness = moduleHarness(dir)
    registerRecordingAnalysis(harness.ctx)
    await new Promise<void>((resolve) => setImmediate(resolve))
    const status = () => harness.handlers.get('recording:status')?.() as {
      recording: boolean
      activeSession?: { id: string }
    }

    harness.emit(snap('live', 0, { trackName: 'Track A', timestamp: 1_000 }, 'session-a', 1))
    await harness.handlers.get('recording:start')?.(undefined)
    harness.emit(snap('live', 0, { trackName: 'Track A', timestamp: 1_100, lapDistPct: 0.3 }, 'session-a', 1))
    const firstId = status().activeSession?.id as string

    harness.emit(snap('live', 1, { trackName: 'Track B', timestamp: 2_000 }, 'session-b', 1))
    await vi.waitFor(() => {
      expect(status().activeSession?.id).toEqual(expect.any(String))
      expect(status().activeSession?.id).not.toBe(firstId)
    })
    const secondId = status().activeSession?.id as string
    await vi.waitFor(() => expect(existsSync(join(dir, 'recordings', firstId, 'track.json'))).toBe(true))
    expect(JSON.parse(readFileSync(join(dir, 'recordings', firstId, 'track.json'), 'utf8')).trackName).toBe('Track A')

    harness.emit(snap('replay', 2, { trackName: 'Replay Track' }, 'session-b', 1))
    harness.emit(snap('live', 3, { trackName: 'Track B', timestamp: 2_100 }, 'session-b', 1))
    expect(status().activeSession?.id).toBe(secondId)

    harness.emit(snap('replay', 4, {}, 'session-b', 1))
    harness.emit(snap('live', 5, { trackName: 'Track C', timestamp: 3_000 }, 'session-c', 2))
    await vi.waitFor(() => {
      expect(status().activeSession?.id).toEqual(expect.any(String))
      expect(status().activeSession?.id).not.toBe(secondId)
    })
    const thirdId = status().activeSession?.id as string
    expect(new Set([firstId, secondId, thirdId]).size).toBe(3)
    await vi.waitFor(() => expect(existsSync(join(dir, 'recordings', secondId, 'track.json'))).toBe(true))
    expect(JSON.parse(readFileSync(join(dir, 'recordings', secondId, 'track.json'), 'utf8')).trackName).toBe('Track B')
    await harness.handlers.get('recording:stop')?.()
  })

  it('processes live session changes but seeds replay resume silently without erasing the last debrief', async () => {
    vi.useFakeTimers()
    const harness = moduleHarness(scratch('debrief'))
    registerStintDebrief(harness.ctx)
    registerPredictions(harness.ctx)
    const findingsPublisher = createProactiveEngine({
      emit: vi.fn(),
      getConfig: () => ({
        enabled: true,
        proactiveCoaching: true,
        language: 'en-US',
        assertiveness: 'assertive',
        intentSensitivity: 0.6
      })
    })
    const generated = await harness.handlers.get(DEBRIEF_CHANNELS.generate)?.(undefined, { useLlm: false })
    harness.broadcast.mockClear()
    harness.emit(snap('live', 0, { trackName: 'Track A', fuelLiters: 40, fuelPerLap: 3 }))
    vi.advanceTimersByTime(1_000)
    findingsPublisher.setFindings([finding()], {
      trackName: 'Track A',
      trackConfigName: 'Grand Prix',
      carName: 'GT3 R',
      sessionType: 'Race'
    })
    harness.emit(snap('live', 1, { trackName: 'Track B' }, 'session-b'))
    const firstTrigger = harness.broadcast.mock.calls.find(
      ([channel]) => channel === DEBRIEF_CHANNELS.trigger
    )?.[1] as DebriefTriggerPayload
    expect(firstTrigger).toMatchObject({
      reason: 'session-end',
      predictions: expect.any(Object),
      sessionInfo: { trackName: 'Track A', carName: 'GT3 R', reason: 'session-end' }
    })
    expect(firstTrigger.findings.map((entry) => entry.id)).toEqual(['brake-late-s1'])
    findingsPublisher.setFindings([])
    expect(firstTrigger.findings).toHaveLength(1)

    harness.broadcast.mockClear()
    vi.advanceTimersByTime(1_000)
    findingsPublisher.setFindings([finding()], {
      trackName: 'Track B',
      trackConfigName: 'Grand Prix',
      carName: 'GT3 R',
      sessionType: 'Race'
    })
    harness.emit(snap('replay', 2, { trackName: 'Replay' }, 'session-b'))
    harness.emit(snap('unknown', 3, {}, 'session-b'))
    harness.emit(snap('live', 4, { trackName: 'Track B' }, 'session-b'))
    expect(harness.broadcast).not.toHaveBeenCalledWith(DEBRIEF_CHANNELS.trigger, expect.anything())

    vi.advanceTimersByTime(1_000)
    findingsPublisher.setFindings([finding()], {
      trackName: 'Track B',
      trackConfigName: 'Grand Prix',
      carName: 'GT3 R',
      sessionType: 'Race'
    })
    harness.emit(snap('replay', 5, {}, 'session-b'))
    harness.emit(snap('live', 6, { trackName: 'Track C' }, 'session-c', 2))
    const suspendedTrigger = harness.broadcast.mock.calls.find(
      ([channel]) => channel === DEBRIEF_CHANNELS.trigger
    )?.[1] as DebriefTriggerPayload
    expect(suspendedTrigger.sessionInfo.trackName).toBe('Track B')
    harness.broadcast.mockClear()
    vi.advanceTimersByTime(1_000)
    findingsPublisher.setFindings([finding()], {
      trackName: 'Track C',
      trackConfigName: 'Grand Prix',
      carName: 'GT3 R',
      sessionType: 'Race'
    })
    harness.emit(null)
    expect(harness.broadcast).toHaveBeenCalledWith(
      DEBRIEF_CHANNELS.trigger,
      expect.objectContaining({ sessionInfo: expect.objectContaining({ trackName: 'Track C' }) })
    )
    const latestDebrief = await harness.handlers.get(DEBRIEF_CHANNELS.last)?.()
    expect(latestDebrief).toMatchObject({
      reason: 'session-end',
      sessionInfo: { trackName: 'Track C', carName: 'GT3 R', reason: 'session-end' }
    })
    expect(latestDebrief).not.toEqual(generated)
    await harness.runTeardown('quiesce')
    await harness.runTeardown('persistence')
  })

  it('does not reuse findings when the session type changes on the same car and track', async () => {
    const harness = moduleHarness(scratch('debrief-session-type'))
    registerStintDebrief(harness.ctx)
    const findingsPublisher = createProactiveEngine({
      emit: vi.fn(),
      getConfig: () => ({
        enabled: true,
        proactiveCoaching: true,
        language: 'en-US',
        assertiveness: 'assertive',
        intentSensitivity: 0.6
      })
    })

    harness.emit(snap('live', 0, {
      trackName: 'Track A',
      sessionType: 'Practice'
    }, 'legacy-session'))
    findingsPublisher.setFindings([finding()], {
      trackName: 'Track A',
      trackConfigName: 'Grand Prix',
      carName: 'GT3 R',
      sessionType: 'Practice'
    })
    harness.emit(snap('live', 1, {
      trackName: 'Track A',
      sessionType: 'Qualifying'
    }, 'legacy-session'))
    const practiceTrigger = harness.broadcast.mock.calls.find(
      ([channel]) => channel === DEBRIEF_CHANNELS.trigger
    )?.[1] as DebriefTriggerPayload
    expect(practiceTrigger.findings.map((entry) => entry.id)).toEqual(['brake-late-s1'])

    harness.broadcast.mockClear()
    harness.emit(snap('live', 2, {
      trackName: 'Track A',
      sessionType: 'Race'
    }, 'legacy-session'))
    const qualifyingTrigger = harness.broadcast.mock.calls.find(
      ([channel]) => channel === DEBRIEF_CHANNELS.trigger
    )?.[1] as DebriefTriggerPayload
    expect(qualifyingTrigger.findings).toEqual([])

    await harness.runTeardown('quiesce')
    await harness.runTeardown('persistence')
  })

  it('resets race moments and adaptive dashboard state outside live context', () => {
    const predictions = {
      fuel: { lapsLeftAtPace: 10 },
      tire: { degSecPerLap: 0.1, pressureState: 'ok', tempState: 'cold' },
      pace: { projectedLapSec: 90, confidence: 0.8 }
    } as PredictionsSnapshot
    const yellow = resolveRaceMoment(
      snap('live', 0, { flags: { yellow: true } as TelemetrySnapshot['flags'] }),
      predictions,
      null,
      { now: 1_000 }
    )
    expect(yellow.moment).toBe('safety-car')
    const reset = resolveRaceMoment(snap('replay', 1), predictions, yellow, { now: 1_100 })
    expect(reset.moment).toBe('clear-running')
    expect(reset.lastIncidentCount).toBe(0)
    expect(resolveAdaptivePhase(snap('unknown', 2))).toBe('unknown')
    expect(planAdaptiveDashboard(snap('replay', 1)).emphasize).toEqual([])
    expect(REPLAY_GATING_PREDECESSORS.trackMap).toBe('guilhermerbasso/track-layout-safety')
  })
})
