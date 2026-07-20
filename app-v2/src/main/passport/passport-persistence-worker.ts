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
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { PassportPersistenceEngine } from './persistence-engine'
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
    | 'after-repair-database-create'
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

interface RepairSecurityState {
  authority: RepairAuthority
  key: Buffer
  highWater: RepairHighWaterState
}

interface DatabaseProbe {
  state: 'absent' | 'unreadable' | 'readable'
  databaseId?: string
  populated?: boolean
}

let engine: PassportPersistenceEngine | null = null
let chain: Promise<void> = Promise.resolve()
let crashBoundary: CrashBoundary | null = null
let repairAuthority: RepairAuthority | null = null
let repairAuthorityKey: Buffer | null = null

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
  'after-repair-database-create',
  'after-repair-receipt-temp-write',
  'after-repair-receipt-promotion'
]

function isCrashCheckpoint(value: unknown): value is CrashBoundary['checkpoint'] {
  return typeof value === 'string' &&
    CRASH_CHECKPOINTS.includes(value as CrashBoundary['checkpoint'])
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
  rmSync(path, { force: true })
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
  rmSync(path, { force: true })
  fsyncParent(path)
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
  } catch {
    // Directory fsync is unavailable on some supported Windows filesystems.
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
      renameSync(source, destination)
      fsyncParent(destination)
      return
    } catch (error) {
      lastError = error
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') throw error
    }
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
  if (bytes.length === 0 || bytes.length > 16 * 1024) {
    throw new Error('Passport repair high-water marker exceeds its parser boundary.')
  }
  const value = JSON.parse(bytes.toString('utf8')) as Partial<RepairHighWater>
  const phases: readonly RepairHighWaterPhase[] = [
    'idle',
    'authorized',
    'erasing-database',
    'database-erased',
    'keys-erased',
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

function readRepairHighWaterCopy(
  databasePath: string,
  copy: 'a' | 'b',
  key: Buffer
): RepairHighWater[] | undefined {
  const directory = repairHighWaterDirectory(databasePath, copy)
  if (!existsSync(directory)) return undefined
  const names = readdirSync(directory).sort()
  if (names.length === 0 || names.length > 4_096) {
    throw new Error('Passport repair high-water history is missing or exceeds its bound.')
  }
  const records = names.map((name, index) => {
    if (name !== repairHighWaterMarkerName(index)) {
      throw new Error('Passport repair high-water history is not contiguous.')
    }
    return parseRepairHighWater(databasePath, resolve(directory, name), key)
  })
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
  return records
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
  const descriptor = openSync(path, 'wx', 0o600)
  try {
    writeSync(descriptor, `${JSON.stringify(record)}\n`, undefined, 'utf8')
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  fsyncParent(path)
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
  const left = readRepairHighWaterCopy(databasePath, 'a', key)
  const right = readRepairHighWaterCopy(databasePath, 'b', key)
  if (!left && !right) return undefined
  const longest = (left?.length ?? 0) >= (right?.length ?? 0) ? left! : right!
  const shortest = longest === left ? right : left
  if (shortest) {
    for (let index = 0; index < shortest.length; index += 1) {
      if (shortest[index].signature !== longest[index]?.signature) {
        throw new Error('Passport repair high-water copies diverged.')
      }
    }
  }
  if (!left || left.length < longest.length) {
    synchronizeRepairHighWaterCopy(databasePath, 'a', longest, left?.length ?? 0, key)
  }
  if (!right || right.length < longest.length) {
    synchronizeRepairHighWaterCopy(databasePath, 'b', longest, right?.length ?? 0, key)
  }
  return { records: longest, current: longest[longest.length - 1] }
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
  const key = randomBytes(32)
  const descriptor = openSync(path, 'wx', 0o600)
  try {
    writeSync(descriptor, `${key.toString('hex')}\n`, undefined, 'utf8')
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  fsyncParent(path)
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
  const highWater = readRepairHighWater(databasePath, loaded.key)
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
  if (!keyExists && !stateExists && !highWaterExists) {
    const key = createRepairAuthorityKey(databasePath)
    const authorityId = randomBytes(24).toString('hex')
    const highWater = createInitialRepairHighWater(
      databasePath,
      authorityId,
      databaseId,
      key
    )
    const authority = writeRepairAuthority(databasePath, {
      version: 2,
      authorityId,
      profileBinding: profileBindingFor(databasePath),
      completedEpoch: 0,
      highWaterRevision: highWater.current.revision,
      currentDatabaseId: databaseId
    }, key)
    return { authority, key, highWater }
  }
  if (!keyExists || !stateExists || !highWaterExists) {
    throw new Error('Passport repair authority or monotonic high-water files are incomplete.')
  }
  const loaded = readExistingRepairSecurity(databasePath)
  validateSettledRepairAuthority(loaded.authority, loaded.highWater.current)
  if (loaded.highWater.current.databaseId !== databaseId) {
    throw new Error('Passport database identity does not match its repair authority.')
  }
  return loaded
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
    (value.phase === 'database-created' || value.phase === 'receipt-staged') !==
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
    const row = database.prepare(
      "SELECT value FROM passport_meta WHERE key = 'database_id'"
    ).get() as { value?: unknown } | undefined
    if (!validHex(row?.value, 48)) {
      return { state: 'unreadable' }
    }
    const privacyRow = database.prepare(
      'SELECT privacy_json FROM passport_settings WHERE singleton = 1'
    ).get() as { privacy_json?: unknown } | undefined
    const privacy = typeof privacyRow?.privacy_json === 'string'
      ? JSON.parse(privacyRow.privacy_json) as { identityPersistenceOptIn?: unknown }
      : undefined
    const count = (table: string): number => {
      const result = database!.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
        count?: unknown
      } | undefined
      return Number(result?.count ?? 0)
    }
    const migration = database.prepare(
      "SELECT value FROM passport_meta WHERE key = 'persistence_migration'"
    ).get()
    return {
      state: 'readable',
      databaseId: row.value,
      populated:
        privacy?.identityPersistenceOptIn === true ||
        count('passport_roster') > 0 ||
        count('stint_passport') > 0 ||
        count('passport_event') > 0 ||
        migration !== undefined
    }
  } catch {
    return { state: 'unreadable' }
  } finally {
    database?.close()
  }
}

function assertRepairPhaseDatabaseState(
  databasePath: string,
  journal: RepairJournal
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
      if (probe.state === 'unreadable' || (probe.state === 'readable' && probe.populated)) {
        throw new Error('Passport keys-erased repair cannot replace an unreadable or populated database.')
      }
      break
    case 'database-created':
    case 'receipt-staged':
      if (
        probe.state !== 'readable' ||
        probe.databaseId !== journal.databaseId ||
        probe.populated
      ) {
        throw new Error('Passport repair fresh database is missing, mismatched, or already populated.')
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
      const probe = assertRepairPhaseDatabaseState(databasePath, journal)
      if (probe.state !== 'readable' || probe.populated) {
        throw new Error('Passport completed repair journal replay found a populated database.')
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
  assertRepairPhaseDatabaseState(databasePath, journal)
  return { disposition: 'active', highWater: bound }
}

function isFreshRepairDatabase(
  current: PassportPersistenceEngine,
  receipt: RepairReceipt
): boolean {
  if (current.databaseIdentity !== receipt.databaseId) return false
  const state = current.getAuthoritativeState()
  return !state.privacy.identityPersistenceOptIn &&
    state.roster.length === 0 &&
    state.passports.length === 0 &&
    state.persistenceMigration === undefined
}

function isCompletedRepairReceipt(
  current: PassportPersistenceEngine,
  receipt: RepairReceipt,
  authority: RepairAuthority
): boolean {
  const completed = authority.lastCompleted
  return completed !== undefined &&
    completed.repairEpoch === authority.completedEpoch &&
    completed.operationId === receipt.operationId &&
    completed.tokenHash === receipt.tokenHash &&
    completed.databaseId === receipt.databaseId &&
    authority.currentDatabaseId === receipt.databaseId &&
    isFreshRepairDatabase(current, receipt)
}

function finalizeRepairJournalCleanup(
  databasePath: string,
  authority: RepairAuthority,
  key: Buffer
): RepairAuthority {
  const completed = authority.lastCompleted
  if (!completed?.journalCleanupPending) return authority
  secureErase(repairJournalPath(databasePath))
  secureErase(`${repairJournalPath(databasePath)}.pending`)
  return writeRepairAuthority(databasePath, {
    ...repairAuthorityPayload(authority),
    lastCompleted: {
      ...completed,
      journalCleanupPending: false
    }
  }, key)
}

function ensureFreshRepairEngine(databasePath: string, databaseId?: string): PassportPersistenceEngine {
  if (!engine) engine = new PassportPersistenceEngine({ path: databasePath })
  if (engine.databasePath !== databasePath) {
    engine.close()
    engine = new PassportPersistenceEngine({ path: databasePath })
  }
  if (databaseId !== undefined && engine.databaseIdentity !== databaseId) {
    throw new Error('Passport repair fresh database identity does not match its journal.')
  }
  const state = engine.getAuthoritativeState()
  if (
    state.privacy.identityPersistenceOptIn ||
    state.roster.length > 0 ||
    state.passports.length > 0 ||
    state.persistenceMigration !== undefined
  ) {
    throw new Error('Passport repair fresh database is not empty.')
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
      assertRepairPhaseDatabaseState(databasePath, journal)
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
      assertRepairPhaseDatabaseState(databasePath, journal)
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
      assertRepairPhaseDatabaseState(databasePath, journal)
      engine?.close()
      engine = null
      const current = ensureFreshRepairEngine(databasePath)
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
    assertRepairPhaseDatabaseState(databasePath, journal)
    const current = ensureFreshRepairEngine(databasePath, journal.databaseId)
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
        const hasSecurityState =
          existsSync(repairAuthorityKeyPath(path)) ||
          existsSync(repairAuthorityPath(path)) ||
          existsSync(`${repairAuthorityPath(path)}.pending`) ||
          existsSync(repairHighWaterDirectory(path, 'a')) ||
          existsSync(repairHighWaterDirectory(path, 'b'))
        if (hasSecurityState) {
          const existing = readExistingRepairSecurity(path)
          validateSettledRepairAuthority(existing.authority, existing.highWater.current)
          engine = new PassportPersistenceEngine({ path })
          if (engine.databaseIdentity !== existing.highWater.current.databaseId) {
            throw new Error('Passport database identity is below its monotonic repair high-water mark.')
          }
        } else {
          engine = new PassportPersistenceEngine({ path })
        }
        const loaded = loadOrCreateRepairSecurity(path, engine.databaseIdentity)
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
      priorReceipt.tokenHash === tokenHash &&
      isCompletedRepairReceipt(current, priorReceipt, authority)
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
