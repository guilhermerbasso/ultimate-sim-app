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

export function profileCanMigrateWithSerialIdentity(
  profile: { deviceId?: string; port?: string },
  saved: SavedSerialIdentity
): boolean {
  const idMatches = Boolean(saved.id && profile.deviceId === saved.id)
  const pathMatches = profile.port === saved.path
  return (
    (idMatches || pathMatches) &&
    (!profile.deviceId || idMatches) &&
    (!profile.port || pathMatches)
  )
}

function serial(value: unknown): string | undefined {
  return cleanText(value)
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
  const saved = input.saved
    ? {
        vendorId: normalizeUsbId(input.saved.vendorId),
        productId: normalizeUsbId(input.saved.productId),
        serialNumber: serial(input.saved.serialNumber)
      }
    : {}
  const descriptors = [
    { label: 'VID', saved: saved.vendorId, observed: observed.vendorId, normalize: (value: string) => value },
    { label: 'PID', saved: saved.productId, observed: observed.productId, normalize: (value: string) => value },
    { label: 'serial', saved: saved.serialNumber, observed: observed.serialNumber, normalize: (value: string) => value.toLowerCase() }
  ]
  for (const descriptor of descriptors) {
    if (!descriptor.saved) continue
    if (!descriptor.observed) {
      return {
        state: 'unverified',
        message: `The OS did not report the saved ${descriptor.label}; the saved identity and path were not overwritten.`,
        record: null
      }
    }
    if (
      descriptor.normalize(descriptor.saved) !== descriptor.normalize(descriptor.observed)
    ) {
      return {
        state: 'mismatch',
        message: `The observed ${descriptor.label} does not match the saved identity; no configuration was updated.`,
        record: null
      }
    }
  }

  if (
    !input.allowUnboundMigration &&
    (!input.saved || !hasCompleteIdentity(input.saved))
  ) {
    return {
      state: 'unverified',
      message: 'Legacy identity is incomplete; explicit setup or manual reconnect is required before migration.',
      record: null
    }
  }
  const record: SerialIdentityMigrationRecord = {
    id: connected.id,
    path: connected.path,
    vendorId: saved.vendorId ?? observed.vendorId,
    productId: saved.productId ?? observed.productId,
    serialNumber: saved.serialNumber ?? observed.serialNumber
  }
  return hasCompleteIdentity(record)
    ? {
        state: 'verified',
        message: input.saved
          ? 'All saved descriptors matched and missing VID/PID/serial fields were safely enriched.'
          : 'Observed VID/PID/serial was captured from the actual connected port.',
        record
      }
    : {
        state: 'unverified',
        message: 'The actual connected port was saved, but complete VID/PID/serial metadata is unavailable; Rig Preflight remains unverified.',
        record
      }
}
