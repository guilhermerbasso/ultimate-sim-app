import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import curatedFeed from '../../../resources/raceops/curated-feed.json'
import {
  RACEOPS_BLUEPRINT_RUNTIME_VERSION,
  RACEOPS_EVIDENCE_SCHEMA_VERSION,
  canonicalJson,
  createRaceOpsBlueprintSelectionRequest,
  parseSignedRaceOpsBlueprintFeed,
  type CuratedRaceOpsFeedPin,
  type RaceOpsBlueprintFeedPayload,
  type RaceOpsBlueprintManifest,
  type RaceOpsInstalledBlueprint,
  type SignedRaceOpsBlueprintFeed
} from '../../shared/raceops-blueprints'
import {
  RACEOPS_CURATED_FEED_PINS,
  RACEOPS_TRUSTED_PUBLIC_KEYS
} from './curated'
import {
  RaceOpsBlueprintRegistry,
  RaceOpsFeedTransportError,
  createMemoryRaceOpsRegistryStorage,
  migrateRaceOpsRegistryState,
  sha256RaceOpsCanonical,
  verifyPinnedRaceOpsFeed
} from './registry'

const NOW = Date.parse('2026-07-17T15:00:00.000Z')
const BASE_MANIFEST = parseSignedRaceOpsBlueprintFeed(curatedFeed).payload.entries[0].manifest

interface TestSigner {
  keyId: string
  privateKey: KeyObject
  publicKeySpki: string
}

function createSigner(keyId = 'test-raceops-root'): TestSigner {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    keyId,
    privateKey,
    publicKeySpki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  }
}

function requestFor(
  feed: { envelope: SignedRaceOpsBlueprintFeed },
  parameters: Record<string, unknown> = {}
) {
  const entry = feed.envelope.payload.entries[0]
  return createRaceOpsBlueprintSelectionRequest(
    {
      feedId: feed.envelope.payload.feedId,
      blueprintId: entry.id,
      blueprintVersion: entry.version,
      manifestSha256: entry.manifestSha256
    },
    parameters
  )
}

function makeSignedFeed(
  signer: TestSigner,
  options: {
    feedId: string
    blueprintId?: string
    version?: string
    appMin?: string
    appMax?: string
    sequence?: number
  }
): {
  envelope: SignedRaceOpsBlueprintFeed
  pin: CuratedRaceOpsFeedPin
  trustedKeys: Record<string, string>
} {
  const manifest = structuredClone(BASE_MANIFEST) as RaceOpsBlueprintManifest
  manifest.id = options.blueprintId ?? 'test-blueprint'
  manifest.version = options.version ?? '1.0.0'
  manifest.title = `Test Blueprint ${manifest.version}`
  manifest.compatibility.app.min = options.appMin ?? '2.53.0'
  manifest.compatibility.app.max = options.appMax ?? '2.99.99'
  const endpoint = `https://example.com/${options.feedId}.json`
  const source = { kind: 'url' as const, url: endpoint }
  const payload: RaceOpsBlueprintFeedPayload = {
    schemaVersion: 1,
    feedId: options.feedId,
    title: `Feed ${options.feedId}`,
    sequence: options.sequence ?? 1,
    issuedAt: '2026-07-17T14:00:00.000Z',
    expiresAt: '2027-07-17T14:00:00.000Z',
    source,
    entries: [
      {
        id: manifest.id,
        version: manifest.version,
        manifestSha256: sha256RaceOpsCanonical(manifest),
        manifest
      }
    ]
  }
  const envelope: SignedRaceOpsBlueprintFeed = {
    payload,
    signature: {
      algorithm: 'ed25519',
      keyId: signer.keyId,
      value: sign(null, Buffer.from(canonicalJson(payload)), signer.privateKey).toString('base64')
    }
  }
  const pin: CuratedRaceOpsFeedPin = {
    feedId: options.feedId,
    title: payload.title,
    endpoint,
    envelopeSha256: sha256RaceOpsCanonical(envelope),
    keyId: signer.keyId,
    reviewedAt: '2026-07-17T14:30:00.000Z',
    source
  }
  return {
    envelope,
    pin,
    trustedKeys: { [signer.keyId]: signer.publicKeySpki }
  }
}

function installed(
  blueprintVersion: string,
  stagedAt: string
): RaceOpsInstalledBlueprint {
  return {
    blueprintId: 'migrated-blueprint',
    blueprintVersion,
    manifestSha256: 'a'.repeat(64),
    feedId: 'legacy-feed',
    parameters: {},
    evidenceId: `legacy-${blueprintVersion}`,
    stagedAt,
    execution: 'disabled-trust-gate'
  }
}

describe('signed curated RaceOps feeds', () => {
  it('verifies the bundled signed/hash-pinned feed and rejects tampering', () => {
    expect(() =>
      verifyPinnedRaceOpsFeed(
        RACEOPS_CURATED_FEED_PINS[0],
        curatedFeed,
        RACEOPS_TRUSTED_PUBLIC_KEYS,
        NOW
      )
    ).not.toThrow()

    const tampered = structuredClone(curatedFeed)
    tampered.payload.entries[0].manifest.title = 'Tampered title'
    expect(() =>
      verifyPinnedRaceOpsFeed(
        RACEOPS_CURATED_FEED_PINS[0],
        tampered,
        RACEOPS_TRUSTED_PUBLIC_KEYS,
        NOW
      )
    ).toThrowError(expect.objectContaining({ code: 'TAMPERED' }))

    const signatureTampered = structuredClone(curatedFeed)
    signatureTampered.signature.value = `A${signatureTampered.signature.value.slice(1)}`
    const repinned = {
      ...RACEOPS_CURATED_FEED_PINS[0],
      envelopeSha256: sha256RaceOpsCanonical(signatureTampered)
    }
    expect(() =>
      verifyPinnedRaceOpsFeed(
        repinned,
        signatureTampered,
        RACEOPS_TRUSTED_PUBLIC_KEYS,
        NOW
      )
    ).toThrowError(expect.objectContaining({ code: 'TAMPERED' }))
  })

  it('fails closed when the signing key is unknown', () => {
    expect(() =>
      verifyPinnedRaceOpsFeed(RACEOPS_CURATED_FEED_PINS[0], curatedFeed, {}, NOW)
    ).toThrowError(expect.objectContaining({ code: 'UNKNOWN_SIGNATURE' }))
  })

  it('rejects a cached feed whose envelope was altered after verification', async () => {
    const signer = createSigner()
    const feed = makeSignedFeed(signer, { feedId: 'tamper-cache' })
    const storage = createMemoryRaceOpsRegistryStorage()
    const first = new RaceOpsBlueprintRegistry({
      storage,
      appVersion: '2.53.1',
      pins: [feed.pin],
      trustedKeys: feed.trustedKeys,
      fetchFeed: async () => feed.envelope,
      now: () => NOW
    })
    await first.refreshFeed(feed.pin.feedId)

    const persisted = storage.dump() as {
      feeds: Record<string, { envelope: SignedRaceOpsBlueprintFeed }>
    }
    persisted.feeds[feed.pin.feedId].envelope.payload.title = 'Altered cache'
    await storage.write(persisted)

    const reopened = new RaceOpsBlueprintRegistry({
      storage,
      appVersion: '2.53.1',
      pins: [feed.pin],
      trustedKeys: feed.trustedKeys,
      now: () => NOW
    })
    await expect(reopened.getSnapshot()).rejects.toMatchObject({ code: 'TAMPERED' })
  })

  it('quarantines a stale cache during legitimate pin rotation and continues with the current feed', async () => {
    const oldSigner = createSigner('old-raceops-root')
    const currentSigner = createSigner('current-raceops-root')
    const oldFeed = makeSignedFeed(oldSigner, {
      feedId: 'rotating-feed',
      sequence: 1
    })
    const currentFeed = makeSignedFeed(currentSigner, {
      feedId: 'rotating-feed',
      sequence: 2
    })
    const storage = createMemoryRaceOpsRegistryStorage()
    const oldRegistry = new RaceOpsBlueprintRegistry({
      storage,
      appVersion: '2.53.1',
      pins: [oldFeed.pin],
      trustedKeys: oldFeed.trustedKeys,
      fetchFeed: async () => oldFeed.envelope,
      now: () => NOW
    })
    await oldRegistry.refreshFeed(oldFeed.pin.feedId)
    await oldRegistry.dryRun(requestFor(oldFeed))

    const rotated = new RaceOpsBlueprintRegistry({
      storage,
      appVersion: '2.53.1',
      pins: [currentFeed.pin],
      trustedKeys: currentFeed.trustedKeys,
      bundledFeeds: { [currentFeed.pin.feedId]: currentFeed.envelope },
      now: () => NOW
    })
    const snapshot = await rotated.getSnapshot()
    expect(snapshot.feeds[0].envelopeSha256).toBe(currentFeed.pin.envelopeSha256)
    expect(snapshot.blueprints[0].compatibilityStatus).toBe('stale')

    const persisted = storage.dump() as {
      schemaVersion: number
      quarantinedFeeds: Array<{
        reason: string
        cached: { envelopeSha256: string }
        currentPinSha256: string
      }>
    }
    expect(persisted.schemaVersion).toBe(3)
    expect(persisted.quarantinedFeeds).toEqual([
      expect.objectContaining({
        reason: 'pin-rotation',
        currentPinSha256: currentFeed.pin.envelopeSha256,
        cached: expect.objectContaining({ envelopeSha256: oldFeed.pin.envelopeSha256 })
      })
    ])
  })
})

describe('RaceOps registry lifecycle', () => {
  it('requires exact operation identity and a matching request fingerprint', async () => {
    const signer = createSigner()
    const feed = makeSignedFeed(signer, { feedId: 'exact-operation' })
    const registry = new RaceOpsBlueprintRegistry({
      storage: createMemoryRaceOpsRegistryStorage(),
      appVersion: '2.53.1',
      pins: [feed.pin],
      trustedKeys: feed.trustedKeys,
      bundledFeeds: { [feed.pin.feedId]: feed.envelope },
      now: () => NOW
    })

    const valid = requestFor(feed)
    const response = await registry.dryRun(valid)
    expect(response.requestFingerprint).toBe(valid.requestFingerprint)

    await expect(
      registry.dryRun({ ...valid, blueprintVersion: '9.0.0' })
    ).rejects.toMatchObject({ code: 'STALE_REQUEST' })

    const wrongVersion = createRaceOpsBlueprintSelectionRequest(
      { ...valid, blueprintVersion: '9.0.0' },
      valid.parameters
    )
    await expect(registry.dryRun(wrongVersion)).rejects.toMatchObject({
      code: 'STALE_REQUEST'
    })

    const wrongHash = createRaceOpsBlueprintSelectionRequest(
      { ...valid, manifestSha256: 'f'.repeat(64) },
      valid.parameters
    )
    await expect(registry.dryRun(wrongHash)).rejects.toMatchObject({ code: 'STALE_REQUEST' })
    await expect(
      registry.dryRun({ ...valid, unexpected: true } as typeof valid)
    ).rejects.toMatchObject({ code: 'INVALID_SCHEMA' })
  })

  it('changes compatibility badges only after publisher evidence exists', async () => {
    const signer = createSigner()
    const feed = makeSignedFeed(signer, { feedId: 'evidence-view' })
    const registry = new RaceOpsBlueprintRegistry({
      storage: createMemoryRaceOpsRegistryStorage(),
      appVersion: '2.53.1',
      pins: [feed.pin],
      trustedKeys: feed.trustedKeys,
      bundledFeeds: { [feed.pin.feedId]: feed.envelope },
      now: () => NOW
    })

    expect((await registry.getSnapshot()).blueprints[0].compatibilityStatus).toBe('unverified')
    await registry.dryRun(requestFor(feed, { procedure: 'prepare-slow-zone' }))
    expect((await registry.getSnapshot()).blueprints[0].compatibilityStatus).toBe('compatible')
  })

  it('migrates v1 install history into the versioned v3 registry state', () => {
    const migrated = migrateRaceOpsRegistryState({
      schemaVersion: 1,
      cachedFeeds: [],
      installed: [
        installed('1.0.0', '2026-07-15T10:00:00.000Z'),
        installed('2.0.0', '2026-07-16T10:00:00.000Z')
      ],
      evidence: []
    })
    expect(migrated.schemaVersion).toBe(3)
    expect(migrated.installs['migrated-blueprint'].active.blueprintVersion).toBe('2.0.0')
    expect(migrated.installs['migrated-blueprint'].history).toHaveLength(1)
    expect(migrated.installs['migrated-blueprint'].history[0].blueprintVersion).toBe('1.0.0')
    expect(migrated.quarantinedFeeds).toEqual([])
  })

  it('migrates schema v2 state to v3 without trusting unknown quarantine data', () => {
    const migrated = migrateRaceOpsRegistryState({
      schemaVersion: 2,
      feeds: {},
      installs: {},
      evidence: [],
      quarantinedFeeds: [{ reason: 'forged' }]
    })
    expect(migrated.schemaVersion).toBe(3)
    expect(migrated.quarantinedFeeds).toEqual([])
  })

  it('publishes incompatible evidence and refuses to stage unsupported app versions', async () => {
    const signer = createSigner()
    const feed = makeSignedFeed(signer, {
      feedId: 'future-app',
      appMin: '9.0.0',
      appMax: '9.9.9'
    })
    const registry = new RaceOpsBlueprintRegistry({
      storage: createMemoryRaceOpsRegistryStorage(),
      appVersion: '2.53.1',
      pins: [feed.pin],
      trustedKeys: feed.trustedKeys,
      bundledFeeds: { [feed.pin.feedId]: feed.envelope },
      now: () => NOW
    })

    const response = await registry.stage(requestFor(feed))
    expect(response.installed).toBe(false)
    expect(response.ok).toBe(false)
    expect(response.evidence.status).toBe('incompatible-app')
    const snapshot = await registry.getSnapshot()
    expect(snapshot.installed).toEqual([])
    expect(snapshot.evidence[0]).toMatchObject({
      schemaVersion: RACEOPS_EVIDENCE_SCHEMA_VERSION,
      runtimeVersion: RACEOPS_BLUEPRINT_RUNTIME_VERSION,
      status: 'incompatible-app'
    })
  })

  it('rolls back to the previous validated manifest and quarantines the newer stage', async () => {
    const signer = createSigner()
    const v1 = makeSignedFeed(signer, {
      feedId: 'rollback-v1',
      blueprintId: 'rollback-blueprint',
      version: '1.0.0'
    })
    const v2 = makeSignedFeed(signer, {
      feedId: 'rollback-v2',
      blueprintId: 'rollback-blueprint',
      version: '2.0.0'
    })
    const registry = new RaceOpsBlueprintRegistry({
      storage: createMemoryRaceOpsRegistryStorage(),
      appVersion: '2.53.1',
      pins: [v1.pin, v2.pin],
      trustedKeys: v1.trustedKeys,
      bundledFeeds: {
        [v1.pin.feedId]: v1.envelope,
        [v2.pin.feedId]: v2.envelope
      },
      now: () => NOW
    })

    expect(
      (
        await registry.stage(requestFor(v1))
      ).installed
    ).toBe(true)
    expect(
      (
        await registry.stage(requestFor(v2))
      ).installed
    ).toBe(true)

    let snapshot = await registry.getSnapshot()
    expect(snapshot.installed[0].blueprintVersion).toBe('2.0.0')
    expect(
      snapshot.blueprints.find((entry) => entry.feedId === v2.pin.feedId)?.rollbackAvailable
    ).toBe(true)
    expect(
      snapshot.blueprints.find((entry) => entry.feedId === v1.pin.feedId)?.rollbackAvailable
    ).toBe(false)

    const rolledBack = await registry.rollback({
      feedId: v2.pin.feedId,
      blueprintId: 'rollback-blueprint',
      blueprintVersion: '2.0.0',
      manifestSha256: v2.envelope.payload.entries[0].manifestSha256
    })
    expect(rolledBack.installed).toBe(true)
    expect(rolledBack.evidence.operation).toBe('rollback')
    snapshot = await registry.getSnapshot()
    expect(snapshot.installed[0].blueprintVersion).toBe('1.0.0')
  })

  it('rejects rollback when the UI operation identity is stale', async () => {
    const signer = createSigner()
    const v1 = makeSignedFeed(signer, {
      feedId: 'rollback-stale-v1',
      blueprintId: 'rollback-stale',
      version: '1.0.0'
    })
    const v2 = makeSignedFeed(signer, {
      feedId: 'rollback-stale-v2',
      blueprintId: 'rollback-stale',
      version: '2.0.0'
    })
    const registry = new RaceOpsBlueprintRegistry({
      storage: createMemoryRaceOpsRegistryStorage(),
      appVersion: '2.53.1',
      pins: [v1.pin, v2.pin],
      trustedKeys: v1.trustedKeys,
      bundledFeeds: {
        [v1.pin.feedId]: v1.envelope,
        [v2.pin.feedId]: v2.envelope
      },
      now: () => NOW
    })
    await registry.stage(requestFor(v1))
    await registry.stage(requestFor(v2))

    await expect(
      registry.rollback({
        feedId: v1.pin.feedId,
        blueprintId: 'rollback-stale',
        blueprintVersion: '1.0.0',
        manifestSha256: v1.envelope.payload.entries[0].manifestSha256
      })
    ).rejects.toMatchObject({ code: 'STALE_REQUEST' })
  })

  it('invalidates evidence across app and runtime upgrades', async () => {
    const signer = createSigner()
    const feed = makeSignedFeed(signer, { feedId: 'upgrade-evidence' })
    const storage = createMemoryRaceOpsRegistryStorage()
    const original = new RaceOpsBlueprintRegistry({
      storage,
      appVersion: '2.53.1',
      pins: [feed.pin],
      trustedKeys: feed.trustedKeys,
      bundledFeeds: { [feed.pin.feedId]: feed.envelope },
      now: () => NOW
    })
    await original.dryRun(requestFor(feed))
    expect((await original.getSnapshot()).blueprints[0].compatibilityStatus).toBe('compatible')

    const appUpgrade = new RaceOpsBlueprintRegistry({
      storage,
      appVersion: '2.54.0',
      pins: [feed.pin],
      trustedKeys: feed.trustedKeys,
      bundledFeeds: { [feed.pin.feedId]: feed.envelope },
      now: () => NOW
    })
    expect((await appUpgrade.getSnapshot()).blueprints[0].compatibilityStatus).toBe('stale')

    const runtimeUpgrade = new RaceOpsBlueprintRegistry({
      storage,
      appVersion: '2.53.1',
      runtimeVersion: 2,
      pins: [feed.pin],
      trustedKeys: feed.trustedKeys,
      bundledFeeds: { [feed.pin.feedId]: feed.envelope },
      now: () => NOW
    })
    expect((await runtimeUpgrade.getSnapshot()).blueprints[0].compatibilityStatus).toBe('stale')
    const incompatible = await runtimeUpgrade.dryRun(requestFor(feed))
    expect(incompatible.ok).toBe(false)
    expect(incompatible.evidence.status).toBe('incompatible-runtime')
  })

  it('serves a previously verified feed from cache when refresh is offline', async () => {
    const signer = createSigner()
    const feed = makeSignedFeed(signer, { feedId: 'offline-cache' })
    const storage = createMemoryRaceOpsRegistryStorage()
    const online = new RaceOpsBlueprintRegistry({
      storage,
      appVersion: '2.53.1',
      pins: [feed.pin],
      trustedKeys: feed.trustedKeys,
      fetchFeed: async () => feed.envelope,
      now: () => NOW
    })
    const fresh = await online.refreshFeed(feed.pin.feedId)
    expect(fresh.feeds[0]).toMatchObject({ fromCache: false, offline: false })

    const offline = new RaceOpsBlueprintRegistry({
      storage,
      appVersion: '2.53.1',
      pins: [feed.pin],
      trustedKeys: feed.trustedKeys,
      fetchFeed: async () => {
        throw new RaceOpsFeedTransportError('offline')
      },
      now: () => NOW
    })
    const cached = await offline.refreshFeed(feed.pin.feedId)
    expect(cached.feeds[0]).toMatchObject({ fromCache: true, offline: true })
    expect(cached.blueprints).toHaveLength(1)
  })

  it('rejects unknown registry schema versions', () => {
    expect(() => migrateRaceOpsRegistryState({ schemaVersion: 99 })).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_VERSION' })
    )
  })
})
