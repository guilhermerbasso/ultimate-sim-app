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
  writeFileSync,
  writeSync
} from 'node:fs'
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
  checkpoint: 'before-dispatch' | 'after-commit-before-response'
}

interface RepairReceipt {
  version: 1
  operationId: string
  tokenHash: string
  databaseId: string
  quarantinedPath: string
  repairedAt: number
}

let engine: PassportPersistenceEngine | null = null
let chain: Promise<void> = Promise.resolve()
let crashBoundary: CrashBoundary | null = null

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

function readRepairReceipt(databasePath: string): RepairReceipt | undefined {
  const path = repairReceiptPath(databasePath)
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<RepairReceipt>
    if (
      value.version !== 1 ||
      typeof value.operationId !== 'string' ||
      typeof value.tokenHash !== 'string' ||
      typeof value.databaseId !== 'string' ||
      typeof value.quarantinedPath !== 'string' ||
      !Number.isSafeInteger(value.repairedAt)
    ) {
      return undefined
    }
    return value as RepairReceipt
  } catch {
    return undefined
  }
}

function writeRepairReceipt(databasePath: string, receipt: RepairReceipt): void {
  const path = repairReceiptPath(databasePath)
  const pending = `${path}.pending`
  writeFileSync(pending, `${JSON.stringify(receipt)}\n`, 'utf8')
  renameSync(pending, path)
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
    engine = new PassportPersistenceEngine({ path: String(request.args[0]) })
    return { isolatedProcessId: process.pid }
  }
  if (request.method === 'configureCrashBoundary') {
    const candidate = request.args[0] as Partial<CrashBoundary> | undefined
    if (
      !candidate ||
      typeof candidate.operation !== 'string' ||
      (candidate.checkpoint !== 'before-dispatch' &&
        candidate.checkpoint !== 'after-commit-before-response')
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
      (priorReceipt.operationId === operationId || priorReceipt.tokenHash === tokenHash) &&
      isFreshRepairDatabase(current, priorReceipt)
    ) {
      return { quarantinedPath: priorReceipt.quarantinedPath }
    }
    if (!current.validateRepairToken(token)) {
      throw persistenceDomainError('Persistence repair token is invalid.')
    }
    current.flush()
    const path = current.databasePath
    current.close()
    const quarantine = `${path}.quarantine-${Date.now()}.json`
    for (const suffix of ['', '-wal', '-shm']) secureErase(`${path}${suffix}`)
    for (const suffix of [
      '.anchor.json',
      '.anchor.pending.json',
      '.anchor.key',
      '.quarantine.json'
    ]) {
      secureErase(`${path}${suffix}`)
    }
    secureErase(repairReceiptPath(path))
    secureErase(`${repairReceiptPath(path)}.pending`)
    writeFileSync(quarantine, JSON.stringify({
      kind: 'stint-passport-repair-quarantine',
      repairedAt: Date.now(),
      payloadRetained: false
    }))
    engine = new PassportPersistenceEngine({ path })
    writeRepairReceipt(path, {
      version: 1,
      operationId,
      tokenHash,
      databaseId: engine.databaseIdentity,
      quarantinedPath: quarantine,
      repairedAt: Date.now()
    })
    return { quarantinedPath: quarantine }
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
