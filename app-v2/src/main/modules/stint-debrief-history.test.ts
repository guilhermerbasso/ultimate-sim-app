import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GracefulTeardownPhase, ModuleContext } from '../module-context'
import type { CoachFinding } from '../../shared/coach'
import type { PredictionsSnapshot } from '../../shared/predictions'
import type { SetupReport } from '../../shared/setup-advisor'
import {
  DEBRIEF_CHANNELS,
  type DebriefArchiveGenerateResult,
  type DebriefArchiveSummary
} from '../../shared/stint-debrief'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import { register as registerStintDebrief } from './stint-debrief'

vi.mock('electron', () => ({
  app: {},
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openPath: vi.fn(async () => '') }
}))

const scratchDirs: string[] = []

function scratch(name: string): string {
  const directory = join(
    process.cwd(),
    `.stint-debrief-history-${name}-${process.pid}-${Date.now()}-${scratchDirs.length}`
  )
  mkdirSync(directory, { recursive: true })
  scratchDirs.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of scratchDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function snapshot(
  sessionIdentity: string,
  trackName: string,
  revision: number
): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 10_000 + revision * 100,
    speedKmh: 180,
    rpm: 7_000,
    gear: 4,
    throttle: 0.8,
    brake: 0,
    clutch: 0,
    currentLap: 9,
    completedLaps: 8,
    lapDistPct: 0.5,
    sessionType: 'Race',
    trackName,
    trackConfigName: 'Grand Prix',
    carName: 'GT3 R',
    onPitRoad: false,
    replayContext: {
      state: 'live',
      reason: 'confirmed-live',
      inputs: {},
      active: false,
      revision,
      token: `token-${sessionIdentity}-${revision}`,
      sessionIdentity,
      connectionEpoch: 1
    }
  }
}

function finding(id: string): CoachFinding {
  return {
    id,
    kind: 'brake-late',
    phase: 'entry',
    sector: 1,
    corner: 1,
    zonePctStart: 0.1,
    zonePctEnd: 0.2,
    severity: 'med',
    estTimeLossSec: 0.3,
    title: 'Brake earlier',
    detail: 'Release before turn-in.',
    evidence: 'Brake release was 12 m late.',
    metrics: { brakeReleaseDeltaM: 12 }
  }
}

function setup(change: string): SetupReport {
  return {
    generatedAt: 12_000,
    summary: 'One context-bound change.',
    suggestions: [{
      id: `setup:${change}`,
      symptom: 'understeer-entry',
      phase: 'entry',
      confidence: 'high',
      rationale: 'Measured entry understeer repeated on clean laps.',
      evidence: 'Steering correction averaged 8 degrees on entry.',
      primary: {
        area: 'arb',
        direction: 'soften',
        magnitude: 'small',
        change
      },
      alternatives: [{
        area: 'dampers',
        direction: 'soften',
        magnitude: 'small',
        change: 'Soften front low-speed compression one step.'
      }],
      metrics: { steeringCorrectionDeg: 8 }
    }]
  }
}

const predictions: PredictionsSnapshot = {
  fuel: { lapsLeftAtPace: 12, finishMarginLaps: 2, finishMarginL: 6 },
  tire: {
    degSecPerLap: 0.08,
    lapsToCliff: 7,
    pressureState: 'ok',
    tempState: 'optimal'
  },
  pace: { projectedLapSec: 90, confidence: 0.8 }
}

function moduleHarness(root: string) {
  const handlers = new Map<string, (...args: any[]) => any>()
  const listeners: Array<(snapshot: TelemetrySnapshot | null) => void> = []
  const teardown = new Map<GracefulTeardownPhase, Array<() => void | Promise<void>>>()
  const broadcast = vi.fn()
  const ctx = {
    app: {
      getPath: () => root,
      getLocale: () => 'en-US',
      once: vi.fn()
    },
    ipcMain: {
      handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler)
    },
    telemetryHub: {
      on: (event: string, listener: (snapshot: TelemetrySnapshot | null) => void) => {
        if (event === 'snapshot') listeners.push(listener)
      }
    },
    broadcast,
    registerGracefulTeardown: (
      callback: () => void | Promise<void>,
      phase: GracefulTeardownPhase
    ) => {
      const callbacks = teardown.get(phase) ?? []
      callbacks.push(callback)
      teardown.set(phase, callbacks)
    }
  } as unknown as ModuleContext

  return {
    ctx,
    handlers,
    broadcast,
    emit(snapshotValue: TelemetrySnapshot | null): void {
      for (const listener of listeners) listener(snapshotValue)
    },
    async teardown(phase: GracefulTeardownPhase): Promise<void> {
      for (const callback of teardown.get(phase) ?? []) await callback()
    }
  }
}

async function listArchive(
  handlers: Map<string, (...args: any[]) => any>
): Promise<DebriefArchiveSummary[]> {
  return handlers.get(DEBRIEF_CHANNELS.archiveList)?.() as Promise<DebriefArchiveSummary[]>
}

describe('historical stint debrief integration', () => {
  it('captures findings, predictions, and setup from the same ended live context', async () => {
    const root = scratch('matching-context')
    const harness = moduleHarness(root)
    const seenContexts: string[] = []
    registerStintDebrief(harness.ctx, {
      createArchiveId: () => 'debrief_1111111111111111',
      now: () => 20_000,
      getAnalysis: (context) => {
        seenContexts.push(context?.liveContext?.token ?? 'missing')
        return {
          findings: [finding(`finding:${context?.trackName}`)],
          setup: setup(`Soften front anti-roll bar for ${context?.trackName}.`)
        }
      },
      getPredictions: (context) => {
        seenContexts.push(context?.token ?? 'missing')
        return predictions
      }
    })

    harness.emit(snapshot('session-a', 'Track A', 1))
    harness.emit(snapshot('session-b', 'Track B', 2))
    const summaries = await listArchive(harness.handlers)
    expect(summaries).toEqual([
      expect.objectContaining({
        id: 'debrief_1111111111111111',
        sessionInfo: expect.objectContaining({ trackName: 'Track A' }),
        setupStatus: 'available'
      })
    ])
    expect(seenContexts).toEqual(['token-session-a-1', 'token-session-a-1'])

    const generated = await harness.handlers.get(DEBRIEF_CHANNELS.archiveGenerate)?.(
      undefined,
      { sessionId: summaries[0].id, useLlm: false }
    ) as DebriefArchiveGenerateResult
    expect(generated.debrief.sessionInfo?.trackName).toBe('Track A')
    expect(generated.debrief.text).toContain('Track A')
    expect(generated.setup?.suggestions[0].primary.change).toContain('Track A')
    expect(generated.setup?.suggestions[0].primary.change).not.toContain('Track B')
    expect(harness.broadcast).toHaveBeenCalledWith(
      DEBRIEF_CHANNELS.archiveUpdated,
      expect.objectContaining({ latest: expect.objectContaining({ id: summaries[0].id }) })
    )

    await harness.teardown('quiesce')
    await harness.teardown('persistence')
  })

  it('isolates selected history from current state and never lets LLM rewrite setup', async () => {
    const root = scratch('selected-isolation')
    const harness = moduleHarness(root)
    const archivedSetup = setup('Reduce rear wing one click.')
    let currentSetup = archivedSetup
    const phrase = vi.fn(async (_system: string, prompt: string) =>
      prompt.split('\n\n')[0])
    registerStintDebrief(harness.ctx, {
      createArchiveId: () => 'debrief_2222222222222222',
      now: () => 30_000,
      phrase,
      getAnalysis: () => ({
        findings: [finding('historical-finding')],
        setup: currentSetup
      }),
      getPredictions: () => predictions
    })
    harness.emit(snapshot('session-a', 'Historical Track', 1))
    harness.emit(snapshot('session-b', 'Current Track', 2))
    const [summary] = await listArchive(harness.handlers)

    currentSetup = setup('LIVE unrelated setup change.')
    archivedSetup.suggestions[0].primary.change = 'MUTATED after capture.'
    const generated = await harness.handlers.get(DEBRIEF_CHANNELS.archiveGenerate)?.(
      undefined,
      { sessionId: summary.id, useLlm: true }
    ) as DebriefArchiveGenerateResult
    expect(generated.debrief.text).toContain('Historical Track')
    expect(generated.debrief.source).toBe('llm')
    expect(generated.setup?.suggestions[0].primary.change).toBe('Reduce rear wing one click.')
    expect(generated.setup).not.toEqual(currentSetup)
    expect(phrase).toHaveBeenCalledTimes(1)
    expect(phrase.mock.calls[0][1]).not.toContain('Reduce rear wing')
    expect(phrase.mock.calls[0][1]).not.toContain('setup')

    phrase.mockResolvedValueOnce(generated.debrief.text.split(/\s+/u).reverse().join(' '))
    const rejectedReorder = await harness.handlers.get(DEBRIEF_CHANNELS.archiveGenerate)?.(
      undefined,
      { sessionId: summary.id, useLlm: true }
    ) as DebriefArchiveGenerateResult
    expect(rejectedReorder.debrief.source).toBe('deterministic')
    expect(rejectedReorder.debrief.text).toContain('Historical Track')

    phrase.mockResolvedValueOnce('Reduce rear wing five clicks.')
    const rejectedRewrite = await harness.handlers.get(DEBRIEF_CHANNELS.archiveGenerate)?.(
      undefined,
      { sessionId: summary.id, useLlm: true }
    ) as DebriefArchiveGenerateResult
    expect(rejectedRewrite.debrief.source).toBe('deterministic')
    expect(rejectedRewrite.debrief.text).not.toContain('five clicks')
    expect(rejectedRewrite.setup?.suggestions[0].primary.change)
      .toBe('Reduce rear wing one click.')

    await harness.teardown('quiesce')
    await harness.teardown('persistence')
  })

  it('rejects invalid or missing IDs and returns explicit no-evidence setup state', async () => {
    const root = scratch('missing-insufficient')
    const harness = moduleHarness(root)
    registerStintDebrief(harness.ctx, {
      createArchiveId: () => 'debrief_3333333333333333',
      now: () => 40_000,
      phrase: async () => {
        throw new Error('local model unavailable')
      },
      getAnalysis: () => ({ findings: [], setup: null }),
      getPredictions: () => null
    })
    harness.emit(snapshot('session-a', 'Evidence-Free Track', 1))
    harness.emit(snapshot('session-b', 'Next Track', 2))
    const [summary] = await listArchive(harness.handlers)
    const generated = await harness.handlers.get(DEBRIEF_CHANNELS.archiveGenerate)?.(
      undefined,
      { sessionId: summary.id, useLlm: true }
    ) as DebriefArchiveGenerateResult
    expect(generated.setup).toBeNull()
    expect(generated.setupStatus).toBe('insufficient')
    expect(generated.analysisStatus).toBe('insufficient')
    expect(generated.debrief.source).toBe('deterministic')

    await expect(
      harness.handlers.get(DEBRIEF_CHANNELS.archiveGenerate)?.(undefined, {
        sessionId: '..\\recordings\\raw.json'
      })
    ).rejects.toThrow('invalid')
    await expect(
      harness.handlers.get(DEBRIEF_CHANNELS.archiveGenerate)?.(undefined, {
        sessionId: 'debrief_ffffffffffffffff'
      })
    ).rejects.toThrow('not found or was deleted')

    await harness.teardown('quiesce')
    await harness.teardown('persistence')
  })

  it('migrates the previous last-debrief file without fabricating setup evidence', async () => {
    const root = scratch('legacy-migration')
    writeFileSync(join(root, 'stint-debrief.json'), JSON.stringify({
      generatedAt: 5_000,
      text: 'Legacy persisted debrief.',
      bullets: ['✅ Turn 1'],
      source: 'deterministic',
      language: 'en-US',
      reason: 'session-end',
      sessionInfo: {
        trackName: 'Legacy Track',
        carName: 'Legacy Car',
        sessionType: 'Practice',
        lapsCompleted: 4,
        reason: 'session-end'
      }
    }), 'utf8')
    const harness = moduleHarness(root)
    registerStintDebrief(harness.ctx)

    const [summary] = await listArchive(harness.handlers)
    expect(summary).toMatchObject({
      captureSource: 'legacy-last-debrief',
      setupStatus: 'legacy',
      analysisStatus: 'legacy',
      sessionInfo: { trackName: 'Legacy Track' }
    })
    const generated = await harness.handlers.get(DEBRIEF_CHANNELS.archiveGenerate)?.(
      undefined,
      { sessionId: summary.id }
    ) as DebriefArchiveGenerateResult
    expect(generated.debrief.text).toBe('Legacy persisted debrief.')
    expect(generated.setup).toBeNull()

    await harness.teardown('quiesce')
    await harness.teardown('persistence')
    expect(existsSync(join(root, 'stint-debrief-archive.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(root, 'stint-debrief-archive.json'), 'utf8')).records)
      .toHaveLength(1)
  })
})
