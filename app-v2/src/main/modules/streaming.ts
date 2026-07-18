import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, request as nodeHttpRequest, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { request as nodeHttpsRequest } from 'node:https'
import { extname, join, normalize, relative, resolve, sep } from 'node:path'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { isIP, type AddressInfo } from 'node:net'
import { networkInterfaces } from 'node:os'
import QRCode from 'qrcode'
import type { DriverEntry, RadarCarEntry, RelativeCarEntry, TelemetrySnapshot } from '../../shared/telemetry'
import type {
  StreamingAccessMode,
  StreamingDashboardPayload,
  StreamingLayoutKind,
  StreamingSelfTestResult,
  StreamingStartArgs,
  StreamingStartResult,
  StreamingStatus,
  StreamingTelemetryFrame,
  StreamingTouchActionRequest,
  StreamingTouchActionResponse,
  StreamingTouchCapability,
  StreamingTouchHealth,
  StreamingTouchHealthResponse,
  StreamingTouchPanelPayload,
  StreamingTouchRole
} from '../../shared/streaming'
import { STREAMING_CHANNELS, STREAMING_EXPRESSION_EXCLUSION_MESSAGE } from '../../shared/streaming'
import {
  normalizeTouchSemanticActionRequest,
  type ButtonAction,
  type ButtonBoxButton,
  type ButtonBoxPanel,
  type TouchActionPhase
} from '../../shared/touch-panel'
import type { ModuleContext } from '../module-context'
import { getDashboardManager } from './dashboards'
import { logger } from './logger'
import { getTouchPanelManager } from '../touchpanel/manager'
import {
  executeTouchSemanticAction,
  hasTouchSemanticActionRuntime,
  releaseTouchSemanticActionOwner
} from '../actions/touch-owner'

const HOST = '127.0.0.1'
const LAN_HOST = '0.0.0.0'
const DEFAULT_LAYOUT = 'default'
const SSE_INTERVAL_MS = 67
const TOKEN_BYTES = 24
const SESSION_BYTES = 32
const CSRF_BYTES = 24
const NONCE_BYTES = 18
const CAPABILITY_BYTES = 18
const SESSION_COOKIE_NAME = 'ultimate_sim_stream_session'
const LOCAL_SESSION_TTL_MS = 60 * 60 * 1000
const REMOTE_SESSION_TTL_MS = 15 * 60 * 1000
const MAX_BOOTSTRAP_SESSIONS = 64
const MAX_AUTHENTICATED_SESSIONS = 64
const AUTH_FAILURE_WINDOW_MS = 60_000
const AUTH_FAILURE_LIMIT = 10
const INTERACTION_BURST_WINDOW_MS = 1_000
const INTERACTION_BURST_LIMIT = 30
const INTERACTION_SUSTAINED_WINDOW_MS = 60_000
const INTERACTION_SUSTAINED_LIMIT = 300
const MAX_SSE_CLIENTS = 12
const SELF_TEST_TIMEOUT_MS = 5_000
const SELF_TEST_MAX_RESOURCES = 512
const SELF_TEST_MAX_BODY_BYTES = 16 * 1024 * 1024
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
  sessionId: string
}

type StreamingSessionAccess = 'bootstrap' | 'authenticated'

interface StreamingSession {
  access: StreamingSessionAccess
  role: StreamingTouchRole
  basePath: string
  origin: string
  targetKind: StreamingLayoutKind
  targetId: string
  expiresAt: number
  csrfToken: string
  replayNonce: string
  activeTokens: Set<string>
  lastFeedback: string | null
  expiryTimer: ReturnType<typeof setTimeout> | null
}

interface StreamingTouchCapabilityEntry extends StreamingTouchCapability {
  action: ButtonAction
  token: string
  fingerprint: string
  executePhases: TouchActionPhase[]
}

interface InteractionRateState {
  timestamps: number[]
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
  sessions: Map<string, StreamingSession>
  touchCapabilities: Map<string, StreamingTouchCapabilityEntry>
  interactionRates: Map<string, InteractionRateState>
  interactionHealth: StreamingTouchHealth
  lastInteractionFeedback: string | null
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
  sessions: new Map(),
  touchCapabilities: new Map(),
  interactionRates: new Map(),
  interactionHealth: 'read-only',
  lastInteractionFeedback: null,
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

function generateSecret(bytes: number): string {
  return randomBytes(bytes).toString('base64url')
}

function configuredSessionTtlMs(): number {
  const fallback = state.accessMode === 'local' ? LOCAL_SESSION_TTL_MS : REMOTE_SESSION_TTL_MS
  if (process.env.NODE_ENV !== 'test') return fallback
  const configured = Number(process.env.ULTIMATE_SIM_STREAM_SESSION_TTL_MS)
  return Number.isFinite(configured) && configured >= 50 ? Math.floor(configured) : fallback
}

function actionFingerprint(action: ButtonAction): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)])
    )
  }
  return JSON.stringify(canonical(action))
}

function isStreamCapabilityAction(action: ButtonAction): boolean {
  if (action.kind === 'none' || action.kind === 'app') return false
  const phase: TouchActionPhase = action.kind === 'keyboard' && action.command.mode === 'hold'
    ? 'begin'
    : 'trigger'
  return normalizeTouchSemanticActionRequest({
    action,
    phase,
    token: 'stream:validation',
    zone: 'validation'
  }) !== null
}

function publicCapabilityAction(action: ButtonAction): ButtonAction {
  if (!isStreamCapabilityAction(action)) return { kind: 'none' }
  if (action.kind === 'iracing') {
    return { kind: 'iracing', command: { group: 'blackBox', name: 'blackBox:next' } }
  }
  if (action.kind !== 'keyboard') return { kind: 'none' }
  return {
    kind: 'keyboard',
    command: {
      mode: action.command.mode,
      keys: ['StreamCapability'],
      ...(action.command.repeatMs !== undefined ? { repeatMs: action.command.repeatMs } : {})
    }
  }
}

interface TouchCapabilitySpec {
  controlId: string
  zone: string
  action: ButtonAction
  token: string
  phases: TouchActionPhase[]
  executePhases: TouchActionPhase[]
}

function capabilityPhases(action: ButtonAction): Pick<TouchCapabilitySpec, 'phases' | 'executePhases'> {
  if (action.kind === 'keyboard' && action.command.mode === 'hold') {
    return {
      phases: ['begin', 'end', 'cancel'],
      executePhases: ['begin', 'end', 'cancel']
    }
  }
  if (action.kind === 'keyboard' && action.command.mode === 'toggle') {
    return {
      phases: ['trigger', 'cancel'],
      executePhases: ['trigger', 'cancel']
    }
  }
  return {
    phases: ['trigger', 'end', 'cancel'],
    executePhases: ['trigger']
  }
}

function capabilitySpec(
  button: ButtonBoxButton,
  zone: string,
  action: ButtonAction,
  tokenZone = zone
): TouchCapabilitySpec | null {
  if (!isStreamCapabilityAction(action)) return null
  return {
    controlId: button.id,
    zone,
    action,
    token: `${button.id}:${tokenZone}`,
    ...capabilityPhases(action)
  }
}

function capabilitySpecsForButton(button: ButtonBoxButton): TouchCapabilitySpec[] {
  const control = button.control
  switch (control.kind) {
    case 'momentary': {
      const spec = capabilitySpec(button, 'main', control.action)
      return spec ? [spec] : []
    }
    case 'latching-toggle': {
      if (!isStreamCapabilityAction(control.onAction) || !isStreamCapabilityAction(control.offAction)) return []
      const on = capabilitySpec(button, 'on', control.onAction, 'latching')
      const off = capabilitySpec(button, 'off', control.offAction, 'latching')
      const teardown = control.onAction.kind === 'keyboard' && control.onAction.command.mode === 'toggle'
        ? capabilitySpec(button, 'teardown', control.onAction, 'latching')
        : null
      return [on, off, teardown].filter((value): value is TouchCapabilitySpec => value !== null)
    }
    case 'two-position-rocker':
      return [
        capabilitySpec(button, 'negative', control.negativeAction),
        capabilitySpec(button, 'positive', control.positiveAction)
      ].filter((value): value is TouchCapabilitySpec => value !== null)
    case 'guarded-two-step': {
      const spec = capabilitySpec(button, 'guarded', control.action)
      return spec ? [spec] : []
    }
    case 'rotary':
      return [
        capabilitySpec(button, 'decrement', control.decrementAction),
        capabilitySpec(button, 'increment', control.incrementAction)
      ].filter((value): value is TouchCapabilitySpec => value !== null)
    case 'selector':
      return control.choices
        .map((choice) => capabilitySpec(button, `choice:${choice.id}`, choice.action))
        .filter((value): value is TouchCapabilitySpec => value !== null)
    case 'status-led':
    case 'value-tile':
      return []
  }
}

function rebuildTouchCapabilities(panel: ButtonBoxPanel): void {
  state.touchCapabilities.clear()
  for (const button of panel.buttons) {
    for (const spec of capabilitySpecsForButton(button)) {
      const id = generateSecret(CAPABILITY_BYTES)
      state.touchCapabilities.set(id, {
        id,
        ...spec,
        fingerprint: actionFingerprint(spec.action)
      })
    }
  }
  state.interactionHealth = hasTouchSemanticActionRuntime() && state.touchCapabilities.size > 0
    ? 'ready'
    : 'degraded'
}

function capabilityFor(
  controlId: string,
  zone: string,
  action?: ButtonAction
): StreamingTouchCapabilityEntry | null {
  return [...state.touchCapabilities.values()].find((entry) =>
    entry.controlId === controlId &&
    entry.zone === zone &&
    (action === undefined || entry.fingerprint === actionFingerprint(action))
  ) ?? null
}

function projectTouchPanelForStreaming(panel: ButtonBoxPanel): ButtonBoxPanel {
  const buttons = panel.buttons.map((button): ButtonBoxButton => {
    const project = (zone: string, action: ButtonAction): ButtonAction =>
      capabilityFor(button.id, zone, action) ? publicCapabilityAction(action) : { kind: 'none' }
    let control = button.control
    switch (control.kind) {
      case 'momentary':
        control = { ...control, action: project('main', control.action) }
        break
      case 'latching-toggle':
        control = {
          ...control,
          onAction: project('on', control.onAction),
          offAction: project('off', control.offAction)
        }
        break
      case 'two-position-rocker':
        control = {
          ...control,
          negativeAction: project('negative', control.negativeAction),
          positiveAction: project('positive', control.positiveAction)
        }
        break
      case 'guarded-two-step':
        control = { ...control, action: project('guarded', control.action) }
        break
      case 'rotary':
        control = {
          ...control,
          decrementAction: project('decrement', control.decrementAction),
          incrementAction: project('increment', control.incrementAction)
        }
        break
      case 'selector':
        control = {
          ...control,
          choices: control.choices.map((choice) => ({
            ...choice,
            action: project(`choice:${choice.id}`, choice.action)
          }))
        }
        break
      case 'status-led':
      case 'value-tile':
        break
    }
    const interactiveControl = control.kind !== 'status-led' && control.kind !== 'value-tile'
    const enabled = capabilitySpecsForButton(button).some((spec) =>
      capabilityFor(spec.controlId, spec.zone, spec.action) !== null
    )
    return {
      ...button,
      control,
      state: interactiveControl && !enabled
        ? { ...button.state, disabled: true }
        : button.state
    }
  })
  return { ...panel, buttons }
}

function currentCapabilityAction(entry: StreamingTouchCapabilityEntry): ButtonAction | null {
  const panel = getTouchPanelManager()?.getPanel(state.layoutId)
  const button = panel?.buttons.find((candidate) => candidate.id === entry.controlId)
  if (!button) return null
  const current = capabilitySpecsForButton(button).find((spec) =>
    spec.controlId === entry.controlId &&
    spec.zone === entry.zone &&
    spec.token === entry.token
  )
  if (!current || actionFingerprint(current.action) !== entry.fingerprint) return null
  return current.action
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

function normalizedBasePath(pathname: string): string {
  const withLeadingSlash = pathname.startsWith('/') ? pathname : `/${pathname}`
  const trimmed = withLeadingSlash.replace(/\/+$/, '')
  return trimmed && trimmed !== '/' ? `${trimmed}/` : '/'
}

function normalizePublicBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
    parsed.search = ''
    parsed.hash = ''
    const basePath = normalizedBasePath(parsed.pathname)
    return basePath === '/' ? parsed.origin : `${parsed.origin}${basePath.slice(0, -1)}`
  } catch {
    return null
  }
}

function basePathFromUrl(value: string | null): string {
  if (!value) return '/'
  try {
    return normalizedBasePath(new URL(value).pathname)
  } catch {
    return '/'
  }
}

function urlFromBase(baseUrl: string, relativePath: string): URL {
  const base = new URL(baseUrl)
  base.pathname = normalizedBasePath(base.pathname)
  base.search = ''
  base.hash = ''
  return new URL(relativePath.replace(/^\/+/, ''), base)
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

export function publicBaseUrlAfterTunnelStops(
  currentPublicBaseUrl: string | null,
  tunnelUrl: string | null,
  manualPublicBaseUrl: string | null
): string | null {
  return tunnelUrl && currentPublicBaseUrl === tunnelUrl ? manualPublicBaseUrl : currentPublicBaseUrl
}

async function stopAutoTunnelProcess(): Promise<void> {
  const child = state.autoTunnelProcess
  const tunnelUrl = state.autoTunnelUrl
  state.autoTunnelProcess = null
  state.autoTunnelUrl = null
  state.publicBaseUrl = publicBaseUrlAfterTunnelStops(state.publicBaseUrl, tunnelUrl, state.manualPublicBaseUrl)
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
        state.publicBaseUrl = publicBaseUrlAfterTunnelStops(state.publicBaseUrl, tunnelUrl, state.manualPublicBaseUrl)
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

interface StreamingRequestRoute {
  url: URL
  pathname: string
  externalBasePath: string
}

function firstForwardedValue(value: string | null): string {
  return value?.split(',', 1)[0]?.trim() ?? ''
}

function requestRoute(request: IncomingMessage): StreamingRequestRoute {
  const url = new URL(request.url ?? '/', state.port ? `http://${HOST}:${state.port}` : `http://${HOST}`)
  const configuredBasePath = basePathFromUrl(state.publicBaseUrl)
  let pathname = url.pathname
  let externalBasePath = '/'

  if (configuredBasePath !== '/') {
    const prefix = configuredBasePath.slice(0, -1)
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      pathname = pathname.slice(prefix.length) || '/'
      externalBasePath = configuredBasePath
    } else {
      const forwardedPrefix = normalizedBasePath(firstForwardedValue(headerValue(request, 'x-forwarded-prefix')) || '/')
      const forwardedProto = firstForwardedValue(headerValue(request, 'x-forwarded-proto')).toLowerCase()
      const requestHost = firstForwardedValue(headerValue(request, 'x-forwarded-host') ?? headerValue(request, 'host')).toLowerCase()
      let publicHost = ''
      try {
        publicHost = state.publicBaseUrl ? new URL(state.publicBaseUrl).host.toLowerCase() : ''
      } catch {
        publicHost = ''
      }
      if (forwardedPrefix === configuredBasePath || forwardedProto === 'https' || (publicHost && requestHost === publicHost)) {
        externalBasePath = configuredBasePath
      }
    }
  }

  return { url, pathname, externalBasePath }
}

function normalizedRequestOrigin(request: IncomingMessage): string | null {
  if (state.accessMode === 'internet') {
    if (!state.publicBaseUrl) return null
    const publicUrl = new URL(state.publicBaseUrl)
    const forwardedProto = firstForwardedValue(headerValue(request, 'x-forwarded-proto')).toLowerCase()
    const forwardedHost = firstForwardedValue(headerValue(request, 'x-forwarded-host')).toLowerCase()
    const requestHost = firstForwardedValue(headerValue(request, 'host')).toLowerCase()
    const effectiveHost = forwardedHost || requestHost
    if (effectiveHost && effectiveHost !== publicUrl.host.toLowerCase()) return null
    if (forwardedProto && forwardedProto !== 'https') return null
    return publicUrl.origin
  }

  const host = firstForwardedValue(headerValue(request, 'host'))
  if (!host) return null
  try {
    const origin = new URL(`http://${host}`)
    const hostname = origin.hostname.toLowerCase()
    const allowed = hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname === '::1' ||
      (state.lanAddress !== null && hostname === state.lanAddress.toLowerCase())
    if (!allowed) return null
    if (state.port && origin.port && Number(origin.port) !== state.port) return null
    return origin.origin
  } catch {
    return null
  }
}

function hasBoundInteractionOrigin(request: IncomingMessage, session: StreamingSession): boolean {
  const value = headerValue(request, 'origin')
  if (!value || value === 'null') return false
  try {
    return new URL(value).origin === session.origin
  } catch {
    return false
  }
}

function streamSessionOwnerKey(sessionId: string): string {
  return `stream-session-${sessionId}`
}

function removeInteractionRatesForSession(sessionId: string): void {
  for (const key of state.interactionRates.keys()) {
    if (key.startsWith(`session:${sessionId}:`)) state.interactionRates.delete(key)
  }
}

async function releaseSessionInteraction(sessionId: string, session: StreamingSession, reason: string): Promise<void> {
  if (session.activeTokens.size === 0) {
    removeInteractionRatesForSession(sessionId)
    return
  }
  session.activeTokens.clear()
  removeInteractionRatesForSession(sessionId)
  try {
    await releaseTouchSemanticActionOwner(streamSessionOwnerKey(sessionId))
    logger.info('streaming', 'interactive touch owner released', { reason })
  } catch (error) {
    state.interactionHealth = 'degraded'
    state.lastInteractionFeedback = 'A held Touch control could not be released cleanly.'
    logger.error('streaming', 'interactive touch owner release failed', {
      reason,
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

function scheduleSessionExpiry(sessionId: string, session: StreamingSession): void {
  if (session.expiryTimer) clearTimeout(session.expiryTimer)
  session.expiryTimer = setTimeout(() => {
    const current = state.sessions.get(sessionId)
    if (current !== session) return
    if (current.expiresAt > Date.now()) {
      scheduleSessionExpiry(sessionId, current)
      return
    }
    state.sessions.delete(sessionId)
    current.expiryTimer = null
    void releaseSessionInteraction(sessionId, current, 'session-expired')
    for (const client of [...state.clients.values()]) {
      if (client.sessionId === sessionId) closeClient(client.id)
    }
  }, Math.max(1, session.expiresAt - Date.now()))
  session.expiryTimer.unref?.()
}

function deleteStreamingSession(sessionId: string, reason: string): void {
  const session = state.sessions.get(sessionId)
  if (!session) return
  state.sessions.delete(sessionId)
  if (session.expiryTimer) clearTimeout(session.expiryTimer)
  session.expiryTimer = null
  void releaseSessionInteraction(sessionId, session, reason)
}

function cleanupExpiredSessions(now = Date.now()): void {
  for (const [id, session] of state.sessions) {
    if (session.expiresAt <= now) deleteStreamingSession(id, 'session-expired')
  }
}

function serializeSessionCookie(sessionId: string, session: StreamingSession): string {
  const maxAgeSeconds = Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1_000))
  const attributes = [
    `${SESSION_COOKIE_NAME}=${sessionId}`,
    `Path=${session.basePath}`,
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Strict'
  ]
  if (state.accessMode === 'internet') attributes.push('Secure')
  return attributes.join('; ')
}

function sessionCount(access: StreamingSessionAccess): number {
  let count = 0
  for (const session of state.sessions.values()) {
    if (session.access === access) count += 1
  }
  return count
}

function oldestSessionId(access: StreamingSessionAccess): string | null {
  for (const [id, session] of state.sessions) {
    if (session.access === access) return id
  }
  return null
}

function createSession(
  request: IncomingMessage,
  route: StreamingRequestRoute,
  access: StreamingSessionAccess
): { id: string; cookie: string } | null {
  cleanupExpiredSessions()
  if (access === 'bootstrap') {
    while (sessionCount('bootstrap') >= MAX_BOOTSTRAP_SESSIONS) {
      const oldestBootstrap = oldestSessionId('bootstrap')
      if (!oldestBootstrap) break
      deleteStreamingSession(oldestBootstrap, 'bootstrap-evicted')
    }
  } else if (sessionCount('authenticated') >= MAX_AUTHENTICATED_SESSIONS) {
    return null
  }
  const origin = normalizedRequestOrigin(request)
  if (!origin) return null
  const id = randomBytes(SESSION_BYTES).toString('base64url')
  const session: StreamingSession = {
    access,
    role: access === 'authenticated' && state.layoutKind === 'touch' ? 'touch-controller' : 'viewer',
    basePath: route.externalBasePath,
    origin,
    targetKind: state.layoutKind,
    targetId: state.layoutId,
    expiresAt: Date.now() + configuredSessionTtlMs(),
    csrfToken: generateSecret(CSRF_BYTES),
    replayNonce: generateSecret(NONCE_BYTES),
    activeTokens: new Set(),
    lastFeedback: null,
    expiryTimer: null
  }
  state.sessions.set(id, session)
  scheduleSessionExpiry(id, session)
  return { id, cookie: serializeSessionCookie(id, session) }
}

function cookieValue(request: IncomingMessage, name: string): string | null {
  const raw = headerValue(request, 'cookie')
  if (!raw) return null
  for (const pair of raw.split(';')) {
    const separator = pair.indexOf('=')
    if (separator < 0) continue
    if (pair.slice(0, separator).trim() === name) return pair.slice(separator + 1).trim()
  }
  return null
}

function sessionForRequest(request: IncomingMessage, route: StreamingRequestRoute): { id: string; session: StreamingSession } | null {
  cleanupExpiredSessions()
  const id = cookieValue(request, SESSION_COOKIE_NAME)
  if (!id || !/^[A-Za-z0-9_-]{32,128}$/.test(id)) return null
  const session = state.sessions.get(id)
  if (
    !session ||
    session.basePath !== route.externalBasePath ||
    session.targetKind !== state.layoutKind ||
    session.targetId !== state.layoutId
  ) return null
  return { id, session }
}

type AuthenticationAttemptKind = 'token' | 'password'

function authFailureKey(request: IncomingMessage, kind: AuthenticationAttemptKind): string {
  return `${normalizeRemoteAddress(request.socket.remoteAddress)}:${kind}`
}

function isRateLimited(request: IncomingMessage, kind: AuthenticationAttemptKind): boolean {
  const key = authFailureKey(request, kind)
  const now = Date.now()
  const current = state.authFailures.get(key)
  if (!current || current.resetAt <= now) {
    state.authFailures.delete(key)
    return false
  }
  return current.count >= AUTH_FAILURE_LIMIT
}

function recordAuthFailure(request: IncomingMessage, kind: AuthenticationAttemptKind): void {
  const key = authFailureKey(request, kind)
  const now = Date.now()
  const current = state.authFailures.get(key)
  if (!current || current.resetAt <= now) {
    state.authFailures.set(key, { count: 1, resetAt: now + AUTH_FAILURE_WINDOW_MS })
    return
  }
  current.count += 1
}

function clearAuthFailure(request: IncomingMessage, kind: AuthenticationAttemptKind): void {
  state.authFailures.delete(authFailureKey(request, kind))
}

function rendererDir(): string {
  if (process.env.NODE_ENV === 'test' && process.env.ULTIMATE_SIM_STREAM_RENDERER_DIR) {
    return resolve(process.env.ULTIMATE_SIM_STREAM_RENDERER_DIR)
  }
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
    case '.avif': return 'image/avif'
    case '.gif': return 'image/gif'
    case '.ico': return 'image/x-icon'
    case '.json': return 'application/json; charset=utf-8'
    case '.wasm': return 'application/wasm'
    case '.woff': return 'font/woff'
    case '.woff2': return 'font/woff2'
    case '.ttf': return 'font/ttf'
    case '.otf': return 'font/otf'
    default: return 'application/octet-stream'
  }
}

function applyCors(response: ServerResponse): void {
  response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
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

function hasValidToken(url: URL, request: IncomingMessage): boolean {
  return safeTokenEqual(url.searchParams.get('token') ?? headerValue(request, 'x-stream-token'), state.token)
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

function ensureStreamBaseHref(html: string): string {
  if (/<base\b[^>]*href=/i.test(html)) return html
  return html.replace(/<head(\s[^>]*)?>/i, (head) => `${head}<base href="../" />`)
}

function devFallbackHtml(): string {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!devUrl) {
    return '<!doctype html><html><body style="margin:0;background:#05070d;color:white;font-family:sans-serif">stream page not built yet</body></html>'
  }
  const origin = new URL(devUrl).origin
  return `<!doctype html><html><head><base href="../"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"><title>Ultimate Sim App Stream</title></head><body><div id="root"></div><script type="module" src="${origin}/src/stream/main.tsx"></script></body></html>`
}

function serveHtml(request: IncomingMessage, response: ServerResponse, sessionCookie?: string): void {
  // In dev (electron-vite sets ELECTRON_RENDERER_URL), serve a shim that loads the
  // transpiled stream entry from the vite origin; the raw source stream.html would
  // otherwise 404 its .tsx <script>. In production we serve the built stream.html.
  const htmlPath = process.env.ELECTRON_RENDERER_URL ? null : findRendererHtml('stream.html')
  const html = htmlPath ? readFileSync(htmlPath, 'utf8') : devFallbackHtml()
  applyCors(response)
  if (sessionCookie) response.setHeader('Set-Cookie', sessionCookie)
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(request.method === 'HEAD' ? undefined : ensureStreamBaseHref(html))
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
  createReadStream(target).pipe(response)
}

function sendJson(response: ServerResponse, body: unknown, method: string | undefined): void {
  sendJsonStatus(response, 200, body, method)
}

function sendJsonStatus(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  method?: string
): void {
  applyCors(response)
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(method === 'HEAD' ? undefined : JSON.stringify(body))
}

async function readRequestBody(request: IncomingMessage, limit = 4_096): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > limit) throw new Error('Request body is too large.')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function exchangePasswordSession(
  request: IncomingMessage,
  response: ServerResponse,
  route: StreamingRequestRoute
): Promise<void> {
  const active = sessionForRequest(request, route)
  if (!active) {
    send(response, 403, 'Forbidden')
    return
  }
  if (isRateLimited(request, 'password')) {
    send(response, 429, 'Too many failed authentication attempts')
    return
  }
  if (!/^application\/json(?:;|$)/i.test(headerValue(request, 'content-type') ?? '')) {
    send(response, 415, 'Expected application/json')
    return
  }

  let password: string | null = null
  try {
    const parsed = JSON.parse(await readRequestBody(request)) as { password?: unknown }
    password = typeof parsed.password === 'string' ? parsed.password : null
  } catch (error) {
    send(response, error instanceof SyntaxError ? 400 : 413, error instanceof SyntaxError ? 'Invalid JSON' : 'Request body is too large')
    return
  }

  if (state.passwordHash && !verifyPassword(password, state.passwordHash)) {
    recordAuthFailure(request, 'password')
    send(response, 403, 'Forbidden')
    return
  }

  clearAuthFailure(request, 'password')
  if (active.session.access === 'bootstrap' && sessionCount('authenticated') >= MAX_AUTHENTICATED_SESSIONS) {
    send(response, 503, 'Too many authenticated streaming sessions')
    return
  }
  active.session.access = 'authenticated'
  active.session.role = active.session.targetKind === 'touch' ? 'touch-controller' : 'viewer'
  active.session.expiresAt = Date.now() + configuredSessionTtlMs()
  active.session.csrfToken = generateSecret(CSRF_BYTES)
  active.session.replayNonce = generateSecret(NONCE_BYTES)
  scheduleSessionExpiry(active.id, active.session)
  applyCors(response)
  response.setHeader('Set-Cookie', serializeSessionCookie(active.id, active.session))
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify({ authenticated: true }))
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
  const payload: StreamingDashboardPayload = {
    dashboard,
    expressionContent: {
      mode: 'excluded',
      message: STREAMING_EXPRESSION_EXCLUSION_MESSAGE
    }
  }
  sendJson(response, payload, request.method)
}

function publicTouchCapabilities(): StreamingTouchCapability[] {
  return [...state.touchCapabilities.values()]
    .filter((entry) => currentCapabilityAction(entry) !== null)
    .map(({ id, controlId, zone, phases }) => ({
      id,
      controlId,
      zone,
      phases: [...phases]
    }))
}

function resolvedInteractionHealth(): StreamingTouchHealth {
  if (state.layoutKind !== 'touch') return 'read-only'
  return hasTouchSemanticActionRuntime() ? state.interactionHealth : 'degraded'
}

function interactionSessionPayload(session: StreamingSession): StreamingTouchPanelPayload['interaction'] {
  return {
    interactive: session.role === 'touch-controller',
    indicator: 'INTERACTIVE TOUCH',
    role: session.role,
    health: resolvedInteractionHealth(),
    targetId: session.targetId,
    csrfToken: session.csrfToken,
    nonce: session.replayNonce,
    expiresAt: session.expiresAt,
    capabilities: publicTouchCapabilities(),
    activeControls: session.activeTokens.size,
    lastFeedback: session.lastFeedback
  }
}

function interactionHealthPayload(session: StreamingSession): StreamingTouchHealthResponse {
  return {
    interactive: session.role === 'touch-controller',
    indicator: 'INTERACTIVE TOUCH',
    role: session.role,
    health: resolvedInteractionHealth(),
    targetId: session.targetId,
    expiresAt: session.expiresAt,
    activeControls: session.activeTokens.size,
    lastFeedback: session.lastFeedback
  }
}

function serveSelectedTouchPanel(
  id: string,
  request: IncomingMessage,
  response: ServerResponse,
  activeSession: { id: string; session: StreamingSession }
): void {
  if (state.layoutKind !== 'touch' || id !== state.layoutId) {
    logger.error('streaming', 'touch api rejected non-selected id', { requestedId: id, selectedId: state.layoutId, layoutKind: state.layoutKind })
    send(response, 404, 'Not found')
    return
  }
  if (activeSession.session.access !== 'authenticated' || activeSession.session.role !== 'touch-controller') {
    send(response, 403, 'Forbidden')
    return
  }
  const panel = getTouchPanelManager()?.getPanel(id)
  if (!panel) {
    logger.error('streaming', 'touch api selected id missing', { id })
    send(response, 404, 'Not found')
    return
  }
  const payload: StreamingTouchPanelPayload = {
    panel: projectTouchPanelForStreaming(panel),
    interaction: interactionSessionPayload(activeSession.session)
  }
  sendJson(response, payload, request.method)
}

function consumeInteractionRate(key: string, now: number): boolean {
  const current = state.interactionRates.get(key) ?? { timestamps: [] }
  current.timestamps = current.timestamps.filter((timestamp) => now - timestamp < INTERACTION_SUSTAINED_WINDOW_MS)
  const burstCount = current.timestamps.filter((timestamp) => now - timestamp < INTERACTION_BURST_WINDOW_MS).length
  if (
    burstCount >= INTERACTION_BURST_LIMIT ||
    current.timestamps.length >= INTERACTION_SUSTAINED_LIMIT
  ) {
    state.interactionRates.set(key, current)
    return true
  }
  current.timestamps.push(now)
  state.interactionRates.set(key, current)
  return false
}

function isInteractionRateLimited(
  sessionId: string,
  request: IncomingMessage,
  now = Date.now()
): boolean {
  const address = normalizeRemoteAddress(request.socket.remoteAddress)
  return consumeInteractionRate(`session:${sessionId}:${address}`, now) ||
    consumeInteractionRate(`ip:${address}`, now)
}

function updateActiveInteraction(
  session: StreamingSession,
  capability: StreamingTouchCapabilityEntry,
  phase: TouchActionPhase
): void {
  if (capability.action.kind !== 'keyboard') return
  const mode = capability.action.command.mode
  if (mode === 'hold') {
    if (phase === 'begin') session.activeTokens.add(capability.token)
    if (phase === 'end' || phase === 'cancel') session.activeTokens.delete(capability.token)
    return
  }
  if (mode !== 'toggle') return
  if (phase === 'cancel' || capability.zone === 'off' || capability.zone === 'teardown') {
    session.activeTokens.delete(capability.token)
    return
  }
  if (capability.zone === 'on') {
    session.activeTokens.add(capability.token)
    return
  }
  if (session.activeTokens.has(capability.token)) session.activeTokens.delete(capability.token)
  else session.activeTokens.add(capability.token)
}

function isStreamingTouchActionRequest(value: unknown): value is StreamingTouchActionRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Record<string, unknown>
  if (!Object.keys(request).every((key) => ['targetId', 'capabilityId', 'phase', 'nonce'].includes(key))) return false
  return (
    typeof request.targetId === 'string' &&
    isValidLayoutId(request.targetId) &&
    typeof request.capabilityId === 'string' &&
    /^[A-Za-z0-9_-]{16,128}$/.test(request.capabilityId) &&
    ['trigger', 'begin', 'end', 'cancel'].includes(String(request.phase)) &&
    typeof request.nonce === 'string' &&
    /^[A-Za-z0-9_-]{16,128}$/.test(request.nonce)
  )
}

async function executeTouchInteraction(
  request: IncomingMessage,
  response: ServerResponse,
  route: StreamingRequestRoute,
  id: string
): Promise<void> {
  const active = sessionForRequest(request, route)
  if (!active || active.session.access !== 'authenticated') {
    send(response, 403, 'Forbidden')
    return
  }
  const session = active.session
  if (
    state.layoutKind !== 'touch' ||
    id !== state.layoutId ||
    session.role !== 'touch-controller' ||
    session.targetKind !== 'touch' ||
    session.targetId !== id
  ) {
    send(response, 403, 'Interactive Touch role required')
    return
  }
  if (!hasBoundInteractionOrigin(request, session)) {
    send(response, 403, 'Forbidden origin')
    return
  }
  if (!safeTokenEqual(headerValue(request, 'x-stream-csrf'), session.csrfToken)) {
    send(response, 403, 'Invalid CSRF token')
    return
  }
  if (!/^application\/json(?:;|$)/i.test(headerValue(request, 'content-type') ?? '')) {
    send(response, 415, 'Expected application/json')
    return
  }

  let body: unknown
  try {
    body = JSON.parse(await readRequestBody(request, 2_048))
  } catch (error) {
    send(response, error instanceof SyntaxError ? 400 : 413, error instanceof SyntaxError ? 'Invalid JSON' : 'Request body is too large')
    return
  }
  if (!isStreamingTouchActionRequest(body) || body.targetId !== id) {
    send(response, 400, 'Invalid Touch capability request')
    return
  }
  if (!safeTokenEqual(body.nonce, session.replayNonce)) {
    const replay: StreamingTouchActionResponse = {
      ok: false,
      message: 'Replay or stale interaction nonce rejected.',
      health: resolvedInteractionHealth(),
      nextNonce: session.replayNonce,
      activeControls: session.activeTokens.size
    }
    sendJsonStatus(response, 409, replay)
    return
  }

  if (isInteractionRateLimited(active.id, request)) {
    send(response, 429, 'Touch interaction rate limit exceeded')
    return
  }
  const capability = state.touchCapabilities.get(body.capabilityId)
  if (
    !capability ||
    !capability.phases.includes(body.phase) ||
    !currentCapabilityAction(capability)
  ) {
    send(response, 403, 'Touch capability is not allowed')
    return
  }

  session.replayNonce = generateSecret(NONCE_BYTES)
  let result = { ok: true, message: `${capability.controlId} ${body.phase} acknowledged.` }
  if (capability.executePhases.includes(body.phase)) {
    const semanticRequest = normalizeTouchSemanticActionRequest({
      action: capability.action,
      phase: body.phase,
      token: capability.token,
      zone: capability.zone
    })
    if (!semanticRequest) {
      result = { ok: false, message: 'Touch capability failed semantic validation.' }
    } else {
      result = await executeTouchSemanticAction(semanticRequest, streamSessionOwnerKey(active.id))
    }
  }

  if (result.ok) {
    updateActiveInteraction(session, capability, body.phase)
    state.interactionHealth = 'ready'
  } else {
    state.interactionHealth = 'degraded'
  }
  session.lastFeedback = result.message
  state.lastInteractionFeedback = result.message
  const payload: StreamingTouchActionResponse = {
    ok: result.ok,
    message: result.message,
    health: resolvedInteractionHealth(),
    nextNonce: session.replayNonce,
    controlId: capability.controlId,
    phase: body.phase,
    activeControls: session.activeTokens.size
  }
  sendJsonStatus(response, result.ok ? 200 : 422, payload)
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

function openSse(
  ctx: ModuleContext,
  request: IncomingMessage,
  response: ServerResponse,
  sessionId: string
): void {
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
    connectedAt: Date.now(),
    sessionId
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
  const sessionStillConnected = [...state.clients.values()].some((candidate) =>
    candidate.sessionId === client.sessionId
  )
  if (!sessionStillConnected) {
    const session = state.sessions.get(client.sessionId)
    if (session) void releaseSessionInteraction(client.sessionId, session, 'receiver-disconnected')
  }
  logger.info('streaming', 'client disconnected', {
    id,
    address: client.address,
    count: state.clients.size
  })
}

function closeAllClients(): void {
  for (const id of [...state.clients.keys()]) closeClient(id)
}

export function resolveStreamingBaseOrigin(
  accessMode: StreamingAccessMode,
  publicBaseUrl: string | null,
  port: number | null,
  lanAddress: string | null
): string | null {
  if (!port) return null
  if (accessMode === 'internet') {
    if (!publicBaseUrl) return null
    try {
      return new URL(publicBaseUrl).protocol === 'https:' ? publicBaseUrl : null
    } catch {
      return null
    }
  }
  const host = accessMode === 'lan' && lanAddress ? lanAddress : HOST
  return `http://${host}:${port}`
}

function baseOrigin(): string | null {
  return resolveStreamingBaseOrigin(state.accessMode, state.publicBaseUrl, state.port, state.lanAddress)
}

function lanOrigin(): string | null {
  return state.port && state.lanAddress ? `http://${state.lanAddress}:${state.port}` : null
}

function dashboardUrl(origin?: string | null): string | null {
  const resolvedOrigin = origin === undefined ? baseOrigin() : origin
  if (!state.port || !state.token || !resolvedOrigin) return null
  const url = urlFromBase(resolvedOrigin, `obs/${state.layoutId}`)
  url.searchParams.set('token', state.token)
  url.searchParams.set('kind', state.layoutKind)
  if (state.layoutKind === 'touch') url.searchParams.set('panel', state.layoutId)
  else url.searchParams.set('dash', state.layoutId)
  // Password is intentionally NOT embedded in the shareable URL/QR.
  // The stream page will prompt the user to enter it separately.
  return url.toString()
}

function advertisedLanUrl(): string | null {
  if (state.accessMode !== 'lan') return null
  const origin = lanOrigin()
  return origin ? dashboardUrl(origin) : null
}

function localTestUrl(): string | null {
  if (!state.port || state.accessMode === 'internet') return null
  return dashboardUrl(`http://127.0.0.1:${state.port}`)
}

function touchControlsUrl(origin?: string | null): string | null {
  return state.layoutKind === 'touch' ? dashboardUrl(origin) : null
}

function warning(): string | null {
  const interaction = state.layoutKind === 'touch'
    ? 'Only allowlisted controls in this selected Touch panel are interactive; all other stream surfaces stay read-only.'
    : 'Dashboard streaming is telemetry-only and read-only.'
  if (state.accessMode === 'internet') {
    if (!state.publicBaseUrl) {
      return state.autoTunnelMessage ?? 'No public HTTPS URL is active. Start Auto-tunnel or enter a manual public HTTPS URL.'
    }
    return state.firewallMessage ?? `Internet mode requires the token plus password. ${interaction} Use a trusted HTTPS tunnel/public URL that forwards only this stream port.`
  }
  if (state.accessMode === 'lan') {
    if (!state.lanAddress) {
      return 'No private LAN IPv4 address was found. The server is running, but phone/tablet QR access is unavailable. Connect this PC to Wi-Fi/Ethernet, then restart streaming.'
    }
    return state.firewallMessage ?? `LAN streaming is available over HTTP at ${state.lanAddress}:${state.port ?? 'unknown port'} and still requires the token plus password. ${interaction}`
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
    lanUrl: advertisedLanUrl(),
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
    localTestUrl: localTestUrl(),
    firewallMessage: state.firewallMessage,
    passwordEnabled: state.passwordHash !== null,
    warning: warning(),
    autoTunnelAvailable: resolveCloudflaredBinary() !== null,
    autoTunnelEnabled: state.autoTunnelEnabled,
    autoTunnelRunning: state.autoTunnelProcess !== null && state.autoTunnelUrl !== null,
    autoTunnelMessage: state.autoTunnelMessage,
    interactive: state.layoutKind === 'touch',
    interactionHealth: resolvedInteractionHealth(),
    interactiveCapabilities: publicTouchCapabilities().length,
    activeInteractions: [...state.sessions.values()].reduce((count, session) => count + session.activeTokens.size, 0),
    lastInteractionFeedback: state.lastInteractionFeedback
  }
}

interface ProbeResponse {
  statusCode: number
  headers: IncomingHttpHeaders
  body: Buffer
}

interface ProbeCookie {
  pair: string
  origin: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSiteStrict: boolean
}

class SelfTestStageError extends Error {
  constructor(
    readonly stage: StreamingSelfTestResult['stage'],
    message: string,
    readonly statusCode: number | null = null
  ) {
    super(message)
  }
}

function displayUrl(value: string | URL): string {
  const url = typeof value === 'string' ? new URL(value) : new URL(value.toString())
  url.search = ''
  url.hash = ''
  return url.toString()
}

function probeCookieHeader(cookie: ProbeCookie, url: URL): string | null {
  if (url.origin !== cookie.origin || !url.pathname.startsWith(cookie.path)) return null
  if (cookie.secure && url.protocol !== 'https:') return null
  return cookie.pair
}

function parseProbeCookie(headers: IncomingHttpHeaders, documentUrl: URL): ProbeCookie | null {
  const values = headers['set-cookie']
  const candidates = Array.isArray(values) ? values : values ? [values] : []
  const raw = candidates.find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`))
  if (!raw) return null
  const parts = raw.split(';').map((part) => part.trim())
  const pair = parts[0]
  const attributes = parts.slice(1)
  const pathAttribute = attributes.find((part) => /^path=/i.test(part))
  return {
    pair,
    origin: documentUrl.origin,
    path: pathAttribute?.slice(pathAttribute.indexOf('=') + 1) ?? '/',
    secure: attributes.some((part) => /^secure$/i.test(part)),
    httpOnly: attributes.some((part) => /^httponly$/i.test(part)),
    sameSiteStrict: attributes.some((part) => /^samesite=strict$/i.test(part))
  }
}

function performProbeRequest(
  url: URL,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<ProbeResponse> {
  return new Promise((resolveResult, rejectResult) => {
    const requestFn = url.protocol === 'https:' ? nodeHttpsRequest : url.protocol === 'http:' ? nodeHttpRequest : null
    if (!requestFn) {
      rejectResult(new Error(`Unsupported protocol ${url.protocol}`))
      return
    }
    const body = options.body
    const headers: Record<string, string> = { 'Accept-Encoding': 'identity', ...options.headers }
    if (body !== undefined) headers['Content-Length'] = String(Buffer.byteLength(body))
    const request = requestFn(url, {
      method: options.method ?? 'GET',
      headers,
      timeout: SELF_TEST_TIMEOUT_MS
    }, (response) => {
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += buffer.length
        if (size > SELF_TEST_MAX_BODY_BYTES) {
          request.destroy(new Error(`Response exceeded ${SELF_TEST_MAX_BODY_BYTES} bytes`))
          return
        }
        chunks.push(buffer)
      })
      response.on('end', () => {
        resolveResult({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks)
        })
      })
      response.on('error', rejectResult)
    })
    request.on('timeout', () => request.destroy(new Error(`Timed out after ${SELF_TEST_TIMEOUT_MS} ms`)))
    request.on('error', rejectResult)
    if (body !== undefined) request.write(body)
    request.end()
  })
}

async function performStageProbe(
  stage: StreamingSelfTestResult['stage'],
  url: URL,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<ProbeResponse> {
  try {
    return await performProbeRequest(url, options)
  } catch (error) {
    if (error instanceof SelfTestStageError) throw error
    throw new SelfTestStageError(stage, `${displayUrl(url)} could not be loaded: ${error instanceof Error ? error.message : String(error)}.`)
  }
}

function expectProbeSuccess(stage: StreamingSelfTestResult['stage'], url: URL, response: ProbeResponse): void {
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new SelfTestStageError(stage, `${displayUrl(url)} returned HTTP ${response.statusCode}.`, response.statusCode)
  }
}

function htmlAttribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(['"])(.*?)\\1`, 'i').exec(tag)
  return match?.[2] ?? null
}

function resourceUrl(value: string, base: URL): URL | null {
  const trimmed = value.trim()
  if (!trimmed || /^(?:data:|blob:|javascript:|#)/i.test(trimmed)) return null
  const url = new URL(trimmed, base)
  url.hash = ''
  return url
}

function isHtmlTagNameChar(value: string | undefined): boolean {
  if (!value) return false
  const code = value.charCodeAt(0)
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    value === ':' ||
    value === '_' ||
    value === '-'
  )
}

function findHtmlTagEnd(html: string, start: number): number {
  let quote = ''
  for (let index = start; index < html.length; index += 1) {
    const char = html[index]
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '>') return index
  }
  return -1
}

function inlineModuleScripts(html: string): Array<{ attributes: string; source: string }> {
  const lower = html.toLowerCase()
  const scripts: Array<{ attributes: string; source: string }> = []
  let cursor = 0

  while (cursor < html.length) {
    const openStart = lower.indexOf('<script', cursor)
    if (openStart < 0) break
    const openNameEnd = openStart + '<script'.length
    if (isHtmlTagNameChar(lower[openNameEnd])) {
      cursor = openNameEnd
      continue
    }
    const openEnd = findHtmlTagEnd(html, openNameEnd)
    if (openEnd < 0) break

    let closeStart = lower.indexOf('</script', openEnd + 1)
    while (closeStart >= 0 && isHtmlTagNameChar(lower[closeStart + '</script'.length])) {
      closeStart = lower.indexOf('</script', closeStart + '</script'.length)
    }
    if (closeStart < 0) break
    const closeEnd = findHtmlTagEnd(html, closeStart + '</script'.length)
    if (closeEnd < 0) break

    scripts.push({
      attributes: html.slice(openNameEnd, openEnd),
      source: html.slice(openEnd + 1, closeStart)
    })
    cursor = closeEnd + 1
  }

  return scripts
}

function htmlResourceGraph(html: string, documentUrl: URL): { baseUrl: URL; resources: URL[]; inlineModules: string[] } {
  const baseTag = html.match(/<base\b[^>]*>/i)?.[0]
  const baseHref = baseTag ? htmlAttribute(baseTag, 'href') : null
  const baseUrl = baseHref ? new URL(baseHref, documentUrl) : new URL(documentUrl.toString())
  const resources: URL[] = []
  const inlineModules: string[] = []

  for (const match of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const tag = match[0]
    if (match[1].toLowerCase() === 'script') {
      const src = htmlAttribute(tag, 'src')
      const resolved = src ? resourceUrl(src, baseUrl) : null
      if (resolved) resources.push(resolved)
      continue
    }
    const rel = (htmlAttribute(tag, 'rel') ?? '').toLowerCase()
    if (!/\b(?:stylesheet|modulepreload|preload|icon)\b/.test(rel)) continue
    const href = htmlAttribute(tag, 'href')
    const resolved = href ? resourceUrl(href, baseUrl) : null
    if (resolved) resources.push(resolved)
  }

  for (const script of inlineModuleScripts(html)) {
    if (/\btype\s*=\s*(['"])module\1/i.test(script.attributes) && !/\bsrc\s*=/i.test(script.attributes)) {
      inlineModules.push(script.source)
    }
  }
  return { baseUrl, resources, inlineModules }
}

function moduleDependencies(source: string, baseUrl: URL): URL[] {
  const javascript = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const values = new Set<string>()
  const patterns = [
    /\b(?:import|export)\s*(?:[^;'"]*?\sfrom\s*)?["']((?:\.{1,2}\/|\/)[^"']+)["']/g,
    /\bimport\s*\(\s*["']((?:\.{1,2}\/|\/)[^"']+)["']\s*\)/g,
    /\bnew\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g
  ]
  for (const pattern of patterns) {
    for (const match of javascript.matchAll(pattern)) values.add(match[1])
  }
  return [...values].map((value) => resourceUrl(value, baseUrl)).filter((url): url is URL => url !== null)
}

function cssDependencies(source: string, baseUrl: URL): URL[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const values = new Set<string>()
  for (const match of css.matchAll(/@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?/gi)) values.add(match[2])
  for (const match of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) values.add(match[2])
  return [...values].map((value) => resourceUrl(value, baseUrl)).filter((url): url is URL => url !== null)
}

function isJavaScriptResource(url: URL, contentTypeHeader: string): boolean {
  return /\.(?:m?js|cjs)$/i.test(url.pathname) || /javascript|ecmascript/i.test(contentTypeHeader)
}

function isCssResource(url: URL, contentTypeHeader: string): boolean {
  return /\.css$/i.test(url.pathname) || /text\/css/i.test(contentTypeHeader)
}

async function verifyResourceGraph(documentUrl: URL, html: string, cookie: ProbeCookie): Promise<number> {
  const graph = htmlResourceGraph(html, documentUrl)
  if (graph.resources.length === 0 && graph.inlineModules.length === 0) {
    throw new SelfTestStageError('assets', 'The stream document did not declare any JavaScript or CSS resources.')
  }
  const queue = [...graph.resources]
  for (const inlineModule of graph.inlineModules) queue.push(...moduleDependencies(inlineModule, graph.baseUrl))
  const seen = new Set<string>()
  let javascriptCount = graph.inlineModules.length
  let cssCount = 0
  const allowedOrigins = new Set([documentUrl.origin])
  const expectedAssetPath = `${normalizedBasePath(new URL('../', documentUrl).pathname)}assets/`
  if (process.env.ELECTRON_RENDERER_URL) {
    try {
      allowedOrigins.add(new URL(process.env.ELECTRON_RENDERER_URL).origin)
    } catch {
      // An invalid dev renderer URL will fail when its resource is resolved.
    }
  }

  while (queue.length > 0) {
    const batch: URL[] = []
    while (queue.length > 0 && batch.length < 6) {
      const candidate = queue.shift()!
      const key = candidate.toString()
      if (seen.has(key)) continue
      if (candidate.searchParams.has('token') || candidate.searchParams.has('password')) {
        throw new SelfTestStageError('assets', `Resource URL still contains a secret query parameter: ${displayUrl(candidate)}.`)
      }
      if (!allowedOrigins.has(candidate.origin)) {
        throw new SelfTestStageError('assets', `Resource graph left the trusted stream origin: ${displayUrl(candidate)}.`)
      }
      if (!process.env.ELECTRON_RENDERER_URL && candidate.origin === documentUrl.origin && !candidate.pathname.startsWith(expectedAssetPath)) {
        throw new SelfTestStageError('assets', `Packaged resource escaped the scoped asset root ${expectedAssetPath}: ${displayUrl(candidate)}.`)
      }
      if (/\/obs\/assets\//.test(candidate.pathname)) {
        throw new SelfTestStageError('assets', `Resource resolved below /obs instead of the stream root: ${displayUrl(candidate)}.`)
      }
      seen.add(key)
      if (seen.size > SELF_TEST_MAX_RESOURCES) {
        throw new SelfTestStageError('assets', `Resource graph exceeded ${SELF_TEST_MAX_RESOURCES} files.`)
      }
      batch.push(candidate)
    }

    const fetched = await Promise.all(batch.map(async (assetUrl) => {
      const cookieHeader = probeCookieHeader(cookie, assetUrl)
      const response = await performStageProbe('assets', assetUrl, {
        headers: cookieHeader ? { Cookie: cookieHeader } : undefined
      })
      expectProbeSuccess('assets', assetUrl, response)
      const contentTypeHeader = String(response.headers['content-type'] ?? '')
      const javascript = isJavaScriptResource(assetUrl, contentTypeHeader)
      const css = isCssResource(assetUrl, contentTypeHeader)
      if (javascript && !/javascript|ecmascript/i.test(contentTypeHeader)) {
        throw new SelfTestStageError('assets', `${displayUrl(assetUrl)} did not return JavaScript content (got ${contentTypeHeader || 'no Content-Type'}).`)
      }
      if (css && !/text\/css/i.test(contentTypeHeader)) {
        throw new SelfTestStageError('assets', `${displayUrl(assetUrl)} did not return CSS content (got ${contentTypeHeader || 'no Content-Type'}).`)
      }
      if (javascript) javascriptCount += 1
      if (css) cssCount += 1
      const source = response.body.toString('utf8')
      return javascript
        ? moduleDependencies(source, assetUrl)
        : css
          ? cssDependencies(source, assetUrl)
          : []
    }))
    for (const dependencies of fetched) queue.push(...dependencies)
  }
  if (!process.env.ELECTRON_RENDERER_URL && (javascriptCount === 0 || cssCount === 0)) {
    throw new SelfTestStageError('assets', `Packaged resource graph is incomplete (${javascriptCount} JavaScript, ${cssCount} CSS resources).`)
  }
  return seen.size
}

function probeSseHandshake(url: URL, cookie: ProbeCookie): Promise<void> {
  return new Promise((resolveResult, rejectResult) => {
    const requestFn = url.protocol === 'https:' ? nodeHttpsRequest : url.protocol === 'http:' ? nodeHttpRequest : null
    if (!requestFn) {
      rejectResult(new Error(`Unsupported protocol ${url.protocol}`))
      return
    }
    const cookieHeader = probeCookieHeader(cookie, url)
    const request = requestFn(url, {
      method: 'GET',
      timeout: SELF_TEST_TIMEOUT_MS,
      headers: {
        Accept: 'text/event-stream',
        ...(cookieHeader ? { Cookie: cookieHeader } : {})
      }
    }, (response) => {
      const statusCode = response.statusCode ?? 0
      if (statusCode < 200 || statusCode >= 300) {
        response.resume()
        rejectResult(new SelfTestStageError('sse', `${displayUrl(url)} returned HTTP ${statusCode}.`, statusCode))
        return
      }
      const contentTypeHeader = String(response.headers['content-type'] ?? '')
      if (!/text\/event-stream/i.test(contentTypeHeader)) {
        response.resume()
        rejectResult(new SelfTestStageError('sse', `${displayUrl(url)} returned ${contentTypeHeader || 'no Content-Type'} instead of text/event-stream.`))
        return
      }
      let settled = false
      let received = ''
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        response.destroy()
        if (error) rejectResult(error)
        else resolveResult()
      }
      response.on('data', (chunk: Buffer | string) => {
        received += chunk.toString()
        if (received.includes(': connected\n\n') || received.includes('event: telemetry')) finish()
        else if (received.length > 16_384) finish(new SelfTestStageError('sse', 'SSE endpoint did not send a connection handshake.'))
      })
      response.on('end', () => finish(new SelfTestStageError('sse', 'SSE endpoint closed before sending a connection handshake.')))
      response.on('error', (error) => finish(error))
    })
    request.on('timeout', () => request.destroy(new Error(`Timed out after ${SELF_TEST_TIMEOUT_MS} ms`)))
    request.on('error', rejectResult)
    request.end()
  })
}

async function selfTest(): Promise<StreamingSelfTestResult> {
  const requestUrl = state.port
    ? state.accessMode === 'internet'
      ? dashboardUrl()
      : dashboardUrl(`http://127.0.0.1:${state.port}`)
    : null
  const safeUrl = requestUrl ? displayUrl(requestUrl) : null
  if (!requestUrl) {
    const message = state.server && state.accessMode === 'internet'
      ? 'No active public HTTPS endpoint is available for Internet streaming.'
      : 'Streaming server is not running.'
    return { reachable: false, statusCode: null, url: safeUrl, stage: 'server', message }
  }

  const startedAt = Date.now()
  const documentUrl = new URL(requestUrl)
  const endpointLabel = state.accessMode === 'internet' ? 'public HTTPS endpoint' : 'local loopback endpoint'
  try {
    const documentResponse = await performStageProbe('document', documentUrl)
    expectProbeSuccess('document', documentUrl, documentResponse)
    if (!/text\/html/i.test(String(documentResponse.headers['content-type'] ?? ''))) {
      throw new SelfTestStageError('document', `${safeUrl} did not return an HTML document.`)
    }

    let cookie = parseProbeCookie(documentResponse.headers, documentUrl)
    if (!cookie) throw new SelfTestStageError('session', 'The stream document did not establish an authenticated asset session.')
    const expectedCookiePath = normalizedBasePath(new URL('../', documentUrl).pathname)
    if (!cookie.httpOnly || !cookie.sameSiteStrict || cookie.path !== expectedCookiePath) {
      throw new SelfTestStageError('session', `The stream session cookie is not scoped correctly (expected HttpOnly, SameSite=Strict, Path=${expectedCookiePath}).`)
    }
    if (state.accessMode === 'internet' && !cookie.secure) {
      throw new SelfTestStageError('session', 'The public stream session cookie is missing the Secure attribute.')
    }

    const html = documentResponse.body.toString('utf8')
    const resourceCount = await verifyResourceGraph(documentUrl, html, cookie)
    const baseUrl = new URL('../', documentUrl)

    const pingUrl = new URL('ping', baseUrl)
    const pingCookie = probeCookieHeader(cookie, pingUrl)
    const pingResponse = await performStageProbe('ping', pingUrl, { headers: pingCookie ? { Cookie: pingCookie } : undefined })
    expectProbeSuccess('ping', pingUrl, pingResponse)
    let ping: { passwordRequired?: unknown }
    try {
      ping = JSON.parse(pingResponse.body.toString('utf8')) as { passwordRequired?: unknown }
    } catch {
      throw new SelfTestStageError('ping', 'Ping endpoint did not return valid JSON.')
    }
    if (typeof ping.passwordRequired !== 'boolean') {
      throw new SelfTestStageError('ping', 'Ping endpoint did not report password/session state.')
    }

    if (ping.passwordRequired) {
      if (!state.passwordPlaintext) throw new SelfTestStageError('authentication', 'Password authentication is required, but no test credential is available.')
      const authUrl = new URL('auth/session', baseUrl)
      const authCookie = probeCookieHeader(cookie, authUrl)
      const authResponse = await performStageProbe('authentication', authUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authCookie ? { Cookie: authCookie } : {})
        },
        body: JSON.stringify({ password: state.passwordPlaintext })
      })
      expectProbeSuccess('authentication', authUrl, authResponse)
      cookie = parseProbeCookie(authResponse.headers, authUrl) ?? cookie
    }

    const targetPath = state.layoutKind === 'touch'
      ? `api/touch/panel/${encodeURIComponent(state.layoutId)}`
      : `api/dashboard/${encodeURIComponent(state.layoutId)}`
    const targetUrl = new URL(targetPath, baseUrl)
    const targetCookie = probeCookieHeader(cookie, targetUrl)
    const targetResponse = await performStageProbe('target', targetUrl, { headers: targetCookie ? { Cookie: targetCookie } : undefined })
    expectProbeSuccess('target', targetUrl, targetResponse)
    try {
      const target = JSON.parse(targetResponse.body.toString('utf8')) as {
        id?: unknown
        panel?: { id?: unknown }
        interaction?: { interactive?: unknown; role?: unknown; health?: unknown }
        dashboard?: { id?: unknown }
        expressionContent?: { mode?: unknown; message?: unknown }
      }
      const targetId = state.layoutKind === 'dashboard' ? target.dashboard?.id : target.panel?.id ?? target.id
      if (targetId !== state.layoutId) {
        throw new SelfTestStageError('target', `Target API returned ${String(targetId ?? 'no id')} instead of ${state.layoutId}.`)
      }
      if (state.layoutKind === 'touch' && (
        target.interaction?.interactive !== true ||
        target.interaction.role !== 'touch-controller' ||
        !['ready', 'degraded'].includes(String(target.interaction.health))
      )) {
        throw new SelfTestStageError('target', 'Touch target did not establish an interactive controller session.')
      }
      if (state.layoutKind === 'dashboard' && (
        target.expressionContent?.mode !== 'excluded' ||
        typeof target.expressionContent.message !== 'string' ||
        target.expressionContent.message.length === 0
      )) {
        throw new SelfTestStageError('target', 'Dashboard target did not declare how expression-backed content is handled.')
      }
    } catch (error) {
      if (error instanceof SelfTestStageError) throw error
      throw new SelfTestStageError('target', 'Target API did not return valid JSON.')
    }

    const sseUrl = new URL('sse', baseUrl)
    try {
      await probeSseHandshake(sseUrl, cookie)
    } catch (error) {
      if (error instanceof SelfTestStageError) throw error
      throw new SelfTestStageError('sse', `${displayUrl(sseUrl)} handshake failed: ${error instanceof Error ? error.message : String(error)}.`)
    }
    const elapsedMs = Date.now() - startedAt
    const message = `Complete stream self-test passed against the ${endpointLabel}: document, ${resourceCount} resources, ping, ${state.layoutKind} target, authentication, and SSE (${elapsedMs} ms).`
    logger.info('streaming', 'self-test completed', {
      reachable: true,
      statusCode: documentResponse.statusCode,
      stage: 'complete',
      endpoint: safeUrl,
      resourceCount,
      elapsedMs
    })
    return { reachable: true, statusCode: documentResponse.statusCode, url: safeUrl, stage: 'complete', message, resourceCount }
  } catch (error) {
    const failure = error instanceof SelfTestStageError
      ? error
      : new SelfTestStageError('document', error instanceof Error ? error.message : String(error))
    const message = `${failure.stage} stage failed against the ${endpointLabel}: ${failure.message}`
    logger.error('streaming', 'self-test failed', {
      stage: failure.stage,
      statusCode: failure.statusCode,
      endpoint: safeUrl,
      message: failure.message
    })
    return { reachable: false, statusCode: failure.statusCode, url: safeUrl, stage: failure.stage, message }
  }
}

async function handleRequest(ctx: ModuleContext, request: IncomingMessage, response: ServerResponse): Promise<void> {
  let requestPath = '/'
  try {
    const route = requestRoute(request)
    const { url, pathname } = route
    requestPath = pathname
    if (state.accessMode === 'lan' && !isLocalNetworkRequest(request)) {
      logger.warn('streaming', 'LAN request rejected because the source address is not private/local', {
        remoteAddress: request.socket.remoteAddress ?? 'unknown',
        normalizedAddress: normalizeRemoteAddress(request.socket.remoteAddress),
        path: pathname
      })
      send(response, 403, 'Forbidden')
      return
    }

    if (pathname === '/auth/session') {
      if (request.method !== 'POST') {
        applyCors(response)
        response.setHeader('Allow', 'POST')
        response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end('Method not allowed')
        return
      }
      await exchangePasswordSession(request, response, route)
      return
    }

    if (pathname.startsWith('/api/touch/action/')) {
      if (request.method !== 'POST') {
        applyCors(response)
        response.setHeader('Allow', 'POST')
        response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end('Method not allowed')
        return
      }
      const id = decodeURIComponent(pathname.slice('/api/touch/action/'.length))
      if (!isValidLayoutId(id)) {
        send(response, 404, 'Not found')
        return
      }
      await executeTouchInteraction(request, response, route, id)
      return
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      rejectMethod(response)
      return
    }

    if (pathname.startsWith('/obs/')) {
      let sessionCookie: string | undefined
      if (!sessionForRequest(request, route)) {
        const tokenPresented = url.searchParams.has('token') || headerValue(request, 'x-stream-token') !== null
        if (!tokenPresented) {
          send(response, 403, 'Forbidden')
          return
        }
        if (isRateLimited(request, 'token')) {
          send(response, 429, 'Too many failed authentication attempts')
          return
        }
        if (!hasValidToken(url, request)) {
          recordAuthFailure(request, 'token')
          logger.warn('streaming', 'stream document token exchange failed', {
            path: pathname,
            remoteAddress: normalizeRemoteAddress(request.socket.remoteAddress)
          })
          send(response, 403, 'Forbidden')
          return
        }
        clearAuthFailure(request, 'token')
        if (!normalizedRequestOrigin(request)) {
          send(response, 403, 'Forbidden origin')
          return
        }
        const session = createSession(request, route, state.accessMode === 'local' ? 'authenticated' : 'bootstrap')
        if (!session) {
          send(response, 503, 'Too many authenticated streaming sessions')
          return
        }
        sessionCookie = session.cookie
      }
      const layoutId = pathname.slice('/obs/'.length)
      if (!isValidLayoutId(layoutId) || layoutId !== state.layoutId) {
        logger.error('streaming', 'obs route rejected layout id', { requestedId: layoutId, selectedId: state.layoutId })
        send(response, 404, 'Not found')
        return
      }
      serveHtml(request, response, sessionCookie)
      return
    }

    const activeSession = sessionForRequest(request, route)
    if (pathname === '/ping') {
      if (!activeSession) {
        send(response, 403, 'Forbidden')
        return
      }
      applyCors(response)
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({
        passwordRequired: state.passwordHash !== null && activeSession.session.access !== 'authenticated'
      }))
      return
    }

    if (
      pathname.startsWith('/assets/') ||
      pathname.startsWith('/api/dashboard/') ||
      pathname.startsWith('/api/touch/panel/') ||
      pathname.startsWith('/api/touch/health/')
    ) {
      if (!activeSession) {
        send(response, 403, 'Forbidden')
        return
      }
      if (pathname.startsWith('/api/dashboard/')) {
        const id = decodeURIComponent(pathname.slice('/api/dashboard/'.length))
        if (!isValidLayoutId(id)) {
          logger.error('streaming', 'dashboard api invalid id', { id })
          send(response, 404, 'Not found')
          return
        }
        serveSelectedDashboard(id, request, response)
        return
      }
      if (pathname.startsWith('/api/touch/panel/')) {
        const id = decodeURIComponent(pathname.slice('/api/touch/panel/'.length))
        if (!isValidLayoutId(id)) {
          logger.error('streaming', 'touch api invalid id', { id })
          send(response, 404, 'Not found')
          return
        }
        serveSelectedTouchPanel(id, request, response, activeSession)
        return
      }
      if (pathname.startsWith('/api/touch/health/')) {
        const id = decodeURIComponent(pathname.slice('/api/touch/health/'.length))
        if (
          !isValidLayoutId(id) ||
          id !== state.layoutId ||
          state.layoutKind !== 'touch' ||
          activeSession.session.access !== 'authenticated' ||
          activeSession.session.role !== 'touch-controller'
        ) {
          send(response, 403, 'Forbidden')
          return
        }
        sendJson(response, interactionHealthPayload(activeSession.session), request.method)
        return
      }
      serveStatic(pathname, request, response)
      return
    }

    if (pathname === '/sse') {
      if (!activeSession || activeSession.session.access !== 'authenticated') {
        send(response, 403, 'Forbidden')
        return
      }
      openSse(ctx, request, response, activeSession.id)
      return
    }

    send(response, 404, 'Not found')
  } catch (error) {
    logger.error('streaming', 'request failed', {
      message: error instanceof Error ? error.message : String(error),
      path: requestPath,
      remoteAddress: normalizeRemoteAddress(request.socket.remoteAddress)
    })
    send(response, 400, 'Bad request')
  }
}

async function stop(): Promise<StreamingStatus> {
  for (const session of state.sessions.values()) {
    if (session.expiryTimer) clearTimeout(session.expiryTimer)
    session.expiryTimer = null
  }
  await Promise.all(
    [...state.sessions.entries()].map(([id, session]) =>
      releaseSessionInteraction(id, session, 'stream-stopped')
    )
  )
  closeAllClients()
  await stopAutoTunnelProcess()
  const server = state.server
  const firewallPort = state.port
  const hadLanListener = state.accessMode !== 'local'
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
  state.sessions.clear()
  state.touchCapabilities.clear()
  state.interactionRates.clear()
  state.interactionHealth = 'read-only'
  state.lastInteractionFeedback = null
  if (server) {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    logger.info('streaming', 'server stopped', {})
  }
  if (hadLanListener && firewallPort) await removeWindowsFirewallRule(firewallPort)
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
  if (process.platform !== 'win32' || process.env.NODE_ENV === 'test') return null

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
    'profile=private',
    'protocol=TCP',
    `localport=${port}`,
    'remoteip=localsubnet',
    `program=${process.execPath}`,
    'edge=no'
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

async function removeWindowsFirewallRule(port: number): Promise<void> {
  if (process.platform !== 'win32' || process.env.NODE_ENV === 'test') return
  const removed = await runNetsh(
    ['advfirewall', 'firewall', 'delete', 'rule', `name=${STABLE_FIREWALL_RULE_NAME}`, `program=${process.execPath}`, 'protocol=TCP', `localport=${port}`],
    5_000
  )
  const output = `${removed.stdout}\n${removed.stderr}`.trim()
  if (removed.error && !/no rules match|nenhuma regra|keine regeln/i.test(output)) {
    logger.warn('streaming', 'firewall rule cleanup failed', {
      port,
      message: removed.error.message,
      stdout: removed.stdout,
      stderr: removed.stderr
    })
    return
  }
  logger.info('streaming', 'firewall rule cleanup completed', { port })
}

async function start(ctx: ModuleContext, args: StreamingStartArgs = {}): Promise<StreamingStartResult> {
  if (state.server || state.autoTunnelProcess) await stop()
  const target = resolveStreamTarget(args)
  state.layoutId = target.id
  state.layoutKind = target.kind
  state.touchPanelId = target.touchPanelId
  state.touchCapabilities.clear()
  state.interactionRates.clear()
  state.lastInteractionFeedback = null
  if (target.kind === 'touch') {
    const panel = getTouchPanelManager()?.getPanel(target.id)
    if (!panel) throw new Error(`Touch controls panel not found: ${target.id}`)
    rebuildTouchCapabilities(panel)
  } else {
    state.interactionHealth = 'read-only'
  }
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
    lanUrl: advertisedLanUrl(),
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
    localTestUrl: localTestUrl(),
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
