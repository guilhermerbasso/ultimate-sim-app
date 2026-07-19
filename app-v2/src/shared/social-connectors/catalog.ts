import {
  SOCIAL_CAPABILITY_SCHEMA,
  SOCIAL_CONNECTOR_CONTRACT_VERSION,
  SOCIAL_CONNECTOR_SCHEMA,
  type SocialCapabilityId,
  type SocialCapabilityMatrixRowV1,
  type SocialCapabilityPayloadFieldKind,
  type SocialCapabilityPayloadFieldV1,
  type SocialCapabilityV1,
  type SocialConnectorManifestV1,
  type SocialConnectorStatusV1,
  type SocialDestination,
  type SocialProvider,
  type SocialReviewState
} from './contracts'

const MINUTE_MS = 60_000
export const MOCK_SOCIAL_STATUS_TIME_MS = 1_800_000_000_000

interface CapabilityDefinition {
  readonly id: SocialCapabilityId
  readonly provider: SocialProvider
  readonly label: string
  readonly description: string
  readonly direction: SocialCapabilityV1['direction']
  readonly effect: SocialCapabilityV1['effect']
  readonly destination: SocialDestination
  readonly payloadFields: readonly SocialCapabilityPayloadFieldV1[]
  readonly scopes: readonly string[]
  readonly entitlementKey: string
  readonly approval: SocialCapabilityV1['approval']
  readonly review: SocialCapabilityV1['review']
  readonly maxRequests: number
  readonly quotaCost?: number
}

function payloadFields(
  ...entries: readonly (readonly [string, SocialCapabilityPayloadFieldKind])[]
): readonly SocialCapabilityPayloadFieldV1[] {
  return Object.freeze(
    entries.map(([name, kind]) => Object.freeze({ name, kind }))
  )
}

function capability(definition: CapabilityDefinition): SocialCapabilityV1 {
  return Object.freeze({
    schema: SOCIAL_CAPABILITY_SCHEMA,
    contractVersion: SOCIAL_CONNECTOR_CONTRACT_VERSION,
    id: definition.id,
    provider: definition.provider,
    label: definition.label,
    description: definition.description,
    direction: definition.direction,
    effect: definition.effect,
    destination: definition.destination,
    payloadFields: definition.payloadFields,
    requiredScopes: definition.scopes,
    entitlementKey: definition.entitlementKey,
    approval: definition.approval,
    consent: definition.direction === 'egress' ? 'required' : 'never',
    review: definition.review,
    rateLimit: {
      maxRequests: definition.maxRequests,
      windowMs: MINUTE_MS,
      quotaCost: definition.quotaCost ?? 1
    },
    supportedInMock: true
  })
}

export const SOCIAL_CAPABILITIES: readonly SocialCapabilityV1[] = Object.freeze([
  capability({
    id: 'twitch.eventsub.ingest',
    provider: 'twitch',
    label: 'EventSub fixture ingest',
    description: 'Verifies, deduplicates, labels and normalizes deterministic EventSub fixtures.',
    direction: 'ingress',
    effect: 'read',
    destination: 'twitch.channel',
    payloadFields: payloadFields(
      ['eventId', 'string'],
      ['source', 'string'],
      ['type', 'string'],
      ['message', 'string'],
      ['eventType', 'string'],
      ['broadcasterId', 'string']
    ),
    scopes: ['fixture:twitch:eventsub.read'],
    entitlementKey: 'fixture:twitch:channel',
    approval: 'never',
    review: 'not-required',
    maxRequests: 120,
    quotaCost: 0
  }),
  capability({
    id: 'twitch.chat.read',
    provider: 'twitch',
    label: 'Chat fixture ingest',
    description: 'Preserves provider payload and Twitch source labels for operator-only views.',
    direction: 'ingress',
    effect: 'read',
    destination: 'twitch.channel',
    payloadFields: payloadFields(
      ['eventId', 'string'],
      ['source', 'string'],
      ['type', 'string'],
      ['message', 'string'],
      ['messageId', 'string'],
      ['userId', 'string'],
      ['userDisplayName', 'string']
    ),
    scopes: ['fixture:twitch:chat.read'],
    entitlementKey: 'fixture:twitch:channel',
    approval: 'never',
    review: 'not-required',
    maxRequests: 120,
    quotaCost: 0
  }),
  capability({
    id: 'twitch.chat.write',
    provider: 'twitch',
    label: 'Chat output',
    description: 'Simulates approved Twitch-only chat output; merged cross-platform chat is blocked.',
    direction: 'egress',
    effect: 'write',
    destination: 'twitch.channel',
    payloadFields: payloadFields(['message', 'string'], ['replyToMessageId', 'string']),
    scopes: ['fixture:twitch:chat.write'],
    entitlementKey: 'fixture:twitch:channel',
    approval: 'required',
    review: 'required',
    maxRequests: 20
  }),
  capability({
    id: 'twitch.poll.manage',
    provider: 'twitch',
    label: 'Poll management',
    description: 'Simulates an approved, idempotent poll action.',
    direction: 'egress',
    effect: 'manage',
    destination: 'twitch.channel',
    payloadFields: payloadFields(
      ['title', 'string'],
      ['options', 'string-array'],
      ['durationSeconds', 'finite-number'],
      ['action', 'string'],
      ['pollId', 'string']
    ),
    scopes: ['fixture:twitch:poll.manage'],
    entitlementKey: 'fixture:twitch:polls',
    approval: 'required',
    review: 'required',
    maxRequests: 4,
    quotaCost: 2
  }),
  capability({
    id: 'twitch.moderation.manage',
    provider: 'twitch',
    label: 'Scoped moderation',
    description: 'Simulates a role- and approval-scoped moderation action.',
    direction: 'egress',
    effect: 'moderate',
    destination: 'twitch.channel',
    payloadFields: payloadFields(
      ['action', 'string'],
      ['targetUserId', 'string'],
      ['reason', 'string'],
      ['durationSeconds', 'finite-number']
    ),
    scopes: ['fixture:twitch:moderation.manage'],
    entitlementKey: 'fixture:twitch:moderation',
    approval: 'required',
    review: 'required',
    maxRequests: 10
  }),
  capability({
    id: 'twitch.marker.create',
    provider: 'twitch',
    label: 'Stream marker',
    description: 'Simulates an approved marker with idempotency and deadline enforcement.',
    direction: 'egress',
    effect: 'create',
    destination: 'twitch.channel',
    payloadFields: payloadFields(
      ['description', 'string'],
      ['marker', 'string'],
      ['positionSeconds', 'finite-number']
    ),
    scopes: ['fixture:twitch:marker.create'],
    entitlementKey: 'fixture:twitch:markers',
    approval: 'required',
    review: 'required',
    maxRequests: 10
  }),
  capability({
    id: 'twitch.clip.create',
    provider: 'twitch',
    label: 'Clip request',
    description: 'Simulates an approved clip request without moving or encoding media.',
    direction: 'egress',
    effect: 'create',
    destination: 'twitch.channel',
    payloadFields: payloadFields(['incidentRef', 'string'], ['title', 'string']),
    scopes: ['fixture:twitch:clip.create'],
    entitlementKey: 'fixture:twitch:clips',
    approval: 'required',
    review: 'required',
    maxRequests: 6,
    quotaCost: 2
  }),
  capability({
    id: 'youtube.broadcast.manage',
    provider: 'youtube',
    label: 'Broadcast management',
    description: 'Simulates approved broadcast lifecycle intents without a transport.',
    direction: 'egress',
    effect: 'manage',
    destination: 'youtube.broadcast',
    payloadFields: payloadFields(
      ['transition', 'string'],
      ['broadcastId', 'string'],
      ['title', 'string'],
      ['privacyStatus', 'string']
    ),
    scopes: ['fixture:youtube:broadcast.manage'],
    entitlementKey: 'fixture:youtube:broadcast',
    approval: 'required',
    review: 'required',
    maxRequests: 8,
    quotaCost: 5
  }),
  capability({
    id: 'youtube.health.read',
    provider: 'youtube',
    label: 'Stream health ingest',
    description: 'Verifies and normalizes deterministic health fixtures without causal claims.',
    direction: 'ingress',
    effect: 'read',
    destination: 'youtube.broadcast',
    payloadFields: payloadFields(
      ['eventId', 'string'],
      ['source', 'string'],
      ['type', 'string'],
      ['message', 'string'],
      ['status', 'string'],
      ['bitrateKbps', 'finite-number'],
      ['droppedFrames', 'finite-number']
    ),
    scopes: ['fixture:youtube:health.read'],
    entitlementKey: 'fixture:youtube:broadcast',
    approval: 'never',
    review: 'not-required',
    maxRequests: 120,
    quotaCost: 0
  }),
  capability({
    id: 'youtube.chat.read',
    provider: 'youtube',
    label: 'Live chat ingest',
    description: 'Preserves provider payload and source labels for operator-only views.',
    direction: 'ingress',
    effect: 'read',
    destination: 'youtube.broadcast',
    payloadFields: payloadFields(
      ['eventId', 'string'],
      ['source', 'string'],
      ['type', 'string'],
      ['message', 'string'],
      ['messageId', 'string'],
      ['channelId', 'string'],
      ['authorDisplayName', 'string']
    ),
    scopes: ['fixture:youtube:chat.read'],
    entitlementKey: 'fixture:youtube:broadcast',
    approval: 'never',
    review: 'not-required',
    maxRequests: 120,
    quotaCost: 0
  }),
  capability({
    id: 'youtube.chat.write',
    provider: 'youtube',
    label: 'Live chat output',
    description: 'Simulates an approved, provider-specific chat response.',
    direction: 'egress',
    effect: 'write',
    destination: 'youtube.broadcast',
    payloadFields: payloadFields(['message', 'string'], ['replyToMessageId', 'string']),
    scopes: ['fixture:youtube:chat.write'],
    entitlementKey: 'fixture:youtube:broadcast',
    approval: 'required',
    review: 'required',
    maxRequests: 20
  }),
  capability({
    id: 'youtube.poll.manage',
    provider: 'youtube',
    label: 'Poll management',
    description: 'Simulates an approved poll action under fixture quota.',
    direction: 'egress',
    effect: 'manage',
    destination: 'youtube.broadcast',
    payloadFields: payloadFields(
      ['title', 'string'],
      ['options', 'string-array'],
      ['durationSeconds', 'finite-number'],
      ['action', 'string'],
      ['pollId', 'string']
    ),
    scopes: ['fixture:youtube:poll.manage'],
    entitlementKey: 'fixture:youtube:polls',
    approval: 'required',
    review: 'required',
    maxRequests: 4,
    quotaCost: 5
  }),
  capability({
    id: 'discord.command.receive',
    provider: 'discord',
    label: 'Command fixture ingest',
    description: 'Verifies replay-safe command fixtures and preserves Discord source labels.',
    direction: 'ingress',
    effect: 'read',
    destination: 'discord.guild',
    payloadFields: payloadFields(
      ['eventId', 'string'],
      ['source', 'string'],
      ['type', 'string'],
      ['message', 'string'],
      ['commandName', 'string'],
      ['interactionId', 'string'],
      ['guildId', 'string'],
      ['channelId', 'string'],
      ['actorRef', 'string'],
      ['arguments', 'string-array']
    ),
    scopes: ['fixture:discord:command.receive'],
    entitlementKey: 'fixture:discord:guild',
    approval: 'never',
    review: 'not-required',
    maxRequests: 120,
    quotaCost: 0
  }),
  capability({
    id: 'discord.response.ephemeral',
    provider: 'discord',
    label: 'Ephemeral response',
    description: 'Simulates an actor-scoped ephemeral response without broad room disclosure.',
    direction: 'egress',
    effect: 'write',
    destination: 'discord.guild',
    payloadFields: payloadFields(
      ['recipientActorRef', 'string'],
      ['message', 'string'],
      ['interactionId', 'string']
    ),
    scopes: ['fixture:discord:response.ephemeral'],
    entitlementKey: 'fixture:discord:guild',
    approval: 'required',
    review: 'required',
    maxRequests: 30
  }),
  capability({
    id: 'discord.room.create',
    provider: 'discord',
    label: 'Role-scoped room creation',
    description: 'Simulates approved room creation only for policy-allowlisted role IDs.',
    direction: 'egress',
    effect: 'create',
    destination: 'discord.guild',
    payloadFields: payloadFields(
      ['roomName', 'string'],
      ['allowedRoleIds', 'string-array'],
      ['topic', 'string']
    ),
    scopes: ['fixture:discord:room.create'],
    entitlementKey: 'fixture:discord:rooms',
    approval: 'required',
    review: 'required',
    maxRequests: 4,
    quotaCost: 3
  }),
  capability({
    id: 'discord.room.close',
    provider: 'discord',
    label: 'Role-scoped room close',
    description: 'Simulates approved cleanup of a previously scoped race room.',
    direction: 'egress',
    effect: 'manage',
    destination: 'discord.guild',
    payloadFields: payloadFields(['roomId', 'string'], ['reason', 'string']),
    scopes: ['fixture:discord:room.close'],
    entitlementKey: 'fixture:discord:rooms',
    approval: 'required',
    review: 'required',
    maxRequests: 8
  })
])

const PROVIDER_NAMES: Readonly<Record<SocialProvider, string>> = {
  twitch: 'Twitch',
  youtube: 'YouTube',
  discord: 'Discord'
}

export const SOCIAL_CONNECTOR_MANIFESTS: readonly SocialConnectorManifestV1[] = Object.freeze(
  (['twitch', 'youtube', 'discord'] as const).map((provider) =>
    Object.freeze({
      schema: SOCIAL_CONNECTOR_SCHEMA,
      contractVersion: SOCIAL_CONNECTOR_CONTRACT_VERSION,
      connectorId: `mock.${provider}.social.v1`,
      provider,
      displayName: `${PROVIDER_NAMES[provider]} mock conformance`,
      adapterKind: 'mock-conformance',
      transport: 'none',
      networkAccess: false,
      credentialInput: 'forbidden',
      platformCertificationClaim: 'none',
      capabilities: Object.freeze(
        SOCIAL_CAPABILITIES.filter((entry) => entry.provider === provider)
      ),
      webhookReplayWindowMs: 5 * MINUTE_MS
    })
  )
)

export function socialManifestFor(provider: SocialProvider): SocialConnectorManifestV1 {
  const manifest = SOCIAL_CONNECTOR_MANIFESTS.find((entry) => entry.provider === provider)
  if (!manifest) throw new Error(`Missing social connector manifest for ${provider}`)
  return manifest
}

export function socialCapabilityFor(
  provider: SocialProvider,
  capabilityId: SocialCapabilityId
): SocialCapabilityV1 | undefined {
  return SOCIAL_CAPABILITIES.find(
    (capability) => capability.provider === provider && capability.id === capabilityId
  )
}

export function createMockConnectorStatus(
  provider: SocialProvider,
  updatedAtMs = MOCK_SOCIAL_STATUS_TIME_MS
): SocialConnectorStatusV1 {
  if (!Number.isFinite(updatedAtMs)) throw new Error('status.updatedAtMs must be finite')
  const manifest = socialManifestFor(provider)
  const scopes = Object.fromEntries(
    manifest.capabilities.flatMap((capability) =>
      capability.requiredScopes.map((scope) => [scope, 'granted' as const])
    )
  )
  const entitlements = Object.fromEntries(
    manifest.capabilities.map((capability) => [capability.entitlementKey, 'eligible' as const])
  )
  const reviews = Object.fromEntries(
    manifest.capabilities.map((capability) => [
      capability.id,
      capability.review === 'required' ? 'approved' : 'not-required'
    ])
  ) as Partial<Record<SocialCapabilityId, SocialReviewState>>

  return {
    schema: SOCIAL_CONNECTOR_SCHEMA,
    contractVersion: SOCIAL_CONNECTOR_CONTRACT_VERSION,
    connectorId: manifest.connectorId,
    provider,
    mode: 'mock-conformance',
    lifecycle: 'ready',
    scopes,
    entitlements,
    reviews,
    quota: {
      state: 'available',
      limit: 100,
      remaining: 100,
      resetAtMs: updatedAtMs + 60 * MINUTE_MS
    },
    consent: {
      state: 'granted',
      epoch: 1,
      expiresAtMs: updatedAtMs + 24 * 60 * MINUTE_MS
    },
    operatorControl: 'enabled',
    policyState: 'current',
    networkAccess: false,
    credentialsConfigured: false,
    updatedAtMs
  }
}

export const MOCK_SOCIAL_CONNECTOR_STATUSES: readonly SocialConnectorStatusV1[] = (
  ['twitch', 'youtube', 'discord'] as const
).map((provider) => createMockConnectorStatus(provider))

export function buildMockCapabilityMatrix(): readonly SocialCapabilityMatrixRowV1[] {
  return SOCIAL_CAPABILITIES.map((capability) => {
    const status = MOCK_SOCIAL_CONNECTOR_STATUSES.find(
      (entry) => entry.provider === capability.provider
    )
    if (!status) throw new Error(`Missing mock connector status for ${capability.provider}`)
    const scopeState = capability.requiredScopes.some((scope) => status.scopes[scope] !== 'granted')
      ? 'missing'
      : 'granted'

    return {
      provider: capability.provider,
      connectorId: status.connectorId,
      capabilityId: capability.id,
      label: capability.label,
      direction: capability.direction,
      destination: capability.destination,
      scopeState,
      entitlementState: status.entitlements[capability.entitlementKey] ?? 'unknown',
      quotaState: status.quota.state,
      reviewState: status.reviews[capability.id] ?? 'unknown',
      approval: capability.approval,
      consentState: status.consent.state,
      operatorControl: status.operatorControl,
      policyState: status.policyState,
      mode: 'mock-conformance'
    }
  })
}
