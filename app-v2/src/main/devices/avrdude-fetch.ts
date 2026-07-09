import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { get } from 'node:https'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Readable } from 'node:stream'
import type { App } from 'electron'

const LATEST_RELEASE_API = 'https://api.github.com/repos/mariusgreuel/avrdude/releases/latest'
const KNOWN_WINDOWS_X64_ZIP =
  'https://github.com/mariusgreuel/avrdude/releases/download/v7.1-windows/avrdude-v7.1-windows-windows-x64.zip'
const MIN_AVRDUDE_BYTES = 100_000
const USER_AGENT = 'ultimate-sim-app'

export class AvrdudeFetchError extends Error {
  readonly bundledPath: string
  readonly fallbackPath: string

  constructor(message: string, bundledPath: string, fallbackPath: string, cause?: unknown) {
    super(message)
    this.name = 'AvrdudeFetchError'
    this.bundledPath = bundledPath
    this.fallbackPath = fallbackPath
    if (cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = cause
    }
  }
}

export interface AvrdudeFetchFs {
  exists(path: string): boolean
  size(path: string): number | null
  mkdir(path: string): Promise<void>
  remove(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
}

export interface AvrdudeInstallTarget {
  exePath: string
  partPath: string
  dir: string
}

export interface AvrdudeFetchDeps {
  fs?: AvrdudeFetchFs
  resolveBundledAvrdude?: (app: App) => string
  installAvrdude?: (target: AvrdudeInstallTarget, fs: AvrdudeFetchFs) => Promise<void>
}

const defaultFs: AvrdudeFetchFs = {
  exists: (path) => existsSync(path),
  size: (path) => {
    try {
      return statSync(path).size
    } catch {
      return null
    }
  },
  mkdir: async (path) => {
    await mkdir(path, { recursive: true })
  },
  remove: (path) => rm(path, { force: true }),
  rename
}

let inflight: Promise<string> | null = null
let cachedPath: string | null = null

export async function ensureAvrdude(app: App, deps?: AvrdudeFetchDeps): Promise<string> {
  const fs = deps?.fs ?? defaultFs
  const bundledPath = deps?.resolveBundledAvrdude?.(app) ?? resolveBundledAvrdudePath(app)
  if (isUsableExe(bundledPath, fs)) {
    cachedPath = bundledPath
    return bundledPath
  }

  const fallbackPath = resolveUserAvrdudePath(app)
  if (isUsableExe(fallbackPath, fs)) {
    cachedPath = fallbackPath
    return fallbackPath
  }
  if (!deps && cachedPath && isUsableExe(cachedPath, fs)) return cachedPath

  const run = async (): Promise<string> => {
    try {
      const target = { exePath: fallbackPath, partPath: `${fallbackPath}.part`, dir: dirname(fallbackPath) }
      await fs.mkdir(target.dir)
      await fs.remove(target.partPath).catch(() => undefined)
      await (deps?.installAvrdude ?? installAvrdude)(target, fs)
      if (!isUsableExe(target.exePath, fs)) {
        throw new Error('downloaded avrdude.exe is missing or truncated')
      }
      cachedPath = target.exePath
      return target.exePath
    } catch (error) {
      throw new AvrdudeFetchError(
        `avrdude.exe is not bundled and could not be downloaded. The app will retry next time. ` +
          `To install manually, place avrdude.exe at ${bundledPath} or ${fallbackPath}.`,
        bundledPath,
        fallbackPath,
        error
      )
    }
  }

  if (deps) return run()
  if (!inflight) {
    inflight = run().finally(() => {
      inflight = null
    })
  }
  return inflight
}

export function resolveBundledAvrdudePath(app: App): string {
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  return join(base, 'tools', 'avrdude', 'win', 'bin', 'avrdude.exe')
}

export function resolveUserAvrdudePath(app: App): string {
  return join(app.getPath('userData'), 'tools', 'avrdude', 'bin', 'avrdude.exe')
}

export function resetAvrdudeFetchCacheForTests(): void {
  inflight = null
  cachedPath = null
}

function isUsableExe(path: string, fs: AvrdudeFetchFs): boolean {
  try {
    return fs.exists(path) && (fs.size(path) ?? 0) >= MIN_AVRDUDE_BYTES
  } catch {
    return false
  }
}

async function installAvrdude(target: AvrdudeInstallTarget, fs: AvrdudeFetchFs): Promise<void> {
  const zipPath = join(target.dir, 'avrdude-windows-x64.zip.part')
  try {
    const url = await resolveLatestWindowsX64ZipUrl().catch(() => KNOWN_WINDOWS_X64_ZIP)
    await downloadFile(url, zipPath)
    await extractAvrdudeFromZip(zipPath, target.partPath, target.dir)
    const info = await stat(target.partPath)
    if (!info.isFile() || info.size < MIN_AVRDUDE_BYTES) throw new Error('downloaded avrdude.exe is too small')
    await fs.remove(target.exePath).catch(() => undefined)
    await fs.rename(target.partPath, target.exePath)
  } finally {
    await fs.remove(zipPath).catch(() => undefined)
    await fs.remove(target.partPath).catch(() => undefined)
  }
}

async function resolveLatestWindowsX64ZipUrl(): Promise<string> {
  const release = (await getJson(LATEST_RELEASE_API)) as {
    assets?: Array<{ name?: string; browser_download_url?: string }>
  }
  const asset = release.assets?.find((entry) => {
    const name = String(entry.name ?? '').toLowerCase()
    return name.endsWith('.zip') && name.includes('windows') && name.includes('x64') && entry.browser_download_url
  })
  if (!asset?.browser_download_url) throw new Error('no Windows x64 avrdude zip asset found')
  return asset.browser_download_url
}

function getJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = get(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        getJson(res.headers.location).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`GET ${url} failed with HTTP ${res.statusCode}`))
        return
      }
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        body += chunk
      })
      res.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (error) {
          reject(error)
        }
      })
    })
    req.on('error', reject)
  })
}

function downloadFile(url: string, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        downloadFile(res.headers.location, path).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`download failed with HTTP ${res.statusCode}`))
        return
      }
      const out = createWriteStream(path)
      pipeline(res, out).then(resolve, reject)
    })
    req.on('error', reject)
  })
}

async function extractAvrdudeFromZip(zipPath: string, exePartPath: string, dir: string): Promise<void> {
  const require = createRequire(import.meta.url)
  const unzipper = require('unzipper') as {
    Open: {
      file(path: string): Promise<{ files: Array<{ path: string; type: string; stream(): Readable }> }>
    }
  }
  const zip = await unzipper.Open.file(zipPath)
  const exe = zip.files.find((entry) => entry.type === 'File' && basename(entry.path).toLowerCase() === 'avrdude.exe')
  if (!exe) throw new Error('avrdude.exe was not found in the downloaded zip')
  await pipeline(exe.stream(), createWriteStream(exePartPath))

  const license = zip.files.find((entry) => {
    const name = basename(entry.path).toLowerCase()
    return entry.type === 'File' && (name === 'license' || name.startsWith('license.') || name === 'copying')
  })
  if (license) {
    await pipeline(license.stream(), createWriteStream(join(dir, basename(license.path))))
  }
}
