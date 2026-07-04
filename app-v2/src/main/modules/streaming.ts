import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, normalize, relative, resolve, sep } from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { DriverEntry, RadarCarEntry, RelativeCarEntry, TelemetrySnapshot } from '../../shared/telemetry'
import type { StreamingStartArgs, StreamingStartResult, StreamingStatus, StreamingTelemetryFrame } from '../../shared/streaming'
import { STREAMING_CHANNELS } from '../../shared/streaming'
import type { ModuleContext } from '../module-context'

const HOST = '127.0.0.1'
const DEFAULT_LAYOUT = 'default'
const SSE_INTERVAL_MS = 67
const TOKEN_BYTES = 24

interface SseClient {
  id: number
  response: ServerResponse
  timer: ReturnType<typeof setInterval>
}

interface StreamingState {
  server: Server | null
  port: number | null
  token: string | null
  layoutId: string
  streamSafe: boolean
  clients: Map<number, SseClient>
  nextClientId: number
}

const state: StreamingState = {
  server: null,
  port: null,
  token: null,
  layoutId: DEFAULT_LAYOUT,
  streamSafe: true,
  clients: new Map(),
  nextClientId: 1
}

function isValidLayoutId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,48}$/.test(value)
}

function requestedPort(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return 0
  if (value < 0 || value > 65535) return 0
  return value
}

function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

function rendererDir(): string {
  return resolve(__dirname, '../renderer')
}

function candidateHtmlPaths(): string[] {
  return [
    join(rendererDir(), 'stream.html'),
    join(process.cwd(), 'out/renderer/stream.html'),
    join(process.cwd(), 'src/renderer/stream.html')
  ]
}

function findStreamHtml(): string | null {
  for (const candidate of candidateHtmlPaths()) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function contentType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8'
    case '.js': return 'text/javascript; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.svg': return 'image/svg+xml'
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.json': return 'application/json; charset=utf-8'
    case '.wasm': return 'application/wasm'
    default: return 'application/octet-stream'
  }
}

function applyCors(response: ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
}

function send(response: ServerResponse, statusCode: number, body: string): void {
  applyCors(response)
  response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' })
  response.end(body)
}

function hasValidToken(url: URL): boolean {
  return safeTokenEqual(url.searchParams.get('token'), state.token)
}

function safeTokenEqual(input: string | null, expected: string | null): boolean {
  if (!input || !expected) return false
  const left = Buffer.from(input, 'utf8')
  const right = Buffer.from(expected, 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

function safeStaticPath(pathname: string): string | null {
  const root = rendererDir()
  const decoded = decodeURIComponent(pathname)
  const normalizedPath = normalize(decoded).replace(/^[/\\]+/, '')
  const target = resolve(root, normalizedPath)
  const rel = relative(root, target)
  if (rel === '' || rel.startsWith('..') || rel.includes(`..${sep}`)) return null
  return target
}

function addTokenToAssetUrls(html: string, token: string): string {
  return html
    .replace(/(\s(?:src|href)=['"])(\/(?:assets|src)\/[^'"?#]+)([^'"]*)(['"])/g, (_match, prefix: string, path: string, suffix: string, quote: string) => {
      const joiner = suffix.includes('?') ? '&' : '?'
      return `${prefix}${path}${suffix}${joiner}token=${encodeURIComponent(token)}${quote}`
    })
}

function devFallbackHtml(token: string): string {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!devUrl) {
    return '<!doctype html><html><body style="margin:0;background:transparent;color:white;font-family:sans-serif">stream.html not built yet</body></html>'
  }
  const origin = new URL(devUrl).origin
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Ultimate Sim App Stream</title></head><body><div id="root"></div><script type="module" src="${origin}/src/stream/main.tsx?token=${encodeURIComponent(token)}"></script></body></html>`
}

function serveHtml(response: ServerResponse): void {
  // In dev (electron-vite sets ELECTRON_RENDERER_URL), serve a shim that loads the
  // transpiled stream entry from the vite origin; the raw source stream.html would
  // otherwise 404 its .tsx <script>. In production we serve the built stream.html.
  const htmlPath = process.env.ELECTRON_RENDERER_URL ? null : findStreamHtml()
  const html = htmlPath ? readFileSync(htmlPath, 'utf8') : devFallbackHtml(state.token ?? '')
  applyCors(response)
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(addTokenToAssetUrls(html, state.token ?? ''))
}

function serveStatic(pathname: string, response: ServerResponse): void {
  const target = safeStaticPath(pathname)
  if (!target || !existsSync(target) || !statSync(target).isFile()) {
    send(response, 404, 'Not found')
    return
  }
  applyCors(response)
  response.writeHead(200, { 'Content-Type': contentType(target), 'Cache-Control': 'no-store' })
  createReadStream(target).pipe(response)
}

function maskName(name: string | undefined, index: number): string {
  const clean = typeof name === 'string' ? name.trim() : ''
  if (!clean) return `車${index + 1}`
  const initials = clean
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
  return initials || `車${index + 1}`
}

function maskDriver(driver: DriverEntry, index: number): DriverEntry {
  const { iRating: _iRating, safetyRating: _safetyRating, license: _license, custId: _custId, teamId: _teamId, teamName: _teamName, carPath: _carPath, carNumberRaw: _carNumberRaw, ...safe } = driver
  return {
    ...safe,
    name: driver.isPlayer ? 'YOU' : maskName(driver.name, index)
  }
}

function maskRelative(entry: RelativeCarEntry | undefined, index: number): RelativeCarEntry | undefined {
  if (!entry) return undefined
  return { ...entry, name: maskName(entry.name, index) }
}

function maskRadar(entry: RadarCarEntry, index: number): RadarCarEntry {
  return { ...entry, name: entry.name ? maskName(entry.name, index) : undefined }
}

function maskSnapshot(snapshot: TelemetrySnapshot | null): TelemetrySnapshot | null {
  if (!snapshot) return null
  const { driverName: _driverName, strengthOfField: _strengthOfField, ...safe } = snapshot
  return {
    ...safe,
    driverName: snapshot.driverName ? 'YOU' : undefined,
    drivers: snapshot.drivers?.map(maskDriver),
    relatives: snapshot.relatives ? {
      ahead: maskRelative(snapshot.relatives.ahead, 0),
      behind: maskRelative(snapshot.relatives.behind, 1)
    } : undefined,
    radarCars: snapshot.radarCars?.map(maskRadar)
  }
}

function currentFrame(ctx: ModuleContext): StreamingTelemetryFrame {
  const snapshot = ctx.telemetryHub.getLatest()
  return {
    snapshot: state.streamSafe ? maskSnapshot(snapshot) : snapshot,
    streamSafe: state.streamSafe,
    timestamp: Date.now()
  }
}

function writeSse(response: ServerResponse, frame: StreamingTelemetryFrame): void {
  response.write(`event: telemetry\ndata: ${JSON.stringify(frame)}\n\n`)
}

function openSse(ctx: ModuleContext, request: IncomingMessage, response: ServerResponse): void {
  applyCors(response)
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive'
  })
  response.write(': connected\n\n')
  const id = state.nextClientId++
  const timer = setInterval(() => writeSse(response, currentFrame(ctx)), SSE_INTERVAL_MS)
  const client: SseClient = { id, response, timer }
  state.clients.set(id, client)
  writeSse(response, currentFrame(ctx))
  request.on('close', () => closeClient(id))
}

function closeClient(id: number): void {
  const client = state.clients.get(id)
  if (!client) return
  clearInterval(client.timer)
  if (!client.response.destroyed) client.response.end()
  state.clients.delete(id)
}

function closeAllClients(): void {
  for (const id of [...state.clients.keys()]) closeClient(id)
}

function status(): StreamingStatus {
  return {
    running: state.server !== null,
    url: state.port && state.token ? `http://${HOST}:${state.port}/obs/${state.layoutId}?token=${state.token}` : null,
    port: state.port,
    token: state.token,
    layoutId: state.layoutId,
    streamSafe: state.streamSafe,
    clients: state.clients.size
  }
}

function handleRequest(ctx: ModuleContext, request: IncomingMessage, response: ServerResponse): void {
  try {
    const url = new URL(request.url ?? '/', `http://${HOST}`)
    if (!hasValidToken(url)) {
      send(response, 403, 'Forbidden')
      return
    }
    if (request.method === 'OPTIONS') {
      applyCors(response)
      response.writeHead(204)
      response.end()
      return
    }
    if (request.method !== 'GET') {
      send(response, 405, 'Method not allowed')
      return
    }
    if (url.pathname.startsWith('/obs/')) {
      const layoutId = url.pathname.slice('/obs/'.length)
      if (!isValidLayoutId(layoutId)) {
        send(response, 404, 'Not found')
        return
      }
      serveHtml(response)
      return
    }
    if (url.pathname === '/sse') {
      openSse(ctx, request, response)
      return
    }
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/src/')) {
      serveStatic(url.pathname, response)
      return
    }
    send(response, 404, 'Not found')
  } catch {
    send(response, 400, 'Bad request')
  }
}

async function stop(): Promise<StreamingStatus> {
  closeAllClients()
  const server = state.server
  state.server = null
  state.port = null
  state.token = null
  if (server) {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
  }
  return status()
}

async function start(ctx: ModuleContext, args: StreamingStartArgs = {}): Promise<StreamingStartResult> {
  if (state.server) await stop()
  state.layoutId = isValidLayoutId(args.layoutId) ? args.layoutId : DEFAULT_LAYOUT
  state.streamSafe = args.streamSafe ?? true
  state.token = generateToken()
  const server = createServer((request, response) => handleRequest(ctx, request, response))
  state.server = server
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(requestedPort(args.port), HOST, () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })
  state.port = (server.address() as AddressInfo).port
  return {
    url: `http://${HOST}:${state.port}/obs/${state.layoutId}?token=${state.token}`,
    port: state.port,
    token: state.token
  }
}

export function register(ctx: ModuleContext): void {
  ctx.ipcMain.handle(STREAMING_CHANNELS.start, (_event, args?: StreamingStartArgs) => start(ctx, args))
  ctx.ipcMain.handle(STREAMING_CHANNELS.stop, () => stop())
  ctx.ipcMain.handle(STREAMING_CHANNELS.status, () => status())
  ctx.app.once('before-quit', () => {
    void stop()
  })
}
