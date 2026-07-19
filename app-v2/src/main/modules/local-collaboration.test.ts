import { describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn()
}))

vi.mock('electron', () => ({
  dialog: electronMocks
}))

import { COLLABORATION_CHANNELS, type CollaborationWorkspaceState } from '../../shared/local-collaboration'
import type { ModuleContext } from '../module-context'
import { register } from './local-collaboration'

type Handler = (...args: unknown[]) => unknown

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
