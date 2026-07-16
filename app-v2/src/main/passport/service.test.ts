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
import { DEFAULT_PASSPORT_PRIVACY, type PassportConfig } from '../../shared/stint-passport'
import { telemetrySnapshotToRaceOpsEvent } from '../phase02/telemetry-contract-adapter'
import { PassportPersistenceEngine } from './persistence-engine'
import type { PassportPersistenceClient } from './persistence-client'
import { StintPassportService } from './service'

const dirs: string[] = []
const services: StintPassportService[] = []
const stores: PassportPersistenceEngine[] = []

afterEach(async () => {
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
    'getConfig', 'setConfig', 'getPrivacy', 'setPrivacy', 'getKillSwitch',
    'listRoster', 'saveRoster', 'persistPassport', 'listPassports', 'getPassport',
    'getIntegrity', 'verifyActiveStint', 'purgeRetention', 'deleteByClass',
    'exportPackage', 'logRuntime', 'eventHeaders', 'metricsSnapshot'
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
    test.service.deleteByClass('D3')
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
    await test.service.setPrivacy({
      ...DEFAULT_PASSPORT_PRIVACY,
      identityPersistenceOptIn: true,
      updatedAt: 0
    })
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
})
