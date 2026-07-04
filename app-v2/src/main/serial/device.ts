import { EventEmitter } from 'node:events'
import { ReadlineParser, SerialPort } from 'serialport'
import type { DeviceInfo, EncoderEvent } from '../../shared/ipc'
import type {
  SerialDeviceKind,
  SerialDeviceSummary,
  SerialLogEntry,
  SerialTxOrigin
} from '../../shared/arduino'
import {
  formatBigNum,
  formatOled,
  formatRevLevel,
  formatShiftBlink,
  formatStartLed,
  parseEncoderLine
} from '../protocol'
import { COMPANION_V2_MAX_COMMAND_LEN, COMPANION_V2_MAX_STREAM_LEN } from '../../shared/companion'
import { isBenignSerialError, serialErrorMessage } from './errors'
import { logger } from '../modules/logger'

// A `P` pixel-stream frame can be 385 chars; truncate verbose TX logs to a small
// prefix + length so the diagnostic capture stays readable on the hot path.
const TX_LOG_HEAD = 24

const PORT_BUSY_MESSAGE = 'Feche o SimHub para usar o ButtonBox no app'
const OPEN_SETTLE_MS = 400
const DEFAULT_BAUD = 115200
const DEFAULT_LOG_LIMIT = 200

// Windows binding adds friendlyName/pnpId; bindings-interface doesn't declare
// them, so we read them with a defensive cast (same shape as listPorts uses).
type RawPort = Awaited<ReturnType<typeof SerialPort.list>>[number] & {
  friendlyName?: string
  pnpId?: string
}

export interface SerialDeviceOpenOptions {
  // Stable identifier inside the hub. Sim-X box uses 'simx'; other devices get
  // hub-allocated ids like 'gen-1'.
  id: string
  path: string
  kind?: SerialDeviceKind
  label?: string
  baud?: number
  // Toggle DTR/RTS after open + wait OPEN_SETTLE_MS. Required for Pro Micro
  // (the SIM-X box) which only starts TX on DTR assertion. Generic CDC devices
  // can opt out.
  assertSignals?: boolean
  // Per-device rx/tx ring buffer length. Tunable so noisy devices don't grow
  // memory forever.
  logLimit?: number
}

export type SerialDeviceEvent = 'rx' | 'tx' | 'connect' | 'disconnect' | 'error' | 'encoder'

// One open serial port + parser + the SimHub one-letter protocol. Owns its
// own EventEmitter so the SerialHub can host multiple devices in parallel and
// have each speak independently. The SerialManager facade binds to the
// PRIMARY device (the SIM-X box) and re-emits its events for legacy callers.
export class SerialDevice extends EventEmitter {
  readonly id: string
  readonly kind: SerialDeviceKind
  readonly path: string
  readonly baud: number
  readonly label: string

  private port: SerialPort | null = null
  private parser: ReadlineParser | null = null
  private device: DeviceInfo | null = null
  private opQueue: Promise<void> = Promise.resolve()
  private readonly log: SerialLogEntry[] = []
  private logSeq = 0
  private readonly logLimit: number
  private readonly assertSignals: boolean

  constructor(opts: SerialDeviceOpenOptions) {
    super()
    this.id = opts.id
    this.kind = opts.kind ?? 'generic'
    this.path = opts.path
    this.baud = opts.baud ?? DEFAULT_BAUD
    this.label = opts.label ?? (this.kind === 'sim-x' ? 'SIM-X Button Box' : opts.path)
    this.logLimit = Math.max(1, opts.logLimit ?? DEFAULT_LOG_LIMIT)
    this.assertSignals = opts.assertSignals !== false
  }

  isOpen(): boolean {
    return Boolean(this.port?.isOpen)
  }

  getDeviceInfo(): DeviceInfo | null {
    return this.device
  }

  getLog(): SerialLogEntry[] {
    return [...this.log]
  }

  clearLog(): void {
    this.log.length = 0
  }

  getSummary(): SerialDeviceSummary {
    return {
      id: this.id,
      path: this.path,
      label: this.label,
      kind: this.kind,
      baud: this.baud,
      connected: this.isOpen(),
      device: this.device ?? undefined
    }
  }

  async open(): Promise<DeviceInfo> {
    return this.enqueue(async () => {
      if (this.port?.isOpen && this.device) return this.device
      const meta = await this.findPortMeta()
      const port = new SerialPort({
        path: this.path,
        baudRate: this.baud,
        dataBits: 8,
        parity: 'none',
        stopBits: 1,
        autoOpen: false
      })
      // Attach an error sink BEFORE opening. An async serial 'error' (notably the
      // Windows "Operation aborted" raised when a pending I/O is cancelled during
      // open/close) emitted on a listener-less stream would become an uncaught
      // exception and crash the whole main process.
      port.on('error', (error) => this.handlePortError(error))
      const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }))

      try {
        await openPortAsync(port)
        if (this.assertSignals) {
          await setSignalsAsync(port, { dtr: true, rts: true })
          await delay(OPEN_SETTLE_MS)
        }

        const friendly = meta?.friendlyName
        const device: DeviceInfo = {
          path: this.path,
          name: this.kind === 'sim-x' ? 'SIM-X Button Box' : this.label,
          friendlyName: friendly,
          manufacturer: meta?.manufacturer ?? undefined,
          firmwareVersion: this.kind === 'sim-x' ? 'SIM-X (SimHub serial)' : undefined,
          protocolVersion: this.kind === 'sim-x' ? 1 : undefined,
          encoders: this.kind === 'sim-x' ? 4 : undefined,
          switches: this.kind === 'sim-x' ? 0 : undefined,
          hidButtons: this.kind === 'sim-x' ? 32 : undefined,
          connectedAt: new Date().toISOString()
        }

        parser.on('data', (line: string | Buffer) => this.handleSerialLine(String(line)))
        port.on('close', () => this.handlePortClosed())

        this.port = port
        this.parser = parser
        this.device = device
        this.emit('connect', device)
        logger.info('serial', 'device connected', {
          id: this.id,
          label: this.label,
          path: this.path,
          baud: this.baud,
          kind: this.kind
        })
        return device
      } catch (error) {
        this.detachPort(port, parser)
        if (port.isOpen) await closePortAsync(port).catch(() => undefined)
        throw normalizeError(error)
      }
    })
  }

  async close(): Promise<void> {
    await this.enqueue(() => this.closeInternal())
  }

  // ─── SimHub protocol writes (same wire format used by SIM-X) ────────────────
  // Generic devices can still use these if they happen to speak the same
  // protocol; otherwise call sendRaw with their own command strings.
  async sendRevLevel(level: number): Promise<void> {
    await this.write(formatRevLevel(level))
  }

  async sendShiftBlink(active: boolean): Promise<void> {
    await this.write(formatShiftBlink(active))
  }

  async sendOled(line1: string, line2: string, line3: string): Promise<void> {
    await this.write(formatOled(line1, line2, line3))
  }

  async sendBigNum(value: string): Promise<void> {
    await this.write(formatBigNum(value))
  }

  async sendStartLed(on: boolean): Promise<void> {
    await this.write(formatStartLed(on))
  }

  // Send an arbitrary one-shot command. Appends '\n' and guards the SIM-X
  // firmware's 64-byte serialBuf (≤63 chars before newline). The same
  // 63-char ceiling is a sane default for any small MCU; if a custom device
  // needs a different limit, expose a dedicated method later.
  async sendRaw(command: string, origin: SerialTxOrigin = 'engine'): Promise<void> {
    const trimmed = command.replace(/[\r\n]+$/, '')
    if (!trimmed) return
    // SIM-X firmware has a 64-byte serial buffer (≤63 before newline). Generic
    // companion firmware uses a larger line buffer, so allow longer v2 frames there.
    // A `P` pixel-stream frame is the exception: generic matrix firmware consumes it
    // character-by-character into a pixel accumulator (it never enters the line
    // buffer), so it is NOT bounded by the line ceiling. Letting a full 64-LED panel
    // (`P` + 384 hex = 385 chars) through as ONE atomic frame is what makes the
    // in-app TEST and the live custom-map path render without dropping a row.
    let limit = this.kind === 'sim-x' ? 63 : COMPANION_V2_MAX_COMMAND_LEN
    if (this.kind !== 'sim-x' && trimmed[0] === 'P') {
      limit = COMPANION_V2_MAX_STREAM_LEN
    }
    if (trimmed.length > limit) {
      throw new Error(`Comando excede o buffer serial do firmware (máx. ${limit} caracteres).`)
    }
    await this.write(`${trimmed}\n`, origin)
  }

  // ─── Internals ──────────────────────────────────────────────────────────────
  private async write(payload: string, origin: SerialTxOrigin = 'engine'): Promise<void> {
    const port = this.port
    if (!port || !port.isOpen) {
      throw new Error(`Dispositivo "${this.label}" não conectado.`)
    }
    try {
      await new Promise<void>((resolve, reject) => {
        port.write(payload, 'ascii', (writeError) => {
          if (writeError) {
            reject(normalizeError(writeError))
            return
          }
          port.drain((drainError) => {
            if (drainError) {
              reject(normalizeError(drainError))
              return
            }
            const text = payload.replace(/[\r\n]+$/, '')
            this.recordLog('tx', text, origin)
            this.emit('tx', text, origin)
            logger.verbose('serial', 'tx', {
              id: this.id,
              origin,
              head: text.slice(0, TX_LOG_HEAD),
              len: text.length
            })
            resolve()
          })
        })
      })
    } catch (error) {
      // A write/drain that aborts because the port is closing/cancelling (the
      // Windows "GetOverlappedResult: Operation aborted" case during a
      // flash/cancel or disconnect) is benign: the device is going away, so
      // swallow it (logged) instead of letting it bubble into an unhandled
      // rejection that could crash main. Genuine failures still surface.
      if (isBenignSerialError(error)) {
        console.warn(`[serial:${this.id}] write aborted (port closing):`, serialErrorMessage(error))
        logger.verbose('serial', 'write aborted (port closing)', {
          id: this.id,
          origin,
          message: serialErrorMessage(error)
        })
        return
      }
      logger.warn('serial', 'write failed', { id: this.id, origin, message: serialErrorMessage(error) })
      throw normalizeError(error)
    }
  }

  private handleSerialLine(raw: string): void {
    const normalized = raw.replace(/\r$/, '').trim()
    if (!normalized) return
    this.recordLog('rx', normalized)
    this.emit('rx', normalized)
    logger.verbose('serial', 'rx', { id: this.id, line: normalized })
    // Encoder parsing is only meaningful for the SIM-X firmware. Generic
    // devices opt in by parsing their own rx stream — keeps the hub honest
    // about what 'encoder' means on this device.
    if (this.kind === 'sim-x') {
      const encoder = parseEncoderLine(normalized)
      if (encoder) {
        const event: EncoderEvent = { index: encoder.index, direction: encoder.direction }
        this.emit('encoder', event)
      }
    }
  }

  private handlePortError(error: Error): void {
    const normalized = normalizeError(error)
    if (isBenignSerialError(normalized)) {
      // Port aborted/closed underneath us (cancel/disconnect/teardown). Log and
      // let the normal close flow run; never surface as a hard error.
      console.warn(`[serial:${this.id}] benign port error (ignored):`, serialErrorMessage(normalized))
      logger.verbose('serial', 'benign port error (ignored)', {
        id: this.id,
        message: serialErrorMessage(normalized)
      })
    } else {
      console.error(`[serial:${this.id}] port error:`, serialErrorMessage(normalized))
      logger.warn('serial', 'port error', { id: this.id, message: serialErrorMessage(normalized) })
      // Notify listeners, but never let a missing 'error' listener anywhere in
      // the re-emit chain (e.g. the SerialManager facade, which has no 'error'
      // subscriber) bubble up as an uncaught exception that crashes main.
      try {
        this.emit('error', normalized)
      } catch (emitError) {
        console.warn(`[serial:${this.id}] error listener threw/absent:`, serialErrorMessage(emitError))
      }
    }
    void this.close().catch(() => undefined)
  }

  private handlePortClosed(): void {
    if (!this.port) return
    const device = this.device
    this.port = null
    this.parser = null
    this.device = null
    this.emit('disconnect', device)
    logger.info('serial', 'device disconnected', {
      id: this.id,
      label: this.label,
      reason: 'port-closed'
    })
  }

  private async closeInternal(): Promise<void> {
    const port = this.port
    const parser = this.parser
    const device = this.device
    if (!port) return
    this.port = null
    this.parser = null
    this.device = null
    this.detachPort(port, parser)
    if (port.isOpen) await closePortAsync(port).catch(() => undefined)
    this.emit('disconnect', device)
    logger.info('serial', 'device disconnected', {
      id: this.id,
      label: this.label,
      reason: 'closed'
    })
  }

  // Drop the active listeners but KEEP a benign error sink on the port for the
  // rest of its life, so a late async abort fired while/after closing can't be
  // emitted on a listener-less stream and crash main.
  private detachPort(port: SerialPort, parser: ReadlineParser | null): void {
    parser?.removeAllListeners()
    port.removeAllListeners()
    port.on('error', (error) => {
      if (!isBenignSerialError(error)) {
        console.warn(`[serial:${this.id}] port error during teardown:`, serialErrorMessage(error))
      }
    })
  }

  private async findPortMeta(): Promise<RawPort | undefined> {
    try {
      const ports = (await SerialPort.list()) as RawPort[]
      return ports.find((entry) => entry.path === this.path)
    } catch {
      return undefined
    }
  }

  private recordLog(dir: 'rx' | 'tx', text: string, origin?: SerialTxOrigin): void {
    const entry: SerialLogEntry = { seq: this.logSeq++, dir, text, origin, ts: Date.now() }
    this.log.push(entry)
    if (this.log.length > this.logLimit) this.log.splice(0, this.log.length - this.logLimit)
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.opQueue.catch(() => undefined).then(operation)
    this.opQueue = run.then(
      () => undefined,
      () => undefined
    )
    return run as Promise<T>
  }
}

// ─── Helpers (shared shape with the previous single-session manager) ──────────

function openPortAsync(port: SerialPort): Promise<void> {
  return new Promise((resolve, reject) => {
    port.open((error) => {
      if (error) reject(normalizeError(error))
      else resolve()
    })
  })
}

function setSignalsAsync(port: SerialPort, signals: { dtr: boolean; rts: boolean }): Promise<void> {
  return new Promise((resolve) => {
    port.set(signals, () => resolve())
  })
}

function closePortAsync(port: SerialPort): Promise<void> {
  return new Promise((resolve, reject) => {
    port.close((error) => {
      if (error) reject(normalizeError(error))
      else resolve()
    })
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeError(error: unknown): Error {
  if (isPortBusyError(error)) return new Error(PORT_BUSY_MESSAGE)
  if (error instanceof Error) return error
  return new Error(String(error))
}

function isPortBusyError(error: unknown): boolean {
  if (!error) return false
  const candidate = error as { code?: string; message?: string }
  const code = candidate.code?.toUpperCase() ?? ''
  const message = candidate.message?.toLowerCase() ?? String(error).toLowerCase()
  return (
    code === 'EACCES' ||
    code === 'EBUSY' ||
    message.includes('access denied') ||
    message.includes('permission denied') ||
    message.includes('resource busy') ||
    message.includes('semaphore') ||
    message.includes('busy')
  )
}
