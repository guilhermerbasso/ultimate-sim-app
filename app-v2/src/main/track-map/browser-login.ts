// Embedded-browser iRacing login — the PRIMARY way to authenticate.
//
// As of 2025 iRacing disabled legacy headless authentication for many
// networks/accounts: the members-ng `/auth` endpoint now expects the official
// web-portal login (CAPTCHA / 2FA / anti-bot) and answers a plain email+password
// POST with HTTP 405/forbidden. The reliable community path is to log in ONCE
// through a REAL browser session — where the user can clear CAPTCHA and 2FA —
// then reuse the resulting authenticated session cookie for the data API.
//
// This module owns exactly that browser session:
//
//   • A dedicated, PERSISTENT Electron session partition (`persist:` so the
//     cookie jar survives app restarts and is isolated from the app session).
//   • `openIRacingLoginWindow()` — opens iRacing's genuine login page in a
//     locked-down BrowserWindow (sandboxed, no preload, no node integration),
//     lets the user complete the whole flow, and detects success primarily by the
//     PRESENCE of a real iRacing auth cookie in the partition jar (after a short
//     settle), with an authenticated `/data/member/info` probe as best-effort
//     confirmation — never as a hard gate, so a CORS/rate-limited/blocked probe
//     can't withhold a session that actually exists. Only a definitive 'unauthed'
//     probe (mid-login, cookie not yet a session) withholds capture.
//   • `readIRacingSessionCookies()` — pulls the live cookies (incl. HttpOnly,
//     readable from the main process) so the existing https data client can
//     forward them on `/data/*` calls.
//   • `clearIRacingSession()` — wipes the cookie jar on logout.
//   • `BrowserSessionStore` — a tiny, NON-secret metadata marker (capturedAt /
//     expiresAt / label). The actual cookie lives only in Electron's partition
//     store; we never copy the raw cookie (or any password) into our own files.

import {
  BrowserWindow,
  Menu,
  WebContentsView,
  ipcMain,
  session,
  shell,
  type Cookie,
  type IpcMainEvent,
  type Session
} from 'electron'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { type IRacingSessionCookie, isIRacingAuthCookieName } from './iracing-api'

// Isolated, persistent cookie jar for the iRacing web session. `persist:` makes
// Electron write it to disk under userData, so a captured session is reused on
// the next launch without re-opening the window.
export const IRACING_PARTITION = 'persist:iracing-trackmap'

// iRacing members site. Unauthenticated, it redirects to the real login form
// (where CAPTCHA/2FA live); authenticated, it lands on the members dashboard and
// the SSO cookie is set — which is exactly what we watch for.
export const IRACING_LOGIN_URL = 'https://members-ng.iracing.com/'

const IRACING_COOKIE_DOMAINS = [
  'iracing.com',
  'members-ng.iracing.com',
  'members.iracing.com',
  'oauth.iracing.com'
] as const

// Authenticated probe endpoint. `/data/member/info` is the cheapest "who am I"
// call: when the partition holds a live session it answers 200 with a small JSON
// body (inline `cust_id`, or a `{ link }` S3 wrapper on some deployments); when
// the session is absent/expired it answers 401. We use it as the AUTHORITATIVE
// success signal instead of trusting a cookie name, because the real auth cookie
// may be HttpOnly, renamed, or scoped to a sibling domain we don't watch.
const IRACING_PROBE_URL = 'https://members-ng.iracing.com/data/member/info'

const BROWSER_SESSION_FILE = 'iracing-browser-session.json'

// 15 minutes is plenty for email/password + CAPTCHA + an emailed/app 2FA code,
// while still guaranteeing the IPC call never stays pending forever if the user
// abandons the window without closing it.
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000

// IPC channels the toolbar preload (`window.simLogin`) sends on. Scoped per login
// window in main via the sender's webContents id so concurrent windows (or a
// stale one) can never cross-trigger each other.
export const IRACING_LOGIN_DONE_CHANNEL = 'iracing-login:done'
export const IRACING_LOGIN_CANCEL_CHANNEL = 'iracing-login:cancel'

// Best-effort diagnostics describing the cookie jar / probe state at the moment a
// login attempt resolved. Surfaced to the renderer so a failed capture is never a
// silent "nothing happened".
export interface BrowserLoginDiagnostics {
  authCookieSeen: boolean
  probeVerdict: IRacingSessionVerdict
  cookieCount: number
}

export interface BrowserLoginResult {
  status: 'ok' | 'cancelled'
  // Why a 'cancelled' result happened — surfaced for diagnostics/messaging.
  reason?: 'closed' | 'timeout' | 'failed'
  // Epoch ms when the captured auth cookie expires, when iRacing sets an expiry
  // (remember-me). Undefined for session-only cookies.
  authCookieExpiresAt?: number
  // Capture diagnostics (cookie presence / probe verdict / cookie count) gathered
  // when the attempt resolved. Undefined for paths that resolve before any jar
  // read is meaningful (e.g. a failed window open).
  diagnostics?: BrowserLoginDiagnostics
}

// ─── Cookie access (used by the data client + the module) ────────────────────

function iracingSession(): Session {
  return session.fromPartition(IRACING_PARTITION)
}

async function readAllIRacingCookies(ses: Session): Promise<Cookie[]> {
  let cookies: Cookie[] = []
  try {
    cookies = await ses.cookies.get({})
  } catch {
    return []
  }
  return cookies.filter((cookie) => {
    const domain = (cookie.domain ?? '').replace(/^\./, '').toLowerCase()
    return IRACING_COOKIE_DOMAINS.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`))
  })
}

// Live cookies captured in the dedicated iRacing partition across every iRacing
// domain involved in the web login. We intentionally do NOT filter by cookie
// name: the authoritative login signal is the data probe, and renamed / sibling-
// domain SSO cookies must still be forwarded by the Node data client.
export async function readIRacingSessionCookies(): Promise<IRacingSessionCookie[]> {
  const cookies = await readAllIRacingCookies(iracingSession())
  return cookies
    .filter((cookie) => Boolean(cookie.value))
    .map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path
    }))
}

// True when a valid iRacing auth cookie is currently present in the partition.
export async function hasIRacingAuthCookie(): Promise<boolean> {
  const cookies = await readAllIRacingCookies(iracingSession())
  return cookies.some((cookie) => isIRacingAuthCookieName(cookie.name))
}

// Three-way outcome of the authoritative session probe. We deliberately do NOT
// collapse a transport failure into "not authed": a definitive HTTP 401/403 means
// the session is gone, but a DNS/timeout/offline/non-HTTP failure tells us nothing
// about the session's validity (the cookies may be perfectly good, the network
// just isn't up yet — common on a desktop sim rig that launches before VPN/Wi-Fi).
// Callers treat 'unauthed' and 'unknown' very differently at boot.
//   • 'authed'   — HTTP 200 carrying the expected member JSON: definitely logged in.
//   • 'unauthed' — definitive HTTP 401/403: definitely logged out / session expired.
//   • 'unknown'  — transport error, timeout, non-HTTP, rate-limit (429), 5xx, or a
//                  200 without the expected JSON: inconclusive, session unchanged.
export type IRacingSessionVerdict = 'authed' | 'unauthed' | 'unknown'

// AUTHORITATIVE session check. Performs a real authenticated request bound to the
// SAME persistent partition the login window uses, via `session.fetch` (Chromium's
// network stack — it carries every cookie in the jar, including HttpOnly ones that
// `document.cookie` can't see). A 200 with a JSON body (`cust_id` inline or a
// `{ link }` S3 wrapper) proves we're logged in; 401/403 proves we're not. This is
// far more reliable than matching a hard-coded cookie name, which breaks whenever
// iRacing renames/re-scopes the SSO cookie. Anything that isn't a clear yes/no —
// transport errors, timeouts, 429/5xx, or an unexpected 200 body — returns
// 'unknown' so callers can avoid demoting a valid session over a flaky network.
export async function verifyIRacingSession(): Promise<IRacingSessionVerdict> {
  try {
    const response = await iracingSession().fetch(IRACING_PROBE_URL, {
      method: 'GET',
      headers: { accept: 'application/json' },
      // Don't drag in a possibly-stale HTTP cache; we want the live auth verdict.
      cache: 'no-store'
    })
    // Only a definitive auth-rejection counts as "logged out". Everything else
    // that isn't a clean 200 (429 rate-limit, 5xx, redirects) is inconclusive.
    if (response.status === 401 || response.status === 403) return 'unauthed'
    if (response.status !== 200) return 'unknown'
    // A 200 from members-ng on an authed session is JSON; an unauthenticated
    // edge response (rare 200 redirect-to-login HTML) is not. Require parseable
    // JSON carrying either the inline member id or the S3 `link` wrapper. A 200
    // we can't make sense of is 'unknown', not a hard logout.
    const text = await response.text().catch(() => '')
    if (!text) return 'unknown'
    try {
      const json = JSON.parse(text) as { cust_id?: unknown; link?: unknown }
      if (typeof json.cust_id === 'number') return 'authed'
      if (typeof json.link === 'string' && json.link) {
        return await verifyLinkedMemberInfo(json.link)
      }
      return 'unknown'
    } catch {
      return 'unknown'
    }
  } catch {
    // Transport-level failure (DNS, timeout, offline, TLS): tells us nothing
    // about the session itself.
    return 'unknown'
  }
}

async function verifyLinkedMemberInfo(link: string): Promise<IRacingSessionVerdict> {
  try {
    const url = new URL(link)
    if (url.protocol !== 'https:') return 'unknown'
    const response = await iracingSession().fetch(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store'
    })
    if (response.status === 401 || response.status === 403) return 'unauthed'
    if (response.status !== 200) return 'unknown'
    const text = await response.text().catch(() => '')
    if (!text) return 'unknown'
    const json = JSON.parse(text) as { cust_id?: unknown }
    return typeof json.cust_id === 'number' ? 'authed' : 'unknown'
  } catch {
    return 'unknown'
  }
}


// Expiry (epoch ms) of the auth cookie, if iRacing set one. Undefined when the
// cookie is session-only or absent.
export async function getIRacingAuthCookieExpiry(): Promise<number | undefined> {
  return readAuthCookieExpiry(iracingSession())
}

async function readAuthCookieExpiry(ses: Session): Promise<number | undefined> {
  const cookies = await readAllIRacingCookies(ses)
  const auth = cookies.find((cookie) => isIRacingAuthCookieName(cookie.name) && cookie.value)
  if (auth && typeof auth.expirationDate === 'number' && Number.isFinite(auth.expirationDate)) {
    return Math.round(auth.expirationDate * 1000)
  }
  // No recognised auth cookie carried an expiry → treat the session as
  // non-expiring and let the authoritative data probe decide liveness. We must
  // NOT fall back to the minimum expiry across ALL cookies: a short-lived
  // sibling (e.g. __cf_bm ~30 min, a consent cookie) would prematurely demote a
  // still-valid SSO session to "needs-login".
  return undefined
}

// Wipe the iRacing cookie jar — used on explicit logout. Best-effort: a failure
// here just means the next login overwrites the old cookie anyway.
export async function clearIRacingSession(): Promise<void> {
  try {
    await iracingSession().clearStorageData({ storages: ['cookies'] })
  } catch {
    // Ignore — logout is best-effort.
  }
}

// ─── Force-persist captured cookies to disk ──────────────────────────────────
// 30 days: long enough that a returning user stays logged in across launches,
// short enough to bound a stale client cookie. The SERVER session is the real
// authority — an expired one just 401s the next /data call → needs-login.
const PERSIST_COOKIE_DURATION_SEC = 30 * 24 * 60 * 60

function cookieRequestUrl(cookie: Cookie): string | null {
  const host = (cookie.domain ?? '').replace(/^\./, '')
  if (!host) return null
  const path = cookie.path && cookie.path.startsWith('/') ? cookie.path : '/'
  return `https://${host}${path}`
}

// Force the captured iRacing session/auth cookies to be written to disk. iRacing's
// SSO cookie is session-scoped (no expiry), and Chromium never persists session
// cookies — even in a `persist:` partition — so without this the captured login is
// lost on the next launch (the exact "login works but doesn't stick" symptom).
//
// We re-set EVERY cookie in the partition jar (not just `*.iracing.com`
// name-matched ones) with an explicit expirationDate, preserving every other
// attribute, so a renamed or sibling-domain SSO cookie is persisted too. The
// named/probe detection still drives STATUS (the return value counts recognised
// auth cookies), but persistence is intentionally exhaustive.
//
// Returns the number of recognised auth cookies persisted (for diagnostics).
export async function persistIRacingSessionCookies(): Promise<number> {
  const ses = iracingSession()
  let cookies: Cookie[]
  try {
    // No `url` filter: capture the WHOLE partition jar (every domain/path) so we
    // never miss the real SSO cookie because it lives on a sibling domain or was
    // renamed.
    cookies = await ses.cookies.get({})
  } catch {
    return 0
  }
  const targetExpiry = Date.now() / 1000 + PERSIST_COOKIE_DURATION_SEC
  let authPersisted = 0
  let totalPersisted = 0
  for (const cookie of cookies) {
    if (!cookie.value) continue
    const isAuthCookie = isIRacingAuthCookieName(cookie.name)
    const alreadyPersistent =
      typeof cookie.expirationDate === 'number' &&
      Number.isFinite(cookie.expirationDate) &&
      cookie.expirationDate > targetExpiry
    if (alreadyPersistent) {
      if (isAuthCookie) authPersisted += 1
      continue
    }
    const url = cookieRequestUrl(cookie)
    if (!url) continue
    try {
      await ses.cookies.set({
        url,
        name: cookie.name,
        value: cookie.value,
        // Preserve host-only scope: passing a domain makes Electron widen the
        // cookie to subdomains. Let it derive from `url` when the original was host-only.
        domain: cookie.hostOnly ? undefined : cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        expirationDate: targetExpiry
      })
      totalPersisted += 1
      if (isAuthCookie) authPersisted += 1
    } catch {
      // Best-effort: a cookie we can't re-set just stays session-only (prior behavior).
    }
  }
  if (totalPersisted > 0) {
    try {
      await ses.cookies.flushStore()
    } catch {
      // Best-effort flush.
    }
    console.log(
      `[iracing] persisted ${totalPersisted} cookie(s) to disk (~30d, ${authPersisted} recognised auth) ` +
        `so the login survives restart`
    )
  }
  return authPersisted
}

// ─── The login window ────────────────────────────────────────────────────────

export async function openIRacingLoginWindow(opts?: {
  parent?: BrowserWindow | null
}): Promise<BrowserLoginResult> {
  const ses = iracingSession()
  const TOOLBAR_HEIGHT = 56
  // The window is split: a trusted top TOOLBAR (our own data: page, rendered by the
  // BrowserWindow's own webContents) carrying a prominent "Return to Ultimate Sim
  // App" button, and BELOW it a WebContentsView hosting iRacing's GENUINE login page
  // (sandboxed, preload-free, sharing the persistent jar). Separating them lets us
  // give the user an explicit, always-visible way back into the app that force-
  // captures the session — without ever injecting anything into iRacing's page.
  const win = new BrowserWindow({
    width: 560,
    height: 880,
    minWidth: 460,
    minHeight: 700,
    title: 'Login do iRacing — Ultimate Sim App',
    backgroundColor: '#0b0f14',
    // Keep the menu bar VISIBLE so the "Login → Concluir / Cancel" items (the
    // guaranteed return path the on-page hint points to) are actually discoverable.
    autoHideMenuBar: false,
    parent: opts?.parent ?? undefined,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // The toolbar is OUR OWN trusted data: page and needs a preload exposing the
      // done/cancel IPC bridge (`window.simLogin`). A sandboxed renderer can't run a
      // preload that uses `ipcRenderer`, so the TOOLBAR window runs unsandboxed —
      // safe because it loads only our static data: URL. The iRacing child view
      // below stays fully sandboxed and preload-free.
      sandbox: false,
      preload: join(__dirname, '../preload/iracing-login-toolbar.mjs')
    }
  })

  const pageView = new WebContentsView({
    webPreferences: {
      // Share the persistent jar so the cookie set during login is the same one
      // the data client reads back afterwards.
      partition: IRACING_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      // Sandboxed and preload-free: this is iRacing's genuine page and we inject
      // absolutely nothing into it.
      sandbox: true
    }
  })
  const pageWc = pageView.webContents
  win.contentView.addChildView(pageView)
  const layoutPageView = (): void => {
    if (win.isDestroyed()) return
    const [w, h] = win.getContentSize()
    pageView.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width: w, height: Math.max(0, h - TOOLBAR_HEIGHT) })
  }
  layoutPageView()
  win.on('resize', layoutPageView)

  // PRIMARY "Return to app" path is now a real preload+IPC button (window.simLogin
  // → 'iracing-login:done'). We ALSO keep sentinel navigation as a FALLBACK so a
  // missing/blocked preload still has a working way back. A native window menu +
  // keyboard accelerators (set up below, in the Promise) are the GUARANTEED path,
  // independent of the preload, the page, IPC, or z-order.
  const DONE_SENTINEL = 'https://ultimate-sim-app.invalid/__done'
  const CANCEL_SENTINEL = 'https://ultimate-sim-app.invalid/__cancel'
  // Identify THIS window's toolbar webContents so the global ipcMain listeners only
  // react to events from our own toolbar (never a concurrent/stale login window).
  const toolbarWcId = win.webContents.id

  return await new Promise<BrowserLoginResult>((resolve) => {
    let settled = false
    let verifying = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let recheckTimer: ReturnType<typeof setTimeout> | null = null
    // Bounds the post-login retry: cookies can land a beat after the dashboard
    // navigation, so when we're clearly on a logged-in page but the probe hasn't
    // succeeded yet, we re-poll a few times before giving up on this event.
    let postLoginRetries = 0
    const MAX_POST_LOGIN_RETRIES = 6
    const POST_LOGIN_RETRY_MS = 1200
    // Throttle the authoritative probe. The MFA/members dance fires a burst of
    // cookie-`changed` events (and navigations), and iRacing's data API is rate
    // limited — an unthrottled probe-per-event could trip the limit and break the
    // very login we're trying to confirm. We coalesce bursts into a single probe,
    // never start one while another is in flight (`verifying`), and keep a minimum
    // interval between probes.
    let lastProbeAt = 0
    let probeCoalesceTimer: ReturnType<typeof setTimeout> | null = null
    const MIN_PROBE_INTERVAL_MS = 1500
    // Grace before we persist on cookie-presence: require the named auth cookie to
    // have been continuously present for ~1s so we don't capture a half-set cookie
    // mid-redirect (the auth cookie can be cleared/re-set during the SSO handoff).
    let authCookieFirstSeenAt: number | null = null
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    const COOKIE_SETTLE_MS = 1000
    // Track whether the data probe ever returned a DEFINITIVE "not logged in".
    // The last-resort cookie capture below must never fire if we saw 'unauthed';
    // it only rescues the inconclusive ('unknown') case.
    let everUnauthed = false

    const onCookieChanged = (): void => {
      void check()
    }

    // Toolbar IPC handlers (window.simLogin → these channels). Scoped to THIS
    // window's toolbar webContents id so a different login window can't trigger us.
    // Declared as named functions so cleanup() (defined just below) can detach them.
    function onLoginDoneIpc(event: IpcMainEvent): void {
      if (event.sender.id !== toolbarWcId) return
      void onUserDone()
    }
    function onLoginCancelIpc(event: IpcMainEvent): void {
      if (event.sender.id !== toolbarWcId) return
      void onUserCancel()
    }

    const cleanup = (): void => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (recheckTimer) {
        clearTimeout(recheckTimer)
        recheckTimer = null
      }
      if (probeCoalesceTimer) {
        clearTimeout(probeCoalesceTimer)
        probeCoalesceTimer = null
      }
      if (settleTimer) {
        clearTimeout(settleTimer)
        settleTimer = null
      }
      try {
        ses.cookies.removeListener('changed', onCookieChanged)
      } catch {
        // The session may already be gone — nothing to detach.
      }
      ipcMain.removeListener(IRACING_LOGIN_DONE_CHANNEL, onLoginDoneIpc)
      ipcMain.removeListener(IRACING_LOGIN_CANCEL_CHANNEL, onLoginCancelIpc)
    }

    const finish = (result: BrowserLoginResult): void => {
      if (settled) return
      settled = true
      cleanup()
      if (!win.isDestroyed()) win.close()
      resolve(result)
    }

    // Best-effort capture diagnostics: total cookie count across the WHOLE
    // partition jar, whether a recognised auth cookie is present, and a bounded
    // authenticated probe verdict. Surfaced so a failed capture is explainable.
    const collectDiagnostics = async (): Promise<BrowserLoginDiagnostics> => {
      let all: Cookie[] = []
      try {
        all = await ses.cookies.get({})
      } catch {
        all = []
      }
      const authCookieSeen = all.some(
        (cookie) => isIRacingAuthCookieName(cookie.name) && Boolean(cookie.value)
      )
      // Bound the probe (verifyIRacingSession has no timeout) so diagnostics never
      // hang a close/cancel; fall back to 'unknown'.
      const probe = verifyIRacingSession().catch((): IRacingSessionVerdict => 'unknown')
      const probeVerdict = await Promise.race<IRacingSessionVerdict>([
        probe,
        new Promise<IRacingSessionVerdict>((r) => setTimeout(() => r('unknown'), 2500))
      ])
      return { authCookieSeen, probeVerdict, cookieCount: all.length }
    }

    // Success path: detach the listener FIRST (so our own cookie re-writes can't
    // re-enter check()), force-persist the captured session to disk, then resolve
    // with the now-persisted expiry.
    const finishOk = async (): Promise<void> => {
      if (settled) return
      settled = true
      cleanup()
      await persistIRacingSessionCookies().catch(() => 0)
      const authCookieExpiresAt = await getIRacingAuthCookieExpiry().catch(() => undefined)
      const diagnostics = await collectDiagnostics().catch(() => undefined)
      if (!win.isDestroyed()) win.close()
      resolve({ status: 'ok', authCookieExpiresAt, diagnostics })
    }

    const check = async (): Promise<void> => {
      if (settled || verifying) return

      // Cheap pre-filter so we don't fire a network probe on every redirect of the
      // oauth/CAPTCHA dance. We consider it worth evaluating when ANY iRacing
      // cookie exists in the partition, or the window has landed on a members page.
      const url = currentUrl()
      let cookies: Cookie[]
      try {
        cookies = await readAllIRacingCookies(ses)
      } catch {
        cookies = []
      }
      const authCookieNames = cookies
        .filter((cookie) => isIRacingAuthCookieName(cookie.name) && cookie.value)
        .map((cookie) => cookie.name)
      const hasNamedAuthCookie = authCookieNames.length > 0
      const hasAnyIRacingCookie = cookies.some((cookie) => Boolean(cookie.value))
      const onLoggedInPage = isLoggedInIRacingPage(url)

      // Track how long the named auth cookie has been continuously present so we
      // can require a short settle before capturing (guards against a cookie that
      // is briefly set then cleared during the SSO redirect handoff).
      if (hasNamedAuthCookie) {
        if (authCookieFirstSeenAt === null) {
          authCookieFirstSeenAt = Date.now()
          // A named auth cookie just APPEARED → the user completed login. Clear any
          // 'unauthed' latched by a PRE-login probe (the partition often holds a
          // stale iRacing cookie that 401s before login). Otherwise that stale
          // negative would permanently disable the auto last-resort capture for the
          // post-login blocked/rate-limited data API case.
          everUnauthed = false
        }
      } else {
        authCookieFirstSeenAt = null
        if (settleTimer) {
          clearTimeout(settleTimer)
          settleTimer = null
        }
      }

      if (!hasAnyIRacingCookie && !onLoggedInPage) {
        console.log(`[iracing] check: no signal (url=${safeUrl(url)}, jar=[${cookieNames(cookies)}])`)
        return
      }

      // Throttle: coalesce a burst of cookie-`changed`/navigation events into a
      // single probe, keeping a floor between probes so we don't hammer iRacing's
      // rate-limited data API during the 2FA/members dance. If we probed too
      // recently, schedule ONE deferred re-check instead of firing now.
      const sinceLastProbe = Date.now() - lastProbeAt
      if (sinceLastProbe < MIN_PROBE_INTERVAL_MS) {
        if (!probeCoalesceTimer) {
          probeCoalesceTimer = setTimeout(() => {
            probeCoalesceTimer = null
            void check()
          }, MIN_PROBE_INTERVAL_MS - sinceLastProbe)
        }
        return
      }

      // Authoritative confirmation: hit /data/member/info with the partition's own
      // cookies. Cookie names are diagnostics only; success is the data API probe.
      verifying = true
      lastProbeAt = Date.now()
      let verdict: IRacingSessionVerdict = 'unknown'
      try {
        verdict = await verifyIRacingSession()
      } finally {
        verifying = false
      }
      if (settled) return

      console.log(
        `[iracing] check: url=${safeUrl(url)} authCookies=[${authCookieNames.join(',')}] ` +
          `jar=[${cookieNames(cookies)}] verdict=${verdict} onLoggedInPage=${onLoggedInPage}`
      )

      if (verdict === 'authed') {
        console.log('[iracing] captured via authed probe')
        void finishOk()
        return
      }

      if (verdict === 'unauthed') {
        everUnauthed = true
        console.log('[iracing] withheld: unauthed (server says these cookies are not logged in)')
      }

      // Probe not authed yet. Re-poll a bounded number of times; cookies can land
      // just after navigation, and we need the data API to say yes before capture.
      if ((onLoggedInPage || hasAnyIRacingCookie) && postLoginRetries < MAX_POST_LOGIN_RETRIES) {
        postLoginRetries += 1
        console.log(`[iracing] retrying (${postLoginRetries}/${MAX_POST_LOGIN_RETRIES})`)
        if (recheckTimer) clearTimeout(recheckTimer)
        recheckTimer = setTimeout(() => {
          recheckTimer = null
          void check()
        }, POST_LOGIN_RETRY_MS)
      } else {
        // Retries exhausted. As a LAST RESORT — never on 'unauthed' (the server
        // explicitly said not-logged-in), only when the probe was inconclusive
        // ('unknown', e.g. a rate-limited/blocked data API behind a restrictive proxy
        // or Cloudflare) — capture if the user is on a logged-in iRacing page with a
        // named auth cookie that has settled. The session is re-validated on next
        // use, so a stale capture self-corrects; this rescues environments where
        // /data/member/info never returns a clean authed 200 even though the real
        // browser session is alive (the exact "login never completes" symptom).
        const settledMs = authCookieFirstSeenAt !== null ? Date.now() - authCookieFirstSeenAt : 0
        if (!everUnauthed && onLoggedInPage && hasNamedAuthCookie && settledMs >= COOKIE_SETTLE_MS) {
          console.log('[iracing] captured via settled auth cookie (probe inconclusive, last resort)')
          void finishOk()
          return
        }
        console.log('[iracing] no signal (giving up this event)')
      }
    }

    const currentUrl = (): string => {
      if (win.isDestroyed() || pageWc.isDestroyed()) return ''
      try {
        return pageWc.getURL()
      } catch {
        return ''
      }
    }

    // Confirm a live session exactly like auto-capture: the data probe is the
    // authoritative verdict. Returns the verdict (not a bool) so explicit user
    // actions can distinguish a definitive "not logged in" ('unauthed') from a
    // merely inconclusive probe ('unknown').
    const confirmVerdict = async (): Promise<IRacingSessionVerdict> => {
      const probe = verifyIRacingSession().catch((): IRacingSessionVerdict => 'unknown')
      return Promise.race<IRacingSessionVerdict>([
        probe,
        new Promise<IRacingSessionVerdict>((resolve) => setTimeout(() => resolve('unknown'), 2500))
      ])
    }
    // A named iRacing auth cookie is actually present in the partition right now.
    const hasNamedAuthCookieNow = async (): Promise<boolean> => {
      const all = await readAllIRacingCookies(ses).catch((): Cookie[] => [])
      return all.some((cookie) => isIRacingAuthCookieName(cookie.name) && Boolean(cookie.value))
    }
    // Explicit user action (Done / closing the window) is ALWAYS a return-to-app
    // action. The /data probe is diagnostic only now: iRacing disabled the legacy
    // cookie-backed Data API path for many users, so gating the return on this
    // probe traps them in the browser even after a successful web login.
    const userActionLoggedIn = async (): Promise<boolean> => {
      await confirmVerdict().catch(() => 'unknown')
      await hasNamedAuthCookieNow().catch(() => false)
      return true
    }
    const setToolbarStatus = (message: string): void => {
      if (win.isDestroyed()) return
      win.webContents
        .executeJavaScript(`window.__setStatus && window.__setStatus(${JSON.stringify(message)})`)
        .catch(() => {
          // Toolbar may still be loading — non-fatal.
        })
    }
    const onUserDone = async (): Promise<void> => {
      if (settled) return
      setToolbarStatus('Lapndo ao app…')
      // Return to the app IMMEDIATELY. finishOk() persists whatever session
      // exists and runs its own time-bounded diagnostics; we must NOT first await
      // a (discarded) ~2.5s probe here, or "Lapr" feels stuck on a dead network.
      void finishOk()
    }

    // Explicit Cancel (toolbar IPC): always closes the window as 'cancelled',
    // attaching diagnostics so the renderer can explain the state.
    const onUserCancel = async (): Promise<void> => {
      if (settled) return
      const diagnostics = await collectDiagnostics().catch(() => undefined)
      finish({ status: 'cancelled', reason: 'closed', diagnostics })
    }

    // Register the toolbar IPC listeners (window.simLogin.done()/cancel()).
    ipcMain.on(IRACING_LOGIN_DONE_CHANNEL, onLoginDoneIpc)
    ipcMain.on(IRACING_LOGIN_CANCEL_CHANNEL, onLoginCancelIpc)

    // ─── GUARANTEED return paths (pure main-process) ────────────────────────────
    // A native window menu + keyboard accelerators do NOT depend on the preload,
    // IPC from the page, the toolbar rendering, or z-order. Even if EVERYTHING in
    // the page is dead, the user can always get back via the "Login" menu or the
    // accelerators (CmdOrCtrl+Enter = done, CmdOrCtrl+W = cancel — never a BARE key
    // that could fire while the user types their iRacing email/password).
    const loginMenu = Menu.buildFromTemplate([
      {
        label: 'Login',
        submenu: [
          {
            label: '✓ Login complete — Return to app',
            accelerator: 'CmdOrCtrl+Return',
            click: () => void onUserDone()
          },
          { type: 'separator' },
          { label: 'Cancel', accelerator: 'CmdOrCtrl+W', click: () => void onUserCancel() }
        ]
      }
    ])
    win.setMenu(loginMenu)

    // Backstop the menu accelerators with a raw key handler. On the TOOLBAR (not a
    // typing surface) we allow CmdOrCtrl+Enter (done) and a bare Esc (cancel). On the
    // iRacing CHILD VIEW the user types their email/password, so we ONLY accept the
    // modified CmdOrCtrl+Enter (done) — NEVER a bare Esc — so normal typing / pressing
    // Esc to dismiss autofill can't accidentally close the login window.
    const wantsDone = (input: { control: boolean; meta: boolean; key: string }): boolean =>
      (input.control || input.meta) && ['enter', 'return'].includes((input.key || '').toLowerCase())
    const onBeforeInputToolbar = (event: { preventDefault: () => void }, input: { type: string; key: string; control: boolean; meta: boolean }): void => {
      if (input.type !== 'keyDown') return
      const key = (input.key || '').toLowerCase()
      if (wantsDone(input)) {
        event.preventDefault()
        void onUserDone()
      } else if (key === 'escape' || key === 'esc') {
        event.preventDefault()
        void onUserCancel()
      }
    }
    const onBeforeInputPage = (event: { preventDefault: () => void }, input: { type: string; key: string; control: boolean; meta: boolean }): void => {
      if (input.type !== 'keyDown') return
      if (wantsDone(input)) {
        event.preventDefault()
        void onUserDone()
      }
    }
    win.webContents.on('before-input-event', onBeforeInputToolbar)
    pageWc.on('before-input-event', onBeforeInputPage)

    // Cookies are often set via the login XHR (no full navigation), so the
    // cookie-store 'changed' event is the earliest trigger to re-evaluate (the
    // authenticated probe in check() then has the final say on success).
    ses.cookies.on('changed', onCookieChanged)
    // Navigations of the iRacing page are a backstop: a returning, still-logged-in
    // user lands on the dashboard (cookie already present, no 'changed' event).
    pageWc.on('did-navigate', () => void check())
    pageWc.on('did-navigate-in-page', () => void check())
    pageWc.on('did-frame-navigate', () => void check())

    // Closing the window is treated as "I'm done": always return to the app and
    // capture whatever exists. The probe is diagnostic, never a gate.
    let closeCapturing = false
    win.on('close', (event) => {
      if (settled) return
      // Hold EVERY pre-settle close (incl. a fast double-click during the async
      // capture) so a logged-in user is never dropped to 'cancelled' by a race.
      event.preventDefault()
      if (closeCapturing) return
      closeCapturing = true
      void (async () => {
        await userActionLoggedIn()
        void finishOk()
      })()
    })
    win.on('closed', () => finish({ status: 'cancelled', reason: 'closed' }))

    // FALLBACK to the preload/IPC button: the toolbar also navigates to a sentinel
    // URL we intercept here, so a missing/blocked preload still has a way back. Both
    // the "done" and "cancel" buttons have a sentinel so neither can silently fail.
    win.webContents.on('will-navigate', (event, url) => {
      if (url.startsWith(DONE_SENTINEL)) {
        event.preventDefault()
        void onUserDone()
      } else if (url.startsWith(CANCEL_SENTINEL)) {
        event.preventDefault()
        void onUserCancel()
      }
    })

    // Keep the embedded iRacing page self-contained: in-flow https/http navigations
    // (iRacing → oauth/identity/CAPTCHA redirects) proceed; anything else opens in
    // the user's real browser instead.
    pageWc.setWindowOpenHandler(({ url }) => {
      if (isHttpUrl(url)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            webPreferences: {
              partition: IRACING_PARTITION,
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true
            }
          }
        }
      }
      openExternal(url)
      return { action: 'deny' }
    })

    pageWc.on('will-navigate', (event, url) => {
      if (!isHttpUrl(url)) {
        event.preventDefault()
        openExternal(url)
      }
    })

    timer = setTimeout(() => finish({ status: 'cancelled', reason: 'timeout' }), LOGIN_TIMEOUT_MS)

    // Load the trusted toolbar into the window's own webContents, and iRacing's
    // genuine page into the child view. The toolbar is a BUNDLED file:// page (not a
    // data: URL) so its preload (`window.simLogin`) loads reliably in the packaged
    // app. The done/cancel sentinels ride along as query params so the will-navigate
    // fallback still works if the preload doesn't attach.
    const loadToolbar = (): void => {
      const onToolbarLoadFail = (): void => {
        // Last-resort fallback: an inline data: URL toolbar. Preloads are unreliable
        // on data: pages, but the native menu + accelerators (the guaranteed path)
        // still work, and the sentinel-navigation buttons remain functional.
        win.webContents
          .loadURL(buildLoginToolbarDataUrl(DONE_SENTINEL, CANCEL_SENTINEL))
          .catch(() => {
            // Even this failed — the native Login menu / accelerators still get the
            // user back.
          })
      }
      if (process.env.ELECTRON_RENDERER_URL) {
        const url = new URL('login-toolbar.html', process.env.ELECTRON_RENDERER_URL)
        url.searchParams.set('done', DONE_SENTINEL)
        url.searchParams.set('cancel', CANCEL_SENTINEL)
        win.webContents.loadURL(url.toString()).catch(onToolbarLoadFail)
      } else {
        win.webContents
          .loadFile(join(__dirname, '../renderer/login-toolbar.html'), {
            query: { done: DONE_SENTINEL, cancel: CANCEL_SENTINEL }
          })
          .catch(onToolbarLoadFail)
      }
    }
    loadToolbar()
    pageWc.loadURL(IRACING_LOGIN_URL).catch(() => {
      finish({ status: 'cancelled', reason: 'failed' })
    })

    // Fast-path: a returning user whose persisted session is still valid is already
    // authenticated — resolve immediately without forcing a re-login.
    void check()
  })
}

// Trusted in-window toolbar FALLBACK (the BrowserWindow's own webContents), used
// only if the bundled file:// toolbar fails to load. Static data: page; preloads
// are unreliable on data: pages, so each button calls `window.simLogin` when it
// happens to be present ELSE navigates to a sentinel main intercepts. The native
// "Login" menu + accelerators remain the guaranteed way back regardless.
// `window.__setStatus(text)` lets main update the hint line.
function buildLoginToolbarDataUrl(doneSentinel: string, cancelSentinel: string): string {
  const html = `<!doctype html><html lang="en-US"><head><meta charset="utf-8"/>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:#0b0f14;color:#f4f6f8}
.bar{display:flex;align-items:center;gap:12px;height:56px;padding:0 14px;background:linear-gradient(180deg,#11161d,#0b0f14);border-bottom:1px solid rgba(255,255,255,.08)}
.brand{font-weight:700;font-size:13px;letter-spacing:.01em;white-space:nowrap}
.brand b{color:#ff6a00}
.spacer{flex:1 1 auto}
.status{font-size:11px;color:rgba(255,255,255,.6);max-width:220px;line-height:1.25;text-align:right}
button{appearance:none;border:1px solid rgba(255,106,0,.6);background:#ff6a00;color:#0b0f14;font-weight:700;font-size:12.5px;padding:9px 14px;border-radius:9px;cursor:pointer;white-space:nowrap}
button:hover{background:#ff7d22}
button:active{transform:translateY(1px)}
button.ghost{background:transparent;color:#f4f6f8;border:1px solid rgba(255,255,255,.28)}
button.ghost:hover{background:rgba(255,255,255,.08)}
</style></head><body>
<div class="bar">
<span class="brand"><b>iRacing</b> Login ? Ultimate Sim App</span>
<span class="spacer"></span>
<span class="status" id="s">If the buttons do not respond: use the <b>Login</b> menu above, or press <b>Ctrl+Enter</b> to finish.</span>
<button id="cancel" class="ghost" type="button">Cancel</button>
<button id="done" type="button">✓ Return to Ultimate Sim App</button>
</div>
<script>
(function(){
  var doneSentinel=${JSON.stringify(doneSentinel)};
  var cancelSentinel=${JSON.stringify(cancelSentinel)};
  function done(){
    if(window.simLogin&&typeof window.simLogin.done==='function'){window.simLogin.done();}
    else if(doneSentinel){location.href=doneSentinel;}
  }
  function cancel(){
    if(window.simLogin&&typeof window.simLogin.cancel==='function'){window.simLogin.cancel();}
    else if(cancelSentinel){location.href=cancelSentinel;}
  }
  document.getElementById('done').addEventListener('click',done);
  document.getElementById('cancel').addEventListener('click',cancel);
  window.addEventListener('keydown',function(e){
    var k=(e.key||'').toLowerCase();
    if((e.ctrlKey||e.metaKey)&&(k==='enter'||k==='return')){e.preventDefault();done();}
    else if(k==='escape'||k==='esc'){e.preventDefault();cancel();}
  });
  window.__setStatus=function(t){var e=document.getElementById('s');if(e){e.textContent=t;}};
})();
</script>
</body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

// ─── Session marker (non-secret metadata) ────────────────────────────────────
// We persist ONLY non-secret bookkeeping so the renderer can show "connected
// since / expires" after a relaunch. The sensitive session cookie itself stays
// in Electron's partition cookie store — never copied here, and no password is
// ever stored for the browser path.

export interface BrowserSessionMarker {
  version: 1
  capturedAt: number
  expiresAt?: number
  label?: string
}

export class BrowserSessionStore {
  private readonly file: string

  constructor(userDataPath: string) {
    this.file = join(userDataPath, BROWSER_SESSION_FILE)
  }

  async load(): Promise<BrowserSessionMarker | null> {
    try {
      const raw = await readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw) as Partial<BrowserSessionMarker>
      if (parsed.version === 1 && typeof parsed.capturedAt === 'number') {
        return {
          version: 1,
          capturedAt: parsed.capturedAt,
          expiresAt: typeof parsed.expiresAt === 'number' ? parsed.expiresAt : undefined,
          label: typeof parsed.label === 'string' ? parsed.label : undefined
        }
      }
    } catch {
      // Missing/corrupt marker → behave as "no browser session recorded".
    }
    return null
  }

  async save(marker: BrowserSessionMarker): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, JSON.stringify(marker), 'utf8')
  }

  async clear(): Promise<void> {
    try {
      await rm(this.file, { force: true })
    } catch {
      // Ignore — the next save overwrites it anyway.
    }
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

// Comma-separated names of the cookies currently in the jar, for diagnostics.
// NAMES ONLY — never the values, which are the actual session secret.
function cookieNames(cookies: Cookie[]): string {
  return cookies.map((cookie) => cookie.name).join(',')
}

// URL with any query string / fragment stripped, for diagnostics: iRacing SSO
// redirect URLs can carry tokens in the query, which we must never log.
function safeUrl(url: string): string {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return '(unparseable)'
  }
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

// True when the embedded window is on an iRacing-owned members page that is NOT
// the login/signin/oauth form NOR a mid-authentication interstitial (2FA / MFA /
// CAPTCHA / verification challenge). Used only as a pre-filter to decide when to
// run the authenticated probe; the probe itself is the source of truth, so a
// false positive here is harmless — but skipping these "still authenticating"
// paths keeps us from probing the rate-limited data API mid-2FA.
function isLoggedInIRacingPage(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
    const host = parsed.hostname.toLowerCase()
    const onIRacing = host === 'iracing.com' || host.endsWith('.iracing.com')
    if (!onIRacing) return false
    const path = parsed.pathname.toLowerCase()
    return !/(login|signin|sign-in|auth|oauth|logout|verify|two-factor|2fa|mfa|recaptcha|captcha|challenge)/.test(
      path
    )
  } catch {
    return false
  }
}

function openExternal(url: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:') {
      void shell.openExternal(parsed.toString())
    }
  } catch {
    // Deny malformed URLs.
  }
}
