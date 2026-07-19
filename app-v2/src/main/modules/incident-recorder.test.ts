import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import type { ModuleContext } from '../module-context'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { IncidentClip } from '../../shared/incidents'
import type { IncidentClipRepository, VerifiedIncidentClip } from '../incidents/clip-store'
import { logger } from './logger'

// Keep the optional LLM machinery inert.
vi.mock('../ai/llm-runtime', () => ({ getLlmRuntime: () => ({}) }))
vi.mock('../ai/model-manager', () => ({ getModelManager: () => ({ getActiveModelPath: () => null }) }))

import { register } from './incident-recorder'

function clipRepository(overrides: Partial<IncidentClipRepository> = {}): IncidentClipRepository {
  return {
    load: vi.fn(),
    list: vi.fn(() => []),
    getVerified: vi.fn(() => null),
    save: vi.fn((clip: IncidentClip) => ({
      clip,
      contentHash: 'test'
    }) as unknown as VerifiedIncidentClip),
    clear: vi.fn(() => 0),
    ...overrides
  }
}

function makeCtx(): ModuleContext {
  return {
    app: { getPath: (_name: string) => '/userData' },
    ipcMain: { handle: vi.fn() } as unknown as IpcMain,
    telemetryHub: { on: vi.fn() },
    broadcast: vi.fn()
  } as unknown as ModuleContext
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('incident-recorder log area', () => {
  it('logs incident-recorder activity under "incidents", not "ai"', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const store = clipRepository({
      load: vi.fn(() => {
        throw new Error('boom')
      })
    })

    register(makeCtx(), { clipStore: store })

    expect(warn).toHaveBeenCalledWith(
      'incidents',
      'failed to load incident clips',
      expect.objectContaining({ message: expect.any(String) })
    )
    // The incident recorder must no longer share the AI/LLM log area.
    for (const call of warn.mock.calls) {
      expect(call[0]).not.toBe('ai')
    }
  })

  it('persists the trigger session identity and does not relabel a pending clip after a session switch', () => {
    const saved: IncidentClip[] = []
    const store = clipRepository({
      save: vi.fn((clip: IncidentClip) => {
        saved.push(clip)
        return { clip, contentHash: 'test' } as unknown as VerifiedIncidentClip
      })
    })
    const ctx = makeCtx()
    register(ctx, { clipStore: store })
    const snapshotHandler = vi.mocked(ctx.telemetryHub.on).mock.calls.find(
      ([event]) => event === 'snapshot'
    )?.[1] as ((snapshot: TelemetrySnapshot | null) => void)
    const snapshot = (partial: Partial<TelemetrySnapshot>): TelemetrySnapshot => ({
      sim: 'iracing',
      connected: true,
      timestamp: 0,
      speedKmh: 200,
      rpm: 7_000,
      gear: 4,
      throttle: 1,
      brake: 0,
      clutch: 0,
      sessionUniqueId: 111,
      sessionNumber: 0,
      sessionType: 'Race',
      trackName: 'Spa',
      ...partial
    })

    snapshotHandler(snapshot({ timestamp: 0, speedKmh: 200 }))
    snapshotHandler(snapshot({ timestamp: 33, speedKmh: 160 }))
    snapshotHandler(snapshot({
      timestamp: 40,
      sessionUniqueId: 222,
      trackName: 'Monza',
      speedKmh: 160
    }))

    const persisted = saved.at(-1) as IncidentClip
    expect(persisted.captureSession).toMatchObject({
      schemaVersion: 1,
      captureSessionId: 'capture-iracing:unique:111',
      sim: 'iracing',
      sessionUniqueId: 111,
      trackName: 'Spa'
    })
  })
})
