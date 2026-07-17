import { describe, expect, it } from 'vitest'
import {
  assertSerializedLengthsWithinRuntimeCeiling,
  canonicalStringify,
  utf8ByteLength
} from './canonical'
import {
  APPROVED_EXACT_ARTIFACT_COUNT,
  MAX_ARTIFACTS,
  MAX_CANONICAL_NODES,
  MAX_CANONICAL_NODES_PER_EVENT,
  MAX_EVIDENCE,
  MAX_EVIDENCE_PER_ACCEPTED_REVISION,
  MAX_EVENTS_PER_ACCEPTED_REVISION,
  MAX_IMAGE_ATTEMPTS,
  MAX_IDENTIFIER_LENGTH,
  MAX_LEDGER_EVENTS,
  MAX_PLAN_ID_LENGTH,
  MAX_REVISIONS_PER_ARTIFACT,
  MAX_RESERVATION_RELEASES,
  MAX_PLAN_ARTIFACTS,
  MAX_SCHEDULER_EVENTS,
  MAX_SCHEDULER_EVENTS_PER_ATTEMPT,
  MAX_SCHEDULER_EVENTS_PER_RELEASE,
  MAX_SCHEDULER_LOGICAL_ATTEMPTS,
  MAX_SERIALIZED_BYTES,
  MAX_SERIALIZED_CHARACTERS,
  MAX_SERIALIZED_BYTES_PER_ARTIFACT_REVISION,
  MAX_SERIALIZED_BYTES_PER_SCHEDULER_ATTEMPT,
  MAX_SERIALIZED_LEDGER_FRAMING_BYTES,
  MAX_SERIALIZED_SCHEDULER_FRAMING_BYTES,
  MIN_TOTAL_ARTIFACT_COUNT,
  RUNTIME_MAX_STRING_LENGTH,
  SERIALIZED_STRING_SAFETY_PERCENT
} from './constants'
import { VisualArtifactLedger } from './ledger'
import { createArtifactPlan, expectedArtifactIds } from './plan'
import {
  HashPool,
  TestClock,
  appendAcceptedArtifact,
  makeGovernance,
  makePlan,
  makeScheduler
} from './test-fixtures'

describe('derived maximum-state resource limits', () => {
  it('covers every event/evidence in the documented maximum accepted revision state', () => {
    expect(MAX_REVISIONS_PER_ARTIFACT).toBe(2)
    expect(MAX_IMAGE_ATTEMPTS).toBe(3)
    expect(MAX_LEDGER_EVENTS).toBe(
      MAX_ARTIFACTS *
        MAX_REVISIONS_PER_ARTIFACT *
        MAX_EVENTS_PER_ACCEPTED_REVISION +
        1
    )
    expect(MAX_EVIDENCE).toBe(
      MAX_ARTIFACTS *
        MAX_REVISIONS_PER_ARTIFACT *
        MAX_EVIDENCE_PER_ACCEPTED_REVISION
    )
    expect(MAX_SCHEDULER_EVENTS).toBe(
      MAX_SCHEDULER_LOGICAL_ATTEMPTS *
        MAX_SCHEDULER_EVENTS_PER_ATTEMPT +
        MAX_RESERVATION_RELEASES * MAX_SCHEDULER_EVENTS_PER_RELEASE +
        1
    )
    expect(MAX_SCHEDULER_LOGICAL_ATTEMPTS).toBe(
      MAX_ARTIFACTS * MAX_REVISIONS_PER_ARTIFACT * MAX_IMAGE_ATTEMPTS
    )
    expect(MAX_ARTIFACTS).toBeGreaterThanOrEqual(MIN_TOTAL_ARTIFACT_COUNT)
    expect(MAX_PLAN_ARTIFACTS).toBeGreaterThanOrEqual(
      APPROVED_EXACT_ARTIFACT_COUNT
    )
    expect(SERIALIZED_STRING_SAFETY_PERCENT).toBeLessThanOrEqual(90)
    expect(MAX_SERIALIZED_CHARACTERS).toBe(
      Math.floor(
        (RUNTIME_MAX_STRING_LENGTH * SERIALIZED_STRING_SAFETY_PERCENT) / 100
      )
    )
    expect(MAX_CANONICAL_NODES).toBeGreaterThanOrEqual(
      MAX_LEDGER_EVENTS * MAX_CANONICAL_NODES_PER_EVENT
    )
  })

  it('budgets maximum ledger and scheduler serialization below the parser byte ceiling', () => {
    const maximumLedgerBytes =
      MAX_ARTIFACTS *
        MAX_REVISIONS_PER_ARTIFACT *
        MAX_SERIALIZED_BYTES_PER_ARTIFACT_REVISION +
      MAX_SERIALIZED_LEDGER_FRAMING_BYTES
    const maximumSchedulerBytes =
      MAX_SCHEDULER_LOGICAL_ATTEMPTS *
        MAX_SERIALIZED_BYTES_PER_SCHEDULER_ATTEMPT +
      MAX_RESERVATION_RELEASES *
        MAX_SERIALIZED_BYTES_PER_SCHEDULER_ATTEMPT +
      MAX_SERIALIZED_SCHEDULER_FRAMING_BYTES

    expect(maximumLedgerBytes).toBeLessThanOrEqual(MAX_SERIALIZED_BYTES)
    expect(maximumSchedulerBytes).toBeLessThanOrEqual(MAX_SERIALIZED_BYTES)
    expect(maximumLedgerBytes).toBeLessThanOrEqual(MAX_SERIALIZED_CHARACTERS)
    expect(maximumSchedulerBytes).toBeLessThanOrEqual(MAX_SERIALIZED_CHARACTERS)
    expect(MAX_SERIALIZED_BYTES_PER_ARTIFACT_REVISION).toBeGreaterThanOrEqual(13_000)
    expect(MAX_SERIALIZED_BYTES_PER_SCHEDULER_ATTEMPT).toBeGreaterThanOrEqual(4_300)
  })

  it('rejects reported parser lengths above the runtime-safe ceiling without allocation', () => {
    expect(() =>
      assertSerializedLengthsWithinRuntimeCeiling(
        MAX_SERIALIZED_CHARACTERS + 1,
        MAX_SERIALIZED_BYTES,
        'Serialized ledger'
      )
    ).toThrow(/runtime-safe single-string ceiling/i)
    expect(() =>
      assertSerializedLengthsWithinRuntimeCeiling(
        MAX_SERIALIZED_CHARACTERS,
        MAX_SERIALIZED_BYTES + 1,
        'Serialized scheduler'
      )
    ).toThrow(/runtime-safe single-string ceiling/i)
  })

  it('accepts a full revision with maximum-length authenticated principal identifiers', () => {
    const governance = makeGovernance()
    const scheduler = makeScheduler(governance)
    const basePlan = makePlan()
    const plan = createArtifactPlan({
      registryHash: basePlan.registryHash,
      styles: basePlan.styles.map((identity, index) =>
        index === 0
          ? { id: 's'.repeat(MAX_PLAN_ID_LENGTH), ordinal: identity.ordinal }
          : identity
      ),
      concepts: basePlan.concepts.map((identity, index) =>
        index === 0
          ? { id: 'c'.repeat(MAX_PLAN_ID_LENGTH), ordinal: identity.ordinal }
          : identity
      ),
      triggerFamilies: basePlan.triggerFamilies
    })
    const ledger = VisualArtifactLedger.create(
      plan,
      governance.ledgerDependencies(scheduler)
    )
    const artifactId = expectedArtifactIds(plan)[50]
    appendAcceptedArtifact(
      ledger,
      scheduler,
      governance,
      artifactId,
      1,
      new HashPool(),
      new TestClock(1_000_000),
      {
        actors: {
          planner: 'p'.repeat(MAX_IDENTIFIER_LENGTH),
          researcher: 'r'.repeat(MAX_IDENTIFIER_LENGTH),
          promptAuthor: 'd'.repeat(MAX_IDENTIFIER_LENGTH),
          promptReviewer: 'q'.repeat(MAX_IDENTIFIER_LENGTH),
          imageGenerator: 'g'.repeat(MAX_IDENTIFIER_LENGTH),
          imageReviewer: 'i'.repeat(MAX_IDENTIFIER_LENGTH),
          implementer: 'm'.repeat(MAX_IDENTIFIER_LENGTH),
          renderReviewer: 'v'.repeat(MAX_IDENTIFIER_LENGTH),
          acceptanceOwner: 'a'.repeat(MAX_IDENTIFIER_LENGTH)
        }
      }
    )
    const revisionBytes = ledger
      .events()
      .reduce((total, event) => total + utf8ByteLength(canonicalStringify(event)), 0)
    expect(ledger.getArtifact(artifactId)?.revisions[0].status).toBe('accepted')
    expect(revisionBytes).toBeLessThanOrEqual(
      MAX_SERIALIZED_BYTES_PER_ARTIFACT_REVISION
    )
  })
})
