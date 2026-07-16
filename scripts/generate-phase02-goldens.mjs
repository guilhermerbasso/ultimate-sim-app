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

const descriptorSource = readFileSync(join(
  repoRoot,
  'app-v2',
  'src',
  'main',
  'phase02',
  'generated',
  'contract-descriptor.ts'
), 'utf8')
const descriptorBase64 = descriptorSource.match(
  /PHASE02_DESCRIPTOR_BASE64 = '([A-Za-z0-9+/=]+)'/
)?.[1]
if (!descriptorBase64) throw new Error('Generated Phase 02 descriptor is unavailable.')

const descriptorSet = protobuf.fromBinary(
  wkt.FileDescriptorSetSchema,
  Buffer.from(descriptorBase64, 'base64')
)
const registry = protobuf.createFileRegistry(descriptorSet)
const fixtures = [
  {
    json: 'race-ops-event-v1.json',
    binary: 'race-ops-event-v1.binpb',
    type: 'ultimate.sim.raceops.v1.RaceOpsEvent',
    producerVersion: 1
  },
  {
    json: 'stint-passport-v1.json',
    binary: 'stint-passport-v1.binpb',
    type: 'ultimate.sim.raceops.v1.StintPassport',
    producerVersion: 1
  },
  {
    json: 'stint-passport-n-1.json',
    binary: 'stint-passport-n-1.binpb',
    type: 'ultimate.sim.raceops.v1.StintPassport',
    producerVersion: 0
  }
]
const testdata = join(repoRoot, 'contracts', 'testdata')
const manifest = []

for (const fixture of fixtures) {
  const schema = registry.getMessage(fixture.type)
  if (!schema) throw new Error(`Descriptor is missing ${fixture.type}`)
  const jsonPath = join(testdata, fixture.json)
  const binaryPath = join(testdata, fixture.binary)
  const json = JSON.parse(readFileSync(jsonPath, 'utf8'))
  const bytes = protobuf.toBinary(schema, protobuf.fromJson(schema, json))
  writeFileSync(binaryPath, bytes)
  manifest.push({
    ...fixture,
    binarySha256: createHash('sha256').update(bytes).digest('hex'),
    jsonSha256: createHash('sha256').update(readFileSync(jsonPath)).digest('hex'),
    bytes: bytes.length
  })
}

writeFileSync(
  join(testdata, 'phase02-golden-manifest.json'),
  `${JSON.stringify({ version: 1, fixtures: manifest }, null, 2)}\n`,
  'utf8'
)
console.log(JSON.stringify({ fixtures: manifest.length }))
