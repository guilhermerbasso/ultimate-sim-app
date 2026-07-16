import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PASSPORT_PRIVACY } from '../../shared/stint-passport'
import { PassportPersistenceClient } from './persistence-client'

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

  constructor(private readonly behavior: (worker: FakeWorker, request: Request) => void) {}

  postMessage(value: unknown): void {
    const request = value as Request
    this.requests.push(request)
    this.behavior(this, request)
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
    queueMicrotask(() => {
      for (const listener of this.messageListeners) {
        listener({ id: request.id, ok: true, result })
      }
    })
  }

  fail(request: Request, message: string, code?: string): void {
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
  for (const client of clients.splice(0)) await client.close()
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
