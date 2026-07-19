export const RELAY_SCHEMA_VERSION = 1 as const
export const RELAY_PROVIDER_CONTRACT = 'usa.relay.provider/v1' as const
export const RELAY_BACKUP_FORMAT = 'usa.relay.backup/v1' as const
export const RELAY_UPGRADE_FORMAT = 'usa.relay.upgrade/v1' as const
export const RELAY_ROLLBACK_FORMAT = 'usa.relay.rollback/v1' as const
export const RELAY_MIGRATION_FORMAT = 'usa.relay.migration/v1' as const

export const RELAY_DATA_CLASSES = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5'] as const
export type RelayDataClass = (typeof RELAY_DATA_CLASSES)[number]

export const RELAY_DOCUMENT_KINDS = [
  'dashboard-layout',
  'race-note',
  'accessibility-profile',
  'raceops-blueprint',
  'shared-preferences'
] as const
export type RelayDocumentKind = (typeof RELAY_DOCUMENT_KINDS)[number]

export const RELAY_EVENT_KINDS = [
  'document-change',
  'document-snapshot',
  'membership-record',
  'key-status-record',
  'rotation-certificate',
  'resync-marker'
] as const
export type RelayEventKind = (typeof RELAY_EVENT_KINDS)[number]

export const RELAY_CAPABILITIES = [
  'document:read',
  'document:append',
  'document:snapshot',
  'membership:read',
  'membership:admin',
  'keys:rotate',
  'recovery:restore',
  'provider:migrate'
] as const
export type RelayCapability = (typeof RELAY_CAPABILITIES)[number]

export const RELAY_CRYPTO_PROFILES = [
  'xchacha20-poly1305+ed25519+x25519-hkdf-sha256',
  'deterministic-test-only'
] as const
export type RelayCryptoProfile = (typeof RELAY_CRYPTO_PROFILES)[number]

export interface RelayIdentityEnvelope {
  schemaVersion: typeof RELAY_SCHEMA_VERSION
  tenantId: string
  subjectId: string
  deviceId: string
  identityEpoch: number
  signingKeyId: string
  signingPublicKey: string
  encryptionKeyId: string
  encryptionPublicKey: string
  issuedAt: number
  expiresAt: number
  status: 'active' | 'revoked'
  issuerKeyId: string
  signature: string
}

export interface RelayCapabilityEnvelope {
  schemaVersion: typeof RELAY_SCHEMA_VERSION
  grantId: string
  tenantId: string
  subjectId: string
  deviceId: string
  documentIds: readonly string[]
  documentKinds: readonly RelayDocumentKind[]
  eventKinds: readonly RelayEventKind[]
  capabilities: readonly RelayCapability[]
  maxDataClass: RelayDataClass
  consentEpoch: number
  membershipEpoch: number
  issuedAt: number
  expiresAt: number
  issuerKeyId: string
  signature: string
}

export interface RelayKeyEnvelope {
  schemaVersion: typeof RELAY_SCHEMA_VERSION
  documentId: string
  keyEpoch: number
  recipientKeyId: string
  wrappingAlgorithm: 'x25519-hkdf-sha256' | 'deterministic-test-only'
  wrappedDocumentKey: string
}

export interface RelayCanonicalTuple {
  schemaVersion: typeof RELAY_SCHEMA_VERSION
  providerContract: typeof RELAY_PROVIDER_CONTRACT
  tenantId: string
  documentId: string
  documentKind: RelayDocumentKind
  eventKind: RelayEventKind
  dataClass: RelayDataClass
  membershipEpoch: number
  keyEpoch: number
  senderDeviceId: string
  senderSigningKeyId: string
  replayCounter: number
  parentRefs: readonly string[]
  headRefs: readonly string[]
  ciphertextHash: string
  keyEnvelopesHash: string
  cryptoProfile: RelayCryptoProfile
  createdAt: number
  expiresAt: number
}

export interface RelaySyncEnvelope extends RelayCanonicalTuple {
  envelopeId: string
  identity: RelayIdentityEnvelope
  capability: RelayCapabilityEnvelope
  keyEnvelopes: readonly RelayKeyEnvelope[]
  ciphertext: string
  ciphertextBytes: number
  signature: string
}

export interface RelayAdmissionPolicyMetadata {
  identityEpoch: number
  capabilityGrantId: string
  capabilityDigest: string
  membershipEpoch: number
  keyEpoch: number
  documentConsentEpoch: number
  capabilityConsentEpoch: number
  requiredCapability: RelayCapability
  replayCounter: number
  priorReplayCounter: number
  identityActive: true
  memberAtAdmission: true
  consentGrantedAtAdmission: boolean
}

export interface RelayAdmissionQuotaMetadata {
  limits: RelayQuotaPolicy
  limitsDigest: string
  usageBefore: RelayQuotaUsage
  usageAfter: RelayQuotaUsage
  envelopeBytes: number
  referenceCount: number
  referenceBytes: number
}

export interface RelayAdmissionReceipt {
  schemaVersion: typeof RELAY_SCHEMA_VERSION
  providerContract: typeof RELAY_PROVIDER_CONTRACT
  receiptId: string
  envelopeId: string
  envelopeDigest: string
  tenantId: string
  documentId: string
  senderDeviceId: string
  senderSigningKeyId: string
  admittedAt: number
  policy: RelayAdmissionPolicyMetadata
  quota: RelayAdmissionQuotaMetadata
  issuerKeyId: string
  signature: string
}

export interface RelayDocumentDraft {
  tenantId: string
  documentId: string
  documentKind: RelayDocumentKind
  eventKind: RelayEventKind
  dataClass: RelayDataClass
  payload: Readonly<Record<string, unknown>>
  parentRefs: readonly string[]
  headRefs: readonly string[]
}

export type RelayRejectionCode =
  | 'accepted'
  | 'queued-offline'
  | 'offline-queue-full'
  | 'undeclared-field'
  | 'unsupported-document-kind'
  | 'unsupported-event-kind'
  | 'data-class-denied'
  | 'consent-required'
  | 'capability-denied'
  | 'identity-invalid'
  | 'signer-revoked'
  | 'signature-invalid'
  | 'ciphertext-hash-mismatch'
  | 'key-envelope-hash-mismatch'
  | 'replay'
  | 'stale-key'
  | 'stale-membership'
  | 'quota-exceeded'
  | 'admission-proof-invalid'
  | 'tenant-mismatch'
  | 'provider-offline'
  | 'provider-split-brain'
  | 'backup-integrity-failed'
  | 'restore-conflict'

export interface RelaySubmissionResult {
  status: 'accepted' | 'queued' | 'rejected' | 'quarantined'
  code: RelayRejectionCode
  envelopeId?: string
  cursor?: number
  message: string
}

export interface RelayStoredEnvelope {
  cursor: number
  storedAt: number
  envelope: RelaySyncEnvelope
  admission: RelayAdmissionReceipt
}

export interface RelayProviderListingRecord {
  cursor: number
  storedAt: number
  envelope: unknown
  admission?: unknown
}

export interface RelayProviderHealth {
  providerId: string
  contractVersion: typeof RELAY_PROVIDER_CONTRACT
  status: 'healthy' | 'degraded' | 'offline' | 'split-brain'
  generation: number
  leaderIds: readonly string[]
  latestCursor: number
  detail: string
}

export interface RelayProviderSnapshot {
  format: typeof RELAY_BACKUP_FORMAT
  tenantId: string
  sourceProviderId: string
  sourceGeneration: number
  createdAt: number
  records: readonly RelayStoredEnvelope[]
  recordsDigest: string
}

export interface RelayProviderImportResult {
  imported: number
  latestCursor: number
  recordsDigest: string
}

export interface RelayProviderAdapter {
  readonly providerId: string
  readonly contractVersion: typeof RELAY_PROVIDER_CONTRACT
  write(
    envelope: RelaySyncEnvelope,
    admission: RelayAdmissionReceipt,
    storedAt: number
  ): RelayStoredEnvelope
  list(tenantId: string): readonly RelayProviderListingRecord[]
  health(tenantId: string): RelayProviderHealth
  exportSnapshot(tenantId: string, createdAt: number): RelayProviderSnapshot
  importSnapshot(snapshot: RelayProviderSnapshot): RelayProviderImportResult
}

export interface RelayQuotaPolicy {
  maxObjectsPerTenant: number
  maxObjectsPerDevice: number
  maxObjectsPerDocument: number
  maxStoredBytesPerTenant: number
  maxEnvelopeBytes: number
  maxReferenceCount: number
  maxReferenceBytes: number
  maxOfflineQueueItems: number
  maxOfflineQueueBytes: number
}

export interface RelayQuotaUsage {
  tenantObjects: number
  deviceObjects: number
  documentObjects: number
  tenantStoredBytes: number
}

export interface RelayOfflineQueueItem {
  queuedAt: number
  envelope: RelaySyncEnvelope
}

export interface RelayQuarantineRecord {
  quarantinedAt: number
  providerId: string
  envelopeId: string
  code: RelayRejectionCode
  detail: string
}

export interface RelayHealthReport {
  status: 'local-only' | 'healthy' | 'degraded' | 'offline-queueing' | 'split-brain'
  provider: RelayProviderHealth
  offlineQueueItems: number
  offlineQueueBytes: number
  quarantinedItems: number
  localFunctionsAvailable: true
}

export interface RelayResyncPlan {
  documentId: string
  status:
    | 'in-sync'
    | 'pull-required'
    | 'push-required'
    | 'merge-required'
    | 'blocked-integrity'
    | 'blocked-split-brain'
  localHeads: readonly string[]
  relayHeads: readonly string[]
  latestRelayCursor: number
  automatic: boolean
  reason: string
}

export interface RelayRotationCertificate {
  schemaVersion: typeof RELAY_SCHEMA_VERSION
  certificateId: string
  tenantId: string
  documentId: string
  reason: string
  revokedDeviceId: string | null
  revokedSigningKeyId: string | null
  previousMembershipEpoch: number
  membershipEpoch: number
  previousKeyEpoch: number
  keyEpoch: number
  issuedAt: number
  issuerKeyId: string
  signature: string
  memberKeyEnvelopes: readonly RelayKeyEnvelope[]
}

export interface RelayBackupManifest {
  schemaVersion: typeof RELAY_SCHEMA_VERSION
  manifestKind: 'backup'
  format: typeof RELAY_BACKUP_FORMAT
  backupId: string
  tenantId: string
  createdAt: number
  sourceProviderId: string
  sourceGeneration: number
  objectCount: number
  ciphertextBytes: number
  firstCursor: number
  lastCursor: number
  documentIds: readonly string[]
  recordsDigest: string
  includesPlaintext: false
  includesPrivateKeys: false
  networkRequired: false
}

export interface RelayBackupBundle {
  manifest: RelayBackupManifest
  snapshot: RelayProviderSnapshot
}

export interface RelayUpgradeManifest {
  schemaVersion: typeof RELAY_SCHEMA_VERSION
  manifestKind: 'upgrade'
  format: typeof RELAY_UPGRADE_FORMAT
  upgradeId: string
  createdAt: number
  fromAppVersion: string
  toAppVersion: string
  fromProviderContract: typeof RELAY_PROVIDER_CONTRACT
  toProviderContract: typeof RELAY_PROVIDER_CONTRACT
  requiredBackupId: string
  rollbackManifestId: string
  preflightChecks: readonly string[]
  steps: readonly string[]
  networkRequired: false
}

export interface RelayRollbackManifest {
  schemaVersion: typeof RELAY_SCHEMA_VERSION
  manifestKind: 'rollback'
  format: typeof RELAY_ROLLBACK_FORMAT
  rollbackId: string
  createdAt: number
  targetAppVersion: string
  targetProviderContract: typeof RELAY_PROVIDER_CONTRACT
  restoreBackupId: string
  expectedRecordsDigest: string
  reason: string
  steps: readonly string[]
  networkRequired: false
}

export interface RelayMigrationManifest {
  schemaVersion: typeof RELAY_SCHEMA_VERSION
  manifestKind: 'provider-migration'
  format: typeof RELAY_MIGRATION_FORMAT
  migrationId: string
  tenantId: string
  createdAt: number
  sourceProviderId: string
  destinationProviderId: string
  backupId: string
  objectCount: number
  recordsDigest: string
  verified: boolean
  networkRequired: false
}

export interface RelayRestoreResult {
  restored: number
  latestCursor: number
  recordsDigest: string
}
