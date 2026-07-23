import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createStreamPresentationProfile } from '../../shared/stream-presentation'
import type { StreamSourceDescriptor } from '../../shared/stream-sources'

const sourceState = vi.hoisted(() => ({
  descriptors: [] as StreamSourceDescriptor[]
}))

vi.mock('./stream-sources', () => ({
  listStreamSourceDescriptorsCurrent: async () => structuredClone(sourceState.descriptors)
}))

vi.mock('./dashboards', () => ({
  getDashboardManager: () => ({
    list: () => [
      {
        id: 'dash-user',
        name: 'User dashboard',
        width: 1024,
        height: 600,
        elementCount: 4,
        hasPreview: false,
        hidden: false,
        builtIn: false,
        updatedAt: 10
      },
      {
        id: 'dash-hidden',
        name: 'Hidden dashboard',
        width: 800,
        height: 480,
        elementCount: 2,
        hasPreview: false,
        hidden: true,
        builtIn: false,
        updatedAt: 11
      },
      {
        id: 'dash-built-in',
        name: 'Bundled dashboard',
        width: 800,
        height: 480,
        elementCount: 2,
        hasPreview: false,
        hidden: false,
        builtIn: true,
        updatedAt: 12
      }
    ]
  })
}))

vi.mock('../touchpanel/manager', () => ({
  getTouchPanelManager: () => ({
    list: () => [
      {
        id: 'touch-user',
        name: 'User touch panel',
        columns: 3,
        rows: 2,
        buttonCount: 6,
        hidden: false,
        updatedAt: 20
      },
      {
        id: 'touch-hidden',
        name: 'Hidden touch panel',
        columns: 2,
        rows: 2,
        buttonCount: 4,
        hidden: true,
        updatedAt: 21
      }
    ]
  })
}))

import {
  findStreamPresentationTarget,
  listStreamPresentationTargets,
  resolveStreamPresentationProfileItem
} from './stream-presentation'

function descriptor(
  kind: 'dashboard' | 'touch',
  id: string,
  eligible: boolean,
  added: boolean,
  reason: StreamSourceDescriptor['reason'] = null
): StreamSourceDescriptor {
  return {
    kind,
    id,
    label: id,
    eligible,
    reason,
    added,
    active: false
  }
}

describe('stream presentation target catalog', () => {
  beforeEach(() => {
    sourceState.descriptors = [
      descriptor('dashboard', 'dash-user', true, true),
      descriptor('dashboard', 'dash-hidden', false, true, 'hidden'),
      descriptor('dashboard', 'dash-built-in', false, false, 'built-in'),
      descriptor('touch', 'touch-user', true, true),
      descriptor('touch', 'touch-hidden', false, true, 'hidden')
    ]
  })

  it('offers only added, eligible sources shared with Streaming management', async () => {
    const targets = await listStreamPresentationTargets()

    expect(targets.map(({ kind, id }) => ({ kind, id }))).toEqual([
      { kind: 'dashboard', id: 'dash-user' },
      { kind: 'touch', id: 'touch-user' }
    ])
    await expect(findStreamPresentationTarget({ kind: 'dashboard', id: 'dash-hidden' }))
      .resolves.toBeNull()
  })

  it('marks a saved mobile profile missing after its source leaves the allowlist', async () => {
    const target = (await listStreamPresentationTargets())[0]
    const profile = createStreamPresentationProfile(target, {
      id: 'profile-user',
      now: 100
    })
    sourceState.descriptors = [descriptor('dashboard', 'dash-user', true, false)]

    await expect(resolveStreamPresentationProfileItem(profile)).resolves.toEqual(
      expect.objectContaining({ target: null, targetState: 'missing' })
    )
  })
})
