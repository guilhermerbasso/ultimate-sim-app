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
        evidenceRefs: ['evidence-a'],
        claim: { subjectRef: 'car-7', predicate: 'recorded-finish-position', value: 2 },
        facts: { subjectLabel: 'Car 7', position: 2 }
      }),
      event('finish-b', {
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

  it('does not let an invalid superseding event hide contradictory facts', () => {
    const events = [
      event('finish-a', {
        evidenceRefs: ['evidence-a'],
        claim: { subjectRef: 'car-7', predicate: 'recorded-finish-position', value: 2 },
        facts: { subjectLabel: 'Car 7', position: 2 }
      }),
      event('finish-b', {
        evidenceRefs: ['evidence-b'],
        claim: { subjectRef: 'car-7', predicate: 'recorded-finish-position', value: 3 },
        facts: { subjectLabel: 'Car 7', position: 3 }
      }),
      event('bad-correction', {
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
      claim: { subjectRef: 'driver-1', predicate: 'podium-attestation', value: true },
      facts: {
        rank: 0.8,
        title: 'Podium for Alice Example',
        statement: 'Alice Example finished on the podium. Contact alice@example.com or +1 555 123 4567.'
      }
    })
    const piiEvent = event('event-pii', {
      type: 'explicit',
      evidenceRefs: ['evidence-pii'],
      assertionId: 'podium-attestation',
      claim: { subjectRef: 'driver-1', predicate: 'podium-attestation', value: true },
      facts: { rank: 0.8 },
      title: 'Podium for Alice Example',
      statement: 'Alice Example finished on the podium. Contact alice@example.com or +1 555 123 4567.'
    })

    const [card] = generateStoryCards(timeline([piiEvent], [piiEvidence]), NOW).candidates
    expect(card.title).toBe('Podium for [driver]')
    expect(card.body).not.toContain('alice@example.com')
    expect(card.body).not.toContain('555 123 4567')
    expect(card.redactions.map((redaction) => redaction.kind)).toEqual(expect.arrayContaining(['name', 'email', 'phone']))
    expect(card.redactions.find((redaction) => redaction.kind === 'name')?.evidenceRef).toMatch(/^evidence-/)
    expect(card.provenance[0].confidenceMethod).toMatch(/^confidence-method-/)
    expect(card.provenance[0].confidenceMethod).not.toContain('@')
    expect(storyPreview(card, 'local')?.status).toBe('redacted')
    expect(storyPreview(card, 'internet')?.status).toBe('blocked')
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
