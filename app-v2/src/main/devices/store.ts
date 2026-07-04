import type { App } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  DEVICES_STORE_FILE,
  DEVICES_STORE_VERSION,
  defaultDevicesPayload,
  isDeviceProfile,
  normalizeDeviceProfile,
  type DeviceProfile,
  type DevicesPayload
} from '../../shared/devices'

// Persists the user's Arduino device profiles (board + components + pinout) at
// userData/arduino-devices.json. Mirrors the lightweight pattern used by the
// other config stores (revlights/oled/serial-devices).
export class DeviceConfigStore {
  private payload: DevicesPayload = defaultDevicesPayload()
  private loaded = false
  private readonly path: string

  constructor(app: App) {
    this.path = join(app.getPath('userData'), DEVICES_STORE_FILE)
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    try {
      const raw = JSON.parse(await readFile(this.path, 'utf8')) as Partial<DevicesPayload>
      const devices = Array.isArray(raw.devices)
        ? raw.devices.filter(isDeviceProfile).map((device) => normalizeDeviceProfile(device))
        : []
      this.payload = {
        version: DEVICES_STORE_VERSION,
        devices,
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString()
      }
    } catch {
      this.payload = defaultDevicesPayload()
    }
    this.loaded = true
  }

  list(): DeviceProfile[] {
    return this.payload.devices
  }

  get(id: string): DeviceProfile | null {
    return this.payload.devices.find((device) => device.id === id) ?? null
  }

  async save(input: Partial<DeviceProfile>): Promise<DeviceProfile> {
    await this.ensureLoaded()
    const profile = normalizeDeviceProfile(input)
    profile.updatedAt = new Date().toISOString()
    const index = this.payload.devices.findIndex((device) => device.id === profile.id)
    if (index >= 0) {
      // Preserve the original createdAt on update.
      profile.createdAt = this.payload.devices[index].createdAt
      this.payload.devices[index] = profile
    } else {
      this.payload.devices.push(profile)
    }
    await this.persist()
    return profile
  }

  async remove(id: string): Promise<void> {
    await this.ensureLoaded()
    this.payload.devices = this.payload.devices.filter((device) => device.id !== id)
    await this.persist()
  }

  private async persist(): Promise<void> {
    this.payload.updatedAt = new Date().toISOString()
    await mkdir(dirname(this.path), { recursive: true })
    await writeFile(this.path, JSON.stringify(this.payload, null, 2), 'utf8')
  }
}

// Single shared instance so every module that persists DeviceProfiles (the
// Hardware Hub config module AND the Arduino Setup tool) writes through ONE
// in-memory payload — otherwise two stores racing on the same file could drop
// each other's saves.
let sharedStore: DeviceConfigStore | null = null

export function getDeviceConfigStore(app: App): DeviceConfigStore {
  if (!sharedStore) sharedStore = new DeviceConfigStore(app)
  return sharedStore
}
