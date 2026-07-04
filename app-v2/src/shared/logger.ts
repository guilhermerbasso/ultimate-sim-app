// Shared, dependency-free primitives for the 24h-rolling diagnostic LOG module.
// Importable by main, preload, renderer and tests with NO electron/node imports
// (mirrors the contract of shared/config-io.ts).
//
// DESIGN
//   • Log lines are JSONL: one redacted `LogEntry` per line.
//   • Files roll HOURLY as `app-YYYYMMDD-HH.log` (UTC) so retention is a cheap
//     whole-file prune: any file whose hour is older than 24h is deleted.
//   • The redactor below NEVER lets a secret reach disk — keys that look like
//     tokens/cookies/passwords/credentials are replaced with `[REDACTED]` and
//     binary payloads (`.bin`/Buffers/ArrayBuffers) become `[binary]`.

// ─── Levels / areas ─────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error']

// Free-form, but these are the conventional areas used across the app so logs
// stay greppable (e.g. logger.warn('serial', …)).
export type LogArea = 'app' | 'main' | 'renderer' | 'serial' | 'telemetry' | 'iracing' | 'logs' | (string & {})

export interface LogEntry {
  /** ISO-8601 UTC timestamp. */
  ts: string
  level: LogLevel
  area: string
  message: string
  /** Optional structured context — ALWAYS redacted before it reaches this shape. */
  detail?: unknown
}

/** The minimal surface every caller (main + renderer client) shares. */
export interface Logger {
  debug(area: LogArea, message: string, detail?: unknown): void
  info(area: LogArea, message: string, detail?: unknown): void
  warn(area: LogArea, message: string, detail?: unknown): void
  error(area: LogArea, message: string, detail?: unknown): void
}

// ─── IPC channels ───────────────────────────────────────────────────────────────
// Single `logs:` prefix so the preload allowlist needs exactly one entry.

export const LOG_CHANNELS = {
  /** Renderer → Main: forward a single log entry (re-redacted on arrival). */
  write: 'logs:write',
  /** Renderer → Main: concatenate the logs dir and save it via a dialog. */
  export: 'logs:export',
  /** Renderer → Main: shell.openPath() the logs directory. */
  openFolder: 'logs:openFolder',
  /** Renderer → Main: fetch logs dir + retention metadata for the UI. */
  info: 'logs:info',
  /** Renderer → Main: enable/disable verbose (full-event) diagnostic logging. */
  setVerbose: 'logs:setVerbose',
  /** Renderer → Main: read the current verbose flag. */
  getVerbose: 'logs:getVerbose'
} as const

export type LogChannel = (typeof LOG_CHANNELS)[keyof typeof LOG_CHANNELS]

export interface LogExportResult {
  canceled: boolean
  filePath?: string
  files?: number
  bytes?: number
}

export interface LogInfo {
  dir: string | null
  retentionMs: number
  appVersion?: string
}

// ─── Retention + hourly file scheme ─────────────────────────────────────────────

export const LOG_RETENTION_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

export const LOG_FILE_PREFIX = 'app-'
export const LOG_FILE_EXT = '.log'

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

/** `app-YYYYMMDD-HH.log` for the UTC hour containing `date`. */
export function logFileName(date: Date): string {
  const y = date.getUTCFullYear()
  const m = pad2(date.getUTCMonth() + 1)
  const d = pad2(date.getUTCDate())
  const h = pad2(date.getUTCHours())
  return `${LOG_FILE_PREFIX}${y}${m}${d}-${h}${LOG_FILE_EXT}`
}

const APP_LOG_RE = /^app-(\d{4})(\d{2})(\d{2})-(\d{2})\.log$/

/** True only for files this module owns (never foreign `.log` files). */
export function isAppLogFileName(name: string): boolean {
  return APP_LOG_RE.test(name)
}

/** UTC ms at the start of the hour a log file covers, or null if not ours. */
export function appLogFileStartMs(name: string): number | null {
  const match = APP_LOG_RE.exec(name)
  if (!match) return null
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), 0, 0, 0)
  return Number.isNaN(ms) ? null : ms
}

// Returns the subset of `names` that are OUR log files whose entire hour window
// is older than the retention horizon. A file present after pruning always has
// its newest possible entry within 24h, so nothing older than 24h survives.
// Foreign files (e.g. iracing-diagnostics.log) are ignored — never deleted.
export function selectExpiredLogFiles(
  names: readonly string[],
  nowMs: number,
  retentionMs: number = LOG_RETENTION_MS
): string[] {
  const cutoff = nowMs - retentionMs
  const expired: string[] = []
  for (const name of names) {
    const start = appLogFileStartMs(name)
    if (start !== null && start + HOUR_MS <= cutoff) expired.push(name)
  }
  return expired
}

// ─── Secret redaction ───────────────────────────────────────────────────────────

const REDACTED = '[REDACTED]'
const MAX_DEPTH = 6
const MAX_ARRAY = 200
const MAX_KEYS = 200
const MAX_STRING = 4000

// Keys whose VALUES must never be written. Conservative by design.
const SECRET_KEY_RE =
  /(authorization|bearer|password|passwd|pwd|secret|token|cookie|credential|oauth|session|api[_-]?key|access[_-]?key|client[_-]?secret|private[_-]?key|auth)/i

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key)
}

// JWT-shaped blobs and `keyword <value>` inline secrets, scrubbed from free text.
const JWT_RE = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+/g
// Matches `keyword[:=] <value>` where an optional auth SCHEME (Bearer/Basic/Token)
// may sit between the field name and the opaque value. The scheme group is what
// makes `Authorization: Bearer <opaque-non-JWT>` redact the VALUE — without it the
// `{6,}` value class greedily consumed the word "Bearer" and stopped, leaving the
// real token in cleartext on disk.
const INLINE_SECRET_RE = /\b(bearer|authorization|token|password|passwd|pwd|secret|api[_-]?key)\b\s*[:=]?\s*(?:(?:bearer|basic|token)\s+)?["']?[A-Za-z0-9._\-+/=]{6,}["']?/gi

/** Scrub obvious secrets out of an arbitrary string (used on every exported line). */
export function scrubSecretString(input: string): string {
  return input.replace(JWT_RE, REDACTED).replace(INLINE_SECRET_RE, (match) => {
    const keyword = /^[A-Za-z_-]+/.exec(match)?.[0] ?? ''
    return `${keyword} ${REDACTED}`
  })
}

function isBinary(value: unknown): boolean {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value)
}

// Returns a JSON-safe, secret-free clone of `value`. Bounded in depth/breadth so
// a huge or circular object can never blow up or stall the logger.
export function redact(value: unknown): unknown {
  return redactInner(value, 0, new WeakSet<object>())
}

function redactInner(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null) return null
  const type = typeof value
  if (type === 'string') {
    const scrubbed = scrubSecretString(value as string)
    return scrubbed.length > MAX_STRING ? `${scrubbed.slice(0, MAX_STRING)}…` : scrubbed
  }
  if (type === 'number' || type === 'boolean' || type === 'undefined') return value
  if (type === 'bigint') return `${(value as bigint).toString()}n`
  if (type === 'function') return '[function]'
  if (type === 'symbol') return (value as symbol).toString()

  if (isBinary(value)) return '[binary]'
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '[invalid-date]' : value.toISOString()
  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubSecretString(value.message),
      stack: value.stack ? scrubSecretString(value.stack).slice(0, MAX_STRING) : undefined
    }
  }

  if (type === 'object') {
    const obj = value as object
    if (seen.has(obj)) return '[circular]'
    if (depth >= MAX_DEPTH) return '[depth-limit]'
    seen.add(obj)
    try {
      if (Array.isArray(value)) {
        const out = value.slice(0, MAX_ARRAY).map((item) => redactInner(item, depth + 1, seen))
        if (value.length > MAX_ARRAY) out.push(`…(+${value.length - MAX_ARRAY} more)`)
        return out
      }
      const record = value as Record<string, unknown>
      const keys = Object.keys(record)
      const out: Record<string, unknown> = {}
      let count = 0
      for (const key of keys) {
        if (count++ >= MAX_KEYS) {
          out['…'] = `(+${keys.length - MAX_KEYS} more)`
          break
        }
        if (isSecretKey(key) || key.toLowerCase().endsWith('.bin')) {
          out[key] = REDACTED
          continue
        }
        out[key] = redactInner(record[key], depth + 1, seen)
      }
      return out
    } finally {
      seen.delete(obj)
    }
  }
  return REDACTED
}

// ─── Entry building / line (de)serialization ────────────────────────────────────

export interface RawLogInput {
  level?: unknown
  area?: unknown
  message?: unknown
  detail?: unknown
}

// Coerces untrusted input (including renderer-forwarded entries) into a safe,
// redacted LogEntry stamped with the supplied time.
export function sanitizeEntry(raw: RawLogInput, nowMs: number): LogEntry {
  const level: LogLevel = (LOG_LEVELS as readonly string[]).includes(raw.level as string)
    ? (raw.level as LogLevel)
    : 'info'
  const area =
    typeof raw.area === 'string' && raw.area.trim().length > 0
      ? scrubSecretString(raw.area.trim().slice(0, 64))
      : 'app'
  const message = scrubSecretString(
    typeof raw.message === 'string' ? raw.message.slice(0, 8000) : String(raw.message ?? '').slice(0, 8000)
  )
  const entry: LogEntry = { ts: new Date(nowMs).toISOString(), level, area, message }
  if (raw.detail !== undefined) entry.detail = redact(raw.detail)
  return entry
}

/** One JSONL line (with trailing newline) for an already-sanitized entry. */
export function formatLogLine(entry: LogEntry): string {
  try {
    return `${JSON.stringify(entry)}\n`
  } catch {
    return `${JSON.stringify({ ts: entry.ts, level: entry.level, area: entry.area, message: entry.message })}\n`
  }
}

export function parseLogLine(line: string): LogEntry | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>
    if (
      typeof obj.ts === 'string' &&
      typeof obj.level === 'string' &&
      typeof obj.area === 'string' &&
      typeof obj.message === 'string'
    ) {
      return obj as unknown as LogEntry
    }
  } catch {
    // not a structured line
  }
  return null
}
