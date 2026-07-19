import { mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_PASSPORT_PRIVACY,
  PASSPORT_ITEM_DEFINITIONS,
  STINT_PASSPORT_CONTRACT_VERSION,
  type PassportItem,
  type StintPassport
} from '../../shared/stint-passport'
import { emptyConfidence, emptyObservedInterval } from '../../shared/phase02-contracts'
import {
  PassportPersistenceEngine as PassportStore,
  type PassportStoreEvent
} from './persistence-engine'

const dirs: string[] = []
const stores: PassportStore[] = []

afterEach(() => {
  for (const store of stores.splice(0)) {
    try {
      store.close()
    } catch {
      // Already closed.
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(name: string): string {
  const dir = join(process.cwd(), `.passport-store-${name}-${process.pid}-${dirs.length}`)
  mkdirSync(dir, { recursive: true })
  dirs.push(dir)
  return dir
}

function open(path: string, start: number) {
  let now = start
  let ids = 0
  const store = new PassportStore({
    path,
    now: () => now,
    idFactory: () => `id-${start}-${++ids}`
  })
  stores.push(store)
  return {
    store,
    setNow(value: number) { now = value }
  }
}

function passport(id = 'stint-1', startedAt = 1_000): StintPassport {
  const items: PassportItem[] = PASSPORT_ITEM_DEFINITIONS.map((definition, index) => ({
    id: definition.id,
    status: index === 10 ? 'not-applicable' : 'verified',
    owner: {
      memberId: index % 2 === 0 ? 'engineer-1' : 'driver-1',
      role: index % 2 === 0 ? 'engineer' : 'driver'
    },
    detail: index === 0 ? 'Driver Alice and Team Alpha are ready.' : `${definition.id} ready.`,
    overrideReason: index === 10 ? 'Open weather.' : undefined,
    verifiedAt: startedAt,
    expiresAt: startedAt + definition.ttlMs,
    evidence: {
      source: 'fixture',
      summary: index === 0 ? 'Acknowledged by Alice.' : 'Fixture evidence.',
      contentHash: `${index}`.padStart(64, '0'),
      capturedAt: startedAt,
      state: 'available'
    },
    revision: 1
  }))
  return {
    contractVersion: STINT_PASSPORT_CONTRACT_VERSION,
    identity: {
      stintId: id,
      sessionRef: `session:${id}`,
      trackRef: 'track:spa',
      trackLabel: 'Spa — Grand Prix',
      carRef: 'car:gt3',
      carLabel: 'GT3 R',
      driverRef: 'driver-1',
      driverLabel: 'Alice',
      teamRef: 'team-1',
      teamLabel: 'Team Alpha',
      startedAt
    },
    lifecycle: 'ready',
    telemetryContext: 'live',
    items,
    coverage: 1,
    applicableItems: 11,
    coveredItems: 11,
    challengeCompletedAt: startedAt,
    challengeOwner: { memberId: 'driver-1', role: 'driver' },
    interrupted: false,
    persisted: false,
    revision: 1,
    durability: 'ephemeral'
  }
}

function event(
  index: number,
  dedupeKey = `event-${index}`,
  stintId = 'stint-1'
): PassportStoreEvent {
  return {
    dataClass: 'D2' as const,
    capturedAt: 1_000 + index,
    canonicalEvent: {
      eventId: `event-id-${index}`,
      eventClass: 'fact' as const,
      eventType: 'ultimate.sim.raceops.passport.item-updated.v2',
      sessionRef: `session:${stintId}`,
      actorRef: 'system:test',
      subjectRef: `stint:${stintId}`,
      observedInterval: emptyObservedInterval(),
      facts: [{
        name: 'passport.index',
        canonicalUnit: 'count',
        value: { kind: 'double' as const, value: index },
        provenance: {
          sourceId: 'test',
          transformId: 'test.v2',
          schemaFingerprint: 'test',
          canonicalUnit: 'count',
          validity: 'valid' as const,
          nullReason: 'unspecified' as const,
          sourceTick: String(1_000 + index),
          observedMonotonicNs: '0',
          ageMs: '0',
          privacyClass: 'D2' as const
        }
      }],
      confidence: emptyConfidence(),
      severity: 'info' as const,
      priority: 'normal' as const,
      evidenceRefs: [],
      policyRef: 'test',
      capabilityRef: 'test',
      consentEpoch: '1',
      approvalRef: '',
      correlationId: stintId,
      dedupeKey,
      privacyClass: 'D2' as const,
      integrityFlags: ['derived' as const],
      supersedesEventId: '',
      sequence: '0',
      partitionKey: `stint:${stintId}`,
      partitionSeq: '0',
      telemetryContext: 'live' as const,
      sourceTick: String(1_000 + index),
      observedMonotonicNs: '0',
      ttlMs: '0'
    }
  }
}

describe('PassportStore privacy and incremental integrity', () => {
  it('defaults D3 persistence off and deletes stored identity immediately on opt-out', () => {
    const { store } = open(join(scratch('privacy'), 'passport.db'), 1_000)
    expect(store.getPrivacy()).toEqual(DEFAULT_PASSPORT_PRIVACY)
    expect(() => store.persistPassport(passport(), event(1))).toThrow(/opt-in/i)

    store.setPrivacy({
      ...DEFAULT_PASSPORT_PRIVACY,
      identityPersistenceOptIn: true,
      updatedAt: 0
    })
    store.saveRoster([
      { memberId: 'driver-1', displayName: 'Alice', roles: ['driver'], active: true }
    ])
    store.persistPassport(passport(), event(1))
    expect(store.listPassports()).toHaveLength(1)
    expect(store.listRoster()).toHaveLength(1)

    store.setPrivacy(DEFAULT_PASSPORT_PRIVACY)
    expect(store.listPassports()).toEqual([])
    expect(store.listRoster()).toEqual([])
  })

  it('hashes only the appended row per write and reserves full scans for explicit audit', async () => {
    const { store } = open(join(scratch('scale'), 'passport.db'), 1_000)
    store.setPrivacy({ ...DEFAULT_PASSPORT_PRIVACY, identityPersistenceOptIn: true, updatedAt: 0 })
    let current = passport()
    for (let index = 1; index <= 200; index += 1) {
      current = store.persistPassport(current, event(index))
    }
    const metrics = store.metricsSnapshot()
    expect(metrics.appendOperations).toBe(200)
    expect(metrics.rowsHashedOnWrite).toBe(200)
    expect(metrics.fullAuditRuns).toBe(0)
    expect(store.getIntegrity()).toMatchObject({ state: 'anchored', verified: true, scope: 'incremental' })

    const audit = await store.runFullAudit()
    expect(audit).toMatchObject({ state: 'anchored', verified: true, scope: 'full', checkedEvents: 200 })
    expect(store.metricsSnapshot().fullAuditRuns).toBe(1)
  })

  it('persists monotonic sequence and logical time across restart and wall-clock rollback', () => {
    const path = join(scratch('restart-clock'), 'passport.db')
    const first = open(path, 10_000)
    first.store.setPrivacy({ ...DEFAULT_PASSPORT_PRIVACY, identityPersistenceOptIn: true, updatedAt: 0 })
    first.store.persistPassport(passport(), event(1))
    const before = first.store.eventHeaders('stint-1')[0]
    first.store.close()
    stores.splice(stores.indexOf(first.store), 1)

    const second = open(path, 5_000)
    second.store.persistPassport(passport(), event(2))
    const headers = second.store.eventHeaders('stint-1')
    expect(headers.map((header) => header.sequence)).toEqual([1, 2])
    expect(headers[1].logicalTimeMs).toBeGreaterThan(before.logicalTimeMs)
    expect(headers[1].previousHash).toBe(headers[0].recordHash)
  })

  it('deduplicates exact retries and rejects conflicting state under the same key', () => {
    const { store } = open(join(scratch('dedupe'), 'passport.db'), 1_000)
    store.setPrivacy({ ...DEFAULT_PASSPORT_PRIVACY, identityPersistenceOptIn: true, updatedAt: 0 })
    const current = passport()
    store.persistPassport(current, event(1))
    store.persistPassport(current, event(1))
    expect(store.eventHeaders('stint-1')).toHaveLength(1)
    expect(() => store.persistPassport(
      { ...current, lifecycle: 'closed', closedAt: 2_000, closeReason: 'manual' },
      event(1)
    )).toThrow(/dedupe conflict/i)
    expect(store.getPassport('stint-1')?.lifecycle).toBe('ready')
  })

  it('persists and exports canonical RaceOpsEvent ProtoJSON/binary instead of parallel payload JSON', () => {
    const path = join(scratch('canonical-events'), 'passport.db')
    const { store } = open(path, 1_000)
    store.setPrivacy({ ...DEFAULT_PASSPORT_PRIVACY, identityPersistenceOptIn: true, updatedAt: 0 })
    store.persistPassport(passport(), event(1))
    const db = new DatabaseSync(path)
    const row = db.prepare(`
      SELECT event_binary, payload_json FROM passport_event LIMIT 1
    `).get() as { event_binary: Uint8Array; payload_json: string }
    db.close()
    const protoJson = JSON.parse(row.payload_json)
    expect(row.event_binary.byteLength).toBeGreaterThan(0)
    expect(protoJson).toMatchObject({
      eventId: 'event-id-1',
      eventClass: 'RACE_OPS_EVENT_CLASS_FACT',
      policyRef: 'test',
      capabilityRef: 'test',
      consentEpoch: '1'
    })
    expect(protoJson.facts[0].provenance).toMatchObject({
      validity: 'DATA_VALIDITY_VALID',
      privacyClass: 'PRIVACY_CLASS_D2_DRIVER'
    })
    expect(store.exportPackage('full-local').canonicalEvents[0]).toMatchObject({
      eventId: 'event-id-1'
    })
  })

  function enablePersistence(store: PassportStore): void {
    store.setPrivacy({
      ...DEFAULT_PASSPORT_PRIVACY,
      identityPersistenceOptIn: true,
      updatedAt: 0
    })
  }

  function closeTracked(store: PassportStore): void {
    store.close()
    const index = stores.indexOf(store)
    if (index >= 0) stores.splice(index, 1)
  }

  function tableCount(path: string, table: string): number {
    const db = new DatabaseSync(path)
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }
    db.close()
    return row.count
  }

  async function sqliteArtifactText(path: string): Promise<string> {
    const { existsSync, readFileSync, readdirSync } = await import('node:fs')
    const { basename, dirname } = await import('node:path')
    const directory = dirname(path)
    const databaseName = basename(path)
    const names = readdirSync(directory).filter((name) =>
      name === databaseName ||
      name === `${databaseName}-wal` ||
      name === `${databaseName}-shm` ||
      name.startsWith(`${databaseName}.quarantine-`)
    )
    return names
      .filter((name) => existsSync(join(directory, name)))
      .map((name) => readFileSync(join(directory, name)).toString('utf8'))
      .join('\n')
  }

  describe('PassportStore Phase 2 transactional durability and retries', () => {
    it('rolls back passport, items, event, clock, and next hash after an identity mismatch', () => {
      const path = join(scratch('identity-rollback'), 'passport.db')
      const first = open(path, 10_000).store
      enablePersistence(first)
      const mismatched = event(1)
      mismatched.canonicalEvent.sessionRef = 'session:another-stint'

      expect(() => first.persistPassport(passport(), mismatched)).toThrow(/identity/i)
      closeTracked(first)

      const reopened = open(path, 20_000).store
      expect(reopened.getPassport('stint-1')).toBeNull()
      expect(reopened.eventHeaders('stint-1')).toEqual([])
      expect(tableCount(path, 'passport_item')).toBe(0)
      const clockDb = new DatabaseSync(path)
      const clock = clockDb.prepare(
        'SELECT next_sequence, last_logical_time_ms FROM passport_clock WHERE singleton = 1'
      ).get() as { next_sequence: number; last_logical_time_ms: number }
      clockDb.close()
      expect(clock).toEqual({ next_sequence: 0, last_logical_time_ms: 0 })

      reopened.persistPassport(passport(), event(2))
      expect(reopened.eventHeaders('stint-1')).toMatchObject([
        { sequence: 1, previousHash: undefined }
      ])
    })

    it('rolls back all durable rows when canonical privacy exceeds the storage class', () => {
      const path = join(scratch('privacy-rollback'), 'passport.db')
      const first = open(path, 10_000).store
      enablePersistence(first)
      const mismatched = event(1)
      mismatched.canonicalEvent.privacyClass = 'D3'

      expect(() => first.persistPassport(passport(), mismatched)).toThrow(/privacy/i)
      closeTracked(first)

      const reopened = open(path, 20_000).store
      expect(reopened.getPassport('stint-1')).toBeNull()
      expect(reopened.eventHeaders('stint-1')).toEqual([])
      expect(tableCount(path, 'passport_item')).toBe(0)
      expect(tableCount(path, 'passport_event')).toBe(0)
    })

    it.each([
      ['item insert', 'passport_item'],
      ['event insert', 'passport_event']
    ])('rolls back a trigger-induced %s failure across reopen', (_label, table) => {
      const path = join(scratch(`trigger-${table}`), 'passport.db')
      const first = open(path, 10_000).store
      enablePersistence(first)
      const triggerDb = new DatabaseSync(path)
      triggerDb.exec(`
        CREATE TRIGGER phase2_forced_failure
        BEFORE INSERT ON ${table}
        BEGIN
          SELECT RAISE(ABORT, 'phase2 forced ${table} failure');
        END;
      `)
      triggerDb.close()

      expect(() => first.persistPassport(passport(), event(1))).toThrow(/phase2 forced/i)
      closeTracked(first)

      const reopened = open(path, 20_000).store
      expect(reopened.getPassport('stint-1')).toBeNull()
      expect(reopened.eventHeaders('stint-1')).toEqual([])
      expect(tableCount(path, 'stint_passport')).toBe(0)
      expect(tableCount(path, 'passport_item')).toBe(0)
      expect(tableCount(path, 'passport_event')).toBe(0)
    })

    it('reports a locked BEGIN and leaves no partial durable state after the lock is released', () => {
      const path = join(scratch('begin-lock'), 'passport.db')
      const first = open(path, 10_000).store
      enablePersistence(first)
      const blocker = new DatabaseSync(path)
      blocker.exec('PRAGMA busy_timeout = 0')
      blocker.exec('BEGIN IMMEDIATE')
      try {
        expect(() => first.persistPassport(passport(), event(1))).toThrow(/busy|locked/i)
      } finally {
        blocker.exec('ROLLBACK')
        blocker.close()
      }
      closeTracked(first)

      const reopened = open(path, 20_000).store
      expect(reopened.getPassport('stint-1')).toBeNull()
      expect(reopened.eventHeaders('stint-1')).toEqual([])
      expect(tableCount(path, 'passport_event')).toBe(0)
    }, 15_000)

    it('[spec-gap] recovers a committed write whose trusted anchor promotion is blocked', async () => {
      const path = join(scratch('anchor-promotion'), 'passport.db')
      let blockPromotion = false
      const first = new PassportStore({
        path,
        now: () => 10_000,
        idFactory: () => 'anchor-promotion-id',
        promoteAnchor(source, destination) {
          if (blockPromotion) {
            throw Object.assign(new Error('anchor promotion blocked'), { code: 'EPERM' })
          }
          renameSync(source, destination)
        }
      })
      stores.push(first)
      enablePersistence(first)
      blockPromotion = true

      expect(() => first.persistPassport(passport(), event(1)))
        .toThrow(/anchor promotion blocked/i)
      expect(first.getIntegrity()).toMatchObject({
        state: 'unavailable',
        verified: false,
        message: expect.stringMatching(/promotion is pending/i)
      })
      expect(first.getPassport('stint-1')).toMatchObject({
        revision: 1,
        persisted: true,
        durability: 'durable'
      })
      await expect(first.runFullAudit()).resolves.toMatchObject({
        state: 'anchored',
        verified: true
      })

      closeTracked(first)
      blockPromotion = false
      const reopened = open(path, 20_000).store
      expect(reopened.getIntegrity()).toMatchObject({
        state: 'anchored',
        verified: true
      })
      expect(reopened.getPassport('stint-1')).toMatchObject({
        revision: 1,
        persisted: true,
        durability: 'durable'
      })
    })

    it('[spec-gap] restores the in-memory hash head when COMMIT fails after an append', () => {
      const path = join(scratch('commit-head'), 'passport.db')
      const { store } = open(path, 10_000)
      enablePersistence(store)
      const injector = new DatabaseSync(path)
      injector.exec(`
        CREATE TABLE phase2_parent(id INTEGER PRIMARY KEY);
        CREATE TABLE phase2_deferred_child(
          id INTEGER PRIMARY KEY,
          parent_id INTEGER,
          FOREIGN KEY(parent_id) REFERENCES phase2_parent(id)
            DEFERRABLE INITIALLY DEFERRED
        );
        CREATE TRIGGER phase2_fail_commit
        AFTER INSERT ON passport_event
        BEGIN
          INSERT INTO phase2_deferred_child(id, parent_id) VALUES (NEW.sequence, -1);
        END;
      `)
      injector.close()

      expect(() => store.persistPassport(passport(), event(1))).toThrow(/foreign key/i)
      const repair = new DatabaseSync(path)
      repair.exec('DROP TRIGGER phase2_fail_commit')
      repair.close()
      store.persistPassport(passport(), event(2))

      expect(store.eventHeaders('stint-1')).toMatchObject([
        { sequence: 1, previousHash: undefined }
      ])
      closeTracked(store)
      const reopened = open(path, 20_000).store
      expect(reopened.verifyActiveStint('stint-1').state).toBe('anchored')
    })

    it('deduplicates an exact retry after reopen as a commit-response ambiguity', () => {
      const path = join(scratch('response-loss-retry'), 'passport.db')
      const first = open(path, 10_000).store
      enablePersistence(first)
      const operation = event(1, 'stable-operation-key')
      first.persistPassport(passport(), operation)
      closeTracked(first)

      const retry = open(path, 20_000).store
      const result = retry.persistPassport(passport(), operation)
      expect(result).toMatchObject({ persisted: true, durability: 'durable' })
      expect(retry.eventHeaders('stint-1')).toHaveLength(1)
      closeTracked(retry)

      const reopened = open(path, 30_000).store
      expect(reopened.eventHeaders('stint-1')).toMatchObject([
        { sequence: 1, dedupeKey: 'stable-operation-key', previousHash: undefined }
      ])
      expect(reopened.getPassport('stint-1')?.lifecycle).toBe('ready')
    })

    it('rejects a conflicting retry after reopen without overwriting durable state', () => {
      const path = join(scratch('conflicting-retry'), 'passport.db')
      const first = open(path, 10_000).store
      enablePersistence(first)
      first.persistPassport(passport(), event(1, 'conflict-key'))
      closeTracked(first)

      const retry = open(path, 20_000).store
      expect(() => retry.persistPassport({
        ...passport(),
        lifecycle: 'closed',
        closedAt: 20_000,
        closeReason: 'manual',
        revision: 2
      }, event(1, 'conflict-key'))).toThrow(/dedupe conflict/i)
      closeTracked(retry)

      const reopened = open(path, 30_000).store
      expect(reopened.getPassport('stint-1')).toMatchObject({
        lifecycle: 'ready',
        revision: 1
      })
      expect(reopened.eventHeaders('stint-1')).toHaveLength(1)
    })

    it('[spec-gap] derives stable operation identity for a semantic retry with a regenerated key', () => {
      const path = join(scratch('semantic-retry'), 'passport.db')
      const first = open(path, 10_000).store
      enablePersistence(first)
      first.persistPassport(passport(), event(1, 'attempt-one'))
      closeTracked(first)

      const retry = open(path, 20_000).store
      const regenerated = event(1, 'attempt-two')
      regenerated.canonicalEvent.eventId = 'event-id-regenerated'
      retry.persistPassport(passport(), regenerated)
      expect(retry.eventHeaders('stint-1')).toHaveLength(1)
    })
  })

  describe('PassportStore Phase 2 retention and raw privacy', () => {
    it('keeps D1/D2 redaction and D3 passport/roster deletion durable across reopen', () => {
      const path = join(scratch('retention-reopen'), 'passport.db')
      const first = open(path, 10_000).store
      enablePersistence(first)
      first.saveRoster([
        { memberId: 'phase2-driver', displayName: 'Phase Two Driver', roles: ['driver'], active: true }
      ])
      const live = passport('live-stint', 1_000)
      live.items = live.items.map((item) =>
        passportItemDataClassForPhase2(item.id) === 'D2'
          ? { ...item, owner: undefined, reasonCode: undefined }
          : item
      )
      first.persistPassport(live, event(1, 'live-d2', 'live-stint'))
      const d1Event = event(2, 'live-d1', 'live-stint')
      d1Event.dataClass = 'D1'
      d1Event.canonicalEvent.privacyClass = 'D1'
      first.persistPassport(live, d1Event)
      first.logRuntime('phase2-private-log', { secret: 'PHASE2-D1-RUNTIME-SENTINEL' })
      first.persistPassport({
        ...passport('closed-stint', 2_000),
        lifecycle: 'closed',
        closedAt: 3_000,
        closeReason: 'manual'
      }, event(3, 'closed-d3', 'closed-stint'))

      expect(first.deleteByClass('D2').redactedEvidence).toBeGreaterThan(0)
      expect(first.deleteByClass('D1').redactedEvidence).toBeGreaterThan(0)
      expect(first.deleteByClass('D3')).toMatchObject({ deletedStints: 2, dataClass: 'D3' })
      closeTracked(first)

      const reopened = open(path, 20_000).store
      expect(reopened.getPassport('closed-stint')).toBeNull()
      expect(reopened.getPassport('live-stint')).toBeNull()
      expect(reopened.getPrivacy().identityPersistenceOptIn).toBe(false)
      expect(reopened.listRoster()).toEqual([])
      const db = new DatabaseSync(path)
      const redacted = db.prepare(
        "SELECT COUNT(*) AS count FROM passport_event WHERE payload_state = 'retention-redacted'"
      ).get() as { count: number }
      const runtime = db.prepare('SELECT COUNT(*) AS count FROM passport_runtime_log').get() as { count: number }
      db.close()
      expect(redacted.count).toBe(0)
      expect(runtime.count).toBe(0)
    })

    it('stores only hashes in D3 deletion tombstones and exports no deleted identity text', () => {
      const path = join(scratch('tombstone-secrets'), 'passport.db')
      const first = open(path, 10_000).store
      enablePersistence(first)
      const sentinelId = 'STINT-PHASE2-RAW-DELETE-SENTINEL'
      const deleted = {
        ...passport(sentinelId, 1_000),
        lifecycle: 'closed' as const,
        closedAt: 2_000,
        closeReason: 'manual' as const
      }
      deleted.items[0] = {
        ...deleted.items[0],
        detail: 'PHASE2-PRIVATE-REASON-SENTINEL',
        overrideReason: 'PHASE2-PRIVATE-OVERRIDE-SENTINEL'
      }
      first.persistPassport(deleted, event(1, 'delete-sentinel', sentinelId))
      first.deleteByClass('D3')
      closeTracked(first)

      const reopened = open(path, 20_000).store
      const db = new DatabaseSync(path)
      const row = db.prepare(
        'SELECT subject_hashes_json FROM passport_deletion_tombstone LIMIT 1'
      ).get() as { subject_hashes_json: string }
      db.close()
      const hashes = JSON.parse(row.subject_hashes_json) as string[]
      expect(hashes).toHaveLength(1)
      expect(hashes[0]).toMatch(/^[a-f0-9]{64}$/)
      const exported = JSON.stringify(reopened.exportPackage('race-only'))
      expect(exported).not.toContain(sentinelId)
      expect(exported).not.toContain('PHASE2-PRIVATE-REASON-SENTINEL')
      expect(exported).not.toContain('PHASE2-PRIVATE-OVERRIDE-SENTINEL')
    })

    it('[spec-gap] securely erases D1/D2/D3 sentinels from DB, WAL, SHM, and quarantine bytes', async () => {
      const path = join(scratch('raw-erasure'), 'passport.db')
      const first = open(path, 10_000).store
      enablePersistence(first)
      const sentinels = [
        'PHASE2-RAW-DRIVER-7F6A',
        'PHASE2-RAW-TEAM-9C2B',
        'PHASE2-RAW-EVIDENCE-4D1E',
        'PHASE2-RAW-RUNTIME-8A3C'
      ]
      first.saveRoster([
        { memberId: sentinels[0], displayName: sentinels[0], roles: ['driver'], active: true }
      ])
      const privatePassport = passport('phase2-raw-stint', 1_000)
      privatePassport.identity.driverLabel = sentinels[0]
      privatePassport.identity.teamLabel = sentinels[1]
      privatePassport.items[0] = {
        ...privatePassport.items[0],
        evidence: privatePassport.items[0].evidence
          ? { ...privatePassport.items[0].evidence, summary: sentinels[2] }
          : undefined
      }
      first.persistPassport(privatePassport, event(1, 'raw-erasure', 'phase2-raw-stint'))
      first.logRuntime('phase2-raw', { value: sentinels[3] })
      first.setPrivacy(DEFAULT_PASSPORT_PRIVACY)
      first.deleteByClass('D1')
      closeTracked(first)

      const checkpoint = new DatabaseSync(path)
      checkpoint.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      checkpoint.close()
      const raw = await sqliteArtifactText(path)
      for (const sentinel of sentinels) expect(raw).not.toContain(sentinel)
    })

    it('[spec-gap] redacts case-folded, Unicode-normalized, substring, and canonical-event aliases', () => {
      const path = join(scratch('alias-redaction'), 'passport.db')
      const { store } = open(path, 10_000)
      enablePersistence(store)
      const data = passport('alias-stint', 1_000)
      data.identity.driverLabel = 'ÁLICE-PHASE2'
      data.identity.teamLabel = 'TEAM-PHASE2'
      data.items[0] = {
        ...data.items[0],
        detail: 'a\u0301lice-phase2 and álIce-phase2-substring',
        overrideReason: 'team-phase2',
        evidence: data.items[0].evidence
          ? { ...data.items[0].evidence, summary: 'Álice-Phase2' }
          : undefined
      }
      const aliasedEvent = event(1, 'alias-event', 'alias-stint')
      aliasedEvent.canonicalEvent.approvalRef = 'álice-phase2-canonical'
      aliasedEvent.canonicalEvent.capabilityRef = 'TEAM-phase2-capability'
      store.persistPassport(data, aliasedEvent)

      const portable = JSON.stringify([
        store.exportPackage('pseudonymized'),
        store.exportPackage('race-only')
      ])
      for (const leaked of [
        'a\u0301lice-phase2',
        'álIce-phase2-substring',
        'team-phase2',
        'Álice-Phase2',
        'álice-phase2-canonical',
        'TEAM-phase2-capability'
      ]) {
        expect(portable).not.toContain(leaked)
      }
    })
  })

  function passportItemDataClassForPhase2(itemId: PassportItem['id']): 'D1' | 'D2' | 'D3' {
    return PASSPORT_ITEM_DEFINITIONS.find((definition) => definition.id === itemId)?.dataClass ?? 'D2'
  }

  const supportedTamperCases: ReadonlyArray<readonly [
    string,
    (db: DatabaseSync) => void
  ]> = [
    [
      'malformed ProtoJSON mirror',
      (db) => { db.prepare("UPDATE passport_event SET payload_json = '{' WHERE sequence = 2").run() }
    ],
    [
      'sequence reordering',
      (db) => { db.prepare('UPDATE passport_event SET sequence = 12 WHERE sequence = 2').run() }
    ],
    [
      'middle-row deletion',
      (db) => { db.prepare('DELETE FROM passport_event WHERE sequence = 2').run() }
    ],
    [
      'forged row insertion',
      (db) => {
        db.exec(`
          INSERT INTO passport_event (
            event_id, stint_id, event_type, item_id, dedupe_key, sequence,
            logical_time_ms, captured_at, event_binary, payload_json, payload_sha256,
            payload_state, tombstone_json, previous_hash, record_hash, data_class
          )
          SELECT
            'phase2-inserted-event', stint_id, event_type, item_id, 'phase2-inserted-key', 99,
            logical_time_ms + 99, captured_at, event_binary, payload_json, payload_sha256,
            payload_state, tombstone_json, previous_hash, record_hash, data_class
          FROM passport_event WHERE sequence = 1
        `)
      }
    ]
  ]

  describe('PassportStore Phase 2 integrity, quarantine, and repair token', () => {
    it.each(supportedTamperCases)('fails closed on %s and keeps quarantine sticky after reopen', (_name, mutate) => {
      const path = join(scratch(`tamper-${dirs.length}`), 'passport.db')
      const first = open(path, 10_000).store
      enablePersistence(first)
      for (let index = 1; index <= 3; index += 1) {
        first.persistPassport(passport(), event(index))
      }
      const attacker = new DatabaseSync(path)
      mutate(attacker)
      attacker.close()

      expect(first.verifyActiveStint('stint-1')).toMatchObject({
        state: 'corrupt',
        verified: false
      })
      expect(() => first.persistPassport(passport(), event(4))).toThrow(/quarantined/i)
      closeTracked(first)

      const reopened = open(path, 20_000).store
      expect(reopened.getIntegrity()).toMatchObject({ state: 'corrupt', verified: false })
      expect(() => reopened.saveRoster([
        { memberId: 'blocked', displayName: 'Blocked', roles: ['driver'], active: true }
      ])).toThrow(/quarantined/i)
    })

    it('[spec-gap] detects a middle-row payload_state mutation even when a later state hash exists', () => {
      const path = join(scratch('payload-state-tamper'), 'passport.db')
      const first = open(path, 10_000).store
      enablePersistence(first)
      for (let index = 1; index <= 3; index += 1) {
        first.persistPassport(passport(), event(index))
      }
      const attacker = new DatabaseSync(path)
      attacker.prepare(
        "UPDATE passport_event SET payload_state = 'retention-redacted' WHERE sequence = 2"
      ).run()
      attacker.close()

      expect(first.verifyActiveStint('stint-1').state).toBe('corrupt')
      closeTracked(first)
      expect(open(path, 20_000).store.getIntegrity().state).toBe('corrupt')
    })

    it('detects deletion tombstone mutation and preserves quarantine across reopen', async () => {
      const path = join(scratch('tombstone-tamper'), 'passport.db')
      const first = open(path, 10_000).store
      enablePersistence(first)
      first.persistPassport({
        ...passport(),
        lifecycle: 'closed',
        closedAt: 2_000,
        closeReason: 'manual'
      }, event(1))
      first.deleteByClass('D3')
      const attacker = new DatabaseSync(path)
      attacker.prepare(
        "UPDATE passport_deletion_tombstone SET subject_hashes_json = '[\"forged\"]'"
      ).run()
      attacker.close()

      expect(await first.runFullAudit()).toMatchObject({ state: 'corrupt', verified: false })
      closeTracked(first)
      const reopened = open(path, 20_000).store
      expect(reopened.getIntegrity().state).toBe('corrupt')
      expect(() => reopened.persistPassport(passport(), event(2))).toThrow(/quarantined/i)
    })

    it('[spec-gap] rejects last-row truncation even when the remaining local state is self-consistent', () => {
      const path = join(scratch('last-row-truncation'), 'passport.db')
      const first = open(path, 10_000).store
      enablePersistence(first)
      first.persistPassport(passport(), event(1))
      first.persistPassport(passport(), event(2))
      const attacker = new DatabaseSync(path)
      attacker.prepare('DELETE FROM passport_event WHERE sequence = 2').run()
      attacker.close()

      expect(first.verifyActiveStint('stint-1').state).toBe('corrupt')
      closeTracked(first)
      expect(open(path, 20_000).store.getIntegrity().state).toBe('corrupt')
    })

    it('[spec-gap] rejects rollback to an older self-consistent database image', async () => {
      const path = join(scratch('database-rollback'), 'passport.db')
      const snapshotPath = join(scratch('database-snapshot'), 'passport-snapshot.db')
      const first = open(path, 10_000).store
      enablePersistence(first)
      first.persistPassport(passport(), event(1))
      closeTracked(first)
      const snapshotter = new DatabaseSync(path)
      snapshotter.exec(`VACUUM INTO '${snapshotPath.replaceAll("'", "''")}'`)
      snapshotter.close()

      const second = open(path, 20_000).store
      second.persistPassport(passport(), event(2))
      closeTracked(second)
      const { copyFileSync, rmSync: removeFileSync } = await import('node:fs')
      copyFileSync(snapshotPath, path)
      removeFileSync(`${path}-wal`, { force: true })
      removeFileSync(`${path}-shm`, { force: true })

      const reopened = open(path, 30_000).store
      expect(reopened.getIntegrity().state).toBe('corrupt')
      expect(() => reopened.persistPassport(passport(), event(3))).toThrow(/quarantined/i)
    })

    it('rejects malformed repair-token variants while accepting only the exact token', () => {
      const path = join(scratch('repair-token'), 'passport.db')
      const { store } = open(path, 10_000)
      enablePersistence(store)
      store.persistPassport(passport(), event(1))
      const attacker = new DatabaseSync(path)
      attacker.prepare("UPDATE passport_event SET payload_json = '{\"forged\":true}'").run()
      attacker.close()
      const token = store.verifyActiveStint('stint-1').repairToken!
      const letterIndex = token.search(/[a-f]/)
      const caseVariant = letterIndex >= 0
        ? `${token.slice(0, letterIndex)}${token[letterIndex].toUpperCase()}${token.slice(letterIndex + 1)}`
        : `${token.slice(0, -1)}A`
      const variants = [
        '',
        token.slice(0, -1),
        token.slice(1),
        `${token}0`,
        `0${token}`,
        caseVariant,
        `\uFF10${token.slice(1)}`,
        `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`
      ]

      expect(store.validateRepairToken(token)).toBe(true)
      expect(variants.map((value) => store.validateRepairToken(value))).toEqual(
        variants.map(() => false)
      )
      expect(store.getIntegrity()).toMatchObject({ state: 'corrupt', repairToken: token })
    })

    it('[spec-gap] blocks every ordinary mutation while quarantined', () => {
      const path = join(scratch('quarantine-writes'), 'passport.db')
      const { store } = open(path, 10_000)
      enablePersistence(store)
      store.persistPassport(passport(), event(1))
      const attacker = new DatabaseSync(path)
      attacker.prepare("UPDATE passport_event SET payload_json = '{\"forged\":true}'").run()
      attacker.close()
      expect(store.verifyActiveStint('stint-1').state).toBe('corrupt')

      const accepted = [
        ['setConfig', () => store.setConfig({
          ...store.getConfig(),
          communicationChannel: 'phase2-quarantine-write'
        })],
        ['setPrivacy', () => store.setPrivacy({
          ...store.getPrivacy(),
          retentionDays: { D1: 1, D2: 1, D3: 1 }
        })],
        ['logRuntime', () => store.logRuntime('phase2-quarantine-write', { accepted: true })],
        ['deleteByClass', () => store.deleteByClass('D1')]
      ].flatMap(([name, write]) => {
        try {
          ;(write as () => unknown)()
          return [name]
        } catch {
          return []
        }
      })
      expect(accepted).toEqual([])
    })

    it('returns unavailable at the bounded 500-event limit and requires an explicit full audit', async () => {
      const path = join(scratch('bounded-integrity'), 'passport.db')
      const { store } = open(path, 10_000)
      enablePersistence(store)
      for (let index = 1; index <= 501; index += 1) {
        store.persistPassport(passport(), event(index))
      }

      expect(store.verifyActiveStint('stint-1')).toMatchObject({
        state: 'unavailable',
        verified: false,
        scope: 'bounded',
        checkedEvents: 0,
        totalEvents: 501
      })
      expect(await store.runFullAudit()).toMatchObject({
        state: 'anchored',
        verified: true,
        scope: 'full',
        checkedEvents: 501,
        totalEvents: 501
      })
    }, 60_000)

    it('[spec-gap] requires an independently trusted anchor before full audit is trustworthy', async () => {
      const path = join(scratch('trusted-anchor'), 'passport.db')
      const { store } = open(path, 10_000)
      enablePersistence(store)
      store.persistPassport(passport(), event(1))

      const audit = await store.runFullAudit()
      expect(Boolean(audit.verified)).toBe(true)
      expect(audit.message).toMatch(/trusted (signature|anchor)/i)
    })
  })

  describe('PassportStore Phase 2 export limits and secrets', () => {
    it('authenticates bounded same-installation imports and rejects tampering or foreign signers', () => {
      const sourcePath = join(scratch('signed-import-source'), 'passport.db')
      const { store: source } = open(sourcePath, 10_000)
      source.setPrivacy({
        ...DEFAULT_PASSPORT_PRIVACY,
        identityPersistenceOptIn: true,
        updatedAt: 10_000
      })
      source.persistPassport(passport('signed-import'), event(1, 'signed-import', 'signed-import'))
      const bundle = source.exportPackage('pseudonymized')

      expect(source.verifyImportPackage(bundle)).toEqual(bundle)

      const hashTampered = structuredClone(bundle)
      hashTampered.profile = 'race-only'
      expect(() => source.verifyImportPackage(hashTampered)).toThrow(/hash|signer/i)

      const signatureTampered = structuredClone(bundle)
      signatureTampered.packageSignature = `${bundle.packageSignature.slice(0, -1)}${
        bundle.packageSignature.endsWith('0') ? '1' : '0'
      }`
      expect(() => source.verifyImportPackage(signatureTampered)).toThrow(/signature/i)

      const { store: foreign } = open(
        join(scratch('signed-import-foreign'), 'passport.db'),
        10_000
      )
      expect(() => foreign.verifyImportPackage(bundle)).toThrow(/hash|signer/i)
    })

    it('rejects oversized, excessively deep, cyclic, and malformed import collections', () => {
      const { store } = open(join(scratch('bounded-import'), 'passport.db'), 10_000)
      const bundle = store.exportPackage('race-only')

      expect(() => store.verifyImportPackage({
        ...bundle,
        canonicalEvents: Array.from({ length: 501 }, () => ({}))
      })).toThrow(/bounded|collections/i)

      let nested: Record<string, unknown> = {}
      const root = nested
      for (let depth = 0; depth < 34; depth += 1) {
        nested.next = {}
        nested = nested.next as Record<string, unknown>
      }
      expect(() => store.verifyImportPackage({ ...bundle, nested: root })).toThrow(/depth/i)

      const cyclic = { ...bundle } as typeof bundle & { self?: unknown }
      cyclic.self = cyclic
      expect(() => store.verifyImportPackage(cyclic)).toThrow(/cyclic/i)

      expect(() => store.verifyImportPackage({
        ...bundle,
        passports: [{}]
      })).toThrow(/hash|identity|contract/i)
    })

    it('exports an empty package deterministically with bounded empty collections', () => {
      const { store } = open(join(scratch('empty-export'), 'passport.db'), 10_000)
      const first = store.exportPackage('race-only')
      const second = store.exportPackage('race-only')

      expect(first).toMatchObject({
        profile: 'race-only',
        generatedAt: 0,
        passports: [],
        roster: [],
        canonicalEvents: [],
        deletionTombstones: []
      })
      expect(first.packageHash).toMatch(/^[a-f0-9]{64}$/)
      expect(second).toEqual(first)
    })

    it('caps passports at 500, omits the oldest 501st, and hashes canonical content deterministically', () => {
      const path = join(scratch('passport-export-cap'), 'passport.db')
      const { store } = open(path, 10_000)
      enablePersistence(store)
      for (let index = 0; index <= 500; index += 1) {
        const stintId = `export-stint-${index}`
        store.persistPassport(
          passport(stintId, 1_000 + index),
          event(index + 1, `export-key-${index}`, stintId)
        )
      }

      const first = store.exportPackage('full-local')
      const second = store.exportPackage('full-local')
      expect(first.passports).toHaveLength(500)
      expect(first.passports.map((item) => item.identity.stintId)).not.toContain('export-stint-0')
      expect(first.passports.map((item) => item.identity.stintId)).toContain('export-stint-500')
      expect(second).toEqual(first)

      store.persistPassport({
        ...passport('export-stint-500', 1_500),
        lifecycle: 'closed',
        closedAt: 9_000,
        closeReason: 'manual',
        revision: 2
      }, event(502, 'export-key-meaningful-change', 'export-stint-500'))
      const changed = store.exportPackage('full-local')
      expect(changed.passports).toHaveLength(500)
      expect(changed.packageHash).not.toBe(first.packageHash)
      expect(changed.generatedAt).toBe(9_000)
    }, 60_000)

    it('[spec-gap] applies an explicit 500-event ceiling before materializing an export package', () => {
      const path = join(scratch('event-export-cap'), 'passport.db')
      const { store } = open(path, 10_000)
      enablePersistence(store)
      for (let index = 1; index <= 501; index += 1) {
        store.persistPassport(passport(), event(index))
      }

      const exported = store.exportPackage('race-only')
      expect(exported.canonicalEvents.length).toBeLessThanOrEqual(500)
      expect(JSON.stringify(exported).length).toBeLessThanOrEqual(5_000_000)
    }, 60_000)

    it('[spec-gap] excludes repair tokens, mutation capabilities, challenge secrets, and raw identity from every profile', () => {
      const path = join(scratch('export-secrets'), 'passport.db')
      const { store } = open(path, 10_000)
      enablePersistence(store)
      const secretEvent = event(1, 'secret-export-event')
      secretEvent.canonicalEvent.capabilityRef = 'PHASE2-MUTATION-CAPABILITY-SECRET'
      secretEvent.canonicalEvent.approvalRef = 'PHASE2-CHALLENGE-NONCE-SECRET'
      store.persistPassport(passport(), secretEvent)
      const attacker = new DatabaseSync(path)
      attacker.prepare("UPDATE passport_event SET payload_json = '{\"forged\":true}'").run()
      attacker.close()
      const repairToken = store.verifyActiveStint('stint-1').repairToken!

      const packages = (['full-local', 'pseudonymized', 'race-only'] as const)
        .map((profile) => JSON.stringify(store.exportPackage(profile)))
      const forbidden = [
        repairToken,
        'PHASE2-MUTATION-CAPABILITY-SECRET',
        'PHASE2-CHALLENGE-NONCE-SECRET',
        'driver-1',
        'Alice',
        'Team Alpha'
      ]
      const leaks = forbidden.filter((secret) => packages.some((value) => value.includes(secret)))
      expect(leaks).toEqual([])
    })
  })

  it('deletes all D3 identity state atomically and leaves an anchored tombstone chain', () => {
    const { store } = open(join(scratch('retention'), 'passport.db'), 1_000)
    store.setPrivacy({ ...DEFAULT_PASSPORT_PRIVACY, identityPersistenceOptIn: true, updatedAt: 0 })
    const first = {
      ...passport('stint-a', 100),
      lifecycle: 'closed' as const,
      closedAt: 200,
      closeReason: 'manual' as const
    }
    const second = passport('stint-b', 300)
    store.persistPassport(first, event(1, 'a-1', 'stint-a'))
    store.persistPassport(second, event(2, 'b-1', 'stint-b'))

    const result = store.deleteByClass('D3')
    expect(result.deletedStints).toBe(2)
    expect(store.getPassport('stint-a')).toBeNull()
    expect(store.getPassport('stint-b')).toBeNull()
    expect(store.getPrivacy().identityPersistenceOptIn).toBe(false)
    expect(store.exportPackage('race-only').deletionTombstones.length).toBeGreaterThan(0)
    expect(store.getIntegrity()).toMatchObject({
      state: 'anchored',
      verified: true
    })
  })

  it('redacts class-scoped evidence without creating broken surviving references', () => {
    const path = join(scratch('class-retention'), 'passport.db')
    const { store } = open(path, 1_000)
    store.setPrivacy({ ...DEFAULT_PASSPORT_PRIVACY, identityPersistenceOptIn: true, updatedAt: 0 })
    const data = passport()
    data.items = data.items.map((item) =>
      passportItemDataClass(item.id) === 'D2'
        ? { ...item, owner: undefined, reasonCode: undefined }
        : item
    )
    store.persistPassport(data, event(1))
    const result = store.deleteByClass('D2')
    expect(result.redactedEvidence).toBeGreaterThan(0)
    expect(store.getPassport('stint-1')?.items.some((item) =>
      passportItemDataClass(item.id) === 'D2' && item.evidence !== undefined
    )).toBe(false)
    expect(store.verifyActiveStint('stint-1')).toMatchObject({
      state: 'anchored',
      verified: true
    })
    const db = new DatabaseSync(path)
    const redacted = db.prepare(`
      SELECT COUNT(*) AS count FROM passport_event
      WHERE payload_state = 'retention-redacted' AND payload_json IS NULL
    `).get() as { count: number }
    db.close()
    expect(redacted.count).toBeGreaterThan(0)
  })

  it('deletes D1 queue/runtime diagnostics through the same data-class control', () => {
    const { store } = open(join(scratch('d1-runtime'), 'passport.db'), 1_000)
    store.logRuntime('tap-overflow', { dropped: 3 })
    const result = store.deleteByClass('D1')
    expect(result.redactedEvidence).toBeGreaterThan(0)
  })

  it('uses evidence capturedAt rather than mutable verification time for retention', () => {
    const opened = open(join(scratch('captured-at'), 'passport.db'), 2 * 86_400_000)
    const { store } = opened
    store.setPrivacy({
      ...DEFAULT_PASSPORT_PRIVACY,
      identityPersistenceOptIn: true,
      retentionDays: { D1: 90, D2: 1, D3: 7 },
      updatedAt: 0
    })
    const data = passport()
    data.items = data.items.map((item) =>
      passportItemDataClass(item.id) === 'D2'
        ? {
            ...item,
            owner: undefined,
            verifiedAt: 2 * 86_400_000,
            evidence: item.evidence ? { ...item.evidence, capturedAt: 1 } : undefined
          }
        : item
    )
    store.persistPassport(data, event(1))
    store.purgeRetention(2 * 86_400_000)
    expect(store.getPassport('stint-1')?.items.some((item) =>
      passportItemDataClass(item.id) === 'D2' && item.evidence !== undefined
    )).toBe(false)
  })

  it('reports tampered event content as corrupt only during bounded or explicit audit', async () => {
    const path = join(scratch('corrupt'), 'passport.db')
    const { store } = open(path, 1_000)
    store.setPrivacy({ ...DEFAULT_PASSPORT_PRIVACY, identityPersistenceOptIn: true, updatedAt: 0 })
    store.persistPassport(passport(), event(1))
    const db = new DatabaseSync(path)
    db.prepare("UPDATE passport_event SET payload_json = '{\"tampered\":true}'").run()
    db.close()

    expect(store.getIntegrity().state).toBe('anchored')
    const corrupted = store.verifyActiveStint('stint-1')
    expect(corrupted.state).toBe('corrupt')
    expect(corrupted.repairToken).toBeTruthy()
    expect(store.validateRepairToken(corrupted.repairToken!)).toBe(true)
    expect(store.validateRepairToken('wrong')).toBe(false)
    expect((await store.runFullAudit()).state).toBe('corrupt')
    expect(() => store.persistPassport(passport(), event(2))).toThrow(/quarantined/i)
    store.close()
    stores.splice(stores.indexOf(store), 1)
    const reopened = open(path, 2_000).store
    expect(reopened.getIntegrity()).toMatchObject({ state: 'corrupt', verified: false })
    expect(() => reopened.persistPassport(passport(), event(3))).toThrow(/quarantined/i)
  })

  it('detects mutable Passport item tampering through the event state hash', () => {
    const path = join(scratch('item-corrupt'), 'passport.db')
    const { store } = open(path, 1_000)
    store.setPrivacy({ ...DEFAULT_PASSPORT_PRIVACY, identityPersistenceOptIn: true, updatedAt: 0 })
    store.persistPassport(passport(), event(1))
    const db = new DatabaseSync(path)
    db.prepare("UPDATE passport_item SET detail = 'tampered item' WHERE item_id = 'fuel-load'").run()
    db.close()
    expect(store.verifyActiveStint('stint-1')).toMatchObject({
      state: 'corrupt',
      verified: false
    })
  })

  function passportItemDataClass(itemId: PassportItem['id']): 'D1' | 'D2' | 'D3' {
    return PASSPORT_ITEM_DEFINITIONS.find((definition) => definition.id === itemId)?.dataClass ?? 'D2'
  }

  it('redacts driver, team, role owner, and evidence acknowledgements in portable exports', () => {
    const path = join(scratch('redaction'), 'passport.db')
    const { store } = open(path, 1_000)
    store.setPrivacy({ ...DEFAULT_PASSPORT_PRIVACY, identityPersistenceOptIn: true, updatedAt: 0 })
    store.saveRoster([
      { memberId: 'driver-1', displayName: 'Alice', roles: ['driver'], active: true },
      { memberId: 'engineer-1', displayName: 'Engineer Bob', roles: ['engineer'], active: true }
    ])
    store.persistPassport(passport(), event(1))
    const classificationDb = new DatabaseSync(path)
    const leakedOwners = classificationDb.prepare(`
      SELECT COUNT(*) AS count FROM passport_item
      WHERE data_class IN ('D1', 'D2') AND owner_json IS NOT NULL
    `).get() as { count: number }
    classificationDb.close()
    expect(leakedOwners.count).toBe(0)

    const pseudonymized = JSON.stringify(store.exportPackage('pseudonymized'))
    expect(pseudonymized).not.toContain('Alice')
    expect(pseudonymized).not.toContain('Team Alpha')
    expect(pseudonymized).not.toContain('driver-1')
    expect(pseudonymized).not.toContain('engineer-1')
    expect(pseudonymized).toMatch(/Driver [A-F0-9]{8}/)

    const raceOnly = JSON.stringify(store.exportPackage('race-only'))
    expect(raceOnly).not.toContain('Acknowledged by Alice')
    expect(raceOnly).toContain('[member redacted]')
  })
})
