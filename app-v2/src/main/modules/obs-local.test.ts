import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, request, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OBS_LOCAL_CHANNELS, type ObsLocalFeedStartArgs, type ObsLocalStatus } from '../../shared/obs-local'
import type { ModuleContext } from '../module-context'

const managerState = vi.hoisted(() => ({
  requestedDashboards: [] as string[]
}))

vi.mock('./dashboards', () => ({
  getDashboardManager: () => ({
    listOpen: () => [{ id: 'default' }],
    list: () => [
      { id: 'default', name: 'Default dashboard', hidden: false },
      { id: 'race', name: 'Race dashboard', hidden: false }
    ],
    getDashboard: (id: string) => {
      managerState.requestedDashboards.push(id)
      return id === 'default' || id === 'race'
        ? {
            id,
            name: `${id} dashboard`,
            elements: []
          }
        : null
    }
  })
}))

vi.mock('../touchpanel/manager', () => ({
  getTouchPanelManager: () => ({
    has: () => false,
    getPanel: () => null
  })
}))

import { register } from './obs-local'
import { stop as stopStreaming } from './streaming'

interface ResponseData {
  statusCode: number
  body: string
  headers: IncomingHttpHeaders
}

function fakeContext(): ModuleContext & {
  handlers: Map<string, (_event: unknown, args?: ObsLocalFeedStartArgs) => unknown>
} {
  const handlers = new Map<string, (_event: unknown, args?: ObsLocalFeedStartArgs) => unknown>()
  return {
    handlers,
    app: { once: () => undefined },
    ipcMain: {
      handle: (channel: string, handler: (_event: unknown, args?: ObsLocalFeedStartArgs) => unknown) => {
        handlers.set(channel, handler)
      }
    },
    telemetryHub: {
      getLatest: () => ({
        connected: true,
        driverName: 'Secret Driver'
      })
    },
    serialManager: {},
    serialHub: {},
    profileStore: {},
    iracingControl: {},
    getMainWindow: () => null,
    broadcast: () => undefined,
    registerGracefulTeardown: () => () => undefined
  } as unknown as ModuleContext & {
    handlers: Map<string, (_event: unknown, args?: ObsLocalFeedStartArgs) => unknown>
  }
}

async function invoke<T>(
  ctx: ReturnType<typeof fakeContext>,
  channel: string,
  args?: ObsLocalFeedStartArgs
): Promise<T> {
  const handler = ctx.handlers.get(channel)
  if (!handler) throw new Error(`missing handler ${channel}`)
  return await handler({}, args) as T
}

function httpRequest(url: string, method = 'GET'): Promise<ResponseData> {
  return new Promise((resolveResult, rejectResult) => {
    const req = request(url, { method }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolveResult({
        statusCode: res.statusCode ?? 0,
        body,
        headers: res.headers
      }))
    })
    req.on('error', rejectResult)
    req.end()
  })
}

function runningFeedUrl(status: ObsLocalStatus): string {
  const url = status.feed.url
  if (!url) throw new Error('expected OBS local feed URL')
  return url
}

async function settleWithin<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} did not settle.`)), 2_000)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function reserveLoopbackPort(): Promise<number> {
  return await new Promise<number>((resolveResult, rejectResult) => {
    const server = createServer()
    server.once('error', rejectResult)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => rejectResult(new Error('failed to reserve loopback port')))
        return
      }
      const port = (address as AddressInfo).port
      server.close((error) => error ? rejectResult(error) : resolveResult(port))
    })
  })
}

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__')

describe('obs-local module Browser Source feed', () => {
  beforeEach(() => {
    process.env.ULTIMATE_SIM_STREAM_RENDERER_DIR = resolve(fixtureRoot, 'stream-renderer')
    managerState.requestedDashboards.length = 0
  })

  afterEach(async () => {
    await stopStreaming()
    delete process.env.ULTIMATE_SIM_STREAM_RENDERER_DIR
  })

  it('starts the certification feed on loopback by default and serves the OBS document over HTTP', async () => {
    const ctx = fakeContext()
    register(ctx)

    const status = await invoke<ObsLocalStatus>(ctx, OBS_LOCAL_CHANNELS.startFeed, { layoutId: 'race' })
    const document = await httpRequest(runningFeedUrl(status))
    const rejectedControl = await httpRequest(
      runningFeedUrl(status).replace('/obs/race', '/api/touch/action'),
      'POST'
    )

    expect(status.feed).toEqual(expect.objectContaining({
      running: true,
      bindAddress: '127.0.0.1',
      portMode: 'ephemeral',
      allowedLayoutIds: ['race'],
      readOnly: true,
      health: 'fresh'
    }))
    expect(runningFeedUrl(status)).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/obs\/race/)
    expect(document.statusCode).toBe(200)
    expect(document.body).toContain('<base href="../"')
    expect(rejectedControl.statusCode).toBe(405)
    expect(managerState.requestedDashboards).toEqual(['race'])
  })

  it('honors an explicit fixed loopback port for the read-only Browser Source feed', async () => {
    const ctx = fakeContext()
    register(ctx)
    const port = await reserveLoopbackPort()

    const status = await invoke<ObsLocalStatus>(ctx, OBS_LOCAL_CHANNELS.startFeed, { layoutId: 'race', port })
    const document = await httpRequest(runningFeedUrl(status))

    expect(status.feed).toEqual(expect.objectContaining({
      running: true,
      bindAddress: '127.0.0.1',
      port,
      portMode: 'explicit',
      readOnly: true
    }))
    expect(runningFeedUrl(status)).toContain(`127.0.0.1:${port}`)
    expect(document.statusCode).toBe(200)
  })

  it('rejects non-fixed OBS Browser Source port overrides', async () => {
    const ctx = fakeContext()
    register(ctx)

    await expect(
      invoke(ctx, OBS_LOCAL_CHANNELS.startFeed, { layoutId: 'race', port: 0 })
    ).rejects.toThrow(/port override must be an integer from 1 to 65535/i)
  })

  it('cancels a pending OBS feed start when stop is requested concurrently', async () => {
    const ctx = fakeContext()
    register(ctx)

    const starting = invoke<ObsLocalStatus>(ctx, OBS_LOCAL_CHANNELS.startFeed, { layoutId: 'race' })
    const stopping = invoke<ObsLocalStatus>(ctx, OBS_LOCAL_CHANNELS.stopFeed)
    const [startResult, stopResult] = await settleWithin(
      Promise.allSettled([starting, stopping]),
      'OBS feed start/stop race'
    )

    expect(startResult.status).toBe('rejected')
    if (startResult.status === 'rejected') {
      expect(startResult.reason).toEqual(expect.objectContaining({
        message: expect.stringMatching(/startup was cancelled/i)
      }))
    }
    expect(stopResult.status).toBe('fulfilled')
    if (stopResult.status === 'fulfilled') expect(stopResult.value.feed.running).toBe(false)
    expect((await invoke<ObsLocalStatus>(ctx, OBS_LOCAL_CHANNELS.status)).feed.running).toBe(false)
  })
})
