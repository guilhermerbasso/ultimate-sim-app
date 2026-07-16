import { mkdirSync, rmSync } from 'node:fs'
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
import { PassportStore } from './store'

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
    persisted: false
  }
}

function event(index: number) {
  return {
    eventType: 'ultimate.sim.raceops.passport.item-updated.v1',
    dedupeKey: `event-${index}`,
    dataClass: 'D2' as const,
    payload: { index }
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
    expect(store.getIntegrity()).toMatchObject({ state: 'unanchored', verified: false, scope: 'incremental' })

    const audit = await store.runFullAudit()
    expect(audit).toMatchObject({ state: 'unanchored', verified: false, scope: 'full', checkedEvents: 200 })
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

  it('deletes one closed stint without breaking another stint integrity chain', () => {
    const { store } = open(join(scratch('retention'), 'passport.db'), 1_000)
    store.setPrivacy({ ...DEFAULT_PASSPORT_PRIVACY, identityPersistenceOptIn: true, updatedAt: 0 })
    const first = {
      ...passport('stint-a', 100),
      lifecycle: 'closed' as const,
      closedAt: 200,
      closeReason: 'manual' as const
    }
    const second = passport('stint-b', 300)
    store.persistPassport(first, { ...event(1), dedupeKey: 'a-1' })
    store.persistPassport(second, { ...event(2), dedupeKey: 'b-1' })

    const result = store.deleteByClass('D3')
    expect(result.deletedStints).toBe(1)
    expect(store.getPassport('stint-a')).toBeNull()
    expect(store.verifyActiveStint('stint-b')).toMatchObject({
      state: 'unanchored',
      verified: false
    })
  })

  it('redacts class-scoped evidence without creating broken surviving references', () => {
    const { store } = open(join(scratch('class-retention'), 'passport.db'), 1_000)
    store.setPrivacy({ ...DEFAULT_PASSPORT_PRIVACY, identityPersistenceOptIn: true, updatedAt: 0 })
    store.persistPassport(passport(), event(1))
    const result = store.deleteByClass('D2')
    expect(result.redactedEvidence).toBeGreaterThan(0)
    expect(store.getPassport('stint-1')?.items.some((item) =>
      passportItemDataClass(item.id) === 'D2' && item.evidence !== undefined
    )).toBe(false)
    expect(store.verifyActiveStint('stint-1')).toMatchObject({
      state: 'unanchored',
      verified: false
    })
  })

  it('deletes D1 queue/runtime diagnostics through the same data-class control', () => {
    const { store } = open(join(scratch('d1-runtime'), 'passport.db'), 1_000)
    store.logRuntime('tap-overflow', { dropped: 3 })
    const result = store.deleteByClass('D1')
    expect(result.redactedEvidence).toBeGreaterThan(0)
  })

  it('reports tampered event content as corrupt only during bounded or explicit audit', async () => {
    const path = join(scratch('corrupt'), 'passport.db')
    const { store } = open(path, 1_000)
    store.setPrivacy({ ...DEFAULT_PASSPORT_PRIVACY, identityPersistenceOptIn: true, updatedAt: 0 })
    store.persistPassport(passport(), event(1))
    const db = new DatabaseSync(path)
    db.prepare("UPDATE passport_event SET payload_json = '{\"tampered\":true}'").run()
    db.close()

    expect(store.getIntegrity().state).toBe('unanchored')
    expect(store.verifyActiveStint('stint-1').state).toBe('corrupt')
    expect((await store.runFullAudit()).state).toBe('corrupt')
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
    const { store } = open(join(scratch('redaction'), 'passport.db'), 1_000)
    store.setPrivacy({ ...DEFAULT_PASSPORT_PRIVACY, identityPersistenceOptIn: true, updatedAt: 0 })
    store.saveRoster([
      { memberId: 'driver-1', displayName: 'Alice', roles: ['driver'], active: true },
      { memberId: 'engineer-1', displayName: 'Engineer Bob', roles: ['engineer'], active: true }
    ])
    store.persistPassport(passport(), event(1))

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
