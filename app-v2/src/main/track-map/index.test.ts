import { describe, expect, it, vi } from 'vitest'
import type { CachedAsset, CachedAssetWithSvg } from './store'
import { TrackMapModule } from './index'
import {
  captureTrackLayout,
  findCatalogLayout,
  type TrackLayoutIdentity
} from './types'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

async function waitForCalls(spy: ReturnType<typeof vi.fn>, count: number): Promise<void> {
  for (let i = 0; i < 100 && spy.mock.calls.length < count; i += 1) {
    await Promise.resolve()
  }
  expect(spy).toHaveBeenCalledTimes(count)
}

function token(): object {
  return {}
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
  catalogToken: object
): CachedAssetWithSvg & {
  catalogToken: object
  resolvedTrackId: number
  layout: TrackLayoutIdentity
} {
  return {
    ...cached(trackId, layout.trackName, layout.trackConfigName, svg),
    catalogToken,
    resolvedTrackId: trackId,
    layout
  }
}

function assetMap(...rows: Array<{ trackId: number; filename?: string; inactive?: string }>): Map<number, any> {
  return new Map(rows.map(({ trackId, filename = 'active.svg', inactive }) => [
    trackId,
    {
      track_id: trackId,
      track_map: `https://maps/${trackId}/`,
      track_map_layers: {
        active: filename,
        ...(inactive ? { inactive } : {})
      }
    }
  ]))
}

function bareModule(): any {
  const initialCatalogToken = token()
  const initialRequestToken = token()
  const initialAuth = { epoch: token(), apiToken: token(), api: null }
  const saveAsset = vi.fn(
    async (
      asset: CachedAsset,
      content: Partial<Record<string, string>>
    ): Promise<CachedAssetWithSvg> => ({
      ...asset,
      layers: { ...content },
      activeSvg: content.active
    })
  )
  return Object.assign(Object.create(TrackMapModule.prototype), {
    catalog: [
      track(1, 'Shared Venue', 'Grand Prix'),
      track(2, 'Shared Venue', 'Club')
    ],
    catalogFresh: true,
    catalogToken: initialCatalogToken,
    currentLayoutToken: token(),
    resolutionAttempted: new Set(),
    resolvedSvgByLayout: new Map(),
    refreshCoordinator: {
      latestRequestToken: initialRequestToken,
      inflight: new Set(),
      publicationTail: Promise.resolve()
    },
    authBinding: initialAuth,
    authUnsubscribe: null,
    telemetryUnsubscribe: null,
    disposed: false,
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
    broadcastUpdate: vi.fn(),
    logRefreshFailure: vi.fn()
  })
}

function bindAuth(subject: any, initialApi: any): {
  handleApiError: ReturnType<typeof vi.fn>
  transition: (api: any) => void
} {
  let api = initialApi
  const handleApiError = vi.fn()
  subject.auth = {
    getApi: () => api,
    handleApiError
  }
  subject.advanceAuthBinding(api)
  return {
    handleApiError,
    transition(nextApi: any): void {
      api = nextApi
      subject.advanceAuthBinding(nextApi)
    }
  }
}

function setLayout(
  subject: any,
  trackId: number,
  trackName = 'Shared Venue',
  trackConfigName?: string
): TrackLayoutIdentity {
  const layout = captureTrackLayout({ trackId, trackName, trackConfigName })!
  subject.setCurrentLayout(layout)
  return layout
}

function catalogRaceHarness(): {
  subject: any
  oldCatalog: Deferred<ReturnType<typeof track>[]>
  newerCatalog: Deferred<ReturnType<typeof track>[]>
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
  const api = {
    listTracks,
    listTrackAssets: vi.fn(async () => new Map()),
    fetchSvgLayer: vi.fn()
  }
  const { handleApiError } = bindAuth(subject, api)
  subject.assetsCache = {
    ...subject.assetsCache,
    saveCatalog
  }
  return { subject, oldCatalog, newerCatalog, listTracks, saveCatalog, handleApiError }
}

describe('TrackMapModule catalog/cache safety', () => {
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
    setLayout(subject, 1, 'Shared Venue', 'Grand Prix')
    const older = subject.refreshForCurrentTrack(true, true)
    await waitForCalls(listTracks, 1)
    setLayout(subject, 2, 'Shared Venue', 'Club')
    const newer = subject.refreshForCurrentTrack(true, true)
    await waitForCalls(listTracks, 2)

    const winningCatalog = [track(2, 'Shared Venue', 'Club')]
    newerCatalog.resolve(winningCatalog)
    await newer
    oldCatalog.reject(new Error('old catalog failed'))
    await older

    expect(subject.catalog).toEqual(winningCatalog)
    expect(subject.catalogFresh).toBe(true)
    expect(subject.learner.setCatalog).toHaveBeenCalledTimes(1)
    expect(saveCatalog).toHaveBeenCalledTimes(1)
    expect(saveCatalog).toHaveBeenCalledWith(winningCatalog)
    expect(handleApiError).not.toHaveBeenCalled()
  })

  it('ignores an older catalog success that completes after a newer success', async () => {
    const { subject, oldCatalog, newerCatalog, listTracks, saveCatalog } = catalogRaceHarness()
    setLayout(subject, 1, 'Shared Venue', 'Grand Prix')
    const older = subject.refreshForCurrentTrack(true, true)
    await waitForCalls(listTracks, 1)
    setLayout(subject, 2, 'Shared Venue', 'Club')
    const newer = subject.refreshForCurrentTrack(true, true)
    await waitForCalls(listTracks, 2)

    const winningCatalog = [track(2, 'Shared Venue', 'Club')]
    newerCatalog.resolve(winningCatalog)
    await newer
    oldCatalog.resolve([track(1, 'Shared Venue', 'Grand Prix')])
    await older

    expect(subject.catalog).toEqual(winningCatalog)
    expect(subject.learner.setCatalog).toHaveBeenCalledTimes(1)
    expect(saveCatalog).toHaveBeenCalledTimes(1)
    expect(saveCatalog).toHaveBeenCalledWith(winningCatalog)
  })

  it('queues and coalesces forced work behind a non-forced refresh', async () => {
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
      fetchSvgLayer: vi.fn()
    }
    bindAuth(subject, api)
    setLayout(subject, 1, 'Shared Venue', 'Grand Prix')

    const nonForced = subject.refreshForCurrentTrack(false)
    await waitForCalls(listTrackAssets, 1)
    const forced = subject.refreshForCurrentTrack(true)
    const coalescedForce = subject.refreshForCurrentTrack(true)
    expect(coalescedForce).toBe(forced)
    await Promise.resolve()
    expect(listTrackAssets).toHaveBeenCalledTimes(1)
    expect(listTracks).not.toHaveBeenCalled()

    nonForcedAssets.resolve(new Map())
    await waitForCalls(listTrackAssets, 2)
    expect(listTracks).toHaveBeenCalledTimes(1)
    forcedAssets.resolve(new Map())
    await Promise.all([nonForced, forced, coalescedForce])

    expect(subject.learner.setCatalog).toHaveBeenCalledTimes(1)
    expect(subject.assetsCache.saveCatalog).toHaveBeenCalledTimes(1)
  })

  it('does not dedupe or publish across a new auth epoch with the same API object', async () => {
    const subject = bareModule()
    const oldAssets = deferred<Map<number, any>>()
    const newAssets = deferred<Map<number, any>>()
    const listTrackAssets = vi.fn()
      .mockImplementationOnce(() => oldAssets.promise)
      .mockImplementationOnce(() => newAssets.promise)
    const api = {
      listTrackAssets,
      fetchSvgLayer: vi.fn(async () => '<svg id="fresh"/>')
    }
    const auth = bindAuth(subject, api)
    const layout = setLayout(subject, 1, 'Shared Venue', 'Grand Prix')

    const oldRefresh = subject.refreshForCurrentTrack(false)
    await waitForCalls(listTrackAssets, 1)
    auth.transition(api)
    const newRefresh = subject.refreshForCurrentTrack(false)
    await waitForCalls(listTrackAssets, 2)

    newAssets.resolve(assetMap({ trackId: 1, filename: 'fresh.svg' }))
    await newRefresh
    oldAssets.resolve(assetMap({ trackId: 1, filename: 'old.svg' }))
    await oldRefresh

    expect(subject.assetsCache.saveAsset).toHaveBeenCalledTimes(1)
    expect(subject.resolvedSvgByLayout.get(layout.key)?.activeSvg).toContain('fresh')
  })

  it('drops old-auth SVG completion after logout during a deferred fetch', async () => {
    const subject = bareModule()
    const svg = deferred<string>()
    const fetchSvgLayer = vi.fn(() => svg.promise)
    const api = {
      listTrackAssets: vi.fn(async () => assetMap({ trackId: 1 })),
      fetchSvgLayer
    }
    const auth = bindAuth(subject, api)
    const layout = setLayout(subject, 1, 'Shared Venue', 'Grand Prix')

    const refresh = subject.refreshForCurrentTrack(false)
    await waitForCalls(fetchSvgLayer, 1)
    auth.transition(null)
    subject.resolvedSvgByLayout.clear()
    svg.resolve('<svg id="logged-out"/>')
    await refresh

    expect(subject.assetsCache.saveAsset).not.toHaveBeenCalled()
    expect(subject.resolvedSvgByLayout.has(layout.key)).toBe(false)
    expect(subject.broadcastUpdate).not.toHaveBeenCalled()
    expect(auth.handleApiError).not.toHaveBeenCalled()
  })

  it('publishes catalog transactions without being overtaken during setCatalog', async () => {
    const subject = bareModule()
    const firstSetCatalog = deferred<void>()
    subject.learner.setCatalog = vi.fn()
      .mockImplementationOnce(() => firstSetCatalog.promise)
      .mockResolvedValue(undefined)
    const firstCatalog = deferred<ReturnType<typeof track>[]>()
    const secondCatalog = deferred<ReturnType<typeof track>[]>()
    const listTracks = vi.fn()
      .mockImplementationOnce(() => firstCatalog.promise)
      .mockImplementationOnce(() => secondCatalog.promise)
    const api = {
      listTracks,
      listTrackAssets: vi.fn(async () => new Map()),
      fetchSvgLayer: vi.fn()
    }
    bindAuth(subject, api)

    setLayout(subject, 1, 'Shared Venue', 'Grand Prix')
    const first = subject.refreshForCurrentTrack(true, true)
    await waitForCalls(listTracks, 1)
    const firstRows = [track(1, 'Shared Venue', 'Grand Prix')]
    firstCatalog.resolve(firstRows)
    await waitForCalls(subject.learner.setCatalog, 1)

    setLayout(subject, 2, 'Shared Venue', 'Club')
    const second = subject.refreshForCurrentTrack(true, true)
    await waitForCalls(listTracks, 2)
    const secondRows = [track(2, 'Shared Venue', 'Club')]
    secondCatalog.resolve(secondRows)
    await Promise.resolve()
    expect(subject.assetsCache.saveCatalog).toHaveBeenCalledTimes(1)

    firstSetCatalog.resolve(undefined)
    await Promise.all([first, second])

    expect(subject.learner.setCatalog).toHaveBeenCalledTimes(2)
    expect(subject.assetsCache.saveCatalog.mock.calls.map(([rows]: [any]) => rows)).toEqual([
      firstRows,
      secondRows
    ])
    expect(subject.catalog).toEqual(secondRows)
  })

  it('does not publish catalog memory after auth changes during saveCatalog', async () => {
    const subject = bareModule()
    const saveCatalog = deferred<void>()
    subject.assetsCache.saveCatalog = vi.fn(() => saveCatalog.promise)
    const rows = [track(7, 'Atomic Venue')]
    const originalCatalog = subject.catalog
    const api = { listTracks: vi.fn(async () => rows) }
    const auth = bindAuth(subject, api)

    const refresh = subject.refreshCatalogOnly(true)
    await waitForCalls(subject.assetsCache.saveCatalog, 1)
    auth.transition(null)
    saveCatalog.resolve(undefined)
    await refresh

    expect(subject.catalog).toBe(originalCatalog)
    expect(subject.catalogFresh).toBe(true)
    expect(subject.learner.setCatalog).not.toHaveBeenCalled()
    expect(auth.handleApiError).not.toHaveBeenCalled()
  })

  it('waits for an admitted publication before completing shared-auth clear', async () => {
    const subject = bareModule()
    const saveCatalog = deferred<void>()
    const order: string[] = []
    subject.assetsCache.saveCatalog = vi.fn(async () => {
      await saveCatalog.promise
      order.push('save')
    })
    const rows = [track(8, 'Clear Barrier Venue')]
    const api = { listTracks: vi.fn(async () => rows) }
    bindAuth(subject, api)
    const clear = vi.fn(async () => {
      order.push('clear')
    })
    subject.auth.clear = clear
    const layout = captureTrackLayout({ trackId: 8, trackName: 'Clear Barrier Venue' })!
    subject.resolvedSvgByLayout.set(
      layout.key,
      boundCached(layout, 8, '<svg id="before-clear"/>', subject.catalogToken)
    )

    const refresh = subject.refreshCatalogOnly(true)
    await waitForCalls(subject.assetsCache.saveCatalog, 1)
    const clearing = subject.clearSharedCredentials()
    await Promise.resolve()
    expect(clear).not.toHaveBeenCalled()

    saveCatalog.resolve(undefined)
    await Promise.all([refresh, clearing])

    expect(order).toEqual(['save', 'clear'])
    expect(subject.resolvedSvgByLayout.size).toBe(0)
    expect(subject.broadcastUpdate).toHaveBeenCalledTimes(1)
  })

  it('serializes saveAsset publication so a newer layout cannot overtake it', async () => {
    const subject = bareModule()
    const firstSave = deferred<CachedAssetWithSvg>()
    const saveAsset = vi.fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(async (
        asset: CachedAsset,
        layers: Partial<Record<string, string>>
      ) => ({
        ...asset,
        layers,
        activeSvg: layers.active
      }))
    subject.assetsCache.saveAsset = saveAsset
    const api = {
      listTrackAssets: vi.fn(async () => assetMap(
        { trackId: 1, filename: 'one.svg' },
        { trackId: 2, filename: 'two.svg' }
      )),
      fetchSvgLayer: vi.fn(async (_base: string, filename: string) => `<svg id="${filename}"/>`)
    }
    bindAuth(subject, api)

    const layoutA = setLayout(subject, 1, 'Shared Venue', 'Grand Prix')
    const first = subject.refreshForCurrentTrack(false)
    await waitForCalls(saveAsset, 1)
    const layoutB = setLayout(subject, 2, 'Shared Venue', 'Club')
    const second = subject.refreshForCurrentTrack(false)
    await Promise.resolve()
    expect(saveAsset).toHaveBeenCalledTimes(1)

    firstSave.resolve(cached(1, 'Shared Venue', 'Grand Prix', '<svg id="one"/>'))
    await waitForCalls(saveAsset, 2)
    await Promise.all([first, second])

    expect(subject.resolvedSvgByLayout.has(layoutA.key)).toBe(false)
    expect(subject.resolvedSvgByLayout.get(layoutB.key)?.trackId).toBe(2)
    expect(subject.broadcastUpdate).toHaveBeenCalledTimes(1)
  })

  it('retains the last good SVG when every layer download fails', async () => {
    const subject = bareModule()
    const layout = setLayout(subject, 1, 'Shared Venue', 'Grand Prix')
    const good = boundCached(layout, 1, '<svg id="good"/>', subject.catalogToken)
    subject.resolvedSvgByLayout.set(layout.key, good)
    subject.assetsCache.loadAsset = vi.fn(async () => good)
    const fetch = deferred<string>()
    const api = {
      listTracks: vi.fn(async () => [track(1, 'Shared Venue', 'Grand Prix')]),
      listTrackAssets: vi.fn(async () => assetMap({ trackId: 1 })),
      fetchSvgLayer: vi.fn(() => fetch.promise)
    }
    const auth = bindAuth(subject, api)

    const refresh = subject.refreshForCurrentTrack(true)
    await waitForCalls(api.fetchSvgLayer, 1)
    fetch.reject(new Error('timeout'))
    await refresh

    expect(subject.assetsCache.saveAsset).not.toHaveBeenCalled()
    expect(subject.resolvedSvgByLayout.get(layout.key)).toStrictEqual(good)
    expect(subject.buildDataForLookup({
      trackId: 1,
      trackName: 'Shared Venue',
      trackConfigName: 'Grand Prix'
    }).svg).toContain('good')
    expect(auth.handleApiError).not.toHaveBeenCalled()
    expect(subject.logRefreshFailure).toHaveBeenCalledWith(
      'track SVG layer refresh failed; retaining last good asset',
      expect.any(Error)
    )
  })

  it('persists only validated partial layers so restart cannot resurrect stale files', async () => {
    const subject = bareModule()
    const layout = setLayout(subject, 1, 'Shared Venue', 'Grand Prix')
    const oldAsset = cached(1, 'Shared Venue', 'Grand Prix', '<svg id="old-active"/>')
    subject.assetsCache.loadAsset = vi.fn(async () => oldAsset)
    const api = {
      listTracks: vi.fn(async () => [track(1, 'Shared Venue', 'Grand Prix')]),
      listTrackAssets: vi.fn(async () => assetMap({
        trackId: 1,
        filename: 'active.svg',
        inactive: 'inactive.svg'
      })),
      fetchSvgLayer: vi.fn(async (_base: string, filename: string) => {
        if (filename === 'active.svg') throw new Error('optional active failed')
        return '<svg id="inactive"/>'
      })
    }
    const auth = bindAuth(subject, api)

    await subject.refreshForCurrentTrack(true)

    expect(subject.assetsCache.saveAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        trackId: 1,
        layerFilenames: { inactive: 'inactive.svg' }
      }),
      { inactive: '<svg id="inactive"/>' }
    )
    expect(subject.resolvedSvgByLayout.get(layout.key)?.layers).toEqual({
      inactive: '<svg id="inactive"/>'
    })
    const [metadata] = subject.assetsCache.saveAsset.mock.calls[0]
    const physicalFiles = {
      active: '<svg id="old-active"/>',
      inactive: '<svg id="inactive"/>'
    }
    const reloadedLayers = Object.fromEntries(
      Object.keys(metadata.layerFilenames).map((key) => [
        key,
        physicalFiles[key as keyof typeof physicalFiles]
      ])
    )
    expect(reloadedLayers).toEqual({ inactive: '<svg id="inactive"/>' })
    expect(auth.handleApiError).not.toHaveBeenCalled()
    expect(subject.logRefreshFailure).toHaveBeenCalledWith(
      'track SVG layer refresh was partial; published validated layers only',
      expect.any(Error)
    )
  })

  it('publishes a fresh name/config resolution under its authoritative ID key', async () => {
    const subject = bareModule()
    subject.catalog = [track(12, 'Canonical Venue', 'Grand Prix')]
    subject.catalogFresh = true
    const nameLayout = captureTrackLayout({
      trackName: 'Canonical Venue',
      trackConfigName: 'Grand Prix'
    })!
    subject.setCurrentLayout(nameLayout)
    const api = {
      listTrackAssets: vi.fn(async () => assetMap({ trackId: 12 })),
      fetchSvgLayer: vi.fn(async () => '<svg id="canonical"/>')
    }
    bindAuth(subject, api)

    await subject.refreshForCurrentTrack(false)

    expect(subject.currentLayout).toMatchObject({
      key: 'id:12',
      trackId: 12,
      trackName: 'Canonical Venue',
      trackConfigName: 'Grand Prix'
    })
    expect(subject.resolvedSvgByLayout.has(nameLayout.key)).toBe(false)
    expect(subject.resolvedSvgByLayout.get('id:12')?.activeSvg).toContain('canonical')
    expect(subject.buildDataForCurrentTrack()).toMatchObject({
      source: 'iracing-svg',
      layoutKey: 'id:12',
      trackId: 12
    })
    expect(subject.buildDataForLookup({
      trackName: 'Canonical Venue',
      trackConfigName: 'Grand Prix'
    })).toMatchObject({
      source: 'iracing-svg',
      layoutKey: 'id:12',
      trackId: 12
    })
  })

  it('does not repopulate memory when auth changes during saveAsset', async () => {
    const subject = bareModule()
    const saved = deferred<CachedAssetWithSvg>()
    subject.assetsCache.saveAsset = vi.fn(() => saved.promise)
    const api = {
      listTrackAssets: vi.fn(async () => assetMap({ trackId: 1 })),
      fetchSvgLayer: vi.fn(async () => '<svg id="old-auth"/>')
    }
    const auth = bindAuth(subject, api)
    const layout = setLayout(subject, 1, 'Shared Venue', 'Grand Prix')

    const refresh = subject.refreshForCurrentTrack(false)
    await waitForCalls(subject.assetsCache.saveAsset, 1)
    auth.transition(null)
    saved.resolve(cached(1, 'Shared Venue', 'Grand Prix', '<svg id="saved"/>'))
    await refresh

    expect(subject.resolvedSvgByLayout.has(layout.key)).toBe(false)
    expect(subject.broadcastUpdate).not.toHaveBeenCalled()
    expect(auth.handleApiError).not.toHaveBeenCalled()
  })

  it('does not repopulate memory or broadcast when disposed during saveAsset', async () => {
    const subject = bareModule()
    const saved = deferred<CachedAssetWithSvg>()
    subject.assetsCache.saveAsset = vi.fn(() => saved.promise)
    const api = {
      listTrackAssets: vi.fn(async () => assetMap({ trackId: 1 })),
      fetchSvgLayer: vi.fn(async () => '<svg id="disposing"/>')
    }
    bindAuth(subject, api)
    setLayout(subject, 1, 'Shared Venue', 'Grand Prix')

    const refresh = subject.refreshForCurrentTrack(false)
    await waitForCalls(subject.assetsCache.saveAsset, 1)
    let disposeFinished = false
    const disposing = subject.dispose().then(() => {
      disposeFinished = true
    })
    await Promise.resolve()
    expect(disposeFinished).toBe(false)

    saved.resolve(cached(1, 'Shared Venue', 'Grand Prix', '<svg id="saved"/>'))
    await Promise.all([refresh, disposing])

    expect(subject.resolvedSvgByLayout.size).toBe(0)
    expect(subject.broadcastUpdate).not.toHaveBeenCalled()
  })

  it('keeps a fresh in-memory catalog when a forced network refresh fails', async () => {
    const subject = bareModule()
    const memory = [track(40, 'Fresh Memory')]
    const staleDisk = [track(39, 'Stale Disk')]
    subject.catalog = memory
    subject.catalogFresh = true
    const memoryToken = subject.catalogToken
    subject.assetsCache.loadCatalog = vi.fn(async () => ({ tracks: staleDisk, cachedAt: 1 }))
    const failure = deferred<ReturnType<typeof track>[]>()
    const api = { listTracks: vi.fn(() => failure.promise) }
    const auth = bindAuth(subject, api)

    const refresh = subject.refreshCatalogOnly(true)
    await waitForCalls(api.listTracks, 1)
    failure.reject(new Error('network unavailable'))
    await refresh

    expect(subject.assetsCache.loadCatalog).not.toHaveBeenCalled()
    expect(subject.catalog).toBe(memory)
    expect(subject.catalogFresh).toBe(true)
    expect(subject.catalogToken).toBe(memoryToken)
    expect(subject.learner.setCatalog).not.toHaveBeenCalled()
    expect(auth.handleApiError).toHaveBeenCalledTimes(1)
  })

  it('keeps fresh catalog state when saveCatalog fails without changing auth', async () => {
    const subject = bareModule()
    const rows = [track(50, 'Disk Full Catalog')]
    const api = { listTracks: vi.fn(async () => rows) }
    const auth = bindAuth(subject, api)
    subject.assetsCache.saveCatalog = vi.fn(async () => {
      throw new Error('ENOSPC')
    })

    await subject.refreshCatalogOnly(true)

    expect(subject.catalog).toEqual(rows)
    expect(subject.catalogFresh).toBe(true)
    expect(subject.learner.setCatalog).toHaveBeenCalledTimes(1)
    expect(auth.handleApiError).not.toHaveBeenCalled()
    expect(subject.logRefreshFailure).toHaveBeenCalledWith(
      'catalog cache save failed',
      expect.any(Error)
    )
  })

  it('keeps a usable in-memory SVG when saveAsset fails without changing auth', async () => {
    const subject = bareModule()
    const layout = setLayout(subject, 1, 'Shared Venue', 'Grand Prix')
    const api = {
      listTrackAssets: vi.fn(async () => assetMap({ trackId: 1 })),
      fetchSvgLayer: vi.fn(async () => '<svg id="memory-only"/>')
    }
    const auth = bindAuth(subject, api)
    subject.assetsCache.saveAsset = vi.fn(async () => {
      throw new Error('EACCES')
    })

    await subject.refreshForCurrentTrack(false)

    expect(subject.resolvedSvgByLayout.get(layout.key)?.activeSvg).toContain('memory-only')
    expect(subject.broadcastUpdate).toHaveBeenCalledTimes(1)
    expect(auth.handleApiError).not.toHaveBeenCalled()
    expect(subject.logRefreshFailure).toHaveBeenCalledWith(
      'track asset cache save failed',
      expect.any(Error)
    )
  })

  it('fails closed when a fresh catalog makes a stale name-key SVG ambiguous', async () => {
    const subject = bareModule()
    const layout = captureTrackLayout({ trackName: 'Legacy Venue' })!
    subject.catalog = [track(10, 'Legacy Venue')]
    subject.catalogFresh = false
    const staleToken = subject.catalogToken
    subject.resolvedSvgByLayout.set(
      layout.key,
      boundCached(layout, 10, '<svg id="legacy"/>', staleToken)
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
      fetchSvgLayer: vi.fn()
    }
    bindAuth(subject, api)
    const refresh = subject.refreshForCurrentTrack(true)
    await waitForCalls(listTracks, 1)
    freshCatalog.resolve([
      track(10, 'Legacy Venue', 'Grand Prix'),
      track(11, 'Legacy Venue', 'Club')
    ])
    await refresh

    expect(subject.catalogFresh).toBe(true)
    expect(subject.catalogToken).not.toBe(staleToken)
    expect(subject.resolvedSvgByLayout.has(layout.key)).toBe(false)
    expect(subject.buildDataForLookup('Legacy Venue').source).toBe('none')
  })

  it('does not serve a name-key SVG when a fresh catalog changes its TrackID', async () => {
    const subject = bareModule()
    const layout = captureTrackLayout({ trackName: 'Renumbered Venue' })!
    subject.catalog = [track(20, 'Renumbered Venue')]
    subject.catalogFresh = false
    subject.resolvedSvgByLayout.set(
      layout.key,
      boundCached(layout, 20, '<svg id="old-id"/>', subject.catalogToken)
    )
    subject.setCurrentLayout(layout)

    const freshCatalog = deferred<ReturnType<typeof track>[]>()
    const listTracks = vi.fn(() => freshCatalog.promise)
    const listTrackAssets = vi.fn(async () => new Map())
    const api = {
      listTracks,
      listTrackAssets,
      fetchSvgLayer: vi.fn()
    }
    bindAuth(subject, api)
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

  it('keeps an authoritative ID-key SVG valid across catalog publications', async () => {
    const subject = bareModule()
    const layout = captureTrackLayout({ trackId: 30, trackName: 'Authoritative Venue' })!
    subject.catalog = [track(30, 'Authoritative Venue')]
    subject.resolvedSvgByLayout.set(
      layout.key,
      boundCached(layout, 30, '<svg id="authoritative"/>', subject.catalogToken)
    )
    const freshCatalog = deferred<ReturnType<typeof track>[]>()
    const listTracks = vi.fn(() => freshCatalog.promise)
    bindAuth(subject, { listTracks })

    const oldCatalogToken = subject.catalogToken
    const refresh = subject.refreshCatalogOnly(true)
    await waitForCalls(listTracks, 1)
    freshCatalog.resolve([
      track(31, 'Other Venue', 'Grand Prix'),
      track(32, 'Other Venue', 'Club')
    ])
    await refresh

    expect(subject.catalogToken).not.toBe(oldCatalogToken)
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

  it('unsubscribes and blocks deferred publication after dispose', async () => {
    const subject = bareModule()
    const assets = deferred<Map<number, any>>()
    const api = {
      listTrackAssets: vi.fn(() => assets.promise),
      fetchSvgLayer: vi.fn(async () => '<svg id="late"/>')
    }
    bindAuth(subject, api)
    setLayout(subject, 1, 'Shared Venue', 'Grand Prix')
    const authUnsubscribe = vi.fn()
    const telemetryOn = vi.fn()
    const telemetryOff = vi.fn()
    subject.ctx = {
      telemetryHub: {
        on: telemetryOn,
        off: telemetryOff
      }
    }
    subject.authUnsubscribe = authUnsubscribe
    subject.subscribeTelemetry()
    const telemetryListener = telemetryOn.mock.calls[0][1]

    const refresh = subject.refreshForCurrentTrack(false)
    await waitForCalls(api.listTrackAssets, 1)
    await subject.dispose()
    assets.resolve(assetMap({ trackId: 1 }))
    await refresh
    await subject.dispose()

    expect(authUnsubscribe).toHaveBeenCalledTimes(1)
    expect(telemetryOn).toHaveBeenCalledWith('snapshot', telemetryListener)
    expect(telemetryOff).toHaveBeenCalledWith('snapshot', telemetryListener)
    expect(subject.assetsCache.saveAsset).not.toHaveBeenCalled()
    expect(subject.resolvedSvgByLayout.size).toBe(0)
    expect(subject.broadcastUpdate).not.toHaveBeenCalled()
  })
})
