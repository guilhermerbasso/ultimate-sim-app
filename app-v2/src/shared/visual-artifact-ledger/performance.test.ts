import { describe, expect, it } from 'vitest'
import { parseVisualArtifactLedger, VisualArtifactLedger } from './ledger'
import { expectedArtifactIds } from './plan'
import {
  DEFAULT_POLICY,
  HashPool,
  TestClock,
  appendAcceptedArtifact,
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
      const schedulerClock = new TestClock()
      const scheduler = makeScheduler(schedulerClock, {
        ...DEFAULT_POLICY,
        windowMs: 1
      })
      const ledger = VisualArtifactLedger.create(plan, scheduler)
      const ledgerClock = new TestClock(1_000_000)
      const hashes = new HashPool(1_000_000)
      const specificationHashes: string[] = []

      const stageStartedAt = performance.now()
      for (const artifactId of ids) {
        const specificationHash = hashes.next()
        specificationHashes.push(specificationHash)
        ledger.append({
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
          ids[index],
          1,
          hashes,
          ledgerClock,
          schedulerClock,
          { start: false, specificationHash: specificationHashes[index] }
        )
      }
      const lifecycleMs = performance.now() - lifecycleStartedAt
      const preFinalizationEvents = ledger.eventCount
      const checkpoint = ledger.createCheckpoint()

      const finalizationStartedAt = performance.now()
      ledger.finalize({
        occurredAt: ledgerClock.next(),
        actorId: 'release-owner',
        planHash: plan.planHash,
        registryHash: plan.registryHash,
        trustedCheckpoint: checkpoint
      })
      const finalizationMs = performance.now() - finalizationStartedAt
      const finalizedRoot = ledger.rootHash
      const finalizedCheckpoint = ledger.createCheckpoint()

      const roundTripStartedAt = performance.now()
      const serialized = ledger.serialize({ trustedCheckpoint: finalizedCheckpoint })
      const serializedBytes = Buffer.byteLength(serialized, 'utf8')
      const reparsed = parseVisualArtifactLedger(serialized, {
        scheduler,
        trustedCheckpoint: finalizedCheckpoint
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
      expect(stageUpdateMs).toBeLessThan(10_000)
      expect(lifecycleMs).toBeLessThan(90_000)
      expect(finalizationMs).toBeLessThan(60_000)
      expect(roundTripMs).toBeLessThan(90_000)
    }
  )
})
