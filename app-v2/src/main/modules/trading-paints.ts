import type { ModuleContext } from '../module-context'
import { shell } from 'electron'
import { access, readdir, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import {
  TRADING_PAINTS_CHANNELS,
  type TradingPaintsClientInfo,
  type TradingPaintsDriverInput,
  type TradingPaintsDriverPaintStatus,
  type TradingPaintsOpenClientResult,
  type TradingPaintsStatusRequest,
  type TradingPaintsStatusResult
} from '../../shared/trading-paints'

const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000
const INSTALL_URL = 'https://www.tradingpaints.com/install'

export function register(ctx: ModuleContext): void {
  ctx.ipcMain.handle(TRADING_PAINTS_CHANNELS.clientInfo, () => detectClient())
  ctx.ipcMain.handle(TRADING_PAINTS_CHANNELS.status, (_event, request: TradingPaintsStatusRequest) => getPaintStatus(ctx, request))
  ctx.ipcMain.handle(TRADING_PAINTS_CHANNELS.openClient, () => openClient())
}

async function detectClient(): Promise<TradingPaintsClientInfo> {
  const platform = process.platform
  if (platform !== 'win32') return { installed: false, platform }

  const roots = [
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'TradingPaints') : undefined,
    process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, 'Trading Paints') : undefined,
    process.env['PROGRAMFILES(X86)'] ? join(process.env['PROGRAMFILES(X86)'], 'Trading Paints') : undefined,
    join(homedir(), 'AppData', 'Local', 'TradingPaints')
  ].filter((item): item is string => Boolean(item))

  for (const root of roots) {
    if (!(await exists(root))) continue
    const executablePath = await findClientExecutable(root)
    return { installed: true, platform, path: root, executablePath }
  }

  return { installed: false, platform }
}

async function openClient(): Promise<TradingPaintsOpenClientResult> {
  const info = await detectClient()
  if (info.installed) {
    const target = info.executablePath ?? info.path
    if (target) {
      const message = await shell.openPath(target)
      if (!message) return { ok: true }
    }
  }

  await shell.openExternal(INSTALL_URL)
  return { ok: true, message: info.installed ? 'Trading Paints was found, but the app could not be opened. Opening the official website.' : 'Trading Paints not found. Opening the official website.' }
}

async function getPaintStatus(ctx: ModuleContext, request: TradingPaintsStatusRequest): Promise<TradingPaintsStatusResult> {
  const paintRoot = getPaintRoot(ctx)
  if (process.platform !== 'win32') return { supported: false, paintRoot, statuses: [] }
  if (!(await exists(paintRoot))) return { supported: true, paintRoot, statuses: [] }

  const checkedAt = Date.now()
  const drivers = Array.isArray(request?.drivers) ? request.drivers : []
  const statuses: TradingPaintsDriverPaintStatus[] = []

  for (const driver of drivers) {
    const normalized = normalizeDriver(driver)
    if (!normalized) continue

    const carDir = safeCarDir(paintRoot, normalized.carPath)
    if (!carDir) {
      statuses.push({ ...normalized, status: 'missing', checkedAt })
      continue
    }

    const match = await findPaintFile(carDir, normalized.custId)
    statuses.push({
      ...normalized,
      status: match ? (checkedAt - match.mtimeMs > STALE_AFTER_MS ? 'stale' : 'downloaded') : 'missing',
      fileName: match?.fileName,
      mtimeMs: match?.mtimeMs,
      checkedAt
    })
  }

  return { supported: true, paintRoot, statuses }
}

function getPaintRoot(ctx: ModuleContext): string {
  return join(ctx.app.getPath('documents'), 'iRacing', 'paint')
}

function normalizeDriver(driver: TradingPaintsDriverInput): Omit<TradingPaintsDriverPaintStatus, 'status' | 'checkedAt' | 'fileName' | 'mtimeMs'> | null {
  const custId = Number(driver?.custId)
  const carPath = typeof driver?.carPath === 'string' ? driver.carPath.trim() : ''
  if (!Number.isInteger(custId) || custId <= 0 || !carPath) return null
  return {
    custId,
    carPath,
    name: cleanText(driver.name) || `Cust ID #${custId}`,
    carNumber: cleanText(driver.carNumber)
  }
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.trim().slice(0, 160)
  return clean || undefined
}

function safeCarDir(paintRoot: string, carPath: string): string | null {
  if (isAbsolute(carPath)) return null
  const parts = carPath.split(/[\\/]+/).filter(Boolean)
  if (parts.length === 0) return null
  if (!parts.every((part) => part !== '.' && part !== '..' && /^[A-Za-z0-9._-]+$/.test(part))) return null
  const resolved = join(paintRoot, ...parts)
  const rel = relative(paintRoot, resolved)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  return resolved
}

async function findPaintFile(carDir: string, custId: number): Promise<{ fileName: string; mtimeMs: number } | null> {
  const expected = [
    `car_${custId}.tga`,
    `car_${custId}.mip`,
    `car_${custId}.png`,
    `car_${custId}.jpg`,
    `car_${custId}.jpeg`
  ]

  let newest: { fileName: string; mtimeMs: number } | null = null
  for (const fileName of expected) {
    try {
      const info = await stat(join(carDir, fileName))
      if (!info.isFile()) continue
      if (!newest || info.mtimeMs > newest.mtimeMs) newest = { fileName, mtimeMs: info.mtimeMs }
    } catch {
      // Missing individual paint files are expected.
    }
  }
  return newest
}

async function findClientExecutable(root: string): Promise<string | undefined> {
  const direct = [
    join(root, 'Trading Paints.exe'),
    join(root, 'TradingPaints.exe'),
    join(root, 'Trading Paints Downloader.exe')
  ]
  for (const candidate of direct) {
    if (await exists(candidate)) return candidate
  }

  try {
    const entries = await readdir(root, { withFileTypes: true })
    const exe = entries.find((entry) => entry.isFile() && /trading.*paints.*\.exe$/i.test(entry.name))
    return exe ? join(root, exe.name) : undefined
  } catch {
    return undefined
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}
