import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DeviceInfo, PortInfo } from '../../shared/ipc'
import {
  ARDUINO_CHANNELS,
  GENERIC_DEVICE_DEFAULT_BAUD,
  SERIAL_LOG_LIMIT,
  SIMX_FIRMWARE_INFO,
  SIMX_HARDWARE_PROFILE,
  defaultRuntimeState,
  encoderThresholdCommand,
  isEncoderDetentThreshold,
  parseRuntimeEcho,
  FLIP_INVERT_TOGGLE_COMMAND,
  FLIP_RECALIBRATE_COMMAND,
  MUX_DEBUG_TOGGLE_COMMAND
} from '../../shared/arduino'
import type {
  ArduinoDeviceSerialBatch,
  ArduinoDevicesChangedPayload,
  ArduinoRuntimeState,
  CompanionInputSnapshot,
  EncoderDetentThreshold,
  GenericSerialDeviceConfig,
  SerialDeviceSummary,
  SerialLogEntry,
  SerialTxOrigin
} from '../../shared/arduino'
import { DEVICES_CHANNELS, type DeviceProfile } from '../../shared/devices'
import type { ModuleContext } from '../module-context'
import { DeviceConfigStore, getDeviceConfigStore } from '../devices/store'
import type { SerialDevice } from '../serial/device'
import { CompanionInputTracker } from '../serial-devices/inputs'
import { SerialDevicesStore, getSerialDevicesStore, serialIdentityMatches, sharesUsbVendorProduct } from '../serial-devices/store'
import {
  profileCanMigrateWithSerialIdentity,
  resolveConnectedSerialIdentityMigration,
  type SerialIdentityMigrationRecord
} from '../serial-devices/identity-migration'
import { saveSimXPrimaryIdentity } from '../serial-devices/simx-identity'

const CONFIG_FILE = 'arduino-runtime.json'
const FLUSH_INTERVAL_MS = 80
const INPUT_BROADCAST_INTERVAL_MS = 100 // ~10Hz, matches output-router cadence
const DEVICE_MONITOR_LOG_LIMIT = 600

// SimHub-style Arduino management: serial monitor (gated, batched broadcast),
// firmware runtime tunables (ET/EM/FI/FC — no reflash) with echo-confirmed
// state, and static hardware/firmware references. Reuses the single
// SerialManager session (the SIM-X box); does not open its own ports.
class ArduinoManager {
  private runtime: ArduinoRuntimeState = defaultRuntimeState()
  private readonly log: SerialLogEntry[] = []
  private seq = 0
  private monitoring = 0
  private pending: SerialLogEntry[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private disposed = false

  private readonly onRx = (line: string): void => {
    this.record('rx', line)
    const echo = parseRuntimeEcho(line)
    if (echo) {
      this.runtime = { ...this.runtime, ...echo, updatedAt: new Date().toISOString() }
      this.broadcastRuntime()
    }
  }

  private readonly onTx = (payload: string, origin: SerialTxOrigin): void => {
    this.record('tx', payload, origin)
  }

  private readonly onConnect = (_device: DeviceInfo): void => {
    // The Pro Micro resets on port open, so its runtime toggles return to the
    // firmware defaults: mark them unknown and re-apply the saved detent feel.
    this.runtime = { ...this.runtime, muxDebug: null, flipCoverInverted: null }
    this.broadcastRuntime()
    void this.ctx.serialManager
      .sendRaw(encoderThresholdCommand(this.runtime.encoderDetentThreshold))
      .catch(() => undefined)
    void this.rememberSimXIdentity(_device.path)
  }

  constructor(private readonly ctx: ModuleContext) {}

  async initialize(): Promise<void> {
    this.runtime = await this.loadConfig()
    this.ctx.serialManager.on('rx', this.onRx)
    this.ctx.serialManager.on('tx', this.onTx)
    this.ctx.serialManager.on('connect', this.onConnect)
    const primary = this.ctx.serialHub.getPrimary()
    if (primary?.kind === 'sim-x') void this.rememberSimXIdentity(primary.path)
  }

  dispose(): void {
    this.disposed = true
    this.ctx.serialManager.off('rx', this.onRx)
    this.ctx.serialManager.off('tx', this.onTx)
    this.ctx.serialManager.off('connect', this.onConnect)
    this.stopFlushTimer()
  }

  getRuntime(): ArduinoRuntimeState {
    return this.runtime
  }

  getLog(): SerialLogEntry[] {
    return [...this.log]
  }

  async setEncoderThreshold(value: EncoderDetentThreshold): Promise<ArduinoRuntimeState> {
    if (!isEncoderDetentThreshold(value)) {
      throw new Error(`Invalid encoder threshold: ${value}. Use 1, 2, 4, or 8.`)
    }
    // Optimistic update; the device echo ("ET=<n>") confirms it shortly after.
    this.runtime = { ...this.runtime, encoderDetentThreshold: value, updatedAt: new Date().toISOString() }
    await this.saveConfig()
    this.broadcastRuntime()
    await this.ctx.serialManager.sendRaw(encoderThresholdCommand(value))
    return this.runtime
  }

  async toggleMuxDebug(): Promise<void> {
    await this.ctx.serialManager.sendRaw(MUX_DEBUG_TOGGLE_COMMAND)
  }

  async toggleFlipInvert(): Promise<void> {
    await this.ctx.serialManager.sendRaw(FLIP_INVERT_TOGGLE_COMMAND)
  }

  async flipRecalibrate(): Promise<void> {
    await this.ctx.serialManager.sendRaw(FLIP_RECALIBRATE_COMMAND)
  }

  async sendRaw(command: string): Promise<void> {
    // This wrapper is only reached by the manual `arduino:sendRaw` IPC (the primary
    // device console), so tag it MANUAL — otherwise the renderer's engine-noise
    // filter hides the user's own R/B/O/D test commands.
    await this.ctx.serialManager.sendRaw(command, 'manual')
  }

  clearLog(): void {
    this.log.length = 0
    this.pending = []
    this.ctx.broadcast('arduino:cleared', null)
  }

  startMonitor(): void {
    this.monitoring += 1
    if (!this.flushTimer && !this.disposed) {
      this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS)
    }
  }

  stopMonitor(): void {
    this.monitoring = Math.max(0, this.monitoring - 1)
    if (this.monitoring === 0) {
      // Drop any not-yet-flushed entries so they can't be re-broadcast (and
      // duplicated against getLog) the next time a monitor opens.
      this.pending = []
      this.stopFlushTimer()
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────────────
  private record(dir: 'rx' | 'tx', text: string, origin?: SerialTxOrigin): void {
    const entry: SerialLogEntry = { seq: this.seq++, dir, text, origin, ts: Date.now() }
    this.log.push(entry)
    if (this.log.length > SERIAL_LOG_LIMIT) this.log.splice(0, this.log.length - SERIAL_LOG_LIMIT)
    if (this.monitoring > 0) this.pending.push(entry)
  }

  private flush(): void {
    if (this.pending.length === 0) return
    const batch = this.pending
    this.pending = []
    this.ctx.broadcast('arduino:serial', batch)
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }

  private broadcastRuntime(): void {
    this.ctx.broadcast('arduino:runtimeState', this.runtime)
  }

  private async loadConfig(): Promise<ArduinoRuntimeState> {
    try {
      const raw = JSON.parse(await readFile(this.configPath, 'utf8')) as Partial<ArduinoRuntimeState>
      const threshold = isEncoderDetentThreshold(raw.encoderDetentThreshold)
        ? raw.encoderDetentThreshold
        : defaultRuntimeState().encoderDetentThreshold
      // Only the encoder threshold persists; the toggles are live device state
      // and start unknown until the device echoes them.
      return {
        encoderDetentThreshold: threshold,
        muxDebug: null,
        flipCoverInverted: null,
        updatedAt: new Date().toISOString()
      }
    } catch {
      return defaultRuntimeState()
    }
  }

  private async saveConfig(): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true })
    await writeFile(this.configPath, JSON.stringify(this.runtime, null, 2), 'utf8')
  }

  private async rememberSimXIdentity(path: string): Promise<void> {
    try {
      const port = (await this.ctx.serialHub.listPorts()).find((entry) => entry.path === path)
      if (!port) return
      await saveSimXPrimaryIdentity(this.ctx.app, port)
    } catch (error) {
      console.warn(
        '[arduino] failed to save SIM-X primary identity:',
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  private get configPath(): string {
    return join(this.ctx.app.getPath('userData'), CONFIG_FILE)
  }
}

// Per-device serial monitor (mirror of the primary monitor for any non-SIM-X
// device added through the fleet UI). Tiny ring buffer + gated broadcast so
// idle devices stay quiet on the IPC bridge.
interface DeviceMonitor {
  log: SerialLogEntry[]
  seq: number
  pending: SerialLogEntry[]
}

function emptyMonitor(): DeviceMonitor {
  return { log: [], seq: 0, pending: [] }
}

// Multi-device fleet: persists user-added generic devices, auto-opens them on
// boot, mirrors hub events to the renderer, parses companion-protocol inputs
// from each device's rx stream and exposes a per-device serial monitor + IPC
// for "send raw" / "clear log" parallel to the SIM-X monitor above.
class FleetManager {
  private readonly store: SerialDevicesStore
  private readonly profileStore: DeviceConfigStore
  private readonly tracker = new CompanionInputTracker()
  private readonly monitors = new Map<string, DeviceMonitor>()
  private readonly unsubscribers = new Map<string, () => void>()
  private inputsTimer: ReturnType<typeof setInterval> | null = null
  private disposed = false

  constructor(private readonly ctx: ModuleContext) {
    this.store = getSerialDevicesStore(ctx.app)
    this.profileStore = getDeviceConfigStore(ctx.app)
  }

  async initialize(): Promise<void> {
    await Promise.all([this.store.ensureLoaded(), this.profileStore.ensureLoaded()])
    this.attachHubListeners()
    this.startInputsTimer()
    await this.autoReconnect()
    // Send an initial fleet snapshot so the renderer paints state on mount.
    this.broadcastDevices()
  }

  dispose(): void {
    this.disposed = true
    if (this.inputsTimer) {
      clearInterval(this.inputsTimer)
      this.inputsTimer = null
    }
    for (const unsubscribe of this.unsubscribers.values()) unsubscribe()
    this.unsubscribers.clear()
  }

  // ─── Public API (consumed by the IPC layer below) ─────────────────────────

  listDevices(): SerialDeviceSummary[] {
    return this.ctx.serialHub.listDevices()
  }

  async listLinkableDevices(): Promise<SerialDeviceSummary[]> {
    const connected = this.ctx.serialHub.listDevices()
    let ports: Awaited<ReturnType<ModuleContext['serialHub']['listPorts']>> = []
    let configs: GenericSerialDeviceConfig[] = []
    try {
      await this.store.ensureLoaded()
      configs = this.store.list()
      ports = await this.ctx.serialHub.listPorts()
    } catch (error) {
      console.warn(
        '[arduino] failed to enumerate serial ports:',
        error instanceof Error ? error.message : String(error)
      )
      return connected
    }

    const byPath = new Map<string, SerialDeviceSummary>()
    for (const device of connected) byPath.set(normalizeSerialPath(device.path), device)
    for (const port of ports) {
      const key = normalizeSerialPath(port.path)
      if (byPath.has(key)) continue
      const config = configs.find(
        (entry) => serialIdentityMatches(entry, port) || normalizeSerialPath(entry.path) === key
      )
      byPath.set(key, serialPortToAvailableSummary(port, config))
    }
    return [...byPath.values()]
  }

  async getDeviceConfigs(): Promise<GenericSerialDeviceConfig[]> {
    await this.store.ensureLoaded()
    return this.store.list()
  }

  async addDevice(input: {
    path: string
    label: string
    baud: number
    autoConnect?: boolean
  }): Promise<SerialDeviceSummary> {
    const path = String(input.path ?? '').trim()
    const label = String(input.label ?? '').trim() || path
    const baud = Number.isFinite(input.baud) && input.baud > 0 ? Math.trunc(input.baud) : 115200
    if (!path) throw new Error('Enter the device serial port.')
    await this.store.ensureLoaded()

    const primaryId = this.ctx.serialHub.getPrimaryId()
    const existingSummary = this.ctx.serialHub.listDevices().find((entry) => entry.path === path)
    if (existingSummary && (existingSummary.kind === 'sim-x' || existingSummary.id === primaryId)) {
      throw new Error('SIM-X is managed under Devices — do not add it as a generic Arduino.')
    }
    const savedConfig = this.store.list().find(
      (entry) =>
        (existingSummary ? entry.id === existingSummary.id : false) ||
        entry.path === path
    )
    if (existingSummary) {
      const migration = await this.resolveConnectedIdentity(
        existingSummary.id,
        savedConfig,
        true
      )
      if (!migration.record) throw new Error(migration.message)
      // Already open through some other path — persist the user's metadata
      // (label/baud) and return the live summary.
      await this.store.upsert({
        ...migration.record,
        label,
        baud: existingSummary.baud,
        autoConnect: input.autoConnect ?? true
      })
      await this.migrateLinkedProfiles(savedConfig, migration.record)
      this.broadcastDevices()
      return existingSummary
    }

    const device = await this.ctx.serialHub.connectDevice({
      path,
      kind: 'generic',
      label,
      baud,
      primary: false,
      // Generic CDC devices don't need the Pro Micro DTR dance; skip the
      // settle delay so they come up instantly.
      assertSignals: false
    })
    const migration = await this.resolveConnectedIdentity(device.id, savedConfig, true)
    if (!migration.record) {
      await this.ctx.serialHub.disconnectDevice(device.id).catch(() => undefined)
      throw new Error(migration.message)
    }
    await this.store.upsert({
      ...migration.record,
      label,
      baud,
      autoConnect: input.autoConnect ?? true
    })
    await this.migrateLinkedProfiles(savedConfig, migration.record)
    return device.getSummary()
  }

  async removeDevice(id: string): Promise<void> {
    if (!id) return
    if (id === this.ctx.serialHub.getPrimaryId()) {
      throw new Error('Use Devices → Disconnect to remove the primary SIM-X.')
    }
    const summary = this.ctx.serialHub.listDevices().find((entry) => entry.id === id)
    // Mirror disconnectDevice: a user-initiated removal is deliberate, so suppress the
    // generic auto-start's reconnect (otherwise the shared retry timer, kept alive by
    // any other pending device, could re-open this one in the ~3s before the store
    // prune lands).
    this.ctx.serialHub.signalUserDisconnect(id)
    await this.ctx.serialHub.disconnectDevice(id)
    await this.store.remove({ id, path: summary?.path })
    this.monitors.delete(id)
    this.tracker.forget(id)
    this.broadcastDevices()
  }

  async reconnectDevice(id: string): Promise<SerialDeviceSummary> {
    await this.store.ensureLoaded()
    const config = this.store.list().find((entry) => entry.id === id)
    if (!config) throw new Error('Device not found in storage.')
    // Tear down any stale open instance with the same id first.
    if (this.ctx.serialHub.getDevice(id)) {
      await this.ctx.serialHub.disconnectDevice(id).catch(() => undefined)
    }
    const targetPath = await this.resolveCurrentPath(config)
    const device = await this.ctx.serialHub.connectDevice({
      path: targetPath,
      id,
      kind: 'generic',
      label: config.label,
      baud: config.baud,
      primary: false,
      assertSignals: false
    })
    const migration = await this.resolveConnectedIdentity(device.id, config, true)
    if (!migration.record) {
      await this.ctx.serialHub.disconnectDevice(device.id).catch(() => undefined)
      throw new Error(migration.message)
    }
    await this.store.upsert({
      ...migration.record,
      label: config.label,
      baud: config.baud,
      autoConnect: config.autoConnect
    })
    await this.migrateLinkedProfiles(config, migration.record)
    return device.getSummary()
  }

  async disconnectDevice(id: string): Promise<void> {
    if (!id) return
    if (id === this.ctx.serialHub.getPrimaryId()) {
      throw new Error('Use Devices → Disconnect to turn off the main SIM-X.')
    }
    // The user deliberately disconnected this device — tell the generic auto-start
    // so it does NOT fight them by reconnecting ~3s later (e.g. unplugging the iFlag
    // to flash firmware). The device stays in the store (autoConnect untouched), so a
    // manual reconnect or app restart resumes auto-connect.
    this.ctx.serialHub.signalUserDisconnect(id)
    await this.ctx.serialHub.disconnectDevice(id)
  }

  getDeviceLog(id: string): SerialLogEntry[] {
    const device = this.ctx.serialHub.getDevice(id)
    return device ? device.getLog() : []
  }

  clearDeviceLog(id: string): void {
    const device = this.ctx.serialHub.getDevice(id)
    if (device) device.clearLog()
    const monitor = this.monitors.get(id)
    if (monitor) {
      monitor.log.length = 0
      monitor.pending = []
    }
  }

  async sendDeviceRaw(id: string, command: string): Promise<void> {
    const device = this.ctx.serialHub.getDevice(id)
    if (!device) throw new Error(`Device "${id}" is not connected.`)
    // User-typed command from the device console → tag as a genuine MANUAL tx so the
    // log distinguishes it from the engine's live telemetry frames (which now
    // default to 'engine').
    await device.sendRaw(command, 'manual')
  }

  getInputs(): CompanionInputSnapshot[] {
    return this.tracker.list()
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private attachHubListeners(): void {
    const hub = this.ctx.serialHub
    const onAdded = (summary: SerialDeviceSummary): void => {
      this.bindDevice(summary.id)
      this.broadcastDevices()
    }
    const onRemoved = (summary: SerialDeviceSummary): void => {
      this.unbindDevice(summary.id)
      this.tracker.forget(summary.id)
      this.monitors.delete(summary.id)
      this.broadcastDevices()
    }
    const onUpdated = (): void => this.broadcastDevices()
    hub.on('device-added', onAdded)
    hub.on('device-removed', onRemoved)
    hub.on('device-updated', onUpdated)

    // Pick up any device that was added BEFORE us (e.g. the SIM-X primary
    // connected during boot but before the module finished loading). We don't
    // aggregate companion inputs for the SIM-X kind — it has its own protocol.
    for (const summary of hub.listDevices()) {
      this.bindDevice(summary.id)
    }
  }

  private bindDevice(deviceId: string): void {
    if (this.unsubscribers.has(deviceId)) return
    const device = this.ctx.serialHub.getDevice(deviceId)
    if (!device) return
    // SIM-X keeps the legacy ArduinoManager path; aggregating companion
    // inputs from it would conflict with the runtime echo parser.
    if (device.kind === 'sim-x') {
      this.unsubscribers.set(deviceId, () => undefined)
      return
    }

    const handler = (line: string): void => {
      this.tracker.ingest(deviceId, line)
      this.recordDeviceLog(device, 'rx', line)
    }
    const txHandler = (text: string, origin?: SerialTxOrigin): void => {
      this.recordDeviceLog(device, 'tx', text, origin)
    }
    device.on('rx', handler)
    device.on('tx', txHandler)
    this.unsubscribers.set(deviceId, () => {
      device.off('rx', handler)
      device.off('tx', txHandler)
    })
  }

  private unbindDevice(deviceId: string): void {
    const unsubscribe = this.unsubscribers.get(deviceId)
    if (unsubscribe) {
      unsubscribe()
      this.unsubscribers.delete(deviceId)
    }
  }

  private recordDeviceLog(
    device: SerialDevice,
    dir: 'rx' | 'tx',
    text: string,
    origin?: SerialTxOrigin
  ): void {
    let monitor = this.monitors.get(device.id)
    if (!monitor) {
      monitor = emptyMonitor()
      this.monitors.set(device.id, monitor)
    }
    const entry: SerialLogEntry = { seq: monitor.seq++, dir, text, origin, ts: Date.now() }
    monitor.log.push(entry)
    if (monitor.log.length > DEVICE_MONITOR_LOG_LIMIT) {
      monitor.log.splice(0, monitor.log.length - DEVICE_MONITOR_LOG_LIMIT)
    }
    monitor.pending.push(entry)
  }

  private startInputsTimer(): void {
    if (this.inputsTimer || this.disposed) return
    this.inputsTimer = setInterval(() => {
      // Inputs broadcast: send the dirty snapshots. Sending the full list
      // (small payload — only the devices that actually emitted something)
      // is simpler than diffs and lets the renderer reconcile by deviceId.
      const dirty = this.tracker.drainDirty()
      if (dirty.length > 0) {
        const payload: CompanionInputSnapshot[] = []
        for (const deviceId of dirty) {
          const snapshot = this.tracker.get(deviceId)
          if (snapshot) payload.push(snapshot)
          else {
            const tombstone = this.tracker.takeTombstone(deviceId)
            if (tombstone) payload.push(tombstone)
          }
        }
        if (payload.length > 0) this.ctx.broadcast(ARDUINO_CHANNELS.inputs, payload)
      }
      // Per-device monitor batches.
      for (const [deviceId, monitor] of this.monitors) {
        if (monitor.pending.length === 0) continue
        const batch: ArduinoDeviceSerialBatch = { deviceId, entries: monitor.pending }
        monitor.pending = []
        this.ctx.broadcast(ARDUINO_CHANNELS.deviceSerial, batch)
      }
    }, INPUT_BROADCAST_INTERVAL_MS)
  }

  private broadcastDevices(): void {
    const payload: ArduinoDevicesChangedPayload = { devices: this.ctx.serialHub.listDevices() }
    this.ctx.broadcast(ARDUINO_CHANNELS.devicesChanged, payload)
  }

  private async autoReconnect(): Promise<void> {
    const configs = this.store.list()
    for (const config of configs) {
      if (!config.autoConnect) continue
      // Windows may have reassigned this device to a different COM port since it
      // was saved — resolve its CURRENT path by stable USB identity first.
      const targetPath = await this.resolveCurrentPath(config)
      try {
        const device = await this.ctx.serialHub.connectDevice({
          path: targetPath,
          id: config.id,
          kind: 'generic',
          label: config.label,
          baud: config.baud,
          primary: false,
          assertSignals: false
        })
        const migration = await this.resolveConnectedIdentity(device.id, config, false)
        if (!migration.record) {
          if (migration.state === 'mismatch' || migration.state === 'missing') {
            await this.ctx.serialHub.disconnectDevice(device.id).catch(() => undefined)
          }
          console.warn(`[arduino] ${config.label}: ${migration.message}`)
          continue
        }
        // Persist the (possibly new) path + runtime id while keeping the identity
        // as the key, so the next boot finds the same device directly.
        await this.store.upsert({
          ...migration.record,
          label: config.label,
          baud: config.baud,
          autoConnect: config.autoConnect
        })
        await this.migrateLinkedProfiles(config, migration.record)
      } catch (error) {
        console.warn(
          `[arduino] auto-reconnect failed for ${config.label} (${targetPath}):`,
          error instanceof Error ? error.message : String(error)
        )
      }
    }
  }

  // Resolve the live COM path for a stored device. Prefers a stable USB-identity
  // match against the current port list (so a device that moved COM ports is
  // still found); falls back to the saved path for identity-less adapters.
  private async resolveCurrentPath(config: GenericSerialDeviceConfig): Promise<string> {
    if (!config.vendorId && !config.productId && !config.serialNumber) return config.path
    try {
      const ports = await this.ctx.serialHub.listPorts()
      // Strongest: a full identity match — a serial-bearing device (recognised
      // across COM changes) or the same serial-less unit still on its known path.
      const exact = ports.find((port) => serialIdentityMatches(config, port))
      if (exact) return exact.path
      // Serial-less unit whose COM changed: VID+PID isn't unique, so only follow
      // it to a new COM when EXACTLY ONE present port shares its VID+PID (no
      // identical twin to confuse it with). With 0 or 2+ candidates, keep the
      // stored path rather than risk binding the wrong device.
      const hasSerial = !!(config.serialNumber && config.serialNumber.trim())
      if (!hasSerial) {
        const sameModel = ports.filter((port) => sharesUsbVendorProduct(config, port))
        if (sameModel.length === 1) return sameModel[0].path
      }
    } catch {
      // Fall through to the stored path on enumeration failure.
    }
    return config.path
  }

  private async resolveConnectedIdentity(
    deviceId: string,
    saved: GenericSerialDeviceConfig | undefined,
    allowUnboundMigration: boolean
  ): Promise<ReturnType<typeof resolveConnectedSerialIdentityMigration>> {
    const ports = await this.ctx.serialHub.listPorts().catch(() => [])
    return resolveConnectedSerialIdentityMigration({
      deviceId,
      saved,
      live: this.ctx.serialHub.listDevices(),
      ports,
      allowUnboundMigration
    })
  }

  private async migrateLinkedProfiles(
    saved: GenericSerialDeviceConfig | undefined,
    identity: SerialIdentityMigrationRecord
  ): Promise<void> {
    if (!saved) return
    await this.profileStore.ensureLoaded()
    const linked = this.profileStore.list().filter((profile) =>
      profileCanMigrateWithSerialIdentity(profile, saved)
    )
    for (const profile of linked) {
      await this.profileStore.save({
        ...profile,
        deviceId: identity.id,
        port: identity.path
      } satisfies Partial<DeviceProfile>)
    }
    if (linked.length > 0) {
      this.ctx.broadcast(DEVICES_CHANNELS.changed, this.profileStore.list())
    }
  }
}

function normalizeSerialPath(path: string): string {
  return String(path ?? '').trim().toUpperCase()
}

function serialPortToAvailableSummary(port: PortInfo, config?: GenericSerialDeviceConfig): SerialDeviceSummary {
  const label =
    config?.label?.trim() ||
    port.friendlyName?.trim() ||
    port.manufacturer?.trim() ||
    (port.isSimX ? 'SIM-X Button Box' : port.path)
  return {
    id: config?.id ?? `available:${port.path}`,
    path: port.path,
    label,
    kind: 'generic',
    baud: config?.baud ?? GENERIC_DEVICE_DEFAULT_BAUD,
    connected: false
  }
}

export function register(ctx: ModuleContext): void {
  const manager = new ArduinoManager(ctx)
  const fleet = new FleetManager(ctx)
  void manager.initialize().catch((error) => {
    console.error('[arduino] Failed to initialize:', error)
  })
  void fleet.initialize().catch((error) => {
    console.error('[arduino] Failed to initialize fleet:', error)
  })

  ctx.ipcMain.handle('arduino:getHardwareProfile', () => SIMX_HARDWARE_PROFILE)
  ctx.ipcMain.handle('arduino:getFirmwareInfo', () => SIMX_FIRMWARE_INFO)
  ctx.ipcMain.handle('arduino:getRuntimeState', () => manager.getRuntime())
  ctx.ipcMain.handle('arduino:getLog', () => manager.getLog())
  ctx.ipcMain.handle('arduino:setEncoderThreshold', (_event, value: EncoderDetentThreshold) =>
    manager.setEncoderThreshold(value)
  )
  ctx.ipcMain.handle('arduino:toggleMuxDebug', () => manager.toggleMuxDebug())
  ctx.ipcMain.handle('arduino:toggleFlipInvert', () => manager.toggleFlipInvert())
  ctx.ipcMain.handle('arduino:flipRecalibrate', () => manager.flipRecalibrate())
  ctx.ipcMain.handle('arduino:sendRaw', (_event, command: string) => manager.sendRaw(command))
  ctx.ipcMain.handle('arduino:clearLog', () => manager.clearLog())
  ctx.ipcMain.handle('arduino:monitorStart', () => manager.startMonitor())
  ctx.ipcMain.handle('arduino:monitorStop', () => manager.stopMonitor())

  // Multi-device fleet IPC.
  ctx.ipcMain.handle(ARDUINO_CHANNELS.listDevices, () => fleet.listLinkableDevices())
  ctx.ipcMain.handle(ARDUINO_CHANNELS.getDeviceConfigs, () => fleet.getDeviceConfigs())
  ctx.ipcMain.handle(
    ARDUINO_CHANNELS.addDevice,
    (_event, payload: { path: string; label: string; baud: number; autoConnect?: boolean }) =>
      fleet.addDevice(payload)
  )
  ctx.ipcMain.handle(ARDUINO_CHANNELS.removeDevice, (_event, id: string) => fleet.removeDevice(id))
  ctx.ipcMain.handle(ARDUINO_CHANNELS.reconnectDevice, (_event, id: string) => fleet.reconnectDevice(id))
  ctx.ipcMain.handle(ARDUINO_CHANNELS.disconnectDevice, (_event, id: string) =>
    fleet.disconnectDevice(id)
  )
  ctx.ipcMain.handle(ARDUINO_CHANNELS.getDeviceLog, (_event, id: string) => fleet.getDeviceLog(id))
  ctx.ipcMain.handle(ARDUINO_CHANNELS.clearDeviceLog, (_event, id: string) => fleet.clearDeviceLog(id))
  ctx.ipcMain.handle(ARDUINO_CHANNELS.sendDeviceRaw, (_event, id: string, command: string) =>
    fleet.sendDeviceRaw(id, command)
  )
  ctx.ipcMain.handle(ARDUINO_CHANNELS.getInputs, () => fleet.getInputs())

  ctx.app.once('before-quit', () => {
    manager.dispose()
    fleet.dispose()
  })
}
