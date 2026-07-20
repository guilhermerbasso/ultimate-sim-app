import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fork, type ChildProcess } from 'node:child_process'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  DEFAULT_PASSPORT_PRIVACY,
  PASSPORT_ITEM_DEFINITIONS,
  STINT_PASSPORT_CONTRACT_VERSION,
  type PassportItem,
  type PassportPrivacySettings,
  type StintPassport
} from '../../shared/stint-passport'
import { emptyConfidence, emptyObservedInterval } from '../../shared/phase02-contracts'
import type { PassportStoreEvent } from './persistence-engine'
import {
  buildPassportWorkerTestFixture,
  type PassportWorkerTestFixture
} from './passport-worker-test-fixture'

interface RpcResponse {
  id: number
  ok: boolean
  result?: unknown
  error?: string
  code?: string
}

let workerFixture: PassportWorkerTestFixture

class PersistenceProcess {
  readonly child: ChildProcess

  constructor() {
    this.child = fork(workerFixture.entry, [], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      execArgv: [],
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    })
  }

  get pid(): number {
    return this.child.pid ?? -1
  }

  postMessage(value: unknown): void {
    this.child.send?.(value as any)
  }

  on(event: 'message' | 'error' | 'exit', listener: (...args: any[]) => void): this {
    this.child.on(event, listener)
    return this
  }

  once(event: 'message' | 'error' | 'exit', listener: (...args: any[]) => void): this {
    this.child.once(event, listener)
    return this
  }

  off(event: 'message' | 'error' | 'exit', listener: (...args: any[]) => void): this {
    this.child.off(event, listener)
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

const workers: PersistenceProcess[] = []
const directories: string[] = []
let requestId = 0

beforeAll(async () => {
  workerFixture = await buildPassportWorkerTestFixture('process')
})

afterAll(() => {
  workerFixture.cleanup()
})

afterEach(async () => {
  await Promise.all(workers.splice(0).map(async (worker) => {
    try {
      await worker.terminate()
    } catch {
      // The test may already have observed the worker's real exit.
    }
  }))
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

function tempDatabase(name: string): string {
  const directory = mkdtempSync(join(process.cwd(), `.passport-worker-${name}-`))
  directories.push(directory)
  return join(directory, 'passport.db')
}

function spawnWorker(): PersistenceProcess {
  const worker = new PersistenceProcess()
  workers.push(worker)
  return worker
}

function rpc(
  worker: PersistenceProcess,
  method: string,
  args: unknown[] = [],
  timeoutMs = 6_000
): Promise<RpcResponse> {
  return rpcRaw(worker, { id: ++requestId, method, args }, requestId, timeoutMs)
}

function rpcRaw(
  worker: PersistenceProcess,
  request: unknown,
  expectedId: number,
  timeoutMs = 6_000
): Promise<RpcResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for worker response ${expectedId}.`))
    }, timeoutMs)
    const onMessage = (value: unknown) => {
      const response = value as RpcResponse
      if (response.id !== expectedId) return
      cleanup()
      resolve(response)
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onExit = (code: number) => {
      cleanup()
      reject(new Error(`Worker exited with code ${code} before response ${expectedId}.`))
    }
    const cleanup = () => {
      clearTimeout(timer)
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.off('exit', onExit)
    }
    worker.on('message', onMessage)
    worker.on('error', onError)
    worker.on('exit', onExit)
    worker.postMessage(request)
  })
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Condition was not reached before timeout.')
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

function heartbeat(): { count(): number; stop(): void } {
  let active = true
  let beats = 0
  const tick = () => {
    if (!active) return
    beats += 1
    setImmediate(tick)
  }
  setImmediate(tick)
  return {
    count: () => beats,
    stop: () => { active = false }
  }
}

function privacy(optedIn: boolean): PassportPrivacySettings {
  return {
    ...DEFAULT_PASSPORT_PRIVACY,
    identityPersistenceOptIn: optedIn,
    updatedAt: 1_000
  }
}

function passport(stintId = 'worker-stint', revision = 1, sentinel?: string): StintPassport {
  const items: PassportItem[] = PASSPORT_ITEM_DEFINITIONS.map((definition, index) => ({
    id: definition.id,
    status: index === 10 ? 'not-applicable' : 'verified',
    owner: {
      memberId: index % 2 === 0 ? 'engineer-worker' : 'driver-worker',
      role: index % 2 === 0 ? 'engineer' : 'driver'
    },
    detail: index === 0 && sentinel ? sentinel : `${definition.id} ready`,
    verifiedAt: 1_000,
    expiresAt: 1_000 + definition.ttlMs,
    evidence: {
      source: 'worker-test',
      summary: index === 0 && sentinel ? sentinel : 'worker evidence',
      contentHash: `${index}`.padStart(64, '0'),
      capturedAt: 1_000,
      state: 'available'
    },
    revision
  }))
  return {
    contractVersion: STINT_PASSPORT_CONTRACT_VERSION,
    identity: {
      stintId,
      sessionRef: `session:${stintId}`,
      trackRef: 'track:worker',
      trackLabel: 'Worker Track',
      carRef: 'car:worker',
      carLabel: 'Worker Car',
      driverRef: sentinel ?? 'driver-worker',
      driverLabel: sentinel ?? 'Worker Driver',
      teamRef: 'team-worker',
      teamLabel: 'Worker Team',
      startedAt: 1_000
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

function event(index: number, stintId = 'worker-stint'): PassportStoreEvent {
  return {
    dataClass: 'D2',
    capturedAt: 1_000 + index,
    canonicalEvent: {
      eventId: `worker-event-${index}`,
      eventClass: 'fact',
      eventType: 'ultimate.sim.raceops.passport.item-updated.v2',
      sessionRef: `session:${stintId}`,
      actorRef: 'system:worker-test',
      subjectRef: `stint:${stintId}`,
      observedInterval: emptyObservedInterval(),
      facts: [{
        name: 'passport.worker.index',
        canonicalUnit: 'count',
        value: { kind: 'double', value: index },
        provenance: {
          sourceId: 'worker-test',
          transformId: 'worker-test.v2',
          schemaFingerprint: 'worker-test',
          canonicalUnit: 'count',
          validity: 'valid',
          nullReason: 'unspecified',
          sourceTick: String(1_000 + index),
          observedMonotonicNs: '0',
          ageMs: '0',
          privacyClass: 'D2'
        }
      }],
      confidence: emptyConfidence(),
      severity: 'info',
      priority: 'normal',
      evidenceRefs: [],
      policyRef: 'worker-test',
      capabilityRef: 'worker-test',
      consentEpoch: '1',
      approvalRef: '',
      correlationId: stintId,
      dedupeKey: `worker-dedupe-${index}`,
      privacyClass: 'D2',
      integrityFlags: ['derived'],
      supersedesEventId: '',
      sequence: '0',
      partitionKey: `stint:${stintId}`,
      partitionSeq: '0',
      telemetryContext: 'live',
      sourceTick: String(1_000 + index),
      observedMonotonicNs: '0',
      ttlMs: '0'
    }
  }
}

describe('packaged Passport persistence worker', () => {
  it('[supported] runs off the main thread while the parent and an independent worker make progress', async () => {
    const path = tempDatabase('isolation')
    const blocked = spawnWorker()
    const independent = spawnWorker()
    expect(blocked.pid).toBeGreaterThan(0)
    expect(blocked.pid).not.toBe(process.pid)
    expect(independent.pid).toBeGreaterThan(0)
    expect(independent.pid).not.toBe(process.pid)
    expect(independent.pid).not.toBe(blocked.pid)
    await expect(rpc(blocked, 'initialize', [path])).resolves.toMatchObject({ ok: true })

    const blocker = new DatabaseSync(path)
    blocker.exec('PRAGMA busy_timeout = 0')
    blocker.exec('BEGIN IMMEDIATE')
    const pulse = heartbeat()
    let writeSettled = false
    const pendingWrite = rpc(blocked, 'setPrivacy', [privacy(true)])
    pendingWrite.then(() => { writeSettled = true }, () => { writeSettled = true })
    try {
      await waitUntil(() => pulse.count() >= 20)
      expect(writeSettled).toBe(false)
      await expect(rpc(independent, 'initialize', [tempDatabase('independent')]))
        .resolves.toMatchObject({ ok: true })
      await expect(rpc(independent, 'getConfig')).resolves.toMatchObject({
        ok: true,
        result: expect.objectContaining({ requiredDeviceIds: ['simx'] })
      })
      expect(pulse.count()).toBeGreaterThanOrEqual(20)
    } finally {
      blocker.exec('ROLLBACK')
      blocker.close()
      pulse.stop()
    }
    await expect(pendingWrite).resolves.toMatchObject({
      ok: true,
      result: expect.objectContaining({ identityPersistenceOptIn: true })
    })
  })

  it('[supported] returns correlated errors for invalid dispatch without crashing the worker', async () => {
    const path = tempDatabase('dispatch-errors')
    const worker = spawnWorker()

    await expect(rpc(worker, 'getConfig')).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/not initialized/i)
    })
    const malformedId = ++requestId
    await expect(rpcRaw(worker, { id: malformedId, method: 'initialize' }, malformedId))
      .resolves.toMatchObject({ id: malformedId, ok: false })
    await expect(rpc(worker, 'initialize', [dirname(path)])).resolves.toMatchObject({ ok: false })
    await expect(rpc(worker, 'initialize', [path])).resolves.toMatchObject({ ok: true })
    await expect(rpc(worker, 'notARealPersistenceMethod')).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/unknown persistence method/i)
    })
    await expect(rpc(worker, 'repairPersistence', [
      'invalid-token',
      'repair:invalid-token-test'
    ])).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/repair token is invalid/i)
    })
    await expect(rpc(worker, 'getPrivacy')).resolves.toMatchObject({
      ok: true,
      result: expect.objectContaining({ identityPersistenceOptIn: false })
    })
  })

  it('[supported] serializes locked requests and preserves their response IDs', async () => {
    const path = tempDatabase('serialization')
    const worker = spawnWorker()
    await rpc(worker, 'initialize', [path])
    const blocker = new DatabaseSync(path)
    blocker.exec('BEGIN IMMEDIATE')
    const responseOrder: number[] = []
    const collect = (value: unknown) => responseOrder.push((value as RpcResponse).id)
    worker.on('message', collect)
    const first = rpc(worker, 'setPrivacy', [privacy(true)])
    const second = rpc(worker, 'getPrivacy')
    const pulse = heartbeat()
    try {
      await waitUntil(() => pulse.count() >= 20)
      expect(responseOrder).toEqual([])
    } finally {
      blocker.exec('ROLLBACK')
      blocker.close()
      pulse.stop()
    }
    const [firstResponse, secondResponse] = await Promise.all([first, second])
    worker.off('message', collect)
    expect(responseOrder).toEqual([firstResponse.id, secondResponse.id])
    expect(secondResponse.id).toBe(firstResponse.id + 1)
    expect(secondResponse.result).toMatchObject({ identityPersistenceOptIn: true })
  })

  it('[supported] exits with code 91 and reopens exactly the last acknowledged commit', async () => {
    const path = tempDatabase('crash-reopen')
    const first = spawnWorker()
    await rpc(first, 'initialize', [path])
    await rpc(first, 'setPrivacy', [privacy(true)])
    await expect(rpc(first, 'persistPassport', [passport(), event(1)])).resolves.toMatchObject({
      ok: true,
      result: expect.objectContaining({ persisted: true, durability: 'durable' })
    })

    const exitCode = new Promise<number>((resolve) => first.once('exit', resolve))
    await expect(rpc(first, 'simulateCrash')).resolves.toMatchObject({ ok: true })
    await expect(exitCode).resolves.toBe(91)

    const replacement = spawnWorker()
    await rpc(replacement, 'initialize', [path])
    await expect(rpc(replacement, 'getPassport', ['worker-stint'])).resolves.toMatchObject({
      ok: true,
      result: expect.objectContaining({
        revision: 1,
        persisted: true,
        durability: 'durable'
      })
    })
    await expect(rpc(replacement, 'eventHeaders', ['worker-stint'])).resolves.toMatchObject({
      ok: true,
      result: [{
        sequence: 1,
        dedupeKey: 'worker-dedupe-1',
        previousHash: undefined
      }]
    })
  }, 15_000)

  it('[supported] terminates a lock-blocked worker without leaving a partial passport transaction', async () => {
    const path = tempDatabase('terminate-locked')
    const first = spawnWorker()
    await rpc(first, 'initialize', [path])
    await rpc(first, 'setPrivacy', [privacy(true)])
    const blocker = new DatabaseSync(path)
    blocker.exec('BEGIN IMMEDIATE')
    const pending = rpc(first, 'persistPassport', [passport(), event(1)])
    const pulse = heartbeat()
    await waitUntil(() => pulse.count() >= 20)
    const termination = first.terminate()
    await new Promise<void>((resolve) => setImmediate(resolve))
    blocker.exec('ROLLBACK')
    blocker.close()
    pulse.stop()
    await termination
    await expect(pending).rejects.toThrow(/exited/i)

    const replacement = spawnWorker()
    await rpc(replacement, 'initialize', [path])
    await expect(rpc(replacement, 'getPassport', ['worker-stint']))
      .resolves.toMatchObject({ ok: true, result: null })
    await expect(rpc(replacement, 'eventHeaders', ['worker-stint']))
      .resolves.toMatchObject({ ok: true, result: [] })
    const db = new DatabaseSync(path)
    const counts = {
      passports: (db.prepare('SELECT COUNT(*) AS count FROM stint_passport').get() as { count: number }).count,
      items: (db.prepare('SELECT COUNT(*) AS count FROM passport_item').get() as { count: number }).count,
      events: (db.prepare('SELECT COUNT(*) AS count FROM passport_event').get() as { count: number }).count
    }
    db.close()
    expect(counts).toEqual({ passports: 0, items: 0, events: 0 })
  })

  it('[spec-gap] exposes deterministic WAL, post-commit, and pre-response crash checkpoints', async () => {
    const path = tempDatabase('crash-checkpoints')
    const postCommit = spawnWorker()
    await rpc(postCommit, 'initialize', [path])
    await rpc(postCommit, 'setPrivacy', [privacy(true)])
    const response = await rpc(postCommit, 'configureCrashBoundary', [{
      operation: 'persistPassport',
      checkpoint: 'after-commit-before-response'
    }])
    expect(response).toMatchObject({
      ok: true,
      result: {
        operation: 'persistPassport',
        checkpoint: 'after-commit-before-response',
        armed: true
      }
    })
    await expect(rpc(postCommit, 'persistPassport', [passport(), event(1)]))
      .rejects.toThrow(/exited/i)

    const beforeDispatch = spawnWorker()
    await rpc(beforeDispatch, 'initialize', [path])
    await expect(rpc(beforeDispatch, 'getPassport', ['worker-stint']))
      .resolves.toMatchObject({ ok: true, result: { revision: 1, durability: 'durable' } })
    await expect(rpc(beforeDispatch, 'eventHeaders', ['worker-stint']))
      .resolves.toMatchObject({ ok: true, result: [{ sequence: 1 }] })
    await rpc(beforeDispatch, 'configureCrashBoundary', [{
      operation: 'persistPassport',
      checkpoint: 'before-dispatch'
    }])
    await expect(rpc(beforeDispatch, 'persistPassport', [passport('worker-stint', 2), event(2)]))
      .rejects.toThrow(/exited/i)

    const recovered = spawnWorker()
    await rpc(recovered, 'initialize', [path])
    await expect(rpc(recovered, 'getPassport', ['worker-stint']))
      .resolves.toMatchObject({ ok: true, result: { revision: 1 } })
    await expect(rpc(recovered, 'eventHeaders', ['worker-stint']))
      .resolves.toMatchObject({ ok: true, result: [{ sequence: 1 }] })
  }, 15_000)

  it('[spec-gap] excludes privacy-deleted sentinels from repair quarantine artifacts', async () => {
    const path = tempDatabase('quarantine-erasure')
    const sentinel = 'PHASE3-QUARANTINE-PRIVATE-7B19F2'
    const first = spawnWorker()
    await rpc(first, 'initialize', [path])
    await rpc(first, 'setPrivacy', [privacy(true)])
    await rpc(first, 'persistPassport', [passport('worker-stint', 1, sentinel), event(1)])
    await rpc(first, 'setPrivacy', [privacy(false)])
    await first.terminate()

    const marker = new DatabaseSync(path)
    marker.prepare("UPDATE passport_meta SET value = 'corrupt' WHERE key = 'integrity_state'").run()
    marker.close()
    const repairWorker = spawnWorker()
    await rpc(repairWorker, 'initialize', [path])
    const integrity = await rpc(repairWorker, 'getIntegrity')
    const repairToken = (integrity.result as { repairToken?: string }).repairToken
    expect(repairToken).toMatch(/^[a-f0-9]+$/)
    const repair = await rpc(repairWorker, 'repairPersistence', [
      repairToken,
      'repair:quarantine-artifact-test'
    ])
    expect(repair).toMatchObject({ ok: true })

    const quarantinePath = (repair.result as { quarantinedPath: string }).quarantinedPath
    const quarantineName = basename(quarantinePath)
    const artifacts = readdirSync(dirname(quarantinePath))
      .filter((name) => name.startsWith(quarantineName))
      .map((name) => readFileSync(join(dirname(quarantinePath), name)))
    expect(artifacts.length).toBeGreaterThan(0)
    for (const bytes of artifacts) {
      expect(bytes.includes(Buffer.from(sentinel))).toBe(false)
    }
    await expect(rpc(repairWorker, 'getPassport', ['worker-stint']))
      .resolves.toMatchObject({ ok: true, result: null })
  })

  it('[blocker-B11-g] retries the same repair operation after an erase COMMIT worker exit', async () => {
    const path = tempDatabase('repair-postcommit-exit')
    const first = spawnWorker()
    await rpc(first, 'initialize', [path])
    await rpc(first, 'setPrivacy', [privacy(true)])
    await rpc(first, 'persistPassport', [
      passport('worker-stint', 1, 'REPAIR-POSTCOMMIT-SENTINEL'),
      event(1)
    ])
    await first.terminate()

    const marker = new DatabaseSync(path)
    marker.prepare("UPDATE passport_meta SET value = 'corrupt' WHERE key = 'integrity_state'").run()
    marker.close()
    const crashingRepair = spawnWorker()
    await rpc(crashingRepair, 'initialize', [path])
    const integrity = await rpc(crashingRepair, 'getIntegrity')
    const repairToken = (integrity.result as { repairToken?: string }).repairToken
    const operationId = 'repair:postcommit-worker-exit'
    expect(repairToken).toMatch(/^[a-f0-9]+$/)
    await rpc(crashingRepair, 'configureCrashBoundary', [{
      operation: 'repairPersistence',
      checkpoint: 'after-commit-before-response'
    }])
    await expect(rpc(crashingRepair, 'repairPersistence', [repairToken, operationId]))
      .rejects.toThrow(/exited/i)

    const recovered = spawnWorker()
    await rpc(recovered, 'initialize', [path])
    const retry = await rpc(recovered, 'repairPersistence', [repairToken, operationId])
    expect(retry).toMatchObject({
      ok: true,
      result: { quarantinedPath: expect.stringContaining('.quarantine-') }
    })
    await expect(rpc(recovered, 'getAuthoritativeState', [operationId]))
      .resolves.toMatchObject({
        ok: true,
        result: {
          privacy: { identityPersistenceOptIn: false },
          roster: [],
          passports: []
        }
      })
  }, 15_000)

  it.each([
    ['after-repair-journal', 'authorized'],
    ['after-repair-database-erase', 'database-erased'],
    ['after-repair-key-erase', 'keys-erased'],
    ['after-repair-receipt-temp-write', 'database-created'],
    ['after-repair-receipt-promotion', 'receipt-staged']
  ] as const)(
    '[blocker-B12-e] resumes repair after %s without stale data or lost authorization',
    async (checkpoint, expectedPhase) => {
      const path = tempDatabase(checkpoint)
      const sentinel = `REPAIR-JOURNAL-SENTINEL-${checkpoint}`
      const first = spawnWorker()
      await rpc(first, 'initialize', [path])
      await rpc(first, 'setPrivacy', [privacy(true)])
      await rpc(first, 'persistPassport', [passport('worker-stint', 1, sentinel), event(1)])
      await first.terminate()

      const marker = new DatabaseSync(path)
      marker.prepare("UPDATE passport_meta SET value = 'corrupt' WHERE key = 'integrity_state'").run()
      marker.close()

      const crashingRepair = spawnWorker()
      await rpc(crashingRepair, 'initialize', [path])
      const integrity = await rpc(crashingRepair, 'getIntegrity')
      const repairToken = (integrity.result as { repairToken?: string }).repairToken
      const operationId = `repair:journal:${checkpoint}`
      expect(repairToken).toMatch(/^[a-f0-9]+$/)
      await rpc(crashingRepair, 'configureCrashBoundary', [{
        operation: 'repairPersistence',
        checkpoint
      }])
      await expect(rpc(crashingRepair, 'repairPersistence', [repairToken, operationId]))
        .rejects.toThrow(/exited/i)

      const journalPath = `${path}.repair-journal.json`
      expect(JSON.parse(readFileSync(journalPath, 'utf8'))).toMatchObject({
        operationId,
        phase: expectedPhase
      })
      if (checkpoint === 'after-repair-receipt-temp-write') {
        expect(existsSync(`${path}.repair-receipt.json.pending`)).toBe(true)
      }
      if (checkpoint === 'after-repair-receipt-promotion') {
        expect(existsSync(`${path}.repair-receipt.json`)).toBe(true)
      }

      const recovered = spawnWorker()
      await expect(rpc(recovered, 'initialize', [path])).resolves.toMatchObject({ ok: true })
      await expect(rpc(recovered, 'getAuthoritativeState', [operationId]))
        .resolves.toMatchObject({
          ok: true,
          result: {
            privacy: { identityPersistenceOptIn: false },
            roster: [],
            passports: []
          }
        })
      const retry = await rpc(recovered, 'repairPersistence', [repairToken, operationId])
      expect(retry).toMatchObject({
        ok: true,
        result: { quarantinedPath: expect.stringContaining('.quarantine-') }
      })
      const receipt = JSON.parse(readFileSync(`${path}.repair-receipt.json`, 'utf8'))
      expect(receipt).toMatchObject({
        operationId,
        quarantinedPath: (retry.result as { quarantinedPath: string }).quarantinedPath
      })
      expect(existsSync(journalPath)).toBe(false)
      expect(existsSync(`${journalPath}.pending`)).toBe(false)
      expect(existsSync(receipt.quarantinedPath)).toBe(true)
      const artifacts = readdirSync(dirname(path))
        .map((name) => readFileSync(join(dirname(path), name)))
      for (const bytes of artifacts) {
        expect(bytes.includes(Buffer.from(sentinel))).toBe(false)
      }
    },
    30_000
  )
})
