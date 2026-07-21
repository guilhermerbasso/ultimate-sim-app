import {
  cpSync,
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fork, type ChildProcess } from 'node:child_process'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  DEFAULT_PASSPORT_CONFIG,
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

type InjectedIoOperation = 'mkdir' | 'open' | 'write' | 'fsync' | 'rename'
type InjectedIoCode = 'ENOSPC' | 'EIO' | 'EPERM'
type InjectedIoDescriptorKind = 'file' | 'directory'
type CleanupFaultPoint =
  | 'after-completed-authority-promotion'
  | 'after-cleanup-rename'
  | 'during-cleanup-overwrite'
  | 'before-cleanup-unlink'

interface InjectedIoFault {
  kind: 'io'
  operation: InjectedIoOperation
  path: string
  code: InjectedIoCode
  occurrence?: number
  tracePath?: string
  descriptorKind?: InjectedIoDescriptorKind
  exitAfterDirectoryFsyncFault?: boolean
  repeat?: boolean
}

interface InjectedCleanupFault {
  kind: 'cleanup'
  point: CleanupFaultPoint
  journalPath: string
  authorityPath: string
  tracePath: string
}

interface InjectedNativeMoveFault {
  kind: 'native-move'
  mode: 'observe' | 'unavailable'
  tracePath: string
}

type PersistenceProcessFault =
  | InjectedIoFault
  | InjectedCleanupFault
  | InjectedNativeMoveFault

const PASSPORT_WORKER_FAULT_ENV = 'ULTIMATE_SIM_PASSPORT_WORKER_FAULT'
const PASSPORT_WORKER_FAULT_PRELOAD = String.raw`
const fs = require('node:fs')
const pathModule = require('node:path')
const Module = require('node:module')
const { syncBuiltinESMExports } = Module

const raw = process.env.ULTIMATE_SIM_PASSPORT_WORKER_FAULT
if (raw) {
  const config = JSON.parse(raw)
  const original = {
    appendFileSync: fs.appendFileSync.bind(fs),
    closeSync: fs.closeSync.bind(fs),
    fstatSync: fs.fstatSync.bind(fs),
    fsyncSync: fs.fsyncSync.bind(fs),
    mkdirSync: fs.mkdirSync.bind(fs),
    openSync: fs.openSync.bind(fs),
    readFileSync: fs.readFileSync.bind(fs),
    renameSync: fs.renameSync.bind(fs),
    rmSync: fs.rmSync.bind(fs),
    unlinkSync: fs.unlinkSync.bind(fs),
    writeSync: fs.writeSync.bind(fs)
  }
  const descriptors = new Map()
  let ioMatches = 0
  let cleanupArtifact
  let cleanupArtifactComparable
  let injectedNativeLastError

  const comparable = (value) => {
    const resolved = pathModule.resolve(String(value))
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  const record = (event) => {
    if (!config.tracePath) return
    original.appendFileSync(
      config.tracePath,
      JSON.stringify({ ...event, at: Date.now() }) + '\n',
      'utf8'
    )
  }
  const injectedErrno = () => ({
    ENOSPC: -4055,
    EIO: -4070,
    EPERM: -4048
  })[config.code] || -4094
  const injectedError = (operation, target) => {
    const error = new Error(
      config.code + ': injected Passport worker ' + operation + ' fault for ' + target
    )
    error.code = config.code
    error.errno = injectedErrno()
    error.syscall = operation
    error.path = target
    return error
  }
  const shouldInjectIo = (operation, targets, details = {}) => {
    if (config.kind !== 'io' || config.operation !== operation) return false
    const expected = comparable(config.path)
    const matchedTarget = targets.find(
      (target) => target !== undefined && comparable(target) === expected
    )
    if (matchedTarget === undefined) return false
    if (
      config.descriptorKind !== undefined &&
      details.descriptorKind !== config.descriptorKind
    ) return false
    ioMatches += 1
    record({
      event: 'io-match',
      operation,
      target: String(matchedTarget),
      code: config.code,
      occurrence: ioMatches,
      ...details
    })
    return config.repeat === true || ioMatches === (config.occurrence || 1)
  }
  const writePartial = (args) => {
    const descriptor = args[0]
    const value = args[1]
    if (typeof value === 'string') {
      const partial = value.slice(0, Math.max(1, Math.floor(value.length / 2)))
      return original.writeSync(descriptor, partial, args[2], args[3])
    }
    const offset = typeof args[2] === 'number' ? args[2] : 0
    const requested = typeof args[3] === 'number'
      ? args[3]
      : Math.max(0, value.length - offset)
    const length = Math.max(1, Math.floor(requested / 2))
    return original.writeSync(descriptor, value, offset, length, args[4])
  }
  const exitAt = (point, details = {}) => {
    record({ event: 'fault-exit', point, ...details })
    process.exit(120)
  }
  const afterSuccessfulRename = (source, destination) => {
    if (
      config.kind === 'cleanup' &&
      comparable(source) === comparable(config.journalPath)
    ) {
      cleanupArtifact = destination
      cleanupArtifactComparable = comparable(destination)
      record({ event: 'cleanup-rename', source, artifactPath: destination })
      if (config.point === 'after-cleanup-rename') {
        exitAt('after-cleanup-rename', { artifactPath: destination })
      }
    }
    if (
      config.kind === 'cleanup' &&
      config.point === 'after-completed-authority-promotion' &&
      comparable(source) === comparable(config.authorityPath + '.pending') &&
      comparable(destination) === comparable(config.authorityPath)
    ) {
      let promoted
      try {
        promoted = JSON.parse(original.readFileSync(destination, 'utf8'))
      } catch {
        promoted = undefined
      }
      if (promoted && promoted.lastCompleted?.journalCleanupPending === true) {
        exitAt('after-completed-authority-promotion', { authorityPath: destination })
      }
    }
  }
  const nativeErrorCode = () => ({
    ENOSPC: 112,
    EIO: 1117,
    EPERM: 5
  })[config.code] || 1117
  const originalModuleLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (
      request === 'koffi' &&
      config.kind === 'native-move' &&
      config.mode === 'unavailable'
    ) {
      record({ event: 'native-move-unavailable' })
      const error = new Error('Injected unavailable koffi module.')
      error.code = 'MODULE_NOT_FOUND'
      throw error
    }
    const loaded = originalModuleLoad.call(this, request, parent, isMain)
    if (request !== 'koffi' || process.platform !== 'win32') return loaded
    return new Proxy(loaded, {
      get(target, property, receiver) {
        if (property !== 'load') {
          const value = Reflect.get(target, property, receiver)
          return typeof value === 'function' ? value.bind(target) : value
        }
        return function (libraryName, ...args) {
          const library = target.load(libraryName, ...args)
          if (!/kernel32/i.test(String(libraryName))) return library
          return new Proxy(library, {
            get(libraryTarget, libraryProperty, libraryReceiver) {
              if (libraryProperty !== 'func') {
                const value = Reflect.get(
                  libraryTarget,
                  libraryProperty,
                  libraryReceiver
                )
                return typeof value === 'function'
                  ? value.bind(libraryTarget)
                  : value
              }
              return function (name, ...signature) {
                const native = libraryTarget.func(name, ...signature)
                if (name === 'GetLastError') {
                  return function (...nativeArgs) {
                    if (injectedNativeLastError !== undefined) {
                      const value = injectedNativeLastError
                      injectedNativeLastError = undefined
                      return value
                    }
                    return native(...nativeArgs)
                  }
                }
                if (name !== 'MoveFileExW') return native
                return function (sourceValue, destinationValue, flagsValue) {
                  const source = String(sourceValue)
                  const destination = String(destinationValue)
                  const flags = Number(flagsValue)
                  if (
                    config.kind === 'cleanup' &&
                    config.point === 'before-cleanup-unlink' &&
                    cleanupArtifactComparable !== undefined &&
                    comparable(source) === cleanupArtifactComparable
                  ) {
                    exitAt('before-cleanup-unlink', {
                      artifactPath: cleanupArtifact,
                      kind: 'write-through-rename'
                    })
                  }
                  if (shouldInjectIo('rename', [source, destination])) {
                    injectedNativeLastError = nativeErrorCode()
                    record({
                      event: 'io-fault',
                      operation: 'rename',
                      source,
                      destination,
                      target: destination,
                      code: config.code,
                      flags,
                      syscall: 'MoveFileExW',
                      occurrence: ioMatches
                    })
                    return false
                  }
                  const result = native(sourceValue, destinationValue, flagsValue)
                  record({
                    event: 'rename',
                    source,
                    destination,
                    transport: 'MoveFileExW',
                    flags,
                    result
                  })
                  if (result) afterSuccessfulRename(source, destination)
                  return result
                }
              }
            }
          })
        }
      }
    })
  }

  fs.mkdirSync = function (...args) {
    const target = String(args[0])
    if (shouldInjectIo('mkdir', [target])) {
      record({ event: 'io-fault', operation: 'mkdir', target, code: config.code })
      throw injectedError('mkdir', target)
    }
    const result = original.mkdirSync(...args)
    record({ event: 'mkdir', target })
    return result
  }

  fs.openSync = function (...args) {
    const target = String(args[0])
    if (shouldInjectIo('open', [target])) {
      record({ event: 'io-fault', operation: 'open', target, code: config.code })
      throw injectedError('open', target)
    }
    const descriptor = original.openSync(...args)
    const descriptorKind = original.fstatSync(descriptor).isDirectory()
      ? 'directory'
      : 'file'
    descriptors.set(descriptor, { target, descriptorKind })
    record({ event: 'open', target, flags: args[1], descriptor, descriptorKind })
    return descriptor
  }

  fs.writeSync = function (...args) {
    const descriptor = args[0]
    const descriptorState = descriptors.get(descriptor)
    const target = descriptorState?.target
    if (shouldInjectIo('write', [target])) {
      const written = writePartial(args)
      record({
        event: 'io-fault',
        operation: 'write',
        target,
        code: config.code,
        descriptor,
        descriptorKind: descriptorState?.descriptorKind,
        partialBytes: written
      })
      throw injectedError('write', target)
    }
    if (
      config.kind === 'cleanup' &&
      config.point === 'during-cleanup-overwrite' &&
      target !== undefined &&
      cleanupArtifactComparable !== undefined &&
      comparable(target) === cleanupArtifactComparable
    ) {
      const written = writePartial(args)
      exitAt('during-cleanup-overwrite', {
        artifactPath: cleanupArtifact,
        partialBytes: written
      })
    }
    const result = original.writeSync(...args)
    record({
      event: 'write',
      target,
      descriptor,
      descriptorKind: descriptorState?.descriptorKind,
      bytes: result
    })
    return result
  }

  fs.fsyncSync = function (...args) {
    const descriptor = args[0]
    const descriptorState = descriptors.get(descriptor)
    const target = descriptorState?.target
    const descriptorKind = descriptorState?.descriptorKind
    if (shouldInjectIo('fsync', [target], { descriptor, descriptorKind })) {
      record({
        event: 'io-fault',
        operation: 'fsync',
        target,
        path: target,
        code: config.code,
        errno: injectedErrno(),
        syscall: 'fsync',
        occurrence: ioMatches,
        descriptor,
        descriptorKind,
        powerLossExit: config.exitAfterDirectoryFsyncFault === true
      })
      if (
        config.exitAfterDirectoryFsyncFault === true &&
        descriptorKind === 'directory'
      ) process.exit(121)
      throw injectedError('fsync', target)
    }
    const result = original.fsyncSync(...args)
    record({ event: 'fsync', target, descriptor, descriptorKind })
    return result
  }

  fs.renameSync = function (...args) {
    const source = String(args[0])
    const destination = String(args[1])
    if (shouldInjectIo('rename', [source, destination])) {
      record({
        event: 'io-fault',
        operation: 'rename',
        source,
        destination,
        code: config.code
      })
      throw injectedError('rename', destination)
    }
    const result = original.renameSync(...args)
    record({ event: 'rename', source, destination, transport: 'renameSync' })
    afterSuccessfulRename(source, destination)
    return result
  }

  const remove = (kind, delegate, args) => {
    const target = String(args[0])
    if (
      config.kind === 'cleanup' &&
      config.point === 'before-cleanup-unlink' &&
      cleanupArtifactComparable !== undefined &&
      comparable(target) === cleanupArtifactComparable
    ) {
      exitAt('before-cleanup-unlink', { artifactPath: cleanupArtifact, kind })
    }
    const result = delegate(...args)
    record({ event: kind, target })
    return result
  }
  fs.rmSync = function (...args) {
    return remove('rm', original.rmSync, args)
  }
  fs.unlinkSync = function (...args) {
    return remove('unlink', original.unlinkSync, args)
  }
  fs.closeSync = function (...args) {
    try {
      return original.closeSync(...args)
    } finally {
      descriptors.delete(args[0])
    }
  }

  syncBuiltinESMExports()
}
`

let workerFixture: PassportWorkerTestFixture
let workerFaultPreloadDirectory = ''
let workerFaultPreloadPath = ''

class PersistenceProcess {
  readonly child: ChildProcess

  constructor(fault?: PersistenceProcessFault) {
    const env = { ...process.env }
    const execArgv: string[] = []
    if (fault) {
      env[PASSPORT_WORKER_FAULT_ENV] = JSON.stringify(fault)
      execArgv.push('--require', workerFaultPreloadPath)
    } else {
      delete env[PASSPORT_WORKER_FAULT_ENV]
    }
    this.child = fork(workerFixture.entry, [], {
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      execArgv,
      serialization: 'advanced',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    })
    this.child.stdout?.resume()
    this.child.stderr?.resume()
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
  workerFaultPreloadDirectory = mkdtempSync(
    join(process.cwd(), '.passport-test-worker-fault-')
  )
  workerFaultPreloadPath = join(workerFaultPreloadDirectory, 'fault-preload.cjs')
  writeFileSync(workerFaultPreloadPath, PASSPORT_WORKER_FAULT_PRELOAD, 'utf8')
})

afterAll(() => {
  workerFixture.cleanup()
  rmSync(workerFaultPreloadDirectory, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100
  })
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

function spawnWorker(fault?: PersistenceProcessFault): PersistenceProcess {
  const worker = new PersistenceProcess(fault)
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

const repairArtifacts = ['.anchor.key', '.anchor.json', '.anchor.pending.json'] as const

interface WorkerDatabaseSnapshot {
  databaseId: string
  passportJson: string | undefined
  privacyJson: string
  artifacts: Record<string, string | undefined>
}

function snapshotFiles(directory: string): Record<string, Buffer> {
  return Object.fromEntries(readdirSync(directory).map((name) => [
    name,
    readFileSync(join(directory, name))
  ]))
}

function restoreFiles(directory: string, files: Record<string, Buffer>): void {
  rmSync(directory, { recursive: true, force: true })
  mkdirSync(directory, { recursive: true })
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(join(directory, name), bytes)
  }
}

function cloneDirectory(source: string, name: string): string {
  const container = mkdtempSync(join(process.cwd(), `.passport-worker-${name}-`))
  directories.push(container)
  const snapshot = join(container, 'snapshot')
  cpSync(source, snapshot, { recursive: true })
  return snapshot
}

function restoreDirectory(source: string, destination: string): void {
  rmSync(destination, { recursive: true, force: true })
  cpSync(source, destination, { recursive: true })
}

function lastHighWaterMarker(path: string, copy: 'a' | 'b'): string {
  const directory = `${path}.repair-high-water-${copy}`
  const names = readdirSync(directory)
    .filter((name) => /^\d{16}\.json$/.test(name))
    .sort()
  const name = names[names.length - 1]
  if (!name) throw new Error(`Missing repair high-water ${copy} marker.`)
  return join(directory, name)
}

type SparseReplacementKind = 'runtime-log' | 'tombstone' | 'receipt' | 'settings'

function writeSparseReplacementState(
  path: string,
  kind: SparseReplacementKind,
  sentinel: string
): void {
  const database = new DatabaseSync(path)
  try {
    switch (kind) {
      case 'runtime-log':
        database.prepare(`
          INSERT INTO passport_runtime_log (
            log_id, created_at, kind, payload_json, data_class
          ) VALUES (?, 1, 'replacement', ?, 'D1')
        `).run(`log-${sentinel}`, JSON.stringify({ sentinel }))
        break
      case 'tombstone':
        database.prepare(`
          INSERT INTO passport_deletion_tombstone (
            tombstone_id, data_class, deleted_at, subject_hashes_json,
            previous_hash, record_hash
          ) VALUES (?, 'D1', 1, ?, NULL, ?)
        `).run(`tombstone-${sentinel}`, JSON.stringify([sentinel]), 'a'.repeat(64))
        break
      case 'receipt':
        database.prepare(`
          INSERT INTO passport_mutation_receipt (
            operation_id, mutation_kind, generation, result_hash, result_json, applied_at
          ) VALUES (?, 'privacy-delete:D1', 1, ?, ?, 1)
        `).run(`receipt-${sentinel}`, 'b'.repeat(64), JSON.stringify({ sentinel }))
        break
      case 'settings':
        database.prepare(`
          UPDATE passport_settings
          SET config_json = ?, kill_switch = 1
          WHERE singleton = 1
        `).run(JSON.stringify({
          ...DEFAULT_PASSPORT_CONFIG,
          communicationChannel: sentinel
        }))
        break
    }
    database.exec('PRAGMA wal_checkpoint(FULL)')
  } finally {
    database.close()
  }
}

function sparseReplacementContains(
  path: string,
  kind: SparseReplacementKind,
  sentinel: string
): boolean {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const query = kind === 'runtime-log'
      ? "SELECT payload_json AS value FROM passport_runtime_log LIMIT 1"
      : kind === 'tombstone'
        ? "SELECT subject_hashes_json AS value FROM passport_deletion_tombstone LIMIT 1"
        : kind === 'receipt'
          ? "SELECT result_json AS value FROM passport_mutation_receipt LIMIT 1"
          : "SELECT config_json AS value FROM passport_settings WHERE singleton = 1"
    const row = database.prepare(query).get() as { value?: unknown } | undefined
    return String(row?.value ?? '').includes(sentinel)
  } finally {
    database.close()
  }
}

function readAllFiles(directory: string): Buffer[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? readAllFiles(path) : [readFileSync(path)]
  })
}

function readWorkerDatabaseSnapshot(path: string, stintId: string): WorkerDatabaseSnapshot {
  const db = new DatabaseSync(path)
  try {
    const identity = db.prepare(
      "SELECT value FROM passport_meta WHERE key = 'database_id'"
    ).get() as { value?: string } | undefined
    const settings = db.prepare(
      'SELECT privacy_json FROM passport_settings WHERE singleton = 1'
    ).get() as { privacy_json?: string } | undefined
    const passport = db.prepare(
      'SELECT passport_json FROM stint_passport WHERE stint_id = ?'
    ).get(stintId) as { passport_json?: string } | undefined
    return {
      databaseId: identity?.value ?? '',
      passportJson: passport?.passport_json,
      privacyJson: settings?.privacy_json ?? '',
      artifacts: Object.fromEntries(repairArtifacts.map((suffix) => {
        const artifactPath = `${path}${suffix}`
        return [suffix, existsSync(artifactPath)
          ? readFileSync(artifactPath).toString('base64')
          : undefined]
      }))
    }
  } finally {
    db.close()
  }
}

async function seedWorkerDatabase(
  path: string,
  stintId: string,
  sentinel: string
): Promise<WorkerDatabaseSnapshot> {
  const worker = spawnWorker()
  await rpc(worker, 'initialize', [path])
  await rpc(worker, 'setPrivacy', [privacy(true)])
  await rpc(worker, 'persistPassport', [
    passport(stintId, 1, sentinel),
    event(1, stintId)
  ])
  await rpc(worker, 'flush')
  await worker.terminate()
  const snapshot = readWorkerDatabaseSnapshot(path, stintId)
  expect(snapshot.databaseId).toMatch(/^[a-f0-9]{48}$/)
  expect(snapshot.passportJson).toContain(sentinel)
  expect(JSON.parse(snapshot.privacyJson)).toMatchObject({
    identityPersistenceOptIn: true
  })
  expect(snapshot.artifacts['.anchor.key']).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
  expect(snapshot.artifacts['.anchor.json']).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
  expect(snapshot.artifacts['.anchor.pending.json']).toBeUndefined()
  return snapshot
}

async function captureAuthorizedRepairJournal(
  path: string,
  stintId: string,
  operationId: string
): Promise<{ journal: string; snapshot: WorkerDatabaseSnapshot }> {
  const snapshot = await seedWorkerDatabase(path, stintId, `REPAIR-${stintId}`)
  const marker = new DatabaseSync(path)
  marker.prepare("UPDATE passport_meta SET value = 'corrupt' WHERE key = 'integrity_state'").run()
  marker.close()

  const crashingRepair = spawnWorker()
  await rpc(crashingRepair, 'initialize', [path])
  const integrity = await rpc(crashingRepair, 'getIntegrity')
  const repairToken = (integrity.result as { repairToken?: string }).repairToken
  expect(repairToken).toMatch(/^[a-f0-9]+$/)
  await rpc(crashingRepair, 'configureCrashBoundary', [{
    operation: 'repairPersistence',
    checkpoint: 'after-repair-journal'
  }])
  await expect(rpc(crashingRepair, 'repairPersistence', [repairToken, operationId]))
    .rejects.toThrow(/exited/i)

  const journalPath = `${path}.repair-journal.json`
  expect(JSON.parse(readFileSync(journalPath, 'utf8'))).toMatchObject({
    operationId,
    phase: 'authorized'
  })
  return {
    journal: readFileSync(journalPath, 'utf8'),
    snapshot
  }
}

async function captureReceiptStagedRepairJournal(
  path: string,
  stintId: string,
  operationId: string
): Promise<string> {
  await seedWorkerDatabase(path, stintId, `REPAIR-FINAL-${stintId}`)
  const marker = new DatabaseSync(path)
  marker.prepare("UPDATE passport_meta SET value = 'corrupt' WHERE key = 'integrity_state'").run()
  marker.close()

  const crashingRepair = spawnWorker()
  await rpc(crashingRepair, 'initialize', [path])
  const integrity = await rpc(crashingRepair, 'getIntegrity')
  const repairToken = (integrity.result as { repairToken?: string }).repairToken
  expect(repairToken).toMatch(/^[a-f0-9]+$/)
  await rpc(crashingRepair, 'configureCrashBoundary', [{
    operation: 'repairPersistence',
    checkpoint: 'after-repair-receipt-promotion'
  }])
  await expect(rpc(crashingRepair, 'repairPersistence', [repairToken, operationId]))
    .rejects.toThrow(/exited/i)

  const journal = readFileSync(`${path}.repair-journal.json`, 'utf8')
  expect(JSON.parse(journal)).toMatchObject({ operationId, phase: 'receipt-staged' })
  return journal
}

async function crashRepairAtCheckpoint(
  path: string,
  stintId: string,
  operationId: string,
  checkpoint: string,
  expectedPhase: string
): Promise<{
  authority: string
  journal: string
  repairToken: string
  original: WorkerDatabaseSnapshot
}> {
  const original = await seedWorkerDatabase(path, stintId, `REPAIR-PHASE-${stintId}`)
  const marker = new DatabaseSync(path)
  marker.prepare("UPDATE passport_meta SET value = 'corrupt' WHERE key = 'integrity_state'").run()
  marker.close()

  const crashingRepair = spawnWorker()
  await rpc(crashingRepair, 'initialize', [path])
  const integrity = await rpc(crashingRepair, 'getIntegrity')
  const repairToken = (integrity.result as { repairToken?: string }).repairToken ?? ''
  expect(repairToken).toMatch(/^[a-f0-9]+$/)
  await rpc(crashingRepair, 'configureCrashBoundary', [{
    operation: 'repairPersistence',
    checkpoint
  }])
  await expect(rpc(crashingRepair, 'repairPersistence', [repairToken, operationId]))
    .rejects.toThrow(/exited/i)

  const journal = readFileSync(`${path}.repair-journal.json`, 'utf8')
  expect(JSON.parse(journal)).toMatchObject({ operationId, phase: expectedPhase })
  return {
    authority: readFileSync(`${path}.repair-authority.json`, 'utf8'),
    journal,
    repairToken,
    original
  }
}

interface RepairAuthorityTestState {
  authorityId: string
  profileBinding: string
  completedEpoch: number
  highWaterRevision: number
  currentDatabaseId: string
  signature: string
  lastCompleted?: {
    repairEpoch: number
    operationId: string
    tokenHash: string
    originalDatabaseId: string
    databaseId: string
    finalJournalSignature: string
    journalCleanupPending: boolean
  }
}

interface RepairHighWaterTestState {
  authorityId: string
  profileBinding: string
  revision: number
  repairEpoch: number
  phase: string
  databaseId: string
  operationId?: string
  tokenHash?: string
  originalDatabaseId?: string
  journalSignature?: string
  signature: string
}

interface RepairReceiptTestState {
  operationId: string
  tokenHash: string
  databaseId: string
  quarantinedPath: string
  repairedAt: number
}

interface WorkerFaultTrace {
  event: string
  point?: string
  operation?: InjectedIoOperation
  source?: string
  destination?: string
  artifactPath?: string
  target?: string
  path?: string
  code?: InjectedIoCode
  errno?: number
  syscall?: string
  occurrence?: number
  descriptor?: number
  descriptorKind?: InjectedIoDescriptorKind
  powerLossExit?: boolean
  flags?: number
  transport?: string
  result?: boolean
}

interface BootstrapFaultBoundary {
  label: string
  operation: InjectedIoOperation
  target(path: string): string
}

const initialHighWaterMarkerName = '0000000000000000.json'
const bootstrapFaultBoundaries: readonly BootstrapFaultBoundary[] = [
  {
    label: 'authority-key file create',
    operation: 'open',
    target: (path) => `${path}.repair-authority.key.pending`
  },
  {
    label: 'authority-key write',
    operation: 'write',
    target: (path) => `${path}.repair-authority.key.pending`
  },
  {
    label: 'authority-key fsync',
    operation: 'fsync',
    target: (path) => `${path}.repair-authority.key.pending`
  },
  {
    label: 'authority-key rename',
    operation: 'rename',
    target: (path) => `${path}.repair-authority.key`
  },
  {
    label: 'high-water A directory create',
    operation: 'mkdir',
    target: (path) => `${path}.repair-high-water-a`
  },
  {
    label: 'high-water A marker create',
    operation: 'open',
    target: (path) => join(
      `${path}.repair-high-water-a`,
      `${initialHighWaterMarkerName}.pending`
    )
  },
  {
    label: 'high-water A marker write',
    operation: 'write',
    target: (path) => join(
      `${path}.repair-high-water-a`,
      `${initialHighWaterMarkerName}.pending`
    )
  },
  {
    label: 'high-water A marker fsync',
    operation: 'fsync',
    target: (path) => join(
      `${path}.repair-high-water-a`,
      `${initialHighWaterMarkerName}.pending`
    )
  },
  {
    label: 'high-water A marker rename',
    operation: 'rename',
    target: (path) => join(`${path}.repair-high-water-a`, initialHighWaterMarkerName)
  },
  {
    label: 'high-water B directory create',
    operation: 'mkdir',
    target: (path) => `${path}.repair-high-water-b`
  },
  {
    label: 'high-water B marker create',
    operation: 'open',
    target: (path) => join(
      `${path}.repair-high-water-b`,
      `${initialHighWaterMarkerName}.pending`
    )
  },
  {
    label: 'high-water B marker write',
    operation: 'write',
    target: (path) => join(
      `${path}.repair-high-water-b`,
      `${initialHighWaterMarkerName}.pending`
    )
  },
  {
    label: 'high-water B marker fsync',
    operation: 'fsync',
    target: (path) => join(
      `${path}.repair-high-water-b`,
      `${initialHighWaterMarkerName}.pending`
    )
  },
  {
    label: 'high-water B marker rename',
    operation: 'rename',
    target: (path) => join(`${path}.repair-high-water-b`, initialHighWaterMarkerName)
  },
  {
    label: 'authority-state file create',
    operation: 'open',
    target: (path) => `${path}.repair-authority.json.pending`
  },
  {
    label: 'authority-state write',
    operation: 'write',
    target: (path) => `${path}.repair-authority.json.pending`
  },
  {
    label: 'authority-state fsync',
    operation: 'fsync',
    target: (path) => `${path}.repair-authority.json.pending`
  },
  {
    label: 'authority-state rename',
    operation: 'rename',
    target: (path) => `${path}.repair-authority.json`
  }
]

const bootstrapFaultCases: ReadonlyArray<readonly [
  label: string,
  code: InjectedIoCode,
  operation: InjectedIoOperation,
  target: (path: string) => string
]> = bootstrapFaultBoundaries.flatMap((boundary) =>
  (['ENOSPC', 'EIO'] as const).map((code) => [
    boundary.label,
    code,
    boundary.operation,
    boundary.target
  ] as const)
)

function readRepairAuthorityState(path: string): RepairAuthorityTestState {
  return JSON.parse(
    readFileSync(`${path}.repair-authority.json`, 'utf8')
  ) as RepairAuthorityTestState
}

function readCurrentRepairHighWater(path: string): RepairHighWaterTestState {
  const left = readFileSync(lastHighWaterMarker(path, 'a'))
  const right = readFileSync(lastHighWaterMarker(path, 'b'))
  expect(left).toEqual(right)
  return JSON.parse(left.toString('utf8')) as RepairHighWaterTestState
}

function readRepairReceiptState(path: string): RepairReceiptTestState {
  return JSON.parse(
    readFileSync(`${path}.repair-receipt.json`, 'utf8')
  ) as RepairReceiptTestState
}

function expectInitialRepairSecurity(
  path: string,
  databaseId: string
): void {
  const key = readFileSync(`${path}.repair-authority.key`, 'utf8')
  expect(key).toMatch(/^[a-f0-9]{64}\n$/)
  expect(existsSync(`${path}.repair-authority.json.pending`)).toBe(false)

  const authority = readRepairAuthorityState(path)
  const highWater = readCurrentRepairHighWater(path)
  expect(authority).toMatchObject({
    authorityId: expect.stringMatching(/^[a-f0-9]{48}$/),
    profileBinding: expect.stringMatching(/^[a-f0-9]{64}$/),
    completedEpoch: 0,
    highWaterRevision: 0,
    currentDatabaseId: databaseId,
    signature: expect.stringMatching(/^[a-f0-9]{64}$/)
  })
  expect(authority.lastCompleted).toBeUndefined()
  expect(highWater).toMatchObject({
    authorityId: authority.authorityId,
    profileBinding: authority.profileBinding,
    revision: 0,
    repairEpoch: 0,
    phase: 'idle',
    databaseId,
    signature: expect.stringMatching(/^[a-f0-9]{64}$/)
  })
  expect(readdirSync(`${path}.repair-high-water-a`).sort())
    .toEqual([initialHighWaterMarkerName])
  expect(readdirSync(`${path}.repair-high-water-b`).sort())
    .toEqual([initialHighWaterMarkerName])
  expect(snapshotFiles(`${path}.repair-high-water-a`))
    .toEqual(snapshotFiles(`${path}.repair-high-water-b`))
  for (const suffix of [
    '.repair-journal.json',
    '.repair-journal.json.pending',
    '.repair-journal.json.cleanup',
    '.repair-receipt.json',
    '.repair-receipt.json.pending'
  ]) {
    expect(existsSync(`${path}${suffix}`)).toBe(false)
  }
}

function snapshotTree(
  path: string,
  key: string,
  result: Record<string, string>
): void {
  const entries = readdirSync(path, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of entries) {
    const entryPath = join(path, entry.name)
    const entryKey = `${key}/${entry.name}`
    if (entry.isDirectory()) {
      snapshotTree(entryPath, entryKey, result)
    } else {
      result[entryKey] = readFileSync(entryPath).toString('base64')
    }
  }
}

function snapshotRepairArtifactTree(path: string): Record<string, string> {
  const directory = dirname(path)
  const prefix = `${basename(path)}.repair-`
  const result: Record<string, string> = {}
  for (const entry of readdirSync(directory, { withFileTypes: true })
    .filter((candidate) => candidate.name.startsWith(prefix))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      snapshotTree(entryPath, entry.name, result)
    } else {
      result[entry.name] = readFileSync(entryPath).toString('base64')
    }
  }
  return result
}

async function createPristineWorkerProfile(path: string): Promise<WorkerDatabaseSnapshot> {
  const worker = spawnWorker()
  await expect(rpc(worker, 'initialize', [path])).resolves.toMatchObject({ ok: true })
  await worker.terminate()
  const snapshot = readWorkerDatabaseSnapshot(path, 'none')
  expect(snapshot.databaseId).toMatch(/^[a-f0-9]{48}$/)
  expect(snapshot.passportJson).toBeUndefined()
  expect(JSON.parse(snapshot.privacyJson)).toMatchObject({
    identityPersistenceOptIn: false
  })
  return snapshot
}

function markWorkerDatabaseCorrupt(path: string): void {
  const database = new DatabaseSync(path)
  try {
    database.prepare(
      "UPDATE passport_meta SET value = 'corrupt' WHERE key = 'integrity_state'"
    ).run()
    database.exec('PRAGMA wal_checkpoint(FULL)')
  } finally {
    database.close()
  }
}

async function captureReceiptStagedRepairForExistingDatabase(
  path: string,
  operationId: string
): Promise<{ journal: string; repairToken: string }> {
  markWorkerDatabaseCorrupt(path)
  const crashingRepair = spawnWorker()
  await expect(rpc(crashingRepair, 'initialize', [path])).resolves.toMatchObject({ ok: true })
  const integrity = await rpc(crashingRepair, 'getIntegrity')
  const repairToken = (integrity.result as { repairToken?: string }).repairToken ?? ''
  expect(repairToken).toMatch(/^[a-f0-9]+$/)
  await rpc(crashingRepair, 'configureCrashBoundary', [{
    operation: 'repairPersistence',
    checkpoint: 'after-repair-receipt-promotion'
  }])
  await expect(rpc(crashingRepair, 'repairPersistence', [repairToken, operationId]))
    .rejects.toThrow(/exited/i)
  const journal = readFileSync(`${path}.repair-journal.json`, 'utf8')
  expect(JSON.parse(journal)).toMatchObject({
    operationId,
    phase: 'receipt-staged'
  })
  return { journal, repairToken }
}

async function finishReceiptStagedRepair(path: string): Promise<void> {
  const finisher = spawnWorker()
  await expect(rpc(finisher, 'initialize', [path], 10_000))
    .resolves.toMatchObject({ ok: true })
  await expect(rpc(finisher, 'getAuthoritativeState')).resolves.toMatchObject({
    ok: true,
    result: {
      privacy: { identityPersistenceOptIn: false },
      roster: [],
      passports: []
    }
  })
  await finisher.terminate()
}

function removeRepairSecurityComponent(
  path: string,
  component: 'key' | 'high-water' | 'authority'
): void {
  if (component === 'key') {
    rmSync(`${path}.repair-authority.key`, { force: true })
    return
  }
  if (component === 'high-water') {
    rmSync(`${path}.repair-high-water-a`, { recursive: true, force: true })
    rmSync(`${path}.repair-high-water-b`, { recursive: true, force: true })
    return
  }
  rmSync(`${path}.repair-authority.json`, { force: true })
  rmSync(`${path}.repair-authority.json.pending`, { force: true })
}

function readWorkerFaultTrace(path: string): WorkerFaultTrace[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as WorkerFaultTrace)
}

async function crashCompletedJournalCleanup(
  path: string,
  point: CleanupFaultPoint,
  label: string
): Promise<{ artifactPath?: string; trace: WorkerFaultTrace[] }> {
  const tracePath = `${path}.fault-${label}.jsonl`
  rmSync(tracePath, { force: true })
  const crashing = spawnWorker({
    kind: 'cleanup',
    point,
    journalPath: `${path}.repair-journal.json`,
    authorityPath: `${path}.repair-authority.json`,
    tracePath
  })
  await expect(rpc(crashing, 'initialize', [path], 10_000)).rejects.toThrow(/exited/i)
  const trace = readWorkerFaultTrace(tracePath)
  const artifactPath = [...trace].reverse()
    .find((entry) => entry.artifactPath)?.artifactPath
  if (point !== 'after-completed-authority-promotion') {
    expect(artifactPath).toEqual(expect.any(String))
  }
  return { artifactPath, trace }
}

function expectMatchingCompletedCleanupProof(
  path: string,
  artifactPath: string
): WorkerDatabaseSnapshot {
  const authority = readRepairAuthorityState(path)
  const highWater = readCurrentRepairHighWater(path)
  const receipt = readRepairReceiptState(path)
  const snapshot = readWorkerDatabaseSnapshot(path, 'none')
  expect(authority.lastCompleted).toMatchObject({
    repairEpoch: authority.completedEpoch,
    operationId: receipt.operationId,
    tokenHash: receipt.tokenHash,
    databaseId: receipt.databaseId,
    journalCleanupPending: true
  })
  expect(highWater).toMatchObject({
    authorityId: authority.authorityId,
    profileBinding: authority.profileBinding,
    revision: authority.highWaterRevision,
    repairEpoch: authority.completedEpoch,
    phase: 'completed',
    databaseId: receipt.databaseId,
    operationId: receipt.operationId,
    tokenHash: receipt.tokenHash,
    journalSignature: authority.lastCompleted?.finalJournalSignature
  })
  expect(authority.currentDatabaseId).toBe(receipt.databaseId)
  expect(snapshot.databaseId).toBe(receipt.databaseId)
  expect(existsSync(`${path}.repair-journal.json`)).toBe(false)
  expect(existsSync(artifactPath)).toBe(true)
  return snapshot
}

function restoreDatabaseBundle(snapshotRoot: string, path: string): void {
  const databaseName = basename(path)
  for (const suffix of [
    '',
    '-wal',
    '-shm',
    '.anchor.key',
    '.anchor.json',
    '.anchor.pending.json'
  ]) {
    const source = join(snapshotRoot, `${databaseName}${suffix}`)
    const destination = `${path}${suffix}`
    rmSync(destination, { force: true })
    if (existsSync(source)) copyFileSync(source, destination)
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

  it('[blocker-B13-a] rejects replay of a completed repair journal without touching a fresh database', async () => {
    const path = tempDatabase('repair-journal-replay')
    const captured = await captureAuthorizedRepairJournal(
      path,
      'old-stint',
      'repair:journal-replay-old'
    )

    const finisher = spawnWorker()
    await expect(rpc(finisher, 'initialize', [path])).resolves.toMatchObject({ ok: true })
    await expect(rpc(finisher, 'getAuthoritativeState')).resolves.toMatchObject({
      ok: true,
      result: { privacy: { identityPersistenceOptIn: false }, passports: [] }
    })
    await finisher.terminate()

    const fresh = await seedWorkerDatabase(path, 'fresh-stint', 'FRESH-DATABASE-SENTINEL')
    expect(fresh.databaseId).not.toBe(captured.snapshot.databaseId)
    writeFileSync(`${path}.repair-journal.json`, captured.journal)

    const replay = spawnWorker()
    const replayInit = await rpc(replay, 'initialize', [path])
    expect(replayInit).toMatchObject({
      ok: false,
      error: expect.stringMatching(/journal|repair|database|replay/i)
    })
    await replay.terminate()

    expect(readWorkerDatabaseSnapshot(path, 'fresh-stint')).toEqual(fresh)
  }, 30_000)

  it('[blocker-B13-a] rejects replay of the final journal after its cleanup marker completed', async () => {
    const path = tempDatabase('repair-final-journal-replay')
    const captured = await captureReceiptStagedRepairJournal(
      path,
      'old-final-stint',
      'repair:final-journal-replay'
    )

    const finisher = spawnWorker()
    await expect(rpc(finisher, 'initialize', [path])).resolves.toMatchObject({ ok: true })
    await finisher.terminate()
    const fresh = await seedWorkerDatabase(path, 'fresh-final-stint', 'FRESH-FINAL-SENTINEL')
    writeFileSync(`${path}.repair-journal.json`, captured)

    const replay = spawnWorker()
    await expect(rpc(replay, 'initialize', [path])).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/journal|repair|replay|quarantined/i)
    })
    await replay.terminate()
    expect(readWorkerDatabaseSnapshot(path, 'fresh-final-stint')).toEqual(fresh)
  }, 30_000)

  it('[blocker-B13-b] fails closed and preserves data and anchors after repair-journal tampering', async () => {
    const path = tempDatabase('repair-journal-tamper')
    const captured = await captureAuthorizedRepairJournal(
      path,
      'tamper-stint',
      'repair:journal-tamper'
    )
    const journalPath = `${path}.repair-journal.json`
    const tampered = JSON.parse(captured.journal) as { tokenHash: string }
    tampered.tokenHash = '0'.repeat(64)
    writeFileSync(journalPath, `${JSON.stringify(tampered)}\n`)

    const restarted = spawnWorker()
    const init = await rpc(restarted, 'initialize', [path])
    expect(init).toMatchObject({
      ok: false,
      error: expect.stringMatching(/journal|repair|auth|invalid/i)
    })
    await restarted.terminate()

    expect(readWorkerDatabaseSnapshot(path, 'tamper-stint')).toEqual(captured.snapshot)
  }, 30_000)

  it('[blocker-B13-c] rejects a structurally valid repair journal copied from another database', async () => {
    const sourcePath = tempDatabase('repair-journal-source')
    const targetPath = tempDatabase('repair-journal-target')
    const source = await captureAuthorizedRepairJournal(
      sourcePath,
      'source-stint',
      'repair:journal-copied'
    )
    const target = await seedWorkerDatabase(
      targetPath,
      'target-stint',
      'COPIED-JOURNAL-TARGET-SENTINEL'
    )
    expect(target.databaseId).not.toBe(source.snapshot.databaseId)

    const copied = JSON.parse(source.journal) as {
      quarantinedPath: string
      repairedAt: number
    }
    copied.quarantinedPath = `${targetPath}.quarantine-${copied.repairedAt}.json`
    writeFileSync(`${targetPath}.repair-journal.json`, `${JSON.stringify(copied)}\n`)

    const restarted = spawnWorker()
    const init = await rpc(restarted, 'initialize', [targetPath])
    expect(init).toMatchObject({
      ok: false,
      error: expect.stringMatching(/journal|repair|auth|database|invalid/i)
    })
    await restarted.terminate()

    expect(readWorkerDatabaseSnapshot(targetPath, 'target-stint')).toEqual(target)
  }, 30_000)

  it.each([
    ['after-repair-journal', 'authorized'],
    ['before-repair-database-header-write', 'erasing-database'],
    ['after-repair-database-erase', 'database-erased'],
    ['after-repair-key-erase', 'keys-erased'],
    ['after-repair-database-identity-assignment', 'creating-database'],
    ['after-repair-database-create', 'database-created'],
    ['after-repair-receipt-promotion', 'receipt-staged']
  ] as const)(
    '[blocker-B14-a] rejects restored %s journal and authority below the monotonic high-water mark',
    async (checkpoint, phase) => {
      const path = tempDatabase(`rollback-${checkpoint}`)
      const operationId = `repair:rollback:${phase}`
      const captured = await crashRepairAtCheckpoint(
        path,
        `rollback-${phase}`,
        operationId,
        checkpoint,
        phase
      )

      const finisher = spawnWorker()
      await expect(rpc(finisher, 'initialize', [path])).resolves.toMatchObject({ ok: true })
      await finisher.terminate()
      const fresh = await seedWorkerDatabase(
        path,
        `fresh-${phase}`,
        `FRESH-HIGH-WATER-${phase}`
      )
      expect(fresh.databaseId).not.toBe(captured.original.databaseId)

      writeFileSync(`${path}.repair-authority.json`, captured.authority)
      writeFileSync(`${path}.repair-journal.json`, captured.journal)
      const replay = spawnWorker()
      await expect(rpc(replay, 'initialize', [path])).resolves.toMatchObject({
        ok: false,
        error: expect.stringMatching(/high-water|monotonic|replay|populated|repair/i)
      })
      await replay.terminate()
      expect(readWorkerDatabaseSnapshot(path, `fresh-${phase}`)).toEqual(fresh)
    },
    30_000
  )

  it('[blocker-B14-a] one current high-water copy defeats rollback of the other copy and repair pair', async () => {
    const path = tempDatabase('rollback-single-high-water-copy')
    const captured = await crashRepairAtCheckpoint(
      path,
      'rollback-single-copy',
      'repair:rollback-single-high-water',
      'after-repair-key-erase',
      'keys-erased'
    )
    const staleHighWater = snapshotFiles(`${path}.repair-high-water-a`)

    const finisher = spawnWorker()
    await expect(rpc(finisher, 'initialize', [path])).resolves.toMatchObject({ ok: true })
    await finisher.terminate()
    const fresh = await seedWorkerDatabase(
      path,
      'fresh-single-copy',
      'FRESH-SINGLE-HIGH-WATER'
    )

    writeFileSync(`${path}.repair-authority.json`, captured.authority)
    writeFileSync(`${path}.repair-journal.json`, captured.journal)
    restoreFiles(`${path}.repair-high-water-a`, staleHighWater)
    const replay = spawnWorker()
    await expect(rpc(replay, 'initialize', [path])).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/high-water|monotonic|replay|repair/i)
    })
    await replay.terminate()
    expect(readWorkerDatabaseSnapshot(path, 'fresh-single-copy')).toEqual(fresh)
    expect(readdirSync(`${path}.repair-high-water-a`))
      .toEqual(readdirSync(`${path}.repair-high-water-b`))
  }, 30_000)

  it.each([
    'after-repair-database-erased-high-water-a-temp-create',
    'after-repair-database-erased-high-water-a-partial-write'
  ])(
    '[blocker-B15-a] resumes erased-database repair after %s with copy B intact',
    async (checkpoint) => {
      const path = tempDatabase(`high-water-${checkpoint}`)
      const operationId = `repair:high-water:${checkpoint}`
      const captured = await crashRepairAtCheckpoint(
        path,
        `high-water-${checkpoint}`,
        operationId,
        checkpoint,
        'database-erased'
      )
      expect(existsSync(path)).toBe(false)
      expect(readdirSync(`${path}.repair-high-water-a`))
        .toContainEqual(expect.stringMatching(/\.json\.pending$/))
      expect(JSON.parse(readFileSync(lastHighWaterMarker(path, 'b'), 'utf8')))
        .toMatchObject({ phase: 'erasing-database' })

      const recovered = spawnWorker()
      await expect(rpc(recovered, 'initialize', [path])).resolves.toMatchObject({ ok: true })
      await expect(rpc(recovered, 'repairPersistence', [
        captured.repairToken,
        operationId
      ])).resolves.toMatchObject({
        ok: true,
        result: { quarantinedPath: expect.stringContaining('.quarantine-') }
      })
      expect(snapshotFiles(`${path}.repair-high-water-a`))
        .toEqual(snapshotFiles(`${path}.repair-high-water-b`))
    },
    30_000
  )

  it.each([
    ['zero', Buffer.alloc(0)],
    ['truncated', Buffer.from('{"version":1')],
    ['invalid', Buffer.from('{}\n')]
  ] as const)(
    '[blocker-B15-b] rebuilds one %s trailing high-water marker from the intact copy',
    async (kind, bytes) => {
      const path = tempDatabase(`high-water-torn-${kind}`)
      const operationId = `repair:high-water-torn:${kind}`
      const captured = await crashRepairAtCheckpoint(
        path,
        `high-water-torn-${kind}`,
        operationId,
        'after-repair-key-erase',
        'keys-erased'
      )
      writeFileSync(lastHighWaterMarker(path, 'a'), bytes)

      const recovered = spawnWorker()
      await expect(rpc(recovered, 'initialize', [path])).resolves.toMatchObject({ ok: true })
      await expect(rpc(recovered, 'repairPersistence', [
        captured.repairToken,
        operationId
      ])).resolves.toMatchObject({ ok: true })
      expect(snapshotFiles(`${path}.repair-high-water-a`))
        .toEqual(snapshotFiles(`${path}.repair-high-water-b`))
    },
    30_000
  )

  it('[blocker-B15-c] fails closed when both trailing high-water markers are torn', async () => {
    const path = tempDatabase('high-water-both-torn')
    await crashRepairAtCheckpoint(
      path,
      'high-water-both-torn',
      'repair:high-water-both-torn',
      'after-repair-key-erase',
      'keys-erased'
    )
    writeFileSync(lastHighWaterMarker(path, 'a'), Buffer.alloc(0))
    writeFileSync(lastHighWaterMarker(path, 'b'), Buffer.from('{"version":1'))

    const replay = spawnWorker()
    await expect(rpc(replay, 'initialize', [path])).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/high-water|both|incomplete|torn/i)
    })
    expect(existsSync(path)).toBe(false)
  }, 30_000)

  it('[blocker-B15-d] fails closed on two authenticated divergent high-water chains', async () => {
    const path = tempDatabase('high-water-divergent')
    await captureAuthorizedRepairJournal(
      path,
      'high-water-divergent',
      'repair:high-water-divergent'
    )
    const root = dirname(path)
    const baseline = cloneDirectory(root, 'high-water-divergent-baseline')

    const firstBranchWorker = spawnWorker()
    await expect(rpc(firstBranchWorker, 'initialize', [path])).resolves.toMatchObject({ ok: true })
    await firstBranchWorker.terminate()
    const fresh = await seedWorkerDatabase(
      path,
      'high-water-divergent-fresh',
      'HIGH-WATER-DIVERGENT-FRESH'
    )
    const firstBranch = cloneDirectory(root, 'high-water-divergent-first')

    restoreDirectory(baseline, root)
    const secondBranchWorker = spawnWorker()
    await expect(rpc(secondBranchWorker, 'initialize', [path])).resolves.toMatchObject({ ok: true })
    await secondBranchWorker.terminate()
    const secondBranch = cloneDirectory(root, 'high-water-divergent-second')

    restoreDirectory(firstBranch, root)
    restoreFiles(
      `${path}.repair-high-water-b`,
      snapshotFiles(join(secondBranch, 'passport.db.repair-high-water-b'))
    )
    expect(readFileSync(lastHighWaterMarker(path, 'a')))
      .not.toEqual(readFileSync(lastHighWaterMarker(path, 'b')))

    const replay = spawnWorker()
    await expect(rpc(replay, 'initialize', [path])).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/high-water|diverg/i)
    })
    await replay.terminate()
    expect(readWorkerDatabaseSnapshot(path, 'high-water-divergent-fresh')).toEqual(fresh)
  }, 40_000)

  it.each([
    ['before-repair-database-header-write', 'readable'],
    ['after-repair-database-header-write', 'unreadable'],
    ['before-repair-database-unlink', 'unreadable'],
    ['after-repair-database-unlink', 'absent']
  ] as const)(
    '[blocker-B14-b] resumes an authenticated erasing-database repair after %s',
    async (checkpoint, databaseState) => {
      const path = tempDatabase(`erase-fault-${checkpoint}`)
      const operationId = `repair:erase-fault:${checkpoint}`
      const captured = await crashRepairAtCheckpoint(
        path,
        `erase-${checkpoint}`,
        operationId,
        checkpoint,
        'erasing-database'
      )

      if (databaseState === 'readable') {
        expect(readWorkerDatabaseSnapshot(path, `erase-${checkpoint}`).passportJson)
          .toContain(`REPAIR-PHASE-erase-${checkpoint}`)
      } else if (databaseState === 'unreadable') {
        expect(existsSync(path)).toBe(true)
        expect(() => readWorkerDatabaseSnapshot(path, `erase-${checkpoint}`)).toThrow()
      } else {
        expect(existsSync(path)).toBe(false)
      }

      const recovered = spawnWorker()
      await expect(rpc(recovered, 'initialize', [path])).resolves.toMatchObject({ ok: true })
      await expect(rpc(recovered, 'getAuthoritativeState')).resolves.toMatchObject({
        ok: true,
        result: {
          privacy: { identityPersistenceOptIn: false },
          roster: [],
          passports: []
        }
      })
      await expect(rpc(recovered, 'repairPersistence', [
        captured.repairToken,
        operationId
      ])).resolves.toMatchObject({
        ok: true,
        result: { quarantinedPath: expect.stringContaining('.quarantine-') }
      })
    },
    30_000
  )

  it('[blocker-B14-c] rejects a tampered erasing journal without touching the partial database', async () => {
    const path = tempDatabase('erase-tampered-journal')
    const captured = await crashRepairAtCheckpoint(
      path,
      'erase-tampered',
      'repair:erase-tampered-journal',
      'after-repair-database-header-write',
      'erasing-database'
    )
    const partial = readFileSync(path)
    const journal = JSON.parse(captured.journal) as { tokenHash: string }
    journal.tokenHash = 'f'.repeat(64)
    writeFileSync(`${path}.repair-journal.json`, `${JSON.stringify(journal)}\n`)

    const replay = spawnWorker()
    await expect(rpc(replay, 'initialize', [path])).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/journal|auth|repair|invalid/i)
    })
    await replay.terminate()
    expect(readFileSync(path)).toEqual(partial)
  }, 30_000)

  it('[blocker-B14-d] refuses erasing-database resume against a newer populated identity', async () => {
    const path = tempDatabase('erase-wrong-identity')
    await crashRepairAtCheckpoint(
      path,
      'erase-original',
      'repair:erase-wrong-identity',
      'before-repair-database-header-write',
      'erasing-database'
    )
    const replacementPath = tempDatabase('erase-replacement-source')
    const replacement = await seedWorkerDatabase(
      replacementPath,
      'replacement-stint',
      'REPLACEMENT-DATABASE-SENTINEL'
    )
    for (const suffix of ['', '-wal', '-shm', '.anchor.key', '.anchor.json', '.anchor.pending.json']) {
      rmSync(`${path}${suffix}`, { force: true })
      if (existsSync(`${replacementPath}${suffix}`)) {
        copyFileSync(`${replacementPath}${suffix}`, `${path}${suffix}`)
      }
    }
    const before = readWorkerDatabaseSnapshot(path, 'replacement-stint')
    expect(before).toEqual(replacement)

    const replay = spawnWorker()
    await expect(rpc(replay, 'initialize', [path])).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/identity|newer|repair|database/i)
    })
    await replay.terminate()
    expect(readWorkerDatabaseSnapshot(path, 'replacement-stint')).toEqual(before)
  }, 30_000)

  it('[blocker-B15-e] rejects an arbitrary opt-out database before assigned fresh creation', async () => {
    const path = tempDatabase('creating-wrong-identity')
    const operationId = 'repair:creating-wrong-identity'
    const captured = await crashRepairAtCheckpoint(
      path,
      'creating-wrong-identity',
      operationId,
      'after-repair-database-identity-assignment',
      'creating-database'
    )
    const journal = JSON.parse(captured.journal) as { databaseId: string }
    const replacementPath = tempDatabase('creating-wrong-identity-source')
    const replacementWorker = spawnWorker()
    await expect(rpc(replacementWorker, 'initialize', [replacementPath]))
      .resolves.toMatchObject({ ok: true })
    await replacementWorker.terminate()
    const replacement = readWorkerDatabaseSnapshot(replacementPath, 'none')
    expect(replacement.databaseId).not.toBe(journal.databaseId)
    copyFileSync(replacementPath, path)

    const replay = spawnWorker()
    await expect(rpc(replay, 'initialize', [path])).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/assigned|identity|replacement|creating/i)
    })
    await replay.terminate()
    expect(readWorkerDatabaseSnapshot(path, 'none').databaseId).toBe(replacement.databaseId)

    for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true })
    const recovered = spawnWorker()
    await expect(rpc(recovered, 'initialize', [path])).resolves.toMatchObject({ ok: true })
    expect(readWorkerDatabaseSnapshot(path, 'none').databaseId).toBe(journal.databaseId)
    await expect(rpc(recovered, 'repairPersistence', [
      captured.repairToken,
      operationId
    ])).resolves.toMatchObject({ ok: true })
  }, 30_000)

  it.each([
    'runtime-log',
    'tombstone',
    'receipt',
    'settings'
  ] as const)(
    '[blocker-B15-e] keys-erased rejects an unassigned opt-out database with only %s state',
    async (kind) => {
      const path = tempDatabase(`keys-erased-sparse-${kind}`)
      const operationId = `repair:keys-erased-sparse:${kind}`
      const captured = await crashRepairAtCheckpoint(
        path,
        `keys-erased-sparse-${kind}`,
        operationId,
        'after-repair-key-erase',
        'keys-erased'
      )
      const replacementPath = tempDatabase(`keys-erased-source-${kind}`)
      const replacementWorker = spawnWorker()
      await expect(rpc(replacementWorker, 'initialize', [replacementPath]))
        .resolves.toMatchObject({ ok: true })
      await replacementWorker.terminate()
      const sentinel = `KEYS-ERASED-${kind.toUpperCase()}-SENTINEL`
      writeSparseReplacementState(replacementPath, kind, sentinel)
      copyFileSync(replacementPath, path)
      expect(sparseReplacementContains(path, kind, sentinel)).toBe(true)

      const replay = spawnWorker()
      await expect(rpc(replay, 'initialize', [path])).resolves.toMatchObject({
        ok: false,
        error: expect.stringMatching(/keys-erased|unassigned|replacement/i)
      })
      await replay.terminate()
      expect(sparseReplacementContains(path, kind, sentinel)).toBe(true)

      for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true })
      const recovered = spawnWorker()
      await expect(rpc(recovered, 'initialize', [path])).resolves.toMatchObject({ ok: true })
      expect(sparseReplacementContains(path, kind, sentinel)).toBe(false)
      await expect(rpc(recovered, 'repairPersistence', [
        captured.repairToken,
        operationId
      ])).resolves.toMatchObject({ ok: true })
    },
    30_000
  )

  it('[blocker-B15-e] rejects a pristine database bound to another repair authority', async () => {
    const path = tempDatabase('creating-cross-authority')
    const operationId = 'repair:creating-cross-authority'
    const target = await crashRepairAtCheckpoint(
      path,
      'creating-cross-authority',
      operationId,
      'after-repair-database-identity-assignment',
      'creating-database'
    )
    const targetJournal = JSON.parse(target.journal) as {
      databaseId: string
      repairEpoch: number
    }
    const sourcePath = tempDatabase('creating-cross-authority-source')
    const source = await crashRepairAtCheckpoint(
      sourcePath,
      'creating-cross-authority-source',
      'repair:creating-cross-authority-source',
      'after-repair-database-schema-create',
      'creating-database'
    )
    const sourceJournal = JSON.parse(source.journal) as { databaseId: string }
    copyFileSync(
      `${sourcePath}.repair-create-${sourceJournal.databaseId}.sqlite`,
      path
    )
    const replacement = new DatabaseSync(path)
    replacement.prepare(
      "UPDATE passport_meta SET value = ? WHERE key = 'database_id'"
    ).run(targetJournal.databaseId)
    replacement.prepare(
      "UPDATE passport_meta SET value = ? WHERE key = 'repair_creation_epoch'"
    ).run(String(targetJournal.repairEpoch))
    replacement.exec('PRAGMA wal_checkpoint(FULL)')
    replacement.close()

    const replay = spawnWorker()
    await expect(rpc(replay, 'initialize', [path])).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/assigned|binding|identity|replacement|creating/i)
    })
    await replay.terminate()
    expect(readWorkerDatabaseSnapshot(path, 'none').databaseId).toBe(targetJournal.databaseId)

    for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true })
    const recovered = spawnWorker()
    await expect(rpc(recovered, 'initialize', [path])).resolves.toMatchObject({ ok: true })
    expect(readWorkerDatabaseSnapshot(path, 'none').databaseId).toBe(targetJournal.databaseId)
    await expect(rpc(recovered, 'repairPersistence', [
      target.repairToken,
      operationId
    ])).resolves.toMatchObject({ ok: true })
  }, 30_000)

  it.each([
    'runtime-log',
    'tombstone',
    'receipt',
    'settings'
  ] as const)(
    '[blocker-B15-f] rejects assigned-identity opt-out replacement with only %s state',
    async (kind) => {
      const path = tempDatabase(`creating-sparse-${kind}`)
      const operationId = `repair:creating-sparse:${kind}`
      const captured = await crashRepairAtCheckpoint(
        path,
        `creating-sparse-${kind}`,
        operationId,
        'after-repair-database-schema-create',
        'creating-database'
      )
      const journal = JSON.parse(captured.journal) as { databaseId: string }
      const stagingPath = `${path}.repair-create-${journal.databaseId}.sqlite`
      expect(existsSync(stagingPath)).toBe(true)
      copyFileSync(stagingPath, path)
      const sentinel = `SPARSE-${kind.toUpperCase()}-SENTINEL`
      writeSparseReplacementState(path, kind, sentinel)
      expect(sparseReplacementContains(path, kind, sentinel)).toBe(true)

      const replay = spawnWorker()
      await expect(rpc(replay, 'initialize', [path])).resolves.toMatchObject({
        ok: false,
        error: expect.stringMatching(/non-default|replacement|fresh|creating/i)
      })
      await replay.terminate()
      expect(sparseReplacementContains(path, kind, sentinel)).toBe(true)

      for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true })
      const recovered = spawnWorker()
      await expect(rpc(recovered, 'initialize', [path])).resolves.toMatchObject({ ok: true })
      expect(readWorkerDatabaseSnapshot(path, 'none').databaseId).toBe(journal.databaseId)
      expect(sparseReplacementContains(path, kind, sentinel)).toBe(false)
      await expect(rpc(recovered, 'repairPersistence', [
        captured.repairToken,
        operationId
      ])).resolves.toMatchObject({ ok: true })
    },
    30_000
  )

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
    ['after-repair-database-identity-assignment', 'creating-database'],
    ['after-repair-database-file-open', 'creating-database'],
    ['after-repair-database-identity-create', 'creating-database'],
    ['after-repair-database-schema-create', 'creating-database'],
    ['after-repair-database-create', 'database-created'],
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
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        operationId: string
        phase: string
        databaseId?: string
      }
      expect(journal).toMatchObject({
        operationId,
        phase: expectedPhase
      })
      if (expectedPhase === 'creating-database') {
        expect(journal.databaseId).toMatch(/^[a-f0-9]{48}$/)
      }
      if (checkpoint === 'after-repair-receipt-temp-write') {
        expect(existsSync(`${path}.repair-receipt.json.pending`)).toBe(true)
      }
      if (checkpoint === 'after-repair-receipt-promotion') {
        expect(existsSync(`${path}.repair-receipt.json`)).toBe(true)
      }

      const recovered = spawnWorker()
      await expect(rpc(recovered, 'initialize', [path])).resolves.toMatchObject({ ok: true })
      if (journal.databaseId) {
        expect(readWorkerDatabaseSnapshot(path, 'worker-stint').databaseId)
          .toBe(journal.databaseId)
      }
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
      const artifacts = readAllFiles(dirname(path))
      for (const bytes of artifacts) {
        expect(bytes.includes(Buffer.from(sentinel))).toBe(false)
      }
    },
    30_000
  )

  it.each(bootstrapFaultCases)(
    '[blocker-bootstrap] resumes fresh repair security after %s returns %s',
    async (label, code, operation, target) => {
      const path = tempDatabase(
        `bootstrap-${label}-${code}`.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()
      )
      const failed = spawnWorker({
        kind: 'io',
        operation,
        path: target(path),
        code
      })
      await expect(rpc(failed, 'initialize', [path])).resolves.toMatchObject({
        ok: false,
        error: expect.stringMatching(new RegExp(code, 'i'))
      })
      await failed.terminate()

      const before = readWorkerDatabaseSnapshot(path, 'none')
      const keyPath = `${path}.repair-authority.key`
      const priorKey = existsSync(keyPath) ? readFileSync(keyPath, 'utf8') : undefined
      const priorKeyIsComplete = priorKey !== undefined && /^[a-f0-9]{64}\n$/.test(priorKey)
      expect(before.databaseId).toMatch(/^[a-f0-9]{48}$/)
      expect(before.passportJson).toBeUndefined()
      expect(JSON.parse(before.privacyJson)).toMatchObject({
        identityPersistenceOptIn: false
      })
      expect(existsSync(`${path}.repair-journal.json`)).toBe(false)
      expect(existsSync(`${path}.repair-receipt.json`)).toBe(false)

      const recovered = spawnWorker()
      await expect(rpc(recovered, 'initialize', [path])).resolves.toMatchObject({ ok: true })
      await expect(rpc(recovered, 'getAuthoritativeState')).resolves.toMatchObject({
        ok: true,
        result: {
          privacy: { identityPersistenceOptIn: false },
          roster: [],
          passports: []
        }
      })
      await recovered.terminate()

      expect(readWorkerDatabaseSnapshot(path, 'none')).toEqual(before)
      expectInitialRepairSecurity(path, before.databaseId)
      if (priorKeyIsComplete) {
        expect(readFileSync(keyPath, 'utf8')).toBe(priorKey)
      }
    },
    30_000
  )

  it.each([
    'key-only',
    'high-water-only',
    'authority-only'
  ] as const)(
    '[blocker-bootstrap] reconstructs an initial %s partial state only for an unmodified pristine database',
    async (partialState) => {
      const path = tempDatabase(`bootstrap-partial-${partialState}`)
      const database = await createPristineWorkerProfile(path)
      const originalKey = readFileSync(`${path}.repair-authority.key`)
      const originalAuthority = readRepairAuthorityState(path)
      const originalHighWater = readCurrentRepairHighWater(path)
      expect(originalAuthority.completedEpoch).toBe(0)
      expect(originalHighWater).toMatchObject({ revision: 0, repairEpoch: 0, phase: 'idle' })
      expect(existsSync(`${path}.repair-journal.json`)).toBe(false)

      if (partialState === 'key-only') {
        removeRepairSecurityComponent(path, 'high-water')
        removeRepairSecurityComponent(path, 'authority')
      } else if (partialState === 'high-water-only') {
        removeRepairSecurityComponent(path, 'authority')
      } else {
        removeRepairSecurityComponent(path, 'high-water')
      }
      expect(existsSync(`${path}.repair-authority.key`)).toBe(true)
      expect(existsSync(`${path}.repair-authority.json`))
        .toBe(partialState === 'authority-only')
      expect(existsSync(`${path}.repair-high-water-a`))
        .toBe(partialState === 'high-water-only')
      expect(existsSync(`${path}.repair-high-water-b`))
        .toBe(partialState === 'high-water-only')

      const recovered = spawnWorker()
      await expect(rpc(recovered, 'initialize', [path])).resolves.toMatchObject({ ok: true })
      await recovered.terminate()

      expect(readWorkerDatabaseSnapshot(path, 'none')).toEqual(database)
      expect(readFileSync(`${path}.repair-authority.key`)).toEqual(originalKey)
      expectInitialRepairSecurity(path, database.databaseId)
      if (partialState === 'high-water-only') {
        expect(readRepairAuthorityState(path).authorityId).toBe(originalHighWater.authorityId)
      }
      if (partialState === 'authority-only') {
        expect(readCurrentRepairHighWater(path).authorityId).toBe(originalAuthority.authorityId)
      }
    },
    30_000
  )

  it('[blocker-bootstrap] refuses bootstrap regeneration for a valid but modified database', async () => {
    const path = tempDatabase('bootstrap-modified-database')
    await createPristineWorkerProfile(path)
    const writer = spawnWorker()
    await expect(rpc(writer, 'initialize', [path])).resolves.toMatchObject({ ok: true })
    await expect(rpc(writer, 'setPrivacy', [privacy(true)])).resolves.toMatchObject({
      ok: true,
      result: expect.objectContaining({ identityPersistenceOptIn: true })
    })
    await writer.terminate()
    const modified = readWorkerDatabaseSnapshot(path, 'none')
    const key = readFileSync(`${path}.repair-authority.key`)
    removeRepairSecurityComponent(path, 'high-water')
    removeRepairSecurityComponent(path, 'authority')
    const before = snapshotRepairArtifactTree(path)

    const restarted = spawnWorker()
    await expect(rpc(restarted, 'initialize', [path])).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/repair|authority|high-water|bootstrap|modified|default/i)
    })
    await restarted.terminate()

    expect(snapshotRepairArtifactTree(path)).toEqual(before)
    expect(readFileSync(`${path}.repair-authority.key`)).toEqual(key)
    expect(existsSync(`${path}.repair-authority.json`)).toBe(false)
    expect(existsSync(`${path}.repair-high-water-a`)).toBe(false)
    expect(existsSync(`${path}.repair-high-water-b`)).toBe(false)
    expect(readWorkerDatabaseSnapshot(path, 'none')).toEqual(modified)
  }, 30_000)

  it('[blocker-bootstrap] refuses bootstrap regeneration for an unreadable database', async () => {
    const path = tempDatabase('bootstrap-unreadable-database')
    await createPristineWorkerProfile(path)
    removeRepairSecurityComponent(path, 'high-water')
    removeRepairSecurityComponent(path, 'authority')
    const invalidDatabase = Buffer.from('not-a-passport-sqlite-database')
    writeFileSync(path, invalidDatabase)
    const before = snapshotRepairArtifactTree(path)

    const restarted = spawnWorker()
    await expect(rpc(restarted, 'initialize', [path])).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/database|sqlite|file|repair|authority/i)
    })
    await restarted.terminate()

    expect(readFileSync(path)).toEqual(invalidDatabase)
    expect(snapshotRepairArtifactTree(path)).toEqual(before)
    expect(existsSync(`${path}.repair-authority.json`)).toBe(false)
    expect(existsSync(`${path}.repair-high-water-a`)).toBe(false)
    expect(existsSync(`${path}.repair-high-water-b`)).toBe(false)
  }, 30_000)

  it('[blocker-bootstrap] never regenerates missing security around an active repair journal', async () => {
    const path = tempDatabase('bootstrap-active-repair')
    const captured = await captureAuthorizedRepairJournal(
      path,
      'bootstrap-active-repair',
      'repair:bootstrap-active-repair'
    )
    const root = dirname(path)
    const baseline = cloneDirectory(root, 'bootstrap-active-repair-baseline')

    for (const component of ['key', 'high-water', 'authority'] as const) {
      restoreDirectory(baseline, root)
      removeRepairSecurityComponent(path, component)
      const beforeArtifacts = snapshotRepairArtifactTree(path)
      const beforeDatabase = readWorkerDatabaseSnapshot(path, 'bootstrap-active-repair')
      expect(readFileSync(`${path}.repair-journal.json`, 'utf8')).toBe(captured.journal)

      const restarted = spawnWorker()
      await expect(rpc(restarted, 'initialize', [path])).resolves.toMatchObject({
        ok: false,
        error: expect.stringMatching(/repair|journal|authority|high-water|missing/i)
      })
      await restarted.terminate()

      expect(snapshotRepairArtifactTree(path)).toEqual(beforeArtifacts)
      expect(readWorkerDatabaseSnapshot(path, 'bootstrap-active-repair')).toEqual(beforeDatabase)
      expect(readFileSync(`${path}.repair-journal.json`, 'utf8')).toBe(captured.journal)
    }
  }, 60_000)

  it('[blocker-bootstrap] never resets an active high-water revision when its journal is missing', async () => {
    const path = tempDatabase('bootstrap-active-high-water')
    const pristine = await createPristineWorkerProfile(path)
    const root = dirname(path)
    const pristineFiles = cloneDirectory(root, 'bootstrap-active-high-water-pristine')
    markWorkerDatabaseCorrupt(path)

    const crashingRepair = spawnWorker()
    await expect(rpc(crashingRepair, 'initialize', [path])).resolves.toMatchObject({ ok: true })
    const integrity = await rpc(crashingRepair, 'getIntegrity')
    const repairToken = (integrity.result as { repairToken?: string }).repairToken ?? ''
    expect(repairToken).toMatch(/^[a-f0-9]+$/)
    await rpc(crashingRepair, 'configureCrashBoundary', [{
      operation: 'repairPersistence',
      checkpoint: 'before-repair-database-header-write'
    }])
    await expect(rpc(crashingRepair, 'repairPersistence', [
      repairToken,
      'repair:bootstrap-active-high-water'
    ])).rejects.toThrow(/exited/i)
    const activeHighWater = readCurrentRepairHighWater(path)
    expect(activeHighWater).toMatchObject({
      phase: 'erasing-database',
      repairEpoch: 1,
      revision: expect.any(Number)
    })
    expect(activeHighWater.revision).toBeGreaterThan(0)

    rmSync(`${path}.repair-journal.json`, { force: true })
    rmSync(`${path}.repair-journal.json.pending`, { force: true })
    removeRepairSecurityComponent(path, 'authority')
    restoreDatabaseBundle(pristineFiles, path)
    const before = snapshotRepairArtifactTree(path)
    expect(existsSync(`${path}.repair-authority.key`)).toBe(true)
    expect(existsSync(`${path}.repair-authority.json`)).toBe(false)
    expect(existsSync(`${path}.repair-journal.json`)).toBe(false)
    expect(readCurrentRepairHighWater(path).revision).toBe(activeHighWater.revision)

    const restarted = spawnWorker()
    await expect(rpc(restarted, 'initialize', [path])).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/repair|authority|high-water|missing/i)
    })
    await restarted.terminate()

    expect(snapshotRepairArtifactTree(path)).toEqual(before)
    expect(readCurrentRepairHighWater(path)).toEqual(activeHighWater)
    expect(readWorkerDatabaseSnapshot(path, 'none')).toEqual(pristine)
  }, 60_000)

  it('[blocker-bootstrap] never regenerates missing security from a completed binding or high-water history', async () => {
    const path = tempDatabase('bootstrap-completed-repair')
    await seedWorkerDatabase(
      path,
      'bootstrap-completed-repair',
      'BOOTSTRAP-COMPLETED-REPAIR'
    )
    await captureReceiptStagedRepairForExistingDatabase(
      path,
      'repair:bootstrap-completed-repair'
    )
    await finishReceiptStagedRepair(path)
    const completedAuthority = readRepairAuthorityState(path)
    const completedHighWater = readCurrentRepairHighWater(path)
    expect(completedAuthority).toMatchObject({
      completedEpoch: 1,
      highWaterRevision: expect.any(Number),
      lastCompleted: { journalCleanupPending: false }
    })
    expect(completedHighWater).toMatchObject({
      revision: completedAuthority.highWaterRevision,
      repairEpoch: 1,
      phase: 'completed'
    })
    expect(completedHighWater.revision).toBeGreaterThan(0)
    const root = dirname(path)
    const baseline = cloneDirectory(root, 'bootstrap-completed-repair-baseline')

    for (const component of ['key', 'high-water', 'authority'] as const) {
      restoreDirectory(baseline, root)
      removeRepairSecurityComponent(path, component)
      const beforeArtifacts = snapshotRepairArtifactTree(path)
      const beforeDatabase = readWorkerDatabaseSnapshot(path, 'none')

      const restarted = spawnWorker()
      await expect(rpc(restarted, 'initialize', [path])).resolves.toMatchObject({
        ok: false,
        error: expect.stringMatching(/repair|authority|high-water|completed|missing/i)
      })
      await restarted.terminate()

      expect(snapshotRepairArtifactTree(path)).toEqual(beforeArtifacts)
      expect(readWorkerDatabaseSnapshot(path, 'none')).toEqual(beforeDatabase)
    }
  }, 90_000)

  it('[blocker-bootstrap] never regenerates key-only security over a completed database binding', async () => {
    const path = tempDatabase('bootstrap-completed-binding-key-only')
    await seedWorkerDatabase(
      path,
      'bootstrap-completed-binding-key-only',
      'BOOTSTRAP-COMPLETED-BINDING-KEY-ONLY'
    )
    await captureReceiptStagedRepairForExistingDatabase(
      path,
      'repair:bootstrap-completed-binding-key-only'
    )
    await finishReceiptStagedRepair(path)
    const completedDatabase = readWorkerDatabaseSnapshot(path, 'none')
    const key = readFileSync(`${path}.repair-authority.key`)
    removeRepairSecurityComponent(path, 'high-water')
    removeRepairSecurityComponent(path, 'authority')
    rmSync(`${path}.repair-receipt.json`, { force: true })
    rmSync(`${path}.repair-receipt.json.pending`, { force: true })
    const before = snapshotRepairArtifactTree(path)

    const restarted = spawnWorker()
    await expect(rpc(restarted, 'initialize', [path])).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/repair|bootstrap|binding|pristine|database/i)
    })
    await restarted.terminate()

    expect(snapshotRepairArtifactTree(path)).toEqual(before)
    expect(readFileSync(`${path}.repair-authority.key`)).toEqual(key)
    expect(existsSync(`${path}.repair-authority.json`)).toBe(false)
    expect(existsSync(`${path}.repair-high-water-a`)).toBe(false)
    expect(existsSync(`${path}.repair-high-water-b`)).toBe(false)
    expect(readWorkerDatabaseSnapshot(path, 'none')).toEqual(completedDatabase)
  }, 60_000)

  it.each([
    'after-cleanup-rename',
    'during-cleanup-overwrite',
    'before-cleanup-unlink'
  ] as const)(
    '[blocker-cleanup] recovers a completed repair after crashing %s',
    async (point) => {
      const path = tempDatabase(`completed-cleanup-${point}`)
      const operationId = `repair:completed-cleanup:${point}`
      const authenticatedJournal = await captureReceiptStagedRepairJournal(
        path,
        `completed-cleanup-${point}`,
        operationId
      )
      const crashed = await crashCompletedJournalCleanup(path, point, point)
      const artifactPath = crashed.artifactPath
      if (!artifactPath) throw new Error(`Cleanup fault ${point} did not expose its artifact.`)

      const renameIndex = crashed.trace.findIndex((entry) =>
        entry.event === 'cleanup-rename' &&
        entry.source === `${path}.repair-journal.json` &&
        entry.artifactPath === artifactPath
      )
      const exitIndex = crashed.trace.findIndex((entry) =>
        entry.event === 'fault-exit' && entry.point === point
      )
      expect(renameIndex).toBeGreaterThanOrEqual(0)
      expect(exitIndex).toBeGreaterThan(renameIndex)
      expect(existsSync(`${path}.repair-journal.json`)).toBe(false)

      const artifactBytes = readFileSync(artifactPath)
      if (point === 'after-cleanup-rename') {
        expect(crashed.trace.slice(renameIndex + 1, exitIndex).some((entry) =>
          entry.event === 'write' && entry.target === artifactPath
        )).toBe(false)
        expect(artifactBytes.toString('utf8')).toBe(authenticatedJournal)
        expect(JSON.parse(artifactBytes.toString('utf8'))).toMatchObject({
          operationId,
          phase: 'receipt-staged'
        })
      } else if (point === 'during-cleanup-overwrite') {
        expect(artifactBytes).not.toEqual(Buffer.from(authenticatedJournal))
        expect(artifactBytes.includes(0)).toBe(true)
        expect(artifactBytes.some((byte) => byte !== 0)).toBe(true)
        expect(() => JSON.parse(artifactBytes.toString('utf8'))).toThrow()
      } else {
        const artifactFsyncIndex = crashed.trace.findIndex((entry) =>
          entry.event === 'fsync' && entry.target === artifactPath
        )
        expect(artifactFsyncIndex).toBeGreaterThan(renameIndex)
        expect(exitIndex).toBeGreaterThan(artifactFsyncIndex)
        expect(artifactBytes.every((byte) => byte === 0)).toBe(true)
        expect(() => JSON.parse(artifactBytes.toString('utf8'))).toThrow()
      }

      const repairedDatabase = expectMatchingCompletedCleanupProof(path, artifactPath)
      const recovered = spawnWorker()
      await expect(rpc(recovered, 'initialize', [path])).resolves.toMatchObject({ ok: true })
      await expect(rpc(recovered, 'getAuthoritativeState')).resolves.toMatchObject({
        ok: true,
        result: {
          privacy: { identityPersistenceOptIn: false },
          roster: [],
          passports: []
        }
      })
      await recovered.terminate()

      expect(existsSync(artifactPath)).toBe(false)
      expect(existsSync(`${path}.repair-journal.json`)).toBe(false)
      expect(existsSync(`${path}.repair-journal.json.pending`)).toBe(false)
      expect(readRepairAuthorityState(path).lastCompleted)
        .toMatchObject({ journalCleanupPending: false })
      expect(readWorkerDatabaseSnapshot(path, 'none')).toEqual(repairedDatabase)
      expect(readRepairReceiptState(path)).toMatchObject({
        operationId,
        databaseId: repairedDatabase.databaseId
      })
    },
    60_000
  )

  it.each([
    ['corrupt', (journal: string) => Buffer.from('{"version":3')],
    ['forged', (journal: string) => {
      const forged = JSON.parse(journal) as Record<string, unknown>
      forged.operationId = 'repair:forged-cleanup-journal'
      forged.signature = '0'.repeat(64)
      return Buffer.from(`${JSON.stringify(forged)}\n`)
    }]
  ] as const)(
    '[blocker-cleanup] does not move or erase a %s live journal under completed-cleanup authority',
    async (_kind, tamper) => {
      const path = tempDatabase(`completed-cleanup-${_kind}-live`)
      const originalJournal = await captureReceiptStagedRepairJournal(
        path,
        `completed-cleanup-${_kind}-live`,
        `repair:completed-cleanup-${_kind}-live`
      )
      const staged = await crashCompletedJournalCleanup(
        path,
        'after-completed-authority-promotion',
        `completed-authority-${_kind}`
      )
      expect(staged.artifactPath).toBeUndefined()
      expect(existsSync(`${path}.repair-journal.json`)).toBe(true)
      const authority = readRepairAuthorityState(path)
      expect(authority.lastCompleted).toMatchObject({ journalCleanupPending: true })
      expect(readCurrentRepairHighWater(path)).toMatchObject({
        phase: 'completed',
        revision: authority.highWaterRevision
      })
      const repairedDatabase = readWorkerDatabaseSnapshot(path, 'none')

      const hostileJournal = tamper(originalJournal)
      writeFileSync(`${path}.repair-journal.json`, hostileJournal)
      const before = snapshotRepairArtifactTree(path)
      const restarted = spawnWorker()
      await expect(rpc(restarted, 'initialize', [path])).resolves.toMatchObject({
        ok: false,
        error: expect.stringMatching(/journal|auth|invalid|syntax|repair|json|expected/i)
      })
      await restarted.terminate()

      expect(snapshotRepairArtifactTree(path)).toEqual(before)
      expect(readFileSync(`${path}.repair-journal.json`)).toEqual(hostileJournal)
      expect(readRepairAuthorityState(path).lastCompleted)
        .toMatchObject({ journalCleanupPending: true })
      expect(readWorkerDatabaseSnapshot(path, 'none')).toEqual(repairedDatabase)
    },
    60_000
  )

  it('[blocker-cleanup] never erases a syntactically valid forged cleanup artifact', async () => {
    const path = tempDatabase('completed-cleanup-forged-artifact')
    const authenticatedJournal = await captureReceiptStagedRepairJournal(
      path,
      'completed-cleanup-forged-artifact',
      'repair:completed-cleanup-forged-artifact'
    )
    await crashCompletedJournalCleanup(
      path,
      'after-completed-authority-promotion',
      'completed-cleanup-forged-artifact'
    )
    const journalPath = `${path}.repair-journal.json`
    const artifactPath = `${journalPath}.cleanup`
    renameSync(journalPath, artifactPath)
    const forged = JSON.parse(authenticatedJournal) as Record<string, unknown>
    forged.operationId = 'repair:forged-cleanup-artifact'
    forged.signature = '0'.repeat(64)
    const forgedBytes = Buffer.from(`${JSON.stringify(forged)}\n`)
    writeFileSync(artifactPath, forgedBytes)
    const before = snapshotRepairArtifactTree(path)
    const repairedDatabase = readWorkerDatabaseSnapshot(path, 'none')

    const restarted = spawnWorker()
    await expect(rpc(restarted, 'initialize', [path])).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/cleanup|journal|authentication|repair/i)
    })
    await restarted.terminate()

    expect(snapshotRepairArtifactTree(path)).toEqual(before)
    expect(readFileSync(artifactPath)).toEqual(forgedBytes)
    expect(readRepairAuthorityState(path).lastCompleted)
      .toMatchObject({ journalCleanupPending: true })
    expect(readWorkerDatabaseSnapshot(path, 'none')).toEqual(repairedDatabase)
  }, 60_000)

  it('[blocker-cleanup] discards an unreadable cleanup artifact only with matching completed proof', async () => {
    const path = tempDatabase('completed-cleanup-proof')
    await seedWorkerDatabase(
      path,
      'completed-cleanup-proof',
      'COMPLETED-CLEANUP-PROOF-EPOCH-ZERO'
    )
    await captureReceiptStagedRepairForExistingDatabase(
      path,
      'repair:completed-cleanup-proof-one'
    )
    await finishReceiptStagedRepair(path)
    const firstAuthority = readRepairAuthorityState(path)
    expect(firstAuthority).toMatchObject({
      completedEpoch: 1,
      lastCompleted: { journalCleanupPending: false }
    })
    const root = dirname(path)
    const firstCompletion = cloneDirectory(root, 'completed-cleanup-proof-first')

    await captureReceiptStagedRepairForExistingDatabase(
      path,
      'repair:completed-cleanup-proof-two'
    )
    const crashed = await crashCompletedJournalCleanup(
      path,
      'during-cleanup-overwrite',
      'completed-cleanup-proof-two'
    )
    const artifactPath = crashed.artifactPath
    if (!artifactPath) throw new Error('Cleanup overwrite did not leave an artifact.')
    const unreadableArtifact = readFileSync(artifactPath)
    expect(unreadableArtifact.includes(0)).toBe(true)
    expect(() => JSON.parse(unreadableArtifact.toString('utf8'))).toThrow()
    expectMatchingCompletedCleanupProof(path, artifactPath)
    const secondCompletion = cloneDirectory(root, 'completed-cleanup-proof-second')
    const databaseName = basename(path)

    const mismatches: ReadonlyArray<readonly [string, () => void]> = [
      ['authority', () => {
        copyFileSync(
          join(firstCompletion, `${databaseName}.repair-authority.json`),
          `${path}.repair-authority.json`
        )
      }],
      ['high-water A history', () => {
        restoreFiles(
          `${path}.repair-high-water-a`,
          snapshotFiles(join(firstCompletion, `${databaseName}.repair-high-water-a`))
        )
      }],
      ['high-water B history', () => {
        restoreFiles(
          `${path}.repair-high-water-b`,
          snapshotFiles(join(firstCompletion, `${databaseName}.repair-high-water-b`))
        )
      }],
      ['receipt', () => {
        copyFileSync(
          join(firstCompletion, `${databaseName}.repair-receipt.json`),
          `${path}.repair-receipt.json`
        )
      }],
      ['current database binding', () => {
        restoreDatabaseBundle(firstCompletion, path)
      }]
    ]

    for (const [proof, introduceMismatch] of mismatches) {
      restoreDirectory(secondCompletion, root)
      introduceMismatch()
      const authority = readRepairAuthorityState(path)
      const highWaterA = JSON.parse(
        readFileSync(lastHighWaterMarker(path, 'a'), 'utf8')
      ) as RepairHighWaterTestState
      const highWaterB = JSON.parse(
        readFileSync(lastHighWaterMarker(path, 'b'), 'utf8')
      ) as RepairHighWaterTestState
      const receipt = readRepairReceiptState(path)
      const database = readWorkerDatabaseSnapshot(path, 'none')
      const allProofMatches =
        highWaterA.signature === highWaterB.signature &&
        authority.highWaterRevision === highWaterA.revision &&
        authority.completedEpoch === highWaterA.repairEpoch &&
        authority.currentDatabaseId === highWaterA.databaseId &&
        authority.lastCompleted?.operationId === receipt.operationId &&
        authority.lastCompleted?.tokenHash === receipt.tokenHash &&
        authority.lastCompleted?.databaseId === receipt.databaseId &&
        receipt.databaseId === database.databaseId
      expect(allProofMatches, `${proof} must actually be mismatched`).toBe(false)
      expect(readFileSync(artifactPath)).toEqual(unreadableArtifact)

      const restarted = spawnWorker()
      await expect(rpc(restarted, 'initialize', [path])).resolves.toMatchObject({
        ok: false,
        error: expect.stringMatching(
          /cleanup|repair|authority|high-water|receipt|database|binding|completed/i
        )
      })
      await restarted.terminate()

      expect(existsSync(`${path}.repair-journal.json`)).toBe(false)
      expect(existsSync(artifactPath)).toBe(true)
      expect(readFileSync(artifactPath)).toEqual(unreadableArtifact)
    }
  }, 120_000)
})

type ParentFsyncBoundary = 'authority' | 'journal' | 'high-water' | 'cleanup'

interface ParentFsyncTransition {
  durableFile: string
  rename?: {
    source: string
    destination: string
  }
  remove?: {
    event: 'rm' | 'unlink'
    target: string
  }
}

type FaultableWorkerOperation = (
  fault?: PersistenceProcessFault
) => Promise<RpcResponse>

interface ParentFsyncObservation {
  response: RpcResponse
  preBoundary: string
  crashVisible: string
}

interface ParentFsyncRecoveryOracle {
  mode: 'bootstrap' | 'repair'
  databaseId?: string
  operationId?: string
  oldStintId: string
  oldSentinel: string
  guardPath: string
  guardBytes: Buffer
}

const parentFsyncFaultMatrix: ReadonlyArray<{
  boundary: ParentFsyncBoundary
  code: InjectedIoCode
}> = [
  { boundary: 'authority', code: 'EIO' },
  { boundary: 'authority', code: 'ENOSPC' },
  { boundary: 'authority', code: 'EPERM' },
  { boundary: 'journal', code: 'EIO' },
  { boundary: 'journal', code: 'ENOSPC' },
  { boundary: 'journal', code: 'EPERM' },
  { boundary: 'high-water', code: 'EIO' },
  { boundary: 'high-water', code: 'ENOSPC' },
  { boundary: 'high-water', code: 'EPERM' },
  { boundary: 'cleanup', code: 'EIO' },
  { boundary: 'cleanup', code: 'ENOSPC' },
  { boundary: 'cleanup', code: 'EPERM' }
]

const injectedIoErrnos: Record<InjectedIoCode, number> = {
  ENOSPC: -4055,
  EIO: -4070,
  EPERM: -4048
}

const parentFsyncCrashExitCode = 121

function comparableWorkerPath(value: string): string {
  const normalized = value.replace(/\\/g, '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function workerPathsEqual(left: string | undefined, right: string): boolean {
  return left !== undefined && comparableWorkerPath(left) === comparableWorkerPath(right)
}

function parentFsyncTracePath(label: string): string {
  const safeLabel = label.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()
  const directory = mkdtempSync(
    join(process.cwd(), `.passport-worker-parent-fsync-${safeLabel}-`)
  )
  directories.push(directory)
  return join(directory, 'trace.jsonl')
}

function snapshotDirectoryTree(path: string): Record<string, string> {
  const result: Record<string, string> = {}
  snapshotTree(path, 'root', result)
  return result
}

async function runInitializeBoundaryOperation(
  path: string,
  fault?: PersistenceProcessFault
): Promise<RpcResponse> {
  const worker = spawnWorker(fault)
  try {
    return await rpc(worker, 'initialize', [path], 15_000)
  } finally {
    await worker.terminate()
  }
}

async function runRepairBoundaryOperation(
  path: string,
  operationId: string,
  fault?: PersistenceProcessFault
): Promise<RpcResponse> {
  const worker = spawnWorker(fault)
  try {
    await expect(rpc(worker, 'initialize', [path], 15_000))
      .resolves.toMatchObject({ ok: true })
    const integrity = await rpc(worker, 'getIntegrity')
    const repairToken = (integrity.result as { repairToken?: string }).repairToken ?? ''
    expect(repairToken).toMatch(/^[a-f0-9]+$/)
    return await rpc(
      worker,
      'repairPersistence',
      [repairToken, operationId],
      30_000
    )
  } finally {
    await worker.terminate()
  }
}

function lastTraceIndexBefore(
  trace: readonly WorkerFaultTrace[],
  before: number,
  predicate: (entry: WorkerFaultTrace) => boolean
): number {
  for (let index = before - 1; index >= 0; index -= 1) {
    if (predicate(trace[index])) return index
  }
  return -1
}

function locateParentFsyncTrace(
  trace: readonly WorkerFaultTrace[],
  parentDirectory: string,
  transition: ParentFsyncTransition
): { occurrence: number; matchIndex: number } {
  expect(
    Number(transition.rename !== undefined) + Number(transition.remove !== undefined),
    'a parent-fsync transition must have at most one rename/remove boundary'
  ).toBeLessThanOrEqual(1)
  const transitionIndex = transition.rename
    ? trace.findIndex((entry) =>
        entry.event === 'rename' &&
        workerPathsEqual(entry.source, transition.rename!.source) &&
        workerPathsEqual(entry.destination, transition.rename!.destination)
      )
    : transition.remove
      ? trace.findIndex((entry) =>
          entry.event === transition.remove!.event &&
          workerPathsEqual(entry.target, transition.remove!.target)
        )
      : trace.findIndex((entry) =>
          entry.event === 'fsync' &&
          entry.descriptorKind === 'file' &&
          workerPathsEqual(entry.target, transition.durableFile)
        )
  expect(transitionIndex, 'the intended artifact transition must be traced').toBeGreaterThanOrEqual(0)

  const durableFsyncIndex = transition.rename || transition.remove
    ? lastTraceIndexBefore(trace, transitionIndex, (entry) =>
        entry.event === 'fsync' &&
        entry.descriptorKind === 'file' &&
        workerPathsEqual(entry.target, transition.durableFile)
      )
    : transitionIndex
  expect(
    durableFsyncIndex,
    'the artifact file fsync must complete before its directory transition'
  ).toBeGreaterThanOrEqual(0)
  expect(durableFsyncIndex).toBeLessThanOrEqual(transitionIndex)

  const matchIndex = trace.findIndex((entry, index) =>
    index > transitionIndex &&
    entry.event === 'io-match' &&
    entry.operation === 'fsync' &&
    entry.descriptorKind === 'directory' &&
    workerPathsEqual(entry.target, parentDirectory)
  )
  expect(
    matchIndex,
    'the next matched fsync must use the exact parent-directory descriptor'
  ).toBeGreaterThan(transitionIndex)
  const match = trace[matchIndex]
  expect(match.descriptor).toEqual(expect.any(Number))
  expect(match.occurrence).toEqual(expect.any(Number))

  const directoryOpenIndex = lastTraceIndexBefore(trace, matchIndex, (entry) =>
    entry.event === 'open' &&
    entry.descriptor === match.descriptor &&
    entry.descriptorKind === 'directory' &&
    workerPathsEqual(entry.target, parentDirectory)
  )
  expect(directoryOpenIndex).toBeGreaterThan(transitionIndex)

  const durableFsync = trace[durableFsyncIndex]
  expect(durableFsync.descriptor).toEqual(expect.any(Number))
  expect(durableFsync.descriptorKind).toBe('file')
  const durableFileOpenIndex = lastTraceIndexBefore(trace, durableFsyncIndex, (entry) =>
    entry.event === 'open' &&
    entry.descriptor === durableFsync.descriptor &&
    entry.descriptorKind === 'file' &&
    workerPathsEqual(entry.target, transition.durableFile)
  )
  expect(durableFileOpenIndex).toBeGreaterThanOrEqual(0)
  expect(durableFileOpenIndex).toBeLessThan(durableFsyncIndex)
  return {
    occurrence: Number(match.occurrence),
    matchIndex
  }
}

function expectInjectedParentFsyncTrace(
  trace: readonly WorkerFaultTrace[],
  parentDirectory: string,
  transition: ParentFsyncTransition,
  occurrence: number,
  code: InjectedIoCode,
  powerLossExit: boolean
): number {
  const located = locateParentFsyncTrace(trace, parentDirectory, transition)
  expect(located.occurrence).toBe(occurrence)
  const faultIndex = trace.findIndex((entry, index) =>
    index > located.matchIndex &&
    entry.event === 'io-fault' &&
    entry.operation === 'fsync' &&
    entry.occurrence === occurrence &&
    entry.descriptorKind === 'directory' &&
    workerPathsEqual(entry.target, parentDirectory)
  )
  expect(faultIndex).toBe(located.matchIndex + 1)
  expect(trace[faultIndex]).toMatchObject({
    code,
    errno: injectedIoErrnos[code],
    syscall: 'fsync',
    descriptorKind: 'directory',
    occurrence,
    powerLossExit
  })
  expect(workerPathsEqual(trace[faultIndex].path, parentDirectory)).toBe(true)
  expect(trace[faultIndex].descriptor).toBe(trace[located.matchIndex].descriptor)
  return faultIndex
}

async function prepareRenameLostTree(
  durableBase: string,
  root: string,
  operation: FaultableWorkerOperation,
  destination: string,
  label: string
): Promise<string> {
  restoreDirectory(durableBase, root)
  const response = await operation({
    kind: 'io',
    operation: 'rename',
    path: destination,
    code: 'EIO'
  })
  expect(response).toMatchObject({
    ok: false,
    error: expect.stringMatching(/EIO/i),
    code: 'EIO'
  })
  return cloneDirectory(root, `${label}-rename-lost`)
}

async function observeParentFsyncFault(
  operationBase: string,
  preBoundary: string,
  root: string,
  parentDirectory: string,
  transition: ParentFsyncTransition,
  operation: FaultableWorkerOperation,
  code: InjectedIoCode,
  label: string
): Promise<ParentFsyncObservation> {
  restoreDirectory(operationBase, root)
  const baselineTracePath = parentFsyncTracePath(`${label}-baseline`)
  const baseline = await operation({
    kind: 'io',
    operation: 'fsync',
    path: parentDirectory,
    code: 'EIO',
    occurrence: Number.MAX_SAFE_INTEGER,
    descriptorKind: 'directory',
    tracePath: baselineTracePath
  })
  expect(baseline).toMatchObject({ ok: true })
  const baselineTrace = readWorkerFaultTrace(baselineTracePath)
  expect(baselineTrace.some((entry) => entry.event === 'io-fault')).toBe(false)
  const { occurrence } = locateParentFsyncTrace(
    baselineTrace,
    parentDirectory,
    transition
  )

  restoreDirectory(operationBase, root)
  const faultTracePath = parentFsyncTracePath(`${label}-fault`)
  const response = await operation({
    kind: 'io',
    operation: 'fsync',
    path: parentDirectory,
    code,
    occurrence,
    descriptorKind: 'directory',
    tracePath: faultTracePath
  })
  const faultTrace = readWorkerFaultTrace(faultTracePath)
  expectInjectedParentFsyncTrace(
    faultTrace,
    parentDirectory,
    transition,
    occurrence,
    code,
    false
  )
  const crashVisible = await captureParentFsyncCrashVisibleTree(
    operationBase,
    root,
    parentDirectory,
    transition,
    operation,
    occurrence,
    code,
    label
  )
  return {
    response,
    preBoundary,
    crashVisible
  }
}

async function captureParentFsyncCrashVisibleTree(
  operationBase: string,
  root: string,
  parentDirectory: string,
  transition: ParentFsyncTransition,
  operation: FaultableWorkerOperation,
  occurrence: number,
  code: InjectedIoCode,
  label: string
): Promise<string> {
  restoreDirectory(operationBase, root)
  const tracePath = parentFsyncTracePath(`${label}-power-loss`)
  let crashError: unknown
  try {
    await operation({
      kind: 'io',
      operation: 'fsync',
      path: parentDirectory,
      code,
      occurrence,
      descriptorKind: 'directory',
      tracePath,
      exitAfterDirectoryFsyncFault: true
    })
  } catch (error) {
    crashError = error
  }
  expect(crashError).toBeInstanceOf(Error)
  expect((crashError as Error).message).toMatch(
    new RegExp(
      `^Worker exited with code ${parentFsyncCrashExitCode} before response \\d+\\.$`
    )
  )
  const trace = readWorkerFaultTrace(tracePath)
  const faultIndex = expectInjectedParentFsyncTrace(
    trace,
    parentDirectory,
    transition,
    occurrence,
    code,
    true
  )
  expect(
    faultIndex,
    'the power-loss process must exit immediately after the matched directory fsync fault'
  ).toBe(trace.length - 1)
  return cloneDirectory(root, `${label}-crash-visible`)
}

function expectParentFsyncRpcFailure(
  response: RpcResponse,
  code: InjectedIoCode,
  parentDirectory: string
): void {
  const context = `${code} parent-directory fsync must fail its initiating RPC`
  expect.soft(response.ok, context).toBe(false)
  expect.soft(response.code, `${context}: exact classified code`).toBe(code)
  expect.soft(response.error, `${context}: exact injected error`).toBe(
    `${code}: injected Passport worker fsync fault for ${parentDirectory}`
  )
  expect.soft(response.result, `${context}: no success result`).toBeUndefined()
  const serializedResult = JSON.stringify(response.result ?? null)
  expect.soft(
    serializedResult,
    `${context}: no success receipt, process ID, or quarantine acknowledgement`
  ).not.toMatch(/quarantinedPath|isolatedProcessId|repairReceipt|receipt/i)
  expect.soft(
    JSON.stringify(response),
    `${context}: no quarantined-path acknowledgement`
  ).not.toContain('quarantinedPath')
}

function installUnauthenticatedD3Guard(
  root: string,
  label: string
): { path: string; bytes: Buffer } {
  const path = join(root, 'unauthenticated-d3.guard')
  const bytes = Buffer.from(`UNAUTHENTICATED-D3-ERASE-GUARD-${label}`)
  writeFileSync(path, bytes)
  return { path, bytes }
}

function expectNoRepairJournalTransition(path: string): void {
  for (const suffix of [
    '.repair-journal.json',
    '.repair-journal.json.pending',
    '.repair-journal.json.cleanup'
  ]) {
    expect(existsSync(`${path}${suffix}`)).toBe(false)
  }
  expect(existsSync(`${path}.repair-authority.json.pending`)).toBe(false)
  for (const copy of ['a', 'b'] as const) {
    expect(
      readdirSync(`${path}.repair-high-water-${copy}`)
        .some((name) => name.endsWith('.pending'))
    ).toBe(false)
  }
}

function expectTreeDoesNotContainValues(
  root: string,
  guardPath: string,
  values: readonly string[]
): void {
  const guardKey = `root/${basename(guardPath)}`
  for (const [key, value] of Object.entries(snapshotDirectoryTree(root))) {
    if (key === guardKey) continue
    const bytes = Buffer.from(value, 'base64')
    for (const forbidden of values) {
      expect(
        bytes.includes(Buffer.from(forbidden)),
        `${key} must not republish old D3 identity material`
      ).toBe(false)
    }
  }
}

function expectTreeDoesNotContainSentinel(
  root: string,
  guardPath: string,
  sentinel: string
): void {
  expectTreeDoesNotContainValues(root, guardPath, [sentinel])
}

function expectNoPendingOrphanRepairArtifacts(root: string, path: string): void {
  const prefix = `root/${basename(path)}`
  const orphanArtifacts = Object.keys(snapshotDirectoryTree(root))
    .filter((key) => key.startsWith(prefix))
    .filter((key) =>
      key.includes('.pending') ||
      key.endsWith('.repair-journal.json.cleanup') ||
      key.includes('.repair-create-')
    )
  expect(orphanArtifacts).toEqual([])
}

function expectCompletedRepairProof(
  path: string,
  operationId: string,
  oldStintId: string
): void {
  const authority = readRepairAuthorityState(path)
  const highWater = readCurrentRepairHighWater(path)
  const receipt = readRepairReceiptState(path)
  expect(authority.completedEpoch).toBeGreaterThan(0)
  expect(authority.lastCompleted).toMatchObject({
    repairEpoch: authority.completedEpoch,
    operationId,
    databaseId: authority.currentDatabaseId,
    journalCleanupPending: false
  })
  expect(highWater).toMatchObject({
    authorityId: authority.authorityId,
    profileBinding: authority.profileBinding,
    revision: authority.highWaterRevision,
    repairEpoch: authority.completedEpoch,
    phase: 'completed',
    databaseId: authority.currentDatabaseId,
    operationId
  })
  expect(receipt).toMatchObject({
    operationId,
    databaseId: authority.currentDatabaseId,
    tokenHash: authority.lastCompleted?.tokenHash
  })
  const database = readWorkerDatabaseSnapshot(path, oldStintId)
  expect(database.databaseId).toBe(authority.currentDatabaseId)
  expect(database.passportJson).toBeUndefined()
  expect(JSON.parse(database.privacyJson)).toMatchObject({
    identityPersistenceOptIn: false
  })
  expectNoRepairJournalTransition(path)
}

async function expectPowerLossRecovery(
  snapshot: string,
  root: string,
  path: string,
  variant: 'pre-boundary' | 'crash-visible',
  oracle: ParentFsyncRecoveryOracle
): Promise<void> {
  restoreDirectory(snapshot, root)
  const before = snapshotDirectoryTree(root)
  let attempt = await runParentFsyncRecoveryAttempt(path)
  if (!attempt.initialized.ok) {
    expectClassifiedParentFsyncRecoveryFailure(attempt.initialized, variant)
    expect.soft(
      snapshotDirectoryTree(root),
      `${variant} fail-closed initialization must leave the tree unchanged`
    ).toEqual(before)
    expect.soft(readFileSync(oracle.guardPath)).toEqual(oracle.guardBytes)

    const firstFailure = attempt.initialized
    attempt = await runParentFsyncRecoveryAttempt(path)
    if (!attempt.initialized.ok) {
      expectClassifiedParentFsyncRecoveryFailure(attempt.initialized, variant)
      expect.soft(
        attempt.initialized.code,
        `${variant} fail-closed retry must have a deterministic classification`
      ).toBe(firstFailure.code)
      expect.soft(
        attempt.initialized.error,
        `${variant} fail-closed retry must have a deterministic error`
      ).toBe(firstFailure.error)
      expect.soft(
        snapshotDirectoryTree(root),
        `${variant} fail-closed retry must leave the tree unchanged`
      ).toEqual(before)
      expect.soft(readFileSync(oracle.guardPath)).toEqual(oracle.guardBytes)
      return
    }
  }

  const authoritative = attempt.authoritative
  expect(authoritative).toMatchObject({ ok: true })
  const state = authoritative!.result as {
    privacy: PassportPrivacySettings
    roster: unknown[]
    passports: unknown[]
  }
  expect(state.privacy).toMatchObject({ identityPersistenceOptIn: false })
  expect(state.roster).toEqual([])
  expect(state.passports).toEqual([])
  expect(JSON.stringify(state)).not.toContain(oracle.oldStintId)
  expect(JSON.stringify(state)).not.toContain(oracle.oldSentinel)
  expect(readFileSync(oracle.guardPath)).toEqual(oracle.guardBytes)

  if (oracle.mode === 'bootstrap') {
    expect(oracle.databaseId).toEqual(expect.any(String))
    expectInitialRepairSecurity(path, oracle.databaseId!)
    const database = readWorkerDatabaseSnapshot(path, oracle.oldStintId)
    expect(database.passportJson).toBeUndefined()
    expect(JSON.parse(database.privacyJson)).toMatchObject({
      identityPersistenceOptIn: false
    })
  } else {
    expect(oracle.operationId).toEqual(expect.any(String))
    expectCompletedRepairProof(path, oracle.operationId!, oracle.oldStintId)
  }
  expectNoRepairJournalTransition(path)
  expectNoPendingOrphanRepairArtifacts(root, path)
  expectTreeDoesNotContainValues(
    root,
    oracle.guardPath,
    [oracle.oldStintId, oracle.oldSentinel]
  )
}

async function runParentFsyncRecoveryAttempt(path: string): Promise<{
  initialized: RpcResponse
  authoritative?: RpcResponse
}> {
  const worker = spawnWorker()
  try {
    const initialized = await rpc(worker, 'initialize', [path], 30_000)
    if (!initialized.ok) return { initialized }
    return {
      initialized,
      authoritative: await rpc(worker, 'getAuthoritativeState', [], 15_000)
    }
  } finally {
    await worker.terminate()
  }
}

function expectClassifiedParentFsyncRecoveryFailure(
  response: RpcResponse,
  variant: 'pre-boundary' | 'crash-visible'
): void {
  const classifiedStorageHealthCode =
    response.code === 'PERSISTENCE_HEALTH_ERROR' ||
    response.code === 'EACCES' ||
    response.code === 'EBUSY' ||
    response.code === 'EIO' ||
    response.code === 'EMFILE' ||
    response.code === 'ENFILE' ||
    response.code === 'ENOSPC' ||
    response.code === 'EPERM' ||
    response.code === 'EROFS' ||
    response.code === 'ERR_SQLITE_ERROR' ||
    response.code?.startsWith('SQLITE_') === true ||
    response.code?.startsWith('ERR_SQLITE_') === true
  expect.soft(response.ok, `${variant} recovery must fail closed`).toBe(false)
  expect.soft(
    classifiedStorageHealthCode,
    `${variant} recovery failure must have a storage/health classification`
  ).toBe(true)
  expect.soft(
    response.error,
    `${variant} recovery failure must identify the failed durable state`
  ).toEqual(expect.stringMatching(
    /passport|persistence|repair|database|storage|sqlite|authority|high-water|journal|cleanup/i
  ))
  expect.soft(response.result).toBeUndefined()
  expect.soft(JSON.stringify(response)).not.toContain('quarantinedPath')
}

async function expectParentFsyncPowerLossPair(
  observation: ParentFsyncObservation,
  root: string,
  path: string,
  oracle: ParentFsyncRecoveryOracle
): Promise<void> {
  await expectPowerLossRecovery(
    observation.preBoundary,
    root,
    path,
    'pre-boundary',
    oracle
  )
  await expectPowerLossRecovery(
    observation.crashVisible,
    root,
    path,
    'crash-visible',
    oracle
  )
}

function expectIdleRepairProof(path: string, databaseId: string): void {
  const authority = readRepairAuthorityState(path)
  const highWater = readCurrentRepairHighWater(path)
  expect(authority).toMatchObject({
    completedEpoch: 0,
    highWaterRevision: 0,
    currentDatabaseId: databaseId
  })
  expect(authority.lastCompleted).toBeUndefined()
  expect(highWater).toMatchObject({
    revision: 0,
    repairEpoch: 0,
    phase: 'idle',
    databaseId
  })
}

async function exerciseAuthorityParentFsync(
  code: InjectedIoCode
): Promise<void> {
  const path = tempDatabase(`parent-authority-${code.toLowerCase()}`)
  const root = dirname(path)
  const pristine = await createPristineWorkerProfile(path)
  removeRepairSecurityComponent(path, 'key')
  removeRepairSecurityComponent(path, 'high-water')
  removeRepairSecurityComponent(path, 'authority')
  const oldStintId = `old-authority-${code.toLowerCase()}`
  const oldSentinel = `OLD-D3-AUTHORITY-${code}`
  const guard = installUnauthenticatedD3Guard(root, `AUTHORITY-${code}`)
  const durableBase = cloneDirectory(root, `parent-authority-${code}-base`)
  const initialize = (fault?: PersistenceProcessFault) =>
    runInitializeBoundaryOperation(path, fault)
  const authorityPath = `${path}.repair-authority.json`
  const keyPath = `${path}.repair-authority.key`

  const statePreBoundary = await prepareRenameLostTree(
    durableBase,
    root,
    initialize,
    authorityPath,
    `parent-authority-state-${code}`
  )
  restoreDirectory(statePreBoundary, root)
  expect(existsSync(`${authorityPath}.pending`)).toBe(true)
  expect(existsSync(authorityPath)).toBe(false)
  expect(readCurrentRepairHighWater(path)).toMatchObject({
    revision: 0,
    repairEpoch: 0,
    phase: 'idle'
  })

  const keyObservation = await observeParentFsyncFault(
    durableBase,
    durableBase,
    root,
    root,
    { durableFile: keyPath },
    initialize,
    code,
    `parent-authority-key-${code}`
  )
  const stateObservation = await observeParentFsyncFault(
    durableBase,
    statePreBoundary,
    root,
    root,
    {
      durableFile: `${authorityPath}.pending`,
      rename: {
        source: `${authorityPath}.pending`,
        destination: authorityPath
      }
    },
    initialize,
    code,
    `parent-authority-state-${code}`
  )

  expectParentFsyncRpcFailure(keyObservation.response, code, root)
  expectParentFsyncRpcFailure(stateObservation.response, code, root)

  restoreDirectory(keyObservation.crashVisible, root)
  expect(readFileSync(keyPath, 'utf8')).toMatch(/^[a-f0-9]{64}\n$/)
  expect(existsSync(authorityPath)).toBe(false)
  expect(existsSync(`${authorityPath}.pending`)).toBe(false)
  expect(existsSync(`${path}.repair-high-water-a`)).toBe(false)
  expect(existsSync(`${path}.repair-high-water-b`)).toBe(false)
  expect(readWorkerDatabaseSnapshot(path, oldStintId)).toMatchObject({
    databaseId: pristine.databaseId,
    passportJson: undefined
  })

  restoreDirectory(stateObservation.crashVisible, root)
  expectInitialRepairSecurity(path, pristine.databaseId)
  expect(readRepairAuthorityState(path)).toMatchObject({
    completedEpoch: 0,
    highWaterRevision: 0
  })

  const oracle: ParentFsyncRecoveryOracle = {
    mode: 'bootstrap',
    databaseId: pristine.databaseId,
    oldStintId,
    oldSentinel,
    guardPath: guard.path,
    guardBytes: guard.bytes
  }
  await expectParentFsyncPowerLossPair(keyObservation, root, path, oracle)
  await expectParentFsyncPowerLossPair(stateObservation, root, path, oracle)
}

async function seedCorruptD3BoundaryBase(
  path: string,
  stintId: string,
  sentinel: string
): Promise<WorkerDatabaseSnapshot> {
  await seedWorkerDatabase(path, stintId, sentinel)
  markWorkerDatabaseCorrupt(path)
  const snapshot = readWorkerDatabaseSnapshot(path, stintId)
  expect(snapshot.passportJson).toContain(sentinel)
  expect(JSON.parse(snapshot.privacyJson)).toMatchObject({
    identityPersistenceOptIn: true
  })
  return snapshot
}

async function exerciseJournalParentFsync(
  code: InjectedIoCode
): Promise<void> {
  const path = tempDatabase(`parent-journal-${code.toLowerCase()}`)
  const root = dirname(path)
  const stintId = `old-journal-${code.toLowerCase()}`
  const sentinel = `OLD-D3-JOURNAL-${code}`
  const original = await seedCorruptD3BoundaryBase(path, stintId, sentinel)
  const guard = installUnauthenticatedD3Guard(root, `JOURNAL-${code}`)
  const durableBase = cloneDirectory(root, `parent-journal-${code}-base`)
  const operationId = `repair:parent-fsync:journal:${code}`
  const repair = (fault?: PersistenceProcessFault) =>
    runRepairBoundaryOperation(path, operationId, fault)
  const journalPath = `${path}.repair-journal.json`

  const preBoundary = await prepareRenameLostTree(
    durableBase,
    root,
    repair,
    journalPath,
    `parent-journal-${code}`
  )
  restoreDirectory(preBoundary, root)
  expect(existsSync(`${journalPath}.pending`)).toBe(true)
  expect(existsSync(journalPath)).toBe(false)
  expectIdleRepairProof(path, original.databaseId)
  expect(readWorkerDatabaseSnapshot(path, stintId).passportJson).toContain(sentinel)

  const observation = await observeParentFsyncFault(
    durableBase,
    preBoundary,
    root,
    root,
    {
      durableFile: `${journalPath}.pending`,
      rename: {
        source: `${journalPath}.pending`,
        destination: journalPath
      }
    },
    repair,
    code,
    `parent-journal-${code}`
  )
  expectParentFsyncRpcFailure(observation.response, code, root)

  restoreDirectory(observation.crashVisible, root)
  expect(existsSync(`${journalPath}.pending`)).toBe(false)
  expect(JSON.parse(readFileSync(journalPath, 'utf8'))).toMatchObject({
    operationId,
    phase: 'authorized'
  })
  expectIdleRepairProof(path, original.databaseId)
  expect(existsSync(`${path}.repair-receipt.json`)).toBe(false)
  expect(existsSync(`${path}.repair-receipt.json.pending`)).toBe(false)
  expect(readWorkerDatabaseSnapshot(path, stintId).passportJson).toContain(sentinel)

  const oracle: ParentFsyncRecoveryOracle = {
    mode: 'repair',
    operationId,
    oldStintId: stintId,
    oldSentinel: sentinel,
    guardPath: guard.path,
    guardBytes: guard.bytes
  }
  await expectParentFsyncPowerLossPair(observation, root, path, oracle)
}

function highWaterMarkerPath(
  path: string,
  copy: 'a' | 'b',
  revision: number
): string {
  return join(
    `${path}.repair-high-water-${copy}`,
    `${String(revision).padStart(16, '0')}.json`
  )
}

async function exerciseHighWaterParentFsync(
  code: InjectedIoCode
): Promise<void> {
  const path = tempDatabase(`parent-high-water-${code.toLowerCase()}`)
  const root = dirname(path)
  const stintId = `old-high-water-${code.toLowerCase()}`
  const sentinel = `OLD-D3-HIGH-WATER-${code}`
  const original = await seedCorruptD3BoundaryBase(path, stintId, sentinel)
  const guard = installUnauthenticatedD3Guard(root, `HIGH-WATER-${code}`)
  const durableBase = cloneDirectory(root, `parent-high-water-${code}-base`)
  const operationId = `repair:parent-fsync:high-water:${code}`
  const repair = (fault?: PersistenceProcessFault) =>
    runRepairBoundaryOperation(path, operationId, fault)

  const oracle: ParentFsyncRecoveryOracle = {
    mode: 'repair',
    operationId,
    oldStintId: stintId,
    oldSentinel: sentinel,
    guardPath: guard.path,
    guardBytes: guard.bytes
  }

  for (const copy of ['a', 'b'] as const) {
    const marker = highWaterMarkerPath(path, copy, 1)
    const parentDirectory = `${path}.repair-high-water-${copy}`
    const preBoundary = await prepareRenameLostTree(
      durableBase,
      root,
      repair,
      marker,
      `parent-high-water-${copy}-${code}`
    )
    restoreDirectory(preBoundary, root)
    expect(existsSync(`${marker}.pending`)).toBe(true)
    expect(existsSync(marker)).toBe(false)
    expect(readRepairAuthorityState(path)).toMatchObject({
      completedEpoch: 0,
      highWaterRevision: 0,
      currentDatabaseId: original.databaseId
    })
    expect(JSON.parse(readFileSync(`${path}.repair-journal.json`, 'utf8')))
      .toMatchObject({ operationId, phase: 'authorized', highWaterRevision: 1 })
    const pending = JSON.parse(
      readFileSync(`${marker}.pending`, 'utf8')
    ) as RepairHighWaterTestState
    expect(pending).toMatchObject({
      revision: 1,
      repairEpoch: 1,
      phase: 'authorized',
      operationId
    })
    if (copy === 'a') {
      expect(existsSync(highWaterMarkerPath(path, 'b', 1))).toBe(false)
    } else {
      expect(JSON.parse(
        readFileSync(highWaterMarkerPath(path, 'a', 1), 'utf8')
      )).toMatchObject({
        revision: 1,
        repairEpoch: 1,
        phase: 'authorized',
        operationId
      })
    }
    expect(readWorkerDatabaseSnapshot(path, stintId).passportJson).toContain(sentinel)

    const observation = await observeParentFsyncFault(
      durableBase,
      preBoundary,
      root,
      parentDirectory,
      {
        durableFile: `${marker}.pending`,
        rename: {
          source: `${marker}.pending`,
          destination: marker
        }
      },
      repair,
      code,
      `parent-high-water-${copy}-${code}`
    )
    expectParentFsyncRpcFailure(observation.response, code, parentDirectory)

    restoreDirectory(observation.crashVisible, root)
    const authority = readRepairAuthorityState(path)
    const highWaterA = JSON.parse(
      readFileSync(highWaterMarkerPath(path, 'a', 1), 'utf8')
    ) as RepairHighWaterTestState
    expect(authority).toMatchObject({
      completedEpoch: 0,
      highWaterRevision: 0,
      currentDatabaseId: original.databaseId
    })
    expect(highWaterA).toMatchObject({
      revision: 1,
      repairEpoch: 1,
      phase: 'authorized',
      operationId
    })
    if (copy === 'a') {
      const highWaterB = JSON.parse(
        readFileSync(highWaterMarkerPath(path, 'b', 0), 'utf8')
      ) as RepairHighWaterTestState
      expect(highWaterB).toMatchObject({
        revision: 0,
        repairEpoch: 0,
        phase: 'idle',
        databaseId: original.databaseId
      })
      expect(highWaterA.signature).not.toBe(highWaterB.signature)
      expect(existsSync(highWaterMarkerPath(path, 'b', 1))).toBe(false)
    } else {
      const highWaterB = JSON.parse(
        readFileSync(highWaterMarkerPath(path, 'b', 1), 'utf8')
      ) as RepairHighWaterTestState
      expect(highWaterB).toEqual(highWaterA)
    }
    expect(existsSync(`${path}.repair-receipt.json`)).toBe(false)
    expect(readWorkerDatabaseSnapshot(path, stintId).passportJson).toContain(sentinel)
    expect(readFileSync(guard.path)).toEqual(guard.bytes)

    await expectParentFsyncPowerLossPair(observation, root, path, oracle)
  }
}

function expectCleanupPendingProof(path: string, operationId: string): void {
  const authority = readRepairAuthorityState(path)
  const highWater = readCurrentRepairHighWater(path)
  const receipt = readRepairReceiptState(path)
  expect(authority.lastCompleted).toMatchObject({
    repairEpoch: authority.completedEpoch,
    operationId,
    databaseId: authority.currentDatabaseId,
    journalCleanupPending: true
  })
  expect(highWater).toMatchObject({
    revision: authority.highWaterRevision,
    repairEpoch: authority.completedEpoch,
    phase: 'completed',
    databaseId: authority.currentDatabaseId,
    operationId
  })
  expect(receipt).toMatchObject({
    operationId,
    databaseId: authority.currentDatabaseId,
    tokenHash: authority.lastCompleted?.tokenHash
  })
}

async function exerciseCleanupParentFsync(
  code: InjectedIoCode
): Promise<void> {
  const path = tempDatabase(`parent-cleanup-${code.toLowerCase()}`)
  const root = dirname(path)
  const stintId = `old-cleanup-${code.toLowerCase()}`
  const sentinel = `OLD-D3-CLEANUP-${code}`
  await seedCorruptD3BoundaryBase(path, stintId, sentinel)
  const guard = installUnauthenticatedD3Guard(root, `CLEANUP-${code}`)
  const durableBase = cloneDirectory(root, `parent-cleanup-${code}-base`)
  const operationId = `repair:parent-fsync:cleanup:${code}`
  const repair = (fault?: PersistenceProcessFault) =>
    runRepairBoundaryOperation(path, operationId, fault)
  const initialize = (fault?: PersistenceProcessFault) =>
    runInitializeBoundaryOperation(path, fault)
  const journalPath = `${path}.repair-journal.json`
  const cleanupPath = `${journalPath}.cleanup`

  restoreDirectory(durableBase, root)
  await captureReceiptStagedRepairForExistingDatabase(path, operationId)
  await crashCompletedJournalCleanup(
    path,
    'after-completed-authority-promotion',
    `parent-fsync-cleanup-${code}`
  )
  expectCleanupPendingProof(path, operationId)
  expect(existsSync(journalPath)).toBe(true)
  expect(existsSync(cleanupPath)).toBe(false)
  expect(readWorkerDatabaseSnapshot(path, stintId).passportJson).toBeUndefined()
  expectTreeDoesNotContainSentinel(root, guard.path, sentinel)
  const promotionPreBoundary = cloneDirectory(
    root,
    `parent-cleanup-promotion-${code}-pre-boundary`
  )

  const promotionObservation = await observeParentFsyncFault(
    durableBase,
    promotionPreBoundary,
    root,
    root,
    {
      durableFile: `${journalPath}.pending`,
      rename: {
        source: journalPath,
        destination: cleanupPath
      }
    },
    repair,
    code,
    `parent-cleanup-promotion-${code}`
  )
  expectParentFsyncRpcFailure(promotionObservation.response, code, root)

  restoreDirectory(promotionObservation.crashVisible, root)
  expect(existsSync(journalPath)).toBe(false)
  expect(existsSync(cleanupPath)).toBe(true)
  expect(JSON.parse(readFileSync(cleanupPath, 'utf8'))).toMatchObject({
    operationId,
    phase: 'receipt-staged'
  })
  expectCleanupPendingProof(path, operationId)
  expect(readWorkerDatabaseSnapshot(path, stintId).passportJson).toBeUndefined()
  expectTreeDoesNotContainSentinel(root, guard.path, sentinel)

  const unlinkPreBoundary = promotionObservation.crashVisible
  restoreDirectory(unlinkPreBoundary, root)
  expect(existsSync(journalPath)).toBe(false)
  expect(existsSync(cleanupPath)).toBe(true)
  expectCleanupPendingProof(path, operationId)
  const unlinkObservation = await observeParentFsyncFault(
    unlinkPreBoundary,
    unlinkPreBoundary,
    root,
    root,
    {
      durableFile: cleanupPath,
      remove: {
        event: 'rm',
        target: cleanupPath
      }
    },
    initialize,
    code,
    `parent-cleanup-unlink-${code}`
  )
  expectParentFsyncRpcFailure(unlinkObservation.response, code, root)

  restoreDirectory(unlinkObservation.crashVisible, root)
  expect(existsSync(journalPath)).toBe(false)
  expect(existsSync(cleanupPath)).toBe(false)
  expectCleanupPendingProof(path, operationId)
  expect(readWorkerDatabaseSnapshot(path, stintId).passportJson).toBeUndefined()
  expectTreeDoesNotContainSentinel(root, guard.path, sentinel)
  expect(readFileSync(guard.path)).toEqual(guard.bytes)

  const oracle: ParentFsyncRecoveryOracle = {
    mode: 'repair',
    operationId,
    oldStintId: stintId,
    oldSentinel: sentinel,
    guardPath: guard.path,
    guardBytes: guard.bytes
  }
  await expectParentFsyncPowerLossPair(promotionObservation, root, path, oracle)
  await expectParentFsyncPowerLossPair(unlinkObservation, root, path, oracle)
}

function expectWindowsWriteThroughFault(
  trace: readonly WorkerFaultTrace[],
  destination: string,
  code: InjectedIoCode
): void {
  const faults = trace.filter((entry) =>
    entry.event === 'io-fault' &&
    entry.operation === 'rename' &&
    workerPathsEqual(entry.destination, destination)
  )
  expect(faults.length).toBeGreaterThan(0)
  for (const fault of faults) {
    expect(fault).toMatchObject({
      code,
      flags: 0x1 | 0x8,
      syscall: 'MoveFileExW'
    })
  }
}

async function exerciseWindowsWriteThroughBoundary(
  boundary: ParentFsyncBoundary,
  code: InjectedIoCode
): Promise<void> {
  const path = tempDatabase(`write-through-${boundary}-${code}`)
  const operationId = `repair:write-through:${boundary}:${code}`
  const destination =
    boundary === 'authority'
      ? `${path}.repair-authority.json`
      : boundary === 'high-water'
        ? join(`${path}.repair-high-water-a`, initialHighWaterMarkerName)
        : boundary === 'journal'
          ? `${path}.repair-journal.json`
          : `${path}.repair-journal.json.cleanup`
  if (boundary === 'journal' || boundary === 'cleanup') {
    await seedCorruptD3BoundaryBase(
      path,
      `write-through-${boundary}-${code}`,
      `WRITE-THROUGH-${boundary}-${code}`
    )
  }
  const tracePath = parentFsyncTracePath(
    `write-through-${boundary}-${code}`
  )
  const fault: InjectedIoFault = {
    kind: 'io',
    operation: 'rename',
    path: destination,
    code,
    repeat: true,
    tracePath
  }
  const response =
    boundary === 'journal' || boundary === 'cleanup'
      ? await runRepairBoundaryOperation(path, operationId, fault)
      : await runInitializeBoundaryOperation(path, fault)
  expect(response).toMatchObject({
    ok: false,
    error: expect.stringMatching(new RegExp(code, 'i')),
    code
  })
  expectWindowsWriteThroughFault(
    readWorkerFaultTrace(tracePath),
    destination,
    code
  )
  expect(existsSync(`${path}.directory-authority.sqlite`)).toBe(false)

  await expect(runInitializeBoundaryOperation(path))
    .resolves.toMatchObject({ ok: true })
  if (boundary === 'cleanup') {
    expect(readRepairReceiptState(path)).toMatchObject({ operationId })
    expect(existsSync(`${path}.repair-journal.json`)).toBe(false)
    expect(existsSync(`${path}.repair-journal.json.cleanup`)).toBe(false)
  }
}

describe('packaged Passport persistence worker durable publication', () => {
  it.each(parentFsyncFaultMatrix)(
    '[spec-gap] propagates $code from $boundary durable publication and survives recovery',
    async ({ boundary, code }) => {
      if (process.platform === 'win32') {
        await exerciseWindowsWriteThroughBoundary(boundary, code)
        return
      }
      if (boundary === 'authority') {
        await exerciseAuthorityParentFsync(code)
      } else if (boundary === 'journal') {
        await exerciseJournalParentFsync(code)
      } else if (boundary === 'high-water') {
        await exerciseHighWaterParentFsync(code)
      } else {
        await exerciseCleanupParentFsync(code)
      }
    },
    90_000
  )

  it('[spec-gap] uses MoveFileExW write-through for every Windows repair publication', async () => {
    if (process.platform !== 'win32') return
    const path = tempDatabase('write-through-observe')
    await seedCorruptD3BoundaryBase(
      path,
      'write-through-observe',
      'WRITE-THROUGH-OBSERVE'
    )
    const tracePath = parentFsyncTracePath('write-through-observe')
    const worker = spawnWorker({
      kind: 'native-move',
      mode: 'observe',
      tracePath
    })
    await expect(rpc(worker, 'initialize', [path], 15_000))
      .resolves.toMatchObject({ ok: true })
    const integrity = await rpc(worker, 'getIntegrity')
    const repairToken = (integrity.result as { repairToken?: string }).repairToken ?? ''
    expect(repairToken).toMatch(/^[a-f0-9]+$/)
    await expect(rpc(
      worker,
      'repairPersistence',
      [repairToken, 'repair:write-through:observe'],
      30_000
    )).resolves.toMatchObject({ ok: true })
    await worker.terminate()

    const moves = readWorkerFaultTrace(tracePath).filter((entry) =>
      entry.event === 'rename' && entry.transport === 'MoveFileExW'
    )
    expect(moves.length).toBeGreaterThan(0)
    expect(moves.every((entry) => entry.flags === (0x1 | 0x8))).toBe(true)
    const destinations = moves.map((entry) =>
      comparableWorkerPath(entry.destination ?? '')
    )
    for (const required of [
      `${path}.repair-authority.json`,
      `${path}.repair-journal.json`,
      `${path}.repair-receipt.json`,
      `${path}.repair-journal.json.cleanup`
    ]) {
      expect(destinations).toContain(comparableWorkerPath(required))
    }
    expect(destinations.some((destination) =>
      destination.startsWith(
        `${comparableWorkerPath(`${path}.repair-high-water-a`)}/`
      )
    )).toBe(true)
    expect(existsSync(`${path}.directory-authority.sqlite`)).toBe(false)
  }, 60_000)

  it('[spec-gap] fails closed when the Windows write-through primitive is unavailable', async () => {
    if (process.platform !== 'win32') return
    const path = tempDatabase('write-through-unavailable')
    const tracePath = parentFsyncTracePath('write-through-unavailable')
    await expect(runInitializeBoundaryOperation(path, {
      kind: 'native-move',
      mode: 'unavailable',
      tracePath
    })).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/write-through rename is unavailable/i),
      code: 'PERSISTENCE_HEALTH_ERROR'
    })
    expect(readWorkerFaultTrace(tracePath))
      .toContainEqual(expect.objectContaining({ event: 'native-move-unavailable' }))
    expect(existsSync(`${path}.directory-authority.sqlite`)).toBe(false)
    await expect(runInitializeBoundaryOperation(path))
      .resolves.toMatchObject({ ok: true })
  }, 30_000)
})
