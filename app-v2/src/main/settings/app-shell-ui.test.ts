import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '../../shared/settings'
import type { ModuleContext } from '../module-context'
import { register } from '../modules/app-shell-ui'

vi.mock('electron', () => ({
  shell: { openPath: vi.fn() }
}))

vi.mock('../modules/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn() }
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
})
