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
  connected: boolean
  observedIdentity: string
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

export function desiredSerialIdentity(config: ConfiguredSerialIdentity): string {
  const vendorId = normalizeUsbId(config.vendorId)
  const productId = normalizeUsbId(config.productId)
  const serialNumber = normalizedSerial(config.serialNumber)
  const key = cleanText(config.id) || cleanText(config.path)?.toLowerCase() || 'unknown'
  if (vendorId || productId || serialNumber) {
    return `usb:vid=${vendorId || '?'};pid=${productId || '?'};serial=${serialNumber || '?'};key=${key}`
  }
  if (config.id) return `id:${config.id}`
  return `path:${config.path.toLowerCase()}`
}

export function observedSerialIdentity(
  port: ObservedSerialPortIdentity | undefined,
  observedPath?: string
): string {
  const path = cleanText(port?.path) || cleanText(observedPath)
  if (!path) return 'unobserved'
  return [
    `path=${path.toLowerCase()}`,
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
  const configuredIdentity = hasConfiguredSerialIdentity(config)
  let selected = direct

  if (configuredIdentity) {
    selected = direct && observedSerialMatchesConfigured(config, portFor(direct))
      ? direct
      : undefined
    if (!selected && normalizedSerial(config.serialNumber)) {
      selected = connected.find((device) =>
        observedSerialMatchesConfigured(config, portFor(device))
      )
    }
  }

  const observedDevice = selected ?? direct
  const observedPort =
    portFor(observedDevice) ??
    ports.find((port) => port.path === config.path)
  return {
    connected: Boolean(selected),
    observedIdentity: observedSerialIdentity(observedPort, observedDevice?.path)
  }
}
