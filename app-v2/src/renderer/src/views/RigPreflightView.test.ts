import { describe, expect, it } from 'vitest'
import { createRigPreflightProfile } from '../../../shared/rig-preflight'
import { profileContent } from './RigPreflightView'

describe('RigPreflightView profile comparison', () => {
  it('ignores requirements insertion order when deciding whether a draft changed', () => {
    const profile = createRigPreflightProfile('full-rig', 10_000, 'Crew chief')
    const reordered = {
      ...profile,
      requirements: Object.fromEntries(
        Object.entries(profile.requirements).reverse()
      ) as typeof profile.requirements
    }

    expect(profileContent(reordered)).toBe(profileContent(profile))
  })
})
