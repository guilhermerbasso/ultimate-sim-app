import type { SocialActorRole, SocialActorV1 } from '../../shared/social-connectors'

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/
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

export function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be finite`)
  }
}

export function assertFiniteTimestamp(value: unknown, label: string): asserts value is number {
  assertFiniteNumber(value, label)
}

export function assertNonNegativeFinite(value: unknown, label: string): asserts value is number {
  assertFiniteNumber(value, label)
  if (value < 0) throw new Error(`${label} must be non-negative`)
}

export function assertPositiveFinite(value: unknown, label: string): asserts value is number {
  assertFiniteNumber(value, label)
  if (value <= 0) throw new Error(`${label} must be positive`)
}

export function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  assertPositiveFinite(value, label)
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`)
}

export function assertNonNegativeSafeInteger(
  value: unknown,
  label: string
): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`)
  }
}

export function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
}

export function assertCanonicalSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a canonical sha256 hash`)
  }
}

export function assertSocialActor(value: unknown, label: string): asserts value is SocialActorV1 {
  if (!value || typeof value !== 'object') throw new Error(`${label} must be an actor`)
  const actor = value as Partial<SocialActorV1>
  assertNonEmptyString(actor.actorRef, `${label}.actorRef`)
  assertNonEmptyString(actor.role, `${label}.role`)
  if (!SOCIAL_ACTOR_ROLES.has(actor.role as SocialActorRole)) {
    throw new Error(`${label}.role must be a valid social actor role`)
  }
}

export function sameSocialActor(left: SocialActorV1, right: SocialActorV1): boolean {
  return left.actorRef === right.actorRef && left.role === right.role
}
