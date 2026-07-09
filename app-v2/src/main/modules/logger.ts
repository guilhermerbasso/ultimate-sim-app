// 24h-rolling diagnostic logger (main process). Brand-new and ADDITIVE — it never
// changes existing behavior. Writes are buffered and flushed off the hot path,
// every write is wrapped so a disk failure can NEVER crash the app, retention is
// enforced ALWAYS (startup + hourly) by deleting whole files older than 24h, and
// secrets are stripped before anything reaches disk (see shared/logger redactor).
//
// Importable from anywhere in main (`import { logger } from './modules/logger'`).
// The iFlag / rev-lights modules may later add their own `logger.debug(...)`
// calls; this module only needs to be importable and safe — it adds NO calls
// inside their files.

import { dialog, shell, type SaveDialogOptions } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { appendFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ModuleContext } from '../module-context'
import {
  LOG_CHANNELS,
  LOG_RETENTION_MS,
  formatLogLine,
  logFileName,
  sanitizeEntry,
  scrubSecretString,
  selectExpiredLogFiles,
  type LogArea,
  type LogEntry,
  type LogExportResult,
  type LogInfo,
  type Logger
} from '../../shared/logger'

const FLUSH_INTERVAL_MS = 2000
const PRUNE_INTERVAL_MS = 60 * 60 * 1000
const MAX_BUFFER_LINES = 5000
// An `error` no longer forces an immediate disk write on every call: a 60Hz
// render-loop error would otherwise fsync 60×/sec. Instead the first error since
// the last flush schedules ONE flush within this window, coalescing a burst into a
// single write while still landing on disk promptly. The fatal path (flushSync)
// is unaffected.
const ERROR_FLUSH_DEBOUNCE_MS = 250

// Existence of this file in the logs dir = verbose capture is ON (persisted toggle).
// Its contents are the enable timestamp (ms) so a forgotten flag auto-expires.
const VERBOSE_FLAG_FILE = 'verbose.flag'
// Verbose auto-expires this long after it was enabled, so a user who turns it on to
// capture a repro and forgets it doesn't write the full-event tap forever. The repro
// workflow (enable → restart → reproduce → export) fits comfortably inside this.
const VERBOSE_MAX_AGE_MS = 48 * 60 * 60 * 1000

export interface LoggerConfig {
  dir: string
  appVersion?: string
  /** Injectable clock for tests. */
  now?: () => number
  /** Background flush/prune timers — default on; tests pass false. */
  startTimers?: boolean
}

// Buffered, crash-proof logger. The buffer is flushed every few seconds (and
// immediately for `error`); pruning runs on configure() and on an hourly timer.
export class DiagnosticLogger implements Logger {
  private dir: string | null = null
  private appVersion = ''
  private buffer: string[] = []
  private started = false
  private flushPromise: Promise<void> | null = null
  private warnedWriteError = false
  private now: () => number = () => Date.now()
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private pruneTimer: ReturnType<typeof setInterval> | null = null
  private errorFlushTimer: ReturnType<typeof setTimeout> | null = null
  // Verbose (full-event) diagnostic capture. OFF by default so normal logs stay clean
  // (info/warn/error only). When ON, `debug()`/`verbose()` are recorded too — the
  // high-rate game-telemetry tap, serial/device events, and the track-map learner
  // trace. Persisted to a flag file so it survives the restart the user does to
  // reproduce an issue. Bounded by the same 24h retention.
  private verboseEnabled = false

  // Idempotent. Safe to call early (pre-`app.ready`, for crash capture) and again
  // from the module register(); only the first call starts timers + prunes.
  configure(config: LoggerConfig): void {
    this.dir = config.dir
    if (config.appVersion) this.appVersion = config.appVersion
    if (config.now) this.now = config.now
    if (this.started) return
    this.started = true
    try {
      mkdirSync(this.dir, { recursive: true })
    } catch {
      // best effort — flush() retries dir creation, and never throws either way
    }
    // Restore the persisted verbose flag (best-effort; never throws). The flag stores
    // its enable timestamp so a stale flag (older than VERBOSE_MAX_AGE_MS) auto-expires
    // rather than capturing the full-event tap indefinitely.
    this.verboseEnabled = this.loadVerboseFlag()
    if (config.startTimers === false) return
    void this.prune()
    this.flushTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS)
    this.pruneTimer = setInterval(() => void this.prune(), PRUNE_INTERVAL_MS)
    this.flushTimer.unref?.()
    this.pruneTimer.unref?.()
    void this.flush()
  }

  // Verbose (full-event) capture toggle. Persisted (with its enable time) so it
  // survives an app restart but auto-expires after VERBOSE_MAX_AGE_MS.
  setVerbose(on: boolean): void {
    this.verboseEnabled = on
    if (!this.dir) return
    const flag = join(this.dir, VERBOSE_FLAG_FILE)
    try {
      if (on) writeFileSync(flag, String(this.now()))
      else rmSync(flag, { force: true })
    } catch {
      // best effort — the in-memory flag still governs this run
    }
  }

  // Read the persisted flag, honouring the auto-expiry. Removes a stale flag so a
  // forgotten verbose capture self-disables on the next launch.
  private loadVerboseFlag(): boolean {
    if (!this.dir) return false
    const flag = join(this.dir, VERBOSE_FLAG_FILE)
    try {
      if (!existsSync(flag)) return false
      const enabledAt = Number.parseInt(readFileSync(flag, 'utf8').trim(), 10)
      // Non-numeric (legacy/garbled) contents → treat as freshly enabled. A numeric
      // timestamp is honoured and expired once older than VERBOSE_MAX_AGE_MS.
      if (Number.isFinite(enabledAt) && this.now() - enabledAt > VERBOSE_MAX_AGE_MS) {
        rmSync(flag, { force: true })
        return false
      }
      return true
    } catch {
      return false
    }
  }

  isVerbose(): boolean {
    return this.verboseEnabled
  }

  debug(area: LogArea, message: string, detail?: unknown): void {
    if (!this.verboseEnabled) return
    this.record('debug', area, message, detail)
  }

  // High-rate full-event capture (game telemetry, serial frames, device events).
  // A no-op unless verbose is enabled, so it costs nothing in normal operation.
  verbose(area: LogArea, message: string, detail?: unknown): void {
    if (!this.verboseEnabled) return
    this.record('debug', area, message, detail)
  }

  info(area: LogArea, message: string, detail?: unknown): void {
    this.record('info', area, message, detail)
  }

  warn(area: LogArea, message: string, detail?: unknown): void {
    this.record('warn', area, message, detail)
  }

  error(area: LogArea, message: string, detail?: unknown): void {
    this.record('error', area, message, detail)
  }

  // Accept (and RE-redact) an entry forwarded by the untrusted renderer.
  write(raw: unknown): void {
    try {
      const input =
        raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : { message: String(raw) }
      const entry = sanitizeEntry(input, this.now())
      this.push(entry)
    } catch {
      // Logging must never throw into the app.
    }
  }

  private record(level: LogEntry['level'], area: string, message: string, detail?: unknown): void {
    try {
      const entry = sanitizeEntry({ level, area, message, detail }, this.now())
      this.push(entry)
    } catch {
      // Logging must never throw into the app.
    }
  }

  private push(entry: LogEntry): void {
    this.buffer.push(formatLogLine(entry))
    if (this.buffer.length > MAX_BUFFER_LINES) {
      // Drop the oldest buffered lines rather than grow without bound.
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER_LINES)
    }
    if (entry.level === 'error') this.scheduleErrorFlush()
  }

  // Debounced "flush soon" for errors: schedule a SINGLE flush within the window
  // instead of writing on every error. A storm of errors (e.g. a render loop)
  // coalesces into one disk write while still flushing promptly. The periodic
  // timer and explicit flush()/flushSync() are unaffected.
  private scheduleErrorFlush(): void {
    if (this.errorFlushTimer) return
    this.errorFlushTimer = setTimeout(() => {
      this.errorFlushTimer = null
      void this.flush()
    }, ERROR_FLUSH_DEBOUNCE_MS)
    this.errorFlushTimer.unref?.()
  }

  // Append buffered lines to the current hour's file. Overlapping calls are
  // serialized so each caller's awaited flush observes its lines on disk. Robust
  // to write failures: retries once after (re)creating the dir, then drops the
  // batch — never throws.
  flush(): Promise<void> {
    const next = this.flushPromise
      ? this.flushPromise.then(() => this.doFlush(), () => this.doFlush())
      : this.doFlush()
    this.flushPromise = next
    return next
  }

  private async doFlush(): Promise<void> {
    if (!this.dir || this.buffer.length === 0) return
    const lines = this.buffer.splice(0, this.buffer.length).join('')
    const file = join(this.dir, logFileName(new Date(this.now())))
    try {
      await appendFile(file, lines, 'utf8')
    } catch (error) {
      try {
        await mkdir(this.dir, { recursive: true })
        await appendFile(file, lines, 'utf8')
      } catch (retryError) {
        this.warnOnce(retryError)
      }
    }
  }

  // Synchronous best-effort flush for the crash path (uncaughtException), where
  // the process is about to exit and async I/O would not complete.
  flushSync(): void {
    if (!this.dir || this.buffer.length === 0) return
    const lines = this.buffer.splice(0, this.buffer.length).join('')
    const file = join(this.dir, logFileName(new Date(this.now())))
    try {
      mkdirSync(this.dir, { recursive: true })
      appendFileSync(file, lines, 'utf8')
    } catch (error) {
      this.warnOnce(error)
    }
  }

  // ALWAYS delete everything older than 24h. Bounded to OUR own files inside the
  // logs dir (foreign files such as iracing-diagnostics.log are never touched).
  async prune(): Promise<void> {
    if (!this.dir) return
    try {
      const names = await readdir(this.dir)
      for (const name of selectExpiredLogFiles(names, this.now())) {
        await unlink(join(this.dir, name)).catch(() => {})
      }
    } catch {
      // dir missing / unreadable — nothing to prune
    }
  }

  logsDir(): string | null {
    return this.dir
  }

  // Concatenate every `.log` in the dir into one text file. Each line is scrubbed
  // again so even foreign logs cannot leak an obvious secret into the export.
  async exportTo(targetPath: string): Promise<{ files: number; bytes: number }> {
    await this.flush()
    let names: string[] = []
    if (this.dir) {
      try {
        names = await readdir(this.dir)
      } catch {
        names = []
      }
    }
    const logs = names.filter((name) => name.toLowerCase().endsWith('.log')).sort()
    const parts: string[] = [
      'Ultimate Sim App — diagnostic logs export\n',
      `Generated: ${new Date(this.now()).toISOString()}\n`,
      `App version: ${this.appVersion || 'unknown'}\n`,
      'Retention: 24h (logs older than 24h are auto-deleted)\n',
      `Files: ${logs.length}\n`,
      `${'='.repeat(60)}\n`
    ]
    for (const name of logs) {
      const dir = this.dir
      if (!dir) break
      let content = ''
      try {
        content = await readFile(join(dir, name), 'utf8')
      } catch {
        continue
      }
      const safe = content.split('\n').map(scrubSecretString).join('\n')
      parts.push(`\n----- ${name} -----\n`, safe)
    }
    const out = parts.join('')
    await writeFile(targetPath, out, 'utf8')
    return { files: logs.length, bytes: Buffer.byteLength(out, 'utf8') }
  }

  // Stop timers and do a final synchronous flush (for app teardown / tests).
  dispose(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer)
      this.pruneTimer = null
    }
    if (this.errorFlushTimer) {
      clearTimeout(this.errorFlushTimer)
      this.errorFlushTimer = null
    }
    this.flushSync()
  }

  private warnOnce(error: unknown): void {
    if (this.warnedWriteError) return
    this.warnedWriteError = true
    try {
      console.warn(
        '[logger] Failed to write diagnostic log (further warnings suppressed):',
        error instanceof Error ? error.message : error
      )
    } catch {
      // ignore — even the warning must not throw
    }
  }
}

// App-wide singleton. Configured early in src/main/index.ts (so pre-ready crashes
// are captured) and again here (idempotent) once userData is known.
export const logger = new DiagnosticLogger()

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

export function register(ctx: ModuleContext): void {
  const dir = join(ctx.app.getPath('userData'), 'logs')
  logger.configure({ dir, appVersion: ctx.app.getVersion() })
  logger.info('app', 'logger ready', {
    version: ctx.app.getVersion(),
    retentionHours: LOG_RETENTION_MS / (60 * 60 * 1000)
  })

  // Renderer → main forwarding. Re-redacted on arrival; fire-and-forget.
  ctx.ipcMain.handle(LOG_CHANNELS.write, (_event, raw: unknown): void => {
    logger.write(raw)
  })

  ctx.ipcMain.handle(
    LOG_CHANNELS.info,
    (): LogInfo => ({ dir, retentionMs: LOG_RETENTION_MS, appVersion: ctx.app.getVersion() })
  )

  ctx.ipcMain.handle(LOG_CHANNELS.getVerbose, (): boolean => logger.isVerbose())

  ctx.ipcMain.handle(LOG_CHANNELS.setVerbose, (_event, on: unknown): boolean => {
    const enabled = on === true
    logger.setVerbose(enabled)
    logger.info('logs', `verbose diagnostic capture ${enabled ? 'enabled' : 'disabled'}`)
    return enabled
  })

  ctx.ipcMain.handle(LOG_CHANNELS.openFolder, async (): Promise<string> => {
    try {
      await mkdir(dir, { recursive: true })
      logger.info('logs', 'open logs folder')
      return await shell.openPath(dir)
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  })

  ctx.ipcMain.handle(LOG_CHANNELS.export, async (): Promise<LogExportResult> => {
    const opts: SaveDialogOptions = {
      title: 'Export diagnostic logs',
      defaultPath: `ultimate-sim-app-logs-${dateStamp()}.txt`,
      filters: [{ name: 'Logs (texto)', extensions: ['txt', 'log'] }]
    }
    const win = ctx.getMainWindow()
    const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (result.canceled || !result.filePath) return { canceled: true }
    const { files, bytes } = await logger.exportTo(result.filePath)
    logger.info('logs', 'logs exported', { files, bytes, path: result.filePath })
    return { canceled: false, filePath: result.filePath, files, bytes }
  })
}
