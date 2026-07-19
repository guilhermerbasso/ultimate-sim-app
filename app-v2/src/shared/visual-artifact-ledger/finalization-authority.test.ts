import {
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { describe, expect, it } from 'vitest'
import type {
  LedgerFinalizationOperation,
  OpaqueAttestation
} from './authorities'
import { canonicalStringify, sha256Hex } from './canonical'
import {
  DurableLedgerFinalizationAuthority,
  computeLedgerFinalizationOperationHash,
  type LedgerFinalizationCommitBinding
} from './finalization-authority'

function hash(value: number): string {
  return value.toString(16).padStart(64, '0')
}

function operation(
  authorityId: string,
  offset = 0
): LedgerFinalizationOperation {
  const expectedLedgerSequence = 149_400
  const planHash = hash(20)
  const trustedCheckpointEventHash = hash(50 + offset)
  const expectedLedgerRootHash = sha256Hex({
    domain: 'visual-artifact-ledger-root-v2',
    planHash,
    sequence: expectedLedgerSequence,
    lastEventHash: trustedCheckpointEventHash
  })
  const withoutHash = {
    authorityId,
    expectedLedgerSequence,
    expectedLedgerRootHash,
    planHash,
    registryHash: hash(30),
    artifactCount: 16_600,
    artifactSetHash: hash(40),
    occurredAt: new Date(
      Date.parse('2026-01-01T00:00:00.000Z') + offset
    ).toISOString(),
    actorId: offset === 0 ? 'release-owner-a' : 'release-owner-b',
    trustedCheckpointSequence: expectedLedgerSequence,
    trustedCheckpointEventHash,
    trustedCheckpointRootHash: expectedLedgerRootHash,
    trustedCheckpointAttestation: {
      token: `checkpoint:${hash(60 + offset)}`.slice(0, 88)
    },
    principalAttestation: {
      token: `principal:${hash(70 + offset)}`.slice(0, 88)
    }
  }
  return {
    ...withoutHash,
    operationHash: computeLedgerFinalizationOperationHash(withoutHash)
  }
}

function rehashOperation(
  value: LedgerFinalizationOperation
): LedgerFinalizationOperation {
  const { operationHash: _operationHash, ...withoutHash } = value
  return {
    ...withoutHash,
    operationHash: computeLedgerFinalizationOperationHash(withoutHash)
  }
}

function authority(
  directoryPath: string,
  authorityId = 'durable-ledger-finalization'
): DurableLedgerFinalizationAuthority {
  const issue = (
    binding: LedgerFinalizationCommitBinding
  ): OpaqueAttestation => ({
    token: `final:${sha256Hex({
      domain: 'test-durable-finalization-attestation',
      secret: 'test-only-secret',
      binding
    })}`.padEnd(88, 'x')
  })
  return new DurableLedgerFinalizationAuthority({
    authorityId,
    directoryPath,
    issueCommitAttestation: issue,
    verifyCommitAttestation: (attestation, binding) =>
      attestation.token === issue(binding).token
  })
}

function runWorker(
  workerPath: string,
  input: LedgerFinalizationOperation
): Promise<{ ok: boolean; message?: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, JSON.stringify(input)], {
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Finalization worker failed (${code}): ${stderr}`))
        return
      }
      resolve(JSON.parse(stdout) as { ok: boolean; message?: string })
    })
  })
}

describe('durable ledger finalization authority', () => {
  it('converges cross-instance CAS races and restart recovery on one head', () => {
    const directory = mkdtempSync(
      join(process.cwd(), '.visual-ledger-finalization-test-')
    )
    try {
      const first = authority(directory)
      const second = authority(directory)
      const winningOperation = operation(first.authorityId)
      const competingOperation = operation(first.authorityId, 1)

      expect(() =>
        first.commit(
          rehashOperation({
            ...winningOperation,
            artifactCount: 14_850
          })
        )
      ).toThrow(/exactly 16600 artifacts/i)
      expect(() =>
        first.commit(
          rehashOperation({
            ...winningOperation,
            trustedCheckpointSequence:
              winningOperation.trustedCheckpointSequence - 1
          })
        )
      ).toThrow(/checkpoint must fence the exact committed head/i)

      const commit = first.commit(winningOperation)
      expect(() => second.commit(competingOperation)).toThrow(
        /stale shared ledger finalization CAS/i
      )
      expect(second.current(winningOperation.planHash)).toEqual({
        operation: winningOperation,
        commit
      })
      expect(second.commit(winningOperation)).toEqual(commit)
      expect(second.recover(winningOperation)).toEqual(commit)

      const restarted = authority(directory)
      expect(restarted.current(winningOperation.planHash)).toEqual({
        operation: winningOperation,
        commit
      })
      expect(
        readdirSync(directory).filter((name) =>
          name.endsWith('.finalization.json')
        )
      ).toHaveLength(1)
      expect(
        readdirSync(directory).filter((name) =>
          name.endsWith('.finalization.tmp')
        )
      ).toHaveLength(0)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('allows only one winner across concurrently committing processes', async () => {
    const directory = mkdtempSync(
      join(process.cwd(), '.visual-ledger-finalization-test-')
    )
    try {
      const moduleDirectory = dirname(fileURLToPath(import.meta.url))
      const workerPath = join(directory, 'finalization-race-worker.mjs')
      buildSync({
        stdin: {
          contents: `
            import { DurableLedgerFinalizationAuthority } from './finalization-authority.ts'
            import { sha256Hex } from './canonical.ts'
            const directoryPath = ${JSON.stringify(directory)}
            const authorityId = 'durable-ledger-finalization'
            const issue = (binding) => ({
              token: ('final:' + sha256Hex({
                domain: 'test-durable-finalization-attestation',
                secret: 'test-only-secret',
                binding
              })).padEnd(88, 'x')
            })
            const authority = new DurableLedgerFinalizationAuthority({
              authorityId,
              directoryPath,
              issueCommitAttestation: issue,
              verifyCommitAttestation: (attestation, binding) =>
                attestation.token === issue(binding).token
            })
            const operation = JSON.parse(process.argv[2])
            try {
              authority.commit(operation)
              process.stdout.write(JSON.stringify({ ok: true }))
            } catch (error) {
              process.stdout.write(JSON.stringify({
                ok: false,
                message: error instanceof Error ? error.message : String(error)
              }))
            }
          `,
          resolveDir: moduleDirectory,
          sourcefile: 'finalization-race-worker.ts',
          loader: 'ts'
        },
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node24',
        outfile: workerPath,
        logLevel: 'silent'
      })
      const firstOperation = operation('durable-ledger-finalization')
      const secondOperation = operation(
        'durable-ledger-finalization',
        1
      )
      const results = await Promise.all([
        runWorker(workerPath, firstOperation),
        runWorker(workerPath, secondOperation)
      ])
      expect(results.filter((result) => result.ok)).toHaveLength(1)
      expect(
        results.find((result) => !result.ok)?.message
      ).toMatch(/stale shared ledger finalization CAS/i)

      const restarted = authority(directory)
      const record = restarted.current(firstOperation.planHash)
      expect([
        firstOperation.operationHash,
        secondOperation.operationHash
      ]).toContain(record?.operation.operationHash)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('fails closed on non-canonical or corrupted durable state', () => {
    const directory = mkdtempSync(
      join(process.cwd(), '.visual-ledger-finalization-test-')
    )
    try {
      const subject = authority(directory)
      const input = operation(subject.authorityId)
      const commit = subject.commit(input)
      const path = join(directory, `${input.planHash}.finalization.json`)
      writeFileSync(
        path,
        `${canonicalStringify({ operation: input, commit })}\n`,
        'utf8'
      )
      expect(() => authority(directory).current(input.planHash)).toThrow(
        /not canonical/i
      )
      writeFileSync(path, 'x'.repeat(64 * 1024 + 1), 'utf8')
      expect(() => authority(directory).current(input.planHash)).toThrow(
        /exceeds 65536 bytes/i
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
