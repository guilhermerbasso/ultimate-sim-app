import {
  type AuthenticatedPrincipalBinding,
  type GovernanceRole,
  type OpaqueAttestation,
  type PromptApprovalCheckpoint,
  type PromptApprovalCheckpointBinding,
  type SchedulerAuthorityCommit,
  type SchedulerAuthorityDependencies,
  type SchedulerAuthorityOperation,
  type SchedulerServiceReceiptBinding,
  invokeSynchronousVerifier,
  parseOpaqueAttestation
} from './authorities'
import {
  assertExactKeys,
  assertIdentifier,
  assertIsoTimestamp,
  assertNullableIdentifier,
  assertNullableSafeInteger,
  assertPlainObject,
  assertSafeInteger,
  assertSerializedLengthsWithinRuntimeCeiling,
  assertSerializedTextWithinRuntimeCeiling,
  assertSha256,
  canonicalStringify,
  cloneCanonical,
  compareIso,
  deepFreeze,
  sha256Hex,
  utf8ByteLength
} from './canonical'
import {
  IMAGE_REQUEST_LIMIT,
  MAX_IMAGE_ATTEMPTS,
  MAX_REVISIONS_PER_ARTIFACT,
  MAX_SCHEDULER_EVENTS,
  MAX_SERIALIZED_BYTES,
  MAX_SERIALIZED_BYTES_PER_SCHEDULER_ATTEMPT,
  MAX_SERIALIZED_ENVELOPE_FRAMING_BYTES,
  VISUAL_ARTIFACT_LEDGER_VERSION,
  ZERO_HASH
} from './constants'
import { fail } from './errors'
import { parseArtifactId, type ArtifactId } from './plan'

export interface ImageSchedulingPolicy {
  readonly windowMs: number
  readonly requestLimit: typeof IMAGE_REQUEST_LIMIT
  readonly maxAttempts: number
  readonly baseBackoffMs: number
  readonly maxBackoffMs: number
}

export type ImageFailureReason =
  | 'rate-limit'
  | 'timeout'
  | 'transient-service'
  | 'content-policy'
  | 'quota-exhausted'
  | 'budget-exhausted'
  | 'authentication'
  | 'deployment-mismatch'
  | 'manual-review'

export type SchedulerCallStatus = 'reserved' | 'dispatched' | 'succeeded' | 'failed' | 'ambiguous'
export type SchedulerAction =
  | 'configure'
  | 'reserve'
  | 'dispatch'
  | 'succeed'
  | 'fail'
  | 'ambiguous'

interface SchedulerAuthorityHeader {
  readonly authorityId: string
  readonly authorityVersion: number
  readonly authorityPreviousRootHash: string
  readonly authorityRootHash: string
  readonly authorityOperationHash: string
  readonly authorityAttestation: OpaqueAttestation
}

interface SchedulerEventHeader extends SchedulerAuthorityHeader {
  readonly sequence: number
  readonly type: SchedulerEvent['type']
  readonly occurredAt: string
  readonly actorId: string
  readonly principalAttestation: OpaqueAttestation
  readonly previousEventHash: string
  readonly eventHash: string
}

export interface SchedulerConfiguredEvent extends SchedulerEventHeader {
  readonly type: 'scheduler-configured'
  readonly policyHash: string
}

export interface ImageCallReservedEvent extends SchedulerEventHeader {
  readonly type: 'image-call-reserved'
  readonly callId: string
  readonly artifactId: ArtifactId
  readonly revision: number
  readonly attempt: number
  readonly promptHash: string
  readonly promptApprovalHash: string
  readonly approvalLedgerRootHash: string
  readonly approvalLedgerSequence: number
  readonly approvalPlanHash: string
  readonly promptApprovedAt: string
  readonly approvalCheckpointAttestation: OpaqueAttestation
  readonly requestHash: string
  readonly idempotencyKey: string
  readonly retryOfCallId: string | null
  readonly retryReason: ImageFailureReason | null
}

export interface ImageCallDispatchedEvent extends SchedulerEventHeader {
  readonly type: 'image-call-dispatched'
  readonly callId: string
}

export interface ImageCallSucceededEvent extends SchedulerEventHeader {
  readonly type: 'image-call-succeeded'
  readonly callId: string
  readonly imageHash: string
  readonly serviceReceiptAttestation: OpaqueAttestation
}

export interface ImageCallFailedEvent extends SchedulerEventHeader {
  readonly type: 'image-call-failed'
  readonly callId: string
  readonly failureReason: ImageFailureReason
  readonly retryAfterMs: number | null
  readonly retryNotBefore: string
}

export interface ImageCallAmbiguousEvent extends SchedulerEventHeader {
  readonly type: 'image-call-ambiguous'
  readonly callId: string
  readonly ambiguityReason: 'ambiguous-dispatch'
}

export type SchedulerEvent =
  | SchedulerConfiguredEvent
  | ImageCallReservedEvent
  | ImageCallDispatchedEvent
  | ImageCallSucceededEvent
  | ImageCallFailedEvent
  | ImageCallAmbiguousEvent

interface MutableCallState {
  callId: string
  artifactId: ArtifactId
  revision: number
  attempt: number
  promptHash: string
  promptApprovalHash: string
  approvalLedgerRootHash: string
  approvalLedgerSequence: number
  approvalPlanHash: string
  promptApprovedAt: string
  approvalCheckpointAttestation: OpaqueAttestation
  requestHash: string
  idempotencyKey: string
  policyHash: string
  retryOfCallId: string | null
  retryReason: ImageFailureReason | null
  reservedAt: string
  dispatchedAt?: string
  completedAt?: string
  retryAfterMs?: number | null
  retryNotBefore?: string
  failureReason?: ImageFailureReason | 'ambiguous-dispatch'
  imageHash?: string
  serviceReceiptAttestation?: OpaqueAttestation
  status: SchedulerCallStatus
  callHash: string
  dispatchAuthorityVersion?: number
  dispatchAuthorityRootHash?: string
  completionAuthorityVersion?: number
  completionAuthorityRootHash?: string
  completionAuthorityCommitHash?: string
  serializedBytes: number
}

export interface SchedulerCallSnapshot {
  readonly callId: string
  readonly artifactId: ArtifactId
  readonly revision: number
  readonly attempt: number
  readonly promptHash: string
  readonly promptApprovalHash: string
  readonly approvalLedgerRootHash: string
  readonly approvalLedgerSequence: number
  readonly approvalPlanHash: string
  readonly promptApprovedAt: string
  readonly requestHash: string
  readonly idempotencyKey: string
  readonly policyHash: string
  readonly retryOfCallId: string | null
  readonly retryReason: ImageFailureReason | null
  readonly reservedAt: string
  readonly dispatchedAt?: string
  readonly completedAt?: string
  readonly retryAfterMs?: number | null
  readonly retryNotBefore?: string
  readonly failureReason?: ImageFailureReason | 'ambiguous-dispatch'
  readonly imageHash?: string
  readonly status: SchedulerCallStatus
  readonly callHash: string
  readonly dispatchAuthorityVersion?: number
  readonly dispatchAuthorityRootHash?: string
  readonly completionAuthorityVersion?: number
  readonly completionAuthorityRootHash?: string
  readonly completionAuthorityCommitHash?: string
}

export interface SchedulerReceipt {
  readonly callId: string
  readonly callHash: string
  readonly artifactId: ArtifactId
  readonly revision: number
  readonly attempt: number
  readonly promptHash: string
  readonly promptApprovalHash: string
  readonly approvalLedgerRootHash: string
  readonly approvalLedgerSequence: number
  readonly approvalPlanHash: string
  readonly promptApprovedAt: string
  readonly requestHash: string
  readonly idempotencyKey: string
  readonly policyHash: string
  readonly imageHash: string
  readonly reservedAt: string
  readonly dispatchedAt: string
  readonly completedAt: string
  readonly authorityId: string
  readonly authorityVersion: number
  readonly authorityRootHash: string
  readonly authorityCommitHash: string
  readonly status: 'succeeded'
  readonly receiptHash: string
}

export interface SerializedImageScheduler {
  readonly schemaVersion: typeof VISUAL_ARTIFACT_LEDGER_VERSION
  readonly policy: ImageSchedulingPolicy
  readonly policyHash: string
  readonly authorityId: string
  readonly rootAttestation: OpaqueAttestation
  readonly events: readonly SchedulerEvent[]
}

export interface SchedulerGenesisInput {
  readonly actorId: string
}

export interface SchedulerReserveInput {
  readonly actorId: string
  readonly callId: string
  readonly artifactId: ArtifactId
  readonly revision: number
  readonly attempt: number
  readonly promptHash: string
  readonly promptApprovalHash: string
  readonly approvalCheckpoint: PromptApprovalCheckpoint
  readonly requestHash: string
  readonly retryOfCallId: string | null
  readonly retryReason: ImageFailureReason | null
}

export interface SchedulerCallInput {
  readonly actorId: string
  readonly callId: string
}

export interface SchedulerSuccessInput extends SchedulerCallInput {
  readonly imageHash: string
  readonly serviceReceiptAttestation: OpaqueAttestation
}

export interface SchedulerFailureInput extends SchedulerCallInput {
  readonly failureReason: ImageFailureReason
  readonly retryAfterMs: number | null
}

export interface SchedulerAmbiguousInput extends SchedulerCallInput {
  readonly ambiguityReason: 'ambiguous-dispatch'
}

const POLICY_KEYS = [
  'windowMs',
  'requestLimit',
  'maxAttempts',
  'baseBackoffMs',
  'maxBackoffMs'
] as const

const AUTHORITY_HEADER_KEYS = [
  'authorityId',
  'authorityVersion',
  'authorityPreviousRootHash',
  'authorityRootHash',
  'authorityOperationHash',
  'authorityAttestation'
] as const

const EVENT_HEADER_KEYS = [
  'sequence',
  'type',
  'occurredAt',
  'actorId',
  'principalAttestation',
  'previousEventHash',
  'eventHash',
  ...AUTHORITY_HEADER_KEYS
] as const

const FAILURE_REASONS: readonly ImageFailureReason[] = [
  'rate-limit',
  'timeout',
  'transient-service',
  'content-policy',
  'quota-exhausted',
  'budget-exhausted',
  'authentication',
  'deployment-mismatch',
  'manual-review'
]

function assertDependencies(
  dependencies: SchedulerAuthorityDependencies
): SchedulerAuthorityDependencies {
  if (
    typeof dependencies !== 'object' ||
    dependencies === null ||
    typeof dependencies.authority?.commit !== 'function' ||
    typeof dependencies.authority?.recover !== 'function' ||
    typeof dependencies.authority?.verifyCommit !== 'function' ||
    typeof dependencies.principalVerifier?.verifyPrincipal !== 'function' ||
    typeof dependencies.approvalVerifier?.verifyPromptApprovalCheckpoint !== 'function' ||
    typeof dependencies.serviceReceiptVerifier?.verifyServiceReceipt !== 'function' ||
    typeof dependencies.rootVerifier?.verifyRoot !== 'function'
  ) {
    fail('TRUST', 'Scheduler requires explicit trusted authority and verifier dependencies.')
  }
  assertIdentifier(dependencies.authority.authorityId, 'Scheduler authority id')
  return dependencies
}

function assertFailureReason(value: unknown, label: string): ImageFailureReason {
  if (!FAILURE_REASONS.includes(value as ImageFailureReason)) {
    fail('SCHEMA', `${label} is not an allowed immediate failure reason.`)
  }
  return value as ImageFailureReason
}

export function parseImageSchedulingPolicy(value: unknown): ImageSchedulingPolicy {
  assertPlainObject(value, 'Image scheduling policy')
  assertExactKeys(value, POLICY_KEYS, 'Image scheduling policy')
  const windowMs = assertSafeInteger(value.windowMs, 'Image scheduling policy windowMs', 1, 86_400_000)
  if (value.requestLimit !== IMAGE_REQUEST_LIMIT) {
    fail('POLICY', `Image scheduling policy requestLimit must be exactly ${IMAGE_REQUEST_LIMIT}.`)
  }
  const maxAttempts = assertSafeInteger(
    value.maxAttempts,
    'Image scheduling policy maxAttempts',
    1,
    MAX_IMAGE_ATTEMPTS
  )
  const baseBackoffMs = assertSafeInteger(
    value.baseBackoffMs,
    'Image scheduling policy baseBackoffMs',
    1,
    86_400_000
  )
  const maxBackoffMs = assertSafeInteger(
    value.maxBackoffMs,
    'Image scheduling policy maxBackoffMs',
    baseBackoffMs,
    2_592_000_000
  )
  return deepFreeze({
    windowMs,
    requestLimit: IMAGE_REQUEST_LIMIT,
    maxAttempts,
    baseBackoffMs,
    maxBackoffMs
  })
}

export function computeImageSchedulingPolicyHash(policy: ImageSchedulingPolicy): string {
  return sha256Hex({
    domain: 'image-scheduling-policy-v3',
    policy: parseImageSchedulingPolicy(policy)
  })
}

export function computeImageBackoffMs(attempt: number, policy: ImageSchedulingPolicy): number {
  const parsed = parseImageSchedulingPolicy(policy)
  assertSafeInteger(attempt, 'Image attempt', 1, parsed.maxAttempts)
  return Math.min(parsed.maxBackoffMs, parsed.baseBackoffMs * 2 ** (attempt - 1))
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  const result = Date.parse(timestamp) + milliseconds
  if (!Number.isFinite(result) || Math.abs(result) > 8_640_000_000_000_000) {
    fail('POLICY', 'Image retry backoff exceeds the supported timestamp range.')
  }
  return new Date(result).toISOString()
}

function revisionKey(planHash: string, artifactId: ArtifactId, revision: number): string {
  return `${planHash}#${artifactId}#${revision}`
}

function idempotencyKeyFor(input: {
  artifactId: ArtifactId
  revision: number
  attempt: number
  promptHash: string
  promptApprovalHash: string
  approvalLedgerRootHash: string
  approvalLedgerSequence: number
  approvalPlanHash: string
  promptApprovedAt: string
  requestHash: string
  policyHash: string
}): string {
  return `img:v3:${sha256Hex({ domain: 'image-idempotency-v3', ...input })}`
}

export function computeSchedulerEventHash(event: Omit<SchedulerEvent, 'eventHash'>): string {
  return sha256Hex({ domain: 'image-scheduler-event-v3', event })
}

export function computeSchedulerRootHash(
  policyHash: string,
  sequence: number,
  lastEventHash: string
): string {
  assertSha256(policyHash, 'Scheduler root policyHash')
  assertSafeInteger(sequence, 'Scheduler root sequence', 0, MAX_SCHEDULER_EVENTS)
  assertSha256(lastEventHash, 'Scheduler root lastEventHash')
  return sha256Hex({
    domain: 'image-scheduler-root-v3',
    policyHash,
    sequence,
    lastEventHash
  })
}

function commitHash(commit: SchedulerAuthorityCommit): string {
  return sha256Hex({ domain: 'scheduler-authority-commit-v1', commit })
}

function receiptFromCall(call: MutableCallState, authorityId: string): SchedulerReceipt {
  if (
    call.status !== 'succeeded' ||
    !call.dispatchedAt ||
    !call.completedAt ||
    !call.imageHash ||
    call.completionAuthorityVersion === undefined ||
    !call.completionAuthorityRootHash ||
    !call.completionAuthorityCommitHash
  ) {
    fail('RECEIPT', `Scheduler call "${call.callId}" is not a committed succeeded image call.`)
  }
  const payload = {
    callId: call.callId,
    callHash: call.callHash,
    artifactId: call.artifactId,
    revision: call.revision,
    attempt: call.attempt,
    promptHash: call.promptHash,
    promptApprovalHash: call.promptApprovalHash,
    approvalLedgerRootHash: call.approvalLedgerRootHash,
    approvalLedgerSequence: call.approvalLedgerSequence,
    approvalPlanHash: call.approvalPlanHash,
    promptApprovedAt: call.promptApprovedAt,
    requestHash: call.requestHash,
    idempotencyKey: call.idempotencyKey,
    policyHash: call.policyHash,
    imageHash: call.imageHash,
    reservedAt: call.reservedAt,
    dispatchedAt: call.dispatchedAt,
    completedAt: call.completedAt,
    authorityId,
    authorityVersion: call.completionAuthorityVersion,
    authorityRootHash: call.completionAuthorityRootHash,
    authorityCommitHash: call.completionAuthorityCommitHash,
    status: 'succeeded' as const
  }
  return deepFreeze({
    ...payload,
    receiptHash: sha256Hex({ domain: 'image-scheduler-receipt-v3', ...payload })
  })
}

function normalizeCheckpoint(value: unknown): PromptApprovalCheckpoint {
  assertPlainObject(value, 'Prompt approval checkpoint')
  assertExactKeys(
    value,
    [
      'ledgerRootHash',
      'ledgerSequence',
      'promptApprovedAt',
      'planHash',
      'artifactId',
      'revision',
      'promptHash',
      'promptApprovalEventHash',
      'attestation'
    ],
    'Prompt approval checkpoint'
  )
  return deepFreeze({
    ledgerRootHash: assertSha256(value.ledgerRootHash, 'Prompt approval checkpoint ledgerRootHash'),
    ledgerSequence: assertSafeInteger(
      value.ledgerSequence,
      'Prompt approval checkpoint ledgerSequence',
      1,
      MAX_SCHEDULER_EVENTS
    ),
    promptApprovedAt: assertIsoTimestamp(
      value.promptApprovedAt,
      'Prompt approval checkpoint promptApprovedAt'
    ),
    planHash: assertSha256(value.planHash, 'Prompt approval checkpoint planHash'),
    artifactId: parseArtifactId(value.artifactId).id,
    revision: assertSafeInteger(
      value.revision,
      'Prompt approval checkpoint revision',
      1,
      MAX_REVISIONS_PER_ARTIFACT
    ),
    promptHash: assertSha256(value.promptHash, 'Prompt approval checkpoint promptHash'),
    promptApprovalEventHash: assertSha256(
      value.promptApprovalEventHash,
      'Prompt approval checkpoint promptApprovalEventHash'
    ),
    attestation: parseOpaqueAttestation(
      value.attestation,
      'Prompt approval checkpoint attestation'
    )
  })
}

function checkpointBinding(checkpoint: PromptApprovalCheckpoint): PromptApprovalCheckpointBinding {
  const { attestation: _attestation, ...binding } = checkpoint
  return binding
}

function normalizeGenesis(value: unknown): SchedulerGenesisInput {
  assertPlainObject(value, 'Scheduler genesis')
  assertExactKeys(value, ['actorId'], 'Scheduler genesis')
  return { actorId: assertIdentifier(value.actorId, 'Scheduler genesis actorId') }
}

function normalizeReserve(value: unknown): SchedulerReserveInput {
  assertPlainObject(value, 'Image reservation')
  assertExactKeys(
    value,
    [
      'actorId',
      'callId',
      'artifactId',
      'revision',
      'attempt',
      'promptHash',
      'promptApprovalHash',
      'approvalCheckpoint',
      'requestHash',
      'retryOfCallId',
      'retryReason'
    ],
    'Image reservation'
  )
  const retryReason =
    value.retryReason === null
      ? null
      : assertFailureReason(value.retryReason, 'Image reservation retryReason')
  return {
    actorId: assertIdentifier(value.actorId, 'Image reservation actorId'),
    callId: assertIdentifier(value.callId, 'Image reservation callId'),
    artifactId: parseArtifactId(value.artifactId).id,
    revision: assertSafeInteger(
      value.revision,
      'Image reservation revision',
      1,
      MAX_REVISIONS_PER_ARTIFACT
    ),
    attempt: assertSafeInteger(
      value.attempt,
      'Image reservation attempt',
      1,
      MAX_IMAGE_ATTEMPTS
    ),
    promptHash: assertSha256(value.promptHash, 'Image reservation promptHash'),
    promptApprovalHash: assertSha256(
      value.promptApprovalHash,
      'Image reservation promptApprovalHash'
    ),
    approvalCheckpoint: normalizeCheckpoint(value.approvalCheckpoint),
    requestHash: assertSha256(value.requestHash, 'Image reservation requestHash'),
    retryOfCallId: assertNullableIdentifier(
      value.retryOfCallId,
      'Image reservation retryOfCallId'
    ),
    retryReason
  }
}

function normalizeCall(value: unknown, label: string): SchedulerCallInput {
  assertPlainObject(value, label)
  assertExactKeys(value, ['actorId', 'callId'], label)
  return {
    actorId: assertIdentifier(value.actorId, `${label} actorId`),
    callId: assertIdentifier(value.callId, `${label} callId`)
  }
}

function normalizeSuccess(value: unknown): SchedulerSuccessInput {
  assertPlainObject(value, 'Image success')
  assertExactKeys(
    value,
    ['actorId', 'callId', 'imageHash', 'serviceReceiptAttestation'],
    'Image success'
  )
  return {
    actorId: assertIdentifier(value.actorId, 'Image success actorId'),
    callId: assertIdentifier(value.callId, 'Image success callId'),
    imageHash: assertSha256(value.imageHash, 'Image success imageHash'),
    serviceReceiptAttestation: parseOpaqueAttestation(
      value.serviceReceiptAttestation,
      'Image service receipt attestation'
    )
  }
}

function normalizeFailure(value: unknown): SchedulerFailureInput {
  assertPlainObject(value, 'Image failure')
  assertExactKeys(
    value,
    ['actorId', 'callId', 'failureReason', 'retryAfterMs'],
    'Image failure'
  )
  return {
    actorId: assertIdentifier(value.actorId, 'Image failure actorId'),
    callId: assertIdentifier(value.callId, 'Image failure callId'),
    failureReason: assertFailureReason(value.failureReason, 'Image failure reason'),
    retryAfterMs: assertNullableSafeInteger(
      value.retryAfterMs,
      'Image failure retryAfterMs',
      1,
      2_592_000_000
    )
  }
}

function normalizeAmbiguous(value: unknown): SchedulerAmbiguousInput {
  assertPlainObject(value, 'Ambiguous image dispatch')
  assertExactKeys(
    value,
    ['actorId', 'callId', 'ambiguityReason'],
    'Ambiguous image dispatch'
  )
  if (value.ambiguityReason !== 'ambiguous-dispatch') {
    fail('SCHEMA', 'Ambiguous image dispatch reason must be "ambiguous-dispatch".')
  }
  return {
    actorId: assertIdentifier(value.actorId, 'Ambiguous image dispatch actorId'),
    callId: assertIdentifier(value.callId, 'Ambiguous image dispatch callId'),
    ambiguityReason: 'ambiguous-dispatch'
  }
}

function roleForAction(action: SchedulerAction): GovernanceRole {
  return action === 'configure' || action === 'reserve'
    ? 'scheduler-control'
    : 'scheduler-worker'
}

export function schedulerGenesisPrincipalBinding(
  policyValue: unknown,
  genesisValue: unknown,
  authorityIdValue: unknown
): AuthenticatedPrincipalBinding {
  const policy = parseImageSchedulingPolicy(policyValue)
  const genesis = normalizeGenesis(genesisValue)
  const authorityId = assertIdentifier(authorityIdValue, 'Scheduler authority id')
  return deepFreeze({
    domain: 'image-scheduler',
    principalId: genesis.actorId,
    role: 'scheduler-control',
    action: 'configure',
    actionHash: sha256Hex({
      domain: 'scheduler-principal-action-v1',
      action: 'configure',
      normalized: genesis,
      policyHash: computeImageSchedulingPolicyHash(policy),
      authorityId
    }),
    contextRootHash: ZERO_HASH,
    contextVersion: 0
  })
}

export class ValidatedImageScheduler {
  readonly policy: ImageSchedulingPolicy
  readonly policyHash: string
  readonly authorityId: string

  private authorityVersion = 0
  private authorityRootHash = ZERO_HASH
  private readonly eventLog: SchedulerEvent[] = []
  private readonly calls = new Map<string, MutableCallState>()
  private readonly latestCallByRevision = new Map<string, MutableCallState>()
  private readonly receipts = new Map<string, SchedulerReceipt>()
  private readonly dispatchTimes: number[] = []
  private dispatchWindowStart = 0
  private outstandingReservations = 0
  private lastTimestamp = ''
  private lastEventHash = ZERO_HASH
  private circuitOpen = false
  private serializedEventBytes = 0

  private constructor(
    policy: ImageSchedulingPolicy,
    private readonly dependencies: SchedulerAuthorityDependencies
  ) {
    this.policy = policy
    this.policyHash = computeImageSchedulingPolicyHash(policy)
    this.authorityId = dependencies.authority.authorityId
  }

  static create(
    policyValue: unknown,
    genesisValue: unknown,
    dependenciesValue: SchedulerAuthorityDependencies,
    principalAttestationValue: unknown
  ): ValidatedImageScheduler {
    const dependencies = assertDependencies(dependenciesValue)
    const policy = parseImageSchedulingPolicy(policyValue)
    const genesis = normalizeGenesis(genesisValue)
    const scheduler = new ValidatedImageScheduler(policy, dependencies)
    scheduler.configure(genesis, parseOpaqueAttestation(principalAttestationValue, 'Scheduler principal attestation'))
    return scheduler
  }

  get version(): number {
    return this.eventLog.length
  }

  get authorityCasVersion(): number {
    return this.authorityVersion
  }

  get authorityCommittedRootHash(): string {
    return this.authorityRootHash
  }

  get eventCount(): number {
    return this.eventLog.length
  }

  get callCount(): number {
    return this.calls.size
  }

  get isCircuitOpen(): boolean {
    return this.circuitOpen
  }

  get rootHash(): string {
    return computeSchedulerRootHash(this.policyHash, this.version, this.lastEventHash)
  }

  private actionHash(action: SchedulerAction, normalized: unknown): string {
    return sha256Hex({
      domain: 'scheduler-principal-action-v1',
      action,
      normalized,
      policyHash: this.policyHash,
      authorityId: this.authorityId
    })
  }

  principalBindingFor(action: SchedulerAction, value: unknown): AuthenticatedPrincipalBinding {
    const normalized =
      action === 'configure'
        ? normalizeGenesis(value)
        : action === 'reserve'
          ? normalizeReserve(value)
          : action === 'dispatch'
            ? normalizeCall(value, 'Image dispatch')
            : action === 'succeed'
              ? normalizeSuccess(value)
              : action === 'fail'
                ? normalizeFailure(value)
                : normalizeAmbiguous(value)
    return deepFreeze({
      domain: 'image-scheduler',
      principalId: normalized.actorId,
      role: roleForAction(action),
      action,
      actionHash: this.actionHash(action, normalized),
      contextRootHash: this.authorityRootHash,
      contextVersion: this.authorityVersion
    })
  }

  private verifyPrincipal(
    action: SchedulerAction,
    normalized: { actorId: string },
    attestation: OpaqueAttestation
  ): void {
    const binding: AuthenticatedPrincipalBinding = {
      domain: 'image-scheduler',
      principalId: normalized.actorId,
      role: roleForAction(action),
      action,
      actionHash: this.actionHash(action, normalized),
      contextRootHash: this.authorityRootHash,
      contextVersion: this.authorityVersion
    }
    invokeSynchronousVerifier(
      this.dependencies.principalVerifier.verifyPrincipal,
      this.dependencies.principalVerifier,
      [attestation, binding],
      `Scheduler principal verifier for ${action}`
    )
  }

  private operationFor(
    action: SchedulerAction,
    normalized: {
      actorId: string
      callId?: string
      artifactId?: ArtifactId
      revision?: number
      attempt?: number
      authorityNotBefore?: string | null
      authorityLatestCommittedAt?: string
    },
    principalAttestation: OpaqueAttestation
  ): SchedulerAuthorityOperation {
    const operationHash = sha256Hex({
      domain: 'scheduler-authority-operation-v1',
      action,
      normalized,
      principalAttestation,
      expectedVersion: this.authorityVersion,
      previousRootHash: this.authorityRootHash,
      policyHash: this.policyHash
    })
    const common = {
      expectedVersion: this.authorityVersion,
      previousRootHash: this.authorityRootHash,
      policyHash: this.policyHash,
      operationHash,
      principalId: normalized.actorId,
      principalRole: roleForAction(action) as 'scheduler-control' | 'scheduler-worker',
      principalAttestation
    }
    if (action === 'configure') {
      return {
        ...common,
        action,
        windowMs: this.policy.windowMs,
        requestLimit: this.policy.requestLimit
      }
    }
    if (action === 'reserve') {
      return {
        ...common,
        action,
        windowMs: this.policy.windowMs,
        requestLimit: this.policy.requestLimit,
        callId: normalized.callId!,
        artifactId: normalized.artifactId!,
        revision: normalized.revision!,
        attempt: normalized.attempt!,
        notBefore:
          (normalized as typeof normalized & { authorityNotBefore?: string | null })
            .authorityNotBefore ?? null
      }
    }
    if (action === 'fail') {
      return {
        ...common,
        action,
        callId: normalized.callId!,
        latestCommittedAt: normalized.authorityLatestCommittedAt!
      }
    }
    return { ...common, action, callId: normalized.callId! }
  }

  private commitOperation(
    operation: SchedulerAuthorityOperation,
    replayCommit?: SchedulerAuthorityCommit
  ): SchedulerAuthorityCommit {
    if (
      this.eventLog.length >= MAX_SCHEDULER_EVENTS ||
      this.authorityVersion >= MAX_SCHEDULER_EVENTS
    ) {
      fail('CARDINALITY', `Scheduler event limit ${MAX_SCHEDULER_EVENTS} reached before authority commit.`)
    }
    let commit: SchedulerAuthorityCommit
    if (replayCommit) {
      commit = replayCommit
    } else {
      try {
        commit = this.dependencies.authority.commit(operation)
      } catch (error) {
        const recovered = this.dependencies.authority.recover(operation)
        if (recovered) {
          commit = recovered
        } else {
          const message = error instanceof Error ? error.message : String(error)
          fail('CAS', `Scheduler authority rejected atomic commit: ${message}`)
        }
      }
    }
    assertPlainObject(commit, 'Scheduler authority commit')
    assertExactKeys(
      commit,
      [
        'authorityId',
        'version',
        'committedAt',
        'previousRootHash',
        'rootHash',
        'operationHash',
        'attestation'
      ],
      'Scheduler authority commit'
    )
    const normalizedCommit: SchedulerAuthorityCommit = {
      authorityId: assertIdentifier(commit.authorityId, 'Scheduler authority commit authorityId'),
      version: assertSafeInteger(
        commit.version,
        'Scheduler authority commit version',
        1,
        MAX_SCHEDULER_EVENTS
      ),
      committedAt: assertIsoTimestamp(
        commit.committedAt,
        'Scheduler authority commit committedAt'
      ),
      previousRootHash: assertSha256(
        commit.previousRootHash,
        'Scheduler authority commit previousRootHash'
      ),
      rootHash: assertSha256(commit.rootHash, 'Scheduler authority commit rootHash'),
      operationHash: assertSha256(
        commit.operationHash,
        'Scheduler authority commit operationHash'
      ),
      attestation: parseOpaqueAttestation(
        commit.attestation,
        'Scheduler authority commit attestation'
      )
    }
    if (
      normalizedCommit.authorityId !== this.authorityId ||
      normalizedCommit.version !== this.authorityVersion + 1 ||
      normalizedCommit.previousRootHash !== this.authorityRootHash ||
      normalizedCommit.operationHash !== operation.operationHash ||
      (this.lastTimestamp && compareIso(normalizedCommit.committedAt, this.lastTimestamp) < 0)
    ) {
      fail('TRUST', 'Scheduler authority returned an invalid or stale committed operation.')
    }
    invokeSynchronousVerifier(
      this.dependencies.authority.verifyCommit,
      this.dependencies.authority,
      [normalizedCommit, operation],
      'Scheduler authority commit verifier'
    )
    return deepFreeze(normalizedCommit)
  }

  private activeDispatchedCalls(atTimestamp: string): number {
    const threshold = Date.parse(atTimestamp) - this.policy.windowMs
    while (
      this.dispatchWindowStart < this.dispatchTimes.length &&
      this.dispatchTimes[this.dispatchWindowStart] < threshold
    ) {
      this.dispatchWindowStart += 1
    }
    return this.dispatchTimes.length - this.dispatchWindowStart
  }

  private assertAttemptEventBudget(
    input: Record<string, unknown> & { type: SchedulerEvent['type'] },
    actorId: string,
    principalAttestation: OpaqueAttestation,
    existingAttemptBytes: number
  ): void {
    const maximumToken = { token: 'x'.repeat(96) }
    const preview = {
      sequence: MAX_SCHEDULER_EVENTS,
      occurredAt: 'x'.repeat(32),
      actorId,
      principalAttestation,
      previousEventHash: 'f'.repeat(64),
      authorityId: this.authorityId,
      authorityVersion: MAX_SCHEDULER_EVENTS,
      authorityPreviousRootHash: 'f'.repeat(64),
      authorityRootHash: 'f'.repeat(64),
      authorityOperationHash: 'f'.repeat(64),
      authorityAttestation: maximumToken,
      ...input,
      eventHash: 'f'.repeat(64)
    }
    if (
      existingAttemptBytes + utf8ByteLength(canonicalStringify(preview)) >
      MAX_SERIALIZED_BYTES_PER_SCHEDULER_ATTEMPT
    ) {
      fail('CARDINALITY', 'Scheduler attempt serialized byte budget is exhausted.')
    }
  }

  private appendEvent(
    input: Record<string, unknown> & { type: SchedulerEvent['type'] },
    actorId: string,
    principalAttestation: OpaqueAttestation,
    commit: SchedulerAuthorityCommit,
    existingAttemptBytes?: number
  ): SchedulerEvent {
    if (this.eventLog.length >= MAX_SCHEDULER_EVENTS) {
      fail('CARDINALITY', `Scheduler event limit ${MAX_SCHEDULER_EVENTS} reached.`)
    }
    const withoutHash = {
      sequence: this.eventLog.length + 1,
      occurredAt: commit.committedAt,
      actorId,
      principalAttestation,
      previousEventHash: this.lastEventHash,
      authorityId: commit.authorityId,
      authorityVersion: commit.version,
      authorityPreviousRootHash: commit.previousRootHash,
      authorityRootHash: commit.rootHash,
      authorityOperationHash: commit.operationHash,
      authorityAttestation: commit.attestation,
      ...input
    } as Omit<SchedulerEvent, 'eventHash'>
    const event = deepFreeze({
      ...withoutHash,
      eventHash: computeSchedulerEventHash(withoutHash)
    }) as SchedulerEvent
    const eventBytes = utf8ByteLength(canonicalStringify(event))
    if (
      existingAttemptBytes !== undefined &&
      existingAttemptBytes + eventBytes >
        MAX_SERIALIZED_BYTES_PER_SCHEDULER_ATTEMPT
    ) {
      fail('CARDINALITY', 'Scheduler attempt serialized byte budget is exhausted.')
    }
    this.eventLog.push(event)
    this.serializedEventBytes += eventBytes
    this.lastTimestamp = event.occurredAt
    this.lastEventHash = event.eventHash
    this.authorityVersion = commit.version
    this.authorityRootHash = commit.rootHash
    return event
  }

  private configure(
    genesis: SchedulerGenesisInput,
    principalAttestation: OpaqueAttestation,
    replayCommit?: SchedulerAuthorityCommit
  ): SchedulerConfiguredEvent {
    if (this.version !== 0) fail('INTEGRITY', 'Scheduler can be configured only once.')
    this.verifyPrincipal('configure', genesis, principalAttestation)
    const operation = this.operationFor('configure', genesis, principalAttestation)
    const commit = this.commitOperation(operation, replayCommit)
    return this.appendEvent(
      { type: 'scheduler-configured', policyHash: this.policyHash },
      genesis.actorId,
      principalAttestation,
      commit
    ) as SchedulerConfiguredEvent
  }

  reserve(value: unknown, principalAttestationValue: unknown): ImageCallReservedEvent {
    return this.reserveInternal(
      normalizeReserve(value),
      parseOpaqueAttestation(principalAttestationValue, 'Scheduler principal attestation')
    )
  }

  private reserveInternal(
    input: SchedulerReserveInput,
    principalAttestation: OpaqueAttestation,
    replayCommit?: SchedulerAuthorityCommit
  ): ImageCallReservedEvent {
    this.verifyPrincipal('reserve', input, principalAttestation)
    if (this.calls.has(input.callId)) fail('INTEGRITY', `Scheduler call id "${input.callId}" is already used.`)
    if (this.circuitOpen) fail('CIRCUIT', 'The global image scheduler circuit is open.')
    if (input.attempt > this.policy.maxAttempts) {
      fail('POLICY', 'Image reservation attempt exceeds the immutable policy maximum.')
    }
    const checkpoint = input.approvalCheckpoint
    if (
      checkpoint.artifactId !== input.artifactId ||
      checkpoint.revision !== input.revision ||
      checkpoint.promptHash !== input.promptHash ||
      checkpoint.promptApprovalEventHash !== input.promptApprovalHash
    ) {
      fail('TRUST', 'Image reservation requires a trusted committed prompt-approval checkpoint.')
    }
    invokeSynchronousVerifier(
      this.dependencies.approvalVerifier.verifyPromptApprovalCheckpoint,
      this.dependencies.approvalVerifier,
      [checkpoint.attestation, checkpointBinding(checkpoint)],
      'Prompt approval checkpoint verifier'
    )

    const previous = this.latestCallByRevision.get(
      revisionKey(checkpoint.planHash, input.artifactId, input.revision)
    )
    if (input.attempt === 1) {
      if (previous || input.retryOfCallId !== null || input.retryReason !== null) {
        fail('POLICY', 'Image attempt 1 cannot be a retry and must be first for the revision.')
      }
    } else {
      if (!previous || previous.attempt !== input.attempt - 1) {
        fail('POLICY', 'Image retry attempts must be complete and contiguous from attempt 1.')
      }
      if (previous.status !== 'failed' || !previous.retryNotBefore || !previous.failureReason) {
        fail('POLICY', 'Only an immediate failed image call may be retried.')
      }
      if (
        input.retryOfCallId !== previous.callId ||
        input.retryReason !== previous.failureReason ||
        input.promptHash !== previous.promptHash ||
        input.promptApprovalHash !== previous.promptApprovalHash ||
        checkpoint.ledgerRootHash !== previous.approvalLedgerRootHash ||
        checkpoint.ledgerSequence !== previous.approvalLedgerSequence ||
        checkpoint.promptApprovedAt !== previous.promptApprovedAt
      ) {
        fail('POLICY', 'Retry must preserve the immediate failure, prompt, and approval checkpoint.')
      }
    }

    const idempotencyKey = idempotencyKeyFor({
      artifactId: input.artifactId,
      revision: input.revision,
      attempt: input.attempt,
      promptHash: input.promptHash,
      promptApprovalHash: input.promptApprovalHash,
      approvalLedgerRootHash: checkpoint.ledgerRootHash,
      approvalLedgerSequence: checkpoint.ledgerSequence,
      approvalPlanHash: checkpoint.planHash,
      promptApprovedAt: checkpoint.promptApprovedAt,
      requestHash: input.requestHash,
      policyHash: this.policyHash
    })
    const eventPayload = {
      type: 'image-call-reserved' as const,
      callId: input.callId,
      artifactId: input.artifactId,
      revision: input.revision,
      attempt: input.attempt,
      promptHash: input.promptHash,
      promptApprovalHash: input.promptApprovalHash,
      approvalLedgerRootHash: checkpoint.ledgerRootHash,
      approvalLedgerSequence: checkpoint.ledgerSequence,
      approvalPlanHash: checkpoint.planHash,
      promptApprovedAt: checkpoint.promptApprovedAt,
      approvalCheckpointAttestation: checkpoint.attestation,
      requestHash: input.requestHash,
      idempotencyKey,
      retryOfCallId: input.retryOfCallId,
      retryReason: input.retryReason
    }
    this.assertAttemptEventBudget(eventPayload, input.actorId, principalAttestation, 0)
    const approvalNotBefore = addMilliseconds(checkpoint.promptApprovedAt, 1)
    const authorityNotBefore =
      previous?.retryNotBefore &&
      compareIso(previous.retryNotBefore, approvalNotBefore) > 0
        ? previous.retryNotBefore
        : approvalNotBefore
    const operation = this.operationFor(
      'reserve',
      {
        ...input,
        authorityNotBefore
      },
      principalAttestation
    )
    const commit = this.commitOperation(operation, replayCommit)
    if (
      compareIso(commit.committedAt, authorityNotBefore) < 0
    ) {
      fail('POLICY', 'Image reservation was committed before approval/backoff elapsed.')
    }
    if (
      this.activeDispatchedCalls(commit.committedAt) + this.outstandingReservations >=
      IMAGE_REQUEST_LIMIT
    ) {
      fail('QUOTA', 'Authoritative scheduler commit exceeds the global six-request capacity.')
    }
    const event = this.appendEvent(
      eventPayload,
      input.actorId,
      principalAttestation,
      commit,
      0
    ) as ImageCallReservedEvent
    const serializedBytes = utf8ByteLength(canonicalStringify(event))
    if (serializedBytes > MAX_SERIALIZED_BYTES_PER_SCHEDULER_ATTEMPT) {
      fail(
        'CARDINALITY',
        `Scheduler attempt exceeds ${MAX_SERIALIZED_BYTES_PER_SCHEDULER_ATTEMPT} serialized bytes.`
      )
    }
    const call: MutableCallState = {
      callId: input.callId,
      artifactId: input.artifactId,
      revision: input.revision,
      attempt: input.attempt,
      promptHash: input.promptHash,
      promptApprovalHash: input.promptApprovalHash,
      approvalLedgerRootHash: checkpoint.ledgerRootHash,
      approvalLedgerSequence: checkpoint.ledgerSequence,
      approvalPlanHash: checkpoint.planHash,
      promptApprovedAt: checkpoint.promptApprovedAt,
      approvalCheckpointAttestation: checkpoint.attestation,
      requestHash: input.requestHash,
      idempotencyKey,
      policyHash: this.policyHash,
      retryOfCallId: input.retryOfCallId,
      retryReason: input.retryReason,
      reservedAt: event.occurredAt,
      status: 'reserved',
      callHash: event.eventHash,
      serializedBytes
    }
    this.calls.set(input.callId, call)
    this.latestCallByRevision.set(
      revisionKey(checkpoint.planHash, input.artifactId, input.revision),
      call
    )
    this.outstandingReservations += 1
    return event
  }

  dispatch(value: unknown, principalAttestationValue: unknown): ImageCallDispatchedEvent {
    return this.dispatchInternal(
      normalizeCall(value, 'Image dispatch'),
      parseOpaqueAttestation(principalAttestationValue, 'Scheduler principal attestation')
    )
  }

  private dispatchInternal(
    input: SchedulerCallInput,
    principalAttestation: OpaqueAttestation,
    replayCommit?: SchedulerAuthorityCommit
  ): ImageCallDispatchedEvent {
    this.verifyPrincipal('dispatch', input, principalAttestation)
    const call = this.calls.get(input.callId)
    if (!call || call.status !== 'reserved') fail('POLICY', 'Image dispatch requires one reservation.')
    if (this.circuitOpen) fail('CIRCUIT', 'Image dispatch is forbidden while the global circuit is open.')
    const eventPayload = {
      type: 'image-call-dispatched' as const,
      callId: input.callId
    }
    this.assertAttemptEventBudget(
      eventPayload,
      input.actorId,
      principalAttestation,
      call.serializedBytes
    )
    const operation = this.operationFor('dispatch', input, principalAttestation)
    const commit = this.commitOperation(operation, replayCommit)
    const aggregate =
      this.activeDispatchedCalls(commit.committedAt) + (this.outstandingReservations - 1) + 1
    if (aggregate > IMAGE_REQUEST_LIMIT) {
      fail('QUOTA', 'Authoritative delayed dispatch exceeds the global rolling window.')
    }
    const event = this.appendEvent(
      eventPayload,
      input.actorId,
      principalAttestation,
      commit,
      call.serializedBytes
    ) as ImageCallDispatchedEvent
    const eventBytes = utf8ByteLength(canonicalStringify(event))
    if (call.serializedBytes + eventBytes > MAX_SERIALIZED_BYTES_PER_SCHEDULER_ATTEMPT) {
      fail('CARDINALITY', 'Scheduler attempt serialized byte budget is exhausted.')
    }
    call.serializedBytes += eventBytes
    call.status = 'dispatched'
    call.dispatchedAt = event.occurredAt
    call.callHash = event.eventHash
    call.dispatchAuthorityVersion = commit.version
    call.dispatchAuthorityRootHash = commit.rootHash
    this.outstandingReservations -= 1
    this.dispatchTimes.push(Date.parse(event.occurredAt))
    return event
  }

  serviceReceiptBinding(callIdValue: unknown, imageHashValue: unknown): SchedulerServiceReceiptBinding {
    const callId = assertIdentifier(callIdValue, 'Scheduler service call id')
    const imageHash = assertSha256(imageHashValue, 'Scheduler service imageHash')
    const call = this.calls.get(callId)
    if (
      !call ||
      call.status !== 'dispatched' ||
      call.dispatchAuthorityVersion === undefined ||
      !call.dispatchAuthorityRootHash
    ) {
      fail('RECEIPT', 'Service receipt binding requires a committed dispatched call.')
    }
    return deepFreeze({
      authorityId: this.authorityId,
      dispatchAuthorityRootHash: call.dispatchAuthorityRootHash,
      dispatchAuthorityVersion: call.dispatchAuthorityVersion,
      callId: call.callId,
      artifactId: call.artifactId,
      revision: call.revision,
      attempt: call.attempt,
      promptHash: call.promptHash,
      promptApprovalHash: call.promptApprovalHash,
      approvalLedgerRootHash: call.approvalLedgerRootHash,
      approvalLedgerSequence: call.approvalLedgerSequence,
      approvalPlanHash: call.approvalPlanHash,
      promptApprovedAt: call.promptApprovedAt,
      requestHash: call.requestHash,
      idempotencyKey: call.idempotencyKey,
      policyHash: call.policyHash,
      imageHash
    })
  }

  succeed(value: unknown, principalAttestationValue: unknown): ImageCallSucceededEvent {
    return this.succeedInternal(
      normalizeSuccess(value),
      parseOpaqueAttestation(principalAttestationValue, 'Scheduler principal attestation')
    )
  }

  private succeedInternal(
    input: SchedulerSuccessInput,
    principalAttestation: OpaqueAttestation,
    replayCommit?: SchedulerAuthorityCommit
  ): ImageCallSucceededEvent {
    this.verifyPrincipal('succeed', input, principalAttestation)
    const call = this.calls.get(input.callId)
    if (!call || call.status !== 'dispatched') {
      fail('POLICY', 'Image success requires a committed dispatched call.')
    }
    const serviceBinding = this.serviceReceiptBinding(input.callId, input.imageHash)
    invokeSynchronousVerifier(
      this.dependencies.serviceReceiptVerifier.verifyServiceReceipt,
      this.dependencies.serviceReceiptVerifier,
      [input.serviceReceiptAttestation, serviceBinding],
      'Scheduler service receipt verifier'
    )
    const eventPayload = {
      type: 'image-call-succeeded' as const,
      callId: input.callId,
      imageHash: input.imageHash,
      serviceReceiptAttestation: input.serviceReceiptAttestation
    }
    this.assertAttemptEventBudget(
      eventPayload,
      input.actorId,
      principalAttestation,
      call.serializedBytes
    )
    const operation = this.operationFor('succeed', input, principalAttestation)
    const commit = this.commitOperation(operation, replayCommit)
    const event = this.appendEvent(
      eventPayload,
      input.actorId,
      principalAttestation,
      commit,
      call.serializedBytes
    ) as ImageCallSucceededEvent
    const eventBytes = utf8ByteLength(canonicalStringify(event))
    if (call.serializedBytes + eventBytes > MAX_SERIALIZED_BYTES_PER_SCHEDULER_ATTEMPT) {
      fail('CARDINALITY', 'Scheduler attempt serialized byte budget is exhausted.')
    }
    call.serializedBytes += eventBytes
    call.status = 'succeeded'
    call.completedAt = event.occurredAt
    call.imageHash = input.imageHash
    call.serviceReceiptAttestation = input.serviceReceiptAttestation
    call.callHash = event.eventHash
    call.completionAuthorityVersion = commit.version
    call.completionAuthorityRootHash = commit.rootHash
    call.completionAuthorityCommitHash = commitHash(commit)
    this.receipts.set(input.callId, receiptFromCall(call, this.authorityId))
    return event
  }

  fail(value: unknown, principalAttestationValue: unknown): ImageCallFailedEvent {
    return this.failInternal(
      normalizeFailure(value),
      parseOpaqueAttestation(principalAttestationValue, 'Scheduler principal attestation')
    )
  }

  private failInternal(
    input: SchedulerFailureInput,
    principalAttestation: OpaqueAttestation,
    replayCommit?: SchedulerAuthorityCommit
  ): ImageCallFailedEvent {
    this.verifyPrincipal('fail', input, principalAttestation)
    const call = this.calls.get(input.callId)
    if (!call || call.status !== 'dispatched') {
      fail('POLICY', 'Image failure requires a committed dispatched call.')
    }
    const backoffMs = Math.max(
      computeImageBackoffMs(call.attempt, this.policy),
      input.retryAfterMs ?? 0
    )
    this.assertAttemptEventBudget(
      {
        type: 'image-call-failed',
        callId: input.callId,
        failureReason: input.failureReason,
        retryAfterMs: input.retryAfterMs,
        retryNotBefore: 'x'.repeat(32)
      },
      input.actorId,
      principalAttestation,
      call.serializedBytes
    )
    const operation = this.operationFor(
      'fail',
      {
        ...input,
        authorityLatestCommittedAt: new Date(
          8_640_000_000_000_000 - backoffMs
        ).toISOString()
      },
      principalAttestation
    )
    const commit = this.commitOperation(operation, replayCommit)
    const retryNotBefore = addMilliseconds(
      commit.committedAt,
      backoffMs
    )
    const event = this.appendEvent(
      {
        type: 'image-call-failed',
        callId: input.callId,
        failureReason: input.failureReason,
        retryAfterMs: input.retryAfterMs,
        retryNotBefore
      },
      input.actorId,
      principalAttestation,
      commit,
      call.serializedBytes
    ) as ImageCallFailedEvent
    const eventBytes = utf8ByteLength(canonicalStringify(event))
    if (call.serializedBytes + eventBytes > MAX_SERIALIZED_BYTES_PER_SCHEDULER_ATTEMPT) {
      fail('CARDINALITY', 'Scheduler attempt serialized byte budget is exhausted.')
    }
    call.serializedBytes += eventBytes
    call.status = 'failed'
    call.completedAt = event.occurredAt
    call.failureReason = input.failureReason
    call.retryAfterMs = input.retryAfterMs
    call.retryNotBefore = retryNotBefore
    call.callHash = event.eventHash
    call.completionAuthorityVersion = commit.version
    call.completionAuthorityRootHash = commit.rootHash
    call.completionAuthorityCommitHash = commitHash(commit)
    return event
  }

  markAmbiguous(value: unknown, principalAttestationValue: unknown): ImageCallAmbiguousEvent {
    return this.ambiguousInternal(
      normalizeAmbiguous(value),
      parseOpaqueAttestation(principalAttestationValue, 'Scheduler principal attestation')
    )
  }

  private ambiguousInternal(
    input: SchedulerAmbiguousInput,
    principalAttestation: OpaqueAttestation,
    replayCommit?: SchedulerAuthorityCommit
  ): ImageCallAmbiguousEvent {
    this.verifyPrincipal('ambiguous', input, principalAttestation)
    const call = this.calls.get(input.callId)
    if (!call || call.status !== 'dispatched') {
      fail('POLICY', 'Ambiguity requires a committed dispatched call.')
    }
    const eventPayload = {
      type: 'image-call-ambiguous' as const,
      callId: input.callId,
      ambiguityReason: 'ambiguous-dispatch' as const
    }
    this.assertAttemptEventBudget(
      eventPayload,
      input.actorId,
      principalAttestation,
      call.serializedBytes
    )
    const operation = this.operationFor('ambiguous', input, principalAttestation)
    const commit = this.commitOperation(operation, replayCommit)
    const event = this.appendEvent(
      eventPayload,
      input.actorId,
      principalAttestation,
      commit,
      call.serializedBytes
    ) as ImageCallAmbiguousEvent
    const eventBytes = utf8ByteLength(canonicalStringify(event))
    if (call.serializedBytes + eventBytes > MAX_SERIALIZED_BYTES_PER_SCHEDULER_ATTEMPT) {
      fail('CARDINALITY', 'Scheduler attempt serialized byte budget is exhausted.')
    }
    call.serializedBytes += eventBytes
    call.status = 'ambiguous'
    call.completedAt = event.occurredAt
    call.failureReason = 'ambiguous-dispatch'
    call.callHash = event.eventHash
    call.completionAuthorityVersion = commit.version
    call.completionAuthorityRootHash = commit.rootHash
    call.completionAuthorityCommitHash = commitHash(commit)
    this.circuitOpen = true
    return event
  }

  getCall(callIdValue: unknown): SchedulerCallSnapshot | undefined {
    const callId = assertIdentifier(callIdValue, 'Scheduler call lookup id')
    const call = this.calls.get(callId)
    if (!call) return undefined
    const clone = cloneCanonical(call) as MutableCallState
    delete (clone as Partial<MutableCallState>).approvalCheckpointAttestation
    delete (clone as Partial<MutableCallState>).serviceReceiptAttestation
    delete (clone as Partial<MutableCallState>).serializedBytes
    return deepFreeze(clone) as SchedulerCallSnapshot
  }

  requireSucceededReceipt(callIdValue: unknown): SchedulerReceipt {
    const callId = assertIdentifier(callIdValue, 'Scheduler receipt call id')
    const receipt = this.receipts.get(callId)
    if (!receipt) fail('RECEIPT', `Scheduler call "${callId}" has no committed succeeded receipt.`)
    return receipt
  }

  requireExhaustedFailure(callIdValue: unknown): SchedulerCallSnapshot {
    const callId = assertIdentifier(callIdValue, 'Scheduler exhausted call id')
    const call = this.calls.get(callId)
    if (
      !call ||
      call.status !== 'failed' ||
      call.attempt !== this.policy.maxAttempts ||
      !call.failureReason ||
      call.completionAuthorityVersion === undefined ||
      !call.completionAuthorityRootHash
    ) {
      fail('RECEIPT', 'Revision exhaustion requires the final committed scheduler attempt to fail.')
    }
    return this.getCall(callId)!
  }

  events(): readonly SchedulerEvent[] {
    return deepFreeze(cloneCanonical(this.eventLog))
  }

  verifyRootAttestation(attestationValue: unknown): void {
    const attestation = parseOpaqueAttestation(attestationValue, 'Scheduler root attestation')
    invokeSynchronousVerifier(
      this.dependencies.rootVerifier.verifyRoot,
      this.dependencies.rootVerifier,
      [attestation, {
        domain: 'image-scheduler',
        purpose: 'envelope',
        rootHash: this.rootHash,
        version: this.version,
        contextHash: this.policyHash
      }],
      'Scheduler envelope root verifier'
    )
  }

  static serializeTrusted(
    scheduler: ValidatedImageScheduler,
    rootAttestationValue: unknown
  ): string {
    if (!(scheduler instanceof ValidatedImageScheduler)) {
      fail('SCHEMA', 'Only a validated scheduler instance can be serialized.')
    }
    scheduler.verifyRootAttestation(rootAttestationValue)
    const policyBytes = utf8ByteLength(canonicalStringify(scheduler.policy))
    const estimatedCharacters =
      policyBytes +
      scheduler.serializedEventBytes +
      Math.max(0, scheduler.eventLog.length - 1) +
      MAX_SERIALIZED_ENVELOPE_FRAMING_BYTES
    assertSerializedLengthsWithinRuntimeCeiling(
      estimatedCharacters,
      estimatedCharacters,
      'Serialized scheduler'
    )
    return canonicalStringify({
      schemaVersion: VISUAL_ARTIFACT_LEDGER_VERSION,
      policy: cloneCanonical(scheduler.policy),
      policyHash: scheduler.policyHash,
      authorityId: scheduler.authorityId,
      rootAttestation: parseOpaqueAttestation(
        rootAttestationValue,
        'Scheduler root attestation'
      ),
      events: scheduler.events()
    })
  }

  private static replayCommitFromEvent(event: Record<string, unknown>): SchedulerAuthorityCommit {
    return {
      authorityId: assertIdentifier(event.authorityId, 'Stored authorityId'),
      version: assertSafeInteger(event.authorityVersion, 'Stored authorityVersion', 1, MAX_SCHEDULER_EVENTS),
      committedAt: assertIsoTimestamp(event.occurredAt, 'Stored authority committedAt'),
      previousRootHash: assertSha256(
        event.authorityPreviousRootHash,
        'Stored authorityPreviousRootHash'
      ),
      rootHash: assertSha256(event.authorityRootHash, 'Stored authorityRootHash'),
      operationHash: assertSha256(event.authorityOperationHash, 'Stored authorityOperationHash'),
      attestation: parseOpaqueAttestation(
        event.authorityAttestation,
        'Stored authorityAttestation'
      )
    }
  }

  static parseTrusted(
    serialized: string,
    optionsValue: unknown
  ): ValidatedImageScheduler {
    assertSerializedTextWithinRuntimeCeiling(serialized, 'Serialized scheduler')
    assertPlainObject(optionsValue, 'Scheduler parse options')
    assertExactKeys(
      optionsValue,
      ['expectedPolicyHash', 'dependencies'],
      'Scheduler parse options'
    )
    const expectedPolicyHash = assertSha256(
      optionsValue.expectedPolicyHash,
      'Scheduler expected policy hash'
    )
    const dependencies = assertDependencies(
      optionsValue.dependencies as SchedulerAuthorityDependencies
    )
    let parsed: unknown
    try {
      parsed = JSON.parse(serialized)
    } catch {
      fail('SCHEMA', 'Serialized scheduler is not valid JSON.')
    }
    if (canonicalStringify(parsed) !== serialized) {
      fail('SCHEMA', 'Scheduler JSON must be byte-for-byte canonical and contain no duplicate keys.')
    }
    assertPlainObject(parsed, 'Serialized scheduler')
    assertExactKeys(
      parsed,
      [
        'schemaVersion',
        'policy',
        'policyHash',
        'authorityId',
        'rootAttestation',
        'events'
      ],
      'Serialized scheduler'
    )
    if (parsed.schemaVersion !== VISUAL_ARTIFACT_LEDGER_VERSION) {
      fail('SCHEMA', `Scheduler schemaVersion must be ${VISUAL_ARTIFACT_LEDGER_VERSION}.`)
    }
    const policy = parseImageSchedulingPolicy(parsed.policy)
    const policyHash = assertSha256(parsed.policyHash, 'Serialized scheduler policyHash')
    if (
      policyHash !== computeImageSchedulingPolicyHash(policy) ||
      policyHash !== expectedPolicyHash
    ) {
      fail('POLICY', 'Scheduler policy drifted from the externally trusted policy hash.')
    }
    const authorityId = assertIdentifier(parsed.authorityId, 'Serialized scheduler authorityId')
    if (authorityId !== dependencies.authority.authorityId) {
      fail('TRUST', 'Serialized scheduler belongs to a different authority.')
    }
    if (!Array.isArray(parsed.events) || parsed.events.length < 1) {
      fail('SCHEMA', 'Scheduler history must contain configuration.')
    }
    if (parsed.events.length > MAX_SCHEDULER_EVENTS) {
      fail('CARDINALITY', `Scheduler history exceeds ${MAX_SCHEDULER_EVENTS} events.`)
    }
    const scheduler = new ValidatedImageScheduler(policy, dependencies)
    let previousEventHash = ZERO_HASH
    for (let index = 0; index < parsed.events.length; index += 1) {
      const value = parsed.events[index]
      const sequence = index + 1
      assertPlainObject(value, `Scheduler event ${sequence}`)
      if (value.sequence !== sequence) fail('INTEGRITY', 'Scheduler event sequence is not contiguous.')
      if (value.previousEventHash !== previousEventHash) {
        fail('INTEGRITY', 'Scheduler previous-event hash chain is broken.')
      }
      const principalAttestation = parseOpaqueAttestation(
        value.principalAttestation,
        `Scheduler event ${sequence} principalAttestation`
      )
      const replayCommit = ValidatedImageScheduler.replayCommitFromEvent(value)
      let generated: SchedulerEvent
      if (value.type === 'scheduler-configured') {
        assertExactKeys(
          value,
          [...EVENT_HEADER_KEYS, 'policyHash'],
          `Scheduler event ${sequence}`
        )
        if (sequence !== 1 || value.policyHash !== policyHash) {
          fail('INTEGRITY', 'Scheduler configuration must be the first policy-bound event.')
        }
        generated = scheduler.configure(
          normalizeGenesis({ actorId: value.actorId }),
          principalAttestation,
          replayCommit
        )
      } else if (value.type === 'image-call-reserved') {
        assertExactKeys(
          value,
          [
            ...EVENT_HEADER_KEYS,
            'callId',
            'artifactId',
            'revision',
            'attempt',
            'promptHash',
            'promptApprovalHash',
            'approvalLedgerRootHash',
            'approvalLedgerSequence',
            'approvalPlanHash',
            'promptApprovedAt',
            'approvalCheckpointAttestation',
            'requestHash',
            'idempotencyKey',
            'retryOfCallId',
            'retryReason'
          ],
          `Scheduler event ${sequence}`
        )
        const approvalCheckpointAttestation = parseOpaqueAttestation(
          value.approvalCheckpointAttestation,
          'Stored approval checkpoint attestation'
        )
        generated = scheduler.reserveInternal(
          normalizeReserve({
            actorId: value.actorId,
            callId: value.callId,
            artifactId: value.artifactId,
            revision: value.revision,
            attempt: value.attempt,
            promptHash: value.promptHash,
            promptApprovalHash: value.promptApprovalHash,
            approvalCheckpoint: {
              ledgerRootHash: value.approvalLedgerRootHash,
              ledgerSequence: value.approvalLedgerSequence,
              promptApprovedAt: value.promptApprovedAt,
              planHash: value.approvalPlanHash,
              artifactId: value.artifactId,
              revision: value.revision,
              promptHash: value.promptHash,
              promptApprovalEventHash: value.promptApprovalHash,
              attestation: approvalCheckpointAttestation
            },
            requestHash: value.requestHash,
            retryOfCallId: value.retryOfCallId,
            retryReason: value.retryReason
          }),
          principalAttestation,
          replayCommit
        )
      } else if (value.type === 'image-call-dispatched') {
        assertExactKeys(value, [...EVENT_HEADER_KEYS, 'callId'], `Scheduler event ${sequence}`)
        generated = scheduler.dispatchInternal(
          normalizeCall({ actorId: value.actorId, callId: value.callId }, 'Image dispatch'),
          principalAttestation,
          replayCommit
        )
      } else if (value.type === 'image-call-succeeded') {
        assertExactKeys(
          value,
          [...EVENT_HEADER_KEYS, 'callId', 'imageHash', 'serviceReceiptAttestation'],
          `Scheduler event ${sequence}`
        )
        generated = scheduler.succeedInternal(
          normalizeSuccess({
            actorId: value.actorId,
            callId: value.callId,
            imageHash: value.imageHash,
            serviceReceiptAttestation: value.serviceReceiptAttestation
          }),
          principalAttestation,
          replayCommit
        )
      } else if (value.type === 'image-call-failed') {
        assertExactKeys(
          value,
          [
            ...EVENT_HEADER_KEYS,
            'callId',
            'failureReason',
            'retryAfterMs',
            'retryNotBefore'
          ],
          `Scheduler event ${sequence}`
        )
        generated = scheduler.failInternal(
          normalizeFailure({
            actorId: value.actorId,
            callId: value.callId,
            failureReason: value.failureReason,
            retryAfterMs: value.retryAfterMs
          }),
          principalAttestation,
          replayCommit
        )
      } else if (value.type === 'image-call-ambiguous') {
        assertExactKeys(
          value,
          [...EVENT_HEADER_KEYS, 'callId', 'ambiguityReason'],
          `Scheduler event ${sequence}`
        )
        generated = scheduler.ambiguousInternal(
          normalizeAmbiguous({
            actorId: value.actorId,
            callId: value.callId,
            ambiguityReason: value.ambiguityReason
          }),
          principalAttestation,
          replayCommit
        )
      } else {
        fail('SCHEMA', `Scheduler event ${sequence} has an unsupported type.`)
      }
      if (canonicalStringify(value) !== canonicalStringify(generated)) {
        fail('INTEGRITY', `Scheduler event ${sequence} does not match trusted replay.`)
      }
      previousEventHash = generated.eventHash
    }
    scheduler.verifyRootAttestation(parsed.rootAttestation)
    return scheduler
  }
}

export function serializeImageScheduler(
  scheduler: ValidatedImageScheduler,
  optionsValue: unknown
): string {
  assertPlainObject(optionsValue, 'Scheduler serialization options')
  assertExactKeys(optionsValue, ['rootAttestation'], 'Scheduler serialization options')
  return ValidatedImageScheduler.serializeTrusted(scheduler, optionsValue.rootAttestation)
}

export function parseImageScheduler(
  serialized: string,
  optionsValue: unknown
): ValidatedImageScheduler {
  return ValidatedImageScheduler.parseTrusted(serialized, optionsValue)
}
