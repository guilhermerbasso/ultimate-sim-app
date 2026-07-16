import { describe, expect, it } from 'vitest'
import {
  computeArtifactEventHash,
  computeVisualArtifactLedgerRootHash,
  parseVisualArtifactLedger,
  serializeVisualArtifactLedger,
  VisualArtifactLedger,
  type ArtifactEvent,
  type SerializedVisualArtifactLedger
} from './ledger'
import { MAX_LEDGER_EVENTS, ZERO_HASH } from './constants'
import { expectedArtifactIds } from './plan'
import {
  DEFAULT_POLICY,
  HashPool,
  TestClock,
  appendAcceptedArtifact,
  appendPromptApproved,
  evidence,
  hashNumber,
  makePlan,
  makeScheduler,
  scheduleSucceededImage,
  type PromptApprovedContext
} from './test-fixtures'
import { ValidatedImageScheduler } from './scheduler'

function setup(): {
  ledger: VisualArtifactLedger
  scheduler: ValidatedImageScheduler
  schedulerClock: TestClock
  ledgerClock: TestClock
  hashes: HashPool
  ids: ReturnType<typeof expectedArtifactIds>
} {
  const plan = makePlan()
  const schedulerClock = new TestClock()
  const scheduler = makeScheduler(schedulerClock)
  return {
    ledger: VisualArtifactLedger.create(plan, scheduler),
    scheduler,
    schedulerClock,
    ledgerClock: new TestClock(1_000_000),
    hashes: new HashPool(),
    ids: expectedArtifactIds(plan)
  }
}

function recordGeneration(
  ledger: VisualArtifactLedger,
  context: PromptApprovedContext,
  receipt: ReturnType<ValidatedImageScheduler['requireSucceededReceipt']>,
  clock: TestClock
): void {
  clock.ensureAfter(receipt.completedAt)
  const occurredAt = clock.next()
  ledger.append({
    type: 'image-generation-recorded',
    occurredAt,
    actorId: 'image-runner',
    artifactId: context.artifactId,
    revision: context.revision,
    attempt: receipt.attempt,
    promptHash: receipt.promptHash,
    promptApprovalHash: receipt.promptApprovalHash,
    requestHash: receipt.requestHash,
    imageHash: receipt.imageHash,
    idempotencyKey: receipt.idempotencyKey,
    policyHash: receipt.policyHash,
    schedulerCallId: receipt.callId,
    schedulerCallHash: receipt.callHash,
    schedulerReceiptHash: receipt.receiptHash,
    evidence: evidence(
      'image-generation',
      context.artifactId,
      context.revision,
      occurredAt,
      'image-runner',
      receipt.receiptHash,
      receipt.imageHash
    )
  })
}

function approveImageAndImplement(
  ledger: VisualArtifactLedger,
  context: PromptApprovedContext,
  imageHash: string,
  hashes: HashPool,
  clock: TestClock
): { implementationHash: string } {
  const imageQaReportHash = hashes.next()
  let occurredAt = clock.next()
  ledger.append({
    type: 'image-qa-reviewed',
    occurredAt,
    actorId: 'image-reviewer',
    artifactId: context.artifactId,
    revision: context.revision,
    imageHash,
    verdict: 'approved',
    reportHash: imageQaReportHash,
    evidence: evidence(
      'image-qa',
      context.artifactId,
      context.revision,
      occurredAt,
      'image-reviewer',
      imageHash,
      imageQaReportHash
    )
  })
  const implementationHash = hashes.next()
  occurredAt = clock.next()
  ledger.append({
    type: 'implementation-recorded',
    occurredAt,
    actorId: 'implementer',
    artifactId: context.artifactId,
    revision: context.revision,
    implementationHash,
    evidence: evidence(
      'implementation',
      context.artifactId,
      context.revision,
      occurredAt,
      'implementer',
      imageHash,
      implementationHash
    )
  })
  return { implementationHash }
}

function rehashLedger(envelope: SerializedVisualArtifactLedger): string {
  let previousEventHash = ZERO_HASH
  for (let index = 0; index < envelope.events.length; index += 1) {
    const event = envelope.events[index] as ArtifactEvent & {
      sequence: number
      previousEventHash: string
      eventHash: string
    }
    event.sequence = index + 1
    event.previousEventHash = previousEventHash
    const { eventHash: _ignored, ...withoutHash } = event
    event.eventHash = computeArtifactEventHash(withoutHash as Omit<ArtifactEvent, 'eventHash'>)
    previousEventHash = event.eventHash
  }
  return JSON.stringify(envelope)
}

describe('event-sourced visual artifact governance ledger', () => {
  it('enforces the complete lifecycle and maintains an append-only global hash chain', () => {
    const { ledger, scheduler, schedulerClock, ledgerClock, hashes, ids } = setup()
    appendAcceptedArtifact(
      ledger,
      scheduler,
      ids[0],
      1,
      hashes,
      ledgerClock,
      schedulerClock
    )

    expect(ledger.getArtifact(ids[0])?.revisions[0].status).toBe('accepted')
    expect(ledger.eventCount).toBe(9)
    expect(ledger.evidenceCount).toBe(9)
    expect(ledger.acceptedArtifactCount).toBe(1)
    const events = ledger.events()
    expect(events[0].sequence).toBe(1)
    expect(events[0].previousEventHash).toBe(ZERO_HASH)
    for (let index = 1; index < events.length; index += 1) {
      expect(events[index].sequence).toBe(index + 1)
      expect(events[index].previousEventHash).toBe(events[index - 1].eventHash)
    }
  })

  it('rejects skipped, repeated, or out-of-order lifecycle stages', () => {
    const { ledger, ledgerClock, hashes, ids } = setup()
    const specificationHash = hashes.next()
    ledger.append({
      type: 'artifact-revision-started',
      occurredAt: ledgerClock.next(),
      actorId: 'planner',
      artifactId: ids[0],
      revision: 1,
      specificationHash,
      planHash: ledger.plan.planHash
    })
    const promptHash = hashes.next()
    const occurredAt = ledgerClock.next()
    expect(() =>
      ledger.append({
        type: 'prompt-drafted',
        occurredAt,
        actorId: 'prompt-author',
        artifactId: ids[0],
        revision: 1,
        promptHash,
        evidence: evidence(
          'prompt-draft',
          ids[0],
          1,
          occurredAt,
          'prompt-author',
          specificationHash,
          promptHash
        )
      })
    ).toThrow(/requires completed research/i)
  })

  it('rejects unknown fields, prompt bodies, URL material, and identity mutation', () => {
    const { ledger, ledgerClock, hashes, ids } = setup()
    expect(() =>
      ledger.append({
        type: 'artifact-revision-started',
        occurredAt: ledgerClock.next(),
        actorId: 'planner',
        artifactId: ids[0],
        revision: 1,
        specificationHash: hashes.next(),
        planHash: ledger.plan.planHash,
        kind: 'dashboard'
      })
    ).toThrow(/unknown field "kind"/i)

    expect(() =>
      ledger.append({
        type: 'artifact-revision-started',
        occurredAt: ledgerClock.next(),
        actorId: 'https://example.test/secret',
        artifactId: ids[0],
        revision: 1,
        specificationHash: hashes.next(),
        planHash: ledger.plan.planHash
      })
    ).toThrow(/safe identifier|forbidden URL/i)

    const context = appendPromptApproved(ledger, ids[0], 1, hashes, ledgerClock, {
      promptVerdict: 'rejected'
    })
    expect(() =>
      ledger.append({
        type: 'prompt-drafted',
        occurredAt: ledgerClock.next(),
        actorId: 'prompt-author',
        artifactId: context.artifactId,
        revision: 1,
        promptHash: hashes.next(),
        promptBody: 'paid network prompt',
        evidence: {}
      })
    ).toThrow(/unknown field "promptBody"/i)
  })

  it('rejects self-QA at prompt, image, and render gates', () => {
    const promptSetup = setup()
    expect(() =>
      appendPromptApproved(
        promptSetup.ledger,
        promptSetup.ids[0],
        1,
        promptSetup.hashes,
        promptSetup.ledgerClock,
        { promptReviewer: 'prompt-author' }
      )
    ).toThrow(/prompt QA must be independent/i)

    const imageSetup = setup()
    const imageContext = appendPromptApproved(
      imageSetup.ledger,
      imageSetup.ids[0],
      1,
      imageSetup.hashes,
      imageSetup.ledgerClock
    )
    const receipt = scheduleSucceededImage(
      imageSetup.scheduler,
      imageContext,
      imageSetup.hashes,
      imageSetup.schedulerClock
    )
    recordGeneration(imageSetup.ledger, imageContext, receipt, imageSetup.ledgerClock)
    let occurredAt = imageSetup.ledgerClock.next()
    const imageQaHash = imageSetup.hashes.next()
    expect(() =>
      imageSetup.ledger.append({
        type: 'image-qa-reviewed',
        occurredAt,
        actorId: 'image-runner',
        artifactId: imageContext.artifactId,
        revision: 1,
        imageHash: receipt.imageHash,
        verdict: 'approved',
        reportHash: imageQaHash,
        evidence: evidence(
          'image-qa',
          imageContext.artifactId,
          1,
          occurredAt,
          'image-runner',
          receipt.imageHash,
          imageQaHash
        )
      })
    ).toThrow(/image QA must be independent/i)

    const renderSetup = setup()
    const renderContext = appendPromptApproved(
      renderSetup.ledger,
      renderSetup.ids[0],
      1,
      renderSetup.hashes,
      renderSetup.ledgerClock
    )
    const renderReceipt = scheduleSucceededImage(
      renderSetup.scheduler,
      renderContext,
      renderSetup.hashes,
      renderSetup.schedulerClock
    )
    recordGeneration(renderSetup.ledger, renderContext, renderReceipt, renderSetup.ledgerClock)
    const { implementationHash } = approveImageAndImplement(
      renderSetup.ledger,
      renderContext,
      renderReceipt.imageHash,
      renderSetup.hashes,
      renderSetup.ledgerClock
    )
    occurredAt = renderSetup.ledgerClock.next()
    const renderHash = renderSetup.hashes.next()
    const reportHash = renderSetup.hashes.next()
    expect(() =>
      renderSetup.ledger.append({
        type: 'render-qa-reviewed',
        occurredAt,
        actorId: 'implementer',
        artifactId: renderContext.artifactId,
        revision: 1,
        renderHash,
        verdict: 'approved',
        reportHash,
        renderEvidence: evidence(
          'render',
          renderContext.artifactId,
          1,
          occurredAt,
          'implementer',
          implementationHash,
          renderHash
        ),
        qaEvidence: evidence(
          'render-qa',
          renderContext.artifactId,
          1,
          occurredAt,
          'implementer',
          renderHash,
          reportHash
        )
      })
    ).toThrow(/render QA must be independent/i)
  })

  it('rejects foreign subjects and evidence createdBy mismatches', () => {
    const foreign = setup()
    const specificationHash = foreign.hashes.next()
    foreign.ledger.append({
      type: 'artifact-revision-started',
      occurredAt: foreign.ledgerClock.next(),
      actorId: 'planner',
      artifactId: foreign.ids[0],
      revision: 1,
      specificationHash,
      planHash: foreign.ledger.plan.planHash
    })
    let occurredAt = foreign.ledgerClock.next()
    const researchHash = foreign.hashes.next()
    expect(() =>
      foreign.ledger.append({
        type: 'research-recorded',
        occurredAt,
        actorId: 'researcher',
        artifactId: foreign.ids[0],
        revision: 1,
        researchHash,
        evidence: evidence(
          'research',
          foreign.ids[0],
          1,
          occurredAt,
          'researcher',
          foreign.hashes.next(),
          researchHash
        )
      })
    ).toThrow(/mismatched subjectHash/i)

    const creator = setup()
    const creatorSpecificationHash = creator.hashes.next()
    creator.ledger.append({
      type: 'artifact-revision-started',
      occurredAt: creator.ledgerClock.next(),
      actorId: 'planner',
      artifactId: creator.ids[0],
      revision: 1,
      specificationHash: creatorSpecificationHash,
      planHash: creator.ledger.plan.planHash
    })
    occurredAt = creator.ledgerClock.next()
    const creatorResearchHash = creator.hashes.next()
    expect(() =>
      creator.ledger.append({
        type: 'research-recorded',
        occurredAt,
        actorId: 'researcher',
        artifactId: creator.ids[0],
        revision: 1,
        researchHash: creatorResearchHash,
        evidence: evidence(
          'research',
          creator.ids[0],
          1,
          occurredAt,
          'someone-else',
          creatorSpecificationHash,
          creatorResearchHash
        )
      })
    ).toThrow(/mismatched createdBy/i)
  })

  it('prevents evidence id and content reuse across artifacts', () => {
    const { ledger, ledgerClock, hashes, ids } = setup()
    const firstSpecification = hashes.next()
    ledger.append({
      type: 'artifact-revision-started',
      occurredAt: ledgerClock.next(),
      actorId: 'planner',
      artifactId: ids[0],
      revision: 1,
      specificationHash: firstSpecification,
      planHash: ledger.plan.planHash
    })
    const sharedContent = hashes.next()
    let occurredAt = ledgerClock.next()
    const firstEvidence = evidence(
      'research',
      ids[0],
      1,
      occurredAt,
      'researcher',
      firstSpecification,
      sharedContent,
      'shared-id'
    )
    ledger.append({
      type: 'research-recorded',
      occurredAt,
      actorId: 'researcher',
      artifactId: ids[0],
      revision: 1,
      researchHash: sharedContent,
      evidence: firstEvidence
    })

    const secondSpecification = hashes.next()
    ledger.append({
      type: 'artifact-revision-started',
      occurredAt: ledgerClock.next(),
      actorId: 'planner',
      artifactId: ids[1],
      revision: 1,
      specificationHash: secondSpecification,
      planHash: ledger.plan.planHash
    })
    occurredAt = ledgerClock.next()
    expect(() =>
      ledger.append({
        type: 'research-recorded',
        occurredAt,
        actorId: 'researcher',
        artifactId: ids[1],
        revision: 1,
        researchHash: sharedContent,
        evidence: {
          ...evidence(
            'research',
            ids[1],
            1,
            occurredAt,
            'researcher',
            secondSpecification,
            sharedContent,
            'unique-id'
          ),
          evidenceId: firstEvidence.evidenceId
        }
      })
    ).toThrow(/evidence id|evidence content/i)
  })

  it('accepts only scheduler-owned succeeded receipts from one global authority', () => {
    const { ledger, scheduler, schedulerClock, ledgerClock, hashes, ids } = setup()
    const context = appendPromptApproved(ledger, ids[0], 1, hashes, ledgerClock)
    schedulerClock.ensureAfter(context.promptApprovedAt)
    const receipt = scheduleSucceededImage(scheduler, context, hashes, schedulerClock)
    const occurredAt = ledgerClock.next()

    expect(() =>
      ledger.append({
        type: 'image-generation-recorded',
        occurredAt,
        actorId: 'image-runner',
        artifactId: context.artifactId,
        revision: 1,
        attempt: receipt.attempt,
        promptHash: receipt.promptHash,
        promptApprovalHash: receipt.promptApprovalHash,
        requestHash: receipt.requestHash,
        imageHash: receipt.imageHash,
        idempotencyKey: receipt.idempotencyKey,
        policyHash: receipt.policyHash,
        schedulerCallId: 'fake-call',
        schedulerCallHash: receipt.callHash,
        schedulerReceiptHash: receipt.receiptHash,
        evidence: evidence(
          'image-generation',
          context.artifactId,
          1,
          occurredAt,
          'image-runner',
          receipt.receiptHash,
          receipt.imageHash
        )
      })
    ).toThrow(/no succeeded receipt/i)

    const rogueClock = new TestClock()
    const rogueScheduler = makeScheduler(rogueClock)
    const rogueReceipt = scheduleSucceededImage(
      rogueScheduler,
      context,
      hashes,
      rogueClock
    )
    expect(() => recordGeneration(ledger, context, rogueReceipt, ledgerClock)).toThrow(
      /no succeeded receipt|does not match/i
    )
  })

  it('binds scheduler reservation and terminal timestamps to prompt approval', () => {
    const early = setup()
    const context = appendPromptApproved(
      early.ledger,
      early.ids[0],
      1,
      early.hashes,
      early.ledgerClock
    )
    early.scheduler.reserve({
      expectedVersion: early.scheduler.version,
      occurredAt: early.schedulerClock.next(),
      actorId: 'scheduler-control',
      callId: 'pre-approval-call',
      artifactId: context.artifactId,
      revision: 1,
      attempt: 1,
      promptHash: context.promptHash,
      promptApprovalHash: context.promptApprovalHash,
      requestHash: early.hashes.next(),
      retryOfCallId: null,
      retryReason: null
    })
    early.scheduler.dispatch({
      expectedVersion: early.scheduler.version,
      occurredAt: early.schedulerClock.next(),
      actorId: 'scheduler-worker',
      callId: 'pre-approval-call'
    })
    early.scheduler.succeed({
      expectedVersion: early.scheduler.version,
      occurredAt: early.schedulerClock.next(),
      actorId: 'scheduler-worker',
      callId: 'pre-approval-call',
      imageHash: early.hashes.next()
    })
    const earlyReceipt = early.scheduler.requireSucceededReceipt('pre-approval-call')
    expect(() =>
      recordGeneration(early.ledger, context, earlyReceipt, early.ledgerClock)
    ).toThrow(/strictly after and bound to prompt approval/i)

    const plan = makePlan()
    const schedulerClock = new TestClock()
    const scheduler = makeScheduler(schedulerClock, { ...DEFAULT_POLICY, maxAttempts: 1 })
    const ledgerClock = new TestClock(1_000_000)
    const hashes = new HashPool()
    const artifactId = expectedArtifactIds(plan)[0]
    const ledger = VisualArtifactLedger.create(plan, scheduler)
    const exhaustedContext = appendPromptApproved(
      ledger,
      artifactId,
      1,
      hashes,
      ledgerClock
    )
    schedulerClock.ensureAfter(exhaustedContext.promptApprovedAt)
    scheduler.reserve({
      expectedVersion: scheduler.version,
      occurredAt: schedulerClock.next(),
      actorId: 'scheduler-control',
      callId: 'late-failure',
      artifactId,
      revision: 1,
      attempt: 1,
      promptHash: exhaustedContext.promptHash,
      promptApprovalHash: exhaustedContext.promptApprovalHash,
      requestHash: hashes.next(),
      retryOfCallId: null,
      retryReason: null
    })
    scheduler.dispatch({
      expectedVersion: scheduler.version,
      occurredAt: schedulerClock.next(),
      actorId: 'scheduler-worker',
      callId: 'late-failure'
    })
    scheduler.fail({
      expectedVersion: scheduler.version,
      occurredAt: schedulerClock.next(),
      actorId: 'scheduler-worker',
      callId: 'late-failure',
      failureReason: 'timeout',
      retryAfterMs: null
    })
    const finalCall = scheduler.requireExhaustedFailure('late-failure')
    const exhaustionHash = hashes.next()
    const occurredAt = ledgerClock.next()
    expect(() =>
      ledger.append({
        type: 'revision-exhausted',
        occurredAt,
        actorId: 'release-owner',
        artifactId,
        revision: 1,
        schedulerCallId: finalCall.callId,
        schedulerCallHash: finalCall.callHash,
        failureReason: finalCall.failureReason,
        exhaustionHash,
        evidence: evidence(
          'exhaustion',
          artifactId,
          1,
          occurredAt,
          'release-owner',
          finalCall.callHash,
          exhaustionHash
        )
      })
    ).toThrow(/final scheduler failure/i)
  })

  it('rejects accepted-ledger parsing without external trust and detects coherent offline rewriting', () => {
    const { ledger, scheduler, schedulerClock, ledgerClock, hashes, ids } = setup()
    appendAcceptedArtifact(
      ledger,
      scheduler,
      ids[0],
      1,
      hashes,
      ledgerClock,
      schedulerClock
    )
    const trustedRoot = ledger.rootHash
    const serialized = serializeVisualArtifactLedger(ledger, { trustedRootHash: trustedRoot })
    expect(() => parseVisualArtifactLedger(serialized, { scheduler })).toThrow(/externally supplied/i)

    const envelope = JSON.parse(serialized) as SerializedVisualArtifactLedger
    const acceptance = envelope.events.at(-1)! as unknown as {
      actorId: string
      evidence: { createdBy: string }
    }
    acceptance.actorId = 'offline-rewriter'
    acceptance.evidence.createdBy = 'offline-rewriter'
    const rewritten = rehashLedger(envelope)
    expect(() =>
      parseVisualArtifactLedger(rewritten, { scheduler, trustedRootHash: trustedRoot })
    ).toThrow(/trusted root/i)
  })

  it('canonically serializes, parses, and verifies external roots or checkpoints', () => {
    const { ledger, scheduler, schedulerClock, ledgerClock, hashes, ids } = setup()
    appendAcceptedArtifact(
      ledger,
      scheduler,
      ids[0],
      1,
      hashes,
      ledgerClock,
      schedulerClock
    )
    const checkpoint = ledger.createCheckpoint()
    const serialized = ledger.serialize({ trustedCheckpoint: checkpoint })
    const parsed = parseVisualArtifactLedger(serialized, { scheduler, trustedCheckpoint: checkpoint })

    expect(parsed.rootHash).toBe(ledger.rootHash)
    expect(parsed.serialize({ trustedCheckpoint: checkpoint })).toBe(serialized)
    expect(() =>
      parseVisualArtifactLedger(serialized, {
        scheduler,
        trustedRootHash: hashNumber(999_999)
      })
    ).toThrow(/trusted root/i)
  })

  it('fails empty, incomplete, and plan/registry-mismatched finalization', () => {
    const empty = setup()
    expect(() =>
      empty.ledger.finalize({
        occurredAt: empty.ledgerClock.next(),
        actorId: 'release-owner',
        planHash: empty.ledger.plan.planHash,
        registryHash: empty.ledger.plan.registryHash,
        trustedCheckpoint: empty.ledger.createCheckpoint()
      })
    ).toThrow(/empty ledgers/i)

    const incomplete = setup()
    appendAcceptedArtifact(
      incomplete.ledger,
      incomplete.scheduler,
      incomplete.ids[0],
      1,
      incomplete.hashes,
      incomplete.ledgerClock,
      incomplete.schedulerClock
    )
    expect(() =>
      incomplete.ledger.finalize({
        occurredAt: incomplete.ledgerClock.next(),
        actorId: 'release-owner',
        planHash: incomplete.ledger.plan.planHash,
        registryHash: incomplete.ledger.plan.registryHash,
        trustedCheckpoint: incomplete.ledger.createCheckpoint()
      })
    ).toThrow(/incomplete/i)
    expect(() =>
      incomplete.ledger.finalize({
        occurredAt: incomplete.ledgerClock.next(),
        actorId: 'release-owner',
        planHash: hashNumber(999),
        registryHash: incomplete.ledger.plan.registryHash,
        trustedCheckpoint: incomplete.ledger.createCheckpoint()
      })
    ).toThrow(/planHash or registryHash/i)
  })

  it('keeps complete contiguous supersession chains for multiple artifacts', () => {
    const { ledger, ledgerClock, hashes, ids } = setup()
    for (const artifactId of ids.slice(0, 2)) {
      appendPromptApproved(ledger, artifactId, 1, hashes, ledgerClock, {
        promptVerdict: 'rejected'
      })
      const priorRoot = ledger.getArtifact(artifactId)!.revisions[0].rootHash
      ledger.append({
        type: 'artifact-revision-superseded',
        occurredAt: ledgerClock.next(),
        actorId: 'planner',
        artifactId,
        revision: 2,
        priorRevision: 1,
        priorRevisionRootHash: priorRoot,
        specificationHash: hashes.next(),
        planHash: ledger.plan.planHash
      })
      expect(ledger.getArtifact(artifactId)?.revisions.map((revision) => revision.revision)).toEqual([
        1, 2
      ])
      expect(ledger.getArtifact(artifactId)?.revisions[1].status).toBe('started')
    }
  })

  it('rejects missing revision numbers, prior-root tampering, and removed supersession history', () => {
    const { ledger, ledgerClock, hashes, ids } = setup()
    appendPromptApproved(ledger, ids[0], 1, hashes, ledgerClock, { promptVerdict: 'rejected' })
    const priorRoot = ledger.getArtifact(ids[0])!.revisions[0].rootHash
    expect(() =>
      ledger.append({
        type: 'artifact-revision-superseded',
        occurredAt: ledgerClock.next(),
        actorId: 'planner',
        artifactId: ids[0],
        revision: 3,
        priorRevision: 1,
        priorRevisionRootHash: priorRoot,
        specificationHash: hashes.next(),
        planHash: ledger.plan.planHash
      })
    ).toThrow(/contiguous/i)
    expect(() =>
      ledger.append({
        type: 'artifact-revision-superseded',
        occurredAt: ledgerClock.next(),
        actorId: 'planner',
        artifactId: ids[0],
        revision: 2,
        priorRevision: 1,
        priorRevisionRootHash: hashNumber(123_456),
        specificationHash: hashes.next(),
        planHash: ledger.plan.planHash
      })
    ).toThrow(/full prior root/i)

    ledger.append({
      type: 'artifact-revision-superseded',
      occurredAt: ledgerClock.next(),
      actorId: 'planner',
      artifactId: ids[0],
      revision: 2,
      priorRevision: 1,
      priorRevisionRootHash: priorRoot,
      specificationHash: hashes.next(),
      planHash: ledger.plan.planHash
    })
    const revisionTwoSpecification = ledger.getArtifact(ids[0])!.revisions[1].specificationHash
    const researchHash = hashes.next()
    const occurredAt = ledgerClock.next()
    ledger.append({
      type: 'research-recorded',
      occurredAt,
      actorId: 'researcher',
      artifactId: ids[0],
      revision: 2,
      researchHash,
      evidence: evidence(
        'research',
        ids[0],
        2,
        occurredAt,
        'researcher',
        revisionTwoSpecification,
        researchHash
      )
    })
    const envelope = JSON.parse(ledger.serialize()) as SerializedVisualArtifactLedger
    const supersessionIndex = envelope.events.findIndex(
      (event) => event.type === 'artifact-revision-superseded'
    )
    ;(envelope.events as ArtifactEvent[]).splice(supersessionIndex, 1)
    const missingRevision = rehashLedger(envelope)
    expect(() => parseVisualArtifactLedger(missingRevision)).toThrow(/current revision|has not started/i)
  })

  it('allows supersession after scheduler exhaustion only with the final failed call bound', () => {
    const { ledger, scheduler, schedulerClock, ledgerClock, hashes, ids } = setup()
    const context = appendPromptApproved(ledger, ids[0], 1, hashes, ledgerClock)
    schedulerClock.ensureAfter(context.promptApprovedAt)
    let priorCallId: string | null = null
    let priorReason: 'timeout' | 'rate-limit' | null = null
    let finalCallId = ''
    for (let attempt = 1; attempt <= scheduler.policy.maxAttempts; attempt += 1) {
      finalCallId = `exhaust:${attempt}`
      scheduler.reserve({
        expectedVersion: scheduler.version,
        occurredAt: schedulerClock.next(attempt === 1 ? 1 : attempt === 2 ? 1_001 : 2_001),
        actorId: 'scheduler-control',
        callId: finalCallId,
        artifactId: context.artifactId,
        revision: 1,
        attempt,
        promptHash: context.promptHash,
        promptApprovalHash: context.promptApprovalHash,
        requestHash: hashes.next(),
        retryOfCallId: priorCallId,
        retryReason: priorReason
      })
      scheduler.dispatch({
        expectedVersion: scheduler.version,
        occurredAt: schedulerClock.next(),
        actorId: 'scheduler-worker',
        callId: finalCallId
      })
      const failureReason = attempt === scheduler.policy.maxAttempts ? 'rate-limit' : 'timeout'
      scheduler.fail({
        expectedVersion: scheduler.version,
        occurredAt: schedulerClock.next(),
        actorId: 'scheduler-worker',
        callId: finalCallId,
        failureReason,
        retryAfterMs: null
      })
      priorCallId = finalCallId
      priorReason = failureReason
    }
    const finalCall = scheduler.requireExhaustedFailure(finalCallId)
    const exhaustionHash = hashes.next()
    ledgerClock.ensureAfter(finalCall.completedAt!)
    const occurredAt = ledgerClock.next()
    ledger.append({
      type: 'revision-exhausted',
      occurredAt,
      actorId: 'release-owner',
      artifactId: context.artifactId,
      revision: 1,
      schedulerCallId: finalCall.callId,
      schedulerCallHash: finalCall.callHash,
      failureReason: finalCall.failureReason,
      exhaustionHash,
      evidence: evidence(
        'exhaustion',
        context.artifactId,
        1,
        occurredAt,
        'release-owner',
        finalCall.callHash,
        exhaustionHash
      )
    })
    expect(ledger.getArtifact(ids[0])?.revisions[0].status).toBe('exhausted')
    expect(() =>
      ledger.append({
        type: 'artifact-revision-superseded',
        occurredAt: ledgerClock.next(),
        actorId: 'planner',
        artifactId: ids[0],
        revision: 2,
        priorRevision: 1,
        priorRevisionRootHash: ledger.getArtifact(ids[0])!.revisions[0].rootHash,
        specificationHash: hashes.next(),
        planHash: ledger.plan.planHash
      })
    ).not.toThrow()
  })

  it('rejects null/malformed history and caps event cardinality before replay allocation', () => {
    const plan = makePlan()
    expect(() =>
      parseVisualArtifactLedger(
        JSON.stringify({ schemaVersion: 2, plan, events: null })
      )
    ).toThrow(/history must be an array/i)
    expect(() =>
      parseVisualArtifactLedger(
        JSON.stringify({ schemaVersion: 2, plan, events: [null] })
      )
    ).toThrow(/plain object/i)
    expect(() =>
      parseVisualArtifactLedger(
        JSON.stringify({
          schemaVersion: 2,
          plan,
          events: new Array(MAX_LEDGER_EVENTS + 1).fill(null)
        })
      )
    ).toThrow(/exceeds .* events/i)
  })

  it('binds the calculated root to sequence, final event hash, and plan hash', () => {
    const { ledger, ledgerClock, hashes, ids } = setup()
    appendPromptApproved(ledger, ids[0], 1, hashes, ledgerClock, {
      promptVerdict: 'rejected'
    })
    expect(ledger.rootHash).toBe(
      computeVisualArtifactLedgerRootHash(
        ledger.plan.planHash,
        ledger.sequence,
        ledger.events().at(-1)!.eventHash
      )
    )
  })
})
