import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { canonicalStringify, sha256Hex } from './canonical'
import type { LedgerAppendOperation } from './authorities'
import {
  DurableLedgerFinalizationAuthority,
  computeLedgerAppendOperationHash,
  computeLedgerPublicationAuthorityRootHash,
  type LedgerAuthorityCommitBinding
} from './finalization-authority'
import {
  computeArtifactEventHash,
  computeVisualArtifactLedgerRootHash,
  parseVisualArtifactLedger,
  serializeVisualArtifactLedger,
  VisualArtifactLedger,
  type ArtifactEvent,
  type SerializedVisualArtifactLedger
} from './ledger'
import { expectedArtifactIds } from './plan'
import {
  MAX_LEDGER_EVENTS,
  MAX_REVISIONS_PER_ARTIFACT,
  MAX_SERIALIZED_CHARACTERS,
  VISUAL_ARTIFACT_LEDGER_VERSION,
  ZERO_HASH
} from './constants'
import {
  DEFAULT_POLICY,
  HashPool,
  TestClock,
  appendAcceptedArtifact,
  appendLedger,
  appendPromptApproved,
  appendScheduler,
  evidence,
  hashNumber,
  ledgerRootAttestation,
  makeGovernance,
  makePlan,
  makeScheduler,
  schedulerPrincipal,
  type PromptApprovedContext,
  type TestGovernance
} from './test-fixtures'

const DURABLE_LEDGER_AUTHORITY_ID = 'ledger-rollback-test-authority'

function durableCommitAttestation(
  binding: LedgerAuthorityCommitBinding
): { readonly token: string } {
  return {
    token: `ledger:${sha256Hex({
      domain: 'ledger-rollback-test-attestation',
      binding
    })}`.padEnd(88, 'x')
  }
}

function durableAuthority(
  directoryPath: string,
  failBeforeCommit = false
): DurableLedgerFinalizationAuthority {
  return new DurableLedgerFinalizationAuthority({
    authorityId: DURABLE_LEDGER_AUTHORITY_ID,
    directoryPath,
    issueCommitAttestation: durableCommitAttestation,
    verifyCommitAttestation: (attestation, binding) =>
      attestation.token === durableCommitAttestation(binding).token,
    ...(failBeforeCommit
      ? {
          faultInjector: (fault: { point: string }) => {
            if (fault.point === 'before-commit') {
              throw new Error('forced pre-commit publication failure')
            }
          }
        }
      : {})
  })
}

function durableAuthorityDatabase(
  subject: DurableLedgerFinalizationAuthority
): DatabaseSync {
  return (
    subject as unknown as {
      database: DatabaseSync
    }
  ).database
}

function forceDurableRollbackError(
  subject: DurableLedgerFinalizationAuthority
): {
  readonly database: DatabaseSync
  observedInTransaction(): boolean | undefined
} {
  const database = durableAuthorityDatabase(subject)
  const originalExec = database.exec
  let observedInTransaction: boolean | undefined
  Object.defineProperty(database, 'exec', {
    configurable: true,
    value: (sql: string): void => {
      if (sql.trim().toUpperCase() === 'ROLLBACK') {
        observedInTransaction = database.isTransaction
        throw new Error('forced SQLite ROLLBACK failure')
      }
      Reflect.apply(originalExec, database, [sql])
    }
  })
  return {
    database,
    observedInTransaction: () => observedInTransaction
  }
}

function forceDurableCommitResponseLoss(
  subject: DurableLedgerFinalizationAuthority
): DatabaseSync {
  const database = durableAuthorityDatabase(subject)
  const originalExec = database.exec
  let loseCommitResponse = true
  Object.defineProperty(database, 'exec', {
    configurable: true,
    value: (sql: string): void => {
      if (sql.trim().toUpperCase() === 'COMMIT' && loseCommitResponse) {
        loseCommitResponse = false
        Reflect.apply(originalExec, database, [sql])
        throw new Error('forced SQLite COMMIT response loss')
      }
      Reflect.apply(originalExec, database, [sql])
    }
  })
  return database
}

function setup(triggerFamilyCount = 10) {
  const governance = makeGovernance()
  const scheduler = makeScheduler(governance)
  const plan = makePlan(triggerFamilyCount)
  const ledger = VisualArtifactLedger.create(plan, governance.ledgerDependencies(scheduler))
  return {
    governance,
    scheduler,
    ledger,
    plan,
    ids: expectedArtifactIds(plan),
    clock: new TestClock(1_000_000),
    hashes: new HashPool()
  }
}

function seedLedgerForDurableFinalization(
  ledger: VisualArtifactLedger,
  authority: DurableLedgerFinalizationAuthority
): {
  readonly occurredAt: string
  readonly eventHash: string
  readonly rootHash: string
  readonly sequence: number
} {
  const internal = ledger as unknown as {
    readonly expectedIds: readonly string[]
    readonly artifacts: Map<
      string,
      { revisions: Array<{ status: 'accepted' }> }
    >
    readonly eventLog: ArtifactEvent[]
    acceptedCurrentCount: number
    hasAcceptedHistory: boolean
    lastEventHash: string
    lastTimestamp: string
    cachedLocalRootHash?: string
  }
  for (const artifactId of internal.expectedIds) {
    internal.artifacts.set(artifactId, {
      revisions: [{ status: 'accepted' }]
    })
  }
  internal.acceptedCurrentCount = internal.expectedIds.length
  internal.hasAcceptedHistory = true

  const sequence = 149_409
  const previousEventHash = hashNumber(910_001)
  const occurredAt = '2026-01-03T00:00:00.000Z'
  const eventWithoutHash = {
    sequence,
    type: 'artifact-accepted',
    occurredAt,
    actorId: 'image-reviewer',
    previousEventHash
  }
  const eventHash = computeArtifactEventHash(
    eventWithoutHash as Omit<ArtifactEvent, 'eventHash'>
  )
  const event = {
    ...eventWithoutHash,
    eventHash
  } as ArtifactEvent
  internal.eventLog.length = sequence
  internal.eventLog[sequence - 1] = event
  internal.lastEventHash = eventHash
  internal.lastTimestamp = occurredAt
  internal.cachedLocalRootHash = undefined

  const expectedLedgerRootHash = computeVisualArtifactLedgerRootHash(
    ledger.plan.planHash,
    sequence - 1,
    previousEventHash
  )
  const rootHash = computeVisualArtifactLedgerRootHash(
    ledger.plan.planHash,
    sequence,
    eventHash
  )
  const operationWithoutHash = {
    authorityId: DURABLE_LEDGER_AUTHORITY_ID,
    expectedLedgerSequence: sequence - 1,
    expectedLedgerRootHash,
    expectedLedgerEventHash: previousEventHash,
    expectedAcceptedArtifactCount: internal.expectedIds.length - 1,
    planHash: ledger.plan.planHash,
    registryHash: ledger.plan.registryHash,
    nextLedgerSequence: sequence,
    nextLedgerRootHash: rootHash,
    nextLedgerEventHash: eventHash,
    nextAcceptedArtifactCount: internal.expectedIds.length,
    event
  }
  const operation: LedgerAppendOperation = {
    ...operationWithoutHash,
    operationHash: computeLedgerAppendOperationHash(operationWithoutHash)
  }
  const unsigned = {
    authorityId: DURABLE_LEDGER_AUTHORITY_ID,
    version: 1 as const,
    committedAt: occurredAt,
    previousRootHash: hashNumber(910_002),
    rootHash: ZERO_HASH,
    operationHash: operation.operationHash
  }
  const commitBinding = {
    ...unsigned,
    rootHash: computeLedgerPublicationAuthorityRootHash('append', unsigned)
  }
  const commit = {
    ...commitBinding,
    attestation: durableCommitAttestation(commitBinding)
  }
  const database = durableAuthorityDatabase(authority)
  database
    .prepare(`
      INSERT INTO ledger_heads(
        plan_hash, registry_hash, ledger_sequence, ledger_root_hash,
        ledger_event_hash, accepted_artifact_count, authority_root_hash,
        finalized, finalization_operation_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)
    `)
    .run(
      ledger.plan.planHash,
      ledger.plan.registryHash,
      sequence,
      rootHash,
      eventHash,
      internal.expectedIds.length,
      commit.rootHash
    )
  database
    .prepare(`
      INSERT INTO append_records(
        plan_hash, ledger_sequence, operation_hash, operation_json, commit_json
      ) VALUES (?, ?, ?, ?, ?)
    `)
    .run(
      ledger.plan.planHash,
      sequence,
      operation.operationHash,
      canonicalStringify(operation),
      canonicalStringify(commit)
    )
  expect(authority.head(ledger.plan.planHash)).toMatchObject({
    ledgerSequence: sequence,
    acceptedArtifactCount: internal.expectedIds.length,
    ledgerRootHash: rootHash
  })
  return { occurredAt, eventHash, rootHash, sequence }
}

function startArtifact(
  ledger: VisualArtifactLedger,
  governance: TestGovernance,
  artifactId: (ReturnType<typeof expectedArtifactIds>)[number],
  hashes: HashPool,
  clock: TestClock,
  revision = 1,
  type: 'artifact-revision-started' | 'artifact-revision-superseded' =
    'artifact-revision-started',
  priorRoot?: string
): string {
  const specificationHash = hashes.next()
  if (type === 'artifact-revision-started') {
    appendLedger(ledger, governance, {
      type,
      occurredAt: clock.next(),
      actorId: 'planner',
      artifactId,
      revision,
      specificationHash,
      planHash: ledger.plan.planHash
    })
  } else {
    appendLedger(ledger, governance, {
      type,
      occurredAt: clock.next(),
      actorId: 'planner',
      artifactId,
      revision,
      priorRevision: revision - 1,
      priorRevisionRootHash: priorRoot,
      specificationHash,
      planHash: ledger.plan.planHash
    })
  }
  return specificationHash
}

function recordGeneration(
  ledger: VisualArtifactLedger,
  governance: TestGovernance,
  context: PromptApprovedContext,
  receipt: ReturnType<typeof setup>['scheduler'] extends infer _T
    ? ReturnType<ReturnType<typeof makeScheduler>['requireSucceededReceipt']>
    : never,
  clock: TestClock
): void {
  clock.ensureAfter(receipt.completedAt)
  const occurredAt = clock.next()
  appendLedger(ledger, governance, {
    type: 'image-generation-recorded',
    occurredAt,
    actorId: 'image-runner',
    artifactId: context.artifactId,
    revision: context.revision,
    attempt: receipt.attempt,
    promptHash: receipt.promptHash,
    promptApprovalHash: receipt.promptApprovalHash,
    requestHash: receipt.requestHash,
    imageHash: receipt.imageHash,
    idempotencyKey: receipt.idempotencyKey,
    policyHash: receipt.policyHash,
    schedulerCallId: receipt.callId,
    schedulerCallHash: receipt.callHash,
    schedulerReceiptHash: receipt.receiptHash,
    schedulerAuthorityId: receipt.authorityId,
    schedulerAuthorityVersion: receipt.authorityVersion,
    schedulerAuthorityRootHash: receipt.authorityRootHash,
    schedulerAuthorityCommitHash: receipt.authorityCommitHash,
    evidence: evidence(
      ledger,
      governance,
      'image-generation',
      context.artifactId,
      context.revision,
      occurredAt,
      'image-runner',
      receipt.receiptHash,
      receipt.imageHash
    )
  })
}

function canonicalEnvelope(ledger: VisualArtifactLedger): string {
  return canonicalStringify({
    schemaVersion: 2,
    plan: ledger.plan,
    rootAttestation: { token: ledger.rootHash },
    events: ledger.events()
  })
}

function rehashEnvelope(envelope: SerializedVisualArtifactLedger): string {
  let previousEventHash = ZERO_HASH
  for (let index = 0; index < envelope.events.length; index += 1) {
    const event = envelope.events[index] as ArtifactEvent & {
      sequence: number
      previousEventHash: string
      eventHash: string
    }
    event.sequence = index + 1
    event.previousEventHash = previousEventHash
    const { eventHash: _eventHash, ...withoutHash } = event
    event.eventHash = computeArtifactEventHash(
      withoutHash as Omit<ArtifactEvent, 'eventHash'>
    )
    previousEventHash = event.eventHash
  }
  return canonicalStringify(envelope)
}

describe('externally attested visual artifact ledger', () => {
  it('enforces lifecycle order and global append-only event hashes', () => {
    const { governance, scheduler, ledger, ids, clock, hashes } = setup()
    appendAcceptedArtifact(
      ledger,
      scheduler,
      governance,
      ids[0],
      1,
      hashes,
      clock
    )
    expect(ledger.getArtifact(ids[0])?.revisions[0].status).toBe('accepted')
    expect(ledger.eventCount).toBe(9)
    expect(ledger.evidenceCount).toBe(9)
    const events = ledger.events()
    expect(events[0].previousEventHash).toBe(ZERO_HASH)
    for (let index = 1; index < events.length; index += 1) {
      expect(events[index].sequence).toBe(index + 1)
      expect(events[index].previousEventHash).toBe(events[index - 1].eventHash)
    }
  })

  it('rejects skipped stages, unknown identity fields, prompt bodies, URLs, and secrets', () => {
    const { governance, ledger, ids, clock, hashes } = setup()
    const specificationHash = startArtifact(
      ledger,
      governance,
      ids[0],
      hashes,
      clock
    )
    const promptHash = hashes.next()
    const occurredAt = clock.next()
    expect(() =>
      appendLedger(ledger, governance, {
        type: 'prompt-drafted',
        occurredAt,
        actorId: 'prompt-author',
        artifactId: ids[0],
        revision: 1,
        promptHash,
        evidence: evidence(
          ledger,
          governance,
          'prompt-draft',
          ids[0],
          1,
          occurredAt,
          'prompt-author',
          specificationHash,
          promptHash
        )
      })
    ).toThrow(/requires completed research/i)

    expect(() =>
      ledger.principalBindingFor({
        type: 'artifact-revision-started',
        occurredAt: clock.next(),
        actorId: 'x:sk-proj-secret',
        artifactId: ids[1],
        revision: 1,
        specificationHash: hashes.next(),
        planHash: ledger.plan.planHash,
        promptBody: 'forbidden'
      })
    ).toThrow(/unknown field "promptBody"|forbidden URL/i)
  })

  it('rejects principal-label impersonation with an otherwise valid signed token', () => {
    const { governance, ledger, ids, clock, hashes } = setup()
    const legitimate = {
      type: 'artifact-revision-started',
      occurredAt: clock.next(),
      actorId: 'planner',
      artifactId: ids[0],
      revision: 1,
      specificationHash: hashes.next(),
      planHash: ledger.plan.planHash
    }
    const token = governance.attestations.issuePrincipal(
      ledger.principalBindingFor(legitimate)
    )
    expect(() =>
      ledger.append({ ...legitimate, actorId: 'impersonated-planner' }, token)
    ).toThrow(/primitive boolean true/i)
  })

  it('rejects fabricated or relabelled evidence despite matching caller hashes', () => {
    const { governance, ledger, ids, clock, hashes } = setup()
    const specificationHash = startArtifact(
      ledger,
      governance,
      ids[0],
      hashes,
      clock
    )
    const researchHash = hashes.next()
    const occurredAt = clock.next()
    const validEvidence = evidence(
      ledger,
      governance,
      'research',
      ids[0],
      1,
      occurredAt,
      'researcher',
      specificationHash,
      researchHash
    )
    const input = {
      type: 'research-recorded',
      occurredAt,
      actorId: 'researcher',
      artifactId: ids[0],
      revision: 1,
      researchHash,
      evidence: {
        ...validEvidence,
        attestation: { token: 'caller-fabricated-evidence-proof' }
      }
    }
    const principal = governance.attestations.issuePrincipal(
      ledger.principalBindingFor(input)
    )
    expect(() => ledger.append(input, principal)).toThrow(/primitive boolean true/i)
  })

  it('rejects self-QA and foreign evidence subjects', () => {
    const prompt = setup()
    expect(() =>
      appendPromptApproved(
        prompt.ledger,
        prompt.governance,
        prompt.ids[0],
        1,
        prompt.hashes,
        prompt.clock,
        { promptReviewer: 'prompt-author' }
      )
    ).toThrow(/prompt QA must be independent/i)

    const foreign = setup()
    const specificationHash = startArtifact(
      foreign.ledger,
      foreign.governance,
      foreign.ids[0],
      foreign.hashes,
      foreign.clock
    )
    const researchHash = foreign.hashes.next()
    const occurredAt = foreign.clock.next()
    expect(() =>
      appendLedger(foreign.ledger, foreign.governance, {
        type: 'research-recorded',
        occurredAt,
        actorId: 'researcher',
        artifactId: foreign.ids[0],
        revision: 1,
        researchHash,
        evidence: evidence(
          foreign.ledger,
          foreign.governance,
          'research',
          foreign.ids[0],
          1,
          occurredAt,
          'researcher',
          foreign.hashes.next(),
          researchHash
        )
      })
    ).toThrow(/mismatched subjectHash/i)
    expect(specificationHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('prevents evidence ID and digest reuse across artifacts', () => {
    const { governance, ledger, ids, clock, hashes } = setup()
    const firstSpec = startArtifact(ledger, governance, ids[0], hashes, clock)
    const contentHash = hashes.next()
    let occurredAt = clock.next()
    const firstEvidence = evidence(
      ledger,
      governance,
      'research',
      ids[0],
      1,
      occurredAt,
      'researcher',
      firstSpec,
      contentHash,
      'shared'
    )
    appendLedger(ledger, governance, {
      type: 'research-recorded',
      occurredAt,
      actorId: 'researcher',
      artifactId: ids[0],
      revision: 1,
      researchHash: contentHash,
      evidence: firstEvidence
    })
    const secondSpec = startArtifact(ledger, governance, ids[1], hashes, clock)
    occurredAt = clock.next()
    const secondEvidence = evidence(
      ledger,
      governance,
      'research',
      ids[1],
      1,
      occurredAt,
      'researcher',
      secondSpec,
      contentHash,
      'other'
    )
    expect(() =>
      appendLedger(ledger, governance, {
        type: 'research-recorded',
        occurredAt,
        actorId: 'researcher',
        artifactId: ids[1],
        revision: 1,
        researchHash: contentHash,
        evidence: { ...secondEvidence, evidenceId: firstEvidence.evidenceId }
      })
    ).toThrow(/evidence id|evidence content/i)
  })

  it('accepts only scheduler receipts committed by the supplied authority', () => {
    const { governance, scheduler, ledger, ids, clock, hashes } = setup()
    const context = appendPromptApproved(
      ledger,
      governance,
      ids[0],
      1,
      hashes,
      clock
    )
    const requestHash = hashes.next()
    governance.schedulerAuthority.ensureAfter(context.promptApprovedAt)
    appendScheduler(scheduler, governance, 'reserve', {
      actorId: 'scheduler-control',
      callId: 'real-call',
      artifactId: context.artifactId,
      revision: 1,
      attempt: 1,
      promptHash: context.promptHash,
      promptApprovalHash: context.promptApprovalHash,
      approvalCheckpoint: context.approvalCheckpoint,
      requestHash,
      retryOfCallId: null,
      retryReason: null
    })
    appendScheduler(scheduler, governance, 'dispatch', {
      actorId: 'scheduler-worker',
      callId: 'real-call'
    })
    const imageHash = hashes.next()
    const serviceBinding = scheduler.serviceReceiptBinding('real-call', imageHash)
    appendScheduler(scheduler, governance, 'succeed', {
      actorId: 'scheduler-worker',
      callId: 'real-call',
      imageHash,
      serviceReceiptAttestation:
        governance.attestations.issueServiceReceipt(serviceBinding)
    })
    const receipt = scheduler.requireSucceededReceipt('real-call')
    clock.ensureAfter(receipt.completedAt)
    const occurredAt = clock.next()
    const fakeInput = {
      type: 'image-generation-recorded',
      occurredAt,
      actorId: 'image-runner',
      artifactId: context.artifactId,
      revision: 1,
      attempt: receipt.attempt,
      promptHash: receipt.promptHash,
      promptApprovalHash: receipt.promptApprovalHash,
      requestHash: receipt.requestHash,
      imageHash: receipt.imageHash,
      idempotencyKey: receipt.idempotencyKey,
      policyHash: receipt.policyHash,
      schedulerCallId: 'fake-call',
      schedulerCallHash: receipt.callHash,
      schedulerReceiptHash: receipt.receiptHash,
      schedulerAuthorityId: receipt.authorityId,
      schedulerAuthorityVersion: receipt.authorityVersion,
      schedulerAuthorityRootHash: receipt.authorityRootHash,
      schedulerAuthorityCommitHash: receipt.authorityCommitHash,
      evidence: evidence(
        ledger,
        governance,
        'image-generation',
        context.artifactId,
        1,
        occurredAt,
        'image-runner',
        receipt.receiptHash,
        receipt.imageHash
      )
    }
    const principal = governance.attestations.issuePrincipal(
      ledger.principalBindingFor(fakeInput)
    )
    expect(() => ledger.append(fakeInput, principal)).toThrow(/no committed succeeded receipt/i)
  })

  it('requires externally issued root attestations and exposes no unchecked serializer', () => {
    const { governance, ledger, ids, clock, hashes } = setup()
    appendPromptApproved(ledger, governance, ids[0], 1, hashes, clock, {
      promptVerdict: 'rejected'
    })

    expect(() =>
      ledger.serialize({ trustedRootHash: ledger.rootHash })
    ).toThrow(/unknown field "trustedRootHash"/i)
    expect(() =>
      ledger.serialize({ rootAttestation: { token: ledger.rootHash } })
    ).toThrow(/primitive boolean true/i)
    expect((ledger as unknown as { toSerializable?: unknown }).toSerializable).toBeUndefined()
    expect((ledger as unknown as { serializedValue?: unknown }).serializedValue).toBeUndefined()
    expect(() =>
      parseVisualArtifactLedger(
        canonicalStringify({
          schemaVersion: 2,
          plan: ledger.plan,
          events: ledger.events()
        }),
        { dependencies: governance.ledgerDependencies() }
      )
    ).toThrow(/missing required field "rootAttestation"/i)
    expect(() =>
      parseVisualArtifactLedger(canonicalEnvelope(ledger), {
        dependencies: governance.ledgerDependencies()
      })
    ).toThrow(/primitive boolean true/i)
    const validRootAttestation = ledgerRootAttestation(ledger, governance)
    ;(
      ledger as unknown as { serializedEventBytes: number }
    ).serializedEventBytes = MAX_SERIALIZED_CHARACTERS + 1
    expect(() =>
      ledger.serialize({ rootAttestation: validRootAttestation })
    ).toThrow(/runtime-safe single-string ceiling/i)
  })

  it('rejects attestation accessors and proxies before hashing or committing', () => {
    const { governance, ledger, ids, clock, hashes } = setup()
    const input = {
      type: 'artifact-revision-started' as const,
      occurredAt: clock.next(),
      actorId: 'planner',
      artifactId: ids[0],
      revision: 1,
      specificationHash: hashes.next(),
      planHash: ledger.plan.planHash
    }
    let reads = 0
    const accessorAttestation = {} as Record<string, unknown>
    Object.defineProperty(accessorAttestation, 'token', {
      enumerable: true,
      get: () => {
        reads += 1
        return governance.attestations.issuePrincipal(
          ledger.principalBindingFor(input)
        ).token
      }
    })
    expect(() => ledger.append(input, accessorAttestation)).toThrow(
      /plain object/i
    )
    expect(reads).toBe(0)
    expect(ledger.eventCount).toBe(0)

    const checkpoint = ledger.createCheckpoint()
    const checkpointAttestation = governance.attestations.issueRoot({
      domain: 'visual-artifact-ledger',
      purpose: 'finalization-checkpoint',
      rootHash: checkpoint.rootHash,
      version: checkpoint.sequence,
      contextHash: ledger.plan.planHash
    })
    const finalization = {
      occurredAt: clock.next(),
      actorId: 'release-owner',
      planHash: ledger.plan.planHash,
      registryHash: ledger.plan.registryHash,
      trustedCheckpoint: checkpoint
    } as Record<string, unknown>
    Object.defineProperty(finalization, 'trustedCheckpointAttestation', {
      enumerable: true,
      get: () => {
        reads += 1
        return checkpointAttestation
      }
    })
    expect(() =>
      ledger.finalizationPrincipalBindingFor(finalization)
    ).toThrow(/plain object/i)
    expect(reads).toBe(0)
    expect(governance.finalizationAuthority.current(ledger.plan.planHash))
      .toBeUndefined()

    const proxy = new Proxy(checkpointAttestation, {
      get: (target, key, receiver) => {
        reads += 1
        return Reflect.get(target, key, receiver)
      }
    })
    expect(() =>
      ledger.verifyRootAttestation(proxy)
    ).toThrow(/plain object/i)
    expect(reads).toBe(0)
  })

  it('shares ordinary append publication and recovers lost responses across instances', () => {
    const { governance, scheduler, ledger, plan, ids, clock, hashes } = setup()
    const peer = VisualArtifactLedger.create(
      plan,
      governance.ledgerDependencies(scheduler)
    )
    startArtifact(ledger, governance, ids[0], hashes, clock)
    expect(peer.eventCount).toBe(1)
    expect(peer.rootHash).toBe(ledger.rootHash)

    governance.finalizationAuthority.simulateLostNextAppendResponse()
    startArtifact(peer, governance, ids[1], hashes, clock)
    expect(peer.eventCount).toBe(2)
    expect(ledger.eventCount).toBe(2)
    expect(ledger.rootHash).toBe(peer.rootHash)
    expect(ledger.getArtifact(ids[1])?.revisions[0].status).toBe('started')
  })

  it('fails ledger append closed when SQLite rollback is poisoned', () => {
    const directory = mkdtempSync(
      join(process.cwd(), '.visual-ledger-publication-test-')
    )
    const governance = makeGovernance()
    const scheduler = makeScheduler(governance)
    const plan = makePlan(10)
    const authority = durableAuthority(directory, true)
    try {
      const ledger = VisualArtifactLedger.create(plan, {
        ...governance.ledgerDependencies(scheduler),
        finalizationAuthority: authority
      })
      const ids = expectedArtifactIds(plan)
      const probe = forceDurableRollbackError(authority)
      expect(() =>
        startArtifact(
          ledger,
          governance,
          ids[0],
          new HashPool(),
          new TestClock(1_000_000)
        )
      ).toThrow(/rollback failed or did not restore confirmed autocommit/i)
      expect(probe.observedInTransaction()).toBe(true)
      expect(probe.database.isOpen).toBe(false)
      expect(ledger.eventCount).toBe(0)
      expect(ledger.getArtifact(ids[0])).toBeUndefined()
      authority.close()

      const restarted = durableAuthority(directory)
      try {
        expect(restarted.head(plan.planHash)).toBeUndefined()
      } finally {
        restarted.close()
      }
    } finally {
      authority.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('finalizes through fresh SQLite recovery after a committed response is lost', () => {
    const directory = mkdtempSync(
      join(process.cwd(), '.visual-ledger-publication-test-')
    )
    const governance = makeGovernance()
    const plan = makePlan(45)
    const authority = durableAuthority(directory)
    try {
      const ledger = VisualArtifactLedger.create(plan, {
        ...governance.ledgerDependencies(),
        finalizationAuthority: authority
      })
      const seeded = seedLedgerForDurableFinalization(ledger, authority)
      const checkpoint = {
        schemaVersion: VISUAL_ARTIFACT_LEDGER_VERSION,
        sequence: seeded.sequence,
        eventHash: seeded.eventHash,
        rootHash: seeded.rootHash,
        planHash: plan.planHash,
        registryHash: plan.registryHash
      }
      const trustedCheckpointAttestation =
        governance.attestations.issueRoot({
          domain: 'visual-artifact-ledger',
          purpose: 'finalization-checkpoint',
          rootHash: checkpoint.rootHash,
          version: checkpoint.sequence,
          contextHash: plan.planHash
        })
      const finalization = {
        occurredAt: '2026-01-03T00:00:01.000Z',
        actorId: 'release-owner',
        planHash: plan.planHash,
        registryHash: plan.registryHash,
        trustedCheckpoint: checkpoint,
        trustedCheckpointAttestation
      }
      const principal = governance.attestations.issuePrincipal(
        ledger.finalizationPrincipalBindingFor(finalization)
      )
      const failedDatabase = forceDurableCommitResponseLoss(authority)
      const finalized = (
        ledger as unknown as {
          appendFinalization(
            value: typeof finalization,
            principalAttestation: typeof principal,
            skipFullReplay: boolean
          ): ArtifactEvent
        }
      ).appendFinalization(finalization, principal, true)
      expect(failedDatabase.isOpen).toBe(false)
      expect(durableAuthorityDatabase(authority) === failedDatabase).toBe(false)
      expect(finalized.type).toBe('ledger-finalized')
      expect(ledger.isFinalized).toBe(true)
      authority.close()

      const restarted = durableAuthority(directory)
      try {
        expect(restarted.current(plan.planHash)).toBeDefined()
        expect(restarted.head(plan.planHash)).toMatchObject({
          ledgerSequence: seeded.sequence,
          acceptedArtifactCount: 16_600,
          finalized: true
        })
      } finally {
        restarted.close()
      }
    } finally {
      authority.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects an in-flight stale append after a competing instance publishes', () => {
    const { governance, scheduler, ledger, plan, ids, clock, hashes } = setup()
    const peer = VisualArtifactLedger.create(
      plan,
      governance.ledgerDependencies(scheduler)
    )
    const input = {
      type: 'artifact-revision-started' as const,
      occurredAt: clock.next(),
      actorId: 'planner',
      artifactId: ids[0],
      revision: 1,
      specificationHash: hashes.next(),
      planHash: plan.planHash
    }
    const principal = governance.attestations.issuePrincipal(
      ledger.principalBindingFor(input)
    )
    governance.finalizationAuthority.beforeNextAppendCommit(() => {
      startArtifact(peer, governance, ids[1], hashes, clock)
    })

    expect(() => ledger.append(input, principal)).toThrow(
      /stale or finalized shared ledger append CAS/i
    )
    expect(ledger.eventCount).toBe(1)
    expect(ledger.rootHash).toBe(peer.rootHash)
    expect(ledger.getArtifact(ids[0])).toBeUndefined()
    expect(ledger.getArtifact(ids[1])?.revisions[0].status).toBe('started')
  })

  it('domain-separates finalization checkpoints from serialized envelope trust', () => {
    const { governance, ledger, ids, clock, hashes } = setup()
    appendPromptApproved(ledger, governance, ids[0], 1, hashes, clock, {
      promptVerdict: 'rejected'
    })
    const checkpointBinding = {
      domain: 'visual-artifact-ledger' as const,
      purpose: 'finalization-checkpoint' as const,
      rootHash: ledger.rootHash,
      version: ledger.sequence,
      contextHash: ledger.plan.planHash
    }
    const checkpointToken =
      governance.attestations.issueRoot(checkpointBinding)
    expect(
      governance.attestations.verifyRoot(checkpointToken, {
        ...checkpointBinding,
        purpose: 'envelope'
      })
    ).toBe(false)
  })

  it('rejects coherent offline rewriting against the original external root attestation', () => {
    const original = setup()
    appendPromptApproved(
      original.ledger,
      original.governance,
      original.ids[0],
      1,
      original.hashes,
      original.clock,
      { promptVerdict: 'rejected' }
    )
    const originalAttestation = ledgerRootAttestation(
      original.ledger,
      original.governance
    )

    const rewritten = setup()
    appendPromptApproved(
      rewritten.ledger,
      rewritten.governance,
      rewritten.ids[0],
      1,
      rewritten.hashes,
      rewritten.clock,
      {
        promptVerdict: 'rejected',
        promptReviewer: 'different-authenticated-reviewer'
      }
    )
    const rewrittenBytes = rewritten.ledger.serialize({
      rootAttestation: ledgerRootAttestation(
        rewritten.ledger,
        rewritten.governance
      )
    })
    const rewrittenEnvelope = JSON.parse(
      rewrittenBytes
    ) as SerializedVisualArtifactLedger
    ;(rewrittenEnvelope as { rootAttestation: typeof originalAttestation }).rootAttestation =
      originalAttestation
    expect(() =>
      parseVisualArtifactLedger(canonicalStringify(rewrittenEnvelope), {
        dependencies: original.governance.ledgerDependencies()
      })
    ).toThrow(/primitive boolean true/i)
  })

  it('canonically serializes/parses only with exact parser options', () => {
    const { governance, scheduler, ledger, ids, clock, hashes } = setup()
    appendAcceptedArtifact(
      ledger,
      scheduler,
      governance,
      ids[0],
      1,
      hashes,
      clock
    )
    const rootAttestation = ledgerRootAttestation(ledger, governance)
    const serialized = serializeVisualArtifactLedger(ledger, {
      rootAttestation
    })
    const parsed = parseVisualArtifactLedger(serialized, {
      dependencies: governance.ledgerDependencies(scheduler)
    })
    expect(parsed.rootHash).toBe(ledger.rootHash)
    expect(() => parseVisualArtifactLedger(serialized, null)).toThrow(/plain object/i)
    expect(() =>
      parseVisualArtifactLedger(serialized, {
        dependencies: governance.ledgerDependencies(scheduler),
        trustedCheckpoint: ledger.createCheckpoint()
      })
    ).toThrow(/unknown field "trustedCheckpoint"/i)
  })

  it('rejects duplicate JSON keys before replay', () => {
    const { governance, ledger, ids, clock, hashes } = setup()
    appendPromptApproved(ledger, governance, ids[0], 1, hashes, clock, {
      promptVerdict: 'rejected'
    })
    const rootAttestation = ledgerRootAttestation(ledger, governance)
    const serialized = ledger.serialize({ rootAttestation })
    const duplicate = serialized.replace(
      '{"events"',
      '{"schemaVersion":2,"events"'
    )
    expect(() =>
      parseVisualArtifactLedger(duplicate, {
        dependencies: governance.ledgerDependencies()
      })
    ).toThrow(/canonical|duplicate keys/i)
    expect(() =>
      parseVisualArtifactLedger('{"value":"\ud800"}', {
        dependencies: governance.ledgerDependencies()
      })
    ).toThrow(/unpaired UTF-16 surrogates/i)
    expect(() =>
      parseVisualArtifactLedger('{"\ud800":1}', {
        dependencies: governance.ledgerDependencies()
      })
    ).toThrow(/unpaired UTF-16 surrogates/i)
  })

  it('fails empty/incomplete finalization and requires attested pre-final checkpoint', () => {
    const empty = setup()
    const checkpoint = empty.ledger.createCheckpoint()
    const raw = {
      occurredAt: empty.clock.next(),
      actorId: 'release-owner',
      planHash: empty.plan.planHash,
      registryHash: empty.plan.registryHash,
      trustedCheckpoint: checkpoint,
      trustedCheckpointAttestation: { token: 'self-issued' }
    }
    const principal = empty.governance.attestations.issuePrincipal(
      empty.ledger.finalizationPrincipalBindingFor(raw)
    )
    expect(() => empty.ledger.finalize(raw, principal)).toThrow(
      /primitive boolean true/i
    )

    const incomplete = setup(45)
    appendAcceptedArtifact(
      incomplete.ledger,
      incomplete.scheduler,
      incomplete.governance,
      incomplete.ids[0],
      1,
      incomplete.hashes,
      incomplete.clock
    )
    const incompleteCheckpoint = incomplete.ledger.createCheckpoint()
    const checkpointAttestation = incomplete.governance.attestations.issueRoot({
      domain: 'visual-artifact-ledger',
      purpose: 'finalization-checkpoint',
      rootHash: incompleteCheckpoint.rootHash,
      version: incompleteCheckpoint.sequence,
      contextHash: incomplete.plan.planHash
    })
    const value = {
      occurredAt: incomplete.clock.next(),
      actorId: 'release-owner',
      planHash: incomplete.plan.planHash,
      registryHash: incomplete.plan.registryHash,
      trustedCheckpoint: incompleteCheckpoint,
      trustedCheckpointAttestation: checkpointAttestation
    }
    const incompletePrincipal = incomplete.governance.attestations.issuePrincipal(
      incomplete.ledger.finalizationPrincipalBindingFor(value)
    )
    expect(() => incomplete.ledger.finalize(value, incompletePrincipal)).toThrow(/incomplete/i)
  })

  it('rejects finalization for constructible floor and headroom plans', () => {
    for (const triggerFamilyCount of [10, 46, 53]) {
      const subject = setup(triggerFamilyCount)
      const checkpoint = subject.ledger.createCheckpoint()
      const checkpointAttestation = subject.governance.attestations.issueRoot({
        domain: 'visual-artifact-ledger',
        purpose: 'finalization-checkpoint',
        rootHash: checkpoint.rootHash,
        version: checkpoint.sequence,
        contextHash: subject.plan.planHash
      })
      const value = {
        occurredAt: subject.clock.next(),
        actorId: 'release-owner',
        planHash: subject.plan.planHash,
        registryHash: subject.plan.registryHash,
        trustedCheckpoint: checkpoint,
        trustedCheckpointAttestation: checkpointAttestation
      }
      const principal = subject.governance.attestations.issuePrincipal(
        subject.ledger.finalizationPrincipalBindingFor(value)
      )
      expect(() => subject.ledger.finalize(value, principal)).toThrow(
        /approved exact 16600-artifact contract/i
      )
    }
  })

  it('keeps contiguous supersession histories and rejects gaps/root tampering', () => {
    const { governance, ledger, ids, clock, hashes } = setup()
    for (const artifactId of ids.slice(0, 2)) {
      appendPromptApproved(
        ledger,
        governance,
        artifactId,
        1,
        hashes,
        clock,
        { promptVerdict: 'rejected' }
      )
      const priorRoot = ledger.getArtifact(artifactId)!.revisions[0].rootHash
      startArtifact(
        ledger,
        governance,
        artifactId,
        hashes,
        clock,
        2,
        'artifact-revision-superseded',
        priorRoot
      )
      expect(
        ledger.getArtifact(artifactId)?.revisions.map((revision) => revision.revision)
      ).toEqual([1, 2])
    }
    expect(() =>
      startArtifact(
        ledger,
        governance,
        ids[0],
        hashes,
        clock,
        MAX_REVISIONS_PER_ARTIFACT + 1,
        'artifact-revision-superseded',
        hashNumber(999)
      )
    ).toThrow(/revision/i)
  })

  it('rejects removed supersession history even after coherent event rehashing', () => {
    const { governance, ledger, ids, clock, hashes } = setup()
    appendPromptApproved(ledger, governance, ids[0], 1, hashes, clock, {
      promptVerdict: 'rejected'
    })
    const priorRoot = ledger.getArtifact(ids[0])!.revisions[0].rootHash
    const specificationHash = startArtifact(
      ledger,
      governance,
      ids[0],
      hashes,
      clock,
      2,
      'artifact-revision-superseded',
      priorRoot
    )
    const researchHash = hashes.next()
    const occurredAt = clock.next()
    appendLedger(ledger, governance, {
      type: 'research-recorded',
      occurredAt,
      actorId: 'researcher',
      artifactId: ids[0],
      revision: 2,
      researchHash,
      evidence: evidence(
        ledger,
        governance,
        'research',
        ids[0],
        2,
        occurredAt,
        'researcher',
        specificationHash,
        researchHash
      )
    })
    const envelope = JSON.parse(
      ledger.serialize({ rootAttestation: ledgerRootAttestation(ledger, governance) })
    ) as SerializedVisualArtifactLedger
    const index = envelope.events.findIndex(
      (event) => event.type === 'artifact-revision-superseded'
    )
    ;(envelope.events as ArtifactEvent[]).splice(index, 1)
    const tampered = rehashEnvelope(envelope)
    expect(() =>
      parseVisualArtifactLedger(tampered, {
        dependencies: governance.ledgerDependencies()
      })
    ).toThrow(/primitive boolean true|current revision|has not started/i)
  })

  it('binds exhaustion to the final authority-committed failed attempt', () => {
    const { governance, scheduler, ledger, ids, clock, hashes } = setup()
    const context = appendPromptApproved(
      ledger,
      governance,
      ids[0],
      1,
      hashes,
      clock
    )
    governance.schedulerAuthority.ensureAfter(context.promptApprovedAt)
    let priorCallId: string | null = null
    let priorReason: 'timeout' | 'rate-limit' | null = null
    let finalCallId = ''
    for (let attempt = 1; attempt <= scheduler.policy.maxAttempts; attempt += 1) {
      if (attempt > 1) {
        governance.schedulerAuthority.advance(
          attempt === 2 ? scheduler.policy.baseBackoffMs : scheduler.policy.baseBackoffMs * 2
        )
      }
      finalCallId = `exhaust-${attempt}`
      appendScheduler(scheduler, governance, 'reserve', {
        actorId: 'scheduler-control',
        callId: finalCallId,
        artifactId: context.artifactId,
        revision: 1,
        attempt,
        promptHash: context.promptHash,
        promptApprovalHash: context.promptApprovalHash,
        approvalCheckpoint: context.approvalCheckpoint,
        requestHash: hashes.next(),
        retryOfCallId: priorCallId,
        retryReason: priorReason
      })
      appendScheduler(scheduler, governance, 'dispatch', {
        actorId: 'scheduler-worker',
        callId: finalCallId
      })
      const reason = attempt === scheduler.policy.maxAttempts ? 'rate-limit' : 'timeout'
      appendScheduler(scheduler, governance, 'fail', {
        actorId: 'scheduler-worker',
        callId: finalCallId,
        failureReason: reason,
        retryAfterMs: null
      })
      priorCallId = finalCallId
      priorReason = reason
    }
    const finalCall = scheduler.requireExhaustedFailure(finalCallId)
    clock.ensureAfter(finalCall.completedAt!)
    const occurredAt = clock.next()
    const exhaustionHash = hashes.next()
    appendLedger(ledger, governance, {
      type: 'revision-exhausted',
      occurredAt,
      actorId: 'release-owner',
      artifactId: context.artifactId,
      revision: 1,
      schedulerCallId: finalCall.callId,
      schedulerCallHash: finalCall.callHash,
      schedulerAuthorityId: scheduler.authorityId,
      schedulerAuthorityVersion: finalCall.completionAuthorityVersion,
      schedulerAuthorityRootHash: finalCall.completionAuthorityRootHash,
      schedulerAuthorityCommitHash: finalCall.completionAuthorityCommitHash,
      failureReason: finalCall.failureReason,
      exhaustionHash,
      evidence: evidence(
        ledger,
        governance,
        'exhaustion',
        context.artifactId,
        1,
        occurredAt,
        'release-owner',
        finalCall.callHash,
        exhaustionHash
      )
    })
    expect(ledger.getArtifact(ids[0])?.revisions[0].status).toBe('exhausted')
  })

  it('rejects null/malformed history and cardinality exhaustion before replay', () => {
    const { governance, plan } = setup()
    const rootAttestation = governance.attestations.issueRoot({
      domain: 'visual-artifact-ledger',
      purpose: 'envelope',
      rootHash: hashNumber(1),
      version: 0,
      contextHash: plan.planHash
    })
    expect(() =>
      parseVisualArtifactLedger(
        canonicalStringify({
          schemaVersion: 2,
          plan,
          rootAttestation,
          events: null
        }),
        {
          dependencies: governance.ledgerDependencies()
        }
      )
    ).toThrow(/history must be an array/i)
    expect(() =>
      parseVisualArtifactLedger(
        canonicalStringify({
          schemaVersion: 2,
          plan,
          rootAttestation,
          events: new Array(MAX_LEDGER_EVENTS + 1).fill(null)
        }),
        {
          dependencies: governance.ledgerDependencies()
        }
      )
    ).toThrow(/exceeds .* events/i)
  })

  it('binds root to plan, sequence, and final event hash', () => {
    const { governance, ledger, ids, clock, hashes } = setup()
    appendPromptApproved(ledger, governance, ids[0], 1, hashes, clock, {
      promptVerdict: 'rejected'
    })
    expect(ledger.rootHash).toBe(
      computeVisualArtifactLedgerRootHash(
        ledger.plan.planHash,
        ledger.sequence,
        ledger.events().at(-1)!.eventHash
      )
    )
  })
})
