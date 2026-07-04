// Shared types for the Career & Ratings Hub.
//
// The career module (src/main/modules/career.ts) pulls a serious GT3 racer's
// iRacing progression from the members-ng Data API and serves the renderer
// (CareerView) a normalized, render-ready snapshot. The renderer keeps ZERO
// knowledge of the raw API shapes (snake_case, ×100 safety ratings, 0-based
// finishing positions, S3-link indirection): every value here is already
// converted to human units so charts/tables can draw it directly.
//
// All numeric units are normalized at the main-process boundary:
//   • iRating          — integer, as-is (e.g. 2345).
//   • safetyRating     — human float (e.g. 3.45), NOT the API's ×100 integer.
//   • finish/start pos — 1-based human positions (the recent-races API is
//     0-based; we add 1 before it ever reaches the renderer).

// ─── iRacing category taxonomy ──────────────────────────────────────────────
// members-ng category ids. Road (2) is the legacy combined road category; in
// the modern split a GT3 racer lives under Sports Car (5). We surface every
// discipline the member actually races and let the view pick a sensible
// default (see `primaryCategoryId`).
export interface CareerCategoryMeta {
  id: number
  // Stable key matching the `licenses` object keys returned by /data/member/info.
  key: string
  label: string
}

export const CAREER_CATEGORIES: readonly CareerCategoryMeta[] = [
  { id: 5, key: 'sports_car', label: 'Sports Car' },
  { id: 6, key: 'formula_car', label: 'Formula Car' },
  { id: 2, key: 'road', label: 'Road' },
  { id: 1, key: 'oval', label: 'Oval' },
  { id: 4, key: 'dirt_road', label: 'Dirt Road' },
  { id: 3, key: 'dirt_oval', label: 'Dirt Oval' }
] as const

export function careerCategoryLabel(categoryId: number, fallback?: string): string {
  const meta = CAREER_CATEGORIES.find((category) => category.id === categoryId)
  return meta?.label ?? (fallback && fallback.trim() ? fallback : `Categoria ${categoryId}`)
}

// ─── Auth / status ──────────────────────────────────────────────────────────
// The career module reuses the track-map embedded-browser session, so its auth
// state mirrors "do we currently hold a valid iRacing session cookie?".
export type CareerAuthState =
  | 'unknown' // not checked yet (initial)
  | 'ready' // authenticated and data available
  | 'loading' // a network refresh is in flight
  | 'needs-login' // no valid iRacing session — show the login CTA
  | 'rate-limited' // members-ng returned 429; cached data still shown
  | 'error' // network / unexpected error; cached data still shown

export interface CareerStatus {
  auth: CareerAuthState
  // epoch ms of the last SUCCESSFUL network fetch (undefined if never).
  lastUpdated?: number
  // True when the payload was served from the on-disk cache rather than a fresh
  // fetch — lets the view show an "offline / cached" hint.
  fromCache: boolean
  // User-facing (PT-BR) message for the current state (error detail or hint).
  message?: string
  custId?: number
  displayName?: string
}

// ─── License / ratings ──────────────────────────────────────────────────────
export interface CareerLicense {
  categoryId: number
  category: string // display label (e.g. "Sports Car")
  groupName: string // license class label (e.g. "Class A", "Rookie")
  licenseLevel: number
  iRating: number
  safetyRating: number // human SR, e.g. 3.45
  cpi?: number
  // iRacing-provided hex colour for the class (e.g. "0153db"), when present.
  color?: string
}

// ─── Career stats (per discipline) ──────────────────────────────────────────
export interface CareerCategoryStat {
  categoryId: number
  category: string
  starts: number
  wins: number
  top5: number
  poles: number
  laps: number
  lapsLed: number
  avgStartPosition: number
  avgFinishPosition: number
  avgIncidents: number
  winPercentage: number
  top5Percentage: number
  polesPercentage: number
}

// ─── Time series (history graphs) ───────────────────────────────────────────
export interface CareerChartPoint {
  // ISO-ish timestamp string straight from iRacing (e.g. "2024-03-01T12:00:00Z").
  when: string
  // Already in human units: iRating as integer, SR as float (e.g. 3.45).
  value: number
}

export type CareerChartKind = 'irating' | 'safety'

export interface CareerCategoryCharts {
  categoryId: number
  category: string
  iRating: CareerChartPoint[]
  safetyRating: CareerChartPoint[]
}

// ─── Recent races ───────────────────────────────────────────────────────────
export interface CareerRecentRace {
  subsessionId: number
  sessionStartTime: string
  seriesName: string
  carId: number
  carName: string
  trackId: number
  trackName: string
  startPosition: number // 1-based human position
  finishPosition: number // 1-based human position
  fieldSize?: number
  incidents: number
  laps: number
  lapsLed: number
  oldIRating: number
  newIRating: number
  iRatingDelta: number
  oldSafetyRating: number // human SR before the race
  newSafetyRating: number // human SR after the race
  strengthOfField: number
  won: boolean
}

// ─── Derived aggregates ─────────────────────────────────────────────────────
// Per-car and per-track "recent form" rolled up from the recent-races window
// (iRacing's recent-races endpoint only returns the latest handful of races, so
// these are explicitly RECENT strengths, not all-time).
export interface CareerStrength {
  id: number // car_id or track_id
  name: string
  starts: number
  wins: number
  bestFinish: number // 1-based
  avgFinish: number
  avgIncidents: number
  avgIRatingDelta: number
}

// One point per recent race for the incident-trend sparkline.
export interface CareerIncidentPoint {
  when: string
  incidents: number
  subsessionId: number
}

export interface CareerThisYear {
  officialStarts: number
  officialWins: number
  leagueStarts: number
  leagueWins: number
}

export interface CareerIdentity {
  custId: number
  displayName: string
}

// ─── IPC payloads ───────────────────────────────────────────────────────────
// `career:getOverview` — identity, current licenses, per-discipline career
// stats, this-year summary, derived strengths + incident trend. Does NOT carry
// the heavy time-series (fetched per-category via getCharts) nor the full
// recent-race table (via getRecent), but the discipline list it returns drives
// both of those.
export interface CareerOverview {
  identity: CareerIdentity | null
  licenses: CareerLicense[]
  career: CareerCategoryStat[]
  thisYear: CareerThisYear | null
  strengthsByCar: CareerStrength[]
  strengthsByTrack: CareerStrength[]
  incidentTrend: CareerIncidentPoint[]
  // Discipline ids that have at least one start, most-active first.
  availableCategoryIds: number[]
  // Default discipline for the history charts (Sports Car preferred, else the
  // most-raced category). Null when there is no data yet.
  primaryCategoryId: number | null
  status: CareerStatus
}

// `career:getCharts` argument + result.
export interface CareerChartsRequest {
  categoryId: number
}

export interface CareerChartsResult {
  categoryId: number
  charts: CareerCategoryCharts | null
  status: CareerStatus
}

// `career:getRecent` result.
export interface CareerRecentResult {
  races: CareerRecentRace[]
  status: CareerStatus
}

// Broadcast payload for `career:updated` (emitted after every refresh attempt).
export interface CareerUpdatedEvent {
  status: CareerStatus
}

// ─── Enrichment data (yearly, profile, series, leagues, division) ────────────

export interface CareerYearlyStat {
  year: number
  categoryId: number
  category: string
  starts: number
  wins: number
  top5: number
  poles: number
  laps: number
  lapsLed: number
  avgStartPosition: number
  avgFinishPosition: number
  avgIncidents: number
  winPercentage: number
  top5Percentage: number
}

export interface CareerProfile {
  custId: number
  displayName?: string
  clubName?: string
  memberSince?: string
  helmetColor1?: string
  helmetColor2?: string
  helmetColor3?: string
  helmetPattern?: number
}

export interface CareerActiveSeason {
  seasonId: number
  seriesId: number
  seasonName: string
  seriesName: string
  categoryId: number
  categoryLabel: string
  official: boolean
  fixedSetup: boolean
  minLicenseLevel: number
  maxLicenseLevel: number
}

export interface CareerLeague {
  leagueId: number
  leagueName: string
  owner: boolean
  admin: boolean
  rosterCount?: number
}

export interface CareerDivision {
  categoryId: number
  division: number
  rank: number
  points: number
}

export interface CareerEnrichmentResult {
  yearly: CareerYearlyStat[]
  profile: CareerProfile | null
  leagues: CareerLeague[]
  division: CareerDivision | null
  activeSeasonsForPrimary: CareerActiveSeason[]
  status: CareerStatus
}

// ─── IPC channel names ──────────────────────────────────────────────────────
// Single source of truth for both the preload allowlist (the `career:` prefix)
// and the renderer hooks. Mirrors the `track-map.ts` convention.
export const CAREER_CHANNELS = {
  getOverview: 'career:getOverview',
  getCharts: 'career:getCharts',
  getRecent: 'career:getRecent',
  getEnrichment: 'career:getEnrichment',
  refresh: 'career:refresh',
  // Broadcast emitted whenever a refresh finishes (success or failure) so the
  // view can re-pull the latest snapshot/status.
  updated: 'career:updated'
} as const

export type CareerChannel = (typeof CAREER_CHANNELS)[keyof typeof CAREER_CHANNELS]
