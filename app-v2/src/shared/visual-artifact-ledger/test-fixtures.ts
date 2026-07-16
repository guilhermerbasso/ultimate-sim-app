import {
  VisualArtifactLedger,
  type ArtifactEvidence,
  type EvidenceKind
} from './ledger'
import {
  createArtifactPlan,
  expectedArtifactIds,
  type ArtifactId,
  type ArtifactPlan
} from './plan'
import {
  ValidatedImageScheduler,
  type ImageSchedulingPolicy,
  type SchedulerReceipt
} from './scheduler'

const TEST_EPOCH = Date.parse('2026-01-01T00:00:00.000Z')

export class TestClock {
  private milliseconds: number

  constructor(offsetMs = 0) {
    this.milliseconds = TEST_EPOCH + offsetMs
  }

  next(stepMs = 1): string {
    this.milliseconds += stepMs
    return new Date(this.milliseconds).toISOString()
  }

  current(): string {
    return new Date(this.milliseconds).toISOString()
  }

  ensureAfter(timestamp: string, stepMs = 1): string {
    const minimum = Date.parse(timestamp) + stepMs
    if (this.milliseconds < minimum) this.milliseconds = minimum
    return this.current()
  }
}

export class HashPool {
  private value: number

  constructor(start = 1) {
    this.value = start
  }

  next(): string {
    const value = this.value
    this.value += 1
    return value.toString(16).padStart(64, '0')
  }
}

export function hashNumber(value: number): string {
  return value.toString(16).padStart(64, '0')
}

export function makePlan(triggerFamilyCount = 10): ArtifactPlan {
  return createArtifactPlan({
    registryHash: hashNumber(900_000),
    styles: Array.from({ length: 50 }, (_, index) => ({
      id: `style-${String(index + 1).padStart(3, '0')}`,
      ordinal: index + 1
    })),
    concepts: Array.from({ length: 143 }, (_, index) => ({
      id: `concept-${String(index + 1).padStart(3, '0')}`,
      ordinal: index + 1
    })),
    triggerFamilies: Array.from({ length: triggerFamilyCount }, (_, index) => ({
      id: `trigger-${String(index + 1).padStart(2, '0')}`,
      ordinal: index + 1
    }))
  })
}

export const DEFAULT_POLICY: ImageSchedulingPolicy = {
  windowMs: 60_000,
  requestLimit: 6,
  maxAttempts: 3,
  baseBackoffMs: 1_000,
  maxBackoffMs: 8_000
}

export function makeScheduler(
  clock: TestClock,
  policy: ImageSchedulingPolicy = DEFAULT_POLICY
): ValidatedImageScheduler {
  return ValidatedImageScheduler.create(policy, {
    occurredAt: clock.next(),
    actorId: 'scheduler-control'
  })
}

export function evidence(
  kind: EvidenceKind,
  artifactId: ArtifactId,
  revision: number,
  createdAt: string,
  createdBy: string,
  subjectHash: string,
  contentHash: string,
  suffix: string = kind
): ArtifactEvidence {
  return {
    evidenceId: `ev:${artifactId}:r${revision}:${suffix}`,
    artifactId,
    revision,
    kind,
    createdAt,
    createdBy,
    subjectHash,
    contentHash
  }
}

export interface PromptApprovedContext {
  artifactId: ArtifactId
  revision: number
  specificationHash: string
  researchHash: string
  promptHash: string
  promptApprovedAt: string
  promptApprovalHash: string
}

export function appendPromptApproved(
  ledger: VisualArtifactLedger,
  artifactId: ArtifactId,
  revision: number,
  hashes: HashPool,
  clock: TestClock,
  options: {
    start?: boolean
    specificationHash?: string
    promptVerdict?: 'approved' | 'rejected'
    promptReviewer?: string
  } = {}
): PromptApprovedContext {
  const specificationHash = options.specificationHash ?? hashes.next()
  if (options.start !== false) {
    ledger.append({
      type: 'artifact-revision-started',
      occurredAt: clock.next(),
      actorId: 'planner',
      artifactId,
      revision,
      specificationHash,
      planHash: ledger.plan.planHash
    })
  }
  const researchHash = hashes.next()
  let occurredAt = clock.next()
  ledger.append({
    type: 'research-recorded',
    occurredAt,
    actorId: 'researcher',
    artifactId,
    revision,
    researchHash,
    evidence: evidence(
      'research',
      artifactId,
      revision,
      occurredAt,
      'researcher',
      specificationHash,
      researchHash
    )
  })
  const promptHash = hashes.next()
  occurredAt = clock.next()
  ledger.append({
    type: 'prompt-drafted',
    occurredAt,
    actorId: 'prompt-author',
    artifactId,
    revision,
    promptHash,
    evidence: evidence(
      'prompt-draft',
      artifactId,
      revision,
      occurredAt,
      'prompt-author',
      researchHash,
      promptHash
    )
  })
  const reportHash = hashes.next()
  const reviewer = options.promptReviewer ?? 'prompt-reviewer'
  occurredAt = clock.next()
  const approvalEvent = ledger.append({
    type: 'prompt-qa-reviewed',
    occurredAt,
    actorId: reviewer,
    artifactId,
    revision,
    promptHash,
    verdict: options.promptVerdict ?? 'approved',
    reportHash,
    evidence: evidence(
      'prompt-qa',
      artifactId,
      revision,
      occurredAt,
      reviewer,
      promptHash,
      reportHash
    )
  })
  if (approvalEvent.type !== 'prompt-qa-reviewed') throw new Error('Unexpected prompt QA event.')
  return {
    artifactId,
    revision,
    specificationHash,
    researchHash,
    promptHash,
    promptApprovedAt: approvalEvent.occurredAt,
    promptApprovalHash: approvalEvent.eventHash
  }
}

export function scheduleSucceededImage(
  scheduler: ValidatedImageScheduler,
  context: PromptApprovedContext,
  hashes: HashPool,
  clock: TestClock,
  attempt = 1,
  retryOfCallId: string | null = null,
  retryReason: string | null = null
): SchedulerReceipt {
  const requestHash = hashes.next()
  const imageHash = hashes.next()
  const callId = `call:${context.artifactId}:r${context.revision}:a${attempt}`
  clock.ensureAfter(context.promptApprovedAt)
  scheduler.reserve({
    expectedVersion: scheduler.version,
    occurredAt: clock.next(),
    actorId: 'scheduler-control',
    callId,
    artifactId: context.artifactId,
    revision: context.revision,
    attempt,
    promptHash: context.promptHash,
    promptApprovalHash: context.promptApprovalHash,
    requestHash,
    retryOfCallId,
    retryReason
  })
  scheduler.dispatch({
    expectedVersion: scheduler.version,
    occurredAt: clock.next(),
    actorId: 'scheduler-worker',
    callId
  })
  scheduler.succeed({
    expectedVersion: scheduler.version,
    occurredAt: clock.next(),
    actorId: 'scheduler-worker',
    callId,
    imageHash
  })
  return scheduler.requireSucceededReceipt(callId)
}

export interface AcceptedArtifactContext extends PromptApprovedContext {
  receipt: SchedulerReceipt
  imageQaReportHash: string
  implementationHash: string
  renderHash: string
  renderQaReportHash: string
  acceptanceHash: string
}

export function appendAcceptedArtifact(
  ledger: VisualArtifactLedger,
  scheduler: ValidatedImageScheduler,
  artifactId: ArtifactId,
  revision: number,
  hashes: HashPool,
  ledgerClock: TestClock,
  schedulerClock: TestClock,
  options: { start?: boolean; specificationHash?: string } = {}
): AcceptedArtifactContext {
  const context = appendPromptApproved(ledger, artifactId, revision, hashes, ledgerClock, options)
  const receipt = scheduleSucceededImage(scheduler, context, hashes, schedulerClock)

  ledgerClock.ensureAfter(receipt.completedAt)
  let occurredAt = ledgerClock.next()
  ledger.append({
    type: 'image-generation-recorded',
    occurredAt,
    actorId: 'image-runner',
    artifactId,
    revision,
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
      artifactId,
      revision,
      occurredAt,
      'image-runner',
      receipt.receiptHash,
      receipt.imageHash
    )
  })
  const imageQaReportHash = hashes.next()
  occurredAt = ledgerClock.next()
  ledger.append({
    type: 'image-qa-reviewed',
    occurredAt,
    actorId: 'image-reviewer',
    artifactId,
    revision,
    imageHash: receipt.imageHash,
    verdict: 'approved',
    reportHash: imageQaReportHash,
    evidence: evidence(
      'image-qa',
      artifactId,
      revision,
      occurredAt,
      'image-reviewer',
      receipt.imageHash,
      imageQaReportHash
    )
  })
  const implementationHash = hashes.next()
  occurredAt = ledgerClock.next()
  ledger.append({
    type: 'implementation-recorded',
    occurredAt,
    actorId: 'implementer',
    artifactId,
    revision,
    implementationHash,
    evidence: evidence(
      'implementation',
      artifactId,
      revision,
      occurredAt,
      'implementer',
      receipt.imageHash,
      implementationHash
    )
  })
  const renderHash = hashes.next()
  const renderQaReportHash = hashes.next()
  occurredAt = ledgerClock.next()
  ledger.append({
    type: 'render-qa-reviewed',
    occurredAt,
    actorId: 'render-reviewer',
    artifactId,
    revision,
    renderHash,
    verdict: 'approved',
    reportHash: renderQaReportHash,
    renderEvidence: evidence(
      'render',
      artifactId,
      revision,
      occurredAt,
      'implementer',
      implementationHash,
      renderHash
    ),
    qaEvidence: evidence(
      'render-qa',
      artifactId,
      revision,
      occurredAt,
      'render-reviewer',
      renderHash,
      renderQaReportHash
    )
  })
  const acceptanceHash = hashes.next()
  occurredAt = ledgerClock.next()
  ledger.append({
    type: 'artifact-accepted',
    occurredAt,
    actorId: 'acceptance-owner',
    artifactId,
    revision,
    acceptanceHash,
    evidence: evidence(
      'acceptance',
      artifactId,
      revision,
      occurredAt,
      'acceptance-owner',
      renderHash,
      acceptanceHash
    )
  })
  return {
    ...context,
    receipt,
    imageQaReportHash,
    implementationHash,
    renderHash,
    renderQaReportHash,
    acceptanceHash
  }
}

export function firstArtifactIds(plan: ArtifactPlan, count: number): ArtifactId[] {
  return expectedArtifactIds(plan).slice(0, count)
}
