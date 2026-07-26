import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appRoot = join(root, 'app-v2')
const artifactRoot = join(root, 'artifacts', 'stint-passport-v2')
const planPath = join(root, 'docs', 'phase02', 'stint-passport-v2-run-manifest.json')
const contractPath = join(root, 'docs', 'phase02', 'stint-passport-v2-acceptance-contract.json')
const resultsPath = join(artifactRoot, 'acceptance-results.json')
const logPath = join(artifactRoot, 'acceptance.log')
const planBytes = readFileSync(planPath)
const plan = JSON.parse(planBytes)
const selectors = plan.evidence?.targetedTests?.selectors

if (
  plan.manifestVersion !== 2 ||
  plan.kind !== 'acceptance-plan' ||
  plan.status !== 'pending-ci-attestation' ||
  !Array.isArray(selectors) ||
  selectors.length === 0
) {
  throw new Error('The checked-in Passport V2 acceptance plan is invalid.')
}
if (!selectors.every((selector) => /^[A-Za-z0-9_./-]+\.test\.tsx?$/.test(selector))) {
  throw new Error('The Passport V2 acceptance plan contains an unsafe test selector.')
}

const expectedTargetCommand = `npm run test:unit -- ${selectors.join(' ')}`
if (plan.evidence.targetedTests.command !== expectedTargetCommand) {
  throw new Error('The targeted command does not exactly match its enumerated selectors.')
}

let combinedLog = ''
const evidence = {}
let failed = false

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function git(...args) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    windowsHide: true
  })
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`)
  return result.stdout.trim()
}

if (git('status', '--porcelain', '--untracked-files=all')) {
  throw new Error('Source-bound Passport acceptance requires a clean Git checkout.')
}
mkdirSync(artifactRoot, { recursive: true })

function runStep(name, command, cwd, executable, args, env = process.env) {
  const startedAt = new Date().toISOString()
  const result = spawnSync(executable, args, {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024
  })
  const output = [
    `===== ${name}: ${command} =====`,
    result.stdout || '',
    result.stderr || '',
    result.error?.stack || '',
    `===== exit ${result.status ?? -1} =====`,
    ''
  ].join('\n')
  combinedLog += output
  const status = result.status === 0 && !result.error ? 'passed' : 'failed'
  evidence[name] = {
    status,
    command,
    exitCode: result.status ?? -1,
    startedAt,
    finishedAt: new Date().toISOString(),
    logSha256: sha256(output)
  }
  if (status !== 'passed') {
    failed = true
    process.stderr.write(output)
  }
  console.log(`${name}: ${status}`)
  return result
}

function runNpmStep(name, command, args) {
  if (process.platform === 'win32') {
    return runStep(
      name,
      command,
      appRoot,
      process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/s', '/c', `npm ${args.join(' ')}`]
    )
  }
  return runStep(name, command, appRoot, 'npm', args)
}

const vitestEntry = join(appRoot, 'node_modules', 'vitest', 'vitest.mjs')
const listed = spawnSync(process.execPath, [vitestEntry, 'list', ...selectors], {
  cwd: appRoot,
  encoding: 'utf8',
  windowsHide: true,
  maxBuffer: 32 * 1024 * 1024
})
if (listed.status !== 0) {
  throw new Error(`Vitest discovery failed: ${listed.stderr}`)
}
const discoveredLines = listed.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
const discovered = {
  tests: discoveredLines.length,
  files: new Set(discoveredLines.map((line) => line.split(' > ', 1)[0])).size
}
if (
  discovered.tests !== plan.evidence.targetedTests.tests ||
  discovered.files !== plan.evidence.targetedTests.files
) {
  throw new Error(
    `Targeted discovery ${discovered.tests}/${discovered.files} does not match the acceptance plan ` +
    `${plan.evidence.targetedTests.tests}/${plan.evidence.targetedTests.files}.`
  )
}

runStep(
  'contracts',
  plan.evidence.contracts.command,
  root,
  process.execPath,
  ['scripts/verify-phase02-contracts.mjs'],
  {
    ...process.env,
    CONTRACT_BASE_REF: process.env.CONTRACT_BASE_REF || plan.baseCommit
  }
)
runNpmStep('typecheck', plan.evidence.typecheck.command, ['run', 'typecheck'])
runNpmStep('build', plan.evidence.build.command, ['run', 'build'])
runNpmStep(
  'targetedTests',
  plan.evidence.targetedTests.command,
  ['run', 'test:unit', '--', ...selectors]
)

writeFileSync(logPath, combinedLog, 'utf8')
const results = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: {
    commitSha: git('rev-parse', 'HEAD'),
    treeSha: git('rev-parse', 'HEAD^{tree}'),
    branch: git('branch', '--show-current')
  },
  acceptancePlan: 'docs/phase02/stint-passport-v2-run-manifest.json',
  acceptancePlanSha256: sha256(planBytes),
  acceptanceContract: plan.acceptanceContract,
  acceptanceContractSha256: sha256(readFileSync(contractPath)),
  discovery: discovered,
  evidence,
  combinedLogSha256: sha256(combinedLog)
}
writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8')

if (failed) {
  process.exitCode = 1
} else {
  console.log(JSON.stringify({ resultsPath, logPath, ...discovered }))
}
