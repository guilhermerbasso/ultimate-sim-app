import { describe, expect, it, vi } from 'vitest'
import type { CachedAsset, CachedAssetWithSvg } from './store'
import { TrackMapModule } from './index'
import { captureTrackLayout, findCatalogLayout } from './types'
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
async function waitForCalls(spy: ReturnType<typeof vi.fn>, count: number): Promise<void> {
  for (let i = 0; i < 20 && spy.mock.calls.length < count; i += 1) await Promise.resolve()
  expect(spy).toHaveBeenCalledTimes(count)
}
function cached(trackId: number, trackName: string, configName: string, svg: string): CachedAssetWithSvg {
  return {
    trackId, trackName, configName, baseUrl: `https://maps/${trackId}/`,
    layerFilenames: { active: 'active.svg' },
    cachedAt: 1, layers: { active: svg }, activeSvg: svg
  }
}
function bareModule(): any {
  return Object.assign(Object.create(TrackMapModule.prototype), {
    catalog: [
      { track_id: 1, track_name: 'Shared Venue', config_name: 'Grand Prix' },
      { track_id: 2, track_name: 'Shared Venue', config_name: 'Club' }
    ],
    currentLayoutRevision: 0, resolutionAttempted: new Set(), resolvedSvgByLayout: new Map(),
    resolveInflight: new Map(), authStatus: 'ready',
    learner: {
      get: vi.fn(() => null), has: vi.fn(() => false),
      getRecordingSnapshot: vi.fn(() => ({ active: false })),
      setCatalog: vi.fn(async () => undefined)
    },
    broadcastUpdate: vi.fn()
  })
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
      trackName: 'Okayama International Circuit', trackConfigName: 'Short Course'
    })!, okayama)?.trackId).toBe(11)
    expect(findCatalogLayout(captureTrackLayout({
      trackName: 'Okayama International Circuit'
    })!, okayama)).toBeNull()
    expect(findCatalogLayout(captureTrackLayout({ trackId: 11, trackName: 'Wrong display' })!, okayama)?.trackId).toBe(11)
  })

  it('discards stale parallel resolver A before file/cache/broadcast after switching to B', async () => {
    const subject = bareModule()
    const aAssets = deferred<Map<number, any>>()
    const bAssets = deferred<Map<number, any>>()
    const listTrackAssets = vi.fn()
      .mockImplementationOnce(() => aAssets.promise)
      .mockImplementationOnce(() => bAssets.promise)
    const api = { listTrackAssets, fetchSvgLayer: vi.fn(async (_base: string, file: string) =>
      `<svg id="${file}"/>`), lastAuthAt: vi.fn(() => 123) }
    const saveAsset = vi.fn(async (asset: CachedAsset, content: { active?: string }) => ({
      ...asset,
      layers: { active: content.active },
      activeSvg: content.active
    }))
    subject.auth = { getApi: () => api, handleApiError: vi.fn() }
    subject.assetsCache = { loadAsset: vi.fn(async () => null), saveAsset }
    const layoutA = captureTrackLayout({ trackId: 1, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' })!
    const layoutB = captureTrackLayout({ trackId: 2, trackName: 'Shared Venue', trackConfigName: 'Club' })!
    subject.setCurrentLayout(layoutA)
    const resolvingA = subject.refreshForCurrentTrack(false)
    await waitForCalls(listTrackAssets, 1)
    subject.setCurrentLayout(layoutB)
    const resolvingB = subject.refreshForCurrentTrack(false)
    await waitForCalls(listTrackAssets, 2)
    const assets = new Map([
      [1, { track_id: 1, track_map: 'https://maps/1/', track_map_layers: { active: 'a.svg' } }],
      [2, { track_id: 2, track_map: 'https://maps/2/', track_map_layers: { active: 'b.svg' } }]
    ])
    bAssets.resolve(assets)
    await resolvingB
    aAssets.resolve(assets)
    await resolvingA
    expect(saveAsset.mock.calls.map(([asset]) => asset.trackId)).toEqual([2])
    expect(subject.resolvedSvgByLayout.has(layoutA.key)).toBe(false)
    expect(subject.resolvedSvgByLayout.get(layoutB.key)?.trackId).toBe(2)
    expect(subject.broadcastUpdate).toHaveBeenCalledTimes(1)
    subject.resolvedSvgByLayout.set('id:1', cached(1, 'Shared Venue', 'Grand Prix', '<svg id="gp"/>'))
    const gp = subject.buildDataForLookup({ trackId: 1, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' })
    const club = subject.buildDataForLookup({ trackId: 2, trackName: 'Shared Venue', trackConfigName: 'Club' })
    const ambiguous = subject.buildDataForLookup('Shared Venue')
    expect(gp).toMatchObject({ source: 'iracing-svg', layoutKey: 'id:1', trackId: 1, trackConfigName: 'Grand Prix' })
    expect(club).toMatchObject({ source: 'iracing-svg', layoutKey: 'id:2', trackId: 2, trackConfigName: 'Club' })
    expect(ambiguous.source).toBe('none')
  })
})
