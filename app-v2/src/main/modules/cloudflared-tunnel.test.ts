import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CLOUDFLARED_CONFIG_NAME,
  CLOUDFLARED_SHA256,
  CLOUDFLARED_VERSION,
  CloudflaredTunnelSupervisor,
  inspectCloudflaredBinary,
  parseCloudflaredPublicUrl,
  type CloudflaredBinaryInspection,
  type CloudflaredProcess,
  type CloudflaredTunnelSnapshot
} from './cloudflared-tunnel'

class FakeCloudflaredProcess extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly signals: NodeJS.Signals[] = []
  exitCode: number | null = null

  constructor(private readonly closeOn: 'SIGTERM' | 'SIGKILL' | 'never' = 'SIGTERM') {
    super()
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.signals.push(signal)
    if (this.closeOn === signal) queueMicrotask(() => this.close(null, signal))
    return true
  }

  close(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null) return
    this.exitCode = code ?? 0
    this.emit('close', code, signal)
  }

  fail(error: Error): void {
    this.emit('error', error)
  }
}

function verifiedInspection(): CloudflaredBinaryInspection {
  return {
    available: true,
    path: 'C:\\Program Files\\Ultimate Sim App\\resources\\cloudflared\\cloudflared.exe',
    configPath: 'C:\\Program Files\\Ultimate Sim App\\resources\\cloudflared\\quick-tunnel.yml',
    version: '2026.7.1',
    expectedSha256: CLOUDFLARED_SHA256,
    actualSha256: CLOUDFLARED_SHA256,
    diagnostic: 'verified'
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('cloudflared URL parsing', () => {
  it.each([
    ['plain stdout', 'Your quick Tunnel has been created!\nhttps://rapid-orange-car.trycloudflare.com\n'],
    ['structured stderr', '{"level":"info","message":"https://rapid-orange-car.trycloudflare.com"}'],
    ['ANSI table', '\u001b[32m│ https://rapid-orange-car.trycloudflare.com │\u001b[0m'],
    ['escaped JSON slash', '{"url":"https:\\/\\/rapid-orange-car.trycloudflare.com\\n"}']
  ])('accepts %s output', (_label, output) => {
    expect(parseCloudflaredPublicUrl(output)).toEqual({
      url: 'https://rapid-orange-car.trycloudflare.com',
      rejected: null
    })
  })

  it('rejects non-HTTPS and malformed public origins with exact diagnostics', () => {
    expect(parseCloudflaredPublicUrl('http://rapid-orange-car.trycloudflare.com').rejected).toMatch(/requires HTTPS/)
    expect(parseCloudflaredPublicUrl('https://rapid-orange-car.trycloudflare.com/path').rejected).toMatch(/malformed.*no path/i)
    expect(parseCloudflaredPublicUrl('https://trycloudflare.com').rejected).toMatch(/subdomain/i)
    expect(parseCloudflaredPublicUrl('https://trycloudflare.com.evil.test').rejected).toMatch(/expected a trycloudflare\.com subdomain/i)
  })
})

describe('cloudflared packaged binary inspection', () => {
  it('prefers the packaged resources path and verifies the binary hash on every inspection', () => {
    const resourcesPath = 'C:\\Program Files\\Ultimate Sim App\\resources'
    const binaryPath = join(resourcesPath, 'cloudflared', 'cloudflared.exe')
    const configPath = join(resourcesPath, 'cloudflared', CLOUDFLARED_CONFIG_NAME)
    const binary = Buffer.from('verified cloudflared fixture')
    const expectedSha256 = createHash('sha256').update(binary).digest('hex')
    const files = new Map<string, Buffer>([
      [binaryPath, binary],
      [configPath, Buffer.from('# isolated config\nno-autoupdate: true\n')]
    ])
    const read = vi.fn((path: string) => files.get(path) ?? Buffer.alloc(0))
    const dependencies = {
      platform: 'win32' as const,
      resourcesPath,
      cwd: 'D:\\source\\app-v2',
      expectedSha256,
      exists: (path: string) => files.has(path),
      stat: (path: string) => ({
        isFile: () => files.has(path),
        size: files.get(path)?.length ?? 0
      }),
      read
    }

    expect(inspectCloudflaredBinary(dependencies)).toMatchObject({
      available: true,
      path: binaryPath,
      configPath,
      actualSha256: expectedSha256
    })
    expect(inspectCloudflaredBinary(dependencies).available).toBe(true)
    expect(read).toHaveBeenCalledTimes(4)
  })

  it('rejects a packaged binary whose bytes no longer match the pin', () => {
    const resourcesPath = 'C:\\Program Files\\Ultimate Sim App\\resources'
    const binaryPath = join(resourcesPath, 'cloudflared', 'cloudflared.exe')
    const configPath = join(resourcesPath, 'cloudflared', CLOUDFLARED_CONFIG_NAME)
    const files = new Map<string, Buffer>([
      [binaryPath, Buffer.from('tampered')],
      [configPath, Buffer.from('no-autoupdate: true\n')]
    ])
    const inspection = inspectCloudflaredBinary({
      platform: 'win32',
      resourcesPath,
      cwd: 'D:\\source\\app-v2',
      expectedSha256: '0'.repeat(64),
      exists: (path) => files.has(path),
      stat: (path) => ({ isFile: () => files.has(path), size: files.get(path)?.length ?? 0 }),
      read: (path) => files.get(path) ?? Buffer.alloc(0)
    })

    expect(inspection.available).toBe(false)
    expect(inspection.path).toBe(binaryPath)
    expect(inspection.diagnostic).toMatch(/integrity check failed.*expected SHA-256.*got/i)
  })

  it('keeps the runtime pin and packaged resource paths aligned with release scripts', () => {
    const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
    const fetchScript = readFileSync(resolve(appRoot, 'scripts/fetch-win-cloudflared.sh'), 'utf8')
    const builder = readFileSync(resolve(appRoot, 'electron-builder.yml'), 'utf8')
    const beforePack = readFileSync(resolve(appRoot, 'scripts/fetch-win-cloudflared.cjs'), 'utf8')
    const isolatedConfig = readFileSync(resolve(appRoot, 'resources/cloudflared/quick-tunnel.yml'), 'utf8')

    expect(fetchScript).toContain(`CLOUDFLARED_SHA256="${CLOUDFLARED_SHA256}"`)
    expect(fetchScript).toContain(`CLOUDFLARED_VERSION="${CLOUDFLARED_VERSION}"`)
    expect(builder).toContain('resources/cloudflared/cloudflared.exe')
    expect(builder).toContain('resources/cloudflared/quick-tunnel.yml')
    expect(beforePack).toContain('quick-tunnel.yml')
    expect(isolatedConfig).toMatch(/^no-autoupdate:\s*true$/m)
  })
})

describe('cloudflared tunnel supervisor', () => {
  it('parses a URL split across stdout chunks and waits for the receiver self-test', async () => {
    const child = new FakeCloudflaredProcess()
    const snapshots: CloudflaredTunnelSnapshot[] = []
    const spawn = vi.fn(() => child as unknown as CloudflaredProcess)
    let releaseReceiver!: () => void
    const receiverReady = new Promise<void>((resolveReady) => { releaseReceiver = resolveReady })
    const verifyReceiver = vi.fn(async () => {
      await receiverReady
      return { reachable: true, stage: 'complete', message: 'receiver passed' }
    })
    const supervisor = new CloudflaredTunnelSupervisor({
      localOrigin: 'http://127.0.0.1:3210',
      inspectBinary: verifiedInspection,
      spawn,
      verifyReceiver,
      shouldReconnect: () => false,
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      maxStartupAttempts: 1
    })

    const startPromise = supervisor.start()
    child.stdout.write('https://split-name.trycloud')
    child.stderr.write('flare.com\n')
    await flushPromises()
    expect(verifyReceiver).toHaveBeenCalledWith('https://split-name.trycloudflare.com', expect.any(AbortSignal))
    expect(spawn).toHaveBeenCalledWith(
      verifiedInspection().path,
      ['tunnel', '--config', verifiedInspection().configPath, '--no-autoupdate', '--url', 'http://127.0.0.1:3210'],
      expect.objectContaining({ windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    )
    expect(snapshots.at(-1)?.phase).toBe('checking')

    releaseReceiver()
    await expect(startPromise).resolves.toBe('https://split-name.trycloudflare.com')
    expect(supervisor.snapshot.phase).toBe('online')
    await supervisor.stop()
  })

  it('retries receiver readiness with backoff and surfaces the failing stage', async () => {
    vi.useFakeTimers()
    const child = new FakeCloudflaredProcess()
    const snapshots: CloudflaredTunnelSnapshot[] = []
    const verifyReceiver = vi.fn()
      .mockResolvedValueOnce({ reachable: false, stage: 'document', message: 'HTTP 530' })
      .mockResolvedValueOnce({ reachable: true, stage: 'complete', message: 'passed' })
    const supervisor = new CloudflaredTunnelSupervisor({
      localOrigin: 'http://127.0.0.1:3210',
      inspectBinary: verifiedInspection,
      spawn: () => child as unknown as CloudflaredProcess,
      verifyReceiver,
      shouldReconnect: () => false,
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      readinessBackoffMs: [0, 250],
      maxStartupAttempts: 1
    })

    const startPromise = supervisor.start()
    child.stderr.write('https://readiness-retry.trycloudflare.com\n')
    await vi.advanceTimersByTimeAsync(0)
    expect(snapshots.some((snapshot) => /document:.*HTTP 530.*Retrying in 250 ms/i.test(snapshot.message))).toBe(true)
    await vi.advanceTimersByTimeAsync(250)
    await expect(startPromise).resolves.toBe('https://readiness-retry.trycloudflare.com')
    expect(verifyReceiver).toHaveBeenCalledTimes(2)
    await supervisor.stop()
  })

  it('times out, terminates the process, and reports the last diagnostic', async () => {
    vi.useFakeTimers()
    const child = new FakeCloudflaredProcess()
    const supervisor = new CloudflaredTunnelSupervisor({
      localOrigin: 'http://127.0.0.1:3210',
      inspectBinary: verifiedInspection,
      spawn: () => child as unknown as CloudflaredProcess,
      verifyReceiver: vi.fn(),
      shouldReconnect: () => false,
      startupUrlTimeoutMs: 100,
      maxStartupAttempts: 1
    })

    const result = supervisor.start().then(
      () => new Error('unexpected success'),
      (error) => error as Error
    )
    child.stderr.write('Requesting new quick Tunnel on trycloudflare.com...\n')
    await vi.advanceTimersByTimeAsync(100)
    const error = await result
    expect(error.message).toMatch(/timed out after 100 ms.*Requesting new quick Tunnel/i)
    expect(child.signals).toContain('SIGTERM')
    expect(supervisor.snapshot.phase).toBe('failed')
  })

  it('reports an early exit and a malformed URL without leaving a process handle', async () => {
    const child = new FakeCloudflaredProcess()
    const supervisor = new CloudflaredTunnelSupervisor({
      localOrigin: 'http://127.0.0.1:3210',
      inspectBinary: verifiedInspection,
      spawn: () => child as unknown as CloudflaredProcess,
      verifyReceiver: vi.fn(),
      shouldReconnect: () => false,
      maxStartupAttempts: 1
    })

    const result = supervisor.start().then(
      () => new Error('unexpected success'),
      (error) => error as Error
    )
    child.stderr.write('http://unsafe.trycloudflare.com\n')
    child.close(1)
    const error = await result
    expect(error.message).toMatch(/exited before publishing.*code 1.*requires HTTPS/i)
    expect(supervisor.snapshot.phase).toBe('failed')
  })

  it('removes the stale URL and reconnects to a fresh process after an unexpected exit', async () => {
    vi.useFakeTimers()
    const first = new FakeCloudflaredProcess()
    const second = new FakeCloudflaredProcess()
    const processes = [first, second]
    const snapshots: CloudflaredTunnelSnapshot[] = []
    const supervisor = new CloudflaredTunnelSupervisor({
      localOrigin: 'http://127.0.0.1:3210',
      inspectBinary: verifiedInspection,
      spawn: () => processes.shift() as unknown as CloudflaredProcess,
      verifyReceiver: async () => ({ reachable: true, stage: 'complete', message: 'passed' }),
      shouldReconnect: () => true,
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      reconnectBackoffMs: [100],
      maxStartupAttempts: 1
    })

    const startPromise = supervisor.start()
    first.stdout.write('https://first-url.trycloudflare.com\n')
    await expect(startPromise).resolves.toBe('https://first-url.trycloudflare.com')
    first.close(1)
    await flushPromises()
    expect(snapshots.at(-1)).toMatchObject({ phase: 'reconnecting', url: null })

    await vi.advanceTimersByTimeAsync(100)
    second.stderr.write('https://second-url.trycloudflare.com\n')
    await vi.advanceTimersByTimeAsync(0)
    expect(supervisor.snapshot).toMatchObject({
      phase: 'online',
      url: 'https://second-url.trycloudflare.com'
    })
    expect(snapshots.findIndex((snapshot) => snapshot.phase === 'reconnecting' && snapshot.url === null))
      .toBeLessThan(snapshots.findIndex((snapshot) => snapshot.url === 'https://second-url.trycloudflare.com'))
    await supervisor.stop()
  })

  it('force-kills a process that ignores graceful shutdown before returning', async () => {
    vi.useFakeTimers()
    const child = new FakeCloudflaredProcess('SIGKILL')
    const supervisor = new CloudflaredTunnelSupervisor({
      localOrigin: 'http://127.0.0.1:3210',
      inspectBinary: verifiedInspection,
      spawn: () => child as unknown as CloudflaredProcess,
      verifyReceiver: async () => ({ reachable: true, stage: 'complete', message: 'passed' }),
      shouldReconnect: () => false,
      stopGraceMs: 100,
      forceKillWaitMs: 50,
      maxStartupAttempts: 1
    })

    const startPromise = supervisor.start()
    child.stdout.write('https://force-stop.trycloudflare.com\n')
    await expect(startPromise).resolves.toBe('https://force-stop.trycloudflare.com')
    const stopPromise = supervisor.stop()
    await vi.advanceTimersByTimeAsync(100)
    await stopPromise
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(supervisor.snapshot.phase).toBe('idle')
  })

  it('can start cleanly again after an explicit stop without reusing the stale URL', async () => {
    const first = new FakeCloudflaredProcess()
    const second = new FakeCloudflaredProcess()
    const processes = [first, second]
    const supervisor = new CloudflaredTunnelSupervisor({
      localOrigin: 'http://127.0.0.1:3210',
      inspectBinary: verifiedInspection,
      spawn: () => processes.shift() as unknown as CloudflaredProcess,
      verifyReceiver: async () => ({ reachable: true, stage: 'complete', message: 'passed' }),
      shouldReconnect: () => false,
      maxStartupAttempts: 1
    })

    const firstStart = supervisor.start()
    first.stdout.write('https://first-explicit-start.trycloudflare.com\n')
    await expect(firstStart).resolves.toBe('https://first-explicit-start.trycloudflare.com')
    await supervisor.stop()
    expect(supervisor.snapshot.url).toBeNull()

    const secondStart = supervisor.start()
    second.stderr.write('https://second-explicit-start.trycloudflare.com\n')
    await expect(secondStart).resolves.toBe('https://second-explicit-start.trycloudflare.com')
    expect(supervisor.snapshot.url).toBe('https://second-explicit-start.trycloudflare.com')
    await supervisor.stop()
  })

  it('retains the process guard when even force-kill cannot confirm exit', async () => {
    vi.useFakeTimers()
    const child = new FakeCloudflaredProcess('never')
    const supervisor = new CloudflaredTunnelSupervisor({
      localOrigin: 'http://127.0.0.1:3210',
      inspectBinary: verifiedInspection,
      spawn: () => child as unknown as CloudflaredProcess,
      verifyReceiver: async () => ({ reachable: true, stage: 'complete', message: 'passed' }),
      shouldReconnect: () => false,
      stopGraceMs: 100,
      forceKillWaitMs: 50,
      maxStartupAttempts: 1
    })

    const startPromise = supervisor.start()
    child.stdout.write('https://guarded-orphan.trycloudflare.com\n')
    await expect(startPromise).resolves.toBe('https://guarded-orphan.trycloudflare.com')
    const stopResult = supervisor.stop().then(
      () => new Error('unexpected success'),
      (error) => error as Error
    )
    await vi.advanceTimersByTimeAsync(150)
    await expect(stopResult).resolves.toMatchObject({
      message: expect.stringMatching(/did not exit after SIGTERM and SIGKILL/i)
    })
    await expect(supervisor.start()).rejects.toThrow(/previous cloudflared process is still active/i)
  })
})
