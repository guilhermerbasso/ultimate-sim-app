import { createHash } from 'node:crypto'
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
import { dirname } from 'node:path'
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

interface RepairJournal {
  version: 1
  operationId: string
  tokenHash: string
  databaseId?: string
  quarantinedPath: string
  repairedAt: number
  phase: RepairPhase
}

let engine: PassportPersistenceEngine | null = null
let chain: Promise<void> = Promise.resolve()
let crashBoundary: CrashBoundary | null = null

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

function parseRepairJournal(databasePath: string, path: string): RepairJournal {
  const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<RepairJournal>
  const phases: readonly RepairPhase[] = [
    'authorized',
    'database-erased',
    'keys-erased',
    'database-created',
    'receipt-staged'
  ]
  if (
    value.version !== 1 ||
    typeof value.operationId !== 'string' ||
    !/^[A-Za-z0-9:_-]{16,160}$/.test(value.operationId) ||
    typeof value.tokenHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.tokenHash) ||
    !validRepairArtifactPath(databasePath, value.quarantinedPath) ||
    !Number.isSafeInteger(value.repairedAt) ||
    !phases.includes(value.phase as RepairPhase) ||
    (value.databaseId !== undefined && !/^[a-f0-9]{48}$/.test(value.databaseId))
  ) {
    throw new Error('Passport repair journal is invalid.')
  }
  if (
    (value.phase === 'database-created' || value.phase === 'receipt-staged') &&
    value.databaseId === undefined
  ) {
    throw new Error('Passport repair journal is missing its fresh database identity.')
  }
  return value as RepairJournal
}

function readRepairJournal(databasePath: string): RepairJournal | undefined {
  const path = repairJournalPath(databasePath)
  const pending = `${path}.pending`
  if (existsSync(path)) {
    const journal = parseRepairJournal(databasePath, path)
    rmSync(pending, { force: true })
    return journal
  }
  if (!existsSync(pending)) return undefined
  const journal = parseRepairJournal(databasePath, pending)
  promoteDurable(pending, path)
  return journal
}

function writeRepairJournal(databasePath: string, journal: RepairJournal): void {
  writeAtomicDurable(repairJournalPath(databasePath), journal)
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

function resumeRepair(databasePath: string, initial: RepairJournal): RepairReceipt {
  let journal = { ...initial }
  try {
    if (journal.phase === 'authorized') {
      engine?.close()
      engine = null
      for (const suffix of ['', '-wal', '-shm']) secureErase(`${databasePath}${suffix}`)
      journal = { ...journal, phase: 'database-erased' }
      writeRepairJournal(databasePath, journal)
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
      journal = { ...journal, phase: 'keys-erased' }
      writeRepairJournal(databasePath, journal)
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
      journal = {
        ...journal,
        databaseId: current.databaseIdentity,
        phase: 'database-created'
      }
      writeRepairJournal(databasePath, journal)
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
      journal = { ...journal, phase: 'receipt-staged' }
      writeRepairJournal(databasePath, journal)
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
    repairCheckpoint('after-repair-receipt-promotion', 98)
    secureErase(repairJournalPath(databasePath))
    secureErase(`${repairJournalPath(databasePath)}.pending`)
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
    const path = String(request.args[0])
    const journal = readRepairJournal(path)
    if (journal) resumeRepair(path, journal)
    else engine = new PassportPersistenceEngine({ path })
    return { isolatedProcessId: process.pid }
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
    return true
  }
  if (request.method === 'repairPersistence') {
    const current = requireEngine()
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
      isFreshRepairDatabase(current, priorReceipt)
    ) {
      return { quarantinedPath: priorReceipt.quarantinedPath }
    }
    if (!current.validateRepairToken(token)) {
      throw persistenceDomainError('Persistence repair token is invalid.')
    }
    current.flush()
    const path = current.databasePath
    const repairedAt = Date.now()
    const journal: RepairJournal = {
      version: 1,
      operationId,
      tokenHash,
      quarantinedPath: `${path}.quarantine-${repairedAt}.json`,
      repairedAt,
      phase: 'authorized'
    }
    writeRepairJournal(path, journal)
    repairCheckpoint('after-repair-journal', 94)
    const receipt = resumeRepair(path, journal)
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
