import { cleanText, normalizeUsbId } from '../../shared/generic-autostart'

export interface ConfiguredSerialIdentity {
  id?: string
  path: string
  vendorId?: string
  productId?: string
  serialNumber?: string
}

export interface LiveSerialIdentity {
  id: string
  path: string
  connected: boolean
}

export interface ObservedSerialPortIdentity {
  path: string
  vendorId?: string
  productId?: string
  serialNumber?: string
}

export interface ConfiguredSerialEvidence {
  state: 'verified' | 'unknown' | 'fail'
  observedIdentity: string
  reason: string
}

function normalizedSerial(value: unknown): string | undefined {
  return cleanText(value)?.toLowerCase()
}

export function hasConfiguredSerialIdentity(config: ConfiguredSerialIdentity): boolean {
  return Boolean(
    normalizeUsbId(config.vendorId) ||
    normalizeUsbId(config.productId) ||
    normalizedSerial(config.serialNumber)
  )
}

export function hasCompleteConfiguredSerialIdentity(config: ConfiguredSerialIdentity): boolean {
  return Boolean(
    normalizeUsbId(config.vendorId) &&
    normalizeUsbId(config.productId) &&
    normalizedSerial(config.serialNumber)
  )
}

export function desiredSerialIdentity(config: ConfiguredSerialIdentity): string {
  const vendorId = normalizeUsbId(config.vendorId)
  const productId = normalizeUsbId(config.productId)
  const serialNumber = normalizedSerial(config.serialNumber)
  const key = cleanText(config.id) || cleanText(config.path)?.toLowerCase() || 'unknown'
  if (vendorId && productId && serialNumber) {
    return `usb:vid=${vendorId || '?'};pid=${productId || '?'};serial=${serialNumber || '?'}`
  }
  if (vendorId || productId || serialNumber) {
    return `usb:vid=${vendorId || '?'};pid=${productId || '?'};serial=${serialNumber || '?'};unboundKey=${key}`
  }
  return `unbound:key=${key}`
}

export function observedSerialIdentity(
  port: ObservedSerialPortIdentity | undefined,
  observedPath?: string
): string {
  const path = cleanText(port?.path) || cleanText(observedPath)
  if (!path) return 'unobserved'
  return [
    `vid=${normalizeUsbId(port?.vendorId) || '?'}`,
    `pid=${normalizeUsbId(port?.productId) || '?'}`,
    `serial=${normalizedSerial(port?.serialNumber) || '?'}`
  ].join(';')
}

export function observedSerialMatchesConfigured(
  config: ConfiguredSerialIdentity,
  port: ObservedSerialPortIdentity | undefined
): boolean {
  if (!port) return false
  const vendorId = normalizeUsbId(config.vendorId)
  const productId = normalizeUsbId(config.productId)
  const serialNumber = normalizedSerial(config.serialNumber)
  if (vendorId && normalizeUsbId(port.vendorId) !== vendorId) return false
  if (productId && normalizeUsbId(port.productId) !== productId) return false
  if (serialNumber && normalizedSerial(port.serialNumber) !== serialNumber) return false
  return true
}

export function resolveConfiguredSerialEvidence(
  config: ConfiguredSerialIdentity,
  live: readonly LiveSerialIdentity[],
  ports: readonly ObservedSerialPortIdentity[]
): ConfiguredSerialEvidence {
  const connected = live.filter((device) => device.connected)
  const portFor = (device: LiveSerialIdentity | undefined): ObservedSerialPortIdentity | undefined =>
    device ? ports.find((port) => port.path === device.path) : undefined
  const direct = connected.find(
    (device) => (config.id && device.id === config.id) || device.path === config.path
  )
  const stable = hasCompleteConfiguredSerialIdentity(config)
    ? connected.find((device) =>
        observedSerialMatchesConfigured(config, portFor(device))
      )
    : undefined
  const selected = stable ?? direct
  const observedDevice = selected ?? direct
  const observedPort =
    portFor(observedDevice) ??
    ports.find((port) => port.path === config.path)
  const observedIdentity = observedSerialIdentity(observedPort, observedDevice?.path)
  if (!selected) {
    return {
      state: 'fail',
      observedIdentity,
      reason: 'Configured device is not connected.'
    }
  }

  const configuredVendorId = normalizeUsbId(config.vendorId)
  const configuredProductId = normalizeUsbId(config.productId)
  const configuredSerialNumber = normalizedSerial(config.serialNumber)
  const observedVendorId = normalizeUsbId(observedPort?.vendorId)
  const observedProductId = normalizeUsbId(observedPort?.productId)
  const observedSerialNumber = normalizedSerial(observedPort?.serialNumber)
  if (!observedPort || !observedVendorId || !observedProductId) {
    return {
      state: 'unknown',
      observedIdentity,
      reason: 'The OS did not report stable USB VID and PID metadata for the connected device.'
    }
  }
  if (!configuredVendorId || !configuredProductId) {
    return {
      state: 'unknown',
      observedIdentity,
      reason: 'Saved configuration lacks VID/PID binding; reconnect or re-add the device to migrate it.'
    }
  }
  if (
    configuredVendorId !== observedVendorId ||
    configuredProductId !== observedProductId
  ) {
    return {
      state: 'fail',
      observedIdentity,
      reason: 'Observed USB VID/PID does not match the saved hardware identity.'
    }
  }
  if (!configuredSerialNumber) {
    return {
      state: 'unknown',
      observedIdentity,
      reason: observedSerialNumber
        ? 'A USB serial is available but is not bound in saved configuration; reconnect or re-add the device.'
        : 'This hardware exposes no USB serial identity; use an existing governed preflight waiver if operation is explicitly approved.'
    }
  }
  if (!observedSerialNumber) {
    return {
      state: 'unknown',
      observedIdentity,
      reason: 'Saved configuration requires a USB serial, but the OS did not report one.'
    }
  }
  if (configuredSerialNumber !== observedSerialNumber) {
    return {
      state: 'fail',
      observedIdentity,
      reason: 'Observed USB serial does not match the saved hardware identity.'
    }
  }
  return {
    state: 'verified',
    observedIdentity,
    reason: 'Observed VID, PID, and serial match the saved hardware identity.'
  }
}
