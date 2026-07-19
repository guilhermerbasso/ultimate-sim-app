import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createStreamPresentationProfile,
  type StreamPresentationTargetDescriptor
} from '../../shared/stream-presentation'
import { StreamPresentationProfileStore } from './presentation-profile-store'

const roots: string[] = []

function testPath(): string {
  const root = mkdtempSync(join(process.cwd(), 'stream-presentation-store-test-'))
  roots.push(root)
  return join(root, 'profiles.json')
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true })
})

const target: StreamPresentationTargetDescriptor = {
  kind: 'touch',
  id: 'pit',
  name: 'Pit controls',
  revision: 'touch:1:3x2:6',
  itemCount: 6,
  hidden: false
}

describe('StreamPresentationProfileStore', () => {
  it('persists profiles across restart without embedding or rewriting source layouts', async () => {
    const path = testPath()
    const profile = createStreamPresentationProfile(target, {
      id: 'stream-profile-pit',
      now: 100
    })
    profile.settings.safeArea.top = 24

    const firstStore = new StreamPresentationProfileStore(path, { now: () => 200 })
    const saved = await firstStore.save(profile, null)
    const reloaded = await new StreamPresentationProfileStore(path).load()
    const disk = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>

    expect(saved.revision).toBe(1)
    expect(reloaded).toEqual([saved])
    expect(reloaded[0].target).toEqual({ kind: 'touch', id: 'pit', revision: target.revision })
    expect(JSON.stringify(disk)).not.toContain('"buttons"')
    expect(JSON.stringify(disk)).not.toContain('"elements"')
  })

  it('uses compare-and-swap revisions to reject concurrent stale saves', async () => {
    const path = testPath()
    const store = new StreamPresentationProfileStore(path, { now: () => 200 })
    const profile = createStreamPresentationProfile(target, {
      id: 'stream-profile-pit',
      now: 100
    })
    const saved = await store.save(profile, null)
    const firstEdit = { ...saved, name: 'First edit' }
    const staleEdit = { ...saved, name: 'Stale edit' }

    const updated = await store.save(firstEdit, saved.revision)

    await expect(store.save(staleEdit, saved.revision)).rejects.toThrow('STREAM_PRESENTATION_CONFLICT')
    expect(store.get(saved.id)?.name).toBe('First edit')
    expect(updated.revision).toBe(2)
  })
})
