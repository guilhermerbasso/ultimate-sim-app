import { describe, expect, it } from 'vitest'
import {
  captureLiveTelemetryContext,
  fallbackLiveSessionIdentity,
  LiveTelemetryGate
} from './replay'
import type { TelemetrySnapshot } from './telemetry'

function snapshot(overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sim: 'acc',
    connected: true,
    timestamp: 101_000,
    sessionTimeSec: 100,
    sessionKind: 'race',
    trackName: 'Spa',
    trackConfigName: 'GP',
    carName: 'GT3 R',
    carPath: 'gt3r',
    currentLap: 3,
    ...overrides
  } as TelemetrySnapshot
}

describe('fallback live session identity', () => {
  it('includes session kind, provider, layout, car, and deterministic boundary', () => {
    const identity = fallbackLiveSessionIdentity(snapshot())
    expect(identity).toContain('acc:race:spa:gp:gt3r')
    expect(identity).toContain('start-')
    expect(captureLiveTelemetryContext(snapshot())?.sessionIdentity).toBe(identity)
  })

  it('creates a real boundary for Race → Hotlap and increments reconnect epochs', () => {
    const gate = new LiveTelemetryGate()
    const race = gate.observe(snapshot({ sessionKind: 'race', sessionType: '2' }))
    const hotlap = gate.observe(snapshot({ sessionKind: 'hotlap', sessionType: '3' }))
    expect(race.live).toBe(true)
    expect(hotlap).toMatchObject({ live: true, boundary: true, sessionChanged: true })
    expect(hotlap.context?.sessionIdentity).not.toBe(race.context?.sessionIdentity)

    gate.observe(null)
    const reconnected = gate.observe(snapshot({ sessionKind: 'hotlap', sessionType: '3' }))
    expect(reconnected.context?.connectionEpoch).toBe(
      (hotlap.context?.connectionEpoch ?? 0) + 1
    )
  })

  it('preserves a validated provider connection epoch', () => {
    const gate = new LiveTelemetryGate()
    const firstSnapshot = snapshot({ connectionEpoch: 41 })
    const first = gate.observe(firstSnapshot)
    expect(first.context).toEqual(captureLiveTelemetryContext(firstSnapshot))

    gate.observe(snapshot({ connected: false, connectionEpoch: 41 }))
    const reconnectedSnapshot = snapshot({ connectionEpoch: 42 })
    const reconnected = gate.observe(reconnectedSnapshot)
    expect(reconnected.context).toEqual(captureLiveTelemetryContext(reconnectedSnapshot))
    expect(reconnected.context?.connectionEpoch).toBe(42)
  })
})
