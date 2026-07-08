import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import packageJson from '../../../../package.json'
import {
  UPDATE_CHANNELS,
  type UpdaterEvent,
  type UpdaterIpcResult,
  type UpdaterStatus
} from '../../../shared/updater'

type CreditItem = {
  name: string
  license: string
  note: string
}

const LIBRARIES: CreditItem[] = [
  { name: 'bonjour-service', license: 'MIT', note: 'Local network service discovery.' },
  { name: 'koffi', license: 'MIT', note: 'FFI for native integrations.' },
  { name: 'React', license: 'MIT', note: 'UI renderer.' },
  { name: 'React DOM', license: 'MIT', note: 'DOM rendering.' },
  { name: 'serialport', license: 'MIT', note: 'Serial communication with hardware.' },
  { name: 'unzipper', license: 'MIT', note: 'ZIP package reading.' },
  { name: 'yaml', license: 'ISC', note: 'YAML parsing and writing.' },
  { name: 'ws', license: 'MIT', note: 'WebSocket client/server.' }
]

const FONTS: CreditItem[] = [
  { name: 'Rajdhani', license: 'SIL OFL 1.1', note: 'Interface typography and headings.' },
  { name: 'Instrument Sans', license: 'SIL OFL 1.1', note: 'Interface body text.' },
  { name: 'Barlow Condensed', license: 'SIL OFL 1.1', note: 'Compact headlines.' },
  { name: 'IBM Plex Mono', license: 'SIL OFL 1.1', note: 'Technical data and code.' },
  { name: 'Michroma', license: 'SIL OFL 1.1', note: 'Futuristic display type.' },
  { name: 'Chakra Petch', license: 'SIL OFL 1.1', note: 'Racing labels.' },
  { name: 'DSEG', license: 'SIL OFL 1.1', note: 'DSEG7 and DSEG14 digital displays.' }
]

const TOOLS: CreditItem[] = [
  { name: 'avrdude', license: 'GNU GPL v2', note: 'Firmware uploads for AVR boards.' }
]

function CreditSection({ items, title }: { items: CreditItem[]; title: string }): ReactElement {
  return (
    <section className="panel-card" style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
        <h2 style={{ margin: 0, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {title}
        </h2>
        <span className="field-label" style={{ margin: 0 }}>{items.length} items</span>
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
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.45 }}>{item.note}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

function updateStatusText(status: UpdaterStatus): string {
  if (!status.enabled) return 'Automatic updates are active only in the installed app build.'
  if (status.state === 'checking') return 'Checking GitHub Releases for updates...'
  if (status.state === 'available') return `Update ${status.updateVersion ?? ''} available. Preparing download...`
  if (status.state === 'downloading') return 'Downloading update...'
  if (status.state === 'downloaded') return `Update ${status.updateVersion ?? ''} ready to install.`
  if (status.state === 'not-available') return 'You are already using the latest version.'
  if (status.state === 'error') return status.error ?? 'Could not check for updates.'
  return 'Click to check for updates now.'
}

function isUpdaterEvent(value: unknown): value is UpdaterEvent {
  return Boolean(value && typeof value === 'object' && 'event' in value && 'status' in value)
}

export default function AboutView(): ReactElement {
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
  const statusText = useMemo(() => updateStatusText(status), [status])

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
        if (!downloaded.ok) setActionError(downloaded.message ?? downloaded.status.error ?? 'Failed to download update.')
      } else if (!checked.ok) {
        setActionError(checked.message ?? checked.status.error ?? 'Failed to check for updates.')
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [])

  const installNow = useCallback(async (): Promise<void> => {
    setBusy(true)
    setActionError(null)
    try {
      const result = await window.ipc.invoke<UpdaterIpcResult>(UPDATE_CHANNELS.installNow)
      setStatus(result.status)
      if (!result.ok) setActionError(result.message ?? result.status.error ?? 'Failed to start installation.')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [])

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
          <span className="field-label" style={{ margin: 0 }}>About / Credits</span>
          <h1 style={{ margin: 0, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 42, letterSpacing: '0.04em' }}>
            {appName}
          </h1>
          <p style={{ margin: 0, color: 'var(--text-secondary)', maxWidth: 760, lineHeight: 1.6 }}>
            Version {appVersion}. This app uses open-source components, redistributable fonts, and firmware tools.
            Full license texts are in <code>THIRD-PARTY-LICENSES.md</code> and <code>src/renderer/src/assets/fonts/LICENSES/</code>.
          </p>
        </div>
      </section>

      <section className="panel-card" style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 4 }}>
            <span className="field-label" style={{ margin: 0 }}>Updates</span>
            <h2 style={{ margin: 0, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Updates
            </h2>
          </div>
          <span className="field-label" style={{ margin: 0 }}>Current version {status.currentVersion}</span>
        </div>
        <p style={{ margin: 0, color: status.state === 'error' ? 'var(--danger)' : 'var(--text-secondary)', lineHeight: 1.55 }}>
          {statusText}
        </p>
        {(status.state === 'downloading' || status.state === 'downloaded') && (
          <div style={{ display: 'grid', gap: 6 }}>
            <div
              aria-label="Update download progress"
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
            Check for updates
          </button>
          {status.downloaded && (
            <button className="primary-button" type="button" onClick={() => void installNow()} disabled={busy}>
              Install and restart
            </button>
          )}
        </div>
      </section>

      <CreditSection title="Production libraries" items={LIBRARIES} />
      <CreditSection title="Bundled fonts" items={FONTS} />
      <CreditSection title="Bundled tools" items={TOOLS} />

      <section className="panel-card" style={{ display: 'grid', gap: 8 }}>
        <span className="field-label" style={{ margin: 0 }}>Compliance</span>
        <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          DSEG7Classic-Regular.ttf and DSEG14Classic-Regular.ttf were obtained from the official keshikan/DSEG release
          and distributed under SIL OFL 1.1. avrdude is redistributed under GPL v2 with source-code links/offers
          documented in the third-party license file.
        </p>
      </section>
    </div>
  )
}
