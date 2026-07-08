import type { ModuleContext } from '../module-context'
import { shell } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { toTelemetrySource, type AppSettings } from '../../shared/settings'
import { SettingsStore } from '../settings/store'
import { settingsEvents } from '../settings/events'
import { logger } from './logger'

function recordingsPath(ctx: ModuleContext): string {
  return join(ctx.app.getPath('userData'), 'recordings')
}

function applyLoginItemSettings(ctx: ModuleContext, settings: AppSettings): void {
  try {
    ctx.app.setLoginItemSettings({ openAtLogin: settings.autoStart })
  } catch (error) {
    console.warn('[settings] Failed to apply login item settings.', error)
  }
}

function applyStartMinimized(ctx: ModuleContext, settings: AppSettings): void {
  if (!settings.startMinimized) return

  ctx.app.once('browser-window-created', (_event, window) => {
    queueMicrotask(() => {
      if (!window.isDestroyed()) window.minimize()
    })
  })
}

async function openPath(path: string): Promise<string> {
  await mkdir(path, { recursive: true })
  return shell.openPath(path)
}

export function register(ctx: ModuleContext): SettingsStore {
  const store = new SettingsStore(ctx.app.getPath('userData'))
  const settings = store.load()

  applyLoginItemSettings(ctx, settings)
  applyStartMinimized(ctx, settings)
  void ctx.telemetryHub.setSource(toTelemetrySource(settings.defaultTelemetrySource)).catch((error) => {
    console.warn('[settings] Failed to apply default telemetry source.', error)
  })
  // Broadcast the boot settings so in-process listeners registered earlier (e.g. the
  // iRacing provider's tcSensitivity subscriber) pick up the persisted value on launch.
  settingsEvents.emitChanged(settings)

  ctx.ipcMain.handle('app:getSettings', () => store.getSettings())
  ctx.ipcMain.handle('app:setSettings', async (_event, settings: Partial<AppSettings>) => {
    const saved = store.setSettings(settings)
    applyLoginItemSettings(ctx, saved)
    await ctx.telemetryHub.setSource(toTelemetrySource(saved.defaultTelemetrySource))
    logger.info('settings', 'defaultTelemetrySource saved', { value: saved.defaultTelemetrySource })
    // Notify in-process listeners (e.g. the SIM-X auto-start coordinator) so a live
    // toggle of autoStartSimX takes effect without an app restart.
    settingsEvents.emitChanged(saved)
    return saved
  })
  ctx.ipcMain.handle('app:openUserData', () => openPath(ctx.app.getPath('userData')))
  ctx.ipcMain.handle('app:openRecordings', () => openPath(recordingsPath(ctx)))

  return store
}
