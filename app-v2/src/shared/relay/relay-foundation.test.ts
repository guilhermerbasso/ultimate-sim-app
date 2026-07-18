import { describe, expect, it } from 'vitest'
import {
  createRelayBackup,
  createRelayRollbackManifest,
  createRelayUpgradeManifest,
  migrateRelayProvider,
  restoreRelayBackup
} from './manifests'
import {
  DeterministicMockRelayProvider,
  DeterministicRelayGateway,
  DeterministicRelaySecurity,
  LocalFirstMockRelayClient,
  type IssueMockCapabilityInput
} from './mock'
import { RelayPolicyError } from './policy'
import type {
  RelayCapabilityEnvelope,
  RelayDocumentDraft,
  RelayIdentityEnvelope,
  RelayQuotaPolicy,
  RelaySyncEnvelope
} from './contracts'

const NOW = 1_800_000_000_000
const TENANT_ID = 'tenant-alpha'
const DOCUMENT_ID = 'dashboard-doc-1'

interface Fixture {
  security: DeterministicRelaySecurity
  provider: DeterministicMockRelayProvider
  gateway: DeterministicRelayGateway
  alice: RelayIdentityEnvelope
  bob: RelayIdentityEnvelope
  aliceCapability: RelayCapabilityEnvelope
  bobCapability: RelayCapabilityEnvelope
}

function createFixture(quotas?: RelayQuotaPolicy, providerId = 'mock-provider-a'): Fixture {
  const security = new DeterministicRelaySecurity()
  const alice = security.createIdentity({
    tenantId: TENANT_ID,
    subjectId: 'alice',
    deviceId: 'alice-desktop',
    issuedAt: NOW - 10_000,
    expiresAt: NOW + 86_400_000
  })
  const bob = security.createIdentity({
    tenantId: TENANT_ID,
    subjectId: 'bob',
    deviceId: 'bob-laptop',
    issuedAt: NOW - 10_000,
    expiresAt: NOW + 86_400_000
  })
  security.registerDocument(TENANT_ID, DOCUMENT_ID, [alice.deviceId, bob.deviceId])
  const capabilityInput = {
    documentIds: [DOCUMENT_ID],
    maxDataClass: 'D3',
    consentEpoch: 1,
    issuedAt: NOW - 1_000,
    expiresAt: NOW + 60_000
  } satisfies Omit<IssueMockCapabilityInput, 'identity'>
  const aliceCapability = security.issueCapability({ ...capabilityInput, identity: alice })
  const bobCapability = security.issueCapability({ ...capabilityInput, identity: bob })
  const provider = new DeterministicMockRelayProvider(providerId)
  const gateway = new DeterministicRelayGateway(provider, security, quotas)
  return { security, provider, gateway, alice, bob, aliceCapability, bobCapability }
}

function dashboardDraft(changeId: string, parentRefs: readonly string[] = []): RelayDocumentDraft {
  return {
    tenantId: TENANT_ID,
    documentId: DOCUMENT_ID,
    documentKind: 'dashboard-layout',
    eventKind: 'document-change',
    dataClass: 'D2',
    payload: {
      name: 'Race dashboard',
      layout: { columns: 12 },
      widgets: ['fuel', 'flags'],
      revision: 1,
      changeId,
      operations: [{ op: 'replace', path: 'layout.columns', value: 12 }],
      baseHeads: [...parentRefs]
    },
    parentRefs,
    headRefs: [`head-${changeId}`]
  }
}

function seal(
  fixture: Fixture,
  identity: RelayIdentityEnvelope,
  capability: RelayCapabilityEnvelope,
  replayCounter: number,
  draft = dashboardDraft(`change-${replayCounter}`)
): RelaySyncEnvelope {
  return fixture.security.seal({
    identity,
    capability,
    draft,
    replayCounter,
    createdAt: NOW + replayCounter,
    expiresAt: NOW + 30_000
  })
}

describe('optional relay foundation deterministic mocks', () => {
  it('keeps local documents available while offline and flushes the bounded ciphertext queue later', () => {
    const fixture = createFixture()
    const client = new LocalFirstMockRelayClient(
      fixture.alice,
      fixture.aliceCapability,
      fixture.security,
      fixture.gateway
    )
    client.setNetworkAvailable(false)

    const queued = client.publish(dashboardDraft('offline-1'), NOW)

    expect(queued.code).toBe('queued-offline')
    expect(client.localDocuments()).toHaveLength(1)
    expect(client.queued()).toHaveLength(1)
    expect(fixture.provider.list(TENANT_ID)).toHaveLength(0)
    expect(client.health()).toEqual(expect.objectContaining({
      status: 'offline-queueing',
      localFunctionsAvailable: true
    }))

    client.setNetworkAvailable(true)
    expect(client.flush(NOW + 100)).toEqual([
      expect.objectContaining({ status: 'accepted', code: 'accepted' })
    ])
    expect(client.queued()).toHaveLength(0)
    expect(fixture.provider.list(TENANT_ID)).toHaveLength(1)

    fixture.security.revokeDevice(DOCUMENT_ID, fixture.alice.deviceId, 'team access revoked', NOW + 150)
    expect(client.publish(dashboardDraft('local-after-revoke'), NOW + 200)).toEqual(
      expect.objectContaining({ status: 'rejected', code: 'identity-invalid' })
    )
    expect(client.localDocuments()).toHaveLength(2)
  })

  it('quarantines relay-compromised ciphertext before local merge', () => {
    const fixture = createFixture()
    const envelope = seal(fixture, fixture.alice, fixture.aliceCapability, 1)
    const accepted = fixture.gateway.submit(envelope, NOW + 10)
    expect(accepted.status).toBe('accepted')

    fixture.provider.tamperEnvelope(TENANT_ID, accepted.cursor!, (stored) => ({
      ...stored,
      ciphertext: `${stored.ciphertext}-tampered-by-relay`
    }))

    expect(fixture.gateway.verifyStored(TENANT_ID, NOW + 20)).toHaveLength(0)
    expect(fixture.gateway.quarantine()).toEqual([
      expect.objectContaining({
        envelopeId: envelope.envelopeId,
        code: 'ciphertext-hash-mismatch'
      })
    ])
    expect(fixture.gateway.planResync(TENANT_ID, DOCUMENT_ID, [], NOW + 21)).toEqual(
      expect.objectContaining({ status: 'blocked-integrity', automatic: false })
    )
  })

  it('quarantines relay-compromised member key envelopes before unwrap', () => {
    const fixture = createFixture()
    const envelope = seal(fixture, fixture.alice, fixture.aliceCapability, 1)
    const accepted = fixture.gateway.submit(envelope, NOW + 10)
    expect(accepted.status).toBe('accepted')

    fixture.provider.tamperEnvelope(TENANT_ID, accepted.cursor!, (stored) => ({
      ...stored,
      keyEnvelopes: stored.keyEnvelopes.map((entry, index) => index === 0
        ? { ...entry, wrappedDocumentKey: `${entry.wrappedDocumentKey}-tampered` }
        : entry)
    }))

    expect(fixture.gateway.verifyStored(TENANT_ID, NOW + 20)).toHaveLength(0)
    expect(fixture.gateway.quarantine()).toEqual([
      expect.objectContaining({
        envelopeId: envelope.envelopeId,
        code: 'key-envelope-hash-mismatch'
      })
    ])
  })

  it('rejects undeclared envelope fields and prohibited data before provider storage', () => {
    const fixture = createFixture()
    const envelope = seal(fixture, fixture.alice, fixture.aliceCapability, 1)
    const undeclared = { ...envelope, plaintext: { token: 'must-not-exist' } }

    expect(fixture.gateway.submit(undeclared, NOW + 10)).toEqual(
      expect.objectContaining({ status: 'rejected', code: 'undeclared-field' })
    )
    expect(fixture.provider.list(TENANT_ID)).toHaveLength(0)

    const secretDraft = {
      ...dashboardDraft('secret'),
      dataClass: 'D4',
      payload: { ...dashboardDraft('secret').payload, streamKey: 'forbidden' }
    }
    expect(() => fixture.security.seal({
      identity: fixture.alice,
      capability: fixture.aliceCapability,
      draft: secretDraft,
      replayCounter: 2,
      createdAt: NOW,
      expiresAt: NOW + 30_000
    })).toThrowError(RelayPolicyError)

    try {
      fixture.security.seal({
        identity: fixture.alice,
        capability: fixture.aliceCapability,
        draft: { ...dashboardDraft('telemetry'), eventKind: 'telemetry-frame' },
        replayCounter: 3,
        createdAt: NOW,
        expiresAt: NOW + 30_000
      })
      throw new Error('Expected unsupported relay event kind to fail.')
    } catch (error) {
      expect(error).toMatchObject({ code: 'unsupported-event-kind' })
    }
  })

  it('rejects a repeated signed envelope as replay', () => {
    const fixture = createFixture()
    const envelope = seal(fixture, fixture.alice, fixture.aliceCapability, 1)

    expect(fixture.gateway.submit(envelope, NOW + 10).code).toBe('accepted')
    expect(fixture.gateway.submit(envelope, NOW + 11)).toEqual(
      expect.objectContaining({ status: 'rejected', code: 'replay' })
    )
    const restartedGateway = new DeterministicRelayGateway(fixture.provider, fixture.security)
    expect(restartedGateway.submit(envelope, NOW + 12)).toEqual(
      expect.objectContaining({ status: 'rejected', code: 'replay' })
    )
    expect(fixture.provider.list(TENANT_ID)).toHaveLength(1)
  })

  it('rejects stale document keys and excludes revoked members from new key envelopes', () => {
    const fixture = createFixture()
    const aliceHistory = seal(fixture, fixture.alice, fixture.aliceCapability, 1)
    expect(fixture.gateway.submit(aliceHistory, NOW + 2).code).toBe('accepted')
    const oldEnvelope = seal(fixture, fixture.alice, fixture.aliceCapability, 2)
    expect(oldEnvelope.keyEnvelopes.map((entry) => entry.recipientKeyId).sort()).toEqual([
      fixture.alice.encryptionKeyId,
      fixture.bob.encryptionKeyId
    ].sort())
    const rotation = fixture.security.rotateDocumentKey(DOCUMENT_ID, 'scheduled rotation', NOW + 5)

    expect(rotation.previousKeyEpoch).toBe(1)
    expect(rotation.keyEpoch).toBe(2)
    expect(fixture.gateway.submit(oldEnvelope, NOW + 10)).toEqual(
      expect.objectContaining({ status: 'rejected', code: 'stale-key' })
    )

    const bobPending = fixture.security.seal({
      identity: fixture.bob,
      capability: fixture.bobCapability,
      draft: dashboardDraft('bob-before-revoke'),
      replayCounter: 1,
      createdAt: NOW + 11,
      expiresAt: NOW + 30_000
    })
    const revocation = fixture.security.revokeDevice(DOCUMENT_ID, fixture.bob.deviceId, 'device compromise', NOW + 12)

    expect(revocation.revokedDeviceId).toBe(fixture.bob.deviceId)
    expect(revocation.memberKeyEnvelopes.map((entry) => entry.recipientKeyId)).toEqual([
      fixture.alice.encryptionKeyId
    ])
    expect(fixture.gateway.submit(bobPending, NOW + 13)).toEqual(
      expect.objectContaining({ status: 'rejected', code: 'signer-revoked' })
    )
    expect(fixture.gateway.verifyStored(TENANT_ID, NOW + 100_000).map((record) => record.envelope.envelopeId)).toEqual([
      aliceHistory.envelopeId
    ])
  })

  it('enforces per-tenant quota before a second ciphertext write', () => {
    const quotas: RelayQuotaPolicy = {
      maxObjectsPerTenant: 1,
      maxObjectsPerDevice: 10,
      maxObjectsPerDocument: 10,
      maxCiphertextBytesPerTenant: 1_000_000,
      maxOfflineQueueItems: 10,
      maxOfflineQueueBytes: 1_000_000
    }
    const fixture = createFixture(quotas)

    expect(fixture.gateway.submit(
      seal(fixture, fixture.alice, fixture.aliceCapability, 1),
      NOW + 10
    ).code).toBe('accepted')
    expect(fixture.gateway.submit(
      seal(fixture, fixture.alice, fixture.aliceCapability, 2),
      NOW + 11
    )).toEqual(expect.objectContaining({ status: 'rejected', code: 'quota-exceeded' }))
    expect(fixture.provider.list(TENANT_ID)).toHaveLength(1)
  })

  it('blocks writes and automatic resync during provider split brain while keeping local functions available', () => {
    const fixture = createFixture()
    const first = seal(fixture, fixture.alice, fixture.aliceCapability, 1)
    expect(fixture.gateway.submit(first, NOW + 10).code).toBe('accepted')
    fixture.provider.simulateSplitBrain()

    expect(fixture.gateway.health(TENANT_ID)).toEqual(expect.objectContaining({
      status: 'split-brain',
      localFunctionsAvailable: true
    }))
    expect(fixture.gateway.planResync(TENANT_ID, DOCUMENT_ID, [], NOW + 15)).toEqual(expect.objectContaining({
      status: 'blocked-split-brain',
      automatic: false
    }))
    expect(fixture.gateway.submit(
      seal(fixture, fixture.alice, fixture.aliceCapability, 2),
      NOW + 20
    )).toEqual(expect.objectContaining({ status: 'rejected', code: 'provider-split-brain' }))
  })

  it('restores a ciphertext-only backup and emits deterministic upgrade/rollback manifests', () => {
    const fixture = createFixture()
    expect(fixture.gateway.submit(
      seal(fixture, fixture.alice, fixture.aliceCapability, 1),
      NOW + 10
    ).code).toBe('accepted')
    expect(fixture.gateway.submit(
      seal(fixture, fixture.alice, fixture.aliceCapability, 2),
      NOW + 11
    ).code).toBe('accepted')

    const backup = createRelayBackup(fixture.provider, TENANT_ID, NOW + 20)
    const before = fixture.provider.list(TENANT_ID)
    expect(() => restoreRelayBackup(new DeterministicMockRelayProvider('tamper-target'), {
      ...backup,
      manifest: { ...backup.manifest, backupId: 'tampered-backup-id' }
    })).toThrowError(RelayPolicyError)
    fixture.provider.clearTenant(TENANT_ID)
    const restored = restoreRelayBackup(fixture.provider, backup)

    expect(restored.restored).toBe(2)
    expect(fixture.provider.list(TENANT_ID)).toEqual(before)
    expect(backup.manifest).toEqual(expect.objectContaining({
      includesPlaintext: false,
      includesPrivateKeys: false,
      networkRequired: false
    }))
    expect(backup.manifest.recordsDigest).toMatch(/^[0-9a-f]{64}$/)

    const rollback = createRelayRollbackManifest({
      createdAt: NOW + 21,
      targetAppVersion: '2.53.1',
      restoreBackupId: backup.manifest.backupId,
      expectedRecordsDigest: backup.manifest.recordsDigest,
      reason: 'failed health gate'
    })
    const upgrade = createRelayUpgradeManifest({
      createdAt: NOW + 22,
      fromAppVersion: '2.53.1',
      toAppVersion: '2.54.0',
      requiredBackupId: backup.manifest.backupId,
      rollbackManifestId: rollback.rollbackId
    })
    expect(upgrade.networkRequired).toBe(false)
    expect(upgrade.requiredBackupId).toBe(backup.manifest.backupId)
    expect(rollback.expectedRecordsDigest).toBe(backup.manifest.recordsDigest)
  })

  it('migrates provider-neutral ciphertext without mutating the source', () => {
    const fixture = createFixture(undefined, 'source-provider')
    expect(fixture.gateway.submit(
      seal(fixture, fixture.alice, fixture.aliceCapability, 1),
      NOW + 10
    ).code).toBe('accepted')
    const sourceBefore = fixture.provider.list(TENANT_ID)
    const destination = new DeterministicMockRelayProvider('replacement-provider')

    const migration = migrateRelayProvider(fixture.provider, destination, TENANT_ID, NOW + 20)

    expect(migration).toEqual(expect.objectContaining({
      sourceProviderId: 'source-provider',
      destinationProviderId: 'replacement-provider',
      objectCount: 1,
      verified: true,
      networkRequired: false
    }))
    expect(fixture.provider.list(TENANT_ID)).toEqual(sourceBefore)
    expect(destination.list(TENANT_ID)).toEqual(sourceBefore)
  })
})
