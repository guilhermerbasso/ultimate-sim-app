import { BrowserWindow, screen, shell, type Display } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CustomOverlayListItem, OverlayListItem } from '../../shared/overlays'
import { OVERLAY_WIDGETS } from '../../shared/overlays'
import type { ModuleContext } from '../module-context'

const CONFIG_FILE = 'compositor.json'
const HIT_IDLE_RESET_MS = 750

interface OverlayCompositorConfig {
  overlayCompositorEnabled: boolean
}

interface CompositorHitPayload {
  displayId: number
  interactive: boolean
}

interface OverlayStateProvider {
  list(): OverlayListItem[]
  listCustom(): CustomOverlayListItem[]
}

function openExternalUrl(url: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') void shell.openExternal(parsed.toString())
  } catch {
    // Deny malformed URLs.
  }
}

function isAllowedCompositorNavigation(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (process.env.ELECTRON_RENDERER_URL) {
      return parsed.origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
    }
    const appHtml = pathToFileURL(join(__dirname, '../renderer/compositor.html'))
    return parsed.protocol === 'file:' && parsed.pathname === appHtml.pathname
  } catch {
    return false
  }
}

function isCompositorHitPayload(value: unknown): value is CompositorHitPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<CompositorHitPayload>
  return typeof payload.displayId === 'number' && Number.isFinite(payload.displayId) &&
    typeof payload.interactive === 'boolean'
}

function isLegacyOverlayWindow(win: BrowserWindow): boolean {
  if (win.isDestroyed()) return false
  const title = win.getTitle()
  return OVERLAY_WIDGETS.some((widget) => title === `Overlay ${widget.id}`)
}

export class OverlayCompositorManager {
  private readonly windows = new Map<number, BrowserWindow>()
  private readonly hiddenLegacyWindows = new Set<BrowserWindow>()
  private readonly hitResetTimers = new Map<number, ReturnType<typeof setTimeout>>()
  private readonly configPath: string
  private enabled = false
  private stateProvider: OverlayStateProvider | null = null
  private screenListenersRegistered = false
  private readonly rebuild = (): void => {
    if (!this.enabled) return
    this.destroyCompositorWindows()
    this.createCompositorWindows()
    this.syncLegacyOverlayWindows()
  }

  constructor(private readonly ctx: ModuleContext) {
    this.configPath = join(ctx.app.getPath('userData'), CONFIG_FILE)
  }

  setStateProvider(provider: OverlayStateProvider): void {
    this.stateProvider = provider
  }

  async load(): Promise<void> {
    const config = await this.readConfig()
    await this.setEnabled(Boolean(config.overlayCompositorEnabled), false)
  }

  registerIpc(): void {
    this.ctx.ipcMain.handle('overlays:getCompositorEnabled', () => this.enabled)
    this.ctx.ipcMain.handle('overlays:setCompositorEnabled', async (_event, enabled: boolean) => {
      await this.setEnabled(Boolean(enabled), true)
      return this.enabled
    })
    this.ctx.ipcMain.handle('overlays:compositorHit', (_event, payload: unknown) => {
      if (!isCompositorHitPayload(payload)) return false
      const win = this.windows.get(payload.displayId)
      if (!win || win.isDestroyed()) return false
      this.setWindowInteractive(payload.displayId, payload.interactive)
      return true
    })
  }

  async setEnabled(nextEnabled: boolean, persist: boolean): Promise<void> {
    if (persist) {
      await this.writeConfig({ overlayCompositorEnabled: nextEnabled })
    }

    if (this.enabled === nextEnabled) {
      this.syncLegacyOverlayWindows()
      this.broadcastToCompositorWindows()
      return
    }

    this.enabled = nextEnabled
    if (this.enabled) {
      this.registerScreenListeners()
      this.createCompositorWindows()
      this.syncLegacyOverlayWindows()
    } else {
      this.unregisterScreenListeners()
      this.destroyCompositorWindows()
      this.restoreLegacyOverlayWindows()
    }
    // `?.` only guards a null main window, not a destroyed one — guard both the
    // window and its webContents so a stray send can't throw "Object has been
    // destroyed" (→ fatal handler → process.exit(1), bypassing clean teardown).
    const mw = this.ctx.getMainWindow()
    if (mw && !mw.isDestroyed() && !mw.webContents.isDestroyed()) {
      mw.webContents.send('overlays:compositorEnabled', this.enabled)
    }
  }

  sync(): void {
    if (!this.enabled) return
    this.syncLegacyOverlayWindows()
    this.broadcastToCompositorWindows()
  }

  dispose(): void {
    this.enabled = false
    this.unregisterScreenListeners()
    this.destroyCompositorWindows()
    this.clearHitResetTimers()
    this.restoreLegacyOverlayWindows()
  }

  private async readConfig(): Promise<OverlayCompositorConfig> {
    try {
      const raw = await readFile(this.configPath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<OverlayCompositorConfig>
      return { overlayCompositorEnabled: Boolean(parsed.overlayCompositorEnabled) }
    } catch {
      return { overlayCompositorEnabled: false }
    }
  }

  private async writeConfig(config: OverlayCompositorConfig): Promise<void> {
    await writeFile(this.configPath, `${JSON.stringify(config, null, 2)}
`, 'utf8')
  }

  private createCompositorWindows(): void {
    for (const display of screen.getAllDisplays()) this.createWindow(display)
  }

  private createWindow(display: Display): void {
    const existing = this.windows.get(display.id)
    if (existing && !existing.isDestroyed()) return
    const win = new BrowserWindow({
      ...display.bounds,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      title: `Overlay compositor ${display.id}`,
      webPreferences: {
        preload: join(__dirname, '../preload/overlay.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false
      }
    })

    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.setFullScreenable(false)
    win.setIgnoreMouseEvents(true, { forward: true })
    this.windows.set(display.id, win)

    win.webContents.setWindowOpenHandler(({ url }) => {
      openExternalUrl(url)
      return { action: 'deny' }
    })

    win.webContents.on('will-navigate', (event, url) => {
      if (isAllowedCompositorNavigation(url)) return
      event.preventDefault()
      openExternalUrl(url)
    })

    win.on('show', () => this.reassertTopmost(display.id))
    win.on('focus', () => this.reassertTopmost(display.id))
    win.on('blur', () => this.reassertTopmost(display.id))
    win.on('restore', () => this.reassertTopmost(display.id))
    win.on('closed', () => {
      if (this.windows.get(display.id) === win) this.windows.delete(display.id)
    })

    win.webContents.once('did-finish-load', () => {
      if (win.isDestroyed() || win.webContents.isDestroyed()) return
      this.reassertTopmost(display.id)
      win.webContents.send('telemetry:snapshot', this.ctx.telemetryHub.getLatest())
      this.sendState(win)
    })

    const query = {
      displayId: String(display.id),
      displayX: String(display.bounds.x),
      displayY: String(display.bounds.y),
      displayWidth: String(display.bounds.width),
      displayHeight: String(display.bounds.height)
    }
    if (process.env.ELECTRON_RENDERER_URL) {
      const url = new URL('compositor.html', process.env.ELECTRON_RENDERER_URL)
      Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value))
      void win.loadURL(url.toString())
    } else {
      void win.loadFile(join(__dirname, '../renderer/compositor.html'), { query })
    }
  }

  private destroyCompositorWindows(): void {
    this.clearHitResetTimers()
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.close()
    }
    this.windows.clear()
  }

  private syncLegacyOverlayWindows(): void {
    if (!this.enabled) {
      this.restoreLegacyOverlayWindows()
      return
    }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!isLegacyOverlayWindow(win) || !win.isVisible()) continue
      this.hiddenLegacyWindows.add(win)
      win.hide()
    }
  }

  private restoreLegacyOverlayWindows(): void {
    for (const win of this.hiddenLegacyWindows) {
      if (!win.isDestroyed()) win.showInactive()
    }
    this.hiddenLegacyWindows.clear()
  }

  private broadcastToCompositorWindows(): void {
    for (const win of this.windows.values()) this.sendState(win)
  }

  private sendState(win: BrowserWindow): void {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    win.webContents.send('overlays:compositorRefresh', null)
    if (!this.stateProvider) return
    win.webContents.send('overlays:state', this.stateProvider.list())
    win.webContents.send('overlays:customState', this.stateProvider.listCustom())
  }

  private registerScreenListeners(): void {
    if (this.screenListenersRegistered) return
    screen.on('display-metrics-changed', this.rebuild)
    screen.on('display-added', this.rebuild)
    screen.on('display-removed', this.rebuild)
    this.screenListenersRegistered = true
  }

  private unregisterScreenListeners(): void {
    if (!this.screenListenersRegistered) return
    screen.off('display-metrics-changed', this.rebuild)
    screen.off('display-added', this.rebuild)
    screen.off('display-removed', this.rebuild)
    this.screenListenersRegistered = false
  }

  private reassertTopmost(displayId: number): void {
    const win = this.windows.get(displayId)
    if (!win || win.isDestroyed()) return
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  private setWindowInteractive(displayId: number, interactive: boolean): void {
    const win = this.windows.get(displayId)
    if (!win || win.isDestroyed()) return
    win.setIgnoreMouseEvents(!interactive, { forward: true })
    const currentTimer = this.hitResetTimers.get(displayId)
    if (currentTimer) clearTimeout(currentTimer)
    if (!interactive) {
      this.hitResetTimers.delete(displayId)
      return
    }
    this.hitResetTimers.set(displayId, setTimeout(() => {
      this.hitResetTimers.delete(displayId)
      const current = this.windows.get(displayId)
      if (!current || current.isDestroyed()) return
      current.setIgnoreMouseEvents(true, { forward: true })
    }, HIT_IDLE_RESET_MS))
  }

  private clearHitResetTimers(): void {
    for (const timer of this.hitResetTimers.values()) clearTimeout(timer)
    this.hitResetTimers.clear()
  }
}
