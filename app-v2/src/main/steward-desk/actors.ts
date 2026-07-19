import type { StewardActor } from '../../shared/steward-desk'

interface ActorDisplayHint {
  actorDisplayName?: unknown
}

function trustedDisplayName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim()
  if (!normalized || normalized.length > 120 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) {
    return fallback
  }
  return normalized
}

export function trustedStewardActor(value: unknown): StewardActor {
  const hint = value && typeof value === 'object' ? value as ActorDisplayHint : {}
  return {
    id: 'local-steward',
    displayName: trustedDisplayName(hint.actorDisplayName, 'Local steward'),
    role: 'steward'
  }
}

export function trustedParticipantActor(value: unknown): StewardActor {
  const hint = value && typeof value === 'object' ? value as ActorDisplayHint : {}
  return {
    id: 'local-participant',
    displayName: trustedDisplayName(hint.actorDisplayName, 'League participant'),
    role: 'participant'
  }
}
