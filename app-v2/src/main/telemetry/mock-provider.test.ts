import { describe, expect, it } from 'vitest'
import { MockProvider } from './mock-provider'

describe('MockProvider', () => {
  it('replays the selected RaceCon scenario from an injected monotonic clock', () => {
    let now = 10_000
    const provider = new MockProvider(() => now, 'RC-20')

    expect(provider.poll()).toBeNull()
    provider.start()
    const formation = provider.poll()
    now += 35_000
    const launch = provider.poll()
    provider.stop()

    expect(formation?.sim).toBe('mock')
    expect(formation?.sessionState).toBe('paradeLaps')
    expect(launch?.sessionState).toBe('racing')
    expect(launch?.speedKmh).toBeGreaterThan(formation?.speedKmh ?? 0)
    expect(launch?.timestamp).toBe(now)
  })

  it('preserves the unknown onTrack capability used by the track-map fallback', () => {
    const provider = new MockProvider(() => 1_000)
    provider.start()
    const snapshot = provider.poll()
    expect(snapshot?.onTrack).toBeUndefined()
    expect(snapshot?.onPitRoad).toBe(false)
  })
})
