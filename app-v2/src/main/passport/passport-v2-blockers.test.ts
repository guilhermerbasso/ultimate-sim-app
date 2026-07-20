/** Adversarial regressions for the five final Stint Passport V2 release blockers. */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
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
  DEFAULT_PASSPORT_CONFIG,
  DEFAULT_PASSPORT_PRIVACY,
  PASSPORT_ITEM_DEFINITIONS,
  passportItemDefinition,
  type PassportConfig,
  type PassportIntegrityState,
  type PassportItem,
  type PassportRosterMember
} from '../../shared/stint-passport'
import type { CanonicalRaceOpsEvent } from '../../shared/phase02-contracts'
import { telemetrySnapshotToRaceOpsEvent } from '../phase02/telemetry-contract-adapter'
import { PassportPersistenceEngine } from './persistence-engine'
import { PassportPersistenceClient } from './persistence-client'
import type { PassportPersistenceClient as IPassportPersistenceClient } from './persistence-client'
import {
  PASSPORT_DOMAIN_ERROR_CODE,
  PASSPORT_HEALTH_ERROR_CODE,
  classifyPersistenceWorkerError,
  persistenceDomainError
} from './persistence-errors'
import {
  PASSPORT_APP_PERSISTENCE_DEADLINE_MS,
  PASSPORT_CLIENT_CLOSE_DEADLINE_MS,
  PASSPORT_PERSISTENCE_WORST_CASE_MS
} from './persistence-deadlines'
import { StintPassportService } from './service'

// ─────────────────────────────────────────────────────────────────────────────
// Shared in-process harness (mirrors the production-shaped pattern in service.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

class FakeTap implements Phase02Tap {
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

  status(): Phase02TapStatus { return { ...this.state } }
  dispose(): void { this.consumer = null }

  async emit(delivery: Phase02TapDelivery): Promise<void> {
    if (!this.consumer || this.state.killSwitch) return
    this.state.accepted += 1
    await this.consumer(delivery)
    this.state.delivered += 1
    this.state.lastDeliveredSequence = delivery.event.sequence
  }
}

/** Thin synchronous adapter so the service uses the real SQLite engine without an IPC worker. */
function clientFor(engine: PassportPersistenceEngine): IPassportPersistenceClient {
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
    'exportPackage', 'verifyImportPackage', 'logRuntime', 'eventHeaders', 'metricsSnapshot',
    'persistLifecycle', 'repairPersistence', 'simulateWorkerCrash'
  ]) {
    client[method] = async (...args: unknown[]) =>
      (engine as unknown as Record<string, (...values: unknown[]) => unknown>)[method]?.(...args)
  }
  return client as unknown as IPassportPersistenceClient
}

const dirs: string[] = []
const services: StintPassportService[] = []
const stores: PassportPersistenceEngine[] = []

afterEach(async () => {
  vi.useRealTimers()
  for (const service of services.splice(0)) await service.dispose().catch(() => undefined)
  for (const store of stores.splice(0)) {
    try { store.close() } catch { /* already closed */ }
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

function scratch(name: string): string {
  const dir = join(process.cwd(), `.blocker-${name}-${process.pid}-${dirs.length}`)
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
    profileStore: {
      loadProfile: vi.fn(async (nameValue: string) => {
        if (nameValue !== 'Endurance') throw new Error('missing')
        return profile
      })
    },
    serialHub: {
      listDevices: () => [{
        id: 'simx', path: 'COM1', label: 'SIM-X',
        kind: 'sim-x', baud: 115200, connected: true
      }]
    },
    broadcast,
    registerGracefulTeardown: vi.fn(() => () => undefined)
  } as unknown as ModuleContext
  let now = 10_000
  const store = new PassportPersistenceEngine({
    path: join(dir, 'passport.db'),
    now: () => now
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
    dir, ctx, tap, store, client, service, broadcast, config,
    setNow(value: number) { now = value }
  }
}

async function configureRoster(test: ReturnType<typeof harness>, driverRef: string): Promise<void> {
  await test.service.setRoster([
    { memberId: driverRef, displayName: 'Driver A', roles: ['driver'], active: true },
    { memberId: 'engineer-1', displayName: 'Engineer A', roles: ['engineer'], active: true },
    { memberId: 'crew-1', displayName: 'Crew A', roles: ['crew-chief'], active: true },
    { memberId: 'spotter-1', displayName: 'Spotter A', roles: ['spotter'], active: true },
    { memberId: 'manager-1', displayName: 'Manager A', roles: ['team-manager'], active: true }
  ])
}

async function persistentCurrent(test: ReturnType<typeof harness>) {
  await test.service.setConfig(test.config)
  await test.tap.emit(delivery(telemetry(), 1n))
  const current = (await test.service.snapshot()).current!
  await configureRoster(test, current.identity.driverRef)
  await test.service.setPrivacy({
    ...DEFAULT_PASSPORT_PRIVACY,
    identityPersistenceOptIn: true,
    updatedAt: 1
  })
  return (await test.service.snapshot()).current!
}

async function preparedPersistentChallenge(test: ReturnType<typeof harness>) {
  const current = await persistentCurrent(test)
  await test.service.resolveItem({
    stintId: current.identity.stintId,
    itemId: 'audio-comms',
    status: 'manual-confirmed',
    owner: { memberId: 'spotter-1', role: 'spotter' },
    reasonCode: 'COMMS_OK'
  })
  const challenge = await test.service.prepareChallenge({
    stintId: current.identity.stintId,
    owner: { memberId: current.identity.driverRef, role: 'driver' }
  })
  const integrity: PassportIntegrityState = {
    state: 'anchored',
    verified: true,
    scope: 'incremental',
    checkedEvents: test.store.eventHeaders(current.identity.stintId).length,
    lastCheckedAt: 10_000,
    message: 'Verified against trusted anchor.'
  }
  test.client.verifyActiveStint = vi.fn(async () => integrity)
  test.client.getIntegrity = vi.fn(async () => integrity)
  return { current, challenge }
}

function outcomeOf<T>(promise: Promise<T>): Promise<'fulfilled' | 'rejected'> {
  return promise.then(() => 'fulfilled' as const, () => 'rejected' as const)
}

// ─────────────────────────────────────────────────────────────────────────────
// FakeWorker for B4 / B5 persistence-client unit tests
// (mirrors the production-shaped pattern in persistence-client.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

interface FakeRequest {
  id: number
  method: string
  args: unknown[]
}

class FakeWorker {
  private messageListeners: Array<(value: unknown) => void> = []
  private errorListeners: Array<(error: Error) => void> = []
  private exitListeners: Array<(code: number) => void> = []
  terminated = false
  requests: FakeRequest[] = []
  /** Set to true in a behavior to suppress the automatic flush/shutdown response. */
  disableAutoResponse = false
  terminateError: Error | undefined
  private readonly completed = new Set<number>()

  constructor(private readonly behavior: (worker: FakeWorker, request: FakeRequest) => void) {}

  postMessage(value: unknown): void {
    const request = value as FakeRequest
    this.requests.push(request)
    this.behavior(this, request)
    if (!this.disableAutoResponse &&
      (request.method === 'flush' || request.method === 'shutdown') &&
      !this.completed.has(request.id)) {
      this.respond(request)
    }
  }

  on(event: 'message' | 'error' | 'exit', listener: (value: any) => void): this {
    if (event === 'message') this.messageListeners.push(listener)
    else if (event === 'error') this.errorListeners.push(listener)
    else this.exitListeners.push(listener)
    return this
  }

  removeAllListeners(): this {
    this.messageListeners = []
    this.errorListeners = []
    this.exitListeners = []
    return this
  }

  async terminate(): Promise<number> {
    this.terminated = true
    if (this.terminateError) throw this.terminateError
    return 0
  }

  respond(request: FakeRequest, result: unknown = true): void {
    this.completed.add(request.id)
    queueMicrotask(() => {
      for (const listener of this.messageListeners) {
        listener({ id: request.id, ok: true, result })
      }
    })
  }

  fail(request: FakeRequest, message: string, code?: string): void {
    this.completed.add(request.id)
    queueMicrotask(() => {
      for (const listener of this.messageListeners) {
        listener({ id: request.id, ok: false, error: message, code })
      }
    })
  }

  crash(code = 91): void {
    queueMicrotask(() => {
      for (const listener of this.exitListeners) listener(code)
    })
  }
}

const fakeClients: PassportPersistenceClient[] = []

afterEach(async () => {
  for (const client of fakeClients.splice(0)) await client.close().catch(() => undefined)
})

function createFakeClient(behaviors: Array<(worker: FakeWorker, request: FakeRequest) => void>) {
  let index = 0
  const workers: FakeWorker[] = []
  const client = new PassportPersistenceClient({
    path: 'passport.db',
    restartDelayMs: 1,
    workerFactory: () => {
      const worker = new FakeWorker(behaviors[Math.min(index, behaviors.length - 1)])
      index += 1
      workers.push(worker)
      return worker as any
    }
  })
  fakeClients.push(client)
  return { client, workers }
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 10))
}

// ─────────────────────────────────────────────────────────────────────────────
// B1 – Privacy evidence class independent of owner/reason metadata
// ─────────────────────────────────────────────────────────────────────────────

describe('B1 – Privacy evidence class scoped deletion', () => {
  it('[blocker-B1-a] D2 deletion redacts D2 evidence without reclassifying D3 owner metadata', async () => {
    const test = harness('B1-d2-owner-erase')
    // Build a D2 item with an owner via manual attestation ('fuel-load' is D2).
    await test.service.setConfig(test.config)
    await test.tap.emit(delivery(telemetry(), 1n))
    const current = (await test.service.snapshot()).current!
    await configureRoster(test, current.identity.driverRef)

    await test.service.resolveItem({
      stintId: current.identity.stintId,
      itemId: 'fuel-load',
      status: 'manual-confirmed',
      owner: { memberId: 'engineer-1', role: 'engineer' },
      reasonCode: 'FUEL_MANUAL_OK'
    })

    // Sanity: owner is present before deletion.
    const before = (await test.service.snapshot()).current!
    expect(before.items.find(i => i.id === 'fuel-load')?.owner).toEqual({
      memberId: 'engineer-1',
      role: 'engineer'
    })

    await test.service.deleteByClass('D2')
    const after = (await test.service.snapshot()).current!

    const item = after.items.find((candidate) => candidate.id === 'fuel-load')!
    expect(item.owner).toEqual({ memberId: 'engineer-1', role: 'engineer' })
    expect(item.reasonCode).toBe('FUEL_MANUAL_OK')
    expect(item.evidence).toBeUndefined()
    expect(item.detail).toMatch(/deleted|removed/i)
  })

  it('[blocker-B1-b] D1 deletion redacts D1 evidence without erasing unrelated D3 metadata', async () => {
    const test = harness('B1-d1-owner-erase')
    await test.service.setConfig(test.config)
    await test.tap.emit(delivery(telemetry(), 1n))
    const current = (await test.service.snapshot()).current!
    await configureRoster(test, current.identity.driverRef)

    // 'audio-comms' is D1 and allows spotter.
    await test.service.resolveItem({
      stintId: current.identity.stintId,
      itemId: 'audio-comms',
      status: 'manual-confirmed',
      owner: { memberId: 'spotter-1', role: 'spotter' },
      reasonCode: 'AUDIO_CHECKED'
    })

    const before = (await test.service.snapshot()).current!
    expect(before.items.find(i => i.id === 'audio-comms')?.owner).toBeDefined()

    await test.service.deleteByClass('D1')
    const after = (await test.service.snapshot()).current!

    const item = after.items.find((candidate) => candidate.id === 'audio-comms')!
    expect(item.owner).toEqual({ memberId: 'spotter-1', role: 'spotter' })
    expect(item.reasonCode).toBe('AUDIO_CHECKED')
    expect(item.evidence).toBeUndefined()
    expect(item.detail).toMatch(/deleted|removed/i)
  })

  it('[blocker-B1-c] deleteByClass(D2) does not disturb D1 or D3 item owners', async () => {
    const test = harness('B1-cross-class-retain')
    await test.service.setConfig(test.config)
    await test.tap.emit(delivery(telemetry(), 1n))
    const current = (await test.service.snapshot()).current!
    await configureRoster(test, current.identity.driverRef)

    // Attest a D1 item (audio-comms) and a D3 item (incoming-driver is D3 but auto-evaluated;
    // use final-acknowledgement indirectly — resolve audio-comms D1 so we can verify D2 deletion
    // doesn't touch it).
    await test.service.resolveItem({
      stintId: current.identity.stintId,
      itemId: 'audio-comms',     // D1
      status: 'manual-confirmed',
      owner: { memberId: 'spotter-1', role: 'spotter' },
      reasonCode: 'AUDIO_D1_OK'
    })
    await test.service.resolveItem({
      stintId: current.identity.stintId,
      itemId: 'fuel-load',       // D2
      status: 'manual-confirmed',
      owner: { memberId: 'engineer-1', role: 'engineer' },
      reasonCode: 'FUEL_D2_OK'
    })

    const beforeD1Owner = (await test.service.snapshot()).current!
      .items.find(i => i.id === 'audio-comms')?.owner

    // D2 deletion must NOT affect D1 owners.
    await test.service.deleteByClass('D2')
    const after = (await test.service.snapshot()).current!

    const audioComms = after.items.find(i => i.id === 'audio-comms')!
    const fuelLoad = after.items.find(i => i.id === 'fuel-load')!

    // D1 item retains its owner after D2 deletion.
    expect(audioComms.owner).toEqual(beforeD1Owner)

    // D3 owner metadata remains until D3 deletion even when D2 evidence is removed.
    expect(fuelLoad.owner).toBeDefined()
    expect(fuelLoad.evidence).toBeUndefined()
  })

  it('[blocker-B1-d] after deleteByClass(D3) and service restart, D3 data is absent from history', async () => {
    const test = harness('B1-d3-restart-clean')
    const current = await persistentCurrent(test)

    // Persist the stint then delete all D3 data.
    await test.service.deleteByClass('D3')

    // Restart: dispose this service and create a new one over the same DB.
    await test.service.dispose()
    services.splice(services.indexOf(test.service), 1)
    stores.splice(stores.indexOf(test.store), 1)

    const restartedStore = new PassportPersistenceEngine({
      path: join(test.dir, 'passport.db'),
      now: () => 30_000
    })
    stores.push(restartedStore)
    const tap2 = new FakeTap()
    const ctx2 = { ...test.ctx, phase02Tap: tap2 } as unknown as ModuleContext
    const restartedService = new StintPassportService(ctx2, clientFor(restartedStore), () => 30_000)
    services.push(restartedService)

    const snapshot = await restartedService.snapshot()

    // After D3 deletion: no current, no history, no roster, opt-out.
    expect(snapshot.current).toBeNull()
    expect(snapshot.history).toEqual([])
    expect(snapshot.roster).toEqual([])
    expect(snapshot.privacy.identityPersistenceOptIn).toBe(false)

    // No passport for the deleted stint ID exists in the store.
    expect(restartedStore.listPassports()).not.toContainEqual(
      expect.objectContaining({ identity: expect.objectContaining({ stintId: current.identity.stintId }) })
    )
  })

  it('[blocker-B1-e] lower-class evidence and events never derive from a retained D3 reason', async () => {
    const test = harness('B1-reason-isolation')
    const current = await persistentCurrent(test)
    await test.service.setPrivacy({
      ...DEFAULT_PASSPORT_PRIVACY,
      identityPersistenceOptIn: true,
      retentionDays: { D1: 90, D2: 90, D3: 1 },
      updatedAt: 2
    })
    const firstReason = 'D3-SENTINEL-ALPHA-DO-NOT-DOWNCLASS'
    const secondReason = 'D3-SENTINEL-BRAVO-DO-NOT-DOWNCLASS'

    await test.service.resolveItem({
      stintId: current.identity.stintId,
      itemId: 'weather-assumption',
      status: 'not-applicable',
      owner: { memberId: 'engineer-1', role: 'engineer' },
      reasonCode: firstReason,
      freeText: firstReason
    })
    const firstItem = (await test.service.snapshot()).current!.items.find(
      (item) => item.id === 'weather-assumption'
    )!
    const firstEvent = (test.store.exportPackage('full-local').canonicalEvents as CanonicalRaceOpsEvent[]).filter(
      (event) => event.eventType === 'ultimate.sim.raceops.passport.item-resolved.v1'
    ).at(-1)!

    await test.service.resolveItem({
      stintId: current.identity.stintId,
      itemId: 'weather-assumption',
      status: 'not-applicable',
      owner: { memberId: 'engineer-1', role: 'engineer' },
      reasonCode: secondReason,
      freeText: secondReason
    })
    const secondItem = (await test.service.snapshot()).current!.items.find(
      (item) => item.id === 'weather-assumption'
    )!
    const secondEvent = (test.store.exportPackage('full-local').canonicalEvents as CanonicalRaceOpsEvent[]).filter(
      (event) => event.eventType === 'ultimate.sim.raceops.passport.item-resolved.v1'
    ).at(-1)!

    expect(firstItem.detail).toBe(secondItem.detail)
    expect(firstItem.evidence?.summary).toBe(secondItem.evidence?.summary)
    expect(firstItem.evidence?.contentHash).toBe(secondItem.evidence?.contentHash)
    expect(firstEvent.facts.filter((fact) => fact.name !== 'passport.state_hash')).toEqual(
      secondEvent.facts.filter((fact) => fact.name !== 'passport.state_hash')
    )
    const stateHashFact = firstEvent.facts.find((fact) => fact.name === 'passport.state_hash')
    expect(stateHashFact?.provenance?.transformId).toBe('passport.state-hash.v3.class-scoped')
    expect(String(stateHashFact?.provenance?.privacyClass)).toMatch(/D2/)
    expect(firstEvent.evidenceRefs).toEqual(secondEvent.evidenceRefs)
    expect(JSON.stringify([firstItem.detail, firstItem.evidence, firstEvent])).not.toContain(firstReason)
    expect(JSON.stringify([secondItem.detail, secondItem.evidence, secondEvent])).not.toContain(secondReason)

    await test.service.closeCurrent('manual')
    const ephemeralHistory = (test.service as unknown as {
      ephemeralHistory: Array<{ items: PassportItem[] }>
    }).ephemeralHistory
    const legacyItem = ephemeralHistory[0].items.find(
      (item) => item.id === 'weather-assumption'
    )!
    legacyItem.owner = undefined
    legacyItem.overrideReason = undefined
    legacyItem.reasonCode = undefined
    legacyItem.detail = firstReason
    const legacyEvidence = legacyItem.evidence!
    legacyItem.evidence = {
      ...legacyEvidence,
      source: 'human-attestation',
      summary: firstReason,
      contentHash: 'e'.repeat(64)
    }
    test.setNow(2 * 86_400_000 + 10_000)
    await test.service.runRetention('explicit')
    const expiredExport = JSON.stringify(await test.service.exportPackage('full-local'))
    expect(expiredExport).not.toContain(firstReason)
    expect(expiredExport).not.toContain(secondReason)

    await test.service.dispose()
    services.splice(services.indexOf(test.service), 1)
    stores.splice(stores.indexOf(test.store), 1)
    const restartedStore = new PassportPersistenceEngine({
      path: join(test.dir, 'passport.db'),
      now: () => 3 * 86_400_000 + 10_000
    })
    stores.push(restartedStore)
    const restarted = new StintPassportService(
      { ...test.ctx, phase02Tap: new FakeTap() } as unknown as ModuleContext,
      clientFor(restartedStore),
      () => 3 * 86_400_000 + 10_000
    )
    services.push(restarted)

    expect(JSON.stringify(await restarted.snapshot())).not.toContain(firstReason)
    const restartedExport = JSON.stringify(await restarted.exportPackage('full-local'))
    expect(restartedExport).not.toContain(firstReason)
    expect(restartedExport).not.toContain(secondReason)
  })

  it.each([
    { label: 'getPrivacy failure', crash: false },
    { label: 'worker crash', crash: true }
  ])('[blocker-B1-f] clears live D3 state before a post-delete $label', async ({ crash }) => {
    const test = harness(`B1-post-delete-${crash ? 'crash' : 'read-failure'}`)
    const current = await persistentCurrent(test)
    const sentinel = `D3-DELETE-SENTINEL-${crash ? 'CRASH' : 'READ'}`
    await test.service.resolveItem({
      stintId: current.identity.stintId,
      itemId: 'incoming-driver',
      status: 'manual-confirmed',
      owner: { memberId: current.identity.driverRef, role: 'driver' },
      reasonCode: sentinel,
      freeText: sentinel
    })
    expect(JSON.stringify(test.store.exportPackage('full-local'))).toContain(sentinel)

    test.client.getPrivacy = vi.fn(async () => {
      if (crash) test.store.close()
      throw new Error(crash ? 'persistence process crashed' : 'post-delete privacy read failed')
    }) as typeof test.client.getPrivacy

    await expect(test.service.deleteByClass('D3')).rejects.toThrow(
      crash ? /crashed/i : /privacy read failed/i
    )
    const snapshot = await test.service.snapshot()
    expect(snapshot.current).toBeNull()
    expect(snapshot.history).toEqual([])
    expect(snapshot.roster).toEqual([])
    expect(snapshot.privacy.identityPersistenceOptIn).toBe(false)
    expect(JSON.stringify(snapshot)).not.toContain(sentinel)
    if (crash) {
      await expect(test.service.exportPackage('full-local')).rejects.toThrow()
    } else {
      expect(JSON.stringify(await test.service.exportPackage('full-local'))).not.toContain(sentinel)
    }
  })

  it('[blocker-B1-g] a stale persistence failure cannot restore D3 state after durable deletion', async () => {
    const test = harness('B1-stale-write-after-delete')
    const current = await persistentCurrent(test)
    let writeStarted!: () => void
    let rejectWrite!: (error: Error) => void
    const started = new Promise<void>((resolve) => { writeStarted = resolve })
    const blockedWrite = new Promise<never>((_, reject) => { rejectWrite = reject })
    test.client.persistPassport = vi.fn(async () => {
      writeStarted()
      return blockedWrite
    }) as typeof test.client.persistPassport

    const mutation = outcomeOf(test.service.resolveItem({
      stintId: current.identity.stintId,
      itemId: 'fuel-load',
      status: 'manual-confirmed',
      owner: { memberId: 'engineer-1', role: 'engineer' },
      reasonCode: 'D3-STALE-ROLLBACK-SENTINEL'
    }))
    await started
    await test.service.deleteByClass('D3')
    rejectWrite(new Error('queued write rejected after privacy deletion'))
    expect(await mutation).toBe('rejected')

    const snapshot = await test.service.snapshot()
    expect(snapshot.current).toBeNull()
    expect(snapshot.history).toEqual([])
    expect(snapshot.roster).toEqual([])
    expect(snapshot.privacy.identityPersistenceOptIn).toBe(false)
    expect(JSON.stringify(snapshot)).not.toContain('D3-STALE-ROLLBACK-SENTINEL')
    expect((test.service as unknown as {
      ambiguousMutations: Map<string, unknown>
    }).ambiguousMutations.size).toBe(0)
  })

  it('[blocker-B1-h] a delayed roster save cannot republish D3 data after deletion', async () => {
    const test = harness('B1-stale-roster-after-delete')
    await persistentCurrent(test)
    let saveStarted!: () => void
    let resolveSave!: (value: PassportRosterMember[]) => void
    const started = new Promise<void>((resolve) => { saveStarted = resolve })
    const blockedSave = new Promise<PassportRosterMember[]>((resolve) => { resolveSave = resolve })
    const candidate: PassportRosterMember[] = [{
      memberId: 'D3-STALE-ROSTER-SENTINEL',
      displayName: 'D3 stale roster sentinel',
      roles: ['driver'],
      active: true
    }]
    test.client.saveRoster = vi.fn(async () => {
      saveStarted()
      return blockedSave
    }) as typeof test.client.saveRoster

    const mutation = outcomeOf(test.service.setRoster(candidate))
    await started
    await test.service.deleteByClass('D3')
    resolveSave(candidate)

    expect(await mutation).toBe('rejected')
    const snapshot = await test.service.snapshot()
    expect(snapshot.current).toBeNull()
    expect(snapshot.roster).toEqual([])
    expect(snapshot.privacy.identityPersistenceOptIn).toBe(false)
    expect(JSON.stringify(await test.service.exportPackage('full-local')))
      .not.toContain('D3-STALE-ROSTER-SENTINEL')
  })

  it('[blocker-B1-i] delayed automatic roster seeding cannot recreate a stint after deletion', async () => {
    const test = harness('B1-stale-seed-after-delete')
    await test.service.setPrivacy({
      ...DEFAULT_PASSPORT_PRIVACY,
      identityPersistenceOptIn: true,
      updatedAt: 1
    })
    let saveStarted!: () => void
    let resolveSave!: (value: PassportRosterMember[]) => void
    let savedCandidate: PassportRosterMember[] = []
    const started = new Promise<void>((resolve) => { saveStarted = resolve })
    const blockedSave = new Promise<PassportRosterMember[]>((resolve) => { resolveSave = resolve })
    test.client.saveRoster = vi.fn(async (candidate: PassportRosterMember[]) => {
      savedCandidate = candidate
      saveStarted()
      return blockedSave
    }) as typeof test.client.saveRoster

    const liveStart = outcomeOf(test.tap.emit(delivery(
      telemetry('D3-AUTO-SEED-SENTINEL', 77),
      1n
    )))
    await started
    await test.service.deleteByClass('D3')
    resolveSave(savedCandidate)

    expect(await liveStart).toBe('rejected')
    const snapshot = await test.service.snapshot()
    expect(snapshot.current).toBeNull()
    expect(snapshot.roster).toEqual([])
    expect(snapshot.history).toEqual([])
    expect(snapshot.privacy.identityPersistenceOptIn).toBe(false)
    expect(JSON.stringify(await test.service.exportPackage('full-local')))
      .not.toContain('D3-AUTO-SEED-SENTINEL')
  })

  it('[blocker-B1-j] a delayed privacy roster save cannot restore a deleted prior stint', async () => {
    const test = harness('B1-stale-privacy-roster-after-delete')
    await test.service.snapshot()
    await test.tap.emit(delivery(telemetry('D3-OLD-DRIVER-SENTINEL', 10), 1n))
    let saveStarted!: () => void
    let resolveFirstSave!: (value: PassportRosterMember[]) => void
    let firstCandidate: PassportRosterMember[] = []
    let saveCalls = 0
    const started = new Promise<void>((resolve) => { saveStarted = resolve })
    const blockedSave = new Promise<PassportRosterMember[]>((resolve) => {
      resolveFirstSave = resolve
    })
    const saveRoster = test.client.saveRoster.bind(test.client)
    test.client.saveRoster = vi.fn(async (candidate: PassportRosterMember[]) => {
      saveCalls += 1
      if (saveCalls === 1) {
        firstCandidate = candidate
        saveStarted()
        return blockedSave
      }
      return saveRoster(candidate)
    }) as typeof test.client.saveRoster

    const staleEnable = outcomeOf(test.service.setPrivacy({
      ...DEFAULT_PASSPORT_PRIVACY,
      identityPersistenceOptIn: true,
      updatedAt: 1
    }))
    await started
    await test.service.deleteByClass('D3')
    await test.tap.emit(delivery(telemetry('D3-NEW-DRIVER-SENTINEL', 20, 1), 2n))
    await test.service.setPrivacy({
      ...DEFAULT_PASSPORT_PRIVACY,
      identityPersistenceOptIn: true,
      updatedAt: 2
    })
    const authoritative = (await test.service.snapshot()).current!
    expect(authoritative.identity.driverLabel).toBe('D3-NEW-DRIVER-SENTINEL')

    const persistPassport = test.client.persistPassport.bind(test.client)
    const stalePersist = vi.fn(async () => {
      throw new Error('stale privacy flow must not persist')
    })
    test.client.persistPassport = stalePersist as typeof test.client.persistPassport
    resolveFirstSave(firstCandidate)
    expect(await staleEnable).toBe('rejected')
    expect(await staleEnable).toBe('rejected')
    expect(stalePersist).not.toHaveBeenCalled()
    test.client.persistPassport = persistPassport
    const snapshot = await test.service.snapshot()
    expect(snapshot.current?.identity.stintId).toBe(authoritative.identity.stintId)
    expect(snapshot.current?.identity.driverLabel).toBe('D3-NEW-DRIVER-SENTINEL')
    expect(JSON.stringify(await test.service.exportPackage('full-local')))
      .not.toContain('D3-OLD-DRIVER-SENTINEL')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// B2 – Challenge CAS: verifyActiveStint race must not restore/revert newer state
// ─────────────────────────────────────────────────────────────────────────────

describe('B2 – Challenge CAS race after verifyActiveStint', () => {
  it('[blocker-B2-a] a resolveItem racing with verifyActiveStint is not overwritten by completeChallenge', async () => {
    const test = harness('B2-resolve-verify-race')
    const { current, challenge } = await preparedPersistentChallenge(test)

    // Capture the trusted-integrity result that was set up in preparedPersistentChallenge.
    const trustedIntegrity: PassportIntegrityState = {
      state: 'anchored',
      verified: true,
      scope: 'incremental',
      checkedEvents: 1,
      lastCheckedAt: 10_000,
      message: 'Verified.'
    }

    // Replace verifyActiveStint so that, while completeChallenge is awaiting it,
    // a concurrent resolveItem modifies this.current and clears the challenge.
    test.client.verifyActiveStint = vi.fn(async () => {
      // This executes inside completeChallenge's await – after the pre-check but
      // before completeChallenge writes back to this.current.
      await test.service.resolveItem({
        stintId: current.identity.stintId,
        itemId: 'fuel-load',
        status: 'manual-confirmed',
        owner: { memberId: 'engineer-1', role: 'engineer' },
        reasonCode: 'FUEL_CONCURRENT_RACE'
      })
      return trustedIntegrity
    })

    const completionOutcome = await outcomeOf(
      test.service.completeChallenge({
        stintId: current.identity.stintId,
        challengeId: challenge.challengeId,
        response: challenge.nonce,
        owner: { memberId: current.identity.driverRef, role: 'driver' }
      })
    )

    const snapshot = await test.service.snapshot()
    const fuelLoad = snapshot.current?.items.find(i => i.id === 'fuel-load')

    expect(completionOutcome).toBe('rejected')
    expect(fuelLoad?.status).toBe('manual-confirmed')
    expect(fuelLoad?.reasonCode).toBe('FUEL_CONCURRENT_RACE')
  })

  it('[blocker-B2-b] a replay boundary racing with verifyActiveStint is not overwritten by completeChallenge', async () => {
    const test = harness('B2-replay-verify-race')
    const { current, challenge } = await preparedPersistentChallenge(test)

    const trustedIntegrity: PassportIntegrityState = {
      state: 'anchored',
      verified: true,
      scope: 'incremental',
      checkedEvents: 1,
      lastCheckedAt: 10_000,
      message: 'Verified.'
    }

    // While completeChallenge awaits verifyActiveStint, emit a replay-context telemetry
    // event that triggers a boundary close (clears current and increments generation).
    test.client.verifyActiveStint = vi.fn(async () => {
      const replaySnap = telemetry('Driver A', 10, 2)
      replaySnap.replayContext = {
        ...replaySnap.replayContext!,
        state: 'replay',
        reason: 'replay-playing',
        active: true
      }
      await test.tap.emit(delivery(replaySnap, 2n))
      return trustedIntegrity
    })

    const completionOutcome = await outcomeOf(
      test.service.completeChallenge({
        stintId: current.identity.stintId,
        challengeId: challenge.challengeId,
        response: challenge.nonce,
        owner: { memberId: current.identity.driverRef, role: 'driver' }
      })
    )

    const snapshot = await test.service.snapshot()

    expect(completionOutcome).toBe('rejected')
    expect(snapshot.current).toBeNull()
  })

  it('[blocker-B2-c] a telemetry update racing with verification remains authoritative', async () => {
    const test = harness('B2-update-verify-race')
    const { current, challenge } = await preparedPersistentChallenge(test)
    const trustedIntegrity: PassportIntegrityState = {
      state: 'anchored',
      verified: true,
      scope: 'incremental',
      checkedEvents: 1,
      lastCheckedAt: 10_000,
      message: 'Verified.'
    }
    test.client.verifyActiveStint = vi.fn(async () => {
      const changed = telemetry('Driver A', 10, 2)
      changed.fuelLiters = 10
      await test.tap.emit(delivery(changed, 2n))
      return trustedIntegrity
    })

    await expect(test.service.completeChallenge({
      stintId: current.identity.stintId,
      challengeId: challenge.challengeId,
      response: challenge.nonce,
      owner: { memberId: current.identity.driverRef, role: 'driver' }
    })).rejects.toThrow(/superseded/i)

    const snapshot = await test.service.snapshot()
    expect(snapshot.current?.items.find((item) => item.id === 'fuel-load')?.status).toBe('mismatch')
    expect(snapshot.current?.lifecycle).toBe('awaiting-checklist')
  })

  it('[blocker-B2-d] a replacement stint racing with verification is never replaced by stale Ready', async () => {
    const test = harness('B2-replace-verify-race')
    const { current, challenge } = await preparedPersistentChallenge(test)
    const trustedIntegrity: PassportIntegrityState = {
      state: 'anchored',
      verified: true,
      scope: 'incremental',
      checkedEvents: 1,
      lastCheckedAt: 10_000,
      message: 'Verified.'
    }
    test.client.verifyActiveStint = vi.fn(async () => {
      await test.tap.emit(delivery(telemetry('Driver B', 11, 2), 2n))
      return trustedIntegrity
    })

    await expect(test.service.completeChallenge({
      stintId: current.identity.stintId,
      challengeId: challenge.challengeId,
      response: challenge.nonce,
      owner: { memberId: current.identity.driverRef, role: 'driver' }
    })).rejects.toThrow(/superseded|no longer current/i)

    const snapshot = await test.service.snapshot()
    expect(snapshot.current?.identity.stintId).not.toBe(current.identity.stintId)
    expect(snapshot.current?.identity.driverLabel).toBe('Driver B')
    expect(snapshot.current?.lifecycle).not.toBe('ready')
  })

  it.each(['close', 'disconnect', 'replay'] as const)(
    '[blocker-B2-e] a blocked verification cannot write Ready after a concurrent %s boundary starts',
    async (mode) => {
      const test = harness(`B2-${mode}-lifecycle-fence`)
      const { current, challenge } = await preparedPersistentChallenge(test)
      const trustedIntegrity: PassportIntegrityState = {
        state: 'anchored',
        verified: true,
        scope: 'incremental',
        checkedEvents: 1,
        lastCheckedAt: 10_000,
        message: 'Verified.'
      }
      let verificationStarted!: () => void
      let releaseVerification!: () => void
      const verificationStart = new Promise<void>((resolve) => { verificationStarted = resolve })
      const verificationBarrier = new Promise<void>((resolve) => { releaseVerification = resolve })
      test.client.verifyActiveStint = vi.fn(async () => {
        verificationStarted()
        await verificationBarrier
        return trustedIntegrity
      })

      let closePersistStarted!: () => void
      let releaseClosePersist!: () => void
      const closePersistStart = new Promise<void>((resolve) => { closePersistStarted = resolve })
      const closePersistBarrier = new Promise<void>((resolve) => { releaseClosePersist = resolve })
      const originalPersist = test.client.persistPassport
      const attemptedLifecycles: string[] = []
      test.client.persistPassport = vi.fn(async (
        ...args: Parameters<typeof test.client.persistPassport>
      ) => {
        const [candidate] = args
        attemptedLifecycles.push(candidate.lifecycle)
        if (candidate.lifecycle === 'closed' || candidate.lifecycle === 'interrupted') {
          closePersistStarted()
          await closePersistBarrier
        }
        return originalPersist(...args)
      }) as typeof test.client.persistPassport

      const completion = test.service.completeChallenge({
        stintId: current.identity.stintId,
        challengeId: challenge.challengeId,
        response: challenge.nonce,
        owner: { memberId: current.identity.driverRef, role: 'driver' }
      })
      await verificationStart

      let lifecycle: Promise<unknown>
      if (mode === 'close') {
        lifecycle = test.service.closeCurrent('manual')
      } else if (mode === 'disconnect') {
        lifecycle = test.tap.emit(delivery(null, 2n))
      } else {
        const replay = telemetry('Driver A', 10, 2)
        replay.replayContext = {
          ...replay.replayContext!,
          state: 'replay',
          reason: 'replay-playing',
          active: true
        }
        lifecycle = test.tap.emit(delivery(replay, 2n))
      }
      await closePersistStart
      const terminalLifecycle = mode === 'close' ? 'closed' : 'interrupted'
      expect((await test.service.snapshot()).current?.lifecycle).toBe(terminalLifecycle)

      releaseVerification()
      const completionOutcome = await outcomeOf(completion)
      releaseClosePersist()
      await lifecycle

      expect(completionOutcome).toBe('rejected')
      expect(attemptedLifecycles).toEqual([terminalLifecycle])
      expect(test.store.getPassport(current.identity.stintId)?.lifecycle).toBe(terminalLifecycle)
      expect((await test.service.snapshot()).current).toBeNull()
    }
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// B3 – Roster candidate persist-before-live-swap
// ─────────────────────────────────────────────────────────────────────────────

describe('B3 – Roster persist-before-live-swap', () => {
  it('[blocker-B3-a] a failed saveRoster reverts to the previous roster without exposing the candidate', async () => {
    const test = harness('B3-roster-revert')
    await test.service.setConfig(test.config)
    await test.tap.emit(delivery(telemetry(), 1n))
    const current = (await test.service.snapshot()).current!
    await configureRoster(test, current.identity.driverRef)

    // Enable persistence so setRoster calls saveRoster.
    await test.service.setPrivacy({
      ...DEFAULT_PASSPORT_PRIVACY,
      identityPersistenceOptIn: true,
      updatedAt: 1
    })

    const previousRoster = (await test.service.snapshot()).roster

    // Force saveRoster to fail.
    test.client.saveRoster = vi.fn(async () => {
      throw new Error('saveRoster write rejected')
    }) as typeof test.client.saveRoster

    const newRosterCandidate = [
      { memberId: current.identity.driverRef, displayName: 'Driver A', roles: ['driver' as const], active: true },
      { memberId: 'new-engineer', displayName: 'New Engineer', roles: ['engineer' as const], active: true }
    ]

    await expect(test.service.setRoster(newRosterCandidate)).rejects.toThrow(/saveRoster write rejected/)

    const afterSnapshot = await test.service.snapshot()

    expect(afterSnapshot.roster.map(m => m.memberId).sort()).toEqual(
      previousRoster.map(m => m.memberId).sort()
    )
  })

  it('[blocker-B3-b] a failed saveRoster preserves existing attestations as active', async () => {
    const test = harness('B3-attestation-preserve')
    await test.service.setConfig(test.config)
    await test.tap.emit(delivery(telemetry(), 1n))
    const current = (await test.service.snapshot()).current!
    await configureRoster(test, current.identity.driverRef)

    await test.service.setPrivacy({
      ...DEFAULT_PASSPORT_PRIVACY,
      identityPersistenceOptIn: true,
      updatedAt: 1
    })

    // Establish a manual attestation ('audio-comms' attested by spotter-1).
    await test.service.resolveItem({
      stintId: current.identity.stintId,
      itemId: 'audio-comms',
      status: 'manual-confirmed',
      owner: { memberId: 'spotter-1', role: 'spotter' },
      reasonCode: 'COMMS_PRE_ROSTER_CHANGE'
    })

    expect(
      (await test.service.snapshot()).current?.items.find(i => i.id === 'audio-comms')?.status
    ).toBe('manual-confirmed')

    // Force saveRoster to fail on the next call.
    test.client.saveRoster = vi.fn(async () => {
      throw new Error('roster write failed')
    }) as typeof test.client.saveRoster

    // Attempt a roster swap that includes the original spotter so invalidation would not apply,
    // but saveRoster fails before any state is committed.
    await expect(test.service.setRoster([
      { memberId: current.identity.driverRef, displayName: 'Driver A', roles: ['driver' as const], active: true },
      { memberId: 'spotter-1', displayName: 'Spotter A', roles: ['spotter' as const], active: true },
      { memberId: 'engineer-1', displayName: 'Engineer A', roles: ['engineer' as const], active: true }
    ])).rejects.toThrow()

    const afterSnapshot = await test.service.snapshot()
    const audioComms = afterSnapshot.current?.items.find(i => i.id === 'audio-comms')

    expect(audioComms?.status).toBe('manual-confirmed')
    expect(audioComms?.owner).toEqual({ memberId: 'spotter-1', role: 'spotter' })
  })

  it('[blocker-B3-c] failed saveRoster during restart step does not activate the candidate roster', async () => {
    const test = harness('B3-restart-fail')
    const current = await persistentCurrent(test)

    // Attest a D1 item so we can verify it is still valid after the failed swap.
    await test.service.resolveItem({
      stintId: current.identity.stintId,
      itemId: 'audio-comms',
      status: 'manual-confirmed',
      owner: { memberId: 'spotter-1', role: 'spotter' },
      reasonCode: 'COMMS_RESTART_STEP'
    })

    const snapshotBeforeSwap = await test.service.snapshot()
    const prevRosterIds = snapshotBeforeSwap.roster.map(m => m.memberId).sort()

    // Disable the underlying engine's saveRoster so any subsequent saveRoster call fails.
    test.client.saveRoster = vi.fn(async () => {
      throw new Error('restart step roster write failed')
    }) as typeof test.client.saveRoster

    // A setRoster call that would change the roster must not activate the candidate on failure.
    await expect(test.service.setRoster([
      { memberId: 'completely-new-driver', displayName: 'New Driver', roles: ['driver' as const], active: true }
    ])).rejects.toThrow()

    expect((await test.service.snapshot()).roster.map(m => m.memberId).sort()).toEqual(prevRosterIds)

    await test.service.dispose()
    services.splice(services.indexOf(test.service), 1)
    stores.splice(stores.indexOf(test.store), 1)
    const restartedStore = new PassportPersistenceEngine({
      path: join(test.dir, 'passport.db'),
      now: () => 30_000
    })
    stores.push(restartedStore)
    const tap = new FakeTap()
    const restarted = new StintPassportService(
      { ...test.ctx, phase02Tap: tap } as unknown as ModuleContext,
      clientFor(restartedStore),
      () => 30_000
    )
    services.push(restarted)
    const restartedSnapshot = await restarted.snapshot()

    expect(restartedSnapshot.roster.map(m => m.memberId).sort()).toEqual(prevRosterIds)
    expect(restartedSnapshot.roster.some(m => m.memberId === 'completely-new-driver')).toBe(false)
    const recovered = restartedSnapshot.history.find((passport) =>
      passport.identity.stintId === current.identity.stintId
    )
    expect(recovered?.items.find(i => i.id === 'audio-comms')?.status).toBe('manual-confirmed')
  })

  it('[blocker-B3-d] automatic driver seeding publishes only a durably saved immutable roster', async () => {
    const test = harness('B3-automatic-seed-failure')
    const current = await persistentCurrent(test)
    const previousRoster = (await test.service.snapshot()).roster.filter(
      (member) => member.memberId !== current.identity.driverRef
    )
    await test.service.setRoster(previousRoster)
    await test.service.resolveItem({
      stintId: current.identity.stintId,
      itemId: 'audio-comms',
      status: 'manual-confirmed',
      owner: { memberId: 'spotter-1', role: 'spotter' },
      reasonCode: 'COMMS_BEFORE_AUTOMATIC_SEED'
    })
    await test.service.closeCurrent('manual')

    const durableBefore = test.store.listRoster()
    const previousIds = previousRoster.map((member) => member.memberId).sort()
    const originalPersistedSave = test.client.saveRoster
    test.client.saveRoster = vi.fn(async (candidate: readonly PassportRosterMember[]) => {
      expect(Object.isFrozen(candidate)).toBe(true)
      expect(candidate.every((member) =>
        Object.isFrozen(member) && Object.isFrozen(member.roles)
      )).toBe(true)
      expect(candidate.some((member) => member.memberId === current.identity.driverRef)).toBe(true)
      throw new Error('automatic roster seed write failed')
    }) as typeof originalPersistedSave

    await expect(test.tap.emit(delivery(telemetry('Driver A', 10, 2), 2n)))
      .rejects.toThrow(/automatic roster seed write failed/i)

    const failedSnapshot = await test.service.snapshot()
    expect(failedSnapshot.current).toBeNull()
    expect(failedSnapshot.roster.map((member) => member.memberId).sort()).toEqual(previousIds)
    expect(test.store.listRoster()).toEqual(durableBefore)
    const priorStint = failedSnapshot.history.find(
      (passport) => passport.identity.stintId === current.identity.stintId
    )
    expect(priorStint?.items.find((item) => item.id === 'audio-comms')?.status)
      .toBe('manual-confirmed')

    await test.service.dispose()
    services.splice(services.indexOf(test.service), 1)
    stores.splice(stores.indexOf(test.store), 1)
    const restartedStore = new PassportPersistenceEngine({
      path: join(test.dir, 'passport.db'),
      now: () => 30_000
    })
    stores.push(restartedStore)
    const restarted = new StintPassportService(
      { ...test.ctx, phase02Tap: new FakeTap() } as unknown as ModuleContext,
      clientFor(restartedStore),
      () => 30_000
    )
    services.push(restarted)
    const restartedSnapshot = await restarted.snapshot()

    expect(restartedSnapshot.roster.map((member) => member.memberId).sort()).toEqual(previousIds)
    expect(restartedStore.listRoster()).toEqual(durableBefore)
    expect(restartedSnapshot.history.find(
      (passport) => passport.identity.stintId === current.identity.stintId
    )?.items.find((item) => item.id === 'audio-comms')?.status).toBe('manual-confirmed')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// B4 – Teardown deadlines fit strictly under the app quit deadline
// ─────────────────────────────────────────────────────────────────────────────

describe('B4 – Teardown deadline fitness', () => {
  it('[blocker-B4-a] source-bound nested deadlines fit strictly inside the app budget', () => {
    expect(PASSPORT_CLIENT_CLOSE_DEADLINE_MS)
      .toBeLessThan(PASSPORT_APP_PERSISTENCE_DEADLINE_MS)
    expect(PASSPORT_PERSISTENCE_WORST_CASE_MS)
      .toBeLessThan(PASSPORT_APP_PERSISTENCE_DEADLINE_MS)
  })

  it('[blocker-B4-b] a timed-out close drain terminates the worker and reports non-success', async () => {
    vi.useFakeTimers()

    // Worker responds to initialize but never responds to flush (stuck drain).
    const { client, workers } = createFakeClient([
      (worker, request) => {
        if (request.method === 'initialize') {
          worker.respond(request)
        } else {
          // Suppress the FakeWorker auto-response for flush/shutdown so the drain
          // never completes and the CLOSE_DEADLINE_MS timeout must fire.
          worker.disableAutoResponse = true
        }
      }
    ])

    // Let the initialize microtask and response run before starting the close.
    await vi.advanceTimersByTimeAsync(1)

    let closeError: unknown
    const closeSettled = client.close().catch((error) => { closeError = error })

    await vi.advanceTimersByTimeAsync(PASSPORT_CLIENT_CLOSE_DEADLINE_MS + 1)
    await closeSettled

    // The worker MUST be explicitly terminated when the drain times out.
    expect(workers[0].terminated).toBe(true)
    // The close promise MUST reject with a non-success (timeout) error.
    expect(closeError).toBeInstanceOf(Error)
    expect((closeError as Error).message).toMatch(/drain timed out/i)

    vi.useRealTimers()
  }, 10_000)

  it('[blocker-B4-c] a failed explicit worker termination is surfaced by close', async () => {
    vi.useFakeTimers()
    const { client, workers } = createFakeClient([
      (worker, request) => {
        if (request.method === 'initialize') worker.respond(request)
        else worker.disableAutoResponse = true
      }
    ])
    workers[0].terminateError = new Error('worker termination did not settle')
    await vi.advanceTimersByTimeAsync(1)

    let closeError: unknown
    const closed = client.close().catch((error) => { closeError = error })
    await vi.advanceTimersByTimeAsync(PASSPORT_CLIENT_CLOSE_DEADLINE_MS + 1)
    await closed
    expect(closeError).toBeInstanceOf(Error)
    expect((closeError as Error).message).toMatch(/worker did not settle|termination did not settle/i)
    expect(workers[0].terminated).toBe(true)
    vi.useRealTimers()
  })

  it('[blocker-B4-d] close surfaces a failed termination from an earlier crashed worker', async () => {
    const { client, workers } = createFakeClient([
      (worker, request) => worker.respond(request)
    ])
    await settle()
    workers[0].terminateError = new Error('crashed worker termination did not settle')
    workers[0].crash()
    await settle()

    await expect(client.close()).rejects.toThrow(/termination did not settle/i)
    expect(workers).toHaveLength(2)
    expect(workers.every((worker) => worker.terminated)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// B5 – Validation / import errors do not count toward / open the circuit breaker
// ─────────────────────────────────────────────────────────────────────────────

describe('B5 – Validation errors must not open the circuit breaker', () => {
  it('[blocker-B5-a] repeated worker-returned business errors do not increment the failure counter', async () => {
    // The worker correctly rejects every non-initialize call with {ok: false}.
    // These are valid worker responses (worker is healthy; the requests are invalid).
    const { client } = createFakeClient([
      (worker, request) => {
        if (request.method === 'initialize') worker.respond(request)
        else worker.fail(
          request,
          `business error: ${request.method} rejected by validation`,
          PASSPORT_DOMAIN_ERROR_CODE
        )
      }
    ])
    await settle()

    // Fire more than FAILURE_THRESHOLD (3) calls that all receive validation rejections.
    await Promise.allSettled([
      client.getConfig(),
      client.getConfig(),
      client.getConfig(),
      client.getConfig()
    ])

    const state = client.status()
    expect(state.state).not.toBe('open-circuit')
    expect(state.failures).toBe(0)
  })

  it('[blocker-B5-b] real storage worker errors DO count toward the failure threshold and open the circuit', async () => {
    // Worker correctly initializes but returns real storage errors for subsequent requests.
    // Unlike business validation errors, these represent actual infra failures.
    const { client } = createFakeClient([
      (worker, request) => {
        if (request.method === 'initialize') worker.respond(request)
        else worker.fail(
          request,
          'disk I/O error: storage unavailable',
          PASSPORT_HEALTH_ERROR_CODE
        )
      }
    ])
    await settle()

    // Three consecutive real storage failures should open the circuit.
    for (let i = 0; i < 3; i += 1) {
      await client.getConfig().catch(() => undefined)
    }

    // After the fix, real infra failures must still accumulate toward the threshold.
    // This test verifies the fix does not accidentally suppress all error counting.
    expect(client.status().state).toBe('open-circuit')
  })

  it('[blocker-B5-c] an import validation error does not open the circuit after repeated calls', async () => {
    // verifyImportPackage returning {ok: false} = malformed user-supplied data.
    // This must NOT contribute to the circuit-open failure count.
    const { client } = createFakeClient([
      (worker, request) => {
        if (request.method === 'initialize') worker.respond(request)
        else if (request.method === 'verifyImportPackage') {
          worker.fail(
            request,
            'import validation failed: contractVersion missing',
            PASSPORT_DOMAIN_ERROR_CODE
          )
        } else {
          worker.respond(request, DEFAULT_PASSPORT_CONFIG)
        }
      }
    ])
    await settle()

    // Attempt four malformed imports (exceeds the FAILURE_THRESHOLD of 3).
    for (let i = 0; i < 4; i += 1) {
      await client.verifyImportPackage({ notAValidPackage: true }).catch(() => undefined)
    }

    const state = client.status()
    expect(state.state).not.toBe('open-circuit')

    expect(state.failures).toBe(0)
    await expect(client.getConfig()).resolves.toEqual(DEFAULT_PASSPORT_CONFIG)
  })

  it('[blocker-B5-d] worker error classification is explicit-domain and otherwise fail-closed', () => {
    expect(classifyPersistenceWorkerError(persistenceDomainError('invalid import')))
      .toBe(PASSPORT_DOMAIN_ERROR_CODE)
    expect(classifyPersistenceWorkerError(new Error('unexpected worker exception')))
      .toBe(PASSPORT_HEALTH_ERROR_CODE)
  })
})
