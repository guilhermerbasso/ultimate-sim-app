import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  SOCIAL_CONNECTOR_CONTRACT_VERSION,
  SOCIAL_WEBHOOK_FIXTURE_SCHEMA,
  type MockWebhookFixtureV1,
  type SocialCapabilityId,
  type SocialProvider
} from '../../shared/social-connectors'
import { assertFiniteTimestamp, assertNonEmptyString } from './validation'

export interface UnsignedMockWebhookFixtureV1 {
  readonly provider: SocialProvider
  readonly capabilityId: SocialCapabilityId
  readonly deliveryId: string
  readonly eventId: string
  readonly occurredAtMs: number
  readonly body: string
}

function lengthPrefixedTuple(values: readonly string[]): Buffer {
  const encoded: Buffer[] = []
  for (const value of values) {
    const bytes = Buffer.from(value, 'utf8')
    if (bytes.length > 0xffff_ffff) throw new Error('Webhook fixture field is too large')
    const length = Buffer.allocUnsafe(4)
    length.writeUInt32BE(bytes.length)
    encoded.push(length, bytes)
  }
  return Buffer.concat(encoded)
}

function fixtureSignatureMessage(fixture: MockWebhookFixtureV1): Buffer {
  return lengthPrefixedTuple([
    fixture.schema,
    fixture.contractVersion,
    fixture.algorithm,
    fixture.keyId,
    fixture.provider,
    fixture.capabilityId,
    fixture.deliveryId,
    fixture.eventId,
    String(fixture.occurredAtMs),
    fixture.body
  ])
}

function fixtureSignature(
  fixture: MockWebhookFixtureV1,
  fixtureKeyMaterial: string
): string {
  return `sha256=${createHmac('sha256', fixtureKeyMaterial)
    .update(fixtureSignatureMessage(fixture))
    .digest('hex')}`
}

export function createSignedMockWebhookFixture(
  fixture: UnsignedMockWebhookFixtureV1,
  keyId: string,
  fixtureKeyMaterial: string
): MockWebhookFixtureV1 {
  assertFiniteTimestamp(fixture.occurredAtMs, 'webhook.occurredAtMs')
  assertNonEmptyString(keyId, 'webhook.keyId')
  assertNonEmptyString(fixtureKeyMaterial, 'webhook.fixtureKeyMaterial')
  const signedFixture: MockWebhookFixtureV1 = {
    schema: SOCIAL_WEBHOOK_FIXTURE_SCHEMA,
    contractVersion: SOCIAL_CONNECTOR_CONTRACT_VERSION,
    ...fixture,
    keyId,
    algorithm: 'fixture-hmac-sha256-v1',
    signature: ''
  }
  return { ...signedFixture, signature: fixtureSignature(signedFixture, fixtureKeyMaterial) }
}

export function verifyMockWebhookFixtureSignature(
  fixture: MockWebhookFixtureV1,
  expectedKeyId: string,
  fixtureKeyMaterial: string
): boolean {
  if (!Number.isFinite(fixture.occurredAtMs)) return false
  if (
    fixture.schema !== SOCIAL_WEBHOOK_FIXTURE_SCHEMA ||
    fixture.contractVersion !== SOCIAL_CONNECTOR_CONTRACT_VERSION ||
    fixture.algorithm !== 'fixture-hmac-sha256-v1' ||
    fixture.keyId !== expectedKeyId
  ) {
    return false
  }

  const expectedSignature = fixtureSignature(fixture, fixtureKeyMaterial)
  if (fixture.signature.length !== expectedSignature.length) return false
  const expected = Buffer.from(expectedSignature)
  const actual = Buffer.from(fixture.signature)
  return timingSafeEqual(expected, actual)
}
