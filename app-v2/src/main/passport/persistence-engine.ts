import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import {
  DEFAULT_PASSPORT_CONFIG,
  DEFAULT_PASSPORT_PRIVACY,
  PASSPORT_ITEM_DEFINITIONS,
  STINT_PASSPORT_CONTRACT_VERSION,
  calculatePassportCoverage,
  type PassportConfig,
  type PassportDataClass,
  type PassportDeleteResult,
  type PassportExportProfile,
  type PassportIntegrityState,
  type PassportItem,
  type PassportItemId,
  type PassportPrivacySettings,
  type PassportRosterMember,
  type StintPassport
} from '../../shared/stint-passport'
import {
  emptyConfidence,
  emptyObservedInterval,
  type CanonicalRaceOpsEvent
} from '../../shared/phase02-contracts'
import { PHASE02_DESCRIPTOR_SHA256 } from '../phase02/generated/contract-descriptor'
import {
  decodeRaceOpsEvent,
  decodeStintPassport,
  encodeRaceOpsEvent,
  encodeStintPassport,
  raceOpsEventFromProtoJson,
  raceOpsEventToProtoJson,
  stintPassportProtoJson
} from '../phase02/raceops-codec'
import { PASSPORT_SQLITE_BUSY_TIMEOUT_MS } from './persistence-deadlines'
import { persistenceDomainError } from './persistence-errors'

export const PASSPORT_PERSISTENCE_SCHEMA_VERSION = 5
const BOUNDED_VERIFY_LIMIT = 500
const ANCHOR_VERSION = 1
const MAX_EXPORT_EVENTS = 500
const MAX_EXPORT_BYTES = 5_000_000
const MAX_IMPORT_DEPTH = 32
const MAX_IMPORT_NODES = 20_000

const ITEM_DATA_CLASS_SQL = `CASE item_id
${PASSPORT_ITEM_DEFINITIONS.map((definition) =>
  `WHEN '${definition.id}' THEN '${definition.dataClass}'`
).join('\n')}
ELSE 'D2' END`

function itemDataClass(itemId: PassportItemId): PassportDataClass {
  return PASSPORT_ITEM_DEFINITIONS.find((definition) => definition.id === itemId)?.dataClass ?? 'D2'
}

function dataClassRank(dataClass: PassportDataClass): number {
  return dataClass === 'D1' ? 1 : dataClass === 'D2' ? 2 : 3
}

type Row = Record<string, unknown>

interface AnchorPayload {
  version: typeof ANCHOR_VERSION
  databaseId: string
  clockSequence: number
  eventCount: number
  eventRoot: string
  tombstoneCount: number
  tombstoneRoot: string
  passportCount: number
  passportRoot: string
  settingsHash: string
  rosterHash: string
  mutationRoot?: string
}

interface SignedAnchor extends AnchorPayload {
  signature: string
}

export interface PassportStoreOptions {
  path: string
  now?: () => number
  idFactory?: () => string
  promoteAnchor?: (source: string, destination: string) => void
  databaseIdentity?: string
}

export interface PassportStoreMetrics {
  appendOperations: number
  rowsHashedOnWrite: number
  boundedVerificationRows: number
  fullAuditRuns: number
}

export interface PassportEventHeader {
  sequence: number
  logicalTimeMs: number
  dedupeKey: string
  recordHash: string
  previousHash?: string
}

export interface PassportStoreEvent {
  canonicalEvent: CanonicalRaceOpsEvent
  dataClass: PassportDataClass
  itemId?: PassportItemId
  capturedAt: number
}

export interface PassportExportPackage {
  contractVersion: typeof STINT_PASSPORT_CONTRACT_VERSION
  profile: PassportExportProfile
  generatedAt: number
  passports: StintPassport[]
  roster: PassportRosterMember[]
  integrity: PassportIntegrityState
  canonicalEvents: unknown[]
  deletionTombstones: unknown[]
  redactions: string[]
  packageHash: string
  signerId: string
  packageSignature: string
}

export type PassportMutationKind =
  | 'privacy-settings'
  | `privacy-delete:${PassportDataClass}`
  | 'privacy-retention'
  | 'roster-save'

export interface PassportRetentionReceiptResult {
  retainedAt: number
  results: PassportDeleteResult[]
}

export interface PassportPersistenceMigrationPlan {
  operationId: string
  privacyMutationGeneration: number
  roster: PassportRosterMember[]
  passport?: StintPassport
  event?: PassportStoreEvent
}

export interface PassportPersistenceMigrationState extends PassportPersistenceMigrationPlan {
  rosterComplete: boolean
  passportComplete: boolean
}

export interface PassportMutationReceipt {
  operationId: string
  kind: PassportMutationKind
  generation: number
  resultHash: string
  result?: PassportDeleteResult | PassportPrivacySettings | PassportRetentionReceiptResult
}

export interface PassportAuthoritativeState {
  privacy: PassportPrivacySettings
  privacyMutationGeneration: number
  roster: PassportRosterMember[]
  rosterMutationGeneration: number
  passports: StintPassport[]
  mutation?: PassportMutationReceipt
  persistenceMigration?: PassportPersistenceMigrationState
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS passport_clock (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  next_sequence INTEGER NOT NULL,
  last_logical_time_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS passport_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS passport_settings (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  config_json TEXT NOT NULL,
  privacy_json TEXT NOT NULL,
  kill_switch INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS passport_roster (
  member_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  roles_json TEXT NOT NULL,
  active INTEGER NOT NULL,
  data_class TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stint_passport (
  stint_id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL,
  session_ref TEXT NOT NULL,
  track_ref TEXT NOT NULL,
  track_label TEXT NOT NULL,
  car_ref TEXT NOT NULL,
  car_label TEXT NOT NULL,
  driver_ref TEXT NOT NULL,
  driver_label TEXT NOT NULL,
  team_ref TEXT,
  team_label TEXT,
  started_at INTEGER NOT NULL,
  lifecycle TEXT NOT NULL,
  telemetry_context TEXT NOT NULL,
  coverage REAL NOT NULL,
  applicable_items INTEGER NOT NULL,
  covered_items INTEGER NOT NULL,
  challenge_completed_at INTEGER,
  challenge_owner_json TEXT,
  closed_at INTEGER,
  close_reason TEXT,
  interrupted INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  durability TEXT NOT NULL,
  passport_binary BLOB NOT NULL,
  passport_json TEXT NOT NULL,
  passport_sha256 TEXT NOT NULL,
  data_class TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_passport_history
  ON stint_passport(started_at DESC, stint_id);
CREATE INDEX IF NOT EXISTS idx_passport_lifecycle
  ON stint_passport(lifecycle, started_at DESC);

CREATE TABLE IF NOT EXISTS passport_item (
  stint_id TEXT NOT NULL REFERENCES stint_passport(stint_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  status TEXT NOT NULL,
  owner_json TEXT,
  detail TEXT NOT NULL,
  override_reason TEXT,
  reason_code TEXT,
  verified_at INTEGER,
  expires_at INTEGER,
  evidence_json TEXT,
  evidence_state TEXT NOT NULL,
  evidence_captured_at INTEGER,
  revision INTEGER NOT NULL,
  item_hash TEXT NOT NULL,
  data_class TEXT NOT NULL,
  evidence_data_class TEXT NOT NULL,
  detail_data_class TEXT NOT NULL,
  owner_data_class TEXT NOT NULL,
  reason_data_class TEXT NOT NULL,
  provenance_data_class TEXT NOT NULL,
  PRIMARY KEY(stint_id, item_id)
);

CREATE TABLE IF NOT EXISTS passport_event (
  event_id TEXT PRIMARY KEY,
  stint_id TEXT NOT NULL REFERENCES stint_passport(stint_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  item_id TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  semantic_hash TEXT,
  sequence INTEGER NOT NULL UNIQUE,
  logical_time_ms INTEGER NOT NULL,
  captured_at INTEGER NOT NULL,
  event_binary BLOB,
  payload_json TEXT,
  payload_sha256 TEXT NOT NULL,
  payload_state TEXT NOT NULL,
  tombstone_json TEXT,
  previous_hash TEXT,
  record_hash TEXT NOT NULL,
  data_class TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_passport_event_stint
  ON passport_event(stint_id, sequence);
CREATE UNIQUE INDEX IF NOT EXISTS idx_passport_event_semantic
  ON passport_event(semantic_hash) WHERE semantic_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS passport_runtime_log (
  log_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  data_class TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS passport_deletion_tombstone (
  tombstone_id TEXT PRIMARY KEY,
  data_class TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  subject_hashes_json TEXT NOT NULL,
  previous_hash TEXT,
  record_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS passport_mutation_receipt (
  operation_id TEXT PRIMARY KEY,
  mutation_kind TEXT NOT NULL,
  generation INTEGER NOT NULL,
  result_hash TEXT NOT NULL,
  result_json TEXT,
  applied_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_passport_mutation_receipt_applied
  ON passport_mutation_receipt(applied_at DESC, operation_id);
`

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
    .join(',')}}`
}

function hash(value: unknown): string {
  return createHash('sha256').update(stable(value), 'utf8').digest('hex')
}

function privacyIntentHash(value: PassportPrivacySettings): string {
  return hash({
    identityPersistenceOptIn: value.identityPersistenceOptIn,
    retentionDays: value.retentionDays
  })
}

function rosterIntentHash(value: readonly PassportRosterMember[]): string {
  return hash(value.map((member) => ({
    memberId: member.memberId,
    displayName: member.displayName,
    roles: [...member.roles].sort(),
    active: member.active
  })).sort((left, right) => left.memberId.localeCompare(right.memberId)))
}

function privacyOperationHash(
  value: PassportPrivacySettings,
  migration?: PassportPersistenceMigrationPlan
): string {
  if (!migration) return privacyIntentHash(value)
  return hash({
    privacy: {
      identityPersistenceOptIn: value.identityPersistenceOptIn,
      retentionDays: value.retentionDays
    },
    migration: migration
      ? {
          operationId: migration.operationId,
          roster: rosterIntentHash(migration.roster),
          passport: migration.passport ? hash(migration.passport) : undefined,
          event: migration.event ? hash(migration.event) : undefined
        }
      : undefined
  })
}

function coherentAfterPrivacyRedaction(passport: StintPassport): StintPassport {
  if (passport.lifecycle !== 'ready') return passport
  const blocksReadiness = passport.items.some((item) => {
    const definition = PASSPORT_ITEM_DEFINITIONS.find((candidate) => candidate.id === item.id)
    return definition?.critical === true &&
      (item.status === 'unknown' || item.status === 'mismatch' || item.status === 'expired')
  })
  if (!blocksReadiness) return passport
  return {
    ...passport,
    lifecycle: 'awaiting-checklist',
    challengeCompletedAt: undefined,
    challengeOwner: undefined
  }
}

function hashBytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function atomicRename(source: string, destination: string): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(source, destination)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (
        process.platform !== 'win32' ||
        attempt >= 50 ||
        (code !== 'EACCES' && code !== 'EBUSY' && code !== 'EPERM')
      ) {
        throw error
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
    }
  }
}

function assertBoundedImportValue(value: unknown): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  const seen = new WeakSet<object>()
  let nodes = 0
  while (stack.length > 0) {
    const entry = stack.pop()!
    nodes += 1
    if (nodes > MAX_IMPORT_NODES) {
      throw persistenceDomainError('Passport import exceeds the bounded node limit.')
    }
    if (entry.depth > MAX_IMPORT_DEPTH) {
      throw persistenceDomainError('Passport import exceeds the bounded depth limit.')
    }
    if (
      entry.value === undefined ||
      entry.value === null ||
      typeof entry.value === 'string' ||
      typeof entry.value === 'boolean'
    ) {
      continue
    }
    if (typeof entry.value === 'number') {
      if (!Number.isFinite(entry.value)) {
        throw persistenceDomainError('Passport import contains a non-finite number.')
      }
      continue
    }
    if (typeof entry.value !== 'object') {
      throw persistenceDomainError('Passport import contains a non-JSON value.')
    }
    if (seen.has(entry.value)) {
      throw persistenceDomainError('Passport import contains a cyclic value.')
    }
    seen.add(entry.value)
    if (
      !Array.isArray(entry.value) &&
      Object.getPrototypeOf(entry.value) !== Object.prototype &&
      Object.getPrototypeOf(entry.value) !== null
    ) {
      throw persistenceDomainError('Passport import contains a non-JSON object.')
    }
    for (const child of Object.values(entry.value)) {
      stack.push({ value: child, depth: entry.depth + 1 })
    }
  }
}

function atomicWrite(path: string, contents: string, mode?: number): void {
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.pending`
  const descriptor = openSync(temporary, 'wx', mode)
  try {
    writeFileSync(descriptor, contents, 'utf8')
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  atomicRename(temporary, path)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function optionalText(value: unknown): string | undefined {
  const normalized = text(value)
  return normalized || undefined
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function bool(value: unknown): boolean {
  return value === 1 || value === 1n || value === true
}

function parse<T>(value: unknown, fallback: T): T {
  try {
    return typeof value === 'string' ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

function begin(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE')
}

function rollback(db: DatabaseSync): void {
  try {
    db.exec('ROLLBACK')
  } catch {
    // Keep the original storage failure.
  }
}

function itemHash(item: PassportItem): string {
  return hash({
    id: item.id,
    status: item.status,
    owner: item.owner,
    detail: item.detail,
    overrideReason: item.overrideReason,
    reasonCode: item.reasonCode,
    verifiedAt: item.verifiedAt,
    expiresAt: item.expiresAt,
    evidenceHash: item.evidence?.contentHash,
    evidenceState: item.evidence?.state,
    revision: item.revision
  })
}

function lowerClassItemHash(item: PassportItem): string {
  return hash({
    id: item.id,
    status: item.status,
    detail: item.detail,
    verifiedAt: item.verifiedAt,
    expiresAt: item.expiresAt,
    evidenceHash: item.evidence?.contentHash,
    evidenceState: item.evidence?.state,
    revision: item.revision
  })
}

function lowerClassAttestationDetail(status: PassportItem['status']): string {
  return status === 'manual-confirmed'
    ? 'Manually confirmed by the assigned roster owner.'
    : status === 'not-applicable'
      ? 'Marked not applicable with a private retained reason.'
      : 'Waived with a private retained reason.'
}

function lowerClassAttestationSummary(status: PassportItem['status']): string {
  return status === 'manual-confirmed'
    ? 'Manual attestation recorded.'
    : status === 'not-applicable'
      ? 'Not-applicable attestation recorded.'
      : 'Waiver attestation recorded.'
}

function passportStateHash(
  passport: StintPassport,
  dataClass: PassportDataClass = 'D3'
): string {
  if (dataClass !== 'D3') {
    const maximumRank = dataClassRank(dataClass)
    return hash({
      contractVersion: passport.contractVersion,
      lifecycle: passport.lifecycle,
      telemetryContext: passport.telemetryContext,
      items: passport.items
        .filter((item) => dataClassRank(itemDataClass(item.id)) <= maximumRank)
        .map((item) => ({
          id: item.id,
          itemHash: lowerClassItemHash(item)
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      coverage: passport.coverage,
      applicableItems: passport.applicableItems,
      coveredItems: passport.coveredItems,
      challengeCompletedAt: passport.challengeCompletedAt,
      closedAt: passport.closedAt,
      closeReason: passport.closeReason,
      interrupted: passport.interrupted,
      revision: passport.revision,
      durability: passport.durability
    })
  }
  return hash({
    contractVersion: passport.contractVersion,
    identity: passport.identity,
    lifecycle: passport.lifecycle,
    telemetryContext: passport.telemetryContext,
    items: passport.items
      .map((item) => ({
        id: item.id,
        itemHash: itemHash(item)
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    coverage: passport.coverage,
    applicableItems: passport.applicableItems,
    coveredItems: passport.coveredItems,
    challengeCompletedAt: passport.challengeCompletedAt,
    challengeOwner: passport.challengeOwner,
    closedAt: passport.closedAt,
    closeReason: passport.closeReason,
    interrupted: passport.interrupted,
    revision: passport.revision,
    durability: passport.durability
  })
}

function semanticOperationHash(passport: StintPassport, event: PassportStoreEvent): string {
  const canonical = event.canonicalEvent
  return hash({
    passportStateHash: passportStateHash(passport, event.dataClass),
    itemId: event.itemId,
    dataClass: event.dataClass,
    capturedAt: event.capturedAt,
    canonicalEvent: {
      ...canonical,
      eventId: '',
      dedupeKey: '',
      sequence: '0',
      partitionSeq: '0',
      observedMonotonicNs: '0'
    }
  })
}

export class PassportPersistenceEngine {
  private readonly db: DatabaseSync
  private readonly now: () => number
  private readonly idFactory: () => string
  private readonly promoteAnchor: (source: string, destination: string) => void
  private readonly heads = new Map<string, string | undefined>()
  private readonly metrics: PassportStoreMetrics = {
    appendOperations: 0,
    rowsHashedOnWrite: 0,
    boundedVerificationRows: 0,
    fullAuditRuns: 0
  }
  private integrity!: PassportIntegrityState
  private pseudonymSalt = ''
  private closed = false
  private stickyCorrupt = false
  private repairToken = ''
  private databaseId = ''
  private anchorKey = Buffer.alloc(0)
  private readonly anchorPath: string
  private readonly pendingAnchorPath: string
  private readonly anchorKeyPath: string
  private readonly quarantineMarkerPath: string
  private anchorReady = false
  readonly databasePath: string

  get databaseIdentity(): string {
    return this.databaseId
  }

  constructor(options: PassportStoreOptions) {
    this.databasePath = options.path
    this.anchorPath = options.path === ':memory:' ? '' : `${options.path}.anchor.json`
    this.pendingAnchorPath = options.path === ':memory:' ? '' : `${options.path}.anchor.pending.json`
    this.anchorKeyPath = options.path === ':memory:' ? '' : `${options.path}.anchor.key`
    this.quarantineMarkerPath = options.path === ':memory:' ? '' : `${options.path}.quarantine.json`
    this.now = options.now ?? Date.now
    this.idFactory = options.idFactory ?? randomUUID
    this.promoteAnchor = options.promoteAnchor ?? atomicRename
    if (options.path !== ':memory:') mkdirSync(dirname(options.path), { recursive: true })
    this.db = new DatabaseSync(options.path)
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec(`PRAGMA busy_timeout = ${PASSPORT_SQLITE_BUSY_TIMEOUT_MS}`)
    this.db.exec('PRAGMA secure_delete = ON')
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = FULL')
    this.migrate()
    this.databaseId = this.readOrCreateMeta(
      'database_id',
      () => options.databaseIdentity ?? randomBytes(24).toString('hex')
    )
    if (options.databaseIdentity !== undefined && this.databaseId !== options.databaseIdentity) {
      this.closed = true
      this.db.close()
      throw new Error('Passport database identity does not match the assigned repair identity.')
    }
    this.pseudonymSalt = this.readOrCreateMeta('pseudonym_salt', () => randomBytes(32).toString('hex'))
    this.repairToken = this.readOrCreateMeta('repair_token', () => randomBytes(24).toString('hex'))
    this.hydrateHeads()
    this.initializeAnchor()
    this.stickyCorrupt = this.stickyCorrupt ||
      this.readOrCreateMeta('integrity_state', () => 'clean') === 'corrupt' ||
      this.hasValidQuarantineMarker()
    this.integrity = this.stickyCorrupt
      ? this.stickyCorruptionState('bounded', 0, 'Persistence is quarantined after an integrity failure.')
      : this.verifyBounded()
  }

  close(): void {
    if (this.closed) return
    this.flush()
    this.closed = true
    this.db.close()
  }

  flush(): void {
    if (this.closed || this.databasePath === ':memory:') return
    this.db.exec('PRAGMA wal_checkpoint(FULL)')
  }

  schemaVersion(): number {
    return numberValue((this.db.prepare('PRAGMA user_version').get() as Row).user_version)
  }

  getConfig(): PassportConfig {
    const row = this.settingsRow()
    return parse(row?.config_json, { ...DEFAULT_PASSPORT_CONFIG })
  }

  setConfig(config: PassportConfig): PassportConfig {
    this.assertWritable()
    const next = sanitizeConfig(config, this.now())
    const settings = this.settingsRow()
    this.writeSettings(next, parse(settings?.privacy_json, DEFAULT_PASSPORT_PRIVACY), bool(settings?.kill_switch))
    return next
  }

  getPrivacy(): PassportPrivacySettings {
    return parse(this.settingsRow()?.privacy_json, { ...DEFAULT_PASSPORT_PRIVACY })
  }

  getPrivacyMutationGeneration(): number {
    return this.metaGeneration('privacy_mutation_generation')
  }

  getRosterMutationGeneration(): number {
    return this.metaGeneration('roster_mutation_generation')
  }

  getAuthoritativeState(
    operationId?: string,
    limit = 50
  ): PassportAuthoritativeState {
    this.assertWritable()
    const privacy = this.getPrivacy()
    return {
      privacy,
      privacyMutationGeneration: this.getPrivacyMutationGeneration(),
      roster: privacy.identityPersistenceOptIn ? this.listRoster() : [],
      rosterMutationGeneration: this.getRosterMutationGeneration(),
      passports: privacy.identityPersistenceOptIn ? this.listPassports(limit) : [],
      mutation: operationId ? this.readMutationReceipt(operationId) : undefined,
      persistenceMigration: this.readPersistenceMigration()
    }
  }

  setPrivacy(
    privacy: PassportPrivacySettings,
    privacyMutationGeneration?: number,
    operationId?: string,
    migration?: PassportPersistenceMigrationPlan
  ): PassportPrivacySettings {
    this.assertWritable()
    const next = sanitizePrivacy(privacy, this.now())
    const mutationId = this.normalizeMutationId(operationId)
    const normalizedMigration = migration
      ? this.normalizePersistenceMigration(migration)
      : undefined
    const operationHash = privacyOperationHash(next, normalizedMigration)
    const receipt = mutationId ? this.readMutationReceipt(mutationId) : undefined
    if (receipt) {
      if (
        receipt.kind !== 'privacy-settings' ||
        receipt.resultHash !== operationHash
      ) {
        throw persistenceDomainError('Passport privacy mutation operation ID was reused.')
      }
      return receipt.result as PassportPrivacySettings
    }
    const current = this.settingsRow()
    const currentPrivacy = parse(current?.privacy_json, DEFAULT_PASSPORT_PRIVACY)
    const currentGeneration = this.getPrivacyMutationGeneration()
    const disablesPersistence =
      currentPrivacy.identityPersistenceOptIn && !next.identityPersistenceOptIn
    const enablesPersistence =
      !currentPrivacy.identityPersistenceOptIn && next.identityPersistenceOptIn
    if (normalizedMigration && !enablesPersistence) {
      throw persistenceDomainError('Passport persistence migration requires a new privacy opt-in.')
    }
    if (
      normalizedMigration &&
      normalizedMigration.privacyMutationGeneration !== currentGeneration
    ) {
      throw persistenceDomainError('Passport persistence migration generation conflict.')
    }
    const expectedGeneration = privacyMutationGeneration ?? (
      disablesPersistence ? currentGeneration + 1 : currentGeneration
    )
    if (expectedGeneration !== currentGeneration + (disablesPersistence ? 1 : 0)) {
      throw persistenceDomainError('Passport privacy mutation generation conflict.')
    }
    return this.transaction(() => {
      this.assertMetaGeneration(
        'privacy_mutation_generation',
        currentGeneration,
        'Passport privacy mutation generation conflict.'
      )
      if (disablesPersistence) {
        this.writeMetaGeneration('privacy_mutation_generation', expectedGeneration)
        const rosterGeneration = this.getRosterMutationGeneration()
        this.writeMetaGeneration('roster_mutation_generation', rosterGeneration + 1)
      }
      this.writeSettingsInTransaction(
        parse(current?.config_json, DEFAULT_PASSPORT_CONFIG),
        next,
        bool(current?.kill_switch)
      )
      if (disablesPersistence) {
        this.clearPersistenceMigrationInTransaction()
        const ids = (this.db.prepare('SELECT stint_id FROM stint_passport').all() as Row[])
          .map((row) => text(row.stint_id))
        if (ids.length > 0) this.appendDeletionTombstone('D3', ids)
        this.db.exec('DELETE FROM passport_roster')
        this.db.exec('DELETE FROM stint_passport')
        this.db.prepare(`
          DELETE FROM passport_mutation_receipt
          WHERE mutation_kind = 'roster-save'
        `).run()
        this.heads.clear()
        this.integrity = {
          state: 'unanchored',
          verified: false,
          scope: 'bounded',
          checkedEvents: 0,
          totalEvents: 0,
          lastCheckedAt: this.now(),
          message: 'No persisted Passport event chain remains.'
        }
      } else if (enablesPersistence && normalizedMigration) {
        this.writePersistenceMigrationInTransaction(normalizedMigration)
      }
      if (mutationId) {
        this.writeMutationReceipt({
          operationId: mutationId,
          kind: 'privacy-settings',
          generation: expectedGeneration,
          resultHash: operationHash,
          result: next
        })
      }
      return next
    })
  }

  getKillSwitch(): boolean {
    return bool(this.settingsRow()?.kill_switch)
  }

  setKillSwitch(enabled: boolean): boolean {
    this.assertWritable()
    const current = this.settingsRow()
    this.writeSettings(
      parse(current?.config_json, DEFAULT_PASSPORT_CONFIG),
      parse(current?.privacy_json, DEFAULT_PASSPORT_PRIVACY),
      enabled
    )
    return enabled
  }

  listRoster(): PassportRosterMember[] {
    if (!this.getPrivacy().identityPersistenceOptIn) return []
    const rows = this.db.prepare(`
      SELECT * FROM passport_roster
      ORDER BY display_name ASC, member_id ASC
    `).all() as Row[]
    return rows.map((row) => ({
      memberId: text(row.member_id),
      displayName: text(row.display_name),
      roles: parse(row.roles_json, []),
      active: bool(row.active)
    }))
  }

  saveRoster(
    roster: readonly PassportRosterMember[],
    expectedGeneration?: number,
    operationId?: string
  ): PassportRosterMember[] {
    this.assertWritable()
    if (!this.getPrivacy().identityPersistenceOptIn) {
      throw persistenceDomainError('Identity persistence opt-in is required before storing roster data.')
    }
    const normalized = roster.map(sanitizeRosterMember)
    const mutationId = this.normalizeMutationId(operationId)
    const receipt = mutationId ? this.readMutationReceipt(mutationId) : undefined
    if (receipt) {
      const currentRoster = this.listRoster()
      if (
        receipt.kind !== 'roster-save' ||
        receipt.resultHash !== rosterIntentHash(normalized)
      ) {
        throw persistenceDomainError('Roster mutation operation ID was reused.')
      }
      if (
        receipt.generation === this.getRosterMutationGeneration() &&
        receipt.resultHash === rosterIntentHash(currentRoster)
      ) {
        return currentRoster
      }
      throw persistenceDomainError('Roster mutation operation was superseded.')
    }
    const expected = expectedGeneration ?? this.getRosterMutationGeneration()
    return this.transaction(() => {
      this.assertMetaGeneration(
        'roster_mutation_generation',
        expected,
        'Roster mutation generation conflict.'
      )
      this.db.exec('DELETE FROM passport_roster')
      const insert = this.db.prepare(`
        INSERT INTO passport_roster (
          member_id, display_name, roles_json, active, data_class
        ) VALUES (?, ?, ?, ?, 'D3')
      `)
      for (const member of normalized) {
        insert.run(
          member.memberId,
          member.displayName,
          stable(member.roles),
          member.active ? 1 : 0
        )
      }
      this.writeMetaGeneration('roster_mutation_generation', expected + 1)
      if (mutationId) {
        this.writeMutationReceipt({
          operationId: mutationId,
          kind: 'roster-save',
          generation: expected + 1,
          resultHash: rosterIntentHash(normalized)
        })
      }
      return normalized
    })
  }

  advancePersistenceMigration(
    operationId: string,
    step: 'roster' | 'passport'
  ): PassportPersistenceMigrationState | undefined {
    this.assertWritable()
    const normalizedId = this.normalizeMutationId(operationId)
    if (!normalizedId) {
      throw persistenceDomainError('Passport persistence migration operation ID is required.')
    }
    return this.transaction(() => {
      const migration = this.readPersistenceMigration()
      if (!migration) return undefined
      if (migration.operationId !== normalizedId) {
        throw persistenceDomainError('Passport persistence migration operation ID was superseded.')
      }
      const next: PassportPersistenceMigrationState = {
        ...migration,
        rosterComplete: migration.rosterComplete || step === 'roster',
        passportComplete: migration.passportComplete || step === 'passport'
      }
      if (next.rosterComplete && next.passportComplete) {
        this.clearPersistenceMigrationInTransaction()
        return undefined
      }
      this.writeMetaValueInTransaction('persistence_migration', stable(next))
      return next
    })
  }

  persistPassport(
    passport: StintPassport,
    event: PassportStoreEvent,
    expectedPrivacyGeneration?: number
  ): StintPassport {
    this.assertWritable()
    if (!this.getPrivacy().identityPersistenceOptIn) {
      throw persistenceDomainError('Identity persistence opt-in is required before storing a stint passport.')
    }
    const privacyGeneration = expectedPrivacyGeneration ?? this.getPrivacyMutationGeneration()
    this.assertMetaGeneration(
      'privacy_mutation_generation',
      privacyGeneration,
      'Passport privacy mutation generation conflict.'
    )
    const persisted: StintPassport = { ...passport, persisted: true, durability: 'durable' }
    const dedupeKey = event.canonicalEvent.dedupeKey
    const semanticHash = semanticOperationHash(persisted, event)
    const existing = this.db.prepare(`
      SELECT event_id FROM passport_event
      WHERE dedupe_key = ? OR semantic_hash = ?
      LIMIT 1
    `).get(dedupeKey, semanticHash) as Row | undefined
    if (existing) {
      const current = this.db.prepare(`
        SELECT passport_sha256 FROM stint_passport WHERE stint_id = ?
      `).get(persisted.identity.stintId) as Row | undefined
      if (text(current?.passport_sha256) !== hashBytes(encodeStintPassport(persisted))) {
        throw persistenceDomainError(`Passport dedupe conflict for ${dedupeKey}.`)
      }
      return persisted
    }
    return this.transaction(() => {
      this.assertMetaGeneration(
        'privacy_mutation_generation',
        privacyGeneration,
        'Passport privacy mutation generation conflict.'
      )
      this.upsertPassportInTransaction(persisted)
      this.appendEventInTransaction(persisted, event, semanticHash)
      return persisted
    })
  }

  listPassports(limit = 50): StintPassport[] {
    const rows = this.db.prepare(`
      SELECT * FROM stint_passport
      ORDER BY started_at DESC, stint_id DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(500, Math.round(limit)))) as Row[]
    return rows.map((row) => this.passportFromRow(row))
  }

  getPassport(stintId: string): StintPassport | null {
    const row = this.db.prepare('SELECT * FROM stint_passport WHERE stint_id = ?').get(stintId) as Row | undefined
    return row ? this.passportFromRow(row) : null
  }

  getIntegrity(): PassportIntegrityState {
    return this.stickyCorrupt
      ? this.stickyCorruptionState(this.integrity.scope, this.integrity.checkedEvents, this.integrity.message ?? 'Persistence is quarantined.')
      : { ...this.integrity }
  }

  validateRepairToken(token: string): boolean {
    if (!token || token.length !== this.repairToken.length) return false
    try {
      return timingSafeEqual(Buffer.from(token, 'utf8'), Buffer.from(this.repairToken, 'utf8'))
    } catch {
      return false
    }
  }

  metricsSnapshot(): PassportStoreMetrics {
    return { ...this.metrics }
  }

  eventHeaders(stintId: string): PassportEventHeader[] {
    return (this.db.prepare(`
      SELECT sequence, logical_time_ms, dedupe_key, record_hash, previous_hash
      FROM passport_event
      WHERE stint_id = ?
      ORDER BY sequence ASC
    `).all(stintId) as Row[]).map((row) => ({
      sequence: numberValue(row.sequence),
      logicalTimeMs: numberValue(row.logical_time_ms),
      dedupeKey: text(row.dedupe_key),
      recordHash: text(row.record_hash),
      previousHash: optionalText(row.previous_hash)
    }))
  }

  verifyActiveStint(stintId: string): PassportIntegrityState {
    const state = this.verifyStints([stintId], BOUNDED_VERIFY_LIMIT, 'bounded')
    this.integrity = state
    return { ...state }
  }

  async runFullAudit(): Promise<PassportIntegrityState> {
    this.metrics.fullAuditRuns += 1
    if (!this.verifyDeletionTombstones()) {
      this.setStickyCorruption('Deletion tombstone integrity mismatch.')
      return { ...this.integrity }
    }
    const rows = this.db.prepare(`
      SELECT DISTINCT stint_id FROM passport_event
      ORDER BY stint_id ASC
    `).all() as Row[]
    const stintIds = rows.map((row) => text(row.stint_id))
    let checkedEvents = 0
    let headHash: string | undefined
    for (const stintId of stintIds) {
      const rows = this.db.prepare(`
        SELECT * FROM passport_event
        WHERE stint_id = ?
        ORDER BY sequence ASC
      `).all(stintId) as Row[]
      let previousHash: string | undefined
      let lastStateHash: string | undefined
      let lastStateDataClass: PassportDataClass = 'D3'
      let lastStateTransform = 'passport.state-hash.v2'
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]
        const payloadState = text(row.payload_state)
        if (payloadState === 'available') {
          if (row.tombstone_json != null) {
            this.setStickyCorruption(`Unexpected event tombstone in stint ${stintId}.`)
            return { ...this.integrity }
          }
          const bytes = row.event_binary as Uint8Array
          if (!(bytes instanceof Uint8Array) || hashBytes(bytes) !== text(row.payload_sha256)) {
            this.setStickyCorruption(`Canonical event payload hash mismatch in stint ${stintId}.`)
            return { ...this.integrity }
          }
          try {
            const canonical = decodeRaceOpsEvent(bytes)
            const jsonCanonical = raceOpsEventFromProtoJson(parse(row.payload_json, {}))
            if (
              canonical.eventId !== text(row.event_id) ||
              canonical.eventType !== text(row.event_type) ||
              canonical.dedupeKey !== text(row.dedupe_key) ||
              canonical.sequence !== String(numberValue(row.sequence)) ||
              hashBytes(encodeRaceOpsEvent(jsonCanonical)) !== text(row.payload_sha256)
            ) {
              throw new Error('mirror mismatch')
            }
            const stateFact = canonical.facts.find((fact) => fact.name === 'passport.state_hash')
            if (typeof stateFact?.value?.value === 'string') {
              lastStateHash = stateFact.value.value
              lastStateDataClass = text(row.data_class) as PassportDataClass
              lastStateTransform = stateFact.provenance?.transformId ?? lastStateTransform
            }
          } catch {
            this.setStickyCorruption(`Canonical event mirror mismatch in stint ${stintId}.`)
            return { ...this.integrity }
          }
        } else if (payloadState === 'retention-redacted') {
          const tombstone = parse<Record<string, unknown>>(row.tombstone_json, {})
          if (
            row.event_binary != null ||
            row.payload_json != null ||
            tombstone.reason !== 'retention-or-explicit-delete' ||
            typeof tombstone.redactedAt !== 'number' ||
            typeof tombstone.dataClass !== 'string'
          ) {
            this.setStickyCorruption(`Invalid retention tombstone in stint ${stintId}.`)
            return { ...this.integrity }
          }
        } else {
          this.setStickyCorruption(`Unknown event payload state in stint ${stintId}.`)
          return { ...this.integrity }
        }
        const expected = hash(this.eventRecordBase(row, previousHash))
        if (optionalText(row.previous_hash) !== previousHash || text(row.record_hash) !== expected) {
          this.setStickyCorruption(`Integrity mismatch in stint ${stintId}.`)
          this.integrity = this.stickyCorruptionState('full', checkedEvents, `Integrity mismatch in stint ${stintId}.`)
          return { ...this.integrity }
        }
        previousHash = text(row.record_hash)
        headHash = previousHash
        checkedEvents += 1
        if ((index + 1) % 250 === 0) {
          await new Promise<void>((resolve) => setImmediate(resolve))
        }
      }
      const passport = this.getPassport(stintId)
      const expectedStateHash = passport && lastStateTransform === 'passport.state-hash.v3.class-scoped'
        ? passportStateHash(passport, lastStateDataClass)
        : passport ? passportStateHash(passport) : undefined
      if (!passport || !this.verifyPassportPayload(stintId, passport) || lastStateHash !== expectedStateHash) {
        this.setStickyCorruption(`Passport state hash mismatch in stint ${stintId}.`)
        this.integrity = this.stickyCorruptionState('full', checkedEvents, `Passport state hash mismatch in stint ${stintId}.`)
        return { ...this.integrity }
      }
      this.heads.set(stintId, previousHash)
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    if (this.anchorReady && !this.verifyTrustedAnchor()) {
      this.setStickyCorruption('Trusted integrity anchor does not match the verified event chain.')
      return { ...this.integrity }
    }
    this.integrity = {
      state: this.anchorReady ? 'anchored' : 'unanchored',
      verified: this.anchorReady,
      scope: 'full',
      checkedEvents,
      totalEvents: checkedEvents,
      headHash,
      lastCheckedAt: this.now(),
      message: this.anchorReady
        ? 'Full audit verified against a trusted signature anchor.'
        : 'Full local hash audit completed; no external anchor is configured.'
    }
    return { ...this.integrity }
  }

  purgeRetention(
    now = this.now(),
    operationId?: string,
    privacyMutationGeneration?: number
  ): PassportDeleteResult[] {
    this.assertWritable()
    if (!Number.isSafeInteger(now) || now < 0) {
      throw persistenceDomainError('Passport retention timestamp is invalid.')
    }
    const mutationId = this.normalizeMutationId(operationId)
    const receipt = mutationId ? this.readMutationReceipt(mutationId) : undefined
    if (receipt) {
      const result = receipt.result as PassportRetentionReceiptResult | undefined
      if (
        receipt.kind !== 'privacy-retention' ||
        !result ||
        result.retainedAt !== now ||
        !Array.isArray(result.results)
      ) {
        throw persistenceDomainError('Passport retention operation ID was reused.')
      }
      return result.results
    }
    if (this.readPersistenceMigration()) {
      throw persistenceDomainError(
        'Passport persistence migration must complete before retention advances privacy state.'
      )
    }
    const currentGeneration = this.getPrivacyMutationGeneration()
    const nextGeneration = privacyMutationGeneration ?? currentGeneration + 1
    if (nextGeneration !== currentGeneration + 1) {
      throw persistenceDomainError('Passport retention mutation generation conflict.')
    }
    return this.transaction(() => {
      this.assertMetaGeneration(
        'privacy_mutation_generation',
        currentGeneration,
        'Passport retention mutation generation conflict.'
      )
      this.writeMetaGeneration('privacy_mutation_generation', nextGeneration)
      const privacy = this.getPrivacy()
      const results: PassportDeleteResult[] = []
      const d3Cutoff = now - privacy.retentionDays.D3 * 86_400_000
      const d3Redactions = this.redactEvidenceByClass('D3', d3Cutoff, true, true) +
        this.redactClosedIdentity(d3Cutoff, true)
      if (d3Redactions > 0) {
        results.push({ deletedStints: 0, redactedEvidence: d3Redactions, dataClass: 'D3' })
      }
      for (const dataClass of ['D1', 'D2'] as const) {
        const cutoff = now - privacy.retentionDays[dataClass] * 86_400_000
        const redactedEvidence = this.redactEvidenceByClass(dataClass, cutoff, false, true) +
          (dataClass === 'D1' ? this.deleteRuntimeLogs(cutoff) : 0)
        if (redactedEvidence > 0) {
          results.push({ deletedStints: 0, redactedEvidence, dataClass })
        }
      }
      if (mutationId) {
        const result: PassportRetentionReceiptResult = { retainedAt: now, results }
        this.writeMutationReceipt({
          operationId: mutationId,
          kind: 'privacy-retention',
          generation: nextGeneration,
          resultHash: hash(result),
          result
        })
      }
      return results
    })
  }

  deleteByClass(
    dataClass: PassportDataClass,
    privacyMutationGeneration?: number,
    operationId?: string
  ): PassportDeleteResult {
    this.assertWritable()
    const mutationId = this.normalizeMutationId(operationId)
    const mutationKind = `privacy-delete:${dataClass}` as const
    const receipt = mutationId ? this.readMutationReceipt(mutationId) : undefined
    if (receipt) {
      if (receipt.kind !== mutationKind || !receipt.result) {
        throw persistenceDomainError('Passport privacy deletion operation ID was reused.')
      }
      return receipt.result as PassportDeleteResult
    }
    const currentPrivacyGeneration = this.getPrivacyMutationGeneration()
    const nextPrivacyGeneration = privacyMutationGeneration ?? currentPrivacyGeneration + 1
    if (nextPrivacyGeneration !== currentPrivacyGeneration + 1) {
      throw persistenceDomainError('Passport privacy deletion generation conflict.')
    }
    if (dataClass === 'D3') {
      const rows = this.db.prepare('SELECT stint_id FROM stint_passport').all() as Row[]
      const ids = rows.map((row) => text(row.stint_id))
      const settings = this.settingsRow()
      const privacy = sanitizePrivacy({
        ...parse(settings?.privacy_json, DEFAULT_PASSPORT_PRIVACY),
        identityPersistenceOptIn: false,
        updatedAt: this.now()
      }, this.now())
      this.transaction(() => {
        this.assertMetaGeneration(
          'privacy_mutation_generation',
          currentPrivacyGeneration,
          'Passport privacy deletion generation conflict.'
        )
        this.writeMetaGeneration('privacy_mutation_generation', nextPrivacyGeneration)
        const rosterGeneration = this.getRosterMutationGeneration()
        this.writeMetaGeneration('roster_mutation_generation', rosterGeneration + 1)
        this.clearPersistenceMigrationInTransaction()
        if (ids.length > 0) this.appendDeletionTombstone('D3', ids)
        this.db.exec('DELETE FROM passport_roster')
        this.db.exec('DELETE FROM stint_passport')
        this.db.prepare(`
          DELETE FROM passport_mutation_receipt
          WHERE mutation_kind = 'roster-save'
        `).run()
        this.writeSettingsInTransaction(
          parse(settings?.config_json, DEFAULT_PASSPORT_CONFIG),
          privacy,
          bool(settings?.kill_switch)
        )
        if (mutationId) {
          const result: PassportDeleteResult = {
            deletedStints: ids.length,
            redactedEvidence: 0,
            dataClass
          }
          this.writeMutationReceipt({
            operationId: mutationId,
            kind: mutationKind,
            generation: nextPrivacyGeneration,
            resultHash: hash(result),
            result
          })
        }
      })
      return { deletedStints: ids.length, redactedEvidence: 0, dataClass }
    }
    return this.transaction(() => {
      this.assertMetaGeneration(
        'privacy_mutation_generation',
        currentPrivacyGeneration,
        'Passport privacy deletion generation conflict.'
      )
      this.writeMetaGeneration('privacy_mutation_generation', nextPrivacyGeneration)
      const redactedEvidence = this.redactEvidenceByClass(
        dataClass,
        Number.MAX_SAFE_INTEGER,
        false,
        true
      ) + (dataClass === 'D1' ? this.deleteRuntimeLogs(Number.MAX_SAFE_INTEGER) : 0)
      this.rebasePersistenceMigrationAfterDeletionInTransaction(
        dataClass,
        nextPrivacyGeneration
      )
      const result: PassportDeleteResult = {
        deletedStints: 0,
        redactedEvidence,
        dataClass
      }
      if (mutationId) {
        this.writeMutationReceipt({
          operationId: mutationId,
          kind: mutationKind,
          generation: nextPrivacyGeneration,
          resultHash: hash(result),
          result
        })
      }
      return result
    })
  }

  exportPackage(
    profile: PassportExportProfile,
    current?: StintPassport | null,
    ephemeralHistory: readonly StintPassport[] = [],
    ephemeralRoster: readonly PassportRosterMember[] = []
  ): PassportExportPackage {
    const persisted = this.listPassports(500)
    const byId = new Map<string, StintPassport>()
    for (const passport of [...persisted, ...ephemeralHistory, ...(current ? [current] : [])]) {
      const existing = byId.get(passport.identity.stintId)
      if (
        !existing ||
        passport.revision > existing.revision ||
        (
          passport.revision === existing.revision &&
          passport.persisted &&
          passport.durability === 'durable' &&
          (!existing.persisted || existing.durability !== 'durable')
        )
      ) {
        byId.set(passport.identity.stintId, passport)
      }
    }
    const roster = this.getPrivacy().identityPersistenceOptIn
      ? this.listRoster()
      : [...ephemeralRoster]
    const labels = new Map<string, string>()
    for (const passport of byId.values()) {
      labels.set(passport.identity.driverLabel, this.pseudonym('driver', passport.identity.driverRef))
      if (passport.identity.teamLabel && passport.identity.teamRef) {
        labels.set(passport.identity.teamLabel, this.pseudonym('team', passport.identity.teamRef))
      }
    }
    for (const member of roster) {
      const memberPseudonym = this.pseudonym('member', member.memberId)
      labels.set(member.displayName, `Member ${memberPseudonym}`)
      labels.set(member.memberId, `member:${memberPseudonym}`)
    }
    const sensitive = [...byId.values()].flatMap((passport) => [
      passport.identity.driverRef,
      passport.identity.driverLabel,
      passport.identity.teamRef ?? '',
      passport.identity.teamLabel ?? ''
    ]).concat(roster.flatMap((member) => [member.memberId, member.displayName]))
      .filter((value) => value.length >= 3)
      .map(normalizedSecret)
    const redactions: string[] = [
      'driver identity',
      'team identity',
      'roster member identity',
      'role owner member id',
      'capability and challenge secrets'
    ]
    let passports = [...byId.values()].map((passport) =>
      scrubExportValue(
        redactPassport(passport, profile, labels, this.pseudonym.bind(this)),
        sensitive
      ) as StintPassport
    )
    const exportedRoster = roster.map((member) => ({
      ...member,
      memberId: profile === 'race-only' ? '[member redacted]' : `member:${this.pseudonym('member', member.memberId)}`,
      displayName: profile === 'race-only'
        ? '[member redacted]'
        : `Member ${this.pseudonym('member', member.memberId)}`
    }))
    const generatedAt = Math.max(0, ...passports.map((passport) => passport.closedAt ?? passport.identity.startedAt))
    const eventRows = (this.db.prepare(`
      SELECT event_id, event_type, payload_json, payload_state, tombstone_json, data_class
      FROM passport_event
      ORDER BY sequence DESC
      LIMIT ?
    `).all(MAX_EXPORT_EVENTS) as Row[]).reverse()
    let canonicalEvents = eventRows.map((row) => {
      if (text(row.payload_state) !== 'available') {
        return {
          eventId: text(row.event_id),
          eventType: text(row.event_type),
          payloadState: text(row.payload_state),
          tombstone: parse(row.tombstone_json, {})
        }
      }
      if (text(row.data_class) === 'D3') {
        return {
          eventId: text(row.event_id),
          eventType: text(row.event_type),
          payloadState: 'privacy-redacted'
        }
      }
      return scrubExportValue(parse(row.payload_json, {}), sensitive)
    })
    const deletionTombstones = (this.db.prepare(`
      SELECT data_class, deleted_at, subject_hashes_json, previous_hash, record_hash
      FROM passport_deletion_tombstone
      ORDER BY deleted_at ASC, tombstone_id ASC
    `).all() as Row[]).map((row) => ({
      dataClass: text(row.data_class),
      deletedAt: numberValue(row.deleted_at),
      subjectHashes: parse(row.subject_hashes_json, []),
      previousHash: optionalText(row.previous_hash),
      recordHash: text(row.record_hash)
    }))
    const integrity = { ...this.getIntegrity(), repairToken: undefined }
    let base = {
      contractVersion: STINT_PASSPORT_CONTRACT_VERSION,
      profile,
      generatedAt,
      passports,
      roster: exportedRoster,
      integrity,
      canonicalEvents,
      deletionTombstones,
      redactions
    }
    while (Buffer.byteLength(JSON.stringify(base), 'utf8') > MAX_EXPORT_BYTES && canonicalEvents.length > 0) {
      canonicalEvents = canonicalEvents.slice(1)
      base = { ...base, canonicalEvents }
      if (!redactions.includes('oldest events omitted by export size limit')) {
        redactions.push('oldest events omitted by export size limit')
      }
    }
    while (Buffer.byteLength(JSON.stringify(base), 'utf8') > MAX_EXPORT_BYTES && passports.length > 0) {
      passports = passports.slice(1)
      base = { ...base, passports }
      if (!redactions.includes('oldest passports omitted by export size limit')) {
        redactions.push('oldest passports omitted by export size limit')
      }
    }
    if (Buffer.byteLength(JSON.stringify(base), 'utf8') > MAX_EXPORT_BYTES) {
      throw persistenceDomainError('Passport export exceeds the 5 MB safety limit after bounded redaction.')
    }
    const packageHash = hash(base)
    const signerId = hash(this.databaseId).slice(0, 32)
    const packageSignature = createHmac('sha256', this.anchorKey)
      .update(`passport-export:${signerId}:${packageHash}`, 'utf8')
      .digest('hex')
    return { ...base, packageHash, signerId, packageSignature }
  }

  verifyImportPackage(value: unknown): PassportExportPackage {
    if (!this.anchorReady || !value || typeof value !== 'object' || Array.isArray(value)) {
      throw persistenceDomainError('Passport import requires a locally trusted signed package.')
    }
    assertBoundedImportValue(value)
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_EXPORT_BYTES) {
      throw persistenceDomainError('Passport import exceeds the 5 MB safety limit.')
    }
    const candidate = value as PassportExportPackage
    if (
      candidate.contractVersion !== STINT_PASSPORT_CONTRACT_VERSION ||
      !Array.isArray(candidate.passports) ||
      candidate.passports.length > 500 ||
      !Array.isArray(candidate.roster) ||
      candidate.roster.length > 500 ||
      !Array.isArray(candidate.canonicalEvents) ||
      candidate.canonicalEvents.length > MAX_EXPORT_EVENTS ||
      !Array.isArray(candidate.deletionTombstones) ||
      candidate.deletionTombstones.length > 5_000 ||
      !Array.isArray(candidate.redactions) ||
      candidate.redactions.length > 500 ||
      !candidate.redactions.every((item) => typeof item === 'string') ||
      (candidate.profile !== 'full-local' &&
        candidate.profile !== 'pseudonymized' &&
        candidate.profile !== 'race-only') ||
      !Number.isSafeInteger(candidate.generatedAt) ||
      candidate.generatedAt < 0
    ) {
      throw persistenceDomainError('Passport import collections violate their bounded contract.')
    }
    const { packageHash, signerId, packageSignature, ...base } = candidate
    if (
      !/^[a-f0-9]{64}$/.test(packageHash) ||
      !/^[a-f0-9]{32}$/.test(signerId) ||
      !/^[a-f0-9]{64}$/.test(packageSignature) ||
      hash(base) !== packageHash ||
      signerId !== hash(this.databaseId).slice(0, 32)
    ) {
      throw persistenceDomainError('Passport import package hash or signer is invalid.')
    }
    const expected = createHmac('sha256', this.anchorKey)
      .update(`passport-export:${signerId}:${packageHash}`, 'utf8')
      .digest()
    const actual = Buffer.from(packageSignature ?? '', 'hex')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw persistenceDomainError('Passport import package signature is invalid.')
    }
    const passports = candidate.passports.map((passport) => {
      if (
        passport.contractVersion !== STINT_PASSPORT_CONTRACT_VERSION ||
        typeof passport.identity?.stintId !== 'string' ||
        passport.identity.stintId.length > 200
      ) {
        throw persistenceDomainError('Passport import contains an invalid passport identity.')
      }
      const normalized = decodeStintPassport(encodeStintPassport(passport))
      calculatePassportCoverage(normalized.items)
      return normalized
    })
    return { ...candidate, passports }
  }

  logRuntime(kind: string, payload: Record<string, unknown>): void {
    this.assertWritable()
    this.db.prepare(`
      INSERT INTO passport_runtime_log (
        log_id, created_at, kind, payload_json, data_class
      ) VALUES (?, ?, ?, ?, 'D1')
    `).run(this.idFactory(), this.now(), kind.slice(0, 80), stable(payload))
  }

  private migrate(): void {
    let version = this.schemaVersion()
    if (version > PASSPORT_PERSISTENCE_SCHEMA_VERSION) {
      throw new Error(
        `Passport schema ${version} is newer than supported schema ${PASSPORT_PERSISTENCE_SCHEMA_VERSION}.`
      )
    }
    if (version === 0) {
      begin(this.db)
      try {
        this.db.exec(SCHEMA_SQL)
        this.db.prepare(`
          INSERT OR IGNORE INTO passport_clock (
            singleton, next_sequence, last_logical_time_ms
          ) VALUES (1, 0, 0)
        `).run()
        this.writeSettingsInTransaction(
          DEFAULT_PASSPORT_CONFIG,
          DEFAULT_PASSPORT_PRIVACY,
          false
        )
        this.db.exec(`PRAGMA user_version = ${PASSPORT_PERSISTENCE_SCHEMA_VERSION}`)
        this.db.exec('COMMIT')
      } catch (error) {
        rollback(this.db)
        throw error
      }
      return
    }
    if (version < 3) {
      begin(this.db)
      try {
        this.db.exec('ALTER TABLE passport_event ADD COLUMN semantic_hash TEXT')
        this.db.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_passport_event_semantic
          ON passport_event(semantic_hash) WHERE semantic_hash IS NOT NULL
        `)
        this.db.exec('PRAGMA user_version = 3')
        this.db.exec('COMMIT')
        version = 3
      } catch (error) {
        rollback(this.db)
        throw error
      }
    }
    if (version < 4) {
      begin(this.db)
      try {
        this.db.exec("ALTER TABLE passport_item ADD COLUMN evidence_data_class TEXT NOT NULL DEFAULT 'D2'")
        this.db.exec("ALTER TABLE passport_item ADD COLUMN detail_data_class TEXT NOT NULL DEFAULT 'D2'")
        this.db.exec("ALTER TABLE passport_item ADD COLUMN owner_data_class TEXT NOT NULL DEFAULT 'D2'")
        this.db.exec("ALTER TABLE passport_item ADD COLUMN reason_data_class TEXT NOT NULL DEFAULT 'D2'")
        this.db.exec("ALTER TABLE passport_item ADD COLUMN provenance_data_class TEXT NOT NULL DEFAULT 'D2'")
        this.db.exec(`
          UPDATE passport_item
          SET data_class = CASE
                WHEN owner_json IS NOT NULL OR override_reason IS NOT NULL OR reason_code IS NOT NULL
                  THEN 'D3'
                ELSE ${ITEM_DATA_CLASS_SQL}
              END,
              evidence_data_class = ${ITEM_DATA_CLASS_SQL},
              detail_data_class = ${ITEM_DATA_CLASS_SQL},
              owner_data_class = 'D3',
              reason_data_class = 'D3',
              provenance_data_class = ${ITEM_DATA_CLASS_SQL}
        `)
        this.db.exec('PRAGMA user_version = 4')
        this.db.exec('COMMIT')
      } catch (error) {
        rollback(this.db)
        throw error
      }
    }
    if (version < 5) {
      begin(this.db)
      try {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS passport_mutation_receipt (
            operation_id TEXT PRIMARY KEY,
            mutation_kind TEXT NOT NULL,
            generation INTEGER NOT NULL,
            result_hash TEXT NOT NULL,
            result_json TEXT,
            applied_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_passport_mutation_receipt_applied
            ON passport_mutation_receipt(applied_at DESC, operation_id);
          PRAGMA user_version = 5;
        `)
        this.db.exec('COMMIT')
      } catch (error) {
        rollback(this.db)
        throw error
      }
    }
  }

  private settingsRow(): Row | undefined {
    return this.db.prepare('SELECT * FROM passport_settings WHERE singleton = 1').get() as Row | undefined
  }

  private writeSettings(
    config: PassportConfig,
    privacy: PassportPrivacySettings,
    killSwitch: boolean
  ): void {
    this.transaction(() => {
      this.writeSettingsInTransaction(config, privacy, killSwitch)
    })
  }

  private writeSettingsInTransaction(
    config: PassportConfig,
    privacy: PassportPrivacySettings,
    killSwitch: boolean
  ): void {
    this.db.prepare(`
      INSERT INTO passport_settings (
        singleton, config_json, privacy_json, kill_switch, updated_at
      ) VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(singleton) DO UPDATE SET
        config_json = excluded.config_json,
        privacy_json = excluded.privacy_json,
        kill_switch = excluded.kill_switch,
        updated_at = excluded.updated_at
    `).run(stable(config), stable(privacy), killSwitch ? 1 : 0, this.now())
  }

  private readOrCreateMeta(key: string, factory: () => string): string {
    const row = this.db.prepare('SELECT value FROM passport_meta WHERE key = ?').get(key) as Row | undefined
    if (row) return text(row.value)
    const value = factory()
    this.db.prepare('INSERT INTO passport_meta(key, value) VALUES (?, ?)').run(key, value)
    return value
  }

  private readMetaValue(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM passport_meta WHERE key = ?').get(key) as Row | undefined
    return row ? text(row.value) : undefined
  }

  private writeMetaValueInTransaction(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO passport_meta(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value)
  }

  private clearPersistenceMigrationInTransaction(): void {
    this.db.prepare("DELETE FROM passport_meta WHERE key = 'persistence_migration'").run()
  }

  private rebasePersistenceMigrationAfterDeletionInTransaction(
    dataClass: 'D1' | 'D2',
    privacyMutationGeneration: number
  ): void {
    const migration = this.readPersistenceMigration()
    if (!migration) return
    const deletedEvidenceHashes = new Set<string>()
    const passport = migration.passport
      ? (() => {
          for (const item of migration.passport.items) {
            if (itemDataClass(item.id) === dataClass && item.evidence?.contentHash) {
              deletedEvidenceHashes.add(item.evidence.contentHash)
            }
          }
          // If the migration passport was already committed to stint_passport (crash after
          // persistPassport but before advancePersistenceMigration), the DB holds the
          // authoritative post-deletion state (redactEvidenceByClass ran earlier in this
          // transaction). Use it directly to avoid a revision/item-revision mismatch that
          // would cause a dedupe conflict on recovery.
          const committed = this.getPassport(migration.passport.identity.stintId)
          if (committed) return committed
          const items = migration.passport.items.map((item): PassportItem => {
            if (itemDataClass(item.id) !== dataClass) return item
            return {
              ...item,
              status: 'unknown',
              detail: 'Evidence removed by data-class deletion.',
              verifiedAt: undefined,
              expiresAt: undefined,
              evidence: undefined,
              revision: item.revision + 1
            }
          })
          return coherentAfterPrivacyRedaction({
            ...migration.passport,
            items,
            ...calculatePassportCoverage(items)
          })
        })()
      : undefined
    const event = migration.event
      ? {
          ...migration.event,
          canonicalEvent: {
            ...migration.event.canonicalEvent,
            facts: migration.event.canonicalEvent.facts.filter((fact) =>
              migration.event?.dataClass !== dataClass &&
              fact.provenance?.privacyClass !== dataClass
            ),
            evidenceRefs: migration.event.canonicalEvent.evidenceRefs.filter((reference) =>
              !deletedEvidenceHashes.has(reference)
            )
          }
        }
      : undefined
    this.writePersistenceMigrationInTransaction({
      ...migration,
      privacyMutationGeneration,
      passport,
      event
    })
  }

  private normalizePersistenceMigration(
    migration: PassportPersistenceMigrationPlan
  ): PassportPersistenceMigrationState {
    const operationId = this.normalizeMutationId(migration.operationId)
    if (!operationId) {
      throw persistenceDomainError('Passport persistence migration operation ID is required.')
    }
    if (
      !Number.isSafeInteger(migration.privacyMutationGeneration) ||
      migration.privacyMutationGeneration < 0
    ) {
      throw persistenceDomainError('Passport persistence migration generation is invalid.')
    }
    const roster = migration.roster.map(sanitizeRosterMember)
    if (new Set(roster.map((member) => member.memberId)).size !== roster.length) {
      throw persistenceDomainError('Passport persistence migration roster IDs must be unique.')
    }
    if ((migration.passport === undefined) !== (migration.event === undefined)) {
      throw persistenceDomainError('Passport persistence migration requires both passport and event.')
    }
    const passport = migration.passport
      ? decodeStintPassport(encodeStintPassport(migration.passport))
      : undefined
    const event = migration.event
      ? {
          ...migration.event,
          canonicalEvent: decodeRaceOpsEvent(encodeRaceOpsEvent(migration.event.canonicalEvent))
        }
      : undefined
    if (passport && event && event.itemId && !passport.items.some((item) => item.id === event.itemId)) {
      throw persistenceDomainError('Passport persistence migration event item is invalid.')
    }
    return {
      operationId,
      privacyMutationGeneration: migration.privacyMutationGeneration,
      roster,
      passport,
      event,
      rosterComplete: roster.length === 0,
      passportComplete: passport === undefined
    }
  }

  private writePersistenceMigrationInTransaction(
    migration: PassportPersistenceMigrationState
  ): void {
    if (migration.rosterComplete && migration.passportComplete) {
      this.clearPersistenceMigrationInTransaction()
      return
    }
    this.writeMetaValueInTransaction('persistence_migration', stable(migration))
  }

  private readPersistenceMigration(): PassportPersistenceMigrationState | undefined {
    const value = this.readMetaValue('persistence_migration')
    if (!value) return undefined
    const parsed = parse<PassportPersistenceMigrationState | undefined>(value, undefined)
    if (
      !parsed ||
      typeof parsed.operationId !== 'string' ||
      !Number.isSafeInteger(parsed.privacyMutationGeneration) ||
      parsed.privacyMutationGeneration < 0 ||
      !Array.isArray(parsed.roster) ||
      typeof parsed.rosterComplete !== 'boolean' ||
      typeof parsed.passportComplete !== 'boolean' ||
      ((parsed.passport === undefined) !== (parsed.event === undefined))
    ) {
      throw persistenceDomainError('Passport persistence migration state is invalid.')
    }
    return {
      ...parsed,
      roster: parsed.roster.map(sanitizeRosterMember),
      passport: parsed.passport
        ? decodeStintPassport(encodeStintPassport(parsed.passport))
        : undefined,
      event: parsed.event
        ? {
            ...parsed.event,
            canonicalEvent: decodeRaceOpsEvent(encodeRaceOpsEvent(parsed.event.canonicalEvent))
          }
        : undefined
    }
  }

  private metaGeneration(key: string): number {
    const value = Number(this.readOrCreateMeta(key, () => '0'))
    if (!Number.isSafeInteger(value) || value < 0) {
      throw persistenceDomainError(`Passport metadata generation is invalid: ${key}.`)
    }
    return value
  }

  private assertMetaGeneration(key: string, expected: number, message: string): void {
    if (!Number.isSafeInteger(expected) || expected < 0 || this.metaGeneration(key) !== expected) {
      throw persistenceDomainError(message)
    }
  }

  private writeMetaGeneration(key: string, generation: number): void {
    if (!Number.isSafeInteger(generation) || generation < 0) {
      throw persistenceDomainError(`Passport metadata generation is invalid: ${key}.`)
    }
    this.db.prepare(`
      INSERT INTO passport_meta(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, String(generation))
  }

  private normalizeMutationId(operationId?: string): string | undefined {
    if (operationId === undefined) return undefined
    const normalized = operationId.trim()
    if (!/^[A-Za-z0-9:_-]{16,160}$/.test(normalized)) {
      throw persistenceDomainError('Passport mutation operation ID is invalid.')
    }
    return normalized
  }

  private readMutationReceipt(operationId: string): PassportMutationReceipt | undefined {
    const row = this.db.prepare(`
      SELECT operation_id, mutation_kind, generation, result_hash, result_json
      FROM passport_mutation_receipt
      WHERE operation_id = ?
    `).get(operationId) as Row | undefined
    if (!row) return undefined
    return {
      operationId: text(row.operation_id),
      kind: text(row.mutation_kind) as PassportMutationKind,
      generation: numberValue(row.generation),
      resultHash: text(row.result_hash),
      result: row.result_json == null
        ? undefined
        : parse(row.result_json, undefined)
    }
  }

  private writeMutationReceipt(receipt: PassportMutationReceipt): void {
    this.db.prepare(`
      INSERT INTO passport_mutation_receipt (
        operation_id, mutation_kind, generation, result_hash, result_json, applied_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      receipt.operationId,
      receipt.kind,
      receipt.generation,
      receipt.resultHash,
      receipt.result === undefined ? null : stable(receipt.result),
      this.now()
    )
    this.db.prepare(`
      DELETE FROM passport_mutation_receipt
      WHERE operation_id NOT IN (
        SELECT operation_id
        FROM passport_mutation_receipt
        ORDER BY applied_at DESC, operation_id DESC
        LIMIT 128
      )
    `).run()
  }

  private initializeAnchor(): void {
    if (this.databasePath === ':memory:') return
    const anchorExists = existsSync(this.anchorPath)
    const pendingExists = existsSync(this.pendingAnchorPath)
    if (existsSync(this.anchorKeyPath)) {
      const encoded = readFileSync(this.anchorKeyPath, 'utf8').trim()
      if (!/^[a-f0-9]{64}$/.test(encoded)) {
        this.stickyCorrupt = true
        return
      }
      this.anchorKey = Buffer.from(encoded, 'hex')
    } else {
      if (anchorExists || pendingExists) {
        this.stickyCorrupt = true
        return
      }
      this.anchorKey = randomBytes(32)
      atomicWrite(this.anchorKeyPath, this.anchorKey.toString('hex'), 0o600)
    }
    this.anchorReady = true
    const local = this.anchorSnapshot()
    const anchor = this.readSignedAnchor(this.anchorPath)
    const pending = this.readSignedAnchor(this.pendingAnchorPath)
    if (pending) {
      if (this.anchorMatches(pending, local)) {
        try {
          this.promotePendingAnchor()
        } catch {
          // A matching signed pending anchor remains authoritative until promotion succeeds.
          return
        }
      } else if (this.anchorMatchesLegacy(pending, local)) {
        this.writeAnchor(local)
        rmSync(this.pendingAnchorPath, { force: true })
      } else if (
        anchor &&
        (this.anchorMatches(anchor, local) || this.anchorMatchesLegacy(anchor, local))
      ) {
        rmSync(this.pendingAnchorPath, { force: true })
      } else {
        this.setStickyCorruption('Pending integrity anchor does not match durable storage.')
        return
      }
    }
    const current = this.readSignedAnchor(this.anchorPath)
    if (!current) {
      if (anchorExists) {
        this.setStickyCorruption('Trusted integrity anchor signature is invalid.')
        return
      }
      this.writeAnchor(local)
      return
    }
    if (this.anchorMatches(current, local)) return
    if (this.anchorMatchesLegacy(current, local)) {
      this.writeAnchor(local)
      return
    }
    this.setStickyCorruption('Trusted integrity anchor does not match durable storage.')
  }

  private anchorSnapshot(): AnchorPayload {
    const clock = this.db.prepare(`
      SELECT next_sequence FROM passport_clock WHERE singleton = 1
    `).get() as Row | undefined
    const events = (this.db.prepare(`
      SELECT sequence, record_hash FROM passport_event ORDER BY sequence ASC
    `).all() as Row[]).map((row) => ({
      sequence: numberValue(row.sequence),
      recordHash: text(row.record_hash)
    }))
    const tombstones = (this.db.prepare(`
      SELECT tombstone_id, record_hash
      FROM passport_deletion_tombstone
      ORDER BY deleted_at ASC, tombstone_id ASC
    `).all() as Row[]).map((row) => ({
      tombstoneId: text(row.tombstone_id),
      recordHash: text(row.record_hash)
    }))
    const passports = (this.db.prepare(`
      SELECT stint_id, passport_sha256 FROM stint_passport ORDER BY stint_id ASC
    `).all() as Row[]).map((row) => ({
      stintId: text(row.stint_id),
      passportSha256: text(row.passport_sha256)
    }))
    const roster = (this.db.prepare(`
      SELECT member_id, display_name, roles_json, active, data_class
      FROM passport_roster ORDER BY member_id ASC
    `).all() as Row[]).map((row) => ({
      memberId: text(row.member_id),
      displayName: text(row.display_name),
      roles: text(row.roles_json),
      active: bool(row.active),
      dataClass: text(row.data_class)
    }))
    const mutationReceipts = (this.db.prepare(`
      SELECT operation_id, mutation_kind, generation, result_hash, result_json, applied_at
      FROM passport_mutation_receipt
      ORDER BY operation_id ASC
    `).all() as Row[]).map((row) => ({
      operationId: text(row.operation_id),
      kind: text(row.mutation_kind),
      generation: numberValue(row.generation),
      resultHash: text(row.result_hash),
      result: row.result_json == null ? null : text(row.result_json),
      appliedAt: numberValue(row.applied_at)
    }))
    const settings = this.settingsRow()
    return {
      version: ANCHOR_VERSION,
      databaseId: this.databaseId,
      clockSequence: numberValue(clock?.next_sequence),
      eventCount: events.length,
      eventRoot: hash(events),
      tombstoneCount: tombstones.length,
      tombstoneRoot: hash(tombstones),
      passportCount: passports.length,
      passportRoot: hash(passports),
      settingsHash: hash({
        config: text(settings?.config_json),
        privacy: text(settings?.privacy_json),
        killSwitch: bool(settings?.kill_switch),
        updatedAt: numberValue(settings?.updated_at)
      }),
      rosterHash: hash(roster),
      mutationRoot: hash({
        privacyGeneration: this.getPrivacyMutationGeneration(),
        rosterGeneration: this.getRosterMutationGeneration(),
        receipts: mutationReceipts,
        persistenceMigration: this.readPersistenceMigration()
      })
    }
  }

  private signAnchor(payload: AnchorPayload): SignedAnchor {
    return {
      ...payload,
      signature: createHmac('sha256', this.anchorKey).update(stable(payload), 'utf8').digest('hex')
    }
  }

  private readSignedAnchor(path: string): SignedAnchor | null {
    if (!path || !existsSync(path) || this.anchorKey.length !== 32) return null
    try {
      const candidate = JSON.parse(readFileSync(path, 'utf8')) as SignedAnchor
      const { signature, ...payload } = candidate
      if (
        signature?.length !== 64 ||
        payload.version !== ANCHOR_VERSION ||
        payload.databaseId !== this.databaseId
      ) return null
      const expected = createHmac('sha256', this.anchorKey)
        .update(stable(payload), 'utf8')
        .digest()
      const actual = Buffer.from(signature, 'hex')
      return actual.length === expected.length && timingSafeEqual(actual, expected)
        ? candidate
        : null
    } catch {
      return null
    }
  }

  private anchorMatches(anchor: SignedAnchor, payload: AnchorPayload): boolean {
    const { signature: _signature, ...anchored } = anchor
    return stable(anchored) === stable(payload)
  }

  private anchorMatchesLegacy(anchor: SignedAnchor, payload: AnchorPayload): boolean {
    const { signature: _signature, ...anchored } = anchor
    if ('mutationRoot' in anchored) return false
    if (payload.mutationRoot !== hash({
      privacyGeneration: 0,
      rosterGeneration: 0,
      receipts: []
    })) return false
    const { mutationRoot: _mutationRoot, ...legacy } = payload
    return stable(anchored) === stable(legacy)
  }

  private writeAnchor(payload: AnchorPayload): void {
    if (!this.anchorReady) return
    atomicWrite(this.anchorPath, `${stable(this.signAnchor(payload))}\n`, 0o600)
  }

  private writePendingAnchor(): SignedAnchor | null {
    if (!this.anchorReady) return null
    const signed = this.signAnchor(this.anchorSnapshot())
    atomicWrite(this.pendingAnchorPath, `${stable(signed)}\n`, 0o600)
    return signed
  }

  private promotePendingAnchor(): void {
    if (!this.anchorReady || !existsSync(this.pendingAnchorPath)) return
    this.promoteAnchor(this.pendingAnchorPath, this.anchorPath)
  }

  private verifyTrustedAnchor(): boolean {
    if (!this.anchorReady) return false
    const snapshot = this.anchorSnapshot()
    const anchor = this.readSignedAnchor(this.anchorPath)
    if (anchor && this.anchorMatches(anchor, snapshot)) return true
    const pending = this.readSignedAnchor(this.pendingAnchorPath)
    if (!pending || !this.anchorMatches(pending, snapshot)) return false
    try {
      this.promotePendingAnchor()
    } catch {
      // The signed pending anchor remains the crash-safe proof when Windows blocks promotion.
    }
    return true
  }

  private transaction<T>(work: () => T): T {
    const integrityBefore = this.integrity
    const metricsBefore = { ...this.metrics }
    const pendingAnchorBefore = this.pendingAnchorPath && existsSync(this.pendingAnchorPath)
      ? readFileSync(this.pendingAnchorPath, 'utf8')
      : undefined
    let pending: SignedAnchor | null = null
    let pendingWriteAttempted = false
    let committed = false
    let anchorPromotionPending = false
    begin(this.db)
    try {
      const result = work()
      pendingWriteAttempted = true
      pending = this.writePendingAnchor()
      this.db.exec('COMMIT')
      committed = true
      if (pending) {
        try {
          this.promotePendingAnchor()
        } catch (error) {
          const snapshot = this.anchorSnapshot()
          const pendingAnchor = this.readSignedAnchor(this.pendingAnchorPath)
          const trustedAnchor = this.readSignedAnchor(this.anchorPath)
          if (pendingAnchor && this.anchorMatches(pendingAnchor, snapshot)) {
            anchorPromotionPending = true
          } else if (!trustedAnchor || !this.anchorMatches(trustedAnchor, snapshot)) {
            throw error
          }
        }
      }
      this.heads.clear()
      this.hydrateHeads()
      if (pending) {
        this.integrity = {
          state: 'anchored',
          verified: true,
          scope: 'incremental',
          checkedEvents: 1,
          totalEvents: pending.eventCount,
          headHash: pending.eventRoot,
          lastCheckedAt: this.now(),
          message: anchorPromotionPending
            ? 'Committed local state is verified by a signed pending HMAC anchor.'
            : 'Local state verified against a trusted HMAC signature anchor.'
        }
      }
      return result
    } catch (error) {
      if (!committed) {
        rollback(this.db)
        if (this.pendingAnchorPath && pendingWriteAttempted) {
          if (pendingAnchorBefore === undefined) {
            rmSync(this.pendingAnchorPath, { force: true })
          } else {
            atomicWrite(this.pendingAnchorPath, pendingAnchorBefore, 0o600)
          }
        }
        Object.assign(this.metrics, metricsBefore)
        this.integrity = integrityBefore
      } else if (pending) {
        this.integrity = {
          state: 'unavailable',
          verified: false,
          scope: 'incremental',
          checkedEvents: 0,
          totalEvents: pending.eventCount,
          headHash: pending.eventRoot,
          lastCheckedAt: this.now(),
          message: 'Database commit completed, but trusted anchor promotion is pending.'
        }
      }
      this.heads.clear()
      this.hydrateHeads()
      throw error
    }
  }

  private hasValidQuarantineMarker(): boolean {
    if (!this.anchorReady || !existsSync(this.quarantineMarkerPath)) return false
    try {
      const marker = JSON.parse(readFileSync(this.quarantineMarkerPath, 'utf8')) as {
        databaseId: string
        quarantinedAt: number
        reasonHash: string
        signature: string
      }
      const payload = {
        databaseId: marker.databaseId,
        quarantinedAt: marker.quarantinedAt,
        reasonHash: marker.reasonHash
      }
      const expected = createHmac('sha256', this.anchorKey).update(stable(payload), 'utf8').digest()
      const actual = Buffer.from(marker.signature ?? '', 'hex')
      return marker.databaseId === this.databaseId &&
        actual.length === expected.length &&
        timingSafeEqual(actual, expected)
    } catch {
      return true
    }
  }

  private writeQuarantineMarker(message: string): void {
    if (!this.anchorReady) return
    const payload = {
      databaseId: this.databaseId,
      quarantinedAt: this.now(),
      reasonHash: hash(message)
    }
    atomicWrite(this.quarantineMarkerPath, `${stable({
      ...payload,
      signature: createHmac('sha256', this.anchorKey).update(stable(payload), 'utf8').digest('hex')
    })}\n`, 0o600)
  }

  private assertWritable(): void {
    if (!this.stickyCorrupt) return
    const error = new Error('Passport persistence is quarantined after an integrity failure.')
    ;(error as Error & { code?: string }).code = 'PERSISTENCE_QUARANTINED'
    throw error
  }

  private setStickyCorruption(message: string): void {
    this.stickyCorrupt = true
    this.db.prepare(`
      INSERT INTO passport_meta(key, value) VALUES ('integrity_state', 'corrupt')
      ON CONFLICT(key) DO UPDATE SET value = 'corrupt'
    `).run()
    this.writeQuarantineMarker(message)
    this.integrity = this.stickyCorruptionState('full', this.integrity?.checkedEvents ?? 0, message)
  }

  private stickyCorruptionState(
    scope: PassportIntegrityState['scope'],
    checkedEvents: number,
    message: string
  ): PassportIntegrityState {
    return {
      state: 'corrupt',
      verified: false,
      scope,
      checkedEvents,
      headHash: this.integrity?.headHash,
      lastCheckedAt: this.now(),
      message,
      repairToken: this.repairToken
    }
  }

  private hydrateHeads(): void {
    const rows = this.db.prepare(`
      SELECT event.stint_id, event.record_hash
      FROM passport_event event
      JOIN (
        SELECT stint_id, MAX(sequence) AS max_sequence
        FROM passport_event
        GROUP BY stint_id
      ) head
        ON head.stint_id = event.stint_id
       AND head.max_sequence = event.sequence
    `).all() as Row[]
    for (const row of rows) this.heads.set(text(row.stint_id), optionalText(row.record_hash))
  }

  private upsertPassportInTransaction(passport: StintPassport): void {
    this.upsertPassportHeaderInTransaction(passport)
    this.upsertPassportItemsInTransaction(passport)
  }

  private upsertPassportHeaderInTransaction(passport: StintPassport): void {
    const passportBinary = encodeStintPassport(passport)
    const passportJson = JSON.stringify(stintPassportProtoJson(passport))
    const passportSha256 = hashBytes(passportBinary)
    this.db.prepare(`
      INSERT INTO stint_passport (
        stint_id, contract_version, session_ref, track_ref, track_label,
        car_ref, car_label, driver_ref, driver_label, team_ref, team_label,
        started_at, lifecycle, telemetry_context, coverage, applicable_items,
        covered_items, challenge_completed_at, challenge_owner_json, closed_at,
        close_reason, interrupted, revision, durability, passport_binary,
        passport_json, passport_sha256, data_class
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'D3')
      ON CONFLICT(stint_id) DO UPDATE SET
        lifecycle = excluded.lifecycle,
        telemetry_context = excluded.telemetry_context,
        coverage = excluded.coverage,
        applicable_items = excluded.applicable_items,
        covered_items = excluded.covered_items,
        challenge_completed_at = excluded.challenge_completed_at,
        challenge_owner_json = excluded.challenge_owner_json,
        closed_at = excluded.closed_at,
        close_reason = excluded.close_reason,
        interrupted = excluded.interrupted,
        revision = excluded.revision,
        durability = excluded.durability,
        passport_binary = excluded.passport_binary,
        passport_json = excluded.passport_json,
        passport_sha256 = excluded.passport_sha256
    `).run(
      passport.identity.stintId,
      passport.contractVersion,
      passport.identity.sessionRef,
      passport.identity.trackRef,
      passport.identity.trackLabel,
      passport.identity.carRef,
      passport.identity.carLabel,
      passport.identity.driverRef,
      passport.identity.driverLabel,
      passport.identity.teamRef ?? null,
      passport.identity.teamLabel ?? null,
      passport.identity.startedAt,
      passport.lifecycle,
      passport.telemetryContext,
      passport.coverage,
      passport.applicableItems,
      passport.coveredItems,
      passport.challengeCompletedAt ?? null,
      passport.challengeOwner ? stable(passport.challengeOwner) : null,
      passport.closedAt ?? null,
      passport.closeReason ?? null,
      passport.interrupted ? 1 : 0,
      passport.revision,
      passport.durability,
      passportBinary,
      passportJson,
      passportSha256
    )
  }

  private upsertPassportItemsInTransaction(passport: StintPassport): void {
    const upsertItem = this.db.prepare(`
      INSERT INTO passport_item (
        stint_id, item_id, status, owner_json, detail, override_reason,
        reason_code, verified_at, expires_at, evidence_json, evidence_state,
        evidence_captured_at, revision,
        item_hash, data_class, evidence_data_class, detail_data_class,
        owner_data_class, reason_data_class, provenance_data_class
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(stint_id, item_id) DO UPDATE SET
        status = excluded.status,
        owner_json = excluded.owner_json,
        detail = excluded.detail,
        override_reason = excluded.override_reason,
        reason_code = excluded.reason_code,
        verified_at = excluded.verified_at,
        expires_at = excluded.expires_at,
        evidence_json = excluded.evidence_json,
        evidence_state = excluded.evidence_state,
        evidence_captured_at = excluded.evidence_captured_at,
        revision = excluded.revision,
        item_hash = excluded.item_hash,
        data_class = excluded.data_class,
        evidence_data_class = excluded.evidence_data_class,
        detail_data_class = excluded.detail_data_class,
        owner_data_class = excluded.owner_data_class,
        reason_data_class = excluded.reason_data_class,
        provenance_data_class = excluded.provenance_data_class
    `)
    for (const item of passport.items) {
      const dataClass = itemDataClass(item.id)
      upsertItem.run(
        passport.identity.stintId,
        item.id,
        item.status,
        item.owner ? stable(item.owner) : null,
        item.detail,
        item.overrideReason ?? null,
        item.reasonCode ?? null,
        item.verifiedAt ?? null,
        item.expiresAt ?? null,
        item.evidence ? stable(item.evidence) : null,
        item.evidence?.state ?? 'unavailable',
        item.evidence?.capturedAt ?? null,
        item.revision,
        itemHash(item),
        item.owner || item.overrideReason || item.reasonCode ? 'D3' : dataClass,
        dataClass,
        dataClass,
        'D3',
        'D3',
        dataClass
      )
    }
  }

  private appendEventInTransaction(
    passport: StintPassport,
    event: PassportStoreEvent,
    semanticHash = semanticOperationHash(passport, event)
  ): void {
    if (
      event.canonicalEvent.sessionRef !== passport.identity.sessionRef ||
      event.canonicalEvent.subjectRef !== `stint:${passport.identity.stintId}` ||
      event.canonicalEvent.partitionKey !== `stint:${passport.identity.stintId}`
    ) {
      throw persistenceDomainError('Canonical Passport event identity does not match the persisted stint.')
    }
    const privacyRank = { D0: 0, D1: 1, D2: 2, D3: 3, D4: 4, D5: 5 } as const
    if (privacyRank[event.canonicalEvent.privacyClass] > privacyRank[event.dataClass]) {
      throw persistenceDomainError('Canonical Passport event privacy exceeds its persistence data class.')
    }
    const dedupeKey = event.canonicalEvent.dedupeKey
    const existing = this.db.prepare('SELECT event_id FROM passport_event WHERE dedupe_key = ?').get(dedupeKey)
    if (existing) return
    const clock = this.allocateClockInTransaction()
    const previous = this.db.prepare(`
      SELECT record_hash FROM passport_event
      WHERE stint_id = ? ORDER BY sequence DESC LIMIT 1
    `).get(passport.identity.stintId) as Row | undefined
    const previousHash = optionalText(previous?.record_hash)
    const eventId = event.canonicalEvent.eventId || this.idFactory()
    const stateHash = passportStateHash(passport, event.dataClass)
    const canonicalEvent: CanonicalRaceOpsEvent = {
      ...event.canonicalEvent,
      eventId,
      dedupeKey,
      sequence: String(clock.sequence),
      partitionSeq: String(clock.sequence),
      sourceTick: String(event.capturedAt),
      observedMonotonicNs: String(clock.logicalTimeMs * 1_000_000),
      facts: [
        ...event.canonicalEvent.facts,
        {
          name: 'passport.state_hash',
          canonicalUnit: 'sha256',
          value: { kind: 'string', value: stateHash },
          provenance: {
            sourceId: 'passport-persistence-worker',
            transformId: 'passport.state-hash.v3.class-scoped',
            schemaFingerprint: event.canonicalEvent.facts[0]?.provenance?.schemaFingerprint ?? '',
            canonicalUnit: 'sha256',
            validity: 'valid',
            nullReason: 'unspecified',
            sourceTick: String(event.capturedAt),
            observedMonotonicNs: String(clock.logicalTimeMs * 1_000_000),
            ageMs: '0',
            privacyClass: event.dataClass
          }
        }
      ]
    }
    const eventBinary = encodeRaceOpsEvent(canonicalEvent)
    const eventJson = JSON.stringify(raceOpsEventToProtoJson(canonicalEvent))
    const payloadSha256 = hashBytes(eventBinary)
    const base = {
      eventId,
      stintId: passport.identity.stintId,
      eventType: canonicalEvent.eventType,
      itemId: event.itemId,
      dedupeKey,
      semanticHash,
      sequence: clock.sequence,
      logicalTimeMs: clock.logicalTimeMs,
      capturedAt: event.capturedAt,
      payloadSha256,
      payloadState: 'available',
      tombstoneSha256: undefined,
      previousHash,
      dataClass: event.dataClass
    }
    const recordHash = hash(base)
    this.db.prepare(`
      INSERT INTO passport_event (
        event_id, stint_id, event_type, item_id, dedupe_key, semantic_hash, sequence,
        logical_time_ms, captured_at, event_binary, payload_json, payload_sha256,
        payload_state, tombstone_json, previous_hash, record_hash, data_class
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', NULL, ?, ?, ?)
    `).run(
      eventId,
      passport.identity.stintId,
      canonicalEvent.eventType,
      event.itemId ?? null,
      dedupeKey,
      semanticHash,
      clock.sequence,
      clock.logicalTimeMs,
      event.capturedAt,
      eventBinary,
      eventJson,
      payloadSha256,
      previousHash ?? null,
      recordHash,
      event.dataClass
    )
    this.metrics.appendOperations += 1
    this.metrics.rowsHashedOnWrite += 1
    this.integrity = {
      state: this.anchorReady ? 'anchored' : 'unanchored',
      verified: this.anchorReady,
      scope: 'incremental',
      checkedEvents: 1,
      headHash: recordHash,
      lastCheckedAt: this.now(),
      message: this.anchorReady
        ? 'Local hash chain is pending trusted anchor promotion.'
        : 'Local hash chain updated; no external anchor is configured.'
    }
  }

  private eventRecordBase(row: Row, previousHash: string | undefined): Record<string, unknown> {
    const payloadState = text(row.payload_state)
    const tombstone = optionalText(row.tombstone_json)
    return {
      eventId: text(row.event_id),
      stintId: text(row.stint_id),
      eventType: text(row.event_type),
      itemId: optionalText(row.item_id),
      dedupeKey: text(row.dedupe_key),
      semanticHash: optionalText(row.semantic_hash),
      sequence: numberValue(row.sequence),
      logicalTimeMs: numberValue(row.logical_time_ms),
      capturedAt: numberValue(row.captured_at),
      payloadSha256: text(row.payload_sha256),
      payloadState,
      tombstoneSha256: tombstone ? hash(tombstone) : undefined,
      previousHash,
      dataClass: text(row.data_class)
    }
  }

  private rehashStintInTransaction(stintId: string): void {
    const rows = this.db.prepare(`
      SELECT * FROM passport_event WHERE stint_id = ? ORDER BY sequence ASC
    `).all(stintId) as Row[]
    const update = this.db.prepare(`
      UPDATE passport_event SET previous_hash = ?, record_hash = ? WHERE event_id = ?
    `)
    let previousHash: string | undefined
    for (const row of rows) {
      const recordHash = hash(this.eventRecordBase(row, previousHash))
      update.run(previousHash ?? null, recordHash, text(row.event_id))
      previousHash = recordHash
      this.metrics.rowsHashedOnWrite += 1
    }
  }

  private retentionEvent(
    passport: StintPassport,
    dataClass: PassportDataClass
  ): PassportStoreEvent {
    const capturedAt = this.now()
    const dedupeKey = `retention:${dataClass}:${passport.identity.stintId}:${this.idFactory()}`
    const interval = emptyObservedInterval()
    interval.sourceTickStart = String(capturedAt)
    interval.sourceTickEnd = String(capturedAt)
    return {
      dataClass,
      capturedAt,
      canonicalEvent: {
        eventId: this.idFactory(),
        eventClass: 'fact',
        eventType: 'ultimate.sim.raceops.passport.retention-tombstone.v2',
        sessionRef: passport.identity.sessionRef,
        actorRef: 'system:passport-persistence-worker',
        subjectRef: `stint:${passport.identity.stintId}`,
        observedInterval: interval,
        facts: [{
          name: 'passport.retention_data_class',
          canonicalUnit: 'text',
          value: { kind: 'string', value: dataClass },
          provenance: {
            sourceId: 'passport-persistence-worker',
            transformId: 'passport.retention-tombstone.v2',
            schemaFingerprint: PHASE02_DESCRIPTOR_SHA256,
            canonicalUnit: 'text',
            validity: 'valid',
            nullReason: 'redacted',
            sourceTick: String(capturedAt),
            observedMonotonicNs: '0',
            ageMs: '0',
            privacyClass: 'D1'
          }
        }],
        confidence: emptyConfidence(),
        severity: 'notice',
        priority: 'normal',
        evidenceRefs: [],
        policyRef: 'local-only.passport.retention.v2',
        capabilityRef: 'passport.persistence.retention',
        consentEpoch: String(this.getPrivacy().updatedAt),
        approvalRef: '',
        correlationId: passport.identity.stintId,
        dedupeKey,
        privacyClass: 'D1',
        integrityFlags: ['redacted'],
        supersedesEventId: '',
        sequence: '0',
        partitionKey: `stint:${passport.identity.stintId}`,
        partitionSeq: '0',
        telemetryContext: passport.telemetryContext,
        sourceTick: String(capturedAt),
        observedMonotonicNs: '0',
        ttlMs: '0'
      }
    }
  }

  private allocateClockInTransaction(): { sequence: number; logicalTimeMs: number } {
    const row = this.db.prepare(`
      SELECT next_sequence, last_logical_time_ms
      FROM passport_clock WHERE singleton = 1
    `).get() as Row
    const sequence = numberValue(row.next_sequence) + 1
    const logicalTimeMs = Math.max(Math.round(this.now()), numberValue(row.last_logical_time_ms) + 1)
    this.db.prepare(`
      UPDATE passport_clock
      SET next_sequence = ?, last_logical_time_ms = ?
      WHERE singleton = 1
    `).run(sequence, logicalTimeMs)
    return { sequence, logicalTimeMs }
  }

  private passportFromRow(row: Row): StintPassport {
    const stintId = text(row.stint_id)
    const itemRows = this.db.prepare(`
      SELECT * FROM passport_item
      WHERE stint_id = ?
      ORDER BY item_id ASC
    `).all(stintId) as Row[]
    const items = itemRows.map((item): PassportItem => ({
      id: text(item.item_id) as PassportItemId,
      status: text(item.status) as PassportItem['status'],
      owner: parse(item.owner_json, undefined),
      detail: text(item.detail),
      overrideReason: optionalText(item.override_reason),
      reasonCode: optionalText(item.reason_code),
      verifiedAt: item.verified_at == null ? undefined : numberValue(item.verified_at),
      expiresAt: item.expires_at == null ? undefined : numberValue(item.expires_at),
      evidence: parse(item.evidence_json, undefined),
      revision: numberValue(item.revision)
    }))
    const coverage = calculatePassportCoverage(items)
    return {
      contractVersion: STINT_PASSPORT_CONTRACT_VERSION,
      identity: {
        stintId,
        sessionRef: text(row.session_ref),
        trackRef: text(row.track_ref),
        trackLabel: text(row.track_label),
        carRef: text(row.car_ref),
        carLabel: text(row.car_label),
        driverRef: text(row.driver_ref),
        driverLabel: text(row.driver_label),
        teamRef: optionalText(row.team_ref),
        teamLabel: optionalText(row.team_label),
        startedAt: numberValue(row.started_at)
      },
      lifecycle: text(row.lifecycle) as StintPassport['lifecycle'],
      telemetryContext: text(row.telemetry_context) as StintPassport['telemetryContext'],
      items,
      ...coverage,
      challengeCompletedAt: row.challenge_completed_at == null ? undefined : numberValue(row.challenge_completed_at),
      challengeOwner: parse(row.challenge_owner_json, undefined),
      closedAt: row.closed_at == null ? undefined : numberValue(row.closed_at),
      closeReason: optionalText(row.close_reason) as StintPassport['closeReason'],
      interrupted: bool(row.interrupted),
      persisted: true,
      revision: numberValue(row.revision),
      durability: text(row.durability) as StintPassport['durability']
    }
  }

  private verifyBounded(): PassportIntegrityState {
    const rows = this.db.prepare(`
      SELECT stint_id FROM stint_passport
      ORDER BY
        CASE lifecycle WHEN 'awaiting-checklist' THEN 0 WHEN 'ready' THEN 1 ELSE 2 END,
        started_at DESC
      LIMIT 10
    `).all() as Row[]
    return this.verifyStints(rows.map((row) => text(row.stint_id)), BOUNDED_VERIFY_LIMIT, 'bounded')
  }

  private verifyStints(
    stintIds: readonly string[],
    limit: number,
    scope: PassportIntegrityState['scope']
  ): PassportIntegrityState {
    if (!this.verifyDeletionTombstones()) {
      this.setStickyCorruption('Deletion tombstone integrity mismatch.')
      return this.stickyCorruptionState(scope, 0, 'Deletion tombstone integrity mismatch.')
    }
    let checked = 0
    let headHash: string | undefined
    for (const stintId of stintIds) {
      const count = numberValue((this.db.prepare(`
        SELECT COUNT(*) AS count FROM passport_event WHERE stint_id = ?
      `).get(stintId) as Row).count)
      if (checked + count > limit) {
        return {
          state: 'unavailable',
          verified: false,
          scope,
          checkedEvents: checked,
          totalEvents: checked + count,
          headHash,
          lastCheckedAt: this.now(),
          message: 'Bounded verification budget exceeded; run the explicit full audit.'
        }
      }
      const rows = this.db.prepare(`
        SELECT * FROM passport_event
        WHERE stint_id = ?
        ORDER BY sequence ASC
      `).all(stintId) as Row[]
      let previousHash: string | undefined
      let lastStateHash: string | undefined
      let lastStateDataClass: PassportDataClass = 'D3'
      let lastStateTransform = 'passport.state-hash.v2'
      for (const row of rows) {
        const payloadState = text(row.payload_state)
        if (payloadState === 'available') {
          if (row.tombstone_json != null) {
            this.setStickyCorruption(`Unexpected event tombstone in stint ${stintId}.`)
            return this.stickyCorruptionState(scope, checked, `Unexpected event tombstone in stint ${stintId}.`)
          }
          const bytes = row.event_binary as Uint8Array
          if (!(bytes instanceof Uint8Array) || hashBytes(bytes) !== text(row.payload_sha256)) {
            this.setStickyCorruption(`Canonical event payload hash mismatch in stint ${stintId}.`)
            return this.stickyCorruptionState(scope, checked, `Canonical event payload hash mismatch in stint ${stintId}.`)
          }
          try {
            const canonical = decodeRaceOpsEvent(bytes)
            const jsonCanonical = raceOpsEventFromProtoJson(parse(row.payload_json, {}))
            if (
              canonical.eventId !== text(row.event_id) ||
              canonical.eventType !== text(row.event_type) ||
              canonical.dedupeKey !== text(row.dedupe_key) ||
              canonical.sequence !== String(numberValue(row.sequence)) ||
              hashBytes(encodeRaceOpsEvent(jsonCanonical)) !== text(row.payload_sha256)
            ) {
              throw new Error('mirror mismatch')
            }
            const stateFact = canonical.facts.find((fact) => fact.name === 'passport.state_hash')
            if (typeof stateFact?.value?.value === 'string') {
              lastStateHash = stateFact.value.value
              lastStateDataClass = text(row.data_class) as PassportDataClass
              lastStateTransform = stateFact.provenance?.transformId ?? lastStateTransform
            }
          } catch {
            this.setStickyCorruption(`Canonical event mirror mismatch in stint ${stintId}.`)
            return this.stickyCorruptionState(scope, checked, `Canonical event mirror mismatch in stint ${stintId}.`)
          }
        } else if (payloadState === 'retention-redacted') {
          const tombstone = parse<Record<string, unknown>>(row.tombstone_json, {})
          if (
            row.event_binary != null ||
            row.payload_json != null ||
            tombstone.reason !== 'retention-or-explicit-delete' ||
            typeof tombstone.redactedAt !== 'number' ||
            typeof tombstone.dataClass !== 'string'
          ) {
            this.setStickyCorruption(`Invalid retention tombstone in stint ${stintId}.`)
            return this.stickyCorruptionState(scope, checked, `Invalid retention tombstone in stint ${stintId}.`)
          }
        } else {
          this.setStickyCorruption(`Unknown event payload state in stint ${stintId}.`)
          return this.stickyCorruptionState(scope, checked, `Unknown event payload state in stint ${stintId}.`)
        }
        const expected = hash(this.eventRecordBase(row, previousHash))
        if (optionalText(row.previous_hash) !== previousHash || text(row.record_hash) !== expected) {
          this.setStickyCorruption(`Integrity mismatch in stint ${stintId}.`)
          return this.stickyCorruptionState(scope, checked, `Integrity mismatch in stint ${stintId}.`)
        }
        previousHash = text(row.record_hash)
        headHash = previousHash
        checked += 1
      }
      const passport = this.getPassport(stintId)
      const expectedStateHash = passport && lastStateTransform === 'passport.state-hash.v3.class-scoped'
        ? passportStateHash(passport, lastStateDataClass)
        : passport ? passportStateHash(passport) : undefined
      if (rows.length > 0 && (!passport || !this.verifyPassportPayload(stintId, passport) || lastStateHash !== expectedStateHash)) {
        this.setStickyCorruption(`Passport state hash mismatch in stint ${stintId}.`)
        return this.stickyCorruptionState(scope, checked, `Passport state hash mismatch in stint ${stintId}.`)
      }
      this.heads.set(stintId, previousHash)
    }
    if (scope !== 'full') this.metrics.boundedVerificationRows += checked
    if (this.anchorReady && !this.verifyTrustedAnchor()) {
      this.setStickyCorruption('Trusted integrity anchor does not match the verified event chain.')
      return this.stickyCorruptionState(scope, checked, 'Trusted integrity anchor does not match the verified event chain.')
    }
    return {
      state: this.anchorReady ? 'anchored' : 'unanchored',
      verified: this.anchorReady,
      scope,
      checkedEvents: checked,
      totalEvents: checked,
      headHash,
      lastCheckedAt: this.now(),
      message: this.anchorReady
        ? 'Local hashes verified against a trusted signature anchor.'
        : 'Local hashes verified within scope; no external anchor is configured.'
    }
  }

  private redactEvidenceByClass(
    dataClass: PassportDataClass,
    cutoff: number,
    closedOnly = false,
    withinTransaction = false
  ): number {
    const explicit = cutoff === Number.MAX_SAFE_INTEGER
    const rawRows = this.db.prepare(`
      SELECT item.stint_id, item.item_id, item.status, item.owner_json, item.detail,
        item.override_reason, item.reason_code, item.verified_at, item.expires_at,
        item.evidence_json, item.evidence_state, item.evidence_captured_at,
        item.revision, item.evidence_data_class, item.detail_data_class,
        item.owner_data_class, item.reason_data_class, item.provenance_data_class
      FROM passport_item item
      JOIN stint_passport passport ON passport.stint_id = item.stint_id
      WHERE (
        (item.evidence_data_class = ? AND item.evidence_json IS NOT NULL) OR
        (item.detail_data_class = ? AND item.detail NOT IN (
          'Evidence removed by data-class deletion.',
          '[retention-redacted]'
        )) OR
        (item.owner_data_class = ? AND item.owner_json IS NOT NULL) OR
        (item.reason_data_class = ? AND (
          item.override_reason IS NOT NULL OR item.reason_code IS NOT NULL
        )) OR
        (item.provenance_data_class = ? AND (
          item.evidence_captured_at IS NOT NULL OR
          item.verified_at IS NOT NULL OR
          item.expires_at IS NOT NULL
        )) OR
        (? = 'D3' AND item.evidence_json IS NOT NULL)
      )
      AND (
        ? = 1 OR
        (? = 1 AND passport.closed_at IS NOT NULL AND passport.closed_at < ?) OR
        (? = 0 AND item.evidence_captured_at IS NOT NULL AND item.evidence_captured_at < ?)
      )
    `).all(
      dataClass,
      dataClass,
      dataClass,
      dataClass,
      dataClass,
      dataClass,
      explicit ? 1 : 0,
      closedOnly ? 1 : 0,
      cutoff,
      closedOnly ? 1 : 0,
      cutoff
    ) as Row[]
    const rows = rawRows.filter((row) => {
      const classScopedValuePresent =
        (text(row.evidence_data_class) === dataClass && row.evidence_json != null) ||
        (text(row.detail_data_class) === dataClass && ![
          'Evidence removed by data-class deletion.',
          '[retention-redacted]'
        ].includes(text(row.detail))) ||
        (text(row.owner_data_class) === dataClass && row.owner_json != null) ||
        (text(row.reason_data_class) === dataClass && (
          row.override_reason != null || row.reason_code != null
        )) ||
        (text(row.provenance_data_class) === dataClass && (
          row.evidence_captured_at != null ||
          row.verified_at != null ||
          row.expires_at != null
        ))
      if (classScopedValuePresent) return true
      if (dataClass !== 'D3' || itemDataClass(text(row.item_id) as PassportItemId) === 'D3') {
        return false
      }
      const evidence = parse<PassportItem['evidence']>(row.evidence_json, undefined)
      if (evidence?.source !== 'human-attestation') return false
      return evidence.contentHash !== hash({
        itemId: text(row.item_id),
        status: text(row.status),
        now: evidence.capturedAt
      })
    })
    const eventRows = this.db.prepare(`
      SELECT event.event_id, event.stint_id, event.sequence
      FROM passport_event event
      JOIN stint_passport passport ON passport.stint_id = event.stint_id
      WHERE event.data_class = ?
        AND event.payload_state = 'available'
        AND (? = 1 OR event.captured_at < ?)
        AND (
          ? = 0 OR
          (passport.closed_at IS NOT NULL AND passport.closed_at < ?)
        )
    `).all(
      dataClass,
      explicit ? 1 : 0,
      cutoff,
      closedOnly ? 1 : 0,
      cutoff
    ) as Row[]
    const legacyEventRows = dataClass === 'D3'
      ? (this.db.prepare(`
          SELECT event.event_id, event.stint_id, event.sequence, event.event_binary
          FROM passport_event event
          JOIN stint_passport passport ON passport.stint_id = event.stint_id
          WHERE event.data_class IN ('D1', 'D2')
            AND event.payload_state = 'available'
            AND (? = 1 OR event.captured_at < ?)
            AND (
              ? = 0 OR
              (passport.closed_at IS NOT NULL AND passport.closed_at < ?)
            )
        `).all(
          explicit ? 1 : 0,
          cutoff,
          closedOnly ? 1 : 0,
          cutoff
        ) as Row[]).filter((row) => {
          try {
            const canonical = decodeRaceOpsEvent(row.event_binary as Uint8Array)
            return canonical.facts.some((fact) =>
              ['passport.role', 'passport.reasonCode', 'passport.freeText'].includes(fact.name) ||
              (
                fact.name === 'passport.state_hash' &&
                fact.provenance?.transformId !== 'passport.state-hash.v3.class-scoped'
              )
            )
          } catch {
            return false
          }
        })
      : []
    if (rows.length === 0 && eventRows.length === 0 && legacyEventRows.length === 0) return 0
    const redact = () => {
      const update = this.db.prepare(`
        UPDATE passport_item
        SET status = ?,
            owner_json = ?,
            detail = ?,
            override_reason = ?,
            reason_code = ?,
            evidence_json = ?,
            evidence_state = ?,
            evidence_captured_at = ?,
            verified_at = ?,
            expires_at = ?,
            revision = ?,
            item_hash = ?
        WHERE stint_id = ? AND item_id = ?
      `)
      const affectedStints = new Set<string>()
      for (const row of rows) {
        const redactEvidence = text(row.evidence_data_class) === dataClass
        const redactDetail = text(row.detail_data_class) === dataClass
        const redactOwner = text(row.owner_data_class) === dataClass
        const redactReason = text(row.reason_data_class) === dataClass
        const redactProvenance = text(row.provenance_data_class) === dataClass
        const evidenceRemoved = redactEvidence || redactProvenance
        const itemId = text(row.item_id) as PassportItemId
        const status = text(row.status) as PassportItem['status']
        const originalEvidence = parse<PassportItem['evidence']>(row.evidence_json, undefined)
        const reasonValues = [optionalText(row.override_reason), optionalText(row.reason_code)]
          .filter((value): value is string => value !== undefined)
        const sanitizeLegacyAttestation = redactReason &&
          itemDataClass(itemId) !== 'D3' &&
          originalEvidence?.source === 'human-attestation'
        const isolatedContentHash = originalEvidence
          ? hash({ itemId, status, now: originalEvidence.capturedAt })
          : undefined
        const legacyContentHash = sanitizeLegacyAttestation &&
          originalEvidence?.contentHash !== isolatedContentHash
        const evidence = evidenceRemoved
          ? undefined
          : sanitizeLegacyAttestation && originalEvidence
            ? {
                ...originalEvidence,
                summary: legacyContentHash || reasonValues.includes(originalEvidence.summary)
                  ? lowerClassAttestationSummary(status)
                  : originalEvidence.summary,
                contentHash: isolatedContentHash!
              }
            : originalEvidence
        const item: PassportItem = {
          id: itemId,
          status: evidenceRemoved ? 'unknown' : status,
          owner: redactOwner ? undefined : parse(row.owner_json, undefined),
          detail: redactDetail
            ? 'Evidence removed by data-class deletion.'
            : sanitizeLegacyAttestation && (
                legacyContentHash || reasonValues.includes(text(row.detail))
              )
              ? lowerClassAttestationDetail(status)
              : text(row.detail),
          overrideReason: redactReason ? undefined : optionalText(row.override_reason),
          reasonCode: redactReason ? undefined : optionalText(row.reason_code),
          verifiedAt: redactProvenance
            ? undefined
            : row.verified_at == null ? undefined : numberValue(row.verified_at),
          expiresAt: redactProvenance
            ? undefined
            : row.expires_at == null ? undefined : numberValue(row.expires_at),
          evidence,
          revision: numberValue(row.revision) + 1
        }

        update.run(
          item.status,
          item.owner ? stable(item.owner) : null,
          item.detail,
          item.overrideReason ?? null,
          item.reasonCode ?? null,
          item.evidence ? stable(item.evidence) : null,
          evidenceRemoved ? 'retention-redacted' : text(row.evidence_state),
          evidenceRemoved ? null : row.evidence_captured_at as SQLInputValue,
          item.verifiedAt ?? null,
          item.expiresAt ?? null,
          item.revision,
          itemHash(item),
          text(row.stint_id),
          item.id
        )
        affectedStints.add(text(row.stint_id))
      }
      const redactEvent = this.db.prepare(`
        UPDATE passport_event
        SET event_id = ?,
            dedupe_key = ?,
            semantic_hash = NULL,
            event_binary = NULL,
            payload_json = NULL,
            payload_sha256 = ?,
            payload_state = 'retention-redacted',
            tombstone_json = ?
        WHERE event_id = ?
      `)
      const redactEventRow = (row: Row, redactedClass: PassportDataClass): void => {
        const sequence = numberValue(row.sequence)
        const tombstone = {
          dataClass: redactedClass,
          redactedAt: this.now(),
          reason: 'retention-or-explicit-delete'
        }
        redactEvent.run(
          `retention-redacted-${sequence}`,
          `retention-redacted:${sequence}`,
          hash(tombstone),
          stable(tombstone),
          text(row.event_id)
        )
        affectedStints.add(text(row.stint_id))
      }
      for (const row of eventRows) redactEventRow(row, dataClass)
      for (const row of legacyEventRows) redactEventRow(row, 'D3')
      for (const stintId of affectedStints) {
        const passport = this.getPassport(stintId)
        if (!passport) continue
        this.upsertPassportHeaderInTransaction(coherentAfterPrivacyRedaction({
          ...passport,
          revision: passport.revision + 1
        }))
        this.rehashStintInTransaction(stintId)
        const redacted = this.getPassport(stintId)
        if (redacted) {
          this.appendEventInTransaction(redacted, this.retentionEvent(redacted, dataClass))
        }
      }
      return rows.length + eventRows.length + legacyEventRows.length
    }
    return withinTransaction ? redact() : this.transaction(redact)
  }

  private redactClosedIdentity(cutoff: number, withinTransaction = false): number {
    const rows = this.db.prepare(`
      SELECT stint_id FROM stint_passport
      WHERE closed_at IS NOT NULL
        AND closed_at < ?
        AND (
          driver_label <> '[retention-redacted]' OR
          driver_ref NOT LIKE 'redacted:%' OR
          team_ref IS NOT NULL OR
          team_label IS NOT NULL OR
          challenge_owner_json IS NOT NULL
        )
    `).all(cutoff) as Row[]
    if (rows.length === 0) return 0
    const redact = () => {
      for (const row of rows) {
        const passport = this.getPassport(text(row.stint_id))
        if (!passport) continue
        const redacted: StintPassport = {
          ...passport,
          identity: {
            ...passport.identity,
            driverRef: `redacted:${this.pseudonym('retained-driver', passport.identity.driverRef)}`,
            driverLabel: '[retention-redacted]',
            teamRef: undefined,
            teamLabel: undefined
          },
          challengeOwner: undefined,
          revision: passport.revision + 1
        }
        this.upsertPassportHeaderInTransaction(redacted)
        this.db.prepare(`
          UPDATE stint_passport
          SET driver_ref = ?, driver_label = ?, team_ref = NULL, team_label = NULL
          WHERE stint_id = ?
        `).run(
          redacted.identity.driverRef,
          redacted.identity.driverLabel,
          redacted.identity.stintId
        )
        this.rehashStintInTransaction(redacted.identity.stintId)
        this.appendEventInTransaction(redacted, this.retentionEvent(redacted, 'D3'))
      }
      return rows.length
    }
    return withinTransaction ? redact() : this.transaction(redact)
  }

  private deleteRuntimeLogs(cutoff: number): number {
    const result = this.db.prepare(`
      DELETE FROM passport_runtime_log
      WHERE data_class = 'D1' AND created_at < ?
    `).run(cutoff)
    return Number(result.changes)
  }

  private appendDeletionTombstone(
    dataClass: PassportDataClass,
    subjectIds: readonly string[]
  ): void {
    const previous = this.db.prepare(`
      SELECT record_hash FROM passport_deletion_tombstone
      ORDER BY deleted_at DESC, tombstone_id DESC LIMIT 1
    `).get() as Row | undefined
    const tombstoneId = this.idFactory()
    const deletedAt = this.now()
    const subjectHashes = [...subjectIds].sort().map((id) => hash({ dataClass, id }))
    const previousHash = optionalText(previous?.record_hash)
    const base = { tombstoneId, dataClass, deletedAt, subjectHashes, previousHash }
    this.db.prepare(`
      INSERT INTO passport_deletion_tombstone (
        tombstone_id, data_class, deleted_at, subject_hashes_json,
        previous_hash, record_hash
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      tombstoneId,
      dataClass,
      deletedAt,
      stable(subjectHashes),
      previousHash ?? null,
      hash(base)
    )
  }

  private verifyDeletionTombstones(): boolean {
    const rows = this.db.prepare(`
      SELECT * FROM passport_deletion_tombstone
      ORDER BY deleted_at ASC, tombstone_id ASC
    `).all() as Row[]
    let previousHash: string | undefined
    for (const row of rows) {
      const base = {
        tombstoneId: text(row.tombstone_id),
        dataClass: text(row.data_class),
        deletedAt: numberValue(row.deleted_at),
        subjectHashes: parse<string[]>(row.subject_hashes_json, []),
        previousHash
      }
      const recordHash = text(row.record_hash)
      if (optionalText(row.previous_hash) !== previousHash || hash(base) !== recordHash) return false
      previousHash = recordHash
    }
    return true
  }

  private verifyPassportPayload(stintId: string, passport: StintPassport): boolean {
    const row = this.db.prepare(`
      SELECT passport_binary, passport_sha256 FROM stint_passport WHERE stint_id = ?
    `).get(stintId) as Row | undefined
    const bytes = row?.passport_binary as Uint8Array
    if (!(bytes instanceof Uint8Array) || hashBytes(bytes) !== text(row?.passport_sha256)) return false
    try {
      return passportStateHash(decodeStintPassport(bytes)) === passportStateHash(passport)
    } catch {
      return false
    }
  }

  private pseudonym(kind: string, value: string): string {
    return createHmac('sha256', this.pseudonymSalt)
      .update(`${kind}:${value}`, 'utf8')
      .digest('hex')
      .slice(0, 8)
      .toUpperCase()
  }
}

function sanitizeConfig(input: PassportConfig, now: number): PassportConfig {
  const unique = (values: unknown, max: number): string[] =>
    Array.isArray(values)
      ? [...new Set(values.filter((value): value is string =>
          typeof value === 'string' && value.trim().length > 0
        ).map((value) => value.trim().slice(0, 120)))].slice(0, max)
      : []
  return {
    expectedRaceProfileId: text(input?.expectedRaceProfileId).trim().slice(0, 120),
    expectedButtonboxProfile: text(input?.expectedButtonboxProfile).trim().slice(0, 120),
    requiredDeviceIds: unique(input?.requiredDeviceIds, 16),
    requiredControlIds: unique(input?.requiredControlIds, 32),
    requiredAudioOutputDeviceId: text(input?.requiredAudioOutputDeviceId).trim().slice(0, 200),
    requiredAudioCallouts: unique(input?.requiredAudioCallouts, 32),
    communicationChannel: text(input?.communicationChannel).trim().slice(0, 120),
    minimumFuelLiters: Math.max(0, Math.min(500, numberValue(input?.minimumFuelLiters))),
    targetStintLaps: Math.max(0, Math.min(1000, Math.round(numberValue(input?.targetStintLaps)))),
    weatherAssumption: input?.weatherAssumption === 'dry' || input?.weatherAssumption === 'wet'
      ? input.weatherAssumption
      : 'any',
    updatedAt: now
  }
}

function sanitizePrivacy(
  input: PassportPrivacySettings,
  now: number
): PassportPrivacySettings {
  const days = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.max(1, Math.min(3650, Math.round(value)))
      : fallback
  return {
    identityPersistenceOptIn: input?.identityPersistenceOptIn === true,
    retentionDays: {
      D1: days(input?.retentionDays?.D1, DEFAULT_PASSPORT_PRIVACY.retentionDays.D1),
      D2: days(input?.retentionDays?.D2, DEFAULT_PASSPORT_PRIVACY.retentionDays.D2),
      D3: days(input?.retentionDays?.D3, DEFAULT_PASSPORT_PRIVACY.retentionDays.D3)
    },
    updatedAt: now
  }
}

function sanitizeRosterMember(member: PassportRosterMember): PassportRosterMember {
  const memberId = text(member?.memberId).trim().slice(0, 120)
  const displayName = text(member?.displayName).replace(/\s+/g, ' ').trim().slice(0, 120)
  if (!memberId || !displayName) {
    throw persistenceDomainError('Roster members require an ID and display name.')
  }
  const roles = [...new Set(member.roles)].filter((role) =>
    role === 'driver' ||
    role === 'engineer' ||
    role === 'crew-chief' ||
    role === 'spotter' ||
    role === 'team-manager'
  )
  if (roles.length === 0) {
    throw persistenceDomainError(`Roster member ${displayName} requires at least one valid role.`)
  }
  return { memberId, displayName, roles, active: member.active === true }
}

function replaceLabels(value: unknown, labels: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') {
    let next = value
    for (const [label, replacement] of labels) next = next.split(label).join(replacement)
    return next
  }
  if (Array.isArray(value)) return value.map((item) => replaceLabels(item, labels))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, replaceLabels(item, labels)])
  )
}

function normalizedSecret(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-US')
}

function scrubExportValue(
  value: unknown,
  sensitive: readonly string[],
  key = ''
): unknown {
  if (/capability|approval|nonce|secret|repair.?token|mutation.?capability/i.test(key)) {
    return '[redacted]'
  }
  if (typeof value === 'string') {
    const normalized = normalizedSecret(value)
    if (sensitive.some((token) => token.length >= 3 && normalized.includes(token))) {
      return '[redacted]'
    }
    return value
  }
  if (Array.isArray(value)) return value.map((item) => scrubExportValue(item, sensitive, key))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, item]) => [
    childKey,
    scrubExportValue(item, sensitive, childKey)
  ]))
}

function redactPassport(
  passport: StintPassport,
  profile: PassportExportProfile,
  labels: ReadonlyMap<string, string>,
  pseudonym: (kind: string, value: string) => string
): StintPassport {
  const raceOnly = profile === 'race-only'
  const redactOwner = (owner: PassportItem['owner']): PassportItem['owner'] =>
    owner
      ? {
          memberId: raceOnly ? '[member redacted]' : `member:${pseudonym('member', owner.memberId)}`,
          role: owner.role
        }
      : undefined
  return {
    ...passport,
    identity: {
      ...passport.identity,
      driverRef: raceOnly ? '[driver ref redacted]' : `driver:${pseudonym('driver', passport.identity.driverRef)}`,
      driverLabel: raceOnly ? '[driver redacted]' : `Driver ${pseudonym('driver', passport.identity.driverRef)}`,
      teamRef: passport.identity.teamRef
        ? raceOnly ? undefined : `team:${pseudonym('team', passport.identity.teamRef)}`
        : undefined,
      teamLabel: passport.identity.teamRef
        ? raceOnly ? undefined : `Team ${pseudonym('team', passport.identity.teamRef)}`
        : undefined
    },
    items: passport.items.map((item) => ({
      ...item,
      owner: redactOwner(item.owner),
      detail: replaceLabels(item.detail, labels) as string,
      overrideReason: item.overrideReason
        ? replaceLabels(item.overrideReason, labels) as string
        : undefined,
      evidence: raceOnly && item.evidence
        ? { ...item.evidence, summary: '[evidence summary redacted]' }
        : item.evidence
          ? {
              ...item.evidence,
              summary: replaceLabels(item.evidence.summary, labels) as string
            }
          : undefined
    })),
    challengeOwner: redactOwner(passport.challengeOwner)
  }
}
