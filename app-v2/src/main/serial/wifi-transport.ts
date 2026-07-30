import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import net from 'node:net'

const requireFromHere = createRequire(import.meta.url)
const DEFAULT_SERVICE_TYPE = 'ubbcompanion'
const DEFAULT_SERVICE_PROTOCOL = 'tcp'
const DEFAULT_SCAN_MS = 2500
const DEFAULT_PORT = 47650
const MAX_RX_BUFFER = 16 * 1024

export interface WifiCompanionDevice {
  id: string
  name: string
  host: string
  port: number
  addresses: string[]
  txt?: Record<string, string>
}

export interface WifiTransportStatus {
  id: string
  host: string
  port: number
  connected: boolean
  connecting: boolean
  lastLineAt?: string
  error?: string
}

interface BonjourService {
  name?: string
  fqdn?: string
  host?: string
  port?: number
  addresses?: string[]
  txt?: Record<string, unknown> | string[]
}

interface BonjourBrowser extends EventEmitter {
  stop?: () => void
}

interface BonjourInstance {
  find: (opts: { type: string; protocol?: string }) => BonjourBrowser
  destroy?: () => void
}

type BonjourCtor = new () => BonjourInstance

export class WifiTransport extends EventEmitter {
  private socket: net.Socket | null = null
  private rxBuffer = ''
  private connected = false
  private connecting = false
  private error: string | undefined
  private lastLineAt: string | undefined

  constructor(
    readonly id: string,
    readonly host: string,
    readonly port: number = DEFAULT_PORT
  ) {
    super()
  }

  status(): WifiTransportStatus {
    return {
      id: this.id,
      host: this.host,
      port: this.port,
      connected: this.connected,
      connecting: this.connecting,
      lastLineAt: this.lastLineAt,
      error: this.error
    }
  }

  async connect(timeoutMs = 6000): Promise<WifiTransportStatus> {
    if (this.connected) return this.status()
    if (this.connecting) throw new Error('Wi‑Fi connection is already in progress.')
    this.connecting = true
    this.error = undefined
    this.emitStatus()

    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port })
      this.socket = socket
      socket.setEncoding('utf8')
      socket.setKeepAlive(true, 10_000)

      const timer = setTimeout(() => {
        socket.destroy(new Error('Timed out connecting to the ESP32 over Wi-Fi.'))
      }, timeoutMs)

      const settle = (fn: () => void): void => {
        clearTimeout(timer)
        fn()
      }

      socket.on('connect', () => {
        settle(() => {
          this.connected = true
          this.connecting = false
          this.emitStatus()
          resolve()
        })
      })
      socket.on('data', (chunk: string | Buffer) => this.handleData(String(chunk)))
      socket.on('error', (error) => {
        this.error = error.message
        if (this.connecting) {
          settle(() => {
            this.connecting = false
            reject(error)
          })
        }
        this.emitStatus()
      })
      socket.on('close', () => {
        this.connected = false
        this.connecting = false
        this.socket = null
        this.emitStatus()
      })
    })

    return this.status()
  }

  send(line: string): void {
    if (!this.socket || !this.connected) throw new Error('ESP32 Wi‑Fi is not connected.')
    // Strip ALL newlines (prevent TCP command smuggling) and cap the length.
    const clean = String(line).replace(/[\r\n]/g, '').slice(0, 256)
    this.socket.write(`${clean}\n`)
  }

  disconnect(): void {
    const socket = this.socket
    this.socket = null
    this.connected = false
    this.connecting = false
    if (socket && !socket.destroyed) socket.end()
    this.emitStatus()
  }

  onLine(callback: (line: string) => void): () => void {
    this.on('line', callback)
    return () => this.off('line', callback)
  }

  private handleData(chunk: string): void {
    this.rxBuffer += chunk
    if (this.rxBuffer.length > MAX_RX_BUFFER) this.rxBuffer = this.rxBuffer.slice(-MAX_RX_BUFFER)
    let idx = this.rxBuffer.search(/[\r\n]/)
    while (idx >= 0) {
      const line = this.rxBuffer.slice(0, idx).trim()
      this.rxBuffer = this.rxBuffer.slice(idx + 1).replace(/^\n/, '')
      if (line) {
        this.lastLineAt = new Date().toISOString()
        this.emit('line', line)
      }
      idx = this.rxBuffer.search(/[\r\n]/)
    }
  }

  private emitStatus(): void {
    this.emit('status', this.status())
  }
}

export async function discoverWifiCompanions(timeoutMs = DEFAULT_SCAN_MS): Promise<WifiCompanionDevice[]> {
  const Bonjour = loadBonjour()
  if (!Bonjour) return []

  const bonjour = new Bonjour()
  const found = new Map<string, WifiCompanionDevice>()
  let browser: BonjourBrowser | null = null

  try {
    browser = bonjour.find({ type: DEFAULT_SERVICE_TYPE, protocol: DEFAULT_SERVICE_PROTOCOL })
    browser.on('up', (service: BonjourService) => {
      const device = normalizeService(service)
      if (device) found.set(device.id, device)
    })
    await delay(timeoutMs)
    return Array.from(found.values()).sort((a, b) => a.name.localeCompare(b.name))
  } finally {
    try {
      browser?.stop?.()
    } catch {
      // best-effort cleanup
    }
    try {
      bonjour.destroy?.()
    } catch {
      // best-effort cleanup
    }
  }
}

function normalizeService(service: BonjourService): WifiCompanionDevice | null {
  const port = Number(service.port)
  const addresses = Array.isArray(service.addresses) ? service.addresses.filter((a) => typeof a === 'string') : []
  const host = addresses.find((a) => !a.includes(':')) ?? service.host ?? addresses[0]
  if (!host || !Number.isInteger(port) || port <= 0) return null
  const txt = normalizeTxt(service.txt)
  const name = service.name || txt.name || 'Ultimate Sim App ESP32'
  const id = txt.id || service.fqdn || `${name}@${host}:${port}`
  return { id, name, host, port, addresses, txt }
}

function normalizeTxt(txt: BonjourService['txt']): Record<string, string> {
  if (!txt) return {}
  if (Array.isArray(txt)) {
    return Object.fromEntries(
      txt
        .map((entry) => String(entry).split('='))
        .filter((pair): pair is [string, string] => Boolean(pair[0] && pair[1]))
    )
  }
  return Object.fromEntries(
    Object.entries(txt)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)])
  )
}

function loadBonjour(): BonjourCtor | null {
  try {
    const mod = requireFromHere('bonjour-service') as { Bonjour?: BonjourCtor; default?: BonjourCtor }
    return mod.Bonjour ?? mod.default ?? null
  } catch {
    return null
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
