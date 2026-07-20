import type {
  ObsCapabilityHandshake,
  ObsLocalCommand,
  ObsLocalCommandDenyReason,
  ObsLocalCommandResult,
  ObsLocalConnectArgs,
  ObsLocalControlState,
  ObsLocalControlStatus,
  ObsLocalMetrics,
  ObsLocalOperation,
  ObsSceneAllowlistEntry,
  ObsTimelineMapping
} from '../../shared/obs-local'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import {
  OBS_LOCAL_REQUIRED_REQUESTS,
  SYSTEM_OBS_LOCAL_CLOCK,
  type ObsAdapterFactory,
  type ObsLocalClock,
  type ObsWebSocketAdapter
} from './contracts'
import { resolveObsEndpoint } from './endpoint'
import { ObsTimelineMapper } from './timeline'

const DEFAULT_HEALTH_INTERVAL_MS = 5_000
const DEFAULT_HEALTH_STALE_MS = 15_000
const DEFAULT_RATE_LIMIT_WINDOW_MS = 1_000
const DEFAULT_RATE_LIMIT_MAX = 8
const DEFAULT_REQUEST_MAX_AGE_MS = 30_000
const REQUEST_FUTURE_SKEW_MS = 5_000
const REPLAY_CACHE_TTL_MS = 60_000
const ROLLBACK_TTL_MS = 5 * 60_000
const CONNECT_TIMEOUT_MS = 5_000
const MAX_LATENCY_SAMPLES = 128
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

interface RollbackRecord {
  sceneName: string
  sourceName: string
  previousValue: boolean
  expiresAtMs: number
}

class WrongSceneError extends Error {
  constructor(readonly actualScene: string, readonly expectedScene: string) {
    super(`OBS is on "${actualScene}", not the expected scene "${expectedScene}".`)
  }
}

class ManualOverrideError extends Error {
  constructor() {
    super('Automation is paused because the operator enabled manual override.')
  }
}

export interface ObsLocalControllerOptions {
  adapterFactory: ObsAdapterFactory
  getTelemetry(): TelemetrySnapshot | null
  clock?: ObsLocalClock
  autoHealth?: boolean
  healthIntervalMs?: number
  healthStaleMs?: number
  rateLimitWindowMs?: number
  rateLimitMax?: number
  requestMaxAgeMs?: number
}

function emptyMetrics(): ObsLocalMetrics {
  return {
    connectAttempts: 0,
    connectSuccesses: 0,
    connectFailures: 0,
    healthChecks: 0,
    healthFailures: 0,
    commandsAccepted: 0,
    commandsDenied: 0,
    commandsRateLimited: 0,
    replayRejects: 0,
    wrongSceneRejects: 0,
    staleHealthRejects: 0,
    offlineRejects: 0,
    capabilityRejects: 0,
    transportFailures: 0,
    latency: {
      samples: 0,
      lastMs: null,
      p95Ms: null,
      maxMs: null
    }
  }
}

function normalizeName(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`)
  const name = value.trim()
  if (!name || name.length > 128) throw new Error(`${label} must contain 1 to 128 characters.`)
  return name
}

function normalizeAllowlist(entries: ObsSceneAllowlistEntry[]): ObsSceneAllowlistEntry[] {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 32) {
    throw new Error('OBS control requires 1 to 32 allowlisted scenes.')
  }
  const scenes = new Map<string, Set<string>>()
  for (const entry of entries) {
    const sceneName = normalizeName(entry?.sceneName, 'Scene name')
    const sources = Array.isArray(entry?.sourceNames) ? entry.sourceNames : []
    if (sources.length === 0 || sources.length > 64) {
      throw new Error(`Scene "${sceneName}" requires 1 to 64 allowlisted sources.`)
    }
    const sceneSources = scenes.get(sceneName) ?? new Set<string>()
    for (const source of sources) sceneSources.add(normalizeName(source, 'Source name'))
    scenes.set(sceneName, sceneSources)
  }
  return [...scenes.entries()].map(([sceneName, sourceNames]) => ({
    sceneName,
    sourceNames: [...sourceNames]
  }))
}

function errorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : ''
  return message || fallback
}

function percentile95(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]
}

function isValidOperation(value: unknown): value is ObsLocalOperation {
  if (!value || typeof value !== 'object') return false
  const operation = value as Record<string, unknown>
  if (operation.kind === 'set-source-visibility') {
    return typeof operation.sourceName === 'string' &&
      operation.sourceName.trim().length > 0 &&
      operation.sourceName.length <= 128 &&
      typeof operation.visible === 'boolean'
  }
  if (operation.kind === 'save-replay-buffer') {
    return operation.raceClockSec === undefined ||
      (typeof operation.raceClockSec === 'number' && Number.isFinite(operation.raceClockSec))
  }
  return operation.kind === 'undo' &&
    typeof operation.targetRequestId === 'string' &&
    REQUEST_ID_PATTERN.test(operation.targetRequestId)
}

export class ObsLocalController {
  private readonly clock: ObsLocalClock
  private readonly autoHealth: boolean
  private readonly healthIntervalMs: number
  private readonly healthStaleMs: number
  private readonly rateLimitWindowMs: number
  private readonly rateLimitMax: number
  private readonly requestMaxAgeMs: number
  private readonly timeline = new ObsTimelineMapper()
  private readonly metrics = emptyMetrics()
  private readonly latencySamples: number[] = []
  private readonly recentRequestIds = new Map<string, number>()
  private readonly rateWindow: number[] = []
  private readonly rollbacks = new Map<string, RollbackRecord>()
  private adapter: ObsWebSocketAdapter | null = null
  private state: ObsLocalControlState = 'offline'
  private endpoint: string | null = null
  private loopback = true
  private explicitNonLoopback = false
  private sceneAllowlist: ObsSceneAllowlistEntry[] = []
  private handshake: ObsCapabilityHandshake | null = null
  private missingCapabilities: string[] = []
  private currentProgramScene: string | null = null
  private manualOverride = false
  private lastHealthAtMs: number | null = null
  private lastHealthMonotonicMs: number | null = null
  private lastTimeline: ObsTimelineMapping | null = null
  private healthDegraded = false
  private lastError: string | null = null
  private connectorStartedAtMonotonicMs = 0
  private healthTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly options: ObsLocalControllerOptions) {
    this.clock = options.clock ?? SYSTEM_OBS_LOCAL_CLOCK
    this.autoHealth = options.autoHealth ?? true
    this.healthIntervalMs = options.healthIntervalMs ?? DEFAULT_HEALTH_INTERVAL_MS
    this.healthStaleMs = options.healthStaleMs ?? DEFAULT_HEALTH_STALE_MS
    this.rateLimitWindowMs = options.rateLimitWindowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS
    this.rateLimitMax = options.rateLimitMax ?? DEFAULT_RATE_LIMIT_MAX
    this.requestMaxAgeMs = options.requestMaxAgeMs ?? DEFAULT_REQUEST_MAX_AGE_MS
  }

  async connect(args: ObsLocalConnectArgs): Promise<ObsLocalControlStatus> {
    if (!args || typeof args !== 'object') throw new Error('OBS connection settings are required.')
    const password = typeof args.password === 'string' ? args.password : ''
    if (!password.trim()) throw new Error('OBS WebSocket password is required.')
    const allowlist = normalizeAllowlist(args.scenes)
    const endpoint = resolveObsEndpoint(args)
    await this.disconnect()
    this.metrics.connectAttempts += 1
    this.state = 'connecting'
    this.endpoint = endpoint.endpoint
    this.loopback = endpoint.loopback
    this.explicitNonLoopback = endpoint.explicitNonLoopback
    this.sceneAllowlist = allowlist
    this.lastError = null
    const adapter = this.options.adapterFactory()
    this.adapter = adapter
    try {
      const handshake = await adapter.connect({
        endpoint: endpoint.endpoint,
        password,
        timeoutMs: CONNECT_TIMEOUT_MS
      })
      this.handshake = {
        ...handshake,
        availableRequests: [...handshake.availableRequests],
        negotiatedAtMs: this.clock.wallNowMs()
      }
      this.missingCapabilities = OBS_LOCAL_REQUIRED_REQUESTS.filter(
        (request) => !handshake.availableRequests.includes(request)
      )
      if (handshake.rpcVersion < 1 || this.missingCapabilities.length > 0) {
        this.state = 'capability-mismatch'
        this.metrics.connectFailures += 1
        this.metrics.capabilityRejects += 1
        this.lastError = this.missingCapabilities.length > 0
          ? `OBS is missing required requests: ${this.missingCapabilities.join(', ')}.`
          : `OBS WebSocket RPC ${handshake.rpcVersion} is unsupported.`
        await adapter.disconnect()
        return this.status()
      }
      this.state = 'ready'
      this.connectorStartedAtMonotonicMs = this.clock.monotonicNowMs()
      await this.refreshHealth()
      this.metrics.connectSuccesses += 1
      this.startHealthTimer()
      return this.status()
    } catch (error) {
      this.metrics.connectFailures += 1
      this.state = 'error'
      this.lastError = errorMessage(error, 'OBS connection failed.')
      await adapter.disconnect().catch(() => undefined)
      return this.status()
    }
  }

  async disconnect(): Promise<ObsLocalControlStatus> {
    this.stopHealthTimer()
    const adapter = this.adapter
    this.adapter = null
    if (adapter) await adapter.disconnect().catch(() => undefined)
    this.state = 'offline'
    this.endpoint = null
    this.loopback = true
    this.explicitNonLoopback = false
    this.sceneAllowlist = []
    this.handshake = null
    this.missingCapabilities = []
    this.currentProgramScene = null
    this.manualOverride = false
    this.lastHealthAtMs = null
    this.lastHealthMonotonicMs = null
    this.lastTimeline = null
    this.healthDegraded = false
    this.lastError = null
    this.recentRequestIds.clear()
    this.rateWindow.length = 0
    this.rollbacks.clear()
    this.timeline.reset()
    return this.status()
  }

  setManualOverride(enabled: boolean): ObsLocalControlStatus {
    this.manualOverride = enabled
    return this.status()
  }

  async refreshHealth(): Promise<ObsLocalControlStatus> {
    const adapter = this.adapter
    if (!adapter || !adapter.isConnected()) {
      this.state = 'offline'
      this.lastError = 'OBS WebSocket is offline.'
      throw new Error(this.lastError)
    }
    this.metrics.healthChecks += 1
    try {
      const [, scene] = await Promise.all([
        adapter.request('GetStats'),
        adapter.request<{ currentProgramSceneName?: unknown }>('GetCurrentProgramScene')
      ])
      if (typeof scene.currentProgramSceneName !== 'string' || !scene.currentProgramSceneName.trim()) {
        throw new Error('OBS health response did not include the current program scene.')
      }
      this.currentProgramScene = scene.currentProgramSceneName
      this.lastHealthAtMs = this.clock.wallNowMs()
      this.lastHealthMonotonicMs = this.clock.monotonicNowMs()
      this.healthDegraded = false
      this.lastError = null
      if (this.state !== 'capability-mismatch') this.state = 'ready'
      return this.status()
    } catch (error) {
      this.metrics.healthFailures += 1
      this.healthDegraded = true
      this.lastError = errorMessage(error, 'OBS health check failed.')
      if (!adapter.isConnected()) this.state = 'offline'
      throw error
    }
  }

  async execute(command: ObsLocalCommand): Promise<ObsLocalCommandResult> {
    const startedAt = this.clock.monotonicNowMs()
    const requestId = typeof command?.requestId === 'string' ? command.requestId : ''
    const finish = (result: Omit<ObsLocalCommandResult, 'latencyMs'>): ObsLocalCommandResult => {
      const latencyMs = Math.max(0, this.clock.monotonicNowMs() - startedAt)
      this.recordLatency(latencyMs)
      return { ...result, latencyMs }
    }
    const deny = (
      reason: ObsLocalCommandDenyReason,
      message: string
    ): ObsLocalCommandResult => {
      this.metrics.commandsDenied += 1
      if (reason === 'rate-limited') this.metrics.commandsRateLimited += 1
      if (reason === 'request-replayed') this.metrics.replayRejects += 1
      if (reason === 'wrong-scene') this.metrics.wrongSceneRejects += 1
      if (reason === 'stale-health') this.metrics.staleHealthRejects += 1
      if (reason === 'offline') this.metrics.offlineRejects += 1
      if (reason === 'capability-mismatch') this.metrics.capabilityRejects += 1
      if (reason === 'transport-error') this.metrics.transportFailures += 1
      return finish({ ok: false, requestId, reason, message, reversible: false })
    }

    const wallNow = this.clock.wallNowMs()
    this.pruneCaches(wallNow)
    if (!REQUEST_ID_PATTERN.test(requestId) ||
        !Number.isFinite(command?.issuedAtMs) ||
        typeof command?.sceneName !== 'string' ||
        command.sceneName.trim().length === 0 ||
        command.sceneName.length > 128 ||
        !isValidOperation(command?.operation)) {
      return deny('invalid-request', 'OBS command contract is invalid.')
    }
    if (command.issuedAtMs < wallNow - this.requestMaxAgeMs || command.issuedAtMs > wallNow + REQUEST_FUTURE_SKEW_MS) {
      return deny('request-expired', 'OBS command expired before execution.')
    }
    if (this.recentRequestIds.has(requestId)) {
      return deny('request-replayed', 'Duplicate OBS command rejected.')
    }
    this.recentRequestIds.set(requestId, wallNow + REPLAY_CACHE_TTL_MS)

    if (this.manualOverride) {
      return deny('manual-override', 'Automation is paused because the operator enabled manual override.')
    }
    if (this.state === 'capability-mismatch') {
      return deny('capability-mismatch', 'OBS capabilities do not match the local certification contract.')
    }
    const adapter = this.adapter
    if (this.state !== 'ready' || !adapter || !adapter.isConnected()) {
      this.state = 'offline'
      return deny('offline', 'OBS is offline; the command was not queued.')
    }
    if (!this.isHealthFresh()) {
      return deny('stale-health', 'OBS health is stale; refresh health before controlling OBS.')
    }
    if (!this.consumeRateBudget(startedAt)) {
      return deny('rate-limited', 'OBS command rate limit exceeded.')
    }

    const sceneName = typeof command.sceneName === 'string' ? command.sceneName.trim() : ''
    const sceneEntry = this.sceneAllowlist.find((entry) => entry.sceneName === sceneName)
    if (!sceneEntry) return deny('scene-not-allowed', `Scene "${sceneName}" is not allowlisted.`)
    const operation = command.operation
    if (operation.kind === 'set-source-visibility' &&
        !sceneEntry.sourceNames.includes(operation.sourceName)) {
      return deny('source-not-allowed', `Source "${operation.sourceName}" is not allowlisted for scene "${sceneName}".`)
    }

    try {
      const currentScene = await this.readCurrentScene(adapter)
      if (currentScene !== sceneName) {
        return deny('wrong-scene', `OBS is on "${currentScene}", not the expected scene "${sceneName}".`)
      }
      let result: Omit<ObsLocalCommandResult, 'latencyMs'>
      if (operation.kind === 'set-source-visibility') {
        result = await this.setSourceVisibility(adapter, command, operation)
      } else if (operation.kind === 'undo') {
        result = await this.undo(adapter, command, operation)
      } else {
        result = await this.saveReplayBuffer(adapter, command, operation)
      }
      if (!result.ok) {
        return deny(result.reason ?? 'transport-error', result.message)
      }
      this.metrics.commandsAccepted += 1
      return finish(result)
    } catch (error) {
      if (error instanceof WrongSceneError) {
        return deny('wrong-scene', error.message)
      }
      if (error instanceof ManualOverrideError) {
        return deny('manual-override', error.message)
      }
      if (!adapter.isConnected()) this.state = 'offline'
      this.lastError = errorMessage(error, 'OBS transport request failed.')
      return deny('transport-error', this.lastError)
    }
  }

  status(): ObsLocalControlStatus {
    if (this.state === 'ready' && (!this.adapter || !this.adapter.isConnected())) {
      this.state = 'offline'
      this.lastError = 'OBS WebSocket is offline.'
    }
    const healthAgeMs = this.lastHealthMonotonicMs === null
      ? null
      : Math.max(0, this.clock.monotonicNowMs() - this.lastHealthMonotonicMs)
    const health = this.state === 'offline' || this.state === 'error'
      ? 'offline'
      : healthAgeMs !== null && healthAgeMs > this.healthStaleMs
        ? 'stale'
        : this.healthDegraded
          ? 'degraded'
          : this.lastHealthAtMs === null
            ? 'offline'
            : 'fresh'
    return {
      state: this.state,
      health,
      endpoint: this.endpoint,
      loopback: this.loopback,
      explicitNonLoopback: this.explicitNonLoopback,
      currentProgramScene: this.currentProgramScene,
      sceneAllowlist: this.sceneAllowlist.map((entry) => ({
        sceneName: entry.sceneName,
        sourceNames: [...entry.sourceNames]
      })),
      handshake: this.handshake
        ? { ...this.handshake, availableRequests: [...this.handshake.availableRequests] }
        : null,
      missingCapabilities: [...this.missingCapabilities],
      manualOverride: this.manualOverride,
      lastHealthAtMs: this.lastHealthAtMs,
      healthAgeMs,
      lastTimeline: this.lastTimeline ? { ...this.lastTimeline } : null,
      lastError: this.lastError,
      metrics: {
        ...this.metrics,
        latency: { ...this.metrics.latency }
      }
    }
  }

  async shutdown(): Promise<void> {
    await this.disconnect()
  }

  private async readCurrentScene(adapter: ObsWebSocketAdapter): Promise<string> {
    const response = await adapter.request<{ currentProgramSceneName?: unknown }>('GetCurrentProgramScene')
    if (typeof response.currentProgramSceneName !== 'string' || !response.currentProgramSceneName.trim()) {
      throw new Error('OBS did not return the current program scene.')
    }
    this.currentProgramScene = response.currentProgramSceneName
    this.lastHealthAtMs = this.clock.wallNowMs()
    this.lastHealthMonotonicMs = this.clock.monotonicNowMs()
    this.healthDegraded = false
    return response.currentProgramSceneName
  }

  private async setSourceVisibility(
    adapter: ObsWebSocketAdapter,
    command: ObsLocalCommand,
    operation: Extract<ObsLocalCommand['operation'], { kind: 'set-source-visibility' }>
  ): Promise<Omit<ObsLocalCommandResult, 'latencyMs'>> {
    const { sceneName, requestId } = command
    const item = await adapter.request<{ sceneItemId?: unknown }>('GetSceneItemId', {
      sceneName,
      sourceName: operation.sourceName
    })
    if (typeof item.sceneItemId !== 'number' || !Number.isInteger(item.sceneItemId)) {
      throw new Error('OBS did not return a valid scene item ID.')
    }
    const previous = await adapter.request<{ sceneItemEnabled?: unknown }>('GetSceneItemEnabled', {
      sceneName,
      sceneItemId: item.sceneItemId
    })
    if (typeof previous.sceneItemEnabled !== 'boolean') {
      throw new Error('OBS did not return the source visibility state.')
    }
    if (previous.sceneItemEnabled !== operation.visible) {
      await this.assertCurrentScene(adapter, sceneName)
      await adapter.request('SetSceneItemEnabled', {
        sceneName,
        sceneItemId: item.sceneItemId,
        sceneItemEnabled: operation.visible
      })
    }
    this.rollbacks.set(requestId, {
      sceneName,
      sourceName: operation.sourceName,
      previousValue: previous.sceneItemEnabled,
      expiresAtMs: this.clock.wallNowMs() + ROLLBACK_TTL_MS
    })
    return {
      ok: true,
      requestId,
      message: `Source "${operation.sourceName}" visibility set to ${operation.visible ? 'shown' : 'hidden'}.`,
      reversible: true,
      previousValue: previous.sceneItemEnabled
    }
  }

  private async undo(
    adapter: ObsWebSocketAdapter,
    command: ObsLocalCommand,
    operation: Extract<ObsLocalCommand['operation'], { kind: 'undo' }>
  ): Promise<Omit<ObsLocalCommandResult, 'latencyMs'>> {
    const rollback = this.rollbacks.get(operation.targetRequestId)
    if (!rollback || rollback.expiresAtMs < this.clock.wallNowMs() || rollback.sceneName !== command.sceneName) {
      return {
        ok: false,
        requestId: command.requestId,
        reason: 'undo-unavailable',
        message: 'The reversible OBS action is unavailable or expired.',
        reversible: false
      }
    }
    const item = await adapter.request<{ sceneItemId?: unknown }>('GetSceneItemId', {
      sceneName: rollback.sceneName,
      sourceName: rollback.sourceName
    })
    if (typeof item.sceneItemId !== 'number' || !Number.isInteger(item.sceneItemId)) {
      throw new Error('OBS did not return a valid scene item ID for undo.')
    }
    await this.assertCurrentScene(adapter, rollback.sceneName)
    await adapter.request('SetSceneItemEnabled', {
      sceneName: rollback.sceneName,
      sceneItemId: item.sceneItemId,
      sceneItemEnabled: rollback.previousValue
    })
    this.rollbacks.delete(operation.targetRequestId)
    return {
      ok: true,
      requestId: command.requestId,
      message: `Source "${rollback.sourceName}" restored to its previous visibility.`,
      reversible: false,
      previousValue: rollback.previousValue
    }
  }

  private async saveReplayBuffer(
    adapter: ObsWebSocketAdapter,
    command: ObsLocalCommand,
    operation: Extract<ObsLocalCommand['operation'], { kind: 'save-replay-buffer' }>
  ): Promise<Omit<ObsLocalCommandResult, 'latencyMs'>> {
    const replay = await adapter.request<{ outputActive?: unknown }>('GetReplayBufferStatus')
    if (replay.outputActive !== true) {
      return {
        ok: false,
        requestId: command.requestId,
        reason: 'replay-buffer-inactive',
        message: 'OBS Replay Buffer is not active.',
        reversible: false
      }
    }
    const snapshot = this.options.getTelemetry()
    if (!snapshot) {
      return {
        ok: false,
        requestId: command.requestId,
        reason: 'timeline-unavailable',
        message: 'Telemetry is unavailable, so the Replay Buffer bookmark was not saved.',
        reversible: false
      }
    }
    const record = await adapter.request<{ outputActive?: unknown; outputTimecode?: unknown }>('GetRecordStatus')
    let timeline: ObsTimelineMapping
    try {
      timeline = this.timeline.capture(
        snapshot,
        this.clock.monotonicNowMs(),
        this.connectorStartedAtMonotonicMs,
        record.outputActive === true ? record.outputTimecode : null
      )
      if (operation.raceClockSec !== undefined) {
        timeline = this.timeline.mapRaceClock(operation.raceClockSec, snapshot)
      }
    } catch (error) {
      return {
        ok: false,
        requestId: command.requestId,
        reason: 'timeline-unavailable',
        message: errorMessage(error, 'Race clock mapping is unavailable.'),
        reversible: false
      }
    }
    await this.assertCurrentScene(adapter, command.sceneName)
    await adapter.request('SaveReplayBuffer')
    this.lastTimeline = timeline
    return {
      ok: true,
      requestId: command.requestId,
      message: 'OBS Replay Buffer saved with a race-clock timeline mapping.',
      reversible: false,
      timeline
    }
  }

  private isHealthFresh(): boolean {
    if (this.lastHealthMonotonicMs === null || this.healthDegraded) return false
    return this.clock.monotonicNowMs() - this.lastHealthMonotonicMs <= this.healthStaleMs
  }

  private async assertCurrentScene(adapter: ObsWebSocketAdapter, expectedScene: string): Promise<void> {
    const currentScene = await this.readCurrentScene(adapter)
    if (currentScene !== expectedScene) throw new WrongSceneError(currentScene, expectedScene)
    if (this.manualOverride) throw new ManualOverrideError()
  }

  private consumeRateBudget(nowMonotonicMs: number): boolean {
    while (this.rateWindow.length > 0 && this.rateWindow[0] <= nowMonotonicMs - this.rateLimitWindowMs) {
      this.rateWindow.shift()
    }
    if (this.rateWindow.length >= this.rateLimitMax) return false
    this.rateWindow.push(nowMonotonicMs)
    return true
  }

  private pruneCaches(wallNowMs: number): void {
    for (const [requestId, expiresAt] of this.recentRequestIds) {
      if (expiresAt <= wallNowMs) this.recentRequestIds.delete(requestId)
    }
    for (const [requestId, rollback] of this.rollbacks) {
      if (rollback.expiresAtMs <= wallNowMs) this.rollbacks.delete(requestId)
    }
  }

  private recordLatency(latencyMs: number): void {
    this.latencySamples.push(latencyMs)
    if (this.latencySamples.length > MAX_LATENCY_SAMPLES) this.latencySamples.shift()
    this.metrics.latency.samples += 1
    this.metrics.latency.lastMs = latencyMs
    this.metrics.latency.p95Ms = percentile95(this.latencySamples)
    this.metrics.latency.maxMs = this.metrics.latency.maxMs === null
      ? latencyMs
      : Math.max(this.metrics.latency.maxMs, latencyMs)
  }

  private startHealthTimer(): void {
    if (!this.autoHealth || this.healthTimer) return
    this.healthTimer = setInterval(() => {
      void this.refreshHealth().catch(() => undefined)
    }, this.healthIntervalMs)
    this.healthTimer.unref?.()
  }

  private stopHealthTimer(): void {
    if (!this.healthTimer) return
    clearInterval(this.healthTimer)
    this.healthTimer = null
  }
}
