import { mkdirSync, rmSync } from 'node:fs'
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { join } from 'node:path'
import tls from 'node:tls'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  Phase02Tap,
  Phase02TapBudgets,
  Phase02TapDelivery,
  Phase02TapStatus,
  Phase02TapSubscription
} from '../../shared/phase02-tap'
import {
  DEFAULT_PASSPORT_CONFIG,
  DEFAULT_PASSPORT_PRIVACY,
  type PassportExportProfile
} from '../../shared/stint-passport'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { ModuleContext } from '../module-context'
import { telemetrySnapshotToRaceOpsEvent } from '../phase02/telemetry-contract-adapter'
import type { PassportPersistenceClient } from './persistence-client'
import { PassportPersistenceEngine } from './persistence-engine'
import { StintPassportService } from './service'

const dirs: string[] = []
const services: StintPassportService[] = []
const stores: PassportPersistenceEngine[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const service of services.splice(0)) await service.dispose()
  for (const store of stores.splice(0)) {
    try {
      store.close()
    } catch {
      // Already closed.
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

class OfflineTap implements Phase02Tap {
  private consumer: ((delivery: Phase02TapDelivery) => Promise<void> | void) | null = null
  private state: Phase02TapStatus = {
    budgets: { maxItems: 8, maxBytes: 256 * 1024, maxAgeMs: 2_000, maxDrainBatch: 4 },
    enabled: true,
    killSwitch: false,
    queuedItems: 0,
    queuedBytes: 0,
    accepted: 0,
    delivered: 0,
    dropped: 0,
    overflowCount: 0,
    consumerErrors: 0,
    gapPending: false
  }

  subscribe(
    id: string,
    _budgets: Phase02TapBudgets,
    consumer: (delivery: Phase02TapDelivery) => Promise<void> | void
  ): Phase02TapSubscription {
    this.consumer = consumer
    return {
      id,
      status: () => ({ ...this.state }),
      setKillSwitch: (enabled) => {
        this.state.killSwitch = enabled
        this.state.enabled = !enabled
      },
      dispose: () => {
        this.consumer = null
        this.state.enabled = false
      }
    }
  }

  status(): Phase02TapStatus {
    return { ...this.state }
  }

  dispose(): void {
    this.consumer = null
  }

  async emit(delivery: Phase02TapDelivery): Promise<void> {
    if (!this.consumer || this.state.killSwitch) return
    this.state.accepted += 1
    await this.consumer(delivery)
    this.state.delivered += 1
    this.state.lastDeliveredSequence = delivery.event.sequence
  }
}

function clientFor(engine: PassportPersistenceEngine): PassportPersistenceClient {
  let killed = false
  const client: Record<string, unknown> = {
    status: () => ({
      state: killed ? 'killed' : 'ready',
      queued: 0,
      queuedBytes: 0,
      inFlight: false,
      failures: 0,
      restarts: 0
    }),
    setKillSwitch: (enabled: boolean) => { killed = enabled },
    close: async () => engine.close(),
    setWorkerKillSwitch: async (enabled: boolean) => engine.setKillSwitch(enabled),
    runFullAudit: async () => ({
      integrity: await engine.runFullAudit(),
      durationMs: 0
    })
  }
  for (const method of [
    'getConfig', 'setConfig', 'getPrivacy', 'getPrivacyMutationGeneration',
    'getRosterMutationGeneration', 'setPrivacy', 'getKillSwitch',
    'listRoster', 'saveRoster', 'persistPassport', 'listPassports', 'getPassport',
    'getIntegrity', 'verifyActiveStint', 'purgeRetention', 'deleteByClass',
    'exportPackage', 'logRuntime', 'eventHeaders', 'metricsSnapshot'
  ]) {
    client[method] = async (...args: unknown[]) =>
      (engine as unknown as Record<string, (...values: unknown[]) => unknown>)[method](...args)
  }
  return client as unknown as PassportPersistenceClient
}

function scratch(): string {
  const dir = join(process.cwd(), `.passport-offline-${process.pid}-${dirs.length}`)
  mkdirSync(dir, { recursive: true })
  dirs.push(dir)
  return dir
}

function telemetry(context: 'live' | 'replay' = 'live'): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: context === 'live' ? 1_000 : 2_000,
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
      state: context,
      reason: context === 'live' ? 'confirmed-live' : 'replay-playing',
      inputs: {},
      active: context === 'replay',
      revision: context === 'live' ? 1 : 2,
      token: context === 'live' ? '1:1' : '1:2',
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

function delivery(snapshot: TelemetrySnapshot, sequence: bigint): Phase02TapDelivery {
  return {
    event: telemetrySnapshotToRaceOpsEvent({
      snapshot,
      sequence,
      gap: false,
      processedAtMs: snapshot.timestamp + 10,
      observedMonotonicNs: 5_000n + sequence
    }),
    enqueuedAt: snapshot.timestamp,
    byteLength: 1_000
  }
}

function context(dir: string, tap: Phase02Tap): ModuleContext {
  return {
    app: { getPath: () => dir },
    phase02Tap: tap,
    profileStore: {
      loadProfile: vi.fn(async () => {
        throw new Error('local buttonbox profile unavailable')
      })
    },
    serialHub: { listDevices: () => [] },
    broadcast: vi.fn(),
    registerGracefulTeardown: vi.fn(() => () => undefined)
  } as unknown as ModuleContext
}

function installNetworkDenySentinels() {
  const deny = vi.fn(() => {
    throw new Error('network access is forbidden in Passport local-first flows')
  })
  vi.stubGlobal('fetch', deny)
  vi.stubGlobal('WebSocket', class {
    constructor() {
      deny()
    }
  })
  vi.spyOn(http, 'request').mockImplementation(deny as typeof http.request)
  vi.spyOn(http, 'get').mockImplementation(deny as typeof http.get)
  vi.spyOn(https, 'request').mockImplementation(deny as typeof https.request)
  vi.spyOn(https, 'get').mockImplementation(deny as typeof https.get)
  vi.spyOn(net, 'connect').mockImplementation(deny as typeof net.connect)
  vi.spyOn(net, 'createConnection').mockImplementation(deny as typeof net.createConnection)
  vi.spyOn(tls, 'connect').mockImplementation(deny as typeof tls.connect)
  vi.spyOn(dns, 'lookup').mockImplementation(deny as unknown as typeof dns.lookup)
  vi.spyOn(dns, 'resolve').mockImplementation(deny as unknown as typeof dns.resolve)
  vi.spyOn(dns.promises, 'lookup').mockImplementation(deny as typeof dns.promises.lookup)
  vi.spyOn(dns.promises, 'resolve').mockImplementation(deny as typeof dns.promises.resolve)
  return deny
}

describe('Passport offline local-first flows', () => {
  it('runs readiness, mutations, retention, audit, exports, replay inspection, close, and restart with all networking denied', async () => {
    const deny = installNetworkDenySentinels()
    const dir = scratch()
    const path = join(dir, 'passport.db')
    const tap = new OfflineTap()
    const store = new PassportPersistenceEngine({ path, now: () => 10_000 })
    stores.push(store)
    const service = new StintPassportService(context(dir, tap), clientFor(store), () => 10_000)
    services.push(service)
    await service.setConfig({
      ...DEFAULT_PASSPORT_CONFIG,
      expectedRaceProfileId: 'missing-race-profile',
      expectedButtonboxProfile: 'missing-buttonbox-profile',
      requiredDeviceIds: ['missing-device'],
      requiredControlIds: ['sw1', 'sw2'],
      requiredAudioOutputDeviceId: 'missing-headset',
      requiredAudioCallouts: ['proximity.spotter'],
      minimumFuelLiters: 45,
      targetStintLaps: 18,
      weatherAssumption: 'dry',
      updatedAt: 10_000
    })
    await tap.emit(delivery(telemetry(), 1n))
    let snapshot = await service.snapshot()
    const current = snapshot.current!
    await service.setRoster([{
      memberId: current.identity.driverRef,
      displayName: current.identity.driverLabel,
      roles: ['driver'],
      active: true
    }])
    await service.setPrivacy({
      ...DEFAULT_PASSPORT_PRIVACY,
      identityPersistenceOptIn: true,
      updatedAt: 10_000
    })
    await service.resolveItem({
      stintId: current.identity.stintId,
      itemId: 'audio-comms',
      status: 'manual-confirmed',
      owner: { memberId: current.identity.driverRef, role: 'driver' },
      reasonCode: 'LOCAL_RADIO_CHECK'
    })
    const challenge = await service.prepareChallenge({
      stintId: current.identity.stintId,
      owner: { memberId: current.identity.driverRef, role: 'driver' }
    })
    expect(challenge.passportRevision).toBe((await service.snapshot()).current?.revision)

    expect(await service.runRetention('explicit')).toEqual([])
    for (const profile of ['full-local', 'pseudonymized', 'race-only'] as PassportExportProfile[]) {
      const exported = await service.exportPackage(profile)
      expect(exported.profile).toBe(profile)
      expect(exported.packageHash).toMatch(/^[a-f0-9]{64}$/)
    }

    snapshot = await service.snapshot()
    expect(snapshot.current?.lifecycle).toBe('awaiting-checklist')
    expect(snapshot.current?.items.find((item) => item.id === 'race-profile')?.status).not.toBe('verified')
    expect(snapshot.current?.items.find((item) => item.id === 'required-devices')?.status).not.toBe('verified')
    expect(snapshot.current?.durability).toBe('durable')

    const closed = await service.closeCurrent('manual')
    await tap.emit(delivery(telemetry('replay'), 2n))
    snapshot = await service.snapshot()
    expect(snapshot.runtime.telemetryContext).toBe('replay')
    expect(snapshot.history.find((item) => item.identity.stintId === current.identity.stintId)).toMatchObject({
      lifecycle: 'closed',
      closeReason: 'manual'
    })
    await expect(service.prepareChallenge({
      stintId: current.identity.stintId,
      owner: { memberId: current.identity.driverRef, role: 'driver' }
    })).rejects.toThrow(/no longer current/i)
    const audit = await service.runFullAudit()
    expect(audit.integrity).toMatchObject({
      state: 'anchored',
      verified: true,
      scope: 'full'
    })
    expect(audit.integrity.checkedEvents).toBeGreaterThan(0)

    await service.dispose()
    services.splice(services.indexOf(service), 1)
    stores.splice(stores.indexOf(store), 1)
    const restartedStore = new PassportPersistenceEngine({ path, now: () => 20_000 })
    stores.push(restartedStore)
    const restarted = new StintPassportService(
      context(dir, new OfflineTap()),
      clientFor(restartedStore),
      () => 20_000
    )
    services.push(restarted)
    const restartedSnapshot = await restarted.snapshot()

    expect(closed?.identity.stintId).toBe(current.identity.stintId)
    expect(restartedSnapshot.current).toBeNull()
    expect(restartedSnapshot.history.find(
      (item) => item.identity.stintId === current.identity.stintId
    )).toMatchObject({
      lifecycle: 'closed',
      revision: closed?.revision
    })
    expect(deny).not.toHaveBeenCalled()
  })
})
