import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PASSPORT_PRIVACY } from '../../shared/stint-passport'
import { PassportPersistenceClient } from './persistence-client'
import {
  buildPassportWorkerTestFixture,
  type PassportWorkerTestFixture
} from './passport-worker-test-fixture'

interface Request {
  id: number
  method: string
  args: unknown[]
}

class FakeWorker {
  private messageListeners: Array<(value: unknown) => void> = []
  private errorListeners: Array<(error: Error) => void> = []
  private exitListeners: Array<(code: number) => void> = []
  terminated = false
  requests: Request[] = []
  private readonly completed = new Set<number>()

  constructor(private readonly behavior: (worker: FakeWorker, request: Request) => void) {}

  postMessage(value: unknown): void {
    const request = value as Request
    this.requests.push(request)
    this.behavior(this, request)
    if ((request.method === 'flush' || request.method === 'shutdown') &&
      !this.completed.has(request.id)) {
      this.respond(request)
    }
  }

  on(event: 'message' | 'error' | 'exit', listener: ((value: any) => void)): this {
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
    return 0
  }

  respond(request: Request, result: unknown = true): void {
    this.completed.add(request.id)
    queueMicrotask(() => {
      for (const listener of this.messageListeners) {
        listener({ id: request.id, ok: true, result })
      }
    })
  }

  fail(request: Request, message: string, code?: string): void {
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

const clients: PassportPersistenceClient[] = []

afterEach(async () => {
  vi.useRealTimers()
  for (const client of clients.splice(0)) await client.close().catch(() => undefined)
})

function createClient(behaviors: Array<(worker: FakeWorker, request: Request) => void>) {
  let index = 0
  const workers: FakeWorker[] = []
  const client = new PassportPersistenceClient({
    path: 'passport-v2.db',
    restartDelayMs: 1,
    workerFactory: () => {
      const worker = new FakeWorker(behaviors[Math.min(index, behaviors.length - 1)])
      index += 1
      workers.push(worker)
      return worker as any
    }
  })
  clients.push(client)
  return { client, workers }
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 5))
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Client condition timed out.')
    await settle()
  }
}

describe('PassportPersistenceClient failure domain', () => {
  it('enforces bounded queue backpressure while a worker request is stalled', async () => {
    const { client } = createClient([
      (worker, request) => {
        if (request.method === 'initialize') worker.respond(request)
      }
    ])
    await settle()
    const requests = Array.from({ length: 40 }, () => client.getConfig().catch((error) => error))
    const results = await Promise.all(requests.map(async (request, index) =>
      index < 35 ? Promise.race([request, Promise.resolve('pending')]) : request
    ))
    expect(results.some((result) =>
      result instanceof Error && /backpressure/i.test(result.message)
    )).toBe(true)
    expect(client.status().queued).toBeLessThanOrEqual(32)
  })

  it('restarts after utility-worker crash without blocking the main caller', async () => {
    const { client, workers } = createClient([
      (worker, request) => {
        if (request.method === 'initialize') worker.respond(request)
        else worker.crash()
      },
      (worker, request) => {
        if (request.method === 'initialize') worker.respond(request)
        else if (request.method === 'getPrivacy') worker.respond(request, DEFAULT_PASSPORT_PRIVACY)
      }
    ])
    await settle()
    await expect(client.getConfig()).rejects.toThrow(/exited/i)
    await settle()
    await expect(client.getPrivacy()).resolves.toEqual(DEFAULT_PASSPORT_PRIVACY)
    expect(workers.length).toBeGreaterThanOrEqual(2)
    expect(client.status().restarts).toBeGreaterThanOrEqual(1)
  })

  it('honors kill switch while allowing privacy/lifecycle bypass requests', async () => {
    const { client } = createClient([
      (worker, request) => {
        if (request.method === 'initialize') worker.respond(request)
        else if (request.method === 'setPrivacy') worker.respond(request, request.args[0])
        else worker.respond(request, true)
      }
    ])
    await settle()
    client.setKillSwitch(true)
    await expect(client.getConfig()).rejects.toThrow(/kill switch/i)
    await expect(client.setPrivacy(DEFAULT_PASSPORT_PRIVACY)).resolves.toEqual(DEFAULT_PASSPORT_PRIVACY)
  })

  it('opens the circuit after repeated worker failures', async () => {
    const { client } = createClient([
      (worker, request) => {
        if (request.method === 'initialize') worker.respond(request)
        else worker.fail(request, 'disk unavailable')
      }
    ])
    await settle()
    for (let index = 0; index < 3; index += 1) {
      await client.getConfig().catch(() => undefined)
    }
    expect(client.status().state).toBe('open-circuit')
    await expect(client.getPrivacy()).rejects.toThrow(/circuit/i)
  })

  it('opens the circuit after four initialized processes crash their first real RPC', async () => {
    const crashAfterInitialize = (worker: FakeWorker, request: Request) => {
      if (request.method === 'initialize') worker.respond(request)
      else worker.crash(97)
    }
    const { client, workers } = createClient([
      crashAfterInitialize,
      crashAfterInitialize,
      crashAfterInitialize,
      crashAfterInitialize
    ])
    await waitUntil(() => workers.length === 1 && workers[0].requests.some(
      (request) => request.method === 'initialize'
    ))

    for (let index = 0; index < 3; index += 1) {
      await expect(client.getConfig()).rejects.toThrow(/exited/i)
      await waitUntil(() => workers.length === index + 2)
    }

    const exhaustedRequests = [
      client.getConfig(),
      client.getPrivacy(),
      client.listRoster()
    ]
    const exhaustedResults = await Promise.race([
      Promise.allSettled(exhaustedRequests),
      new Promise<never>((_, reject) => setTimeout(
        () => reject(new Error('queued rejection deadline exceeded')),
        250
      ))
    ])
    await waitUntil(() => client.status().state === 'open-circuit')
    expect(exhaustedResults.every((result) => result.status === 'rejected')).toBe(true)
    expect(workers).toHaveLength(4)
    expect(client.status()).toMatchObject({
      state: 'open-circuit',
      queued: 0,
      inFlight: false,
      restarts: 3
    })
    await expect(Promise.race([
      client.getPrivacy(),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('bounded rejection deadline exceeded')),
        250
      ))
    ])).rejects.toThrow(/circuit/i)
  })

  it('serializes full audit against concurrent persistence requests', async () => {
    let auditRequest: Request | undefined
    const { client, workers } = createClient([
      (worker, request) => {
        if (request.method === 'initialize') worker.respond(request)
        else if (request.method === 'runFullAudit') auditRequest = request
        else if (request.method === 'getConfig') worker.respond(request, { ok: true })
      }
    ])
    await settle()
    const audit = client.runFullAudit()
    const config = client.getConfig()
    await settle()
    expect(workers[0].requests.map((request) => request.method)).toEqual([
      'initialize',
      'runFullAudit'
    ])
    workers[0].respond(auditRequest!, {
      state: 'unanchored',
      verified: false,
      scope: 'full',
      checkedEvents: 0,
      lastCheckedAt: 0
    })
    await audit
    await config
    expect(workers[0].requests.at(-1)?.method).toBe('getConfig')
  })

  it('keeps corruption quarantined until the explicit repair acknowledgement succeeds', async () => {
    const { client } = createClient([
      (worker, request) => {
        if (request.method === 'initialize') worker.respond(request)
        else if (request.method === 'getConfig') {
          worker.fail(request, 'quarantined', 'PERSISTENCE_QUARANTINED')
        } else if (request.method === 'repairPersistence') {
          worker.respond(request, { quarantinedPath: 'passport-v2.db.quarantine-1' })
        } else {
          worker.respond(request, true)
        }
      }
    ])
    await settle()
    await expect(client.getConfig()).rejects.toThrow(/quarantined/i)
    expect(client.status().state).toBe('quarantined')
    await expect(client.repairPersistence('repair-token')).resolves.toMatchObject({
      quarantinedPath: 'passport-v2.db.quarantine-1'
    })
    expect(client.status().state).toBe('ready')
  })
})

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fork, type ChildProcess } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import {
  DEFAULT_PASSPORT_CONFIG,
  PASSPORT_ITEM_DEFINITIONS,
  STINT_PASSPORT_CONTRACT_VERSION,
  type PassportItem,
  type StintPassport
} from '../../shared/stint-passport'
import { emptyConfidence, emptyObservedInterval } from '../../shared/phase02-contracts'
import type { PassportStoreEvent } from './persistence-engine'

const phase3Directories: string[] = []
let phase3WorkerFixture: PassportWorkerTestFixture

class RealPersistenceProcess {
  private readonly child: ChildProcess

  constructor() {
    this.child = fork(
      phase3WorkerFixture.entry,
      [],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        execArgv: [],
        serialization: 'advanced',
        stdio: ['ignore', 'ignore', 'ignore', 'ipc']
      }
    )
  }

  postMessage(value: unknown): void {
    this.child.send?.(value as any)
  }

  on(event: 'message' | 'error' | 'exit', listener: (...args: any[]) => void): this {
    this.child.on(event, listener)
    return this
  }

  removeAllListeners(): this {
    this.child.removeAllListeners()
    return this
  }

  terminate(): Promise<number> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      return Promise.resolve(this.child.exitCode ?? 0)
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(this.child.exitCode ?? 0), 2_000)
      this.child.once('exit', (code) => {
        clearTimeout(timer)
        resolve(code ?? 0)
      })
      this.child.kill('SIGKILL')
    })
  }
}

const phase3Workers: RealPersistenceProcess[] = []

afterEach(async () => {
  await Promise.all(phase3Workers.splice(0).map(async (worker) => {
    try {
      await worker.terminate()
    } catch {
      // A crash test may already have observed the real worker exit.
    }
  }))
  for (const directory of phase3Directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

function phase3Database(name: string): string {
  const directory = mkdtempSync(join(process.cwd(), `.passport-client-${name}-`))
  phase3Directories.push(directory)
  return join(directory, 'passport.db')
}

function phase3Worker(): RealPersistenceProcess {
  const worker = new RealPersistenceProcess()
  phase3Workers.push(worker)
  return worker
}

async function waitForPhase3(predicate: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Phase 3 condition timed out.')
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

function phase3Passport(revision = 1): StintPassport {
  const items: PassportItem[] = PASSPORT_ITEM_DEFINITIONS.map((definition, index) => ({
    id: definition.id,
    status: index === 10 ? 'not-applicable' : 'verified',
    owner: {
      memberId: index % 2 === 0 ? 'engineer-client' : 'driver-client',
      role: index % 2 === 0 ? 'engineer' : 'driver'
    },
    detail: `${definition.id} client ready`,
    verifiedAt: 2_000,
    expiresAt: 2_000 + definition.ttlMs,
    evidence: {
      source: 'client-test',
      summary: 'client evidence',
      contentHash: `${index}`.padStart(64, '0'),
      capturedAt: 2_000,
      state: 'available'
    },
    revision
  }))
  return {
    contractVersion: STINT_PASSPORT_CONTRACT_VERSION,
    identity: {
      stintId: 'client-stint',
      sessionRef: 'session:client-stint',
      trackRef: 'track:client',
      trackLabel: 'Client Track',
      carRef: 'car:client',
      carLabel: 'Client Car',
      driverRef: 'driver-client',
      driverLabel: 'Client Driver',
      startedAt: 2_000
    },
    lifecycle: 'ready',
    telemetryContext: 'live',
    items,
    coverage: 1,
    applicableItems: 11,
    coveredItems: 11,
    interrupted: false,
    persisted: false,
    revision,
    durability: 'ephemeral'
  }
}

function phase3Event(index: number): PassportStoreEvent {
  return {
    dataClass: 'D2',
    capturedAt: 2_000 + index,
    canonicalEvent: {
      eventId: `client-event-${index}`,
      eventClass: 'fact',
      eventType: 'ultimate.sim.raceops.passport.item-updated.v2',
      sessionRef: 'session:client-stint',
      actorRef: 'system:client-test',
      subjectRef: 'stint:client-stint',
      observedInterval: emptyObservedInterval(),
      facts: [{
        name: 'passport.client.index',
        canonicalUnit: 'count',
        value: { kind: 'double', value: index },
        provenance: {
          sourceId: 'client-test',
          transformId: 'client-test.v2',
          schemaFingerprint: 'client-test',
          canonicalUnit: 'count',
          validity: 'valid',
          nullReason: 'unspecified',
          sourceTick: String(2_000 + index),
          observedMonotonicNs: '0',
          ageMs: '0',
          privacyClass: 'D2'
        }
      }],
      confidence: emptyConfidence(),
      severity: 'info',
      priority: 'normal',
      evidenceRefs: [],
      policyRef: 'client-test',
      capabilityRef: 'client-test',
      consentEpoch: '1',
      approvalRef: '',
      correlationId: 'client-stint',
      dedupeKey: `client-dedupe-${index}`,
      privacyClass: 'D2',
      integrityFlags: ['derived'],
      supersedesEventId: '',
      sequence: '0',
      partitionKey: 'stint:client-stint',
      partitionSeq: '0',
      telemetryContext: 'live',
      sourceTick: String(2_000 + index),
      observedMonotonicNs: '0',
      ttlMs: '0'
    }
  }
}

describe('PassportPersistenceClient real worker lifecycle', () => {
  beforeAll(async () => {
    phase3WorkerFixture = await buildPassportWorkerTestFixture('client')
  })

  afterAll(() => {
    phase3WorkerFixture.cleanup()
  })

  it('[supported] keeps a healthy real worker available after repeated invalid imports', async () => {
    const path = phase3Database('domain-errors')
    const client = new PassportPersistenceClient({
      path,
      restartDelayMs: 1,
      workerFactory: () => phase3Worker() as any
    })
    clients.push(client)
    await waitForPhase3(() => !client.status().inFlight)

    for (let index = 0; index < 4; index += 1) {
      await expect(client.verifyImportPackage({ invalid: index })).rejects.toThrow(/import|bounded|trusted/i)
    }

    expect(client.status()).toMatchObject({
      state: 'ready',
      failures: 0,
      restarts: 0
    })
    await expect(client.getConfig()).resolves.toEqual(DEFAULT_PASSPORT_CONFIG)
  })

  it('[supported] rejects a lock-blocked real request, restarts, and exposes only acknowledged durable state', async () => {
    const path = phase3Database('restart')
    const realWorkers: RealPersistenceProcess[] = []
    const client = new PassportPersistenceClient({
      path,
      restartDelayMs: 1,
      workerFactory: () => {
        const worker = phase3Worker()
        realWorkers.push(worker)
        return worker as any
      }
    })
    clients.push(client)
    await waitForPhase3(() => !client.status().inFlight)
    await client.setPrivacy({
      ...DEFAULT_PASSPORT_PRIVACY,
      identityPersistenceOptIn: true,
      updatedAt: 2_000
    })
    await expect(client.persistPassport(phase3Passport(1), phase3Event(1))).resolves.toMatchObject({
      revision: 1,
      persisted: true,
      durability: 'durable'
    })

    const blocker = new DatabaseSync(path)
    blocker.exec('BEGIN IMMEDIATE')
    const unacknowledged = client.persistPassport(phase3Passport(2), phase3Event(2))
    await waitForPhase3(() => client.status().inFlight)
    const crashedWorker = realWorkers.at(-1)!
    const termination = crashedWorker.terminate()
    await new Promise<void>((resolve) => setImmediate(resolve))
    blocker.exec('ROLLBACK')
    blocker.close()
    await termination
    await expect(unacknowledged).rejects.toThrow(/exited/i)

    await waitForPhase3(() => realWorkers.length >= 2 && !client.status().inFlight)
    expect(client.status().restarts).toBe(1)
    await expect(client.getPassport('client-stint')).resolves.toMatchObject({
      revision: 1,
      durability: 'durable'
    })
    await expect(client.eventHeaders('client-stint')).resolves.toMatchObject([
      { sequence: 1, dedupeKey: 'client-dedupe-1', previousHash: undefined }
    ])
  }, 15_000)

  it('[supported] ignores stale, duplicate, and future responses without resolving the wrong request', async () => {
    const { client, workers } = createClient([
      (worker, request) => {
        if (request.method === 'initialize') worker.respond(request)
      }
    ])
    await settle()
    let configSettled = false
    const config = client.getConfig()
    config.then(() => { configSettled = true }, () => { configSettled = true })
    await settle()
    const initializeRequest = workers[0].requests[0]
    const configRequest = workers[0].requests.at(-1)!
    workers[0].respond(initializeRequest, { stale: true })
    workers[0].respond({ ...configRequest, id: configRequest.id + 99 }, { future: true })
    await settle()
    expect(configSettled).toBe(false)
    expect(client.status().inFlight).toBe(true)
    workers[0].respond(configRequest, DEFAULT_PASSPORT_CONFIG)
    await expect(config).resolves.toEqual(DEFAULT_PASSPORT_CONFIG)

    const privacy = client.getPrivacy()
    await settle()
    const privacyRequest = workers[0].requests.at(-1)!
    workers[0].respond(configRequest, { duplicate: true })
    await settle()
    expect(client.status().inFlight).toBe(true)
    workers[0].respond(privacyRequest, DEFAULT_PASSPORT_PRIVACY)
    await expect(privacy).resolves.toEqual(DEFAULT_PASSPORT_PRIVACY)
  })

  it('[supported] reports exact queued item and byte accounting behind the in-flight request', async () => {
    let released = false
    const { client, workers } = createClient([
      (worker, request) => {
        if (!released) return
        if (request.method === 'getConfig') worker.respond(request, DEFAULT_PASSPORT_CONFIG)
        else if (request.method === 'getPrivacy') worker.respond(request, DEFAULT_PASSPORT_PRIVACY)
        else worker.respond(request)
      }
    ])
    const config = client.getConfig()
    const privacy = client.getPrivacy()
    const expectedBytes =
      Buffer.byteLength(JSON.stringify({ id: 2, method: 'getConfig', args: [] })) +
      Buffer.byteLength(JSON.stringify({ id: 3, method: 'getPrivacy', args: [] }))
    expect(client.status()).toMatchObject({
      inFlight: true,
      queued: 2,
      queuedBytes: expectedBytes
    })

    released = true
    workers[0].respond(workers[0].requests[0])
    await expect(Promise.all([config, privacy])).resolves.toEqual([
      DEFAULT_PASSPORT_CONFIG,
      DEFAULT_PASSPORT_PRIVACY
    ])
    expect(client.status()).toMatchObject({ inFlight: false, queued: 0, queuedBytes: 0 })
  })

  it('[spec-gap] executes privacy deletion, opt-out, and repair after the circuit opens', async () => {
    const { client } = createClient([
      (worker, request) => {
        if (request.method === 'initialize') worker.respond(request)
        else if (request.method === 'setPrivacy') worker.respond(request, request.args[0])
        else if (request.method === 'deleteByClass') {
          worker.respond(request, { deletedStints: 0, redactedEvidence: 0, dataClass: 'D3' })
        } else if (request.method === 'repairPersistence') {
          worker.respond(request, { quarantinedPath: 'passport-v2.db.quarantine-test' })
        } else worker.fail(request, 'phase3 forced worker failure')
      }
    ])
    await settle()
    for (let index = 0; index < 3; index += 1) {
      await client.getConfig().catch(() => undefined)
    }
    expect(client.status().state).toBe('open-circuit')
    const outcomes = await Promise.allSettled([
      client.setPrivacy(DEFAULT_PASSPORT_PRIVACY),
      client.deleteByClass('D3'),
      client.repairPersistence('repair-token')
    ])
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      'fulfilled',
      'fulfilled',
      'fulfilled'
    ])
  })

  it('[spec-gap] drains accepted lifecycle, audit, and deletion work before a worker flush acknowledgement', async () => {
    const { client, workers } = createClient([
      (worker, request) => {
        if (request.method === 'initialize') {
          worker.respond(request)
        } else if (request.method === 'persistPassport') {
          worker.respond(request, phase3Passport())
        } else if (request.method === 'runFullAudit') {
          worker.respond(request, {
            state: 'unanchored',
            verified: false,
            scope: 'full',
            checkedEvents: 0,
            lastCheckedAt: 0
          })
        } else if (request.method === 'deleteByClass') {
          worker.respond(request, { deletedStints: 0, redactedEvidence: 0, dataClass: 'D3' })
        } else if (request.method === 'flush') {
          worker.respond(request, true)
        } else if (request.method === 'shutdown') {
          worker.respond(request, true)
        }
      }
    ])
    await settle()
    const lifecycle = client.persistLifecycle(phase3Passport(), phase3Event(1))
      .then(() => 'fulfilled', () => 'rejected')
    const audit = client.runFullAudit().then(() => 'fulfilled', () => 'rejected')
    const deletion = client.deleteByClass('D3').then(() => 'fulfilled', () => 'rejected')
    await client.close()
    const outcomes = await Promise.all([lifecycle, audit, deletion])
    await Promise.resolve()
    expect({
      outcomes,
      methods: workers[0].requests.map((request) => request.method)
    }).toEqual({
      outcomes: ['fulfilled', 'fulfilled', 'fulfilled'],
      methods: ['initialize', 'persistPassport', 'runFullAudit', 'deleteByClass', 'flush', 'shutdown']
    })
  })

  it('[supported] rejects work after close and suppresses a pending restart timer', async () => {
    vi.useFakeTimers()
    const { client, workers } = createClient([
      (worker, request) => {
        if (request.method === 'initialize') worker.respond(request)
        else worker.crash()
      }
    ])
    await vi.runAllTicks()
    const failed = client.getConfig()
    await vi.runAllTicks()
    await expect(failed).rejects.toThrow(/exited/i)
    expect(client.status().restarts).toBe(1)
    await client.close()
    await vi.advanceTimersByTimeAsync(10)
    expect(workers).toHaveLength(1)
    await expect(client.getPrivacy()).rejects.toThrow(/closed/i)
  })
})
