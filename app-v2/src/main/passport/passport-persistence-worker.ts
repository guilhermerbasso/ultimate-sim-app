import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from 'node:crypto'
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  writeSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  DEFAULT_PASSPORT_CONFIG,
  DEFAULT_PASSPORT_PRIVACY
} from '../../shared/stint-passport'
import {
  PASSPORT_PERSISTENCE_SCHEMA_VERSION,
  PassportPersistenceEngine
} from './persistence-engine'
import {
  PASSPORT_DOMAIN_ERROR_CODE,
  classifyPersistenceWorkerError,
  persistenceDomainError
} from './persistence-errors'

interface Request {
  id: number
  method: string
  args: unknown[]
}

interface CrashBoundary {
  operation: string
  checkpoint:
    | 'before-dispatch'
    | 'after-commit-before-response'
    | 'after-repair-journal'
    | 'before-repair-database-header-write'
    | 'after-repair-database-header-write'
    | 'before-repair-database-unlink'
    | 'after-repair-database-unlink'
    | 'after-repair-database-erase'
    | 'after-repair-key-erase'
    | 'after-repair-database-identity-assignment'
    | 'after-repair-database-file-open'
    | 'after-repair-database-identity-create'
    | 'after-repair-database-schema-create'
    | 'after-repair-database-create'
    | 'after-repair-database-erased-high-water-a-temp-create'
    | 'after-repair-database-erased-high-water-a-partial-write'
    | 'after-repair-receipt-temp-write'
    | 'after-repair-receipt-promotion'
}

interface RepairReceipt {
  version: 1
  operationId: string
  tokenHash: string
  databaseId: string
  quarantinedPath: string
  repairedAt: number
}

type RepairPhase =
  | 'authorized'
  | 'erasing-database'
  | 'database-erased'
  | 'keys-erased'
  | 'creating-database'
  | 'database-created'
  | 'receipt-staged'

interface RepairJournalPayload {
  version: 3
  authorityId: string
  profileBinding: string
  repairEpoch: number
  highWaterRevision: number
  operationId: string
  tokenHash: string
  originalDatabaseId: string
  databaseId?: string
  quarantinedPath: string
  repairedAt: number
  phase: RepairPhase
}

interface RepairJournal extends RepairJournalPayload {
  signature: string
}

interface RepairAuthorityCompletion {
  repairEpoch: number
  operationId: string
  tokenHash: string
  originalDatabaseId: string
  databaseId: string
  finalJournalSignature: string
  journalCleanupPending: boolean
}

interface RepairAuthorityPayload {
  version: 2
  authorityId: string
  profileBinding: string
  completedEpoch: number
  highWaterRevision: number
  currentDatabaseId: string
  lastCompleted?: RepairAuthorityCompletion
}

interface RepairAuthority extends RepairAuthorityPayload {
  signature: string
}

type RepairHighWaterPhase = 'idle' | RepairPhase | 'completed'

interface RepairHighWaterPayload {
  version: 1
  authorityId: string
  profileBinding: string
  revision: number
  repairEpoch: number
  phase: RepairHighWaterPhase
  databaseId: string
  operationId?: string
  tokenHash?: string
  originalDatabaseId?: string
  journalSignature?: string
  previousSignature?: string
}

interface RepairHighWater extends RepairHighWaterPayload {
  signature: string
}

interface RepairHighWaterState {
  records: readonly RepairHighWater[]
  current: RepairHighWater
}

interface RepairHighWaterCopy {
  records: readonly RepairHighWater[]
  tornTrailingPath?: string
}

interface RepairSecurityState {
  authority: RepairAuthority
  key: Buffer
  highWater: RepairHighWaterState
}

interface DatabaseProbe {
  state: 'absent' | 'unreadable' | 'readable'
  databaseId?: string
  repairEpoch?: number
  repairBinding?: string
  schemaComplete?: boolean
  pristine?: boolean
  nonDefaultState?: boolean
  userTables?: readonly string[]
}

let engine: PassportPersistenceEngine | null = null
let chain: Promise<void> = Promise.resolve()
let crashBoundary: CrashBoundary | null = null
let repairAuthority: RepairAuthority | null = null
let repairAuthorityKey: Buffer | null = null

const nativeRequire = createRequire(import.meta.url)
const MOVEFILE_REPLACE_EXISTING = 0x1
const MOVEFILE_WRITE_THROUGH = 0x8

interface WindowsMoveApi {
  readonly module: unknown
  readonly library: unknown
  moveFileEx(
    source: string,
    destination: string,
    flags: number
  ): boolean
  getLastError(): number
}

let windowsMoveApi: WindowsMoveApi | undefined

const CRASH_CHECKPOINTS: readonly CrashBoundary['checkpoint'][] = [
  'before-dispatch',
  'after-commit-before-response',
  'after-repair-journal',
  'before-repair-database-header-write',
  'after-repair-database-header-write',
  'before-repair-database-unlink',
  'after-repair-database-unlink',
  'after-repair-database-erase',
  'after-repair-key-erase',
  'after-repair-database-identity-assignment',
  'after-repair-database-file-open',
  'after-repair-database-identity-create',
  'after-repair-database-schema-create',
  'after-repair-database-create',
  'after-repair-database-erased-high-water-a-temp-create',
  'after-repair-database-erased-high-water-a-partial-write',
  'after-repair-receipt-temp-write',
  'after-repair-receipt-promotion'
]

function isCrashCheckpoint(value: unknown): value is CrashBoundary['checkpoint'] {
  return typeof value === 'string' &&
    CRASH_CHECKPOINTS.includes(value as CrashBoundary['checkpoint'])
}

function requireWindowsMoveApi(): WindowsMoveApi {
  if (windowsMoveApi) return windowsMoveApi
  try {
    const koffi = nativeRequire('koffi')
    const kernel32 = koffi.load('kernel32.dll')
    windowsMoveApi = {
      module: koffi,
      library: kernel32,
      moveFileEx: kernel32.func(
        'MoveFileExW',
        'bool',
        ['str16', 'str16', 'uint32']
      ),
      getLastError: kernel32.func('GetLastError', 'uint32', [])
    }
    return windowsMoveApi
  } catch (cause) {
    throw Object.assign(
      new Error('Passport Windows write-through rename is unavailable.'),
      { code: 'ENOTSUP', cause }
    )
  }
}

function windowsMoveErrorCode(error: number): string {
  if (error === 5) return 'EPERM'
  if (error === 32 || error === 33) return 'EBUSY'
  if (error === 39 || error === 112) return 'ENOSPC'
  return 'EIO'
}

function moveFileWriteThrough(source: string, destination: string): void {
  const api = requireWindowsMoveApi()
  if (
    api.moveFileEx(
      resolve(source),
      resolve(destination),
      MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH
    )
  ) {
    return
  }
  const nativeError = api.getLastError()
  const code = windowsMoveErrorCode(nativeError)
  throw Object.assign(
    new Error(
      `${code}: Passport Windows write-through rename failed (Win32 ${nativeError}).`
    ),
    {
      code,
      errno: nativeError,
      syscall: 'MoveFileExW'
    }
  )
}

function removeErasedDurably(path: string): void {
  if (process.platform !== 'win32') {
    rmSync(path, { force: true })
    fsyncParent(path)
    return
  }
  const erased = `${path}.erased`
  rmSync(erased, { force: true })
  promoteDurable(path, erased)
  rmSync(erased, { force: true })
}

function secureErase(path: string): void {
  if (!existsSync(path)) return
  const descriptor = openSync(path, 'r+')
  try {
    const size = fstatSync(descriptor).size
    const zeros = Buffer.alloc(Math.min(1024 * 1024, Math.max(1, size)))
    for (let offset = 0; offset < size; offset += zeros.length) {
      writeSync(descriptor, zeros, 0, Math.min(zeros.length, size - offset), offset)
    }
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  removeErasedDurably(path)
}

function secureEraseDatabase(path: string): void {
  if (!existsSync(path)) {
    repairCheckpoint('after-repair-database-unlink', 103)
    return
  }
  const descriptor = openSync(path, 'r+')
  try {
    const size = fstatSync(descriptor).size
    const headerSize = Math.min(size, 4_096)
    repairCheckpoint('before-repair-database-header-write', 99)
    if (headerSize > 0) {
      writeSync(descriptor, Buffer.alloc(headerSize), 0, headerSize, 0)
      fsyncSync(descriptor)
    }
    repairCheckpoint('after-repair-database-header-write', 100)
    const zeros = Buffer.alloc(Math.min(1024 * 1024, Math.max(1, size)))
    for (let offset = headerSize; offset < size; offset += zeros.length) {
      writeSync(descriptor, zeros, 0, Math.min(zeros.length, size - offset), offset)
    }
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  repairCheckpoint('before-repair-database-unlink', 101)
  removeErasedDurably(path)
  repairCheckpoint('after-repair-database-unlink', 102)
}

function requireEngine(): PassportPersistenceEngine {
  if (!engine) throw new Error('Passport persistence process is not initialized.')
  return engine
}

function repairReceiptPath(databasePath: string): string {
  return `${databasePath}.repair-receipt.json`
}

function repairJournalPath(databasePath: string): string {
  return `${databasePath}.repair-journal.json`
}

function repairJournalCleanupPath(databasePath: string): string {
  return `${repairJournalPath(databasePath)}.cleanup`
}

function repairAuthorityPath(databasePath: string): string {
  return `${databasePath}.repair-authority.json`
}

function repairAuthorityKeyPath(databasePath: string): string {
  return `${databasePath}.repair-authority.key`
}

function repairHighWaterDirectory(databasePath: string, copy: 'a' | 'b'): string {
  return `${databasePath}.repair-high-water-${copy}`
}

function fsyncParent(path: string): void {
  let descriptor: number | undefined
  try {
    descriptor = openSync(dirname(path), 'r')
    fsyncSync(descriptor)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function writeDurable(path: string, content: string): void {
  const descriptor = openSync(path, 'w')
  try {
    writeSync(descriptor, content, undefined, 'utf8')
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function waitSynchronously(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

function promoteDurable(source: string, destination: string): void {
  const delays = [0, 4, 8, 16, 32, 64, 128] as const
  let lastError: unknown
  for (const delay of delays) {
    if (delay > 0) waitSynchronously(delay)
    try {
      if (process.platform === 'win32') {
        moveFileWriteThrough(source, destination)
      } else {
        renameSync(source, destination)
      }
    } catch (error) {
      lastError = error
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') throw error
      continue
    }
    if (process.platform !== 'win32') fsyncParent(destination)
    return
  }
  throw lastError
}

function writeAtomicDurable(path: string, value: unknown): void {
  const pending = `${path}.pending`
  rmSync(pending, { force: true })
  writeDurable(pending, `${JSON.stringify(value)}\n`)
  promoteDurable(pending, path)
}

function validRepairArtifactPath(databasePath: string, value: unknown): value is string {
  if (typeof value !== 'string') return false
  const prefix = `${databasePath}.quarantine-`
  if (!value.startsWith(prefix) || !value.endsWith('.json')) return false
  return /^\d+$/.test(value.slice(prefix.length, -'.json'.length))
}

function readRepairReceipt(databasePath: string): RepairReceipt | undefined {
  const path = repairReceiptPath(databasePath)
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<RepairReceipt>
    if (
      value.version !== 1 ||
      typeof value.operationId !== 'string' ||
      !/^[A-Za-z0-9:_-]{16,160}$/.test(value.operationId) ||
      typeof value.tokenHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.tokenHash) ||
      typeof value.databaseId !== 'string' ||
      !/^[a-f0-9]{48}$/.test(value.databaseId) ||
      !validRepairArtifactPath(databasePath, value.quarantinedPath) ||
      !Number.isSafeInteger(value.repairedAt) ||
      Number(value.repairedAt) < 0
    ) {
      return undefined
    }
    return value as RepairReceipt
  } catch {
    return undefined
  }
}

function stageRepairReceipt(databasePath: string, receipt: RepairReceipt): void {
  const path = repairReceiptPath(databasePath)
  const pending = `${path}.pending`
  rmSync(pending, { force: true })
  writeDurable(pending, `${JSON.stringify(receipt)}\n`)
}

function promoteRepairReceipt(databasePath: string): void {
  const path = repairReceiptPath(databasePath)
  promoteDurable(`${path}.pending`, path)
}

function profileBindingFor(databasePath: string): string {
  const canonical = resolve(databasePath).replace(/\\/g, '/')
  return createHash('sha256')
    .update(process.platform === 'win32' ? canonical.toLowerCase() : canonical, 'utf8')
    .digest('hex')
}

function validHex(value: unknown, length: number): value is string {
  return typeof value === 'string' &&
    value.length === length &&
    /^[a-f0-9]+$/.test(value)
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (!validHex(left, 64) || !validHex(right, 64)) return false
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}

function repairAuthorityPayload(value: RepairAuthorityPayload): RepairAuthorityPayload {
  return {
    version: 2,
    authorityId: value.authorityId,
    profileBinding: value.profileBinding,
    completedEpoch: value.completedEpoch,
    highWaterRevision: value.highWaterRevision,
    currentDatabaseId: value.currentDatabaseId,
    lastCompleted: value.lastCompleted
      ? {
          repairEpoch: value.lastCompleted.repairEpoch,
          operationId: value.lastCompleted.operationId,
          tokenHash: value.lastCompleted.tokenHash,
          originalDatabaseId: value.lastCompleted.originalDatabaseId,
          databaseId: value.lastCompleted.databaseId,
          finalJournalSignature: value.lastCompleted.finalJournalSignature,
          journalCleanupPending: value.lastCompleted.journalCleanupPending
        }
      : undefined
  }
}

function repairAuthorityCanonical(value: RepairAuthorityPayload): string {
  const payload = repairAuthorityPayload(value)
  return JSON.stringify({
    version: payload.version,
    authorityId: payload.authorityId,
    profileBinding: payload.profileBinding,
    completedEpoch: payload.completedEpoch,
    highWaterRevision: payload.highWaterRevision,
    currentDatabaseId: payload.currentDatabaseId,
    lastCompleted: payload.lastCompleted ?? null
  })
}

function repairJournalPayload(value: RepairJournalPayload): RepairJournalPayload {
  return {
    version: 3,
    authorityId: value.authorityId,
    profileBinding: value.profileBinding,
    repairEpoch: value.repairEpoch,
    highWaterRevision: value.highWaterRevision,
    operationId: value.operationId,
    tokenHash: value.tokenHash,
    originalDatabaseId: value.originalDatabaseId,
    databaseId: value.databaseId,
    quarantinedPath: value.quarantinedPath,
    repairedAt: value.repairedAt,
    phase: value.phase
  }
}

function repairJournalCanonical(value: RepairJournalPayload): string {
  const payload = repairJournalPayload(value)
  return JSON.stringify({
    version: payload.version,
    authorityId: payload.authorityId,
    profileBinding: payload.profileBinding,
    repairEpoch: payload.repairEpoch,
    highWaterRevision: payload.highWaterRevision,
    operationId: payload.operationId,
    tokenHash: payload.tokenHash,
    originalDatabaseId: payload.originalDatabaseId,
    databaseId: payload.databaseId ?? null,
    quarantinedPath: payload.quarantinedPath,
    repairedAt: payload.repairedAt,
    phase: payload.phase
  })
}

function signRepairValue(key: Buffer, canonical: string): string {
  return createHmac('sha256', key).update(canonical, 'utf8').digest('hex')
}

function repairHighWaterPayload(value: RepairHighWaterPayload): RepairHighWaterPayload {
  return {
    version: 1,
    authorityId: value.authorityId,
    profileBinding: value.profileBinding,
    revision: value.revision,
    repairEpoch: value.repairEpoch,
    phase: value.phase,
    databaseId: value.databaseId,
    operationId: value.operationId,
    tokenHash: value.tokenHash,
    originalDatabaseId: value.originalDatabaseId,
    journalSignature: value.journalSignature,
    previousSignature: value.previousSignature
  }
}

function repairHighWaterCanonical(value: RepairHighWaterPayload): string {
  const payload = repairHighWaterPayload(value)
  return JSON.stringify({
    version: payload.version,
    authorityId: payload.authorityId,
    profileBinding: payload.profileBinding,
    revision: payload.revision,
    repairEpoch: payload.repairEpoch,
    phase: payload.phase,
    databaseId: payload.databaseId,
    operationId: payload.operationId ?? null,
    tokenHash: payload.tokenHash ?? null,
    originalDatabaseId: payload.originalDatabaseId ?? null,
    journalSignature: payload.journalSignature ?? null,
    previousSignature: payload.previousSignature ?? null
  })
}

function parseRepairHighWater(
  databasePath: string,
  path: string,
  key: Buffer
): RepairHighWater {
  const bytes = readFileSync(path)
  if (bytes.length === 0 || bytes[bytes.length - 1] !== 0x0a) {
    throw new TornRepairHighWaterMarkerError()
  }
  if (bytes.length > 16 * 1024) {
    throw new Error('Passport repair high-water marker exceeds its parser boundary.')
  }
  const value = JSON.parse(bytes.toString('utf8')) as Partial<RepairHighWater>
  const phases: readonly RepairHighWaterPhase[] = [
    'idle',
    'authorized',
    'erasing-database',
    'database-erased',
    'keys-erased',
    'creating-database',
    'database-created',
    'receipt-staged',
    'completed'
  ]
  const operationBound = value.phase !== 'idle'
  if (
    value.version !== 1 ||
    !validHex(value.authorityId, 48) ||
    !validHex(value.profileBinding, 64) ||
    value.profileBinding !== profileBindingFor(databasePath) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !Number.isSafeInteger(value.repairEpoch) ||
    Number(value.repairEpoch) < 0 ||
    !phases.includes(value.phase as RepairHighWaterPhase) ||
    !validHex(value.databaseId, 48) ||
    (
      operationBound &&
      (
        Number(value.repairEpoch) < 1 ||
        typeof value.operationId !== 'string' ||
        !/^[A-Za-z0-9:_-]{16,160}$/.test(value.operationId) ||
        !validHex(value.tokenHash, 64) ||
        !validHex(value.originalDatabaseId, 48) ||
        !validHex(value.journalSignature, 64)
      )
    ) ||
    (
      !operationBound &&
      (
        value.operationId !== undefined ||
        value.tokenHash !== undefined ||
        value.originalDatabaseId !== undefined ||
        value.journalSignature !== undefined
      )
    ) ||
    (Number(value.revision) === 0
      ? value.previousSignature !== undefined
      : !validHex(value.previousSignature, 64)) ||
    !validHex(value.signature, 64)
  ) {
    throw new Error('Passport repair high-water marker is invalid.')
  }
  const payload = repairHighWaterPayload(value as RepairHighWater)
  const expected = signRepairValue(key, repairHighWaterCanonical(payload))
  if (!constantTimeHexEqual(value.signature, expected)) {
    throw new Error('Passport repair high-water marker authentication failed.')
  }
  return { ...payload, signature: value.signature }
}

function repairHighWaterMarkerName(revision: number): string {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error('Passport repair high-water revision is invalid.')
  }
  return `${String(revision).padStart(16, '0')}.json`
}

class TornRepairHighWaterMarkerError extends Error {
  constructor() {
    super('Passport repair high-water marker is torn.')
  }
}

function readRepairHighWaterCopy(
  databasePath: string,
  copy: 'a' | 'b',
  key: Buffer,
  removePending = true
): RepairHighWaterCopy | undefined {
  const directory = repairHighWaterDirectory(databasePath, copy)
  if (!existsSync(directory)) return undefined
  const entries = readdirSync(directory).sort()
  const pendingPattern = /^\d{16}\.json\.pending$/
  if (removePending) {
    for (const name of entries) {
      if (pendingPattern.test(name)) rmSync(resolve(directory, name), { force: true })
    }
  }
  const names = entries.filter((name) => !pendingPattern.test(name))
  if (names.some((name) => !/^\d{16}\.json$/.test(name))) {
    throw new Error('Passport repair high-water history contains an unexpected marker.')
  }
  if (names.length > 4_096) {
    throw new Error('Passport repair high-water history is missing or exceeds its bound.')
  }
  const records: RepairHighWater[] = []
  let tornTrailingPath: string | undefined
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]
    if (name !== repairHighWaterMarkerName(index)) {
      throw new Error('Passport repair high-water history is not contiguous.')
    }
    const path = resolve(directory, name)
    try {
      records.push(parseRepairHighWater(databasePath, path, key))
    } catch (error) {
      if (index === names.length - 1) {
        tornTrailingPath = path
        break
      }
      throw error
    }
  }
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (
      record.revision !== index ||
      (index === 0
        ? record.previousSignature !== undefined
        : record.previousSignature !== records[index - 1].signature)
    ) {
      throw new Error('Passport repair high-water chain is invalid.')
    }
  }
  return { records, tornTrailingPath }
}

function writeRepairHighWaterCopy(
  databasePath: string,
  copy: 'a' | 'b',
  record: RepairHighWater,
  key: Buffer
): void {
  const directory = repairHighWaterDirectory(databasePath, copy)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const path = resolve(directory, repairHighWaterMarkerName(record.revision))
  if (existsSync(path)) {
    const existing = parseRepairHighWater(databasePath, path, key)
    if (existing.signature !== record.signature) {
      throw new Error('Passport repair high-water marker cannot be replaced.')
    }
    return
  }
  const pending = `${path}.pending`
  rmSync(pending, { force: true })
  const descriptor = openSync(pending, 'wx', 0o600)
  try {
    if (
      copy === 'a' &&
      record.phase === 'database-erased' &&
      crashBoundary?.operation === 'repairPersistence' &&
      crashBoundary.checkpoint === 'after-repair-database-erased-high-water-a-temp-create'
    ) {
      process.exit(105)
    }
    const content = `${JSON.stringify({
      ...repairHighWaterPayload(record),
      signature: record.signature
    })}\n`
    if (
      copy === 'a' &&
      record.phase === 'database-erased' &&
      crashBoundary?.operation === 'repairPersistence' &&
      crashBoundary.checkpoint === 'after-repair-database-erased-high-water-a-partial-write'
    ) {
      writeSync(descriptor, content.slice(0, Math.max(1, Math.floor(content.length / 2))), undefined, 'utf8')
      process.exit(106)
    }
    writeSync(descriptor, content, undefined, 'utf8')
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  promoteDurable(pending, path)
}

function synchronizeRepairHighWaterCopy(
  databasePath: string,
  copy: 'a' | 'b',
  records: readonly RepairHighWater[],
  from: number,
  key: Buffer
): void {
  for (let index = from; index < records.length; index += 1) {
    writeRepairHighWaterCopy(databasePath, copy, records[index], key)
  }
}

function readRepairHighWater(
  databasePath: string,
  key: Buffer
): RepairHighWaterState | undefined {
  let left: RepairHighWaterCopy | undefined
  let right: RepairHighWaterCopy | undefined
  let leftError: unknown
  let rightError: unknown
  try {
    left = readRepairHighWaterCopy(databasePath, 'a', key)
  } catch (error) {
    leftError = error
  }
  try {
    right = readRepairHighWaterCopy(databasePath, 'b', key)
  } catch (error) {
    rightError = error
  }
  if (leftError || rightError) {
    throw leftError ?? rightError
  }
  if (!left && !right) return undefined
  if (
    (!left || left.records.length === 0 || left.tornTrailingPath) &&
    (!right || right.records.length === 0 || right.tornTrailingPath)
  ) {
    throw new Error('Passport repair high-water copies are both incomplete.')
  }
  const leftRecords = left?.records ?? []
  const rightRecords = right?.records ?? []
  const sharedLength = Math.min(leftRecords.length, rightRecords.length)
  for (let index = 0; index < sharedLength; index += 1) {
    if (leftRecords[index].signature !== rightRecords[index].signature) {
      throw new Error('Passport repair high-water copies diverged.')
    }
  }
  const longest = leftRecords.length >= rightRecords.length ? leftRecords : rightRecords
  const synchronize = (
    copy: 'a' | 'b',
    state: RepairHighWaterCopy | undefined
  ): void => {
    if (state?.tornTrailingPath) {
      rmSync(repairHighWaterDirectory(databasePath, copy), { recursive: true, force: true })
      synchronizeRepairHighWaterCopy(databasePath, copy, longest, 0, key)
      return
    }
    if (!state || state.records.length < longest.length) {
      synchronizeRepairHighWaterCopy(databasePath, copy, longest, state?.records.length ?? 0, key)
    }
  }
  synchronize('a', left)
  synchronize('b', right)
  if (longest.length === 0) {
    throw new Error('Passport repair high-water history is missing.')
  }
  return { records: longest, current: longest[longest.length - 1] }
}

function readCompletedRepairHighWaterProof(
  databasePath: string,
  key: Buffer
): RepairHighWaterState {
  for (const copy of ['a', 'b'] as const) {
    const directory = repairHighWaterDirectory(databasePath, copy)
    if (
      !existsSync(directory) ||
      readdirSync(directory).some((name) => name.endsWith('.pending'))
    ) {
      throw new Error('Passport completed repair high-water proof is incomplete.')
    }
  }
  const left = readRepairHighWaterCopy(databasePath, 'a', key, false)
  const right = readRepairHighWaterCopy(databasePath, 'b', key, false)
  if (
    !left ||
    !right ||
    left.tornTrailingPath ||
    right.tornTrailingPath ||
    left.records.length === 0 ||
    left.records.length !== right.records.length ||
    left.records.some((record, index) =>
      record.signature !== right.records[index].signature
    )
  ) {
    throw new Error('Passport completed repair high-water copies do not agree.')
  }
  return {
    records: left.records,
    current: left.records[left.records.length - 1]
  }
}

function appendRepairHighWater(
  databasePath: string,
  state: RepairHighWaterState,
  value: Omit<RepairHighWaterPayload, 'version' | 'revision' | 'previousSignature'>,
  key: Buffer
): RepairHighWaterState {
  if (state.records.length >= 4_096) {
    throw new Error('Passport repair high-water history exhausted its bounded capacity.')
  }
  const payload: RepairHighWaterPayload = {
    version: 1,
    ...value,
    revision: state.current.revision + 1,
    previousSignature: state.current.signature
  }
  const record: RepairHighWater = {
    ...payload,
    signature: signRepairValue(key, repairHighWaterCanonical(payload))
  }
  writeRepairHighWaterCopy(databasePath, 'a', record, key)
  writeRepairHighWaterCopy(databasePath, 'b', record, key)
  const records = [...state.records, record]
  return { records, current: record }
}

function createInitialRepairHighWater(
  databasePath: string,
  authorityId: string,
  databaseId: string,
  key: Buffer
): RepairHighWaterState {
  const payload: RepairHighWaterPayload = {
    version: 1,
    authorityId,
    profileBinding: profileBindingFor(databasePath),
    revision: 0,
    repairEpoch: 0,
    phase: 'idle',
    databaseId
  }
  const record: RepairHighWater = {
    ...payload,
    signature: signRepairValue(key, repairHighWaterCanonical(payload))
  }
  writeRepairHighWaterCopy(databasePath, 'a', record, key)
  writeRepairHighWaterCopy(databasePath, 'b', record, key)
  return { records: [record], current: record }
}

function assertInitialRepairBootstrapDatabase(
  databasePath: string,
  databaseId: string
): void {
  for (const path of [
    repairJournalPath(databasePath),
    `${repairJournalPath(databasePath)}.pending`,
    repairJournalCleanupPath(databasePath),
    repairReceiptPath(databasePath),
    `${repairReceiptPath(databasePath)}.pending`
  ]) {
    if (existsSync(path)) {
      throw new Error('Passport repair security bootstrap found existing repair state.')
    }
  }
  const probe = probeDatabase(databasePath)
  if (
    probe.state !== 'readable' ||
    !probe.pristine ||
    probe.databaseId !== databaseId ||
    probe.repairEpoch !== undefined ||
    probe.repairBinding !== undefined
  ) {
    throw new Error(
      'Passport repair security bootstrap requires an unmodified pristine database.'
    )
  }
}

function inspectInitialRepairAuthority(
  databasePath: string,
  databaseId: string,
  key: Buffer
): RepairAuthority | undefined {
  const path = repairAuthorityPath(databasePath)
  const pendingPath = `${path}.pending`
  const current = existsSync(path)
    ? parseRepairAuthority(databasePath, path, key)
    : undefined
  let pending: RepairAuthority | undefined
  if (existsSync(pendingPath)) {
    try {
      pending = parseRepairAuthority(databasePath, pendingPath, key)
    } catch {
      pending = undefined
    }
  }
  for (const authority of [current, pending]) {
    if (
      authority &&
      (
        authority.completedEpoch !== 0 ||
        authority.highWaterRevision !== 0 ||
        authority.currentDatabaseId !== databaseId ||
        authority.lastCompleted !== undefined
      )
    ) {
      throw new Error(
        'Passport repair security bootstrap cannot replace non-initial authority state.'
      )
    }
  }
  if (
    current &&
    pending &&
    (
      current.authorityId !== pending.authorityId ||
      current.signature !== pending.signature
    )
  ) {
    throw new Error('Passport initial repair authority candidates diverged.')
  }
  return pending ?? current
}

function inspectInitialRepairHighWater(
  databasePath: string,
  databaseId: string,
  key: Buffer
): RepairHighWater | undefined {
  const copies = (['a', 'b'] as const).map((copy) => {
    const directory = repairHighWaterDirectory(databasePath, copy)
    if (existsSync(directory)) {
      const pendingNames = readdirSync(directory)
        .filter((name) => name.endsWith('.pending'))
      if (
        pendingNames.some((name) =>
          name !== `${repairHighWaterMarkerName(0)}.pending`
        )
      ) {
        throw new Error(
          'Passport repair security bootstrap found a non-initial pending high-water marker.'
        )
      }
    }
    return readRepairHighWaterCopy(databasePath, copy, key, false)
  })
  const records = copies
    .filter((copy): copy is RepairHighWaterCopy => copy !== undefined)
    .map((copy) => {
      if (copy.tornTrailingPath || copy.records.length > 1) {
        throw new Error(
          'Passport repair security bootstrap found non-initial high-water history.'
        )
      }
      return copy.records[0]
    })
    .filter((record): record is RepairHighWater => record !== undefined)
  for (const record of records) {
    if (
      record.revision !== 0 ||
      record.repairEpoch !== 0 ||
      record.phase !== 'idle' ||
      record.databaseId !== databaseId ||
      record.operationId !== undefined ||
      record.tokenHash !== undefined ||
      record.originalDatabaseId !== undefined ||
      record.journalSignature !== undefined ||
      record.previousSignature !== undefined
    ) {
      throw new Error(
        'Passport repair security bootstrap cannot replace active or completed high-water state.'
      )
    }
  }
  if (
    records.length === 2 &&
    records[0].signature !== records[1].signature
  ) {
    throw new Error('Passport initial repair high-water copies diverged.')
  }
  return records[0]
}

function resumeInitialRepairSecurityBootstrap(
  databasePath: string,
  databaseId: string
): RepairSecurityState {
  assertInitialRepairBootstrapDatabase(databasePath, databaseId)
  const keyPath = repairAuthorityKeyPath(databasePath)
  const stateExists =
    existsSync(repairAuthorityPath(databasePath)) ||
    existsSync(`${repairAuthorityPath(databasePath)}.pending`)
  const highWaterExists =
    existsSync(repairHighWaterDirectory(databasePath, 'a')) ||
    existsSync(repairHighWaterDirectory(databasePath, 'b'))
  let key: Buffer | undefined
  if (existsSync(keyPath)) {
    try {
      key = readRepairAuthorityKey(databasePath)
    } catch (error) {
      if (stateExists || highWaterExists) throw error
      secureErase(keyPath)
    }
  } else if (stateExists || highWaterExists) {
    throw new Error(
      'Passport repair authority key is missing from an existing security bootstrap.'
    )
  }
  key ??= createRepairAuthorityKey(databasePath)
  const authority = inspectInitialRepairAuthority(databasePath, databaseId, key)
  const highWater = inspectInitialRepairHighWater(databasePath, databaseId, key)
  if (
    authority &&
    highWater &&
    authority.authorityId !== highWater.authorityId
  ) {
    throw new Error('Passport initial repair security components diverged.')
  }
  const authorityId =
    authority?.authorityId ??
    highWater?.authorityId ??
    randomBytes(24).toString('hex')
  rmSync(repairHighWaterDirectory(databasePath, 'a'), { recursive: true, force: true })
  rmSync(repairHighWaterDirectory(databasePath, 'b'), { recursive: true, force: true })
  const rebuiltHighWater = createInitialRepairHighWater(
    databasePath,
    authorityId,
    databaseId,
    key
  )
  rmSync(repairAuthorityPath(databasePath), { force: true })
  rmSync(`${repairAuthorityPath(databasePath)}.pending`, { force: true })
  const rebuiltAuthority = writeRepairAuthority(databasePath, {
    version: 2,
    authorityId,
    profileBinding: profileBindingFor(databasePath),
    completedEpoch: 0,
    highWaterRevision: rebuiltHighWater.current.revision,
    currentDatabaseId: databaseId
  }, key)
  return {
    authority: rebuiltAuthority,
    key,
    highWater: rebuiltHighWater
  }
}

function parseRepairAuthority(
  databasePath: string,
  path: string,
  key: Buffer
): RepairAuthority {
  const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<RepairAuthority>
  const completion = value.lastCompleted as Partial<RepairAuthorityCompletion> | undefined
  const completionValid = completion === undefined || (
    Number.isSafeInteger(completion.repairEpoch) &&
    Number(completion.repairEpoch) >= 1 &&
    typeof completion.operationId === 'string' &&
    /^[A-Za-z0-9:_-]{16,160}$/.test(completion.operationId) &&
    validHex(completion.tokenHash, 64) &&
    validHex(completion.originalDatabaseId, 48) &&
    validHex(completion.databaseId, 48) &&
    validHex(completion.finalJournalSignature, 64) &&
    typeof completion.journalCleanupPending === 'boolean'
  )
  if (
    value.version !== 2 ||
    !validHex(value.authorityId, 48) ||
    !validHex(value.profileBinding, 64) ||
    value.profileBinding !== profileBindingFor(databasePath) ||
    !Number.isSafeInteger(value.completedEpoch) ||
    Number(value.completedEpoch) < 0 ||
    !Number.isSafeInteger(value.highWaterRevision) ||
    Number(value.highWaterRevision) < 0 ||
    !validHex(value.currentDatabaseId, 48) ||
    !completionValid ||
    (Number(value.completedEpoch) === 0 && completion !== undefined) ||
    (
      Number(value.completedEpoch) > 0 &&
      (
        completion === undefined ||
        completion.repairEpoch !== value.completedEpoch ||
        completion.databaseId !== value.currentDatabaseId
      )
    ) ||
    !validHex(value.signature, 64)
  ) {
    throw new Error('Passport repair authority is invalid or belongs to another profile.')
  }
  const payload = repairAuthorityPayload(value as RepairAuthority)
  const expected = signRepairValue(key, repairAuthorityCanonical(payload))
  if (!constantTimeHexEqual(value.signature, expected)) {
    throw new Error('Passport repair authority authentication failed.')
  }
  return { ...payload, signature: value.signature }
}

function readRepairAuthorityKey(databasePath: string): Buffer {
  const path = repairAuthorityKeyPath(databasePath)
  const value = readFileSync(path, 'utf8').trim()
  if (!validHex(value, 64)) throw new Error('Passport repair authority key is invalid.')
  return Buffer.from(value, 'hex')
}

function createRepairAuthorityKey(databasePath: string): Buffer {
  const path = repairAuthorityKeyPath(databasePath)
  const pending = `${path}.pending`
  const key = randomBytes(32)
  if (existsSync(path)) {
    throw Object.assign(
      new Error('Passport repair authority key already exists.'),
      { code: 'EEXIST' }
    )
  }
  rmSync(pending, { force: true })
  const descriptor = openSync(pending, 'wx', 0o600)
  try {
    writeSync(descriptor, `${key.toString('hex')}\n`, undefined, 'utf8')
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  promoteDurable(pending, path)
  return key
}

function writeRepairAuthority(
  databasePath: string,
  value: RepairAuthorityPayload,
  key: Buffer
): RepairAuthority {
  const payload = repairAuthorityPayload(value)
  const authority: RepairAuthority = {
    ...payload,
    signature: signRepairValue(key, repairAuthorityCanonical(payload))
  }
  writeAtomicDurable(repairAuthorityPath(databasePath), authority)
  return authority
}

function authorityCandidateSupersedes(
  current: RepairAuthority | undefined,
  candidate: RepairAuthority
): boolean {
  if (!current) return true
  if (candidate.highWaterRevision > current.highWaterRevision) return true
  if (candidate.highWaterRevision < current.highWaterRevision) return false
  if (candidate.completedEpoch > current.completedEpoch) return true
  if (candidate.completedEpoch < current.completedEpoch) return false
  if (candidate.signature === current.signature) return true
  const before = current.lastCompleted
  const after = candidate.lastCompleted
  return before !== undefined &&
    after !== undefined &&
    before.journalCleanupPending &&
    !after.journalCleanupPending &&
    before.repairEpoch === after.repairEpoch &&
    before.operationId === after.operationId &&
    before.tokenHash === after.tokenHash &&
    before.originalDatabaseId === after.originalDatabaseId &&
    before.databaseId === after.databaseId &&
    before.finalJournalSignature === after.finalJournalSignature
}

function readExistingRepairAuthority(
  databasePath: string
): { authority: RepairAuthority; key: Buffer } {
  const keyPath = repairAuthorityKeyPath(databasePath)
  const path = repairAuthorityPath(databasePath)
  const pending = `${path}.pending`
  if (!existsSync(keyPath) || (!existsSync(path) && !existsSync(pending))) {
    throw new Error('Passport repair authority is missing while a repair journal exists.')
  }
  const key = readRepairAuthorityKey(databasePath)
  const current = existsSync(path) ? parseRepairAuthority(databasePath, path, key) : undefined
  const candidate = existsSync(pending)
    ? parseRepairAuthority(databasePath, pending, key)
    : undefined
  if (
    current &&
    candidate &&
    (
      current.authorityId !== candidate.authorityId ||
      current.profileBinding !== candidate.profileBinding
    )
  ) {
    throw new Error('Passport repair authority promotion is inconsistent.')
  }
  if (
    candidate &&
    authorityCandidateSupersedes(current, candidate)
  ) {
    promoteDurable(pending, path)
    return { authority: candidate, key }
  }
  rmSync(pending, { force: true })
  if (!current) throw new Error('Passport repair authority is unavailable.')
  return { authority: current, key }
}

function validateSettledRepairAuthority(
  authority: RepairAuthority,
  highWater: RepairHighWater
): void {
  if (
    (highWater.phase !== 'idle' && highWater.phase !== 'completed') ||
    authority.authorityId !== highWater.authorityId ||
    authority.profileBinding !== highWater.profileBinding ||
    authority.completedEpoch !== highWater.repairEpoch ||
    authority.highWaterRevision !== highWater.revision ||
    authority.currentDatabaseId !== highWater.databaseId
  ) {
    throw new Error('Passport repair authority does not match its monotonic high-water mark.')
  }
  if (highWater.phase === 'idle') {
    if (authority.completedEpoch !== 0 || authority.lastCompleted !== undefined) {
      throw new Error('Passport initial repair authority is inconsistent.')
    }
    return
  }
  const completed = authority.lastCompleted
  if (
    !completed ||
    completed.repairEpoch !== highWater.repairEpoch ||
    completed.operationId !== highWater.operationId ||
    completed.tokenHash !== highWater.tokenHash ||
    completed.originalDatabaseId !== highWater.originalDatabaseId ||
    completed.databaseId !== highWater.databaseId ||
    completed.finalJournalSignature !== highWater.journalSignature
  ) {
    throw new Error('Passport completed repair authority is inconsistent.')
  }
}

function readExistingRepairSecurity(databasePath: string): RepairSecurityState {
  const loaded = readExistingRepairAuthority(databasePath)
  const highWater = loaded.authority.lastCompleted?.journalCleanupPending
    ? readCompletedRepairHighWaterProof(databasePath, loaded.key)
    : readRepairHighWater(databasePath, loaded.key)
  if (!highWater) {
    throw new Error('Passport repair monotonic high-water history is missing.')
  }
  if (
    highWater.current.authorityId !== loaded.authority.authorityId ||
    highWater.current.profileBinding !== loaded.authority.profileBinding
  ) {
    throw new Error('Passport repair high-water history belongs to another authority.')
  }
  return { ...loaded, highWater }
}

function loadOrCreateRepairSecurity(
  databasePath: string,
  databaseId: string
): RepairSecurityState {
  const keyExists = existsSync(repairAuthorityKeyPath(databasePath))
  const stateExists =
    existsSync(repairAuthorityPath(databasePath)) ||
    existsSync(`${repairAuthorityPath(databasePath)}.pending`)
  const highWaterExists =
    existsSync(repairHighWaterDirectory(databasePath, 'a')) ||
    existsSync(repairHighWaterDirectory(databasePath, 'b'))
  if (keyExists && stateExists && highWaterExists) {
    try {
      const loaded = readExistingRepairSecurity(databasePath)
      validateSettledRepairAuthority(loaded.authority, loaded.highWater.current)
      if (loaded.highWater.current.databaseId !== databaseId) {
        throw new Error('Passport database identity does not match its repair authority.')
      }
      return loaded
    } catch (error) {
      try {
        return resumeInitialRepairSecurityBootstrap(databasePath, databaseId)
      } catch {
        throw error
      }
    }
  }
  return resumeInitialRepairSecurityBootstrap(databasePath, databaseId)
}

function parseRepairJournal(
  databasePath: string,
  path: string,
  key: Buffer
): RepairJournal {
  const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<RepairJournal>
  const phases: readonly RepairPhase[] = [
    'authorized',
    'erasing-database',
    'database-erased',
    'keys-erased',
    'creating-database',
    'database-created',
    'receipt-staged'
  ]
  if (
    value.version !== 3 ||
    !validHex(value.authorityId, 48) ||
    !validHex(value.profileBinding, 64) ||
    !Number.isSafeInteger(value.repairEpoch) ||
    Number(value.repairEpoch) < 1 ||
    !Number.isSafeInteger(value.highWaterRevision) ||
    Number(value.highWaterRevision) < 1 ||
    typeof value.operationId !== 'string' ||
    !/^[A-Za-z0-9:_-]{16,160}$/.test(value.operationId) ||
    !validHex(value.tokenHash, 64) ||
    !validHex(value.originalDatabaseId, 48) ||
    !validRepairArtifactPath(databasePath, value.quarantinedPath) ||
    !Number.isSafeInteger(value.repairedAt) ||
    Number(value.repairedAt) < 0 ||
    !phases.includes(value.phase as RepairPhase) ||
    (value.databaseId !== undefined && !validHex(value.databaseId, 48)) ||
    !validHex(value.signature, 64)
  ) {
    throw new Error('Passport repair journal is invalid.')
  }
  if (
    (
      value.phase === 'creating-database' ||
      value.phase === 'database-created' ||
      value.phase === 'receipt-staged'
    ) !==
    (value.databaseId !== undefined)
  ) {
    throw new Error('Passport repair journal fresh database identity is inconsistent.')
  }
  const payload = repairJournalPayload(value as RepairJournal)
  const expected = signRepairValue(key, repairJournalCanonical(payload))
  if (!constantTimeHexEqual(value.signature, expected)) {
    throw new Error('Passport repair journal authentication failed.')
  }
  return { ...payload, signature: value.signature }
}

function journalCandidateSupersedes(
  current: RepairJournal | undefined,
  candidate: RepairJournal
): boolean {
  if (!current) return true
  if (
    candidate.authorityId !== current.authorityId ||
    candidate.profileBinding !== current.profileBinding ||
    candidate.repairEpoch !== current.repairEpoch ||
    candidate.operationId !== current.operationId ||
    candidate.tokenHash !== current.tokenHash ||
    candidate.originalDatabaseId !== current.originalDatabaseId ||
    candidate.quarantinedPath !== current.quarantinedPath ||
    candidate.repairedAt !== current.repairedAt ||
    (
      current.databaseId !== undefined &&
      candidate.databaseId !== current.databaseId
    )
  ) {
    throw new Error('Passport repair journal promotion is inconsistent.')
  }
  const phases: readonly RepairPhase[] = [
    'authorized',
    'erasing-database',
    'database-erased',
    'keys-erased',
    'creating-database',
    'database-created',
    'receipt-staged'
  ]
  const currentIndex = phases.indexOf(current.phase)
  const candidateIndex = phases.indexOf(candidate.phase)
  if (
    candidateIndex < currentIndex ||
    candidateIndex > currentIndex + 1 ||
    candidate.highWaterRevision !==
      current.highWaterRevision + (candidateIndex === currentIndex ? 0 : 1)
  ) {
    throw new Error('Passport repair journal phase promotion is inconsistent.')
  }
  return true
}

function readRepairJournal(databasePath: string, key: Buffer): RepairJournal | undefined {
  const path = repairJournalPath(databasePath)
  const pending = `${path}.pending`
  const current = existsSync(path)
    ? parseRepairJournal(databasePath, path, key)
    : undefined
  let candidate: RepairJournal | undefined
  if (existsSync(pending)) {
    try {
      candidate = parseRepairJournal(databasePath, pending, key)
    } catch (error) {
      if (!current) throw error
      rmSync(pending, { force: true })
    }
  }
  if (candidate && journalCandidateSupersedes(current, candidate)) {
    promoteDurable(pending, path)
    return candidate
  }
  rmSync(pending, { force: true })
  return current
}

function writeRepairJournal(
  databasePath: string,
  value: RepairJournalPayload,
  key: Buffer
): RepairJournal {
  const payload = repairJournalPayload(value)
  const journal: RepairJournal = {
    ...payload,
    signature: signRepairValue(key, repairJournalCanonical(payload))
  }
  writeAtomicDurable(repairJournalPath(databasePath), journal)
  return journal
}

function settledRepairHighWater(state: RepairHighWaterState): RepairHighWater {
  const settled = [...state.records].reverse().find((record) =>
    record.phase === 'idle' || record.phase === 'completed'
  )
  if (!settled) throw new Error('Passport repair high-water history has no settled authority.')
  return settled
}

function assertActiveRepairAuthority(
  authority: RepairAuthority,
  state: RepairHighWaterState,
  journal: RepairJournal
): void {
  const settled = settledRepairHighWater(state)
  validateSettledRepairAuthority(authority, settled)
  if (
    journal.repairEpoch !== settled.repairEpoch + 1 ||
    journal.originalDatabaseId !== settled.databaseId ||
    journal.authorityId !== settled.authorityId ||
    journal.profileBinding !== settled.profileBinding
  ) {
    throw new Error('Passport repair journal does not extend the settled high-water authority.')
  }
}

function repairHighWaterMatchesJournal(
  highWater: RepairHighWater,
  journal: RepairJournal
): boolean {
  return highWater.revision === journal.highWaterRevision &&
    highWater.repairEpoch === journal.repairEpoch &&
    highWater.phase === journal.phase &&
    highWater.authorityId === journal.authorityId &&
    highWater.profileBinding === journal.profileBinding &&
    highWater.operationId === journal.operationId &&
    highWater.tokenHash === journal.tokenHash &&
    highWater.originalDatabaseId === journal.originalDatabaseId &&
    highWater.databaseId === (journal.databaseId ?? journal.originalDatabaseId) &&
    highWater.journalSignature === journal.signature
}

function expectedRepairPhaseAfter(phase: RepairHighWaterPhase): RepairPhase | undefined {
  switch (phase) {
    case 'idle':
    case 'completed':
      return 'authorized'
    case 'authorized':
      return 'erasing-database'
    case 'erasing-database':
      return 'database-erased'
    case 'database-erased':
      return 'keys-erased'
    case 'keys-erased':
      return 'creating-database'
    case 'creating-database':
      return 'database-created'
    case 'database-created':
      return 'receipt-staged'
    case 'receipt-staged':
      return undefined
  }
}

function bindRepairJournalHighWater(
  databasePath: string,
  journal: RepairJournal,
  authority: RepairAuthority,
  state: RepairHighWaterState,
  key: Buffer
): RepairHighWaterState {
  assertActiveRepairAuthority(authority, state, journal)
  if (journal.highWaterRevision === state.current.revision) {
    if (!repairHighWaterMatchesJournal(state.current, journal)) {
      throw new Error('Passport repair journal does not match its high-water marker.')
    }
    return state
  }
  if (journal.highWaterRevision !== state.current.revision + 1) {
    throw new Error('Passport repair journal replay is below the monotonic high-water mark.')
  }
  const expectedPhase = expectedRepairPhaseAfter(state.current.phase)
  if (
    expectedPhase !== journal.phase ||
    (
      state.current.phase !== 'idle' &&
      state.current.phase !== 'completed' &&
      (
        state.current.repairEpoch !== journal.repairEpoch ||
        state.current.operationId !== journal.operationId ||
        state.current.tokenHash !== journal.tokenHash ||
        state.current.originalDatabaseId !== journal.originalDatabaseId
      )
    )
  ) {
    throw new Error('Passport repair journal cannot advance the monotonic high-water state.')
  }
  const next = appendRepairHighWater(databasePath, state, {
    authorityId: journal.authorityId,
    profileBinding: journal.profileBinding,
    repairEpoch: journal.repairEpoch,
    phase: journal.phase,
    databaseId: journal.databaseId ?? journal.originalDatabaseId,
    operationId: journal.operationId,
    tokenHash: journal.tokenHash,
    originalDatabaseId: journal.originalDatabaseId,
    journalSignature: journal.signature
  }, key)
  if (!repairHighWaterMatchesJournal(next.current, journal)) {
    throw new Error('Passport repair high-water promotion did not bind the journal.')
  }
  return next
}

function advanceRepairJournal(
  databasePath: string,
  journal: RepairJournal,
  phase: RepairPhase,
  authority: RepairAuthority,
  state: RepairHighWaterState,
  key: Buffer,
  databaseId = journal.databaseId
): { journal: RepairJournal; highWater: RepairHighWaterState } {
  const nextJournal = writeRepairJournal(databasePath, {
    ...repairJournalPayload(journal),
    highWaterRevision: state.current.revision + 1,
    phase,
    databaseId
  }, key)
  const highWater = bindRepairJournalHighWater(
    databasePath,
    nextJournal,
    authority,
    state,
    key
  )
  return { journal: nextJournal, highWater }
}

function repairCheckpoint(
  checkpoint: Exclude<CrashBoundary['checkpoint'], 'before-dispatch' | 'after-commit-before-response'>,
  exitCode: number
): void {
  if (
    crashBoundary?.operation === 'repairPersistence' &&
    crashBoundary.checkpoint === checkpoint
  ) {
    process.exit(exitCode)
  }
}

const PASSPORT_PERSISTED_TABLES = [
  'passport_clock',
  'passport_meta',
  'passport_settings',
  'passport_roster',
  'stint_passport',
  'passport_item',
  'passport_event',
  'passport_runtime_log',
  'passport_deletion_tombstone',
  'passport_mutation_receipt'
] as const

const PASSPORT_DATA_TABLES = [
  'passport_roster',
  'stint_passport',
  'passport_item',
  'passport_event',
  'passport_runtime_log',
  'passport_deletion_tombstone',
  'passport_mutation_receipt'
] as const

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`
}

function jsonMatchesDefault(value: unknown, expected: unknown): boolean {
  if (typeof value !== 'string') return false
  try {
    return canonicalJson(JSON.parse(value)) === canonicalJson(expected)
  } catch {
    return false
  }
}

function probeDatabase(databasePath: string): DatabaseProbe {
  if (!existsSync(databasePath)) return { state: 'absent' }
  const descriptor = openSync(databasePath, 'r')
  try {
    const header = Buffer.alloc(16)
    if (
      readSync(descriptor, header, 0, header.length, 0) !== header.length ||
      !header.equals(Buffer.from('SQLite format 3\0', 'binary'))
    ) {
      return { state: 'unreadable' }
    }
  } finally {
    closeSync(descriptor)
  }
  let database: DatabaseSync | undefined
  try {
    database = new DatabaseSync(databasePath, { readOnly: true })
    const quickCheck = database.prepare('PRAGMA quick_check(1)').get() as
      | Record<string, unknown>
      | undefined
    if (!quickCheck || Object.values(quickCheck)[0] !== 'ok') {
      return { state: 'unreadable' }
    }
    const userTables = (database.prepare(`
      SELECT name
      FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all() as Array<{ name?: unknown }>)
      .map((row) => String(row.name ?? ''))
    const tableSet = new Set(userTables)
    const unexpectedTable = userTables.some((table) =>
      !(PASSPORT_PERSISTED_TABLES as readonly string[]).includes(table)
    )
    const count = (table: string): number => {
      if (!tableSet.has(table)) return 0
      const row = database!.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as
        | { count?: unknown }
        | undefined
      return Number(row?.count ?? 0)
    }
    const metaRows = tableSet.has('passport_meta')
      ? database.prepare('SELECT key, value FROM passport_meta ORDER BY key').all() as Array<{
          key?: unknown
          value?: unknown
        }>
      : []
    const meta = new Map(metaRows.map((row) => [String(row.key ?? ''), String(row.value ?? '')]))
    const databaseIdValue = meta.get('database_id')
    const databaseId = validHex(databaseIdValue, 48) ? databaseIdValue : undefined
    const repairEpochValue = Number(meta.get('repair_creation_epoch'))
    const repairEpoch = Number.isSafeInteger(repairEpochValue) && repairEpochValue > 0
      ? repairEpochValue
      : undefined
    const repairBindingValue = meta.get('repair_creation_binding')
    const repairBinding = validHex(repairBindingValue, 64) ? repairBindingValue : undefined
    const allowedMeta = new Set([
      'database_id',
      'pseudonym_salt',
      'repair_token',
      'integrity_state',
      'privacy_mutation_generation',
      'roster_mutation_generation',
      'repair_creation_epoch',
      'repair_creation_binding'
    ])
    let nonDefaultState =
      unexpectedTable ||
      metaRows.some((row) => !allowedMeta.has(String(row.key ?? ''))) ||
      (databaseIdValue !== undefined && databaseId === undefined) ||
      (meta.has('pseudonym_salt') && !validHex(meta.get('pseudonym_salt'), 64)) ||
      (meta.has('repair_token') && !validHex(meta.get('repair_token'), 48)) ||
      (meta.has('integrity_state') && meta.get('integrity_state') !== 'clean') ||
      (
        meta.has('privacy_mutation_generation') &&
        meta.get('privacy_mutation_generation') !== '0'
      ) ||
      (
        meta.has('roster_mutation_generation') &&
        meta.get('roster_mutation_generation') !== '0'
      ) ||
      (meta.has('repair_creation_epoch') !== meta.has('repair_creation_binding')) ||
      (meta.has('repair_creation_epoch') && repairEpoch === undefined) ||
      (meta.has('repair_creation_binding') && repairBinding === undefined)
    for (const table of PASSPORT_DATA_TABLES) {
      if (count(table) > 0) nonDefaultState = true
    }
    const clockRows = tableSet.has('passport_clock')
      ? database.prepare(`
          SELECT singleton, next_sequence, last_logical_time_ms
          FROM passport_clock
          ORDER BY singleton
        `).all() as Array<Record<string, unknown>>
      : []
    const clockDefault = clockRows.length === 1 &&
      Number(clockRows[0].singleton) === 1 &&
      Number(clockRows[0].next_sequence) === 0 &&
      Number(clockRows[0].last_logical_time_ms) === 0
    if (clockRows.length > 0 && !clockDefault) nonDefaultState = true
    const settingsRows = tableSet.has('passport_settings')
      ? database.prepare(`
          SELECT singleton, config_json, privacy_json, kill_switch, updated_at
          FROM passport_settings
          ORDER BY singleton
        `).all() as Array<Record<string, unknown>>
      : []
    const settingsDefault = settingsRows.length === 1 &&
      Number(settingsRows[0].singleton) === 1 &&
      jsonMatchesDefault(settingsRows[0].config_json, DEFAULT_PASSPORT_CONFIG) &&
      jsonMatchesDefault(settingsRows[0].privacy_json, DEFAULT_PASSPORT_PRIVACY) &&
      Number(settingsRows[0].kill_switch) === 0 &&
      Number.isSafeInteger(Number(settingsRows[0].updated_at)) &&
      Number(settingsRows[0].updated_at) >= 0
    if (settingsRows.length > 0 && !settingsDefault) nonDefaultState = true
    const schemaVersionRow = database.prepare('PRAGMA user_version').get() as
      | Record<string, unknown>
      | undefined
    const schemaVersion = Number(Object.values(schemaVersionRow ?? {})[0] ?? 0)
    if (
      schemaVersion !== 0 &&
      schemaVersion !== PASSPORT_PERSISTENCE_SCHEMA_VERSION
    ) {
      nonDefaultState = true
    }
    const schemaComplete =
      schemaVersion === PASSPORT_PERSISTENCE_SCHEMA_VERSION &&
      PASSPORT_PERSISTED_TABLES.every((table) => tableSet.has(table))
    const metaComplete =
      databaseId !== undefined &&
      validHex(meta.get('pseudonym_salt'), 64) &&
      validHex(meta.get('repair_token'), 48) &&
      meta.get('integrity_state') === 'clean'
    return {
      state: 'readable',
      databaseId,
      repairEpoch,
      repairBinding,
      schemaComplete,
      nonDefaultState,
      pristine:
        schemaComplete &&
        metaComplete &&
        clockDefault &&
        settingsDefault &&
        !nonDefaultState,
      userTables
    }
  } catch {
    return { state: 'unreadable' }
  } finally {
    database?.close()
  }
}

function repairDatabaseBindingCanonical(
  journal: Pick<
    RepairJournal,
    | 'authorityId'
    | 'profileBinding'
    | 'repairEpoch'
    | 'operationId'
    | 'tokenHash'
    | 'originalDatabaseId'
  >,
  databaseId: string
): string {
  return JSON.stringify({
    kind: 'stint-passport-repair-database',
    authorityId: journal.authorityId,
    profileBinding: journal.profileBinding,
    repairEpoch: journal.repairEpoch,
    operationId: journal.operationId,
    tokenHash: journal.tokenHash,
    originalDatabaseId: journal.originalDatabaseId,
    databaseId
  })
}

function repairDatabaseBinding(
  journal: Pick<
    RepairJournal,
    | 'authorityId'
    | 'profileBinding'
    | 'repairEpoch'
    | 'operationId'
    | 'tokenHash'
    | 'originalDatabaseId'
  >,
  databaseId: string,
  key: Buffer
): string {
  return signRepairValue(key, repairDatabaseBindingCanonical(journal, databaseId))
}

function probeMatchesRepairDatabase(
  probe: DatabaseProbe,
  journal: RepairJournal,
  key: Buffer
): boolean {
  if (
    probe.state !== 'readable' ||
    journal.databaseId === undefined ||
    probe.databaseId !== journal.databaseId ||
    probe.repairEpoch !== journal.repairEpoch ||
    !validHex(probe.repairBinding, 64)
  ) {
    return false
  }
  return constantTimeHexEqual(
    probe.repairBinding,
    repairDatabaseBinding(journal, journal.databaseId, key)
  )
}

function probeMatchesCompletedRepairDatabase(
  probe: DatabaseProbe,
  authority: RepairAuthority,
  key: Buffer
): boolean {
  const completed = authority.lastCompleted
  if (
    !completed ||
    probe.state !== 'readable' ||
    probe.databaseId !== completed.databaseId ||
    probe.repairEpoch !== completed.repairEpoch ||
    !validHex(probe.repairBinding, 64)
  ) {
    return false
  }
  return constantTimeHexEqual(
    probe.repairBinding,
    repairDatabaseBinding({
      authorityId: authority.authorityId,
      profileBinding: authority.profileBinding,
      repairEpoch: completed.repairEpoch,
      operationId: completed.operationId,
      tokenHash: completed.tokenHash,
      originalDatabaseId: completed.originalDatabaseId
    }, completed.databaseId, key)
  )
}

function assertRepairPhaseDatabaseState(
  databasePath: string,
  journal: RepairJournal,
  key: Buffer
): DatabaseProbe {
  const probe = probeDatabase(databasePath)
  switch (journal.phase) {
    case 'authorized':
      if (probe.state !== 'readable' || probe.databaseId !== journal.originalDatabaseId) {
        throw new Error('Passport authorized repair no longer matches its readable original database.')
      }
      break
    case 'erasing-database':
      if (
        probe.state === 'readable' &&
        probe.databaseId !== journal.originalDatabaseId
      ) {
        throw new Error('Passport erasing repair cannot replace a newer database identity.')
      }
      break
    case 'database-erased':
      if (probe.state !== 'absent') {
        throw new Error('Passport database-erased repair found a replacement database and was quarantined.')
      }
      break
    case 'keys-erased':
      if (probe.state !== 'absent') {
        throw new Error('Passport keys-erased repair found an unassigned replacement database.')
      }
      break
    case 'creating-database':
      if (
        probe.state !== 'absent' &&
        (!probeMatchesRepairDatabase(probe, journal, key) || !probe.pristine)
      ) {
        throw new Error('Passport creating repair found a mismatched or non-default replacement database.')
      }
      break
    case 'database-created':
    case 'receipt-staged':
      if (
        !probeMatchesRepairDatabase(probe, journal, key) ||
        !probe.pristine
      ) {
        throw new Error('Passport repair fresh database is missing, mismatched, or has non-default state.')
      }
      break
  }
  return probe
}

function validateRepairJournalAuthority(
  databasePath: string,
  journal: RepairJournal,
  authority: RepairAuthority,
  highWater: RepairHighWaterState,
  key: Buffer
): {
  disposition: 'active' | 'completion-pending' | 'completed-cleanup'
  highWater: RepairHighWaterState
} {
  if (
    journal.authorityId !== authority.authorityId ||
    journal.profileBinding !== authority.profileBinding ||
    journal.profileBinding !== profileBindingFor(databasePath)
  ) {
    throw new Error('Passport repair journal authentication belongs to another profile.')
  }
  if (
    highWater.current.phase === 'completed' &&
    journal.highWaterRevision < highWater.current.revision
  ) {
    const completedMarker = highWater.current
    if (
      journal.highWaterRevision === completedMarker.revision - 1 &&
      journal.phase === 'receipt-staged' &&
      journal.repairEpoch === completedMarker.repairEpoch &&
      journal.operationId === completedMarker.operationId &&
      journal.tokenHash === completedMarker.tokenHash &&
      journal.originalDatabaseId === completedMarker.originalDatabaseId &&
      journal.databaseId === completedMarker.databaseId &&
      journal.signature === completedMarker.journalSignature
    ) {
      const probe = assertRepairPhaseDatabaseState(databasePath, journal, key)
      if (probe.state !== 'readable' || !probe.pristine) {
        throw new Error('Passport completed repair journal replay found non-default database state.')
      }
      if (
        authority.completedEpoch === completedMarker.repairEpoch &&
        authority.highWaterRevision === completedMarker.revision
      ) {
        validateSettledRepairAuthority(authority, completedMarker)
        if (!authority.lastCompleted?.journalCleanupPending) {
          throw new Error('Passport completed repair journal replay was quarantined.')
        }
        return { disposition: 'completed-cleanup', highWater }
      }
      const previousState: RepairHighWaterState = {
        records: highWater.records.slice(0, -1),
        current: highWater.records[highWater.records.length - 2]
      }
      validateSettledRepairAuthority(authority, settledRepairHighWater(previousState))
      return { disposition: 'completion-pending', highWater }
    }
    throw new Error('Passport repair journal replay is below the monotonic high-water mark.')
  }
  const bound = bindRepairJournalHighWater(
    databasePath,
    journal,
    authority,
    highWater,
    key
  )
  assertRepairPhaseDatabaseState(databasePath, journal, key)
  return { disposition: 'active', highWater: bound }
}

function isFreshRepairDatabase(
  current: PassportPersistenceEngine,
  receipt: RepairReceipt,
  authority: RepairAuthority,
  key: Buffer
): boolean {
  const completed = authority.lastCompleted
  if (
    current.databaseIdentity !== receipt.databaseId ||
    !completed ||
    completed.databaseId !== receipt.databaseId
  ) {
    return false
  }
  const probe = probeDatabase(current.databasePath)
  return probe.pristine === true &&
    probeMatchesCompletedRepairDatabase(probe, authority, key)
}

function isCompletedRepairReceipt(
  current: PassportPersistenceEngine,
  receipt: RepairReceipt,
  authority: RepairAuthority,
  key: Buffer
): boolean {
  const completed = authority.lastCompleted
  return completed !== undefined &&
    completed.repairEpoch === authority.completedEpoch &&
    completed.operationId === receipt.operationId &&
    completed.tokenHash === receipt.tokenHash &&
    completed.databaseId === receipt.databaseId &&
    authority.currentDatabaseId === receipt.databaseId &&
    isFreshRepairDatabase(current, receipt, authority, key)
}

function repairJournalMatchesCompletion(
  journal: RepairJournal,
  authority: RepairAuthority
): boolean {
  const completed = authority.lastCompleted
  return completed !== undefined &&
    journal.phase === 'receipt-staged' &&
    journal.authorityId === authority.authorityId &&
    journal.profileBinding === authority.profileBinding &&
    journal.repairEpoch === completed.repairEpoch &&
    journal.operationId === completed.operationId &&
    journal.tokenHash === completed.tokenHash &&
    journal.originalDatabaseId === completed.originalDatabaseId &&
    journal.databaseId === completed.databaseId &&
    journal.signature === completed.finalJournalSignature
}

function validateCompletedRepairCleanupProof(
  databasePath: string,
  authority: RepairAuthority,
  key: Buffer
): void {
  const completed = authority.lastCompleted
  if (!completed?.journalCleanupPending) {
    throw new Error('Passport repair journal cleanup has no pending completion authority.')
  }
  const highWater = readCompletedRepairHighWaterProof(databasePath, key)
  validateSettledRepairAuthority(authority, highWater.current)
  if (highWater.current.phase !== 'completed') {
    throw new Error('Passport repair journal cleanup high-water proof is not completed.')
  }
  const receipt = readRepairReceipt(databasePath)
  if (
    !receipt ||
    receipt.operationId !== completed.operationId ||
    receipt.tokenHash !== completed.tokenHash ||
    receipt.databaseId !== completed.databaseId
  ) {
    throw new Error('Passport repair journal cleanup receipt proof is inconsistent.')
  }
  const probe = probeDatabase(databasePath)
  if (
    !probe.pristine ||
    !probeMatchesCompletedRepairDatabase(probe, authority, key)
  ) {
    throw new Error('Passport repair journal cleanup database proof is inconsistent.')
  }
}

function readCompletedRepairCleanupArtifact(
  databasePath: string,
  key: Buffer
): RepairJournal | undefined {
  const path = repairJournalCleanupPath(databasePath)
  const bytes = readFileSync(path)
  try {
    JSON.parse(bytes.toString('utf8'))
  } catch {
    return undefined
  }
  return parseRepairJournal(databasePath, path, key)
}

function finalizeRepairJournalCleanup(
  databasePath: string,
  authority: RepairAuthority,
  key: Buffer
): RepairAuthority {
  const completed = authority.lastCompleted
  const journalPath = repairJournalPath(databasePath)
  const pendingPath = `${journalPath}.pending`
  const cleanupPath = repairJournalCleanupPath(databasePath)
  if (!completed?.journalCleanupPending) {
    if (
      existsSync(cleanupPath) ||
      existsSync(journalPath) ||
      existsSync(pendingPath)
    ) {
      throw new Error('Passport repair journal cleanup artifact replay was quarantined.')
    }
    return authority
  }
  validateCompletedRepairCleanupProof(databasePath, authority, key)
  const hasLiveJournal = existsSync(journalPath) || existsSync(pendingPath)
  if (hasLiveJournal && existsSync(cleanupPath)) {
    throw new Error('Passport repair journal cleanup has conflicting live artifacts.')
  }
  if (hasLiveJournal) {
    const journal = readRepairJournal(databasePath, key)
    if (!journal || !repairJournalMatchesCompletion(journal, authority)) {
      throw new Error('Passport completed repair journal cleanup authentication failed.')
    }
    if (!existsSync(journalPath)) {
      throw new Error('Passport completed repair journal cleanup promotion failed.')
    }
    promoteDurable(journalPath, cleanupPath)
  } else if (existsSync(cleanupPath)) {
    const journal = readCompletedRepairCleanupArtifact(databasePath, key)
    if (journal && !repairJournalMatchesCompletion(journal, authority)) {
      throw new Error('Passport repair journal cleanup artifact is not authoritative.')
    }
  }
  if (existsSync(cleanupPath)) secureErase(cleanupPath)
  return writeRepairAuthority(databasePath, {
    ...repairAuthorityPayload(authority),
    lastCompleted: {
      ...completed,
      journalCleanupPending: false
    }
  }, key)
}

function repairDatabaseStagingPath(databasePath: string, databaseId: string): string {
  return `${databasePath}.repair-create-${databaseId}.sqlite`
}

function cleanupRepairDatabaseStaging(path: string, includeDatabase: boolean): void {
  for (const suffix of [
    ...(includeDatabase ? [''] : []),
    '-wal',
    '-shm',
    '.anchor.json',
    '.anchor.pending.json',
    '.anchor.key',
    '.quarantine.json'
  ]) {
    secureErase(`${path}${suffix}`)
  }
}

function seedRepairDatabaseIdentity(
  path: string,
  journal: RepairJournal,
  key: Buffer
): void {
  if (!journal.databaseId) {
    throw new Error('Passport creating repair has no assigned database identity.')
  }
  const existing = probeDatabase(path)
  if (existing.state === 'readable') {
    if (probeMatchesRepairDatabase(existing, journal, key)) {
      if (existing.nonDefaultState) {
        throw new Error('Passport repair staging database contains non-default state.')
      }
      return
    }
    const onlyEmptyMeta =
      existing.databaseId === undefined &&
      !existing.nonDefaultState &&
      (existing.userTables?.length ?? 0) <= 1 &&
      (existing.userTables?.[0] === undefined || existing.userTables[0] === 'passport_meta')
    if (!onlyEmptyMeta) {
      throw new Error('Passport repair staging database does not match its assigned identity.')
    }
    cleanupRepairDatabaseStaging(path, true)
  } else if (existing.state === 'unreadable') {
    cleanupRepairDatabaseStaging(path, true)
  }
  let database: DatabaseSync | undefined
  try {
    database = new DatabaseSync(path)
    database.exec('PRAGMA journal_mode = DELETE')
    database.exec('PRAGMA synchronous = FULL')
    repairCheckpoint('after-repair-database-file-open', 107)
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(`
        CREATE TABLE IF NOT EXISTS passport_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `)
      const insert = database.prepare('INSERT INTO passport_meta(key, value) VALUES (?, ?)')
      insert.run('database_id', journal.databaseId)
      insert.run('repair_creation_epoch', String(journal.repairEpoch))
      insert.run(
        'repair_creation_binding',
        repairDatabaseBinding(journal, journal.databaseId, key)
      )
      database.exec('COMMIT')
    } catch (error) {
      try {
        database.exec('ROLLBACK')
      } catch {
        // The process may not have opened a transaction before the failure.
      }
      throw error
    }
    database.exec('PRAGMA wal_checkpoint(FULL)')
  } finally {
    database?.close()
  }
  const descriptor = openSync(path, 'r+')
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  if (process.platform !== 'win32') fsyncParent(path)
  repairCheckpoint('after-repair-database-identity-create', 108)
  const seeded = probeDatabase(path)
  if (
    !probeMatchesRepairDatabase(seeded, journal, key) ||
    seeded.nonDefaultState
  ) {
    throw new Error('Passport repair staging identity could not be authenticated.')
  }
}

function ensureFreshRepairEngine(
  databasePath: string,
  journal: RepairJournal,
  key: Buffer
): PassportPersistenceEngine {
  if (!journal.databaseId) {
    throw new Error('Passport repair fresh database identity is unavailable.')
  }
  let currentProbe = probeDatabase(databasePath)
  if (currentProbe.state === 'absent') {
    const stagingPath = repairDatabaseStagingPath(databasePath, journal.databaseId)
    seedRepairDatabaseIdentity(stagingPath, journal, key)
    const staged = new PassportPersistenceEngine({
      path: stagingPath,
      databaseIdentity: journal.databaseId
    })
    staged.close()
    cleanupRepairDatabaseStaging(stagingPath, false)
    const stagedProbe = probeDatabase(stagingPath)
    if (
      !probeMatchesRepairDatabase(stagedProbe, journal, key) ||
      !stagedProbe.pristine
    ) {
      throw new Error('Passport repair staged database is incomplete or contains non-default state.')
    }
    repairCheckpoint('after-repair-database-schema-create', 109)
    currentProbe = probeDatabase(databasePath)
    if (currentProbe.state === 'absent') {
      promoteDurable(stagingPath, databasePath)
    } else if (
      !probeMatchesRepairDatabase(currentProbe, journal, key) ||
      !currentProbe.pristine
    ) {
      throw new Error('Passport repair cannot replace an unexpected database during creation.')
    }
    cleanupRepairDatabaseStaging(stagingPath, true)
  }
  assertRepairPhaseDatabaseState(databasePath, journal, key)
  if (engine && engine.databasePath !== databasePath) {
    engine.close()
    engine = null
  }
  if (!engine) {
    engine = new PassportPersistenceEngine({
      path: databasePath,
      databaseIdentity: journal.databaseId
    })
  }
  const finalProbe = probeDatabase(databasePath)
  if (
    !probeMatchesRepairDatabase(finalProbe, journal, key) ||
    !finalProbe.pristine
  ) {
    throw new Error('Passport repair fresh database failed authoritative validation.')
  }
  return engine
}

function resumeRepair(
  databasePath: string,
  initial: RepairJournal,
  authority: RepairAuthority,
  authorityKey: Buffer,
  initialHighWater: RepairHighWaterState
): RepairReceipt {
  let journal = { ...initial }
  let highWater = initialHighWater
  try {
    if (journal.phase === 'authorized') {
      const advanced = advanceRepairJournal(
        databasePath,
        journal,
        'erasing-database',
        authority,
        highWater,
        authorityKey
      )
      journal = advanced.journal
      highWater = advanced.highWater
    }
    if (journal.phase === 'erasing-database') {
      assertRepairPhaseDatabaseState(databasePath, journal, authorityKey)
      engine?.close()
      engine = null
      secureEraseDatabase(databasePath)
      for (const suffix of ['-wal', '-shm']) secureErase(`${databasePath}${suffix}`)
      const advanced = advanceRepairJournal(
        databasePath,
        journal,
        'database-erased',
        authority,
        highWater,
        authorityKey
      )
      journal = advanced.journal
      highWater = advanced.highWater
      repairCheckpoint('after-repair-database-erase', 95)
    }
    if (journal.phase === 'database-erased') {
      assertRepairPhaseDatabaseState(databasePath, journal, authorityKey)
      for (const suffix of [
        '.anchor.json',
        '.anchor.pending.json',
        '.anchor.key',
        '.quarantine.json'
      ]) {
        secureErase(`${databasePath}${suffix}`)
      }
      secureErase(repairReceiptPath(databasePath))
      secureErase(`${repairReceiptPath(databasePath)}.pending`)
      writeDurable(journal.quarantinedPath, `${JSON.stringify({
        kind: 'stint-passport-repair-quarantine',
        repairedAt: journal.repairedAt,
        payloadRetained: false
      })}\n`)
      const advanced = advanceRepairJournal(
        databasePath,
        journal,
        'keys-erased',
        authority,
        highWater,
        authorityKey
      )
      journal = advanced.journal
      highWater = advanced.highWater
      repairCheckpoint('after-repair-key-erase', 96)
    }
    if (journal.phase === 'keys-erased') {
      assertRepairPhaseDatabaseState(databasePath, journal, authorityKey)
      engine?.close()
      engine = null
      const databaseId = randomBytes(24).toString('hex')
      const advanced = advanceRepairJournal(
        databasePath,
        journal,
        'creating-database',
        authority,
        highWater,
        authorityKey,
        databaseId
      )
      journal = advanced.journal
      highWater = advanced.highWater
      repairCheckpoint('after-repair-database-identity-assignment', 110)
    }
    if (journal.phase === 'creating-database') {
      assertRepairPhaseDatabaseState(databasePath, journal, authorityKey)
      engine?.close()
      engine = null
      const current = ensureFreshRepairEngine(databasePath, journal, authorityKey)
      const advanced = advanceRepairJournal(
        databasePath,
        journal,
        'database-created',
        authority,
        highWater,
        authorityKey,
        current.databaseIdentity
      )
      journal = advanced.journal
      highWater = advanced.highWater
      repairCheckpoint('after-repair-database-create', 104)
    }
    assertRepairPhaseDatabaseState(databasePath, journal, authorityKey)
    const current = ensureFreshRepairEngine(databasePath, journal, authorityKey)
    const receipt: RepairReceipt = {
      version: 1,
      operationId: journal.operationId,
      tokenHash: journal.tokenHash,
      databaseId: current.databaseIdentity,
      quarantinedPath: journal.quarantinedPath,
      repairedAt: journal.repairedAt
    }
    if (journal.phase === 'database-created') {
      stageRepairReceipt(databasePath, receipt)
      repairCheckpoint('after-repair-receipt-temp-write', 97)
      const advanced = advanceRepairJournal(
        databasePath,
        journal,
        'receipt-staged',
        authority,
        highWater,
        authorityKey
      )
      journal = advanced.journal
      highWater = advanced.highWater
    }
    const existingReceipt = readRepairReceipt(databasePath)
    if (
      !existingReceipt ||
      existingReceipt.operationId !== receipt.operationId ||
      existingReceipt.tokenHash !== receipt.tokenHash ||
      existingReceipt.databaseId !== receipt.databaseId
    ) {
      if (!existsSync(`${repairReceiptPath(databasePath)}.pending`)) {
        stageRepairReceipt(databasePath, receipt)
      }
      promoteRepairReceipt(databasePath)
    }
    const promotedReceipt = readRepairReceipt(databasePath)
    if (
      !promotedReceipt ||
      promotedReceipt.operationId !== receipt.operationId ||
      promotedReceipt.tokenHash !== receipt.tokenHash ||
      promotedReceipt.databaseId !== receipt.databaseId
    ) {
      throw new Error('Passport repair receipt promotion could not be authenticated.')
    }
    repairCheckpoint('after-repair-receipt-promotion', 98)
    if (highWater.current.phase === 'receipt-staged') {
      highWater = appendRepairHighWater(databasePath, highWater, {
        authorityId: journal.authorityId,
        profileBinding: journal.profileBinding,
        repairEpoch: journal.repairEpoch,
        phase: 'completed',
        databaseId: receipt.databaseId,
        operationId: journal.operationId,
        tokenHash: journal.tokenHash,
        originalDatabaseId: journal.originalDatabaseId,
        journalSignature: journal.signature
      }, authorityKey)
    } else if (
      highWater.current.phase !== 'completed' ||
      highWater.current.repairEpoch !== journal.repairEpoch ||
      highWater.current.operationId !== journal.operationId ||
      highWater.current.tokenHash !== journal.tokenHash ||
      highWater.current.originalDatabaseId !== journal.originalDatabaseId ||
      highWater.current.databaseId !== receipt.databaseId ||
      highWater.current.journalSignature !== journal.signature
    ) {
      throw new Error('Passport repair completion does not match its monotonic high-water mark.')
    }
    const completedAuthority = writeRepairAuthority(databasePath, {
      ...repairAuthorityPayload(authority),
      completedEpoch: journal.repairEpoch,
      highWaterRevision: highWater.current.revision,
      currentDatabaseId: receipt.databaseId,
      lastCompleted: {
        repairEpoch: journal.repairEpoch,
        operationId: journal.operationId,
        tokenHash: journal.tokenHash,
        originalDatabaseId: journal.originalDatabaseId,
        databaseId: receipt.databaseId,
        finalJournalSignature: journal.signature,
        journalCleanupPending: true
      }
    }, authorityKey)
    repairAuthority = finalizeRepairJournalCleanup(
      databasePath,
      completedAuthority,
      authorityKey
    )
    repairAuthorityKey = authorityKey
    return receipt
  } catch (error) {
    try {
      engine?.close()
    } finally {
      engine = null
    }
    throw error
  }
}

function validateRequest(value: unknown): Request {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Passport persistence request envelope is invalid.')
  }
  const request = value as Partial<Request>
  if (!Number.isSafeInteger(request.id) || Number(request.id) < 1) {
    throw new Error('Passport persistence request ID is invalid.')
  }
  if (typeof request.method !== 'string' || request.method.length === 0 || request.method.length > 120) {
    throw new Error('Passport persistence request method is invalid.')
  }
  if (!Array.isArray(request.args)) throw new Error('Passport persistence request arguments are invalid.')
  return request as Request
}

async function execute(request: Request): Promise<unknown> {
  if (request.method === 'initialize') {
    engine?.close()
    engine = null
    repairAuthority = null
    repairAuthorityKey = null
    const path = String(request.args[0])
    try {
      const hasJournal =
        existsSync(repairJournalPath(path)) ||
        existsSync(`${repairJournalPath(path)}.pending`)
      if (hasJournal) {
        const loaded = readExistingRepairSecurity(path)
        const journal = readRepairJournal(path, loaded.key)
        if (!journal) throw new Error('Passport repair journal disappeared during recovery.')
        const validated = validateRepairJournalAuthority(
          path,
          journal,
          loaded.authority,
          loaded.highWater,
          loaded.key
        )
        repairAuthorityKey = loaded.key
        if (validated.disposition === 'completed-cleanup') {
          repairAuthority = finalizeRepairJournalCleanup(
            path,
            loaded.authority,
            loaded.key
          )
          engine = new PassportPersistenceEngine({ path })
          if (engine.databaseIdentity !== repairAuthority.currentDatabaseId) {
            throw new Error('Passport repaired database identity is no longer authoritative.')
          }
          if (
            !probeMatchesCompletedRepairDatabase(
              probeDatabase(path),
              repairAuthority,
              loaded.key
            )
          ) {
            throw new Error('Passport repaired database binding is no longer authoritative.')
          }
        } else {
          repairAuthority = loaded.authority
          resumeRepair(
            path,
            journal,
            loaded.authority,
            loaded.key,
            validated.highWater
          )
        }
      } else {
        engine = new PassportPersistenceEngine({ path })
        const loaded = loadOrCreateRepairSecurity(path, engine.databaseIdentity)
        if (engine.databaseIdentity !== loaded.highWater.current.databaseId) {
          throw new Error('Passport database identity is below its monotonic repair high-water mark.')
        }
        if (
          loaded.highWater.current.phase === 'completed' &&
          !probeMatchesCompletedRepairDatabase(
            probeDatabase(path),
            loaded.authority,
            loaded.key
          )
        ) {
          throw new Error('Passport database does not match its completed repair binding.')
        }
        repairAuthority = finalizeRepairJournalCleanup(path, loaded.authority, loaded.key)
        repairAuthorityKey = loaded.key
      }
      return { isolatedProcessId: process.pid }
    } catch (error) {
      engine?.close()
      engine = null
      repairAuthority = null
      repairAuthorityKey = null
      throw error
    }
  }
  if (request.method === 'configureCrashBoundary') {
    const candidate = request.args[0] as Partial<CrashBoundary> | undefined
    if (
      !candidate ||
      typeof candidate.operation !== 'string' ||
      !isCrashCheckpoint(candidate.checkpoint)
    ) {
      throw persistenceDomainError('Passport crash boundary configuration is invalid.')
    }
    crashBoundary = {
      operation: candidate.operation,
      checkpoint: candidate.checkpoint
    }
    return { ...crashBoundary, armed: true }
  }
  if (request.method === 'simulateCrash') {
    setImmediate(() => process.exit(91))
    return true
  }
  if (request.method === 'flush') {
    requireEngine().flush()
    return true
  }
  if (request.method === 'shutdown') {
    engine?.flush()
    engine?.close()
    engine = null
    repairAuthority = null
    repairAuthorityKey = null
    return true
  }
  if (request.method === 'repairPersistence') {
    const current = requireEngine()
    let authority = repairAuthority
    const authorityKey = repairAuthorityKey
    if (!authority || !authorityKey) {
      throw new Error('Passport repair authority is unavailable.')
    }
    if (authority.lastCompleted?.journalCleanupPending) {
      authority = finalizeRepairJournalCleanup(
        current.databasePath,
        authority,
        authorityKey
      )
      repairAuthority = authority
    }
    if (authority.currentDatabaseId !== current.databaseIdentity) {
      throw new Error('Passport repair authority does not match the active database.')
    }
    const highWater = readRepairHighWater(current.databasePath, authorityKey)
    if (!highWater) throw new Error('Passport repair monotonic high-water history is unavailable.')
    validateSettledRepairAuthority(authority, highWater.current)
    const token = String(request.args[0] ?? '')
    const operationId = String(request.args[1] ?? '')
    if (!/^[A-Za-z0-9:_-]{16,160}$/.test(operationId)) {
      throw persistenceDomainError('Persistence repair operation ID is invalid.')
    }
    const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex')
    const priorReceipt = readRepairReceipt(current.databasePath)
    if (
      priorReceipt &&
      priorReceipt.operationId === operationId &&
      constantTimeHexEqual(priorReceipt.tokenHash, tokenHash) &&
      isCompletedRepairReceipt(current, priorReceipt, authority, authorityKey)
    ) {
      return { quarantinedPath: priorReceipt.quarantinedPath }
    }
    if (!current.validateRepairToken(token)) {
      throw persistenceDomainError('Persistence repair token is invalid.')
    }
    current.flush()
    const path = current.databasePath
    const repairedAt = Date.now()
    const journal = writeRepairJournal(path, {
      version: 3,
      authorityId: authority.authorityId,
      profileBinding: authority.profileBinding,
      repairEpoch: authority.completedEpoch + 1,
      highWaterRevision: highWater.current.revision + 1,
      operationId,
      tokenHash,
      originalDatabaseId: current.databaseIdentity,
      quarantinedPath: `${path}.quarantine-${repairedAt}.json`,
      repairedAt,
      phase: 'authorized'
    }, authorityKey)
    repairCheckpoint('after-repair-journal', 94)
    const validated = validateRepairJournalAuthority(
      path,
      journal,
      authority,
      highWater,
      authorityKey
    )
    const receipt = resumeRepair(
      path,
      journal,
      authority,
      authorityKey,
      validated.highWater
    )
    return { quarantinedPath: receipt.quarantinedPath }
  }
  const target = requireEngine() as unknown as Record<string, (...args: unknown[]) => unknown>
  const method = target[request.method]
  if (typeof method !== 'function') {
    throw persistenceDomainError(`Unknown persistence method: ${request.method}`)
  }
  return await method.apply(engine, request.args)
}

function send(value: unknown, afterSend?: () => void): void {
  if (!process.send) throw new Error('Passport persistence process IPC is unavailable.')
  process.send(value, (error) => {
    if (error) {
      process.exitCode = 1
      return
    }
    afterSend?.()
  })
}

process.on('message', (value: unknown) => {
  let request: Request
  try {
    request = validateRequest(value)
  } catch (error) {
    const id = value && typeof value === 'object' && Number.isSafeInteger((value as { id?: unknown }).id)
      ? Number((value as { id: number }).id)
      : 0
    send({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      code: PASSPORT_DOMAIN_ERROR_CODE
    })
    return
  }

  chain = chain.then(async () => {
    try {
      const armed = crashBoundary?.operation === request.method ? crashBoundary : null
      if (armed?.checkpoint === 'before-dispatch') process.exit(92)
      const result = await execute(request)
      if (armed) crashBoundary = null
      if (armed?.checkpoint === 'after-commit-before-response') process.exit(93)
      send({ id: request.id, ok: true, result }, request.method === 'shutdown'
        ? () => process.disconnect?.()
        : undefined)
    } catch (error) {
      send({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        code: classifyPersistenceWorkerError(error)
      })
    }
  })
})

process.on('disconnect', () => {
  try {
    engine?.close()
  } finally {
    process.exit(0)
  }
})

/**
 * Announces that this process has finished loading and is listening.
 *
 * Without it the client's only evidence about a starting worker is the
 * `initialize` response, so it has to charge `fork`, `exec` and module
 * evaluation - work owned by the host, not by this process - to the same
 * deadline as the database work this process actually performs, and a busy
 * machine is indistinguishable from a wedged worker. The envelope carries no
 * request id, so every consumer that dispatches on `id` ignores it.
 */
if (typeof process.send === 'function') process.send({ ready: true })
