import { isIP } from 'node:net'
import type { ObsLocalConnectArgs } from '../../shared/obs-local'

export const DEFAULT_OBS_WEBSOCKET_PORT = 4455

export interface ResolvedObsEndpoint {
  endpoint: string
  host: string
  port: number
  loopback: boolean
  explicitNonLoopback: boolean
}

function normalizeHost(value: string | undefined): string {
  const trimmed = value?.trim() || '127.0.0.1'
  const unwrapped = trimmed.startsWith('[') && trimmed.endsWith(']')
    ? trimmed.slice(1, -1)
    : trimmed
  if (!unwrapped || /[\u0000-\u001f\u007f/?#@]/.test(unwrapped) || unwrapped.includes('://')) {
    throw new Error('OBS host must be a hostname or IP address without a URL scheme, path, or credentials.')
  }
  if (unwrapped.includes(':') && isIP(unwrapped) !== 6) {
    throw new Error('OBS host contains an invalid port or IPv6 address.')
  }
  return unwrapped
}

function normalizePort(value: number | undefined): number {
  const port = value ?? DEFAULT_OBS_WEBSOCKET_PORT
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('OBS WebSocket port must be an integer from 1 to 65535.')
  }
  return port
}

export function isLoopbackObsHost(value: string): boolean {
  const host = value.toLowerCase()
  if (host === 'localhost' || host === '::1') return true
  if (isIP(host) !== 4) return false
  return host.startsWith('127.')
}

export function resolveObsEndpoint(args: ObsLocalConnectArgs): ResolvedObsEndpoint {
  const host = normalizeHost(args.host)
  const port = normalizePort(args.port)
  const loopback = isLoopbackObsHost(host)
  if (!loopback && args.allowNonLoopback !== true) {
    throw new Error('Local OBS control is loopback-only. Enable the explicit non-loopback override to use another host.')
  }
  const urlHost = isIP(host) === 6 ? `[${host}]` : host
  return {
    endpoint: `ws://${urlHost}:${port}`,
    host,
    port,
    loopback,
    explicitNonLoopback: !loopback
  }
}
