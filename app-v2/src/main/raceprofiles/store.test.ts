import { describe, expect, it } from 'vitest'
import { normalizeProfile } from './store'

describe('race profile haptics snapshot', () => {
  it('preserves finite haptic gains and clamps unsafe values', () => {
    expect(normalizeProfile({
      id: 'race-a',
      name: 'Race A',
      hapticsGains: {
        engine: 0.6,
        impact: 2,
        abs: -1,
        bad: Number.NaN
      }
    }).hapticsGains).toEqual({
      engine: 0.6,
      impact: 1,
      abs: 0
    })
  })

  it('deep-clones safe snapshots and drops cyclic or accessor-backed imports without reading them', () => {
    let getterRead = false
    const unsafeAlerts: Record<string, unknown> = {}
    Object.defineProperty(unsafeAlerts, 'flags', {
      enumerable: true,
      get: () => {
        getterRead = true
        throw new Error('must not execute imported accessors')
      }
    })
    const cyclicOverlays: Record<string, unknown> = { widgets: {}, customOverlays: [] }
    cyclicOverlays.self = cyclicOverlays
    const bindings = [{
      id: 'safe-binding',
      enabled: true,
      control: { source: 'gamepad', buttonIndex: 1 },
      action: { type: 'app', command: { name: 'dash:cycleNext' } }
    }]

    const profile = normalizeProfile({
      id: 'race-safe',
      name: 'Safe snapshot',
      alerts: unsafeAlerts,
      overlays: cyclicOverlays,
      bindings
    })

    expect(getterRead).toBe(false)
    expect(profile.alerts).toBeUndefined()
    expect(profile.overlays).toBeUndefined()
    expect(profile.bindings).toEqual(bindings)
    expect(profile.bindings).not.toBe(bindings)

    bindings[0].id = 'mutated-after-save'
    expect(profile.bindings[0].id).toBe('safe-binding')
  })
})
