// Comprehensive VERBOSE diagnostic taps. ADDITIVE + crash-proof: every line here is
// a no-op unless the user turns on verbose capture (logger.isVerbose()), so normal
// operation is untouched. When verbose is ON we record, for "log absolutely
// everything" debugging:
//   • every telemetry SNAPSHOT the app receives (throttled to ~2 Hz) PLUS an
//     immediate line on any discrete change (connect/source/flag/session/pit/lap…),
//   • every IPC call handled by a module (channel + redacted args) — throttled
//     per-channel so a 60 Hz channel can't dominate,
//   • every main→renderer broadcast (channel).
//
// Volume is bounded three ways: verbose is opt-in, auto-expires after 48 h, and the
// underlying logger keeps only 24 h of files. None of this ever throws into the app.

import type { IpcMain } from 'electron'
import type { ModuleContext } from '../module-context'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import { logger } from './logger'

// Per-key min interval so a high-rate channel/event collapses to a steady trickle
// in the verbose log instead of thousands of identical lines per second.
class IntervalThrottle {
  private last = new Map<string, number>()
  constructor(private readonly minIntervalMs: number) {}
  allow(key: string, nowMs: number): boolean {
    const prev = this.last.get(key)
    if (prev !== undefined && nowMs - prev < this.minIntervalMs) return false
    this.last.set(key, nowMs)
    if (this.last.size > 512) {
      for (const [k, at] of this.last) if (nowMs - at >= this.minIntervalMs) this.last.delete(k)
    }
    return true
  }
}

// Compact, JSON-safe preview of IPC args so a huge payload (e.g. a full dashboard or
// an 8×8 frame grid) never bloats one log line. Strings/arrays are truncated.
function previewArg(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  const t = typeof value
  if (t === 'number' || t === 'boolean') return value
  if (t === 'string') return (value as string).length > 120 ? `${(value as string).slice(0, 120)}…` : value
  if (Array.isArray(value)) {
    if (depth >= 1) return `[array(${value.length})]`
    return value.length > 8 ? value.slice(0, 8).map((v) => previewArg(v, depth + 1)).concat(`…+${value.length - 8}`) : value.map((v) => previewArg(v, depth + 1))
  }
  if (t === 'object') {
    if (depth >= 2) return '[object]'
    const out: Record<string, unknown> = {}
    let n = 0
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (n++ >= 24) {
        out['…'] = 'truncated'
        break
      }
      out[k] = previewArg(v, depth + 1)
    }
    return out
  }
  return `[${t}]`
}

// Wrap electron's ipcMain so EVERY `handle(channel, fn)` registered through it logs
// the call (verbose only). Other ipcMain methods (`on`, `emit`, `removeHandler`, …)
// pass straight through. The user passes the returned object as ctx.ipcMain.
export function instrumentIpcMain(ipcMain: IpcMain): IpcMain {
  const throttle = new IntervalThrottle(200)
  const wrappedHandle: IpcMain['handle'] = (channel, listener) => {
    const wrapped: typeof listener = (event, ...args) => {
      if (logger.isVerbose()) {
        try {
          if (throttle.allow(`ipc:${channel}`, Date.now())) {
            logger.verbose('ipc', `→ ${String(channel)}`, args.length ? { args: args.map((a) => previewArg(a)) } : undefined)
          }
        } catch {
          // logging must never disrupt the real handler
        }
      }
      return (listener as (...a: unknown[]) => unknown)(event, ...args)
    }
    return ipcMain.handle(channel, wrapped)
  }
  return new Proxy(ipcMain, {
    get(target, prop, receiver) {
      if (prop === 'handle') return wrappedHandle
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    }
  }) as IpcMain
}

// Wrap the main→renderer broadcast fn so every broadcast channel is logged (verbose
// only, throttled per channel). Returns a drop-in replacement.
export function instrumentBroadcast(broadcast: (channel: string, payload: unknown) => void): (channel: string, payload: unknown) => void {
  const throttle = new IntervalThrottle(200)
  return (channel: string, payload: unknown): void => {
    if (logger.isVerbose()) {
      try {
        if (throttle.allow(`bcast:${channel}`, Date.now())) logger.verbose('ipc', `⇒ ${channel}`)
      } catch {
        // ignore
      }
    }
    broadcast(channel, payload)
  }
}

// ─── Telemetry tap ─────────────────────────────────────────────────────────────
// Comprehensive, JSON-safe scalar view of a snapshot for the periodic dump. Arrays
// are reduced to counts so one line stays small even with a full grid of cars.
function summarizeSnapshot(s: TelemetrySnapshot): Record<string, unknown> {
  const r = s as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(r)) {
    const t = typeof v
    if (v === null || t === 'number' || t === 'boolean' || t === 'string') out[k] = v
    else if (Array.isArray(v)) out[k] = `array(${v.length})`
    else if (t === 'object') out[k] = previewArg(v) // flags / relatives / pit etc. (shallow preview)
  }
  return out
}

// Fields whose CHANGE is logged immediately (regardless of the periodic throttle),
// so the debug log always shows exactly when telemetry transitions happen. These
// MUST be real scalar keys on TelemetrySnapshot (connect/disconnect is handled
// separately below). `sessionFlagsRaw` is the numeric flag bitmask (flag changes),
// `sessionType` the session phase, `onPitRoad` pit transitions, `currentLap`/`gear`
// lap and shift changes. (`flags` is intentionally excluded — it's a rebuilt object
// whose identity changes every frame, which would defeat the immediate-on-change
// design and flood the log.)
const DISCRETE_KEYS = ['onPitRoad', 'sessionType', 'currentLap', 'gear', 'sessionFlagsRaw'] as const

export function register(ctx: ModuleContext): void {
  const periodic = new IntervalThrottle(500) // ~2 Hz steady telemetry dump when verbose
  let prevConnected: boolean | undefined
  const prevDiscrete: Record<string, unknown> = {}

  ctx.telemetryHub.on('snapshot', (snapshot: TelemetrySnapshot | null) => {
    if (!logger.isVerbose()) return
    try {
      const now = Date.now()
      if (!snapshot) {
        if (prevConnected !== false) {
          prevConnected = false
          logger.verbose('telemetry-rx', 'snapshot: null (no telemetry)')
        }
        return
      }
      const rec = snapshot as unknown as Record<string, unknown>
      // Immediate connect/disconnect + discrete-field transitions.
      if (snapshot.connected !== prevConnected) {
        prevConnected = snapshot.connected
        logger.verbose('telemetry-rx', `connection ${snapshot.connected ? 'up' : 'down'}`, { sim: snapshot.sim })
      }
      for (const key of DISCRETE_KEYS) {
        if (!(key in rec)) continue
        const cur = rec[key]
        if (cur !== prevDiscrete[key]) {
          prevDiscrete[key] = cur
          logger.verbose('telemetry-rx', `change ${key}`, { [key]: previewArg(cur) })
        }
      }
      // Periodic full(ish) snapshot dump, throttled.
      if (periodic.allow('snap', now)) logger.verbose('telemetry-rx', 'snapshot', summarizeSnapshot(snapshot))
    } catch {
      // never disrupt telemetry dispatch
    }
  })

  logger.verbose('telemetry-rx', 'telemetry verbose tap installed')
}
