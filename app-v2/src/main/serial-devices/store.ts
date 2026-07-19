import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { App } from 'electron'
import {
  GENERIC_DEVICE_DEFAULT_BAUD,
  SERIAL_DEVICES_STORE_FILE,
  SERIAL_DEVICES_STORE_VERSION,
  defaultSerialDevicesStore,
  isGenericSerialDeviceConfig,
  type GenericSerialDeviceConfig,
  type SerialDevicesStorePayload
} from '../../shared/arduino'
import {
  cleanText,
  normalizeUsbId,
  serialIdentityMatches,
  sharesUsbVendorProduct
} from '../../shared/generic-autostart'

// The USB-identity matching helpers live in shared/generic-autostart.ts (pure +
// testable, also used by the generic boot auto-start). Re-exported here so the
// existing importers (e.g. modules/arduino.ts) keep importing them from the store.
export { serialIdentityMatches, sharesUsbVendorProduct }

// Persisted-on-disk list of user-added generic serial devices. Loaded once on
// boot so the Arduinos module can auto-reconnect them, and rewritten whenever
// the user adds/removes/edits a device through the UI. The SIM-X box is NOT
// stored here — it lives in the legacy primary path (buttonbox:connect).
export class SerialDevicesStore {
  private payload: SerialDevicesStorePayload = defaultSerialDevicesStore()
  private loaded = false
  private loadPromise: Promise<void> | null = null

  constructor(private readonly app: App) {}

  private get path(): string {
    return join(this.app.getPath('userData'), SERIAL_DEVICES_STORE_FILE)
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    if (!this.loadPromise) {
      this.loadPromise = this.loadFromDisk().catch((error) => {
        console.warn('[serial-devices/store] load failed, starting empty:', error)
        this.payload = defaultSerialDevicesStore()
        this.loaded = true
      })
    }
    await this.loadPromise
  }

  list(): GenericSerialDeviceConfig[] {
    return this.payload.devices.slice()
  }

  // Replace an existing entry or append a new one. Matching priority mirrors the
  // SIM-X box: a device's STABLE USB identity (vendorId/productId/serialNumber)
  // wins, so the same physical box that re-enumerated on a different COM port
  // updates its record (and its `path`) instead of being saved as a duplicate.
  // Falls back to the hub id, then the COM path only to migrate the saved record;
  // Rig Preflight never treats those mutable selectors as certified identity.
  // Returns the persisted entry (with normalized timestamps).
  async upsert(
    entry: Omit<GenericSerialDeviceConfig, 'createdAt' | 'updatedAt'> & {
      createdAt?: string
      updatedAt?: string
    }
  ): Promise<GenericSerialDeviceConfig> {
    await this.ensureLoaded()
    const now = new Date().toISOString()
    const existingIndex = this.payload.devices.findIndex((d) => {
      if (serialIdentityMatches(d, entry)) return true
      if (entry.id && d.id === entry.id) return true
      return d.path === entry.path
    })
    const existing = existingIndex >= 0 ? this.payload.devices[existingIndex] : undefined
    const baud = Number.isFinite(entry.baud) && entry.baud > 0 ? entry.baud : GENERIC_DEVICE_DEFAULT_BAUD
    const next: GenericSerialDeviceConfig = {
      id: entry.id ?? existing?.id,
      // Always adopt the latest path so a moved device connects on its new COM.
      path: entry.path,
      label: entry.label,
      baud,
      autoConnect: entry.autoConnect,
      // Preserve a previously-recorded identity if this upsert didn't carry one.
      vendorId: normalizeUsbId(entry.vendorId) ?? existing?.vendorId,
      productId: normalizeUsbId(entry.productId) ?? existing?.productId,
      serialNumber: cleanText(entry.serialNumber) ?? existing?.serialNumber,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    }
    if (existingIndex >= 0) this.payload.devices[existingIndex] = next
    else this.payload.devices.push(next)
    await this.flush()
    return next
  }

  // Remove by either `path` or `id`. Returns true when a record was deleted.
  async remove(selector: { path?: string; id?: string }): Promise<boolean> {
    await this.ensureLoaded()
    const before = this.payload.devices.length
    this.payload.devices = this.payload.devices.filter((entry) => {
      if (selector.path && entry.path === selector.path) return false
      if (selector.id && entry.id === selector.id) return false
      return true
    })
    if (this.payload.devices.length === before) return false
    await this.flush()
    return true
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const raw = await readFile(this.path, 'utf8')
      const parsed = JSON.parse(raw) as Partial<SerialDevicesStorePayload>
      const devices = Array.isArray(parsed.devices)
        ? parsed.devices.filter(isGenericSerialDeviceConfig)
        : []
      this.payload = {
        version: SERIAL_DEVICES_STORE_VERSION,
        devices,
        updatedAt:
          typeof parsed.updatedAt === 'string' && parsed.updatedAt ? parsed.updatedAt : new Date().toISOString()
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
      this.payload = defaultSerialDevicesStore()
    } finally {
      this.loaded = true
    }
  }

  private async flush(): Promise<void> {
    this.payload.updatedAt = new Date().toISOString()
    await mkdir(dirname(this.path), { recursive: true })
    await writeFile(this.path, `${JSON.stringify(this.payload, null, 2)}\n`, 'utf8')
  }
}

// Single shared instance so every writer (the Arduinos fleet module AND the
// Arduino Setup tool) persists through ONE in-memory payload — otherwise two
// stores racing on the same file would silently drop each other's saves.
let sharedStore: SerialDevicesStore | null = null

export function getSerialDevicesStore(app: App): SerialDevicesStore {
  if (!sharedStore) sharedStore = new SerialDevicesStore(app)
  return sharedStore
}
