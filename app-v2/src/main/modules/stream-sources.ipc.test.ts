import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../../shared/settings'
import { STREAM_SOURCE_CHANNELS } from '../../shared/stream-sources'
import type { ModuleContext } from '../module-context'

vi.mock('./dashboards', () => ({
  getDashboardManager: () => ({
    load: async () => undefined,
    list: () => [
      {
        id: 'dash-user',
        name: 'User dashboard',
        width: 1024,
        height: 600,
        elementCount: 4,
        hasPreview: false,
        hidden: false,
        builtIn: false
      },
      {
        id: 'dash-built-in',
        name: 'Bundled dashboard',
        width: 800,
        height: 480,
        elementCount: 2,
        hasPreview: false,
        hidden: false,
        builtIn: true
      }
    ]
  })
}))

vi.mock('../touchpanel/manager', () => ({
  getTouchPanelManager: () => ({
    load: async () => undefined,
    list: () => [{
      id: 'touch-user',
      name: 'User touch panel',
      columns: 3,
      rows: 2,
      buttonCount: 6,
      hidden: false
    }]
  })
}))

vi.mock('./logger', () => ({
  logger: { warn: vi.fn() }
}))

import { register } from './stream-sources'

describe('stream source IPC contract', () => {
  let settings: AppSettings
  let handlers: Map<string, (event: unknown, payload?: unknown) => unknown>
  let broadcasts: Array<{ channel: string; payload: unknown }>
  let beforeQuit: (() => void) | null

  beforeEach(() => {
    settings = structuredClone(DEFAULT_APP_SETTINGS)
    handlers = new Map()
    broadcasts = []
    beforeQuit = null
  })

  function setup(): void {
    const ctx = {
      app: {
        once: (event: string, listener: () => void) => {
          if (event === 'before-quit') beforeQuit = listener
        }
      },
      ipcMain: {
        handle: (channel: string, handler: (event: unknown, payload?: unknown) => unknown) => {
          handlers.set(channel, handler)
        }
      },
      broadcast: (channel: string, payload: unknown) => {
        broadcasts.push({ channel, payload: structuredClone(payload) })
      }
    } as unknown as ModuleContext
    const store = {
      getSettings: () => structuredClone(settings),
      setSettings: (patch: Partial<AppSettings>) => {
        settings = { ...settings, ...structuredClone(patch) }
        return structuredClone(settings)
      }
    }
    register(ctx, store as never, {
      status: async () => ({ running: false, layoutKind: 'dashboard', layoutId: 'dash-user' }),
      stop: async () => ({ running: false, layoutKind: 'dashboard', layoutId: 'dash-user' })
    })
  }

  async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`Missing handler: ${channel}`)
    return await handler({}, payload) as T
  }

  it('returns descriptor-only catalogs and accepts exact ID-only mutations', async () => {
    setup()

    const listed = await invoke<Array<Record<string, unknown>>>(STREAM_SOURCE_CHANNELS.list)
    expect(Object.keys(listed[0]).sort()).toEqual([
      'active',
      'added',
      'eligible',
      'id',
      'kind',
      'label',
      'reason'
    ])

    const added = await invoke<Array<Record<string, unknown>>>(
      STREAM_SOURCE_CHANNELS.add,
      { kind: 'dashboard', id: 'dash-user' }
    )
    expect(added.find((source) => source.id === 'dash-user')).toEqual(
      expect.objectContaining({ added: true, eligible: true })
    )
    expect(settings.streamTargets.profiles).toEqual([
      expect.objectContaining({ kind: 'dashboard', sourceId: 'dash-user' })
    ])
    expect(broadcasts.some(({ channel }) => channel === STREAM_SOURCE_CHANNELS.updated)).toBe(true)
    beforeQuit?.()
  })

  it('rejects descriptor injection, tampered IDs, and built-in sources', async () => {
    setup()

    await expect(invoke(STREAM_SOURCE_CHANNELS.add, {
      kind: 'dashboard',
      id: 'dash-user',
      eligible: true
    })).rejects.toThrow('Invalid streaming source add request')
    await expect(invoke(STREAM_SOURCE_CHANNELS.add, {
      kind: 'dashboard',
      id: '../settings'
    })).rejects.toThrow('Invalid streaming source add request')
    await expect(invoke(STREAM_SOURCE_CHANNELS.add, {
      kind: 'dashboard',
      id: 'dash-built-in'
    })).rejects.toThrow('built-in')
    expect(settings.streamTargets.profiles).toEqual([])
    beforeQuit?.()
  })

  it.each(['.', '..'])('rejects the URL dot-segment add mutation ID %s', async (id) => {
    setup()

    await expect(invoke(STREAM_SOURCE_CHANNELS.add, {
      kind: 'dashboard',
      id
    })).rejects.toThrow('Invalid streaming source add request')
    expect(settings.streamTargets.profiles).toEqual([])
    beforeQuit?.()
  })
})
