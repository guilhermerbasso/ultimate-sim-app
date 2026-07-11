import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactElement } from 'react'
import type { DashboardSummary } from '../../../shared/dashboards'
import type { ButtonBoxSummary } from '../../../shared/touch-panel'
import { STREAMING_CHANNELS, type StreamingAccessMode, type StreamingLayoutKind, type StreamingSelfTestResult, type StreamingStartResult, type StreamingStatus } from '../../../shared/streaming'
import { tt, type ResolvedLanguage } from '../i18n'

interface StreamTargetOption {
  kind: StreamingLayoutKind
  id: string
  label: string
  hidden?: boolean
}

interface StreamTargetComboboxProps {
  options: StreamTargetOption[]
  value: string
  disabled: boolean
  language?: ResolvedLanguage
  onChange(value: string): void
}

function streamTargetValue(option: StreamTargetOption): string {
  return `${option.kind}:${option.id}`
}

function StreamTargetCombobox({ options, value, disabled, language, onChange }: StreamTargetComboboxProps): ReactElement {
  const inputId = useId()
  const listboxId = `${inputId}-listbox`
  const rootRef = useRef<HTMLDivElement>(null)
  const selectedOption = options.find((option) => streamTargetValue(option) === value)
  const [query, setQuery] = useState(selectedOption?.label ?? '')
  const [open, setOpen] = useState(false)
  const [filtering, setFiltering] = useState(false)
  const [highlight, setHighlight] = useState(0)

  const results = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!filtering || !normalizedQuery) return options
    return options.filter((option) => option.label.toLocaleLowerCase().includes(normalizedQuery))
  }, [filtering, options, query])

  useEffect(() => {
    setQuery(selectedOption?.label ?? '')
    setFiltering(false)
  }, [selectedOption?.label, value])

  useEffect(() => {
    setHighlight((current) => Math.min(current, Math.max(0, results.length - 1)))
  }, [results.length])

  useEffect(() => {
    if (!open || !results[highlight]) return
    document.getElementById(optionId(highlight))?.scrollIntoView?.({ block: 'nearest' })
  }, [highlight, open, results])

  function optionId(index: number): string {
    return `${listboxId}-option-${index}`
  }

  function restoreSelection(): void {
    setQuery(selectedOption?.label ?? '')
    setFiltering(false)
    setOpen(false)
  }

  function openList(): void {
    const selectedIndex = options.findIndex((option) => streamTargetValue(option) === value)
    setQuery(selectedOption?.label ?? '')
    setFiltering(false)
    setHighlight(selectedIndex >= 0 ? selectedIndex : 0)
    setOpen(true)
  }

  function selectOption(option: StreamTargetOption): void {
    onChange(streamTargetValue(option))
    setQuery(option.label)
    setFiltering(false)
    setOpen(false)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) openList()
      else setHighlight((current) => Math.min(current + 1, Math.max(0, results.length - 1)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) openList()
      else setHighlight((current) => Math.max(0, current - 1))
    } else if (event.key === 'Home' && open) {
      event.preventDefault()
      setHighlight(0)
    } else if (event.key === 'End' && open) {
      event.preventDefault()
      setHighlight(Math.max(0, results.length - 1))
    } else if (event.key === 'Enter' && open) {
      event.preventDefault()
      const option = results[highlight]
      if (option) selectOption(option)
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      restoreSelection()
    } else if (event.key === 'Tab' && open) {
      restoreSelection()
    }
  }

  const activeOptionId = open && results[highlight] ? optionId(highlight) : undefined

  return (
    <div
      ref={rootRef}
      className="designer-field"
      style={targetComboboxStyle}
      onBlur={(event) => {
        const nextFocus = event.relatedTarget
        if (!nextFocus || !rootRef.current?.contains(nextFocus as Node)) restoreSelection()
      }}
    >
      <label htmlFor={inputId}>{tt(language, 'streaming.target.label')}</label>
      <input
        id={inputId}
        type="search"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        aria-label={tt(language, 'streaming.target.search')}
        value={query}
        disabled={disabled}
        placeholder={options.length > 0 ? tt(language, 'streaming.target.search') : tt(language, 'streaming.target.none')}
        onFocus={(event) => {
          openList()
          event.currentTarget.select()
        }}
        onChange={(event) => {
          setQuery(event.target.value)
          setFiltering(true)
          setHighlight(0)
          setOpen(true)
        }}
        onKeyDown={handleKeyDown}
      />
      {open && !disabled ? (
        <ul id={listboxId} role="listbox" style={targetListStyle}>
          {results.length === 0 ? (
            <li style={targetEmptyStyle}>{tt(language, 'streaming.target.noResults')}</li>
          ) : results.map((option, index) => {
            const optionValue = streamTargetValue(option)
            const selected = optionValue === value
            const highlighted = index === highlight
            return (
              <li
                id={optionId(index)}
                key={optionValue}
                role="option"
                aria-selected={selected}
                style={{
                  ...targetOptionStyle,
                  ...(highlighted ? targetOptionHighlightStyle : {}),
                  ...(selected ? targetOptionSelectedStyle : {})
                }}
                onMouseEnter={() => setHighlight(index)}
                onMouseDown={(event) => {
                  event.preventDefault()
                  selectOption(option)
                }}
                onClick={() => selectOption(option)}
              >
                <span>{option.label}{option.hidden ? ` ${tt(language, 'streaming.target.hidden')}` : ''}</span>
                <small style={targetKindStyle}>
                  {tt(language, option.kind === 'touch' ? 'streaming.target.touch' : 'streaming.target.dashboard')}
                </small>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

function statusAccessMode(status: StreamingStatus): StreamingAccessMode {
  return status.accessMode ?? (status.lanEnabled ? 'lan' : 'local')
}

function accessHelp(
  language: ResolvedLanguage | undefined,
  accessMode: StreamingAccessMode,
  publicBaseUrl: string,
  autoTunnel: boolean,
  autoTunnelAvailable: boolean
): string {
  if (accessMode === 'internet') {
    if (autoTunnel) {
      return autoTunnelAvailable
        ? tt(language, 'streaming.help.internetAuto')
        : tt(language, 'streaming.help.internetAutoUnavailable')
    }
    return publicBaseUrl.trim()
      ? tt(language, 'streaming.help.internetReady')
      : tt(language, 'streaming.help.internetNeedsUrl')
  }
  if (accessMode === 'lan') return tt(language, 'streaming.help.lan')
  return tt(language, 'streaming.help.local')
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

export default function StreamingPanel({ language }: { language?: ResolvedLanguage }): ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [streamSafe, setStreamSafe] = useState(true)
  const [accessMode, setAccessMode] = useState<StreamingAccessMode>('local')
  const [password, setPassword] = useState('')
  const [publicBaseUrl, setPublicBaseUrl] = useState('')
  const [autoTunnel, setAutoTunnel] = useState(false)
  const [status, setStatus] = useState<StreamingStatus | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [dashboards, setDashboards] = useState<DashboardSummary[]>([])
  const [touchPanels, setTouchPanels] = useState<ButtonBoxSummary[]>([])
  const [selectedTarget, setSelectedTarget] = useState<string>('')

  const ACCESS_LABELS: Record<StreamingAccessMode, string> = {
    local: tt(language, 'streaming.access.local'),
    lan: tt(language, 'streaming.access.lan'),
    internet: tt(language, 'streaming.access.internet')
  }

  async function refreshStatus(): Promise<void> {
    const nextStatus = await window.ipc.invoke<StreamingStatus>(STREAMING_CHANNELS.status)
    setStatus(nextStatus)
    setStreamSafe(nextStatus.streamSafe)
    setAccessMode(statusAccessMode(nextStatus))
    setPublicBaseUrl(nextStatus.publicBaseUrl ?? '')
    setAutoTunnel(nextStatus.autoTunnelEnabled)
    if (nextStatus.running && nextStatus.layoutId) {
      setSelectedTarget(`${nextStatus.layoutKind ?? 'dashboard'}:${nextStatus.layoutId}`)
    }
  }

  async function refreshTargets(): Promise<void> {
    const [dashList, touchList, openList] = await Promise.all([
      window.ipc.invoke<DashboardSummary[]>('app:dash:list').catch(() => [] as DashboardSummary[]),
      window.ipc.invoke<ButtonBoxSummary[]>('app:touchpanel:list').catch(() => [] as ButtonBoxSummary[]),
      window.ipc.invoke<Array<{ id: string }>>('app:dash:listOpen').catch(() => [] as Array<{ id: string }>)
    ])
    setDashboards(dashList)
    setTouchPanels(touchList)
    setSelectedTarget((current) => {
      if (current) {
        const [kind, id] = current.split(':', 2)
        const stillExists = kind === 'touch'
          ? touchList.some((panel) => panel.id === id)
          : dashList.some((dash) => dash.id === id)
        if (stillExists) return current
      }
      const runningKind = status?.layoutKind ?? 'dashboard'
      const runningId = status?.layoutId
      const runningTargetExists = runningKind === 'touch'
        ? touchList.some((panel) => panel.id === runningId)
        : dashList.some((dash) => dash.id === runningId)
      if (runningId && runningTargetExists) return `${runningKind}:${runningId}`
      const open = openList.find((item) => dashList.some((dash) => dash.id === item.id))
      const fallback = open?.id ?? dashList.find((dash) => !dash.hidden)?.id ?? dashList[0]?.id
      return fallback ? `dashboard:${fallback}` : ''
    })
  }

  async function startStreaming(): Promise<void> {
    setBusy(true)
    setError(null)
    setCopied(null)
    setTestResult(null)
    try {
      const [layoutKind, layoutId] = selectedTarget.split(':', 2) as [StreamingLayoutKind | undefined, string | undefined]
      await window.ipc.invoke<StreamingStartResult>(STREAMING_CHANNELS.start, {
        streamSafe,
        layoutKind: layoutKind === 'touch' ? 'touch' : 'dashboard',
        layoutId,
        touchPanelId: layoutKind === 'touch' ? layoutId : undefined,
        accessMode,
        lanEnabled: accessMode !== 'local',
        publicBaseUrl: accessMode === 'internet' ? publicBaseUrl.trim() || undefined : undefined,
        password: accessMode !== 'local' ? password.trim() || undefined : undefined,
        autoTunnel: accessMode === 'internet' && autoTunnel
      })
      setPassword('')
      await refreshStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : tt(language, 'streaming.error.start'))
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
      setAutoTunnel(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : tt(language, 'streaming.error.stop'))
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
      setError(err instanceof Error ? err.message : tt(language, 'streaming.error.copy', { label }))
    }
  }

  async function testFromThisPc(): Promise<void> {
    if (!status?.localTestUrl) return
    setTestResult(tt(language, 'streaming.test.running'))
    try {
      const result = await window.ipc.invoke<StreamingSelfTestResult>(STREAMING_CHANNELS.selfTest)
      setTestResult(result.reachable ? `${tt(language, 'streaming.test.ok')} ${result.message}` : result.message)
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : tt(language, 'streaming.test.failed'))
    }
  }

  async function changeAutoTunnel(enabled: boolean): Promise<void> {
    if (!status?.running) {
      setAutoTunnel(enabled)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const nextStatus = await window.ipc.invoke<StreamingStatus>(
        enabled ? STREAMING_CHANNELS.startTunnel : STREAMING_CHANNELS.stopTunnel
      )
      setStatus(nextStatus)
      setAutoTunnel(nextStatus.autoTunnelEnabled)
      setPublicBaseUrl(nextStatus.publicBaseUrl ?? '')
    } catch (err) {
      setError(err instanceof Error ? err.message : tt(language, 'streaming.error.tunnel'))
      setAutoTunnel(status.autoTunnelEnabled)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refreshStatus().catch(() => { /* streaming module may be unavailable during startup */ })
    void refreshTargets().catch(() => undefined)
  }, [])

  const running = Boolean(status?.running)
  const accessDisabled = busy || running
  const requiresPassword = accessMode !== 'local'
  const missingPassword = requiresPassword && !password.trim()
  const autoTunnelAvailable = status?.autoTunnelAvailable ?? false
  const missingInternetUrl = accessMode === 'internet' &&
    !publicBaseUrl.trim() &&
    (!autoTunnel || !autoTunnelAvailable)
  const targetOptions = useMemo<StreamTargetOption[]>(() => [
    ...dashboards.map((dash) => ({ kind: 'dashboard' as const, id: dash.id, label: dash.name, hidden: dash.hidden })),
    ...touchPanels.map((panel) => ({ kind: 'touch' as const, id: panel.id, label: panel.name, hidden: panel.hidden }))
  ], [dashboards, touchPanels])
  const missingTarget = !targetOptions.some((option) => streamTargetValue(option) === selectedTarget)

  return (
    <section className="panel streaming-panel">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h4 style={{ margin: '0 0 8px', color: '#f6fbff' }}>{tt(language, 'streaming.title')}</h4>
        <span className={running ? 'status-pill on' : 'status-pill'}>
          {running ? tt(language, 'streaming.status.online', { count: status?.clients ?? 0 }) : tt(language, 'streaming.status.offline')}
        </span>
      </div>
      <p className="overlay-help">{tt(language, 'streaming.summary')}</p>
      <p className="overlay-help" style={{ color: '#76f7bd', fontWeight: 800 }}>{tt(language, 'streaming.readOnly')}</p>
      {error ? <p className="overlay-help" style={{ color: 'var(--accent-danger, #fb7185)' }}>? {error}</p> : null}
      {status?.warning ? <p className="overlay-help" style={{ color: 'var(--accent-warning, #fbbf24)' }}>? {status.warning}</p> : null}
      <label className="designer-check" style={{ margin: '12px 0' }}>
        <input type="checkbox" checked={streamSafe} disabled={accessDisabled} onChange={(event) => setStreamSafe(event.target.checked)} />
        {tt(language, 'streaming.streamSafe')}
      </label>
      <StreamTargetCombobox
        options={targetOptions}
        value={selectedTarget}
        disabled={accessDisabled || targetOptions.length === 0}
        language={language}
        onChange={setSelectedTarget}
      />
      <label className="designer-field" style={{ margin: '12px 0' }}>
        {tt(language, 'streaming.networkAccess')}
        <select
          value={accessMode}
          disabled={accessDisabled}
          onChange={(event) => {
            const nextMode = event.target.value as StreamingAccessMode
            setAccessMode(nextMode)
            if (nextMode !== 'internet') setAutoTunnel(false)
          }}
        >
          {Object.entries(ACCESS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <p className="overlay-help" style={{ marginTop: -4 }}>
        {accessHelp(language, accessMode, publicBaseUrl, autoTunnel, autoTunnelAvailable)}
      </p>
      {accessMode === 'internet' ? (
        <>
          <label className="designer-check" style={{ margin: '12px 0' }}>
            <input
              type="checkbox"
              checked={autoTunnel}
              disabled={busy}
              onChange={(event) => void changeAutoTunnel(event.target.checked)}
            />
            {tt(language, 'streaming.autoTunnel')}
          </label>
          <p className="overlay-help" style={{ marginTop: -6 }}>
            {autoTunnelAvailable
              ? tt(language, 'streaming.autoTunnelHelp')
              : tt(language, 'streaming.autoTunnelUnavailable')}
          </p>
          {status?.autoTunnelMessage ? (
            <p
              className="overlay-help"
              style={{ color: status.autoTunnelRunning ? '#76f7bd' : 'var(--accent-warning, #fbbf24)' }}
            >
              {status.autoTunnelMessage}
            </p>
          ) : null}
          <label className="designer-field" style={{ margin: '12px 0' }}>
            {autoTunnel ? tt(language, 'streaming.publicUrlFallback') : tt(language, 'streaming.publicUrl')}
            <input
              value={publicBaseUrl}
              disabled={accessDisabled}
              placeholder="https://your-tunnel.example"
              onChange={(event) => setPublicBaseUrl(event.target.value)}
            />
          </label>
        </>
      ) : null}
      <label className="designer-field" style={{ margin: '12px 0' }}>
        {requiresPassword ? tt(language, 'streaming.password.required') : tt(language, 'streaming.password.optional')}
        <input
          type="password"
          value={password}
          disabled={accessDisabled}
          placeholder={requiresPassword ? tt(language, 'streaming.password.placeholderRequired') : tt(language, 'streaming.password.placeholderOptional')}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <div className="overlay-actions">
        <button className="primary-action" disabled={busy || running || missingPassword || missingInternetUrl || missingTarget} onClick={() => void startStreaming()}>{tt(language, 'streaming.start')}</button>
        <button className="ghost-action danger" disabled={busy || !running} onClick={() => void stopStreaming()}>{tt(language, 'streaming.stop')}</button>
        <button className="ghost-action" disabled={busy} onClick={() => void refreshStatus()}>{tt(language, 'streaming.refresh')}</button>
      </div>
      {status?.url ? (
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          <p className="overlay-help">{tt(language, 'streaming.mode')}: <strong>{ACCESS_LABELS[statusAccessMode(status)]}</strong></p>
          {status.lanAddress ? <p className="overlay-help">{tt(language, 'streaming.lanDetected')}: <strong>{status.lanAddress}</strong> ? {tt(language, 'streaming.port')}: <strong>{status.port}</strong></p> : null}
          {status.firewallMessage ? <p className="overlay-help">? {status.firewallMessage}</p> : null}
          <label className="designer-field">
            {tt(language, 'streaming.dashboardUrl')}
            <input readOnly value={status.url} onFocus={(event) => event.currentTarget.select()} />
          </label>
          {status.lanUrl && status.lanUrl !== status.url ? (
            <label className="designer-field">
              {tt(language, 'streaming.lanUrl')}
              <input readOnly value={status.lanUrl} onFocus={(event) => event.currentTarget.select()} />
            </label>
          ) : null}
          {status.password ? (
            <label className="designer-field">
              {tt(language, 'streaming.currentPassword')}
              <input readOnly value={status.password} onFocus={(event) => event.currentTarget.select()} />
            </label>
          ) : null}
          {status.qrDataUrl ? (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div>
                <div className="overlay-help" style={{ marginBottom: 6 }}>{tt(language, 'streaming.qrDashboard')}</div>
                <img src={status.qrDataUrl} alt={tt(language, 'streaming.qrAlt')} style={{ width: 152, height: 152, borderRadius: 12 }} />
              </div>
            </div>
          ) : null}
          <div className="overlay-actions">
            <button className="ghost-action" onClick={() => void copyUrl('dashboard', status.url)}>{copied === 'dashboard' ? tt(language, 'streaming.copied') : tt(language, 'streaming.copyDashboard')}</button>
            {status.lanUrl && status.lanUrl !== status.url ? (
              <button className="ghost-action" onClick={() => void copyUrl('lan', status.lanUrl)}>{copied === 'lan' ? tt(language, 'streaming.copied') : tt(language, 'streaming.copyLan')}</button>
            ) : null}
            <button className="ghost-action" disabled={!status.localTestUrl} onClick={() => void testFromThisPc()}>{tt(language, 'streaming.test.button')}</button>
          </div>
          {testResult ? <p className="overlay-help" style={{ margin: 0 }}>{testResult}</p> : null}
          <div style={{ display: 'grid', gap: 6, marginTop: 4 }}>
            <p className="overlay-help" style={{ margin: 0 }}>{status.passwordEnabled ? tt(language, 'streaming.authTokenPassword') : tt(language, 'streaming.authToken')}</p>
            {status.devices.length > 0 ? (
              <div>
                <div className="overlay-help" style={{ marginBottom: 6 }}>{tt(language, 'streaming.connectedDevices')}</div>
                <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-muted)' }}>
                  {status.devices.map((device) => <li key={device.id}>{device.address} ? {formatDeviceName(device.userAgent)}</li>)}
                </ul>
              </div>
            ) : (
              <p className="overlay-help" style={{ margin: 0 }}>{tt(language, 'streaming.noDevices')}</p>
            )}
          </div>
        </div>
      ) : (
        <p className="overlay-help" style={{ marginTop: 10 }}>{tt(language, 'streaming.afterStart')}</p>
      )}
    </section>
  )
}

const targetComboboxStyle: CSSProperties = {
  position: 'relative',
  display: 'grid',
  gap: 6,
  margin: '12px 0'
}

const targetListStyle: CSSProperties = {
  position: 'absolute',
  zIndex: 20,
  top: '100%',
  left: 0,
  right: 0,
  maxHeight: 240,
  overflowY: 'auto',
  margin: '4px 0 0',
  padding: 4,
  listStyle: 'none',
  border: '1px solid var(--border-default)',
  borderRadius: 10,
  background: 'var(--surface-base)',
  boxShadow: '0 14px 32px rgba(0, 0, 0, 0.35)'
}

const targetOptionStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '8px 10px',
  borderRadius: 7,
  color: 'var(--text-primary)',
  cursor: 'pointer'
}

const targetOptionHighlightStyle: CSSProperties = {
  background: 'var(--surface-raised, rgba(255, 255, 255, 0.08))'
}

const targetOptionSelectedStyle: CSSProperties = {
  color: 'var(--accent-primary, #76f7bd)',
  fontWeight: 700
}

const targetKindStyle: CSSProperties = {
  color: 'var(--text-muted)',
  fontWeight: 500,
  whiteSpace: 'nowrap'
}

const targetEmptyStyle: CSSProperties = {
  padding: '10px',
  color: 'var(--text-muted)'
}
