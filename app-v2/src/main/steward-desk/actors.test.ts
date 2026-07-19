import { describe, expect, it } from 'vitest'
import {
  STEWARD_LOCAL_ACTOR_CONFIG,
  trustedImportActor,
  trustedParticipantActor,
  trustedStewardActor
} from './actors'

describe('Steward Desk trusted actors', () => {
  it('returns complete stable identities only from frozen main-owned configuration', () => {
    expect(Object.isFrozen(STEWARD_LOCAL_ACTOR_CONFIG)).toBe(true)
    expect(Object.isFrozen(STEWARD_LOCAL_ACTOR_CONFIG.steward)).toBe(true)
    expect(trustedStewardActor()).toEqual({
      id: 'local-steward',
      displayName: 'Local steward',
      role: 'steward'
    })
    expect(trustedParticipantActor()).toEqual({
      id: 'local-participant',
      displayName: 'League participant',
      role: 'participant'
    })
    expect(trustedImportActor()).toEqual({
      id: 'steward-import',
      displayName: 'Imported steward package',
      role: 'league-admin'
    })
    expect(trustedStewardActor()).not.toBe(STEWARD_LOCAL_ACTOR_CONFIG.steward)
  })
})
