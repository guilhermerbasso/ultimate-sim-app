import { describe, expect, it } from 'vitest'
import {
  SOCIAL_CONNECTOR_CONTRACT_VERSION,
  SOCIAL_CONNECTOR_MANIFESTS,
  SOCIAL_CONNECTOR_SCHEMA,
  createMockConnectorStatus,
  socialCapabilityFor,
  type MockWebhookFixtureV1,
  type SocialActionIntentV1,
  type SocialActorV1,
  type SocialCapabilityId,
  type SocialProvider
} from '../../shared/social-connectors'
import { ManualSocialClock } from './clock'
import { createSignedMockWebhookFixture } from './fixture-signature'
import {
  createMockDestinationPolicy,
  createMockDiscordConnector,
  createMockTwitchConnector,
  createMockYouTubeConnector,
  type DeterministicMockSocialConnector,
  type MockSocialConnectorOptions
} from './mock-adapter'

const NOW = 1_800_000_000_000
const KEY_ID = 'fixture-key-v1'
const KEY_MATERIAL = 'public-test-fixture-material-not-a-live-credential'
const SENTINEL = 'credential-sentinel-must-not-escape'
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
    fixtureKeyId: KEY_ID,
    fixtureKeyMaterial: KEY_MATERIAL,
    ...overrides
  }
  if (provider === 'twitch') return createMockTwitchConnector(options)
  if (provider === 'youtube') return createMockYouTubeConnector(options)
  return createMockDiscordConnector(options)
}

function action(
  provider: SocialProvider,
  capabilityId: SocialCapabilityId,
  payload: Readonly<Record<string, unknown>>,
  suffix: string
): SocialActionIntentV1 {
  const capability = socialCapabilityFor(provider, capabilityId)
  if (!capability) throw new Error(`Missing capability ${provider}/${capabilityId}`)
  return {
    schema: SOCIAL_CONNECTOR_SCHEMA,
    contractVersion: SOCIAL_CONNECTOR_CONTRACT_VERSION,
    intentId: `intent:${suffix}`,
    provider,
    capabilityId,
    destination: capability.destination,
    actor: OPERATOR,
    idempotencyKey: `idempotency:${suffix}`,
    sourceProvider: provider,
    payload,
    consentEpoch: 1,
    createdAtMs: NOW - 1_000,
    deadlineMs: NOW + 60_000
  }
}

function webhook(
  provider: SocialProvider,
  capabilityId: SocialCapabilityId,
  body: Readonly<Record<string, unknown>>,
  suffix: string
): MockWebhookFixtureV1 {
  return createSignedMockWebhookFixture(
    {
      provider,
      capabilityId,
      deliveryId: `delivery:${suffix}`,
      eventId: `event:${suffix}`,
      occurredAtMs: NOW,
      body: JSON.stringify(body)
    },
    KEY_ID,
    KEY_MATERIAL
  )
}

describe('capability-specific credential and payload policy', () => {
  it('documents a non-empty payload allowlist for every capability', () => {
    for (const manifest of SOCIAL_CONNECTOR_MANIFESTS) {
      for (const capability of manifest.capabilities) {
        expect(capability.payloadFields.length, capability.id).toBeGreaterThan(0)
        expect(new Set(capability.payloadFields.map((field) => field.name)).size).toBe(
          capability.payloadFields.length
        )
      }
    }
  })

  it.each([
    {
      provider: 'twitch',
      capabilityId: 'twitch.eventsub.ingest',
      body: { eventId: 'event:twitch', eventType: 'stream.online', source: 'twitch' }
    },
    {
      provider: 'youtube',
      capabilityId: 'youtube.health.read',
      body: { status: 'good', bitrateKbps: 6_000 }
    },
    {
      provider: 'discord',
      capabilityId: 'discord.command.receive',
      body: { commandName: 'race', arguments: ['start'] }
    }
  ] as const)(
    'accepts documented $provider ingress fields',
    ({ provider, capabilityId, body }) => {
      const target = connector(provider)
      expect(
        target.ingestFixture(webhook(provider, capabilityId, body, `${provider}-allowed-ingress`))
      ).toMatchObject({ outcome: 'accepted', reasonCode: 'fixture.accepted' })
    }
  )

  it.each([
    {
      provider: 'twitch',
      capabilityId: 'twitch.chat.write',
      payload: { message: 'safe Twitch response' }
    },
    {
      provider: 'youtube',
      capabilityId: 'youtube.chat.write',
      payload: { message: 'safe YouTube response' }
    },
    {
      provider: 'discord',
      capabilityId: 'discord.response.ephemeral',
      payload: { recipientActorRef: OPERATOR.actorRef, message: 'safe Discord response' }
    }
  ] as const)(
    'accepts documented $provider egress fields through the approval gate',
    ({ provider, capabilityId, payload }) => {
      const target = connector(provider)
      expect(
        target.execute(
          action(provider, capabilityId, payload, `${provider}-allowed-egress`),
          OPERATOR
        )
      ).toMatchObject({ outcome: 'denied', reasonCode: 'approval.missing' })
    }
  )

  it.each([
    'apiKey',
    'token',
    'secret',
    'botToken',
    'discord_token',
    'access-token',
    'refreshToken',
    'authToken',
    'bearer_token',
    'cookies',
    'sessionCookie',
    'session_id',
    'sessionIdentifier',
    'password',
    'authorizationHeader'
  ])('rejects normalized nested credential key %s without leaking its value', (key) => {
    const target = connector('twitch')
    const result = target.execute(
      action(
        'twitch',
        'twitch.marker.create',
        { marker: 'safe fixture', nested: [{ [key]: SENTINEL }] },
        `credential-${key}`
      ),
      OPERATOR
    )

    expect(result).toMatchObject({
      outcome: 'denied',
      reasonCode: 'payload.credential_material',
      receipt: { decision: 'denied' }
    })
    expect(target.serializeAuditReceipts()).not.toContain(SENTINEL)
    expect(target.serializeAuditReceipts()).not.toContain(key)
  })

  it.each([
    {
      provider: 'twitch',
      capabilityId: 'twitch.chat.write',
      payload: { message: 'safe', metadata: { bearerToken: SENTINEL } }
    },
    {
      provider: 'youtube',
      capabilityId: 'youtube.chat.write',
      payload: { message: 'safe', auth: { accessToken: SENTINEL } }
    },
    {
      provider: 'discord',
      capabilityId: 'discord.response.ephemeral',
      payload: {
        recipientActorRef: OPERATOR.actorRef,
        message: 'safe',
        context: { discordToken: SENTINEL }
      }
    }
  ] as const)(
    'rejects nested $provider egress credentials before approval or allowlist evaluation',
    ({ provider, capabilityId, payload }) => {
      const target = connector(provider)
      const result = target.execute(
        action(provider, capabilityId, payload, `${provider}-egress-credential`),
        OPERATOR
      )

      expect(result).toMatchObject({
        outcome: 'denied',
        reasonCode: 'payload.credential_material'
      })
      expect(target.serializeAuditReceipts()).not.toContain(SENTINEL)
    }
  )

  it.each([
    {
      provider: 'twitch',
      capabilityId: 'twitch.eventsub.ingest',
      body: {
        eventId: 'event:twitch',
        source: 'twitch',
        metadata: { authorization: SENTINEL }
      }
    },
    {
      provider: 'youtube',
      capabilityId: 'youtube.health.read',
      body: { status: 'good', metadata: { sessionCookie: SENTINEL } }
    },
    {
      provider: 'discord',
      capabilityId: 'discord.command.receive',
      body: { commandName: 'race', context: { botToken: SENTINEL } }
    }
  ] as const)(
    'rejects nested $provider ingress credentials without audit leakage',
    ({ provider, capabilityId, body }) => {
      const target = connector(provider)
      const result = target.ingestFixture(
        webhook(provider, capabilityId, body, `${provider}-ingress-credential`)
      )

      expect(result).toMatchObject({
        outcome: 'denied',
        reasonCode: 'webhook.invalid_payload',
        receipt: { decision: 'denied' }
      })
      expect(target.serializeAuditReceipts()).not.toContain(SENTINEL)
    }
  )

  it('rejects benign but undocumented ingress and egress payload fields', () => {
    const twitch = connector('twitch')
    const egress = twitch.execute(
      action(
        'twitch',
        'twitch.chat.write',
        { message: 'safe', undocumentedTrackingId: 'fixture-only' },
        'undocumented-egress'
      ),
      OPERATOR
    )
    expect(egress).toMatchObject({
      outcome: 'denied',
      reasonCode: 'payload.field_not_allowed'
    })

    const youtube = connector('youtube')
    const ingress = youtube.ingestFixture(
      webhook(
        'youtube',
        'youtube.health.read',
        { status: 'good', undocumentedTrackingId: 'fixture-only' },
        'undocumented-ingress'
      )
    )
    expect(ingress).toMatchObject({
      outcome: 'denied',
      reasonCode: 'webhook.invalid_payload'
    })
  })

  it('rejects documented fields with the wrong runtime type', () => {
    const twitch = connector('twitch')
    expect(
      twitch.execute(
        action(
          'twitch',
          'twitch.chat.write',
          { message: 42 },
          'invalid-egress-field-type'
        ),
        OPERATOR
      )
    ).toMatchObject({ outcome: 'denied', reasonCode: 'payload.invalid_field' })

    const youtube = connector('youtube')
    expect(
      youtube.ingestFixture(
        webhook(
          'youtube',
          'youtube.health.read',
          { status: ['not', 'a', 'string'] },
          'invalid-ingress-field-type'
        )
      )
    ).toMatchObject({ outcome: 'denied', reasonCode: 'webhook.invalid_payload' })
  })
})

describe('malformed untrusted adapter inputs', () => {
  it.each([
    ['body', { body: { nested: SENTINEL } }],
    ['eventId', { eventId: 42 }],
    ['deliveryId', { deliveryId: null }]
  ] as const)('denies a non-string fixture %s within the audit contract', (_label, patch) => {
    const target = connector('twitch')
    const valid = webhook(
      'twitch',
      'twitch.eventsub.ingest',
      { eventId: 'safe', source: 'twitch' },
      `malformed-${_label}`
    )
    const result = target.ingestFixture({
      ...valid,
      ...patch
    } as unknown as MockWebhookFixtureV1)

    expect(result).toMatchObject({
      outcome: 'denied',
      reasonCode: 'validation.malformed_fixture',
      receipt: {
        operation: 'ingress',
        decision: 'denied',
        reasonCode: 'validation.malformed_fixture'
      }
    })
    expect(target.serializeAuditReceipts()).not.toContain(SENTINEL)
  })

  it('denies a circular action payload without throwing or leaking input content', () => {
    const target = connector('twitch')
    const circular: Record<string, unknown> = { marker: SENTINEL }
    circular.self = circular

    const result = target.execute(
      {
        ...action('twitch', 'twitch.marker.create', { marker: 'safe' }, 'circular'),
        payload: circular
      },
      OPERATOR
    )

    expect(result).toMatchObject({
      outcome: 'denied',
      reasonCode: 'validation.malformed_payload',
      duplicate: false,
      receipt: {
        operation: 'egress',
        decision: 'denied',
        reasonCode: 'validation.malformed_payload'
      }
    })
    expect(target.serializeAuditReceipts()).not.toContain(SENTINEL)
  })

  it('denies accessor and function payloads without evaluating or serializing them', () => {
    const target = connector('twitch')
    const accessorPayload = Object.defineProperty({}, 'marker', {
      enumerable: true,
      get(): never {
        throw new Error(SENTINEL)
      }
    })
    const accessorResult = target.execute(
      {
        ...action('twitch', 'twitch.marker.create', { marker: 'safe' }, 'accessor'),
        payload: accessorPayload
      },
      OPERATOR
    )
    const functionResult = target.execute(
      {
        ...action('twitch', 'twitch.marker.create', { marker: 'safe' }, 'function'),
        payload: { marker: 'safe', callback: () => SENTINEL }
      },
      OPERATOR
    )

    expect(accessorResult.reasonCode).toBe('validation.malformed_payload')
    expect(functionResult.reasonCode).toBe('validation.malformed_payload')
    expect(target.serializeAuditReceipts()).not.toContain(SENTINEL)
  })

  it('rejects sparse non-serializable arrays without expanding their declared length', () => {
    const target = connector('twitch')
    const sparse = new Array(1_000_000)
    sparse[999_999] = 'fixture'

    expect(
      target.execute(
        {
          ...action('twitch', 'twitch.marker.create', { marker: 'safe' }, 'sparse-array'),
          payload: { marker: 'safe', sparse }
        },
        OPERATOR
      )
    ).toMatchObject({ outcome: 'denied', reasonCode: 'validation.malformed_payload' })
  })

  it('rejects excessively deep payloads before recursive serialization', () => {
    const target = connector('twitch')
    let nested: Record<string, unknown> = { value: 'leaf' }
    for (let depth = 0; depth < 70; depth += 1) nested = { nested }

    expect(
      target.execute(
        {
          ...action('twitch', 'twitch.marker.create', { marker: 'safe' }, 'deep-payload'),
          payload: { marker: 'safe', nested }
        },
        OPERATOR
      )
    ).toMatchObject({ outcome: 'denied', reasonCode: 'validation.malformed_payload' })
  })

  it('denies malformed intent envelopes instead of throwing', () => {
    const target = connector('twitch')
    const nullResult = target.execute(null as unknown as SocialActionIntentV1, OPERATOR)
    const invalidIdempotency = target.execute(
      {
        ...action('twitch', 'twitch.marker.create', { marker: 'safe' }, 'bad-idempotency'),
        idempotencyKey: 42
      } as unknown as SocialActionIntentV1,
      OPERATOR
    )

    expect(nullResult).toMatchObject({
      outcome: 'denied',
      reasonCode: 'validation.malformed_intent',
      receipt: { decision: 'denied' }
    })
    expect(invalidIdempotency.reasonCode).toBe('validation.malformed_intent')
  })

  it('rejects undocumented credential-bearing envelope fields without leakage', () => {
    const twitch = connector('twitch')
    const intentResult = twitch.execute(
      {
        ...action('twitch', 'twitch.marker.create', { marker: 'safe' }, 'extra-intent-field'),
        botToken: SENTINEL
      } as unknown as SocialActionIntentV1,
      OPERATOR
    )
    expect(intentResult.reasonCode).toBe('validation.malformed_intent')

    const discord = connector('discord')
    const fixtureResult = discord.ingestFixture(
      {
        ...webhook(
          'discord',
          'discord.command.receive',
          { commandName: 'race' },
          'extra-fixture-field'
        ),
        sessionCookie: SENTINEL
      } as unknown as MockWebhookFixtureV1
    )
    expect(fixtureResult.reasonCode).toBe('validation.malformed_fixture')
    expect(twitch.serializeAuditReceipts()).not.toContain(SENTINEL)
    expect(discord.serializeAuditReceipts()).not.toContain(SENTINEL)
  })

  it('denies revoked proxy envelopes without invoking proxy traps outside validation', () => {
    const target = connector('twitch')
    const intentProxy = Proxy.revocable({}, {})
    const fixtureProxy = Proxy.revocable({}, {})
    intentProxy.revoke()
    fixtureProxy.revoke()

    expect(
      target.execute(intentProxy.proxy as unknown as SocialActionIntentV1, OPERATOR)
    ).toMatchObject({ outcome: 'denied', reasonCode: 'validation.malformed_intent' })
    expect(
      target.ingestFixture(fixtureProxy.proxy as unknown as MockWebhookFixtureV1)
    ).toMatchObject({ outcome: 'denied', reasonCode: 'validation.malformed_fixture' })
  })
})

describe('authority-clock status refresh', () => {
  it('refreshes consent, policy, quota, lifecycle and updatedAtMs before returning status', () => {
    const clock = new ManualSocialClock(NOW)
    const target = connector('twitch', { clock })
    const scope = socialCapabilityFor('twitch', 'twitch.marker.create')!.requiredScopes[0]
    target.setQuota({
      state: 'exhausted',
      limit: 7,
      remaining: 0,
      resetAtMs: NOW + 100
    })
    target.setConsent('granted', 2, NOW + 100)
    target.setPolicy(
      createMockDestinationPolicy('twitch', NOW, {
        validFromMs: NOW - 100,
        validUntilMs: NOW + 100
      })
    )
    target.setScopeState(scope, 'revoked')

    clock.advanceBy(101)
    const status = target.getStatus()

    expect(status.updatedAtMs).toBe(NOW + 101)
    expect(status.consent).toMatchObject({ state: 'expired', epoch: 2 })
    expect(status.policyState).toBe('stale')
    expect(status.quota).toMatchObject({ state: 'available', limit: 7, remaining: 7 })
    expect(status.scopes[scope]).toBe('revoked')
    expect(status.lifecycle).toBe('blocked')
  })
})

describe('monotonic consent epochs', () => {
  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid consent epoch %s',
    (epoch) => {
      const target = connector('twitch')
      expect(() => target.setConsent('revoked', epoch, NOW + 60_000)).toThrow(
        /non-negative safe integer/
      )
    }
  )

  it('rejects an invalid consent epoch supplied in initial status', () => {
    const status = createMockConnectorStatus('twitch', NOW)
    expect(() =>
      createMockTwitchConnector({
        referenceTimeMs: NOW,
        fixtureKeyId: KEY_ID,
        fixtureKeyMaterial: KEY_MATERIAL,
        status: {
          ...status,
          consent: { ...status.consent, epoch: -1 }
        }
      })
    ).toThrow(/non-negative safe integer/)
  })

  it('allows exact same-epoch idempotency and rejects conflicts or rollback', () => {
    const target = connector('twitch')
    const revokedExpiry = NOW + 60_000
    target.setConsent('revoked', 3, revokedExpiry)

    expect(() => target.setConsent('revoked', 3, revokedExpiry)).not.toThrow()
    expect(() => target.setConsent('granted', 3, revokedExpiry)).toThrow(/epoch conflict/)
    expect(() => target.setConsent('revoked', 3, revokedExpiry + 1)).toThrow(/epoch conflict/)
    expect(() => target.setConsent('granted', 2, NOW + 120_000)).toThrow(/stale consent epoch/)
    expect(target.getStatus().consent).toEqual({
      state: 'revoked',
      epoch: 3,
      expiresAtMs: revokedExpiry
    })

    target.setConsent('granted', 4, NOW + 120_000)
    expect(target.getStatus().consent).toMatchObject({ state: 'granted', epoch: 4 })
  })

  it('keeps an expired grant expired when its exact authority transition is replayed', () => {
    const clock = new ManualSocialClock(NOW)
    const target = connector('twitch', { clock })
    target.setConsent('granted', 2, NOW + 10)
    clock.advanceBy(10)
    expect(target.getStatus().consent.state).toBe('expired')

    expect(() => target.setConsent('granted', 2, NOW + 10)).not.toThrow()
    expect(target.getStatus().consent).toMatchObject({ state: 'expired', epoch: 2 })
  })

  it.each([-1, 1.5])('denies action consent epoch %s within the result contract', (epoch) => {
    const target = connector('twitch')
    const result = target.execute(
      {
        ...action('twitch', 'twitch.marker.create', { marker: 'safe' }, `intent-epoch-${epoch}`),
        consentEpoch: epoch
      },
      OPERATOR
    )

    expect(result).toMatchObject({
      outcome: 'denied',
      reasonCode: 'validation.invalid_consent_epoch',
      receipt: { decision: 'denied' }
    })
  })
})
