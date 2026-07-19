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
  type SocialActorRole,
  type SocialActorV1,
  type SocialApprovalQueueV1,
  type SocialAuditDecision,
  type SocialAuditReceiptV1,
  type SocialCapabilityId,
  type SocialCapabilityV1,
  type SocialConnectorStatusV1,
  type SocialConnectorManifestV1,
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
  cloneSocialValue,
  findCredentialMaterial,
  readSocialDataRecord,
  sanitizeSocialJsonRecord,
  serializePublicSocialRecord,
  socialHash,
  stableSocialJson,
  type SocialJsonValue
} from './security'
import {
  assertFiniteNumber,
  assertFiniteTimestamp,
  assertNonEmptyString,
  assertNonNegativeFinite,
  assertNonNegativeSafeInteger,
  assertPositiveFinite,
  assertPositiveInteger,
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
  | 'updatedAtMs'
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
  updatedAtMs: number
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
  readonly contentFingerprint: string
  readonly receiptId: string
  readonly expiresAtMs: number
}

interface StoredEvent {
  readonly eventFingerprint: string
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

interface RuntimeWebhookFixture {
  readonly schema: string
  readonly contractVersion: string
  readonly provider: string
  readonly capabilityId: string
  readonly deliveryId: string
  readonly eventId: string
  readonly occurredAtMs: number
  readonly keyId: string
  readonly algorithm: string
  readonly body: string
  readonly signature: unknown
}

interface RuntimeActionIntent {
  readonly schema: string
  readonly contractVersion: string
  readonly intentId: string
  readonly provider: string
  readonly capabilityId: string
  readonly destination: string
  readonly actor: unknown
  readonly idempotencyKey: string
  readonly sourceProvider?: string
  readonly payload: unknown
  readonly enqueuedPolicy?: SocialActionIntentV1['enqueuedPolicy']
  readonly consentEpoch: number
  readonly approvalRef?: string
  readonly createdAtMs: number
  readonly deadlineMs: number
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

const SOCIAL_PROVIDERS = new Set<SocialProvider>(['twitch', 'youtube', 'discord'])
const SOCIAL_CONSENT_STATES = new Set<SocialConsentState>([
  'granted',
  'revoked',
  'expired',
  'missing'
])
const SOCIAL_SCOPE_STATES = new Set<SocialScopeState>(['granted', 'revoked', 'missing'])
const SOCIAL_ENTITLEMENT_STATES = new Set<SocialEntitlementState>([
  'eligible',
  'ineligible',
  'unknown'
])
const SOCIAL_REVIEW_STATES = new Set<SocialReviewState>([
  'not-required',
  'unknown',
  'pending',
  'approved',
  'rejected'
])
const SOCIAL_ACTOR_ROLES = new Set<SocialActorRole>([
  'operator',
  'broadcaster',
  'creator',
  'moderator',
  'team-manager',
  'engineer',
  'spotter',
  'driver',
  'steward',
  'spectator',
  'connector'
])

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isSocialProvider(value: string): value is SocialProvider {
  return SOCIAL_PROVIDERS.has(value as SocialProvider)
}

function hasOnlyKeys(
  record: Readonly<Record<string, unknown>>,
  allowedKeys: ReadonlySet<string>
): boolean {
  return Object.keys(record).every((key) => allowedKeys.has(key))
}

function runtimeWebhookFixture(value: unknown): RuntimeWebhookFixture | null {
  const record = readSocialDataRecord(value)
  const allowedKeys = new Set([
    'schema',
    'contractVersion',
    'provider',
    'capabilityId',
    'deliveryId',
    'eventId',
    'occurredAtMs',
    'keyId',
    'algorithm',
    'body',
    'signature'
  ])
  if (
    !record ||
    !hasOnlyKeys(record, allowedKeys) ||
    !isNonEmptyString(record.schema) ||
    !isNonEmptyString(record.contractVersion) ||
    !isNonEmptyString(record.provider) ||
    !isNonEmptyString(record.capabilityId) ||
    !isNonEmptyString(record.deliveryId) ||
    !isNonEmptyString(record.eventId) ||
    typeof record.occurredAtMs !== 'number' ||
    !isNonEmptyString(record.keyId) ||
    !isNonEmptyString(record.algorithm) ||
    typeof record.body !== 'string'
  ) {
    return null
  }
  return {
    schema: record.schema,
    contractVersion: record.contractVersion,
    provider: record.provider,
    capabilityId: record.capabilityId,
    deliveryId: record.deliveryId,
    eventId: record.eventId,
    occurredAtMs: record.occurredAtMs,
    keyId: record.keyId,
    algorithm: record.algorithm,
    body: record.body,
    signature: record.signature
  }
}

function runtimeActionIntent(value: unknown): RuntimeActionIntent | null {
  const record = readSocialDataRecord(value)
  const allowedKeys = new Set([
    'schema',
    'contractVersion',
    'intentId',
    'provider',
    'capabilityId',
    'destination',
    'actor',
    'idempotencyKey',
    'sourceProvider',
    'payload',
    'enqueuedPolicy',
    'consentEpoch',
    'approvalRef',
    'createdAtMs',
    'deadlineMs'
  ])
  if (
    !record ||
    !hasOnlyKeys(record, allowedKeys) ||
    !isNonEmptyString(record.schema) ||
    !isNonEmptyString(record.contractVersion) ||
    !isNonEmptyString(record.intentId) ||
    !isNonEmptyString(record.provider) ||
    !isNonEmptyString(record.capabilityId) ||
    !isNonEmptyString(record.destination) ||
    !isNonEmptyString(record.idempotencyKey) ||
    typeof record.consentEpoch !== 'number' ||
    typeof record.createdAtMs !== 'number' ||
    typeof record.deadlineMs !== 'number' ||
    (record.sourceProvider !== undefined && !isNonEmptyString(record.sourceProvider)) ||
    (record.approvalRef !== undefined && !isNonEmptyString(record.approvalRef))
  ) {
    return null
  }

  let enqueuedPolicy: SocialActionIntentV1['enqueuedPolicy']
  if (record.enqueuedPolicy !== undefined) {
    const policy = readSocialDataRecord(record.enqueuedPolicy)
    if (
      !policy ||
      !hasOnlyKeys(policy, new Set(['policyId', 'revision'])) ||
      !isNonEmptyString(policy.policyId) ||
      typeof policy.revision !== 'number' ||
      !Number.isFinite(policy.revision)
    ) {
      return null
    }
    enqueuedPolicy = { policyId: policy.policyId, revision: policy.revision }
  }

  return {
    schema: record.schema,
    contractVersion: record.contractVersion,
    intentId: record.intentId,
    provider: record.provider,
    capabilityId: record.capabilityId,
    destination: record.destination,
    actor: record.actor,
    idempotencyKey: record.idempotencyKey,
    sourceProvider: record.sourceProvider as string | undefined,
    payload: record.payload,
    enqueuedPolicy,
    consentEpoch: record.consentEpoch,
    approvalRef: record.approvalRef as string | undefined,
    createdAtMs: record.createdAtMs,
    deadlineMs: record.deadlineMs
  }
}

function runtimeSocialActor(value: unknown): SocialActorV1 | null {
  const actor = readSocialDataRecord(value)
  if (
    !actor ||
    !hasOnlyKeys(actor, new Set(['actorRef', 'role'])) ||
    !isNonEmptyString(actor.actorRef) ||
    !isNonEmptyString(actor.role) ||
    !SOCIAL_ACTOR_ROLES.has(actor.role as SocialActorRole)
  ) {
    return null
  }
  return { actorRef: actor.actorRef, role: actor.role as SocialActorRole }
}

function payloadFieldMatches(
  kind: SocialCapabilityV1['payloadFields'][number]['kind'],
  value: SocialJsonValue
): boolean {
  if (kind === 'string') return typeof value === 'string'
  if (kind === 'finite-number') return typeof value === 'number' && Number.isFinite(value)
  if (kind === 'boolean') return typeof value === 'boolean'
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function capabilityPayloadFailure(
  capability: SocialCapabilityV1,
  payload: Readonly<Record<string, SocialJsonValue>>
): 'payload.field_not_allowed' | 'payload.invalid_field' | null {
  const fields = new Map(capability.payloadFields.map((field) => [field.name, field.kind]))
  for (const [key, value] of Object.entries(payload)) {
    const kind = fields.get(key)
    if (!kind) return 'payload.field_not_allowed'
    if (!payloadFieldMatches(kind, value)) return 'payload.invalid_field'
  }
  return null
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

function validateStatus(
  value: unknown,
  manifest: SocialConnectorManifestV1
): SocialConnectorStatusV1 {
  const status = sanitizeSocialJsonRecord(value)
  const allowedKeys = new Set([
    'schema',
    'contractVersion',
    'connectorId',
    'provider',
    'mode',
    'lifecycle',
    'scopes',
    'entitlements',
    'reviews',
    'quota',
    'consent',
    'operatorControl',
    'policyState',
    'networkAccess',
    'credentialsConfigured',
    'updatedAtMs'
  ])
  if (
    !status ||
    !hasOnlyKeys(status, allowedKeys) ||
    status.schema !== SOCIAL_CONNECTOR_SCHEMA ||
    status.contractVersion !== SOCIAL_CONNECTOR_CONTRACT_VERSION ||
    status.connectorId !== manifest.connectorId ||
    status.provider !== manifest.provider ||
    status.mode !== 'mock-conformance' ||
    (status.lifecycle !== 'ready' && status.lifecycle !== 'blocked') ||
    status.networkAccess !== false ||
    status.credentialsConfigured !== false
  ) {
    throw new Error('Invalid social connector status contract')
  }

  const scopes = readSocialDataRecord(status.scopes)
  const entitlements = readSocialDataRecord(status.entitlements)
  const reviews = readSocialDataRecord(status.reviews)
  const quota = readSocialDataRecord(status.quota)
  const consent = readSocialDataRecord(status.consent)
  if (!scopes || !entitlements || !reviews || !quota || !consent) {
    throw new Error('Invalid social connector status state')
  }

  assertFiniteTimestamp(status.updatedAtMs, 'status.updatedAtMs')
  assertNonNegativeFinite(quota.limit, 'status.quota.limit')
  assertNonNegativeFinite(quota.remaining, 'status.quota.remaining')
  assertFiniteTimestamp(quota.resetAtMs, 'status.quota.resetAtMs')
  assertNonNegativeSafeInteger(consent.epoch, 'status.consent.epoch')
  assertFiniteTimestamp(consent.expiresAtMs, 'status.consent.expiresAtMs')
  if (!SOCIAL_CONSENT_STATES.has(consent.state as SocialConsentState)) {
    throw new Error('status.consent.state is invalid')
  }
  if (
    quota.state !== 'available' &&
    quota.state !== 'exhausted' &&
    quota.state !== 'unknown'
  ) {
    throw new Error('status.quota.state is invalid')
  }
  if (status.operatorControl !== 'enabled' && status.operatorControl !== 'blocked') {
    throw new Error('status.operatorControl is invalid')
  }
  if (
    status.policyState !== 'current' &&
    status.policyState !== 'stale' &&
    status.policyState !== 'missing'
  ) {
    throw new Error('status.policyState is invalid')
  }
  if (quota.remaining > quota.limit) {
    throw new Error('status.quota.remaining cannot exceed status.quota.limit')
  }
  if (
    Object.values(scopes).some(
      (state) => !SOCIAL_SCOPE_STATES.has(state as SocialScopeState)
    ) ||
    Object.values(entitlements).some(
      (state) => !SOCIAL_ENTITLEMENT_STATES.has(state as SocialEntitlementState)
    ) ||
    Object.values(reviews).some(
      (state) => !SOCIAL_REVIEW_STATES.has(state as SocialReviewState)
    )
  ) {
    throw new Error('Invalid social connector status state value')
  }
  for (const capability of manifest.capabilities) {
    for (const scope of capability.requiredScopes) {
      if (!SOCIAL_SCOPE_STATES.has(scopes[scope] as SocialScopeState)) {
        throw new Error(`Missing required status scope ${scope}`)
      }
    }
    if (
      !SOCIAL_ENTITLEMENT_STATES.has(
        entitlements[capability.entitlementKey] as SocialEntitlementState
      )
    ) {
      throw new Error(`Missing required status entitlement ${capability.entitlementKey}`)
    }
    if (
      capability.review === 'required' &&
      !SOCIAL_REVIEW_STATES.has(reviews[capability.id] as SocialReviewState)
    ) {
      throw new Error(`Missing required status review ${capability.id}`)
    }
  }
  return status as unknown as SocialConnectorStatusV1
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
  #consentAuthority: MutableStatus['consent']
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
    this.#status = validateStatus(sourceStatus, this.manifest) as MutableStatus
    this.#consentAuthority = cloneSocialValue(this.#status.consent)
    this.#rateLimitOverrides = cloneSocialValue(options.rateLimitOverrides ?? {})
    for (const [capabilityId, rateLimit] of Object.entries(this.#rateLimitOverrides)) {
      if (rateLimit) validateRateLimit(rateLimit, `rateLimits.${capabilityId}`)
    }
    this.#storageLimits = {
      ...DEFAULT_STORAGE_LIMITS,
      ...(options.storageLimits ?? {})
    }
    validateStorageLimits(this.#storageLimits)
    this.#refreshAuthorityState(authorityNowMs)
  }

  get approvalQueue(): SocialApprovalQueueV1 {
    return this.#approvalQueue
  }

  getStatus(): SocialConnectorStatusV1 {
    this.#refreshAuthorityState(this.#now())
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
    this.#refreshAuthorityState(this.#now())
  }

  setEntitlementState(entitlementKey: string, state: SocialEntitlementState): void {
    this.#status.entitlements[entitlementKey] = state
    this.#refreshAuthorityState(this.#now())
  }

  setReviewState(capabilityId: SocialCapabilityId, state: SocialReviewState): void {
    this.#status.reviews[capabilityId] = state
    this.#refreshAuthorityState(this.#now())
  }

  setQuota(quota: SocialQuotaSnapshotV1): void {
    assertNonNegativeFinite(quota.limit, 'quota.limit')
    assertNonNegativeFinite(quota.remaining, 'quota.remaining')
    assertFiniteTimestamp(quota.resetAtMs, 'quota.resetAtMs')
    if (quota.remaining > quota.limit) throw new Error('quota.remaining cannot exceed quota.limit')
    this.#status.quota = cloneSocialValue(quota) as MutableStatus['quota']
    this.#refreshAuthorityState(this.#now())
  }

  setConsent(state: SocialConsentState, epoch: number, expiresAtMs: number): void {
    if (!SOCIAL_CONSENT_STATES.has(state)) throw new Error('consent.state is invalid')
    assertNonNegativeSafeInteger(epoch, 'consent.epoch')
    assertFiniteTimestamp(expiresAtMs, 'consent.expiresAtMs')
    const current = this.#consentAuthority
    if (epoch < current.epoch) throw new Error('stale consent epoch cannot overwrite current state')
    if (epoch === current.epoch) {
      if (state !== current.state || expiresAtMs !== current.expiresAtMs) {
        throw new Error('consent epoch conflict')
      }
      this.#refreshAuthorityState(this.#now())
      return
    }
    this.#consentAuthority = { state, epoch, expiresAtMs }
    this.#refreshAuthorityState(this.#now())
  }

  setOperatorControl(state: SocialOperatorControlState): void {
    this.#status.operatorControl = state
    this.#refreshAuthorityState(this.#now())
  }

  setPolicy(policy: SocialDestinationPolicyV1 | null): void {
    if (policy) validateDestinationPolicy(policy, this.manifest.provider)
    this.#policy = policy ? cloneSocialValue(policy) : null
    this.#refreshAuthorityState(this.#now())
  }

  ingestFixture(fixture: MockWebhookFixtureV1): SocialInboundResultV1 {
    const nowMs = this.#now()
    this.#pruneStorage(nowMs)
    this.#refreshAuthorityState(nowMs)
    const fallbackCapability = this.#auditCapability('ingress')
    const malformedReceipt = {
      operation: 'ingress' as const,
      capabilityId: fallbackCapability.id,
      atMs: nowMs,
      scopeStates: capabilityScopeStates(fallbackCapability, this.#status)
    }
    const runtimeFixture = runtimeWebhookFixture(fixture)
    if (!runtimeFixture) {
      return this.#inboundDenied(malformedReceipt, 'validation.malformed_fixture')
    }

    const capability = socialCapabilityFor(
      this.manifest.provider,
      runtimeFixture.capabilityId as SocialCapabilityId
    )
    const auditCapability =
      capability?.direction === 'ingress' ? capability : fallbackCapability
    const baseReceipt = {
      operation: 'ingress' as const,
      capabilityId: auditCapability.id,
      atMs: nowMs,
      eventIdHash: socialHash(runtimeFixture.eventId),
      deliveryIdHash: socialHash(runtimeFixture.deliveryId),
      scopeStates: capabilityScopeStates(auditCapability, this.#status)
    }

    if (!Number.isFinite(runtimeFixture.occurredAtMs)) {
      return this.#inboundDenied(baseReceipt, 'validation.non_finite_time')
    }

    const deliveryKey = socialHash({
      provider: runtimeFixture.provider,
      deliveryId: runtimeFixture.deliveryId
    })
    const deliveryContentFingerprint = socialHash({
      schema: runtimeFixture.schema,
      contractVersion: runtimeFixture.contractVersion,
      provider: runtimeFixture.provider,
      capabilityId: runtimeFixture.capabilityId,
      deliveryId: runtimeFixture.deliveryId,
      eventId: runtimeFixture.eventId,
      occurredAtMs: runtimeFixture.occurredAtMs,
      keyId: runtimeFixture.keyId,
      algorithm: runtimeFixture.algorithm,
      body: runtimeFixture.body
    })
    const replayedDelivery = this.#webhookDeliveries.get(deliveryKey)
    if (replayedDelivery) {
      if (replayedDelivery.contentFingerprint !== deliveryContentFingerprint) {
        return this.#inboundDenied(
          { ...baseReceipt, replayedReceiptId: replayedDelivery.receiptId },
          'webhook.delivery_conflict'
        )
      }
      const receipt = this.#recordReceipt({
        ...baseReceipt,
        decision: 'replay',
        reasonCode: 'webhook.replay',
        replayedReceiptId: replayedDelivery.receiptId
      })
      return { outcome: 'replay', reasonCode: 'webhook.replay', receipt }
    }

    if (
      runtimeFixture.provider !== this.manifest.provider ||
      !capability ||
      capability.direction !== 'ingress'
    ) {
      return this.#inboundDenied(baseReceipt, 'capability.unsupported')
    }
    if (
      Math.abs(nowMs - runtimeFixture.occurredAtMs) >
      this.manifest.webhookReplayWindowMs
    ) {
      return this.#inboundDenied(baseReceipt, 'webhook.stale')
    }
    if (typeof runtimeFixture.signature !== 'string') {
      return this.#inboundDenied(baseReceipt, 'validation.malformed_fixture')
    }
    const normalizedFixture: MockWebhookFixtureV1 = {
      schema: runtimeFixture.schema as MockWebhookFixtureV1['schema'],
      contractVersion:
        runtimeFixture.contractVersion as MockWebhookFixtureV1['contractVersion'],
      provider: runtimeFixture.provider,
      capabilityId: runtimeFixture.capabilityId as SocialCapabilityId,
      deliveryId: runtimeFixture.deliveryId,
      eventId: runtimeFixture.eventId,
      occurredAtMs: runtimeFixture.occurredAtMs,
      keyId: runtimeFixture.keyId,
      algorithm: runtimeFixture.algorithm as MockWebhookFixtureV1['algorithm'],
      body: runtimeFixture.body,
      signature: runtimeFixture.signature
    }
    if (
      !verifyMockWebhookFixtureSignature(
        normalizedFixture,
        this.#fixtureKeyId,
        this.#fixtureKeyMaterial
      )
    ) {
      return this.#inboundDenied(baseReceipt, 'webhook.invalid_signature')
    }

    if (this.#webhookDeliveries.size >= this.#storageLimits.maxWebhookDeliveries) {
      return this.#inboundDenied(baseReceipt, 'storage.replay_capacity')
    }

    const accessFailure = this.#capabilityAccessFailure(capability)
    if (accessFailure) {
      const denied = this.#inboundDenied(baseReceipt, accessFailure)
      this.#storeWebhookDelivery(
        deliveryKey,
        deliveryContentFingerprint,
        denied.receipt.receiptId,
        nowMs
      )
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
      this.#storeWebhookDelivery(
        deliveryKey,
        deliveryContentFingerprint,
        denied.receipt.receiptId,
        nowMs
      )
      return denied
    }
    rateWindow.used += 1

    let parsedPayload: unknown
    try {
      parsedPayload = JSON.parse(runtimeFixture.body)
    } catch {
      const denied = this.#inboundDenied(baseReceipt, 'webhook.invalid_payload')
      this.#storeWebhookDelivery(
        deliveryKey,
        deliveryContentFingerprint,
        denied.receipt.receiptId,
        nowMs
      )
      return denied
    }

    const providerPayload = sanitizeSocialJsonRecord(parsedPayload)
    if (
      !providerPayload ||
      findCredentialMaterial(providerPayload, { provider: this.manifest.provider }) ||
      capabilityPayloadFailure(capability, providerPayload)
    ) {
      const denied = this.#inboundDenied(baseReceipt, 'webhook.invalid_payload')
      this.#storeWebhookDelivery(
        deliveryKey,
        deliveryContentFingerprint,
        denied.receipt.receiptId,
        nowMs
      )
      return denied
    }

    const providerPayloadHash = socialHash(providerPayload)
    const payloadReceipt = { ...baseReceipt, payloadHash: providerPayloadHash }
    const eventKey = socialHash({
      provider: runtimeFixture.provider,
      capabilityId: runtimeFixture.capabilityId,
      eventId: runtimeFixture.eventId
    })
    const eventFingerprint = socialHash({
      provider: runtimeFixture.provider,
      capabilityId: runtimeFixture.capabilityId,
      eventId: runtimeFixture.eventId,
      occurredAtMs: runtimeFixture.occurredAtMs,
      providerPayloadHash
    })
    const existing = this.#events.get(eventKey)
    if (existing) {
      if (existing.eventFingerprint !== eventFingerprint) {
        const denied = this.#inboundDenied(
          { ...payloadReceipt, replayedReceiptId: existing.receiptId },
          'event.conflict'
        )
        this.#storeWebhookDelivery(
          deliveryKey,
          deliveryContentFingerprint,
          denied.receipt.receiptId,
          nowMs
        )
        return denied
      }
      const receipt = this.#recordReceipt({
        ...payloadReceipt,
        decision: 'duplicate',
        reasonCode: 'event.duplicate',
        replayedReceiptId: existing.receiptId
      })
      this.#storeWebhookDelivery(
        deliveryKey,
        deliveryContentFingerprint,
        receipt.receiptId,
        nowMs
      )
      return {
        outcome: 'duplicate',
        reasonCode: 'event.duplicate',
        event: cloneSocialValue(existing.event),
        receipt
      }
    }
    if (this.#events.size >= this.#storageLimits.maxEvents) {
      const denied = this.#inboundDenied(payloadReceipt, 'storage.event_capacity')
      this.#storeWebhookDelivery(
        deliveryKey,
        deliveryContentFingerprint,
        denied.receipt.receiptId,
        nowMs
      )
      return denied
    }

    const event: SocialInboundEventV1 = {
      eventId: runtimeFixture.eventId,
      provider: runtimeFixture.provider,
      capabilityId: runtimeFixture.capabilityId as SocialCapabilityId,
      sourceLabel: runtimeFixture.provider,
      occurredAtMs: runtimeFixture.occurredAtMs,
      receivedAtMs: nowMs,
      providerPayload,
      providerPayloadHash
    }
    const receipt = this.#recordReceipt({
      ...payloadReceipt,
      decision: 'accepted',
      reasonCode: 'fixture.accepted'
    })
    this.#storeEvent(eventKey, eventFingerprint, event, receipt.receiptId, nowMs)
    this.#storeWebhookDelivery(
      deliveryKey,
      deliveryContentFingerprint,
      receipt.receiptId,
      nowMs
    )
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
    this.#refreshAuthorityState(nowMs)
    const fallbackCapability = this.#auditCapability('egress')
    const malformedReceipt = {
      operation: 'egress' as const,
      capabilityId: fallbackCapability.id,
      destination: fallbackCapability.destination,
      atMs: nowMs,
      scopeStates: capabilityScopeStates(fallbackCapability, this.#status)
    }
    const runtimeIntent = runtimeActionIntent(intent)
    if (!runtimeIntent) {
      return this.#actionDenied(malformedReceipt, 'validation.malformed_intent')
    }

    const capability = socialCapabilityFor(
      this.manifest.provider,
      runtimeIntent.capabilityId as SocialCapabilityId
    )
    const auditCapability =
      capability?.direction === 'egress' ? capability : fallbackCapability
    const baseReceipt = {
      operation: 'egress' as const,
      capabilityId: auditCapability.id,
      destination: auditCapability.destination,
      atMs: nowMs,
      idempotencyKeyHash: socialHash(runtimeIntent.idempotencyKey),
      scopeStates: capabilityScopeStates(auditCapability, this.#status)
    }

    if (
      !Number.isFinite(runtimeIntent.createdAtMs) ||
      !Number.isFinite(runtimeIntent.deadlineMs)
    ) {
      return this.#actionDenied(baseReceipt, 'validation.non_finite_time')
    }
    if (!Number.isSafeInteger(runtimeIntent.consentEpoch) || runtimeIntent.consentEpoch < 0) {
      return this.#actionDenied(baseReceipt, 'validation.invalid_consent_epoch')
    }
    if (
      runtimeIntent.schema !== SOCIAL_CONNECTOR_SCHEMA ||
      runtimeIntent.contractVersion !== SOCIAL_CONNECTOR_CONTRACT_VERSION ||
      runtimeIntent.provider !== this.manifest.provider ||
      !capability ||
      capability.direction !== 'egress' ||
      runtimeIntent.destination !== capability.destination
    ) {
      return this.#actionDenied(baseReceipt, 'capability.unsupported')
    }
    if (
      runtimeIntent.sourceProvider !== undefined &&
      !isSocialProvider(runtimeIntent.sourceProvider)
    ) {
      return this.#actionDenied(baseReceipt, 'validation.malformed_intent')
    }

    const actor = runtimeSocialActor(runtimeIntent.actor)
    const verifiedActor = runtimeSocialActor(authenticatedActor)
    if (!actor || !verifiedActor) {
      return this.#actionDenied(baseReceipt, 'actor.invalid')
    }
    const actorReceipt = {
      ...baseReceipt,
      actorRole: actor.role,
      actorRefHash: socialHash(actor.actorRef)
    }
    if (!sameSocialActor(actor, verifiedActor)) {
      return this.#actionDenied(actorReceipt, 'actor.authenticated_mismatch')
    }

    const payload = sanitizeSocialJsonRecord(runtimeIntent.payload)
    if (!payload) {
      return this.#actionDenied(actorReceipt, 'validation.malformed_payload')
    }
    if (findCredentialMaterial(payload, { provider: this.manifest.provider })) {
      return this.#actionDenied(actorReceipt, 'payload.credential_material')
    }
    const payloadFailure = capabilityPayloadFailure(capability, payload)
    if (payloadFailure) return this.#actionDenied(actorReceipt, payloadFailure)

    const payloadHash = socialHash(payload)
    const normalizedIntent: SocialActionIntentV1 = {
      schema: SOCIAL_CONNECTOR_SCHEMA,
      contractVersion: SOCIAL_CONNECTOR_CONTRACT_VERSION,
      intentId: runtimeIntent.intentId,
      provider: this.manifest.provider,
      capabilityId: capability.id,
      destination: capability.destination,
      actor,
      idempotencyKey: runtimeIntent.idempotencyKey,
      sourceProvider: runtimeIntent.sourceProvider as SocialProvider | undefined,
      payload,
      enqueuedPolicy: runtimeIntent.enqueuedPolicy,
      consentEpoch: runtimeIntent.consentEpoch,
      approvalRef: runtimeIntent.approvalRef,
      createdAtMs: runtimeIntent.createdAtMs,
      deadlineMs: runtimeIntent.deadlineMs
    }
    const requestFingerprint = socialHash({
      schema: normalizedIntent.schema,
      contractVersion: normalizedIntent.contractVersion,
      intentId: normalizedIntent.intentId,
      provider: normalizedIntent.provider,
      capabilityId: normalizedIntent.capabilityId,
      destination: normalizedIntent.destination,
      actor: normalizedIntent.actor,
      idempotencyKey: normalizedIntent.idempotencyKey,
      sourceProvider: normalizedIntent.sourceProvider ?? null,
      payloadHash,
      enqueuedPolicy: normalizedIntent.enqueuedPolicy ?? null,
      consentEpoch: normalizedIntent.consentEpoch,
      createdAtMs: normalizedIntent.createdAtMs,
      deadlineMs: normalizedIntent.deadlineMs
    })
    const fingerprintedReceipt = {
      ...actorReceipt,
      payloadHash,
      requestFingerprint
    }
    const actionKey = `${normalizedIntent.provider}:${normalizedIntent.idempotencyKey}`
    const existing = this.#actions.get(actionKey)
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        return this.#actionDenied(fingerprintedReceipt, 'idempotency.mismatch')
      }
      const receipt = this.#recordReceipt({
        ...fingerprintedReceipt,
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

    if (
      nowMs > normalizedIntent.deadlineMs ||
      normalizedIntent.deadlineMs <= normalizedIntent.createdAtMs
    ) {
      return this.#actionDenied(fingerprintedReceipt, 'intent.expired')
    }

    const policyFailure = this.#policyFailure(normalizedIntent, capability, nowMs)
    if (policyFailure) return this.#actionDenied(fingerprintedReceipt, policyFailure)

    const accessFailure = this.#capabilityAccessFailure(capability)
    if (accessFailure) return this.#actionDenied(fingerprintedReceipt, accessFailure)
    const consentFailure = this.#consentFailure(normalizedIntent, capability, nowMs)
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
      if (!normalizedIntent.approvalRef) {
        return this.#actionDenied(
          { ...fingerprintedReceipt, quotaBefore, quotaAfter: quotaBefore },
          'approval.missing'
        )
      }
      const approval = this.#approvalQueue.consume({
        approvalRef: normalizedIntent.approvalRef,
        provider: normalizedIntent.provider,
        capabilityId: normalizedIntent.capabilityId,
        destination: normalizedIntent.destination,
        authenticatedActor: verifiedActor,
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

    if (
      findCredentialMaterial(normalizedIntent.payload, {
        provider: normalizedIntent.provider
      })
    ) {
      return this.#actionDenied(
        {
          ...fingerprintedReceipt,
          quotaBefore,
          quotaAfter: quotaBefore,
          approvalRef
        },
        'payload.credential_material'
      )
    }

    rateWindow.used += 1
    this.#status.quota.remaining = Math.max(
      0,
      quotaBefore - rateLimit.quotaCost
    )
    this.#status.quota.state =
      this.#status.quota.remaining > 0 ? 'available' : 'exhausted'
    this.#refreshLifecycle()

    const mockProviderRef = `mock:${normalizedIntent.provider}:${socialHash({
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
    this.#refreshPolicyState(nowMs)
    if (!policy || this.#status.policyState === 'missing') return 'policy.missing'
    if (this.#status.policyState !== 'current') return 'policy.stale'
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
    this.#refreshConsentState(nowMs)
    if (this.#status.consent.state !== 'granted') {
      return `consent.${this.#status.consent.state}`
    }
    if (intent.consentEpoch !== this.#status.consent.epoch) return 'consent.epoch_mismatch'
    return null
  }

  #refreshQuota(nowMs: number): number {
    if (nowMs >= this.#status.quota.resetAtMs && this.#status.quota.limit >= 0) {
      this.#status.quota.remaining = this.#status.quota.limit
      this.#status.quota.resetAtMs = nowMs + 60 * 60 * 1000
    }
    this.#status.quota.state =
      this.#status.quota.remaining > 0 ? 'available' : 'exhausted'
    return this.#status.quota.remaining
  }

  #refreshPolicyState(nowMs: number): void {
    const policy = this.#policy
    if (!policy) {
      this.#status.policyState = 'missing'
      return
    }
    this.#status.policyState =
      policy.schema !== SOCIAL_POLICY_SCHEMA ||
      policy.contractVersion !== SOCIAL_CONNECTOR_CONTRACT_VERSION ||
      policy.provider !== this.manifest.provider ||
      (policy.provider === 'twitch' && policy.twitchMergedChatOutput !== 'block') ||
      nowMs < policy.validFromMs ||
      nowMs >= policy.validUntilMs
        ? 'stale'
        : 'current'
  }

  #refreshConsentState(nowMs: number): void {
    this.#status.consent = { ...this.#consentAuthority }
    if (
      this.#status.consent.state === 'granted' &&
      nowMs >= this.#status.consent.expiresAtMs
    ) {
      this.#status.consent.state = 'expired'
    }
  }

  #refreshAuthorityState(nowMs: number): void {
    this.#refreshPolicyState(nowMs)
    this.#refreshConsentState(nowMs)
    this.#refreshQuota(nowMs)
    this.#refreshLifecycle()
    this.#status.updatedAtMs = nowMs
  }

  #auditCapability(direction: 'ingress' | 'egress'): SocialCapabilityV1 {
    const capability = this.manifest.capabilities.find((entry) => entry.direction === direction)
    if (!capability) throw new Error(`Missing ${direction} audit capability`)
    return capability
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
      this.manifest.capabilities.some(
        (capability) =>
          capability.requiredScopes.some(
            (scope) => this.#status.scopes[scope] !== 'granted'
          ) ||
          this.#status.entitlements[capability.entitlementKey] !== 'eligible' ||
          (capability.review === 'required' &&
            this.#status.reviews[capability.id] !== 'approved')
      )
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

  #storeWebhookDelivery(
    key: string,
    contentFingerprint: string,
    receiptId: string,
    nowMs: number
  ): void {
    if (
      !this.#webhookDeliveries.has(key) &&
      this.#webhookDeliveries.size >= this.#storageLimits.maxWebhookDeliveries
    ) {
      throw new Error('Webhook replay storage capacity exceeded')
    }
    this.#webhookDeliveries.set(key, {
      contentFingerprint,
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
    eventFingerprint: string,
    event: SocialInboundEventV1,
    receiptId: string,
    nowMs: number
  ): void {
    if (!this.#events.has(key) && this.#events.size >= this.#storageLimits.maxEvents) {
      throw new Error('Event dedupe storage capacity exceeded')
    }
    this.#events.set(key, {
      eventFingerprint,
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
