import { describe, expect, it } from 'vitest'
import type { DashboardSummary } from './dashboards'
import type { ButtonBoxSummary } from './touch-panel'
import {
  addStreamTargetProfile,
  clearMissingStreamTargetProfiles,
  deleteStreamTargetProfile,
  emptyStreamTargetSettings,
  listUserAddedStreamTargetSources,
  migrateStreamTargetSettings,
  moveStreamTargetProfile,
  renameStreamTargetProfile,
  resolveStreamTargetProfiles,
  streamTargetSourceKey,
  selectStreamTargetProfile
} from './stream-targets'

function dashboard(id: string, name: string, hidden = false, builtIn = false): DashboardSummary {
  return {
    id,
    name,
    width: 1024,
    height: 600,
    elementCount: 1,
    hasPreview: false,
    hidden,
    builtIn
  }
}

function touchPanel(id: string, name: string, hidden = false): ButtonBoxSummary {
  return {
    id,
    name,
    columns: 3,
    rows: 2,
    buttonCount: 6,
    hidden
  }
}

describe('stream target source filtering', () => {
  it('offers only visible dashboards and touch panels saved in the user registries', () => {
    const dashboards = Object.freeze([
      Object.freeze(dashboard('dash-user', 'Race dash')),
      Object.freeze(dashboard('dash-hidden-user', 'Hidden user dash', true)),
      Object.freeze(dashboard('dash-hidden-builtin', 'Bundled hidden dash', true, true)),
      Object.freeze(dashboard('dash-builtin', 'Bundled dash', false, true))
    ])
    const touchPanels = Object.freeze([
      Object.freeze(touchPanel('touch-user', 'Pit controls')),
      Object.freeze(touchPanel('touch-hidden', 'Hidden touch preset', true))
    ])
    const originalDashboards = structuredClone(dashboards)
    const originalTouchPanels = structuredClone(touchPanels)

    expect(listUserAddedStreamTargetSources(dashboards, touchPanels)).toEqual([
      { kind: 'dashboard', id: 'dash-user', label: 'Race dash' },
      { kind: 'touch', id: 'touch-user', label: 'Pit controls' }
    ])
    expect(dashboards).toEqual(originalDashboards)
    expect(touchPanels).toEqual(originalTouchPanels)
  })
})

describe('stream target profile migration', () => {
  it('migrates the existing selected target into a stable selected profile', () => {
    const sources = [{ kind: 'dashboard' as const, id: 'dash-user', label: 'Race dash' }]
    const migrated = migrateStreamTargetSettings(
      { selectedTarget: 'dashboard:dash-user' },
      sources,
      null,
      () => 'profile-stable'
    )

    expect(migrated).toEqual({
      schemaVersion: 1,
      profiles: [{
        id: 'profile-stable',
        kind: 'dashboard',
        sourceId: 'dash-user',
        label: 'Race dash'
      }],
      selectedProfileId: 'profile-stable'
    })
  })

  it('does not migrate a hidden or deleted legacy target', () => {
    expect(migrateStreamTargetSettings(
      { selectedTarget: 'dashboard:missing' },
      [],
      null,
      () => 'unused'
    )).toEqual(emptyStreamTargetSettings())
  })
})

describe('stream target profile editing', () => {
  it('preserves profile identity across rename and reorder', () => {
    let settings = addStreamTargetProfile(
      emptyStreamTargetSettings(),
      { kind: 'dashboard', id: 'dash-user', label: 'Race dash' },
      'OBS',
      () => 'profile-dashboard'
    )
    settings = addStreamTargetProfile(
      settings,
      { kind: 'touch', id: 'touch-user', label: 'Pit controls' },
      'Tablet',
      () => 'profile-touch'
    )
    settings = renameStreamTargetProfile(settings, 'profile-dashboard', 'Broadcast')
    settings = moveStreamTargetProfile(settings, 'profile-dashboard', 1)
    settings = selectStreamTargetProfile(settings, 'profile-dashboard')

    expect(settings.profiles.map((profile) => [profile.id, profile.label])).toEqual([
      ['profile-touch', 'Tablet'],
      ['profile-dashboard', 'Broadcast']
    ])
    expect(settings.selectedProfileId).toBe('profile-dashboard')
  })

  it('keeps deleted sources as explicit missing profiles until the user clears them', () => {
    const settings = addStreamTargetProfile(
      emptyStreamTargetSettings(),
      { kind: 'dashboard', id: 'dash-user', label: 'Race dash' },
      'OBS',
      () => 'profile-dashboard'
    )

    expect(resolveStreamTargetProfiles(settings, [])[0]).toMatchObject({
      id: 'profile-dashboard',
      sourceId: 'dash-user',
      missing: true,
      source: null
    })
    expect(clearMissingStreamTargetProfiles(settings, [])).toEqual(emptyStreamTargetSettings())
  })

  it('selects the nearest remaining profile when deleting the selected profile', () => {
    let settings = addStreamTargetProfile(
      emptyStreamTargetSettings(),
      { kind: 'dashboard', id: 'one', label: 'One' },
      undefined,
      () => 'profile-one'
    )
    settings = addStreamTargetProfile(
      settings,
      { kind: 'dashboard', id: 'two', label: 'Two' },
      undefined,
      () => 'profile-two'
    )

    expect(deleteStreamTargetProfile(settings, 'profile-two').selectedProfileId).toBe('profile-one')
  })
})

describe('stream target source identity', () => {
  it('keeps dashboard and touch sources distinct when their textual IDs collide', () => {
    expect(listUserAddedStreamTargetSources(
      [dashboard('shared-source', 'Race dash')],
      [touchPanel('shared-source', 'Pit controls')]
    )).toEqual([
      { kind: 'dashboard', id: 'shared-source', label: 'Race dash' },
      { kind: 'touch', id: 'shared-source', label: 'Pit controls' }
    ])
  })

  it.each([
    [
      'blank dashboard ID',
      [dashboard('   ', 'Invalid dashboard'), dashboard('dash-valid', 'Valid dashboard')],
      [],
      [{ kind: 'dashboard', id: 'dash-valid', label: 'Valid dashboard' }]
    ],
    [
      'control-character touch ID',
      [],
      [touchPanel('touch-\u0000invalid', 'Invalid panel'), touchPanel('touch-valid', 'Valid panel')],
      [{ kind: 'touch', id: 'touch-valid', label: 'Valid panel' }]
    ]
  ] as const)(
    'omits an entry with a %s while keeping its valid sibling',
    (_case, dashboards, touchPanels, expected) => {
      expect(listUserAddedStreamTargetSources(dashboards, touchPanels)).toEqual(expected)
    }
  )

  it('includes the source kind in keys for same-ID dashboard and touch sources', () => {
    const dashboardKey = streamTargetSourceKey({ kind: 'dashboard', id: 'shared-source' })
    const touchKey = streamTargetSourceKey({ kind: 'touch', id: 'shared-source' })

    expect(dashboardKey).toBe('dashboard:shared-source')
    expect(touchKey).toBe('touch:shared-source')
    expect(dashboardKey).not.toBe(touchKey)
  })
})
