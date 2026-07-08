import { app } from 'electron'
import { existsSync } from 'node:fs'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FixIracingFullscreenResult, IracingDisplayMode, IracingGraphicsStatus } from '../../shared/overlays'

// iRacing stores its display mode in Documents/iRacing/app.ini under
// [Graphics Options]. Window overlays (this app, SimHub, RaceLab, etc.) can
// NEVER draw over DirectX *exclusive* fullscreen — only borderless/windowed.
// The only reliable, dependency-free "definitive" fix is to detect the current
// mode from app.ini and offer to switch the sim to borderless (with a backup).
// True over-exclusive rendering would require DirectX injection (out of scope,
// anti-cheat risk).

const SECTION = 'Graphics Options'

export type { IracingDisplayMode, IracingGraphicsStatus } from '../../shared/overlays'
export type FixFullscreenResult = FixIracingFullscreenResult

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function iniPath(): string {
  // app.getPath('documents') honors the real Documents folder on Windows
  // (including OneDrive redirection) better than homedir + 'Documents'.
  return join(app.getPath('documents'), 'iRacing', 'app.ini')
}

function isSectionHeader(line: string): string | null {
  const trimmed = line.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed.slice(1, -1).trim()
  return null
}

function findKeyLine(lines: string[], section: string, key: string): { index: number; value: string } | null {
  const targetSection = section.toLowerCase()
  const targetKey = key.toLowerCase()
  let inSection = false
  for (let i = 0; i < lines.length; i += 1) {
    const header = isSectionHeader(lines[i])
    if (header !== null) {
      inSection = header.toLowerCase() === targetSection
      continue
    }
    if (!inSection) continue
    const eq = lines[i].indexOf('=')
    if (eq === -1) continue
    if (lines[i].slice(0, eq).trim().toLowerCase() === targetKey) {
      return { index: i, value: lines[i].slice(eq + 1).trim() }
    }
  }
  return null
}

function setKeyValue(lines: string[], section: string, key: string, value: string): string[] {
  const existing = findKeyLine(lines, section, key)
  if (existing) {
    const original = lines[existing.index]
    const eq = original.indexOf('=')
    lines[existing.index] = `${original.slice(0, eq + 1)}${value}`
    return lines
  }
  // Key missing: insert right after the section header, or append the section.
  const targetSection = section.toLowerCase()
  let headerIndex = -1
  for (let i = 0; i < lines.length; i += 1) {
    const header = isSectionHeader(lines[i])
    if (header !== null && header.toLowerCase() === targetSection) {
      headerIndex = i
      break
    }
  }
  if (headerIndex === -1) {
    lines.push(`[${section}]`, `${key}=${value}`)
  } else {
    lines.splice(headerIndex + 1, 0, `${key}=${value}`)
  }
  return lines
}

function describeMode(mode: IracingDisplayMode): string {
  switch (mode) {
    case 'exclusive':
      return 'iRacing is in EXCLUSIVE FULLSCREEN. Window overlays do not appear in this mode (also true for SimHub/RaceLab). Click "Fix" to switch iRacing to borderless.'
    case 'borderless':
      return 'iRacing is in borderless mode — overlays work on top.'
    case 'windowed':
      return 'iRacing is in windowed mode — overlays work on top.'
    default:
      return 'Could not determine the iRacing video mode in app.ini.'
  }
}

function resolveMode(fullScreen: boolean | null, borderlessWindowed: boolean | null): IracingDisplayMode {
  if (borderlessWindowed === true) return 'borderless'
  if (fullScreen === true) return 'exclusive'
  if (fullScreen === false) return 'windowed'
  return 'unknown'
}

export async function readIracingGraphicsStatus(): Promise<IracingGraphicsStatus> {
  const platform = process.platform
  if (platform !== 'win32') {
    return {
      supported: false,
      platform,
      iniPath: null,
      exists: false,
      mode: 'unknown',
      fullScreen: null,
      borderlessWindowed: null,
      overlaysWillShow: true,
      message: 'iRacing fullscreen detection is only available on Windows. On macOS, adjust the video mode manually in-game (use borderless).'
    }
  }

  const path = iniPath()
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return {
      supported: true,
      platform,
      iniPath: path,
      exists: false,
      mode: 'unknown',
      fullScreen: null,
      borderlessWindowed: null,
      overlaysWillShow: true,
      message: `iRacing app.ini not found at ${path}. Open iRacing at least once to generate it.`
    }
  }

  const lines = text.split(/\r?\n/)
  const fullScreenLine = findKeyLine(lines, SECTION, 'fullScreen')
  const borderlessLine = findKeyLine(lines, SECTION, 'borderlessWindowed')
  const fullScreen = fullScreenLine ? fullScreenLine.value === '1' : null
  const borderlessWindowed = borderlessLine ? borderlessLine.value === '1' : null
  const mode = resolveMode(fullScreen, borderlessWindowed)

  return {
    supported: true,
    platform,
    iniPath: path,
    exists: true,
    mode,
    fullScreen,
    borderlessWindowed,
    overlaysWillShow: mode !== 'exclusive',
    message: describeMode(mode)
  }
}

export async function fixIracingFullscreen(): Promise<FixFullscreenResult> {
  if (process.platform !== 'win32') {
    return {
      ok: false,
      changed: false,
      backupPath: null,
      message: 'app.ini can only be adjusted on Windows.'
    }
  }

  const path = iniPath()
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return {
      ok: false,
      changed: false,
      backupPath: null,
      message: `app.ini not found at ${path}. Open iRacing at least once.`
    }
  }

  const backupPath = `${path}.ubbak`
  // Preserve the user's ORIGINAL app.ini: only back up if no backup exists yet,
  // so running "Corrigir" twice never overwrites the pristine original.
  if (!existsSync(backupPath)) {
    try {
      await copyFile(path, backupPath)
    } catch (error) {
      return {
        ok: false,
        changed: false,
        backupPath: null,
        message: `Could not create the app.ini backup: ${errorMessage(error)}`
      }
    }
  }

  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  let lines = text.split(/\r?\n/)
  lines = setKeyValue(lines, SECTION, 'fullScreen', '0')
  lines = setKeyValue(lines, SECTION, 'borderlessWindowed', '1')
  const next = lines.join(eol)
  const changed = next !== text

  try {
    await writeFile(path, next, 'utf8')
  } catch (error) {
    return {
      ok: false,
      changed: false,
      backupPath,
      message: `Failed to write app.ini: ${errorMessage(error)}`
    }
  }

  return {
    ok: true,
    changed,
    backupPath,
    message: changed
      ? `iRacing ajustado para borderless. Backup salvo em ${backupPath}. Feche e reabra o iRacing para aplicar.`
      : 'iRacing was already borderless — no change needed.'
  }
}
