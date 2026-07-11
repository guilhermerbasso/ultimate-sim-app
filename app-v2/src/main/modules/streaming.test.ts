import { afterEach, describe, expect, it } from 'vitest'
import { request } from 'node:http'
import { STREAMING_CHANNELS, type StreamingStartArgs, type StreamingStartResult, type StreamingStatus } from '../../shared/streaming'
import { isLocalNetworkAddress, register } from './streaming'
import type { ModuleContext } from '../module-context'

interface ResponseData {
  statusCode: number
  body: string
}

function fakeContext(): ModuleContext & { handlers: Map<string, (_event: unknown, args?: StreamingStartArgs) => unknown> } {
  const handlers = new Map<string, (_event: unknown, args?: StreamingStartArgs) => unknown>()
  return {
    handlers,
    app: { once: () => undefined },
    ipcMain: {
      handle: (channel: string, handler: (_event: unknown, args?: StreamingStartArgs) => unknown) => {
        handlers.set(channel, handler)
      }
    },
    telemetryHub: {
      getLatest: () => ({
        connected: true,
        driverName: 'Secret Driver',
        strengthOfField: 9999,
        drivers: [{ name: 'Rival Name', iRating: 5000, safetyRating: 'A 4.99', license: 'A', custId: 123, teamId: 1, teamName: 'Secret Team', carPath: 'secret', carNumberRaw: '7', isPlayer: false }],
        relatives: { ahead: { name: 'Ahead Driver' }, behind: { name: 'Behind Driver' } },
        radarCars: [{ name: 'Radar Driver' }]
      })
    },
    serialManager: {},
    serialHub: {},
    profileStore: {},
    iracingControl: {},
    getMainWindow: () => null,
    broadcast: () => undefined
  } as unknown as ModuleContext & { handlers: Map<string, (_event: unknown, args?: StreamingStartArgs) => unknown> }
}

async function invoke<T>(ctx: ReturnType<typeof fakeContext>, channel: string, args?: StreamingStartArgs): Promise<T> {
  const handler = ctx.handlers.get(channel)
  if (!handler) throw new Error(`missing handler ${channel}`)
  return await handler({}, args) as T
}

function httpRequest(url: string, method = 'GET'): Promise<ResponseData> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('streaming read-only server', () => {
  let ctx: ReturnType<typeof fakeContext> | null = null

  afterEach(async () => {
    if (ctx) await invoke<StreamingStatus>(ctx, STREAMING_CHANNELS.stop)
    ctx = null
  })

  it('rejects control-ish routes and non-GET/HEAD methods', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, { streamSafe: true })

    const postControl = await httpRequest(`${started.url.replace('/obs/default', '/api/touch/action')}`, 'POST')
    expect(postControl.statusCode).toBe(405)

    const getControl = await httpRequest(`${started.url.replace('/obs/default', '/api/touch/action')}`)
    expect(getControl.statusCode).toBe(404)
  })

  it('requires both token and password outside local mode', async () => {
    ctx = fakeContext()
    register(ctx)

    await expect(invoke(ctx, STREAMING_CHANNELS.start, { accessMode: 'lan' })).rejects.toThrow(/requires a password/i)
    await expect(invoke(ctx, STREAMING_CHANNELS.start, { accessMode: 'internet', publicBaseUrl: 'https://example.com' })).rejects.toThrow(/requires a password/i)
  })

  it('refuses internet mode without a public HTTPS base URL', async () => {
    ctx = fakeContext()
    register(ctx)

    await expect(invoke(ctx, STREAMING_CHANNELS.start, { accessMode: 'internet', password: 'phone-pass' })).rejects.toThrow(/public HTTPS/i)
    await expect(invoke(ctx, STREAMING_CHANNELS.start, { accessMode: 'internet', password: 'phone-pass', publicBaseUrl: 'http://example.com' })).rejects.toThrow(/public HTTPS/i)
  })
})

describe('streaming LAN address checks', () => {
  it('accepts private IPv4, IPv4-mapped IPv6, IPv6 loopback, ULA, and link-local addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.42.0.9',
      '172.31.255.2',
      '192.168.50.10',
      '169.254.10.20',
      '100.64.1.2',
      '::1',
      'fc00::1234',
      'fd12:3456:789a::1',
      'fe80::abcd%12',
      '::ffff:192.168.1.25',
      '::ffff:7f00:1'
    ]) {
      expect(isLocalNetworkAddress(address), address).toBe(true)
    }

    for (const address of [
      '8.8.8.8',
      '172.32.0.1',
      '100.128.0.1',
      '2001:4860:4860::8888',
      'fec0::1',
      '::ffff:8.8.8.8',
      'unknown'
    ]) {
      expect(isLocalNetworkAddress(address), address).toBe(false)
    }
    expect(isLocalNetworkAddress(undefined)).toBe(false)
  })
})
