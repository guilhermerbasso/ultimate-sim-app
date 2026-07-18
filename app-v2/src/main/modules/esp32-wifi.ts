import { SerialPort } from '../serial/serialport-runtime'
import { COMPANION_BAUD, COMPANION_QUERY_COMMAND } from '../../shared/companion'
import type { FlashProgress } from '../../shared/setup'
import type { ModuleContext } from '../module-context'
import {
  WifiTransport,
  discoverWifiCompanions,
  type WifiCompanionDevice,
  type WifiTransportStatus
} from '../serial/wifi-transport'
import { flashEsp32Firmware, resolveCompanionEsp32SketchPath } from '../devices/flasher'
import { isBenignSerialError, serialErrorMessage } from '../serial/errors'

const CHANNELS = {
  discover: 'esp32:discover',
  connect: 'esp32:connect',
  disconnect: 'esp32:disconnect',
  send: 'esp32:send',
  status: 'esp32:status',
  provisionOverUsb: 'esp32:provisionOverUsb',
  statusChanged: 'esp32:statusChanged',
  line: 'esp32:line',
  progress: 'esp32:progress'
} as const

interface ConnectRequest {
  id?: string
  host: string
  port?: number
  name?: string
}

interface ProvisionRequest {
  port: string
  ssid: string
  password: string
  board?: 'esp32' | 'esp32s3'
  flash?: boolean
}

interface ProvisionResult {
  ok: boolean
  message: string
}

const transports = new Map<string, WifiTransport>()

export function register(ctx: ModuleContext): void {
  ctx.ipcMain.handle(CHANNELS.discover, async () => discoverWifiCompanionsSafe())
  ctx.ipcMain.handle(CHANNELS.connect, async (_event, request: ConnectRequest) => connect(ctx, request))
  ctx.ipcMain.handle(CHANNELS.disconnect, async (_event, id?: string) => disconnect(ctx, id))
  ctx.ipcMain.handle(CHANNELS.send, async (_event, id: string, line: string) => send(id, line))
  ctx.ipcMain.handle(CHANNELS.status, () => getStatuses())
  ctx.ipcMain.handle(CHANNELS.provisionOverUsb, async (_event, request: ProvisionRequest) => provisionOverUsb(ctx, request))
}

// SSRF guard: only allow connecting to a local-network ESP32 (private LAN IP or
// an mDNS *.local name) on a valid port — never loopback or a public host.
function isAllowedEsp32Target(host: string, port: number): boolean {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false
  const h = host.toLowerCase()
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return false
  if (/^[a-z0-9][a-z0-9-]*\.local$/.test(h)) return true
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const o = m.slice(1).map(Number)
  if (o.some((x) => x < 0 || x > 255)) return false
  const [a, b] = o
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
}

async function discoverWifiCompanionsSafe(): Promise<WifiCompanionDevice[]> {
  try {
    return await discoverWifiCompanions()
  } catch (error) {
    console.warn('[esp32-wifi] discovery failed:', error instanceof Error ? error.message : error)
    return []
  }
}

async function connect(ctx: ModuleContext, request: ConnectRequest): Promise<WifiTransportStatus> {
  const host = String(request?.host ?? '').trim()
  if (!host) throw new Error('Enter the ESP32 host/IP.')
  const port = Number(request?.port ?? 47650)
  if (!isAllowedEsp32Target(host, port)) {
    throw new Error('Invalid host/port. Use the local network (LAN) IP or the ESP32 .local name, with port 1–65535.')
  }
  const id = request?.id || `${host}:${port}`
  const existing = transports.get(id)
  if (existing) return existing.status().connected ? existing.status() : existing.connect()

  const transport = new WifiTransport(id, host, port)
  transports.set(id, transport)
  transport.on('line', (line) => ctx.broadcast(CHANNELS.line, { id, line, at: new Date().toISOString() }))
  transport.on('status', (status) => ctx.broadcast(CHANNELS.statusChanged, status))
  try {
    const status = await transport.connect()
    transport.send(COMPANION_QUERY_COMMAND)
    ctx.broadcast(CHANNELS.statusChanged, status)
    return status
  } catch (error) {
    transports.delete(id)
    throw new Error(`Could not connect to the ESP32 over Wi‑Fi: ${errMessage(error)}`)
  }
}

async function disconnect(ctx: ModuleContext, id?: string): Promise<WifiTransportStatus[]> {
  if (id) {
    transports.get(id)?.disconnect()
    transports.delete(id)
  } else {
    for (const transport of transports.values()) transport.disconnect()
    transports.clear()
  }
  const statuses = getStatuses()
  ctx.broadcast(CHANNELS.statusChanged, statuses)
  return statuses
}

function send(id: string, line: string): WifiTransportStatus {
  const transport = transports.get(id)
  if (!transport) throw new Error('ESP32 Wi‑Fi not connected.')
  transport.send(line)
  return transport.status()
}

function getStatuses(): WifiTransportStatus[] {
  return Array.from(transports.values()).map((transport) => transport.status())
}

async function provisionOverUsb(ctx: ModuleContext, request: ProvisionRequest): Promise<ProvisionResult> {
  const port = String(request?.port ?? '').trim()
  const ssid = String(request?.ssid ?? '').trim()
  const password = String(request?.password ?? '')
  const board = request?.board === 'esp32' ? 'esp32' : 'esp32s3'
  if (!port) return { ok: false, message: 'Select the ESP32 USB/serial port.' }
  if (!ssid) return { ok: false, message: 'Enter the 2.4 GHz Wi‑Fi network SSID.' }

  try {
    const emit = (progress: FlashProgress): void => ctx.broadcast(CHANNELS.progress, progress)
    if (request?.flash !== false) {
      await flashEsp32Firmware({
        boardId: board,
        port,
        sketchPath: resolveCompanionEsp32SketchPath(ctx.app),
        onProgress: emit
      })
    }
    await pushWifiCredentials(port, ssid, password)
    return {
      ok: true,
      message: 'Wi?Fi credentials sent. Restart the ESP32 and use Discover to connect over the network.'
    }
  } catch (error) {
    return { ok: false, message: errMessage(error) }
  }
}

function pushWifiCredentials(path: string, ssid: string, password: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const port = new SerialPort({ path, baudRate: COMPANION_BAUD, autoOpen: false })
    let timer: NodeJS.Timeout | undefined
    let settled = false

    const cleanup = (): void => {
      if (timer) clearTimeout(timer)
      port.removeAllListeners()
      // Keep an error sink on the closing port so a late abort can't crash main.
      port.on('error', () => undefined)
      if (port.isOpen) port.close(() => undefined)
    }
    const done = (error?: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve()
    }

    // Handle async serial errors (e.g. the Windows "Operation aborted" when the
    // ESP32 resets/drops mid-write) instead of letting them become uncaught.
    port.on('error', (error) => {
      if (isBenignSerialError(error)) {
        done()
        return
      }
      done(new Error(`Serial port error during USB provisioning: ${serialErrorMessage(error)}`))
    })

    timer = setTimeout(() => done(new Error('Tempo esgotado ao provisionar Wi‑Fi via USB.')), 8000)

    port.open((openError) => {
      if (openError) {
        done(new Error(`Could not open ${path}: ${openError.message}`))
        return
      }
      const payload = `WIFI:${encodeField(ssid)}:${encodeField(password)}\n`
      try {
        port.write(payload, (writeError) => {
          if (writeError) {
            if (isBenignSerialError(writeError)) done()
            else done(new Error(`Failed to send Wi‑Fi credentials: ${writeError.message}`))
            return
          }
          port.drain((drainError) => {
            if (drainError && !isBenignSerialError(drainError)) {
              done(new Error(`Failed to finish USB send: ${drainError.message}`))
              return
            }
            done()
          })
        })
      } catch (error) {
        if (isBenignSerialError(error)) done()
        else done(new Error(`Failed to send Wi‑Fi credentials: ${serialErrorMessage(error)}`))
      }
    })
  })
}

function encodeField(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
