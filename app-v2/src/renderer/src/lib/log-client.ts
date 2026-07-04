// Renderer-side diagnostic logging. Forwards uncaught renderer errors (and
// optional manual logs) to the main process over the generic `window.ipc`
// bridge, where they are RE-redacted and written to the 24h rolling log. This is
// additive and self-installing: importing the module once (from main.tsx) wires
// the global hooks for the whole app session.

import { LOG_CHANNELS, type LogArea, type LogLevel } from '../../../shared/logger'

// Coalesce identical log keys and cap the overall event rate so a render-loop
// error (e.g. fired at 60Hz) can't flood the main process with IPC calls — each
// of which also schedules a disk flush. Identical messages within DEDUP_WINDOW_MS
// collapse to one; a global MAX_EVENTS_PER_SEC backstop bounds even distinct
// floods. Diagnostics must never disrupt the UI, so over-budget events are simply
// dropped (the 24h log is best-effort, not an audit trail).
const DEDUP_WINDOW_MS = 1000
const MAX_EVENTS_PER_SEC = 20

export class LogThrottle {
  private lastByKey = new Map<string, number>()
  private windowStart = 0
  private windowCount = 0

  constructor(
    private readonly dedupWindowMs: number = DEDUP_WINDOW_MS,
    private readonly maxPerSec: number = MAX_EVENTS_PER_SEC
  ) {}

  // True when this event should be forwarded; false when coalesced/rate-capped.
  shouldSend(key: string, nowMs: number): boolean {
    const last = this.lastByKey.get(key)
    if (last !== undefined && nowMs - last < this.dedupWindowMs) return false

    if (nowMs - this.windowStart >= 1000) {
      this.windowStart = nowMs
      this.windowCount = 0
    }
    if (this.windowCount >= this.maxPerSec) return false

    this.windowCount += 1
    this.lastByKey.set(key, nowMs)
    if (this.lastByKey.size > 256) this.prune(nowMs)
    return true
  }

  private prune(nowMs: number): void {
    for (const [key, at] of this.lastByKey) {
      if (nowMs - at >= this.dedupWindowMs) this.lastByKey.delete(key)
    }
  }
}

const throttle = new LogThrottle()

function send(level: LogLevel, area: LogArea, message: string, detail?: unknown): void {
  try {
    // Drop coalesced / over-budget events before touching IPC. Keyed on
    // level+area+message so an identical repeating error is suppressed while
    // distinct messages still flow (up to the per-second cap).
    if (!throttle.shouldSend(`${level}:${area}:${message}`, Date.now())) return
    // Fire-and-forget; logging must never disrupt the UI.
    void window.ipc?.invoke(LOG_CHANNELS.write, { level, area, message, detail })?.catch(() => {})
  } catch {
    // window.ipc unavailable (e.g. outside Electron) — ignore.
  }
}

export const logClient = {
  debug: (area: LogArea, message: string, detail?: unknown): void => send('debug', area, message, detail),
  info: (area: LogArea, message: string, detail?: unknown): void => send('info', area, message, detail),
  warn: (area: LogArea, message: string, detail?: unknown): void => send('warn', area, message, detail),
  error: (area: LogArea, message: string, detail?: unknown): void => send('error', area, message, detail)
}

let installed = false

export function installRendererLogHook(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', (event: ErrorEvent) => {
    const err = event.error as Error | undefined
    send('error', 'renderer', event.message || 'window.onerror', {
      source: event.filename,
      line: event.lineno,
      col: event.colno,
      stack: err?.stack
    })
  })

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason as { message?: string; stack?: string } | undefined
    send('error', 'renderer', 'unhandledrejection', {
      reason: reason?.message ?? String(event.reason),
      stack: reason?.stack
    })
  })

  send('info', 'renderer', 'renderer log hook installed')

  installConsoleCapture()
}

// Mirror the renderer console into the diagnostic log. console.error/console.warn
// are ALWAYS captured (low-rate, high-value); console.log/console.info/console.debug
// are captured only when verbose diagnostic capture is ON (fetched once — the verbose
// repro workflow is enable → restart → reproduce, so a fresh session reads the flag).
// All forwarding goes through the throttled `send`, so a logging loop can't flood.
function installConsoleCapture(): void {
  if (typeof console === 'undefined') return
  let captureVerbose = false
  try {
    void window.ipc?.invoke<boolean>(LOG_CHANNELS.getVerbose)?.then((on) => {
      captureVerbose = on === true
    })?.catch(() => {})
  } catch {
    // ignore
  }
  const wrap = (method: 'log' | 'info' | 'warn' | 'error' | 'debug', level: LogLevel, always: boolean): void => {
    const original = console[method]?.bind(console)
    if (typeof original !== 'function') return
    console[method] = (...args: unknown[]): void => {
      try {
        if (always || captureVerbose) {
          const [first, ...rest] = args
          send(level, 'renderer-console', typeof first === 'string' ? first : safeText(first), rest.length ? { args: rest.map(safeText) } : undefined)
        }
      } catch {
        // never break console
      }
      original(...args)
    }
  }
  wrap('error', 'error', true)
  wrap('warn', 'warn', true)
  wrap('log', 'info', false)
  wrap('info', 'info', false)
  wrap('debug', 'debug', false)
}

function safeText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return `${value.name}: ${value.message}`
  try {
    const s = JSON.stringify(value)
    return s && s.length > 300 ? `${s.slice(0, 300)}…` : s ?? String(value)
  } catch {
    return String(value)
  }
}

// Self-install on first import.
installRendererLogHook()
