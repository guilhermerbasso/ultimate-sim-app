import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import curatedFeed from '../../../resources/raceops/curated-feed.json'
import {
  RACEOPS_BLUEPRINT_RUNTIME_VERSION,
  RACEOPS_EVIDENCE_SCHEMA_VERSION,
  canonicalJson,
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

function createSigner(): TestSigner {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    keyId: 'test-raceops-root',
    privateKey,
    publicKeySpki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  }
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
})

describe('RaceOps registry lifecycle', () => {
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
    await registry.dryRun({
      feedId: feed.pin.feedId,
      blueprintId: 'test-blueprint',
      parameters: { procedure: 'prepare-slow-zone' }
    })
    expect((await registry.getSnapshot()).blueprints[0].compatibilityStatus).toBe('compatible')
  })

  it('migrates v1 install history into the versioned v2 registry state', () => {
    const migrated = migrateRaceOpsRegistryState({
      schemaVersion: 1,
      cachedFeeds: [],
      installed: [
        installed('1.0.0', '2026-07-15T10:00:00.000Z'),
        installed('2.0.0', '2026-07-16T10:00:00.000Z')
      ],
      evidence: []
    })
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.installs['migrated-blueprint'].active.blueprintVersion).toBe('2.0.0')
    expect(migrated.installs['migrated-blueprint'].history).toHaveLength(1)
    expect(migrated.installs['migrated-blueprint'].history[0].blueprintVersion).toBe('1.0.0')
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

    const response = await registry.stage({
      feedId: feed.pin.feedId,
      blueprintId: 'test-blueprint',
      parameters: {}
    })
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
        await registry.stage({
          feedId: v1.pin.feedId,
          blueprintId: 'rollback-blueprint',
          parameters: {}
        })
      ).installed
    ).toBe(true)
    expect(
      (
        await registry.stage({
          feedId: v2.pin.feedId,
          blueprintId: 'rollback-blueprint',
          parameters: {}
        })
      ).installed
    ).toBe(true)

    let snapshot = await registry.getSnapshot()
    expect(snapshot.installed[0].blueprintVersion).toBe('2.0.0')
    expect(snapshot.blueprints.some((entry) => entry.rollbackAvailable)).toBe(true)

    const rolledBack = await registry.rollback('rollback-blueprint')
    expect(rolledBack.installed).toBe(true)
    expect(rolledBack.evidence.operation).toBe('rollback')
    snapshot = await registry.getSnapshot()
    expect(snapshot.installed[0].blueprintVersion).toBe('1.0.0')
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
