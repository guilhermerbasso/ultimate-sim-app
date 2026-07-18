import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature
} from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  RACEOPS_BLUEPRINT_RUNTIME_VERSION,
  RACEOPS_EVIDENCE_SCHEMA_VERSION,
  RACEOPS_REGISTRY_SCHEMA_VERSION,
  RaceOpsBlueprintError,
  assertRaceOpsAppVersionCompatible,
  canonicalJson,
  compareRaceOpsSemver,
  createRaceOpsBlueprintSelectionRequest,
  dryRunRaceOpsBlueprint,
  fingerprintRaceOpsBlueprintRequest,
  parseRaceOpsRfc3339,
  parseSignedRaceOpsBlueprintFeed,
  resolveRaceOpsBlueprintParameters,
  sameRaceOpsFeedSource,
  type CuratedRaceOpsFeedPin,
  type RaceOpsBlueprintCatalogEntry,
  type RaceOpsBlueprintDryRunResponse,
  type RaceOpsBlueprintFeedEntry,
  type RaceOpsBlueprintOperationIdentity,
  type RaceOpsBlueprintRegistrySnapshot,
  type RaceOpsBlueprintRollbackRequest,
  type RaceOpsBlueprintSelectionRequest,
  type RaceOpsBlueprintStageResponse,
  type RaceOpsCompatibilityEvidence,
  type RaceOpsCompatibilityStatus,
  type RaceOpsFeedStatus,
  type RaceOpsInstalledBlueprint,
  type SignedRaceOpsBlueprintFeed
} from '../../shared/raceops-blueprints'

const MAX_FEED_BYTES = 1024 * 1024
const FETCH_TIMEOUT_MS = 8_000
const MAX_EVIDENCE_RECORDS = 500
const MAX_INSTALL_HISTORY = 20
const MAX_QUARANTINED_FEEDS = 20

export class RaceOpsFeedTransportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RaceOpsFeedTransportError'
  }
}

export function sha256RaceOpsCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

function safeHexEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}

function evidenceCore(
  evidence: Omit<RaceOpsCompatibilityEvidence, 'id'>
): Omit<RaceOpsCompatibilityEvidence, 'id'> {
  return evidence
}

function evidenceId(evidence: Omit<RaceOpsCompatibilityEvidence, 'id'>): string {
  return `raceops-evidence-${sha256RaceOpsCanonical(evidenceCore(evidence))}`
}

function isEvidenceValid(value: unknown): value is RaceOpsCompatibilityEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const evidence = value as RaceOpsCompatibilityEvidence
  if (
    evidence.schemaVersion !== RACEOPS_EVIDENCE_SCHEMA_VERSION ||
    evidence.publisher !== 'ultimate-sim-app/local-conformance-v1' ||
    typeof evidence.id !== 'string'
  ) {
    return false
  }
  try {
    parseRaceOpsRfc3339(evidence.publishedAt, 'evidence.publishedAt')
    compareRaceOpsSemver(evidence.appVersion, evidence.appVersion)
  } catch {
    return false
  }
  const { id: _id, ...core } = evidence
  return evidence.id === evidenceId(core)
}

export interface RaceOpsRegistryStorage {
  read(): Promise<unknown | undefined>
  write(value: unknown): Promise<void>
}

export function createFileRaceOpsRegistryStorage(userDataPath: string): RaceOpsRegistryStorage {
  const filePath = join(userDataPath, 'raceops-blueprints', 'registry.json')
  const nextPath = `${filePath}.next`
  let writeQueue: Promise<void> = Promise.resolve()
  return {
    async read() {
      try {
        return JSON.parse(await readFile(filePath, 'utf8')) as unknown
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
    },
    async write(value) {
      const serialized = `${JSON.stringify(value, null, 2)}\n`
      const write = writeQueue.then(async () => {
        await mkdir(dirname(filePath), { recursive: true })
        await writeFile(nextPath, serialized, 'utf8')
        try {
          await rename(nextPath, filePath)
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (code !== 'EEXIST' && code !== 'EPERM') throw error
          await rm(filePath, { force: true })
          await rename(nextPath, filePath)
        }
      })
      writeQueue = write.catch(() => undefined)
      await write
    }
  }
}

export function createMemoryRaceOpsRegistryStorage(
  seed?: unknown
): RaceOpsRegistryStorage & { dump(): unknown } {
  let value = seed
  return {
    async read() {
      return value === undefined ? undefined : JSON.parse(JSON.stringify(value)) as unknown
    },
    async write(next) {
      value = JSON.parse(JSON.stringify(next)) as unknown
    },
    dump() {
      return value === undefined ? undefined : JSON.parse(JSON.stringify(value)) as unknown
    }
  }
}

export interface CachedRaceOpsFeed {
  feedId: string
  envelope: SignedRaceOpsBlueprintFeed
  envelopeSha256: string
  verifiedAt: string
  origin: 'bundled' | 'network'
}

export interface RaceOpsInstallRecord {
  active: RaceOpsInstalledBlueprint
  history: RaceOpsInstalledBlueprint[]
  quarantined: RaceOpsInstalledBlueprint[]
}

export interface QuarantinedRaceOpsFeed {
  feedId: string
  cached: CachedRaceOpsFeed
  currentPinSha256: string
  quarantinedAt: string
  reason: 'pin-rotation' | 'cache-invalid'
}

export interface RaceOpsRegistryState {
  schemaVersion: typeof RACEOPS_REGISTRY_SCHEMA_VERSION
  feeds: Record<string, CachedRaceOpsFeed>
  installs: Record<string, RaceOpsInstallRecord>
  evidence: RaceOpsCompatibilityEvidence[]
  quarantinedFeeds: QuarantinedRaceOpsFeed[]
}

function emptyState(): RaceOpsRegistryState {
  return {
    schemaVersion: RACEOPS_REGISTRY_SCHEMA_VERSION,
    feeds: {},
    installs: {},
    evidence: [],
    quarantinedFeeds: []
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function isSafeRaceOpsId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-z][a-z0-9-]{0,95}$/.test(value) &&
    value !== 'constructor' &&
    value !== 'prototype' &&
    value !== '__proto__'
  )
}

function isRfc3339(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    parseRaceOpsRfc3339(value)
    return true
  } catch {
    return false
  }
}

function normalizeCachedFeed(value: unknown): CachedRaceOpsFeed | null {
  const record = asObject(value)
  if (
    !record ||
    !isSafeRaceOpsId(record.feedId) ||
    typeof record.envelopeSha256 !== 'string' ||
    !isRfc3339(record.verifiedAt) ||
    (record.origin !== 'bundled' && record.origin !== 'network')
  ) {
    return null
  }
  return {
    feedId: record.feedId,
    envelope: record.envelope as SignedRaceOpsBlueprintFeed,
    envelopeSha256: record.envelopeSha256,
    verifiedAt: record.verifiedAt,
    origin: record.origin
  }
}

function normalizeInstalled(value: unknown): RaceOpsInstalledBlueprint | null {
  const record = asObject(value)
  if (
    !record ||
    !isSafeRaceOpsId(record.blueprintId) ||
    typeof record.blueprintVersion !== 'string' ||
    typeof record.manifestSha256 !== 'string' ||
    typeof record.feedId !== 'string' ||
    typeof record.evidenceId !== 'string' ||
    !isRfc3339(record.stagedAt) ||
    record.execution !== 'disabled-trust-gate' ||
    !asObject(record.parameters)
  ) {
    return null
  }
  return record as unknown as RaceOpsInstalledBlueprint
}

function normalizeQuarantinedFeed(value: unknown): QuarantinedRaceOpsFeed | null {
  const record = asObject(value)
  const cached = normalizeCachedFeed(record?.cached)
  if (
    !record ||
    !cached ||
    record.feedId !== cached.feedId ||
    typeof record.currentPinSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(record.currentPinSha256) ||
    !isRfc3339(record.quarantinedAt) ||
    (record.reason !== 'pin-rotation' && record.reason !== 'cache-invalid')
  ) {
    return null
  }
  return {
    feedId: cached.feedId,
    cached,
    currentPinSha256: record.currentPinSha256.toLowerCase(),
    quarantinedAt: record.quarantinedAt,
    reason: record.reason
  }
}

function normalizeInstallRecord(value: unknown): RaceOpsInstallRecord | null {
  const record = asObject(value)
  if (!record) return null
  const active = normalizeInstalled(record.active)
  if (!active) return null
  const history = Array.isArray(record.history)
    ? record.history.map(normalizeInstalled).filter((item): item is RaceOpsInstalledBlueprint => Boolean(item))
    : []
  const quarantined = Array.isArray(record.quarantined)
    ? record.quarantined
        .map(normalizeInstalled)
        .filter((item): item is RaceOpsInstalledBlueprint => Boolean(item))
    : []
  return { active, history, quarantined }
}

export function migrateRaceOpsRegistryState(value: unknown): RaceOpsRegistryState {
  if (value === undefined) return emptyState()
  const record = asObject(value)
  if (!record || !Number.isSafeInteger(record.schemaVersion)) {
    throw new RaceOpsBlueprintError('INVALID_SCHEMA', 'RaceOps registry state is invalid.')
  }

  if (record.schemaVersion === 1) {
    const state = emptyState()
    const feeds = Array.isArray(record.cachedFeeds) ? record.cachedFeeds : []
    for (const candidate of feeds) {
      const feed = normalizeCachedFeed(candidate)
      if (feed) state.feeds[feed.feedId] = feed
    }
    const installed = Array.isArray(record.installed) ? record.installed : []
    const byBlueprint = new Map<string, RaceOpsInstalledBlueprint[]>()
    for (const candidate of installed) {
      const item = normalizeInstalled(candidate)
      if (!item) continue
      const list = byBlueprint.get(item.blueprintId) ?? []
      list.push(item)
      byBlueprint.set(item.blueprintId, list)
    }
    for (const [blueprintId, versions] of byBlueprint) {
      versions.sort(
        (left, right) =>
          parseRaceOpsRfc3339(left.stagedAt) - parseRaceOpsRfc3339(right.stagedAt)
      )
      const active = versions.at(-1)
      if (!active) continue
      state.installs[blueprintId] = {
        active,
        history: versions.slice(0, -1).slice(-MAX_INSTALL_HISTORY),
        quarantined: []
      }
    }
    state.evidence = Array.isArray(record.evidence)
      ? record.evidence.filter(isEvidenceValid).slice(-MAX_EVIDENCE_RECORDS)
      : []
    return state
  }

  if (record.schemaVersion !== 2 && record.schemaVersion !== RACEOPS_REGISTRY_SCHEMA_VERSION) {
    throw new RaceOpsBlueprintError(
      'UNSUPPORTED_VERSION',
      `Unsupported RaceOps registry schema version ${record.schemaVersion}.`
    )
  }

  const state = emptyState()
  const feedsRecord = asObject(record.feeds) ?? {}
  for (const candidate of Object.values(feedsRecord)) {
    const feed = normalizeCachedFeed(candidate)
    if (feed) state.feeds[feed.feedId] = feed
  }
  const installsRecord = asObject(record.installs) ?? {}
  for (const [blueprintId, candidate] of Object.entries(installsRecord)) {
    const install = normalizeInstallRecord(candidate)
    if (install && install.active.blueprintId === blueprintId) state.installs[blueprintId] = install
  }
  state.evidence = Array.isArray(record.evidence)
    ? record.evidence.filter(isEvidenceValid).slice(-MAX_EVIDENCE_RECORDS)
    : []
  if (record.schemaVersion === RACEOPS_REGISTRY_SCHEMA_VERSION && Array.isArray(record.quarantinedFeeds)) {
    state.quarantinedFeeds = record.quarantinedFeeds
      .map(normalizeQuarantinedFeed)
      .filter((item): item is QuarantinedRaceOpsFeed => Boolean(item))
  }
  return state
}

export interface VerifiedRaceOpsFeed {
  envelope: SignedRaceOpsBlueprintFeed
  envelopeSha256: string
}

export function verifyPinnedRaceOpsFeed(
  pin: CuratedRaceOpsFeedPin,
  value: unknown,
  trustedKeys: Readonly<Record<string, string>>,
  nowMs: number
): VerifiedRaceOpsFeed {
  parseRaceOpsRfc3339(pin.reviewedAt, `curated feed ${pin.feedId} reviewedAt`)
  let endpoint: URL
  try {
    endpoint = new URL(pin.endpoint)
  } catch {
    throw new RaceOpsBlueprintError('INVALID_SCHEMA', `Curated feed ${pin.feedId} has an invalid endpoint.`)
  }
  if (endpoint.protocol !== 'https:') {
    throw new RaceOpsBlueprintError('INVALID_SCHEMA', `Curated feed ${pin.feedId} must use HTTPS.`)
  }

  const envelopeSha256 = sha256RaceOpsCanonical(value)
  if (!safeHexEqual(envelopeSha256, pin.envelopeSha256)) {
    throw new RaceOpsBlueprintError('TAMPERED', `Curated feed ${pin.feedId} failed its hash pin.`)
  }

  const envelope = parseSignedRaceOpsBlueprintFeed(value)
  if (
    envelope.payload.feedId !== pin.feedId ||
    envelope.signature.keyId !== pin.keyId ||
    !sameRaceOpsFeedSource(envelope.payload.source, pin.source) ||
    envelope.payload.source.url !== pin.endpoint
  ) {
    throw new RaceOpsBlueprintError('TAMPERED', `Curated feed ${pin.feedId} metadata does not match its reviewed pin.`)
  }

  const publicKeySpki = trustedKeys[envelope.signature.keyId]
  if (!publicKeySpki) {
    throw new RaceOpsBlueprintError(
      'UNKNOWN_SIGNATURE',
      `Curated feed ${pin.feedId} uses an unknown signing key.`
    )
  }
  let verified = false
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(publicKeySpki, 'base64'),
      format: 'der',
      type: 'spki'
    })
    verified = verifySignature(
      null,
      Buffer.from(canonicalJson(envelope.payload), 'utf8'),
      publicKey,
      Buffer.from(envelope.signature.value, 'base64')
    )
  } catch {
    verified = false
  }
  if (!verified) {
    throw new RaceOpsBlueprintError('TAMPERED', `Curated feed ${pin.feedId} signature is invalid.`)
  }

  const issuedAt = parseRaceOpsRfc3339(envelope.payload.issuedAt)
  const expiresAt = parseRaceOpsRfc3339(envelope.payload.expiresAt)
  if (issuedAt > nowMs + 5 * 60 * 1000) {
    throw new RaceOpsBlueprintError('TAMPERED', `Curated feed ${pin.feedId} is issued in the future.`)
  }
  if (expiresAt <= nowMs) {
    throw new RaceOpsBlueprintError('TAMPERED', `Curated feed ${pin.feedId} metadata is expired.`)
  }

  for (const entry of envelope.payload.entries) {
    const manifestSha256 = sha256RaceOpsCanonical(entry.manifest)
    if (!safeHexEqual(manifestSha256, entry.manifestSha256)) {
      throw new RaceOpsBlueprintError(
        'TAMPERED',
        `Blueprint ${entry.id}@${entry.version} failed its manifest hash.`
      )
    }
    const dryRun = dryRunRaceOpsBlueprint(entry.manifest)
    if (!dryRun.matchesExpected) {
      throw new RaceOpsBlueprintError(
        'TRACE_MISMATCH',
        `Blueprint ${entry.id}@${entry.version} failed its bundled expected trace.`
      )
    }
  }

  return { envelope, envelopeSha256 }
}

export async function fetchPinnedRaceOpsFeed(pin: CuratedRaceOpsFeedPin): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let text = ''
  try {
    const response = await fetch(pin.endpoint, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
      headers: { accept: 'application/json' }
    })
    if (!response.ok) {
      throw new RaceOpsFeedTransportError(
        `Curated feed ${pin.feedId} returned HTTP ${response.status}.`
      )
    }
    const declaredLength = Number(response.headers.get('content-length') ?? 0)
    if (Number.isFinite(declaredLength) && declaredLength > MAX_FEED_BYTES) {
      throw new RaceOpsBlueprintError(
        'TAMPERED',
        `Curated feed ${pin.feedId} exceeds the size limit.`
      )
    }
    if (response.body) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let received = 0
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        received += chunk.value.byteLength
        if (received > MAX_FEED_BYTES) {
          void reader.cancel().catch(() => undefined)
          throw new RaceOpsBlueprintError(
            'TAMPERED',
            `Curated feed ${pin.feedId} exceeds the size limit.`
          )
        }
        text += decoder.decode(chunk.value, { stream: true })
      }
      text += decoder.decode()
    } else {
      text = await response.text()
      if (Buffer.byteLength(text, 'utf8') > MAX_FEED_BYTES) {
        throw new RaceOpsBlueprintError(
          'TAMPERED',
          `Curated feed ${pin.feedId} exceeds the size limit.`
        )
      }
    }
  } catch (error) {
    if (error instanceof RaceOpsBlueprintError || error instanceof RaceOpsFeedTransportError) {
      throw error
    }
    throw new RaceOpsFeedTransportError(`Could not reach curated feed ${pin.feedId}.`, {
      cause: error
    })
  } finally {
    clearTimeout(timeout)
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new RaceOpsBlueprintError('INVALID_SCHEMA', `Curated feed ${pin.feedId} is not valid JSON.`)
  }
}

interface FeedRuntimeStatus {
  fromCache: boolean
  offline: boolean
}

export interface RaceOpsBlueprintRegistryOptions {
  storage: RaceOpsRegistryStorage
  appVersion: string
  pins: readonly CuratedRaceOpsFeedPin[]
  trustedKeys: Readonly<Record<string, string>>
  bundledFeeds?: Readonly<Record<string, unknown>>
  fetchFeed?: (pin: CuratedRaceOpsFeedPin) => Promise<unknown>
  now?: () => number
  runtimeVersion?: number
}

interface Candidate {
  feed: CachedRaceOpsFeed
  entry: RaceOpsBlueprintFeedEntry
}

export class RaceOpsBlueprintRegistry {
  private readonly storage: RaceOpsRegistryStorage
  private readonly appVersion: string
  private readonly pins: Map<string, CuratedRaceOpsFeedPin>
  private readonly trustedKeys: Readonly<Record<string, string>>
  private readonly bundledFeeds: Readonly<Record<string, unknown>>
  private readonly fetchFeed: (pin: CuratedRaceOpsFeedPin) => Promise<unknown>
  private readonly now: () => number
  private readonly runtimeVersion: number
  private readonly runtimeStatus = new Map<string, FeedRuntimeStatus>()
  private state: RaceOpsRegistryState | null = null
  private initialized = false
  private loadPromise: Promise<void> | null = null

  constructor(options: RaceOpsBlueprintRegistryOptions) {
    this.storage = options.storage
    this.appVersion = options.appVersion
    this.pins = new Map(options.pins.map((pin) => [pin.feedId, pin]))
    this.trustedKeys = options.trustedKeys
    this.bundledFeeds = options.bundledFeeds ?? {}
    this.fetchFeed = options.fetchFeed ?? fetchPinnedRaceOpsFeed
    this.now = options.now ?? Date.now
    this.runtimeVersion = options.runtimeVersion ?? RACEOPS_BLUEPRINT_RUNTIME_VERSION
    if (!Number.isSafeInteger(this.runtimeVersion) || this.runtimeVersion < 1) {
      throw new RaceOpsBlueprintError('INVALID_SCHEMA', 'Invalid RaceOps runtime version.')
    }
  }

  async getSnapshot(): Promise<RaceOpsBlueprintRegistrySnapshot> {
    await this.ensureLoaded()
    return this.buildSnapshot()
  }

  async refreshFeed(feedId: string): Promise<RaceOpsBlueprintRegistrySnapshot> {
    await this.ensureLoaded()
    const pin = this.pins.get(feedId)
    if (!pin) {
      throw new RaceOpsBlueprintError('INVALID_SCHEMA', `Unknown curated feed ${feedId}.`)
    }
    try {
      const raw = await this.fetchFeed(pin)
      const verified = verifyPinnedRaceOpsFeed(pin, raw, this.trustedKeys, this.now())
      const cached = this.requireState().feeds[feedId]
      if (cached) {
        const previous = verifyPinnedRaceOpsFeed(pin, cached.envelope, this.trustedKeys, this.now())
        if (verified.envelope.payload.sequence < previous.envelope.payload.sequence) {
          throw new RaceOpsBlueprintError('TAMPERED', `Curated feed ${feedId} attempted a metadata rollback.`)
        }
      }
      this.requireState().feeds[feedId] = {
        feedId,
        envelope: verified.envelope,
        envelopeSha256: verified.envelopeSha256,
        verifiedAt: new Date(this.now()).toISOString(),
        origin: 'network'
      }
      this.runtimeStatus.set(feedId, { fromCache: false, offline: false })
      await this.persist()
    } catch (error) {
      if (!(error instanceof RaceOpsFeedTransportError)) throw error
      const cached = this.requireState().feeds[feedId]
      if (!cached) throw error
      verifyPinnedRaceOpsFeed(pin, cached.envelope, this.trustedKeys, this.now())
      this.runtimeStatus.set(feedId, { fromCache: true, offline: true })
    }
    return this.buildSnapshot()
  }

  async dryRun(request: RaceOpsBlueprintSelectionRequest): Promise<RaceOpsBlueprintDryRunResponse> {
    await this.ensureLoaded()
    const validatedRequest = this.validateSelectionRequest(request)
    const candidate = this.findCandidate(validatedRequest)
    const response = this.evaluate(candidate, validatedRequest, 'dry-run')
    this.appendEvidence(response.evidence)
    await this.persist()
    return response
  }

  async stage(request: RaceOpsBlueprintSelectionRequest): Promise<RaceOpsBlueprintStageResponse> {
    await this.ensureLoaded()
    const validatedRequest = this.validateSelectionRequest(request)
    const candidate = this.findCandidate(validatedRequest)
    const evaluated = this.evaluate(candidate, validatedRequest, 'stage')
    this.appendEvidence(evaluated.evidence)
    if (!evaluated.ok || !evaluated.result) {
      await this.persist()
      return { ...evaluated, installed: false }
    }

    const staged: RaceOpsInstalledBlueprint = {
      blueprintId: candidate.entry.id,
      blueprintVersion: candidate.entry.version,
      manifestSha256: candidate.entry.manifestSha256,
      feedId: candidate.feed.feedId,
      parameters: evaluated.result.parameters,
      evidenceId: evaluated.evidence.id,
      stagedAt: new Date(this.now()).toISOString(),
      execution: 'disabled-trust-gate'
    }
    const existing = this.requireState().installs[staged.blueprintId]
    if (!existing) {
      this.requireState().installs[staged.blueprintId] = {
        active: staged,
        history: [],
        quarantined: []
      }
    } else {
      const unchanged =
        existing.active.feedId === staged.feedId &&
        existing.active.blueprintVersion === staged.blueprintVersion &&
        existing.active.manifestSha256 === staged.manifestSha256 &&
        canonicalJson(existing.active.parameters) === canonicalJson(staged.parameters)
      if (!unchanged) {
        existing.history.push(existing.active)
        existing.history = existing.history.slice(-MAX_INSTALL_HISTORY)
      }
      existing.active = staged
    }
    await this.persist()
    return { ...evaluated, installed: true, staged }
  }

  async rollback(request: RaceOpsBlueprintRollbackRequest): Promise<RaceOpsBlueprintStageResponse> {
    await this.ensureLoaded()
    if (
      !request ||
      typeof request !== 'object' ||
      Object.keys(request).some(
        (key) =>
          !['feedId', 'blueprintId', 'blueprintVersion', 'manifestSha256'].includes(key)
      )
    ) {
      throw new RaceOpsBlueprintError('INVALID_SCHEMA', 'Invalid rollback operation request.')
    }
    const identity = this.validateOperationIdentity(request)
    const blueprintId = identity.blueprintId
    const install = this.requireState().installs[blueprintId]
    if (!install || install.history.length === 0) {
      throw new RaceOpsBlueprintError(
        'ROLLBACK_UNAVAILABLE',
        `No previous validated version is available for ${blueprintId}.`
      )
    }
    if (
      install.active.feedId !== identity.feedId ||
      install.active.blueprintVersion !== identity.blueprintVersion ||
      !safeHexEqual(install.active.manifestSha256, identity.manifestSha256)
    ) {
      throw new RaceOpsBlueprintError(
        'STALE_REQUEST',
        `Rollback identity no longer matches active ${blueprintId}.`
      )
    }
    const previous = install.history.at(-1)
    if (!previous) {
      throw new RaceOpsBlueprintError('ROLLBACK_UNAVAILABLE', `Rollback is unavailable for ${blueprintId}.`)
    }
    const candidate = this.findInstalledCandidate(previous)
    const rollbackRequest = createRaceOpsBlueprintSelectionRequest(
      {
        feedId: previous.feedId,
        blueprintId: previous.blueprintId,
        blueprintVersion: previous.blueprintVersion,
        manifestSha256: previous.manifestSha256
      },
      previous.parameters
    )
    const evaluated = this.evaluate(
      candidate,
      rollbackRequest,
      'rollback'
    )
    this.appendEvidence(evaluated.evidence)
    if (!evaluated.ok || !evaluated.result) {
      await this.persist()
      return { ...evaluated, installed: false }
    }

    install.history.pop()
    install.quarantined.push(install.active)
    install.active = {
      ...previous,
      evidenceId: evaluated.evidence.id,
      stagedAt: new Date(this.now()).toISOString()
    }
    await this.persist()
    return { ...evaluated, installed: true, staged: install.active }
  }

  private evaluate(
    candidate: Candidate,
    request: RaceOpsBlueprintSelectionRequest,
    operation: RaceOpsCompatibilityEvidence['operation']
  ): RaceOpsBlueprintDryRunResponse {
    let status: RaceOpsCompatibilityEvidence['status'] = 'compatible'
    const reasons: string[] = []
    let result: ReturnType<typeof dryRunRaceOpsBlueprint> | undefined
    const resolvedParameters = resolveRaceOpsBlueprintParameters(
      candidate.entry.manifest,
      request.parameters
    )

    try {
      assertRaceOpsAppVersionCompatible(candidate.entry.manifest, this.appVersion)
      if (candidate.entry.manifest.compatibility.runtime !== this.runtimeVersion) {
        status = 'incompatible-runtime'
        reasons.push(
          `Blueprint runtime ${candidate.entry.manifest.compatibility.runtime} does not match app runtime ${this.runtimeVersion}.`
        )
      } else {
        result = dryRunRaceOpsBlueprint(candidate.entry.manifest, resolvedParameters)
      }
      if (result && !result.matchesExpected) {
        status = 'trace-mismatch'
        reasons.push('dry-run trace differs from the signed expected trace')
      }
    } catch (error) {
      if (error instanceof RaceOpsBlueprintError && error.code === 'INCOMPATIBLE_APP') {
        status = 'incompatible-app'
        reasons.push(error.message)
      } else {
        throw error
      }
    }

    const publishedAt = new Date(this.now()).toISOString()
    const core: Omit<RaceOpsCompatibilityEvidence, 'id'> = {
      schemaVersion: RACEOPS_EVIDENCE_SCHEMA_VERSION,
      blueprintId: candidate.entry.id,
      blueprintVersion: candidate.entry.version,
      feedId: candidate.feed.feedId,
      feedEnvelopeSha256: candidate.feed.envelopeSha256,
      signerKeyId: candidate.feed.envelope.signature.keyId,
      manifestSha256: candidate.entry.manifestSha256,
      fixtureSha256: sha256RaceOpsCanonical(candidate.entry.manifest.fixture),
      parametersSha256: sha256RaceOpsCanonical(resolvedParameters),
      traceSha256: sha256RaceOpsCanonical(result?.trace ?? []),
      appVersion: this.appVersion,
      runtimeVersion: this.runtimeVersion,
      publisher: 'ultimate-sim-app/local-conformance-v1',
      operation,
      status,
      reasons,
      publishedAt
    }
    const evidence: RaceOpsCompatibilityEvidence = { id: evidenceId(core), ...core }
    return {
      ok: status === 'compatible',
      requestFingerprint: request.requestFingerprint,
      ...(result ? { result } : {}),
      evidence
    }
  }

  private validateSelectionRequest(
    request: RaceOpsBlueprintSelectionRequest
  ): RaceOpsBlueprintSelectionRequest {
    const identity = this.validateOperationIdentity(request)
    if (
      !request ||
      typeof request !== 'object' ||
      !asObject(request.parameters) ||
      typeof request.requestFingerprint !== 'string' ||
      Object.keys(request).some(
        (key) =>
          ![
            'feedId',
            'blueprintId',
            'blueprintVersion',
            'manifestSha256',
            'parameters',
            'requestFingerprint'
          ].includes(key)
      )
    ) {
      throw new RaceOpsBlueprintError('INVALID_SCHEMA', 'Invalid blueprint selection request.')
    }
    const expectedFingerprint = fingerprintRaceOpsBlueprintRequest({
      ...identity,
      parameters: request.parameters
    })
    if (request.requestFingerprint !== expectedFingerprint) {
      throw new RaceOpsBlueprintError(
        'STALE_REQUEST',
        'Blueprint request fingerprint does not match its operation identity and parameters.'
      )
    }
    return { ...request, ...identity }
  }

  private validateOperationIdentity(
    identity: RaceOpsBlueprintOperationIdentity
  ): RaceOpsBlueprintOperationIdentity {
    if (
      !identity ||
      typeof identity !== 'object' ||
      !isSafeRaceOpsId(identity.feedId) ||
      !isSafeRaceOpsId(identity.blueprintId) ||
      typeof identity.blueprintVersion !== 'string' ||
      typeof identity.manifestSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(identity.manifestSha256)
    ) {
      throw new RaceOpsBlueprintError('INVALID_SCHEMA', 'Invalid blueprint operation identity.')
    }
    compareRaceOpsSemver(identity.blueprintVersion, identity.blueprintVersion)
    return {
      feedId: identity.feedId,
      blueprintId: identity.blueprintId,
      blueprintVersion: identity.blueprintVersion,
      manifestSha256: identity.manifestSha256.toLowerCase()
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.initialized) return
    if (!this.loadPromise) {
      this.loadPromise = this.initialize().finally(() => {
        this.loadPromise = null
      })
    }
    await this.loadPromise
  }

  private async initialize(): Promise<void> {
    const stored = await this.storage.read()
    this.state = migrateRaceOpsRegistryState(stored)
    let changed =
      stored !== undefined &&
      asObject(stored)?.schemaVersion !== RACEOPS_REGISTRY_SCHEMA_VERSION
    const verifiedBundled = new Map<string, VerifiedRaceOpsFeed>()

    for (const [feedId, raw] of Object.entries(this.bundledFeeds)) {
      const pin = this.pins.get(feedId)
      if (!pin) {
        throw new RaceOpsBlueprintError('INVALID_SCHEMA', `Bundled feed ${feedId} has no curated pin.`)
      }
      const verified = verifyPinnedRaceOpsFeed(pin, raw, this.trustedKeys, this.now())
      verifiedBundled.set(feedId, verified)
    }

    for (const [feedId, cached] of Object.entries(this.state.feeds)) {
      const pin = this.pins.get(feedId)
      if (!pin) {
        this.quarantineCachedFeed(cached, 'pin-rotation', '0'.repeat(64))
        delete this.state.feeds[feedId]
        changed = true
        continue
      }
      try {
        const verified = verifyPinnedRaceOpsFeed(pin, cached.envelope, this.trustedKeys, this.now())
        if (!safeHexEqual(cached.envelopeSha256, verified.envelopeSha256)) {
          throw new RaceOpsBlueprintError(
            'TAMPERED',
            `Cached feed ${feedId} hash metadata is inconsistent.`
          )
        }
        this.runtimeStatus.set(feedId, { fromCache: true, offline: false })
      } catch (error) {
        const current = verifiedBundled.get(feedId)
        const actualCachedHash = sha256RaceOpsCanonical(cached.envelope)
        const selfConsistent = safeHexEqual(actualCachedHash, cached.envelopeSha256)
        const pinRotated = !safeHexEqual(cached.envelopeSha256, pin.envelopeSha256)
        if (!current && (!selfConsistent || !pinRotated)) throw error
        this.quarantineCachedFeed(
          cached,
          selfConsistent && pinRotated ? 'pin-rotation' : 'cache-invalid',
          pin.envelopeSha256
        )
        delete this.state.feeds[feedId]
        changed = true
      }
    }

    for (const [feedId, verified] of verifiedBundled) {
      if (this.state.feeds[feedId]) continue
      this.state.feeds[feedId] = {
        feedId,
        envelope: verified.envelope,
        envelopeSha256: verified.envelopeSha256,
        verifiedAt: new Date(this.now()).toISOString(),
        origin: 'bundled'
      }
      this.runtimeStatus.set(feedId, { fromCache: true, offline: false })
      changed = true
    }

    if (changed) await this.persist()
    this.initialized = true
  }

  private quarantineCachedFeed(
    cached: CachedRaceOpsFeed,
    reason: QuarantinedRaceOpsFeed['reason'],
    currentPinSha256: string
  ): void {
    const state = this.requireState()
    const duplicate = state.quarantinedFeeds.some(
      (item) =>
        item.feedId === cached.feedId &&
        safeHexEqual(item.cached.envelopeSha256, cached.envelopeSha256) &&
        safeHexEqual(item.currentPinSha256, currentPinSha256)
    )
    if (duplicate) return
    state.quarantinedFeeds.push({
      feedId: cached.feedId,
      cached,
      currentPinSha256,
      quarantinedAt: new Date(this.now()).toISOString(),
      reason
    })
    state.quarantinedFeeds = state.quarantinedFeeds.slice(-MAX_QUARANTINED_FEEDS)
  }

  private requireState(): RaceOpsRegistryState {
    if (!this.state) throw new Error('RaceOps registry was not initialized.')
    return this.state
  }

  private appendEvidence(evidence: RaceOpsCompatibilityEvidence): void {
    const state = this.requireState()
    state.evidence = [
      ...state.evidence.filter((item) => item.id !== evidence.id),
      evidence
    ].slice(-MAX_EVIDENCE_RECORDS)
  }

  private async persist(): Promise<void> {
    await this.storage.write(this.requireState())
  }

  private verifiedFeeds(): CachedRaceOpsFeed[] {
    return Object.values(this.requireState().feeds).map((cached) => {
      const pin = this.pins.get(cached.feedId)
      if (!pin) {
        throw new RaceOpsBlueprintError('TAMPERED', `Cached feed ${cached.feedId} is no longer curated.`)
      }
      verifyPinnedRaceOpsFeed(pin, cached.envelope, this.trustedKeys, this.now())
      return cached
    })
  }

  private findCandidate(identity: RaceOpsBlueprintOperationIdentity): Candidate {
    const feed = this.verifiedFeeds().find((candidate) => candidate.feedId === identity.feedId)
    if (!feed) {
      throw new RaceOpsBlueprintError('OFFLINE', `Verified feed ${identity.feedId} is unavailable.`)
    }
    const entry = feed.envelope.payload.entries.find(
      (candidate) =>
        candidate.id === identity.blueprintId &&
        candidate.version === identity.blueprintVersion &&
        safeHexEqual(candidate.manifestSha256, identity.manifestSha256)
    )
    if (!entry) {
      throw new RaceOpsBlueprintError(
        'STALE_REQUEST',
        `Blueprint ${identity.blueprintId}@${identity.blueprintVersion} no longer matches verified feed ${identity.feedId}.`
      )
    }
    return { feed, entry }
  }

  private findInstalledCandidate(installed: RaceOpsInstalledBlueprint): Candidate {
    for (const feed of this.verifiedFeeds()) {
      if (feed.feedId !== installed.feedId) continue
      const entry = feed.envelope.payload.entries.find(
        (candidate) =>
          candidate.id === installed.blueprintId &&
          candidate.version === installed.blueprintVersion &&
          safeHexEqual(candidate.manifestSha256, installed.manifestSha256)
      )
      if (entry) return { feed, entry }
    }
    throw new RaceOpsBlueprintError(
      'TAMPERED',
      `Installed blueprint ${installed.blueprintId}@${installed.blueprintVersion} no longer has verified source metadata.`
    )
  }

  private buildSnapshot(): RaceOpsBlueprintRegistrySnapshot {
    const feeds = this.verifiedFeeds()
    const evidence = [...this.requireState().evidence].sort(
      (left, right) =>
        parseRaceOpsRfc3339(right.publishedAt) - parseRaceOpsRfc3339(left.publishedAt)
    )
    const feedStatuses: RaceOpsFeedStatus[] = feeds.map((feed) => {
      const runtime = this.runtimeStatus.get(feed.feedId) ?? { fromCache: true, offline: false }
      const pin = this.pins.get(feed.feedId)
      if (!pin) {
        throw new RaceOpsBlueprintError('TAMPERED', `Cached feed ${feed.feedId} is no longer curated.`)
      }
      return {
        feedId: feed.feedId,
        title: feed.envelope.payload.title,
        source: feed.envelope.payload.source,
        envelopeSha256: feed.envelopeSha256,
        signerKeyId: feed.envelope.signature.keyId,
        reviewedAt: pin.reviewedAt,
        verifiedAt: feed.verifiedAt,
        fromCache: runtime.fromCache,
        offline: runtime.offline,
        sequence: feed.envelope.payload.sequence,
        expiresAt: feed.envelope.payload.expiresAt
      }
    })

    const blueprints: RaceOpsBlueprintCatalogEntry[] = []
    for (const feed of feeds) {
      for (const entry of feed.envelope.payload.entries) {
        const exactEvidence = evidence.find(
          (item) => this.evidenceMatchesCandidate(item, feed, entry)
        )
        const staleEvidence = evidence.some(
          (item) =>
            item.blueprintId === entry.id &&
            item.blueprintVersion === entry.version &&
            !this.evidenceMatchesCandidate(item, feed, entry)
        )
        const compatibilityStatus: RaceOpsCompatibilityStatus = exactEvidence
          ? exactEvidence.status
          : staleEvidence
            ? 'stale'
            : 'unverified'
        const install = this.requireState().installs[entry.id]
        const installed =
          install &&
          install.active.feedId === feed.feedId &&
          install.active.blueprintVersion === entry.version &&
          safeHexEqual(install.active.manifestSha256, entry.manifestSha256)
            ? install
            : undefined
        blueprints.push({
          feedId: feed.feedId,
          feedTitle: feed.envelope.payload.title,
          id: entry.id,
          version: entry.version,
          title: entry.manifest.title,
          summary: entry.manifest.summary,
          author: entry.manifest.author,
          compatibility: entry.manifest.compatibility,
          capabilities: entry.manifest.capabilities,
          parameters: entry.manifest.parameters,
          manifestSha256: entry.manifestSha256,
          compatibilityStatus,
          ...(exactEvidence ? { evidence: exactEvidence } : {}),
          ...(installed ? { installed: installed.active } : {}),
          rollbackAvailable: Boolean(installed?.history.length)
        })
      }
    }

    return {
      appVersion: this.appVersion,
      executionEnabled: false,
      trustGate: 'conformance-required',
      feeds: feedStatuses,
      blueprints: blueprints.sort((left, right) => left.title.localeCompare(right.title)),
      installed: Object.values(this.requireState().installs).map((record) => record.active),
      evidence
    }
  }

  private evidenceMatchesCandidate(
    evidence: RaceOpsCompatibilityEvidence,
    feed: CachedRaceOpsFeed,
    entry: RaceOpsBlueprintFeedEntry
  ): boolean {
    return (
      evidence.appVersion === this.appVersion &&
      evidence.runtimeVersion === this.runtimeVersion &&
      evidence.feedId === feed.feedId &&
      safeHexEqual(evidence.feedEnvelopeSha256, feed.envelopeSha256) &&
      evidence.signerKeyId === feed.envelope.signature.keyId &&
      evidence.blueprintId === entry.id &&
      evidence.blueprintVersion === entry.version &&
      safeHexEqual(evidence.manifestSha256, entry.manifestSha256)
    )
  }
}
