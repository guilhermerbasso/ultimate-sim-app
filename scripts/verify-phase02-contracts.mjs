import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const contractsRoot = join(repoRoot, 'contracts')
const protoRoot = join(contractsRoot, 'proto')
const raceOpsRelativePath = join(
  'ultimate',
  'sim',
  'raceops',
  'v1',
  'race_ops_event.proto'
)
const raceOpsPath = join(protoRoot, raceOpsRelativePath)
const provenancePath = join(
  protoRoot,
  'ultimate',
  'sim',
  'raceops',
  'v1',
  'provenance.proto'
)
const passportPath = join(
  protoRoot,
  'ultimate',
  'sim',
  'raceops',
  'v1',
  'stint_passport.proto'
)
const generatedDescriptorPath = join(
  repoRoot,
  'app-v2',
  'src',
  'main',
  'phase02',
  'generated',
  'contract-descriptor.ts'
)
const generatedN1DescriptorPath = join(
  repoRoot,
  'app-v2',
  'src',
  'main',
  'phase02',
  'generated',
  'n1-contract-descriptor.ts'
)
const profilePath = join(contractsRoot, 'cloudevents', 'profile-v1.json')
const fixturePath = join(
  contractsRoot,
  'testdata',
  'breaking-field-reuse.json'
)
const goldenManifestPath = join(
  contractsRoot,
  'testdata',
  'phase02-golden-manifest.json'
)
const bufBinary = process.env.BUF_BIN || (process.platform === 'win32' ? 'buf.exe' : 'buf')
const contractBaseRef = (process.env.CONTRACT_BASE_REF || '').trim()

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    ...options
  })
  return {
    ...result,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  }
}

function runBuf(args, expectation = 'success') {
  const result = run(bufBinary, args)
  const output = `${result.stdout}${result.stderr}`.trim()

  if (result.error) {
    throw result.error
  }
  if (expectation === 'success' && result.status !== 0) {
    throw new Error(`buf ${args.join(' ')} failed:\n${output}`)
  }
  if (expectation === 'failure' && result.status === 0) {
    throw new Error(`buf ${args.join(' ')} unexpectedly succeeded`)
  }
  return { ...result, output }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function validateEditionSources() {
  for (const path of [raceOpsPath, provenancePath, passportPath]) {
    const source = readFileSync(path, 'utf8')
    const firstStatement = source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('//'))
    if (firstStatement !== 'edition = "2023";') {
      throw new Error(`${path} must start with Protobuf Edition 2023`)
    }
  }
}

function validateCloudEventsProfile() {
  const profile = JSON.parse(readFileSync(profilePath, 'utf8'))
  const expectedStandardTypes = new Map([
    ['specversion', 'string'],
    ['id', 'string'],
    ['source', 'uri-reference'],
    ['type', 'string'],
    ['subject', 'string'],
    ['time', 'timestamp'],
    ['datacontenttype', 'string'],
    ['dataschema', 'uri']
  ])
  const requiredStandard = new Set([
    'specversion',
    'id',
    'source',
    'type',
    'datacontenttype',
    'dataschema'
  ])
  const allowedExtensionTypes = new Set([
    'boolean',
    'integer',
    'string',
    'binary',
    'uri',
    'uri-reference',
    'timestamp'
  ])
  const expectedExtensionTypes = new Map([
    ['sequence', 'string'],
    ['sourcetick', 'string'],
    ['monotonicns', 'string'],
    ['sessionid', 'string'],
    ['producerid', 'string'],
    ['schemafp', 'string'],
    ['correlationid', 'string'],
    ['causationid', 'string'],
    ['privacyclass', 'string'],
    ['rolepolicyid', 'string'],
    ['capgrantid', 'string'],
    ['consentepoch', 'string'],
    ['approvalid', 'string'],
    ['partitionkey', 'string'],
    ['partitionseq', 'string'],
    ['stale', 'boolean'],
    ['derived', 'boolean'],
    ['gap', 'boolean']
  ])
  const standardAttributes = profile.standardattributes || {}
  const standardNames = Object.keys(standardAttributes)
  const raceOpsSource = readFileSync(raceOpsPath, 'utf8')

  if (profile.specversion !== '1.0') {
    throw new Error('CloudEvents profile must target specversion 1.0')
  }
  if (profile.payload?.type !== 'ultimate.sim.raceops.v1.RaceOpsEvent') {
    throw new Error('CloudEvents profile payload type must be RaceOpsEvent')
  }
  if (profile.payload?.datacontenttype !== 'application/x-protobuf') {
    throw new Error('CloudEvents profile must use the Protobuf content type')
  }
  if (!/^urn:[a-z0-9][a-z0-9:.-]+$/i.test(profile.payload?.dataschema || '')) {
    throw new Error('CloudEvents profile must declare a stable payload dataschema URI')
  }

  for (const [name, expectedType] of expectedStandardTypes) {
    const declaration = standardAttributes[name]
    if (!declaration || declaration.type !== expectedType) {
      throw new Error(`CloudEvents standard attribute ${name} must retain type ${expectedType}`)
    }
    if (requiredStandard.has(name) && declaration.required !== true) {
      throw new Error(`CloudEvents standard attribute ${name} must be required by this profile`)
    }
  }
  if (standardNames.some((name) => !expectedStandardTypes.has(name))) {
    throw new Error('CloudEvents profile declares an unknown standard attribute')
  }

  const extensions = profile.extensions || {}
  if (Object.keys(extensions).length !== expectedExtensionTypes.size) {
    throw new Error('CloudEvents profile must declare the complete extension map')
  }
  for (const [name, declaration] of Object.entries(extensions)) {
    if (!/^[a-z0-9]+$/.test(name)) {
      throw new Error(`CloudEvents extension ${name} must match [a-z0-9]+`)
    }
    if (expectedStandardTypes.has(name)) {
      throw new Error(`CloudEvents extension ${name} redefines a standard attribute`)
    }
    if (!declaration || !allowedExtensionTypes.has(declaration.type)) {
      throw new Error(`CloudEvents extension ${name} must declare a valid CloudEvents type`)
    }
    if (expectedExtensionTypes.get(name) !== declaration.type) {
      throw new Error(`CloudEvents extension ${name} has an unexpected type or is not allowed`)
    }
    if (
      declaration.payloadfield &&
      !new RegExp(`\\b${declaration.payloadfield}\\s*=`).test(raceOpsSource)
    ) {
      throw new Error(`CloudEvents extension ${name} references an unknown payload field`)
    }
  }

  const rich64BitFields = new Set(profile.payload?.rich64bitfields || [])
  for (const name of ['consent_epoch', 'sequence', 'partition_seq', 'source_tick', 'observed_monotonic_ns', 'ttl_ms']) {
    if (!rich64BitFields.has(name)) {
      throw new Error(`Rich 64-bit field ${name} must remain authoritative in the payload`)
    }
    if (!new RegExp(`\\b${name}\\s*=`).test(raceOpsSource)) {
      throw new Error(`Rich 64-bit field ${name} is missing from RaceOpsEvent`)
    }
  }
  for (const name of ['sequence', 'sourcetick', 'monotonicns', 'consentepoch', 'partitionseq']) {
    const declaration = extensions[name]
    if (declaration?.type !== 'string' || declaration?.format !== 'decimal-uint64') {
      throw new Error(`CloudEvents extension ${name} must be a decimal uint64 string copy`)
    }
    if (!rich64BitFields.has(declaration.payloadfield)) {
      throw new Error(`CloudEvents extension ${name} must point to an authoritative payload field`)
    }
  }
}

function validateDescriptorTypes(descriptorPath) {
  const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'))
  const raceOpsFile = (descriptor.file || []).find(
    (file) => file.name === 'ultimate/sim/raceops/v1/race_ops_event.proto'
  )
  const raceOpsMessage = (raceOpsFile?.messageType || []).find(
    (message) => message.name === 'RaceOpsEvent'
  )
  if (!raceOpsMessage) {
    throw new Error('RaceOpsEvent descriptor is missing')
  }

  const fields = new Map(
    (raceOpsMessage.field || []).map((field) => [field.name, field])
  )
  for (const name of ['consent_epoch', 'sequence', 'partition_seq', 'source_tick', 'observed_monotonic_ns', 'ttl_ms']) {
    if (fields.get(name)?.type !== 'TYPE_UINT64') {
      throw new Error(`RaceOpsEvent.${name} must remain an authoritative uint64 field`)
    }
  }
  const passportFile = (descriptor.file || []).find(
    (file) => file.name === 'ultimate/sim/raceops/v1/stint_passport.proto'
  )
  const expectedMessages = new Set([
    'PassportOwner',
    'PassportRosterMember',
    'PassportItemEvidence',
    'PassportItem',
    'StintIdentity',
    'StintPassport',
    'PassportEvent'
  ])
  for (const message of passportFile?.messageType || []) expectedMessages.delete(message.name)
  if (expectedMessages.size > 0) {
    throw new Error(`Stint Passport descriptor is incomplete: ${[...expectedMessages].join(', ')}`)
  }
  const itemEnum = (passportFile?.enumType || []).find((entry) => entry.name === 'PassportItemId')
  const itemValues = (itemEnum?.value || []).filter((entry) => entry.number > 0)
  if (itemValues.length !== 12) {
    throw new Error(`PassportItemId must define exactly 12 non-zero checklist items, found ${itemValues.length}`)
  }
}

function validateGeneratedDescriptor(expectedFingerprint, path, prefix) {
  const source = readFileSync(path, 'utf8')
  const declared = source.match(new RegExp(`${prefix}_DESCRIPTOR_SHA256 = '([0-9a-f]{64})'`))?.[1]
  const base64 = source.match(new RegExp(`${prefix}_DESCRIPTOR_BASE64 = '([A-Za-z0-9+/=]+)'`))?.[1]
  if (!declared || !base64) throw new Error('Generated Phase 02 descriptor constants are missing')
  const bytes = Buffer.from(base64, 'base64')
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (declared !== actual || actual !== expectedFingerprint) {
    throw new Error('Generated Phase 02 descriptor is stale; run scripts/generate-phase02-descriptor.mjs')
  }
}

function validateGoldenManifest() {
  const manifest = JSON.parse(readFileSync(goldenManifestPath, 'utf8'))
  if (manifest.version !== 1 || !Array.isArray(manifest.fixtures)) {
    throw new Error('Phase 02 golden manifest is invalid')
  }
  for (const fixture of manifest.fixtures) {
    const jsonPath = join(contractsRoot, 'testdata', fixture.json)
    const binaryPath = join(contractsRoot, 'testdata', fixture.binary)
    if (sha256(jsonPath) !== fixture.jsonSha256) {
      throw new Error(`Phase 02 golden JSON hash mismatch: ${fixture.json}`)
    }
    if (sha256(binaryPath) !== fixture.binarySha256) {
      throw new Error(`Phase 02 golden binary hash mismatch: ${fixture.binary}`)
    }
  }
  if (!manifest.fixtures.some((fixture) =>
    fixture.type === 'ultimate.sim.raceops.n1.v1.StintPassport' &&
    fixture.producerVersion === 0
  )) {
    throw new Error('Phase 02 N-1 Stint Passport fixture is missing')
  }
}

function validateRealSchemaEvolution() {
  if (!contractBaseRef || /^0+$/.test(contractBaseRef)) {
    return 'not-requested'
  }
  if (!/^[0-9a-f]{40}$/i.test(contractBaseRef)) {
    throw new Error('CONTRACT_BASE_REF must be a full 40-character Git SHA')
  }

  const commitProbe = run('git', [
    'cat-file',
    '-e',
    `${contractBaseRef}^{commit}`
  ])
  if (commitProbe.status !== 0) {
    throw new Error(`Contract baseline commit is unavailable: ${contractBaseRef}`)
  }

  const probe = run('git', [
    'cat-file',
    '-e',
    `${contractBaseRef}:contracts/buf.yaml`
  ])
  if (probe.status === 0) {
    runBuf([
      'breaking',
      contractsRoot,
      '--against',
      `.git#ref=${contractBaseRef},subdir=contracts`
    ])
    return 'checked'
  }
  if (probe.status === 128) {
    return 'first-introduction'
  }
  throw new Error(`Could not inspect contract baseline ${contractBaseRef}:\n${probe.stderr}`)
}

validateEditionSources()
validateCloudEventsProfile()
validateGoldenManifest()
runBuf(['lint', contractsRoot])
runBuf(['lint', join(contractsRoot, 'n-1')])
const baselineStatus = validateRealSchemaEvolution()

const tempRoot = join(repoRoot, `.phase02-contract-verify-${process.pid}`)
rmSync(tempRoot, { recursive: true, force: true })
mkdirSync(tempRoot, { recursive: true })
try {
  const firstDescriptor = join(tempRoot, 'descriptor-1.binpb')
  const secondDescriptor = join(tempRoot, 'descriptor-2.binpb')
  const descriptorJson = join(tempRoot, 'descriptor.json')
  const n1Descriptor = join(tempRoot, 'n1-descriptor.binpb')
  const buildArgs = [
    'build',
    contractsRoot,
    '--as-file-descriptor-set',
    '--exclude-source-info'
  ]

  runBuf([...buildArgs, '--output', firstDescriptor])
  runBuf([...buildArgs, '--output', secondDescriptor])
  runBuf([...buildArgs, '--output', descriptorJson])

  const firstFingerprint = sha256(firstDescriptor)
  const secondFingerprint = sha256(secondDescriptor)
  if (firstFingerprint !== secondFingerprint) {
    throw new Error('Descriptor fingerprint is not reproducible')
  }
  validateDescriptorTypes(descriptorJson)
  validateGeneratedDescriptor(firstFingerprint, generatedDescriptorPath, 'PHASE02')
  runBuf([
    'build',
    join(contractsRoot, 'n-1'),
    '--as-file-descriptor-set',
    '--exclude-source-info',
    '--output',
    n1Descriptor
  ])
  const n1Fingerprint = sha256(n1Descriptor)
  validateGeneratedDescriptor(n1Fingerprint, generatedN1DescriptorPath, 'PHASE02_N1')

  const breakingRoot = join(tempRoot, 'breaking-field-reuse')
  cpSync(contractsRoot, breakingRoot, { recursive: true })
  rmSync(join(breakingRoot, 'testdata'), { recursive: true, force: true })
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
  if (fixture.relativepath !== raceOpsRelativePath.replaceAll('\\', '/')) {
    throw new Error('Breaking fixture targets an unexpected contract file')
  }
  const candidateRaceOpsPath = join(breakingRoot, 'proto', raceOpsRelativePath)
  const canonicalRaceOpsSource = readFileSync(candidateRaceOpsPath, 'utf8')
  const replacementCount = canonicalRaceOpsSource.split(fixture.replace).length - 1
  if (replacementCount !== 1) {
    throw new Error('Breaking fixture replacement must match exactly once')
  }
  writeFileSync(
    candidateRaceOpsPath,
    canonicalRaceOpsSource.replace(fixture.replace, fixture.with)
  )

  const breaking = runBuf(
    ['breaking', breakingRoot, '--against', contractsRoot],
    'failure'
  )
  const expectedBreakingDiagnostics = [
    /Field "2".*message "RaceOpsEvent" changed type from "enum" to "string"/,
    /Field "2".*message "RaceOpsEvent" changed name from "event_class" to "legacy_event_class"/
  ]
  if (!expectedBreakingDiagnostics.every((pattern) => pattern.test(breaking.output))) {
    throw new Error(`Breaking fixture failed for an unexpected reason:\n${breaking.output}`)
  }

  console.log(JSON.stringify({
    buf: bufBinary,
    baselineStatus,
    descriptorSha256: firstFingerprint,
    cloudeventsExtensions: Object.keys(
      JSON.parse(readFileSync(profilePath, 'utf8')).extensions
    ).length,
    passportItems: 12,
    n1DescriptorSha256: n1Fingerprint,
    breakingFixtureRejected: true
  }))
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
