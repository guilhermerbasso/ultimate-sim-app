import type { PortInfo } from '../../shared/ipc'
import {
  resolveGenericDevicePort,
  type GenericDeviceIdentity
} from '../../shared/generic-autostart'

// Robust boot auto-connect for GENERIC serial devices (the iFlag RGB matrix and
// any other user-added Arduino flagged `autoConnect`). It is the generic-device
// sibling of SimxAutostartController: same shape (start/dispose, background
// retry, reconnect-on-drop, user-disconnect suppression, live settings gate) but
// it manages a FLEET of devices instead of the single SIM-X primary, and it talks
// to the multi-device SerialHub rather than the SerialManager facade.
//
// Why this exists: the fleet module only does a ONE-SHOT connect on boot, so an
// iFlag that isn't enumerated yet ("Opening COM15: File not found") was missed
// and only picked up minutes later. This controller keeps retrying until each
// autoConnect device appears, and reconnects it if it drops.

// A stored generic device the controller should keep connected. Mirrors the
// persisted GenericSerialDeviceConfig (only the fields we read).
export interface GenericAutostartDeviceConfig extends GenericDeviceIdentity {
  id?: string
  label: string
  baud: number
  autoConnect: boolean
}

// One currently-open device as reported by the hub.
export interface GenericAutostartConnectedDevice {
  id: string
  path: string
  kind?: string
}

// Summary carried by the hub's 'device-added' / 'device-removed' events.
export interface GenericAutostartDeviceSummary {
  id: string
  path: string
  kind?: string
}

export type GenericAutostartSerialEvent = 'device-added' | 'device-removed' | 'user-disconnect'

// Minimal serial surface the coordinator needs — kept structural so tests can
// pass a fake without the whole SerialHub.
export interface GenericAutostartSerial {
  listPorts(): Promise<PortInfo[]>
  // Devices currently open on the hub (so we never re-open one the fleet one-shot
  // or a manual connect already brought up).
  listConnected(): GenericAutostartConnectedDevice[]
  connectDevice(opts: { path: string; id?: string; label: string; baud: number }): Promise<unknown>
  on(event: GenericAutostartSerialEvent, handler: (...args: unknown[]) => void): void
  off(event: GenericAutostartSerialEvent, handler: (...args: unknown[]) => void): void
}

export interface GenericAutostartLogger {
  info(area: string, message: string, detail?: unknown): void
  verbose(area: string, message: string, detail?: unknown): void
}

export interface GenericAutostartDeps {
  serial: GenericAutostartSerial
  // Reads the live AppSettings flag (shared store, so toggles are seen at once).
  isEnabled: () => boolean
  // Live list of stored generic devices (re-read each attempt so add / remove /
  // toggle-off is honoured immediately). May be sync or async (the store load).
  loadDevices: () => GenericAutostartDeviceConfig[] | Promise<GenericAutostartDeviceConfig[]>
  // Persist a device's freshly-resolved COM path so the next boot finds it
  // directly. Best-effort; only called when the path actually changed.
  saveDevicePath?: (config: GenericAutostartDeviceConfig, path: string) => void
  retryMs?: number
  maxRetryMs?: number
  logger?: GenericAutostartLogger
}

const DEFAULT_RETRY_MS = 3000
const DEFAULT_MAX_RETRY_MS = 60_000
const STABLE_CONNECTION_MS = 10_000

// Stable per-device key used to track connect/suppression state across the
// async lifecycle. Prefer the hub id; fall back to the COM path.
function deviceKey(config: { id?: string; path: string }): string {
  return config.id ?? `path:${config.path}`
}

export class GenericAutostartController {
  private disposed = false
  private attempting = false
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryDueAt = 0
  private readonly retryMs: number
  private readonly maxRetryMs: number
  // Devices the user deliberately disconnected (hub 'user-disconnect'); their
  // auto-reconnect is suppressed until they reconnect or settings toggle.
  private readonly suppressed = new Set<string>()
  // Tracks the last-seen enabled state so onSettingsChanged can detect an OFF→ON
  // re-enable (an explicit opt back in) and clear user-disconnect suppressions.
  private wasEnabled = false
  // Last-loaded configs, refreshed at the top of every attempt(), so the
  // synchronous hub event handlers can correlate a summary back to a config.
  private knownConfigs: GenericAutostartDeviceConfig[] = []
  private readonly retryCounts = new Map<string, number>()
  private readonly nextAttemptAt = new Map<string, number>()
  private readonly connectedAt = new Map<string, number>()

  private readonly onDeviceAdded = (summary: unknown): void => this.handleDeviceAdded(summary)
  private readonly onDeviceRemoved = (summary: unknown): void => this.handleDeviceRemoved(summary)
  private readonly onUserDisconnect = (summary: unknown): void => this.handleUserDisconnect(summary)

  constructor(private readonly deps: GenericAutostartDeps) {
    this.retryMs = deps.retryMs ?? DEFAULT_RETRY_MS
    this.maxRetryMs = Math.max(this.retryMs, deps.maxRetryMs ?? DEFAULT_MAX_RETRY_MS)
  }

  // Subscribe to hub add/remove (covers BOTH auto and manual connects) and, when
  // the feature is enabled, begin the connect loop.
  start(): void {
    if (this.disposed) return
    this.wasEnabled = this.deps.isEnabled()
    this.deps.serial.on('device-added', this.onDeviceAdded)
    this.deps.serial.on('device-removed', this.onDeviceRemoved)
    this.deps.serial.on('user-disconnect', this.onUserDisconnect)
    if (this.deps.isEnabled()) void this.attempt()
  }

  // Called when AppSettings change. Toggling ON (re)starts the loop; toggling OFF
  // stops the background retry but never disconnects an active session.
  onSettingsChanged(): void {
    if (this.disposed) return
    const enabled = this.deps.isEnabled()
    // OFF→ON is an explicit opt back in: forget user-disconnect suppressions so
    // previously stood-down devices (e.g. one disconnected to flash firmware) are
    // auto-connected again. Unrelated settings changes (enabled unchanged) keep the
    // latches intact.
    if (enabled && !this.wasEnabled) this.suppressed.clear()
    this.wasEnabled = enabled
    if (enabled) void this.attempt()
    else this.clearRetry()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearRetry()
    this.deps.serial.off('device-added', this.onDeviceAdded)
    this.deps.serial.off('device-removed', this.onDeviceRemoved)
    this.deps.serial.off('user-disconnect', this.onUserDisconnect)
  }

  // Test/diagnostic accessors.
  hasPendingRetry(): boolean {
    return this.retryTimer !== null
  }

  isSuppressed(key: string): boolean {
    return this.suppressed.has(key)
  }

  // Try to connect every autoConnect device that isn't already open. Best-effort:
  // it never throws. A single in-flight pass at a time (mirrors the SIM-X
  // `connecting` guard); follow-ups arrive via scheduleRetry, never an immediate
  // re-run, so a device that enumerates but fails to open can't tight-loop.
  private async attempt(): Promise<void> {
    if (this.disposed || this.attempting || !this.deps.isEnabled()) return
    this.attempting = true
    try {
      await this.runAttempt()
    } finally {
      this.attempting = false
    }
  }

  private async runAttempt(): Promise<void> {
    const configs = (await this.deps.loadDevices()).filter((c) => c.autoConnect)
    this.knownConfigs = configs
    // State can change while loadDevices() awaits (disposed/disabled on quit).
    if (this.disposed || !this.deps.isEnabled()) return
    if (configs.length === 0) {
      this.clearRetry()
      return
    }

    let ports: PortInfo[]
    try {
      ports = await this.deps.serial.listPorts()
    } catch (error) {
      this.deps.logger?.verbose('serial', 'generic auto-start: listing ports failed', {
        message: error instanceof Error ? error.message : String(error)
      })
      this.scheduleRetry()
      return
    }
    if (this.disposed || !this.deps.isEnabled()) return

    let anyPending = false
    let retryDelayMs = this.retryMs
    for (const config of configs) {
      const key = deviceKey(config)
      // Respect a deliberate user disconnect — don't fight the user.
      if (this.suppressed.has(key)) continue
      if (this.isOpen(config)) continue
      const remainingBackoff = this.remainingBackoffMs(config)
      if (remainingBackoff > 0) {
        anyPending = true
        retryDelayMs = Math.min(retryDelayMs, remainingBackoff)
        this.scheduleRetry(remainingBackoff)
        continue
      }

      const path = resolveGenericDevicePort(config, ports)
      if (!path) {
        this.deps.logger?.verbose('serial', 'generic auto-start: no candidate port yet', {
          id: config.id,
          label: config.label,
          path: config.path
        })
        anyPending = true
        retryDelayMs = this.retryMs
        continue
      }

      this.deps.logger?.info('serial', 'auto-start: connecting', {
        id: config.id,
        path,
        kind: 'generic',
        label: config.label
      })
      try {
        await this.deps.serial.connectDevice({
          path,
          id: config.id,
          label: config.label,
          baud: config.baud
        })
        // Success is finalized by the 'device-added' event (log + persist path).
      } catch (error) {
        const delayMs = this.ensureBackoff(config)
        this.deps.logger?.verbose('serial', 'generic auto-start: connect attempt failed', {
          id: config.id,
          path,
          label: config.label,
          retryInMs: delayMs,
          message: error instanceof Error ? error.message : String(error)
        })
        anyPending = true
        retryDelayMs = Math.min(retryDelayMs, delayMs)
      }
      if (this.disposed || !this.deps.isEnabled()) return
    }

    if (anyPending) this.scheduleRetry(retryDelayMs)
    else this.clearRetry()
  }

  private isOpen(config: GenericAutostartDeviceConfig): boolean {
    const open = this.deps.serial.listConnected()
    return open.some(
      (device) =>
        (config.id !== undefined && device.id === config.id) || device.path === config.path
    )
  }

  private handleDeviceAdded(summary: unknown): void {
    if (this.disposed) return
    const info = readSummary(summary)
    if (!info) return
    // Ignore the SIM-X primary — it has its own controller.
    if (info.kind && info.kind !== 'generic') return
    const config = this.matchConfig(info)
    if (!config) return
    const key = deviceKey({ id: info.id, path: info.path })
    // A real (re)connect clears any pending user-disconnect suppression.
    this.suppressed.delete(key)
    this.suppressed.delete(deviceKey(config))
    this.connectedAt.set(deviceKey(config), Date.now())
    this.deps.logger?.info('serial', 'device auto-connected', {
      id: info.id,
      path: info.path,
      kind: info.kind ?? 'generic',
      label: config.label
    })
    // Persist the (possibly new) COM path so the next boot connects directly.
    if (info.path && info.path !== config.path) {
      try {
        this.deps.saveDevicePath?.(config, info.path)
      } catch {
        // best effort — identity matching still finds it next launch
      }
    }
  }

  private handleDeviceRemoved(summary: unknown): void {
    if (this.disposed) return
    const info = readSummary(summary)
    if (!info) return
    if (info.kind && info.kind !== 'generic') return
    const config = this.matchConfig(info)
    // Only react to devices we're meant to keep connected.
    if (!config || !config.autoConnect) return
    const key = deviceKey(config)
    if (this.suppressed.has(key) || this.suppressed.has(deviceKey({ id: info.id, path: info.path }))) {
      // Deliberate user disconnect → respect it and STAND DOWN, but KEEP the latch.
      // This controller drives a FLEET off ONE shared retry timer: if we cleared the
      // latch here, a retry triggered by ANY other pending device would re-open this
      // one ~retryMs later — fighting the user (e.g. mid firmware-flash). The latch is
      // cleared only on a genuine (re)connect (handleDeviceAdded) or an autoConnect
      // settings re-enable (onSettingsChanged).
      this.deps.logger?.info('serial', 'generic device disconnected by user — auto-reconnect suppressed', {
        id: info.id,
        label: config.label
      })
      return
    }
    if (this.deps.isEnabled()) {
      const delayMs = this.backoffAfterDisconnect(config)
      this.deps.logger?.info('serial', 'generic device disconnected — will retry', {
        id: info.id,
        label: config.label,
        retryInMs: delayMs
      })
      // Back off via the retry timer (like the SIM-X controller) rather than an
      // immediate re-connect: the real hub emits 'device-removed' on an open
      // FAILURE too, so an immediate retry here would tight-loop a device that
      // enumerates but won't open.
      this.scheduleRetry(delayMs)
    }
  }

  private handleUserDisconnect(summary: unknown): void {
    if (this.disposed) return
    const info = readSummary(summary)
    if (!info) return
    // Latch by BOTH id and path so the subsequent 'device-removed' is matched
    // however the hub keys it.
    if (info.id) this.suppressed.add(deviceKey({ id: info.id, path: info.path }))
    this.suppressed.add(deviceKey({ path: info.path }))
    const config = this.matchConfig(info)
    if (config) this.suppressed.add(deviceKey(config))
  }

  // Correlate a hub summary back to one of the known autoConnect configs by hub
  // id first, then by COM path.
  private matchConfig(info: { id: string; path: string }): GenericAutostartDeviceConfig | null {
    const byId = this.knownConfigs.find((c) => c.id !== undefined && c.id === info.id)
    if (byId) return byId
    return this.knownConfigs.find((c) => c.path === info.path) ?? null
  }

  private remainingBackoffMs(config: GenericAutostartDeviceConfig): number {
    return Math.max(0, (this.nextAttemptAt.get(deviceKey(config)) ?? 0) - Date.now())
  }

  private ensureBackoff(config: GenericAutostartDeviceConfig): number {
    const key = deviceKey(config)
    const now = Date.now()
    const existing = this.nextAttemptAt.get(key)
    if (existing && existing > now) return existing - now
    const count = (this.retryCounts.get(key) ?? 0) + 1
    this.retryCounts.set(key, count)
    const delayMs = Math.min(this.maxRetryMs, this.retryMs * 2 ** Math.max(0, count - 1))
    this.nextAttemptAt.set(key, now + delayMs)
    return delayMs
  }

  private backoffAfterDisconnect(config: GenericAutostartDeviceConfig): number {
    const key = deviceKey(config)
    const connectedAt = this.connectedAt.get(key) ?? 0
    this.connectedAt.delete(key)
    if (connectedAt > 0 && Date.now() - connectedAt >= STABLE_CONNECTION_MS) {
      this.retryCounts.delete(key)
      this.nextAttemptAt.delete(key)
    }
    return this.ensureBackoff(config)
  }

  private scheduleRetry(delayMs = this.retryMs): void {
    const safeDelay = Math.max(0, Math.min(this.maxRetryMs, delayMs))
    const dueAt = Date.now() + safeDelay
    if (this.disposed || !this.deps.isEnabled()) return
    if (this.retryTimer !== null) {
      if (this.retryDueAt <= dueAt) return
      clearTimeout(this.retryTimer)
    }
    this.retryDueAt = dueAt
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.retryDueAt = 0
      void this.attempt()
    }, safeDelay)
    // Don't keep the process alive just to retry.
    this.retryTimer.unref?.()
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
      this.retryDueAt = 0
    }
  }
}

// The hub 'device-added'/'device-removed'/'user-disconnect' events carry a
// summary with at least an id + path.
function readSummary(value: unknown): { id: string; path: string; kind?: string } | null {
  if (!value || typeof value !== 'object') return null
  const record = value as { id?: unknown; path?: unknown; kind?: unknown }
  const id = typeof record.id === 'string' ? record.id : ''
  const path = typeof record.path === 'string' ? record.path : ''
  if (!id && !path) return null
  const kind = typeof record.kind === 'string' ? record.kind : undefined
  return { id, path, kind }
}
