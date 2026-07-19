import {
  RELAY_BACKUP_FORMAT,
  RELAY_MIGRATION_FORMAT,
  RELAY_PROVIDER_CONTRACT,
  RELAY_ROLLBACK_FORMAT,
  RELAY_SCHEMA_VERSION,
  RELAY_UPGRADE_FORMAT,
  type RelayBackupBundle,
  type RelayBackupManifest,
  type RelayMigrationManifest,
  type RelayProviderAdapter,
  type RelayRestoreResult,
  type RelayRollbackManifest,
  type RelayUpgradeManifest
} from './contracts'
import { RelayPolicyError } from './policy'
import { deterministicDigest, stableSerialize } from './mock'

export interface CreateUpgradeManifestInput {
  createdAt: number
  fromAppVersion: string
  toAppVersion: string
  requiredBackupId: string
  rollbackManifestId: string
}

export interface CreateRollbackManifestInput {
  createdAt: number
  targetAppVersion: string
  restoreBackupId: string
  expectedRecordsDigest: string
  reason: string
}

export function createRelayBackup(
  provider: RelayProviderAdapter,
  tenantId: string,
  createdAt: number
): RelayBackupBundle {
  const snapshot = provider.exportSnapshot(tenantId, createdAt)
  const records = snapshot.records
  const documentIds = [...new Set(records.map((record) => record.envelope.documentId))].sort()
  const manifest: RelayBackupManifest = {
    schemaVersion: RELAY_SCHEMA_VERSION,
    manifestKind: 'backup',
    format: RELAY_BACKUP_FORMAT,
    backupId: `backup-${deterministicDigest([
      tenantId,
      snapshot.recordsDigest,
      createdAt
    ].join('|')).slice(0, 28)}`,
    tenantId,
    createdAt,
    sourceProviderId: provider.providerId,
    sourceGeneration: snapshot.sourceGeneration,
    objectCount: records.length,
    ciphertextBytes: records.reduce((sum, record) => sum + record.envelope.ciphertextBytes, 0),
    firstCursor: records[0]?.cursor ?? 0,
    lastCursor: records.at(-1)?.cursor ?? 0,
    documentIds,
    recordsDigest: snapshot.recordsDigest,
    includesPlaintext: false,
    includesPrivateKeys: false,
    networkRequired: false
  }
  return { manifest, snapshot }
}

export function restoreRelayBackup(
  provider: RelayProviderAdapter,
  bundle: RelayBackupBundle
): RelayRestoreResult {
  const { manifest, snapshot } = bundle
  const calculatedDigest = deterministicDigest(stableSerialize(snapshot.records))
  const calculatedBytes = snapshot.records.reduce((sum, record) => sum + record.envelope.ciphertextBytes, 0)
  const calculatedDocuments = [...new Set(snapshot.records.map((record) => record.envelope.documentId))].sort()
  const calculatedBackupId = `backup-${deterministicDigest([
    manifest.tenantId,
    calculatedDigest,
    manifest.createdAt
  ].join('|')).slice(0, 28)}`

  if (manifest.schemaVersion !== RELAY_SCHEMA_VERSION ||
      manifest.manifestKind !== 'backup' ||
      manifest.format !== RELAY_BACKUP_FORMAT ||
      snapshot.format !== RELAY_BACKUP_FORMAT ||
      manifest.tenantId !== snapshot.tenantId ||
      manifest.createdAt !== snapshot.createdAt ||
      manifest.objectCount !== snapshot.records.length ||
      manifest.ciphertextBytes !== calculatedBytes ||
      manifest.firstCursor !== (snapshot.records[0]?.cursor ?? 0) ||
      manifest.lastCursor !== (snapshot.records.at(-1)?.cursor ?? 0) ||
      manifest.sourceProviderId !== snapshot.sourceProviderId ||
      manifest.sourceGeneration !== snapshot.sourceGeneration ||
      manifest.backupId !== calculatedBackupId ||
      manifest.recordsDigest !== calculatedDigest ||
      snapshot.recordsDigest !== calculatedDigest ||
      !sameArray(manifest.documentIds, calculatedDocuments) ||
      manifest.includesPlaintext !== false ||
      manifest.includesPrivateKeys !== false ||
      manifest.networkRequired !== false) {
    throw new RelayPolicyError('backup-integrity-failed', 'Backup manifest/snapshot integrity validation failed.')
  }

  const result = provider.importSnapshot(snapshot)
  if (result.recordsDigest !== manifest.recordsDigest) {
    throw new RelayPolicyError('backup-integrity-failed', 'Restored provider digest differs from the backup manifest.')
  }
  return {
    restored: result.imported,
    latestCursor: result.latestCursor,
    recordsDigest: result.recordsDigest
  }
}

export function createRelayUpgradeManifest(input: CreateUpgradeManifestInput): RelayUpgradeManifest {
  const upgradeId = `upgrade-${deterministicDigest([
    input.fromAppVersion,
    input.toAppVersion,
    input.requiredBackupId,
    input.createdAt
  ].join('|')).slice(0, 28)}`
  return {
    schemaVersion: RELAY_SCHEMA_VERSION,
    manifestKind: 'upgrade',
    format: RELAY_UPGRADE_FORMAT,
    upgradeId,
    createdAt: input.createdAt,
    fromAppVersion: input.fromAppVersion,
    toAppVersion: input.toAppVersion,
    fromProviderContract: RELAY_PROVIDER_CONTRACT,
    toProviderContract: RELAY_PROVIDER_CONTRACT,
    requiredBackupId: input.requiredBackupId,
    rollbackManifestId: input.rollbackManifestId,
    preflightChecks: [
      'Relay writes are paused and the offline queue remains local.',
      'Provider health has exactly one writer generation.',
      'Required ciphertext-only backup digest is verified.',
      'No private key, credential, plaintext, D4, or D5 data is present.'
    ],
    steps: [
      'Record current application/provider contract versions.',
      'Apply the provider-neutral schema migration in an isolated copy.',
      'Verify object count, cursor range, ciphertext digests, and health.',
      'Resume writes only after the rollback checkpoint is retained.'
    ],
    networkRequired: false
  }
}

export function createRelayRollbackManifest(input: CreateRollbackManifestInput): RelayRollbackManifest {
  return {
    schemaVersion: RELAY_SCHEMA_VERSION,
    manifestKind: 'rollback',
    format: RELAY_ROLLBACK_FORMAT,
    rollbackId: `rollback-${deterministicDigest([
      input.targetAppVersion,
      input.restoreBackupId,
      input.expectedRecordsDigest,
      input.createdAt
    ].join('|')).slice(0, 28)}`,
    createdAt: input.createdAt,
    targetAppVersion: input.targetAppVersion,
    targetProviderContract: RELAY_PROVIDER_CONTRACT,
    restoreBackupId: input.restoreBackupId,
    expectedRecordsDigest: input.expectedRecordsDigest,
    reason: input.reason,
    steps: [
      'Pause relay writes without pausing local document editing.',
      'Restore the referenced provider-neutral ciphertext backup.',
      'Verify digest, object count, cursor range, key epochs, and a single writer.',
      'Run resync planning before any queued ciphertext is released.'
    ],
    networkRequired: false
  }
}

export function migrateRelayProvider(
  source: RelayProviderAdapter,
  destination: RelayProviderAdapter,
  tenantId: string,
  createdAt: number
): RelayMigrationManifest {
  if (source.contractVersion !== RELAY_PROVIDER_CONTRACT ||
      destination.contractVersion !== RELAY_PROVIDER_CONTRACT) {
    throw new RelayPolicyError('restore-conflict', 'Source and destination must implement relay provider contract v1.')
  }
  const sourceHealth = source.health(tenantId)
  const destinationHealth = destination.health(tenantId)
  if (sourceHealth.status !== 'healthy') {
    throw new RelayPolicyError(
      sourceHealth.status === 'split-brain' ? 'provider-split-brain' : 'provider-offline',
      'Provider migration requires a healthy single-writer source.'
    )
  }
  if (destinationHealth.status !== 'healthy') {
    throw new RelayPolicyError(
      destinationHealth.status === 'split-brain' ? 'provider-split-brain' : 'provider-offline',
      'Provider migration requires a healthy single-writer destination.'
    )
  }

  const bundle = createRelayBackup(source, tenantId, createdAt)
  const restored = restoreRelayBackup(destination, bundle)
  const destinationSnapshot = destination.exportSnapshot(tenantId, createdAt)
  const verified = restored.recordsDigest === bundle.manifest.recordsDigest &&
    destinationSnapshot.recordsDigest === bundle.manifest.recordsDigest &&
    destinationSnapshot.records.length === bundle.manifest.objectCount

  if (!verified) throw new RelayPolicyError('backup-integrity-failed', 'Destination verification failed after migration.')

  return {
    schemaVersion: RELAY_SCHEMA_VERSION,
    manifestKind: 'provider-migration',
    format: RELAY_MIGRATION_FORMAT,
    migrationId: `migration-${deterministicDigest([
      source.providerId,
      destination.providerId,
      tenantId,
      bundle.manifest.recordsDigest,
      createdAt
    ].join('|')).slice(0, 28)}`,
    tenantId,
    createdAt,
    sourceProviderId: source.providerId,
    destinationProviderId: destination.providerId,
    backupId: bundle.manifest.backupId,
    objectCount: bundle.manifest.objectCount,
    recordsDigest: bundle.manifest.recordsDigest,
    verified,
    networkRequired: false
  }
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index])
}
