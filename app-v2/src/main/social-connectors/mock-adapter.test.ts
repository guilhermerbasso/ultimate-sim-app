import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  SOCIAL_APPROVAL_SCHEMA,
  SOCIAL_CONNECTOR_CONTRACT_VERSION,
  SOCIAL_CONNECTOR_MANIFESTS,
  SOCIAL_CONNECTOR_SCHEMA,
  socialCapabilityFor,
  type SocialActionIntentV1,
  type SocialActorV1,
  type SocialCapabilityId,
  type SocialProvider
} from '../../shared/social-connectors'
import { DeterministicSocialApprovalQueue } from './approval-queue'
import { ManualSocialClock } from './clock'
import {
  createSignedMockWebhookFixture,
  verifyMockWebhookFixtureSignature
} from './fixture-signature'
import {
  createMockDestinationPolicy,
  createMockDiscordConnector,
  createMockTwitchConnector,
  createMockYouTubeConnector,
  type DeterministicMockSocialConnector,
  type MockSocialConnectorOptions
} from './mock-adapter'
import { socialHash } from './security'

const NOW = 1_800_000_000_000
const FIXTURE_KEY_ID = 'fixture-key-v1'
const FIXTURE_KEY_MATERIAL = 'public-test-fixture-material-not-a-live-credential'
const OPERATOR: SocialActorV1 = { actorRef: 'operator:fixture', role: 'operator' }

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
    fixtureKeyId: FIXTURE_KEY_ID,
    fixtureKeyMaterial: FIXTURE_KEY_MATERIAL,
    ...overrides
  }
  if (provider === 'twitch') return createMockTwitchConnector(options)
  if (provider === 'youtube') return createMockYouTubeConnector(options)
  return createMockDiscordConnector(options)
}

function intent(
  provider: SocialProvider,
  capabilityId: SocialCapabilityId,
  payload: Readonly<Record<string, unknown>>,
  suffix = '1'
): SocialActionIntentV1 {
  const capability = socialCapabilityFor(provider, capabilityId)
  if (!capability) throw new Error(`Missing capability fixture ${provider}/${capabilityId}`)
  return {
    schema: SOCIAL_CONNECTOR_SCHEMA,
    contractVersion: SOCIAL_CONNECTOR_CONTRACT_VERSION,
    intentId: `intent:${provider}:${suffix}`,
    provider,
    capabilityId,
    destination: capability.destination,
    actor: OPERATOR,
    idempotencyKey: `idempotency:${provider}:${capabilityId}:${suffix}`,
    sourceProvider: provider,
    payload,
    enqueuedPolicy: { policyId: `queued:${provider}`, revision: 0 },
    consentEpoch: 1,
    createdAtMs: NOW - 1_000,
    deadlineMs: NOW + 60_000
  }
}

function approve(
  target: DeterministicMockSocialConnector,
  action: SocialActionIntentV1,
  suffix = action.intentId
): SocialActionIntentV1 {
  const requestId = `approval-request:${suffix}`
  target.approvalQueue.enqueue({
    schema: SOCIAL_APPROVAL_SCHEMA,
    contractVersion: SOCIAL_CONNECTOR_CONTRACT_VERSION,
    requestId,
    provider: action.provider,
    capabilityId: action.capabilityId,
    destination: action.destination,
    requestedBy: action.actor,
    reason: 'Deterministic conformance fixture',
    payloadHash: socialHash(action.payload),
    createdAtMs: NOW - 500,
    expiresAtMs: NOW + 30_000,
    oneShot: true,
    state: 'pending'
  })
  const receipt = target.approvalQueue.decide(
    requestId,
    'approved',
    OPERATOR,
    'Fixture approval',
    NOW - 100
  )
  return { ...action, approvalRef: receipt.approvalRef }
}

function webhook(
  provider: SocialProvider,
  capabilityId: SocialCapabilityId,
  eventId: string,
  deliveryId: string
) {
  return createSignedMockWebhookFixture(
    {
      provider,
      capabilityId,
      eventId,
      deliveryId,
      occurredAtMs: NOW - 500,
      body: JSON.stringify({ type: capabilityId, message: 'fixture payload' })
    },
    FIXTURE_KEY_ID,
    FIXTURE_KEY_MATERIAL
  )
}

describe('Wave E social connector contracts', () => {
  it('exposes versioned mock-only manifests without credential or network surfaces', () => {
    expect(SOCIAL_CONNECTOR_MANIFESTS.map((manifest) => manifest.provider)).toEqual([
      'twitch',
      'youtube',
      'discord'
    ])
    expect(
      Object.fromEntries(
        SOCIAL_CONNECTOR_MANIFESTS.map((manifest) => [
          manifest.provider,
          manifest.capabilities.map((capability) => capability.id)
        ])
      )
    ).toEqual({
      twitch: [
        'twitch.eventsub.ingest',
        'twitch.chat.read',
        'twitch.chat.write',
        'twitch.poll.manage',
        'twitch.moderation.manage',
        'twitch.marker.create',
        'twitch.clip.create'
      ],
      youtube: [
        'youtube.broadcast.manage',
        'youtube.health.read',
        'youtube.chat.read',
        'youtube.chat.write',
        'youtube.poll.manage'
      ],
      discord: [
        'discord.command.receive',
        'discord.response.ephemeral',
        'discord.room.create',
        'discord.room.close'
      ]
    })
    for (const manifest of SOCIAL_CONNECTOR_MANIFESTS) {
      expect(manifest.contractVersion).toBe('1.0.0')
      expect(manifest.adapterKind).toBe('mock-conformance')
      expect(manifest.transport).toBe('none')
      expect(manifest.networkAccess).toBe(false)
      expect(manifest.credentialInput).toBe('forbidden')
      expect(manifest.platformCertificationClaim).toBe('none')
    }
  })

  it('contains no network client path in the deterministic adapter', () => {
    const source = readFileSync(new URL('./mock-adapter.ts', import.meta.url), 'utf8')

    expect(source).not.toMatch(/from ['"]node:(?:http|https|net|tls|dgram)['"]/)
    expect(source).not.toMatch(/\bfetch\s*\(/)
    expect(source).not.toMatch(/\bWebSocket\s*\(/)
  })

  it('fails closed for unsupported capabilities', () => {
    const target = connector('twitch')
    const unsupported = {
      ...intent('twitch', 'twitch.marker.create', { marker: 'lap 4' }),
      capabilityId: 'twitch.subscription.create' as SocialCapabilityId
    }

    const result = target.execute(unsupported, OPERATOR)

    expect(result.outcome).toBe('denied')
    expect(result.reasonCode).toBe('capability.unsupported')
  })

  it('blocks merged-chat output to the Twitch destination even with an approval', () => {
    const target = connector('twitch')
    const action = approve(target, {
      ...intent('twitch', 'twitch.chat.write', { message: 'hello from merged inbox' }),
      sourceProvider: 'youtube'
    })

    const result = target.execute(action, OPERATOR)

    expect(result.outcome).toBe('denied')
    expect(result.reasonCode).toBe('policy.twitch_merged_chat_blocked')
  })
})

describe('social connector authorization and delivery gates', () => {
  it('denies an action after a required scope is revoked', () => {
    const target = connector('twitch')
    const capability = socialCapabilityFor('twitch', 'twitch.marker.create')
    expect(capability).toBeDefined()
    target.setScopeState(capability!.requiredScopes[0], 'revoked')
    const action = approve(
      target,
      intent('twitch', 'twitch.marker.create', { description: 'incident marker' })
    )

    const result = target.execute(action, OPERATOR)

    expect(result.reasonCode).toBe('scope.revoked')
    expect(result.receipt.scopeStates[capability!.requiredScopes[0]]).toBe('revoked')
    expect(target.getStatus().quota.remaining).toBe(100)
  })

  it('denies exhausted quota before consuming a one-shot approval', () => {
    const target = connector('youtube')
    target.setQuota({
      state: 'exhausted',
      limit: 100,
      remaining: 0,
      resetAtMs: NOW + 60_000
    })
    const action = approve(
      target,
      intent('youtube', 'youtube.broadcast.manage', { transition: 'fixture-start' })
    )

    const result = target.execute(action, OPERATOR)

    expect(result.reasonCode).toBe('quota.exhausted')
    expect(target.approvalQueue.getReceipt(action.approvalRef!)?.state).toBe('approved')
  })

  it('denies current delivery when the destination policy is stale', () => {
    const target = connector('twitch')
    target.setPolicy(
      createMockDestinationPolicy('twitch', NOW, {
        validFromMs: NOW - 60_000,
        validUntilMs: NOW - 1
      })
    )
    const action = approve(
      target,
      intent('twitch', 'twitch.poll.manage', { title: 'Fixture poll', options: ['A', 'B'] })
    )

    const result = target.execute(action, OPERATOR)

    expect(result.reasonCode).toBe('policy.stale')
    expect(target.getStatus().policyState).toBe('stale')
  })

  it('blocks Discord room role leakage outside the current role policy', () => {
    const target = connector('discord')
    const action = approve(
      target,
      intent('discord', 'discord.room.create', {
        roomName: 'race-control',
        allowedRoleIds: ['driver', 'everyone']
      })
    )

    const result = target.execute(action, OPERATOR)

    expect(result.reasonCode).toBe('policy.role_leak')
    expect(target.approvalQueue.getReceipt(action.approvalRef!)?.state).toBe('approved')
  })

  it('requires ephemeral responses to remain actor-scoped', () => {
    const target = connector('discord')
    const action = approve(
      target,
      intent('discord', 'discord.response.ephemeral', {
        recipientActorRef: 'actor:someone-else',
        message: 'private fixture response'
      })
    )

    expect(target.execute(action, OPERATOR).reasonCode).toBe('policy.role_leak')
  })

  it('returns the prior simulated result for a duplicate idempotency key without double quota use', () => {
    const target = connector('twitch')
    const action = approve(
      target,
      intent('twitch', 'twitch.marker.create', { description: 'lap 9 incident' })
    )

    const first = target.execute(action, OPERATOR)
    const second = target.execute(action, OPERATOR)

    expect(first.outcome).toBe('simulated')
    expect(second.outcome).toBe(first.outcome)
    expect(second.reasonCode).toBe(first.reasonCode)
    expect(second.receipt).toEqual(first.receipt)
    expect(second.duplicate).toBe(true)
    expect(second.mockProviderRef).toBe(first.mockProviderRef)
    expect(target.getStatus().quota.remaining).toBe(99)
  })

  it('enforces deterministic per-capability rate limits', () => {
    const target = connector('youtube')
    for (let index = 0; index < 4; index += 1) {
      const action = approve(
        target,
        intent(
          'youtube',
          'youtube.poll.manage',
          { title: `Fixture poll ${index}`, options: ['A', 'B'] },
          String(index)
        ),
        `poll-${index}`
      )
      expect(target.execute(action, OPERATOR).outcome).toBe('simulated')
    }
    const blocked = approve(
      target,
      intent(
        'youtube',
        'youtube.poll.manage',
        { title: 'Fixture poll blocked', options: ['A', 'B'] },
        'rate-blocked'
      ),
      'poll-rate-blocked'
    )

    const result = target.execute(blocked, OPERATOR)
    expect(result.reasonCode).toBe('rate_limit.exceeded')
    expect(result.retryAfterMs).toBe(60_000)
  })

  it('fails a required review that is no longer approved', () => {
    const target = connector('youtube')
    target.setReviewState('youtube.chat.write', 'pending')
    const action = approve(
      target,
      intent('youtube', 'youtube.chat.write', { message: 'fixture response' })
    )

    expect(target.execute(action, OPERATOR).reasonCode).toBe('review.pending')
  })

  it('revalidates consent epoch and revocation immediately before the simulated action', () => {
    const target = connector('twitch')
    target.setConsent('revoked', 2, NOW + 60_000)
    const action = approve(
      target,
      intent('twitch', 'twitch.marker.create', { description: 'revoked consent fixture' })
    )

    expect(target.execute(action, OPERATOR).reasonCode).toBe('consent.revoked')
  })

  it('honors the operator fail-closed override', () => {
    const target = connector('youtube')
    target.setOperatorControl('blocked')
    const action = approve(
      target,
      intent('youtube', 'youtube.chat.write', { message: 'blocked fixture response' })
    )

    expect(target.execute(action, OPERATOR).reasonCode).toBe('operator_override.blocked')
  })
})

describe('webhook fixture verification and deduplication', () => {
  it('accepts a signed fixture and preserves its provider-specific payload and label', () => {
    const target = connector('youtube')
    const fixture = webhook('youtube', 'youtube.health.read', 'event-1', 'delivery-1')

    const result = target.ingestFixture(fixture)

    expect(result.outcome).toBe('accepted')
    expect(result.event?.sourceLabel).toBe('youtube')
    expect(result.event?.providerPayload).toEqual({
      type: 'youtube.health.read',
      message: 'fixture payload'
    })
  })

  it('deduplicates the same provider event delivered under a new signed delivery', () => {
    const target = connector('twitch')
    const first = webhook('twitch', 'twitch.eventsub.ingest', 'event-duplicate', 'delivery-a')
    const second = webhook('twitch', 'twitch.eventsub.ingest', 'event-duplicate', 'delivery-b')

    expect(target.ingestFixture(first).outcome).toBe('accepted')
    const duplicate = target.ingestFixture(second)

    expect(duplicate.outcome).toBe('duplicate')
    expect(duplicate.reasonCode).toBe('event.duplicate')
  })

  it('rejects replay of the same signed delivery before event dedupe', () => {
    const target = connector('discord')
    const fixture = webhook('discord', 'discord.command.receive', 'command-1', 'delivery-replay')

    expect(target.ingestFixture(fixture).outcome).toBe('accepted')
    const replay = target.ingestFixture(fixture)

    expect(replay.outcome).toBe('replay')
    expect(replay.reasonCode).toBe('webhook.replay')
  })

  it('rejects an invalid fixture signature', () => {
    const target = connector('twitch')
    const fixture = {
      ...webhook('twitch', 'twitch.chat.read', 'chat-1', 'delivery-invalid'),
      signature: 'sha256=invalid'
    }

    expect(target.ingestFixture(fixture).reasonCode).toBe('webhook.invalid_signature')
  })
})

describe('approval and audit containment', () => {
  it('consumes an approval exactly once for the simulated side effect', () => {
    const queue = new DeterministicSocialApprovalQueue()
    const target = createMockTwitchConnector({
      referenceTimeMs: NOW,
      fixtureKeyId: FIXTURE_KEY_ID,
      fixtureKeyMaterial: FIXTURE_KEY_MATERIAL,
      approvalQueue: queue
    })
    const first = approve(
      target,
      intent('twitch', 'twitch.clip.create', { incidentRef: 'incident:42' })
    )
    const second = {
      ...intent('twitch', 'twitch.clip.create', { incidentRef: 'incident:42' }, 'second'),
      approvalRef: first.approvalRef
    }

    expect(target.execute(first, OPERATOR).outcome).toBe('simulated')
    expect(target.execute(second, OPERATOR).reasonCode).toBe('approval.consumed')
  })

  it('never serializes credential-bearing payload material into audit receipts', () => {
    const target = connector('twitch')
    const sentinel = 'Bearer live-looking-sentinel-value'
    const action = intent('twitch', 'twitch.chat.write', {
      message: 'fixture',
      oauthToken: sentinel
    })

    const result = target.execute(action, OPERATOR)
    const serialized = target.serializeAuditReceipts()

    expect(result.reasonCode).toBe('payload.credential_material')
    expect(serialized).not.toContain(sentinel)
    expect(serialized).not.toContain('oauthToken')
    expect(serialized).not.toContain('fixtureKeyMaterial')
    expect(serialized).toContain('payload.credential_material')
  })
})
