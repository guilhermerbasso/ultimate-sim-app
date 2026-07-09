import { existsSync } from 'node:fs'
import { app as electronApp } from 'electron'
import type { FlashBoardSpec, FlashProgress } from '../../shared/setup'
import { ensureAvrdude } from './avrdude-fetch'
import {
  FlashError,
  prepareAvrdudePort,
  runAvrdude,
  type FlashToolPaths,
  throwIfAborted
} from './flasher'

const DEFAULT_DUMP_TIMEOUT_MS = 120_000

export interface DumpHexOptions {
  board: FlashBoardSpec
  port: string
  baud: number
  outputPath: string
  tools: FlashToolPaths
  onProgress: (progress: FlashProgress) => void
  timeoutMs?: number
  signal?: AbortSignal
}

export async function dumpHexFirmware(opts: DumpHexOptions): Promise<void> {
  if (opts.board.flashTool === 'arduino-cli' || opts.board.programmer === 'arduino-cli') {
    throw new FlashError('.hex backup through avrdude is not available for ESP32/arduino-cli boards.')
  }
  if (process.platform !== 'win32') {
    throw new FlashError('.hex backup through avrdude is only available on Windows.')
  }
  if (!opts.port.trim()) throw new FlashError('Select the board serial (COM) port.')
  const tools = { ...opts.tools, avrdudeExe: await resolveUsableAvrdudeExe(opts.tools.avrdudeExe) }
  if (!existsSync(opts.tools.avrdudeConf)) {
    throw new FlashError(`avrdude.conf was not found em ${opts.tools.avrdudeConf}.`)
  }

  throwIfAborted(opts.signal)
  const targetPort = await prepareAvrdudePort(opts.board, opts.port, opts.onProgress, opts.signal)
  const args = [
    '-C',
    tools.avrdudeConf,
    '-c',
    opts.board.programmer,
    '-p',
    opts.board.mcu,
    '-P',
    targetPort,
    '-b',
    String(opts.baud),
    '-U',
    `flash:r:${opts.outputPath}:i`
  ]
  opts.onProgress({
    phase: 'upload',
    message: `Lendo firmware da placa para ${opts.outputPath}…`,
    percent: 20,
    line: `> avrdude ${args.join(' ')}`
  })
  await runAvrdude(tools.avrdudeExe, args, opts.onProgress, opts.timeoutMs ?? DEFAULT_DUMP_TIMEOUT_MS, opts.signal)
  opts.onProgress({
    phase: 'done',
    message: `Backup .hex salvo em ${opts.outputPath}.`,
    percent: 100,
    tone: 'success'
  })
}

async function resolveUsableAvrdudeExe(bundledPath: string): Promise<string> {
  try {
    return await ensureAvrdude(electronApp)
  } catch (error) {
    if (existsSync(bundledPath)) return bundledPath
    throw new FlashError(error instanceof Error ? error.message : String(error))
  }
}
