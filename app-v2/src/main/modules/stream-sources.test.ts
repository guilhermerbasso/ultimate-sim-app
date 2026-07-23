import { describe, expect, it, vi } from 'vitest'
import type { DashboardSummary } from '../../shared/dashboards'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../../shared/settings'
import type { ButtonBoxSummary } from '../../shared/touch-panel'
import { StreamSourceService } from './stream-sources'

const dashboards: DashboardSummary[] = [
  {
    id: 'dash-race',
    name: 'Race dashboard',
    width: 1024,
    height: 600,
    elementCount: 4,
    hasPreview: false,
    hidden: false,
    builtIn: false
  },
  {
    id: 'dash-hidden',
    name: 'Hidden dashboard',
    width: 800,
    height: 480,
    elementCount: 2,
    hasPreview: false,
    hidden: true,
    builtIn: false
  },
  {
    id: 'dash-built-in',
    name: 'Bundled dashboard',
    width: 800,
    height: 480,
    elementCount: 2,
    hasPreview: false,
    hidden: false,
    builtIn: true
  }
]

const touchPanels: ButtonBoxSummary[] = [
  {
    id: 'touch-pit',
    name: 'Pit controls',
    columns: 3,
    rows: 2,
    buttonCount: 6,
    hidden: false
  }
]

function settingsWithProfile(
  kind: 'dashboard' | 'touch',
  sourceId: string,
  label = sourceId
): AppSettings {
  return {
    ...structuredClone(DEFAULT_APP_SETTINGS),
    streamTargets: {
      schemaVersion: 1,
      selectedProfileId: `profile-${sourceId}`,
      profiles: [{
        id: `profile-${sourceId}`,
        kind,
        sourceId,
        label
      }]
    }
  }
}

function harness(initial = structuredClone(DEFAULT_APP_SETTINGS)): {
  service: StreamSourceService
  getSettings(): AppSettings
  setDashboards(next: DashboardSummary[]): void
  setRuntime(running: boolean, kind?: 'dashboard' | 'touch', id?: string): void
  stop: ReturnType<typeof vi.fn>
  broadcasts: Array<{ channel: string; payload: unknown }>
  announcements: AppSettings[]
  writeOrder: string[]
} {
  let settings = structuredClone(initial)
  let currentDashboards = structuredClone(dashboards)
  let runtime: {
    running: boolean
    layoutKind: 'dashboard' | 'touch'
    layoutId: string
  } = {
    running: false,
    layoutKind: 'dashboard',
    layoutId: 'dash-race'
  }
  const broadcasts: Array<{ channel: string; payload: unknown }> = []
  const announcements: AppSettings[] = []
  const writeOrder: string[] = []
  const stop = vi.fn(async () => {
    writeOrder.push('stop')
    runtime = { ...runtime, running: false }
    return runtime
  })
  let profileSequence = 0
  const service = new StreamSourceService({
    settingsStore: {
      getSettings: () => structuredClone(settings),
      setSettings: (patch) => {
        writeOrder.push('save')
        settings = {
          ...settings,
          ...structuredClone(patch),
          streamTargets: patch.streamTargets
            ? structuredClone(patch.streamTargets)
            : structuredClone(settings.streamTargets)
        }
        return structuredClone(settings)
      }
    },
    listDashboards: async () => structuredClone(currentDashboards),
    listTouchPanels: async () => structuredClone(touchPanels),
    runtime: {
      status: async () => ({ ...runtime }),
      stop
    },
    broadcast: (channel, payload) => broadcasts.push({ channel, payload: structuredClone(payload) }),
    announceSettings: (next) => announcements.push(structuredClone(next)),
    createProfileId: () => `generated-profile-${++profileSequence}`
  })
  return {
    service,
    getSettings: () => structuredClone(settings),
    setDashboards: (next) => { currentDashboards = structuredClone(next) },
    setRuntime: (running, kind = 'dashboard', id = 'dash-race') => {
      runtime = { running, layoutKind: kind, layoutId: id }
    },
    stop,
    broadcasts,
    announcements,
    writeOrder
  }
}

describe('StreamSourceService', () => {
  it('adds an eligible registry source as a persisted default target profile', async () => {
    const state = harness()

    const catalog = await state.service.add({ kind: 'dashboard', id: 'dash-race' })

    expect(state.getSettings().streamTargets).toEqual({
      schemaVersion: 1,
      selectedProfileId: 'generated-profile-1',
      profiles: [{
        id: 'generated-profile-1',
        kind: 'dashboard',
        sourceId: 'dash-race',
        label: 'Race dashboard'
      }]
    })
    expect(catalog).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'dash-race', added: true, eligible: true })
    ]))
    expect(state.announcements).toHaveLength(1)
    expect(state.broadcasts.at(-1)?.channel).toBe('streaming:sources:updated')
  })

  it.each([
    ['hidden dashboard', { kind: 'dashboard' as const, id: 'dash-hidden' }, 'hidden'],
    ['built-in dashboard', { kind: 'dashboard' as const, id: 'dash-built-in' }, 'built-in'],
    ['missing touch panel', { kind: 'touch' as const, id: 'touch-missing' }, 'not found']
  ])('rejects an ineligible %s after re-reading the registries', async (_case, ref, message) => {
    const state = harness()

    await expect(state.service.add(ref)).rejects.toThrow(message)
    expect(state.getSettings().streamTargets.profiles).toEqual([])
  })

  it('removes a stale missing reference without deleting any source registry entry', async () => {
    const state = harness(settingsWithProfile('touch', 'touch-missing', 'Old pit panel'))

    const catalog = await state.service.remove({ kind: 'touch', id: 'touch-missing' })

    expect(state.getSettings().streamTargets.profiles).toEqual([])
    expect(catalog.some((source) => source.id === 'touch-missing')).toBe(false)
    expect(touchPanels).toHaveLength(1)
  })

  it('removes a legacy ineligible ID that can no longer be added or started', async () => {
    const state = harness(settingsWithProfile('dashboard', 'legacy/dashboard..v1', 'Legacy source'))

    const before = await state.service.list()
    expect(before.find((source) => source.id === 'legacy/dashboard..v1')).toEqual(
      expect.objectContaining({ added: true, eligible: false, reason: 'invalid-id' })
    )

    await state.service.remove({ kind: 'dashboard', id: 'legacy/dashboard..v1' })
    expect(state.getSettings().streamTargets.profiles).toEqual([])
  })

  it('stops and invalidates the active stream before persisting source removal', async () => {
    const state = harness(settingsWithProfile('dashboard', 'dash-race', 'Race feed'))
    state.setRuntime(true, 'dashboard', 'dash-race')

    const catalog = await state.service.remove({ kind: 'dashboard', id: 'dash-race' })

    expect(state.stop).toHaveBeenCalledTimes(1)
    expect(state.writeOrder).toEqual(['stop', 'save'])
    expect(state.getSettings().streamTargets.profiles).toEqual([])
    expect(catalog.find((source) => source.id === 'dash-race')).toEqual(
      expect.objectContaining({ added: false, active: false })
    )
  })

  it('serializes concurrent source additions without losing either update', async () => {
    const state = harness()

    await Promise.all([
      state.service.add({ kind: 'dashboard', id: 'dash-race' }),
      state.service.add({ kind: 'touch', id: 'touch-pit' })
    ])

    expect(state.getSettings().streamTargets.profiles.map((profile) => ({
      kind: profile.kind,
      sourceId: profile.sourceId
    }))).toEqual([
      { kind: 'dashboard', sourceId: 'dash-race' },
      { kind: 'touch', sourceId: 'touch-pit' }
    ])
  })

  it('rejects generic settings updates that bypass dedicated source membership mutations', async () => {
    const state = harness()
    const tampered = settingsWithProfile('dashboard', 'dash-built-in', 'Injected built-in')

    await expect(state.service.updateSettings({ streamTargets: tampered.streamTargets }))
      .rejects.toThrow('Manage streaming sources')
    expect(state.getSettings().streamTargets.profiles).toEqual([])
  })

  it('does not let a stale profile edit re-add a source after explicit removal', async () => {
    const original = settingsWithProfile('dashboard', 'dash-race', 'Race feed')
    const state = harness(original)
    await state.service.remove({ kind: 'dashboard', id: 'dash-race' })

    await expect(state.service.updateSettings({
      streamTargets: {
        ...original.streamTargets,
        profiles: original.streamTargets.profiles.map((profile) => ({
          ...profile,
          label: 'Stale rename'
        }))
      }
    })).rejects.toThrow('Manage streaming sources')
    expect(state.getSettings().streamTargets.profiles).toEqual([])
  })

  it('does not let a stale profile edit drop a concurrently added source', async () => {
    const state = harness()
    const staleEmpty = structuredClone(state.getSettings().streamTargets)
    await state.service.add({ kind: 'touch', id: 'touch-pit' })

    await expect(state.service.updateSettings({ streamTargets: staleEmpty }))
      .rejects.toThrow('Manage streaming sources')
    expect(state.getSettings().streamTargets.profiles).toEqual([
      expect.objectContaining({ kind: 'touch', sourceId: 'touch-pit' })
    ])
  })

  it('revokes an active stream when its underlying source becomes hidden', async () => {
    const state = harness(settingsWithProfile('dashboard', 'dash-race', 'Race feed'))
    state.setRuntime(true, 'dashboard', 'dash-race')
    state.setDashboards(dashboards.map((dashboard) =>
      dashboard.id === 'dash-race' ? { ...dashboard, hidden: true } : dashboard
    ))

    const catalog = await state.service.refreshAfterRegistryChange()

    expect(state.stop).toHaveBeenCalledTimes(1)
    expect(catalog.find((source) => source.id === 'dash-race')).toEqual(
      expect.objectContaining({ added: true, active: false, eligible: false, reason: 'hidden' })
    )
    expect(state.broadcasts.at(-1)?.channel).toBe('streaming:sources:updated')
  })
})
