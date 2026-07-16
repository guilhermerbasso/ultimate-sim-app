import { describe, expect, it } from 'vitest'
import {
  computeImageSchedulingPolicyHash,
  computeSchedulerEventHash,
  computeSchedulerRootHash,
  parseImageScheduler,
  serializeImageScheduler,
  ValidatedImageScheduler,
  type ImageSchedulingPolicy,
  type SchedulerEvent,
  type SerializedImageScheduler
} from './scheduler'
import { expectedArtifactIds } from './plan'
import { ZERO_HASH } from './constants'
import {
  DEFAULT_POLICY,
  HashPool,
  TestClock,
  hashNumber,
  makePlan,
  makeScheduler
} from './test-fixtures'

function reserve(
  scheduler: ValidatedImageScheduler,
  clock: TestClock,
  callId: string,
  artifactId: string,
  options: {
    revision?: number
    attempt?: number
    promptHash?: string
    promptApprovalHash?: string
    requestHash?: string
    retryOfCallId?: string | null
    retryReason?: string | null
  } = {}
): void {
  scheduler.reserve({
    expectedVersion: scheduler.version,
    occurredAt: clock.next(),
    actorId: 'scheduler-control',
    callId,
    artifactId,
    revision: options.revision ?? 1,
    attempt: options.attempt ?? 1,
    promptHash: options.promptHash ?? hashNumber(10),
    promptApprovalHash: options.promptApprovalHash ?? hashNumber(11),
    requestHash: options.requestHash ?? hashNumber(20 + scheduler.version),
    retryOfCallId: options.retryOfCallId ?? null,
    retryReason: options.retryReason ?? null
  })
}

function dispatch(scheduler: ValidatedImageScheduler, clock: TestClock, callId: string): void {
  scheduler.dispatch({
    expectedVersion: scheduler.version,
    occurredAt: clock.next(),
    actorId: 'scheduler-worker',
    callId
  })
}

function succeed(
  scheduler: ValidatedImageScheduler,
  clock: TestClock,
  callId: string,
  imageHash: string
): void {
  scheduler.succeed({
    expectedVersion: scheduler.version,
    occurredAt: clock.next(),
    actorId: 'scheduler-worker',
    callId,
    imageHash
  })
}

function rehashScheduler(envelope: SerializedImageScheduler): string {
  let previousEventHash = ZERO_HASH
  for (let index = 0; index < envelope.events.length; index += 1) {
    const event = envelope.events[index] as SchedulerEvent & {
      sequence: number
      expectedVersion: number
      previousEventHash: string
      eventHash: string
    }
    event.sequence = index + 1
    event.expectedVersion = index
    event.previousEventHash = previousEventHash
    const { eventHash: _ignored, ...withoutHash } = event
    event.eventHash = computeSchedulerEventHash(withoutHash as Omit<SchedulerEvent, 'eventHash'>)
    previousEventHash = event.eventHash
  }
  return JSON.stringify(envelope)
}

function parsedEnvelope(scheduler: ValidatedImageScheduler): SerializedImageScheduler {
  return JSON.parse(serializeImageScheduler(scheduler)) as SerializedImageScheduler
}

describe('authoritative image scheduler event ledger', () => {
  it('persists a strict immutable policy, monotonic hashes, and a scheduler-issued receipt', () => {
    const clock = new TestClock()
    const scheduler = makeScheduler(clock)
    const artifactId = expectedArtifactIds(makePlan())[0]
    reserve(scheduler, clock, 'call-1', artifactId)
    dispatch(scheduler, clock, 'call-1')
    succeed(scheduler, clock, 'call-1', hashNumber(30))

    const receipt = scheduler.requireSucceededReceipt('call-1')
    expect(receipt.status).toBe('succeeded')
    expect(receipt.policyHash).toBe(computeImageSchedulingPolicyHash(DEFAULT_POLICY))
    expect(receipt.callHash).toBe(scheduler.events().at(-1)?.eventHash)
    expect(scheduler.version).toBe(4)
    expect(scheduler.rootHash).toBe(
      computeSchedulerRootHash(scheduler.policyHash, scheduler.version, scheduler.events().at(-1)!.eventHash)
    )
    const parsed = parseImageScheduler(serializeImageScheduler(scheduler), {
      expectedPolicyHash: scheduler.policyHash,
      trustedRootHash: scheduler.rootHash
    })
    expect(parsed.rootHash).toBe(scheduler.rootHash)
    expect(parsed.requireSucceededReceipt('call-1')).toEqual(receipt)
  })

  it('rejects policy drift and a window shrink against the external policy hash', () => {
    const clock = new TestClock()
    const scheduler = makeScheduler(clock)
    const envelope = parsedEnvelope(scheduler) as unknown as {
      schemaVersion: number
      policy: ImageSchedulingPolicy
      policyHash: string
      events: Array<Record<string, unknown>>
    }
    envelope.policy = { ...envelope.policy, windowMs: 1 }
    envelope.policyHash = computeImageSchedulingPolicyHash(envelope.policy)
    envelope.events[0].policyHash = envelope.policyHash
    const serialized = rehashScheduler(envelope as unknown as SerializedImageScheduler)
    const tamperedRoot = computeSchedulerRootHash(
      envelope.policyHash,
      envelope.events.length,
      envelope.events.at(-1)!.eventHash as string
    )

    expect(() =>
      parseImageScheduler(serialized, {
        expectedPolicyHash: scheduler.policyHash,
        trustedRootHash: tamperedRoot
      })
    ).toThrow(/policy drifted/i)
  })

  it('allows six aggregate reservations and rejects the seventh', () => {
    const clock = new TestClock()
    const scheduler = makeScheduler(clock)
    const ids = expectedArtifactIds(makePlan())
    for (let index = 0; index < 6; index += 1) reserve(scheduler, clock, `call-${index}`, ids[index])

    expect(() => reserve(scheduler, clock, 'call-7', ids[6])).toThrow(/six-request.*reserved/i)
    expect(scheduler.callCount).toBe(6)
  })

  it('keeps an old delayed reservation in aggregate capacity accounting', () => {
    const policy = { ...DEFAULT_POLICY, windowMs: 10 }
    const clock = new TestClock()
    const scheduler = makeScheduler(clock, policy)
    const ids = expectedArtifactIds(makePlan())
    reserve(scheduler, clock, 'delayed', ids[0])
    clock.next(20)

    for (let index = 1; index <= 5; index += 1) {
      reserve(scheduler, clock, `recent-${index}`, ids[index])
      dispatch(scheduler, clock, `recent-${index}`)
    }
    expect(() => reserve(scheduler, clock, 'seventh-capacity', ids[6])).toThrow(/fully reserved/i)
    expect(() => dispatch(scheduler, clock, 'delayed')).not.toThrow()
  })

  it('rejects a coherently rehashed ledger-wide seven-receipt burst', () => {
    const policy = { ...DEFAULT_POLICY, windowMs: 10 }
    const clock = new TestClock()
    const scheduler = makeScheduler(clock, policy)
    const ids = expectedArtifactIds(makePlan())
    const hashes = new HashPool(100)
    for (let index = 0; index < 7; index += 1) {
      clock.next(20)
      reserve(scheduler, clock, `call-${index}`, ids[index], {
        promptHash: hashes.next(),
        requestHash: hashes.next()
      })
      dispatch(scheduler, clock, `call-${index}`)
      succeed(scheduler, clock, `call-${index}`, hashes.next())
    }
    const envelope = parsedEnvelope(scheduler) as unknown as {
      policyHash: string
      events: Array<Record<string, unknown>>
    }
    const burstTimestamp = new TestClock().current()
    for (const event of envelope.events) {
      event.occurredAt = burstTimestamp
    }
    const serialized = rehashScheduler(envelope as unknown as SerializedImageScheduler)
    const root = computeSchedulerRootHash(
      scheduler.policyHash,
      envelope.events.length,
      envelope.events.at(-1)!.eventHash as string
    )
    expect(() =>
      parseImageScheduler(serialized, {
        expectedPolicyHash: scheduler.policyHash,
        trustedRootHash: root
      })
    ).toThrow(/rolling window|fully reserved/i)
  })

  it('rejects stale CAS writes and stale-CAS branches in replay', () => {
    const clock = new TestClock()
    const scheduler = makeScheduler(clock)
    const artifactId = expectedArtifactIds(makePlan())[0]
    expect(() =>
      scheduler.reserve({
        expectedVersion: 0,
        occurredAt: clock.next(),
        actorId: 'scheduler-control',
        callId: 'stale',
        artifactId,
        revision: 1,
        attempt: 1,
        promptHash: hashNumber(1),
        promptApprovalHash: hashNumber(3),
        requestHash: hashNumber(2),
        retryOfCallId: null,
        retryReason: null
      })
    ).toThrow(/stale scheduler CAS/i)

    reserve(scheduler, clock, 'valid', artifactId)
    const envelope = parsedEnvelope(scheduler) as unknown as {
      policyHash: string
      events: Array<Record<string, unknown>>
    }
    envelope.events[1].expectedVersion = 0
    const serialized = rehashScheduler(envelope as unknown as SerializedImageScheduler)
    envelope.events[1].expectedVersion = 0
    const { eventHash: _ignored, ...withoutHash } = envelope.events[1]
    envelope.events[1].eventHash = computeSchedulerEventHash(
      withoutHash as unknown as Omit<SchedulerEvent, 'eventHash'>
    )
    const root = computeSchedulerRootHash(
      scheduler.policyHash,
      envelope.events.length,
      envelope.events.at(-1)!.eventHash as string
    )
    expect(() =>
      parseImageScheduler(JSON.stringify(envelope), {
        expectedPolicyHash: scheduler.policyHash,
        trustedRootHash: root
      })
    ).toThrow(/stale or branching CAS/i)
  })

  it('opens the global circuit on ambiguity, blocks dispatch, and never auto-retries', () => {
    const clock = new TestClock()
    const scheduler = makeScheduler(clock)
    const ids = expectedArtifactIds(makePlan())
    reserve(scheduler, clock, 'ambiguous', ids[0])
    reserve(scheduler, clock, 'waiting', ids[1])
    dispatch(scheduler, clock, 'ambiguous')
    scheduler.markAmbiguous({
      expectedVersion: scheduler.version,
      occurredAt: clock.next(),
      actorId: 'scheduler-worker',
      callId: 'ambiguous',
      ambiguityReason: 'ambiguous-dispatch'
    })

    expect(scheduler.isCircuitOpen).toBe(true)
    expect(() => dispatch(scheduler, clock, 'waiting')).toThrow(/circuit is open/i)
    expect(() =>
      reserve(scheduler, clock, 'ambiguous-retry', ids[0], {
        attempt: 2,
        retryOfCallId: 'ambiguous',
        retryReason: 'timeout'
      })
    ).toThrow(/circuit is open/i)
  })

  it('requires retry prompt and reason to match the immediate failed attempt', () => {
    const artifactId = expectedArtifactIds(makePlan())[0]
    const promptHash = hashNumber(40)

    const wrongPromptClock = new TestClock()
    const wrongPromptScheduler = makeScheduler(wrongPromptClock)
    reserve(wrongPromptScheduler, wrongPromptClock, 'failed-prompt', artifactId, { promptHash })
    dispatch(wrongPromptScheduler, wrongPromptClock, 'failed-prompt')
    wrongPromptScheduler.fail({
      expectedVersion: wrongPromptScheduler.version,
      occurredAt: wrongPromptClock.next(),
      actorId: 'scheduler-worker',
      callId: 'failed-prompt',
      failureReason: 'timeout',
      retryAfterMs: null
    })
    wrongPromptClock.next(1_000)
    expect(() =>
      reserve(wrongPromptScheduler, wrongPromptClock, 'retry-wrong-prompt', artifactId, {
        attempt: 2,
        promptHash: hashNumber(41),
        retryOfCallId: 'failed-prompt',
        retryReason: 'timeout'
      })
    ).toThrow(/promptHash must match/i)

    const wrongReasonClock = new TestClock()
    const wrongReasonScheduler = makeScheduler(wrongReasonClock)
    reserve(wrongReasonScheduler, wrongReasonClock, 'failed-reason', artifactId, { promptHash })
    dispatch(wrongReasonScheduler, wrongReasonClock, 'failed-reason')
    wrongReasonScheduler.fail({
      expectedVersion: wrongReasonScheduler.version,
      occurredAt: wrongReasonClock.next(),
      actorId: 'scheduler-worker',
      callId: 'failed-reason',
      failureReason: 'timeout',
      retryAfterMs: null
    })
    wrongReasonClock.next(1_000)
    expect(() =>
      reserve(wrongReasonScheduler, wrongReasonClock, 'retry-wrong-reason', artifactId, {
        attempt: 2,
        promptHash,
        retryOfCallId: 'failed-reason',
        retryReason: 'rate-limit'
      })
    ).toThrow(/reason must match/i)
  })

  it('enforces positive immediate backoff and rejects conflicting Retry-After replay', () => {
    const clock = new TestClock()
    const scheduler = makeScheduler(clock)
    const artifactId = expectedArtifactIds(makePlan())[0]
    const promptHash = hashNumber(50)
    reserve(scheduler, clock, 'failed', artifactId, { promptHash })
    dispatch(scheduler, clock, 'failed')
    const failure = scheduler.fail({
      expectedVersion: scheduler.version,
      occurredAt: clock.next(),
      actorId: 'scheduler-worker',
      callId: 'failed',
      failureReason: 'rate-limit',
      retryAfterMs: 5_000
    })
    expect(() =>
      scheduler.reserve({
        expectedVersion: scheduler.version,
        occurredAt: failure.occurredAt,
        actorId: 'scheduler-control',
        callId: 'too-early',
        artifactId,
        revision: 1,
        attempt: 2,
        promptHash,
        promptApprovalHash: hashNumber(11),
        requestHash: hashNumber(51),
        retryOfCallId: 'failed',
        retryReason: 'rate-limit'
      })
    ).toThrow(/before its positive backoff/i)
    expect(() =>
      scheduler.fail({
        expectedVersion: scheduler.version,
        occurredAt: clock.next(),
        actorId: 'scheduler-worker',
        callId: 'failed',
        failureReason: 'rate-limit',
        retryAfterMs: 10_000
      })
    ).toThrow(/non-terminal/i)

    const envelope = parsedEnvelope(scheduler) as unknown as {
      policyHash: string
      events: Array<Record<string, unknown>>
    }
    const failedEvent = envelope.events.find((event) => event.type === 'image-call-failed')!
    failedEvent.retryNotBefore = new Date(
      Date.parse(failedEvent.occurredAt as string) + 6_000
    ).toISOString()
    const serialized = rehashScheduler(envelope as unknown as SerializedImageScheduler)
    const root = computeSchedulerRootHash(
      scheduler.policyHash,
      envelope.events.length,
      envelope.events.at(-1)!.eventHash as string
    )
    expect(() =>
      parseImageScheduler(serialized, {
        expectedPolicyHash: scheduler.policyHash,
        trustedRootHash: root
      })
    ).toThrow(/derived fields do not match replay/i)
  })

  it('rejects malformed timestamps, negative attempts, and attempts over policy maximum', () => {
    const clock = new TestClock()
    const scheduler = makeScheduler(clock)
    const artifactId = expectedArtifactIds(makePlan())[0]
    const base = {
      expectedVersion: scheduler.version,
      actorId: 'scheduler-control',
      callId: 'invalid',
      artifactId,
      revision: 1,
      promptHash: hashNumber(60),
      promptApprovalHash: hashNumber(62),
      requestHash: hashNumber(61),
      retryOfCallId: null,
      retryReason: null
    }
    expect(() =>
      scheduler.reserve({ ...base, occurredAt: 'not-a-date', attempt: 1 })
    ).toThrow(/canonical UTC ISO/i)
    expect(() =>
      scheduler.reserve({ ...base, occurredAt: clock.next(), attempt: -1 })
    ).toThrow(/attempt/i)
    expect(() =>
      scheduler.reserve({
        ...base,
        occurredAt: clock.next(),
        attempt: scheduler.policy.maxAttempts + 1
      })
    ).toThrow(/attempt/i)
  })

  it('turns retry timestamp overflow into a bounded governance error', () => {
    const policy = { ...DEFAULT_POLICY, baseBackoffMs: 1_000, maxBackoffMs: 1_000 }
    const scheduler = ValidatedImageScheduler.create(policy, {
      occurredAt: '+275760-09-12T23:59:59.998Z',
      actorId: 'scheduler-control'
    })
    const artifactId = expectedArtifactIds(makePlan())[0]
    scheduler.reserve({
      expectedVersion: scheduler.version,
      occurredAt: '+275760-09-12T23:59:59.998Z',
      actorId: 'scheduler-control',
      callId: 'overflow',
      artifactId,
      revision: 1,
      attempt: 1,
      promptHash: hashNumber(70),
      promptApprovalHash: hashNumber(71),
      requestHash: hashNumber(72),
      retryOfCallId: null,
      retryReason: null
    })
    scheduler.dispatch({
      expectedVersion: scheduler.version,
      occurredAt: '+275760-09-12T23:59:59.999Z',
      actorId: 'scheduler-worker',
      callId: 'overflow'
    })
    expect(() =>
      scheduler.fail({
        expectedVersion: scheduler.version,
        occurredAt: '+275760-09-13T00:00:00.000Z',
        actorId: 'scheduler-worker',
        callId: 'overflow',
        failureReason: 'timeout',
        retryAfterMs: null
      })
    ).toThrow(/supported timestamp range/i)
  })

  it('rejects unknown state and event fields before trusting history', () => {
    const clock = new TestClock()
    const scheduler = makeScheduler(clock)
    const envelope = parsedEnvelope(scheduler) as unknown as Record<string, unknown>
    envelope.credentials = 'forbidden'
    expect(() =>
      parseImageScheduler(JSON.stringify(envelope), {
        expectedPolicyHash: scheduler.policyHash,
        trustedRootHash: scheduler.rootHash
      })
    ).toThrow(/unknown field "credentials"/i)
  })
})
