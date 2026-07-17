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
  type SocialReviewState,
  type SocialScopeState,
  type SocialOperatorControlState
} from '../../shared/social-connectors'
import { DeterministicSocialApprovalQueue } from './approval-queue'
import { verifyMockWebhookFixtureSignature } from './fixture-signature'
import {
  assertNoCredentialMaterial,
  cloneSocialValue,
  serializePublicSocialRecord,
  socialHash,
  stableSocialJson
} from './security'

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
  readonly result: SocialActionResultV1
}

export interface MockSocialConnectorOptions {
  readonly provider: SocialProvider
  readonly referenceTimeMs: number
  readonly fixtureKeyId: string
  readonly fixtureKeyMaterial: string
  readonly policy?: SocialDestinationPolicyV1 | null
  readonly status?: SocialConnectorStatusV1
  readonly approvalQueue?: SocialApprovalQueueV1
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

export function createMockDestinationPolicy(
  provider: SocialProvider,
  referenceTimeMs: number,
  overrides: Partial<SocialDestinationPolicyV1> = {}
): SocialDestinationPolicyV1 {
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

  return {
    ...merged,
    fingerprint:
      overrides.fingerprint ??
      socialHash({
        ...merged,
        fingerprint: undefined
      })
  }
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
  readonly #fixtureKeyId: string
  readonly #fixtureKeyMaterial: string
  readonly #approvalQueue: SocialApprovalQueueV1
  readonly #status: MutableStatus
  readonly #auditReceipts: SocialAuditReceiptV1[] = []
  readonly #events = new Map<string, { event: SocialInboundEventV1; receiptId: string }>()
  readonly #webhookDeliveries = new Map<string, string>()
  readonly #actions = new Map<string, StoredAction>()
  readonly #rateWindows = new Map<SocialCapabilityId, RateWindow>()
  #policy: SocialDestinationPolicyV1 | null
  #auditSequence = 0

  constructor(options: MockSocialConnectorOptions) {
    this.manifest = socialManifestFor(options.provider)
    this.#fixtureKeyId = options.fixtureKeyId
    this.#fixtureKeyMaterial = options.fixtureKeyMaterial
    this.#approvalQueue = options.approvalQueue ?? new DeterministicSocialApprovalQueue()
    this.#policy =
      options.policy === undefined
        ? createMockDestinationPolicy(options.provider, options.referenceTimeMs)
        : options.policy
    const sourceStatus =
      options.status ?? createMockConnectorStatus(options.provider, options.referenceTimeMs)
    this.#status = cloneSocialValue(sourceStatus) as MutableStatus
  }

  get approvalQueue(): SocialApprovalQueueV1 {
    return this.#approvalQueue
  }

  getStatus(): SocialConnectorStatusV1 {
    return cloneSocialValue(this.#status)
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
    this.#status.quota = cloneSocialValue(quota) as MutableStatus['quota']
    this.#refreshLifecycle()
  }

  setConsent(state: SocialConsentState, epoch: number, expiresAtMs: number): void {
    this.#status.consent = { state, epoch, expiresAtMs }
    this.#refreshLifecycle()
  }

  setOperatorControl(state: SocialOperatorControlState): void {
    this.#status.operatorControl = state
    this.#refreshLifecycle()
  }

  setPolicy(policy: SocialDestinationPolicyV1 | null): void {
    this.#policy = policy ? cloneSocialValue(policy) : null
    this.#status.policyState = policy ? 'current' : 'missing'
    this.#refreshLifecycle()
  }

  ingestFixture(fixture: MockWebhookFixtureV1, nowMs: number): SocialInboundResultV1 {
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
    const replayedReceiptId = this.#webhookDeliveries.get(deliveryKey)
    if (replayedReceiptId) {
      const receipt = this.#recordReceipt({
        ...baseReceipt,
        decision: 'replay',
        reasonCode: 'webhook.replay',
        replayedReceiptId
      })
      return { outcome: 'replay', reasonCode: 'webhook.replay', receipt }
    }

    this.#webhookDeliveries.set(deliveryKey, '')
    const accessFailure = this.#capabilityAccessFailure(capability)
    if (accessFailure) {
      const denied = this.#inboundDenied(baseReceipt, accessFailure)
      this.#webhookDeliveries.set(deliveryKey, denied.receipt.receiptId)
      return denied
    }

    let providerPayload: Readonly<Record<string, unknown>>
    try {
      const parsed = objectRecord(JSON.parse(fixture.body))
      if (!parsed) throw new Error('Webhook fixture body must be a JSON object')
      assertNoCredentialMaterial(parsed)
      providerPayload = cloneSocialValue(parsed)
    } catch {
      const denied = this.#inboundDenied(baseReceipt, 'webhook.invalid_payload')
      this.#webhookDeliveries.set(deliveryKey, denied.receipt.receiptId)
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
      this.#webhookDeliveries.set(deliveryKey, receipt.receiptId)
      return {
        outcome: 'duplicate',
        reasonCode: 'event.duplicate',
        event: cloneSocialValue(existing.event),
        receipt
      }
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
    this.#events.set(eventKey, { event, receiptId: receipt.receiptId })
    this.#webhookDeliveries.set(deliveryKey, receipt.receiptId)
    return {
      outcome: 'accepted',
      reasonCode: 'fixture.accepted',
      event: cloneSocialValue(event),
      receipt
    }
  }

  execute(intent: SocialActionIntentV1, nowMs: number): SocialActionResultV1 {
    const capability = socialCapabilityFor(this.manifest.provider, intent.capabilityId)
    const payloadHash = socialHash(intent.payload)
    const idempotencyKeyHash = socialHash(intent.idempotencyKey)
    const baseReceipt = {
      operation: 'egress' as const,
      capabilityId: intent.capabilityId,
      destination: intent.destination,
      atMs: nowMs,
      actorRole: intent.actor.role,
      actorRefHash: socialHash(intent.actor.actorRef),
      idempotencyKeyHash,
      payloadHash,
      scopeStates: capabilityScopeStates(capability, this.#status)
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
      assertNoCredentialMaterial(intent.payload)
    } catch {
      return this.#actionDenied(baseReceipt, 'payload.credential_material')
    }
    if (nowMs > intent.deadlineMs || intent.deadlineMs <= intent.createdAtMs) {
      return this.#actionDenied(baseReceipt, 'intent.expired')
    }

    const actionKey = `${intent.provider}:${intent.capabilityId}:${intent.idempotencyKey}`
    const existing = this.#actions.get(actionKey)
    if (existing) {
      const receipt = this.#recordReceipt({
        ...baseReceipt,
        decision: 'duplicate',
        reasonCode: 'idempotency.duplicate',
        replayedReceiptId: existing.result.receipt.receiptId,
        mockProviderRef: existing.result.mockProviderRef
      })
      return {
        outcome: 'duplicate',
        reasonCode: 'idempotency.duplicate',
        duplicate: true,
        mockProviderRef: existing.result.mockProviderRef,
        receipt
      }
    }

    const policyFailure = this.#policyFailure(intent, capability, nowMs)
    if (policyFailure) return this.#actionDenied(baseReceipt, policyFailure)

    const accessFailure = this.#capabilityAccessFailure(capability)
    if (accessFailure) return this.#actionDenied(baseReceipt, accessFailure)
    const consentFailure = this.#consentFailure(intent, capability, nowMs)
    if (consentFailure) return this.#actionDenied(baseReceipt, consentFailure)
    if (this.#status.operatorControl !== 'enabled') {
      return this.#actionDenied(baseReceipt, 'operator_override.blocked')
    }

    const quotaBefore = this.#refreshQuota(nowMs)
    if (this.#status.quota.state !== 'available' || quotaBefore < capability.rateLimit.quotaCost) {
      return this.#actionDenied(
        { ...baseReceipt, quotaBefore, quotaAfter: quotaBefore },
        'quota.exhausted'
      )
    }

    const rateWindow = this.#rateWindow(capability, nowMs)
    if (rateWindow.used >= capability.rateLimit.maxRequests) {
      return this.#actionDenied(
        {
          ...baseReceipt,
          quotaBefore,
          quotaAfter: quotaBefore,
          retryAfterMs: Math.max(
            0,
            rateWindow.startedAtMs + capability.rateLimit.windowMs - nowMs
          )
        },
        'rate_limit.exceeded'
      )
    }

    let approvalRef: string | undefined
    if (capability.approval === 'required') {
      if (!intent.approvalRef) {
        return this.#actionDenied(
          { ...baseReceipt, quotaBefore, quotaAfter: quotaBefore },
          'approval.missing'
        )
      }
      const approval = this.#approvalQueue.consume({
        approvalRef: intent.approvalRef,
        provider: intent.provider,
        capabilityId: intent.capabilityId,
        destination: intent.destination,
        nowMs
      })
      if (!approval.allowed) {
        return this.#actionDenied(
          { ...baseReceipt, quotaBefore, quotaAfter: quotaBefore },
          approval.reasonCode
        )
      }
      approvalRef = approval.receipt?.approvalRef
    }

    rateWindow.used += 1
    this.#status.quota.remaining = Math.max(
      0,
      quotaBefore - capability.rateLimit.quotaCost
    )
    this.#status.quota.state =
      this.#status.quota.remaining > 0 ? 'available' : 'exhausted'
    this.#refreshLifecycle()

    const mockProviderRef = `mock:${intent.provider}:${socialHash({
      intentId: intent.intentId,
      idempotencyKey: intent.idempotencyKey,
      payloadHash
    }).slice('sha256:'.length, 'sha256:'.length + 20)}`
    const receipt = this.#recordReceipt({
      ...baseReceipt,
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
    this.#actions.set(actionKey, { result })
    return cloneSocialValue(result)
  }

  getAuditReceipts(): readonly SocialAuditReceiptV1[] {
    return cloneSocialValue(this.#auditReceipts)
  }

  serializeAuditReceipts(): string {
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
      policy.twitchMergedChatOutput === 'block' &&
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

  #rateWindow(capability: SocialCapabilityV1, nowMs: number): RateWindow {
    const existing = this.#rateWindows.get(capability.id)
    if (!existing || nowMs >= existing.startedAtMs + capability.rateLimit.windowMs) {
      const next = { startedAtMs: nowMs, used: 0 }
      this.#rateWindows.set(capability.id, next)
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
    return { outcome: 'denied', reasonCode, receipt }
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
    return cloneSocialValue(receipt)
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
