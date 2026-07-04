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
      return 'iRacing está em TELA CHEIA EXCLUSIVA. Nenhum overlay de janela aparece nesse modo (vale para SimHub/RaceLab também). Clique em "Corrigir" para mudar o iRacing para borderless.'
    case 'borderless':
      return 'iRacing está em modo borderless (janela sem bordas) — os overlays funcionam por cima.'
    case 'windowed':
      return 'iRacing está em modo janela — os overlays funcionam por cima.'
    default:
      return 'Não foi possível determinar o modo de vídeo do iRacing no app.ini.'
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
      message: 'A detecção de tela cheia do iRacing só está disponível no Windows. No macOS, ajuste o modo de vídeo manualmente dentro do jogo (use borderless).'
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
      message: `app.ini do iRacing não encontrado em ${path}. Abra o iRacing pelo menos uma vez para gerá-lo.`
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
      message: 'Só é possível ajustar o app.ini do iRacing no Windows.'
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
      message: `app.ini não encontrado em ${path}. Abra o iRacing pelo menos uma vez.`
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
        message: `Não foi possível criar o backup do app.ini: ${errorMessage(error)}`
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
      message: `Falha ao gravar o app.ini: ${errorMessage(error)}`
    }
  }

  return {
    ok: true,
    changed,
    backupPath,
    message: changed
      ? `iRacing ajustado para borderless. Backup salvo em ${backupPath}. Feche e reabra o iRacing para aplicar.`
      : 'iRacing já estava em borderless — nenhuma mudança necessária.'
  }
}
