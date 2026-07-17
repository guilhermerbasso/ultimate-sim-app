import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  StewardActor,
  StewardCase,
  StewardCaseCreateInput,
  StewardEvidenceLockInput,
  StewardRuleCitation,
  StewardHumanVerdict
} from '../../shared/steward-desk'
import {
  StewardCaseStore,
  parseStewardExportBundle,
  serializeStewardExportBundle
} from './store'

const roots: string[] = []

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

function harness(name: string, initialNow = 1_000): {
  root: string
  store: StewardCaseStore
  setNow(value: number): void
} {
  const root = join(process.cwd(), `.steward-store-${name}-${process.pid}-${roots.length}`)
  mkdirSync(root, { recursive: true })
  roots.push(root)
  let now = initialNow
  let ids = 0
  return {
    root,
    store: new StewardCaseStore({
      rootDir: root,
      now: () => now,
      idFactory: () => `id-${++ids}`
    }),
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
      source: 'incident-recorder',
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
    summary: 'Incident recorder clip for Alice Racer',
    mediaType: 'application/json',
    content: {
      driverName: 'Alice Racer',
      teamName: 'Team Crimson',
      sessionId: 'session-secret-2026-07-17',
      samples: [{ t: 900, speedKmh: 121 }, { t: 901, speedKmh: 72 }],
      note: 'Alice Racer was alongside Morgan Steward.'
    },
    provenance: {
      sourceKind: 'incident-recorder',
      sourceRef: 'incident-clips/inc-42.json',
      producer: 'Ultimate Sim App',
      producerVersion: '2.53.1',
      capturedAt: 900,
      sessionRef: 'session-secret-2026-07-17',
      captureRange: '896-903',
      transform: 'incident-recorder.v1'
    }
  }
}

function seedDecision(store: StewardCaseStore, current: StewardCase): {
  current: StewardCase
  evidenceId: string
  rule: StewardRuleCitation
  verdict: StewardHumanVerdict
} {
  let next = store.lockEvidence(evidenceInput(current.caseId))
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
    evidenceIds: [evidenceId]
  })
  return { current: next, evidenceId, rule, verdict: next.verdicts[0] }
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

  it('rejects duplicate primary incidents and idempotently ignores a duplicate bookmark', () => {
    const test = harness('duplicates')
    const current = test.store.createCase(caseInput())
    expect(() => test.store.createCase(caseInput())).toThrow(/duplicate incident/i)
    const before = current.history.length
    const duplicate = test.store.addBookmark({
      caseId: current.caseId,
      actor: steward,
      bookmark: caseInput().incident
    })
    expect(duplicate.bookmarks).toHaveLength(1)
    expect(duplicate.history).toHaveLength(before)
  })

  it('redacts identities, exact session references, locators, and sensitive evidence fields', () => {
    const test = harness('redaction')
    const seeded = seedDecision(test.store, test.store.createCase(caseInput()))
    const withDissent = test.store.recordDissent({
      caseId: seeded.current.caseId,
      actor: participant,
      verdictId: seeded.verdict.verdictId,
      statement: 'Alice Racer disagrees with Morgan Steward.',
      grounds: 'Team Crimson believes the private session clip was incomplete.'
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
      'incident-clips/inc-42.json',
      'file:///league/private-rules.pdf'
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
    expect(bundle.redactions.length).toBeGreaterThan(0)
    expect(bundle.evidence[0].content).toMatchObject({
      driverName: '[redacted]',
      teamName: '[redacted]',
      sessionId: '[redacted]'
    })
    expect(parseStewardExportBundle(serialized).packageHash).toBe(bundle.packageHash)
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
    expect(() => test.store.setStatus({
      caseId: current.caseId,
      actor: steward,
      status: 'closed'
    })).toThrow(/appeal is open/i)
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
    expect(current.verdicts).toHaveLength(1)

    current = test.store.recordVerdict({
      caseId: current.caseId,
      actor: steward,
      finding: 'procedural',
      decisionText: 'Chief steward recorded a replacement human decision after appeal.',
      ruleCitationIds: [seeded.rule.citationId],
      evidenceIds: [seeded.evidenceId],
      supersedesVerdictId: seeded.verdict.verdictId
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
    expect(imported.integrity.state).toBe('unanchored')

    const tampered = JSON.parse(raw) as Record<string, unknown>
    ;(tampered.case as Record<string, unknown>).title = 'Changed after export'
    expect(() => parseStewardExportBundle(JSON.stringify(tampered))).toThrow(/hash mismatch/i)
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
