import {
  SOCIAL_AUDIT_SCHEMA,
  SOCIAL_CONNECTOR_CONTRACT_VERSION,
  SOCIAL_CONNECTOR_SCHEMA,
  SOCIAL_POLICY_SCHEMA,
  createMockConnectorStatus,
  socialCapabilityFor,
  socialManifestFor,
  type MockWebhookFixtureV1,
  type SocialActionIntentV1,
  type SocialActionResultV1,
  type SocialActorV1,
  type SocialApprovalQueueV1,
  type SocialAuditDecision,
  type SocialAuditReceiptV1,
  type SocialCapabilityId,
  type SocialCapabilityV1,
  type SocialConnectorStatusV1,
  type SocialConnectorV1,
  type SocialConsentState,
  type SocialDestinationPolicyV1,
  type SocialEntitlementState,
  type SocialInboundEventV1,
  type SocialInboundResultV1,
  type SocialProvider,
  type SocialQuotaSnapshotV1,
  type SocialRateLimitV1,
  type SocialReviewState,
  type SocialScopeState,
  type SocialOperatorControlState
} from '../../shared/social-connectors'
import { DeterministicSocialApprovalQueue } from './approval-queue'
import { FixedSocialClock, type SocialClockV1 } from './clock'
import { verifyMockWebhookFixtureSignature } from './fixture-signature'
import {
  assertNoCredentialMaterial,
  cloneSocialValue,
  serializePublicSocialRecord,
  socialHash,
  stableSocialJson
} from './security'
import {
  assertFiniteNumber,
  assertFiniteTimestamp,
  assertNonEmptyString,
  assertNonNegativeFinite,
  assertPositiveFinite,
  assertPositiveInteger,
  assertSocialActor,
  sameSocialActor
} from './validation'

const DAY_MS = 24 * 60 * 60 * 1000

type MutableStatus = Omit<
  SocialConnectorStatusV1,
  | 'lifecycle'
  | 'scopes'
  | 'entitlements'
  | 'reviews'
  | 'quota'
  | 'consent'
  | 'operatorControl'
  | 'policyState'
> & {
  lifecycle: SocialConnectorStatusV1['lifecycle']
  scopes: Record<string, SocialScopeState>
  entitlements: Record<string, SocialEntitlementState>
  reviews: Partial<Record<SocialCapabilityId, SocialReviewState>>
  consent: {
    state: SocialConsentState
    epoch: number
    expiresAtMs: number
  }
  operatorControl: SocialOperatorControlState
  policyState: SocialConnectorStatusV1['policyState']
  quota: {
    state: SocialQuotaSnapshotV1['state']
    limit: number
    remaining: number
    resetAtMs: number
  }
}

interface RateWindow {
  startedAtMs: number
  used: number
}

interface StoredAction {
  readonly requestFingerprint: string
  readonly result: SocialActionResultV1
}

interface StoredWebhookDelivery {
  readonly receiptId: string
  readonly expiresAtMs: number
}

interface StoredEvent {
  readonly event: SocialInboundEventV1
  readonly receiptId: string
  readonly expiresAtMs: number
}

export interface MockSocialConnectorStorageLimits {
  readonly maxWebhookDeliveries: number
  readonly maxEvents: number
  readonly maxAuditReceipts: number
  readonly eventRetentionMs: number
  readonly auditRetentionMs: number
}

export interface MockSocialConnectorStorageStats {
  readonly webhookDeliveries: number
  readonly events: number
  readonly auditReceipts: number
}

const DEFAULT_STORAGE_LIMITS: MockSocialConnectorStorageLimits = {
  maxWebhookDeliveries: 1_024,
  maxEvents: 1_024,
  maxAuditReceipts: 2_048,
  eventRetentionMs: 60 * 60 * 1000,
  auditRetentionMs: DAY_MS
}

export interface MockSocialConnectorOptions {
  readonly provider: SocialProvider
  readonly referenceTimeMs: number
  readonly clock?: SocialClockV1
  readonly fixtureKeyId: string
  readonly fixtureKeyMaterial: string
  readonly policy?: SocialDestinationPolicyV1 | null
  readonly status?: SocialConnectorStatusV1
  readonly approvalQueue?: SocialApprovalQueueV1
  readonly rateLimitOverrides?: Readonly<Partial<Record<SocialCapabilityId, SocialRateLimitV1>>>
  readonly storageLimits?: Partial<MockSocialConnectorStorageLimits>
}

interface ReceiptInput {
  readonly operation: 'ingress' | 'egress'
  readonly capabilityId: SocialCapabilityId
  readonly destination?: SocialAuditReceiptV1['destination']
  readonly decision: SocialAuditDecision
  readonly reasonCode: string
  readonly atMs: number
  readonly actorRole?: SocialAuditReceiptV1['actorRole']
  readonly actorRefHash?: string
  readonly eventIdHash?: string
  readonly deliveryIdHash?: string
  readonly idempotencyKeyHash?: string
  readonly requestFingerprint?: string
  readonly payloadHash?: string
  readonly policy?: SocialAuditReceiptV1['policy']
  readonly scopeStates?: Readonly<Record<string, SocialScopeState>>
  readonly entitlementState?: SocialEntitlementState
  readonly reviewState?: SocialReviewState
  readonly consentState?: SocialConsentState
  readonly consentEpoch?: number
  readonly operatorControl?: SocialOperatorControlState
  readonly quotaBefore?: number
  readonly quotaAfter?: number
  readonly approvalRef?: string
  readonly mockProviderRef?: string
  readonly replayedReceiptId?: string
  readonly retryAfterMs?: number
}

const DEFAULT_POLICY_ROLES: Readonly<Record<SocialProvider, readonly SocialDestinationPolicyV1['allowedActorRoles'][number][]>> = {
  twitch: ['operator', 'broadcaster', 'creator', 'moderator'],
  youtube: ['operator', 'broadcaster', 'creator'],
  discord: ['operator', 'team-manager', 'steward', 'engineer']
}

const PROVIDER_DESTINATION: Readonly<Record<SocialProvider, SocialDestinationPolicyV1['destination']>> = {
  twitch: 'twitch.channel',
  youtube: 'youtube.broadcast',
  discord: 'discord.guild'
}

function validateRateLimit(rateLimit: SocialRateLimitV1, label: string): void {
  assertPositiveInteger(rateLimit.maxRequests, `${label}.maxRequests`)
  assertPositiveFinite(rateLimit.windowMs, `${label}.windowMs`)
  assertNonNegativeFinite(rateLimit.quotaCost, `${label}.quotaCost`)
}

function validateStorageLimits(limits: MockSocialConnectorStorageLimits): void {
  assertPositiveInteger(limits.maxWebhookDeliveries, 'storage.maxWebhookDeliveries')
  assertPositiveInteger(limits.maxEvents, 'storage.maxEvents')
  assertPositiveInteger(limits.maxAuditReceipts, 'storage.maxAuditReceipts')
  assertPositiveFinite(limits.eventRetentionMs, 'storage.eventRetentionMs')
  assertPositiveFinite(limits.auditRetentionMs, 'storage.auditRetentionMs')
}

function validateStatus(status: SocialConnectorStatusV1): void {
  assertFiniteTimestamp(status.updatedAtMs, 'status.updatedAtMs')
  assertNonNegativeFinite(status.quota.limit, 'status.quota.limit')
  assertNonNegativeFinite(status.quota.remaining, 'status.quota.remaining')
  assertFiniteTimestamp(status.quota.resetAtMs, 'status.quota.resetAtMs')
  assertFiniteNumber(status.consent.epoch, 'status.consent.epoch')
  assertFiniteTimestamp(status.consent.expiresAtMs, 'status.consent.expiresAtMs')
  if (status.quota.remaining > status.quota.limit) {
    throw new Error('status.quota.remaining cannot exceed status.quota.limit')
  }
}

function validateDestinationPolicy(
  policy: SocialDestinationPolicyV1,
  expectedProvider?: SocialProvider
): void {
  if (
    policy.schema !== SOCIAL_POLICY_SCHEMA ||
    policy.contractVersion !== SOCIAL_CONNECTOR_CONTRACT_VERSION
  ) {
    throw new Error('Invalid social destination policy contract')
  }
  assertFiniteNumber(policy.revision, 'policy.revision')
  assertFiniteTimestamp(policy.validFromMs, 'policy.validFromMs')
  assertFiniteTimestamp(policy.validUntilMs, 'policy.validUntilMs')
  assertPositiveFinite(policy.maxPayloadBytes, 'policy.maxPayloadBytes')
  if (policy.validUntilMs <= policy.validFromMs) {
    throw new Error('policy.validUntilMs must be after policy.validFromMs')
  }
  if (expectedProvider && policy.provider !== expectedProvider) {
    throw new Error(`Policy provider ${policy.provider} does not match ${expectedProvider}`)
  }
  if (policy.provider === 'twitch' && policy.twitchMergedChatOutput !== 'block') {
    throw new Error('Twitch policies must block merged-chat output')
  }
  if (policy.provider !== 'twitch' && policy.twitchMergedChatOutput !== 'not-applicable') {
    throw new Error('Merged-chat output policy is only applicable to Twitch')
  }
}

function finiteExpiry(baseMs: number, durationMs: number, label: string): number {
  const expiresAtMs = baseMs + durationMs
  assertFiniteTimestamp(expiresAtMs, label)
  return expiresAtMs
}

export function createMockDestinationPolicy(
  provider: SocialProvider,
  referenceTimeMs: number,
  overrides: Partial<SocialDestinationPolicyV1> = {}
): SocialDestinationPolicyV1 {
  assertFiniteTimestamp(referenceTimeMs, 'policy.referenceTimeMs')
  const manifest = socialManifestFor(provider)
  const policyBase = {
    schema: SOCIAL_POLICY_SCHEMA,
    contractVersion: SOCIAL_CONNECTOR_CONTRACT_VERSION,
    policyId: `mock-policy.${provider}.v1`,
    revision: 1,
    provider,
    destination: PROVIDER_DESTINATION[provider],
    validFromMs: referenceTimeMs - DAY_MS,
    validUntilMs: referenceTimeMs + DAY_MS,
    allowedCapabilities: manifest.capabilities.map((capability) => capability.id),
    allowedActorRoles: DEFAULT_POLICY_ROLES[provider],
    allowedSourceProviders: [provider],
    allowedRoomRoleIds:
      provider === 'discord' ? ['driver', 'pit-wall', 'steward', 'broadcast'] : [],
    maxPayloadBytes: 16 * 1024,
    twitchMergedChatOutput: provider === 'twitch' ? 'block' : 'not-applicable'
  } satisfies Omit<SocialDestinationPolicyV1, 'fingerprint'>
  const merged = { ...policyBase, ...overrides }

  const policy: SocialDestinationPolicyV1 = {
    ...merged,
    fingerprint:
      overrides.fingerprint ??
      socialHash({
        ...merged,
        fingerprint: undefined
      })
  }
  validateDestinationPolicy(policy, provider)
  return policy
}

function capabilityScopeStates(
  capability: SocialCapabilityV1 | undefined,
  status: MutableStatus
): Record<string, SocialScopeState> {
  return Object.fromEntries(
    (capability?.requiredScopes ?? []).map((scope) => [scope, status.scopes[scope] ?? 'missing'])
  )
}

function objectRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Readonly<Record<string, unknown>>
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) return null
  return [...new Set(value)]
}

export class DeterministicMockSocialConnector implements SocialConnectorV1 {
  readonly contractVersion = SOCIAL_CONNECTOR_CONTRACT_VERSION
  readonly manifest
  readonly #clock: SocialClockV1
  readonly #fixtureKeyId: string
  readonly #fixtureKeyMaterial: string
  readonly #approvalQueue: SocialApprovalQueueV1
  readonly #status: MutableStatus
  readonly #auditReceipts: SocialAuditReceiptV1[] = []
  readonly #events = new Map<string, StoredEvent>()
  readonly #webhookDeliveries = new Map<string, StoredWebhookDelivery>()
  readonly #actions = new Map<string, StoredAction>()
  readonly #rateWindows = new Map<SocialCapabilityId, RateWindow>()
  readonly #rateLimitOverrides: Readonly<Partial<Record<SocialCapabilityId, SocialRateLimitV1>>>
  readonly #storageLimits: MockSocialConnectorStorageLimits
  #policy: SocialDestinationPolicyV1 | null
  #auditSequence = 0
  #lastNowMs: number | null = null

  constructor(options: MockSocialConnectorOptions) {
    assertFiniteTimestamp(options.referenceTimeMs, 'connector.referenceTimeMs')
    assertNonEmptyString(options.fixtureKeyId, 'connector.fixtureKeyId')
    assertNonEmptyString(options.fixtureKeyMaterial, 'connector.fixtureKeyMaterial')
    this.manifest = socialManifestFor(options.provider)
    this.#clock = options.clock ?? new FixedSocialClock(options.referenceTimeMs)
    const authorityNowMs = this.#now()
    this.#fixtureKeyId = options.fixtureKeyId
    this.#fixtureKeyMaterial = options.fixtureKeyMaterial
    this.#approvalQueue = options.approvalQueue ?? new DeterministicSocialApprovalQueue()
    const policy =
      options.policy === undefined
        ? createMockDestinationPolicy(options.provider, authorityNowMs)
        : options.policy
    if (policy) validateDestinationPolicy(policy, options.provider)
    this.#policy = policy ? cloneSocialValue(policy) : null
    const sourceStatus =
      options.status ?? createMockConnectorStatus(options.provider, authorityNowMs)
    validateStatus(sourceStatus)
    this.#status = cloneSocialValue(sourceStatus) as MutableStatus
    this.#rateLimitOverrides = cloneSocialValue(options.rateLimitOverrides ?? {})
    for (const [capabilityId, rateLimit] of Object.entries(this.#rateLimitOverrides)) {
      if (rateLimit) validateRateLimit(rateLimit, `rateLimits.${capabilityId}`)
    }
    this.#storageLimits = {
      ...DEFAULT_STORAGE_LIMITS,
      ...(options.storageLimits ?? {})
    }
    validateStorageLimits(this.#storageLimits)
  }

  get approvalQueue(): SocialApprovalQueueV1 {
    return this.#approvalQueue
  }

  getStatus(): SocialConnectorStatusV1 {
    return cloneSocialValue(this.#status)
  }

  getStorageStats(): MockSocialConnectorStorageStats {
    this.#pruneStorage(this.#now())
    return {
      webhookDeliveries: this.#webhookDeliveries.size,
      events: this.#events.size,
      auditReceipts: this.#auditReceipts.length
    }
  }

  setScopeState(scope: string, state: SocialScopeState): void {
    this.#status.scopes[scope] = state
    this.#refreshLifecycle()
  }

  setEntitlementState(entitlementKey: string, state: SocialEntitlementState): void {
    this.#status.entitlements[entitlementKey] = state
    this.#refreshLifecycle()
  }

  setReviewState(capabilityId: SocialCapabilityId, state: SocialReviewState): void {
    this.#status.reviews[capabilityId] = state
    this.#refreshLifecycle()
  }

  setQuota(quota: SocialQuotaSnapshotV1): void {
    assertNonNegativeFinite(quota.limit, 'quota.limit')
    assertNonNegativeFinite(quota.remaining, 'quota.remaining')
    assertFiniteTimestamp(quota.resetAtMs, 'quota.resetAtMs')
    if (quota.remaining > quota.limit) throw new Error('quota.remaining cannot exceed quota.limit')
    this.#status.quota = cloneSocialValue(quota) as MutableStatus['quota']
    this.#refreshLifecycle()
  }

  setConsent(state: SocialConsentState, epoch: number, expiresAtMs: number): void {
    assertFiniteNumber(epoch, 'consent.epoch')
    assertFiniteTimestamp(expiresAtMs, 'consent.expiresAtMs')
    this.#status.consent = { state, epoch, expiresAtMs }
    this.#refreshLifecycle()
  }

  setOperatorControl(state: SocialOperatorControlState): void {
    this.#status.operatorControl = state
    this.#refreshLifecycle()
  }

  setPolicy(policy: SocialDestinationPolicyV1 | null): void {
    if (policy) validateDestinationPolicy(policy, this.manifest.provider)
    this.#policy = policy ? cloneSocialValue(policy) : null
    this.#status.policyState = policy ? 'current' : 'missing'
    this.#refreshLifecycle()
  }

  ingestFixture(fixture: MockWebhookFixtureV1): SocialInboundResultV1 {
    const nowMs = this.#now()
    this.#pruneStorage(nowMs)
    const capability = socialCapabilityFor(this.manifest.provider, fixture.capabilityId)
    const baseReceipt = {
      operation: 'ingress' as const,
      capabilityId: fixture.capabilityId,
      atMs: nowMs,
      eventIdHash: socialHash(fixture.eventId),
      deliveryIdHash: socialHash(fixture.deliveryId),
      payloadHash: socialHash(fixture.body),
      scopeStates: capabilityScopeStates(capability, this.#status)
    }

    if (!Number.isFinite(fixture.occurredAtMs)) {
      return this.#inboundDenied(baseReceipt, 'validation.non_finite_time')
    }
    if (
      fixture.provider !== this.manifest.provider ||
      !capability ||
      capability.direction !== 'ingress'
    ) {
      return this.#inboundDenied(baseReceipt, 'capability.unsupported')
    }
    if (Math.abs(nowMs - fixture.occurredAtMs) > this.manifest.webhookReplayWindowMs) {
      return this.#inboundDenied(baseReceipt, 'webhook.stale')
    }
    if (
      !verifyMockWebhookFixtureSignature(
        fixture,
        this.#fixtureKeyId,
        this.#fixtureKeyMaterial
      )
    ) {
      return this.#inboundDenied(baseReceipt, 'webhook.invalid_signature')
    }

    const deliveryKey = socialHash({
      provider: fixture.provider,
      deliveryId: fixture.deliveryId,
      signature: fixture.signature
    })
    const replayedDelivery = this.#webhookDeliveries.get(deliveryKey)
    if (replayedDelivery) {
      const receipt = this.#recordReceipt({
        ...baseReceipt,
        decision: 'replay',
        reasonCode: 'webhook.replay',
        replayedReceiptId: replayedDelivery.receiptId
      })
      return { outcome: 'replay', reasonCode: 'webhook.replay', receipt }
    }
    if (this.#webhookDeliveries.size >= this.#storageLimits.maxWebhookDeliveries) {
      return this.#inboundDenied(baseReceipt, 'storage.replay_capacity')
    }

    const accessFailure = this.#capabilityAccessFailure(capability)
    if (accessFailure) {
      const denied = this.#inboundDenied(baseReceipt, accessFailure)
      this.#storeWebhookDelivery(deliveryKey, denied.receipt.receiptId, nowMs)
      return denied
    }

    const rateLimit = this.#rateLimitFor(capability)
    const rateWindow = this.#rateWindow(capability.id, rateLimit, nowMs)
    if (rateWindow.used >= rateLimit.maxRequests) {
      const retryAfterMs = Math.max(
        0,
        rateWindow.startedAtMs + rateLimit.windowMs - nowMs
      )
      const denied = this.#inboundDenied(
        { ...baseReceipt, retryAfterMs },
        'rate_limit.exceeded'
      )
      this.#storeWebhookDelivery(deliveryKey, denied.receipt.receiptId, nowMs)
      return denied
    }
    rateWindow.used += 1

    let providerPayload: Readonly<Record<string, unknown>>
    try {
      const parsed = objectRecord(JSON.parse(fixture.body))
      if (!parsed) throw new Error('Webhook fixture body must be a JSON object')
      assertNoCredentialMaterial(parsed)
      providerPayload = cloneSocialValue(parsed)
    } catch {
      const denied = this.#inboundDenied(baseReceipt, 'webhook.invalid_payload')
      this.#storeWebhookDelivery(deliveryKey, denied.receipt.receiptId, nowMs)
      return denied
    }

    const eventKey = `${fixture.provider}:${fixture.eventId}`
    const existing = this.#events.get(eventKey)
    if (existing) {
      const receipt = this.#recordReceipt({
        ...baseReceipt,
        decision: 'duplicate',
        reasonCode: 'event.duplicate',
        replayedReceiptId: existing.receiptId
      })
      this.#storeWebhookDelivery(deliveryKey, receipt.receiptId, nowMs)
      return {
        outcome: 'duplicate',
        reasonCode: 'event.duplicate',
        event: cloneSocialValue(existing.event),
        receipt
      }
    }
    if (this.#events.size >= this.#storageLimits.maxEvents) {
      const denied = this.#inboundDenied(baseReceipt, 'storage.event_capacity')
      this.#storeWebhookDelivery(deliveryKey, denied.receipt.receiptId, nowMs)
      return denied
    }

    const event: SocialInboundEventV1 = {
      eventId: fixture.eventId,
      provider: fixture.provider,
      capabilityId: fixture.capabilityId,
      sourceLabel: fixture.provider,
      occurredAtMs: fixture.occurredAtMs,
      receivedAtMs: nowMs,
      providerPayload,
      providerPayloadHash: socialHash(providerPayload)
    }
    const receipt = this.#recordReceipt({
      ...baseReceipt,
      decision: 'accepted',
      reasonCode: 'fixture.accepted'
    })
    this.#storeEvent(eventKey, event, receipt.receiptId, nowMs)
    this.#storeWebhookDelivery(deliveryKey, receipt.receiptId, nowMs)
    return {
      outcome: 'accepted',
      reasonCode: 'fixture.accepted',
      event: cloneSocialValue(event),
      receipt
    }
  }

  execute(
    intent: SocialActionIntentV1,
    authenticatedActor: SocialActorV1
  ): SocialActionResultV1 {
    const nowMs = this.#now()
    this.#pruneStorage(nowMs)
    const capability = socialCapabilityFor(this.manifest.provider, intent.capabilityId)
    const payloadHash = socialHash(intent.payload)
    const idempotencyKeyHash = socialHash(intent.idempotencyKey)
    const baseReceipt = {
      operation: 'egress' as const,
      capabilityId: intent.capabilityId,
      destination: intent.destination,
      atMs: nowMs,
      actorRole:
        typeof (intent.actor as Partial<SocialActorV1> | undefined)?.role === 'string'
          ? intent.actor.role
          : undefined,
      actorRefHash:
        typeof (intent.actor as Partial<SocialActorV1> | undefined)?.actorRef === 'string'
          ? socialHash(intent.actor.actorRef)
          : undefined,
      idempotencyKeyHash,
      payloadHash,
      scopeStates: capabilityScopeStates(capability, this.#status)
    }

    if (
      !Number.isFinite(intent.createdAtMs) ||
      !Number.isFinite(intent.deadlineMs) ||
      !Number.isFinite(intent.consentEpoch)
    ) {
      return this.#actionDenied(baseReceipt, 'validation.non_finite_time')
    }
    if (
      intent.schema !== SOCIAL_CONNECTOR_SCHEMA ||
      intent.contractVersion !== SOCIAL_CONNECTOR_CONTRACT_VERSION ||
      intent.provider !== this.manifest.provider ||
      !capability ||
      capability.direction !== 'egress' ||
      intent.destination !== capability.destination
    ) {
      return this.#actionDenied(baseReceipt, 'capability.unsupported')
    }

    try {
      assertSocialActor(intent.actor, 'intent.actor')
      assertSocialActor(authenticatedActor, 'authenticatedActor')
      assertNonEmptyString(intent.idempotencyKey, 'intent.idempotencyKey')
    } catch {
      return this.#actionDenied(baseReceipt, 'actor.invalid')
    }
    if (!sameSocialActor(intent.actor, authenticatedActor)) {
      return this.#actionDenied(baseReceipt, 'actor.authenticated_mismatch')
    }

    try {
      assertNoCredentialMaterial(intent.payload)
    } catch {
      return this.#actionDenied(baseReceipt, 'payload.credential_material')
    }
    const requestFingerprint = socialHash({
      schema: intent.schema,
      contractVersion: intent.contractVersion,
      intentId: intent.intentId,
      provider: intent.provider,
      capabilityId: intent.capabilityId,
      destination: intent.destination,
      actor: intent.actor,
      idempotencyKey: intent.idempotencyKey,
      sourceProvider: intent.sourceProvider ?? null,
      payloadHash,
      enqueuedPolicy: intent.enqueuedPolicy ?? null,
      consentEpoch: intent.consentEpoch,
      createdAtMs: intent.createdAtMs,
      deadlineMs: intent.deadlineMs
    })
    const fingerprintedReceipt = { ...baseReceipt, requestFingerprint }
    const actionKey = `${intent.provider}:${intent.idempotencyKey}`
    const existing = this.#actions.get(actionKey)
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        return this.#actionDenied(fingerprintedReceipt, 'idempotency.mismatch')
      }
      this.#recordReceipt({
        ...fingerprintedReceipt,
        decision: 'duplicate',
        reasonCode: 'idempotency.duplicate',
        replayedReceiptId: existing.result.receipt.receiptId,
        mockProviderRef: existing.result.mockProviderRef
      })
      return {
        ...cloneSocialValue(existing.result),
        duplicate: true
      }
    }

    if (nowMs > intent.deadlineMs || intent.deadlineMs <= intent.createdAtMs) {
      return this.#actionDenied(fingerprintedReceipt, 'intent.expired')
    }

    const policyFailure = this.#policyFailure(intent, capability, nowMs)
    if (policyFailure) return this.#actionDenied(fingerprintedReceipt, policyFailure)

    const accessFailure = this.#capabilityAccessFailure(capability)
    if (accessFailure) return this.#actionDenied(fingerprintedReceipt, accessFailure)
    const consentFailure = this.#consentFailure(intent, capability, nowMs)
    if (consentFailure) return this.#actionDenied(fingerprintedReceipt, consentFailure)
    if (this.#status.operatorControl !== 'enabled') {
      return this.#actionDenied(fingerprintedReceipt, 'operator_override.blocked')
    }

    const rateLimit = this.#rateLimitFor(capability)
    const quotaBefore = this.#refreshQuota(nowMs)
    if (this.#status.quota.state !== 'available' || quotaBefore < rateLimit.quotaCost) {
      return this.#actionDenied(
        { ...fingerprintedReceipt, quotaBefore, quotaAfter: quotaBefore },
        'quota.exhausted'
      )
    }

    const rateWindow = this.#rateWindow(capability.id, rateLimit, nowMs)
    if (rateWindow.used >= rateLimit.maxRequests) {
      return this.#actionDenied(
        {
          ...fingerprintedReceipt,
          quotaBefore,
          quotaAfter: quotaBefore,
          retryAfterMs: Math.max(
            0,
            rateWindow.startedAtMs + rateLimit.windowMs - nowMs
          )
        },
        'rate_limit.exceeded'
      )
    }

    let approvalRef: string | undefined
    if (capability.approval === 'required') {
      if (!intent.approvalRef) {
        return this.#actionDenied(
          { ...fingerprintedReceipt, quotaBefore, quotaAfter: quotaBefore },
          'approval.missing'
        )
      }
      const approval = this.#approvalQueue.consume({
        approvalRef: intent.approvalRef,
        provider: intent.provider,
        capabilityId: intent.capabilityId,
        destination: intent.destination,
        authenticatedActor,
        payloadHash,
        nowMs
      })
      if (!approval.allowed) {
        return this.#actionDenied(
          { ...fingerprintedReceipt, quotaBefore, quotaAfter: quotaBefore },
          approval.reasonCode
        )
      }
      approvalRef = approval.receipt?.approvalRef
    }

    rateWindow.used += 1
    this.#status.quota.remaining = Math.max(
      0,
      quotaBefore - rateLimit.quotaCost
    )
    this.#status.quota.state =
      this.#status.quota.remaining > 0 ? 'available' : 'exhausted'
    this.#refreshLifecycle()

    const mockProviderRef = `mock:${intent.provider}:${socialHash({
      requestFingerprint
    }).slice('sha256:'.length, 'sha256:'.length + 20)}`
    const receipt = this.#recordReceipt({
      ...fingerprintedReceipt,
      decision: 'simulated',
      reasonCode: 'mock.simulated',
      policy: this.#policy ?? undefined,
      entitlementState: this.#status.entitlements[capability.entitlementKey],
      reviewState: this.#status.reviews[capability.id],
      consentState: this.#status.consent.state,
      consentEpoch: this.#status.consent.epoch,
      operatorControl: this.#status.operatorControl,
      quotaBefore,
      quotaAfter: this.#status.quota.remaining,
      approvalRef,
      mockProviderRef
    })
    const result: SocialActionResultV1 = {
      outcome: 'simulated',
      reasonCode: 'mock.simulated',
      duplicate: false,
      mockProviderRef,
      receipt
    }
    this.#actions.set(actionKey, { requestFingerprint, result })
    return cloneSocialValue(result)
  }

  getAuditReceipts(): readonly SocialAuditReceiptV1[] {
    this.#pruneStorage(this.#now())
    return cloneSocialValue(this.#auditReceipts)
  }

  serializeAuditReceipts(): string {
    this.#pruneStorage(this.#now())
    return serializePublicSocialRecord(this.#auditReceipts)
  }

  #policyFailure(
    intent: SocialActionIntentV1,
    capability: SocialCapabilityV1,
    nowMs: number
  ): string | null {
    const policy = this.#policy
    if (!policy) {
      this.#status.policyState = 'missing'
      this.#refreshLifecycle()
      return 'policy.missing'
    }
    if (
      policy.schema !== SOCIAL_POLICY_SCHEMA ||
      policy.contractVersion !== SOCIAL_CONNECTOR_CONTRACT_VERSION ||
      (policy.provider === 'twitch' && policy.twitchMergedChatOutput !== 'block') ||
      nowMs < policy.validFromMs ||
      nowMs > policy.validUntilMs
    ) {
      this.#status.policyState = 'stale'
      this.#refreshLifecycle()
      return 'policy.stale'
    }
    this.#status.policyState = 'current'
    if (
      policy.provider !== intent.provider ||
      policy.destination !== intent.destination ||
      !policy.allowedCapabilities.includes(capability.id)
    ) {
      return 'policy.destination_denied'
    }
    if (!policy.allowedActorRoles.includes(intent.actor.role)) return 'policy.role_denied'
    if (Buffer.byteLength(stableSocialJson(intent.payload), 'utf8') > policy.maxPayloadBytes) {
      return 'policy.payload_too_large'
    }
    if (
      intent.provider === 'twitch' &&
      intent.capabilityId === 'twitch.chat.write' &&
      intent.sourceProvider !== 'twitch'
    ) {
      return 'policy.twitch_merged_chat_blocked'
    }
    if (
      intent.sourceProvider &&
      !policy.allowedSourceProviders.includes(intent.sourceProvider)
    ) {
      return 'policy.source_provider_denied'
    }
    if (intent.capabilityId === 'discord.room.create') {
      const allowedRoleIds = stringArray(intent.payload.allowedRoleIds)
      if (
        !allowedRoleIds ||
        allowedRoleIds.length === 0 ||
        allowedRoleIds.some((roleId) => !policy.allowedRoomRoleIds.includes(roleId))
      ) {
        return 'policy.role_leak'
      }
    }
    if (
      intent.capabilityId === 'discord.response.ephemeral' &&
      intent.payload.recipientActorRef !== intent.actor.actorRef
    ) {
      return 'policy.role_leak'
    }
    return null
  }

  #capabilityAccessFailure(capability: SocialCapabilityV1): string | null {
    for (const scope of capability.requiredScopes) {
      const state = this.#status.scopes[scope] ?? 'missing'
      if (state === 'revoked') return 'scope.revoked'
      if (state !== 'granted') return 'scope.missing'
    }
    const entitlement = this.#status.entitlements[capability.entitlementKey] ?? 'unknown'
    if (entitlement === 'ineligible') return 'entitlement.ineligible'
    if (entitlement !== 'eligible') return 'entitlement.unknown'
    const review = this.#status.reviews[capability.id] ?? 'unknown'
    if (capability.review === 'required' && review !== 'approved') {
      return `review.${review}`
    }
    return null
  }

  #consentFailure(
    intent: SocialActionIntentV1,
    capability: SocialCapabilityV1,
    nowMs: number
  ): string | null {
    if (capability.consent === 'never') return null
    if (
      this.#status.consent.state === 'granted' &&
      nowMs > this.#status.consent.expiresAtMs
    ) {
      this.#status.consent.state = 'expired'
      this.#refreshLifecycle()
    }
    if (this.#status.consent.state !== 'granted') {
      return `consent.${this.#status.consent.state}`
    }
    if (intent.consentEpoch !== this.#status.consent.epoch) return 'consent.epoch_mismatch'
    return null
  }

  #refreshQuota(nowMs: number): number {
    if (nowMs >= this.#status.quota.resetAtMs && this.#status.quota.limit >= 0) {
      this.#status.quota.remaining = this.#status.quota.limit
      this.#status.quota.state = this.#status.quota.limit > 0 ? 'available' : 'exhausted'
      this.#status.quota.resetAtMs = nowMs + 60 * 60 * 1000
    }
    return this.#status.quota.remaining
  }

  #rateLimitFor(capability: SocialCapabilityV1): SocialRateLimitV1 {
    return this.#rateLimitOverrides[capability.id] ?? capability.rateLimit
  }

  #rateWindow(
    capabilityId: SocialCapabilityId,
    rateLimit: SocialRateLimitV1,
    nowMs: number
  ): RateWindow {
    const existing = this.#rateWindows.get(capabilityId)
    if (!existing || nowMs >= existing.startedAtMs + rateLimit.windowMs) {
      const next = { startedAtMs: nowMs, used: 0 }
      this.#rateWindows.set(capabilityId, next)
      return next
    }
    return existing
  }

  #refreshLifecycle(): void {
    const blocked =
      this.#status.policyState !== 'current' ||
      this.#status.quota.state !== 'available' ||
      this.#status.consent.state !== 'granted' ||
      this.#status.operatorControl !== 'enabled' ||
      Object.values(this.#status.scopes).some((state) => state !== 'granted') ||
      Object.values(this.#status.entitlements).some((state) => state !== 'eligible') ||
      Object.entries(this.#status.reviews).some(([capabilityId, state]) => {
        const capability = socialCapabilityFor(
          this.manifest.provider,
          capabilityId as SocialCapabilityId
        )
        return capability?.review === 'required' && state !== 'approved'
      })
    this.#status.lifecycle = blocked ? 'blocked' : 'ready'
  }

  #inboundDenied(
    input: Omit<ReceiptInput, 'decision' | 'reasonCode'>,
    reasonCode: string
  ): SocialInboundResultV1 {
    const receipt = this.#recordReceipt({
      ...input,
      decision: 'denied',
      reasonCode
    })
    return { outcome: 'denied', reasonCode, retryAfterMs: input.retryAfterMs, receipt }
  }

  #actionDenied(
    input: Omit<ReceiptInput, 'decision' | 'reasonCode'>,
    reasonCode: string
  ): SocialActionResultV1 {
    const capability = socialCapabilityFor(this.manifest.provider, input.capabilityId)
    const receipt = this.#recordReceipt({
      ...input,
      decision: 'denied',
      reasonCode,
      policy: this.#policy ?? undefined,
      entitlementState: capability
        ? this.#status.entitlements[capability.entitlementKey]
        : undefined,
      reviewState: capability ? this.#status.reviews[capability.id] : undefined,
      consentState: this.#status.consent.state,
      consentEpoch: this.#status.consent.epoch,
      operatorControl: this.#status.operatorControl
    })
    return {
      outcome: 'denied',
      reasonCode,
      duplicate: false,
      retryAfterMs: input.retryAfterMs,
      receipt
    }
  }

  #recordReceipt(input: ReceiptInput): SocialAuditReceiptV1 {
    assertFiniteTimestamp(input.atMs, 'audit.atMs')
    this.#pruneStorage(input.atMs)
    this.#auditSequence += 1
    const receiptCore = {
      schema: SOCIAL_AUDIT_SCHEMA,
      contractVersion: SOCIAL_CONNECTOR_CONTRACT_VERSION,
      connectorId: this.manifest.connectorId,
      provider: this.manifest.provider,
      operation: input.operation,
      capabilityId: input.capabilityId,
      destination: input.destination,
      decision: input.decision,
      reasonCode: input.reasonCode,
      atMs: input.atMs,
      actorRole: input.actorRole,
      actorRefHash: input.actorRefHash,
      eventIdHash: input.eventIdHash,
      deliveryIdHash: input.deliveryIdHash,
      idempotencyKeyHash: input.idempotencyKeyHash,
      requestFingerprint: input.requestFingerprint,
      payloadHash: input.payloadHash,
      policy: input.policy
        ? {
            policyId: input.policy.policyId,
            revision: input.policy.revision,
            fingerprint: input.policy.fingerprint
          }
        : undefined,
      scopeStates: input.scopeStates ?? {},
      entitlementState: input.entitlementState,
      reviewState: input.reviewState,
      consentState: input.consentState,
      consentEpoch: input.consentEpoch,
      operatorControl: input.operatorControl,
      quotaBefore: input.quotaBefore,
      quotaAfter: input.quotaAfter,
      approvalRef: input.approvalRef,
      mockProviderRef: input.mockProviderRef,
      replayedReceiptId: input.replayedReceiptId,
      retryAfterMs: input.retryAfterMs
    } satisfies Omit<SocialAuditReceiptV1, 'receiptId'>
    const receipt: SocialAuditReceiptV1 = {
      ...receiptCore,
      receiptId: `audit:${socialHash({
        sequence: this.#auditSequence,
        receiptCore
      }).slice('sha256:'.length, 'sha256:'.length + 24)}`
    }
    this.#auditReceipts.push(receipt)
    if (this.#auditReceipts.length > this.#storageLimits.maxAuditReceipts) {
      this.#auditReceipts.splice(
        0,
        this.#auditReceipts.length - this.#storageLimits.maxAuditReceipts
      )
    }
    return cloneSocialValue(receipt)
  }

  #now(): number {
    const nowMs = this.#clock.nowMs()
    assertFiniteTimestamp(nowMs, 'clock.nowMs')
    if (this.#lastNowMs !== null && nowMs < this.#lastNowMs) {
      throw new Error('clock.nowMs must be monotonic')
    }
    this.#lastNowMs = nowMs
    return nowMs
  }

  #storeWebhookDelivery(key: string, receiptId: string, nowMs: number): void {
    if (
      !this.#webhookDeliveries.has(key) &&
      this.#webhookDeliveries.size >= this.#storageLimits.maxWebhookDeliveries
    ) {
      throw new Error('Webhook replay storage capacity exceeded')
    }
    this.#webhookDeliveries.set(key, {
      receiptId,
      expiresAtMs: finiteExpiry(
        nowMs,
        this.manifest.webhookReplayWindowMs,
        'webhook.expiresAtMs'
      )
    })
  }

  #storeEvent(
    key: string,
    event: SocialInboundEventV1,
    receiptId: string,
    nowMs: number
  ): void {
    if (!this.#events.has(key) && this.#events.size >= this.#storageLimits.maxEvents) {
      throw new Error('Event dedupe storage capacity exceeded')
    }
    this.#events.set(key, {
      event: cloneSocialValue(event),
      receiptId,
      expiresAtMs: finiteExpiry(nowMs, this.#storageLimits.eventRetentionMs, 'event.expiresAtMs')
    })
  }

  #pruneStorage(nowMs: number): void {
    for (const [key, delivery] of this.#webhookDeliveries) {
      if (delivery.expiresAtMs <= nowMs) this.#webhookDeliveries.delete(key)
    }
    for (const [key, event] of this.#events) {
      if (event.expiresAtMs <= nowMs) this.#events.delete(key)
    }
    for (let index = this.#auditReceipts.length - 1; index >= 0; index -= 1) {
      if (
        finiteExpiry(
          this.#auditReceipts[index].atMs,
          this.#storageLimits.auditRetentionMs,
          'audit.expiresAtMs'
        ) <= nowMs
      ) {
        this.#auditReceipts.splice(index, 1)
      }
    }
  }
}

export function createMockTwitchConnector(
  options: Omit<MockSocialConnectorOptions, 'provider'>
): DeterministicMockSocialConnector {
  return new DeterministicMockSocialConnector({ ...options, provider: 'twitch' })
}

export function createMockYouTubeConnector(
  options: Omit<MockSocialConnectorOptions, 'provider'>
): DeterministicMockSocialConnector {
  return new DeterministicMockSocialConnector({ ...options, provider: 'youtube' })
}

export function createMockDiscordConnector(
  options: Omit<MockSocialConnectorOptions, 'provider'>
): DeterministicMockSocialConnector {
  return new DeterministicMockSocialConnector({ ...options, provider: 'discord' })
}
