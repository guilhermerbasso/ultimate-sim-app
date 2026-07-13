import { describe, expect, it, vi } from 'vitest'
import type { CachedAsset, CachedAssetWithSvg } from './store'
import { TrackMapModule } from './index'
import {
  captureTrackLayout,
  findCatalogLayout,
  type TrackLayoutIdentity
} from './types'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

async function waitForCalls(spy: ReturnType<typeof vi.fn>, count: number): Promise<void> {
  for (let i = 0; i < 50 && spy.mock.calls.length < count; i += 1) {
    await Promise.resolve()
  }
  expect(spy).toHaveBeenCalledTimes(count)
}

function track(trackId: number, trackName: string, configName?: string): {
  track_id: number
  track_name: string
  config_name: string | null
} {
  return {
    track_id: trackId,
    track_name: trackName,
    config_name: configName ?? null
  }
}

function cached(
  trackId: number,
  trackName: string,
  configName: string | undefined,
  svg: string
): CachedAssetWithSvg {
  return {
    trackId,
    trackName,
    configName,
    baseUrl: `https://maps/${trackId}/`,
    layerFilenames: { active: 'active.svg' },
    cachedAt: 1,
    layers: { active: svg },
    activeSvg: svg
  }
}

function boundCached(
  layout: TrackLayoutIdentity,
  trackId: number,
  svg: string,
  catalogGeneration = 0
): CachedAssetWithSvg & {
  catalogGeneration: number
  resolvedTrackId: number
  layout: TrackLayoutIdentity
} {
  return {
    ...cached(trackId, layout.trackName, layout.trackConfigName, svg),
    catalogGeneration,
    resolvedTrackId: trackId,
    layout
  }
}

function bareModule(): any {
  const saveAsset = vi.fn(
    async (asset: CachedAsset, content: { active?: string }): Promise<CachedAssetWithSvg> => ({
      ...asset,
      layers: { active: content.active },
      activeSvg: content.active
    })
  )
  return Object.assign(Object.create(TrackMapModule.prototype), {
    catalog: [
      track(1, 'Shared Venue', 'Grand Prix'),
      track(2, 'Shared Venue', 'Club')
    ],
    catalogFresh: true,
    catalogGeneration: 0,
    currentLayoutRevision: 0,
    resolutionAttempted: new Set(),
    resolvedSvgByLayout: new Map(),
    refreshCoordinator: {
      generation: 0,
      inflight: new Map(),
      commitTail: Promise.resolve()
    },
    authStatus: 'ready',
    learner: {
      get: vi.fn(() => null),
      has: vi.fn(() => false),
      getRecordingSnapshot: vi.fn(() => ({ active: false })),
      setCatalog: vi.fn(async () => undefined)
    },
    auth: {
      getApi: vi.fn(() => null),
      handleApiError: vi.fn()
    },
    assetsCache: {
      loadCatalog: vi.fn(async () => null),
      catalogIsFresh: vi.fn(() => false),
      saveCatalog: vi.fn(async () => undefined),
      loadAsset: vi.fn(async () => null),
      saveAsset
    },
    broadcastUpdate: vi.fn()
  })
}

function catalogRaceHarness(): {
  subject: any
  oldCatalog: ReturnType<typeof deferred<ReturnType<typeof track>[]>>
  newerCatalog: ReturnType<typeof deferred<ReturnType<typeof track>[]>>
  listTracks: ReturnType<typeof vi.fn>
  saveCatalog: ReturnType<typeof vi.fn>
  handleApiError: ReturnType<typeof vi.fn>
} {
  const subject = bareModule()
  const oldCatalog = deferred<ReturnType<typeof track>[]>()
  const newerCatalog = deferred<ReturnType<typeof track>[]>()
  const listTracks = vi.fn()
    .mockImplementationOnce(() => oldCatalog.promise)
    .mockImplementationOnce(() => newerCatalog.promise)
  const saveCatalog = vi.fn(async () => undefined)
  const handleApiError = vi.fn()
  const api = {
    listTracks,
    listTrackAssets: vi.fn(async () => new Map()),
    fetchSvgLayer: vi.fn(),
    lastAuthAt: vi.fn(() => 123)
  }
  subject.auth = { getApi: () => api, handleApiError }
  subject.assetsCache = {
    ...subject.assetsCache,
    saveCatalog
  }
  return { subject, oldCatalog, newerCatalog, listTracks, saveCatalog, handleApiError }
}

describe('TrackMapModule layout resolution', () => {
  it('matches combined and separated venue/config names while failing closed on ambiguity', () => {
    const okayama = [
      { trackId: 10, trackName: 'Okayama International Circuit', trackConfigName: 'Full Course' },
      { trackId: 11, trackName: 'Okayama International Circuit', trackConfigName: 'Short Course' }
    ]
    expect(findCatalogLayout(captureTrackLayout({
      trackName: 'Okayama International Circuit - Full Course'
    })!, okayama)?.trackId).toBe(10)
    expect(findCatalogLayout(captureTrackLayout({
      trackName: 'Okayama International Circuit',
      trackConfigName: 'Short Course'
    })!, okayama)?.trackId).toBe(11)
    expect(findCatalogLayout(captureTrackLayout({
      trackName: 'Okayama International Circuit'
    })!, okayama)).toBeNull()
    expect(findCatalogLayout(
      captureTrackLayout({ trackId: 11, trackName: 'Wrong display' })!,
      okayama
    )?.trackId).toBe(11)
  })

  it('ignores an older catalog failure that completes after a newer success', async () => {
    const {
      subject,
      oldCatalog,
      newerCatalog,
      listTracks,
      saveCatalog,
      handleApiError
    } = catalogRaceHarness()
    const layoutA = captureTrackLayout({
      trackId: 1,
      trackName: 'Shared Venue',
      trackConfigName: 'Grand Prix'
    })!
    const layoutB = captureTrackLayout({
      trackId: 2,
      trackName: 'Shared Venue',
      trackConfigName: 'Club'
    })!

    subject.setCurrentLayout(layoutA)
    const older = subject.refreshForCurrentTrack(false, true)
    await waitForCalls(listTracks, 1)
    subject.setCurrentLayout(layoutB)
    const newer = subject.refreshForCurrentTrack(false, true)
    await waitForCalls(listTracks, 2)

    const winningCatalog = [track(2, 'Shared Venue', 'Club')]
    newerCatalog.resolve(winningCatalog)
    await newer
    oldCatalog.reject(new Error('old catalog failed'))
    await older

    expect(subject.catalog).toEqual(winningCatalog)
    expect(subject.catalogFresh).toBe(true)
    expect(subject.catalogGeneration).toBe(2)
    expect(subject.learner.setCatalog).toHaveBeenCalledTimes(1)
    expect(subject.learner.setCatalog).toHaveBeenCalledWith([
      { trackId: 2, trackName: 'Shared Venue', trackConfigName: 'Club' }
    ], true)
    expect(saveCatalog).toHaveBeenCalledTimes(1)
    expect(saveCatalog).toHaveBeenCalledWith(winningCatalog)
    expect(handleApiError).not.toHaveBeenCalled()
  })

  it('ignores an older catalog success that completes after a newer success', async () => {
    const {
      subject,
      oldCatalog,
      newerCatalog,
      listTracks,
      saveCatalog
    } = catalogRaceHarness()
    const layoutA = captureTrackLayout({
      trackId: 1,
      trackName: 'Shared Venue',
      trackConfigName: 'Grand Prix'
    })!
    const layoutB = captureTrackLayout({
      trackId: 2,
      trackName: 'Shared Venue',
      trackConfigName: 'Club'
    })!

    subject.setCurrentLayout(layoutA)
    const older = subject.refreshForCurrentTrack(false, true)
    await waitForCalls(listTracks, 1)
    subject.setCurrentLayout(layoutB)
    const newer = subject.refreshForCurrentTrack(false, true)
    await waitForCalls(listTracks, 2)

    const winningCatalog = [track(2, 'Shared Venue', 'Club')]
    newerCatalog.resolve(winningCatalog)
    await newer
    oldCatalog.resolve([track(1, 'Shared Venue', 'Grand Prix')])
    await older

    expect(subject.catalog).toEqual(winningCatalog)
    expect(subject.catalogGeneration).toBe(2)
    expect(subject.learner.setCatalog).toHaveBeenCalledTimes(1)
    expect(saveCatalog).toHaveBeenCalledTimes(1)
    expect(saveCatalog).toHaveBeenCalledWith(winningCatalog)
  })

  it('queues a forced refresh behind non-forced work and executes it freshly', async () => {
    const subject = bareModule()
    const nonForcedAssets = deferred<Map<number, any>>()
    const forcedAssets = deferred<Map<number, any>>()
    const listTrackAssets = vi.fn()
      .mockImplementationOnce(() => nonForcedAssets.promise)
      .mockImplementationOnce(() => forcedAssets.promise)
    const listTracks = vi.fn(async () => [track(1, 'Shared Venue', 'Grand Prix')])
    const api = {
      listTracks,
      listTrackAssets,
      fetchSvgLayer: vi.fn(),
      lastAuthAt: vi.fn(() => 123)
    }
    subject.auth = { getApi: () => api, handleApiError: vi.fn() }
    const layout = captureTrackLayout({
      trackId: 1,
      trackName: 'Shared Venue',
      trackConfigName: 'Grand Prix'
    })!
    subject.setCurrentLayout(layout)

    const nonForced = subject.refreshForCurrentTrack(false)
    await waitForCalls(listTrackAssets, 1)
    const forced = subject.refreshForCurrentTrack(true)
    await Promise.resolve()
    expect(listTrackAssets).toHaveBeenCalledTimes(1)
    expect(listTracks).not.toHaveBeenCalled()

    nonForcedAssets.resolve(new Map())
    await waitForCalls(listTrackAssets, 2)
    expect(listTracks).toHaveBeenCalledTimes(1)
    forcedAssets.resolve(new Map())
    await Promise.all([nonForced, forced])

    expect(subject.learner.setCatalog).toHaveBeenCalledTimes(1)
    expect(subject.assetsCache.saveCatalog).toHaveBeenCalledTimes(1)
  })

  it('discards stale parallel resolver assets before file/cache/broadcast state', async () => {
    const subject = bareModule()
    const aAssets = deferred<Map<number, any>>()
    const bAssets = deferred<Map<number, any>>()
    const listTrackAssets = vi.fn()
      .mockImplementationOnce(() => aAssets.promise)
      .mockImplementationOnce(() => bAssets.promise)
    const api = {
      listTrackAssets,
      fetchSvgLayer: vi.fn(async (_base: string, file: string) => `<svg id="${file}"/>`),
      lastAuthAt: vi.fn(() => 123)
    }
    const saveAsset = subject.assetsCache.saveAsset
    subject.auth = { getApi: () => api, handleApiError: vi.fn() }
    const layoutA = captureTrackLayout({
      trackId: 1,
      trackName: 'Shared Venue',
      trackConfigName: 'Grand Prix'
    })!
    const layoutB = captureTrackLayout({
      trackId: 2,
      trackName: 'Shared Venue',
      trackConfigName: 'Club'
    })!

    subject.setCurrentLayout(layoutA)
    const resolvingA = subject.refreshForCurrentTrack(false)
    await waitForCalls(listTrackAssets, 1)
    subject.setCurrentLayout(layoutB)
    const resolvingB = subject.refreshForCurrentTrack(false)
    await waitForCalls(listTrackAssets, 2)
    const assets = new Map([
      [1, {
        track_id: 1,
        track_map: 'https://maps/1/',
        track_map_layers: { active: 'a.svg' }
      }],
      [2, {
        track_id: 2,
        track_map: 'https://maps/2/',
        track_map_layers: { active: 'b.svg' }
      }]
    ])
    bAssets.resolve(assets)
    await resolvingB
    aAssets.resolve(assets)
    await resolvingA

    expect(saveAsset.mock.calls.map(([asset]: [CachedAsset]) => asset.trackId)).toEqual([2])
    expect(subject.resolvedSvgByLayout.has(layoutA.key)).toBe(false)
    expect(subject.resolvedSvgByLayout.get(layoutB.key)?.trackId).toBe(2)
    expect(subject.broadcastUpdate).toHaveBeenCalledTimes(1)

    subject.resolvedSvgByLayout.set(
      layoutA.key,
      boundCached(layoutA, 1, '<svg id="gp"/>')
    )
    const gp = subject.buildDataForLookup({
      trackId: 1,
      trackName: 'Shared Venue',
      trackConfigName: 'Grand Prix'
    })
    const club = subject.buildDataForLookup({
      trackId: 2,
      trackName: 'Shared Venue',
      trackConfigName: 'Club'
    })
    const ambiguous = subject.buildDataForLookup('Shared Venue')
    expect(gp).toMatchObject({
      source: 'iracing-svg',
      layoutKey: 'id:1',
      trackId: 1,
      trackConfigName: 'Grand Prix'
    })
    expect(club).toMatchObject({
      source: 'iracing-svg',
      layoutKey: 'id:2',
      trackId: 2,
      trackConfigName: 'Club'
    })
    expect(ambiguous.source).toBe('none')
  })

  it('fails closed when a fresh catalog makes a stale name-key SVG ambiguous', async () => {
    const subject = bareModule()
    const layout = captureTrackLayout({ trackName: 'Legacy Venue' })!
    subject.catalog = [track(10, 'Legacy Venue')]
    subject.catalogFresh = false
    subject.catalogGeneration = 1
    subject.refreshCoordinator.generation = 1
    subject.resolvedSvgByLayout.set(
      layout.key,
      boundCached(layout, 10, '<svg id="legacy"/>', 1)
    )
    subject.setCurrentLayout(layout)
    expect(subject.buildDataForLookup('Legacy Venue')).toMatchObject({
      source: 'iracing-svg',
      trackId: 10
    })

    const freshCatalog = deferred<ReturnType<typeof track>[]>()
    const listTracks = vi.fn(() => freshCatalog.promise)
    const api = {
      listTracks,
      listTrackAssets: vi.fn(async () => new Map()),
      fetchSvgLayer: vi.fn(),
      lastAuthAt: vi.fn(() => 123)
    }
    subject.auth = { getApi: () => api, handleApiError: vi.fn() }
    const refresh = subject.refreshForCurrentTrack(true)
    await waitForCalls(listTracks, 1)
    freshCatalog.resolve([
        track(10, 'Legacy Venue', 'Grand Prix'),
        track(11, 'Legacy Venue', 'Club')
    ])
    await refresh

    expect(subject.catalogFresh).toBe(true)
    expect(subject.resolvedSvgByLayout.has(layout.key)).toBe(false)
    expect(subject.buildDataForLookup('Legacy Venue').source).toBe('none')
    expect(api.listTrackAssets).not.toHaveBeenCalled()
  })

  it('does not serve a name-key SVG when a fresh catalog changes its TrackID', async () => {
    const subject = bareModule()
    const layout = captureTrackLayout({ trackName: 'Renumbered Venue' })!
    subject.catalog = [track(20, 'Renumbered Venue')]
    subject.catalogFresh = false
    subject.catalogGeneration = 1
    subject.refreshCoordinator.generation = 1
    subject.resolvedSvgByLayout.set(
      layout.key,
      boundCached(layout, 20, '<svg id="old-id"/>', 1)
    )
    subject.setCurrentLayout(layout)

    const freshCatalog = deferred<ReturnType<typeof track>[]>()
    const listTracks = vi.fn(() => freshCatalog.promise)
    const listTrackAssets = vi.fn(async () => new Map())
    const api = {
      listTracks,
      listTrackAssets,
      fetchSvgLayer: vi.fn(),
      lastAuthAt: vi.fn(() => 123)
    }
    subject.auth = { getApi: () => api, handleApiError: vi.fn() }
    const refresh = subject.refreshForCurrentTrack(true)
    await waitForCalls(listTracks, 1)
    freshCatalog.resolve([track(21, 'Renumbered Venue')])
    await refresh

    expect(subject.resolvedSvgByLayout.has(layout.key)).toBe(false)
    expect(subject.assetsCache.loadAsset).toHaveBeenCalledWith(21)
    expect(listTrackAssets).toHaveBeenCalledTimes(1)
    expect(subject.buildDataForLookup('Renumbered Venue')).toMatchObject({
      source: 'none',
      layoutKey: 'id:21',
      trackId: 21
    })
  })

  it('keeps an authoritative ID-key SVG valid across catalog generations', async () => {
    const subject = bareModule()
    const layout = captureTrackLayout({ trackId: 30, trackName: 'Authoritative Venue' })!
    subject.catalog = [track(30, 'Authoritative Venue')]
    subject.catalogGeneration = 1
    subject.refreshCoordinator.generation = 1
    subject.resolvedSvgByLayout.set(
      layout.key,
      boundCached(layout, 30, '<svg id="authoritative"/>', 1)
    )
    const freshCatalog = deferred<ReturnType<typeof track>[]>()
    const listTracks = vi.fn(() => freshCatalog.promise)
    const api = {
      listTracks
    }
    subject.auth = { getApi: () => api, handleApiError: vi.fn() }

    const refresh = subject.refreshCatalogOnly(true)
    await waitForCalls(listTracks, 1)
    freshCatalog.resolve([
        track(31, 'Other Venue', 'Grand Prix'),
        track(32, 'Other Venue', 'Club')
    ])
    await refresh

    expect(subject.catalogGeneration).toBe(2)
    expect(subject.resolvedSvgByLayout.has(layout.key)).toBe(true)
    expect(subject.buildDataForLookup({
      trackId: 30,
      trackName: 'Authoritative Venue'
    })).toMatchObject({
      source: 'iracing-svg',
      layoutKey: 'id:30',
      trackId: 30
    })
  })
})
