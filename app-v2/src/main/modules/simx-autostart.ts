import type { PortInfo } from '../../shared/ipc'
import { resolveSimXPort } from '../../shared/simx-autostart'

// Minimal serial surface the coordinator needs — kept structural so tests can pass a
// fake without the whole SerialManager.
export interface AutostartSerial {
  listPorts(): Promise<PortInfo[]>
  connect(path: string): Promise<unknown>
  on(event: 'connect' | 'disconnect' | 'user-disconnect', handler: (...args: unknown[]) => void): void
  off(event: 'connect' | 'disconnect' | 'user-disconnect', handler: (...args: unknown[]) => void): void
}

export interface AutostartLogger {
  info(area: string, message: string, detail?: unknown): void
  verbose(area: string, message: string, detail?: unknown): void
}

export interface SimxAutostartDeps {
  serial: AutostartSerial
  // Flips the rev-lights on once the SIM-X is connected.
  setRevlightsEnabled: (enabled: boolean) => Promise<unknown>
  // Reads the live AppSettings flag (shared store, so toggles are seen immediately).
  isEnabled: () => boolean
  loadLastPort: () => string | null
  saveLastPort: (path: string) => void
  retryMs?: number
  logger?: AutostartLogger
}

const DEFAULT_RETRY_MS = 3000

// Coordinates: auto-connect the SIM-X on launch, enable the rev-lights once it's up,
// keep retrying in the background until it appears, and reconnect if it drops. All
// best-effort — it never throws and never overrides a connection the user made.
export class SimxAutostartController {
  private connected = false
  private connecting = false
  private disposed = false
  // Rev-lights are auto-activated ONCE per session (the first connect). Reconnects
  // don't re-force them, so a user who turned rev-lights off mid-session isn't reverted.
  private revlightsActivated = false
  // Set when the user deliberately disconnects (serial 'user-disconnect') so the next
  // 'disconnect' is NOT auto-reconnected (e.g. unplugging to flash firmware).
  private userDisconnectPending = false
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private readonly retryMs: number
  private readonly onConnect = (info: unknown): void => this.handleConnect(info)
  private readonly onDisconnect = (): void => this.handleDisconnect()
  private readonly onUserDisconnect = (): void => {
    this.userDisconnectPending = true
  }

  constructor(private readonly deps: SimxAutostartDeps) {
    this.retryMs = deps.retryMs ?? DEFAULT_RETRY_MS
  }

  // Subscribe to connect/disconnect (covers BOTH auto and manual connects) and, when
  // the feature is enabled, begin the connect loop.
  start(): void {
    if (this.disposed) return
    this.deps.serial.on('connect', this.onConnect)
    this.deps.serial.on('disconnect', this.onDisconnect)
    this.deps.serial.on('user-disconnect', this.onUserDisconnect)
    if (this.deps.isEnabled()) void this.attemptConnect()
  }

  // Called when AppSettings change. Toggling ON (re)starts the loop; toggling OFF
  // stops the background retry but never disconnects an active session.
  onSettingsChanged(): void {
    if (this.disposed) return
    if (this.deps.isEnabled()) {
      if (!this.connected) void this.attemptConnect()
    } else {
      this.clearRetry()
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearRetry()
    this.deps.serial.off('connect', this.onConnect)
    this.deps.serial.off('disconnect', this.onDisconnect)
    this.deps.serial.off('user-disconnect', this.onUserDisconnect)
  }

  // Test/diagnostic accessors.
  isConnected(): boolean {
    return this.connected
  }

  hasPendingRetry(): boolean {
    return this.retryTimer !== null
  }

  private async attemptConnect(): Promise<void> {
    if (this.disposed || this.connected || this.connecting || !this.deps.isEnabled()) return
    this.connecting = true
    try {
      const ports = await this.deps.serial.listPorts()
      // State can change while listPorts() awaits (a manual connect landed, or we're
      // disposing on quit) — re-check before opening a port.
      if (this.disposed || this.connected || !this.deps.isEnabled()) return
      const path = resolveSimXPort(ports, this.deps.loadLastPort())
      if (!path) {
        this.deps.logger?.verbose('serial', 'auto-start: no candidate port yet', { kind: 'sim-x' })
        this.scheduleRetry()
        return
      }
      this.deps.logger?.info('serial', 'auto-start: connecting', { path, kind: 'sim-x' })
      await this.deps.serial.connect(path)
      // Success is finalized by the 'connect' event handler (persist + rev-lights).
    } catch (error) {
      this.deps.logger?.verbose('serial', 'auto-start: connect attempt failed', {
        kind: 'sim-x',
        message: error instanceof Error ? error.message : String(error)
      })
      this.scheduleRetry()
    } finally {
      this.connecting = false
    }
  }

  private handleConnect(info: unknown): void {
    if (this.disposed) return
    this.connected = true
    // A real connection clears any pending user-disconnect suppression.
    this.userDisconnectPending = false
    this.clearRetry()
    const path = readPath(info)
    // Symmetric success log with the generic controller ("device auto-connected"),
    // so every (re)connect of either device family lands in the diagnostic log.
    this.deps.logger?.info('serial', 'device auto-connected', {
      id: 'simx',
      path: path ?? undefined,
      kind: 'sim-x'
    })
    if (path) {
      try {
        this.deps.saveLastPort(path)
      } catch {
        // best effort
      }
    }
    // Activate rev-lights ONCE per session (first connect only). On reconnects the
    // engine re-asserts its own enabled state via the connect self-test 'resync', so
    // we must NOT force them again — that would revert a user's mid-session "off".
    if (this.deps.isEnabled() && !this.revlightsActivated) {
      this.deps.logger?.info('serial', 'SIM-X connected — activating rev-lights', { path })
      void Promise.resolve(this.deps.setRevlightsEnabled(true))
        .then(() => {
          this.revlightsActivated = true
        })
        .catch((error) => {
          // Leave the flag false so a later connect re-tries enabling them.
          this.deps.logger?.verbose('serial', 'SIM-X auto-start: enabling rev-lights failed', {
            message: error instanceof Error ? error.message : String(error)
          })
        })
    }
  }

  private handleDisconnect(): void {
    if (this.disposed) return
    this.connected = false
    if (this.userDisconnectPending) {
      // Deliberate user disconnect → respect it; don't fight the user. A manual
      // reconnect or toggling the setting resumes auto-start.
      this.userDisconnectPending = false
      this.deps.logger?.info('serial', 'SIM-X disconnected by user — auto-reconnect suppressed')
      return
    }
    if (this.deps.isEnabled()) {
      this.deps.logger?.info('serial', 'SIM-X disconnected — will retry')
      this.scheduleRetry()
    }
  }

  private scheduleRetry(): void {
    if (this.disposed || this.connected || this.retryTimer !== null || !this.deps.isEnabled()) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.attemptConnect()
    }, this.retryMs)
    // Don't keep the process alive just to retry.
    this.retryTimer.unref?.()
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }
}

// The serial 'connect' event carries a DeviceInfo with the connected port path.
function readPath(info: unknown): string | null {
  if (info && typeof info === 'object' && 'path' in info) {
    const path = (info as { path?: unknown }).path
    if (typeof path === 'string' && path.length > 0) return path
  }
  return null
}
