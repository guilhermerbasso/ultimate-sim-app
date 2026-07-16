import { describe, expect, it } from 'vitest'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import {
  PASSPORT_ITEM_DEFINITIONS,
  STINT_PASSPORT_CONTRACT_VERSION,
  calculatePassportCoverage,
  type PassportConfig,
  type PassportItem,
  type PassportRosterMember,
  type StintPassport
} from '../../shared/stint-passport'
import { canonicalFactValue, canonicalFactsByName } from '../../shared/phase02-contracts'
import { telemetrySnapshotToRaceOpsEvent } from '../phase02/telemetry-contract-adapter'
import {
  evaluatePassportItems,
  expirePassportItems,
  validateChallengeReadiness,
  withCoverage,
  type PassportExternalReadiness
} from './evaluator'

function telemetry(): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1_000,
    speedKmh: 180,
    rpm: 7_000,
    gear: 4,
    throttle: 0.8,
    brake: 0,
    clutch: 0,
    currentLap: 4,
    lapDistPct: 0.3,
    sessionType: 'Race',
    trackName: 'Spa',
    trackConfigName: 'Grand Prix',
    carName: 'GT3 R',
    carPath: 'gt3-r',
    driverName: 'Driver A',
    fuelLiters: 50,
    fuelPerLap: 2.5,
    trackWetnessPct: 0,
    isRaining: false,
    replayContext: {
      state: 'live',
      reason: 'confirmed-live',
      inputs: {},
      active: false,
      revision: 0,
      token: '1:0',
      sessionIdentity: '10:20:30:1',
      connectionEpoch: 1
    },
    drivers: [{
      carIdx: 0,
      name: 'Driver A',
      carNumber: '7',
      position: 1,
      classPosition: 1,
      classId: 1,
      custId: 10,
      teamId: 20,
      teamName: 'Team A',
      isPlayer: true
    }]
  }
}

function event() {
  return telemetrySnapshotToRaceOpsEvent({
    snapshot: telemetry(),
    sequence: 1n,
    gap: false,
    processedAtMs: 1_010,
    observedMonotonicNs: 5_000n
  })
}

function fixture(): {
  passport: StintPassport
  roster: PassportRosterMember[]
  config: PassportConfig
  external: PassportExternalReadiness
} {
  const currentEvent = event()
  const facts = canonicalFactsByName(currentEvent.facts)
  const driverRef = String(canonicalFactValue(facts.get('driver.ref')))
  const passport: StintPassport = {
    contractVersion: STINT_PASSPORT_CONTRACT_VERSION,
    identity: {
      stintId: 'stint-1',
      sessionRef: currentEvent.sessionRef,
      trackRef: String(canonicalFactValue(facts.get('session.track_ref'))),
      trackLabel: 'Spa — Grand Prix',
      carRef: String(canonicalFactValue(facts.get('car.ref'))),
      carLabel: 'GT3 R',
      driverRef,
      driverLabel: 'Driver A',
      teamRef: String(canonicalFactValue(facts.get('team.ref'))),
      teamLabel: 'Team A',
      startedAt: 1_000
    },
    lifecycle: 'awaiting-checklist',
    telemetryContext: 'live',
    items: PASSPORT_ITEM_DEFINITIONS.map((definition): PassportItem => ({
      id: definition.id,
      status: 'unknown',
      detail: 'Pending',
      revision: 0
    })),
    coverage: 0,
    applicableItems: 12,
    coveredItems: 0,
    interrupted: false,
    persisted: false
  }
  const roster: PassportRosterMember[] = [
    { memberId: driverRef, displayName: 'Driver A', roles: ['driver'], active: true },
    { memberId: 'engineer-1', displayName: 'Engineer A', roles: ['engineer'], active: true },
    { memberId: 'crew-1', displayName: 'Crew A', roles: ['crew-chief'], active: true },
    { memberId: 'spotter-1', displayName: 'Spotter A', roles: ['spotter'], active: true },
    { memberId: 'manager-1', displayName: 'Manager A', roles: ['team-manager'], active: true }
  ]
  const config: PassportConfig = {
    expectedRaceProfileId: 'race-spa',
    expectedButtonboxProfile: 'Endurance',
    requiredDeviceIds: ['simx'],
    requiredControlIds: ['sw1', 'sw2'],
    requiredAudioOutputDeviceId: 'headset-1',
    requiredAudioCallouts: ['proximity.spotter', 'pit.speeding'],
    communicationChannel: 'Discord #race',
    minimumFuelLiters: 45,
    targetStintLaps: 18,
    weatherAssumption: 'dry',
    updatedAt: 1_000
  }
  const external: PassportExternalReadiness = {
    raceProfile: {
      profileId: 'race-spa',
      exists: true,
      matchesCar: true,
      matchesTrack: true,
      buttonboxProfile: 'Endurance'
    },
    buttonboxProfile: {
      profileName: 'Endurance',
      exists: true,
      controlIds: ['sw1', 'sw2', 'e1cw']
    },
    devices: [{ id: 'simx', connected: true, label: 'SIM-X' }],
    audio: {
      configFound: true,
      enabled: true,
      muted: false,
      outputDeviceId: 'headset-1',
      enabledCallouts: ['proximity.spotter', 'pit.speeding', 'fuel.box']
    }
  }
  return { passport, roster, config, external }
}

describe('complete 12-item Stint Passport evaluation', () => {
  it('evaluates all 12 items with specific profile/device/control/audio/fuel evidence', () => {
    const data = fixture()
    const items = evaluatePassportItems({
      ...data,
      event: event(),
      now: 2_000
    })
    expect(items).toHaveLength(12)
    expect(new Set(items.map((item) => item.id)).size).toBe(12)
    expect(items.find((item) => item.id === 'race-profile')?.status).toBe('verified')
    expect(items.find((item) => item.id === 'required-devices')?.detail).toContain('simx')
    expect(items.find((item) => item.id === 'critical-controls')?.detail).toContain('sw1')
    expect(items.find((item) => item.id === 'fuel-load')?.detail).toContain('45.0 L')
    expect(items.find((item) => item.id === 'stint-target')?.status).toBe('verified')
    expect(items.find((item) => item.id === 'audio-comms')?.status).toBe('unknown')
    expect(items.find((item) => item.id === 'audio-comms')?.detail).toContain('Discord #race')
    expect(items.find((item) => item.id === 'final-acknowledgement')?.status).toBe('unknown')
    expect(items.every((item) => item.owner !== undefined)).toBe(true)
    const coverage = calculatePassportCoverage(items)
    expect(coverage).toMatchObject({ applicableItems: 12, coveredItems: 10 })
  })
  it('detects seeded profile, fuel, comms, and device faults without hiding unknowns', () => {
    const data = fixture()
    data.config.minimumFuelLiters = 80
    data.external.raceProfile.matchesTrack = false
    data.external.devices[0].connected = false
    data.external.audio.muted = true
    const items = evaluatePassportItems({
      ...data,
      event: event(),
      now: 2_000
    })
    expect(items.find((item) => item.id === 'fuel-load')?.status).toBe('mismatch')
    expect(items.find((item) => item.id === 'race-profile')?.status).toBe('mismatch')
    expect(items.find((item) => item.id === 'required-devices')?.status).toBe('mismatch')
    expect(items.find((item) => item.id === 'audio-comms')?.status).toBe('mismatch')
    expect(items.find((item) => item.id === 'final-acknowledgement')?.status).toBe('unknown')
  })

  it('expires verified and manual states and re-computes coverage before challenge completion', () => {
    const data = fixture()
    let items = evaluatePassportItems({ ...data, event: event(), now: 2_000 })
    items = items.map((item) =>
      item.id === 'audio-comms' || item.id === 'final-acknowledgement'
        ? {
            ...item,
            status: 'manual-confirmed' as const,
            verifiedAt: 2_000,
            expiresAt: 2_100,
            detail: 'Confirmed',
            revision: item.revision + 1
          }
        : item
    )
    const ready = withCoverage(data.passport, items)
    expect(ready.coverage).toBe(1)
    expect(validateChallengeReadiness(ready, data.roster, 2_050)).toEqual([])
    const expired = expirePassportItems(items, 2_101)
    expect(expired.some((item) => item.status === 'expired')).toBe(true)
    expect(calculatePassportCoverage(expired).coverage).toBeLessThan(0.95)
    expect(validateChallengeReadiness({ ...ready, items: expired }, data.roster, 2_101).length).toBeGreaterThan(0)
  })

  it('rejects arbitrary owners and waivers without a reason', () => {
    const data = fixture()
    const items = evaluatePassportItems({ ...data, event: event(), now: 2_000 }).map((item) =>
      item.id === 'fuel-load'
        ? {
            ...item,
            status: 'waived-with-reason' as const,
            owner: { memberId: 'outsider', role: 'driver' as const },
            overrideReason: '',
            expiresAt: 10_000
          }
        : item
    )
    const errors = validateChallengeReadiness(withCoverage(data.passport, items), data.roster, 2_100)
    expect(errors.join(' ')).toContain('owner is not valid')
    expect(errors.join(' ')).toContain('waiver requires a reason')
  })
})
