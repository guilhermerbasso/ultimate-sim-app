import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import type { ModuleContext } from '../module-context'
import { releaseTouchActionsForWebContents } from '../actions/touch-owner'
import {
  buttonControlActions,
  parseButtonBoxPanelDetailed,
  summarizeButtonBoxPanel,
  type ButtonBoxPanel,
  type ButtonBoxSummary,
  type TouchPanelOpenOptions
} from '../../shared/touch-panel'

// Persistence + fullscreen window manager for editable RGB button-box panels.
// Mirrors the dashboards manager (JSON-per-panel on disk) and the pit-panel
// window (frameless fullscreen BrowserWindow on a chosen display). IPC uses the
// `app:touchpanel:*` prefix so it passes the existing preload allowlists.

const SUBDIR = 'touch-panels'

// Panel ids come from user-editable / imported JSON, so they are UNTRUSTED and
// must never be interpolated straight into a filesystem path — a crafted id such
// as `../../foo` would let a save/delete escape the panels directory
// (path traversal). Sanitize exactly like `DashboardManager.fileNameOf`: keep a
// conservative whitelist and collapse everything else (path separators, `..`,
// NUL, etc.) to `_`. Exported for unit testing.
export function panelFileName(id: string): string {
  const safe = String(id).replace(/[^A-Za-z0-9._-]/g, '_')
  // Defense-in-depth: neutralize any `..` traversal token that survives the
  // whitelist (dots are allowed so real names like `my.panel` keep working).
  const collapsed = safe.replace(/\.\.+/g, '_')
  return collapsed.length > 0 ? collapsed : '_'
}

export function nextTouchPanelRevision(previous: number | undefined, now = Date.now()): number {
  if (previous === undefined) return now
  const safe = Math.trunc(previous)
  if (safe >= Number.MAX_SAFE_INTEGER) {
    throw new Error(`Touch panel revision cannot advance beyond ${String(previous)}.`)
  }
  return Math.max(now, safe + 1)
}

export function bindTouchActionWindowLifecycle(
  win: BrowserWindow,
  release: (webContentsId: number) => Promise<void> = releaseTouchActionsForWebContents
): void {
  const webContentsId = win.webContents.id
  const releaseOwner = (): void => {
    void release(webContentsId)
  }
  win.on('close', releaseOwner)
  win.once('closed', releaseOwner)
  win.webContents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame !== false) releaseOwner()
  })
  win.webContents.on('render-process-gone', releaseOwner)
  win.webContents.once('destroyed', releaseOwner)
}
function controlActionSignature(button: ButtonBoxPanel['buttons'][number]): string {
  return JSON.stringify({
    kind: button.control.kind,
    actions: buttonControlActions(button.control),
    choiceIds: button.control.kind === 'selector'
      ? button.control.choices.map((choice) => choice.id)
      : undefined,
    disabled: Boolean(button.state?.disabled),
    disabledExpressionId: button.stateBindings?.disabled?.expressionId
  })
}

export function touchPanelActionSemanticsChanged(
  previous: ButtonBoxPanel,
  next: ButtonBoxPanel
): boolean {
  if (previous.buttons.length !== next.buttons.length) return true
  const previousById = new Map(previous.buttons.map((button) => [button.id, button]))
  return next.buttons.some((button) => {
    const before = previousById.get(button.id)
    return !before || controlActionSignature(before) !== controlActionSignature(button)
  })
}

export async function publishLiveTouchPanelUpdate(
  previous: ButtonBoxPanel,
  next: ButtonBoxPanel,
  webContentsId: number,
  release: (id: number) => Promise<void>,
  send: (panel: ButtonBoxPanel) => void
): Promise<void> {
  if (touchPanelActionSemanticsChanged(previous, next)) await release(webContentsId)
  send(next)
}
export interface TouchPanelDisplayInfo {
  id: number
  label: string
  width: number
  height: number
  primary: boolean
}

export class TouchPanelManager {
  private readonly storeDir: string
  private panels = new Map<string, ButtonBoxPanel>()
  private loaded = false
  private window: BrowserWindow | null = null
  private currentPanelId: string | null = null

  constructor(private readonly ctx: ModuleContext) {
    this.storeDir = join(ctx.app.getPath('userData'), SUBDIR)
  }

  // Build the on-disk path for a panel id, sanitizing the (untrusted) id so it
  // can never escape the panels directory.
  private panelFilePath(id: string): string {
    return join(this.storeDir, `${panelFileName(id)}.json`)
  }

  async load(): Promise<void> {
    if (this.loaded) return
    await mkdir(this.storeDir, { recursive: true })
    let files: string[] = []
    try {
      files = await readdir(this.storeDir)
    } catch {
      files = []
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const filePath = join(this.storeDir, file)
        const raw = await readFile(filePath, 'utf8')
        const parsed = parseButtonBoxPanelDetailed(JSON.parse(raw))
        if (parsed.panel) {
          this.panels.set(parsed.panel.id, parsed.panel)
          // One-way, idempotent v1 → v2 migration. Layout/action data is preserved
          // before the upgraded document replaces the legacy file.
          if (parsed.migratedFrom === 1) {
            await writeFile(filePath, JSON.stringify(parsed.panel, null, 2), 'utf8')
          }
        } else if (parsed.errors.length > 0) {
          console.warn(`[touchpanel] ${file} was not migrated: ${parsed.errors.join(' ')}`)
        }
      } catch {
        // ignore corrupt panel files
      }
    }
    this.loaded = true
  }

  registerIpc(): void {
    const ipc = this.ctx.ipcMain
    ipc.handle('app:touchpanel:list', () => this.list())
    ipc.handle('app:touchpanel:get', (_event, id: string) => this.panels.get(id) ?? null)
    ipc.handle('app:touchpanel:save', (_event, panel: unknown) => this.save(panel))
    ipc.handle('app:touchpanel:delete', (_event, id: string) => this.delete(id))
    ipc.handle('app:touchpanel:setHidden', (_event, id: string, hidden: boolean) => this.setHidden(id, hidden))
    ipc.handle('app:touchpanel:open', (_event, options?: { panelId?: string } & TouchPanelOpenOptions) =>
      this.openWindow(options ?? {})
    )
    ipc.handle('app:touchpanel:close', () => {
      this.closeWindow()
      return { closed: true }
    })
    ipc.handle('app:touchpanel:listDisplays', () => this.listDisplays())
    ipc.handle('app:touchpanel:isOpen', () => ({ open: this.isOpen(), panelId: this.currentPanelId }))

    this.ctx.app.once('before-quit', () => this.closeWindow())
  }

  list(): ButtonBoxSummary[] {
    return [...this.panels.values()]
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .map((panel) => summarizeButtonBoxPanel(panel))
  }

  // ── Cross-manager surface (consumed by the DashboardManager to route
  //    touch-panel playlist items through the SAME cockpit switch) ──────────────
  /** Whether a panel with this id exists on disk/in memory. */
  has(id: string): boolean {
    return this.panels.has(id)
  }

  /** Summary for a single panel (name/type) — used by the playlist UI resolver. */
  getSummary(id: string): ButtonBoxSummary | null {
    const panel = this.panels.get(id)
    return panel ? summarizeButtonBoxPanel(panel) : null
  }

  /** Full panel data for local-network browser streaming. */
  getPanel(id: string): ButtonBoxPanel | null {
    return this.panels.get(id) ?? null
  }

  /** The panel id currently shown in the fullscreen cockpit window, or null. */
  currentOpenPanelId(): string | null {
    return this.isOpen() ? this.currentPanelId : null
  }

  async save(raw: unknown): Promise<ButtonBoxSummary | null> {
    const parsed = parseButtonBoxPanelDetailed(raw)
    if (!parsed.panel) throw new Error(`Invalid touch panel: ${parsed.errors.join(' ')}`)
    const panel = parsed.panel
    const previous = this.panels.get(panel.id) ?? null
    panel.updatedAt = nextTouchPanelRevision(previous?.updatedAt ?? previous?.createdAt)
    this.panels.set(panel.id, panel)
    await writeFile(this.panelFilePath(panel.id), JSON.stringify(panel, null, 2), 'utf8')
    this.ctx.broadcast('app:touchpanel:list', this.list())
    // If the open window shows this panel, push the update live.
    if (this.window && !this.window.isDestroyed() && this.currentPanelId === panel.id) {
      try {
        if (previous) {
          await publishLiveTouchPanelUpdate(
            previous,
            panel,
            this.window.webContents.id,
            releaseTouchActionsForWebContents,
            (next) => this.window?.webContents.send('app:touchpanel:updated', next)
          )
        } else {
          this.window.webContents.send('app:touchpanel:updated', panel)
        }
      } catch {
        // window closed mid-send
      }
    }
    return summarizeButtonBoxPanel(panel)
  }

  async delete(id: string): Promise<{ deleted: boolean }> {
    this.panels.delete(id)
    try {
      await unlink(this.panelFilePath(id))
    } catch {
      // already gone
    }
    this.ctx.broadcast('app:touchpanel:list', this.list())
    return { deleted: true }
  }

  async setHidden(id: string, hidden: boolean): Promise<ButtonBoxSummary[]> {
    const panel = this.panels.get(id)
    if (!panel) throw new Error(`Touch panel not found: ${id}`)
    panel.hidden = Boolean(hidden)
    panel.updatedAt = nextTouchPanelRevision(panel.updatedAt ?? panel.createdAt)
    this.panels.set(id, panel)
    await writeFile(this.panelFilePath(panel.id), JSON.stringify(panel, null, 2), 'utf8')
    const list = this.list()
    this.ctx.broadcast('app:touchpanel:list', list)
    return list
  }

  listDisplays(): TouchPanelDisplayInfo[] {
    const primaryId = screen.getPrimaryDisplay().id
    return screen.getAllDisplays().map((display, index) => ({
      id: display.id,
      label: display.label || `Monitor ${index + 1}`,
      width: display.size.width,
      height: display.size.height,
      primary: display.id === primaryId
    }))
  }

  private isOpen(): boolean {
    return this.window !== null && !this.window.isDestroyed()
  }

  private pickDisplay(displayId?: number): Electron.Display {
    if (displayId === undefined) return screen.getPrimaryDisplay()
    return screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay()
  }

  private broadcastOpenState(): void {
    this.ctx.broadcast('app:touchpanel:openState', { open: this.isOpen(), panelId: this.currentPanelId })
  }

  openWindow(
    options: { panelId?: string } & TouchPanelOpenOptions
  ): { id: number; displayId: number; fullscreen: boolean } | null {
    const panelId = options.panelId
    if (!panelId || !this.panels.has(panelId)) return null
    const display = this.pickDisplay(options.displayId)
    const fullscreen = options.fullscreen ?? true
    const bounds = display.bounds
    this.currentPanelId = panelId

    if (this.window && !this.window.isDestroyed()) {
      this.window.setBounds(bounds)
      this.window.setFullScreen(fullscreen)
      this.loadPanel(this.window, panelId)
      this.window.focus()
      this.broadcastOpenState()
      return { id: this.window.id, displayId: display.id, fullscreen }
    }

    const win = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      title: 'Touch Controls',
      backgroundColor: '#05070d',
      frame: !fullscreen,
      autoHideMenuBar: true,
      fullscreen,
      webPreferences: {
        preload: join(__dirname, '../preload/touchpanel.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false
      }
    })

    bindTouchActionWindowLifecycle(win)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    // Defence-in-depth: the touch-panel window carries a privileged preload, so
    // never let it navigate away from the app-served panel document (external
    // navigation would otherwise retain that preload). Only the local dev-server
    // renderer URL or the packaged file:// document are allowed.
    win.webContents.on('will-navigate', (event, url) => {
      const allowed = process.env.ELECTRON_RENDERER_URL ?? 'file://'
      if (!url.startsWith(allowed)) event.preventDefault()
    })
    win.on('closed', () => {
      if (this.window === win) {
        this.window = null
        this.currentPanelId = null
        this.broadcastOpenState()
      }
    })

    this.loadPanel(win, panelId)
    this.window = win
    this.broadcastOpenState()
    return { id: win.id, displayId: display.id, fullscreen }
  }

  private loadPanel(win: BrowserWindow, panelId: string): void {
    void releaseTouchActionsForWebContents(win.webContents.id)
    const query = { panel: panelId }
    if (process.env.ELECTRON_RENDERER_URL) {
      const url = new URL('touchpanel.html', process.env.ELECTRON_RENDERER_URL)
      url.searchParams.set('panel', panelId)
      void win.loadURL(url.toString())
    } else {
      void win.loadFile(join(__dirname, '../renderer/touchpanel.html'), { query })
    }
  }

  closeWindow(): void {
    if (this.window && !this.window.isDestroyed()) {
      void releaseTouchActionsForWebContents(this.window.webContents.id)
      this.window.close()
    }
    this.window = null
    this.currentPanelId = null
    this.broadcastOpenState()
  }
}

// The live singleton, exposed so the DashboardManager can coordinate a single
// cockpit window (dashboard OR button-box) across both managers. Null until
// `register` runs; both managers are registered in the same startup loop, so the
// DashboardManager only ever dereferences this lazily at cycle/activate time.
let liveManager: TouchPanelManager | null = null

export function getTouchPanelManager(): TouchPanelManager | null {
  return liveManager
}

export function register(ctx: ModuleContext): void {
  const manager = new TouchPanelManager(ctx)
  manager.registerIpc()
  void manager.load()
  liveManager = manager
}
