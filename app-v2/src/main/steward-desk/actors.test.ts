import { describe, expect, it } from 'vitest'
import { trustedParticipantActor, trustedStewardActor } from './actors'

describe('Steward Desk trusted actors', () => {
  it('ignores renderer-supplied ids and elevated roles', () => {
    const spoofed = {
      actorDisplayName: '  Race Control  ',
      actor: {
        id: 'attacker',
        displayName: 'Forged chief',
        role: 'league-admin'
      }
    }

    expect(trustedStewardActor(spoofed)).toEqual({
      id: 'local-steward',
      displayName: 'Race Control',
      role: 'steward'
    })
    expect(trustedParticipantActor(spoofed)).toEqual({
      id: 'local-participant',
      displayName: 'Race Control',
      role: 'participant'
    })
  })

  it('falls back instead of accepting invalid display-name claims', () => {
    expect(trustedStewardActor({ actorDisplayName: 'x'.repeat(121) }).displayName).toBe('Local steward')
    expect(trustedParticipantActor({ actorDisplayName: '\u0000admin' }).displayName).toBe('League participant')
  })
})
