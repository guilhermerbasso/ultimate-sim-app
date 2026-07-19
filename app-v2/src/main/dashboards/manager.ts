import { createHash, randomUUID } from 'node:crypto'
import { BrowserWindow, dialog, screen, shell, type Display, type Rectangle } from 'electron'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  Dashboard,
  DashboardDisplayInfo,
  DashboardIdentityCatalogEntry,
  DashboardOpenOptions,
  DashboardOpenState,
  DashboardPlaylist,
  DashboardPlaylistItem,
  DashboardPreset,
  DashboardStorageIssue,
  DashboardSummary
} from '../../shared/dashboards'
import {
  BUILTIN_PRESETS,
  dashboardPlaylistValidationError,
  dashboardStorageValidationResult,
  getDashboardIdentityCatalog,
  summarizeDashboard
} from '../../shared/dashboards'
import type { ModuleContext } from '../module-context'
import { exportSimhubDash, importSimhubDash, type ImportScreenSummary } from './simhubdash'
import { applyDashboardQuery, buildDashboardQuery } from '../../shared/kiosk'
import { isTouchPanelPlaylistItem } from '../../shared/touch-panel'
import { compareCreatedAtEntries } from '../../shared/catalog-order'
import { getTouchPanelManager, type TouchPanelManager } from '../touchpanel/manager'
import { logger } from '../modules/logger'
import {
  THIRD_PARTY_CATALOG_OPEN_CHANNEL,
  normalizeThirdPartyImportMetadata,
  resolveThirdPartyCatalogActionUrl,
  thirdPartyDistributionRestrictionReason,
  type DashboardThirdPartyImportInput
} from '../../shared/third-party-dashboard-catalog'


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
const QUARANTINE_DIR = '.dashboard-quarantine'
const MIGRATION_DIR = '.dashboard-migrations'
const METADATA_DIR = '.dashboard-metadata'
const ORIGIN_FILE = 'dashboard-origins.json'
const CYCLE_DEBOUNCE_MS = 350

const BUILTIN_FINGERPRINT_OMITTED_KEYS = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'storageEpoch',
  'storageRevision',
  'hidden'
])

function canonicalBuiltinValue(value: unknown, parentKey = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalBuiltinValue(item))
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (parentKey === 'elements') {
    return Object.values(record)
      .map((item) => canonicalBuiltinValue(item))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  }
  const canonical: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort((a, b) => a.localeCompare(b))) {
    if (BUILTIN_FINGERPRINT_OMITTED_KEYS.has(key)) continue
    canonical[key] = canonicalBuiltinValue(record[key], key)
  }
  return canonical
}

export function dashboardBuiltinFingerprint(dashboard: Dashboard): string {
  return JSON.stringify(canonicalBuiltinValue(dashboard))
}

function dashboardBuiltinIdentity(dashboard: Dashboard): string {
  return `${dashboard.name.trim()}\u0000${dashboard.width}\u0000${dashboard.height}`
}

export function inferBuiltInDashboardIds(
  dashboards: readonly Dashboard[],
  presets: readonly DashboardPreset[] = BUILTIN_PRESETS
): Set<string> {
  const presetFingerprints = new Set<string>()
  const presetIdentities = new Set<string>()
  for (const preset of presets) {
    try {
      const built = preset.build()
      presetFingerprints.add(dashboardBuiltinFingerprint(built))
      presetIdentities.add(dashboardBuiltinIdentity(built))
    } catch {
      // A broken preset is validated elsewhere; it cannot classify stored data.
    }
  }
  const candidates = dashboards.map((dashboard) => ({
    dashboard,
    fingerprint: dashboardBuiltinFingerprint(dashboard),
    identity: dashboardBuiltinIdentity(dashboard)
  }))
  const identitiesWithExactCandidates = new Set(
    candidates
      .filter(({ fingerprint }) => presetFingerprints.has(fingerprint))
      .map(({ identity }) => identity)
  )
  const matches = new Map<string, Dashboard[]>()
  for (const { dashboard, fingerprint, identity } of candidates) {
    const matchKey = presetFingerprints.has(fingerprint)
      ? `fingerprint:${fingerprint}`
      : !identitiesWithExactCandidates.has(identity) &&
          !dashboard.thirdParty &&
          !dashboard.previewPng &&
          presetIdentities.has(identity)
        ? `identity:${identity}`
        : null
    if (!matchKey) continue
    const group = matches.get(matchKey) ?? []
    group.push(dashboard)
    matches.set(matchKey, group)
  }
  const builtInIds = new Set<string>()
  for (const group of matches.values()) {
    const oldest = [...group].sort((left, right) =>
      (left.createdAt ?? Number.MAX_SAFE_INTEGER) - (right.createdAt ?? Number.MAX_SAFE_INTEGER) ||
      left.id.localeCompare(right.id)
    )[0]
    if (oldest) builtInIds.add(oldest.id)
  }
  return builtInIds
}

interface SimhubImportOptions {
  screenIndex?: number
  inspectOnly?: boolean
  importAll?: boolean
  thirdParty?: DashboardThirdPartyImportInput
}

interface SimhubImportResponse {
  summary?: DashboardSummary
  summaries?: DashboardSummary[]
  notes: string[]
  screens?: ImportScreenSummary[]
  selectedScreenIndex?: number
  filePath?: string
}

interface DashboardFileCandidate {
  file: string
  dashboard: Dashboard
  hash: string
  migrated: boolean
}

export interface DashboardStorageIo {
  readFile(path: string): Promise<Buffer>
  rename(from: string, to: string): Promise<void>
}

function dashboardCandidateTimestamp(candidate: DashboardFileCandidate): number {
  return candidate.dashboard.updatedAt ?? candidate.dashboard.createdAt ?? Number.NEGATIVE_INFINITY
}

function dashboardCandidateVersion(
  candidate: DashboardFileCandidate
): { epoch: string; revision: string } | null {
  const { storageEpoch: epoch, storageRevision: revision } = candidate.dashboard
  return typeof epoch === 'string' && epoch && typeof revision === 'string' && revision
    ? { epoch, revision }
    : null
}

function selectDashboardFileCandidate(
  candidates: readonly DashboardFileCandidate[],
  canonicalFile: string
): DashboardFileCandidate | null {
  if (new Set(candidates.map((candidate) => candidate.hash)).size === 1) {
    const canonical = candidates.find((candidate) => candidate.file.toLowerCase() === canonicalFile.toLowerCase())
    return canonical ?? [...candidates].sort((a, b) => a.file.localeCompare(b.file))[0]
  }

  const versioned = candidates
    .map((candidate) => ({ candidate, version: dashboardCandidateVersion(candidate) }))
    .filter((entry): entry is { candidate: DashboardFileCandidate; version: { epoch: string; revision: string } } =>
      entry.version !== null)
  if (versioned.length > 0) {
    if (new Set(versioned.map((entry) => entry.version.epoch)).size !== 1) return null
    const byRevision = new Map<string, DashboardFileCandidate[]>()
    for (const entry of versioned) {
      const revisionCandidates = byRevision.get(entry.version.revision) ?? []
      revisionCandidates.push(entry.candidate)
      byRevision.set(entry.version.revision, revisionCandidates)
    }
    for (const revisionCandidates of byRevision.values()) {
      if (new Set(revisionCandidates.map((candidate) => candidate.hash)).size > 1) return null
    }
    const representatives = [...byRevision.values()].map((revisionCandidates) =>
      revisionCandidates.find((candidate) => candidate.file.toLowerCase() === canonicalFile.toLowerCase()) ??
      [...revisionCandidates].sort((a, b) => a.file.localeCompare(b.file))[0]
    )
    if (representatives.length === 1) return representatives[0]
    const newestTimestamp = Math.max(...representatives.map(dashboardCandidateTimestamp))
    const freshest = representatives.filter((candidate) => dashboardCandidateTimestamp(candidate) === newestTimestamp)
    return freshest.length === 1 ? freshest[0] : null
  }

  const newestTimestamp = Math.max(...candidates.map(dashboardCandidateTimestamp))
  const freshest = candidates.filter((candidate) => dashboardCandidateTimestamp(candidate) === newestTimestamp)
  if (freshest.length === 1) return freshest[0]

  const canonical = freshest.filter((candidate) => candidate.file.toLowerCase() === canonicalFile.toLowerCase())
  return canonical.length === 1 ? canonical[0] : null
}

function exactFileHash(raw: Uint8Array): string {
  return createHash('sha256').update(raw).digest('hex')
}

function nextDashboardRevision(previous: number | undefined, now = Date.now()): number {
  if (previous === undefined) return now
  if (!Number.isSafeInteger(previous) || previous >= Number.MAX_SAFE_INTEGER) {
    throw new Error(`Dashboard revision cannot advance beyond ${String(previous)}.`)
  }
  return Math.max(now, previous + 1)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function validatedDashboard(
  value: unknown,
  context: string,
  identityCatalog: readonly DashboardIdentityCatalogEntry[]
): Dashboard {
  const result = dashboardStorageValidationResult(value, { identityCatalog })
  if (result.status === 'quarantine') throw new Error(`${context}: ${result.error}`)
  return result.dashboard
}

export function applyThirdPartyImportMetadata(
  dashboard: Dashboard,
  input: DashboardThirdPartyImportInput | undefined,
  recordedAt = Date.now()
): Dashboard {
  const thirdParty = normalizeThirdPartyImportMetadata(input, recordedAt)
  return thirdParty ? { ...dashboard, thirdParty } : dashboard
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
  rendererHealthy: boolean
}

interface DashboardWindowLoadTarget {
  isDestroyed(): boolean
  once(event: 'closed', listener: () => void): unknown
  off(event: 'closed', listener: () => void): unknown
  webContents: {
    isDestroyed(): boolean
    once(event: 'did-finish-load', listener: () => void): unknown
    on(event: 'did-fail-load' | 'render-process-gone', listener: (...args: unknown[]) => void): unknown
    off(event: 'did-finish-load', listener: () => void): unknown
    off(event: 'did-fail-load' | 'render-process-gone', listener: (...args: unknown[]) => void): unknown
  }
}

export function waitForDashboardWindowLoad(
  window: BrowserWindow,
  load: () => Promise<void>
): Promise<void> {
  const target = window as unknown as DashboardWindowLoadTarget
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      target.webContents.off('did-finish-load', onFinished)
      target.webContents.off('did-fail-load', onFailed)
      target.webContents.off('render-process-gone', onRendererGone)
      target.off('closed', onClosed)
    }
    const succeed = (): void => {
      if (settled) return
      if (target.isDestroyed() || target.webContents.isDestroyed()) {
        fail(new Error('Dashboard window was destroyed before its renderer became ready.'))
        return
      }
      settled = true
      cleanup()
      resolve()
    }
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
    const onFinished = (): void => succeed()
    const onFailed = (...args: unknown[]): void => {
      if (args[4] === false) return
      const code = typeof args[1] === 'number' ? args[1] : 0
      const description = typeof args[2] === 'string' ? args[2] : 'unknown load failure'
      fail(new Error(`Dashboard renderer failed to load (${code}): ${description}`))
    }
    const onRendererGone = (...args: unknown[]): void => {
      const details = args[1]
      const reason = details && typeof details === 'object' && 'reason' in details
        ? String(details.reason)
        : 'unknown reason'
      fail(new Error(`Dashboard renderer exited before load completed: ${reason}`))
    }
    const onClosed = (): void => fail(new Error('Dashboard window closed before its renderer became ready.'))

    target.webContents.once('did-finish-load', onFinished)
    target.webContents.on('did-fail-load', onFailed)
    target.webContents.on('render-process-gone', onRendererGone)
    target.once('closed', onClosed)
    void Promise.resolve().then(load).then(succeed, fail)
  })
}

export class DashboardManager {
  private readonly storeDir: string
  private readonly storageIo: DashboardStorageIo
  private readonly windows = new Map<string, OpenWindowMeta>()
  private dashboards = new Map<string, Dashboard>()
  private dashboardSourceFiles = new Map<string, string>()
  private builtInDashboardIds = new Set<string>()
  private storageIssues: DashboardStorageIssue[] = []
  private readonly identityCatalog = getDashboardIdentityCatalog()
  private loaded = false
  private loadPromise: Promise<void> | null = null
  private isDisposing = false
  private playlist: DashboardPlaylist = { items: [], updatedAt: 0 }
  private lastCycleAt = 0
  private currentPlaylistIndex = -1
  private cycleInFlight = false
  private activateChain: Promise<void> = Promise.resolve()
  private mutationChain: Promise<void> = Promise.resolve()
  private readonly windowOpenChains = new Map<string, Promise<void>>()
  private readonly pendingWindows = new Map<string, BrowserWindow>()
  private readonly windowIntentGenerations = new Map<string, number>()
  private screenListenersRegistered = false
  private readonly onDisplaysChanged = (): void => {
    if (this.isDisposing) return
    this.reconcileWindowDisplays()
    this.broadcastDisplayState()
  }

  constructor(
    private readonly ctx: ModuleContext,
    storageIo: Partial<DashboardStorageIo> = {}
  ) {
    this.storeDir = join(ctx.app.getPath('userData'), SUBDIR)
    this.storageIo = {
      readFile: storageIo.readFile ?? ((path) => readFile(path)),
      rename: storageIo.rename ?? ((from, to) => rename(from, to))
    }
  }

  private originFilePath(): string {
    return join(this.storeDir, METADATA_DIR, ORIGIN_FILE)
  }

  private async loadBuiltInOrigins(): Promise<boolean> {
    try {
      const parsed = JSON.parse(await readFile(this.originFilePath(), 'utf8')) as {
        schemaVersion?: unknown
        builtInIds?: unknown
      }
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.builtInIds)) {
        this.builtInDashboardIds = new Set()
        return false
      }
      this.builtInDashboardIds = new Set(
        parsed.builtInIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      )
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('dashboards', 'failed to load dashboard origin registry', {
          error: errorMessage(error)
        })
      }
      this.builtInDashboardIds = new Set()
      return false
    }
  }

  private async persistBuiltInOrigins(): Promise<void> {
    const path = this.originFilePath()
    const temp = `${path}.tmp`
    await mkdir(join(this.storeDir, METADATA_DIR), { recursive: true })
    await writeFile(temp, JSON.stringify({
      schemaVersion: 1,
      builtInIds: [...this.builtInDashboardIds].sort((a, b) => a.localeCompare(b))
    }, null, 2), 'utf8')
    await rename(temp, path)
  }

  load(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadInternal().catch((error: unknown) => {
        this.loadPromise = null
        throw error
      })
    }
    return this.loadPromise
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    if (this.isDisposing) return Promise.reject(new Error('Dashboard manager is shutting down.'))
    const run = this.mutationChain.then(async () => {
      await this.load()
      return operation()
    })
    this.mutationChain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private currentWindowIntent(id: string): number {
    return this.windowIntentGenerations.get(id) ?? 0
  }

  private invalidateWindowIntents(id: string): void {
    this.windowIntentGenerations.set(id, this.currentWindowIntent(id) + 1)
    const pending = this.pendingWindows.get(id)
    if (pending && !pending.isDestroyed()) pending.close()
  }

  private async loadInternal(): Promise<void> {
    if (this.loaded) return
    await mkdir(this.storeDir, { recursive: true })
    await mkdir(join(this.storeDir, QUARANTINE_DIR), { recursive: true })
    await mkdir(join(this.storeDir, MIGRATION_DIR), { recursive: true })
    await mkdir(join(this.storeDir, METADATA_DIR), { recursive: true })
    const originRegistryLoaded = await this.loadBuiltInOrigins()
    const loadedOriginIds = [...this.builtInDashboardIds].sort((a, b) => a.localeCompare(b))
    const files = (await readdir(this.storeDir)).sort((a, b) => a.localeCompare(b))
    const dashboardCandidateFiles = files.filter((file) =>
      file.toLowerCase().endsWith('.json') && file !== PLAYLIST_FILE)
    const dashboards = new Map<string, Dashboard>()
    const sourceFiles = new Map<string, string>()
    const candidatesById = new Map<string, DashboardFileCandidate[]>()
    this.storageIssues = []
    for (const file of files) {
      if (!file.toLowerCase().endsWith('.json') || file === PLAYLIST_FILE) continue
      const path = join(this.storeDir, file)
      let raw: Buffer
      try {
        raw = await this.storageIo.readFile(path)
      } catch (error) {
        this.recordStorageIssue({
          file,
          path,
          ...(errorCode(error) ? { code: errorCode(error) } : {}),
          error: `Could not read dashboard candidate: ${errorMessage(error)}`
        })
        continue
      }
      const hash = exactFileHash(raw)
      let parsed: unknown
      try {
        parsed = JSON.parse(raw.toString('utf8')) as unknown
      } catch (error) {
        await this.quarantineFile(file, `Malformed JSON: ${errorMessage(error)}`, hash)
        continue
      }
      const result = dashboardStorageValidationResult(parsed, { identityCatalog: this.identityCatalog })
      if (result.status === 'quarantine') {
        await this.quarantineFile(file, result.error, hash)
        continue
      }
      const candidates = candidatesById.get(result.dashboard.id) ?? []
      candidates.push({
        file,
        dashboard: result.dashboard,
        hash,
        migrated: result.status === 'migrated'
      })
      candidatesById.set(result.dashboard.id, candidates)
      if (result.status === 'migrated') {
        logger.info('dashboards', 'dashboard loaded with in-memory storage migrations', {
          file,
          id: result.dashboard.id,
          migrations: result.migrations.map((migration) => migration.code)
        })
      }
    }
    const selectedCandidates = new Map<string, DashboardFileCandidate>()
    for (const [id, candidates] of candidatesById) {
      if (candidates.length === 1) {
        selectedCandidates.set(id, candidates[0])
        continue
      }
      const canonicalFile = `${this.fileNameOf(id)}.json`
      const winner = selectDashboardFileCandidate(candidates, canonicalFile)
      if (!winner) {
        const files = candidates.map((candidate) => candidate.file).join(', ')
        for (const candidate of candidates) {
          await this.quarantineFile(
            candidate.file,
            `Ambiguous duplicate dashboard id "${id}" across files: ${files}.`,
            candidate.hash
          )
        }
        continue
      }
      for (const candidate of candidates) {
        if (candidate === winner) continue
        await this.quarantineFile(
          candidate.file,
          `Duplicate dashboard id "${id}" superseded by authoritative file "${winner.file}".`,
          candidate.hash
        )
      }
      selectedCandidates.set(id, winner)
    }
    const canonicalOwners = new Map<string, Array<{ id: string; candidate: DashboardFileCandidate }>>()
    for (const [id, candidate] of selectedCandidates) {
      const canonicalFile = `${this.fileNameOf(id)}.json`
      const owners = canonicalOwners.get(canonicalFile.toLowerCase()) ?? []
      owners.push({ id, candidate })
      canonicalOwners.set(canonicalFile.toLowerCase(), owners)
    }
    for (const owners of canonicalOwners.values()) {
      if (owners.length < 2) continue
      const ids = owners.map((owner) => owner.id).join(', ')
      for (const owner of owners) {
        await this.quarantineFile(
          owner.candidate.file,
          `Dashboard ids collide on the same canonical filename: ${ids}.`,
          owner.candidate.hash
        )
        selectedCandidates.delete(owner.id)
      }
    }
    for (const [id, candidate] of selectedCandidates) {
      const canonicalFile = `${this.fileNameOf(id)}.json`
      try {
        const dashboard = candidate.migrated
          ? {
              ...candidate.dashboard,
              updatedAt: nextDashboardRevision(
                candidate.dashboard.updatedAt ?? candidate.dashboard.createdAt
              )
            }
          : candidate.dashboard
        await this.canonicalizeDashboardSource(candidate, canonicalFile)
        if (candidate.migrated) {
          await this.persistMigratedDashboard(candidate, canonicalFile, dashboard)
        }
        dashboards.set(id, dashboard)
        sourceFiles.set(id, canonicalFile)
      } catch (error) {
        this.recordStorageIssue({
          file: candidate.file,
          path: join(this.storeDir, canonicalFile),
          ...(errorCode(error) ? { code: errorCode(error) } : {}),
          error: `Could not accept dashboard candidate "${id}": ${errorMessage(error)}`
        })
        continue
      }
    }
    if (dashboards.size === 0) {
      // Sementeia com presets na primeira execução ou quando todos os candidatos foram quarentenados
      this.builtInDashboardIds = new Set()
      for (const preset of BUILTIN_PRESETS) {
        const built = validatedDashboard(
          preset.build(),
          `Builtin preset "${preset.id}" is invalid`,
          this.identityCatalog
        )
        const dash = {
          ...built,
          updatedAt: nextDashboardRevision(undefined)
        }
        dashboards.set(dash.id, dash)
        this.builtInDashboardIds.add(dash.id)
        await this.persist(dash)
        sourceFiles.set(dash.id, `${this.fileNameOf(dash.id)}.json`)
      }
    } else if (!originRegistryLoaded) {
      this.builtInDashboardIds = inferBuiltInDashboardIds([...dashboards.values()])
    } else {
      this.builtInDashboardIds = new Set(
        [...this.builtInDashboardIds].filter((id) => dashboards.has(id))
      )
    }
    const nextOriginIds = [...this.builtInDashboardIds].sort((a, b) => a.localeCompare(b))
    if (!originRegistryLoaded || loadedOriginIds.join('\n') !== nextOriginIds.join('\n')) {
      await this.persistBuiltInOrigins()
    }
    this.dashboards = dashboards
    this.dashboardSourceFiles = sourceFiles
    await this.loadPlaylist()
    this.loaded = true
    if (!this.isDisposing) this.registerScreenListeners()
    this.ctx.broadcast('app:dash:storageIssues', this.listStorageIssues())
  }

  registerIpc(): void {
    const ipc = this.ctx.ipcMain
    ipc.handle('app:dash:list', async () => {
      await this.load()
      return this.list()
    })
    ipc.handle('app:dash:storageIssues', async () => {
      await this.load()
      return this.listStorageIssues()
    })
    ipc.handle('app:dash:get', async (_event, id: string) => {
      await this.load()
      return this.dashboards.get(id) ?? null
    })
    ipc.handle('app:dash:save', async (_event, dash: Dashboard) => {
      await this.load()
      return this.save(dash)
    })
    ipc.handle('app:dash:delete', async (_event, id: string) => {
      await this.load()
      return this.delete(id)
    })
    ipc.handle('app:dash:setHidden', async (_event, id: string, hidden: boolean) => {
      await this.load()
      return this.setHidden(id, hidden)
    })
    ipc.handle('app:dash:open', async (_event, id: string, options?: DashboardOpenOptions) => {
      await this.load()
      return this.openWindow(id, options)
    })
    ipc.handle('app:dash:activate', async (_event, id: string) => {
      await this.load()
      return this.activate(id)
    })
    ipc.handle('app:dash:close', async (_event, id: string) => {
      await this.load()
      return this.closeWindow(id)
    })
    ipc.handle('app:dash:listOpen', async () => {
      await this.load()
      return this.listOpen()
    })
    ipc.handle('app:dash:listDisplays', async () => {
      await this.load()
      return this.listDisplays()
    })
    ipc.handle('app:dash:importSimhub', async (_event, filePath?: string, options?: SimhubImportOptions) => {
      await this.load()
      return this.importSimhub(filePath, options)
    })
    ipc.handle('app:dash:exportSimhub', async (_event, id: string, outPath?: string) => {
      await this.load()
      return this.exportSimhub(id, outPath)
    })
    ipc.handle(THIRD_PARTY_CATALOG_OPEN_CHANNEL, async (_event, entryId: unknown, actionId: unknown) => {
      return this.openThirdPartyCatalogAction(entryId, actionId)
    })
    ipc.handle('app:dash:createPreset', async (_event, presetId: string) => {
      await this.load()
      return this.createFromPreset(presetId)
    })
    ipc.handle('app:dash:playlist:get', async () => {
      await this.load()
      return this.getPlaylist()
    })
    ipc.handle('app:dash:playlist:set', async (_event, playlist: DashboardPlaylist) => {
      await this.load()
      return this.setPlaylist(playlist)
    })
    ipc.handle('app:dash:cycle', async (_event, direction: unknown = 'next') => {
      await this.load()
      return this.cycle(direction === 'prev' ? 'prev' : 'next')
    })
  }

  list(): DashboardSummary[] {
    return [...this.dashboards.values()]
      .sort(compareCreatedAtEntries)
      .map((dash) => ({
        ...summarizeDashboard(dash),
        builtIn: this.builtInDashboardIds.has(dash.id)
      }))
  }

  getDashboard(id: string): Dashboard | null {
    return this.dashboards.get(id) ?? null
  }

  listStorageIssues(): DashboardStorageIssue[] {
    return this.storageIssues.map((issue) => ({ ...issue }))
  }

  private recordStorageIssue(issue: DashboardStorageIssue): void {
    this.storageIssues.push(issue)
    logger.warn('dashboards', 'dashboard storage issue', issue)
  }

  listOpen(): DashboardOpenState[] {
    const out: DashboardOpenState[] = []
    for (const [id, meta] of this.windows) {
      if (!this.isWindowHealthy(meta)) continue
      out.push({ id, displayId: meta.displayId, fullscreen: meta.fullscreen })
    }
    return out
  }

  private isWindowHealthy(meta: OpenWindowMeta): boolean {
    return meta.rendererHealthy &&
      !meta.window.isDestroyed() &&
      !meta.window.webContents.isDestroyed()
  }

  private bindRendererHealth(id: string, meta: OpenWindowMeta): void {
    const markUnhealthy = (reason: string): void => {
      if (!meta.rendererHealthy) return
      meta.rendererHealthy = false
      logger.warn('dashboards', 'dashboard renderer became unhealthy', { id, reason })
      const tracked = this.windows.get(id)
      if (tracked?.window !== meta.window) return
      if (!meta.window.isDestroyed()) {
        try {
          meta.window.hide()
        } catch (error) {
          logger.warn('dashboards', 'failed to hide unhealthy dashboard window', {
            id,
            error: errorMessage(error)
          })
        }
      }
      if (!this.isDisposing) this.ctx.broadcast('app:dash:openState', this.listOpen())
    }
    meta.window.webContents.on('render-process-gone', (_event, details) => {
      markUnhealthy(`render process gone: ${details.reason}`)
    })
    meta.window.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
        if (isMainFrame === false) return
        markUnhealthy(`load failed (${errorCode}): ${errorDescription}`)
      }
    )
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
    return {
      items: this.playlist.items.map((item) => ({ ...item })),
      updatedAt: this.playlist.updatedAt
    }
  }

  setPlaylist(playlist: DashboardPlaylist): Promise<DashboardPlaylist> {
    return this.enqueueMutation(() => this.setPlaylistInternal(playlist))
  }

  private async setPlaylistInternal(playlist: DashboardPlaylist): Promise<DashboardPlaylist> {
    const items = Array.isArray(playlist?.items)
      ? playlist.items
          .filter((item): item is DashboardPlaylistItem => Boolean(item && typeof item.dashboardId === 'string' && item.dashboardId))
          .map((item) => ({
            dashboardId: item.dashboardId,
            displayId: typeof item.displayId === 'number' ? item.displayId : undefined,
            fullscreen: typeof item.fullscreen === 'boolean' ? item.fullscreen : undefined,
            // Preserve the touch-panel discriminator so RGB button-box entries
            // survive a playlist save round-trip (additive — dashboards ignore it).
            kind: item.kind === 'touch-panel' ? ('touch-panel' as const) : undefined,
            touchPanelId: typeof item.touchPanelId === 'string' ? item.touchPanelId : undefined
          }))
      : []
    const next = { items, updatedAt: Date.now() }
    await this.persistPlaylist(next)
    this.playlist = next
    this.currentPlaylistIndex = -1
    this.ctx.broadcast('app:dash:playlist', this.getPlaylist())
    return this.getPlaylist()
  }

  async cycle(direction: 'next' | 'prev' = 'next'): Promise<DashboardOpenState | null> {
    await this.load()
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
  activate(id: string): Promise<DashboardOpenState> {
    const run = this.activateChain.then(async () => {
      await this.load()
      return this.activateInternal(id)
    })
    // Keep the queue alive even when an activation rejects.
    this.activateChain = run.then(
      () => undefined,
      () => undefined
    )
    return run
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

  save(dash: Dashboard): Promise<DashboardSummary> {
    return this.enqueueMutation(() => this.saveInternal(dash))
  }

  private async saveInternal(dash: Dashboard): Promise<DashboardSummary> {
    const canonical = validatedDashboard(dash, 'Invalid dashboard', this.identityCatalog)
    const existing = this.dashboards.get(canonical.id)
    const createdAt = existing?.createdAt ?? canonical.createdAt ?? Date.now()
    canonical.createdAt = createdAt
    canonical.updatedAt = nextDashboardRevision(existing?.updatedAt ?? existing?.createdAt)
    await this.persist(canonical)
    this.dashboards.set(canonical.id, canonical)
    if (this.builtInDashboardIds.delete(canonical.id)) await this.persistBuiltInOrigins()
    this.ctx.broadcast('app:dash:list', this.list())
    this.ctx.broadcast('app:dash:updated', canonical)
    return summarizeDashboard(canonical)
  }

  delete(id: string): Promise<DashboardSummary[]> {
    this.invalidateWindowIntents(id)
    return this.enqueueMutation(() => this.deleteInternal(id))
  }

  private async deleteInternal(id: string): Promise<DashboardSummary[]> {
    await this.windowOpenChains.get(id)
    if (this.windows.has(id)) await this.closeWindowInternal(id)
    const existed = this.dashboards.has(id)
    if (existed) await this.removeDashboardSource(id)
    this.dashboards.delete(id)
    if (this.builtInDashboardIds.delete(id)) await this.persistBuiltInOrigins()
    const list = this.list()
    this.ctx.broadcast('app:dash:list', list)
    return list
  }

  setHidden(id: string, hidden: boolean): Promise<DashboardSummary[]> {
    return this.enqueueMutation(() => this.setHiddenInternal(id, hidden))
  }

  private async setHiddenInternal(id: string, hidden: boolean): Promise<DashboardSummary[]> {
    const dash = this.dashboards.get(id)
    if (!dash) throw new Error(`Dashboard not found: ${id}`)
    const next = {
      ...dash,
      hidden: Boolean(hidden),
      updatedAt: nextDashboardRevision(dash.updatedAt ?? dash.createdAt)
    }
    await this.persist(next)
    this.dashboards.set(id, next)
    const list = this.list()
    this.ctx.broadcast('app:dash:list', list)
    this.ctx.broadcast('app:dash:updated', next)
    return list
  }

  createFromPreset(presetId: string): Promise<DashboardSummary> {
    return this.enqueueMutation(async () => {
      const preset = BUILTIN_PRESETS.find((candidate) => candidate.id === presetId)
      if (!preset) throw new Error(`Preset unknown: ${presetId}`)
      return this.saveInternal(preset.build())
    })
  }

  // Built-in presets are seeded to disk only on the very first run. On existing
  // installs, presets shipped in later versions are never materialized, so a
  // "switch dashboard" expression targeting one fails with "não found".
  // Resolve those lazily: when a requested id matches a known preset id, build +
  // persist it on demand (under the stable preset id) so it becomes openable.
  private async materializeBuiltinPreset(id: string): Promise<Dashboard | null> {
    return this.enqueueMutation(async () => {
      const existing = this.dashboards.get(id)
      if (existing) return existing
      const preset = BUILTIN_PRESETS.find((candidate) => candidate.id === id)
      if (!preset) return null
      const built = validatedDashboard(
        preset.build(),
        `Builtin preset "${id}" is invalid`,
        this.identityCatalog
      )
      const dash: Dashboard = {
        ...built,
        id,
        createdAt: built.createdAt ?? Date.now(),
        updatedAt: nextDashboardRevision(undefined)
      }
      await this.persist(dash)
      this.dashboards.set(id, dash)
      this.builtInDashboardIds.add(id)
      await this.persistBuiltInOrigins()
      this.ctx.broadcast('app:dash:list', this.list())
      return dash
    })
  }

  async importSimhub(filePath?: string, options: SimhubImportOptions = {}): Promise<SimhubImportResponse> {
    const target = filePath ?? (await this.pickOpenPath())
    if (!target) throw new Error('Import canceled.')
    const recordedAt = Date.now()
    const first = await importSimhubDash(target, { screenIndex: options.screenIndex })
    if (options.inspectOnly && first.screens.length > 1 && options.screenIndex === undefined) {
      return {
        notes: first.notes,
        screens: first.screens,
        selectedScreenIndex: first.selectedScreenIndex,
        filePath: target
      }
    }
    if (options.importAll && first.screens.length > 1) {
      const summaries: DashboardSummary[] = []
      const allNotes = [...first.notes]
      for (const screen of first.screens) {
        const result = screen.index === first.selectedScreenIndex
          ? first
          : await importSimhubDash(target, { screenIndex: screen.index })
        const imported = validatedDashboard(
          applyThirdPartyImportMetadata(result.dashboard, options.thirdParty, recordedAt),
          `Imported dashboard "${screen.name}" is invalid`,
          this.identityCatalog
        )
        summaries.push(await this.save(imported))
        for (const note of result.notes) if (!allNotes.includes(note)) allNotes.push(note)
      }
      return { summaries, notes: allNotes, screens: first.screens, selectedScreenIndex: first.selectedScreenIndex, filePath: target }
    }
    const imported = validatedDashboard(
      applyThirdPartyImportMetadata(first.dashboard, options.thirdParty, recordedAt),
      'Imported dashboard is invalid',
      this.identityCatalog
    )
    const summary = await this.save(imported)
    return {
      summary,
      notes: first.notes,
      screens: first.screens,
      selectedScreenIndex: first.selectedScreenIndex,
      filePath: target
    }
  }

  async exportSimhub(id: string, outPath?: string): Promise<{ path: string }> {
    const dash = this.dashboards.get(id)
    if (!dash) throw new Error(`Dashboard not found: ${id}`)
    const restriction = thirdPartyDistributionRestrictionReason(dash.thirdParty, 'reExport')
    if (restriction) throw new Error(`Dashboard re-export blocked. ${restriction}`)
    const target = outPath ?? (await this.pickSavePath(dash.name))
    if (!target) throw new Error('Export canceled.')
    await exportSimhubDash(dash, target)
    return { path: target }
  }

  async openThirdPartyCatalogAction(entryId: unknown, actionId: unknown): Promise<{ opened: true }> {
    const url = resolveThirdPartyCatalogActionUrl(entryId, actionId)
    await shell.openExternal(url)
    return { opened: true }
  }

  openWindow(id: string, options: DashboardOpenOptions = {}): Promise<DashboardOpenState> {
    const previous = this.windowOpenChains.get(id) ?? Promise.resolve()
    const intentGeneration = this.currentWindowIntent(id)
    const opened = previous.then(async () => {
      await this.load()
      return this.openWindowInternal(id, options, intentGeneration)
    })
    const tail = opened.then(
      () => undefined,
      () => undefined
    )
    this.windowOpenChains.set(id, tail)
    void tail.then(() => {
      if (this.windowOpenChains.get(id) === tail) this.windowOpenChains.delete(id)
    })
    return opened
  }

  private async openWindowInternal(
    id: string,
    options: DashboardOpenOptions,
    intentGeneration: number
  ): Promise<DashboardOpenState> {
    if (this.isDisposing) throw new Error('Dashboard manager is shutting down.')
    if (this.currentWindowIntent(id) !== intentGeneration) {
      throw new Error(`Dashboard open canceled because a newer intent superseded "${id}".`)
    }
    let dash = this.dashboards.get(id)
    if (!dash) dash = (await this.materializeBuiltinPreset(id)) ?? undefined
    if (!dash) throw new Error(`Dashboard not found: ${id}`)

    const existing = this.windows.get(id)
    if (existing && this.isWindowHealthy(existing)) {
      if (
        (options.displayId === undefined || options.displayId === existing.displayId) &&
        (options.fullscreen === undefined || options.fullscreen === existing.fullscreen) &&
        (options.kiosk ?? false) === existing.kiosk
      ) {
        existing.window.focus()
        return { id, displayId: existing.displayId, fullscreen: existing.fullscreen }
      }
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
      show: false,
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
    const next: OpenWindowMeta = {
      window: win,
      displayId: display.id,
      fullscreen,
      kiosk: options.kiosk ?? false,
      rendererHealthy: true
    }
    this.bindRendererHealth(id, next)
    this.pendingWindows.set(id, win)

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
      const wasTracked = this.windows.get(id)?.window === win
      if (wasTracked) this.windows.delete(id)
      if (wasTracked && !this.isDisposing) {
        this.ctx.broadcast('app:dash:openState', this.listOpen())
      }
    })

    const load = process.env.ELECTRON_RENDERER_URL
      ? (): Promise<void> => {
          const url = applyDashboardQuery(new URL('dashboard.html', process.env.ELECTRON_RENDERER_URL), id, options.kiosk)
          return win.loadURL(url.toString())
        }
      : (): Promise<void> => win.loadFile(
          join(__dirname, '../renderer/dashboard.html'),
          { query: buildDashboardQuery(id, options.kiosk) }
        )

    try {
      await waitForDashboardWindowLoad(win, load)
    } catch (error) {
      if (!win.isDestroyed()) win.close()
      logger.warn('dashboards', 'dashboard replacement window failed before becoming ready', {
        id,
        error: errorMessage(error)
      })
      throw error
    } finally {
      if (this.pendingWindows.get(id) === win) this.pendingWindows.delete(id)
    }
    if (this.isDisposing) {
      if (!win.isDestroyed()) win.close()
      throw new Error('Dashboard manager shut down while the renderer was loading.')
    }
    if (this.currentWindowIntent(id) !== intentGeneration || !this.dashboards.has(id)) {
      if (!win.isDestroyed()) win.close()
      throw new Error(`Dashboard open canceled because a newer intent superseded "${id}" while its renderer was loading.`)
    }
    if (!this.isWindowHealthy(next)) {
      if (!win.isDestroyed()) win.close()
      throw new Error('Dashboard renderer exited before the replacement could be registered.')
    }
    this.windows.set(id, next)
    try {
      win.show()
      win.focus()
      if (!this.isWindowHealthy(next)) {
        throw new Error('Dashboard renderer exited while the replacement window was being shown.')
      }
    } catch (error) {
      if (existing) this.windows.set(id, existing)
      else this.windows.delete(id)
      if (!win.isDestroyed()) win.close()
      if (!this.isDisposing) this.ctx.broadcast('app:dash:openState', this.listOpen())
      throw error
    }
    if (existing && !existing.window.isDestroyed()) {
      try {
        existing.window.close()
      } catch (error) {
        logger.warn('dashboards', 'failed to close replaced dashboard window', {
          id,
          error: errorMessage(error)
        })
      }
    }
    logger.info('dashboards', 'dashboard window opened', { id, name: dash.name, displayId: display.id, fullscreen })
    this.ctx.broadcast('app:dash:openState', this.listOpen())
    return { id, displayId: display.id, fullscreen }
  }

  closeWindow(id: string): Promise<DashboardOpenState[]> {
    this.invalidateWindowIntents(id)
    return this.closeWindowInternal(id)
  }

  private async closeWindowInternal(id: string): Promise<DashboardOpenState[]> {
    await this.windowOpenChains.get(id)
    const meta = this.windows.get(id)
    const hadWindow = Boolean(meta && !meta.window.isDestroyed())
    if (meta && !meta.window.isDestroyed()) {
      meta.window.close()
    }
    this.windows.delete(id)
    logger.info('dashboards', 'dashboard window closed', { id, hadWindow })
    const list = this.listOpen()
    this.ctx.broadcast('app:dash:openState', list)
    return list
  }

  async dispose(): Promise<void> {
    this.isDisposing = true
    this.unregisterScreenListeners()
    const ids = new Set([
      ...this.windows.keys(),
      ...this.pendingWindows.keys(),
      ...this.windowOpenChains.keys()
    ])
    for (const id of ids) this.invalidateWindowIntents(id)
    await Promise.all([...this.windowOpenChains.values()])
    await this.mutationChain
    for (const pending of this.pendingWindows.values()) {
      if (!pending.isDestroyed()) pending.close()
    }
    this.pendingWindows.clear()
    logger.info('dashboards', 'dispose: closing dashboard windows', { count: this.windows.size })
    for (const id of [...this.windows.keys()]) {
      const meta = this.windows.get(id)
      if (meta && !meta.window.isDestroyed()) meta.window.close()
      this.windows.delete(id)
    }
  }

  private fileNameOf(id: string): string {
    return id.replace(/[^A-Za-z0-9._-]/g, '_')
  }

  private async canonicalizeDashboardSource(
    candidate: DashboardFileCandidate,
    canonicalFile: string
  ): Promise<void> {
    if (candidate.file.toLowerCase() === canonicalFile.toLowerCase()) return
    const source = join(this.storeDir, candidate.file)
    const target = join(this.storeDir, canonicalFile)
    let moved = false
    try {
      await this.storageIo.rename(source, target)
      moved = true
      const migrated = await this.storageIo.readFile(target)
      if (exactFileHash(migrated) !== candidate.hash) {
        throw new Error(`Canonical filename migration changed bytes for "${candidate.file}".`)
      }
    } catch (error) {
      if (moved) {
        try {
          await this.storageIo.rename(target, source)
        } catch (rollbackError) {
          try {
            await this.quarantineFile(
              canonicalFile,
              `Canonical filename migration rollback failed for "${candidate.file}": ${errorMessage(rollbackError)}.`
            )
          } catch (quarantineError) {
            throw new Error(
              `Dashboard source migration and recovery failed: ${errorMessage(error)}; ` +
              `rollback: ${errorMessage(rollbackError)}; quarantine: ${errorMessage(quarantineError)}`
            )
          }
        }
      }
      throw error
    }
    logger.info('dashboards', 'canonicalized dashboard source filename', {
      id: candidate.dashboard.id,
      from: candidate.file,
      to: canonicalFile
    })
  }

  private async persistMigratedDashboard(
    candidate: DashboardFileCandidate,
    canonicalFile: string,
    dashboard: Dashboard
  ): Promise<void> {
    const source = join(this.storeDir, canonicalFile)
    const nameHash = createHash('sha256').update(candidate.file, 'utf8').digest('hex').slice(0, 16)
    const archiveFile = `m.${nameHash}.${randomUUID()}.json`
    const archive = join(this.storeDir, MIGRATION_DIR, archiveFile)
    const temp = join(this.storeDir, `.tmp-dashboard-migration-${randomUUID()}.json`)
    let archived = false
    try {
      await this.storageIo.rename(source, archive)
      archived = true
      if (exactFileHash(await this.storageIo.readFile(archive)) !== candidate.hash) {
        throw new Error(`Dashboard migration archive changed bytes for "${candidate.file}".`)
      }
      await writeFile(temp, JSON.stringify(dashboard, null, 2), 'utf8')
      await this.storageIo.rename(temp, source)
      const persisted = dashboardStorageValidationResult(
        JSON.parse((await this.storageIo.readFile(source)).toString('utf8')) as unknown,
        { identityCatalog: this.identityCatalog }
      )
      if (persisted.status !== 'valid' || persisted.dashboard.updatedAt !== dashboard.updatedAt) {
        throw new Error(`Dashboard migration did not persist a canonical revision for "${dashboard.id}".`)
      }
    } catch (error) {
      try {
        await unlink(temp)
      } catch (cleanupError) {
        if (!isMissingFileError(cleanupError)) {
          logger.warn('dashboards', 'failed to remove dashboard migration temp file', {
            file: temp,
            error: errorMessage(cleanupError)
          })
        }
      }
      if (archived) {
        try {
          try {
            await unlink(source)
          } catch (cleanupError) {
            if (!isMissingFileError(cleanupError)) throw cleanupError
          }
          await this.storageIo.rename(archive, source)
        } catch (rollbackError) {
          throw new Error(
            `Dashboard migration failed and rollback could not restore "${candidate.file}": ` +
            `${errorMessage(error)}; ${errorMessage(rollbackError)}`
          )
        }
      }
      throw error
    }
    logger.info('dashboards', 'persisted canonical dashboard storage migration', {
      id: dashboard.id,
      source: canonicalFile,
      archive: `${MIGRATION_DIR}/${archiveFile}`,
      updatedAt: dashboard.updatedAt
    })
  }

  private async persist(dash: Dashboard): Promise<void> {
    const file = `${this.fileNameOf(dash.id)}.json`
    const path = join(this.storeDir, file)
    await writeFile(path, JSON.stringify(dash, null, 2), 'utf8')
    this.dashboardSourceFiles.set(dash.id, file)
  }

  private async removeDashboardSource(id: string): Promise<void> {
    const file = this.dashboardSourceFiles.get(id) ?? `${this.fileNameOf(id)}.json`
    const path = join(this.storeDir, file)
    let raw: Buffer
    try {
      raw = await this.storageIo.readFile(path)
    } catch (error) {
      if (!isMissingFileError(error)) throw error
      this.dashboardSourceFiles.delete(id)
      return
    }
    const hash = exactFileHash(raw)
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.toString('utf8')) as unknown
    } catch (error) {
      await this.quarantineFile(file, `Deleted dashboard source contained malformed JSON: ${errorMessage(error)}`, hash)
      this.dashboardSourceFiles.delete(id)
      return
    }
    const result = dashboardStorageValidationResult(parsed, { identityCatalog: this.identityCatalog })
    if (result.status === 'quarantine' || result.dashboard.id !== id) {
      const reason = result.status === 'quarantine'
        ? result.error
        : `Source ownership changed from "${id}" to "${result.dashboard.id}".`
      await this.quarantineFile(file, `Deleted dashboard source was not safely removable: ${reason}`, hash)
    } else {
      await unlink(path)
    }
    this.dashboardSourceFiles.delete(id)
  }

  private async quarantineFile(file: string, error: string, expectedHash?: string): Promise<boolean> {
    const source = join(this.storeDir, file)
    let sourceHash = expectedHash
    if (!sourceHash) {
      try {
        sourceHash = exactFileHash(await this.storageIo.readFile(source))
      } catch (readError) {
        this.recordStorageIssue({
          file,
          path: source,
          ...(errorCode(readError) ? { code: errorCode(readError) } : {}),
          error: `${error} Quarantine could not read the original bytes: ${errorMessage(readError)}`
        })
        return false
      }
    }
    const nameHash = createHash('sha256').update(file, 'utf8').digest('hex').slice(0, 16)
    const quarantinedFile = `q.${nameHash}.${randomUUID()}.json`
    const target = join(this.storeDir, QUARANTINE_DIR, quarantinedFile)
    try {
      await this.storageIo.rename(source, target)
    } catch (renameError) {
      this.recordStorageIssue({
        file,
        path: source,
        ...(errorCode(renameError) ? { code: errorCode(renameError) } : {}),
        error: `${error} Quarantine rename failed; original bytes remain in place: ${errorMessage(renameError)}`
      })
      return false
    }
    try {
      const quarantinedHash = exactFileHash(await this.storageIo.readFile(target))
      if (quarantinedHash !== sourceHash) throw new Error(`Quarantine changed bytes for "${file}".`)
    } catch (verificationError) {
      try {
        await this.storageIo.rename(target, source)
      } catch (rollbackError) {
        this.recordStorageIssue({
          file,
          path: target,
          quarantinedFile,
          ...(errorCode(rollbackError) ? { code: errorCode(rollbackError) } : {}),
          error: `${error} Quarantine verification and rollback failed; bytes remain at the reported path: ` +
            `${errorMessage(verificationError)}; ${errorMessage(rollbackError)}`
        })
        return false
      }
      this.recordStorageIssue({
        file,
        path: source,
        ...(errorCode(verificationError) ? { code: errorCode(verificationError) } : {}),
        error: `${error} Quarantine verification failed; original bytes were restored: ${errorMessage(verificationError)}`
      })
      return false
    }
    this.recordStorageIssue({
      file,
      path: source,
      code: 'QUARANTINED',
      quarantinedFile,
      error
    })
    return true
  }

  private async loadPlaylist(): Promise<void> {
    const path = join(this.storeDir, PLAYLIST_FILE)
    let raw: Buffer
    try {
      raw = await this.storageIo.readFile(path)
    } catch (error) {
      if (!isMissingFileError(error)) {
        this.recordStorageIssue({
          file: PLAYLIST_FILE,
          path,
          ...(errorCode(error) ? { code: errorCode(error) } : {}),
          error: `Could not read dashboard playlist: ${errorMessage(error)}`
        })
      }
      this.playlist = { items: [], updatedAt: 0 }
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.toString('utf8')) as unknown
    } catch (error) {
      await this.quarantineFile(
        PLAYLIST_FILE,
        `Malformed JSON: ${errorMessage(error)}`,
        exactFileHash(raw)
      )
      this.playlist = { items: [], updatedAt: 0 }
      return
    }
    const validationError = dashboardPlaylistValidationError(parsed)
    if (validationError) {
      await this.quarantineFile(PLAYLIST_FILE, validationError, exactFileHash(raw))
      this.playlist = { items: [], updatedAt: 0 }
      return
    }
    const playlist = parsed as DashboardPlaylist
    this.playlist = {
      items: playlist.items.map((item) => ({ ...item })),
      updatedAt: playlist.updatedAt
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
    this.ctx.broadcast('app:dash:openState', this.listOpen())
    this.ctx.broadcast('app:dash:displaysChanged', this.listDisplays())
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

  private async persistPlaylist(playlist: DashboardPlaylist = this.playlist): Promise<void> {
    await writeFile(join(this.storeDir, PLAYLIST_FILE), JSON.stringify(playlist, null, 2), 'utf8')
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
