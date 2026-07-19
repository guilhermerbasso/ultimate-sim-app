import { execFile } from 'node:child_process'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, request as nodeHttpRequest, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { request as nodeHttpsRequest } from 'node:https'
import { extname, join, normalize, relative, resolve, sep } from 'node:path'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { isIP, type AddressInfo } from 'node:net'
import { networkInterfaces } from 'node:os'
import type { Duplex } from 'node:stream'
import QRCode from 'qrcode'
import WebSocket, { WebSocketServer } from 'ws'
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
import type { StreamPresentationProfileListItem } from '../../shared/stream-presentation'
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
import { getStreamPresentationProfileForRuntime } from './stream-presentation'
import {
  CloudflaredTunnelSupervisor,
  inspectCloudflaredBinary,
  locateCloudflaredBinary,
  type CloudflaredTunnelSnapshot
} from './cloudflared-tunnel'
import {
  executeTouchSemanticCleanupAction,
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
const RECEIVER_LEASE_TTL_MS = 25_000
const MAX_BOOTSTRAP_SESSIONS = 64
const MAX_AUTHENTICATED_SESSIONS = 64
const AUTH_FAILURE_WINDOW_MS = 60_000
const AUTH_FAILURE_LIMIT = 10
const MAX_STREAM_CLIENTS = 12
const MAX_WEBSOCKET_BUFFERED_BYTES = 1_048_576
const INTERACTION_BURST_WINDOW_MS = 1_000
const INTERACTION_BURST_LIMIT = 30
const INTERACTION_SUSTAINED_WINDOW_MS = 60_000
const INTERACTION_SUSTAINED_LIMIT = 300
const SELF_TEST_TIMEOUT_MS = 5_000
const SELF_TEST_MAX_RESOURCES = 512
const SELF_TEST_MAX_BODY_BYTES = 16 * 1024 * 1024

interface StreamingClient {
  id: number
  timer: ReturnType<typeof setInterval>
  address: string
  userAgent: string | null
  connectedAt: number
  transport: 'sse' | 'websocket'
  close: () => void
  sessionId: string
}

type StreamingSessionAccess = 'bootstrap' | 'authenticated'

interface StreamingLatchState {
  offCapability: StreamingTouchCapabilityEntry
  teardownCapability: StreamingTouchCapabilityEntry | null
  teardownComplete: boolean
}

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
  activeLatches: Map<string, StreamingLatchState>
  lastFeedback: string | null
  expiryTimer: ReturnType<typeof setTimeout> | null
  receiverLeaseExpiresAt: number
  receiverLeaseTimer: ReturnType<typeof setTimeout> | null
  tokenOperations: Map<string, Promise<void>>
  releasePromise: Promise<void> | null
  ownershipClosing: boolean
  deleted: boolean
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
  stopping: boolean
  port: number | null
  token: string | null
  passwordHash: string | null
  passwordPlaintext: string | null
  layoutId: string
  layoutKind: StreamingLayoutKind
  touchPanelId: string | null
  presentationProfileId: string | null
  firewallMessage: string | null
  streamSafe: boolean
  lanEnabled: boolean
  accessMode: StreamingAccessMode
  lanAddress: string | null
  publicBaseUrl: string | null
  manualPublicBaseUrl: string | null
  qrDataUrl: string | null
  qrSourceUrl: string | null
  touchQrDataUrl: string | null
  touchQrSourceUrl: string | null
  autoTunnelEnabled: boolean
  autoTunnelUrl: string | null
  autoTunnelCandidateUrl: string | null
  autoTunnelMessage: string | null
  webSocketServer: WebSocketServer | null
  clients: Map<number, StreamingClient>
  authFailures: Map<string, { count: number; resetAt: number }>
  sessions: Map<string, StreamingSession>
  touchCapabilities: Map<string, StreamingTouchCapabilityEntry>
  interactionRates: Map<string, InteractionRateState>
  sessionCleanupPromises: Set<Promise<void>>
  interactionHealth: StreamingTouchHealth
  lastInteractionFeedback: string | null
  nextClientId: number
}

const state: StreamingState = {
  server: null,
  stopping: false,
  port: null,
  token: null,
  passwordHash: null,
  passwordPlaintext: null,
  layoutId: DEFAULT_LAYOUT,
  layoutKind: 'dashboard',
  touchPanelId: null,
  presentationProfileId: null,
  firewallMessage: null,
  streamSafe: true,
  lanEnabled: false,
  accessMode: 'local',
  lanAddress: null,
  publicBaseUrl: null,
  manualPublicBaseUrl: null,
  qrDataUrl: null,
  qrSourceUrl: null,
  touchQrDataUrl: null,
  touchQrSourceUrl: null,
  autoTunnelEnabled: false,
  autoTunnelUrl: null,
  autoTunnelCandidateUrl: null,
  autoTunnelMessage: null,
  webSocketServer: null,
  clients: new Map(),
  authFailures: new Map(),
  sessions: new Map(),
  touchCapabilities: new Map(),
  interactionRates: new Map(),
  sessionCleanupPromises: new Set(),
  interactionHealth: 'read-only',
  lastInteractionFeedback: null,
  nextClientId: 1
}

let autoTunnelSupervisor: CloudflaredTunnelSupervisor | null = null
let qrRefreshGeneration = 0
let stopPromise: Promise<StreamingStatus> | null = null

function isValidLayoutId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
}

function isValidPresentationProfileId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
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

async function resolveStreamTarget(
  args: StreamingStartArgs
): Promise<{ kind: StreamingLayoutKind; id: string; touchPanelId: string | null; presentationProfileId: string | null }> {
  if (isValidPresentationProfileId(args.presentationProfileId)) {
    const item = await getStreamPresentationProfileForRuntime(args.presentationProfileId)
    if (!item) throw new Error(`Stream presentation profile not found: ${args.presentationProfileId}`)
    if (item.targetState === 'missing') {
      throw new Error(`Stream presentation target not found: ${item.profile.target.kind}:${item.profile.target.id}`)
    }
    if (item.targetState === 'stale') {
      throw new Error(`Stream presentation target changed: refresh profile ${item.profile.id} before streaming.`)
    }
    return {
      kind: item.profile.target.kind,
      id: item.profile.target.id,
      touchPanelId: item.profile.target.kind === 'touch' ? item.profile.target.id : null,
      presentationProfileId: item.profile.id
    }
  }
  const kind = normalizeLayoutKind(args.layoutKind)
  if (kind === 'touch') {
    const requested = isValidLayoutId(args.layoutId) ? args.layoutId : isValidLayoutId(args.touchPanelId) ? args.touchPanelId : null
    if (!requested) throw new Error('Select a valid touch controls panel to stream.')
    const manager = getTouchPanelManager()
    if (!manager?.has(requested)) throw new Error(`Touch controls panel not found: ${requested}`)
    return { kind, id: requested, touchPanelId: requested, presentationProfileId: null }
  }
  const requested = isValidLayoutId(args.layoutId) ? args.layoutId : firstDashboardId()
  if (!getDashboardManager()) return { kind, id: requested ?? DEFAULT_LAYOUT, touchPanelId: null, presentationProfileId: null }
  if (!requested) throw new Error('Select a valid dashboard to stream.')
  const manager = getDashboardManager()
  if (!manager?.getDashboard(requested)) throw new Error(`Dashboard not found: ${requested}`)
  return { kind, id: requested, touchPanelId: null, presentationProfileId: null }
}

function requestedPort(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return 0
  if (value < 0 || value > 65535) return 0
  return value
}

export function streamingListenHost(accessMode: StreamingAccessMode, autoTunnel: boolean, hasManualFallback = false): string {
  if (accessMode === 'local' || (accessMode === 'internet' && autoTunnel && !hasManualFallback)) return HOST
  return LAN_HOST
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

function configuredReceiverLeaseTtlMs(): number {
  if (process.env.NODE_ENV !== 'test') return RECEIVER_LEASE_TTL_MS
  const configured = Number(process.env.ULTIMATE_SIM_STREAM_RECEIVER_LEASE_MS)
  return Number.isFinite(configured) && configured >= 50
    ? Math.floor(configured)
    : RECEIVER_LEASE_TTL_MS
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

function isStreamCapabilityAction(
  action: ButtonAction,
  phase: TouchActionPhase = action.kind === 'keyboard' && action.command.mode === 'hold'
    ? 'begin'
    : 'trigger'
): boolean {
  if (action.kind === 'none' || action.kind === 'app') return false
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

type TouchCapabilityLifecycle = 'continuous' | 'discrete' | 'teardown'

function capabilityPhases(
  action: ButtonAction,
  lifecycle: TouchCapabilityLifecycle
): Pick<TouchCapabilitySpec, 'phases' | 'executePhases'> {
  if (lifecycle === 'discrete') {
    return {
      phases: ['trigger'],
      executePhases: ['trigger']
    }
  }
  if (lifecycle === 'teardown') {
    return {
      phases: ['cancel'],
      executePhases: ['cancel']
    }
  }
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
  tokenZone = zone,
  lifecycle: TouchCapabilityLifecycle = 'continuous'
): TouchCapabilitySpec | null {
  const phaseConfig = capabilityPhases(action, lifecycle)
  if (!isStreamCapabilityAction(action, phaseConfig.executePhases[0])) return null
  return {
    controlId: button.id,
    zone,
    action,
    token: `${button.id}:${tokenZone}`,
    ...phaseConfig
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
      const on = capabilitySpec(button, 'on', control.onAction, 'latching', 'discrete')
      const off = capabilitySpec(button, 'off', control.offAction, 'latching', 'discrete')
      if (!on || !off) return []
      const teardown = control.onAction.kind === 'keyboard' && control.onAction.command.mode === 'toggle'
        ? capabilitySpec(button, 'teardown', control.onAction, 'latching', 'teardown')
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
        .map((choice) => capabilitySpec(button, `choice:${choice.id}`, choice.action, `choice:${choice.id}`, 'discrete'))
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

export function resolveCloudflaredBinary(): string | null {
  const location = locateCloudflaredBinary()
  return location.available ? location.path : null
}

function autoTunnelUnavailableMessage(): string {
  return inspectCloudflaredBinary().diagnostic
}

export function publicBaseUrlAfterTunnelStops(
  currentPublicBaseUrl: string | null,
  tunnelUrl: string | null,
  manualPublicBaseUrl: string | null
): string | null {
  return tunnelUrl && currentPublicBaseUrl === tunnelUrl ? manualPublicBaseUrl : currentPublicBaseUrl
}

async function stopAutoTunnelProcess(): Promise<void> {
  const supervisor = autoTunnelSupervisor
  const tunnelUrl = state.autoTunnelUrl
  clearSessionsForPublicOrigin(tunnelUrl)
  state.autoTunnelUrl = null
  state.autoTunnelCandidateUrl = null
  state.publicBaseUrl = publicBaseUrlAfterTunnelStops(state.publicBaseUrl, tunnelUrl, state.manualPublicBaseUrl)
  if (!supervisor) return
  await supervisor.stop()
  if (autoTunnelSupervisor === supervisor) autoTunnelSupervisor = null
}

async function launchAutoTunnel(): Promise<string> {
  if (!state.server || !state.port) throw new Error('Start the streaming server before starting Auto-tunnel.')
  if (state.accessMode !== 'internet') throw new Error('Auto-tunnel is only available in Internet mode.')
  if (!state.passwordHash || !state.passwordPlaintext || !state.token) {
    throw new Error('Auto-tunnel requires an active token and password-protected streaming session.')
  }
  if (autoTunnelSupervisor) {
    if (autoTunnelSupervisor.snapshot.phase === 'online' && state.autoTunnelUrl) return state.autoTunnelUrl
    throw new Error('Auto-tunnel is already starting.')
  }

  const inspection = inspectCloudflaredBinary()
  if (!inspection.available) throw new Error(inspection.diagnostic)
  const localOrigin = `http://${HOST}:${state.port}`
  state.autoTunnelUrl = null
  state.autoTunnelMessage = 'Starting Cloudflare quick tunnel…'
  let verifiedInspection: ReturnType<typeof inspectCloudflaredBinary> | null = inspection
  let supervisor!: CloudflaredTunnelSupervisor
  const updateTunnelState = (snapshot: CloudflaredTunnelSnapshot): void => {
    if (autoTunnelSupervisor !== supervisor) return
    const previousUrl = state.autoTunnelUrl
    let qrChanged = false
    state.autoTunnelMessage = snapshot.message
    const logDetails = { phase: snapshot.phase, attempt: snapshot.attempt, url: snapshot.url, message: snapshot.message }
    if (snapshot.phase === 'failed' || snapshot.phase === 'reconnecting') {
      logger.warn('streaming', 'auto-tunnel state changed', logDetails)
    } else {
      logger.info('streaming', 'auto-tunnel state changed', logDetails)
    }
    if (snapshot.phase === 'online' && snapshot.url) {
      state.autoTunnelUrl = snapshot.url
      state.autoTunnelCandidateUrl = null
      state.publicBaseUrl = snapshot.url
      qrChanged = previousUrl !== snapshot.url
      logger.info('streaming', 'auto-tunnel ready', { localOrigin, publicUrl: snapshot.url, message: snapshot.message })
    } else if (previousUrl) {
      clearSessionsForPublicOrigin(previousUrl)
      state.autoTunnelUrl = null
      state.publicBaseUrl = publicBaseUrlAfterTunnelStops(state.publicBaseUrl, previousUrl, state.manualPublicBaseUrl)
      qrChanged = true
      logger.warn('streaming', 'auto-tunnel public URL cleared', { phase: snapshot.phase, message: snapshot.message })
    }
    if (qrChanged && !state.stopping) {
      void refreshQrCodes().catch((error) => {
        logger.warn('streaming', 'auto-tunnel QR refresh failed', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    }
  }
  supervisor = new CloudflaredTunnelSupervisor({
    localOrigin,
    inspectBinary: () => {
      const current = verifiedInspection ?? inspectCloudflaredBinary()
      verifiedInspection = null
      return current
    },
    verifyReceiver: async (publicUrl) => {
      state.autoTunnelCandidateUrl = publicUrl
      try {
        const result = await selfTest(publicUrl, 'websocket')
        return {
          reachable: result.reachable,
          stage: result.stage,
          message: result.message
        }
      } finally {
        if (state.autoTunnelCandidateUrl === publicUrl) state.autoTunnelCandidateUrl = null
      }
    },
    shouldReconnect: () => (
      autoTunnelSupervisor === supervisor &&
      state.server !== null &&
      state.accessMode === 'internet' &&
      state.autoTunnelEnabled
    ),
    onSnapshot: updateTunnelState,
    onOutput: (source, line) => logger.info('streaming', 'cloudflared output', { source, line })
  })
  autoTunnelSupervisor = supervisor
  logger.info('streaming', 'auto-tunnel supervisor starting', {
    binary: inspection.path,
    expectedSha256: inspection.expectedSha256,
    actualSha256: inspection.actualSha256,
    localOrigin
  })
  try {
    return await supervisor.start()
  } catch (error) {
    try {
      await supervisor.stop()
    } catch (stopError) {
      const startMessage = error instanceof Error ? error.message : String(error)
      const stopMessage = stopError instanceof Error ? stopError.message : String(stopError)
      const message = `${startMessage} Cleanup failed: ${stopMessage} The process guard remains active; restart the app before retrying Internet streaming.`
      state.autoTunnelMessage = message
      logger.error('streaming', 'failed to clean up cloudflared after start failure', { message })
      throw new Error(message)
    }
    if (autoTunnelSupervisor === supervisor) autoTunnelSupervisor = null
    throw error
  }
}

interface StreamingRequestRoute {
  url: URL
  pathname: string
  externalBasePath: string
  externalOrigin: string | null
}

function firstForwardedValue(value: string | null): string {
  return value?.split(',', 1)[0]?.trim() ?? ''
}

function requestRoute(request: IncomingMessage): StreamingRequestRoute {
  const url = new URL(request.url ?? '/', state.port ? `http://${HOST}:${state.port}` : `http://${HOST}`)
  const requestHost = firstForwardedValue(headerValue(request, 'x-forwarded-host') ?? headerValue(request, 'host')).toLowerCase()
  let configuredPublicBaseUrl = state.publicBaseUrl
  if (state.autoTunnelCandidateUrl) {
    try {
      if (new URL(state.autoTunnelCandidateUrl).host.toLowerCase() === requestHost) {
        configuredPublicBaseUrl = state.autoTunnelCandidateUrl
      }
    } catch {
      // The candidate is created by the strict cloudflared URL parser.
    }
  }
  const configuredBasePath = basePathFromUrl(configuredPublicBaseUrl)
  let pathname = url.pathname
  let externalBasePath = '/'
  let externalOrigin: string | null = null
  if (state.accessMode === 'internet' && configuredPublicBaseUrl) {
    try {
      externalOrigin = new URL(configuredPublicBaseUrl).origin
    } catch {
      externalOrigin = null
    }
  }

  if (configuredBasePath !== '/') {
    const prefix = configuredBasePath.slice(0, -1)
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      pathname = pathname.slice(prefix.length) || '/'
      externalBasePath = configuredBasePath
    } else {
      const forwardedPrefix = normalizedBasePath(firstForwardedValue(headerValue(request, 'x-forwarded-prefix')) || '/')
      const forwardedProto = firstForwardedValue(headerValue(request, 'x-forwarded-proto')).toLowerCase()
      let publicHost = ''
      try {
        publicHost = configuredPublicBaseUrl ? new URL(configuredPublicBaseUrl).host.toLowerCase() : ''
      } catch {
        publicHost = ''
      }
      if (forwardedPrefix === configuredBasePath || forwardedProto === 'https' || (publicHost && requestHost === publicHost)) {
        externalBasePath = configuredBasePath
      }
    }
  }

  return { url, pathname, externalBasePath, externalOrigin }
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

function hasConnectedReceiver(sessionId: string): boolean {
  return [...state.clients.values()].some((client) => client.sessionId === sessionId)
}

function hasLiveReceiverLease(
  sessionId: string,
  session: StreamingSession,
  now = Date.now()
): boolean {
  return !session.deleted && (
    hasConnectedReceiver(sessionId) ||
    session.receiverLeaseExpiresAt > now
  )
}

function clearReceiverLeaseTimer(session: StreamingSession): void {
  if (session.receiverLeaseTimer) clearTimeout(session.receiverLeaseTimer)
  session.receiverLeaseTimer = null
}

function scheduleReceiverLeaseExpiry(sessionId: string, session: StreamingSession): void {
  clearReceiverLeaseTimer(session)
  if (session.deleted || hasConnectedReceiver(sessionId)) return
  session.receiverLeaseTimer = setTimeout(() => {
    const current = state.sessions.get(sessionId)
    if (current !== session || session.deleted) return
    session.receiverLeaseTimer = null
    if (hasConnectedReceiver(sessionId)) return
    if (session.receiverLeaseExpiresAt > Date.now()) {
      scheduleReceiverLeaseExpiry(sessionId, session)
      return
    }
    session.receiverLeaseExpiresAt = 0
    void releaseSessionInteraction(sessionId, session, 'receiver-lease-expired')
  }, Math.max(1, session.receiverLeaseExpiresAt - Date.now()))
  session.receiverLeaseTimer.unref?.()
}

function renewReceiverLease(sessionId: string, session: StreamingSession): boolean {
  if (state.stopping || session.deleted || state.sessions.get(sessionId) !== session) return false
  session.receiverLeaseExpiresAt = Date.now() + configuredReceiverLeaseTtlMs()
  scheduleReceiverLeaseExpiry(sessionId, session)
  if (!session.releasePromise) session.ownershipClosing = false
  return true
}

function queueSessionTokenOperation<T>(
  session: StreamingSession,
  token: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = session.tokenOperations.get(token) ?? Promise.resolve()
  const current = previous
    .catch(() => undefined)
    .then(operation)
  const drained = current.then(() => undefined, () => undefined)
  session.tokenOperations.set(token, drained)
  void drained.then(() => {
    if (session.tokenOperations.get(token) === drained) session.tokenOperations.delete(token)
  })
  return current
}

async function releaseSessionInteraction(sessionId: string, session: StreamingSession, reason: string): Promise<void> {
  if (session.releasePromise) return session.releasePromise
  session.ownershipClosing = true
  removeInteractionRatesForSession(sessionId)
  let release!: Promise<void>
  release = (async () => {
    try {
      const touchController = session.targetKind === 'touch' && session.role === 'touch-controller'
      const releaseOwner = touchController
        ? releaseTouchSemanticActionOwner(streamSessionOwnerKey(sessionId))
        : Promise.resolve()
      const results = await Promise.allSettled([
        releaseOwner,
        ...session.tokenOperations.values()
      ])
      const cleanupFailures: string[] = []
      let executedLatchCleanup = false
      for (const [token, latch] of [...session.activeLatches]) {
        if (session.activeLatches.get(token) !== latch) continue
        executedLatchCleanup = true
        const result = await executeLogicalLatchCleanup(
          sessionId,
          session,
          token,
          latch,
          true
        )
        if (!result.ok) cleanupFailures.push(result.message)
      }
      const finalOwnerRelease = touchController && executedLatchCleanup
        ? await Promise.allSettled([
            releaseTouchSemanticActionOwner(streamSessionOwnerKey(sessionId))
          ])
        : []
      session.activeTokens.clear()
      for (const token of session.activeLatches.keys()) session.activeTokens.add(token)
      if (touchController) {
        const ownerRelease = results[0]
        if (ownerRelease.status === 'rejected') throw ownerRelease.reason
        const finalRelease = finalOwnerRelease[0]
        if (finalRelease?.status === 'rejected') throw finalRelease.reason
        if (cleanupFailures.length > 0) throw new Error(cleanupFailures.join('; '))
        logger.info('streaming', 'interactive touch owner released', { reason })
      }
    } catch (error) {
      state.interactionHealth = 'degraded'
      state.lastInteractionFeedback = 'A held Touch control could not be released cleanly.'
      logger.error('streaming', 'interactive touch owner release failed', {
        reason,
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      if (session.releasePromise === release) session.releasePromise = null
      if (!session.deleted && hasLiveReceiverLease(sessionId, session)) {
        session.ownershipClosing = false
      }
    }
  })()
  session.releasePromise = release
  return release
}

function invalidateReceiverLease(
  sessionId: string,
  session: StreamingSession,
  reason: string
): Promise<void> {
  session.receiverLeaseExpiresAt = 0
  clearReceiverLeaseTimer(session)
  return releaseSessionInteraction(sessionId, session, reason)
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
    void deleteStreamingSession(sessionId, 'session-expired')
  }, Math.max(1, session.expiresAt - Date.now()))
  session.expiryTimer.unref?.()
}

function deleteStreamingSession(sessionId: string, reason: string): Promise<void> {
  const session = state.sessions.get(sessionId)
  if (!session) return Promise.resolve()
  session.deleted = true
  state.sessions.delete(sessionId)
  if (session.expiryTimer) clearTimeout(session.expiryTimer)
  session.expiryTimer = null
  clearReceiverLeaseTimer(session)
  for (const client of [...state.clients.values()]) {
    if (client.sessionId === sessionId) closeClient(client.id)
  }
  const cleanup = releaseSessionInteraction(sessionId, session, reason)
  state.sessionCleanupPromises.add(cleanup)
  void cleanup.then(
    () => state.sessionCleanupPromises.delete(cleanup),
    () => state.sessionCleanupPromises.delete(cleanup)
  )
  return cleanup
}

function cleanupExpiredSessions(now = Date.now()): void {
  for (const [id, session] of state.sessions) {
    if (session.expiresAt <= now) void deleteStreamingSession(id, 'session-expired')
  }
}

function clearSessionsForPublicOrigin(value: string | null): void {
  if (!value) return
  let origin: string
  try {
    origin = new URL(value).origin
  } catch {
    return
  }
  let removed = 0
  for (const [id, session] of state.sessions) {
    if (session.origin !== origin) continue
    void deleteStreamingSession(id, 'public-origin-retired')
    removed += 1
  }
  if (removed > 0) {
    logger.info('streaming', 'retired public tunnel sessions cleared', { origin, removed })
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
  if (state.stopping) return null
  cleanupExpiredSessions()
  if (access === 'bootstrap') {
    while (sessionCount('bootstrap') >= MAX_BOOTSTRAP_SESSIONS) {
      const oldestBootstrap = oldestSessionId('bootstrap')
      if (!oldestBootstrap) break
      void deleteStreamingSession(oldestBootstrap, 'bootstrap-evicted')
    }
  } else if (sessionCount('authenticated') >= MAX_AUTHENTICATED_SESSIONS) {
    return null
  }
  const origin = route.externalOrigin ?? normalizedRequestOrigin(request)
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
    activeLatches: new Map(),
    lastFeedback: null,
    expiryTimer: null,
    receiverLeaseExpiresAt: 0,
    receiverLeaseTimer: null,
    tokenOperations: new Map(),
    releasePromise: null,
    ownershipClosing: false,
    deleted: false
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
  const requestOrigin = route.externalOrigin ?? normalizedRequestOrigin(request)
  if (
    !session ||
    session.basePath !== route.externalBasePath ||
    session.origin !== requestOrigin ||
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
  if (state.stopping) {
    send(response, 503, 'Streaming server is stopping')
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

async function activePresentationProfile(
  response: ServerResponse
): Promise<StreamPresentationProfileListItem | null | false> {
  if (!state.presentationProfileId) return null
  const item = await getStreamPresentationProfileForRuntime(state.presentationProfileId)
  if (!item) {
    send(response, 404, 'Stream presentation profile not found')
    return false
  }
  if (item.targetState !== 'current') {
    send(
      response,
      item.targetState === 'missing' ? 404 : 409,
      item.targetState === 'missing'
        ? 'Stream presentation target not found'
        : 'Stream presentation target changed; refresh the profile before streaming'
    )
    return false
  }
  return item
}

async function serveSelectedDashboard(id: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (state.layoutKind !== 'dashboard' || id !== state.layoutId) {
    logger.error('streaming', 'dashboard api rejected non-selected id', { requestedId: id, selectedId: state.layoutId, layoutKind: state.layoutKind })
    send(response, 404, 'Not found')
    return
  }
  if (await activePresentationProfile(response) === false) return
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

function resolvedInteractionHealth(
  sessionId?: string,
  session?: StreamingSession
): StreamingTouchHealth {
  if (state.layoutKind !== 'touch') return 'read-only'
  if (
    sessionId &&
    session &&
    (session.ownershipClosing || !hasLiveReceiverLease(sessionId, session))
  ) return 'degraded'
  return hasTouchSemanticActionRuntime() ? state.interactionHealth : 'degraded'
}

function interactionSessionPayload(
  sessionId: string,
  session: StreamingSession
): StreamingTouchPanelPayload['interaction'] {
  return {
    interactive: session.role === 'touch-controller',
    indicator: 'INTERACTIVE TOUCH',
    role: session.role,
    health: resolvedInteractionHealth(sessionId, session),
    targetId: session.targetId,
    csrfToken: session.csrfToken,
    nonce: session.replayNonce,
    expiresAt: session.expiresAt,
    leaseExpiresAt: session.receiverLeaseExpiresAt,
    capabilities: publicTouchCapabilities(),
    activeControls: session.activeTokens.size,
    lastFeedback: session.lastFeedback
  }
}

function interactionHealthPayload(
  sessionId: string,
  session: StreamingSession
): StreamingTouchHealthResponse {
  return {
    interactive: session.role === 'touch-controller',
    indicator: 'INTERACTIVE TOUCH',
    role: session.role,
    health: resolvedInteractionHealth(sessionId, session),
    targetId: session.targetId,
    expiresAt: session.expiresAt,
    leaseExpiresAt: session.receiverLeaseExpiresAt,
    activeControls: session.activeTokens.size,
    lastFeedback: session.lastFeedback
  }
}

async function serveSelectedTouchPanel(
  id: string,
  request: IncomingMessage,
  response: ServerResponse,
  activeSession: { id: string; session: StreamingSession }
): Promise<void> {
  if (state.layoutKind !== 'touch' || id !== state.layoutId) {
    logger.error('streaming', 'touch api rejected non-selected id', { requestedId: id, selectedId: state.layoutId, layoutKind: state.layoutKind })
    send(response, 404, 'Not found')
    return
  }
  if (activeSession.session.access !== 'authenticated' || activeSession.session.role !== 'touch-controller') {
    send(response, 403, 'Forbidden')
    return
  }
  if (await activePresentationProfile(response) === false) return
  const panel = getTouchPanelManager()?.getPanel(id)
  if (!panel) {
    logger.error('streaming', 'touch api selected id missing', { id })
    send(response, 404, 'Not found')
    return
  }
  renewReceiverLease(activeSession.id, activeSession.session)
  const payload: StreamingTouchPanelPayload = {
    panel: projectTouchPanelForStreaming(panel),
    interaction: interactionSessionPayload(activeSession.id, activeSession.session)
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
  if (capability.zone === 'on') {
    const offCapability = [...state.touchCapabilities.values()].find((candidate) =>
      candidate.token === capability.token && candidate.zone === 'off'
    )
    const teardownCapability = [...state.touchCapabilities.values()].find((candidate) =>
      candidate.token === capability.token && candidate.zone === 'teardown'
    ) ?? null
    const needsSeparateTeardown = capability.action.kind === 'keyboard' &&
      capability.action.command.mode === 'toggle' &&
      !(
        offCapability?.action.kind === 'keyboard' &&
        offCapability.action.command.mode === 'toggle'
      )
    if (offCapability) {
      session.activeLatches.set(capability.token, {
        offCapability,
        teardownCapability: needsSeparateTeardown ? teardownCapability : null,
        teardownComplete: false
      })
    }
    session.activeTokens.add(capability.token)
    return
  }
  if (capability.zone === 'off') {
    session.activeLatches.delete(capability.token)
    session.activeTokens.delete(capability.token)
    return
  }
  if (capability.zone === 'teardown') {
    const latch = session.activeLatches.get(capability.token)
    if (latch) latch.teardownComplete = true
    return
  }
  if (capability.action.kind !== 'keyboard') return
  const mode = capability.action.command.mode
  if (mode === 'hold') {
    if (phase === 'begin') session.activeTokens.add(capability.token)
    if (phase === 'end' || phase === 'cancel') session.activeTokens.delete(capability.token)
    return
  }
  if (mode !== 'toggle') return
  if (phase === 'cancel') {
    session.activeLatches.delete(capability.token)
    session.activeTokens.delete(capability.token)
    return
  }
  if (session.activeTokens.has(capability.token)) session.activeTokens.delete(capability.token)
  else session.activeTokens.add(capability.token)
}

function isCleanupCapabilityRequest(
  capability: StreamingTouchCapabilityEntry,
  phase: TouchActionPhase
): boolean {
  return phase === 'end' ||
    phase === 'cancel' ||
    capability.zone === 'off' ||
    capability.zone === 'teardown'
}

function touchActionPayload(
  sessionId: string,
  session: StreamingSession,
  result: { ok: boolean; message: string },
  capability?: StreamingTouchCapabilityEntry,
  phase?: TouchActionPhase
): StreamingTouchActionResponse {
  return {
    ok: result.ok,
    message: result.message,
    health: resolvedInteractionHealth(sessionId, session),
    nextNonce: session.replayNonce,
    leaseExpiresAt: session.receiverLeaseExpiresAt,
    ...(capability ? { controlId: capability.controlId } : {}),
    ...(phase ? { phase } : {}),
    activeControls: session.activeTokens.size
  }
}

async function executeCapabilityOperation(
  sessionId: string,
  session: StreamingSession,
  capability: StreamingTouchCapabilityEntry,
  phase: TouchActionPhase,
  action: ButtonAction,
  cleanupDuringTeardown = false
): Promise<{ ok: boolean; message: string }> {
  let result = { ok: true, message: `${capability.controlId} ${phase} acknowledged.` }
  if (capability.executePhases.includes(phase)) {
    const semanticRequest = normalizeTouchSemanticActionRequest({
      action,
      phase,
      token: capability.token,
      zone: capability.zone
    })
    if (!semanticRequest) {
      result = { ok: false, message: 'Touch capability failed semantic validation.' }
    } else {
      try {
        result = cleanupDuringTeardown
          ? await executeTouchSemanticCleanupAction(semanticRequest, streamSessionOwnerKey(sessionId))
          : await executeTouchSemanticAction(semanticRequest, streamSessionOwnerKey(sessionId))
      } catch (error) {
        result = {
          ok: false,
          message: error instanceof Error ? error.message : 'Touch action execution failed.'
        }
      }
    }
  }

  if (result.ok) {
    updateActiveInteraction(session, capability, phase)
    state.interactionHealth = 'ready'
  } else {
    state.interactionHealth = 'degraded'
  }
  session.lastFeedback = result.message
  state.lastInteractionFeedback = result.message
  return result
}

async function executeLogicalLatchCleanup(
  sessionId: string,
  session: StreamingSession,
  token: string,
  latch: StreamingLatchState,
  cleanupDuringTeardown: boolean
): Promise<{ ok: boolean; message: string }> {
  if (latch.teardownCapability && !latch.teardownComplete) {
    const teardownResult = await executeCapabilityOperation(
      sessionId,
      session,
      latch.teardownCapability,
      'cancel',
      latch.teardownCapability.action,
      cleanupDuringTeardown
    )
    if (!teardownResult.ok) return teardownResult
  }
  if (session.activeLatches.get(token) !== latch) {
    return { ok: true, message: `${latch.offCapability.controlId} is already released.` }
  }
  return executeCapabilityOperation(
    sessionId,
    session,
    latch.offCapability,
    'trigger',
    latch.offCapability.action,
    cleanupDuringTeardown
  )
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
  if (state.stopping) {
    send(response, 503, 'Streaming server is stopping')
    return
  }
  const capability = state.touchCapabilities.get(body.capabilityId)
  if (!capability || !capability.phases.includes(body.phase)) {
    send(response, 403, 'Touch capability is not allowed')
    return
  }
  const cleanupRequest = isCleanupCapabilityRequest(capability, body.phase)
  const currentAction = currentCapabilityAction(capability)
  if (!cleanupRequest && !currentAction) {
    send(response, 403, 'Touch capability is not allowed')
    return
  }

  if (cleanupRequest) {
    if (session.releasePromise || !hasLiveReceiverLease(active.id, session)) {
      await (session.releasePromise ?? releaseSessionInteraction(active.id, session, 'cleanup-without-live-receiver'))
      const payload = touchActionPayload(
        active.id,
        session,
        { ok: true, message: `${capability.controlId} is already released.` },
        capability,
        body.phase
      )
      sendJsonStatus(response, 200, payload)
      return
    }
    const result = await queueSessionTokenOperation(session, capability.token, async () => {
      if (session.deleted || session.ownershipClosing || !session.activeTokens.has(capability.token)) {
        return { ok: true, message: `${capability.controlId} is already released.` }
      }
      const latch = session.activeLatches.get(capability.token)
      return latch
        ? executeLogicalLatchCleanup(active.id, session, capability.token, latch, false)
        : executeCapabilityOperation(
            active.id,
            session,
            capability,
            body.phase,
            currentAction ?? capability.action
          )
    })
    const payload = touchActionPayload(active.id, session, result, capability, body.phase)
    sendJsonStatus(response, result.ok ? 200 : 422, payload)
    return
  }

  if (!hasLiveReceiverLease(active.id, session) || session.ownershipClosing) {
    const unavailable = touchActionPayload(
      active.id,
      session,
      { ok: false, message: 'Interactive Touch receiver lease expired; reconnect or wait for heartbeat.' },
      capability,
      body.phase
    )
    sendJsonStatus(response, 409, unavailable)
    return
  }
  if (!safeTokenEqual(body.nonce, session.replayNonce)) {
    const replay: StreamingTouchActionResponse = {
      ok: false,
      message: 'Replay or stale interaction nonce rejected.',
      health: resolvedInteractionHealth(active.id, session),
      nextNonce: session.replayNonce,
      leaseExpiresAt: session.receiverLeaseExpiresAt,
      activeControls: session.activeTokens.size
    }
    sendJsonStatus(response, 409, replay)
    return
  }

  if (isInteractionRateLimited(active.id, request)) {
    send(response, 429, 'Touch interaction rate limit exceeded')
    return
  }
  renewReceiverLease(active.id, session)
  session.replayNonce = generateSecret(NONCE_BYTES)
  const result = await queueSessionTokenOperation(session, capability.token, async () => {
    if (session.deleted || session.ownershipClosing || !hasLiveReceiverLease(active.id, session)) {
      return { ok: false, message: 'Interactive Touch receiver lease ended before execution.' }
    }
    return executeCapabilityOperation(active.id, session, capability, body.phase, currentAction!)
  })
  const payload = touchActionPayload(active.id, session, result, capability, body.phase)
  sendJsonStatus(response, result.ok ? 200 : 422, payload)
}

async function serveSelectedPresentationProfile(
  id: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  if (!state.presentationProfileId || id !== state.presentationProfileId) {
    send(response, 404, 'Not found')
    return
  }
  const item = await activePresentationProfile(response)
  if (!item) return
  sendJson(response, item.profile, request.method)
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

function writeSse(response: ServerResponse, frame: StreamingTelemetryFrame): boolean {
  return response.write(`event: telemetry\ndata: ${JSON.stringify(frame)}\n\n`)
}

export function isWebSocketBackpressured(bufferedAmount: number): boolean {
  return !Number.isFinite(bufferedAmount) || bufferedAmount > MAX_WEBSOCKET_BUFFERED_BYTES
}

export function isSseBackpressured(writableLength: number): boolean {
  return !Number.isFinite(writableLength) || writableLength > MAX_WEBSOCKET_BUFFERED_BYTES
}

function openSse(
  ctx: ModuleContext,
  request: IncomingMessage,
  response: ServerResponse,
  sessionId: string,
  session: StreamingSession
): void {
  if (request.method === 'HEAD') {
    applyCors(response)
    response.writeHead(200, { 'Cache-Control': 'no-store' })
    response.end()
    return
  }
  if (state.clients.size >= MAX_STREAM_CLIENTS) {
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
  const sendFrame = (): void => {
    if (response.destroyed || response.writableEnded) return
    if (isSseBackpressured(response.writableLength)) {
      logger.warn('streaming', 'slow SSE receiver terminated', {
        id,
        address: normalizeRemoteAddress(request.socket.remoteAddress),
        writableLength: response.writableLength,
        limit: MAX_WEBSOCKET_BUFFERED_BYTES
      })
      closeClient(id)
      return
    }
    if (response.writableNeedDrain) return
    writeSse(response, currentFrame(ctx))
  }
  const timer = setInterval(sendFrame, SSE_INTERVAL_MS)
  const client: StreamingClient = {
    id,
    timer,
    address: normalizeRemoteAddress(request.socket.remoteAddress),
    userAgent: headerValue(request, 'user-agent'),
    connectedAt: Date.now(),
    transport: 'sse',
    close: () => {
      if (!response.destroyed) response.end()
    },
    sessionId
  }
  state.clients.set(id, client)
  renewReceiverLease(sessionId, session)
  logger.info('streaming', 'client connected', {
    id,
    address: client.address,
    userAgent: client.userAgent,
    transport: client.transport,
    count: state.clients.size
  })
  sendFrame()
  request.on('close', () => closeClient(id))
}

function openWebSocket(
  ctx: ModuleContext,
  request: IncomingMessage,
  socket: WebSocket,
  sessionId: string,
  session: StreamingSession
): void {
  if (state.clients.size >= MAX_STREAM_CLIENTS) {
    socket.close(1013, 'Too many streaming clients')
    return
  }
  const id = state.nextClientId++
  const writeFrame = (): void => {
    if (socket.readyState !== WebSocket.OPEN) return
    if (isWebSocketBackpressured(socket.bufferedAmount)) {
      logger.warn('streaming', 'slow websocket receiver terminated', {
        id,
        address: normalizeRemoteAddress(request.socket.remoteAddress),
        bufferedAmount: socket.bufferedAmount,
        limit: MAX_WEBSOCKET_BUFFERED_BYTES
      })
      socket.terminate()
      return
    }
    socket.send(JSON.stringify(currentFrame(ctx)))
  }
  const timer = setInterval(writeFrame, SSE_INTERVAL_MS)
  const client: StreamingClient = {
    id,
    timer,
    address: normalizeRemoteAddress(request.socket.remoteAddress),
    userAgent: headerValue(request, 'user-agent'),
    connectedAt: Date.now(),
    transport: 'websocket',
    close: () => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.terminate()
      }
    },
    sessionId
  }
  state.clients.set(id, client)
  renewReceiverLease(sessionId, session)
  logger.info('streaming', 'client connected', {
    id,
    address: client.address,
    userAgent: client.userAgent,
    transport: client.transport,
    count: state.clients.size
  })
  writeFrame()
  socket.on('close', () => closeClient(id))
  socket.on('error', () => closeClient(id))
}

function closeClient(id: number): void {
  const client = state.clients.get(id)
  if (!client) return
  state.clients.delete(id)
  clearInterval(client.timer)
  client.close()
  const sessionStillConnected = [...state.clients.values()].some((candidate) =>
    candidate.sessionId === client.sessionId
  )
  if (!sessionStillConnected) {
    const session = state.sessions.get(client.sessionId)
    if (session) void invalidateReceiverLease(client.sessionId, session, 'receiver-disconnected')
  }
  logger.info('streaming', 'client disconnected', {
    id,
    address: client.address,
    transport: client.transport,
    count: state.clients.size
  })
}

function closeAllClients(): void {
  for (const id of [...state.clients.keys()]) closeClient(id)
}

function rejectWebSocketUpgrade(socket: Duplex, statusCode: number, message: string): void {
  if (socket.destroyed) return
  const body = `${message}\n`
  socket.write(
    `HTTP/1.1 ${statusCode} ${message}\r\n` +
    'Connection: close\r\n' +
    'Content-Type: text/plain; charset=utf-8\r\n' +
    `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
    body
  )
  socket.destroy()
}

function handleWebSocketUpgrade(ctx: ModuleContext, request: IncomingMessage, socket: Duplex, head: Buffer): void {
  const webSocketServer = state.webSocketServer
  if (!webSocketServer || !state.server) {
    rejectWebSocketUpgrade(socket, 503, 'Service Unavailable')
    return
  }
  try {
    const route = requestRoute(request)
    if (route.pathname !== '/ws') {
      rejectWebSocketUpgrade(socket, 404, 'Not Found')
      return
    }
    if (state.accessMode === 'lan' && !isLocalNetworkRequest(request)) {
      rejectWebSocketUpgrade(socket, 403, 'Forbidden')
      return
    }
    const session = sessionForRequest(request, route)
    if (!session || session.session.access !== 'authenticated') {
      rejectWebSocketUpgrade(socket, 403, 'Forbidden')
      return
    }
    const originHeader = headerValue(request, 'origin')
    const expectedOrigin = route.externalOrigin ?? (() => {
      const host = firstForwardedValue(headerValue(request, 'host'))
      if (!host) return null
      try {
        return new URL(`http://${host}`).origin
      } catch {
        return null
      }
    })()
    let normalizedOrigin: string | null = null
    try {
      normalizedOrigin = originHeader ? new URL(originHeader).origin : null
    } catch {
      normalizedOrigin = null
    }
    if (!expectedOrigin || normalizedOrigin !== expectedOrigin) {
      logger.warn('streaming', 'websocket origin rejected', {
        expectedOrigin,
        receivedOrigin: originHeader,
        remoteAddress: normalizeRemoteAddress(request.socket.remoteAddress)
      })
      rejectWebSocketUpgrade(socket, 403, 'Forbidden')
      return
    }
    if (state.clients.size >= MAX_STREAM_CLIENTS) {
      rejectWebSocketUpgrade(socket, 503, 'Service Unavailable')
      return
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      openWebSocket(ctx, request, webSocket, session.id, session.session)
    })
  } catch (error) {
    logger.warn('streaming', 'websocket upgrade rejected', {
      message: error instanceof Error ? error.message : String(error),
      remoteAddress: normalizeRemoteAddress(request.socket.remoteAddress)
    })
    rejectWebSocketUpgrade(socket, 400, 'Bad Request')
  }
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
  if (state.presentationProfileId) url.searchParams.set('profile', state.presentationProfileId)
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
  const generation = ++qrRefreshGeneration
  const shouldGenerateQr = state.accessMode === 'local' || (state.accessMode === 'lan' && state.lanAddress) || (state.accessMode === 'internet' && state.publicBaseUrl)
  const url = shouldGenerateQr ? dashboardUrl() : null
  const touchUrl = shouldGenerateQr ? touchControlsUrl() : null
  const [qrDataUrl, touchQrDataUrl] = await Promise.all([
    url === state.qrSourceUrl ? state.qrDataUrl : url ? QRCode.toDataURL(url) : null,
    touchUrl === state.touchQrSourceUrl ? state.touchQrDataUrl : touchUrl ? QRCode.toDataURL(touchUrl) : null
  ])
  if (generation !== qrRefreshGeneration) return
  state.qrDataUrl = qrDataUrl
  state.qrSourceUrl = url
  state.touchQrDataUrl = touchQrDataUrl
  state.touchQrSourceUrl = touchUrl
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
    autoTunnelRunning: autoTunnelSupervisor?.snapshot.phase === 'online' && state.autoTunnelUrl !== null,
    autoTunnelMessage: state.autoTunnelMessage,
    presentationProfileId: state.presentationProfileId,
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

function probeSessionId(cookie: ProbeCookie): string | null {
  const separator = cookie.pair.indexOf('=')
  if (separator < 0 || cookie.pair.slice(0, separator) !== SESSION_COOKIE_NAME) return null
  return cookie.pair.slice(separator + 1) || null
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
        rejectResult(new SelfTestStageError('receiver', `${displayUrl(url)} returned HTTP ${statusCode}.`, statusCode))
        return
      }
      const contentTypeHeader = String(response.headers['content-type'] ?? '')
      if (!/text\/event-stream/i.test(contentTypeHeader)) {
        response.resume()
        rejectResult(new SelfTestStageError('receiver', `${displayUrl(url)} returned ${contentTypeHeader || 'no Content-Type'} instead of text/event-stream.`))
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
        else if (received.length > 16_384) finish(new SelfTestStageError('receiver', 'SSE endpoint did not send a connection handshake.'))
      })
      response.on('end', () => finish(new SelfTestStageError('receiver', 'SSE endpoint closed before sending a connection handshake.')))
      response.on('error', (error) => finish(error))
    })
    request.on('timeout', () => request.destroy(new Error(`Timed out after ${SELF_TEST_TIMEOUT_MS} ms`)))
    request.on('error', rejectResult)
    request.end()
  })
}

function probeWebSocketHandshake(url: URL, cookie: ProbeCookie): Promise<void> {
  return new Promise((resolveResult, rejectResult) => {
    const webSocketUrl = new URL(url)
    webSocketUrl.protocol = webSocketUrl.protocol === 'https:' ? 'wss:' : 'ws:'
    const cookieHeader = probeCookieHeader(cookie, url)
    let settled = false
    const socket = new WebSocket(webSocketUrl, {
      handshakeTimeout: SELF_TEST_TIMEOUT_MS,
      headers: {
        Origin: url.origin,
        ...(cookieHeader ? { Cookie: cookieHeader } : {})
      },
      maxPayload: SELF_TEST_MAX_BODY_BYTES
    })
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.terminate()
      if (error) rejectResult(error)
      else resolveResult()
    }
    const timer = setTimeout(() => {
      finish(new SelfTestStageError('receiver', `WebSocket receiver timed out after ${SELF_TEST_TIMEOUT_MS} ms.`))
    }, SELF_TEST_TIMEOUT_MS)
    timer.unref()
    socket.on('message', (data) => {
      try {
        const frame = JSON.parse(data.toString()) as Partial<StreamingTelemetryFrame>
        if (typeof frame.timestamp !== 'number' || typeof frame.streamSafe !== 'boolean') {
          throw new Error('invalid telemetry frame')
        }
        finish()
      } catch {
        finish(new SelfTestStageError('receiver', 'WebSocket receiver returned an invalid telemetry frame.'))
      }
    })
    socket.on('unexpected-response', (_request, response) => {
      response.resume()
      finish(new SelfTestStageError('receiver', `${displayUrl(url)} WebSocket upgrade returned HTTP ${response.statusCode ?? 0}.`, response.statusCode ?? null))
    })
    socket.on('error', (error) => {
      finish(new SelfTestStageError('receiver', `${displayUrl(url)} WebSocket handshake failed: ${error.message}.`))
    })
    socket.on('close', () => {
      if (!settled) finish(new SelfTestStageError('receiver', 'WebSocket receiver closed before sending a telemetry frame.'))
    })
  })
}

export function streamingReceiverTransport(accessMode: StreamingAccessMode): 'sse' | 'websocket' {
  return accessMode === 'internet' ? 'websocket' : 'sse'
}

export async function probeStreamingReceiver(
  preference: 'auto' | 'sse' | 'websocket',
  probeWebSocket: () => Promise<void>,
  probeSse: () => Promise<void>
): Promise<'sse' | 'websocket'> {
  if (preference === 'websocket') {
    await probeWebSocket()
    return 'websocket'
  }
  if (preference === 'sse') {
    await probeSse()
    return 'sse'
  }
  try {
    await probeWebSocket()
    return 'websocket'
  } catch (webSocketError) {
    try {
      await probeSse()
      return 'sse'
    } catch (sseError) {
      const webSocketMessage = webSocketError instanceof Error ? webSocketError.message : String(webSocketError)
      const sseMessage = sseError instanceof Error ? sseError.message : String(sseError)
      throw new Error(`WebSocket failed (${webSocketMessage}); SSE fallback failed (${sseMessage}).`)
    }
  }
}

async function selfTest(
  publicOrigin?: string,
  receiverPreference: 'auto' | 'sse' | 'websocket' = publicOrigin
    ? 'websocket'
    : state.accessMode === 'internet'
      ? 'auto'
      : 'sse'
): Promise<StreamingSelfTestResult> {
  const requestUrl = state.port
    ? publicOrigin
      ? dashboardUrl(publicOrigin)
      : state.accessMode === 'internet'
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
  let selfTestSessionId: string | null = null
  try {
    const documentResponse = await performStageProbe('document', documentUrl)
    expectProbeSuccess('document', documentUrl, documentResponse)
    if (!/text\/html/i.test(String(documentResponse.headers['content-type'] ?? ''))) {
      throw new SelfTestStageError('document', `${safeUrl} did not return an HTML document.`)
    }

    let cookie = parseProbeCookie(documentResponse.headers, documentUrl)
    if (!cookie) throw new SelfTestStageError('session', 'The stream document did not establish an authenticated asset session.')
    selfTestSessionId = probeSessionId(cookie)
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
      selfTestSessionId = probeSessionId(cookie) ?? selfTestSessionId
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

    const webSocketUrl = new URL('ws', baseUrl)
    const sseUrl = new URL('sse', baseUrl)
    let receiverLabel: 'WebSocket receiver' | 'SSE receiver'
    try {
      const receiverTransport = await probeStreamingReceiver(
        receiverPreference,
        () => probeWebSocketHandshake(webSocketUrl, cookie),
        () => probeSseHandshake(sseUrl, cookie)
      )
      receiverLabel = receiverTransport === 'websocket' ? 'WebSocket receiver' : 'SSE receiver'
    } catch (error) {
      if (error instanceof SelfTestStageError) throw error
      throw new SelfTestStageError('receiver', error instanceof Error ? error.message : String(error))
    }
    const elapsedMs = Date.now() - startedAt
    const message = `Complete stream self-test passed against the ${endpointLabel}: document, ${resourceCount} resources, ping, ${state.layoutKind} target, authentication, and ${receiverLabel} (${elapsedMs} ms).`
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
  } finally {
    if (selfTestSessionId) {
      await deleteStreamingSession(selfTestSessionId, 'self-test-complete')
    }
  }
}

async function handleRequest(ctx: ModuleContext, request: IncomingMessage, response: ServerResponse): Promise<void> {
  let requestPath = '/'
  try {
    if (state.stopping) {
      send(response, 503, 'Streaming server is stopping')
      return
    }
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
      pathname.startsWith('/api/presentation/') ||
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
        await serveSelectedDashboard(id, request, response)
        return
      }
      if (pathname.startsWith('/api/touch/panel/')) {
        const id = decodeURIComponent(pathname.slice('/api/touch/panel/'.length))
        if (!isValidLayoutId(id)) {
          logger.error('streaming', 'touch api invalid id', { id })
          send(response, 404, 'Not found')
          return
        }
        await serveSelectedTouchPanel(id, request, response, activeSession)
        return
      }
      if (pathname.startsWith('/api/presentation/')) {
        const id = decodeURIComponent(pathname.slice('/api/presentation/'.length))
        if (!isValidPresentationProfileId(id)) {
          send(response, 404, 'Not found')
          return
        }
        await serveSelectedPresentationProfile(id, request, response)
        return
      }
      if (pathname.startsWith('/api/touch/health/')) {
        const id = decodeURIComponent(pathname.slice('/api/touch/health/'.length))
        if (
          !isValidLayoutId(id) ||
          id !== state.layoutId ||
          state.layoutKind !== 'touch' ||
          activeSession.session.access !== 'authenticated' ||
          activeSession.session.role !== 'touch-controller' ||
          !safeTokenEqual(headerValue(request, 'x-stream-csrf'), activeSession.session.csrfToken)
        ) {
          send(response, 403, 'Forbidden')
          return
        }
        renewReceiverLease(activeSession.id, activeSession.session)
        sendJson(
          response,
          interactionHealthPayload(activeSession.id, activeSession.session),
          request.method
        )
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
      openSse(ctx, request, response, activeSession.id, activeSession.session)
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

async function drainStreamingSessions(reason: string): Promise<void> {
  while (state.sessions.size > 0) {
    await Promise.all(
      [...state.sessions.keys()].map((id) => deleteStreamingSession(id, reason))
    )
  }
  while (state.sessionCleanupPromises.size > 0) {
    await Promise.allSettled([...state.sessionCleanupPromises])
    await Promise.resolve()
  }
}

async function stopStreaming(): Promise<StreamingStatus> {
  const server = state.server
  const webSocketServer = state.webSocketServer
  const firewallPort = state.port
  const hadLanListener = state.lanEnabled
  state.server = null
  state.webSocketServer = null
  const serverClosed = server
    ? new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) rejectClose(error)
          else resolveClose()
        })
      })
    : Promise.resolve()
  const tunnelStopped: Promise<Error | null> = stopAutoTunnelProcess().then(
    () => null as Error | null,
    (error) => {
      const cleanupError = error instanceof Error ? error : new Error(String(error))
      logger.error('streaming', 'auto-tunnel cleanup failed while stopping streaming', {
        message: cleanupError.message
      })
      return cleanupError
    }
  )
  await drainStreamingSessions('stream-stopped')
  closeAllClients()
  server?.closeAllConnections()
  const tunnelCleanupError = await tunnelStopped
  state.port = null
  state.token = null
  state.passwordHash = null
  state.passwordPlaintext = null
  state.layoutKind = 'dashboard'
  state.layoutId = DEFAULT_LAYOUT
  state.presentationProfileId = null
  state.lanEnabled = false
  state.accessMode = 'local'
  state.lanAddress = null
  state.publicBaseUrl = null
  state.manualPublicBaseUrl = null
  state.touchPanelId = null
  state.firewallMessage = null
  state.qrDataUrl = null
  state.qrSourceUrl = null
  state.touchQrDataUrl = null
  state.touchQrSourceUrl = null
  state.autoTunnelEnabled = false
  state.autoTunnelUrl = null
  state.autoTunnelCandidateUrl = null
  state.autoTunnelMessage = null
  state.authFailures.clear()
  state.touchCapabilities.clear()
  state.interactionRates.clear()
  state.interactionHealth = 'read-only'
  state.lastInteractionFeedback = null
  if (webSocketServer) {
    await new Promise<void>((resolveClose) => webSocketServer.close(() => resolveClose()))
  }
  await serverClosed
  if (server) logger.info('streaming', 'server stopped', {})
  if (hadLanListener && firewallPort) await removeWindowsFirewallRule(firewallPort)
  if (tunnelCleanupError) {
    throw new Error(`Streaming stopped locally, but cloudflared cleanup could not be confirmed: ${tunnelCleanupError.message}`)
  }
  return status()
}

function stop(): Promise<StreamingStatus> {
  if (stopPromise) return stopPromise
  qrRefreshGeneration += 1
  state.stopping = true
  let tracked!: Promise<StreamingStatus>
  tracked = stopStreaming().finally(() => {
    if (stopPromise === tracked) stopPromise = null
    state.stopping = false
  })
  stopPromise = tracked
  return tracked
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
  if (stopPromise) await stopPromise
  if (state.server || autoTunnelSupervisor || state.sessions.size > 0) await stop()
  const target = await resolveStreamTarget(args)
  state.layoutId = target.id
  state.layoutKind = target.kind
  state.touchPanelId = target.touchPanelId
  state.presentationProfileId = target.presentationProfileId
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
  const cloudflaredLocation = state.autoTunnelEnabled ? locateCloudflaredBinary() : null
  if (state.autoTunnelEnabled && !cloudflaredLocation?.available) {
    state.autoTunnelMessage = cloudflaredLocation?.diagnostic ?? autoTunnelUnavailableMessage()
    state.autoTunnelEnabled = false
    if (!state.publicBaseUrl) {
      state.token = null
      state.passwordPlaintext = null
      state.passwordHash = null
      throw new Error(state.autoTunnelMessage)
    }
  }
  const listenHost = streamingListenHost(state.accessMode, state.autoTunnelEnabled, state.manualPublicBaseUrl !== null)
  state.lanEnabled = listenHost === LAN_HOST
  state.lanAddress = state.lanEnabled ? primaryLanAddress() : null
  state.firewallMessage = null
  if (state.lanEnabled) {
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
  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 })
  server.on('upgrade', (request, socket, head) => handleWebSocketUpgrade(ctx, request, socket, head))
  state.server = server
  state.webSocketServer = webSocketServer
  const listenPort = requestedPort(args.port)
  logger.info('streaming', 'server starting', {
    host: listenHost,
    requestedPort: listenPort,
    mode: state.accessMode,
    layoutId: state.layoutId,
    layoutKind: state.layoutKind,
    presentationProfileId: state.presentationProfileId
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
  if (state.lanEnabled) {
    state.firewallMessage = await allowWindowsFirewallPort(state.port)
  }
  if (state.autoTunnelEnabled) {
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
      try {
        await stopAutoTunnelProcess()
      } catch (cleanupError) {
        const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        let shutdownMessage = ''
        try {
          await stop()
        } catch (shutdownError) {
          shutdownMessage = ` ${shutdownError instanceof Error ? shutdownError.message : String(shutdownError)}`
        }
        throw new Error(`${message} Cleanup could not be confirmed: ${cleanupMessage}. Manual fallback was not activated.${shutdownMessage}`)
      }
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
    autoTunnelRunning: autoTunnelSupervisor?.snapshot.phase === 'online' && state.autoTunnelUrl !== null,
    autoTunnelMessage: state.autoTunnelMessage,
    presentationProfileId: state.presentationProfileId
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
    try {
      await stopAutoTunnelProcess()
    } catch (cleanupError) {
      const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      let shutdownMessage = ''
      try {
        await stop()
      } catch (shutdownError) {
        shutdownMessage = ` ${shutdownError instanceof Error ? shutdownError.message : String(shutdownError)}`
      }
      throw new Error(`${message} Cleanup could not be confirmed, so streaming was stopped instead of leaving a public orphan: ${cleanupMessage}.${shutdownMessage}`)
    }
    throw new Error(message)
  }
}

async function stopAutoTunnel(): Promise<StreamingStatus> {
  state.autoTunnelEnabled = false
  try {
    await stopAutoTunnelProcess()
  } catch (cleanupError) {
    const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
    let containmentMessage = 'Streaming was stopped locally.'
    try {
      await stop()
    } catch (stopError) {
      containmentMessage = stopError instanceof Error ? stopError.message : String(stopError)
    }
    throw new Error(`Auto-tunnel cleanup could not be confirmed: ${cleanupMessage} ${containmentMessage}`)
  }
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
  ctx.registerGracefulTeardown(async () => {
    await stop()
  }, 'quiesce')
}
