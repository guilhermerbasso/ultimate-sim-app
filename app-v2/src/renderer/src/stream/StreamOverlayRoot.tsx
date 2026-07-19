import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { Dashboard } from '../../../shared/dashboards'
import type { OverlayWidgetConfig, OverlayWidgetId } from '../../../shared/overlays'
import { createDefaultOverlaysConfig, createDefaultOverlayStyle, DEFAULT_OVERLAY_STYLE_PRESET } from '../../../shared/overlays'
import type {
  StreamingDashboardPayload,
  StreamingLayoutKind,
  StreamingTelemetryFrame,
  StreamingTouchInteractionSession
} from '../../../shared/streaming'
import { STREAMING_EXPRESSION_EXCLUSION_MESSAGE } from '../../../shared/streaming'
import {
  normalizeStreamPresentationProfile,
  type StreamPresentationProfile
} from '../../../shared/stream-presentation'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import { parseButtonBoxPanel, type ButtonBoxPanel } from '../../../shared/touch-panel'
import { DashboardCanvas } from '../dashboard/DashboardRoot'
import { CompactHudWidget, COMPACT_HUD_STREAM_SAFE } from '../overlay/widgets/CompactHudWidget'
import { DeltaLapWidget } from '../overlay/widgets/DeltaLapWidget'
import { FuelWidget } from '../overlay/widgets/FuelWidget'
import { GearSpeedWidget } from '../overlay/widgets/GearSpeedWidget'
import { GT3ClusterWidget, GT3_CLUSTER_STREAM_SAFE } from '../overlay/widgets/GT3ClusterWidget'
import { RelativeWidget } from '../overlay/widgets/RelativeWidget'
import type { WidgetProps } from '../overlay/widgets/types'
import { TouchPanelWindowRoot } from '../touchpanel/TouchPanelWindowRoot'
import {
  activateStreamInteraction,
  clearStreamInteraction,
  executeTouchControlAction,
  fetchStreamPanel,
  StreamInteractionRequestError
} from '../touchpanel/runtime'
import { useStreamTouchHeartbeat } from '../touchpanel/useStreamTouchHeartbeat'
import { StreamPresentationRenderer } from '../stream-presentation/StreamPresentationRenderer'
import { streamEndpoint } from './urls'
import '../dashboard/dashboard-runtime.css'
import '../touchpanel/buttonbox.css'

const WIDGETS: Array<{ id: OverlayWidgetId; title: string; className: string; streamSafe: boolean; Component: (props: WidgetProps) => ReactElement }> = [
  { id: 'gt3Cluster', title: 'GT3 Cluster', className: 'stream-gt3-cluster', streamSafe: GT3_CLUSTER_STREAM_SAFE, Component: GT3ClusterWidget },
  { id: 'gearSpeed', title: 'Gear / speed', className: 'stream-gear', streamSafe: true, Component: GearSpeedWidget },
  { id: 'compactHud', title: 'Compact HUD', className: 'stream-compact-hud', streamSafe: COMPACT_HUD_STREAM_SAFE, Component: CompactHudWidget },
  { id: 'deltaLap', title: 'Delta', className: 'stream-delta', streamSafe: true, Component: DeltaLapWidget },
  { id: 'fuel', title: 'Fuel', className: 'stream-fuel', streamSafe: true, Component: FuelWidget },
  { id: 'relative', title: 'Relative', className: 'stream-relative', streamSafe: true, Component: RelativeWidget }
]

const DESIGN_WIDTH = 1024
const DESIGN_HEIGHT = 600

function sseUrl(): string {
  return streamEndpoint('sse').toString()
}

function webSocketUrl(): string {
  const url = streamEndpoint('ws')
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

export function streamTelemetryTransport(href: string): 'sse' | 'websocket' {
  // TryCloudflare Quick Tunnels do not support SSE, but do proxy WebSocket upgrades.
  return new URL(href).protocol === 'https:' ? 'websocket' : 'sse'
}

function pingUrl(): string {
  return streamEndpoint('ping').toString()
}

function authSessionUrl(): string {
  return streamEndpoint('auth/session').toString()
}

function streamTarget(href: string): { kind: StreamingLayoutKind; id: string | null; profileId: string | null } {
  try {
    const url = new URL(href)
    const kind = url.searchParams.get('kind') === 'touch' ? 'touch' : 'dashboard'
    const queryId = kind === 'touch' ? url.searchParams.get('panel') : url.searchParams.get('dash')
    const pathId = url.pathname.match(/\/obs\/([^/]+)$/)?.[1]
    return {
      kind,
      id: queryId || (pathId ? decodeURIComponent(pathId) : null),
      profileId: url.searchParams.get('profile')
    }
  } catch {
    return { kind: 'dashboard', id: null, profileId: null }
  }
}

function dashboardApiUrl(id: string): string {
  return streamEndpoint(`api/dashboard/${encodeURIComponent(id)}`).toString()
}

function presentationApiUrl(id: string): string {
  return streamEndpoint(`api/presentation/${encodeURIComponent(id)}`).toString()
}

function widgetConfig(id: OverlayWidgetId): OverlayWidgetConfig {
  return createDefaultOverlaysConfig().widgets[id] ?? {
    id,
    enabled: true,
    locked: true,
    position: { x: 0, y: 0, width: 320, height: 160 },
    opacity: 100,
    stylePreset: DEFAULT_OVERLAY_STYLE_PRESET,
    style: createDefaultOverlayStyle(),
    display: null
  }
}

function LoadingState({ label }: { label: string }): ReactElement {
  return (
    <div className="stream-viewport" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#9aa6b2', fontFamily: 'Segoe UI, system-ui, sans-serif', padding: 24 }}>{label}</div>
    </div>
  )
}

export function StreamExpressionNotice({ message = STREAMING_EXPRESSION_EXCLUSION_MESSAGE }: { message?: string }): ReactElement {
  return (
    <div className="stream-expression-notice" role="status" data-stream-expression-content="excluded">
      {message}
    </div>
  )
}

export function StreamOverlayRoot() {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null)
  const [connected, setConnected] = useState(false)
  const [streamSafe, setStreamSafe] = useState(true)
  const [scale, setScale] = useState(1)
  // Password gate: null = checking, true = exchange required, false = session ready.
  const [passwordRequired, setPasswordRequired] = useState<boolean | null>(null)
  const [passwordInput, setPasswordInput] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [authenticating, setAuthenticating] = useState(false)
  const [authGeneration, setAuthGeneration] = useState(0)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [touchPanel, setTouchPanel] = useState<ButtonBoxPanel | null>(null)
  const [touchInteraction, setTouchInteraction] = useState<StreamingTouchInteractionSession | null>(null)
  const [presentationProfile, setPresentationProfile] = useState<StreamPresentationProfile | null>(null)
  const [expressionNotice, setExpressionNotice] = useState(STREAMING_EXPRESSION_EXCLUSION_MESSAGE)
  const [targetError, setTargetError] = useState<string | null>(null)
  const [locationHref, setLocationHref] = useState(() => window.location.href)
  const [targetGeneration, setTargetGeneration] = useState(0)
  const target = useMemo(() => streamTarget(locationHref), [locationHref])
  const touchFetches = useRef(new Map<string, Promise<Awaited<ReturnType<typeof fetchStreamPanel>>>>())
  const latestTouchFetchKey = useRef<string | null>(null)
  const presentationFetches = useRef(new Map<string, Promise<unknown>>())
  const latestPresentationFetchKey = useRef<string | null>(null)
  const configs = useMemo(() => Object.fromEntries(WIDGETS.map((item) => [item.id, widgetConfig(item.id)])) as Record<OverlayWidgetId, OverlayWidgetConfig>, [])
  const shellStyle = {
    '--overlay-bg': 'rgba(5, 10, 18, 0.60)',
    '--overlay-accent': '#ff6a00',
    '--overlay-border': 'rgba(138, 164, 200, 0.32)',
    '--overlay-radius': '18px',
    '--overlay-font': 'Segoe UI, sans-serif',
    '--overlay-content-opacity': '1'
  } as CSSProperties

  useEffect(() => {
    const updateLocation = (): void => {
      setLocationHref(window.location.href)
      setTargetGeneration((value) => value + 1)
    }
    window.addEventListener('popstate', updateLocation)
    window.addEventListener('hashchange', updateLocation)
    return () => {
      window.removeEventListener('popstate', updateLocation)
      window.removeEventListener('hashchange', updateLocation)
    }
  }, [])

  // The document token exchange establishes an HttpOnly bootstrap session before
  // this module loads. Ping reports whether that session still needs a password.
  useEffect(() => {
    let alive = true
    fetch(pingUrl(), { method: 'GET', cache: 'no-store', credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new StreamInteractionRequestError(`HTTP ${res.status}`, res.status)
        return res.json() as Promise<{ passwordRequired: boolean }>
      })
      .then((data) => {
        if (!alive) return
        if (typeof data?.passwordRequired !== 'boolean') throw new Error('Invalid ping response')
        setPasswordRequired(data.passwordRequired)
        if (!data.passwordRequired) setAuthGeneration((value) => value + 1)
      })
      .catch((error) => {
        if (!alive) return
        setSessionError(`Stream authentication failed: ${error instanceof Error ? error.message : String(error)}`)
        setPasswordRequired(false)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (passwordRequired !== false || sessionError) return
    const applyFrame = (raw: string): boolean => {
      try {
        const frame = JSON.parse(raw) as StreamingTelemetryFrame
        setSnapshot(frame.snapshot)
        setStreamSafe(frame.streamSafe)
        setConnected(true)
        setPasswordError(null)
        return true
      } catch {
        setConnected(false)
        return false
      }
    }
    if (streamTelemetryTransport(window.location.href) === 'sse') {
      const source = new EventSource(sseUrl())
      source.onopen = () => {
        setConnected(true)
        setPasswordError(null)
      }
      source.onerror = () => {
        setConnected(false)
      }
      source.addEventListener('telemetry', (event) => {
        applyFrame((event as MessageEvent).data)
      })
      return () => source.close()
    }

    let disposed = false
    let retryAttempt = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null
    let socket: WebSocket | null = null
    let source: EventSource | null = null
    const scheduleWebSocket = (): void => {
      if (disposed || retryTimer) return
      const delayMs = Math.min(1_000 * (2 ** retryAttempt), 10_000)
      retryAttempt += 1
      retryTimer = setTimeout(() => {
        retryTimer = null
        connectWebSocket()
      }, delayMs)
    }
    const connectSseFallback = (): void => {
      if (disposed) return
      const candidate = new EventSource(sseUrl())
      source = candidate
      let receivedFrame = false
      fallbackTimer = setTimeout(() => {
        if (source !== candidate || receivedFrame) return
        candidate.close()
        source = null
        scheduleWebSocket()
      }, 3_000)
      candidate.onopen = () => {
        setConnected(true)
        setPasswordError(null)
      }
      candidate.addEventListener('telemetry', (event) => {
        receivedFrame = applyFrame((event as MessageEvent).data)
        if (receivedFrame) {
          retryAttempt = 0
          if (fallbackTimer) clearTimeout(fallbackTimer)
          fallbackTimer = null
        }
      })
      candidate.onerror = () => {
        setConnected(false)
        if (receivedFrame || source !== candidate) return
        candidate.close()
        source = null
        if (fallbackTimer) clearTimeout(fallbackTimer)
        fallbackTimer = null
        scheduleWebSocket()
      }
    }
    const connectWebSocket = (): void => {
      if (disposed) return
      source?.close()
      source = null
      const candidate = new WebSocket(webSocketUrl())
      socket = candidate
      let receivedFrame = false
      candidate.onopen = () => {
        setConnected(true)
        setPasswordError(null)
      }
      candidate.onmessage = (event) => {
        receivedFrame = applyFrame(String(event.data))
        if (receivedFrame) retryAttempt = 0
      }
      candidate.onerror = () => {
        setConnected(false)
        candidate.close()
      }
      candidate.onclose = () => {
        if (socket === candidate) socket = null
        setConnected(false)
        if (disposed) return
        if (receivedFrame) scheduleWebSocket()
        else connectSseFallback()
      }
    }
    connectWebSocket()
    return () => {
      disposed = true
      if (retryTimer) clearTimeout(retryTimer)
      if (fallbackTimer) clearTimeout(fallbackTimer)
      socket?.close()
      source?.close()
    }
  }, [passwordRequired, sessionError])

  useEffect(() => {
    if (target.kind !== 'dashboard') return
    if (!target.id) {
      return
    }
    let alive = true
    fetch(dashboardApiUrl(target.id), { cache: 'no-store', credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<StreamingDashboardPayload>
      })
      .then((payload) => {
        if (!alive) return
        if (!payload?.dashboard || payload.expressionContent?.mode !== 'excluded') {
          throw new Error('Invalid dashboard streaming payload.')
        }
        setDashboard(payload.dashboard)
        setExpressionNotice(payload.expressionContent.message || STREAMING_EXPRESSION_EXCLUSION_MESSAGE)
      })
      .catch((err) => {
        if (alive) setTargetError(err instanceof Error ? err.message : 'Failed to load dashboard.')
      })
    return () => {
      alive = false
    }
  }, [target])

  useEffect(() => {
    if (!target.profileId) {
      latestPresentationFetchKey.current = null
      setPresentationProfile(null)
      return
    }
    if (target.kind === 'touch' && (passwordRequired !== false || sessionError)) {
      latestPresentationFetchKey.current = null
      setPresentationProfile(null)
      return
    }
    const requestKey = [
      target.kind,
      target.id ?? '',
      target.profileId,
      targetGeneration,
      target.kind === 'touch' ? authGeneration : 'dashboard'
    ].join(':')
    latestPresentationFetchKey.current = requestKey
    setPresentationProfile(null)
    setTargetError(null)
    let alive = true
    let request = presentationFetches.current.get(requestKey)
    if (!request) {
      request = fetch(presentationApiUrl(target.profileId), { cache: 'no-store', credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<unknown>
      })
      presentationFetches.current.set(requestKey, request)
    }
    void request
      .then((raw) => {
        if (!alive || latestPresentationFetchKey.current !== requestKey) return
        const profile = normalizeStreamPresentationProfile(raw)
        if (
          !profile ||
          profile.id !== target.profileId ||
          profile.target.kind !== target.kind ||
          profile.target.id !== target.id
        ) {
          throw new Error('Invalid stream presentation profile.')
        }
        setPresentationProfile(profile)
      })
      .catch((err) => {
        if (alive && latestPresentationFetchKey.current === requestKey) {
          setTargetError(err instanceof Error ? err.message : 'Failed to load stream presentation profile.')
          if (
            target.kind === 'touch' &&
            err instanceof StreamInteractionRequestError &&
            (err.status === 401 || err.status === 403)
          ) {
            setPasswordError('Stream session expired. Authenticate again.')
            setPasswordRequired(true)
          }
        }
      })
    return () => {
      alive = false
    }
  }, [target, targetGeneration, passwordRequired, sessionError, authGeneration])

  useStreamTouchHeartbeat({
    enabled: (
      passwordRequired === false &&
      !sessionError &&
      target.kind === 'touch' &&
      Boolean(target.profileId) &&
      touchPanel !== null &&
      touchInteraction !== null
    ),
    panelId: target.kind === 'touch' ? target.id : null,
    interaction: touchInteraction,
    onHealth: (health) => {
      setTouchInteraction((current) => current
        ? {
            ...current,
            health: health.health,
            expiresAt: health.expiresAt,
            leaseExpiresAt: health.leaseExpiresAt,
            activeControls: health.activeControls,
            lastFeedback: health.lastFeedback
          }
        : current)
    },
    onFailure: () => {
      setTouchInteraction((current) => current ? { ...current, health: 'degraded' } : current)
    },
    onAuthLoss: () => {
      if (target.id) clearStreamInteraction(target.id)
      setTouchPanel(null)
      setTouchInteraction(null)
      setConnected(false)
      setTargetError(null)
      setPasswordError('Stream session expired. Authenticate again.')
      setPasswordRequired(true)
    }
  })

  useEffect(() => {
    if (
      target.kind !== 'touch' ||
      !target.id ||
      !target.profileId ||
      passwordRequired !== false ||
      sessionError
    ) {
      latestTouchFetchKey.current = null
      setTouchPanel(null)
      setTouchInteraction(null)
      return
    }
    const panelId = target.id
    const requestKey = `${panelId}:${target.profileId}:${targetGeneration}:${authGeneration}`
    latestTouchFetchKey.current = requestKey
    setTouchPanel(null)
    setTouchInteraction(null)
    setTargetError(null)
    let alive = true
    let request = touchFetches.current.get(requestKey)
    if (!request) {
      request = fetchStreamPanel(panelId, { activate: false })
      touchFetches.current.set(requestKey, request)
    }
    void request
      .then((payload) => {
        if (!alive || latestTouchFetchKey.current !== requestKey) return
        const panel = parseButtonBoxPanel(payload.panel)
        if (!panel) throw new Error('Invalid touch controls panel.')
        activateStreamInteraction(payload.interaction)
        setTouchPanel(panel)
        setTouchInteraction(payload.interaction)
      })
      .catch((err) => {
        if (alive && latestTouchFetchKey.current === requestKey) {
          clearStreamInteraction(panelId)
          setTouchInteraction(null)
          setTargetError(err instanceof Error ? err.message : 'Failed to load touch controls.')
          if (
            err instanceof StreamInteractionRequestError &&
            (err.status === 401 || err.status === 403)
          ) {
            setPasswordError('Stream session expired. Authenticate again.')
            setPasswordRequired(true)
          }
        }
      })
    return () => {
      alive = false
      if (latestTouchFetchKey.current === requestKey) clearStreamInteraction(panelId)
    }
  }, [target, targetGeneration, passwordRequired, sessionError, authGeneration])

  useEffect(() => {
    const updateScale = (): void => {
      const next = Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT)
      setScale(Number.isFinite(next) && next > 0 ? next : 1)
    }
    updateScale()
    window.addEventListener('resize', updateScale)
    window.addEventListener('orientationchange', updateScale)
    return () => {
      window.removeEventListener('resize', updateScale)
      window.removeEventListener('orientationchange', updateScale)
    }
  }, [])

  async function authenticateSession(): Promise<void> {
    setAuthenticating(true)
    setPasswordError(null)
    try {
      const response = await fetch(authSessionUrl(), {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput })
      })
      if (!response.ok) {
        throw new Error(response.status === 429 ? 'Too many failed attempts. Try again in one minute.' : 'Incorrect password.')
      }
      setPasswordInput('')
      setTargetError(null)
      setSessionError(null)
      setPasswordRequired(false)
      setAuthGeneration((value) => value + 1)
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : 'Authentication failed.')
    } finally {
      setAuthenticating(false)
    }
  }

  const showPasswordForm = passwordRequired === true
  const hasSelectedTarget = target.id !== null

  if (passwordRequired === null) {
    return <LoadingState label="Connecting…" />
  }

  if (sessionError) {
    return (
      <div className="stream-viewport">
        <div style={{ color: '#fca5a5', fontFamily: 'Segoe UI, system-ui, sans-serif', padding: 24 }}>{sessionError}</div>
      </div>
    )
  }

  if (showPasswordForm) {
    return (
      <div className="stream-viewport" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <form
          style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 24, background: 'rgba(5,10,18,0.9)', borderRadius: 16, minWidth: 280 }}
          onSubmit={(e) => {
            e.preventDefault()
            void authenticateSession()
          }}
        >
          <div style={{ color: '#fdf7f0', fontWeight: 700, fontSize: 16 }}>Password required</div>
          {targetError ? <div style={{ color: '#fca5a5', fontSize: 12 }}>{targetError}</div> : null}
          <input
            autoFocus
            type="password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            placeholder="Enter password"
            disabled={authenticating}
            style={{ padding: '8px 12px', borderRadius: 8, border: passwordError ? '1px solid #fb7185' : '1px solid rgba(138,164,200,0.4)', background: '#0a0f1a', color: '#fdf7f0', fontSize: 14 }}
          />
          {passwordError ? <div style={{ color: '#fb7185', fontSize: 12 }}>{passwordError}</div> : null}
          <button disabled={authenticating || !passwordInput} type="submit" style={{ padding: '8px 16px', borderRadius: 8, background: '#ff6a00', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer' }}>{authenticating ? 'Connecting…' : 'Connect'}</button>
        </form>
      </div>
    )
  }

  if (targetError) {
    return (
      <div className="stream-viewport">
        <div style={{ color: '#fca5a5', fontFamily: 'Segoe UI, system-ui, sans-serif', padding: 24 }}>{targetError}</div>
      </div>
    )
  }

  if (hasSelectedTarget && target.kind === 'touch') {
    if (!target.profileId) return <TouchPanelWindowRoot panelId={target.id} />
    if (presentationProfile && touchPanel) {
      return (
        <StreamPresentationRenderer
          profile={presentationProfile}
          touchPanel={touchPanel}
          snapshot={snapshot}
          mode="runtime"
          interactiveTouch={
            touchInteraction?.interactive === true &&
            touchInteraction.health === 'ready'
          }
          onTouchAction={executeTouchControlAction}
          reportTouchLifecycle
          ariaLabel="Mobile touch controls stream"
        />
      )
    }
    return <LoadingState label="Loading touch presentation…" />
  }

  if (hasSelectedTarget && target.kind === 'dashboard') {
    if (dashboard) {
      if (target.profileId && !presentationProfile) return <LoadingState label="Loading stream presentation…" />
      return (
        <>
          {presentationProfile ? (
            <StreamPresentationRenderer
              profile={presentationProfile}
              dashboard={dashboard}
              snapshot={snapshot}
              mode="runtime"
              ariaLabel="Mobile dashboard stream"
            />
          ) : (
            <DashboardCanvas dashboard={dashboard} snapshot={snapshot} />
          )}
          <div className={connected ? 'stream-status is-live' : 'stream-status'}>
            {connected ? 'CONNECTED' : 'WAITING'} · READ ONLY · TELEMETRY
          </div>
          <StreamExpressionNotice message={expressionNotice} />
        </>
      )
    }
    return <LoadingState label="Loading dashboard…" />
  }

  return (
    <div className="stream-viewport">
      <main className="stream-root" style={{ ...shellStyle, '--stream-scale': String(scale) } as CSSProperties}>
        <div className="stream-stage">
          {WIDGETS.map(({ id, title, className, streamSafe: widgetStreamSafe, Component }) => (
            <section key={id} className={`stream-widget ${className}`} aria-label={`${title}${widgetStreamSafe ? ' stream safe' : ''}`}>
              <Component snapshot={snapshot} config={configs[id]} />
            </section>
          ))}
        </div>
        <div className={connected && snapshot?.connected ? 'stream-status is-live' : 'stream-status'}>
          {connected && snapshot?.connected ? 'LIVE' : 'WAITING'}{streamSafe ? ' · STREAM SAFE' : ''}
        </div>
      </main>
    </div>
  )
}
