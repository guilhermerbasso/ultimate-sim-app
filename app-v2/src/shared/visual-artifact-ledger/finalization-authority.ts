import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import {
  type LedgerAppendAuthorityCommit,
  type LedgerAppendOperation,
  type LedgerAppendRecord,
  type LedgerFinalizationAuthority,
  type LedgerFinalizationAuthorityCommit,
  type LedgerFinalizationOperation,
  type LedgerFinalizationRecord,
  type LedgerPublicationHead,
  type OpaqueAttestation,
  invokeSynchronousVerifier,
  parseOpaqueAttestation
} from './authorities'
import {
  assertExactKeys,
  assertIdentifier,
  assertIsoTimestamp,
  assertOptionalExactKeys,
  assertPlainObject,
  assertSafeInteger,
  assertSerializedTextWithinRuntimeCeiling,
  assertSha256,
  canonicalStringify,
  cloneCanonical,
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
const MAX_APPEND_RECORD_BYTES = 32 * 1024
const MAX_RECOVERY_BATCH_EVENTS = 1_024
const SQLITE_SCHEMA_VERSION = 1
const SQLITE_BUSY_TIMEOUT_MS = 30_000

const APPEND_OPERATION_KEYS = [
  'authorityId',
  'expectedLedgerSequence',
  'expectedLedgerRootHash',
  'expectedLedgerEventHash',
  'expectedAcceptedArtifactCount',
  'planHash',
  'registryHash',
  'nextLedgerSequence',
  'nextLedgerRootHash',
  'nextLedgerEventHash',
  'nextAcceptedArtifactCount',
  'event',
  'operationHash'
] as const

const FINALIZATION_OPERATION_KEYS = [
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

const HEAD_KEYS = [
  'authorityId',
  'planHash',
  'registryHash',
  'ledgerSequence',
  'ledgerRootHash',
  'ledgerEventHash',
  'acceptedArtifactCount',
  'authorityRootHash',
  'finalized'
] as const

export type LedgerFinalizationCommitBinding = Omit<
  LedgerFinalizationAuthorityCommit,
  'attestation'
>

export type LedgerAppendCommitBinding = Omit<
  LedgerAppendAuthorityCommit,
  'attestation'
>

export type LedgerAuthorityCommitBinding =
  | LedgerAppendCommitBinding
  | LedgerFinalizationCommitBinding

export type LedgerAuthorityFaultPoint = 'before-commit' | 'after-commit'
export type LedgerAuthorityOperationKind = 'append' | 'finalize'

export interface LedgerAuthorityFault {
  readonly point: LedgerAuthorityFaultPoint
  readonly kind: LedgerAuthorityOperationKind
  readonly operationHash: string
}

export interface DurableLedgerFinalizationAuthorityOptions {
  readonly authorityId: string
  readonly directoryPath: string
  readonly issueCommitAttestation: (
    binding: LedgerAuthorityCommitBinding
  ) => unknown
  readonly verifyCommitAttestation: (
    attestation: OpaqueAttestation,
    binding: LedgerAuthorityCommitBinding
  ) => unknown
  readonly faultInjector?: (fault: LedgerAuthorityFault) => void
}

interface HeadRow {
  plan_hash: string
  registry_hash: string
  ledger_sequence: number
  ledger_root_hash: string
  ledger_event_hash: string
  accepted_artifact_count: number
  authority_root_hash: string
  finalized: number
  finalization_operation_hash: string | null
}

interface RecordRow {
  operation_json: string
  commit_json: string
}

function computeLedgerRootHash(
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

function appendOperationHashBinding(
  operation: Omit<LedgerAppendOperation, 'operationHash'>
): Omit<LedgerAppendOperation, 'event' | 'operationHash'> {
  const {
    authorityId,
    expectedLedgerSequence,
    expectedLedgerRootHash,
    expectedLedgerEventHash,
    expectedAcceptedArtifactCount,
    planHash,
    registryHash,
    nextLedgerSequence,
    nextLedgerRootHash,
    nextLedgerEventHash,
    nextAcceptedArtifactCount
  } = operation
  return {
    authorityId,
    expectedLedgerSequence,
    expectedLedgerRootHash,
    expectedLedgerEventHash,
    expectedAcceptedArtifactCount,
    planHash,
    registryHash,
    nextLedgerSequence,
    nextLedgerRootHash,
    nextLedgerEventHash,
    nextAcceptedArtifactCount
  }
}

function hashFields(domain: string, fields: readonly (string | number)[]): string {
  let encoded = `${domain.length}:${domain}`
  for (const field of fields) {
    const value = String(field)
    encoded += `${value.length}:${value}`
  }
  return createHash('sha256').update(encoded).digest('hex')
}

export function computeLedgerAppendOperationHash(
  operation: Omit<LedgerAppendOperation, 'operationHash'>
): string {
  const binding = appendOperationHashBinding(operation)
  return hashFields('visual-artifact-ledger-append-operation-v1', [
    binding.authorityId,
    binding.expectedLedgerSequence,
    binding.expectedLedgerRootHash,
    binding.expectedLedgerEventHash,
    binding.expectedAcceptedArtifactCount,
    binding.planHash,
    binding.registryHash,
    binding.nextLedgerSequence,
    binding.nextLedgerRootHash,
    binding.nextLedgerEventHash,
    binding.nextAcceptedArtifactCount
  ])
}

export function computeLedgerFinalizationOperationHash(
  operation: Omit<LedgerFinalizationOperation, 'operationHash'>
): string {
  return sha256Hex({
    domain: 'visual-artifact-finalization-operation-v1',
    operation
  })
}

function eventData(value: unknown): Record<string, unknown> {
  const event = cloneCanonical(value)
  assertPlainObject(event, 'Ledger append authority event')
  return event
}

export function normalizeLedgerAppendOperation(
  value: unknown
): LedgerAppendOperation {
  assertPlainObject(value, 'Ledger append authority operation')
  assertExactKeys(
    value,
    APPEND_OPERATION_KEYS,
    'Ledger append authority operation'
  )
  const event = eventData(value.event)
  const expectedLedgerSequence = assertSafeInteger(
    value.expectedLedgerSequence,
    'Ledger append operation expectedLedgerSequence',
    0,
    MAX_LEDGER_EVENTS - 1
  )
  const nextLedgerSequence = assertSafeInteger(
    value.nextLedgerSequence,
    'Ledger append operation nextLedgerSequence',
    1,
    MAX_LEDGER_EVENTS
  )
  const normalizedWithoutHash = {
    authorityId: assertIdentifier(
      value.authorityId,
      'Ledger append operation authorityId'
    ),
    expectedLedgerSequence,
    expectedLedgerRootHash: assertSha256(
      value.expectedLedgerRootHash,
      'Ledger append operation expectedLedgerRootHash'
    ),
    expectedLedgerEventHash: assertSha256(
      value.expectedLedgerEventHash,
      'Ledger append operation expectedLedgerEventHash'
    ),
    expectedAcceptedArtifactCount: assertSafeInteger(
      value.expectedAcceptedArtifactCount,
      'Ledger append operation expectedAcceptedArtifactCount',
      0,
      MAX_ARTIFACTS
    ),
    planHash: assertSha256(
      value.planHash,
      'Ledger append operation planHash'
    ),
    registryHash: assertSha256(
      value.registryHash,
      'Ledger append operation registryHash'
    ),
    nextLedgerSequence,
    nextLedgerRootHash: assertSha256(
      value.nextLedgerRootHash,
      'Ledger append operation nextLedgerRootHash'
    ),
    nextLedgerEventHash: assertSha256(
      value.nextLedgerEventHash,
      'Ledger append operation nextLedgerEventHash'
    ),
    nextAcceptedArtifactCount: assertSafeInteger(
      value.nextAcceptedArtifactCount,
      'Ledger append operation nextAcceptedArtifactCount',
      0,
      MAX_ARTIFACTS
    ),
    event
  }
  const operationHash = assertSha256(
    value.operationHash,
    'Ledger append operation operationHash'
  )
  if (nextLedgerSequence !== expectedLedgerSequence + 1) {
    fail('CAS', 'Ledger append authority operation must advance exactly one sequence.')
  }
  if (
    normalizedWithoutHash.expectedLedgerRootHash !==
    computeLedgerRootHash(
      normalizedWithoutHash.planHash,
      expectedLedgerSequence,
      normalizedWithoutHash.expectedLedgerEventHash
    )
  ) {
    fail('INTEGRITY', 'Ledger append authority expected head is inconsistent.')
  }
  if (
    normalizedWithoutHash.nextLedgerRootHash !==
    computeLedgerRootHash(
      normalizedWithoutHash.planHash,
      nextLedgerSequence,
      normalizedWithoutHash.nextLedgerEventHash
    )
  ) {
    fail('INTEGRITY', 'Ledger append authority next head is inconsistent.')
  }
  const eventSequence = assertSafeInteger(
    ownDataValue(event, 'sequence', 'Ledger append authority event.sequence'),
    'Ledger append authority event sequence',
    1,
    MAX_LEDGER_EVENTS
  )
  const eventHash = assertSha256(
    ownDataValue(event, 'eventHash', 'Ledger append authority event.eventHash'),
    'Ledger append authority event eventHash'
  )
  const previousEventHash = assertSha256(
    ownDataValue(
      event,
      'previousEventHash',
      'Ledger append authority event.previousEventHash'
    ),
    'Ledger append authority event previousEventHash'
  )
  const eventType = ownDataValue(
    event,
    'type',
    'Ledger append authority event.type'
  )
  if (typeof eventType !== 'string' || eventType === 'ledger-finalized') {
    fail('FINALIZATION', 'Ordinary append authority operations cannot publish finalization.')
  }
  assertIsoTimestamp(
    ownDataValue(event, 'occurredAt', 'Ledger append authority event.occurredAt'),
    'Ledger append authority event occurredAt'
  )
  const { eventHash: _eventHash, ...withoutEventHash } = event
  if (
    eventSequence !== nextLedgerSequence ||
    eventHash !== normalizedWithoutHash.nextLedgerEventHash ||
    previousEventHash !== normalizedWithoutHash.expectedLedgerEventHash ||
    sha256Hex({
      domain: 'visual-artifact-event-v2',
      event: withoutEventHash
    }) !== eventHash
  ) {
    fail('INTEGRITY', 'Ledger append authority event does not match its fenced head.')
  }
  const acceptedDelta =
    normalizedWithoutHash.nextAcceptedArtifactCount -
    normalizedWithoutHash.expectedAcceptedArtifactCount
  if (
    (eventType === 'artifact-accepted' && acceptedDelta !== 1) ||
    (eventType === 'artifact-revision-superseded' &&
      acceptedDelta !== 0 &&
      acceptedDelta !== -1) ||
    (eventType !== 'artifact-accepted' &&
      eventType !== 'artifact-revision-superseded' &&
      acceptedDelta !== 0)
  ) {
    fail('INTEGRITY', 'Ledger append authority accepted-count transition is invalid.')
  }
  if (
    operationHash !==
    computeLedgerAppendOperationHash(normalizedWithoutHash)
  ) {
    fail('INTEGRITY', 'Ledger append authority operation hash is invalid.')
  }
  return deepFreeze({ ...normalizedWithoutHash, operationHash })
}

export function normalizeLedgerFinalizationOperation(
  value: unknown
): LedgerFinalizationOperation {
  assertPlainObject(value, 'Ledger finalization authority operation')
  assertExactKeys(
    value,
    FINALIZATION_OPERATION_KEYS,
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
  if (
    normalizedWithoutHash.expectedLedgerRootHash !==
    computeLedgerRootHash(
      normalizedWithoutHash.planHash,
      normalizedWithoutHash.expectedLedgerSequence,
      normalizedWithoutHash.trustedCheckpointEventHash
    )
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

function normalizeCommit(
  value: unknown,
  label: string
): LedgerAppendAuthorityCommit {
  assertPlainObject(value, label)
  assertExactKeys(value, COMMIT_KEYS, label)
  if (value.version !== 1) {
    fail('SCHEMA', `${label} version must be 1.`)
  }
  const normalized = deepFreeze({
    authorityId: assertIdentifier(value.authorityId, `${label} authorityId`),
    version: 1 as const,
    committedAt: assertIsoTimestamp(value.committedAt, `${label} committedAt`),
    previousRootHash: assertSha256(
      value.previousRootHash,
      `${label} previousRootHash`
    ),
    rootHash: assertSha256(value.rootHash, `${label} rootHash`),
    operationHash: assertSha256(value.operationHash, `${label} operationHash`),
    attestation: parseOpaqueAttestation(
      value.attestation,
      `${label} attestation`
    )
  })
  return normalized
}

export function normalizeLedgerAppendCommit(
  value: unknown
): LedgerAppendAuthorityCommit {
  return normalizeCommit(value, 'Ledger append authority commit')
}

export function normalizeLedgerFinalizationCommit(
  value: unknown
): LedgerFinalizationAuthorityCommit {
  return normalizeCommit(value, 'Ledger finalization authority commit')
}

export function normalizeLedgerPublicationHead(
  value: unknown
): LedgerPublicationHead {
  assertPlainObject(value, 'Ledger publication authority head')
  assertExactKeys(value, HEAD_KEYS, 'Ledger publication authority head')
  if (typeof value.finalized !== 'boolean') {
    fail('SCHEMA', 'Ledger publication authority head finalized must be boolean.')
  }
  const head = {
    authorityId: assertIdentifier(
      value.authorityId,
      'Ledger publication authority head authorityId'
    ),
    planHash: assertSha256(
      value.planHash,
      'Ledger publication authority head planHash'
    ),
    registryHash: assertSha256(
      value.registryHash,
      'Ledger publication authority head registryHash'
    ),
    ledgerSequence: assertSafeInteger(
      value.ledgerSequence,
      'Ledger publication authority head ledgerSequence',
      1,
      MAX_LEDGER_EVENTS
    ),
    ledgerRootHash: assertSha256(
      value.ledgerRootHash,
      'Ledger publication authority head ledgerRootHash'
    ),
    ledgerEventHash: assertSha256(
      value.ledgerEventHash,
      'Ledger publication authority head ledgerEventHash'
    ),
    acceptedArtifactCount: assertSafeInteger(
      value.acceptedArtifactCount,
      'Ledger publication authority head acceptedArtifactCount',
      0,
      MAX_ARTIFACTS
    ),
    authorityRootHash: assertSha256(
      value.authorityRootHash,
      'Ledger publication authority head authorityRootHash'
    ),
    finalized: value.finalized
  }
  if (
    head.ledgerRootHash !==
    computeLedgerRootHash(
      head.planHash,
      head.ledgerSequence,
      head.ledgerEventHash
    )
  ) {
    fail('INTEGRITY', 'Ledger publication authority head root is inconsistent.')
  }
  return deepFreeze(head)
}

function commitBinding(
  commit: LedgerAppendAuthorityCommit | LedgerFinalizationAuthorityCommit
): LedgerAuthorityCommitBinding {
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

export function computeLedgerPublicationAuthorityRootHash(
  kind: LedgerAuthorityOperationKind,
  binding: LedgerAuthorityCommitBinding
): string {
  return hashFields('visual-artifact-ledger-publication-authority-root-v1', [
    kind,
    binding.authorityId,
    binding.version,
    binding.committedAt,
    binding.previousRootHash,
    binding.operationHash
  ])
}

function assertDirectoryPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 32_767 ||
    value.includes('\u0000')
  ) {
    fail('SCHEMA', 'Ledger publication authority directoryPath is invalid.')
  }
  return value
}

function parseStoredJson(serialized: unknown, label: string): unknown {
  if (typeof serialized !== 'string') {
    fail('INTEGRITY', `${label} is not stored as text.`)
  }
  assertSerializedTextWithinRuntimeCeiling(serialized, label)
  let parsed: unknown
  try {
    parsed = parseJson(serialized)
  } catch {
    fail('INTEGRITY', `${label} is not valid JSON.`)
  }
  if (canonicalStringify(parsed) !== serialized) {
    fail('INTEGRITY', `${label} is not canonical.`)
  }
  return parsed
}

function sqliteText(row: Record<string, unknown>, key: string, label: string): string {
  const value = row[key]
  if (typeof value !== 'string') fail('INTEGRITY', `${label} is not text.`)
  return value
}

function sqliteNumber(
  row: Record<string, unknown>,
  key: string,
  label: string
): number {
  const value = row[key]
  if (typeof value !== 'number') fail('INTEGRITY', `${label} is not numeric.`)
  return value
}

export class DurableLedgerFinalizationAuthority
  implements LedgerFinalizationAuthority
{
  readonly authorityId: string

  private readonly database: DatabaseSync
  private readonly issueCommitAttestation:
    DurableLedgerFinalizationAuthorityOptions['issueCommitAttestation']
  private readonly verifyCommitAttestation:
    DurableLedgerFinalizationAuthorityOptions['verifyCommitAttestation']
  private readonly faultInjector?: NonNullable<
    DurableLedgerFinalizationAuthorityOptions['faultInjector']
  >
  private closed = false

  constructor(optionsValue: DurableLedgerFinalizationAuthorityOptions) {
    assertPlainObject(
      optionsValue,
      'Durable ledger publication authority options'
    )
    assertOptionalExactKeys(
      optionsValue,
      [
        'authorityId',
        'directoryPath',
        'issueCommitAttestation',
        'verifyCommitAttestation'
      ],
      ['faultInjector'],
      'Durable ledger publication authority options'
    )
    this.authorityId = assertIdentifier(
      ownDataValue(
        optionsValue,
        'authorityId',
        'Durable ledger publication authority options.authorityId'
      ),
      'Ledger publication authority id'
    )
    const directoryPath = assertDirectoryPath(
      ownDataValue(
        optionsValue,
        'directoryPath',
        'Durable ledger publication authority options.directoryPath'
      )
    )
    const issueCommitAttestation = ownDataValue(
      optionsValue,
      'issueCommitAttestation',
      'Durable ledger publication authority options.issueCommitAttestation'
    )
    const verifyCommitAttestation = ownDataValue(
      optionsValue,
      'verifyCommitAttestation',
      'Durable ledger publication authority options.verifyCommitAttestation'
    )
    const faultDescriptor = Object.getOwnPropertyDescriptor(
      optionsValue,
      'faultInjector'
    )
    const faultInjector =
      faultDescriptor && 'value' in faultDescriptor
        ? faultDescriptor.value
        : undefined
    if (
      typeof issueCommitAttestation !== 'function' ||
      typeof verifyCommitAttestation !== 'function' ||
      (faultInjector !== undefined && typeof faultInjector !== 'function')
    ) {
      fail(
        'TRUST',
        'Ledger publication authority requires explicit commit attestors and a getter-free fault injector.'
      )
    }
    this.issueCommitAttestation =
      issueCommitAttestation as DurableLedgerFinalizationAuthorityOptions['issueCommitAttestation']
    this.verifyCommitAttestation =
      verifyCommitAttestation as DurableLedgerFinalizationAuthorityOptions['verifyCommitAttestation']
    this.faultInjector = faultInjector as
      | NonNullable<
          DurableLedgerFinalizationAuthorityOptions['faultInjector']
        >
      | undefined
    mkdirSync(directoryPath, { recursive: true })
    this.database = new DatabaseSync(
      join(directoryPath, 'visual-artifact-ledger-authority.sqlite3'),
      {
        allowExtension: false,
        enableDoubleQuotedStringLiterals: false,
        enableForeignKeyConstraints: true,
        timeout: SQLITE_BUSY_TIMEOUT_MS
      }
    )
    try {
      this.configureDurability()
      this.initializeSchema()
      this.verifyAuthorityIdentity()
    } catch (error) {
      this.database.close()
      this.closed = true
      throw error
    }
  }

  private configureDurability(): void {
    const journal = this.database
      .prepare('PRAGMA journal_mode = WAL')
      .get() as Record<string, unknown> | undefined
    const journalMode = journal?.journal_mode
    this.database.exec(`
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA trusted_schema = OFF;
      PRAGMA wal_autocheckpoint = 1000;
    `)
    const synchronous = this.database
      .prepare('PRAGMA synchronous')
      .get() as Record<string, unknown> | undefined
    const foreignKeys = this.database
      .prepare('PRAGMA foreign_keys')
      .get() as Record<string, unknown> | undefined
    if (
      journalMode !== 'wal' ||
      synchronous?.synchronous !== 2 ||
      foreignKeys?.foreign_keys !== 1
    ) {
      fail(
        'TRUST',
        'SQLite could not establish WAL, FULL synchronous, foreign-key durable publication; refusing to commit.'
      )
    }
  }

  private initializeSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS authority_meta (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        schema_version INTEGER NOT NULL,
        authority_id TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS ledger_heads (
        plan_hash TEXT PRIMARY KEY,
        registry_hash TEXT NOT NULL,
        ledger_sequence INTEGER NOT NULL CHECK (ledger_sequence >= 1),
        ledger_root_hash TEXT NOT NULL,
        ledger_event_hash TEXT NOT NULL,
        accepted_artifact_count INTEGER NOT NULL CHECK (accepted_artifact_count >= 0),
        authority_root_hash TEXT NOT NULL,
        finalized INTEGER NOT NULL CHECK (finalized IN (0, 1)),
        finalization_operation_hash TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS append_records (
        plan_hash TEXT NOT NULL,
        ledger_sequence INTEGER NOT NULL,
        operation_hash TEXT NOT NULL,
        operation_json TEXT NOT NULL,
        commit_json TEXT NOT NULL,
        PRIMARY KEY (plan_hash, ledger_sequence),
        UNIQUE (plan_hash, operation_hash),
        FOREIGN KEY (plan_hash) REFERENCES ledger_heads(plan_hash)
          DEFERRABLE INITIALLY DEFERRED
      ) STRICT;

      CREATE TABLE IF NOT EXISTS finalization_records (
        plan_hash TEXT PRIMARY KEY,
        operation_hash TEXT NOT NULL,
        operation_json TEXT NOT NULL,
        commit_json TEXT NOT NULL,
        FOREIGN KEY (plan_hash) REFERENCES ledger_heads(plan_hash)
          DEFERRABLE INITIALLY DEFERRED
      ) STRICT;
    `)
    const existing = this.database
      .prepare(
        'SELECT schema_version, authority_id FROM authority_meta WHERE singleton = 1'
      )
      .get() as Record<string, unknown> | undefined
    if (!existing) {
      this.database
        .prepare(
          'INSERT INTO authority_meta(singleton, schema_version, authority_id) VALUES (1, ?, ?)'
        )
        .run(SQLITE_SCHEMA_VERSION, this.authorityId)
    }
  }

  private verifyAuthorityIdentity(): void {
    const row = this.database
      .prepare(
        'SELECT schema_version, authority_id FROM authority_meta WHERE singleton = 1'
      )
      .get() as Record<string, unknown> | undefined
    if (
      !row ||
      row.schema_version !== SQLITE_SCHEMA_VERSION ||
      row.authority_id !== this.authorityId
    ) {
      fail(
        'TRUST',
        'Durable ledger publication database belongs to another authority or schema.'
      )
    }
    const quickCheck = this.database
      .prepare('PRAGMA quick_check')
      .get() as Record<string, unknown> | undefined
    if (quickCheck?.quick_check !== 'ok') {
      fail('INTEGRITY', 'Durable ledger publication database failed SQLite quick_check.')
    }
  }

  private assertOpen(): void {
    if (this.closed) fail('TRUST', 'Ledger publication authority is closed.')
  }

  close(): void {
    if (this.closed) return
    this.database.close()
    this.closed = true
  }

  private injectFault(
    point: LedgerAuthorityFaultPoint,
    kind: LedgerAuthorityOperationKind,
    operationHash: string
  ): void {
    if (!this.faultInjector) return
    Reflect.apply(this.faultInjector, undefined, [
      deepFreeze({ point, kind, operationHash })
    ])
  }

  private transaction<T>(
    kind: LedgerAuthorityOperationKind,
    operationHash: string,
    body: () => T
  ): T {
    this.assertOpen()
    this.database.exec('BEGIN IMMEDIATE')
    let committed = false
    try {
      const result = body()
      this.injectFault('before-commit', kind, operationHash)
      this.database.exec('COMMIT')
      committed = true
      this.injectFault('after-commit', kind, operationHash)
      return result
    } catch (error) {
      if (!committed) {
        try {
          this.database.exec('ROLLBACK')
        } catch {
          // The original transaction failure is authoritative.
        }
      }
      throw error
    }
  }

  private readHeadRow(
    planHash: string,
    verifyStoredRecord = true
  ): HeadRow | undefined {
    const row = this.database
      .prepare(`
        SELECT plan_hash, registry_hash, ledger_sequence, ledger_root_hash,
               ledger_event_hash, accepted_artifact_count, authority_root_hash,
               finalized, finalization_operation_hash
          FROM ledger_heads
         WHERE plan_hash = ?
      `)
      .get(planHash) as Record<string, unknown> | undefined
    if (!row) return undefined
    const finalizationOperationHash = row.finalization_operation_hash
    if (
      finalizationOperationHash !== null &&
      typeof finalizationOperationHash !== 'string'
    ) {
      fail('INTEGRITY', 'Ledger publication head finalization hash is corrupt.')
    }
    const head = {
      plan_hash: sqliteText(row, 'plan_hash', 'Ledger head plan_hash'),
      registry_hash: sqliteText(
        row,
        'registry_hash',
        'Ledger head registry_hash'
      ),
      ledger_sequence: sqliteNumber(
        row,
        'ledger_sequence',
        'Ledger head ledger_sequence'
      ),
      ledger_root_hash: sqliteText(
        row,
        'ledger_root_hash',
        'Ledger head ledger_root_hash'
      ),
      ledger_event_hash: sqliteText(
        row,
        'ledger_event_hash',
        'Ledger head ledger_event_hash'
      ),
      accepted_artifact_count: sqliteNumber(
        row,
        'accepted_artifact_count',
        'Ledger head accepted_artifact_count'
      ),
      authority_root_hash: sqliteText(
        row,
        'authority_root_hash',
        'Ledger head authority_root_hash'
      ),
      finalized: sqliteNumber(row, 'finalized', 'Ledger head finalized'),
      finalization_operation_hash: finalizationOperationHash
    }
    if (verifyStoredRecord) this.verifyStoredHead(head)
    return head
  }

  private readAppendRecordAtSequence(
    planHash: string,
    sequence: number
  ): LedgerAppendRecord | undefined {
    const row = this.database
      .prepare(`
        SELECT operation_json, commit_json
          FROM append_records
         WHERE plan_hash = ? AND ledger_sequence = ?
      `)
      .get(planHash, sequence) as Record<string, unknown> | undefined
    if (!row) return undefined
    return this.normalizeAppendRecord({
      operation: parseStoredJson(
        row.operation_json,
        'Durable ledger append operation'
      ),
      commit: parseStoredJson(row.commit_json, 'Durable ledger append commit')
    })
  }

  private verifyStoredHead(head: HeadRow): void {
    const latest = this.readAppendRecordAtSequence(
      head.plan_hash,
      head.ledger_sequence
    )
    if (
      !latest ||
      latest.operation.authorityId !== this.authorityId ||
      latest.operation.planHash !== head.plan_hash ||
      latest.operation.registryHash !== head.registry_hash ||
      latest.operation.nextLedgerSequence !== head.ledger_sequence ||
      latest.operation.nextLedgerRootHash !== head.ledger_root_hash ||
      latest.operation.nextLedgerEventHash !== head.ledger_event_hash ||
      latest.operation.nextAcceptedArtifactCount !==
        head.accepted_artifact_count
    ) {
      fail(
        'INTEGRITY',
        'Ledger publication head is not backed by its latest signed append record.'
      )
    }
    if (head.finalized === 0) {
      if (
        head.finalization_operation_hash !== null ||
        latest.commit.rootHash !== head.authority_root_hash
      ) {
        fail('INTEGRITY', 'Writable ledger publication head has a corrupt authority root.')
      }
      return
    }
    const finalization = this.readFinalizationRecord(head.plan_hash)
    if (
      !finalization ||
      head.finalization_operation_hash !==
        finalization.operation.operationHash ||
      finalization.operation.expectedLedgerSequence !==
        head.ledger_sequence ||
      finalization.operation.expectedLedgerRootHash !==
        head.ledger_root_hash ||
      finalization.operation.trustedCheckpointEventHash !==
        head.ledger_event_hash ||
      finalization.operation.artifactCount !==
        head.accepted_artifact_count ||
      finalization.commit.previousRootHash !== latest.commit.rootHash ||
      finalization.commit.rootHash !== head.authority_root_hash
    ) {
      fail(
        'INTEGRITY',
        'Finalized ledger publication head is not backed by its signed records.'
      )
    }
  }

  private publicHead(row: HeadRow): LedgerPublicationHead {
    return normalizeLedgerPublicationHead({
      authorityId: this.authorityId,
      planHash: row.plan_hash,
      registryHash: row.registry_hash,
      ledgerSequence: row.ledger_sequence,
      ledgerRootHash: row.ledger_root_hash,
      ledgerEventHash: row.ledger_event_hash,
      acceptedArtifactCount: row.accepted_artifact_count,
      authorityRootHash: row.authority_root_hash,
      finalized: row.finalized === 1
    })
  }

  head(planHashValue: string): LedgerPublicationHead | undefined {
    this.assertOpen()
    const planHash = assertSha256(
      planHashValue,
      'Ledger publication authority planHash'
    )
    const row = this.readHeadRow(planHash)
    if (!row) return undefined
    if (
      (row.finalized === 1) !==
      (typeof row.finalization_operation_hash === 'string')
    ) {
      fail('INTEGRITY', 'Ledger publication head has inconsistent finalization state.')
    }
    if (row.finalized === 1 && !this.current(planHash)) {
      fail('INTEGRITY', 'Finalized ledger publication head has no finalization record.')
    }
    return this.publicHead(row)
  }

  private issueCommit(
    kind: LedgerAuthorityOperationKind,
    operationHash: string,
    committedAt: string,
    previousRootHash: string
  ): LedgerAppendAuthorityCommit {
    const unsigned: LedgerAuthorityCommitBinding = {
      authorityId: this.authorityId,
      version: 1,
      committedAt,
      previousRootHash,
      rootHash: ZERO_HASH,
      operationHash
    }
    const binding = {
      ...unsigned,
      rootHash: computeLedgerPublicationAuthorityRootHash(kind, unsigned)
    }
    return deepFreeze({
      ...binding,
      attestation: parseOpaqueAttestation(
        Reflect.apply(this.issueCommitAttestation, undefined, [binding]),
        'Ledger publication commit attestation'
      )
    })
  }

  private readAppendRecord(
    planHash: string,
    operationHash: string
  ): LedgerAppendRecord | undefined {
    const row = this.database
      .prepare(`
        SELECT operation_json, commit_json
          FROM append_records
         WHERE plan_hash = ? AND operation_hash = ?
      `)
      .get(planHash, operationHash) as Record<string, unknown> | undefined
    if (!row) return undefined
    return this.normalizeAppendRecord({
      operation: parseStoredJson(
        row.operation_json,
        'Durable ledger append operation'
      ),
      commit: parseStoredJson(row.commit_json, 'Durable ledger append commit')
    })
  }

  private normalizeAppendRecord(value: unknown): LedgerAppendRecord {
    assertPlainObject(value, 'Ledger append authority record')
    assertExactKeys(
      value,
      ['operation', 'commit'],
      'Ledger append authority record'
    )
    const operation = normalizeLedgerAppendOperation(value.operation)
    const commit = normalizeLedgerAppendCommit(value.commit)
    this.verifyAppendCommit(commit, operation)
    return deepFreeze({ operation, commit })
  }

  commitAppend(
    operationValue: LedgerAppendOperation
  ): LedgerAppendAuthorityCommit {
    const operation = normalizeLedgerAppendOperation(operationValue)
    if (operation.authorityId !== this.authorityId) {
      fail('CAS', 'Ledger append operation targets another authority.')
    }
    return this.transaction('append', operation.operationHash, () => {
      const current = this.readHeadRow(operation.planHash)
      const existing = this.readAppendRecord(
        operation.planHash,
        operation.operationHash
      )
      if (existing) {
        if (
          canonicalStringify(existing.operation) !== canonicalStringify(operation)
        ) {
          fail('CAS', 'Ledger append operation hash collides with another record.')
        }
        return existing.commit
      }
      if (current) {
        if (
          current.registry_hash !== operation.registryHash ||
          current.finalized !== 0 ||
          current.ledger_sequence !== operation.expectedLedgerSequence ||
          current.ledger_root_hash !== operation.expectedLedgerRootHash ||
          current.ledger_event_hash !== operation.expectedLedgerEventHash ||
          current.accepted_artifact_count !==
            operation.expectedAcceptedArtifactCount
        ) {
          fail('CAS', 'Stale or finalized shared ledger append CAS.')
        }
      } else {
        const genesisRoot = computeLedgerRootHash(
          operation.planHash,
          0,
          ZERO_HASH
        )
        if (
          operation.expectedLedgerSequence !== 0 ||
          operation.expectedLedgerRootHash !== genesisRoot ||
          operation.expectedLedgerEventHash !== ZERO_HASH ||
          operation.expectedAcceptedArtifactCount !== 0
        ) {
          fail(
            'CAS',
            'Ledger append authority cannot create a non-genesis head.'
          )
        }
      }
      const commit = this.issueCommit(
        'append',
        operation.operationHash,
        assertIsoTimestamp(
          (operation.event as Record<string, unknown>).occurredAt,
          'Ledger append event occurredAt'
        ),
        current?.authority_root_hash ?? ZERO_HASH
      )
      this.verifyAppendCommit(commit, operation)
      const operationJson = canonicalStringify(operation)
      const commitJson = canonicalStringify(commit)
      if (
        utf8ByteLength(operationJson) + utf8ByteLength(commitJson) >
        MAX_APPEND_RECORD_BYTES
      ) {
        fail(
          'CARDINALITY',
          `Durable ledger append record exceeds ${MAX_APPEND_RECORD_BYTES} bytes.`
        )
      }
      if (current) {
        const result = this.database
          .prepare(`
            UPDATE ledger_heads
               SET ledger_sequence = ?,
                   ledger_root_hash = ?,
                   ledger_event_hash = ?,
                   accepted_artifact_count = ?,
                   authority_root_hash = ?
             WHERE plan_hash = ?
               AND registry_hash = ?
               AND finalized = 0
               AND ledger_sequence = ?
               AND ledger_root_hash = ?
               AND ledger_event_hash = ?
               AND accepted_artifact_count = ?
          `)
          .run(
            operation.nextLedgerSequence,
            operation.nextLedgerRootHash,
            operation.nextLedgerEventHash,
            operation.nextAcceptedArtifactCount,
            commit.rootHash,
            operation.planHash,
            operation.registryHash,
            operation.expectedLedgerSequence,
            operation.expectedLedgerRootHash,
            operation.expectedLedgerEventHash,
            operation.expectedAcceptedArtifactCount
          )
        if (result.changes !== 1) {
          fail('CAS', 'Ledger append lost its final transactional head fence.')
        }
      } else {
        this.database
          .prepare(`
            INSERT INTO ledger_heads(
              plan_hash, registry_hash, ledger_sequence, ledger_root_hash,
              ledger_event_hash, accepted_artifact_count, authority_root_hash,
              finalized, finalization_operation_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)
          `)
          .run(
            operation.planHash,
            operation.registryHash,
            operation.nextLedgerSequence,
            operation.nextLedgerRootHash,
            operation.nextLedgerEventHash,
            operation.nextAcceptedArtifactCount,
            commit.rootHash
          )
      }
      this.database
        .prepare(`
          INSERT INTO append_records(
            plan_hash, ledger_sequence, operation_hash, operation_json, commit_json
          ) VALUES (?, ?, ?, ?, ?)
        `)
        .run(
          operation.planHash,
          operation.nextLedgerSequence,
          operation.operationHash,
          operationJson,
          commitJson
        )
      return commit
    })
  }

  recoverAppend(
    operationValue: LedgerAppendOperation
  ): LedgerAppendAuthorityCommit | undefined {
    this.assertOpen()
    const operation = normalizeLedgerAppendOperation(operationValue)
    if (operation.authorityId !== this.authorityId) return undefined
    this.readHeadRow(operation.planHash)
    const record = this.readAppendRecord(
      operation.planHash,
      operation.operationHash
    )
    if (
      record &&
      canonicalStringify(record.operation) !== canonicalStringify(operation)
    ) {
      fail('CAS', 'Ledger append recovery operation does not match durable state.')
    }
    return record?.commit
  }

  eventsAfter(
    planHashValue: string,
    sequenceValue: number
  ): readonly LedgerAppendRecord[] {
    this.assertOpen()
    const planHash = assertSha256(
      planHashValue,
      'Ledger publication events planHash'
    )
    const sequence = assertSafeInteger(
      sequenceValue,
      'Ledger publication events sequence',
      0,
      MAX_LEDGER_EVENTS
    )
    const rows = this.database
      .prepare(`
        SELECT operation_json, commit_json
          FROM append_records
         WHERE plan_hash = ? AND ledger_sequence > ?
         ORDER BY ledger_sequence ASC
         LIMIT ?
      `)
      .all(
        planHash,
        sequence,
        MAX_RECOVERY_BATCH_EVENTS
      ) as Record<string, unknown>[]
    const records: LedgerAppendRecord[] = []
    let previousAuthorityRootHash =
      sequence === 0
        ? ZERO_HASH
        : this.readAppendRecordAtSequence(planHash, sequence)?.commit.rootHash
    if (previousAuthorityRootHash === undefined) {
      fail(
        'INTEGRITY',
        'Ledger publication event range is missing its preceding signed record.'
      )
    }
    let expectedSequence = sequence + 1
    for (const row of rows) {
      const record = this.normalizeAppendRecord({
        operation: parseStoredJson(
          row.operation_json,
          'Durable ledger append operation'
        ),
        commit: parseStoredJson(
          row.commit_json,
          'Durable ledger append commit'
        )
      })
      if (
        record.operation.nextLedgerSequence !== expectedSequence ||
        record.commit.previousRootHash !== previousAuthorityRootHash
      ) {
        fail(
          'INTEGRITY',
          'Ledger publication event range breaks its signed authority chain.'
        )
      }
      records.push(record)
      previousAuthorityRootHash = record.commit.rootHash
      expectedSequence += 1
    }
    return deepFreeze(records)
  }

  verifyAppendCommit(
    commitValue: LedgerAppendAuthorityCommit,
    operationValue: LedgerAppendOperation
  ): true {
    const operation = normalizeLedgerAppendOperation(operationValue)
    const commit = normalizeLedgerAppendCommit(commitValue)
    const event = operation.event as Record<string, unknown>
    const expectedBinding: LedgerAppendCommitBinding = {
      authorityId: this.authorityId,
      version: 1,
      committedAt: assertIsoTimestamp(
        event.occurredAt,
        'Ledger append event occurredAt'
      ),
      previousRootHash: commit.previousRootHash,
      rootHash: ZERO_HASH,
      operationHash: operation.operationHash
    }
    const expectedRootHash = computeLedgerPublicationAuthorityRootHash(
      'append',
      expectedBinding
    )
    if (
      operation.authorityId !== this.authorityId ||
      commit.authorityId !== this.authorityId ||
      commit.version !== 1 ||
      commit.committedAt !== expectedBinding.committedAt ||
      commit.rootHash !== expectedRootHash ||
      commit.operationHash !== operation.operationHash
    ) {
      fail('TRUST', 'Ledger append authority commit does not match its operation.')
    }
    invokeSynchronousVerifier(
      this.verifyCommitAttestation as (...args: never[]) => unknown,
      undefined,
      [commit.attestation, commitBinding(commit)],
      'Ledger append authority commit attestation verifier'
    )
    return true
  }

  private readFinalizationRecord(
    planHash: string
  ): LedgerFinalizationRecord | undefined {
    const row = this.database
      .prepare(`
        SELECT operation_json, commit_json
          FROM finalization_records
         WHERE plan_hash = ?
      `)
      .get(planHash) as Record<string, unknown> | undefined
    if (!row) return undefined
    const operation = normalizeLedgerFinalizationOperation(
      parseStoredJson(
        row.operation_json,
        'Durable ledger finalization operation'
      )
    )
    const commit = normalizeLedgerFinalizationCommit(
      parseStoredJson(row.commit_json, 'Durable ledger finalization commit')
    )
    if (
      operation.planHash !== planHash ||
      operation.authorityId !== this.authorityId
    ) {
      fail(
        'TRUST',
        'Durable ledger finalization record belongs to another authority or plan.'
      )
    }
    this.verifyCommit(commit, operation)
    return deepFreeze({ operation, commit })
  }

  current(planHashValue: string): LedgerFinalizationRecord | undefined {
    this.assertOpen()
    const planHash = assertSha256(
      planHashValue,
      'Ledger finalization authority planHash'
    )
    const record = this.readFinalizationRecord(planHash)
    if (!record) return undefined
    const head = this.readHeadRow(planHash)
    if (
      !head ||
      head.finalized !== 1 ||
      head.finalization_operation_hash !== record.operation.operationHash ||
      head.authority_root_hash !== record.commit.rootHash
    ) {
      fail('INTEGRITY', 'Ledger finalization record is not the authoritative head.')
    }
    return record
  }

  commit(
    operationValue: LedgerFinalizationOperation
  ): LedgerFinalizationAuthorityCommit {
    const operation = normalizeLedgerFinalizationOperation(operationValue)
    if (operation.authorityId !== this.authorityId) {
      fail('CAS', 'Ledger finalization operation targets another authority.')
    }
    return this.transaction('finalize', operation.operationHash, () => {
      const current = this.readHeadRow(operation.planHash)
      const existing = this.readFinalizationRecord(operation.planHash)
      if (existing) {
        if (
          existing.operation.operationHash === operation.operationHash &&
          canonicalStringify(existing.operation) === canonicalStringify(operation)
        ) {
          return existing.commit
        }
        fail('CAS', 'Stale shared ledger finalization CAS.')
      }
      if (
        !current ||
        current.registry_hash !== operation.registryHash ||
        current.finalized !== 0 ||
        current.ledger_sequence !== operation.expectedLedgerSequence ||
        current.ledger_root_hash !== operation.expectedLedgerRootHash ||
        current.ledger_event_hash !==
          operation.trustedCheckpointEventHash ||
        current.accepted_artifact_count !== operation.artifactCount
      ) {
        fail('CAS', 'Stale shared ledger finalization CAS.')
      }
      const commit = this.issueCommit(
        'finalize',
        operation.operationHash,
        operation.occurredAt,
        current.authority_root_hash
      )
      this.verifyCommit(commit, operation)
      const operationJson = canonicalStringify(operation)
      const commitJson = canonicalStringify(commit)
      if (
        utf8ByteLength(operationJson) + utf8ByteLength(commitJson) >
        MAX_FINALIZATION_RECORD_BYTES
      ) {
        fail(
          'CARDINALITY',
          `Durable ledger finalization record exceeds ${MAX_FINALIZATION_RECORD_BYTES} bytes.`
        )
      }
      const result = this.database
        .prepare(`
          UPDATE ledger_heads
             SET finalized = 1,
                 finalization_operation_hash = ?,
                 authority_root_hash = ?
           WHERE plan_hash = ?
             AND registry_hash = ?
             AND finalized = 0
             AND ledger_sequence = ?
             AND ledger_root_hash = ?
             AND ledger_event_hash = ?
             AND accepted_artifact_count = ?
        `)
        .run(
          operation.operationHash,
          commit.rootHash,
          operation.planHash,
          operation.registryHash,
          operation.expectedLedgerSequence,
          operation.expectedLedgerRootHash,
          operation.trustedCheckpointEventHash,
          operation.artifactCount
        )
      if (result.changes !== 1) {
        fail('CAS', 'Ledger finalization lost its final transactional head fence.')
      }
      this.database
        .prepare(`
          INSERT INTO finalization_records(
            plan_hash, operation_hash, operation_json, commit_json
          ) VALUES (?, ?, ?, ?)
        `)
        .run(
          operation.planHash,
          operation.operationHash,
          operationJson,
          commitJson
        )
      return commit
    })
  }

  recover(
    operationValue: LedgerFinalizationOperation
  ): LedgerFinalizationAuthorityCommit | undefined {
    this.assertOpen()
    const operation = normalizeLedgerFinalizationOperation(operationValue)
    const current = this.current(operation.planHash)
    if (
      current &&
      canonicalStringify(current.operation) !== canonicalStringify(operation)
    ) {
      return undefined
    }
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
    const expectedBinding: LedgerFinalizationCommitBinding = {
      authorityId: this.authorityId,
      version: 1,
      committedAt: operation.occurredAt,
      previousRootHash: commit.previousRootHash,
      rootHash: ZERO_HASH,
      operationHash: operation.operationHash
    }
    const expectedRootHash = computeLedgerPublicationAuthorityRootHash(
      'finalize',
      expectedBinding
    )
    if (
      operation.authorityId !== this.authorityId ||
      commit.authorityId !== this.authorityId ||
      commit.version !== 1 ||
      commit.committedAt !== operation.occurredAt ||
      commit.rootHash !== expectedRootHash ||
      commit.operationHash !== operation.operationHash
    ) {
      fail(
        'TRUST',
        'Ledger finalization authority commit does not match its operation.'
      )
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
