import { describe, expect, it } from 'vitest'
import {
  SOCIAL_APPROVAL_SCHEMA,
  SOCIAL_CONNECTOR_CONTRACT_VERSION,
  SOCIAL_CONNECTOR_MANIFESTS,
  SOCIAL_CONNECTOR_SCHEMA,
  buildMockCapabilityMatrix,
  createMockConnectorStatus,
  socialCapabilityFor,
  type MockWebhookFixtureV1,
  type SocialActionIntentV1,
  type SocialActorV1,
  type SocialCapabilityId,
  type SocialConnectorStatusV1,
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
import { findCredentialMaterial, socialHash, stableSocialJson } from './security'

const NOW = 1_800_000_000_000
const KEY_ID = 'fixture-key-v1'
const KEY_MATERIAL = 'public-test-fixture-material-not-a-live-credential'
const SENTINEL = 'credential-sentinel-must-not-escape'
const OPERATOR: SocialActorV1 = { actorRef: 'operator:fixture', role: 'operator' }
const TWITCH_OAUTH = `oauth:${'a'.repeat(30)}`
const GOOGLE_API_KEY = `AIza${'A'.repeat(35)}`
const GOOGLE_OAUTH = `ya29.${'B'.repeat(40)}`
const DISCORD_BOT_TOKEN = `${'C'.repeat(24)}.${'D'.repeat(6)}.${'E'.repeat(27)}`
const DISCORD_MFA_TOKEN = `mfa.${'F'.repeat(64)}`
const GENERIC_JWT = `eyJ${'G'.repeat(12)}.eyJ${'H'.repeat(12)}.${'I'.repeat(32)}`
const GENERIC_SESSION = `sessionid=${'J'.repeat(32)}`
const GENERIC_BEARER = `Bearer ${'K'.repeat(32)}`
const GENERIC_AUTH_HEADER = `Authorization: Bearer ${'L'.repeat(32)}`
const GENERIC_COOKIE_HEADER = `Cookie: theme=dark; sessionid=${'M'.repeat(32)}`
const GENERIC_PRIVATE_KEY =
  '-----BEGIN PRIVATE KEY-----\nQUJDREVGR0hJSktMTU5PUA==\n-----END PRIVATE KEY-----'

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
    reason: 'Credential-value regression fixture',
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
    'Approved credential-value fixture',
    NOW - 100
  )
  return { ...intent, approvalRef: receipt.approvalRef }
}

describe('bounded credential value scanner', () => {
  it.each([
    ['twitch', TWITCH_OAUTH],
    ['youtube', GOOGLE_API_KEY],
    ['youtube', GOOGLE_OAUTH],
    ['discord', DISCORD_BOT_TOKEN],
    ['discord', DISCORD_MFA_TOKEN],
    ['twitch', GENERIC_JWT],
    ['youtube', GENERIC_SESSION],
    ['discord', GENERIC_AUTH_HEADER],
    ['twitch', GENERIC_PRIVATE_KEY]
  ] as const)('detects %s credential-shaped string values', (provider, value) => {
    expect(findCredentialMaterial({ message: value }, { provider })).toBe('$.message')
  })

  it.each([
    'oauth:racefanswelcome',
    `AIza${'A'.repeat(34)}`,
    `${'C'.repeat(22)}.${'D'.repeat(6)}.${'E'.repeat(27)}`,
    'mfa.not-a-real-token',
    'eyJshort.eyJshort.signature',
    'Bearer welcome racers',
    'Cookie: chocolate=chip'
  ])('does not reject ordinary near-miss text %s', (value) => {
    expect(findCredentialMaterial({ message: value }, { provider: 'twitch' })).toBeNull()
  })

  it('bounds cycles, node counts and nested string-array scanning', () => {
    const circular: Record<string, unknown> = { message: 'safe' }
    circular.self = circular
    expect(findCredentialMaterial(circular)).toBe('$.self')
    expect(
      findCredentialMaterial(
        { values: ['safe', { nested: ['still safe', GENERIC_BEARER] }] },
        { provider: 'youtube' }
      )
    ).toBe('$.values[1].nested[1]')
    expect(
      findCredentialMaterial(
        { values: Array.from({ length: 20 }, (_, index) => `safe-${index}`) },
        { maxNodes: 5 }
      )
    ).not.toBeNull()
    expect(
      findCredentialMaterial({ message: 'x'.repeat(100) }, { maxStringLength: 32 })
    ).toBe('$.message')
  })

  it('rejects circular arrays with the controlled stable-serialization error', () => {
    const circular: unknown[] = []
    circular.push(circular)
    expect(() => stableSocialJson(circular)).toThrow(
      'Circular social connector values cannot be serialized'
    )
  })
})

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

describe('credential-shaped string value policy', () => {
  it.each([
    {
      provider: 'twitch',
      capabilityId: 'twitch.eventsub.ingest',
      body: { eventId: 'event:twitch', source: 'twitch', message: TWITCH_OAUTH },
      secret: TWITCH_OAUTH
    },
    {
      provider: 'youtube',
      capabilityId: 'youtube.health.read',
      body: { status: 'good', message: GOOGLE_API_KEY },
      secret: GOOGLE_API_KEY
    },
    {
      provider: 'youtube',
      capabilityId: 'youtube.chat.read',
      body: { messageId: 'message:youtube', message: GOOGLE_OAUTH },
      secret: GOOGLE_OAUTH
    },
    {
      provider: 'discord',
      capabilityId: 'discord.command.receive',
      body: { commandName: 'race', message: DISCORD_BOT_TOKEN },
      secret: DISCORD_BOT_TOKEN
    },
    {
      provider: 'discord',
      capabilityId: 'discord.command.receive',
      body: { commandName: 'race', arguments: ['safe', DISCORD_MFA_TOKEN] },
      secret: DISCORD_MFA_TOKEN
    }
  ] as const)(
    'rejects signed $provider ingress credential-shaped values',
    ({ provider, capabilityId, body, secret }) => {
      const target = connector(provider)
      const result = target.ingestFixture(
        webhook(provider, capabilityId, body, `${provider}-${capabilityId}-value`)
      )

      expect(result).toMatchObject({
        outcome: 'denied',
        reasonCode: 'webhook.invalid_payload',
        receipt: { decision: 'denied' }
      })
      expect(target.serializeAuditReceipts()).not.toContain(secret)
    }
  )

  it.each([
    {
      provider: 'twitch',
      capabilityId: 'twitch.chat.write',
      payload: { message: TWITCH_OAUTH },
      secret: TWITCH_OAUTH
    },
    {
      provider: 'youtube',
      capabilityId: 'youtube.chat.write',
      payload: { message: GOOGLE_API_KEY },
      secret: GOOGLE_API_KEY
    },
    {
      provider: 'youtube',
      capabilityId: 'youtube.chat.write',
      payload: { message: GOOGLE_OAUTH },
      secret: GOOGLE_OAUTH
    },
    {
      provider: 'discord',
      capabilityId: 'discord.response.ephemeral',
      payload: {
        recipientActorRef: OPERATOR.actorRef,
        message: DISCORD_BOT_TOKEN
      },
      secret: DISCORD_BOT_TOKEN
    },
    {
      provider: 'discord',
      capabilityId: 'discord.response.ephemeral',
      payload: {
        recipientActorRef: OPERATOR.actorRef,
        message: DISCORD_MFA_TOKEN
      },
      secret: DISCORD_MFA_TOKEN
    }
  ] as const)(
    'rejects approved $provider egress credential-shaped values',
    ({ provider, capabilityId, payload, secret }) => {
      const target = connector(provider)
      const approved = approve(
        target,
        action(provider, capabilityId, payload, `${provider}-${capabilityId}-approved-value`),
        `${provider}-${capabilityId}-approved-value`
      )
      const result = target.execute(approved, OPERATOR)

      expect(result).toMatchObject({
        outcome: 'denied',
        reasonCode: 'payload.credential_material',
        receipt: { decision: 'denied' }
      })
      expect(target.approvalQueue.getReceipt(approved.approvalRef!)?.state).toBe('approved')
      expect(target.serializeAuditReceipts()).not.toContain(secret)
    }
  )

  it.each([
    {
      provider: 'twitch',
      capabilityId: 'twitch.marker.create',
      payload: { description: GENERIC_JWT },
      secret: GENERIC_JWT
    },
    {
      provider: 'youtube',
      capabilityId: 'youtube.chat.write',
      payload: { message: GENERIC_BEARER },
      secret: GENERIC_BEARER
    },
    {
      provider: 'discord',
      capabilityId: 'discord.response.ephemeral',
      payload: {
        recipientActorRef: OPERATOR.actorRef,
        message: GENERIC_AUTH_HEADER
      },
      secret: GENERIC_AUTH_HEADER
    },
    {
      provider: 'twitch',
      capabilityId: 'twitch.poll.manage',
      payload: { title: 'Fixture poll', options: ['safe', GENERIC_PRIVATE_KEY] },
      secret: GENERIC_PRIVATE_KEY
    },
    {
      provider: 'youtube',
      capabilityId: 'youtube.chat.write',
      payload: { message: GENERIC_SESSION },
      secret: GENERIC_SESSION
    },
    {
      provider: 'discord',
      capabilityId: 'discord.response.ephemeral',
      payload: {
        recipientActorRef: OPERATOR.actorRef,
        message: GENERIC_COOKIE_HEADER
      },
      secret: GENERIC_COOKIE_HEADER
    }
  ] as const)(
    'rejects approved generic credential format for $provider',
    ({ provider, capabilityId, payload, secret }) => {
      const target = connector(provider)
      const approved = approve(
        target,
        action(provider, capabilityId, payload, `${provider}-generic-secret`),
        `${provider}-generic-secret`
      )

      expect(target.execute(approved, OPERATOR)).toMatchObject({
        outcome: 'denied',
        reasonCode: 'payload.credential_material'
      })
      expect(target.serializeAuditReceipts()).not.toContain(secret)
    }
  )

  it('scans generic credential values nested inside signed objects and arrays', () => {
    const twitch = connector('twitch')
    expect(
      twitch.ingestFixture(
        webhook(
          'twitch',
          'twitch.eventsub.ingest',
          {
            eventId: 'nested-jwt',
            source: 'twitch',
            metadata: { notes: [{ value: GENERIC_JWT }] }
          },
          'nested-jwt'
        )
      )
    ).toMatchObject({ outcome: 'denied', reasonCode: 'webhook.invalid_payload' })
    expect(twitch.serializeAuditReceipts()).not.toContain(GENERIC_JWT)

    const discord = connector('discord')
    expect(
      discord.ingestFixture(
        webhook(
          'discord',
          'discord.command.receive',
          {
            commandName: 'race',
            context: [{ values: ['safe', GENERIC_SESSION] }]
          },
          'nested-session'
        )
      )
    ).toMatchObject({ outcome: 'denied', reasonCode: 'webhook.invalid_payload' })
    expect(discord.serializeAuditReceipts()).not.toContain(GENERIC_SESSION)
  })

  it.each([
    {
      provider: 'twitch',
      capabilityId: 'twitch.chat.write',
      payload: { message: 'oauth:racefanswelcome' }
    },
    {
      provider: 'youtube',
      capabilityId: 'youtube.chat.write',
      payload: { message: `AIza${'A'.repeat(34)}` }
    },
    {
      provider: 'discord',
      capabilityId: 'discord.response.ephemeral',
      payload: {
        recipientActorRef: OPERATOR.actorRef,
        message: `${'C'.repeat(22)}.${'D'.repeat(6)}.${'E'.repeat(27)}`
      }
    },
    {
      provider: 'discord',
      capabilityId: 'discord.response.ephemeral',
      payload: {
        recipientActorRef: OPERATOR.actorRef,
        message: 'mfa.not-a-real-token'
      }
    },
    {
      provider: 'twitch',
      capabilityId: 'twitch.chat.write',
      payload: { message: 'eyJshort.eyJshort.signature' }
    },
    {
      provider: 'youtube',
      capabilityId: 'youtube.chat.write',
      payload: { message: 'Bearer welcome racers' }
    },
    {
      provider: 'discord',
      capabilityId: 'discord.response.ephemeral',
      payload: {
        recipientActorRef: OPERATOR.actorRef,
        message: 'Cookie: chocolate=chip'
      }
    }
  ] as const)(
    'allows ordinary near-miss $provider chat text',
    ({ provider, capabilityId, payload }) => {
      const target = connector(provider)
      const approved = approve(
        target,
        action(provider, capabilityId, payload, `${provider}-near-miss-${payload.message}`),
        `${provider}-near-miss-${payload.message}`
      )

      expect(target.execute(approved, OPERATOR)).toMatchObject({
        outcome: 'simulated',
        reasonCode: 'mock.simulated'
      })
    }
  )
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

  it('rejects oversized webhook bodies before signature verification or JSON parsing', () => {
    const target = connector('twitch')
    const valid = webhook(
      'twitch',
      'twitch.eventsub.ingest',
      { eventId: 'safe', source: 'twitch' },
      'oversized-body'
    )

    expect(
      target.ingestFixture({
        ...valid,
        body: 'x'.repeat(16 * 1024 + 1)
      })
    ).toMatchObject({
      outcome: 'denied',
      reasonCode: 'validation.malformed_fixture',
      receipt: { decision: 'denied' }
    })
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

  it('rejects oversized dense arrays and records before cloning their contents', () => {
    const target = connector('twitch')
    const oversizedArray = Array.from({ length: 4_097 }, () => 'fixture')
    const oversizedRecord = Object.fromEntries(
      Array.from({ length: 4_097 }, (_, index) => [`field${index}`, 'fixture'])
    )

    for (const oversized of [oversizedArray, oversizedRecord]) {
      expect(
        target.execute(
          {
            ...action('twitch', 'twitch.marker.create', { marker: 'safe' }, 'oversized-json'),
            payload: { marker: 'safe', oversized }
          },
          OPERATOR
        )
      ).toMatchObject({ outcome: 'denied', reasonCode: 'validation.malformed_payload' })
    }
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
  it.each([
    ['schema', { schema: 'invalid.social.status' }],
    ['contract version', { contractVersion: '999.0.0' }],
    ['connector id', { connectorId: 'mock.other.social.v1' }],
    ['provider', { provider: 'discord' }],
    ['mode', { mode: 'live' }],
    ['network access', { networkAccess: true }],
    ['credential configuration', { credentialsConfigured: true }]
  ] as const)('rejects injected status with invalid %s contract metadata', (_label, patch) => {
    const status = createMockConnectorStatus('twitch', NOW)
    expect(() =>
      createMockTwitchConnector({
        referenceTimeMs: NOW,
        fixtureKeyId: KEY_ID,
        fixtureKeyMaterial: KEY_MATERIAL,
        status: { ...status, ...patch } as unknown as SocialConnectorStatusV1
      })
    ).toThrow(/Invalid social connector status contract/)
  })

  it('rejects injected ready status missing required scope, entitlement or review keys', () => {
    const status = createMockConnectorStatus('twitch', NOW)
    const capability = socialCapabilityFor('twitch', 'twitch.marker.create')!
    const scope = capability.requiredScopes[0]
    const scopes = { ...status.scopes }
    const entitlements = { ...status.entitlements }
    const reviews = { ...status.reviews }
    delete scopes[scope]
    delete entitlements[capability.entitlementKey]
    delete reviews[capability.id]

    for (const patch of [{ scopes }, { entitlements }, { reviews }]) {
      expect(() =>
        createMockTwitchConnector({
          referenceTimeMs: NOW,
          fixtureKeyId: KEY_ID,
          fixtureKeyMaterial: KEY_MATERIAL,
          status: { ...status, ...patch }
        })
      ).toThrow(/Missing required status/)
    }
  })

  it('preserves revoked scope truth in the capability matrix', () => {
    const twitch = createMockConnectorStatus('twitch', NOW)
    const capability = socialCapabilityFor('twitch', 'twitch.marker.create')!
    const scope = capability.requiredScopes[0]
    const matrix = buildMockCapabilityMatrix([
      {
        ...twitch,
        scopes: { ...twitch.scopes, [scope]: 'revoked' as const }
      },
      createMockConnectorStatus('youtube', NOW),
      createMockConnectorStatus('discord', NOW)
    ])

    expect(
      matrix.find((row) => row.capabilityId === capability.id)?.scopeState
    ).toBe('revoked')
  })

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
