import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const planPath = join(root, 'docs', 'phase02', 'stint-passport-v2-run-manifest.json')
const contractPath = join(root, 'docs', 'phase02', 'stint-passport-v2-acceptance-contract.json')
const artifactRoot = join(root, 'artifacts', 'stint-passport-v2')
const resultsPath = resolve(
  process.env.PASSPORT_V2_RESULTS_PATH || join(artifactRoot, 'acceptance-results.json')
)
const logPath = resolve(
  process.env.PASSPORT_V2_LOG_PATH || join(artifactRoot, 'acceptance.log')
)
const outputPath = resolve(
  process.env.PASSPORT_V2_MANIFEST_PATH ||
    join(artifactRoot, 'stint-passport-v2-run-manifest.json')
)
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

if (process.env.GITHUB_ACTIONS !== 'true') {
  throw new Error('Runtime Passport acceptance evidence may only be issued by GitHub Actions.')
}
if (process.env.GITHUB_JOB !== 'passport-acceptance') {
  throw new Error('Runtime Passport acceptance evidence requires the passport-acceptance job.')
}
if (!/^[0-9a-f]{40}$/i.test(process.env.GITHUB_SHA || '')) {
  throw new Error('GitHub Actions did not provide an immutable source SHA.')
}
for (const name of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_REPOSITORY', 'GITHUB_WORKFLOW', 'GITHUB_REF']) {
  if (!process.env[name]) throw new Error(`GitHub Actions did not provide ${name}.`)
}

const planBytes = readFileSync(planPath)
const plan = JSON.parse(planBytes)
const contractBytes = readFileSync(contractPath)
const resultsBytes = readFileSync(resultsPath)
const results = JSON.parse(resultsBytes)
const logBytes = readFileSync(logPath)
const commitSha = git('rev-parse', 'HEAD')
const treeSha = git('rev-parse', 'HEAD^{tree}')

if (commitSha !== process.env.GITHUB_SHA) {
  throw new Error('The checked-out commit does not match GITHUB_SHA.')
}
if (
  plan.manifestVersion !== 2 ||
  plan.kind !== 'acceptance-plan' ||
  plan.status !== 'pending-ci-attestation' ||
  plan.acceptanceContractSha256 !== sha256(contractBytes)
) {
  throw new Error('The checked-in Passport acceptance plan is invalid or stale.')
}
if (
  results.schemaVersion !== 1 ||
  results.source?.commitSha !== commitSha ||
  results.source?.treeSha !== treeSha ||
  results.acceptancePlanSha256 !== sha256(planBytes) ||
  results.acceptanceContractSha256 !== sha256(contractBytes) ||
  results.combinedLogSha256 !== sha256(logBytes)
) {
  throw new Error('Passport acceptance results are not bound to the checked-out source and logs.')
}

const expectedNames = ['build', 'contracts', 'targetedTests', 'typecheck']
for (const name of expectedNames) {
  const expected = plan.evidence?.[name]
  const actual = results.evidence?.[name]
  if (
    expected?.status !== 'required' ||
    actual?.status !== 'passed' ||
    actual?.exitCode !== 0 ||
    actual?.command !== expected.command ||
    !/^[0-9a-f]{64}$/.test(actual?.logSha256 || '')
  ) {
    throw new Error(`Passport acceptance evidence for ${name} is missing, failed, or non-canonical.`)
  }
}
if (
  results.discovery?.tests !== plan.evidence.targetedTests.tests ||
  results.discovery?.files !== plan.evidence.targetedTests.files
) {
  throw new Error('Passport acceptance discovery counts do not match the source-bound plan.')
}

const manifest = {
  manifestVersion: 2,
  kind: 'ci-runtime-evidence',
  status: 'passed-awaiting-external-attestation',
  acceptanceContract: plan.acceptanceContract,
  acceptanceContractSha256: plan.acceptanceContractSha256,
  acceptancePlan: 'docs/phase02/stint-passport-v2-run-manifest.json',
  acceptancePlanSha256: sha256(planBytes),
  baseCommit: plan.baseCommit,
  source: {
    commitSha,
    treeSha,
    ref: process.env.GITHUB_REF,
    repository: process.env.GITHUB_REPOSITORY
  },
  provenance: {
    issuer: 'https://token.actions.githubusercontent.com',
    workflow: process.env.GITHUB_WORKFLOW,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    jobId: process.env.GITHUB_JOB,
    resultsSha256: sha256(resultsBytes),
    logSha256: sha256(logBytes)
  },
  evidence: results.evidence,
  discovery: results.discovery,
  attestation: {
    provider: 'github-artifact-attestations',
    state: 'awaiting-external-signature',
    subject: 'artifacts/stint-passport-v2/stint-passport-v2-run-manifest.json',
    verificationCommand: plan.attestation.verificationCommand
  }
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({
  outputPath,
  commitSha,
  treeSha,
  resultsSha256: manifest.provenance.resultsSha256,
  logSha256: manifest.provenance.logSha256
}))
