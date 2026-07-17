import { describe, expect, it } from 'vitest'
import { parseVisualArtifactLedger, VisualArtifactLedger } from './ledger'
import { expectedArtifactIds } from './plan'
import {
  APPROVED_EXACT_ARTIFACT_COUNT,
  MAX_SERIALIZED_BYTES,
  MAX_SERIALIZED_CHARACTERS,
  MAX_SERIALIZED_BYTES_PER_ARTIFACT_REVISION,
  MAX_SERIALIZED_LEDGER_FRAMING_BYTES
} from './constants'
import {
  DEFAULT_POLICY,
  HashPool,
  TestClock,
  appendAcceptedArtifact,
  appendLedger,
  ledgerRootAttestation,
  makeGovernance,
  makePlan,
  makeScheduler
} from './test-fixtures'

describe('16,600-artifact exact contract performance', () => {
  it(
    'creates, accepts, finalizes, serializes, and replays the approved exact plan',
    { timeout: 300_000 },
    () => {
      const planStartedAt = performance.now()
      const plan = makePlan(45)
      const ids = expectedArtifactIds(plan)
      const planCreationMs = performance.now() - planStartedAt
      const governance = makeGovernance()
      const scheduler = makeScheduler(governance, {
        ...DEFAULT_POLICY,
        windowMs: 1
      })
      const ledger = VisualArtifactLedger.create(
        plan,
        governance.ledgerDependencies(scheduler)
      )
      const ledgerClock = new TestClock(1_000_000)
      const hashes = new HashPool(1_000_000)
      const specificationHashes: string[] = []

      const stageStartedAt = performance.now()
      for (const artifactId of ids) {
        const specificationHash = hashes.next()
        specificationHashes.push(specificationHash)
        appendLedger(ledger, governance, {
          type: 'artifact-revision-started',
          occurredAt: ledgerClock.next(),
          actorId: 'planner',
          artifactId,
          revision: 1,
          specificationHash,
          planHash: plan.planHash
        })
      }
      const stageUpdateMs = performance.now() - stageStartedAt

      const lifecycleStartedAt = performance.now()
      for (let index = 0; index < ids.length; index += 1) {
        appendAcceptedArtifact(
          ledger,
          scheduler,
          governance,
          ids[index],
          1,
          hashes,
          ledgerClock,
          { start: false, specificationHash: specificationHashes[index] }
        )
      }
      const lifecycleMs = performance.now() - lifecycleStartedAt
      const preFinalizationEvents = ledger.eventCount
      const checkpoint = ledger.createCheckpoint()
      const checkpointAttestation = governance.attestations.issueRoot({
        domain: 'visual-artifact-ledger',
        purpose: 'finalization-checkpoint',
        rootHash: checkpoint.rootHash,
        version: checkpoint.sequence,
        contextHash: plan.planHash
      })

      const finalizationStartedAt = performance.now()
      const finalization = {
        occurredAt: ledgerClock.next(),
        actorId: 'release-owner',
        planHash: plan.planHash,
        registryHash: plan.registryHash,
        trustedCheckpoint: checkpoint,
        trustedCheckpointAttestation: checkpointAttestation
      }
      ledger.finalize(
        finalization,
        governance.attestations.issuePrincipal(
          ledger.finalizationPrincipalBindingFor(finalization)
        )
      )
      const finalizationMs = performance.now() - finalizationStartedAt
      const finalizedRoot = ledger.rootHash
      const finalRootAttestation = ledgerRootAttestation(ledger, governance)

      const roundTripStartedAt = performance.now()
      const serialized = ledger.serialize({ rootAttestation: finalRootAttestation })
      const serializedBytes = Buffer.byteLength(serialized, 'utf8')
      const reparsed = parseVisualArtifactLedger(serialized, {
        dependencies: governance.ledgerDependencies(scheduler)
      })
      const roundTripMs = performance.now() - roundTripStartedAt

      console.info(
        `VISUAL_ARTIFACT_LEDGER_PERF artifacts=${ids.length} planMs=${planCreationMs.toFixed(2)} ` +
          `stageEvents=${ids.length} stageMs=${stageUpdateMs.toFixed(2)} ` +
          `lifecycleEvents=${preFinalizationEvents} lifecycleMs=${lifecycleMs.toFixed(2)} ` +
          `finalizationReplayEvents=${preFinalizationEvents} finalizationMs=${finalizationMs.toFixed(2)} ` +
          `serializedChars=${serialized.length} serializedBytes=${serializedBytes} ` +
          `roundTripMs=${roundTripMs.toFixed(2)}`
      )

      expect(ids).toHaveLength(APPROVED_EXACT_ARTIFACT_COUNT)
      expect(ledger.artifactCount).toBe(APPROVED_EXACT_ARTIFACT_COUNT)
      expect(ledger.acceptedArtifactCount).toBe(APPROVED_EXACT_ARTIFACT_COUNT)
      expect(preFinalizationEvents).toBe(APPROVED_EXACT_ARTIFACT_COUNT * 9)
      expect(ledger.eventCount).toBe(preFinalizationEvents + 1)
      expect(ledger.isFinalized).toBe(true)
      expect(reparsed.rootHash).toBe(finalizedRoot)
      expect(reparsed.isFinalized).toBe(true)
      expect(serializedBytes).toBeLessThanOrEqual(
        ids.length * MAX_SERIALIZED_BYTES_PER_ARTIFACT_REVISION +
          MAX_SERIALIZED_LEDGER_FRAMING_BYTES
      )
      expect(serializedBytes).toBeLessThan(MAX_SERIALIZED_BYTES)
      expect(serialized.length).toBeLessThan(MAX_SERIALIZED_CHARACTERS)
      expect(planCreationMs).toBeLessThan(5_000)
      expect(stageUpdateMs).toBeLessThan(15_000)
      expect(lifecycleMs).toBeLessThan(120_000)
      expect(finalizationMs).toBeLessThan(90_000)
      expect(roundTripMs).toBeLessThan(120_000)
    }
  )
})
