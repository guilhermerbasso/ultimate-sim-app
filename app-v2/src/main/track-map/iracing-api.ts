// iRacing members-ng client — minimal slice needed by the track-map data layer.
//
// We only implement what's strictly required:
//   • POST /auth                 → log in, persist session cookies
//   • GET  /data/track/get       → list of tracks (paginated via S3 link)
//   • GET  /data/track/assets    → per-track SVG layer manifest (via S3 link)
//   • GET  <S3 svg url>          → raw SVG bytes (no auth required)
//
// Most members-ng endpoints respond with `{ link: "<S3 url>", expires: ... }`
// and we have to follow that link to get the actual JSON payload. The client
// hides that indirection from callers.
//
// SECURITY: the raw password is hashed before it ever leaves this file. We
// store ONLY the email + the hashed password (base64( sha256(rawPassword +
// lower(email)) )), and we never log either. Network errors are surfaced as
// typed `IRacingApiError` instances so the module can react (re-auth on 401,
// back off on 429, fall through to learned map otherwise).

import { createHash } from 'node:crypto'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { URL } from 'node:url'
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'
import type { TrackMapDataApiDiagnostic } from '../../shared/track-map'

const MEMBERS_NG_HOST = 'members-ng.iracing.com'
const USER_AGENT = 'UltimateButtonBox/0.2 (+contact: support@ultimate-buttonbox.local)'

// The /auth call goes through an edge/WAF that is pickier than the data API.
// The canonical, working contract (confirmed across the official-community
// clients in Python/JS/Go/C#) is the simplest possible request: a plain
// `POST https://members-ng.iracing.com/auth` with `Content-Type: application/
// json` and a conventional browser User-Agent — NO redirect chasing, NO
// `Connection: close`, NO password-format tricks. Anything fancier is a common
// cause of a spurious 405 from the edge, so we deliberately keep it boring.
const AUTH_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// Cap how long any single fetch can wait — the data API normally answers in
// well under a second, but the S3 redirects can stall on flaky networks.
const REQUEST_TIMEOUT_MS = 15_000
const MAX_BODY_BYTES = 8 * 1024 * 1024 // 8 MiB hard cap for JSON/SVG payloads

export type IRacingErrorKind =
  | 'network'
  | 'unauthorized'
  | 'rate-limited'
  | 'http'
  | 'parse'
  | 'aborted'

export class IRacingApiError extends Error {
  readonly kind: IRacingErrorKind
  readonly status?: number
  constructor(kind: IRacingErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'IRacingApiError'
    this.kind = kind
    this.status = status
  }
}

// Outcome of an /auth POST. Either we're authenticated, or iRacing accepted the
// password but is asking for a verification code (MFA / `verificationRequired`).
// Hard failures (bad credentials, 405, 429, network) are thrown as
// `IRacingApiError` rather than represented here.
export type IRacingAuthOutcome = { status: 'ok' } | { status: 'mfa_required'; message?: string }

// A single cookie pulled from the embedded-login window's session. The data
// client only ever needs the name/value pair to rebuild the `Cookie:` header.
export interface IRacingSessionCookie {
  name: string
  value: string
  domain?: string
  path?: string
}

// Cookie names that prove an authenticated members session. iRacing's SSO sets
// `irsso_membersv2` after a successful web login; `authtoken_members` appears in
// some flows. The presence of either means "logged in". Exported so the
// embedded-login window can detect success using the same source of truth.
export const IRACING_AUTH_COOKIE_NAMES = ['irsso_membersv2', 'authtoken_members'] as const

// Broaden detection beyond the two historically-observed names: iRacing has
// changed its SSO cookie naming before (e.g. `irsso_members` → `irsso_membersv2`)
// and uses several `authtoken*` variants across flows. Relying on a single
// hard-coded name is the classic "login works but is never captured" trap, so we
// match case-insensitively on the known FAMILIES of auth cookies as a fallback.
// The authoritative success signal is now an authenticated probe (see
// browser-login.ts `verifyIRacingSession`); this name match is a cheap pre-filter
// and a backstop for the cookie-jar read used by the data client.
const IRACING_AUTH_COOKIE_PATTERNS = [/^irsso/i, /^authtoken/i, /^auth.*member/i]

export function isIRacingAuthCookieName(name: string): boolean {
  const lower = name.toLowerCase()
  if ((IRACING_AUTH_COOKIE_NAMES as readonly string[]).some((n) => n.toLowerCase() === lower)) {
    return true
  }
  return IRACING_AUTH_COOKIE_PATTERNS.some((re) => re.test(name))
}

function hasAuthCookie(cookies: Iterable<{ name: string }>): boolean {
  for (const cookie of cookies) {
    if (isIRacingAuthCookieName(cookie.name)) return true
  }
  return false
}

// Shape exposed by the `track/get` link. iRacing returns a long array, but we
// only ever look at these fields.
export interface IRacingTrack {
  track_id: number
  track_name: string
  config_name?: string | null
  category?: string
}

// Shape exposed by the `track/assets` link. The response is an object keyed by
// `track_id` (as a string), each value matching this interface. The layer
// filenames are plain SVG names that hang off `track_map` (a URL prefix).
export interface IRacingTrackAssets {
  track_id: number
  track_map: string // URL prefix, MUST end with "/"
  track_map_layers: {
    background?: string
    inactive?: string
    active?: string
    pitroad?: string
    'start-finish'?: string
    turns?: string
  }
}

// ─── members-ng career/stats payloads (Career & Ratings Hub) ────────────────
// Faithful (snake_case) slices of the member/stats endpoints — only the fields
// the Career Hub consumes. Values are returned EXACTLY as iRacing sends them
// (safety ratings ×100, 0-based finishing positions, etc.); the career module
// owns every unit conversion so this client stays a dumb HTTP layer.

export interface IRacingMemberLicense {
  category_id: number
  category?: string
  category_name?: string
  group_name?: string
  license_level?: number
  irating?: number
  safety_rating?: number // human float here (e.g. 3.45) on member/get + member/info
  cpi?: number
  color?: string
}

// /data/member/info — the authenticated member ("me"). No parameters; returns
// the cust_id we need to drive every other Career Hub call, plus the current
// per-category licenses keyed by category (sports_car, oval, …).
export interface IRacingMemberInfo {
  cust_id: number
  display_name: string
  licenses?: Record<string, IRacingMemberLicense>
}

// /data/member/get — basic profile for one or more members; `licenses` is an
// ARRAY here (only when include_licenses=true), unlike member/info's object.
export interface IRacingMember {
  cust_id: number
  display_name: string
  licenses?: IRacingMemberLicense[]
}

// /data/stats/member_career — one entry per discipline.
export interface IRacingCareerStat {
  category_id: number
  category?: string
  starts?: number
  wins?: number
  top5?: number
  poles?: number
  laps?: number
  laps_led?: number
  avg_start_position?: number
  avg_finish_position?: number
  avg_incidents?: number
  win_percentage?: number
  top5_percentage?: number
  poles_percentage?: number
}

// /data/member/chart_data — a single time series. `value` units depend on
// chart_type (1 iRating int, 3 safety rating ×100); `when` is an ISO string.
export interface IRacingChartPoint {
  value: number
  when: string
}

export interface IRacingChartData {
  category_id: number
  chart_type: number
  data: IRacingChartPoint[]
}

// /data/stats/member_recent_races — the latest handful of races. `*_position`
// are 0-based; `*_sub_level` are safety ratings ×100.
export interface IRacingRecentRace {
  subsession_id: number
  session_start_time?: string
  series_name?: string
  car_id?: number
  track?: { track_id?: number; track_name?: string }
  start_position?: number
  finish_position?: number
  field_size?: number
  incidents?: number
  laps?: number
  laps_led?: number
  oldi_rating?: number
  newi_rating?: number
  old_sub_level?: number
  new_sub_level?: number
  strength_of_field?: number
}

// /data/stats/member_summary → `this_year`.
export interface IRacingThisYearSummary {
  num_official_sessions?: number
  num_official_wins?: number
  num_league_sessions?: number
  num_league_wins?: number
}

// /data/car/get — catalog used to resolve car_id → car name for recent races
// and per-car strengths.
export interface IRacingCar {
  car_id: number
  car_name?: string
  car_name_abbreviated?: string
}

// /data/stats/member_yearly — per-year stats per discipline.
export interface IRacingYearlyStat {
  year: number
  category_id: number
  category?: string
  starts?: number
  wins?: number
  top5?: number
  poles?: number
  laps?: number
  laps_led?: number
  avg_start_position?: number
  avg_finish_position?: number
  avg_incidents?: number
  win_percentage?: number
  top5_percentage?: number
}

// /data/member/profile — extended profile.
export interface IRacingMemberProfile {
  cust_id: number
  display_name?: string
  club_name?: string
  club_id?: number
  helmet?: {
    pattern?: number
    color1?: string
    color2?: string
    color3?: string
  }
  last_login?: string
  member_since?: string
  country_code?: string
  state?: string
}

// /data/series/seasons — minimal slice of an active season entry.
export interface IRacingSeasonSeries {
  season_id: number
  series_id: number
  season_name?: string
  series_name?: string
  category_id?: number
  active?: boolean
  official?: boolean
  fixed_setup?: boolean
  driver_changes?: boolean
  min_license_level?: number
  max_license_level?: number
}

// /data/league/membership — one league the member belongs to.
export interface IRacingLeagueMembership {
  league_id: number
  league_name?: string
  owner?: boolean
  admin?: boolean
  roster_count?: number
  url?: string
}

// /data/stats/member_division — division placement for a category/season.
export interface IRacingMemberDivision {
  cust_id?: number
  category_id?: number
  division?: number
  rank?: number
  points?: number
}

interface RawCookie {
  name: string
  value: string
  domain?: string
  path?: string
  // Expiry (epoch ms) parsed from the Set-Cookie `Expires`/`Max-Age` attribute,
  // when iRacing sent one. Used to surface "session expires in…" and to skip
  // adopting a clearly-dead session on boot.
  expires?: number
}

// The JSON body iRacing returns from a 200 /auth response. Success is encoded
// in the body (not just the HTTP status): `authcode` is 0/"0" on failure, and
// `verificationRequired` flags an MFA / browser-verification challenge. Field
// names confirmed against the maintained community clients.
interface AuthResponseBody {
  authcode?: string | number | null
  custId?: number | null
  email?: string
  verificationRequired?: boolean
  message?: string
  ssoCookieName?: string
  ssoCookieValue?: string
}

interface RawResponse {
  status: number
  headers: Record<string, string>
  body: string
}

// Pure: never logs the password. The hash is identical for the same
// (email, password) pair so we can compare or persist it safely.
export function hashIRacingPassword(email: string, rawPassword: string): string {
  const normalizedEmail = email.trim().toLowerCase()
  const digest = createHash('sha256')
    .update(rawPassword + normalizedEmail, 'utf8')
    .digest('base64')
  return digest
}

export class IRacingApi {
  private cookies = new Map<string, RawCookie>()
  private authedAt: number | null = null
  private authPromise: Promise<void> | null = null
  // Single-flight guard for the /auth POST, shared between the BOOT silent-login
  // (`loginShared`) and the data path's `authenticate()`. Ensures a data request
  // that arrives while a boot login is in flight REUSES that one POST instead of
  // firing a second concurrent /auth into the same cookie jar.
  private loginInFlight: Promise<IRacingAuthOutcome> | null = null
  // True once iRacing returned `verificationRequired` and we're awaiting the
  // user's emailed code via `completeMfa`. While set, `authenticate()` must NOT
  // fire a fresh /auth (it would overwrite the parked challenge cookie).
  private mfaPending = false
  private rateLimitedUntil: number | null = null
  // When set, the client runs in BROWSER-SESSION mode: it pulls live cookies
  // from this provider (the embedded-login window's persistent partition)
  // instead of POSTing /auth with a password.
  private browserSessionProvider: (() => Promise<IRacingSessionCookie[]>) | null = null
  private oauthTokenProvider: ((forceRefresh?: boolean) => Promise<string | null>) | null = null

  constructor(
    private readonly email: string,
    // Already hashed via `hashIRacingPassword` — we never accept the plain
    // password at this layer, which makes accidental logging impossible. Empty
    // in browser-session mode, where there is no password at all.
    private readonly hashedPassword: string
  ) {}

  // Switch this client into BROWSER-SESSION mode. From now on it authenticates
  // by reading the iRacing session cookie(s) captured by the embedded-login
  // window (via `provider`) and forwarding them on every data request — there
  // is no password and no /auth POST. Calling this clears any prior session.
  useBrowserSession(provider: () => Promise<IRacingSessionCookie[]>): void {
    this.browserSessionProvider = provider
    this.oauthTokenProvider = null
    this.cookies.clear()
    this.authedAt = null
  }

  useOAuthTokens(provider: (forceRefresh?: boolean) => Promise<string | null>): void {
    this.oauthTokenProvider = provider
    this.browserSessionProvider = null
    this.cookies.clear()
    this.authedAt = Date.now()
  }

  private usesBrowserSession(): boolean {
    return this.browserSessionProvider !== null
  }

  private usesOAuth(): boolean {
    return this.oauthTokenProvider !== null
  }

  isAuthed(): boolean {
    if (this.usesOAuth()) return true
    return this.authedAt !== null && this.cookies.size > 0
  }

  lastAuthAt(): number | null {
    return this.authedAt
  }

  // Force re-auth on the next request. Used after we receive 401.
  invalidate(): void {
    this.cookies.clear()
    this.authedAt = this.usesOAuth() ? Date.now() : null
  }

  // Adopt a previously-persisted PASSWORD-mode session cookie jar (captured from
  // a prior /auth Set-Cookie response) so the data client is immediately authed
  // on boot WITHOUT a fresh /auth POST — and therefore without re-triggering MFA.
  // A later 401 transparently re-logins via `authenticate()` (password mode).
  seedCookies(cookies: IRacingSessionCookie[]): void {
    this.cookies.clear()
    for (const cookie of cookies) {
      if (cookie && cookie.name && typeof cookie.value === 'string') {
        this.cookies.set(cookieKey(cookie), {
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path
        })
      }
    }
    this.authedAt = this.cookies.size > 0 ? Date.now() : null
    this.mfaPending = false
  }

  // Snapshot the current cookie jar so the module can persist it (encrypted) and
  // re-seed it next launch. Never includes the password — only the session
  // cookies iRacing set on /auth.
  exportCookies(): IRacingSessionCookie[] {
    return Array.from(this.cookies.values()).map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path
    }))
  }

  // Earliest expiry (epoch ms) among the recognised auth cookies, when iRacing
  // sent an `Expires`/`Max-Age` attribute; otherwise undefined.
  authCookieExpiresAt(): number | undefined {
    let earliest: number | undefined
    for (const cookie of this.cookies.values()) {
      if (!isIRacingAuthCookieName(cookie.name)) continue
      if (typeof cookie.expires !== 'number') continue
      earliest = earliest === undefined ? cookie.expires : Math.min(earliest, cookie.expires)
    }
    return earliest
  }

  // Used by the data endpoints to (re)establish a session before a request, and
  // for the one-shot re-auth after a 401. Keeps the single-flight guard so
  // concurrent data calls share one login. Throws on MFA: a mid-session re-auth
  // can't prompt the user, so we surface it as "needs login". In browser-session
  // mode it (re)loads the captured cookies instead of POSTing /auth.
  async authenticate(): Promise<void> {
    if (this.authPromise) return this.authPromise
    if (this.usesOAuth()) {
      this.authPromise = this.loadOAuthAccessToken(false).finally(() => {
        this.authPromise = null
      })
      return this.authPromise
    }
    if (this.usesBrowserSession()) {
      this.authPromise = this.loadBrowserSessionCookies().finally(() => {
        this.authPromise = null
      })
      return this.authPromise
    }
    // Password mode. If an MFA challenge is parked awaiting the user's emailed
    // code, a background data call must NOT fire a fresh /auth: that POST's
    // Set-Cookie challenge would overwrite the one tied to the parked
    // `completeMfa`, so the user's correct code would be rejected. Surface
    // "needs login" without touching the network.
    if (this.mfaPending) {
      throw new IRacingApiError('unauthorized', mfaMessage(), 401)
    }
    // Reuse the single-flight login so a boot silent-login already in flight is
    // shared instead of duplicated (no second /auth → no overwritten challenge
    // cookie, no 429).
    this.authPromise = this.loginShared()
      .then((outcome) => {
        if (outcome.status === 'mfa_required') {
          throw new IRacingApiError('unauthorized', outcome.message ?? mfaMessage(), 401)
        }
      })
      .finally(() => {
        this.authPromise = null
      })
    return this.authPromise
  }

  private async loadOAuthAccessToken(forceRefresh: boolean): Promise<void> {
    const provider = this.oauthTokenProvider
    if (!provider) throw new IRacingApiError('unauthorized', 'OAuth is not configured.', 401)
    const token = await provider(forceRefresh)
    if (!token) throw new IRacingApiError('unauthorized', 'Token OAuth missing ou expirado.', 401)
    this.authedAt = Date.now()
  }

  // Pull the live iRacing cookies from the embedded-login partition and load
  // them into the jar. We do NOT require a known auth-cookie name here: iRacing's
  // real SSO cookie can be renamed or scoped to an OAuth sibling domain. The
  // following data request is the authoritative auth probe and will 401 if the
  // full captured jar is not actually logged in.
  private async loadBrowserSessionCookies(): Promise<void> {
    const provider = this.browserSessionProvider
    if (!provider) {
      throw new IRacingApiError('unauthorized', browserSessionMissingMessage(), 401)
    }
    let cookies: IRacingSessionCookie[]
    try {
      cookies = await provider()
    } catch (error) {
      throw new IRacingApiError('network', error instanceof Error ? error.message : String(error))
    }
    this.cookies.clear()
    for (const cookie of cookies) {
      if (cookie && cookie.name && typeof cookie.value === 'string') {
        this.cookies.set(cookieKey(cookie), {
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path
        })
      }
    }
    if (this.cookies.size === 0) {
      this.authedAt = null
      throw new IRacingApiError('unauthorized', browserSessionExpiredMessage(), 401)
    }
    this.authedAt = Date.now()
  }

  // Initial interactive login. Returns `{ status: 'mfa_required' }` when iRacing
  // wants a verification code (so the caller can prompt for it via
  // `completeMfa`), or `{ status: 'ok' }` once the session cookie is set. Hard
  // failures throw `IRacingApiError`.
  async login(): Promise<IRacingAuthOutcome> {
    return this.postAuth(undefined)
  }

  // Single-flight wrapper around `login()`, shared between the BOOT silent-login
  // and the data path's `authenticate()`. Both call this, so a data request that
  // arrives while a boot login is still in flight REUSES the same /auth POST
  // rather than issuing a second one into the same cookie jar (which would
  // overwrite the MFA challenge cookie and/or trip iRacing's 429 rate-limit).
  // Returns the outcome (incl. `mfa_required`) so the boot caller can park the
  // verification challenge.
  async loginShared(): Promise<IRacingAuthOutcome> {
    if (this.loginInFlight) return this.loginInFlight
    this.loginInFlight = this.login().finally(() => {
      this.loginInFlight = null
    })
    return this.loginInFlight
  }

  // Complete the MFA / verification-code challenge by re-POSTing /auth with the
  // SAME credentials plus the code. Reuses this instance's cookie jar so any
  // temporary challenge cookie from the first POST is replayed.
  async completeMfa(verificationCode: string): Promise<void> {
    const code = verificationCode.trim()
    if (!code) {
      throw new IRacingApiError('unauthorized', 'Verification code is required.', 401)
    }
    const outcome = await this.postAuth(code)
    if (outcome.status === 'mfa_required') {
      // iRacing still isn't satisfied — usually a wrong/expired code, or a true
      // browser CAPTCHA that an emailed code can't clear.
      throw new IRacingApiError('unauthorized', mfaRejectedMessage(), 401)
    }
  }

  // The single canonical /auth POST. `verificationCode` is included only on the
  // MFA completion step. Matches the documented contract exactly: a plain JSON
  // POST with a browser User-Agent — no redirect chasing, no header tricks.
  private async postAuth(verificationCode: string | undefined): Promise<IRacingAuthOutcome> {
    if (this.rateLimitedUntil && Date.now() < this.rateLimitedUntil) {
      throw new IRacingApiError(
        'rate-limited',
        `iRacing rate-limited until ${new Date(this.rateLimitedUntil).toISOString()}`,
        429
      )
    }

    const response = await this.authRequest(verificationCode)

    if (response.status === 429) {
      const retryAfterSec = Number(response.headers['retry-after']) || 60
      this.rateLimitedUntil = Date.now() + retryAfterSec * 1000
      throw new IRacingApiError(
        'rate-limited',
        'O iRacing limitou as tentativas de login (HTTP 429). Tente novamente em instantes.',
        429
      )
    }
    if (response.status === 401 || response.status === 403) {
      throw new IRacingApiError(
        'unauthorized',
        authErrorMessage(response.status, response.body),
        response.status
      )
    }
    if (response.status < 200 || response.status >= 300) {
      throw new IRacingApiError('http', authErrorMessage(response.status, response.body), response.status)
    }

    // 200 OK — but iRacing encodes success/failure/MFA inside the JSON body.
    let parsed: AuthResponseBody | null = null
    try {
      parsed = JSON.parse(response.body) as AuthResponseBody
    } catch {
      // No JSON body. Treat as authenticated only if a cookie was actually set.
      if (this.cookies.size > 0) {
        this.authedAt = Date.now()
        this.rateLimitedUntil = null
        this.mfaPending = false
        return { status: 'ok' }
      }
      throw new IRacingApiError('unauthorized', authErrorMessage(response.status, response.body), response.status)
    }

    // iRacing accepted the password but wants a verification code (MFA /
    // browser verification). Don't throw — let the caller prompt for the code.
    if (parsed.verificationRequired === true && !isAuthSuccess(parsed)) {
      this.mfaPending = true
      return { status: 'mfa_required', message: mfaMessage(parsed.message) }
    }

    if (!isAuthSuccess(parsed)) {
      throw new IRacingApiError('unauthorized', authErrorMessage(401, response.body), 401)
    }

    // Success. Prefer the Set-Cookie jar, but fall back to the SSO cookie the
    // body hands us so we never end up "authenticated with no cookie".
    if (parsed.ssoCookieName && parsed.ssoCookieValue && !this.cookies.has(parsed.ssoCookieName)) {
      this.cookies.set(parsed.ssoCookieName, { name: parsed.ssoCookieName, value: parsed.ssoCookieValue })
    }
    if (this.cookies.size === 0) {
      throw new IRacingApiError(
        'unauthorized',
        'iRacing authenticated but did not return a session cookie.',
        response.status
      )
    }
    this.authedAt = Date.now()
    this.rateLimitedUntil = null
    this.mfaPending = false
    return { status: 'ok' }
  }

  private async authRequest(verificationCode: string | undefined): Promise<RawResponse> {
    const payload: Record<string, string> = {
      email: this.email,
      password: this.hashedPassword
    }
    if (verificationCode) payload.verificationCode = verificationCode
    const body = JSON.stringify(payload)
    return this.rawRequest({
      method: 'POST',
      host: MEMBERS_NG_HOST,
      path: '/auth',
      headers: {
        'user-agent': AUTH_USER_AGENT,
        'content-type': 'application/json',
        accept: 'application/json',
        'content-length': Buffer.byteLength(body, 'utf8').toString()
      },
      body
    })
  }

  async listTracks(): Promise<IRacingTrack[]> {
    const link = await this.fetchLink('/data/track/get')
    const raw = await this.getJson(link)
    if (!Array.isArray(raw)) {
      throw new IRacingApiError('parse', '/data/track/get link did not return an array')
    }
    const tracks: IRacingTrack[] = []
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue
      const track = entry as Partial<IRacingTrack>
      if (typeof track.track_id !== 'number') continue
      if (typeof track.track_name !== 'string') continue
      tracks.push({
        track_id: track.track_id,
        track_name: track.track_name,
        config_name: typeof track.config_name === 'string' ? track.config_name : null,
        category: typeof track.category === 'string' ? track.category : undefined
      })
    }
    return tracks
  }

  async listTrackAssets(): Promise<Map<number, IRacingTrackAssets>> {
    const link = await this.fetchLink('/data/track/assets')
    const raw = await this.getJson(link)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new IRacingApiError('parse', '/data/track/assets link did not return an object')
    }
    const out = new Map<number, IRacingTrackAssets>()
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const idNum = Number(key)
      if (!Number.isFinite(idNum)) continue
      if (!value || typeof value !== 'object') continue
      const v = value as Partial<IRacingTrackAssets>
      if (typeof v.track_map !== 'string') continue
      if (!v.track_map_layers || typeof v.track_map_layers !== 'object') continue
      out.set(idNum, {
        track_id: idNum,
        // Always normalize to a trailing slash so callers can do
        // `track_map + layerFilename` without thinking about it.
        track_map: v.track_map.endsWith('/') ? v.track_map : `${v.track_map}/`,
        track_map_layers: { ...v.track_map_layers }
      })
    }
    return out
  }

  // Fetch a single SVG layer. The SVG URLs live on a public S3 bucket and do
  // not require auth, but going through the same helper keeps timeouts and
  // size caps consistent.
  async fetchSvgLayer(baseUrl: string, filename: string): Promise<string> {
    if (!filename) {
      throw new IRacingApiError('http', 'fetchSvgLayer: missing filename')
    }
    const url = new URL(filename, baseUrl)
    const response = await this.rawRequest({
      method: 'GET',
      host: url.host,
      path: `${url.pathname}${url.search}`,
      // S3 layers are public, no cookies needed.
      includeCookies: false
    })
    if (response.status < 200 || response.status >= 300) {
      throw new IRacingApiError(
        'http',
        `Failed to download SVG ${url.toString()} (${response.status})`,
        response.status
      )
    }
    return response.body
  }

  // ─── members-ng career endpoints (Career & Ratings Hub) ──────────────────
  // Every method below funnels through `fetchData`, which transparently follows
  // the `{ link }` → S3 indirection (or returns inline JSON for member/info),
  // and inherits the shared 401 re-auth + 429 backoff from `authedJsonRequest`.
  // Parsing is intentionally lenient: we validate the container shape and hand
  // back faithfully-typed rows; the career module guards every leaf field.

  // The authenticated member ("me"). Source of the cust_id that drives the rest
  // of the Hub when running in browser-session mode (no /auth body to read).
  async getMemberInfo(): Promise<IRacingMemberInfo> {
    const data = await this.fetchData('/data/member/info')
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new IRacingApiError('parse', '/data/member/info: unexpected payload')
    }
    if (typeof (data as Partial<IRacingMemberInfo>).cust_id !== 'number') {
      throw new IRacingApiError('parse', '/data/member/info: missing cust_id')
    }
    return data as IRacingMemberInfo
  }

  // Basic profile(s) + licenses for one or more members.
  async getMembers(custIds: number[], includeLicenses: boolean): Promise<IRacingMember[]> {
    const ids = custIds.filter((id) => Number.isFinite(id)).join(',')
    if (!ids) return []
    const data = await this.fetchData(
      this.buildPath('/data/member/get', {
        cust_ids: ids,
        include_licenses: includeLicenses ? 'true' : 'false'
      })
    )
    const members = (data as { members?: unknown } | null)?.members
    if (!Array.isArray(members)) return []
    return members.filter(
      (member): member is IRacingMember =>
        !!member && typeof member === 'object' && typeof (member as IRacingMember).cust_id === 'number'
    )
  }

  // Career stats, one entry per discipline.
  async getMemberCareer(custId: number): Promise<IRacingCareerStat[]> {
    const data = await this.fetchData(this.buildPath('/data/stats/member_career', { cust_id: custId }))
    const stats = (data as { stats?: unknown } | null)?.stats
    if (!Array.isArray(stats)) return []
    return stats.filter(
      (stat): stat is IRacingCareerStat =>
        !!stat && typeof stat === 'object' && typeof (stat as IRacingCareerStat).category_id === 'number'
    )
  }

  // A single rating time series. category_id: 1 Oval, 2 Road, 3 Dirt Oval,
  // 4 Dirt Road, 5 Sports Car, 6 Formula Car. chart_type: 1 iRating, 2 TT, 3 SR.
  async getMemberChartData(custId: number, categoryId: number, chartType: number): Promise<IRacingChartData> {
    const data = await this.fetchData(
      this.buildPath('/data/member/chart_data', {
        cust_id: custId,
        category_id: categoryId,
        chart_type: chartType
      })
    )
    const raw = (data && typeof data === 'object' ? data : {}) as Partial<IRacingChartData>
    const points = Array.isArray(raw.data)
      ? raw.data.filter(
          (point): point is IRacingChartPoint =>
            !!point && typeof point === 'object' && typeof (point as IRacingChartPoint).value === 'number'
        )
      : []
    return { category_id: categoryId, chart_type: chartType, data: points }
  }

  // The latest handful of races for a member (start/finish, incidents, iRating
  // and SR deltas, SOF, car/track).
  async getMemberRecentRaces(custId: number): Promise<IRacingRecentRace[]> {
    const data = await this.fetchData(
      this.buildPath('/data/stats/member_recent_races', { cust_id: custId })
    )
    const races = (data as { races?: unknown } | null)?.races
    if (!Array.isArray(races)) return []
    return races.filter(
      (race): race is IRacingRecentRace =>
        !!race && typeof race === 'object' && typeof (race as IRacingRecentRace).subsession_id === 'number'
    )
  }

  // Member stats summary → this-year official/league counts.
  async getMemberSummary(custId: number): Promise<IRacingThisYearSummary | null> {
    const data = await this.fetchData(this.buildPath('/data/stats/member_summary', { cust_id: custId }))
    const thisYear = (data as { this_year?: unknown } | null)?.this_year
    if (!thisYear || typeof thisYear !== 'object') return null
    return thisYear as IRacingThisYearSummary
  }

  // Car catalog (car_id → name). Rarely changes, so the career module caches it
  // with a long TTL.
  async getCars(): Promise<IRacingCar[]> {
    const data = await this.fetchData('/data/car/get')
    if (!Array.isArray(data)) return []
    return data.filter(
      (car): car is IRacingCar =>
        !!car && typeof car === 'object' && typeof (car as IRacingCar).car_id === 'number'
    )
  }

  // Optional per-race drill-down (full subsession result). Returns the raw
  // payload — the Hub only uses it opportunistically.
  async getSubsessionResult(subsessionId: number): Promise<unknown> {
    return this.fetchData(this.buildPath('/data/results/get', { subsession_id: subsessionId }))
  }

  // ─── New enrichment endpoints ──────────────────────────────────────────────

  // Per-year stats for a member across all disciplines.
  async getMemberYearlyStats(custId: number): Promise<IRacingYearlyStat[]> {
    const data = await this.fetchData(
      this.buildPath('/data/stats/member_yearly', { cust_id: custId })
    )
    const stats = (data as { stats?: unknown } | null)?.stats
    if (!Array.isArray(stats)) return []
    return stats.filter(
      (stat): stat is IRacingYearlyStat =>
        !!stat &&
        typeof stat === 'object' &&
        typeof (stat as IRacingYearlyStat).year === 'number' &&
        typeof (stat as IRacingYearlyStat).category_id === 'number'
    )
  }

  // Extended profile for a single member (helmet design, club, member_since).
  async getMemberProfile(custId: number): Promise<IRacingMemberProfile | null> {
    const data = await this.fetchData(
      this.buildPath('/data/member/profile', { cust_id: custId })
    )
    const profile = (data as { profile?: unknown } | null)?.profile ?? data
    if (!profile || typeof profile !== 'object') return null
    if (typeof (profile as Partial<IRacingMemberProfile>).cust_id !== 'number') return null
    return profile as IRacingMemberProfile
  }

  // Active seasons on iRacing. Callers should cache (changes weekly).
  async getSeriesSeasons(): Promise<IRacingSeasonSeries[]> {
    const data = await this.fetchData('/data/series/seasons')
    const seasons = (data as { seasons?: unknown } | null)?.seasons ?? data
    if (!Array.isArray(seasons)) return []
    return seasons.filter(
      (s): s is IRacingSeasonSeries =>
        !!s &&
        typeof s === 'object' &&
        typeof (s as IRacingSeasonSeries).season_id === 'number'
    )
  }

  // Leagues the member belongs to.
  async getLeagueMembership(custId: number): Promise<IRacingLeagueMembership[]> {
    const data = await this.fetchData(
      this.buildPath('/data/league/membership', {
        cust_id: custId,
        include_league: 'true'
      })
    )
    const memberships = (data as { memberships?: unknown } | null)?.memberships ?? data
    if (!Array.isArray(memberships)) return []
    return memberships.filter(
      (m): m is IRacingLeagueMembership =>
        !!m &&
        typeof m === 'object' &&
        typeof (m as IRacingLeagueMembership).league_id === 'number'
    )
  }

  // Division placement for a member in one category for the current season.
  async getMemberDivision(custId: number, categoryId: number): Promise<IRacingMemberDivision | null> {
    const data = await this.fetchData(
      this.buildPath('/data/stats/member_division', {
        cust_id: custId,
        event_type: 5,
        category_id: categoryId
      })
    )
    if (!data || typeof data !== 'object') return null
    const d = data as Partial<IRacingMemberDivision>
    if (typeof d.division !== 'number' && typeof d.rank !== 'number') return null
    return data as IRacingMemberDivision
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async fetchLink(path: string): Promise<string> {
    const response = await this.authedJsonRequest(path)
    if (!response || typeof response !== 'object') {
      throw new IRacingApiError('parse', `${path}: response is not an object`)
    }
    const link = (response as { link?: unknown }).link
    if (typeof link !== 'string' || !link) {
      throw new IRacingApiError('parse', `${path}: missing link field`)
    }
    return link
  }

  // Generic members-ng data fetch. Most endpoints answer with a `{ link }`
  // envelope pointing at a short-lived S3 object (fetched WITHOUT cookies);
  // a few (e.g. /data/member/info) return the JSON inline. This handles both,
  // and inherits the 401 re-auth + 429 backoff from `authedJsonRequest`.
  private async fetchData(path: string): Promise<unknown> {
    const response = await this.authedJsonRequest(path)
    if (response && typeof response === 'object' && !Array.isArray(response)) {
      const link = (response as { link?: unknown }).link
      if (typeof link === 'string' && link) {
        return this.getJson(link)
      }
    }
    return response
  }

  // Build a members-ng path with a properly-encoded query string.
  private buildPath(base: string, params: Record<string, string | number | boolean>): string {
    const search = Object.entries(params)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&')
    return search ? `${base}?${search}` : base
  }

  private async getJson(url: string): Promise<unknown> {
    const parsed = new URL(url)
    const response = await this.rawRequest({
      method: 'GET',
      host: parsed.host,
      path: `${parsed.pathname}${parsed.search}`,
      includeCookies: false
    })
    if (response.status < 200 || response.status >= 300) {
      throw new IRacingApiError('http', `GET ${url} failed (${response.status})`, response.status)
    }
    try {
      return JSON.parse(response.body) as unknown
    } catch (error) {
      throw new IRacingApiError(
        'parse',
        `GET ${url}: invalid JSON (${error instanceof Error ? error.message : String(error)})`
      )
    }
  }

  private async authedJsonRequest(path: string): Promise<unknown> {
    if (this.rateLimitedUntil && Date.now() < this.rateLimitedUntil) {
      throw new IRacingApiError('rate-limited', `GET ${path} skipped — rate-limited`, 429)
    }
    if (!this.isAuthed()) await this.authenticate()

    const doRequest = async (forceRefreshToken = false): Promise<unknown> => {
      const bearer = await this.getBearerToken(forceRefreshToken)
      const response = await this.rawRequest({
        method: 'GET',
        host: MEMBERS_NG_HOST,
        path,
        headers: bearer ? { authorization: `Bearer ${bearer}` } : undefined,
        includeCookies: bearer ? false : undefined
      })
      if (response.status === 401 || response.status === 403) {
        throw new IRacingApiError('unauthorized', `GET ${path} unauthorized`, response.status)
      }
      if (response.status === 429) {
        const retryAfterSec = Number(response.headers['retry-after']) || 60
        this.rateLimitedUntil = Date.now() + retryAfterSec * 1000
        throw new IRacingApiError('rate-limited', `GET ${path} rate-limited`, 429)
      }
      if (response.status < 200 || response.status >= 300) {
        throw new IRacingApiError('http', `GET ${path} failed (${response.status})`, response.status)
      }
      try {
        return JSON.parse(response.body) as unknown
      } catch (error) {
        throw new IRacingApiError(
          'parse',
          `GET ${path}: invalid JSON (${error instanceof Error ? error.message : String(error)})`
        )
      }
    }

    try {
      return await doRequest()
    } catch (error) {
      // One-shot re-auth on stale session cookies — the iRacing session is
      // short-lived (≈1h) so this is the common case after the app sleeps.
      if (error instanceof IRacingApiError && error.kind === 'unauthorized') {
        if (this.usesOAuth()) {
          return doRequest(true)
        }
        this.invalidate()
        await this.authenticate()
        return doRequest()
      }
      throw error
    }
  }

  async testMemberInfoRaw(): Promise<TrackMapDataApiDiagnostic> {
    const bearer = await this.getBearerToken(false).catch(() => null)
    if (!bearer && !this.usesOAuth() && !this.isAuthed()) {
      await this.authenticate().catch(() => undefined)
    }
    const selected = buildDataApiAuthHeaders(bearer, Array.from(this.cookies.values()))
    const response = await this.rawRequest({
      method: 'GET',
      host: MEMBERS_NG_HOST,
      path: '/data/member/info',
      headers: selected.headers,
      includeCookies: false
    })
    return { status: response.status, body: response.body, authMode: selected.authMode }
  }

  private async getBearerToken(forceRefresh: boolean): Promise<string | null> {
    if (!this.oauthTokenProvider) return null
    const token = await this.oauthTokenProvider(forceRefresh)
    if (token) this.authedAt = Date.now()
    return token
  }

  private rawRequest(opts: {
    method: 'GET' | 'POST'
    host: string
    path: string
    headers?: Record<string, string>
    body?: string
    includeCookies?: boolean
  }): Promise<RawResponse> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        'user-agent': USER_AGENT,
        accept: 'application/json, image/svg+xml, */*',
        'accept-encoding': 'gzip, deflate, br',
        ...(opts.headers ?? {})
      }
      if (opts.includeCookies !== false && this.cookies.size > 0) {
        const cookieHeader = buildCookieHeader(Array.from(this.cookies.values()))
        if (cookieHeader) headers.cookie = cookieHeader
      }

      const reqOpts: RequestOptions = {
        method: opts.method,
        host: opts.host,
        port: 443,
        path: opts.path,
        headers,
        timeout: REQUEST_TIMEOUT_MS
      }

      const req = httpsRequest(reqOpts, (res) => {
        const chunks: Buffer[] = []
        let totalBytes = 0
        let aborted = false

        // Persist cookies BEFORE the body lands so we can use them even if the
        // caller never reads `headers`.
        this.absorbCookies(res.headers['set-cookie'])

        res.on('data', (chunk: Buffer) => {
          if (aborted) return
          totalBytes += chunk.length
          if (totalBytes > MAX_BODY_BYTES) {
            aborted = true
            req.destroy(new IRacingApiError('http', `Response too large from ${opts.host}${opts.path}`))
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => {
          if (aborted) return
          const headersOut: Record<string, string> = {}
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === 'string') headersOut[key.toLowerCase()] = value
            else if (Array.isArray(value)) headersOut[key.toLowerCase()] = value.join(', ')
          }
          try {
            const bodyBuffer = decodeBody(Buffer.concat(chunks), headersOut['content-encoding'])
            resolve({
              status: res.statusCode ?? 0,
              headers: headersOut,
              body: bodyBuffer.toString('utf8')
            })
          } catch (error) {
            reject(
              new IRacingApiError(
                'parse',
                `Failed to decode response from ${opts.host}${opts.path}: ${error instanceof Error ? error.message : String(error)}`
              )
            )
          }
        })
        res.on('error', (err) => {
          reject(new IRacingApiError('network', err.message))
        })
      })

      req.on('timeout', () => {
        req.destroy(new IRacingApiError('aborted', `Request to ${opts.host}${opts.path} timed out`))
      })
      req.on('error', (err) => {
        if (err instanceof IRacingApiError) reject(err)
        else reject(new IRacingApiError('network', err.message))
      })
      if (opts.body) req.write(opts.body)
      req.end()
    })
  }

  private absorbCookies(setCookieHeaders: string[] | undefined): void {
    if (!setCookieHeaders) return
    for (const header of setCookieHeaders) {
      // Small set-cookie parser. Good enough for members-ng which always sends
      // standard `Name=Value; attr=...` strings. We also extract the expiry from
      // the `Expires`/`Max-Age` attribute so the session jar can be aged.
      const parts = header.split(';')
      const pair = (parts[0] ?? '').trim()
      const eq = pair.indexOf('=')
      if (eq <= 0) continue
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      if (!name) continue
      const expires = parseCookieExpiry(parts.slice(1))
      const cookie = expires !== undefined ? { name, value, expires } : { name, value }
      this.cookies.set(cookieKey(cookie), cookie)
    }
  }
}


function cookieKey(cookie: { name: string; domain?: string; path?: string }): string {
  return `${cookie.name};${cookie.domain ?? ''};${cookie.path ?? ''}`
}

// Build the outgoing `Cookie:` header for members-ng.iracing.com data requests.
// The jar is keyed by name;domain;path, so the same cookie NAME can appear for
// several iRacing domains (the browser-login capture reads members-ng, members,
// oauth and the parent domain). A real browser sends exactly ONE value per name,
// scoped to the target host — emitting duplicates (e.g. `__cf_bm=A; __cf_bm=B`)
// or an oauth-only cookie to members-ng can make Cloudflare/the API treat the
// request differently and 401 a session the Chromium probe accepted. De-dup by
// name, preferring the value whose domain best matches members-ng.iracing.com.
function cookieDomainScore(domain: string | undefined): number {
  const d = (domain ?? '').replace(/^\./, '').toLowerCase()
  if (d === 'members-ng.iracing.com') return 4
  if (d === '') return 3 // captured from our own members-ng Set-Cookie responses
  if (d === 'iracing.com') return 2 // parent domain → sent to every subdomain
  return 1 // members.iracing.com / oauth.iracing.com / other siblings
}

function buildCookieHeader(cookies: Array<{ name: string; value: string; domain?: string }>): string {
  const best = new Map<string, { value: string; score: number }>()
  for (const cookie of cookies) {
    if (!cookie.name || !cookie.value) continue
    const score = cookieDomainScore(cookie.domain)
    const current = best.get(cookie.name)
    if (!current || score > current.score) {
      best.set(cookie.name, { value: cookie.value, score })
    }
  }
  return Array.from(best.entries())
    .map(([name, entry]) => `${name}=${entry.value}`)
    .join('; ')
}

export function buildDataApiAuthHeaders(
  accessToken: string | null | undefined,
  cookies: Array<{ name: string; value: string; domain?: string }>
): { headers: Record<string, string>; authMode: 'oauth' | 'cookie' | 'none' } {
  if (accessToken) return { headers: { authorization: `Bearer ${accessToken}` }, authMode: 'oauth' }
  const cookie = buildCookieHeader(cookies)
  if (cookie) return { headers: { cookie }, authMode: 'cookie' }
  return { headers: {}, authMode: 'none' }
}

// Parse the expiry (epoch ms) from a Set-Cookie attribute list, preferring the
// earliest of `Max-Age` / `Expires`. Returns undefined for session cookies.
function parseCookieExpiry(attributes: string[]): number | undefined {
  let expires: number | undefined
  for (const attr of attributes) {
    const trimmed = attr.trim()
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim().toLowerCase()
    const val = trimmed.slice(eq + 1).trim()
    if (key === 'max-age') {
      const secs = Number(val)
      if (Number.isFinite(secs)) {
        const candidate = Date.now() + secs * 1000
        expires = expires === undefined ? candidate : Math.min(expires, candidate)
      }
    } else if (key === 'expires') {
      const ts = Date.parse(val)
      if (Number.isFinite(ts)) {
        expires = expires === undefined ? ts : Math.min(expires, ts)
      }
    }
  }
  return expires
}


function decodeBody(body: Buffer, contentEncoding: string | undefined): Buffer {
  const encoding = contentEncoding?.split(',')[0]?.trim().toLowerCase()
  switch (encoding) {
    case 'gzip':
      return gunzipSync(body)
    case 'deflate':
      return inflateSync(body)
    case 'br':
      return brotliDecompressSync(body)
    default:
      return body
  }
}

// Clear, actionable (PT-BR) messages for a failed /auth so TrackMapSetup can
// show exactly what to do. The telemetry-learned map keeps working regardless.
function authErrorMessage(status: number, detail?: string): string {
  const trimmed = detail?.trim()
  const suffix = trimmed ? `\n\nExact iRacing response:\n${trimmed}` : ''
  const guide =
    'To use email+password, enable “Legacy read-only authentication” in iRacing → Account → Security. ' +
    'This is required even for accounts without MFA/2FA. Alternatively, use Browser Login.'
  if (status === 405) {
    return (
      `iRacing login failed (HTTP 405). The login endpoint rejected the request — ` +
      'usually because iRacing requires browser verification (CAPTCHA/2FA) for this network, or ' +
      `because legacy/read-only authentication is disabled. ${guide} ` +
      `The offline map (telemetry) keeps working without login.${suffix}`
    )
  }
  return (
    `iRacing login failed (HTTP ${status}). Check your email and password. ${guide} ` +
    `The offline map (telemetry) keeps working without login.${suffix}`
  )
}

// iRacing returns 200 even for bad credentials. A real success has a non-zero
// `authcode` (string or number); failures carry `authcode: 0`.
function isAuthSuccess(body: AuthResponseBody): boolean {
  const code = body.authcode
  return code !== undefined && code !== null && code !== 0 && code !== '0'
}

// PT-BR prompt shown when iRacing asks for a verification code. Prefer iRacing's
// own message when it sends one.
function mfaMessage(serverMessage?: string): string {
  const trimmed = serverMessage?.trim()
  if (trimmed) return trimmed
  return 'iRacing requested a verification code (MFA). Enter the sent code to complete login.'
}

function mfaRejectedMessage(): string {
  return (
    'Verification code is invalid or expired. If iRacing requires verification by ' +
    'browser (CAPTCHA), complete login once on the iRacing website and try again.'
  )
}

// Shown when the data API is asked to authenticate in browser-session mode but
// no provider is wired (should not happen in practice — defensive only).
function browserSessionMissingMessage(): string {
  return (
    'iRacing browser session unavailable. Click "Sign in to iRacing (open login)" to ' +
    'sign in and capture the session.'
  )
}

// Shown when the captured browser session has no valid auth cookie anymore.
function browserSessionExpiredMessage(): string {
  return (
    'The iRacing session expired. Click "Sign in to iRacing (open login)" to sign in ' +
    'again. The offline map (telemetry) keeps working without login.'
  )
}

// ─── Pure helpers — name matching ───────────────────────────────────────────
// trackName from the sim is a free-form display string (e.g. "Spa-Francorchamps
// - Grand Prix Pits"). We have to map it back onto the catalog's
// (track_name, config_name) pair. Strategy:
//   1. Normalize both strings (lowercase, strip punctuation, collapse spaces).
//   2. Try an exact "track + config" match first.
//   3. Fall back to a token-set similarity (Jaccard over normalized tokens),
//      requiring a minimum overlap so we never silently bind to the wrong
//      circuit.

export function normalizeTrackString(value: string | undefined | null): string {
  if (!value) return ''
  return value
    .toLowerCase()
    // Replace common separators with spaces and drop punctuation.
    .replace(/[\u2013\u2014_/-]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(value: string): Set<string> {
  if (!value) return new Set()
  return new Set(value.split(' ').filter((t) => t.length > 1))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection += 1
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

export interface TrackMatch {
  track: IRacingTrack
  score: number
}

// Picks the most likely (track_id) for a sim-reported `trackName`. Returns
// null when the best candidate's score sits below the safety threshold — the
// caller should then fall back to the learned map rather than render the wrong
// circuit. The score is in [0, 1] (1 means an exact "name + config" match).
export function matchTrackName(
  trackName: string | undefined | null,
  catalog: IRacingTrack[]
): TrackMatch | null {
  const normalizedQuery = normalizeTrackString(trackName)
  if (!normalizedQuery) return null

  const queryTokens = tokenize(normalizedQuery)
  let best: TrackMatch | null = null

  for (const track of catalog) {
    const fullName = normalizeTrackString(
      track.config_name ? `${track.track_name} ${track.config_name}` : track.track_name
    )
    if (!fullName) continue

    // Exact full-name match wins immediately and short-circuits the loop.
    if (fullName === normalizedQuery) {
      return { track, score: 1 }
    }

    const candidateTokens = tokenize(fullName)
    const score = jaccard(queryTokens, candidateTokens)

    // Mild bonus when the candidate's track_name appears as a substring of the
    // query — protects e.g. "Spa-Francorchamps - Grand Prix Pits" → Spa GP.
    const baseName = normalizeTrackString(track.track_name)
    const containmentBonus = baseName && normalizedQuery.includes(baseName) ? 0.1 : 0

    const total = Math.min(1, score + containmentBonus)
    if (!best || total > best.score) {
      best = { track, score: total }
    }
  }

  // Reject the match unless we cleared a confidence floor. 0.45 covers typical
  // sim ↔ catalog differences ("Long Beach Street Circuit" vs. "Long Beach")
  // while still rejecting unrelated names that share a single token.
  if (!best || best.score < 0.45) return null
  return best
}
