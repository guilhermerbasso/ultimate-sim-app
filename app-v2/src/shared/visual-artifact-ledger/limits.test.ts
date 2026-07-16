import { describe, expect, it } from 'vitest'
import { canonicalStringify, utf8ByteLength } from './canonical'
import {
  APPROVED_EXACT_ARTIFACT_COUNT,
  MAX_ARTIFACTS,
  MAX_CANONICAL_NODES,
  MAX_CANONICAL_NODES_PER_EVENT,
  MAX_EVIDENCE,
  MAX_EVIDENCE_PER_ACCEPTED_REVISION,
  MAX_EVENTS_PER_ACCEPTED_REVISION,
  MAX_IMAGE_ATTEMPTS,
  MAX_LEDGER_EVENTS,
  MAX_REVISIONS_PER_ARTIFACT,
  MAX_PLAN_ARTIFACTS,
  MAX_SCHEDULER_EVENTS,
  MAX_SCHEDULER_EVENTS_PER_ATTEMPT,
  MAX_SERIALIZED_BYTES,
  MAX_SERIALIZED_BYTES_PER_ARTIFACT_REVISION,
  MAX_SERIALIZED_BYTES_PER_SCHEDULER_ATTEMPT,
  MAX_SERIALIZED_JSON_FRAMING_BYTES,
  MAX_SERIALIZED_PLAN_BYTES,
  MIN_TOTAL_ARTIFACT_COUNT
} from './constants'
import { VisualArtifactLedger } from './ledger'
import { expectedArtifactIds } from './plan'
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
      MAX_ARTIFACTS *
        MAX_REVISIONS_PER_ARTIFACT *
        MAX_IMAGE_ATTEMPTS *
        MAX_SCHEDULER_EVENTS_PER_ATTEMPT +
        1
    )
    expect(MAX_ARTIFACTS).toBeGreaterThanOrEqual(MIN_TOTAL_ARTIFACT_COUNT)
    expect(MAX_PLAN_ARTIFACTS).toBeGreaterThanOrEqual(
      APPROVED_EXACT_ARTIFACT_COUNT
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
      MAX_SERIALIZED_PLAN_BYTES +
      MAX_SERIALIZED_JSON_FRAMING_BYTES
    const maximumSchedulerBytes =
      MAX_ARTIFACTS *
        MAX_REVISIONS_PER_ARTIFACT *
        MAX_IMAGE_ATTEMPTS *
        MAX_SERIALIZED_BYTES_PER_SCHEDULER_ATTEMPT +
      MAX_SERIALIZED_PLAN_BYTES +
      MAX_SERIALIZED_JSON_FRAMING_BYTES

    expect(maximumLedgerBytes).toBeLessThanOrEqual(MAX_SERIALIZED_BYTES)
    expect(maximumSchedulerBytes).toBeLessThanOrEqual(MAX_SERIALIZED_BYTES)
    expect(MAX_SERIALIZED_BYTES_PER_ARTIFACT_REVISION).toBeGreaterThanOrEqual(
      Math.ceil(16_465 * 1.25)
    )
    expect(MAX_SERIALIZED_BYTES_PER_SCHEDULER_ATTEMPT).toBeGreaterThanOrEqual(
      Math.ceil(5_240 * 1.25)
    )
  })

  it('accepts a full revision with maximum-length authenticated principal identifiers', () => {
    const governance = makeGovernance()
    const scheduler = makeScheduler(governance)
    const plan = makePlan()
    const ledger = VisualArtifactLedger.create(
      plan,
      governance.ledgerDependencies(scheduler)
    )
    const artifactId = expectedArtifactIds(plan)[0]
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
          planner: 'p'.repeat(128),
          researcher: 'r'.repeat(128),
          promptAuthor: 'd'.repeat(128),
          promptReviewer: 'q'.repeat(128),
          imageGenerator: 'g'.repeat(128),
          imageReviewer: 'i'.repeat(128),
          implementer: 'm'.repeat(128),
          renderReviewer: 'v'.repeat(128),
          acceptanceOwner: 'a'.repeat(128)
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
