import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../../shared/settings'
import type { ModuleContext } from '../module-context'
import { register } from '../modules/app-shell-ui'

const streamSourceSettings = vi.hoisted(() => ({
  update: vi.fn()
}))

vi.mock('electron', () => ({
  shell: { openPath: vi.fn() }
}))

vi.mock('../modules/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn() }
}))

vi.mock('../modules/stream-sources', () => ({
  updateAppSettingsWithStreamTargets: streamSourceSettings.update
}))

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(process.cwd(), 'settings-app-shell-test-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

beforeEach(() => {
  streamSourceSettings.update.mockReset()
  streamSourceSettings.update.mockImplementation(async (patch: Partial<AppSettings>) => ({
    ...structuredClone(DEFAULT_APP_SETTINGS),
    ...structuredClone(patch)
  }))
})

function createContext(userData: string): {
  ctx: ModuleContext
  handlers: Map<string, (event: unknown, settings: Partial<AppSettings>) => unknown>
  setSource: ReturnType<typeof vi.fn>
} {
  const handlers = new Map<string, (event: unknown, settings: Partial<AppSettings>) => unknown>()
  const setSource = vi.fn().mockResolvedValue({ source: 'off', active: 'none', connected: false, rateHz: 30 })
  const ctx = {
    app: {
      getPath: vi.fn(() => userData),
      setLoginItemSettings: vi.fn(),
      once: vi.fn()
    },
    ipcMain: {
      handle: vi.fn((channel: string, handler: (event: unknown, settings: Partial<AppSettings>) => unknown) => {
        handlers.set(channel, handler)
      })
    },
    telemetryHub: { setSource },
    getMainWindow: vi.fn(() => null),
    broadcast: vi.fn()
  } as unknown as ModuleContext
  return { ctx, handlers, setSource }
}

describe('app settings IPC', () => {
  it('applies the persisted telemetry source at startup', () => {
    const dir = tempDir()
    const initial = createContext(dir)
    register(initial.ctx).setSettings({ defaultTelemetrySource: 'iracing' })

    const restarted = createContext(dir)
    register(restarted.ctx)

    expect(restarted.setSource).toHaveBeenCalledWith('iracing')
  })

  it('applies a saved telemetry source immediately', async () => {
    const { ctx, handlers, setSource } = createContext(tempDir())
    register(ctx)

    const handler = handlers.get('app:setSettings')
    expect(handler).toBeDefined()
    const saved = await handler?.({}, { defaultTelemetrySource: 'iracing' })

    expect((saved as AppSettings).defaultTelemetrySource).toBe('iracing')
    expect(setSource).toHaveBeenLastCalledWith('iracing')
  })

  it('does not restart telemetry when only stream target profiles change', async () => {
    const { ctx, handlers, setSource } = createContext(tempDir())
    register(ctx)
    setSource.mockClear()

    const handler = handlers.get('app:setSettings')
    await handler?.({}, {
      streamTargets: {
        schemaVersion: 1,
        profiles: [{ id: 'profile-one', kind: 'dashboard', sourceId: 'dash-one', label: 'OBS' }],
        selectedProfileId: 'profile-one'
      }
    })

    expect(streamSourceSettings.update).toHaveBeenCalledWith({
      streamTargets: {
        schemaVersion: 1,
        profiles: [{ id: 'profile-one', kind: 'dashboard', sourceId: 'dash-one', label: 'OBS' }],
        selectedProfileId: 'profile-one'
      }
    })
    expect(setSource).not.toHaveBeenCalled()
  })

  it('rejects an explicit undefined streamTargets patch instead of erasing memberships', async () => {
    const { ctx, handlers } = createContext(tempDir())
    const store = register(ctx)
    const initial = {
      schemaVersion: 1 as const,
      profiles: [{
        id: 'profile-one',
        kind: 'dashboard' as const,
        sourceId: 'dash-one',
        label: 'OBS'
      }],
      selectedProfileId: 'profile-one'
    }
    store.setSettings({ streamTargets: initial })

    const handler = handlers.get('app:setSettings')
    await expect(handler?.({}, { streamTargets: undefined as never })).rejects.toThrow(
      'validated streaming source request'
    )
    expect(store.getSettings().streamTargets).toEqual(initial)
    expect(streamSourceSettings.update).not.toHaveBeenCalled()
  })
})
