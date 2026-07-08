// Career & Ratings Hub — main-process module.
//
// Pulls a serious GT3 racer's iRacing progression from the members-ng Data API
// and serves the renderer (CareerView) a normalized, render-ready snapshot.
//
// Responsibilities:
//   • Reuse the track-map embedded-browser session (the cookie jar in the
//     `persist:iracing-trackmap` partition) — there is NO separate login here.
//     If the user logged in once for track maps, the Hub is already authed.
//   • Resolve the logged-in member's cust_id from /data/member/info ("me"),
//     then fetch licenses, career stats, recent races, summary and the iRating /
//     Safety-Rating time series, and the car catalog (for car names).
//   • Normalize every value to human units (SR floats, 1-based positions) so the
//     renderer draws data directly.
//   • CACHE the last successful fetch to disk (userData) so the Hub shows data
//     offline and never hammers the API. The car catalog is cached separately
//     with a long TTL.
//   • Degrade gracefully: 401 → "needs-login" CTA, 429 → keep cached data, other
//     errors → keep cached data. Optional calls (summary, charts) never break a
//     refresh.
//
// IPC (career: prefix — allowlisted in the preload bridge by the orchestrator):
//   • career:getOverview → CareerOverview (identity, licenses, career stats,
//     this-year, derived strengths + incident trend, discipline list).
//   • career:getCharts   → CareerChartsResult for one discipline (lazy-loads +
//     caches the time series on demand).
//   • career:getRecent   → CareerRecentResult (the recent-races table).
//   • career:refresh     → force a full network refresh; broadcasts career:updated.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  CAREER_CATEGORIES,
  CAREER_CHANNELS,
  careerCategoryLabel,
  type CareerActiveSeason,
  type CareerAuthState,
  type CareerCategoryCharts,
  type CareerCategoryStat,
  type CareerChartPoint,
  type CareerChartsRequest,
  type CareerChartsResult,
  type CareerDivision,
  type CareerEnrichmentResult,
  type CareerIdentity,
  type CareerIncidentPoint,
  type CareerLeague,
  type CareerLicense,
  type CareerOverview,
  type CareerProfile,
  type CareerRecentRace,
  type CareerRecentResult,
  type CareerStatus,
  type CareerStrength,
  type CareerThisYear,
  type CareerUpdatedEvent,
  type CareerYearlyStat
} from '../../shared/career'
import type { ModuleContext } from '../module-context'
import {
  IRacingApi,
  IRacingApiError,
  type IRacingCareerStat,
  type IRacingChartData,
  type IRacingLeagueMembership,
  type IRacingMember,
  type IRacingMemberInfo,
  type IRacingMemberLicense,
  type IRacingMemberProfile,
  type IRacingRecentRace,
  type IRacingSeasonSeries,
  type IRacingThisYearSummary,
  type IRacingYearlyStat
} from '../track-map/iracing-api'
import { getSharedIRacingAuthService, type SharedIRacingAuthService } from '../track-map/iracing-auth-service'

// Persisted snapshot of the last successful fetch. Versioned so a future shape
// change can be detected and discarded instead of crashing.
interface CareerCacheFile {
  version: 1
  fetchedAt: number
  custId: number
  identity: CareerIdentity
  licenses: CareerLicense[]
  career: CareerCategoryStat[]
  thisYear: CareerThisYear | null
  recentRaces: CareerRecentRace[]
  // Time series keyed by String(categoryId).
  charts: Record<string, CareerCategoryCharts>
  strengthsByCar: CareerStrength[]
  strengthsByTrack: CareerStrength[]
  incidentTrend: CareerIncidentPoint[]
  availableCategoryIds: number[]
  primaryCategoryId: number | null
}

interface CarCatalogFile {
  version: 1
  fetchedAt: number
  cars: Record<string, string>
}

// Separate cache for enrichment data (yearly, profile, leagues, series, division).
interface EnrichmentCacheFile {
  version: 1
  fetchedAt: number
  custId: number
  yearly: CareerYearlyStat[]
  profile: CareerProfile | null
  leagues: CareerLeague[]
  divisions: Record<string, CareerDivision | null>
  activeSeasonsForPrimary: CareerActiveSeason[]
}

const CACHE_FILE = 'career-cache.json'
const CARS_FILE = 'career-cars.json'
const ENRICHMENT_FILE = 'career-enrichment.json'
// Re-fetch in the background when the cached snapshot is older than this.
const STALE_MS = 6 * 60 * 60 * 1000 // 6 hours
// Floor between background-refresh ATTEMPTS so a persistently-failing fetch
// (offline / 429 / 5xx) can't re-arm itself via the career:updated broadcast.
const BG_REFRESH_MIN_INTERVAL_MS = 60 * 1000
// The car catalog barely changes; refresh it at most weekly.
const CARS_TTL_MS = 7 * 24 * 60 * 60 * 1000
// Enrichment data (series, leagues, yearly) changes infrequently.
const ENRICHMENT_TTL_MS = 4 * 60 * 60 * 1000 // 4 hours

class CareerModule {
  private readonly ctx: ModuleContext
  private readonly auth: SharedIRacingAuthService
  private readonly cacheFile: string
  private readonly carsFile: string
  private readonly enrichmentFile: string

  private snapshot: CareerCacheFile | null = null
  private enrichment: EnrichmentCacheFile | null = null
  private cars: Map<number, string> = new Map()
  private carsFetchedAt = 0

  private authState: CareerAuthState = 'unknown'
  private lastMessage: string | undefined
  // True once a NETWORK refresh has succeeded in this session — distinguishes
  // live data from data served straight off the disk cache.
  private freshThisSession = false
  private refreshInFlight: Promise<void> | null = null
  private enrichmentInFlight: Promise<void> | null = null
  private lastBgAttemptAt = 0

  constructor(ctx: ModuleContext) {
    this.ctx = ctx
    const userData = ctx.app.getPath('userData')
    this.cacheFile = join(userData, CACHE_FILE)
    this.carsFile = join(userData, CARS_FILE)
    this.enrichmentFile = join(userData, ENRICHMENT_FILE)
    this.auth = getSharedIRacingAuthService(userData)
    this.auth.onChanged(() => {
      void this.onSharedAuthChanged()
    })
  }

  registerIpc(): void {
    const { ipcMain } = this.ctx
    ipcMain.handle(CAREER_CHANNELS.getOverview, async () => {
      void this.maybeBackgroundRefresh()
      return this.buildOverview()
    })
    ipcMain.handle(CAREER_CHANNELS.getRecent, async (): Promise<CareerRecentResult> => {
      void this.maybeBackgroundRefresh()
      return { races: this.snapshot?.recentRaces ?? [], status: this.buildStatus() }
    })
    ipcMain.handle(CAREER_CHANNELS.getCharts, async (_event, request: CareerChartsRequest) =>
      this.getCharts(Number(request?.categoryId))
    )
    ipcMain.handle(CAREER_CHANNELS.getEnrichment, async (): Promise<CareerEnrichmentResult> => {
      void this.maybeBackgroundEnrichment()
      return this.buildEnrichmentResult()
    })
    ipcMain.handle(CAREER_CHANNELS.refresh, async (): Promise<CareerOverview> => {
      await this.refresh()
      return this.buildOverview()
    })
  }

  async bootstrap(): Promise<void> {
    await this.loadSnapshotFromDisk()
    await this.loadCarsFromDisk()
    await this.loadEnrichmentFromDisk()
    await this.auth.bootstrap()
    this.authState = this.auth.getApi() ? 'ready' : 'needs-login'
    // Kick a background refresh so a freshly-opened Hub updates itself, but the
    // cached snapshot (if any) is already available for an instant first paint.
    void this.maybeBackgroundRefresh()
  }

  // ─── Auth helpers ──────────────────────────────────────────────────────────
  private async hasSession(): Promise<boolean> {
    await this.auth.bootstrap().catch(() => undefined)
    return Boolean(this.auth.getApi())
  }

  private get api(): IRacingApi {
    const api = this.auth.getApi()
    if (!api) {
      throw new IRacingApiError(
        'unauthorized',
        this.auth.getLastErrorMessage() ??
          'iRacing session missing. Sign in once through Track Map or Career Hub.',
        401
      )
    }
    return api
  }

  // (Re)load the latest captured cookies into the client and confirm the session
  // is live. Returns false (and flips status to needs-login) when it isn't.
  private async ensureAuthed(): Promise<boolean> {
    if (!(await this.hasSession())) {
      this.authState = 'needs-login'
      this.lastMessage = undefined
      return false
    }
    const api = this.auth.getApi()
    if (!api) {
      this.authState = 'needs-login'
      this.lastMessage = this.auth.getLastErrorMessage()
      return false
    }
    try {
      if (!api.isAuthed()) await api.authenticate()
      return true
    } catch (error) {
      this.handleApiError(error)
      return false
    }
  }

  private handleApiError(error: unknown): void {
    if (error instanceof IRacingApiError) {
      this.lastMessage = error.message
      this.auth.handleApiError(error)
      switch (error.kind) {
        case 'unauthorized':
          this.authState = 'needs-login'
          break
        case 'rate-limited':
          this.authState = 'rate-limited'
          break
        default:
          this.authState = 'error'
      }
    } else {
      this.lastMessage = error instanceof Error ? error.message : String(error)
      this.authState = 'error'
    }
  }

  // ─── Refresh orchestration ─────────────────────────────────────────────────
  private isStale(): boolean {
    if (!this.snapshot) return true
    return Date.now() - this.snapshot.fetchedAt > STALE_MS
  }

  // Fire-and-forget refresh used on view open: only runs when we have a session
  // and the cache is missing/stale, and never overlaps an in-flight refresh.
  private async maybeBackgroundRefresh(): Promise<void> {
    if (this.refreshInFlight) return
    // Rate-limit background refreshes: even if every fetch fails and re-broadcasts
    // career:updated (which re-pulls the overview), don't retry more than once per
    // window — otherwise a 429/offline/5xx loop would hammer the iRacing API.
    if (Date.now() - this.lastBgAttemptAt < BG_REFRESH_MIN_INTERVAL_MS) return
    if (this.authState === 'needs-login') {
      // Re-check the cookie in case the user just logged in via track maps.
      if (!(await this.hasSession())) return
    }
    if (!this.isStale()) return
    this.lastBgAttemptAt = Date.now()
    await this.refresh()
  }

  // Public, de-duplicated full refresh.
  async refresh(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight
    const work = this.doRefresh().finally(() => {
      this.refreshInFlight = null
    })
    this.refreshInFlight = work
    return work
  }

  private async doRefresh(): Promise<void> {
    this.authState = 'loading'
    this.broadcast()

    if (!(await this.ensureAuthed())) {
      this.broadcast()
      return
    }

    try {
      const info = await this.api.getMemberInfo()
      const custId = info.cust_id

      // Sequential, individually-typed (NOT array-destructured — that would
      // widen each binding to the union of all three result types). These are
      // optional: any one failing degrades to its fallback without aborting.
      const career = await this.guarded<IRacingCareerStat[]>(() => this.api.getMemberCareer(custId), [])
      const recentRaw = await this.guarded<IRacingRecentRace[]>(() => this.api.getMemberRecentRaces(custId), [])
      const summary = await this.guarded<IRacingThisYearSummary | null>(() => this.api.getMemberSummary(custId), null)

      const licenses = await this.resolveLicenses(info, custId)
      const cars = await this.ensureCars()

      const recentRaces = recentRaw
        .map((race) => normalizeRecentRace(race, cars))
        .sort((a, b) => timeMs(b.sessionStartTime) - timeMs(a.sessionStartTime))

      const careerStats = career.map(normalizeCareerStat)
      const availableCategoryIds = careerStats
        .filter((stat) => stat.starts > 0)
        .sort((a, b) => b.starts - a.starts)
        .map((stat) => stat.categoryId)
      const primaryCategoryId = pickPrimaryCategory(availableCategoryIds)

      // Carry previously-fetched charts forward, then refresh the ones for the
      // disciplines that matter (best-effort; a chart failure never aborts).
      const charts: Record<string, CareerCategoryCharts> = { ...(this.snapshot?.charts ?? {}) }
      const chartCategories = availableCategoryIds.length > 0 ? availableCategoryIds : primaryCategoryId !== null ? [primaryCategoryId] : []
      for (const categoryId of chartCategories) {
        const fetched = await this.fetchCategoryCharts(custId, categoryId)
        if (fetched) charts[String(categoryId)] = fetched
      }

      const snapshot: CareerCacheFile = {
        version: 1,
        fetchedAt: Date.now(),
        custId,
        identity: { custId, displayName: str(info.display_name) || `#${custId}` },
        licenses,
        career: careerStats,
        thisYear: normalizeThisYear(summary),
        recentRaces,
        charts,
        strengthsByCar: aggregateStrengths(recentRaces, (race) => race.carId, (race) => race.carName),
        strengthsByTrack: aggregateStrengths(recentRaces, (race) => race.trackId, (race) => race.trackName),
        incidentTrend: buildIncidentTrend(recentRaces),
        availableCategoryIds,
        primaryCategoryId
      }

      this.snapshot = snapshot
      this.freshThisSession = true
      this.authState = 'ready'
      this.lastMessage = undefined
      await this.saveSnapshot(snapshot)
    } catch (error) {
      // member/info or another critical call failed — keep the cached snapshot.
      this.handleApiError(error)
    }

    this.broadcast()
  }

  // Prefer the rich licenses from member/info; fall back to member/get (the
  // task's documented licenses source) only when member/info omits them.
  private async resolveLicenses(info: IRacingMemberInfo, custId: number): Promise<CareerLicense[]> {
    const fromInfo = licensesFromInfoDict(info.licenses)
    if (fromInfo.length > 0) return sortLicenses(fromInfo)
    const members = await this.guarded(() => this.api.getMembers([custId], true), [] as IRacingMember[])
    const self = members.find((member) => member.cust_id === custId) ?? members[0]
    const rawLicenses = self?.licenses
    const fromGet = Array.isArray(rawLicenses) ? rawLicenses.map(normalizeLicense) : []
    return sortLicenses(fromGet)
  }

  private async fetchCategoryCharts(custId: number, categoryId: number): Promise<CareerCategoryCharts | null> {
    try {
      const iRating = await this.api.getMemberChartData(custId, categoryId, 1)
      const safety = await this.api.getMemberChartData(custId, categoryId, 3)
      return normalizeCharts(categoryId, iRating, safety)
    } catch (error) {
      // Charts are best-effort: a 401 still means the session died, so surface
      // that; otherwise (rate-limit/network) just skip this discipline's charts.
      if (error instanceof IRacingApiError && error.kind === 'unauthorized') {
        this.handleApiError(error)
      }
      return null
    }
  }

  // Run an OPTIONAL api call. Auth/rate-limit errors abort the whole refresh (so
  // the caller can react); anything else degrades to the fallback value.
  private async guarded<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn()
    } catch (error) {
      if (error instanceof IRacingApiError && (error.kind === 'unauthorized' || error.kind === 'rate-limited')) {
        throw error
      }
      return fallback
    }
  }

  // ─── Car catalog (long-TTL, separate cache) ────────────────────────────────
  private async ensureCars(): Promise<Map<number, string>> {
    if (this.cars.size > 0 && Date.now() - this.carsFetchedAt < CARS_TTL_MS) {
      return this.cars
    }
    try {
      const list = await this.api.getCars()
      if (list.length > 0) {
        const map = new Map<number, string>()
        for (const car of list) {
          const name = str(car.car_name) || str(car.car_name_abbreviated)
          if (car.car_id && name) map.set(car.car_id, name)
        }
        this.cars = map
        this.carsFetchedAt = Date.now()
        await this.saveCars()
      }
    } catch {
      // Keep whatever catalog we already have (even stale); names are optional.
    }
    return this.cars
  }

  // ─── IPC payload builders ──────────────────────────────────────────────────
  private async getCharts(categoryId: number): Promise<CareerChartsResult> {
    if (!Number.isFinite(categoryId)) {
      return { categoryId, charts: null, status: this.buildStatus() }
    }
    const key = String(categoryId)
    const cached = this.snapshot?.charts[key]
    if (cached) return { categoryId, charts: cached, status: this.buildStatus() }

    // Not cached yet — lazy-load on demand when we have a session + cust_id.
    const custId = this.snapshot?.custId
    if (custId && this.authState !== 'needs-login' && (await this.hasSession())) {
      if (this.api.isAuthed() || (await this.ensureAuthed())) {
        const fetched = await this.fetchCategoryCharts(custId, categoryId)
        if (fetched && this.snapshot) {
          this.snapshot.charts[key] = fetched
          await this.saveSnapshot(this.snapshot)
          return { categoryId, charts: fetched, status: this.buildStatus() }
        }
      }
    }
    return { categoryId, charts: null, status: this.buildStatus() }
  }

  private buildStatus(): CareerStatus {
    const authSnapshot = this.auth.buildSnapshot()
    return {
      auth: this.authState,
      lastUpdated: this.snapshot?.fetchedAt,
      fromCache: this.snapshot !== null && !this.freshThisSession,
      message: this.lastMessage ?? authSnapshot.lastErrorMessage,
      custId: this.snapshot?.custId,
      displayName: this.snapshot?.identity.displayName
    }
  }

  private buildOverview(): CareerOverview {
    const snapshot = this.snapshot
    const status = this.buildStatus()
    if (!snapshot) {
      return {
        identity: null,
        licenses: [],
        career: [],
        thisYear: null,
        strengthsByCar: [],
        strengthsByTrack: [],
        incidentTrend: [],
        availableCategoryIds: [],
        primaryCategoryId: null,
        status
      }
    }
    return {
      identity: snapshot.identity,
      licenses: snapshot.licenses,
      career: snapshot.career,
      thisYear: snapshot.thisYear,
      strengthsByCar: snapshot.strengthsByCar,
      strengthsByTrack: snapshot.strengthsByTrack,
      incidentTrend: snapshot.incidentTrend,
      availableCategoryIds: snapshot.availableCategoryIds,
      primaryCategoryId: snapshot.primaryCategoryId,
      status
    }
  }

  private broadcast(): void {
    const payload: CareerUpdatedEvent = { status: this.buildStatus() }
    this.ctx.broadcast(CAREER_CHANNELS.updated, payload)
  }

  private async onSharedAuthChanged(): Promise<void> {
    const snapshot = this.auth.buildSnapshot()
    if (snapshot.auth === 'ready') {
      if (this.authState === 'needs-login' || this.authState === 'unknown') {
        this.authState = 'ready'
        this.lastMessage = undefined
      }
      void this.maybeBackgroundRefresh()
    } else if (snapshot.auth === 'needs-login' || snapshot.auth === 'unconfigured') {
      this.authState = 'needs-login'
      this.lastMessage = snapshot.lastErrorMessage
    } else if (snapshot.auth === 'rate-limited') {
      this.authState = 'rate-limited'
      this.lastMessage = snapshot.lastErrorMessage
    } else if (snapshot.auth === 'error') {
      this.authState = 'error'
      this.lastMessage = snapshot.lastErrorMessage
    }
    this.broadcast()
  }

  // ─── Disk persistence ──────────────────────────────────────────────────────
  private async loadSnapshotFromDisk(): Promise<void> {
    try {
      const raw = await readFile(this.cacheFile, 'utf8')
      const parsed = JSON.parse(raw) as Partial<CareerCacheFile>
      if (parsed && parsed.version === 1 && typeof parsed.custId === 'number' && parsed.identity) {
        this.snapshot = {
          version: 1,
          fetchedAt: typeof parsed.fetchedAt === 'number' ? parsed.fetchedAt : 0,
          custId: parsed.custId,
          identity: parsed.identity,
          licenses: parsed.licenses ?? [],
          career: parsed.career ?? [],
          thisYear: parsed.thisYear ?? null,
          recentRaces: parsed.recentRaces ?? [],
          charts: parsed.charts ?? {},
          strengthsByCar: parsed.strengthsByCar ?? [],
          strengthsByTrack: parsed.strengthsByTrack ?? [],
          incidentTrend: parsed.incidentTrend ?? [],
          availableCategoryIds: parsed.availableCategoryIds ?? [],
          primaryCategoryId: parsed.primaryCategoryId ?? null
        }
      }
    } catch {
      // No cache yet (first run) or unreadable — start empty.
    }
  }

  private async saveSnapshot(snapshot: CareerCacheFile): Promise<void> {
    try {
      await mkdir(this.ctx.app.getPath('userData'), { recursive: true })
      await writeFile(this.cacheFile, JSON.stringify(snapshot), 'utf8')
    } catch {
      // Best-effort cache; a write failure just means no offline data next time.
    }
  }

  private async loadCarsFromDisk(): Promise<void> {
    try {
      const raw = await readFile(this.carsFile, 'utf8')
      const parsed = JSON.parse(raw) as Partial<CarCatalogFile>
      if (parsed && parsed.version === 1 && parsed.cars) {
        const map = new Map<number, string>()
        for (const [id, name] of Object.entries(parsed.cars)) {
          const numericId = Number(id)
          if (Number.isFinite(numericId) && typeof name === 'string') map.set(numericId, name)
        }
        this.cars = map
        this.carsFetchedAt = typeof parsed.fetchedAt === 'number' ? parsed.fetchedAt : 0
      }
    } catch {
      // No car cache yet — fetched lazily on the next refresh.
    }
  }

  private async saveCars(): Promise<void> {
    try {
      const cars: Record<string, string> = {}
      for (const [id, name] of this.cars) cars[String(id)] = name
      const payload: CarCatalogFile = { version: 1, fetchedAt: this.carsFetchedAt, cars }
      await mkdir(this.ctx.app.getPath('userData'), { recursive: true })
      await writeFile(this.carsFile, JSON.stringify(payload), 'utf8')
    } catch {
      // Best-effort.
    }
  }

  // ─── Enrichment (yearly, profile, leagues, division, series) ──────────────

  // Background enrichment: only runs when we have a cust_id (from the main
  // snapshot) and the enrichment cache is missing/stale. De-duplicated.
  private async maybeBackgroundEnrichment(): Promise<void> {
    if (this.enrichmentInFlight) return
    const custId = this.snapshot?.custId
    if (!custId) return
    const enrichIsStale =
      !this.enrichment ||
      this.enrichment.custId !== custId ||
      Date.now() - this.enrichment.fetchedAt > ENRICHMENT_TTL_MS
    if (!enrichIsStale) return
    if (this.authState === 'needs-login') return
    if (!(await this.hasSession())) return
    const work = this.doFetchEnrichment(custId).finally(() => {
      this.enrichmentInFlight = null
    })
    this.enrichmentInFlight = work
    return work
  }

  private async doFetchEnrichment(custId: number): Promise<void> {
    if (!(await this.ensureAuthed())) return
    try {
      const primaryCategoryId = this.snapshot?.primaryCategoryId ?? null

      const yearly = await this.guarded<IRacingYearlyStat[]>(
        () => this.api.getMemberYearlyStats(custId),
        []
      )
      const rawProfile = await this.guarded<IRacingMemberProfile | null>(
        () => this.api.getMemberProfile(custId),
        null
      )
      const rawLeagues = await this.guarded<IRacingLeagueMembership[]>(
        () => this.api.getLeagueMembership(custId),
        []
      )
      const rawSeasons = await this.guarded<IRacingSeasonSeries[]>(
        () => this.api.getSeriesSeasons(),
        []
      )

      // Division: fetch for primary category only to keep API calls bounded.
      let division: CareerDivision | null = null
      if (primaryCategoryId !== null) {
        const rawDiv = await this.guarded(
          () => this.api.getMemberDivision(custId, primaryCategoryId),
          null
        )
        if (rawDiv) division = normalizeDivision(rawDiv, primaryCategoryId)
      }

      const enrichment: EnrichmentCacheFile = {
        version: 1,
        fetchedAt: Date.now(),
        custId,
        yearly: yearly.map(normalizeYearlyStat),
        profile: rawProfile ? normalizeProfile(rawProfile) : null,
        leagues: rawLeagues.map(normalizeLeague),
        divisions: primaryCategoryId !== null ? { [String(primaryCategoryId)]: division } : {},
        activeSeasonsForPrimary: primaryCategoryId !== null
          ? rawSeasons
              .filter((s) => (s.active !== false) && s.category_id === primaryCategoryId)
              .slice(0, 20)
              .map(normalizeSeasonSeries)
          : []
      }

      this.enrichment = enrichment
      await this.saveEnrichment(enrichment)
    } catch {
      // Enrichment is fully optional; any failure just keeps cached data.
    }
  }

  private buildEnrichmentResult(): CareerEnrichmentResult {
    const e = this.enrichment
    const primaryCategoryId = this.snapshot?.primaryCategoryId ?? null
    const division =
      primaryCategoryId !== null
        ? (e?.divisions[String(primaryCategoryId)] ?? null)
        : null
    return {
      yearly: e?.yearly ?? [],
      profile: e?.profile ?? null,
      leagues: e?.leagues ?? [],
      division,
      activeSeasonsForPrimary: e?.activeSeasonsForPrimary ?? [],
      status: this.buildStatus()
    }
  }

  private async loadEnrichmentFromDisk(): Promise<void> {
    try {
      const raw = await readFile(this.enrichmentFile, 'utf8')
      const parsed = JSON.parse(raw) as Partial<EnrichmentCacheFile>
      if (parsed && parsed.version === 1 && typeof parsed.custId === 'number') {
        this.enrichment = {
          version: 1,
          fetchedAt: typeof parsed.fetchedAt === 'number' ? parsed.fetchedAt : 0,
          custId: parsed.custId,
          yearly: parsed.yearly ?? [],
          profile: parsed.profile ?? null,
          leagues: parsed.leagues ?? [],
          divisions: parsed.divisions ?? {},
          activeSeasonsForPrimary: parsed.activeSeasonsForPrimary ?? []
        }
      }
    } catch {
      // No enrichment cache yet.
    }
  }

  private async saveEnrichment(enrichment: EnrichmentCacheFile): Promise<void> {
    try {
      await mkdir(this.ctx.app.getPath('userData'), { recursive: true })
      await writeFile(this.enrichmentFile, JSON.stringify(enrichment), 'utf8')
    } catch {
      // Best-effort.
    }
  }
}

// ─── Pure normalization helpers ───────────────────────────────────────────────

function num(value: number | undefined | null): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function str(value: string | undefined | null): string {
  return typeof value === 'string' ? value : ''
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function timeMs(iso: string): number {
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? parsed : 0
}

function pct(part: number, whole: number): number {
  return whole > 0 ? round2((part / whole) * 100) : 0
}

function normalizeLicense(license: IRacingMemberLicense): CareerLicense {
  const categoryId = num(license.category_id)
  return {
    categoryId,
    category: str(license.category) || str(license.category_name) || careerCategoryLabel(categoryId),
    groupName: str(license.group_name) || '—',
    licenseLevel: num(license.license_level),
    iRating: num(license.irating),
    // member/info + member/get return SR as a human float already (e.g. 3.45).
    safetyRating: round2(num(license.safety_rating)),
    cpi: typeof license.cpi === 'number' && Number.isFinite(license.cpi) ? license.cpi : undefined,
    color: str(license.color) || undefined
  }
}

function licensesFromInfoDict(dict: Record<string, IRacingMemberLicense> | undefined): CareerLicense[] {
  if (!dict || typeof dict !== 'object') return []
  const out: CareerLicense[] = []
  for (const license of Object.values(dict)) {
    if (license && typeof license === 'object' && typeof license.category_id === 'number') {
      out.push(normalizeLicense(license))
    }
  }
  return out
}

function sortLicenses(licenses: CareerLicense[]): CareerLicense[] {
  const order = new Map(CAREER_CATEGORIES.map((category, index): [number, number] => [category.id, index]))
  return [...licenses].sort((a, b) => (order.get(a.categoryId) ?? 99) - (order.get(b.categoryId) ?? 99))
}

function normalizeCareerStat(stat: IRacingCareerStat): CareerCategoryStat {
  const categoryId = num(stat.category_id)
  const starts = num(stat.starts)
  const wins = num(stat.wins)
  const top5 = num(stat.top5)
  const poles = num(stat.poles)
  return {
    categoryId,
    category: str(stat.category) || careerCategoryLabel(categoryId),
    starts,
    wins,
    top5,
    poles,
    laps: num(stat.laps),
    lapsLed: num(stat.laps_led),
    // Career averages are already 1-based human positions (unlike per-race
    // results, which are 0-based and bumped in normalizeRecentRace).
    avgStartPosition: num(stat.avg_start_position),
    avgFinishPosition: num(stat.avg_finish_position),
    avgIncidents: round2(num(stat.avg_incidents)),
    // Computed from the raw counts so the percentage scale is unambiguous.
    winPercentage: pct(wins, starts),
    top5Percentage: pct(top5, starts),
    polesPercentage: pct(poles, starts)
  }
}

function normalizeThisYear(summary: IRacingThisYearSummary | null): CareerThisYear | null {
  if (!summary) return null
  return {
    officialStarts: num(summary.num_official_sessions),
    officialWins: num(summary.num_official_wins),
    leagueStarts: num(summary.num_league_sessions),
    leagueWins: num(summary.num_league_wins)
  }
}

function normalizeRecentRace(race: IRacingRecentRace, cars: Map<number, string>): CareerRecentRace {
  // members-ng results positions are 0-based (0 = P1); bump to human 1-based.
  const startPosition = num(race.start_position) + 1
  const finishPosition = num(race.finish_position) + 1
  const carId = num(race.car_id)
  const oldIRating = num(race.oldi_rating)
  const newIRating = num(race.newi_rating)
  return {
    subsessionId: num(race.subsession_id),
    sessionStartTime: str(race.session_start_time),
    seriesName: str(race.series_name) || '—',
    carId,
    carName: cars.get(carId) || (carId ? `Car #${carId}` : '—'),
    trackId: num(race.track?.track_id),
    trackName: str(race.track?.track_name) || '—',
    startPosition,
    finishPosition,
    fieldSize: typeof race.field_size === 'number' ? num(race.field_size) : undefined,
    incidents: num(race.incidents),
    laps: num(race.laps),
    lapsLed: num(race.laps_led),
    oldIRating,
    newIRating,
    iRatingDelta: newIRating - oldIRating,
    // Recent-race sub levels are safety ratings ×100.
    oldSafetyRating: round2(num(race.old_sub_level) / 100),
    newSafetyRating: round2(num(race.new_sub_level) / 100),
    strengthOfField: num(race.strength_of_field),
    won: finishPosition === 1
  }
}

function normalizeCharts(categoryId: number, iRating: IRacingChartData, safety: IRacingChartData): CareerCategoryCharts {
  const mapPoints = (data: IRacingChartData['data'], scale: number): CareerChartPoint[] =>
    data
      .map((point) => ({ when: str(point.when), value: round2(num(point.value) / scale) }))
      .filter((point) => point.when.length > 0)
      .sort((a, b) => timeMs(a.when) - timeMs(b.when))
  return {
    categoryId,
    category: careerCategoryLabel(categoryId),
    iRating: mapPoints(iRating.data, 1),
    // chart_type 3 (License/SR) values are safety ratings ×100.
    safetyRating: mapPoints(safety.data, 100)
  }
}

function aggregateStrengths(
  races: CareerRecentRace[],
  keyOf: (race: CareerRecentRace) => number,
  nameOf: (race: CareerRecentRace) => string
): CareerStrength[] {
  interface Acc {
    name: string
    starts: number
    wins: number
    bestFinish: number
    finishSum: number
    incidentsSum: number
    deltaSum: number
  }
  const map = new Map<number, Acc>()
  for (const race of races) {
    const key = keyOf(race)
    if (!key) continue
    const acc = map.get(key) ?? {
      name: nameOf(race),
      starts: 0,
      wins: 0,
      bestFinish: Number.POSITIVE_INFINITY,
      finishSum: 0,
      incidentsSum: 0,
      deltaSum: 0
    }
    acc.starts += 1
    acc.wins += race.won ? 1 : 0
    acc.bestFinish = Math.min(acc.bestFinish, race.finishPosition)
    acc.finishSum += race.finishPosition
    acc.incidentsSum += race.incidents
    acc.deltaSum += race.iRatingDelta
    map.set(key, acc)
  }
  return [...map.entries()]
    .map(([id, acc]) => ({
      id,
      name: acc.name,
      starts: acc.starts,
      wins: acc.wins,
      bestFinish: Number.isFinite(acc.bestFinish) ? acc.bestFinish : 0,
      avgFinish: round2(acc.finishSum / acc.starts),
      avgIncidents: round2(acc.incidentsSum / acc.starts),
      avgIRatingDelta: Math.round(acc.deltaSum / acc.starts)
    }))
    .sort((a, b) => b.starts - a.starts || a.avgFinish - b.avgFinish)
}

function buildIncidentTrend(races: CareerRecentRace[]): CareerIncidentPoint[] {
  return [...races]
    .sort((a, b) => timeMs(a.sessionStartTime) - timeMs(b.sessionStartTime))
    .map((race) => ({
      when: race.sessionStartTime,
      incidents: race.incidents,
      subsessionId: race.subsessionId
    }))
}

// Sports Car (5) is the home discipline for GT3; otherwise default to the
// most-raced category. Null when there is nothing to show.
function pickPrimaryCategory(availableCategoryIds: number[]): number | null {
  if (availableCategoryIds.includes(5)) return 5
  return availableCategoryIds[0] ?? null
}

// ─── New enrichment normalizers ───────────────────────────────────────────────

function normalizeYearlyStat(stat: IRacingYearlyStat): CareerYearlyStat {
  const categoryId = num(stat.category_id)
  const starts = num(stat.starts)
  const wins = num(stat.wins)
  const top5 = num(stat.top5)
  const poles = num(stat.poles)
  return {
    year: num(stat.year),
    categoryId,
    category: str(stat.category) || careerCategoryLabel(categoryId),
    starts,
    wins,
    top5,
    poles,
    laps: num(stat.laps),
    lapsLed: num(stat.laps_led),
    avgStartPosition: num(stat.avg_start_position),
    avgFinishPosition: num(stat.avg_finish_position),
    avgIncidents: round2(num(stat.avg_incidents)),
    winPercentage: num(stat.win_percentage) || pct(wins, starts),
    top5Percentage: num(stat.top5_percentage) || pct(top5, starts)
  }
}

function normalizeProfile(raw: IRacingMemberProfile): CareerProfile {
  return {
    custId: num(raw.cust_id),
    displayName: str(raw.display_name) || undefined,
    clubName: str(raw.club_name) || undefined,
    memberSince: str(raw.member_since) || undefined,
    helmetColor1: str(raw.helmet?.color1) || undefined,
    helmetColor2: str(raw.helmet?.color2) || undefined,
    helmetColor3: str(raw.helmet?.color3) || undefined,
    helmetPattern: typeof raw.helmet?.pattern === 'number' ? raw.helmet.pattern : undefined
  }
}

function normalizeLeague(raw: IRacingLeagueMembership): CareerLeague {
  return {
    leagueId: num(raw.league_id),
    leagueName: str(raw.league_name) || `Liga #${raw.league_id}`,
    owner: raw.owner === true,
    admin: raw.admin === true,
    rosterCount: typeof raw.roster_count === 'number' ? num(raw.roster_count) : undefined
  }
}

function normalizeSeasonSeries(raw: IRacingSeasonSeries): CareerActiveSeason {
  const categoryId = num(raw.category_id)
  return {
    seasonId: num(raw.season_id),
    seriesId: num(raw.series_id),
    seasonName: str(raw.season_name) || `Temporada #${raw.season_id}`,
    seriesName: str(raw.series_name) || `Series #${raw.series_id}`,
    categoryId,
    categoryLabel: careerCategoryLabel(categoryId),
    official: raw.official !== false,
    fixedSetup: raw.fixed_setup === true,
    minLicenseLevel: num(raw.min_license_level),
    maxLicenseLevel: num(raw.max_license_level)
  }
}

function normalizeDivision(raw: { division?: number; rank?: number; points?: number }, categoryId: number): CareerDivision {
  return {
    categoryId,
    division: num(raw.division),
    rank: num(raw.rank),
    points: num(raw.points)
  }
}

export function register(ctx: ModuleContext): void {
  const module = new CareerModule(ctx)
  module.registerIpc()
  void module.bootstrap()
}
