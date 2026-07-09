import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { STREAMING_CHANNELS, type StreamingAccessMode, type StreamingStartResult, type StreamingStatus } from '../../../shared/streaming'

const ACCESS_LABELS: Record<StreamingAccessMode, string> = {
  local: 'This PC only (OBS/local browser)',
  lan: 'LAN / Wi-Fi (phone or tablet QR)',
  internet: 'Internet / tunnel or port-forward'
}

function statusAccessMode(status: StreamingStatus): StreamingAccessMode {
  return status.accessMode ?? (status.lanEnabled ? 'lan' : 'local')
}

function accessHelp(accessMode: StreamingAccessMode, publicBaseUrl: string): string {
  if (accessMode === 'internet') {
    return publicBaseUrl.trim()
      ? 'QR codes use your public/tunnel URL. Keep the token private and use a strong password.'
      : 'The server will listen on all interfaces, but internet access still needs a trusted tunnel or router port-forward plus Windows Firewall allow rule.'
  }
  if (accessMode === 'lan') {
    return 'Recommended for phones/tablets on the same Wi-Fi. QR codes use this PC LAN IPv4 instead of localhost.'
  }
  return 'Only this PC can connect. Phone/tablet QR codes will not work in this mode.'
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
  const [accessMode, setAccessMode] = useState<StreamingAccessMode>('lan')
  const [password, setPassword] = useState('')
  const [publicBaseUrl, setPublicBaseUrl] = useState('')
  const [status, setStatus] = useState<StreamingStatus | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

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
    try {
      await window.ipc.invoke<StreamingStartResult>(STREAMING_CHANNELS.start, {
        streamSafe,
        layoutId: 'default',
        accessMode,
        lanEnabled: accessMode !== 'local',
        publicBaseUrl: accessMode === 'internet' ? publicBaseUrl.trim() || undefined : undefined,
        password: password.trim() || undefined
      })
      setPassword('')
      await refreshStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start dashboard streaming')
    } finally {
      setBusy(false)
    }
  }

  async function stopStreaming(): Promise<void> {
    setBusy(true)
    setError(null)
    setCopied(null)
    try {
      const nextStatus = await window.ipc.invoke<StreamingStatus>(STREAMING_CHANNELS.stop)
      setStatus(nextStatus)
      setAccessMode('lan')
      setPublicBaseUrl('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop dashboard streaming')
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
      setError(err instanceof Error ? err.message : `Failed to copy ${label} URL`)
    }
  }

  useEffect(() => {
    void refreshStatus().catch(() => { /* streaming module may be unavailable during startup */ })
  }, [])

  const running = Boolean(status?.running)
  const accessDisabled = busy || running

  return (
    <section className="panel streaming-panel">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h4 style={{ margin: '0 0 8px', color: '#f6fbff' }}>Dashboard streaming</h4>
        <span className={running ? 'status-pill on' : 'status-pill'}>
          {running ? `online · ${status?.clients ?? 0} client(s)` : 'offline'}
        </span>
      </div>
      <p className="overlay-help">
        Starts a token-protected dashboard/touch-dash server for OBS, phones, and tablets. Use LAN mode for same-Wi-Fi devices; Internet mode requires a trusted tunnel or router port-forward.
      </p>
      {error ? <p className="overlay-help" style={{ color: 'var(--accent-danger, #fb7185)' }}>⚠ {error}</p> : null}
      {status?.warning ? (
        <p className="overlay-help" style={{ color: 'var(--accent-warning, #fbbf24)' }}>
          ⚠ {status.warning}
        </p>
      ) : null}
      <label className="designer-check" style={{ margin: '12px 0' }}>
        <input
          type="checkbox"
          checked={streamSafe}
          disabled={accessDisabled}
          onChange={(event) => setStreamSafe(event.target.checked)}
        />
        Stream-safe: hide names, iRating/SR, and private tags before sending to clients
      </label>
      <label className="designer-field" style={{ margin: '12px 0' }}>
        Network access
        <select
          value={accessMode}
          disabled={accessDisabled}
          onChange={(event) => setAccessMode(event.target.value as StreamingAccessMode)}
        >
          {Object.entries(ACCESS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <p className="overlay-help" style={{ marginTop: -4 }}>
        {accessHelp(accessMode, publicBaseUrl)}
      </p>
      {accessMode === 'internet' ? (
        <label className="designer-field" style={{ margin: '12px 0' }}>
          Public/tunnel base URL (optional; e.g. https://your-tunnel.example)
          <input
            value={publicBaseUrl}
            disabled={accessDisabled}
            placeholder="Leave blank to show the LAN URL and port"
            onChange={(event) => setPublicBaseUrl(event.target.value)}
          />
        </label>
      ) : null}
      <label className="designer-field" style={{ margin: '12px 0' }}>
        Optional password (alternative to token; not shown after starting)
        <input
          type="password"
          value={password}
          disabled={accessDisabled}
          placeholder="Optional"
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <div className="overlay-actions">
        <button className="primary-action" disabled={busy || running} onClick={() => void startStreaming()}>
          Start streaming
        </button>
        <button className="ghost-action danger" disabled={busy || !running} onClick={() => void stopStreaming()}>
          Stop
        </button>
        <button className="ghost-action" disabled={busy} onClick={() => void refreshStatus()}>
          Refresh status
        </button>
      </div>
      {status?.url ? (
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          {status.lanAddress ? <p className="overlay-help">Detected LAN IPv4: <strong>{status.lanAddress}</strong> · Port: <strong>{status.port}</strong></p> : null}
          <label className="designer-field">
            Dashboard URL
            <input readOnly value={status.url} onFocus={(event) => event.currentTarget.select()} />
          </label>
          {status.lanUrl && status.lanUrl !== status.url ? (
            <label className="designer-field">
              LAN dashboard URL
              <input readOnly value={status.lanUrl} onFocus={(event) => event.currentTarget.select()} />
            </label>
          ) : null}
          {status.touchUrl ? (
            <label className="designer-field">
              Touch Controls Dash URL
              <input readOnly value={status.touchUrl} onFocus={(event) => event.currentTarget.select()} />
            </label>
          ) : (
            <p className="overlay-help">Create a Touch Controls Dash to show the second QR/URL.</p>
          )}
          {(status.qrDataUrl || status.touchQrDataUrl) ? (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {status.qrDataUrl ? (
                <div>
                  <div className="overlay-help" style={{ marginBottom: 6 }}>QR dashboard</div>
                  <img src={status.qrDataUrl} alt="Dashboard QR" style={{ width: 152, height: 152, borderRadius: 12 }} />
                </div>
              ) : null}
              {status.touchQrDataUrl ? (
                <div>
                  <div className="overlay-help" style={{ marginBottom: 6 }}>QR Touch Controls</div>
                  <img src={status.touchQrDataUrl} alt="Touch Controls QR" style={{ width: 152, height: 152, borderRadius: 12 }} />
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="overlay-actions">
            <button className="ghost-action" onClick={() => void copyUrl('dashboard', status.url)}>
              {copied === 'dashboard' ? 'Copied ✓' : 'Copy dashboard'}
            </button>
            <button className="ghost-action" disabled={!status.touchUrl} onClick={() => void copyUrl('touch', status.touchUrl)}>
              {copied === 'touch' ? 'Copied ✓' : 'Copy Touch Controls'}
            </button>
            {status.lanUrl && status.lanUrl !== status.url ? (
              <button className="ghost-action" onClick={() => void copyUrl('lan', status.lanUrl)}>
                {copied === 'lan' ? 'Copied ✓' : 'Copy LAN URL'}
              </button>
            ) : null}
          </div>
          <div style={{ display: 'grid', gap: 6, marginTop: 4 }}>
            <p className="overlay-help" style={{ margin: 0 }}>
              Auth: token in URL{status.passwordEnabled ? ' + password enabled' : ''}. Keep links private.
            </p>
            {status.devices.length > 0 ? (
              <div>
                <div className="overlay-help" style={{ marginBottom: 6 }}>Connected devices</div>
                <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-muted)' }}>
                  {status.devices.map((device) => (
                    <li key={device.id}>{device.address} · {formatDeviceName(device.userAgent)}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="overlay-help" style={{ margin: 0 }}>No devices connected yet.</p>
            )}
          </div>
        </div>
      ) : (
        <p className="overlay-help" style={{ marginTop: 10 }}>
          After starting, tokenized URLs and QR codes will appear here.
        </p>
      )}
    </section>
  )
}
