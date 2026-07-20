import { fork, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
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
import { PASSPORT_DOMAIN_ERROR_CODE } from './persistence-errors'
import {
  PASSPORT_CLIENT_CLOSE_DEADLINE_MS,
  PASSPORT_WORKER_TERMINATION_DEADLINE_MS
} from './persistence-deadlines'

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

class PersistenceProcess implements WorkerLike {
  constructor(private readonly child: ChildProcess) {}

  postMessage(value: unknown): void {
    if (!this.child.connected || !this.child.send) {
      throw new Error('Passport persistence process IPC is disconnected.')
    }
    this.child.send(value as any, (error) => {
      if (error) this.child.emit('error', error)
    })
  }

  on(event: 'message' | 'error' | 'exit', listener: ((value: any) => void)): this {
    this.child.on(event, listener)
    return this
  }

  removeAllListeners(): this {
    this.child.removeAllListeners()
    return this
  }

  terminate(): Promise<number> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      return Promise.resolve(this.child.exitCode ?? 0)
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Passport persistence process did not terminate before its deadline.')),
        PASSPORT_WORKER_TERMINATION_DEADLINE_MS
      )
      this.child.once('exit', (code) => {
        clearTimeout(timer)
        resolve(code ?? 0)
      })
      try {
        this.child.kill('SIGKILL')
      } catch (error) {
        clearTimeout(timer)
        reject(error)
      }
    })
  }
}

function spawnPersistenceProcess(): WorkerLike {
  const entry = fileURLToPath(new URL('./passport-persistence-worker.js', import.meta.url))
  const child = fork(entry, [], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    serialization: 'advanced',
    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  })
  return new PersistenceProcess(child)
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
  bypassCircuit: boolean
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
  private restartAttempts = 0
  private killed = false
  private circuitOpen = false
  private quarantined = false
  private closing = false
  private closed = false
  private closePromise: Promise<void> | null = null
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private readonly pendingTerminations = new Set<Promise<void>>()
  private readonly terminationErrors: unknown[] = []
  private lastError: string | undefined
  private readonly now: () => number
  private readonly restartDelayMs: number
  private readonly workerFactory: () => WorkerLike

  constructor(private readonly options: PersistenceClientOptions) {
    this.now = options.now ?? Date.now
    this.restartDelayMs = options.restartDelayMs ?? 50
    this.workerFactory = options.workerFactory ?? spawnPersistenceProcess
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
    if (this.closePromise) return this.closePromise
    this.closing = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    this.closePromise = (async () => {
      let drainError: unknown
      try {
        let closeTimer: ReturnType<typeof setTimeout> | undefined
        const drain = (async () => {
          if (!this.worker && !this.inFlight && this.queue.length === 0) return
          await this.request('flush', [], {
            bypassKill: true,
            bypassCircuit: true,
            allowDuringClose: true,
            bypassBackpressure: true,
            deadlineMs: 10_000
          })
          await this.request('shutdown', [], {
            bypassKill: true,
            bypassCircuit: true,
            allowDuringClose: true,
            bypassBackpressure: true,
            deadlineMs: 10_000
          })
        })()
        try {
          await Promise.race([
            drain,
            new Promise<never>((_, reject) => {
              closeTimer = setTimeout(
                () => reject(new Error('Passport persistence close drain timed out.')),
                PASSPORT_CLIENT_CLOSE_DEADLINE_MS
              )
            })
          ])
        } finally {
          if (closeTimer) clearTimeout(closeTimer)
        }
      } catch (error) {
        drainError = error
      }
      this.closed = true
      if (this.restartTimer) clearTimeout(this.restartTimer)
      this.restartTimer = null
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
        void this.terminateWorker(worker)
      }
      await Promise.all([...this.pendingTerminations])
      const terminationError = this.terminationErrors.length === 0
        ? undefined
        : this.terminationErrors.length === 1
          ? this.terminationErrors[0]
          : new AggregateError(
              [...this.terminationErrors],
              'Multiple Passport persistence workers did not settle.'
            )
      if (drainError && terminationError) {
        throw new AggregateError(
          [drainError, terminationError],
          'Passport persistence close failed and its worker did not settle.'
        )
      }
      if (terminationError) throw terminationError
      if (drainError) throw drainError
    })()
    return this.closePromise
  }

  getConfig(): Promise<PassportConfig> { return this.request('getConfig') }
  setConfig(value: PassportConfig): Promise<PassportConfig> { return this.request('setConfig', [value]) }
  getPrivacy(): Promise<PassportPrivacySettings> { return this.request('getPrivacy') }
  setPrivacy(value: PassportPrivacySettings): Promise<PassportPrivacySettings> {
    return this.request('setPrivacy', [value], { bypassKill: true, bypassCircuit: true })
  }
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
  purgeRetention(): Promise<PassportDeleteResult[]> {
    return this.request('purgeRetention', [], { bypassKill: true, bypassCircuit: true })
  }
  deleteByClass(value: PassportDataClass): Promise<PassportDeleteResult> {
    return this.request('deleteByClass', [value], { bypassKill: true, bypassCircuit: true })
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
  verifyImportPackage(value: unknown): Promise<PassportExportPackage> {
    return this.request('verifyImportPackage', [value], {
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
    return this.request<{ quarantinedPath: string }>('repairPersistence', [token], {
      bypassKill: true,
      bypassCircuit: true,
      deadlineMs: 10_000
    })
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
    options: {
      deadlineMs?: number
      bypassKill?: boolean
      bypassCircuit?: boolean
      front?: boolean
      allowDuringClose?: boolean
      bypassBackpressure?: boolean
    } = {}
  ): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Passport persistence client is closed.'))
    if (this.closing && !options.allowDuringClose) {
      return Promise.reject(new Error('Passport persistence client is closing.'))
    }
    if (this.circuitOpen && !options.bypassCircuit) {
      return Promise.reject(new Error('Passport persistence circuit is open.'))
    }
    const bypassKill = options.bypassKill === true
    const bypassCircuit = options.bypassCircuit === true
    if (this.killed && !bypassKill) return Promise.reject(new Error('Passport persistence kill switch is active.'))
    if (bypassCircuit && !this.worker) this.startWorker()
    const request: RpcRequest = { id: ++this.requestId, method, args }
    const bytes = Buffer.byteLength(JSON.stringify(request))
    if (!options.bypassBackpressure &&
      (this.queue.length >= MAX_QUEUE_ITEMS || this.queuedBytes + bytes > MAX_QUEUE_BYTES)) {
      return Promise.reject(new Error('Passport persistence backpressure limit exceeded.'))
    }
    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry = {
        request,
        bytes,
        deadlineMs: options.deadlineMs ?? DEFAULT_DEADLINE_MS,
        bypassKill,
        bypassCircuit,
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
      worker.on('message', (value) => this.onMessage(worker, value))
      worker.on('error', (error) => this.onWorkerFailure(worker, error))
      worker.on('exit', (code) => {
        if (!this.closed && !this.closing) {
          this.onWorkerFailure(worker, new Error(`Persistence process exited with code ${code}.`))
        }
      })
      this.request('initialize', [this.options.path], {
        bypassKill: true,
        bypassCircuit: true,
        deadlineMs: 5_000,
        front: true,
        allowDuringClose: true,
        bypassBackpressure: true
      }).catch((error) => {
        this.onWorkerFailure(worker, error instanceof Error ? error : new Error(String(error)))
      })
    } catch (error) {
      this.onWorkerFailure(null, error instanceof Error ? error : new Error(String(error)))
    }
  }

  private pump(): void {
    if (!this.worker || this.inFlight || this.closed) return
    const index = this.queue.findIndex((entry) =>
      (!this.killed || entry.bypassKill) &&
      (!this.circuitOpen || entry.bypassCircuit)
    )
    if (index < 0) return
    const [entry] = this.queue.splice(index, 1)
    this.queuedBytes -= entry.bytes
    this.inFlight = entry
    this.inFlightTimer = setTimeout(() => {
      if (this.inFlight !== entry) return
      entry.reject(new Error(`Passport persistence request timed out: ${entry.request.method}`))
      this.inFlight = null
      this.inFlightTimer = null
      this.onWorkerFailure(this.worker, new Error(`Persistence deadline exceeded for ${entry.request.method}.`))
    }, entry.deadlineMs)
    try {
      this.worker.postMessage(entry.request)
    } catch (error) {
      this.onWorkerFailure(this.worker, error instanceof Error ? error : new Error(String(error)))
    }
  }

  private onMessage(worker: WorkerLike, value: unknown): void {
    if (this.worker !== worker) return
    const response = value as RpcResponse
    const entry = this.inFlight
    if (!entry || response.id !== entry.request.id) return
    if (this.inFlightTimer) clearTimeout(this.inFlightTimer)
    this.inFlightTimer = null
    this.inFlight = null
    if (response.ok) {
      if (entry.request.method !== 'initialize') {
        this.failures = 0
        this.restartAttempts = 0
      }
      entry.resolve(response.result)
    } else {
      const error = new Error(response.error || 'Passport persistence request failed.')
      ;(error as Error & { code?: string }).code = response.code
      if (response.code === 'PERSISTENCE_QUARANTINED') this.quarantined = true
      entry.reject(error)
      if (response.code === PASSPORT_DOMAIN_ERROR_CODE) {
        this.failures = 0
        this.restartAttempts = 0
      } else if (entry.request.method !== 'initialize') {
        this.recordFailure(error)
      }
    }
    this.pump()
  }

  private onWorkerFailure(worker: WorkerLike | null, error: Error): void {
    if (this.closed) return
    if (worker && this.worker !== worker) return
    if (this.inFlightTimer) clearTimeout(this.inFlightTimer)
    this.inFlightTimer = null
    if (this.inFlight) {
      this.inFlight.reject(error)
      this.inFlight = null
    }
    const activeWorker = this.worker
    this.worker = null
    if (activeWorker) {
      void this.terminateWorker(activeWorker)
    }
    this.failures += 1
    this.lastError = error.message
    if (!this.closing && !this.circuitOpen) {
      if (this.restartAttempts < MAX_RESTARTS && !this.restartTimer) {
        this.restartAttempts += 1
        this.restarts += 1
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null
          this.startWorker()
        }, this.restartDelayMs)
      } else if (!this.restartTimer) {
        this.circuitOpen = true
        const exhausted = new Error('Passport persistence restart budget exhausted; circuit opened.')
        this.lastError = exhausted.message
        for (const entry of this.queue) entry.reject(exhausted)
        this.queue.length = 0
        this.queuedBytes = 0
      }
    }
  }

  private recordFailure(error: Error): void {
    this.failures += 1
    this.lastError = error.message
    if (this.failures >= FAILURE_THRESHOLD) {
      this.circuitOpen = true
      const retained = this.queue.filter((entry) => entry.bypassCircuit)
      for (const entry of this.queue) {
        if (!entry.bypassCircuit) entry.reject(new Error('Passport persistence circuit opened.'))
      }
      this.queue.length = 0
      this.queue.push(...retained)
      this.queuedBytes = retained.reduce((total, entry) => total + entry.bytes, 0)
      this.pump()
    }
  }

  private terminateWorker(worker: WorkerLike): Promise<void> {
    worker.removeAllListeners()
    let termination: Promise<void>
    termination = Promise.resolve()
      .then(() => worker.terminate())
      .then(
        () => undefined,
        (error) => {
          this.terminationErrors.push(error)
        }
      )
      .finally(() => {
        this.pendingTerminations.delete(termination)
      })
    this.pendingTerminations.add(termination)
    return termination
  }
}
