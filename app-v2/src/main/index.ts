import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, session, shell, Tray } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  ConfigPatch,
  EncoderEvent,
  Mapping,
  MappingPatch,
  ProfilePayload
} from '../shared/ipc'
import { IRacingControl } from './iracing/control'
import type { ModuleContext } from './module-context'
import { registerModules, type RegisteredModules } from './modules'
import { ProfileStore } from './profiles'
import { SerialHub } from './serial/hub'
import { SerialManager } from './serial-manager'
import { TelemetryHub } from './telemetry/hub'
import { isBenignSerialError, serialErrorMessage } from './serial/errors'
import { logger } from './modules/logger'
import { instrumentBroadcast, instrumentIpcMain } from './modules/diagnostics-log'
import { claimFirstTrayHint, trayHintFlagPath } from './tray-hint'

// Global safety net (installed FIRST, before any other work). Serial I/O on
// Windows can raise an async "Operation aborted" (ERROR_OPERATION_ABORTED) when a
// pending read/write is cancelled as the port closes — during a flash/cancel,
// disconnect or teardown. Such benign errors must never reach Electron's fatal
// "A JavaScript error occurred in the main process" dialog. We log everything and
// swallow ONLY the benign serial cases; genuinely fatal errors (incl. startup)
// are still logged and allowed to crash so real bugs stay visible.
function installGlobalErrorGuards(): void {
  process.on('uncaughtException', (error) => {
    if (isBenignSerialError(error)) {
      console.warn('[main] Ignored benign serial I/O error (uncaughtException):', serialErrorMessage(error))
      return
    }
    console.error('[main] Fatal uncaught exception in main process:', error)
    logger.error('main', 'fatal uncaughtException', {
      message: serialErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined
    })
    logger.flushSync()
    process.exit(1)
  })

  process.on('unhandledRejection', (reason) => {
    if (isBenignSerialError(reason)) {
      console.warn('[main] Ignored benign serial I/O rejection (unhandledRejection):', serialErrorMessage(reason))
      return
    }
    // Re-surface non-serial rejections so the uncaughtException policy above
    // applies (log + fail). Benign serial aborts never reach this throw.
    logger.error('main', 'fatal unhandledRejection', {
      message: serialErrorMessage(reason),
      stack: reason instanceof Error ? reason.stack : undefined
    })
    logger.flushSync()
    throw reason
  })
}

installGlobalErrorGuards()

// Configure the diagnostic logger as early as possible so even a pre-`app.ready`
// crash is captured. The logger module's register() reconfigures (idempotent) and
// wires the renderer/export IPC. Retention is fixed at 24h, pruned on an interval.
logger.configure({ dir: join(app.getPath('userData'), 'logs'), appVersion: app.getVersion() })
logger.info('app', 'app starting', { version: app.getVersion(), platform: process.platform })

const serialHub = new SerialHub()
const serialManager = new SerialManager(serialHub)
const profileStore = new ProfileStore()
const telemetryHub = new TelemetryHub()
const iracingControl = new IRacingControl()
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
// True once a genuine quit is underway (tray "Sair", closeToTray off, or app.quit),
// so the main window's close button hides-to-tray only when NOT actually quitting.
let isQuitting = false
let registered: RegisteredModules | null = null
let teardownStarted = false
let teardownDone = false
// One-shot guard so the "still running in the tray" hint is evaluated at most once
// per run (the persisted flag file then makes it once per install).
let trayHintShownThisRun = false

// Embedded 32x32 tray icon (PNG) so there's no packaged-asset path to resolve.
const TRAY_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAcklEQVR42mNgGOzgfxbDf0rwgFhKkWP4BMT+0xIPqOV4HQEKIno5AGt0jGwHwFIpPR2A4ohRB4w6AJcDzC7WYGCwARsYMDBY3FoeA486YNQBQ9sBo+XAqAPo5oDRFtGgcMCAN8sHRcdkUHTNBkXnlJ4AAE4NCe7DfoAkAAAAAElFTkSuQmCC'

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

// Begin a genuine FULL quit (not a hide-to-tray). Marking isQuitting first stops the
// main window's close handler from intercepting; app.quit() then fires `before-quit`,
// which runs the ordered gracefulTeardown() (iFlag/rev-lights OFF, ports closed) and
// the overlay/dashboard `before-quit` disposes — so every window closes. Shared by the
// tray "Sair", the in-app "Sair do app" button (app:quit IPC) and the close-to-tray-off
// window close.
function quitApp(): void {
  isQuitting = true
  app.quit()
}

// Show the one-time "the app is still running in the tray" hint. Windows gets a native
// tray balloon; other platforms (and any balloon failure) fall back to an Electron
// Notification. Best-effort — a hint failure must never block hide-to-tray.
function showTrayHint(): void {
  const title = 'Ultimate Sim App continua rodando'
  const content =
    'A janela foi minimizada para a bandeja (ao lado do relógio) e o app segue rodando. ' +
    'Clique no ícone da bandeja para reabrir, ou use "Sair" para fechar TUDO (janela, overlays, dashboards e iFlag).'
  if (process.platform === 'win32' && tray && !tray.isDestroyed()) {
    try {
      tray.displayBalloon({ title, content })
      return
    } catch {
      // Fall back to a desktop notification below.
    }
  }
  try {
    if (Notification.isSupported()) new Notification({ title, body: content }).show()
  } catch {
    // best effort
  }
}

// The FIRST time (ever, per install) the window hides to the tray, explain that the app
// keeps running and how to fully quit. Persisted via a userData flag file; an in-memory
// guard avoids re-touching the flag on every later hide this run.
function maybeShowTrayHint(): void {
  if (trayHintShownThisRun) return
  trayHintShownThisRun = true
  let isFirst = true
  try {
    isFirst = claimFirstTrayHint(trayHintFlagPath(app.getPath('userData')))
  } catch {
    // userData not resolvable — fail safe and show the hint once this run.
  }
  if (isFirst) showTrayHint()
}

function createTray(): void {
  if (tray && !tray.isDestroyed()) return
  const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_BASE64, 'base64'))
  tray = new Tray(icon)
  tray.setToolTip('Ultimate Sim App — clique para abrir. "Sair" fecha tudo (overlays, dashboards, iFlag).')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir Ultimate Sim App', click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: 'Sair (fechar tudo: overlays, dashboards e iFlag)',
        click: () => quitApp()
      }
    ])
  )
  tray.on('click', () => showMainWindow())
  tray.on('double-click', () => showMainWindow())
}

// Clean, ORDERED quit teardown: turn the hardware OFF (iFlag black + rev-lights) and
// DRAIN it while the serial ports are still open, THEN close ports + telemetry. Bounded
// so a wedged port can never hang the quit. Runs once; the before-quit handler re-quits
// after it resolves.
async function gracefulTeardown(): Promise<void> {
  try {
    await registered?.rgbMatrix.allOff()
  } catch {
    // best effort
  }
  // Pull the SIM-X rev-lights strip down deterministically BEFORE closing the ports.
  // The revlights module also disposes on its own before-quit, but that is
  // fire-and-forget and would otherwise race serialHub.disconnectAll() on the SIM-X
  // port; awaiting here guarantees the rev-level-0 write drains before disconnect.
  // dispose() is idempotent, so the double call is harmless.
  try {
    await registered?.revlightsEngine.dispose()
  } catch {
    // best effort
  }
  try {
    await serialHub.disconnectAll()
  } catch {
    // best effort
  }
  try {
    await telemetryHub.dispose()
  } catch {
    // best effort
  }
  try {
    await logger.flush()
  } catch {
    // best effort
  }
}

function openExternalUrl(url: string, protocols: ReadonlySet<string>): void {
  try {
    const parsed = new URL(url)
    if (protocols.has(parsed.protocol)) void shell.openExternal(parsed.toString())
  } catch {
    // Deny malformed URLs.
  }
}

function isAllowedMainNavigation(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (process.env.ELECTRON_RENDERER_URL) {
      return parsed.origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
    }
    return parsed.href === pathToFileURL(join(__dirname, '../renderer/index.html')).href
  } catch {
    return false
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

function buildModuleContext(): ModuleContext {
  return {
    app,
    ipcMain: instrumentIpcMain(ipcMain),
    telemetryHub,
    serialManager,
    serialHub,
    profileStore,
    iracingControl,
    getMainWindow: () => mainWindow,
    broadcast: instrumentBroadcast(broadcast)
  }
}

function registerIpcHandlers(): void {
  // ─── Device protocol (new SIM-X / SimHub) ──────────────────────────────────
  ipcMain.handle('buttonbox:listPorts', () => serialManager.listPorts())
  ipcMain.handle('buttonbox:connect', (_event, path: string) => serialManager.connect(path))
  ipcMain.handle('buttonbox:disconnect', () => serialManager.disconnect())
  ipcMain.handle('buttonbox:sendOled', (_event, line1: string, line2: string, line3: string) =>
    serialManager.sendOled(line1, line2, line3)
  )
  ipcMain.handle('buttonbox:sendBigNum', (_event, value: string) => serialManager.sendBigNum(value))
  ipcMain.handle('buttonbox:sendRevLevel', (_event, level: number) => serialManager.sendRevLevel(level))
  ipcMain.handle('buttonbox:sendShiftBlink', (_event, active: boolean) => serialManager.sendShiftBlink(active))
  ipcMain.handle('buttonbox:sendStartLed', (_event, on: boolean) => serialManager.sendStartLed(on))
  ipcMain.handle('buttonbox:selfTest', () => serialManager.runSelfTest())
  ipcMain.handle('buttonbox:getStatus', () => serialManager.getDevice())

  // ─── Legacy (kept for App.tsx / ProfilesView.tsx compatibility) ────────────
  ipcMain.handle('buttonbox:ping', () => serialManager.ping())
  ipcMain.handle('buttonbox:getMapping', () => serialManager.getMapping())
  ipcMain.handle('buttonbox:setMapping', (_event, mapping: MappingPatch | Partial<Mapping>) =>
    serialManager.setMapping(mapping)
  )
  ipcMain.handle('buttonbox:getConfig', () => serialManager.getConfig())
  ipcMain.handle('buttonbox:setConfig', (_event, config: ConfigPatch) => serialManager.setConfig(config))
  ipcMain.handle('buttonbox:saveToDevice', () => serialManager.saveToDevice())
  ipcMain.handle('buttonbox:loadFromDevice', () => serialManager.loadFromDevice())
  ipcMain.handle('buttonbox:resetToDefaults', () => serialManager.resetToDefaults())
  ipcMain.handle('buttonbox:sendOledPreview', (_event, line: string) => serialManager.sendOledPreview(line))
  ipcMain.handle('buttonbox:listProfiles', () => profileStore.listProfiles())
  ipcMain.handle('buttonbox:saveProfile', (_event, name: string, data: ProfilePayload) =>
    profileStore.saveProfile(name, data)
  )
  ipcMain.handle('buttonbox:loadProfile', (_event, name: string) => profileStore.loadProfile(name))
  ipcMain.handle('buttonbox:deleteProfile', (_event, name: string) => profileStore.deleteProfile(name))
  ipcMain.handle('buttonbox:applyProfileToDevice', (_event, data: ProfilePayload) =>
    serialManager.applyProfileToDevice(data)
  )

  // ─── App lifecycle ──────────────────────────────────────────────────────────
  // Full quit from inside the renderer (Settings → "Sair do app"). Mirrors the tray
  // "Sair": isQuitting + app.quit() so `before-quit` runs the ordered gracefulTeardown()
  // (iFlag/rev-lights OFF, ports closed) and the overlay/dashboard before-quit disposes
  // close every window. Resolves before the process exits, so the renderer must not rely
  // on the returned promise.
  ipcMain.handle('app:quit', () => {
    quitApp()
    return true
  })

  // ─── Encoder events flow main → renderer over IPC ───────────────────────────
  serialManager.on('encoder', (event: EncoderEvent) => {
    broadcast('buttonbox:encoder', event)
  })

  // Auto-connect runs in main before the renderer mounts, so push every primary
  // connect/disconnect to keep the renderer device registry in sync.
  serialManager.on('connect', () => broadcast('buttonbox:connected', serialManager.getDevice()))
  serialManager.on('disconnect', () => broadcast('buttonbox:disconnected', null))
}


// Grant the renderer the audio media permissions it needs so the Sounds output
// picker works on Windows/Chromium:
//   • getUserMedia({audio:true}) → unlocks stable deviceId + label for every
//     `audiooutput` returned by enumerateDevices (Chromium hides them otherwise).
//   • HTMLMediaElement/AudioContext.setSinkId(<id>) → routes a cue to a SPECIFIC
//     output device; Chromium gates this behind the 'speaker-selection' policy,
//     which Electron surfaces through the permission CHECK handler.
// Without these grants the device list comes back empty/unlabeled and selecting a
// device silently no-ops — exactly the reported bug. We scope the grants strictly
// to our own renderer origin (dev: ELECTRON_RENDERER_URL; packaged: file://) and
// only allow the audio-related permissions, never a blanket allow.
//
// NOTE: setDevicePermissionHandler is intentionally NOT installed. It governs the
// navigator.serial/hid/usb chooser, which this app does not use (serial runs in
// the main process over IPC). Audio output selection is governed by the
// 'speaker-selection' permission check below, not by the device handler.
function configureMediaPermissions(): void {
  const ses = session.defaultSession
  const allowedRequestPermissions = new Set(['media', 'audioCapture'])
  const allowedCheckPermissions = new Set(['media', 'audioCapture', 'speaker-selection'])

  const isAppOrigin = (origin: string | null | undefined): boolean => {
    if (process.env.ELECTRON_RENDERER_URL) {
      try {
        return origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
      } catch {
        return false
      }
    }
    // Packaged build: the renderer is the only file:// content we ever load.
    // Chromium reports a file:// document's origin as 'file://' (or an opaque
    // 'null'); accept both, deny anything else.
    return origin === 'file://' || origin === 'null' || origin == null || origin === ''
  }

  const originFromUrl = (url: string | undefined): string | undefined => {
    if (!url) return undefined
    try {
      return new URL(url).origin
    } catch {
      return undefined
    }
  }

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const fromMainWindow = webContents != null && webContents === mainWindow?.webContents
    const allowed =
      allowedRequestPermissions.has(permission) &&
      (fromMainWindow || isAppOrigin(originFromUrl(details?.requestingUrl)))
    callback(allowed)
  })

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const fromMainWindow = webContents != null && webContents === mainWindow?.webContents
    return (
      allowedCheckPermissions.has(permission) &&
      (fromMainWindow || isAppOrigin(requestingOrigin) || isAppOrigin(originFromUrl(details?.requestingUrl)))
    )
  })
}

function registerProductionContentSecurityPolicy(): void {
  if (process.env.ELECTRON_RENDERER_URL) return

  const contentSecurityPolicy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'"
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy]
      }
    })
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#080b10',
    title: 'Ultimate Sim App',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Keep the renderer's gamepad/action polling loop alive while the sim has
      // focus and this window is backgrounded (otherwise rAF is throttled).
      backgroundThrottling: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url, new Set(['https:', 'http:', 'mailto:']))
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedMainNavigation(url)) return
    event.preventDefault()
    openExternalUrl(url, new Set(['https:', 'http:']))
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('close', (event) => {
    if (isQuitting) return
    if (registered?.settingsStore.getSettings().closeToTray) {
      // Minimize to the Windows system tray instead of quitting.
      event.preventDefault()
      mainWindow?.hide()
      // First hide ever: tell the user the app is still alive in the tray and how to
      // fully quit. One-shot (persisted), non-blocking, best-effort.
      maybeShowTrayHint()
    } else {
      // closeToTray off: closing the main window quits the WHOLE app — the overlay /
      // dashboard windows are independent top-level windows that would otherwise keep
      // the process alive.
      quitApp()
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

if (!app.requestSingleInstanceLock()) {
  // A second instance was launched (e.g. the user re-ran the exe while the first is
  // hidden in the tray). Surface the existing window and exit this one immediately —
  // two instances would fight over the SIM-X / iFlag serial ports.
  app.exit(0)
} else {
  app.on('second-instance', () => showMainWindow())

  app.whenReady().then(() => {
    registerIpcHandlers()
    registered = registerModules(buildModuleContext())
    registerProductionContentSecurityPolicy()
    configureMediaPermissions()
    createWindow()
    createTray()
    logger.info('app', 'app ready')

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('before-quit', (event) => {
  isQuitting = true
  // Gate the quit on teardown COMPLETION, not start. A `closeToTray = off` close also
  // fires `window-all-closed` (the main window genuinely closes), which would trigger a
  // SECOND before-quit while gracefulTeardown() is still draining the iFlag/serial. We
  // must keep deferring on EVERY pass until the hardware-off sequence has finished, or
  // the process would exit mid-teardown and leave the iFlag lit / ports open.
  if (teardownDone) return
  // Defer the quit until the hardware is OFF and drained, then re-quit. Bounded so a
  // wedged serial port can never hang the exit.
  event.preventDefault()
  if (teardownStarted) return
  teardownStarted = true
  logger.info('app', 'app quitting')
  void Promise.race([gracefulTeardown(), delayMs(2500)]).finally(() => {
    teardownDone = true
    try {
      tray?.destroy()
    } catch {
      // ignore
    }
    tray = null
    app.quit()
  })
})

app.on('window-all-closed', () => {
  // With close-to-tray the main window only HIDES, so this fires only on a genuine
  // teardown (all windows actually closed) — quit on non-macOS.
  if (process.platform !== 'darwin') app.quit()
})

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
