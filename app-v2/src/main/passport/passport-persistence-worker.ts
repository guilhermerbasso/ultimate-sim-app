import { parentPort } from 'node:worker_threads'
import { existsSync, renameSync } from 'node:fs'
import { PassportPersistenceEngine } from './persistence-engine'

interface Request {
  id: number
  method: string
  args: unknown[]
}

let engine: PassportPersistenceEngine | null = null
let chain: Promise<void> = Promise.resolve()

function requireEngine(): PassportPersistenceEngine {
  if (!engine) throw new Error('Passport persistence worker is not initialized.')
  return engine
}

async function execute(request: Request): Promise<unknown> {
  if (request.method === 'initialize') {
    engine?.close()
    engine = new PassportPersistenceEngine({ path: String(request.args[0]) })
    return true
  }
  if (request.method === 'simulateCrash') {
    setImmediate(() => process.exit(91))
    return true
  }
  if (request.method === 'repairPersistence') {
    const current = requireEngine()
    const token = String(request.args[0] ?? '')
    if (!current.validateRepairToken(token)) throw new Error('Persistence repair token is invalid.')
    const path = current.databasePath
    current.close()
    const quarantine = `${path}.quarantine-${Date.now()}`
    if (existsSync(path)) renameSync(path, quarantine)
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(`${path}${suffix}`)) renameSync(`${path}${suffix}`, `${quarantine}${suffix}`)
    }
    engine = new PassportPersistenceEngine({ path })
    return { quarantinedPath: quarantine }
  }
  const target = requireEngine() as unknown as Record<string, (...args: unknown[]) => unknown>
  const method = target[request.method]
  if (typeof method !== 'function') throw new Error(`Unknown persistence method: ${request.method}`)
  return await method.apply(engine, request.args)
}

parentPort?.on('message', (value: unknown) => {
  const request = value as Request
  chain = chain.then(async () => {
    try {
      const result = await execute(request)
      parentPort?.postMessage({ id: request.id, ok: true, result })
    } catch (error) {
      parentPort?.postMessage({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        code: (error as { code?: string })?.code
      })
    }
  })
})
