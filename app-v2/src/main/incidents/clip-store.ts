import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { safeStorage } from 'electron'
import {
  INCIDENT_CAPTURE_SESSION_SCHEMA_VERSION,
  toClipMeta,
  type IncidentCaptureSessionIdentity,
  type IncidentClip,
  type IncidentClipMeta,
  type IncidentClipSealTrust,
  type IncidentSeverity,
  type IncidentType
} from '../../shared/incidents'
import type { SimId } from '../../shared/telemetry'
import { canonicalStringify, isPlainObject } from '../steward-desk/canonical'

const VERIFIED_CLIP = Symbol('verified-incident-clip')
const CLIP_EXTENSION = '.clip'
const LEGACY_EXTENSION = '.json'
const MAX_CLIPS = 60
const INCIDENT_TYPES = new Set<IncidentType>(['spin', 'off-track', 'contact', 'lockup'])
const INCIDENT_SEVERITIES = new Set<IncidentSeverity>(['minor', 'moderate', 'major'])
const METRIC_KEYS = new Set([
  'yawRateRadSec',
  'latAccelG',
  'longAccelG',
  'vertAccelG',
  'brake',
  'speedKmh',
  'speedDropKmh',
  'gSpike',
  'surface'
])
const SAMPLE_KEYS = new Set([
  't',
  'lap',
  'lapDistPct',
  'speedKmh',
  'rpm',
  'gear',
  'throttle',
  'brake',
  'steerAngleDeg',
  'latAccelG',
  'longAccelG',
  'vertAccelG',
  'yawRateRadSec',
  'surface',
  'onPitRoad'
])
const CLIP_SIM_IDS = {
  iracing: true,
  acc: true,
  ac: true,
  ams2: true,
  lmu: true,
  mock: true,
  replay: true,
  none: true
} satisfies Record<SimId, true>

export type IncidentClipIntegrityErrorCode =
  | 'integrity-unavailable'
  | 'legacy-unverified'
  | 'integrity-failed'
  | 'clip-invalid'
  | 'clip-id-mismatch'
  | 'atomic-write-failed'

export class IncidentClipIntegrityError extends Error {
  constructor(
    readonly code: IncidentClipIntegrityErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'IncidentClipIntegrityError'
  }
}

export interface IncidentClipIntegrityCodec {
  available(): boolean
  seal(plainText: string): Buffer
  open(sealed: Buffer): string
}

export interface VerifiedIncidentClip {
  readonly clip: IncidentClip
  readonly contentHash: string
  readonly trust: IncidentClipSealTrust
  readonly [VERIFIED_CLIP]: true
}

export const LOCAL_USER_SEALED_CLIP_TRUST: IncidentClipSealTrust = Object.freeze({
  boundary: 'local-windows-user',
  protection: 'electron-safe-storage',
  corruptionDetected: true,
  rendererTamperProtected: true,
  appOriginAuthenticated: false,
  sameUserProcessAuthenticity: false
})

export interface IncidentClipRepository {
  load(): void
  list(): IncidentClipMeta[]
  getVerified(id: string): VerifiedIncidentClip | null
  save(clip: IncidentClip): VerifiedIncidentClip
  clear(): number
}

class SafeStorageIncidentClipCodec implements IncidentClipIntegrityCodec {
  available(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  seal(plainText: string): Buffer {
    if (!this.available()) {
      throw new IncidentClipIntegrityError(
        'integrity-unavailable',
        'OS-backed incident clip integrity protection is unavailable.'
      )
    }
    return safeStorage.encryptString(plainText)
  }

  open(sealed: Buffer): string {
    if (!this.available()) {
      throw new IncidentClipIntegrityError(
        'integrity-unavailable',
        'OS-backed incident clip integrity protection is unavailable.'
      )
    }
    return safeStorage.decryptString(sealed)
  }
}

function text(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new IncidentClipIntegrityError('clip-invalid', `${label} must be text.`)
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) {
    throw new IncidentClipIntegrityError('clip-invalid', `${label} is invalid.`)
  }
  return normalized
}

function finite(value: unknown, label: string, minimum = -Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    throw new IncidentClipIntegrityError('clip-invalid', `${label} must be finite.`)
  }
  return value
}

function optionalFinite(value: unknown, label: string, minimum = -Number.MAX_SAFE_INTEGER): number | undefined {
  return value === undefined ? undefined : finite(value, label, minimum)
}

function onlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key))
  if (unexpected) {
    throw new IncidentClipIntegrityError('clip-invalid', `${label} contains undeclared field ${unexpected}.`)
  }
}

function parseCaptureSession(value: unknown): IncidentCaptureSessionIdentity {
  if (!isPlainObject(value)) {
    throw new IncidentClipIntegrityError('clip-invalid', 'captureSession must be an object.')
  }
  onlyKeys(value, new Set([
    'schemaVersion',
    'captureSessionId',
    'sim',
    'startedAt',
    'lifecycleGeneration',
    'sessionUniqueId',
    'sessionNumber',
    'sessionType',
    'trackName',
    'trackConfigName'
  ]), 'captureSession')
  if (value.schemaVersion !== INCIDENT_CAPTURE_SESSION_SCHEMA_VERSION) {
    throw new IncidentClipIntegrityError('clip-invalid', 'captureSession schemaVersion is unsupported.')
  }
  const lifecycleGeneration = optionalFinite(
    value.lifecycleGeneration,
    'captureSession.lifecycleGeneration',
    1
  )
  const sessionUniqueId = optionalFinite(value.sessionUniqueId, 'captureSession.sessionUniqueId', 0)
  const sessionNumber = optionalFinite(value.sessionNumber, 'captureSession.sessionNumber', 0)
  const sim = text(value.sim, 'captureSession.sim', 80)
  if (!Object.prototype.hasOwnProperty.call(CLIP_SIM_IDS, sim)) {
    throw new IncidentClipIntegrityError('clip-invalid', `captureSession.sim "${sim}" is unsupported.`)
  }
  return {
    schemaVersion: INCIDENT_CAPTURE_SESSION_SCHEMA_VERSION,
    captureSessionId: text(value.captureSessionId, 'captureSession.captureSessionId', 200),
    sim: sim as SimId,
    startedAt: finite(value.startedAt, 'captureSession.startedAt', 0),
    ...(lifecycleGeneration === undefined ? {} : { lifecycleGeneration: Math.trunc(lifecycleGeneration) }),
    ...(sessionUniqueId === undefined ? {} : { sessionUniqueId: Math.trunc(sessionUniqueId) }),
    ...(sessionNumber === undefined ? {} : { sessionNumber: Math.trunc(sessionNumber) }),
    ...(value.sessionType === undefined
      ? {}
      : { sessionType: text(value.sessionType, 'captureSession.sessionType', 80) }),
    ...(value.trackName === undefined
      ? {}
      : { trackName: text(value.trackName, 'captureSession.trackName', 200) }),
    ...(value.trackConfigName === undefined
      ? {}
      : { trackConfigName: text(value.trackConfigName, 'captureSession.trackConfigName', 200) })
  }
}

function parseIncidentClip(value: unknown): IncidentClip {
  if (!isPlainObject(value)) throw new IncidentClipIntegrityError('clip-invalid', 'Incident clip must be an object.')
  onlyKeys(value, new Set([
    'type',
    'severity',
    'at',
    'lap',
    'lapDistPct',
    'metrics',
    'summary',
    'id',
    'window',
    'triggerIndex',
    'createdAt',
    'captureSession'
  ]), 'incident clip')
  if (!INCIDENT_TYPES.has(value.type as IncidentType) ||
      !INCIDENT_SEVERITIES.has(value.severity as IncidentSeverity)) {
    throw new IncidentClipIntegrityError('clip-invalid', 'Incident type or severity is invalid.')
  }
  if (!isPlainObject(value.metrics)) {
    throw new IncidentClipIntegrityError('clip-invalid', 'Incident metrics must be an object.')
  }
  onlyKeys(value.metrics, METRIC_KEYS, 'incident metrics')
  const metrics: Record<string, number | string> = {}
  for (const [key, entry] of Object.entries(value.metrics)) {
    metrics[key] = key === 'surface'
      ? text(entry, `incident metrics.${key}`, 80)
      : finite(entry, `incident metrics.${key}`)
  }
  if (!Array.isArray(value.window) || value.window.length === 0 || value.window.length > 5_000) {
    throw new IncidentClipIntegrityError('clip-invalid', 'Incident window is invalid.')
  }
  const window = value.window.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new IncidentClipIntegrityError('clip-invalid', `Incident sample ${index} must be an object.`)
    }
    onlyKeys(entry, SAMPLE_KEYS, `incident sample ${index}`)
    const sample: Record<string, number | string | boolean> = {
      t: finite(entry.t, `incident sample ${index}.t`, 0)
    }
    for (const [key, field] of Object.entries(entry)) {
      if (key === 't') continue
      if (key === 'surface') sample[key] = text(field, `incident sample ${index}.surface`, 80)
      else if (key === 'onPitRoad') {
        if (typeof field !== 'boolean') {
          throw new IncidentClipIntegrityError('clip-invalid', `incident sample ${index}.onPitRoad must be boolean.`)
        }
        sample[key] = field
      } else {
        sample[key] = finite(field, `incident sample ${index}.${key}`)
      }
    }
    return sample
  })
  const triggerIndex = Math.trunc(finite(value.triggerIndex, 'incident triggerIndex', 0))
  if (triggerIndex >= window.length) {
    throw new IncidentClipIntegrityError('clip-invalid', 'Incident triggerIndex is outside the window.')
  }
  const lap = optionalFinite(value.lap, 'incident lap', 0)
  const lapDistPct = optionalFinite(value.lapDistPct, 'incident lapDistPct', 0)
  if (lapDistPct !== undefined && lapDistPct > 1) {
    throw new IncidentClipIntegrityError('clip-invalid', 'incident lapDistPct must be at most 1.')
  }
  return {
    type: value.type as IncidentType,
    severity: value.severity as IncidentSeverity,
    at: finite(value.at, 'incident at', 0),
    ...(lap === undefined ? {} : { lap }),
    ...(lapDistPct === undefined ? {} : { lapDistPct }),
    metrics,
    summary: text(value.summary, 'incident summary', 1_000),
    id: text(value.id, 'incident id', 300),
    window: window as unknown as IncidentClip['window'],
    triggerIndex,
    createdAt: finite(value.createdAt, 'incident createdAt', 0),
    captureSession: parseCaptureSession(value.captureSession)
  }
}

function clipHash(canonical: string): string {
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

function verifiedClip(clip: IncidentClip, canonical: string): VerifiedIncidentClip {
  return Object.freeze({
    clip: Object.freeze(clip),
    contentHash: clipHash(canonical),
    trust: LOCAL_USER_SEALED_CLIP_TRUST,
    [VERIFIED_CLIP]: true as const
  })
}

export function assertVerifiedIncidentClip(value: VerifiedIncidentClip): IncidentClip {
  if (!value || value[VERIFIED_CLIP] !== true) {
    throw new IncidentClipIntegrityError('integrity-failed', 'Incident clip lacks verified main-process integrity.')
  }
  const canonical = canonicalStringify(value.clip)
  if (clipHash(canonical) !== value.contentHash) {
    throw new IncidentClipIntegrityError('integrity-failed', 'Verified incident clip changed after verification.')
  }
  return value.clip
}

function safeStem(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 240)
}

function clipStem(id: string): string {
  return createHash('sha256').update(id, 'utf8').digest('hex')
}

export function incidentClipFileName(id: string): string {
  return `${clipStem(id)}${CLIP_EXTENSION}`
}

export class IncidentClipStore implements IncidentClipRepository {
  private index: IncidentClipMeta[] = []
  private readonly quarantineDir: string

  constructor(
    private readonly dir: string,
    private readonly codec: IncidentClipIntegrityCodec = new SafeStorageIncidentClipCodec()
  ) {
    this.quarantineDir = join(dir, 'quarantine')
  }

  load(): void {
    mkdirSync(this.dir, { recursive: true })
    mkdirSync(this.quarantineDir, { recursive: true })
    const metas: IncidentClipMeta[] = []
    const failures: IncidentClipIntegrityError[] = []
    for (const name of readdirSync(this.dir)) {
      const path = join(this.dir, name)
      if (name.endsWith('.tmp')) {
        this.quarantine(path, 'incomplete-atomic-write')
        failures.push(new IncidentClipIntegrityError(
          'atomic-write-failed',
          `Interrupted incident clip write ${name} was quarantined.`
        ))
        continue
      }
      if (name.endsWith(LEGACY_EXTENSION)) {
        this.quarantine(path, 'legacy-unverified')
        failures.push(new IncidentClipIntegrityError(
          'legacy-unverified',
          `Legacy incident clip ${name} lacked integrity protection and was quarantined.`
        ))
        continue
      }
      if (!name.endsWith(CLIP_EXTENSION)) continue
      try {
        const verified = this.readPath(path)
        if (name !== incidentClipFileName(verified.clip.id)) {
          throw new IncidentClipIntegrityError('clip-id-mismatch', 'Incident clip file key is relabeled.')
        }
        metas.push(toClipMeta(verified.clip))
      } catch (error) {
        if (error instanceof IncidentClipIntegrityError && error.code === 'integrity-unavailable') {
          throw error
        }
        this.quarantine(path, 'integrity-failed')
        failures.push(error instanceof IncidentClipIntegrityError
          ? error
          : new IncidentClipIntegrityError('integrity-failed', `Incident clip ${name} failed integrity verification.`))
      }
    }
    metas.sort((left, right) => right.createdAt - left.createdAt)
    this.index = metas.slice(0, MAX_CLIPS)
    for (const stale of metas.slice(MAX_CLIPS)) {
      rmSync(join(this.dir, incidentClipFileName(stale.id)), { force: true })
    }
    if (failures.length > 0) {
      throw new IncidentClipIntegrityError(
        failures[0].code,
        failures.map((entry) => entry.message).join(' ')
      )
    }
  }

  list(): IncidentClipMeta[] {
    return this.index.map((entry) => ({ ...entry }))
  }

  getVerified(id: string): VerifiedIncidentClip | null {
    const normalizedId = text(id, 'incident id', 300)
    const path = join(this.dir, incidentClipFileName(normalizedId))
    const legacyPath = join(this.dir, `${safeStem(normalizedId)}${LEGACY_EXTENSION}`)
    if (!existsSync(path)) {
      if (existsSync(legacyPath)) {
        this.quarantine(legacyPath, 'legacy-unverified')
        throw new IncidentClipIntegrityError(
          'legacy-unverified',
          'Legacy incident clip has no app-owned integrity protection and was quarantined.'
        )
      }
      return null
    }
    try {
      const verified = this.readPath(path)
      if (verified.clip.id !== normalizedId) {
        throw new IncidentClipIntegrityError('clip-id-mismatch', 'Incident clip id does not match its file key.')
      }
      return verified
    } catch (error) {
      if (error instanceof IncidentClipIntegrityError && error.code === 'integrity-unavailable') {
        throw error
      }
      this.quarantine(path, error instanceof IncidentClipIntegrityError ? error.code : 'integrity-failed')
      if (error instanceof IncidentClipIntegrityError) throw error
      throw new IncidentClipIntegrityError(
        'integrity-failed',
        `Incident clip integrity verification failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  save(clipInput: IncidentClip): VerifiedIncidentClip {
    const clip = parseIncidentClip(clipInput)
    const canonical = canonicalStringify(clip)
    const sealed = this.codec.seal(canonical)
    const path = join(this.dir, incidentClipFileName(clip.id))
    mkdirSync(this.dir, { recursive: true })
    mkdirSync(this.quarantineDir, { recursive: true })
    if (existsSync(path)) {
      const current = this.getVerified(clip.id)
      if (current?.contentHash === clipHash(canonical)) return current
      throw new IncidentClipIntegrityError('clip-id-mismatch', `Incident clip ${clip.id} already exists with different content.`)
    }
    const temporaryPath = join(this.dir, `.${safeStem(clip.id)}.${process.pid}.${randomUUID()}.tmp`)
    let descriptor: number | undefined
    try {
      descriptor = openSync(temporaryPath, 'wx', 0o600)
      writeSync(descriptor, sealed)
      fsyncSync(descriptor)
      closeSync(descriptor)
      descriptor = undefined
      renameSync(temporaryPath, path)
    } catch (error) {
      throw new IncidentClipIntegrityError(
        'atomic-write-failed',
        `Incident clip atomic persistence failed: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      if (descriptor !== undefined) closeSync(descriptor)
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
    }
    const verified = this.readPath(path)
    this.index = [
      toClipMeta(verified.clip),
      ...this.index.filter((entry) => entry.id !== verified.clip.id)
    ].sort((left, right) => right.createdAt - left.createdAt)
    while (this.index.length > MAX_CLIPS) {
      const stale = this.index.pop()
      if (stale) rmSync(join(this.dir, incidentClipFileName(stale.id)), { force: true })
    }
    return verified
  }

  clear(): number {
    const count = this.index.length
    for (const entry of this.index) {
      rmSync(join(this.dir, incidentClipFileName(entry.id)), { force: true })
    }
    this.index = []
    return count
  }

  private readPath(path: string): VerifiedIncidentClip {
    if (!this.codec.available()) {
      throw new IncidentClipIntegrityError(
        'integrity-unavailable',
        'OS-backed incident clip integrity protection is unavailable.'
      )
    }
    let plain: string
    try {
      plain = this.codec.open(readFileSync(path))
    } catch (error) {
      throw new IncidentClipIntegrityError(
        'integrity-failed',
        `Incident clip integrity verification failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    const clip = parseIncidentClip(JSON.parse(plain) as unknown)
    const canonical = canonicalStringify(clip)
    if (canonical !== plain) {
      throw new IncidentClipIntegrityError('clip-invalid', 'Incident clip is not canonically encoded.')
    }
    return verifiedClip(clip, canonical)
  }

  private quarantine(path: string, reason: string): void {
    if (!existsSync(path)) return
    mkdirSync(this.quarantineDir, { recursive: true })
    const target = join(
      this.quarantineDir,
      `${basename(path)}.${reason.replace(/[^A-Za-z0-9_-]/g, '-')}.${randomUUID()}`
    )
    try {
      renameSync(path, target)
    } catch {
      // Verification already failed closed. A locked file remains unusable in place.
    }
  }
}

export function readVerifiedIncidentClipFromUserData(
  userDataPath: string,
  id: string
): VerifiedIncidentClip | null {
  return new IncidentClipStore(join(userDataPath, 'incident-clips')).getVerified(id)
}
