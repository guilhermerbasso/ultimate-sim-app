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
 * Persistent header "Check for updates" button. Sits beside Support / Report-bug /
 * Discord in the app chrome on every screen, so a user can trigger an update check
 * from anywhere. It reflects the updater state and, when an update is available or
 * downloaded, highlights and offers download / restart. The detailed UpdateBanner
 * still appears at the top of the app when an update is available.
 */
export function CheckUpdatesButton({ language }: { language?: ResolvedLanguage }): ReactElement {
  const [status, setStatus] = useState<UpdaterStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    return window.ipc.subscribe<UpdaterEvent>(UPDATE_CHANNELS.status, (payload) => {
      if (isUpdaterEvent(payload)) setStatus(payload.status)
    })
  }, [])

  const state = status?.state
  const checking = state === 'checking'
  const downloading = state === 'downloading'
  const available = state === 'available'
  const downloaded = state === 'downloaded'
  const highlight = available || downloading || downloaded

  const label = downloaded
    ? tt(language, 'chrome.update.install')
    : available || downloading
      ? tt(language, 'chrome.update.bannerTitle')
      : checking
        ? tt(language, 'about.update.checking')
        : tt(language, 'about.update.checkButton')

  const onClick = async (): Promise<void> => {
    setBusy(true)
    try {
      if (downloaded) {
        await window.ipc.invoke<UpdaterIpcResult>(UPDATE_CHANNELS.installNow)
      } else if (available) {
        await window.ipc.invoke<UpdaterIpcResult>(UPDATE_CHANNELS.download)
      } else {
        await window.ipc.invoke<UpdaterIpcResult>(UPDATE_CHANNELS.check)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      aria-label={tt(language, 'about.update.checkButton')}
      className={highlight ? 'check-updates-button is-available' : 'check-updates-button'}
      disabled={busy || checking || downloading}
      onClick={() => void onClick()}
      title={tt(language, 'about.update.checkButton')}
      type="button"
    >
      {label}
    </button>
  )
}
