// Regression guard for audit P1-12: "caches are not partitioned by identity and
// logout does not wipe — user B can see user A's data".
//
// Before the fix:
//   • `onSharedAuthChanged` set `authState = 'needs-login'` on logout but left
//     `this.snapshot` in memory AND `career-cache.json` / `career-enrichment.json`
//     on disk, so the next person to sign in on the machine saw the previous
//     driver's name, licences, iRating charts and race history.
//   • `doRefresh` carried the previous identity's charts forward with
//     `{ ...(this.snapshot?.charts ?? {}) }` without ever comparing cust_id, so
//     one member's iRating history was merged into another member's snapshot.
//   • `buildEnrichmentResult` returned whatever enrichment happened to be loaded,
//     with no cust_id check.
//
// These tests drive the real bootstrap / auth-change / refresh paths against a
// temp userData directory. All identities and values are synthetic.
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CAREER_CHANNELS } from '../../shared/career'
import type { ModuleContext } from '../module-context'

const DRIVER_A = 111_111
const DRIVER_B = 222_222

type AuthListener = () => void
type CareerHandlers = {
  overview: () => Promise<{ identity: { custId: number } | null }>
  charts: (categoryId: number) => Promise<{ charts: { iRating?: Array<{ value: number }> } | null }>
  enrichment: () => Promise<{ leagues: unknown[]; yearly: unknown[] }>
  refresh: () => Promise<unknown>
}

interface FakeAuth {
  snapshotAuth: 'ready' | 'needs-login' | 'unconfigured' | 'rate-limited' | 'error'
  api: unknown
  listeners: AuthListener[]
}

const fakeAuth: FakeAuth = { snapshotAuth: 'ready', api: null, listeners: [] }

vi.mock('../track-map/iracing-auth-service', () => ({
  getSharedIRacingAuthService: () => ({
    bootstrap: () => Promise.resolve(),
    getApi: () => fakeAuth.api,
    getLastErrorMessage: () => undefined,
    buildSnapshot: () => ({ auth: fakeAuth.snapshotAuth, lastErrorMessage: undefined }),
    onChanged: (listener: AuthListener) => fakeAuth.listeners.push(listener)
  }),
  honestDataApiMessage: () => 'unavailable'
}))

const { CareerModule } = await import('./career')

let root: string

function driverCache(custId: number, displayName: string): string {
  return JSON.stringify({
    version: 1,
    fetchedAt: Date.now(),
    custId,
    identity: { custId, displayName },
    licenses: [],
    career: [],
    thisYear: null,
    recentRaces: [],
    charts: { '5': { categoryId: 5, iRating: [{ when: '2026-01-01', value: 4321 }], safety: [] } },
    strengthsByCar: [],
    strengthsByTrack: [],
    incidentTrend: [],
    availableCategoryIds: [5],
    primaryCategoryId: 5
  })
}

type Handler = (...args: unknown[]) => unknown

function makeCtx(handlers: Map<string, Handler>): ModuleContext {
  return {
    app: { getPath: () => root, once: () => undefined },
    ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
    broadcast: () => undefined
  } as unknown as ModuleContext
}

/** Every optional call fails (and is absorbed by `guarded`); only identity resolves. */
function apiForDriver(custId: number): unknown {
  const reject = (): Promise<never> => Promise.reject(new Error('offline in test'))
  return {
    isAuthed: () => true,
    authenticate: () => Promise.resolve(),
    invalidate: () => undefined,
    getMemberInfo: () => Promise.resolve({ cust_id: custId, display_name: `Driver ${custId}` }),
    getMemberCareer: reject,
    getMemberRecentRaces: reject,
    getMemberSummary: reject,
    getMembers: reject,
    getMemberChartData: reject,
    getCars: reject,
    getMemberYearlyStats: reject,
    getMemberProfile: reject,
    getLeagueMembership: reject,
    getMemberDivision: reject
  }
}

beforeEach(() => {
  root = mkdtempSync(join(process.cwd(), 'career-identity-test-'))
  fakeAuth.snapshotAuth = 'ready'
  fakeAuth.api = apiForDriver(DRIVER_A)
  fakeAuth.listeners = []
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

async function bootModule(): Promise<{ readonly api: CareerHandlers; readonly cacheFile: string }> {
  const handlers = new Map<string, Handler>()
  const module = new CareerModule(makeCtx(handlers))
  module.registerIpc()
  await module.bootstrap()
  return {
    cacheFile: join(root, 'career-cache.json'),
    api: {
      overview: () => handlers.get(CAREER_CHANNELS.getOverview)?.() as never,
      charts: (categoryId) => handlers.get(CAREER_CHANNELS.getCharts)?.(undefined, { categoryId }) as never,
      enrichment: () => handlers.get(CAREER_CHANNELS.getEnrichment)?.() as never,
      refresh: () => handlers.get(CAREER_CHANNELS.refresh)?.() as never
    }
  }
}

function signOut(): void {
  fakeAuth.snapshotAuth = 'unconfigured'
  fakeAuth.api = null
  for (const listener of fakeAuth.listeners) listener()
}

function signInAs(custId: number): void {
  fakeAuth.snapshotAuth = 'ready'
  fakeAuth.api = apiForDriver(custId)
}

describe('career cache identity partitioning (audit P1-12)', () => {
  it('wipes the cached identity from memory and disk when the session is signed out', async () => {
    writeFileSync(join(root, 'career-cache.json'), driverCache(DRIVER_A, 'Driver A'))
    const { api, cacheFile } = await bootModule()
    expect((await api.overview()).identity?.custId).toBe(DRIVER_A)

    signOut()
    await vi.waitFor(() => expect(existsSync(cacheFile)).toBe(false))

    expect((await api.overview()).identity).toBeFalsy()
  })

  it('never leaves driver A data readable once driver B signs in', async () => {
    writeFileSync(join(root, 'career-cache.json'), driverCache(DRIVER_A, 'Driver A'))
    const { api, cacheFile } = await bootModule()
    expect((await api.overview()).identity?.custId).toBe(DRIVER_A)

    signOut()
    await vi.waitFor(() => expect(existsSync(cacheFile)).toBe(false))
    signInAs(DRIVER_B)
    await api.refresh()

    const overview = await api.overview()
    expect(overview.identity?.custId).toBe(DRIVER_B)
    expect(JSON.stringify(overview)).not.toContain('Driver A')
    expect(JSON.stringify(overview)).not.toContain(String(DRIVER_A))
  })

  it('does not carry one member iRating chart history into another member snapshot', async () => {
    writeFileSync(join(root, 'career-cache.json'), driverCache(DRIVER_A, 'Driver A'))
    const { api } = await bootModule()
    expect((await api.charts(5)).charts?.iRating?.[0]?.value).toBe(4321)

    // A refresh that resolves to a DIFFERENT member must not inherit A charts,
    // even with no intervening logout (the session was swapped under the app).
    fakeAuth.api = apiForDriver(DRIVER_B)
    await api.refresh()

    expect((await api.overview()).identity?.custId).toBe(DRIVER_B)
    expect((await api.charts(5)).charts).toBeNull()
  })

  it('does not serve enrichment belonging to a different member', async () => {
    writeFileSync(join(root, 'career-cache.json'), driverCache(DRIVER_A, 'Driver A'))
    writeFileSync(
      join(root, 'career-enrichment.json'),
      JSON.stringify({
        version: 1,
        fetchedAt: Date.now(),
        custId: DRIVER_A,
        yearly: [{ year: 2026, starts: 42 }],
        profile: null,
        leagues: [{ leagueId: 9, leagueName: 'Driver A private league' }],
        divisions: {},
        activeSeasonsForPrimary: []
      })
    )
    const { api } = await bootModule()
    expect((await api.enrichment()).leagues).toHaveLength(1)

    fakeAuth.api = apiForDriver(DRIVER_B)
    await api.refresh()

    const enrichment = await api.enrichment()
    expect(enrichment.leagues).toEqual([])
    expect(enrichment.yearly).toEqual([])
    expect(JSON.stringify(enrichment)).not.toContain('Driver A private league')
  })
})
