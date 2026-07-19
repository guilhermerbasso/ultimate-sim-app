import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
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
  createFileRaceOpsRegistryStorage,
  createMemoryRaceOpsRegistryStorage,
  migrateRaceOpsRegistryState,
  sha256RaceOpsCanonical,
  verifyPinnedRaceOpsFeed,
  type RaceOpsRegistryFileOperations,
  type RaceOpsRegistryStorage
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

function createFailingStorage(seed?: unknown): RaceOpsRegistryStorage & {
  dump(): unknown
  failNextWrite(error?: Error): void
} {
  let value = seed === undefined ? undefined : structuredClone(seed)
  let nextWriteError: Error | null = null
  return {
    async read() {
      return value === undefined ? undefined : structuredClone(value)
    },
    async write(next) {
      if (nextWriteError) {
        const error = nextWriteError
        nextWriteError = null
        throw error
      }
      value = structuredClone(next)
    },
    dump() {
      return value === undefined ? undefined : structuredClone(value)
    },
    failNextWrite(error = new Error('injected registry write failure')) {
      nextWriteError = error
    }
  }
}

function createGatedStorage(seed?: unknown): RaceOpsRegistryStorage & {
  dump(): unknown
  pendingWrites(): number
  releaseNextWrite(): void
  maxConcurrentWrites(): number
} {
  let value = seed === undefined ? undefined : structuredClone(seed)
  let activeWrites = 0
  let maxConcurrentWrites = 0
  const releases: Array<() => void> = []
  return {
    async read() {
      return value === undefined ? undefined : structuredClone(value)
    },
    async write(next) {
      activeWrites += 1
      maxConcurrentWrites = Math.max(maxConcurrentWrites, activeWrites)
      await new Promise<void>((resolve) => releases.push(resolve))
      value = structuredClone(next)
      activeWrites -= 1
    },
    dump() {
      return value === undefined ? undefined : structuredClone(value)
    },
    pendingWrites() {
      return releases.length
    },
    releaseNextWrite() {
      const release = releases.shift()
      if (!release) throw new Error('No pending registry write.')
      release()
    },
    maxConcurrentWrites() {
      return maxConcurrentWrites
    }
  }
}

function fileOperationError(code: string, message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException
  error.code = code
  return error
}

class VirtualWindowsRegistryFiles implements RaceOpsRegistryFileOperations {
  readonly files = new Map<string, string>()
  readonly removedPaths: string[] = []
  private readonly failures: Array<{
    operation: 'writeFile' | 'rename' | 'remove'
    matches: (paths: readonly string[]) => boolean
    error: NodeJS.ErrnoException
  }> = []

  failNext(
    operation: 'writeFile' | 'rename' | 'remove',
    matches: (paths: readonly string[]) => boolean,
    code = 'EIO'
  ): void {
    this.failures.push({
      operation,
      matches,
      error: fileOperationError(code, `Injected ${operation} failure.`)
    })
  }

  async mkdir(): Promise<void> {}

  async readFile(path: string): Promise<string> {
    const value = this.files.get(path)
    if (value === undefined) throw fileOperationError('ENOENT', `Missing ${path}.`)
    return value
  }

  async rename(from: string, to: string): Promise<void> {
    this.maybeFail('rename', [from, to])
    const value = this.files.get(from)
    if (value === undefined) throw fileOperationError('ENOENT', `Missing ${from}.`)
    if (this.files.has(to)) throw fileOperationError('EEXIST', `Existing ${to}.`)
    this.files.set(to, value)
    this.files.delete(from)
  }

  async remove(path: string): Promise<void> {
    this.maybeFail('remove', [path])
    this.removedPaths.push(path)
    this.files.delete(path)
  }

  async writeFile(path: string, value: string): Promise<void> {
    this.maybeFail('writeFile', [path])
    this.files.set(path, value)
  }

  private maybeFail(
    operation: 'writeFile' | 'rename' | 'remove',
    paths: readonly string[]
  ): void {
    const index = this.failures.findIndex(
      (failure) => failure.operation === operation && failure.matches(paths)
    )
    if (index < 0) return
    const [failure] = this.failures.splice(index, 1)
    throw failure.error
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

  it('accepts a higher-sequence pin rotation and quarantines the stale cache', async () => {
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
      feedSequenceHighWaterMarks: Record<string, number>
      quarantinedFeeds: Array<{
        reason: string
        cached: { envelopeSha256: string }
        currentPinSha256: string
      }>
    }
    expect(persisted.schemaVersion).toBe(4)
    expect(persisted.feedSequenceHighWaterMarks[oldFeed.pin.feedId]).toBe(2)
    expect(persisted.quarantinedFeeds).toEqual([
      expect.objectContaining({
        reason: 'pin-rotation',
        currentPinSha256: currentFeed.pin.envelopeSha256,
        cached: expect.objectContaining({ envelopeSha256: oldFeed.pin.envelopeSha256 })
      })
    ])
  })

  it('rejects a sequence-2 to sequence-1 pin rotation before replacing committed cache', async () => {
    const sequenceTwoSigner = createSigner('sequence-two-root')
    const sequenceOneSigner = createSigner('sequence-one-root')
    const sequenceTwo = makeSignedFeed(sequenceTwoSigner, {
      feedId: 'rollback-resistant-feed',
      sequence: 2
    })
    const sequenceOne = makeSignedFeed(sequenceOneSigner, {
      feedId: 'rollback-resistant-feed',
      sequence: 1
    })
    const storage = createMemoryRaceOpsRegistryStorage()
    const current = new RaceOpsBlueprintRegistry({
      storage,
      appVersion: '2.53.1',
      pins: [sequenceTwo.pin],
      trustedKeys: sequenceTwo.trustedKeys,
      fetchFeed: async () => sequenceTwo.envelope,
      now: () => NOW
    })
    await current.refreshFeed(sequenceTwo.pin.feedId)

    const rotatedBack = new RaceOpsBlueprintRegistry({
      storage,
      appVersion: '2.53.1',
      pins: [sequenceOne.pin],
      trustedKeys: sequenceOne.trustedKeys,
      bundledFeeds: { [sequenceOne.pin.feedId]: sequenceOne.envelope },
      now: () => NOW
    })
    await expect(rotatedBack.getSnapshot()).rejects.toMatchObject({ code: 'TAMPERED' })

    const persisted = storage.dump() as {
      feeds: Record<string, { envelopeSha256: string }>
      feedSequenceHighWaterMarks: Record<string, number>
      quarantinedFeeds: unknown[]
    }
    expect(persisted.feeds[sequenceTwo.pin.feedId].envelopeSha256).toBe(
      sequenceTwo.pin.envelopeSha256
    )
    expect(persisted.feedSequenceHighWaterMarks[sequenceTwo.pin.feedId]).toBe(2)
    expect(persisted.quarantinedFeeds).toEqual([])
  })

  it('keeps the sequence high-water mark across cache quarantine and restart', async () => {
    const oldSigner = createSigner('restart-old-root')
    const currentSigner = createSigner('restart-current-root')
    const oldFeed = makeSignedFeed(oldSigner, {
      feedId: 'restart-rotation-feed',
      sequence: 2
    })
    const currentFeed = makeSignedFeed(currentSigner, {
      feedId: 'restart-rotation-feed',
      sequence: 3
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

    const rotated = new RaceOpsBlueprintRegistry({
      storage,
      appVersion: '2.53.1',
      pins: [currentFeed.pin],
      trustedKeys: currentFeed.trustedKeys,
      bundledFeeds: { [currentFeed.pin.feedId]: currentFeed.envelope },
      now: () => NOW
    })
    expect((await rotated.getSnapshot()).feeds[0].sequence).toBe(3)

    const restarted = new RaceOpsBlueprintRegistry({
      storage,
      appVersion: '2.53.1',
      pins: [currentFeed.pin],
      trustedKeys: currentFeed.trustedKeys,
      now: () => NOW
    })
    expect((await restarted.getSnapshot()).feeds[0].sequence).toBe(3)
    const persisted = storage.dump() as {
      feedSequenceHighWaterMarks: Record<string, number>
      quarantinedFeeds: unknown[]
    }
    expect(persisted.feedSequenceHighWaterMarks[currentFeed.pin.feedId]).toBe(3)
    expect(persisted.quarantinedFeeds).toHaveLength(1)
  })

  it('derives the high-water mark from quarantined v3 cache during migration', async () => {
    const oldSigner = createSigner('migration-old-root')
    const lowerSigner = createSigner('migration-lower-root')
    const oldFeed = makeSignedFeed(oldSigner, {
      feedId: 'migration-quarantine-feed',
      sequence: 2
    })
    const lowerFeed = makeSignedFeed(lowerSigner, {
      feedId: 'migration-quarantine-feed',
      sequence: 1
    })
    const cached = {
      feedId: oldFeed.pin.feedId,
      envelope: oldFeed.envelope,
      envelopeSha256: oldFeed.pin.envelopeSha256,
      verifiedAt: new Date(NOW).toISOString(),
      origin: 'network'
    }
    const storage = createMemoryRaceOpsRegistryStorage({
      schemaVersion: 3,
      feeds: {},
      installs: {},
      evidence: [],
      quarantinedFeeds: [
        {
          feedId: oldFeed.pin.feedId,
          cached,
          currentPinSha256: 'f'.repeat(64),
          quarantinedAt: new Date(NOW).toISOString(),
          reason: 'pin-rotation'
        }
      ]
    })
    const migrated = new RaceOpsBlueprintRegistry({
      storage,
      appVersion: '2.53.1',
      pins: [lowerFeed.pin],
      trustedKeys: lowerFeed.trustedKeys,
      bundledFeeds: { [lowerFeed.pin.feedId]: lowerFeed.envelope },
      now: () => NOW
    })

    await expect(migrated.getSnapshot()).rejects.toMatchObject({ code: 'TAMPERED' })
  })

  it('serializes concurrent refresh commits without losing the high-water mark', async () => {
    const signer = createSigner()
    const feed = makeSignedFeed(signer, {
      feedId: 'concurrent-refresh',
      sequence: 2
    })
    const storage = createGatedStorage()
    const registry = new RaceOpsBlueprintRegistry({
      storage,
      appVersion: '2.53.1',
      pins: [feed.pin],
      trustedKeys: feed.trustedKeys,
      fetchFeed: async () => feed.envelope,
      now: () => NOW
    })

    const first = registry.refreshFeed(feed.pin.feedId)
    const second = registry.refreshFeed(feed.pin.feedId)
    await vi.waitFor(() => expect(storage.pendingWrites()).toBe(1))
    expect(storage.maxConcurrentWrites()).toBe(1)
    storage.releaseNextWrite()
    await vi.waitFor(() => expect(storage.pendingWrites()).toBe(1))
    expect(storage.maxConcurrentWrites()).toBe(1)
    storage.releaseNextWrite()

    const snapshots = await Promise.all([first, second])
    expect(snapshots.every((snapshot) => snapshot.feeds[0].sequence === 2)).toBe(true)
    const persisted = storage.dump() as {
      feedSequenceHighWaterMarks: Record<string, number>
    }
    expect(persisted.feedSequenceHighWaterMarks[feed.pin.feedId]).toBe(2)
  })
})

describe('RaceOps registry file storage', () => {
  it('keeps the last committed file through write and rename fail steps', async () => {
    const steps: Array<{
      name: string
      arm(
        files: VirtualWindowsRegistryFiles,
        paths: { current: string; previous: string; next: string }
      ): void
    }> = [
      {
        name: 'next write',
        arm(files, paths) {
          files.failNext('writeFile', ([path]) => path === paths.next)
        }
      },
      {
        name: 'current rotation',
        arm(files, paths) {
          files.failNext(
            'rename',
            ([from, to]) => from === paths.current && to === paths.previous
          )
        }
      },
      {
        name: 'candidate promotion',
        arm(files, paths) {
          files.failNext(
            'rename',
            ([from, to]) => from === paths.next && to === paths.current
          )
        }
      }
    ]

    for (const step of steps) {
      const files = new VirtualWindowsRegistryFiles()
      const storage = createFileRaceOpsRegistryStorage(
        `C:\\raceops-storage-${step.name.replace(' ', '-')}`,
        files
      )
      const committed = { revision: 1, step: step.name }
      await storage.write(committed)
      const current = [...files.files.keys()].find((path) => path.endsWith('registry.json'))
      expect(current).toBeDefined()
      if (!current) continue
      const paths = {
        current,
        previous: `${current}.previous`,
        next: `${current}.next`
      }
      step.arm(files, paths)

      await expect(storage.write({ revision: 2, step: step.name })).rejects.toThrow(
        `Injected ${step.name === 'next write' ? 'writeFile' : 'rename'} failure.`
      )
      expect(await storage.read(), step.name).toEqual(committed)
      expect(files.removedPaths, step.name).not.toContain(current)
    }
  })

  it('recovers .previous after interrupted Windows promotion and restore', async () => {
    const files = new VirtualWindowsRegistryFiles()
    const storage = createFileRaceOpsRegistryStorage('C:\\raceops-storage-recovery', files)
    const committed = { revision: 1 }
    await storage.write(committed)
    const current = [...files.files.keys()].find((path) => path.endsWith('registry.json'))
    expect(current).toBeDefined()
    if (!current) return
    const previous = `${current}.previous`
    const next = `${current}.next`
    files.failNext('rename', ([from, to]) => from === next && to === current)
    files.failNext('rename', ([from, to]) => from === previous && to === current)

    await expect(storage.write({ revision: 2 })).rejects.toThrow(
      'Injected rename failure.'
    )
    expect(files.files.has(current)).toBe(false)
    expect(files.files.has(previous)).toBe(true)
    expect(files.removedPaths).not.toContain(current)

    const restarted = createFileRaceOpsRegistryStorage(
      'C:\\raceops-storage-recovery',
      files
    )
    expect(await restarted.read()).toEqual(committed)
  })

  it('uses a complete .next only when no committed current or previous file survives', async () => {
    const files = new VirtualWindowsRegistryFiles()
    const storage = createFileRaceOpsRegistryStorage('C:\\raceops-storage-next-recovery', files)
    await storage.write({ revision: 1 })
    const current = [...files.files.keys()].find((path) => path.endsWith('registry.json'))
    expect(current).toBeDefined()
    if (!current) return
    const previous = `${current}.previous`
    const next = `${current}.next`

    files.files.delete(current)
    files.files.set(next, JSON.stringify({ revision: 2 }))
    expect(await storage.read()).toEqual({ revision: 2 })

    files.files.set(previous, JSON.stringify({ revision: 1 }))
    expect(await storage.read()).toEqual({ revision: 1 })
  })

  it('rotates .previous under Windows EEXIST semantics without deleting current', async () => {
    const files = new VirtualWindowsRegistryFiles()
    const storage = createFileRaceOpsRegistryStorage('C:\\raceops-storage-windows', files)
    await storage.write({ revision: 1 })
    await storage.write({ revision: 2 })
    await storage.write({ revision: 3 })

    const current = [...files.files.keys()].find((path) => path.endsWith('registry.json'))
    expect(current).toBeDefined()
    if (!current) return
    expect(await storage.read()).toEqual({ revision: 3 })
    expect(JSON.parse(await files.readFile(`${current}.previous`))).toEqual({ revision: 2 })
    expect(files.removedPaths).toContain(`${current}.previous`)
    expect(files.removedPaths).not.toContain(current)
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

  it('migrates v1 install history into the versioned v4 registry state', () => {
    const migrated = migrateRaceOpsRegistryState({
      schemaVersion: 1,
      cachedFeeds: [],
      installed: [
        installed('1.0.0', '2026-07-15T10:00:00.000Z'),
        installed('2.0.0', '2026-07-16T10:00:00.000Z')
      ],
      evidence: []
    })
    expect(migrated.schemaVersion).toBe(4)
    expect(migrated.feedSequenceHighWaterMarks).toEqual({})
    expect(migrated.installs['migrated-blueprint'].active.blueprintVersion).toBe('2.0.0')
    expect(migrated.installs['migrated-blueprint'].history).toHaveLength(1)
    expect(migrated.installs['migrated-blueprint'].history[0].blueprintVersion).toBe('1.0.0')
    expect(migrated.quarantinedFeeds).toEqual([])
  })

  it('migrates schema v2 state to v4 without trusting unknown quarantine data', () => {
    const migrated = migrateRaceOpsRegistryState({
      schemaVersion: 2,
      feeds: {},
      installs: {},
      evidence: [],
      quarantinedFeeds: [{ reason: 'forged' }]
    })
    expect(migrated.schemaVersion).toBe(4)
    expect(migrated.feedSequenceHighWaterMarks).toEqual({})
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

  it('keeps memory and disk on the prior committed state when staging persistence fails', async () => {
    const signer = createSigner()
    const v1 = makeSignedFeed(signer, {
      feedId: 'atomic-stage-v1',
      blueprintId: 'atomic-stage',
      version: '1.0.0'
    })
    const v2 = makeSignedFeed(signer, {
      feedId: 'atomic-stage-v2',
      blueprintId: 'atomic-stage',
      version: '2.0.0'
    })
    const storage = createFailingStorage()
    const options = {
      storage,
      appVersion: '2.53.1',
      pins: [v1.pin, v2.pin],
      trustedKeys: v1.trustedKeys,
      bundledFeeds: {
        [v1.pin.feedId]: v1.envelope,
        [v2.pin.feedId]: v2.envelope
      },
      now: () => NOW
    }
    const registry = new RaceOpsBlueprintRegistry(options)
    await registry.stage(requestFor(v1))
    const committed = storage.dump()

    storage.failNextWrite()
    await expect(registry.stage(requestFor(v2))).rejects.toThrow(
      'injected registry write failure'
    )
    expect((await registry.getSnapshot()).installed[0].blueprintVersion).toBe('1.0.0')
    expect(storage.dump()).toEqual(committed)

    const restarted = new RaceOpsBlueprintRegistry(options)
    expect((await restarted.getSnapshot()).installed[0].blueprintVersion).toBe('1.0.0')
    expect((await registry.stage(requestFor(v2))).installed).toBe(true)
  })

  it('does not publish a staged candidate while its durable write is pending', async () => {
    const signer = createSigner()
    const v1 = makeSignedFeed(signer, {
      feedId: 'pending-stage-v1',
      blueprintId: 'pending-stage',
      version: '1.0.0'
    })
    const v2 = makeSignedFeed(signer, {
      feedId: 'pending-stage-v2',
      blueprintId: 'pending-stage',
      version: '2.0.0'
    })
    const bundledFeeds = {
      [v1.pin.feedId]: v1.envelope,
      [v2.pin.feedId]: v2.envelope
    }
    const seedStorage = createMemoryRaceOpsRegistryStorage()
    const seedRegistry = new RaceOpsBlueprintRegistry({
      storage: seedStorage,
      appVersion: '2.53.1',
      pins: [v1.pin, v2.pin],
      trustedKeys: v1.trustedKeys,
      bundledFeeds,
      now: () => NOW
    })
    await seedRegistry.stage(requestFor(v1))

    const storage = createGatedStorage(seedStorage.dump())
    const registry = new RaceOpsBlueprintRegistry({
      storage,
      appVersion: '2.53.1',
      pins: [v1.pin, v2.pin],
      trustedKeys: v1.trustedKeys,
      bundledFeeds,
      now: () => NOW
    })
    const staging = registry.stage(requestFor(v2))
    await vi.waitFor(() => expect(storage.pendingWrites()).toBe(1))

    expect((await registry.getSnapshot()).installed[0].blueprintVersion).toBe('1.0.0')
    storage.releaseNextWrite()
    expect((await staging).installed).toBe(true)
    expect((await registry.getSnapshot()).installed[0].blueprintVersion).toBe('2.0.0')
  })

  it('keeps rollback atomic across write failure, restart, and retry', async () => {
    const signer = createSigner()
    const v1 = makeSignedFeed(signer, {
      feedId: 'atomic-rollback-v1',
      blueprintId: 'atomic-rollback',
      version: '1.0.0'
    })
    const v2 = makeSignedFeed(signer, {
      feedId: 'atomic-rollback-v2',
      blueprintId: 'atomic-rollback',
      version: '2.0.0'
    })
    const storage = createFailingStorage()
    const options = {
      storage,
      appVersion: '2.53.1',
      pins: [v1.pin, v2.pin],
      trustedKeys: v1.trustedKeys,
      bundledFeeds: {
        [v1.pin.feedId]: v1.envelope,
        [v2.pin.feedId]: v2.envelope
      },
      now: () => NOW
    }
    const registry = new RaceOpsBlueprintRegistry(options)
    await registry.stage(requestFor(v1))
    await registry.stage(requestFor(v2))
    const rollbackRequest = {
      feedId: v2.pin.feedId,
      blueprintId: 'atomic-rollback',
      blueprintVersion: '2.0.0',
      manifestSha256: v2.envelope.payload.entries[0].manifestSha256
    }
    const committed = storage.dump()

    storage.failNextWrite()
    await expect(registry.rollback(rollbackRequest)).rejects.toThrow(
      'injected registry write failure'
    )
    expect((await registry.getSnapshot()).installed[0].blueprintVersion).toBe('2.0.0')
    expect(storage.dump()).toEqual(committed)

    const restarted = new RaceOpsBlueprintRegistry(options)
    expect((await restarted.getSnapshot()).installed[0].blueprintVersion).toBe('2.0.0')
    expect((await restarted.rollback(rollbackRequest)).installed).toBe(true)
    expect((await restarted.getSnapshot()).installed[0].blueprintVersion).toBe('1.0.0')
  })

  it('serializes concurrent stages without losing install history or evidence', async () => {
    const signer = createSigner()
    const v1 = makeSignedFeed(signer, {
      feedId: 'concurrent-stage-v1',
      blueprintId: 'concurrent-stage',
      version: '1.0.0'
    })
    const v2 = makeSignedFeed(signer, {
      feedId: 'concurrent-stage-v2',
      blueprintId: 'concurrent-stage',
      version: '2.0.0'
    })
    const storage = createMemoryRaceOpsRegistryStorage()
    const registry = new RaceOpsBlueprintRegistry({
      storage,
      appVersion: '2.53.1',
      pins: [v1.pin, v2.pin],
      trustedKeys: v1.trustedKeys,
      bundledFeeds: {
        [v1.pin.feedId]: v1.envelope,
        [v2.pin.feedId]: v2.envelope
      },
      now: () => NOW
    })

    await Promise.all([registry.stage(requestFor(v1)), registry.stage(requestFor(v2))])

    const snapshot = await registry.getSnapshot()
    expect(snapshot.installed[0].blueprintVersion).toBe('2.0.0')
    expect(snapshot.evidence).toHaveLength(2)
    const persisted = storage.dump() as {
      installs: Record<string, { history: RaceOpsInstalledBlueprint[] }>
    }
    expect(persisted.installs['concurrent-stage'].history).toEqual([
      expect.objectContaining({ blueprintVersion: '1.0.0' })
    ])
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
