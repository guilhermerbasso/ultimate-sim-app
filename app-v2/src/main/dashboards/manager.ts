import { createHash, randomUUID } from 'node:crypto'
import { BrowserWindow, dialog, screen, shell, type Display, type Rectangle } from 'electron'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  Dashboard,
  DashboardDisplayInfo,
  DashboardOpenOptions,
  DashboardOpenState,
  DashboardPlaylist,
  DashboardPlaylistItem,
  DashboardStorageIssue,
  DashboardSummary
} from '../../shared/dashboards'
import {
  BUILTIN_PRESETS,
  dashboardPlaylistValidationError,
  dashboardStorageValidationResult,
  summarizeDashboard
} from '../../shared/dashboards'
import type { ModuleContext } from '../module-context'
import { exportSimhubDash, importSimhubDash, type ImportScreenSummary } from './simhubdash'
import { applyDashboardQuery, buildDashboardQuery } from '../../shared/kiosk'
import { isTouchPanelPlaylistItem } from '../../shared/touch-panel'
import { compareCreatedAtEntries } from '../../shared/catalog-order'
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
const QUARANTINE_DIR = '.dashboard-quarantine'
const CYCLE_DEBOUNCE_MS = 350

interface SimhubImportOptions {
  screenIndex?: number
  inspectOnly?: boolean
  importAll?: boolean
}

interface SimhubImportResponse {
  summary?: DashboardSummary
  summaries?: DashboardSummary[]
  notes: string[]
  screens?: ImportScreenSummary[]
  selectedScreenIndex?: number
  filePath?: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function validatedDashboard(value: unknown, context: string): Dashboard {
  const result = dashboardStorageValidationResult(value)
  if (result.status === 'quarantine') throw new Error(`${context}: ${result.error}`)
  return result.dashboard
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
  private readonly windows = new Map<string, OpenWindowMeta>()
  private dashboards = new Map<string, Dashboard>()
  private storageIssues: DashboardStorageIssue[] = []
  private loaded = false
  private loadPromise: Promise<void> | null = null
  private isDisposing = false
  private playlist: DashboardPlaylist = { items: [], updatedAt: 0 }
  private lastCycleAt = 0
  private currentPlaylistIndex = -1
  private cycleInFlight = false
  private activateChain: Promise<void> = Promise.resolve()
  private readonly windowOpenChains = new Map<string, Promise<void>>()
  private screenListenersRegistered = false
  private readonly onDisplaysChanged = (): void => {
    if (this.isDisposing) return
    this.reconcileWindowDisplays()
    this.broadcastDisplayState()
  }

  constructor(private readonly ctx: ModuleContext) {
    this.storeDir = join(ctx.app.getPath('userData'), SUBDIR)
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

  private async loadInternal(): Promise<void> {
    if (this.loaded) return
    await mkdir(this.storeDir, { recursive: true })
    await mkdir(join(this.storeDir, QUARANTINE_DIR), { recursive: true })
    const files = (await readdir(this.storeDir)).sort((a, b) => a.localeCompare(b))
    const dashboards = new Map<string, Dashboard>()
    this.storageIssues = []
    for (const file of files) {
      if (!file.toLowerCase().endsWith('.json') || file === PLAYLIST_FILE) continue
      const path = join(this.storeDir, file)
      const raw = await readFile(path, 'utf8')
      let parsed: unknown
      try {
        parsed = JSON.parse(raw) as unknown
      } catch (error) {
        await this.quarantineFile(file, `Malformed JSON: ${errorMessage(error)}`)
        continue
      }
      const result = dashboardStorageValidationResult(parsed)
      if (result.status === 'quarantine') {
        await this.quarantineFile(file, result.error)
        continue
      }
      if (dashboards.has(result.dashboard.id)) {
        await this.quarantineFile(file, `Duplicate dashboard id "${result.dashboard.id}".`)
        continue
      }
      dashboards.set(result.dashboard.id, result.dashboard)
      if (result.status === 'migrated') {
        logger.info('dashboards', 'dashboard loaded with in-memory storage migrations', {
          file,
          id: result.dashboard.id,
          migrations: result.migrations.map((migration) => migration.code)
        })
      }
    }
    if (dashboards.size === 0) {
      // Sementeia com presets na primeira execução
      for (const preset of BUILTIN_PRESETS) {
        const dash = validatedDashboard(preset.build(), `Builtin preset "${preset.id}" is invalid`)
        dashboards.set(dash.id, dash)
        await this.persist(dash)
      }
    }
    this.dashboards = dashboards
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
      .map((dash) => summarizeDashboard(dash))
  }

  getDashboard(id: string): Dashboard | null {
    return this.dashboards.get(id) ?? null
  }

  listStorageIssues(): DashboardStorageIssue[] {
    return this.storageIssues.map((issue) => ({ ...issue }))
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

  async setPlaylist(playlist: DashboardPlaylist): Promise<DashboardPlaylist> {
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
    this.playlist = { items, updatedAt: Date.now() }
    this.currentPlaylistIndex = -1
    await this.persistPlaylist()
    this.ctx.broadcast('app:dash:playlist', this.getPlaylist())
    return this.getPlaylist()
  }

  async cycle(direction: 'next' | 'prev' = 'next'): Promise<DashboardOpenState | null> {
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
    const run = this.activateChain.then(() => this.activateInternal(id))
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

  async save(dash: Dashboard): Promise<DashboardSummary> {
    const canonical = validatedDashboard(dash, 'Invalid dashboard')
    canonical.updatedAt = Date.now()
    if (!canonical.createdAt) canonical.createdAt = canonical.updatedAt
    this.dashboards.set(canonical.id, canonical)
    await this.persist(canonical)
    this.ctx.broadcast('app:dash:list', this.list())
    this.ctx.broadcast('app:dash:updated', canonical)
    return summarizeDashboard(canonical)
  }

  async delete(id: string): Promise<DashboardSummary[]> {
    if (this.windows.has(id)) await this.closeWindow(id)
    const existed = this.dashboards.delete(id)
    if (existed) {
      try {
        await unlink(join(this.storeDir, `${this.fileNameOf(id)}.json`))
      } catch (error) {
        if (!isMissingFileError(error)) throw error
      }
    }
    const list = this.list()
    this.ctx.broadcast('app:dash:list', list)
    return list
  }

  async setHidden(id: string, hidden: boolean): Promise<DashboardSummary[]> {
    const dash = this.dashboards.get(id)
    if (!dash) throw new Error(`Dashboard not found: ${id}`)
    dash.hidden = Boolean(hidden)
    dash.updatedAt = Date.now()
    this.dashboards.set(id, dash)
    await this.persist(dash)
    const list = this.list()
    this.ctx.broadcast('app:dash:list', list)
    this.ctx.broadcast('app:dash:updated', dash)
    return list
  }

  async createFromPreset(presetId: string): Promise<DashboardSummary> {
    const preset = BUILTIN_PRESETS.find((p) => p.id === presetId)
    if (!preset) throw new Error(`Preset unknown: ${presetId}`)
    const dash = preset.build()
    return this.save(dash)
  }

  // Built-in presets are seeded to disk only on the very first run. On existing
  // installs, presets shipped in later versions are never materialized, so a
  // "switch dashboard" expression targeting one fails with "não found".
  // Resolve those lazily: when a requested id matches a known preset id, build +
  // persist it on demand (under the stable preset id) so it becomes openable.
  private async materializeBuiltinPreset(id: string): Promise<Dashboard | null> {
    const preset = BUILTIN_PRESETS.find((p) => p.id === id)
    if (!preset) return null
    const built = validatedDashboard(preset.build(), `Builtin preset "${id}" is invalid`)
    // Force the stable preset id so the dashboard is addressable by it.
    const dash: Dashboard = { ...built, id }
    this.dashboards.set(id, dash)
    try {
      await this.persist(dash)
    } catch (error) {
      logger.warn('dashboards', 'failed to persist lazily materialized preset', {
        id,
        error: errorMessage(error)
      })
    }
    this.ctx.broadcast('app:dash:list', this.list())
    return dash
  }

  async importSimhub(filePath?: string, options: SimhubImportOptions = {}): Promise<SimhubImportResponse> {
    const target = filePath ?? (await this.pickOpenPath())
    if (!target) throw new Error('Import canceled.')
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
        const imported = validatedDashboard(result.dashboard, `Imported dashboard "${screen.name}" is invalid`)
        summaries.push(await this.save(imported))
        for (const note of result.notes) if (!allNotes.includes(note)) allNotes.push(note)
      }
      return { summaries, notes: allNotes, screens: first.screens, selectedScreenIndex: first.selectedScreenIndex, filePath: target }
    }
    const imported = validatedDashboard(first.dashboard, 'Imported dashboard is invalid')
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
    const target = outPath ?? (await this.pickSavePath(dash.name))
    if (!target) throw new Error('Export canceled.')
    await exportSimhubDash(dash, target)
    return { path: target }
  }

  openWindow(id: string, options: DashboardOpenOptions = {}): Promise<DashboardOpenState> {
    const previous = this.windowOpenChains.get(id) ?? Promise.resolve()
    const opened = previous.then(() => this.openWindowInternal(id, options))
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

  private async openWindowInternal(id: string, options: DashboardOpenOptions): Promise<DashboardOpenState> {
    if (this.isDisposing) throw new Error('Dashboard manager is shutting down.')
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
    }
    if (this.isDisposing) {
      if (!win.isDestroyed()) win.close()
      throw new Error('Dashboard manager shut down while the renderer was loading.')
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

  async closeWindow(id: string): Promise<DashboardOpenState[]> {
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

  private async persist(dash: Dashboard): Promise<void> {
    const path = join(this.storeDir, `${this.fileNameOf(dash.id)}.json`)
    await writeFile(path, JSON.stringify(dash, null, 2), 'utf8')
  }

  private async quarantineFile(file: string, error: string): Promise<void> {
    const nameHash = createHash('sha256').update(file, 'utf8').digest('hex').slice(0, 16)
    const quarantinedFile = `q.${nameHash}.${randomUUID()}.json`
    await rename(join(this.storeDir, file), join(this.storeDir, QUARANTINE_DIR, quarantinedFile))
    const issue: DashboardStorageIssue = { file, quarantinedFile, error }
    this.storageIssues.push(issue)
    logger.warn('dashboards', 'quarantined invalid dashboard storage file', issue)
  }

  private async loadPlaylist(): Promise<void> {
    const path = join(this.storeDir, PLAYLIST_FILE)
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch (error) {
      if (!isMissingFileError(error)) throw error
      this.playlist = { items: [], updatedAt: 0 }
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch (error) {
      await this.quarantineFile(PLAYLIST_FILE, `Malformed JSON: ${errorMessage(error)}`)
      this.playlist = { items: [], updatedAt: 0 }
      return
    }
    const validationError = dashboardPlaylistValidationError(parsed)
    if (validationError) {
      await this.quarantineFile(PLAYLIST_FILE, validationError)
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

  private async persistPlaylist(): Promise<void> {
    await writeFile(join(this.storeDir, PLAYLIST_FILE), JSON.stringify(this.playlist, null, 2), 'utf8')
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
