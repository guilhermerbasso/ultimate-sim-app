import { useEffect, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import type {
  TrackMapAuthResult,
  TrackMapBrowserLoginResult,
  TrackMapDataApiDiagnostic,
  TrackMapLoginDiagnostics,
  TrackMapOAuthConfig,
  TrackMapStatus
} from '../../../shared/track-map'
import { TRACK_MAP_CHANNELS } from '../../../shared/track-map'
import { useTrackMapStatus } from '../lib/track-map'
import type { ResolvedLanguage } from '../i18n'

const statusLabels: Record<TrackMapStatus['auth'], string> = {
  unconfigured: 'Not configured',
  ready: 'Connected',
  authenticating: 'Connecting',
  'mfa-required': 'Verification code required',
  'needs-login': 'Sign-in required',
  'rate-limited': 'Retry limit reached',
  error: 'Error',
  disabled: 'Secure storage unavailable'
}

const LOGIN_OK_MESSAGE = 'iRacing connected. Track maps will update for the current track.'
const BROWSER_LOGIN_OK_MESSAGE =
  'You returned to the app. Telemetry keeps working; the Data API was tested in the background.'
const BROWSER_LOGIN_OPENING_MESSAGE =
  'Opening the iRacing login window. Complete email, password, CAPTCHA, and 2FA in that window. ' +
  'The offline map keeps working without signing in.'

function loginMethodLabel(method: TrackMapStatus['loginMethod']): string {
  if (method === 'oauth') return 'OAuth2 + PKCE'
  if (method === 'browser') return 'Browser (captured session)'
  if (method === 'password') return 'Email and password (legacy)'
  return ''
}

// Human-readable, PT-BR summary of the embedded-login capture diagnostics so a
// failed capture is never a silent "nada acontece".
function diagnosticText(d: TrackMapLoginDiagnostics): string {
  const cookie = d.authCookieSeen ? 'session cookie detected' : 'no session cookie detected'
  const verdictLabel =
    d.probeVerdict === 'authed'
      ? 'check: authenticated'
      : d.probeVerdict === 'unauthed'
        ? 'check: not authenticated'
        : 'check: inconclusive'
  return `Diagnostics: ${cookie}  ${verdictLabel}  ${d.cookieCount} cookie(s) in the session.`
}

function formatExpiry(epochMs: number | undefined): string | null {
  if (!epochMs || !Number.isFinite(epochMs)) return null
  return new Date(epochMs).toLocaleString()
}

type LearnTone = 'ok' | 'recording' | 'warn'

// Build the PT-BR status line for the telemetry-learner panel from the live
// learner state broadcast by the main process.
function learnStatusDisplay(learn: TrackMapStatus['learn']): { text: string; tone: LearnTone } {
  if (!learn) return { text: 'Waiting for telemetry', tone: 'warn' }
  if (learn.phase === 'recording') {
    const pct = Math.round(Math.max(0, Math.min(1, learn.progress)) * 100)
    const manual = learn.manual ? ' (manual)' : ''
    return { text: `Learning map ${pct}%${manual}`, tone: 'recording' }
  }
  if (learn.phase === 'warming') {
    return { text: learn.reasonLabel || 'Drive to the start/finish line to start recording', tone: 'recording' }
  }
  // Idle: a learned map already exists, or we show the reason it's stalled.
  if (learn.hasMap) return { text: 'Map learned for this track', tone: 'ok' }
  return { text: learn.reasonLabel || 'Waiting for telemetry', tone: 'warn' }
}

export function TrackMapSetup({ language: _language }: { language?: ResolvedLanguage } = {}) {
  const { status, refresh } = useTrackMapStatus()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mfaPending, setMfaPending] = useState(false)
  const [mfaCode, setMfaCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<TrackMapLoginDiagnostics | null>(null)
  const [oauthClientId, setOauthClientId] = useState('')
  const [oauthClientSecret, setOauthClientSecret] = useState('')
  const [dataApiDiagnostic, setDataApiDiagnostic] = useState<TrackMapDataApiDiagnostic | null>(null)

  const auth = status?.auth ?? 'unconfigured'
  const disabled = busy || auth === 'disabled'
  const connected = auth === 'ready'
  const expiresAt = formatExpiry(status?.sessionExpiresAt)
  // Show the verification-code form both when our local submit triggered MFA and
  // when a background (boot) silent re-login parked an MFA challenge.
  const showMfa = mfaPending || auth === 'mfa-required'

  // Prefill the e-mail from the saved password login so re-authenticating only
  // needs the password (and a 2FA code, if iRacing asks).
  useEffect(() => {
    if (!email && status?.loginMethod === 'password' && status.email && status.email.includes('@')) {
      setEmail(status.email)
    }
  }, [email, status?.loginMethod, status?.email])

  useEffect(() => {
    let active = true
    void window.ipc.invoke<TrackMapOAuthConfig | null>(TRACK_MAP_CHANNELS.getOAuthConfig).then((config) => {
      if (!active || !config) return
      setOauthClientId(config.clientId)
      if (config.clientSecret && !config.clientSecret.includes('')) setOauthClientSecret(config.clientSecret)
    }).catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  async function saveOAuthConfig(): Promise<void> {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const saved = await window.ipc.invoke<TrackMapOAuthConfig>(TRACK_MAP_CHANNELS.setOAuthConfig, {
        clientId: oauthClientId,
        clientSecret: oauthClientSecret
      })
      setOauthClientId(saved.clientId)
      setMessage(saved.clientId ? 'Client ID OAuth saved securely.' : 'OAuth configuration removed.')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function oauthLogin(): Promise<void> {
    setBusy(true)
    setError(null)
    setMessage('Opening OAuth2 iRacing (Authorization Code + PKCE)')
    try {
      const result = await window.ipc.invoke<TrackMapBrowserLoginResult>(TRACK_MAP_CHANNELS.oauthLogin)
      if (result.status === 'ok') {
        setMessage('OAuth connected. The Data API will use ****** and rotating refresh tokens.')
      } else {
        setError(result.message ?? 'OAuth canceled.')
        setMessage(null)
      }
      await refresh()
    } catch (err) {
      setMessage(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function testDataApi(): Promise<void> {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await window.ipc.invoke<TrackMapDataApiDiagnostic>(TRACK_MAP_CHANNELS.testDataApi)
      setDataApiDiagnostic(result)
      setMessage(`Data API test: HTTP ${result.status} using ${result.authMode}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // PRIMARY path: open iRacing's genuine web login so the user can clear
  // CAPTCHA / 2FA, then the main process captures the session cookie. The IPC
  // call only resolves once the login window closes, so we keep a local
  // "opening" message for the whole duration.
  async function browserLogin(): Promise<void> {
    setBusy(true)
    setError(null)
    setMessage(BROWSER_LOGIN_OPENING_MESSAGE)
    try {
      const result = await window.ipc.invoke<TrackMapBrowserLoginResult>(
        TRACK_MAP_CHANNELS.browserLogin
      )
      setDiagnostics(result.diagnostics ?? null)
      if (result.status === 'ok') {
        setPassword('')
        setMfaPending(false)
        setMfaCode('')
        setMessage(BROWSER_LOGIN_OK_MESSAGE)
        setError(null)
      } else {
        // Cancelled / closed / timed out  honest message, offline map intact.
        setMessage(null)
        setError(result.message ?? 'Login canceled. The offline map continues working without login.')
      }
      await refresh()
    } catch (err) {
      setMessage(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await window.ipc.invoke<TrackMapAuthResult>(TRACK_MAP_CHANNELS.setCredentials, {
        email,
        password
      })
      if (result.status === 'mfa_required') {
        // iRacing wants a verification code  prompt for it and keep the session
        // open. The offline learned map keeps working regardless.
        setMfaPending(true)
        setMfaCode('')
        setMessage(
          result.message ??
            'O iRacing enviou um codigo de check. Insira o codigo abaixo para concluir o login.'
        )
      } else {
        setPassword('')
        setMfaPending(false)
        setMfaCode('')
        setMessage(LOGIN_OK_MESSAGE)
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function submitMfa(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await window.ipc.invoke<TrackMapAuthResult>(TRACK_MAP_CHANNELS.submitMfa, { code: mfaCode })
      setPassword('')
      setMfaPending(false)
      setMfaCode('')
      setMessage(LOGIN_OK_MESSAGE)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function refreshMap(): Promise<void> {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await window.ipc.invoke(TRACK_MAP_CHANNELS.refresh)
      await refresh()
      setMessage('Atualizacao do mapa de pista solicitada.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function clearCredentials(): Promise<void> {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await window.ipc.invoke<TrackMapStatus>(TRACK_MAP_CHANNELS.clearCredentials)
      setPassword('')
      setMfaPending(false)
      setMfaCode('')
      setMessage('iRacing login removed. Offline maps (telemetry) remain available.')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // Force the telemetry learner to start capturing NOW (anchored at the car's
  // current position, mid-lap allowed). Doubles as "Restart recording".
  async function startLearning(): Promise<void> {
    setError(null)
    try {
      await window.ipc.invoke<TrackMapStatus>(TRACK_MAP_CHANNELS.startLearning)
      setMessage('Gravando o mapa a partir da posicao current. De uma lap completa para concluir.')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function cancelLearning(): Promise<void> {
    setError(null)
    try {
      await window.ipc.invoke<TrackMapStatus>(TRACK_MAP_CHANNELS.cancelLearning)
      setMessage('Map recording canceled.')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section style={styles.card} aria-label="iRacing track map setup">
      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Track map source</p>
          <h3 style={styles.title}>Telemetry works without signing in</h3>
        </div>
        <span style={{ ...styles.badge, ...(connected ? styles.badgeReady : styles.badgeWarn) }}>
          {statusLabels[auth]}
        </span>
      </div>

      <p style={styles.copy}>
        Map, radar, relatives, dashboards, and overlays come from the local iRacing SDK and work without web sign-in.
        Sign-in is only for <strong>Data API</strong> extras (statistics, results, series, and metadata).
      </p>

      {(() => {
        const learn = status?.learn
        const display = learnStatusDisplay(learn)
        const progressPct = learn ? Math.round(Math.max(0, Math.min(1, learn.progress)) * 100) : 0
        const recordingActive = learn?.phase === 'recording' || learn?.phase === 'warming'
        const toneStyle =
          display.tone === 'ok'
            ? styles.learnBadgeOk
            : display.tone === 'recording'
              ? styles.learnBadgeRec
              : styles.learnBadgeWarn
        return (
          <div style={styles.learnPanel} aria-label="Telemetry map learning">
            <div style={styles.learnHeader}>
              <p style={styles.altTitle}>Map learning (telemetry)</p>
              <span style={{ ...styles.learnBadge, ...toneStyle }}>{display.text}</span>
            </div>
            <p style={styles.hint}>
              The map is drawn by recording car position over a clean lap, like SimHub, with no login.
              If it is not learning, the reason appears above.
            </p>
            {learn?.phase === 'recording' && (
              <div style={styles.progressTrack} aria-hidden>
                <div style={{ ...styles.progressFill, width: `${progressPct}%` }} />
              </div>
            )}
            <div style={styles.actions}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void startLearning()}
                style={{ ...styles.primaryButton, ...styles.primaryCta }}
              >
                {recordingActive ? 'Restart recording' : 'Record map now'}
              </button>
              {recordingActive && (
                <button type="button" disabled={busy} onClick={() => void cancelLearning()} style={styles.secondaryButton}>
                  Cancel recording
                </button>
              )}
            </div>
          </div>
        )
      })()}

      <div style={styles.callout}>
        <p style={styles.calloutTitle}>Official Data API status</p>
        <p style={styles.calloutBody}>
          iRacing disabled legacy <strong>/auth</strong> sign-in and paused new OAuth client IDs for third-party
          apps. When iRacing issues your <strong>client_id</strong>, paste it below to enable OAuth2.
          References:{' '}
          <a href="https://forums.iracing.com/discussion/93956/oauth-client-id-creation" target="_blank" rel="noreferrer" style={styles.calloutLink}>
            forum OAuth client ID
          </a>{' '}
          {' '}
          <a href="https://support.iracing.com/support/solutions/articles/31000174478" target="_blank" rel="noreferrer" style={styles.calloutLink}>
            iRacing support
          </a>
        </p>
      </div>

      <div style={styles.altLogin}>
        <p style={styles.altTitle}>OAuth2 + PKCE (primary when a client_id is available)</p>
        <p style={styles.hint}>OAuth registration is paused by iRacing; paste a client_id when available.</p>
        <label style={styles.label}>
          OAuth client_id
          <input value={oauthClientId} disabled={busy} onChange={(event) => setOauthClientId(event.target.value)} placeholder="Paste the iRacing client_id" style={styles.input} />
        </label>
        <label style={styles.label}>
          client_secret (optional; usually empty in desktop apps)
          <input value={oauthClientSecret} disabled={busy} onChange={(event) => setOauthClientSecret(event.target.value)} placeholder="Optional" style={styles.input} />
        </label>
        <div style={styles.actions}>
          <button type="button" disabled={busy} onClick={() => void saveOAuthConfig()} style={styles.secondaryButton}>Save OAuth</button>
          <button type="button" disabled={busy || !oauthClientId.trim()} onClick={() => void oauthLogin()} style={{ ...styles.primaryButton, ...styles.primaryCta }}>
            {busy ? 'Connecting' : 'Connect with OAuth'}
          </button>
        </div>
      </div>

      {/* Legacy fallback: kept for diagnostics/MFA paths, no longer the primary iRacing auth path. */}
      <form onSubmit={(event) => void submit(event)} style={styles.form}>
        <label style={styles.label}>
          iRacing email
          <input
            type="email"
            autoComplete="username"
            value={email}
            disabled={disabled}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            style={styles.input}
          />
        </label>
        <label style={styles.label}>
          iRacing password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={disabled}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            style={styles.input}
          />
        </label>
        <div style={styles.actions}>
          <button
            type="submit"
            disabled={disabled || !email || !password}
            style={{ ...styles.primaryButton, ...styles.primaryCta }}
          >
            {busy ? 'Signing in' : 'Sign in'}
          </button>
        </div>
      </form>
      <p style={styles.hint}>
        Legacy path kept only as a fallback. iRacing disabled <strong>/auth</strong> for most users.
      </p>

      {showMfa && (
        <form onSubmit={(event) => void submitMfa(event)} style={styles.mfaBox}>
          <p style={styles.mfaTitle}>Email verification code</p>
          <p style={styles.copy}>
            iRacing sent a <strong>device verification code by email</strong>. Enter it
            below to finish signing in.
          </p>
          <p style={styles.mfaWarn}>
            This field is not for the authenticator app code (TOTP). If your account uses 2FA
            through an app, this code will not work; enable <strong>Legacy read-only authentication</strong>{' '}
            in iRacing &gt; Account &gt; Security, or use <strong>browser login</strong> below.
          </p>
          <label style={styles.label}>
            Code emailed by iRacing
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={mfaCode}
              disabled={busy}
              onChange={(event) => setMfaCode(event.target.value)}
              placeholder="Code received by email"
              style={styles.input}
            />
          </label>
          <div style={styles.actions}>
            <button type="submit" disabled={busy || !mfaCode.trim()} style={styles.primaryButton}>
              {busy ? 'Checking' : 'Confirm code'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setMfaPending(false)
                setMfaCode('')
              }}
              style={styles.secondaryButton}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <dl style={styles.statusGrid}>
        <div>
          <dt style={styles.term}>Current track</dt>
          <dd style={styles.value}>{status?.currentTrackName ?? 'Waiting for telemetry'}</dd>
        </div>
        <div>
          <dt style={styles.term}>Current source</dt>
          <dd style={styles.value}>{status?.currentSource ?? 'none'}</dd>
        </div>
        <div>
          <dt style={styles.term}>Login method</dt>
          <dd style={styles.value}>{loginMethodLabel(status?.loginMethod)}</dd>
        </div>
        <div>
          <dt style={styles.term}>Login saved</dt>
          <dd style={styles.value}>{status?.email ?? 'None'}</dd>
        </div>
        <div>
          <dt style={styles.term}>Last login</dt>
          <dd style={styles.value}>
            {status?.lastAuthAt ? new Date(status.lastAuthAt).toLocaleString() : 'Never'}
          </dd>
        </div>
        {expiresAt && (
          <div>
            <dt style={styles.term}>Session expires at</dt>
            <dd style={styles.value}>{expiresAt}</dd>
          </div>
        )}
      </dl>

      {status?.encryptionAvailable === false && (
        <div style={styles.warn}>
          System secure storage is unavailable, so email/password login cannot be saved on this device. You can still use browser login below.
        </div>
      )}
      {(error || status?.lastErrorMessage) && <div style={styles.error}>{error ?? status?.lastErrorMessage}</div>}
      {status?.dataApiMessage && !status.dataApiAvailable && <div style={styles.warn}>{status.dataApiMessage}</div>}
      {message && <div style={styles.success}>{message}</div>}

      <div style={styles.actions}>
        <button type="button" disabled={busy} onClick={() => void refreshMap()} style={styles.secondaryButton}>
          Refresh map
        </button>
        <button type="button" disabled={busy} onClick={() => void testDataApi()} style={styles.secondaryButton}>
          Test Data API access
        </button>
        <button type="button" disabled={busy} onClick={() => void clearCredentials()} style={styles.dangerButton}>
          Forget credentials / Sign out
        </button>
        {(error || message) && (
          <button
            type="button"
            onClick={() => {
              setError(null)
              setMessage(null)
              setDiagnostics(null)
              setDataApiDiagnostic(null)
            }}
            style={styles.secondaryButton}
          >
            Clear message
          </button>
        )}
      </div>
      {dataApiDiagnostic && (
        <pre style={styles.rawDiagnostic}>
{`HTTP ${dataApiDiagnostic.status}  auth=${dataApiDiagnostic.authMode}
${dataApiDiagnostic.body}`}
        </pre>
      )}

      {/* SECOND first-class option: embedded iRacing web login. Recommended for
          accounts with app-based (TOTP) 2FA that don't use legacy auth. */}
      <div style={styles.altLogin}>
        <p style={styles.altTitle}>Browser login</p>
        <p style={styles.altRecommend}>Always returns to the app; Data API is tested only as diagnostics.</p>
        <p style={styles.hint}>
          Opens the real iRacing page in a window. Complete email, password, CAPTCHA, and 2FA there.
          We capture only session cookies (the password is not stored). If the Data API rejects the cookie, you still
          return to the app and see the honest warning above.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void browserLogin()}
          style={{ ...styles.primaryButton, ...styles.primaryCta }}
        >
          {busy ? 'Opening iRacing login' : 'Sign in to iRacing (open login)'}
        </button>
        <p style={styles.hint}>
          To return to the app after signing in: click Return to Ultimate Sim App. If the buttons do not
          respond, use the <strong>Login &gt; Completed login</strong> menu or the keys{' '}
          <strong>Ctrl+Enter</strong> (finish) / <strong>Esc</strong> (cancel).
        </p>
        {diagnostics && <div style={styles.diagnostic}>{diagnosticText(diagnostics)}</div>}
      </div>
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  card: {
    display: 'grid',
    gap: 14,
    padding: 18,
    borderRadius: 'var(--radius-sm)',
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(7, 18, 31, 0.78)',
    color: '#e7f2ff'
  },
  header: { display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' },
  eyebrow: { margin: 0, color: 'var(--accent-primary)', fontSize: 12, fontWeight: 800, textTransform: 'uppercase' },
  title: { margin: '4px 0 0', fontSize: 20 },
  badge: { borderRadius: 'var(--radius-sm)', padding: '6px 10px', fontSize: 12, fontWeight: 800 },
  badgeReady: { background: 'rgba(var(--accent-rgb),0.16)', color: '#74f2db' },
  badgeWarn: { background: 'rgba(255,185,0,0.16)', color: '#ffd166' },
  copy: { margin: 0, color: '#9bb7d8', lineHeight: 1.5 },
  hint: { margin: 0, color: '#7f9fbd', fontSize: 12, lineHeight: 1.5 },
  learnPanel: {
    display: 'grid',
    gap: 10,
    padding: 14,
    borderRadius: 'var(--radius-sm)',
    border: '1px solid rgba(var(--accent-rgb),0.35)',
    background: 'rgba(var(--accent-rgb),0.08)'
  },
  learnHeader: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
  learnBadge: { borderRadius: 'var(--radius-sm)', padding: '6px 10px', fontSize: 12, fontWeight: 800 },
  learnBadgeOk: { background: 'rgba(var(--accent-rgb),0.16)', color: '#74f2db' },
  learnBadgeRec: { background: 'rgba(86,160,255,0.18)', color: '#9fc9ff' },
  learnBadgeWarn: { background: 'rgba(255,185,0,0.16)', color: '#ffd166' },
  progressTrack: { height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  progressFill: { height: '100%', background: 'var(--accent-primary)', transition: 'width 200ms ease' },
  statusGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, margin: 0 },
  term: { color: '#7f9fbd', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' },
  value: { margin: '4px 0 0', fontWeight: 800, overflowWrap: 'anywhere' },
  form: { display: 'grid', gap: 12 },
  label: { display: 'grid', gap: 6, fontSize: 13, fontWeight: 800, color: '#b8cce3' },
  input: {
    border: '1px solid rgba(255,255,255,0.16)',
    borderRadius: 'var(--radius-sm)',
    background: 'rgba(255,255,255,0.06)',
    color: '#ffffff',
    padding: '10px 12px',
    outline: 'none'
  },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 10 },
  primaryButton: { border: 0, borderRadius: 'var(--radius-sm)', background: 'var(--accent-primary)', color: '#04131f', padding: '10px 12px', fontWeight: 900 },
  primaryCta: { padding: '14px 16px', fontSize: 15, justifySelf: 'start' },
  secondaryButton: { border: '1px solid rgba(255,255,255,0.16)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: '#e7f2ff', padding: '10px 12px', fontWeight: 800 },
  dangerButton: { border: '1px solid rgba(255,84,104,0.5)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: '#ff8a9a', padding: '10px 12px', fontWeight: 800 },
  error: { borderRadius: 'var(--radius-sm)', background: 'rgba(255,84,104,0.14)', color: '#ffb8c2', padding: 10, fontWeight: 800 },
  warn: { borderRadius: 'var(--radius-sm)', background: 'rgba(255,185,0,0.12)', color: '#ffd166', padding: 10, fontWeight: 800, lineHeight: 1.45 },
  success: { borderRadius: 'var(--radius-sm)', background: 'rgba(var(--accent-rgb),0.14)', color: '#9ff5e5', padding: 10, fontWeight: 800 },
  diagnostic: {
    borderRadius: 'var(--radius-sm)',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.12)',
    color: '#9bb7d8',
    padding: 10,
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.45
  },
  rawDiagnostic: {
    margin: 0,
    whiteSpace: 'pre-wrap',
    overflow: 'auto',
    maxHeight: 220,
    borderRadius: 'var(--radius-sm)',
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(0,0,0,0.28)',
    color: '#d9ecff',
    padding: 10,
    fontSize: 11,
    lineHeight: 1.45
  },
  advanced: {
    borderTop: '1px solid rgba(255,255,255,0.1)',
    paddingTop: 12,
    display: 'grid',
    gap: 12
  },
  advancedToggle: {
    border: 0,
    background: 'transparent',
    color: '#9bb7d8',
    fontWeight: 800,
    fontSize: 13,
    textAlign: 'left',
    padding: 0,
    cursor: 'pointer',
    justifySelf: 'start'
  },
  advancedBody: { display: 'grid', gap: 12 },
  mfaBox: {
    display: 'grid',
    gap: 10,
    padding: 14,
    borderRadius: 'var(--radius-sm)',
    border: '1px solid rgba(255,185,0,0.4)',
    background: 'rgba(255,185,0,0.08)'
  },
  mfaTitle: { margin: 0, fontSize: 14, fontWeight: 900, color: '#ffd166', textTransform: 'uppercase' },
  mfaWarn: {
    margin: 0,
    color: '#ffd166',
    fontSize: 12,
    fontWeight: 800,
    lineHeight: 1.45
  },
  callout: {
    display: 'grid',
    gap: 6,
    padding: 14,
    borderRadius: 'var(--radius-sm)',
    border: '1px solid rgba(255,185,0,0.45)',
    background: 'rgba(255,185,0,0.10)'
  },
  calloutTitle: { margin: 0, fontSize: 13, fontWeight: 900, color: '#ffd166' },
  calloutBody: { margin: 0, color: '#e8d9a8', fontSize: 13, lineHeight: 1.5 },
  calloutLink: { color: '#ffe39a', fontWeight: 800 },
  altLogin: {
    display: 'grid',
    gap: 10,
    marginTop: 4,
    paddingTop: 14,
    borderTop: '1px solid rgba(255,255,255,0.1)'
  },
  altTitle: { margin: 0, fontSize: 16, fontWeight: 900, color: '#e7f2ff' },
  altRecommend: { margin: 0, color: 'var(--accent-primary)', fontSize: 12, fontWeight: 800 }
}
