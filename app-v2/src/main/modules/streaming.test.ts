import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { request, type IncomingHttpHeaders } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STREAMING_CHANNELS, STREAMING_EXPRESSION_EXCLUSION_MESSAGE, type StreamingSelfTestResult, type StreamingStartArgs, type StreamingStartResult, type StreamingStatus } from '../../shared/streaming'
import type { ModuleContext } from '../module-context'

const managerState = vi.hoisted(() => ({
  requestedDashboards: [] as string[],
  requestedPanels: [] as string[]
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
            elements: id === 'race'
              ? [{ id: 'expr-value', type: 'text', x: 0, y: 0, w: 160, h: 60, binding: 'expr:#race-delta', style: {} }]
              : []
          }
        : null
    }
  })
}))

vi.mock('../touchpanel/manager', () => ({
  getTouchPanelManager: () => ({
    has: (id: string) => id === 'pit',
    getPanel: (id: string) => {
      managerState.requestedPanels.push(id)
      return id === 'pit' ? { id, name: 'Pit panel', buttons: [] } : null
    }
  })
}))

import { isLocalNetworkAddress, register } from './streaming'

interface ResponseData {
  statusCode: number
  body: string
  headers: IncomingHttpHeaders
}

interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
}

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__')

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

function httpRequest(url: string, options: RequestOptions = {}): Promise<ResponseData> {
  return new Promise((resolveResult, rejectResult) => {
    const body = options.body
    const headers = { ...options.headers }
    if (body !== undefined) headers['Content-Length'] = String(Buffer.byteLength(body))
    const req = request(url, { method: options.method ?? 'GET', headers }, (res) => {
      let responseBody = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { responseBody += chunk })
      res.on('end', () => resolveResult({ statusCode: res.statusCode ?? 0, body: responseBody, headers: res.headers }))
    })
    req.on('error', rejectResult)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

function sessionCookie(response: ResponseData): string {
  const values = response.headers['set-cookie'] ?? []
  const raw = values.find((value) => value.startsWith('ultimate_sim_stream_session='))
  if (!raw) throw new Error('missing stream session cookie')
  return raw.split(';', 1)[0]
}

function sessionCookieHeader(response: ResponseData): string {
  const values = response.headers['set-cookie'] ?? []
  return values.find((value) => value.startsWith('ultimate_sim_stream_session=')) ?? ''
}

function localDocumentUrl(started: StreamingStartResult): string {
  if (!started.localTestUrl) throw new Error('missing local test URL')
  return started.localTestUrl
}

function sseHandshake(url: string, cookie: string): Promise<string> {
  return new Promise((resolveResult, rejectResult) => {
    let settled = false
    const req = request(url, { headers: { Cookie: cookie, Accept: 'text/event-stream' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        rejectResult(new Error(`HTTP ${res.statusCode}`))
        return
      }
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        body += chunk
        if (!settled && body.includes('event: telemetry')) {
          settled = true
          resolveResult(body)
          res.destroy()
        }
      })
      res.on('error', (error) => {
        if (!settled) rejectResult(error)
      })
    })
    req.setTimeout(3_000, () => req.destroy(new Error('SSE timeout')))
    req.on('error', (error) => {
      if (!settled) rejectResult(error)
    })
    req.end()
  })
}

describe('streaming authenticated server', () => {
  let ctx: ReturnType<typeof fakeContext> | null = null

  beforeEach(() => {
    process.env.ULTIMATE_SIM_STREAM_RENDERER_DIR = resolve(fixtureRoot, 'stream-renderer')
    managerState.requestedDashboards.length = 0
    managerState.requestedPanels.length = 0
  })

  afterEach(async () => {
    if (ctx) await invoke<StreamingStatus>(ctx, STREAMING_CHANNELS.stop)
    ctx = null
    delete process.env.ULTIMATE_SIM_STREAM_RENDERER_DIR
  })

  it('rejects control-ish routes and non-auth POST methods', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, { streamSafe: true })

    const postControl = await httpRequest(started.url.replace('/obs/default', '/api/touch/action'), { method: 'POST' })
    expect(postControl.statusCode).toBe(405)

    const getControl = await httpRequest(started.url.replace('/obs/default', '/api/touch/action'))
    expect(getControl.statusCode).toBe(404)
  })

  it('requires passwords for LAN/internet and a public HTTPS URL for manual internet mode', async () => {
    ctx = fakeContext()
    register(ctx)

    await expect(invoke(ctx, STREAMING_CHANNELS.start, { accessMode: 'lan' })).rejects.toThrow(/requires a password/i)
    await expect(invoke(ctx, STREAMING_CHANNELS.start, { accessMode: 'internet', publicBaseUrl: 'https://example.com' })).rejects.toThrow(/requires a password/i)
    await expect(invoke(ctx, STREAMING_CHANNELS.start, { accessMode: 'internet', password: 'phone-pass' })).rejects.toThrow(/public HTTPS/i)
    await expect(invoke(ctx, STREAMING_CHANNELS.start, { accessMode: 'internet', password: 'phone-pass', publicBaseUrl: 'http://example.com' })).rejects.toThrow(/public HTTPS/i)
  })

  it('serves packaged document, CSS, assets, and nested module imports through a scoped cookie', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, { layoutId: 'race', streamSafe: true })
    const documentUrl = localDocumentUrl(started)
    const document = await httpRequest(documentUrl)
    const cookie = sessionCookie(document)
    const setCookie = sessionCookieHeader(document)

    expect(document.statusCode).toBe(200)
    expect(document.body).toContain('<base href="../"')
    expect(document.body).not.toMatch(/[?&](?:token|password)=/)
    expect(setCookie).toContain('Path=/')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).not.toContain('Secure')
    expect(setCookie).not.toMatch(/\bDomain=/i)

    const baseUrl = new URL('../', documentUrl)
    const entryUrl = new URL('assets/stream-entry.js', baseUrl)
    expect(entryUrl.pathname).toBe('/assets/stream-entry.js')
    const entry = await httpRequest(entryUrl.toString(), { headers: { Cookie: cookie } })
    const nested = await httpRequest(new URL('assets/nested.js', baseUrl).toString(), { headers: { Cookie: cookie } })
    const deep = await httpRequest(new URL('assets/deep.js', baseUrl).toString(), { headers: { Cookie: cookie } })
    const dynamic = await httpRequest(new URL('assets/dynamic.js', baseUrl).toString(), { headers: { Cookie: cookie } })
    const stylesheet = await httpRequest(new URL('assets/stream.css', baseUrl).toString(), { headers: { Cookie: cookie } })
    const nestedStylesheet = await httpRequest(new URL('assets/nested.css', baseUrl).toString(), { headers: { Cookie: cookie } })

    expect([entry, nested, deep, dynamic, stylesheet, nestedStylesheet].map((response) => response.statusCode)).toEqual([200, 200, 200, 200, 200, 200])
    expect(entry.body).toContain("from './nested.js'")
    expect(nested.body).toContain("from './deep.js'")
    expect(stylesheet.body).toContain('@import "./nested.css"')

    const queryTokenWithoutCookie = await httpRequest(`${entryUrl}?token=${encodeURIComponent(started.token)}`)
    expect(queryTokenWithoutCookie.statusCode).toBe(403)
  })

  it('preserves a manual HTTPS path prefix and scopes a Secure internet cookie to it', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      accessMode: 'internet',
      password: 'phone-pass',
      publicBaseUrl: 'https://stream.example.test/public/overlay/',
      layoutId: 'race'
    })

    const publicUrl = new URL(started.url)
    expect(publicUrl.origin).toBe('https://stream.example.test')
    expect(publicUrl.pathname).toBe('/public/overlay/obs/race')
    expect(publicUrl.searchParams.get('dash')).toBe('race')
    expect(started.lanUrl).toBeNull()
    expect(started.localTestUrl).toBeNull()
    const internetStatus = await invoke<StreamingStatus>(ctx, STREAMING_CHANNELS.status)
    expect(internetStatus.lanUrl).toBeNull()
    expect(internetStatus.localTestUrl).toBeNull()

    const localPrefixedUrl = `http://127.0.0.1:${started.port}${publicUrl.pathname}${publicUrl.search}`
    const document = await httpRequest(localPrefixedUrl, {
      headers: {
        Host: 'stream.example.test',
        'X-Forwarded-Proto': 'https'
      }
    })
    const setCookie = sessionCookieHeader(document)
    const cookie = sessionCookie(document)

    expect(document.statusCode).toBe(200)
    expect(setCookie).toContain('Path=/public/overlay/')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).not.toMatch(/\bDomain=/i)

    const prefixedAsset = await httpRequest(`http://127.0.0.1:${started.port}/public/overlay/assets/stream-entry.js`, {
      headers: {
        Cookie: cookie,
        Host: 'stream.example.test',
        'X-Forwarded-Proto': 'https'
      }
    })
    expect(prefixedAsset.statusCode).toBe(200)

    const proxyStrippedAsset = await httpRequest(`http://127.0.0.1:${started.port}/assets/stream-entry.js`, {
      headers: {
        Cookie: cookie,
        Host: 'stream.example.test',
        'X-Forwarded-Proto': 'https'
      }
    })
    expect(proxyStrippedAsset.statusCode).toBe(200)

    const outsideCookieScope = await httpRequest(`http://127.0.0.1:${started.port}/assets/stream-entry.js`, {
      headers: { Cookie: cookie }
    })
    expect(outsideCookieScope.statusCode).toBe(403)
  })

  it('rate-limits only failed password exchanges, not authenticated asset misses or repeated valid requests', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      accessMode: 'lan',
      password: 'correct-password',
      layoutId: 'race'
    })
    expect(started.localTestUrl).not.toBeNull()
    if (started.lanAddress) {
      expect(started.lanUrl).toMatch(/^http:\/\//)
    }
    const documentUrl = localDocumentUrl(started)
    const document = await httpRequest(documentUrl)
    const cookie = sessionCookie(document)
    const baseUrl = new URL('../', documentUrl)
    const authUrl = new URL('auth/session', baseUrl).toString()

    for (let index = 0; index < 10; index += 1) {
      const failed = await httpRequest(authUrl, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: `wrong-${index}` })
      })
      expect(failed.statusCode).toBe(403)
    }
    const limited = await httpRequest(authUrl, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'still-wrong' })
    })
    expect(limited.statusCode).toBe(429)

    const reloadedDocument = await httpRequest(documentUrl)
    const reloadedCookie = sessionCookie(reloadedDocument)
    const stillLimitedAfterTokenExchange = await httpRequest(authUrl, {
      method: 'POST',
      headers: { Cookie: reloadedCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct-password' })
    })
    expect(stillLimitedAfterTokenExchange.statusCode).toBe(429)

    for (let index = 0; index < 15; index += 1) {
      const valid = await httpRequest(new URL('assets/stream-entry.js', baseUrl).toString(), { headers: { Cookie: cookie } })
      const missing = await httpRequest(new URL(`assets/missing-${index}.js`, baseUrl).toString(), { headers: { Cookie: cookie } })
      expect(valid.statusCode).toBe(200)
      expect(missing.statusCode).toBe(404)
    }
  })

  it('isolates token-exchange throttling from existing authenticated sessions', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, { layoutId: 'race' })
    const documentUrl = localDocumentUrl(started)
    const document = await httpRequest(documentUrl)
    const cookie = sessionCookie(document)
    const invalidUrl = new URL(documentUrl)
    invalidUrl.searchParams.set('token', 'invalid-token')

    for (let index = 0; index < 10; index += 1) {
      expect((await httpRequest(invalidUrl.toString())).statusCode).toBe(403)
    }
    expect((await httpRequest(invalidUrl.toString())).statusCode).toBe(429)

    const asset = await httpRequest(new URL('../assets/stream-entry.js', documentUrl).toString(), { headers: { Cookie: cookie } })
    expect(asset.statusCode).toBe(200)
  })

  it('upgrades the bootstrap session once and supports repeated API, asset, ping, and SSE requests', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      accessMode: 'lan',
      password: 'correct-password',
      layoutId: 'race'
    })
    const documentUrl = localDocumentUrl(started)
    const document = await httpRequest(documentUrl)
    let cookie = sessionCookie(document)
    const baseUrl = new URL('../', documentUrl)

    const beforeAuth = await httpRequest(new URL('ping', baseUrl).toString(), { headers: { Cookie: cookie } })
    expect(JSON.parse(beforeAuth.body)).toEqual({ passwordRequired: true })

    const authenticated = await httpRequest(new URL('auth/session', baseUrl).toString(), {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct-password' })
    })
    expect(authenticated.statusCode).toBe(200)
    cookie = sessionCookie(authenticated)

    for (let index = 0; index < 12; index += 1) {
      const ping = await httpRequest(new URL('ping', baseUrl).toString(), { headers: { Cookie: cookie } })
      const dashboard = await httpRequest(new URL('api/dashboard/race', baseUrl).toString(), { headers: { Cookie: cookie } })
      const asset = await httpRequest(new URL('assets/nested.js', baseUrl).toString(), { headers: { Cookie: cookie } })
      expect(ping.statusCode).toBe(200)
      expect(JSON.parse(ping.body)).toEqual({ passwordRequired: false })
      expect(dashboard.statusCode).toBe(200)
      const dashboardPayload = JSON.parse(dashboard.body)
      expect(dashboardPayload.dashboard.id).toBe('race')
      expect(dashboardPayload.dashboard.elements[0].binding).toBe('expr:#race-delta')
      expect(dashboardPayload.expressionContent).toEqual({
        mode: 'excluded',
        message: STREAMING_EXPRESSION_EXCLUSION_MESSAGE
      })
      expect(asset.statusCode).toBe(200)
    }

    const handshake = await sseHandshake(new URL('sse', baseUrl).toString(), cookie)
    expect(handshake).toContain('event: telemetry')
    expect(handshake).toContain('"driverName":"YOU"')
    expect(handshake).not.toContain('Secret Driver')
    expect(handshake).not.toContain('Rival Name')
  })

  it('runs a complete packaged graph, target, ping, password, and SSE self-test', async () => {
    ctx = fakeContext()
    register(ctx)
    await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      accessMode: 'lan',
      password: 'self-test-password',
      layoutId: 'race'
    })

    const result = await invoke<StreamingSelfTestResult>(ctx, STREAMING_CHANNELS.selfTest)
    expect(result.reachable).toBe(true)
    expect(result.stage).toBe('complete')
    expect(result.resourceCount).toBeGreaterThanOrEqual(10)
    expect(result.url).not.toMatch(/[?&](?:token|password)=/)
    expect(result.message).toMatch(/document.*resources.*ping.*dashboard target.*authentication.*SSE/i)
    expect(managerState.requestedDashboards).toContain('race')
  })

  it('fails the self-test at the precise nested asset stage', async () => {
    process.env.ULTIMATE_SIM_STREAM_RENDERER_DIR = resolve(fixtureRoot, 'stream-renderer-broken')
    ctx = fakeContext()
    register(ctx)
    await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, { layoutId: 'race' })

    const result = await invoke<StreamingSelfTestResult>(ctx, STREAMING_CHANNELS.selfTest)
    expect(result.reachable).toBe(false)
    expect(result.stage).toBe('assets')
    expect(result.statusCode).toBe(404)
    expect(result.message).toMatch(/missing-nested\.js.*HTTP 404/i)
  })

  it('selects touch targets and serves only the selected target API', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'touch',
      layoutId: 'pit',
      touchPanelId: 'pit'
    })
    const documentUrl = localDocumentUrl(started)
    const document = await httpRequest(documentUrl)
    const cookie = sessionCookie(document)
    const baseUrl = new URL('../', documentUrl)

    expect(new URL(started.url).searchParams.get('kind')).toBe('touch')
    expect(new URL(started.url).searchParams.get('panel')).toBe('pit')
    const panel = await httpRequest(new URL('api/touch/panel/pit', baseUrl).toString(), { headers: { Cookie: cookie } })
    const dashboard = await httpRequest(new URL('api/dashboard/default', baseUrl).toString(), { headers: { Cookie: cookie } })
    expect(panel.statusCode).toBe(200)
    expect(JSON.parse(panel.body).id).toBe('pit')
    expect(dashboard.statusCode).toBe(404)
    expect(managerState.requestedPanels).toContain('pit')
  })

  it('probes the configured public endpoint, including its prefix, without starting a real tunnel', async () => {
    ctx = fakeContext()
    register(ctx)
    await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      accessMode: 'internet',
      password: 'phone-pass',
      publicBaseUrl: 'https://stream.invalid/public/overlay',
      layoutId: 'race',
      autoTunnel: false
    })

    const result = await invoke<StreamingSelfTestResult>(ctx, STREAMING_CHANNELS.selfTest)
    expect(result.reachable).toBe(false)
    expect(result.stage).toBe('document')
    expect(result.url).toBe('https://stream.invalid/public/overlay/obs/race')
    expect(result.message).toMatch(/public HTTPS endpoint/i)
    expect(result.url).not.toContain('token=')
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
