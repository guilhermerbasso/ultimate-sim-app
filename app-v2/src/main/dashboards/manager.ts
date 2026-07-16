import { BrowserWindow, dialog, screen, shell, type Display, type Rectangle } from 'electron'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  Dashboard,
  DashboardDisplayInfo,
  DashboardElement,
  DashboardOpenOptions,
  DashboardOpenState,
  DashboardPlaylist,
  DashboardPlaylistItem,
  DashboardSummary
} from '../../shared/dashboards'
import {
  BUILTIN_PRESETS,
  createElementId,
  isDashboardElementType,
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

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeDashboard(raw: unknown): Dashboard | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Partial<Dashboard>
  if (typeof source.id !== 'string' || !source.id) return null
  const width = finiteNumber(source.width)
  const height = finiteNumber(source.height)
  if (width === null || height === null || width <= 0 || height <= 0) return null
  const normalizedWidth = Math.max(1, Math.round(width))
  const normalizedHeight = Math.max(1, Math.round(height))
  const elements = Array.isArray(source.elements)
    ? source.elements
        .map((element): DashboardElement | null => {
          if (!element || typeof element !== 'object') return null
          const candidate = element as Partial<DashboardElement>
          if (!isDashboardElementType(candidate.type)) return null
          const x = finiteNumber(candidate.x)
          const y = finiteNumber(candidate.y)
          const w = finiteNumber(candidate.w)
          const h = finiteNumber(candidate.h)
          if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) return null
          return {
            ...candidate,
            id: typeof candidate.id === 'string' && candidate.id ? candidate.id : createElementId(),
            type: candidate.type,
            x: clamp(Math.round(x), 0, normalizedWidth),
            y: clamp(Math.round(y), 0, normalizedHeight),
            w: clamp(Math.round(w), 1, normalizedWidth),
            h: clamp(Math.round(h), 1, normalizedHeight),
            style: candidate.style && typeof candidate.style === 'object' ? candidate.style : {}
          }
        })
        .filter((element): element is DashboardElement => Boolean(element))
    : []
  return {
    ...source,
    id: source.id,
    name: typeof source.name === 'string' && source.name.trim() ? source.name : source.id,
    width: normalizedWidth,
    height: normalizedHeight,
    bg: typeof source.bg === 'string' ? source.bg : '#05070a',
    elements,
    scaleMode: source.scaleMode === 'fill' || source.scaleMode === 'stretch' ? source.scaleMode : 'fit',
    hidden: Boolean(source.hidden)
  }
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
  private readonly windows = new Map<string, OpenWindowMeta>()
  private dashboards = new Map<string, Dashboard>()
  private loaded = false
  private loadPromise: Promise<void> | null = null
  private isDisposing = false
  private playlist: DashboardPlaylist = { items: [], updatedAt: 0 }
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
    this.registerScreenListeners()
    await mkdir(this.storeDir, { recursive: true })
    let files: string[] = []
    try {
      files = await readdir(this.storeDir)
    } catch {
      files = []
    }
    for (const file of files) {
      if (!file.endsWith('.json') || file === PLAYLIST_FILE) continue
      try {
        const raw = await readFile(join(this.storeDir, file), 'utf8')
        const dash = normalizeDashboard(JSON.parse(raw))
        if (dash) {
          this.dashboards.set(dash.id, dash)
        }
      } catch {
        // ignora dashboards corrompidos
      }
    }
    if (this.dashboards.size === 0) {
      // Sementeia com presets na primeira execução
      for (const preset of BUILTIN_PRESETS) {
        const dash = preset.build()
        this.dashboards.set(dash.id, dash)
        await this.persist(dash)
      }
    }
    await this.loadPlaylist()
    this.loaded = true
  }

  registerIpc(): void {
    const ipc = this.ctx.ipcMain
    ipc.handle('app:dash:list', async () => {
      await this.load()
      return this.list()
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
    if (!dash || typeof dash.id !== 'string' || !dash.id) {
      throw new Error('Invalid dashboard: id is required.')
    }
    dash.updatedAt = Date.now()
    if (!dash.createdAt) dash.createdAt = dash.updatedAt
    this.dashboards.set(dash.id, dash)
    await this.persist(dash)
    this.ctx.broadcast('app:dash:list', this.list())
    this.ctx.broadcast('app:dash:updated', dash)
    return summarizeDashboard(dash)
  }

  async delete(id: string): Promise<DashboardSummary[]> {
    if (this.windows.has(id)) await this.closeWindow(id)
    const existed = this.dashboards.delete(id)
    if (existed) {
      try {
        await unlink(join(this.storeDir, `${this.fileNameOf(id)}.json`))
      } catch {
        // arquivo já não existia
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
    const built = preset.build()
    // Force the stable preset id so the dashboard is addressable by it.
    const dash: Dashboard = { ...built, id }
    this.dashboards.set(id, dash)
    try {
      await this.persist(dash)
    } catch {
      // Best-effort persistence — still usable in-memory for this session.
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
        const normalized = normalizeDashboard(result.dashboard)
        if (!normalized) throw new Error(`Imported dashboard is invalid: ${screen.name}`)
        summaries.push(await this.save(normalized))
        for (const note of result.notes) if (!allNotes.includes(note)) allNotes.push(note)
      }
      return { summaries, notes: allNotes, screens: first.screens, selectedScreenIndex: first.selectedScreenIndex, filePath: target }
    }
    const normalized = normalizeDashboard(first.dashboard)
    if (!normalized) throw new Error('Imported dashboard is invalid.')
    const summary = await this.save(normalized)
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

  async openWindow(id: string, options: DashboardOpenOptions = {}): Promise<DashboardOpenState> {
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
        this.ctx.broadcast('app:dash:openState', this.listOpen())
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
    this.ctx.broadcast('app:dash:openState', this.listOpen())
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

  private async loadPlaylist(): Promise<void> {
    try {
      const raw = await readFile(join(this.storeDir, PLAYLIST_FILE), 'utf8')
      const parsed = JSON.parse(raw) as DashboardPlaylist
      this.playlist = {
        items: Array.isArray(parsed.items)
          ? parsed.items.filter((item) => item && typeof item.dashboardId === 'string')
          : [],
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now()
      }
    } catch {
      this.playlist = { items: [], updatedAt: 0 }
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
