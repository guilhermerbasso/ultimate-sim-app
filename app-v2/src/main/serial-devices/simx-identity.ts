import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { App } from 'electron'
import type { PortInfo } from '../../shared/ipc'

const SIMX_PRIMARY_IDENTITY_FILE = 'simx-primary-identity.json'

export interface SimXPrimaryIdentity {
  path: string
  serialNumber?: string
  vendorId?: string
  productId?: string
  updatedAt: string
}

export async function readSimXPrimaryIdentity(app: App): Promise<SimXPrimaryIdentity | null> {
  try {
    const parsed = JSON.parse(await readFile(identityPath(app), 'utf8')) as Partial<SimXPrimaryIdentity>
    if (typeof parsed.path !== 'string' || !parsed.path) return null
    return {
      path: parsed.path,
      serialNumber: clean(parsed.serialNumber),
      vendorId: normalizeUsbId(parsed.vendorId),
      productId: normalizeUsbId(parsed.productId),
      updatedAt: typeof parsed.updatedAt === 'string' && parsed.updatedAt ? parsed.updatedAt : new Date().toISOString()
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    console.warn('[simx-identity] load failed:', error instanceof Error ? error.message : String(error))
    return null
  }
}

export async function saveSimXPrimaryIdentity(app: App, port: PortInfo): Promise<void> {
  if (!port.path) return
  const identity: SimXPrimaryIdentity = {
    path: port.path,
    serialNumber: clean(port.serialNumber),
    vendorId: normalizeUsbId(port.vendorId),
    productId: normalizeUsbId(port.productId),
    updatedAt: new Date().toISOString()
  }
  await mkdir(dirname(identityPath(app)), { recursive: true })
  await writeFile(identityPath(app), `${JSON.stringify(identity, null, 2)}\n`, 'utf8')
}

// Identify the SIM-X box by its STABLE USB identity, never by the COM path:
// Windows reassigns COM numbers on every reconnect (COM18 → COM7 → COM17…), so a
// path-first match would lose the device the moment it re-enumerates elsewhere.
//
// Priority:
//   1. vendorId AND productId (AND serialNumber when it was recorded) — the
//      stable USB identity. A recorded serial number must also match so two
//      otherwise-identical boards aren't confused.
//   2. COM path — ONLY as a last resort, for adapters that expose no USB ids at
//      all (nothing more stable to key on).
export function matchesSimXPrimaryIdentity(identity: SimXPrimaryIdentity, port: string, info?: PortInfo): boolean {
  const storedVid = normalizeUsbId(identity.vendorId)
  const storedPid = normalizeUsbId(identity.productId)
  const storedSerial = clean(identity.serialNumber)

  if (storedVid && storedPid) {
    const targetVid = normalizeUsbId(info?.vendorId)
    const targetPid = normalizeUsbId(info?.productId)
    if (targetVid !== storedVid || targetPid !== storedPid) return false
    // Only enforce the serial number when we actually recorded one; otherwise
    // vendor+product is the strongest identity we have.
    if (storedSerial) return clean(info?.serialNumber) === storedSerial
    return true
  }

  // Fallback: nothing but a COM path to go on (USB ids absent at save time).
  return identity.path === port
}

function identityPath(app: App): string {
  return join(app.getPath('userData'), SIMX_PRIMARY_IDENTITY_FILE)
}

function clean(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeUsbId(value: unknown): string | undefined {
  const cleaned = clean(value)
  return cleaned?.toLowerCase().replace(/^0x/, '')
}
