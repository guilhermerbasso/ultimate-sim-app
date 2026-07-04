// Persistent stores for the track-map module:
//
//   • CredentialsStore — wraps Electron's `safeStorage` to encrypt the
//     iRacing (email, hashed-password) pair at rest. We never persist the
//     raw password, and on platforms where safeStorage is unavailable we
//     simply refuse to save (the renderer's status surface tells the user).
//
//   • TrackAssetsCache — caches the downloaded iRacing SVG layers under
//     `userData/track-maps/<track_id>/` together with a small metadata JSON
//     so subsequent launches do not need to hit the network at all.
//
// Both stores are filesystem-only; the IPC plumbing lives in index.ts so this
// file stays trivially unit-testable on its own.

import { mkdir, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { safeStorage } from 'electron'

import type { TrackMapSvgLayers } from '../../shared/track-map'
import type { IRacingTrack, IRacingTrackAssets } from './iracing-api'

const CREDENTIALS_FILE = 'iracing-credentials.bin'
const CATALOG_FILE = 'iracing-track-catalog.json'
const TRACK_DIR = 'track-maps'

const CATALOG_TTL_MS = 24 * 60 * 60 * 1000 // re-fetch the track list once a day

interface PersistedCredentials {
  version: 1
  email: string
  // base64(sha256(rawPassword + lower(email)))
  hashedPassword: string
  savedAt: number
}

export interface StoredCredentials {
  email: string
  hashedPassword: string
  savedAt: number
}

export interface CachedAsset {
  trackId: number
  trackName: string
  configName?: string | null
  baseUrl: string
  layerFilenames: TrackMapSvgLayers
  cachedAt: number
}

export interface CachedAssetWithSvg extends CachedAsset {
  layers: TrackMapSvgLayers
  activeSvg?: string
}

// ─── CredentialsStore ───────────────────────────────────────────────────────
export class CredentialsStore {
  private readonly file: string

  constructor(userDataPath: string) {
    this.file = join(userDataPath, CREDENTIALS_FILE)
  }

  encryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  async load(): Promise<StoredCredentials | null> {
    if (!this.encryptionAvailable()) return null
    let cipher: Buffer
    try {
      cipher = await readFile(this.file)
    } catch {
      return null
    }
    try {
      const plain = safeStorage.decryptString(cipher)
      const parsed = JSON.parse(plain) as Partial<PersistedCredentials>
      if (
        parsed.version === 1 &&
        typeof parsed.email === 'string' &&
        typeof parsed.hashedPassword === 'string'
      ) {
        return {
          email: parsed.email,
          hashedPassword: parsed.hashedPassword,
          savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0
        }
      }
    } catch {
      // Decryption failed (key changed, file tampered with). Clear so the
      // renderer can prompt for a fresh login.
      await this.clear().catch(() => undefined)
    }
    return null
  }

  async save(creds: StoredCredentials): Promise<void> {
    if (!this.encryptionAvailable()) {
      throw new Error('safeStorage is not available on this machine')
    }
    const payload: PersistedCredentials = {
      version: 1,
      email: creds.email,
      hashedPassword: creds.hashedPassword,
      savedAt: creds.savedAt || Date.now()
    }
    const cipher = safeStorage.encryptString(JSON.stringify(payload))
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, cipher, { mode: 0o600 })
  }

  async clear(): Promise<void> {
    try {
      await rm(this.file, { force: true })
    } catch {
      // ignore — the user can always overwrite by saving fresh creds.
    }
  }
}

// ─── TrackAssetsCache ───────────────────────────────────────────────────────
// One directory per track_id. Layout:
//   userData/track-maps/123/metadata.json    ← CachedAsset
//   userData/track-maps/123/active.svg       ← downloaded SVG layer
//   userData/track-maps/123/inactive.svg
//   userData/track-maps/123/pitroad.svg
//   userData/track-maps/123/start-finish.svg
//   userData/track-maps/123/turns.svg
//   userData/track-maps/123/background.svg
export class TrackAssetsCache {
  private readonly root: string

  constructor(userDataPath: string) {
    this.root = join(userDataPath, TRACK_DIR)
  }

  trackDir(trackId: number): string {
    return join(this.root, String(trackId))
  }

  // ─── Catalog (the full track list) — cached because it never changes mid-session
  catalogPath(): string {
    return join(this.root, CATALOG_FILE)
  }

  async loadCatalog(): Promise<{ tracks: IRacingTrack[]; cachedAt: number } | null> {
    try {
      const raw = await readFile(this.catalogPath(), 'utf8')
      const parsed = JSON.parse(raw) as { tracks?: IRacingTrack[]; cachedAt?: number }
      if (!Array.isArray(parsed.tracks)) return null
      return { tracks: parsed.tracks, cachedAt: parsed.cachedAt ?? 0 }
    } catch {
      return null
    }
  }

  async saveCatalog(tracks: IRacingTrack[]): Promise<void> {
    await mkdir(this.root, { recursive: true })
    const payload = { tracks, cachedAt: Date.now() }
    await writeFile(this.catalogPath(), JSON.stringify(payload), 'utf8')
  }

  catalogIsFresh(cachedAt: number | undefined): boolean {
    if (!cachedAt) return false
    return Date.now() - cachedAt < CATALOG_TTL_MS
  }

  // ─── Per-track assets
  async loadAsset(trackId: number): Promise<CachedAssetWithSvg | null> {
    const dir = this.trackDir(trackId)
    let metaRaw: string
    try {
      metaRaw = await readFile(join(dir, 'metadata.json'), 'utf8')
    } catch {
      return null
    }
    let meta: CachedAsset
    try {
      meta = JSON.parse(metaRaw) as CachedAsset
    } catch {
      return null
    }
    const layers = await readLayerFiles(dir, meta.layerFilenames)
    return {
      ...meta,
      layers,
      activeSvg: layers.active
    }
  }

  async saveAsset(
    asset: CachedAsset,
    layerContent: Partial<Record<keyof TrackMapSvgLayers, string>>
  ): Promise<CachedAssetWithSvg> {
    const dir = this.trackDir(asset.trackId)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'metadata.json'), JSON.stringify(asset, null, 2), 'utf8')
    const layers: TrackMapSvgLayers = {}
    for (const [key, content] of Object.entries(layerContent) as Array<[
      keyof TrackMapSvgLayers,
      string | undefined
    ]>) {
      if (typeof content !== 'string' || !content) continue
      const file = layerFile(key)
      await writeFile(join(dir, file), content, 'utf8')
      layers[key] = content
    }
    return { ...asset, layers, activeSvg: layers.active }
  }

  async listCachedTrackIds(): Promise<number[]> {
    try {
      const entries = await readdir(this.root, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => Number(entry.name))
        .filter((n) => Number.isFinite(n))
    } catch {
      return []
    }
  }

  // Best-effort: tells callers when the on-disk metadata was last touched
  // without having to parse it. Used by the module to decide whether to
  // refresh in the background.
  async metaAgeMs(trackId: number): Promise<number | null> {
    try {
      const info = await stat(join(this.trackDir(trackId), 'metadata.json'))
      return Date.now() - info.mtimeMs
    } catch {
      return null
    }
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

// Map our camelCase keys to the on-disk filename. We intentionally keep these
// stable across versions so a re-install can reuse the cache.
function layerFile(key: keyof TrackMapSvgLayers): string {
  switch (key) {
    case 'startFinish':
      return 'start-finish.svg'
    case 'background':
    case 'inactive':
    case 'active':
    case 'pitroad':
    case 'turns':
      return `${key}.svg`
    default:
      return `${key}.svg`
  }
}

async function readLayerFiles(
  dir: string,
  manifest: TrackMapSvgLayers
): Promise<TrackMapSvgLayers> {
  const result: TrackMapSvgLayers = {}
  const keys = Object.keys(manifest) as Array<keyof TrackMapSvgLayers>
  await Promise.all(
    keys.map(async (key) => {
      try {
        result[key] = await readFile(join(dir, layerFile(key)), 'utf8')
      } catch {
        // The manifest mentioned the layer but the file is missing — just
        // skip; the next refresh will redownload it.
      }
    })
  )
  return result
}

// Translate the raw layer object from the iRacing API ("start-finish" key) to
// the internal camelCase shape we use everywhere else.
export function assetsToLayerMap(assets: IRacingTrackAssets['track_map_layers']): TrackMapSvgLayers {
  return {
    background: assets.background,
    inactive: assets.inactive,
    active: assets.active,
    pitroad: assets.pitroad,
    startFinish: assets['start-finish'],
    turns: assets.turns
  }
}
