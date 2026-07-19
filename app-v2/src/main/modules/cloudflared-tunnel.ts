import { spawn as nodeSpawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const CLOUDFLARED_VERSION = '2026.7.1'
export const CLOUDFLARED_SHA256 = 'ccb0756de288d3c2c076d19764ca53e0849a10f2dd9c23f8656ac42bdeb45001'
export const CLOUDFLARED_RESOURCE_DIR = 'cloudflared'
export const CLOUDFLARED_CONFIG_NAME = 'quick-tunnel.yml'
export const CLOUDFLARED_OUTPUT_LIMIT = 16_384

interface CloudflaredStat {
  isFile(): boolean
  size: number
}

export interface CloudflaredBinaryDependencies {
  platform: NodeJS.Platform
  resourcesPath: string | undefined
  cwd: string
  exists: (path: string) => boolean
  stat: (path: string) => CloudflaredStat
  read: (path: string) => Buffer
}

export interface CloudflaredBinaryInspection {
  available: boolean
  path: string | null
  configPath: string | null
  version: string
  expectedSha256: string
  actualSha256: string | null
  diagnostic: string
}

export interface CloudflaredBinaryLocation {
  available: boolean
  path: string | null
  configPath: string | null
  diagnostic: string
}

function defaultBinaryDependencies(): CloudflaredBinaryDependencies {
  return {
    platform: process.platform,
    resourcesPath: typeof process.resourcesPath === 'string' ? process.resourcesPath : undefined,
    cwd: process.cwd(),
    exists: existsSync,
    stat: statSync,
    read: (path) => readFileSync(path)
  }
}

export function cloudflaredBinaryCandidates(
  dependencies: Pick<CloudflaredBinaryDependencies, 'platform' | 'resourcesPath' | 'cwd'> = defaultBinaryDependencies()
): string[] {
  if (dependencies.platform !== 'win32') return []
  const candidates: string[] = []
  if (dependencies.resourcesPath) {
    candidates.push(join(dependencies.resourcesPath, CLOUDFLARED_RESOURCE_DIR, 'cloudflared.exe'))
  }
  candidates.push(join(dependencies.cwd, 'resources', CLOUDFLARED_RESOURCE_DIR, 'cloudflared.exe'))
  return [...new Set(candidates)]
}

export function locateCloudflaredBinary(
  overrides: Partial<CloudflaredBinaryDependencies> = {}
): CloudflaredBinaryLocation {
  const defaults = defaultBinaryDependencies()
  const dependencies: CloudflaredBinaryDependencies = {
    ...defaults,
    ...overrides
  }
  if (dependencies.platform !== 'win32') {
    return {
      available: false,
      path: null,
      configPath: null,
      diagnostic: 'The bundled Cloudflare quick tunnel is available only in the Windows build.'
    }
  }

  const diagnostics: string[] = []
  for (const candidate of cloudflaredBinaryCandidates(dependencies)) {
    const configPath = join(dirname(candidate), CLOUDFLARED_CONFIG_NAME)
    try {
      if (!dependencies.exists(candidate)) {
        diagnostics.push(`missing binary ${candidate}`)
        continue
      }
      const binaryStat = dependencies.stat(candidate)
      if (!binaryStat.isFile() || binaryStat.size <= 0) {
        diagnostics.push(`binary is empty or not a file: ${candidate}`)
        continue
      }
      if (!dependencies.exists(configPath)) {
        diagnostics.push(`missing isolated quick-tunnel config ${configPath}`)
        continue
      }
      const configStat = dependencies.stat(configPath)
      if (!configStat.isFile() || configStat.size <= 0) {
        diagnostics.push(`quick-tunnel config is empty or not a file: ${configPath}`)
        continue
      }
      return {
        available: true,
        path: candidate,
        configPath,
        diagnostic: `Found packaged cloudflared at ${candidate}.`
      }
    } catch (error) {
      diagnostics.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    available: false,
    path: null,
    configPath: null,
    diagnostic: `Auto-tunnel is unavailable because the packaged cloudflared resource was not found${diagnostics.length > 0 ? ` (${diagnostics.join('; ')})` : ''}. Reinstall the app, or use a manual public HTTPS URL.`
  }
}

export function inspectCloudflaredBinary(
  overrides: Partial<CloudflaredBinaryDependencies> & { expectedSha256?: string } = {}
): CloudflaredBinaryInspection {
  const defaults = defaultBinaryDependencies()
  const dependencies: CloudflaredBinaryDependencies = {
    ...defaults,
    ...overrides
  }
  const expectedSha256 = (overrides.expectedSha256 ?? CLOUDFLARED_SHA256).toLowerCase()
  const location = locateCloudflaredBinary(dependencies)
  if (!location.available || !location.path || !location.configPath) {
    return {
      available: false,
      path: null,
      configPath: null,
      version: CLOUDFLARED_VERSION,
      expectedSha256,
      actualSha256: null,
      diagnostic: location.diagnostic
    }
  }

  try {
    const configEntries = dependencies.read(location.configPath)
      .toString('utf8')
      .split(/\r?\n/)
      .map((line) => line.replace(/#.*$/, '').trim())
      .filter(Boolean)
    if (configEntries.length !== 1 || configEntries[0] !== 'no-autoupdate: true') {
      return {
        available: false,
        path: location.path,
        configPath: location.configPath,
        version: CLOUDFLARED_VERSION,
        expectedSha256,
        actualSha256: null,
        diagnostic: `cloudflared isolated config integrity check failed at ${location.configPath}. Reinstall the app before enabling Internet streaming.`
      }
    }
    const actualSha256 = createHash('sha256').update(dependencies.read(location.path)).digest('hex')
    if (actualSha256 !== expectedSha256) {
      return {
        available: false,
        path: location.path,
        configPath: location.configPath,
        version: CLOUDFLARED_VERSION,
        expectedSha256,
        actualSha256,
        diagnostic: `cloudflared integrity check failed at ${location.path}: expected SHA-256 ${expectedSha256}, got ${actualSha256}. Reinstall the app before enabling Internet streaming.`
      }
    }
    return {
      available: true,
      path: location.path,
      configPath: location.configPath,
      version: CLOUDFLARED_VERSION,
      expectedSha256,
      actualSha256,
      diagnostic: `Verified cloudflared ${CLOUDFLARED_VERSION} at ${location.path} (SHA-256 ${actualSha256}).`
    }
  } catch (error) {
    return {
      available: false,
      path: location.path,
      configPath: location.configPath,
      version: CLOUDFLARED_VERSION,
      expectedSha256,
      actualSha256: null,
      diagnostic: `cloudflared integrity check failed at ${location.path}: ${error instanceof Error ? error.message : String(error)}. Reinstall the app before enabling Internet streaming.`
    }
  }
}

export interface CloudflaredUrlParseResult {
  url: string | null
  rejected: string | null
}

function stripAnsi(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
}

function cleanUrlCandidate(value: string): string {
  return value
    .replace(/\\\//g, '/')
    .replace(/\\[rnt].*$/i, '')
    .replace(/[)\]}>|,;.!?]+$/g, '')
}

export function parseCloudflaredPublicUrl(output: string): CloudflaredUrlParseResult {
  const sanitized = stripAnsi(output)
  const matches = sanitized.match(/https?:\\?\/\\?\/[^\s"'<>]+/gi) ?? []
  let rejected: string | null = null

  for (const rawCandidate of matches) {
    const candidate = cleanUrlCandidate(rawCandidate)
    if (!/trycloudflare\.com/i.test(candidate)) continue
    try {
      const parsed = new URL(candidate)
      const hostname = parsed.hostname.toLowerCase()
      if (parsed.protocol !== 'https:') {
        rejected = `Rejected cloudflared URL ${candidate}: Auto-tunnel requires HTTPS.`
        continue
      }
      if (hostname === 'trycloudflare.com' || !hostname.endsWith('.trycloudflare.com')) {
        rejected = `Rejected cloudflared URL ${candidate}: expected a trycloudflare.com subdomain.`
        continue
      }
      if (parsed.username || parsed.password || parsed.port || (parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
        rejected = `Rejected malformed cloudflared URL ${candidate}: expected a credential-free HTTPS origin with no path, query, fragment, or custom port.`
        continue
      }
      return { url: parsed.origin, rejected: null }
    } catch {
      rejected = `Rejected malformed cloudflared URL ${candidate}.`
    }
  }

  return { url: null, rejected }
}

function trimTunnelOutput(output: string): string {
  return output.length <= CLOUDFLARED_OUTPUT_LIMIT ? output : output.slice(-CLOUDFLARED_OUTPUT_LIMIT)
}

function lastOutputDetail(output: string): string | null {
  const line = stripAnsi(output)
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1)
  return line ? line.slice(0, 500) : null
}

export interface CloudflaredProcess {
  stdout: NodeJS.ReadableStream | null
  stderr: NodeJS.ReadableStream | null
  exitCode: number | null
  once(event: 'error', listener: (error: Error) => void): this
  once(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
  kill(signal?: NodeJS.Signals): boolean
}

export interface CloudflaredSpawnOptions {
  windowsHide: boolean
  stdio: ['ignore', 'pipe', 'pipe']
  env: NodeJS.ProcessEnv
}

export type SpawnCloudflared = (
  command: string,
  args: string[],
  options: CloudflaredSpawnOptions
) => CloudflaredProcess

export interface CloudflaredReceiverCheck {
  reachable: boolean
  stage: string
  message: string
}

export type CloudflaredTunnelPhase =
  | 'idle'
  | 'starting'
  | 'checking'
  | 'online'
  | 'reconnecting'
  | 'failed'
  | 'stopping'

export interface CloudflaredTunnelSnapshot {
  phase: CloudflaredTunnelPhase
  url: string | null
  message: string
  attempt: number
}

export interface CloudflaredTunnelSupervisorOptions {
  localOrigin: string
  inspectBinary?: () => CloudflaredBinaryInspection
  verifyReceiver: (publicUrl: string, signal: AbortSignal) => Promise<CloudflaredReceiverCheck>
  shouldReconnect: () => boolean
  onSnapshot?: (snapshot: CloudflaredTunnelSnapshot) => void
  onOutput?: (source: 'stdout' | 'stderr', line: string) => void
  spawn?: SpawnCloudflared
  delay?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  startupUrlTimeoutMs?: number
  readinessBackoffMs?: readonly number[]
  startupRetryBackoffMs?: readonly number[]
  reconnectBackoffMs?: readonly number[]
  maxStartupAttempts?: number
  stopGraceMs?: number
  forceKillWaitMs?: number
}

interface ProcessExit {
  code: number | null
  signal: NodeJS.Signals | null
  error: Error | null
}

interface ConnectedAttempt {
  child: CloudflaredProcess
  exit: Promise<ProcessExit>
  url: string
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
  settled: boolean
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void
  let rejectPromise!: (error: Error) => void
  const result: Deferred<T> = {
    promise: new Promise<T>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    }),
    resolve: (value) => {
      if (result.settled) return
      result.settled = true
      resolvePromise(value)
    },
    reject: (error) => {
      if (result.settled) return
      result.settled = true
      rejectPromise(error)
    },
    settled: false
  }
  return result
}

function abortError(): Error {
  const error = new Error('Auto-tunnel operation was cancelled.')
  error.name = 'AbortError'
  return error
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function defaultDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => finish(), Math.max(0, milliseconds))
    timer.unref()
    const onAbort = (): void => {
      clearTimeout(timer)
      finish(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function defaultSpawn(command: string, args: string[], options: CloudflaredSpawnOptions): CloudflaredProcess {
  return nodeSpawn(command, args, options)
}

function formatExit(exit: ProcessExit): string {
  if (exit.error) return `process error: ${exit.error.message}`
  return `code ${exit.code ?? 'unknown'}${exit.signal ? `, signal ${exit.signal}` : ''}`
}

function backoffAt(values: readonly number[], index: number): number {
  if (values.length === 0) return 0
  return values[Math.min(Math.max(index, 0), values.length - 1)]
}

function waitForProcessExit(exit: Promise<ProcessExit>, signal: AbortSignal): Promise<ProcessExit | null> {
  if (signal.aborted) return Promise.resolve(null)
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: ProcessExit | null): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      resolve(result)
    }
    const onAbort = (): void => finish(null)
    signal.addEventListener('abort', onAbort, { once: true })
    void exit.then((result) => finish(result))
  })
}

export class CloudflaredTunnelSupervisor {
  private readonly inspectBinary: () => CloudflaredBinaryInspection
  private readonly spawn: SpawnCloudflared
  private readonly delay: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  private readonly startupUrlTimeoutMs: number
  private readonly readinessBackoffMs: readonly number[]
  private readonly startupRetryBackoffMs: readonly number[]
  private readonly reconnectBackoffMs: readonly number[]
  private readonly maxStartupAttempts: number
  private readonly stopGraceMs: number
  private readonly forceKillWaitMs: number
  private snapshotValue: CloudflaredTunnelSnapshot = {
    phase: 'idle',
    url: null,
    message: 'Auto-tunnel is stopped.',
    attempt: 0
  }
  private runController: AbortController | null = null
  private runPromise: Promise<void> | null = null
  private initialReady: Deferred<string> | null = null
  private currentChild: CloudflaredProcess | null = null
  private currentExit: Promise<ProcessExit> | null = null

  constructor(private readonly options: CloudflaredTunnelSupervisorOptions) {
    this.inspectBinary = options.inspectBinary ?? inspectCloudflaredBinary
    this.spawn = options.spawn ?? defaultSpawn
    this.delay = options.delay ?? defaultDelay
    this.startupUrlTimeoutMs = options.startupUrlTimeoutMs ?? 30_000
    this.readinessBackoffMs = options.readinessBackoffMs ?? [0, 500, 1_000, 2_000, 4_000, 8_000]
    this.startupRetryBackoffMs = options.startupRetryBackoffMs ?? [1_000, 3_000]
    this.reconnectBackoffMs = options.reconnectBackoffMs ?? [1_000, 3_000, 5_000, 10_000, 30_000]
    this.maxStartupAttempts = Math.max(1, options.maxStartupAttempts ?? 2)
    this.stopGraceMs = options.stopGraceMs ?? 3_000
    this.forceKillWaitMs = options.forceKillWaitMs ?? 1_000
  }

  get snapshot(): CloudflaredTunnelSnapshot {
    return this.snapshotValue
  }

  async start(): Promise<string> {
    if (this.snapshotValue.phase === 'online' && this.snapshotValue.url) return this.snapshotValue.url
    if (this.initialReady && this.runPromise) return this.initialReady.promise
    if (this.currentChild) {
      throw new Error('A previous cloudflared process is still active and could not be replaced safely.')
    }

    const controller = new AbortController()
    const initialReady = deferred<string>()
    this.runController = controller
    this.initialReady = initialReady
    this.runPromise = this.run(controller, initialReady).catch((error) => {
      const message = `Auto-tunnel supervisor failed: ${error instanceof Error ? error.message : String(error)}`
      initialReady.reject(new Error(message))
      this.emit({ phase: 'failed', url: null, attempt: this.snapshotValue.attempt, message })
    }).finally(() => {
      if (this.runController === controller) this.runController = null
      if (this.initialReady === initialReady) this.initialReady = null
      this.runPromise = null
    })
    return initialReady.promise
  }

  async stop(): Promise<void> {
    const controller = this.runController
    const runPromise = this.runPromise
    this.emit({
      phase: 'stopping',
      url: null,
      attempt: this.snapshotValue.attempt,
      message: 'Stopping Cloudflare quick tunnel…'
    })
    controller?.abort()
    await this.terminateCurrent()
    if (runPromise) await runPromise
    this.emit({
      phase: 'idle',
      url: null,
      attempt: 0,
      message: 'Auto-tunnel is stopped.'
    })
  }

  private emit(snapshot: CloudflaredTunnelSnapshot): void {
    this.snapshotValue = snapshot
    try {
      this.options.onSnapshot?.(snapshot)
    } catch {
      // UI/log callbacks must not break process cleanup.
    }
  }

  private async run(controller: AbortController, initialReady: Deferred<string>): Promise<void> {
    let readyOnce = false
    let startupFailures = 0
    let reconnectFailures = 0

    while (!controller.signal.aborted) {
      const attempt = readyOnce ? reconnectFailures + 1 : startupFailures + 1
      const delayMs = readyOnce
        ? backoffAt(this.reconnectBackoffMs, reconnectFailures)
        : startupFailures > 0
          ? backoffAt(this.startupRetryBackoffMs, startupFailures - 1)
          : 0

      if (delayMs > 0) {
        this.emit({
          phase: readyOnce ? 'reconnecting' : 'starting',
          url: null,
          attempt,
          message: `${readyOnce ? 'Auto-tunnel disconnected' : 'Auto-tunnel start failed'}; retrying in ${delayMs} ms (attempt ${attempt}${readyOnce ? '' : `/${this.maxStartupAttempts}`}).`
        })
        try {
          await this.delay(delayMs, controller.signal)
        } catch (error) {
          if (isAbortError(error)) break
          throw error
        }
      }

      try {
        const connected = await this.connectOnce(attempt, controller.signal)
        readyOnce = true
        reconnectFailures = 0
        initialReady.resolve(connected.url)
        this.emit({
          phase: 'online',
          url: connected.url,
          attempt,
          message: `Auto-tunnel receiver self-test passed at ${connected.url}.`
        })

        const exit = await waitForProcessExit(connected.exit, controller.signal)
        if (!exit) break
        if (exit.error && this.currentChild === connected.child) {
          try {
            await this.terminateCurrent()
          } catch (terminationError) {
            const message = `cloudflared reported ${formatExit(exit)} and could not be terminated: ${terminationError instanceof Error ? terminationError.message : String(terminationError)} Refusing to reconnect to avoid an orphan.`
            this.emit({ phase: 'failed', url: null, attempt, message })
            return
          }
        } else if (this.currentChild === connected.child) {
          this.currentChild = null
          this.currentExit = null
        }
        if (controller.signal.aborted || !this.options.shouldReconnect()) break
        reconnectFailures = 0
        this.emit({
          phase: 'reconnecting',
          url: null,
          attempt: 1,
          message: `Auto-tunnel stopped unexpectedly (${formatExit(exit)}). The stale public URL was removed; reconnecting with backoff.`
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        try {
          await this.terminateCurrent()
        } catch (terminationError) {
          const terminationMessage = terminationError instanceof Error ? terminationError.message : String(terminationError)
          const fatalMessage = `${message} ${terminationMessage} Refusing to spawn another cloudflared process to avoid an orphan.`
          initialReady.reject(new Error(fatalMessage))
          this.emit({ phase: 'failed', url: null, attempt, message: fatalMessage })
          return
        }
        if (controller.signal.aborted || isAbortError(error)) break

        if (!readyOnce) {
          startupFailures += 1
          if (startupFailures >= this.maxStartupAttempts) {
            const finalMessage = `Auto-tunnel failed after ${startupFailures} attempt${startupFailures === 1 ? '' : 's'}: ${message}`
            initialReady.reject(new Error(finalMessage))
            this.emit({ phase: 'failed', url: null, attempt: startupFailures, message: finalMessage })
            return
          }
          this.emit({
            phase: 'starting',
            url: null,
            attempt: startupFailures + 1,
            message: `${message} A clean retry will start after backoff.`
          })
        } else {
          reconnectFailures += 1
          if (!this.options.shouldReconnect()) break
          this.emit({
            phase: 'reconnecting',
            url: null,
            attempt: reconnectFailures,
            message: `${message} The stale public URL was removed; reconnecting with backoff.`
          })
        }
      }
    }

    if (!initialReady.settled) initialReady.reject(new Error('Auto-tunnel start was cancelled.'))
  }

  private async connectOnce(attempt: number, signal: AbortSignal): Promise<ConnectedAttempt> {
    const inspection = this.inspectBinary()
    if (!inspection.available || !inspection.path || !inspection.configPath) {
      throw new Error(inspection.diagnostic)
    }

    const args = [
      'tunnel',
      '--config',
      inspection.configPath,
      '--no-autoupdate',
      '--url',
      this.options.localOrigin
    ]
    this.emit({
      phase: 'starting',
      url: null,
      attempt,
      message: `Starting verified cloudflared ${inspection.version} (attempt ${attempt}) from ${inspection.path}.`
    })

    let child: CloudflaredProcess
    try {
      child = this.spawn(inspection.path, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' }
      })
    } catch (error) {
      throw new Error(`Auto-tunnel could not spawn ${inspection.path}: ${error instanceof Error ? error.message : String(error)}`)
    }

    const processError = deferred<Error>()
    const closed = deferred<ProcessExit>()
    child.once('error', (error) => processError.resolve(error))
    child.once('close', (code, closeSignal) => closed.resolve({ code, signal: closeSignal, error: null }))
    const lifecycle = Promise.race([
      closed.promise,
      processError.promise.then((error): ProcessExit => ({ code: null, signal: null, error }))
    ])
    this.currentChild = child
    this.currentExit = closed.promise

    let output = ''
    let rejectedUrl: string | null = null
    const publishedUrl = deferred<string>()
    const consume = (source: 'stdout' | 'stderr', chunk: Buffer | string): void => {
      const text = chunk.toString()
      output = trimTunnelOutput(output + text)
      for (const line of stripAnsi(text).split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
        this.options.onOutput?.(source, line.slice(0, 500))
      }
      const parsed = parseCloudflaredPublicUrl(output)
      if (parsed.rejected) rejectedUrl = parsed.rejected
      if (parsed.url) publishedUrl.resolve(parsed.url)
    }
    child.stdout?.on('data', (chunk: Buffer | string) => consume('stdout', chunk))
    child.stderr?.on('data', (chunk: Buffer | string) => consume('stderr', chunk))

    const discovery = await Promise.race([
      publishedUrl.promise.then((url) => ({ kind: 'url' as const, url })),
      lifecycle.then((processExit) => ({ kind: 'exit' as const, exit: processExit })),
      this.delay(this.startupUrlTimeoutMs, signal).then(() => ({ kind: 'timeout' as const }))
    ])
    if (discovery.kind === 'exit') {
      const detail = rejectedUrl ?? lastOutputDetail(output)
      throw new Error(`Auto-tunnel exited before publishing a valid HTTPS URL (${formatExit(discovery.exit)})${detail ? `: ${detail}` : '.'}`)
    }
    if (discovery.kind === 'timeout') {
      const detail = rejectedUrl ?? lastOutputDetail(output)
      throw new Error(`Auto-tunnel timed out after ${this.startupUrlTimeoutMs} ms before publishing a valid HTTPS trycloudflare.com URL${detail ? `: ${detail}` : '.'}`)
    }

    const publicUrl = discovery.url
    let lastReceiverFailure = 'receiver self-test did not run'
    for (let index = 0; index < this.readinessBackoffMs.length; index += 1) {
      const delayMs = this.readinessBackoffMs[index]
      if (delayMs > 0) {
        this.emit({
          phase: 'checking',
          url: null,
          attempt,
          message: `Cloudflare published ${publicUrl}, but the receiver is not ready (${lastReceiverFailure}). Retrying in ${delayMs} ms (${index + 1}/${this.readinessBackoffMs.length}).`
        })
        await Promise.race([
          this.delay(delayMs, signal),
          lifecycle.then((processExit) => {
            throw new Error(`Auto-tunnel exited during receiver readiness checks (${formatExit(processExit)}).`)
          })
        ])
      }

      this.emit({
        phase: 'checking',
        url: null,
        attempt,
        message: `Cloudflare published ${publicUrl}; running authenticated receiver self-test ${index + 1}/${this.readinessBackoffMs.length}.`
      })
      const receiverResult = await Promise.race([
        Promise.resolve()
          .then(() => this.options.verifyReceiver(publicUrl, signal))
          .catch((error): CloudflaredReceiverCheck => ({
            reachable: false,
            stage: 'network',
            message: error instanceof Error ? error.message : String(error)
          }))
          .then((check) => ({ kind: 'receiver' as const, check })),
        lifecycle.then((processExit) => ({ kind: 'exit' as const, exit: processExit }))
      ])
      if (receiverResult.kind === 'exit') {
        throw new Error(`Auto-tunnel exited during receiver self-test (${formatExit(receiverResult.exit)}).`)
      }
      if (receiverResult.check.reachable) {
        return { child, exit: lifecycle, url: publicUrl }
      }
      lastReceiverFailure = `${receiverResult.check.stage}: ${receiverResult.check.message}`
    }

    throw new Error(`Cloudflare published ${publicUrl}, but the authenticated receiver self-test failed after ${this.readinessBackoffMs.length} attempts: ${lastReceiverFailure}`)
  }

  private async terminateCurrent(): Promise<void> {
    const child = this.currentChild
    const exit = this.currentExit
    if (!child || !exit) {
      this.currentChild = null
      this.currentExit = null
      return
    }
    if (child.exitCode !== null) {
      this.currentChild = null
      this.currentExit = null
      return
    }

    try {
      child.kill('SIGTERM')
    } catch {
      // Escalate below.
    }
    const stoppedGracefully = await Promise.race([
      exit.then(() => true),
      this.delay(this.stopGraceMs).then(() => false)
    ])
    if (!stoppedGracefully) {
      try {
        child.kill('SIGKILL')
      } catch {
        // Report failure below if no close event arrives.
      }
      const forceStopped = await Promise.race([
        exit.then(() => true),
        this.delay(this.forceKillWaitMs).then(() => false)
      ])
      if (!forceStopped) {
        throw new Error(`cloudflared did not exit after SIGTERM and SIGKILL within ${this.stopGraceMs + this.forceKillWaitMs} ms.`)
      }
    }
    if (this.currentChild === child) {
      this.currentChild = null
      this.currentExit = null
    }
  }
}
