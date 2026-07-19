import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import { readdirSync, writeFileSync } from 'node:fs'
import type { ModuleContext } from '../module-context'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import { logger } from './logger'

// Drive ClipStore.load() down its error branch (dir exists but readdir throws) so the
// module emits a logger.warn from inside register() — the cheapest deterministic way to
// observe the log AREA used by the incident recorder.
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => ''),
  readdirSync: vi.fn(() => {
    throw new Error('boom')
  }),
  rmSync: vi.fn(),
  writeFileSync: vi.fn()
}))

// Keep the optional LLM machinery inert.
vi.mock('../ai/llm-runtime', () => ({ getLlmRuntime: () => ({}) }))
vi.mock('../ai/model-manager', () => ({ getModelManager: () => ({ getActiveModelPath: () => null }) }))

import { register } from './incident-recorder'

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

    register(makeCtx())

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
    vi.mocked(readdirSync).mockReturnValue([])
    const ctx = makeCtx()
    register(ctx)
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

    const persisted = JSON.parse(vi.mocked(writeFileSync).mock.calls.at(-1)?.[1] as string)
    expect(persisted.captureSession).toMatchObject({
      schemaVersion: 1,
      captureSessionId: 'capture-iracing:unique:111',
      sim: 'iracing',
      sessionUniqueId: 111,
      trackName: 'Spa'
    })
  })
})
