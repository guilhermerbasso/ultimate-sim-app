import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  SOCIAL_CONNECTOR_CONTRACT_VERSION,
  SOCIAL_WEBHOOK_FIXTURE_SCHEMA,
  type MockWebhookFixtureV1,
  type SocialCapabilityId,
  type SocialProvider
} from '../../shared/social-connectors'

export interface UnsignedMockWebhookFixtureV1 {
  readonly provider: SocialProvider
  readonly capabilityId: SocialCapabilityId
  readonly deliveryId: string
  readonly eventId: string
  readonly occurredAtMs: number
  readonly body: string
}

function fixtureSignatureMessage(
  fixture: Pick<
    MockWebhookFixtureV1,
    'provider' | 'capabilityId' | 'deliveryId' | 'eventId' | 'occurredAtMs' | 'body'
  >
): string {
  return [
    fixture.provider,
    fixture.capabilityId,
    fixture.deliveryId,
    fixture.eventId,
    String(fixture.occurredAtMs),
    fixture.body
  ].join('\n')
}

function fixtureSignature(
  fixture: Pick<
    MockWebhookFixtureV1,
    'provider' | 'capabilityId' | 'deliveryId' | 'eventId' | 'occurredAtMs' | 'body'
  >,
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
  return {
    schema: SOCIAL_WEBHOOK_FIXTURE_SCHEMA,
    contractVersion: SOCIAL_CONNECTOR_CONTRACT_VERSION,
    ...fixture,
    keyId,
    algorithm: 'fixture-hmac-sha256-v1',
    signature: fixtureSignature(fixture, fixtureKeyMaterial)
  }
}

export function verifyMockWebhookFixtureSignature(
  fixture: MockWebhookFixtureV1,
  expectedKeyId: string,
  fixtureKeyMaterial: string
): boolean {
  if (
    fixture.schema !== SOCIAL_WEBHOOK_FIXTURE_SCHEMA ||
    fixture.contractVersion !== SOCIAL_CONNECTOR_CONTRACT_VERSION ||
    fixture.algorithm !== 'fixture-hmac-sha256-v1' ||
    fixture.keyId !== expectedKeyId
  ) {
    return false
  }

  const expected = Buffer.from(fixtureSignature(fixture, fixtureKeyMaterial))
  const actual = Buffer.from(fixture.signature)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
