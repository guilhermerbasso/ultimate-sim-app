import { cleanText, normalizeUsbId } from '../../shared/generic-autostart'

export interface SavedSerialIdentity {
  id?: string
  path: string
  vendorId?: string
  productId?: string
  serialNumber?: string
}

export interface ConnectedSerialSummary {
  id: string
  path: string
  connected: boolean
}

export interface EnumeratedSerialPort {
  path: string
  vendorId?: string
  productId?: string
  serialNumber?: string
}

export interface SerialIdentityMigrationRecord {
  id: string
  path: string
  vendorId?: string
  productId?: string
  serialNumber?: string
}

export interface SerialIdentityMigrationResult {
  state: 'verified' | 'unverified' | 'mismatch' | 'missing'
  message: string
  record: SerialIdentityMigrationRecord | null
}

function serial(value: unknown): string | undefined {
  return cleanText(value)
}

function serialKey(value: unknown): string | undefined {
  return serial(value)?.toLowerCase()
}

function hasCompleteIdentity(value: {
  vendorId?: string
  productId?: string
  serialNumber?: string
}): boolean {
  return Boolean(
    normalizeUsbId(value.vendorId) &&
    normalizeUsbId(value.productId) &&
    serial(value.serialNumber)
  )
}

export function resolveConnectedSerialIdentityMigration(input: {
  deviceId: string
  saved?: SavedSerialIdentity
  live: readonly ConnectedSerialSummary[]
  ports: readonly EnumeratedSerialPort[]
  allowUnboundMigration: boolean
}): SerialIdentityMigrationResult {
  const connected = input.live.find(
    (device) => device.id === input.deviceId && device.connected
  )
  if (!connected) {
    return {
      state: 'missing',
      message: 'The connected device disappeared before its serial identity could be observed.',
      record: null
    }
  }
  const port = input.ports.find((candidate) => candidate.path === connected.path)
  const observed = {
    vendorId: normalizeUsbId(port?.vendorId),
    productId: normalizeUsbId(port?.productId),
    serialNumber: serial(port?.serialNumber)
  }
  const record: SerialIdentityMigrationRecord = {
    id: connected.id,
    path: connected.path,
    vendorId: observed.vendorId,
    productId: observed.productId,
    serialNumber: observed.serialNumber
  }

  if (input.saved && hasCompleteIdentity(input.saved)) {
    if (!hasCompleteIdentity(observed)) {
      return {
        state: 'unverified',
        message: 'The OS did not report complete VID/PID/serial metadata; the saved identity and path were not overwritten.',
        record: null
      }
    }
    if (
      normalizeUsbId(input.saved.vendorId) !== observed.vendorId ||
      normalizeUsbId(input.saved.productId) !== observed.productId ||
      serialKey(input.saved.serialNumber) !== serialKey(observed.serialNumber)
    ) {
      return {
        state: 'mismatch',
        message: 'The reconnected device does not match the saved VID/PID/serial identity; no configuration was updated.',
        record: null
      }
    }
    return {
      state: 'verified',
      message: 'Observed VID/PID/serial matches the saved device identity.',
      record
    }
  }

  if (!input.allowUnboundMigration) {
    return {
      state: 'unverified',
      message: 'Legacy identity is incomplete; explicit setup or manual reconnect is required before migration.',
      record: null
    }
  }
  return hasCompleteIdentity(observed)
    ? {
        state: 'verified',
        message: 'Observed VID/PID/serial was captured from the actual connected port.',
        record
      }
    : {
        state: 'unverified',
        message: 'The actual connected port was saved, but complete VID/PID/serial metadata is unavailable; Rig Preflight remains unverified.',
        record
      }
}
