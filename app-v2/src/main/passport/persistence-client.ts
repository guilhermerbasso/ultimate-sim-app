import { Worker } from 'node:worker_threads'
import type {
  PassportConfig,
  PassportDataClass,
  PassportDeleteResult,
  PassportExportProfile,
  PassportFullAuditResult,
  PassportIntegrityState,
  PassportPersistenceState,
  PassportPrivacySettings,
  PassportRosterMember,
  StintPassport
} from '../../shared/stint-passport'
import type {
  PassportEventHeader,
  PassportExportPackage,
  PassportStoreEvent,
  PassportStoreMetrics
} from './persistence-engine'

const MAX_QUEUE_ITEMS = 32
const MAX_QUEUE_BYTES = 1024 * 1024
const DEFAULT_DEADLINE_MS = 1_500
const AUDIT_DEADLINE_MS = 30_000
const FAILURE_THRESHOLD = 3
const MAX_RESTARTS = 3

interface WorkerLike {
  postMessage(value: unknown): void
  on(event: 'message', listener: (value: unknown) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  on(event: 'exit', listener: (code: number) => void): this
  removeAllListeners(): this
  terminate(): Promise<number>
}

interface RpcRequest {
  id: number
  method: string
  args: unknown[]
}

interface RpcResponse {
  id: number
  ok: boolean
  result?: unknown
  error?: string
  code?: string
}

interface QueueEntry {
  request: RpcRequest
  bytes: number
  deadlineMs: number
  bypassKill: boolean
  resolve(value: unknown): void
  reject(error: Error): void
}

export interface PersistenceClientOptions {
  path: string
  workerFactory?: () => WorkerLike
  now?: () => number
  restartDelayMs?: number
}

export class PassportPersistenceClient {
  private readonly queue: QueueEntry[] = []
  private worker: WorkerLike | null = null
  private inFlight: QueueEntry | null = null
  private inFlightTimer: ReturnType<typeof setTimeout> | null = null
  private requestId = 0
  private queuedBytes = 0
  private failures = 0
  private restarts = 0
  private killed = false
  private circuitOpen = false
  private quarantined = false
  private closed = false
  private lastError: string | undefined
  private readonly now: () => number
  private readonly restartDelayMs: number
  private readonly workerFactory: () => WorkerLike

  constructor(private readonly options: PersistenceClientOptions) {
    this.now = options.now ?? Date.now
    this.restartDelayMs = options.restartDelayMs ?? 50
    this.workerFactory = options.workerFactory ?? (() =>
      new Worker(new URL('./passport-persistence-worker.js', import.meta.url)) as unknown as WorkerLike
    )
    this.startWorker()
  }

  status(): PassportPersistenceState {
    return {
      state: this.killed
        ? 'killed'
        : this.quarantined
          ? 'quarantined'
        : this.circuitOpen
          ? 'open-circuit'
          : this.worker
            ? this.failures > 0 ? 'degraded' : 'ready'
            : 'starting',
      queued: this.queue.length,
      queuedBytes: this.queuedBytes,
      inFlight: this.inFlight !== null,
      failures: this.failures,
      restarts: this.restarts,
      lastError: this.lastError
    }
  }

  setKillSwitch(enabled: boolean): void {
    this.killed = enabled
    if (enabled) {
      const retained = this.queue.filter((entry) => entry.bypassKill)
      for (const entry of this.queue) {
        if (!entry.bypassKill) entry.reject(new Error('Passport persistence kill switch is active.'))
      }
      this.queue.length = 0
      this.queue.push(...retained)
      this.queuedBytes = retained.reduce((total, entry) => total + entry.bytes, 0)
    }
    this.pump()
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.inFlightTimer) clearTimeout(this.inFlightTimer)
    this.inFlightTimer = null
    for (const entry of this.queue.splice(0)) entry.reject(new Error('Passport persistence client closed.'))
    this.queuedBytes = 0
    if (this.inFlight) {
      this.inFlight.reject(new Error('Passport persistence client closed.'))
      this.inFlight = null
    }
    const worker = this.worker
    this.worker = null
    if (worker) {
      worker.removeAllListeners()
      await worker.terminate().catch(() => 0)
    }
  }

  getConfig(): Promise<PassportConfig> { return this.request('getConfig') }
  setConfig(value: PassportConfig): Promise<PassportConfig> { return this.request('setConfig', [value]) }
  getPrivacy(): Promise<PassportPrivacySettings> { return this.request('getPrivacy') }
  setPrivacy(value: PassportPrivacySettings): Promise<PassportPrivacySettings> { return this.request('setPrivacy', [value], { bypassKill: true }) }
  getKillSwitch(): Promise<boolean> { return this.request('getKillSwitch') }
  setWorkerKillSwitch(value: boolean): Promise<boolean> { return this.request('setKillSwitch', [value], { bypassKill: true }) }
  listRoster(): Promise<PassportRosterMember[]> { return this.request('listRoster') }
  saveRoster(value: PassportRosterMember[]): Promise<PassportRosterMember[]> { return this.request('saveRoster', [value]) }
  persistPassport(passport: StintPassport, event: PassportStoreEvent): Promise<StintPassport> {
    return this.request('persistPassport', [passport, event])
  }
  listPassports(limit = 50): Promise<StintPassport[]> { return this.request('listPassports', [limit]) }
  getPassport(stintId: string): Promise<StintPassport | null> { return this.request('getPassport', [stintId]) }
  getIntegrity(): Promise<PassportIntegrityState> { return this.request('getIntegrity') }
  verifyActiveStint(stintId: string): Promise<PassportIntegrityState> {
    return this.request('verifyActiveStint', [stintId], { deadlineMs: 5_000 })
  }
  async runFullAudit(): Promise<PassportFullAuditResult> {
    const started = this.now()
    const integrity = await this.request<PassportIntegrityState>('runFullAudit', [], {
      deadlineMs: AUDIT_DEADLINE_MS
    })
    if (integrity.state === 'corrupt') this.quarantined = true
    return { integrity, durationMs: Math.max(0, this.now() - started) }
  }
  purgeRetention(): Promise<PassportDeleteResult[]> { return this.request('purgeRetention', [], { bypassKill: true }) }
  deleteByClass(value: PassportDataClass): Promise<PassportDeleteResult> {
    return this.request('deleteByClass', [value], { bypassKill: true })
  }
  exportPackage(
    profile: PassportExportProfile,
    current?: StintPassport | null,
    ephemeralHistory: readonly StintPassport[] = [],
    ephemeralRoster: readonly PassportRosterMember[] = []
  ): Promise<PassportExportPackage> {
    return this.request('exportPackage', [profile, current, ephemeralHistory, ephemeralRoster], {
      deadlineMs: 5_000,
      bypassKill: true
    })
  }
  logRuntime(kind: string, payload: Record<string, unknown>): Promise<void> {
    return this.request('logRuntime', [kind, payload], { bypassKill: true })
  }
  eventHeaders(stintId: string): Promise<PassportEventHeader[]> { return this.request('eventHeaders', [stintId]) }
  metricsSnapshot(): Promise<PassportStoreMetrics> { return this.request('metricsSnapshot') }
  persistLifecycle(passport: StintPassport, event: PassportStoreEvent): Promise<StintPassport> {
    return this.request('persistPassport', [passport, event], { bypassKill: true })
  }
  simulateWorkerCrash(): Promise<void> {
    return this.request('simulateCrash', [], { bypassKill: true, deadlineMs: 500 })
  }
  repairPersistence(token: string): Promise<{ quarantinedPath: string }> {
    return this.request<{ quarantinedPath: string }>('repairPersistence', [token], { bypassKill: true, deadlineMs: 10_000 })
      .then((result) => {
        this.quarantined = false
        this.circuitOpen = false
        this.failures = 0
        return result
      })
  }

  private request<T>(
    method: string,
    args: unknown[] = [],
    options: { deadlineMs?: number; bypassKill?: boolean; front?: boolean } = {}
  ): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Passport persistence client is closed.'))
    if (this.circuitOpen) return Promise.reject(new Error('Passport persistence circuit is open.'))
    const bypassKill = options.bypassKill === true
    if (this.killed && !bypassKill) return Promise.reject(new Error('Passport persistence kill switch is active.'))
    const request: RpcRequest = { id: ++this.requestId, method, args }
    const bytes = Buffer.byteLength(JSON.stringify(request))
    if (this.queue.length >= MAX_QUEUE_ITEMS || this.queuedBytes + bytes > MAX_QUEUE_BYTES) {
      return Promise.reject(new Error('Passport persistence backpressure limit exceeded.'))
    }
    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry = {
        request,
        bytes,
        deadlineMs: options.deadlineMs ?? DEFAULT_DEADLINE_MS,
        bypassKill,
        resolve: (value) => resolve(value as T),
        reject
      }
      if (options.front) this.queue.unshift(entry)
      else this.queue.push(entry)
      this.queuedBytes += bytes
      this.pump()
    })
  }

  private startWorker(): void {
    if (this.closed || this.worker) return
    try {
      const worker = this.workerFactory()
      this.worker = worker
      worker.on('message', (value) => this.onMessage(value))
      worker.on('error', (error) => this.onWorkerFailure(error))
      worker.on('exit', (code) => {
        if (!this.closed && code !== 0) this.onWorkerFailure(new Error(`Persistence worker exited with code ${code}.`))
      })
      this.request('initialize', [this.options.path], { bypassKill: true, deadlineMs: 5_000, front: true }).catch((error) => {
        this.onWorkerFailure(error instanceof Error ? error : new Error(String(error)))
      })
    } catch (error) {
      this.onWorkerFailure(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private pump(): void {
    if (!this.worker || this.inFlight || this.closed || this.circuitOpen) return
    const index = this.queue.findIndex((entry) => !this.killed || entry.bypassKill)
    if (index < 0) return
    const [entry] = this.queue.splice(index, 1)
    this.queuedBytes -= entry.bytes
    this.inFlight = entry
    this.inFlightTimer = setTimeout(() => {
      if (this.inFlight !== entry) return
      entry.reject(new Error(`Passport persistence request timed out: ${entry.request.method}`))
      this.inFlight = null
      this.inFlightTimer = null
      this.onWorkerFailure(new Error(`Persistence deadline exceeded for ${entry.request.method}.`))
    }, entry.deadlineMs)
    this.worker.postMessage(entry.request)
  }

  private onMessage(value: unknown): void {
    const response = value as RpcResponse
    const entry = this.inFlight
    if (!entry || response.id !== entry.request.id) return
    if (this.inFlightTimer) clearTimeout(this.inFlightTimer)
    this.inFlightTimer = null
    this.inFlight = null
    if (response.ok) {
      this.failures = 0
      entry.resolve(response.result)
    } else {
      const error = new Error(response.error || 'Passport persistence request failed.')
      ;(error as Error & { code?: string }).code = response.code
      if (response.code === 'PERSISTENCE_QUARANTINED') this.quarantined = true
      entry.reject(error)
      this.recordFailure(error)
    }
    this.pump()
  }

  private onWorkerFailure(error: Error): void {
    if (this.closed) return
    if (this.inFlightTimer) clearTimeout(this.inFlightTimer)
    this.inFlightTimer = null
    if (this.inFlight) {
      this.inFlight.reject(error)
      this.inFlight = null
    }
    const worker = this.worker
    this.worker = null
    if (worker) {
      worker.removeAllListeners()
      void worker.terminate().catch(() => 0)
    }
    this.recordFailure(error)
    if (!this.circuitOpen && this.restarts < MAX_RESTARTS) {
      this.restarts += 1
      setTimeout(() => this.startWorker(), this.restartDelayMs)
    }
  }

  private recordFailure(error: Error): void {
    this.failures += 1
    this.lastError = error.message
    if (this.failures >= FAILURE_THRESHOLD) {
      this.circuitOpen = true
      for (const entry of this.queue.splice(0)) entry.reject(new Error('Passport persistence circuit opened.'))
      this.queuedBytes = 0
    }
  }
}
