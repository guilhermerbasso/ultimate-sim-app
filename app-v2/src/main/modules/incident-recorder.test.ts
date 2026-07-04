import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import type { ModuleContext } from '../module-context'
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
})
