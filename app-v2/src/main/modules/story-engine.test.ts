import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  StoryEngineState,
  StoryEvidence,
  StoryRaceTimeline,
  StoryTimelineEvent
} from '../../shared/story-engine'
import { emptyStoryEngineState } from '../../shared/story-engine'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import { StoryEngineStore, StoryTimelineCollector } from './story-engine'

const dirs: string[] = []

function testDir(): string {
  const dir = mkdtempSync(join(process.cwd(), 'story-engine-test-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

function fixtureEvidence(overrides: Partial<StoryEvidence> = {}): StoryEvidence {
  return {
    id: 'evidence-1',
    source: 'telemetry',
    eventType: 'finish',
    statement: 'Direct timing evidence.',
    contentHash: 'a'.repeat(64),
    contentCommitted: true,
    schemaFingerprint: 'story-test.v1',
    captureRange: { start: 5_000, end: 5_000, unit: 'ms' },
    origin: { producer: 'test', version: '1.0.0' },
    transformLineage: ['fixture-v1'],
    confidence: { score: 0.95, method: 'direct-test-v1' },
    clock: { clock: 'sim', sourceTimeMs: 5_000, toSessionOffsetMs: 0 },
    rights: { state: 'cleared', scope: 'public', checkedAt: 1_000 },
    consent: { state: 'not-required', epoch: 1, checkedAt: 1_000 },
    privacyClass: 'D1',
    piiAttestation: { status: 'none-detected', method: 'fixture-review-v1', checkedAt: 1_000 },
    claim: { subjectRef: 'car-1', predicate: 'recorded-finish-position', value: 1 },
    facts: { subjectLabel: 'Player car', position: 1, totalCars: 24 },
    ...overrides
  }
}

function fixtureEvent(overrides: Partial<StoryTimelineEvent> = {}): StoryTimelineEvent {
  return {
    id: 'event-1',
    type: 'finish',
    eventClass: 'fact',
    sessionTimeMs: 5_000,
    evidenceRefs: ['evidence-1'],
    assertionId: 'finish-position',
    claim: { subjectRef: 'car-1', predicate: 'recorded-finish-position', value: 1 },
    facts: { subjectLabel: 'Player car', position: 1, totalCars: 24 },
    priority: 1,
    ...overrides
  }
}

function fixtureTimeline(
  sessionRef = 'race-1',
  evidence = fixtureEvidence(),
  event = fixtureEvent()
): StoryRaceTimeline {
  return {
    id: `timeline-${sessionRef}`,
    sessionRef,
    completed: true,
    events: [event],
    evidence: [evidence]
  }
}

function snapshot(overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1_000,
    speedKmh: 180,
    rpm: 7_000,
    gear: 4,
    throttle: 0.8,
    brake: 0,
    clutch: 0,
    sessionUniqueId: 99,
    sessionType: 'Race',
    sessionState: 'racing',
    sessionTimeSec: 10,
    position: 5,
    totalCars: 20,
    ...overrides
  }
}

describe('StoryTimelineCollector post-race boundary', () => {
  it('discards an interrupted race and completes only after explicit terminal evidence', () => {
    const collector = new StoryTimelineCollector('test', () => 50_000)
    expect(collector.observe(snapshot())).toEqual([])
    expect(collector.observe(null)).toEqual([])

    expect(collector.observe(snapshot())).toEqual([])
    expect(collector.observe(snapshot({
      timestamp: 2_000,
      sessionTimeSec: 20,
      sessionState: 'checkered',
      position: 3
    }))).toEqual([])
    const completed = collector.observe(null)
    expect(completed).toHaveLength(1)
    expect(completed[0].timeline.completed).toBe(true)
    expect(completed[0].timeline.events.some((item) => item.type === 'finish')).toBe(true)
  })

  it('does not treat practice as a race and gives repeated fallback captures distinct identities', () => {
    const collector = new StoryTimelineCollector('test', () => 60_000)
    const withoutNativeId = {
      sessionUniqueId: undefined,
      sessionNumber: undefined,
      trackName: 'Spa',
      carName: 'GT3'
    }
    collector.observe(snapshot({
      ...withoutNativeId,
      sessionType: 'Practice',
      sessionState: 'checkered'
    }))
    expect(collector.observe(null)).toEqual([])

    collector.observe(snapshot(withoutNativeId))
    collector.observe(snapshot({
      ...withoutNativeId,
      timestamp: 2_000,
      sessionTimeSec: 20,
      sessionState: 'checkered'
    }))
    const first = collector.observe(null)[0]

    collector.observe(snapshot({
      ...withoutNativeId,
      timestamp: 10_000,
      sessionTimeSec: 10
    }))
    collector.observe(snapshot({
      ...withoutNativeId,
      timestamp: 11_000,
      sessionTimeSec: 20,
      sessionState: 'checkered'
    }))
    const second = collector.observe(null)[0]

    expect(first.timeline.sessionRef).not.toBe(second.timeline.sessionRef)
  })

  it('uses collision-resistant fallback capture identities across fresh collectors', () => {
    const firstCollector = new StoryTimelineCollector('test', () => 70_000, () => 'nonce-a')
    const secondCollector = new StoryTimelineCollector('test', () => 70_000, () => 'nonce-b')
    const withoutNativeId = snapshot({
      sessionUniqueId: undefined,
      sessionNumber: undefined,
      trackName: 'Monza',
      carName: 'GT3'
    })
    const terminal = snapshot({
      ...withoutNativeId,
      timestamp: 2_000,
      sessionTimeSec: 20,
      sessionState: 'checkered'
    })
    firstCollector.observe(withoutNativeId)
    firstCollector.observe(terminal)
    secondCollector.observe(withoutNativeId)
    secondCollector.observe(terminal)

    expect(firstCollector.observe(null)[0].timeline.sessionRef)
      .not.toBe(secondCollector.observe(null)[0].timeline.sessionRef)
  })

  it('accepts explicit lap-complete terminal evidence from non-iRacing providers', () => {
    const collector = new StoryTimelineCollector('test', () => 80_000, () => 'acc-capture')
    collector.observe(snapshot({
      sim: 'acc',
      sessionUniqueId: undefined,
      sessionNumber: undefined,
      sessionType: 'Race',
      sessionState: undefined,
      completedLaps: 20,
      lapsRemaining: 0
    }))

    const completed = collector.observe(null)
    expect(completed).toHaveLength(1)
    expect(completed[0].timeline.events.some((event) => event.type === 'finish')).toBe(true)
  })

  it('separates practice and race phases that share an iRacing event identity', () => {
    const collector = new StoryTimelineCollector('test', () => 90_000, () => 'unused')
    collector.observe(snapshot({
      sessionUniqueId: 777,
      sessionNumber: 0,
      sessionType: 'Practice',
      position: 1
    }))
    collector.observe(snapshot({
      sessionUniqueId: 777,
      sessionNumber: 1,
      sessionType: 'Race',
      position: 12,
      timestamp: 2_000,
      sessionTimeSec: 1
    }))
    collector.observe(snapshot({
      sessionUniqueId: 777,
      sessionNumber: 1,
      sessionType: 'Race',
      sessionState: 'checkered',
      position: 4,
      timestamp: 3_000,
      sessionTimeSec: 100
    }))

    const completed = collector.observe(null)
    expect(completed).toHaveLength(1)
    expect(completed[0].timeline.sessionRef).toContain(':777:1')
    expect(completed[0].timeline.events.every((event) => event.facts.fromPosition !== 1)).toBe(true)
  })

  it('uses since-capture semantics unless telemetry best-lap equality is exact', () => {
    const collect = (bestLapTimeSec: number): StoryTimelineEvent => {
      const collector = new StoryTimelineCollector('test', () => 95_000, () => `capture-${bestLapTimeSec}`)
      collector.observe(snapshot({
        sessionUniqueId: 888,
        sessionNumber: 1,
        completedLaps: 4,
        lastLapTimeSec: 82.5,
        bestLapTimeSec
      }))
      collector.observe(snapshot({
        sessionUniqueId: 888,
        sessionNumber: 1,
        timestamp: 2_000,
        sessionTimeSec: 100,
        sessionState: 'checkered',
        completedLaps: 4,
        lastLapTimeSec: 82.5,
        bestLapTimeSec
      }))
      const timeline = collector.observe(null)[0].timeline
      const fastest = timeline.events.find((event) => event.type === 'fastest-lap')
      if (!fastest) throw new Error('missing fastest-lap event')
      return fastest
    }

    expect(collect(82.5005)).toMatchObject({
      claim: { predicate: 'fastest-observed-since-capture' },
      facts: { fastestScope: 'since-capture' }
    })
    expect(collect(82.5)).toMatchObject({
      claim: { predicate: 'recorded-fastest-lap-time' },
      facts: { fastestScope: 'session-best', bestLapTimeSec: 82.5 }
    })
  })
})

describe('StoryEngineStore human decisions and restart', () => {
  it('requires explicit human confirmation and persists approval and rejection across restart', () => {
    const dir = testDir()
    let now = 10_000
    const options = { now: () => now, approvalId: () => `approval-${now}` }
    const store = new StoryEngineStore(dir, options)
    let state = store.generate(fixtureTimeline('race-approved'))
    const approved = state.cards[0]

    expect(() => store.decide({
      cardId: approved.id,
      revision: approved.revision,
      decision: 'approved',
      destination: 'local',
      reviewer: 'Producer One',
      humanConfirmed: false
    })).toThrow(/Human evidence review/)
    expect(() => store.decide({
      cardId: approved.id,
      revision: approved.revision,
      decision: 'automatic' as never,
      destination: 'local',
      reviewer: 'Producer One',
      humanConfirmed: true
    })).toThrow(/approved or rejected/)

    now = 11_000
    state = store.decide({
      cardId: approved.id,
      revision: approved.revision,
      decision: 'approved',
      destination: 'local',
      reviewer: 'Producer One',
      humanConfirmed: true
    })
    expect(state.cards.find((card) => card.id === approved.id)).toMatchObject({
      status: 'approved',
      approval: { id: 'approval-11000', destination: 'local', oneShot: true }
    })

    now = 12_000
    state = store.generate(fixtureTimeline('race-rejected'))
    const rejected = state.cards.find((card) => card.timelineId !== approved.timelineId)
    if (!rejected) throw new Error('missing rejection fixture card')
    store.decide({
      cardId: rejected.id,
      revision: rejected.revision,
      decision: 'rejected',
      reviewer: 'Producer Two',
      humanConfirmed: true
    })

    const restarted = new StoryEngineStore(dir, options).getState()
    expect(restarted.cards.find((card) => card.id === approved.id)?.status).toBe('approved')
    expect(restarted.cards.find((card) => card.id === rejected.id)).toMatchObject({
      status: 'rejected',
      decision: { decision: 'rejected', reviewer: 'Producer Two' }
    })
  })

  it('exports only approved sanitized cards to an offline package and consumes approval', () => {
    const dir = testDir()
    let now = 20_000
    const smtpUtf8Mailbox = 'josé/ops@example.com'
    const punycodeMailbox = 'racer@example.xn--p1ai'
    const middleDotLocalMailbox = 'josé\u00B7ops@example.com'
    const middleDotDomainMailbox = 'racer@l\u00B7l.cat'
    const unicodeAtextMailbox = 'maría\u2019team@example.com'
    const explicitUnicodeMailbox = 'maría\u2011team@example.com'
    const statement = `Alice Example reached the podium. Contact ${smtpUtf8Mailbox}, ${punycodeMailbox}, ${middleDotLocalMailbox}, ${middleDotDomainMailbox}, ${unicodeAtextMailbox}, or ${explicitUnicodeMailbox}.`
    const store = new StoryEngineStore(dir, {
      now: () => now,
      approvalId: () => 'approval-export'
    })
    const piiEvidence = fixtureEvidence({
      statement,
      eventType: 'explicit',
      privacyClass: 'D3',
      consent: { state: 'granted', subjectRef: 'driver-1', epoch: 2, checkedAt: 1_000 },
      pii: [
        { kind: 'name', value: 'Alice Example', replacement: '[driver]' },
        { kind: 'email', value: explicitUnicodeMailbox }
      ],
      piiAttestation: { status: 'pii-declared', method: 'fixture-pii-review-v1', checkedAt: 1_000 },
      claim: { subjectRef: 'driver-1', predicate: 'podium', value: true },
      facts: {
        rank: 0.9,
        title: 'Podium for Alice Example',
        statement
      }
    })
    const piiEvent = fixtureEvent({
      type: 'explicit',
      assertionId: 'podium',
      claim: { subjectRef: 'driver-1', predicate: 'podium', value: true },
      facts: { rank: 0.9 },
      title: 'Podium for Alice Example',
      statement
    })
    let state = store.generate(fixtureTimeline('race-export', piiEvidence, piiEvent))
    const card = state.cards[0]
    now = 21_000
    store.decide({
      cardId: card.id,
      revision: card.revision,
      decision: 'approved',
      destination: 'local',
      reviewer: 'Producer',
      humanConfirmed: true
    })

    now = 22_000
    const result = store.exportApproved({
      destination: 'local',
      format: 'json',
      cardIds: [card.id]
    })
    const content = readFileSync(result.path, 'utf8')
    const payload = JSON.parse(content) as {
      offlineOnly: boolean
      publication: string
      cards: Array<{ title: string; body: string }>
    }

    expect(payload.offlineOnly).toBe(true)
    expect(payload.publication).toBe('not-performed')
    expect(content).not.toContain('Alice Example')
    expect(content).not.toContain(smtpUtf8Mailbox)
    expect(content).not.toContain('josé/')
    expect(content).not.toContain(punycodeMailbox)
    expect(content).not.toContain('--p1ai')
    expect(content).not.toContain(middleDotLocalMailbox)
    expect(content).not.toContain('josé\u00B7')
    expect(content).not.toContain(middleDotDomainMailbox)
    expect(content).not.toContain('l\u00B7l.cat')
    expect(content).not.toContain(unicodeAtextMailbox)
    expect(content).not.toContain('maría\u2019')
    expect(content).not.toContain(explicitUnicodeMailbox)
    expect(content).not.toContain('maría\u2011')
    expect(payload.cards[0].title).toContain('[driver]')
    expect(payload.cards[0].body).toBe(
      '[driver] reached the podium. Contact [email], [email], [email], [email], [email], or [email].'
    )
    state = store.getState()
    expect(state.cards[0]).toMatchObject({
      status: 'exported',
      approval: { consumedAt: 22_000 }
    })
    expect(state.exportJournal[0]).toMatchObject({
      destination: 'local',
      format: 'json',
      cardIds: [card.id],
      exportedAt: 22_000,
      status: 'finalized'
    })
    expect(() => store.exportApproved({
      destination: 'local',
      format: 'json',
      cardIds: [card.id]
    })).toThrow(/No approved story cards/)
  })

  it('invalidates an approval when the same evidence-linked card is regenerated with revoked rights', () => {
    const dir = testDir()
    let now = 30_000
    const store = new StoryEngineStore(dir, { now: () => now, approvalId: () => 'approval-rights' })
    let state = store.generate(fixtureTimeline('race-rights'))
    const original = state.cards[0]
    now = 31_000
    store.decide({
      cardId: original.id,
      revision: original.revision,
      decision: 'approved',
      destination: 'local',
      reviewer: 'Producer',
      humanConfirmed: true
    })

    now = 32_000
    state = store.generate(fixtureTimeline(
      'race-rights',
      fixtureEvidence({ rights: { state: 'revoked', scope: 'prohibited', checkedAt: now } })
    ))
    const revoked = state.cards[0]
    expect(revoked.id).toBe(original.id)
    expect(revoked.revision).not.toBe(original.revision)
    expect(revoked.status).toBe('candidate')
    expect(revoked.approval).toBeUndefined()
    expect(() => store.decide({
      cardId: revoked.id,
      revision: revoked.revision,
      decision: 'approved',
      destination: 'local',
      reviewer: 'Producer',
      humanConfirmed: true
    })).toThrow(/rights:revoked/)
  })

  it('preserves approved unexported cards while evicting only disposable queue states', () => {
    const dir = testDir()
    let now = 35_000
    const store = new StoryEngineStore(dir, {
      now: () => now,
      approvalId: () => 'approval-protected'
    })
    const protectedCard = store.generate(fixtureTimeline('race-protected')).cards[0]
    now += 1
    store.decide({
      cardId: protectedCard.id,
      revision: protectedCard.revision,
      decision: 'approved',
      destination: 'local',
      reviewer: 'Producer',
      humanConfirmed: true
    })

    let state = store.getState()
    for (let index = 0; index < 270; index += 1) {
      now += 1
      state = store.generate(fixtureTimeline(`race-queue-${index}`))
    }

    expect(state.cards).toHaveLength(250)
    const retained = state.cards.find((card) => card.id === protectedCard.id)
    expect(retained).toMatchObject({
      status: 'approved',
      approval: { id: 'approval-protected' }
    })
    expect(retained?.approval?.consumedAt).toBeUndefined()
    expect(state.cards.filter((card) => card.status !== 'approved')).toHaveLength(249)
  })

  it('recovers a committed pending export by its exact durable journal entry', () => {
    const dir = testDir()
    let now = 40_000
    const options = {
      now: () => now,
      approvalId: () => 'approval-recovery',
      exportId: () => 'export-transaction-1'
    }
    const store = new StoryEngineStore(dir, options)
    const card = store.generate(fixtureTimeline('race-recovery')).cards[0]
    now = 41_000
    store.decide({
      cardId: card.id,
      revision: card.revision,
      decision: 'approved',
      destination: 'local',
      reviewer: 'Producer',
      humanConfirmed: true
    })
    now = 42_000
    const result = store.exportApproved({
      destination: 'local',
      format: 'json',
      cardIds: [card.id]
    })

    const statePath = join(dir, 'state.json')
    const persisted = JSON.parse(readFileSync(statePath, 'utf8')) as StoryEngineState
    persisted.exportJournal[0].status = 'committed'
    writeFileSync(statePath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')
    renameSync(result.path, `${result.path}.pending`)

    const restarted = new StoryEngineStore(dir, options).getState()
    expect(existsSync(result.path)).toBe(true)
    expect(existsSync(`${result.path}.pending`)).toBe(false)
    expect(restarted.exportJournal[0].status).toBe('finalized')
  })

  it('never evicts committed export transactions when compacting finalized history', () => {
    const dir = testDir()
    const state = emptyStoryEngineState(50_000)
    state.exportJournal = [
      {
        id: 'committed-export',
        fileName: 'committed.json',
        destination: 'local',
        format: 'json',
        cardIds: ['card-1'],
        exportedAt: 50_000,
        contentHash: 'a'.repeat(64),
        status: 'committed'
      },
      ...Array.from({ length: 120 }, (_, index) => ({
        id: `finalized-${index}`,
        fileName: `finalized-${index}.json`,
        destination: 'local' as const,
        format: 'json' as const,
        cardIds: [`card-${index}`],
        exportedAt: index,
        contentHash: 'b'.repeat(64),
        status: 'finalized' as const
      }))
    ]
    writeFileSync(join(dir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8')

    const compacted = new StoryEngineStore(dir).getState().exportJournal
    expect(compacted.some((entry) => entry.id === 'committed-export' && entry.status === 'committed')).toBe(true)
    expect(compacted.filter((entry) => entry.status === 'finalized')).toHaveLength(100)
  })
})
