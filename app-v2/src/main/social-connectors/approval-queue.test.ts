import { describe, expect, it } from 'vitest'
import {
  SOCIAL_APPROVAL_SCHEMA,
  SOCIAL_CONNECTOR_CONTRACT_VERSION,
  type SocialActorV1,
  type SocialApprovalRequestV1
} from '../../shared/social-connectors'
import { DeterministicSocialApprovalQueue } from './approval-queue'
import { socialHash } from './security'

const NOW = 1_800_000_000_000
const REQUESTER: SocialActorV1 = { actorRef: 'operator:requester', role: 'operator' }
const APPROVER: SocialActorV1 = { actorRef: 'operator:approver', role: 'operator' }
const OTHER_ACTOR: SocialActorV1 = { actorRef: 'operator:other', role: 'operator' }

function request(overrides: Partial<SocialApprovalRequestV1> = {}): SocialApprovalRequestV1 {
  return {
    schema: SOCIAL_APPROVAL_SCHEMA,
    contractVersion: SOCIAL_CONNECTOR_CONTRACT_VERSION,
    requestId: 'approval-request:binding',
    provider: 'twitch',
    capabilityId: 'twitch.marker.create',
    destination: 'twitch.channel',
    requestedBy: REQUESTER,
    reason: 'Adversarial fixture',
    payloadHash: socialHash({ marker: 'incident-42' }),
    createdAtMs: NOW - 1_000,
    expiresAtMs: NOW + 60_000,
    oneShot: true,
    state: 'pending',
    ...overrides
  }
}

describe('DeterministicSocialApprovalQueue binding', () => {
  it('copies the exact canonical payload and requester into the decision receipt', () => {
    const queue = new DeterministicSocialApprovalQueue()
    const queued = queue.enqueue(request())
    const receipt = queue.decide(
      queued.requestId,
      'approved',
      APPROVER,
      'Approved fixture',
      NOW
    )

    expect(receipt.payloadHash).toBe(queued.payloadHash)
    expect(receipt.requestedBy).toEqual(REQUESTER)
    expect(receipt.requestFingerprint).toBe(
      socialHash({
        requestId: queued.requestId,
        provider: queued.provider,
        capabilityId: queued.capabilityId,
        destination: queued.destination,
        requestedBy: queued.requestedBy,
        payloadHash: queued.payloadHash,
        createdAtMs: queued.createdAtMs,
        expiresAtMs: queued.expiresAtMs
      })
    )
  })

  it('rejects cross-payload and cross-actor reuse without consuming the approval', () => {
    const queue = new DeterministicSocialApprovalQueue()
    const queued = queue.enqueue(request())
    const receipt = queue.decide(
      queued.requestId,
      'approved',
      APPROVER,
      'Approved fixture',
      NOW
    )

    expect(
      queue.consume({
        approvalRef: receipt.approvalRef,
        provider: queued.provider,
        capabilityId: queued.capabilityId,
        destination: queued.destination,
        authenticatedActor: REQUESTER,
        payloadHash: socialHash({ marker: 'different-incident' }),
        nowMs: NOW
      })
    ).toMatchObject({ allowed: false, reasonCode: 'approval.payload_mismatch' })
    expect(queue.getReceipt(receipt.approvalRef)?.state).toBe('approved')

    expect(
      queue.consume({
        approvalRef: receipt.approvalRef,
        provider: queued.provider,
        capabilityId: queued.capabilityId,
        destination: queued.destination,
        authenticatedActor: OTHER_ACTOR,
        payloadHash: queued.payloadHash,
        nowMs: NOW
      })
    ).toMatchObject({ allowed: false, reasonCode: 'approval.actor_mismatch' })
    expect(queue.getReceipt(receipt.approvalRef)?.state).toBe('approved')
  })

  it('rejects non-finite creation, expiry, decision and consume times', () => {
    const queue = new DeterministicSocialApprovalQueue()

    expect(() => queue.enqueue(request({ createdAtMs: Number.NaN }))).toThrow(/finite/)
    expect(() => queue.enqueue(request({ expiresAtMs: Number.POSITIVE_INFINITY }))).toThrow(
      /finite/
    )

    const queued = queue.enqueue(request({ requestId: 'approval-request:finite' }))
    expect(() =>
      queue.decide(
        queued.requestId,
        'approved',
        APPROVER,
        'Invalid time',
        Number.NEGATIVE_INFINITY
      )
    ).toThrow(/finite/)

    const receipt = queue.decide(
      queued.requestId,
      'approved',
      APPROVER,
      'Approved fixture',
      NOW
    )
    expect(() =>
      queue.consume({
        approvalRef: receipt.approvalRef,
        provider: queued.provider,
        capabilityId: queued.capabilityId,
        destination: queued.destination,
        authenticatedActor: REQUESTER,
        payloadHash: queued.payloadHash,
        nowMs: Number.NaN
      })
    ).toThrow(/finite/)
  })

  it('rejects actor roles outside the SocialActorRole contract at every boundary', () => {
    const invalidActor = {
      actorRef: 'operator:invalid-role',
      role: 'administrator'
    } as unknown as SocialActorV1
    const queue = new DeterministicSocialApprovalQueue()

    expect(() => queue.enqueue(request({ requestedBy: invalidActor }))).toThrow(
      /valid social actor role/
    )
    const queued = queue.enqueue(request({ requestId: 'approval-request:invalid-role' }))
    expect(() =>
      queue.decide(queued.requestId, 'approved', invalidActor, 'Invalid actor', NOW)
    ).toThrow(/valid social actor role/)

    const receipt = queue.decide(
      queued.requestId,
      'approved',
      APPROVER,
      'Approved fixture',
      NOW
    )
    expect(() =>
      queue.consume({
        approvalRef: receipt.approvalRef,
        provider: queued.provider,
        capabilityId: queued.capabilityId,
        destination: queued.destination,
        authenticatedActor: invalidActor,
        payloadHash: queued.payloadHash,
        nowMs: NOW
      })
    ).toThrow(/valid social actor role/)
  })
})
