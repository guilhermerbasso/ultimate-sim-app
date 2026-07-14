import { BrowserWindow, dialog, screen, shell, type Display, type Rectangle } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { link, mkdir, open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { TextDecoder } from 'node:util'
import type {
  Dashboard,
  DashboardDisplayInfo,
  DashboardMutationToken,
  DashboardOpenOptions,
  DashboardOpenState,
  DashboardPlaylist,
  DashboardPlaylistItem,
  DashboardPreset,
  DashboardStorageSnapshot,
  DashboardStorageValidationResult,
  DashboardSummary
} from '../../shared/dashboards'
import {
  BUILTIN_PRESETS,
  DashboardStorageUnavailableError,
  createDashboardId,
  dashboardPlaylistValidationError,
  dashboardStorageValidationResult,
  dashboardValidationError,
  summarizeDashboard
} from '../../shared/dashboards'
import type { ModuleContext } from '../module-context'
import { exportSimhubDash, importSimhubDash, type ImportScreenSummary } from './simhubdash'
import { applyDashboardQuery, buildDashboardQuery } from '../../shared/kiosk'
import { isTouchPanelPlaylistItem } from '../../shared/touch-panel'
import { getTouchPanelManager, type TouchPanelManager } from '../touchpanel/manager'
import { logger } from '../modules/logger'


// ── Pure playlist-routing helpers (unit-tested; no Electron/IPC) ──────────────
// A dashboard playlist can interleave regular dashboards with editable RGB
// button-box panels (kind: 'touch-panel'). The panel id rides in `dashboardId`
// (and mirrors `touchPanelId`), so it is NOT a member of `this.dashboards`. These
// helpers keep touch-panel items in the cycle/activate rotation and route them to
// the TouchPanelManager instead of silently filtering them out.

/** Resolve the button-box panel id carried by a touch-panel playlist item. */
export function touchPanelIdOf(item: DashboardPlaylistItem): string {
  return typeof item.touchPanelId === 'string' && item.touchPanelId ? item.touchPanelId : item.dashboardId
}

/**
 * Keep the items that can actually be opened:
 *   - DASHBOARD items whose id still exists in the dashboard store, AND
 *   - TOUCH-PANEL items whose panel id still exists in the touch-panel store.
 * (Previously touch-panel items were filtered against the dashboard store and so
 * were always dropped — the root cause of "touch panels dead in the playlist".)
 */
export function openablePlaylistItems(
  items: DashboardPlaylistItem[],
  hasDashboard: (id: string) => boolean,
  hasTouchPanel: (id: string) => boolean
): DashboardPlaylistItem[] {
  return items.filter((item) =>
    isTouchPanelPlaylistItem(item) ? hasTouchPanel(touchPanelIdOf(item)) : hasDashboard(item.dashboardId)
  )
}

/**
 * Two playlist items share the SAME cockpit window when they are both touch
 * panels (the TouchPanelManager reuses a single fullscreen window for every
 * panel) or the same dashboard id. Used to avoid closing the window we just
 * (re)opened during a same-target switch.
 */
export function sameCockpitTarget(a: DashboardPlaylistItem, b: DashboardPlaylistItem): boolean {
  const aTouch = isTouchPanelPlaylistItem(a)
  const bTouch = isTouchPanelPlaylistItem(b)
  if (aTouch && bTouch) return true
  if (aTouch !== bTouch) return false
  return a.dashboardId === b.dashboardId
}

export interface CycleStep {
  currentIndex: number
  current: DashboardPlaylistItem | null
  nextIndex: number
  next: DashboardPlaylistItem
}

/**
 * Pure cycle math shared by dashboards and touch panels. Given the openable
 * items, the last-known index and an `isOpen` predicate, returns which item to
 * close (`current`) and which to open (`next`). Returns null when the playlist is
 * empty. When nothing is open it targets the first item.
 */
export function resolveCycleStep(
  items: DashboardPlaylistItem[],
  currentIndex: number,
  isOpen: (item: DashboardPlaylistItem) => boolean,
  direction: 'next' | 'prev'
): CycleStep | null {
  if (items.length === 0) return null
  let idx = currentIndex
  if (idx < 0 || idx >= items.length || !isOpen(items[idx])) {
    idx = items.findIndex((item) => isOpen(item))
  }
  if (idx < 0) {
    return { currentIndex: -1, current: null, nextIndex: 0, next: items[0] }
  }
  const nextIndex = (idx + (direction === 'next' ? 1 : -1) + items.length) % items.length
  return { currentIndex: idx, current: items[idx], nextIndex, next: items[nextIndex] }
}


function openExternalUrl(url: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') void shell.openExternal(parsed.toString())
  } catch {
    // Deny malformed URLs.
  }
}

function isAllowedAppNavigation(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (process.env.ELECTRON_RENDERER_URL) {
      return parsed.origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
    }
    const appHtml = pathToFileURL(join(__dirname, '../renderer/dashboard.html'))
    return parsed.protocol === 'file:' && parsed.pathname === appHtml.pathname
  } catch {
    return false
  }
}

const SUBDIR = 'dashboards'
const PLAYLIST_FILE = 'dashboard-playlist.json'
const CYCLE_DEBOUNCE_MS = 350
const MAX_STORAGE_PATH = 240
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'
const RECOVERY_ERROR_CODE = 'DASHBOARD_STORAGE_RECOVERY_REQUIRED'
const STALE_ERROR_CODE = 'DASHBOARD_STORAGE_STALE_VERSION'
const MANIFEST_FILE = 'dashboard-storage-manifest.json'
const MANIFEST_DIR = '.dashboard-manifests'
const GENERATION_DIR = '.dashboard-generations'
const QUARANTINE_DIR = '.dashboard-quarantine'
const MANIFEST_VERSION = 1
const GENERATION_PREFIX = 'g.'
const MANIFEST_BACKUP_PREFIX = '.manifest-previous-'
const MANIFEST_OBJECT_PATTERN = /^m\.(0|[1-9]\d*)\.([A-Za-z0-9_-]{43})\.json$/
const COMMIT_MARKER_PATTERN = /^c\.(0|[1-9]\d*)\.([A-Za-z0-9_-]{43})\.json$/
const GENERATION_GC_GRACE_MS = 5 * 60_000
const MAX_SIMHUB_IMPORT_BYTES = 256 * 1024 * 1024
const OWNED_TEMP_PREFIXES = ['.tmp-manifest-', '.tmp-simhub-source-'] as const
const STORAGE_LOCK_RETRY_MS = 20
const STORAGE_LOCK_MAX_ATTEMPTS = 1_500
const DANGEROUS_MANIFEST_IDS = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype'])

interface DashboardFileHandle {
  writeFile(data: string, encoding: BufferEncoding): Promise<void>; sync(): Promise<void>; close(): Promise<void>
}

export interface DashboardStorageFs {
  mkdir(path: string): Promise<void>; readdir(path: string): Promise<string[]>
  readFile(path: string): Promise<Buffer | string>; unlink(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>; link(from: string, to: string): Promise<void>
  openExclusive(path: string): Promise<DashboardFileHandle>
  syncDirectory(path: string): Promise<boolean>
  statFile(path: string): Promise<{ mtimeMs: number; size: number }>
}

const NODE_STORAGE_FS: DashboardStorageFs = {
  mkdir: async (path) => { await mkdir(path, { recursive: true }) },
  readdir: (path) => readdir(path), readFile: (path) => readFile(path), unlink, rename, link,
  openExclusive: (path) => open(path, 'wx'),
  statFile: async (path) => {
    const info = await stat(path)
    return { mtimeMs: info.mtimeMs, size: info.size }
  },
  syncDirectory: async (path) => {
    let handle: Awaited<ReturnType<typeof open>> | null = null
    try {
      handle = await open(path, 'r')
      await handle.sync()
      return true
    } catch (error) {
      if (!['EISDIR', 'EINVAL', 'ENOTSUP', 'EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException)?.code ?? '')) {
        throw error
      }
      return false
    } finally {
      if (handle) try { await handle.close() } catch { /* best-effort directory sync */ }
    }
  }
}

export interface DashboardManagerOptions {
  fs?: Partial<DashboardStorageFs>; presets?: readonly DashboardPreset[]; storeDir?: string
}

function isMissing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT' }
function isTransientStorageError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code
  return typeof code === 'string' && code !== 'ENOENT'
}
function preserveUncommittedArtifacts(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' &&
    (error as { preserveUncommitted?: unknown }).preserveUncommitted === true)
}
function nextOpaqueToken(): string { return randomBytes(18).toString('base64url') }
function nextTombstoneRevision(): string { return `tombstone:${nextOpaqueToken()}` }
function serializeJson(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n` }
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })

function exactBytes(raw: Buffer | string): Buffer {
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8')
}

function decodeExactUtf8(raw: Buffer | string): string {
  return UTF8_DECODER.decode(exactBytes(raw))
}

interface ManifestFileEntry {
  file: string
  exportName: string
  hash: string
  generation: string
  sizeBytes: number
}

interface DashboardStorageManifest {
  version: typeof MANIFEST_VERSION
  sequence: number
  generation: string
  dashboards: Record<string, ManifestFileEntry>
  playlist: ManifestFileEntry
  tombstones: Record<string, string>
}

interface LoadedManifest {
  manifest: DashboardStorageManifest
  hash: string
  durable: boolean
  recoverable?: boolean
  markerHash?: string | null
  markerSequence?: number
}

interface ManifestCandidate extends LoadedManifest {
  path: string
  raw: string
}

interface CommitMarker {
  version: 1
  sequence: number
  manifestHash: string
  parentMarkerHash: string | null
}

interface CommitMarkerCandidate {
  path: string
  raw: string
  hash: string
  marker: CommitMarker
}

interface StagedGeneration {
  entry: ManifestFileEntry
  path: string
}

interface LegacyDashboardCandidate {
  file: string
  raw: Buffer | string
  hash: string
  result: DashboardStorageValidationResult
}

type LoadableDashboardStorageValidationResult = Exclude<DashboardStorageValidationResult, { status: 'quarantine' }>
type LoadableLegacyDashboardCandidate = Omit<LegacyDashboardCandidate, 'result'> & {
  result: LoadableDashboardStorageValidationResult
}

function isLoadableLegacyDashboardCandidate(
  candidate: LegacyDashboardCandidate
): candidate is LoadableLegacyDashboardCandidate {
  return candidate.result.status !== 'quarantine'
}

function storageLockAddress(storeDir: string): string {
  const normalized = process.platform === 'win32' ? resolve(storeDir).toLowerCase() : resolve(storeDir)
  const id = createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 32)
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\ultimate-sim-dashboard-cas-${id}`
    : `\0ultimate-sim-dashboard-cas-${id}`
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function exactHash(raw: Buffer | string): string {
  return createHash('sha256').update(exactBytes(raw)).digest('base64url')
}

function manifestRevision(entry: ManifestFileEntry): string {
  return `${entry.generation}:${entry.hash}`
}

function cleanDashboard(dashboard: Dashboard): Dashboard {
  const { storageEpoch: _epoch, storageRevision: _revision, ...clean } = dashboard
  return clean
}

function cleanPlaylist(playlist: DashboardPlaylist): DashboardPlaylist {
  const { storageEpoch: _epoch, storageRevision: _revision, ...clean } = playlist
  return clean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isPlainFileName(name: string): boolean {
  return Boolean(name) && !name.includes('/') && !name.includes('\\')
}

function generationFileHash(name: string): string | null {
  if (!name.startsWith(GENERATION_PREFIX) || !name.endsWith('.json')) return null
  const parts = name.slice(GENERATION_PREFIX.length, -'.json'.length).split('.')
  return parts.length === 3 && parts.every(Boolean) ? parts[2] : null
}

function manifestEntryError(value: unknown): string | null {
  if (!isRecord(value)) return 'entry must be an object'
  if (!isPlainFileName(value.file as string) || typeof value.file !== 'string') return 'entry file is invalid'
  if (typeof value.exportName !== 'string' || !isPlainFileName(value.exportName) || !value.exportName.toLowerCase().endsWith('.json')) return 'entry exportName is invalid'
  if (typeof value.hash !== 'string' || !value.hash) return 'entry hash is invalid'
  if (generationFileHash(value.file) !== value.hash) return 'entry file/hash identity is invalid'
  if (typeof value.generation !== 'string' || !value.generation.startsWith('cas-v2:')) return 'entry generation is invalid'
  if (!Number.isInteger(value.sizeBytes) || (value.sizeBytes as number) < 0) return 'entry sizeBytes is invalid'
  return null
}

function parseManifest(value: unknown): DashboardStorageManifest {
  if (!isRecord(value) || value.version !== MANIFEST_VERSION ||
    !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1 ||
    typeof value.generation !== 'string' ||
    !isRecord(value.dashboards) || !isRecord(value.tombstones)) {
    throw new Error('Dashboard storage manifest shape is invalid.')
  }
  const playlistError = manifestEntryError(value.playlist)
  if (playlistError) throw new Error(`Dashboard storage manifest playlist ${playlistError}.`)
  const exportNames = new Set<string>()
  const files = new Set<string>()
  const dashboards = Object.create(null) as Record<string, ManifestFileEntry>
  for (const [id, raw] of Object.entries(value.dashboards)) {
    if (DANGEROUS_MANIFEST_IDS.has(id)) throw new Error(`Dashboard storage manifest id "${id}" is dangerous.`)
    const error = manifestEntryError(raw)
    if (error) throw new Error(`Dashboard storage manifest entry "${id}" ${error}.`)
    const entry = raw as unknown as ManifestFileEntry
    const exportKey = entry.exportName.toLowerCase()
    if (exportNames.has(exportKey) || files.has(entry.file.toLowerCase())) throw new Error('Dashboard storage manifest contains duplicate ownership.')
    exportNames.add(exportKey)
    files.add(entry.file.toLowerCase())
    dashboards[id] = { ...entry }
  }
  const playlist = value.playlist as unknown as ManifestFileEntry
  if (exportNames.has(playlist.exportName.toLowerCase()) || files.has(playlist.file.toLowerCase())) {
    throw new Error('Dashboard storage manifest playlist ownership collides with a dashboard.')
  }
  const tombstones = Object.create(null) as Record<string, string>
  for (const [id, revision] of Object.entries(value.tombstones)) {
    if (DANGEROUS_MANIFEST_IDS.has(id)) throw new Error(`Dashboard storage manifest tombstone id "${id}" is dangerous.`)
    if (id in dashboards || typeof revision !== 'string' || !revision.startsWith('tombstone:')) {
      throw new Error(`Dashboard storage manifest tombstone "${id}" is invalid.`)
    }
    tombstones[id] = revision
  }
  return {
    version: MANIFEST_VERSION,
    sequence: value.sequence as number,
    generation: value.generation,
    dashboards,
    playlist: { ...playlist },
    tombstones
  }
}

function base32(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) { output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return output
}

export function dashboardFileNameForId(storeDir: string, id: string): string {
  if (!id) throw new Error('Dashboard id is required.')
  const bytes = Buffer.from(id, 'utf8')
  if (bytes.toString('utf8') !== id) throw new Error('Dashboard id must contain well-formed Unicode.')
  const fileName = `d-${base32(bytes)}.json`
  if (join(storeDir, fileName).length > MAX_STORAGE_PATH) throw new Error(`Dashboard id is too long for the ${MAX_STORAGE_PATH}-character storage path limit.`)
  return fileName
}

interface SimhubImportOptions {
  screenIndex?: number; inspectOnly?: boolean; importAll?: boolean
}

interface SimhubImportResponse {
  summary?: DashboardSummary
  summaries?: DashboardSummary[]
  notes: string[]
  screens?: ImportScreenSummary[]
  selectedScreenIndex?: number
  filePath?: string
}

function nearestDisplay(rect: Rectangle, displays: Display[]): Display | null {
  if (displays.length === 0) return null
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  return displays.reduce((best, display) => {
    const bx = best.bounds.x + best.bounds.width / 2
    const by = best.bounds.y + best.bounds.height / 2
    const dx = display.bounds.x + display.bounds.width / 2
    const dy = display.bounds.y + display.bounds.height / 2
    return (dx - cx) ** 2 + (dy - cy) ** 2 < (bx - cx) ** 2 + (by - cy) ** 2 ? display : best
  })
}

function sameRectangle(a: Rectangle, b: Rectangle): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

interface OpenWindowMeta {
  window: BrowserWindow
  displayId: number
  fullscreen: boolean
  kiosk: boolean
}

export class DashboardManager {
  private readonly storeDir: string
  private readonly fs: DashboardStorageFs
  private readonly presets: readonly DashboardPreset[]
  private readonly windows = new Map<string, OpenWindowMeta>()
  private dashboards = new Map<string, Dashboard>()
  private revisionByDashboard = new Map<string, string>()
  private manifest: DashboardStorageManifest | null = null
  private manifestHash: string | null = null
  private manifestDurable = true
  private manifestRecoverable = true
  private markerHash: string | null = null
  private markerSequence = 0
  private loadPromise: Promise<void> | null = null
  private storageState: 'unloaded' | 'loading' | 'ready' | 'recovery' = 'unloaded'
  private recoveryReason: string | null = null
  private storageEpoch = nextOpaqueToken()
  private isDisposing = false
  private playlist: DashboardPlaylist = { items: [], updatedAt: 0 }
  private playlistRevision = nextTombstoneRevision()
  private mutationChain: Promise<void> = Promise.resolve()
  private lastCycleAt = 0
  private currentPlaylistIndex = -1
  private cycleInFlight = false
  private activateChain: Promise<void> = Promise.resolve()
  private screenListenersRegistered = false
  private readonly onDisplaysChanged = (): void => {
    if (this.isDisposing) return
    this.reconcileWindowDisplays()
    this.broadcastDisplayState()
  }

  constructor(private readonly ctx: ModuleContext, options: DashboardManagerOptions = {}) {
    this.storeDir = options.storeDir ?? join(ctx.app.getPath('userData'), SUBDIR)
    this.fs = { ...NODE_STORAGE_FS, ...options.fs }
    this.presets = options.presets ?? BUILTIN_PRESETS
  }

  load(): Promise<void> {
    if (!this.loadPromise) {
      this.storageState = 'loading'
      this.loadPromise = this.loadInternal()
    }
    return this.loadPromise
  }

  isReady(): boolean {
    return this.storageState === 'ready'
  }

  getStorageStatus(): {
    state: 'unloaded' | 'loading' | 'ready' | 'recovery'
    reason: string | null
    durable: boolean
    recoverable: boolean
  } {
    const status = {
      state: this.storageState,
      reason: this.recoveryReason
    } as {
      state: 'unloaded' | 'loading' | 'ready' | 'recovery'
      reason: string | null
      durable: boolean
      recoverable: boolean
    }
    Object.defineProperties(status, {
      durable: { value: this.manifestDurable, enumerable: false },
      recoverable: { value: this.manifestRecoverable, enumerable: false }
    })
    return status
  }

  assertAvailable(): void {
    if (this.storageState === 'ready') return
    const reason = this.storageState === 'recovery' && this.recoveryReason
      ? `Recovery required: ${this.recoveryReason}`
      : this.recoveryReason ?? `Dashboard storage is ${this.storageState}.`
    throw new DashboardStorageUnavailableError(this.storageState, reason)
  }

  private async loadInternal(): Promise<void> {
    try {
      if (join(this.storeDir, MANIFEST_FILE).length > MAX_STORAGE_PATH ||
        join(this.storeDir, MANIFEST_DIR, `m.${'9'.repeat(12)}.${'x'.repeat(43)}.json`).length > MAX_STORAGE_PATH ||
        join(this.storeDir, GENERATION_DIR, `g.${'x'.repeat(16)}.${'x'.repeat(24)}.${'x'.repeat(43)}.json`).length > MAX_STORAGE_PATH)
        throw new Error(`Dashboard storage directory exceeds the ${MAX_STORAGE_PATH}-character path limit.`)
      await this.fs.mkdir(this.storeDir)
      await this.fs.mkdir(join(this.storeDir, MANIFEST_DIR))
      await this.fs.mkdir(join(this.storeDir, GENERATION_DIR))
      await this.fs.mkdir(join(this.storeDir, QUARANTINE_DIR))
      await this.withStorageLock(async () => {
        const loaded = await this.selectHighestCommittedManifest()
        if (loaded) {
          try {
            await this.replaceManifestPointer(loaded, null)
          } catch (error) {
            logger.warn('dashboards', 'authoritative marker recovered but pointer cache repair failed', {
              reason: this.errorMessage(error)
            })
          }
          await this.loadManifestState(loaded)
        } else {
          if ((await this.readCommitMarkers()).length > 0) {
            throw new Error('Committed dashboard marker history is present but no authorized manifest is recoverable.')
          }
          await this.quarantineBootstrapGenerations()
          await this.bootstrapLegacyStore()
        }
        await this.cleanupCrashArtifacts()
        this.storageState = 'ready'
        this.recoveryReason = null
        if (!this.isDisposing) this.registerScreenListeners()
      })
    } catch (error) {
      this.storageState = 'recovery'
      this.recoveryReason = this.errorMessage(error)
      this.manifestDurable = false
      this.manifestRecoverable = false
      logger.error('dashboards', 'dashboard storage entered recovery mode', { reason: this.recoveryReason })
    }
  }

  private async readManifest(): Promise<LoadedManifest | null> {
    let raw: Buffer | string
    try {
      raw = await this.fs.readFile(join(this.storeDir, MANIFEST_FILE))
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
    let value: unknown
    try {
      value = JSON.parse(decodeExactUtf8(raw)) as unknown
    } catch (error) {
      throw new Error(`${MANIFEST_FILE}: malformed JSON (${this.errorMessage(error)}).`)
    }
    return { manifest: parseManifest(value), hash: exactHash(raw), durable: true }
  }

  private async selectHighestCommittedManifest(syncDirectories = true): Promise<ManifestCandidate | null> {
    const objects = new Map<string, ManifestCandidate>()
    const objectDir = join(this.storeDir, MANIFEST_DIR)
    for (const name of await this.fs.readdir(objectDir)) {
      if (name.startsWith('.sequence-reserve-')) {
        try { await this.fs.unlink(join(objectDir, name)) } catch { /* active lock owns reservations */ }
        continue
      }
      const match = MANIFEST_OBJECT_PATTERN.exec(name)
      if (!match) continue
      const path = join(objectDir, name)
      try {
        const raw = decodeExactUtf8(await this.fs.readFile(path))
        const hash = exactHash(raw)
        const manifest = parseManifest(JSON.parse(raw) as unknown)
        if (Number(match[1]) !== manifest.sequence || match[2] !== hash) continue
        await this.verifyManifestEntries(manifest, true)
        objects.set(hash, { path, raw, hash, manifest, durable: true })
      } catch (error) {
        if (isTransientStorageError(error)) throw error
      }
    }

    const recoverySources = new Map<string, string>()
    let pointerSourceHash = ''
    try {
      const raw = decodeExactUtf8(await this.fs.readFile(join(this.storeDir, MANIFEST_FILE)))
      const hash = exactHash(raw)
      pointerSourceHash = hash
      recoverySources.set(hash, raw)
    } catch (error) {
      if (!isMissing(error) && isTransientStorageError(error)) throw error
    }
    for (const name of (await this.fs.readdir(this.storeDir)).filter((value) => value.startsWith(MANIFEST_BACKUP_PREFIX))) {
      try {
        const raw = decodeExactUtf8(await this.fs.readFile(join(this.storeDir, name)))
        recoverySources.set(exactHash(raw), raw)
      } catch (error) {
        if (isTransientStorageError(error)) throw error
      }
    }

    let markers = await this.readCommitMarkers()
    if (markers.length === 0 && objects.size > 0) {
      const ordered = [...objects.values()].sort((a, b) => a.manifest.sequence - b.manifest.sequence)
      const pointerObject = objects.get(pointerSourceHash)
      const highestSequence = Math.max(...ordered.map((object) => object.manifest.sequence))
      const highest = ordered.filter((object) => object.manifest.sequence === highestSequence)
      const legacyTip = pointerObject ?? (highest.length === 1 ? highest[0] : null)
      if (!legacyTip) throw new Error('Legacy manifest history is divergent and cannot be marker-authorized safely.')
      await this.publishCommitMarker({
        version: 1,
        sequence: legacyTip.manifest.sequence,
        manifestHash: legacyTip.hash,
        parentMarkerHash: null
      })
      markers = await this.readCommitMarkers()
    }

    const byParent = new Map<string, CommitMarkerCandidate[]>()
    for (const marker of markers) {
      const key = marker.marker.parentMarkerHash ?? '<root>'
      byParent.set(key, [...(byParent.get(key) ?? []), marker])
    }
    let parentKey = '<root>'
    let currentSequence = 0
    const chain: CommitMarkerCandidate[] = []
    while (true) {
      const children = (byParent.get(parentKey) ?? []).filter((candidate) =>
        candidate.marker.sequence > currentSequence)
      if (children.length === 0) break
      const immediate = children.some((candidate) => candidate.marker.sequence === currentSequence + 1)
      const nextSequence = immediate
        ? currentSequence + 1
        : Math.min(...children.map((candidate) => candidate.marker.sequence))
      const next = children.filter((candidate) => candidate.marker.sequence === nextSequence)
      if (next.length > 1) throw new Error(`Divergent commit marker lineage at equal sequence ${nextSequence}.`)
      chain.push(next[0])
      parentKey = next[0].hash
      currentSequence = next[0].marker.sequence
    }

    for (const marker of [...chain].reverse()) {
      let object = objects.get(marker.marker.manifestHash)
      if (!object) {
        const raw = recoverySources.get(marker.marker.manifestHash)
        if (raw) {
          try {
            const manifest = parseManifest(JSON.parse(raw) as unknown)
            if (manifest.sequence === marker.marker.sequence) {
              object = await this.ensureManifestObject(manifest, raw)
              objects.set(object.hash, object)
            }
          } catch { /* marker remains authorized but unrecoverable from this source */ }
        }
      }
      if (!object || object.manifest.sequence !== marker.marker.sequence) continue
      try {
        await this.verifyManifestEntries(object.manifest, true)
        const lineageTip = chain[chain.length - 1]
        object.markerHash = lineageTip?.hash ?? marker.hash
        object.markerSequence = lineageTip?.marker.sequence ?? marker.marker.sequence
        object.recoverable = true
        if (syncDirectories) {
          const generationsDurable = await this.fs.syncDirectory(join(this.storeDir, GENERATION_DIR))
          const markerDurable = await this.fs.syncDirectory(join(this.storeDir, MANIFEST_DIR))
          const rootDurable = await this.fs.syncDirectory(this.storeDir)
          object.durable = generationsDurable && markerDurable && rootDurable
        }
        return object
      } catch (error) {
        if (isTransientStorageError(error)) throw error
      }
    }

    if (syncDirectories) {
      await this.fs.syncDirectory(join(this.storeDir, GENERATION_DIR))
      await this.fs.syncDirectory(this.storeDir)
    }
    return null
  }

  private async ensureManifestObject(
    manifest: DashboardStorageManifest,
    raw = serializeJson(manifest)
  ): Promise<ManifestCandidate> {
    const hash = exactHash(raw)
    const file = `m.${manifest.sequence}.${hash}.json`
    const path = join(this.storeDir, MANIFEST_DIR, file)
    try {
      const existing = await this.fs.readFile(path)
      if (exactHash(existing) !== hash) throw new Error(`Manifest object "${file}" has conflicting bytes.`)
    } catch (error) {
      if (!isMissing(error)) throw error
      const temp = join(this.storeDir, MANIFEST_DIR, `.tmp-manifest-object-${nextOpaqueToken()}.json`)
      const handle = await this.fs.openExclusive(temp)
      try {
        await handle.writeFile(raw, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      try {
        await this.fs.link(temp, path)
      } catch (linkError) {
        if ((linkError as NodeJS.ErrnoException)?.code !== 'EEXIST') throw linkError
        const existing = await this.fs.readFile(path)
        if (exactHash(existing) !== hash) throw new Error(`Manifest object "${file}" has conflicting bytes.`)
      }
      try {
        await this.fs.rename(temp, path)
      } catch {
        try { await this.fs.unlink(temp) } catch { /* startup ignores committed-object temps */ }
      }
    }
    return { path, raw, hash, manifest, durable: true }
  }

  private async readCommitMarkers(): Promise<CommitMarkerCandidate[]> {
    const markers: CommitMarkerCandidate[] = []
    for (const name of await this.fs.readdir(join(this.storeDir, MANIFEST_DIR))) {
      const match = COMMIT_MARKER_PATTERN.exec(name)
      if (!match) continue
      try {
        const path = join(this.storeDir, MANIFEST_DIR, name)
        const raw = decodeExactUtf8(await this.fs.readFile(path))
        const hash = exactHash(raw)
        const value = JSON.parse(raw) as Partial<CommitMarker>
        if (hash !== match[2] || !Number.isSafeInteger(value.sequence) ||
          Number(match[1]) !== value.sequence || (value.sequence as number) < 1 ||
          value.version !== 1 || typeof value.manifestHash !== 'string' ||
          !/^[A-Za-z0-9_-]{43}$/.test(value.manifestHash) ||
          (value.parentMarkerHash !== null &&
            (typeof value.parentMarkerHash !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.parentMarkerHash)))) {
          continue
        }
        markers.push({ path, raw, hash, marker: value as CommitMarker })
      } catch (error) {
        if (isTransientStorageError(error)) throw error
      }
    }
    return markers
  }

  private async publishCommitMarker(marker: CommitMarker): Promise<CommitMarkerCandidate> {
    if (!Number.isSafeInteger(marker.sequence) || marker.sequence < 1) {
      throw new Error('Commit marker sequence must be a positive safe integer.')
    }
    const raw = serializeJson(marker)
    const hash = exactHash(raw)
    const finalPath = join(this.storeDir, MANIFEST_DIR, `c.${marker.sequence}.${hash}.json`)
    try {
      const existing = await this.fs.readFile(finalPath)
      if (exactHash(existing) !== hash) throw new Error('Commit marker final name has conflicting bytes.')
      return { path: finalPath, raw, hash, marker }
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    const temp = join(this.storeDir, MANIFEST_DIR, `.tmp-commit-marker-${nextOpaqueToken()}.json`)
    const handle = await this.fs.openExclusive(temp)
    try {
      await handle.writeFile(raw, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await this.fs.rename(temp, finalPath)
    return { path: finalPath, raw, hash, marker }
  }

  private async replaceManifestPointer(
    candidate: ManifestCandidate,
    expectedHash: string | null,
    claimedPath = ''
  ): Promise<void> {
    const pointer = join(this.storeDir, MANIFEST_FILE)
    let currentRaw: Buffer | string | null = null
    try { currentRaw = await this.fs.readFile(pointer) } catch (error) { if (!isMissing(error)) throw error }
    if (currentRaw && exactHash(currentRaw) === candidate.hash) return
    if (expectedHash !== null && (!currentRaw || exactHash(currentRaw) !== expectedHash)) {
      this.throwStale('Dashboard manifest pointer changed before atomic replacement.')
    }
    const temp = join(this.storeDir, `.tmp-manifest-pointer-${nextOpaqueToken()}`)
    let handle: DashboardFileHandle | null = null
    try {
      handle = await this.fs.openExclusive(temp)
      await handle.writeFile(candidate.raw, 'utf8')
      await handle.sync()
      await handle.close()
      handle = null
      if (expectedHash !== null) {
        const boundaryClaim = claimedPath || join(this.storeDir, `.tmp-manifest-claim-${nextOpaqueToken()}`)
        if (!claimedPath) await this.fs.link(pointer, boundaryClaim)
        const claimedHash = exactHash(await this.fs.readFile(boundaryClaim))
        const pointerHash = exactHash(await this.fs.readFile(pointer))
        if (claimedHash !== expectedHash || pointerHash !== expectedHash) {
          if (!claimedPath) try { await this.fs.unlink(boundaryClaim) } catch { /* claim cleanup */ }
          this.throwStale('Dashboard manifest pointer changed immediately before atomic replacement.')
        }
      }
      await this.fs.rename(temp, pointer)
      if (expectedHash !== null && claimedPath && exactHash(await this.fs.readFile(claimedPath)) !== expectedHash) {
        await this.restorePointerFromClaim(claimedPath)
        this.throwStale('Dashboard manifest claim changed during atomic replacement.')
      }
    } finally {
      if (handle) try { await handle.close() } catch { /* preserve pointer write failure */ }
      try { await this.fs.unlink(temp) } catch { /* rename consumed the pointer temp */ }
    }
  }

  private async restorePointerFromClaim(claimedPath: string): Promise<void> {
    const pointer = join(this.storeDir, MANIFEST_FILE)
    const raw = decodeExactUtf8(await this.fs.readFile(claimedPath))
    const temp = join(this.storeDir, `.tmp-manifest-restore-${nextOpaqueToken()}`)
    let handle: DashboardFileHandle | null = null
    try {
      handle = await this.fs.openExclusive(temp)
      await handle.writeFile(raw, 'utf8')
      await handle.sync()
      await handle.close()
      handle = null
      await this.fs.rename(temp, pointer)
    } finally {
      if (handle) try { await handle.close() } catch { /* preserve restore error */ }
      try { await this.fs.unlink(temp) } catch { /* rename consumed restore temp */ }
    }
  }

  private async quarantineBootstrapGenerations(): Promise<void> {
    for (const name of await this.fs.readdir(join(this.storeDir, GENERATION_DIR))) {
      if (!generationFileHash(name)) continue
      const source = join(this.storeDir, GENERATION_DIR, name)
      const target = join(this.storeDir, QUARANTINE_DIR, `bootstrap.${nextOpaqueToken()}.json`)
      try { await this.fs.rename(source, target) } catch { /* leave invisible orphan in place */ }
    }
  }

  private async readGeneration(entry: ManifestFileEntry): Promise<{ raw: Buffer | string; value: unknown }> {
    let raw: Buffer | string
    try {
      raw = await this.fs.readFile(join(this.storeDir, GENERATION_DIR, entry.file))
    } catch (error) {
      if (isMissing(error)) throw new Error(`Owned generation "${entry.file}" is missing.`)
      throw error
    }
    if (exactHash(raw) !== entry.hash || exactBytes(raw).byteLength !== entry.sizeBytes) {
      throw new Error(`Owned generation "${entry.file}" was modified outside this dashboard manager.`)
    }
    try {
      return { raw, value: JSON.parse(decodeExactUtf8(raw)) as unknown }
    } catch (error) {
      throw new Error(`${entry.file}: malformed JSON (${this.errorMessage(error)}).`)
    }
  }

  private async loadManifestState(loaded: LoadedManifest, allowMigration = true): Promise<void> {
    this.markerHash = loaded.markerHash ?? this.markerHash
    this.markerSequence = loaded.markerSequence ?? loaded.manifest.sequence
    this.manifestRecoverable = loaded.recoverable ?? true
    this.manifestDurable = loaded.durable
    const dashboards = new Map<string, Dashboard>()
    const revisions = new Map<string, string>()
    const migrations: Array<{ id: string; dashboard: Dashboard; previous: ManifestFileEntry }> = []
    for (const [id, entry] of Object.entries(loaded.manifest.dashboards)) {
      const { value } = await this.readGeneration(entry)
      const result = dashboardStorageValidationResult(value)
      if (result.status === 'quarantine') throw new Error(`${entry.file}: ${result.error}`)
      if (result.dashboard.id !== id) throw new Error(`${entry.file}: owned id changed from "${id}" to "${result.dashboard.id}".`)
      if (result.status === 'migrated') {
        if (!allowMigration) throw new Error(`${entry.file}: schema migration did not converge.`)
        migrations.push({ id, dashboard: cleanDashboard(result.dashboard), previous: entry })
        continue
      }
      const dashboard = cleanDashboard(result.dashboard)
      dashboards.set(id, dashboard)
      revisions.set(id, manifestRevision(entry))
    }
    if (migrations.length > 0) {
      const staged: StagedGeneration[] = []
      let manifestCommitted = false
      try {
        const next = this.cloneManifest(loaded.manifest)
        for (const migration of migrations) {
          const generation = await this.stageGeneration(
            migration.id,
            migration.previous.exportName,
            serializeJson(migration.dashboard)
          )
          staged.push(generation)
          next.dashboards[migration.id] = generation.entry
        }
        const generationsDurable = await this.fs.syncDirectory(join(this.storeDir, GENERATION_DIR))
        const committed = await this.commitManifest(next, loaded.hash, generationsDurable)
        manifestCommitted = true
        if (committed.durable) {
          for (const migration of migrations) await this.gcGenerationBestEffort(migration.previous)
        }
        await this.loadManifestState(committed, false)
        return
      } catch (error) {
        if (!manifestCommitted) {
          if (!preserveUncommittedArtifacts(error)) await this.cleanupStaged(staged)
        } else await this.reconcileManifestBestEffort()
        throw error
      }
    }

    const playlistRead = await this.readGeneration(loaded.manifest.playlist)
    const playlistError = dashboardPlaylistValidationError(playlistRead.value)
    if (playlistError) throw new Error(`${loaded.manifest.playlist.file}: ${playlistError}`)
    for (const [id, revision] of Object.entries(loaded.manifest.tombstones)) revisions.set(id, revision)

    this.manifest = loaded.manifest
    this.manifestHash = loaded.hash
    this.manifestDurable = loaded.durable
    this.manifestRecoverable = loaded.recoverable ?? true
    this.markerHash = loaded.markerHash ?? null
    this.markerSequence = loaded.markerSequence ?? loaded.manifest.sequence
    this.dashboards = dashboards
    this.revisionByDashboard = revisions
    this.playlist = cleanPlaylist(playlistRead.value as DashboardPlaylist)
    this.playlistRevision = manifestRevision(loaded.manifest.playlist)
  }

  private async bootstrapLegacyStore(attempt = 0): Promise<void> {
    let names: string[]
    try {
      names = await this.fs.readdir(this.storeDir)
    } catch (error) {
      if (isMissing(error) && attempt < 2) return this.bootstrapLegacyStore(attempt + 1)
      throw error
    }
    const groups = new Map<string, string[]>()
    for (const name of names) {
      if (!name.toLowerCase().endsWith('.json') || name.toLowerCase() === MANIFEST_FILE.toLowerCase()) continue
      const key = name.toLowerCase()
      groups.set(key, [...(groups.get(key) ?? []), name])
    }
    const problems: string[] = []
    const playlistCandidates = groups.get(PLAYLIST_FILE.toLowerCase()) ?? []
    if (playlistCandidates.length > 1) problems.push(`Ambiguous case-insensitive playlist files: ${playlistCandidates.join(', ')}`)
    const candidates: LegacyDashboardCandidate[] = []
    let vanished = false
    for (const [key, files] of groups) {
      if (key === PLAYLIST_FILE.toLowerCase()) continue
      if (files.length > 1) {
        problems.push(`Ambiguous case-insensitive dashboard files: ${files.join(', ')}`)
        continue
      }
      const file = files[0]
      try {
        const raw = await this.fs.readFile(join(this.storeDir, file))
        let result: DashboardStorageValidationResult
        try {
          result = dashboardStorageValidationResult(JSON.parse(decodeExactUtf8(raw)))
        } catch (error) {
          result = { status: 'quarantine', error: `malformed JSON (${this.errorMessage(error)})`, migrations: [] }
        }
        candidates.push({ file, raw, hash: exactHash(raw), result })
      } catch (error) {
        if (isMissing(error)) vanished = true
        else problems.push(`${file}: ${this.errorMessage(error)}`)
      }
    }
    let playlistFile = PLAYLIST_FILE
    let playlistRaw: Buffer | string | null = null
    let playlist: DashboardPlaylist = { items: [], updatedAt: 0 }
    let invalidPlaylist: { file: string; hash: string } | null = null
    if (playlistCandidates.length === 1) {
      playlistFile = playlistCandidates[0]
      try {
        playlistRaw = await this.fs.readFile(join(this.storeDir, playlistFile))
        const value = JSON.parse(decodeExactUtf8(playlistRaw)) as unknown
        const error = dashboardPlaylistValidationError(value)
        if (error) invalidPlaylist = { file: playlistFile, hash: exactHash(playlistRaw) }
        else playlist = cleanPlaylist(value as DashboardPlaylist)
      } catch (error) {
        if (isMissing(error)) vanished = true
        else invalidPlaylist = { file: playlistFile, hash: playlistRaw ? exactHash(playlistRaw) : '' }
      }
    }
    if (vanished) {
      if (attempt < 2) return this.bootstrapLegacyStore(attempt + 1)
      throw new Error('Dashboard files repeatedly vanished after directory enumeration.')
    }
    const valid = candidates.filter(isLoadableLegacyDashboardCandidate)
    const idCounts = new Map<string, number>()
    for (const candidate of valid) {
      const id = candidate.result.dashboard.id
      idCounts.set(id, (idCounts.get(id) ?? 0) + 1)
    }
    for (const [id, count] of idCounts) if (count > 1) problems.push(`Duplicate dashboard id "${id}" was found in ${count} files; none were loaded.`)
    if (problems.length > 0) throw new Error(problems.join(' '))

    for (const candidate of candidates.filter((value) => value.result.status === 'quarantine')) {
      await this.quarantineLegacyFile(candidate.file, candidate.hash)
    }
    if (invalidPlaylist) {
      const quarantined = await this.quarantineLegacyFile(invalidPlaylist.file, invalidPlaylist.hash)
      if (!quarantined) playlistFile = PLAYLIST_FILE
      playlistRaw = null
      playlist = { items: [], updatedAt: 0 }
    }

    const staged: StagedGeneration[] = []
    const legacySources: Array<{ file: string; hash: string }> = []
    let manifestCommitted = false
    try {
      const dashboardEntries: Record<string, ManifestFileEntry> = {}
      const exportNames = new Set<string>()
      for (const candidate of valid) {
        const result = candidate.result
        await this.assertLegacySourceCurrent(candidate.file, candidate.hash)
        const dashboard = cleanDashboard(result.dashboard)
        const raw = result.status === 'valid' ? decodeExactUtf8(candidate.raw) : serializeJson(dashboard)
        const generation = await this.stageGeneration(dashboard.id, candidate.file, raw)
        staged.push(generation)
        dashboardEntries[dashboard.id] = generation.entry
        exportNames.add(candidate.file.toLowerCase())
        legacySources.push({ file: candidate.file, hash: candidate.hash })
      }
      if (valid.length === 0) {
        const presetIds = new Set<string>()
        for (const preset of this.presets) {
          const dashboard = cleanDashboard(preset.build())
          const error = dashboardValidationError(dashboard)
          if (error) throw new Error(`Built-in preset "${preset.id}" is invalid: ${error}`)
          if (presetIds.has(dashboard.id)) throw new Error(`Built-in presets contain duplicate dashboard id "${dashboard.id}".`)
          presetIds.add(dashboard.id)
          const exportName = dashboardFileNameForId(this.storeDir, dashboard.id)
          if (exportNames.has(exportName.toLowerCase())) throw new Error(`Dashboard filename collision for "${dashboard.id}".`)
          exportNames.add(exportName.toLowerCase())
          const generation = await this.stageGeneration(dashboard.id, exportName, serializeJson(dashboard))
          staged.push(generation)
          dashboardEntries[dashboard.id] = generation.entry
        }
      }
      if (exportNames.has(playlistFile.toLowerCase())) throw new Error('Dashboard playlist filename collides with a dashboard.')
      if (playlistRaw) await this.assertLegacySourceCurrent(playlistFile, exactHash(playlistRaw))
      const playlistGeneration = await this.stageGeneration(
        'playlist',
        playlistFile,
        playlistRaw ? decodeExactUtf8(playlistRaw) : serializeJson(playlist),
        true
      )
      staged.push(playlistGeneration)
      const generationsDurable = await this.fs.syncDirectory(join(this.storeDir, GENERATION_DIR))
      const manifest: DashboardStorageManifest = {
        version: MANIFEST_VERSION,
        sequence: 1,
        generation: nextOpaqueToken(),
        dashboards: dashboardEntries,
        playlist: playlistGeneration.entry,
        tombstones: {}
      }
      const committed = await this.commitManifest(manifest, null, generationsDurable)
      manifestCommitted = true
      await this.loadManifestState(committed, false)
      if (committed.durable) {
        for (const source of legacySources) await this.gcLegacySourceBestEffort(source.file, source.hash)
        if (playlistRaw) await this.gcLegacySourceBestEffort(playlistFile, exactHash(playlistRaw))
      }
    } catch (error) {
      if (!manifestCommitted) {
        if (!preserveUncommittedArtifacts(error)) await this.cleanupStaged(staged, true)
      } else await this.reconcileManifestBestEffort()
      throw error
    }
  }

  private cloneManifest(manifest: DashboardStorageManifest): DashboardStorageManifest {
    const baseSequence = Math.max(manifest.sequence, this.markerSequence)
    if (!Number.isSafeInteger(baseSequence) || baseSequence >= Number.MAX_SAFE_INTEGER) {
      throw new Error('Dashboard manifest sequence overflow; recovery is required.')
    }
    return {
      version: MANIFEST_VERSION,
      sequence: baseSequence + 1,
      generation: nextOpaqueToken(),
      dashboards: Object.fromEntries(Object.entries(manifest.dashboards).map(([id, entry]) => [id, { ...entry }])),
      playlist: { ...manifest.playlist },
      tombstones: { ...manifest.tombstones }
    }
  }

  private async stageGeneration(
    owner: string,
    exportName: string,
    raw: string,
    playlist = false
  ): Promise<StagedGeneration> {
    let value: unknown
    try {
      value = JSON.parse(raw) as unknown
    } catch (error) {
      throw new Error(`Staged dashboard JSON is malformed (${this.errorMessage(error)}).`)
    }
    if (playlist) {
      const error = dashboardPlaylistValidationError(value)
      if (error) throw new Error(`Staged dashboard playlist is invalid: ${error}`)
    } else {
      const result = dashboardStorageValidationResult(value)
      if (result.status !== 'valid' || result.dashboard.id !== owner) {
        throw new Error(`Staged dashboard "${owner}" is not canonical storage JSON.`)
      }
    }
    const hash = exactHash(raw)
    const ownerHash = createHash('sha256').update(owner, 'utf8').digest('hex').slice(0, 16)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const token = nextOpaqueToken()
      const file = `${GENERATION_PREFIX}${ownerHash}.${token}.${hash}.json`
      const path = join(this.storeDir, GENERATION_DIR, file)
      if (path.length > MAX_STORAGE_PATH) throw new Error(`Dashboard generation path exceeds ${MAX_STORAGE_PATH} characters.`)
      let handle: DashboardFileHandle | null = null
      try {
        handle = await this.fs.openExclusive(path)
        await handle.writeFile(raw, 'utf8')
        await handle.sync()
        await handle.close()
        handle = null
        return {
          path,
          entry: {
            file,
            exportName,
            hash,
            generation: `cas-v2:${token}`,
            sizeBytes: Buffer.byteLength(raw, 'utf8')
          }
        }
      } catch (error) {
        if (handle) try { await handle.close() } catch { /* preserve original failure */ }
        await this.discardStagedBestEffort(path, hash)
        if ((error as NodeJS.ErrnoException)?.code === 'EEXIST' && attempt < 4) continue
        throw error
      }
    }
    throw new Error('Could not allocate an immutable dashboard generation.')
  }

  private async stageImportSource(source: string): Promise<string> {
    const sourceInfo = await this.fs.statFile(source)
    if (sourceInfo.size > MAX_SIMHUB_IMPORT_BYTES) {
      throw new Error(`SimHub import exceeds the ${MAX_SIMHUB_IMPORT_BYTES}-byte archive limit.`)
    }
    const raw = await this.fs.readFile(source)
    if (exactBytes(raw).byteLength > MAX_SIMHUB_IMPORT_BYTES) {
      throw new Error(`SimHub import exceeds the ${MAX_SIMHUB_IMPORT_BYTES}-byte archive limit.`)
    }
    const path = join(this.storeDir, `.tmp-simhub-source-${nextOpaqueToken()}.simhubdash`)
    let handle: DashboardFileHandle | null = null
    try {
      handle = await this.fs.openExclusive(path)
      if (typeof raw === 'string') {
        await handle.writeFile(raw, 'utf8')
      } else {
        let decoded: string | null = null
        try { decoded = decodeExactUtf8(raw) } catch { /* binary archive */ }
        if (decoded !== null) await handle.writeFile(decoded, 'utf8')
        else await (handle as unknown as { writeFile(data: Uint8Array): Promise<void> }).writeFile(raw)
      }
      await handle.sync()
      await handle.close()
      handle = null
      return path
    } catch (error) {
      if (handle) try { await handle.close() } catch { /* preserve source staging failure */ }
      try { await this.fs.unlink(path) } catch { /* manager-owned staging cleanup */ }
      throw error
    }
  }

  private async commitManifest(
    manifest: DashboardStorageManifest,
    expectedHash: string | null,
    generationsDurable = true
  ): Promise<LoadedManifest> {
    const validated = parseManifest(manifest)
    const raw = serializeJson(validated)
    const hash = exactHash(raw)
    const pointer = join(this.storeDir, MANIFEST_FILE)
    let claim = ''
    let refreshClaim = ''
    let reservation = ''
    let reservationHandle: DashboardFileHandle | null = null
    try {
      if (expectedHash !== null) {
        claim = join(this.storeDir, `.tmp-manifest-claim-${nextOpaqueToken()}`)
        try {
          await this.fs.link(pointer, claim)
        } catch (error) {
          if (isMissing(error)) this.throwStale('Dashboard manifest pointer vanished before commit.')
          throw error
        }
        const claimed = await this.fs.readFile(claim)
        if (exactHash(claimed) !== expectedHash) {
          this.throwStale('Dashboard storage manifest changed at the atomic claim boundary.')
        }
        const claimedManifest = parseManifest(JSON.parse(decodeExactUtf8(claimed)) as unknown)
        const highest = await this.selectHighestCommittedManifest(false)
        if (!highest || !this.markerHash || highest.markerHash !== this.markerHash ||
          highest.markerSequence !== this.markerSequence || highest.hash !== expectedHash) {
          this.throwStale('Dashboard commit marker parent lineage changed before reservation.')
        }
        if (highest && (highest.manifest.sequence > claimedManifest.sequence ||
          (highest.manifest.sequence === claimedManifest.sequence && highest.hash !== expectedHash))) {
          this.throwStale('A newer committed dashboard manifest exists outside the active pointer.')
        }
      } else {
        let pointerExists = false
        try {
          await this.fs.readFile(pointer)
          pointerExists = true
        } catch (error) {
          if (!isMissing(error)) throw error
        }
        if (pointerExists) this.throwStale('Dashboard manifest pointer appeared before bootstrap commit.')
      }
      reservation = join(this.storeDir, MANIFEST_DIR, `.sequence-reserve-${validated.sequence}`)
      reservationHandle = await this.fs.openExclusive(reservation)
      const object = await this.ensureManifestObject(validated, raw)
      let durable = generationsDurable
      try {
        durable = (await this.fs.syncDirectory(join(this.storeDir, MANIFEST_DIR))) && durable
      } catch (error) {
        durable = false
        logger.warn('dashboards', 'manifest object committed but directory sync failed', { reason: this.errorMessage(error) })
      }
      await this.verifyManifestEntries(validated)
      let marker: CommitMarkerCandidate
      try {
        marker = await this.publishCommitMarker({
          version: 1,
          sequence: validated.sequence,
          manifestHash: hash,
          parentMarkerHash: this.markerHash
        })
      } catch (error) {
        if (error && typeof error === 'object') {
          Object.defineProperty(error, 'preserveUncommitted', { value: true })
        }
        throw error
      }
      try {
        durable = (await this.fs.syncDirectory(join(this.storeDir, MANIFEST_DIR))) && durable
      } catch (error) {
        durable = false
        logger.warn('dashboards', 'commit marker published but marker directory sync failed', {
          reason: this.errorMessage(error)
        })
      }
      let pointerUpdated = false
      let pointerRefreshAllowed = true
      if (expectedHash !== null) {
        refreshClaim = join(this.storeDir, `.tmp-manifest-claim-${nextOpaqueToken()}`)
        try {
          await this.fs.link(pointer, refreshClaim)
          if (exactHash(await this.fs.readFile(refreshClaim)) !== expectedHash) {
            pointerRefreshAllowed = false
            logger.warn('dashboards', 'commit marker published but advisory pointer changed externally', {
              reason: 'Pointer bytes changed after marker publication.'
            })
          }
        } catch (error) {
          pointerRefreshAllowed = false
          logger.warn('dashboards', 'commit marker published but advisory pointer claim failed', {
            reason: this.errorMessage(error)
          })
        }
      }
      if (pointerRefreshAllowed) {
        try {
          await this.replaceManifestPointer(object, expectedHash, refreshClaim || claim)
          pointerUpdated = true
        } catch (error) {
          this.storageState = 'ready'
          this.recoveryReason = null
          logger.warn('dashboards', 'commit marker published but advisory pointer refresh failed', {
            reason: this.errorMessage(error)
          })
        }
      }
      if (pointerUpdated) await this.verifyPublishedManifest(validated, hash)
      try {
        durable = (await this.fs.syncDirectory(this.storeDir)) && durable
      } catch (error) {
        durable = false
        logger.warn('dashboards', 'dashboard manifest committed but directory sync failed', { reason: this.errorMessage(error) })
      }
      return {
        manifest: validated,
        hash,
        durable,
        recoverable: true,
        markerHash: marker.hash,
        markerSequence: marker.marker.sequence
      }
    } catch (error) {
      throw error
    } finally {
      if (reservationHandle) try { await reservationHandle.close() } catch { /* reservation cleanup */ }
      if (reservation) try { await this.fs.unlink(reservation) } catch { /* stale reservations are ignored */ }
      if (refreshClaim) try { await this.fs.unlink(refreshClaim) } catch { /* advisory claim cleanup */ }
      if (claim) try { await this.fs.unlink(claim) } catch { /* claim cleanup is manager-owned */ }
    }
  }

  private async verifyPublishedManifest(manifest: DashboardStorageManifest, expectedHash: string): Promise<void> {
    const installed = await this.readManifest()
    if (!installed || installed.hash !== expectedHash) {
      this.throwStale('Published dashboard manifest changed before verification.')
    }

    try {
      await this.verifyManifestEntries(manifest)
    } catch (error) {
      this.throwStale(this.errorMessage(error))
    }
  }

  private async verifyManifestEntries(
    manifest: DashboardStorageManifest,
    allowMigration = false
  ): Promise<void> {
    for (const [id, entry] of Object.entries(manifest.dashboards)) {
      const { value } = await this.readGeneration(entry)
      const result = dashboardStorageValidationResult(value)
      if (result.status === 'quarantine' ||
        (!allowMigration && result.status !== 'valid') ||
        result.dashboard.id !== id) {
        throw new Error(`Published dashboard generation "${entry.file}" failed ownership validation.`)
      }
    }
    const playlist = await this.readGeneration(manifest.playlist)
    const playlistError = dashboardPlaylistValidationError(playlist.value)
    if (playlistError) throw new Error(`Published playlist generation "${manifest.playlist.file}" failed validation.`)
  }

  private async assertManifestCurrent(): Promise<LoadedManifest> {
    const current = await this.readManifest()
    if (current && this.manifestHash && current.hash === this.manifestHash) {
      current.durable = this.manifestDurable
      current.recoverable = this.manifestRecoverable
      current.markerHash = this.markerHash
      current.markerSequence = this.markerSequence
      return current
    }
    const authoritative = await this.selectHighestCommittedManifest(false)
    if (!authoritative || !this.markerHash || authoritative.markerHash !== this.markerHash) {
      this.throwStale('Dashboard storage marker lineage changed outside this dashboard manager.')
    }
    return authoritative
  }

  private async reconcileManifestBestEffort(): Promise<void> {
    try {
      const current = await this.readManifest()
      if (current) await this.loadManifestState(current)
    } catch (error) {
      logger.error('dashboards', 'could not reconcile dashboard state after manifest commit', { reason: this.errorMessage(error) })
    }
  }

  private async assertLegacySourceCurrent(file: string, expectedHash: string): Promise<void> {
    try {
      const raw = await this.fs.readFile(join(this.storeDir, file))
      if (exactHash(raw) !== expectedHash) this.throwStale(`${file}: legacy bytes changed during manifest migration.`)
    } catch (error) {
      if (isMissing(error)) this.throwStale(`${file}: legacy file vanished during manifest migration.`)
      throw error
    }
  }

  private async quarantineLegacyFile(file: string, expectedHash: string): Promise<boolean> {
    await this.assertLegacySourceCurrent(file, expectedHash)
    const nameHash = createHash('sha256').update(file, 'utf8').digest('hex').slice(0, 16)
    const source = join(this.storeDir, file)
    const target = join(this.storeDir, QUARANTINE_DIR, `q.${nameHash}.${nextOpaqueToken()}.json`)
    try {
      await this.fs.rename(source, target)
      const claimed = await this.fs.readFile(target)
      if (exactHash(claimed) !== expectedHash) {
        try {
          await this.fs.readFile(source)
        } catch (error) {
          if (isMissing(error)) await this.fs.rename(target, source)
        }
        return false
      }
      await this.fs.syncDirectory(join(this.storeDir, QUARANTINE_DIR))
      await this.fs.syncDirectory(this.storeDir)
      return true
    } catch (error) {
      if (isMissing(error)) this.throwStale(`${file}: invalid legacy file vanished before quarantine.`)
      throw error
    }
  }

  private async gcLegacySourceBestEffort(file: string, expectedHash: string): Promise<void> {
    await this.gcOwnedFileBestEffort(join(this.storeDir, file), expectedHash, `legacy-${file}`)
  }

  private async gcGenerationBestEffort(entry: ManifestFileEntry): Promise<void> {
    void entry
    await this.gcReachableGenerationsBestEffort()
  }

  private async cleanupStaged(
    staged: readonly StagedGeneration[],
    allowMissingManifestCleanup = false
  ): Promise<void> {
    let referenced = new Set<string>()
    try {
      const current = await this.readManifest()
      if (!current) {
        if (!allowMissingManifestCleanup) return
      } else {
      referenced = new Set([
        current.manifest.playlist.file.toLowerCase(),
        ...Object.values(current.manifest.dashboards).map((entry) => entry.file.toLowerCase())
      ])
      }
    } catch {
      return
    }
    for (const generation of staged) {
      if (!referenced.has(generation.entry.file.toLowerCase())) {
        await this.discardStagedBestEffort(generation.path, generation.entry.hash)
      }
    }
  }

  private async gcOwnedFileBestEffort(path: string, expectedHash: string, label: string): Promise<void> {
    try {
      const raw = await this.fs.readFile(path)
      if (exactHash(raw) !== expectedHash) return
      const quarantine = join(this.storeDir, QUARANTINE_DIR, `gc.${nextOpaqueToken()}.json`)
      await this.fs.rename(path, quarantine)
      const claimed = await this.fs.readFile(quarantine)
      if (exactHash(claimed) === expectedHash) await this.fs.unlink(quarantine)
      await this.fs.syncDirectory(join(this.storeDir, QUARANTINE_DIR))
    } catch (error) {
      if (!isMissing(error)) logger.warn('dashboards', 'could not garbage-collect dashboard storage file', { file: label, reason: this.errorMessage(error) })
    }
  }

  private async discardStagedBestEffort(path: string, expectedHash: string): Promise<void> {
    try {
      const quarantine = join(this.storeDir, QUARANTINE_DIR, `staged.${nextOpaqueToken()}.json`)
      await this.fs.rename(path, quarantine)
      const claimed = await this.fs.readFile(quarantine)
      if (exactHash(claimed) === expectedHash) await this.fs.unlink(quarantine)
    } catch { /* unpublished staged generations remain invisible and are retried on load */ }
  }

  private async cleanupCrashArtifacts(): Promise<void> {
    const manifest = this.manifest
    if (!manifest) return
    try {
      for (const name of await this.fs.readdir(this.storeDir)) {
        if (!OWNED_TEMP_PREFIXES.some((prefix) => name.startsWith(prefix))) continue
        if (name.startsWith('.tmp-simhub-source-')) {
          try {
            const { mtimeMs } = await this.fs.statFile(join(this.storeDir, name))
            if (Date.now() - mtimeMs < GENERATION_GC_GRACE_MS) continue
          } catch { continue }
        }
        try { await this.fs.unlink(join(this.storeDir, name)) } catch { /* retry on the next load */ }
      }
    } catch { /* storage remains usable; manifest owns visibility */ }
    if (!this.manifestDurable) return
    await this.gcReachableGenerationsBestEffort()
  }

  private async gcReachableGenerationsBestEffort(): Promise<void> {
    const referenced = new Set<string>()
    const generationDeletes: Array<{ path: string; hash: string; name: string }> = []
    const orphanMoves: Array<{ path: string }> = []
    let pointerHash = ''
    const addManifest = (manifest: DashboardStorageManifest): void => {
      referenced.add(manifest.playlist.file.toLowerCase())
      for (const entry of Object.values(manifest.dashboards)) referenced.add(entry.file.toLowerCase())
    }
    try {
      try {
        const pointer = await this.readManifest()
        if (!pointer) return
        pointerHash = pointer.hash
        addManifest(pointer.manifest)
      } catch {
        return
      }
      for (const name of await this.fs.readdir(join(this.storeDir, MANIFEST_DIR))) {
        const match = MANIFEST_OBJECT_PATTERN.exec(name)
        if (!match) continue
        try {
          const raw = await this.fs.readFile(join(this.storeDir, MANIFEST_DIR, name))
          if (exactHash(raw) !== match[2]) continue
          const manifest = parseManifest(JSON.parse(decodeExactUtf8(raw)) as unknown)
          if (manifest.sequence !== Number(match[1])) continue
          addManifest(manifest)
        } catch { /* invalid immutable manifests own nothing */ }
      }
      for (const name of await this.fs.readdir(this.storeDir)) {
        if (!name.startsWith(MANIFEST_BACKUP_PREFIX)) continue
        try {
          const raw = await this.fs.readFile(join(this.storeDir, name))
          addManifest(parseManifest(JSON.parse(decodeExactUtf8(raw)) as unknown))
        } catch { /* invalid external backups own nothing */ }
      }
      for (const name of await this.fs.readdir(join(this.storeDir, GENERATION_DIR))) {
        if (name === '.dashboard-storage-sync') continue
        if (referenced.has(name.toLowerCase())) continue
        const path = join(this.storeDir, GENERATION_DIR, name)
        try {
          const { mtimeMs } = await this.fs.statFile(path)
          if (Date.now() - mtimeMs < GENERATION_GC_GRACE_MS) continue
          const raw = await this.fs.readFile(path)
          const expectedHash = generationFileHash(name)
          if (expectedHash && exactHash(raw) === expectedHash) {
            generationDeletes.push({ path, hash: expectedHash, name })
          } else {
            orphanMoves.push({ path })
          }
        } catch { /* preserve unreadable leftovers for later recovery */ }
      }
      const boundary = await this.readManifest()
      if (!boundary || boundary.hash !== pointerHash) return
      for (const item of generationDeletes) await this.gcOwnedFileBestEffort(item.path, item.hash, item.name)
      for (const item of orphanMoves) {
        try {
          const target = join(this.storeDir, QUARANTINE_DIR, `orphan.${nextOpaqueToken()}.json`)
          await this.fs.rename(item.path, target)
        } catch { /* preserve raced orphan */ }
      }
    } catch { /* generation reachability GC is best-effort */ }
  }

  registerIpc(): void {
    const ipc = this.ctx.ipcMain
    ipc.handle('app:dash:list', async () => { await this.load(); return this.list() })
    ipc.handle('app:dash:get', async (_event, id: string) => { await this.load(); return this.getDashboard(id) })
    ipc.handle('app:dash:observe', (_event, id: string) => this.observe(id))
    ipc.handle('app:dash:save', (_event, dash: Dashboard, token: DashboardMutationToken) => this.save(dash, token))
    ipc.handle('app:dash:delete', (_event, id: string, token: DashboardMutationToken) => this.delete(id, token))
    ipc.handle('app:dash:setHidden', (_event, id: string, hidden: boolean, token: DashboardMutationToken) => this.setHidden(id, hidden, token))
    ipc.handle('app:dash:open', (_event, id: string, options?: DashboardOpenOptions) => this.openWindow(id, options))
    ipc.handle('app:dash:activate', (_event, id: string) => this.activate(id))
    ipc.handle('app:dash:close', async (_event, id: string) => { await this.load(); return this.closeWindow(id) })
    ipc.handle('app:dash:listOpen', async () => { await this.load(); return this.listOpen() })
    ipc.handle('app:dash:listDisplays', async () => { await this.load(); return this.listDisplays() })
    ipc.handle('app:dash:importSimhub', (_event, filePath?: string, options?: SimhubImportOptions) => this.importSimhub(filePath, options))
    ipc.handle('app:dash:exportSimhub', (_event, id: string, outPath?: string) => this.exportSimhub(id, outPath))
    ipc.handle('app:dash:createPreset', (_event, presetId: string) => this.createFromPreset(presetId))
    ipc.handle('app:dash:playlist:get', async () => { await this.load(); return this.getPlaylist() })
    ipc.handle('app:dash:playlist:set', (_event, playlist: DashboardPlaylist, token: DashboardMutationToken) => this.setPlaylist(playlist, token))
    ipc.handle('app:dash:cycle', (_event, direction: unknown = 'next') => this.cycle(direction === 'prev' ? 'prev' : 'next'))
  }

  list(): DashboardSummary[] {
    this.assertReady()
    return [...this.dashboards.values()]
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .map((dash) => summarizeDashboard(this.dashboardView(dash)))
  }

  getDashboard(id: string): Dashboard | null {
    this.assertReady()
    const dashboard = this.dashboards.get(id)
    return dashboard ? this.dashboardView(dashboard) : null
  }

  listOpen(): DashboardOpenState[] {
    const out: DashboardOpenState[] = []
    for (const [id, meta] of this.windows) {
      if (meta.window.isDestroyed()) continue
      out.push({ id, displayId: meta.displayId, fullscreen: meta.fullscreen })
    }
    return out
  }

  listDisplays(): DashboardDisplayInfo[] {
    const primary = screen.getPrimaryDisplay()
    return screen.getAllDisplays().map((display, index) => ({
      id: display.id,
      label: display.label && display.label.trim() ? display.label : `Monitor ${index + 1}`,
      bounds: { ...display.bounds },
      workArea: { ...display.workArea },
      scaleFactor: display.scaleFactor,
      isPrimary: display.id === primary.id,
      isInternal: Boolean((display as unknown as { internal?: boolean }).internal)
    }))
  }

  getPlaylist(): DashboardPlaylist {
    this.assertReady()
    return {
      items: this.playlist.items.map((item) => ({ ...item })),
      updatedAt: this.playlist.updatedAt,
      storageEpoch: this.storageEpoch,
      storageRevision: this.playlistRevision
    }
  }

  async observe(id: string): Promise<DashboardMutationToken> {
    await this.load()
    this.assertReady()
    let revision = this.revisionByDashboard.get(id)
    if (!revision) {
      revision = nextTombstoneRevision()
      this.revisionByDashboard.set(id, revision)
    }
    return { epoch: this.storageEpoch, revision }
  }

  async exportSnapshot(): Promise<DashboardStorageSnapshot> {
    await this.load()
    this.assertReady()
    return this.enqueueMutation(async () => {
      try {
        return await this.withStorageLock(async () => {
          const loaded = await this.assertManifestCurrent()
          const files: Record<string, unknown> = {}
          let sizeBytes = 0
          for (const [id, entry] of Object.entries(loaded.manifest.dashboards)) {
            const { raw, value } = await this.readGeneration(entry)
            const result = dashboardStorageValidationResult(value)
            if (result.status === 'quarantine') throw new Error(`${entry.file}: ${result.error}`)
            if (result.dashboard.id !== id) throw new Error(`${entry.file}: owned id changed from "${id}".`)
            files[entry.exportName] = value
            sizeBytes += exactBytes(raw).byteLength
          }
          const playlistRead = await this.readGeneration(loaded.manifest.playlist)
          const playlistError = dashboardPlaylistValidationError(playlistRead.value)
          if (playlistError) throw new Error(`${loaded.manifest.playlist.file}: ${playlistError}`)
          files[loaded.manifest.playlist.exportName] = playlistRead.value
          sizeBytes += exactBytes(playlistRead.raw).byteLength
          return { files, sizeBytes, itemCount: Object.keys(files).length, modifiedAt: null }
        })
      } catch (error) {
        this.storageState = 'recovery'
        this.recoveryReason = error instanceof Error ? error.message : String(error)
        throw new DashboardStorageUnavailableError('recovery', this.recoveryReason)
      }
    })
  }

  async setPlaylist(playlist: DashboardPlaylist, token: DashboardMutationToken): Promise<DashboardPlaylist> {
    await this.load()
    this.assertReady()
    return this.enqueueMutation(async () => {
      this.assertToken(token, this.playlistRevision)
      const { storageEpoch: _epoch, storageRevision: _revision, ...input } = playlist
      const next: DashboardPlaylist = {
        ...input,
        items: Array.isArray(input.items) ? input.items.map((item) => ({ ...item })) : input.items,
        updatedAt: Date.now()
      }
      const validationError = dashboardPlaylistValidationError(next)
      if (validationError) throw new Error(`Invalid dashboard playlist: ${validationError}`)
      return this.withStorageLock(async () => {
        const current = await this.assertManifestCurrent()
        await this.assertGenerationCurrent(current.manifest.playlist, null)
        const staged = await this.stageGeneration(
          'playlist',
          current.manifest.playlist.exportName,
          serializeJson(next),
          true
        )
        let manifestCommitted = false
        try {
          const generationsDurable = await this.fs.syncDirectory(join(this.storeDir, GENERATION_DIR))
          const manifest = this.cloneManifest(current.manifest)
          manifest.playlist = staged.entry
          const committed = await this.commitManifest(manifest, current.hash, generationsDurable)
          manifestCommitted = true
          this.manifest = committed.manifest
          this.manifestHash = committed.hash
          this.manifestDurable = committed.durable
          this.manifestRecoverable = committed.recoverable ?? true
          this.markerHash = committed.markerHash ?? this.markerHash
          this.markerSequence = committed.markerSequence ?? committed.manifest.sequence
          this.playlist = next
          this.playlistRevision = manifestRevision(staged.entry)
          this.currentPlaylistIndex = -1
          const view = this.getPlaylist()
          this.broadcastBestEffort('app:dash:playlist', view)
          if (committed.durable) await this.gcGenerationBestEffort(current.manifest.playlist)
          return view
        } catch (error) {
          if (!manifestCommitted) {
            if (!preserveUncommittedArtifacts(error)) await this.cleanupStaged([staged])
          } else await this.reconcileManifestBestEffort()
          throw error
        }
      })
    })
  }

  async cycle(direction: 'next' | 'prev' = 'next'): Promise<DashboardOpenState | null> {
    await this.load()
    this.assertReady()
    const now = Date.now()
    if (this.cycleInFlight || now - this.lastCycleAt < CYCLE_DEBOUNCE_MS) return null

    const items = this.resolveOpenablePlaylistItems()
    if (items.length === 0) return null

    this.cycleInFlight = true
    try {
      const step = resolveCycleStep(items, this.currentPlaylistIndex, (item) => this.isTargetOpen(item), direction)
      if (!step) return null

      // Carry the current dashboard's display/fullscreen forward when the next
      // item doesn't pin its own (touch panels have no open-state to inherit).
      const currentDashOpen =
        step.current && !isTouchPanelPlaylistItem(step.current)
          ? this.listOpen().find((open) => open.id === step.current!.dashboardId)
          : undefined
      const displayId =
        step.next.displayId ?? currentDashOpen?.displayId ?? step.current?.displayId ?? screen.getPrimaryDisplay().id
      const fullscreen = step.next.fullscreen ?? currentDashOpen?.fullscreen ?? step.current?.fullscreen ?? true

      const opened = await this.openTarget(step.next, { displayId, fullscreen })
      // Close the previous cockpit only when it isn't the same window we just
      // (re)opened. openTarget already closes the opposite-kind sibling, so this
      // only matters for dashboard→dashboard transitions.
      if (step.current && !sameCockpitTarget(step.current, step.next)) {
        await this.closeTarget(step.current)
      }
      this.currentPlaylistIndex = step.nextIndex
      this.lastCycleAt = Date.now()
      return opened
    } finally {
      this.cycleInFlight = false
    }
  }

  // Live TouchPanelManager, resolved lazily (both managers register in the same
  // startup loop; this is only ever read at cycle/activate time).
  private touch(): TouchPanelManager | null {
    return getTouchPanelManager()
  }

  private resolveOpenablePlaylistItems(): DashboardPlaylistItem[] {
    const touch = this.touch()
    return openablePlaylistItems(
      this.playlist.items,
      (id) => this.dashboards.has(id),
      (id) => (touch ? touch.has(id) : false)
    )
  }

  private isTargetOpen(item: DashboardPlaylistItem): boolean {
    if (isTouchPanelPlaylistItem(item)) {
      return this.touch()?.currentOpenPanelId() === touchPanelIdOf(item)
    }
    return this.listOpen().some((open) => open.id === item.dashboardId)
  }

  // Open a playlist item as the single visible cockpit window, closing the
  // opposite-kind sibling so a dashboard and a button-box are never both up.
  private async openTarget(
    item: DashboardPlaylistItem,
    options: DashboardOpenOptions
  ): Promise<DashboardOpenState | null> {
    if (isTouchPanelPlaylistItem(item)) {
      for (const open of this.listOpen()) await this.closeWindow(open.id)
      const panelId = touchPanelIdOf(item)
      const res = this.touch()?.openWindow({
        panelId,
        displayId: options.displayId,
        fullscreen: options.fullscreen
      })
      return res ? { id: panelId, displayId: res.displayId, fullscreen: res.fullscreen } : null
    }
    this.touch()?.closeWindow()
    return this.openWindow(item.dashboardId, options)
  }

  private async closeTarget(item: DashboardPlaylistItem): Promise<void> {
    if (isTouchPanelPlaylistItem(item)) {
      this.touch()?.closeWindow()
      return
    }
    await this.closeWindow(item.dashboardId)
  }

  // Serialize dashboard activations. Two "switch dashboard" expressions can go
  // rising-edge in the same tick; without a queue their async open/close
  // sequences interleave and the final visible window becomes nondeterministic.
  // Each call waits for the previous activation to settle before running.
  async activate(id: string): Promise<DashboardOpenState> {
    await this.load()
    this.assertReady()
    const run = this.activateChain.then(() => this.activateInternal(id))
    // Keep the queue alive even when an activation rejects.
    this.activateChain = run.then(
      () => undefined,
      () => undefined
    )
    return await run
  }

  private async activateInternal(id: string): Promise<DashboardOpenState> {
    const openStates = this.listOpen()
    const currentOpen = openStates[0]
    const playlistIndex = this.playlist.items.findIndex(
      (item) => item.dashboardId === id || item.touchPanelId === id
    )
    const playlistItem = playlistIndex >= 0 ? this.playlist.items[playlistIndex] : undefined
    const touch = this.touch()
    // Route to the button-box cockpit when the playlist entry is a touch panel,
    // or when the id itself resolves to a known panel (e.g. a "switch dashboard"
    // expression that targets a panel not in the playlist).
    const routeTouch = playlistItem ? isTouchPanelPlaylistItem(playlistItem) : Boolean(touch?.has(id))

    if (routeTouch) {
      const panelId = playlistItem ? touchPanelIdOf(playlistItem) : id
      // Close every dashboard window so only the button-box is visible.
      for (const open of openStates) await this.closeWindow(open.id)
      const res = touch?.openWindow({
        panelId,
        displayId: playlistItem?.displayId ?? currentOpen?.displayId ?? screen.getPrimaryDisplay().id,
        fullscreen: playlistItem?.fullscreen ?? true
      })
      this.currentPlaylistIndex = playlistIndex
      if (!res) throw new Error(`Touch panel not found: ${id}`)
      return { id: panelId, displayId: res.displayId, fullscreen: res.fullscreen }
    }

    // Dashboard route: also tear down the touch cockpit so only one is up.
    touch?.closeWindow()
    const opened = await this.openWindow(id, {
      displayId: playlistItem?.displayId ?? currentOpen?.displayId ?? screen.getPrimaryDisplay().id,
      fullscreen: playlistItem?.fullscreen ?? currentOpen?.fullscreen ?? true
    })
    for (const open of openStates) {
      if (open.id !== id) await this.closeWindow(open.id)
    }
    this.currentPlaylistIndex = playlistIndex
    return opened
  }

  async save(dash: Dashboard, token?: DashboardMutationToken): Promise<DashboardSummary> {
    await this.load()
    this.assertReady()
    if (!token && (this.dashboards.has(dash.id) || this.revisionByDashboard.has(dash.id))) {
      throw new Error(`${STALE_ERROR_CODE}: observe the dashboard id before replacing existing storage.`)
    }
    const mutationToken = token ?? await this.observe(dash.id)
    return this.enqueueMutation(() => this.saveCore(dash, mutationToken))
  }

  async delete(id: string, token: DashboardMutationToken): Promise<DashboardSummary[]> {
    await this.load()
    this.assertReady()
    return this.enqueueMutation(async () => {
      const dashboard = this.dashboards.get(id)
      if (!dashboard) throw new Error(`Dashboard not found: ${id}`)
      const revision = this.revisionByDashboard.get(id)
      if (!revision) throw new Error(`${RECOVERY_ERROR_CODE}: dashboard "${id}" has no revision.`)
      this.assertToken(token, revision)
      return this.withStorageLock(async () => {
        const current = await this.assertManifestCurrent()
        const entry = current.manifest.dashboards[id]
        if (!entry) throw new Error(`${RECOVERY_ERROR_CODE}: dashboard "${id}" has no manifest entry.`)
        await this.assertGenerationCurrent(entry, id)
        const tombstone = nextTombstoneRevision()
        const manifest = this.cloneManifest(current.manifest)
        delete manifest.dashboards[id]
        manifest.tombstones[id] = tombstone
        const committed = await this.commitManifest(manifest, current.hash)
        this.manifest = committed.manifest
        this.manifestHash = committed.hash
        this.manifestDurable = committed.durable
        this.manifestRecoverable = committed.recoverable ?? true
        this.markerHash = committed.markerHash ?? this.markerHash
        this.markerSequence = committed.markerSequence ?? committed.manifest.sequence
        this.dashboards.delete(id)
        this.revisionByDashboard.set(id, tombstone)
        if (this.windows.has(id)) await this.closeWindow(id)
        const list = this.list()
        this.broadcastBestEffort('app:dash:list', list)
        this.broadcastBestEffort('app:dash:removed', { id, storageEpoch: this.storageEpoch })
        if (committed.durable) await this.gcGenerationBestEffort(entry)
        return list
      })
    })
  }

  async setHidden(
    id: string,
    hidden: boolean,
    token: DashboardMutationToken
  ): Promise<DashboardSummary[]> {
    await this.load()
    this.assertReady()
    return this.enqueueMutation(async () => {
      const dashboard = this.dashboards.get(id)
      if (!dashboard) throw new Error(`Dashboard not found: ${id}`)
      await this.saveCore({ ...dashboard, hidden: Boolean(hidden) }, token)
      return this.list()
    })
  }

  async createFromPreset(presetId: string): Promise<DashboardSummary> {
    await this.load()
    this.assertReady()
    const preset = this.presets.find((p) => p.id === presetId)
    if (!preset) throw new Error(`Preset unknown: ${presetId}`)
    return this.enqueueMutation(async () => {
      const source = preset.build()
      let id = createDashboardId()
      while (this.dashboards.has(id) || this.revisionByDashboard.has(id)) id = createDashboardId()
      const names = new Set([...this.dashboards.values()].map((dashboard) => dashboard.name))
      const baseName = `${source.name} copy`
      let name = baseName
      for (let suffix = 2; names.has(name); suffix += 1) name = `${baseName} ${suffix}`
      const now = Date.now()
      const dash: Dashboard = { ...source, id, name, createdAt: now, updatedAt: now }
      const revision = nextTombstoneRevision()
      this.revisionByDashboard.set(id, revision)
      return this.saveCore(dash, { epoch: this.storageEpoch, revision })
    })
  }

  // Built-in presets are seeded to disk only on the very first run. On existing
  // installs, presets shipped in later versions are never materialized, so a
  // "switch dashboard" expression targeting one fails with "não found".
  // Resolve those lazily: when a requested id matches a known preset id, build +
  // persist it on demand (under the stable preset id) so it becomes openable.
  private async materializeBuiltinPreset(id: string): Promise<Dashboard | null> {
    const preset = this.presets.find((p) => p.id === id)
    if (!preset) return null
    const built = preset.build()
    const dash: Dashboard = { ...built, id }
    return this.enqueueMutation(async () => {
      if (this.dashboards.has(id)) return this.dashboards.get(id)!
      let revision = this.revisionByDashboard.get(id)
      if (!revision) { revision = nextTombstoneRevision(); this.revisionByDashboard.set(id, revision) }
      await this.saveCore(dash, { epoch: this.storageEpoch, revision })
      return this.dashboards.get(id) ?? null
    })
  }

  async importSimhub(filePath?: string, options: SimhubImportOptions = {}): Promise<SimhubImportResponse> {
    await this.load()
    this.assertReady()
    const target = filePath ?? (await this.pickOpenPath())
    if (!target) throw new Error('Import canceled.')
    const stagedSource = await this.stageImportSource(target)
    try {
      const first = await importSimhubDash(stagedSource, { screenIndex: options.screenIndex })
      if (options.inspectOnly && first.screens.length > 1 && options.screenIndex === undefined) {
        return {
          notes: first.notes,
          screens: first.screens,
          selectedScreenIndex: first.selectedScreenIndex,
          filePath: target
        }
      }
      if (options.importAll && first.screens.length > 1) {
        const dashboards: Dashboard[] = []
        const allNotes = [...first.notes]
        for (const screen of first.screens) {
          const result = screen.index === first.selectedScreenIndex
            ? first
            : await importSimhubDash(stagedSource, { screenIndex: screen.index })
          const validationError = dashboardValidationError(result.dashboard)
          if (validationError) throw new Error(`Imported dashboard is invalid (${screen.name}): ${validationError}`)
          dashboards.push(result.dashboard)
          for (const note of result.notes) if (!allNotes.includes(note)) allNotes.push(note)
        }
        const summaries = await this.importDashboards(dashboards)
        return { summaries, notes: allNotes, screens: first.screens, selectedScreenIndex: first.selectedScreenIndex, filePath: target }
      }
      const validationError = dashboardValidationError(first.dashboard)
      if (validationError) throw new Error(`Imported dashboard is invalid: ${validationError}`)
      const [summary] = await this.importDashboards([first.dashboard])
      return {
        summary,
        notes: first.notes,
        screens: first.screens,
        selectedScreenIndex: first.selectedScreenIndex,
        filePath: target
      }
    } finally {
      try { await this.fs.unlink(stagedSource) } catch { /* manager-owned import staging cleanup */ }
    }
  }

  async exportSimhub(id: string, outPath?: string): Promise<{ path: string }> {
    await this.load()
    this.assertReady()
    const dash = this.dashboards.get(id)
    if (!dash) throw new Error(`Dashboard not found: ${id}`)
    const target = outPath ?? (await this.pickSavePath(dash.name))
    if (!target) throw new Error('Export canceled.')
    await exportSimhubDash(dash, target)
    return { path: target }
  }

  async openWindow(id: string, options: DashboardOpenOptions = {}): Promise<DashboardOpenState> {
    await this.load()
    this.assertReady()
    let dash = this.dashboards.get(id)
    if (!dash) dash = (await this.materializeBuiltinPreset(id)) ?? undefined
    if (!dash) throw new Error(`Dashboard not found: ${id}`)

    // Se já está aberto e for o mesmo monitor/fullscreen, reaproveita; senão, fecha e reabre.
    const existing = this.windows.get(id)
    if (existing && !existing.window.isDestroyed()) {
      if (
        (options.displayId === undefined || options.displayId === existing.displayId) &&
        (options.fullscreen === undefined || options.fullscreen === existing.fullscreen) &&
        (options.kiosk ?? false) === existing.kiosk
      ) {
        existing.window.focus()
        return { id, displayId: existing.displayId, fullscreen: existing.fullscreen }
      }
      await this.closeWindow(id)
    }

    const displays = screen.getAllDisplays()
    const display = options.displayId !== undefined
      ? displays.find((d) => d.id === options.displayId) ?? screen.getPrimaryDisplay()
      : screen.getPrimaryDisplay()
    const fullscreen = options.fullscreen ?? true
    const bounds = display.bounds

    const win = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      title: `Dashboard · ${dash.name}`,
      backgroundColor: '#000000',
      frame: !fullscreen,
      autoHideMenuBar: true,
      fullscreen,
      skipTaskbar: false,
      webPreferences: {
        // Reaproveita o preload do overlay (somente window.ipc) — dashboards
        // são consumidores de telemetria sem acesso à serial/profile API.
        preload: join(__dirname, '../preload/overlay.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false
      }
    })

    win.webContents.setWindowOpenHandler(({ url }) => {
      openExternalUrl(url)
      return { action: 'deny' }
    })

    win.webContents.on('will-navigate', (event, url) => {
      if (isAllowedAppNavigation(url)) return
      event.preventDefault()
      openExternalUrl(url)
    })

    win.on('closed', () => {
      // Only clear tracking if THIS window is still the tracked one. A previous
      // window's async 'closed' (after a reopen on a different display) must not
      // delete the entry that now belongs to the new window.
      if (this.windows.get(id)?.window === win) this.windows.delete(id)
      if (!this.isDisposing) {
        this.broadcastBestEffort('app:dash:openState', this.listOpen())
      }
    })

    win.webContents.once('did-finish-load', () => {
      try {
        win.webContents.send('app:dash:updated', dash)
        win.webContents.send('telemetry:snapshot', this.ctx.telemetryHub.getLatest())
      } catch {
        // janela já fechada
      }
    })

    if (process.env.ELECTRON_RENDERER_URL) {
      const url = applyDashboardQuery(new URL('dashboard.html', process.env.ELECTRON_RENDERER_URL), id, options.kiosk)
      void win.loadURL(url.toString())
    } else {
      void win.loadFile(join(__dirname, '../renderer/dashboard.html'), { query: buildDashboardQuery(id, options.kiosk) })
    }

    this.windows.set(id, { window: win, displayId: display.id, fullscreen, kiosk: options.kiosk ?? false })
    logger.info('dashboards', 'dashboard window opened', { id, name: dash.name, displayId: display.id, fullscreen })
    this.broadcastBestEffort('app:dash:openState', this.listOpen())
    return { id, displayId: display.id, fullscreen }
  }

  async closeWindow(id: string): Promise<DashboardOpenState[]> {
    const meta = this.windows.get(id)
    const hadWindow = Boolean(meta && !meta.window.isDestroyed())
    if (meta && !meta.window.isDestroyed()) {
      meta.window.close()
    }
    this.windows.delete(id)
    logger.info('dashboards', 'dashboard window closed', { id, hadWindow })
    const list = this.listOpen()
    this.broadcastBestEffort('app:dash:openState', list)
    return list
  }

  async dispose(): Promise<void> {
    this.isDisposing = true
    this.unregisterScreenListeners()
    logger.info('dashboards', 'dispose: closing dashboard windows', { count: this.windows.size })
    for (const id of [...this.windows.keys()]) {
      const meta = this.windows.get(id)
      if (meta && !meta.window.isDestroyed()) meta.window.close()
      this.windows.delete(id)
    }
  }

  private assertReady(): void {
    this.assertAvailable()
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  private enterRecovery(reason: string): void {
    this.storageState = 'recovery'
    this.recoveryReason = reason
    logger.error('dashboards', 'dashboard storage entered recovery mode', { reason })
  }

  private throwStale(reason: string): never {
    this.enterRecovery(reason)
    throw new Error(`${STALE_ERROR_CODE}: ${reason}`)
  }

  private throwUnavailable(reason: string): never {
    this.enterRecovery(reason)
    throw new DashboardStorageUnavailableError('recovery', reason)
  }

  private dashboardView(dashboard: Dashboard): Dashboard {
    const revision = this.revisionByDashboard.get(dashboard.id)
    if (!revision) throw new Error(`${RECOVERY_ERROR_CODE}: dashboard "${dashboard.id}" has no revision.`)
    return {
      ...dashboard,
      storageEpoch: this.storageEpoch,
      storageRevision: revision
    }
  }

  private assertToken(token: DashboardMutationToken, expectedRevision: string): void {
    if (
      !token ||
      typeof token.epoch !== 'string' ||
      (token.revision !== null && typeof token.revision !== 'string') ||
      token.epoch !== this.storageEpoch ||
      token.revision !== expectedRevision
    ) {
      throw new Error(`${STALE_ERROR_CODE}: refresh dashboard storage before retrying the change.`)
    }
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationChain.then(() => { this.assertReady(); return operation() })
    this.mutationChain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private async withStorageLock<T>(operation: () => Promise<T>): Promise<T> {
    const address = storageLockAddress(this.storeDir)
    let lock: Server | null = null
    let lastError: unknown
    for (let attempt = 0; attempt < STORAGE_LOCK_MAX_ATTEMPTS; attempt += 1) {
      try {
        lock = await new Promise<Server>((resolveLock, rejectLock) => {
          const server = createServer((socket) => socket.destroy())
          const onError = (error: NodeJS.ErrnoException): void => {
            server.removeListener('listening', onListening)
            rejectLock(error)
          }
          const onListening = (): void => {
            server.removeListener('error', onError)
            server.on('error', (error) => {
              logger.warn('dashboards', 'dashboard storage OS lock server error', { reason: error.message })
            })
            server.unref()
            resolveLock(server)
          }
          server.once('error', onError)
          server.once('listening', onListening)
          server.listen(address)
        })
        break
      } catch (error) {
        lastError = error
        if ((error as NodeJS.ErrnoException)?.code !== 'EADDRINUSE') {
          this.throwUnavailable(`Could not acquire the dashboard storage OS lock (${this.errorMessage(error)}).`)
        }
        if (attempt === STORAGE_LOCK_MAX_ATTEMPTS - 1) {
          this.throwUnavailable('Timed out waiting for another dashboard manager to release the storage OS lock.')
        }
        await delay(STORAGE_LOCK_RETRY_MS)
      }
    }
    if (!lock) {
      this.throwUnavailable(`Could not acquire the dashboard storage OS lock (${this.errorMessage(lastError)}).`)
    }
    try {
      return await operation()
    } finally {
      await new Promise<void>((resolveClose) => {
        lock.close((error) => {
          if (error) logger.warn('dashboards', 'could not release dashboard storage OS lock', { reason: error.message })
          resolveClose()
        })
      })
    }
  }

  private async assertGenerationCurrent(entry: ManifestFileEntry, owner: string | null): Promise<void> {
    let value: unknown
    try {
      value = (await this.readGeneration(entry)).value
    } catch (error) {
      this.throwStale(this.errorMessage(error))
    }
    if (owner === null) {
      const error = dashboardPlaylistValidationError(value)
      if (error) this.throwStale(`${entry.file}: ${error}`)
      return
    }
    const result = dashboardStorageValidationResult(value)
    if (result.status !== 'valid' || result.dashboard.id !== owner) {
      this.throwStale(`${entry.file}: owned dashboard schema or id changed outside this dashboard manager.`)
    }
  }

  private async saveCore(dashboard: Dashboard, token: DashboardMutationToken, broadcast = true): Promise<DashboardSummary> {
    const { storageEpoch: _epoch, storageRevision: _revision, ...input } = dashboard
    const now = Date.now()
    const candidate: Dashboard = { ...input, createdAt: typeof input.createdAt === 'number' ? input.createdAt : now, updatedAt: now }
    const storageResult = dashboardStorageValidationResult(candidate)
    if (storageResult.status === 'quarantine') throw new Error(`Invalid dashboard: ${storageResult.error}`)
    const next = cleanDashboard(storageResult.dashboard)

    const expectedRevision = this.revisionByDashboard.get(next.id)
    if (!expectedRevision) throw new Error(`${STALE_ERROR_CODE}: observe the dashboard id before saving.`)
    this.assertToken(token, expectedRevision)
    return this.withStorageLock(async () => {
      const current = await this.assertManifestCurrent()
      const previous = current.manifest.dashboards[next.id]
      if (previous) await this.assertGenerationCurrent(previous, next.id)
      const exportName = previous?.exportName ?? dashboardFileNameForId(this.storeDir, next.id)
      if (!previous) {
        const key = exportName.toLowerCase()
        if (current.manifest.playlist.exportName.toLowerCase() === key ||
          Object.entries(current.manifest.dashboards).some(([id, entry]) => id !== next.id && entry.exportName.toLowerCase() === key)) {
          throw new Error(`Dashboard storage export filename collision for "${next.id}".`)
        }
      }
      const staged = await this.stageGeneration(next.id, exportName, serializeJson(next))
      let manifestCommitted = false
      try {
        const generationsDurable = await this.fs.syncDirectory(join(this.storeDir, GENERATION_DIR))
        const manifest = this.cloneManifest(current.manifest)
        manifest.dashboards[next.id] = staged.entry
        delete manifest.tombstones[next.id]
        const committed = await this.commitManifest(manifest, current.hash, generationsDurable)
        manifestCommitted = true
        this.manifest = committed.manifest
        this.manifestHash = committed.hash
        this.manifestDurable = committed.durable
        this.manifestRecoverable = committed.recoverable ?? true
        this.markerHash = committed.markerHash ?? this.markerHash
        this.markerSequence = committed.markerSequence ?? committed.manifest.sequence
        this.dashboards.set(next.id, next)
        this.revisionByDashboard.set(next.id, manifestRevision(staged.entry))
        const view = this.dashboardView(next)
        const summary = summarizeDashboard(view)
        if (broadcast) {
          this.broadcastBestEffort('app:dash:list', this.list())
          this.broadcastBestEffort('app:dash:updated', view)
        }
        if (committed.durable && previous) await this.gcGenerationBestEffort(previous)
        return summary
      } catch (error) {
        if (!manifestCommitted) {
          if (!preserveUncommittedArtifacts(error)) await this.cleanupStaged([staged])
        } else await this.reconcileManifestBestEffort()
        throw error
      }
    })
  }

  private async importDashboards(dashboards: Dashboard[]): Promise<DashboardSummary[]> {
    const normalized: Dashboard[] = []
    const ids = new Set<string>()
    for (const input of dashboards) {
      const candidate = cleanDashboard({
        ...input,
        createdAt: typeof input.createdAt === 'number' ? input.createdAt : Date.now(),
        updatedAt: Date.now()
      })
      const storageResult = dashboardStorageValidationResult(candidate)
      if (storageResult.status === 'quarantine') throw new Error(`Imported dashboard is invalid: ${storageResult.error}`)
      const dashboard = cleanDashboard(storageResult.dashboard)
      if (ids.has(dashboard.id)) throw new Error(`Imported dashboards contain duplicate id "${dashboard.id}".`)
      ids.add(dashboard.id)
      normalized.push(dashboard)
    }
    return this.enqueueMutation(async () => {
      return this.withStorageLock(async () => {
        const current = await this.assertManifestCurrent()
        const staged: Array<{ dashboard: Dashboard; generation: StagedGeneration; previous?: ManifestFileEntry }> = []
        let manifestCommitted = false
        try {
          const exportOwners = new Map<string, string>([
            [current.manifest.playlist.exportName.toLowerCase(), 'playlist'],
            ...Object.entries(current.manifest.dashboards)
              .filter(([id]) => !ids.has(id))
              .map(([id, entry]) => [entry.exportName.toLowerCase(), id] as [string, string])
          ])
          for (const dashboard of normalized) {
            const previous = current.manifest.dashboards[dashboard.id]
            if (previous) await this.assertGenerationCurrent(previous, dashboard.id)
            const exportName = previous?.exportName ?? dashboardFileNameForId(this.storeDir, dashboard.id)
            const exportKey = exportName.toLowerCase()
            const collision = exportOwners.get(exportKey)
            if (collision) throw new Error(`Dashboard storage export filename collision between "${dashboard.id}" and "${collision}".`)
            exportOwners.set(exportKey, dashboard.id)
            const generation = await this.stageGeneration(dashboard.id, exportName, serializeJson(dashboard))
            staged.push({ dashboard, generation, previous })
          }
          const generationsDurable = await this.fs.syncDirectory(join(this.storeDir, GENERATION_DIR))
          const manifest = this.cloneManifest(current.manifest)
          for (const item of staged) {
            manifest.dashboards[item.dashboard.id] = item.generation.entry
            delete manifest.tombstones[item.dashboard.id]
          }
          const committed = await this.commitManifest(manifest, current.hash, generationsDurable)
          manifestCommitted = true
          this.manifest = committed.manifest
          this.manifestHash = committed.hash
          this.manifestDurable = committed.durable
          this.manifestRecoverable = committed.recoverable ?? true
          this.markerHash = committed.markerHash ?? this.markerHash
          this.markerSequence = committed.markerSequence ?? committed.manifest.sequence
          for (const item of staged) {
            const id = item.dashboard.id
            this.dashboards.set(id, item.dashboard)
            this.revisionByDashboard.set(id, manifestRevision(item.generation.entry))
          }
          this.broadcastImportedDashboards(normalized.map((dashboard) => dashboard.id))
          if (committed.durable) {
            for (const item of staged) if (item.previous) await this.gcGenerationBestEffort(item.previous)
          }
          return normalized.map((dashboard) => summarizeDashboard(this.dashboardView(dashboard)))
        } catch (error) {
          if (!manifestCommitted && !preserveUncommittedArtifacts(error)) {
            await this.cleanupStaged(staged.map((item) => item.generation))
          } else if (manifestCommitted) await this.reconcileManifestBestEffort()
          throw error
        }
      })
    })
  }

  private broadcastImportedDashboards(ids: string[]): void {
    if (ids.length === 0) return
    if (this.storageState === 'ready') this.broadcastBestEffort('app:dash:list', this.list())
    for (const id of ids) {
      const dashboard = this.dashboards.get(id)
      if (dashboard) this.broadcastBestEffort('app:dash:updated', this.dashboardView(dashboard))
    }
  }

  private broadcastBestEffort(channel: string, payload: unknown): void {
    try {
      this.ctx.broadcast(channel, payload)
    } catch (error) {
      logger.warn('dashboards', 'dashboard broadcast notification failed after committed storage change', {
        channel,
        reason: this.errorMessage(error)
      })
    }
  }

  private registerScreenListeners(): void {
    if (this.screenListenersRegistered) return
    screen.on('display-added', this.onDisplaysChanged)
    screen.on('display-removed', this.onDisplaysChanged)
    screen.on('display-metrics-changed', this.onDisplaysChanged)
    this.screenListenersRegistered = true
  }

  private unregisterScreenListeners(): void {
    if (!this.screenListenersRegistered) return
    screen.off('display-added', this.onDisplaysChanged)
    screen.off('display-removed', this.onDisplaysChanged)
    screen.off('display-metrics-changed', this.onDisplaysChanged)
    this.screenListenersRegistered = false
  }

  private broadcastDisplayState(): void {
    this.broadcastBestEffort('app:dash:openState', this.listOpen())
    this.broadcastBestEffort('app:dash:displaysChanged', this.listDisplays())
  }

  private reconcileWindowDisplays(): void {
    const displays = screen.getAllDisplays()
    const primary = screen.getPrimaryDisplay()
    for (const [, meta] of this.windows) {
      if (meta.window.isDestroyed()) continue
      const display = displays.find((candidate) => candidate.id === meta.displayId) ?? nearestDisplay(meta.window.getBounds(), displays) ?? primary
      const currentBounds = meta.window.getBounds()
      if (meta.displayId === display.id && sameRectangle(currentBounds, display.bounds)) continue
      meta.displayId = display.id
      try {
        if (meta.fullscreen) meta.window.setFullScreen(false)
        meta.window.setBounds(display.bounds)
        if (meta.fullscreen) meta.window.setFullScreen(true)
      } catch {
        // janela pode estar fechando durante uma mudança de monitor
      }
    }
  }

  private async pickOpenPath(): Promise<string | null> {
    const owner = this.ctx.getMainWindow()
    const result = owner
      ? await dialog.showOpenDialog(owner, {
          title: 'Importar .simhubdash',
          filters: [{ name: 'SimHub Dashboard', extensions: ['simhubdash', 'zip'] }],
          properties: ['openFile']
        })
      : await dialog.showOpenDialog({
          title: 'Importar .simhubdash',
          filters: [{ name: 'SimHub Dashboard', extensions: ['simhubdash', 'zip'] }],
          properties: ['openFile']
        })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  }

  private async pickSavePath(name: string): Promise<string | null> {
    const owner = this.ctx.getMainWindow()
    const safe = name.replace(/[^A-Za-z0-9 _.-]/g, '_')
    const opts = {
      title: 'Exportar .simhubdash',
      defaultPath: `${safe}.simhubdash`,
      filters: [{ name: 'SimHub Dashboard', extensions: ['simhubdash'] }]
    }
    const result = owner ? await dialog.showSaveDialog(owner, opts) : await dialog.showSaveDialog(opts)
    if (result.canceled || !result.filePath) return null
    return result.filePath
  }
}
