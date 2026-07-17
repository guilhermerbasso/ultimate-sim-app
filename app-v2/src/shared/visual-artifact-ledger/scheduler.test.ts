import { describe, expect, it } from 'vitest'
import { canonicalStringify, utf8ByteLength } from './canonical'
import {
  MAX_IDENTIFIER_LENGTH,
  MAX_PLAN_ID_LENGTH,
  MAX_SCHEDULER_EVENTS,
  MAX_SERIALIZED_CHARACTERS,
  MAX_SERIALIZED_BYTES_PER_SCHEDULER_ATTEMPT
} from './constants'
import {
  parseImageScheduler,
  serializeImageScheduler,
  ValidatedImageScheduler,
  type ImageSchedulingPolicy,
  type SerializedImageScheduler
} from './scheduler'
import { VisualArtifactLedger } from './ledger'
import { createArtifactPlan, expectedArtifactIds } from './plan'
import {
  DEFAULT_POLICY,
  HashPool,
  TestClock,
  appendLedger,
  appendPromptApproved,
  appendScheduler,
  hashNumber,
  makeGovernance,
  makePlan,
  makeScheduler,
  schedulerPrincipal,
  schedulerRootAttestation,
  type PromptApprovedContext,
  type TestGovernance
} from './test-fixtures'

function setupApproved(count = 1, policy: ImageSchedulingPolicy = DEFAULT_POLICY): {
  governance: TestGovernance
  scheduler: ReturnType<typeof makeScheduler>
  ledger: VisualArtifactLedger
  contexts: PromptApprovedContext[]
  hashes: HashPool
} {
  const governance = makeGovernance()
  const scheduler = makeScheduler(governance, policy)
  const plan = makePlan()
  const ledger = VisualArtifactLedger.create(plan, governance.ledgerDependencies(scheduler))
  const clock = new TestClock(1_000_000)
  const hashes = new HashPool()
  const ids = expectedArtifactIds(plan)
  const contexts = Array.from({ length: count }, (_, index) =>
    appendPromptApproved(ledger, governance, ids[index], 1, hashes, clock)
  )
  return { governance, scheduler, ledger, contexts, hashes }
}

function reserve(
  scheduler: ReturnType<typeof makeScheduler>,
  governance: TestGovernance,
  context: PromptApprovedContext,
  callId: string,
  hashes: HashPool,
  options: {
    attempt?: number
    promptHash?: string
    promptApprovalHash?: string
    retryOfCallId?: string | null
    retryReason?: string | null
  } = {}
): void {
  governance.schedulerAuthority.ensureAfter(context.promptApprovedAt)
  appendScheduler(scheduler, governance, 'reserve', {
    actorId: 'scheduler-control',
    callId,
    artifactId: context.artifactId,
    revision: context.revision,
    attempt: options.attempt ?? 1,
    promptHash: options.promptHash ?? context.promptHash,
    promptApprovalHash: options.promptApprovalHash ?? context.promptApprovalHash,
    approvalCheckpoint: context.approvalCheckpoint,
    requestHash: hashes.next(),
    retryOfCallId: options.retryOfCallId ?? null,
    retryReason: options.retryReason ?? null
  })
}

function dispatch(
  scheduler: ReturnType<typeof makeScheduler>,
  governance: TestGovernance,
  callId: string
): void {
  appendScheduler(scheduler, governance, 'dispatch', {
    actorId: 'scheduler-worker',
    callId
  })
}

function failCall(
  scheduler: ReturnType<typeof makeScheduler>,
  governance: TestGovernance,
  callId: string,
  failureReason: 'timeout' | 'rate-limit' = 'timeout',
  retryAfterMs: number | null = null
): void {
  appendScheduler(scheduler, governance, 'fail', {
    actorId: 'scheduler-worker',
    callId,
    failureReason,
    retryAfterMs
  })
}

describe('externally authoritative image scheduler', () => {
  it('binds receipts to authenticated service proof and committed authority root/version', () => {
    const { governance, scheduler, contexts, hashes } = setupApproved()
    reserve(scheduler, governance, contexts[0], 'call-1', hashes)
    dispatch(scheduler, governance, 'call-1')
    const imageHash = hashes.next()
    const serviceBinding = scheduler.serviceReceiptBinding('call-1', imageHash)
    appendScheduler(scheduler, governance, 'succeed', {
      actorId: 'scheduler-worker',
      callId: 'call-1',
      imageHash,
      serviceReceiptAttestation:
        governance.attestations.issueServiceReceipt(serviceBinding)
    })

    const receipt = scheduler.requireSucceededReceipt('call-1')
    expect(receipt.authorityId).toBe(governance.schedulerAuthority.authorityId)
    expect(receipt.authorityVersion).toBe(scheduler.authorityCasVersion)
    expect(receipt.authorityRootHash).toBe(scheduler.authorityCommittedRootHash)
    expect(receipt.authorityCommitHash).toMatch(/^[a-f0-9]{64}$/)

    const rootAttestation = schedulerRootAttestation(scheduler, governance)
    const serialized = serializeImageScheduler(scheduler, { rootAttestation })
    const parsed = parseImageScheduler(serialized, {
      expectedPolicyHash: scheduler.policyHash,
      dependencies: governance.schedulerDependencies
    })
    expect(parsed.requireSucceededReceipt('call-1')).toEqual(receipt)
  })

  it('preflights a maximum-length authenticated scheduler attempt before authority commit', () => {
    const { governance, scheduler, contexts, hashes } = setupApproved()
    governance.schedulerAuthority.ensureAfter(contexts[0].promptApprovedAt)
    const callId = 'c'.repeat(MAX_IDENTIFIER_LENGTH)
    const controlActor = 'k'.repeat(MAX_IDENTIFIER_LENGTH)
    const workerActor = 'w'.repeat(MAX_IDENTIFIER_LENGTH)
    const reserveInput = {
      actorId: controlActor,
      callId,
      artifactId: contexts[0].artifactId,
      revision: 1,
      attempt: 1,
      promptHash: contexts[0].promptHash,
      promptApprovalHash: contexts[0].promptApprovalHash,
      approvalCheckpoint: contexts[0].approvalCheckpoint,
      requestHash: hashes.next(),
      retryOfCallId: null,
      retryReason: null
    }
    scheduler.reserve(
      reserveInput,
      schedulerPrincipal(scheduler, governance, 'reserve', reserveInput)
    )
    const dispatchInput = { actorId: workerActor, callId }
    scheduler.dispatch(
      dispatchInput,
      schedulerPrincipal(scheduler, governance, 'dispatch', dispatchInput)
    )
    const imageHash = hashes.next()
    const successInput = {
      actorId: workerActor,
      callId,
      imageHash,
      serviceReceiptAttestation: governance.attestations.issueServiceReceipt(
        scheduler.serviceReceiptBinding(callId, imageHash)
      )
    }
    scheduler.succeed(
      successInput,
      schedulerPrincipal(scheduler, governance, 'succeed', successInput)
    )
    const attemptBytes = scheduler
      .events()
      .slice(1)
      .reduce((total, event) => total + utf8ByteLength(canonicalStringify(event)), 0)
    expect(attemptBytes).toBeLessThanOrEqual(
      MAX_SERIALIZED_BYTES_PER_SCHEDULER_ATTEMPT
    )
    expect(scheduler.authorityCasVersion).toBe(
      governance.schedulerAuthority.currentVersion
    )
  })

  it('accepts a maximum-field third retry attempt within the runtime-safe cap', () => {
    const governance = makeGovernance(
      new TestClock(),
      'u'.repeat(MAX_IDENTIFIER_LENGTH)
    )
    const scheduler = makeScheduler(governance)
    const basePlan = makePlan()
    const plan = createArtifactPlan({
      registryHash: basePlan.registryHash,
      styles: basePlan.styles.map((identity, index) =>
        index === 0
          ? { id: 's'.repeat(MAX_PLAN_ID_LENGTH), ordinal: identity.ordinal }
          : identity
      ),
      concepts: basePlan.concepts.map((identity, index) =>
        index === 0
          ? { id: 'c'.repeat(MAX_PLAN_ID_LENGTH), ordinal: identity.ordinal }
          : identity
      ),
      triggerFamilies: basePlan.triggerFamilies
    })
    const ledger = VisualArtifactLedger.create(
      plan,
      governance.ledgerDependencies(scheduler)
    )
    const context = appendPromptApproved(
      ledger,
      governance,
      expectedArtifactIds(plan)[50],
      1,
      new HashPool(),
      new TestClock(1_000_000)
    )
    governance.schedulerAuthority.ensureAfter(context.promptApprovedAt)
    const hashes = new HashPool(10_000)
    const controlActor = 'k'.repeat(MAX_IDENTIFIER_LENGTH)
    const workerActor = 'w'.repeat(MAX_IDENTIFIER_LENGTH)
    const callIds = [
      'a'.repeat(MAX_IDENTIFIER_LENGTH),
      'b'.repeat(MAX_IDENTIFIER_LENGTH),
      'c'.repeat(MAX_IDENTIFIER_LENGTH)
    ]
    let retryOfCallId: string | null = null
    let retryReason: 'timeout' | null = null

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (attempt > 1) {
        governance.schedulerAuthority.advance(attempt === 2 ? 1_000 : 2_000)
      }
      const reserveInput = {
        actorId: controlActor,
        callId: callIds[attempt - 1],
        artifactId: context.artifactId,
        revision: 1,
        attempt,
        promptHash: context.promptHash,
        promptApprovalHash: context.promptApprovalHash,
        approvalCheckpoint: context.approvalCheckpoint,
        requestHash: hashes.next(),
        retryOfCallId,
        retryReason
      }
      scheduler.reserve(
        reserveInput,
        schedulerPrincipal(scheduler, governance, 'reserve', reserveInput)
      )
      const dispatchInput = {
        actorId: workerActor,
        callId: callIds[attempt - 1]
      }
      scheduler.dispatch(
        dispatchInput,
        schedulerPrincipal(scheduler, governance, 'dispatch', dispatchInput)
      )
      if (attempt < 3) {
        const failureInput = {
          actorId: workerActor,
          callId: callIds[attempt - 1],
          failureReason: 'timeout' as const,
          retryAfterMs: null
        }
        scheduler.fail(
          failureInput,
          schedulerPrincipal(scheduler, governance, 'fail', failureInput)
        )
        retryOfCallId = callIds[attempt - 1]
        retryReason = 'timeout'
      } else {
        const imageHash = hashes.next()
        const successInput = {
          actorId: workerActor,
          callId: callIds[attempt - 1],
          imageHash,
          serviceReceiptAttestation: governance.attestations.issueServiceReceipt(
            scheduler.serviceReceiptBinding(callIds[attempt - 1], imageHash)
          )
        }
        scheduler.succeed(
          successInput,
          schedulerPrincipal(scheduler, governance, 'succeed', successInput)
        )
      }
    }

    for (const callId of callIds) {
      const attemptBytes = scheduler
        .events()
        .filter(
          (event) =>
            'callId' in event && event.callId === callId
        )
        .reduce(
          (total, event) =>
            total + utf8ByteLength(canonicalStringify(event)),
          0
        )
      expect(attemptBytes).toBeLessThanOrEqual(
        MAX_SERIALIZED_BYTES_PER_SCHEDULER_ATTEMPT
      )
    }
  })

  it('rejects event-cap exhaustion before consuming the shared authority CAS', () => {
    const { governance, scheduler, contexts, hashes } = setupApproved()
    const cappedRoot = hashNumber(800)
    const schedulerInternals = scheduler as unknown as {
      eventLog: unknown[]
      authorityVersion: number
      authorityRootHash: string
    }
    const authorityInternals = governance.schedulerAuthority as unknown as {
      version: number
      rootHash: string
    }
    schedulerInternals.eventLog.length = MAX_SCHEDULER_EVENTS
    schedulerInternals.authorityVersion = MAX_SCHEDULER_EVENTS
    schedulerInternals.authorityRootHash = cappedRoot
    authorityInternals.version = MAX_SCHEDULER_EVENTS
    authorityInternals.rootHash = cappedRoot
    const input = {
      actorId: 'scheduler-control',
      callId: 'capacity-guard',
      artifactId: contexts[0].artifactId,
      revision: 1,
      attempt: 1,
      promptHash: contexts[0].promptHash,
      promptApprovalHash: contexts[0].promptApprovalHash,
      approvalCheckpoint: contexts[0].approvalCheckpoint,
      requestHash: hashes.next(),
      retryOfCallId: null,
      retryReason: null
    }
    const principal = schedulerPrincipal(scheduler, governance, 'reserve', input)
    expect(() => scheduler.reserve(input, principal)).toThrow(
      /event limit .* before authority commit/i
    )
    expect(governance.schedulerAuthority.currentVersion).toBe(MAX_SCHEDULER_EVENTS)
  })

  it('fails closed without explicit authority dependencies or a root attestation', () => {
    const governance = makeGovernance()
    const genesis = { actorId: 'scheduler-control' }
    expect(() =>
      ValidatedImageScheduler.create(
        DEFAULT_POLICY,
        genesis,
        undefined as never,
        { token: 'untrusted' }
      )
    ).toThrow(/explicit trusted authority/i)

    const scheduler = makeScheduler(governance)
    expect(
      (scheduler as unknown as { serializedValue?: unknown }).serializedValue
    ).toBeUndefined()
    expect(() =>
      serializeImageScheduler(scheduler, { rootAttestation: { token: 'self' } })
    ).toThrow(/primitive boolean true/i)
    const validRootAttestation = schedulerRootAttestation(scheduler, governance)
    ;(
      scheduler as unknown as { serializedEventBytes: number }
    ).serializedEventBytes = MAX_SERIALIZED_CHARACTERS + 1
    expect(() =>
      serializeImageScheduler(scheduler, {
        rootAttestation: validRootAttestation
      })
    ).toThrow(/runtime-safe single-string ceiling/i)
    expect(() =>
      parseImageScheduler('{}', null)
    ).toThrow(/plain object|canonical/i)
    expect(genesis.actorId).toBe('scheduler-control')
  })

  it('uses one shared durable CAS/quota authority across forked scheduler instances', () => {
    const { governance, scheduler, contexts, hashes } = setupApproved(7)
    const genesisRoot = schedulerRootAttestation(scheduler, governance)
    const genesisSerialized = serializeImageScheduler(scheduler, {
      rootAttestation: genesisRoot
    })

    const staleFork = parseImageScheduler(genesisSerialized, {
      expectedPolicyHash: scheduler.policyHash,
      dependencies: governance.schedulerDependencies
    })

    reserve(scheduler, governance, contexts[0], 'primary-0', hashes)
    dispatch(scheduler, governance, 'primary-0')
    expect(() => reserve(staleFork, governance, contexts[1], 'stale-fork', hashes)).toThrow(
      /stale shared scheduler CAS/i
    )

    for (let index = 1; index < 6; index += 1) {
      reserve(scheduler, governance, contexts[index], `primary-${index}`, hashes)
      dispatch(scheduler, governance, `primary-${index}`)
    }
    expect(() => reserve(scheduler, governance, contexts[6], 'seventh', hashes)).toThrow(
      /six-request capacity exhausted/i
    )
    expect(governance.schedulerAuthority.currentVersion).toBe(scheduler.authorityCasVersion)
  })

  it('keeps retry lineage independent for identical artifact IDs in different plans', () => {
    const governance = makeGovernance()
    const scheduler = makeScheduler(governance)
    const planA = makePlan()
    const planB = createArtifactPlan({
      registryHash: hashNumber(999_001),
      styles: planA.styles,
      concepts: planA.concepts,
      triggerFamilies: planA.triggerFamilies
    })
    const artifactId = expectedArtifactIds(planA)[0]
    const clock = new TestClock(1_000_000)
    const hashes = new HashPool()
    const ledgerA = VisualArtifactLedger.create(
      planA,
      governance.ledgerDependencies(scheduler)
    )
    const ledgerB = VisualArtifactLedger.create(
      planB,
      governance.ledgerDependencies(scheduler)
    )
    const contextA = appendPromptApproved(
      ledgerA,
      governance,
      artifactId,
      1,
      hashes,
      clock
    )
    const contextB = appendPromptApproved(
      ledgerB,
      governance,
      artifactId,
      1,
      hashes,
      clock
    )
    expect(() =>
      reserve(scheduler, governance, contextA, 'plan-a-attempt-1', hashes)
    ).not.toThrow()
    expect(() =>
      reserve(scheduler, governance, contextB, 'plan-b-attempt-1', hashes)
    ).not.toThrow()
  })

  it('recovers an authority commit when the durable response is lost', () => {
    const { governance, scheduler, contexts, hashes } = setupApproved()
    governance.schedulerAuthority.ensureAfter(contexts[0].promptApprovedAt)
    governance.schedulerAuthority.simulateLostNextResponse()
    reserve(scheduler, governance, contexts[0], 'recoverable-reservation', hashes)
    expect(scheduler.getCall('recoverable-reservation')?.status).toBe('reserved')
    expect(scheduler.authorityCasVersion).toBe(
      governance.schedulerAuthority.currentVersion
    )
    expect(scheduler.authorityCommittedRootHash).toBe(
      governance.schedulerAuthority.currentRootHash
    )
  })

  it('rejects reservation before attested prompt approval time without consuming CAS', () => {
    const { governance, scheduler, contexts, hashes } = setupApproved()
    const beforeVersion = governance.schedulerAuthority.currentVersion
    const input = {
      actorId: 'scheduler-control',
      callId: 'too-early-for-approval',
      artifactId: contexts[0].artifactId,
      revision: 1,
      attempt: 1,
      promptHash: contexts[0].promptHash,
      promptApprovalHash: contexts[0].promptApprovalHash,
      approvalCheckpoint: contexts[0].approvalCheckpoint,
      requestHash: hashes.next(),
      retryOfCallId: null,
      retryReason: null
    }
    const principal = schedulerPrincipal(scheduler, governance, 'reserve', input)
    expect(() => scheduler.reserve(input, principal)).toThrow(
      /approval.*has not elapsed|atomic commit/i
    )
    expect(governance.schedulerAuthority.currentVersion).toBe(beforeVersion)
    expect(scheduler.getCall('too-early-for-approval')).toBeUndefined()
  })

  it('does not accept caller-controlled timestamps', () => {
    const { governance, scheduler, contexts, hashes } = setupApproved()
    const input = {
      actorId: 'scheduler-control',
      occurredAt: '2030-01-01T00:00:00.000Z',
      callId: 'caller-time',
      artifactId: contexts[0].artifactId,
      revision: 1,
      attempt: 1,
      promptHash: contexts[0].promptHash,
      promptApprovalHash: contexts[0].promptApprovalHash,
      approvalCheckpoint: contexts[0].approvalCheckpoint,
      requestHash: hashes.next(),
      retryOfCallId: null,
      retryReason: null
    }
    expect(() => scheduler.principalBindingFor('reserve', input)).toThrow(
      /unknown field "occurredAt"/i
    )
  })

  it('rejects a predicted future prompt approval without a committed checkpoint attestation', () => {
    const governance = makeGovernance()
    const scheduler = makeScheduler(governance)
    const plan = makePlan()
    const artifactId = expectedArtifactIds(plan)[0]
    const predictedPromptHash = hashNumber(100)
    const predictedApprovalHash = hashNumber(101)
    const input = {
      actorId: 'scheduler-control',
      callId: 'predicted-future',
      artifactId,
      revision: 1,
      attempt: 1,
      promptHash: predictedPromptHash,
      promptApprovalHash: predictedApprovalHash,
      approvalCheckpoint: {
        ledgerRootHash: hashNumber(102),
        ledgerSequence: 4,
        promptApprovedAt: '2026-01-01T00:00:10.000Z',
        planHash: plan.planHash,
        artifactId,
        revision: 1,
        promptHash: predictedPromptHash,
        promptApprovalEventHash: predictedApprovalHash,
        attestation: { token: 'predicted-without-authority-issuance' }
      },
      requestHash: hashNumber(103),
      retryOfCallId: null,
      retryReason: null
    }
    const principal = schedulerPrincipal(scheduler, governance, 'reserve', input)
    expect(() => scheduler.reserve(input, principal)).toThrow(
      /primitive boolean true/i
    )
  })

  it('rejects direct succeed with a fabricated scheduler-service receipt', () => {
    const { governance, scheduler, contexts, hashes } = setupApproved()
    reserve(scheduler, governance, contexts[0], 'fake-success', hashes)
    dispatch(scheduler, governance, 'fake-success')
    const input = {
      actorId: 'scheduler-worker',
      callId: 'fake-success',
      imageHash: hashes.next(),
      serviceReceiptAttestation: { token: 'fabricated-service-proof' }
    }
    const principal = schedulerPrincipal(scheduler, governance, 'succeed', input)
    expect(() => scheduler.succeed(input, principal)).toThrow(
      /primitive boolean true/i
    )
  })

  it('enforces retry prompt, immediate failure reason, and authority-clock backoff', () => {
    const { governance, scheduler, contexts, hashes } = setupApproved()
    reserve(scheduler, governance, contexts[0], 'attempt-1', hashes)
    dispatch(scheduler, governance, 'attempt-1')
    failCall(scheduler, governance, 'attempt-1', 'timeout')

    expect(() =>
      reserve(scheduler, governance, contexts[0], 'wrong-prompt', hashes, {
        attempt: 2,
        promptHash: hashNumber(200),
        retryOfCallId: 'attempt-1',
        retryReason: 'timeout'
      })
    ).toThrow(/trusted committed prompt-approval checkpoint|preserve/i)
    expect(() =>
      reserve(scheduler, governance, contexts[0], 'wrong-reason', hashes, {
        attempt: 2,
        retryOfCallId: 'attempt-1',
        retryReason: 'rate-limit'
      })
    ).toThrow(/preserve the immediate failure/i)
    expect(() =>
      reserve(scheduler, governance, contexts[0], 'too-early', hashes, {
        attempt: 2,
        retryOfCallId: 'attempt-1',
        retryReason: 'timeout'
      })
    ).toThrow(/backoff has not elapsed/i)

    governance.schedulerAuthority.advance(1_000)
    expect(() =>
      reserve(scheduler, governance, contexts[0], 'attempt-2', hashes, {
        attempt: 2,
        retryOfCallId: 'attempt-1',
        retryReason: 'timeout'
      })
    ).not.toThrow()
  })

  it('opens the global circuit on ambiguity and blocks another instance', () => {
    const { governance, scheduler, contexts, hashes } = setupApproved(2)
    const rootAttestation = schedulerRootAttestation(scheduler, governance)
    const fork = parseImageScheduler(
      serializeImageScheduler(scheduler, { rootAttestation }),
      {
        expectedPolicyHash: scheduler.policyHash,
        dependencies: governance.schedulerDependencies
      }
    )
    reserve(scheduler, governance, contexts[0], 'ambiguous', hashes)
    reserve(scheduler, governance, contexts[1], 'waiting', hashes)
    dispatch(scheduler, governance, 'ambiguous')
    appendScheduler(scheduler, governance, 'ambiguous', {
      actorId: 'scheduler-worker',
      callId: 'ambiguous',
      ambiguityReason: 'ambiguous-dispatch'
    })
    expect(scheduler.isCircuitOpen).toBe(true)
    expect(() => dispatch(scheduler, governance, 'waiting')).toThrow(/global circuit is open/i)
    expect(() => reserve(fork, governance, contexts[1], 'fork-after-open', hashes)).toThrow(
      /stale shared scheduler CAS|global circuit is open/i
    )
  })

  it('rejects non-canonical or duplicate-key JSON and malformed parser options', () => {
    const { governance, scheduler } = setupApproved()
    const rootAttestation = schedulerRootAttestation(scheduler, governance)
    const serialized = serializeImageScheduler(scheduler, { rootAttestation })
    const duplicate = serialized.replace(
      '{"authorityId"',
      '{"schemaVersion":2,"authorityId"'
    )
    expect(() =>
      parseImageScheduler(duplicate, {
        expectedPolicyHash: scheduler.policyHash,
        dependencies: governance.schedulerDependencies
      })
    ).toThrow(/canonical|duplicate keys/i)
    expect(() =>
      parseImageScheduler('{"value":"\ud800"}', {
        expectedPolicyHash: scheduler.policyHash,
        dependencies: governance.schedulerDependencies
      })
    ).toThrow(/unpaired UTF-16 surrogates/i)
    expect(() =>
      parseImageScheduler('{"\\ud800":1}', {
        expectedPolicyHash: scheduler.policyHash,
        dependencies: governance.schedulerDependencies
      })
    ).toThrow(/unpaired UTF-16 surrogates/i)
    expect(() => parseImageScheduler(serialized, null)).toThrow(/plain object/i)
    expect(() =>
      parseImageScheduler(
        canonicalStringify({
          schemaVersion: 2,
          policy: scheduler.policy,
          policyHash: scheduler.policyHash,
          authorityId: scheduler.authorityId,
          events: scheduler.events()
        }),
        {
          expectedPolicyHash: scheduler.policyHash,
          dependencies: governance.schedulerDependencies
        }
      )
    ).toThrow(/missing required field "rootAttestation"/i)
    expect(() =>
      parseImageScheduler(serialized, {
        expectedPolicyHash: scheduler.policyHash,
        dependencies: governance.schedulerDependencies,
        trustedRootHash: scheduler.rootHash
      })
    ).toThrow(/unknown field "trustedRootHash"/i)
  })

  it('rejects policy drift even when the modified JSON is canonical', () => {
    const { governance, scheduler } = setupApproved()
    const rootAttestation = schedulerRootAttestation(scheduler, governance)
    const envelope = JSON.parse(
      serializeImageScheduler(scheduler, { rootAttestation })
    ) as SerializedImageScheduler
    const changed = {
      ...envelope,
      policy: { ...envelope.policy, windowMs: 1 }
    }
    expect(() =>
      parseImageScheduler(canonicalStringify(changed), {
        expectedPolicyHash: scheduler.policyHash,
        dependencies: governance.schedulerDependencies
      })
    ).toThrow(/policy drifted/i)
  })

  it('converts retry timestamp overflow into a governance failure', () => {
    const maxDate = Date.parse('+275760-09-13T00:00:00.000Z')
    const authorityClock = new TestClock(maxDate - Date.parse('2026-01-01T00:00:00.000Z') - 4)
    const governance = makeGovernance(authorityClock)
    const scheduler = makeScheduler(governance, {
      ...DEFAULT_POLICY,
      maxAttempts: 1,
      baseBackoffMs: 1_000,
      maxBackoffMs: 1_000
    })
    const plan = makePlan()
    const ledger = VisualArtifactLedger.create(plan, governance.ledgerDependencies(scheduler))
    const hashes = new HashPool()
    const clock = new TestClock()
    const context = appendPromptApproved(
      ledger,
      governance,
      expectedArtifactIds(plan)[0],
      1,
      hashes,
      clock
    )
    reserve(scheduler, governance, context, 'overflow', hashes)
    dispatch(scheduler, governance, 'overflow')
    expect(() => failCall(scheduler, governance, 'overflow')).toThrow(
      /supported timestamp range/i
    )
  })
})
