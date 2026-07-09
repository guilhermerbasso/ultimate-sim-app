import { type ReactElement, useCallback, useEffect, useMemo, useState } from 'react'
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

function updateStatusText(status: UpdaterStatus, language: ResolvedLanguage | undefined): string {
  if (!status.enabled) return tt(language, 'about.update.installedOnly')
  if (status.state === 'checking') return tt(language, 'about.update.checking')
  if (status.state === 'available') return tt(language, 'about.update.available', { version: status.updateVersion ?? '' })
  if (status.state === 'downloading') return tt(language, 'about.update.downloading')
  if (status.state === 'downloaded') return tt(language, 'about.update.downloaded', { version: status.updateVersion ?? '' })
  if (status.state === 'not-available') return tt(language, 'about.update.notAvailable')
  if (status.state === 'error') return status.error ?? tt(language, 'about.update.checkFailed')
  return tt(language, 'about.update.idle')
}

/**
 * Self-contained updater panel (status + check/install). Extracted so it can sit
 * at the TOP of Settings and (optionally) in About with no duplicated logic.
 */
export function UpdatePanel({ language, currentVersion }: { language?: ResolvedLanguage; currentVersion: string }): ReactElement {
  const [status, setStatus] = useState<UpdaterStatus>({
    currentVersion,
    enabled: true,
    state: 'idle',
    downloaded: false
  })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const progress = Number.isFinite(status.progressPercent) ? Math.max(0, Math.min(100, Math.round(status.progressPercent as number))) : 0
  const statusText = useMemo(() => updateStatusText(status, language), [language, status])

  useEffect(() => {
    return window.ipc.subscribe<UpdaterEvent>(UPDATE_CHANNELS.status, (payload) => {
      if (isUpdaterEvent(payload)) {
        setStatus(payload.status)
        if (payload.event !== 'error') setActionError(null)
      }
    })
  }, [])

  const checkForUpdates = useCallback(async (): Promise<void> => {
    setBusy(true)
    setActionError(null)
    try {
      const checked = await window.ipc.invoke<UpdaterIpcResult>(UPDATE_CHANNELS.check)
      setStatus(checked.status)
      if (checked.ok && checked.status.state === 'available') {
        const downloaded = await window.ipc.invoke<UpdaterIpcResult>(UPDATE_CHANNELS.download)
        setStatus(downloaded.status)
        if (!downloaded.ok) setActionError(downloaded.message ?? downloaded.status.error ?? tt(language, 'about.update.downloadFailed'))
      } else if (!checked.ok) {
        setActionError(checked.message ?? checked.status.error ?? tt(language, 'about.update.checkFailed'))
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [language])

  const installNow = useCallback(async (): Promise<void> => {
    setBusy(true)
    setActionError(null)
    try {
      const result = await window.ipc.invoke<UpdaterIpcResult>(UPDATE_CHANNELS.installNow)
      setStatus(result.status)
      if (!result.ok) setActionError(result.message ?? result.status.error ?? tt(language, 'about.update.installFailed'))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [language])

  return (
    <section className="panel-card" style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <span className="field-label" style={{ margin: 0 }}>{tt(language, 'about.updates.eyebrow')}</span>
          <h2 style={{ margin: 0, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {tt(language, 'about.updates.title')}
          </h2>
        </div>
        <span className="field-label" style={{ margin: 0 }}>{tt(language, 'about.currentVersion', { version: status.currentVersion })}</span>
      </div>
      <p style={{ margin: 0, color: status.state === 'error' ? 'var(--danger)' : 'var(--text-secondary)', lineHeight: 1.55 }}>
        {statusText}
      </p>
      {(status.state === 'downloading' || status.state === 'downloaded') && (
        <div style={{ display: 'grid', gap: 6 }}>
          <div
            aria-label={tt(language, 'about.update.progressAria')}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={progress}
            role="progressbar"
            style={{ height: 8, borderRadius: 999, background: 'var(--surface-base)', overflow: 'hidden', border: '1px solid var(--border-subtle)' }}
          >
            <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent-primary)', transition: 'width 160ms ease' }} />
          </div>
          <span className="field-label" style={{ margin: 0 }}>{progress}%</span>
        </div>
      )}
      {actionError && <p style={{ margin: 0, color: 'var(--danger)', lineHeight: 1.45 }}>{actionError}</p>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="primary-button" type="button" onClick={() => void checkForUpdates()} disabled={busy || status.state === 'checking' || status.state === 'downloading'}>
          {tt(language, 'about.update.checkButton')}
        </button>
        {status.downloaded && (
          <button className="primary-button" type="button" onClick={() => void installNow()} disabled={busy}>
            {tt(language, 'about.update.installButton')}
          </button>
        )}
      </div>
    </section>
  )
}
