import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import type { ModuleContext } from '../module-context'
import { logger } from './logger'
import {
  UPDATE_CHANNELS,
  type UpdaterEvent,
  type UpdaterIpcResult,
  type UpdaterStatus,
  type UpdateState
} from '../../shared/updater'

const GITHUB_OWNER = 'guilhermerbasso'
const GITHUB_REPO = 'ultimate-sim-app'
const AUTO_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
const STARTUP_CHECK_DELAY_MS = 8000

function stringifyLogMessage(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function errorMessage(error: unknown, fallback?: string): string {
  if (fallback && fallback.trim().length > 0) return fallback
  if (error instanceof Error) return error.message
  return String(error)
}

export function register(ctx: ModuleContext): void {
  const enabled = ctx.app.isPackaged
  let checking = false
  let downloading = false
  let available = false
  let timer: ReturnType<typeof setInterval> | null = null
  let status: UpdaterStatus = {
    currentVersion: ctx.app.getVersion(),
    enabled,
    state: enabled ? 'idle' : 'disabled',
    downloaded: false
  }

  const setState = (state: UpdateState, patch: Partial<UpdaterStatus> = {}): UpdaterStatus => {
    status = {
      ...status,
      state,
      error: state === 'error' ? status.error : undefined,
      ...patch
    }
    return status
  }

  const emit = (event: UpdaterEvent['event'], next: UpdaterStatus, message?: string): void => {
    const payload: UpdaterEvent = { event, status: next, message }
    ctx.broadcast(UPDATE_CHANNELS.status, payload)
  }

  const disabledResult = (): UpdaterIpcResult => ({
    ok: false,
    status,
    message: 'Atualizações são verificadas apenas no app empacotado.'
  })

  const emitError = (error: unknown, fallback?: string): UpdaterStatus => {
    const message = errorMessage(error, fallback)
    const next = setState('error', { error: message })
    logger.warn('updater', 'update error', { message })
    emit('error', next, message)
    return next
  }

  const checkForUpdates = async (downloadWhenAvailable: boolean): Promise<UpdaterIpcResult> => {
    if (!enabled) return disabledResult()
    if (checking) return { ok: true, status }
    checking = true
    emit('checking', setState('checking', { progressPercent: undefined, downloaded: false }))
    try {
      const result = await autoUpdater.checkForUpdates()
      if (result?.isUpdateAvailable) {
        available = true
        setState('available', {
          updateVersion: result.updateInfo.version,
          releaseName: result.updateInfo.releaseName,
          downloaded: false,
          progressPercent: undefined
        })
        if (downloadWhenAvailable) await downloadUpdate()
        return { ok: true, status }
      }
      available = false
      const next = setState('not-available', { downloaded: false, updateVersion: undefined })
      emit('not-available', next)
      return { ok: true, status: next }
    } catch (error) {
      return { ok: false, status: emitError(error) }
    } finally {
      checking = false
    }
  }

  const downloadUpdate = async (): Promise<UpdaterIpcResult> => {
    if (!enabled) return disabledResult()
    if (status.downloaded) return { ok: true, status }
    if (downloading) return { ok: true, status }
    if (!available) {
      const checked = await checkForUpdates(false)
      if (!checked.ok || !available) return checked
    }
    downloading = true
    setState('downloading', { progressPercent: status.progressPercent ?? 0 })
    try {
      await autoUpdater.downloadUpdate()
      return { ok: true, status }
    } catch (error) {
      return { ok: false, status: emitError(error) }
    } finally {
      downloading = false
    }
  }

  autoUpdater.logger = {
    info: (message?: unknown) => logger.info('updater', stringifyLogMessage(message)),
    warn: (message?: unknown) => logger.warn('updater', stringifyLogMessage(message)),
    error: (message?: unknown) => logger.error('updater', stringifyLogMessage(message)),
    debug: (message: string) => logger.debug('updater', message)
  }
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.disableWebInstaller = true
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO
  })

  autoUpdater.on('checking-for-update', () => {
    emit('checking', setState('checking', { progressPercent: undefined, downloaded: false }))
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    available = true
    emit(
      'available',
      setState('available', {
        updateVersion: info.version,
        releaseName: info.releaseName,
        downloaded: false,
        progressPercent: undefined
      })
    )
  })

  autoUpdater.on('update-not-available', () => {
    available = false
    emit('not-available', setState('not-available', { downloaded: false, updateVersion: undefined }))
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    emit('progress', setState('downloading', { progressPercent: Math.max(0, Math.min(100, progress.percent)) }))
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    available = true
    emit(
      'downloaded',
      setState('downloaded', {
        updateVersion: info.version,
        releaseName: info.releaseName,
        downloaded: true,
        progressPercent: 100
      })
    )
  })

  autoUpdater.on('error', (error: Error, message?: string) => {
    emitError(error, message)
  })

  ctx.ipcMain.handle(UPDATE_CHANNELS.check, () => checkForUpdates(false))
  ctx.ipcMain.handle(UPDATE_CHANNELS.download, () => downloadUpdate())
  ctx.ipcMain.handle(UPDATE_CHANNELS.installNow, (): UpdaterIpcResult => {
    if (!enabled) return disabledResult()
    if (!status.downloaded) {
      const next = emitError(new Error('Nenhuma atualização baixada para instalar.'))
      return { ok: false, status: next }
    }
    try {
      autoUpdater.quitAndInstall(false, true)
      return { ok: true, status }
    } catch (error) {
      return { ok: false, status: emitError(error) }
    }
  })

  if (!enabled) {
    logger.info('updater', 'auto update disabled in development/unpackaged run')
    return
  }

  const startupTimer = setTimeout(() => void checkForUpdates(true), STARTUP_CHECK_DELAY_MS)
  startupTimer.unref?.()
  timer = setInterval(() => void checkForUpdates(true), AUTO_CHECK_INTERVAL_MS)
  timer.unref?.()
  ctx.app.once('before-quit', () => {
    if (timer) clearInterval(timer)
    clearTimeout(startupTimer)
  })
}
