import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const appNodeModules = join(repoRoot, 'app-v2', 'node_modules', '@bufbuild', 'protobuf', 'dist', 'esm')
const protobuf = await import(pathToFileURL(join(appNodeModules, 'index.js')).href)
const wkt = await import(pathToFileURL(join(appNodeModules, 'wkt', 'index.js')).href)

function registryFromGenerated(file, pattern) {
  const source = readFileSync(join(
    repoRoot,
    'app-v2',
    'src',
    'main',
    'phase02',
    'generated',
    file
  ), 'utf8')
  const base64 = source.match(pattern)?.[1]
  if (!base64) throw new Error(`Generated descriptor is unavailable: ${file}`)
  return protobuf.createFileRegistry(protobuf.fromBinary(
    wkt.FileDescriptorSetSchema,
    Buffer.from(base64, 'base64')
  ))
}
const registry = registryFromGenerated(
  'contract-descriptor.ts',
  /PHASE02_DESCRIPTOR_BASE64 = '([A-Za-z0-9+/=]+)'/
)
const n1Registry = registryFromGenerated(
  'n1-contract-descriptor.ts',
  /PHASE02_N1_DESCRIPTOR_BASE64 = '([A-Za-z0-9+/=]+)'/
)
const fixtures = [
  {
    json: 'race-ops-event-v1.json',
    binary: 'race-ops-event-v1.binpb',
    type: 'ultimate.sim.raceops.v1.RaceOpsEvent',
    producerVersion: 1,
    registry
  },
  {
    json: 'stint-passport-v1.json',
    binary: 'stint-passport-v1.binpb',
    type: 'ultimate.sim.raceops.v1.StintPassport',
    producerVersion: 1,
    registry
  },
  {
    json: 'stint-passport-n-1.json',
    binary: 'stint-passport-n-1.binpb',
    type: 'ultimate.sim.raceops.n1.v1.StintPassport',
    producerVersion: 0,
    registry: n1Registry
  }
]
const testdata = join(repoRoot, 'contracts', 'testdata')
const manifest = []

function normalizedTextSha256(path) {
  const source = readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
  return createHash('sha256').update(source, 'utf8').digest('hex')
}

for (const fixture of fixtures) {
  const schema = fixture.registry.getMessage(fixture.type)
  if (!schema) throw new Error(`Descriptor is missing ${fixture.type}`)
  const jsonPath = join(testdata, fixture.json)
  const binaryPath = join(testdata, fixture.binary)
  const json = JSON.parse(readFileSync(jsonPath, 'utf8'))
  const bytes = protobuf.toBinary(schema, protobuf.fromJson(schema, json))
  writeFileSync(binaryPath, bytes)
  manifest.push({
    json: fixture.json,
    binary: fixture.binary,
    type: fixture.type,
    producerVersion: fixture.producerVersion,
    binarySha256: createHash('sha256').update(bytes).digest('hex'),
    jsonSha256: normalizedTextSha256(jsonPath),
    bytes: bytes.length
  })
}

writeFileSync(
  join(testdata, 'phase02-golden-manifest.json'),
  `${JSON.stringify({ version: 1, fixtures: manifest }, null, 2)}\n`,
  'utf8'
)
console.log(JSON.stringify({ fixtures: manifest.length }))
