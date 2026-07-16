import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

const root = resolve(process.cwd())
const workerPath = join(root, 'out', 'main', 'passport-persistence-worker.js')
const mainPath = join(root, 'out', 'main', 'index.js')
if (!existsSync(workerPath) || statSync(workerPath).size < 1_000) {
  throw new Error('Packaged Passport persistence worker is missing or empty.')
}
const main = readFileSync(mainPath, 'utf8')
if (!main.includes('passport-persistence-worker.js')) {
  throw new Error('Main bundle does not reference the packaged Passport persistence worker.')
}
const smokeDb = join(root, 'out', 'passport-worker-smoke.db')
for (const suffix of ['', '-wal', '-shm']) rmSync(`${smokeDb}${suffix}`, { force: true })
const worker = new Worker(pathToFileURL(workerPath))
let requestId = 0
const pending = new Map()
worker.on('message', (response) => {
  const entry = pending.get(response.id)
  if (!entry) return
  pending.delete(response.id)
  if (response.ok) entry.resolve(response.result)
  else entry.reject(new Error(response.error || 'worker smoke request failed'))
})
const request = (method, args = []) => new Promise((resolve, reject) => {
  const id = ++requestId
  pending.set(id, { resolve, reject })
  worker.postMessage({ id, method, args })
})
try {
  await request('initialize', [smokeDb])
  const config = await request('getConfig')
  if (!config || typeof config !== 'object') throw new Error('Passport worker smoke config failed.')
} finally {
  await worker.terminate()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${smokeDb}${suffix}`, { force: true })
}
console.log(JSON.stringify({ worker: workerPath, bytes: statSync(workerPath).size, smoke: true }))
