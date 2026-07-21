import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { dirname, join, resolve } from 'node:path'

const root = resolve(process.cwd())
const fixturePath = process.env.PASSPORT_WORKER_FIXTURE
const workerPath = fixturePath
  ? resolve(fixturePath)
  : join(root, 'out', 'main', 'passport-persistence-worker.js')
const mainPath = join(root, 'out', 'main', 'index.js')
if (!existsSync(workerPath) || statSync(workerPath).size < 1_000) {
  throw new Error('Packaged Passport persistence worker is missing or empty.')
}
if (!fixturePath) {
  const main = readFileSync(mainPath, 'utf8')
  if (!main.includes('passport-persistence-worker.js')) {
    throw new Error('Main bundle does not reference the packaged Passport persistence worker.')
  }
}

const smokeDb = join(fixturePath ? dirname(workerPath) : join(root, 'out'), 'passport-worker-smoke.db')
const sidecars = [
  '',
  '-wal',
  '-shm',
  '.anchor.json',
  '.anchor.pending.json',
  '.anchor.key',
  '.quarantine.json',
  '.repair-authority.json',
  '.repair-authority.json.pending',
  '.repair-authority.key',
  '.repair-authority.key.pending',
  '.repair-journal.json',
  '.repair-journal.json.pending',
  '.repair-journal.json.cleanup',
  '.repair-receipt.json',
  '.repair-receipt.json.pending',
  '.repair-high-water-a',
  '.repair-high-water-b',
  '.directory-authority.sqlite'
]
const cleanup = () => {
  for (const suffix of sidecars) {
    rmSync(`${smokeDb}${suffix}`, { force: true, recursive: true })
  }
}
cleanup()

let requestId = 0
function startProcess() {
  const child = fork(workerPath, [], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    execArgv: [],
    serialization: 'advanced',
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  })
  child.stdout?.resume()
  child.stderr?.resume()
  const pending = new Map()
  child.on('message', (response) => {
    const entry = pending.get(response.id)
    if (!entry) return
    pending.delete(response.id)
    if (response.ok) entry.resolve(response.result)
    else entry.reject(new Error(response.error || 'worker verification request failed'))
  })
  child.on('exit', (code) => {
    for (const entry of pending.values()) {
      entry.reject(new Error(`Passport persistence process exited with code ${code}.`))
    }
    pending.clear()
  })
  const request = (method, args = []) => new Promise((resolve, reject) => {
    const id = ++requestId
    pending.set(id, { resolve, reject })
    child.send({ id, method, args })
  })
  const crash = async (method, args, expectedCode) => {
    const exit = once(child, 'exit')
    child.send({ id: ++requestId, method, args })
    const [code] = await exit
    if (code !== expectedCode) {
      throw new Error(`Expected persistence process exit ${expectedCode}, received ${code}.`)
    }
  }
  return { child, request, crash }
}

const proofs = []
let processHandle
try {
  processHandle = startProcess()
  const initialized = await processHandle.request('initialize', [smokeDb])
  if (
    !initialized ||
    typeof initialized !== 'object' ||
    initialized.isolatedProcessId === process.pid
  ) {
    throw new Error('Passport persistence did not initialize in an isolated process.')
  }
  const config = await processHandle.request('getConfig')
  await processHandle.request('configureCrashBoundary', [{
    operation: 'setConfig',
    checkpoint: 'after-commit-before-response'
  }])
  await processHandle.crash('setConfig', [{
    ...config,
    communicationChannel: 'commit-boundary-proof'
  }], 93)
  proofs.push('real-crash', 'commit-boundary')

  processHandle = startProcess()
  await processHandle.request('initialize', [smokeDb])
  const recovered = await processHandle.request('getConfig')
  if (recovered.communicationChannel !== 'commit-boundary-proof') {
    throw new Error('Acknowledged durable state was not recovered after the process crash.')
  }
  proofs.push('recovery')

  const drainedConfig = {
    ...recovered,
    communicationChannel: 'drain-proof'
  }
  const update = processHandle.request('setConfig', [drainedConfig])
  const shutdown = processHandle.request('shutdown')
  await Promise.all([update, shutdown])
  if (processHandle.child.exitCode === null && processHandle.child.signalCode === null) {
    await once(processHandle.child, 'exit')
  }

  processHandle = startProcess()
  await processHandle.request('initialize', [smokeDb])
  const drained = await processHandle.request('getConfig')
  if (drained.communicationChannel !== 'drain-proof') {
    throw new Error('Shutdown did not drain the accepted persistence mutation.')
  }
  if (existsSync(`${smokeDb}.directory-authority.sqlite`)) {
    throw new Error('Passport worker created the forbidden SQLite directory durability fallback.')
  }
  proofs.push('drain')
  await processHandle.request('shutdown')
  if (processHandle.child.exitCode === null && processHandle.child.signalCode === null) {
    await once(processHandle.child, 'exit')
  }
} finally {
  if (
    processHandle?.child.exitCode === null &&
    processHandle.child.signalCode === null
  ) {
    processHandle.child.kill()
  }
  cleanup()
}

console.log(JSON.stringify({
  worker: workerPath,
  bytes: statSync(workerPath).size,
  packaged: !fixturePath,
  isolatedProcess: true,
  smoke: true,
  proofs
}))
