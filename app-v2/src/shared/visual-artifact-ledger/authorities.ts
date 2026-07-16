import {
  assertExactKeys,
  assertPlainObject,
  assertString,
  deepFreeze
} from './canonical'
import { fail } from './errors'

export interface OpaqueAttestation {
  readonly token: string
}

export function parseOpaqueAttestation(value: unknown, label: string): OpaqueAttestation {
  assertPlainObject(value, label)
  assertExactKeys(value, ['token'], label)
  const token = assertString(value.token, `${label}.token`, 128)
  if (!/^[A-Za-z0-9._:-]+$/.test(token)) {
    fail('SCHEMA', `${label}.token must use bounded ASCII attestation encoding.`)
  }
  return deepFreeze({ token })
}

export type GovernanceRole =
  | 'planner'
  | 'researcher'
  | 'prompt-author'
  | 'prompt-reviewer'
  | 'image-generator'
  | 'image-reviewer'
  | 'implementer'
  | 'render-reviewer'
  | 'release-owner'
  | 'scheduler-control'
  | 'scheduler-worker'

export interface AuthenticatedPrincipalBinding {
  readonly domain: 'visual-artifact-ledger' | 'image-scheduler'
  readonly principalId: string
  readonly role: GovernanceRole
  readonly action: string
  readonly actionHash: string
  readonly contextRootHash: string
  readonly contextVersion: number
}

export interface AuthenticatedPrincipalVerifier {
  verifyPrincipal(
    attestation: OpaqueAttestation,
    binding: AuthenticatedPrincipalBinding
  ): boolean
}

export interface EvidenceAttestationBinding {
  readonly evidenceId: string
  readonly artifactId: string
  readonly revision: number
  readonly kind: string
  readonly createdAt: string
  readonly createdBy: string
  readonly subjectHash: string
  readonly contentHash: string
  readonly planHash: string
  readonly ledgerRootBefore: string
  readonly ledgerSequence: number
}

export interface EvidenceAttestationVerifier {
  verifyEvidence(
    attestation: OpaqueAttestation,
    binding: EvidenceAttestationBinding
  ): boolean
}

export interface RootAttestationBinding {
  readonly domain: 'visual-artifact-ledger' | 'image-scheduler'
  readonly purpose: 'envelope' | 'finalization-checkpoint'
  readonly rootHash: string
  readonly version: number
  readonly contextHash: string
}

export interface RootAttestationVerifier {
  verifyRoot(attestation: OpaqueAttestation, binding: RootAttestationBinding): boolean
}

export interface PromptApprovalCheckpointBinding {
  readonly ledgerRootHash: string
  readonly ledgerSequence: number
  readonly promptApprovedAt: string
  readonly planHash: string
  readonly artifactId: string
  readonly revision: number
  readonly promptHash: string
  readonly promptApprovalEventHash: string
}

export interface PromptApprovalCheckpoint extends PromptApprovalCheckpointBinding {
  readonly attestation: OpaqueAttestation
}

export interface PromptApprovalCheckpointVerifier {
  verifyPromptApprovalCheckpoint(
    attestation: OpaqueAttestation,
    binding: PromptApprovalCheckpointBinding
  ): boolean
}

export interface SchedulerServiceReceiptBinding {
  readonly authorityId: string
  readonly dispatchAuthorityRootHash: string
  readonly dispatchAuthorityVersion: number
  readonly callId: string
  readonly artifactId: string
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
}

export interface SchedulerServiceReceiptVerifier {
  verifyServiceReceipt(
    attestation: OpaqueAttestation,
    binding: SchedulerServiceReceiptBinding
  ): boolean
}

interface SchedulerAuthorityOperationBase {
  readonly expectedVersion: number
  readonly previousRootHash: string
  readonly policyHash: string
  readonly operationHash: string
  readonly principalId: string
  readonly principalRole: 'scheduler-control' | 'scheduler-worker'
  readonly principalAttestation: OpaqueAttestation
}

export interface SchedulerConfigureOperation extends SchedulerAuthorityOperationBase {
  readonly action: 'configure'
  readonly windowMs: number
  readonly requestLimit: number
}

export interface SchedulerReserveOperation extends SchedulerAuthorityOperationBase {
  readonly action: 'reserve'
  readonly windowMs: number
  readonly requestLimit: number
  readonly callId: string
  readonly artifactId: string
  readonly revision: number
  readonly attempt: number
  readonly notBefore: string | null
}

export interface SchedulerCallOperation extends SchedulerAuthorityOperationBase {
  readonly action: 'dispatch' | 'succeed' | 'ambiguous'
  readonly callId: string
}

export interface SchedulerFailOperation extends SchedulerAuthorityOperationBase {
  readonly action: 'fail'
  readonly callId: string
  readonly latestCommittedAt: string
}

export type SchedulerAuthorityOperation =
  | SchedulerConfigureOperation
  | SchedulerReserveOperation
  | SchedulerCallOperation
  | SchedulerFailOperation

export interface SchedulerAuthorityCommit {
  readonly authorityId: string
  readonly version: number
  readonly committedAt: string
  readonly previousRootHash: string
  readonly rootHash: string
  readonly operationHash: string
  readonly attestation: OpaqueAttestation
}

export interface SchedulerAuthority {
  readonly authorityId: string
  commit(operation: SchedulerAuthorityOperation): SchedulerAuthorityCommit
  recover(operation: SchedulerAuthorityOperation): SchedulerAuthorityCommit | undefined
  verifyCommit(
    commit: SchedulerAuthorityCommit,
    operation: SchedulerAuthorityOperation
  ): boolean
}

export interface LedgerAuthorityDependencies {
  readonly principalVerifier: AuthenticatedPrincipalVerifier
  readonly evidenceVerifier: EvidenceAttestationVerifier
  readonly rootVerifier: RootAttestationVerifier
}

export interface SchedulerAuthorityDependencies {
  readonly authority: SchedulerAuthority
  readonly principalVerifier: AuthenticatedPrincipalVerifier
  readonly approvalVerifier: PromptApprovalCheckpointVerifier
  readonly serviceReceiptVerifier: SchedulerServiceReceiptVerifier
  readonly rootVerifier: RootAttestationVerifier
}
