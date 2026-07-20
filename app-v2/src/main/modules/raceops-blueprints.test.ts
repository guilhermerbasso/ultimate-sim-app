import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RACEOPS_BLUEPRINT_CHANNELS } from '../../shared/raceops-blueprints'
import type { ModuleContext } from '../module-context'

const registryMock = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  refreshFeed: vi.fn(),
  dryRun: vi.fn(),
  stage: vi.fn(),
  rollback: vi.fn()
}))

const loggerMock = vi.hoisted(() => ({
  warn: vi.fn()
}))

vi.mock('../blueprints/registry', () => ({
  createFileRaceOpsRegistryStorage: vi.fn(() => ({})),
  RaceOpsBlueprintRegistry: class {
    getSnapshot = registryMock.getSnapshot
    refreshFeed = registryMock.refreshFeed
    dryRun = registryMock.dryRun
    stage = registryMock.stage
    rollback = registryMock.rollback
  }
}))

vi.mock('./logger', () => ({
  logger: loggerMock
}))

import { register } from './raceops-blueprints'

function fakeContext(): ModuleContext & {
  handlers: Map<string, (...args: unknown[]) => unknown>
  broadcast: ReturnType<typeof vi.fn>
} {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    app: {
      getPath: () => 'registry-test-data',
      getVersion: () => '2.54.0'
    },
    ipcMain: {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }
    },
    telemetryHub: {},
    serialManager: {},
    serialHub: {},
    profileStore: {},
    iracingControl: {},
    getMainWindow: () => null,
    broadcast: vi.fn(),
    registerGracefulTeardown: () => () => undefined
  } as unknown as ModuleContext & {
    handlers: Map<string, (...args: unknown[]) => unknown>
    broadcast: ReturnType<typeof vi.fn>
  }
}

async function invokeRefresh(ctx: ReturnType<typeof fakeContext>): Promise<unknown> {
  const handler = ctx.handlers.get(RACEOPS_BLUEPRINT_CHANNELS.refreshFeed)
  if (!handler) throw new Error('missing refresh handler')
  return await handler({}, 'raceops-curated')
}

describe('RaceOps blueprints module broadcasts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registryMock.getSnapshot.mockResolvedValue({})
  })

  it('returns the committed result when post-operation snapshot construction fails', async () => {
    const committed = { feeds: [{ id: 'raceops-curated', sequence: 2 }] }
    registryMock.refreshFeed.mockResolvedValue(committed)
    registryMock.getSnapshot
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('feed expired after durable commit'))
    const ctx = fakeContext()
    register(ctx)

    await expect(invokeRefresh(ctx)).resolves.toBe(committed)
    expect(ctx.broadcast).not.toHaveBeenCalled()
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'raceops-blueprints',
      'registry change broadcast failed',
      { message: 'feed expired after durable commit' }
    )
  })

  it('returns the committed result when a renderer broadcast throws', async () => {
    const committed = { feeds: [{ id: 'raceops-curated', sequence: 2 }] }
    registryMock.refreshFeed.mockResolvedValue(committed)
    registryMock.getSnapshot.mockResolvedValueOnce({}).mockResolvedValueOnce(committed)
    const ctx = fakeContext()
    ctx.broadcast.mockImplementation(() => {
      throw new Error('renderer closed')
    })
    register(ctx)

    await expect(invokeRefresh(ctx)).resolves.toBe(committed)
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'raceops-blueprints',
      'registry change broadcast failed',
      { message: 'renderer closed' }
    )
  })
})
