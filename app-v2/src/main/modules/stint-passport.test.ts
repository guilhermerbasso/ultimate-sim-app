import { describe, expect, it } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { ModuleContext } from '../module-context'
import { authorizePassportSender } from './stint-passport'

function context(senderId = 7): ModuleContext {
  return {
    getMainWindow: () => ({
      isDestroyed: () => false,
      webContents: { id: senderId }
    })
  } as unknown as ModuleContext
}

function event(senderId: number): IpcMainInvokeEvent {
  return {
    sender: { id: senderId }
  } as unknown as IpcMainInvokeEvent
}

describe('Stint Passport IPC sender authentication', () => {
  it('accepts only the current main-window sender', () => {
    expect(() => authorizePassportSender(context(7), event(7))).not.toThrow()
    expect(() => authorizePassportSender(context(7), event(8))).toThrow(/not authorized/i)
  })

  it('fails closed when there is no live main window', () => {
    const ctx = { getMainWindow: () => null } as unknown as ModuleContext
    expect(() => authorizePassportSender(ctx, event(7))).toThrow(/not authorized/i)
  })
})

import { beforeEach, vi } from 'vitest'
import { STINT_PASSPORT_CHANNELS } from '../../shared/stint-passport'
import { register } from './stint-passport'

const moduleHarness = vi.hoisted(() => {
  const service = {
    assertCapability: vi.fn(),
    snapshot: vi.fn(),
    setRoster: vi.fn(),
    repairPersistence: vi.fn(),
    recordExperiment: vi.fn(),
    setConfig: vi.fn(),
    setPrivacy: vi.fn(),
    resolveItem: vi.fn(),
    prepareChallenge: vi.fn(),
    completeChallenge: vi.fn(),
    closeCurrent: vi.fn(),
    setKillSwitch: vi.fn(),
    deleteByClass: vi.fn(),
    runFullAudit: vi.fn(),
    exportPackage: vi.fn(),
    importPackage: vi.fn(),
    dispose: vi.fn()
  }
  return {
    service,
    writeFile: vi.fn(),
    rename: vi.fn(),
    rm: vi.fn(),
    readFile: vi.fn(),
    stat: vi.fn(),
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn()
  }
})

vi.mock('node:fs/promises', () => ({
  writeFile: moduleHarness.writeFile,
  rename: moduleHarness.rename,
  rm: moduleHarness.rm,
  readFile: moduleHarness.readFile,
  stat: moduleHarness.stat
}))
vi.mock('electron', () => ({
  dialog: {
    showSaveDialog: moduleHarness.showSaveDialog,
    showOpenDialog: moduleHarness.showOpenDialog
  }
}))
vi.mock('../passport/service', () => ({
  StintPassportService: class {
    constructor() {
      return moduleHarness.service
    }
  }
}))
vi.mock('../passport/persistence-client', () => ({
  PassportPersistenceClient: class {}
}))

type RegisteredHandler = (event: IpcMainInvokeEvent, input?: unknown) => unknown

function registeredContext(senderId = 7): {
  ctx: ModuleContext
  handlers: Map<string, RegisteredHandler>
  registerGracefulTeardown: ReturnType<typeof vi.fn>
} {
  const handlers = new Map<string, RegisteredHandler>()
  const registerGracefulTeardown = vi.fn()
  const ctx = {
    app: { getPath: () => 'C:\\passport-test' },
    getMainWindow: () => ({
      isDestroyed: () => false,
      webContents: { id: senderId }
    }),
    ipcMain: {
      handle: (channel: string, handler: RegisteredHandler) => handlers.set(channel, handler)
    },
    registerGracefulTeardown
  } as unknown as ModuleContext
  return { ctx, handlers, registerGracefulTeardown }
}

function installRegisteredHandlers(): ReturnType<typeof registeredContext> {
  const harness = registeredContext()
  register(harness.ctx)
  return harness
}

function invokeRegistered(
  handlers: Map<string, RegisteredHandler>,
  channel: string,
  input?: unknown,
  senderId = 7
): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) return Promise.reject(new Error(`Missing registered handler: ${channel}`))
  return Promise.resolve().then(() => handler(event(senderId), input))
}

beforeEach(() => {
  for (const candidate of [
    ...Object.values(moduleHarness.service),
    moduleHarness.writeFile,
    moduleHarness.rename,
    moduleHarness.rm,
    moduleHarness.readFile,
    moduleHarness.stat,
    moduleHarness.showSaveDialog,
    moduleHarness.showOpenDialog
  ]) {
    candidate.mockReset()
  }
  moduleHarness.service.assertCapability.mockImplementation((capability: string) => {
    if (capability !== 'current-capability') throw new Error('Passport mutation capability is invalid.')
  })
  moduleHarness.service.exportPackage.mockResolvedValue({
    contractVersion: 1,
    passports: [],
    events: [],
    tombstones: [],
    packageHash: 'sha256-package'
  })
  moduleHarness.showSaveDialog.mockResolvedValue({ canceled: true })
  moduleHarness.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
  moduleHarness.rm.mockResolvedValue(undefined)
})

describe('registered Passport handlers', () => {
  it('fails closed for destroyed and replaced main windows', () => {
    const destroyed = {
      getMainWindow: () => ({
        isDestroyed: () => true,
        webContents: { id: 7 }
      })
    } as unknown as ModuleContext
    expect(() => authorizePassportSender(destroyed, event(7))).toThrow(/not authorized/i)

    const replaced = context(19)
    expect(() => authorizePassportSender(replaced, event(7))).toThrow(/not authorized/i)
  })

  it('requires the current capability on every mutation handler', async () => {
    const { handlers } = installRegisteredHandlers()
    const mutationChannels = Object.values(STINT_PASSPORT_CHANNELS).filter(
      (channel) => channel !== STINT_PASSPORT_CHANNELS.getSnapshot &&
        channel !== STINT_PASSPORT_CHANNELS.updated
    )

    for (const channel of mutationChannels) {
      await expect(
        invokeRegistered(handlers, channel, {
          capability: 'stale-capability',
          payload: null
        }),
        channel
      ).rejects.toThrow(/capability/i)
    }
    expect(moduleHarness.service.assertCapability).toHaveBeenCalledTimes(mutationChannels.length)
    expect(moduleHarness.showSaveDialog).not.toHaveBeenCalled()
  })

  it('rejects malformed envelopes without invoking a mutation', async () => {
    const { handlers } = installRegisteredHandlers()

    await expect(
      invokeRegistered(handlers, STINT_PASSPORT_CHANNELS.setConfig, null)
    ).rejects.toThrow(/capability/i)
    await expect(
      invokeRegistered(handlers, STINT_PASSPORT_CHANNELS.setConfig, {
        payload: { updatedAt: 1 }
      })
    ).rejects.toThrow(/capability/i)

    expect(moduleHarness.service.setConfig).not.toHaveBeenCalled()
  })

  it('[spec-gap] rejects inherited capability properties', async () => {
    const { handlers } = installRegisteredHandlers()
    const input = Object.assign(Object.create({ capability: 'current-capability' }), {
      payload: { updatedAt: 1 }
    })

    await expect(
      invokeRegistered(handlers, STINT_PASSPORT_CHANNELS.setConfig, input)
    ).rejects.toThrow(/capability|envelope/i)
    expect(moduleHarness.service.setConfig).not.toHaveBeenCalled()
  })

  it('does not register Unicode-confusable mutation channels', () => {
    const { handlers } = installRegisteredHandlers()
    const confusable = STINT_PASSPORT_CHANNELS.setConfig.replace('o', '\u043e')

    expect(confusable).not.toBe(STINT_PASSPORT_CHANNELS.setConfig)
    expect(handlers.has(confusable)).toBe(false)
    expect(handlers.has(`${STINT_PASSPORT_CHANNELS.setConfig}\0`)).toBe(false)
  })

  it('rejects unknown export profiles and data classes before service invocation', async () => {
    const { handlers } = installRegisteredHandlers()
    const envelope = (payload: unknown) => ({ capability: 'current-capability', payload })

    await expect(
      invokeRegistered(handlers, STINT_PASSPORT_CHANNELS.saveExport, envelope('administrator'))
    ).rejects.toThrow(/unknown.*profile/i)
    await expect(
      invokeRegistered(handlers, STINT_PASSPORT_CHANNELS.deleteByClass, envelope('D4'))
    ).rejects.toThrow(/unknown.*class/i)

    expect(moduleHarness.service.exportPackage).not.toHaveBeenCalled()
    expect(moduleHarness.service.deleteByClass).not.toHaveBeenCalled()
    expect(moduleHarness.showSaveDialog).not.toHaveBeenCalled()
  })

  it('returns an explicit cancellation without writing or exposing hash data', async () => {
    const { handlers } = installRegisteredHandlers()

    await expect(
      invokeRegistered(handlers, STINT_PASSPORT_CHANNELS.saveExport, {
        capability: 'current-capability',
        payload: 'pseudonymized'
      })
    ).resolves.toEqual({ ok: false, canceled: true })
    expect(moduleHarness.writeFile).not.toHaveBeenCalled()
  })

  it.each([
    ['save dialog', () => moduleHarness.showSaveDialog.mockRejectedValue(new Error('dialog unavailable'))],
    ['file write', () => {
      moduleHarness.showSaveDialog.mockResolvedValue({
        canceled: false,
        filePath: 'C:\\exports\\passport.json'
      })
      moduleHarness.writeFile.mockRejectedValue(new Error('disk full'))
    }]
  ])('rejects a %s failure without reporting success', async (_boundary, arrange) => {
    arrange()
    const { handlers } = installRegisteredHandlers()

    await expect(
      invokeRegistered(handlers, STINT_PASSPORT_CHANNELS.saveExport, {
        capability: 'current-capability',
        payload: 'race-only'
      })
    ).rejects.toThrow()
    expect(moduleHarness.rename).not.toHaveBeenCalled()
  })

  it('[spec-gap] commits exports atomically instead of writing the destination directly', async () => {
    moduleHarness.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: 'C:\\exports\\passport.json'
    })
    moduleHarness.writeFile.mockResolvedValue(undefined)
    moduleHarness.rename.mockResolvedValue(undefined)
    const { handlers } = installRegisteredHandlers()

    await invokeRegistered(handlers, STINT_PASSPORT_CHANNELS.saveExport, {
      capability: 'current-capability',
      payload: 'full-local'
    })

    expect(moduleHarness.writeFile).not.toHaveBeenCalledWith(
      'C:\\exports\\passport.json',
      expect.anything(),
      'utf8'
    )
    expect(moduleHarness.rename).toHaveBeenCalledWith(
      expect.stringMatching(/\.tmp$/),
      'C:\\exports\\passport.json'
    )
  })

  it('[spec-gap] rejects unbounded export collections before opening a dialog or stringifying', async () => {
    moduleHarness.service.exportPackage.mockResolvedValue({
      contractVersion: 1,
      passports: [],
      events: Array.from({ length: 10_001 }, (_, index) => ({ index })),
      tombstones: [],
      packageHash: 'oversized'
    })
    moduleHarness.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: 'C:\\exports\\oversized.json'
    })
    const { handlers } = installRegisteredHandlers()

    await expect(
      invokeRegistered(handlers, STINT_PASSPORT_CHANNELS.saveExport, {
        capability: 'current-capability',
        payload: 'full-local'
      })
    ).rejects.toThrow(/bound|limit|large|size/i)
    expect(moduleHarness.showSaveDialog).not.toHaveBeenCalled()
    expect(moduleHarness.writeFile).not.toHaveBeenCalled()
  })

  it('[spec-gap] registers Passport disposal in the persistence teardown phase', () => {
    const { registerGracefulTeardown } = installRegisteredHandlers()

    expect(registerGracefulTeardown).toHaveBeenCalledWith(expect.any(Function), 'persistence')
    expect(registerGracefulTeardown).not.toHaveBeenCalledWith(expect.any(Function), 'quiesce')
  })

  it('[spec-gap] exposes a registered authenticated import/replay boundary', () => {
    const { handlers } = installRegisteredHandlers()
    const importChannel = 'stintPassport:importPackage'

    expect(handlers.has(importChannel)).toBe(true)
    expect(MAIN_PASSPORT_CHANNELS_FOR_IMPORT(handlers)).toContain(importChannel)
  })

  it('imports exactly one bounded JSON file through the authenticated service boundary', async () => {
    const bundle = { contractVersion: 1, packageHash: 'signed-package' }
    moduleHarness.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['C:\\imports\\passport.json']
    })
    moduleHarness.stat.mockResolvedValue({ isFile: () => true, size: 128 })
    moduleHarness.readFile.mockResolvedValue(JSON.stringify(bundle))
    moduleHarness.service.importPackage.mockResolvedValue({
      ok: true,
      canceled: false,
      importedPassports: 1,
      packageHash: 'signed-package'
    })
    const { handlers } = installRegisteredHandlers()

    await expect(invokeRegistered(handlers, STINT_PASSPORT_CHANNELS.importPackage, {
      capability: 'current-capability',
      payload: null
    })).resolves.toMatchObject({ ok: true, importedPassports: 1 })
    expect(moduleHarness.service.importPackage).toHaveBeenCalledWith(bundle)
  })

  it('rejects oversized or malformed import files before service verification', async () => {
    moduleHarness.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['C:\\imports\\passport.json']
    })
    const { handlers } = installRegisteredHandlers()
    const input = { capability: 'current-capability', payload: null }

    moduleHarness.stat.mockResolvedValue({ isFile: () => true, size: 5_000_001 })
    await expect(
      invokeRegistered(handlers, STINT_PASSPORT_CHANNELS.importPackage, input)
    ).rejects.toThrow(/5 MB|bound/i)
    expect(moduleHarness.readFile).not.toHaveBeenCalled()

    moduleHarness.stat.mockResolvedValue({ isFile: () => true, size: 16 })
    moduleHarness.readFile.mockResolvedValue('{not-json')
    await expect(
      invokeRegistered(handlers, STINT_PASSPORT_CHANNELS.importPackage, input)
    ).rejects.toThrow()
    expect(moduleHarness.service.importPackage).not.toHaveBeenCalled()
  })
})

function MAIN_PASSPORT_CHANNELS_FOR_IMPORT(
  handlers: Map<string, RegisteredHandler>
): string[] {
  return [...handlers.keys()].filter((channel) => /import|replay/i.test(channel))
}

describe('registered Passport sender boundary', () => {
  it('rejects a replaced-window sender on every registered invoke handler', async () => {
    const { handlers } = installRegisteredHandlers()

    for (const [channel, handler] of handlers) {
      const input = channel === STINT_PASSPORT_CHANNELS.getSnapshot
        ? undefined
        : { capability: 'current-capability', payload: null }
      await expect(
        Promise.resolve().then(() => handler(event(999), input)),
        channel
      ).rejects.toThrow(/not authorized/i)
    }

    expect(moduleHarness.service.assertCapability).not.toHaveBeenCalled()
    expect(moduleHarness.service.snapshot).not.toHaveBeenCalled()
    expect(moduleHarness.showSaveDialog).not.toHaveBeenCalled()
  })
})
