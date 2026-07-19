import { describe, expect, it } from 'vitest'
import {
  SOCIAL_APPROVAL_SCHEMA,
  SOCIAL_CONNECTOR_CONTRACT_VERSION,
  SOCIAL_CONNECTOR_SCHEMA,
  createMockConnectorStatus,
  socialCapabilityFor,
  type SocialActionIntentV1,
  type SocialActorV1,
  type SocialCapabilityId,
  type SocialDestinationPolicyV1,
  type SocialProvider
} from '../../shared/social-connectors'
import { ManualSocialClock } from './clock'
import { createSignedMockWebhookFixture } from './fixture-signature'
import {
  createMockDestinationPolicy,
  createMockDiscordConnector,
  createMockTwitchConnector,
  type DeterministicMockSocialConnector,
  type MockSocialConnectorOptions
} from './mock-adapter'
import { socialHash } from './security'

const NOW = 1_800_000_000_000
const KEY_ID = 'fixture-key-v1'
const KEY_MATERIAL = 'public-test-fixture-material-not-a-live-credential'
const OPERATOR: SocialActorV1 = { actorRef: 'operator:fixture', role: 'operator' }
const OTHER_OPERATOR: SocialActorV1 = { actorRef: 'operator:other', role: 'operator' }

type ConnectorOverrides = Partial<
  Omit<
    MockSocialConnectorOptions,
    'provider' | 'referenceTimeMs' | 'fixtureKeyId' | 'fixtureKeyMaterial'
  >
>

function connector(
  provider: SocialProvider,
  overrides: ConnectorOverrides = {}
): DeterministicMockSocialConnector {
  const options = {
    referenceTimeMs: NOW,
    fixtureKeyId: KEY_ID,
    fixtureKeyMaterial: KEY_MATERIAL,
    ...overrides
  }
  if (provider === 'twitch') return createMockTwitchConnector(options)
  return createMockDiscordConnector(options)
}

function action(
  provider: SocialProvider,
  capabilityId: SocialCapabilityId,
  payload: Readonly<Record<string, unknown>>,
  suffix: string,
  actor = OPERATOR
): SocialActionIntentV1 {
  const capability = socialCapabilityFor(provider, capabilityId)
  if (!capability) throw new Error(`Missing capability ${capabilityId}`)
  return {
    schema: SOCIAL_CONNECTOR_SCHEMA,
    contractVersion: SOCIAL_CONNECTOR_CONTRACT_VERSION,
    intentId: `intent:${suffix}`,
    provider,
    capabilityId,
    destination: capability.destination,
    actor,
    idempotencyKey: `idempotency:${suffix}`,
    sourceProvider: provider,
    payload,
    consentEpoch: 1,
    createdAtMs: NOW - 1_000,
    deadlineMs: NOW + 60_000
  }
}

function approve(
  target: DeterministicMockSocialConnector,
  intent: SocialActionIntentV1,
  suffix: string
): SocialActionIntentV1 {
  const requestId = `approval:${suffix}`
  target.approvalQueue.enqueue({
    schema: SOCIAL_APPROVAL_SCHEMA,
    contractVersion: SOCIAL_CONNECTOR_CONTRACT_VERSION,
    requestId,
    provider: intent.provider,
    capabilityId: intent.capabilityId,
    destination: intent.destination,
    requestedBy: intent.actor,
    reason: 'Adversarial fixture',
    payloadHash: socialHash(intent.payload),
    createdAtMs: NOW - 500,
    expiresAtMs: NOW + 30_000,
    oneShot: true,
    state: 'pending'
  })
  const receipt = target.approvalQueue.decide(
    requestId,
    'approved',
    OPERATOR,
    'Approved fixture',
    NOW - 100
  )
  return { ...intent, approvalRef: receipt.approvalRef }
}

function webhook(
  provider: SocialProvider,
  capabilityId: SocialCapabilityId,
  eventId: string,
  deliveryId: string,
  occurredAtMs = NOW
) {
  return createSignedMockWebhookFixture(
    {
      provider,
      capabilityId,
      deliveryId,
      eventId,
      occurredAtMs,
      body: JSON.stringify({ eventId, source: provider })
    },
    KEY_ID,
    KEY_MATERIAL
  )
}

describe('credential material adversarial gates', () => {
  it.each([
    ['apiKey', 'ＡＰＩ＿ＫＥＹ'],
    ['token', 'to\u200b_ken'],
    ['secret', 'se--cret']
  ] as const)('rejects a normalized nested %s key from outbound payloads', (label, key) => {
    const target = connector('twitch')
    const result = target.execute(
      action(
        'twitch',
        'twitch.chat.write',
        { envelope: [{ metadata: { [key]: 'fixture-value' } }] },
        `nested-${label}`
      ),
      OPERATOR
    )

    expect(result).toMatchObject({
      outcome: 'denied',
      reasonCode: 'payload.credential_material'
    })
    expect(target.serializeAuditReceipts()).not.toContain('fixture-value')
  })

  it('rejects normalized credential keys nested in inbound arrays', () => {
    const target = connector('twitch')
    const fixture = createSignedMockWebhookFixture(
      {
        provider: 'twitch',
        capabilityId: 'twitch.eventsub.ingest',
        deliveryId: 'nested-credential-delivery',
        eventId: 'nested-credential-event',
        occurredAtMs: NOW,
        body: JSON.stringify({
          envelope: [{ metadata: { 'api--key': 'fixture-value' } }]
        })
      },
      KEY_ID,
      KEY_MATERIAL
    )

    expect(target.ingestFixture(fixture)).toMatchObject({
      outcome: 'denied',
      reasonCode: 'webhook.invalid_payload'
    })
    expect(target.serializeAuditReceipts()).not.toContain('fixture-value')
  })
})

describe('webhook replay and event identity adversarial gates', () => {
  it('keys replay protection by provider and delivery id before signature validation', () => {
    const target = connector('discord')
    const first = webhook(
      'discord',
      'discord.command.receive',
      'original-event',
      'shared-delivery'
    )
    const conflicting = createSignedMockWebhookFixture(
      {
        provider: 'discord',
        capabilityId: 'discord.command.receive',
        deliveryId: first.deliveryId,
        eventId: 'conflicting-event',
        occurredAtMs: NOW,
        body: JSON.stringify({ eventId: 'conflicting-event', source: 'discord' })
      },
      KEY_ID,
      KEY_MATERIAL
    )

    const accepted = target.ingestFixture(first)
    expect(accepted.outcome).toBe('accepted')

    for (const candidate of [
      conflicting,
      { ...conflicting, signature: 'sha256=invalid' }
    ]) {
      expect(target.ingestFixture(candidate)).toMatchObject({
        outcome: 'denied',
        reasonCode: 'webhook.delivery_conflict',
        receipt: {
          decision: 'denied',
          replayedReceiptId: accepted.receipt.receiptId
        }
      })
    }
  })

  it('scopes event deduplication by provider capability', () => {
    const target = connector('twitch')

    expect(
      target.ingestFixture(
        webhook(
          'twitch',
          'twitch.eventsub.ingest',
          'shared-provider-event',
          'eventsub-delivery'
        )
      ).outcome
    ).toBe('accepted')
    const differentCapability = target.ingestFixture(
      webhook('twitch', 'twitch.chat.read', 'shared-provider-event', 'chat-delivery')
    )

    expect(differentCapability).toMatchObject({
      outcome: 'accepted',
      event: { capabilityId: 'twitch.chat.read' }
    })
  })

  it('rejects conflicting content for the same provider capability event', () => {
    const target = connector('twitch')
    const first = webhook(
      'twitch',
      'twitch.eventsub.ingest',
      'conflicting-event',
      'conflicting-event-delivery-a'
    )
    const conflicting = createSignedMockWebhookFixture(
      {
        provider: 'twitch',
        capabilityId: 'twitch.eventsub.ingest',
        deliveryId: 'conflicting-event-delivery-b',
        eventId: first.eventId,
        occurredAtMs: first.occurredAtMs,
        body: JSON.stringify({
          eventId: first.eventId,
          source: 'twitch',
          variant: 'changed'
        })
      },
      KEY_ID,
      KEY_MATERIAL
    )

    const accepted = target.ingestFixture(first)
    expect(accepted.outcome).toBe('accepted')
    expect(target.ingestFixture(conflicting)).toMatchObject({
      outcome: 'denied',
      reasonCode: 'event.conflict',
      receipt: {
        decision: 'denied',
        replayedReceiptId: accepted.receipt.receiptId
      }
    })
  })
})

describe('approval and authenticated actor adversarial gates', () => {
  it('rejects cross-payload approval reuse without consuming the approval', () => {
    const target = connector('twitch')
    const approved = approve(
      target,
      action('twitch', 'twitch.marker.create', { marker: 'incident-1' }, 'payload-a'),
      'payload-a'
    )
    const changed = {
      ...approved,
      intentId: 'intent:payload-b',
      idempotencyKey: 'idempotency:payload-b',
      payload: { marker: 'incident-2' }
    }

    expect(target.execute(changed, OPERATOR).reasonCode).toBe('approval.payload_mismatch')
    expect(target.approvalQueue.getReceipt(approved.approvalRef!)?.state).toBe('approved')
  })

  it('rejects cross-actor approval reuse and unauthenticated actor substitution', () => {
    const target = connector('twitch')
    const approved = approve(
      target,
      action('twitch', 'twitch.marker.create', { marker: 'incident-1' }, 'actor-a'),
      'actor-a'
    )
    const changedActor = {
      ...approved,
      intentId: 'intent:actor-b',
      idempotencyKey: 'idempotency:actor-b',
      actor: OTHER_OPERATOR
    }

    expect(target.execute(changedActor, OTHER_OPERATOR).reasonCode).toBe(
      'approval.actor_mismatch'
    )
    expect(target.approvalQueue.getReceipt(approved.approvalRef!)?.state).toBe('approved')
    expect(target.execute(approved, OTHER_OPERATOR).reasonCode).toBe(
      'actor.authenticated_mismatch'
    )
    expect(target.approvalQueue.getReceipt(approved.approvalRef!)?.state).toBe('approved')
  })
})

describe('immutable Twitch destination guard', () => {
  it('blocks non-Twitch source chat even when the policy source allowlist is permissive', () => {
    const target = connector('twitch')
    target.setPolicy(
      createMockDestinationPolicy('twitch', NOW, {
        allowedSourceProviders: ['twitch', 'youtube']
      })
    )
    const approved = approve(
      target,
      {
        ...action('twitch', 'twitch.chat.write', { message: 'merged chat' }, 'merged-chat'),
        sourceProvider: 'youtube'
      },
      'merged-chat'
    )

    expect(target.execute(approved, OPERATOR).reasonCode).toBe(
      'policy.twitch_merged_chat_blocked'
    )
  })

  it('rejects Twitch policies that weaken the merged-chat invariant', () => {
    expect(() =>
      createMockDestinationPolicy('twitch', NOW, {
        twitchMergedChatOutput: 'not-applicable'
      })
    ).toThrow(/must block merged-chat/)

    const target = connector('twitch')
    const valid = createMockDestinationPolicy('twitch', NOW)
    const invalid = {
      ...valid,
      twitchMergedChatOutput: 'allow'
    } as unknown as SocialDestinationPolicyV1

    expect(() => target.setPolicy(invalid)).toThrow(/must block merged-chat/)
    expect(() =>
      createMockTwitchConnector({
        referenceTimeMs: NOW,
        fixtureKeyId: KEY_ID,
        fixtureKeyMaterial: KEY_MATERIAL,
        policy: invalid
      })
    ).toThrow(/must block merged-chat/)
  })
})

describe('idempotency request fingerprinting', () => {
  it('returns the prior simulated result for a canonical exact duplicate', () => {
    const target = connector('twitch')
    const approved = approve(
      target,
      action(
        'twitch',
        'twitch.marker.create',
        { alpha: 1, beta: 2 },
        'canonical-duplicate'
      ),
      'canonical-duplicate'
    )

    const first = target.execute(approved, OPERATOR)
    const duplicate = target.execute(
      { ...approved, payload: { beta: 2, alpha: 1 } },
      OPERATOR
    )

    expect(first.outcome).toBe('simulated')
    expect(duplicate.outcome).toBe('duplicate')
    expect(duplicate.reasonCode).toBe('idempotency.duplicate')
    expect(duplicate.duplicate).toBe(true)
    expect(duplicate.mockProviderRef).toBe(first.mockProviderRef)
    expect(duplicate.receipt).toMatchObject({
      decision: 'duplicate',
      reasonCode: 'idempotency.duplicate',
      replayedReceiptId: first.receipt.receiptId,
      mockProviderRef: first.mockProviderRef
    })
    expect(duplicate.receipt.receiptId).not.toBe(first.receipt.receiptId)
  })

  it('rejects mismatched idempotency-key reuse before consuming a new approval', () => {
    const target = connector('twitch')
    const first = approve(
      target,
      action('twitch', 'twitch.marker.create', { marker: 'first' }, 'same-key'),
      'same-key-first'
    )
    expect(target.execute(first, OPERATOR).outcome).toBe('simulated')

    const mismatched = approve(
      target,
      {
        ...action('twitch', 'twitch.marker.create', { marker: 'second' }, 'same-key'),
        intentId: first.intentId,
        idempotencyKey: first.idempotencyKey
      },
      'same-key-second'
    )

    expect(target.execute(mismatched, OPERATOR).reasonCode).toBe('idempotency.mismatch')
    expect(target.approvalQueue.getReceipt(mismatched.approvalRef!)?.state).toBe('approved')
    expect(target.getStatus().quota.remaining).toBe(99)
  })

  it('treats an idempotency key as provider-wide rather than capability-scoped', () => {
    const target = connector('twitch')
    const first = approve(
      target,
      action('twitch', 'twitch.marker.create', { marker: 'first' }, 'provider-wide-key'),
      'provider-wide-first'
    )
    expect(target.execute(first, OPERATOR).outcome).toBe('simulated')

    const otherCapability = approve(
      target,
      {
        ...action(
          'twitch',
          'twitch.clip.create',
          { incidentRef: 'incident-1' },
          'provider-wide-clip'
        ),
        idempotencyKey: first.idempotencyKey
      },
      'provider-wide-second'
    )

    expect(target.execute(otherCapability, OPERATOR).reasonCode).toBe(
      'idempotency.mismatch'
    )
    expect(target.approvalQueue.getReceipt(otherCapability.approvalRef!)?.state).toBe(
      'approved'
    )
  })
})

describe('finite time validation', () => {
  it('rejects non-finite connector, policy, status, intent, fixture and setter times', () => {
    expect(() =>
      createMockTwitchConnector({
        referenceTimeMs: Number.NaN,
        fixtureKeyId: KEY_ID,
        fixtureKeyMaterial: KEY_MATERIAL
      })
    ).toThrow(/finite/)
    expect(() => createMockConnectorStatus('twitch', Number.POSITIVE_INFINITY)).toThrow(
      /finite/
    )
    expect(() =>
      createMockDestinationPolicy('twitch', NOW, {
        validUntilMs: Number.POSITIVE_INFINITY
      })
    ).toThrow(/finite/)

    const target = connector('twitch')
    expect(() =>
      target.setQuota({
        state: 'available',
        limit: 100,
        remaining: 100,
        resetAtMs: Number.NaN
      })
    ).toThrow(/finite/)
    expect(() => target.setConsent('granted', 1, Number.NEGATIVE_INFINITY)).toThrow(
      /finite/
    )

    const invalidDeadline = {
      ...action('twitch', 'twitch.marker.create', { marker: 'invalid' }, 'invalid-time'),
      deadlineMs: Number.POSITIVE_INFINITY
    }
    expect(target.execute(invalidDeadline, OPERATOR).reasonCode).toBe(
      'validation.non_finite_time'
    )

    const validFixture = webhook(
      'twitch',
      'twitch.eventsub.ingest',
      'invalid-time-event',
      'invalid-time-delivery'
    )
    expect(
      target.ingestFixture({
        ...validFixture,
        occurredAtMs: Number.NaN
      })
    ).toMatchObject({ outcome: 'denied', reasonCode: 'validation.non_finite_time' })

    const clock = new ManualSocialClock(NOW)
    expect(() => clock.setNowMs(Number.POSITIVE_INFINITY)).toThrow(/finite/)
    expect(() => clock.advanceBy(Number.NaN)).toThrow(/finite/)
  })
})

describe('authority clock, inbound rate limits and bounded state', () => {
  it('uses the injected authority clock for inbound rate windows', () => {
    const clock = new ManualSocialClock(NOW)
    const target = connector('discord', {
      clock,
      rateLimitOverrides: {
        'discord.command.receive': { maxRequests: 2, windowMs: 1_000, quotaCost: 0 }
      }
    })

    expect(
      target.ingestFixture(
        webhook('discord', 'discord.command.receive', 'event-1', 'delivery-1', NOW - 500)
      ).outcome
    ).toBe('accepted')
    expect(
      target.ingestFixture(
        webhook('discord', 'discord.command.receive', 'event-2', 'delivery-2', NOW - 900)
      ).outcome
    ).toBe('accepted')
    const limited = target.ingestFixture(
      webhook('discord', 'discord.command.receive', 'event-3', 'delivery-3', NOW - 1_000)
    )
    expect(limited).toMatchObject({
      outcome: 'denied',
      reasonCode: 'rate_limit.exceeded',
      retryAfterMs: 1_000
    })

    clock.advanceBy(1_000)
    expect(
      target.ingestFixture(
        webhook(
          'discord',
          'discord.command.receive',
          'event-4',
          'delivery-4',
          clock.nowMs()
        )
      ).outcome
    ).toBe('accepted')
  })

  it('bounds and expires replay, event and audit storage', () => {
    const clock = new ManualSocialClock(NOW)
    const target = connector('twitch', {
      clock,
      rateLimitOverrides: {
        'twitch.eventsub.ingest': { maxRequests: 10, windowMs: 60_000, quotaCost: 0 }
      },
      storageLimits: {
        maxWebhookDeliveries: 2,
        maxEvents: 2,
        maxAuditReceipts: 2,
        eventRetentionMs: 100,
        auditRetentionMs: 100
      }
    })

    for (let index = 0; index < 2; index += 1) {
      expect(
        target.ingestFixture(
          webhook(
            'twitch',
            'twitch.eventsub.ingest',
            `bounded-event-${index}`,
            `bounded-delivery-${index}`,
            clock.nowMs()
          )
        ).outcome
      ).toBe('accepted')
    }
    expect(
      target.ingestFixture(
        webhook(
          'twitch',
          'twitch.eventsub.ingest',
          'bounded-event-2',
          'bounded-delivery-2',
          clock.nowMs()
        )
      )
    ).toMatchObject({ outcome: 'denied', reasonCode: 'storage.replay_capacity' })
    expect(target.getStorageStats()).toEqual({
      webhookDeliveries: 2,
      events: 2,
      auditReceipts: 2
    })

    clock.advanceBy(101)
    expect(target.getStorageStats()).toEqual({
      webhookDeliveries: 2,
      events: 0,
      auditReceipts: 0
    })

    clock.advanceBy(5 * 60_000 + 1)
    expect(target.getStorageStats()).toEqual({
      webhookDeliveries: 0,
      events: 0,
      auditReceipts: 0
    })
    expect(
      target.ingestFixture(
        webhook(
          'twitch',
          'twitch.eventsub.ingest',
          'bounded-event-1',
          'bounded-delivery-after-expiry',
          clock.nowMs()
        )
      ).outcome
    ).toBe('accepted')
  })

  it('fails closed instead of evicting live event-dedupe entries at capacity', () => {
    const clock = new ManualSocialClock(NOW)
    const target = connector('twitch', {
      clock,
      rateLimitOverrides: {
        'twitch.eventsub.ingest': { maxRequests: 10, windowMs: 60_000, quotaCost: 0 }
      },
      storageLimits: {
        maxWebhookDeliveries: 3,
        maxEvents: 2,
        maxAuditReceipts: 4,
        eventRetentionMs: 60_000,
        auditRetentionMs: 60_000
      }
    })

    expect(
      target.ingestFixture(
        webhook('twitch', 'twitch.eventsub.ingest', 'event-a', 'delivery-a')
      ).outcome
    ).toBe('accepted')
    expect(
      target.ingestFixture(
        webhook('twitch', 'twitch.eventsub.ingest', 'event-b', 'delivery-b')
      ).outcome
    ).toBe('accepted')
    expect(
      target.ingestFixture(
        webhook('twitch', 'twitch.eventsub.ingest', 'event-c', 'delivery-c')
      )
    ).toMatchObject({ outcome: 'denied', reasonCode: 'storage.event_capacity' })
    expect(target.getStorageStats()).toMatchObject({ webhookDeliveries: 3, events: 2 })
  })
})
