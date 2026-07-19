import { describe, expect, it } from 'vitest'
import type { MockWebhookFixtureV1 } from '../../shared/social-connectors'
import {
  createSignedMockWebhookFixture,
  verifyMockWebhookFixtureSignature
} from './fixture-signature'

const NOW = 1_800_000_000_000
const KEY_ID = 'fixture-key-v1'
const KEY_MATERIAL = 'public-test-fixture-material-not-a-live-credential'

describe('mock webhook signature framing', () => {
  it('uses unambiguous length-prefixed fields so newline substitution cannot reuse a signature', () => {
    const first = createSignedMockWebhookFixture(
      {
        provider: 'twitch',
        capabilityId: 'twitch.eventsub.ingest',
        deliveryId: 'alpha\nbeta',
        eventId: 'gamma',
        occurredAtMs: NOW,
        body: '{"value":"fixture"}'
      },
      KEY_ID,
      KEY_MATERIAL
    )
    const substituted = createSignedMockWebhookFixture(
      {
        provider: 'twitch',
        capabilityId: 'twitch.eventsub.ingest',
        deliveryId: 'alpha',
        eventId: 'beta\ngamma',
        occurredAtMs: NOW,
        body: '{"value":"fixture"}'
      },
      KEY_ID,
      KEY_MATERIAL
    )

    expect(first.signature).not.toBe(substituted.signature)
    expect(
      verifyMockWebhookFixtureSignature(
        { ...substituted, signature: first.signature },
        KEY_ID,
        KEY_MATERIAL
      )
    ).toBe(false)
  })

  it('rejects non-finite fixture timestamps at signing and verification boundaries', () => {
    expect(() =>
      createSignedMockWebhookFixture(
        {
          provider: 'discord',
          capabilityId: 'discord.command.receive',
          deliveryId: 'delivery',
          eventId: 'event',
          occurredAtMs: Number.NaN,
          body: '{}'
        },
        KEY_ID,
        KEY_MATERIAL
      )
    ).toThrow(/finite/)

    const valid = createSignedMockWebhookFixture(
      {
        provider: 'discord',
        capabilityId: 'discord.command.receive',
        deliveryId: 'delivery',
        eventId: 'event',
        occurredAtMs: NOW,
        body: '{}'
      },
      KEY_ID,
      KEY_MATERIAL
    )
    const nonFinite = {
      ...valid,
      occurredAtMs: Number.POSITIVE_INFINITY
    } as MockWebhookFixtureV1

    expect(verifyMockWebhookFixtureSignature(nonFinite, KEY_ID, KEY_MATERIAL)).toBe(false)
  })

  it('rejects oversized attacker-controlled signatures before allocating their buffer', () => {
    const fixture = createSignedMockWebhookFixture(
      {
        provider: 'twitch',
        capabilityId: 'twitch.eventsub.ingest',
        deliveryId: 'delivery:oversized-signature',
        eventId: 'event:oversized-signature',
        occurredAtMs: NOW,
        body: JSON.stringify({ eventId: 'event:oversized-signature', source: 'twitch' })
      },
      KEY_ID,
      KEY_MATERIAL
    )

    expect(
      verifyMockWebhookFixtureSignature(
        { ...fixture, signature: 'x'.repeat(1_000_000) },
        KEY_ID,
        KEY_MATERIAL
      )
    ).toBe(false)
  })
})
