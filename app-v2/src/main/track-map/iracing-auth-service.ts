import type { BrowserWindow } from 'electron'
import { EventEmitter } from 'node:events'

import {
  type TrackMapAuthResult,
  type TrackMapAuthStatus,
  type TrackMapBrowserLoginResult,
  type TrackMapCredentialsInput,
  type TrackMapDataApiDiagnostic,
  type TrackMapLoginMethod,
  type TrackMapMfaInput,
  type TrackMapOAuthConfig,
  type TrackMapStatus
} from '../../shared/track-map'
import {
  BrowserSessionStore,
  clearIRacingSession,
  getIRacingAuthCookieExpiry,
  openIRacingLoginWindow,
  persistIRacingSessionCookies,
  readIRacingSessionCookies,
  verifyIRacingSession,
  type BrowserLoginResult,
  type IRacingSessionVerdict
} from './browser-login'
import { IRacingApi, IRacingApiError, hashIRacingPassword } from './iracing-api'
import { IRacingOAuthService } from './oauth'
import { IRacingSessionStore } from './session-store'
import { CredentialsStore, type StoredCredentials } from './store'

type AuthChangedListener = () => void

export interface SharedIRacingAuthSnapshot {
  auth: TrackMapAuthStatus
  email?: string
  lastAuthAt?: number
  lastErrorMessage?: string
  encryptionAvailable: boolean
  loginMethod?: TrackMapLoginMethod
  sessionExpiresAt?: number
  oauthConfigured?: boolean
  oauthClientId?: string
  dataApiAvailable?: boolean
  dataApiMessage?: string
}

export class SharedIRacingAuthService {
  private readonly credentialsStore: CredentialsStore
  private readonly browserSessionStore: BrowserSessionStore
  private readonly passwordSessionStore: IRacingSessionStore
  private readonly oauth: IRacingOAuthService
  private readonly events = new EventEmitter()

  private api: IRacingApi | null = null
  private credentials: StoredCredentials | null = null
  private pendingMfa: { api: IRacingApi; credentials: StoredCredentials } | null = null
  private authStatus: TrackMapAuthStatus = 'unconfigured'
  private lastErrorMessage: string | undefined
  private lastAuthAt: number | undefined
  private loginMethod: TrackMapLoginMethod | null = null
  private browserSessionExpiresAt: number | undefined
  private passwordSessionExpiresAt: number | undefined
  private browserLoginInFlight: Promise<TrackMapBrowserLoginResult> | null = null
  private oauthLoginInFlight: Promise<TrackMapBrowserLoginResult> | null = null
  private bootstrapInFlight: Promise<void> | null = null
  private bootstrapped = false
  private dataApiAvailable = false

  constructor(userDataPath: string) {
    this.credentialsStore = new CredentialsStore(userDataPath)
    this.browserSessionStore = new BrowserSessionStore(userDataPath)
    this.passwordSessionStore = new IRacingSessionStore(userDataPath)
    this.oauth = new IRacingOAuthService(userDataPath)
  }

  onChanged(listener: AuthChangedListener): () => void {
    this.events.on('changed', listener)
    return () => this.events.off('changed', listener)
  }

  getApi(): IRacingApi | null {
    return this.effectiveAuthStatus() === 'ready' ? this.api : null
  }

  getLastErrorMessage(): string | undefined {
    return this.lastErrorMessage
  }

  async bootstrap(): Promise<void> {
    if (this.bootstrapped) return
    if (this.bootstrapInFlight) return this.bootstrapInFlight
    this.bootstrapInFlight = this.doBootstrap().finally(() => {
      this.bootstrapInFlight = null
      this.bootstrapped = true
    })
    return this.bootstrapInFlight
  }

  private async doBootstrap(): Promise<void> {
    await this.loadCredentialsFromDisk()
    await this.loadOAuthFromDisk()
    await this.loadBrowserSession()
    this.emitChanged()
  }

  async getOAuthConfig(): Promise<TrackMapOAuthConfig | null> {
    await this.oauth.load().catch(() => undefined)
    return this.oauth.getConfig()
  }

  async setOAuthConfig(input: TrackMapOAuthConfig): Promise<TrackMapOAuthConfig> {
    const saved = await this.oauth.saveConfig(input)
    if (!saved.clientId && this.loginMethod === 'oauth') {
      this.api = null
      this.loginMethod = null
      this.setAuthStatus('unconfigured', 'oauth client_id cleared')
    }
    this.emitChanged()
    return saved
  }

  async oauthLogin(parent: BrowserWindow | null, buildStatus: () => TrackMapStatus): Promise<TrackMapBrowserLoginResult> {
    if (this.oauthLoginInFlight) return this.oauthLoginInFlight
    const work = this.runOAuthLogin(parent, buildStatus).finally(() => {
      this.oauthLoginInFlight = null
    })
    this.oauthLoginInFlight = work
    return work
  }

  async testDataApi(): Promise<TrackMapDataApiDiagnostic> {
    const api = this.api ?? this.createBestAvailableApi()
    if (!api) return { status: 0, body: 'No session/cookie/token available.', authMode: 'none' }
    return api.testMemberInfoRaw()
  }

  async setCredentials(input: TrackMapCredentialsInput, buildStatus: () => TrackMapStatus): Promise<TrackMapAuthResult> {
    if (!input || typeof input.email !== 'string' || typeof input.password !== 'string') {
      throw new Error('Email and password are required.')
    }
    const email = input.email.trim()
    if (!email) throw new Error('Email is required.')
    if (!input.password) throw new Error('Password is required.')

    const hashedPassword = hashIRacingPassword(email, input.password)
    const creds: StoredCredentials = { email, hashedPassword, savedAt: Date.now() }
    const probe = new IRacingApi(creds.email, creds.hashedPassword)
    this.pendingMfa = null
    this.setAuthStatus('authenticating', 'password login started')
    this.emitChanged()

    let outcome: Awaited<ReturnType<IRacingApi['login']>>
    try {
      outcome = await probe.login()
    } catch (error) {
      this.handleApiError(error)
      this.emitChanged()
      throw error
    }

    if (outcome.status === 'mfa_required') {
      this.pendingMfa = { api: probe, credentials: creds }
      this.setAuthStatus('mfa-required', 'password login needs verification code')
      this.lastErrorMessage = undefined
      this.emitChanged()
      return { status: 'mfa_required', message: outcome.message, trackMap: buildStatus() }
    }

    await this.finalizePasswordAuth(probe, creds)
    this.emitChanged()
    return { status: 'ok', trackMap: buildStatus() }
  }

  async submitMfa(input: TrackMapMfaInput, buildStatus: () => TrackMapStatus): Promise<TrackMapAuthResult> {
    const code = typeof input?.code === 'string' ? input.code.trim() : ''
    if (!code) throw new Error('Enter the verification code sent by iRacing.')
    if (!this.pendingMfa) {
      throw new Error('No pending verification. Sign in again to receive a new code.')
    }
    const { api, credentials } = this.pendingMfa
    this.setAuthStatus('authenticating', 'submitting verification code')
    this.emitChanged()
    try {
      await api.completeMfa(code)
    } catch (error) {
      this.handleApiError(error)
      this.emitChanged()
      throw error
    }
    await this.finalizePasswordAuth(api, credentials)
    this.emitChanged()
    return { status: 'ok', trackMap: buildStatus() }
  }

  async browserLogin(parent: BrowserWindow | null, buildStatus: () => TrackMapStatus): Promise<TrackMapBrowserLoginResult> {
    if (this.browserLoginInFlight) return this.browserLoginInFlight
    const work = this.runBrowserLogin(parent, buildStatus).finally(() => {
      this.browserLoginInFlight = null
    })
    this.browserLoginInFlight = work
    return work
  }

  async clear(): Promise<void> {
    await this.credentialsStore.clear()
    await this.passwordSessionStore.clear().catch(() => undefined)
    await this.browserSessionStore.clear().catch(() => undefined)
    await this.oauth.clear().catch(() => undefined)
    await clearIRacingSession().catch(() => undefined)
    this.credentials = null
    this.pendingMfa = null
    this.api?.invalidate()
    this.api = null
    this.loginMethod = null
    this.browserSessionExpiresAt = undefined
    this.passwordSessionExpiresAt = undefined
    this.authStatus = 'unconfigured'
    this.lastAuthAt = undefined
    this.lastErrorMessage = undefined
    this.dataApiAvailable = false
    this.emitChanged()
  }

  handleApiError(error: unknown): void {
    if (error instanceof IRacingApiError) {
      this.lastErrorMessage = error.message
      switch (error.kind) {
        case 'unauthorized':
          this.dataApiAvailable = false
          this.setAuthStatus('needs-login', error.message)
          break
        case 'rate-limited':
          this.setAuthStatus('rate-limited', error.message)
          break
        default:
          this.setAuthStatus('error', error.message)
      }
    } else {
      this.lastErrorMessage = error instanceof Error ? error.message : String(error)
      this.setAuthStatus('error', this.lastErrorMessage)
    }
    this.emitChanged()
  }

  buildSnapshot(): SharedIRacingAuthSnapshot {
    return {
      auth: this.effectiveAuthStatus(),
      email: this.statusIdentity(),
      lastAuthAt: this.lastAuthAt,
      lastErrorMessage: this.lastErrorMessage,
      encryptionAvailable: this.credentialsStore.encryptionAvailable(),
      loginMethod: this.loginMethod ?? undefined,
      sessionExpiresAt:
        this.loginMethod === 'browser'
          ? this.browserSessionExpiresAt
          : this.loginMethod === 'password'
            ? this.passwordSessionExpiresAt
            : undefined,
      oauthConfigured: this.oauth.hasClientId(),
      oauthClientId: this.oauth.getConfig()?.clientId,
      dataApiAvailable: this.dataApiAvailable,
      dataApiMessage: this.dataApiAvailable ? undefined : honestDataApiMessage()
    }
  }

  async persistSessionForQuit(): Promise<void> {
    if (this.loginMethod === 'password' && this.api?.isAuthed()) {
      await this.persistPasswordSession(this.api)
    }
  }

  private async loadCredentialsFromDisk(): Promise<void> {
    if (!this.credentialsStore.encryptionAvailable()) {
      this.setAuthStatus('disabled', 'safeStorage unavailable for password login')
      return
    }
    const creds = await this.credentialsStore.load()
    if (!creds) {
      this.setAuthStatus('unconfigured', 'no stored password credentials')
      return
    }
    this.credentials = creds
    const api = new IRacingApi(creds.email, creds.hashedPassword)
    this.api = api
    this.loginMethod = 'password'

    const session = await this.passwordSessionStore.load().catch(() => null)
    const sessionValid =
      !!session &&
      session.cookies.length > 0 &&
      (session.expiresAt === undefined || session.expiresAt > Date.now())
    if (sessionValid && session) {
      api.seedCookies(session.cookies)
      this.passwordSessionExpiresAt = session.expiresAt
      this.lastAuthAt = session.capturedAt || Date.now()
      this.setAuthStatus('ready', 'boot: adopted persisted password session')
      return
    }

    this.setAuthStatus('authenticating', 'boot: stored creds, attempting silent re-login')
    void this.attemptSilentLogin(api, creds)
  }

  private async attemptSilentLogin(api: IRacingApi, creds: StoredCredentials): Promise<void> {
    try {
      const outcome = await api.loginShared()
      if (outcome.status === 'mfa_required') {
        this.pendingMfa = { api, credentials: creds }
        this.setAuthStatus('mfa-required', 'boot: silent re-login needs a verification code')
        this.lastErrorMessage = undefined
        this.emitChanged()
        return
      }
      await this.finalizePasswordAuth(api, creds)
      this.emitChanged()
    } catch (error) {
      this.handleApiError(error)
      await this.loadBrowserSession().catch(() => undefined)
      this.emitChanged()
    }
  }

  private async loadBrowserSession(): Promise<void> {
    if (
      (this.loginMethod === 'oauth' || this.loginMethod === 'password') &&
      (this.authStatus === 'ready' ||
        this.authStatus === 'authenticating' ||
        this.authStatus === 'mfa-required')
    ) {
      return
    }

    const marker = await this.browserSessionStore.load().catch(() => null)
    let expiresAt = marker?.expiresAt
    try {
      const liveExpiry = await getIRacingAuthCookieExpiry()
      if (liveExpiry) expiresAt = liveExpiry
    } catch {
      // Keep marker expiry.
    }
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      this.loginMethod = 'browser'
      this.browserSessionExpiresAt = expiresAt
      this.setAuthStatus('needs-login', 'boot: browser session marker expired')
      return
    }

    const verdict: IRacingSessionVerdict = await verifyIRacingSession().catch(
      (): IRacingSessionVerdict => 'unknown'
    )
    if (verdict !== 'authed') {
      this.loginMethod = 'browser'
      this.browserSessionExpiresAt = expiresAt
      this.dataApiAvailable = false
      this.lastErrorMessage = honestDataApiMessage()
      this.setAuthStatus('needs-login', `boot: /data/member/info probe ${verdict}`)
      return
    }

    const cookies = await readIRacingSessionCookies().catch(() => [])
    if (cookies.length === 0 && !marker) return

    const api = this.createBrowserApi()
    this.installBrowserApi(api, expiresAt)
    console.log('[iracing-auth] boot: adopted verified browser session')
  }

  private async runBrowserLogin(parent: BrowserWindow | null, buildStatus: () => TrackMapStatus): Promise<TrackMapBrowserLoginResult> {
    const previousStatus = this.authStatus
    this.setAuthStatus('authenticating', 'browser login window opening')
    this.lastErrorMessage = undefined
    this.emitChanged()

    let result: BrowserLoginResult
    try {
      result = await openIRacingLoginWindow({ parent })
    } catch (error) {
      this.setAuthStatus(
        this.loginMethod === 'browser' && this.api ? 'ready' : previousStatus,
        'browser login window threw'
      )
      this.lastErrorMessage = error instanceof Error ? error.message : String(error)
      this.emitChanged()
      return { status: 'cancelled', message: this.lastErrorMessage, trackMap: buildStatus() }
    }

    if (result.status !== 'ok') {
      this.setAuthStatus(
        this.loginMethod === 'browser' && this.api ? 'ready' : previousStatus,
        `browser login ${result.reason ?? 'cancelled'}`
      )
      this.emitChanged()
      return {
        status: 'cancelled',
        message: browserLoginCancelledMessage(result.reason),
        trackMap: buildStatus(),
        diagnostics: result.diagnostics
      }
    }

    const api = this.createBrowserApi()
    const expiresAt =
      result.authCookieExpiresAt ?? (await getIRacingAuthCookieExpiry().catch(() => undefined))
    await this.browserSessionStore
      .save({ version: 1, capturedAt: Date.now(), expiresAt })
      .catch(() => undefined)

    try {
      await api.authenticate()
      await api.getMemberInfo()
      this.installBrowserApi(api, expiresAt)
      this.emitChanged()
      return { status: 'ok', trackMap: buildStatus(), diagnostics: result.diagnostics }
    } catch (error) {
      this.api = null
      this.loginMethod = 'browser'
      this.browserSessionExpiresAt = expiresAt
      this.dataApiAvailable = false
      this.lastAuthAt = Date.now()
      this.lastErrorMessage = honestDataApiMessage()
      this.setAuthStatus('needs-login', 'browser login returned; data api probe failed')
      this.emitChanged()
      return {
        status: 'ok',
        message: honestDataApiMessage(),
        trackMap: buildStatus(),
        diagnostics: result.diagnostics
      }
    }
  }

  private async finalizePasswordAuth(api: IRacingApi, creds: StoredCredentials): Promise<void> {
    await this.credentialsStore.save(creds)
    this.credentials = creds
    this.api = api
    this.pendingMfa = null
    this.loginMethod = 'password'
    this.browserSessionExpiresAt = undefined
    this.setAuthStatus('ready', 'password session active')
    this.dataApiAvailable = true
    this.lastAuthAt = api.lastAuthAt() ?? Date.now()
    this.lastErrorMessage = undefined
    await this.persistPasswordSession(api)
  }

  private async persistPasswordSession(api: IRacingApi): Promise<void> {
    try {
      const cookies = api.exportCookies()
      if (cookies.length === 0) return
      const expiresAt = api.authCookieExpiresAt()
      this.passwordSessionExpiresAt = expiresAt
      await this.passwordSessionStore.save({
        version: 1,
        cookies,
        expiresAt,
        capturedAt: Date.now()
      })
    } catch {
      // Best-effort optimization.
    }
  }

  private installBrowserApi(api: IRacingApi, expiresAt: number | undefined): void {
    this.api = api
    this.pendingMfa = null
    this.loginMethod = 'browser'
    this.browserSessionExpiresAt = expiresAt
    this.setAuthStatus('ready', 'browser session active')
    this.dataApiAvailable = true
    this.lastErrorMessage = undefined
    this.lastAuthAt = Date.now()
  }

  private async loadOAuthFromDisk(): Promise<void> {
    await this.oauth.load().catch(() => undefined)
    if (!this.oauth.hasClientId() || !this.oauth.hasTokens()) return
    const api = this.createOAuthApi()
    this.api = api
    this.loginMethod = 'oauth'
    this.setAuthStatus('ready', 'boot: oauth token available')
    this.lastAuthAt = Date.now()
    this.lastErrorMessage = undefined
    this.dataApiAvailable = true
  }

  private createOAuthApi(): IRacingApi {
    const api = new IRacingApi('', '')
    api.useOAuthTokens((forceRefresh) => this.oauth.getAccessToken(Boolean(forceRefresh)))
    return api
  }

  private createBrowserApi(): IRacingApi {
    const api = new IRacingApi('', '')
    api.useBrowserSession(readIRacingSessionCookies)
    return api
  }

  private createBestAvailableApi(): IRacingApi | null {
    if (this.oauth.hasClientId() && this.oauth.hasTokens()) return this.createOAuthApi()
    return this.createBrowserApi()
  }

  private async runOAuthLogin(parent: BrowserWindow | null, buildStatus: () => TrackMapStatus): Promise<TrackMapBrowserLoginResult> {
    this.setAuthStatus('authenticating', 'oauth login started')
    this.lastErrorMessage = undefined
    this.emitChanged()
    try {
      await this.oauth.authorize(parent)
      const api = this.createOAuthApi()
      await api.authenticate()
      this.api = api
      this.loginMethod = 'oauth'
      this.pendingMfa = null
      this.setAuthStatus('ready', 'oauth session active')
      this.lastAuthAt = Date.now()
      this.lastErrorMessage = undefined
      this.dataApiAvailable = true
      this.emitChanged()
      return { status: 'ok', trackMap: buildStatus() }
    } catch (error) {
      this.lastErrorMessage = error instanceof Error ? error.message : String(error)
      this.setAuthStatus(this.api ? 'ready' : 'needs-login', 'oauth login failed')
      this.emitChanged()
      return { status: 'cancelled', message: this.lastErrorMessage, trackMap: buildStatus() }
    }
  }

  private setAuthStatus(next: TrackMapAuthStatus, reason: string): void {
    if (this.authStatus !== next) {
      console.log(`[iracing-auth] auth ${this.authStatus} → ${next} (${reason})`)
    }
    this.authStatus = next
  }

  private effectiveAuthStatus(): TrackMapAuthStatus {
    if (
      this.authStatus === 'ready' &&
      this.loginMethod === 'browser' &&
      this.browserSessionExpiresAt !== undefined &&
      this.browserSessionExpiresAt <= Date.now()
    ) {
      return 'needs-login'
    }
    return this.authStatus
  }

  private statusIdentity(): string | undefined {
    if (this.loginMethod === 'browser') return 'Browser session (iRacing)'
    return this.credentials?.email
  }

  private emitChanged(): void {
    this.events.emit('changed')
  }
}

let sharedService: SharedIRacingAuthService | null = null

export function getSharedIRacingAuthService(userDataPath: string): SharedIRacingAuthService {
  if (!sharedService) sharedService = new SharedIRacingAuthService(userDataPath)
  return sharedService
}

function browserLoginCancelledMessage(reason: BrowserLoginResult['reason']): string {
  if (reason === 'timeout') {
    return (
      'The iRacing login expired due to inactivity. You can try again whenever you want — the map ' +
      'offline (telemetria) continua funcionando sem login.'
    )
  }
  if (reason === 'failed') {
    return (
      'Could not open the iRacing login page. Check your connection and try again. ' +
      'The offline map (telemetry) keeps working without login.'
    )
  }
  return 'Login cancelado. The offline map (telemetry) keeps working without login.'
}

export function honestDataApiMessage(): string {
  return (
    'O iRacing desativou o login legado e pausou o registro de apps de terceiros na Data API. ' +
    'Telemetry features (map, radar, relatives, dashboards, and overlays) work normally without login.'
  )
}
