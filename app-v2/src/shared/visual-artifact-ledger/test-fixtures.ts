import {
  type AuthenticatedPrincipalBinding,
  type AuthenticatedPrincipalVerifier,
  type EvidenceAttestationBinding,
  type EvidenceAttestationVerifier,
  type OpaqueAttestation,
  type PromptApprovalCheckpoint,
  type PromptApprovalCheckpointBinding,
  type PromptApprovalCheckpointVerifier,
  type RootAttestationBinding,
  type RootAttestationVerifier,
  type SchedulerAuthority,
  type SchedulerAuthorityCommit,
  type SchedulerAuthorityDependencies,
  type SchedulerAuthorityOperation,
  type SchedulerServiceReceiptBinding,
  type SchedulerServiceReceiptVerifier
} from './authorities'
import { sha256Hex } from './canonical'
import {
  VisualArtifactLedger,
  type ArtifactEvidence,
  type EvidenceKind,
  type VisualArtifactLedgerDependencies
} from './ledger'
import {
  createArtifactPlan,
  expectedArtifactIds,
  type ArtifactId,
  type ArtifactPlan
} from './plan'
import {
  ValidatedImageScheduler,
  schedulerGenesisPrincipalBinding,
  type ImageFailureReason,
  type ImageSchedulingPolicy,
  type SchedulerAction,
  type SchedulerReceipt
} from './scheduler'
import { IMAGE_REQUEST_LIMIT, ZERO_HASH } from './constants'

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

  advance(stepMs: number): void {
    this.milliseconds += stepMs
  }

  ensureAfter(timestamp: string, stepMs = 1): void {
    const minimum = Date.parse(timestamp) + stepMs
    if (this.milliseconds < minimum) this.milliseconds = minimum
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
  requestLimit: IMAGE_REQUEST_LIMIT,
  maxAttempts: 3,
  baseBackoffMs: 1_000,
  maxBackoffMs: 8_000
}

export class TestAttestationAuthority
  implements
    AuthenticatedPrincipalVerifier,
    EvidenceAttestationVerifier,
    RootAttestationVerifier,
    PromptApprovalCheckpointVerifier,
    SchedulerServiceReceiptVerifier
{
  private readonly committedPromptApprovals = new Set<string>()

  private issue(kind: string, binding: unknown): OpaqueAttestation {
    const token = `att:${sha256Hex({
        domain: 'test-attestation-v1',
        secret: 'test-only-authority-secret',
        kind,
        binding
      })}`
    return { token: token.padEnd(128, 'x') }
  }

  issuePrincipal(binding: AuthenticatedPrincipalBinding): OpaqueAttestation {
    return this.issue('principal', binding)
  }

  verifyPrincipal(
    attestation: OpaqueAttestation,
    binding: AuthenticatedPrincipalBinding
  ): boolean {
    return attestation.token === this.issuePrincipal(binding).token
  }

  issueEvidence(binding: EvidenceAttestationBinding): OpaqueAttestation {
    return this.issue('evidence', binding)
  }

  verifyEvidence(
    attestation: OpaqueAttestation,
    binding: EvidenceAttestationBinding
  ): boolean {
    return attestation.token === this.issueEvidence(binding).token
  }

  issueRoot(binding: RootAttestationBinding): OpaqueAttestation {
    return this.issue('root', binding)
  }

  verifyRoot(attestation: OpaqueAttestation, binding: RootAttestationBinding): boolean {
    return attestation.token === this.issueRoot(binding).token
  }

  issuePromptApproval(
    binding: PromptApprovalCheckpointBinding
  ): OpaqueAttestation {
    this.committedPromptApprovals.add(sha256Hex(binding))
    return this.issue('prompt-approval', binding)
  }

  verifyPromptApprovalCheckpoint(
    attestation: OpaqueAttestation,
    binding: PromptApprovalCheckpointBinding
  ): boolean {
    return (
      this.committedPromptApprovals.has(sha256Hex(binding)) &&
      attestation.token === this.issue('prompt-approval', binding).token
    )
  }

  issueServiceReceipt(binding: SchedulerServiceReceiptBinding): OpaqueAttestation {
    return this.issue('scheduler-service', binding)
  }

  verifyServiceReceipt(
    attestation: OpaqueAttestation,
    binding: SchedulerServiceReceiptBinding
  ): boolean {
    return attestation.token === this.issueServiceReceipt(binding).token
  }
}

interface AuthorityCall {
  status: 'reserved' | 'dispatched' | 'succeeded' | 'failed' | 'ambiguous'
  dispatchedAt?: number
}

export class TestSchedulerAuthority implements SchedulerAuthority {
  readonly authorityId = 'test-scheduler-authority'
  private version = 0
  private rootHash = ZERO_HASH
  private configured = false
  private circuitOpen = false
  private windowMs = 0
  private requestLimit = 0
  private outstanding = 0
  private loseNextResponse = false
  private readonly calls = new Map<string, AuthorityCall>()
  private readonly dispatchTimes: number[] = []
  private readonly commitsByOperationHash = new Map<string, SchedulerAuthorityCommit>()

  constructor(private readonly clock: TestClock) {}

  get currentVersion(): number {
    return this.version
  }

  get currentRootHash(): string {
    return this.rootHash
  }

  advance(milliseconds: number): void {
    this.clock.advance(milliseconds)
  }

  ensureAfter(timestamp: string): void {
    this.clock.ensureAfter(timestamp)
  }

  simulateLostNextResponse(): void {
    this.loseNextResponse = true
  }

  private activeDispatches(now: number): number {
    const threshold = now - this.windowMs
    return this.dispatchTimes.filter((timestamp) => timestamp >= threshold).length
  }

  private commitToken(commit: Omit<SchedulerAuthorityCommit, 'attestation'>): OpaqueAttestation {
    const token = `commit:${sha256Hex({
        domain: 'test-scheduler-authority-commit-v1',
        secret: 'test-only-scheduler-secret',
        commit
      })}`
    return { token: token.padEnd(128, 'x') }
  }

  commit(operation: SchedulerAuthorityOperation): SchedulerAuthorityCommit {
    const existing = this.commitsByOperationHash.get(operation.operationHash)
    if (existing) return existing
    if (
      operation.expectedVersion !== this.version ||
      operation.previousRootHash !== this.rootHash
    ) {
      throw new Error('stale shared scheduler CAS')
    }
    const committedAt = this.clock.next()
    const committedMs = Date.parse(committedAt)
    if (operation.action === 'configure') {
      if (this.configured || this.version !== 0) throw new Error('scheduler already configured')
      this.windowMs = operation.windowMs
      this.requestLimit = operation.requestLimit
      this.configured = true
    } else {
      if (!this.configured) throw new Error('scheduler is not configured')
      if (operation.action === 'reserve') {
        if (this.circuitOpen) throw new Error('global circuit is open')
        if (this.calls.has(operation.callId)) throw new Error('duplicate call')
        if (
          operation.notBefore !== null &&
          committedMs < Date.parse(operation.notBefore)
        ) {
          throw new Error('authoritative retry backoff has not elapsed')
        }
        if (this.activeDispatches(committedMs) + this.outstanding >= this.requestLimit) {
          throw new Error('global six-request capacity exhausted')
        }
        this.calls.set(operation.callId, { status: 'reserved' })
        this.outstanding += 1
      } else {
        const call = this.calls.get(operation.callId)
        if (!call) throw new Error('unknown call')
        if (
          operation.action === 'fail' &&
          committedMs > Date.parse(operation.latestCommittedAt)
        ) {
          throw new Error('supported timestamp range exceeded')
        }
        if (operation.action === 'dispatch') {
          if (this.circuitOpen) throw new Error('global circuit is open')
          if (call.status !== 'reserved') throw new Error('call is not reserved')
          if (
            this.activeDispatches(committedMs) + (this.outstanding - 1) + 1 >
            this.requestLimit
          ) {
            throw new Error('global rolling window exceeded')
          }
          call.status = 'dispatched'
          call.dispatchedAt = committedMs
          this.outstanding -= 1
          this.dispatchTimes.push(committedMs)
        } else {
          if (call.status !== 'dispatched') throw new Error('call is not dispatched')
          call.status =
            operation.action === 'succeed'
              ? 'succeeded'
              : operation.action === 'fail'
                ? 'failed'
                : 'ambiguous'
          if (operation.action === 'ambiguous') this.circuitOpen = true
        }
      }
    }
    const nextVersion = this.version + 1
    const nextRootHash = sha256Hex({
      domain: 'test-scheduler-authority-root-v1',
      authorityId: this.authorityId,
      version: nextVersion,
      previousRootHash: this.rootHash,
      operationHash: operation.operationHash,
      committedAt
    })
    const unsigned = {
      authorityId: this.authorityId,
      version: nextVersion,
      committedAt,
      previousRootHash: this.rootHash,
      rootHash: nextRootHash,
      operationHash: operation.operationHash
    }
    const commit = { ...unsigned, attestation: this.commitToken(unsigned) }
    this.version = nextVersion
    this.rootHash = nextRootHash
    this.commitsByOperationHash.set(operation.operationHash, commit)
    if (this.loseNextResponse) {
      this.loseNextResponse = false
      throw new Error('simulated lost authority response after durable commit')
    }
    return commit
  }

  recover(operation: SchedulerAuthorityOperation): SchedulerAuthorityCommit | undefined {
    return this.commitsByOperationHash.get(operation.operationHash)
  }

  verifyCommit(
    commit: SchedulerAuthorityCommit,
    operation: SchedulerAuthorityOperation
  ): boolean {
    const { attestation: _attestation, ...unsigned } = commit
    return (
      commit.authorityId === this.authorityId &&
      commit.operationHash === operation.operationHash &&
      commit.attestation.token === this.commitToken(unsigned).token
    )
  }
}

export interface TestGovernance {
  readonly attestations: TestAttestationAuthority
  readonly schedulerAuthority: TestSchedulerAuthority
  readonly schedulerDependencies: SchedulerAuthorityDependencies
  ledgerDependencies(scheduler?: ValidatedImageScheduler): VisualArtifactLedgerDependencies
}

export function makeGovernance(authorityClock = new TestClock()): TestGovernance {
  const attestations = new TestAttestationAuthority()
  const schedulerAuthority = new TestSchedulerAuthority(authorityClock)
  return {
    attestations,
    schedulerAuthority,
    schedulerDependencies: {
      authority: schedulerAuthority,
      principalVerifier: attestations,
      approvalVerifier: attestations,
      serviceReceiptVerifier: attestations,
      rootVerifier: attestations
    },
    ledgerDependencies: (scheduler?: ValidatedImageScheduler) => ({
      principalVerifier: attestations,
      evidenceVerifier: attestations,
      rootVerifier: attestations,
      ...(scheduler ? { scheduler } : {})
    })
  }
}

export function makeScheduler(
  governance: TestGovernance,
  policy: ImageSchedulingPolicy = DEFAULT_POLICY
): ValidatedImageScheduler {
  const genesis = { actorId: 'scheduler-control' }
  const binding = schedulerGenesisPrincipalBinding(
    policy,
    genesis,
    governance.schedulerAuthority.authorityId
  )
  return ValidatedImageScheduler.create(
    policy,
    genesis,
    governance.schedulerDependencies,
    governance.attestations.issuePrincipal(binding)
  )
}

export function schedulerPrincipal(
  scheduler: ValidatedImageScheduler,
  governance: TestGovernance,
  action: SchedulerAction,
  input: unknown
): OpaqueAttestation {
  return governance.attestations.issuePrincipal(
    scheduler.principalBindingFor(action, input)
  )
}

export function appendScheduler(
  scheduler: ValidatedImageScheduler,
  governance: TestGovernance,
  action: Exclude<SchedulerAction, 'configure'>,
  input: unknown
): unknown {
  const principal = schedulerPrincipal(scheduler, governance, action, input)
  switch (action) {
    case 'reserve':
      return scheduler.reserve(input, principal)
    case 'dispatch':
      return scheduler.dispatch(input, principal)
    case 'succeed':
      return scheduler.succeed(input, principal)
    case 'fail':
      return scheduler.fail(input, principal)
    case 'ambiguous':
      return scheduler.markAmbiguous(input, principal)
  }
}

export function appendLedger(
  ledger: VisualArtifactLedger,
  governance: TestGovernance,
  input: unknown
) {
  const principal = governance.attestations.issuePrincipal(
    ledger.principalBindingFor(input)
  )
  return ledger.append(input, principal)
}

export function evidence(
  ledger: VisualArtifactLedger,
  governance: TestGovernance,
  kind: EvidenceKind,
  artifactId: ArtifactId,
  revision: number,
  createdAt: string,
  createdBy: string,
  subjectHash: string,
  contentHash: string,
  suffix: string = kind
): ArtifactEvidence {
  const base = {
    evidenceId: `ev:${artifactId}:r${revision}:${suffix}`,
    artifactId,
    revision,
    kind,
    createdAt,
    createdBy,
    subjectHash,
    contentHash
  }
  const binding: EvidenceAttestationBinding = {
    ...base,
    planHash: ledger.plan.planHash,
    ledgerRootBefore: ledger.rootHash,
    ledgerSequence: ledger.sequence + 1
  }
  return { ...base, attestation: governance.attestations.issueEvidence(binding) }
}

export function ledgerRootAttestation(
  ledger: VisualArtifactLedger,
  governance: TestGovernance
): OpaqueAttestation {
  return governance.attestations.issueRoot({
    domain: 'visual-artifact-ledger',
    purpose: 'envelope',
    rootHash: ledger.rootHash,
    version: ledger.sequence,
    contextHash: ledger.plan.planHash
  })
}

export function schedulerRootAttestation(
  scheduler: ValidatedImageScheduler,
  governance: TestGovernance
): OpaqueAttestation {
  return governance.attestations.issueRoot({
    domain: 'image-scheduler',
    purpose: 'envelope',
    rootHash: scheduler.rootHash,
    version: scheduler.version,
    contextHash: scheduler.policyHash
  })
}

export interface PromptApprovedContext {
  artifactId: ArtifactId
  revision: number
  specificationHash: string
  researchHash: string
  promptHash: string
  promptApprovedAt: string
  promptApprovalHash: string
  approvalCheckpoint?: PromptApprovalCheckpoint
}

export function appendPromptApproved(
  ledger: VisualArtifactLedger,
  governance: TestGovernance,
  artifactId: ArtifactId,
  revision: number,
  hashes: HashPool,
  clock: TestClock,
  options: {
    start?: boolean
    specificationHash?: string
    promptVerdict?: 'approved' | 'rejected'
    promptReviewer?: string
    planner?: string
    researcher?: string
    promptAuthor?: string
  } = {}
): PromptApprovedContext {
  const specificationHash = options.specificationHash ?? hashes.next()
  const planner = options.planner ?? 'planner'
  const researcher = options.researcher ?? 'researcher'
  const promptAuthor = options.promptAuthor ?? 'prompt-author'
  if (options.start !== false) {
    appendLedger(ledger, governance, {
      type: 'artifact-revision-started',
      occurredAt: clock.next(),
      actorId: planner,
      artifactId,
      revision,
      specificationHash,
      planHash: ledger.plan.planHash
    })
  }
  const researchHash = hashes.next()
  let occurredAt = clock.next()
  appendLedger(ledger, governance, {
    type: 'research-recorded',
    occurredAt,
    actorId: researcher,
    artifactId,
    revision,
    researchHash,
    evidence: evidence(
      ledger,
      governance,
      'research',
      artifactId,
      revision,
      occurredAt,
      researcher,
      specificationHash,
      researchHash
    )
  })
  const promptHash = hashes.next()
  occurredAt = clock.next()
  appendLedger(ledger, governance, {
    type: 'prompt-drafted',
    occurredAt,
    actorId: promptAuthor,
    artifactId,
    revision,
    promptHash,
    evidence: evidence(
      ledger,
      governance,
      'prompt-draft',
      artifactId,
      revision,
      occurredAt,
      promptAuthor,
      researchHash,
      promptHash
    )
  })
  const reportHash = hashes.next()
  const reviewer = options.promptReviewer ?? 'prompt-reviewer'
  occurredAt = clock.next()
  const approvalEvent = appendLedger(ledger, governance, {
    type: 'prompt-qa-reviewed',
    occurredAt,
    actorId: reviewer,
    artifactId,
    revision,
    promptHash,
    verdict: options.promptVerdict ?? 'approved',
    reportHash,
    evidence: evidence(
      ledger,
      governance,
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
  if (approvalEvent.verdict === 'rejected') {
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
  const binding = ledger.promptApprovalCheckpointBinding(artifactId)
  return {
    artifactId,
    revision,
    specificationHash,
    researchHash,
    promptHash,
    promptApprovedAt: approvalEvent.occurredAt,
    promptApprovalHash: approvalEvent.eventHash,
    approvalCheckpoint: {
      ...binding,
      attestation: governance.attestations.issuePromptApproval(binding)
    }
  }
}

export function scheduleSucceededImage(
  scheduler: ValidatedImageScheduler,
  governance: TestGovernance,
  context: PromptApprovedContext,
  hashes: HashPool,
  attempt = 1,
  retryOfCallId: string | null = null,
  retryReason: ImageFailureReason | null = null
): SchedulerReceipt {
  if (!context.approvalCheckpoint) throw new Error('Approved prompt checkpoint is required.')
  governance.schedulerAuthority.ensureAfter(context.promptApprovedAt)
  const requestHash = hashes.next()
  const imageHash = hashes.next()
  const callId = `call:${context.artifactId}:r${context.revision}:a${attempt}`
  appendScheduler(scheduler, governance, 'reserve', {
    actorId: 'scheduler-control',
    callId,
    artifactId: context.artifactId,
    revision: context.revision,
    attempt,
    promptHash: context.promptHash,
    promptApprovalHash: context.promptApprovalHash,
    approvalCheckpoint: context.approvalCheckpoint,
    requestHash,
    retryOfCallId,
    retryReason
  })
  appendScheduler(scheduler, governance, 'dispatch', {
    actorId: 'scheduler-worker',
    callId
  })
  const serviceBinding = scheduler.serviceReceiptBinding(callId, imageHash)
  appendScheduler(scheduler, governance, 'succeed', {
    actorId: 'scheduler-worker',
    callId,
    imageHash,
    serviceReceiptAttestation:
      governance.attestations.issueServiceReceipt(serviceBinding)
  })
  return scheduler.requireSucceededReceipt(callId)
}

export function appendAcceptedArtifact(
  ledger: VisualArtifactLedger,
  scheduler: ValidatedImageScheduler,
  governance: TestGovernance,
  artifactId: ArtifactId,
  revision: number,
  hashes: HashPool,
  ledgerClock: TestClock,
  options: {
    start?: boolean
    specificationHash?: string
    actors?: {
      planner?: string
      researcher?: string
      promptAuthor?: string
      promptReviewer?: string
      imageGenerator?: string
      imageReviewer?: string
      implementer?: string
      renderReviewer?: string
      acceptanceOwner?: string
    }
  } = {}
): void {
  const actors = options.actors
  const context = appendPromptApproved(
    ledger,
    governance,
    artifactId,
    revision,
    hashes,
    ledgerClock,
    {
      ...options,
      planner: actors?.planner,
      researcher: actors?.researcher,
      promptAuthor: actors?.promptAuthor,
      promptReviewer: actors?.promptReviewer
    }
  )
  const receipt = scheduleSucceededImage(scheduler, governance, context, hashes)
  ledgerClock.ensureAfter(receipt.completedAt)
  const imageGenerator = actors?.imageGenerator ?? 'image-runner'
  const imageReviewer = actors?.imageReviewer ?? 'image-reviewer'
  const implementer = actors?.implementer ?? 'implementer'
  const renderReviewer = actors?.renderReviewer ?? 'render-reviewer'
  const acceptanceOwner = actors?.acceptanceOwner ?? 'acceptance-owner'
  let occurredAt = ledgerClock.next()
  appendLedger(ledger, governance, {
    type: 'image-generation-recorded',
    occurredAt,
    actorId: imageGenerator,
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
    schedulerAuthorityId: receipt.authorityId,
    schedulerAuthorityVersion: receipt.authorityVersion,
    schedulerAuthorityRootHash: receipt.authorityRootHash,
    schedulerAuthorityCommitHash: receipt.authorityCommitHash,
    evidence: evidence(
      ledger,
      governance,
      'image-generation',
      artifactId,
      revision,
      occurredAt,
      imageGenerator,
      receipt.receiptHash,
      receipt.imageHash
    )
  })
  const imageQaReportHash = hashes.next()
  occurredAt = ledgerClock.next()
  appendLedger(ledger, governance, {
    type: 'image-qa-reviewed',
    occurredAt,
    actorId: imageReviewer,
    artifactId,
    revision,
    imageHash: receipt.imageHash,
    verdict: 'approved',
    reportHash: imageQaReportHash,
    evidence: evidence(
      ledger,
      governance,
      'image-qa',
      artifactId,
      revision,
      occurredAt,
      imageReviewer,
      receipt.imageHash,
      imageQaReportHash
    )
  })
  const implementationHash = hashes.next()
  occurredAt = ledgerClock.next()
  appendLedger(ledger, governance, {
    type: 'implementation-recorded',
    occurredAt,
    actorId: implementer,
    artifactId,
    revision,
    implementationHash,
    evidence: evidence(
      ledger,
      governance,
      'implementation',
      artifactId,
      revision,
      occurredAt,
      implementer,
      receipt.imageHash,
      implementationHash
    )
  })
  const renderHash = hashes.next()
  const renderQaReportHash = hashes.next()
  occurredAt = ledgerClock.next()
  appendLedger(ledger, governance, {
    type: 'render-qa-reviewed',
    occurredAt,
    actorId: renderReviewer,
    artifactId,
    revision,
    renderHash,
    verdict: 'approved',
    reportHash: renderQaReportHash,
    renderEvidence: evidence(
      ledger,
      governance,
      'render',
      artifactId,
      revision,
      occurredAt,
      implementer,
      implementationHash,
      renderHash
    ),
    qaEvidence: evidence(
      ledger,
      governance,
      'render-qa',
      artifactId,
      revision,
      occurredAt,
      renderReviewer,
      renderHash,
      renderQaReportHash
    )
  })
  const acceptanceHash = hashes.next()
  occurredAt = ledgerClock.next()
  appendLedger(ledger, governance, {
    type: 'artifact-accepted',
    occurredAt,
    actorId: acceptanceOwner,
    artifactId,
    revision,
    acceptanceHash,
    evidence: evidence(
      ledger,
      governance,
      'acceptance',
      artifactId,
      revision,
      occurredAt,
      acceptanceOwner,
      renderHash,
      acceptanceHash
    )
  })
}

export function firstArtifactIds(plan: ArtifactPlan, count: number): ArtifactId[] {
  return expectedArtifactIds(plan).slice(0, count)
}
