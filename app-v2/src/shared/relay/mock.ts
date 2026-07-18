import {
  RELAY_BACKUP_FORMAT,
  RELAY_CAPABILITIES,
  RELAY_DOCUMENT_KINDS,
  RELAY_EVENT_KINDS,
  RELAY_PROVIDER_CONTRACT,
  RELAY_SCHEMA_VERSION,
  type RelayAdmissionReceipt,
  type RelayCanonicalTuple,
  type RelayCapability,
  type RelayCapabilityEnvelope,
  type RelayDataClass,
  type RelayDocumentDraft,
  type RelayDocumentKind,
  type RelayEventKind,
  type RelayHealthReport,
  type RelayIdentityEnvelope,
  type RelayKeyEnvelope,
  type RelayOfflineQueueItem,
  type RelayProviderAdapter,
  type RelayProviderHealth,
  type RelayProviderImportResult,
  type RelayProviderSnapshot,
  type RelayQuarantineRecord,
  type RelayQuotaPolicy,
  type RelayQuotaUsage,
  type RelayRejectionCode,
  type RelayResyncPlan,
  type RelayRotationCertificate,
  type RelayStoredEnvelope,
  type RelaySubmissionResult,
  type RelaySyncEnvelope
} from './contracts'
import {
  RelayPolicyError,
  assertRelayAdmissionReceiptShape,
  assertRelayEnvelopeShape,
  requiredCapabilityForEvent,
  validateEnvelopeDataPolicy,
  validateRelayDraft
} from './policy'

interface MockIdentityRegistryEntry {
  identity: RelayIdentityEnvelope
  signingSecret: string
  status: 'active' | 'revoked'
  revokedAt: number | null
}

interface MockDocumentSecurityState {
  tenantId: string
  documentId: string
  membershipEpoch: number
  keyEpoch: number
  consentEpoch: number
  consentGranted: boolean
  members: Set<string>
  heads: Set<string>
}

export interface CreateMockIdentityInput {
  tenantId: string
  subjectId: string
  deviceId: string
  issuedAt: number
  expiresAt: number
}

export interface IssueMockCapabilityInput {
  identity: RelayIdentityEnvelope
  documentIds: readonly string[]
  documentKinds?: readonly RelayDocumentKind[]
  eventKinds?: readonly RelayEventKind[]
  capabilities?: readonly RelayCapability[]
  maxDataClass?: RelayDataClass
  consentEpoch?: number
  issuedAt: number
  expiresAt: number
}

export interface SealMockEnvelopeInput {
  identity: RelayIdentityEnvelope
  capability: RelayCapabilityEnvelope
  draft: RelayDocumentDraft | unknown
  replayCounter: number
  createdAt: number
  expiresAt: number
}

export const DEFAULT_RELAY_QUOTAS: RelayQuotaPolicy = Object.freeze({
  maxObjectsPerTenant: 10_000,
  maxObjectsPerDevice: 2_500,
  maxObjectsPerDocument: 2_000,
  maxStoredBytesPerTenant: 64 * 1024 * 1024,
  maxEnvelopeBytes: 512 * 1024,
  maxReferenceCount: 256,
  maxReferenceBytes: 32 * 1024,
  maxOfflineQueueItems: 1_000,
  maxOfflineQueueBytes: 8 * 1024 * 1024
})

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`)
    .join(',')}}`
}

export function deterministicDigest(value: string): string {
  let result = ''
  for (let round = 0; round < 8; round += 1) {
    let hash = (0x811c9dc5 ^ (round * 0x9e3779b9)) >>> 0
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193) >>> 0
      hash = (hash ^ (hash >>> 13)) >>> 0
    }
    result += hash.toString(16).padStart(8, '0')
  }
  return result
}

function deterministicSign(value: unknown, secret: string): string {
  return `mock-ed25519:${deterministicDigest(`${secret}|${stableSerialize(value)}`)}`
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export function serializedByteLength(value: unknown): number {
  return byteLength(stableSerialize(value))
}

function withoutSignature<T extends { signature: string }>(value: T): Omit<T, 'signature'> {
  const { signature: _signature, ...unsigned } = value
  return unsigned
}

function canonicalTuple(envelope: RelaySyncEnvelope): RelayCanonicalTuple {
  return {
    schemaVersion: envelope.schemaVersion,
    providerContract: envelope.providerContract,
    tenantId: envelope.tenantId,
    documentId: envelope.documentId,
    documentKind: envelope.documentKind,
    eventKind: envelope.eventKind,
    dataClass: envelope.dataClass,
    membershipEpoch: envelope.membershipEpoch,
    keyEpoch: envelope.keyEpoch,
    senderDeviceId: envelope.senderDeviceId,
    senderSigningKeyId: envelope.senderSigningKeyId,
    replayCounter: envelope.replayCounter,
    parentRefs: envelope.parentRefs,
    headRefs: envelope.headRefs,
    ciphertextHash: envelope.ciphertextHash,
    keyEnvelopesHash: envelope.keyEnvelopesHash,
    cryptoProfile: envelope.cryptoProfile,
    createdAt: envelope.createdAt,
    expiresAt: envelope.expiresAt
  }
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  if (leftSet.size !== rightSet.size) return false
  return [...leftSet].every((entry) => rightSet.has(entry))
}

function isSubset(left: readonly string[], right: readonly string[]): boolean {
  const rightSet = new Set(right)
  return left.every((entry) => rightSet.has(entry))
}

interface RelayEnvelopeMeasurement {
  envelopeBytes: number
  referenceCount: number
  referenceBytes: number
}

interface VerifiedStoredScan {
  records: RelayStoredEnvelope[]
  replayCounters: Map<string, number>
  envelopeIds: Set<string>
}

function measureRelayEnvelope(envelope: RelaySyncEnvelope): RelayEnvelopeMeasurement {
  const references = [...envelope.parentRefs, ...envelope.headRefs]
  return {
    envelopeBytes: serializedByteLength(envelope),
    referenceCount: references.length,
    referenceBytes: references.reduce((sum, reference) => sum + byteLength(reference), 0)
  }
}

function quotaUsageAfter(
  usageBefore: RelayQuotaUsage,
  measurement: RelayEnvelopeMeasurement
): RelayQuotaUsage {
  return {
    tenantObjects: usageBefore.tenantObjects + 1,
    deviceObjects: usageBefore.deviceObjects + 1,
    documentObjects: usageBefore.documentObjects + 1,
    tenantStoredBytes: usageBefore.tenantStoredBytes + measurement.envelopeBytes
  }
}

function quotaAllows(
  limits: RelayQuotaPolicy,
  usageAfter: RelayQuotaUsage,
  measurement: RelayEnvelopeMeasurement
): boolean {
  return usageAfter.tenantObjects <= limits.maxObjectsPerTenant &&
    usageAfter.deviceObjects <= limits.maxObjectsPerDevice &&
    usageAfter.documentObjects <= limits.maxObjectsPerDocument &&
    usageAfter.tenantStoredBytes <= limits.maxStoredBytesPerTenant &&
    measurement.envelopeBytes <= limits.maxEnvelopeBytes &&
    measurement.referenceCount <= limits.maxReferenceCount &&
    measurement.referenceBytes <= limits.maxReferenceBytes
}

function admissionReceiptId(
  receipt: Omit<RelayAdmissionReceipt, 'receiptId' | 'signature'>
): string {
  return `admission-${deterministicDigest(stableSerialize(receipt)).slice(0, 32)}`
}

function assertAdmissionRecordBinding(
  envelope: RelaySyncEnvelope,
  admission: unknown,
  storedAt: number
): asserts admission is RelayAdmissionReceipt {
  assertRelayAdmissionReceiptShape(admission)
  if (admission.envelopeId !== envelope.envelopeId ||
      admission.envelopeDigest !== deterministicDigest(stableSerialize(envelope)) ||
      admission.tenantId !== envelope.tenantId ||
      admission.documentId !== envelope.documentId ||
      admission.senderDeviceId !== envelope.senderDeviceId ||
      admission.senderSigningKeyId !== envelope.senderSigningKeyId ||
      admission.admittedAt !== storedAt) {
    throw new RelayPolicyError(
      'admission-proof-invalid',
      'Admission receipt is not bound to this exact stored envelope and admission time.'
    )
  }
}

export class DeterministicRelaySecurity {
  private readonly authorityKeyId = 'mock-authority-key-v1'
  private readonly authoritySecret = 'test-only-authority-secret'
  private readonly admissionAuthorityKeyId = 'mock-admission-authority-key-v1'
  private readonly admissionAuthoritySecret = 'test-only-admission-authority-secret'
  private readonly identities = new Map<string, MockIdentityRegistryEntry>()
  private readonly identityByDevice = new Map<string, RelayIdentityEnvelope>()
  private readonly documents = new Map<string, MockDocumentSecurityState>()

  createIdentity(input: CreateMockIdentityInput): RelayIdentityEnvelope {
    const prior = this.identityByDevice.get(input.deviceId)
    if (prior) {
      const priorEntry = this.identities.get(prior.signingKeyId)
      if (!priorEntry || priorEntry.status !== 'revoked') {
        throw new Error('A device identity already exists; revoke it before provisioning a replacement identity.')
      }
    }
    const identityEpoch = prior ? prior.identityEpoch + 1 : 1
    const seed = `${input.tenantId}|${input.subjectId}|${input.deviceId}|${identityEpoch}`
    const signingKeyId = `sig-${deterministicDigest(`signing|${seed}`).slice(0, 20)}`
    const encryptionKeyId = `enc-${deterministicDigest(`encryption|${seed}`).slice(0, 20)}`
    const signingSecret = `mock-signing-secret:${deterministicDigest(`secret|${seed}`)}`
    const unsigned: Omit<RelayIdentityEnvelope, 'signature'> = {
      schemaVersion: RELAY_SCHEMA_VERSION,
      tenantId: input.tenantId,
      subjectId: input.subjectId,
      deviceId: input.deviceId,
      identityEpoch,
      signingKeyId,
      signingPublicKey: `mock-public:${deterministicDigest(`public|${signingSecret}`)}`,
      encryptionKeyId,
      encryptionPublicKey: `mock-public:${deterministicDigest(`public|${encryptionKeyId}`)}`,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      status: 'active',
      issuerKeyId: this.authorityKeyId
    }
    const identity: RelayIdentityEnvelope = {
      ...unsigned,
      signature: deterministicSign(unsigned, this.authoritySecret)
    }
    this.identities.set(signingKeyId, { identity, signingSecret, status: 'active', revokedAt: null })
    this.identityByDevice.set(input.deviceId, identity)
    return cloneJson(identity)
  }

  registerDocument(tenantId: string, documentId: string, memberDeviceIds: readonly string[]): void {
    if (this.documents.has(documentId)) throw new Error(`Document ${documentId} is already registered.`)
    for (const deviceId of memberDeviceIds) {
      const identity = this.identityByDevice.get(deviceId)
      if (!identity || identity.tenantId !== tenantId) throw new Error(`Unknown tenant member ${deviceId}.`)
    }
    this.documents.set(documentId, {
      tenantId,
      documentId,
      membershipEpoch: 1,
      keyEpoch: 1,
      consentEpoch: 1,
      consentGranted: true,
      members: new Set(memberDeviceIds),
      heads: new Set()
    })
  }

  issueCapability(input: IssueMockCapabilityInput): RelayCapabilityEnvelope {
    if (input.documentIds.length === 0) throw new Error('A relay capability must name at least one document.')
    const currentIdentity = this.identityByDevice.get(input.identity.deviceId)
    const identityEntry = this.identities.get(input.identity.signingKeyId)
    if (!currentIdentity ||
        currentIdentity.signingKeyId !== input.identity.signingKeyId ||
        !identityEntry ||
        identityEntry.status !== 'active') {
      throw new Error('Cannot issue a capability for an unknown or revoked identity.')
    }
    const states = input.documentIds.map((documentId) => {
      const state = this.documents.get(documentId)
      if (!state || state.tenantId !== input.identity.tenantId || !state.members.has(input.identity.deviceId)) {
        throw new Error(`Identity is not an active member of ${documentId}.`)
      }
      return state
    })
    const membershipEpochs = new Set(states.map((state) => state.membershipEpoch))
    if (membershipEpochs.size !== 1) {
      throw new Error('Documents with different membership epochs require separate capability envelopes.')
    }
    const membershipEpoch = states[0].membershipEpoch
    const maxDataClass = input.maxDataClass ?? 'D2'
    if (maxDataClass === 'D4' || maxDataClass === 'D5') {
      throw new Error('Relay capabilities cannot authorize D4 or D5 content.')
    }
    const consentEpoch = input.consentEpoch ?? (maxDataClass === 'D3' ? states[0].consentEpoch : 0)
    if (maxDataClass === 'D3' &&
        (states.some((state) => !state.consentGranted || state.consentEpoch !== consentEpoch))) {
      throw new Error('D3 relay capabilities require the current granted consent epoch for every document.')
    }
    const unsigned: Omit<RelayCapabilityEnvelope, 'signature'> = {
      schemaVersion: RELAY_SCHEMA_VERSION,
      grantId: `grant-${deterministicDigest([
        input.identity.signingKeyId,
        input.documentIds.join(','),
        membershipEpoch,
        input.issuedAt
      ].join('|')).slice(0, 24)}`,
      tenantId: input.identity.tenantId,
      subjectId: input.identity.subjectId,
      deviceId: input.identity.deviceId,
      documentIds: [...input.documentIds],
      documentKinds: [...(input.documentKinds ?? RELAY_DOCUMENT_KINDS)],
      eventKinds: [...(input.eventKinds ?? RELAY_EVENT_KINDS)],
      capabilities: [...(input.capabilities ?? RELAY_CAPABILITIES)],
      maxDataClass,
      consentEpoch,
      membershipEpoch,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      issuerKeyId: this.authorityKeyId
    }
    return {
      ...unsigned,
      signature: deterministicSign(unsigned, this.authoritySecret)
    }
  }

  updateDocumentConsent(
    documentId: string,
    granted: boolean
  ): { documentId: string; consentEpoch: number; granted: boolean } {
    const state = this.requireDocument(documentId)
    state.consentEpoch += 1
    state.consentGranted = granted
    return { documentId, consentEpoch: state.consentEpoch, granted }
  }

  seal(input: SealMockEnvelopeInput): RelaySyncEnvelope {
    const draft = validateRelayDraft(input.draft)
    const state = this.documents.get(draft.documentId)
    if (!state || state.tenantId !== draft.tenantId) throw new Error(`Unknown relay document ${draft.documentId}.`)
    const identityEntry = this.identities.get(input.identity.signingKeyId)
    if (!identityEntry || identityEntry.status !== 'active') throw new Error('Mock signer is not active.')

    const payloadDigest = deterministicDigest(stableSerialize(draft.payload))
    const ciphertext = `mock-ciphertext:${deterministicDigest([
      draft.documentId,
      state.keyEpoch,
      input.replayCounter,
      payloadDigest
    ].join('|'))}`
    const ciphertextHash = deterministicDigest(ciphertext)
    const headRefs = draft.headRefs.length > 0
      ? [...draft.headRefs]
      : [`head-${deterministicDigest(`${payloadDigest}|${input.replayCounter}`).slice(0, 24)}`]
    const keyEnvelopes = this.createMemberKeyEnvelopes(state)
    const keyEnvelopesHash = deterministicDigest(stableSerialize(keyEnvelopes))
    const tuple: RelayCanonicalTuple = {
      schemaVersion: RELAY_SCHEMA_VERSION,
      providerContract: RELAY_PROVIDER_CONTRACT,
      tenantId: draft.tenantId,
      documentId: draft.documentId,
      documentKind: draft.documentKind,
      eventKind: draft.eventKind,
      dataClass: draft.dataClass,
      membershipEpoch: state.membershipEpoch,
      keyEpoch: state.keyEpoch,
      senderDeviceId: input.identity.deviceId,
      senderSigningKeyId: input.identity.signingKeyId,
      replayCounter: input.replayCounter,
      parentRefs: [...draft.parentRefs],
      headRefs,
      ciphertextHash,
      keyEnvelopesHash,
      cryptoProfile: 'deterministic-test-only',
      createdAt: input.createdAt,
      expiresAt: input.expiresAt
    }
    const signature = deterministicSign(tuple, identityEntry.signingSecret)
    return {
      ...tuple,
      envelopeId: `env-${deterministicDigest(`${stableSerialize(tuple)}|${signature}`).slice(0, 32)}`,
      identity: cloneJson(input.identity),
      capability: cloneJson(input.capability),
      keyEnvelopes,
      ciphertext,
      ciphertextBytes: byteLength(ciphertext),
      signature
    }
  }

  validateEnvelope(
    value: unknown,
    now: number,
    mode: 'submission' | 'stored' = 'submission'
  ): RelaySyncEnvelope {
    assertRelayEnvelopeShape(value)
    const envelope = value
    validateEnvelopeDataPolicy(envelope)

    const identityEntry = this.identities.get(envelope.senderSigningKeyId)
    if (!identityEntry) throw new RelayPolicyError('identity-invalid', 'Sender signing key is unknown.')
    if (identityEntry.status === 'revoked' &&
        (mode === 'submission' ||
          identityEntry.revokedAt === null ||
          envelope.createdAt >= identityEntry.revokedAt)) {
      throw new RelayPolicyError('signer-revoked', 'Sender signing key is revoked.')
    }
    if (envelope.identity.status !== 'active' ||
        envelope.identity.signingKeyId !== envelope.senderSigningKeyId ||
        envelope.identity.deviceId !== envelope.senderDeviceId ||
        envelope.identity.tenantId !== envelope.tenantId ||
        envelope.identity.issuerKeyId !== this.authorityKeyId ||
        envelope.identity.identityEpoch !== identityEntry.identity.identityEpoch) {
      throw new RelayPolicyError('identity-invalid', 'Identity envelope does not match the active sender identity.')
    }
    if (deterministicSign(withoutSignature(envelope.identity), this.authoritySecret) !== envelope.identity.signature) {
      throw new RelayPolicyError('identity-invalid', 'Identity envelope signature is invalid.')
    }
    const evaluationTime = mode === 'stored' ? envelope.createdAt : now
    if (evaluationTime < envelope.identity.issuedAt || evaluationTime >= envelope.identity.expiresAt ||
        evaluationTime < envelope.capability.issuedAt || evaluationTime >= envelope.capability.expiresAt ||
        evaluationTime >= envelope.expiresAt) {
      throw new RelayPolicyError('capability-denied', 'Identity, capability, or sync envelope has expired.')
    }
    if (deterministicSign(withoutSignature(envelope.capability), this.authoritySecret) !== envelope.capability.signature) {
      throw new RelayPolicyError('capability-denied', 'Capability envelope signature is invalid.')
    }
    if (envelope.capability.tenantId !== envelope.tenantId ||
        envelope.capability.subjectId !== envelope.identity.subjectId ||
        envelope.capability.deviceId !== envelope.senderDeviceId ||
        envelope.capability.issuerKeyId !== this.authorityKeyId ||
        envelope.capability.issuedAt < envelope.identity.issuedAt) {
      throw new RelayPolicyError('capability-denied', 'Capability subject/timing does not match the sender identity.')
    }

    const state = this.documents.get(envelope.documentId)
    if (!state || state.tenantId !== envelope.tenantId ||
        (mode === 'submission' && !state.members.has(envelope.senderDeviceId))) {
      throw new RelayPolicyError('capability-denied', 'Sender is not a current document member.')
    }
    if (envelope.capability.membershipEpoch !== envelope.membershipEpoch ||
        (mode === 'submission' && envelope.membershipEpoch !== state.membershipEpoch) ||
        (mode === 'stored' && envelope.membershipEpoch > state.membershipEpoch)) {
      throw new RelayPolicyError('stale-membership', 'Membership epoch is stale.')
    }
    if (mode === 'submission' &&
        envelope.dataClass === 'D3' &&
        (!state.consentGranted || envelope.capability.consentEpoch !== state.consentEpoch)) {
      throw new RelayPolicyError('consent-required', 'D3 consent is stale or withdrawn for this document.')
    }
    const actualRecipientKeyIds = envelope.keyEnvelopes.map((entry) => entry.recipientKeyId).sort()
    const expectedRecipientKeyIds = mode === 'submission'
      ? [...state.members]
        .map((deviceId) => this.identityByDevice.get(deviceId)?.encryptionKeyId)
        .filter((keyId): keyId is string => Boolean(keyId))
        .sort()
      : [envelope.identity.encryptionKeyId]
    if ((mode === 'submission' && envelope.keyEpoch !== state.keyEpoch) ||
        (mode === 'stored' && envelope.keyEpoch > state.keyEpoch) ||
        envelope.keyEnvelopes.some((entry) =>
          entry.keyEpoch !== envelope.keyEpoch || entry.documentId !== envelope.documentId) ||
        new Set(actualRecipientKeyIds).size !== actualRecipientKeyIds.length ||
        (mode === 'submission'
          ? !sameStringSet(actualRecipientKeyIds, expectedRecipientKeyIds)
          : !actualRecipientKeyIds.includes(envelope.identity.encryptionKeyId))) {
      throw new RelayPolicyError('stale-key', 'Document key envelopes are stale or do not cover current members.')
    }
    if (byteLength(envelope.ciphertext) !== envelope.ciphertextBytes ||
        deterministicDigest(envelope.ciphertext) !== envelope.ciphertextHash) {
      throw new RelayPolicyError('ciphertext-hash-mismatch', 'Ciphertext bytes/hash do not match the signed tuple.')
    }
    if (deterministicDigest(stableSerialize(envelope.keyEnvelopes)) !== envelope.keyEnvelopesHash) {
      throw new RelayPolicyError('key-envelope-hash-mismatch', 'Member key envelopes do not match the signed tuple.')
    }

    const tuple = canonicalTuple(envelope)
    if (deterministicSign(tuple, identityEntry.signingSecret) !== envelope.signature) {
      throw new RelayPolicyError('signature-invalid', 'Sender signature over the canonical tuple is invalid.')
    }
    const expectedEnvelopeId = `env-${deterministicDigest(`${stableSerialize(tuple)}|${envelope.signature}`).slice(0, 32)}`
    if (expectedEnvelopeId !== envelope.envelopeId) {
      throw new RelayPolicyError('signature-invalid', 'Envelope ID does not match the signed canonical tuple.')
    }
    return envelope
  }

  issueAdmissionReceipt(
    envelope: RelaySyncEnvelope,
    admittedAt: number,
    limits: RelayQuotaPolicy,
    usageBefore: RelayQuotaUsage,
    priorReplayCounter: number
  ): RelayAdmissionReceipt {
    const validatedEnvelope = this.validateEnvelope(envelope, admittedAt)
    if (validatedEnvelope.replayCounter <= priorReplayCounter) {
      throw new RelayPolicyError('replay', 'Replay counter is not greater than the last accepted counter.')
    }
    const state = this.requireDocument(validatedEnvelope.documentId)
    const measurement = measureRelayEnvelope(validatedEnvelope)
    const usageAfter = quotaUsageAfter(usageBefore, measurement)
    if (!quotaAllows(limits, usageAfter, measurement)) {
      throw new RelayPolicyError('quota-exceeded', 'Relay quota denied the write before provider storage.')
    }

    const policy = {
      identityEpoch: validatedEnvelope.identity.identityEpoch,
      capabilityGrantId: validatedEnvelope.capability.grantId,
      capabilityDigest: deterministicDigest(stableSerialize(validatedEnvelope.capability)),
      membershipEpoch: validatedEnvelope.membershipEpoch,
      keyEpoch: validatedEnvelope.keyEpoch,
      documentConsentEpoch: state.consentEpoch,
      capabilityConsentEpoch: validatedEnvelope.capability.consentEpoch,
      requiredCapability: requiredCapabilityForEvent(validatedEnvelope.eventKind),
      replayCounter: validatedEnvelope.replayCounter,
      priorReplayCounter,
      identityActive: true as const,
      memberAtAdmission: true as const,
      consentGrantedAtAdmission: state.consentGranted
    }
    const quota = {
      limits: cloneJson(limits),
      limitsDigest: deterministicDigest(stableSerialize(limits)),
      usageBefore: cloneJson(usageBefore),
      usageAfter,
      envelopeBytes: measurement.envelopeBytes,
      referenceCount: measurement.referenceCount,
      referenceBytes: measurement.referenceBytes
    }
    const core: Omit<RelayAdmissionReceipt, 'receiptId' | 'signature'> = {
      schemaVersion: RELAY_SCHEMA_VERSION,
      providerContract: RELAY_PROVIDER_CONTRACT,
      envelopeId: validatedEnvelope.envelopeId,
      envelopeDigest: deterministicDigest(stableSerialize(validatedEnvelope)),
      tenantId: validatedEnvelope.tenantId,
      documentId: validatedEnvelope.documentId,
      senderDeviceId: validatedEnvelope.senderDeviceId,
      senderSigningKeyId: validatedEnvelope.senderSigningKeyId,
      admittedAt,
      policy,
      quota,
      issuerKeyId: this.admissionAuthorityKeyId
    }
    const unsigned: Omit<RelayAdmissionReceipt, 'signature'> = {
      ...core,
      receiptId: admissionReceiptId(core)
    }
    return {
      ...unsigned,
      signature: deterministicSign(unsigned, this.admissionAuthoritySecret)
    }
  }

  validateAdmissionReceipt(
    value: unknown,
    envelope: RelaySyncEnvelope,
    storedAt: number
  ): RelayAdmissionReceipt {
    assertAdmissionRecordBinding(envelope, value, storedAt)
    const admission = value
    const { receiptId: _receiptId, signature: _signature, ...core } = admission
    const measurement = measureRelayEnvelope(envelope)
    const expectedUsageAfter = quotaUsageAfter(admission.quota.usageBefore, measurement)
    const policyMatchesEnvelope =
      admission.policy.identityEpoch === envelope.identity.identityEpoch &&
      admission.policy.capabilityGrantId === envelope.capability.grantId &&
      admission.policy.capabilityDigest === deterministicDigest(stableSerialize(envelope.capability)) &&
      admission.policy.membershipEpoch === envelope.membershipEpoch &&
      admission.policy.keyEpoch === envelope.keyEpoch &&
      admission.policy.capabilityConsentEpoch === envelope.capability.consentEpoch &&
      admission.policy.requiredCapability === requiredCapabilityForEvent(envelope.eventKind) &&
      admission.policy.replayCounter === envelope.replayCounter &&
      admission.policy.replayCounter > admission.policy.priorReplayCounter &&
      admission.policy.identityActive === true &&
      admission.policy.memberAtAdmission === true
    const consentWasValid = envelope.dataClass !== 'D3' ||
      (admission.policy.consentGrantedAtAdmission &&
        admission.policy.documentConsentEpoch === admission.policy.capabilityConsentEpoch)
    const quotaMetadataValid =
      admission.quota.limitsDigest === deterministicDigest(stableSerialize(admission.quota.limits)) &&
      admission.quota.envelopeBytes === measurement.envelopeBytes &&
      admission.quota.referenceCount === measurement.referenceCount &&
      admission.quota.referenceBytes === measurement.referenceBytes &&
      stableSerialize(admission.quota.usageAfter) === stableSerialize(expectedUsageAfter) &&
      quotaAllows(admission.quota.limits, admission.quota.usageAfter, measurement)
    const timingValid =
      admission.admittedAt >= envelope.createdAt &&
      admission.admittedAt >= envelope.identity.issuedAt &&
      admission.admittedAt >= envelope.capability.issuedAt &&
      admission.admittedAt < envelope.identity.expiresAt &&
      admission.admittedAt < envelope.capability.expiresAt &&
      admission.admittedAt < envelope.expiresAt

    if (admission.issuerKeyId !== this.admissionAuthorityKeyId ||
        admission.receiptId !== admissionReceiptId(core) ||
        deterministicSign(withoutSignature(admission), this.admissionAuthoritySecret) !== admission.signature ||
        !policyMatchesEnvelope ||
        !consentWasValid ||
        !quotaMetadataValid ||
        !timingValid) {
      throw new RelayPolicyError(
        'admission-proof-invalid',
        'Stored relay envelope lacks a valid authenticated gateway admission receipt.'
      )
    }
    return admission
  }

  rotateDocumentKey(documentId: string, reason: string, issuedAt: number): RelayRotationCertificate {
    const state = this.requireDocument(documentId)
    const previousKeyEpoch = state.keyEpoch
    state.keyEpoch += 1
    return this.createRotationCertificate(state, {
      reason,
      issuedAt,
      revokedDeviceId: null,
      revokedSigningKeyId: null,
      previousMembershipEpoch: state.membershipEpoch,
      previousKeyEpoch
    })
  }

  revokeDocumentMember(
    documentId: string,
    deviceId: string,
    reason: string,
    issuedAt: number
  ): RelayRotationCertificate {
    const state = this.requireDocument(documentId)
    const identity = this.identityByDevice.get(deviceId)
    if (!identity || !state.members.has(deviceId)) throw new Error(`Device ${deviceId} is not a document member.`)
    state.members.delete(deviceId)
    const previousMembershipEpoch = state.membershipEpoch
    const previousKeyEpoch = state.keyEpoch
    state.membershipEpoch += 1
    state.keyEpoch += 1
    return this.createRotationCertificate(state, {
      reason,
      issuedAt,
      revokedDeviceId: deviceId,
      revokedSigningKeyId: identity.signingKeyId,
      previousMembershipEpoch,
      previousKeyEpoch
    })
  }

  revokeDevice(deviceId: string, reason: string, issuedAt: number): readonly RelayRotationCertificate[] {
    const identity = this.identityByDevice.get(deviceId)
    if (!identity) throw new Error(`Unknown relay device ${deviceId}.`)
    const entry = this.identities.get(identity.signingKeyId)
    if (!entry || entry.status === 'revoked') throw new Error(`Relay device ${deviceId} is already revoked.`)
    entry.status = 'revoked'
    entry.revokedAt = issuedAt

    return [...this.documents.values()]
      .filter((state) => state.members.has(deviceId))
      .sort((left, right) => left.documentId < right.documentId ? -1 : left.documentId > right.documentId ? 1 : 0)
      .map((state) => {
        state.members.delete(deviceId)
        const previousMembershipEpoch = state.membershipEpoch
        const previousKeyEpoch = state.keyEpoch
        state.membershipEpoch += 1
        state.keyEpoch += 1
        return this.createRotationCertificate(state, {
          reason,
          issuedAt,
          revokedDeviceId: deviceId,
          revokedSigningKeyId: identity.signingKeyId,
          previousMembershipEpoch,
          previousKeyEpoch
        })
      })
  }

  currentHeads(documentId: string): readonly string[] {
    return [...this.requireDocument(documentId).heads].sort()
  }

  noteAccepted(envelope: RelaySyncEnvelope): void {
    if (envelope.eventKind !== 'document-change' && envelope.eventKind !== 'document-snapshot') return
    const state = this.requireDocument(envelope.documentId)
    for (const parent of envelope.parentRefs) state.heads.delete(parent)
    for (const head of envelope.headRefs) state.heads.add(head)
  }

  getDocumentEpochs(documentId: string): { membershipEpoch: number; keyEpoch: number } {
    const state = this.requireDocument(documentId)
    return { membershipEpoch: state.membershipEpoch, keyEpoch: state.keyEpoch }
  }

  private createKeyEnvelope(
    state: MockDocumentSecurityState,
    identity: RelayIdentityEnvelope
  ): RelayKeyEnvelope {
    return {
      schemaVersion: RELAY_SCHEMA_VERSION,
      documentId: state.documentId,
      keyEpoch: state.keyEpoch,
      recipientKeyId: identity.encryptionKeyId,
      wrappingAlgorithm: 'deterministic-test-only',
      wrappedDocumentKey: `mock-wrapped-key:${deterministicDigest([
        state.tenantId,
        state.documentId,
        state.keyEpoch,
        identity.encryptionKeyId
      ].join('|'))}`
    }
  }

  private createMemberKeyEnvelopes(state: MockDocumentSecurityState): RelayKeyEnvelope[] {
    return [...state.members]
      .sort()
      .map((deviceId) => {
        const identity = this.identityByDevice.get(deviceId)
        if (!identity) throw new Error(`Missing identity for active member ${deviceId}.`)
        const identityEntry = this.identities.get(identity.signingKeyId)
        if (!identityEntry || identityEntry.status !== 'active') return null
        return this.createKeyEnvelope(state, identity)
      })
      .filter((entry): entry is RelayKeyEnvelope => entry !== null)
  }

  private createRotationCertificate(
    state: MockDocumentSecurityState,
    input: {
      reason: string
      issuedAt: number
      revokedDeviceId: string | null
      revokedSigningKeyId: string | null
      previousMembershipEpoch: number
      previousKeyEpoch: number
    }
  ): RelayRotationCertificate {
    const memberKeyEnvelopes = this.createMemberKeyEnvelopes(state)
    const unsigned: Omit<RelayRotationCertificate, 'signature'> = {
      schemaVersion: RELAY_SCHEMA_VERSION,
      certificateId: `rotation-${deterministicDigest([
        state.documentId,
        state.membershipEpoch,
        state.keyEpoch,
        input.issuedAt,
        input.reason
      ].join('|')).slice(0, 28)}`,
      tenantId: state.tenantId,
      documentId: state.documentId,
      reason: input.reason,
      revokedDeviceId: input.revokedDeviceId,
      revokedSigningKeyId: input.revokedSigningKeyId,
      previousMembershipEpoch: input.previousMembershipEpoch,
      membershipEpoch: state.membershipEpoch,
      previousKeyEpoch: input.previousKeyEpoch,
      keyEpoch: state.keyEpoch,
      issuedAt: input.issuedAt,
      issuerKeyId: this.authorityKeyId,
      memberKeyEnvelopes
    }
    return {
      ...unsigned,
      signature: deterministicSign(unsigned, this.authoritySecret)
    }
  }

  private requireDocument(documentId: string): MockDocumentSecurityState {
    const state = this.documents.get(documentId)
    if (!state) throw new Error(`Unknown relay document ${documentId}.`)
    return state
  }
}

export class DeterministicMockRelayProvider implements RelayProviderAdapter {
  readonly contractVersion = RELAY_PROVIDER_CONTRACT
  private readonly recordsByTenant = new Map<string, RelayStoredEnvelope[]>()
  private nextCursor = 1
  private generation = 1
  private online = true
  private leaderIds: string[]

  constructor(readonly providerId: string) {
    this.leaderIds = [`${providerId}-leader-1`]
  }

  write(
    envelope: RelaySyncEnvelope,
    admission: RelayAdmissionReceipt,
    storedAt: number
  ): RelayStoredEnvelope {
    const health = this.health(envelope.tenantId)
    if (health.status === 'offline') throw new RelayPolicyError('provider-offline', 'Mock relay provider is offline.')
    if (health.status === 'split-brain') {
      throw new RelayPolicyError('provider-split-brain', 'Mock relay provider has multiple writers.')
    }
    assertAdmissionRecordBinding(envelope, admission, storedAt)
    return this.appendRecord(envelope, storedAt, admission)
  }

  injectUntrustedEnvelope(
    envelope: RelaySyncEnvelope,
    storedAt: number,
    admission?: RelayAdmissionReceipt
  ): RelayStoredEnvelope {
    return this.appendRecord(envelope, storedAt, admission)
  }

  private appendRecord(
    envelope: RelaySyncEnvelope,
    storedAt: number,
    admission?: RelayAdmissionReceipt
  ): RelayStoredEnvelope {
    const record = {
      cursor: this.nextCursor,
      storedAt,
      envelope: cloneJson(envelope),
      ...(admission ? { admission: cloneJson(admission) } : {})
    } as RelayStoredEnvelope
    this.nextCursor += 1
    const records = this.recordsByTenant.get(envelope.tenantId) ?? []
    records.push(record)
    this.recordsByTenant.set(envelope.tenantId, records)
    return cloneJson(record)
  }

  list(tenantId: string): readonly RelayStoredEnvelope[] {
    return cloneJson(this.recordsByTenant.get(tenantId) ?? [])
  }

  health(tenantId: string): RelayProviderHealth {
    const records = this.recordsByTenant.get(tenantId) ?? []
    const status = !this.online
      ? 'offline'
      : this.leaderIds.length > 1
        ? 'split-brain'
        : 'healthy'
    return {
      providerId: this.providerId,
      contractVersion: this.contractVersion,
      status,
      generation: this.generation,
      leaderIds: [...this.leaderIds],
      latestCursor: records.at(-1)?.cursor ?? 0,
      detail: status === 'healthy'
        ? 'Deterministic mock provider is healthy.'
        : status === 'offline'
          ? 'Deterministic mock provider is offline; local work must continue.'
          : 'Conflicting mock provider leaders require operator recovery.'
    }
  }

  exportSnapshot(tenantId: string, createdAt: number): RelayProviderSnapshot {
    const records = this.list(tenantId)
    return {
      format: RELAY_BACKUP_FORMAT,
      tenantId,
      sourceProviderId: this.providerId,
      sourceGeneration: this.generation,
      createdAt,
      records,
      recordsDigest: deterministicDigest(stableSerialize(records))
    }
  }

  importSnapshot(snapshot: RelayProviderSnapshot): RelayProviderImportResult {
    if (snapshot.format !== RELAY_BACKUP_FORMAT ||
        deterministicDigest(stableSerialize(snapshot.records)) !== snapshot.recordsDigest) {
      throw new RelayPolicyError('backup-integrity-failed', 'Relay snapshot digest is invalid.')
    }
    let previousCursor = 0
    for (const record of snapshot.records) {
      try {
        assertRelayEnvelopeShape(record.envelope)
        assertAdmissionRecordBinding(record.envelope, record.admission, record.storedAt)
      } catch {
        throw new RelayPolicyError(
          'backup-integrity-failed',
          'Relay snapshot record lacks a structurally valid bound admission receipt.'
        )
      }
      if (record.envelope.tenantId !== snapshot.tenantId ||
          !Number.isInteger(record.cursor) ||
          record.cursor <= previousCursor ||
          !Number.isInteger(record.storedAt) ||
          record.storedAt < 0) {
        throw new RelayPolicyError('backup-integrity-failed', 'Relay snapshot cursor/tenant metadata is invalid.')
      }
      previousCursor = record.cursor
    }
    const current = this.recordsByTenant.get(snapshot.tenantId) ?? []
    if (current.length > 0) {
      const currentDigest = deterministicDigest(stableSerialize(current))
      if (currentDigest !== snapshot.recordsDigest) {
        throw new RelayPolicyError('restore-conflict', 'Destination provider already contains different tenant data.')
      }
      return {
        imported: current.length,
        latestCursor: current.at(-1)?.cursor ?? 0,
        recordsDigest: currentDigest
      }
    }
    const records = [...cloneJson(snapshot.records)]
    this.recordsByTenant.set(snapshot.tenantId, records)
    const latestCursor = records.at(-1)?.cursor ?? 0
    this.nextCursor = Math.max(this.nextCursor, latestCursor + 1)
    this.generation += 1
    return {
      imported: records.length,
      latestCursor,
      recordsDigest: deterministicDigest(stableSerialize(records))
    }
  }

  clearTenant(tenantId: string): void {
    this.recordsByTenant.delete(tenantId)
    this.generation += 1
  }

  setOnline(online: boolean): void {
    this.online = online
  }

  simulateSplitBrain(secondaryLeaderId = `${this.providerId}-leader-2`): void {
    if (!this.leaderIds.includes(secondaryLeaderId)) this.leaderIds.push(secondaryLeaderId)
  }

  resolveSplitBrain(): void {
    this.leaderIds = [this.leaderIds[0] ?? `${this.providerId}-leader-1`]
    this.generation += 1
  }

  tamperEnvelope(
    tenantId: string,
    cursor: number,
    mutate: (envelope: RelaySyncEnvelope) => RelaySyncEnvelope
  ): void {
    const records = this.recordsByTenant.get(tenantId) ?? []
    const record = records.find((entry) => entry.cursor === cursor)
    if (!record) throw new Error(`No mock relay record at cursor ${cursor}.`)
    record.envelope = cloneJson(mutate(cloneJson(record.envelope)))
  }
}

export class DeterministicRelayGateway {
  private readonly replayCounters = new Map<string, number>()
  private readonly quarantineRecords: RelayQuarantineRecord[] = []

  constructor(
    readonly provider: RelayProviderAdapter,
    readonly security: DeterministicRelaySecurity,
    readonly quotas: RelayQuotaPolicy = DEFAULT_RELAY_QUOTAS
  ) {}

  submit(value: unknown, now: number): RelaySubmissionResult {
    try {
      const envelope = this.security.validateEnvelope(value, now)
      const providerHealth = this.provider.health(envelope.tenantId)
      if (providerHealth.status === 'offline') {
        return this.result('rejected', 'provider-offline', 'Relay provider is offline.', envelope.envelopeId)
      }
      if (providerHealth.status === 'split-brain') {
        return this.result('rejected', 'provider-split-brain', 'Relay provider split brain blocks writes.', envelope.envelopeId)
      }

      const storedScan = this.scanVerifiedStored(envelope.tenantId, now)
      const replayKey = `${envelope.documentId}|${envelope.senderSigningKeyId}`
      const priorCounter = Math.max(
        this.replayCounters.get(replayKey) ?? 0,
        storedScan.replayCounters.get(replayKey) ?? 0
      )
      if (storedScan.envelopeIds.has(envelope.envelopeId) || envelope.replayCounter <= priorCounter) {
        return this.result('rejected', 'replay', 'Replay counter is not greater than the last accepted counter.', envelope.envelopeId)
      }

      const usage = this.quotaUsage(envelope, storedScan.records)
      const admission = this.security.issueAdmissionReceipt(envelope, now, this.quotas, usage, priorCounter)
      const stored = this.provider.write(envelope, admission, now)
      this.replayCounters.set(replayKey, envelope.replayCounter)
      this.security.noteAccepted(envelope)
      return {
        status: 'accepted',
        code: 'accepted',
        envelopeId: envelope.envelopeId,
        cursor: stored.cursor,
        message: 'Ciphertext envelope accepted by deterministic mock relay.'
      }
    } catch (error) {
      return this.fromError(error)
    }
  }

  verifyStored(tenantId: string, now: number): readonly RelayStoredEnvelope[] {
    return this.scanVerifiedStored(tenantId, now).records
  }

  private scanVerifiedStored(tenantId: string, now: number): VerifiedStoredScan {
    if (this.provider.health(tenantId).status === 'split-brain') {
      return { records: [], replayCounters: new Map(), envelopeIds: new Set() }
    }

    const records: RelayStoredEnvelope[] = []
    const replayCounters = new Map<string, number>()
    const envelopeIds = new Set<string>()
    const providerRecords = [...this.provider.list(tenantId)].sort((left, right) => left.cursor - right.cursor)
    for (const record of providerRecords) {
      try {
        const envelope = this.security.validateEnvelope(record.envelope, now, 'stored')
        this.security.validateAdmissionReceipt(record.admission, envelope, record.storedAt)
        const replayKey = `${envelope.documentId}|${envelope.senderSigningKeyId}`
        const priorCounter = replayCounters.get(replayKey) ?? 0
        if (envelopeIds.has(envelope.envelopeId) || envelope.replayCounter <= priorCounter) {
          this.addQuarantine({
            quarantinedAt: now,
            providerId: this.provider.providerId,
            envelopeId: envelope.envelopeId,
            code: 'replay',
            detail: 'Duplicate or non-increasing signed relay envelope was ignored.'
          })
          continue
        }
        records.push(record)
        envelopeIds.add(envelope.envelopeId)
        replayCounters.set(replayKey, envelope.replayCounter)
      } catch (error) {
        const relayError = error instanceof RelayPolicyError
          ? error
          : new RelayPolicyError('identity-invalid', error instanceof Error ? error.message : String(error))
        this.addQuarantine({
          quarantinedAt: now,
          providerId: this.provider.providerId,
          envelopeId: record.envelope.envelopeId,
          code: relayError.code,
          detail: relayError.message
        })
      }
    }
    return { records, replayCounters, envelopeIds }
  }

  quarantine(): readonly RelayQuarantineRecord[] {
    return cloneJson(this.quarantineRecords)
  }

  health(tenantId: string, offlineQueueItems = 0, offlineQueueBytes = 0): RelayHealthReport {
    const provider = this.provider.health(tenantId)
    const status: RelayHealthReport['status'] = provider.status === 'split-brain'
      ? 'split-brain'
      : provider.status === 'offline'
        ? offlineQueueItems > 0 ? 'offline-queueing' : 'local-only'
        : offlineQueueItems > 0 || this.quarantineRecords.length > 0
          ? 'degraded'
          : 'healthy'
    return {
      status,
      provider,
      offlineQueueItems,
      offlineQueueBytes,
      quarantinedItems: this.quarantineRecords.length,
      localFunctionsAvailable: true
    }
  }

  planResync(
    tenantId: string,
    documentId: string,
    localHeads: readonly string[],
    now: number
  ): RelayResyncPlan {
    const health = this.provider.health(tenantId)
    const normalizedLocalHeads = [...new Set(localHeads)].sort()
    if (health.status === 'split-brain') {
      return {
        documentId,
        status: 'blocked-split-brain',
        localHeads: normalizedLocalHeads,
        relayHeads: [],
        latestRelayCursor: health.latestCursor,
        automatic: false,
        reason: 'Multiple relay leaders are visible; freeze sync and restore a single authoritative generation.'
      }
    }

    const providerRecords = this.provider.list(tenantId)
    const records = this.verifyStored(tenantId, now)
      .filter((record) => record.envelope.documentId === documentId)
    const relayHeadSet = new Set<string>()
    for (const record of records) {
      for (const parent of record.envelope.parentRefs) relayHeadSet.delete(parent)
      for (const head of record.envelope.headRefs) relayHeadSet.add(head)
    }
    const relayHeads = [...relayHeadSet].sort()
    const latestRelayCursor = health.latestCursor
    const documentEnvelopeIds = new Set(providerRecords
      .filter((record) => record.envelope.documentId === documentId)
      .map((record) => record.envelope.envelopeId))
    if (this.quarantineRecords.some((record) =>
      record.providerId === this.provider.providerId && documentEnvelopeIds.has(record.envelopeId))) {
      return {
        documentId,
        status: 'blocked-integrity',
        localHeads: normalizedLocalHeads,
        relayHeads,
        latestRelayCursor,
        automatic: false,
        reason: 'One or more relay records failed integrity/authenticity checks and require quarantine review.'
      }
    }
    if (sameStringSet(normalizedLocalHeads, relayHeads)) {
      return {
        documentId,
        status: 'in-sync',
        localHeads: normalizedLocalHeads,
        relayHeads,
        latestRelayCursor,
        automatic: true,
        reason: 'Local and relay heads match.'
      }
    }
    if (normalizedLocalHeads.length === 0 || isSubset(normalizedLocalHeads, relayHeads)) {
      return {
        documentId,
        status: 'pull-required',
        localHeads: normalizedLocalHeads,
        relayHeads,
        latestRelayCursor,
        automatic: true,
        reason: 'Relay has verified heads absent locally.'
      }
    }
    if (relayHeads.length === 0 || isSubset(relayHeads, normalizedLocalHeads)) {
      return {
        documentId,
        status: 'push-required',
        localHeads: normalizedLocalHeads,
        relayHeads,
        latestRelayCursor,
        automatic: true,
        reason: 'Local client has verified heads absent from relay.'
      }
    }
    return {
      documentId,
      status: 'merge-required',
      localHeads: normalizedLocalHeads,
      relayHeads,
      latestRelayCursor,
      automatic: true,
      reason: 'Concurrent verified heads require deterministic document merge.'
    }
  }

  private quotaUsage(
    envelope: RelaySyncEnvelope,
    records: readonly RelayStoredEnvelope[]
  ): RelayQuotaUsage {
    return {
      tenantObjects: records.length,
      deviceObjects: records.filter((record) =>
        record.envelope.senderDeviceId === envelope.senderDeviceId).length,
      documentObjects: records.filter((record) =>
        record.envelope.documentId === envelope.documentId).length,
      tenantStoredBytes: records.reduce((sum, record) => sum + serializedByteLength(record.envelope), 0)
    }
  }

  private addQuarantine(record: RelayQuarantineRecord): void {
    if (this.quarantineRecords.some((existing) =>
      existing.providerId === record.providerId &&
      existing.envelopeId === record.envelopeId &&
      existing.code === record.code)) return
    this.quarantineRecords.push(record)
  }

  private fromError(error: unknown): RelaySubmissionResult {
    if (error instanceof RelayPolicyError) {
      const status = error.code === 'signature-invalid' ||
        error.code === 'ciphertext-hash-mismatch' ||
        error.code === 'key-envelope-hash-mismatch' ||
        error.code === 'admission-proof-invalid'
        ? 'quarantined'
        : 'rejected'
      return this.result(status, error.code, error.message)
    }
    return this.result('rejected', 'identity-invalid', error instanceof Error ? error.message : String(error))
  }

  private result(
    status: RelaySubmissionResult['status'],
    code: RelayRejectionCode,
    message: string,
    envelopeId?: string
  ): RelaySubmissionResult {
    return { status, code, message, ...(envelopeId ? { envelopeId } : {}) }
  }
}

export class LocalFirstMockRelayClient {
  private readonly localDrafts: RelayDocumentDraft[] = []
  private readonly offlineQueue: RelayOfflineQueueItem[] = []
  private readonly deadLetters: RelaySubmissionResult[] = []
  private replayCounter = 0
  private networkAvailable = true

  constructor(
    readonly identity: RelayIdentityEnvelope,
    private capability: RelayCapabilityEnvelope,
    readonly security: DeterministicRelaySecurity,
    readonly gateway: DeterministicRelayGateway
  ) {}

  setNetworkAvailable(available: boolean): void {
    this.networkAvailable = available
  }

  setCapability(capability: RelayCapabilityEnvelope): void {
    this.capability = capability
  }

  publish(draftInput: RelayDocumentDraft | unknown, now: number): RelaySubmissionResult {
    const draft = validateRelayDraft(draftInput)
    this.localDrafts.push(cloneJson(draft))
    this.replayCounter += 1
    let envelope: RelaySyncEnvelope
    try {
      envelope = this.security.seal({
        identity: this.identity,
        capability: this.capability,
        draft,
        replayCounter: this.replayCounter,
        createdAt: now,
        expiresAt: now + 60_000
      })
    } catch (error) {
      const result: RelaySubmissionResult = {
        status: 'rejected',
        code: error instanceof RelayPolicyError ? error.code : 'identity-invalid',
        message: error instanceof Error ? error.message : String(error)
      }
      this.deadLetters.push(result)
      return result
    }

    if (!this.networkAvailable) return this.enqueue(envelope, now)

    const result = this.gateway.submit(envelope, now)
    if (result.code === 'provider-offline') return this.enqueue(envelope, now)
    if (result.status === 'rejected' || result.status === 'quarantined') this.deadLetters.push(result)
    return result
  }

  flush(now: number): readonly RelaySubmissionResult[] {
    if (!this.networkAvailable) return []
    const results: RelaySubmissionResult[] = []
    for (let index = 0; index < this.offlineQueue.length;) {
      const item = this.offlineQueue[index]
      const result = this.gateway.submit(item.envelope, now)
      results.push(result)
      if (result.code === 'provider-offline' || result.code === 'provider-split-brain') {
        index += 1
        continue
      }
      this.offlineQueue.splice(index, 1)
      if (result.status !== 'accepted') this.deadLetters.push(result)
    }
    return results
  }

  localDocuments(): readonly RelayDocumentDraft[] {
    return cloneJson(this.localDrafts)
  }

  queued(): readonly RelayOfflineQueueItem[] {
    return cloneJson(this.offlineQueue)
  }

  rejected(): readonly RelaySubmissionResult[] {
    return cloneJson(this.deadLetters)
  }

  health(): RelayHealthReport {
    const report = this.gateway.health(
      this.identity.tenantId,
      this.offlineQueue.length,
      this.offlineQueue.reduce((sum, item) => sum + serializedByteLength(item.envelope), 0)
    )
    if (!this.networkAvailable) {
      return {
        ...report,
        status: this.offlineQueue.length > 0 ? 'offline-queueing' : 'local-only'
      }
    }
    return report
  }

  private enqueue(envelope: RelaySyncEnvelope, now: number): RelaySubmissionResult {
    const measurement = measureRelayEnvelope(envelope)
    const queuedBytes = this.offlineQueue.reduce((sum, item) => sum + serializedByteLength(item.envelope), 0)
    if (this.offlineQueue.length + 1 > this.gateway.quotas.maxOfflineQueueItems ||
        queuedBytes + measurement.envelopeBytes > this.gateway.quotas.maxOfflineQueueBytes ||
        measurement.envelopeBytes > this.gateway.quotas.maxEnvelopeBytes ||
        measurement.referenceCount > this.gateway.quotas.maxReferenceCount ||
        measurement.referenceBytes > this.gateway.quotas.maxReferenceBytes) {
      const result: RelaySubmissionResult = {
        status: 'rejected',
        code: 'offline-queue-full',
        envelopeId: envelope.envelopeId,
        message: 'Offline queue quota denied the ciphertext; the local document remains available.'
      }
      this.deadLetters.push(result)
      return result
    }
    this.offlineQueue.push({ queuedAt: now, envelope: cloneJson(envelope) })
    return {
      status: 'queued',
      code: 'queued-offline',
      envelopeId: envelope.envelopeId,
      message: 'Local change applied and ciphertext queued without network activity.'
    }
  }
}
