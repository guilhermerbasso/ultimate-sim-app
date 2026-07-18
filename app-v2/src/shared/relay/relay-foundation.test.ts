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
  serializedByteLength,
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
const OTHER_TENANT_ID = 'tenant-beta'
const DOCUMENT_ID = 'dashboard-doc-1'
const OTHER_DOCUMENT_ID = 'dashboard-doc-2'

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

function dashboardDraftFor(
  documentId: string,
  changeId: string,
  parentRefs: readonly string[] = []
): RelayDocumentDraft {
  return {
    tenantId: TENANT_ID,
    documentId,
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

function dashboardDraft(changeId: string, parentRefs: readonly string[] = []): RelayDocumentDraft {
  return dashboardDraftFor(DOCUMENT_ID, changeId, parentRefs)
}

function raceNoteDraft(changeId: string): RelayDocumentDraft {
  return {
    tenantId: TENANT_ID,
    documentId: DOCUMENT_ID,
    documentKind: 'race-note',
    eventKind: 'document-change',
    dataClass: 'D3',
    payload: {
      authorAlias: 'race-engineer',
      body: 'Box this lap.',
      revision: 1,
      tags: ['strategy'],
      title: 'Pit note',
      changeId,
      operations: [{ op: 'replace', path: 'body', value: 'Box this lap.' }],
      baseHeads: []
    },
    parentRefs: [],
    headRefs: [`head-${changeId}`]
  }
}

function resyncMarkerDraft(headRef: string): RelayDocumentDraft {
  return {
    tenantId: TENANT_ID,
    documentId: DOCUMENT_ID,
    documentKind: 'dashboard-layout',
    eventKind: 'resync-marker',
    dataClass: 'D2',
    payload: {
      cursor: 0,
      heads: [headRef],
      providerGeneration: 1
    },
    parentRefs: [],
    headRefs: [headRef]
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

    fixture.security.revokeDevice(fixture.alice.deviceId, 'team access revoked', NOW + 150)
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

  it('stores authenticated admission-time policy and quota metadata with every accepted envelope', () => {
    const fixture = createFixture()
    const envelope = seal(fixture, fixture.alice, fixture.aliceCapability, 1)

    expect(fixture.gateway.submit(envelope, NOW + 10).code).toBe('accepted')
    const [record] = fixture.provider.list(TENANT_ID)

    expect(record.admission).toEqual(expect.objectContaining({
      envelopeId: envelope.envelopeId,
      admittedAt: NOW + 10,
      policy: expect.objectContaining({
        identityEpoch: fixture.alice.identityEpoch,
        capabilityGrantId: fixture.aliceCapability.grantId,
        membershipEpoch: 1,
        keyEpoch: 1,
        documentConsentEpoch: 1,
        capabilityConsentEpoch: fixture.aliceCapability.consentEpoch,
        requiredCapability: 'document:append',
        replayCounter: 1,
        priorReplayCounter: 0,
        identityActive: true,
        memberAtAdmission: true,
        consentGrantedAtAdmission: true
      }),
      quota: expect.objectContaining({
        usageBefore: {
          tenantObjects: 0,
          deviceObjects: 0,
          documentObjects: 0,
          tenantStoredBytes: 0
        },
        usageAfter: {
          tenantObjects: 1,
          deviceObjects: 1,
          documentObjects: 1,
          tenantStoredBytes: serializedByteLength(envelope)
        },
        envelopeBytes: serializedByteLength(envelope)
      })
    }))
    expect(fixture.gateway.verifyStored(TENANT_ID, NOW + 20)).toHaveLength(1)

    fixture.provider.clearTenant(TENANT_ID)
    fixture.provider.injectUntrustedEnvelope(envelope, record.storedAt, {
      ...record.admission,
      signature: `${record.admission.signature}-forged`
    })
    expect(fixture.gateway.verifyStored(TENANT_ID, NOW + 21)).toHaveLength(0)
    expect(fixture.gateway.quarantine()).toContainEqual(expect.objectContaining({
      envelopeId: envelope.envelopeId,
      code: 'admission-proof-invalid'
    }))
  })

  it('quarantines tenant A admitted records substituted into the provider listing for tenant B', () => {
    const fixture = createFixture()
    const envelope = seal(fixture, fixture.alice, fixture.aliceCapability, 1)
    const admissionMismatchEnvelope = seal(fixture, fixture.alice, fixture.aliceCapability, 2)
    expect(fixture.gateway.submit(envelope, NOW + 10).code).toBe('accepted')
    expect(fixture.gateway.submit(admissionMismatchEnvelope, NOW + 11).code).toBe('accepted')
    const [admitted, admittedForMismatch] = fixture.provider.list(TENANT_ID)

    fixture.provider.injectUntrustedListingRecord(OTHER_TENANT_ID, admitted)
    fixture.provider.injectUntrustedListingRecord(OTHER_TENANT_ID, {
      ...admittedForMismatch,
      envelope: { ...admittedForMismatch.envelope, tenantId: OTHER_TENANT_ID }
    })
    expect(fixture.provider.list(OTHER_TENANT_ID)).toEqual([
      expect.objectContaining({
        envelope: expect.objectContaining({ tenantId: TENANT_ID }),
        admission: expect.objectContaining({ tenantId: TENANT_ID })
      }),
      expect.objectContaining({
        envelope: expect.objectContaining({ tenantId: OTHER_TENANT_ID }),
        admission: expect.objectContaining({ tenantId: TENANT_ID })
      })
    ])

    expect(fixture.gateway.verifyStored(OTHER_TENANT_ID, NOW + 20)).toHaveLength(0)
    expect(fixture.gateway.quarantine()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        envelopeId: envelope.envelopeId,
        code: 'tenant-mismatch'
      }),
      expect.objectContaining({
        envelopeId: admissionMismatchEnvelope.envelopeId,
        code: 'tenant-mismatch'
      })
    ]))
    expect(fixture.gateway.planResync(
      OTHER_TENANT_ID,
      DOCUMENT_ID,
      [],
      NOW + 21
    )).toEqual(expect.objectContaining({ status: 'blocked-integrity', automatic: false }))
    expect(fixture.gateway.verifyStored(TENANT_ID, NOW + 22)).toHaveLength(2)
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

  it('requires write authority for resync markers and never mutates document heads from them', () => {
    const fixture = createFixture()
    const readOnlyCapability = fixture.security.issueCapability({
      identity: fixture.alice,
      documentIds: [DOCUMENT_ID],
      documentKinds: ['dashboard-layout'],
      eventKinds: ['resync-marker'],
      capabilities: ['document:read'],
      maxDataClass: 'D2',
      issuedAt: NOW - 500,
      expiresAt: NOW + 60_000
    })
    const readOnlyMarker = fixture.security.seal({
      identity: fixture.alice,
      capability: readOnlyCapability,
      draft: resyncMarkerDraft('forged-head'),
      replayCounter: 1,
      createdAt: NOW + 1,
      expiresAt: NOW + 30_000
    })

    expect(fixture.gateway.submit(readOnlyMarker, NOW + 10)).toEqual(
      expect.objectContaining({ status: 'rejected', code: 'capability-denied' })
    )
    expect(fixture.provider.list(TENANT_ID)).toHaveLength(0)
    expect(fixture.security.currentHeads(DOCUMENT_ID)).toEqual([])

    const appendCapability = fixture.security.issueCapability({
      identity: fixture.alice,
      documentIds: [DOCUMENT_ID],
      documentKinds: ['dashboard-layout'],
      eventKinds: ['resync-marker'],
      capabilities: ['document:append'],
      maxDataClass: 'D2',
      issuedAt: NOW - 400,
      expiresAt: NOW + 60_000
    })
    const appendMarker = fixture.security.seal({
      identity: fixture.alice,
      capability: appendCapability,
      draft: resyncMarkerDraft('metadata-only-head'),
      replayCounter: 2,
      createdAt: NOW + 2,
      expiresAt: NOW + 30_000
    })

    expect(fixture.gateway.submit(appendMarker, NOW + 11).code).toBe('accepted')
    expect(fixture.security.currentHeads(DOCUMENT_ID)).toEqual([])
  })

  it('uses only verified replay watermarks and verifies duplicate signed envelopes once', () => {
    const fixture = createFixture()
    const envelope = seal(fixture, fixture.alice, fixture.aliceCapability, 1)
    fixture.provider.injectUntrustedEnvelope({ ...envelope, replayCounter: 999 }, NOW + 5)

    const accepted = fixture.gateway.submit(envelope, NOW + 10)
    expect(accepted.code).toBe('accepted')
    const admitted = fixture.provider.list(TENANT_ID)
      .find((record) => record.cursor === accepted.cursor)!
    fixture.provider.injectUntrustedEnvelope(envelope, admitted.storedAt, admitted.admission)
    expect(fixture.gateway.verifyStored(TENANT_ID, NOW + 12).map((record) => record.envelope.envelopeId)).toEqual([
      envelope.envelopeId
    ])
    expect(fixture.gateway.quarantine()).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'signature-invalid' }),
      expect.objectContaining({ code: 'replay' })
    ]))
    expect(fixture.gateway.submit(envelope, NOW + 11)).toEqual(
      expect.objectContaining({ status: 'rejected', code: 'replay' })
    )
    const restartedGateway = new DeterministicRelayGateway(fixture.provider, fixture.security)
    expect(restartedGateway.submit(envelope, NOW + 13)).toEqual(
      expect.objectContaining({ status: 'rejected', code: 'replay' })
    )
    expect(fixture.provider.list(TENANT_ID)).toHaveLength(3)
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
    const revocation = fixture.security.revokeDocumentMember(
      DOCUMENT_ID,
      fixture.bob.deviceId,
      'removed from document',
      NOW + 12
    )

    expect(revocation.revokedDeviceId).toBe(fixture.bob.deviceId)
    expect(revocation.memberKeyEnvelopes.map((entry) => entry.recipientKeyId)).toEqual([
      fixture.alice.encryptionKeyId
    ])
    expect(fixture.gateway.submit(bobPending, NOW + 13)).toEqual(
      expect.objectContaining({ status: 'rejected', code: 'capability-denied' })
    )
    expect(fixture.gateway.verifyStored(TENANT_ID, NOW + 100_000).map((record) => record.envelope.envelopeId)).toEqual([
      aliceHistory.envelopeId
    ])
  })

  it('keeps document revocation scoped and removes globally revoked devices from every document', () => {
    const fixture = createFixture()
    fixture.security.registerDocument(
      TENANT_ID,
      OTHER_DOCUMENT_ID,
      [fixture.alice.deviceId, fixture.bob.deviceId]
    )
    const bobOtherCapability = fixture.security.issueCapability({
      identity: fixture.bob,
      documentIds: [OTHER_DOCUMENT_ID],
      maxDataClass: 'D2',
      issuedAt: NOW - 500,
      expiresAt: NOW + 60_000
    })

    const scoped = fixture.security.revokeDocumentMember(
      DOCUMENT_ID,
      fixture.bob.deviceId,
      'removed from first document',
      NOW + 1
    )
    expect(scoped.memberKeyEnvelopes.map((entry) => entry.recipientKeyId)).toEqual([
      fixture.alice.encryptionKeyId
    ])

    const bobHistory = fixture.security.seal({
      identity: fixture.bob,
      capability: bobOtherCapability,
      draft: dashboardDraftFor(OTHER_DOCUMENT_ID, 'bob-other-history'),
      replayCounter: 1,
      createdAt: NOW + 2,
      expiresAt: NOW + 30_000
    })
    expect(fixture.gateway.submit(bobHistory, NOW + 3).code).toBe('accepted')
    const bobPending = fixture.security.seal({
      identity: fixture.bob,
      capability: bobOtherCapability,
      draft: dashboardDraftFor(OTHER_DOCUMENT_ID, 'bob-other-pending'),
      replayCounter: 2,
      createdAt: NOW + 4,
      expiresAt: NOW + 30_000
    })

    const globalCertificates = fixture.security.revokeDevice(
      fixture.bob.deviceId,
      'device compromise',
      NOW + 5
    )
    expect(globalCertificates.map((certificate) => certificate.documentId)).toEqual([
      OTHER_DOCUMENT_ID
    ])
    expect(globalCertificates[0].memberKeyEnvelopes.map((entry) => entry.recipientKeyId)).toEqual([
      fixture.alice.encryptionKeyId
    ])
    expect(fixture.gateway.submit(bobPending, NOW + 6)).toEqual(
      expect.objectContaining({ status: 'rejected', code: 'signer-revoked' })
    )
    expect(fixture.gateway.verifyStored(TENANT_ID, NOW + 100_000).map((record) => record.envelope.envelopeId)).toEqual([
      bobHistory.envelopeId
    ])
    expect(fixture.security.rotateDocumentKey(
      OTHER_DOCUMENT_ID,
      'post-compromise rotation',
      NOW + 7
    ).memberKeyEnvelopes.map((entry) => entry.recipientKeyId)).toEqual([
      fixture.alice.encryptionKeyId
    ])
  })

  it('rejects stale or withdrawn D3 consent during queue flush and submission', () => {
    const fixture = createFixture()
    const client = new LocalFirstMockRelayClient(
      fixture.alice,
      fixture.aliceCapability,
      fixture.security,
      fixture.gateway
    )
    client.setNetworkAvailable(false)
    expect(client.publish(raceNoteDraft('queued-consent'), NOW)).toEqual(
      expect.objectContaining({ status: 'queued', code: 'queued-offline' })
    )

    expect(fixture.security.updateDocumentConsent(DOCUMENT_ID, false)).toEqual({
      documentId: DOCUMENT_ID,
      consentEpoch: 2,
      granted: false
    })
    client.setNetworkAvailable(true)
    expect(client.flush(NOW + 10)).toEqual([
      expect.objectContaining({ status: 'rejected', code: 'consent-required' })
    ])
    expect(fixture.provider.list(TENANT_ID)).toHaveLength(0)

    expect(fixture.security.updateDocumentConsent(DOCUMENT_ID, true)).toEqual({
      documentId: DOCUMENT_ID,
      consentEpoch: 3,
      granted: true
    })
    expect(client.publish(raceNoteDraft('stale-consent'), NOW + 20)).toEqual(
      expect.objectContaining({ status: 'rejected', code: 'consent-required' })
    )

    const refreshedCapability = fixture.security.issueCapability({
      identity: fixture.alice,
      documentIds: [DOCUMENT_ID],
      maxDataClass: 'D3',
      consentEpoch: 3,
      issuedAt: NOW + 21,
      expiresAt: NOW + 60_000
    })
    client.setCapability(refreshedCapability)
    expect(client.publish(raceNoteDraft('fresh-consent'), NOW + 22).code).toBe('accepted')
  })

  it('quarantines a validly signed envelope inserted after its signer was revoked without admission proof', () => {
    const fixture = createFixture()
    const pending = seal(fixture, fixture.alice, fixture.aliceCapability, 1)
    fixture.security.revokeDevice(fixture.alice.deviceId, 'device compromise', NOW + 2)

    expect(fixture.gateway.submit(pending, NOW + 3)).toEqual(
      expect.objectContaining({ status: 'rejected', code: 'signer-revoked' })
    )
    fixture.provider.injectUntrustedEnvelope(pending, NOW + 4)

    expect(fixture.gateway.verifyStored(TENANT_ID, NOW + 5)).toHaveLength(0)
    expect(fixture.gateway.quarantine()).toContainEqual(expect.objectContaining({
      envelopeId: pending.envelopeId,
      code: 'admission-proof-invalid'
    }))
  })

  it('quarantines a validly signed D3 envelope inserted after consent withdrawal without admission proof', () => {
    const fixture = createFixture()
    const pending = seal(
      fixture,
      fixture.alice,
      fixture.aliceCapability,
      1,
      raceNoteDraft('withdrawn-direct-insert')
    )
    fixture.security.updateDocumentConsent(DOCUMENT_ID, false)

    expect(fixture.gateway.submit(pending, NOW + 3)).toEqual(
      expect.objectContaining({ status: 'rejected', code: 'consent-required' })
    )
    fixture.provider.injectUntrustedEnvelope(pending, NOW + 4)

    expect(fixture.gateway.verifyStored(TENANT_ID, NOW + 5)).toHaveLength(0)
    expect(fixture.gateway.quarantine()).toContainEqual(expect.objectContaining({
      envelopeId: pending.envelopeId,
      code: 'admission-proof-invalid'
    }))
  })

  it('quarantines an oversized quota-rejected envelope inserted directly by the provider', () => {
    const fixture = createFixture()
    const oversized = seal(fixture, fixture.alice, fixture.aliceCapability, 1)
    const quotas: RelayQuotaPolicy = {
      maxObjectsPerTenant: 10,
      maxObjectsPerDevice: 10,
      maxObjectsPerDocument: 10,
      maxStoredBytesPerTenant: 1_000_000,
      maxEnvelopeBytes: serializedByteLength(oversized) - 1,
      maxReferenceCount: 100,
      maxReferenceBytes: 100_000,
      maxOfflineQueueItems: 10,
      maxOfflineQueueBytes: 1_000_000
    }
    const gateway = new DeterministicRelayGateway(fixture.provider, fixture.security, quotas)

    expect(gateway.submit(oversized, NOW + 10)).toEqual(
      expect.objectContaining({ status: 'rejected', code: 'quota-exceeded' })
    )
    fixture.provider.injectUntrustedEnvelope(oversized, NOW + 11)

    expect(gateway.verifyStored(TENANT_ID, NOW + 12)).toHaveLength(0)
    expect(gateway.quarantine()).toContainEqual(expect.objectContaining({
      envelopeId: oversized.envelopeId,
      code: 'admission-proof-invalid'
    }))
  })

  it('enforces per-tenant quota before a second ciphertext write', () => {
    const quotas: RelayQuotaPolicy = {
      maxObjectsPerTenant: 1,
      maxObjectsPerDevice: 10,
      maxObjectsPerDocument: 10,
      maxStoredBytesPerTenant: 1_000_000,
      maxEnvelopeBytes: 100_000,
      maxReferenceCount: 100,
      maxReferenceBytes: 100_000,
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

  it('counts references and metadata in storage and offline queue byte quotas', () => {
    const fixture = createFixture()
    const longReference = `head-${'x'.repeat(4_000)}`
    const envelope = seal(
      fixture,
      fixture.alice,
      fixture.aliceCapability,
      1,
      dashboardDraft('metadata-heavy', [longReference])
    )
    const maxEnvelopeBytes = envelope.ciphertextBytes + 256
    expect(serializedByteLength(envelope)).toBeGreaterThan(maxEnvelopeBytes)

    const quotas: RelayQuotaPolicy = {
      maxObjectsPerTenant: 10,
      maxObjectsPerDevice: 10,
      maxObjectsPerDocument: 10,
      maxStoredBytesPerTenant: 1_000_000,
      maxEnvelopeBytes,
      maxReferenceCount: 10,
      maxReferenceBytes: 100_000,
      maxOfflineQueueItems: 10,
      maxOfflineQueueBytes: 1_000_000
    }
    const gateway = new DeterministicRelayGateway(fixture.provider, fixture.security, quotas)

    expect(gateway.submit(envelope, NOW + 10)).toEqual(
      expect.objectContaining({ status: 'rejected', code: 'quota-exceeded' })
    )
    expect(fixture.provider.list(TENANT_ID)).toHaveLength(0)

    const client = new LocalFirstMockRelayClient(
      fixture.alice,
      fixture.aliceCapability,
      fixture.security,
      gateway
    )
    client.setNetworkAvailable(false)
    expect(client.publish(dashboardDraft('queued-metadata', [longReference]), NOW + 20)).toEqual(
      expect.objectContaining({ status: 'rejected', code: 'offline-queue-full' })
    )
    expect(client.localDocuments()).toHaveLength(1)
    expect(client.queued()).toHaveLength(0)
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
