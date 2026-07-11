import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, normalize, relative, resolve, sep } from 'node:path'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { isIP, type AddressInfo } from 'node:net'
import { networkInterfaces } from 'node:os'
import QRCode from 'qrcode'
import type { DriverEntry, RadarCarEntry, RelativeCarEntry, TelemetrySnapshot } from '../../shared/telemetry'
import type { StreamingAccessMode, StreamingLayoutKind, StreamingSelfTestResult, StreamingStartArgs, StreamingStartResult, StreamingStatus, StreamingTelemetryFrame } from '../../shared/streaming'
import { STREAMING_CHANNELS } from '../../shared/streaming'
import type { ModuleContext } from '../module-context'
import { getDashboardManager } from './dashboards'
import { logger } from './logger'
import { getTouchPanelManager } from '../touchpanel/manager'

const HOST = '127.0.0.1'
const LAN_HOST = '0.0.0.0'
const DEFAULT_LAYOUT = 'default'
const SSE_INTERVAL_MS = 67
const TOKEN_BYTES = 24
const AUTH_FAILURE_WINDOW_MS = 60_000
const AUTH_FAILURE_LIMIT = 10
const MAX_SSE_CLIENTS = 12
const CLOUDFLARED_RESOURCE_DIR = 'cloudflared'
const CLOUDFLARED_START_TIMEOUT_MS = 30_000
const CLOUDFLARED_OUTPUT_LIMIT = 16_384

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
  passwordPlaintext: string | null
  layoutId: string
  layoutKind: StreamingLayoutKind
  touchPanelId: string | null
  firewallMessage: string | null
  streamSafe: boolean
  lanEnabled: boolean
  accessMode: StreamingAccessMode
  lanAddress: string | null
  publicBaseUrl: string | null
  manualPublicBaseUrl: string | null
  qrDataUrl: string | null
  touchQrDataUrl: string | null
  autoTunnelEnabled: boolean
  autoTunnelProcess: ChildProcess | null
  autoTunnelUrl: string | null
  autoTunnelMessage: string | null
  autoTunnelStopRequested: boolean
  clients: Map<number, SseClient>
  authFailures: Map<string, { count: number; resetAt: number }>
  nextClientId: number
}

const state: StreamingState = {
  server: null,
  port: null,
  token: null,
  passwordHash: null,
  passwordPlaintext: null,
  layoutId: DEFAULT_LAYOUT,
  layoutKind: 'dashboard',
  touchPanelId: null,
  firewallMessage: null,
  streamSafe: true,
  lanEnabled: false,
  accessMode: 'local',
  lanAddress: null,
  publicBaseUrl: null,
  manualPublicBaseUrl: null,
  qrDataUrl: null,
  touchQrDataUrl: null,
  autoTunnelEnabled: false,
  autoTunnelProcess: null,
  autoTunnelUrl: null,
  autoTunnelMessage: null,
  autoTunnelStopRequested: false,
  clients: new Map(),
  authFailures: new Map(),
  nextClientId: 1
}

function isValidLayoutId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,48}$/.test(value)
}

function normalizeLayoutKind(value: unknown): StreamingLayoutKind {
  return value === 'touch' ? 'touch' : 'dashboard'
}

function firstDashboardId(): string | null {
  const manager = getDashboardManager()
  const open = manager?.listOpen().find((item) => isValidLayoutId(item.id))?.id
  if (open) return open
  return manager?.list().find((item) => !item.hidden && isValidLayoutId(item.id))?.id ?? null
}

function resolveStreamTarget(args: StreamingStartArgs): { kind: StreamingLayoutKind; id: string; touchPanelId: string | null } {
  const kind = normalizeLayoutKind(args.layoutKind)
  if (kind === 'touch') {
    const requested = isValidLayoutId(args.layoutId) ? args.layoutId : isValidLayoutId(args.touchPanelId) ? args.touchPanelId : null
    if (!requested) throw new Error('Select a valid touch controls panel to stream.')
    const manager = getTouchPanelManager()
    if (!manager?.has(requested)) throw new Error(`Touch controls panel not found: ${requested}`)
    return { kind, id: requested, touchPanelId: requested }
  }
  const requested = isValidLayoutId(args.layoutId) ? args.layoutId : firstDashboardId()
  if (!getDashboardManager()) return { kind, id: requested ?? DEFAULT_LAYOUT, touchPanelId: null }
  if (!requested) throw new Error('Select a valid dashboard to stream.')
  const manager = getDashboardManager()
  if (!manager?.getDashboard(requested)) throw new Error(`Dashboard not found: ${requested}`)
  return { kind, id: requested, touchPanelId: null }
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

function normalizePassword(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function primaryLanAddress(): string | null {
  const candidates: Array<{ address: string; score: number }> = []
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if ((String(entry.family) !== 'IPv4' && String(entry.family) !== '4') || entry.internal) continue
      if (!isPrivateIpv4(entry.address)) continue
      const lowerName = name.toLowerCase()
      let score = 0
      if (entry.address.startsWith('192.168.')) score += 50
      else if (entry.address.startsWith('10.')) score += 40
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(entry.address)) score += 35
      else if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(entry.address)) score += 10
      else if (entry.address.startsWith('169.254.')) score -= 50
      if (lowerName.includes('wi-fi') || lowerName.includes('wifi') || lowerName.includes('wireless')) score += 20
      if (lowerName.includes('ethernet')) score += 15
      if (/virtual|vpn|loopback|vmware|hyper-v|vethernet|docker|wsl|tailscale|zerotier/.test(lowerName)) score -= 25
      candidates.push({ address: entry.address, score })
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  logger.info('streaming', 'private LAN IPv4 candidates evaluated', {
    candidates,
    selected: candidates[0]?.address ?? null
  })
  return candidates[0]?.address ?? null
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts
  return a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 127
}

function stripIpv6Decorations(value: string): string {
  let address = value.trim()
  if (address.startsWith('[')) {
    const closingBracket = address.indexOf(']')
    if (closingBracket > 0) address = address.slice(1, closingBracket)
  }
  const zoneIndex = address.indexOf('%')
  if (zoneIndex >= 0) address = address.slice(0, zoneIndex)
  return address.toLowerCase()
}

function mappedIpv4Address(value: string): string | null {
  const address = stripIpv6Decorations(value)
  const match = /^(?:::ffff:|(?:0{1,4}:){5}ffff:)(.+)$/i.exec(address)
  if (!match) return null
  const mapped = match[1]
  if (isIP(mapped) === 4) return mapped
  const words = mapped.split(':')
  if (words.length !== 2 || words.some((word) => !/^[0-9a-f]{1,4}$/i.test(word))) return null
  const high = Number.parseInt(words[0], 16)
  const low = Number.parseInt(words[1], 16)
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
}

function isPrivateIpv6(address: string): boolean {
  const normalized = stripIpv6Decorations(address)
  if (normalized === '::1') return true
  if (isIP(normalized) !== 6) return false
  const firstWord = Number.parseInt(normalized.split(':', 1)[0] || '0', 16)
  return (firstWord & 0xfe00) === 0xfc00 || (firstWord & 0xffc0) === 0xfe80
}

function normalizeRemoteAddress(value: string | undefined): string {
  if (!value) return 'unknown'
  const mapped = mappedIpv4Address(value)
  if (mapped) return mapped
  const normalized = stripIpv6Decorations(value)
  if (normalized === '::1') return '127.0.0.1'
  return normalized
}

export function isLocalNetworkAddress(value: string | undefined): boolean {
  const address = normalizeRemoteAddress(value)
  if (isIP(address) === 4) return isPrivateIpv4(address)
  if (isIP(address) === 6) return isPrivateIpv6(address)
  return false
}

function isLocalNetworkRequest(request: IncomingMessage): boolean {
  return isLocalNetworkAddress(request.socket.remoteAddress)
}

function normalizePublicBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'https:') return null
    return parsed.origin
  } catch {
    return null
  }
}

function cloudflaredBinaryCandidates(): string[] {
  const binaryName = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'
  const candidates: string[] = []
  if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
    candidates.push(join(process.resourcesPath, CLOUDFLARED_RESOURCE_DIR, binaryName))
  }
  candidates.push(join(process.cwd(), 'resources', CLOUDFLARED_RESOURCE_DIR, binaryName))
  return [...new Set(candidates)]
}

export function resolveCloudflaredBinary(): string | null {
  for (const candidate of cloudflaredBinaryCandidates()) {
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    } catch {
      // Try the next packaged/dev candidate.
    }
  }
  return null
}

function autoTunnelUnavailableMessage(): string {
  return 'Auto-tunnel is unavailable because cloudflared is not bundled. Run scripts/fetch-win-cloudflared.sh before packaging, or turn off Auto-tunnel and enter a public HTTPS URL manually.'
}

function parseCloudflaredUrl(output: string): string | null {
  const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i)
  return match ? normalizePublicBaseUrl(match[0]) : null
}

function trimTunnelOutput(output: string): string {
  return output.length <= CLOUDFLARED_OUTPUT_LIMIT ? output : output.slice(-CLOUDFLARED_OUTPUT_LIMIT)
}

async function stopAutoTunnelProcess(): Promise<void> {
  const child = state.autoTunnelProcess
  const tunnelUrl = state.autoTunnelUrl
  state.autoTunnelProcess = null
  state.autoTunnelUrl = null
  if (tunnelUrl && state.publicBaseUrl === tunnelUrl) state.publicBaseUrl = state.manualPublicBaseUrl
  if (!child || child.exitCode !== null) return

  state.autoTunnelStopRequested = true
  await new Promise<void>((resolveStop) => {
    let resolved = false
    const finish = (): void => {
      if (resolved) return
      resolved = true
      resolveStop()
    }
    child.once('close', finish)
    try {
      child.kill()
    } catch {
      finish()
      return
    }
    const timer = setTimeout(finish, 3_000)
    timer.unref()
  })
  state.autoTunnelStopRequested = false
}

async function launchAutoTunnel(): Promise<string> {
  if (!state.server || !state.port) throw new Error('Start the streaming server before starting Auto-tunnel.')
  if (state.accessMode !== 'internet') throw new Error('Auto-tunnel is only available in Internet mode.')
  if (state.autoTunnelProcess) {
    if (state.autoTunnelUrl) return state.autoTunnelUrl
    throw new Error('Auto-tunnel is already starting.')
  }

  const binary = resolveCloudflaredBinary()
  if (!binary) throw new Error(autoTunnelUnavailableMessage())

  const localOrigin = `http://localhost:${state.port}`
  const args = ['tunnel', '--url', localOrigin, '--no-autoupdate']
  logger.info('streaming', 'auto-tunnel starting', { binary, localOrigin })

  const child = spawn(binary, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1' }
  })
  state.autoTunnelProcess = child
  state.autoTunnelUrl = null
  state.autoTunnelStopRequested = false
  state.autoTunnelMessage = 'Starting Cloudflare quick tunnel…'

  return new Promise<string>((resolveUrl, rejectUrl) => {
    let output = ''
    let settled = false
    let published = false
    let timer: ReturnType<typeof setTimeout>

    const rejectStart = (message: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      state.autoTunnelMessage = message
      rejectUrl(new Error(message))
    }

    const consume = (source: 'stdout' | 'stderr', chunk: Buffer | string): void => {
      const text = chunk.toString()
      output = trimTunnelOutput(output + text)
      for (const line of text.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
        logger.info('streaming', 'cloudflared output', { source, line: line.slice(0, 500) })
      }
      const publicUrl = parseCloudflaredUrl(output)
      if (!publicUrl || settled) return
      settled = true
      published = true
      clearTimeout(timer)
      state.autoTunnelUrl = publicUrl
      state.publicBaseUrl = publicUrl
      state.autoTunnelMessage = `Auto-tunnel is online at ${publicUrl}`
      logger.info('streaming', 'auto-tunnel ready', { localOrigin, publicUrl })
      resolveUrl(publicUrl)
    }

    child.stdout?.on('data', (chunk: Buffer) => consume('stdout', chunk))
    child.stderr?.on('data', (chunk: Buffer) => consume('stderr', chunk))
    child.once('error', (error) => {
      rejectStart(`Auto-tunnel could not start: ${error.message}`)
    })
    child.once('close', (code, signal) => {
      const expectedStop = state.autoTunnelStopRequested
      if (state.autoTunnelProcess === child) {
        state.autoTunnelProcess = null
        const tunnelUrl = state.autoTunnelUrl
        state.autoTunnelUrl = null
        if (tunnelUrl && state.publicBaseUrl === tunnelUrl) state.publicBaseUrl = state.manualPublicBaseUrl
      }
      if (!settled) {
        const detail = output.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]
        rejectStart(`Auto-tunnel exited before publishing a URL (code ${code ?? 'unknown'}${signal ? `, signal ${signal}` : ''})${detail ? `: ${detail}` : '.'}`)
        return
      }
      if (published && !expectedStop && state.server) {
        state.autoTunnelEnabled = false
        state.autoTunnelMessage = `Auto-tunnel stopped unexpectedly (code ${code ?? 'unknown'}). Start it again, or stop streaming and restart with a manual public HTTPS URL.`
        logger.warn('streaming', 'auto-tunnel stopped unexpectedly', { code, signal })
      }
    })

    timer = setTimeout(() => {
      rejectStart('Auto-tunnel timed out before Cloudflare published a public HTTPS URL. Check internet access, then retry or use a manual URL.')
      state.autoTunnelStopRequested = true
      try {
        child.kill()
      } catch {
        // The close/error handlers already report the actionable failure.
      }
    }, CLOUDFLARED_START_TIMEOUT_MS)
    timer.unref()
  })
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
  response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Stream-Token, X-Stream-Password')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  // Don't leak the token/password in the URL to any linked origin.
  response.setHeader('Referrer-Policy', 'no-referrer')
}

function rejectMethod(response: ServerResponse): void {
  applyCors(response)
  response.setHeader('Allow', 'GET, HEAD')
  response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' })
  response.end('Method not allowed')
}

function send(response: ServerResponse, statusCode: number, body: string): void {
  applyCors(response)
  response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' })
  response.end(body)
}

function hasValidAuth(url: URL, request: IncomingMessage): boolean {
  const tokenOk = safeTokenEqual(authValue(url, request, 'token'), state.token)
  if (state.accessMode === 'local') return tokenOk
  return tokenOk && verifyPassword(authValue(url, request, 'password'), state.passwordHash)
}

/** Token-only auth: used for the stream page HTML/assets and /ping so that a
 *  shareable URL that contains only the token can load the page, which then
 *  prompts the user to enter the password before connecting to the SSE stream. */
function hasValidToken(url: URL, request: IncomingMessage): boolean {
  return safeTokenEqual(authValue(url, request, 'token'), state.token)
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
  if (!pathname.startsWith('/assets/')) return null
  const root = rendererDir()
  const decoded = decodeURIComponent(pathname)
  const normalizedPath = normalize(decoded).replace(/^[/\\]+/, '')
  const target = resolve(root, normalizedPath)
  const rel = relative(root, target)
  if (rel === '' || rel.startsWith('..') || rel.includes(`..${sep}`)) return null
  return target
}

function authSearchParams(): string {
  const params = new URLSearchParams()
  // Only embed the token in asset sub-request URLs; the password is entered by the
  // user in the stream page and is only used for the /sse connection.
  if (state.token) params.set('token', state.token)
  return params.toString()
}

function addAuthToAssetUrls(html: string): string {
  const auth = authSearchParams()
  if (!auth) return html
  return html
    .replace(/(\s(?:src|href)=['"])(\/assets\/[^'"?#]+)([^'"]*)(['"])/g, (_match, prefix: string, path: string, suffix: string, quote: string) => {
      const joiner = suffix.includes('?') ? '&' : '?'
      return `${prefix}${path}${suffix}${joiner}${auth}${quote}`
    })
}

function addAuthToCssUrls(css: string): string {
  const auth = authSearchParams()
  if (!auth) return css
  return css.replace(/url\((['"]?)(?!data:|https?:|#)([^'")]+)(['"]?)\)/gi, (_match, open: string, assetPath: string, close: string) => {
    const joiner = assetPath.includes('?') ? '&' : '?'
    return `url(${open}${assetPath}${joiner}${auth}${close})`
  })
}

function devFallbackHtml(): string {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!devUrl) {
    return '<!doctype html><html><body style="margin:0;background:#05070d;color:white;font-family:sans-serif">stream page not built yet</body></html>'
  }
  const origin = new URL(devUrl).origin
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"><title>Ultimate Sim App Stream</title></head><body><div id="root"></div><script type="module" src="${origin}/src/stream/main.tsx"></script></body></html>`
}

function serveHtml(request: IncomingMessage, response: ServerResponse): void {
  // In dev (electron-vite sets ELECTRON_RENDERER_URL), serve a shim that loads the
  // transpiled stream entry from the vite origin; the raw source stream.html would
  // otherwise 404 its .tsx <script>. In production we serve the built stream.html.
  const htmlPath = process.env.ELECTRON_RENDERER_URL ? null : findRendererHtml('stream.html')
  const html = htmlPath ? readFileSync(htmlPath, 'utf8') : devFallbackHtml()
  applyCors(response)
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(request.method === 'HEAD' ? undefined : addAuthToAssetUrls(html))
}

function serveStatic(pathname: string, request: IncomingMessage, response: ServerResponse): void {
  const target = safeStaticPath(pathname)
  if (!target || !existsSync(target) || !statSync(target).isFile()) {
    send(response, 404, 'Not found')
    return
  }
  applyCors(response)
  response.writeHead(200, { 'Content-Type': contentType(target), 'Cache-Control': 'no-store' })
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  if (contentType(target).startsWith('text/css')) {
    response.end(addAuthToCssUrls(readFileSync(target, 'utf8')))
    return
  }
  createReadStream(target).pipe(response)
}

function sendJson(response: ServerResponse, body: unknown, method: string | undefined): void {
  applyCors(response)
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(method === 'HEAD' ? undefined : JSON.stringify(body))
}

function serveSelectedDashboard(id: string, request: IncomingMessage, response: ServerResponse): void {
  if (state.layoutKind !== 'dashboard' || id !== state.layoutId) {
    logger.error('streaming', 'dashboard api rejected non-selected id', { requestedId: id, selectedId: state.layoutId, layoutKind: state.layoutKind })
    send(response, 404, 'Not found')
    return
  }
  const dashboard = getDashboardManager()?.getDashboard(id)
  if (!dashboard) {
    logger.error('streaming', 'dashboard api selected id missing', { id })
    send(response, 404, 'Not found')
    return
  }
  sendJson(response, dashboard, request.method)
}

function serveSelectedTouchPanel(id: string, request: IncomingMessage, response: ServerResponse): void {
  if (state.layoutKind !== 'touch' || id !== state.layoutId) {
    logger.error('streaming', 'touch api rejected non-selected id', { requestedId: id, selectedId: state.layoutId, layoutKind: state.layoutKind })
    send(response, 404, 'Not found')
    return
  }
  const panel = getTouchPanelManager()?.getPanel(id)
  if (!panel) {
    logger.error('streaming', 'touch api selected id missing', { id })
    send(response, 404, 'Not found')
    return
  }
  sendJson(response, panel, request.method)
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
  if (request.method === 'HEAD') {
    applyCors(response)
    response.writeHead(200, { 'Cache-Control': 'no-store' })
    response.end()
    return
  }
  if (state.clients.size >= MAX_SSE_CLIENTS) {
    send(response, 503, 'Too many streaming clients')
    return
  }
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
  logger.info('streaming', 'client connected', {
    id,
    address: client.address,
    userAgent: client.userAgent,
    count: state.clients.size
  })
  writeSse(response, currentFrame(ctx))
  request.on('close', () => closeClient(id))
}

function closeClient(id: number): void {
  const client = state.clients.get(id)
  if (!client) return
  clearInterval(client.timer)
  if (!client.response.destroyed) client.response.end()
  state.clients.delete(id)
  logger.info('streaming', 'client disconnected', {
    id,
    address: client.address,
    count: state.clients.size
  })
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

function dashboardUrl(origin = baseOrigin()): string | null {
  if (!state.port || !state.token) return null
  const url = new URL(`/obs/${state.layoutId}`, origin)
  url.searchParams.set('token', state.token)
  url.searchParams.set('kind', state.layoutKind)
  if (state.layoutKind === 'touch') url.searchParams.set('panel', state.layoutId)
  else url.searchParams.set('dash', state.layoutId)
  // Password is intentionally NOT embedded in the shareable URL/QR.
  // The stream page will prompt the user to enter it separately.
  return url.toString()
}

function touchControlsUrl(origin = baseOrigin()): string | null {
  void origin
  return null
}

function warning(): string | null {
  if (state.accessMode === 'internet') {
    if (!state.publicBaseUrl) {
      return state.autoTunnelMessage ?? 'No public HTTPS URL is active. Start Auto-tunnel or enter a manual public HTTPS URL.'
    }
    return state.firewallMessage ?? 'Internet mode is read-only and requires the token plus password. Use a trusted HTTPS tunnel/public URL that forwards only this stream port.'
  }
  if (state.accessMode === 'lan') {
    if (!state.lanAddress) {
      return 'No private LAN IPv4 address was found. The server is running, but phone/tablet QR access is unavailable. Connect this PC to Wi-Fi/Ethernet, then restart streaming.'
    }
    return state.firewallMessage ?? `LAN streaming is available over HTTP at ${state.lanAddress}:${state.port ?? 'unknown port'} and still requires the token plus password.`
  }
  return null
}

async function refreshQrCodes(): Promise<void> {
  // Suppress QR codes when there's no usable LAN/public origin; localhost QRs won't work for phones/tablets.
  const shouldGenerateQr = state.accessMode === 'local' || (state.accessMode === 'lan' && state.lanAddress) || (state.accessMode === 'internet' && state.publicBaseUrl)
  const url = shouldGenerateQr ? dashboardUrl() : null
  const touchUrl = shouldGenerateQr ? touchControlsUrl() : null
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
    layoutKind: state.layoutKind,
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
    password: state.passwordPlaintext,
    localTestUrl: state.port ? dashboardUrl(`http://127.0.0.1:${state.port}`) : null,
    firewallMessage: state.firewallMessage,
    passwordEnabled: state.passwordHash !== null,
    warning: warning(),
    autoTunnelAvailable: resolveCloudflaredBinary() !== null,
    autoTunnelEnabled: state.autoTunnelEnabled,
    autoTunnelRunning: state.autoTunnelProcess !== null && state.autoTunnelUrl !== null,
    autoTunnelMessage: state.autoTunnelMessage
  }
}

async function selfTest(): Promise<StreamingSelfTestResult> {
  const url = state.port ? dashboardUrl(`http://127.0.0.1:${state.port}`) : null
  if (!url) return { reachable: false, statusCode: null, url, message: 'Streaming server is not running.' }
  return new Promise((resolveResult) => {
    const startedAt = Date.now()
    const req = httpRequest(url, { method: 'HEAD', timeout: 4_000 }, (res) => {
      res.resume()
      const statusCode = res.statusCode ?? null
      const reachable = statusCode !== null && statusCode >= 200 && statusCode < 400
      const message = reachable
        ? `Reachable from this PC (HTTP ${statusCode}) in ${Date.now() - startedAt} ms.`
        : `Reached server but got HTTP ${statusCode ?? 'unknown'}.`
      logger.info('streaming', 'self-test completed', { reachable, statusCode, url })
      resolveResult({ reachable, statusCode, url, message })
    })
    req.on('timeout', () => req.destroy(new Error('Self-test timed out')))
    req.on('error', (error) => {
      logger.error('streaming', 'self-test failed', { message: error.message, url })
      resolveResult({ reachable: false, statusCode: null, url, message: `Self-test failed: ${error.message}` })
    })
    req.end()
  })
}

async function handleRequest(ctx: ModuleContext, request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const url = new URL(request.url ?? '/', state.port ? baseOrigin() : `http://${HOST}`)
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      rejectMethod(response)
      return
    }
    if (state.accessMode === 'lan' && !isLocalNetworkRequest(request)) {
      logger.warn('streaming', 'LAN request rejected because the source address is not private/local', {
        remoteAddress: request.socket.remoteAddress ?? 'unknown',
        normalizedAddress: normalizeRemoteAddress(request.socket.remoteAddress),
        path: url.pathname
      })
      send(response, 403, 'Forbidden')
      return
    }
    if (isRateLimited(request)) {
      send(response, 429, 'Too many failed auth attempts')
      return
    }
    // /ping and the page/assets use token-only auth so the shareable URL (which
    // contains only the token) can load the stream page. The page then prompts for
    // the password, which is used only for the /sse data stream.
    if (url.pathname === '/ping') {
      if (!hasValidToken(url, request)) {
        recordAuthFailure(request)
        send(response, 403, 'Forbidden')
        return
      }
      clearAuthFailure(request)
      applyCors(response)
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ passwordRequired: state.passwordHash !== null }))
      return
    }
    if (url.pathname.startsWith('/obs/') || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/api/dashboard/') || url.pathname.startsWith('/api/touch/panel/')) {
      if (!hasValidToken(url, request)) {
        recordAuthFailure(request)
        logger.error('streaming', 'request auth failed', { path: url.pathname, remoteAddress: normalizeRemoteAddress(request.socket.remoteAddress) })
        send(response, 403, 'Forbidden')
        return
      }
      clearAuthFailure(request)
      if (url.pathname.startsWith('/obs/')) {
        const layoutId = url.pathname.slice('/obs/'.length)
        if (!isValidLayoutId(layoutId) || layoutId !== state.layoutId) {
          logger.error('streaming', 'obs route rejected layout id', { requestedId: layoutId, selectedId: state.layoutId })
          send(response, 404, 'Not found')
          return
        }
        serveHtml(request, response)
        return
      }
      if (url.pathname.startsWith('/api/dashboard/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/dashboard/'.length))
        if (!isValidLayoutId(id)) {
          logger.error('streaming', 'dashboard api invalid id', { id })
          send(response, 404, 'Not found')
          return
        }
        serveSelectedDashboard(id, request, response)
        return
      }
      if (url.pathname.startsWith('/api/touch/panel/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/touch/panel/'.length))
        if (!isValidLayoutId(id)) {
          logger.error('streaming', 'touch api invalid id', { id })
          send(response, 404, 'Not found')
          return
        }
        serveSelectedTouchPanel(id, request, response)
        return
      }
      serveStatic(url.pathname, request, response)
      return
    }
    // /sse requires full auth (token + password) to protect the live telemetry stream.
    if (!hasValidAuth(url, request)) {
      recordAuthFailure(request)
      send(response, 403, 'Forbidden')
      return
    }
    clearAuthFailure(request)
    if (url.pathname === '/sse') {
      openSse(ctx, request, response)
      return
    }
    send(response, 404, 'Not found')
  } catch (error) {
    logger.error('streaming', 'request failed', {
      message: error instanceof Error ? error.message : String(error),
      url: request.url,
      remoteAddress: normalizeRemoteAddress(request.socket.remoteAddress)
    })
    send(response, 400, 'Bad request')
  }
}

async function stop(): Promise<StreamingStatus> {
  closeAllClients()
  await stopAutoTunnelProcess()
  const server = state.server
  state.server = null
  state.port = null
  state.token = null
  state.passwordHash = null
  state.passwordPlaintext = null
  state.layoutKind = 'dashboard'
  state.layoutId = DEFAULT_LAYOUT
  state.lanEnabled = false
  state.accessMode = 'local'
  state.lanAddress = null
  state.publicBaseUrl = null
  state.manualPublicBaseUrl = null
  state.touchPanelId = null
  state.firewallMessage = null
  state.qrDataUrl = null
  state.touchQrDataUrl = null
  state.autoTunnelEnabled = false
  state.autoTunnelUrl = null
  state.autoTunnelMessage = null
  state.autoTunnelStopRequested = false
  state.authFailures.clear()
  if (server) {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    logger.info('streaming', 'server stopped', {})
  }
  return status()
}

const STABLE_FIREWALL_RULE_NAME = 'Ultimate Sim App Streaming'

interface NetshResult {
  error: Error | null
  stdout: string
  stderr: string
}

function runNetsh(args: string[], timeout: number): Promise<NetshResult> {
  return new Promise((resolveResult) => {
    execFile('netsh', args, { windowsHide: true, timeout, encoding: 'utf8' }, (error, stdout, stderr) => {
      resolveResult({
        error,
        stdout: String(stdout ?? '').trim(),
        stderr: String(stderr ?? '').trim()
      })
    })
  })
}

function netshOutputIndicatesFailure(output: string): boolean {
  return /(requires?\s+elevation|access\s+is\s+denied|\bfailed\b|\bfailure\b|\berror\b|\berro\b|acesso\s+negado|\bfehler\b|\bverweigert\b|\brefus)/i.test(output)
}

async function allowWindowsFirewallPort(port: number): Promise<string | null> {
  if (process.platform !== 'win32') return null

  // Delete any existing rule with the stable name first to avoid accumulating stale rules.
  const deleted = await runNetsh(
    ['advfirewall', 'firewall', 'delete', 'rule', `name=${STABLE_FIREWALL_RULE_NAME}`],
    5_000
  )
  if (deleted.error) {
    logger.warn('streaming', 'existing firewall rule could not be removed before replacement', {
      port,
      message: deleted.error.message,
      stdout: deleted.stdout,
      stderr: deleted.stderr
    })
  }

  const args = [
    'advfirewall',
    'firewall',
    'add',
    'rule',
    `name=${STABLE_FIREWALL_RULE_NAME}`,
    'dir=in',
    'action=allow',
    'enable=yes',
    'protocol=TCP',
    `localport=${port}`
  ]
  const added = await runNetsh(args, 7_500)
  const addOutput = `${added.stdout}\n${added.stderr}`.trim()
  const addFailed = Boolean(added.error) || Boolean(added.stderr) || netshOutputIndicatesFailure(addOutput)

  const verified = addFailed
    ? null
    : await runNetsh(
      ['advfirewall', 'firewall', 'show', 'rule', `name=${STABLE_FIREWALL_RULE_NAME}`, 'verbose'],
      5_000
    )
  const verifyOutput = verified ? `${verified.stdout}\n${verified.stderr}`.trim() : ''
  const verifyFailed = verified !== null && (
    Boolean(verified.error) ||
    Boolean(verified.stderr) ||
    netshOutputIndicatesFailure(verifyOutput) ||
    !new RegExp(`\\b${port}\\b`).test(verifyOutput)
  )

  if (addFailed || verifyFailed) {
    const reason = added.error?.message ||
      verified?.error?.message ||
      added.stderr ||
      verified?.stderr ||
      addOutput.split(/\r?\n/).filter(Boolean).slice(-1)[0] ||
      'the rule could not be verified'
    const message = `Streaming started, but Windows Firewall did not allow TCP port ${port}. Allow "Ultimate Sim App" on Private networks in Windows Security, or restart the app as Administrator and allow inbound TCP port ${port}. Phones/tablets may not connect until this is fixed.`
    logger.warn('streaming', 'firewall rule add/verification failed', {
      port,
      reason,
      addStdout: added.stdout,
      addStderr: added.stderr,
      verifyStdout: verified?.stdout ?? '',
      verifyStderr: verified?.stderr ?? ''
    })
    return message
  }

  logger.info('streaming', 'firewall rule add and verification succeeded', {
    port,
    stdout: added.stdout
  })
  return null
}

async function start(ctx: ModuleContext, args: StreamingStartArgs = {}): Promise<StreamingStartResult> {
  if (state.server || state.autoTunnelProcess) await stop()
  const target = resolveStreamTarget(args)
  state.layoutId = target.id
  state.layoutKind = target.kind
  state.touchPanelId = target.touchPanelId
  state.streamSafe = args.streamSafe ?? true
  state.token = generateToken()
  state.accessMode = args.accessMode === 'internet' || args.accessMode === 'lan'
    ? args.accessMode
    : args.lanEnabled
      ? 'lan'
      : 'local'
  const password = normalizePassword(args.password)
  if (state.accessMode !== 'local' && !password) {
    state.token = null
    throw new Error('LAN/Internet streaming requires a password in addition to the token.')
  }
  state.passwordPlaintext = password
  state.passwordHash = passwordHash(password ?? undefined)
  state.lanEnabled = state.accessMode !== 'local'
  state.lanAddress = state.accessMode !== 'local' ? primaryLanAddress() : null
  state.manualPublicBaseUrl = state.accessMode === 'internet' ? normalizePublicBaseUrl(args.publicBaseUrl) : null
  state.publicBaseUrl = state.manualPublicBaseUrl
  state.autoTunnelEnabled = state.accessMode === 'internet' && args.autoTunnel === true
  state.autoTunnelMessage = null
  if (state.accessMode === 'internet' && !state.publicBaseUrl && !state.autoTunnelEnabled) {
    state.token = null
    state.passwordPlaintext = null
    state.passwordHash = null
    throw new Error('Internet streaming requires a public HTTPS tunnel/base URL or Auto-tunnel.')
  }
  if (state.autoTunnelEnabled && !resolveCloudflaredBinary()) {
    state.autoTunnelMessage = autoTunnelUnavailableMessage()
    state.autoTunnelEnabled = false
    if (!state.publicBaseUrl) {
      state.token = null
      state.passwordPlaintext = null
      state.passwordHash = null
      throw new Error(state.autoTunnelMessage)
    }
  }
  state.firewallMessage = null
  if (state.accessMode !== 'local') {
    if (state.lanAddress) {
      logger.info('streaming', 'private LAN IPv4 selected', { address: state.lanAddress })
    } else {
      logger.warn('streaming', 'no private LAN IPv4 address detected', {
        mode: state.accessMode,
        interfaces: Object.keys(networkInterfaces())
      })
    }
  }
  const server = createServer((request, response) => {
    void handleRequest(ctx, request, response)
  })
  state.server = server
  const listenHost = state.accessMode !== 'local' ? LAN_HOST : HOST
  const listenPort = requestedPort(args.port)
  logger.info('streaming', 'server starting', {
    host: listenHost,
    requestedPort: listenPort,
    mode: state.accessMode,
    layoutId: state.layoutId,
    layoutKind: state.layoutKind
  })
  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      const onError = (error: Error): void => {
        logger.error('streaming', 'server listen failed', {
          host: listenHost,
          requestedPort: listenPort,
          message: error instanceof Error ? error.message : String(error)
        })
        state.server = null
        rejectListen(error)
      }
      server.once('error', onError)
      server.listen(listenPort, listenHost, () => {
        server.off('error', onError)
        resolveListen()
      })
    })
  } catch (error) {
    await stop()
    throw error
  }
  state.port = (server.address() as AddressInfo).port
  logger.info('streaming', 'server listening', {
    host: listenHost,
    port: state.port,
    mode: state.accessMode,
    layoutId: state.layoutId,
    layoutKind: state.layoutKind,
    lanAddress: state.lanAddress,
    lanOrigin: lanOrigin()
  })
  if (state.accessMode !== 'local') {
    state.firewallMessage = await allowWindowsFirewallPort(state.port)
  }
  if (state.autoTunnelEnabled && resolveCloudflaredBinary()) {
    try {
      await launchAutoTunnel()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      state.autoTunnelMessage = message
      logger.warn('streaming', 'auto-tunnel start failed', {
        message,
        manualUrlAvailable: state.manualPublicBaseUrl !== null
      })
      state.autoTunnelEnabled = false
      await stopAutoTunnelProcess()
      if (!state.manualPublicBaseUrl) {
        await stop()
        throw new Error(message)
      }
    }
  }
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
    password: state.passwordPlaintext,
    localTestUrl: state.port ? dashboardUrl(`http://127.0.0.1:${state.port}`) : null,
    firewallMessage: state.firewallMessage,
    warning: warning(),
    autoTunnelAvailable: resolveCloudflaredBinary() !== null,
    autoTunnelEnabled: state.autoTunnelEnabled,
    autoTunnelRunning: state.autoTunnelProcess !== null && state.autoTunnelUrl !== null,
    autoTunnelMessage: state.autoTunnelMessage
  }
}

async function startAutoTunnel(): Promise<StreamingStatus> {
  if (!state.server || !state.port) throw new Error('Start the streaming server before starting Auto-tunnel.')
  if (state.accessMode !== 'internet') throw new Error('Auto-tunnel is only available in Internet mode.')
  state.autoTunnelEnabled = true
  try {
    await launchAutoTunnel()
    await refreshQrCodes()
    return status()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    state.autoTunnelEnabled = false
    state.autoTunnelMessage = message
    logger.warn('streaming', 'auto-tunnel IPC start failed', { message })
    await stopAutoTunnelProcess()
    throw new Error(message)
  }
}

async function stopAutoTunnel(): Promise<StreamingStatus> {
  state.autoTunnelEnabled = false
  await stopAutoTunnelProcess()
  state.autoTunnelMessage = state.server
    ? 'Auto-tunnel stopped. Start it again, or stop streaming and restart with a manual public HTTPS URL.'
    : null
  await refreshQrCodes()
  return status()
}

export function register(ctx: ModuleContext): void {
  ctx.ipcMain.handle(STREAMING_CHANNELS.start, (_event, args?: StreamingStartArgs) => start(ctx, args))
  ctx.ipcMain.handle(STREAMING_CHANNELS.stop, () => stop())
  ctx.ipcMain.handle(STREAMING_CHANNELS.status, () => status())
  ctx.ipcMain.handle(STREAMING_CHANNELS.selfTest, () => selfTest())
  ctx.ipcMain.handle(STREAMING_CHANNELS.startTunnel, () => startAutoTunnel())
  ctx.ipcMain.handle(STREAMING_CHANNELS.stopTunnel, () => stopAutoTunnel())
  ctx.app.once('before-quit', () => {
    void stop()
  })
}
