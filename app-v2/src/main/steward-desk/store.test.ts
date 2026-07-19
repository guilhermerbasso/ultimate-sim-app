import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  StewardActor,
  StewardCase,
  StewardCaseCreateInput,
  StewardEvidenceLockInput,
  StewardExportBundle,
  StewardRuleCitation,
  StewardHumanVerdict
} from '../../shared/steward-desk'
import type { IncidentClip } from '../../shared/incidents'
import {
  IncidentClipStore,
  type IncidentClipIntegrityCodec,
  type VerifiedIncidentClip
} from '../incidents/clip-store'
import {
  StewardCaseStore,
  parseStewardExportBundle,
  serializeStewardExportBundle
} from './store'
import { normalizeThirdPartyImportMetadata } from '../../shared/third-party-dashboard-catalog'
import { PACKAGE_MAX_CANONICAL_BYTES, canonicalStringify, sha256Canonical } from './canonical'

const roots: string[] = []
const storeRoots = new WeakMap<StewardCaseStore, string>()

class TestClipCodec implements IncidentClipIntegrityCodec {
  available(): boolean {
    return true
  }

  seal(plainText: string): Buffer {
    return Buffer.from(plainText, 'utf8')
  }

  open(sealed: Buffer): string {
    return sealed.toString('utf8')
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const steward: StewardActor = {
  id: 'steward-1',
  displayName: 'Morgan Steward',
  role: 'steward'
}
const participant: StewardActor = {
  id: 'participant-7',
  displayName: 'Alice Racer',
  role: 'participant'
}

function harness(
  name: string,
  initialNow = 1_000,
  importFault?: (stage: 'after-evidence' | 'after-stage-write' | 'before-publish') => void
): {
  root: string
  store: StewardCaseStore
  setNow(value: number): void
} {
  const root = join(process.cwd(), `.steward-store-${name}-${process.pid}-${roots.length}`)
  mkdirSync(root, { recursive: true })
  roots.push(root)
  let now = initialNow
  let ids = 0
  const store = new StewardCaseStore({
    rootDir: root,
    now: () => now,
    idFactory: () => `id-${++ids}`,
    importFault
  })
  storeRoots.set(store, root)
  return {
    root,
    store,
    setNow(value: number) {
      now = value
    }
  }
}

function caseInput(sourceId = 'inc-42'): StewardCaseCreateInput {
  return {
    title: 'Turn 1 contact review',
    actor: steward,
    assignedTo: steward,
    identity: {
      leagueId: 'league-private',
      leagueName: 'Private GT League',
      eventId: 'round-4',
      eventName: 'Spa 90',
      sessionId: 'session-secret-2026-07-17',
      sim: 'iRacing',
      sessionType: 'Race',
      trackName: 'Spa-Francorchamps',
      startedAt: 500
    },
    incident: {
      source: 'manual',
      sourceId,
      label: 'Contact at La Source — Alice Racer',
      occurredAt: 900,
      sessionTimeSec: 125.4,
      lap: 1,
      lapDistPct: 0.03,
      replayFrame: 842,
      windowBeforeSec: 4,
      windowAfterSec: 3,
      notes: 'Alice Racer and Team Crimson made contact.'
    }
  }
}

function evidenceInput(caseId: string): StewardEvidenceLockInput {
  return {
    caseId,
    actor: steward,
    summary: 'Local document evidence for Alice Racer',
    mediaType: 'application/json',
    content: {
      driverName: 'Alice Racer',
      teamName: 'Team Crimson',
      producer: 'Morgan Steward Recorder',
      sessionId: 'session-secret-2026-07-17',
      exactTimestamp: 1_752_000_000_123,
      samples: [{ t: 900, speedKmh: 121 }, { t: 901, speedKmh: 72 }],
      opaqueComment: 'unlisted.person@example.test',
      note: 'Alice Racer was alongside Morgan Steward at 2026-07-17T12:34:56.789Z.'
    },
    provenance: {
      sourceKind: 'document',
      sourceRef: 'local-evidence.json',
      producer: 'Morgan Steward Recorder',
      producerVersion: '2.53.1',
      capturedAt: 900,
      sessionRef: 'session-secret-2026-07-17',
      captureRange: '896-903',
      transform: 'none',
      notes: 'Captured by Morgan Steward at 2026-07-17T12:34:56.789Z.'
    }
  }
}

function incidentClip(
  captureSessionId = 'session-secret-2026-07-17',
  id = 'inc-42'
): IncidentClip {
  return {
      id,
      type: 'contact',
      severity: 'moderate',
      at: 900,
      lap: 1,
      lapDistPct: 0.03,
      metrics: { speedKmh: 121, speedDropKmh: 49 },
      summary: 'Alice Racer and Team Crimson contact; unlisted.person@example.test',
      window: [{ t: 900, speedKmh: 121 }, { t: 901, speedKmh: 72 }],
      triggerIndex: 0,
      createdAt: 900,
      captureSession: {
        schemaVersion: 1,
        captureSessionId,
        sim: 'iracing',
        startedAt: 500,
        lifecycleGeneration: 1,
        sessionUniqueId: 4242,
        sessionNumber: 0,
        sessionType: 'Race',
        trackName: 'Spa-Francorchamps'
      }
  }
}

function verifiedIncident(store: StewardCaseStore, clip = incidentClip()): VerifiedIncidentClip {
  const root = storeRoots.get(store)
  if (!root) throw new Error('Missing test store root.')
  const clips = new IncidentClipStore(join(root, 'verified-clips'), new TestClipCodec())
  return clips.save(clip)
}

function seedDecision(store: StewardCaseStore, current: StewardCase): {
  current: StewardCase
  evidenceId: string
  rule: StewardRuleCitation
  verdict: StewardHumanVerdict
} {
  let next = store.lockIncidentClip(current.caseId, steward, verifiedIncident(store))
  const evidenceId = next.evidence[0].evidenceId
  next = store.citeRule({
    caseId: next.caseId,
    actor: steward,
    rulesetId: 'gt-code',
    version: '2026.1',
    section: '4.2',
    title: 'Overlap at corner entry',
    text: 'Alice Racer must establish overlap before turn-in.',
    source: 'file:///league/private-rules.pdf'
  })
  const rule = next.rules[0]
  next = store.recordVerdict({
    caseId: next.caseId,
    actor: steward,
    finding: 'breach',
    decisionText: 'Human steward found avoidable contact after reviewing the locked clip.',
    actionText: 'Manual league action: review with the chief steward.',
    ruleCitationIds: [rule.citationId],
    evidenceIds: [evidenceId],
    manualReviewConfirmed: true
  })
  return { current: next, evidenceId, rule, verdict: next.verdicts[0] }
}

function rehashPackage(bundle: StewardExportBundle): StewardExportBundle {
  const clone = JSON.parse(JSON.stringify(bundle)) as StewardExportBundle
  const { packageHash: _packageHash, ...unsigned } = clone
  clone.packageHash = sha256Canonical(unsigned, PACKAGE_MAX_CANONICAL_BYTES)
  return clone
}

function rehashEventChain(bundle: StewardExportBundle): StewardExportBundle {
  const clone = JSON.parse(JSON.stringify(bundle)) as StewardExportBundle
  let previousHash = '0'.repeat(64)
  for (const event of clone.events) {
    event.previousHash = previousHash
    const { eventHash: _eventHash, ...unsigned } = event
    event.eventHash = sha256Canonical(unsigned)
    previousHash = event.eventHash
  }
  clone.source.eventCount = clone.events.length
  clone.source.headHash = previousHash
  return rehashPackage(clone)
}

function rewriteStoredVerdictAsLegacy(
  root: string,
  store: StewardCaseStore,
  caseId: string
): { path: string; bytes: string } {
  const path = join(root, 'cases', store.caseFileName(caseId))
  const records = readFileSync(path, 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  const verdictRecord = records.find((entry) => entry.type === 'human-verdict-recorded')
  const payload = verdictRecord?.payload as { verdict?: Record<string, unknown> } | undefined
  if (!payload?.verdict) throw new Error('Missing verdict event in test chain.')
  delete payload.verdict.manualReviewConfirmed
  let previousHash = '0'.repeat(64)
  for (const record of records) {
    record.previousHash = previousHash
    const { eventHash: _eventHash, ...unsigned } = record
    record.eventHash = sha256Canonical(unsigned)
    previousHash = record.eventHash as string
  }
  const bytes = `${records.map((entry) => JSON.stringify(entry)).join('\n')}\n`
  writeFileSync(path, bytes, 'utf8')
  return { path, bytes }
}

function rewriteActorClaims(value: unknown, actor: StewardActor): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => rewriteActorClaims(entry, actor))
    return
  }
  if (!value || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  if (
    typeof record.id === 'string' &&
    typeof record.displayName === 'string' &&
    typeof record.role === 'string'
  ) {
    record.id = actor.id
    record.displayName = actor.displayName
    record.role = actor.role
    delete record.claimedRole
  }
  Object.values(record).forEach((entry) => rewriteActorClaims(entry, actor))
}

describe('StewardCaseStore', () => {
  it('quarantines corrupted locked evidence while keeping the local chain explicitly unanchored', () => {
    const test = harness('corrupt-evidence')
    let current = test.store.createCase(caseInput())
    current = test.store.lockEvidence(evidenceInput(current.caseId))
    expect(current.integrity).toMatchObject({
      state: 'unanchored',
      verified: false,
      chainValid: true,
      evidenceValid: true
    })

    writeFileSync(test.store.evidencePath(current.evidence[0].contentHash), '{"tampered":true}', 'utf8')
    const corrupted = test.store.getCase(current.caseId) as StewardCase
    expect(corrupted.integrity.state).toBe('evidence-corrupt')
    expect(corrupted.evidence[0].state).toBe('corrupt')
    expect(() => test.store.citeRule({
      caseId: current.caseId,
      actor: steward,
      rulesetId: 'gt-code',
      version: '2026.1',
      section: '4.2',
      title: 'Overlap',
      text: 'Rule text',
      source: 'local'
    })).toThrow(/quarantined/i)
  })

  it('preserves cited rule versions and keeps an earlier verdict bound to its original rule', () => {
    const test = harness('rule-versions')
    const seeded = seedDecision(test.store, test.store.createCase(caseInput()))
    test.setNow(2_000)
    const changed = test.store.citeRule({
      caseId: seeded.current.caseId,
      actor: steward,
      rulesetId: 'gt-code',
      version: '2026.2',
      section: '4.2',
      title: 'Overlap at corner entry',
      text: 'The revised rule requires axle overlap before the braking marker.',
      source: 'league-rules-2026.2.pdf'
    })
    expect(changed.rules.map((entry) => entry.version)).toEqual(['2026.1', '2026.2'])
    expect(changed.rules[0].contentHash).not.toBe(changed.rules[1].contentHash)
    expect(changed.verdicts[0].ruleCitationIds).toEqual([seeded.rule.citationId])
  })

  it('loads a pre-remediation verdict as legacy-unconfirmed without silently rewriting its chain', () => {
    const test = harness('legacy-load')
    const seeded = seedDecision(test.store, test.store.createCase(caseInput()))
    const legacy = rewriteStoredVerdictAsLegacy(test.root, test.store, seeded.current.caseId)

    const loaded = test.store.getCase(seeded.current.caseId) as StewardCase
    expect(loaded.integrity.state).toBe('unanchored')
    expect(loaded.status).toBe('under-review')
    expect(loaded.verdicts[0]).toMatchObject({
      authority: 'legacy-unconfirmed',
      manualReviewConfirmed: false
    })
    expect(loaded.manualReviewMigration).toEqual({
      reason: 'legacy-verdict-missing-native-confirmation',
      legacyVerdictIds: [loaded.verdicts[0].verdictId],
      pendingVerdictIds: [loaded.verdicts[0].verdictId],
      resolvedByVerdictIds: [],
      derivedFromCanonicalChain: true
    })

    const bundle = test.store.exportCase(loaded.caseId, 'full-local')
    expect(bundle.case.manualReviewMigration).toEqual(loaded.manualReviewMigration)
    expect(bundle.case.verdicts[0].manualReviewConfirmed).toBe(false)
    expect(readFileSync(legacy.path, 'utf8')).toBe(legacy.bytes)
  })

  it('round-trips legacy review provenance as an untrusted imported claim', () => {
    const source = harness('legacy-export')
    const seeded = seedDecision(source.store, source.store.createCase(caseInput()))
    rewriteStoredVerdictAsLegacy(source.root, source.store, seeded.current.caseId)
    const raw = serializeStewardExportBundle(source.store.exportCase(seeded.current.caseId, 'full-local'))

    const target = harness('legacy-import', 10_000)
    const imported = target.store.importCase(raw)
    expect(imported.status).toBe('under-review')
    expect(imported.verdicts[0]).toMatchObject({
      authority: 'imported-source-claim',
      manualReviewConfirmed: false
    })
    expect(imported.importProvenance?.sourceManualReviewMigration).toMatchObject({
      reason: 'legacy-verdict-missing-native-confirmation',
      pendingVerdictIds: [seeded.verdict.verdictId]
    })
  })

  it('denies legacy authority until an explicitly confirmed local re-adjudication supersedes it', () => {
    const test = harness('legacy-recovery')
    const seeded = seedDecision(test.store, test.store.createCase(caseInput()))
    rewriteStoredVerdictAsLegacy(test.root, test.store, seeded.current.caseId)
    let current = test.store.getCase(seeded.current.caseId) as StewardCase
    const legacyVerdict = current.verdicts[0]

    expect(() => test.store.fileAppeal({
      caseId: current.caseId,
      actor: participant,
      verdictId: legacyVerdict.verdictId,
      grounds: 'Legacy verdict must not be appeal-authoritative.',
      requestedRemedy: 'Re-adjudicate.'
    })).toThrow(/trusted re-adjudication/i)
    expect(() => test.store.setStatus({
      caseId: current.caseId,
      actor: steward,
      status: 'decided'
    })).toThrow(/trusted local re-adjudication/i)

    current = test.store.recordVerdict({
      caseId: current.caseId,
      actor: steward,
      finding: 'procedural',
      decisionText: 'Native-confirmed local re-adjudication of the legacy verdict.',
      ruleCitationIds: legacyVerdict.ruleCitationIds,
      evidenceIds: legacyVerdict.evidenceIds,
      supersedesVerdictId: legacyVerdict.verdictId,
      manualReviewConfirmed: true
    })
    expect(current.status).toBe('decided')
    expect(current.verdicts.at(-1)).toMatchObject({
      authority: 'local-trusted',
      manualReviewConfirmed: true,
      supersedesVerdictId: legacyVerdict.verdictId
    })
    expect(current.manualReviewMigration).toMatchObject({
      legacyVerdictIds: [legacyVerdict.verdictId],
      pendingVerdictIds: [],
      resolvedByVerdictIds: [current.verdicts.at(-1)?.verdictId]
    })
    const casePath = join(test.root, 'cases', test.store.caseFileName(current.caseId))
    const lastRecord = JSON.parse(readFileSync(casePath, 'utf8').trim().split(/\r?\n/).at(-1)!) as {
      payload: { verdict: { manualReviewConfirmed: boolean } }
    }
    expect(lastRecord.payload.verdict.manualReviewConfirmed).toBe(true)
  })

  it('rejects duplicate primary incidents and idempotently ignores a duplicate bookmark', () => {
    const test = harness('duplicates')
    const current = test.store.createCase(caseInput())
    const equivalent = caseInput('inc-recaptured-with-a-new-volatile-id')
    equivalent.identity.leagueId = ' LEAGUE-PRIVATE '
    equivalent.identity.eventId = 'ROUND-4'
    equivalent.identity.sessionId = 'SESSION-SECRET-2026-07-17'
    equivalent.incident.occurredAt = 9_999_999
    equivalent.incident.sessionTimeSec = 125.44
    expect(() => test.store.createCase(equivalent)).toThrow(/duplicate incident/i)
    const before = current.history.length
    const duplicate = test.store.addBookmark({
      caseId: current.caseId,
      actor: steward,
      bookmark: caseInput().incident
    })
    expect(duplicate.bookmarks).toHaveLength(1)
    expect(duplicate.history).toHaveLength(before)

    const manual = caseInput('volatile-manual-1')
    manual.incident.source = 'manual'
    manual.incident.label = 'Manual turn one contact'
    manual.incident.sessionTimeSec = 200
    test.store.createCase(manual)
    const retriedManual = caseInput('volatile-manual-2')
    retriedManual.incident.source = 'manual'
    retriedManual.incident.label = '  MANUAL   TURN ONE CONTACT '
    retriedManual.incident.sessionTimeSec = 200.04
    retriedManual.incident.occurredAt = 123_456
    expect(() => test.store.createCase(retriedManual)).toThrow(/duplicate incident/i)
  })

  it('redacts identities, exact session references, locators, and sensitive evidence fields', () => {
    const exactNow = 1_752_000_000_000
    const test = harness('redaction', exactNow)
    const seeded = seedDecision(test.store, test.store.createCase(caseInput()))
    expect(seeded.current.evidence[0].provenance.trust).toBe('local-user-sealed')
    expect(seeded.verdict.manualReviewConfirmed).toBe(true)
    const withDissent = test.store.recordDissent({
      caseId: seeded.current.caseId,
      actor: participant,
      verdictId: seeded.verdict.verdictId,
      statement: 'Alice Racer disagrees with Morgan Steward.',
      grounds: 'Team Crimson believes the private session clip was incomplete; contact hidden.case@example.test.'
    })
    const appealed = test.store.fileAppeal({
      caseId: withDissent.caseId,
      actor: participant,
      verdictId: seeded.verdict.verdictId,
      grounds: 'Alice Racer requests a second review.',
      requestedRemedy: 'Re-open the case for Team Crimson.'
    })

    const bundle = test.store.exportCase(seeded.current.caseId, 'anonymized')
    const serialized = serializeStewardExportBundle(bundle)
    for (const secret of [
      'Alice Racer',
      'Morgan Steward',
      'Team Crimson',
      'Private GT League',
      'session-secret-2026-07-17',
      'Morgan Steward Recorder',
      'incident-clips/inc-42.json',
      'file:///league/private-rules.pdf',
      '2026-07-17T12:34:56.789Z',
      'unlisted.person@example.test',
      'hidden.case@example.test',
      String(exactNow)
    ]) {
      expect(serialized).not.toContain(secret)
    }
    for (const internalId of [
      seeded.current.caseId,
      seeded.evidenceId,
      seeded.rule.citationId,
      seeded.verdict.verdictId,
      withDissent.dissents[0].dissentId,
      appealed.appeals[0].appealId
    ]) {
      expect(serialized).not.toContain(internalId)
    }
    expect(bundle.source.integrityState).toBe('unanchored')
    expect(bundle.exportedAt).toBe(0)
    expect(bundle.redactions.length).toBeGreaterThan(0)
    expect(bundle.evidence[0].content).toMatchObject({
      schemaVersion: 1,
      kind: 'incident-telemetry',
      incidentType: 'contact',
      severity: 'moderate',
      occurredAt: 0,
      samples: [{ t: 0 }, { t: 0 }],
      captureSession: {
        captureSessionId: bundle.case.identity.sessionId
      }
    })
    expect(bundle.evidence[0].content).not.toHaveProperty('opaqueComment')
    expect(bundle.evidence[0].content).not.toHaveProperty('summary')
    expect(bundle.case.evidence[0].provenance).toMatchObject({
      producer: 'producer-redacted',
      capturedAt: 0,
      captureRange: '[normalized]'
    })
    expect(parseStewardExportBundle(serialized).packageHash).toBe(bundle.packageHash)
  })

  it('preserves steward, chief-steward, and league-admin role distinctions during anonymization', () => {
    const test = harness('role-anonymization')
    const chief: StewardActor = {
      id: steward.id,
      displayName: 'Chief Steward',
      role: 'chief-steward'
    }
    const admin: StewardActor = {
      id: steward.id,
      displayName: 'League Admin',
      role: 'league-admin'
    }
    let current = seedDecision(test.store, test.store.createCase(caseInput())).current
    current = test.store.assignCase({ caseId: current.caseId, actor: steward, assignedTo: chief })
    current = test.store.citeRule({
      caseId: current.caseId,
      actor: admin,
      rulesetId: 'admin-code',
      version: '1',
      section: '1',
      title: 'Administrative rule',
      text: 'Administrative rule text.',
      source: 'local'
    })

    const bundle = test.store.exportCase(current.caseId, 'anonymized')
    const actors = [
      bundle.case.createdBy,
      bundle.case.assignedTo!,
      ...bundle.case.rules.map((entry) => entry.citedBy)
    ]
    expect(new Set(actors.map((entry) => entry.role))).toEqual(
      new Set(['steward', 'chief-steward', 'league-admin'])
    )
    expect(new Set(actors.map((entry) => entry.id)).size).toBeGreaterThanOrEqual(3)
  })

  it('keeps dissent and appeal resolution history without automatically changing the human verdict', () => {
    const test = harness('appeal-history')
    const seeded = seedDecision(test.store, test.store.createCase(caseInput()))
    let current = test.store.recordDissent({
      caseId: seeded.current.caseId,
      actor: participant,
      verdictId: seeded.verdict.verdictId,
      statement: 'The participant disputes the finding.',
      grounds: 'Alternative replay angle.'
    })
    current = test.store.fileAppeal({
      caseId: current.caseId,
      actor: participant,
      verdictId: seeded.verdict.verdictId,
      grounds: 'The cited evidence omitted the exit angle.',
      requestedRemedy: 'Remand for a second human review.'
    })
    for (const status of ['triage', 'under-review', 'decided', 'closed'] as const) {
      expect(() => test.store.setStatus({
        caseId: current.caseId,
        actor: steward,
        status
      })).toThrow(/derived as appealed/i)
    }
    expect(current.status).toBe('appealed')
    const appealId = current.appeals[0].appealId
    current = test.store.resolveAppeal({
      caseId: current.caseId,
      actor: steward,
      appealId,
      resolution: 'modified',
      reasoning: 'A new human verdict is required; no automatic penalty or verdict mutation was applied.'
    })
    expect(current.appeals[0]).toMatchObject({
      status: 'resolved',
      resolutions: [{ resolution: 'modified' }]
    })
    expect(current.status).toBe('decided')
    expect(current.verdicts).toHaveLength(1)

    current = test.store.recordVerdict({
      caseId: current.caseId,
      actor: steward,
      finding: 'procedural',
      decisionText: 'Chief steward recorded a replacement human decision after appeal.',
      ruleCitationIds: [seeded.rule.citationId],
      evidenceIds: [seeded.evidenceId],
      supersedesVerdictId: seeded.verdict.verdictId,
      manualReviewConfirmed: true
    })
    expect(current.verdicts).toHaveLength(2)
    expect(current.verdicts[1].supersedesVerdictId).toBe(seeded.verdict.verdictId)
  })

  it('round-trips export/import and rejects a package changed after hashing', () => {
    const source = harness('export-source')
    const seeded = seedDecision(source.store, source.store.createCase(caseInput()))
    source.store.fileAppeal({
      caseId: seeded.current.caseId,
      actor: participant,
      verdictId: seeded.verdict.verdictId,
      grounds: 'Please review the evidence again.',
      requestedRemedy: 'Second human review.'
    })
    const bundle = source.store.exportCase(seeded.current.caseId, 'full-local')
    const raw = serializeStewardExportBundle(bundle)
    expect(bundle.trustModel).toEqual({
      clipSeal: 'local-user-sealed',
      corruptionAndRendererTamperProtected: true,
      appOriginAuthenticated: false,
      sameUserProcessAuthenticity: false,
      authoritativeVerdictsRequireManualReview: true
    })
    expect(bundle.events).toHaveLength(bundle.source.eventCount)
    expect(bundle.events.at(-1)?.eventHash).toBe(bundle.source.headHash)

    const target = harness('export-target', 10_000)
    const imported = target.store.importCase(raw)
    expect(imported.importProvenance).toMatchObject({
      sourcePackageHash: bundle.packageHash,
      sourceHeadHash: bundle.source.headHash,
      profile: 'full-local'
    })
    expect(imported.evidence).toHaveLength(1)
    expect(imported.rules).toHaveLength(1)
    expect(imported.verdicts).toHaveLength(1)
    expect(imported.appeals).toHaveLength(1)
    expect(imported.status).toBe('under-review')
    expect(imported.verdicts[0].authority).toBe('imported-source-claim')
    expect(imported.appeals[0].authority).toBe('imported-source-claim')
    expect(imported.verdicts[0].manualReviewConfirmed).toBe(false)
    expect(imported.evidence[0].provenance.trust).toBe('imported-source-claim')
    expect(imported.integrity.state).toBe('unanchored')
    expect(imported.importCompleted).toBe(true)
    expect(imported.history.at(-1)?.type).toBe('import-completed')

    const secondTarget = harness('export-second-target', 20_000)
    const importedAgain = secondTarget.store.importCase(serializeStewardExportBundle(
      target.store.exportCase(imported.caseId, 'full-local')
    ))
    expect(importedAgain).toMatchObject({
      status: 'under-review',
      verdicts: [{ authority: 'imported-source-claim' }],
      appeals: [{ authority: 'imported-source-claim' }]
    })

    const duplicateImport = target.store.importCaseWithResult(raw)
    expect(duplicateImport).toMatchObject({
      deduplicated: true,
      retried: false,
      caseValue: { caseId: imported.caseId }
    })
    expect(target.store.listCases()).toHaveLength(1)

    const tampered = JSON.parse(raw) as Record<string, unknown>
    ;(tampered.case as Record<string, unknown>).title = 'Changed after export'
    expect(() => parseStewardExportBundle(JSON.stringify(tampered))).toThrow(/hash mismatch/i)

    const overstated = JSON.parse(raw) as StewardExportBundle
    ;(overstated.trustModel as { appOriginAuthenticated: boolean }).appOriginAuthenticated = true
    expect(() => harness('overstated-trust-target').store.importCase(
      serializeStewardExportBundle(rehashPackage(overstated))
    )).toThrow(/overstates local clip authenticity/i)

    const legacyV2 = JSON.parse(raw) as StewardExportBundle
    delete (legacyV2 as unknown as Record<string, unknown>).trustModel
    expect(harness('legacy-v2-trust-target').store.importCase(
      serializeStewardExportBundle(rehashPackage(legacyV2))
    ).importCompleted).toBe(true)
  })

  it('rejects rehashed packages whose event chain or case state is not canonical', () => {
    const source = harness('event-chain-source')
    const seeded = seedDecision(source.store, source.store.createCase(caseInput()))
    const original = source.store.exportCase(seeded.current.caseId, 'full-local')

    const brokenHash = JSON.parse(JSON.stringify(original)) as StewardExportBundle
    const verdictEvent = brokenHash.events.find((entry) => entry.type === 'human-verdict-recorded')!
    ;(verdictEvent.payload as { verdict: { decisionText: string } }).verdict.decisionText = 'Rehashed package-only tamper'
    const packageOnly = rehashPackage(brokenHash)
    expect(() => harness('event-chain-target').store.importCase(
      serializeStewardExportBundle(packageOnly)
    )).toThrow(/event hash mismatch/i)

    const inconsistent = JSON.parse(JSON.stringify(original)) as StewardExportBundle
    const changedVerdictEvent = inconsistent.events.find((entry) => entry.type === 'human-verdict-recorded')!
    ;(changedVerdictEvent.payload as { verdict: { decisionText: string } }).verdict.decisionText =
      'Canonical chain differs from the exported case projection.'
    const rehashed = rehashEventChain(inconsistent)
    expect(() => harness('event-state-target').store.importCase(
      serializeStewardExportBundle(rehashed)
    )).toThrow(/does not match its verified canonical event chain/i)
  })

  it('normalizes consistently forged imported decision actors to untrusted source claims', () => {
    const source = harness('forged-actor-source')
    const seeded = seedDecision(source.store, source.store.createCase(caseInput()))
    const bundle = source.store.exportCase(seeded.current.caseId, 'full-local')
    rewriteActorClaims(bundle.case, {
      id: 'forged-local-admin',
      displayName: 'Forged Race Director',
      role: 'league-admin'
    })
    rewriteActorClaims(bundle.events, {
      id: 'forged-local-admin',
      displayName: 'Forged Race Director',
      role: 'league-admin'
    })

    const target = harness('forged-actor-target', 10_000)
    let imported = target.store.importCase(serializeStewardExportBundle(rehashEventChain(bundle)))
    expect(imported).toMatchObject({
      status: 'under-review',
      createdBy: {
        id: 'steward-import',
        role: 'league-admin'
      }
    })
    expect(imported.verdicts[0]).toMatchObject({
      authority: 'imported-source-claim',
      manualReviewConfirmed: false,
      decidedBy: {
        role: 'source-claim',
        claimedRole: 'league-admin'
      }
    })
    expect(imported.verdicts[0].decidedBy.displayName).not.toContain('Forged Race Director')
    expect(imported.evidence[0].provenance.sourceKind).toBe('import')
    expect(imported.evidence[0].provenance.trust).toBe('imported-source-claim')
    expect(() => target.store.fileAppeal({
      caseId: imported.caseId,
      actor: participant,
      verdictId: imported.verdicts[0].verdictId,
      grounds: 'Attempt to treat a source claim as authoritative.',
      requestedRemedy: 'Reject.'
    })).toThrow(/local trusted re-adjudication/i)

    expect(() => target.store.recordVerdict({
      caseId: imported.caseId,
      actor: steward,
      finding: 'procedural',
      decisionText: 'Attempt without explicit provenance review.',
      ruleCitationIds: imported.verdicts[0].ruleCitationIds,
      evidenceIds: imported.verdicts[0].evidenceIds,
      supersedesVerdictId: imported.verdicts[0].verdictId
    })).toThrow(/manual review of evidence provenance/i)

    imported = target.store.recordVerdict({
      caseId: imported.caseId,
      actor: steward,
      finding: 'procedural',
      decisionText: 'A local trusted steward independently re-adjudicated the imported claim.',
      ruleCitationIds: imported.verdicts[0].ruleCitationIds,
      evidenceIds: imported.verdicts[0].evidenceIds,
      supersedesVerdictId: imported.verdicts[0].verdictId,
      manualReviewConfirmed: true
    })
    expect(imported.verdicts.at(-1)).toMatchObject({
      authority: 'local-trusted',
      manualReviewConfirmed: true,
      decidedBy: { role: 'steward' }
    })
    expect(imported.status).toBe('decided')
  })

  it('applies local verdict invariants identically to imported packages', () => {
    const source = harness('verdict-invariant-source')
    const seeded = seedDecision(source.store, source.store.createCase(caseInput()))
    const bundle = source.store.exportCase(seeded.current.caseId, 'full-local')
    bundle.case.verdicts[0].evidenceIds = []
    const verdictEvent = bundle.events.find((entry) => entry.type === 'human-verdict-recorded')!
    ;(verdictEvent.payload as { verdict: StewardHumanVerdict }).verdict.evidenceIds = []

    expect(() => harness('verdict-invariant-target').store.importCase(
      serializeStewardExportBundle(rehashEventChain(bundle))
    )).toThrow(/requires at least one locked evidence item/i)
  })

  it('rejects incident capture-session substitution and unverifiable incident cases', () => {
    const test = harness('capture-session')
    const unverifiedCreate = caseInput()
    unverifiedCreate.incident.source = 'incident-recorder'
    unverifiedCreate.incident.captureSessionId = unverifiedCreate.identity.sessionId
    expect(() => test.store.createCase(unverifiedCreate)).toThrow(/verified persisted clip/i)

    const current = test.store.createCase(caseInput())
    expect(() => test.store.lockIncidentClip(
      current.caseId,
      steward,
      verifiedIncident(test.store, incidentClip('capture-other-session', 'inc-other'))
    )).toThrow(/does not match the immutable steward case session/i)

    const unverifiedEvidence = evidenceInput(current.caseId)
    unverifiedEvidence.provenance.sourceKind = 'incident-recorder'
    expect(() => test.store.lockEvidence(unverifiedEvidence)).toThrow(/verified persisted clip/i)
    expect(() => test.store.addBookmark({
      caseId: current.caseId,
      actor: steward,
      bookmark: {
        source: 'incident-recorder',
        sourceId: 'renderer-forged',
        label: 'Forged recorder bookmark',
        captureSessionId: current.identity.sessionId,
        windowBeforeSec: 5,
        windowAfterSec: 5
      }
    })).toThrow(/verified persisted clip/i)
  })

  it('rejects undeclared free-form fields from anonymized evidence even after full rehashing', () => {
    const source = harness('anonymized-schema-source')
    const seeded = seedDecision(source.store, source.store.createCase(caseInput()))
    const bundle = source.store.exportCase(seeded.current.caseId, 'anonymized')
    const content = bundle.evidence[0].content as Record<string, unknown>
    content.freeFormLeak = 'person.not-in-source@example.test'
    const contentHash = sha256Canonical(content)
    bundle.evidence[0].contentHash = contentHash
    bundle.case.evidence[0].contentHash = contentHash
    bundle.case.evidence[0].byteLength = Buffer.byteLength(canonicalStringify(content), 'utf8')
    const evidenceEvent = bundle.events.find((entry) => entry.type === 'evidence-locked')!
    const eventEvidence = (evidenceEvent.payload as { evidence: StewardCase['evidence'][number] }).evidence
    eventEvidence.contentHash = contentHash
    eventEvidence.byteLength = bundle.case.evidence[0].byteLength

    expect(() => harness('anonymized-schema-target').store.importCase(
      serializeStewardExportBundle(rehashEventChain(bundle))
    )).toThrow(/undeclared field freeFormLeak/i)

    const freeFormCase = source.store.exportCase(seeded.current.caseId, 'anonymized')
    freeFormCase.case.verdicts[0].decisionText = 'person.not-in-source@example.test'
    const verdictEvent = freeFormCase.events.find((entry) => entry.type === 'human-verdict-recorded')!
    ;(verdictEvent.payload as { verdict: StewardHumanVerdict }).verdict.decisionText =
      'person.not-in-source@example.test'
    expect(() => harness('anonymized-case-schema-target').store.importCase(
      serializeStewardExportBundle(rehashEventChain(freeFormCase))
    )).toThrow(/anonymized verdict contains non-allowlisted free-form data/i)
  })

  it('blocks export of evidence whose third-party rights deny re-export', () => {
    const test = harness('rights-guard')
    let current = test.store.createCase(caseInput())
    current = test.store.lockEvidence({
      caseId: current.caseId,
      actor: steward,
      summary: 'Restricted third-party dashboard evidence',
      mediaType: 'application/json',
      content: {
        dashboard: {
          id: 'restricted-dashboard',
          thirdParty: normalizeThirdPartyImportMetadata({
            catalogEntryId: 'lovely-dashboard'
          }, 1_000)
        }
      },
      provenance: {
        sourceKind: 'document',
        sourceRef: 'local-dashboard-file',
        producer: 'Local steward',
        producerVersion: '1',
        capturedAt: 1_000,
        sessionRef: current.identity.sessionId
      }
    })

    expect(() => test.store.exportCase(current.caseId, 'full-local')).toThrow(/re-export rights are denied/i)
    expect(() => test.store.exportCase(current.caseId, 'anonymized')).toThrow(/re-export rights are denied/i)
  })

  it('keeps incomplete imports isolated and retries them atomically by package hash', () => {
    const source = harness('atomic-source')
    const seeded = seedDecision(source.store, source.store.createCase(caseInput()))
    const raw = serializeStewardExportBundle(source.store.exportCase(seeded.current.caseId, 'full-local'))
    const target = harness('atomic-target', 10_000, (stage) => {
      if (stage === 'after-evidence') throw new Error('seeded import interruption')
    })

    expect(() => target.store.importCase(raw)).toThrow(/seeded import interruption/)
    expect(target.store.listCases()).toEqual([])
    const packageHash = parseStewardExportBundle(raw).packageHash
    expect(existsSync(target.store.importStagingPath(packageHash))).toBe(true)

    let ids = 200
    const reopened = new StewardCaseStore({
      rootDir: target.root,
      now: () => 20_000,
      idFactory: () => `retry-${++ids}`
    })
    const retried = reopened.importCaseWithResult(raw)
    expect(retried).toMatchObject({
      deduplicated: false,
      retried: true,
      caseValue: {
        importCompleted: true,
        integrity: { state: 'unanchored' }
      }
    })
    expect(reopened.listCases()).toHaveLength(1)
    expect(existsSync(reopened.importStagingPath(packageHash))).toBe(false)
  })

  it('quarantines a published import missing its completion marker and replaces it on retry', () => {
    const source = harness('incomplete-source')
    const seeded = seedDecision(source.store, source.store.createCase(caseInput()))
    const bundle = source.store.exportCase(seeded.current.caseId, 'full-local')
    const raw = serializeStewardExportBundle(bundle)
    const target = harness('incomplete-target', 10_000)
    const imported = target.store.importCase(raw)
    const casePath = join(target.root, 'cases', target.store.caseFileName(imported.caseId))
    const lines = readFileSync(casePath, 'utf8').trim().split(/\r?\n/)
    expect(JSON.parse(lines.at(-1) as string).type).toBe('import-completed')
    writeFileSync(casePath, `${lines.slice(0, -1).join('\n')}\n`, 'utf8')

    let ids = 400
    const reopened = new StewardCaseStore({
      rootDir: target.root,
      now: () => 30_000,
      idFactory: () => `quarantine-${++ids}`
    })
    expect(reopened.getCase(imported.caseId)?.integrity.state).toBe('import-incomplete')
    const retried = reopened.importCaseWithResult(raw)
    expect(retried.retried).toBe(true)
    expect(retried.caseValue.caseId).not.toBe(imported.caseId)
    expect(retried.caseValue.importCompleted).toBe(true)
    expect(reopened.listCases()).toHaveLength(1)
    expect(readdirSync(join(target.root, 'quarantine'))).toHaveLength(1)
  })

  it('canonicalizes packages up to 16 MiB while enforcing 4 MiB per evidence item', () => {
    const test = harness('package-limits')
    let current = test.store.createCase(caseInput())
    for (let index = 0; index < 5; index += 1) {
      current = test.store.lockEvidence({
        ...evidenceInput(current.caseId),
        evidenceId: `large-evidence-${index}`,
        summary: `Large evidence ${index}`,
        mediaType: 'application/json',
        content: { payload: String(index).repeat(900_000) },
        provenance: {
          ...evidenceInput(current.caseId).provenance,
          sourceKind: 'document',
          sourceRef: `large-${index}`
        }
      })
    }
    const raw = serializeStewardExportBundle(test.store.exportCase(current.caseId, 'full-local'))
    expect(Buffer.byteLength(raw, 'utf8')).toBeGreaterThan(4 * 1024 * 1024)
    expect(Buffer.byteLength(raw, 'utf8')).toBeLessThan(16 * 1024 * 1024)
    expect(parseStewardExportBundle(raw).evidence).toHaveLength(5)

    expect(() => test.store.lockEvidence({
      ...evidenceInput(current.caseId),
      evidenceId: 'too-large',
      mediaType: 'application/json',
      provenance: {
        ...evidenceInput(current.caseId).provenance,
        sourceKind: 'document',
        sourceRef: 'too-large'
      },
      content: { payload: 'x'.repeat(4 * 1024 * 1024) }
    })).toThrow(/4 MiB limit/i)

    expect(() => canonicalStringify(
      { payload: 'x'.repeat(15 * 1024 * 1024) },
      PACKAGE_MAX_CANONICAL_BYTES
    )).not.toThrow()
    expect(() => canonicalStringify(
      { payload: 'x'.repeat(16 * 1024 * 1024) },
      PACKAGE_MAX_CANONICAL_BYTES
    )).toThrow(/16 MiB limit/i)
  })

  it('returns evidence content only after rechecking the case chain and content hash', () => {
    const test = harness('verified-details')
    let current = test.store.createCase(caseInput())
    current = test.store.lockEvidence(evidenceInput(current.caseId))
    const evidence = current.evidence[0]
    expect(test.store.getEvidenceDetails(current.caseId, evidence.evidenceId)).toMatchObject({
      caseId: current.caseId,
      evidence: { evidenceId: evidence.evidenceId },
      contentHashVerified: true,
      chainState: 'unanchored',
      content: { driverName: 'Alice Racer' }
    })

    writeFileSync(test.store.evidencePath(evidence.contentHash), '{"tampered":true}', 'utf8')
    expect(() => test.store.getEvidenceDetails(current.caseId, evidence.evidenceId)).toThrow(/quarantined/i)
  })

  it('rebuilds cases across restart and preserves monotonic chain sequence after wall-clock rollback', () => {
    const first = harness('restart', 10_000)
    const seeded = seedDecision(first.store, first.store.createCase(caseInput()))
    const before = seeded.current.history.at(-1) as NonNullable<StewardCase['history'][number]>

    let ids = 500
    const reopened = new StewardCaseStore({
      rootDir: first.root,
      now: () => 5_000,
      idFactory: () => `restart-${++ids}`
    })
    const restored = reopened.listCases()[0]
    expect(restored.verdicts).toHaveLength(1)
    expect(restored.integrity.state).toBe('unanchored')
    const updated = reopened.addBookmark({
      caseId: restored.caseId,
      actor: steward,
      bookmark: {
        source: 'replay',
        sourceId: 'replay-angle-2',
        label: 'Second replay angle',
        sessionTimeSec: 128,
        lap: 1,
        windowBeforeSec: 5,
        windowAfterSec: 5
      }
    })
    const after = updated.history.at(-1) as NonNullable<StewardCase['history'][number]>
    expect(after.sequence).toBe(before.sequence + 1)
    expect(after.occurredAt).toBeGreaterThan(before.occurredAt)
  })

  it('detects a changed case-chain payload and quarantines the valid prefix', () => {
    const test = harness('chain-tamper')
    let current = test.store.createCase(caseInput())
    current = test.store.lockEvidence(evidenceInput(current.caseId))
    const casePath = join(test.root, 'cases', test.store.caseFileName(current.caseId))
    const lines = readFileSync(casePath, 'utf8').trim().split(/\r?\n/)
    const changed = JSON.parse(lines[1]) as {
      payload: { evidence: { summary: string } }
    }
    changed.payload.evidence.summary = 'Changed without updating the chain hash'
    lines[1] = JSON.stringify(changed)
    writeFileSync(casePath, `${lines.join('\n')}\n`, 'utf8')

    const corrupted = test.store.getCase(current.caseId) as StewardCase
    expect(corrupted.integrity).toMatchObject({
      state: 'corrupt',
      verified: false,
      chainValid: false
    })
    expect(corrupted.history).toHaveLength(1)
  })
})
