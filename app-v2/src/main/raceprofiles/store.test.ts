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
})
