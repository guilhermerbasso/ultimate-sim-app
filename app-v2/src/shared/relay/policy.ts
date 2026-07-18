import {
  RELAY_CAPABILITIES,
  RELAY_CRYPTO_PROFILES,
  RELAY_DATA_CLASSES,
  RELAY_DOCUMENT_KINDS,
  RELAY_EVENT_KINDS,
  RELAY_PROVIDER_CONTRACT,
  RELAY_SCHEMA_VERSION,
  type RelayAdmissionReceipt,
  type RelayCapability,
  type RelayDataClass,
  type RelayDocumentDraft,
  type RelayDocumentKind,
  type RelayEventKind,
  type RelayRejectionCode,
  type RelaySyncEnvelope
} from './contracts'

const DATA_CLASS_RANK: Record<RelayDataClass, number> = {
  D0: 0,
  D1: 1,
  D2: 2,
  D3: 3,
  D4: 4,
  D5: 5
}

const FORBIDDEN_FIELD_NAMES = new Set([
  'biometric',
  'biometrics',
  'accesstoken',
  'apikey',
  'authorization',
  'brake',
  'command',
  'commands',
  'cookie',
  'cookies',
  'clientsecret',
  'displayid',
  'evidenceledger',
  'machineconfig',
  'machineid',
  'oauth',
  'password',
  'privatekey',
  'raceopsevent',
  'rawtelemetry',
  'refreshtoken',
  'secret',
  'secrets',
  'serialport',
  'sessioncookie',
  'steering',
  'streamkey',
  'telemetry',
  'throttle',
  'token',
  'tokens',
  'videoraw',
  'voiceraw',
  'webhookurl'
])

interface RelayDocumentPolicy {
  maxDataClass: RelayDataClass
  requiresExplicitConsent: boolean
  payloadFields: readonly string[]
}

export const RELAY_DOCUMENT_POLICY: Readonly<Record<RelayDocumentKind, RelayDocumentPolicy>> = Object.freeze({
  'dashboard-layout': {
    maxDataClass: 'D2',
    requiresExplicitConsent: false,
    payloadFields: ['layout', 'name', 'revision', 'widgets']
  },
  'race-note': {
    maxDataClass: 'D3',
    requiresExplicitConsent: true,
    payloadFields: ['authorAlias', 'body', 'revision', 'tags', 'title']
  },
  'accessibility-profile': {
    maxDataClass: 'D3',
    requiresExplicitConsent: true,
    payloadFields: ['contrast', 'cues', 'haptics', 'name', 'revision']
  },
  'raceops-blueprint': {
    maxDataClass: 'D3',
    requiresExplicitConsent: true,
    payloadFields: ['annotations', 'checklist', 'name', 'revision', 'roles']
  },
  'shared-preferences': {
    maxDataClass: 'D2',
    requiresExplicitConsent: false,
    payloadFields: ['name', 'revision', 'settings']
  }
})

export const RELAY_EVENT_PAYLOAD_FIELDS: Readonly<Record<RelayEventKind, readonly string[]>> = Object.freeze({
  'document-change': ['baseHeads', 'changeId', 'operations'],
  'document-snapshot': ['document', 'heads', 'snapshotId'],
  'membership-record': ['action', 'capabilities', 'memberDeviceId', 'membershipEpoch'],
  'key-status-record': ['effectiveAt', 'keyId', 'reason', 'status'],
  'rotation-certificate': ['certificate'],
  'resync-marker': ['cursor', 'heads', 'providerGeneration']
})

const REQUIRED_CAPABILITY: Readonly<Record<RelayEventKind, RelayCapability>> = Object.freeze({
  'document-change': 'document:append',
  'document-snapshot': 'document:snapshot',
  'membership-record': 'membership:admin',
  'key-status-record': 'keys:rotate',
  'rotation-certificate': 'keys:rotate',
  'resync-marker': 'document:append'
})

const DRAFT_KEYS = [
  'tenantId',
  'documentId',
  'documentKind',
  'eventKind',
  'dataClass',
  'payload',
  'parentRefs',
  'headRefs'
] as const

const ENVELOPE_KEYS = [
  'schemaVersion',
  'providerContract',
  'envelopeId',
  'tenantId',
  'documentId',
  'documentKind',
  'eventKind',
  'dataClass',
  'identity',
  'capability',
  'keyEnvelopes',
  'membershipEpoch',
  'keyEpoch',
  'senderDeviceId',
  'senderSigningKeyId',
  'replayCounter',
  'parentRefs',
  'headRefs',
  'ciphertext',
  'ciphertextBytes',
  'ciphertextHash',
  'keyEnvelopesHash',
  'cryptoProfile',
  'createdAt',
  'expiresAt',
  'signature'
] as const

const IDENTITY_KEYS = [
  'schemaVersion',
  'tenantId',
  'subjectId',
  'deviceId',
  'identityEpoch',
  'signingKeyId',
  'signingPublicKey',
  'encryptionKeyId',
  'encryptionPublicKey',
  'issuedAt',
  'expiresAt',
  'status',
  'issuerKeyId',
  'signature'
] as const

const CAPABILITY_KEYS = [
  'schemaVersion',
  'grantId',
  'tenantId',
  'subjectId',
  'deviceId',
  'documentIds',
  'documentKinds',
  'eventKinds',
  'capabilities',
  'maxDataClass',
  'consentEpoch',
  'membershipEpoch',
  'issuedAt',
  'expiresAt',
  'issuerKeyId',
  'signature'
] as const

const KEY_ENVELOPE_KEYS = [
  'schemaVersion',
  'documentId',
  'keyEpoch',
  'recipientKeyId',
  'wrappingAlgorithm',
  'wrappedDocumentKey'
] as const

const ADMISSION_RECEIPT_KEYS = [
  'schemaVersion',
  'providerContract',
  'receiptId',
  'envelopeId',
  'envelopeDigest',
  'tenantId',
  'documentId',
  'senderDeviceId',
  'senderSigningKeyId',
  'admittedAt',
  'policy',
  'quota',
  'issuerKeyId',
  'signature'
] as const

const ADMISSION_POLICY_KEYS = [
  'identityEpoch',
  'capabilityGrantId',
  'capabilityDigest',
  'membershipEpoch',
  'keyEpoch',
  'documentConsentEpoch',
  'capabilityConsentEpoch',
  'requiredCapability',
  'replayCounter',
  'priorReplayCounter',
  'identityActive',
  'memberAtAdmission',
  'consentGrantedAtAdmission'
] as const

const ADMISSION_QUOTA_KEYS = [
  'limits',
  'limitsDigest',
  'usageBefore',
  'usageAfter',
  'envelopeBytes',
  'referenceCount',
  'referenceBytes'
] as const

const QUOTA_POLICY_KEYS = [
  'maxObjectsPerTenant',
  'maxObjectsPerDevice',
  'maxObjectsPerDocument',
  'maxStoredBytesPerTenant',
  'maxEnvelopeBytes',
  'maxReferenceCount',
  'maxReferenceBytes',
  'maxOfflineQueueItems',
  'maxOfflineQueueBytes'
] as const

const QUOTA_USAGE_KEYS = [
  'tenantObjects',
  'deviceObjects',
  'documentObjects',
  'tenantStoredBytes'
] as const

export class RelayPolicyError extends Error {
  readonly code: RelayRejectionCode
  readonly path: string

  constructor(code: RelayRejectionCode, message: string, path = '$') {
    super(message)
    this.name = 'RelayPolicyError'
    this.code = code
    this.path = path
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertRecord(
  value: unknown,
  path: string,
  code: RelayRejectionCode = 'undeclared-field'
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new RelayPolicyError(code, `${path} must be an object.`, path)
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  code: RelayRejectionCode = 'undeclared-field'
): void {
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      throw new RelayPolicyError(code, `${path}.${key} is not declared by relay contract v1.`, `${path}.${key}`)
    }
  }
  for (const key of allowed) {
    if (!(key in value)) {
      throw new RelayPolicyError(code, `${path}.${key} is required by relay contract v1.`, `${path}.${key}`)
    }
  }
}

function assertNoExtraKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      throw new RelayPolicyError('undeclared-field', `${path}.${key} is not allowlisted for this relay content type.`, `${path}.${key}`)
    }
  }
}

function assertString(
  value: unknown,
  path: string,
  code: RelayRejectionCode = 'undeclared-field'
): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RelayPolicyError(code, `${path} must be a non-empty string.`, path)
  }
}

function assertInteger(
  value: unknown,
  path: string,
  minimum = 0,
  code: RelayRejectionCode = 'undeclared-field'
): asserts value is number {
  if (!Number.isInteger(value) || Number(value) < minimum) {
    throw new RelayPolicyError(code, `${path} must be an integer >= ${minimum}.`, path)
  }
}

function assertBoolean(
  value: unknown,
  path: string,
  code: RelayRejectionCode = 'undeclared-field'
): asserts value is boolean {
  if (typeof value !== 'boolean') {
    throw new RelayPolicyError(code, `${path} must be a boolean.`, path)
  }
}

function assertStringArray(value: unknown, path: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    throw new RelayPolicyError('undeclared-field', `${path} must be an array of non-empty strings.`, path)
  }
}

function assertKnownValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  code: RelayRejectionCode,
  path: string
): asserts value is T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new RelayPolicyError(code, `${path} is not supported by relay contract v1.`, path)
  }
}

function assertNoForbiddenFields(value: unknown, path: string, visited = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RelayPolicyError('undeclared-field', `${path} must contain finite JSON numbers.`, path)
    }
    return
  }
  if (typeof value !== 'object') {
    throw new RelayPolicyError('undeclared-field', `${path} must contain JSON-safe values only.`, path)
  }
  if (visited.has(value)) throw new RelayPolicyError('undeclared-field', `${path} contains a cycle.`, path)
  visited.add(value)

  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenFields(entry, `${path}[${index}]`, visited))
    visited.delete(value)
    return
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new RelayPolicyError('undeclared-field', `${path} must contain plain JSON objects only.`, path)
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
    if (FORBIDDEN_FIELD_NAMES.has(normalized)) {
      throw new RelayPolicyError('data-class-denied', `${path}.${key} is prohibited from relay documents/events.`, `${path}.${key}`)
    }
    assertNoForbiddenFields(entry, `${path}.${key}`, visited)
  }
  visited.delete(value)
}

export function isDataClassAtMost(value: RelayDataClass, maximum: RelayDataClass): boolean {
  return DATA_CLASS_RANK[value] <= DATA_CLASS_RANK[maximum]
}

export function requiredCapabilityForEvent(eventKind: RelayEventKind): RelayCapability {
  return REQUIRED_CAPABILITY[eventKind]
}

export function validateRelayDraft(value: unknown): RelayDocumentDraft {
  assertRecord(value, '$')
  assertExactKeys(value, DRAFT_KEYS, '$')
  assertString(value.tenantId, '$.tenantId')
  assertString(value.documentId, '$.documentId')
  assertKnownValue(value.documentKind, RELAY_DOCUMENT_KINDS, 'unsupported-document-kind', '$.documentKind')
  assertKnownValue(value.eventKind, RELAY_EVENT_KINDS, 'unsupported-event-kind', '$.eventKind')
  assertKnownValue(value.dataClass, RELAY_DATA_CLASSES, 'data-class-denied', '$.dataClass')
  assertRecord(value.payload, '$.payload')
  assertStringArray(value.parentRefs, '$.parentRefs')
  assertStringArray(value.headRefs, '$.headRefs')

  const documentPolicy = RELAY_DOCUMENT_POLICY[value.documentKind]
  if (!isDataClassAtMost(value.dataClass, documentPolicy.maxDataClass) || value.dataClass === 'D4' || value.dataClass === 'D5') {
    throw new RelayPolicyError(
      'data-class-denied',
      `${value.documentKind} permits at most ${documentPolicy.maxDataClass}; D4/D5 never enter relay content.`,
      '$.dataClass'
    )
  }

  const allowedPayloadFields = new Set([
    ...documentPolicy.payloadFields,
    ...RELAY_EVENT_PAYLOAD_FIELDS[value.eventKind]
  ])
  assertNoExtraKeys(value.payload, [...allowedPayloadFields], '$.payload')
  assertNoForbiddenFields(value.payload, '$.payload')

  return value as unknown as RelayDocumentDraft
}

export function assertRelayEnvelopeShape(value: unknown): asserts value is RelaySyncEnvelope {
  assertRecord(value, '$')
  assertExactKeys(value, ENVELOPE_KEYS, '$')
  assertRecord(value.identity, '$.identity')
  assertExactKeys(value.identity, IDENTITY_KEYS, '$.identity')
  assertRecord(value.capability, '$.capability')
  assertExactKeys(value.capability, CAPABILITY_KEYS, '$.capability')
  if (!Array.isArray(value.keyEnvelopes) || value.keyEnvelopes.length === 0) {
    throw new RelayPolicyError('stale-key', '$.keyEnvelopes must contain at least one member key envelope.')
  }
  value.keyEnvelopes.forEach((entry, index) => {
    assertRecord(entry, `$.keyEnvelopes[${index}]`)
    assertExactKeys(entry, KEY_ENVELOPE_KEYS, `$.keyEnvelopes[${index}]`)
  })

  if (value.schemaVersion !== RELAY_SCHEMA_VERSION || value.providerContract !== RELAY_PROVIDER_CONTRACT) {
    throw new RelayPolicyError('identity-invalid', 'Relay schema/provider contract version is unsupported.')
  }
  assertString(value.envelopeId, '$.envelopeId')
  assertString(value.tenantId, '$.tenantId')
  assertString(value.documentId, '$.documentId')
  assertKnownValue(value.documentKind, RELAY_DOCUMENT_KINDS, 'unsupported-document-kind', '$.documentKind')
  assertKnownValue(value.eventKind, RELAY_EVENT_KINDS, 'unsupported-event-kind', '$.eventKind')
  assertKnownValue(value.dataClass, RELAY_DATA_CLASSES, 'data-class-denied', '$.dataClass')
  assertInteger(value.membershipEpoch, '$.membershipEpoch', 1)
  assertInteger(value.keyEpoch, '$.keyEpoch', 1)
  assertInteger(value.replayCounter, '$.replayCounter', 1)
  assertInteger(value.createdAt, '$.createdAt', 0)
  assertInteger(value.expiresAt, '$.expiresAt', 1)
  assertInteger(value.ciphertextBytes, '$.ciphertextBytes', 1)
  assertStringArray(value.parentRefs, '$.parentRefs')
  assertStringArray(value.headRefs, '$.headRefs')
  assertString(value.senderDeviceId, '$.senderDeviceId')
  assertString(value.senderSigningKeyId, '$.senderSigningKeyId')
  assertString(value.ciphertext, '$.ciphertext')
  assertString(value.ciphertextHash, '$.ciphertextHash')
  assertString(value.keyEnvelopesHash, '$.keyEnvelopesHash')
  assertKnownValue(value.cryptoProfile, RELAY_CRYPTO_PROFILES, 'identity-invalid', '$.cryptoProfile')
  assertString(value.signature, '$.signature')

  if (value.identity.schemaVersion !== RELAY_SCHEMA_VERSION || value.capability.schemaVersion !== RELAY_SCHEMA_VERSION ||
      value.keyEnvelopes.some((entry) => entry.schemaVersion !== RELAY_SCHEMA_VERSION)) {
    throw new RelayPolicyError('identity-invalid', 'Nested relay envelope schema version is unsupported.')
  }
  assertString(value.identity.tenantId, '$.identity.tenantId')
  assertString(value.identity.subjectId, '$.identity.subjectId')
  assertString(value.identity.deviceId, '$.identity.deviceId')
  assertInteger(value.identity.identityEpoch, '$.identity.identityEpoch', 1)
  assertString(value.identity.signingKeyId, '$.identity.signingKeyId')
  assertString(value.identity.signingPublicKey, '$.identity.signingPublicKey')
  assertString(value.identity.encryptionKeyId, '$.identity.encryptionKeyId')
  assertString(value.identity.encryptionPublicKey, '$.identity.encryptionPublicKey')
  assertInteger(value.identity.issuedAt, '$.identity.issuedAt', 0)
  assertInteger(value.identity.expiresAt, '$.identity.expiresAt', 1)
  assertKnownValue(value.identity.status, ['active', 'revoked'], 'identity-invalid', '$.identity.status')
  assertString(value.identity.issuerKeyId, '$.identity.issuerKeyId')
  assertString(value.identity.signature, '$.identity.signature')

  assertString(value.capability.grantId, '$.capability.grantId')
  assertString(value.capability.tenantId, '$.capability.tenantId')
  assertString(value.capability.subjectId, '$.capability.subjectId')
  assertString(value.capability.deviceId, '$.capability.deviceId')
  assertStringArray(value.capability.documentIds, '$.capability.documentIds')
  if (!Array.isArray(value.capability.documentKinds)) {
    throw new RelayPolicyError('capability-denied', '$.capability.documentKinds must be an array.')
  }
  value.capability.documentKinds.forEach((entry, index) =>
    assertKnownValue(entry, RELAY_DOCUMENT_KINDS, 'capability-denied', `$.capability.documentKinds[${index}]`))
  if (!Array.isArray(value.capability.eventKinds)) {
    throw new RelayPolicyError('capability-denied', '$.capability.eventKinds must be an array.')
  }
  value.capability.eventKinds.forEach((entry, index) =>
    assertKnownValue(entry, RELAY_EVENT_KINDS, 'capability-denied', `$.capability.eventKinds[${index}]`))
  if (!Array.isArray(value.capability.capabilities)) {
    throw new RelayPolicyError('capability-denied', '$.capability.capabilities must be an array.')
  }
  value.capability.capabilities.forEach((entry, index) =>
    assertKnownValue(entry, RELAY_CAPABILITIES, 'capability-denied', `$.capability.capabilities[${index}]`))
  assertKnownValue(value.capability.maxDataClass, RELAY_DATA_CLASSES, 'capability-denied', '$.capability.maxDataClass')
  assertInteger(value.capability.consentEpoch, '$.capability.consentEpoch', 0)
  assertInteger(value.capability.membershipEpoch, '$.capability.membershipEpoch', 1)
  assertInteger(value.capability.issuedAt, '$.capability.issuedAt', 0)
  assertInteger(value.capability.expiresAt, '$.capability.expiresAt', 1)
  assertString(value.capability.issuerKeyId, '$.capability.issuerKeyId')
  assertString(value.capability.signature, '$.capability.signature')

  value.keyEnvelopes.forEach((entry, index) => {
    assertString(entry.documentId, `$.keyEnvelopes[${index}].documentId`)
    assertInteger(entry.keyEpoch, `$.keyEnvelopes[${index}].keyEpoch`, 1)
    assertString(entry.recipientKeyId, `$.keyEnvelopes[${index}].recipientKeyId`)
    assertKnownValue(
      entry.wrappingAlgorithm,
      ['x25519-hkdf-sha256', 'deterministic-test-only'],
      'stale-key',
      `$.keyEnvelopes[${index}].wrappingAlgorithm`
    )
    assertString(entry.wrappedDocumentKey, `$.keyEnvelopes[${index}].wrappedDocumentKey`)
  })
}

export function assertRelayAdmissionReceiptShape(value: unknown): asserts value is RelayAdmissionReceipt {
  const code: RelayRejectionCode = 'admission-proof-invalid'
  assertRecord(value, '$.admission', code)
  assertExactKeys(value, ADMISSION_RECEIPT_KEYS, '$.admission', code)
  assertRecord(value.policy, '$.admission.policy', code)
  assertExactKeys(value.policy, ADMISSION_POLICY_KEYS, '$.admission.policy', code)
  assertRecord(value.quota, '$.admission.quota', code)
  assertExactKeys(value.quota, ADMISSION_QUOTA_KEYS, '$.admission.quota', code)
  assertRecord(value.quota.limits, '$.admission.quota.limits', code)
  assertExactKeys(value.quota.limits, QUOTA_POLICY_KEYS, '$.admission.quota.limits', code)
  assertRecord(value.quota.usageBefore, '$.admission.quota.usageBefore', code)
  assertExactKeys(value.quota.usageBefore, QUOTA_USAGE_KEYS, '$.admission.quota.usageBefore', code)
  assertRecord(value.quota.usageAfter, '$.admission.quota.usageAfter', code)
  assertExactKeys(value.quota.usageAfter, QUOTA_USAGE_KEYS, '$.admission.quota.usageAfter', code)

  if (value.schemaVersion !== RELAY_SCHEMA_VERSION || value.providerContract !== RELAY_PROVIDER_CONTRACT) {
    throw new RelayPolicyError(code, 'Admission receipt schema/provider contract version is unsupported.')
  }
  assertString(value.receiptId, '$.admission.receiptId', code)
  assertString(value.envelopeId, '$.admission.envelopeId', code)
  assertString(value.envelopeDigest, '$.admission.envelopeDigest', code)
  assertString(value.tenantId, '$.admission.tenantId', code)
  assertString(value.documentId, '$.admission.documentId', code)
  assertString(value.senderDeviceId, '$.admission.senderDeviceId', code)
  assertString(value.senderSigningKeyId, '$.admission.senderSigningKeyId', code)
  assertInteger(value.admittedAt, '$.admission.admittedAt', 0, code)
  assertString(value.issuerKeyId, '$.admission.issuerKeyId', code)
  assertString(value.signature, '$.admission.signature', code)

  assertInteger(value.policy.identityEpoch, '$.admission.policy.identityEpoch', 1, code)
  assertString(value.policy.capabilityGrantId, '$.admission.policy.capabilityGrantId', code)
  assertString(value.policy.capabilityDigest, '$.admission.policy.capabilityDigest', code)
  assertInteger(value.policy.membershipEpoch, '$.admission.policy.membershipEpoch', 1, code)
  assertInteger(value.policy.keyEpoch, '$.admission.policy.keyEpoch', 1, code)
  assertInteger(value.policy.documentConsentEpoch, '$.admission.policy.documentConsentEpoch', 1, code)
  assertInteger(value.policy.capabilityConsentEpoch, '$.admission.policy.capabilityConsentEpoch', 0, code)
  assertKnownValue(
    value.policy.requiredCapability,
    RELAY_CAPABILITIES,
    code,
    '$.admission.policy.requiredCapability'
  )
  assertInteger(value.policy.replayCounter, '$.admission.policy.replayCounter', 1, code)
  assertInteger(value.policy.priorReplayCounter, '$.admission.policy.priorReplayCounter', 0, code)
  assertBoolean(value.policy.identityActive, '$.admission.policy.identityActive', code)
  assertBoolean(value.policy.memberAtAdmission, '$.admission.policy.memberAtAdmission', code)
  assertBoolean(value.policy.consentGrantedAtAdmission, '$.admission.policy.consentGrantedAtAdmission', code)

  for (const key of QUOTA_POLICY_KEYS) {
    assertInteger(value.quota.limits[key], `$.admission.quota.limits.${key}`, 0, code)
  }
  assertString(value.quota.limitsDigest, '$.admission.quota.limitsDigest', code)
  for (const key of QUOTA_USAGE_KEYS) {
    assertInteger(value.quota.usageBefore[key], `$.admission.quota.usageBefore.${key}`, 0, code)
    assertInteger(value.quota.usageAfter[key], `$.admission.quota.usageAfter.${key}`, 0, code)
  }
  assertInteger(value.quota.envelopeBytes, '$.admission.quota.envelopeBytes', 1, code)
  assertInteger(value.quota.referenceCount, '$.admission.quota.referenceCount', 0, code)
  assertInteger(value.quota.referenceBytes, '$.admission.quota.referenceBytes', 0, code)
}

export function validateEnvelopeDataPolicy(envelope: RelaySyncEnvelope): void {
  const policy = RELAY_DOCUMENT_POLICY[envelope.documentKind]
  if (!isDataClassAtMost(envelope.dataClass, policy.maxDataClass) ||
      !isDataClassAtMost(envelope.dataClass, envelope.capability.maxDataClass) ||
      envelope.capability.maxDataClass === 'D4' ||
      envelope.capability.maxDataClass === 'D5' ||
      envelope.dataClass === 'D4' ||
      envelope.dataClass === 'D5') {
    throw new RelayPolicyError('data-class-denied', 'Envelope data class exceeds the document or capability policy.')
  }
  if (policy.requiresExplicitConsent && envelope.dataClass === 'D3' && envelope.capability.consentEpoch < 1) {
    throw new RelayPolicyError('consent-required', 'D3 relay content requires an explicit current consent epoch.')
  }
  if (!envelope.capability.documentIds.includes(envelope.documentId) ||
      !envelope.capability.documentKinds.includes(envelope.documentKind) ||
      !envelope.capability.eventKinds.includes(envelope.eventKind) ||
      !envelope.capability.capabilities.includes(requiredCapabilityForEvent(envelope.eventKind))) {
    throw new RelayPolicyError('capability-denied', 'Capability envelope does not authorize this document/event operation.')
  }
}
