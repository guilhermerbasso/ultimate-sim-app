import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DiagnosticLogger } from './logger'
import {
  LOG_RETENTION_MS,
  appLogFileStartMs,
  formatLogLine,
  isAppLogFileName,
  isSecretKey,
  logFileName,
  parseLogLine,
  redact,
  sanitizeEntry,
  scrubSecretString,
  selectExpiredLogFiles
} from '../../shared/logger'

const HOUR = 60 * 60 * 1000

// A fixed clock so file names + retention math are deterministic.
const NOW = Date.UTC(2026, 5, 20, 18, 30, 0) // 2026-06-20T18:30:00Z

describe('hourly file scheme', () => {
  it('formats UTC hourly file names and recognizes only its own', () => {
    expect(logFileName(new Date(NOW))).toBe('app-20260620-18.log')
    expect(isAppLogFileName('app-20260620-18.log')).toBe(true)
    expect(isAppLogFileName('iracing-diagnostics.log')).toBe(false)
    expect(isAppLogFileName('app-2026-06-20.log')).toBe(false)
    expect(appLogFileStartMs('app-20260620-18.log')).toBe(Date.UTC(2026, 5, 20, 18))
    expect(appLogFileStartMs('not-a-log.log')).toBeNull()
  })
})

describe('24h retention selection', () => {
  it('removes files whose whole hour is older than 24h, keeps recent ones', () => {
    const names = [
      logFileName(new Date(NOW)), // current hour — keep
      logFileName(new Date(NOW - 1 * HOUR)), // 1h ago — keep
      logFileName(new Date(NOW - 23 * HOUR)), // 23h ago — keep
      logFileName(new Date(NOW - 26 * HOUR)), // 26h ago — expire
      logFileName(new Date(NOW - 48 * HOUR)), // 48h ago — expire
      'iracing-diagnostics.log', // foreign — never selected
      'random.txt'
    ]
    const expired = selectExpiredLogFiles(names, NOW)
    expect(expired).toEqual([logFileName(new Date(NOW - 26 * HOUR)), logFileName(new Date(NOW - 48 * HOUR))])
    expect(expired).not.toContain('iracing-diagnostics.log')
  })

  it('never keeps an entry older than the retention horizon', () => {
    // Any file NOT selected must have its newest possible entry within 24h.
    const names = Array.from({ length: 72 }, (_unused, h) => logFileName(new Date(NOW - h * HOUR)))
    const expired = new Set(selectExpiredLogFiles(names, NOW))
    for (const name of names) {
      if (expired.has(name)) continue
      const start = appLogFileStartMs(name)!
      const newestEntry = start + HOUR
      expect(NOW - newestEntry).toBeLessThanOrEqual(LOG_RETENTION_MS)
    }
  })
})

describe('secret redactor', () => {
  it('replaces secret-looking keys with [REDACTED]', () => {
    const out = redact({
      user: 'gui',
      password: 'hunter2',
      authToken: 'abc',
      access_token: 'xyz',
      cookie: 'sid=1',
      authorization: 'Bearer zzz',
      apiKey: 'k',
      nested: { clientSecret: 's', ok: 1 }
    }) as Record<string, unknown>

    expect(out.user).toBe('gui')
    expect(out.password).toBe('[REDACTED]')
    expect(out.authToken).toBe('[REDACTED]')
    expect(out.access_token).toBe('[REDACTED]')
    expect(out.cookie).toBe('[REDACTED]')
    expect(out.authorization).toBe('[REDACTED]')
    expect(out.apiKey).toBe('[REDACTED]')
    expect((out.nested as Record<string, unknown>).clientSecret).toBe('[REDACTED]')
    expect((out.nested as Record<string, unknown>).ok).toBe(1)

    const serialized = JSON.stringify(out)
    expect(serialized).not.toContain('hunter2')
    expect(serialized).not.toContain('Bearer zzz')
  })

  it('flags credential-shaped keys and redacts .bin keys', () => {
    expect(isSecretKey('password')).toBe(true)
    expect(isSecretKey('SESSION_ID')).toBe(true)
    expect(isSecretKey('oauthState')).toBe(true)
    expect(isSecretKey('width')).toBe(false)
    const out = redact({ 'iracing-oauth.bin': { accessToken: 'x' }, width: 800 }) as Record<string, unknown>
    expect(out['iracing-oauth.bin']).toBe('[REDACTED]')
    expect(out.width).toBe(800)
  })

  it('turns binary payloads into [binary]', () => {
    const out = redact({ blob: new Uint8Array([1, 2, 3]), buf: new ArrayBuffer(8), n: 5 }) as Record<
      string,
      unknown
    >
    expect(out.blob).toBe('[binary]')
    expect(out.buf).toBe('[binary]')
    expect(out.n).toBe(5)
  })

  it('scrubs inline secrets and JWTs from free text', () => {
    const jwt = 'eyJhbGciOiJIUzI1Ni), it.s' // shape-only
    const realJwt = 'eyJabc123.eyJdef456.signature789'
    expect(scrubSecretString(`token=supersecretvalue here`)).toContain('[REDACTED]')
    expect(scrubSecretString(`Authorization: Bearer ${realJwt}`)).toContain('[REDACTED]')
    expect(scrubSecretString(`Authorization: Bearer ${realJwt}`)).not.toContain('signature789')
    expect(scrubSecretString('plain message')).toBe('plain message')
    expect(jwt).toBeTruthy()
  })

  it('survives circular references without throwing', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a.self = a
    expect(() => redact(a)).not.toThrow()
    const out = redact(a) as Record<string, unknown>
    expect(out.self).toBe('[circular]')
  })
})

describe('log line format', () => {
  it('sanitizeEntry coerces level/area/message, stamps ISO time, redacts detail', () => {
    const entry = sanitizeEntry(
      { level: 'banana', area: '  serial  ', message: 'hi', detail: { password: 'x', ok: 1 } },
      NOW
    )
    expect(entry.level).toBe('info') // unknown level → info
    expect(entry.area).toBe('serial')
    expect(entry.ts).toBe('2026-06-20T18:30:00.000Z')
    expect((entry.detail as Record<string, unknown>).password).toBe('[REDACTED]')
    expect((entry.detail as Record<string, unknown>).ok).toBe(1)
  })

  it('formatLogLine produces a single newline-terminated JSONL line that round-trips', () => {
    const entry = sanitizeEntry({ level: 'warn', area: 'app', message: 'boom', detail: { a: 1 } }, NOW)
    const line = formatLogLine(entry)
    expect(line.endsWith('\n')).toBe(true)
    expect(line.indexOf('\n')).toBe(line.length - 1) // exactly one line
    const parsed = parseLogLine(line)
    expect(parsed).toEqual(entry)
    expect(parseLogLine('   ')).toBeNull()
    expect(parseLogLine('not json')).toBeNull()
  })
})

describe('DiagnosticLogger (disk)', () => {
  let root: string
  let logger: DiagnosticLogger

  beforeEach(() => {
    root = mkdtempSync(join(process.cwd(), 'logger-test-'))
    logger = new DiagnosticLogger()
  })

  afterEach(() => {
    logger.dispose()
    rmSync(root, { recursive: true, force: true })
  })

  it('gates debug()/verbose() behind the verbose flag, and persists the flag', async () => {
    logger.configure({ dir: root, now: () => NOW, startTimers: false })
    // OFF by default → debug/verbose are dropped; info still records.
    logger.debug('telemetry', 'tick', { rpm: 6000 })
    logger.verbose('telemetry', 'frame', { pct: 0.5 })
    logger.info('app', 'kept')
    await logger.flush()
    const file = join(root, 'app-20260620-18.log')
    let lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines.length).toBe(1)
    expect(parseLogLine(lines[0])!.message).toBe('kept')

    // Enable → debug/verbose now record, and a flag file is written.
    logger.setVerbose(true)
    expect(logger.isVerbose()).toBe(true)
    expect(existsSync(join(root, 'verbose.flag'))).toBe(true)
    logger.debug('telemetry', 'tick', { rpm: 7000 })
    logger.verbose('serial', 'tx', { frame: 'P...' })
    await logger.flush()
    lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines.length).toBe(3) // kept + the two now-recorded verbose lines

    // A fresh logger restores the persisted flag from disk.
    const restored = new DiagnosticLogger()
    restored.configure({ dir: root, now: () => NOW, startTimers: false })
    expect(restored.isVerbose()).toBe(true)
    restored.dispose()

    // Disable → flag file removed.
    logger.setVerbose(false)
    expect(existsSync(join(root, 'verbose.flag'))).toBe(false)
  })

  it('auto-expires a stale verbose flag on load (forgotten capture self-disables)', () => {
    const enable = new DiagnosticLogger()
    enable.configure({ dir: root, now: () => NOW, startTimers: false })
    enable.setVerbose(true)
    expect(existsSync(join(root, 'verbose.flag'))).toBe(true)
    enable.dispose()

    // A launch 49h later (> VERBOSE_MAX_AGE_MS = 48h) auto-disables AND removes the flag.
    const later = new DiagnosticLogger()
    later.configure({ dir: root, now: () => NOW + 49 * 60 * 60 * 1000, startTimers: false })
    expect(later.isVerbose()).toBe(false)
    expect(existsSync(join(root, 'verbose.flag'))).toBe(false)
    later.dispose()

    // A launch within the window keeps it on.
    const fresh = new DiagnosticLogger()
    fresh.configure({ dir: root, now: () => NOW, startTimers: false })
    fresh.setVerbose(true)
    fresh.dispose()
    const soon = new DiagnosticLogger()
    soon.configure({ dir: root, now: () => NOW + 60 * 60 * 1000, startTimers: false })
    expect(soon.isVerbose()).toBe(true)
    soon.dispose()
  })

  it('buffers writes and flushes redacted JSONL to the current hour file', async () => {
    logger.configure({ dir: root, appVersion: '9.9.9', now: () => NOW, startTimers: false })
    logger.info('app', 'started', { version: '9.9.9' })
    logger.error('serial', 'port failed', { password: 'topsecret', port: 'COM3' })
    await logger.flush()

    const file = join(root, 'app-20260620-18.log')
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    // configure() emits no line itself; both explicit logs are present.
    expect(lines.length).toBe(2)
    const second = parseLogLine(lines[1])!
    expect(second.area).toBe('serial')
    expect((second.detail as Record<string, unknown>).password).toBe('[REDACTED]')
    expect((second.detail as Record<string, unknown>).port).toBe('COM3')
    expect(readFileSync(file, 'utf8')).not.toContain('topsecret')
  })

  it('prune() deletes only OUR files older than 24h and keeps recent + foreign files', async () => {
    logger.configure({ dir: root, now: () => NOW, startTimers: false })
    const recent = logFileName(new Date(NOW - 2 * HOUR))
    const old = logFileName(new Date(NOW - 30 * HOUR))
    writeFileSync(join(root, recent), 'recent\n')
    writeFileSync(join(root, old), 'old\n')
    writeFileSync(join(root, 'iracing-diagnostics.log'), 'foreign\n')

    await logger.prune()

    const remaining = readdirSync(root).sort()
    expect(remaining).toContain(recent)
    expect(remaining).toContain('iracing-diagnostics.log')
    expect(remaining).not.toContain(old)
  })

  it('exportTo concatenates every .log, scrubs secrets, and never throws on a missing dir', async () => {
    logger.configure({ dir: root, appVersion: '9.9.9', now: () => NOW, startTimers: false })
    writeFileSync(join(root, 'app-20260620-17.log'), '{"ts":"t","level":"info","area":"a","message":"hello"}\n')
    writeFileSync(join(root, 'iracing-diagnostics.log'), 'token=leakedsecretvalue should be scrubbed\n')

    const target = join(root, 'export.txt')
    const result = await logger.exportTo(target)
    const out = readFileSync(target, 'utf8')

    expect(result.files).toBe(2)
    expect(out).toContain('hello')
    expect(out).toContain('----- app-20260620-17.log -----')
    expect(out).toContain('[REDACTED]')
    expect(out).not.toContain('leakedsecretvalue')
  })

  it('redacts a JWT / inline secret in the MESSAGE field before it reaches disk (not just detail)', async () => {
    logger.configure({ dir: root, now: () => NOW, startTimers: false })
    const jwt = 'eyJhbGci123.eyJzdWIabc.sigVALUE789'
    logger.error('iracing', `oauth callback ${jwt} failed`, { ok: 1 })
    // The hardened inline rule must redact an OPAQUE (non-JWT) bearer token VALUE,
    // not just the keyword.
    logger.warn('iracing', 'retry with Authorization: Bearer opaqueSECRETtoken9876')
    await logger.flush()

    const content = readFileSync(join(root, 'app-20260620-18.log'), 'utf8')
    expect(content).toContain('[REDACTED]')
    expect(content).not.toContain('sigVALUE789') // JWT scrubbed from the message
    expect(content).not.toContain('opaqueSECRETtoken9876') // opaque bearer value scrubbed
  })

  it('debounces error flushes: a burst schedules ONE flush, not one per error', async () => {
    vi.useFakeTimers()
    const flushSpy = vi.spyOn(logger, 'flush')
    try {
      logger.configure({ dir: root, now: () => NOW, startTimers: false })
      for (let i = 0; i < 10; i += 1) logger.error('app', `boom ${i}`)
      // Errors no longer force an immediate disk write on every call.
      expect(flushSpy).not.toHaveBeenCalled()
      // The single debounced flush fires once and coalesces the whole burst.
      await vi.advanceTimersByTimeAsync(300)
      expect(flushSpy).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
    // Real timers again: await the coalesced flush's I/O, then confirm all ten
    // buffered errors landed (debouncing must not drop lines).
    await logger.flush()
    const lines = readFileSync(join(root, 'app-20260620-18.log'), 'utf8').trim().split('\n')
    expect(lines.length).toBe(10)
  })

  it('never throws when the logs dir is unwritable / unset', async () => {
    const orphan = new DiagnosticLogger()
    expect(() => orphan.info('app', 'no dir yet')).not.toThrow()
    await expect(orphan.flush()).resolves.toBeUndefined()
    expect(() => orphan.flushSync()).not.toThrow()
    await expect(orphan.prune()).resolves.toBeUndefined()
  })
})
