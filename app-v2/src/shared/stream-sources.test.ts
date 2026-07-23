import { describe, expect, it } from 'vitest'
import type { DashboardSummary } from './dashboards'
import type { ButtonBoxSummary } from './touch-panel'
import { emptyStreamTargetSettings, type StreamTargetSettings } from './stream-targets'
import {
  buildStreamSourceDescriptors,
  parseStreamSourceMutationRequest,
  parseStreamSourceRemovalRequest,
  streamSourceRefsFromSettings
} from './stream-sources'

function settingsWithSources(): StreamTargetSettings {
  return {
    schemaVersion: 1,
    selectedProfileId: 'profile-race',
    profiles: [
      {
        id: 'profile-race',
        kind: 'dashboard',
        sourceId: 'dash-race',
        label: 'Race feed'
      },
      {
        id: 'profile-missing',
        kind: 'touch',
        sourceId: 'touch-missing',
        label: 'Missing pit controls'
      },
      {
        id: 'profile-race-alt',
        kind: 'dashboard',
        sourceId: 'dash-race',
        label: 'Race feed alternate'
      }
    ]
  }
}

const dashboards: DashboardSummary[] = [
  {
    id: 'dash-race',
    name: 'Race dashboard',
    width: 1024,
    height: 600,
    elementCount: 12,
    hasPreview: false,
    hidden: false,
    builtIn: false
  },
  {
    id: 'dash-hidden',
    name: 'Hidden dashboard',
    width: 800,
    height: 480,
    elementCount: 5,
    hasPreview: false,
    hidden: true,
    builtIn: false
  },
  {
    id: 'dash-built-in',
    name: 'Bundled dashboard',
    width: 800,
    height: 480,
    elementCount: 5,
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
  },
  {
    id: 'touch-hidden',
    name: 'Hidden controls',
    columns: 2,
    rows: 2,
    buttonCount: 4,
    hidden: true
  }
]

describe('stream source descriptors', () => {
  it('lists eligible registries and persisted missing refs without exposing unrelated ineligible entries', () => {
    const descriptors = buildStreamSourceDescriptors(
      dashboards,
      touchPanels,
      settingsWithSources(),
      { running: true, layoutKind: 'dashboard', layoutId: 'dash-race' }
    )

    expect(descriptors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'dashboard',
        id: 'dash-race',
        label: 'Race dashboard',
        eligible: true,
        reason: null,
        added: true,
        active: true
      }),
      expect.objectContaining({
        kind: 'touch',
        id: 'touch-missing',
        label: 'Missing pit controls',
        eligible: false,
        reason: 'missing',
        added: true
      }),
      expect.objectContaining({
        id: 'touch-pit',
        eligible: true,
        reason: null,
        added: false
      })
    ]))
    expect(descriptors.some((source) => source.id === 'dash-hidden')).toBe(false)
    expect(descriptors.some((source) => source.id === 'dash-built-in')).toBe(false)
    expect(descriptors.some((source) => source.id === 'touch-hidden')).toBe(false)
  })

  it('keeps hidden and built-in states visible when repairing an existing persisted reference', () => {
    const settings: StreamTargetSettings = {
      schemaVersion: 1,
      selectedProfileId: 'profile-hidden',
      profiles: [
        {
          id: 'profile-hidden',
          kind: 'dashboard',
          sourceId: 'dash-hidden',
          label: 'Hidden dashboard'
        },
        {
          id: 'profile-built-in',
          kind: 'dashboard',
          sourceId: 'dash-built-in',
          label: 'Bundled dashboard'
        }
      ]
    }

    expect(buildStreamSourceDescriptors(dashboards, touchPanels, settings)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'dash-hidden',
          eligible: false,
          reason: 'hidden',
          added: true
        }),
        expect.objectContaining({
          id: 'dash-built-in',
          eligible: false,
          reason: 'built-in',
          added: true
        })
      ])
    )
  })

  it('keeps one allowlist reference per kind and source ID without dropping stale refs', () => {
    expect(streamSourceRefsFromSettings(settingsWithSources())).toEqual([
      { kind: 'dashboard', id: 'dash-race' },
      { kind: 'touch', id: 'touch-missing' }
    ])
  })

  it('repairs a missing reference automatically when the same eligible source returns', () => {
    const repaired = buildStreamSourceDescriptors(
      dashboards,
      [...touchPanels, {
        id: 'touch-missing',
        name: 'Restored pit controls',
        columns: 3,
        rows: 2,
        buttonCount: 6,
        hidden: false
      }],
      settingsWithSources()
    )

    expect(repaired.find((source) => source.id === 'touch-missing')).toEqual(
      expect.objectContaining({
        label: 'Restored pit controls',
        added: true,
        eligible: true,
        reason: null
      })
    )
  })
})

describe('stream source mutation contract', () => {
  it('accepts only an exact kind and validated ID payload', () => {
    expect(parseStreamSourceMutationRequest({ kind: 'dashboard', id: 'dash-race' })).toEqual({
      kind: 'dashboard',
      id: 'dash-race'
    })
    expect(parseStreamSourceMutationRequest({ kind: 'dashboard', id: 'dash-race', eligible: true })).toBeNull()
    expect(parseStreamSourceMutationRequest({ kind: 'dashboard', id: '../settings' })).toBeNull()
    expect(parseStreamSourceMutationRequest({ kind: 'built-in', id: 'dash-race' })).toBeNull()
    expect(parseStreamSourceMutationRequest('dashboard:dash-race')).toBeNull()
  })

  it('allows exact removal of a legacy invalid ID without making it addable', () => {
    const request = { kind: 'dashboard', id: 'legacy dashboard id' }
    expect(parseStreamSourceMutationRequest(request)).toBeNull()
    expect(parseStreamSourceRemovalRequest(request)).toEqual(request)
    expect(parseStreamSourceRemovalRequest({ ...request, added: true })).toBeNull()
    expect(parseStreamSourceRemovalRequest({ kind: 'dashboard', id: 'legacy/dashboard..v1' })).toEqual({
      kind: 'dashboard',
      id: 'legacy/dashboard..v1'
    })
  })

  it('returns an empty descriptor catalog for empty registries and settings', () => {
    expect(buildStreamSourceDescriptors([], [], emptyStreamTargetSettings())).toEqual([])
  })
})
