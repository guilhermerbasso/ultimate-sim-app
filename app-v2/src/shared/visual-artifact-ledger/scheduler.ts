import {
  assertExactKeys,
  assertIdentifier,
  assertIsoTimestamp,
  assertNullableIdentifier,
  assertNullableSafeInteger,
  assertPlainObject,
  assertSafeInteger,
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
  MAX_SCHEDULER_EVENTS,
  MAX_SERIALIZED_BYTES,
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

interface SchedulerEventHeader {
  readonly sequence: number
  readonly expectedVersion: number
  readonly type: SchedulerEvent['type']
  readonly occurredAt: string
  readonly actorId: string
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
  status: SchedulerCallStatus
  callHash: string
}

export interface SchedulerCallSnapshot {
  readonly callId: string
  readonly artifactId: ArtifactId
  readonly revision: number
  readonly attempt: number
  readonly promptHash: string
  readonly promptApprovalHash: string
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
}

export interface SchedulerReceipt {
  readonly callId: string
  readonly callHash: string
  readonly artifactId: ArtifactId
  readonly revision: number
  readonly attempt: number
  readonly promptHash: string
  readonly promptApprovalHash: string
  readonly requestHash: string
  readonly idempotencyKey: string
  readonly policyHash: string
  readonly imageHash: string
  readonly reservedAt: string
  readonly dispatchedAt: string
  readonly completedAt: string
  readonly status: 'succeeded'
  readonly receiptHash: string
}

export interface SerializedImageScheduler {
  readonly schemaVersion: typeof VISUAL_ARTIFACT_LEDGER_VERSION
  readonly policy: ImageSchedulingPolicy
  readonly policyHash: string
  readonly events: readonly SchedulerEvent[]
}

const POLICY_KEYS = [
  'windowMs',
  'requestLimit',
  'maxAttempts',
  'baseBackoffMs',
  'maxBackoffMs'
] as const

const EVENT_HEADER_KEYS = [
  'sequence',
  'expectedVersion',
  'type',
  'occurredAt',
  'actorId',
  'previousEventHash',
  'eventHash'
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
  const maxAttempts = assertSafeInteger(value.maxAttempts, 'Image scheduling policy maxAttempts', 1, 10)
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
    domain: 'image-scheduling-policy-v2',
    policy: parseImageSchedulingPolicy(policy)
  })
}

export function computeImageBackoffMs(attempt: number, policy: ImageSchedulingPolicy): number {
  const parsed = parseImageSchedulingPolicy(policy)
  assertSafeInteger(attempt, 'Image attempt', 1, parsed.maxAttempts)
  return Math.min(parsed.maxBackoffMs, parsed.baseBackoffMs * 2 ** (attempt - 1))
}

function idempotencyKeyFor(
  artifactId: ArtifactId,
  revision: number,
  attempt: number,
  promptHash: string,
  promptApprovalHash: string,
  requestHash: string,
  policyHash: string
): string {
  return `img:v2:${sha256Hex({
    domain: 'image-idempotency-v2',
    artifactId,
    revision,
    attempt,
    promptHash,
    promptApprovalHash,
    requestHash,
    policyHash
  })}`
}

export function computeSchedulerEventHash(event: Omit<SchedulerEvent, 'eventHash'>): string {
  return sha256Hex({ domain: 'image-scheduler-event-v2', event })
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
    domain: 'image-scheduler-root-v2',
    policyHash,
    sequence,
    lastEventHash
  })
}

function receiptFromCall(call: MutableCallState): SchedulerReceipt {
  if (
    call.status !== 'succeeded' ||
    !call.dispatchedAt ||
    !call.completedAt ||
    !call.imageHash
  ) {
    fail('RECEIPT', `Scheduler call "${call.callId}" is not a succeeded image call.`)
  }
  const payload = {
    callId: call.callId,
    callHash: call.callHash,
    artifactId: call.artifactId,
    revision: call.revision,
    attempt: call.attempt,
    promptHash: call.promptHash,
    promptApprovalHash: call.promptApprovalHash,
    requestHash: call.requestHash,
    idempotencyKey: call.idempotencyKey,
    policyHash: call.policyHash,
    imageHash: call.imageHash,
    reservedAt: call.reservedAt,
    dispatchedAt: call.dispatchedAt,
    completedAt: call.completedAt,
    status: 'succeeded' as const
  }
  return deepFreeze({ ...payload, receiptHash: sha256Hex({ domain: 'image-scheduler-receipt-v2', ...payload }) })
}

function revisionKey(artifactId: ArtifactId, revision: number): string {
  return `${artifactId}#${revision}`
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  const result = Date.parse(timestamp) + milliseconds
  if (!Number.isFinite(result) || Math.abs(result) > 8_640_000_000_000_000) {
    fail('POLICY', 'Image retry backoff exceeds the supported timestamp range.')
  }
  return new Date(result).toISOString()
}

export class ValidatedImageScheduler {
  readonly policy: ImageSchedulingPolicy
  readonly policyHash: string

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

  private constructor(policy: ImageSchedulingPolicy) {
    this.policy = policy
    this.policyHash = computeImageSchedulingPolicyHash(policy)
  }

  static create(policyValue: unknown, genesisValue: unknown): ValidatedImageScheduler {
    const policy = parseImageSchedulingPolicy(policyValue)
    assertPlainObject(genesisValue, 'Scheduler genesis')
    assertExactKeys(genesisValue, ['occurredAt', 'actorId'], 'Scheduler genesis')
    const scheduler = new ValidatedImageScheduler(policy)
    scheduler.appendEvent({
      expectedVersion: 0,
      type: 'scheduler-configured',
      occurredAt: assertIsoTimestamp(genesisValue.occurredAt, 'Scheduler genesis occurredAt'),
      actorId: assertIdentifier(genesisValue.actorId, 'Scheduler genesis actorId'),
      policyHash: scheduler.policyHash
    })
    return scheduler
  }

  get version(): number {
    return this.eventLog.length
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

  private assertExpectedVersion(value: unknown): number {
    const expectedVersion = assertSafeInteger(
      value,
      'Scheduler expectedVersion',
      0,
      MAX_SCHEDULER_EVENTS
    )
    if (expectedVersion !== this.version) {
      fail('CAS', `Stale scheduler CAS version ${expectedVersion}; current version is ${this.version}.`)
    }
    return expectedVersion
  }

  private assertMonotonicTimestamp(timestamp: string): void {
    if (this.lastTimestamp && compareIso(timestamp, this.lastTimestamp) < 0) {
      fail('INTEGRITY', 'Scheduler event timestamps must be globally nondecreasing.')
    }
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

  private appendEvent(
    input:
      | {
          expectedVersion: number
          type: 'scheduler-configured'
          occurredAt: string
          actorId: string
          policyHash: string
        }
      | {
          expectedVersion: number
          type: 'image-call-reserved'
          occurredAt: string
          actorId: string
          callId: string
          artifactId: ArtifactId
          revision: number
          attempt: number
          promptHash: string
          promptApprovalHash: string
          requestHash: string
          idempotencyKey: string
          retryOfCallId: string | null
          retryReason: ImageFailureReason | null
        }
      | {
          expectedVersion: number
          type: 'image-call-dispatched'
          occurredAt: string
          actorId: string
          callId: string
        }
      | {
          expectedVersion: number
          type: 'image-call-succeeded'
          occurredAt: string
          actorId: string
          callId: string
          imageHash: string
        }
      | {
          expectedVersion: number
          type: 'image-call-failed'
          occurredAt: string
          actorId: string
          callId: string
          failureReason: ImageFailureReason
          retryAfterMs: number | null
          retryNotBefore: string
        }
      | {
          expectedVersion: number
          type: 'image-call-ambiguous'
          occurredAt: string
          actorId: string
          callId: string
          ambiguityReason: 'ambiguous-dispatch'
        }
  ): SchedulerEvent {
    if (this.eventLog.length >= MAX_SCHEDULER_EVENTS) {
      fail('CARDINALITY', `Scheduler event limit ${MAX_SCHEDULER_EVENTS} reached.`)
    }
    this.assertExpectedVersion(input.expectedVersion)
    this.assertMonotonicTimestamp(input.occurredAt)
    const withoutHash = {
      sequence: this.eventLog.length + 1,
      ...input,
      previousEventHash: this.lastEventHash
    } as Omit<SchedulerEvent, 'eventHash'>
    const event = deepFreeze({
      ...withoutHash,
      eventHash: computeSchedulerEventHash(withoutHash)
    }) as SchedulerEvent
    this.eventLog.push(event)
    this.lastTimestamp = event.occurredAt
    this.lastEventHash = event.eventHash
    return event
  }

  reserve(value: unknown): ImageCallReservedEvent {
    assertPlainObject(value, 'Image reservation')
    assertExactKeys(
      value,
      [
        'expectedVersion',
        'occurredAt',
        'actorId',
        'callId',
        'artifactId',
        'revision',
        'attempt',
        'promptHash',
        'promptApprovalHash',
        'requestHash',
        'retryOfCallId',
        'retryReason'
      ],
      'Image reservation'
    )
    const expectedVersion = this.assertExpectedVersion(value.expectedVersion)
    const occurredAt = assertIsoTimestamp(value.occurredAt, 'Image reservation occurredAt')
    this.assertMonotonicTimestamp(occurredAt)
    const actorId = assertIdentifier(value.actorId, 'Image reservation actorId')
    const callId = assertIdentifier(value.callId, 'Image reservation callId')
    if (this.calls.has(callId)) fail('INTEGRITY', `Scheduler call id "${callId}" is already used.`)
    if (this.calls.size >= Math.floor(MAX_SCHEDULER_EVENTS / 2)) {
      fail('CARDINALITY', 'Scheduler call cardinality limit reached.')
    }
    if (this.circuitOpen) fail('CIRCUIT', 'The global image scheduler circuit is open.')

    const artifactId = parseArtifactId(value.artifactId).id
    const revision = assertSafeInteger(value.revision, 'Image reservation revision', 1, 10_000)
    const attempt = assertSafeInteger(
      value.attempt,
      'Image reservation attempt',
      1,
      this.policy.maxAttempts
    )
    const promptHash = assertSha256(value.promptHash, 'Image reservation promptHash')
    const promptApprovalHash = assertSha256(
      value.promptApprovalHash,
      'Image reservation promptApprovalHash'
    )
    const requestHash = assertSha256(value.requestHash, 'Image reservation requestHash')
    const retryOfCallId = assertNullableIdentifier(value.retryOfCallId, 'Image reservation retryOfCallId')
    const retryReason =
      value.retryReason === null
        ? null
        : assertFailureReason(value.retryReason, 'Image reservation retryReason')

    const previous = this.latestCallByRevision.get(revisionKey(artifactId, revision))
    if (attempt === 1) {
      if (previous || retryOfCallId !== null || retryReason !== null) {
        fail('POLICY', 'Image attempt 1 cannot be a retry and must be the first call for the revision.')
      }
    } else {
      if (!previous || previous.attempt !== attempt - 1) {
        fail('POLICY', 'Image retry attempts must be complete and contiguous from attempt 1.')
      }
      if (previous.status !== 'failed' || !previous.retryNotBefore || !previous.failureReason) {
        fail('POLICY', 'Only an immediate failed image call may be retried.')
      }
      if (retryOfCallId !== previous.callId || retryReason !== previous.failureReason) {
        fail('POLICY', 'Image retry call and reason must match the immediate failed attempt.')
      }
      if (promptHash !== previous.promptHash) {
        fail('POLICY', 'Image retry promptHash must match the approved prompt used by the failed attempt.')
      }
      if (promptApprovalHash !== previous.promptApprovalHash) {
        fail('POLICY', 'Image retry promptApprovalHash must match the original prompt approval.')
      }
      if (compareIso(occurredAt, previous.retryNotBefore) < 0) {
        fail('POLICY', 'Image retry was reserved before its positive backoff elapsed.')
      }
    }

    if (this.activeDispatchedCalls(occurredAt) + this.outstandingReservations >= IMAGE_REQUEST_LIMIT) {
      fail('QUOTA', 'The global six-request rolling window is fully reserved.')
    }

    const idempotencyKey = idempotencyKeyFor(
      artifactId,
      revision,
      attempt,
      promptHash,
      promptApprovalHash,
      requestHash,
      this.policyHash
    )
    const event = this.appendEvent({
      expectedVersion,
      type: 'image-call-reserved',
      occurredAt,
      actorId,
      callId,
      artifactId,
      revision,
      attempt,
      promptHash,
      promptApprovalHash,
      requestHash,
      idempotencyKey,
      retryOfCallId,
      retryReason
    }) as ImageCallReservedEvent

    const call: MutableCallState = {
      callId,
      artifactId,
      revision,
      attempt,
      promptHash,
      promptApprovalHash,
      requestHash,
      idempotencyKey,
      policyHash: this.policyHash,
      retryOfCallId,
      retryReason,
      reservedAt: occurredAt,
      status: 'reserved',
      callHash: event.eventHash
    }
    this.calls.set(callId, call)
    this.latestCallByRevision.set(revisionKey(artifactId, revision), call)
    this.outstandingReservations += 1
    return event
  }

  dispatch(value: unknown): ImageCallDispatchedEvent {
    assertPlainObject(value, 'Image dispatch')
    assertExactKeys(value, ['expectedVersion', 'occurredAt', 'actorId', 'callId'], 'Image dispatch')
    const expectedVersion = this.assertExpectedVersion(value.expectedVersion)
    const occurredAt = assertIsoTimestamp(value.occurredAt, 'Image dispatch occurredAt')
    this.assertMonotonicTimestamp(occurredAt)
    const actorId = assertIdentifier(value.actorId, 'Image dispatch actorId')
    const callId = assertIdentifier(value.callId, 'Image dispatch callId')
    const call = this.calls.get(callId)
    if (!call || call.status !== 'reserved') fail('POLICY', 'Image dispatch requires one outstanding reservation.')
    if (this.circuitOpen) fail('CIRCUIT', 'Image dispatch is forbidden while the global circuit is open.')
    if (compareIso(occurredAt, call.reservedAt) < 0) {
      fail('INTEGRITY', 'Image dispatch cannot precede its reservation.')
    }
    const aggregateUsage =
      this.activeDispatchedCalls(occurredAt) + (this.outstandingReservations - 1) + 1
    if (aggregateUsage > IMAGE_REQUEST_LIMIT) {
      fail('QUOTA', 'Delayed dispatch would exceed the global rolling request window.')
    }

    const event = this.appendEvent({
      expectedVersion,
      type: 'image-call-dispatched',
      occurredAt,
      actorId,
      callId
    }) as ImageCallDispatchedEvent
    call.status = 'dispatched'
    call.dispatchedAt = occurredAt
    call.callHash = event.eventHash
    this.outstandingReservations -= 1
    this.dispatchTimes.push(Date.parse(occurredAt))
    return event
  }

  succeed(value: unknown): ImageCallSucceededEvent {
    assertPlainObject(value, 'Image success')
    assertExactKeys(
      value,
      ['expectedVersion', 'occurredAt', 'actorId', 'callId', 'imageHash'],
      'Image success'
    )
    const expectedVersion = this.assertExpectedVersion(value.expectedVersion)
    const occurredAt = assertIsoTimestamp(value.occurredAt, 'Image success occurredAt')
    this.assertMonotonicTimestamp(occurredAt)
    const actorId = assertIdentifier(value.actorId, 'Image success actorId')
    const callId = assertIdentifier(value.callId, 'Image success callId')
    const imageHash = assertSha256(value.imageHash, 'Image success imageHash')
    const call = this.calls.get(callId)
    if (!call || call.status !== 'dispatched' || !call.dispatchedAt) {
      fail('POLICY', 'Image success requires a dispatched, non-terminal call.')
    }
    if (compareIso(occurredAt, call.dispatchedAt) < 0) {
      fail('INTEGRITY', 'Image success cannot precede dispatch.')
    }

    const event = this.appendEvent({
      expectedVersion,
      type: 'image-call-succeeded',
      occurredAt,
      actorId,
      callId,
      imageHash
    }) as ImageCallSucceededEvent
    call.status = 'succeeded'
    call.completedAt = occurredAt
    call.imageHash = imageHash
    call.callHash = event.eventHash
    this.receipts.set(callId, receiptFromCall(call))
    return event
  }

  fail(value: unknown): ImageCallFailedEvent {
    assertPlainObject(value, 'Image failure')
    assertExactKeys(
      value,
      ['expectedVersion', 'occurredAt', 'actorId', 'callId', 'failureReason', 'retryAfterMs'],
      'Image failure'
    )
    const expectedVersion = this.assertExpectedVersion(value.expectedVersion)
    const occurredAt = assertIsoTimestamp(value.occurredAt, 'Image failure occurredAt')
    this.assertMonotonicTimestamp(occurredAt)
    const actorId = assertIdentifier(value.actorId, 'Image failure actorId')
    const callId = assertIdentifier(value.callId, 'Image failure callId')
    const failureReason = assertFailureReason(value.failureReason, 'Image failure reason')
    const retryAfterMs = assertNullableSafeInteger(
      value.retryAfterMs,
      'Image failure retryAfterMs',
      1,
      2_592_000_000
    )
    const call = this.calls.get(callId)
    if (!call || call.status !== 'dispatched' || !call.dispatchedAt) {
      fail('POLICY', 'Image failure requires a dispatched, non-terminal call.')
    }
    if (compareIso(occurredAt, call.dispatchedAt) < 0) {
      fail('INTEGRITY', 'Image failure cannot precede dispatch.')
    }
    const backoffMs = Math.max(
      computeImageBackoffMs(call.attempt, this.policy),
      retryAfterMs ?? 0
    )
    const retryNotBefore = addMilliseconds(occurredAt, backoffMs)
    const event = this.appendEvent({
      expectedVersion,
      type: 'image-call-failed',
      occurredAt,
      actorId,
      callId,
      failureReason,
      retryAfterMs,
      retryNotBefore
    }) as ImageCallFailedEvent
    call.status = 'failed'
    call.completedAt = occurredAt
    call.failureReason = failureReason
    call.retryAfterMs = retryAfterMs
    call.retryNotBefore = retryNotBefore
    call.callHash = event.eventHash
    return event
  }

  markAmbiguous(value: unknown): ImageCallAmbiguousEvent {
    assertPlainObject(value, 'Ambiguous image dispatch')
    assertExactKeys(
      value,
      ['expectedVersion', 'occurredAt', 'actorId', 'callId', 'ambiguityReason'],
      'Ambiguous image dispatch'
    )
    const expectedVersion = this.assertExpectedVersion(value.expectedVersion)
    const occurredAt = assertIsoTimestamp(value.occurredAt, 'Ambiguous image dispatch occurredAt')
    this.assertMonotonicTimestamp(occurredAt)
    const actorId = assertIdentifier(value.actorId, 'Ambiguous image dispatch actorId')
    const callId = assertIdentifier(value.callId, 'Ambiguous image dispatch callId')
    if (value.ambiguityReason !== 'ambiguous-dispatch') {
      fail('SCHEMA', 'Ambiguous image dispatch reason must be "ambiguous-dispatch".')
    }
    const call = this.calls.get(callId)
    if (!call || call.status !== 'dispatched' || !call.dispatchedAt) {
      fail('POLICY', 'Ambiguity can be recorded only for a dispatched, non-terminal call.')
    }
    if (compareIso(occurredAt, call.dispatchedAt) < 0) {
      fail('INTEGRITY', 'Ambiguous completion cannot precede dispatch.')
    }
    const event = this.appendEvent({
      expectedVersion,
      type: 'image-call-ambiguous',
      occurredAt,
      actorId,
      callId,
      ambiguityReason: 'ambiguous-dispatch'
    }) as ImageCallAmbiguousEvent
    call.status = 'ambiguous'
    call.completedAt = occurredAt
    call.failureReason = 'ambiguous-dispatch'
    call.callHash = event.eventHash
    this.circuitOpen = true
    return event
  }

  getCall(callIdValue: unknown): SchedulerCallSnapshot | undefined {
    const callId = assertIdentifier(callIdValue, 'Scheduler call lookup id')
    const call = this.calls.get(callId)
    return call ? deepFreeze(cloneCanonical(call)) : undefined
  }

  requireSucceededReceipt(callIdValue: unknown): SchedulerReceipt {
    const callId = assertIdentifier(callIdValue, 'Scheduler receipt call id')
    const receipt = this.receipts.get(callId)
    if (!receipt) fail('RECEIPT', `Scheduler call "${callId}" has no succeeded receipt.`)
    return receipt
  }

  requireExhaustedFailure(callIdValue: unknown): SchedulerCallSnapshot {
    const callId = assertIdentifier(callIdValue, 'Scheduler exhausted call id')
    const call = this.calls.get(callId)
    if (
      !call ||
      call.status !== 'failed' ||
      call.attempt !== this.policy.maxAttempts ||
      !call.failureReason
    ) {
      fail('RECEIPT', 'Revision exhaustion requires the final allowed scheduler attempt to have failed.')
    }
    return deepFreeze(cloneCanonical(call))
  }

  events(): readonly SchedulerEvent[] {
    return deepFreeze(cloneCanonical(this.eventLog))
  }

  toSerializable(): SerializedImageScheduler {
    return deepFreeze({
      schemaVersion: VISUAL_ARTIFACT_LEDGER_VERSION,
      policy: cloneCanonical(this.policy),
      policyHash: this.policyHash,
      events: this.events()
    })
  }
}

function assertStoredHeader(
  value: Record<string, unknown>,
  expectedSequence: number,
  expectedPreviousHash: string
): void {
  if (value.sequence !== expectedSequence) fail('INTEGRITY', 'Scheduler event sequence is not contiguous.')
  if (value.expectedVersion !== expectedSequence - 1) {
    fail('CAS', 'Scheduler history contains a stale or branching CAS version.')
  }
  assertIsoTimestamp(value.occurredAt, `Scheduler event ${expectedSequence} occurredAt`)
  assertIdentifier(value.actorId, `Scheduler event ${expectedSequence} actorId`)
  const previous = assertSha256(value.previousEventHash, `Scheduler event ${expectedSequence} previousEventHash`)
  if (previous !== expectedPreviousHash) fail('INTEGRITY', 'Scheduler previous-event hash chain is broken.')
  assertSha256(value.eventHash, `Scheduler event ${expectedSequence} eventHash`)
}

function assertGeneratedEventMatches(stored: Record<string, unknown>, generated: SchedulerEvent): void {
  if (canonicalStringify(stored) !== canonicalStringify(generated)) {
    fail('INTEGRITY', `Scheduler event ${generated.sequence} hash or derived fields do not match replay.`)
  }
}

export interface ParseImageSchedulerOptions {
  readonly expectedPolicyHash: string
  readonly trustedRootHash: string
}

export function serializeImageScheduler(scheduler: ValidatedImageScheduler): string {
  if (!(scheduler instanceof ValidatedImageScheduler)) {
    fail('SCHEMA', 'Only a validated scheduler instance can be serialized.')
  }
  return canonicalStringify(scheduler.toSerializable())
}

export function parseImageScheduler(
  serialized: string,
  optionsValue: ParseImageSchedulerOptions
): ValidatedImageScheduler {
  if (
    typeof serialized !== 'string' ||
    serialized.length > MAX_SERIALIZED_BYTES ||
    utf8ByteLength(serialized) > MAX_SERIALIZED_BYTES
  ) {
    fail('CARDINALITY', `Serialized scheduler exceeds ${MAX_SERIALIZED_BYTES} bytes.`)
  }
  assertPlainObject(optionsValue, 'Scheduler parse options')
  assertExactKeys(optionsValue, ['expectedPolicyHash', 'trustedRootHash'], 'Scheduler parse options')
  const expectedPolicyHash = assertSha256(
    optionsValue.expectedPolicyHash,
    'Scheduler expected policy hash'
  )
  const trustedRootHash = assertSha256(optionsValue.trustedRootHash, 'Scheduler trusted root hash')

  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    fail('SCHEMA', 'Serialized scheduler is not valid JSON.')
  }
  assertPlainObject(parsed, 'Serialized scheduler')
  assertExactKeys(parsed, ['schemaVersion', 'policy', 'policyHash', 'events'], 'Serialized scheduler')
  if (parsed.schemaVersion !== VISUAL_ARTIFACT_LEDGER_VERSION) {
    fail('SCHEMA', `Scheduler schemaVersion must be ${VISUAL_ARTIFACT_LEDGER_VERSION}.`)
  }
  const policy = parseImageSchedulingPolicy(parsed.policy)
  const suppliedPolicyHash = assertSha256(parsed.policyHash, 'Serialized scheduler policyHash')
  const computedPolicyHash = computeImageSchedulingPolicyHash(policy)
  if (suppliedPolicyHash !== computedPolicyHash) {
    fail('INTEGRITY', 'Scheduler policyHash does not match its immutable policy.')
  }
  if (suppliedPolicyHash !== expectedPolicyHash) {
    fail('POLICY', 'Scheduler policy drifted from the externally trusted policy hash.')
  }
  if (!Array.isArray(parsed.events) || parsed.events.length < 1) {
    fail('SCHEMA', 'Scheduler history must contain its configuration event.')
  }
  if (parsed.events.length > MAX_SCHEDULER_EVENTS) {
    fail('CARDINALITY', `Scheduler history exceeds ${MAX_SCHEDULER_EVENTS} events.`)
  }

  let scheduler: ValidatedImageScheduler | undefined
  let previousHash = ZERO_HASH
  for (let index = 0; index < parsed.events.length; index += 1) {
    const value = parsed.events[index]
    const sequence = index + 1
    assertPlainObject(value, `Scheduler event ${sequence}`)
    if (typeof value.type !== 'string') fail('SCHEMA', `Scheduler event ${sequence} type is invalid.`)
    const common = {
      expectedVersion: value.expectedVersion,
      occurredAt: value.occurredAt,
      actorId: value.actorId
    }

    if (value.type === 'scheduler-configured') {
      assertExactKeys(value, [...EVENT_HEADER_KEYS, 'policyHash'], `Scheduler event ${sequence}`)
      assertStoredHeader(value, sequence, previousHash)
      if (sequence !== 1 || value.policyHash !== suppliedPolicyHash) {
        fail('INTEGRITY', 'Scheduler configuration must be the first event and bind the policy hash.')
      }
      scheduler = ValidatedImageScheduler.create(policy, {
        occurredAt: value.occurredAt,
        actorId: value.actorId
      })
      assertGeneratedEventMatches(value, scheduler.events()[0] as SchedulerEvent)
    } else {
      if (!scheduler) fail('INTEGRITY', 'Scheduler history must begin with configuration.')
      let generated: SchedulerEvent
      if (value.type === 'image-call-reserved') {
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
            'requestHash',
            'idempotencyKey',
            'retryOfCallId',
            'retryReason'
          ],
          `Scheduler event ${sequence}`
        )
        assertStoredHeader(value, sequence, previousHash)
        generated = scheduler.reserve({
          ...common,
          callId: value.callId,
          artifactId: value.artifactId,
          revision: value.revision,
          attempt: value.attempt,
          promptHash: value.promptHash,
          promptApprovalHash: value.promptApprovalHash,
          requestHash: value.requestHash,
          retryOfCallId: value.retryOfCallId,
          retryReason: value.retryReason
        })
      } else if (value.type === 'image-call-dispatched') {
        assertExactKeys(value, [...EVENT_HEADER_KEYS, 'callId'], `Scheduler event ${sequence}`)
        assertStoredHeader(value, sequence, previousHash)
        generated = scheduler.dispatch({ ...common, callId: value.callId })
      } else if (value.type === 'image-call-succeeded') {
        assertExactKeys(
          value,
          [...EVENT_HEADER_KEYS, 'callId', 'imageHash'],
          `Scheduler event ${sequence}`
        )
        assertStoredHeader(value, sequence, previousHash)
        generated = scheduler.succeed({
          ...common,
          callId: value.callId,
          imageHash: value.imageHash
        })
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
        assertStoredHeader(value, sequence, previousHash)
        generated = scheduler.fail({
          ...common,
          callId: value.callId,
          failureReason: value.failureReason,
          retryAfterMs: value.retryAfterMs
        })
      } else if (value.type === 'image-call-ambiguous') {
        assertExactKeys(
          value,
          [...EVENT_HEADER_KEYS, 'callId', 'ambiguityReason'],
          `Scheduler event ${sequence}`
        )
        assertStoredHeader(value, sequence, previousHash)
        generated = scheduler.markAmbiguous({
          ...common,
          callId: value.callId,
          ambiguityReason: value.ambiguityReason
        })
      } else {
        fail('SCHEMA', `Scheduler event ${sequence} has unknown type "${value.type}".`)
      }
      assertGeneratedEventMatches(value, generated)
    }
    previousHash = assertSha256(value.eventHash, `Scheduler event ${sequence} eventHash`)
  }
  if (!scheduler) fail('INTEGRITY', 'Scheduler history is empty.')
  if (scheduler.rootHash !== trustedRootHash) {
    fail('TRUST', 'Scheduler content does not match the externally supplied trusted root.')
  }
  return scheduler
}
