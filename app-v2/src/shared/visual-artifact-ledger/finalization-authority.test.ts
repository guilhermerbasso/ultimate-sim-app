import { mkdtempSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { describe, expect, it } from 'vitest'
import type {
  LedgerAppendAuthorityCommit,
  LedgerAppendOperation,
  LedgerFinalizationAuthorityCommit,
  LedgerFinalizationOperation,
  LedgerPublicationHead,
  OpaqueAttestation
} from './authorities'
import { canonicalStringify, sha256Hex } from './canonical'
import {
  DurableLedgerFinalizationAuthority,
  computeLedgerAppendOperationHash,
  computeLedgerFinalizationOperationHash,
  computeLedgerPublicationAuthorityRootHash,
  type LedgerAuthorityCommitBinding,
  type LedgerAuthorityFaultPoint
} from './finalization-authority'
import { ZERO_HASH } from './constants'

const AUTHORITY_ID = 'durable-ledger-publication'

function hash(value: number): string {
  return value.toString(16).padStart(64, '0')
}

function ledgerRoot(
  planHash: string,
  sequence: number,
  eventHash: string
): string {
  return sha256Hex({
    domain: 'visual-artifact-ledger-root-v2',
    planHash,
    sequence,
    lastEventHash: eventHash
  })
}

function issue(binding: LedgerAuthorityCommitBinding): OpaqueAttestation {
  return {
    token: `ledger:${sha256Hex({
      domain: 'test-durable-publication-attestation',
      secret: 'test-only-secret',
      binding
    })}`.padEnd(88, 'x')
  }
}

function authority(
  directoryPath: string,
  faultPoint?: LedgerAuthorityFaultPoint
): DurableLedgerFinalizationAuthority {
  return new DurableLedgerFinalizationAuthority({
    authorityId: AUTHORITY_ID,
    directoryPath,
    issueCommitAttestation: issue,
    verifyCommitAttestation: (attestation, binding) =>
      attestation.token === issue(binding).token,
    ...(faultPoint === undefined
      ? {}
      : {
          faultInjector: (fault: {
            point: LedgerAuthorityFaultPoint
          }) => {
            if (fault.point === faultPoint) {
              throw new Error(`simulated ${faultPoint} power loss`)
            }
          }
        })
  })
}

function authorityDatabase(
  subject: DurableLedgerFinalizationAuthority
): DatabaseSync {
  return (
    subject as unknown as {
      database: DatabaseSync
    }
  ).database
}

function forceRollbackError(subject: DurableLedgerFinalizationAuthority): {
  readonly database: DatabaseSync
  observedInTransaction(): boolean | undefined
} {
  const database = authorityDatabase(subject)
  const originalExec = database.exec
  let observedInTransaction: boolean | undefined
  Object.defineProperty(database, 'exec', {
    configurable: true,
    value: (sql: string): void => {
      if (sql.trim().toUpperCase() === 'ROLLBACK') {
        observedInTransaction = database.isTransaction
        throw new Error('forced SQLite ROLLBACK failure')
      }
      Reflect.apply(originalExec, database, [sql])
    }
  })
  return {
    database,
    observedInTransaction: () => observedInTransaction
  }
}

function forceRollbackWithoutAutocommit(
  subject: DurableLedgerFinalizationAuthority
): {
  readonly database: DatabaseSync
  observedInTransaction(): boolean | undefined
} {
  const database = authorityDatabase(subject)
  const originalExec = database.exec
  let observedInTransaction: boolean | undefined
  Object.defineProperty(database, 'exec', {
    configurable: true,
    value: (sql: string): void => {
      if (sql.trim().toUpperCase() === 'ROLLBACK') {
        observedInTransaction = database.isTransaction
        return
      }
      Reflect.apply(originalExec, database, [sql])
    }
  })
  return {
    database,
    observedInTransaction: () => observedInTransaction
  }
}

function forceCommittedResponseLoss(
  subject: DurableLedgerFinalizationAuthority
): {
  readonly database: DatabaseSync
  rollbackObservedInTransaction(): boolean | undefined
} {
  const database = authorityDatabase(subject)
  const originalExec = database.exec
  let loseCommitResponse = true
  let rollbackObservedInTransaction: boolean | undefined
  Object.defineProperty(database, 'exec', {
    configurable: true,
    value: (sql: string): void => {
      const statement = sql.trim().toUpperCase()
      if (statement === 'COMMIT' && loseCommitResponse) {
        loseCommitResponse = false
        Reflect.apply(originalExec, database, [sql])
        throw new Error('forced SQLite COMMIT response loss')
      }
      if (statement === 'ROLLBACK') {
        rollbackObservedInTransaction = database.isTransaction
      }
      Reflect.apply(originalExec, database, [sql])
    }
  })
  return {
    database,
    rollbackObservedInTransaction: () => rollbackObservedInTransaction
  }
}

function event(
  planHash: string,
  sequence: number,
  previousEventHash: string,
  offset = 0
): Record<string, unknown> {
  const withoutHash = {
    sequence,
    type: 'artifact-revision-started',
    occurredAt: new Date(
      Date.parse('2026-01-01T00:00:00.000Z') + sequence + offset
    ).toISOString(),
    actorId: 'planner',
    principalAttestation: {
      token: `principal:${hash(100 + offset)}`.slice(0, 88)
    },
    previousEventHash,
    artifactId: `trigger-family-${offset + 1}:trigger`,
    revision: 1,
    specificationHash: hash(200 + offset),
    planHash
  }
  return {
    ...withoutHash,
    eventHash: sha256Hex({
      domain: 'visual-artifact-event-v2',
      event: withoutHash
    })
  }
}

function appendOperation(
  head?: LedgerPublicationHead,
  offset = 0
): LedgerAppendOperation {
  const planHash = head?.planHash ?? hash(20)
  const registryHash = head?.registryHash ?? hash(30)
  const expectedLedgerSequence = head?.ledgerSequence ?? 0
  const expectedLedgerEventHash = head?.ledgerEventHash ?? ZERO_HASH
  const expectedLedgerRootHash =
    head?.ledgerRootHash ??
    ledgerRoot(planHash, expectedLedgerSequence, expectedLedgerEventHash)
  const nextEvent = event(
    planHash,
    expectedLedgerSequence + 1,
    expectedLedgerEventHash,
    offset
  )
  const nextLedgerEventHash = nextEvent.eventHash as string
  const withoutHash = {
    authorityId: AUTHORITY_ID,
    expectedLedgerSequence,
    expectedLedgerRootHash,
    expectedLedgerEventHash,
    expectedAcceptedArtifactCount: head?.acceptedArtifactCount ?? 0,
    planHash,
    registryHash,
    nextLedgerSequence: expectedLedgerSequence + 1,
    nextLedgerRootHash: ledgerRoot(
      planHash,
      expectedLedgerSequence + 1,
      nextLedgerEventHash
    ),
    nextLedgerEventHash,
    nextAcceptedArtifactCount: head?.acceptedArtifactCount ?? 0,
    event: nextEvent
  }
  return {
    ...withoutHash,
    operationHash: computeLedgerAppendOperationHash(withoutHash)
  }
}

interface CertifiedSeed {
  readonly head: LedgerPublicationHead
  readonly operation: LedgerAppendOperation
  readonly commit: LedgerAppendAuthorityCommit
}

function certifiedSeed(offset = 0): CertifiedSeed {
  const planHash = hash(20 + offset)
  const prior: LedgerPublicationHead = {
    authorityId: AUTHORITY_ID,
    planHash,
    registryHash: hash(30 + offset),
    ledgerSequence: 149_399,
    ledgerRootHash: ledgerRoot(planHash, 149_399, hash(50 + offset)),
    ledgerEventHash: hash(50 + offset),
    acceptedArtifactCount: 16_600,
    authorityRootHash: hash(80 + offset),
    finalized: false
  }
  const operation = appendOperation(prior, offset)
  const unsigned = {
    authorityId: AUTHORITY_ID,
    version: 1 as const,
    committedAt: (operation.event as { occurredAt: string }).occurredAt,
    previousRootHash: prior.authorityRootHash,
    rootHash: ZERO_HASH,
    operationHash: operation.operationHash
  }
  const binding = {
    ...unsigned,
    rootHash: computeLedgerPublicationAuthorityRootHash('append', unsigned)
  }
  const commit = {
    ...binding,
    attestation: issue(binding)
  }
  return {
    operation,
    commit,
    head: {
      authorityId: AUTHORITY_ID,
      planHash,
      registryHash: prior.registryHash,
      ledgerSequence: operation.nextLedgerSequence,
      ledgerRootHash: operation.nextLedgerRootHash,
      ledgerEventHash: operation.nextLedgerEventHash,
      acceptedArtifactCount: operation.nextAcceptedArtifactCount,
      authorityRootHash: commit.rootHash,
      finalized: false
    }
  }
}

function seedHead(
  directoryPath: string,
  seed: CertifiedSeed
): void {
  const { head, operation, commit } = seed
  const initialized = authority(directoryPath)
  initialized.close()
  const database = new DatabaseSync(
    join(directoryPath, 'visual-artifact-ledger-authority.sqlite3')
  )
  try {
    database
      .prepare(`
        INSERT INTO ledger_heads(
          plan_hash, registry_hash, ledger_sequence, ledger_root_hash,
          ledger_event_hash, accepted_artifact_count, authority_root_hash,
          finalized, finalization_operation_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)
      `)
      .run(
        head.planHash,
        head.registryHash,
        head.ledgerSequence,
        head.ledgerRootHash,
        head.ledgerEventHash,
        head.acceptedArtifactCount,
        head.authorityRootHash
      )
    database
      .prepare(`
        INSERT INTO append_records(
          plan_hash, ledger_sequence, operation_hash, operation_json, commit_json
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        head.planHash,
        head.ledgerSequence,
        operation.operationHash,
        canonicalStringify(operation),
        canonicalStringify(commit)
      )
  } finally {
    database.close()
  }
}

function finalizationOperation(
  head: LedgerPublicationHead,
  offset = 0
): LedgerFinalizationOperation {
  const withoutHash = {
    authorityId: AUTHORITY_ID,
    expectedLedgerSequence: head.ledgerSequence,
    expectedLedgerRootHash: head.ledgerRootHash,
    planHash: head.planHash,
    registryHash: head.registryHash,
    artifactCount: 16_600,
    artifactSetHash: hash(40 + offset),
    occurredAt: new Date(
      Date.parse('2026-01-02T00:00:00.000Z') + offset
    ).toISOString(),
    actorId: offset === 0 ? 'release-owner-a' : 'release-owner-b',
    trustedCheckpointSequence: head.ledgerSequence,
    trustedCheckpointEventHash: head.ledgerEventHash,
    trustedCheckpointRootHash: head.ledgerRootHash,
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

function compileWorker(directoryPath: string): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url))
  const workerPath = join(directoryPath, 'publication-worker.mjs')
  buildSync({
    stdin: {
      contents: `
        import { DurableLedgerFinalizationAuthority } from './finalization-authority.ts'
        import { sha256Hex } from './canonical.ts'
        const input = JSON.parse(process.argv[2])
        const issue = (binding) => ({
          token: ('ledger:' + sha256Hex({
            domain: 'test-durable-publication-attestation',
            secret: 'test-only-secret',
            binding
          })).padEnd(88, 'x')
        })
        const authority = new DurableLedgerFinalizationAuthority({
          authorityId: ${JSON.stringify(AUTHORITY_ID)},
          directoryPath: input.directoryPath,
          issueCommitAttestation: issue,
          verifyCommitAttestation: (attestation, binding) =>
            attestation.token === issue(binding).token,
          ...(input.exitAt ? {
            faultInjector: (fault) => {
              if (fault.point === input.exitAt) process.exit(input.exitCode)
            }
          } : {})
        })
        try {
          const commit = input.kind === 'append'
            ? authority.commitAppend(input.operation)
            : authority.commit(input.operation)
          authority.close()
          process.stdout.write(JSON.stringify({ ok: true, commit }))
        } catch (error) {
          authority.close()
          process.stdout.write(JSON.stringify({
            ok: false,
            message: error instanceof Error ? error.message : String(error)
          }))
        }
      `,
      resolveDir: moduleDirectory,
      sourcefile: 'publication-worker.ts',
      loader: 'ts'
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    outfile: workerPath,
    logLevel: 'silent'
  })
  return workerPath
}

function runWorker(
  workerPath: string,
  input: Record<string, unknown>
): Promise<{
  code: number | null
  stdout: string
  stderr: string
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [workerPath, JSON.stringify(input)],
      { windowsHide: true }
    )
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
    child.once('exit', (code) => resolve({ code, stdout, stderr }))
  })
}

function parsedWorkerResult(result: {
  code: number | null
  stdout: string
  stderr: string
}): { ok: boolean; message?: string } {
  if (result.code !== 0) {
    throw new Error(`Publication worker failed (${result.code}): ${result.stderr}`)
  }
  return JSON.parse(result.stdout) as { ok: boolean; message?: string }
}

describe('durable shared ledger publication authority', () => {
  it('poisons a rollback-error connection and confirms absence only through a fresh connection', () => {
    const directory = mkdtempSync(
      join(process.cwd(), '.visual-ledger-publication-test-')
    )
    try {
      const subject = authority(directory, 'before-commit')
      const operation = appendOperation()
      const probe = forceRollbackError(subject)
      try {
        expect(() => subject.commitAppend(operation)).toThrow(
          /rollback failed or did not restore confirmed autocommit/i
        )
        expect(probe.observedInTransaction()).toBe(true)
        expect(probe.database.isOpen).toBe(false)
        expect(authorityDatabase(subject) === probe.database).toBe(false)
        expect(authorityDatabase(subject).isTransaction).toBe(false)
        expect(() => subject.head(operation.planHash)).toThrow(
          /exact fresh-connection recovery is required/i
        )
        expect(() => subject.recoverAppend(appendOperation(undefined, 1))).toThrow(
          /only for the exact failed operation/i
        )
        expect(subject.recoverAppend(operation)).toBeUndefined()
        expect(subject.head(operation.planHash)).toBeUndefined()
      } finally {
        subject.close()
      }

      const restarted = authority(directory)
      try {
        expect(restarted.head(operation.planHash)).toBeUndefined()
        expect(restarted.recoverAppend(operation)).toBeUndefined()
      } finally {
        restarted.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('does not recover an uncommitted finalization from a poisoned connection or restart', () => {
    const directory = mkdtempSync(
      join(process.cwd(), '.visual-ledger-publication-test-')
    )
    try {
      const seed = certifiedSeed()
      seedHead(directory, seed)
      const subject = authority(directory, 'before-commit')
      const operation = finalizationOperation(seed.head)
      const probe = forceRollbackError(subject)
      try {
        expect(() => subject.commit(operation)).toThrow(
          /rollback failed or did not restore confirmed autocommit/i
        )
        expect(probe.observedInTransaction()).toBe(true)
        expect(probe.database.isOpen).toBe(false)
        expect(() => subject.current(seed.head.planHash)).toThrow(
          /exact fresh-connection recovery is required/i
        )
        expect(subject.recover(operation)).toBeUndefined()
        expect(subject.current(seed.head.planHash)).toBeUndefined()
        expect(subject.head(seed.head.planHash)).toMatchObject({
          ledgerSequence: seed.head.ledgerSequence,
          finalized: false
        })
      } finally {
        subject.close()
      }

      const restarted = authority(directory)
      try {
        expect(restarted.current(seed.head.planHash)).toBeUndefined()
        expect(restarted.head(seed.head.planHash)).toMatchObject({
          ledgerSequence: seed.head.ledgerSequence,
          finalized: false
        })
      } finally {
        restarted.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('poisons a connection when rollback returns without restoring autocommit', () => {
    const directory = mkdtempSync(
      join(process.cwd(), '.visual-ledger-publication-test-')
    )
    try {
      const subject = authority(directory, 'before-commit')
      const operation = appendOperation()
      const probe = forceRollbackWithoutAutocommit(subject)
      try {
        expect(() => subject.commitAppend(operation)).toThrow(
          /rollback failed or did not restore confirmed autocommit/i
        )
        expect(probe.observedInTransaction()).toBe(true)
        expect(probe.database.isOpen).toBe(false)
        expect(authorityDatabase(subject).isTransaction).toBe(false)
        expect(subject.recoverAppend(operation)).toBeUndefined()
      } finally {
        subject.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('recovers committed append and finalization responses only after replacing the connection', () => {
    const appendDirectory = mkdtempSync(
      join(process.cwd(), '.visual-ledger-publication-test-')
    )
    const finalizeDirectory = mkdtempSync(
      join(process.cwd(), '.visual-ledger-publication-test-')
    )
    try {
      const appendSubject = authority(appendDirectory)
      const append = appendOperation()
      const appendProbe = forceCommittedResponseLoss(appendSubject)
      let appendCommit: LedgerAppendAuthorityCommit | undefined
      try {
        expect(() => appendSubject.commitAppend(append)).toThrow(
          /rollback failed or did not restore confirmed autocommit/i
        )
        expect(appendProbe.rollbackObservedInTransaction()).toBe(false)
        expect(appendProbe.database.isOpen).toBe(false)
        expect(authorityDatabase(appendSubject) === appendProbe.database).toBe(
          false
        )
        appendCommit = appendSubject.recoverAppend(append)
        expect(appendCommit).toBeDefined()
        expect(appendSubject.head(append.planHash)).toMatchObject({
          ledgerSequence: append.nextLedgerSequence,
          ledgerRootHash: append.nextLedgerRootHash,
          finalized: false
        })
      } finally {
        appendSubject.close()
      }
      const appendRestart = authority(appendDirectory)
      try {
        expect(appendRestart.recoverAppend(append)).toEqual(appendCommit)
      } finally {
        appendRestart.close()
      }

      const seed = certifiedSeed()
      seedHead(finalizeDirectory, seed)
      const finalizeSubject = authority(finalizeDirectory)
      const finalization = finalizationOperation(seed.head)
      const finalizeProbe = forceCommittedResponseLoss(finalizeSubject)
      let finalizationCommit: LedgerFinalizationAuthorityCommit | undefined
      try {
        expect(() => finalizeSubject.commit(finalization)).toThrow(
          /rollback failed or did not restore confirmed autocommit/i
        )
        expect(finalizeProbe.rollbackObservedInTransaction()).toBe(false)
        expect(finalizeProbe.database.isOpen).toBe(false)
        expect(
          authorityDatabase(finalizeSubject) === finalizeProbe.database
        ).toBe(false)
        finalizationCommit = finalizeSubject.recover(finalization)
        expect(finalizationCommit).toBeDefined()
        expect(finalizeSubject.current(seed.head.planHash)).toEqual({
          operation: finalization,
          commit: finalizationCommit
        })
      } finally {
        finalizeSubject.close()
      }
      const finalizeRestart = authority(finalizeDirectory)
      try {
        expect(finalizeRestart.recover(finalization)).toEqual(
          finalizationCommit
        )
        expect(() => finalizeRestart.commitAppend(appendOperation(seed.head))).toThrow(
          /stale or finalized shared ledger append CAS/i
        )
      } finally {
        finalizeRestart.close()
      }
    } finally {
      rmSync(appendDirectory, { recursive: true, force: true })
      rmSync(finalizeDirectory, { recursive: true, force: true })
    }
  })

  it('serializes append CAS across instances, rejects ABA, and recovers after restart', () => {
    const directory = mkdtempSync(
      join(process.cwd(), '.visual-ledger-publication-test-')
    )
    const open: DurableLedgerFinalizationAuthority[] = []
    try {
      const first = authority(directory)
      const second = authority(directory)
      open.push(first, second)
      const winning = appendOperation()
      const competing = appendOperation(undefined, 1)
      const commit = first.commitAppend(winning)

      expect(() => second.commitAppend(competing)).toThrow(
        /stale or finalized shared ledger append CAS/i
      )
      expect(second.recoverAppend(winning)).toEqual(commit)
      expect(second.eventsAfter(winning.planHash, 0)).toEqual([
        { operation: winning, commit }
      ])
      const head = second.head(winning.planHash)
      expect(head).toMatchObject({
        ledgerSequence: 1,
        ledgerRootHash: winning.nextLedgerRootHash,
        ledgerEventHash: winning.nextLedgerEventHash,
        acceptedArtifactCount: 0,
        finalized: false
      })
      expect(() => first.commitAppend(winning)).not.toThrow()
      expect(() => first.commitAppend(appendOperation())).not.toThrow()

      first.close()
      second.close()
      open.length = 0
      const restarted = authority(directory)
      open.push(restarted)
      expect(restarted.head(winning.planHash)).toEqual(head)
      expect(restarted.recoverAppend(winning)).toEqual(commit)
      expect(() => restarted.commitAppend(competing)).toThrow(
        /stale or finalized shared ledger append CAS/i
      )
    } finally {
      for (const item of open) item.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('uses one transactional fence for competing append and finalization', () => {
    const finalizeDirectory = mkdtempSync(
      join(process.cwd(), '.visual-ledger-publication-test-')
    )
    const appendDirectory = mkdtempSync(
      join(process.cwd(), '.visual-ledger-publication-test-')
    )
    const open: DurableLedgerFinalizationAuthority[] = []
    try {
      const firstSeed = certifiedSeed()
      const firstHead = firstSeed.head
      seedHead(finalizeDirectory, firstSeed)
      const finalizer = authority(finalizeDirectory)
      const appender = authority(finalizeDirectory)
      open.push(finalizer, appender)
      const finalization = finalizationOperation(firstHead)
      const append = appendOperation(firstHead)
      const finalCommit = finalizer.commit(finalization)
      expect(() => appender.commitAppend(append)).toThrow(
        /stale or finalized shared ledger append CAS/i
      )
      expect(appender.current(firstHead.planHash)).toEqual({
        operation: finalization,
        commit: finalCommit
      })
      expect(appender.head(firstHead.planHash)).toMatchObject({
        ledgerSequence: firstHead.ledgerSequence,
        ledgerRootHash: firstHead.ledgerRootHash,
        acceptedArtifactCount: 16_600,
        finalized: true
      })

      const secondSeed = certifiedSeed(1)
      const secondHead = secondSeed.head
      seedHead(appendDirectory, secondSeed)
      const appendWinner = authority(appendDirectory)
      const finalizationLoser = authority(appendDirectory)
      open.push(appendWinner, finalizationLoser)
      const appendCommit = appendWinner.commitAppend(
        appendOperation(secondHead)
      )
      expect(appendCommit.operationHash).toBeDefined()
      expect(() =>
        finalizationLoser.commit(finalizationOperation(secondHead))
      ).toThrow(/stale shared ledger finalization CAS/i)
      expect(finalizationLoser.head(secondHead.planHash)).toMatchObject({
        ledgerSequence: secondHead.ledgerSequence + 1,
        acceptedArtifactCount: 16_600,
        finalized: false
      })
    } finally {
      for (const item of open) item.close()
      rmSync(finalizeDirectory, { recursive: true, force: true })
      rmSync(appendDirectory, { recursive: true, force: true })
    }
  })

  it('allows exactly one cross-process append/finalization winner', async () => {
    const directory = mkdtempSync(
      join(process.cwd(), '.visual-ledger-publication-test-')
    )
    try {
      const seed = certifiedSeed()
      const head = seed.head
      seedHead(directory, seed)
      const workerPath = compileWorker(directory)
      const results = await Promise.all([
        runWorker(workerPath, {
          directoryPath: directory,
          kind: 'append',
          operation: appendOperation(head)
        }),
        runWorker(workerPath, {
          directoryPath: directory,
          kind: 'finalize',
          operation: finalizationOperation(head)
        })
      ])
      const parsed = results.map(parsedWorkerResult)
      expect(parsed.filter((result) => result.ok)).toHaveLength(1)
      expect(parsed.filter((result) => !result.ok)).toHaveLength(1)

      const restarted = authority(directory)
      try {
        const authoritative = restarted.head(head.planHash)!
        expect(authoritative.acceptedArtifactCount).toBe(16_600)
        if (authoritative.finalized) {
          expect(authoritative.ledgerSequence).toBe(head.ledgerSequence)
          expect(restarted.current(head.planHash)).toBeDefined()
        } else {
          expect(authoritative.ledgerSequence).toBe(head.ledgerSequence + 1)
          expect(restarted.current(head.planHash)).toBeUndefined()
        }
      } finally {
        restarted.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('fails closed before commit and recovers an after-commit power-loss boundary', async () => {
    const beforeDirectory = mkdtempSync(
      join(process.cwd(), '.visual-ledger-publication-test-')
    )
    const afterDirectory = mkdtempSync(
      join(process.cwd(), '.visual-ledger-publication-test-')
    )
    try {
      const beforeWorker = compileWorker(beforeDirectory)
      const beforeOperation = appendOperation()
      const before = await runWorker(beforeWorker, {
        directoryPath: beforeDirectory,
        kind: 'append',
        operation: beforeOperation,
        exitAt: 'before-commit',
        exitCode: 71
      })
      expect(before.code).toBe(71)
      const beforeRestart = authority(beforeDirectory)
      try {
        expect(beforeRestart.head(beforeOperation.planHash)).toBeUndefined()
        expect(beforeRestart.recoverAppend(beforeOperation)).toBeUndefined()
      } finally {
        beforeRestart.close()
      }

      const afterWorker = compileWorker(afterDirectory)
      const afterOperation = appendOperation()
      const after = await runWorker(afterWorker, {
        directoryPath: afterDirectory,
        kind: 'append',
        operation: afterOperation,
        exitAt: 'after-commit',
        exitCode: 72
      })
      expect(after.code).toBe(72)
      const afterRestart = authority(afterDirectory)
      try {
        expect(afterRestart.head(afterOperation.planHash)).toMatchObject({
          ledgerSequence: 1,
          ledgerRootHash: afterOperation.nextLedgerRootHash,
          finalized: false
        })
        expect(afterRestart.recoverAppend(afterOperation)).toBeDefined()
      } finally {
        afterRestart.close()
      }
    } finally {
      rmSync(beforeDirectory, { recursive: true, force: true })
      rmSync(afterDirectory, { recursive: true, force: true })
    }
  })

  it('recovers a committed finalization after process loss and rejects restart competitors', async () => {
    const directory = mkdtempSync(
      join(process.cwd(), '.visual-ledger-publication-test-')
    )
    try {
      const seed = certifiedSeed()
      const head = seed.head
      seedHead(directory, seed)
      const workerPath = compileWorker(directory)
      const winner = finalizationOperation(head)
      const result = await runWorker(workerPath, {
        directoryPath: directory,
        kind: 'finalize',
        operation: winner,
        exitAt: 'after-commit',
        exitCode: 73
      })
      expect(result.code).toBe(73)

      const restarted = authority(directory)
      try {
        expect(restarted.recover(winner)).toBeDefined()
        expect(restarted.current(head.planHash)?.operation).toEqual(winner)
        expect(() =>
          restarted.commit(finalizationOperation(head, 1))
        ).toThrow(/stale shared ledger finalization CAS/i)
        expect(() => restarted.commitAppend(appendOperation(head))).toThrow(
          /stale or finalized shared ledger append CAS/i
        )
      } finally {
        restarted.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('fails closed on corrupted transactional records', () => {
    const directory = mkdtempSync(
      join(process.cwd(), '.visual-ledger-publication-test-')
    )
    try {
      const subject = authority(directory)
      const operation = appendOperation()
      subject.commitAppend(operation)
      subject.close()

      const databasePath = join(
        directory,
        'visual-artifact-ledger-authority.sqlite3'
      )
      const database = new DatabaseSync(databasePath)
      try {
        database
          .prepare(
            'UPDATE ledger_heads SET accepted_artifact_count = 1 WHERE plan_hash = ?'
          )
          .run(operation.planHash)
      } finally {
        database.close()
      }
      const corruptHead = authority(directory)
      try {
        expect(() => corruptHead.head(operation.planHash)).toThrow(
          /not backed by its latest signed append record/i
        )
      } finally {
        corruptHead.close()
      }

      const recordDatabase = new DatabaseSync(databasePath)
      try {
        recordDatabase
          .prepare(
            'UPDATE ledger_heads SET accepted_artifact_count = ? WHERE plan_hash = ?'
          )
          .run(operation.nextAcceptedArtifactCount, operation.planHash)
        recordDatabase
          .prepare(
            'UPDATE append_records SET operation_json = ? WHERE operation_hash = ?'
          )
          .run(`${canonicalStringify(operation)}\n`, operation.operationHash)
      } finally {
        recordDatabase.close()
      }
      const restarted = authority(directory)
      try {
        expect(() => restarted.eventsAfter(operation.planHash, 0)).toThrow(
          /not canonical/i
        )
      } finally {
        restarted.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
