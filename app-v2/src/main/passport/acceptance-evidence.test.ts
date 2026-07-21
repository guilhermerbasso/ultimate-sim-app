import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { buildPassportWorkerTestFixture } from './passport-worker-test-fixture'

interface EvidenceCommand {
  name: string
  command: string
}

interface RunManifest {
  manifestVersion: number
  kind: string
  status: string
  acceptanceContract: string
  acceptanceContractSha256: string
  branch: string
  baseCommit: string
  sourceBinding: Record<string, unknown>
  evidence: Record<string, unknown>
  attestation: Record<string, unknown>
}

interface WorkflowStep {
  name?: string
  uses?: string
  run?: string
  if?: string
  with?: Record<string, unknown>
}

interface WorkflowJob {
  'runs-on'?: string
  permissions?: Record<string, string>
  needs?: string[]
  steps?: WorkflowStep[]
}

interface Workflow {
  on?: {
    pull_request?: { branches?: string[] }
    push?: { branches?: string[] }
  }
  permissions?: Record<string, string>
  jobs?: Record<string, WorkflowJob>
}

const repoRoot = resolve(fileURLToPath(new URL('../../../../', import.meta.url)))
const appRoot = join(repoRoot, 'app-v2')
const acceptancePath = join(repoRoot, 'docs', 'phase02', 'stint-passport-v2-acceptance-contract.json')
const manifestPath = join(repoRoot, 'docs', 'phase02', 'stint-passport-v2-run-manifest.json')
const generatorPath = join(repoRoot, 'scripts', 'generate-passport-v2-run-manifest.mjs')
const contractVerifierPath = join(repoRoot, 'scripts', 'verify-phase02-contracts.mjs')
const workerVerifierPath = join(appRoot, 'scripts', 'verify-passport-worker.mjs')
const ciPath = join(repoRoot, '.github', 'workflows', 'ci.yml')
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function manifest(): RunManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as RunManifest
}

function git(...args: string[]): string {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    windowsHide: true
  })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout.trim()
}

function evidenceCommands(evidence: Record<string, unknown>): EvidenceCommand[] {
  return Object.entries(evidence).flatMap(([name, value]) => {
    if (!value || typeof value !== 'object') return []
    const command = (value as Record<string, unknown>).command
    return typeof command === 'string' ? [{ name, command }] : []
  })
}

function selectorsFrom(command: string): string[] {
  return command.match(/[A-Za-z0-9_./\\-]+\.test\.tsx?/g) ?? []
}

function testCountFromVitestList(stdout: string): { files: number; tests: number } {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return {
    tests: lines.length,
    files: new Set(lines.map((line) => line.split(' > ', 1)[0])).size
  }
}

function step(job: WorkflowJob | undefined, name: string): WorkflowStep | undefined {
  return job?.steps?.find((candidate) => candidate.name === name)
}

function makeTempRoot(prefix: string, insideCheckout = false): string {
  void insideCheckout
  const directory = mkdtempSync(join(repoRoot, prefix))
  temporaryDirectories.push(directory)
  return directory
}

function installGeneratorCopy(): { root: string; script: string; output: string } {
  const root = makeTempRoot('.passport-evidence-generator-', true)
  const script = join(root, 'scripts', 'generate-passport-v2-run-manifest.mjs')
  const contract = join(root, 'docs', 'phase02', 'stint-passport-v2-acceptance-contract.json')
  const plan = join(root, 'docs', 'phase02', 'stint-passport-v2-run-manifest.json')
  mkdirSync(dirname(script), { recursive: true })
  mkdirSync(dirname(contract), { recursive: true })
  cpSync(generatorPath, script)
  cpSync(acceptancePath, contract)
  cpSync(manifestPath, plan)
  return {
    root,
    script,
    output: join(root, 'artifacts', 'stint-passport-v2', 'stint-passport-v2-run-manifest.json')
  }
}

function installContractVerifierHarness(): { root: string; script: string } {
  const root = makeTempRoot('passport-contract-verifier-')
  const script = join(root, 'scripts', 'verify-phase02-contracts.mjs')
  const fakeChildProcess = join(root, 'scripts', 'fake-child-process.mjs')
  const generatedRoot = join(root, 'app-v2', 'src', 'main', 'phase02', 'generated')
  mkdirSync(dirname(script), { recursive: true })
  mkdirSync(generatedRoot, { recursive: true })
  cpSync(join(repoRoot, 'contracts'), join(root, 'contracts'), { recursive: true })
  cpSync(
    join(appRoot, 'src', 'main', 'phase02', 'generated', 'contract-descriptor.ts'),
    join(generatedRoot, 'contract-descriptor.ts')
  )
  cpSync(
    join(appRoot, 'src', 'main', 'phase02', 'generated', 'n1-contract-descriptor.ts'),
    join(generatedRoot, 'n1-contract-descriptor.ts')
  )

  const verifierSource = readFileSync(contractVerifierPath, 'utf8')
  const instrumented = verifierSource.replace(
    "from 'node:child_process'",
    "from './fake-child-process.mjs'"
  )
  expect(instrumented).not.toBe(verifierSource)
  writeFileSync(script, instrumented)
  writeFileSync(fakeChildProcess, `
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const result = (status, stdout = '', stderr = '') => ({ status, stdout, stderr })
const descriptorJson = {
  file: [
    {
      name: 'ultimate/sim/raceops/v1/race_ops_event.proto',
      messageType: [{
        name: 'RaceOpsEvent',
        field: ['consent_epoch', 'sequence', 'partition_seq', 'source_tick', 'observed_monotonic_ns', 'ttl_ms']
          .map((name) => ({ name, type: 'TYPE_UINT64' }))
      }]
    },
    {
      name: 'ultimate/sim/raceops/v1/stint_passport.proto',
      messageType: ['PassportOwner', 'PassportRosterMember', 'PassportItemEvidence', 'PassportItem',
        'StintIdentity', 'StintPassport', 'PassportEvent'].map((name) => ({ name })),
      enumType: [{
        name: 'PassportItemId',
        value: Array.from({ length: 13 }, (_, number) => ({ number }))
      }]
    }
  ]
}

export function spawnSync(_command, args, options = {}) {
  const root = options.cwd
  if (args[0] === 'lint') return result(0)
  if (args[0] === 'build') {
    const output = args[args.indexOf('--output') + 1]
    if (output.endsWith('.json')) {
      writeFileSync(output, JSON.stringify(descriptorJson))
    } else {
      const n1 = String(args[1]).includes('n-1')
      const sourcePath = join(root, 'app-v2', 'src', 'main', 'phase02', 'generated',
        n1 ? 'n1-contract-descriptor.ts' : 'contract-descriptor.ts')
      const source = readFileSync(sourcePath, 'utf8')
      const prefix = n1 ? 'PHASE02_N1' : 'PHASE02'
      const base64 = source.match(new RegExp(prefix + "_DESCRIPTOR_BASE64 = '([A-Za-z0-9+/=]+)'"))?.[1]
      if (!base64) return result(1, '', 'descriptor constant missing')
      writeFileSync(output, Buffer.from(base64, 'base64'))
    }
    return result(0)
  }
  if (args[0] === 'breaking') {
    if (process.env.FAKE_BREAKING_ACCEPT === '1') return result(0)
    return result(1, '', [
      'Field "2" on message "RaceOpsEvent" changed type from "enum" to "string"',
      'Field "2" on message "RaceOpsEvent" changed name from "event_class" to "legacy_event_class"'
    ].join('\\n'))
  }
  return result(1, '', 'unexpected fake Buf invocation: ' + args.join(' '))
}
`)
  return { root, script }
}

function runNode(script: string, cwd: string, env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(process.execPath, [script], {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  })
}

describe('Stint Passport independently verifiable acceptance evidence', () => {
  it('[supported] recomputes the acceptance-contract SHA-256 bound by the manifest', () => {
    const current = manifest()
    const contractBytes = readFileSync(join(repoRoot, current.acceptanceContract))

    expect(current.acceptanceContract).toBe(
      'docs/phase02/stint-passport-v2-acceptance-contract.json'
    )
    expect(sha256(contractBytes)).toBe(current.acceptanceContractSha256)
    expect(JSON.parse(contractBytes.toString('utf8')).id).toBe('AC-PASSPORT-V2')
  })

  it('defers immutable source binding to CI instead of checking in a stale self-reference', () => {
    const current = manifest()

    expect(current).toMatchObject({
      manifestVersion: 2,
      kind: 'acceptance-plan',
      status: 'pending-ci-attestation',
      sourceBinding: {
        mode: 'ci-runtime',
        commit: 'resolved-from-GITHUB_SHA',
        tree: 'resolved-from-git-at-runtime'
      }
    })
    const sourceBranch = process.env.GITHUB_HEAD_REF?.trim() || git('branch', '--show-current')
    if (sourceBranch) {
      expect.soft(current.branch).toBe(sourceBranch)
    } else {
      expect.soft(current.branch).toMatch(/^[A-Za-z0-9._/-]+$/)
    }
    expect(current.baseCommit).toMatch(/^[0-9a-f]{40}$/)
    expect(current).not.toHaveProperty('implementationHead')
    expect(current).not.toHaveProperty('implementationTree')
  })

  it('[spec-gap] provides exact executable commands and an enumerated targeted selector list', () => {
    const commands = evidenceCommands(manifest().evidence)
    const names = commands.map(({ name }) => name).sort()
    const targeted = commands.find(({ name }) => name === 'targetedTests')
    const selectors = selectorsFrom(targeted?.command ?? '')

    expect.soft(names).toEqual(['build', 'contracts', 'targetedTests', 'typecheck'])
    for (const { command } of commands) {
      expect.soft(command, command).not.toMatch(/<[^>]+>|\btargeted selectors\b/i)
    }
    for (const value of Object.values(manifest().evidence)) {
      expect((value as Record<string, unknown>).status).toBe('required')
    }
    expect.soft(selectors.length).toBeGreaterThan(0)
    for (const selector of selectors) {
      expect.soft(existsSync(join(appRoot, selector)), selector).toBe(true)
    }
  })

  it('[spec-gap] independently executes Vitest discovery and matches claimed targeted counts', () => {
    const targeted = manifest().evidence.targetedTests as Record<string, unknown>
    const selectors = selectorsFrom(typeof targeted.command === 'string' ? targeted.command : '')
    const executableSelectors = selectors.length > 0
      ? selectors
      : ['src/main/passport/acceptance-evidence.test.ts']
    const vitestEntry = join(appRoot, 'node_modules', 'vitest', 'vitest.mjs')
    const listed = spawnSync(process.execPath, [vitestEntry, 'list', ...executableSelectors], {
      cwd: appRoot,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024
    })
    const discovered = testCountFromVitestList(listed.stdout)

    expect.soft(listed.status, listed.stderr).toBe(0)
    expect.soft(selectors.length, 'the evidence must enumerate its selectors').toBeGreaterThan(0)
    expect.soft(discovered.tests).toBe(targeted.tests)
    expect.soft(discovered.files).toBe(targeted.files)
  }, 30_000)

  it('[supported] CI independently runs the complete pinned acceptance command set on PR and main', () => {
    const workflow = parseYaml(readFileSync(ciPath, 'utf8')) as Workflow
    const contracts = workflow.jobs?.contracts
    const app = workflow.jobs?.app
    const acceptance = workflow.jobs?.['passport-acceptance']
    const packageJson = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(workflow.on?.pull_request?.branches).toEqual(['main'])
    expect(workflow.on?.push?.branches).toEqual(['main'])
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(step(contracts, 'Setup Node.js')?.with?.['node-version']).toBe(24)
    expect(step(contracts, 'Setup Buf')?.with?.version).toBe('1.71.0')
    expect(step(contracts, 'Setup Buf')?.with?.checksum).toBe(
      'd3de2838c68a5759ca276884254bc70df4e4ad185d6ed5f65f327b6ce6363eab'
    )
    expect(step(contracts, 'Verify Phase 02 contracts')?.run).toBe(
      'node scripts/verify-phase02-contracts.mjs'
    )
    expect(app?.['runs-on']).toBe('windows-latest')
    expect(step(app, 'Setup Node.js')?.with?.['node-version']).toBe(24)
    expect(step(app, 'Install dependencies')?.run).toBe(
      'npm ci --ignore-scripts --no-audit --no-fund'
    )
    expect(step(app, 'Typecheck')?.run).toBe('npm run typecheck')
    expect(step(app, 'Test')?.run).toBe('npm test')
    expect(step(app, 'Build')?.run).toBe('npm run build')
    expect(acceptance?.['runs-on']).toBe('windows-latest')
    expect(acceptance?.needs).toEqual(['contracts', 'app'])
    expect(step(acceptance, 'Setup Buf')?.with).toMatchObject({
      version: '1.71.0',
      checksum: 'b003ead3eebe7920a4e6f748fdf5b666e4763637a7fb1837c975ac9c5d21d558'
    })
    expect(acceptance?.permissions).toEqual({
      contents: 'read',
      'id-token': 'write',
      attestations: 'write'
    })
    expect(step(acceptance, 'Run source-bound acceptance')?.run).toBe(
      'node scripts/run-passport-v2-acceptance.mjs'
    )
    expect(step(acceptance, 'Generate runtime evidence')?.run).toBe(
      'node scripts/generate-passport-v2-run-manifest.mjs'
    )
    expect(step(acceptance, 'Upload acceptance evidence')?.uses).toBe(
      'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02'
    )
    expect(step(acceptance, 'Attest runtime evidence')).toMatchObject({
      uses: 'actions/attest-build-provenance@43d14bc2b83dec42d39ecae14e916627a18bb661',
      if: "github.event_name == 'push' && github.ref == 'refs/heads/main'"
    })
    expect(packageJson.scripts.build).toContain('node scripts/verify-passport-worker.mjs')
    for (const job of [contracts, app, acceptance]) {
      for (const candidate of job?.steps ?? []) {
        if (candidate.uses && !candidate.uses.startsWith('./')) {
          expect(candidate.uses).toMatch(/@[0-9a-f]{40}$/i)
        }
      }
    }
  })

  it('requires an external GitHub OIDC attestation and never treats source JSON as a signature', () => {
    const current = manifest()
    const generator = readFileSync(generatorPath, 'utf8')

    expect(current.attestation).toEqual({
      status: 'required-on-main',
      provider: 'github-artifact-attestations',
      issuer: 'https://token.actions.githubusercontent.com',
      workflow: '.github/workflows/ci.yml',
      job: 'passport-acceptance',
      subject: 'artifacts/stint-passport-v2/stint-passport-v2-run-manifest.json',
      verificationCommand:
        'gh attestation verify stint-passport-v2-run-manifest.json --repo $GITHUB_REPOSITORY'
    })
    expect(generator).toContain("process.env.GITHUB_ACTIONS !== 'true'")
    expect(generator).toContain("process.env.GITHUB_JOB !== 'passport-acceptance'")
    expect(generator).not.toContain('PASSPORT_V2_EVIDENCE_JSON')
    expect(JSON.stringify(current)).not.toMatch(/self-issued|\"signature\"/i)
  })

  it('[spec-gap] rejects arbitrary self-issued success JSON in a temp-copy generator execution', () => {
    const copy = installGeneratorCopy()
    const forgedEvidence = {
      targetedTests: {
        status: 'passed',
        tests: 999_999,
        files: 1,
        command: 'node -e "process.exit(0)"'
      },
      provenance: {
        issuer: 'author',
        signature: 'self-issued'
      }
    }
    const executed = runNode(copy.script, copy.root, {
      ...process.env,
      PASSPORT_V2_EVIDENCE_JSON: JSON.stringify(forgedEvidence)
    })

    expect.soft(executed.status, executed.stderr).not.toBe(0)
    expect.soft(existsSync(copy.output)).toBe(false)
    if (existsSync(copy.output)) {
      expect.soft((JSON.parse(readFileSync(copy.output, 'utf8')) as RunManifest).evidence)
        .not.toEqual(forgedEvidence)
    }
  })

  it('generates hash-bound runtime evidence in CI but leaves signature issuance external', () => {
    const copy = installGeneratorCopy()
    const planPath = join(copy.root, 'docs', 'phase02', 'stint-passport-v2-run-manifest.json')
    const contractPath = join(copy.root, 'docs', 'phase02', 'stint-passport-v2-acceptance-contract.json')
    const resultsPath = join(copy.root, 'artifacts', 'stint-passport-v2', 'acceptance-results.json')
    const logPath = join(copy.root, 'artifacts', 'stint-passport-v2', 'acceptance.log')
    const planBytes = readFileSync(planPath)
    const plan = JSON.parse(planBytes.toString('utf8')) as RunManifest
    const log = 'source-bound acceptance log\n'
    const evidence = Object.fromEntries(
      Object.entries(plan.evidence).map(([name, value]) => [
        name,
        {
          status: 'passed',
          command: (value as Record<string, unknown>).command,
          exitCode: 0,
          startedAt: '2026-01-01T00:00:00.000Z',
          finishedAt: '2026-01-01T00:00:01.000Z',
          logSha256: sha256(`${name}\n`)
        }
      ])
    )
    mkdirSync(dirname(resultsPath), { recursive: true })
    writeFileSync(logPath, log)
    writeFileSync(resultsPath, JSON.stringify({
      schemaVersion: 1,
      source: {
        commitSha: git('rev-parse', 'HEAD'),
        treeSha: git('rev-parse', 'HEAD^{tree}'),
        branch: git('branch', '--show-current')
      },
      acceptancePlanSha256: sha256(planBytes),
      acceptanceContractSha256: sha256(readFileSync(contractPath)),
      discovery: {
        tests: (plan.evidence.targetedTests as Record<string, unknown>).tests,
        files: (plan.evidence.targetedTests as Record<string, unknown>).files
      },
      evidence,
      combinedLogSha256: sha256(log)
    }))

    const generated = runNode(copy.script, copy.root, {
      ...process.env,
      GITHUB_ACTIONS: 'true',
      GITHUB_JOB: 'passport-acceptance',
      GITHUB_SHA: git('rev-parse', 'HEAD'),
      GITHUB_RUN_ID: '12345',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_REPOSITORY: 'ultimate-sim/app',
      GITHUB_WORKFLOW: 'CI',
      GITHUB_REF: 'refs/heads/main'
    })
    const runtime = JSON.parse(readFileSync(copy.output, 'utf8')) as Record<string, unknown>

    expect(generated.status, generated.stderr).toBe(0)
    expect(runtime).toMatchObject({
      kind: 'ci-runtime-evidence',
      status: 'passed-awaiting-external-attestation',
      source: {
        commitSha: git('rev-parse', 'HEAD'),
        treeSha: git('rev-parse', 'HEAD^{tree}')
      },
      provenance: {
        issuer: 'https://token.actions.githubusercontent.com',
        runId: '12345',
        jobId: 'passport-acceptance'
      },
      attestation: {
        provider: 'github-artifact-attestations',
        state: 'awaiting-external-signature'
      }
    })
    expect(JSON.stringify(runtime)).not.toMatch(/\"signature\"/)
  }, 15_000)

  it('[supported] contract verification binds hashes and rejects the negative field-reuse fixture', () => {
    const harness = installContractVerifierHarness()
    const verified = runNode(harness.script, harness.root, {
      ...process.env,
      CONTRACT_BASE_REF: '',
      FAKE_BREAKING_ACCEPT: ''
    })
    const evidence = JSON.parse(verified.stdout.trim()) as Record<string, unknown>

    expect(verified.status, verified.stderr).toBe(0)
    expect(evidence.breakingFixtureRejected).toBe(true)
    expect(evidence.passportItems).toBe(12)
    expect(evidence.descriptorSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(evidence.n1DescriptorSha256).toMatch(/^[0-9a-f]{64}$/)

    const jsonGolden = join(
      harness.root,
      'contracts',
      'testdata',
      'race-ops-event-v1.json'
    )
    writeFileSync(
      jsonGolden,
      readFileSync(jsonGolden, 'utf8').replace(/\r?\n/g, '\r\n'),
      'utf8'
    )
    const crlfVerified = runNode(harness.script, harness.root, {
      ...process.env,
      CONTRACT_BASE_REF: '',
      FAKE_BREAKING_ACCEPT: ''
    })
    expect(crlfVerified.status, crlfVerified.stderr).toBe(0)

    const falseNegative = runNode(harness.script, harness.root, {
      ...process.env,
      CONTRACT_BASE_REF: '',
      FAKE_BREAKING_ACCEPT: '1'
    })
    expect(falseNegative.status).not.toBe(0)
    expect(falseNegative.stderr).toContain('unexpectedly succeeded')

    const golden = join(harness.root, 'contracts', 'testdata', 'stint-passport-v1.binpb')
    writeFileSync(golden, Buffer.concat([readFileSync(golden), Buffer.from([0])]))
    const tampered = runNode(harness.script, harness.root, {
      ...process.env,
      CONTRACT_BASE_REF: '',
      FAKE_BREAKING_ACCEPT: ''
    })
    expect(tampered.status).not.toBe(0)
    expect(tampered.stderr).toContain('golden binary hash mismatch')
  }, 15_000)

  it('[spec-gap] worker evidence executes crash, recovery, drain, and commit-boundary proofs', async () => {
    const fixture = await buildPassportWorkerTestFixture('acceptance')
    try {
      const executed = runNode(workerVerifierPath, appRoot, {
        ...process.env,
        PASSPORT_WORKER_FIXTURE: fixture.entry
      })
      let evidence: Record<string, unknown> = {}
      if (executed.status === 0) {
        evidence = JSON.parse(executed.stdout.trim()) as Record<string, unknown>
      }
      const proofs = Array.isArray(evidence.proofs) ? evidence.proofs : []

      expect.soft(executed.status, executed.stderr).toBe(0)
      expect.soft(evidence.packaged).toBe(false)
      expect.soft(evidence.smoke).toBe(true)
      expect(proofs).toEqual(expect.arrayContaining([
        'real-crash',
        'recovery',
        'drain',
        'commit-boundary'
      ]))
    } finally {
      fixture.cleanup()
    }
  }, 30_000)
})
