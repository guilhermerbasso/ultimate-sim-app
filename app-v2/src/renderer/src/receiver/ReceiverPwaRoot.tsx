import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import {
  RECEIVER_CAPABILITIES,
  RECEIVER_DEFAULT_HZ,
  RECEIVER_MAX_CLIENT_MESSAGE_BYTES,
  RECEIVER_MAX_SERVER_MESSAGE_BYTES,
  RECEIVER_PROTOCOL_VERSION,
  RECEIVER_SCHEMA_VERSION,
  RECEIVER_SUBPROTOCOL,
  isReceiverTelemetryData,
  parseReceiverServerMessage,
  type ReceiverPairStatusResponse,
  type ReceiverTelemetryData,
  type ReceiverWelcomeMessage
} from '../../../shared/receiver-v2'

declare global {
  interface Window {
    __ULTIMATE_SIM_RECEIVER_PAIRING__?: string
  }
}

const STALE_SNAPSHOT_KEY = 'ultimate-sim-receiver-v2-stale'
const CLIENT_ID_KEY = 'ultimate-sim-receiver-v2-client'
const initialPairingCode = window.__ULTIMATE_SIM_RECEIVER_PAIRING__ ?? null
delete window.__ULTIMATE_SIM_RECEIVER_PAIRING__

type ReceiverPhase =
  | 'checking'
  | 'pairing'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'offline'
  | 'blocked'

interface LocalMetrics {
  received: number
  reconnects: number
  gaps: number
  resyncs: number
  lastFrameAgeMs: number | null
}

function receiverBaseUrl(href = window.location.href): URL {
  const current = new URL(href)
  const match = current.pathname.match(/^(.*\/receiver\/v2\/)/)
  return new URL(match?.[1] ?? '/receiver/v2/', current.origin)
}

function endpoint(path: string): URL {
  return new URL(path.replace(/^\/+/, ''), receiverBaseUrl())
}

function secureReceiverContext(): boolean {
  if (window.location.protocol === 'https:' && window.isSecureContext) return true
  const host = window.location.hostname.toLowerCase()
  return window.location.protocol === 'http:' &&
    (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1')
}

function clientId(): string {
  const created = crypto.randomUUID().replaceAll('-', '')
  try {
    const existing = sessionStorage.getItem(CLIENT_ID_KEY)
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing
    sessionStorage.setItem(CLIENT_ID_KEY, created)
  } catch {
    // A non-secret ephemeral ID is sufficient when storage is disabled.
  }
  return created
}

function loadStaleSnapshot(): ReceiverTelemetryData | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STALE_SNAPSHOT_KEY) ?? 'null') as unknown
    return isReceiverTelemetryData(parsed) ? parsed : null
  } catch {
    return null
  }
}

function storeStaleSnapshot(snapshot: ReceiverTelemetryData): void {
  try {
    sessionStorage.setItem(STALE_SNAPSHOT_KEY, JSON.stringify(snapshot))
  } catch {
    // Live reception must continue if browser storage is unavailable.
  }
}

function isPairStatus(value: unknown): value is ReceiverPairStatusResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const status = value as Partial<ReceiverPairStatusResponse>
  return typeof status.authenticated === 'boolean' &&
    typeof status.passwordRequired === 'boolean' &&
    status.protocolVersion === RECEIVER_PROTOCOL_VERSION &&
    status.schemaVersion === RECEIVER_SCHEMA_VERSION &&
    Array.isArray(status.capabilities) &&
    status.capabilities.includes('telemetry.fast.v1') &&
    typeof status.minHz === 'number' &&
    typeof status.maxHz === 'number' &&
    typeof status.maxPayloadBytes === 'number' &&
    typeof status.heartbeatMs === 'number' &&
    (status.transportProfile === 'local-development' || status.transportProfile === 'https-wss') &&
    status.readOnly === true &&
    status.commandsEnabled === false
}

function websocketUrl(): string {
  const url = endpoint('ws')
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.search = ''
  url.hash = ''
  return url.toString()
}

function formatNumber(value: number | null, digits = 1): string {
  return value === null ? '—' : value.toFixed(digits)
}

function statusLabel(phase: ReceiverPhase): string {
  switch (phase) {
    case 'live': return 'LIVE'
    case 'reconnecting': return 'RECONNECTING'
    case 'offline': return 'OFFLINE · STALE'
    case 'blocked': return 'BLOCKED'
    case 'pairing': return 'PAIRING'
    case 'connecting': return 'CONNECTING'
    default: return 'CHECKING'
  }
}

export function ReceiverPwaRoot(): ReactElement {
  const [phase, setPhase] = useState<ReceiverPhase>('checking')
  const [authorized, setAuthorized] = useState(false)
  const [passwordRequired, setPasswordRequired] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<ReceiverTelemetryData | null>(() => loadStaleSnapshot())
  const [welcome, setWelcome] = useState<ReceiverWelcomeMessage | null>(null)
  const [rateHz, setRateHz] = useState(RECEIVER_DEFAULT_HZ)
  const [metrics, setMetrics] = useState<LocalMetrics>({
    received: 0,
    reconnects: 0,
    gaps: 0,
    resyncs: 0,
    lastFrameAgeMs: null
  })
  const pairingCode = useRef(initialPairingCode)
  const lastSequence = useRef(0)

  useEffect(() => {
    if (!secureReceiverContext()) {
      setError('Receiver v2 refuses insecure private-network HTTP. Open it on localhost or through accepted HTTPS/WSS.')
      setPhase('blocked')
      return
    }
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register(endpoint('service-worker.js'), { scope: receiverBaseUrl().pathname })
        .catch(() => undefined)
    }
    let alive = true
    let checking = false
    const checkAuthorization = async (): Promise<void> => {
      if (!alive || checking) return
      if (!navigator.onLine) {
        setPhase('offline')
        return
      }
      checking = true
      setPhase('checking')
      try {
        const requestStatus = (): Promise<Response> => fetch(endpoint('status'), {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'application/json' }
        })
        let response = await requestStatus()
        if (response.status === 403) {
          const bootstrap = await fetch(receiverBaseUrl(), {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'text/html' }
          })
          if (!bootstrap.ok) throw new Error(`Receiver bootstrap failed with HTTP ${bootstrap.status}.`)
          response = await requestStatus()
        }
        if (!response.ok) throw new Error(`Receiver session failed with HTTP ${response.status}.`)
        const body = await response.json() as unknown
        if (!isPairStatus(body)) throw new Error('Receiver status failed its versioned schema check.')
        const status = body
        if (!alive) return
        setError(null)
        if (status.authenticated) {
          setAuthorized(true)
          setPhase('connecting')
          return
        }
        if (!pairingCode.current) {
          setError('This receiver needs a fresh one-use pairing link from the Ultimate Sim App.')
          setPhase('blocked')
          return
        }
        setPasswordRequired(status.passwordRequired)
        if (status.passwordRequired) {
          setPhase('pairing')
        } else {
          await pairReceiver()
        }
      } catch (reason) {
        if (!alive) return
        setError(reason instanceof Error ? reason.message : String(reason))
        setPhase(navigator.onLine ? 'blocked' : 'offline')
      } finally {
        checking = false
      }
    }
    const handleOnline = (): void => {
      void checkAuthorization()
    }
    const handleOffline = (): void => {
      setPhase('offline')
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    void checkAuthorization()
    return () => {
      alive = false
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    if (!authorized) return
    let stopped = false
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectAttempt = 0
    let messageCountSinceAck = 0

    const scheduleReconnect = (): void => {
      if (stopped || !navigator.onLine) {
        setPhase('offline')
        return
      }
      reconnectAttempt += 1
      setMetrics((current) => ({ ...current, reconnects: current.reconnects + 1 }))
      setPhase('reconnecting')
      const delay = Math.min(5_000, 250 * (2 ** Math.min(5, reconnectAttempt - 1)))
      reconnectTimer = setTimeout(connect, delay)
    }

    const send = (body: unknown): void => {
      if (socket?.readyState !== WebSocket.OPEN) return
      const serialized = JSON.stringify(body)
      if (new TextEncoder().encode(serialized).length > RECEIVER_MAX_CLIENT_MESSAGE_BYTES) {
        socket.close(1009, 'client_payload_limit')
        return
      }
      socket.send(serialized)
    }

    const connect = (): void => {
      if (stopped || !navigator.onLine) return
      setPhase(reconnectAttempt > 0 ? 'reconnecting' : 'connecting')
      socket = new WebSocket(websocketUrl(), RECEIVER_SUBPROTOCOL)
      socket.addEventListener('open', () => {
        send({
          type: 'hello',
          protocolVersions: [RECEIVER_PROTOCOL_VERSION],
          schemaVersions: [RECEIVER_SCHEMA_VERSION],
          capabilities: [...RECEIVER_CAPABILITIES],
          requestedHz: RECEIVER_DEFAULT_HZ,
          maxPayloadBytes: RECEIVER_MAX_SERVER_MESSAGE_BYTES,
          ...(lastSequence.current > 0 ? { resumeFrom: lastSequence.current } : {}),
          client: {
            id: clientId(),
            name: navigator.userAgent.slice(0, 64),
            version: 'pwa-1'
          }
        })
      })
      socket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') {
          setError('Receiver closed because the server sent a binary or unbounded frame.')
          socket?.close(1003, 'text_frames_only')
          return
        }
        const message = parseReceiverServerMessage(event.data)
        if (!message) {
          setError('Receiver closed because a server message failed the bounded schema.')
          socket?.close(1008, 'server_schema_invalid')
          return
        }
        if (message.type === 'error') {
          setError(message.message)
          if (!message.retryable) {
            stopped = true
            setPhase('blocked')
          } else {
            setPhase('reconnecting')
          }
          return
        }
        if (message.type === 'welcome') {
          setWelcome(message)
          setRateHz(message.rateHz)
          reconnectAttempt = 0
          setPhase('live')
          return
        }
        if (message.type === 'rate') {
          setRateHz(message.rateHz)
          return
        }
        if (message.type === 'resync-complete') {
          setMetrics((current) => ({ ...current, resyncs: current.resyncs + 1 }))
          return
        }
        if (message.type === 'snapshot') {
          lastSequence.current = message.highWater
          setSnapshot(message.data)
          storeStaleSnapshot(message.data)
          setMetrics((current) => ({
            ...current,
            lastFrameAgeMs: Math.max(0, Date.now() - message.sentAt)
          }))
          setPhase('live')
          return
        }
        if (message.sequence <= lastSequence.current) return
        if (message.sequence !== lastSequence.current + 1) {
          setMetrics((current) => ({ ...current, gaps: current.gaps + 1 }))
          send({ type: 'resync', afterSequence: lastSequence.current, reason: 'gap' })
          return
        }
        lastSequence.current = message.sequence
        setSnapshot(message.data)
        storeStaleSnapshot(message.data)
        setMetrics((current) => ({
          ...current,
          received: current.received + 1,
          lastFrameAgeMs: Math.max(0, Date.now() - message.sentAt)
        }))
        messageCountSinceAck += 1
        if (messageCountSinceAck >= 5) {
          messageCountSinceAck = 0
          send({ type: 'ack', sequence: message.sequence })
        }
        setPhase('live')
      })
      socket.addEventListener('close', (event) => {
        if (stopped) return
        if (event.code === 1002 || event.code === 1003 || event.code === 1008 || event.code === 1009) {
          setError(`Receiver failed closed (${event.reason || event.code}).`)
          setPhase('blocked')
          stopped = true
          return
        }
        scheduleReconnect()
      })
      socket.addEventListener('error', () => {
        setPhase(navigator.onLine ? 'reconnecting' : 'offline')
      })
    }

    const handleOffline = (): void => {
      setPhase('offline')
      socket?.close(1001, 'browser_offline')
    }
    const handleOnline = (): void => {
      if (!socket || socket.readyState === WebSocket.CLOSED) scheduleReconnect()
    }
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    connect()
    return () => {
      stopped = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
      socket?.close(1000, 'receiver_unmounted')
    }
  }, [authorized])

  async function pairReceiver(event?: FormEvent): Promise<void> {
    event?.preventDefault()
    const code = pairingCode.current
    if (!code) {
      setError('The one-use pairing code is unavailable. Create a new link in the desktop app.')
      setPhase('blocked')
      return
    }
    setError(null)
    setPhase('pairing')
    try {
      const response = await fetch(endpoint('pair'), {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          pairingCode: code,
          ...(passwordRequired ? { password } : {})
        })
      })
      if (!response.ok) {
        if (response.status === 409) throw new Error('This one-use pairing link was already consumed.')
        if (response.status === 410) throw new Error('This pairing link expired. Create a new link in the desktop app.')
        if (response.status === 429) throw new Error('Too many pairing attempts. Wait one minute and retry.')
        throw new Error('Pairing failed. Check the password and create a new link if needed.')
      }
      pairingCode.current = null
      setPassword('')
      setAuthorized(true)
      setPhase('connecting')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setPhase('pairing')
    }
  }

  const stale = phase !== 'live'
  const flag = snapshot?.flags.red
    ? 'RED'
    : snapshot?.flags.checkered
      ? 'CHECKERED'
      : snapshot?.flags.yellow
        ? 'YELLOW'
        : snapshot?.flags.blue
          ? 'BLUE'
          : snapshot?.flags.green
            ? 'GREEN'
            : 'NONE'

  return (
    <main className="receiver-shell">
      <header className="receiver-header">
        <div>
          <p className="receiver-kicker">ULTIMATE SIM APP · RECEIVER V2</p>
          <h1>Local telemetry</h1>
        </div>
        <span className={`receiver-state receiver-state-${phase}`} role="status" aria-live="polite">
          {statusLabel(phase)}
        </span>
      </header>

      <section className="receiver-security" aria-label="Receiver security">
        <strong>Read-only data diode</strong>
        <span>No commands, controls, microphone, camera, USB, serial, or cloud dependency.</span>
      </section>

      {error ? <div className="receiver-error" role="alert">{error}</div> : null}

      {phase === 'pairing' && passwordRequired ? (
        <form className="receiver-pair" onSubmit={(event) => void pairReceiver(event)}>
          <label htmlFor="receiver-password">Desktop streaming password</label>
          <input
            id="receiver-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button type="submit" disabled={!password}>Pair read-only receiver</button>
        </form>
      ) : null}

      <section className={stale ? 'receiver-grid is-stale' : 'receiver-grid'} aria-label="Telemetry values">
        <article className="receiver-card receiver-card-primary">
          <span>Speed</span>
          <strong>{formatNumber(snapshot?.speedKmh ?? null, 0)}</strong>
          <small>km/h</small>
        </article>
        <article className="receiver-card">
          <span>Gear</span>
          <strong>{snapshot ? (snapshot.gear === -1 ? 'R' : snapshot.gear === 0 ? 'N' : snapshot.gear) : '—'}</strong>
        </article>
        <article className="receiver-card">
          <span>RPM</span>
          <strong>{snapshot ? snapshot.rpm.toLocaleString() : '—'}</strong>
        </article>
        <article className="receiver-card">
          <span>Fuel</span>
          <strong>{formatNumber(snapshot?.fuelLiters ?? null)}</strong>
          <small>litres</small>
        </article>
        <article className="receiver-card">
          <span>Lap / position</span>
          <strong>{snapshot?.lap ?? '—'} / P{snapshot?.position ?? '—'}</strong>
        </article>
        <article className={`receiver-card receiver-flag receiver-flag-${flag.toLowerCase()}`}>
          <span>Flag</span>
          <strong>{flag}</strong>
        </article>
      </section>

      <section className="receiver-diagnostics" aria-label="Connection diagnostics">
        <h2>Setup diagnostics</h2>
        <dl>
          <div><dt>Protocol / schema</dt><dd>{welcome ? `${welcome.protocolVersion} / ${welcome.schemaVersion}` : '—'}</dd></div>
          <div><dt>Negotiated rate</dt><dd>{rateHz} Hz</dd></div>
          <div><dt>Sequence</dt><dd>{lastSequence.current}</dd></div>
          <div><dt>Received frames</dt><dd>{metrics.received}</dd></div>
          <div><dt>Reconnects / resyncs</dt><dd>{metrics.reconnects} / {metrics.resyncs}</dd></div>
          <div><dt>Detected gaps</dt><dd>{metrics.gaps}</dd></div>
          <div><dt>Latest frame age</dt><dd>{metrics.lastFrameAgeMs === null ? '—' : `${metrics.lastFrameAgeMs} ms`}</dd></div>
          <div><dt>Transport</dt><dd>{window.location.protocol === 'https:' ? 'HTTPS + WSS' : 'localhost development'}</dd></div>
        </dl>
      </section>
    </main>
  )
}
