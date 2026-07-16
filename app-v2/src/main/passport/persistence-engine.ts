import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
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

const SCHEMA_VERSION = 2
const BOUNDED_VERIFY_LIMIT = 500

type Row = Record<string, unknown>

export interface PassportStoreOptions {
  path: string
  now?: () => number
  idFactory?: () => string
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
  PRIMARY KEY(stint_id, item_id)
);

CREATE TABLE IF NOT EXISTS passport_event (
  event_id TEXT PRIMARY KEY,
  stint_id TEXT NOT NULL REFERENCES stint_passport(stint_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  item_id TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
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

function hashBytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
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

function passportStateHash(passport: StintPassport): string {
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

export class PassportPersistenceEngine {
  private readonly db: DatabaseSync
  private readonly now: () => number
  private readonly idFactory: () => string
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
  readonly databasePath: string

  constructor(options: PassportStoreOptions) {
    this.databasePath = options.path
    this.now = options.now ?? Date.now
    this.idFactory = options.idFactory ?? randomUUID
    if (options.path !== ':memory:') mkdirSync(dirname(options.path), { recursive: true })
    this.db = new DatabaseSync(options.path)
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA busy_timeout = 2500')
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = FULL')
    this.migrate()
    this.pseudonymSalt = this.readOrCreateMeta('pseudonym_salt', () => randomBytes(32).toString('hex'))
    this.stickyCorrupt = this.readOrCreateMeta('integrity_state', () => 'clean') === 'corrupt'
    this.repairToken = this.readOrCreateMeta('repair_token', () => randomBytes(24).toString('hex'))
    this.hydrateHeads()
    this.integrity = this.stickyCorrupt
      ? this.stickyCorruptionState('bounded', 0, 'Persistence is quarantined after an integrity failure.')
      : this.verifyBounded()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  schemaVersion(): number {
    return numberValue((this.db.prepare('PRAGMA user_version').get() as Row).user_version)
  }

  getConfig(): PassportConfig {
    const row = this.settingsRow()
    return parse(row?.config_json, { ...DEFAULT_PASSPORT_CONFIG })
  }

  setConfig(config: PassportConfig): PassportConfig {
    const next = sanitizeConfig(config, this.now())
    const settings = this.settingsRow()
    this.writeSettings(next, parse(settings?.privacy_json, DEFAULT_PASSPORT_PRIVACY), bool(settings?.kill_switch))
    return next
  }

  getPrivacy(): PassportPrivacySettings {
    return parse(this.settingsRow()?.privacy_json, { ...DEFAULT_PASSPORT_PRIVACY })
  }

  setPrivacy(privacy: PassportPrivacySettings): PassportPrivacySettings {
    const next = sanitizePrivacy(privacy, this.now())
    const current = this.settingsRow()
    begin(this.db)
    try {
      this.writeSettingsInTransaction(
        parse(current?.config_json, DEFAULT_PASSPORT_CONFIG),
        next,
        bool(current?.kill_switch)
      )
      if (!next.identityPersistenceOptIn) {
        const ids = (this.db.prepare('SELECT stint_id FROM stint_passport').all() as Row[])
          .map((row) => text(row.stint_id))
        if (ids.length > 0) this.appendDeletionTombstone('D3', ids)
        this.db.exec('DELETE FROM passport_roster')
        this.db.exec('DELETE FROM stint_passport')
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
      }
      this.db.exec('COMMIT')
      return next
    } catch (error) {
      rollback(this.db)
      throw error
    }
  }

  getKillSwitch(): boolean {
    return bool(this.settingsRow()?.kill_switch)
  }

  setKillSwitch(enabled: boolean): boolean {
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

  saveRoster(roster: readonly PassportRosterMember[]): PassportRosterMember[] {
    this.assertWritable()
    if (!this.getPrivacy().identityPersistenceOptIn) {
      throw new Error('Identity persistence opt-in is required before storing roster data.')
    }
    const normalized = roster.map(sanitizeRosterMember)
    begin(this.db)
    try {
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
      this.db.exec('COMMIT')
      return normalized
    } catch (error) {
      rollback(this.db)
      throw error
    }
  }

  persistPassport(passport: StintPassport, event: PassportStoreEvent): StintPassport {
    this.assertWritable()
    if (!this.getPrivacy().identityPersistenceOptIn) {
      throw new Error('Identity persistence opt-in is required before storing a stint passport.')
    }
    const persisted: StintPassport = { ...passport, persisted: true, durability: 'durable' }
    const dedupeKey = event.canonicalEvent.dedupeKey
    const existing = this.db.prepare(`
      SELECT event_id FROM passport_event WHERE dedupe_key = ?
    `).get(dedupeKey) as Row | undefined
    if (existing) {
      const current = this.db.prepare(`
        SELECT passport_sha256 FROM stint_passport WHERE stint_id = ?
      `).get(persisted.identity.stintId) as Row | undefined
      if (text(current?.passport_sha256) !== hashBytes(encodeStintPassport(persisted))) {
        throw new Error(`Passport dedupe conflict for ${dedupeKey}.`)
      }
      return persisted
    }
    begin(this.db)
    try {
      this.upsertPassportInTransaction(persisted)
      this.appendEventInTransaction(persisted, event)
      this.db.exec('COMMIT')
      return persisted
    } catch (error) {
      rollback(this.db)
      throw error
    }
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
    return Boolean(token) && token === this.repairToken
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
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]
        if (text(row.payload_state) === 'available') {
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
            lastStateHash = typeof stateFact?.value?.value === 'string'
              ? stateFact.value.value
              : lastStateHash
          } catch {
            this.setStickyCorruption(`Canonical event mirror mismatch in stint ${stintId}.`)
            return { ...this.integrity }
          }
        }
        const base = {
          eventId: text(row.event_id),
          stintId: text(row.stint_id),
          eventType: text(row.event_type),
          itemId: optionalText(row.item_id),
          dedupeKey: text(row.dedupe_key),
          sequence: numberValue(row.sequence),
          logicalTimeMs: numberValue(row.logical_time_ms),
          capturedAt: numberValue(row.captured_at),
          payloadSha256: text(row.payload_sha256),
          previousHash,
          dataClass: text(row.data_class)
        }
        const expected = hash(base)
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
      if (!passport || !this.verifyPassportPayload(stintId, passport) || lastStateHash !== passportStateHash(passport)) {
        this.setStickyCorruption(`Passport state hash mismatch in stint ${stintId}.`)
        this.integrity = this.stickyCorruptionState('full', checkedEvents, `Passport state hash mismatch in stint ${stintId}.`)
        return { ...this.integrity }
      }
      this.heads.set(stintId, previousHash)
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    this.integrity = {
      state: 'unanchored',
      verified: false,
      scope: 'full',
      checkedEvents,
      totalEvents: checkedEvents,
      headHash,
      lastCheckedAt: this.now(),
      message: 'Full local hash audit completed; no external anchor is configured.'
    }
    return { ...this.integrity }
  }

  purgeRetention(now = this.now()): PassportDeleteResult[] {
    const privacy = this.getPrivacy()
    const results: PassportDeleteResult[] = []
    const d3Cutoff = now - privacy.retentionDays.D3 * 86_400_000
    const deleteRows = this.db.prepare(`
      SELECT stint_id FROM stint_passport
      WHERE closed_at IS NOT NULL AND closed_at < ?
    `).all(d3Cutoff) as Row[]
    if (deleteRows.length > 0) {
      const ids = deleteRows.map((row) => text(row.stint_id))
      begin(this.db)
      try {
        this.appendDeletionTombstone('D3', ids)
        const remove = this.db.prepare('DELETE FROM stint_passport WHERE stint_id = ?')
        for (const id of ids) {
          remove.run(id)
          this.heads.delete(id)
        }
        this.db.exec('COMMIT')
      } catch (error) {
        rollback(this.db)
        throw error
      }
      results.push({ deletedStints: ids.length, redactedEvidence: 0, dataClass: 'D3' })
      this.integrity = this.verifyBounded()
    }
    for (const dataClass of ['D1', 'D2'] as const) {
      const cutoff = now - privacy.retentionDays[dataClass] * 86_400_000
      const redactedEvidence = this.redactEvidenceByClass(dataClass, cutoff) +
        (dataClass === 'D1' ? this.deleteRuntimeLogs(cutoff) : 0)
      if (redactedEvidence > 0) {
        results.push({ deletedStints: 0, redactedEvidence, dataClass })
      }
    }
    return results
  }

  deleteByClass(dataClass: PassportDataClass): PassportDeleteResult {
    if (dataClass === 'D3') {
      const rows = this.db.prepare(`
        SELECT stint_id FROM stint_passport
        WHERE lifecycle IN ('closed', 'interrupted')
      `).all() as Row[]
      const ids = rows.map((row) => text(row.stint_id))
      begin(this.db)
      try {
        if (ids.length > 0) this.appendDeletionTombstone('D3', ids)
        this.db.exec('DELETE FROM passport_roster')
        const remove = this.db.prepare('DELETE FROM stint_passport WHERE stint_id = ?')
        for (const id of ids) {
          remove.run(id)
          this.heads.delete(id)
        }
        this.db.exec('COMMIT')
      } catch (error) {
        rollback(this.db)
        throw error
      }
      this.integrity = this.verifyBounded()
      return { deletedStints: ids.length, redactedEvidence: 0, dataClass }
    }
    return {
      deletedStints: 0,
      redactedEvidence: this.redactEvidenceByClass(dataClass, Number.MAX_SAFE_INTEGER) +
        (dataClass === 'D1' ? this.deleteRuntimeLogs(Number.MAX_SAFE_INTEGER) : 0),
      dataClass
    }
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
      byId.set(passport.identity.stintId, passport)
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
    const redactions: string[] = []
    let passports = [...byId.values()]
    let exportedRoster = roster
    if (profile !== 'full-local') {
      redactions.push('driver identity', 'team identity', 'roster member identity', 'role owner member id')
      passports = passports.map((passport) => redactPassport(passport, profile, labels, this.pseudonym.bind(this)))
      exportedRoster = roster.map((member) => ({
        ...member,
        memberId: profile === 'race-only' ? '[member redacted]' : `member:${this.pseudonym('member', member.memberId)}`,
        displayName: profile === 'race-only'
          ? '[member redacted]'
          : `Member ${this.pseudonym('member', member.memberId)}`
      }))
    }
    const generatedAt = Math.max(0, ...passports.map((passport) => passport.closedAt ?? passport.identity.startedAt))
    const eventRows = this.db.prepare(`
      SELECT event_id, event_type, payload_json, payload_state, tombstone_json, data_class
      FROM passport_event
      ORDER BY sequence ASC
    `).all() as Row[]
    const canonicalEvents = eventRows.map((row) => {
      if (text(row.payload_state) !== 'available') {
        return {
          eventId: text(row.event_id),
          eventType: text(row.event_type),
          payloadState: text(row.payload_state),
          tombstone: parse(row.tombstone_json, {})
        }
      }
      if (profile !== 'full-local' && text(row.data_class) === 'D3') {
        return {
          eventId: text(row.event_id),
          eventType: text(row.event_type),
          payloadState: 'privacy-redacted'
        }
      }
      return parse(row.payload_json, {})
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
    const base = {
      contractVersion: STINT_PASSPORT_CONTRACT_VERSION,
      profile,
      generatedAt,
      passports,
      roster: exportedRoster,
      integrity: this.getIntegrity(),
      canonicalEvents,
      deletionTombstones,
      redactions
    }
    return { ...base, packageHash: hash(base) }
  }

  logRuntime(kind: string, payload: Record<string, unknown>): void {
    this.db.prepare(`
      INSERT INTO passport_runtime_log (
        log_id, created_at, kind, payload_json, data_class
      ) VALUES (?, ?, ?, ?, 'D1')
    `).run(this.idFactory(), this.now(), kind.slice(0, 80), stable(payload))
  }

  private migrate(): void {
    const version = this.schemaVersion()
    if (version > SCHEMA_VERSION) throw new Error(`Passport schema ${version} is newer than supported schema ${SCHEMA_VERSION}.`)
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
        this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
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
    this.writeSettingsInTransaction(config, privacy, killSwitch)
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
    const upsertItem = this.db.prepare(`
      INSERT INTO passport_item (
        stint_id, item_id, status, owner_json, detail, override_reason,
        reason_code, verified_at, expires_at, evidence_json, evidence_state,
        evidence_captured_at, revision,
        item_hash, data_class
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        item_hash = excluded.item_hash
    `)
    for (const item of passport.items) {
      const definition = PASSPORT_ITEM_DEFINITIONS.find((candidate) => candidate.id === item.id)
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
        item.owner || item.reasonCode ? 'D3' : definition?.dataClass ?? 'D2'
      )
    }
  }

  private appendEventInTransaction(passport: StintPassport, event: PassportStoreEvent): void {
    if (
      event.canonicalEvent.sessionRef !== passport.identity.sessionRef ||
      event.canonicalEvent.subjectRef !== `stint:${passport.identity.stintId}` ||
      event.canonicalEvent.partitionKey !== `stint:${passport.identity.stintId}`
    ) {
      throw new Error('Canonical Passport event identity does not match the persisted stint.')
    }
    const privacyRank = { D0: 0, D1: 1, D2: 2, D3: 3, D4: 4, D5: 5 } as const
    if (privacyRank[event.canonicalEvent.privacyClass] > privacyRank[event.dataClass]) {
      throw new Error('Canonical Passport event privacy exceeds its persistence data class.')
    }
    const dedupeKey = event.canonicalEvent.dedupeKey
    const existing = this.db.prepare('SELECT event_id FROM passport_event WHERE dedupe_key = ?').get(dedupeKey)
    if (existing) return
    const clock = this.allocateClockInTransaction()
    const previousHash = this.heads.get(passport.identity.stintId)
    const eventId = event.canonicalEvent.eventId || this.idFactory()
    const stateHash = passportStateHash(passport)
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
            transformId: 'passport.state-hash.v2',
            schemaFingerprint: event.canonicalEvent.facts[0]?.provenance?.schemaFingerprint ?? '',
            canonicalUnit: 'sha256',
            validity: 'valid',
            nullReason: 'unspecified',
            sourceTick: String(event.capturedAt),
            observedMonotonicNs: String(clock.logicalTimeMs * 1_000_000),
            ageMs: '0',
            privacyClass: 'D1'
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
      sequence: clock.sequence,
      logicalTimeMs: clock.logicalTimeMs,
      capturedAt: event.capturedAt,
      payloadSha256,
      previousHash,
      dataClass: event.dataClass
    }
    const recordHash = hash(base)
    this.db.prepare(`
      INSERT INTO passport_event (
        event_id, stint_id, event_type, item_id, dedupe_key, sequence,
        logical_time_ms, captured_at, event_binary, payload_json, payload_sha256,
        payload_state, tombstone_json, previous_hash, record_hash, data_class
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', NULL, ?, ?, ?)
    `).run(
      eventId,
      passport.identity.stintId,
      canonicalEvent.eventType,
      event.itemId ?? null,
      dedupeKey,
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
    this.heads.set(passport.identity.stintId, recordHash)
    this.metrics.appendOperations += 1
    this.metrics.rowsHashedOnWrite += 1
    this.integrity = {
      state: 'unanchored',
      verified: false,
      scope: 'incremental',
      checkedEvents: 1,
      headHash: recordHash,
      lastCheckedAt: this.now(),
      message: 'Local hash chain updated; no external anchor is configured.'
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
      for (const row of rows) {
        if (text(row.payload_state) === 'available') {
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
            lastStateHash = typeof stateFact?.value?.value === 'string'
              ? stateFact.value.value
              : lastStateHash
          } catch {
            this.setStickyCorruption(`Canonical event mirror mismatch in stint ${stintId}.`)
            return this.stickyCorruptionState(scope, checked, `Canonical event mirror mismatch in stint ${stintId}.`)
          }
        }
        const base = {
          eventId: text(row.event_id),
          stintId: text(row.stint_id),
          eventType: text(row.event_type),
          itemId: optionalText(row.item_id),
          dedupeKey: text(row.dedupe_key),
          sequence: numberValue(row.sequence),
          logicalTimeMs: numberValue(row.logical_time_ms),
          capturedAt: numberValue(row.captured_at),
          payloadSha256: text(row.payload_sha256),
          previousHash,
          dataClass: text(row.data_class)
        }
        const expected = hash(base)
        if (optionalText(row.previous_hash) !== previousHash || text(row.record_hash) !== expected) {
          this.setStickyCorruption(`Integrity mismatch in stint ${stintId}.`)
          return this.stickyCorruptionState(scope, checked, `Integrity mismatch in stint ${stintId}.`)
        }
        previousHash = text(row.record_hash)
        headHash = previousHash
        checked += 1
      }
      const passport = this.getPassport(stintId)
      if (rows.length > 0 && (!passport || !this.verifyPassportPayload(stintId, passport) || lastStateHash !== passportStateHash(passport))) {
        this.setStickyCorruption(`Passport state hash mismatch in stint ${stintId}.`)
        return this.stickyCorruptionState(scope, checked, `Passport state hash mismatch in stint ${stintId}.`)
      }
      this.heads.set(stintId, previousHash)
    }
    if (scope !== 'full') this.metrics.boundedVerificationRows += checked
    return {
      state: 'unanchored',
      verified: false,
      scope,
      checkedEvents: checked,
      totalEvents: checked,
      headHash,
      lastCheckedAt: this.now(),
      message: 'Local hashes verified within scope; no external anchor is configured.'
    }
  }

  private redactEvidenceByClass(dataClass: 'D1' | 'D2', cutoff: number): number {
    const rows = this.db.prepare(`
      SELECT stint_id, item_id, status, owner_json, detail, override_reason,
        reason_code, verified_at, expires_at, revision
      FROM passport_item
      WHERE data_class = ?
        AND evidence_json IS NOT NULL
        AND COALESCE(evidence_captured_at, 0) < ?
    `).all(dataClass, cutoff) as Row[]
    const eventRows = this.db.prepare(`
      SELECT event_id, stint_id FROM passport_event
      WHERE data_class = ?
        AND payload_state = 'available'
        AND captured_at < ?
    `).all(dataClass, cutoff) as Row[]
    if (rows.length === 0 && eventRows.length === 0) return 0
    begin(this.db)
    try {
      const update = this.db.prepare(`
        UPDATE passport_item
        SET evidence_json = NULL,
            evidence_state = 'retention-redacted',
            evidence_captured_at = NULL,
            item_hash = ?
        WHERE stint_id = ? AND item_id = ?
      `)
      const affectedStints = new Set<string>()
      for (const row of rows) {
        const item: PassportItem = {
          id: text(row.item_id) as PassportItemId,
          status: text(row.status) as PassportItem['status'],
          owner: parse(row.owner_json, undefined),
          detail: text(row.detail),
          overrideReason: optionalText(row.override_reason),
          reasonCode: optionalText(row.reason_code),
          verifiedAt: row.verified_at == null ? undefined : numberValue(row.verified_at),
          expiresAt: row.expires_at == null ? undefined : numberValue(row.expires_at),
          evidence: undefined,
          revision: numberValue(row.revision)
        }

        update.run(itemHash(item), text(row.stint_id), item.id)
        affectedStints.add(text(row.stint_id))
      }
      const redactEvent = this.db.prepare(`
        UPDATE passport_event
        SET event_binary = NULL,
            payload_json = NULL,
            payload_state = 'retention-redacted',
            tombstone_json = ?
        WHERE event_id = ?
      `)
      for (const row of eventRows) {
        redactEvent.run(
          stable({ dataClass, redactedAt: this.now(), reason: 'retention-or-explicit-delete' }),
          text(row.event_id)
        )
        affectedStints.add(text(row.stint_id))
      }
      for (const stintId of affectedStints) {
        const passport = this.getPassport(stintId)
        if (!passport) continue
        this.upsertPassportInTransaction(passport)
        this.appendEventInTransaction(passport, this.retentionEvent(passport, dataClass))
      }
      this.db.exec('COMMIT')
      return rows.length + eventRows.length
    } catch (error) {
      rollback(this.db)
      throw error
    }
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
  if (!memberId || !displayName) throw new Error('Roster members require an ID and display name.')
  const roles = [...new Set(member.roles)].filter((role) =>
    role === 'driver' ||
    role === 'engineer' ||
    role === 'crew-chief' ||
    role === 'spotter' ||
    role === 'team-manager'
  )
  if (roles.length === 0) throw new Error(`Roster member ${displayName} requires at least one valid role.`)
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

function redactPassport(
  passport: StintPassport,
  profile: Exclude<PassportExportProfile, 'full-local'>,
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
