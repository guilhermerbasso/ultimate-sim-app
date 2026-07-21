import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EVENT_ORDER, type MappingValues, type ProfileRecord } from '../../shared/ipc'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import { DEFAULT_PASSPORT_CONFIG, type PassportConfig } from '../../shared/stint-passport'
import type { ModuleContext } from '../module-context'
import { telemetrySnapshotToRaceOpsEvent } from '../phase02/telemetry-contract-adapter'
import { inspectPassportReadiness } from './readiness'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(name: string): string {
  const dir = join(process.cwd(), `.passport-readiness-${name}-${process.pid}-${dirs.length}`)
  mkdirSync(dir, { recursive: true })
  dirs.push(dir)
  return dir
}

function event() {
  const snapshot: TelemetrySnapshot = {
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
    replayContext: {
      state: 'live',
      reason: 'confirmed-live',
      inputs: {},
      active: false,
      revision: 1,
      token: '1:1',
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
  return telemetrySnapshotToRaceOpsEvent({
    snapshot,
    sequence: 1n,
    gap: false,
    processedAtMs: 1_010,
    observedMonotonicNs: 5_000n
  })
}

function config(): PassportConfig {
  return {
    ...DEFAULT_PASSPORT_CONFIG,
    expectedRaceProfileId: 'race-spa',
    expectedButtonboxProfile: 'Endurance',
    requiredDeviceIds: ['simx'],
    requiredControlIds: ['sw1', 'sw2'],
    requiredAudioOutputDeviceId: 'headset-1',
    requiredAudioCallouts: ['proximity.spotter'],
    updatedAt: 123
  }
}

function profileRecord(name: string): ProfileRecord {
  const values = Object.fromEntries(EVENT_ORDER.map((eventId, index) => [eventId, index + 1])) as MappingValues
  return {
    name,
    savedAt: '2026-01-01',
    mapping: {
      profileName: name,
      values,
      entries: [
        { controlId: 'sw1', controlType: 'button', label: 'Pit', hidButton: 1 },
        { controlId: 'sw2', controlType: 'button', label: 'Radio', hidButton: 2 }
      ],
      updatedAt: '2026-01-01'
    },
    config: { pulse: 50, debounce: 20, encmode: 'pulse', updatedAt: '2026-01-01' }
  }
}

function context(
  dir: string,
  loadProfile: ModuleContext['profileStore']['loadProfile'],
  listDevices: ModuleContext['serialHub']['listDevices'] = () => []
): ModuleContext {
  return {
    app: { getPath: () => dir },
    profileStore: { loadProfile },
    serialHub: { listDevices }
  } as unknown as ModuleContext
}

describe('inspectPassportReadiness local adapters', () => {
  it('turns missing or malformed local data and PII-bearing profile errors into unavailable facts', async () => {
    const dir = scratch('malformed')
    writeFileSync(join(dir, 'race-profiles.json'), '{"profiles":[{"id":')
    writeFileSync(join(dir, 'spotter.json'), '{"outputDeviceId":')
    const secret = 'Driver Alice SSN 123-45-6789'
    const ctx = context(
      dir,
      vi.fn(async () => {
        throw new Error(secret)
      }),
      () => [{
        id: 'simx',
        path: 'COM9',
        label: 'SIM-X',
        kind: 'sim-x',
        baud: 115200,
        connected: false
      }]
    )

    const result = await inspectPassportReadiness(ctx, event(), config(), 77_777)
    expect(result).toMatchObject({
      capturedAt: 77_777,
      raceProfile: {
        profileId: 'race-spa',
        exists: false,
        matchesCar: false,
        matchesTrack: false
      },
      buttonboxProfile: {
        profileName: 'Endurance',
        exists: false,
        controlIds: []
      },
      devices: [{ id: 'simx', connected: false, label: 'SIM-X' }],
      audio: {
        configFound: false
      }
    })
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(JSON.stringify(result)).not.toContain('123-45-6789')
  })

  it('[spec-gap] contains serial adapter exceptions instead of rejecting readiness', async () => {
    const dir = scratch('serial-exception')
    const secret = 'Driver Alice token local-secret-42'
    const ctx = context(
      dir,
      vi.fn(async () => {
        throw new Error('buttonbox unavailable')
      }),
      () => {
        throw new Error(secret)
      }
    )

    const result = await inspectPassportReadiness(ctx, event(), config(), 88_888)
    expect(result.capturedAt).toBe(88_888)
    expect(result.devices).toEqual([])
    expect(result.raceProfile.exists).toBe(false)
    expect(result.audio.configFound).toBe(false)
    expect(JSON.stringify(result)).not.toContain(secret)
  })

  it('awaits a delayed local profile adapter and preserves the caller capture time', async () => {
    const dir = scratch('delayed')
    writeFileSync(join(dir, 'race-profiles.json'), JSON.stringify({
      version: 1,
      autoSwitch: true,
      profiles: [{
        id: 'race-spa',
        name: 'Spa Endurance',
        match: { carName: ' gt3 r ', trackName: 'SPA' },
        buttonboxProfile: 'Endurance'
      }]
    }))
    let entered!: () => void
    let release!: () => void
    const atBarrier = new Promise<void>((resolve) => { entered = resolve })
    const barrier = new Promise<void>((resolve) => { release = resolve })
    const ctx = context(dir, vi.fn(async () => {
      entered()
      await barrier
      return profileRecord('Endurance')
    }))

    const pending = inspectPassportReadiness(ctx, event(), config(), 99_999)
    await atBarrier
    release()
    const result = await pending

    expect(result.capturedAt).toBe(99_999)
    expect(result.raceProfile).toMatchObject({
      exists: true,
      matchesCar: true,
      matchesTrack: true,
      buttonboxProfile: 'Endurance'
    })
    expect(result.buttonboxProfile).toEqual({
      profileName: 'Endurance',
      exists: true,
      controlIds: ['sw1', 'sw2']
    })
  })
})
