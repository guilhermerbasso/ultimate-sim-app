import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModuleContext } from '../module-context'
import type {
  Phase02Tap,
  Phase02TapBudgets,
  Phase02TapDelivery,
  Phase02TapStatus,
  Phase02TapSubscription
} from '../../shared/phase02-tap'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import {
  DEFAULT_PASSPORT_PRIVACY,
  type PassportConfig,
  type PassportIntegrityState
} from '../../shared/stint-passport'
import { telemetrySnapshotToRaceOpsEvent } from '../phase02/telemetry-contract-adapter'
import { PassportPersistenceEngine, type PassportStoreEvent } from './persistence-engine'
import type { PassportPersistenceClient } from './persistence-client'
import { StintPassportService } from './service'

const dirs: string[] = []
const services: StintPassportService[] = []
const stores: PassportPersistenceEngine[] = []

afterEach(async () => {
  for (const service of services.splice(0)) await service.dispose().catch(() => undefined)
  for (const store of stores.splice(0)) {
    try {
      store.close()
    } catch {
      // Already closed.
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

class FakeTap implements Phase02Tap {
  private consumer: ((delivery: Phase02TapDelivery) => Promise<void> | void) | null = null
  private state: Phase02TapStatus = {
    budgets: {
      maxItems: 8,
      maxBytes: 256 * 1024,
      maxAgeMs: 2_000,
      maxDrainBatch: 4
    },
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
    'getAuthoritativeState',
    'getRosterMutationGeneration', 'setPrivacy', 'getKillSwitch',
    'listRoster', 'saveRoster', 'advancePersistenceMigration',
    'persistPassport', 'listPassports', 'getPassport',
    'getIntegrity', 'verifyActiveStint', 'purgeRetention', 'deleteByClass',
    'exportPackage', 'verifyImportPackage', 'logRuntime', 'eventHeaders', 'metricsSnapshot'
  ]) {
    client[method] = async (...args: unknown[]) =>
      (engine as unknown as Record<string, (...values: unknown[]) => unknown>)[method](...args)
  }
  return client as unknown as PassportPersistenceClient
}

function scratch(name: string): string {
  const dir = join(process.cwd(), `.passport-service-${name}-${process.pid}-${dirs.length}`)
  mkdirSync(dir, { recursive: true })
  dirs.push(dir)
  return dir
}

function telemetry(driverName = 'Driver A', custId = 10, revision = 0): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1_000 + revision,
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
    driverName,
    fuelLiters: 50,
    fuelPerLap: 2.5,
    trackWetnessPct: 0,
    isRaining: false,
    replayContext: {
      state: 'live',
      reason: 'confirmed-live',
      inputs: {},
      active: false,
      revision,
      token: `1:${revision}`,
      sessionIdentity: '10:20:30:1',
      connectionEpoch: 1
    },
    drivers: [{
      carIdx: 0,
      name: driverName,
      carNumber: '7',
      position: 1,
      classPosition: 1,
      classId: 1,
      custId,
      teamId: 20,
      teamName: 'Team A',
      isPlayer: true
    }]
  }
}

function delivery(snapshot: TelemetrySnapshot | null, sequence: bigint, gap = false): Phase02TapDelivery {
  return {
    event: telemetrySnapshotToRaceOpsEvent({
      snapshot,
      sequence,
      gap,
      processedAtMs: (snapshot?.timestamp ?? 2_000) + 10,
      observedMonotonicNs: 5_000n + sequence
    }),
    enqueuedAt: 2_000,
    byteLength: 1_000
  }
}

function seedReadinessFiles(dir: string): void {
  writeFileSync(join(dir, 'race-profiles.json'), JSON.stringify({
    version: 1,
    autoSwitch: true,
    profiles: [{
      id: 'race-spa',
      name: 'Spa Endurance',
      match: { carName: 'GT3 R', trackName: 'Spa' },
      buttonboxProfile: 'Endurance'
    }]
  }))
  writeFileSync(join(dir, 'spotter.json'), JSON.stringify({
    version: 1,
    enabled: true,
    muted: false,
    masterVolume: 1,
    language: 'en-US',
    defaultVoiceURI: '',
    outputDeviceId: 'headset-1',
    callouts: {
      'proximity.spotter': { enabled: true },
      'pit.speeding': { enabled: true },
      'fuel.box': { enabled: true }
    },
    updatedAt: 1
  }))
}

function harness(name: string) {
  const dir = scratch(name)
  seedReadinessFiles(dir)
  const tap = new FakeTap()
  const broadcast = vi.fn()
  const profile = {
    name: 'Endurance',
    savedAt: '2026-01-01',
    mapping: {
      profileName: 'Endurance',
      values: {},
      entries: [
        { controlId: 'sw1', controlType: 'button', label: 'Pit', hidButton: 1 },
        { controlId: 'sw2', controlType: 'button', label: 'Radio', hidButton: 2 }
      ],
      updatedAt: '2026-01-01'
    },
    config: { pulse: 50, debounce: 20, encmode: 'pulse', updatedAt: '2026-01-01' }
  }
  const ctx = {
    app: { getPath: () => dir },
    phase02Tap: tap,
    profileStore: { loadProfile: vi.fn(async (nameValue: string) => {
      if (nameValue !== 'Endurance') throw new Error('missing')
      return profile
    }) },
    serialHub: {
      listDevices: () => [{ id: 'simx', path: 'COM1', label: 'SIM-X', kind: 'sim-x', baud: 115200, connected: true }]
    },
    broadcast,
    registerGracefulTeardown: vi.fn(() => () => undefined)
  } as unknown as ModuleContext
  let now = 10_000
  let ids = 0
  const store = new PassportPersistenceEngine({
    path: join(dir, 'passport.db'),
    now: () => now,
    idFactory: () => `id-${++ids}`
  })
  stores.push(store)
  const client = clientFor(store)
  const service = new StintPassportService(ctx, client, () => now)
  services.push(service)
  const config: PassportConfig = {
    expectedRaceProfileId: 'race-spa',
    expectedButtonboxProfile: 'Endurance',
    requiredDeviceIds: ['simx'],
    requiredControlIds: ['sw1', 'sw2'],
    requiredAudioOutputDeviceId: 'headset-1',
    requiredAudioCallouts: ['proximity.spotter', 'pit.speeding', 'fuel.box'],
    communicationChannel: 'Discord #race',
    minimumFuelLiters: 45,
    targetStintLaps: 18,
    weatherAssumption: 'dry',
    updatedAt: now
  }
  return {
    dir,
    ctx,
    tap,
    store,
    client,
    service,
    broadcast,
    config,
    setNow(value: number) { now = value }
  }
}

async function configureRoster(test: ReturnType<typeof harness>, driverRef: string, driverName: string): Promise<void> {
  await test.service.setRoster([
    { memberId: driverRef, displayName: driverName, roles: ['driver'], active: true },
    { memberId: 'engineer-1', displayName: 'Engineer A', roles: ['engineer'], active: true },
    { memberId: 'crew-1', displayName: 'Crew A', roles: ['crew-chief'], active: true },
    { memberId: 'spotter-1', displayName: 'Spotter A', roles: ['spotter'], active: true },
    { memberId: 'manager-1', displayName: 'Manager A', roles: ['team-manager'], active: true }
  ])
}

describe('StintPassportService lifecycle and privacy', () => {
  it('runs ephemerally by default, persists only after explicit D3 opt-in, and closes on disconnect', async () => {
    const test = harness('privacy-disconnect')
    await test.service.setConfig(test.config)
    await test.tap.emit(delivery(telemetry(), 1n))
    let snapshot = await test.service.snapshot()
    expect(snapshot.current?.persisted).toBe(false)
    expect(test.store.listPassports()).toEqual([])

    await configureRoster(test, snapshot.current?.identity.driverRef ?? '', 'Driver A')
    await test.service.setPrivacy({
      ...DEFAULT_PASSPORT_PRIVACY,
      identityPersistenceOptIn: true,
      updatedAt: 0
    })
    snapshot = await test.service.snapshot()
    expect(snapshot.current?.persisted).toBe(true)
    expect(test.store.listPassports()).toHaveLength(1)

    test.setNow(20_000)
    await test.tap.emit(delivery(null, 2n))
    snapshot = await test.service.snapshot()
    expect(snapshot.current).toBeNull()
    expect(snapshot.history[0]).toMatchObject({
      lifecycle: 'interrupted',
      interrupted: true,
      closeReason: 'disconnect'
    })
  })

  it('requires a new Passport after a later telemetry driver change even after challenge completion', async () => {
    const test = harness('driver-swap')
    await test.service.setConfig(test.config)
    await test.tap.emit(delivery(telemetry('Driver A', 10), 1n))
    let snapshot = await test.service.snapshot()
    const first = snapshot.current as NonNullable<typeof snapshot.current>
    await configureRoster(test, first.identity.driverRef, 'Driver A')
    await test.service.resolveItem({
      stintId: first.identity.stintId,
      itemId: 'audio-comms',
      status: 'manual-confirmed',
      owner: { memberId: 'spotter-1', role: 'spotter' },
      reasonCode: 'COMMS_CHECK_COMPLETE'
    })
    const challenge = await test.service.prepareChallenge({
      stintId: first.identity.stintId,
      owner: { memberId: first.identity.driverRef, role: 'driver' }
    })
    await test.service.completeChallenge({
      stintId: first.identity.stintId,
      challengeId: challenge.challengeId,
      response: challenge.nonce,
      owner: { memberId: first.identity.driverRef, role: 'driver' }
    })
    expect((await test.service.snapshot()).current?.lifecycle).toBe('ready')

    test.setNow(20_000)
    await test.tap.emit(delivery(telemetry('Driver B', 11, 2), 2n))
    snapshot = await test.service.snapshot()
    expect(snapshot.current?.identity.driverLabel).toBe('Driver B')
    expect(snapshot.current?.identity.stintId).not.toBe(first.identity.stintId)
    expect(snapshot.current?.lifecycle).toBe('awaiting-checklist')
    expect(snapshot.current?.challengeCompletedAt).toBeUndefined()
    expect(snapshot.history.some((passport) =>
      passport.identity.stintId === first.identity.stintId &&
      passport.closeReason === 'driver-swap'
    )).toBe(true)
  })

  it('closes the live Passport at the replay boundary and leaves it available for inspection', async () => {
    const test = harness('replay-boundary')
    await test.service.setConfig(test.config)
    await test.tap.emit(delivery(telemetry(), 1n))
    const replay = telemetry('Driver A', 10, 2)
    replay.replayContext = {
      ...replay.replayContext!,
      state: 'replay',
      reason: 'replay-playing',
      active: true
    }
    await test.tap.emit(delivery(replay, 2n))
    const snapshot = await test.service.snapshot()
    expect(snapshot.current).toBeNull()
    expect(snapshot.runtime.telemetryContext).toBe('replay')
    expect(snapshot.history[0]).toMatchObject({
      lifecycle: 'interrupted',
      closeReason: 'replay-boundary'
    })
  })

  it('does not renew freshness from snapshot reads and demotes Ready after expiry', async () => {
    const test = harness('freshness')
    await test.service.setConfig(test.config)
    await test.tap.emit(delivery(telemetry(), 1n))
    let snapshot = await test.service.snapshot()
    const current = snapshot.current!
    await configureRoster(test, current.identity.driverRef, 'Driver A')
    await test.service.resolveItem({
      stintId: current.identity.stintId,
      itemId: 'audio-comms',
      status: 'manual-confirmed',
      owner: { memberId: 'spotter-1', role: 'spotter' },
      reasonCode: 'COMMS_CHECK_COMPLETE'
    })
    const challenge = await test.service.prepareChallenge({
      stintId: current.identity.stintId,
      owner: { memberId: current.identity.driverRef, role: 'driver' }
    })
    await test.service.completeChallenge({
      stintId: current.identity.stintId,
      challengeId: challenge.challengeId,
      response: challenge.nonce,
      owner: { memberId: current.identity.driverRef, role: 'driver' }
    })
    snapshot = await test.service.snapshot()
    const verifiedAt = snapshot.current?.items.find((item) => item.id === 'session-identity')?.verifiedAt
    test.setNow(5_000)
    expect((await test.service.snapshot()).current?.items.find(
      (item) => item.id === 'session-identity'
    )?.verifiedAt).toBe(verifiedAt)
    test.setNow(20_000)
    snapshot = await test.service.snapshot()
    expect(snapshot.current?.items.find((item) => item.id === 'session-identity')?.status).toBe('expired')
    expect(snapshot.current?.lifecycle).toBe('awaiting-checklist')
    expect(snapshot.challenge).toBeUndefined()
  })

  it('marks a persisted active stint interrupted when recovering from an unclean restart', async () => {
    const test = harness('restart-recovery')
    await test.service.setConfig(test.config)
    await test.tap.emit(delivery(telemetry(), 1n))
    await test.service.setPrivacy({
      ...DEFAULT_PASSPORT_PRIVACY,
      identityPersistenceOptIn: true,
      updatedAt: 0
    })
    const activeId = (await test.service.snapshot()).current?.identity.stintId

    services.splice(services.indexOf(test.service), 1)
    test.tap.dispose()
    test.store.close()
    stores.splice(stores.indexOf(test.store), 1)

    const restartedStore = new PassportPersistenceEngine({ path: join(test.dir, 'passport.db'), now: () => 30_000 })
    stores.push(restartedStore)
    const restartedTap = new FakeTap()
    const restartedService = new StintPassportService(
      { ...test.ctx, phase02Tap: restartedTap } as ModuleContext,
      clientFor(restartedStore),
      () => 30_000
    )
    services.push(restartedService)
    const snapshot = await restartedService.snapshot()
    expect(snapshot.current).toBeNull()
    expect(snapshot.history.find((passport) => passport.identity.stintId === activeId)).toMatchObject({
      lifecycle: 'interrupted',
      closeReason: 'restart-recovery'
    })
  })

  it('blocks challenge completion after queue overflow until clean recovery frames arrive', async () => {
    const test = harness('overflow')
    await test.service.setConfig(test.config)
    await test.tap.emit(delivery(telemetry(), 1n, true))
    let snapshot = await test.service.snapshot()
    expect(snapshot.runtime.overflowBlocked).toBe(true)
    await expect(test.service.prepareChallenge({
      stintId: snapshot.current?.identity.stintId ?? '',
      owner: { memberId: snapshot.current?.identity.driverRef ?? '', role: 'driver' }
    })).rejects.toThrow(/overflow/i)

    for (let sequence = 2n; sequence <= 4n; sequence += 1n) {
      await test.tap.emit(delivery(telemetry('Driver A', 10, Number(sequence)), sequence))
    }
    snapshot = await test.service.snapshot()
    expect(snapshot.runtime.overflowBlocked).toBe(false)
    expect(snapshot.runtime.cleanFramesSinceOverflow).toBe(3)
  })

  it('interrupts the current Passport before enabling the kill switch', async () => {
    const test = harness('kill-switch-current')
    await test.service.setConfig(test.config)
    await test.tap.emit(delivery(telemetry(), 1n))
    const currentId = (await test.service.snapshot()).current?.identity.stintId
    await test.service.setKillSwitch(true)
    const snapshot = await test.service.snapshot()
    expect(snapshot.current).toBeNull()
    expect(snapshot.runtime.queue.killSwitch).toBe(true)
    expect(snapshot.history.find((passport) => passport.identity.stintId === currentId)).toMatchObject({
      lifecycle: 'interrupted'
    })
  })

  it('supports reasoned waivers and not-applicable resolutions with roster-bound owners', async () => {
    const test = harness('manual-statuses')
    await test.service.setConfig(test.config)
    await test.tap.emit(delivery(telemetry(), 1n))
    const current = (await test.service.snapshot()).current
    await configureRoster(test, current?.identity.driverRef ?? '', 'Driver A')
    await expect(test.service.resolveItem({
      stintId: current?.identity.stintId ?? '',
      itemId: 'fuel-load',
      status: 'waived-with-reason',
      owner: { memberId: 'engineer-1', role: 'engineer' }
    })).rejects.toThrow(/reason/i)
    await expect(test.service.resolveItem({
      stintId: current?.identity.stintId ?? '',
      itemId: 'fuel-load',
      status: 'manual-confirmed',
      owner: { memberId: 'arbitrary-text', role: 'engineer' }
    })).rejects.toThrow(/active roster/i)
    await test.service.resolveItem({
      stintId: current?.identity.stintId ?? '',
      itemId: 'fuel-load',
      status: 'waived-with-reason',
      owner: { memberId: 'engineer-1', role: 'engineer' },
      reasonCode: 'FUEL_SENSOR_MANUAL'
    })
    await test.service.resolveItem({
      stintId: current?.identity.stintId ?? '',
      itemId: 'weather-assumption',
      status: 'not-applicable',
      owner: { memberId: 'crew-1', role: 'crew-chief' },
      reasonCode: 'OPEN_WEATHER'
    })
    const snapshot = await test.service.snapshot()
    expect(snapshot.current?.items.find((item) => item.id === 'fuel-load')).toMatchObject({
      status: 'waived-with-reason',
      overrideReason: 'FUEL_SENSOR_MANUAL'
    })
    expect(snapshot.current?.items.find((item) => item.id === 'weather-assumption')?.status).toBe('not-applicable')
  })

  it('does not transfer attestations across roster changes', async () => {
    const test = harness('roster-invalidation')
    await test.service.setConfig(test.config)
    await test.tap.emit(delivery(telemetry(), 1n))
    const current = (await test.service.snapshot()).current!
    await configureRoster(test, current.identity.driverRef, 'Driver A')
    await test.service.resolveItem({
      stintId: current.identity.stintId,
      itemId: 'audio-comms',
      status: 'manual-confirmed',
      owner: { memberId: 'spotter-1', role: 'spotter' },
      reasonCode: 'COMMS_CHECK_COMPLETE'
    })
    expect((await test.service.snapshot()).current?.items.find((item) => item.id === 'audio-comms')?.status).toBe('manual-confirmed')
    await test.service.setRoster([
      { memberId: current.identity.driverRef, displayName: 'Driver A', roles: ['driver'], active: true },
      { memberId: 'engineer-1', displayName: 'Engineer B', roles: ['engineer'], active: true },
      { memberId: 'manager-1', displayName: 'Manager B', roles: ['team-manager'], active: true }
    ])
    const snapshot = await test.service.snapshot()
    expect(snapshot.current?.items.find((item) => item.id === 'audio-comms')).toMatchObject({
      status: 'unknown'
    })
    expect(snapshot.challenge).toBeUndefined()
  })

  it('does not turn unchanged tap frames into synchronous persistence work', async () => {
    const test = harness('steady-state')
    await test.service.setConfig(test.config)
    await test.tap.emit(delivery(telemetry(), 1n))
    const first = (await test.service.snapshot()).current
    await configureRoster(test, first?.identity.driverRef ?? '', 'Driver A')
    await test.service.setPrivacy({
      ...DEFAULT_PASSPORT_PRIVACY,
      identityPersistenceOptIn: true,
      updatedAt: 0
    })
    const before = test.store.metricsSnapshot().appendOperations
    for (let sequence = 2n; sequence <= 30n; sequence += 1n) {
      await test.tap.emit(delivery(telemetry('Driver A', 10, Number(sequence)), sequence))
    }
    expect(test.store.metricsSnapshot().appendOperations).toBe(before)
  })

  it('persists clearing D3 free text when its prior value equals the reason code', async () => {
    const test = harness('d3-free-text-clear')
    const current = await persistentCurrent(test)
    const reasonCode = 'DRIVER_CONFIRMED'
    const input = {
      stintId: current.identity.stintId,
      itemId: 'incoming-driver' as const,
      status: 'manual-confirmed' as const,
      owner: { memberId: current.identity.driverRef, role: 'driver' as const },
      reasonCode
    }

    await test.service.resolveItem({ ...input, freeText: reasonCode })
    const before = (await test.service.snapshot()).current!.items.find(
      (item) => item.id === input.itemId
    )!
    const eventsBefore = test.store.eventHeaders(current.identity.stintId).length
    const persistPassport = test.client.persistPassport.bind(test.client)
    let persistedEvent: PassportStoreEvent | undefined
    test.client.persistPassport = vi.fn(async (passport, event, expectedPrivacyGeneration) => {
      persistedEvent = event
      return persistPassport(passport, event, expectedPrivacyGeneration)
    })

    test.setNow(10_001)
    await test.service.resolveItem({ ...input, freeText: '' })
    const after = (await test.service.snapshot()).current!.items.find(
      (item) => item.id === input.itemId
    )!

    expect(after.revision).toBe(before.revision + 1)
    expect(after.evidence?.summary).toBe(reasonCode)
    expect(test.store.eventHeaders(current.identity.stintId)).toHaveLength(eventsBefore + 1)
    expect(persistedEvent?.canonicalEvent.facts.find(
      (fact) => fact.name === 'passport.freeText'
    )?.value).toEqual({
      kind: 'string',
      value: ''
    })
  })

  it('treats explicit D3 deletion as opt-out and removes active identity state', async () => {
    const test = harness('delete-d3')
    await test.service.setConfig(test.config)
    await test.tap.emit(delivery(telemetry(), 1n))
    const current = (await test.service.snapshot()).current
    await configureRoster(test, current?.identity.driverRef ?? '', 'Driver A')
    await test.service.setPrivacy({
      ...DEFAULT_PASSPORT_PRIVACY,
      identityPersistenceOptIn: true,
      updatedAt: 0
    })
    await test.service.deleteByClass('D3')
    const snapshot = await test.service.snapshot()
    expect(snapshot.privacy.identityPersistenceOptIn).toBe(false)
    expect(snapshot.current).toBeNull()
    expect(snapshot.roster).toEqual([])
    expect(snapshot.history).toEqual([])
    expect(test.store.listPassports()).toEqual([])
  })

  it('does not resurrect deleted in-memory evidence from the same observation', async () => {
    const test = harness('memory-redaction')
    await test.service.setConfig(test.config)
    const firstFrame = telemetry()
    await test.tap.emit(delivery(firstFrame, 1n))
    await test.service.deleteByClass('D2')
    let snapshot = await test.service.snapshot()
    expect(snapshot.current?.items.find((item) => item.id === 'fuel-load')?.evidence).toBeUndefined()
    snapshot = await test.service.snapshot()
    expect(snapshot.current?.items.find((item) => item.id === 'fuel-load')?.evidence).toBeUndefined()
    await test.tap.emit(delivery(firstFrame, 2n))
    expect((await test.service.snapshot()).current?.items.find(
      (item) => item.id === 'fuel-load'
    )?.evidence).toBeUndefined()
    await test.tap.emit(delivery(telemetry('Driver A', 10, 2), 3n))
    expect((await test.service.snapshot()).current?.items.find(
      (item) => item.id === 'fuel-load'
    )?.evidence).toBeDefined()
  })

  it('runs retention on a schedule in addition to startup and explicit controls', async () => {
    vi.useFakeTimers()
    const test = harness('scheduled-retention')
    await test.service.snapshot()
    const purge = vi.fn(async () => [])
    test.client.purgeRetention = purge
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(purge).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('cannot remain Ready when opted-in durability fails', async () => {
    const test = harness('durability-failure')
    await test.service.setConfig(test.config)
    await test.tap.emit(delivery(telemetry(), 1n))
    const current = (await test.service.snapshot()).current!
    await configureRoster(test, current.identity.driverRef, 'Driver A')
    await test.service.resolveItem({
      stintId: current.identity.stintId,
      itemId: 'audio-comms',
      status: 'manual-confirmed',
      owner: { memberId: 'spotter-1', role: 'spotter' },
      reasonCode: 'COMMS_CHECK_COMPLETE'
    })
    const challenge = await test.service.prepareChallenge({
      stintId: current.identity.stintId,
      owner: { memberId: current.identity.driverRef, role: 'driver' }
    })
    await test.service.completeChallenge({
      stintId: current.identity.stintId,
      challengeId: challenge.challengeId,
      response: challenge.nonce,
      owner: { memberId: current.identity.driverRef, role: 'driver' }
    })
    test.client.persistPassport = vi.fn(async () => {
      throw new Error('worker disk failure')
    })
    await expect(test.service.setPrivacy({
      ...DEFAULT_PASSPORT_PRIVACY,
      identityPersistenceOptIn: true,
      updatedAt: 0
    })).rejects.toThrow(/worker disk failure/i)
    const snapshot = await test.service.snapshot()
    expect(snapshot.current?.durability).toBe('failed')
    expect(snapshot.current?.lifecycle).toBe('awaiting-checklist')
    expect(snapshot.current?.challengeCompletedAt).toBeUndefined()
  })

  it('contains no direct Phase 1 Strategy, Coach, Team Fuel, or TelemetryHub coupling', () => {
    const source = readFileSync(new URL('./service.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/telemetryHub/)
    expect(source).not.toMatch(/modules\/strategy|modules\/coach|modules\/team-fuel/)
    expect(source).toContain('ctx.phase02Tap.subscribe')
  })

  it('issues and verifies an unguessable main-side mutation capability', async () => {
    const test = harness('capability')
    const capability = (await test.service.snapshot()).mutationCapability
    expect(capability.length).toBeGreaterThan(20)
    expect(() => test.service.assertCapability(capability)).not.toThrow()
    expect(() => test.service.assertCapability('wrong-capability')).toThrow(/invalid/i)
  })
  async function persistentCurrent(test: ReturnType<typeof harness>) {
    await test.service.setConfig(test.config)
    await test.tap.emit(delivery(telemetry(), 1n))
    const current = (await test.service.snapshot()).current!
    await configureRoster(test, current.identity.driverRef, current.identity.driverLabel)
    await test.service.setPrivacy({
      ...DEFAULT_PASSPORT_PRIVACY,
      identityPersistenceOptIn: true,
      updatedAt: 1
    })
    return (await test.service.snapshot()).current!
  }

  async function preparedPersistentChallenge(
    test: ReturnType<typeof harness>,
    trustedIntegrity = true
  ) {
    const current = await persistentCurrent(test)
    await test.service.resolveItem({
      stintId: current.identity.stintId,
      itemId: 'audio-comms',
      status: 'manual-confirmed',
      owner: { memberId: 'spotter-1', role: 'spotter' },
      reasonCode: 'COMMS_CHECK_COMPLETE'
    })
    const challenge = await test.service.prepareChallenge({
      stintId: current.identity.stintId,
      owner: { memberId: current.identity.driverRef, role: 'driver' }
    })
    const integrity = {
      state: trustedIntegrity ? 'anchored' : 'unanchored',
      verified: trustedIntegrity,
      scope: 'incremental' as const,
      checkedEvents: test.store.eventHeaders(current.identity.stintId).length,
      lastCheckedAt: 10_000,
      message: trustedIntegrity
        ? 'Verified against trusted signature anchor.'
        : 'No trusted signature anchor is available.'
    } as unknown as PassportIntegrityState
    test.client.verifyActiveStint = vi.fn(async () => integrity)
    test.client.getIntegrity = vi.fn(async () => integrity)
    return { current, challenge }
  }

  function outcomeOf<T>(operation: Promise<T>): Promise<'fulfilled' | 'rejected'> {
    return operation.then(() => 'fulfilled' as const, () => 'rejected' as const)
  }

  describe('StintPassportService Phase 4 failure truth and challenge fencing', () => {
    it('[spec-gap] rejects a manual resolution when its durable write fails without exposing the mutation as success', async () => {
      const test = harness('resolution-failure-truth')
      const current = await persistentCurrent(test)
      const before = (await test.service.snapshot()).current?.items.find((item) => item.id === 'fuel-load')
      test.client.persistPassport = vi.fn(async () => {
        throw new Error('commit rejected by durable store')
      })

      const outcome = await outcomeOf(test.service.resolveItem({
        stintId: current.identity.stintId,
        itemId: 'fuel-load',
        status: 'manual-confirmed',
        owner: { memberId: 'engineer-1', role: 'engineer' },
        reasonCode: 'MANUAL_FUEL_CHECK'
      }))
      const snapshot = await test.service.snapshot()
      const item = snapshot.current?.items.find((candidate) => candidate.id === 'fuel-load')

      expect({
        outcome,
        durability: snapshot.current?.durability,
        lifecycle: snapshot.current?.lifecycle,
        lastError: snapshot.runtime.lastError,
        itemStatus: item?.status,
        itemRevision: item?.revision
      }).toEqual({
        outcome: 'rejected',
        durability: 'failed',
        lifecycle: 'awaiting-checklist',
        lastError: 'commit rejected by durable store',
        itemStatus: before?.status,
        itemRevision: before?.revision
      })
    })

    it('[spec-gap] retains the recoverable current stint and omits closed history when close persistence fails', async () => {
      const test = harness('close-failure-truth')
      const current = await persistentCurrent(test)
      test.client.persistPassport = vi.fn(async () => {
        throw new Error('close transaction rolled back')
      })

      const outcome = await outcomeOf(test.service.closeCurrent('manual'))
      const snapshot = await test.service.snapshot()

      expect({
        outcome,
        currentId: snapshot.current?.identity.stintId,
        lifecycle: snapshot.current?.lifecycle,
        durability: snapshot.current?.durability,
        closedHistory: snapshot.history.some((item) => item.identity.stintId === current.identity.stintId),
        lastError: snapshot.runtime.lastError
      }).toEqual({
        outcome: 'rejected',
        currentId: current.identity.stintId,
        lifecycle: 'awaiting-checklist',
        durability: 'failed',
        closedHistory: false,
        lastError: 'close transaction rolled back'
      })
    })

    it('[spec-gap] does not consume a challenge or increment success metrics when challenge persistence fails', async () => {
      const test = harness('challenge-persistence-failure')
      const { current, challenge } = await preparedPersistentChallenge(test)
      test.client.persistPassport = vi.fn(async () => {
        throw new Error('challenge commit failed')
      })

      const outcome = await outcomeOf(test.service.completeChallenge({
        stintId: current.identity.stintId,
        challengeId: challenge.challengeId,
        response: challenge.nonce,
        owner: { memberId: current.identity.driverRef, role: 'driver' }
      }))
      const snapshot = await test.service.snapshot()

      expect({
        outcome,
        lifecycle: snapshot.current?.lifecycle,
        durability: snapshot.current?.durability,
        completedChallenges: snapshot.experiment.completedChallenges,
        totalOverheadMs: snapshot.experiment.totalOverheadMs,
        challengeId: snapshot.challenge?.challengeId,
        challengeCompletedAt: snapshot.current?.challengeCompletedAt
      }).toEqual({
        outcome: 'rejected',
        lifecycle: 'awaiting-checklist',
        durability: 'failed',
        completedChallenges: 0,
        totalOverheadMs: 0,
        challengeId: challenge.challengeId,
        challengeCompletedAt: undefined
      })
    })

    it('[spec-gap] reports response-loss ambiguity and uses a retry-stable event identity', async () => {
      const test = harness('response-loss-ambiguity')
      const current = await persistentCurrent(test)
      const persist = test.client.persistPassport.bind(test.client)
      let loseFirstResponse = true
      test.client.persistPassport = vi.fn(async (passport, event) => {
        const committed = await persist(passport, event)
        if (loseFirstResponse) {
          loseFirstResponse = false
          throw new Error('response lost after commit')
        }
        return committed
      })
      const input = {
        stintId: current.identity.stintId,
        itemId: 'fuel-load' as const,
        status: 'manual-confirmed' as const,
        owner: { memberId: 'engineer-1', role: 'engineer' as const },
        reasonCode: 'MANUAL_FUEL_CHECK'
      }

      const firstOutcome = await outcomeOf(test.service.resolveItem(input))
      const eventsAfterAmbiguousCommit = test.store.eventHeaders(current.identity.stintId).length
      const retryOutcome = await outcomeOf(test.service.resolveItem(input))
      const eventsAfterRetry = test.store.eventHeaders(current.identity.stintId).length
      const snapshot = await test.service.snapshot()

      expect({
        firstOutcome,
        retryOutcome,
        retryEventDelta: eventsAfterRetry - eventsAfterAmbiguousCommit,
        durability: snapshot.current?.durability,
        lastError: snapshot.runtime.lastError
      }).toEqual({
        firstOutcome: 'rejected',
        retryOutcome: 'fulfilled',
        retryEventDelta: 0,
        durability: 'durable',
        lastError: undefined
      })
    }, 15_000)

    it('[spec-gap] gives exactly one winner to concurrent completions of the same challenge', async () => {
      const test = harness('challenge-double-complete')
      const { current, challenge } = await preparedPersistentChallenge(test)
      let entered = 0
      let firstEntered!: () => void
      let release!: () => void
      const atBarrier = new Promise<void>((resolve) => { firstEntered = resolve })
      const barrier = new Promise<void>((resolve) => { release = resolve })
      const integrity = await test.client.verifyActiveStint(current.identity.stintId)
      test.client.verifyActiveStint = vi.fn(async () => {
        entered += 1
        if (entered === 1) firstEntered()
        await barrier
        return integrity
      })
      const input = {
        stintId: current.identity.stintId,
        challengeId: challenge.challengeId,
        response: challenge.nonce,
        owner: { memberId: current.identity.driverRef, role: 'driver' as const }
      }

      const headersBefore = test.store.eventHeaders(current.identity.stintId)
      const first = test.service.completeChallenge(input)
      const second = test.service.completeChallenge(input)
      const settled = Promise.allSettled([first, second])
      await atBarrier
      release()
      const results = await settled
      const snapshot = await test.service.snapshot()
      const headersAfter = test.store.eventHeaders(current.identity.stintId)
      const challengeEventDelta = headersAfter.length - headersBefore.length
      const duplicateHeaders = headersAfter.length - new Set(headersAfter.map((event) => event.dedupeKey)).size

      expect({
        fulfilled: results.filter((result) => result.status === 'fulfilled').length,
        rejected: results.filter((result) => result.status === 'rejected').length,
        completedChallenges: snapshot.experiment.completedChallenges,
        challengeEventDelta,
        duplicateHeaders
      }).toEqual({
        fulfilled: 1,
        rejected: 1,
        completedChallenges: 1,
        challengeEventDelta: 1,
        duplicateHeaders: 0
      })
    })

    it('[spec-gap] fences a challenge when its passport revision changes during awaited revalidation', async () => {
      const test = harness('challenge-revision-race')
      const { current, challenge } = await preparedPersistentChallenge(test)
      const profileStore = test.ctx.profileStore
      const originalLoad = profileStore.loadProfile.bind(profileStore)
      let entered!: () => void
      let release!: () => void
      const atBarrier = new Promise<void>((resolve) => { entered = resolve })
      const barrier = new Promise<void>((resolve) => { release = resolve })
      profileStore.loadProfile = vi.fn(async (name: string) => {
        entered()
        await barrier
        return originalLoad(name)
      })

      const completion = test.service.completeChallenge({
        stintId: current.identity.stintId,
        challengeId: challenge.challengeId,
        response: challenge.nonce,
        owner: { memberId: current.identity.driverRef, role: 'driver' }
      })
      await atBarrier
      await test.service.resolveItem({
        stintId: current.identity.stintId,
        itemId: 'fuel-load',
        status: 'manual-confirmed',
        owner: { memberId: 'engineer-1', role: 'engineer' },
        reasonCode: 'MANUAL_FUEL_CHECK'
      })
      release()
      const outcome = await outcomeOf(completion)
      const snapshot = await test.service.snapshot()

      expect({
        outcome,
        lifecycle: snapshot.current?.lifecycle,
        completedChallenges: snapshot.experiment.completedChallenges,
        challengeCompletedAt: snapshot.current?.challengeCompletedAt
      }).toEqual({
        outcome: 'rejected',
        lifecycle: 'awaiting-checklist',
        completedChallenges: 0,
        challengeCompletedAt: undefined
      })
    }, 15_000)

    it('rejects a stale challenge response after a live cross-session boundary', async () => {
      const test = harness('challenge-cross-session-race')
      const { current, challenge } = await preparedPersistentChallenge(test)
      const nextSession = telemetry('Driver A', 10, 2)
      nextSession.replayContext = {
        ...nextSession.replayContext!,
        sessionIdentity: '10:20:31:1',
        connectionEpoch: 2,
        token: '2:2'
      }
      await test.tap.emit(delivery(nextSession, 2n))

      const outcome = await outcomeOf(test.service.completeChallenge({
        stintId: current.identity.stintId,
        challengeId: challenge.challengeId,
        response: challenge.nonce,
        owner: { memberId: current.identity.driverRef, role: 'driver' }
      }))
      const snapshot = await test.service.snapshot()
      const closed = snapshot.history.find((entry) => entry.identity.stintId === current.identity.stintId)
      expect({
        outcome,
        currentChanged: snapshot.current?.identity.stintId !== current.identity.stintId,
        oldLifecycle: closed?.lifecycle,
        oldChallengeCompletedAt: closed?.challengeCompletedAt,
        completedChallenges: snapshot.experiment.completedChallenges,
        activeChallenge: snapshot.challenge
      }).toEqual({
        outcome: 'rejected',
        currentChanged: true,
        oldLifecycle: 'closed',
        oldChallengeCompletedAt: undefined,
        completedChallenges: 0,
        activeChallenge: undefined
      })
    })

    it('[spec-gap] refuses to turn unanchored unsigned integrity into Ready', async () => {
      const test = harness('unsigned-challenge')
      const { current, challenge } = await preparedPersistentChallenge(test, false)

      const outcome = await outcomeOf(test.service.completeChallenge({
        stintId: current.identity.stintId,
        challengeId: challenge.challengeId,
        response: challenge.nonce,
        owner: { memberId: current.identity.driverRef, role: 'driver' }
      }))
      const snapshot = await test.service.snapshot()

      expect({
        integrity: snapshot.integrity.state,
        verified: snapshot.integrity.verified,
        outcome,
        lifecycle: snapshot.current?.lifecycle,
        completedChallenges: snapshot.experiment.completedChallenges,
        challengeId: snapshot.challenge?.challengeId
      }).toEqual({
        integrity: 'unanchored',
        verified: false,
        outcome: 'rejected',
        lifecycle: 'awaiting-checklist',
        completedChallenges: 0,
        challengeId: challenge.challengeId
      })
    })

    it('demotes an already Ready persisted passport when the persistence circuit opens', async () => {
      const test = harness('snapshot-open-circuit-truth')
      const { current, challenge } = await preparedPersistentChallenge(test)
      await test.service.completeChallenge({
        stintId: current.identity.stintId,
        challengeId: challenge.challengeId,
        response: challenge.nonce,
        owner: { memberId: current.identity.driverRef, role: 'driver' }
      })
      expect((await test.service.snapshot()).current?.lifecycle).toBe('ready')
      test.client.status = vi.fn(() => ({
        state: 'open-circuit' as const,
        queued: 0,
        queuedBytes: 0,
        inFlight: false,
        failures: 3,
        restarts: 1,
        lastError: 'redacted'
      }))

      const snapshot = await test.service.snapshot()
      expect(snapshot.persistence.state).toBe('open-circuit')
      expect(snapshot.integrity.verified).toBe(false)
      expect(snapshot.current).toMatchObject({
        lifecycle: 'awaiting-checklist',
        durability: 'durable'
      })
      expect(snapshot.current?.challengeCompletedAt).toBeUndefined()
      expect(snapshot.current?.challengeOwner).toBeUndefined()
    })

    it('demotes an already Ready persisted passport when its trusted anchor is unavailable', async () => {
      const test = harness('snapshot-anchor-truth')
      const { current, challenge } = await preparedPersistentChallenge(test)
      await test.service.completeChallenge({
        stintId: current.identity.stintId,
        challengeId: challenge.challengeId,
        response: challenge.nonce,
        owner: { memberId: current.identity.driverRef, role: 'driver' }
      })
      test.client.getIntegrity = vi.fn(async () => ({
        state: 'unanchored' as const,
        verified: false,
        scope: 'bounded' as const,
        checkedEvents: 0,
        lastCheckedAt: 10_001,
        message: 'Trusted anchor unavailable.'
      }))

      const snapshot = await test.service.snapshot()
      expect(snapshot.integrity).toMatchObject({ state: 'unanchored', verified: false })
      expect(snapshot.current?.lifecycle).toBe('awaiting-checklist')
      expect(snapshot.current?.challengeCompletedAt).toBeUndefined()
    })

    it('[spec-gap] keeps D3 close, deletion, and opt-out atomic when deletion fails', async () => {
      const test = harness('d3-delete-atomicity')
      const current = await persistentCurrent(test)
      test.client.deleteByClass = vi.fn(async () => {
        throw new Error('D3 deletion transaction failed')
      })

      const outcome = await outcomeOf(test.service.deleteByClass('D3'))
      const snapshot = await test.service.snapshot()

      expect({
        outcome,
        currentId: snapshot.current?.identity.stintId,
        lifecycle: snapshot.current?.lifecycle,
        optedIn: snapshot.privacy.identityPersistenceOptIn,
        rosterCount: snapshot.roster.length,
        closedHistory: snapshot.history.some((item) => item.identity.stintId === current.identity.stintId),
        lastError: snapshot.runtime.lastError
      }).toEqual({
        outcome: 'rejected',
        currentId: current.identity.stintId,
        lifecycle: 'awaiting-checklist',
        optedIn: true,
        rosterCount: 5,
        closedHistory: false,
        lastError: 'D3 deletion transaction failed'
      })
    })

    it('[spec-gap] drains accepted retention, audit, and deletion work before closing persistence', async () => {
      const test = harness('dispose-drain')
      await test.service.snapshot()
      let retentionEntered!: () => void
      let deleteEntered!: () => void
      let auditEntered!: () => void
      let releaseRetention!: () => void
      let releaseDelete!: () => void
      let releaseAudit!: () => void
      const atRetention = new Promise<void>((resolve) => { retentionEntered = resolve })
      const atDelete = new Promise<void>((resolve) => { deleteEntered = resolve })
      const atAudit = new Promise<void>((resolve) => { auditEntered = resolve })
      const retentionBarrier = new Promise<void>((resolve) => { releaseRetention = resolve })
      const deleteBarrier = new Promise<void>((resolve) => { releaseDelete = resolve })
      const auditBarrier = new Promise<void>((resolve) => { releaseAudit = resolve })
      test.client.purgeRetention = vi.fn(async (...args: Parameters<typeof test.store.purgeRetention>) => {
        retentionEntered()
        await retentionBarrier
        return test.store.purgeRetention(...args)
      })
      test.client.runFullAudit = vi.fn(async () => {
        auditEntered()
        await auditBarrier
        return {
          integrity: test.store.getIntegrity(),
          durationMs: 0
        }
      })
      test.client.deleteByClass = vi.fn(async (...args: Parameters<typeof test.store.deleteByClass>) => {
        deleteEntered()
        await deleteBarrier
        return test.store.deleteByClass(...args)
      })
      const close = vi.fn(async () => undefined)
      test.client.close = close

      const retention = test.service.runRetention('explicit')
      await atRetention
      const operations = [
        retention,
        test.service.runFullAudit(),
        test.service.deleteByClass('D1')
      ]
      let disposed = false
      const disposal = test.service.dispose().then(() => { disposed = true })
      await Promise.resolve()
      await Promise.resolve()
      const observedBeforeRelease = {
        closeCalls: close.mock.calls.length,
        disposed
      }
      releaseRetention()
      await atDelete
      expect(close).not.toHaveBeenCalled()
      releaseDelete()
      await atAudit
      expect(close).not.toHaveBeenCalled()
      releaseAudit()
      await Promise.all([...operations, disposal])

      expect(observedBeforeRelease).toEqual({
        closeCalls: 0,
        disposed: false
      })
    })

    it('persists the acknowledged item through a revision-fenced disposal and restart without false Ready state', async () => {
      const test = harness('dispose-restart-durability')
      const current = await persistentCurrent(test)
      const acknowledged = await test.service.resolveItem({
        stintId: current.identity.stintId,
        itemId: 'fuel-load',
        status: 'manual-confirmed',
        owner: { memberId: 'engineer-1', role: 'engineer' },
        reasonCode: 'MANUAL_FUEL_CHECK'
      })

      await test.service.dispose()
      services.splice(services.indexOf(test.service), 1)
      stores.splice(stores.indexOf(test.store), 1)
      const restartedStore = new PassportPersistenceEngine({
        path: join(test.dir, 'passport.db'),
        now: () => 30_000
      })
      stores.push(restartedStore)
      const restartedService = new StintPassportService(
        { ...test.ctx, phase02Tap: new FakeTap() } as ModuleContext,
        clientFor(restartedStore),
        () => 30_000
      )
      services.push(restartedService)

      const snapshot = await restartedService.snapshot()
      const durable = snapshot.history.find((item) => item.identity.stintId === current.identity.stintId)
      expect(snapshot.current).toBeNull()
      expect(durable).toMatchObject({
        lifecycle: 'interrupted',
        closeReason: 'disconnect',
        revision: acknowledged.revision + 1
      })
      expect(durable?.lifecycle).not.toBe('ready')
      expect(durable?.challengeCompletedAt).toBeUndefined()
      expect(durable?.items.find((item) => item.id === 'fuel-load')).toMatchObject({
        status: 'manual-confirmed',
        reasonCode: 'MANUAL_FUEL_CHECK'
      })
    })

    it('imports authenticated packages only as deduplicated ephemeral replay history', async () => {
      const test = harness('authenticated-replay-import')
      const current = await persistentCurrent(test)
      const bundle = await test.service.exportPackage('pseudonymized')

      await expect(test.service.importPackage(bundle)).resolves.toMatchObject({
        ok: true,
        canceled: false,
        importedPassports: 1,
        packageHash: bundle.packageHash
      })
      await test.service.importPackage(bundle)
      const snapshot = await test.service.snapshot()
      const imported = snapshot.history.filter((entry) =>
        entry.identity.stintId.startsWith(`import:${bundle.packageHash.slice(0, 12)}:`)
      )

      expect(snapshot.current?.identity.stintId).toBe(current.identity.stintId)
      expect(imported).toHaveLength(1)
      expect(imported[0]).toMatchObject({
        lifecycle: 'interrupted',
        telemetryContext: 'replay',
        persisted: false,
        durability: 'ephemeral',
        interrupted: true,
        closeReason: 'replay-boundary'
      })
      expect(imported[0].lifecycle).not.toBe('ready')
      expect(imported[0].challengeCompletedAt).toBeUndefined()
      expect(imported[0].challengeOwner).toBeUndefined()
    })
  })

  describe('StintPassportService Phase 3 reconciliation and readiness containment', () => {
    it('[spec-gap] reconciles an ordinary passport COMMIT/no-response to durable rev2 before export or snapshot', async () => {
      const test = harness('passport-commit-no-response')
      const before = await persistentCurrent(test)
      const staleItem = before.items.find((item) => item.id === 'fuel-load')
      const headersBefore = test.store.eventHeaders(before.identity.stintId)
      const persist = test.client.persistPassport.bind(test.client)
      const responseLoss = new Error('response lost after passport COMMIT')
      const persistPassport = vi.fn(async (...args: Parameters<typeof persist>) => {
        await persist(...args)
        throw responseLoss
      })
      test.client.persistPassport = persistPassport
      const reasonCode = 'COMMIT_NO_RESPONSE_REV2'

      const mutation = await test.service.resolveItem({
        stintId: before.identity.stintId,
        itemId: 'fuel-load',
        status: 'manual-confirmed',
        owner: { memberId: 'engineer-1', role: 'engineer' },
        reasonCode
      }).then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason: unknown) => ({ status: 'rejected' as const, reason })
      )
      const rollback = (test.service as unknown as {
        current: typeof before | null
      }).current
      const durable = test.store.getPassport(before.identity.stintId)
      const durableItem = durable?.items.find((item) => item.id === 'fuel-load')

      const exported = await test.service.exportPackage('full-local')
      const exportedPassport = exported.passports.find((passport) =>
        passport.identity.stintId === before.identity.stintId
      )
      const exportedItem = exportedPassport?.items.find((item) => item.id === 'fuel-load')
      const live = await test.service.snapshot()
      const liveItem = live.current?.items.find((item) => item.id === 'fuel-load')
      const headersAfter = test.store.eventHeaders(before.identity.stintId)
      const addedHeaders = headersAfter.slice(headersBefore.length)
      const attemptedEvent = persistPassport.mock.calls[0]?.[1]
      const sha256Hex = /^[a-f0-9]{64}$/
      const staleContentHash = staleItem?.evidence?.contentHash
      const durableContentHash = durableItem?.evidence?.contentHash
      const exportedContentHash = exportedItem?.evidence?.contentHash
      const liveContentHash = liveItem?.evidence?.contentHash

      expect.soft(staleContentHash).toMatch(sha256Hex)
      expect.soft(durableContentHash).toMatch(sha256Hex)
      expect.soft(exportedContentHash).toMatch(sha256Hex)
      expect.soft(liveContentHash).toMatch(sha256Hex)
      expect.soft(durableContentHash).not.toBe(staleContentHash)
      expect.soft(exportedContentHash).toBe(durableContentHash)
      expect.soft(liveContentHash).toBe(durableContentHash)

      expect.soft({
        mutationStatus: mutation.status,
        mutationCauseIsResponseLoss:
          mutation.status === 'rejected' && mutation.reason === responseLoss,
        staleContentHash,
        rollback: {
          revision: rollback?.revision,
          durability: rollback?.durability,
          reasonCode: rollback?.items.find((item) => item.id === 'fuel-load')?.reasonCode
        },
        durable: {
          stintId: durable?.identity.stintId,
          revision: durable?.revision,
          persisted: durable?.persisted,
          durability: durable?.durability,
          itemStatus: durableItem?.status,
          reasonCode: durableItem?.reasonCode,
          contentHash: durableContentHash
        },
        exported: {
          passportCount: exported.passports.length,
          revision: exportedPassport?.revision,
          persisted: exportedPassport?.persisted,
          durability: exportedPassport?.durability,
          itemStatus: exportedItem?.status,
          reasonCode: exportedItem?.reasonCode,
          contentHash: exportedContentHash,
          staleRev1Overlay: exportedPassport?.revision === before.revision
        },
        live: {
          stintId: live.current?.identity.stintId,
          revision: live.current?.revision,
          persisted: live.current?.persisted,
          durability: live.current?.durability,
          itemStatus: liveItem?.status,
          reasonCode: liveItem?.reasonCode,
          contentHash: liveContentHash,
          staleRev1Overlay: live.current?.revision === before.revision
        },
        persistCalls: persistPassport.mock.calls.length,
        eventDelta: headersAfter.length - headersBefore.length,
        addedEventCount: addedHeaders.length,
        dedupeMatchesCommittedEvent:
          addedHeaders[0]?.dedupeKey === attemptedEvent?.canonicalEvent.dedupeKey
      }).toEqual({
        mutationStatus: 'rejected',
        mutationCauseIsResponseLoss: true,
        staleContentHash: expect.stringMatching(sha256Hex),
        rollback: {
          revision: before.revision,
          durability: 'failed',
          reasonCode: staleItem?.reasonCode
        },
        durable: {
          stintId: before.identity.stintId,
          revision: before.revision + 1,
          persisted: true,
          durability: 'durable',
          itemStatus: 'manual-confirmed',
          reasonCode,
          contentHash: expect.stringMatching(sha256Hex)
        },
        exported: {
          passportCount: 1,
          revision: before.revision + 1,
          persisted: true,
          durability: 'durable',
          itemStatus: 'manual-confirmed',
          reasonCode,
          contentHash: expect.stringMatching(sha256Hex),
          staleRev1Overlay: false
        },
        live: {
          stintId: before.identity.stintId,
          revision: before.revision + 1,
          persisted: true,
          durability: 'durable',
          itemStatus: 'manual-confirmed',
          reasonCode,
          contentHash: expect.stringMatching(sha256Hex),
          staleRev1Overlay: false
        },
        persistCalls: 1,
        eventDelta: 1,
        addedEventCount: 1,
        dedupeMatchesCommittedEvent: true
      })
    }, 15_000)

    it('[spec-gap] finalizes a recovered close exactly once before restart and new telemetry', async () => {
      const test = harness('close-commit-no-response')
      const before = await persistentCurrent(test)
      const persist = test.client.persistPassport.bind(test.client)
      const responseLoss = Object.assign(
        new Error('response lost after close COMMIT'),
        { code: 'EIO' }
      )
      const persistPassport = vi.fn(async (...args: Parameters<typeof persist>) => {
        const result = await persist(...args)
        if (
          args[1].canonicalEvent.eventType ===
          'ultimate.sim.raceops.passport.stint-closed.v1'
        ) {
          throw responseLoss
        }
        return result
      })
      test.client.persistPassport = persistPassport

      await expect(test.service.closeCurrent('manual')).rejects.toBe(responseLoss)
      expect((test.service as unknown as {
        pendingMutationRecovery?: { kind: string }
      }).pendingMutationRecovery).toMatchObject({ kind: 'passport-persist' })

      const recovered = await test.service.snapshot()
      const recoveredAgain = await test.service.snapshot()
      const closeHeaders = test.store.eventHeaders(before.identity.stintId).filter((header) =>
        header.dedupeKey === persistPassport.mock.calls.find((call) =>
          call[1].canonicalEvent.eventType ===
          'ultimate.sim.raceops.passport.stint-closed.v1'
        )?.[1].canonicalEvent.dedupeKey
      )
      expect(recovered.current).toBeNull()
      expect(recovered.history.filter((passport) =>
        passport.identity.stintId === before.identity.stintId
      )).toEqual([
        expect.objectContaining({
          lifecycle: 'closed',
          closeReason: 'manual',
          interrupted: false,
          persisted: true,
          durability: 'durable'
        })
      ])
      expect(recoveredAgain.history.filter((passport) =>
        passport.identity.stintId === before.identity.stintId
      )).toHaveLength(1)
      expect(closeHeaders).toHaveLength(1)

      await test.service.dispose()
      const restartedStore = new PassportPersistenceEngine({
        path: join(test.dir, 'passport.db'),
        now: () => 40_000
      })
      stores.push(restartedStore)
      const restartedTap = new FakeTap()
      const restartedService = new StintPassportService(
        { ...test.ctx, phase02Tap: restartedTap } as ModuleContext,
        clientFor(restartedStore),
        () => 40_000
      )
      services.push(restartedService)

      const restarted = await restartedService.snapshot()
      expect(restarted.current).toBeNull()
      expect(restarted.history.filter((passport) =>
        passport.identity.stintId === before.identity.stintId
      )).toHaveLength(1)

      await restartedTap.emit(delivery(telemetry('Driver A', 10, 2), 2n))
      const afterTelemetry = await restartedService.snapshot()
      expect(afterTelemetry.current).toMatchObject({
        lifecycle: 'awaiting-checklist',
        persisted: true
      })
      expect(afterTelemetry.current?.identity.stintId).not.toBe(before.identity.stintId)
      expect(afterTelemetry.history.filter((passport) =>
        passport.identity.stintId === before.identity.stintId
      )).toHaveLength(1)
    }, 20_000)

    it.each([
      { startupRead: 'getConfig' as const },
      { startupRead: 'getAuthoritativeState' as const },
      { startupRead: 'getKillSwitch' as const }
    ])(
      '[spec-gap] contains constructor ready rejection from $startupRead and disposes bounded',
      async ({ startupRead }) => {
        const dir = scratch(`constructor-ready-${startupRead}`)
        seedReadinessFiles(dir)
        const tap = new FakeTap()
        const subscriptionDispose = vi.fn()
        const subscribe = tap.subscribe.bind(tap)
        tap.subscribe = vi.fn((...args: Parameters<typeof subscribe>) => {
          const subscription = subscribe(...args)
          return {
            ...subscription,
            dispose: () => {
              subscriptionDispose()
              subscription.dispose()
            }
          }
        })
        const store = new PassportPersistenceEngine({
          path: join(dir, 'passport.db'),
          now: () => 10_000
        })
        stores.push(store)
        const client = clientFor(store)
        const closeStore = client.close.bind(client)
        const close = vi.fn(async () => closeStore())
        client.close = close
        const startupCause = new Error(`${startupRead} constructor readiness failed`)
        const startupFailure = vi.fn(async () => {
          throw startupCause
        })
        const startupMethods = client as unknown as Record<
          'getConfig' | 'getAuthoritativeState' | 'getKillSwitch',
          (...args: unknown[]) => Promise<unknown>
        >
        startupMethods[startupRead] = startupFailure
        const ctx = {
          app: { getPath: () => dir },
          phase02Tap: tap,
          broadcast: vi.fn(),
          registerGracefulTeardown: vi.fn(() => () => undefined)
        } as unknown as ModuleContext
        const unhandledRejections: unknown[] = []
        const onUnhandledRejection = (reason: unknown): void => {
          unhandledRejections.push(reason)
        }
        const listenerCountBefore = process.listenerCount('unhandledRejection')
        let observation: Record<string, unknown> = { setup: 'incomplete' }

        process.on('unhandledRejection', onUnhandledRejection)
        try {
          const service = new StintPassportService(ctx, client, () => 10_000)
          services.push(service)

          await new Promise<void>((resolve) => setImmediate(resolve))

          const snapshotResultPromise = service.snapshot().then(
            (value) => ({ status: 'fulfilled' as const, value }),
            (reason: unknown) => ({ status: 'rejected' as const, reason })
          )
          const disposalResultsPromise = Promise.allSettled([
            service.dispose(),
            service.dispose()
          ])
          let disposalDeadline: ReturnType<typeof setTimeout> | undefined
          const disposalResult = await Promise.race([
            disposalResultsPromise.then((results) => ({
              status: 'settled' as const,
              results
            })),
            new Promise<{ status: 'timed-out' }>((resolve) => {
              disposalDeadline = setTimeout(() => resolve({ status: 'timed-out' }), 250)
            })
          ])
          if (disposalDeadline) clearTimeout(disposalDeadline)
          const snapshotResult = await snapshotResultPromise

          await new Promise<void>((resolve) => setImmediate(resolve))

          const internals = service as unknown as {
            retentionTimer: ReturnType<typeof setInterval> | null
            broadcastTimer: ReturnType<typeof setTimeout> | null
            broadcastScheduled: boolean
          }
          observation = {
            unhandledRejectionCount: unhandledRejections.length,
            unhandledMessages: unhandledRejections.map((reason) =>
              reason instanceof Error ? reason.message : String(reason)
            ),
            snapshotStatus: snapshotResult.status,
            snapshotCauseIsOriginal:
              snapshotResult.status === 'rejected' && snapshotResult.reason === startupCause,
            disposalStatus: disposalResult.status,
            disposalSettlements: disposalResult.status === 'settled'
              ? disposalResult.results.map((result) => result.status)
              : [],
            startupReadCalls: startupFailure.mock.calls.length,
            closeCalls: close.mock.calls.length,
            subscriptionDisposeCalls: subscriptionDispose.mock.calls.length,
            subscriptionEnabled: tap.status().enabled,
            retentionTimer: internals.retentionTimer,
            broadcastTimer: internals.broadcastTimer,
            broadcastScheduled: internals.broadcastScheduled
          }
        } finally {
          process.off('unhandledRejection', onUnhandledRejection)
        }

        expect({
          ...observation,
          listenerCountRestored:
            process.listenerCount('unhandledRejection') === listenerCountBefore
        }).toEqual({
          unhandledRejectionCount: 0,
          unhandledMessages: [],
          snapshotStatus: 'rejected',
          snapshotCauseIsOriginal: true,
          disposalStatus: 'settled',
          disposalSettlements: ['fulfilled', 'fulfilled'],
          startupReadCalls: 1,
          closeCalls: 1,
          subscriptionDisposeCalls: 1,
          subscriptionEnabled: false,
          retentionTimer: null,
          broadcastTimer: null,
          broadcastScheduled: false,
          listenerCountRestored: true
        })
      }
    )
  })

})
