import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import packageJson from '../../../../package.json'
import {
  UPDATE_CHANNELS,
  type UpdaterEvent,
  type UpdaterIpcResult,
  type UpdaterStatus
} from '../../../shared/updater'
import type { AppViewProps } from '../App'
import { tt } from '../i18n'

type CreditItem = {
  name: string
  license: string
  noteKey: string
}

const LIBRARIES: CreditItem[] = [
  { name: 'bonjour-service', license: 'MIT', noteKey: 'about.credit.bonjour' },
  { name: 'koffi', license: 'MIT', noteKey: 'about.credit.koffi' },
  { name: 'React', license: 'MIT', noteKey: 'about.credit.react' },
  { name: 'React DOM', license: 'MIT', noteKey: 'about.credit.reactDom' },
  { name: 'serialport', license: 'MIT', noteKey: 'about.credit.serialport' },
  { name: 'unzipper', license: 'MIT', noteKey: 'about.credit.unzipper' },
  { name: 'yaml', license: 'ISC', noteKey: 'about.credit.yaml' },
  { name: 'ws', license: 'MIT', noteKey: 'about.credit.ws' }
]

const FONTS: CreditItem[] = [
  { name: 'Rajdhani', license: 'SIL OFL 1.1', noteKey: 'about.credit.rajdhani' },
  { name: 'Instrument Sans', license: 'SIL OFL 1.1', noteKey: 'about.credit.instrumentSans' },
  { name: 'Barlow Condensed', license: 'SIL OFL 1.1', noteKey: 'about.credit.barlowCondensed' },
  { name: 'IBM Plex Mono', license: 'SIL OFL 1.1', noteKey: 'about.credit.ibmPlexMono' },
  { name: 'Michroma', license: 'SIL OFL 1.1', noteKey: 'about.credit.michroma' },
  { name: 'Chakra Petch', license: 'SIL OFL 1.1', noteKey: 'about.credit.chakraPetch' },
  { name: 'DSEG', license: 'SIL OFL 1.1', noteKey: 'about.credit.dseg' }
]

const TOOLS: CreditItem[] = [
  { name: 'avrdude', license: 'GNU GPL v2', noteKey: 'about.credit.avrdude' }
]

function CreditSection({ items, language, title }: { items: CreditItem[]; language: AppViewProps['language']; title: string }): ReactElement {
  return (
    <section className="panel-card" style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
        <h2 style={{ margin: 0, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {title}
        </h2>
        <span className="field-label" style={{ margin: 0 }}>{tt(language, 'about.itemsCount', { count: items.length })}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        {items.map((item) => (
          <article
            key={item.name}
            className="mode-card"
            style={{
              display: 'grid',
              gap: 8,
              alignContent: 'start',
              minHeight: 126,
              borderColor: 'var(--border-default)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'start' }}>
              <strong style={{ color: 'var(--text-primary)' }}>{item.name}</strong>
              <span
                style={{
                  padding: '3px 7px',
                  borderRadius: '999px',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--accent-primary)',
                  background: 'var(--accent-primary-dim)',
                  fontSize: 11,
                  whiteSpace: 'nowrap'
                }}
              >
                {item.license}
              </span>
            </div>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.45 }}>{tt(language, item.noteKey)}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

function updateStatusText(status: UpdaterStatus, language: AppViewProps['language']): string {
  if (!status.enabled) return tt(language, 'about.update.installedOnly')
  if (status.state === 'checking') return tt(language, 'about.update.checking')
  if (status.state === 'available') return tt(language, 'about.update.available', { version: status.updateVersion ?? '' })
  if (status.state === 'downloading') return tt(language, 'about.update.downloading')
  if (status.state === 'downloaded') return tt(language, 'about.update.downloaded', { version: status.updateVersion ?? '' })
  if (status.state === 'not-available') return tt(language, 'about.update.notAvailable')
  if (status.state === 'error') return status.error ?? tt(language, 'about.update.checkFailed')
  return tt(language, 'about.update.idle')
}

function isUpdaterEvent(value: unknown): value is UpdaterEvent {
  return Boolean(value && typeof value === 'object' && 'event' in value && 'status' in value)
}

export default function AboutView({ language }: AppViewProps): ReactElement {
  const appName = packageJson.name
  const appVersion = packageJson.version
  const [status, setStatus] = useState<UpdaterStatus>({
    currentVersion: appVersion,
    enabled: true,
    state: 'idle',
    downloaded: false
  })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const progress = Math.round(status.progressPercent ?? 0)
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
    <div style={{ display: 'grid', gap: 16, minHeight: 0 }}>
      <section
        className="panel-card"
        style={{
          position: 'relative',
          overflow: 'hidden',
          display: 'grid',
          gap: 16,
          padding: 24,
          borderColor: 'var(--border-strong)',
          background:
            'linear-gradient(135deg, var(--surface-raised), color-mix(in srgb, var(--accent-primary) 12%, var(--surface-base)))'
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 'auto -60px -100px auto',
            width: 220,
            height: 220,
            borderRadius: '999px',
            background: 'radial-gradient(circle, var(--accent-primary) 0%, transparent 62%)',
            opacity: 0.18
          }}
        />
        <div style={{ position: 'relative', display: 'grid', gap: 8 }}>
          <span className="field-label" style={{ margin: 0 }}>{tt(language, 'about.eyebrow')}</span>
          <h1 style={{ margin: 0, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 42, letterSpacing: '0.04em' }}>
            {appName}
          </h1>
          <p style={{ margin: 0, color: 'var(--text-secondary)', maxWidth: 760, lineHeight: 1.6 }}>
            {tt(language, 'about.summary', { version: appVersion })}
            {' '}
            {tt(language, 'about.licensePrefix')} <code>THIRD-PARTY-LICENSES.md</code> {tt(language, 'about.licenseMiddle')} <code>src/renderer/src/assets/fonts/LICENSES/</code>{tt(language, 'about.licenseSuffix')}
          </p>
        </div>
      </section>

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

      <CreditSection title={tt(language, 'about.libraries.title')} items={LIBRARIES} language={language} />
      <CreditSection title={tt(language, 'about.fonts.title')} items={FONTS} language={language} />
      <CreditSection title={tt(language, 'about.tools.title')} items={TOOLS} language={language} />

      <section className="panel-card" style={{ display: 'grid', gap: 8 }}>
        <span className="field-label" style={{ margin: 0 }}>{tt(language, 'about.compliance.title')}</span>
        <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          {tt(language, 'about.compliance.body')}
        </p>
      </section>
    </div>
  )
}
