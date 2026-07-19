import type { StewardActor } from '../../shared/steward-desk'

export const STEWARD_LOCAL_ACTOR_CONFIG = Object.freeze({
  steward: Object.freeze({
    id: 'local-steward',
    displayName: 'Local steward',
    role: 'steward'
  }),
  participant: Object.freeze({
    id: 'local-participant',
    displayName: 'League participant',
    role: 'participant'
  }),
  importer: Object.freeze({
    id: 'steward-import',
    displayName: 'Imported steward package',
    role: 'league-admin'
  })
} satisfies Record<'steward' | 'participant' | 'importer', StewardActor>)

export function trustedStewardActor(): StewardActor {
  return { ...STEWARD_LOCAL_ACTOR_CONFIG.steward }
}

export function trustedParticipantActor(): StewardActor {
  return { ...STEWARD_LOCAL_ACTOR_CONFIG.participant }
}

export function trustedImportActor(): StewardActor {
  return { ...STEWARD_LOCAL_ACTOR_CONFIG.importer }
}
