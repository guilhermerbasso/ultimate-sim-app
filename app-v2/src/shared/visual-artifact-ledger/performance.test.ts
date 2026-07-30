import { describe, expect, it } from 'vitest'
import { parseVisualArtifactLedger, VisualArtifactLedger } from './ledger'
import { expectedArtifactIds } from './plan'
import { sha256Hex } from './canonical'
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

type CpuUsage = ReturnType<typeof process.cpuUsage>

function elapsedCpuMs(start: CpuUsage): number {
  const elapsed = process.cpuUsage(start)
  return (elapsed.user + elapsed.system) / 1_000
}

const CALIBRATION_HASHES = 20_000

/**
 * Cost of one unit of the work this ledger is actually made of: canonicalising
 * and SHA-256 hashing a record-shaped object. Every phase budget below is
 * expressed as a multiple of this instead of as absolute milliseconds.
 *
 * Absolute wall-clock and absolute CPU budgets both measure the host. A slow,
 * loaded or thermally throttled machine inflates the measured phase and the
 * calibration equally, so the ratio holds; an algorithmic regression inflates
 * only the phase, so the ratio blows out. That keeps the gate sensitive to the
 * thing it exists to catch while making it insensitive to who else is using
 * the CPU.
 */
function calibrationCpuMs(): number {
  const startedAt = process.cpuUsage()
  let sink = ''
  for (let index = 0; index < CALIBRATION_HASHES; index += 1) {
    sink = sha256Hex({
      type: 'artifact-revision-started',
      occurredAt: 1_000_000 + index,
      actorId: 'planner',
      artifactId: `calibration-artifact-${index}`,
      revision: 1,
      specificationHash: index.toString(16).padStart(64, '0'),
      planHash: sink
    })
  }
  expect(sink).toHaveLength(64)
  return Math.max(elapsedCpuMs(startedAt), 1)
}

// Multiples of the calibration cost. Headroom is ~2.5x over what the reference
// machine actually spends, which still fails on any phase that gets 2.5x more
// expensive and fails overwhelmingly on a complexity regression (turning the
// 149,409-event replay super-linear costs far more than 2.5x), while absorbing
// ordinary host variance. Observed ratios when these were set: plan 0.15,
// stage 11.0, lifecycle 253.6, finalization 149.0, roundTrip 213.2.
const PLAN_CREATION_BUDGET = 4
const STAGE_UPDATE_BUDGET = 33
const LIFECYCLE_BUDGET = 640
const FINALIZATION_BUDGET = 380
const ROUND_TRIP_BUDGET = 540

describe('16,600-artifact exact contract performance', () => {
  it(
    'creates, accepts, finalizes, serializes, and replays the approved exact plan',
    // Wall clock is logged but never asserted; this is only a hang guard, sized
    // so a heavily loaded host cannot turn a correctness gate into a red build.
    { timeout: 900_000 },
    () => {
      const openingCalibrationCpuMs = calibrationCpuMs()
      const planCpuStartedAt = process.cpuUsage()
      const planStartedAt = performance.now()
      const plan = makePlan(45)
      const ids = expectedArtifactIds(plan)
      const planCreationMs = performance.now() - planStartedAt
      const planCreationCpuMs = elapsedCpuMs(planCpuStartedAt)
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

      const stageCpuStartedAt = process.cpuUsage()
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
      const stageUpdateCpuMs = elapsedCpuMs(stageCpuStartedAt)

      const lifecycleCpuStartedAt = process.cpuUsage()
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
      const replacementArtifactId = ids[0]
      const priorRevisionRootHash =
        ledger.getArtifact(replacementArtifactId)!.revisions[0].rootHash
      const replacementSpecificationHash = hashes.next()
      appendLedger(ledger, governance, {
        type: 'artifact-revision-superseded',
        occurredAt: ledgerClock.next(),
        actorId: 'planner',
        artifactId: replacementArtifactId,
        revision: 2,
        priorRevision: 1,
        priorRevisionRootHash,
        specificationHash: replacementSpecificationHash,
        planHash: plan.planHash
      })
      appendAcceptedArtifact(
        ledger,
        scheduler,
        governance,
        replacementArtifactId,
        2,
        hashes,
        ledgerClock,
        {
          start: false,
          specificationHash: replacementSpecificationHash
        }
      )
      const lifecycleMs = performance.now() - lifecycleStartedAt
      const lifecycleCpuMs = elapsedCpuMs(lifecycleCpuStartedAt)
      const preFinalizationEvents = ledger.eventCount
      const checkpoint = ledger.createCheckpoint()
      const checkpointAttestation = governance.attestations.issueRoot({
        domain: 'visual-artifact-ledger',
        purpose: 'finalization-checkpoint',
        rootHash: checkpoint.rootHash,
        version: checkpoint.sequence,
        contextHash: plan.planHash
      })
      let preFinalizationSerialized = ledger.serialize({
        rootAttestation: ledgerRootAttestation(ledger, governance)
      })
      const staleFork = parseVisualArtifactLedger(
        preFinalizationSerialized,
        {
          dependencies: governance.ledgerDependencies(scheduler)
        }
      )
      preFinalizationSerialized = ''

      const finalizationCpuStartedAt = process.cpuUsage()
      const finalizationStartedAt = performance.now()
      const racingArtifactId = ids[1]
      const racingPriorRoot =
        staleFork.getArtifact(racingArtifactId)!.revisions[0].rootHash
      const racingAppend = {
        type: 'artifact-revision-superseded' as const,
        occurredAt: ledgerClock.next(),
        actorId: 'planner',
        artifactId: racingArtifactId,
        revision: 2,
        priorRevision: 1,
        priorRevisionRootHash: racingPriorRoot,
        specificationHash: hashes.next(),
        planHash: plan.planHash
      }
      const racingPrincipal = governance.attestations.issuePrincipal(
        staleFork.principalBindingFor(racingAppend)
      )
      const finalization = {
        occurredAt: ledgerClock.next(),
        actorId: 'release-owner',
        planHash: plan.planHash,
        registryHash: plan.registryHash,
        trustedCheckpoint: checkpoint,
        trustedCheckpointAttestation: checkpointAttestation
      }
      const finalizationPrincipal = governance.attestations.issuePrincipal(
        ledger.finalizationPrincipalBindingFor(finalization)
      )
      governance.finalizationAuthority.simulateLostNextResponse()
      governance.finalizationAuthority.beforeNextAppendCommit(() => {
        ledger.finalize(finalization, finalizationPrincipal)
      })
      expect(() => staleFork.append(racingAppend, racingPrincipal)).toThrow(
        /stale or finalized shared ledger append CAS/i
      )
      const finalizationMs = performance.now() - finalizationStartedAt
      const finalizationCpuMs = elapsedCpuMs(finalizationCpuStartedAt)
      const finalizedRoot = ledger.rootHash
      expect(staleFork.rootHash).toBe(finalizedRoot)
      expect(staleFork.isFinalized).toBe(true)
      expect(staleFork.acceptedArtifactCount).toBe(
        APPROVED_EXACT_ARTIFACT_COUNT
      )
      expect(staleFork.getArtifact(racingArtifactId)?.revisions).toHaveLength(1)
      expect(staleFork.events().at(-1)?.type).toBe('ledger-finalized')
      const finalRootAttestation = ledgerRootAttestation(ledger, governance)

      const roundTripCpuStartedAt = process.cpuUsage()
      const roundTripStartedAt = performance.now()
      const serialized = ledger.serialize({ rootAttestation: finalRootAttestation })
      const serializedBytes = Buffer.byteLength(serialized, 'utf8')
      const reparsed = parseVisualArtifactLedger(serialized, {
        dependencies: governance.ledgerDependencies(scheduler)
      })
      const roundTripMs = performance.now() - roundTripStartedAt
      const roundTripCpuMs = elapsedCpuMs(roundTripCpuStartedAt)

      // Recalibrate at the end as well: this run takes minutes, and host load
      // can change over that window. Averaging the two keeps the denominator
      // representative of the conditions the phases were actually measured in.
      const closingCalibrationCpuMs = calibrationCpuMs()
      const referenceCpuMs = (openingCalibrationCpuMs + closingCalibrationCpuMs) / 2

      console.info(
        `VISUAL_ARTIFACT_LEDGER_PERF artifacts=${ids.length} ` +
          `calibrationHashes=${CALIBRATION_HASHES} calibrationCpuMs=${referenceCpuMs.toFixed(2)} ` +
          `calibrationOpenCpuMs=${openingCalibrationCpuMs.toFixed(2)} calibrationCloseCpuMs=${closingCalibrationCpuMs.toFixed(2)} ` +
          `planMs=${planCreationMs.toFixed(2)} planCpuMs=${planCreationCpuMs.toFixed(2)} ` +
          `stageEvents=${ids.length} stageMs=${stageUpdateMs.toFixed(2)} stageCpuMs=${stageUpdateCpuMs.toFixed(2)} ` +
          `lifecycleEvents=${preFinalizationEvents} lifecycleMs=${lifecycleMs.toFixed(2)} lifecycleCpuMs=${lifecycleCpuMs.toFixed(2)} ` +
          `finalizationReplayEvents=${preFinalizationEvents} finalizationMs=${finalizationMs.toFixed(2)} finalizationCpuMs=${finalizationCpuMs.toFixed(2)} ` +
          `serializedChars=${serialized.length} serializedBytes=${serializedBytes} ` +
          `roundTripMs=${roundTripMs.toFixed(2)} roundTripCpuMs=${roundTripCpuMs.toFixed(2)}`
      )

      expect(ids).toHaveLength(APPROVED_EXACT_ARTIFACT_COUNT)
      expect(ledger.artifactCount).toBe(APPROVED_EXACT_ARTIFACT_COUNT)
      expect(ledger.acceptedArtifactCount).toBe(APPROVED_EXACT_ARTIFACT_COUNT)
      expect(preFinalizationEvents).toBe(
        APPROVED_EXACT_ARTIFACT_COUNT * 9 + 9
      )
      expect(ledger.eventCount).toBe(preFinalizationEvents + 1)
      expect(ledger.isFinalized).toBe(true)
      expect(reparsed.rootHash).toBe(finalizedRoot)
      expect(reparsed.isFinalized).toBe(true)
      expect(
        reparsed.getArtifact(replacementArtifactId)?.revisions.map(
          (revision) => revision.status
        )
      ).toEqual(['accepted', 'accepted'])
      expect(serializedBytes).toBeLessThanOrEqual(
        ids.length * MAX_SERIALIZED_BYTES_PER_ARTIFACT_REVISION +
          MAX_SERIALIZED_LEDGER_FRAMING_BYTES
      )
      expect(serializedBytes).toBeLessThan(MAX_SERIALIZED_BYTES)
      expect(serialized.length).toBeLessThan(MAX_SERIALIZED_CHARACTERS)
      expect(planCreationCpuMs).toBeLessThan(PLAN_CREATION_BUDGET * referenceCpuMs)
      expect(stageUpdateCpuMs).toBeLessThan(STAGE_UPDATE_BUDGET * referenceCpuMs)
      expect(lifecycleCpuMs).toBeLessThan(LIFECYCLE_BUDGET * referenceCpuMs)
      expect(finalizationCpuMs).toBeLessThan(FINALIZATION_BUDGET * referenceCpuMs)
      expect(roundTripCpuMs).toBeLessThan(ROUND_TRIP_BUDGET * referenceCpuMs)
      expect([
        planCreationMs,
        stageUpdateMs,
        lifecycleMs,
        finalizationMs,
        roundTripMs
      ].every(Number.isFinite)).toBe(true)
    }
  )
})
