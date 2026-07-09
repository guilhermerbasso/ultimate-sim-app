// Arduino Setup Tool (main process). The SimHub-style "pick a module → flash
// prebuilt firmware → it just works" backend:
//
//   listFlashablePorts → reuse the serial hub port listing.
//   listModules        → the shared catalog (modules + boards).
//   flash(req)         → free the port, run avrdude (devices/flasher.ts) while
//                        streaming progress, then reopen the port, send `?`,
//                        read K:/KEND, and (only if the capability matches)
//                        auto-create a Hardware Hub DeviceProfile with the
//                        matching component linked to that port.
//
// Robustness: flash() RESOLVES with a structured FlashResult even on failure
// (never rejects → never crashes main), cleans up the verification serial
// handle, and never flashes the SIM-X primary.

import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { dialog } from 'electron'
import { ReadlineParser, SerialPort } from 'serialport'
import {
  COMPANION_BAUD,
  COMPANION_QUERY_COMMAND,
  isCapabilityEnd,
  parseCapabilityLine
} from '../../shared/companion'
import {
  DEVICES_CHANNELS,
  createComponent,
  type DeviceComponent,
  type DeviceProfile
} from '../../shared/devices'
import {
  SETUP_CHANNELS,
  SETUP_MODULES,
  FLASH_BOARDS,
  findFlashBaud,
  findFlashBoard,
  findModuleFirmware,
  findSetupModule,
  flashBaudCandidates,
  guessFlashBoardFromUsb,
  type DetectedCapability,
  type FlashBoardGuess,
  type FlashProgress,
  type FlashRequest,
  type FlashResult,
  type SetupModule,
  type UsbDescriptorLike
} from '../../shared/setup'
import type { ModuleContext } from '../module-context'
import type { PortInfo } from '../../shared/ipc'
import type { SerialDevice } from '../serial/device'
import { DeviceConfigStore, getDeviceConfigStore } from '../devices/store'
import { dumpHexFirmware } from '../devices/hex-dump'
import { isBenignSerialError, serialErrorMessage } from '../serial/errors'
import {
  abortableDelay,
  flashFirmware,
  isFlashAbortError,
  resolveFirmwarePath,
  resolveFlashToolPaths,
  throwIfAborted
} from '../devices/flasher'
import { SerialDevicesStore, getSerialDevicesStore } from '../serial-devices/store'
import {
  matchesSimXPrimaryIdentity,
  readSimXPrimaryIdentity,
  saveSimXPrimaryIdentity
} from '../serial-devices/simx-identity'

const VERIFY_BOOT_DELAY_MS = 1500
const VERIFY_TIMEOUT_MS = 8000
const VERIFY_QUERY_INTERVAL_MS = 700
const PORT_RELEASE_MS = 400
const IDENTIFY_BOOT_DELAY_MS = 350
const IDENTIFY_TIMEOUT_MS = 1300
const CANCEL_FLASH_CHANNEL = 'arduinosetup:cancelFlash'
const DUMP_HEX_CHANNEL = 'arduinosetup:dumpHex'

interface DumpHexRequest {
  board: string
  port: string
  baudId?: string
}

interface DumpHexResult {
  ok: boolean
  message: string
  path?: string
}

interface IdentifyResult {
  status: 'identified' | 'unknown' | 'busy' | 'error'
  label: string
  detail?: string
  capabilities?: DetectedCapability[]
  // True when the device answered the companion `?` query with K: capabilities.
  speaksCompanion?: boolean
  // True when it reported the rgbMatrix/iFlag capability specifically.
  speaksMatrix?: boolean
  // Best-effort board family guess from the USB descriptor (VID/PID/name). Lets
  // the wizard preselect the correct flash board (esp. 328P vs 32U4).
  boardGuess?: FlashBoardGuess
}

type IdentifiedPortInfo = PortInfo & { identify?: IdentifyResult }

class SetupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SetupError'
  }
}

export function register(ctx: ModuleContext): void {
  const setup = new ArduinoSetup(ctx)

  ctx.ipcMain.handle(SETUP_CHANNELS.listModules, () => ({ modules: SETUP_MODULES, boards: FLASH_BOARDS }))
  ctx.ipcMain.handle(SETUP_CHANNELS.listPorts, () => setup.listFlashablePorts())
  ctx.ipcMain.handle(SETUP_CHANNELS.flash, (_event, request: FlashRequest) => setup.flash(request))
  ctx.ipcMain.handle(CANCEL_FLASH_CHANNEL, () => setup.cancelFlash())
  ctx.ipcMain.handle(DUMP_HEX_CHANNEL, (_event, request: DumpHexRequest) => setup.dumpHex(request))
}

class ArduinoSetup {
  private readonly store: DeviceConfigStore
  private readonly serialDevicesStore: SerialDevicesStore
  private activeOperation: { controller: AbortController; label: string } | null = null

  constructor(private readonly ctx: ModuleContext) {
    this.store = getDeviceConfigStore(ctx.app)
    this.serialDevicesStore = getSerialDevicesStore(ctx.app)
  }

  async listFlashablePorts(): Promise<IdentifiedPortInfo[]> {
    const ports = await this.ctx.serialHub.listPorts()
    return Promise.all(ports.map((port) => this.withIdentify(port)))
  }

  async cancelFlash(): Promise<{ cancelled: boolean; message: string }> {
    const active = this.activeOperation
    if (!active) return { cancelled: false, message: 'No flash/backup operation in progress.' }
    active.controller.abort()
    const message = `${active.label} canceled by user.`
    this.ctx.broadcast(SETUP_CHANNELS.progress, {
      phase: 'error',
      message,
      percent: 100,
      tone: 'error'
    } satisfies FlashProgress)
    return { cancelled: true, message }
  }

  async dumpHex(request: DumpHexRequest): Promise<DumpHexResult> {
    const emit = (progress: FlashProgress): void => this.ctx.broadcast(SETUP_CHANNELS.progress, progress)
    const port = String(request?.port ?? '').trim()
    const board = findFlashBoard(request?.board ?? '')
    if (!board) return { ok: false, message: 'Board not supported for .hex backup.' }
    if (!port) return { ok: false, message: 'Select the board serial (COM) port.' }
    if (this.activeOperation) return { ok: false, message: `${this.activeOperation.label} is already in progress.` }

    const suggested = safeHexBackupName(board.id, port)
    const owner = this.ctx.getMainWindow()
    const save = owner
      ? await dialog.showSaveDialog(owner, {
          title: 'Save Arduino .hex backup',
          defaultPath: join(this.ctx.app.getPath('documents'), suggested),
          filters: [{ name: 'Intel HEX firmware', extensions: ['hex'] }]
        })
      : await dialog.showSaveDialog({
          title: 'Save Arduino .hex backup',
          defaultPath: join(this.ctx.app.getPath('documents'), suggested),
          filters: [{ name: 'Intel HEX firmware', extensions: ['hex'] }]
        })
    if (save.canceled || !save.filePath) {
      return { ok: false, message: 'Backup canceled before starting.' }
    }

    const controller = new AbortController()
    this.activeOperation = { controller, label: 'Backup .hex' }
    try {
      await this.freePort(port)
      const baud = findFlashBaud(board, request.baudId)
      emit({
        phase: 'upload',
        message:
          'Reading flash to a .hex file. This backs up the compiled firmware; it does not reverse-engineer or identify functions automatically.',
        percent: 6
      })
      await dumpHexFirmware({
        board,
        port,
        baud: baud.baud,
        outputPath: save.filePath,
        tools: resolveFlashToolPaths(this.ctx.app),
        onProgress: emit,
        signal: controller.signal
      })
      return { ok: true, message: `Backup .hex saved to ${save.filePath}.`, path: save.filePath }
    } catch (error) {
      const message = isFlashAbortError(error) ? 'Backup .hex canceled.' : errMessage(error)
      emit({ phase: 'error', message, percent: 100, tone: 'error' })
      return { ok: false, message }
    } finally {
      if (this.activeOperation?.controller === controller) this.activeOperation = null
    }
  }

  // Resolves with a FlashResult in every case (success, flash-failed, or
  // verify-failed) so the renderer always gets structured feedback.
  async flash(request: FlashRequest): Promise<FlashResult> {
    const emit = (progress: FlashProgress): void => this.ctx.broadcast(SETUP_CHANNELS.progress, progress)
    const port = String(request?.port ?? '').trim()
    const result: FlashResult = {
      ok: false,
      verified: false,
      message: '',
      port,
      board: request?.board,
      capabilities: []
    }
    if (this.activeOperation) {
      result.message = `${this.activeOperation.label} is already in progress. Cancel before starting another operation.`
      return result
    }
    const controller = new AbortController()
    this.activeOperation = { controller, label: 'Firmware flashing' }

    try {
      throwIfAborted(controller.signal)
      const module = findSetupModule(request?.moduleId ?? '')
      if (!module) throw new SetupError('Unknown module.')
      if (module.status !== 'available') {
        throw new SetupError(`Module “${module.name}” does not have firmware ready to flash yet.`)
      }
      const board = findFlashBoard(request?.board ?? '')
      if (!board) throw new SetupError('Board not supported for flashing.')
      const firmware = findModuleFirmware(module, board.id)
      if (!firmware) {
        throw new SetupError(`“${module.name}” has no firmware for ${board.name}.`)
      }
      if (!port) throw new SetupError('Select the board serial (COM) port.')
      // Hard guard (not just UI): never flash the SIM-X box, even if it's not
      // currently opened by the app.
      const portInfo = (await this.listFlashablePorts()).find((entry) => entry.path === port)
      if (portInfo && (portInfo as { isSimX?: boolean }).isSimX) {
        await saveSimXPrimaryIdentity(this.ctx.app, portInfo).catch((error) =>
          console.warn('[arduino-setup] failed to save SIM-X primary identity:', errMessage(error))
        )
        throw new SetupError('This is the SIM-X port. Do not flash generic firmware to it — use a secondary Arduino.')
      }
      const storedSimX = await readSimXPrimaryIdentity(this.ctx.app)
      if (storedSimX && matchesSimXPrimaryIdentity(storedSimX, port, portInfo)) {
        throw new SetupError('This port matches the saved main SIM-X. Do not flash generic firmware to it.')
      }
      const baud = findFlashBaud(board, request.baudId)
      const isKnownSimXPort = (portInfo as { isSimX?: boolean } | undefined)?.isSimX
      if (board.mcu.toLowerCase() === 'atmega32u4' && !storedSimX && !isKnownSimXPort) {
        console.warn(
          '[arduino-setup] No saved SIM-X identity; unidentified ATmega32U4 target ' +
            `${port} will keep the existing flashing behavior.`
        )
      }

      emit({ phase: 'prepare', message: `Preparing flash de ${module.name} (${board.name})…`, percent: 6 })
      const hexPath = resolveFirmwarePath(this.ctx.app, firmware.hex)
      if (!existsSync(hexPath)) throw new SetupError(`Firmware not found: ${firmware.hex}.`)

      throwIfAborted(controller.signal)
      await this.freePort(port)

      await flashFirmware({
        board,
        port,
        hexPath,
        baud: baud.baud,
        baudCandidates: flashBaudCandidates(board, request.baudId),
        tools: resolveFlashToolPaths(this.ctx.app),
        onProgress: emit,
        signal: controller.signal
      })
      result.ok = true

      throwIfAborted(controller.signal)
      emit({ phase: 'verify', message: 'Reopening the port and requesting capabilities (?)…', percent: 76 })
      const verify = await this.verifyCapabilities(port, module, controller.signal)
      result.capabilities = verify.caps

      if (!verify.matched) {
        // Flash itself worked, but the handshake didn't confirm the module.
        if (verify.deviceId) await this.disconnectQuietly(verify.deviceId)
        const detail = verify.caps.length
          ? `Received: ${formatCaps(verify.caps)}.`
          : 'No response to “?” (KEND did not arrive).'
        result.message =
          `Firmware flashed, but the handshake did not confirm ${module.capabilityKey}. ${detail} ` +
          'Check wiring (DIN→D6, 5V, GND) and try flashing again.'
        emit({ phase: 'error', message: result.message, percent: 100, tone: 'error' })
        return result
      }

      emit({
        phase: 'capabilities',
        message: `Capabilities confirmed: ${formatCaps(verify.caps)}`,
        percent: 88,
        tone: 'success'
      })

      emit({ phase: 'profile', message: 'Creating the device in Hardware Hub…', percent: 94 })
      const profile = await this.createProfile(module, board.profileBoard, port, verify.deviceId, verify.caps)
      await this.persistSerialDevice(module, port, verify.deviceId)
      result.profileId = profile.id
      result.deviceId = verify.deviceId
      result.verified = true
      result.message = `${module.name} is ready! Component created and verified (${formatCaps(verify.caps)}).`
      emit({ phase: 'done', message: result.message, percent: 100, tone: 'success' })
      return result
    } catch (error) {
      const aborted = isFlashAbortError(error)
      const message = aborted ? 'Flash canceled. The avrdude/arduino-cli process was stopped.' : errMessage(error)
      result.message = message
      emit({ phase: 'error', message, percent: 100, tone: 'error' })
      return result
    } finally {
      if (this.activeOperation?.controller === controller) this.activeOperation = null
    }
  }

  // Close any open hub device sitting on the target port so avrdude can use it.
  // Refuses to touch the SIM-X primary.
  private async withIdentify(port: PortInfo): Promise<IdentifiedPortInfo> {
    const usbGuess = guessFlashBoardFromUsb(usbDescriptorOf(port))

    if (port.isSimX) {
      return {
        ...port,
        identify: {
          status: 'identified',
          label: 'SIM-X candidate',
          detail: 'Matched USB descriptor/friendly name. The current SIM-X firmware has no serial identify reply.',
          boardGuess: usbGuess ?? undefined
        }
      }
    }

    const existing = this.ctx.serialHub.listDevices().find((device) => device.path === port.path)
    if (existing?.connected) {
      const device = this.ctx.serialHub.getDevice(existing.id)
      if (!device) return { ...port, identify: identifyResultFromCaps([], usbGuess) }
      const identify = await identifyOpenDevice(device, usbGuess)
      return { ...port, identify }
    }

    const identify = await identifySerialPort(port.path, usbGuess)
    return { ...port, identify }
  }

  private async freePort(port: string): Promise<void> {
    const existing = this.ctx.serialHub.listDevices().find((device) => device.path === port)
    if (!existing) return
    const primaryId = this.ctx.serialHub.getPrimaryId()
    if (existing.kind === 'sim-x' || existing.id === primaryId) {
      throw new SetupError(
        'This port is the main SIM-X — do not flash firmware to it here. Choose a secondary Arduino port.'
      )
    }
    await this.ctx.serialHub.disconnectDevice(existing.id).catch(() => undefined)
    await delay(PORT_RELEASE_MS)
  }

  // Reopen the freshly-flashed port as a generic companion device, send `?`,
  // and collect `K:<key>=<detail>` lines until `KEND`. On a confirmed match the
  // device is LEFT CONNECTED so the new profile has a live link; otherwise the
  // caller disconnects it.
  private async verifyCapabilities(
    port: string,
    module: SetupModule,
    signal?: AbortSignal
  ): Promise<{ matched: boolean; caps: DetectedCapability[]; deviceId: string }> {
    throwIfAborted(signal)
    let device: SerialDevice
    try {
      device = await this.ctx.serialHub.connectDevice({
        path: port,
        kind: 'generic',
        label: module.name,
        baud: COMPANION_BAUD,
        primary: false,
        assertSignals: false
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new SetupError(`Firmware flashed, but I could not reopen ${port} para verificar: ${message}`)
    }

    const caps: DetectedCapability[] = []
    let ended = false
    const onRx = (line: string): void => {
      if (isCapabilityEnd(line)) {
        ended = true
        return
      }
      const cap = parseCapabilityLine(line)
      if (cap) caps.push({ key: cap.key, detail: cap.detail })
    }
    device.on('rx', onRx)

    try {
      // The board resets when the port opens; let the firmware boot before asking.
      await abortableDelay(VERIFY_BOOT_DELAY_MS, signal)
      const deadline = Date.now() + VERIFY_TIMEOUT_MS
      while (!ended && Date.now() < deadline) {
        throwIfAborted(signal)
        await device.sendRaw(COMPANION_QUERY_COMMAND).catch(() => undefined)
        await abortableDelay(VERIFY_QUERY_INTERVAL_MS, signal)
      }
    } finally {
      device.off('rx', onRx)
      if (signal?.aborted) await this.disconnectQuietly(device.id)
    }

    const matched = caps.some(
      (cap) =>
        cap.key === module.capabilityKey &&
        (!module.capabilityDetail || cap.detail.includes(module.capabilityDetail))
    )
    return { matched, caps, deviceId: device.id }
  }

  private async createProfile(
    module: SetupModule,
    profileBoard: DeviceProfile['board'],
    port: string,
    deviceId: string,
    caps: DetectedCapability[]
  ): Promise<DeviceProfile> {
    const component = buildComponent(module, caps)
    const saved = await this.store.save({
      label: `${module.name} · ${labelForBoard(profileBoard)}`,
      board: profileBoard,
      baud: COMPANION_BAUD,
      port,
      deviceId: deviceId || undefined,
      components: [component]
    })
    this.ctx.broadcast(DEVICES_CHANNELS.changed, this.store.list())
    return saved
  }

  private async persistSerialDevice(module: SetupModule, port: string, deviceId: string): Promise<void> {
    if (!deviceId) return
    await this.serialDevicesStore.upsert({
      id: deviceId,
      path: port,
      label: module.name,
      baud: COMPANION_BAUD,
      autoConnect: true
    })
  }

  private async disconnectQuietly(deviceId: string): Promise<void> {
    await this.ctx.serialHub.disconnectDevice(deviceId).catch(() => undefined)
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function usbDescriptorOf(port: PortInfo): UsbDescriptorLike {
  return {
    vendorId: port.vendorId,
    productId: port.productId,
    friendlyName: port.friendlyName,
    manufacturer: port.manufacturer
  }
}

async function identifyOpenDevice(device: SerialDevice, usbGuess?: FlashBoardGuess | null): Promise<IdentifyResult> {
  const caps: DetectedCapability[] = []
  let ended = false
  const onRx = (line: string): void => {
    if (isCapabilityEnd(line)) {
      ended = true
      return
    }
    const cap = parseCapabilityLine(line)
    if (cap) caps.push({ key: cap.key, detail: cap.detail })
  }
  device.on('rx', onRx)
  try {
    await device.sendRaw(COMPANION_QUERY_COMMAND).catch(() => undefined)
    const deadline = Date.now() + IDENTIFY_TIMEOUT_MS
    while (!ended && caps.length === 0 && Date.now() < deadline) {
      await delay(100)
    }
  } finally {
    device.off('rx', onRx)
  }
  return identifyResultFromCaps(caps, usbGuess)
}

function identifySerialPort(path: string, usbGuess?: FlashBoardGuess | null): Promise<IdentifyResult> {
  return new Promise<IdentifyResult>((resolve) => {
    const port = new SerialPort({
      path,
      baudRate: COMPANION_BAUD,
      dataBits: 8,
      parity: 'none',
      stopBits: 1,
      autoOpen: false
    })
    const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }))
    const caps: DetectedCapability[] = []
    let ended = false
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let queryTimer: ReturnType<typeof setInterval> | null = null

    const finish = (result: IdentifyResult): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (queryTimer) clearInterval(queryTimer)
      parser.removeAllListeners()
      port.removeAllListeners()
      // Keep a benign error sink so a late abort fired while/after closing can't
      // be emitted on a listener-less stream and crash main.
      port.on('error', () => undefined)
      if (port.isOpen) port.close(() => undefined)
      resolve(result)
    }

    // Async serial errors (e.g. the Windows "Operation aborted" when the port is
    // yanked mid-identify) must be handled, or they become uncaught exceptions.
    port.on('error', (error) => {
      if (isBenignSerialError(error)) {
        finish(identifyResultFromCaps(caps, usbGuess))
        return
      }
      finish({ status: 'error', label: 'Identify failed', detail: serialErrorMessage(error), boardGuess: usbGuess ?? undefined })
    })

    timer = setTimeout(() => finish(identifyResultFromCaps(caps, usbGuess)), IDENTIFY_TIMEOUT_MS + IDENTIFY_BOOT_DELAY_MS)

    parser.on('data', (raw: string | Buffer) => {
      const line = String(raw).replace(/\r$/, '').trim()
      if (isCapabilityEnd(line)) {
        ended = true
        finish(identifyResultFromCaps(caps, usbGuess))
        return
      }
      const cap = parseCapabilityLine(line)
      if (cap) caps.push({ key: cap.key, detail: cap.detail })
    })

    const sendQuery = (): void => {
      if (settled || ended) return
      // Fire-and-forget identify query; a write that aborts because the port
      // closed is benign and must never crash main. Wire payload unchanged.
      try {
        port.write(COMPANION_QUERY_COMMAND, (writeError) => {
          if (writeError && !isBenignSerialError(writeError)) {
            console.warn('[arduino-setup] identify write failed:', serialErrorMessage(writeError))
          }
        })
      } catch (error) {
        if (!isBenignSerialError(error)) {
          console.warn('[arduino-setup] identify write threw:', serialErrorMessage(error))
        }
      }
    }

    port.open((openError) => {
      if (openError) {
        const msg = openError.message || String(openError)
        const busy = /access|denied|busy|cannot open|permission/i.test(msg)
        finish({
          status: busy ? 'busy' : 'error',
          label: busy ? 'Port busy' : 'Identify failed',
          detail: msg,
          boardGuess: usbGuess ?? undefined
        })
        return
      }
      port.set({ dtr: true, rts: true }, () => undefined)
      // The 328P bootloader runs for ~1-2s after the DTR reset before the sketch
      // boots, so a single early `?` is often lost. Poll a few times across the
      // identify window to reliably catch the companion reply.
      setTimeout(sendQuery, IDENTIFY_BOOT_DELAY_MS)
      queryTimer = setInterval(sendQuery, 400)
    })
  })
}

function identifyResultFromCaps(caps: DetectedCapability[], usbGuess?: FlashBoardGuess | null): IdentifyResult {
  const boardGuess = usbGuess ?? undefined
  if (caps.length === 0) {
    if (boardGuess) {
      // No serial reply, but the USB descriptor tells us the board family — be
      // honest that the firmware is unknown/non-companion and point at flashing.
      return {
        status: 'unknown',
        label: boardGuess.label,
        detail:
          `${boardGuess.reason} Did not respond to “?” (unknown or non-companion firmware). ` +
          'To use it in the app, flash the module firmware (for example, iFlag) to this board.',
        boardGuess,
        speaksCompanion: false,
        speaksMatrix: false
      }
    }
    return {
      status: 'unknown',
      label: 'No known identify reply',
      detail: 'Sent the SIM-X/SimHub companion identify query (?) and did not receive K: capabilities.',
      speaksCompanion: false,
      speaksMatrix: false
    }
  }

  const speaksMatrix = caps.some((cap) => cap.key === 'rgbMatrix')
  const label = speaksMatrix
    ? 'iFlag / RGB Matrix (firmware companion)'
    : 'Firmware companion (SIM-X/SimHub-compatible)'
  const usbSuffix = boardGuess ? ` · USB: ${boardGuess.label}` : ''
  return {
    status: 'identified',
    label,
    detail: `${formatCaps(caps)}${usbSuffix}`,
    capabilities: caps,
    speaksCompanion: true,
    speaksMatrix,
    boardGuess
  }
}

function safeHexBackupName(boardId: string, port: string): string {
  const safePort = basename(port).replace(/[^a-zA-Z0-9._-]+/g, '_') || 'arduino'
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `arduino-${boardId}-${safePort}-${stamp}.hex`
}

// Build the Hub component the verified module maps to, applying the module's
// default pins and any dimensions reported in the capability detail (e.g. 8x8).
function buildComponent(module: SetupModule, caps: DetectedCapability[]): DeviceComponent {
  const component = createComponent(module.componentType)
  component.label = module.name
  component.pins = { ...module.defaultPins }
  component.enabled = true

  const cap = caps.find((entry) => entry.key === module.capabilityKey)
  if (component.type === 'rgbMatrix' && cap) {
    const dims = /(\d+)\s*x\s*(\d+)/i.exec(cap.detail)
    if (dims) {
      component.width = clampInt(Number(dims[1]), 1, 32)
      component.height = clampInt(Number(dims[2]), 1, 32)
    }
  } else if (component.type === 'rgbStrip' && cap) {
    const count = /(\d+)/.exec(cap.detail)
    if (count) component.ledCount = clampInt(Number(count[1]), 1, 256)
  }
  return component
}

function labelForBoard(board: DeviceProfile['board']): string {
  const known: Partial<Record<DeviceProfile['board'], string>> = {
    nano: 'Nano',
    uno: 'Uno',
    'pro-micro': 'Pro Micro'
  }
  return known[board] ?? board
}

function formatCaps(caps: DetectedCapability[]): string {
  return caps.map((cap) => `K:${cap.key}=${cap.detail}`).join(', ')
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
