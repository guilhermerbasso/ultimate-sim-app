import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import {
  OBS_LOCAL_CHANNELS,
  type ObsLocalCommand,
  type ObsLocalCommandResult,
  type ObsLocalStatus
} from '../../../shared/obs-local'
import {
  STREAM_SOURCE_CHANNELS,
  type StreamSourceDescriptor
} from '../../../shared/stream-sources'
import { tt, type ResolvedLanguage } from '../i18n'

function requestId(): string {
  return globalThis.crypto.randomUUID()
}

function parsePort(value: string, invalidMessage: string): number | undefined {
  if (!value.trim()) return undefined
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(invalidMessage)
  }
  return port
}

function command(
  sceneName: string,
  operation: ObsLocalCommand['operation']
): ObsLocalCommand {
  return {
    requestId: requestId(),
    issuedAtMs: Date.now(),
    sceneName: sceneName.trim(),
    operation
  }
}

export default function ObsLocalPanel({ language }: { language?: ResolvedLanguage }): ReactElement {
  const [status, setStatus] = useState<ObsLocalStatus | null>(null)
  const [dashboards, setDashboards] = useState<StreamSourceDescriptor[]>([])
  const [layoutId, setLayoutId] = useState('')
  const [feedPort, setFeedPort] = useState('')
  const [host, setHost] = useState('127.0.0.1')
  const [controlPort, setControlPort] = useState('4455')
  const [password, setPassword] = useState('')
  const [sceneName, setSceneName] = useState('')
  const [sources, setSources] = useState('')
  const [allowNonLoopback, setAllowNonLoopback] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [undoRequestId, setUndoRequestId] = useState<string | null>(null)

  const sourceNames = useMemo(
    () => [...new Set(sources.split(',').map((value) => value.trim()).filter(Boolean))],
    [sources]
  )
  const activeScene = status?.control.sceneAllowlist[0]?.sceneName || sceneName.trim()
  const activeSource = status?.control.sceneAllowlist[0]?.sourceNames[0] || sourceNames[0]
  const controlReady = status?.control.state === 'ready' && status.control.health === 'fresh'

  async function refresh(): Promise<void> {
    const next = await window.ipc.invoke<ObsLocalStatus>(OBS_LOCAL_CHANNELS.status)
    setStatus(next)
    if (next.feed.running && next.feed.allowedLayoutIds[0]) setLayoutId(next.feed.allowedLayoutIds[0])
  }

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await action()
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tt(language, 'obsLocal.error'))
    } finally {
      setBusy(false)
    }
  }

  async function startFeed(): Promise<void> {
    await run(async () => {
      await window.ipc.invoke(OBS_LOCAL_CHANNELS.startFeed, {
        layoutId,
        port: parsePort(feedPort, tt(language, 'obsLocal.portInvalid'))
      })
    })
  }

  async function connect(): Promise<void> {
    await run(async () => {
      const next = await window.ipc.invoke<ObsLocalStatus>(OBS_LOCAL_CHANNELS.connect, {
        host: host.trim(),
        port: parsePort(controlPort, tt(language, 'obsLocal.portInvalid')),
        password,
        allowNonLoopback,
        scenes: [{ sceneName: sceneName.trim(), sourceNames }]
      })
      setStatus(next)
      if (next.control.state !== 'ready') {
        throw new Error(next.control.lastError || tt(language, 'obsLocal.control.failed'))
      }
      setPassword('')
    })
  }

  async function execute(nextCommand: ObsLocalCommand): Promise<void> {
    await run(async () => {
      const result = await window.ipc.invoke<ObsLocalCommandResult>(OBS_LOCAL_CHANNELS.command, nextCommand)
      setMessage(result.message)
      if (!result.ok) throw new Error(result.message)
      if (result.reversible) setUndoRequestId(result.requestId)
      else if (nextCommand.operation.kind === 'undo') setUndoRequestId(null)
    })
  }

  async function copyFeedUrl(): Promise<void> {
    if (!status?.feed.url) return
    try {
      await navigator.clipboard.writeText(status.feed.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1_500)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tt(language, 'obsLocal.error'))
    }
  }

  useEffect(() => {
    const applySources = (value: unknown): void => {
      const next = (Array.isArray(value) ? value as StreamSourceDescriptor[] : [])
        .filter((source) => source.kind === 'dashboard' && source.added && source.eligible)
      setDashboards(next)
      setLayoutId((current) =>
        next.some((source) => source.id === current) ? current : next[0]?.id ?? ''
      )
    }
    void Promise.all([
      refresh(),
      window.ipc.invoke<StreamSourceDescriptor[]>(STREAM_SOURCE_CHANNELS.list).then(applySources)
    ]).catch(() => undefined)
    const unsubscribeSources = window.ipc.subscribe<StreamSourceDescriptor[]>(
      STREAM_SOURCE_CHANNELS.updated,
      applySources
    )
    const timer = setInterval(() => void refresh().catch(() => undefined), 2_000)
    return () => {
      unsubscribeSources()
      clearInterval(timer)
    }
  }, [])

  const feedRunning = status?.feed.running === true
  const control = status?.control
  const latency = control?.metrics.latency

  return (
    <section className="panel streaming-panel">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h4 style={{ margin: '0 0 8px', color: '#f6fbff' }}>{tt(language, 'obsLocal.title')}</h4>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span className={feedRunning ? 'status-pill on' : 'status-pill'}>
            {tt(language, feedRunning ? 'obsLocal.feed.online' : 'obsLocal.feed.offline')}
          </span>
          <span className={controlReady ? 'status-pill on' : 'status-pill'}>
            {tt(language, controlReady ? 'obsLocal.control.ready' : 'obsLocal.control.offline')}
          </span>
        </div>
      </div>
      <p className="overlay-help">{tt(language, 'obsLocal.summary')}</p>
      <p className="overlay-help" style={{ color: '#76f7bd', fontWeight: 800 }}>
        {tt(language, 'obsLocal.readOnly')}
      </p>
      {error ? <p className="overlay-help" style={{ color: 'var(--accent-danger, #fb7185)' }}>⚠ {error}</p> : null}
      {message ? <p className="overlay-help" style={{ color: '#76f7bd' }}>{message}</p> : null}

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div style={subpanelStyle}>
          <h5 style={subheadingStyle}>{tt(language, 'obsLocal.feed.title')}</h5>
          <label className="designer-field">
            {tt(language, 'obsLocal.feed.dashboard')}
            <select value={layoutId} disabled={busy || feedRunning} onChange={(event) => setLayoutId(event.target.value)}>
              {dashboards.length === 0 ? (
                <option value="">{tt(language, 'streaming.sources.emptyTitle')}</option>
              ) : null}
              {dashboards.map((dashboard) => (
                <option key={dashboard.id} value={dashboard.id}>{dashboard.label}</option>
              ))}
            </select>
          </label>
          <label className="designer-field">
            {tt(language, 'obsLocal.feed.port')}
            <input
              inputMode="numeric"
              value={feedPort}
              disabled={busy || feedRunning}
              placeholder={tt(language, 'obsLocal.feed.portPlaceholder')}
              onChange={(event) => setFeedPort(event.target.value)}
            />
          </label>
          <p className="overlay-help">{tt(language, 'obsLocal.feed.help')}</p>
          <div className="overlay-actions">
            <button className="primary-action" disabled={busy || feedRunning || !layoutId} onClick={() => void startFeed()}>
              {tt(language, 'obsLocal.feed.start')}
            </button>
            <button
              className="ghost-action danger"
              disabled={busy || !feedRunning}
              onClick={() => void run(async () => { await window.ipc.invoke(OBS_LOCAL_CHANNELS.stopFeed) })}
            >
              {tt(language, 'obsLocal.feed.stop')}
            </button>
          </div>
          {status?.feed.url ? (
            <>
              <label className="designer-field">
                {tt(language, 'obsLocal.feed.url')}
                <input readOnly value={status.feed.url} onFocus={(event) => event.currentTarget.select()} />
              </label>
              <div className="overlay-actions">
                <button className="ghost-action" onClick={() => void copyFeedUrl()}>
                  {tt(language, copied ? 'obsLocal.copied' : 'obsLocal.copy')}
                </button>
              </div>
              <p className="overlay-help">
                {tt(language, 'obsLocal.feed.binding', {
                  address: status.feed.bindAddress ?? 'offline',
                  port: status.feed.port ?? '—',
                  mode: status.feed.portMode ?? '—'
                })}
              </p>
            </>
          ) : null}
        </div>

        <div style={subpanelStyle}>
          <h5 style={subheadingStyle}>{tt(language, 'obsLocal.control.title')}</h5>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
            <label className="designer-field">
              {tt(language, 'obsLocal.control.host')}
              <input value={host} disabled={busy || control?.state === 'ready'} onChange={(event) => setHost(event.target.value)} />
            </label>
            <label className="designer-field">
              {tt(language, 'obsLocal.control.port')}
              <input inputMode="numeric" value={controlPort} disabled={busy || control?.state === 'ready'} onChange={(event) => setControlPort(event.target.value)} />
            </label>
          </div>
          <label className="designer-field">
            {tt(language, 'obsLocal.control.password')}
            <input type="password" value={password} disabled={busy || control?.state === 'ready'} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <label className="designer-field">
            {tt(language, 'obsLocal.control.scene')}
            <input value={sceneName} disabled={busy || control?.state === 'ready'} onChange={(event) => setSceneName(event.target.value)} />
          </label>
          <label className="designer-field">
            {tt(language, 'obsLocal.control.sources')}
            <input value={sources} disabled={busy || control?.state === 'ready'} placeholder="Race Overlay, Incident Card" onChange={(event) => setSources(event.target.value)} />
          </label>
          <label className="designer-check">
            <input
              type="checkbox"
              checked={allowNonLoopback}
              disabled={busy || control?.state === 'ready'}
              onChange={(event) => setAllowNonLoopback(event.target.checked)}
            />
            {tt(language, 'obsLocal.control.nonLoopback')}
          </label>
          <div className="overlay-actions">
            <button
              className="primary-action"
              disabled={busy || control?.state === 'ready' || !password.trim() || !sceneName.trim() || sourceNames.length === 0}
              onClick={() => void connect()}
            >
              {tt(language, 'obsLocal.control.connect')}
            </button>
            <button
              className="ghost-action danger"
              disabled={busy || control?.state === 'offline'}
              onClick={() => void run(async () => { await window.ipc.invoke(OBS_LOCAL_CHANNELS.disconnect) })}
            >
              {tt(language, 'obsLocal.control.disconnect')}
            </button>
            <button
              className="ghost-action"
              disabled={busy || control?.state !== 'ready'}
              onClick={() => void run(async () => { await window.ipc.invoke(OBS_LOCAL_CHANNELS.refreshHealth) })}
            >
              {tt(language, 'obsLocal.control.health')}
            </button>
          </div>
        </div>
      </div>

      {control ? (
        <div style={{ ...subpanelStyle, marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <strong>{tt(language, 'obsLocal.status.title')}</strong>
              <p className="overlay-help" style={{ margin: '6px 0 0' }}>
                {tt(language, 'obsLocal.status.line', {
                  health: control.health,
                  scene: control.currentProgramScene ?? '—',
                  endpoint: control.endpoint ?? '—'
                })}
              </p>
              <p className="overlay-help" style={{ margin: '4px 0 0' }}>
                {control.handshake
                  ? tt(language, 'obsLocal.status.handshake', {
                      obs: control.handshake.obsVersion,
                      websocket: control.handshake.obsWebSocketVersion,
                      count: control.handshake.availableRequests.length
                    })
                  : tt(language, 'obsLocal.status.noHandshake')}
              </p>
              <p className="overlay-help" style={{ margin: '4px 0 0' }}>
                {tt(language, 'obsLocal.status.metrics', {
                  accepted: control.metrics.commandsAccepted,
                  denied: control.metrics.commandsDenied,
                  p95: latency?.p95Ms === null || latency?.p95Ms === undefined ? '—' : latency.p95Ms.toFixed(1)
                })}
              </p>
              <p className="overlay-help" style={{ margin: '4px 0 0' }}>
                {tt(language, 'obsLocal.status.reliability', {
                  connected: control.metrics.connectSuccesses,
                  attempts: control.metrics.connectAttempts,
                  healthFailures: control.metrics.healthFailures,
                  rateLimited: control.metrics.commandsRateLimited,
                  wrongScene: control.metrics.wrongSceneRejects
                })}
              </p>
              {control.lastTimeline ? (
                <p className="overlay-help" style={{ margin: '4px 0 0' }}>
                  {tt(language, 'obsLocal.status.timeline', {
                    race: control.lastTimeline.raceClockSec.toFixed(3),
                    obs: (control.lastTimeline.obsTimelineMs / 1000).toFixed(3),
                    source: control.lastTimeline.source,
                    replay: control.lastTimeline.replayState
                  })}
                </p>
              ) : null}
            </div>
            <label className="designer-check" style={{ alignSelf: 'flex-start' }}>
              <input
                type="checkbox"
                checked={control.manualOverride}
                disabled={busy || control.state !== 'ready'}
                onChange={(event) => void run(async () => {
                  await window.ipc.invoke(OBS_LOCAL_CHANNELS.setManualOverride, event.target.checked)
                })}
              />
              {tt(language, 'obsLocal.control.manualOverride')}
            </label>
          </div>
          {control.explicitNonLoopback ? (
            <p className="overlay-help" style={{ color: 'var(--accent-warning, #fbbf24)' }}>
              {tt(language, 'obsLocal.status.nonCertified')}
            </p>
          ) : null}
          {control.lastError ? <p className="overlay-help" style={{ color: 'var(--accent-danger, #fb7185)' }}>{control.lastError}</p> : null}
          <div className="overlay-actions">
            <button
              className="ghost-action"
              disabled={busy || !controlReady || control.manualOverride || !activeScene || !activeSource}
              onClick={() => void execute(command(activeScene, { kind: 'set-source-visibility', sourceName: activeSource, visible: true }))}
            >
              {tt(language, 'obsLocal.action.show')}
            </button>
            <button
              className="ghost-action"
              disabled={busy || !controlReady || control.manualOverride || !activeScene || !activeSource}
              onClick={() => void execute(command(activeScene, { kind: 'set-source-visibility', sourceName: activeSource, visible: false }))}
            >
              {tt(language, 'obsLocal.action.hide')}
            </button>
            <button
              className="ghost-action"
              disabled={busy || !controlReady || control.manualOverride || !activeScene}
              onClick={() => void execute(command(activeScene, { kind: 'save-replay-buffer' }))}
            >
              {tt(language, 'obsLocal.action.replay')}
            </button>
            <button
              className="ghost-action"
              disabled={busy || !controlReady || control.manualOverride || !activeScene || !undoRequestId}
              onClick={() => undoRequestId && void execute(command(activeScene, { kind: 'undo', targetRequestId: undoRequestId }))}
            >
              {tt(language, 'obsLocal.action.undo')}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

const subpanelStyle = {
  border: '1px solid var(--border-default)',
  borderRadius: 12,
  padding: 12,
  display: 'grid',
  gap: 10,
  background: 'color-mix(in srgb, var(--surface-base) 82%, transparent)'
} as const

const subheadingStyle = {
  margin: 0,
  color: 'var(--text-primary)'
} as const
