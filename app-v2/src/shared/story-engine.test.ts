import { describe, expect, it } from 'vitest'
import {
  generateStoryCards,
  storyApprovalBlockReason,
  storyPreview,
  type StoryEvidence,
  type StoryRaceTimeline,
  type StoryTimelineEvent
} from './story-engine'

const NOW = 1_800_000_000_000

function evidence(id = 'evidence-1', overrides: Partial<StoryEvidence> = {}): StoryEvidence {
  const hashPrefix = [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0)
    .toString(16)
    .padStart(4, '0')
    .slice(-4)
  return {
    id,
    source: 'telemetry',
    eventType: 'finish',
    statement: 'Direct timing fact.',
    contentHash: `${hashPrefix}${'a'.repeat(60)}`,
    contentCommitted: true,
    schemaFingerprint: 'test.story.v1',
    captureRange: { start: 10_000, end: 10_000, unit: 'ms' },
    origin: { producer: 'test-timing', version: '1.0.0' },
    transformLineage: ['fixture-v1'],
    confidence: { score: 0.94, method: 'direct-fixture-v1' },
    clock: { clock: 'sim', sourceTimeMs: 10_000, toSessionOffsetMs: 0, uncertaintyMs: 0 },
    rights: { state: 'cleared', scope: 'public', checkedAt: NOW },
    consent: { state: 'not-required', epoch: 1, checkedAt: NOW },
    privacyClass: 'D1',
    piiAttestation: { status: 'none-detected', method: 'fixture-review-v1', checkedAt: NOW },
    claim: { subjectRef: 'car-7', predicate: 'recorded-finish-position', value: 2 },
    facts: { subjectLabel: 'Car 7', position: 2, totalCars: 20 },
    ...overrides
  }
}

function event(id = 'event-1', overrides: Partial<StoryTimelineEvent> = {}): StoryTimelineEvent {
  return {
    id,
    type: 'finish',
    eventClass: 'fact',
    sessionTimeMs: 10_000,
    evidenceRefs: ['evidence-1'],
    assertionId: 'finish-position',
    claim: { subjectRef: 'car-7', predicate: 'recorded-finish-position', value: 2 },
    facts: { subjectLabel: 'Car 7', position: 2, totalCars: 20 },
    priority: 1,
    ...overrides
  }
}

function timeline(
  events: StoryTimelineEvent[] = [event()],
  evidenceItems: StoryEvidence[] = [evidence()]
): StoryRaceTimeline {
  return {
    id: 'timeline-1',
    sessionRef: 'race-1',
    completed: true,
    events,
    evidence: evidenceItems
  }
}

describe('evidence-linked story generation', () => {
  it('abstains when an event references missing evidence', () => {
    const result = generateStoryCards(
      timeline([event('event-missing', { evidenceRefs: ['not-present'] })]),
      NOW
    )

    expect(result.candidates).toHaveLength(0)
    expect(result.issues.some((issue) => issue.code === 'missing-evidence')).toBe(true)
  })

  it('abstains from contradictory active facts instead of choosing a narrative', () => {
    const events = [
      event('finish-a', {
        assertionId: 'caller-assertion-a',
        evidenceRefs: ['evidence-a'],
        claim: { subjectRef: 'car-7', predicate: 'recorded-finish-position', value: 2 },
        facts: { subjectLabel: 'Car 7', position: 2 }
      }),
      event('finish-b', {
        assertionId: 'caller-assertion-b',
        evidenceRefs: ['evidence-b'],
        claim: { subjectRef: 'car-7', predicate: 'recorded-finish-position', value: 3 },
        facts: { subjectLabel: 'Car 7', position: 3 }
      })
    ]
    const result = generateStoryCards(
      timeline(events, [
        evidence('evidence-a', {
          claim: { subjectRef: 'car-7', predicate: 'recorded-finish-position', value: 2 },
          facts: { subjectLabel: 'Car 7', position: 2 }
        }),
        evidence('evidence-b', {
          claim: { subjectRef: 'car-7', predicate: 'recorded-finish-position', value: 3 },
          facts: { subjectLabel: 'Car 7', position: 3 }
        })
      ]),
      NOW
    )

    expect(result.candidates).toHaveLength(0)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'contradictory-events' })
    ]))
  })

  it('keeps changing facts separate when their canonical temporal scopes differ', () => {
    const firstClaim = { subjectRef: 'car-7', predicate: 'position-at-observed-time', value: 4 }
    const secondClaim = { subjectRef: 'car-7', predicate: 'position-at-observed-time', value: 3 }
    const result = generateStoryCards(
      timeline(
        [
          event('position-a', {
            type: 'position-change',
            assertionId: 'caller-position-a',
            sessionTimeMs: 10_000,
            evidenceRefs: ['position-evidence-a'],
            claim: firstClaim,
            facts: { subjectLabel: 'Car 7', fromPosition: 5, toPosition: 4 }
          }),
          event('position-b', {
            type: 'position-change',
            assertionId: 'caller-position-b',
            sessionTimeMs: 20_000,
            evidenceRefs: ['position-evidence-b'],
            claim: secondClaim,
            facts: { subjectLabel: 'Car 7', fromPosition: 4, toPosition: 3 }
          })
        ],
        [
          evidence('position-evidence-a', {
            eventType: 'position-change',
            claim: firstClaim,
            facts: { subjectLabel: 'Car 7', fromPosition: 5, toPosition: 4 }
          }),
          evidence('position-evidence-b', {
            eventType: 'position-change',
            claim: secondClaim,
            facts: { subjectLabel: 'Car 7', fromPosition: 4, toPosition: 3 },
            captureRange: { start: 20_000, end: 20_000, unit: 'ms' },
            clock: { clock: 'sim', sourceTimeMs: 20_000, toSessionOffsetMs: 0 }
          })
        ]
      ),
      NOW
    )

    expect(result.candidates).toHaveLength(2)
    expect(result.issues.some((issue) => issue.code === 'contradictory-events')).toBe(false)
  })

  it('detects contradictions in rendered facts even when claim values match', () => {
    const claim = { subjectRef: 'car-7', predicate: 'position-at-observed-time', value: 4 }
    const result = generateStoryCards(
      timeline(
        [
          event('position-from-five', {
            type: 'position-change',
            assertionId: 'caller-position-five',
            evidenceRefs: ['position-from-five-evidence'],
            claim,
            facts: { subjectLabel: 'Car 7', fromPosition: 5, toPosition: 4 }
          }),
          event('position-from-six', {
            type: 'position-change',
            assertionId: 'caller-position-six',
            evidenceRefs: ['position-from-six-evidence'],
            claim,
            facts: { subjectLabel: 'Car 7', fromPosition: 6, toPosition: 4 }
          })
        ],
        [
          evidence('position-from-five-evidence', {
            eventType: 'position-change',
            claim,
            facts: { subjectLabel: 'Car 7', fromPosition: 5, toPosition: 4 }
          }),
          evidence('position-from-six-evidence', {
            eventType: 'position-change',
            claim,
            facts: { subjectLabel: 'Car 7', fromPosition: 6, toPosition: 4 }
          })
        ]
      ),
      NOW
    )

    expect(result.candidates).toHaveLength(0)
    expect(result.issues.some((issue) => issue.code === 'contradictory-events')).toBe(true)
  })

  it('includes rendered lap numbers in canonical contradiction payloads', () => {
    const claim = { subjectRef: 'race-control', predicate: 'flag-state', value: 'yellow' }
    const result = generateStoryCards(
      timeline(
        [
          event('yellow-lap-four', {
            type: 'flag',
            assertionId: 'caller-yellow-four',
            lap: 4,
            evidenceRefs: ['yellow-lap-four-evidence'],
            claim,
            facts: { flag: 'yellow', lap: 4 }
          }),
          event('yellow-lap-five', {
            type: 'flag',
            assertionId: 'caller-yellow-five',
            lap: 5,
            evidenceRefs: ['yellow-lap-five-evidence'],
            claim,
            facts: { flag: 'yellow', lap: 5 }
          })
        ],
        [
          evidence('yellow-lap-four-evidence', {
            eventType: 'flag',
            claim,
            facts: { flag: 'yellow', lap: 4 }
          }),
          evidence('yellow-lap-five-evidence', {
            eventType: 'flag',
            claim,
            facts: { flag: 'yellow', lap: 5 }
          })
        ]
      ),
      NOW
    )

    expect(result.candidates).toHaveLength(0)
    expect(result.issues.some((issue) => issue.code === 'contradictory-events')).toBe(true)
  })

  it('does not let an invalid superseding event hide contradictory facts', () => {
    const events = [
      event('finish-a', {
        assertionId: 'caller-assertion-a',
        evidenceRefs: ['evidence-a'],
        claim: { subjectRef: 'car-7', predicate: 'recorded-finish-position', value: 2 },
        facts: { subjectLabel: 'Car 7', position: 2 }
      }),
      event('finish-b', {
        assertionId: 'caller-assertion-b',
        evidenceRefs: ['evidence-b'],
        claim: { subjectRef: 'car-7', predicate: 'recorded-finish-position', value: 3 },
        facts: { subjectLabel: 'Car 7', position: 3 }
      }),
      event('bad-correction', {
        assertionId: 'caller-correction',
        eventClass: 'recommendation',
        evidenceRefs: [],
        supersedesEventId: 'finish-b',
        claim: { subjectRef: 'car-7', predicate: 'recorded-finish-position', value: 2 },
        facts: { subjectLabel: 'Car 7', position: 2 }
      })
    ]
    const result = generateStoryCards(
      timeline(events, [
        evidence('evidence-a', {
          claim: { subjectRef: 'car-7', predicate: 'recorded-finish-position', value: 2 },
          facts: { subjectLabel: 'Car 7', position: 2 }
        }),
        evidence('evidence-b', {
          claim: { subjectRef: 'car-7', predicate: 'recorded-finish-position', value: 3 },
          facts: { subjectLabel: 'Car 7', position: 3 }
        })
      ]),
      NOW
    )

    expect(result.candidates).toHaveLength(0)
    expect(result.issues.some((issue) => issue.code === 'contradictory-events')).toBe(true)
  })

  it('does not honor a fully evidenced superseder with invalid rendered semantics', () => {
    const firstClaim = { subjectRef: 'car-7', predicate: 'position-at-observed-time', value: 4 }
    const secondClaim = { subjectRef: 'car-7', predicate: 'position-at-observed-time', value: 3 }
    const invalidClaim = { subjectRef: 'car-7', predicate: 'position-at-observed-time', value: 4 }
    const result = generateStoryCards(
      timeline(
        [
          event('valid-position-a', {
            type: 'position-change',
            assertionId: 'caller-valid-a',
            evidenceRefs: ['valid-position-evidence-a'],
            claim: firstClaim,
            facts: { subjectLabel: 'Car 7', fromPosition: 5, toPosition: 4 }
          }),
          event('valid-position-b', {
            type: 'position-change',
            assertionId: 'caller-valid-b',
            evidenceRefs: ['valid-position-evidence-b'],
            claim: secondClaim,
            facts: { subjectLabel: 'Car 7', fromPosition: 4, toPosition: 3 }
          }),
          event('invalid-position-correction', {
            type: 'position-change',
            assertionId: 'caller-invalid-correction',
            evidenceRefs: ['invalid-position-evidence'],
            supersedesEventId: 'valid-position-b',
            claim: invalidClaim,
            facts: { subjectLabel: 'Car 7', fromPosition: 0, toPosition: 4 }
          })
        ],
        [
          evidence('valid-position-evidence-a', {
            eventType: 'position-change',
            claim: firstClaim,
            facts: { subjectLabel: 'Car 7', fromPosition: 5, toPosition: 4 }
          }),
          evidence('valid-position-evidence-b', {
            eventType: 'position-change',
            claim: secondClaim,
            facts: { subjectLabel: 'Car 7', fromPosition: 4, toPosition: 3 }
          }),
          evidence('invalid-position-evidence', {
            eventType: 'position-change',
            claim: invalidClaim,
            facts: { subjectLabel: 'Car 7', fromPosition: 0, toPosition: 4 }
          })
        ]
      ),
      NOW
    )

    expect(result.candidates).toHaveLength(0)
    expect(result.issues.some((issue) => issue.code === 'contradictory-events')).toBe(true)
  })

  it('rejects cyclic supersession instead of silently erasing contradictions', () => {
    const firstClaim = { subjectRef: 'car-7', predicate: 'recorded-finish-position', value: 2 }
    const secondClaim = { subjectRef: 'car-7', predicate: 'recorded-finish-position', value: 3 }
    const result = generateStoryCards(
      timeline(
        [
          event('cyclic-finish-a', {
            assertionId: 'caller-cycle-a',
            evidenceRefs: ['cyclic-evidence-a'],
            supersedesEventId: 'cyclic-finish-b',
            claim: firstClaim,
            facts: { subjectLabel: 'Car 7', position: 2 }
          }),
          event('cyclic-finish-b', {
            assertionId: 'caller-cycle-b',
            evidenceRefs: ['cyclic-evidence-b'],
            supersedesEventId: 'cyclic-finish-a',
            claim: secondClaim,
            facts: { subjectLabel: 'Car 7', position: 3 }
          })
        ],
        [
          evidence('cyclic-evidence-a', {
            claim: firstClaim,
            facts: { subjectLabel: 'Car 7', position: 2 }
          }),
          evidence('cyclic-evidence-b', {
            claim: secondClaim,
            facts: { subjectLabel: 'Car 7', position: 3 }
          })
        ]
      ),
      NOW
    )

    expect(result.candidates).toHaveLength(0)
    expect(result.issues.some((issue) =>
      issue.code === 'invalid-event' && issue.message.includes('Cyclic')
    )).toBe(true)
    expect(result.issues.some((issue) => issue.code === 'contradictory-events')).toBe(true)
  })

  it('redacts explicit and detected PII before rendering destination previews', () => {
    const piiEvidence = evidence('evidence-pii', {
      statement: 'Alice Example can be reached at alice@example.com.',
      eventType: 'explicit',
      privacyClass: 'D3',
      confidence: { score: 0.9, method: 'manual review by alice@example.com' },
      consent: { state: 'unknown', subjectRef: 'driver-1', epoch: 1, checkedAt: NOW },
      pii: [
        { kind: 'name', value: 'Alice', replacement: 'Alice' },
        { kind: 'name', value: 'Alice Example', replacement: 'Alice Example' }
      ],
      piiAttestation: { status: 'pii-declared', method: 'fixture-pii-review-v1', checkedAt: NOW },
      claim: { subjectRef: 'driver-1', predicate: 'podium-attestation', value: true },
      facts: {
        rank: 0.8,
        title: 'Podium for Alice Example',
        statement: 'Alice Example finished on the podium. Contact joão.silva@exemplo.com.br or +55 (11) 91234-5678.'
      }
    })
    const piiEvent = event('event-pii', {
      type: 'explicit',
      evidenceRefs: ['evidence-pii'],
      assertionId: 'podium-attestation',
      claim: { subjectRef: 'driver-1', predicate: 'podium-attestation', value: true },
      facts: { rank: 0.8 },
      title: 'Podium for Alice Example',
      statement: 'Alice Example finished on the podium. Contact joão.silva@exemplo.com.br or +55 (11) 91234-5678.'
    })

    const [card] = generateStoryCards(timeline([piiEvent], [piiEvidence]), NOW).candidates
    expect(card.title).toBe('Podium for [driver]')
    expect(card.body).not.toContain('joão.silva@exemplo.com.br')
    expect(card.body).not.toContain('91234-5678')
    expect(card.redactions.map((redaction) => redaction.kind)).toEqual(expect.arrayContaining(['name', 'email', 'phone']))
    expect(card.redactions.find((redaction) => redaction.kind === 'name')?.evidenceRef).toMatch(/^evidence-/)
    expect(card.provenance[0].confidenceMethod).toMatch(/^confidence-method-/)
    expect(card.provenance[0].confidenceMethod).not.toContain('@')
    expect(storyPreview(card, 'local')?.status).toBe('redacted')
    expect(storyPreview(card, 'internet')?.status).toBe('blocked')
  })

  it('redacts complete SMTPUTF8 and punycode mailbox tokens from destination previews', () => {
    const smtpUtf8Mailbox = 'josé/ops@example.com'
    const punycodeMailbox = 'racer@example.xn--p1ai'
    const middleDotLocalMailbox = 'josé\u00B7ops@example.com'
    const middleDotDomainMailbox = 'racer@l\u00B7l.cat'
    const statement = `Alice can be reached at ${smtpUtf8Mailbox}, ${punycodeMailbox}, ${middleDotLocalMailbox}, or ${middleDotDomainMailbox}.`
    const piiEvidence = evidence('evidence-mailboxes', {
      statement,
      eventType: 'explicit',
      privacyClass: 'D3',
      consent: { state: 'unknown', subjectRef: 'driver-1', epoch: 1, checkedAt: NOW },
      pii: [{ kind: 'name', value: 'Alice' }],
      piiAttestation: { status: 'pii-declared', method: 'fixture-mailbox-review-v1', checkedAt: NOW },
      claim: { subjectRef: 'driver-1', predicate: 'contact-card', value: true },
      facts: { rank: 0.8, title: 'Contact Alice', statement }
    })
    const piiEvent = event('event-mailboxes', {
      type: 'explicit',
      evidenceRefs: ['evidence-mailboxes'],
      assertionId: 'contact-card',
      claim: { subjectRef: 'driver-1', predicate: 'contact-card', value: true },
      facts: { rank: 0.8 },
      title: 'Contact Alice',
      statement
    })

    const [card] = generateStoryCards(timeline([piiEvent], [piiEvidence]), NOW).candidates
    const expectedBody = '[driver] can be reached at [email], [email], [email], or [email].'
    expect(card.body).toBe(expectedBody)
    expect(storyPreview(card, 'local')?.body).toBe(expectedBody)
    expect(card.body).not.toContain(smtpUtf8Mailbox)
    expect(card.body).not.toContain('josé/')
    expect(card.body).not.toContain(punycodeMailbox)
    expect(card.body).not.toContain('--p1ai')
    expect(card.body).not.toContain(middleDotLocalMailbox)
    expect(card.body).not.toContain('josé\u00B7')
    expect(card.body).not.toContain(middleDotDomainMailbox)
    expect(card.body).not.toContain('l\u00B7l.cat')
  })

  it('does not let an explicit suffix mailbox preempt automatic whole-token redaction', () => {
    const declaredSuffix = 'ops@example.com'
    const completeMailbox = 'josé/ops@example.com'
    const statement = `Alice can be reached at ${completeMailbox}.`
    const piiEvidence = evidence('evidence-overlapping-mailbox', {
      statement,
      eventType: 'explicit',
      privacyClass: 'D3',
      consent: { state: 'unknown', subjectRef: 'driver-1', epoch: 1, checkedAt: NOW },
      pii: [
        { kind: 'name', value: 'Alice' },
        { kind: 'email', value: declaredSuffix }
      ],
      piiAttestation: { status: 'pii-declared', method: 'fixture-overlap-review-v1', checkedAt: NOW },
      claim: { subjectRef: 'driver-1', predicate: 'overlap-contact-card', value: true },
      facts: { rank: 0.8, title: 'Contact Alice', statement }
    })
    const piiEvent = event('event-overlapping-mailbox', {
      type: 'explicit',
      evidenceRefs: ['evidence-overlapping-mailbox'],
      assertionId: 'overlap-contact-card',
      claim: { subjectRef: 'driver-1', predicate: 'overlap-contact-card', value: true },
      facts: { rank: 0.8 },
      title: 'Contact Alice',
      statement
    })

    const [card] = generateStoryCards(timeline([piiEvent], [piiEvidence]), NOW).candidates
    const internetPreview = storyPreview(card, 'internet')
    expect(card.body).toBe('[driver] can be reached at [email].')
    expect(card.body).not.toContain('josé/')
    expect(card.redactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'email', reason: 'pattern-detected' })
    ]))
    expect(card.redactions.some((redaction) =>
      redaction.kind === 'email' && redaction.reason === 'explicit-pii'
    )).toBe(false)
    expect(internetPreview?.status).toBe('blocked')
    expect(internetPreview?.body).toBe('[driver] can be reached at [email].')
  })

  it('redacts all UTF8 atext and prioritizes explicit whole mailboxes before internet preview', () => {
    const unicodeAtextMailbox = 'maría\u2019team@example.com'
    const explicitUnicodeMailbox = 'maría\u2011team@example.com'
    const statement = `Alice can be reached at ${unicodeAtextMailbox} or ${explicitUnicodeMailbox}.`
    const piiEvidence = evidence('evidence-unicode-atext', {
      statement,
      eventType: 'explicit',
      privacyClass: 'D3',
      consent: { state: 'unknown', subjectRef: 'driver-1', epoch: 1, checkedAt: NOW },
      pii: [
        { kind: 'name', value: 'Alice' },
        { kind: 'email', value: explicitUnicodeMailbox }
      ],
      piiAttestation: { status: 'pii-declared', method: 'fixture-unicode-atext-review-v1', checkedAt: NOW },
      claim: { subjectRef: 'driver-1', predicate: 'unicode-contact-card', value: true },
      facts: { rank: 0.8, title: 'Contact Alice', statement }
    })
    const piiEvent = event('event-unicode-atext', {
      type: 'explicit',
      evidenceRefs: ['evidence-unicode-atext'],
      assertionId: 'unicode-contact-card',
      claim: { subjectRef: 'driver-1', predicate: 'unicode-contact-card', value: true },
      facts: { rank: 0.8 },
      title: 'Contact Alice',
      statement
    })

    const [card] = generateStoryCards(timeline([piiEvent], [piiEvidence]), NOW).candidates
    const expectedBody = '[driver] can be reached at [email] or [email].'
    const internetPreview = storyPreview(card, 'internet')
    expect(card.body).toBe(expectedBody)
    expect(card.body).not.toContain('maría\u2019')
    expect(card.body).not.toContain('maría\u2011')
    expect(card.redactions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'email',
        reason: 'explicit-pii',
        evidenceRef: expect.stringMatching(/^evidence-/)
      })
    ]))
    expect(internetPreview?.status).toBe('blocked')
    expect(internetPreview?.body).toBe(expectedBody)
  })

  it('fails closed when evidence has no PII attestation', () => {
    const unattested = evidence('evidence-unattested', {
      piiAttestation: undefined as never
    })
    const result = generateStoryCards(
      timeline([event('event-unattested', { evidenceRefs: ['evidence-unattested'] })], [unattested]),
      NOW
    )

    expect(result.candidates).toHaveLength(0)
    expect(result.issues.some((issue) => issue.code === 'invalid-evidence')).toBe(true)
  })

  it('fails a none-detected attestation when international PII is present', () => {
    const claim = { subjectRef: 'driver-1', predicate: 'contact-attestation', value: true }
    const statement = 'Contact jose\u0301@example.com or +٩٦٦ ٥٥ ١٢٣ ٤٥٦٧.'
    const facts = { rank: 0.5, title: 'Contact card', statement }
    const result = generateStoryCards(
      timeline(
        [event('event-unattested-pii', {
          type: 'explicit',
          assertionId: 'caller-contact',
          evidenceRefs: ['evidence-unattested-pii'],
          claim,
          facts: { rank: 0.5 },
          title: 'Contact card',
          statement
        })],
        [evidence('evidence-unattested-pii', {
          eventType: 'explicit',
          claim,
          facts,
          statement,
          piiAttestation: { status: 'none-detected', method: 'incorrect-review-v1', checkedAt: NOW }
        })]
      ),
      NOW
    )

    expect(result.candidates).toHaveLength(0)
    expect(result.issues.some((issue) =>
      issue.code === 'invalid-evidence' && issue.message.includes('failed PII attestation')
    )).toBe(true)
  })

  it('fails a none-detected attestation for contextual middle-dot mailboxes', () => {
    const claim = { subjectRef: 'driver-1', predicate: 'contact-attestation', value: true }
    const statement = 'Contact josé\u00B7ops@example.com or racer@l\u00B7l.cat.'
    const facts = { rank: 0.5, title: 'Contact card', statement }
    const result = generateStoryCards(
      timeline(
        [event('event-unattested-middle-dot-mailboxes', {
          type: 'explicit',
          assertionId: 'caller-middle-dot-mailboxes',
          evidenceRefs: ['evidence-unattested-middle-dot-mailboxes'],
          claim,
          facts: { rank: 0.5 },
          title: 'Contact card',
          statement
        })],
        [evidence('evidence-unattested-middle-dot-mailboxes', {
          eventType: 'explicit',
          claim,
          facts,
          statement,
          piiAttestation: { status: 'none-detected', method: 'incorrect-review-v1', checkedAt: NOW }
        })]
      ),
      NOW
    )

    expect(result.candidates).toHaveLength(0)
    expect(result.issues.some((issue) =>
      issue.code === 'invalid-evidence' && issue.message.includes('email detected')
    )).toBe(true)
  })

  it('does not redact a middle dot outside its valid IDNA label context', () => {
    const claim = { subjectRef: 'driver-1', predicate: 'identifier-attestation', value: true }
    const statement = 'The identifier racer@a\u00B7b.cat is not an IDNA-valid mailbox.'
    const facts = { rank: 0.5, title: 'Identifier card', statement }
    const result = generateStoryCards(
      timeline(
        [event('event-invalid-middle-dot-domain', {
          type: 'explicit',
          assertionId: 'invalid-middle-dot-domain',
          evidenceRefs: ['evidence-invalid-middle-dot-domain'],
          claim,
          facts: { rank: 0.5 },
          title: 'Identifier card',
          statement
        })],
        [evidence('evidence-invalid-middle-dot-domain', {
          eventType: 'explicit',
          claim,
          facts,
          statement,
          piiAttestation: { status: 'none-detected', method: 'fixture-review-v1', checkedAt: NOW }
        })]
      ),
      NOW
    )

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].body).toContain('racer@a\u00B7b.cat')
    expect(result.candidates[0].redactions.some((redaction) => redaction.kind === 'email')).toBe(false)
  })

  it('fails a none-detected attestation for an international phone using non-breaking hyphens', () => {
    const claim = { subjectRef: 'driver-1', predicate: 'contact-attestation', value: true }
    const statement = 'Call +44\u201120\u20117946\u20110958.'
    const facts = { rank: 0.5, title: 'Phone card', statement }
    const result = generateStoryCards(
      timeline(
        [event('event-unattested-unicode-phone', {
          type: 'explicit',
          assertionId: 'caller-unicode-phone',
          evidenceRefs: ['evidence-unattested-unicode-phone'],
          claim,
          facts: { rank: 0.5 },
          title: 'Phone card',
          statement
        })],
        [evidence('evidence-unattested-unicode-phone', {
          eventType: 'explicit',
          claim,
          facts,
          statement,
          piiAttestation: { status: 'none-detected', method: 'incorrect-review-v1', checkedAt: NOW }
        })]
      ),
      NOW
    )

    expect(result.candidates).toHaveLength(0)
    expect(result.issues.some((issue) =>
      issue.code === 'invalid-evidence' && issue.message.includes('phone detected')
    )).toBe(true)
  })

  it('fails a none-detected attestation for compressed IPv6 addresses', () => {
    const claim = { subjectRef: 'stream-1', predicate: 'endpoint-attestation', value: true }
    const statement = 'Observed endpoint 2001:db8::1.'
    const facts = { rank: 0.4, title: 'Endpoint card', statement }
    const result = generateStoryCards(
      timeline(
        [event('event-ipv6', {
          type: 'explicit',
          assertionId: 'caller-ipv6',
          evidenceRefs: ['evidence-ipv6'],
          claim,
          facts: { rank: 0.4 },
          title: 'Endpoint card',
          statement
        })],
        [evidence('evidence-ipv6', {
          eventType: 'explicit',
          claim,
          facts,
          statement,
          piiAttestation: { status: 'none-detected', method: 'incorrect-review-v1', checkedAt: NOW }
        })]
      ),
      NOW
    )

    expect(result.candidates).toHaveLength(0)
    expect(result.issues.some((issue) =>
      issue.code === 'invalid-evidence' && issue.message.includes('ip detected')
    )).toBe(true)
  })

  it('redacts a full IPv4-embedded compressed IPv6 token before narrower IPv4 matching', () => {
    const address = '2001:db8::192.0.2.128'
    const claim = { subjectRef: 'stream-1', predicate: 'endpoint-attestation', value: true }
    const statement = `Observed endpoint ${address}.`
    const facts = { rank: 0.4, title: 'Endpoint card', statement }
    const result = generateStoryCards(
      timeline(
        [event('event-mixed-ipv6', {
          type: 'explicit',
          assertionId: 'caller-mixed-ipv6',
          evidenceRefs: ['evidence-mixed-ipv6'],
          claim,
          facts: { rank: 0.4 },
          title: 'Endpoint card',
          statement
        })],
        [evidence('evidence-mixed-ipv6', {
          eventType: 'explicit',
          claim,
          facts,
          statement,
          pii: [{ kind: 'ip', value: '192.0.2.128' }],
          piiAttestation: { status: 'pii-declared', method: 'endpoint-review-v1', checkedAt: NOW }
        })]
      ),
      NOW
    )

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].body).toContain('[ip]')
    expect(result.candidates[0].body).not.toContain('2001:db8::')
    expect(result.candidates[0].body).not.toContain('192.0.2.128')
  })

  it('collapses duplicate cards that use the same explicit claim and evidence', () => {
    const duplicate = event('event-2', {
      assertionId: 'finish-position-copy',
      claim: { subjectRef: 'car-7', predicate: 'recorded-finish-position', value: 2 }
    })
    const result = generateStoryCards(timeline([event(), duplicate]), NOW)

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].eventIds).toHaveLength(2)
    expect(result.candidates[0].eventIds.every((id) => id.startsWith('event-'))).toBe(true)
    expect(result.issues.some((issue) => issue.code === 'duplicate-card')).toBe(true)
  })

  it('keeps revoked-rights cards visible for audit but blocks every approval destination', () => {
    const revoked = evidence('evidence-revoked', {
      rights: { state: 'revoked', scope: 'prohibited', checkedAt: NOW }
    })
    const result = generateStoryCards(
      timeline([event('event-revoked', { evidenceRefs: ['evidence-revoked'] })], [revoked]),
      NOW
    )

    expect(result.candidates).toHaveLength(1)
    const card = result.candidates[0]
    expect(card.previews.every((preview) => preview.status === 'blocked')).toBe(true)
    expect(storyApprovalBlockReason(card, 'local', NOW)).toContain('rights:revoked')
  })

  it('applies an explicit source-to-session offset before linking evidence to an event', () => {
    const offsetEvidence = evidence('evidence-offset', {
      clock: { clock: 'replay', sourceTimeMs: 1_000, toSessionOffsetMs: 9_000, uncertaintyMs: 0 },
      captureRange: { start: 900, end: 1_100, unit: 'ms' },
      source: 'replay-bookmark',
      replayState: 'replay'
    })
    const result = generateStoryCards(
      timeline([event('event-offset', { evidenceRefs: ['evidence-offset'] })], [offsetEvidence]),
      NOW
    )

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].provenance[0]).toMatchObject({
      normalizedSessionTimeMs: 10_000,
      clockOffsetMs: 9_000,
      replayState: 'replay'
    })
  })

  it('rejects an absolute fastest-lap claim without explicit best-lap equality', () => {
    const claim = { subjectRef: 'car-7', predicate: 'recorded-fastest-lap-time', value: 82.5 }
    const facts = {
      subjectLabel: 'Car 7',
      lapTimeSec: 82.5,
      bestLapTimeSec: 82.5005,
      fastestScope: 'session-best',
      lap: 4
    }
    const result = generateStoryCards(
      timeline(
        [event('fastest-without-best', {
          type: 'fastest-lap',
          assertionId: 'caller-fastest',
          lap: 4,
          evidenceRefs: ['fastest-evidence'],
          claim,
          facts
        })],
        [evidence('fastest-evidence', {
          eventType: 'fastest-lap',
          claim,
          facts
        })]
      ),
      NOW
    )

    expect(result.candidates).toHaveLength(0)
    expect(result.issues.some((issue) =>
      issue.code === 'invalid-event' && issue.message.includes('session-best equality')
    )).toBe(true)
  })

  it('uses scoped wording unless the observed lap explicitly equals the session best', () => {
    const observedClaim = { subjectRef: 'car-7', predicate: 'fastest-observed-since-capture', value: 82.5 }
    const observedFacts = {
      subjectLabel: 'Car 7',
      lapTimeSec: 82.5,
      fastestScope: 'since-capture',
      lap: 4
    }
    const observed = generateStoryCards(
      timeline(
        [event('fastest-observed', {
          type: 'fastest-lap',
          assertionId: 'caller-observed',
          lap: 4,
          evidenceRefs: ['observed-evidence'],
          claim: observedClaim,
          facts: observedFacts
        })],
        [evidence('observed-evidence', {
          eventType: 'fastest-lap',
          claim: observedClaim,
          facts: observedFacts
        })]
      ),
      NOW
    ).candidates[0]
    expect(observed.title).toContain('Fastest observed since capture')

    const bestClaim = { subjectRef: 'car-7', predicate: 'recorded-fastest-lap-time', value: 81.234 }
    const bestFacts = {
      subjectLabel: 'Car 7',
      lapTimeSec: 81.234,
      bestLapTimeSec: 81.234,
      fastestScope: 'session-best',
      lap: 5
    }
    const sessionBest = generateStoryCards(
      timeline(
        [event('fastest-session-best', {
          type: 'fastest-lap',
          assertionId: 'caller-session-best',
          lap: 5,
          evidenceRefs: ['session-best-evidence'],
          claim: bestClaim,
          facts: bestFacts
        })],
        [evidence('session-best-evidence', {
          eventType: 'fastest-lap',
          claim: bestClaim,
          facts: bestFacts
        })]
      ),
      NOW
    ).candidates[0]
    expect(sessionBest.title).toContain('Recorded fastest lap')
    expect(sessionBest.body).toContain('matches the explicit session-best value')
  })

  it('detects conflicting session-best claims for the same lap across different timestamps', () => {
    const firstClaim = { subjectRef: 'car-7', predicate: 'recorded-fastest-lap-time', value: 82.5 }
    const secondClaim = { subjectRef: 'car-7', predicate: 'recorded-fastest-lap-time', value: 83 }
    const firstFacts = {
      subjectLabel: 'Car 7',
      lapTimeSec: 82.5,
      bestLapTimeSec: 82.5,
      fastestScope: 'session-best',
      lap: 4
    }
    const secondFacts = {
      subjectLabel: 'Car 7',
      lapTimeSec: 83,
      bestLapTimeSec: 83,
      fastestScope: 'session-best',
      lap: 4
    }
    const result = generateStoryCards(
      timeline(
        [
          event('same-lap-fastest-a', {
            type: 'fastest-lap',
            assertionId: 'caller-fastest-a',
            sessionTimeMs: 10_000,
            lap: 4,
            evidenceRefs: ['same-lap-evidence-a'],
            claim: firstClaim,
            facts: firstFacts
          }),
          event('same-lap-fastest-b', {
            type: 'fastest-lap',
            assertionId: 'caller-fastest-b',
            sessionTimeMs: 10_001,
            lap: 4,
            evidenceRefs: ['same-lap-evidence-b'],
            claim: secondClaim,
            facts: secondFacts
          })
        ],
        [
          evidence('same-lap-evidence-a', {
            eventType: 'fastest-lap',
            claim: firstClaim,
            facts: firstFacts
          }),
          evidence('same-lap-evidence-b', {
            eventType: 'fastest-lap',
            claim: secondClaim,
            facts: secondFacts,
            captureRange: { start: 10_001, end: 10_001, unit: 'ms' },
            clock: { clock: 'sim', sourceTimeMs: 10_001, toSessionOffsetMs: 0 }
          })
        ]
      ),
      NOW
    )

    expect(result.candidates).toHaveLength(0)
    expect(result.issues.some((issue) => issue.code === 'contradictory-events')).toBe(true)
  })

  it('uses one canonical lap-time identity across fastest-lap wording scopes', () => {
    const observedClaim = { subjectRef: 'car-7', predicate: 'fastest-observed-since-capture', value: 83 }
    const bestClaim = { subjectRef: 'car-7', predicate: 'recorded-fastest-lap-time', value: 82.5 }
    const observedFacts = {
      subjectLabel: 'Car 7',
      lapTimeSec: 83,
      fastestScope: 'since-capture',
      lap: 4
    }
    const bestFacts = {
      subjectLabel: 'Car 7',
      lapTimeSec: 82.5,
      bestLapTimeSec: 82.5,
      fastestScope: 'session-best',
      lap: 4
    }
    const result = generateStoryCards(
      timeline(
        [
          event('mixed-scope-observed', {
            type: 'fastest-lap',
            assertionId: 'caller-mixed-observed',
            sessionTimeMs: 10_000,
            lap: 4,
            evidenceRefs: ['mixed-scope-observed-evidence'],
            claim: observedClaim,
            facts: observedFacts
          }),
          event('mixed-scope-best', {
            type: 'fastest-lap',
            assertionId: 'caller-mixed-best',
            sessionTimeMs: 10_001,
            lap: 4,
            evidenceRefs: ['mixed-scope-best-evidence'],
            claim: bestClaim,
            facts: bestFacts
          })
        ],
        [
          evidence('mixed-scope-observed-evidence', {
            eventType: 'fastest-lap',
            claim: observedClaim,
            facts: observedFacts
          }),
          evidence('mixed-scope-best-evidence', {
            eventType: 'fastest-lap',
            claim: bestClaim,
            facts: bestFacts,
            captureRange: { start: 10_001, end: 10_001, unit: 'ms' },
            clock: { clock: 'sim', sourceTimeMs: 10_001, toSessionOffsetMs: 0 }
          })
        ]
      ),
      NOW
    )

    expect(result.candidates).toHaveLength(0)
    expect(result.issues.some((issue) => issue.code === 'contradictory-events')).toBe(true)
  })

  it('rejects event facts that are not attested by the linked evidence payload', () => {
    const unsupported = event('event-unsupported', {
      claim: { subjectRef: 'car-7', predicate: 'recorded-finish-position', value: 1 },
      facts: { subjectLabel: 'Car 7', position: 1, totalCars: 20 }
    })
    const result = generateStoryCards(timeline([unsupported]), NOW)

    expect(result.candidates).toHaveLength(0)
    expect(result.issues.some((issue) => issue.code === 'invalid-evidence')).toBe(true)
  })

  it('rejects a claim predicate whose semantics do not match the story event type', () => {
    const weakClaim = { subjectRef: 'car-7', predicate: 'current-position', value: 2 }
    const weakEvidence = evidence('evidence-weak-type', { claim: weakClaim })
    const weakEvent = event('event-weak-type', {
      evidenceRefs: ['evidence-weak-type'],
      claim: weakClaim
    })
    const result = generateStoryCards(timeline([weakEvent], [weakEvidence]), NOW)

    expect(result.candidates).toHaveLength(0)
    expect(result.issues.some((issue) => issue.code === 'invalid-event')).toBe(true)
  })

  it('rejects a claim value that contradicts the rendered event facts', () => {
    const inconsistentClaim = { subjectRef: 'car-7', predicate: 'recorded-finish-position', value: 2 }
    const inconsistentFacts = { subjectLabel: 'Car 7', position: 1, totalCars: 20 }
    const result = generateStoryCards(
      timeline(
        [event('event-inconsistent', {
          evidenceRefs: ['evidence-inconsistent'],
          claim: inconsistentClaim,
          facts: inconsistentFacts
        })],
        [evidence('evidence-inconsistent', {
          claim: inconsistentClaim,
          facts: inconsistentFacts
        })]
      ),
      NOW
    )

    expect(result.candidates).toHaveLength(0)
    expect(result.issues.some((issue) => issue.code === 'invalid-event')).toBe(true)
  })

  it('fails closed when imported rights or consent policy values are unknown', () => {
    const invalidPolicy = evidence('evidence-invalid-policy', {
      rights: { state: 'typo' as never, scope: 'typo' as never, checkedAt: NOW }
    })
    const result = generateStoryCards(
      timeline([event('event-invalid-policy', { evidenceRefs: ['evidence-invalid-policy'] })], [invalidPolicy]),
      NOW
    )

    expect(result.candidates).toHaveLength(0)
    expect(result.issues.some((issue) => issue.code === 'invalid-evidence')).toBe(true)
  })

  it('rejects duplicate evidence identifiers instead of selecting one policy record', () => {
    const duplicateId = 'duplicate-evidence'
    const result = generateStoryCards(
      timeline(
        [event('event-duplicate-evidence', { evidenceRefs: [duplicateId] })],
        [
          evidence(duplicateId, {
            rights: { state: 'revoked', scope: 'prohibited', checkedAt: NOW }
          }),
          evidence(duplicateId)
        ]
      ),
      NOW
    )

    expect(result.candidates).toHaveLength(0)
    expect(result.issues.some((issue) => issue.code === 'invalid-evidence')).toBe(true)
  })

  it('abstains when duplicate cards carry conflicting authorization metadata', () => {
    const firstEvidence = evidence('auth-evidence-a', { contentHash: 'c'.repeat(64) })
    const secondEvidence = evidence('auth-evidence-b', {
      contentHash: `sha256:${'c'.repeat(64)}`,
      rights: { state: 'revoked', scope: 'prohibited', checkedAt: NOW }
    })
    const result = generateStoryCards(
      timeline(
        [
          event('auth-event-a', {
            assertionId: 'finish-auth-a',
            evidenceRefs: ['auth-evidence-a']
          }),
          event('auth-event-b', {
            assertionId: 'finish-auth-b',
            evidenceRefs: ['auth-evidence-b'],
            title: 'Unused finish metadata'
          })
        ],
        [firstEvidence, secondEvidence]
      ),
      NOW
    )

    expect(result.candidates).toHaveLength(0)
    expect(result.issues.some((issue) =>
      issue.code === 'invalid-evidence' && issue.message.includes('conflicting policy')
    )).toBe(true)
  })

  it('returns a validation issue instead of throwing on malformed IPC event metadata', () => {
    const malformed = {
      ...event('malformed-event'),
      assertionId: 1
    } as unknown as StoryTimelineEvent

    expect(() => generateStoryCards(timeline([malformed]), NOW)).not.toThrow()
    const result = generateStoryCards(timeline([malformed]), NOW)
    expect(result.candidates).toHaveLength(0)
    expect(result.issues.some((issue) => issue.code === 'invalid-event')).toBe(true)
  })

  it('requires the completed post-race marker to be the boolean true', () => {
    const malformedCompletion = {
      ...timeline(),
      completed: 'false'
    } as unknown as StoryRaceTimeline
    const result = generateStoryCards(malformedCompletion, NOW)

    expect(result.candidates).toHaveLength(0)
    expect(result.issues.some((issue) => issue.code === 'timeline-not-complete')).toBe(true)
  })

  it('preserves revoked consent even for low-classification evidence', () => {
    const revokedConsent = evidence('evidence-consent-revoked', {
      consent: { state: 'revoked', subjectRef: 'car-7', epoch: 2, checkedAt: NOW }
    })
    const result = generateStoryCards(
      timeline([event('event-consent-revoked', { evidenceRefs: ['evidence-consent-revoked'] })], [revokedConsent]),
      NOW
    )

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].policy.consentState).toBe('revoked')
    expect(result.candidates[0].previews.every((preview) => preview.status === 'blocked')).toBe(true)
  })

  it('changes the review revision when an exported timeline field changes', () => {
    const first = generateStoryCards(timeline(), NOW).candidates[0]
    const shiftedEvidence = evidence('evidence-1', {
      captureRange: { start: 6_500, end: 6_500, unit: 'ms' },
      clock: { clock: 'sim', sourceTimeMs: 6_500, toSessionOffsetMs: 0 }
    })
    const shiftedEvent = event('event-1', { sessionTimeMs: 6_500 })
    const second = generateStoryCards(timeline([shiftedEvent], [shiftedEvidence]), NOW).candidates[0]

    expect(second.id).toBe(first.id)
    expect(second.revision).not.toBe(first.revision)
    expect(second.observedInterval.startSessionTimeMs).toBe(6_500)
  })

  it('changes the review revision when consent subject or epoch changes', () => {
    const claim = { subjectRef: 'car-7', predicate: 'recorded-finish-position', value: 2 }
    const firstEvidence = evidence('evidence-consent', {
      claim,
      consent: { state: 'granted', subjectRef: 'car-7', epoch: 1, checkedAt: NOW }
    })
    const secondEvidence = evidence('evidence-consent', {
      claim,
      consent: { state: 'granted', subjectRef: 'car-7', epoch: 2, checkedAt: NOW }
    })
    const linkedEvent = event('event-consent', {
      evidenceRefs: ['evidence-consent'],
      claim
    })
    const first = generateStoryCards(timeline([linkedEvent], [firstEvidence]), NOW).candidates[0]
    const second = generateStoryCards(timeline([linkedEvent], [secondEvidence]), NOW).candidates[0]

    expect(first.policy.authorizationRef).not.toBe(second.policy.authorizationRef)
    expect(first.revision).not.toBe(second.revision)
  })
})
