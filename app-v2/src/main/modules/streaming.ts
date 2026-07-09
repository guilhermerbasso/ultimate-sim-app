import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, normalize, relative, resolve, sep } from 'node:path'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { networkInterfaces } from 'node:os'
import QRCode from 'qrcode'
import type { DriverEntry, RadarCarEntry, RelativeCarEntry, TelemetrySnapshot } from '../../shared/telemetry'
import type { StreamingAccessMode, StreamingStartArgs, StreamingStartResult, StreamingStatus, StreamingTelemetryFrame } from '../../shared/streaming'
import { STREAMING_CHANNELS } from '../../shared/streaming'
import { buttonActionToIpc, type ButtonAction } from '../../shared/touch-panel'
import type { ModuleContext } from '../module-context'
import { getTouchPanelManager } from '../touchpanel/manager'

const HOST = '127.0.0.1'
const LAN_HOST = '0.0.0.0'
const DEFAULT_LAYOUT = 'default'
const SSE_INTERVAL_MS = 67
const TOKEN_BYTES = 24
const AUTH_FAILURE_WINDOW_MS = 60_000
const AUTH_FAILURE_LIMIT = 10

interface SseClient {
  id: number
  response: ServerResponse
  timer: ReturnType<typeof setInterval>
  address: string
  userAgent: string | null
  connectedAt: number
}

interface StreamingState {
  server: Server | null
  port: number | null
  token: string | null
  passwordHash: string | null
  layoutId: string
  touchPanelId: string | null
  streamSafe: boolean
  lanEnabled: boolean
  accessMode: StreamingAccessMode
  lanAddress: string | null
  publicBaseUrl: string | null
  qrDataUrl: string | null
  touchQrDataUrl: string | null
  clients: Map<number, SseClient>
  authFailures: Map<string, { count: number; resetAt: number }>
  nextClientId: number
}

const state: StreamingState = {
  server: null,
  port: null,
  token: null,
  passwordHash: null,
  layoutId: DEFAULT_LAYOUT,
  touchPanelId: null,
  streamSafe: true,
  lanEnabled: false,
  accessMode: 'local',
  lanAddress: null,
  publicBaseUrl: null,
  qrDataUrl: null,
  touchQrDataUrl: null,
  clients: new Map(),
  authFailures: new Map(),
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

function passwordHash(value: string | undefined): string | null {
  const password = value?.trim()
  if (!password) return null
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 32).toString('base64url')
  return `${salt}:${hash}`
}

function primaryLanAddress(): string | null {
  let firstExternal: string | null = null
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      if (isPrivateIpv4(entry.address)) return entry.address
      firstExternal ??= entry.address
    }
  }
  return firstExternal
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 127
}

function normalizeRemoteAddress(value: string | undefined): string {
  if (!value) return 'unknown'
  if (value.startsWith('::ffff:')) return value.slice('::ffff:'.length)
  if (value === '::1') return '127.0.0.1'
  return value
}

function isLocalNetworkRequest(request: IncomingMessage): boolean {
  const address = normalizeRemoteAddress(request.socket.remoteAddress)
  return address === '127.0.0.1' || address === '::1' || isPrivateIpv4(address)
}

function normalizePublicBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.origin
  } catch {
    return null
  }
}

function isRateLimited(request: IncomingMessage): boolean {
  const key = normalizeRemoteAddress(request.socket.remoteAddress)
  const now = Date.now()
  const current = state.authFailures.get(key)
  if (!current || current.resetAt <= now) {
    state.authFailures.delete(key)
    return false
  }
  return current.count >= AUTH_FAILURE_LIMIT
}

function recordAuthFailure(request: IncomingMessage): void {
  const key = normalizeRemoteAddress(request.socket.remoteAddress)
  const now = Date.now()
  const current = state.authFailures.get(key)
  if (!current || current.resetAt <= now) {
    state.authFailures.set(key, { count: 1, resetAt: now + AUTH_FAILURE_WINDOW_MS })
    return
  }
  current.count += 1
}

function clearAuthFailure(request: IncomingMessage): void {
  state.authFailures.delete(normalizeRemoteAddress(request.socket.remoteAddress))
}

function rendererDir(): string {
  return resolve(__dirname, '../renderer')
}

function candidateHtmlPaths(fileName: string): string[] {
  return [
    join(rendererDir(), fileName),
    join(process.cwd(), 'out/renderer', fileName),
    join(process.cwd(), 'src/renderer', fileName)
  ]
}

function findRendererHtml(fileName: string): string | null {
  for (const candidate of candidateHtmlPaths(fileName)) {
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

function hasValidAuth(url: URL, request: IncomingMessage): boolean {
  if (safeTokenEqual(authValue(url, request, 'token'), state.token)) return true
  return verifyPassword(authValue(url, request, 'password'), state.passwordHash)
}

function authValue(url: URL, request: IncomingMessage, key: 'token' | 'password'): string | null {
  return url.searchParams.get(key) ?? headerValue(request, `x-stream-${key}`)
}

function headerValue(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name]
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function verifyPassword(incoming: string | null, stored: string | null): boolean {
  if (!incoming || !stored) return false
  const colonIdx = stored.indexOf(':')
  if (colonIdx < 0) return false
  const salt = stored.slice(0, colonIdx)
  const expectedHash = stored.slice(colonIdx + 1)
  const incomingHash = scryptSync(incoming, salt, 32).toString('base64url')
  return safeTokenEqual(incomingHash, expectedHash)
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

function devFallbackHtml(entry: 'stream' | 'touchpanel', token: string): string {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!devUrl) {
    return '<!doctype html><html><body style="margin:0;background:#05070d;color:white;font-family:sans-serif">stream page not built yet</body></html>'
  }
  const origin = new URL(devUrl).origin
  const title = entry === 'stream' ? 'Ultimate Sim App Stream' : 'Touch Controls'
  const source = entry === 'stream' ? '/src/stream/main.tsx' : '/src/touchpanel/main.tsx'
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"><title>${title}</title></head><body><div id="root"></div><script type="module" src="${origin}${source}?token=${encodeURIComponent(token)}"></script></body></html>`
}

function serveHtml(response: ServerResponse, fileName = 'stream.html', entry: 'stream' | 'touchpanel' = 'stream'): void {
  // In dev (electron-vite sets ELECTRON_RENDERER_URL), serve a shim that loads the
  // transpiled stream entry from the vite origin; the raw source stream.html would
  // otherwise 404 its .tsx <script>. In production we serve the built stream.html.
  const htmlPath = process.env.ELECTRON_RENDERER_URL ? null : findRendererHtml(fileName)
  const html = htmlPath ? readFileSync(htmlPath, 'utf8') : devFallbackHtml(entry, state.token ?? '')
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

function isValidPanelRouteId(value: string): boolean {
  return /^[a-zA-Z0-9._-]{1,96}$/.test(value)
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  applyCors(response)
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(body))
}

function serveTouchPanelData(panelId: string, response: ServerResponse): void {
  if (!isValidPanelRouteId(panelId)) {
    send(response, 404, 'Not found')
    return
  }
  const panel = getTouchPanelManager()?.getPanel(panelId) ?? null
  if (!panel) {
    send(response, 404, 'Not found')
    return
  }
  sendJson(response, 200, panel)
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
      if (body.length > 32_768) rejectBody(new Error('Request body too large'))
    })
    request.on('end', () => resolveBody(body))
    request.on('error', rejectBody)
  })
}

async function invokeRegisteredIpc(ctx: ModuleContext, channel: string, args: unknown[]): Promise<unknown> {
  const handlers = (ctx.ipcMain as unknown as { _invokeHandlers?: Map<string, (event: unknown, ...args: unknown[]) => unknown> })._invokeHandlers
  const handler = handlers?.get(channel)
  if (!handler) throw new Error(`No IPC handler registered for ${channel}`)
  return handler({ sender: ctx.getMainWindow()?.webContents }, ...args)
}

async function handleTouchAction(ctx: ModuleContext, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const raw = await readRequestBody(request)
  const action = JSON.parse(raw) as ButtonAction
  const ipc = buttonActionToIpc(action)
  if (!ipc) {
    sendJson(response, 200, { ok: true, skipped: true })
    return
  }
  await invokeRegisteredIpc(ctx, ipc.channel, ipc.args)
  sendJson(response, 200, { ok: true })
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
  const client: SseClient = {
    id,
    response,
    timer,
    address: normalizeRemoteAddress(request.socket.remoteAddress),
    userAgent: headerValue(request, 'user-agent'),
    connectedAt: Date.now()
  }
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

function baseOrigin(): string {
  if (state.accessMode === 'internet' && state.publicBaseUrl) return state.publicBaseUrl
  const host = state.accessMode !== 'local' && state.lanAddress ? state.lanAddress : HOST
  return `http://${host}:${state.port}`
}

function lanOrigin(): string | null {
  return state.port && state.lanAddress ? `http://${state.lanAddress}:${state.port}` : null
}

function syncTouchPanelId(): void {
  const manager = getTouchPanelManager()
  if (!manager) {
    state.touchPanelId = null
    return
  }
  if (state.touchPanelId && manager.getPanel(state.touchPanelId)) return
  state.touchPanelId = manager.list()[0]?.id ?? null
}

function dashboardUrl(origin = baseOrigin()): string | null {
  return state.port && state.token ? `${origin}/obs/${state.layoutId}?token=${state.token}` : null
}

function touchControlsUrl(origin = baseOrigin()): string | null {
  if (!state.server) return null
  syncTouchPanelId()
  return state.port && state.token && state.touchPanelId ? `${origin}/touch/${encodeURIComponent(state.touchPanelId)}?token=${state.token}` : null
}

function warning(): string | null {
  if (state.accessMode === 'internet') {
    return 'Internet mode binds to all interfaces and allows non-LAN clients with the token/password. Use a trusted tunnel or port-forwarding, and allow the port through Windows Firewall.'
  }
  return state.accessMode === 'lan'
    ? 'LAN streaming is enabled: phones/tablets on your Wi-Fi can open the QR URL. If it still fails, allow this app/port through Windows Firewall.'
    : null
}

async function refreshQrCodes(): Promise<void> {
  const url = dashboardUrl()
  const touchUrl = touchControlsUrl()
  state.qrDataUrl = url ? await QRCode.toDataURL(url) : null
  state.touchQrDataUrl = touchUrl ? await QRCode.toDataURL(touchUrl) : null
}

async function status(): Promise<StreamingStatus> {
  if (state.server) await refreshQrCodes()
  const url = dashboardUrl()
  const touchUrl = touchControlsUrl()
  return {
    running: state.server !== null,
    url,
    lanUrl: state.lanEnabled && lanOrigin() ? dashboardUrl(lanOrigin()!) : null,
    touchUrl,
    qrDataUrl: state.qrDataUrl,
    touchQrDataUrl: state.touchQrDataUrl,
    port: state.port,
    token: state.token,
    layoutId: state.layoutId,
    touchPanelId: state.touchPanelId,
    streamSafe: state.streamSafe,
    clients: state.clients.size,
    devices: [...state.clients.values()].map((client) => ({
      id: client.id,
      address: client.address,
      userAgent: client.userAgent,
      connectedAt: client.connectedAt
    })),
    lanEnabled: state.lanEnabled,
    lanAddress: state.lanAddress,
    accessMode: state.accessMode,
    publicBaseUrl: state.publicBaseUrl,
    passwordEnabled: state.passwordHash !== null,
    warning: warning()
  }
}

async function handleRequest(ctx: ModuleContext, request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const url = new URL(request.url ?? '/', state.port ? baseOrigin() : `http://${HOST}`)
    if (request.method === 'OPTIONS') {
      applyCors(response)
      response.writeHead(204)
      response.end()
      return
    }
    if (state.accessMode === 'lan' && !isLocalNetworkRequest(request)) {
      send(response, 403, 'Forbidden')
      return
    }
    if (isRateLimited(request)) {
      send(response, 429, 'Too many failed auth attempts')
      return
    }
    if (!hasValidAuth(url, request)) {
      recordAuthFailure(request)
      send(response, 403, 'Forbidden')
      return
    }
    clearAuthFailure(request)
    if (request.method !== 'GET' && request.method !== 'POST') {
      send(response, 405, 'Method not allowed')
      return
    }
    if (url.pathname.startsWith('/obs/')) {
      if (request.method !== 'GET') {
        send(response, 405, 'Method not allowed')
        return
      }
      const layoutId = url.pathname.slice('/obs/'.length)
      if (!isValidLayoutId(layoutId)) {
        send(response, 404, 'Not found')
        return
      }
      serveHtml(response)
      return
    }
    if (url.pathname.startsWith('/touch/')) {
      if (request.method !== 'GET') {
        send(response, 405, 'Method not allowed')
        return
      }
      const panelId = decodeURIComponent(url.pathname.slice('/touch/'.length))
      if (!isValidPanelRouteId(panelId)) {
        send(response, 404, 'Not found')
        return
      }
      serveHtml(response, 'touchpanel.html', 'touchpanel')
      return
    }
    if (url.pathname.startsWith('/api/touch/panel/')) {
      if (request.method !== 'GET') {
        send(response, 405, 'Method not allowed')
        return
      }
      serveTouchPanelData(decodeURIComponent(url.pathname.slice('/api/touch/panel/'.length)), response)
      return
    }
    if (url.pathname === '/api/touch/action') {
      if (request.method !== 'POST') {
        send(response, 405, 'Method not allowed')
        return
      }
      await handleTouchAction(ctx, request, response)
      return
    }
    if (url.pathname === '/sse') {
      if (request.method !== 'GET') {
        send(response, 405, 'Method not allowed')
        return
      }
      openSse(ctx, request, response)
      return
    }
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/src/')) {
      if (request.method !== 'GET') {
        send(response, 405, 'Method not allowed')
        return
      }
      serveStatic(url.pathname, response)
      return
    }
    send(response, 404, 'Not found')
  } catch (error) {
    console.warn('[streaming] request failed', error)
    send(response, 400, 'Bad request')
  }
}

async function stop(): Promise<StreamingStatus> {
  closeAllClients()
  const server = state.server
  state.server = null
  state.port = null
  state.token = null
  state.passwordHash = null
  state.lanEnabled = false
  state.accessMode = 'local'
  state.lanAddress = null
  state.publicBaseUrl = null
  state.touchPanelId = null
  state.qrDataUrl = null
  state.touchQrDataUrl = null
  state.authFailures.clear()
  if (server) {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
  }
  return status()
}

async function start(ctx: ModuleContext, args: StreamingStartArgs = {}): Promise<StreamingStartResult> {
  if (state.server) await stop()
  state.layoutId = isValidLayoutId(args.layoutId) ? args.layoutId : DEFAULT_LAYOUT
  const touchManager = getTouchPanelManager()
  const requestedTouchPanelId = typeof args.touchPanelId === 'string' && isValidPanelRouteId(args.touchPanelId) ? args.touchPanelId : null
  const firstTouchPanelId = touchManager?.list()[0]?.id ?? null
  state.touchPanelId = requestedTouchPanelId && touchManager?.getPanel(requestedTouchPanelId) ? requestedTouchPanelId : firstTouchPanelId
  state.streamSafe = args.streamSafe ?? true
  state.token = generateToken()
  state.passwordHash = passwordHash(args.password)
  state.accessMode = args.accessMode === 'internet' || args.accessMode === 'lan'
    ? args.accessMode
    : args.lanEnabled
      ? 'lan'
      : 'local'
  state.lanEnabled = state.accessMode !== 'local'
  state.lanAddress = state.accessMode !== 'local' ? primaryLanAddress() : null
  state.publicBaseUrl = state.accessMode === 'internet' ? normalizePublicBaseUrl(args.publicBaseUrl) : null
  const server = createServer((request, response) => {
    void handleRequest(ctx, request, response)
  })
  state.server = server
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(requestedPort(args.port), state.accessMode !== 'local' ? LAN_HOST : HOST, () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })
  state.port = (server.address() as AddressInfo).port
  await refreshQrCodes()
  return {
    url: dashboardUrl() ?? '',
    lanUrl: state.lanEnabled && lanOrigin() ? dashboardUrl(lanOrigin()!) : null,
    touchUrl: touchControlsUrl(),
    qrDataUrl: state.qrDataUrl,
    touchQrDataUrl: state.touchQrDataUrl,
    port: state.port,
    token: state.token,
    lanEnabled: state.lanEnabled,
    accessMode: state.accessMode,
    lanAddress: state.lanAddress,
    publicBaseUrl: state.publicBaseUrl,
    warning: warning()
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
