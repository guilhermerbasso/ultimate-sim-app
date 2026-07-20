import {
  type AuthenticatedPrincipalBinding,
  type AuthenticatedPrincipalVerifier,
  type EvidenceAttestationBinding,
  type EvidenceAttestationVerifier,
  type GovernanceRole,
  type LedgerAppendAuthorityCommit,
  type LedgerAppendOperation,
  type LedgerAppendRecord,
  type LedgerFinalizationAuthority,
  type LedgerFinalizationAuthorityCommit,
  type LedgerFinalizationOperation,
  type LedgerFinalizationRecord,
  type LedgerAuthorityDependencies,
  type LedgerPublicationHead,
  type OpaqueAttestation,
  type PromptApprovalCheckpointBinding,
  type RootAttestationVerifier,
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
  assertSerializedLengthsWithinRuntimeCeiling,
  assertSerializedTextWithinRuntimeCeiling,
  assertSha256,
  canonicalStringify,
  cloneCanonical,
  compareIso,
  deepFreeze,
  ownDataValue,
  parseJson,
  sha256Hex,
  utf8ByteLength
} from './canonical'
import {
  APPROVED_EXACT_ARTIFACT_COUNT,
  MAX_EVIDENCE,
  MAX_LEDGER_EVENTS,
  MAX_REVISIONS_PER_ARTIFACT,
  MAX_SCHEDULER_EVENTS,
  MAX_SERIALIZED_BYTES,
  MAX_SERIALIZED_BYTES_PER_ARTIFACT_REVISION,
  MAX_SERIALIZED_ENVELOPE_FRAMING_BYTES,
  VISUAL_ARTIFACT_LEDGER_VERSION,
  ZERO_HASH
} from './constants'
import { fail } from './errors'
import {
  computeLedgerAppendOperationHash,
  computeLedgerFinalizationOperationHash,
  normalizeLedgerAppendCommit,
  normalizeLedgerAppendOperation,
  normalizeLedgerFinalizationCommit,
  normalizeLedgerFinalizationOperation,
  normalizeLedgerPublicationHead
} from './finalization-authority'
import {
  expectedArtifactIds,
  expectedArtifactSetHash,
  parseArtifactId,
  parseArtifactPlan,
  type ArtifactId,
  type ArtifactPlan
} from './plan'
import {
  ValidatedImageScheduler,
  type ImageFailureReason,
  type SchedulerReceipt
} from './scheduler'
import { types as utilTypes } from 'node:util'

const INTRINSIC_IS_PROXY = utilTypes.isProxy
const INTRINSIC_ARRAY_IS_ARRAY = Array.isArray
const INTRINSIC_GET_OWN_PROPERTY_DESCRIPTOR =
  Object.getOwnPropertyDescriptor
const INTRINSIC_GET_PROTOTYPE_OF = Object.getPrototypeOf

export type EvidenceKind =
  | 'research'
  | 'prompt-draft'
  | 'prompt-qa'
  | 'image-generation'
  | 'image-qa'
  | 'implementation'
  | 'render'
  | 'render-qa'
  | 'acceptance'
  | 'exhaustion'

export interface ArtifactEvidence {
  readonly evidenceId: string
  readonly artifactId: ArtifactId
  readonly revision: number
  readonly kind: EvidenceKind
  readonly createdAt: string
  readonly createdBy: string
  readonly subjectHash: string
  readonly contentHash: string
  readonly attestation: OpaqueAttestation
}

export type ArtifactRevisionStatus =
  | 'started'
  | 'researched'
  | 'prompt-drafted'
  | 'prompt-approved'
  | 'image-generated'
  | 'image-approved'
  | 'implemented'
  | 'render-approved'
  | 'accepted'
  | 'rejected'
  | 'exhausted'

export type ArtifactEventType =
  | 'artifact-revision-started'
  | 'artifact-revision-superseded'
  | 'research-recorded'
  | 'prompt-drafted'
  | 'prompt-qa-reviewed'
  | 'image-generation-recorded'
  | 'image-qa-reviewed'
  | 'implementation-recorded'
  | 'render-qa-reviewed'
  | 'artifact-accepted'
  | 'revision-exhausted'
  | 'ledger-finalized'

interface ArtifactEventHeader {
  readonly sequence: number
  readonly type: ArtifactEventType
  readonly occurredAt: string
  readonly actorId: string
  readonly principalAttestation: OpaqueAttestation
  readonly previousEventHash: string
  readonly eventHash: string
}

interface ArtifactRevisionEventHeader extends ArtifactEventHeader {
  readonly artifactId: ArtifactId
  readonly revision: number
}

export interface ArtifactRevisionStartedEvent extends ArtifactRevisionEventHeader {
  readonly type: 'artifact-revision-started'
  readonly specificationHash: string
  readonly planHash: string
}

export interface ArtifactRevisionSupersededEvent extends ArtifactRevisionEventHeader {
  readonly type: 'artifact-revision-superseded'
  readonly priorRevision: number
  readonly priorRevisionRootHash: string
  readonly specificationHash: string
  readonly planHash: string
}

export interface ResearchRecordedEvent extends ArtifactRevisionEventHeader {
  readonly type: 'research-recorded'
  readonly researchHash: string
  readonly evidence: ArtifactEvidence
}

export interface PromptDraftedEvent extends ArtifactRevisionEventHeader {
  readonly type: 'prompt-drafted'
  readonly promptHash: string
  readonly evidence: ArtifactEvidence
}

export interface PromptQaReviewedEvent extends ArtifactRevisionEventHeader {
  readonly type: 'prompt-qa-reviewed'
  readonly promptHash: string
  readonly verdict: 'approved' | 'rejected'
  readonly reportHash: string
  readonly evidence: ArtifactEvidence
}

export interface ImageGenerationRecordedEvent extends ArtifactRevisionEventHeader {
  readonly type: 'image-generation-recorded'
  readonly attempt: number
  readonly promptHash: string
  readonly promptApprovalHash: string
  readonly requestHash: string
  readonly imageHash: string
  readonly idempotencyKey: string
  readonly policyHash: string
  readonly schedulerCallId: string
  readonly schedulerCallHash: string
  readonly schedulerReceiptHash: string
  readonly schedulerAuthorityId: string
  readonly schedulerAuthorityVersion: number
  readonly schedulerAuthorityRootHash: string
  readonly schedulerAuthorityCommitHash: string
  readonly evidence: ArtifactEvidence
}

export interface ImageQaReviewedEvent extends ArtifactRevisionEventHeader {
  readonly type: 'image-qa-reviewed'
  readonly imageHash: string
  readonly verdict: 'approved' | 'rejected'
  readonly reportHash: string
  readonly evidence: ArtifactEvidence
}

export interface ImplementationRecordedEvent extends ArtifactRevisionEventHeader {
  readonly type: 'implementation-recorded'
  readonly implementationHash: string
  readonly evidence: ArtifactEvidence
}

export interface RenderQaReviewedEvent extends ArtifactRevisionEventHeader {
  readonly type: 'render-qa-reviewed'
  readonly renderHash: string
  readonly verdict: 'approved' | 'rejected'
  readonly reportHash: string
  readonly renderEvidence: ArtifactEvidence
  readonly qaEvidence: ArtifactEvidence
}

export interface ArtifactAcceptedEvent extends ArtifactRevisionEventHeader {
  readonly type: 'artifact-accepted'
  readonly acceptanceHash: string
  readonly evidence: ArtifactEvidence
}

export interface RevisionExhaustedEvent extends ArtifactRevisionEventHeader {
  readonly type: 'revision-exhausted'
  readonly schedulerCallId: string
  readonly schedulerCallHash: string
  readonly schedulerAuthorityId: string
  readonly schedulerAuthorityVersion: number
  readonly schedulerAuthorityRootHash: string
  readonly schedulerAuthorityCommitHash: string
  readonly failureReason: ImageFailureReason
  readonly exhaustionHash: string
  readonly evidence: ArtifactEvidence
}

export interface LedgerFinalizedEvent extends ArtifactEventHeader {
  readonly type: 'ledger-finalized'
  readonly planHash: string
  readonly registryHash: string
  readonly artifactCount: number
  readonly artifactSetHash: string
  readonly trustedCheckpointSequence: number
  readonly trustedCheckpointRootHash: string
  readonly trustedCheckpointAttestation: OpaqueAttestation
  readonly finalizationAuthorityId: string
  readonly finalizationAuthorityVersion: 1
  readonly finalizationAuthorityPreviousRootHash: string
  readonly finalizationAuthorityRootHash: string
  readonly finalizationAuthorityOperationHash: string
  readonly finalizationAuthorityAttestation: OpaqueAttestation
}

export type ArtifactEvent =
  | ArtifactRevisionStartedEvent
  | ArtifactRevisionSupersededEvent
  | ResearchRecordedEvent
  | PromptDraftedEvent
  | PromptQaReviewedEvent
  | ImageGenerationRecordedEvent
  | ImageQaReviewedEvent
  | ImplementationRecordedEvent
  | RenderQaReviewedEvent
  | ArtifactAcceptedEvent
  | RevisionExhaustedEvent
  | LedgerFinalizedEvent

type StoredEventMetadata =
  | 'sequence'
  | 'principalAttestation'
  | 'previousEventHash'
  | 'eventHash'

type ArtifactEventInput =
  | Omit<ArtifactRevisionStartedEvent, StoredEventMetadata>
  | Omit<ArtifactRevisionSupersededEvent, StoredEventMetadata>
  | Omit<ResearchRecordedEvent, StoredEventMetadata>
  | Omit<PromptDraftedEvent, StoredEventMetadata>
  | Omit<PromptQaReviewedEvent, StoredEventMetadata>
  | Omit<ImageGenerationRecordedEvent, StoredEventMetadata>
  | Omit<ImageQaReviewedEvent, StoredEventMetadata>
  | Omit<ImplementationRecordedEvent, StoredEventMetadata>
  | Omit<RenderQaReviewedEvent, StoredEventMetadata>
  | Omit<ArtifactAcceptedEvent, StoredEventMetadata>
  | Omit<RevisionExhaustedEvent, StoredEventMetadata>

interface MutableRevisionState {
  revision: number
  status: ArtifactRevisionStatus
  specificationHash: string
  rootHash: string
  serializedBytes: number
  researchHash?: string
  researchAuthor?: string
  promptHash?: string
  promptAuthor?: string
  promptQaReportHash?: string
  promptReviewer?: string
  promptApprovedAt?: string
  promptApprovalEventHash?: string
  promptApprovalLedgerRootHash?: string
  promptApprovalSequence?: number
  generationAttempt?: number
  requestHash?: string
  imageHash?: string
  imageGenerator?: string
  schedulerCallId?: string
  schedulerReceiptHash?: string
  imageQaReportHash?: string
  imageReviewer?: string
  implementationHash?: string
  implementer?: string
  renderHash?: string
  renderQaReportHash?: string
  renderReviewer?: string
  acceptanceHash?: string
}

interface MutableArtifactHistory {
  artifactId: ArtifactId
  revisions: MutableRevisionState[]
}

export interface ArtifactRevisionSnapshot {
  readonly revision: number
  readonly status: ArtifactRevisionStatus
  readonly specificationHash: string
  readonly rootHash: string
  readonly researchHash?: string
  readonly promptHash?: string
  readonly promptQaReportHash?: string
  readonly promptApprovedAt?: string
  readonly promptApprovalEventHash?: string
  readonly promptApprovalLedgerRootHash?: string
  readonly promptApprovalSequence?: number
  readonly generationAttempt?: number
  readonly requestHash?: string
  readonly imageHash?: string
  readonly schedulerCallId?: string
  readonly schedulerReceiptHash?: string
  readonly imageQaReportHash?: string
  readonly implementationHash?: string
  readonly renderHash?: string
  readonly renderQaReportHash?: string
  readonly acceptanceHash?: string
}

export interface ArtifactHistorySnapshot {
  readonly artifactId: ArtifactId
  readonly revisions: readonly ArtifactRevisionSnapshot[]
}

export interface LedgerCheckpoint {
  readonly schemaVersion: typeof VISUAL_ARTIFACT_LEDGER_VERSION
  readonly sequence: number
  readonly eventHash: string
  readonly rootHash: string
  readonly planHash: string
  readonly registryHash: string
}

export interface SerializedVisualArtifactLedger {
  readonly schemaVersion: typeof VISUAL_ARTIFACT_LEDGER_VERSION
  readonly plan: ArtifactPlan
  readonly rootAttestation: OpaqueAttestation
  readonly events: readonly ArtifactEvent[]
}

export interface VisualArtifactLedgerDependencies extends LedgerAuthorityDependencies {
  readonly scheduler?: ValidatedImageScheduler
}

const EVIDENCE_KEYS = [
  'evidenceId',
  'artifactId',
  'revision',
  'kind',
  'createdAt',
  'createdBy',
  'subjectHash',
  'contentHash',
  'attestation'
] as const

const EVENT_HEADER_KEYS = [
  'sequence',
  'type',
  'occurredAt',
  'actorId',
  'principalAttestation',
  'previousEventHash',
  'eventHash'
] as const

const INPUT_HEADER_KEYS = ['type', 'occurredAt', 'actorId'] as const
const REVISION_INPUT_KEYS = [...INPUT_HEADER_KEYS, 'artifactId', 'revision'] as const
const REVISION_EVENT_KEYS = [...EVENT_HEADER_KEYS, 'artifactId', 'revision'] as const

const EVIDENCE_KINDS: readonly EvidenceKind[] = [
  'research',
  'prompt-draft',
  'prompt-qa',
  'image-generation',
  'image-qa',
  'implementation',
  'render',
  'render-qa',
  'acceptance',
  'exhaustion'
]

const IMAGE_FAILURE_REASONS: readonly ImageFailureReason[] = [
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

function assertVerdict(value: unknown, label: string): 'approved' | 'rejected' {
  if (value !== 'approved' && value !== 'rejected') {
    fail('SCHEMA', `${label} must be approved or rejected.`)
  }
  return value
}

function normalizeEvidence(value: unknown, label: string): ArtifactEvidence {
  assertPlainObject(value, label)
  assertExactKeys(value, EVIDENCE_KEYS, label)
  if (!EVIDENCE_KINDS.includes(value.kind as EvidenceKind)) {
    fail('SCHEMA', `${label}.kind is unsupported.`)
  }
  return deepFreeze({
    evidenceId: assertIdentifier(value.evidenceId, `${label}.evidenceId`),
    artifactId: parseArtifactId(value.artifactId).id,
    revision: assertSafeInteger(
      value.revision,
      `${label}.revision`,
      1,
      MAX_REVISIONS_PER_ARTIFACT
    ),
    kind: value.kind as EvidenceKind,
    createdAt: assertIsoTimestamp(value.createdAt, `${label}.createdAt`),
    createdBy: assertIdentifier(value.createdBy, `${label}.createdBy`),
    subjectHash: assertSha256(value.subjectHash, `${label}.subjectHash`),
    contentHash: assertSha256(value.contentHash, `${label}.contentHash`),
    attestation: parseOpaqueAttestation(value.attestation, `${label}.attestation`)
  })
}

function normalizeInput(value: unknown): ArtifactEventInput {
  assertPlainObject(value, 'Artifact event')
  const type = value.type
  if (typeof type !== 'string') fail('SCHEMA', 'Artifact event type must be a string.')
  const occurredAt = assertIsoTimestamp(value.occurredAt, 'Artifact event occurredAt')
  const actorId = assertIdentifier(value.actorId, 'Artifact event actorId')

  if (type === 'artifact-revision-started') {
    assertExactKeys(
      value,
      [...REVISION_INPUT_KEYS, 'specificationHash', 'planHash'],
      'Artifact revision start'
    )
    return {
      type,
      occurredAt,
      actorId,
      artifactId: parseArtifactId(value.artifactId).id,
      revision: assertSafeInteger(
        value.revision,
        'Artifact revision start revision',
        1,
        MAX_REVISIONS_PER_ARTIFACT
      ),
      specificationHash: assertSha256(
        value.specificationHash,
        'Artifact revision start specificationHash'
      ),
      planHash: assertSha256(value.planHash, 'Artifact revision start planHash')
    }
  }
  if (type === 'artifact-revision-superseded') {
    assertExactKeys(
      value,
      [
        ...REVISION_INPUT_KEYS,
        'priorRevision',
        'priorRevisionRootHash',
        'specificationHash',
        'planHash'
      ],
      'Artifact revision supersession'
    )
    return {
      type,
      occurredAt,
      actorId,
      artifactId: parseArtifactId(value.artifactId).id,
      revision: assertSafeInteger(
        value.revision,
        'Artifact supersession revision',
        2,
        MAX_REVISIONS_PER_ARTIFACT
      ),
      priorRevision: assertSafeInteger(
        value.priorRevision,
        'Artifact supersession priorRevision',
        1,
        MAX_REVISIONS_PER_ARTIFACT - 1
      ),
      priorRevisionRootHash: assertSha256(
        value.priorRevisionRootHash,
        'Artifact supersession priorRevisionRootHash'
      ),
      specificationHash: assertSha256(
        value.specificationHash,
        'Artifact supersession specificationHash'
      ),
      planHash: assertSha256(value.planHash, 'Artifact supersession planHash')
    }
  }

  const artifactId = parseArtifactId(value.artifactId).id
  const revision = assertSafeInteger(
    value.revision,
    'Artifact event revision',
    1,
    MAX_REVISIONS_PER_ARTIFACT
  )
  if (type === 'research-recorded') {
    assertExactKeys(value, [...REVISION_INPUT_KEYS, 'researchHash', 'evidence'], 'Research event')
    return {
      type,
      occurredAt,
      actorId,
      artifactId,
      revision,
      researchHash: assertSha256(value.researchHash, 'Research event researchHash'),
      evidence: normalizeEvidence(value.evidence, 'Research event evidence')
    }
  }
  if (type === 'prompt-drafted') {
    assertExactKeys(value, [...REVISION_INPUT_KEYS, 'promptHash', 'evidence'], 'Prompt draft event')
    return {
      type,
      occurredAt,
      actorId,
      artifactId,
      revision,
      promptHash: assertSha256(value.promptHash, 'Prompt draft promptHash'),
      evidence: normalizeEvidence(value.evidence, 'Prompt draft evidence')
    }
  }
  if (type === 'prompt-qa-reviewed') {
    assertExactKeys(
      value,
      [...REVISION_INPUT_KEYS, 'promptHash', 'verdict', 'reportHash', 'evidence'],
      'Prompt QA event'
    )
    return {
      type,
      occurredAt,
      actorId,
      artifactId,
      revision,
      promptHash: assertSha256(value.promptHash, 'Prompt QA promptHash'),
      verdict: assertVerdict(value.verdict, 'Prompt QA verdict'),
      reportHash: assertSha256(value.reportHash, 'Prompt QA reportHash'),
      evidence: normalizeEvidence(value.evidence, 'Prompt QA evidence')
    }
  }
  if (type === 'image-generation-recorded') {
    assertExactKeys(
      value,
      [
        ...REVISION_INPUT_KEYS,
        'attempt',
        'promptHash',
        'promptApprovalHash',
        'requestHash',
        'imageHash',
        'idempotencyKey',
        'policyHash',
        'schedulerCallId',
        'schedulerCallHash',
        'schedulerReceiptHash',
        'schedulerAuthorityId',
        'schedulerAuthorityVersion',
        'schedulerAuthorityRootHash',
        'schedulerAuthorityCommitHash',
        'evidence'
      ],
      'Image generation event'
    )
    return {
      type,
      occurredAt,
      actorId,
      artifactId,
      revision,
      attempt: assertSafeInteger(value.attempt, 'Image generation attempt', 1, 10),
      promptHash: assertSha256(value.promptHash, 'Image generation promptHash'),
      promptApprovalHash: assertSha256(
        value.promptApprovalHash,
        'Image generation promptApprovalHash'
      ),
      requestHash: assertSha256(value.requestHash, 'Image generation requestHash'),
      imageHash: assertSha256(value.imageHash, 'Image generation imageHash'),
      idempotencyKey: assertIdentifier(value.idempotencyKey, 'Image generation idempotencyKey'),
      policyHash: assertSha256(value.policyHash, 'Image generation policyHash'),
      schedulerCallId: assertIdentifier(value.schedulerCallId, 'Image generation schedulerCallId'),
      schedulerCallHash: assertSha256(
        value.schedulerCallHash,
        'Image generation schedulerCallHash'
      ),
      schedulerReceiptHash: assertSha256(
        value.schedulerReceiptHash,
        'Image generation schedulerReceiptHash'
      ),
      schedulerAuthorityId: assertIdentifier(
        value.schedulerAuthorityId,
        'Image generation schedulerAuthorityId'
      ),
      schedulerAuthorityVersion: assertSafeInteger(
        value.schedulerAuthorityVersion,
        'Image generation schedulerAuthorityVersion',
        1,
        MAX_SCHEDULER_EVENTS
      ),
      schedulerAuthorityRootHash: assertSha256(
        value.schedulerAuthorityRootHash,
        'Image generation schedulerAuthorityRootHash'
      ),
      schedulerAuthorityCommitHash: assertSha256(
        value.schedulerAuthorityCommitHash,
        'Image generation schedulerAuthorityCommitHash'
      ),
      evidence: normalizeEvidence(value.evidence, 'Image generation evidence')
    }
  }
  if (type === 'image-qa-reviewed') {
    assertExactKeys(
      value,
      [...REVISION_INPUT_KEYS, 'imageHash', 'verdict', 'reportHash', 'evidence'],
      'Image QA event'
    )
    return {
      type,
      occurredAt,
      actorId,
      artifactId,
      revision,
      imageHash: assertSha256(value.imageHash, 'Image QA imageHash'),
      verdict: assertVerdict(value.verdict, 'Image QA verdict'),
      reportHash: assertSha256(value.reportHash, 'Image QA reportHash'),
      evidence: normalizeEvidence(value.evidence, 'Image QA evidence')
    }
  }
  if (type === 'implementation-recorded') {
    assertExactKeys(
      value,
      [...REVISION_INPUT_KEYS, 'implementationHash', 'evidence'],
      'Implementation event'
    )
    return {
      type,
      occurredAt,
      actorId,
      artifactId,
      revision,
      implementationHash: assertSha256(
        value.implementationHash,
        'Implementation event implementationHash'
      ),
      evidence: normalizeEvidence(value.evidence, 'Implementation evidence')
    }
  }
  if (type === 'render-qa-reviewed') {
    assertExactKeys(
      value,
      [
        ...REVISION_INPUT_KEYS,
        'renderHash',
        'verdict',
        'reportHash',
        'renderEvidence',
        'qaEvidence'
      ],
      'Render QA event'
    )
    return {
      type,
      occurredAt,
      actorId,
      artifactId,
      revision,
      renderHash: assertSha256(value.renderHash, 'Render QA renderHash'),
      verdict: assertVerdict(value.verdict, 'Render QA verdict'),
      reportHash: assertSha256(value.reportHash, 'Render QA reportHash'),
      renderEvidence: normalizeEvidence(value.renderEvidence, 'Render evidence'),
      qaEvidence: normalizeEvidence(value.qaEvidence, 'Render QA evidence')
    }
  }
  if (type === 'artifact-accepted') {
    assertExactKeys(
      value,
      [...REVISION_INPUT_KEYS, 'acceptanceHash', 'evidence'],
      'Artifact acceptance event'
    )
    return {
      type,
      occurredAt,
      actorId,
      artifactId,
      revision,
      acceptanceHash: assertSha256(value.acceptanceHash, 'Artifact acceptance acceptanceHash'),
      evidence: normalizeEvidence(value.evidence, 'Artifact acceptance evidence')
    }
  }
  if (type === 'revision-exhausted') {
    assertExactKeys(
      value,
      [
        ...REVISION_INPUT_KEYS,
        'schedulerCallId',
        'schedulerCallHash',
        'schedulerAuthorityId',
        'schedulerAuthorityVersion',
        'schedulerAuthorityRootHash',
        'schedulerAuthorityCommitHash',
        'failureReason',
        'exhaustionHash',
        'evidence'
      ],
      'Revision exhaustion event'
    )
    if (!IMAGE_FAILURE_REASONS.includes(value.failureReason as ImageFailureReason)) {
      fail('SCHEMA', 'Revision exhaustion failureReason is unsupported.')
    }
    return {
      type,
      occurredAt,
      actorId,
      artifactId,
      revision,
      schedulerCallId: assertIdentifier(
        value.schedulerCallId,
        'Revision exhaustion schedulerCallId'
      ),
      schedulerCallHash: assertSha256(
        value.schedulerCallHash,
        'Revision exhaustion schedulerCallHash'
      ),
      schedulerAuthorityId: assertIdentifier(
        value.schedulerAuthorityId,
        'Revision exhaustion schedulerAuthorityId'
      ),
      schedulerAuthorityVersion: assertSafeInteger(
        value.schedulerAuthorityVersion,
        'Revision exhaustion schedulerAuthorityVersion',
        1,
        MAX_SCHEDULER_EVENTS
      ),
      schedulerAuthorityRootHash: assertSha256(
        value.schedulerAuthorityRootHash,
        'Revision exhaustion schedulerAuthorityRootHash'
      ),
      schedulerAuthorityCommitHash: assertSha256(
        value.schedulerAuthorityCommitHash,
        'Revision exhaustion schedulerAuthorityCommitHash'
      ),
      failureReason: value.failureReason as ImageFailureReason,
      exhaustionHash: assertSha256(value.exhaustionHash, 'Revision exhaustion exhaustionHash'),
      evidence: normalizeEvidence(value.evidence, 'Revision exhaustion evidence')
    }
  }
  if (type === 'ledger-finalized') {
    fail('FINALIZATION', 'Ledger finalization is available only through finalize().')
  }
  fail('SCHEMA', `Artifact event type "${type}" is unsupported.`)
}

export function computeArtifactEventHash(event: Omit<ArtifactEvent, 'eventHash'>): string {
  return sha256Hex({ domain: 'visual-artifact-event-v2', event })
}

export function computeVisualArtifactLedgerRootHash(
  planHash: string,
  sequence: number,
  lastEventHash: string
): string {
  assertSha256(planHash, 'Ledger root planHash')
  assertSafeInteger(sequence, 'Ledger root sequence', 0, MAX_LEDGER_EVENTS)
  assertSha256(lastEventHash, 'Ledger root lastEventHash')
  return sha256Hex({
    domain: 'visual-artifact-ledger-root-v2',
    planHash,
    sequence,
    lastEventHash
  })
}

function nextRevisionRoot(previousRoot: string, eventHash: string): string {
  return sha256Hex({
    domain: 'visual-artifact-revision-root-v2',
    previousRoot,
    eventHash
  })
}

function checkpointFromUnknown(value: unknown): LedgerCheckpoint {
  assertPlainObject(value, 'Ledger checkpoint')
  assertExactKeys(
    value,
    ['schemaVersion', 'sequence', 'eventHash', 'rootHash', 'planHash', 'registryHash'],
    'Ledger checkpoint'
  )
  if (value.schemaVersion !== VISUAL_ARTIFACT_LEDGER_VERSION) {
    fail('SCHEMA', `Ledger checkpoint schemaVersion must be ${VISUAL_ARTIFACT_LEDGER_VERSION}.`)
  }
  return deepFreeze({
    schemaVersion: VISUAL_ARTIFACT_LEDGER_VERSION,
    sequence: assertSafeInteger(value.sequence, 'Ledger checkpoint sequence', 0, MAX_LEDGER_EVENTS),
    eventHash: assertSha256(value.eventHash, 'Ledger checkpoint eventHash'),
    rootHash: assertSha256(value.rootHash, 'Ledger checkpoint rootHash'),
    planHash: assertSha256(value.planHash, 'Ledger checkpoint planHash'),
    registryHash: assertSha256(value.registryHash, 'Ledger checkpoint registryHash')
  })
}

function revisionIsTerminal(status: ArtifactRevisionStatus): boolean {
  return status === 'accepted' || status === 'rejected' || status === 'exhausted'
}

interface LedgerDependencySnapshot {
  readonly principalVerifier: AuthenticatedPrincipalVerifier
  readonly verifyPrincipal: AuthenticatedPrincipalVerifier['verifyPrincipal']
  readonly evidenceVerifier: EvidenceAttestationVerifier
  readonly verifyEvidence: EvidenceAttestationVerifier['verifyEvidence']
  readonly rootVerifier: RootAttestationVerifier
  readonly verifyRoot: RootAttestationVerifier['verifyRoot']
  readonly finalizationAuthority: LedgerFinalizationAuthority
  readonly finalizationAuthorityId: string
  readonly appendCommit: LedgerFinalizationAuthority['commitAppend']
  readonly appendRecover: LedgerFinalizationAuthority['recoverAppend']
  readonly publicationEventsAfter: LedgerFinalizationAuthority['eventsAfter']
  readonly publicationHead: LedgerFinalizationAuthority['head']
  readonly verifyAppendCommit: LedgerFinalizationAuthority['verifyAppendCommit']
  readonly finalizationCommit: LedgerFinalizationAuthority['commit']
  readonly finalizationRecover: LedgerFinalizationAuthority['recover']
  readonly finalizationCurrent: LedgerFinalizationAuthority['current']
  readonly verifyFinalizationCommit: LedgerFinalizationAuthority['verifyCommit']
  readonly scheduler?: ValidatedImageScheduler
}

function ledgerDependencyMethod<
  TTarget extends object,
  TKey extends keyof TTarget
>(
  target: TTarget,
  key: TKey,
  label: string
): TTarget[TKey] {
  if (INTRINSIC_IS_PROXY(target)) fail('TRUST', `${label} cannot be supplied by a Proxy.`)
  let owner: object | null = target
  while (owner !== null) {
    if (INTRINSIC_IS_PROXY(owner)) fail('TRUST', `${label} cannot be supplied by a Proxy.`)
    const descriptor = INTRINSIC_GET_OWN_PROPERTY_DESCRIPTOR(owner, key)
    if (descriptor) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
        fail('TRUST', `${label} must be a getter-free data method.`)
      }
      return descriptor.value
    }
    owner = INTRINSIC_GET_PROTOTYPE_OF(owner)
  }
  fail('TRUST', `${label} must be a function.`)
}

function ledgerDependencyIdentity(
  target: object,
  key: string,
  label: string
): string {
  if (INTRINSIC_IS_PROXY(target)) fail('TRUST', `${label} cannot be supplied by a Proxy.`)
  const descriptor = INTRINSIC_GET_OWN_PROPERTY_DESCRIPTOR(target, key)
  if (!descriptor?.enumerable || !('value' in descriptor)) {
    fail('TRUST', `${label} must be an own enumerable data field.`)
  }
  return assertIdentifier(descriptor.value, label)
}

function assertLedgerDependencies(
  dependencies: VisualArtifactLedgerDependencies
): LedgerDependencySnapshot {
  assertPlainObject(dependencies, 'Ledger dependencies')
  assertOptionalExactKeys(
    dependencies,
    [
      'principalVerifier',
      'evidenceVerifier',
      'rootVerifier',
      'finalizationAuthority'
    ],
    ['scheduler'],
    'Ledger dependencies'
  )
  const principalVerifier = ownDataValue(
    dependencies,
    'principalVerifier',
    'Ledger dependencies.principalVerifier'
  ) as AuthenticatedPrincipalVerifier
  const evidenceVerifier = ownDataValue(
    dependencies,
    'evidenceVerifier',
    'Ledger dependencies.evidenceVerifier'
  ) as EvidenceAttestationVerifier
  const rootVerifier = ownDataValue(
    dependencies,
    'rootVerifier',
    'Ledger dependencies.rootVerifier'
  ) as RootAttestationVerifier
  const finalizationAuthority = ownDataValue(
    dependencies,
    'finalizationAuthority',
    'Ledger dependencies.finalizationAuthority'
  ) as LedgerFinalizationAuthority
  const schedulerDescriptor = Object.getOwnPropertyDescriptor(
    dependencies,
    'scheduler'
  )
  const scheduler = schedulerDescriptor && 'value' in schedulerDescriptor
    ? schedulerDescriptor.value
    : undefined
  if (
    (typeof principalVerifier !== 'object' && typeof principalVerifier !== 'function') ||
    principalVerifier === null ||
    (typeof evidenceVerifier !== 'object' && typeof evidenceVerifier !== 'function') ||
    evidenceVerifier === null ||
    (typeof rootVerifier !== 'object' && typeof rootVerifier !== 'function') ||
    rootVerifier === null ||
    (typeof finalizationAuthority !== 'object' &&
      typeof finalizationAuthority !== 'function') ||
    finalizationAuthority === null
  ) {
    fail(
      'TRUST',
      'Ledger requires explicit principal, evidence, root, and finalization authority dependencies.'
    )
  }
  if (
    scheduler !== undefined &&
    !(scheduler instanceof ValidatedImageScheduler)
  ) {
    fail('SCHEMA', 'Ledger scheduler must be a validated authoritative scheduler instance.')
  }
  return Object.freeze({
    principalVerifier,
    verifyPrincipal: ledgerDependencyMethod(
      principalVerifier,
      'verifyPrincipal',
      'Ledger principal verifier'
    ),
    evidenceVerifier,
    verifyEvidence: ledgerDependencyMethod(
      evidenceVerifier,
      'verifyEvidence',
      'Ledger evidence verifier'
    ),
    rootVerifier,
    verifyRoot: ledgerDependencyMethod(
      rootVerifier,
      'verifyRoot',
      'Ledger root verifier'
    ),
    finalizationAuthority,
    finalizationAuthorityId: ledgerDependencyIdentity(
      finalizationAuthority,
      'authorityId',
      'Ledger finalization authority id'
    ),
    appendCommit: ledgerDependencyMethod(
      finalizationAuthority,
      'commitAppend',
      'Ledger publication authority append commit'
    ),
    appendRecover: ledgerDependencyMethod(
      finalizationAuthority,
      'recoverAppend',
      'Ledger publication authority append recovery'
    ),
    publicationEventsAfter: ledgerDependencyMethod(
      finalizationAuthority,
      'eventsAfter',
      'Ledger publication authority event reader'
    ),
    publicationHead: ledgerDependencyMethod(
      finalizationAuthority,
      'head',
      'Ledger publication authority head reader'
    ),
    verifyAppendCommit: ledgerDependencyMethod(
      finalizationAuthority,
      'verifyAppendCommit',
      'Ledger publication authority append verifier'
    ),
    finalizationCommit: ledgerDependencyMethod(
      finalizationAuthority,
      'commit',
      'Ledger finalization authority commit'
    ),
    finalizationRecover: ledgerDependencyMethod(
      finalizationAuthority,
      'recover',
      'Ledger finalization authority recovery'
    ),
    finalizationCurrent: ledgerDependencyMethod(
      finalizationAuthority,
      'current',
      'Ledger finalization authority current record'
    ),
    verifyFinalizationCommit: ledgerDependencyMethod(
      finalizationAuthority,
      'verifyCommit',
      'Ledger finalization authority commit verifier'
    ),
    ...(scheduler === undefined
      ? {}
      : { scheduler: scheduler as ValidatedImageScheduler })
  })
}

function externalLedgerDependencies(
  dependencies: LedgerDependencySnapshot
): VisualArtifactLedgerDependencies {
  return {
    principalVerifier: dependencies.principalVerifier,
    evidenceVerifier: dependencies.evidenceVerifier,
    rootVerifier: dependencies.rootVerifier,
    finalizationAuthority: dependencies.finalizationAuthority,
    ...(dependencies.scheduler
      ? { scheduler: dependencies.scheduler }
      : {})
  }
}

function roleForArtifactEvent(type: ArtifactEventType): GovernanceRole {
  switch (type) {
    case 'artifact-revision-started':
    case 'artifact-revision-superseded':
      return 'planner'
    case 'research-recorded':
      return 'researcher'
    case 'prompt-drafted':
      return 'prompt-author'
    case 'prompt-qa-reviewed':
      return 'prompt-reviewer'
    case 'image-generation-recorded':
      return 'image-generator'
    case 'image-qa-reviewed':
      return 'image-reviewer'
    case 'implementation-recorded':
      return 'implementer'
    case 'render-qa-reviewed':
      return 'render-reviewer'
    case 'artifact-accepted':
    case 'revision-exhausted':
    case 'ledger-finalized':
      return 'release-owner'
  }
}

interface EvidenceExpectation {
  kind: EvidenceKind
  artifactId: ArtifactId
  revision: number
  createdAt: string
  createdBy: string
  subjectHash: string
  contentHash: string
}

interface NormalizedLedgerFinalizationInput {
  readonly occurredAt: string
  readonly actorId: string
  readonly planHash: string
  readonly registryHash: string
  readonly trustedCheckpoint: LedgerCheckpoint
  readonly trustedCheckpointAttestation: OpaqueAttestation
}

const FINALIZATION_INPUT_KEYS = [
  'occurredAt',
  'actorId',
  'planHash',
  'registryHash',
  'trustedCheckpoint',
  'trustedCheckpointAttestation'
] as const

function normalizeLedgerFinalizationInput(
  value: unknown
): NormalizedLedgerFinalizationInput {
  assertPlainObject(value, 'Ledger finalization')
  assertExactKeys(value, FINALIZATION_INPUT_KEYS, 'Ledger finalization')
  return deepFreeze({
    occurredAt: assertIsoTimestamp(
      value.occurredAt,
      'Ledger finalization occurredAt'
    ),
    actorId: assertIdentifier(value.actorId, 'Ledger finalization actorId'),
    planHash: assertSha256(value.planHash, 'Ledger finalization planHash'),
    registryHash: assertSha256(
      value.registryHash,
      'Ledger finalization registryHash'
    ),
    trustedCheckpoint: checkpointFromUnknown(value.trustedCheckpoint),
    trustedCheckpointAttestation: parseOpaqueAttestation(
      value.trustedCheckpointAttestation,
      'Ledger finalization checkpoint attestation'
    )
  })
}

export class VisualArtifactLedger {
  readonly plan: ArtifactPlan

  private readonly expectedIds: readonly ArtifactId[]
  private readonly expectedIdSet: ReadonlySet<ArtifactId>
  private readonly scheduler?: ValidatedImageScheduler
  private readonly eventLog: ArtifactEvent[] = []
  private readonly artifacts = new Map<ArtifactId, MutableArtifactHistory>()
  private readonly evidenceIds = new Map<string, string>()
  private readonly evidenceContentOwners = new Map<string, string>()
  private lastEventHash = ZERO_HASH
  private lastTimestamp = ''
  private acceptedCurrentCount = 0
  private hasAcceptedHistory = false
  private finalized = false
  private finalizationEvent?: LedgerFinalizedEvent
  private synchronizingAuthority = false
  private authoritativeSynchronizationSuppressed = false
  private serializedEventBytes = 0
  private cachedLocalRootHash?: string
  private cachedPublicationHeadSource?: object
  private cachedPublicationHead?: LedgerPublicationHead
  private hasLocallyCommittedPublicationHead = false
  private locallyCommittedSequence = 0
  private locallyCommittedRootHash = ''
  private locallyCommittedEventHash = ''
  private locallyCommittedAcceptedCount = 0
  private locallyCommittedAuthorityRootHash = ''

  private constructor(
    plan: ArtifactPlan,
    private readonly dependencies: LedgerDependencySnapshot
  ) {
    this.plan = plan
    this.expectedIds = expectedArtifactIds(plan)
    this.expectedIdSet = new Set(this.expectedIds)
    this.scheduler = dependencies.scheduler
  }

  static create(
    planValue: unknown,
    dependenciesValue: VisualArtifactLedgerDependencies
  ): VisualArtifactLedger {
    return new VisualArtifactLedger(
      parseArtifactPlan(planValue),
      assertLedgerDependencies(dependenciesValue)
    )
  }

  private localRootHash(): string {
    if (this.cachedLocalRootHash === undefined) {
      this.cachedLocalRootHash = computeVisualArtifactLedgerRootHash(
        this.plan.planHash,
        this.eventLog.length,
        this.lastEventHash
      )
    }
    return this.cachedLocalRootHash
  }

  private externalDependencies(): VisualArtifactLedgerDependencies {
    return externalLedgerDependencies(this.dependencies)
  }

  private normalizeFinalizationRecord(value: unknown): LedgerFinalizationRecord {
    assertPlainObject(value, 'Ledger finalization authority record')
    assertExactKeys(
      value,
      ['operation', 'commit'],
      'Ledger finalization authority record'
    )
    const operation = normalizeLedgerFinalizationOperation(value.operation)
    const commit = normalizeLedgerFinalizationCommit(value.commit)
    if (
      operation.authorityId !== this.dependencies.finalizationAuthorityId ||
      operation.planHash !== this.plan.planHash ||
      operation.registryHash !== this.plan.registryHash ||
      commit.authorityId !== this.dependencies.finalizationAuthorityId ||
      commit.operationHash !== operation.operationHash
    ) {
      fail('TRUST', 'Ledger finalization authority record does not belong to this ledger.')
    }
    invokeSynchronousVerifier(
      this.dependencies.verifyFinalizationCommit,
      this.dependencies.finalizationAuthority,
      [commit, operation],
      'Ledger finalization authority commit verifier'
    )
    return deepFreeze({ operation, commit })
  }

  private normalizeAppendRecord(value: unknown): LedgerAppendRecord {
    assertPlainObject(value, 'Ledger publication authority append record')
    assertExactKeys(
      value,
      ['operation', 'commit'],
      'Ledger publication authority append record'
    )
    const operation = normalizeLedgerAppendOperation(value.operation)
    const commit = normalizeLedgerAppendCommit(value.commit)
    if (
      operation.authorityId !== this.dependencies.finalizationAuthorityId ||
      operation.planHash !== this.plan.planHash ||
      operation.registryHash !== this.plan.registryHash ||
      commit.authorityId !== this.dependencies.finalizationAuthorityId ||
      commit.operationHash !== operation.operationHash
    ) {
      fail('TRUST', 'Ledger publication append record does not belong to this ledger.')
    }
    invokeSynchronousVerifier(
      this.dependencies.verifyAppendCommit,
      this.dependencies.finalizationAuthority,
      [commit, operation],
      'Ledger publication authority append commit verifier'
    )
    return deepFreeze({ operation, commit })
  }

  private currentPublicationHead(): LedgerPublicationHead | undefined {
    const head = Reflect.apply(
      this.dependencies.publicationHead,
      this.dependencies.finalizationAuthority,
      [this.plan.planHash]
    ) as LedgerPublicationHead | undefined
    if (head === undefined) return undefined
    if (
      typeof head === 'object' &&
      head !== null &&
      head === this.cachedPublicationHeadSource &&
      this.cachedPublicationHead
    ) {
      return this.cachedPublicationHead
    }
    if (
      this.hasLocallyCommittedPublicationHead &&
      this.matchesLocallyCommittedPublicationHead(head)
    ) {
      this.cachedPublicationHeadSource = head
      this.cachedPublicationHead = head
      return head
    }
    const normalized = normalizeLedgerPublicationHead(head)
    if (
      normalized.authorityId !== this.dependencies.finalizationAuthorityId ||
      normalized.planHash !== this.plan.planHash ||
      normalized.registryHash !== this.plan.registryHash
    ) {
      fail('TRUST', 'Ledger publication authority head does not belong to this ledger.')
    }
    if (typeof head === 'object' && head !== null && Object.isFrozen(head)) {
      this.cachedPublicationHeadSource = head
      this.cachedPublicationHead = normalized
    }
    return normalized
  }

  private matchesLocallyCommittedPublicationHead(
    value: LedgerPublicationHead
  ): boolean {
    if (!Object.isFrozen(value)) return false
    assertPlainObject(value, 'Ledger publication authority head')
    assertExactKeys(
      value,
      [
        'authorityId',
        'planHash',
        'registryHash',
        'ledgerSequence',
        'ledgerRootHash',
        'ledgerEventHash',
        'acceptedArtifactCount',
        'authorityRootHash',
        'finalized'
      ],
      'Ledger publication authority head'
    )
    return (
      value.authorityId === this.dependencies.finalizationAuthorityId &&
      value.planHash === this.plan.planHash &&
      value.registryHash === this.plan.registryHash &&
      value.ledgerSequence === this.locallyCommittedSequence &&
      value.ledgerRootHash === this.locallyCommittedRootHash &&
      value.ledgerEventHash === this.locallyCommittedEventHash &&
      value.acceptedArtifactCount === this.locallyCommittedAcceptedCount &&
      value.authorityRootHash === this.locallyCommittedAuthorityRootHash &&
      value.finalized === false
    )
  }

  private authoritativeEventsAfter(sequence: number): readonly LedgerAppendRecord[] {
    const records = Reflect.apply(
      this.dependencies.publicationEventsAfter,
      this.dependencies.finalizationAuthority,
      [this.plan.planHash, sequence]
    ) as readonly LedgerAppendRecord[]
    if (!INTRINSIC_ARRAY_IS_ARRAY(records) || INTRINSIC_IS_PROXY(records)) {
      fail('TRUST', 'Ledger publication authority events must be a concrete array.')
    }
    if (records.length > MAX_LEDGER_EVENTS - sequence) {
      fail('CARDINALITY', 'Ledger publication authority returned too many events.')
    }
    const normalized: LedgerAppendRecord[] = []
    for (let index = 0; index < records.length; index += 1) {
      const descriptor = INTRINSIC_GET_OWN_PROPERTY_DESCRIPTOR(
        records,
        String(index)
      )
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        fail(
          'TRUST',
          'Ledger publication authority events must be dense own data.'
        )
      }
      Object.defineProperty(normalized, String(index), {
        value: this.normalizeAppendRecord(descriptor.value),
        enumerable: true,
        configurable: true,
        writable: true
      })
    }
    return deepFreeze(normalized)
  }

  private currentFinalizationRecord(): LedgerFinalizationRecord | undefined {
    const record = Reflect.apply(
      this.dependencies.finalizationCurrent,
      this.dependencies.finalizationAuthority,
      [this.plan.planHash]
    ) as LedgerFinalizationRecord | undefined
    return record === undefined
      ? undefined
      : this.normalizeFinalizationRecord(record)
  }

  private ordinarySequence(): number {
    return this.finalized ? this.eventLog.length - 1 : this.eventLog.length
  }

  private ordinaryEventHash(): string {
    const sequence = this.ordinarySequence()
    return sequence === 0 ? ZERO_HASH : this.eventLog[sequence - 1].eventHash
  }

  private ordinaryRootHash(): string {
    return computeVisualArtifactLedgerRootHash(
      this.plan.planHash,
      this.ordinarySequence(),
      this.ordinaryEventHash()
    )
  }

  private assertPublicationHeadMatchesLocal(
    head: LedgerPublicationHead
  ): void {
    if (
      head.ledgerSequence !== this.ordinarySequence() ||
      head.ledgerRootHash !== this.ordinaryRootHash() ||
      head.ledgerEventHash !== this.ordinaryEventHash() ||
      head.acceptedArtifactCount !== this.acceptedCurrentCount
    ) {
      fail('CAS', 'Ledger local state diverged from the shared publication head.')
    }
  }

  private replayAuthoritativeAppend(record: LedgerAppendRecord): void {
    const operation = record.operation
    if (
      this.finalized ||
      operation.expectedLedgerSequence !== this.eventLog.length ||
      operation.expectedLedgerRootHash !== this.localRootHash() ||
      operation.expectedLedgerEventHash !== this.lastEventHash ||
      operation.expectedAcceptedArtifactCount !== this.acceptedCurrentCount ||
      operation.nextLedgerSequence !== this.eventLog.length + 1
    ) {
      fail('CAS', 'Ledger publication authority append history is not contiguous.')
    }
    const stored = operation.event as ArtifactEvent
    const storedInput = storedEventToInput(
      stored,
      operation.nextLedgerSequence,
      this.lastEventHash
    )
    const priorSuppression = this.authoritativeSynchronizationSuppressed
    this.authoritativeSynchronizationSuppressed = true
    try {
      const generated = this.append(
       storedInput.input,
       storedInput.principalAttestation
      )
      if (
       canonicalStringify(stored) !== canonicalStringify(generated) ||
       generated.eventHash !== operation.nextLedgerEventHash ||
       this.localRootHash() !== operation.nextLedgerRootHash ||
       this.acceptedCurrentCount !== operation.nextAcceptedArtifactCount
      ) {
       fail(
         'INTEGRITY',
         'Ledger publication authority append record does not replay to its committed head.'
       )
      }
    } finally {
      this.authoritativeSynchronizationSuppressed = priorSuppression
    }
  }

  private synchronizeAuthoritativePublication(): void {
    if (
      this.authoritativeSynchronizationSuppressed ||
      this.synchronizingAuthority
    ) {
      return
    }
    this.synchronizingAuthority = true
    try {
      for (;;) {
       const head = this.currentPublicationHead()
       const ordinarySequence = this.ordinarySequence()
       if (!head) {
         if (ordinarySequence !== 0 || this.finalized) {
           fail(
             'TRUST',
             'Ledger history is missing its shared durable publication head.'
           )
         }
         return
       }
       if (head.ledgerSequence < ordinarySequence) {
         fail('CAS', 'Ledger local history is ahead of its publication authority.')
       }
       if (head.ledgerSequence > ordinarySequence) {
         const records = this.authoritativeEventsAfter(ordinarySequence)
         if (records.length === 0) {
           fail(
             'INTEGRITY',
             'Ledger publication authority head is missing its committed events.'
           )
         }
         for (const record of records) this.replayAuthoritativeAppend(record)
         continue
       }
       this.assertPublicationHeadMatchesLocal(head)
       if (!head.finalized) {
         if (this.finalized) {
           fail('CAS', 'Local finalization is absent from the publication authority.')
         }
         return
       }
       const record = this.currentFinalizationRecord()
       if (!record) {
         fail('TRUST', 'Finalized publication head is missing its authoritative record.')
       }
       if (
         record.operation.expectedLedgerSequence !== head.ledgerSequence ||
         record.operation.expectedLedgerRootHash !== head.ledgerRootHash ||
         record.operation.trustedCheckpointEventHash !== head.ledgerEventHash ||
         record.operation.artifactCount !== head.acceptedArtifactCount ||
         record.commit.rootHash !== head.authorityRootHash
       ) {
         fail('CAS', 'Ledger finalization record diverges from the publication head.')
       }
       if (this.finalized) {
         if (
           !this.finalizationEvent ||
           this.finalizationEvent.finalizationAuthorityOperationHash !==
             record.operation.operationHash ||
           this.finalizationEvent.finalizationAuthorityRootHash !==
             record.commit.rootHash
         ) {
           fail(
             'CAS',
             'Ledger finalization authority exposes a split finalized head.'
           )
         }
         return
       }
       this.appendFinalization(
         {
           occurredAt: record.operation.occurredAt,
           actorId: record.operation.actorId,
           planHash: record.operation.planHash,
           registryHash: record.operation.registryHash,
           trustedCheckpoint: {
             schemaVersion: VISUAL_ARTIFACT_LEDGER_VERSION,
             sequence: record.operation.trustedCheckpointSequence,
             eventHash: record.operation.trustedCheckpointEventHash,
             rootHash: record.operation.trustedCheckpointRootHash,
             planHash: record.operation.planHash,
             registryHash: record.operation.registryHash
           },
           trustedCheckpointAttestation:
             record.operation.trustedCheckpointAttestation
         },
         record.operation.principalAttestation,
         true,
         record.operation,
         record.commit
       )
       return
      }
    } finally {
      this.synchronizingAuthority = false
    }
  }

  get sequence(): number {
    this.synchronizeAuthoritativePublication()
    return this.eventLog.length
  }

  get eventCount(): number {
    this.synchronizeAuthoritativePublication()
    return this.eventLog.length
  }

  get artifactCount(): number {
    this.synchronizeAuthoritativePublication()
    return this.artifacts.size
  }

  get evidenceCount(): number {
    this.synchronizeAuthoritativePublication()
    return this.evidenceIds.size
  }

  get acceptedArtifactCount(): number {
    this.synchronizeAuthoritativePublication()
    return this.acceptedCurrentCount
  }

  get isFinalized(): boolean {
    this.synchronizeAuthoritativePublication()
    return this.finalized
  }

  get rootHash(): string {
    this.synchronizeAuthoritativePublication()
    return this.localRootHash()
  }

  principalBindingFor(value: unknown): AuthenticatedPrincipalBinding {
    this.synchronizeAuthoritativePublication()
    const input = normalizeInput(value)
    return deepFreeze({
      domain: 'visual-artifact-ledger',
      principalId: input.actorId,
      role: roleForArtifactEvent(input.type),
      action: input.type,
      actionHash: sha256Hex({
        domain: 'visual-artifact-principal-action-v1',
        event: input
      }),
      contextRootHash: this.localRootHash(),
      contextVersion: this.eventLog.length
    })
  }

  evidenceBindingFor(value: unknown): EvidenceAttestationBinding {
    this.synchronizeAuthoritativePublication()
    assertPlainObject(value, 'Artifact evidence binding input')
    assertExactKeys(
      value,
      EVIDENCE_KEYS.filter((key) => key !== 'attestation'),
      'Artifact evidence binding input'
    )
    const evidence = normalizeEvidence(
      { ...value, attestation: { token: 'pending-attestation' } },
      'Artifact evidence binding input'
    )
    return deepFreeze({
      evidenceId: evidence.evidenceId,
      artifactId: evidence.artifactId,
      revision: evidence.revision,
      kind: evidence.kind,
      createdAt: evidence.createdAt,
      createdBy: evidence.createdBy,
      subjectHash: evidence.subjectHash,
      contentHash: evidence.contentHash,
      planHash: this.plan.planHash,
      ledgerRootBefore: this.localRootHash(),
      ledgerSequence: this.eventLog.length + 1
    })
  }

  private verifyPrincipal(
    input: ArtifactEventInput,
    attestation: OpaqueAttestation
  ): void {
    const binding: AuthenticatedPrincipalBinding = {
      domain: 'visual-artifact-ledger',
      principalId: input.actorId,
      role: roleForArtifactEvent(input.type),
      action: input.type,
      actionHash: sha256Hex({
        domain: 'visual-artifact-principal-action-v1',
        event: input
      }),
      contextRootHash: this.localRootHash(),
      contextVersion: this.eventLog.length
    }
    invokeSynchronousVerifier(
      this.dependencies.verifyPrincipal,
      this.dependencies.principalVerifier,
      [attestation, binding],
      `Principal verifier for ${input.type}`
    )
  }

  private assertWritable(synchronize = true): void {
    if (synchronize) this.synchronizeAuthoritativePublication()
    if (this.finalized) fail('FINALIZATION', 'A finalized visual artifact ledger is immutable.')
    if (this.eventLog.length >= MAX_LEDGER_EVENTS) {
      fail('CARDINALITY', `Ledger event limit ${MAX_LEDGER_EVENTS} reached.`)
    }
  }

  private publishAppend(
    event: ArtifactEvent,
    nextAcceptedArtifactCount: number
  ): string {
    const nextLedgerRootHash = computeVisualArtifactLedgerRootHash(
      this.plan.planHash,
      event.sequence,
      event.eventHash
    )
    if (this.authoritativeSynchronizationSuppressed) {
      return nextLedgerRootHash
    }
    const operationWithoutHash = {
      authorityId: this.dependencies.finalizationAuthorityId,
      expectedLedgerSequence: this.eventLog.length,
      expectedLedgerRootHash: this.localRootHash(),
      expectedLedgerEventHash: this.lastEventHash,
      expectedAcceptedArtifactCount: this.acceptedCurrentCount,
      planHash: this.plan.planHash,
      registryHash: this.plan.registryHash,
      nextLedgerSequence: event.sequence,
      nextLedgerRootHash,
      nextLedgerEventHash: event.eventHash,
      nextAcceptedArtifactCount,
      event
    }
    const operation: LedgerAppendOperation = deepFreeze({
      ...operationWithoutHash,
      operationHash: computeLedgerAppendOperationHash(operationWithoutHash)
    })
    let commit: LedgerAppendAuthorityCommit
    let recoveredAfterCommitFailure = false
    try {
      commit = normalizeLedgerAppendCommit(
        Reflect.apply(
          this.dependencies.appendCommit,
          this.dependencies.finalizationAuthority,
          [operation]
        )
      )
    } catch (error) {
      const recovered = Reflect.apply(
        this.dependencies.appendRecover,
        this.dependencies.finalizationAuthority,
        [operation]
      ) as LedgerAppendAuthorityCommit | undefined
      if (!recovered) {
        const message = error instanceof Error ? error.message : String(error)
        fail('CAS', `Ledger publication authority rejected atomic append: ${message}`)
      }
      commit = normalizeLedgerAppendCommit(recovered)
      recoveredAfterCommitFailure = true
    }
    if (
      commit.authorityId !== this.dependencies.finalizationAuthorityId ||
      commit.version !== 1 ||
      commit.committedAt !== event.occurredAt ||
      commit.operationHash !== operation.operationHash
    ) {
      fail('TRUST', 'Ledger publication authority returned an invalid append commit.')
    }
    invokeSynchronousVerifier(
      this.dependencies.verifyAppendCommit,
      this.dependencies.finalizationAuthority,
      [commit, operation],
      'Ledger publication authority append commit verifier'
    )
    if (recoveredAfterCommitFailure) {
      const durableRecords = this.authoritativeEventsAfter(
        operation.expectedLedgerSequence
      )
      const durableRecord =
        durableRecords.length > 0
          ? durableRecords[0]
          : undefined
      if (
        !durableRecord ||
        canonicalStringify(durableRecord.operation) !==
          canonicalStringify(operation) ||
        canonicalStringify(durableRecord.commit) !== canonicalStringify(commit)
      ) {
        fail(
          'CAS',
          'Recovered ledger append is not present in durable authoritative history.'
        )
      }
    }
    this.cachedPublicationHeadSource = undefined
    this.cachedPublicationHead = undefined
    this.hasLocallyCommittedPublicationHead = true
    this.locallyCommittedSequence = operation.nextLedgerSequence
    this.locallyCommittedRootHash = operation.nextLedgerRootHash
    this.locallyCommittedEventHash = operation.nextLedgerEventHash
    this.locallyCommittedAcceptedCount =
      operation.nextAcceptedArtifactCount
    this.locallyCommittedAuthorityRootHash = commit.rootHash
    return nextLedgerRootHash
  }

  private assertTimestamp(timestamp: string): void {
    if (this.lastTimestamp && compareIso(timestamp, this.lastTimestamp) < 0) {
      fail('INTEGRITY', 'Artifact event timestamps must be globally nondecreasing.')
    }
  }

  private currentRevision(artifactId: ArtifactId, revision: number): MutableRevisionState {
    const history = this.artifacts.get(artifactId)
    if (!history) fail('LIFECYCLE', `Artifact "${artifactId}" has not started revision 1.`)
    const current = history.revisions[history.revisions.length - 1]
    if (current.revision !== revision) {
      fail('LIFECYCLE', `Artifact "${artifactId}" current revision is ${current.revision}, not ${revision}.`)
    }
    return current
  }

  private assertExpectedArtifact(artifactId: ArtifactId): void {
    if (!this.expectedIdSet.has(artifactId)) {
      fail('INTEGRITY', `Artifact "${artifactId}" is not an exact member of the governed plan.`)
    }
  }

  private assertEvidence(
    evidence: ArtifactEvidence,
    expected: EvidenceExpectation,
    pending: readonly ArtifactEvidence[] = []
  ): void {
    for (const [key, value] of Object.entries(expected)) {
      if (evidence[key as keyof ArtifactEvidence] !== value) {
        fail('INTEGRITY', `Evidence "${evidence.evidenceId}" has a foreign or mismatched ${key}.`)
      }
    }
    const owner = `${expected.artifactId}#${expected.revision}`
    if (this.evidenceIds.has(evidence.evidenceId)) {
      fail('INTEGRITY', `Evidence id "${evidence.evidenceId}" is already owned by another event.`)
    }
    const contentOwner = this.evidenceContentOwners.get(evidence.contentHash)
    if (contentOwner) {
      fail('INTEGRITY', `Evidence content ${evidence.contentHash} is already owned by ${contentOwner}.`)
    }
    if (
      pending.some(
        (entry) =>
          entry.evidenceId === evidence.evidenceId || entry.contentHash === evidence.contentHash
      )
    ) {
      fail('INTEGRITY', 'One event cannot reuse an evidence id or content hash.')
    }
    if (this.evidenceIds.size + pending.length >= MAX_EVIDENCE) {
      fail('CARDINALITY', `Ledger evidence limit ${MAX_EVIDENCE} reached.`)
    }
    if (owner.length > 256) fail('CARDINALITY', 'Evidence owner key exceeds its limit.')
    const binding: EvidenceAttestationBinding = {
      evidenceId: evidence.evidenceId,
      artifactId: evidence.artifactId,
      revision: evidence.revision,
      kind: evidence.kind,
      createdAt: evidence.createdAt,
      createdBy: evidence.createdBy,
      subjectHash: evidence.subjectHash,
      contentHash: evidence.contentHash,
      planHash: this.plan.planHash,
      ledgerRootBefore: this.localRootHash(),
      ledgerSequence: this.eventLog.length + 1
    }
    invokeSynchronousVerifier(
      this.dependencies.verifyEvidence,
      this.dependencies.evidenceVerifier,
      [evidence.attestation, binding],
      `Evidence verifier for "${evidence.evidenceId}"`
    )
  }

  private commitEvidence(evidence: ArtifactEvidence): void {
    const owner = `${evidence.artifactId}#${evidence.revision}`
    this.evidenceIds.set(evidence.evidenceId, owner)
    this.evidenceContentOwners.set(evidence.contentHash, owner)
  }

  private assertReceiptMatches(
    input: Extract<ArtifactEventInput, { type: 'image-generation-recorded' }>,
    revision: MutableRevisionState
  ): SchedulerReceipt {
    if (!this.scheduler) {
      fail('RECEIPT', 'Image generation requires the one supplied validated scheduler authority.')
    }
    const receipt = this.scheduler.requireSucceededReceipt(input.schedulerCallId)
    const expected: Record<string, unknown> = {
      artifactId: input.artifactId,
      revision: input.revision,
      attempt: input.attempt,
      promptHash: input.promptHash,
      promptApprovalHash: input.promptApprovalHash,
      approvalLedgerRootHash: revision.promptApprovalLedgerRootHash,
      approvalLedgerSequence: revision.promptApprovalSequence,
      approvalPlanHash: this.plan.planHash,
      promptApprovedAt: revision.promptApprovedAt!,
      requestHash: input.requestHash,
      imageHash: input.imageHash,
      idempotencyKey: input.idempotencyKey,
      policyHash: input.policyHash,
      callHash: input.schedulerCallHash,
      receiptHash: input.schedulerReceiptHash,
      authorityId: input.schedulerAuthorityId,
      authorityVersion: input.schedulerAuthorityVersion,
      authorityRootHash: input.schedulerAuthorityRootHash,
      authorityCommitHash: input.schedulerAuthorityCommitHash
    }
    for (const [key, value] of Object.entries(expected)) {
      if (receipt[key as keyof SchedulerReceipt] !== value) {
        fail('RECEIPT', `Scheduler receipt ${input.schedulerCallId} does not match ${key}.`)
      }
    }
    if (compareIso(input.occurredAt, receipt.completedAt) < 0) {
      fail('RECEIPT', 'Image generation evidence cannot predate scheduler completion.')
    }
    if (
      !revision.promptApprovedAt ||
      !revision.promptApprovalEventHash ||
      !revision.promptApprovalLedgerRootHash ||
      revision.promptApprovalSequence === undefined ||
      input.promptApprovalHash !== revision.promptApprovalEventHash ||
      compareIso(receipt.reservedAt, revision.promptApprovedAt) <= 0
    ) {
      fail('RECEIPT', 'Scheduler reservation must be strictly after and bound to prompt approval.')
    }
    return receipt
  }

  append(value: unknown, principalAttestationValue: unknown): ArtifactEvent {
    this.assertWritable(false)
    const input = normalizeInput(value)
    const principalAttestation = parseOpaqueAttestation(
      principalAttestationValue,
      'Artifact event principal attestation'
    )
    this.verifyPrincipal(input, principalAttestation)
    this.assertTimestamp(input.occurredAt)
    this.assertExpectedArtifact(input.artifactId)

    const evidenceToCommit: ArtifactEvidence[] = []
    let revisionForRoot: MutableRevisionState | undefined
    if (input.type === 'artifact-revision-started') {
      if (input.revision !== 1) fail('LIFECYCLE', 'The first artifact revision must be revision 1.')
      if (input.planHash !== this.plan.planHash) fail('INTEGRITY', 'Revision start planHash is incorrect.')
      if (this.artifacts.has(input.artifactId)) {
        fail('LIFECYCLE', `Artifact "${input.artifactId}" already has revision history.`)
      }
    } else if (input.type === 'artifact-revision-superseded') {
      if (input.planHash !== this.plan.planHash) {
        fail('INTEGRITY', 'Revision supersession planHash is incorrect.')
      }
      const history = this.artifacts.get(input.artifactId)
      if (!history) fail('LIFECYCLE', 'Revision supersession requires a complete prior history.')
      const prior = history.revisions[history.revisions.length - 1]
      if (!revisionIsTerminal(prior.status)) {
        fail('LIFECYCLE', 'A revision may be superseded only after accepted, rejected, or exhausted.')
      }
      if (
        input.priorRevision !== prior.revision ||
        input.revision !== prior.revision + 1 ||
        input.priorRevisionRootHash !== prior.rootHash
      ) {
        fail('INTEGRITY', 'Revision supersession must be contiguous and link the full prior root.')
      }
    } else {
      const revision = this.currentRevision(input.artifactId, input.revision)
      revisionForRoot = revision
      if (input.type === 'research-recorded') {
        if (revision.status !== 'started') fail('LIFECYCLE', 'Research must be the first lifecycle stage.')
        this.assertEvidence(input.evidence, {
          kind: 'research',
          artifactId: input.artifactId,
          revision: input.revision,
          createdAt: input.occurredAt,
          createdBy: input.actorId,
          subjectHash: revision.specificationHash,
          contentHash: input.researchHash
        })
        evidenceToCommit.push(input.evidence)
      } else if (input.type === 'prompt-drafted') {
        if (revision.status !== 'researched' || !revision.researchHash) {
          fail('LIFECYCLE', 'Prompt drafting requires completed research.')
        }
        this.assertEvidence(input.evidence, {
          kind: 'prompt-draft',
          artifactId: input.artifactId,
          revision: input.revision,
          createdAt: input.occurredAt,
          createdBy: input.actorId,
          subjectHash: revision.researchHash,
          contentHash: input.promptHash
        })
        evidenceToCommit.push(input.evidence)
      } else if (input.type === 'prompt-qa-reviewed') {
        if (revision.status !== 'prompt-drafted' || !revision.promptHash || !revision.promptAuthor) {
          fail('LIFECYCLE', 'Prompt QA requires one drafted prompt.')
        }
        if (input.promptHash !== revision.promptHash) {
          fail('INTEGRITY', 'Prompt QA subject does not match the drafted prompt.')
        }
        if (input.actorId === revision.promptAuthor || input.actorId === revision.researchAuthor) {
          fail('LIFECYCLE', 'Prompt QA must be independent from prompt drafting and research.')
        }
        this.assertEvidence(input.evidence, {
          kind: 'prompt-qa',
          artifactId: input.artifactId,
          revision: input.revision,
          createdAt: input.occurredAt,
          createdBy: input.actorId,
          subjectHash: input.promptHash,
          contentHash: input.reportHash
        })
        evidenceToCommit.push(input.evidence)
      } else if (input.type === 'image-generation-recorded') {
        if (revision.status !== 'prompt-approved' || !revision.promptHash) {
          fail('LIFECYCLE', 'Image generation requires independent approved prompt QA.')
        }
        if (input.promptHash !== revision.promptHash) {
          fail('INTEGRITY', 'Image generation prompt differs from the approved prompt.')
        }
        this.assertReceiptMatches(input, revision)
        this.assertEvidence(input.evidence, {
          kind: 'image-generation',
          artifactId: input.artifactId,
          revision: input.revision,
          createdAt: input.occurredAt,
          createdBy: input.actorId,
          subjectHash: input.schedulerReceiptHash,
          contentHash: input.imageHash
        })
        evidenceToCommit.push(input.evidence)
      } else if (input.type === 'image-qa-reviewed') {
        if (revision.status !== 'image-generated' || !revision.imageHash || !revision.imageGenerator) {
          fail('LIFECYCLE', 'Image QA requires scheduler-backed image generation.')
        }
        if (input.imageHash !== revision.imageHash) {
          fail('INTEGRITY', 'Image QA subject does not match the generated image.')
        }
        if (input.actorId === revision.imageGenerator) {
          fail('LIFECYCLE', 'Image QA must be independent from image generation.')
        }
        this.assertEvidence(input.evidence, {
          kind: 'image-qa',
          artifactId: input.artifactId,
          revision: input.revision,
          createdAt: input.occurredAt,
          createdBy: input.actorId,
          subjectHash: input.imageHash,
          contentHash: input.reportHash
        })
        evidenceToCommit.push(input.evidence)
      } else if (input.type === 'implementation-recorded') {
        if (revision.status !== 'image-approved' || !revision.imageHash) {
          fail('LIFECYCLE', 'Implementation requires independently approved image QA.')
        }
        this.assertEvidence(input.evidence, {
          kind: 'implementation',
          artifactId: input.artifactId,
          revision: input.revision,
          createdAt: input.occurredAt,
          createdBy: input.actorId,
          subjectHash: revision.imageHash,
          contentHash: input.implementationHash
        })
        evidenceToCommit.push(input.evidence)
      } else if (input.type === 'render-qa-reviewed') {
        if (revision.status !== 'implemented' || !revision.implementationHash || !revision.implementer) {
          fail('LIFECYCLE', 'Render QA requires implementation.')
        }
        if (input.actorId === revision.implementer) {
          fail('LIFECYCLE', 'Render QA must be independent from implementation.')
        }
        this.assertEvidence(input.renderEvidence, {
          kind: 'render',
          artifactId: input.artifactId,
          revision: input.revision,
          createdAt: input.occurredAt,
          createdBy: revision.implementer,
          subjectHash: revision.implementationHash,
          contentHash: input.renderHash
        })
        this.assertEvidence(
          input.qaEvidence,
          {
            kind: 'render-qa',
            artifactId: input.artifactId,
            revision: input.revision,
            createdAt: input.occurredAt,
            createdBy: input.actorId,
            subjectHash: input.renderHash,
            contentHash: input.reportHash
          },
          [input.renderEvidence]
        )
        evidenceToCommit.push(input.renderEvidence, input.qaEvidence)
      } else if (input.type === 'artifact-accepted') {
        if (revision.status !== 'render-approved' || !revision.renderHash) {
          fail('LIFECYCLE', 'Acceptance requires independently approved render QA.')
        }
        this.assertEvidence(input.evidence, {
          kind: 'acceptance',
          artifactId: input.artifactId,
          revision: input.revision,
          createdAt: input.occurredAt,
          createdBy: input.actorId,
          subjectHash: revision.renderHash,
          contentHash: input.acceptanceHash
        })
        evidenceToCommit.push(input.evidence)
      } else if (input.type === 'revision-exhausted') {
        if (revision.status !== 'prompt-approved' || !revision.promptHash) {
          fail('LIFECYCLE', 'Revision exhaustion is valid only after approved prompt QA.')
        }
        if (!this.scheduler) {
          fail('RECEIPT', 'Revision exhaustion requires the authoritative scheduler.')
        }
        const call = this.scheduler.requireExhaustedFailure(input.schedulerCallId)
        if (
          call.artifactId !== input.artifactId ||
          call.revision !== input.revision ||
          call.promptHash !== revision.promptHash ||
          call.promptApprovalHash !== revision.promptApprovalEventHash ||
          call.approvalLedgerRootHash !== revision.promptApprovalLedgerRootHash ||
          call.approvalLedgerSequence !== revision.promptApprovalSequence ||
          call.approvalPlanHash !== this.plan.planHash ||
          call.callHash !== input.schedulerCallHash ||
          input.schedulerAuthorityId !== this.scheduler.authorityId ||
          call.completionAuthorityVersion !== input.schedulerAuthorityVersion ||
          call.completionAuthorityRootHash !== input.schedulerAuthorityRootHash ||
          call.completionAuthorityCommitHash !== input.schedulerAuthorityCommitHash ||
          call.failureReason !== input.failureReason ||
          !revision.promptApprovedAt ||
          compareIso(call.reservedAt, revision.promptApprovedAt) <= 0 ||
          !call.completedAt ||
          compareIso(input.occurredAt, call.completedAt) < 0
        ) {
          fail('RECEIPT', 'Revision exhaustion does not match the final scheduler failure.')
        }
        this.assertEvidence(input.evidence, {
          kind: 'exhaustion',
          artifactId: input.artifactId,
          revision: input.revision,
          createdAt: input.occurredAt,
          createdBy: input.actorId,
          subjectHash: input.schedulerCallHash,
          contentHash: input.exhaustionHash
        })
        evidenceToCommit.push(input.evidence)
      }
    }

    const withoutHash = {
      sequence: this.eventLog.length + 1,
      ...input,
      principalAttestation,
      previousEventHash: this.lastEventHash
    } as Omit<ArtifactEvent, 'eventHash'>
    const event = deepFreeze({
      ...withoutHash,
      eventHash: computeArtifactEventHash(withoutHash)
    }) as ArtifactEvent
    const eventBytes = utf8ByteLength(canonicalStringify(event))
    if (
      eventBytes > MAX_SERIALIZED_BYTES_PER_ARTIFACT_REVISION ||
      (revisionForRoot !== undefined &&
        revisionForRoot.serializedBytes + eventBytes >
          MAX_SERIALIZED_BYTES_PER_ARTIFACT_REVISION)
    ) {
      fail(
        'CARDINALITY',
        `Artifact revision exceeds ${MAX_SERIALIZED_BYTES_PER_ARTIFACT_REVISION} serialized bytes.`
      )
    }
    let nextAcceptedArtifactCount = this.acceptedCurrentCount
    if (input.type === 'artifact-accepted') {
      nextAcceptedArtifactCount += 1
    } else if (input.type === 'artifact-revision-superseded') {
      const history = this.artifacts.get(input.artifactId)!
      const prior = history.revisions[history.revisions.length - 1]
      if (prior.status === 'accepted') nextAcceptedArtifactCount -= 1
    }
    const nextLedgerRootHash = this.publishAppend(
      event,
      nextAcceptedArtifactCount
    )

    if (input.type === 'artifact-revision-started') {
      const revision: MutableRevisionState = {
        revision: 1,
        status: 'started',
        specificationHash: input.specificationHash,
        rootHash: nextRevisionRoot(ZERO_HASH, event.eventHash),
        serializedBytes: eventBytes
      }
      this.artifacts.set(input.artifactId, {
        artifactId: input.artifactId,
        revisions: [revision]
      })
    } else if (input.type === 'artifact-revision-superseded') {
      const history = this.artifacts.get(input.artifactId)!
      const prior = history.revisions[history.revisions.length - 1]
      if (prior.status === 'accepted') this.acceptedCurrentCount -= 1
      history.revisions.push({
        revision: input.revision,
        status: 'started',
        specificationHash: input.specificationHash,
        rootHash: nextRevisionRoot(ZERO_HASH, event.eventHash),
        serializedBytes: eventBytes
      })
    } else {
      const revision = revisionForRoot!
      revision.serializedBytes += eventBytes
      revision.rootHash = nextRevisionRoot(revision.rootHash, event.eventHash)
      if (input.type === 'research-recorded') {
        revision.status = 'researched'
        revision.researchHash = input.researchHash
        revision.researchAuthor = input.actorId
      } else if (input.type === 'prompt-drafted') {
        revision.status = 'prompt-drafted'
        revision.promptHash = input.promptHash
        revision.promptAuthor = input.actorId
      } else if (input.type === 'prompt-qa-reviewed') {
        revision.promptQaReportHash = input.reportHash
        revision.promptReviewer = input.actorId
        revision.status = input.verdict === 'approved' ? 'prompt-approved' : 'rejected'
        if (input.verdict === 'approved') {
          revision.promptApprovedAt = input.occurredAt
          revision.promptApprovalEventHash = event.eventHash
          revision.promptApprovalSequence = event.sequence
          revision.promptApprovalLedgerRootHash = nextLedgerRootHash
        }
      } else if (input.type === 'image-generation-recorded') {
        revision.status = 'image-generated'
        revision.generationAttempt = input.attempt
        revision.requestHash = input.requestHash
        revision.imageHash = input.imageHash
        revision.imageGenerator = input.actorId
        revision.schedulerCallId = input.schedulerCallId
        revision.schedulerReceiptHash = input.schedulerReceiptHash
      } else if (input.type === 'image-qa-reviewed') {
        revision.imageQaReportHash = input.reportHash
        revision.imageReviewer = input.actorId
        revision.status = input.verdict === 'approved' ? 'image-approved' : 'rejected'
      } else if (input.type === 'implementation-recorded') {
        revision.status = 'implemented'
        revision.implementationHash = input.implementationHash
        revision.implementer = input.actorId
      } else if (input.type === 'render-qa-reviewed') {
        revision.renderHash = input.renderHash
        revision.renderQaReportHash = input.reportHash
        revision.renderReviewer = input.actorId
        revision.status = input.verdict === 'approved' ? 'render-approved' : 'rejected'
      } else if (input.type === 'artifact-accepted') {
        revision.status = 'accepted'
        revision.acceptanceHash = input.acceptanceHash
        this.acceptedCurrentCount += 1
        this.hasAcceptedHistory = true
      } else if (input.type === 'revision-exhausted') {
        revision.status = 'exhausted'
      }
    }

    for (const evidence of evidenceToCommit) this.commitEvidence(evidence)
    this.eventLog.push(event)
    this.serializedEventBytes += eventBytes
    this.lastTimestamp = event.occurredAt
    this.lastEventHash = event.eventHash
    this.cachedLocalRootHash = nextLedgerRootHash
    return event
  }

  getArtifact(artifactIdValue: unknown): ArtifactHistorySnapshot | undefined {
    this.synchronizeAuthoritativePublication()
    const artifactId = parseArtifactId(artifactIdValue).id
    const history = this.artifacts.get(artifactId)
    if (!history) return undefined
    const revisions: ArtifactRevisionSnapshot[] = history.revisions.map((revision) => ({
      revision: revision.revision,
      status: revision.status,
      specificationHash: revision.specificationHash,
      rootHash: revision.rootHash,
      ...(revision.researchHash === undefined ? {} : { researchHash: revision.researchHash }),
      ...(revision.promptHash === undefined ? {} : { promptHash: revision.promptHash }),
      ...(revision.promptQaReportHash === undefined
        ? {}
        : { promptQaReportHash: revision.promptQaReportHash }),
      ...(revision.promptApprovedAt === undefined
        ? {}
        : { promptApprovedAt: revision.promptApprovedAt }),
      ...(revision.promptApprovalEventHash === undefined
        ? {}
        : { promptApprovalEventHash: revision.promptApprovalEventHash }),
      ...(revision.promptApprovalLedgerRootHash === undefined
        ? {}
        : { promptApprovalLedgerRootHash: revision.promptApprovalLedgerRootHash }),
      ...(revision.promptApprovalSequence === undefined
        ? {}
        : { promptApprovalSequence: revision.promptApprovalSequence }),
      ...(revision.generationAttempt === undefined
        ? {}
        : { generationAttempt: revision.generationAttempt }),
      ...(revision.requestHash === undefined ? {} : { requestHash: revision.requestHash }),
      ...(revision.imageHash === undefined ? {} : { imageHash: revision.imageHash }),
      ...(revision.schedulerCallId === undefined
        ? {}
        : { schedulerCallId: revision.schedulerCallId }),
      ...(revision.schedulerReceiptHash === undefined
        ? {}
        : { schedulerReceiptHash: revision.schedulerReceiptHash }),
      ...(revision.imageQaReportHash === undefined
        ? {}
        : { imageQaReportHash: revision.imageQaReportHash }),
      ...(revision.implementationHash === undefined
        ? {}
        : { implementationHash: revision.implementationHash }),
      ...(revision.renderHash === undefined ? {} : { renderHash: revision.renderHash }),
      ...(revision.renderQaReportHash === undefined
        ? {}
        : { renderQaReportHash: revision.renderQaReportHash }),
      ...(revision.acceptanceHash === undefined
        ? {}
        : { acceptanceHash: revision.acceptanceHash })
    }))
    return deepFreeze(
      cloneCanonical({
        artifactId: history.artifactId,
        revisions
      })
    )
  }

  events(): readonly ArtifactEvent[] {
    this.synchronizeAuthoritativePublication()
    return deepFreeze(cloneCanonical(this.eventLog))
  }

  promptApprovalCheckpointBinding(artifactIdValue: unknown): PromptApprovalCheckpointBinding {
    this.synchronizeAuthoritativePublication()
    const artifactId = parseArtifactId(artifactIdValue).id
    const history = this.artifacts.get(artifactId)
    const revision = history?.revisions[history.revisions.length - 1]
    if (
      !revision ||
      revision.status !== 'prompt-approved' ||
      !revision.promptHash ||
      !revision.promptApprovedAt ||
      !revision.promptApprovalEventHash ||
      !revision.promptApprovalLedgerRootHash ||
      revision.promptApprovalSequence === undefined
    ) {
      fail('TRUST', 'A committed approved prompt is required before issuing a scheduler checkpoint.')
    }
    return deepFreeze({
      ledgerRootHash: revision.promptApprovalLedgerRootHash,
      ledgerSequence: revision.promptApprovalSequence,
      promptApprovedAt: revision.promptApprovedAt,
      planHash: this.plan.planHash,
      artifactId,
      revision: revision.revision,
      promptHash: revision.promptHash,
      promptApprovalEventHash: revision.promptApprovalEventHash
    })
  }

  createCheckpoint(): LedgerCheckpoint {
    this.synchronizeAuthoritativePublication()
    return deepFreeze({
      schemaVersion: VISUAL_ARTIFACT_LEDGER_VERSION,
      sequence: this.eventLog.length,
      eventHash: this.lastEventHash,
      rootHash: this.localRootHash(),
      planHash: this.plan.planHash,
      registryHash: this.plan.registryHash
    })
  }

  private verifyCheckpoint(checkpointValue: unknown, requireCurrent: boolean): LedgerCheckpoint {
    const checkpoint = checkpointFromUnknown(checkpointValue)
    if (
      checkpoint.planHash !== this.plan.planHash ||
      checkpoint.registryHash !== this.plan.registryHash
    ) {
      fail('TRUST', 'Trusted checkpoint plan or registry hash does not match this ledger.')
    }
    if (checkpoint.sequence > this.eventLog.length) {
      fail('TRUST', 'Trusted checkpoint is beyond ledger history.')
    }
    const eventHash =
      checkpoint.sequence === 0 ? ZERO_HASH : this.eventLog[checkpoint.sequence - 1].eventHash
    const rootHash = computeVisualArtifactLedgerRootHash(
      this.plan.planHash,
      checkpoint.sequence,
      eventHash
    )
    if (checkpoint.eventHash !== eventHash || checkpoint.rootHash !== rootHash) {
      fail('TRUST', 'Trusted checkpoint does not match the ledger prefix.')
    }
    if (requireCurrent && checkpoint.sequence !== this.eventLog.length) {
      fail('TRUST', 'Trusted checkpoint must cover the entire accepted ledger.')
    }
    return checkpoint
  }

  private assertCompleteAcceptedPlan(): void {
    if (this.plan.counts.total !== APPROVED_EXACT_ARTIFACT_COUNT) {
      fail(
        'FINALIZATION',
        `Finalization requires the approved exact ${APPROVED_EXACT_ARTIFACT_COUNT}-artifact contract.`
      )
    }
    if (this.artifacts.size === 0) fail('FINALIZATION', 'Empty ledgers cannot be finalized.')
    if (
      this.artifacts.size !== this.expectedIds.length ||
      this.acceptedCurrentCount !== this.expectedIds.length
    ) {
      fail(
        'FINALIZATION',
        `Ledger is incomplete: ${this.acceptedCurrentCount}/${this.expectedIds.length} artifacts are accepted.`
      )
    }
    for (const artifactId of this.expectedIds) {
      const history = this.artifacts.get(artifactId)
      const current = history?.revisions[history.revisions.length - 1]
      if (!current || current.status !== 'accepted') {
        fail('FINALIZATION', `Expected artifact "${artifactId}" is not accepted.`)
      }
    }
  }

  private appendFinalization(
    value: NormalizedLedgerFinalizationInput,
    principalAttestation: OpaqueAttestation,
    skipFullReplay: boolean,
    replayOperation?: LedgerFinalizationOperation,
    replayCommit?: LedgerFinalizationAuthorityCommit
  ): LedgerFinalizedEvent {
    if (replayOperation) {
      if (this.finalized) {
        fail('FINALIZATION', 'A finalized visual artifact ledger is immutable.')
      }
      if (this.eventLog.length >= MAX_LEDGER_EVENTS) {
        fail('CARDINALITY', `Ledger event limit ${MAX_LEDGER_EVENTS} reached.`)
      }
    } else {
      this.assertWritable()
    }
    const occurredAt = value.occurredAt
    this.assertTimestamp(occurredAt)
    const actorId = value.actorId
    if (value.planHash !== this.plan.planHash || value.registryHash !== this.plan.registryHash) {
      fail('FINALIZATION', 'Finalization planHash or registryHash is not exact.')
    }
    const checkpoint = this.verifyCheckpoint(value.trustedCheckpoint, true)
    invokeSynchronousVerifier(
      this.dependencies.verifyRoot,
      this.dependencies.rootVerifier,
      [value.trustedCheckpointAttestation, {
        domain: 'visual-artifact-ledger',
        purpose: 'finalization-checkpoint',
        rootHash: checkpoint.rootHash,
        version: checkpoint.sequence,
        contextHash: this.plan.planHash
      }],
      'Finalization checkpoint root verifier'
    )
    const principalBinding = this.finalizationPrincipalBinding(value)
    invokeSynchronousVerifier(
      this.dependencies.verifyPrincipal,
      this.dependencies.principalVerifier,
      [principalAttestation, principalBinding],
      'Finalization principal verifier'
    )
    if (!skipFullReplay) {
      const replayed = replayLedgerEvents(
        this.plan,
        this.eventLog,
        this.externalDependencies()
      )
      replayed.assertCompleteAcceptedPlan()
    }
    this.assertCompleteAcceptedPlan()

    const operationWithoutHash = {
      authorityId: this.dependencies.finalizationAuthorityId,
      expectedLedgerSequence: this.eventLog.length,
      expectedLedgerRootHash: this.localRootHash(),
      planHash: this.plan.planHash,
      registryHash: this.plan.registryHash,
      artifactCount: this.expectedIds.length,
      artifactSetHash: expectedArtifactSetHash(this.plan),
      occurredAt,
      actorId,
      trustedCheckpointSequence: checkpoint.sequence,
      trustedCheckpointEventHash: checkpoint.eventHash,
      trustedCheckpointRootHash: checkpoint.rootHash,
      trustedCheckpointAttestation: value.trustedCheckpointAttestation,
      principalAttestation
    }
    const expectedOperation = deepFreeze({
      ...operationWithoutHash,
      operationHash:
        computeLedgerFinalizationOperationHash(operationWithoutHash)
    })
    const operation = replayOperation
      ? normalizeLedgerFinalizationOperation(replayOperation)
      : expectedOperation
    if (
      canonicalStringify(operation) !== canonicalStringify(expectedOperation)
    ) {
      fail('CAS', 'Ledger finalization operation does not match the local certified head.')
    }
    let authorityCommit: LedgerFinalizationAuthorityCommit
    if (replayCommit) {
      authorityCommit = normalizeLedgerFinalizationCommit(replayCommit)
    } else {
      try {
        authorityCommit = normalizeLedgerFinalizationCommit(
          Reflect.apply(
            this.dependencies.finalizationCommit,
            this.dependencies.finalizationAuthority,
            [operation]
          )
        )
      } catch (error) {
        const recovered = Reflect.apply(
          this.dependencies.finalizationRecover,
          this.dependencies.finalizationAuthority,
          [operation]
        ) as LedgerFinalizationAuthorityCommit | undefined
        if (!recovered) {
          const message = error instanceof Error ? error.message : String(error)
          fail('CAS', `Ledger finalization authority rejected atomic commit: ${message}`)
        }
        authorityCommit = normalizeLedgerFinalizationCommit(recovered)
      }
    }
    if (
      authorityCommit.authorityId !==
        this.dependencies.finalizationAuthorityId ||
      authorityCommit.version !== 1 ||
      authorityCommit.committedAt !== occurredAt ||
      authorityCommit.operationHash !== operation.operationHash
    ) {
      fail('TRUST', 'Ledger finalization authority returned an invalid commit.')
    }
    invokeSynchronousVerifier(
      this.dependencies.verifyFinalizationCommit,
      this.dependencies.finalizationAuthority,
      [authorityCommit, operation],
      'Ledger finalization authority commit verifier'
    )
    const authoritative = this.currentFinalizationRecord()
    if (
      !authoritative ||
      authoritative.operation.operationHash !== operation.operationHash ||
      canonicalStringify(authoritative.commit) !==
        canonicalStringify(authorityCommit)
    ) {
      fail('CAS', 'Ledger finalization authority did not durably publish the committed head.')
    }

    const input = {
      sequence: this.eventLog.length + 1,
      type: 'ledger-finalized' as const,
      occurredAt,
      actorId,
      principalAttestation,
      planHash: this.plan.planHash,
      registryHash: this.plan.registryHash,
      artifactCount: this.expectedIds.length,
      artifactSetHash: operation.artifactSetHash,
      trustedCheckpointSequence: checkpoint.sequence,
      trustedCheckpointRootHash: checkpoint.rootHash,
      trustedCheckpointAttestation: value.trustedCheckpointAttestation,
      finalizationAuthorityId: authorityCommit.authorityId,
      finalizationAuthorityVersion: authorityCommit.version,
      finalizationAuthorityPreviousRootHash:
        authorityCommit.previousRootHash,
      finalizationAuthorityRootHash: authorityCommit.rootHash,
      finalizationAuthorityOperationHash: authorityCommit.operationHash,
      finalizationAuthorityAttestation: authorityCommit.attestation,
      previousEventHash: this.lastEventHash
    }
    const event = deepFreeze({
      ...input,
      eventHash: computeArtifactEventHash(input)
    }) as LedgerFinalizedEvent
    const eventBytes = utf8ByteLength(canonicalStringify(event))
    this.eventLog.push(event)
    this.serializedEventBytes += eventBytes
    this.lastTimestamp = occurredAt
    this.lastEventHash = event.eventHash
    this.cachedLocalRootHash = undefined
    this.finalized = true
    this.finalizationEvent = event
    return event
  }

  private finalizationPrincipalBinding(
    value: NormalizedLedgerFinalizationInput
  ): AuthenticatedPrincipalBinding {
    return deepFreeze({
      domain: 'visual-artifact-ledger',
      principalId: value.actorId,
      role: 'release-owner',
      action: 'ledger-finalized',
      actionHash: sha256Hex({
        domain: 'visual-artifact-principal-action-v1',
        event: {
          type: 'ledger-finalized',
          occurredAt: value.occurredAt,
          actorId: value.actorId,
          planHash: value.planHash,
          registryHash: value.registryHash,
          trustedCheckpoint: value.trustedCheckpoint,
          trustedCheckpointAttestation:
            value.trustedCheckpointAttestation
        }
      }),
      contextRootHash: this.localRootHash(),
      contextVersion: this.eventLog.length
    })
  }

  finalizationPrincipalBindingFor(value: unknown): AuthenticatedPrincipalBinding {
    this.synchronizeAuthoritativePublication()
    return this.finalizationPrincipalBinding(
      normalizeLedgerFinalizationInput(value)
    )
  }

  finalize(value: unknown, principalAttestationValue: unknown): LedgerFinalizedEvent {
    const normalized = normalizeLedgerFinalizationInput(value)
    const principalAttestation = parseOpaqueAttestation(
      principalAttestationValue,
      'Finalization principal attestation'
    )
    return this.appendFinalization(
      normalized,
      principalAttestation,
      false
    )
  }

  verifyRootAttestation(attestationValue: unknown): void {
    const attestation = parseOpaqueAttestation(attestationValue, 'Ledger root attestation')
    this.verifyRootAttestationSnapshot(attestation)
  }

  private verifyRootAttestationSnapshot(
    attestation: OpaqueAttestation,
    synchronize = true
  ): void {
    if (synchronize) this.synchronizeAuthoritativePublication()
    invokeSynchronousVerifier(
      this.dependencies.verifyRoot,
      this.dependencies.rootVerifier,
      [attestation, {
        domain: 'visual-artifact-ledger',
        purpose: 'envelope',
        rootHash: this.localRootHash(),
        version: this.eventLog.length,
        contextHash: this.plan.planHash
      }],
      'Ledger envelope root verifier'
    )
  }

  serialize(optionsValue: unknown): string {
    assertPlainObject(optionsValue, 'Ledger serialization options')
    assertExactKeys(optionsValue, ['rootAttestation'], 'Ledger serialization options')
    const rootAttestation = parseOpaqueAttestation(
      optionsValue.rootAttestation,
      'Ledger root attestation'
    )
    this.verifyRootAttestationSnapshot(rootAttestation)
    const planBytes = utf8ByteLength(canonicalStringify(this.plan))
    const estimatedCharacters =
      planBytes +
      this.serializedEventBytes +
      Math.max(0, this.eventLog.length - 1) +
      MAX_SERIALIZED_ENVELOPE_FRAMING_BYTES
    assertSerializedLengthsWithinRuntimeCeiling(
      estimatedCharacters,
      estimatedCharacters,
      'Serialized visual artifact ledger'
    )
    return canonicalStringify({
      schemaVersion: VISUAL_ARTIFACT_LEDGER_VERSION,
      plan: cloneCanonical(this.plan),
      rootAttestation,
      events: this.events()
    })
  }
}

function storedEventToInput(
  value: unknown,
  sequence: number,
  previousHash: string
): { input: ArtifactEventInput; principalAttestation: OpaqueAttestation } {
  assertPlainObject(value, `Artifact event ${sequence}`)
  if (value.sequence !== sequence) fail('INTEGRITY', 'Artifact event sequence is not contiguous.')
  const prior = assertSha256(value.previousEventHash, `Artifact event ${sequence} previousEventHash`)
  if (prior !== previousHash) fail('INTEGRITY', 'Artifact previous-event hash chain is broken.')
  assertSha256(value.eventHash, `Artifact event ${sequence} eventHash`)
  const type = value.type
  if (typeof type !== 'string') fail('SCHEMA', `Artifact event ${sequence} type is invalid.`)

  const eventKeysByType: Record<string, readonly string[]> = {
    'artifact-revision-started': [...REVISION_EVENT_KEYS, 'specificationHash', 'planHash'],
    'artifact-revision-superseded': [
      ...REVISION_EVENT_KEYS,
      'priorRevision',
      'priorRevisionRootHash',
      'specificationHash',
      'planHash'
    ],
    'research-recorded': [...REVISION_EVENT_KEYS, 'researchHash', 'evidence'],
    'prompt-drafted': [...REVISION_EVENT_KEYS, 'promptHash', 'evidence'],
    'prompt-qa-reviewed': [
      ...REVISION_EVENT_KEYS,
      'promptHash',
      'verdict',
      'reportHash',
      'evidence'
    ],
    'image-generation-recorded': [
      ...REVISION_EVENT_KEYS,
      'attempt',
      'promptHash',
      'promptApprovalHash',
      'requestHash',
      'imageHash',
      'idempotencyKey',
      'policyHash',
      'schedulerCallId',
      'schedulerCallHash',
      'schedulerReceiptHash',
      'schedulerAuthorityId',
      'schedulerAuthorityVersion',
      'schedulerAuthorityRootHash',
      'schedulerAuthorityCommitHash',
      'evidence'
    ],
    'image-qa-reviewed': [
      ...REVISION_EVENT_KEYS,
      'imageHash',
      'verdict',
      'reportHash',
      'evidence'
    ],
    'implementation-recorded': [...REVISION_EVENT_KEYS, 'implementationHash', 'evidence'],
    'render-qa-reviewed': [
      ...REVISION_EVENT_KEYS,
      'renderHash',
      'verdict',
      'reportHash',
      'renderEvidence',
      'qaEvidence'
    ],
    'artifact-accepted': [...REVISION_EVENT_KEYS, 'acceptanceHash', 'evidence'],
    'revision-exhausted': [
      ...REVISION_EVENT_KEYS,
      'schedulerCallId',
      'schedulerCallHash',
      'schedulerAuthorityId',
      'schedulerAuthorityVersion',
      'schedulerAuthorityRootHash',
      'schedulerAuthorityCommitHash',
      'failureReason',
      'exhaustionHash',
      'evidence'
    ]
  }
  const keys = eventKeysByType[type]
  if (!keys) fail('SCHEMA', `Artifact event ${sequence} has unsupported type "${type}".`)
  assertExactKeys(value, keys, `Artifact event ${sequence}`)
  const input: Record<string, unknown> = {}
  for (const key of keys) {
    if (!EVENT_HEADER_KEYS.includes(key as (typeof EVENT_HEADER_KEYS)[number])) input[key] = value[key]
  }
  input.type = type
  input.occurredAt = value.occurredAt
  input.actorId = value.actorId
  return {
    input: normalizeInput(input),
    principalAttestation: parseOpaqueAttestation(
      value.principalAttestation,
      `Artifact event ${sequence} principalAttestation`
    )
  }
}

function replayLedgerEvents(
  plan: ArtifactPlan,
  events: readonly ArtifactEvent[],
  dependencies: VisualArtifactLedgerDependencies
): VisualArtifactLedger {
  if (events.length > MAX_LEDGER_EVENTS) {
    fail('CARDINALITY', `Ledger history exceeds ${MAX_LEDGER_EVENTS} events.`)
  }
  const ledger = VisualArtifactLedger.create(plan, dependencies)
  const replayControl = ledger as unknown as {
    authoritativeSynchronizationSuppressed: boolean
  }
  replayControl.authoritativeSynchronizationSuppressed = true
  let previousHash = ZERO_HASH
  try {
    for (let index = 0; index < events.length; index += 1) {
      const stored = events[index]
      if (
        typeof stored === 'object' &&
        stored !== null &&
        !Array.isArray(stored) &&
        (stored as { type?: unknown }).type === 'ledger-finalized'
      ) {
        fail('FINALIZATION', 'Finalization must be the unique last event.')
      }
      const storedInput = storedEventToInput(stored, index + 1, previousHash)
      const generated = ledger.append(
        storedInput.input,
        storedInput.principalAttestation
      )
      if (canonicalStringify(stored) !== canonicalStringify(generated)) {
        fail(
          'INTEGRITY',
          `Artifact event ${index + 1} hash or derived content does not match replay.`
        )
      }
      previousHash = generated.eventHash
    }
  } finally {
    replayControl.authoritativeSynchronizationSuppressed = false
  }
  return ledger
}

function appendStoredFinalization(
  ledger: VisualArtifactLedger,
  value: unknown,
  sequence: number,
  previousHash: string
): void {
  assertPlainObject(value, `Artifact event ${sequence}`)
  assertExactKeys(
    value,
    [
      ...EVENT_HEADER_KEYS,
      'planHash',
      'registryHash',
      'artifactCount',
      'artifactSetHash',
      'trustedCheckpointSequence',
      'trustedCheckpointRootHash',
      'trustedCheckpointAttestation',
      'finalizationAuthorityId',
      'finalizationAuthorityVersion',
      'finalizationAuthorityPreviousRootHash',
      'finalizationAuthorityRootHash',
      'finalizationAuthorityOperationHash',
      'finalizationAuthorityAttestation'
    ],
    `Artifact event ${sequence}`
  )
  if (value.sequence !== sequence || value.type !== 'ledger-finalized') {
    fail('INTEGRITY', 'Finalization event sequence or type is invalid.')
  }
  if (value.previousEventHash !== previousHash) fail('INTEGRITY', 'Finalization hash chain is broken.')
  if (value.planHash !== ledger.plan.planHash || value.registryHash !== ledger.plan.registryHash) {
    fail('FINALIZATION', 'Stored finalization plan or registry hash is incorrect.')
  }
  if (
    value.artifactCount !== expectedArtifactIds(ledger.plan).length ||
    value.artifactSetHash !== expectedArtifactSetHash(ledger.plan)
  ) {
    fail('FINALIZATION', 'Stored finalization does not bind the exact expected artifact IDs.')
  }
  const checkpoint: LedgerCheckpoint = {
    schemaVersion: VISUAL_ARTIFACT_LEDGER_VERSION,
    sequence: assertSafeInteger(
      value.trustedCheckpointSequence,
      'Finalization trustedCheckpointSequence',
      0,
      MAX_LEDGER_EVENTS
    ),
    eventHash: previousHash,
    rootHash: assertSha256(value.trustedCheckpointRootHash, 'Finalization trustedCheckpointRootHash'),
    planHash: ledger.plan.planHash,
    registryHash: ledger.plan.registryHash
  }
  const checkpointAttestation = parseOpaqueAttestation(
    value.trustedCheckpointAttestation,
    'Stored finalization checkpoint attestation'
  )
  const principalAttestation = parseOpaqueAttestation(
    value.principalAttestation,
    'Stored finalization principal attestation'
  )
  const operation = normalizeLedgerFinalizationOperation({
    authorityId: value.finalizationAuthorityId,
    expectedLedgerSequence: sequence - 1,
    expectedLedgerRootHash: checkpoint.rootHash,
    planHash: ledger.plan.planHash,
    registryHash: ledger.plan.registryHash,
    artifactCount: value.artifactCount,
    artifactSetHash: value.artifactSetHash,
    occurredAt: value.occurredAt,
    actorId: value.actorId,
    trustedCheckpointSequence: checkpoint.sequence,
    trustedCheckpointEventHash: checkpoint.eventHash,
    trustedCheckpointRootHash: checkpoint.rootHash,
    trustedCheckpointAttestation: checkpointAttestation,
    principalAttestation,
    operationHash: value.finalizationAuthorityOperationHash
  })
  const commit = normalizeLedgerFinalizationCommit({
    authorityId: value.finalizationAuthorityId,
    version: value.finalizationAuthorityVersion,
    committedAt: value.occurredAt,
    previousRootHash: value.finalizationAuthorityPreviousRootHash,
    rootHash: value.finalizationAuthorityRootHash,
    operationHash: value.finalizationAuthorityOperationHash,
    attestation: value.finalizationAuthorityAttestation
  })
  const generated = (
    ledger as unknown as {
      appendFinalization(
        input: {
          occurredAt: string
          actorId: string
          planHash: string
          registryHash: string
          trustedCheckpoint: LedgerCheckpoint
          trustedCheckpointAttestation: OpaqueAttestation
        },
        principalAttestation: OpaqueAttestation,
        skipFullReplay: boolean,
        replayOperation: LedgerFinalizationOperation,
        replayCommit: LedgerFinalizationAuthorityCommit
      ): LedgerFinalizedEvent
    }
  ).appendFinalization(
    {
      occurredAt: assertIsoTimestamp(value.occurredAt, 'Stored finalization occurredAt'),
      actorId: assertIdentifier(value.actorId, 'Stored finalization actorId'),
      planHash: ledger.plan.planHash,
      registryHash: ledger.plan.registryHash,
      trustedCheckpoint: checkpoint,
      trustedCheckpointAttestation: checkpointAttestation
    },
    principalAttestation,
    true,
    operation,
    commit
  )
  if (canonicalStringify(value) !== canonicalStringify(generated)) {
    fail('INTEGRITY', 'Stored finalization hash or derived content does not match replay.')
  }
}

export function parseVisualArtifactLedger(
  serialized: string,
  optionsValue: unknown
): VisualArtifactLedger {
  assertSerializedTextWithinRuntimeCeiling(serialized, 'Serialized visual artifact ledger')
  let parsed: unknown
  try {
    parsed = parseJson(serialized)
  } catch {
    fail('SCHEMA', 'Serialized visual artifact ledger is not valid JSON.')
  }
  if (canonicalStringify(parsed) !== serialized) {
    fail('SCHEMA', 'Ledger JSON must be byte-for-byte canonical and contain no duplicate keys.')
  }
  assertPlainObject(optionsValue, 'Ledger parse options')
  assertExactKeys(
    optionsValue,
    ['dependencies'],
    'Ledger parse options'
  )
  const dependencies = assertLedgerDependencies(
    optionsValue.dependencies as VisualArtifactLedgerDependencies
  )
  assertPlainObject(parsed, 'Serialized visual artifact ledger')
  assertExactKeys(
    parsed,
    ['schemaVersion', 'plan', 'rootAttestation', 'events'],
    'Serialized visual artifact ledger'
  )
  if (parsed.schemaVersion !== VISUAL_ARTIFACT_LEDGER_VERSION) {
    fail('SCHEMA', `Ledger schemaVersion must be ${VISUAL_ARTIFACT_LEDGER_VERSION}.`)
  }
  const plan = parseArtifactPlan(parsed.plan)
  if (!Array.isArray(parsed.events)) fail('SCHEMA', 'Ledger history must be an array.')
  if (parsed.events.length > MAX_LEDGER_EVENTS) {
    fail('CARDINALITY', `Ledger history exceeds ${MAX_LEDGER_EVENTS} events.`)
  }
  let finalization: unknown
  let artifactEvents = parsed.events
  const finalIndex = parsed.events.findIndex(
    (event) =>
      typeof event === 'object' &&
      event !== null &&
      !Array.isArray(event) &&
      (event as Record<string, unknown>).type === 'ledger-finalized'
  )
  if (finalIndex >= 0) {
    if (finalIndex !== parsed.events.length - 1) {
      fail('FINALIZATION', 'Ledger finalization must be the unique last event.')
    }
    finalization = parsed.events[finalIndex]
    artifactEvents = parsed.events.slice(0, finalIndex)
  }
  const ledger = replayLedgerEvents(
    plan,
    artifactEvents as ArtifactEvent[],
    externalLedgerDependencies(dependencies)
  )
  if (finalization !== undefined) {
    const previousHash =
      artifactEvents.length === 0
        ? ZERO_HASH
        : assertSha256(
            (artifactEvents[artifactEvents.length - 1] as ArtifactEvent)
              .eventHash,
            'Stored pre-finalization eventHash'
          )
    appendStoredFinalization(
      ledger,
      finalization,
      parsed.events.length,
      previousHash
    )
    ledger.verifyRootAttestation(parsed.rootAttestation)
  } else {
    const preFinalizationAttestation = parseOpaqueAttestation(
      parsed.rootAttestation,
      'Ledger root attestation'
    )
    ;(
      ledger as unknown as {
        verifyRootAttestationSnapshot(
          attestation: OpaqueAttestation,
          synchronize: boolean
        ): void
      }
    ).verifyRootAttestationSnapshot(preFinalizationAttestation, false)
    void ledger.rootHash
  }
  return ledger
}

export function serializeVisualArtifactLedger(
  ledger: VisualArtifactLedger,
  optionsValue: unknown
): string {
  if (!(ledger instanceof VisualArtifactLedger)) {
    fail('SCHEMA', 'Only a validated visual artifact ledger can be serialized.')
  }
  return ledger.serialize(optionsValue)
}
