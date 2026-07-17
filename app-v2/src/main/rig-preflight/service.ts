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
  type RigPreflightRun,
  type RigPreflightRunRequest,
  type RigPreflightStateSnapshot,
  type RigPreflightWaiver,
  type RigPreflightWaiverRequest
} from '../../shared/rig-preflight'

const HISTORY_LIMIT = 40
const FAULT_HISTORY_LIMIT = 10
const WAIVER_LIMIT = 100
const MAX_WAIVER_MS = 30 * 24 * 60 * 60_000

export interface RigPreflightPersistence {
  read(): Promise<string | null>
  write(content: string): Promise<void>
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

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function validWaiver(value: unknown): value is RigPreflightWaiver {
  if (!isObject(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.checkId === 'string' &&
    typeof value.reason === 'string' &&
    typeof value.owner === 'string' &&
    typeof value.createdAt === 'number' &&
    typeof value.expiresAt === 'number'
  )
}

function validRun(value: unknown): value is RigPreflightRun {
  if (!isObject(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.profileId === 'string' &&
    typeof value.startedAt === 'number' &&
    typeof value.completedAt === 'number' &&
    typeof value.signature === 'string' &&
    Array.isArray(value.checks) &&
    isObject(value.certificate)
  )
}

function validFaultRun(value: unknown): value is RigFaultMatrixRun {
  return isObject(value) && typeof value.id === 'string' && typeof value.runAt === 'number' && Array.isArray(value.results)
}

function validKnownGood(value: unknown): value is RigKnownGood {
  return (
    isObject(value) &&
    typeof value.signature === 'string' &&
    typeof value.runId === 'string' &&
    typeof value.acceptedAt === 'number' &&
    typeof value.owner === 'string'
  )
}

function validActiveCertificate(value: unknown): value is RigActiveCertificate {
  return (
    isObject(value) &&
    typeof value.runId === 'string' &&
    isObject(value.certificate) &&
    (value.invalidatedAt === null || typeof value.invalidatedAt === 'number') &&
    (value.invalidationReason === null || typeof value.invalidationReason === 'string') &&
    Array.isArray(value.invalidationProvenance)
  )
}

export function normalizeRigPreflightState(
  raw: unknown,
  now = Date.now()
): RigPreflightPersistedState {
  const fallback = defaultRigPreflightState(now)
  if (!isObject(raw)) return fallback
  return {
    version: 1,
    profile: normalizeRigPreflightProfile(
      isObject(raw.profile) ? (raw.profile as RigPreflightProfilePatch) : undefined,
      now
    ),
    waivers: Array.isArray(raw.waivers)
      ? raw.waivers.filter(validWaiver).sort((a, b) => b.createdAt - a.createdAt).slice(0, WAIVER_LIMIT)
      : [],
    history: Array.isArray(raw.history)
      ? raw.history.filter(validRun).sort((a, b) => b.completedAt - a.completedAt).slice(0, HISTORY_LIMIT)
      : [],
    faultHistory: Array.isArray(raw.faultHistory)
      ? raw.faultHistory.filter(validFaultRun).sort((a, b) => b.runAt - a.runAt).slice(0, FAULT_HISTORY_LIMIT)
      : [],
    knownGood: validKnownGood(raw.knownGood) ? raw.knownGood : null,
    activeCertificate: validActiveCertificate(raw.activeCertificate) ? raw.activeCertificate : null,
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

function cleanText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${label} is required.`)
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${label} is required.`)
  return trimmed.slice(0, max)
}

export class RigPreflightService {
  private state: RigPreflightPersistedState
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
  }

  async getState(): Promise<RigPreflightStateSnapshot> {
    await this.ensureLoaded()
    const now = this.now()
    return {
      ...deepClone(this.state),
      activeCertificateExpired: Boolean(
        this.state.activeCertificate &&
        this.state.activeCertificate.certificate.expiresAt <= now
      )
    }
  }

  async setProfile(input: RigPreflightProfilePatch): Promise<RigPreflightStateSnapshot> {
    await this.ensureLoaded()
    const now = this.now()
    this.state.profile = normalizeRigPreflightProfile(
      {
        ...this.state.profile,
        ...input,
        requirements: {
          ...this.state.profile.requirements,
          ...(input.requirements ?? {})
        },
        updatedAt: now
      },
      now
    )
    this.invalidateActiveCertificateInMemory(
      'Rig profile changed after certificate issue.',
      [{ kind: 'config', source: 'rig-preflight profile', detail: 'Desired state changed' }],
      now
    )
    this.state.updatedAt = now
    await this.persist()
    return this.getState()
  }

  async run(request: RigPreflightRunRequest = {}): Promise<RigPreflightRun> {
    await this.ensureLoaded()
    const startedAt = this.now()
    const profile = deepClone(this.state.profile)
    const observation = await this.options.collectObservation(profile, request.clientEvidence)
    const completedAt = this.now()
    const baseChecks = evaluateRigPreflightChecks(
      profile,
      observation,
      this.state.waivers,
      completedAt
    )
    const signature = this.hash(signatureInput(profile, baseChecks))
    const knownGoodCheck = createKnownGoodCheck(
      profile,
      signature,
      this.state.knownGood,
      this.state.waivers,
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
    const certificate: RigPreflightCertificate = {
      id: this.createId(),
      issuedAt: completedAt,
      expiresAt: completedAt + profile.certificateTtlMs,
      decision: summary.decision,
      coverage: summary.coverage,
      signature,
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
      startedAt,
      completedAt,
      signature,
      checks,
      certificate,
      eligibleAsKnownGood
    }
    this.state.history = [run, ...this.state.history].slice(0, HISTORY_LIMIT)
    this.state.activeCertificate = {
      runId: run.id,
      certificate,
      invalidatedAt: null,
      invalidationReason: null,
      invalidationProvenance: []
    }
    this.state.updatedAt = completedAt
    await this.persist()
    return deepClone(run)
  }

  async createWaiver(request: RigPreflightWaiverRequest): Promise<RigPreflightStateSnapshot> {
    await this.ensureLoaded()
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
    await this.persist()
    return this.getState()
  }

  async removeWaiver(id: string): Promise<RigPreflightStateSnapshot> {
    await this.ensureLoaded()
    const waiverId = cleanText(id, 'Waiver id', 160)
    const before = this.state.waivers.length
    this.state.waivers = this.state.waivers.filter((waiver) => waiver.id !== waiverId)
    if (this.state.waivers.length !== before) {
      const now = this.now()
      this.invalidateActiveCertificateInMemory(
        'A waiver was removed after certificate issue.',
        [{ kind: 'waiver', source: 'rig-preflight waiver store', detail: waiverId }],
        now
      )
      this.state.updatedAt = now
      await this.persist()
    }
    return this.getState()
  }

  async acceptKnownGood(runId: string, owner?: string): Promise<RigPreflightStateSnapshot> {
    await this.ensureLoaded()
    const id = cleanText(runId, 'Run id', 160)
    const run = this.state.history.find((candidate) => candidate.id === id)
    if (!run) throw new Error('Preflight run not found.')
    if (!run.eligibleAsKnownGood) {
      throw new Error('Only a run with every required non-baseline check verified can become known-good.')
    }
    const now = this.now()
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
    await this.persist()
    return this.getState()
  }

  async runFaultMatrix(clientEvidence?: RigPreflightClientEvidence): Promise<RigFaultMatrixRun> {
    await this.ensureLoaded()
    const now = this.now()
    const profile = deepClone(this.state.profile)
    const observation = await this.options.collectObservation(profile, clientEvidence)
    const results = runRigPreflightFaultMatrix(profile, observation, now)
    const record: RigFaultMatrixRun = {
      id: this.createId(),
      runAt: now,
      passed: results.filter((result) => result.detected).length,
      total: results.length,
      results
    }
    this.state.faultHistory = [record, ...this.state.faultHistory].slice(0, FAULT_HISTORY_LIMIT)
    this.state.updatedAt = now
    await this.persist()
    return deepClone(record)
  }

  async invalidateActiveCertificate(
    reason: string,
    provenance: RigEvidenceProvenance[]
  ): Promise<boolean> {
    await this.ensureLoaded()
    const changed = this.invalidateActiveCertificateInMemory(reason, provenance, this.now())
    if (changed) await this.persist()
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
    this.state.updatedAt = now
    return true
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.options.persistence.read()
        .then((content) => {
          if (!content) {
            this.state = defaultRigPreflightState(this.now())
            return
          }
          try {
            this.state = normalizeRigPreflightState(JSON.parse(content) as unknown, this.now())
          } catch {
            this.state = defaultRigPreflightState(this.now())
          }
        })
        .catch(() => {
          this.state = defaultRigPreflightState(this.now())
        })
    }
    await this.loadPromise
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
