import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import type { App } from 'electron'
import { BOARD_CATALOG, type BoardCatalogEntry, type MergedCatalog, type PinoutComponentDefinition } from '../../shared/board-catalog'
import {
  PINOUT_CHANNELS,
  PINOUT_STORE_FILE,
  PINOUT_STORE_VERSION,
  buildPinoutConfigPayload,
  defaultPinoutPayload,
  normalizePinoutDesign,
  validatePinout,
  type PinoutCompileRequest,
  type PinoutCompileResult,
  type PinoutConfigPayload,
  type PinoutDesign,
  type PinoutDesignsPayload,
  type PinoutExportInoRequest,
  type PinoutFlashRequest,
  type PinoutFlashResult
} from '../../shared/pinout'
import { FLASH_BOARDS, findFlashBaud, flashBaudCandidates, type FlashBoardSpec, type FlashProgress } from '../../shared/setup'
import type { PortInfo } from '../../shared/ipc'
import type { ModuleContext } from '../module-context'
import { loadMergedCatalog } from '../modules/custom-catalog'
import { flashFirmware, resolveFlashToolPaths } from './flasher'
import { generateIno } from './pinout-sketch'
import {
  matchesSimXPrimaryIdentity,
  readSimXPrimaryIdentity,
  saveSimXPrimaryIdentity
} from '../serial-devices/simx-identity'

const CONFIG_APPLY_COMMAND = 'PCFG'
const CONFIG_PROTOCOL = 'ubb.pinout.config.v1'
const COMPILE_TIMEOUT_MS = 180_000
const PORT_RELEASE_MS = 400

export interface PinoutFirmwareConfigEnvelope {
  command: typeof CONFIG_APPLY_COMMAND
  protocol: typeof CONFIG_PROTOCOL
  encoding: 'json-line'
  baud: 115200
  payload: PinoutConfigPayload
  serialFrame: string
  notes: string[]
}

export function register(ctx: ModuleContext): void {
  const store = new PinoutDesignStore(ctx.app)
  void store.ensureLoaded()

  ctx.ipcMain.handle(PINOUT_CHANNELS.list, async () => {
    await store.ensureLoaded()
    return store.list()
  })
  ctx.ipcMain.handle(PINOUT_CHANNELS.get, async (_event, id: string) => {
    await store.ensureLoaded()
    return store.get(id)
  })
  ctx.ipcMain.handle(PINOUT_CHANNELS.save, async (_event, design: Partial<PinoutDesign>) => {
    const saved = await store.save(design)
    return saved
  })
  ctx.ipcMain.handle(PINOUT_CHANNELS.remove, async (_event, id: string) => {
    await store.remove(id)
    return store.list()
  })
  ctx.ipcMain.handle(PINOUT_CHANNELS.validate, async (_event, design: PinoutDesign) => {
    const merged = await loadMergedCatalog(ctx.app)
    const normalized = normalizePinoutDesign(design)
    return validatePinout(normalized, resolveBoard(merged, normalized.boardId), merged.components)
  })
  ctx.ipcMain.handle(PINOUT_CHANNELS.generateConfig, async (_event, design: PinoutDesign) => {
    const merged = await loadMergedCatalog(ctx.app)
    return buildConfigEnvelope(normalizePinoutDesign(design), merged.components)
  })
  ctx.ipcMain.handle(PINOUT_CHANNELS.exportIno, async (_event, request: PinoutExportInoRequest) => exportPinoutIno(ctx.app, request))
  ctx.ipcMain.handle(PINOUT_CHANNELS.compile, async (_event, request: PinoutCompileRequest) => compilePinoutSketch(ctx.app, request))
  ctx.ipcMain.handle(PINOUT_CHANNELS.flash, async (_event, request: PinoutFlashRequest) => flashPinoutFirmware(ctx, request))
}

/** Resolve a board from the merged catalog (built-in + custom), falling back to the Nano. */
function resolveBoard(merged: MergedCatalog, boardId: string): BoardCatalogEntry {
  return merged.boardsById[boardId] ?? merged.boardsById.nano ?? BOARD_CATALOG.nano
}

export function buildConfigEnvelope(design: PinoutDesign, library?: PinoutComponentDefinition[]): PinoutFirmwareConfigEnvelope {
  const normalized = normalizePinoutDesign(design)
  const payload = buildPinoutConfigPayload(normalized, library)
  return {
    command: CONFIG_APPLY_COMMAND,
    protocol: CONFIG_PROTOCOL,
    encoding: 'json-line',
    baud: 115200,
    payload,
    serialFrame: `${CONFIG_APPLY_COMMAND}:${JSON.stringify(payload)}`,
    notes: [
      'Generic companion firmware listens at 115200 baud.',
      'Host sends one newline-terminated frame: PCFG:<json>.',
      'Firmware validates protocol==ubb.pinout.config.v1, applies pins/mux map in RAM/EEPROM, then replies PCFG:OK or PCFG:ERR:<reason>.',
      'No CBOR dependency is required; JSON is used for dev readability. CBOR can be added later behind the same command.'
    ]
  }
}

export async function exportPinoutIno(app: App, request: PinoutExportInoRequest): Promise<string> {
  const design = normalizePinoutDesign(request.design)
  const merged = await loadMergedCatalog(app)
  return generateIno(design, resolveBoard(merged, design.boardId), merged.components)
}

export async function compilePinoutSketch(app: App, request: PinoutCompileRequest): Promise<PinoutCompileResult> {
  const design = normalizePinoutDesign(request.design)
  const merged = await loadMergedCatalog(app)
  const board = resolveBoard(merged, design.boardId)
  const validation = validatePinout(design, board, merged.components)
  if (!validation.ok) {
    return { ok: false, message: `Corrija o pinout antes de compilar: ${validation.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message).join(' ')}`, fqbn: board.fqbn, log: [] }
  }
  if (!board.fqbn) return { ok: false, message: `A placa ${board.name} não tem FQBN configurado para arduino-cli.`, log: [] }

  const cli = await resolveArduinoCli()
  if (!cli) {
    return { ok: false, message: 'arduino-cli não encontrado no PATH. Instale/configure o Arduino CLI e os cores da placa para compilar.', fqbn: board.fqbn, log: [] }
  }

  const safeName = sanitizeSketchName(request.sketchName || design.name || design.id)
  const buildsBase = join(app.getPath('userData'), 'pinout-builds')
  const safeId = sanitizeSketchName(design.id) || 'design'
  const buildRoot = join(buildsBase, safeId)
  // Defense in depth: a crafted design.id must never escape the builds folder —
  // a recursive rm/write outside userData would be destructive.
  if (buildRoot !== buildsBase && !buildRoot.startsWith(buildsBase + sep)) {
    return { ok: false, message: 'Design inválido (id).', fqbn: board.fqbn, log: [] }
  }
  const sketchDir = join(buildRoot, safeName)
  const sketchPath = join(sketchDir, `${safeName}.ino`)
  const outputDir = join(buildRoot, 'build')
  await rm(buildRoot, { recursive: true, force: true })
  await mkdir(sketchDir, { recursive: true })
  await mkdir(outputDir, { recursive: true })
  await writeFile(sketchPath, generateIno(design, board, merged.components), 'utf8')

  const args = ['compile', '--fqbn', board.fqbn, '--output-dir', outputDir, sketchDir]
  const log: string[] = [`> ${cli} ${args.join(' ')}`]
  try {
    await runArduinoCli(cli, args, log)
    const hexPath = await findFirstHex(outputDir)
    return { ok: true, message: hexPath ? 'Firmware compilado. Grave o .hex na bancada/Windows após validar as libs necessárias.' : 'Compile concluiu, mas nenhum .hex foi encontrado no output-dir.', sketchPath, buildDir: outputDir, hexPath, fqbn: board.fqbn, log }
  } catch (error) {
    return { ok: false, message: `arduino-cli compile falhou: ${error instanceof Error ? error.message : String(error)}`, sketchPath, buildDir: outputDir, fqbn: board.fqbn, log }
  }
}

export async function flashPinoutFirmware(ctx: ModuleContext, request: PinoutFlashRequest): Promise<PinoutFlashResult> {
  const design = normalizePinoutDesign(request.design)
  const merged = await loadMergedCatalog(ctx.app)
  const board = resolveBoard(merged, design.boardId)
  const log: string[] = []
  const port = String(request.port ?? '').trim()
  if (!port) return { ok: false, message: 'Selecione uma porta serial antes de gravar.', log }

  const spec = resolvePinoutFlashBoard(board)
  if (!spec) {
    return { ok: false, message: 'Gravação automática ainda não suportada para esta placa — exporte o firmware e grave pelo Arduino IDE.', log }
  }

  const emit = (progress: FlashProgress): void => {
    log.push(progress.line ?? progress.message)
    ctx.broadcast(PINOUT_CHANNELS.flashProgress, progress)
  }

  try {
    await assertSafePinoutFlashTarget(ctx, port)
    emit({ phase: 'prepare', message: `Compilando firmware gerado para ${board.name}…`, percent: 4 })
    const compiled = await compilePinoutSketch(ctx.app, { design, sketchName: sanitizeSketchName(design.name || design.id) })
    log.push(...compiled.log)
    if (!compiled.ok) {
      emit({ phase: 'error', message: compiled.message, percent: 100, tone: 'error' })
      return { ok: false, message: compiled.message, log }
    }

    const flashPath = spec.programmer === 'arduino-cli' ? compiled.sketchPath : compiled.hexPath
    if (!flashPath) {
      const artifact = spec.programmer === 'arduino-cli' ? 'sketch gerado' : '.hex compilado'
      const message = `Compile concluído, mas o ${artifact} não foi encontrado para gravação.`
      emit({ phase: 'error', message, percent: 100, tone: 'error' })
      return { ok: false, message, log }
    }

    const baud = findFlashBaud(spec, request.baudId)
    emit({ phase: 'prepare', message: `Preparando gravação em ${port} (${spec.name}, ${baud.label})…`, percent: 8 })
    await freePort(ctx, port)
    await flashFirmware({
      board: spec,
      port,
      hexPath: flashPath,
      baud: baud.baud,
      baudCandidates: flashBaudCandidates(spec, request.baudId),
      tools: resolveFlashToolPaths(ctx.app),
      onProgress: emit
    })
    emit({ phase: 'done', message: 'Firmware gerado gravado com sucesso.', percent: 100, tone: 'success' })
    return { ok: true, message: 'Firmware gerado gravado com sucesso.', log }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emit({ phase: 'error', message, percent: 100, tone: 'error' })
    return { ok: false, message, log }
  }
}

async function assertSafePinoutFlashTarget(ctx: ModuleContext, port: string): Promise<PortInfo | undefined> {
  const portInfo = (await ctx.serialHub.listPorts()).find((entry) => entry.path === port)
  if (portInfo?.isSimX) {
    await saveSimXPrimaryIdentity(ctx.app, portInfo).catch((error) =>
      console.warn('[pinout-firmware] failed to save SIM-X primary identity:', error instanceof Error ? error.message : String(error))
    )
    throw new Error('Essa é a porta do SIM-X. Não grave firmware gerado pelo Pinout Designer nela — use um Arduino secundário.')
  }

  const storedSimX = await readSimXPrimaryIdentity(ctx.app)
  if (storedSimX && matchesSimXPrimaryIdentity(storedSimX, port, portInfo)) {
    throw new Error('Essa porta corresponde ao SIM-X principal salvo. Não grave firmware gerado pelo Pinout Designer nela.')
  }

  const existing = ctx.serialHub.listDevices().find((device) => device.path === port)
  const primaryId = ctx.serialHub.getPrimaryId()
  if (existing && (existing.kind === 'sim-x' || existing.id === primaryId)) {
    throw new Error('Essa porta é o SIM-X principal — não grave firmware gerado nela. Escolha a porta de um Arduino secundário.')
  }
  return portInfo
}

async function freePort(ctx: ModuleContext, port: string): Promise<void> {
  const existing = ctx.serialHub.listDevices().find((device) => device.path === port)
  if (!existing) return
  const primaryId = ctx.serialHub.getPrimaryId()
  if (existing.kind === 'sim-x' || existing.id === primaryId) {
    throw new Error('Essa porta é o SIM-X principal — não grave firmware nela por aqui. Escolha a porta de um Arduino secundário.')
  }
  await ctx.serialHub.disconnectDevice(existing.id).catch(() => undefined)
  await delay(PORT_RELEASE_MS)
}

function resolvePinoutFlashBoard(board: BoardCatalogEntry): FlashBoardSpec | null {
  if (board.mcu === 'ATmega2560' || board.mcu === 'ATmega4809') return null
  if (board.id === 'uno') return FLASH_BOARDS.find((spec) => spec.id === 'uno') ?? null
  if (board.id === 'nano') return FLASH_BOARDS.find((spec) => spec.id === 'nano') ?? null
  if (board.mcu === 'ATmega328P') return FLASH_BOARDS.find((spec) => spec.mcu === 'atmega328p') ?? null
  if (board.mcu === 'ATmega32U4') return FLASH_BOARDS.find((spec) => spec.mcu === 'atmega32u4') ?? null
  if (board.mcu === 'ESP32') return FLASH_BOARDS.find((spec) => spec.mcu === 'esp32') ?? null
  if (board.mcu === 'ESP32-S3') return FLASH_BOARDS.find((spec) => spec.mcu === 'esp32s3') ?? null
  return null
}

class PinoutDesignStore {
  private payload: PinoutDesignsPayload = defaultPinoutPayload()
  private loaded = false
  private readonly path: string

  constructor(app: App) {
    this.path = join(app.getPath('userData'), PINOUT_STORE_FILE)
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    try {
      const raw = JSON.parse(await readFile(this.path, 'utf8')) as Partial<PinoutDesignsPayload>
      this.payload = {
        version: PINOUT_STORE_VERSION,
        designs: Array.isArray(raw.designs) ? raw.designs.map((design) => normalizePinoutDesign(design)) : [],
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString()
      }
    } catch {
      this.payload = defaultPinoutPayload()
    }
    this.loaded = true
  }

  list(): PinoutDesign[] { return this.payload.designs }
  get(id: string): PinoutDesign | null { return this.payload.designs.find((design) => design.id === id) ?? null }

  async save(input: Partial<PinoutDesign>): Promise<PinoutDesign> {
    await this.ensureLoaded()
    const design = normalizePinoutDesign(input)
    design.updatedAt = new Date().toISOString()
    const index = this.payload.designs.findIndex((item) => item.id === design.id)
    if (index >= 0) {
      design.createdAt = this.payload.designs[index].createdAt
      this.payload.designs[index] = design
    } else {
      this.payload.designs.unshift(design)
    }
    await this.persist()
    return design
  }

  async remove(id: string): Promise<void> {
    await this.ensureLoaded()
    this.payload.designs = this.payload.designs.filter((design) => design.id !== id)
    await this.persist()
  }

  private async persist(): Promise<void> {
    this.payload.updatedAt = new Date().toISOString()
    await mkdir(dirname(this.path), { recursive: true })
    await writeFile(this.path, JSON.stringify(this.payload, null, 2), 'utf8')
  }
}

async function resolveArduinoCli(): Promise<string | null> {
  const candidates = process.platform === 'win32' ? ['arduino-cli.exe'] : ['arduino-cli', '/opt/homebrew/bin/arduino-cli', '/usr/local/bin/arduino-cli']
  for (const candidate of candidates) {
    if (candidate.includes('/') && !existsSync(candidate)) continue
    const ok = await runProbe(candidate, ['version'])
    if (ok) return candidate
  }
  return null
}

function runProbe(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}

function runArduinoCli(command: string, args: string[], log: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('tempo esgotado no arduino-cli compile'))
    }, COMPILE_TIMEOUT_MS)
    child.stdout?.on('data', (chunk: Buffer) => appendLines(log, chunk))
    child.stderr?.on('data', (chunk: Buffer) => appendLines(log, chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`exit code ${code ?? 'desconhecido'}`))
    })
  })
}

function appendLines(log: string[], chunk: Buffer): void {
  for (const line of chunk.toString('utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed) log.push(trimmed)
  }
}

async function findFirstHex(dir: string): Promise<string | undefined> {
  const entries = await readdir(dir, { withFileTypes: true })
  // arduino-cli emits both `<sketch>.ino.hex` (application) and
  // `<sketch>.ino.with_bootloader.hex`. avrdude `-c arduino` (serial Optiboot)
  // must receive the APPLICATION-ONLY image — never the bootloader-merged one.
  // Prefer the plain .hex regardless of directory-read order; only fall back to
  // the bootloader image if no application-only hex exists anywhere.
  let bootloaderHex: string | undefined
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isFile() && entry.name.endsWith('.hex')) {
      if (entry.name.endsWith('.with_bootloader.hex')) {
        bootloaderHex = bootloaderHex ?? full
      } else {
        return full
      }
    }
    if (entry.isDirectory()) {
      const nested = await findFirstHex(full)
      if (nested) return nested
    }
  }
  return bootloaderHex
}

function sanitizeSketchName(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+/, '').slice(0, 48)
  return safe || 'PinoutFirmware'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
