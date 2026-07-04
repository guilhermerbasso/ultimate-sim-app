import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import type { ModuleContext } from '../module-context'

// Touch Pit & Command window. A frameless, fullscreen BrowserWindow intended for
// the 7" panel. It reuses the dedicated `pitpanel.mjs` preload (only `window.ipc`
// with iracing:/telemetry:/app:pitpanel:) and the existing display-pick logic.

export interface PitPanelOpenOptions {
  displayId?: number
  fullscreen?: boolean
}

export interface PitPanelDisplayInfo {
  id: number
  label: string
  width: number
  height: number
  primary: boolean
}

let panelWindow: BrowserWindow | null = null

function isOpen(): boolean {
  return panelWindow !== null && !panelWindow.isDestroyed()
}

function broadcastOpenState(ctx: ModuleContext): void {
  ctx.broadcast('app:pitpanel:openState', { open: isOpen() })
}

function listDisplays(): PitPanelDisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((display, index) => ({
    id: display.id,
    label: display.label || `Monitor ${index + 1}`,
    width: display.size.width,
    height: display.size.height,
    primary: display.id === primaryId
  }))
}

function pickDisplay(displayId?: number) {
  if (displayId === undefined) return screen.getPrimaryDisplay()
  return screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay()
}

function openWindow(ctx: ModuleContext, options: PitPanelOpenOptions = {}): { id: number; displayId: number; fullscreen: boolean } {
  const display = pickDisplay(options.displayId)
  const fullscreen = options.fullscreen ?? true
  const bounds = display.bounds

  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.setBounds(bounds)
    panelWindow.setFullScreen(fullscreen)
    panelWindow.focus()
    return { id: panelWindow.id, displayId: display.id, fullscreen }
  }

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    title: 'Pit & Command',
    backgroundColor: '#0a0c10',
    frame: !fullscreen,
    autoHideMenuBar: true,
    fullscreen,
    webPreferences: {
      preload: join(__dirname, '../preload/pitpanel.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  win.webContents.once('did-finish-load', () => {
    try {
      win.webContents.send('telemetry:snapshot', ctx.telemetryHub.getLatest())
    } catch {
      // window closed mid-load
    }
  })

  win.on('closed', () => {
    if (panelWindow === win) {
      panelWindow = null
      // Reconcile renderers when the panel is dismissed via its own window chrome.
      broadcastOpenState(ctx)
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL('pitpanel.html', process.env.ELECTRON_RENDERER_URL)
    void win.loadURL(url.toString())
  } else {
    void win.loadFile(join(__dirname, '../renderer/pitpanel.html'))
  }

  panelWindow = win
  broadcastOpenState(ctx)
  return { id: win.id, displayId: display.id, fullscreen }
}

function closeWindow(): void {
  if (panelWindow && !panelWindow.isDestroyed()) panelWindow.close()
  panelWindow = null
}

export function register(ctx: ModuleContext): void {
  ctx.ipcMain.handle('app:pitpanel:open', (_event, options?: PitPanelOpenOptions) => openWindow(ctx, options ?? {}))
  ctx.ipcMain.handle('app:pitpanel:close', () => {
    closeWindow()
    broadcastOpenState(ctx)
    return { closed: true }
  })
  ctx.ipcMain.handle('app:pitpanel:listDisplays', () => listDisplays())
  ctx.ipcMain.handle('app:pitpanel:isOpen', () => ({ open: isOpen() }))

  ctx.app.once('before-quit', () => {
    closeWindow()
  })
}
