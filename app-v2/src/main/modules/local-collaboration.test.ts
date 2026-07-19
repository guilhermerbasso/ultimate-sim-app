import { mkdtempSync, rmSync } from 'node:fs'
import { open as openFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn()
}))

vi.mock('electron', () => ({
  dialog: electronMocks
}))

import { COLLABORATION_CHANNELS, type CollaborationWorkspaceState } from '../../shared/local-collaboration'
import {
  createCollaborationSigningIdentity,
  LocalCollaborationReplica
} from '../collaboration/replica'
import { LocalCollaborationService } from '../collaboration/service'
import type { ModuleContext } from '../module-context'
import { register } from './local-collaboration'

type Handler = (...args: unknown[]) => unknown

const MAX_BUNDLE_BYTES = 8 * 1024 * 1024
const cleanup: string[] = []

beforeEach(() => {
  electronMocks.showOpenDialog.mockReset()
  electronMocks.showSaveDialog.mockReset()
})

afterEach(() => {
  for (const directory of cleanup.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})

function moduleContext(handlers: Map<string, Handler>, userData: string): ModuleContext {
  return {
    app: { getPath: () => userData },
    ipcMain: {
      handle: (channel: string, handler: Handler) => handlers.set(channel, handler)
    },
    broadcast: vi.fn(),
    getMainWindow: () => null,
    registerGracefulTeardown: () => () => {}
  } as unknown as ModuleContext
}

function handler(handlers: Map<string, Handler>, channel: string): Handler {
  const value = handlers.get(channel)
  if (!value) throw new Error(`Missing handler for ${channel}`)
  return value
}

function exactMaximumBundle(): { bundle: string; documentId: string } {
  const identity = createCollaborationSigningIdentity({
    id: 'actor-exact-boundary',
    displayName: 'Exact Boundary',
    deviceId: 'device-exact-boundary'
  })
  const replica = new LocalCollaborationReplica(identity.actor, {
    privateKey: identity.privateKey,
    now: () => 1,
    documentId: () => 'exact-boundary-document'
  })
  const document = replica.createDocument({
    kind: 'accessibility-profile',
    title: 'Exact boundary profile',
    createdAt: 1
  })
  const padding = 'x'.repeat(240_000)
  let createdAt = 2
  let bundle = replica.exportBundle()
  while (MAX_BUNDLE_BYTES - Buffer.byteLength(bundle, 'utf8') > 260_000) {
    replica.applyLocalChange(document.id, {
      type: 'set',
      path: '/preferences/padding',
      value: padding
    }, undefined, createdAt)
    createdAt += 1
    bundle = replica.exportBundle()
  }

  const snapshot = replica.captureState()
  replica.applyLocalChange(document.id, {
    type: 'set',
    path: '/preferences/padding',
    value: 'y'
  }, undefined, createdAt)
  const oneByteBundle = replica.exportBundle()
  const finalValueLength = MAX_BUNDLE_BYTES - Buffer.byteLength(oneByteBundle, 'utf8') + 1
  if (finalValueLength <= 0 || finalValueLength > 262_142) {
    throw new Error(`Unable to tune exact collaboration bundle length: ${finalValueLength}`)
  }

  replica.restoreState(snapshot)
  replica.applyLocalChange(document.id, {
    type: 'set',
    path: '/preferences/padding',
    value: 'y'.repeat(finalValueLength)
  }, undefined, createdAt)
  bundle = replica.exportBundle()
  if (Buffer.byteLength(bundle, 'utf8') !== MAX_BUNDLE_BYTES) {
    throw new Error('Failed to produce an exact 8 MiB collaboration bundle.')
  }
  return { bundle, documentId: document.id }
}

describe('local collaboration module initialization', () => {
  it('contains service initialization rejection and keeps IPC plus teardown alive', async () => {
    const handlers = new Map<string, Handler>()
    let teardown: (() => Promise<void> | void) | undefined
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    register({
      app: { getPath: () => 'C:\\collaboration-test' },
      ipcMain: {
        handle: (channel: string, handler: Handler) => handlers.set(channel, handler)
      },
      broadcast: vi.fn(),
      getMainWindow: () => null,
      registerGracefulTeardown: (task: () => Promise<void> | void) => {
        teardown = task
        return () => {}
      }
    } as unknown as ModuleContext, {
      openService: async () => {
        throw new Error('simulated initialization rejection')
      }
    })

    const state = await handlers.get(COLLABORATION_CHANNELS.state)?.() as CollaborationWorkspaceState
    expect(state.documents).toEqual([])
    expect(state.status.online).toBe(false)
    expect(state.status.lastError).toMatch(/simulated initialization rejection/)
    await expect(handlers.get(COLLABORATION_CHANNELS.create)?.(null, {
      kind: 'race-notes',
      title: 'Unavailable'
    })).rejects.toThrow(/collaboration is unavailable/i)
    await expect(teardown?.()).resolves.toBeUndefined()
    expect(exit).not.toHaveBeenCalled()
    exit.mockRestore()
  })
})

describe('local collaboration file boundaries', () => {
  it('writes smaller canonical exports deterministically without trailing whitespace', async () => {
    const directory = mkdtempSync(join(process.cwd(), 'collaboration-module-test-'))
    cleanup.push(directory)
    const service = await LocalCollaborationService.open(join(directory, 'workspace.json'))
    await service.create({ kind: 'race-notes', title: 'Deterministic export' })
    const handlers = new Map<string, Handler>()
    register(moduleContext(handlers, directory), { openService: async () => service })
    const firstPath = join(directory, 'first.simcollab')
    const secondPath = join(directory, 'second.simcollab')
    electronMocks.showSaveDialog
      .mockResolvedValueOnce({ canceled: false, filePath: firstPath })
      .mockResolvedValueOnce({ canceled: false, filePath: secondPath })

    await handler(handlers, COLLABORATION_CHANNELS.exportFile)()
    await handler(handlers, COLLABORATION_CHANNELS.exportFile)()

    const expected = await service.exportBundle()
    const first = await readFile(firstPath)
    const second = await readFile(secondPath)
    expect(first.byteLength).toBeLessThan(MAX_BUNDLE_BYTES)
    expect(first.toString('utf8')).toBe(expected)
    expect(second).toEqual(first)
    expect(first.at(-1)).not.toBe(0x0a)
  })

  it('round-trips an exact 8 MiB canonical file, flushes, and rejects 8 MiB plus one', async () => {
    const directory = mkdtempSync(join(process.cwd(), 'collaboration-module-test-'))
    cleanup.push(directory)
    const { bundle, documentId } = exactMaximumBundle()
    const source = await LocalCollaborationService.open(join(directory, 'source-workspace.json'))
    await source.setOnline(false)
    await source.importBundle(bundle)
    const sourceDocument = await source.getDocument(documentId)
    const sourceState = await source.getWorkspaceState()

    const exportHandlers = new Map<string, Handler>()
    register(moduleContext(exportHandlers, directory), { openService: async () => source })
    const exportPath = join(directory, 'exact.simcollab')
    electronMocks.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: exportPath })
    await handler(exportHandlers, COLLABORATION_CHANNELS.exportFile)()

    const exported = await readFile(exportPath)
    expect(exported.byteLength).toBe(MAX_BUNDLE_BYTES)
    expect(exported.toString('utf8')).toBe(bundle)

    const target = await LocalCollaborationService.open(join(directory, 'target-workspace.json'))
    await target.setOnline(false)
    const importHandlers = new Map<string, Handler>()
    register(moduleContext(importHandlers, directory), { openService: async () => target })
    electronMocks.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [exportPath]
    })
    await handler(importHandlers, COLLABORATION_CHANNELS.importFile)()

    expect(await target.exportBundle()).toBe(bundle)
    expect(await target.getDocument(documentId)).toEqual(sourceDocument)
    expect((await target.getWorkspaceState()).documents).toEqual(sourceState.documents)
    await expect(target.flush()).resolves.toBeUndefined()

    const oversizedPath = join(directory, 'oversized.simcollab')
    await writeFile(oversizedPath, Buffer.concat([exported, Buffer.from('\n')]))
    const beforeRejectedImport = await target.exportBundle()
    electronMocks.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [oversizedPath]
    })
    await expect(
      handler(importHandlers, COLLABORATION_CHANNELS.importFile)()
    ).rejects.toThrow(`Collaboration import exceeds ${MAX_BUNDLE_BYTES} bytes.`)
    expect(await target.exportBundle()).toBe(beforeRejectedImport)
  }, 60_000)

  it('rejects a very large sparse file after reading only the bounded prefix', async () => {
    const directory = mkdtempSync(join(process.cwd(), 'collaboration-module-test-'))
    cleanup.push(directory)
    const sparsePath = join(directory, 'sparse.simcollab')
    const sparse = await openFile(sparsePath, 'w')
    try {
      await sparse.truncate(MAX_BUNDLE_BYTES * 128)
    } finally {
      await sparse.close()
    }

    let largestBuffer = 0
    let totalBytesRead = 0
    let closeHandle: ReturnType<typeof vi.fn> | undefined
    const openImportFile = vi.fn(async (filePath: string) => {
      const file = await openFile(filePath, 'r')
      const close = vi.fn(async () => file.close())
      closeHandle = close
      return {
        read: async (buffer: Buffer, offset: number, length: number, position: number) => {
          largestBuffer = Math.max(largestBuffer, buffer.byteLength)
          const { bytesRead } = await file.read(buffer, offset, length, position)
          totalBytesRead += bytesRead
          return { bytesRead }
        },
        close
      }
    })
    const target = await LocalCollaborationService.open(join(directory, 'sparse-target.json'))
    const importBundle = vi.spyOn(target, 'importBundle')
    const handlers = new Map<string, Handler>()
    register(moduleContext(handlers, directory), {
      openService: async () => target,
      openImportFile
    })
    electronMocks.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [sparsePath]
    })

    await expect(
      handler(handlers, COLLABORATION_CHANNELS.importFile)()
    ).rejects.toThrow(`Collaboration import exceeds ${MAX_BUNDLE_BYTES} bytes.`)
    expect(openImportFile).toHaveBeenCalledTimes(1)
    expect(largestBuffer).toBe(MAX_BUNDLE_BYTES + 1)
    expect(totalBytesRead).toBe(MAX_BUNDLE_BYTES + 1)
    expect(closeHandle!).toHaveBeenCalledTimes(1)
    expect(importBundle).not.toHaveBeenCalled()
  })

  it('loops over partial reads and imports only the exact bytes returned', async () => {
    const directory = mkdtempSync(join(process.cwd(), 'collaboration-module-test-'))
    cleanup.push(directory)
    const source = await LocalCollaborationService.open(join(directory, 'partial-source.json'))
    await source.setOnline(false)
    await source.create({ kind: 'race-notes', title: 'Partial read import' })
    const bundle = await source.exportBundle()
    const sourceBytes = Buffer.from(bundle, 'utf8')
    const read = vi.fn(async (
      buffer: Buffer,
      offset: number,
      length: number,
      position: number
    ) => {
      const bytesRead = Math.min(31, length, sourceBytes.byteLength - position)
      if (bytesRead > 0) sourceBytes.copy(buffer, offset, position, position + bytesRead)
      return { bytesRead }
    })
    const close = vi.fn(async () => {})
    const openImportFile = vi.fn(async () => ({ read, close }))
    const target = await LocalCollaborationService.open(join(directory, 'partial-target.json'))
    await target.setOnline(false)
    const handlers = new Map<string, Handler>()
    register(moduleContext(handlers, directory), {
      openService: async () => target,
      openImportFile
    })
    electronMocks.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['partial.simcollab']
    })

    await handler(handlers, COLLABORATION_CHANNELS.importFile)()

    expect(openImportFile).toHaveBeenCalledTimes(1)
    expect(read.mock.calls.length).toBeGreaterThan(2)
    expect(close).toHaveBeenCalledTimes(1)
    expect(await target.exportBundle()).toBe(bundle)
  })

  it('closes the file handle when a bounded read fails', async () => {
    const directory = mkdtempSync(join(process.cwd(), 'collaboration-module-test-'))
    cleanup.push(directory)
    const readError = new Error('simulated bounded read failure')
    const read = vi.fn(async () => {
      throw readError
    })
    const close = vi.fn(async () => {})
    const openImportFile = vi.fn(async () => ({ read, close }))
    const target = await LocalCollaborationService.open(join(directory, 'read-error-target.json'))
    const importBundle = vi.spyOn(target, 'importBundle')
    const handlers = new Map<string, Handler>()
    register(moduleContext(handlers, directory), {
      openService: async () => target,
      openImportFile
    })
    electronMocks.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['read-error.simcollab']
    })

    await expect(
      handler(handlers, COLLABORATION_CHANNELS.importFile)()
    ).rejects.toBe(readError)
    expect(openImportFile).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(importBundle).not.toHaveBeenCalled()
  })

  it('surfaces file-handle close failures', async () => {
    const directory = mkdtempSync(join(process.cwd(), 'collaboration-module-test-'))
    cleanup.push(directory)
    const closeError = new Error('simulated import close failure')
    const read = vi.fn(async () => ({ bytesRead: 0 }))
    const close = vi.fn(async () => {
      throw closeError
    })
    const openImportFile = vi.fn(async () => ({ read, close }))
    const target = await LocalCollaborationService.open(join(directory, 'close-error-target.json'))
    const importBundle = vi.spyOn(target, 'importBundle')
    const handlers = new Map<string, Handler>()
    register(moduleContext(handlers, directory), {
      openService: async () => target,
      openImportFile
    })
    electronMocks.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['close-error.simcollab']
    })

    await expect(
      handler(handlers, COLLABORATION_CHANNELS.importFile)()
    ).rejects.toBe(closeError)
    expect(close).toHaveBeenCalledTimes(1)
    expect(importBundle).not.toHaveBeenCalled()
  })
})
