import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { connect } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import {
  STREAMING_CHANNELS,
  STREAMING_EXPRESSION_EXCLUSION_MESSAGE,
  type StreamingSelfTestResult,
  type StreamingStartArgs,
  type StreamingStartResult,
  type StreamingStatus,
  type StreamingTouchActionResponse,
  type StreamingTouchPanelPayload
} from '../../shared/streaming'
import { createStreamPresentationProfile } from '../../shared/stream-presentation'
import type {
  ButtonAction,
  ButtonBoxPanel,
  TouchActionPhase,
  TouchSemanticActionRequest
} from '../../shared/touch-panel'
import type { ModuleContext } from '../module-context'
import { registerTouchSemanticActionRuntime } from '../actions/touch-owner'

const managerState = vi.hoisted(() => ({
  requestedDashboards: [] as string[],
  requestedPanels: [] as string[],
  semanticCalls: [] as Array<{ request: TouchSemanticActionRequest; ownerKey: string }>,
  releasedOwners: [] as string[],
  panelAvailable: true,
  panel: {
    schemaVersion: 2 as const,
    id: 'pit',
    name: 'Pit panel',
    columns: 3,
    rows: 2,
    gap: 12,
    background: '#05070d',
    buttons: [
      {
        id: 'pit-fuel',
        label: 'Fuel',
        control: {
          kind: 'momentary' as const,
          action: { kind: 'iracing' as const, command: { group: 'pit' as const, name: 'pit:addFuel' as const, fuelLiters: 10 } }
        },
        shape: 'square' as const,
        material: 'backlit' as const,
        bodyColor: '#1d4ed8',
        textColor: '#ffffff',
        fontSize: 18,
        borderColor: '#60a5fa',
        borderWidth: 2
      },
      {
        id: 'radio-hold',
        label: 'Radio',
        control: {
          kind: 'momentary' as const,
          action: { kind: 'keyboard' as const, command: { mode: 'hold' as const, keys: ['V'] } }
        },
        shape: 'square' as const,
        material: 'backlit' as const,
        bodyColor: '#166534',
        textColor: '#ffffff',
        fontSize: 18,
        borderColor: '#4ade80',
        borderWidth: 2
      },
      {
        id: 'lights-toggle',
        label: 'Lights',
        control: {
          kind: 'latching-toggle' as const,
          onAction: { kind: 'keyboard' as const, command: { mode: 'toggle' as const, keys: ['H'] } },
          offAction: { kind: 'keyboard' as const, command: { mode: 'toggle' as const, keys: ['H'] } }
        },
        shape: 'pill' as const,
        material: 'toggle' as const,
        bodyColor: '#854d0e',
        textColor: '#ffffff',
        fontSize: 18,
        borderColor: '#facc15',
        borderWidth: 2
      },
      {
        id: 'bias-rotary',
        label: 'Black box',
        control: {
          kind: 'rotary' as const,
          decrementAction: { kind: 'iracing' as const, command: { group: 'blackBox' as const, name: 'blackBox:previous' as const } },
          incrementAction: { kind: 'iracing' as const, command: { group: 'blackBox' as const, name: 'blackBox:next' as const } },
          decrementLabel: 'Previous',
          incrementLabel: 'Next',
          repeat: { delayMs: 420, intervalMs: 120 }
        },
        shape: 'rotary' as const,
        material: 'rotary' as const,
        bodyColor: '#334155',
        textColor: '#ffffff',
        fontSize: 18,
        borderColor: '#94a3b8',
        borderWidth: 2
      },
      {
        id: 'forbidden-dashboard',
        label: 'Dashboard next',
        control: {
          kind: 'momentary' as const,
          action: { kind: 'app' as const, command: { name: 'dash:cycleNext' as const } }
        },
        shape: 'square' as const,
        material: 'backlit' as const,
        bodyColor: '#7f1d1d',
        textColor: '#ffffff',
        fontSize: 18,
        borderColor: '#f87171',
        borderWidth: 2
      },
      {
        id: 'mode-selector',
        label: 'Mode',
        control: {
          kind: 'selector' as const,
          initialChoiceId: 'hold-mode',
          choices: [{
            id: 'hold-mode',
            label: 'Hold mode',
            value: 'HOLD',
            action: { kind: 'keyboard' as const, command: { mode: 'hold' as const, keys: ['M'] } }
          }]
        },
        shape: 'square' as const,
        material: 'selector' as const,
        bodyColor: '#312e81',
        textColor: '#ffffff',
        fontSize: 18,
        borderColor: '#818cf8',
        borderWidth: 2
      }
    ]
  } as ButtonBoxPanel
}))
const presentationState = vi.hoisted(() => ({
  item: null as unknown
}))
const streamSourceGuard = vi.hoisted(() => ({
  deniedKey: null as string | null,
  calls: [] as string[],
  runtimeBroadcasts: 0
}))

vi.mock('./dashboards', () => ({
  getDashboardManager: () => ({
    listOpen: () => [{ id: 'default' }],
    list: () => [
      { id: 'default', name: 'Default dashboard', hidden: false },
      { id: 'race', name: 'Race dashboard', hidden: false },
      { id: 'race.v2', name: 'Dotted race dashboard', hidden: false }
    ],
    getDashboard: (id: string) => {
      managerState.requestedDashboards.push(id)
      return id === 'default' || id === 'race' || id === 'race.v2'
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
    has: (id: string) => id === 'pit' && managerState.panelAvailable,
    getPanel: (id: string) => {
      managerState.requestedPanels.push(id)
      return id === 'pit' && managerState.panelAvailable ? managerState.panel : null
    }
  })
}))

vi.mock('./stream-presentation', () => ({
  getStreamPresentationProfileForRuntime: async () => presentationState.item
}))

vi.mock('./stream-sources', () => ({
  runWithStreamSourceLock: async <T>(operation: () => Promise<T>) => operation(),
  assertStreamSourceAllowedCurrent: async (ref: { kind: string; id: string }) => {
    const key = `${ref.kind}:${ref.id}`
    streamSourceGuard.calls.push(key)
    if (streamSourceGuard.deniedKey === key) {
      throw new Error(`Add ${key} in Manage streaming sources before starting it.`)
    }
    return {
      ...ref,
      label: ref.id,
      eligible: true,
      reason: null,
      added: true,
      active: false
    }
  },
  assertStreamSourceAllowed: async (ref: { kind: string; id: string }) => {
    const key = `${ref.kind}:${ref.id}`
    if (streamSourceGuard.deniedKey === key) {
      throw new Error(`Add ${key} in Manage streaming sources before starting it.`)
    }
    return {
      ...ref,
      label: ref.id,
      eligible: true,
      reason: null,
      added: true,
      active: true
    }
  },
  broadcastStreamSourceRuntimeChangedCurrent: async () => {
    streamSourceGuard.runtimeBroadcasts += 1
  }
}))

import {
  isLocalNetworkAddress,
  isSseBackpressured,
  isWebSocketBackpressured,
  probeStreamingReceiver,
  publicBaseUrlAfterTunnelStops,
  register,
  resolveStreamingBaseOrigin,
  start as startStreaming,
  status as streamingStatus,
  stop as stopStreaming,
  streamingListenHost,
  streamingReceiverTransport
} from './streaming'

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

function fakeContext(): ModuleContext & {
  handlers: Map<string, (_event: unknown, args?: StreamingStartArgs) => unknown>
  teardownTasks: Array<{ task: () => Promise<void> | void; phase: string | undefined }>
} {
  const handlers = new Map<string, (_event: unknown, args?: StreamingStartArgs) => unknown>()
  const teardownTasks: Array<{ task: () => Promise<void> | void; phase: string | undefined }> = []
  return {
    handlers,
    teardownTasks,
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
    broadcast: () => undefined,
    registerGracefulTeardown: (task: () => Promise<void> | void, phase?: string) => {
      teardownTasks.push({ task, phase })
      return () => undefined
    }
  } as unknown as ModuleContext & {
    handlers: Map<string, (_event: unknown, args?: StreamingStartArgs) => unknown>
    teardownTasks: Array<{ task: () => Promise<void> | void; phase: string | undefined }>
  }
}

async function invoke<T>(ctx: ReturnType<typeof fakeContext>, channel: string, args?: StreamingStartArgs): Promise<T> {
  const handler = ctx.handlers.get(channel)
  if (!handler) throw new Error(`missing handler ${channel}`)
  return await handler({}, args) as T
}

async function settleWithin<T>(promise: Promise<T>, label: string, timeoutMs = 2_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} did not settle within ${timeoutMs}ms.`)), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function occupyLoopbackPort(): Promise<{ port: number; server: Server }> {
  const server = createServer()
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })
  return {
    port: (server.address() as AddressInfo).port,
    server
  }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose())
  })
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

async function requestOutcome(requestPromise: Promise<ResponseData>): Promise<number | 'closed'> {
  try {
    return (await requestPromise).statusCode
  } catch {
    return 'closed'
  }
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

interface TouchSessionFixture {
  documentUrl: string
  baseUrl: URL
  cookie: string
  origin: string
  payload: StreamingTouchPanelPayload
}

async function openTouchSession(
  started: StreamingStartResult,
  password?: string
): Promise<TouchSessionFixture> {
  const documentUrl = localDocumentUrl(started)
  const document = await httpRequest(documentUrl)
  let cookie = sessionCookie(document)
  const baseUrl = new URL('../', documentUrl)
  if (password) {
    const authenticated = await httpRequest(new URL('auth/session', baseUrl).toString(), {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    })
    expect(authenticated.statusCode).toBe(200)
    cookie = sessionCookie(authenticated)
  }
  const panel = await httpRequest(new URL('api/touch/panel/pit', baseUrl).toString(), {
    headers: { Cookie: cookie }
  })
  expect(panel.statusCode).toBe(200)
  return {
    documentUrl,
    baseUrl,
    cookie,
    origin: new URL(documentUrl).origin,
    payload: JSON.parse(panel.body) as StreamingTouchPanelPayload
  }
}

function touchCapability(
  session: TouchSessionFixture,
  controlId: string,
  zone: string,
  phase: TouchActionPhase
) {
  const capability = session.payload.interaction.capabilities.find((candidate) =>
    candidate.controlId === controlId &&
    candidate.zone === zone &&
    candidate.phases.includes(phase)
  )
  if (!capability) throw new Error(`missing capability ${controlId}:${zone}:${phase}`)
  return capability
}

async function postTouchAction(
  session: TouchSessionFixture,
  options: {
    capabilityId: string
    phase: 'trigger' | 'begin' | 'end' | 'cancel'
    nonce?: string
    routeTarget?: string
    bodyTarget?: string
    origin?: string | null
    csrf?: string | null
    extra?: Record<string, unknown>
  }
): Promise<ResponseData> {
  const target = options.routeTarget ?? 'pit'
  const headers: Record<string, string> = {
    Cookie: session.cookie,
    'Content-Type': 'application/json'
  }
  const origin = options.origin === undefined ? session.origin : options.origin
  const csrf = options.csrf === undefined ? session.payload.interaction.csrfToken : options.csrf
  if (origin !== null) headers.Origin = origin
  if (csrf !== null) headers['X-Stream-CSRF'] = csrf
  return httpRequest(new URL(`api/touch/action/${encodeURIComponent(target)}`, session.baseUrl).toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      targetId: options.bodyTarget ?? target,
      capabilityId: options.capabilityId,
      phase: options.phase,
      nonce: options.nonce ?? session.payload.interaction.nonce,
      ...options.extra
    })
  })
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

function webSocketFrame(url: string, cookie: string): Promise<string> {
  return new Promise((resolveResult, rejectResult) => {
    const httpUrl = new URL(url)
    const webSocketUrl = new URL(url)
    webSocketUrl.protocol = webSocketUrl.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(webSocketUrl, { headers: { Cookie: cookie, Origin: httpUrl.origin }, handshakeTimeout: 3_000 })
    socket.once('message', (data) => {
      resolveResult(data.toString())
      socket.close()
    })
    socket.once('error', rejectResult)
  })
}

function webSocketUpgradeStatus(url: string, cookie: string, origin = new URL(url).origin): Promise<number> {
  return new Promise((resolveResult, rejectResult) => {
    const webSocketUrl = new URL(url)
    webSocketUrl.protocol = webSocketUrl.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(webSocketUrl, { headers: { Cookie: cookie, Origin: origin }, handshakeTimeout: 3_000 })
    socket.once('open', () => {
      socket.close()
      resolveResult(101)
    })
    socket.once('unexpected-response', (_request, response) => {
      response.resume()
      resolveResult(response.statusCode ?? 0)
    })
    socket.once('error', rejectResult)
  })
}

function openWebSocketReceiver(url: string, cookie: string): Promise<{ socket: WebSocket; payload: string }> {
  return new Promise((resolveResult, rejectResult) => {
    const httpUrl = new URL(url)
    const webSocketUrl = new URL(url)
    webSocketUrl.protocol = webSocketUrl.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(webSocketUrl, { headers: { Cookie: cookie, Origin: httpUrl.origin }, handshakeTimeout: 3_000 })
    socket.once('message', (data) => resolveResult({ socket, payload: data.toString() }))
    socket.once('error', rejectResult)
  })
}

function openSseReceiver(
  url: string,
  cookie: string
): Promise<{ close: () => void; closed: Promise<void> }> {
  return new Promise((resolveResult, rejectResult) => {
    const req = request(url, { headers: { Cookie: cookie, Accept: 'text/event-stream' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        rejectResult(new Error(`HTTP ${res.statusCode}`))
        return
      }
      let body = ''
      let resolved = false
      let closeResolved = false
      let resolveClosed!: () => void
      const closed = new Promise<void>((resolve) => { resolveClosed = resolve })
      const markClosed = (): void => {
        if (closeResolved) return
        closeResolved = true
        resolveClosed()
      }
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        body += chunk
        if (!resolved && body.includes('event: telemetry')) {
          resolved = true
          resolveResult({
            close: () => req.destroy(),
            closed
          })
        }
      })
      res.on('end', markClosed)
      res.on('close', markClosed)
      res.on('error', (error) => {
        markClosed()
        if (!resolved) rejectResult(error)
      })
    })
    req.setTimeout(3_000, () => req.destroy(new Error('SSE timeout')))
    req.on('error', rejectResult)
    req.end()
  })
}

function touchHealth(session: TouchSessionFixture): Promise<ResponseData> {
  return httpRequest(new URL('api/touch/health/pit', session.baseUrl).toString(), {
    headers: {
      Cookie: session.cookie,
      'X-Stream-CSRF': session.payload.interaction.csrfToken
    }
  })
}

describe('streaming authenticated server', () => {
  let ctx: ReturnType<typeof fakeContext> | null = null
  let unregisterTouchRuntime: (() => Promise<void>) | null = null

  beforeEach(() => {
    process.env.ULTIMATE_SIM_STREAM_RENDERER_DIR = resolve(fixtureRoot, 'stream-renderer')
    managerState.requestedDashboards.length = 0
    managerState.requestedPanels.length = 0
    presentationState.item = null
    streamSourceGuard.deniedKey = null
    streamSourceGuard.calls.length = 0
    streamSourceGuard.runtimeBroadcasts = 0
    managerState.semanticCalls.length = 0
    managerState.releasedOwners.length = 0
    managerState.panelAvailable = true
    const radio = managerState.panel.buttons.find((button) => button.id === 'radio-hold')
    if (radio?.control.kind === 'momentary') {
      radio.control.action = { kind: 'keyboard', command: { mode: 'hold', keys: ['V'] } }
    }
    const lights = managerState.panel.buttons.find((button) => button.id === 'lights-toggle')
    if (lights?.control.kind === 'latching-toggle') {
      lights.control.onAction = { kind: 'keyboard', command: { mode: 'toggle', keys: ['H'] } }
      lights.control.offAction = { kind: 'keyboard', command: { mode: 'toggle', keys: ['H'] } }
    }
    unregisterTouchRuntime = registerTouchSemanticActionRuntime({
      execute: async (request, ownerKey) => {
        managerState.semanticCalls.push({ request, ownerKey })
        return { ok: true, message: `${request.token} ${request.phase} executed.` }
      },
      releaseOwner: async (ownerKey) => {
        managerState.releasedOwners.push(ownerKey)
      }
    })
  })

  afterEach(async () => {
    if (ctx) await invoke<StreamingStatus>(ctx, STREAMING_CHANNELS.stop)
    ctx = null
    await unregisterTouchRuntime?.()
    unregisterTouchRuntime = null
    delete process.env.ULTIMATE_SIM_STREAM_RENDERER_DIR
    delete process.env.ULTIMATE_SIM_STREAM_SESSION_TTL_MS
    delete process.env.ULTIMATE_SIM_STREAM_RECEIVER_LEASE_MS
  })

  it('rejects control-ish routes and non-auth POST methods', async () => {
    ctx = fakeContext()
    register(ctx)
    expect(ctx.teardownTasks).toHaveLength(1)
    expect(ctx.teardownTasks[0].phase).toBe('quiesce')
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, { streamSafe: true })

    const postControl = await httpRequest(started.url.replace('/obs/default', '/api/touch/action'), { method: 'POST' })
    expect(postControl.statusCode).toBe(405)

    const getControl = await httpRequest(started.url.replace('/obs/default', '/api/touch/action'))
    expect(getControl.statusCode).toBe(404)

    const postSourceManagement = await httpRequest(
      started.url.replace('/obs/default', '/api/streaming/sources'),
      { method: 'POST' }
    )
    const getSourceManagement = await httpRequest(
      started.url.replace('/obs/default', '/api/streaming/sources')
    )
    expect(postSourceManagement.statusCode).toBe(405)
    expect(getSourceManagement.statusCode).toBe(404)
  })

  it('fails closed when a valid registry target is not in the persisted source allowlist', async () => {
    ctx = fakeContext()
    register(ctx)
    streamSourceGuard.deniedKey = 'dashboard:race'

    await expect(invoke(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'dashboard',
      layoutId: 'race'
    })).rejects.toThrow(/Manage streaming sources/)
    expect(streamSourceGuard.calls).toEqual(['dashboard:race'])
    expect((await invoke<StreamingStatus>(ctx, STREAMING_CHANNELS.status)).running).toBe(false)
  })

  it.each(['.', '..'])('rejects the dashboard URL dot-segment ID %s without falling back to another dashboard', async (id) => {
    ctx = fakeContext()
    register(ctx)

    await expect(invoke(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'dashboard',
      layoutId: id
    })).rejects.toThrow('Select a valid dashboard')
    expect(managerState.requestedDashboards).toEqual([])
    expect(streamSourceGuard.calls).toEqual([])
    expect((await invoke<StreamingStatus>(ctx, STREAMING_CHANNELS.status)).url).toBeNull()
  })

  it.each(['.', '..'])('rejects the touch URL dot-segment ID %s before registry or allowlist lookup', async (id) => {
    ctx = fakeContext()
    register(ctx)

    await expect(invoke(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'touch',
      touchPanelId: id
    })).rejects.toThrow('Select a valid touch controls panel')
    expect(managerState.requestedPanels).toEqual([])
    expect(streamSourceGuard.calls).toEqual([])
    expect((await invoke<StreamingStatus>(ctx, STREAMING_CHANNELS.status)).url).toBeNull()
  })

  it.each(['.', '..'])('rejects a current presentation whose source target is the URL dot segment %s', async (id) => {
    const profile = createStreamPresentationProfile({
      kind: 'dashboard',
      id,
      name: 'Invalid presentation target',
      revision: `dashboard:${id}:1`,
      width: 1024,
      height: 600,
      itemCount: 1,
      hidden: false
    }, {
      id: id === '.' ? 'stream-profile-dot' : 'stream-profile-dot-dot',
      now: 10
    })
    presentationState.item = {
      profile,
      target: {
        kind: 'dashboard',
        id,
        name: 'Invalid presentation target',
        revision: profile.target.revision,
        width: 1024,
        height: 600,
        itemCount: 1,
        hidden: false
      },
      targetState: 'current'
    }
    ctx = fakeContext()
    register(ctx)

    await expect(invoke(ctx, STREAMING_CHANNELS.start, {
      presentationProfileId: profile.id
    })).rejects.toThrow('invalid source ID')
    expect(streamSourceGuard.calls).toEqual([])
    expect((await invoke<StreamingStatus>(ctx, STREAMING_CHANNELS.status)).url).toBeNull()
  })

  it('preserves legitimate dotted dashboard IDs in the constructed stream URL', async () => {
    ctx = fakeContext()
    register(ctx)

    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'dashboard',
      layoutId: 'race.v2'
    })

    expect(new URL(started.url).pathname).toBe('/obs/race.v2')
    expect(streamSourceGuard.calls).toEqual(['dashboard:race.v2'])
  })

  it('re-checks the persisted allowlist at the selected target HTTP boundary', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'dashboard',
      layoutId: 'race'
    })
    const documentUrl = localDocumentUrl(started)
    const document = await httpRequest(documentUrl)
    const cookie = sessionCookie(document)
    streamSourceGuard.deniedKey = 'dashboard:race'

    const dashboard = await httpRequest(
      new URL('api/dashboard/race', new URL('../', documentUrl)).toString(),
      { headers: { Cookie: cookie } }
    )

    expect(dashboard.statusCode).toBe(404)
  })

  it('broadcasts source active-state changes after normal start and stop lifecycles', async () => {
    ctx = fakeContext()
    register(ctx)

    await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'dashboard',
      layoutId: 'race'
    })
    expect(streamSourceGuard.runtimeBroadcasts).toBe(1)

    await invoke<StreamingStatus>(ctx, STREAMING_CHANNELS.stop)
    expect(streamSourceGuard.runtimeBroadcasts).toBe(2)
  })

  it('joins streaming cleanup to the bounded quiesce teardown barrier', async () => {
    ctx = fakeContext()
    register(ctx)
    expect(ctx.teardownTasks).toHaveLength(1)
    expect(ctx.teardownTasks[0].phase).toBe('quiesce')
    await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, { layoutId: 'race' })

    await ctx.teardownTasks[0].task()
    expect((await invoke<StreamingStatus>(ctx, STREAMING_CHANNELS.status)).running).toBe(false)
  })

  it('rejects a concurrent start instead of letting two server startups race', async () => {
    ctx = fakeContext()
    register(ctx)

    const firstStart = startStreaming(ctx, { layoutId: 'race' })
    await expect(startStreaming(ctx, { layoutId: 'default' })).rejects.toThrow(/startup is already in progress/i)
    const started = await settleWithin(firstStart, 'first streaming start')

    expect(started).toEqual(expect.objectContaining({
      profile: 'general',
      allowedLayoutIds: ['race']
    }))
    expect((await streamingStatus(false)).running).toBe(true)
  })

  it('cancels an in-flight start when stop wins the lifecycle race and settles both promises', async () => {
    ctx = fakeContext()
    register(ctx)

    const starting = startStreaming(ctx, { layoutId: 'race' })
    const stopping = stopStreaming()
    const [startResult, stopResult] = await settleWithin(
      Promise.allSettled([starting, stopping]),
      'start/stop cancellation'
    )

    expect(startResult.status).toBe('rejected')
    if (startResult.status === 'rejected') {
      expect(startResult.reason).toEqual(expect.objectContaining({
        message: expect.stringMatching(/startup was cancelled/i)
      }))
    }
    expect(stopResult.status).toBe('fulfilled')
    if (stopResult.status === 'fulfilled') expect(stopResult.value.running).toBe(false)
    expect(await streamingStatus(false)).toEqual(expect.objectContaining({
      running: false,
      port: null
    }))

    const restarted = await settleWithin(
      startStreaming(ctx, { layoutId: 'race' }),
      'streaming restart after cancellation'
    )
    expect(restarted.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/obs\/race/)
  })

  it('joins concurrent stops and lets a new start wait behind the shared stop', async () => {
    ctx = fakeContext()
    register(ctx)
    await startStreaming(ctx, { layoutId: 'race' })

    const firstStop = stopStreaming()
    const joinedStop = stopStreaming()
    expect(joinedStop).toBe(firstStop)
    const restart = startStreaming(ctx, { layoutId: 'default' })
    const [stopped, restarted] = await settleWithin(
      Promise.all([firstStop, restart]),
      'joined stop and queued restart'
    )

    expect(stopped.running).toBe(false)
    expect(restarted).toEqual(expect.objectContaining({
      profile: 'general',
      allowedLayoutIds: ['default']
    }))
    expect(await streamingStatus(false)).toEqual(expect.objectContaining({
      running: true,
      layoutId: 'default'
    }))
  })

  it('fails a listen error closed, settles cleanup, and remains restartable on the same port', async () => {
    ctx = fakeContext()
    register(ctx)
    const occupied = await occupyLoopbackPort()
    let occupiedClosed = false
    try {
      await expect(settleWithin(
        startStreaming(ctx, { layoutId: 'race', port: occupied.port }),
        'listen-error start'
      )).rejects.toThrow(/EADDRINUSE|address already in use/i)
      expect(await streamingStatus(false)).toEqual(expect.objectContaining({
        running: false,
        port: null
      }))

      await closeServer(occupied.server)
      occupiedClosed = true
      const restarted = await settleWithin(
        startStreaming(ctx, { layoutId: 'race', port: occupied.port }),
        'restart after listen error'
      )
      expect(restarted.port).toBe(occupied.port)
    } finally {
      if (!occupiedClosed) await closeServer(occupied.server)
    }
  })

  it('keeps general streaming and OBS feed ownership isolated across starts and scoped stops', async () => {
    ctx = fakeContext()
    register(ctx)
    const general = await startStreaming(ctx, { layoutId: 'race' })

    await expect(startStreaming(ctx, {
      profile: 'obs-local',
      layoutKind: 'dashboard',
      layoutId: 'race'
    })).rejects.toThrow(/cannot start the OBS Browser Source feed.*stop it first/i)
    expect(await stopStreaming('obs-local')).toEqual(expect.objectContaining({
      running: true,
      profile: 'general',
      url: general.url
    }))

    await stopStreaming('general')
    const obs = await startStreaming(ctx, {
      profile: 'obs-local',
      layoutKind: 'dashboard',
      layoutId: 'race'
    })
    expect(obs.profile).toBe('obs-local')
    expect(await invoke<StreamingStatus>(ctx, STREAMING_CHANNELS.stop)).toEqual(expect.objectContaining({
      running: true,
      profile: 'obs-local',
      url: obs.url
    }))
    await expect(invoke(ctx, STREAMING_CHANNELS.start, {
      profile: 'obs-local',
      layoutId: 'default'
    })).rejects.toThrow(/cannot start the general streaming server.*stop it first/i)
    await expect(startStreaming(ctx, { layoutId: 'default' })).rejects.toThrow(
      /cannot start the general streaming server.*stop it first/i
    )
    expect(await stopStreaming('general')).toEqual(expect.objectContaining({
      running: true,
      profile: 'obs-local',
      url: obs.url
    }))
    expect((await stopStreaming('obs-local')).running).toBe(false)
  })

  it('requires passwords for LAN/internet and a public HTTPS URL for manual internet mode', async () => {
    ctx = fakeContext()
    register(ctx)

    await expect(invoke(ctx, STREAMING_CHANNELS.start, { accessMode: 'lan' })).rejects.toThrow(/requires a password/i)
    await expect(invoke(ctx, STREAMING_CHANNELS.start, { accessMode: 'internet', publicBaseUrl: 'https://example.com' })).rejects.toThrow(/requires a password/i)
    await expect(invoke(ctx, STREAMING_CHANNELS.start, { accessMode: 'internet', password: 'phone-pass' })).rejects.toThrow(/public HTTPS/i)
    await expect(invoke(ctx, STREAMING_CHANNELS.start, { accessMode: 'internet', password: 'phone-pass', publicBaseUrl: 'http://example.com' })).rejects.toThrow(/public HTTPS/i)
  })

  it('keeps a legacy dashboard document inside the browser safe viewport', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'dashboard',
      layoutId: 'race'
    })

    const document = await httpRequest(localDocumentUrl(started))

    expect(document.statusCode).toBe(200)
    expect(document.body).toContain('name="viewport"')
    expect(document.body).toContain('content="width=device-width, initial-scale=1.0"')
    expect(document.body).not.toContain('viewport-fit=cover')
  })

  it('keeps a legacy touch document inside the browser safe viewport', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'touch',
      layoutId: 'pit',
      touchPanelId: 'pit'
    })

    const document = await httpRequest(localDocumentUrl(started))

    expect(document.statusCode).toBe(200)
    expect(document.body).toContain('name="viewport"')
    expect(document.body).toContain('content="width=device-width, initial-scale=1.0"')
    expect(document.body).not.toContain('viewport-fit=cover')
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

  it('streams a current presentation profile and exposes only its selected runtime payload', async () => {
    const profile = createStreamPresentationProfile({
      kind: 'dashboard',
      id: 'race',
      name: 'Race dashboard',
      revision: 'dashboard:race:1',
      width: 1024,
      height: 600,
      itemCount: 1,
      hidden: false
    }, {
      id: 'stream-profile-race',
      presetId: 'iphone-15-pro',
      now: 10
    })
    presentationState.item = {
      profile,
      target: {
        kind: 'dashboard',
        id: 'race',
        name: 'Race dashboard',
        revision: profile.target.revision,
        width: 1024,
        height: 600,
        itemCount: 1,
        hidden: false
      },
      targetState: 'current'
    }
    ctx = fakeContext()
    register(ctx)

    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      presentationProfileId: profile.id
    })
    const documentUrl = localDocumentUrl(started)
    const parsedUrl = new URL(documentUrl)
    const document = await httpRequest(documentUrl)
    const cookie = sessionCookie(document)
    const baseUrl = new URL('../', documentUrl)
    const presentation = await httpRequest(
      new URL(`api/presentation/${profile.id}`, baseUrl).toString(),
      { headers: { Cookie: cookie } }
    )
    const dashboard = await httpRequest(
      new URL('api/dashboard/race', baseUrl).toString(),
      { headers: { Cookie: cookie } }
    )
    const status = await invoke<StreamingStatus>(ctx, STREAMING_CHANNELS.status)

    expect(parsedUrl.searchParams.get('profile')).toBe(profile.id)
    expect(parsedUrl.searchParams.get('dash')).toBe('race')
    expect(document.body).toContain('viewport-fit=cover')
    expect(started.presentationProfileId).toBe(profile.id)
    expect(status.presentationProfileId).toBe(profile.id)
    expect(presentation.statusCode).toBe(200)
    expect(JSON.parse(presentation.body)).toEqual(profile)
    expect(dashboard.statusCode).toBe(200)
  })

  it('applies the same source allowlist to presentation-profile starts', async () => {
    const profile = createStreamPresentationProfile({
      kind: 'dashboard',
      id: 'race',
      name: 'Race dashboard',
      revision: 'dashboard:race:1',
      width: 1024,
      height: 600,
      itemCount: 1,
      hidden: false
    }, {
      id: 'stream-profile-denied',
      now: 10
    })
    presentationState.item = {
      profile,
      target: {
        kind: 'dashboard',
        id: 'race',
        name: 'Race dashboard',
        revision: profile.target.revision,
        width: 1024,
        height: 600,
        itemCount: 1,
        hidden: false
      },
      targetState: 'current'
    }
    streamSourceGuard.deniedKey = 'dashboard:race'
    ctx = fakeContext()
    register(ctx)

    await expect(invoke(ctx, STREAMING_CHANNELS.start, {
      presentationProfileId: profile.id
    })).rejects.toThrow(/Manage streaming sources/)
    expect(streamSourceGuard.calls).toEqual(['dashboard:race'])
  })

  it('blocks stale presentation profiles before opening a stream', async () => {
    const profile = createStreamPresentationProfile({
      kind: 'dashboard',
      id: 'race',
      name: 'Race dashboard',
      revision: 'dashboard:race:1',
      width: 1024,
      height: 600,
      itemCount: 1,
      hidden: false
    }, {
      id: 'stream-profile-race',
      now: 10
    })
    presentationState.item = {
      profile,
      target: { kind: 'dashboard', id: 'race', name: 'Race dashboard', revision: 'dashboard:race:2', itemCount: 1, hidden: false },
      targetState: 'stale'
    }
    ctx = fakeContext()
    register(ctx)

    await expect(invoke(ctx, STREAMING_CHANNELS.start, {
      presentationProfileId: profile.id
    })).rejects.toThrow(/target changed/i)
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
    expect(await webSocketUpgradeStatus(new URL('ws', baseUrl).toString(), cookie)).toBe(403)

    const authenticated = await httpRequest(new URL('auth/session', baseUrl).toString(), {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct-password' })
    })
    expect(authenticated.statusCode).toBe(200)
    cookie = sessionCookie(authenticated)
    expect(await webSocketUpgradeStatus(new URL('ws', baseUrl).toString(), cookie, 'http://sibling.example.test')).toBe(403)
    expect(await webSocketUpgradeStatus(new URL('ws', baseUrl).toString(), cookie)).toBe(101)

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

    const webSocketPayload = await webSocketFrame(new URL('ws', baseUrl).toString(), cookie)
    expect(webSocketPayload).toContain('"driverName":"YOU"')
    expect(webSocketPayload).not.toContain('Secret Driver')
    expect(webSocketPayload).not.toContain('Rival Name')
  })

  it('stops promptly with a live WebSocket receiver and admits no reconnecting client', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, { layoutId: 'race' })
    const documentUrl = localDocumentUrl(started)
    const document = await httpRequest(documentUrl)
    const cookie = sessionCookie(document)
    const baseUrl = new URL('../', documentUrl)
    const receiver = await openWebSocketReceiver(new URL('ws', baseUrl).toString(), cookie)
    expect(receiver.payload).toContain('"driverName":"YOU"')
    const closed = new Promise<void>((resolveClosed) => receiver.socket.once('close', () => resolveClosed()))

    const stopPromise = invoke<StreamingStatus>(ctx, STREAMING_CHANNELS.stop)
    const stoppedWithinOneSecond = await Promise.race([
      stopPromise.then(() => true),
      new Promise<boolean>((resolveTimeout) => {
        const timer = setTimeout(() => resolveTimeout(false), 1_000)
        timer.unref()
      })
    ])
    expect(stoppedWithinOneSecond).toBe(true)
    await closed
    await expect(httpRequest(documentUrl)).rejects.toThrow()
  })

  it('aborts a partial authentication request instead of hanging shutdown', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, { layoutId: 'race' })
    const document = await httpRequest(localDocumentUrl(started))
    const cookie = sessionCookie(document)
    const socket = connect(started.port, '127.0.0.1')
    await new Promise<void>((resolveConnected, rejectConnected) => {
      socket.once('connect', resolveConnected)
      socket.once('error', rejectConnected)
    })
    const closed = new Promise<void>((resolveClosed) => socket.once('close', () => resolveClosed()))
    socket.write(
      'POST /auth/session HTTP/1.1\r\n' +
      `Host: 127.0.0.1:${started.port}\r\n` +
      `Cookie: ${cookie}\r\n` +
      'Content-Type: application/json\r\n' +
      'Content-Length: 100\r\n' +
      'Connection: keep-alive\r\n\r\n' +
      '{'
    )

    const stopPromise = invoke<StreamingStatus>(ctx, STREAMING_CHANNELS.stop)
    const stoppedWithinOneSecond = await Promise.race([
      stopPromise.then(() => true),
      new Promise<boolean>((resolveTimeout) => {
        const timer = setTimeout(() => resolveTimeout(false), 1_000)
        timer.unref()
      })
    ])
    expect(stoppedWithinOneSecond).toBe(true)
    await closed
  })

  it('evicts only bootstrap sessions at capacity and preserves authenticated viewers', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      accessMode: 'lan',
      password: 'capacity-password',
      layoutId: 'race'
    })
    const documentUrl = localDocumentUrl(started)
    const baseUrl = new URL('../', documentUrl)
    const initialDocument = await httpRequest(documentUrl)
    let authenticatedCookie = sessionCookie(initialDocument)
    const authenticated = await httpRequest(new URL('auth/session', baseUrl).toString(), {
      method: 'POST',
      headers: { Cookie: authenticatedCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'capacity-password' })
    })
    expect(authenticated.statusCode).toBe(200)
    authenticatedCookie = sessionCookie(authenticated)

    const bootstrapCookies: string[] = []
    for (let index = 0; index < 65; index += 1) {
      const bootstrap = await httpRequest(documentUrl)
      expect(bootstrap.statusCode).toBe(200)
      bootstrapCookies.push(sessionCookie(bootstrap))
    }

    const authenticatedPing = await httpRequest(new URL('ping', baseUrl).toString(), {
      headers: { Cookie: authenticatedCookie }
    })
    expect(authenticatedPing.statusCode).toBe(200)
    expect(JSON.parse(authenticatedPing.body)).toEqual({ passwordRequired: false })

    const evictedBootstrap = await httpRequest(new URL('ping', baseUrl).toString(), {
      headers: { Cookie: bootstrapCookies[0] }
    })
    const newestBootstrap = await httpRequest(new URL('ping', baseUrl).toString(), {
      headers: { Cookie: bootstrapCookies.at(-1)! }
    })
    expect(evictedBootstrap.statusCode).toBe(403)
    expect(newestBootstrap.statusCode).toBe(200)
    expect(JSON.parse(newestBootstrap.body)).toEqual({ passwordRequired: true })
  })

  it('rejects new local authenticated sessions at capacity without evicting existing viewers', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, { layoutId: 'race' })
    const documentUrl = localDocumentUrl(started)
    const baseUrl = new URL('../', documentUrl)
    const authenticatedCookies: string[] = []

    for (let index = 0; index < 64; index += 1) {
      const document = await httpRequest(documentUrl)
      expect(document.statusCode).toBe(200)
      authenticatedCookies.push(sessionCookie(document))
    }
    const overCapacity = await httpRequest(documentUrl)
    expect(overCapacity.statusCode).toBe(503)

    const existingViewer = await httpRequest(new URL('ping', baseUrl).toString(), {
      headers: { Cookie: authenticatedCookies[0] }
    })
    expect(existingViewer.statusCode).toBe(200)
    expect(JSON.parse(existingViewer.body)).toEqual({ passwordRequired: false })
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

  it('discovers inline modules when the script end tag contains whitespace', async () => {
    process.env.ULTIMATE_SIM_STREAM_RENDERER_DIR = resolve(fixtureRoot, 'stream-renderer-inline-whitespace')
    ctx = fakeContext()
    register(ctx)
    await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, { layoutId: 'race' })

    const result = await invoke<StreamingSelfTestResult>(ctx, STREAMING_CHANNELS.selfTest)
    expect(result.reachable).toBe(false)
    expect(result.stage).toBe('assets')
    expect(result.statusCode).toBe(404)
    expect(result.message).toContain('missing.js')
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
    const payload = JSON.parse(panel.body) as StreamingTouchPanelPayload
    expect(payload.panel.id).toBe('pit')
    expect(payload.interaction.interactive).toBe(true)
    expect(payload.interaction.role).toBe('touch-controller')
    expect(payload.interaction.capabilities.length).toBeGreaterThan(0)
    expect(dashboard.statusCode).toBe(404)
    expect(managerState.requestedPanels).toContain('pit')
  })

  it('requires token plus password before issuing an origin-bound interactive Touch session', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'touch',
      layoutId: 'pit',
      accessMode: 'lan',
      password: 'touch-password'
    })
    const documentUrl = localDocumentUrl(started)
    const invalidTokenUrl = new URL(documentUrl)
    invalidTokenUrl.searchParams.set('token', 'wrong-token')
    expect((await httpRequest(invalidTokenUrl.toString())).statusCode).toBe(403)

    const document = await httpRequest(documentUrl)
    let cookie = sessionCookie(document)
    const baseUrl = new URL('../', documentUrl)
    const panelUrl = new URL('api/touch/panel/pit', baseUrl).toString()
    expect((await httpRequest(panelUrl, { headers: { Cookie: cookie } })).statusCode).toBe(403)

    const wrongPassword = await httpRequest(new URL('auth/session', baseUrl).toString(), {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' })
    })
    expect(wrongPassword.statusCode).toBe(403)
    const authenticated = await httpRequest(new URL('auth/session', baseUrl).toString(), {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'touch-password' })
    })
    expect(authenticated.statusCode).toBe(200)
    cookie = sessionCookie(authenticated)

    const panel = await httpRequest(panelUrl, { headers: { Cookie: cookie } })
    const payload = JSON.parse(panel.body) as StreamingTouchPanelPayload
    expect(payload.interaction.role).toBe('touch-controller')
    expect(payload.interaction.csrfToken).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(payload.interaction.nonce).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(JSON.stringify(payload.panel)).not.toContain('"keys":["V"]')
    expect(JSON.stringify(payload.panel)).not.toContain('"keys":["H"]')
    expect(JSON.stringify(payload.panel)).not.toContain('dash:cycleNext')

    const session: TouchSessionFixture = {
      documentUrl,
      baseUrl,
      cookie,
      origin: new URL(documentUrl).origin,
      payload
    }
    const capability = touchCapability(session, 'pit-fuel', 'main', 'trigger')
    expect((await postTouchAction(session, { capabilityId: capability.id, phase: 'trigger', origin: null })).statusCode).toBe(403)
    expect((await postTouchAction(session, { capabilityId: capability.id, phase: 'trigger', csrf: null })).statusCode).toBe(403)
    const accepted = await postTouchAction(session, { capabilityId: capability.id, phase: 'trigger' })
    expect(accepted.statusCode).toBe(200)
    expect((JSON.parse(accepted.body) as StreamingTouchActionResponse).ok).toBe(true)
    expect(managerState.semanticCalls).toHaveLength(1)
  })

  it('rejects wrong targets, dashboard roles, and unknown capabilities', async () => {
    ctx = fakeContext()
    register(ctx)
    const dashboardStarted = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'dashboard',
      layoutId: 'race'
    })
    const dashboardDocument = await httpRequest(localDocumentUrl(dashboardStarted))
    const dashboardCookie = sessionCookie(dashboardDocument)
    const dashboardBase = new URL('../', localDocumentUrl(dashboardStarted))
    const dashboardAction = await httpRequest(new URL('api/touch/action/pit', dashboardBase).toString(), {
      method: 'POST',
      headers: {
        Cookie: dashboardCookie,
        Origin: new URL(localDocumentUrl(dashboardStarted)).origin,
        'Content-Type': 'application/json',
        'X-Stream-CSRF': 'not-issued-to-dashboard'
      },
      body: JSON.stringify({
        targetId: 'pit',
        capabilityId: 'aaaaaaaaaaaaaaaa',
        phase: 'trigger',
        nonce: 'bbbbbbbbbbbbbbbb'
      })
    })
    expect(dashboardAction.statusCode).toBe(403)

    const touchStarted = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'touch',
      layoutId: 'pit'
    })
    const session = await openTouchSession(touchStarted)
    const capability = touchCapability(session, 'pit-fuel', 'main', 'trigger')
    expect((await postTouchAction(session, {
      capabilityId: capability.id,
      phase: 'trigger',
      routeTarget: 'wrong-target',
      bodyTarget: 'wrong-target'
    })).statusCode).toBe(403)
    expect((await postTouchAction(session, {
      capabilityId: capability.id,
      phase: 'trigger',
      bodyTarget: 'wrong-target'
    })).statusCode).toBe(400)
    expect((await postTouchAction(session, {
      capabilityId: 'unknown-capability-id',
      phase: 'trigger'
    })).statusCode).toBe(403)
    expect(managerState.semanticCalls).toHaveLength(0)
  })

  it('consumes each interaction nonce exactly once', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'touch',
      layoutId: 'pit'
    })
    const session = await openTouchSession(started)
    const capability = touchCapability(session, 'pit-fuel', 'main', 'trigger')
    const nonce = session.payload.interaction.nonce

    const first = await postTouchAction(session, { capabilityId: capability.id, phase: 'trigger', nonce })
    const replay = await postTouchAction(session, { capabilityId: capability.id, phase: 'trigger', nonce })
    expect(first.statusCode).toBe(200)
    expect(replay.statusCode).toBe(409)
    expect((JSON.parse(replay.body) as StreamingTouchActionResponse).message).toMatch(/replay|stale/i)
    expect(managerState.semanticCalls).toHaveLength(1)
  })

  it('keeps end, cancel, and off idempotent across stale multi-tab nonces and lost responses', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'touch',
      layoutId: 'pit'
    })
    const session = await openTouchSession(started)
    const hold = touchCapability(session, 'radio-hold', 'main', 'begin')
    const end = touchCapability(session, 'radio-hold', 'main', 'end')
    const cancel = touchCapability(session, 'radio-hold', 'main', 'cancel')
    const toggleOn = touchCapability(session, 'lights-toggle', 'on', 'trigger')
    const toggleOff = touchCapability(session, 'lights-toggle', 'off', 'trigger')

    const firstTabNonce = session.payload.interaction.nonce
    const begun = await postTouchAction(session, {
      capabilityId: hold.id,
      phase: 'begin',
      nonce: firstTabNonce
    })
    expect(begun.statusCode).toBe(200)
    const endAfterLostResponse = await postTouchAction(session, {
      capabilityId: end.id,
      phase: 'end',
      nonce: firstTabNonce
    })
    const repeatedEnd = await postTouchAction(session, {
      capabilityId: end.id,
      phase: 'end',
      nonce: firstTabNonce
    })
    expect(endAfterLostResponse.statusCode).toBe(200)
    expect(repeatedEnd.statusCode).toBe(200)
    expect((JSON.parse(repeatedEnd.body) as StreamingTouchActionResponse).activeControls).toBe(0)

    const currentNonce = (JSON.parse(endAfterLostResponse.body) as StreamingTouchActionResponse).nextNonce
    const begunForCancel = await postTouchAction(session, {
      capabilityId: hold.id,
      phase: 'begin',
      nonce: currentNonce
    })
    expect(begunForCancel.statusCode).toBe(200)
    const canceled = await postTouchAction(session, {
      capabilityId: cancel.id,
      phase: 'cancel',
      nonce: currentNonce
    })
    const repeatedCancel = await postTouchAction(session, {
      capabilityId: cancel.id,
      phase: 'cancel',
      nonce: currentNonce
    })
    expect(canceled.statusCode).toBe(200)
    expect(repeatedCancel.statusCode).toBe(200)

    const toggleNonce = (JSON.parse(canceled.body) as StreamingTouchActionResponse).nextNonce
    const toggledOn = await postTouchAction(session, {
      capabilityId: toggleOn.id,
      phase: 'trigger',
      nonce: toggleNonce
    })
    expect(toggledOn.statusCode).toBe(200)
    const toggledOff = await postTouchAction(session, {
      capabilityId: toggleOff.id,
      phase: 'trigger',
      nonce: toggleNonce
    })
    const repeatedOff = await postTouchAction(session, {
      capabilityId: toggleOff.id,
      phase: 'trigger',
      nonce: toggleNonce
    })
    expect(toggledOff.statusCode).toBe(200)
    expect(repeatedOff.statusCode).toBe(200)
    expect((JSON.parse(repeatedOff.body) as StreamingTouchActionResponse).activeControls).toBe(0)
    expect(managerState.semanticCalls.map(({ request }) => request.phase)).toEqual([
      'begin',
      'end',
      'begin',
      'cancel',
      'trigger',
      'trigger'
    ])
  })

  it('supports press/release, hold, toggle, and rotary semantics through server-owned capabilities', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'touch',
      layoutId: 'pit'
    })
    const session = await openTouchSession(started)
    const send = async (
      controlId: string,
      zone: string,
      phase: TouchActionPhase
    ): Promise<StreamingTouchActionResponse> => {
      const capability = touchCapability(session, controlId, zone, phase)
      const response = await postTouchAction(session, { capabilityId: capability.id, phase })
      expect(response.statusCode).toBe(200)
      const payload = JSON.parse(response.body) as StreamingTouchActionResponse
      session.payload.interaction.nonce = payload.nextNonce
      return payload
    }

    await send('pit-fuel', 'main', 'trigger')
    await send('pit-fuel', 'main', 'end')
    expect(managerState.semanticCalls).toHaveLength(1)

    expect((await send('radio-hold', 'main', 'begin')).activeControls).toBe(1)
    expect((await send('radio-hold', 'main', 'end')).activeControls).toBe(0)
    expect((await send('lights-toggle', 'on', 'trigger')).activeControls).toBe(1)
    expect((await send('lights-toggle', 'off', 'trigger')).activeControls).toBe(0)
    await send('bias-rotary', 'increment', 'trigger')

    expect(managerState.semanticCalls.map(({ request }) => ({
      kind: request.action.kind,
      phase: request.phase,
      zone: request.zone
    }))).toEqual([
      { kind: 'iracing', phase: 'trigger', zone: 'main' },
      { kind: 'keyboard', phase: 'begin', zone: 'main' },
      { kind: 'keyboard', phase: 'end', zone: 'main' },
      { kind: 'keyboard', phase: 'trigger', zone: 'on' },
      { kind: 'keyboard', phase: 'trigger', zone: 'off' },
      { kind: 'iracing', phase: 'trigger', zone: 'increment' }
    ])
  })

  it('tracks arbitrary latching ON/OFF actions and executes configured OFF exactly once', async () => {
    const cases: Array<{ label: string; onAction: ButtonAction; offAction: ButtonAction }> = [
      {
        label: 'iRacing',
        onAction: { kind: 'iracing', command: { group: 'blackBox', name: 'blackBox:next' } },
        offAction: { kind: 'iracing', command: { group: 'blackBox', name: 'blackBox:previous' } }
      },
      {
        label: 'keyboard press',
        onAction: { kind: 'keyboard', command: { mode: 'press', keys: ['P'] } },
        offAction: { kind: 'keyboard', command: { mode: 'press', keys: ['O'] } }
      },
      {
        label: 'mixed',
        onAction: { kind: 'iracing', command: { group: 'blackBox', name: 'blackBox:next' } },
        offAction: { kind: 'keyboard', command: { mode: 'press', keys: ['O'] } }
      }
    ]

    for (const testCase of cases) {
      const lights = managerState.panel.buttons.find((button) => button.id === 'lights-toggle')
      if (!lights || lights.control.kind !== 'latching-toggle') throw new Error('lights fixture missing')
      lights.control.onAction = testCase.onAction
      lights.control.offAction = testCase.offAction
      ctx ??= fakeContext()
      if (!ctx.handlers.has(STREAMING_CHANNELS.start)) register(ctx)
      const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
        layoutKind: 'touch',
        layoutId: 'pit'
      })
      managerState.semanticCalls.length = 0
      const session = await openTouchSession(started)
      const on = touchCapability(session, 'lights-toggle', 'on', 'trigger')
      const off = touchCapability(session, 'lights-toggle', 'off', 'trigger')
      const staleNonce = session.payload.interaction.nonce

      const enabled = await postTouchAction(session, {
        capabilityId: on.id,
        phase: 'trigger',
        nonce: staleNonce
      })
      expect(enabled.statusCode, testCase.label).toBe(200)
      expect((JSON.parse(enabled.body) as StreamingTouchActionResponse).activeControls).toBe(1)
      const disabled = await postTouchAction(session, {
        capabilityId: off.id,
        phase: 'trigger',
        nonce: staleNonce
      })
      const repeated = await postTouchAction(session, {
        capabilityId: off.id,
        phase: 'trigger',
        nonce: staleNonce
      })

      expect(disabled.statusCode, testCase.label).toBe(200)
      expect(repeated.statusCode, testCase.label).toBe(200)
      expect((JSON.parse(repeated.body) as StreamingTouchActionResponse).activeControls).toBe(0)
      expect(managerState.semanticCalls.map(({ request }) => request.action)).toEqual([
        testCase.onAction,
        testCase.offAction
      ])
    }
  })

  it('derives trigger-only capabilities for discrete latch and selector keyboard holds', async () => {
    const lights = managerState.panel.buttons.find((button) => button.id === 'lights-toggle')
    if (!lights || lights.control.kind !== 'latching-toggle') throw new Error('lights fixture missing')
    const latchHold: ButtonAction = {
      kind: 'keyboard',
      command: { mode: 'hold', keys: ['H'] }
    }
    const latchOff: ButtonAction = {
      kind: 'keyboard',
      command: { mode: 'press', keys: ['O'] }
    }
    lights.control.onAction = latchHold
    lights.control.offAction = latchOff
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'touch',
      layoutId: 'pit'
    })
    const session = await openTouchSession(started)
    const latchOn = touchCapability(session, 'lights-toggle', 'on', 'trigger')
    const latchOffCapability = touchCapability(session, 'lights-toggle', 'off', 'trigger')
    const selector = touchCapability(session, 'mode-selector', 'choice:hold-mode', 'trigger')
    expect(latchOn.phases).toEqual(['trigger'])
    expect(selector.phases).toEqual(['trigger'])

    for (const phase of ['begin', 'end', 'cancel'] as const) {
      expect((await postTouchAction(session, {
        capabilityId: latchOn.id,
        phase
      })).statusCode).toBe(403)
      expect((await postTouchAction(session, {
        capabilityId: selector.id,
        phase
      })).statusCode).toBe(403)
    }
    expect(managerState.semanticCalls).toHaveLength(0)

    const staleNonce = session.payload.interaction.nonce
    const enabled = await postTouchAction(session, {
      capabilityId: latchOn.id,
      phase: 'trigger',
      nonce: staleNonce
    })
    expect(enabled.statusCode).toBe(200)
    const disabled = await postTouchAction(session, {
      capabilityId: latchOffCapability.id,
      phase: 'trigger',
      nonce: staleNonce
    })
    expect(disabled.statusCode).toBe(200)
    expect((await postTouchAction(session, {
      capabilityId: latchOffCapability.id,
      phase: 'trigger',
      nonce: staleNonce
    })).statusCode).toBe(200)
    session.payload.interaction.nonce =
      (JSON.parse(disabled.body) as StreamingTouchActionResponse).nextNonce
    expect((await postTouchAction(session, {
      capabilityId: selector.id,
      phase: 'trigger'
    })).statusCode).toBe(200)

    expect(managerState.semanticCalls.map(({ request }) => ({
      action: request.action,
      phase: request.phase,
      zone: request.zone
    }))).toEqual([
      { action: latchHold, phase: 'trigger', zone: 'on' },
      { action: latchOff, phase: 'trigger', zone: 'off' },
      {
        action: { kind: 'keyboard', command: { mode: 'hold', keys: ['M'] } },
        phase: 'trigger',
        zone: 'choice:hold-mode'
      }
    ])
  })

  it('releases mixed keyboard-toggle ON before logical OFF and keeps repeated cleanup idempotent', async () => {
    const lights = managerState.panel.buttons.find((button) => button.id === 'lights-toggle')
    if (!lights || lights.control.kind !== 'latching-toggle') throw new Error('lights fixture missing')
    const onAction: ButtonAction = {
      kind: 'keyboard',
      command: { mode: 'toggle', keys: ['H'] }
    }
    const offAction: ButtonAction = {
      kind: 'keyboard',
      command: { mode: 'press', keys: ['O'] }
    }
    lights.control.onAction = onAction
    lights.control.offAction = offAction
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'touch',
      layoutId: 'pit'
    })
    const session = await openTouchSession(started)
    const on = touchCapability(session, 'lights-toggle', 'on', 'trigger')
    const teardown = touchCapability(session, 'lights-toggle', 'teardown', 'cancel')
    const off = touchCapability(session, 'lights-toggle', 'off', 'trigger')
    const staleNonce = session.payload.interaction.nonce

    const enabled = await postTouchAction(session, {
      capabilityId: on.id,
      phase: 'trigger',
      nonce: staleNonce
    })
    expect(enabled.statusCode).toBe(200)
    expect((JSON.parse(enabled.body) as StreamingTouchActionResponse).activeControls).toBe(1)
    const cleaned = await postTouchAction(session, {
      capabilityId: teardown.id,
      phase: 'cancel',
      nonce: staleNonce
    })
    expect(cleaned.statusCode).toBe(200)
    expect((JSON.parse(cleaned.body) as StreamingTouchActionResponse).activeControls).toBe(0)
    expect((await postTouchAction(session, {
      capabilityId: off.id,
      phase: 'trigger',
      nonce: staleNonce
    })).statusCode).toBe(200)
    expect((await postTouchAction(session, {
      capabilityId: teardown.id,
      phase: 'cancel',
      nonce: staleNonce
    })).statusCode).toBe(200)

    expect(managerState.semanticCalls.map(({ request }) => ({
      action: request.action,
      phase: request.phase,
      zone: request.zone
    }))).toEqual([
      { action: onAction, phase: 'trigger', zone: 'on' },
      { action: onAction, phase: 'cancel', zone: 'teardown' },
      { action: offAction, phase: 'trigger', zone: 'off' }
    ])
  })

  it('rate-limits a valid control flood without accepting receiver-supplied actions', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'touch',
      layoutId: 'pit'
    })
    const session = await openTouchSession(started)
    const capability = touchCapability(session, 'pit-fuel', 'main', 'trigger')
    let limited: ResponseData | null = null

    for (let index = 0; index <= 30; index += 1) {
      const response = await postTouchAction(session, {
        capabilityId: capability.id,
        phase: 'trigger'
      })
      if (response.statusCode === 429) {
        limited = response
        break
      }
      expect(response.statusCode).toBe(200)
      session.payload.interaction.nonce = (JSON.parse(response.body) as StreamingTouchActionResponse).nextNonce
    }

    expect(limited?.statusCode).toBe(429)
    expect(managerState.semanticCalls).toHaveLength(30)
    const injected = await postTouchAction(session, {
      capabilityId: capability.id,
      phase: 'trigger',
      extra: {
        action: { kind: 'keyboard', command: { mode: 'press', keys: ['Meta', 'R'] } }
      }
    })
    expect(injected.statusCode).toBe(400)
  })

  it('never rate-limits cleanup for an already-held control', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'touch',
      layoutId: 'pit'
    })
    const session = await openTouchSession(started)
    const hold = touchCapability(session, 'radio-hold', 'main', 'begin')
    const end = touchCapability(session, 'radio-hold', 'main', 'end')
    const originalNonce = session.payload.interaction.nonce
    const begun = await postTouchAction(session, {
      capabilityId: hold.id,
      phase: 'begin',
      nonce: originalNonce
    })
    expect(begun.statusCode).toBe(200)
    session.payload.interaction.nonce = (JSON.parse(begun.body) as StreamingTouchActionResponse).nextNonce

    const press = touchCapability(session, 'pit-fuel', 'main', 'trigger')
    let limited = false
    for (let index = 0; index < 80; index += 1) {
      const response = await postTouchAction(session, { capabilityId: press.id, phase: 'trigger' })
      if (response.statusCode === 429) {
        limited = true
        break
      }
      expect(response.statusCode).toBe(200)
      session.payload.interaction.nonce = (JSON.parse(response.body) as StreamingTouchActionResponse).nextNonce
    }
    expect(limited).toBe(true)

    const released = await postTouchAction(session, {
      capabilityId: end.id,
      phase: 'end',
      nonce: originalNonce
    })
    expect(released.statusCode).toBe(200)
    expect((JSON.parse(released.body) as StreamingTouchActionResponse).activeControls).toBe(0)
    expect(managerState.semanticCalls.at(-1)?.request.phase).toBe('end')
  })

  it('expires short remote sessions, closes their SSE clients, and releases held controls', async () => {
    process.env.ULTIMATE_SIM_STREAM_SESSION_TTL_MS = '1500'
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'touch',
      layoutId: 'pit',
      accessMode: 'lan',
      password: 'short-lived'
    })
    const session = await openTouchSession(started, 'short-lived')
    const receiver = await openSseReceiver(new URL('sse', session.baseUrl).toString(), session.cookie)
    const hold = touchCapability(session, 'radio-hold', 'main', 'begin')
    const begun = await postTouchAction(session, { capabilityId: hold.id, phase: 'begin' })
    expect(begun.statusCode).toBe(200)
    session.payload.interaction.nonce = (JSON.parse(begun.body) as StreamingTouchActionResponse).nextNonce

    await new Promise((resolveWait) => setTimeout(resolveWait, 1_600))
    await receiver.closed
    const stale = await postTouchAction(session, {
      capabilityId: hold.id,
      phase: 'end'
    })
    expect(stale.statusCode).toBe(403)
    await vi.waitFor(() => expect(managerState.releasedOwners).toHaveLength(1))
    expect(managerState.releasedOwners[0]).toMatch(/^stream-session-/)
    expect((await invoke<StreamingStatus>(ctx, STREAMING_CHANNELS.status)).clients).toBe(0)
  })

  it('keeps cleanup capability after the streamed panel is edited or deleted', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'touch',
      layoutId: 'pit'
    })
    const session = await openTouchSession(started)
    const hold = touchCapability(session, 'radio-hold', 'main', 'begin')
    const end = touchCapability(session, 'radio-hold', 'main', 'end')
    const cancel = touchCapability(session, 'radio-hold', 'main', 'cancel')

    const editNonce = session.payload.interaction.nonce
    const begunBeforeEdit = await postTouchAction(session, {
      capabilityId: hold.id,
      phase: 'begin',
      nonce: editNonce
    })
    expect(begunBeforeEdit.statusCode).toBe(200)
    const radio = managerState.panel.buttons.find((button) => button.id === 'radio-hold')
    if (!radio || radio.control.kind !== 'momentary') throw new Error('radio fixture missing')
    radio.control.action = { kind: 'keyboard', command: { mode: 'hold', keys: ['B'] } }

    const endedAfterEdit = await postTouchAction(session, {
      capabilityId: end.id,
      phase: 'end',
      nonce: editNonce
    })
    expect(endedAfterEdit.statusCode).toBe(200)
    expect(managerState.semanticCalls.at(-1)?.request).toMatchObject({
      action: { kind: 'keyboard', command: { mode: 'hold', keys: ['V'] } },
      phase: 'end'
    })

    radio.control.action = { kind: 'keyboard', command: { mode: 'hold', keys: ['V'] } }
    const deleteNonce = (JSON.parse(endedAfterEdit.body) as StreamingTouchActionResponse).nextNonce
    const begunBeforeDelete = await postTouchAction(session, {
      capabilityId: hold.id,
      phase: 'begin',
      nonce: deleteNonce
    })
    expect(begunBeforeDelete.statusCode).toBe(200)
    managerState.panelAvailable = false
    const canceledAfterDelete = await postTouchAction(session, {
      capabilityId: cancel.id,
      phase: 'cancel',
      nonce: deleteNonce
    })
    expect(canceledAfterDelete.statusCode).toBe(200)
    expect((JSON.parse(canceledAfterDelete.body) as StreamingTouchActionResponse).activeControls).toBe(0)
    expect(managerState.semanticCalls.at(-1)?.request.phase).toBe('cancel')
  })

  it('requires a live receiver lease and allows the heartbeat to restore interaction', async () => {
    process.env.ULTIMATE_SIM_STREAM_RECEIVER_LEASE_MS = '100'
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'touch',
      layoutId: 'pit'
    })
    const session = await openTouchSession(started)
    const hold = touchCapability(session, 'radio-hold', 'main', 'begin')
    const begun = await postTouchAction(session, { capabilityId: hold.id, phase: 'begin' })
    expect(begun.statusCode).toBe(200)
    session.payload.interaction.nonce = (JSON.parse(begun.body) as StreamingTouchActionResponse).nextNonce

    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
    await vi.waitFor(() => expect(managerState.releasedOwners).toHaveLength(1))
    const press = touchCapability(session, 'pit-fuel', 'main', 'trigger')
    const expired = await postTouchAction(session, { capabilityId: press.id, phase: 'trigger' })
    expect(expired.statusCode).toBe(409)
    expect((JSON.parse(expired.body) as StreamingTouchActionResponse).message).toMatch(/lease expired/i)

    const unauthenticatedHeartbeat = await httpRequest(
      new URL('api/touch/health/pit', session.baseUrl).toString(),
      { headers: { Cookie: session.cookie } }
    )
    expect(unauthenticatedHeartbeat.statusCode).toBe(403)
    const heartbeat = await touchHealth(session)
    expect(heartbeat.statusCode).toBe(200)
    const healthPayload = JSON.parse(heartbeat.body)
    expect(healthPayload.leaseExpiresAt).toBeGreaterThan(Date.now())
    const restored = await postTouchAction(session, { capabilityId: press.id, phase: 'trigger' })
    expect(restored.statusCode).toBe(200)
  })

  it('keeps ownership while another tab remains connected and releases after the last disconnect', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'touch',
      layoutId: 'pit'
    })
    const session = await openTouchSession(started)
    const firstReceiver = await openSseReceiver(new URL('sse', session.baseUrl).toString(), session.cookie)
    const secondReceiver = await openSseReceiver(new URL('sse', session.baseUrl).toString(), session.cookie)
    const hold = touchCapability(session, 'radio-hold', 'main', 'begin')
    expect((await postTouchAction(session, { capabilityId: hold.id, phase: 'begin' })).statusCode).toBe(200)

    firstReceiver.close()
    await firstReceiver.closed
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    expect(managerState.releasedOwners).toHaveLength(0)

    secondReceiver.close()
    await secondReceiver.closed
    await vi.waitFor(() => expect(managerState.releasedOwners).toHaveLength(1))
  })

  it('waits for an in-flight owner registration before stream teardown releases it', async () => {
    await unregisterTouchRuntime?.()
    let finishExecution!: () => void
    const executionGate = new Promise<void>((resolve) => { finishExecution = resolve })
    unregisterTouchRuntime = registerTouchSemanticActionRuntime({
      execute: async (request, ownerKey) => {
        managerState.semanticCalls.push({ request, ownerKey })
        await executionGate
        return { ok: true, message: 'held' }
      },
      releaseOwner: async (ownerKey) => {
        managerState.releasedOwners.push(ownerKey)
      }
    })
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'touch',
      layoutId: 'pit'
    })
    const session = await openTouchSession(started)
    const hold = touchCapability(session, 'radio-hold', 'main', 'begin')
    const action = postTouchAction(session, { capabilityId: hold.id, phase: 'begin' })
    await vi.waitFor(() => expect(managerState.semanticCalls).toHaveLength(1))

    let stopped = false
    const stopping = Promise.resolve(ctx.teardownTasks[0].task()).then(() => {
      stopped = true
    })
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    expect(stopped).toBe(false)
    expect(managerState.releasedOwners).toHaveLength(1)

    finishExecution()
    expect((await action).statusCode).toBe(200)
    await stopping
    expect(managerState.releasedOwners).toHaveLength(1)
  })

  it('revokes admission synchronously and drains active plus heartbeat-only sessions before stop completes', async () => {
    await unregisterTouchRuntime?.()
    let finishExecution!: () => void
    const executionGate = new Promise<void>((resolve) => { finishExecution = resolve })
    const offAction: ButtonAction = {
      kind: 'keyboard',
      command: { mode: 'press', keys: ['O'] }
    }
    unregisterTouchRuntime = registerTouchSemanticActionRuntime({
      execute: async (request, ownerKey) => {
        managerState.semanticCalls.push({ request, ownerKey })
        if (request.token === 'radio-hold:main' && request.phase === 'begin') {
          await executionGate
        }
        return { ok: true, message: `${request.token} ${request.phase} executed.` }
      },
      releaseOwner: async (ownerKey) => {
        managerState.releasedOwners.push(ownerKey)
      }
    })
    const lights = managerState.panel.buttons.find((button) => button.id === 'lights-toggle')
    if (!lights || lights.control.kind !== 'latching-toggle') throw new Error('lights fixture missing')
    lights.control.onAction = {
      kind: 'iracing',
      command: { group: 'blackBox', name: 'blackBox:next' }
    }
    lights.control.offAction = offAction

    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'touch',
      layoutId: 'pit'
    })
    const activeSession = await openTouchSession(started)
    const heartbeatOnlySession = await openTouchSession(started)
    expect((await touchHealth(heartbeatOnlySession)).statusCode).toBe(200)

    const on = touchCapability(activeSession, 'lights-toggle', 'on', 'trigger')
    const enabled = await postTouchAction(activeSession, { capabilityId: on.id, phase: 'trigger' })
    expect(enabled.statusCode).toBe(200)
    activeSession.payload.interaction.nonce =
      (JSON.parse(enabled.body) as StreamingTouchActionResponse).nextNonce
    const hold = touchCapability(activeSession, 'radio-hold', 'main', 'begin')
    const inFlightAction = postTouchAction(activeSession, { capabilityId: hold.id, phase: 'begin' })
    await vi.waitFor(() => expect(managerState.semanticCalls.some(({ request }) =>
      request.token === 'radio-hold:main' && request.phase === 'begin'
    )).toBe(true))

    let stopped = false
    const stopping = Promise.resolve(ctx.teardownTasks[0].task()).then(() => {
      stopped = true
    })
    const press = touchCapability(activeSession, 'pit-fuel', 'main', 'trigger')
    const admissionAttempts = Promise.all([
      requestOutcome(httpRequest(localDocumentUrl(started))),
      requestOutcome(postTouchAction(activeSession, { capabilityId: press.id, phase: 'trigger' })),
      requestOutcome(touchHealth(heartbeatOnlySession))
    ])
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    expect(stopped).toBe(false)

    finishExecution()
    await requestOutcome(inFlightAction)
    await stopping
    expect((await admissionAttempts).every((outcome) => outcome === 503 || outcome === 'closed')).toBe(true)
    const offCalls = managerState.semanticCalls.filter(({ request }) =>
      JSON.stringify(request.action) === JSON.stringify(offAction)
    )
    expect(offCalls).toHaveLength(1)
    expect(offCalls[0].request.phase).toBe('trigger')
    expect(new Set(managerState.releasedOwners).size).toBe(2)
    const stoppedStatus = await invoke<StreamingStatus>(ctx, STREAMING_CHANNELS.status)
    expect(stoppedStatus.running).toBe(false)
    expect(stoppedStatus.clients).toBe(0)
  })

  it('releases held controls when the receiver disconnects', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'touch',
      layoutId: 'pit'
    })
    const session = await openTouchSession(started)
    const hold = touchCapability(session, 'radio-hold', 'main', 'begin')
    const begun = await postTouchAction(session, { capabilityId: hold.id, phase: 'begin' })
    expect(begun.statusCode).toBe(200)
    expect((JSON.parse(begun.body) as StreamingTouchActionResponse).activeControls).toBe(1)

    await sseHandshake(new URL('sse', session.baseUrl).toString(), session.cookie)
    await vi.waitFor(() => expect(managerState.releasedOwners).toHaveLength(1))
    const health = await touchHealth(session)
    expect(health.statusCode).toBe(200)
    expect(JSON.parse(health.body).activeControls).toBe(0)
  })

  it('omits forbidden app/dashboard mutations from the per-control allowlist', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'touch',
      layoutId: 'pit'
    })
    const session = await openTouchSession(started)
    const forbidden = session.payload.panel.buttons.find((button) => button.id === 'forbidden-dashboard')
    expect(forbidden?.state?.disabled).toBe(true)
    expect(forbidden?.control.kind).toBe('momentary')
    if (forbidden?.control.kind === 'momentary') expect(forbidden.control.action.kind).toBe('none')
    expect(session.payload.interaction.capabilities.some((capability) =>
      capability.controlId === 'forbidden-dashboard'
    )).toBe(false)
    expect(managerState.semanticCalls).toHaveLength(0)
  })

  it('enables the same capability protocol in local mode without a password', async () => {
    ctx = fakeContext()
    register(ctx)
    const started = await invoke<StreamingStartResult>(ctx, STREAMING_CHANNELS.start, {
      layoutKind: 'touch',
      layoutId: 'pit',
      accessMode: 'local'
    })
    expect(started.password).toBeNull()
    const session = await openTouchSession(started)
    expect(session.payload.interaction.interactive).toBe(true)
    expect(session.payload.interaction.health).toBe('ready')
    const rotary = touchCapability(session, 'bias-rotary', 'increment', 'trigger')
    const response = await postTouchAction(session, { capabilityId: rotary.id, phase: 'trigger' })
    expect(response.statusCode).toBe(200)
    expect(managerState.semanticCalls[0]?.request.action).toEqual({
      kind: 'iracing',
      command: { group: 'blackBox', name: 'blackBox:next' }
    })
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

  it('keeps the obs-local certification profile loopback-only and dashboard-only', async () => {
    ctx = fakeContext()
    register(ctx)

    await expect(startStreaming(ctx, {
      profile: 'obs-local',
      layoutKind: 'touch',
      layoutId: 'pit',
      touchPanelId: 'pit'
    })).rejects.toThrow(/read-only dashboards only/i)

    await expect(startStreaming(ctx, {
      profile: 'obs-local',
      layoutId: 'race',
      accessMode: 'lan'
    })).rejects.toThrow(/loopback-only/i)

    await expect(startStreaming(ctx, {
      profile: 'obs-local',
      layoutId: 'race',
      publicBaseUrl: 'https://stream.example.test'
    })).rejects.toThrow(/loopback-only/i)

    await expect(startStreaming(ctx, {
      profile: 'obs-local',
      layoutId: 'race',
      password: 'must-not-be-shared'
    })).rejects.toThrow(/shared passwords/i)
  })
})

describe('streaming public endpoint selection', () => {
  it('exposes no Internet URL after a tunnel stops without a manual HTTPS fallback', () => {
    const tunnelUrl = 'https://temporary.trycloudflare.com'
    const stopped = publicBaseUrlAfterTunnelStops(tunnelUrl, tunnelUrl, null)

    expect(stopped).toBeNull()
    expect(resolveStreamingBaseOrigin('internet', stopped, 3210, '192.168.1.20')).toBeNull()
    expect(resolveStreamingBaseOrigin('internet', 'http://192.168.1.20:3210', 3210, '192.168.1.20')).toBeNull()
  })

  it('keeps a manual HTTPS fallback and preserves local/LAN HTTP modes', () => {
    const tunnelUrl = 'https://temporary.trycloudflare.com'
    const manualUrl = 'https://stream.example.test/prefix'
    const stopped = publicBaseUrlAfterTunnelStops(tunnelUrl, tunnelUrl, manualUrl)

    expect(stopped).toBe(manualUrl)
    expect(resolveStreamingBaseOrigin('internet', stopped, 3210, '192.168.1.20')).toBe(manualUrl)
    expect(resolveStreamingBaseOrigin('local', null, 3210, null)).toBe('http://127.0.0.1:3210')
    expect(resolveStreamingBaseOrigin('lan', null, 3210, '192.168.1.20')).toBe('http://192.168.1.20:3210')
  })

  it('keeps local/LAN listeners unchanged and isolates the bundled Internet tunnel on loopback', () => {
    expect(streamingListenHost('local', false)).toBe('127.0.0.1')
    expect(streamingListenHost('lan', false)).toBe('0.0.0.0')
    expect(streamingListenHost('internet', false)).toBe('0.0.0.0')
    expect(streamingListenHost('internet', true)).toBe('127.0.0.1')
    expect(streamingListenHost('internet', true, true)).toBe('0.0.0.0')
    expect(streamingReceiverTransport('local')).toBe('sse')
    expect(streamingReceiverTransport('lan')).toBe('sse')
    expect(streamingReceiverTransport('internet')).toBe('websocket')
  })

  it('requires WebSocket for Auto-tunnel but preserves SSE-only manual HTTPS receivers', async () => {
    const unavailableWebSocket = vi.fn(async () => { throw new Error('upgrade unsupported') })
    const workingSse = vi.fn(async () => undefined)

    await expect(probeStreamingReceiver('websocket', unavailableWebSocket, workingSse))
      .rejects.toThrow(/upgrade unsupported/)
    expect(workingSse).not.toHaveBeenCalled()

    await expect(probeStreamingReceiver('auto', unavailableWebSocket, workingSse))
      .resolves.toBe('sse')
    expect(workingSse).toHaveBeenCalledTimes(1)
  })

  it('bounds queued WebSocket telemetry for stalled Internet receivers', () => {
    expect(isWebSocketBackpressured(1_048_576)).toBe(false)
    expect(isWebSocketBackpressured(1_048_577)).toBe(true)
    expect(isWebSocketBackpressured(Number.POSITIVE_INFINITY)).toBe(true)
    expect(isSseBackpressured(1_048_576)).toBe(false)
    expect(isSseBackpressured(1_048_577)).toBe(true)
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
