// Evidence for audit P0-11: "credentials appear in URLs/logs".
//
// The audit's acceptance criterion is "logs/URLs nunca contêm token/senha". That
// is a BEHAVIOURAL claim, so it is settled here by driving the real streaming
// module with a synthetic credential and asserting on what is actually handed to
// the diagnostic logger — not by reading the source.
//
// Two layers are covered:
//   1. The streaming module must never PASS a stream password or session token to
//      logger.info/warn/error, on the start path, on a failed password exchange,
//      on a successful exchange, or on stop.
//   2. Even if a future change did log one, the shared redactor must strip it —
//      including a token carried in a URL query string, which is the exact shape
//      the shareable OBS/phone link uses.
//
// Every credential here is an obvious synthetic fake.
import { request } from 'node:http'
import type { IncomingHttpHeaders } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STREAMING_CHANNELS, type StreamingStartArgs, type StreamingStartResult } from '../../shared/streaming'
import { redact, scrubSecretString } from '../../shared/logger'
import type { ModuleContext } from '../module-context'

// Obvious fakes. Never a real secret.
const FAKE_STREAM_PASSWORD = 'FAKE-PIT-WALL-PASSWORD-0000'

interface LogCall {
  level: string
  area: string
  message: string
  detail: unknown
}

const logCalls = vi.hoisted(() => [] as LogCall[])

vi.mock('./logger', () => {
  const record =
    (level: string) =>
    (area: string, message: string, detail?: unknown): void => {
      logCalls.push({ level, area, message, detail })
    }
  return {
    logger: { info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug') },
    register: () => undefined
  }
})

vi.mock('./dashboards', () => ({
  getDashboardManager: () => ({
    listOpen: () => [{ id: 'default' }],
    list: () => [{ id: 'default', name: 'Default dashboard', hidden: false }],
    getDashboard: (id: string) => (id === 'default' ? { id, name: 'Default dashboard', elements: [] } : null)
  })
}))

vi.mock('../touchpanel/manager', () => ({
  getTouchPanelManager: () => ({ has: () => false, getPanel: () => null })
}))

vi.mock('./stream-presentation', () => ({
  getStreamPresentationProfileForRuntime: async () => null
}))

vi.mock('./stream-sources', () => ({
  runWithStreamSourceLock: async <T>(operation: () => Promise<T>) => operation(),
  assertStreamSourceAllowedCurrent: async (ref: { kind: string; id: string }) => ({
    ...ref,
    label: ref.id,
    eligible: true,
    reason: null,
    added: true,
    active: false
  }),
  assertStreamSourceAllowed: async (ref: { kind: string; id: string }) => ({
    ...ref,
    label: ref.id,
    eligible: true,
    reason: null,
    added: true,
    active: true
  }),
  broadcastStreamSourceRuntimeChangedCurrent: async () => undefined
}))

const { register } = await import('./streaming')

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__')

interface ResponseData {
  statusCode: number
  body: string
  headers: IncomingHttpHeaders
}

function httpRequest(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<ResponseData> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = request(url, { method: options.method ?? 'GET', headers: options.headers }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => {
        body += chunk
      })
      response.on('end', () =>
        resolvePromise({ statusCode: response.statusCode ?? 0, body, headers: response.headers })
      )
    })
    req.on('error', rejectPromise)
    if (options.body) req.write(options.body)
    req.end()
  })
}

type Handler = (event: unknown, args?: StreamingStartArgs) => unknown

function fakeContext(): ModuleContext & { handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>()
  return {
    handlers,
    app: { once: () => undefined },
    ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
    telemetryHub: { getLatest: () => ({ connected: false }) },
    serialManager: {},
    serialHub: {},
    profileStore: {},
    iracingControl: {},
    getMainWindow: () => null,
    broadcast: () => undefined,
    registerGracefulTeardown: () => () => undefined
  } as unknown as ModuleContext & { handlers: Map<string, Handler> }
}

let ctx: (ModuleContext & { handlers: Map<string, Handler> }) | null = null

async function invoke<T>(channel: string, args?: StreamingStartArgs): Promise<T> {
  const handler = ctx?.handlers.get(channel)
  if (!handler) throw new Error(`missing handler ${channel}`)
  return (await handler({}, args)) as T
}

/** Everything the module handed to the logger, flattened to one searchable blob. */
function loggedText(): string {
  return logCalls.map((call) => `${call.area} ${call.message} ${JSON.stringify(call.detail ?? {})}`).join('\n')
}

beforeEach(() => {
  process.env.ULTIMATE_SIM_STREAM_RENDERER_DIR = resolve(fixtureRoot, 'stream-renderer')
  logCalls.length = 0
})

afterEach(async () => {
  if (ctx) await invoke(STREAMING_CHANNELS.stop).catch(() => undefined)
  ctx = null
  delete process.env.ULTIMATE_SIM_STREAM_RENDERER_DIR
})

describe('streaming credential exposure (audit P0-11)', () => {
  it('never hands the stream password or the session token to the diagnostic logger', async () => {
    ctx = fakeContext()
    register(ctx)

    const started = await invoke<StreamingStartResult>(STREAMING_CHANNELS.start, {
      accessMode: 'lan',
      password: FAKE_STREAM_PASSWORD
    })
    expect(started.token).toBeTruthy()

    const origin = new URL(started.url).origin
    // A wrong password (the flow an attacker drives) and then the right one.
    await httpRequest(`${origin}/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: started.token, password: 'FAKE-WRONG-PASSWORD-0000' })
    })
    await httpRequest(`${origin}/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: started.token, password: FAKE_STREAM_PASSWORD })
    })
    await invoke(STREAMING_CHANNELS.stop)

    // The module logged SOMETHING over this flow, otherwise the assertion below
    // would pass vacuously.
    expect(logCalls.length).toBeGreaterThan(0)

    const text = loggedText()
    expect(text).not.toContain(FAKE_STREAM_PASSWORD)
    expect(text).not.toContain('FAKE-WRONG-PASSWORD-0000')
    expect(text).not.toContain(started.token)
    expect(text).not.toMatch(/[?&](?:token|password)=/)
  })

  it('keeps the password out of the shareable URL that the module returns', async () => {
    ctx = fakeContext()
    register(ctx)

    const started = await invoke<StreamingStartResult>(STREAMING_CHANNELS.start, {
      accessMode: 'lan',
      password: FAKE_STREAM_PASSWORD
    })

    expect(started.url).not.toContain(FAKE_STREAM_PASSWORD)
    expect(new URL(started.url).searchParams.get('password')).toBeNull()
  })
})

describe('diagnostic logger strips credentials from stream URLs (audit P0-11)', () => {
  it('redacts a token carried in a URL query string', () => {
    const shareUrl = 'http://192.168.1.50:3210/obs/race?token=FAKETOKENVALUE1234567890&kind=dashboard'

    const scrubbed = scrubSecretString(shareUrl)

    expect(scrubbed).not.toContain('FAKETOKENVALUE1234567890')
    expect(scrubbed).toContain('[REDACTED]')
  })

  it('redacts credential-shaped keys and inline secrets in a structured detail object', () => {
    const detail = redact({
      publicUrl: 'https://example.trycloudflare.com/obs/race?token=FAKETOKENVALUE1234567890',
      password: FAKE_STREAM_PASSWORD,
      message: `password=${FAKE_STREAM_PASSWORD}`,
      port: 3210
    }) as Record<string, unknown>

    expect(JSON.stringify(detail)).not.toContain('FAKETOKENVALUE1234567890')
    expect(JSON.stringify(detail)).not.toContain(FAKE_STREAM_PASSWORD)
    expect(detail.password).toBe('[REDACTED]')
    expect(detail.port).toBe(3210)
  })
})
