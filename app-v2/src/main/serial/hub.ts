import { EventEmitter } from 'node:events'
import type { PortInfo } from '../../shared/ipc'
import type { SerialDeviceKind, SerialDeviceSummary } from '../../shared/arduino'
import { isLikelySimXPort } from '../protocol'
import { SerialDevice } from './device'
import { logger } from '../modules/logger'
import { SerialPort } from './serialport-runtime'

// Stable id reserved for the SIM-X box. Pre-existing code (revlights, OLED,
// arduino, buttonbox IPC) talks to this device through ctx.serialManager,
// which is a thin facade over the hub's primary device.
export const PRIMARY_DEVICE_ID = 'simx'

const DEFAULT_BAUD = 115200

type RawPort = Awaited<ReturnType<typeof SerialPort.list>>[number] & {
  friendlyName?: string
  pnpId?: string
}

export type SerialHubEvent = 'device-added' | 'device-removed' | 'device-updated' | 'user-disconnect'

export interface ConnectDeviceOptions {
  path: string
  // Optional stable id. Omit to let the hub allocate (`simx` for sim-x kind,
  // `gen-N` for everything else).
  id?: string
  kind?: SerialDeviceKind
  label?: string
  baud?: number
  // When true, this device replaces the current primary (which gets
  // disconnected first). Defaults to true for `sim-x`, false otherwise.
  primary?: boolean
  // Forwarded to SerialDevice.
  assertSignals?: boolean
  logLimit?: number
}

// Multi-device serial hub. Owns the Map<id, SerialDevice>, exposes a single
// listPorts() across all OS ports, and emits high-level 'device-added/-removed
// /-updated' events so other modules (Arduinos multi-device UI, custom-serial,
// alert serial outputs) can react without knowing about individual devices.
//
// The SIM-X box is just a regular device with id 'simx' and kind 'sim-x'; the
// SerialManager facade (ctx.serialManager) wraps it to preserve the legacy
// single-session API surface.
export class SerialHub extends EventEmitter {
  private readonly devices = new Map<string, SerialDevice>()
  private primaryId: string | null = null
  private genericCounter = 0

  async listPorts(): Promise<PortInfo[]> {
    const ports = (await SerialPort.list()) as RawPort[]
    return ports.map((port) => {
      const friendly = port.friendlyName
      const isSimX = isLikelySimXPort({
        friendlyName: friendly,
        manufacturer: port.manufacturer ?? null,
        vendorId: port.vendorId ?? null
      })
      return {
        path: port.path,
        manufacturer: port.manufacturer ?? undefined,
        friendlyName: friendly,
        serialNumber: port.serialNumber ?? undefined,
        vendorId: port.vendorId ?? undefined,
        productId: port.productId ?? undefined,
        isSimX
      }
    })
  }

  listDevices(): SerialDeviceSummary[] {
    return [...this.devices.values()].map((device) => device.getSummary())
  }

  getDevice(id: string): SerialDevice | null {
    return this.devices.get(id) ?? null
  }

  getPrimary(): SerialDevice | null {
    if (!this.primaryId) return null
    return this.devices.get(this.primaryId) ?? null
  }

  getPrimaryId(): string | null {
    return this.primaryId
  }

  hasDevice(id: string): boolean {
    return this.devices.has(id)
  }

  // Open a new serial device and register it with the hub. Resolves with the
  // open SerialDevice (callers can subscribe to its events). Rejects (and
  // rolls back the registration) if the port can't be opened.
  async connectDevice(opts: ConnectDeviceOptions): Promise<SerialDevice> {
    const kind: SerialDeviceKind = opts.kind ?? 'generic'
    const makePrimary = opts.primary ?? kind === 'sim-x'
    const id = opts.id ?? this.allocateId(kind)
    const baud = opts.baud ?? DEFAULT_BAUD

    if (makePrimary) {
      const existing = this.primaryId ? this.devices.get(this.primaryId) : null
      if (existing && existing.id !== id) {
        await this.disconnectDevice(existing.id).catch(() => undefined)
      }
    }

    for (const dev of this.devices.values()) {
      if (dev.path === opts.path) {
        throw new Error(`A serial device is already connected on ${opts.path}.`)
      }
    }
    if (this.devices.has(id)) {
      throw new Error(`A serial device already exists with id "${id}".`)
    }

    const device = new SerialDevice({
      id,
      path: opts.path,
      kind,
      label: opts.label,
      baud,
      assertSignals: opts.assertSignals,
      logLimit: opts.logLimit
    })

    // Hub-level passthroughs so consumers can subscribe once and track the
    // fleet. We keep these listeners on the SerialDevice instance until the
    // hub explicitly removes the device (see handleDeviceClosed).
    const onUpdated = (): void => {
      this.emit('device-updated', device.getSummary())
    }
    const onClosed = (): void => this.handleDeviceClosed(id)
    device.on('connect', onUpdated)
    device.on('error', onUpdated)
    device.on('disconnect', onClosed)

    this.devices.set(id, device)
    if (makePrimary) this.primaryId = id
    this.emit('device-added', device.getSummary())
    logger.info('serial', 'fleet device added', {
      id,
      path: opts.path,
      kind,
      primary: makePrimary
    })
    if (makePrimary) logger.info('serial', 'fleet primary changed', { id, kind })

    try {
      await device.open()
    } catch (error) {
      this.devices.delete(id)
      if (this.primaryId === id) this.primaryId = null
      device.removeAllListeners()
      this.emit('device-removed', {
        id,
        path: opts.path,
        label: opts.label ?? (kind === 'sim-x' ? 'SIM-X Button Box' : opts.path),
        kind,
        baud,
        connected: false
      })
      logger.warn('serial', 'fleet device connect failed', {
        id,
        path: opts.path,
        kind,
        message: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
    return device
  }

  async disconnectDevice(id: string): Promise<void> {
    const device = this.devices.get(id)
    if (!device) return
    // device.close() triggers SerialDevice 'disconnect' → handleDeviceClosed,
    // which removes the entry from the map and emits 'device-removed'.
    await device.close().catch(() => undefined)
  }

  // Announce a USER-initiated disconnect of a device BEFORE closing it, so the
  // generic auto-start controller suppresses its reconnect (e.g. the user unplugs
  // the iFlag to flash firmware). Mirrors SerialManager's 'user-disconnect' for the
  // SIM-X. NOT emitted by the hub's own disconnectDevice/disconnectAll/reconnect
  // teardown — only when a human deliberately disconnects via the UI.
  signalUserDisconnect(id: string): void {
    const device = this.devices.get(id)
    if (!device) return
    this.emit('user-disconnect', device.getSummary())
  }

  async disconnectAll(): Promise<void> {
    const ids = [...this.devices.keys()]
    await Promise.all(ids.map((id) => this.disconnectDevice(id)))
  }

  private handleDeviceClosed(id: string): void {
    const device = this.devices.get(id)
    if (!device) return
    const summary = device.getSummary()
    this.devices.delete(id)
    const wasPrimary = this.primaryId === id
    if (wasPrimary) this.primaryId = null
    this.emit('device-removed', summary)
    logger.info('serial', 'fleet device removed', { id, wasPrimary })
  }

  private allocateId(kind: SerialDeviceKind): string {
    if (kind === 'sim-x' && !this.devices.has(PRIMARY_DEVICE_ID)) return PRIMARY_DEVICE_ID
    let id: string
    do {
      this.genericCounter += 1
      id = `gen-${this.genericCounter}`
    } while (this.devices.has(id))
    return id
  }
}
