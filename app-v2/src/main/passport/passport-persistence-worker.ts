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
  openSync,
  readFileSync,
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
    | 'after-repair-database-erase'
    | 'after-repair-key-erase'
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
  | 'database-erased'
  | 'keys-erased'
  | 'database-created'
  | 'receipt-staged'

interface RepairJournalPayload {
  version: 2
  authorityId: string
  profileBinding: string
  repairEpoch: number
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
  version: 1
  authorityId: string
  profileBinding: string
  completedEpoch: number
  currentDatabaseId: string
  lastCompleted?: RepairAuthorityCompletion
}

interface RepairAuthority extends RepairAuthorityPayload {
  signature: string
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
  'after-repair-database-erase',
  'after-repair-key-erase',
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

function promoteDurable(source: string, destination: string): void {
  renameSync(source, destination)
  fsyncParent(destination)
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
    version: 1,
    authorityId: value.authorityId,
    profileBinding: value.profileBinding,
    completedEpoch: value.completedEpoch,
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
    currentDatabaseId: payload.currentDatabaseId,
    lastCompleted: payload.lastCompleted ?? null
  })
}

function repairJournalPayload(value: RepairJournalPayload): RepairJournalPayload {
  return {
    version: 2,
    authorityId: value.authorityId,
    profileBinding: value.profileBinding,
    repairEpoch: value.repairEpoch,
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
    value.version !== 1 ||
    !validHex(value.authorityId, 48) ||
    !validHex(value.profileBinding, 64) ||
    value.profileBinding !== profileBindingFor(databasePath) ||
    !Number.isSafeInteger(value.completedEpoch) ||
    Number(value.completedEpoch) < 0 ||
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

function loadOrCreateRepairAuthority(
  databasePath: string,
  databaseId: string
): { authority: RepairAuthority; key: Buffer } {
  const keyExists = existsSync(repairAuthorityKeyPath(databasePath))
  const stateExists =
    existsSync(repairAuthorityPath(databasePath)) ||
    existsSync(`${repairAuthorityPath(databasePath)}.pending`)
  if (!keyExists && !stateExists) {
    const key = createRepairAuthorityKey(databasePath)
    const authority = writeRepairAuthority(databasePath, {
      version: 1,
      authorityId: randomBytes(24).toString('hex'),
      profileBinding: profileBindingFor(databasePath),
      completedEpoch: 0,
      currentDatabaseId: databaseId
    }, key)
    return { authority, key }
  }
  if (keyExists !== stateExists) {
    throw new Error('Passport repair authority files are incomplete.')
  }
  const loaded = readExistingRepairAuthority(databasePath)
  if (loaded.authority.currentDatabaseId !== databaseId) {
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
    'database-erased',
    'keys-erased',
    'database-created',
    'receipt-staged'
  ]
  if (
    value.version !== 2 ||
    !validHex(value.authorityId, 48) ||
    !validHex(value.profileBinding, 64) ||
    !Number.isSafeInteger(value.repairEpoch) ||
    Number(value.repairEpoch) < 1 ||
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
    'database-erased',
    'keys-erased',
    'database-created',
    'receipt-staged'
  ]
  return phases.indexOf(candidate.phase) >= phases.indexOf(current.phase)
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

function readDatabaseIdentity(databasePath: string): string | undefined {
  if (!existsSync(databasePath)) return undefined
  const database = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const row = database.prepare(
      "SELECT value FROM passport_meta WHERE key = 'database_id'"
    ).get() as { value?: unknown } | undefined
    if (!validHex(row?.value, 48)) {
      throw new Error('Passport database identity is unavailable.')
    }
    return row.value
  } finally {
    database.close()
  }
}

function validateRepairJournalAuthority(
  databasePath: string,
  journal: RepairJournal,
  authority: RepairAuthority
): 'active' | 'completed-cleanup' {
  if (
    journal.authorityId !== authority.authorityId ||
    journal.profileBinding !== authority.profileBinding ||
    journal.profileBinding !== profileBindingFor(databasePath)
  ) {
    throw new Error('Passport repair journal authentication belongs to another profile.')
  }
  const currentDatabaseId = readDatabaseIdentity(databasePath)
  if (journal.repairEpoch <= authority.completedEpoch) {
    const completed = authority.lastCompleted
    if (
      completed &&
      journal.repairEpoch === authority.completedEpoch &&
      journal.phase === 'receipt-staged' &&
      journal.operationId === completed.operationId &&
      journal.tokenHash === completed.tokenHash &&
      journal.originalDatabaseId === completed.originalDatabaseId &&
      journal.databaseId === completed.databaseId &&
      currentDatabaseId === completed.databaseId &&
      completed.journalCleanupPending &&
      constantTimeHexEqual(journal.signature, completed.finalJournalSignature)
    ) {
      return 'completed-cleanup'
    }
    throw new Error('Passport repair journal replay was quarantined.')
  }
  if (journal.repairEpoch !== authority.completedEpoch + 1) {
    throw new Error('Passport repair journal epoch is not authorized.')
  }
  if (journal.originalDatabaseId !== authority.currentDatabaseId) {
    throw new Error('Passport repair journal does not match the authoritative database identity.')
  }
  if (
    journal.phase === 'authorized' &&
    currentDatabaseId !== undefined &&
    currentDatabaseId !== journal.originalDatabaseId
  ) {
    throw new Error('Passport repair journal original database identity does not match.')
  }
  if (
    (journal.phase === 'database-created' || journal.phase === 'receipt-staged') &&
    currentDatabaseId !== journal.databaseId
  ) {
    throw new Error('Passport repair journal fresh database identity does not match.')
  }
  return 'active'
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
  authorityKey: Buffer
): RepairReceipt {
  let journal = { ...initial }
  try {
    if (journal.phase === 'authorized') {
      engine?.close()
      engine = null
      for (const suffix of ['', '-wal', '-shm']) secureErase(`${databasePath}${suffix}`)
      journal = writeRepairJournal(databasePath, {
        ...repairJournalPayload(journal),
        phase: 'database-erased'
      }, authorityKey)
      repairCheckpoint('after-repair-database-erase', 95)
    }
    if (journal.phase === 'database-erased') {
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
      journal = writeRepairJournal(databasePath, {
        ...repairJournalPayload(journal),
        phase: 'keys-erased'
      }, authorityKey)
      repairCheckpoint('after-repair-key-erase', 96)
    }
    if (journal.phase === 'keys-erased') {
      engine?.close()
      engine = null
      for (const suffix of ['', '-wal', '-shm']) secureErase(`${databasePath}${suffix}`)
      for (const suffix of [
        '.anchor.json',
        '.anchor.pending.json',
        '.anchor.key',
        '.quarantine.json'
      ]) {
        secureErase(`${databasePath}${suffix}`)
      }
      const current = ensureFreshRepairEngine(databasePath)
      journal = writeRepairJournal(databasePath, {
        ...repairJournalPayload(journal),
        databaseId: current.databaseIdentity,
        phase: 'database-created'
      }, authorityKey)
    }
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
      journal = writeRepairJournal(databasePath, {
        ...repairJournalPayload(journal),
        phase: 'receipt-staged'
      }, authorityKey)
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
    const completedAuthority = writeRepairAuthority(databasePath, {
      ...repairAuthorityPayload(authority),
      completedEpoch: journal.repairEpoch,
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
        const loaded = readExistingRepairAuthority(path)
        const journal = readRepairJournal(path, loaded.key)
        if (!journal) throw new Error('Passport repair journal disappeared during recovery.')
        const disposition = validateRepairJournalAuthority(path, journal, loaded.authority)
        repairAuthorityKey = loaded.key
        if (disposition === 'completed-cleanup') {
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
          resumeRepair(path, journal, loaded.authority, loaded.key)
        }
      } else {
        engine = new PassportPersistenceEngine({ path })
        const loaded = loadOrCreateRepairAuthority(path, engine.databaseIdentity)
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
      version: 2,
      authorityId: authority.authorityId,
      profileBinding: authority.profileBinding,
      repairEpoch: authority.completedEpoch + 1,
      operationId,
      tokenHash,
      originalDatabaseId: current.databaseIdentity,
      quarantinedPath: `${path}.quarantine-${repairedAt}.json`,
      repairedAt,
      phase: 'authorized'
    }, authorityKey)
    repairCheckpoint('after-repair-journal', 94)
    validateRepairJournalAuthority(path, journal, authority)
    const receipt = resumeRepair(path, journal, authority, authorityKey)
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
