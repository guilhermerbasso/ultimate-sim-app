import { describe, expect, it } from 'vitest'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import { sessionTier, sessionTierKey } from './telemetry'

function snapshot(overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sim: 'acc',
    connected: true,
    timestamp: 1_000,
    sessionType: '3',
    sessionKind: 'hotlap',
    trackName: 'Spa',
    trackConfigName: 'GP',
    carName: 'GT3 R',
    ...overrides
  } as TelemetrySnapshot
}

describe('session telemetry tier', () => {
  it('changes its key when only canonical sessionKind changes', () => {
    const hotlap = snapshot({ sessionKind: 'hotlap' })
    const race = snapshot({ sessionKind: 'race' })
    expect(sessionTierKey(hotlap)).not.toBe(sessionTierKey(race))
  })

  it('delivers canonical session kind, layout, and precipitation to consumers', () => {
    expect(
      sessionTier(snapshot({ precipitationPct: 0.4 }))
    ).toMatchObject({
      sessionKind: 'hotlap',
      trackName: 'Spa',
      trackConfigName: 'GP',
      precipitationPct: 0.4
    })
  })
})
