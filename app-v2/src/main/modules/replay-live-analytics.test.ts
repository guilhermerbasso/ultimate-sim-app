import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModuleContext } from '../module-context'
import type { GenerateRequest, GenerateResult, LlmRuntimeStatus, ModelId } from '../../shared/ai'
import type { EngineerContext } from '../../shared/ai-engineer'
import { COACH_CHANNELS, type CoachFinding } from '../../shared/coach'
import type { CoachLapHistoryEntry } from '../../shared/coach-racecraft'
import { DEFAULT_ENGINEER_CONFIG, ENGINEER_CHANNELS } from '../../shared/engineer-ipc'
import { PREDICTIONS_CHANNELS, type PredictionsSnapshot } from '../../shared/predictions'
import {
  captureLiveTelemetryContext,
  REPLAY_GATING_PREDECESSORS,
  type ReplayContext,
  type ReplayContextState
} from '../../shared/replay'
import { TIRE_CHANNELS } from '../../shared/tire-strategy'
import { BIO_CHANNELS } from '../../shared/biometrics'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import { planAdaptiveDashboard, resolveAdaptivePhase } from '../../shared/dashboard-adaptive'
import { detectActiveMoments, resolveRaceMoment } from '../../shared/race-moment'
import { createEngineerOrchestrator } from './ai-engineer'
import { BiometricsService } from './biometrics'
import { LapCoachAnalyzer, LiveCoachEngine } from './coach'
import { LiveCapture } from './community-local'
import { register as registerFuelStrategy } from './fuel-strategy'
import { register as registerLapTiming } from './lap-timing'
import { PredictionsEngine } from './predictions'
import { createProactiveEngine } from './proactive-engineer'
import { register as registerProfiles } from './profiles-v2'
import { TeamFuelController } from './team-fuel'
import { register as registerTireStrategy } from './tire-strategy'
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
function moduleHarness(userData: string) {
  const handlers = new Map<string, (...args: any[]) => any>()
  const broadcast = vi.fn()
  let latest: TelemetrySnapshot | null = null
  const listeners: Array<(snapshot: TelemetrySnapshot | null) => void> = []
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
    getMainWindow: () => null
  } as unknown as ModuleContext
  return {
    ctx, handlers, broadcast,
    emit(snapshot: TelemetrySnapshot | null) {
      latest = snapshot
      for (const listener of listeners) listener(snapshot)
    },
    latest: () => latest
  }
}
describe('canonical replay boundaries for live analytics', () => {
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
    analyzer.onSnapshot(snap('live', 0))
    const explanation = analyzer.explain({ finding: finding(), useLlm: true })
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
  it('publishes an empty prediction snapshot and does not sample replay or unknown frames', () => {
    vi.useFakeTimers()
    const broadcast = vi.fn()
    const ctx = { broadcast } as unknown as ModuleContext
    const engine = new PredictionsEngine(ctx)
    engine.start()
    engine.onSnapshot(snap('live', 0, {
      fuelLiters: 40,
      fuelPerLap: 3,
      lapsRemaining: 10,
      lastLapTimeSec: 90
    }))
    vi.advanceTimersByTime(1_000)
    expect(engine.getSnapshot()).not.toBeNull()

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
