import {
  closeSync,
  fstatSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  type LedgerFinalizationAuthority,
  type LedgerFinalizationAuthorityCommit,
  type LedgerFinalizationOperation,
  type LedgerFinalizationRecord,
  type OpaqueAttestation,
  invokeSynchronousVerifier,
  parseOpaqueAttestation
} from './authorities'
import {
  assertExactKeys,
  assertIdentifier,
  assertIsoTimestamp,
  assertPlainObject,
  assertSafeInteger,
  assertSerializedTextWithinRuntimeCeiling,
  assertSha256,
  canonicalStringify,
  deepFreeze,
  ownDataValue,
  parseJson,
  sha256Hex,
  utf8ByteLength
} from './canonical'
import {
  APPROVED_EXACT_ARTIFACT_COUNT,
  MAX_ARTIFACTS,
  MAX_EVENTS_PER_ACCEPTED_REVISION,
  MAX_LEDGER_EVENTS,
  ZERO_HASH
} from './constants'
import { fail } from './errors'

const MAX_FINALIZATION_RECORD_BYTES = 64 * 1024

const OPERATION_KEYS = [
  'authorityId',
  'expectedLedgerSequence',
  'expectedLedgerRootHash',
  'planHash',
  'registryHash',
  'artifactCount',
  'artifactSetHash',
  'occurredAt',
  'actorId',
  'trustedCheckpointSequence',
  'trustedCheckpointEventHash',
  'trustedCheckpointRootHash',
  'trustedCheckpointAttestation',
  'principalAttestation',
  'operationHash'
] as const

const COMMIT_KEYS = [
  'authorityId',
  'version',
  'committedAt',
  'previousRootHash',
  'rootHash',
  'operationHash',
  'attestation'
] as const

export type LedgerFinalizationCommitBinding = Omit<
  LedgerFinalizationAuthorityCommit,
  'attestation'
>

export interface DurableLedgerFinalizationAuthorityOptions {
  readonly authorityId: string
  readonly directoryPath: string
  readonly issueCommitAttestation: (
    binding: LedgerFinalizationCommitBinding
  ) => unknown
  readonly verifyCommitAttestation: (
    attestation: OpaqueAttestation,
    binding: LedgerFinalizationCommitBinding
  ) => unknown
}

export function computeLedgerFinalizationOperationHash(
  operation: Omit<LedgerFinalizationOperation, 'operationHash'>
): string {
  return sha256Hex({
    domain: 'visual-artifact-finalization-operation-v1',
    operation
  })
}

export function normalizeLedgerFinalizationOperation(
  value: unknown
): LedgerFinalizationOperation {
  assertPlainObject(value, 'Ledger finalization authority operation')
  assertExactKeys(
    value,
    OPERATION_KEYS,
    'Ledger finalization authority operation'
  )
  const normalizedWithoutHash = {
    authorityId: assertIdentifier(
      value.authorityId,
      'Ledger finalization operation authorityId'
    ),
    expectedLedgerSequence: assertSafeInteger(
      value.expectedLedgerSequence,
      'Ledger finalization operation expectedLedgerSequence',
      0,
      MAX_LEDGER_EVENTS - 1
    ),
    expectedLedgerRootHash: assertSha256(
      value.expectedLedgerRootHash,
      'Ledger finalization operation expectedLedgerRootHash'
    ),
    planHash: assertSha256(
      value.planHash,
      'Ledger finalization operation planHash'
    ),
    registryHash: assertSha256(
      value.registryHash,
      'Ledger finalization operation registryHash'
    ),
    artifactCount: assertSafeInteger(
      value.artifactCount,
      'Ledger finalization operation artifactCount',
      1,
      MAX_ARTIFACTS
    ),
    artifactSetHash: assertSha256(
      value.artifactSetHash,
      'Ledger finalization operation artifactSetHash'
    ),
    occurredAt: assertIsoTimestamp(
      value.occurredAt,
      'Ledger finalization operation occurredAt'
    ),
    actorId: assertIdentifier(
      value.actorId,
      'Ledger finalization operation actorId'
    ),
    trustedCheckpointSequence: assertSafeInteger(
      value.trustedCheckpointSequence,
      'Ledger finalization operation trustedCheckpointSequence',
      0,
      MAX_LEDGER_EVENTS - 1
    ),
    trustedCheckpointEventHash: assertSha256(
      value.trustedCheckpointEventHash,
      'Ledger finalization operation trustedCheckpointEventHash'
    ),
    trustedCheckpointRootHash: assertSha256(
      value.trustedCheckpointRootHash,
      'Ledger finalization operation trustedCheckpointRootHash'
    ),
    trustedCheckpointAttestation: parseOpaqueAttestation(
      value.trustedCheckpointAttestation,
      'Ledger finalization operation checkpoint attestation'
    ),
    principalAttestation: parseOpaqueAttestation(
      value.principalAttestation,
      'Ledger finalization operation principal attestation'
    )
  }
  const operationHash = assertSha256(
    value.operationHash,
    'Ledger finalization operation operationHash'
  )
  if (
    normalizedWithoutHash.artifactCount !==
    APPROVED_EXACT_ARTIFACT_COUNT
  ) {
    fail(
      'FINALIZATION',
      `Ledger finalization authority requires exactly ${APPROVED_EXACT_ARTIFACT_COUNT} artifacts.`
    )
  }
  if (
    normalizedWithoutHash.expectedLedgerSequence <
    APPROVED_EXACT_ARTIFACT_COUNT * MAX_EVENTS_PER_ACCEPTED_REVISION
  ) {
    fail(
      'FINALIZATION',
      'Ledger finalization authority sequence cannot cover the exact accepted plan.'
    )
  }
  if (
    normalizedWithoutHash.trustedCheckpointSequence !==
      normalizedWithoutHash.expectedLedgerSequence ||
    normalizedWithoutHash.trustedCheckpointRootHash !==
      normalizedWithoutHash.expectedLedgerRootHash
  ) {
    fail(
      'TRUST',
      'Ledger finalization authority checkpoint must fence the exact committed head.'
    )
  }
  const expectedLedgerRootHash = sha256Hex({
    domain: 'visual-artifact-ledger-root-v2',
    planHash: normalizedWithoutHash.planHash,
    sequence: normalizedWithoutHash.expectedLedgerSequence,
    lastEventHash: normalizedWithoutHash.trustedCheckpointEventHash
  })
  if (
    normalizedWithoutHash.expectedLedgerRootHash !==
    expectedLedgerRootHash
  ) {
    fail(
      'INTEGRITY',
      'Ledger finalization authority head root is inconsistent with its event hash.'
    )
  }
  if (
    operationHash !==
    computeLedgerFinalizationOperationHash(normalizedWithoutHash)
  ) {
    fail('INTEGRITY', 'Ledger finalization authority operation hash is invalid.')
  }
  return deepFreeze({ ...normalizedWithoutHash, operationHash })
}

export function normalizeLedgerFinalizationCommit(
  value: unknown
): LedgerFinalizationAuthorityCommit {
  assertPlainObject(value, 'Ledger finalization authority commit')
  assertExactKeys(value, COMMIT_KEYS, 'Ledger finalization authority commit')
  if (value.version !== 1) {
    fail('SCHEMA', 'Ledger finalization authority commit version must be 1.')
  }
  return deepFreeze({
    authorityId: assertIdentifier(
      value.authorityId,
      'Ledger finalization commit authorityId'
    ),
    version: 1,
    committedAt: assertIsoTimestamp(
      value.committedAt,
      'Ledger finalization commit committedAt'
    ),
    previousRootHash: assertSha256(
      value.previousRootHash,
      'Ledger finalization commit previousRootHash'
    ),
    rootHash: assertSha256(
      value.rootHash,
      'Ledger finalization commit rootHash'
    ),
    operationHash: assertSha256(
      value.operationHash,
      'Ledger finalization commit operationHash'
    ),
    attestation: parseOpaqueAttestation(
      value.attestation,
      'Ledger finalization commit attestation'
    )
  })
}

function commitBinding(
  commit: LedgerFinalizationAuthorityCommit
): LedgerFinalizationCommitBinding {
  const {
    authorityId,
    version,
    committedAt,
    previousRootHash,
    rootHash,
    operationHash
  } = commit
  return {
    authorityId,
    version,
    committedAt,
    previousRootHash,
    rootHash,
    operationHash
  }
}

function assertDirectoryPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 32_767 ||
    value.includes('\u0000')
  ) {
    fail('SCHEMA', 'Ledger finalization authority directoryPath is invalid.')
  }
  return value
}

function fsyncPublishedDirectory(directoryPath: string): void {
  let descriptor: number | undefined
  try {
    descriptor = openSync(directoryPath, 'r')
    fsyncSync(descriptor)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (
      process.platform === 'win32' &&
      (code === 'EPERM' || code === 'EACCES' || code === 'EINVAL')
    ) {
      return
    }
    throw error
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function publishExclusive(path: string, serialized: string): boolean {
  const directoryPath = dirname(path)
  mkdirSync(directoryPath, { recursive: true })
  const temporaryPath = join(
    directoryPath,
    `.${process.pid}.${randomBytes(16).toString('hex')}.finalization.tmp`
  )
  let descriptor: number | undefined
  try {
    descriptor = openSync(temporaryPath, 'wx', 0o600)
    writeFileSync(descriptor, serialized, 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    try {
      linkSync(temporaryPath, path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
      throw error
    }
    fsyncPublishedDirectory(directoryPath)
    return true
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    rmSync(temporaryPath, { force: true })
  }
}

export class DurableLedgerFinalizationAuthority
  implements LedgerFinalizationAuthority
{
  readonly authorityId: string

  private readonly directoryPath: string
  private readonly issueCommitAttestation:
    DurableLedgerFinalizationAuthorityOptions['issueCommitAttestation']
  private readonly verifyCommitAttestation:
    DurableLedgerFinalizationAuthorityOptions['verifyCommitAttestation']

  constructor(optionsValue: DurableLedgerFinalizationAuthorityOptions) {
    assertPlainObject(
      optionsValue,
      'Durable ledger finalization authority options'
    )
    assertExactKeys(
      optionsValue,
      [
        'authorityId',
        'directoryPath',
        'issueCommitAttestation',
        'verifyCommitAttestation'
      ],
      'Durable ledger finalization authority options'
    )
    this.authorityId = assertIdentifier(
      ownDataValue(
        optionsValue,
        'authorityId',
        'Durable ledger finalization authority options.authorityId'
      ),
      'Ledger finalization authority id'
    )
    this.directoryPath = assertDirectoryPath(
      ownDataValue(
        optionsValue,
        'directoryPath',
        'Durable ledger finalization authority options.directoryPath'
      )
    )
    const issueCommitAttestation = ownDataValue(
      optionsValue,
      'issueCommitAttestation',
      'Durable ledger finalization authority options.issueCommitAttestation'
    )
    const verifyCommitAttestation = ownDataValue(
      optionsValue,
      'verifyCommitAttestation',
      'Durable ledger finalization authority options.verifyCommitAttestation'
    )
    if (
      typeof issueCommitAttestation !== 'function' ||
      typeof verifyCommitAttestation !== 'function'
    ) {
      fail('TRUST', 'Ledger finalization authority requires explicit commit attestors.')
    }
    this.issueCommitAttestation =
      issueCommitAttestation as DurableLedgerFinalizationAuthorityOptions['issueCommitAttestation']
    this.verifyCommitAttestation =
      verifyCommitAttestation as DurableLedgerFinalizationAuthorityOptions['verifyCommitAttestation']
  }

  private recordPath(planHash: string): string {
    return join(this.directoryPath, `${planHash}.finalization.json`)
  }

  private readRecord(planHash: string): LedgerFinalizationRecord | undefined {
    const path = this.recordPath(planHash)
    let serialized: string
    let descriptor: number | undefined
    try {
      descriptor = openSync(path, 'r')
      const metadata = fstatSync(descriptor)
      if (
        !metadata.isFile() ||
        metadata.size < 1 ||
        metadata.size > MAX_FINALIZATION_RECORD_BYTES
      ) {
        fail(
          'CARDINALITY',
          `Durable ledger finalization record exceeds ${MAX_FINALIZATION_RECORD_BYTES} bytes.`
        )
      }
      serialized = readFileSync(descriptor, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    } finally {
      if (descriptor !== undefined) closeSync(descriptor)
    }
    assertSerializedTextWithinRuntimeCeiling(
      serialized,
      'Durable ledger finalization record'
    )
    let parsed: unknown
    try {
      parsed = parseJson(serialized)
    } catch {
      fail('INTEGRITY', 'Durable ledger finalization record is not valid JSON.')
    }
    if (canonicalStringify(parsed) !== serialized) {
      fail('INTEGRITY', 'Durable ledger finalization record is not canonical.')
    }
    assertPlainObject(parsed, 'Durable ledger finalization record')
    assertExactKeys(
      parsed,
      ['operation', 'commit'],
      'Durable ledger finalization record'
    )
    const operation = normalizeLedgerFinalizationOperation(parsed.operation)
    const commit = normalizeLedgerFinalizationCommit(parsed.commit)
    if (
      operation.planHash !== planHash ||
      operation.authorityId !== this.authorityId
    ) {
      fail('TRUST', 'Durable ledger finalization record belongs to another authority or plan.')
    }
    this.verifyCommit(commit, operation)
    return deepFreeze({ operation, commit })
  }

  current(planHashValue: string): LedgerFinalizationRecord | undefined {
    const planHash = assertSha256(
      planHashValue,
      'Ledger finalization authority planHash'
    )
    return this.readRecord(planHash)
  }

  commit(
    operationValue: LedgerFinalizationOperation
  ): LedgerFinalizationAuthorityCommit {
    const operation = normalizeLedgerFinalizationOperation(operationValue)
    if (operation.authorityId !== this.authorityId) {
      fail('CAS', 'Ledger finalization operation targets another authority.')
    }
    const current = this.readRecord(operation.planHash)
    if (current) {
      if (current.operation.operationHash === operation.operationHash) {
        return current.commit
      }
      fail('CAS', 'Stale shared ledger finalization CAS.')
    }
    const unsigned: LedgerFinalizationCommitBinding = {
      authorityId: this.authorityId,
      version: 1,
      committedAt: operation.occurredAt,
      previousRootHash: ZERO_HASH,
      rootHash: sha256Hex({
        domain: 'visual-artifact-finalization-authority-root-v1',
        authorityId: this.authorityId,
        version: 1,
        previousRootHash: ZERO_HASH,
        operationHash: operation.operationHash,
        committedAt: operation.occurredAt
      }),
      operationHash: operation.operationHash
    }
    const commit = deepFreeze({
      ...unsigned,
      attestation: parseOpaqueAttestation(
        Reflect.apply(this.issueCommitAttestation, undefined, [unsigned]),
        'Ledger finalization commit attestation'
      )
    })
    const path = this.recordPath(operation.planHash)
    const serialized = canonicalStringify({ operation, commit })
    if (utf8ByteLength(serialized) > MAX_FINALIZATION_RECORD_BYTES) {
      fail(
        'CARDINALITY',
        `Durable ledger finalization record exceeds ${MAX_FINALIZATION_RECORD_BYTES} bytes.`
      )
    }
    if (!publishExclusive(path, serialized)) {
      const winner = this.readRecord(operation.planHash)
      if (winner?.operation.operationHash === operation.operationHash) {
        return winner.commit
      }
      fail('CAS', 'Stale shared ledger finalization CAS.')
    }
    this.verifyCommit(commit, operation)
    return commit
  }

  recover(
    operationValue: LedgerFinalizationOperation
  ): LedgerFinalizationAuthorityCommit | undefined {
    const operation = normalizeLedgerFinalizationOperation(operationValue)
    const current = this.readRecord(operation.planHash)
    return current?.operation.operationHash === operation.operationHash
      ? current.commit
      : undefined
  }

  verifyCommit(
    commitValue: LedgerFinalizationAuthorityCommit,
    operationValue: LedgerFinalizationOperation
  ): true {
    const operation = normalizeLedgerFinalizationOperation(operationValue)
    const commit = normalizeLedgerFinalizationCommit(commitValue)
    const expectedRootHash = sha256Hex({
      domain: 'visual-artifact-finalization-authority-root-v1',
      authorityId: this.authorityId,
      version: 1,
      previousRootHash: ZERO_HASH,
      operationHash: operation.operationHash,
      committedAt: operation.occurredAt
    })
    if (
      operation.authorityId !== this.authorityId ||
      commit.authorityId !== this.authorityId ||
      commit.version !== 1 ||
      commit.committedAt !== operation.occurredAt ||
      commit.previousRootHash !== ZERO_HASH ||
      commit.rootHash !== expectedRootHash ||
      commit.operationHash !== operation.operationHash
    ) {
      fail('TRUST', 'Ledger finalization authority commit does not match its operation.')
    }
    invokeSynchronousVerifier(
      this.verifyCommitAttestation as (...args: never[]) => unknown,
      undefined,
      [commit.attestation, commitBinding(commit)],
      'Ledger finalization authority commit attestation verifier'
    )
    return true
  }
}
