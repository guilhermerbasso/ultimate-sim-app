// Firmware flasher (main process). Runs the bundled Windows `avrdude` to write a
// prebuilt `.hex` to an AVR board over its serial bootloader, streaming every
// avrdude line back as a `FlashProgress` event.
//
// Boards:
//   • Uno / Nano (atmega328p, programmer "arduino"): direct upload.
//       avrdude -C <conf> -c arduino -p atmega328p -P <port> -b <baud> -D -U flash:w:<hex>:i
//   • Pro Micro / Leonardo (atmega32u4, programmer "avr109"): 1200bps-touch reset
//     into the Caterina bootloader (the COM port re-enumerates), then:
//       avrdude -C <conf> -c avr109 -p atmega32u4 -P <bootloaderPort> -b 57600 -U flash:w:<hex>:i
//
// avrdude.exe is a Windows binary; on macOS/Linux we refuse early with a clear
// message instead of crashing main. We never shell-concatenate paths/ports —
// avrdude is always spawned with an argument array.

import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app as electronApp, type App } from 'electron'
import { SerialPort } from '../serial/serialport-runtime'
import type { FlashBoardSpec, FlashProgress } from '../../shared/setup'
import { isBenignSerialError, serialErrorMessage } from '../serial/errors'
import { ensureAvrdude } from './avrdude-fetch'

export class FlashError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FlashError'
  }
}

// avrdude stk500 "not in sync" (resp=0x03 "new bootloader" / resp=0xef "old
// bootloader") — the bootloader didn't answer the sync handshake. Almost always
// wrong board/baud/programmer for the bootloader, a busy COM port, or a board
// that needs a manual reset. Typed so flashFirmware can auto-retry the other
// baud before giving up.
export class NotInSyncError extends FlashError {
  constructor(message: string) {
    super(message)
    this.name = 'NotInSyncError'
  }
}

export class FlashAbortError extends FlashError {
  constructor(message = 'Operation canceled by user.') {
    super(message)
    this.name = 'FlashAbortError'
  }
}

export interface FlashToolPaths {
  avrdudeExe: string
  avrdudeConf: string
}

export interface FlasherOptions {
  board: FlashBoardSpec
  port: string
  hexPath: string
  baud: number
  tools: FlashToolPaths
  onProgress: (progress: FlashProgress) => void
  // Distinct bauds to try, chosen first. On an stk500 "not in sync" failure the
  // 328P path retries the next candidate (115200 ↔ 57600). Defaults to [baud].
  baudCandidates?: number[]
  // Hard ceiling so a stuck avrdude can't hang the flow forever.
  timeoutMs?: number
  signal?: AbortSignal
}

export interface Esp32FlasherOptions {
  boardId: 'esp32' | 'esp32s3'
  port: string
  sketchPath: string
  fqbn?: string
  uploadBaud?: number
  onProgress: (progress: FlashProgress) => void
  timeoutMs?: number
  signal?: AbortSignal
}

const RESET_SETTLE_MS = 250
const BOOTLOADER_POLL_MS = 250
const BOOTLOADER_WAIT_MS = 10_000
const DEFAULT_FLASH_TIMEOUT_MS = 120_000

// ─── Resource path resolution (packaged vs dev) ───────────────────────────────
// Packaged: extraResources lands tools/ + firmware/ under process.resourcesPath.
// Dev: they live at <repoRoot>/resources (app.getAppPath() is the project root).

export function resolveResourcesDir(app: App): string {
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
}

export function resolveFlashToolPaths(app: App): FlashToolPaths {
  const base = resolveResourcesDir(app)
  return {
    avrdudeExe: join(base, 'tools', 'avrdude', 'win', 'bin', 'avrdude.exe'),
    avrdudeConf: join(base, 'tools', 'avrdude', 'win', 'etc', 'avrdude.conf')
  }
}

export function resolveFirmwarePath(app: App, hexFile: string): string {
  return join(resolveResourcesDir(app), 'firmware', hexFile)
}

export function resolveCompanionEsp32SketchPath(app: App): string {
  return app.isPackaged
    ? join(resolveResourcesDir(app), 'firmware', 'companion-esp32')
    : join(app.getAppPath(), 'firmware', 'companion-esp32')
}

// ─── Public entry ─────────────────────────────────────────────────────────────

export async function flashFirmware(opts: FlasherOptions): Promise<void> {
  const { board, port, hexPath, tools, onProgress } = opts
  const timeoutMs = opts.timeoutMs ?? DEFAULT_FLASH_TIMEOUT_MS
  throwIfAborted(opts.signal)

  if (board.flashTool === 'arduino-cli' || board.programmer === 'arduino-cli') {
    await flashEsp32Firmware({
      boardId: board.id === 'esp32s3' ? 'esp32s3' : 'esp32',
      port,
      sketchPath: hexPath,
      fqbn: board.fqbn,
      uploadBaud: opts.baud,
      onProgress,
      timeoutMs,
      signal: opts.signal
    })
    return
  }

  if (process.platform !== 'win32') {
    throw new FlashError(
      'Firmware flashing is only available on Windows for now (avrdude.exe). ' +
        'No macOS/Linux, grave o .hex pelo Arduino IDE e depois conecte a placa no app.'
    )
  }
  const resolvedTools = { ...tools, avrdudeExe: await resolveUsableAvrdudeExe(tools.avrdudeExe) }
  if (!existsSync(hexPath)) {
    throw new FlashError(`Firmware (.hex) not found em ${hexPath}.`)
  }

  const targetPort = await prepareAvrdudePort(board, port, onProgress, opts.signal)

  throwIfAborted(opts.signal)
  await runAvrdudeWithBaudRetry(board, targetPort, hexPath, { ...opts, tools: resolvedTools }, timeoutMs)
  onProgress({ phase: 'upload', message: 'Firmware gravado e verificado pelo avrdude.', percent: 70, tone: 'success' })
}

async function resolveUsableAvrdudeExe(bundledPath: string): Promise<string> {
  try {
    return await ensureAvrdude(electronApp)
  } catch (error) {
    if (existsSync(bundledPath)) return bundledPath
    throw new FlashError(error instanceof Error ? error.message : String(error))
  }
}

// Run avrdude, auto-retrying the alternate Optiboot speed on an stk500 "not in
// sync" failure (the resp=0x03/0xef symptom). 32U4 (avr109) and ESP have a
// single fixed speed, so the loop runs once. On a sync failure that survives
// every candidate baud we raise a single, actionable FlashError — never an
// uncaught throw (the caller resolves it into a clean FlashResult).
async function runAvrdudeWithBaudRetry(
  board: FlashBoardSpec,
  targetPort: string,
  hexPath: string,
  opts: FlasherOptions,
  timeoutMs: number
): Promise<void> {
  const { tools, onProgress } = opts
  const candidates = dedupeBauds(
    opts.baudCandidates && opts.baudCandidates.length > 0 ? opts.baudCandidates : [opts.baud]
  )
  // Only the 328P stk500 path benefits from trying the other baud.
  const retryBauds = board.mcuFamily === 'avr328' ? candidates : [candidates[0]]

  let lastSyncError: NotInSyncError | null = null
  for (let attempt = 0; attempt < retryBauds.length; attempt++) {
    throwIfAborted(opts.signal)
    const baud = retryBauds[attempt]
    const args = buildAvrdudeArgs(board, targetPort, hexPath, baud, tools.avrdudeConf)
    const retryNote = attempt > 0 ? ` (tentativa ${attempt + 1}/${retryBauds.length}, baud ${baud})` : ''
    onProgress({
      phase: 'upload',
      message: `Gravando firmware via avrdude (${board.programmer}, ${baud} baud)${retryNote}…`,
      percent: 32,
      line: `> avrdude ${args.join(' ')}`
    })
    try {
      await runAvrdude(tools.avrdudeExe, args, onProgress, timeoutMs, opts.signal)
      return
    } catch (error) {
      if (!(error instanceof NotInSyncError)) throw error
      lastSyncError = error
      const next = retryBauds[attempt + 1]
      if (next !== undefined) {
        onProgress({
          phase: 'reset',
          message: `avrdude did not sync a ${baud} baud. Trying ${next} baud…`,
          percent: 30,
          tone: 'info'
        })
      }
    }
  }

  throw new FlashError(notInSyncGuidance(board, retryBauds, lastSyncError))
}

function dedupeBauds(bauds: number[]): number[] {
  return [...new Set(bauds.filter((value) => Number.isFinite(value) && value > 0))]
}

export async function prepareAvrdudePort(
  board: FlashBoardSpec,
  port: string,
  onProgress: (progress: FlashProgress) => void,
  signal?: AbortSignal
): Promise<string> {
  let targetPort = port
  if (board.needs1200Touch) {
    throwIfAborted(signal)
    onProgress({ phase: 'reset', message: 'Resetando a placa em modo bootloader (toque 1200bps)…', percent: 18 })
    const before = await listPorts()
    await touch1200bps(port)
    targetPort = await waitForBootloaderPort(before, port, signal)
    onProgress({ phase: 'reset', message: `Bootloader detectado em ${targetPort}.`, percent: 28 })
  }
  return targetPort
}

export async function flashEsp32Firmware(opts: Esp32FlasherOptions): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_FLASH_TIMEOUT_MS
  const fqbn = opts.fqbn ?? (opts.boardId === 'esp32s3' ? 'esp32:esp32:esp32s3' : 'esp32:esp32:esp32')
  const uploadArgs = ['upload', '-p', opts.port, '--fqbn', fqbn]
  if (Number.isFinite(opts.uploadBaud) && (opts.uploadBaud ?? 0) > 0) {
    uploadArgs.push('--upload-property', `upload.speed=${opts.uploadBaud}`)
  }
  uploadArgs.push(opts.sketchPath)
  throwIfAborted(opts.signal)

  if (!opts.port.trim()) throw new FlashError('Select the ESP32 USB/serial port.')
  if (!existsSync(opts.sketchPath)) {
    throw new FlashError(`ESP32 sketch not found at ${opts.sketchPath}.`)
  }

  await ensureArduinoCliReady(fqbn, opts.signal)

  opts.onProgress({
    phase: 'prepare',
    message: `Compilando sketch ESP32 com arduino-cli (${fqbn})…`,
    percent: 18,
    line: `> arduino-cli compile --fqbn ${fqbn} ${opts.sketchPath}`
  })
  await runCommand(
    'arduino-cli',
    ['compile', '--fqbn', fqbn, opts.sketchPath],
    opts.onProgress,
    timeoutMs,
    'arduino-cli compile',
    opts.signal
  )

  opts.onProgress({
    phase: 'upload',
    message: `Gravando ESP32 via arduino-cli em ${opts.port}…`,
    percent: 52,
    line: `> arduino-cli ${uploadArgs.join(' ')}`
  })
  await runCommand(
    'arduino-cli',
    uploadArgs,
    opts.onProgress,
    timeoutMs,
    'arduino-cli upload',
    opts.signal
  )
  opts.onProgress({ phase: 'upload', message: 'Firmware ESP32 gravado pelo arduino-cli.', percent: 76, tone: 'success' })
}

// ─── avrdude invocation ───────────────────────────────────────────────────────

export function buildAvrdudeArgs(
  board: FlashBoardSpec,
  port: string,
  hexPath: string,
  baud: number,
  conf: string
): string[] {
  const args = ['-C', conf, '-c', board.programmer, '-p', board.mcu, '-P', port, '-b', String(baud)]
  // Uno/Nano: skip the chip-erase auto-verify dance that can break some clones.
  if (board.programmer === 'arduino') args.push('-D')
  args.push('-U', `flash:w:${hexPath}:i`)
  return args
}

export function runAvrdude(
  exe: string,
  args: string[],
  onProgress: (progress: FlashProgress) => void,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new FlashAbortError())
      return
    }

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(exe, args, { windowsHide: true })
    } catch (error) {
      reject(new FlashError(`Failed to start avrdude: ${errMessage(error)}`))
      return
    }

    let settled = false
    let lastLine = ''
    let captured = ''
    let timer: ReturnType<typeof setTimeout> | null = null

    const onAbort = (): void => {
      if (settled) return
      killChild(child)
      finish(() => reject(new FlashAbortError()))
    }

    function finish(action: () => void): void {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      try {
        child.stdout?.removeAllListeners()
        child.stderr?.removeAllListeners()
        child.removeAllListeners()
      } catch {
        // best-effort
      }
      action()
    }

    timer = setTimeout(() => {
      if (settled) return
      killChild(child)
      finish(() => reject(new FlashError('Flash timed out (avrdude did not respond in time).')))
    }, timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })

    const handleChunk = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      // Keep a bounded copy of everything for failure classification.
      captured = (captured + text).slice(-4000)
      // avrdude draws its "#" progress bar with carriage returns; split on both
      // and forward only textual status lines (writing/reading/verifying/done)
      // so the live log stays readable and the IPC bridge isn't flooded.
      for (const part of text.split(/[\r\n]+/)) {
        const line = part.trim()
        if (!line || !/[a-zA-Z]/.test(line)) continue
        if (line === lastLine) continue
        lastLine = line
        onProgress({ phase: 'upload', message: line, line })
      }
    }

    child.stdout?.on('data', handleChunk)
    child.stderr?.on('data', handleChunk)
    child.on('error', (error) => finish(() => reject(new FlashError(`avrdude falhou ao executar: ${error.message}`))))
    child.on('close', (code) =>
      finish(() => {
        if (code === 0) resolve()
        else if (isNotInSyncOutput(captured)) reject(new NotInSyncError(avrdudeFailureHint(code)))
        else reject(new FlashError(avrdudeFailureHint(code)))
      })
    )
  })
}

async function ensureArduinoCliReady(fqbn: string, signal?: AbortSignal): Promise<void> {
  try {
    await runCommandQuiet('arduino-cli', ['version'], 12_000, undefined, signal)
  } catch (error) {
    if (isFlashAbortError(error)) throw error
    throw new FlashError(
      'arduino-cli is not installed or not on PATH. Install Arduino CLI and try again.'
    )
  }

  try {
    await runCommandQuiet('arduino-cli', ['core', 'list'], 20_000, (output) => output.includes('esp32:esp32'), signal)
  } catch (error) {
    if (isFlashAbortError(error)) throw error
    throw new FlashError(
      `Arduino ESP32 core not found para ${fqbn}. Install with: arduino-cli core install esp32:esp32`
    )
  }
}

function runCommand(
  exe: string,
  args: string[],
  onProgress: (progress: FlashProgress) => void,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new FlashAbortError())
      return
    }

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(exe, args, { windowsHide: true })
    } catch (error) {
      reject(new FlashError(`Failed to start ${label}: ${errMessage(error)}`))
      return
    }

    let settled = false
    let lastLine = ''
    let timer: ReturnType<typeof setTimeout> | null = null

    const onAbort = (): void => {
      if (settled) return
      killChild(child)
      finish(() => reject(new FlashAbortError()))
    }

    function finish(action: () => void): void {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      child.stdout?.removeAllListeners()
      child.stderr?.removeAllListeners()
      child.removeAllListeners()
      action()
    }

    timer = setTimeout(() => {
      if (settled) return
      killChild(child)
      finish(() => reject(new FlashError(`Tempo esgotado em ${label}.`)))
    }, timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })

    const handleChunk = (chunk: Buffer): void => {
      for (const part of chunk.toString('utf8').split(/[\r\n]+/)) {
        const line = part.trim()
        if (!line || line === lastLine) continue
        lastLine = line
        onProgress({ phase: 'upload', message: line, line })
      }
    }

    child.stdout?.on('data', handleChunk)
    child.stderr?.on('data', handleChunk)
    child.on('error', (error) => finish(() => reject(new FlashError(`${label} falhou ao executar: ${error.message}`))))
    child.on('close', (code) =>
      finish(() => {
        if (code === 0) resolve()
        else {
          reject(
            new FlashError(
              `${label} finished with an error (code ${code ?? 'unknown'}). ` +
                'Check the USB port, data cable, permissions, and that the ESP32 core is installed: ' +
                'arduino-cli core install esp32:esp32'
            )
          )
        }
      })
    )
  })
}

function runCommandQuiet(
  exe: string,
  args: string[],
  timeoutMs: number,
  accept?: (output: string) => boolean,
  signal?: AbortSignal
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new FlashAbortError())
      return
    }

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(exe, args, { windowsHide: true })
    } catch (error) {
      reject(error)
      return
    }
    let settled = false
    let output = ''
    let timer: ReturnType<typeof setTimeout> | null = null
    const onAbort = (): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      killChild(child)
      reject(new FlashAbortError())
    }
    timer = setTimeout(() => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      killChild(child)
      reject(new Error('timeout'))
    }, timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (code === 0 && (!accept || accept(output))) resolve(output)
      else reject(new Error(output || `exit ${code ?? 'unknown'}`))
    })
  })
}

export function avrdudeFailureHint(code: number | null): string {
  return (
    `avrdude finished with an error (code ${code ?? 'unknown'}). ` +
    'If stk500_recv()/stk500_getsync() or "not in sync" appears, try: ' +
    '(1) confirm the correct COM port; ' +
    '(2) change the bootloader/baud option (Nano clones usually use 57600; genuine boards usually use 115200); ' +
    '(3) tap/hold RESET at startup to enter the bootloader; ' +
    '(4) close SimHub/Arduino IDE/serial monitors that may be using the port; ' +
    '(5) on 32U4/Pro Micro/Leonardo boards, wait for the port to re-enumerate after reset; ' +
    '(6) use a USB data cable and CH340/FTDI driver when needed.'
  )
}

// stk500 sync-failure fingerprints. resp=0x03 (selecting "new bootloader") and
// resp=0xef (selecting "old bootloader") are the exact symptoms reported for the
// iFlag, plus the generic getsync/recv/"not responding" variants.
export function isNotInSyncOutput(output: string): boolean {
  if (!output) return false
  return /not in sync|stk500_getsync|stk500_recv|resp=0x|programmer is not responding|can't open device|cannot open/i.test(
    output
  )
}

// Final guidance after every candidate baud failed to sync. The headline call to
// action is "is this actually the right board?", because picking a 328P profile
// for a 32U4 device (or vice-versa) is the dominant not-in-sync cause: stk500
// (`arduino`) only talks to an Optiboot/328P bootloader, while a 32U4 needs
// `avr109` + the 1200bps reset.
export function notInSyncGuidance(
  board: FlashBoardSpec,
  triedBauds: number[],
  source?: Error | null
): string {
  const baudList = triedBauds.join(' e ')
  const lines: string[] = [
    `avrdude did not sync with the bootloader (not in sync / resp=0x03/0xef) testing ${baudList} baud.`
  ]
  if (board.mcuFamily === 'avr328') {
    lines.push(
      'Verify the board really is an ATmega328P (Nano/Uno). ' +
        'Se for um Pro Micro/Leonardo (ATmega32U4), troque a placa para “Pro Micro (32U4)” — ela usa avr109 + reset 1200bps, e o programador stk500 (arduino) nunca vai sincronizar. ' +
        'Se for um ESP32, escolha o board ESP correspondente.'
    )
  } else if (board.mcuFamily === 'avr32u4') {
    lines.push(
      'Confirm the board is 32U4 (Pro Micro/Leonardo). Tap RESET twice quickly to enter the Caterina bootloader and click Flash right away; the COM port changes for about 2s during the process.'
    )
  }
  lines.push(
    'Also check: correct COM port; no SimHub/Arduino IDE/Serial Monitor using the port; USB data cable (not charge-only); CH340/CP210x/FTDI driver installed.'
  )
  if (source?.message) lines.push(source.message)
  return lines.join(' ')
}

// ─── 1200bps touch + bootloader port detection (32U4) ─────────────────────────

function touch1200bps(path: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const sp = new SerialPort({ path, baudRate: 1200, autoOpen: false })
    let settled = false
    const settle = (error?: Error): void => {
      if (settled) return
      settled = true
      sp.removeAllListeners()
      // Keep an error sink so a late abort during/after close can't crash main.
      sp.on('error', () => undefined)
      if (error) reject(error)
      else resolve()
    }
    // The board very often drops off the bus the instant the 1200bps reset lands,
    // so the binding may emit an async "Operation aborted" error. That abort IS
    // the expected outcome of the touch — treat it as success, and never let it
    // escape as an uncaught exception.
    sp.on('error', (error) => {
      if (isBenignSerialError(error)) {
        settle()
        return
      }
      settle(new FlashError(`Erro na porta durante o reset 1200bps em ${path}: ${serialErrorMessage(error)}`))
    })
    sp.open((openError) => {
      if (openError) {
        settle(new FlashError(`Could not open ${path} for the 1200 bps reset: ${openError.message}`))
        return
      }
      // Dropping DTR while open at 1200 baud triggers the Caterina reset.
      sp.set({ dtr: false }, (setError) => {
        setTimeout(() => {
          sp.close((closeError) => {
            if (setError) {
              settle(new FlashError(`Failed to request 1200bps reset on ${path}: ${setError.message}`))
              return
            }
            if (closeError) {
              // Ignored on purpose: some boards disappear before close completes
              // (that's exactly the reset we asked for).
            }
            settle()
          })
        }, RESET_SETTLE_MS)
      })
    })
  })
}

type ListedPort = Awaited<ReturnType<typeof SerialPort.list>>[number] & {
  friendlyName?: string
  pnpId?: string
}

async function waitForBootloaderPort(
  before: ListedPort[],
  originalPort: string,
  signal?: AbortSignal
): Promise<string> {
  const deadline = Date.now() + BOOTLOADER_WAIT_MS
  const beforePaths = new Set(before.map((port) => port.path))
  const originalMeta = before.find((port) => port.path === originalPort)
  let sawDisappear = false
  let fallback: ListedPort | null = null
  while (Date.now() < deadline) {
    throwIfAborted(signal)
    const now = await listPorts()
    const nowPaths = new Set(now.map((port) => port.path))
    const added = now.filter((port) => !beforePaths.has(port.path))
    const expected = added.filter((port) => isExpectedBootloaderPort(port, originalMeta))
    if (expected.length === 1) return expected[0].path
    if (expected.length > 1) fallback = bestBootloaderCandidate(expected, originalMeta)
    else if (added.length === 1 && !fallback) fallback = added[0]

    if (!nowPaths.has(originalPort)) sawDisappear = true
    else if (sawDisappear) {
      const reappeared = now.find((port) => port.path === originalPort)
      if (!reappeared || isExpectedBootloaderPort(reappeared, originalMeta)) return originalPort
    }
    await abortableDelay(BOOTLOADER_POLL_MS, signal)
  }
  const now = await listPorts()
  if (now.some((port) => port.path === originalPort)) return originalPort
  if (fallback) return fallback.path
  throw new FlashError(
    'Could not find the bootloader port after reset. Try again; if it persists, ' +
      'tap RESET twice quickly on the board and click Flash right away.'
  )
}

async function listPorts(): Promise<ListedPort[]> {
  try {
    return (await SerialPort.list()) as ListedPort[]
  } catch {
    return []
  }
}

function bestBootloaderCandidate(candidates: ListedPort[], original?: ListedPort): ListedPort {
  const serialMatch = candidates.find((port) => port.serialNumber && port.serialNumber === original?.serialNumber)
  if (serialMatch) return serialMatch
  const originalVid = normalizeUsbId(original?.vendorId)
  const originalPid = normalizeUsbId(original?.productId)
  const vidPidMatch = candidates.find(
    (port) =>
      originalVid &&
      originalPid &&
      normalizeUsbId(port.vendorId) === originalVid &&
      normalizeUsbId(port.productId) === originalPid
  )
  return vidPidMatch ?? candidates[0]
}

function isExpectedBootloaderPort(port: ListedPort, original?: ListedPort): boolean {
  if (port.serialNumber && port.serialNumber === original?.serialNumber) return true
  const portVid = normalizeUsbId(port.vendorId)
  const portPid = normalizeUsbId(port.productId)
  const sameVid = Boolean(portVid && portVid === normalizeUsbId(original?.vendorId))
  const samePid = Boolean(portPid && portPid === normalizeUsbId(original?.productId))
  if (sameVid && samePid) return true
  if (sameVid && isArduinoLikePort(port)) return true
  if (!original && isArduinoLikePort(port)) return true
  return Boolean(isArduinoLikePort(port) && isArduinoLikePort(original))
}

function isArduinoLikePort(port: ListedPort | undefined): boolean {
  if (!port) return false
  const text = [port.manufacturer, port.friendlyName, port.pnpId].filter(Boolean).join(' ')
  if (/arduino|leonardo|micro|sparkfun|atmega32u4|caterina|bootloader/i.test(text)) return true
  const vid = normalizeUsbId(port.vendorId)
  return Boolean(vid && ['2341', '2a03', '1b4f', '239a'].includes(vid))
}

function normalizeUsbId(value: string | undefined): string | undefined {
  return value?.toLowerCase().replace(/^0x/, '')
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return delay(ms)
  if (signal.aborted) return Promise.reject(new FlashAbortError())
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onAbort = (): void => {
      if (timer) clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(new FlashAbortError())
    }
    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new FlashAbortError()
}

export function isFlashAbortError(error: unknown): boolean {
  return error instanceof FlashAbortError || (error instanceof Error && error.name === 'FlashAbortError')
}

function killChild(child: ChildProcessWithoutNullStreams): void {
  try {
    if (!child.killed) child.kill('SIGTERM')
  } catch {
    // best-effort
  }
  setTimeout(() => {
    try {
      if (!child.killed) child.kill('SIGKILL')
    } catch {
      // best-effort
    }
  }, 1500).unref?.()
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
