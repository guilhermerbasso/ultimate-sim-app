import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UPDATE_CHANNELS, type UpdaterIpcResult } from '../../shared/updater'
import type { ModuleContext } from '../module-context'

type Handler = (...args: unknown[]) => unknown

const updater = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>()
  const autoUpdater = {
    logger: undefined as unknown,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    disableWebInstaller: false,
    setFeedURL: vi.fn(),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener)
      return autoUpdater
    }),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn()
  }
  return { autoUpdater, listeners }
})

vi.mock('electron-updater', () => ({
  default: { autoUpdater: updater.autoUpdater }
}))

import { register } from './updater'

function fakeContext(): {
  ctx: ModuleContext
  handlers: Map<string, Handler>
  quit: ReturnType<typeof vi.fn>
} {
  const handlers = new Map<string, Handler>()
  const beforeQuitListeners: Array<() => void> = []
  const quit = vi.fn()
  const ctx = {
    app: {
      isPackaged: true,
      getVersion: () => '2.51.1',
      quit,
      once: (event: string, listener: () => void) => {
        if (event === 'before-quit') beforeQuitListeners.push(listener)
      }
    },
    ipcMain: {
      handle: (channel: string, handler: Handler) => handlers.set(channel, handler)
    },
    telemetryHub: {},
    serialManager: {},
    serialHub: {},
    profileStore: {},
    iracingControl: {},
    getMainWindow: () => null,
    broadcast: vi.fn(),
    registerGracefulTeardown: vi.fn()
  } as unknown as ModuleContext
  return { ctx, handlers, quit }
}

async function installNow(handlers: Map<string, Handler>): Promise<UpdaterIpcResult> {
  const handler = handlers.get(UPDATE_CHANNELS.installNow)
  if (!handler) throw new Error('install handler not registered')
  return await handler() as UpdaterIpcResult
}

beforeEach(() => {
  vi.useFakeTimers()
  updater.listeners.clear()
  updater.autoUpdater.setFeedURL.mockClear()
  updater.autoUpdater.on.mockClear()
  updater.autoUpdater.checkForUpdates.mockReset()
  updater.autoUpdater.downloadUpdate.mockReset()
  updater.autoUpdater.quitAndInstall.mockReset()
  updater.autoUpdater.autoDownload = true
  updater.autoUpdater.autoInstallOnAppQuit = true
  updater.autoUpdater.disableWebInstaller = false
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('updater install ordering', () => {
  it('keeps installation on the final quit event instead of spawning NSIS early', () => {
    const { ctx } = fakeContext()
    register(ctx)

    expect(updater.autoUpdater.autoInstallOnAppQuit).toBe(true)
  })

  it('requests the normal graceful quit and never calls quitAndInstall directly', async () => {
    const { ctx, handlers, quit } = fakeContext()
    register(ctx)
    updater.listeners.get('update-downloaded')?.({ version: '2.51.1' })

    const result = await installNow(handlers)

    expect(result.ok).toBe(true)
    expect(quit).toHaveBeenCalledOnce()
    expect(updater.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('latches concurrent install requests to one graceful quit', async () => {
    const { ctx, handlers, quit } = fakeContext()
    register(ctx)
    updater.listeners.get('update-downloaded')?.({ version: '2.51.1' })

    const results = await Promise.all([
      installNow(handlers),
      installNow(handlers),
      installNow(handlers)
    ])

    expect(results.every((result) => result.ok)).toBe(true)
    expect(quit).toHaveBeenCalledOnce()
    expect(updater.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('does not quit when no update has been downloaded', async () => {
    const { ctx, handlers, quit } = fakeContext()
    register(ctx)

    const result = await installNow(handlers)

    expect(result.ok).toBe(false)
    expect(quit).not.toHaveBeenCalled()
    expect(updater.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })
})
