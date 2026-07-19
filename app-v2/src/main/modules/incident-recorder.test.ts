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

import { incidentClipId, register } from './incident-recorder'

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

  it('uses session-scoped ids when identical incident timestamps recur after a session switch', () => {
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
      timestamp: 0,
      sessionUniqueId: 222,
      trackName: 'Monza',
      speedKmh: 200
    }))
    snapshotHandler(snapshot({ timestamp: 33, sessionUniqueId: 222, trackName: 'Monza', speedKmh: 160 }))
    snapshotHandler(snapshot({ timestamp: 4_000, sessionUniqueId: 222, trackName: 'Monza', speedKmh: 160 }))

    expect(saved).toHaveLength(2)
    expect(saved.map((clip) => ({ at: clip.at, type: clip.type }))).toEqual([
      { at: 33, type: 'contact' },
      { at: 33, type: 'contact' }
    ])
    expect(saved[0].id).not.toBe(saved[1].id)
    expect(saved[0].id).toBe(incidentClipId(saved[0].captureSession!, saved[0]))
    expect(saved[1].id).toBe(incidentClipId(saved[1].captureSession!, saved[1]))
    expect(saved[0].captureSession).toMatchObject({
      schemaVersion: 1,
      captureSessionId: 'capture-iracing:unique:111',
      sim: 'iracing',
      sessionUniqueId: 111,
      trackName: 'Spa'
    })
  })

  it('keeps duplicate id generation stable within one capture session', () => {
    const captureSession = {
      schemaVersion: 1 as const,
      captureSessionId: 'capture-acc-session-1',
      sim: 'acc' as const,
      startedAt: 100,
      lifecycleGeneration: 1
    }
    const event = { at: 33, type: 'contact' as const }

    expect(incidentClipId(captureSession, event)).toBe(incidentClipId(captureSession, event))
    expect(incidentClipId(captureSession, event)).toMatch(/^inc-[a-f0-9]{24}-33-contact$/)
  })

  it('keeps clip persistence failures observable', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const store = clipRepository({
      save: vi.fn(() => {
        throw new Error('seeded clip collision')
      })
    })
    const ctx = makeCtx()
    register(ctx, { clipStore: store })
    const snapshotHandler = vi.mocked(ctx.telemetryHub.on).mock.calls.find(
      ([event]) => event === 'snapshot'
    )?.[1] as ((snapshot: TelemetrySnapshot | null) => void)
    const snapshot = (timestamp: number, speedKmh: number): TelemetrySnapshot => ({
      sim: 'acc',
      connected: true,
      timestamp,
      speedKmh,
      rpm: 7_000,
      gear: 4,
      throttle: 1,
      brake: 0,
      clutch: 0,
      sessionType: 'Race',
      trackName: 'Spa'
    })

    snapshotHandler(snapshot(0, 200))
    snapshotHandler(snapshot(33, 160))
    snapshotHandler(snapshot(4_000, 160))

    expect(warn).toHaveBeenCalledWith(
      'incidents',
      'failed to save incident clip',
      { message: 'seeded clip collision' }
    )
  })
})
