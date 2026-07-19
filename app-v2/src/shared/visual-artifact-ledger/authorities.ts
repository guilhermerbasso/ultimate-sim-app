import {
  assertExactKeys,
  assertPlainObject,
  assertString,
  deepFreeze,
  ownDataValue
} from './canonical'
import { fail } from './errors'
import { types as utilTypes } from 'node:util'

const INTRINSIC_PROMISE = Promise
const INTRINSIC_PROMISE_THEN = Promise.prototype.then
const INTRINSIC_APPLY = Reflect.apply
const INTRINSIC_FUNCTION_TO_STRING = Function.prototype.toString
const INTRINSIC_STRING_INCLUDES = String.prototype.includes
const INTRINSIC_DEFINE_PROPERTY = Object.defineProperty
const INTRINSIC_DELETE_PROPERTY = Reflect.deleteProperty
const INTRINSIC_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor
const INTRINSIC_GET_PROTOTYPE_OF = Object.getPrototypeOf
const INTRINSIC_IS_EXTENSIBLE = Object.isExtensible
const INTRINSIC_IS_ASYNC_FUNCTION = utilTypes.isAsyncFunction
const INTRINSIC_IS_PROMISE = utilTypes.isPromise
const INTRINSIC_SPECIES = Symbol.species
const SAFE_PROMISE_SPECIES = Object.freeze({
  [INTRINSIC_SPECIES]: INTRINSIC_PROMISE
})

export interface OpaqueAttestation {
  readonly token: string
}

export function parseOpaqueAttestation(value: unknown, label: string): OpaqueAttestation {
  assertPlainObject(value, label)
  assertExactKeys(value, ['token'], label)
  const token = assertString(
    ownDataValue(value, 'token', `${label}.token`),
    `${label}.token`,
    88
  )
  if (!/^[A-Za-z0-9._:-]+$/.test(token)) {
    fail('SCHEMA', `${label}.token must use bounded ASCII attestation encoding.`)
  }
  return deepFreeze({ token })
}

function inheritedPropertyDescriptor(
  value: object,
  key: PropertyKey
): { owner: object; descriptor: PropertyDescriptor } | undefined {
  let owner = INTRINSIC_GET_PROTOTYPE_OF(value)
  while (owner !== null) {
    const descriptor = INTRINSIC_GET_OWN_PROPERTY_DESCRIPTOR(owner, key)
    if (descriptor) return { owner, descriptor }
    owner = INTRINSIC_GET_PROTOTYPE_OF(owner)
  }
  return undefined
}

function observeRejectedNativePromise(value: object): void {
  const ownConstructor = INTRINSIC_GET_OWN_PROPERTY_DESCRIPTOR(value, 'constructor')
  let constructorOwner: object | undefined
  let constructorRestore: PropertyDescriptor | undefined
  let constructorDelete = false
  let constructorValue: unknown
  let speciesOwner: object | undefined
  let speciesRestore: PropertyDescriptor | undefined
  let speciesDelete = false

  try {
    if (ownConstructor?.configurable) {
      constructorOwner = value
      constructorRestore = ownConstructor
      INTRINSIC_DEFINE_PROPERTY(value, 'constructor', {
        configurable: true,
        value: SAFE_PROMISE_SPECIES
      })
      constructorValue = SAFE_PROMISE_SPECIES
    } else if (ownConstructor && 'value' in ownConstructor) {
      constructorValue = ownConstructor.value
    } else if (!ownConstructor) {
      const inherited = inheritedPropertyDescriptor(value, 'constructor')
      if (!inherited) {
        constructorValue = undefined
      } else if (INTRINSIC_IS_EXTENSIBLE(value)) {
        constructorOwner = value
        constructorDelete = true
        INTRINSIC_DEFINE_PROPERTY(value, 'constructor', {
          configurable: true,
          value: SAFE_PROMISE_SPECIES
        })
        constructorValue = SAFE_PROMISE_SPECIES
      } else if (inherited.descriptor.configurable) {
        constructorOwner = inherited.owner
        constructorRestore = inherited.descriptor
        INTRINSIC_DEFINE_PROPERTY(inherited.owner, 'constructor', {
          configurable: true,
          value: SAFE_PROMISE_SPECIES
        })
        constructorValue = SAFE_PROMISE_SPECIES
      } else if ('value' in inherited.descriptor) {
        constructorValue = inherited.descriptor.value
      } else {
        return
      }
    } else {
      return
    }

    if (
      constructorValue !== SAFE_PROMISE_SPECIES &&
      ((typeof constructorValue === 'object' && constructorValue !== null) ||
        typeof constructorValue === 'function')
    ) {
      const ownSpecies = INTRINSIC_GET_OWN_PROPERTY_DESCRIPTOR(
        constructorValue,
        INTRINSIC_SPECIES
      )
      const locatedSpecies = ownSpecies
        ? { owner: constructorValue, descriptor: ownSpecies }
        : inheritedPropertyDescriptor(constructorValue, INTRINSIC_SPECIES)
      if (locatedSpecies?.descriptor.configurable) {
        speciesOwner = locatedSpecies.owner
        speciesRestore = locatedSpecies.descriptor
        INTRINSIC_DEFINE_PROPERTY(locatedSpecies.owner, INTRINSIC_SPECIES, {
          configurable: true,
          value: INTRINSIC_PROMISE
        })
      } else if (!locatedSpecies && INTRINSIC_IS_EXTENSIBLE(constructorValue)) {
        speciesOwner = constructorValue
        speciesDelete = true
        INTRINSIC_DEFINE_PROPERTY(constructorValue, INTRINSIC_SPECIES, {
          configurable: true,
          value: INTRINSIC_PROMISE
        })
      }
    }

    void INTRINSIC_APPLY(INTRINSIC_PROMISE_THEN, value, [
      undefined,
      () => undefined
    ])
  } catch {
    // The verifier still fails closed below.
  } finally {
    if (speciesOwner && speciesRestore) {
      INTRINSIC_DEFINE_PROPERTY(speciesOwner, INTRINSIC_SPECIES, speciesRestore)
    } else if (speciesOwner && speciesDelete) {
      INTRINSIC_DELETE_PROPERTY(speciesOwner, INTRINSIC_SPECIES)
    }
    if (constructorOwner && constructorRestore) {
      INTRINSIC_DEFINE_PROPERTY(
        constructorOwner,
        'constructor',
        constructorRestore
      )
    } else if (constructorOwner && constructorDelete) {
      INTRINSIC_DELETE_PROPERTY(constructorOwner, 'constructor')
    }
  }
}

function assertSynchronousVerifierTrue(value: unknown, label: string): void {
  if (value !== true) {
    if (INTRINSIC_IS_PROMISE(value)) {
      observeRejectedNativePromise(value)
    }
    fail('TRUST', `${label} must synchronously return the primitive boolean true.`)
  }
}

export function invokeSynchronousVerifier(
  verifier: (...args: never[]) => unknown,
  thisArg: unknown,
  args: readonly unknown[],
  label: string
): void {
  const verifierSource =
    typeof verifier === 'function'
      ? INTRINSIC_APPLY(INTRINSIC_FUNCTION_TO_STRING, verifier, [])
      : ''
  if (
    typeof verifier !== 'function' ||
    INTRINSIC_IS_ASYNC_FUNCTION(verifier) ||
    INTRINSIC_APPLY(INTRINSIC_STRING_INCLUDES, verifierSource, [
      '[native code]'
    ])
  ) {
    fail('TRUST', `${label} must be a synchronous verifier function.`)
  }
  const result = INTRINSIC_APPLY(verifier, thisArg, args)
  assertSynchronousVerifierTrue(result, label)
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
  ): unknown
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
  ): unknown
}

export interface RootAttestationBinding {
  readonly domain: 'visual-artifact-ledger' | 'image-scheduler'
  readonly purpose: 'envelope' | 'finalization-checkpoint'
  readonly rootHash: string
  readonly version: number
  readonly contextHash: string
}

export interface RootAttestationVerifier {
  verifyRoot(attestation: OpaqueAttestation, binding: RootAttestationBinding): unknown
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
  ): unknown
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
  readonly approvalDependencyHash: string
  readonly promptApprovedAt: string
  readonly leaseExpiresAt: string
  readonly requestHash: string
  readonly idempotencyKey: string
  readonly policyHash: string
  readonly imageHash: string
}

export interface SchedulerServiceReceiptVerifier {
  verifyServiceReceipt(
    attestation: OpaqueAttestation,
    binding: SchedulerServiceReceiptBinding
  ): unknown
}

interface SchedulerAuthorityOperationBase {
  readonly authorityId: string
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
  readonly leaseMs: number
  readonly latestCommittedAt: string
  readonly maxReservationReleases: number
  readonly approvalDependencyHash: string
  readonly approvalLedgerRootHash: string
  readonly approvalLedgerSequence: number
  readonly approvalPlanHash: string
  readonly promptApprovedAt: string
  readonly promptHash: string
  readonly promptApprovalHash: string
  readonly approvalCheckpointAttestation: OpaqueAttestation
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

export interface SchedulerReservationReleaseOperation
  extends SchedulerAuthorityOperationBase {
  readonly action: 'cancel' | 'expire'
  readonly callId: string
  readonly leaseExpiresAt: string
  readonly cancellationReason: string
}

export type SchedulerAuthorityOperation =
  | SchedulerConfigureOperation
  | SchedulerReserveOperation
  | SchedulerCallOperation
  | SchedulerFailOperation
  | SchedulerReservationReleaseOperation

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
  /**
   * Atomically compare authorityId/version/root and persist the exact operation,
   * including a reserve operation's immutable approval dependency fence.
   */
  commit(operation: SchedulerAuthorityOperation): SchedulerAuthorityCommit
  /** Recover only a commit whose response was ambiguous for this exact in-flight operation. */
  recover(operation: SchedulerAuthorityOperation): SchedulerAuthorityCommit | undefined
  verifyCommit(
    commit: SchedulerAuthorityCommit,
    operation: SchedulerAuthorityOperation
  ): unknown
}

export interface LedgerFinalizationOperation {
  readonly authorityId: string
  readonly expectedLedgerSequence: number
  readonly expectedLedgerRootHash: string
  readonly planHash: string
  readonly registryHash: string
  readonly artifactCount: number
  readonly artifactSetHash: string
  readonly occurredAt: string
  readonly actorId: string
  readonly trustedCheckpointSequence: number
  readonly trustedCheckpointEventHash: string
  readonly trustedCheckpointRootHash: string
  readonly trustedCheckpointAttestation: OpaqueAttestation
  readonly principalAttestation: OpaqueAttestation
  readonly operationHash: string
}

export interface LedgerFinalizationAuthorityCommit {
  readonly authorityId: string
  readonly version: 1
  readonly committedAt: string
  readonly previousRootHash: string
  readonly rootHash: string
  readonly operationHash: string
  readonly attestation: OpaqueAttestation
}

export interface LedgerFinalizationRecord {
  readonly operation: LedgerFinalizationOperation
  readonly commit: LedgerFinalizationAuthorityCommit
}

export interface LedgerAppendOperation {
  readonly authorityId: string
  readonly expectedLedgerSequence: number
  readonly expectedLedgerRootHash: string
  readonly expectedLedgerEventHash: string
  readonly expectedAcceptedArtifactCount: number
  readonly planHash: string
  readonly registryHash: string
  readonly nextLedgerSequence: number
  readonly nextLedgerRootHash: string
  readonly nextLedgerEventHash: string
  readonly nextAcceptedArtifactCount: number
  readonly event: unknown
  readonly operationHash: string
}

export interface LedgerAppendAuthorityCommit {
  readonly authorityId: string
  readonly version: 1
  readonly committedAt: string
  readonly previousRootHash: string
  readonly rootHash: string
  readonly operationHash: string
  readonly attestation: OpaqueAttestation
}

export interface LedgerAppendRecord {
  readonly operation: LedgerAppendOperation
  readonly commit: LedgerAppendAuthorityCommit
}

export interface LedgerPublicationHead {
  readonly authorityId: string
  readonly planHash: string
  readonly registryHash: string
  readonly ledgerSequence: number
  readonly ledgerRootHash: string
  readonly ledgerEventHash: string
  readonly acceptedArtifactCount: number
  readonly authorityRootHash: string
  readonly finalized: boolean
}

export interface LedgerFinalizationAuthority {
  readonly authorityId: string
  /** Atomically advance the shared durable ledger head while it remains writable. */
  commitAppend(operation: LedgerAppendOperation): LedgerAppendAuthorityCommit
  /** Recover only the exact append whose durable response was lost. */
  recoverAppend(operation: LedgerAppendOperation): LedgerAppendAuthorityCommit | undefined
  /** Read and verify committed append records after a local sequence. */
  eventsAfter(planHash: string, sequence: number): readonly LedgerAppendRecord[]
  /** Read the shared durable head used by both append and finalization CAS. */
  head(planHash: string): LedgerPublicationHead | undefined
  verifyAppendCommit(
    commit: LedgerAppendAuthorityCommit,
    operation: LedgerAppendOperation
  ): unknown
  /** Atomically finalize the same shared durable head used by ordinary appends. */
  commit(operation: LedgerFinalizationOperation): LedgerFinalizationAuthorityCommit
  /** Recover only the exact operation whose durable response was lost. */
  recover(operation: LedgerFinalizationOperation): LedgerFinalizationAuthorityCommit | undefined
  /** Read the unique authoritative record for a plan after restart or on a stale fork. */
  current(planHash: string): LedgerFinalizationRecord | undefined
  verifyCommit(
    commit: LedgerFinalizationAuthorityCommit,
    operation: LedgerFinalizationOperation
  ): unknown
}

export interface LedgerAuthorityDependencies {
  readonly principalVerifier: AuthenticatedPrincipalVerifier
  readonly evidenceVerifier: EvidenceAttestationVerifier
  readonly rootVerifier: RootAttestationVerifier
  readonly finalizationAuthority: LedgerFinalizationAuthority
}

export interface SchedulerAuthorityDependencies {
  readonly authority: SchedulerAuthority
  readonly principalVerifier: AuthenticatedPrincipalVerifier
  readonly approvalVerifier: PromptApprovalCheckpointVerifier
  readonly serviceReceiptVerifier: SchedulerServiceReceiptVerifier
  readonly rootVerifier: RootAttestationVerifier
}
