import { describe, expect, it } from 'vitest'
import { parseVisualArtifactLedger, VisualArtifactLedger } from './ledger'
import { expectedArtifactIds } from './plan'
import {
  MAX_SERIALIZED_BYTES_PER_ARTIFACT_REVISION,
  MAX_SERIALIZED_PLAN_BYTES
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

describe('14,850-artifact incremental and finalization performance', () => {
  it(
    'updates one stage incrementally and reserves full O(n) replay for finalization',
    { timeout: 180_000 },
    () => {
      const plan = makePlan()
      const ids = expectedArtifactIds(plan)
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
        `VISUAL_ARTIFACT_LEDGER_PERF artifacts=${ids.length} ` +
          `stageEvents=${ids.length} stageMs=${stageUpdateMs.toFixed(2)} ` +
          `lifecycleEvents=${preFinalizationEvents} lifecycleMs=${lifecycleMs.toFixed(2)} ` +
          `finalizationReplayEvents=${preFinalizationEvents} finalizationMs=${finalizationMs.toFixed(2)} ` +
          `serializedBytes=${serializedBytes} roundTripMs=${roundTripMs.toFixed(2)}`
      )

      expect(ids).toHaveLength(14_850)
      expect(ledger.artifactCount).toBe(14_850)
      expect(ledger.acceptedArtifactCount).toBe(14_850)
      expect(preFinalizationEvents).toBe(14_850 * 9)
      expect(ledger.eventCount).toBe(preFinalizationEvents + 1)
      expect(ledger.isFinalized).toBe(true)
      expect(reparsed.rootHash).toBe(finalizedRoot)
      expect(reparsed.isFinalized).toBe(true)
      expect(serializedBytes).toBeLessThanOrEqual(
        ids.length * MAX_SERIALIZED_BYTES_PER_ARTIFACT_REVISION +
          MAX_SERIALIZED_PLAN_BYTES
      )
      expect(stageUpdateMs).toBeLessThan(10_000)
      expect(lifecycleMs).toBeLessThan(90_000)
      expect(finalizationMs).toBeLessThan(60_000)
      expect(roundTripMs).toBeLessThan(90_000)
    }
  )
})
