import { createHash, randomUUID } from 'node:crypto'
import {
  createKnownGoodCheck,
  defaultRigPreflightState,
  evaluateRigPreflightChecks,
  normalizeRigPreflightProfile,
  runRigPreflightFaultMatrix,
  summarizeRigPreflightChecks,
  type RigActiveCertificate,
  type RigEvidenceProvenance,
  type RigFaultMatrixRun,
  type RigKnownGood,
  type RigPreflightCertificate,
  type RigPreflightClientEvidence,
  type RigPreflightObservation,
  type RigPreflightPersistedState,
  type RigPreflightProfile,
  type RigPreflightProfilePatch,
  type RigPreflightRevalidationResult,
  type RigPreflightRun,
  type RigPreflightRunRequest,
  type RigPreflightStorageStatus,
  type RigPreflightStateSnapshot,
  type RigPreflightWaiver,
  type RigPreflightWaiverRequest
} from '../../shared/rig-preflight'

const HISTORY_LIMIT = 40
const FAULT_HISTORY_LIMIT = 10
const WAIVER_LIMIT = 100
const MAX_WAIVER_MS = 30 * 24 * 60 * 60_000
export const LEGACY_UNBOUND_PROFILE_HASH = '0'.repeat(64)

export interface RigPreflightPersistence {
  read(): Promise<string | null>
  write(content: string): Promise<void>
  quarantine?(reason: string): Promise<string | null>
}

export interface RigPreflightServiceOptions {
  persistence: RigPreflightPersistence
  collectObservation(
    profile: RigPreflightProfile,
    clientEvidence?: RigPreflightClientEvidence
  ): Promise<RigPreflightObservation>
  now?: () => number
  createId?: () => string
  hash?: (value: unknown) => string
}

export class RigPreflightStorageBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RigPreflightStorageBlockedError'
  }
}

export class RigPreflightProfileConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RigPreflightProfileConflictError'
  }
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((out, key) => {
      out[key] = canonical(record[key])
      return out
    }, {})
}

export function hashRigPreflightValue(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

function profileHashInput(profile: RigPreflightProfile): unknown {
  return {
    version: profile.version,
    id: profile.id,
    name: profile.name,
    owner: profile.owner,
    mode: profile.mode,
    evidenceMaxAgeMs: profile.evidenceMaxAgeMs,
    certificateTtlMs: profile.certificateTtlMs,
    requirements: profile.requirements
  }
}

export function hashRigPreflightProfile(profile: RigPreflightProfile): string {
  return hashRigPreflightValue(profileHashInput(profile))
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

const BOOLEAN_REQUIREMENT_KEYS = [
  'requireSimulator',
  'allowMockSimulator',
  'requireSimX',
  'requireConfiguredSerial',
  'requireEsp32',
  'requireAudioOutput',
  'requireAudioInput',
  'requireTts',
  'requireStt',
  'requireHaptics',
  'requireGamepad',
  'requireControlBindings',
  'requireStreaming',
  'requireStreamingTunnel',
  'requireKnownGood'
] as const

function validStoredProfile(value: unknown): value is RigPreflightProfilePatch {
  if (!isObject(value) || !isObject(value.requirements)) return false
  if (
    value.version !== 1 ||
    typeof value.id !== 'string' ||
    !value.id.trim() ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    typeof value.owner !== 'string' ||
    !value.owner.trim() ||
    (value.mode !== 'configured' && value.mode !== 'full-rig' && value.mode !== 'no-hardware') ||
    typeof value.evidenceMaxAgeMs !== 'number' ||
    !Number.isFinite(value.evidenceMaxAgeMs) ||
    typeof value.certificateTtlMs !== 'number' ||
    !Number.isFinite(value.certificateTtlMs) ||
    value.evidenceMaxAgeMs < 5_000 ||
    value.evidenceMaxAgeMs > 30 * 60_000 ||
    value.certificateTtlMs < 60_000 ||
    value.certificateTtlMs > 24 * 60 * 60_000 ||
    !validTimestamp(value.updatedAt)
  ) return false
  if (
    value.revision !== undefined &&
    (!Number.isInteger(value.revision) || (value.revision as number) < 1)
  ) return false
  if (
    value.hash !== undefined &&
    (typeof value.hash !== 'string' || (value.hash !== '' && !/^[a-f0-9]{64}$/.test(value.hash)))
  ) return false
  for (const key of BOOLEAN_REQUIREMENT_KEYS) {
    if (typeof value.requirements[key] !== 'boolean') return false
  }
  return (
    typeof value.requirements.minDisplays === 'number' &&
    Number.isInteger(value.requirements.minDisplays) &&
    value.requirements.minDisplays >= 0 &&
    value.requirements.minDisplays <= 16 &&
    typeof value.requirements.minDashboardWindows === 'number' &&
    Number.isInteger(value.requirements.minDashboardWindows) &&
    value.requirements.minDashboardWindows >= 0 &&
    value.requirements.minDashboardWindows <= 16 &&
    typeof value.requirements.streamingPort === 'number' &&
    Number.isInteger(value.requirements.streamingPort) &&
    value.requirements.streamingPort >= 0 &&
    value.requirements.streamingPort <= 65_535
  )
}

function validWaiver(value: unknown): value is RigPreflightWaiver {
  if (!isObject(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.checkId === 'string' &&
    typeof value.reason === 'string' &&
    typeof value.owner === 'string' &&
    validTimestamp(value.createdAt) &&
    validTimestamp(value.expiresAt)
  )
}

function validCheckShape(value: unknown): boolean {
  if (!isObject(value)) return false
  return (
    typeof value.id === 'string' &&
    (value.applicability === 'required' || value.applicability === 'not-required') &&
    (value.state === 'verified' ||
      value.state === 'unknown' ||
      value.state === 'fail' ||
      value.state === 'waived-with-reason') &&
    (value.underlyingState === 'verified' ||
      value.underlyingState === 'unknown' ||
      value.underlyingState === 'fail') &&
    typeof value.expected === 'string' &&
    typeof value.observed === 'string' &&
    typeof value.signatureMaterial === 'string' &&
    Array.isArray(value.delta) &&
    Array.isArray(value.provenance) &&
    Array.isArray(value.remediation) &&
    typeof value.observedAt === 'number' &&
    Number.isFinite(value.observedAt) &&
    typeof value.freshUntil === 'number' &&
    Number.isFinite(value.freshUntil)
  )
}

function validOptionalProfileBinding(value: Record<string, unknown>): boolean {
  if (
    value.profileRevision !== undefined &&
    (!Number.isInteger(value.profileRevision) || (value.profileRevision as number) < 0)
  ) return false
  if (
    value.profileHash !== undefined &&
    (typeof value.profileHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.profileHash))
  ) return false
  return true
}

function validCertificateShape(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false
  return (
    typeof value.id === 'string' &&
    validTimestamp(value.issuedAt) &&
    validTimestamp(value.expiresAt) &&
    (value.decision === 'ready' ||
      value.decision === 'ready-with-waivers' ||
      value.decision === 'blocked') &&
    typeof value.signature === 'string' &&
    typeof value.coverage === 'number' &&
    Number.isFinite(value.coverage) &&
    (value.expiryBasis === undefined ||
      value.expiryBasis === 'profile-ttl' ||
      value.expiryBasis === 'waiver') &&
    Array.isArray(value.untestedCheckIds) &&
    Array.isArray(value.waivedCheckIds) &&
    validOptionalProfileBinding(value)
  )
}

function validRunShape(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.profileId === 'string' &&
    typeof value.profileName === 'string' &&
    validTimestamp(value.startedAt) &&
    validTimestamp(value.completedAt) &&
    typeof value.signature === 'string' &&
    Array.isArray(value.checks) &&
    value.checks.every(validCheckShape) &&
    validCertificateShape(value.certificate) &&
    validOptionalProfileBinding(value)
  )
}

function validFaultRun(value: unknown): value is RigFaultMatrixRun {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    validTimestamp(value.runAt) &&
    Array.isArray(value.results) &&
    value.results.every((result) =>
      isObject(result) &&
      typeof result.faultId === 'string' &&
      typeof result.checkId === 'string' &&
      typeof result.detected === 'boolean'
    )
  )
}

function validKnownGood(value: unknown): value is RigKnownGood {
  return (
    isObject(value) &&
    typeof value.signature === 'string' &&
    typeof value.runId === 'string' &&
    validTimestamp(value.acceptedAt) &&
    typeof value.owner === 'string'
  )
}

function validActiveCertificate(value: unknown): value is RigActiveCertificate {
  return (
    isObject(value) &&
    typeof value.runId === 'string' &&
    validCertificateShape(value.certificate) &&
    (value.invalidatedAt === null || validTimestamp(value.invalidatedAt)) &&
    (value.invalidationReason === null || typeof value.invalidationReason === 'string') &&
    Array.isArray(value.invalidationProvenance) &&
    (value.revalidationRequired === undefined || typeof value.revalidationRequired === 'boolean') &&
    (value.lastValidatedAt === undefined || validTimestamp(value.lastValidatedAt))
  )
}

function normalizeRun(value: Record<string, unknown>): RigPreflightRun {
  const certificate = value.certificate as Record<string, unknown>
  if (
    typeof certificate.id !== 'string' ||
    !validTimestamp(certificate.issuedAt) ||
    !validTimestamp(certificate.expiresAt) ||
    (certificate.decision !== 'ready' &&
      certificate.decision !== 'ready-with-waivers' &&
      certificate.decision !== 'blocked') ||
    typeof certificate.signature !== 'string'
  ) {
    throw new RigPreflightStorageBlockedError('Persisted preflight certificate is invalid.')
  }
  return {
    ...(value as unknown as RigPreflightRun),
    profileRevision: finiteNumber(value.profileRevision, 0),
    profileHash:
      typeof value.profileHash === 'string' && value.profileHash
        ? value.profileHash
        : LEGACY_UNBOUND_PROFILE_HASH,
    certificate: {
      ...(certificate as unknown as RigPreflightCertificate),
      expiryBasis: certificate.expiryBasis === 'waiver' ? 'waiver' : 'profile-ttl',
      profileRevision: finiteNumber(certificate.profileRevision, 0),
      profileHash:
        typeof certificate.profileHash === 'string' && certificate.profileHash
          ? certificate.profileHash
          : LEGACY_UNBOUND_PROFILE_HASH
    }
  }
}

export function normalizeRigPreflightState(
  raw: unknown,
  now = Date.now()
): RigPreflightPersistedState {
  if (
    !isObject(raw) ||
    raw.version !== 1 ||
    !validStoredProfile(raw.profile) ||
    !validTimestamp(raw.updatedAt)
  ) {
    throw new RigPreflightStorageBlockedError('Persisted rig preflight state/profile is invalid.')
  }
  const normalizedProfile = normalizeRigPreflightProfile(raw.profile, now)
  normalizedProfile.hash = hashRigPreflightProfile(normalizedProfile)
  if (
    typeof raw.profile.hash === 'string' &&
    raw.profile.hash &&
    raw.profile.hash !== normalizedProfile.hash
  ) {
    throw new RigPreflightStorageBlockedError('Persisted rig profile hash does not match its contents.')
  }
  if (
    !Array.isArray(raw.waivers) ||
    !raw.waivers.every(validWaiver) ||
    !Array.isArray(raw.history) ||
    !raw.history.every(validRunShape) ||
    !Array.isArray(raw.faultHistory) ||
    !raw.faultHistory.every(validFaultRun) ||
    (raw.knownGood !== null && !validKnownGood(raw.knownGood)) ||
    (raw.activeCertificate !== null && !validActiveCertificate(raw.activeCertificate))
  ) {
    throw new RigPreflightStorageBlockedError('Persisted rig preflight evidence collections are invalid.')
  }
  const history = raw.history.map((run) => normalizeRun(run))
  const activeCertificate = raw.activeCertificate
    ? {
        ...raw.activeCertificate,
        certificate: normalizeRun(
          {
            id: raw.activeCertificate.runId,
            profileId: normalizedProfile.id,
            profileName: normalizedProfile.name,
            startedAt: raw.activeCertificate.certificate.issuedAt,
            completedAt: raw.activeCertificate.certificate.issuedAt,
            signature: raw.activeCertificate.certificate.signature,
            checks: [],
            certificate: raw.activeCertificate.certificate
          }
        ).certificate,
        revalidationRequired: Boolean(raw.activeCertificate.revalidationRequired),
        lastValidatedAt: finiteNumber(
          raw.activeCertificate.lastValidatedAt,
          raw.activeCertificate.certificate.issuedAt
        )
      }
    : null
  return {
    version: 1,
    profile: normalizedProfile,
    waivers: raw.waivers.sort((a, b) => b.createdAt - a.createdAt).slice(0, WAIVER_LIMIT),
    history: history.sort((a, b) => b.completedAt - a.completedAt).slice(0, HISTORY_LIMIT),
    faultHistory: raw.faultHistory.sort((a, b) => b.runAt - a.runAt).slice(0, FAULT_HISTORY_LIMIT),
    knownGood: raw.knownGood,
    activeCertificate,
    updatedAt: finiteNumber(raw.updatedAt, now)
  }
}

function signatureInput(profile: RigPreflightProfile, checks: RigPreflightRun['checks']): unknown {
  return {
    profile: {
      mode: profile.mode,
      requirements: profile.requirements
    },
    checks: checks.map((check) => ({
      id: check.id,
      applicability: check.applicability,
      expected: check.expected,
      observed: check.signatureMaterial,
      underlyingState: check.underlyingState
    }))
  }
}

function waiverHashInput(waivers: RigPreflightWaiver[]): unknown {
  return [...waivers]
    .sort((a, b) => a.id.localeCompare(b.id, 'en'))
    .map((waiver) => ({
      id: waiver.id,
      checkId: waiver.checkId,
      reason: waiver.reason,
      owner: waiver.owner,
      createdAt: waiver.createdAt,
      expiresAt: waiver.expiresAt
    }))
}

function cleanText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${label} is required.`)
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${label} is required.`)
  return trimmed.slice(0, max)
}

export class RigPreflightService {
  private state: RigPreflightPersistedState
  private storage: RigPreflightStorageStatus
  private loadPromise: Promise<void> | null = null
  private writeQueue: Promise<void> = Promise.resolve()
  private readonly now: () => number
  private readonly createId: () => string
  private readonly hash: (value: unknown) => string

  constructor(private readonly options: RigPreflightServiceOptions) {
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? randomUUID
    this.hash = options.hash ?? hashRigPreflightValue
    this.state = defaultRigPreflightState(this.now())
    this.state.profile.hash = this.profileHash(this.state.profile)
    this.storage = {
      state: 'missing',
      blocked: false,
      message: null,
      quarantinePath: null,
      occurredAt: null
    }
  }

  async getState(): Promise<RigPreflightStateSnapshot> {
    await this.ensureLoaded()
    const now = this.now()
    return {
      ...deepClone(this.state),
      activeCertificateExpired: Boolean(
        this.state.activeCertificate &&
        this.state.activeCertificate.certificate.expiresAt <= now
      ),
      activeCertificateRevalidationRequired: Boolean(
        this.state.activeCertificate?.revalidationRequired
      ),
      storage: deepClone(this.storage)
    }
  }

  async setProfile(input: RigPreflightProfilePatch): Promise<RigPreflightStateSnapshot> {
    await this.ensureLoaded()
    const now = this.now()
    this.assertProfileRevision(input)
    const previous = deepClone(this.state)
    const candidate = normalizeRigPreflightProfile(
      {
        ...this.state.profile,
        ...input,
        requirements: {
          ...this.state.profile.requirements,
          ...(input.requirements ?? {})
        },
        revision: this.state.profile.revision + 1,
        hash: '',
        updatedAt: now
      },
      now
    )
    candidate.hash = this.profileHash(candidate)
    this.state.profile = candidate
    this.state.knownGood = null
    this.invalidateActiveCertificateInMemory(
      'Rig profile changed after certificate issue.',
      [{ kind: 'config', source: 'rig-preflight profile', detail: 'Desired state changed' }],
      now
    )
    this.state.updatedAt = now
    await this.commit(previous, true)
    return this.getState()
  }

  async run(request: RigPreflightRunRequest): Promise<RigPreflightRun> {
    await this.ensureLoaded()
    this.assertStorageHealthy()
    this.assertRequestedProfile(request?.profile)
    const startedAt = this.now()
    const profile = deepClone(this.state.profile)
    const waivers = deepClone(this.state.waivers)
    const waiverHash = this.hash(waiverHashInput(waivers))
    const observation = await this.options.collectObservation(profile, request.clientEvidence)
    const completedAt = this.now()
    this.assertProfileStillCurrent(profile)
    if (this.hash(waiverHashInput(this.state.waivers)) !== waiverHash) {
      throw new RigPreflightProfileConflictError(
        'Run rejected because waivers changed while evidence was being collected.'
      )
    }
    const baseChecks = evaluateRigPreflightChecks(
      profile,
      observation,
      waivers,
      completedAt
    )
    const signature = this.hash(signatureInput(profile, baseChecks))
    const knownGoodCheck = createKnownGoodCheck(
      profile,
      signature,
      this.state.knownGood,
      waivers,
      completedAt
    )
    const checks = [...baseChecks, knownGoodCheck]
    const summary = summarizeRigPreflightChecks(checks)
    const knownGoodSignature = this.state.knownGood?.signature ?? null
    const drift: RigPreflightCertificate['drift'] = !profile.requirements.requireKnownGood
      ? 'not-required'
      : !knownGoodSignature
        ? 'not-established'
        : knownGoodSignature === signature
          ? 'match'
          : 'mismatch'
    const activeWaiverExpiries = checks
      .filter((check) => check.state === 'waived-with-reason' && check.waiver)
      .map((check) => check.waiver!.expiresAt)
    const ttlExpiry = completedAt + profile.certificateTtlMs
    const waiverExpiry = activeWaiverExpiries.length > 0
      ? Math.min(...activeWaiverExpiries)
      : Number.POSITIVE_INFINITY
    const expiresAt = Math.min(ttlExpiry, waiverExpiry)
    const certificate: RigPreflightCertificate = {
      id: this.createId(),
      issuedAt: completedAt,
      expiresAt,
      expiryBasis: waiverExpiry < ttlExpiry ? 'waiver' : 'profile-ttl',
      decision: summary.decision,
      coverage: summary.coverage,
      signature,
      profileRevision: profile.revision,
      profileHash: profile.hash,
      knownGoodSignature,
      drift,
      counts: summary.counts,
      untestedCheckIds: summary.untestedCheckIds,
      waivedCheckIds: summary.waivedCheckIds
    }
    const eligibleAsKnownGood = baseChecks
      .filter((check) => check.applicability === 'required')
      .every((check) => check.underlyingState === 'verified')
    const run: RigPreflightRun = {
      id: this.createId(),
      profileId: profile.id,
      profileName: profile.name,
      profileRevision: profile.revision,
      profileHash: profile.hash,
      startedAt,
      completedAt,
      signature,
      checks,
      certificate,
      eligibleAsKnownGood
    }
    const previous = deepClone(this.state)
    this.state.history = [run, ...this.state.history].slice(0, HISTORY_LIMIT)
    this.state.activeCertificate = {
      runId: run.id,
      certificate,
      invalidatedAt: null,
      invalidationReason: null,
      invalidationProvenance: [],
      revalidationRequired: false,
      lastValidatedAt: completedAt
    }
    this.state.updatedAt = completedAt
    await this.commit(previous)
    return deepClone(run)
  }

  async createWaiver(request: RigPreflightWaiverRequest): Promise<RigPreflightStateSnapshot> {
    await this.ensureLoaded()
    this.assertStorageHealthy()
    const now = this.now()
    const checkId = cleanText(request.checkId, 'Check', 160)
    const reason = cleanText(request.reason, 'Waiver reason', 500)
    const owner = cleanText(request.owner, 'Waiver owner', 120)
    const expiresAt = finiteNumber(request.expiresAt, 0)
    if (expiresAt <= now) throw new Error('Waiver expiry must be in the future.')
    if (expiresAt - now > MAX_WAIVER_MS) throw new Error('Waiver expiry cannot exceed 30 days.')
    const waiver: RigPreflightWaiver = {
      id: this.createId(),
      checkId,
      reason,
      owner,
      createdAt: now,
      expiresAt
    }
    const previous = deepClone(this.state)
    this.state.waivers = [
      waiver,
      ...this.state.waivers.filter((candidate) => candidate.checkId !== checkId)
    ].slice(0, WAIVER_LIMIT)
    this.invalidateActiveCertificateInMemory(
      `Waiver changed for ${checkId}.`,
      [{ kind: 'waiver', source: owner, detail: reason }],
      now
    )
    this.state.updatedAt = now
    await this.commit(previous)
    return this.getState()
  }

  async removeWaiver(id: string): Promise<RigPreflightStateSnapshot> {
    await this.ensureLoaded()
    this.assertStorageHealthy()
    const waiverId = cleanText(id, 'Waiver id', 160)
    const before = this.state.waivers.length
    const previous = deepClone(this.state)
    this.state.waivers = this.state.waivers.filter((waiver) => waiver.id !== waiverId)
    if (this.state.waivers.length !== before) {
      const now = this.now()
      this.invalidateActiveCertificateInMemory(
        'A waiver was removed after certificate issue.',
        [{ kind: 'waiver', source: 'rig-preflight waiver store', detail: waiverId }],
        now
      )
      this.state.updatedAt = now
      await this.commit(previous)
    }
    return this.getState()
  }

  async acceptKnownGood(runId: string, owner?: string): Promise<RigPreflightStateSnapshot> {
    await this.ensureLoaded()
    this.assertStorageHealthy()
    const id = cleanText(runId, 'Run id', 160)
    const run = this.state.history.find((candidate) => candidate.id === id)
    if (!run) throw new Error('Preflight run not found.')
    if (
      run.profileRevision !== this.state.profile.revision ||
      run.profileHash !== this.state.profile.hash
    ) {
      throw new RigPreflightProfileConflictError(
        'Known-good acceptance requires a run bound to the current saved profile revision/hash.'
      )
    }
    if (!run.eligibleAsKnownGood) {
      throw new Error('Only a run with every required non-baseline check verified can become known-good.')
    }
    const now = this.now()
    const previous = deepClone(this.state)
    this.state.knownGood = {
      signature: run.signature,
      runId: run.id,
      acceptedAt: now,
      owner: cleanText(owner ?? this.state.profile.owner, 'Known-good owner', 120)
    }
    this.invalidateActiveCertificateInMemory(
      'Known-good baseline changed; rerun preflight.',
      [{ kind: 'config', source: 'rig-preflight baseline', detail: run.id }],
      now
    )
    this.state.updatedAt = now
    await this.commit(previous)
    return this.getState()
  }

  async runFaultMatrix(request: RigPreflightRunRequest): Promise<RigFaultMatrixRun> {
    await this.ensureLoaded()
    this.assertStorageHealthy()
    this.assertRequestedProfile(request?.profile)
    const now = this.now()
    const profile = deepClone(this.state.profile)
    const observation = await this.options.collectObservation(profile, request.clientEvidence)
    this.assertProfileStillCurrent(profile)
    const results = runRigPreflightFaultMatrix(profile, observation, now)
    const record: RigFaultMatrixRun = {
      id: this.createId(),
      runAt: now,
      passed: results.filter((result) => result.detected).length,
      total: results.length,
      results
    }
    const previous = deepClone(this.state)
    this.state.faultHistory = [record, ...this.state.faultHistory].slice(0, FAULT_HISTORY_LIMIT)
    this.state.updatedAt = now
    await this.commit(previous)
    return deepClone(record)
  }

  async requireStartupRevalidation(): Promise<boolean> {
    await this.ensureLoaded()
    if (this.storage.blocked) return false
    const active = this.state.activeCertificate
    if (
      !active ||
      active.invalidatedAt !== null ||
      active.certificate.decision === 'blocked'
    ) return false
    if (active.certificate.expiresAt <= this.now()) {
      return this.expireActiveCertificate()
    }
    if (active.revalidationRequired) return false
    const previous = deepClone(this.state)
    active.revalidationRequired = true
    this.state.updatedAt = this.now()
    await this.commit(previous)
    return true
  }

  async revalidate(request: RigPreflightRunRequest): Promise<RigPreflightRevalidationResult> {
    await this.ensureLoaded()
    this.assertStorageHealthy()
    const active = this.state.activeCertificate
    if (
      !active ||
      active.invalidatedAt !== null ||
      active.certificate.decision === 'blocked'
    ) return { changed: false, status: 'idle' }
    if (active.certificate.expiresAt <= this.now()) {
      const changed = await this.expireActiveCertificate()
      return { changed, status: 'expired', reason: 'Certificate expired.' }
    }
    this.assertRequestedProfile(request?.profile)
    const profile = deepClone(this.state.profile)
    if (
      active.certificate.profileRevision !== profile.revision ||
      active.certificate.profileHash !== profile.hash
    ) {
      const reason = 'Active certificate profile revision/hash no longer matches the saved profile.'
      const changed = await this.invalidateActiveCertificate(
        reason,
        [{ kind: 'config', source: 'rig-preflight profile binding' }]
      )
      return { changed, status: 'invalidated', reason }
    }

    const observation = await this.options.collectObservation(profile, request.clientEvidence)
    const completedAt = this.now()
    this.assertProfileStillCurrent(profile)
    const checks = evaluateRigPreflightChecks(
      profile,
      observation,
      this.state.waivers,
      completedAt
    )
    const required = checks.filter((check) => check.applicability === 'required')
    const notReady = required.filter(
      (check) => check.state !== 'verified' && check.state !== 'waived-with-reason'
    )
    const signature = this.hash(signatureInput(profile, checks))
    if (notReady.length > 0 || signature !== active.certificate.signature) {
      const reason = notReady.length > 0
        ? `Fresh revalidation failed: ${notReady.map((check) => check.id).join(', ')}.`
        : 'Fresh revalidation detected desired/reported identity drift.'
      const changed = await this.invalidateActiveCertificate(
        reason,
        [{ kind: 'runtime', source: 'full rig evidence monitor' }]
      )
      return { changed, status: 'invalidated', reason }
    }

    if (!active.revalidationRequired) {
      return { changed: false, status: 'verified' }
    }
    const previous = deepClone(this.state)
    active.revalidationRequired = false
    active.lastValidatedAt = completedAt
    this.state.updatedAt = completedAt
    await this.commit(previous)
    return { changed: true, status: 'verified' }
  }

  async expireActiveCertificate(): Promise<boolean> {
    await this.ensureLoaded()
    const active = this.state.activeCertificate
    const now = this.now()
    if (
      !active ||
      active.invalidatedAt !== null ||
      active.certificate.expiresAt > now
    ) return false
    const reason = active.certificate.expiryBasis === 'waiver'
      ? 'Certificate expired at the earliest active waiver expiry.'
      : 'Certificate expired at its profile TTL.'
    return this.invalidateActiveCertificate(
      reason,
      [{ kind: 'runtime', source: 'rig-preflight expiry scheduler' }]
    )
  }

  async invalidateActiveCertificate(
    reason: string,
    provenance: RigEvidenceProvenance[]
  ): Promise<boolean> {
    await this.ensureLoaded()
    const previous = deepClone(this.state)
    const changed = this.invalidateActiveCertificateInMemory(reason, provenance, this.now())
    if (changed) await this.commit(previous)
    return changed
  }

  private invalidateActiveCertificateInMemory(
    reason: string,
    provenance: RigEvidenceProvenance[],
    now: number
  ): boolean {
    const active = this.state.activeCertificate
    if (!active || active.invalidatedAt !== null) return false
    active.invalidatedAt = now
    active.invalidationReason = reason.slice(0, 500)
    active.invalidationProvenance = deepClone(provenance)
    active.revalidationRequired = false
    this.state.updatedAt = now
    return true
  }

  private profileHash(profile: RigPreflightProfile): string {
    return this.hash(profileHashInput(profile))
  }

  private assertStorageHealthy(): void {
    if (!this.storage.blocked) return
    throw new RigPreflightStorageBlockedError(
      this.storage.message || 'Rig preflight storage is blocked until the profile is explicitly recovered.'
    )
  }

  private assertProfileRevision(input: RigPreflightProfilePatch): void {
    if (
      input.revision !== this.state.profile.revision ||
      input.hash !== this.state.profile.hash
    ) {
      throw new RigPreflightProfileConflictError(
        'Saved rig profile changed concurrently. Reload it before saving.'
      )
    }
  }

  private assertRequestedProfile(profile: RigPreflightProfile | null | undefined): void {
    if (!profile) {
      throw new RigPreflightProfileConflictError('Run request must include the saved rig profile revision/hash.')
    }
    if (
      profile.revision !== this.state.profile.revision ||
      profile.hash !== this.state.profile.hash
    ) {
      throw new RigPreflightProfileConflictError(
        'Run rejected because the saved rig profile revision/hash changed.'
      )
    }
    const requestedHash = this.profileHash(profile)
    if (requestedHash !== this.state.profile.hash) {
      throw new RigPreflightProfileConflictError(
        'Run rejected because the UI contains unsaved rig profile changes.'
      )
    }
  }

  private assertProfileStillCurrent(profile: RigPreflightProfile): void {
    if (
      profile.revision !== this.state.profile.revision ||
      profile.hash !== this.state.profile.hash
    ) {
      throw new RigPreflightProfileConflictError(
        'Run rejected because the rig profile changed while evidence was being collected.'
      )
    }
  }

  private failClosedState(now: number): RigPreflightPersistedState {
    const state = defaultRigPreflightState(now)
    state.profile = normalizeRigPreflightProfile(
      {
        ...state.profile,
        mode: 'full-rig',
        requirements: {
          ...state.profile.requirements,
          requireSimulator: true,
          minDisplays: 1,
          minDashboardWindows: 1,
          requireSimX: true,
          requireConfiguredSerial: true,
          requireEsp32: true,
          requireAudioOutput: true,
          requireAudioInput: true,
          requireTts: true,
          requireStt: true,
          requireHaptics: true,
          requireGamepad: true,
          requireControlBindings: true,
          requireStreaming: true,
          requireStreamingTunnel: true,
          requireKnownGood: true
        },
        revision: 1,
        hash: '',
        updatedAt: now
      },
      now
    )
    state.profile.hash = this.profileHash(state.profile)
    return state
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        const now = this.now()
        try {
          const content = await this.options.persistence.read()
          if (!content) {
            this.state = defaultRigPreflightState(now)
            this.state.profile.hash = this.profileHash(this.state.profile)
            this.storage = {
              state: 'missing',
              blocked: false,
              message: null,
              quarantinePath: null,
              occurredAt: null
            }
            return
          }
          try {
            this.state = normalizeRigPreflightState(JSON.parse(content) as unknown, now)
            this.storage = {
              state: 'ok',
              blocked: false,
              message: null,
              quarantinePath: null,
              occurredAt: null
            }
          } catch (error) {
            let quarantinePath: string | null = null
            try {
              quarantinePath = await this.options.persistence.quarantine?.(
                error instanceof Error ? error.message : String(error)
              ) ?? null
            } catch (quarantineError) {
              this.state = this.failClosedState(now)
              this.storage = {
                state: 'error',
                blocked: true,
                message: `Corrupt rig preflight storage could not be quarantined: ${
                  quarantineError instanceof Error ? quarantineError.message : String(quarantineError)
                }`,
                quarantinePath: null,
                occurredAt: now
              }
              return
            }
            this.state = this.failClosedState(now)
            this.storage = {
              state: 'quarantined',
              blocked: true,
              message: error instanceof Error ? error.message : String(error),
              quarantinePath,
              occurredAt: now
            }
          }
        } catch (error) {
          this.state = this.failClosedState(now)
          this.storage = {
            state: 'error',
            blocked: true,
            message: `Rig preflight storage read failed: ${error instanceof Error ? error.message : String(error)}`,
            quarantinePath: null,
            occurredAt: now
          }
        }
      })()
    }
    await this.loadPromise
  }

  private async commit(previous: RigPreflightPersistedState, recoverStorage = false): Promise<void> {
    try {
      await this.persist()
      if (recoverStorage || !this.storage.blocked) {
        this.storage = {
          state: 'ok',
          blocked: false,
          message: null,
          quarantinePath: this.storage.quarantinePath,
          occurredAt: null
        }
      }
    } catch (error) {
      this.state = previous
      this.storage = {
        state: 'error',
        blocked: true,
        message: `Rig preflight storage write failed: ${error instanceof Error ? error.message : String(error)}`,
        quarantinePath: this.storage.quarantinePath,
        occurredAt: this.now()
      }
      throw new RigPreflightStorageBlockedError(
        this.storage.message || 'Rig preflight storage write failed.'
      )
    }
  }

  private persist(): Promise<void> {
    const content = `${JSON.stringify(this.state, null, 2)}\n`
    const write = this.writeQueue.then(
      () => this.options.persistence.write(content),
      () => this.options.persistence.write(content)
    )
    this.writeQueue = write.catch(() => undefined)
    return write
  }
}
