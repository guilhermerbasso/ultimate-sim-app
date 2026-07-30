import { EventEmitter } from 'node:events'
import type { SimId, TelemetrySnapshot, TelemetrySource, TelemetryStatus } from '../../shared/telemetry'
import type { TelemetryProvider } from './provider'
import { logger } from '../modules/logger'

// Ordem de prioridade para o modo 'auto'.
const AUTO_PRIORITY: SimId[] = ['iracing', 'acc', 'ac', 'ams2', 'lmu', 'mock']

const VALID_SOURCES: ReadonlySet<TelemetrySource> = new Set<TelemetrySource>([
  'off',
  'auto',
  'mock',
  'iracing',
  'acc',
  'ac',
  'ams2',
  'lmu'
])

const DEFAULT_RATE_HZ = 30
const DEFAULT_PROVIDER_POLL_RATE_HZ = 60
const MIN_RATE_HZ = 1
const MAX_RATE_HZ = 120

/**
 * How often a provider that should be running but is not connected is torn down and
 * re-opened. Shared-memory providers (ACC/AC/AMS2/LMU) can only attach to a mapping
 * that already exists, so a sim launched AFTER the app would never be picked up
 * without this retry — start() was previously called exactly once, at source change.
 */
const RECONNECT_INTERVAL_MS = 2000

/**
 * A provider that still reports `isConnected()` but has returned null for this many
 * consecutive polls is recycled. ACC/AC/AMS2/LMU keep their mapping handle open after
 * the sim exits, so `isConnected()` stays true against a dead mapping and the app
 * needed a restart before it could attach to the relaunched sim.
 */
export const STALE_POLL_LIMIT = 90

// Dispatch a value to each listener in ISOLATION. Node's EventEmitter.emit() stops
// as soon as one listener throws — which would let a single bad telemetry subscriber
// (a coaching/predictions module, or a swallowed serial write) starve every later
// consumer, including the rev-lights and iFlag outputs that subscribe last. Exported
// for unit testing.
export function dispatchIsolated<T>(
  listeners: ReadonlyArray<(arg: T) => void>,
  arg: T,
  onError: (error: unknown) => void
): void {
  for (const listener of listeners) {
    try {
      listener(arg)
    } catch (error) {
      onError(error)
    }
  }
}

// Hub central de telemetria: registra providers, gerencia a fonte ativa, faz o
// polling no tick e emite snapshots normalizados ('snapshot') para os consumidores.
export class TelemetryHub extends EventEmitter {
  private providers = new Map<SimId, TelemetryProvider>()
  private source: TelemetrySource = 'off'
  private active: SimId = 'none'
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private broadcastTimer: ReturnType<typeof setInterval> | null = null
  private latest: TelemetrySnapshot | null = null
  private rateHz = DEFAULT_RATE_HZ
  private providerPollRateHz = DEFAULT_PROVIDER_POLL_RATE_HZ
  private latestVersion = 0
  private broadcastedVersion = -1
  private sourceChangeQueue: Promise<void> = Promise.resolve()
  private resettingProviders = new Set<SimId>()
  private reconnectTimer: ReturnType<typeof setInterval> | null = null
  private stalePolls = new Map<SimId, number>()

  constructor() {
    super()
    this.setMaxListeners(40)
  }

  register(provider: TelemetryProvider): void {
    this.providers.set(provider.id, provider)
  }

  getLatest(): TelemetrySnapshot | null {
    return this.latest
  }

  status(): TelemetryStatus {
    return {
      source: this.source,
      active: this.active,
      connected: this.latest?.connected ?? false,
      rateHz: this.rateHz
    }
  }

  setRateHz(rateHz: number): TelemetryStatus {
    this.rateHz = normalizeRateHz(rateHz)
    if (this.source !== 'off') this.restartBroadcastTimer()
    return this.status()
  }

  async setSource(source: TelemetrySource): Promise<TelemetryStatus> {
    if (!VALID_SOURCES.has(source)) {
      throw new Error(`Invalid telemetry source: ${String(source)}`)
    }
    const applySource = async (): Promise<void> => {
      this.source = source

      // Em 'auto' iniciamos todos os providers reais (não-mock) para detectar qual sim está aberto.
      if (source === 'off') {
        await this.stopAll()
      } else if (source === 'auto') {
        for (const [id, provider] of this.providers) {
          // Stop the mock explicitly: leaving it running would let it win the
          // auto-resolution race whenever no real sim is connected.
          if (id === 'mock') {
            await provider.stop()
            continue
          }
          await provider.start()
        }
      } else {
        // Fonte específica: para as demais, inicia só a escolhida.
        for (const [id, provider] of this.providers) {
          if (id === source) await provider.start()
          else await provider.stop()
        }
      }

      this.ensureTimer(source !== 'off')
    }

    const change = this.sourceChangeQueue.then(applySource, applySource)
    this.sourceChangeQueue = change.catch(() => {})
    await change
    return this.status()
  }

  private ensureTimer(run: boolean): void {
    if (run) {
      if (!this.pollTimer) {
        this.pollTimer = setInterval(() => this.tick(), Math.round(1000 / this.providerPollRateHz))
      }
      if (!this.reconnectTimer) {
        this.reconnectTimer = setInterval(() => this.reconnectIdleProviders(), RECONNECT_INTERVAL_MS)
      }
      if (!this.broadcastTimer) this.restartBroadcastTimer()
    } else {
      if (this.pollTimer) {
        clearInterval(this.pollTimer)
        this.pollTimer = null
      }
      if (this.reconnectTimer) {
        clearInterval(this.reconnectTimer)
        this.reconnectTimer = null
      }
      if (this.broadcastTimer) {
        clearInterval(this.broadcastTimer)
        this.broadcastTimer = null
      }
      this.stalePolls.clear()
      this.active = 'none'
      this.latest = null
      this.latestVersion += 1
      this.emitIsolated('sample', null)
      this.emitSnapshotNow(null)
    }
  }

  /** Providers that should be attached for the current source. */
  private wantedProviders(): TelemetryProvider[] {
    if (this.source === 'off') return []
    if (this.source === 'auto') {
      return [...this.providers.entries()].filter(([id]) => id !== 'mock').map(([, provider]) => provider)
    }
    const provider = this.providers.get(this.source as SimId)
    return provider ? [provider] : []
  }

  /**
   * Re-attach every provider that should be running but is not connected. A
   * shared-memory provider can only open a mapping that already exists, so without
   * this a simulator launched after the app — or relaunched after being closed — was
   * never picked up and the user had to restart the whole app.
   */
  private reconnectIdleProviders(): void {
    for (const provider of this.wantedProviders()) {
      let connected = false
      try {
        connected = provider.isConnected()
      } catch {
        connected = false
      }
      if (connected) continue
      this.stalePolls.delete(provider.id)
      this.resetProvider(provider)
    }
  }

  private restartBroadcastTimer(): void {
    if (this.broadcastTimer) clearInterval(this.broadcastTimer)
    this.broadcastTimer = setInterval(() => this.broadcastLatest(), Math.round(1000 / this.rateHz))
  }

  private resolveActiveProvider(): TelemetryProvider | null {
    if (this.source === 'off') return null
    if (this.source === 'auto') {
      for (const id of AUTO_PRIORITY) {
        const provider = this.providers.get(id)
        if (provider && provider.isConnected()) return provider
      }
      return null
    }
    return this.providers.get(this.source) ?? null
  }

  private tick(): void {
    const provider = this.resolveActiveProvider()
    if (!provider) {
      if (this.active !== 'none' || this.latest !== null) {
        this.active = 'none'
        this.latest = null
        this.latestVersion += 1
        this.emitIsolated('sample', null)
        this.emitSnapshotNow(null)
      }
      return
    }
    let snapshot: TelemetrySnapshot | null
    try {
      snapshot = provider.poll()
    } catch {
      this.resetProvider(provider)
      this.stalePolls.delete(provider.id)
      this.active = 'none'
      this.latest = null
      this.latestVersion += 1
      this.emitIsolated('sample', null)
      this.emitSnapshotNow(null)
      return
    }
    // A provider that still claims to be connected but has stopped producing samples is
    // holding a dead mapping: the sim exited without us noticing. Recycle it so the next
    // launch of that sim can be attached to, instead of requiring an app restart.
    if (snapshot === null) {
      const stale = (this.stalePolls.get(provider.id) ?? 0) + 1
      this.stalePolls.set(provider.id, stale)
      if (stale >= STALE_POLL_LIMIT) {
        this.stalePolls.delete(provider.id)
        this.resetProvider(provider)
      }
    } else {
      this.stalePolls.delete(provider.id)
    }
    this.active = provider.id
    this.latest = snapshot
    this.latestVersion += 1
    this.emitIsolated('sample', snapshot)
  }

  private broadcastLatest(): void {
    if (this.broadcastedVersion === this.latestVersion) return
    this.emitSnapshotNow(this.latest)
  }

  private emitSnapshotNow(snapshot: TelemetrySnapshot | null): void {
    this.broadcastedVersion = this.latestVersion
    this.emitIsolated('snapshot', snapshot)
  }

  // Node's EventEmitter.emit() stops dispatching the moment ONE listener throws —
  // which would let a single bad telemetry subscriber (e.g. a coaching/predictions
  // module) starve every later consumer, including the rev-lights and iFlag (rgb-
  // matrix) outputs that subscribe LAST (registered after the module loop). Dispatch
  // each listener in isolation so one throw can never break the others, and log the
  // offender so we can fix the underlying handler.
  private emitIsolated(event: 'snapshot' | 'sample', snapshot: TelemetrySnapshot | null): void {
    dispatchIsolated(
      this.listeners(event) as ReadonlyArray<(s: TelemetrySnapshot | null) => void>,
      snapshot,
      (error) => {
        logger.warn('telemetry', `${event} listener threw (isolated)`, {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        })
      }
    )
  }

  /**
   * Release and re-acquire a provider's resources. `stop()` first is essential: the
   * shared-memory providers early-return from `start()` while a handle is still held,
   * so a stale handle would otherwise block every reconnection attempt forever.
   */
  private resetProvider(provider: TelemetryProvider): void {
    if (this.resettingProviders.has(provider.id)) return
    this.resettingProviders.add(provider.id)
    void (async () => {
      try {
        await provider.stop()
        if (this.source === 'auto' && provider.id !== 'mock') await provider.start()
        else if (this.source === provider.id) await provider.start()
      } catch {
        // Provider reset is best-effort; the next source change or poll can retry.
      } finally {
        this.resettingProviders.delete(provider.id)
      }
    })()
  }

  private async stopAll(): Promise<void> {
    for (const provider of this.providers.values()) await provider.stop()
  }

  async dispose(): Promise<void> {
    this.ensureTimer(false)
    await this.stopAll()
    this.removeAllListeners()
  }
}

function normalizeRateHz(rateHz: number): number {
  if (!Number.isFinite(rateHz)) throw new Error(`Invalid telemetry rate: ${String(rateHz)}`)
  return Math.max(MIN_RATE_HZ, Math.min(MAX_RATE_HZ, Math.round(rateHz)))
}
