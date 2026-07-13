// Track-map module entrypoint.
//
// Responsibilities:
//   • Hydrate the offline learner so its cached laps are available immediately.
//   • Hydrate iRacing credentials from disk and prepare an API client lazily.
//   • Subscribe to telemetry: feed the learner, watch for trackName changes,
//     and resolve the active track to the right cached SVG (downloading +
//     caching on the fly if needed).
//   • Expose IPC channels declared in `src/shared/track-map.ts`:
//       - trackmap:getForCurrentTrack
//       - trackmap:getForTrack            (testing/inspection helper)
//       - trackmap:setCredentials
//       - trackmap:clearCredentials
//       - trackmap:getStatus
//       - trackmap:refresh
//     ...and broadcast `trackmap:updated` whenever the cached map changes.
//
// We never block telemetry handling on network I/O: the iRacing fetch runs in
// a background task, and the learner is always ready to provide a fallback.

import type { TelemetrySnapshot } from '../../shared/telemetry'
import {
  TRACK_MAP_CHANNELS,
  type TrackMapAuthResult,
  type TrackMapAuthStatus,
  type TrackMapBrowserLoginResult,
  type TrackMapCredentialsInput,
  type TrackMapDataApiDiagnostic,
  type TrackMapData,
  type TrackMapLoginMethod,
  type TrackMapLayoutLookup,
  type TrackMapMfaInput,
  type TrackMapOAuthConfig,
  type TrackMapStatus,
  type TrackMapSvgLayers,
  type TrackMapViewBox
} from '../../shared/track-map'
import type { ModuleContext } from '../module-context'
import {
  BrowserSessionStore,
  clearIRacingSession,
  getIRacingAuthCookieExpiry,
  hasIRacingAuthCookie,
  openIRacingLoginWindow,
  persistIRacingSessionCookies,
  readIRacingSessionCookies,
  verifyIRacingSession,
  type BrowserLoginResult,
  type IRacingSessionVerdict
} from './browser-login'
import {
  IRacingApi,
  IRacingApiError,
  hashIRacingPassword,
  type IRacingTrack
} from './iracing-api'
import { getSharedIRacingAuthService, type SharedIRacingAuthService } from './iracing-auth-service'
import { TrackMapLearner } from './learner'
import { logger } from '../modules/logger'
import { IRacingSessionStore } from './session-store'
import {
  CredentialsStore,
  TrackAssetsCache,
  assetsToLayerMap,
  type CachedAssetWithSvg,
  type StoredCredentials
} from './store'
import {
  captureTrackLayout,
  findCatalogLayout,
  trackLayoutFromCatalog,
  trackLayoutFromSnapshot,
  type TrackCatalogLayout,
  type TrackLayoutIdentity
} from './types'

// ─── State container ────────────────────────────────────────────────────────
// Keeping this in a class makes it cheap to reason about lifetime, but the
// public surface is just `register(ctx)`.
interface LayoutResolveRequest {
  readonly layout: TrackLayoutIdentity
  readonly revision: number
  readonly force: boolean
  readonly token: string
}

export class TrackMapModule {
  private readonly ctx: ModuleContext
  private readonly credentialsStore: CredentialsStore
  private readonly browserSessionStore: BrowserSessionStore
  private readonly passwordSessionStore: IRacingSessionStore
  private readonly assetsCache: TrackAssetsCache
  private readonly learner: TrackMapLearner
  private readonly auth: SharedIRacingAuthService

  private api: IRacingApi | null = null
  private credentials: StoredCredentials | null = null
  // Holds the in-flight login that is waiting on a verification code. We keep
  // the SAME IRacingApi instance (and its cookie jar) so `submitMfa` can replay
  // any temporary challenge cookie. Only the hashed password is retained here —
  // never the plaintext.
  private pendingMfa: { api: IRacingApi; credentials: StoredCredentials } | null = null
  private authStatus: TrackMapAuthStatus = 'unconfigured'
  private lastErrorMessage: string | undefined
  private lastAuthAt: number | undefined
  // Which auth path is currently active. 'browser' (captured web session) is the
  // primary path; 'password' is the legacy headless login. null when logged out.
  private loginMethod: TrackMapLoginMethod | null = null
  // Expiry (epoch ms) of the captured browser session cookie, when iRacing set
  // one. Used to surface "session expired → re-login" without a network call.
  private browserSessionExpiresAt: number | undefined
  // Expiry (epoch ms) of the persisted PASSWORD-mode session cookie, when iRacing
  // sent one. Surfaced as `sessionExpiresAt` for the password login path.
  private passwordSessionExpiresAt: number | undefined
  // De-dupes concurrent embedded-login requests so only one window opens.
  private browserLoginInFlight: Promise<TrackMapBrowserLoginResult> | null = null

  // Catalog (track_id → name) — cached on disk and refreshed lazily.
  private catalog: IRacingTrack[] = []
  private catalogFresh = false
  // Resolved SVGs are isolated by canonical layout key, never display name.
  private resolvedSvgByLayout = new Map<string, CachedAssetWithSvg>()
  // Tracks we already tried to resolve in this session — prevents repeated
  // download attempts when iRacing simply doesn't ship a map for that circuit.
  private resolutionAttempted = new Set<string>()
  private currentLayout: TrackLayoutIdentity | undefined
  private currentLayoutRevision = 0
  // Coalesce concurrent resolves for the same captured layout revision.
  private resolveInflight = new Map<string, Promise<void>>()
  // Throttle state for the live recording broadcast — telemetry ticks at 30 Hz
  // but the UI only needs the growing trace a few times per second.
  private lastRecordingBroadcastAt = 0
  private lastRecordingActive = false
  private lastRecordingProgress = -1
  // Last learner reason+phase we broadcast, so a STALL (e.g. too-slow / no
  // position data) surfaces to the UI status even when nothing is recording.
  private lastLearnSignature = ''

  constructor(ctx: ModuleContext) {
    this.ctx = ctx
    const userData = ctx.app.getPath('userData')
    this.credentialsStore = new CredentialsStore(userData)
    this.browserSessionStore = new BrowserSessionStore(userData)
    this.passwordSessionStore = new IRacingSessionStore(userData)
    this.assetsCache = new TrackAssetsCache(userData)
    this.learner = new TrackMapLearner(userData, { logger })
    this.auth = getSharedIRacingAuthService(userData)
    this.auth.onChanged(() => {
      void this.onSharedAuthChanged()
    })
  }

  async bootstrap(): Promise<void> {
    const cachedCatalog = await this.assetsCache.loadCatalog()
    if (cachedCatalog) {
      this.catalog = cachedCatalog.tracks
      this.catalogFresh = this.assetsCache.catalogIsFresh(cachedCatalog.cachedAt)
    }
    await this.learner.setCatalog(toLearnerCatalog(this.catalog), this.catalogFresh)
    await this.learner.hydrate()
    await this.auth.bootstrap()
  }

  registerIpc(): void {
    const { ipcMain } = this.ctx
    ipcMain.handle(TRACK_MAP_CHANNELS.getForCurrentTrack, () => this.buildDataForCurrentTrack())
    ipcMain.handle(TRACK_MAP_CHANNELS.getForTrack, (_event, lookup: TrackMapLayoutLookup | string) =>
      this.buildDataForLookup(lookup)
    )
    ipcMain.handle(TRACK_MAP_CHANNELS.getStatus, () => this.buildStatus())
    ipcMain.handle(
      TRACK_MAP_CHANNELS.setCredentials,
      async (_event, payload: TrackMapCredentialsInput) => {
        const result = await this.auth.setCredentials(payload, () => this.buildStatus())
        void this.ensureCatalog(true).then(() => this.refreshForCurrentTrack(true))
        this.broadcastUpdate()
        return result
      }
    )
    ipcMain.handle(
      TRACK_MAP_CHANNELS.submitMfa,
      async (_event, payload: TrackMapMfaInput) => {
        const result = await this.auth.submitMfa(payload, () => this.buildStatus())
        void this.ensureCatalog(true).then(() => this.refreshForCurrentTrack(true))
        this.broadcastUpdate()
        return result
      }
    )
    ipcMain.handle(TRACK_MAP_CHANNELS.browserLogin, async () => {
      const result = await this.auth.browserLogin(this.ctx.getMainWindow(), () => this.buildStatus())
      if (result.status === 'ok') void this.ensureCatalog(true).then(() => this.refreshForCurrentTrack(true))
      this.broadcastUpdate()
      return result
    })
    ipcMain.handle(TRACK_MAP_CHANNELS.oauthLogin, async () => {
      const result = await this.auth.oauthLogin(this.ctx.getMainWindow(), () => this.buildStatus())
      if (result.status === 'ok') void this.ensureCatalog(true).then(() => this.refreshForCurrentTrack(true))
      this.broadcastUpdate()
      return result
    })
    ipcMain.handle(TRACK_MAP_CHANNELS.getOAuthConfig, async (): Promise<TrackMapOAuthConfig | null> => {
      return this.auth.getOAuthConfig()
    })
    ipcMain.handle(
      TRACK_MAP_CHANNELS.setOAuthConfig,
      async (_event, payload: TrackMapOAuthConfig): Promise<TrackMapOAuthConfig> => {
        return this.auth.setOAuthConfig(payload)
      }
    )
    ipcMain.handle(TRACK_MAP_CHANNELS.testDataApi, async (): Promise<TrackMapDataApiDiagnostic> => {
      return this.auth.testDataApi()
    })
    ipcMain.handle(TRACK_MAP_CHANNELS.clearCredentials, async () => {
      await this.auth.clear()
      this.resolvedSvgByLayout.clear()
      this.resolutionAttempted.clear()
      this.broadcastUpdate()
      return this.buildStatus()
    })
    ipcMain.handle(TRACK_MAP_CHANNELS.refresh, async () => {
      await this.refreshForCurrentTrack(true)
      return this.buildDataForCurrentTrack()
    })
    // Force a telemetry-learner capture to begin now (mid-lap allowed). Acts as
    // both "Gravar mapa agora" and "Reiniciar gravação".
    ipcMain.handle(TRACK_MAP_CHANNELS.startLearning, () => {
      this.learner.armManualCapture()
      this.broadcastUpdate()
      return this.buildStatus()
    })
    ipcMain.handle(TRACK_MAP_CHANNELS.cancelLearning, () => {
      this.learner.cancelCapture()
      this.broadcastUpdate()
      return this.buildStatus()
    })
  }

  subscribeTelemetry(): void {
    this.ctx.telemetryHub.on('snapshot', (snapshot: TelemetrySnapshot | null) => {
      void this.onSnapshot(snapshot)
    })
  }

  // ─── Telemetry handling ──────────────────────────────────────────────────
  private async onSnapshot(snapshot: TelemetrySnapshot | null): Promise<void> {
    let snapshotLayout: TrackLayoutIdentity | null = null
    let snapshotRevision = this.currentLayoutRevision
    if (snapshot?.connected) {
      const observed = trackLayoutFromSnapshot(snapshot)
      if (observed) {
        snapshotLayout = this.authoritativeLayout(observed)
        if (snapshotLayout.key !== this.currentLayout?.key) {
          this.setCurrentLayout(snapshotLayout)
          snapshotRevision = this.currentLayoutRevision
          void this.refreshForCurrentTrack(false)
          this.broadcastUpdate()
        } else {
          this.currentLayout = snapshotLayout
        }
      }
    }

    let learnedRecord = null as Awaited<ReturnType<TrackMapLearner['ingest']>>
    try {
      learnedRecord = await this.learner.ingest(snapshot, snapshotLayout ?? undefined)
    } catch {
      // Learner is best-effort; never break telemetry on a learner failure.
    }

    if (
      !snapshotLayout ||
      snapshotRevision !== this.currentLayoutRevision ||
      snapshotLayout.key !== this.currentLayout?.key
    ) return
    if (learnedRecord?.layoutKey === snapshotLayout.key) this.broadcastUpdate()

    // Drive the live recording trace/progress to the UI (throttled).
    this.maybeBroadcastRecording()
  }

  // Broadcast the in-flight recording (growing trace + real progress) and live
  // learner status without flooding IPC: when recording starts/stops, progress
  // advances ≥1%, or the learner REASON/phase changes (so stalls like "too slow"
  // or "no position data" reach the UI even when nothing is recording).
  private maybeBroadcastRecording(): void {
    let rec: ReturnType<TrackMapLearner['getRecordingSnapshot']>
    let learn: ReturnType<TrackMapLearner['getLearnState']>
    try {
      rec = this.learner.getRecordingSnapshot()
      learn = this.learner.getLearnState()
    } catch {
      return
    }
    const activeForCurrent = rec.active && rec.layoutKey === this.currentLayout?.key
    const learnSignature = `${learn.phase}:${learn.reason}`
    const learnChanged = learnSignature !== this.lastLearnSignature
    if (!activeForCurrent && !this.lastRecordingActive && !learnChanged) return

    const now = Date.now()
    const activeChanged = activeForCurrent !== this.lastRecordingActive
    const progressDelta = Math.abs(rec.progress - this.lastRecordingProgress)
    if (!activeChanged && !learnChanged && progressDelta < 0.01) return
    if (!activeChanged && !learnChanged && now - this.lastRecordingBroadcastAt < 150) return

    this.lastRecordingBroadcastAt = now
    this.lastRecordingActive = activeForCurrent
    this.lastRecordingProgress = activeForCurrent ? rec.progress : -1
    this.lastLearnSignature = learnSignature
    this.broadcastUpdate()
  }

  // Every resolve captures an immutable layout + revision. A completion from an
  // older A request cannot mutate cache/disk/IPC after telemetry has switched to B.
  private async refreshForCurrentTrack(force: boolean): Promise<void> {
    const layout = this.currentLayout
    if (!layout) return
    if (!force && this.resolutionAttempted.has(layout.key) && !this.resolvedSvgByLayout.has(layout.key)) return
    const request: LayoutResolveRequest = Object.freeze({
      layout,
      revision: this.currentLayoutRevision,
      force,
      token: `${this.currentLayoutRevision}:${layout.key}`
    })
    if (this.resolveInflight.has(request.token)) return this.resolveInflight.get(request.token)

    const work = this.doResolve(request).finally(() => {
      if (this.resolveInflight.get(request.token) === work) this.resolveInflight.delete(request.token)
      if (this.isCurrent(request)) this.resolutionAttempted.add(request.layout.key)
    })
    this.resolveInflight.set(request.token, work)
    return work
  }

  private async doResolve(request: LayoutResolveRequest): Promise<void> {
    let row = this.matchCatalog(request.layout)
    const api = this.auth.getApi()
    if ((!row || request.force) && api) {
      await this.ensureCatalog(request.force).catch(() => null)
      if (!this.isCurrent(request)) return
      row = this.matchCatalog(request.layout)
    }

    const trackId = request.layout.trackId ?? row?.trackId

    if (trackId) {
      const cached = await this.assetsCache.loadAsset(trackId)
      if (!this.isCurrent(request)) return
      if (cached && hasRenderableSvg(cached) && !request.force) {
        this.resolvedSvgByLayout.set(request.layout.key, resolvedAsset(cached, request.layout, row))
        this.broadcastUpdate()
        return
      }
    }

    // Fresh SVG metadata must come from the exact captured catalog row.
    if (!api || !trackId || !row) {
      this.broadcastUpdate()
      return
    }

    try {
      this.authStatus = 'authenticating'
      const assets = await api.listTrackAssets()
      if (!this.isCurrent(request)) return
      this.authStatus = 'ready'
      this.lastAuthAt = api.lastAuthAt() ?? this.lastAuthAt
      const trackAssets = assets.get(trackId)
      if (!trackAssets) {
        this.broadcastUpdate()
        return
      }

      const filenames = assetsToLayerMap(trackAssets.track_map_layers)
      const downloaded: Partial<Record<keyof TrackMapSvgLayers, string>> = {}
      for (const [key, filename] of Object.entries(filenames) as Array<
        [keyof TrackMapSvgLayers, string | undefined]
      >) {
        if (!filename) continue
        try {
          downloaded[key] = await api.fetchSvgLayer(trackAssets.track_map, filename)
          if (!this.isCurrent(request)) return
        } catch {
          // Best-effort per layer — missing pitroad shouldn't kill the active map.
        }
      }

      if (!this.isCurrent(request)) return
      const saved = await this.assetsCache.saveAsset(
        {
          trackId,
          trackName: row.trackName,
          configName: row.trackConfigName ?? undefined,
          baseUrl: trackAssets.track_map,
          layerFilenames: filenames,
          cachedAt: Date.now()
        },
        downloaded
      )
      if (!this.isCurrent(request)) return
      if (hasRenderableSvg(saved)) {
        this.resolvedSvgByLayout.set(request.layout.key, resolvedAsset(saved, request.layout, row))
      } else {
        this.resolvedSvgByLayout.delete(request.layout.key)
      }
      this.authStatus = 'ready'
      this.lastAuthAt = api.lastAuthAt() ?? Date.now()
      this.lastErrorMessage = undefined
      this.broadcastUpdate()
    } catch (error) {
      if (!this.isCurrent(request)) return
      this.auth.handleApiError(error)
      this.broadcastUpdate()
    }
  }

  private async ensureCatalog(force: boolean): Promise<IRacingTrack[] | null> {
    const cached = await this.assetsCache.loadCatalog()
    if (cached && this.assetsCache.catalogIsFresh(cached.cachedAt) && !force) {
      this.catalog = cached.tracks
      this.catalogFresh = true
      await this.learner.setCatalog(toLearnerCatalog(cached.tracks), true)
      return cached.tracks
    }
    const api = this.auth.getApi()
    if (!api) {
      // We still serve a stale catalog if we have one — better than nothing.
      if (cached) {
        this.catalog = cached.tracks
        this.catalogFresh = false
        await this.learner.setCatalog(toLearnerCatalog(cached.tracks), false)
        return cached.tracks
      }
      return null
    }
    try {
      const tracks = await api.listTracks()
      this.catalog = tracks
      this.catalogFresh = true
      await this.learner.setCatalog(toLearnerCatalog(tracks), true)
      await this.assetsCache.saveCatalog(tracks).catch(() => undefined)
      return tracks
    } catch (error) {
      this.auth.handleApiError(error)
      if (cached) {
        this.catalog = cached.tracks
        this.catalogFresh = false
        await this.learner.setCatalog(toLearnerCatalog(cached.tracks), false)
      }
      return cached?.tracks ?? null
    }
  }

  private matchCatalog(layout: TrackLayoutIdentity): TrackCatalogLayout | null {
    return findCatalogLayout(layout, toLearnerCatalog(this.catalog))
  }

  private authoritativeLayout(layout: TrackLayoutIdentity): TrackLayoutIdentity {
    const row = this.matchCatalog(layout)
    return row && (layout.trackId || this.catalogFresh) ? trackLayoutFromCatalog(row) : layout
  }

  private setCurrentLayout(layout: TrackLayoutIdentity): void {
    this.currentLayout = layout
    this.currentLayoutRevision += 1
    this.resolutionAttempted.delete(layout.key)
  }

  private isCurrent(request: LayoutResolveRequest): boolean {
    return request.revision === this.currentLayoutRevision && request.layout.key === this.currentLayout?.key
  }

  // ─── Credential lifecycle ────────────────────────────────────────────────
  private async loadCredentialsFromDisk(): Promise<void> {
    if (!this.credentialsStore.encryptionAvailable()) {
      // safeStorage gates ONLY the legacy password path. The embedded-browser
      // session (cookies in Electron's partition store) still works, so
      // `loadBrowserSession` runs next and may promote us back to 'ready'.
      this.authStatus = 'disabled'
      return
    }
    const creds = await this.credentialsStore.load()
    if (!creds) {
      this.authStatus = 'unconfigured'
      return
    }
    this.credentials = creds
    const api = new IRacingApi(creds.email, creds.hashedPassword)
    this.api = api
    this.loginMethod = 'password'

    // PRIMARY path: try to adopt a persisted password-mode session so we are
    // authed instantly WITHOUT a fresh /auth POST (and therefore without
    // re-prompting 2FA). The cookie jar is seeded from the previous /auth
    // Set-Cookie response, not the (broken) browser partition.
    const session = await this.passwordSessionStore.load().catch(() => null)
    const sessionValid =
      !!session &&
      session.cookies.length > 0 &&
      (session.expiresAt === undefined || session.expiresAt > Date.now())
    if (sessionValid && session) {
      api.seedCookies(session.cookies)
      this.passwordSessionExpiresAt = session.expiresAt
      this.lastAuthAt = session.capturedAt || Date.now()
      this.setAuthStatus('ready', 'boot: adopted persisted iRacing session (no 2FA needed)')
      return
    }

    // No valid stored session — attempt a silent re-login in the background with
    // the stored credentials. iRacing only re-prompts 2FA when it actually
    // requires it; otherwise this restores 'ready' without any user action.
    this.setAuthStatus('authenticating', 'boot: stored creds, attempting silent re-login')
    void this.attemptSilentLogin(api, creds)
  }

  // Background silent re-login used at boot when no valid persisted session is
  // available. Persists a fresh session on success; parks an MFA challenge for
  // the renderer to complete only when iRacing demands a verification code.
  private async attemptSilentLogin(api: IRacingApi, creds: StoredCredentials): Promise<void> {
    try {
      // Go through the single-flight `loginShared()` so that if a data request
      // (e.g. `listTrackAssets` when iRacing is already live at launch) races
      // this boot login, it REUSES this one /auth POST instead of firing a
      // second concurrent one into the same cookie jar.
      const outcome = await api.loginShared()
      if (outcome.status === 'mfa_required') {
        this.pendingMfa = { api, credentials: creds }
        this.setAuthStatus('mfa-required', 'boot: silent re-login needs a verification code')
        this.lastErrorMessage = undefined
        this.broadcastUpdate()
        return
      }
      await this.finalizeAuth(api, creds)
      this.broadcastUpdate()
    } catch (error) {
      this.handleApiError(error)
      // The initial bootstrap `loadBrowserSession()` skipped adoption because we
      // were mid silent-login ('authenticating'). Now that the password path has
      // failed — whether a transient boot network error (NIC not up yet) or a
      // definitive /auth rejection for a TOTP account that needs the browser
      // path — give a valid cached browser session its chance rather than wasting
      // it for this launch.
      await this.loadBrowserSession().catch(() => undefined)
      this.broadcastUpdate()
    }
  }

  // Snapshot + encrypt the current password-mode session cookie jar so the next
  // launch can re-adopt it without a /auth POST. Best-effort; never throws.
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
      // Persisting the session is an optimization — a failure just means the
      // next launch performs a silent re-login (possibly re-prompting 2FA).
    }
  }

  // Adopt a previously-captured iRacing web session on startup, if its cookie is
  // still present (and not expired). Browser sessions take precedence over the
  // legacy password login because they're the path that actually authenticates
  // post-2025.
  private async loadBrowserSession(): Promise<void> {
    // Password is the primary path now: if it already established a session
    // (ready) or is mid silent-login / awaiting a verification code, don't let a
    // stale captured browser cookie override it.
    if (
      this.loginMethod === 'password' &&
      (this.authStatus === 'ready' ||
        this.authStatus === 'authenticating' ||
        this.authStatus === 'mfa-required')
    ) {
      return
    }
    let hasCookie = false
    try {
      hasCookie = await hasIRacingAuthCookie()
    } catch {
      hasCookie = false
    }
    if (!hasCookie) {
      // No live session cookie. Drop any stale marker so status stays truthful.
      await this.browserSessionStore.clear().catch(() => undefined)
      return
    }

    const marker = await this.browserSessionStore.load().catch(() => null)
    let expiresAt = marker?.expiresAt
    try {
      const liveExpiry = await getIRacingAuthCookieExpiry()
      if (liveExpiry) expiresAt = liveExpiry
    } catch {
      // Keep the marker's expiry when the live read fails.
    }

    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      // Marker says the session lapsed even though a cookie lingers — require a
      // fresh login rather than activating a dead session.
      this.loginMethod = 'browser'
      this.browserSessionExpiresAt = expiresAt
      this.setAuthStatus('needs-login', 'boot: browser session marker expired')
      return
    }

    // A cookie's mere PRESENCE doesn't prove it still authenticates (the server
    // session can lapse, or the cookie can be a leftover the WAF rejects). Verify
    // against the live API using the SAME partition. Crucially, we distinguish a
    // DEFINITIVE rejection from an INCONCLUSIVE probe: only a hard 401/403
    // ('unauthed') demotes us to needs-login. A transport error ('unknown' — DNS,
    // timeout, offline, VPN-not-up-yet, rate-limit) must NOT nag a user whose
    // cookies are perfectly good but whose network simply isn't up at boot (common
    // on a desktop sim rig). In that case we preserve the prior session as 'ready'
    // and let the data client re-verify lazily — it flips to needs-login on a real 401.
    const verdict: IRacingSessionVerdict = await verifyIRacingSession().catch(
      (): IRacingSessionVerdict => 'unknown'
    )
    if (verdict === 'unauthed') {
      this.loginMethod = 'browser'
      this.browserSessionExpiresAt = expiresAt
      this.setAuthStatus('needs-login', 'boot: cookie present but /data/member/info probe returned 401/403')
      return
    }

    const api = new IRacingApi('', '')
    api.useBrowserSession(readIRacingSessionCookies)
    this.installBrowserApi(api, expiresAt)
    console.log(
      verdict === 'authed'
        ? '[trackmap] boot: adopted verified browser session'
        : '[trackmap] boot: session probe inconclusive (transport error) — preserving prior session as ready, will re-verify lazily'
    )
  }

  // Centralized auth-state setter so every transition is logged for debugging the
  // "login captured?" flow. The renderer mirrors `authStatus` via buildStatus().
  private setAuthStatus(next: TrackMapAuthStatus, reason: string): void {
    if (this.authStatus !== next) {
      console.log(`[trackmap] auth ${this.authStatus} → ${next} (${reason})`)
    }
    this.authStatus = next
  }

  // Make `api` (a browser-session client) the active one and reflect it in the
  // status fields. Shared by startup adoption and a fresh embedded login.
  private installBrowserApi(api: IRacingApi, expiresAt: number | undefined): void {
    this.api = api
    this.pendingMfa = null
    this.loginMethod = 'browser'
    this.browserSessionExpiresAt = expiresAt
    this.setAuthStatus('ready', 'browser session active')
    this.lastErrorMessage = undefined
    this.lastAuthAt = Date.now()
  }

  // ─── Embedded-browser login (PRIMARY path) ───────────────────────────────
  // Opens iRacing's real web login so the user can clear CAPTCHA/2FA, then
  // captures the resulting SSO cookie and switches the data client onto it. The
  // IPC promise resolves only after the window closes, so the renderer keeps a
  // local "opening…" state for the whole duration.
  private async handleBrowserLogin(): Promise<TrackMapBrowserLoginResult> {
    if (this.browserLoginInFlight) return this.browserLoginInFlight
    const work = this.runBrowserLogin().finally(() => {
      this.browserLoginInFlight = null
    })
    this.browserLoginInFlight = work
    return work
  }

  private async runBrowserLogin(): Promise<TrackMapBrowserLoginResult> {
    const previousStatus = this.authStatus
    this.setAuthStatus('authenticating', 'browser login window opening')
    this.lastErrorMessage = undefined
    this.broadcastUpdate()

    let result: BrowserLoginResult
    try {
      result = await openIRacingLoginWindow({ parent: this.ctx.getMainWindow() })
    } catch (error) {
      this.setAuthStatus(
        this.loginMethod === 'browser' && this.api ? 'ready' : previousStatus,
        'browser login window threw'
      )
      this.lastErrorMessage = error instanceof Error ? error.message : String(error)
      this.broadcastUpdate()
      return { status: 'cancelled', message: this.lastErrorMessage, trackMap: this.buildStatus() }
    }

    if (result.status !== 'ok') {
      // Closed/cancelled/timed out: restore a truthful prior status. The offline
      // learned map keeps working regardless.
      this.setAuthStatus(
        this.loginMethod === 'browser' && this.api ? 'ready' : previousStatus,
        `browser login ${result.reason ?? 'cancelled'}`
      )
      this.broadcastUpdate()
      return {
        status: 'cancelled',
        message: browserLoginCancelledMessage(result.reason),
        trackMap: this.buildStatus(),
        diagnostics: result.diagnostics
      }
    }

    // Window reported success after capturing the iRacing session cookies — either
    // confirmed by an authenticated /data/member/info probe, or on the PRESENCE of
    // a real auth cookie when the probe was inconclusive (CORS/rate-limited). We
    // still build the data client and run its own authenticate() as a second,
    // independent gate: it proves the cookie jar the data API reads (via node:https)
    // — not just the Chromium fetch the probe used — can actually drive requests.
    const api = new IRacingApi('', '')
    api.useBrowserSession(readIRacingSessionCookies)
    try {
      await api.authenticate()
    } catch (error) {
      this.handleApiError(error)
      this.broadcastUpdate()
      return {
        status: 'cancelled',
        message: error instanceof Error ? error.message : String(error),
        trackMap: this.buildStatus(),
        diagnostics: result.diagnostics
      }
    }

    const expiresAt =
      result.authCookieExpiresAt ?? (await getIRacingAuthCookieExpiry().catch(() => undefined))
    await this.browserSessionStore
      .save({ version: 1, capturedAt: Date.now(), expiresAt })
      .catch(() => undefined)

    this.installBrowserApi(api, expiresAt)
    // Now that we're authenticated, refresh catalog + the current track's SVG.
    void this.ensureCatalog(true).then(() => this.refreshForCurrentTrack(true))
    this.broadcastUpdate()
    return { status: 'ok', trackMap: this.buildStatus(), diagnostics: result.diagnostics }
  }

  private async handleSetCredentials(input: TrackMapCredentialsInput): Promise<TrackMapAuthResult> {
    if (!input || typeof input.email !== 'string' || typeof input.password !== 'string') {
      throw new Error('Email and password are required.')
    }
    const email = input.email.trim()
    if (!email) throw new Error('Email is required.')
    if (!input.password) throw new Error('Password is required.')

    const hashedPassword = hashIRacingPassword(email, input.password)
    const creds: StoredCredentials = { email, hashedPassword, savedAt: Date.now() }

    // Authenticate BEFORE persisting so we never cache a dead session. We keep
    // the probe instance around: if iRacing asks for a verification code, the
    // SAME instance (and its cookie jar) must complete the MFA step.
    const probe = new IRacingApi(creds.email, creds.hashedPassword)
    this.pendingMfa = null
    this.authStatus = 'authenticating'
    let outcome: Awaited<ReturnType<IRacingApi['login']>>
    try {
      outcome = await probe.login()
    } catch (error) {
      this.handleApiError(error)
      throw error
    }

    if (outcome.status === 'mfa_required') {
      // Park the session and ask the renderer to collect the code.
      this.pendingMfa = { api: probe, credentials: creds }
      this.authStatus = 'mfa-required'
      this.lastErrorMessage = undefined
      return { status: 'mfa_required', message: outcome.message, trackMap: this.buildStatus() }
    }

    await this.finalizeAuth(probe, creds)
    return { status: 'ok', trackMap: this.buildStatus() }
  }

  // Complete the MFA / verification-code challenge started by setCredentials.
  private async handleSubmitMfa(input: TrackMapMfaInput): Promise<TrackMapAuthResult> {
    const code = typeof input?.code === 'string' ? input.code.trim() : ''
    if (!code) throw new Error('Enter the verification code sent by iRacing.')
    if (!this.pendingMfa) {
      throw new Error('No pending verification. Sign in again to receive a new code.')
    }
    const { api, credentials } = this.pendingMfa
    this.authStatus = 'authenticating'
    try {
      await api.completeMfa(code)
    } catch (error) {
      // Keep `pendingMfa` so the user can retry with a fresh code.
      this.handleApiError(error)
      throw error
    }
    await this.finalizeAuth(api, credentials)
    return { status: 'ok', trackMap: this.buildStatus() }
  }

  // Persist + activate a freshly authenticated session (shared by the direct
  // login and MFA-completion paths).
  private async finalizeAuth(api: IRacingApi, creds: StoredCredentials): Promise<void> {
    await this.credentialsStore.save(creds)
    this.credentials = creds
    this.api = api
    this.pendingMfa = null
    this.loginMethod = 'password'
    this.browserSessionExpiresAt = undefined
    this.authStatus = 'ready'
    this.lastAuthAt = api.lastAuthAt() ?? Date.now()
    this.lastErrorMessage = undefined

    // Persist the resulting session cookie jar so the NEXT launch can re-adopt it
    // without a /auth POST — the key to not needing 2FA every time.
    await this.persistPasswordSession(api)

    // Best-effort: refresh the catalog + current track in the background.
    void this.ensureCatalog(true).then(() => this.refreshForCurrentTrack(true))
  }

  private async handleClearCredentials(): Promise<void> {
    await this.credentialsStore.clear()
    // Logout clears EVERY path: the legacy password file, the persisted
    // password-session cookie jar, AND the captured browser session.
    await this.passwordSessionStore.clear().catch(() => undefined)
    await this.browserSessionStore.clear().catch(() => undefined)
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
    this.resolvedSvgByLayout.clear()
    this.resolutionAttempted.clear()
    this.broadcastUpdate()
  }

  private handleApiError(error: unknown): void {
    if (error instanceof IRacingApiError) {
      this.lastErrorMessage = error.message
      switch (error.kind) {
        case 'unauthorized':
          this.authStatus = 'needs-login'
          break
        case 'rate-limited':
          this.authStatus = 'rate-limited'
          break
        default:
          this.authStatus = 'error'
      }
    } else {
      this.lastErrorMessage = error instanceof Error ? error.message : String(error)
      this.authStatus = 'error'
    }
  }

  // ─── Data assembly + broadcast ───────────────────────────────────────────
  private buildDataForCurrentTrack(): TrackMapData {
    return this.currentLayout ? this.buildDataForLayout(this.currentLayout) : { source: 'none' }
  }

  private buildDataForLookup(lookup: TrackMapLayoutLookup | string): TrackMapData {
    const captured = captureTrackLayout(typeof lookup === 'string' ? { trackName: lookup } : lookup)
    return captured ? this.buildDataForLayout(this.authoritativeLayout(captured)) : { source: 'none' }
  }

  private buildDataForLayout(layout: TrackLayoutIdentity): TrackMapData {
    const recording = this.recordingForLayout(layout)
    const cachedSvg = this.resolvedSvgByLayout.get(layout.key)
    if (cachedSvg && hasRenderableSvg(cachedSvg)) {
      return {
        source: 'iracing-svg',
        layoutKey: layout.key,
        trackId: cachedSvg.trackId,
        trackName: cachedSvg.trackName,
        trackConfigName: cachedSvg.configName ?? undefined,
        svg: cachedSvg.activeSvg,
        svgLayers: cachedSvg.layers,
        viewBox: parseSvgViewBox(firstSvgLayer(cachedSvg.layers)),
        ...(recording ? { recording } : {})
      }
    }
    const learned = this.learner.get(layout)
    if (learned) {
      return {
        source: 'learned',
        layoutKey: learned.layoutKey,
        trackId: learned.trackId,
        trackName: learned.trackName,
        trackConfigName: learned.trackConfigName,
        polyline: learned.polyline,
        startFinishPct: learned.startFinishPct,
        viewBox: [0, 0, 1, 1],
        ...(recording ? { recording } : {})
      }
    }
    return {
      source: 'none',
      layoutKey: layout.key,
      trackId: layout.trackId,
      trackName: layout.trackName,
      trackConfigName: layout.trackConfigName,
      ...(recording ? { recording } : {})
    }
  }

  // Live recording state for `layout`, but only when it's the layout currently
  // under telemetry (we never record a track in the background).
  private recordingForLayout(layout: TrackLayoutIdentity): TrackMapData['recording'] {
    if (layout.key !== this.currentLayout?.key) return undefined
    const rec = this.learner.getRecordingSnapshot()
    if (!rec.active || rec.layoutKey !== layout.key) return undefined
    return {
      active: true,
      progress: rec.progress,
      sampleCount: rec.sampleCount,
      mode: rec.mode ?? undefined,
      phase: rec.phase === 'idle' ? undefined : rec.phase,
      manual: rec.manual,
      polyline: rec.polyline.length >= 2 ? rec.polyline : undefined,
      viewBox: [0, 0, 1, 1]
    }
  }

  // Always-available telemetry-learner diagnostics for the status panel.
  private buildLearnState(): TrackMapStatus['learn'] {
    const state = this.learner.getLearnState()
    return {
      phase: state.phase,
      progress: state.progress,
      sampleCount: state.sampleCount,
      manual: state.manual,
      mode: state.mode ?? undefined,
      reason: state.reason,
      reasonLabel: state.reasonLabel,
      hasMap: this.learner.has(this.currentLayout)
    }
  }

  private buildStatus(): TrackMapStatus {
    const auth = this.auth.buildSnapshot()
    return {
      auth: auth.auth,
      email: auth.email,
      lastAuthAt: auth.lastAuthAt,
      lastErrorMessage: auth.lastErrorMessage,
      encryptionAvailable: auth.encryptionAvailable,
      currentTrackName: this.currentLayout?.trackName,
      currentTrackConfigName: this.currentLayout?.trackConfigName,
      currentLayoutKey: this.currentLayout?.key,
      currentSource: this.currentSource(),
      learn: this.buildLearnState(),
      loginMethod: auth.loginMethod,
      sessionExpiresAt: auth.sessionExpiresAt,
      oauthConfigured: auth.oauthConfigured,
      oauthClientId: auth.oauthClientId,
      dataApiAvailable: auth.dataApiAvailable,
      dataApiMessage: auth.dataApiMessage
    }
  }

  // Surfaces an expired browser session as 'needs-login' WITHOUT waiting for the
  // next data call to 401, so the UI can prompt a re-login proactively.
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

  // What the renderer shows under "Saved login". For the browser path there is
  // no stored e-mail (we only hold a cookie), so we show a clear, honest label.
  private statusIdentity(): string | undefined {
    if (this.loginMethod === 'browser') return 'Browser session (iRacing)'
    return this.credentials?.email
  }

  private currentSource(): TrackMapStatus['currentSource'] {
    if (!this.currentLayout) return 'none'
    const cached = this.resolvedSvgByLayout.get(this.currentLayout.key)
    if (cached && hasRenderableSvg(cached)) return 'iracing-svg'
    if (this.learner.has(this.currentLayout)) return 'learned'
    return 'none'
  }

  private broadcastUpdate(): void {
    const payload = this.buildDataForCurrentTrack()
    this.ctx.broadcast(TRACK_MAP_CHANNELS.updated, payload)
  }

  private async onSharedAuthChanged(): Promise<void> {
    if (this.auth.getApi()) {
      await this.ensureCatalog(false).catch(() => null)
      await this.refreshForCurrentTrack(false).catch(() => undefined)
    }
    this.broadcastUpdate()
  }

  // Called on app exit: persist the freshest password-mode session jar (cookies
  // may have rotated during a lazy re-auth) so the next launch skips /auth + 2FA.
  async persistSessionForQuit(): Promise<void> {
    await this.auth.persistSessionForQuit()
  }
}

function toLearnerCatalog(tracks: readonly IRacingTrack[]): TrackCatalogLayout[] {
  return tracks.map((track) => ({
    trackId: track.track_id,
    trackName: track.track_name,
    trackConfigName: track.config_name
  }))
}

function resolvedAsset(
  asset: CachedAssetWithSvg,
  layout: TrackLayoutIdentity,
  row: TrackCatalogLayout | null
): CachedAssetWithSvg {
  return {
    ...asset,
    trackName: row?.trackName ?? layout.trackName,
    configName: row?.trackConfigName ?? layout.trackConfigName
  }
}

// Honest PT-BR message for a non-successful embedded login. Every branch makes
// clear the offline telemetry map keeps working without any login.
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

function hasRenderableSvg(asset: CachedAssetWithSvg): boolean {
  return Boolean(firstSvgLayer(asset.layers))
}

function firstSvgLayer(layers: TrackMapSvgLayers): string | undefined {
  return layers.active ?? layers.inactive ?? layers.background ?? layers.pitroad ?? layers.startFinish ?? layers.turns
}

// `viewBox="x y w h"` is the only piece of the SVG we read in the main process
// — the renderer is the one that actually parses and draws the paths. We avoid
// pulling in a DOM/SVG parser here on purpose.
function parseSvgViewBox(svg: string | undefined): TrackMapViewBox | undefined {
  if (!svg) return undefined
  const match = svg.match(/viewBox=["']\s*([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)\s*["']/)
  if (!match) return undefined
  const nums = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])]
  if (nums.some((n) => !Number.isFinite(n))) return undefined
  if (nums[2] <= 0 || nums[3] <= 0) return undefined
  return [nums[0], nums[1], nums[2], nums[3]]
}

export function register(ctx: ModuleContext): void {
  const module = new TrackMapModule(ctx)
  module.registerIpc()
  // Capture the freshest iRacing session at exit (cookies may have rotated
  // mid-run) and force them to disk so login survives the next launch — for both
  // the browser session (Electron partition) and the password session jar.
  ctx.app.on('before-quit', () => {
    void persistIRacingSessionCookies()
    void module.persistSessionForQuit()
  })
  void module.bootstrap().then(() => {
    module.subscribeTelemetry()
  })
}
