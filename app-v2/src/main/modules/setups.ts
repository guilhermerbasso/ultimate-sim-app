import type { ModuleContext } from '../module-context'
import { dialog, shell, type OpenDialogOptions } from 'electron'
import { lookup } from 'node:dns/promises'
import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { createWriteStream, watch, type FSWatcher } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { basename, dirname, extname, join, normalize, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform, type Readable } from 'node:stream'
import {
  DEFAULT_SETUPS_CONFIG,
  SETUPS_CHANNELS,
  type InstallResult,
  type SetupFileInfo,
  type SetupSource,
  type SetupsConfig,
  type SetupsEnv
} from '../../shared/setups'

const CONFIG_FILE = 'setups.json'
const MAX_MANIFEST_BYTES = 512 * 1024
const MAX_STO_BYTES = 50 * 1024 * 1024
const AUTO_INSTALL_DEBOUNCE_MS = 900

interface ManifestFileEntry {
  fileName?: unknown
  url?: unknown
  car?: unknown
}

interface ManifestPayload {
  files?: ManifestFileEntry[]
}

interface InstallArgs {
  file: SetupFileInfo
  carFolder: string
  rememberFor?: string
}

interface DetectCarResult {
  carName?: string
  suggestedFolder?: string
}

let config: SetupsConfig = DEFAULT_SETUPS_CONFIG
let watcher: FSWatcher | null = null
let watcherTimer: ReturnType<typeof setTimeout> | null = null
let autoSeen = new Set<string>()
let autoInstalling = false
let autoRunPending = false
let refreshGen = 0

export function register(ctx: ModuleContext): void {
  const configPath = join(ctx.app.getPath('userData'), CONFIG_FILE)

  void loadConfig(configPath).then((loaded) => {
    config = loaded
    ctx.broadcast(SETUPS_CHANNELS.config, config)
    void refreshAutoInstall(ctx, configPath)
  })

  ctx.ipcMain.handle(SETUPS_CHANNELS.getConfig, () => config)
  ctx.ipcMain.handle(SETUPS_CHANNELS.setConfig, async (_event, patch: Partial<SetupsConfig>) => {
    config = mergeConfig(config, patch)
    await saveConfig(configPath, config)
    ctx.broadcast(SETUPS_CHANNELS.config, config)
    void refreshAutoInstall(ctx, configPath)
    return config
  })
  ctx.ipcMain.handle(SETUPS_CHANNELS.env, (): SetupsEnv => getEnv(ctx))
  ctx.ipcMain.handle(SETUPS_CHANNELS.listCarFolders, () => listCarFolders(ctx))
  ctx.ipcMain.handle(SETUPS_CHANNELS.listSource, (_event, sourceId: string) => listSource(ctx, sourceId))
  ctx.ipcMain.handle(SETUPS_CHANNELS.detectCar, () => detectCar(ctx))
  ctx.ipcMain.handle(SETUPS_CHANNELS.install, (_event, args: InstallArgs) => installSetup(ctx, configPath, args))
  ctx.ipcMain.handle(SETUPS_CHANNELS.openSetupsDir, async () => {
    const setupsDir = getSetupsDir(ctx)
    if (process.platform === 'win32') await mkdir(setupsDir, { recursive: true })
    return shell.openPath(setupsDir)
  })
  ctx.ipcMain.handle(SETUPS_CHANNELS.pickFolder, async () => {
    const owner = ctx.getMainWindow()
    const options: OpenDialogOptions = {
      properties: ['openDirectory'],
      title: 'Select setups folder'
    }
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    return result.canceled ? undefined : result.filePaths[0]
  })

  ctx.app.once('before-quit', closeWatcher)
}

async function loadConfig(configPath: string): Promise<SetupsConfig> {
  try {
    const raw = await readFile(configPath, 'utf8')
    return mergeConfig(DEFAULT_SETUPS_CONFIG, JSON.parse(raw) as Partial<SetupsConfig>)
  } catch {
    return { ...DEFAULT_SETUPS_CONFIG, sources: [], carNameToFolder: {}, updatedAt: Date.now() }
  }
}

async function saveConfig(configPath: string, nextConfig: SetupsConfig): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8')
}

function mergeConfig(base: SetupsConfig, patch: Partial<SetupsConfig>): SetupsConfig {
  const sources = Array.isArray(patch.sources) ? patch.sources.map(sanitizeSource).filter(isSetupSource) : base.sources
  const sourceIds = new Set(sources.map((source) => source.id))
  const hasAutoInstallSourcePatch = Object.prototype.hasOwnProperty.call(patch, 'autoInstallSourceId')
  let autoInstallSourceId: string | undefined
  if (hasAutoInstallSourcePatch) {
    autoInstallSourceId =
      typeof patch.autoInstallSourceId === 'string' && sourceIds.has(patch.autoInstallSourceId)
        ? patch.autoInstallSourceId
        : undefined
  } else {
    autoInstallSourceId = sourceIds.has(base.autoInstallSourceId ?? '') ? base.autoInstallSourceId : undefined
  }

  return {
    version: 1,
    sources,
    carNameToFolder: sanitizeCarMap({ ...base.carNameToFolder, ...(patch.carNameToFolder ?? {}) }),
    autoInstall: typeof patch.autoInstall === 'boolean' ? patch.autoInstall : base.autoInstall,
    autoInstallSourceId,
    updatedAt: Date.now()
  }
}

function sanitizeSource(source: SetupSource): SetupSource | null {
  if (!source || typeof source !== 'object') return null
  const id = cleanShortText(source.id)
  const label = cleanShortText(source.label)
  if (!id || !label) return null
  if (source.kind === 'folder') {
    const path = typeof source.path === 'string' ? source.path.trim() : ''
    if (!path) return null
    return { id, kind: 'folder', label, path }
  }
  if (source.kind === 'url') {
    const url = typeof source.url === 'string' ? source.url.trim() : ''
    if (!url) return null
    return { id, kind: 'url', label, url }
  }
  return null
}

function isSetupSource(source: SetupSource | null): source is SetupSource {
  return source !== null
}

function sanitizeCarMap(value: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [carName, folder] of Object.entries(value)) {
    const cleanCar = cleanShortText(carName)
    if (!cleanCar || !isSafeFolderName(folder)) continue
    result[cleanCar] = folder.trim()
  }
  return result
}

function cleanShortText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, 180)
}

function getSetupsDir(ctx: ModuleContext): string {
  return join(ctx.app.getPath('documents'), 'iRacing', 'setups')
}

function getEnv(ctx: ModuleContext): SetupsEnv {
  return { supported: process.platform === 'win32', platform: process.platform, setupsDir: getSetupsDir(ctx) }
}

async function listCarFolders(ctx: ModuleContext): Promise<string[]> {
  if (process.platform !== 'win32') return []
  try {
    const entries = await readdir(getSetupsDir(ctx), { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && isSafeFolderName(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

async function listSource(ctx: ModuleContext, sourceId: string): Promise<SetupFileInfo[]> {
  const source = config.sources.find((item) => item.id === sourceId)
  if (!source) return []
  const carFolders = await listCarFolders(ctx)
  if (source.kind === 'folder') return listFolderSource(source, carFolders)
  return listUrlSource(source, carFolders)
}

async function listFolderSource(source: SetupSource, carFolders: string[]): Promise<SetupFileInfo[]> {
  if (!source.path) return []
  try {
    const root = source.path
    const entries = await readdir(root, { withFileTypes: true })
    const files: SetupFileInfo[] = []
    for (const entry of entries) {
      if (entry.isFile()) {
        await pushLocalSetup(files, source.id, join(root, entry.name), carFolders)
      } else if (entry.isDirectory()) {
        const childDir = join(root, entry.name)
        const childEntries = await readdir(childDir, { withFileTypes: true }).catch(() => [])
        for (const child of childEntries) {
          if (child.isFile()) await pushLocalSetup(files, source.id, join(childDir, child.name), carFolders)
        }
      }
    }
    return files.sort((a, b) => a.fileName.localeCompare(b.fileName))
  } catch {
    return []
  }
}

async function pushLocalSetup(
  files: SetupFileInfo[],
  sourceId: string,
  localPath: string,
  carFolders: string[]
): Promise<void> {
  const fileName = basename(localPath)
  if (!hasStoExtension(fileName)) return
  const info = await stat(localPath).catch(() => null)
  if (!info?.isFile()) return
  files.push({
    id: `local:${sourceId}:${normalize(localPath)}`,
    sourceId,
    fileName: sanitizeStoFileName(fileName),
    sizeBytes: info.size,
    modifiedAt: info.mtimeMs,
    suggestedCarFolder: suggestFolder(fileName, carFolders),
    localPath
  })
}

async function listUrlSource(source: SetupSource, carFolders: string[]): Promise<SetupFileInfo[]> {
  if (!source.url) return []
  await validateHttpsUrl(source.url)
  const url = new URL(source.url)
  if (hasStoExtension(url.pathname)) {
    const fileName = sanitizeStoFileName(decodeURIComponent(basename(url.pathname)))
    return [{ id: `url:${source.id}:${source.url}`, sourceId: source.id, fileName, suggestedCarFolder: suggestFolder(fileName, carFolders), url: source.url }]
  }

  const manifest = await fetchJsonManifest(source.url)
  return manifest.files
    .filter((entry) => typeof entry.url === 'string')
    .map((entry): SetupFileInfo | null => {
      const entryUrl = String(entry.url)
      validateHttpsUrlSync(entryUrl)
      const entryName = typeof entry.fileName === 'string' ? entry.fileName : basename(new URL(entryUrl).pathname)
      if (!hasStoExtension(entryName) && !hasStoExtension(new URL(entryUrl).pathname)) return null
      const fileName = sanitizeStoFileName(entryName)
      const carHint = typeof entry.car === 'string' ? entry.car : undefined
      return {
        id: `url:${source.id}:${entryUrl}`,
        sourceId: source.id,
        fileName,
        url: entryUrl,
        suggestedCarFolder: suggestFolder(carHint ?? fileName, carFolders)
      }
    })
    .filter((entry): entry is SetupFileInfo => entry !== null && hasStoExtension(entry.fileName))
}

async function fetchJsonManifest(url: string): Promise<{ files: ManifestFileEntry[] }> {
  const stream = await openValidatedHttpsStream(url)
  const text = await readStreamBounded(stream, MAX_MANIFEST_BYTES, 'Manifesto de setups muito grande.')
  const parsed = JSON.parse(text) as ManifestPayload
  return { files: Array.isArray(parsed.files) ? parsed.files : [] }
}

// Opens an HTTPS GET stream, validating the resolved IP at CONNECT time (via a
// custom DNS lookup) so a host cannot pass a pre-fetch check and then rebind to
// an internal address (TOCTOU). Redirects are refused.
function openValidatedHttpsStream(rawUrl: string): Promise<IncomingMessage> {
  const url = validateHttpsUrlSync(rawUrl)
  return new Promise((resolve, reject) => {
    const options: RequestOptions = {
      method: 'GET',
      lookup: validatingLookup as unknown as RequestOptions['lookup']
    }
    const req = httpsRequest(url, options, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400) {
        res.resume()
        reject(new Error('Redirects are not allowed for setup URLs.'))
        return
      }
      if (status < 200 || status >= 300) {
        res.resume()
        reject(new Error(`Resource unavailable (${status}).`))
        return
      }
      resolve(res)
    })
    req.on('error', reject)
    req.setTimeout(20000, () => req.destroy(new Error('Connection timed out.')))
    req.end()
  })
}

// DNS lookup wrapper that rejects the connection if ANY resolved address is
// private/internal — applied at the moment of connecting, which closes the DNS
// rebinding (TOCTOU) window left by a pre-fetch hostname check.
// Node >= 20 invokes the lookup with `{ all: true }` and expects the array-form
// callback; older Node passes `all:false` and expects the single-address form.
// We honor whichever was requested so the connection isn't aborted.
function validatingLookup(
  hostname: string,
  options: { all?: boolean } | number | undefined,
  callback: (err: Error | null, address: string | LookupAddress[], family?: number) => void
): void {
  const wantAll = typeof options === 'object' && options !== null && options.all === true
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) {
      callback(err, '', 0)
      return
    }
    const list = Array.isArray(addresses) ? addresses : []
    if (list.length === 0) {
      callback(new Error('Host has no addresses.'), '', 0)
      return
    }
    if (list.some((record) => isBlockedAddress(record.address))) {
      callback(new Error('URL resolves to an internal/private address.'), '', 0)
      return
    }
    if (wantAll) {
      callback(null, list)
    } else {
      callback(null, list[0].address, list[0].family)
    }
  })
}

// Reads a stream but aborts as soon as it exceeds `maxBytes`, so a malicious
// server cannot exhaust memory by streaming an unbounded payload.
function readStreamBounded(stream: Readable, maxBytes: number, tooBigMessage: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    stream.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
        stream.destroy()
        reject(new Error(tooBigMessage))
        return
      }
      chunks.push(chunk)
    })
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    stream.on('error', reject)
  })
}

async function detectCar(ctx: ModuleContext): Promise<DetectCarResult> {
  const carName = ctx.telemetryHub.getLatest()?.carName?.trim()
  if (!carName) return {}
  const folders = await listCarFolders(ctx)
  return { carName, suggestedFolder: config.carNameToFolder[carName] ?? fuzzyFolder(carName, folders) }
}

async function installSetup(ctx: ModuleContext, configPath: string, args: InstallArgs): Promise<InstallResult> {
  if (process.platform !== 'win32') return { ok: false, message: 'Available only on Windows' }
  const file = args?.file
  if (!file) return { ok: false, message: 'Invalid setup.' }
  if (!isSafeFolderName(args.carFolder)) return { ok: false, message: 'Invalid car folder.' }
  if (!hasStoExtension(file.fileName)) return { ok: false, message: 'Apenas arquivos .sto podem ser instalados.' }

  const fileName = sanitizeStoFileName(file.fileName)
  if (!hasStoExtension(fileName)) return { ok: false, message: 'Apenas arquivos .sto podem ser instalados.' }

  const targetDir = join(getSetupsDir(ctx), args.carFolder.trim())
  const targetPath = join(targetDir, fileName)
  await mkdir(targetDir, { recursive: true })

  if (file.localPath) {
    if (!hasStoExtension(file.localPath)) return { ok: false, message: 'A origem local precisa ser .sto.' }
    const info = await stat(file.localPath)
    if (!info.isFile()) return { ok: false, message: 'Invalid local source.' }
    if (info.size > MAX_STO_BYTES) return { ok: false, message: '.sto file is too large.' }
    await copyFile(file.localPath, targetPath)
  } else if (file.url) {
    await downloadSto(file.url, targetPath)
  } else {
    return { ok: false, message: 'Setup source not found.' }
  }

  const rememberFor = args.rememberFor?.trim()
  if (rememberFor) {
    config = mergeConfig(config, { carNameToFolder: { [rememberFor]: args.carFolder.trim() } })
    await saveConfig(configPath, config)
    ctx.broadcast(SETUPS_CHANNELS.config, config)
  }

  return { ok: true, installedPath: targetPath, message: `Setup instalado em ${args.carFolder.trim()}.` }
}

async function downloadSto(url: string, targetPath: string): Promise<void> {
  if (!hasStoExtension(new URL(url).pathname)) {
    throw new Error('The URL must point to a .sto file.')
  }
  const stream = await openValidatedHttpsStream(url)
  const declared = Number(stream.headers['content-length'] ?? '')
  if (Number.isFinite(declared) && declared > MAX_STO_BYTES) {
    stream.destroy()
    throw new Error('.sto file is too large.')
  }
  try {
    await pipeline(stream, sizeCapStream(MAX_STO_BYTES), createWriteStream(targetPath))
  } catch (error) {
    await unlink(targetPath).catch(() => undefined)
    throw error
  }
}

// Transform that fails the pipeline (and thus deletes the partial file) once the
// downloaded size exceeds `maxBytes`, preventing a disk-fill DoS.
function sizeCapStream(maxBytes: number): Transform {
  let total = 0
  return new Transform({
    transform(chunk: Buffer, _enc, callback): void {
      total += chunk.length
      if (total > maxBytes) {
        callback(new Error('.sto file is too large.'))
        return
      }
      callback(null, chunk)
    }
  })
}

function hasStoExtension(value: string): boolean {
  return extname(value).toLowerCase() === '.sto'
}

function sanitizeStoFileName(value: string): string {
  const cleaned = basename(value).replace(/[\\/:*?"<>|]/g, '_').trim()
  const withoutControls = cleaned.replace(/[\u0000-\u001f\u007f]/g, '')
  return hasStoExtension(withoutControls) ? withoutControls : `${withoutControls || 'setup'}.sto`
}

function isSafeFolderName(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const folder = value.trim()
  if (!folder || folder === '.' || folder === '..') return false
  if (folder.includes('..') || folder.includes('/') || folder.includes('\\') || folder.includes(sep)) return false
  return !/[\u0000-\u001f\u007f]/.test(folder)
}

function suggestFolder(hint: string | undefined, folders: string[]): string | undefined {
  const latestCar = config.carNameToFolder[ctxFreeCarName(hint)]
  if (latestCar) return latestCar
  return fuzzyFolder(hint, folders)
}

function ctxFreeCarName(value: string | undefined): string {
  return value?.trim() ?? ''
}

function fuzzyFolder(hint: string | undefined, folders: string[]): string | undefined {
  if (!hint) return undefined
  const normalizedHint = normalizeToken(hint)
  if (!normalizedHint) return undefined
  return folders.find((folder) => normalizeToken(folder) === normalizedHint) ??
    folders.find((folder) => normalizedHint.includes(normalizeToken(folder)) || normalizeToken(folder).includes(normalizedHint))
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/\.sto$/i, '').replace(/[^a-z0-9]+/g, '')
}

async function validateHttpsUrl(rawUrl: string): Promise<void> {
  const url = validateHttpsUrlSync(rawUrl)
  const records = await lookup(url.hostname, { all: true }).catch(() => {
    throw new Error('Could not validate the URL host.')
  })
  if (records.some((record) => isBlockedAddress(record.address))) throw new Error('URL resolves to an internal/private address.')
}

function validateHttpsUrlSync(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('Invalid URL.')
  }
  if (url.protocol !== 'https:') throw new Error('Use apenas URLs HTTPS.')
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || isBlockedAddress(host)) {
    throw new Error('Local or private URLs are not allowed.')
  }
  return url
}

function isBlockedAddress(host: string): boolean {
  const value = host.toLowerCase()
  if (value === '::1' || value === '0:0:0:0:0:0:0:1') return true
  if (value === '::' || value === '0:0:0:0:0:0:0:0') return true
  if (value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:')) return true
  if (value.startsWith('fec') || value.startsWith('fed') || value.startsWith('fee') || value.startsWith('fef')) return true
  if (value === 'localhost') return true
  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or its hex form ::ffff:7f00:1).
  const mapped = value.match(/^(?:::ffff:|0:0:0:0:0:ffff:)(.+)$/)
  if (mapped) {
    const inner = mapped[1]
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(inner)) return isBlockedAddress(inner)
    const hex = inner.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (hex) {
      const hi = parseInt(hex[1], 16)
      const lo = parseInt(hex[2], 16)
      return isBlockedAddress(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`)
    }
    return true
  }
  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!ipv4) return false
  const octets = ipv4.slice(1).map(Number)
  if (octets.some((octet) => octet < 0 || octet > 255)) return true
  const [a, b, c] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    (a >= 224 && a <= 239) ||
    a >= 240
  )
}

async function refreshAutoInstall(ctx: ModuleContext, configPath: string): Promise<void> {
  closeWatcher()
  const gen = ++refreshGen
  if (!config.autoInstall || !config.autoInstallSourceId) return
  const source = config.sources.find((item) => item.id === config.autoInstallSourceId)
  if (source?.kind !== 'folder' || !source.path) return

  // Seed the "already seen" set BEFORE starting the watcher so the files that
  // already exist at startup are not mistaken for new files and auto-installed.
  try {
    const files = await listFolderSource(source, [])
    autoSeen = new Set(files.map((file) => file.localPath).filter((path): path is string => Boolean(path)))
  } catch {
    autoSeen = new Set()
  }

  // A newer refresh started while we awaited — let it own the watcher.
  if (gen !== refreshGen) return

  try {
    watcher = watch(source.path, () => {
      if (watcherTimer) clearTimeout(watcherTimer)
      watcherTimer = setTimeout(() => {
        void runAutoInstall(ctx, configPath, source)
      }, AUTO_INSTALL_DEBOUNCE_MS)
    })
  } catch (error) {
    console.warn('[setups] auto-install watcher failed:', error)
  }
}

async function runAutoInstall(ctx: ModuleContext, configPath: string, source: SetupSource): Promise<void> {
  if (process.platform !== 'win32') return
  // Drop the run if auto-install was disabled or the source changed (e.g. a
  // queued pending re-run firing after the user changed config).
  if (!config.autoInstall || config.autoInstallSourceId !== source.id) {
    autoRunPending = false
    return
  }
  // If an install is in progress, remember the directory changed again so we
  // re-scan once it finishes — otherwise files dropped mid-install are missed.
  if (autoInstalling) {
    autoRunPending = true
    return
  }
  autoInstalling = true
  try {
    const detected = await detectCar(ctx)
    const targetFolder = detected.suggestedFolder
    if (!targetFolder) {
      ctx.broadcast(SETUPS_CHANNELS.autoPending, { sourceId: source.id, reason: 'missingTarget' })
      return
    }
    const files = await listFolderSource(source, [])
    for (const file of files) {
      if (!file.localPath || autoSeen.has(file.localPath)) continue
      // Mark "seen" only AFTER a successful install so a transient failure
      // (source .sto still being flushed/locked, one-off download error) is
      // retried on the next watcher event instead of being lost forever.
      try {
        const result = await installSetup(ctx, configPath, { file, carFolder: targetFolder, rememberFor: detected.carName })
        if (result.ok) autoSeen.add(file.localPath)
        else console.warn('[setups] auto-install skipped:', file.fileName, '-', result.message)
      } catch (error) {
        console.warn('[setups] auto-install of', file.fileName, 'failed:', error)
      }
    }
  } catch (error) {
    console.warn('[setups] auto-install failed:', error)
  } finally {
    autoInstalling = false
    if (autoRunPending) {
      autoRunPending = false
      setTimeout(() => void runAutoInstall(ctx, configPath, source), 0)
    }
  }
}

function closeWatcher(): void {
  if (watcherTimer) clearTimeout(watcherTimer)
  watcherTimer = null
  if (watcher) watcher.close()
  watcher = null
}
