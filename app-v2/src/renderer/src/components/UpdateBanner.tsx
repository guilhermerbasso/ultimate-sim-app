import { type ReactElement, useEffect, useState } from 'react'
import {
  UPDATE_CHANNELS,
  type UpdaterEvent,
  type UpdaterIpcResult,
  type UpdaterStatus
} from '../../../shared/updater'
import { tt, type ResolvedLanguage } from '../i18n'

function isUpdaterEvent(value: unknown): value is UpdaterEvent {
  return Boolean(value && typeof value === 'object' && 'event' in value && 'status' in value)
}

/**
 * Persistent top-of-app banner shown whenever an update is available / downloading
 * / downloaded (the main process auto-checks on startup + every 4h). Dismissible
 * per-version, but re-appears when the state changes.
 */
export function UpdateBanner({ language }: { language?: ResolvedLanguage }): ReactElement | null {
  const [status, setStatus] = useState<UpdaterStatus | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    return window.ipc.subscribe<UpdaterEvent>(UPDATE_CHANNELS.status, (payload) => {
      if (isUpdaterEvent(payload)) setStatus(payload.status)
    })
  }, [])

  const state = status?.state
  const relevant = state === 'available' || state === 'downloading' || state === 'downloaded'
  const key = relevant ? `${state}:${status?.updateVersion ?? ''}` : null
  if (!relevant || !status || (key !== null && dismissed === key)) return null

  const version = status.updateVersion ?? ''
  const pct = Math.round(status.progressPercent ?? 0)
  const detail =
    state === 'downloaded'
      ? tt(language, 'chrome.update.bannerDownloaded', { version })
      : state === 'downloading'
        ? tt(language, 'chrome.update.bannerDownloading', { pct })
        : tt(language, 'chrome.update.bannerAvailable', { version })

  const download = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.ipc.invoke<UpdaterIpcResult>(UPDATE_CHANNELS.download)
    } finally {
      setBusy(false)
    }
  }
  const install = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.ipc.invoke<UpdaterIpcResult>(UPDATE_CHANNELS.installNow)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="update-banner" role="status">
      <div className="update-banner__text">
        <span className="update-banner__title">{tt(language, 'chrome.update.bannerTitle')}</span>
        <span className="update-banner__detail">{detail}</span>
      </div>
      <div className="update-banner__actions">
        {state === 'available' && (
          <button className="primary-button" type="button" onClick={() => void download()} disabled={busy}>
            {tt(language, 'chrome.update.download')}
          </button>
        )}
        {state === 'downloaded' && (
          <button className="primary-button" type="button" onClick={() => void install()} disabled={busy}>
            {tt(language, 'chrome.update.install')}
          </button>
        )}
        <button className="update-banner__dismiss" type="button" onClick={() => setDismissed(key)}>
          {tt(language, 'chrome.update.dismiss')}
        </button>
      </div>
    </div>
  )
}
