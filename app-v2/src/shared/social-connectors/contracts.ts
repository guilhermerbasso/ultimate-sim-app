export const SOCIAL_CONNECTOR_CONTRACT_VERSION = '1.0.0' as const
export const SOCIAL_CONNECTOR_SCHEMA = 'ultimate.sim.social.connector.v1' as const
export const SOCIAL_CAPABILITY_SCHEMA = 'ultimate.sim.social.capability.v1' as const
export const SOCIAL_POLICY_SCHEMA = 'ultimate.sim.social.destination-policy.v1' as const
export const SOCIAL_APPROVAL_SCHEMA = 'ultimate.sim.social.approval.v1' as const
export const SOCIAL_AUDIT_SCHEMA = 'ultimate.sim.social.audit-receipt.v1' as const
export const SOCIAL_WEBHOOK_FIXTURE_SCHEMA = 'ultimate.sim.social.webhook-fixture.v1' as const

export type SocialProvider = 'twitch' | 'youtube' | 'discord'
export type SocialDestination = 'twitch.channel' | 'youtube.broadcast' | 'discord.guild'

export type SocialCapabilityId =
  | 'twitch.eventsub.ingest'
  | 'twitch.chat.read'
  | 'twitch.chat.write'
  | 'twitch.poll.manage'
  | 'twitch.moderation.manage'
  | 'twitch.marker.create'
  | 'twitch.clip.create'
  | 'youtube.broadcast.manage'
  | 'youtube.health.read'
  | 'youtube.chat.read'
  | 'youtube.chat.write'
  | 'youtube.poll.manage'
  | 'discord.command.receive'
  | 'discord.response.ephemeral'
  | 'discord.room.create'
  | 'discord.room.close'

export type SocialActorRole =
  | 'operator'
  | 'broadcaster'
  | 'creator'
  | 'moderator'
  | 'team-manager'
  | 'engineer'
  | 'spotter'
  | 'driver'
  | 'steward'
  | 'spectator'
  | 'connector'

export type SocialCapabilityDirection = 'ingress' | 'egress'
export type SocialCapabilityEffect = 'read' | 'write' | 'moderate' | 'create' | 'manage'
export type SocialApprovalRequirement = 'never' | 'required'
export type SocialConsentRequirement = 'never' | 'required'
export type SocialReviewRequirement = 'not-required' | 'required'
export type SocialScopeState = 'granted' | 'revoked' | 'missing'
export type SocialEntitlementState = 'eligible' | 'ineligible' | 'unknown'
export type SocialReviewState = 'not-required' | 'unknown' | 'pending' | 'approved' | 'rejected'
export type SocialQuotaState = 'available' | 'exhausted' | 'unknown'
export type SocialPolicyState = 'current' | 'stale' | 'missing'
export type SocialConsentState = 'granted' | 'revoked' | 'expired' | 'missing'
export type SocialOperatorControlState = 'enabled' | 'blocked'
export type SocialApprovalState =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'consumed'
  | 'cancelled'

export interface SocialRateLimitV1 {
  readonly maxRequests: number
  readonly windowMs: number
  readonly quotaCost: number
}

export interface SocialCapabilityV1 {
  readonly schema: typeof SOCIAL_CAPABILITY_SCHEMA
  readonly contractVersion: typeof SOCIAL_CONNECTOR_CONTRACT_VERSION
  readonly id: SocialCapabilityId
  readonly provider: SocialProvider
  readonly label: string
  readonly description: string
  readonly direction: SocialCapabilityDirection
  readonly effect: SocialCapabilityEffect
  readonly destination: SocialDestination
  readonly requiredScopes: readonly string[]
  readonly entitlementKey: string
  readonly approval: SocialApprovalRequirement
  readonly consent: SocialConsentRequirement
  readonly review: SocialReviewRequirement
  readonly rateLimit: SocialRateLimitV1
  readonly supportedInMock: true
}

export interface SocialConnectorManifestV1 {
  readonly schema: typeof SOCIAL_CONNECTOR_SCHEMA
  readonly contractVersion: typeof SOCIAL_CONNECTOR_CONTRACT_VERSION
  readonly connectorId: string
  readonly provider: SocialProvider
  readonly displayName: string
  readonly adapterKind: 'mock-conformance'
  readonly transport: 'none'
  readonly networkAccess: false
  readonly credentialInput: 'forbidden'
  readonly platformCertificationClaim: 'none'
  readonly capabilities: readonly SocialCapabilityV1[]
  readonly webhookReplayWindowMs: number
}

export interface SocialQuotaSnapshotV1 {
  readonly state: SocialQuotaState
  readonly limit: number
  readonly remaining: number
  readonly resetAtMs: number
}

export interface SocialConnectorStatusV1 {
  readonly schema: typeof SOCIAL_CONNECTOR_SCHEMA
  readonly contractVersion: typeof SOCIAL_CONNECTOR_CONTRACT_VERSION
  readonly connectorId: string
  readonly provider: SocialProvider
  readonly mode: 'mock-conformance'
  readonly lifecycle: 'ready' | 'blocked'
  readonly scopes: Readonly<Record<string, SocialScopeState>>
  readonly entitlements: Readonly<Record<string, SocialEntitlementState>>
  readonly reviews: Readonly<Partial<Record<SocialCapabilityId, SocialReviewState>>>
  readonly quota: SocialQuotaSnapshotV1
  readonly consent: {
    readonly state: SocialConsentState
    readonly epoch: number
    readonly expiresAtMs: number
  }
  readonly operatorControl: SocialOperatorControlState
  readonly policyState: SocialPolicyState
  readonly networkAccess: false
  readonly credentialsConfigured: false
  readonly updatedAtMs: number
}

export interface SocialPolicyReferenceV1 {
  readonly policyId: string
  readonly revision: number
  readonly fingerprint: string
}

export interface SocialDestinationPolicyV1 extends SocialPolicyReferenceV1 {
  readonly schema: typeof SOCIAL_POLICY_SCHEMA
  readonly contractVersion: typeof SOCIAL_CONNECTOR_CONTRACT_VERSION
  readonly provider: SocialProvider
  readonly destination: SocialDestination
  readonly validFromMs: number
  readonly validUntilMs: number
  readonly allowedCapabilities: readonly SocialCapabilityId[]
  readonly allowedActorRoles: readonly SocialActorRole[]
  readonly allowedSourceProviders: readonly SocialProvider[]
  readonly allowedRoomRoleIds: readonly string[]
  readonly maxPayloadBytes: number
  readonly twitchMergedChatOutput: 'block' | 'not-applicable'
}

export interface SocialActorV1 {
  readonly actorRef: string
  readonly role: SocialActorRole
}

export interface SocialActionIntentV1 {
  readonly schema: typeof SOCIAL_CONNECTOR_SCHEMA
  readonly contractVersion: typeof SOCIAL_CONNECTOR_CONTRACT_VERSION
  readonly intentId: string
  readonly provider: SocialProvider
  readonly capabilityId: SocialCapabilityId
  readonly destination: SocialDestination
  readonly actor: SocialActorV1
  readonly idempotencyKey: string
  readonly sourceProvider?: SocialProvider
  readonly payload: Readonly<Record<string, unknown>>
  readonly enqueuedPolicy?: Readonly<Pick<SocialPolicyReferenceV1, 'policyId' | 'revision'>>
  readonly consentEpoch: number
  readonly approvalRef?: string
  readonly createdAtMs: number
  readonly deadlineMs: number
}

export interface SocialApprovalRequestV1 {
  readonly schema: typeof SOCIAL_APPROVAL_SCHEMA
  readonly contractVersion: typeof SOCIAL_CONNECTOR_CONTRACT_VERSION
  readonly requestId: string
  readonly provider: SocialProvider
  readonly capabilityId: SocialCapabilityId
  readonly destination: SocialDestination
  readonly requestedBy: SocialActorV1
  readonly reason: string
  readonly payloadHash: string
  readonly createdAtMs: number
  readonly expiresAtMs: number
  readonly oneShot: true
  readonly state: 'pending'
}

export interface SocialApprovalReceiptV1 {
  readonly schema: typeof SOCIAL_APPROVAL_SCHEMA
  readonly contractVersion: typeof SOCIAL_CONNECTOR_CONTRACT_VERSION
  readonly approvalRef: string
  readonly requestId: string
  readonly provider: SocialProvider
  readonly capabilityId: SocialCapabilityId
  readonly destination: SocialDestination
  readonly decisionBy: SocialActorV1
  readonly decisionReason: string
  readonly decidedAtMs: number
  readonly expiresAtMs: number
  readonly oneShot: true
  readonly state: SocialApprovalState
}

export interface SocialApprovalConsumeRequestV1 {
  readonly approvalRef: string
  readonly provider: SocialProvider
  readonly capabilityId: SocialCapabilityId
  readonly destination: SocialDestination
  readonly nowMs: number
}

export interface SocialApprovalConsumeResultV1 {
  readonly allowed: boolean
  readonly reasonCode: string
  readonly receipt?: SocialApprovalReceiptV1
}

export interface SocialApprovalQueueV1 {
  enqueue(request: SocialApprovalRequestV1): SocialApprovalRequestV1
  decide(
    requestId: string,
    state: 'approved' | 'rejected' | 'cancelled',
    actor: SocialActorV1,
    reason: string,
    nowMs: number
  ): SocialApprovalReceiptV1
  consume(request: SocialApprovalConsumeRequestV1): SocialApprovalConsumeResultV1
  getRequest(requestId: string): SocialApprovalRequestV1 | undefined
  getReceipt(approvalRef: string): SocialApprovalReceiptV1 | undefined
}

export interface MockWebhookFixtureV1 {
  readonly schema: typeof SOCIAL_WEBHOOK_FIXTURE_SCHEMA
  readonly contractVersion: typeof SOCIAL_CONNECTOR_CONTRACT_VERSION
  readonly provider: SocialProvider
  readonly capabilityId: SocialCapabilityId
  readonly deliveryId: string
  readonly eventId: string
  readonly occurredAtMs: number
  readonly keyId: string
  readonly algorithm: 'fixture-hmac-sha256-v1'
  readonly body: string
  readonly signature: string
}

export interface SocialInboundEventV1 {
  readonly eventId: string
  readonly provider: SocialProvider
  readonly capabilityId: SocialCapabilityId
  readonly sourceLabel: SocialProvider
  readonly occurredAtMs: number
  readonly receivedAtMs: number
  readonly providerPayload: Readonly<Record<string, unknown>>
  readonly providerPayloadHash: string
}

export type SocialAuditDecision = 'accepted' | 'simulated' | 'duplicate' | 'denied' | 'replay'

export interface SocialAuditReceiptV1 {
  readonly schema: typeof SOCIAL_AUDIT_SCHEMA
  readonly contractVersion: typeof SOCIAL_CONNECTOR_CONTRACT_VERSION
  readonly receiptId: string
  readonly connectorId: string
  readonly provider: SocialProvider
  readonly operation: SocialCapabilityDirection
  readonly capabilityId: SocialCapabilityId
  readonly destination?: SocialDestination
  readonly decision: SocialAuditDecision
  readonly reasonCode: string
  readonly atMs: number
  readonly actorRole?: SocialActorRole
  readonly actorRefHash?: string
  readonly eventIdHash?: string
  readonly deliveryIdHash?: string
  readonly idempotencyKeyHash?: string
  readonly payloadHash?: string
  readonly policy?: SocialPolicyReferenceV1
  readonly scopeStates: Readonly<Record<string, SocialScopeState>>
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

export interface SocialInboundResultV1 {
  readonly outcome: 'accepted' | 'duplicate' | 'denied' | 'replay'
  readonly reasonCode: string
  readonly event?: SocialInboundEventV1
  readonly receipt: SocialAuditReceiptV1
}

export interface SocialActionResultV1 {
  readonly outcome: 'simulated' | 'duplicate' | 'denied'
  readonly reasonCode: string
  readonly duplicate: boolean
  readonly mockProviderRef?: string
  readonly retryAfterMs?: number
  readonly receipt: SocialAuditReceiptV1
}

export interface SocialConnectorV1 {
  readonly contractVersion: typeof SOCIAL_CONNECTOR_CONTRACT_VERSION
  readonly manifest: SocialConnectorManifestV1
  getStatus(): SocialConnectorStatusV1
  ingestFixture(fixture: MockWebhookFixtureV1, nowMs: number): SocialInboundResultV1
  execute(intent: SocialActionIntentV1, nowMs: number): SocialActionResultV1
  getAuditReceipts(): readonly SocialAuditReceiptV1[]
  serializeAuditReceipts(): string
}

export interface SocialCapabilityMatrixRowV1 {
  readonly provider: SocialProvider
  readonly connectorId: string
  readonly capabilityId: SocialCapabilityId
  readonly label: string
  readonly direction: SocialCapabilityDirection
  readonly destination: SocialDestination
  readonly scopeState: SocialScopeState
  readonly entitlementState: SocialEntitlementState
  readonly quotaState: SocialQuotaState
  readonly reviewState: SocialReviewState
  readonly approval: SocialApprovalRequirement
  readonly consentState: SocialConsentState
  readonly operatorControl: SocialOperatorControlState
  readonly policyState: SocialPolicyState
  readonly mode: 'mock-conformance'
}
