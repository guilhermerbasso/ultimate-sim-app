import { describe, expect, it, vi } from 'vitest'
import type { RaceProfile } from '../../../shared/raceprofiles'
import { applyRaceProfile, handleRaceProfileSuggestion, raceProfileSections, type RaceProfileIpc } from './race-profile-runtime'

// Fake main process. Every setter mutates `state`, every getter reads it back, so a
// rollback is observable: after a failed apply the state must equal the initial one.
function fakeIpc(options: { failChannel?: string; autoSwitch?: boolean; profiles?: RaceProfile[] } = {}) {
  const state: Record<string, unknown> = {
    'oled:getConfig': { page: 'old' },
    'overlays:getConfig': { fuel: 'old' },
    'alerts:getConfig': { lowFuel: 'old' },
    'actions:getBindings': [{ id: 'old' }]
  }
  const calls: string[] = []
  const setterToGetter: Record<string, string> = {
    'oled:setConfig': 'oled:getConfig',
    'overlays:setConfig': 'overlays:getConfig',
    'alerts:setConfig': 'alerts:getConfig',
    'actions:setBindings': 'actions:getBindings'
  }
  const ipc: RaceProfileIpc & { calls: string[]; state: Record<string, unknown> } = {
    calls,
    state,
    invoke: async <T,>(channel: string, ...args: unknown[]): Promise<T> => {
      calls.push(channel)
      if (channel === options.failChannel) throw new Error(`${channel} rejected`)
      if (channel === 'profilesv2:getAutoSwitch') return (options.autoSwitch ?? true) as T
      if (channel === 'profilesv2:list') return (options.profiles ?? []) as T
      const getter = setterToGetter[channel]
      if (getter) {
        state[getter] = args[0]
        return undefined as T
      }
      return state[channel] as T
    }
  }
  return ipc
}

const PROFILE: RaceProfile = {
  id: 'wet-spa',
  name: 'Wet Spa',
  match: {},
  buttonboxProfile: '',
  oled: { page: 'new' },
  overlays: { fuel: 'new' },
  alerts: { lowFuel: 'new' },
  bindings: [{ id: 'new' }]
} as unknown as RaceProfile

describe('race profile runtime — transactional apply (P1-09)', () => {
  it('applies every configured section on success', async () => {
    const ipc = fakeIpc()
    const result = await applyRaceProfile(PROFILE, undefined, ipc)

    expect(result.ok).toBe(true)
    expect(ipc.state['oled:getConfig']).toEqual({ page: 'new' })
    expect(ipc.state['overlays:getConfig']).toEqual({ fuel: 'new' })
    expect(ipc.state['alerts:getConfig']).toEqual({ lowFuel: 'new' })
    expect(ipc.state['actions:getBindings']).toEqual([{ id: 'new' }])
  })

  it('leaves NO section applied when a later one fails', async () => {
    const ipc = fakeIpc({ failChannel: 'alerts:setConfig' })
    const result = await applyRaceProfile(PROFILE, undefined, ipc)

    expect(result.ok).toBe(false)
    expect(result.failedSection).toBe('alerts')
    // The whole point: without rollback these two would be holding the new profile
    // while alerts and bindings still hold the old one.
    expect(ipc.state['oled:getConfig']).toEqual({ page: 'old' })
    expect(ipc.state['overlays:getConfig']).toEqual({ fuel: 'old' })
    expect(ipc.state['alerts:getConfig']).toEqual({ lowFuel: 'old' })
    expect(ipc.state['actions:getBindings']).toEqual([{ id: 'old' }])
  })

  it('rolls the app sections back when the button-box device write fails', async () => {
    const ipc = fakeIpc()
    const profile = { ...PROFILE, buttonboxProfile: 'endurance' } as RaceProfile
    const result = await applyRaceProfile(
      profile,
      { connected: true, applyButtonbox: async () => { throw new Error('device offline') } },
      ipc
    )

    expect(result.ok).toBe(false)
    expect(result.failedSection).toBe('buttonbox')
    expect(ipc.state['oled:getConfig']).toEqual({ page: 'old' })
    expect(ipc.state['actions:getBindings']).toEqual([{ id: 'old' }])
  })

  it('treats haptics as best-effort — its failure neither aborts nor rolls back', async () => {
    const ipc = fakeIpc({ failChannel: 'haptics:setConfig' })
    const profile = { ...PROFILE, hapticsGains: { kerb: 0.8 } } as unknown as RaceProfile
    const result = await applyRaceProfile(profile, undefined, ipc)

    expect(result.ok).toBe(true)
    expect(result.degraded).toEqual(['haptics'])
    expect(ipc.state['oled:getConfig']).toEqual({ page: 'new' })
  })

  it('never reads or writes a section the profile does not set', async () => {
    const ipc = fakeIpc()
    const sparse = { id: 'x', name: 'x', match: {}, buttonboxProfile: '', alerts: { lowFuel: 'new' } } as unknown as RaceProfile
    const result = await applyRaceProfile(sparse, undefined, ipc)

    expect(result.ok).toBe(true)
    expect(result.applied).toEqual(['alerts'])
    expect(ipc.calls).not.toContain('oled:getConfig')
    expect(ipc.calls).not.toContain('oled:setConfig')
    expect(ipc.calls).not.toContain('overlays:setConfig')
  })

  it('declares a getter for every transactional section, so rollback is always possible', () => {
    const sections = raceProfileSections(PROFILE, fakeIpc())
    for (const section of sections.filter((candidate) => !candidate.bestEffort)) {
      expect(typeof section.read, `${section.id} must be readable`).toBe('function')
    }
  })
})

describe('race profile auto-switch runs outside its view (P1-08)', () => {
  it('applies a suggestion without the RaceProfiles screen being mounted', async () => {
    const ipc = fakeIpc({ autoSwitch: true, profiles: [PROFILE] })
    const result = await handleRaceProfileSuggestion({ profileId: 'wet-spa', carName: 'GT3', trackName: 'Spa' }, { ipc })

    expect(result?.ok).toBe(true)
    expect(ipc.state['overlays:getConfig']).toEqual({ fuel: 'new' })
  })

  it('re-reads auto-switch on every suggestion instead of trusting a view-held copy', async () => {
    const ipc = fakeIpc({ autoSwitch: false, profiles: [PROFILE] })
    const result = await handleRaceProfileSuggestion({ profileId: 'wet-spa', carName: 'GT3', trackName: 'Spa' }, { ipc })

    expect(result).toBeNull()
    expect(ipc.calls).toContain('profilesv2:getAutoSwitch')
    expect(ipc.state['overlays:getConfig']).toEqual({ fuel: 'old' })
  })

  it('ignores a suggestion for a profile that no longer exists', async () => {
    const ipc = fakeIpc({ autoSwitch: true, profiles: [] })
    expect(await handleRaceProfileSuggestion({ profileId: 'gone', carName: 'GT3', trackName: 'Spa' }, { ipc })).toBeNull()
  })

  it('reports a failed automatic apply instead of failing silently', async () => {
    const ipc = fakeIpc({ autoSwitch: true, profiles: [PROFILE], failChannel: 'alerts:setConfig' })
    const showToast = vi.fn()
    const result = await handleRaceProfileSuggestion({ profileId: 'wet-spa', carName: 'GT3', trackName: 'Spa' }, { ipc, showToast })

    expect(result?.ok).toBe(false)
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('alerts'), 'error')
  })
})
