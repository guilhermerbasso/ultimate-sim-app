import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { STREAMING_CHANNELS, type StreamingAccessMode, type StreamingStartResult, type StreamingStatus } from '../../../shared/streaming'
import { tt } from '../i18n'

const ACCESS_LABELS: Record<StreamingAccessMode, string> = {
  local: tt(undefined, 'streaming.access.local'),
  lan: tt(undefined, 'streaming.access.lan'),
  internet: tt(undefined, 'streaming.access.internet')
}

function statusAccessMode(status: StreamingStatus): StreamingAccessMode {
  return status.accessMode ?? (status.lanEnabled ? 'lan' : 'local')
}

function accessHelp(accessMode: StreamingAccessMode, publicBaseUrl: string): string {
  if (accessMode === 'internet') {
    return publicBaseUrl.trim()
      ? tt(undefined, 'streaming.help.internetReady')
      : tt(undefined, 'streaming.help.internetNeedsUrl')
  }
  if (accessMode === 'lan') return tt(undefined, 'streaming.help.lan')
  return tt(undefined, 'streaming.help.local')
}

function formatDeviceName(userAgent: string | null): string {
  if (!userAgent) return 'Unknown browser'
  if (/iphone|ipad/i.test(userAgent)) return 'iOS Safari'
  if (/android/i.test(userAgent)) return 'Android browser'
  if (/edg\//i.test(userAgent)) return 'Microsoft Edge'
  if (/chrome/i.test(userAgent)) return 'Chrome'
  if (/firefox/i.test(userAgent)) return 'Firefox'
  if (/safari/i.test(userAgent)) return 'Safari'
  return userAgent.slice(0, 64)
}

export default function StreamingPanel(): ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [streamSafe, setStreamSafe] = useState(true)
  const [accessMode, setAccessMode] = useState<StreamingAccessMode>('local')
  const [password, setPassword] = useState('')
  const [publicBaseUrl, setPublicBaseUrl] = useState('')
  const [status, setStatus] = useState<StreamingStatus | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)

  async function refreshStatus(): Promise<void> {
    const nextStatus = await window.ipc.invoke<StreamingStatus>(STREAMING_CHANNELS.status)
    setStatus(nextStatus)
    setStreamSafe(nextStatus.streamSafe)
    setAccessMode(statusAccessMode(nextStatus))
    setPublicBaseUrl(nextStatus.publicBaseUrl ?? '')
  }

  async function startStreaming(): Promise<void> {
    setBusy(true)
    setError(null)
    setCopied(null)
    setTestResult(null)
    try {
      await window.ipc.invoke<StreamingStartResult>(STREAMING_CHANNELS.start, {
        streamSafe,
        layoutId: 'default',
        accessMode,
        lanEnabled: accessMode !== 'local',
        publicBaseUrl: accessMode === 'internet' ? publicBaseUrl.trim() || undefined : undefined,
        password: accessMode !== 'local' ? password.trim() || undefined : undefined
      })
      setPassword('')
      await refreshStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : tt(undefined, 'streaming.error.start'))
    } finally {
      setBusy(false)
    }
  }

  async function stopStreaming(): Promise<void> {
    setBusy(true)
    setError(null)
    setCopied(null)
    setTestResult(null)
    try {
      const nextStatus = await window.ipc.invoke<StreamingStatus>(STREAMING_CHANNELS.stop)
      setStatus(nextStatus)
      setAccessMode('local')
      setPublicBaseUrl('')
    } catch (err) {
      setError(err instanceof Error ? err.message : tt(undefined, 'streaming.error.stop'))
    } finally {
      setBusy(false)
    }
  }

  async function copyUrl(label: string, url: string | null | undefined): Promise<void> {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(label)
    } catch (err) {
      setError(err instanceof Error ? err.message : tt(undefined, 'streaming.error.copy', { label }))
    }
  }

  async function testFromThisPc(): Promise<void> {
    if (!status?.localTestUrl) return
    setTestResult(tt(undefined, 'streaming.test.running'))
    try {
      const response = await fetch(status.localTestUrl, { method: 'HEAD', cache: 'no-store' })
      setTestResult(response.ok ? tt(undefined, 'streaming.test.ok') : tt(undefined, 'streaming.test.bad', { status: response.status }))
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : tt(undefined, 'streaming.test.failed'))
    }
  }

  useEffect(() => {
    void refreshStatus().catch(() => { /* streaming module may be unavailable during startup */ })
  }, [])

  const running = Boolean(status?.running)
  const accessDisabled = busy || running
  const requiresPassword = accessMode !== 'local'
  const missingPassword = requiresPassword && !password.trim()
  const missingInternetUrl = accessMode === 'internet' && !publicBaseUrl.trim()

  return (
    <section className="panel streaming-panel">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h4 style={{ margin: '0 0 8px', color: '#f6fbff' }}>{tt(undefined, 'streaming.title')}</h4>
        <span className={running ? 'status-pill on' : 'status-pill'}>
          {running ? tt(undefined, 'streaming.status.online', { count: status?.clients ?? 0 }) : tt(undefined, 'streaming.status.offline')}
        </span>
      </div>
      <p className="overlay-help">{tt(undefined, 'streaming.summary')}</p>
      <p className="overlay-help" style={{ color: '#76f7bd', fontWeight: 800 }}>{tt(undefined, 'streaming.readOnly')}</p>
      {error ? <p className="overlay-help" style={{ color: 'var(--accent-danger, #fb7185)' }}>? {error}</p> : null}
      {status?.warning ? <p className="overlay-help" style={{ color: 'var(--accent-warning, #fbbf24)' }}>? {status.warning}</p> : null}
      <label className="designer-check" style={{ margin: '12px 0' }}>
        <input type="checkbox" checked={streamSafe} disabled={accessDisabled} onChange={(event) => setStreamSafe(event.target.checked)} />
        {tt(undefined, 'streaming.streamSafe')}
      </label>
      <label className="designer-field" style={{ margin: '12px 0' }}>
        {tt(undefined, 'streaming.networkAccess')}
        <select value={accessMode} disabled={accessDisabled} onChange={(event) => setAccessMode(event.target.value as StreamingAccessMode)}>
          {Object.entries(ACCESS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <p className="overlay-help" style={{ marginTop: -4 }}>{accessHelp(accessMode, publicBaseUrl)}</p>
      {accessMode === 'internet' ? (
        <label className="designer-field" style={{ margin: '12px 0' }}>
          {tt(undefined, 'streaming.publicUrl')}
          <input value={publicBaseUrl} disabled={accessDisabled} placeholder="https://your-tunnel.example" onChange={(event) => setPublicBaseUrl(event.target.value)} />
        </label>
      ) : null}
      <label className="designer-field" style={{ margin: '12px 0' }}>
        {requiresPassword ? tt(undefined, 'streaming.password.required') : tt(undefined, 'streaming.password.optional')}
        <input
          type="password"
          value={password}
          disabled={accessDisabled}
          placeholder={requiresPassword ? tt(undefined, 'streaming.password.placeholderRequired') : tt(undefined, 'streaming.password.placeholderOptional')}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <div className="overlay-actions">
        <button className="primary-action" disabled={busy || running || missingPassword || missingInternetUrl} onClick={() => void startStreaming()}>{tt(undefined, 'streaming.start')}</button>
        <button className="ghost-action danger" disabled={busy || !running} onClick={() => void stopStreaming()}>{tt(undefined, 'streaming.stop')}</button>
        <button className="ghost-action" disabled={busy} onClick={() => void refreshStatus()}>{tt(undefined, 'streaming.refresh')}</button>
      </div>
      {status?.url ? (
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          <p className="overlay-help">{tt(undefined, 'streaming.mode')}: <strong>{ACCESS_LABELS[statusAccessMode(status)]}</strong></p>
          {status.lanAddress ? <p className="overlay-help">{tt(undefined, 'streaming.lanDetected')}: <strong>{status.lanAddress}</strong> ? {tt(undefined, 'streaming.port')}: <strong>{status.port}</strong></p> : null}
          {status.firewallMessage ? <p className="overlay-help">? {status.firewallMessage}</p> : null}
          <label className="designer-field">
            {tt(undefined, 'streaming.dashboardUrl')}
            <input readOnly value={status.url} onFocus={(event) => event.currentTarget.select()} />
          </label>
          {status.lanUrl && status.lanUrl !== status.url ? (
            <label className="designer-field">
              {tt(undefined, 'streaming.lanUrl')}
              <input readOnly value={status.lanUrl} onFocus={(event) => event.currentTarget.select()} />
            </label>
          ) : null}
          {status.password ? (
            <label className="designer-field">
              {tt(undefined, 'streaming.currentPassword')}
              <input readOnly value={status.password} onFocus={(event) => event.currentTarget.select()} />
            </label>
          ) : null}
          {status.qrDataUrl ? (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div>
                <div className="overlay-help" style={{ marginBottom: 6 }}>{tt(undefined, 'streaming.qrDashboard')}</div>
                <img src={status.qrDataUrl} alt={tt(undefined, 'streaming.qrAlt')} style={{ width: 152, height: 152, borderRadius: 12 }} />
              </div>
            </div>
          ) : null}
          <div className="overlay-actions">
            <button className="ghost-action" onClick={() => void copyUrl('dashboard', status.url)}>{copied === 'dashboard' ? tt(undefined, 'streaming.copied') : tt(undefined, 'streaming.copyDashboard')}</button>
            {status.lanUrl && status.lanUrl !== status.url ? (
              <button className="ghost-action" onClick={() => void copyUrl('lan', status.lanUrl)}>{copied === 'lan' ? tt(undefined, 'streaming.copied') : tt(undefined, 'streaming.copyLan')}</button>
            ) : null}
            <button className="ghost-action" disabled={!status.localTestUrl} onClick={() => void testFromThisPc()}>{tt(undefined, 'streaming.test.button')}</button>
          </div>
          {testResult ? <p className="overlay-help" style={{ margin: 0 }}>{testResult}</p> : null}
          <div style={{ display: 'grid', gap: 6, marginTop: 4 }}>
            <p className="overlay-help" style={{ margin: 0 }}>{status.passwordEnabled ? tt(undefined, 'streaming.authTokenPassword') : tt(undefined, 'streaming.authToken')}</p>
            {status.devices.length > 0 ? (
              <div>
                <div className="overlay-help" style={{ marginBottom: 6 }}>{tt(undefined, 'streaming.connectedDevices')}</div>
                <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-muted)' }}>
                  {status.devices.map((device) => <li key={device.id}>{device.address} ? {formatDeviceName(device.userAgent)}</li>)}
                </ul>
              </div>
            ) : (
              <p className="overlay-help" style={{ margin: 0 }}>{tt(undefined, 'streaming.noDevices')}</p>
            )}
          </div>
        </div>
      ) : (
        <p className="overlay-help" style={{ marginTop: 10 }}>{tt(undefined, 'streaming.afterStart')}</p>
      )}
    </section>
  )
}
