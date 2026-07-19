import { describe, expect, it } from 'vitest'
import {
  PASSPORT_ITEM_DEFINITIONS,
  STINT_PASSPORT_CHANNELS,
  STINT_PASSPORT_ITEM_COUNT,
  calculatePassportCoverage,
  isCoveredStatus,
  isPassportRole,
  passportItemDefinition,
  type PassportItem,
  type PassportItemStatus
} from './stint-passport'

function item(
  index: number,
  status: PassportItemStatus = 'unknown'
): PassportItem {
  return {
    id: PASSPORT_ITEM_DEFINITIONS[index].id,
    status,
    detail: `Item ${index}`,
    revision: 1
  }
}

describe('Stint Passport domain invariants', () => {
  it('[supported] defines exactly 12 unique, role-owned items with valid TTL and N/A policy', () => {
    const ids = PASSPORT_ITEM_DEFINITIONS.map((definition) => definition.id)
    const eligible = PASSPORT_ITEM_DEFINITIONS
      .filter((definition) => definition.notApplicableEligible)
      .map((definition) => definition.id)

    expect(PASSPORT_ITEM_DEFINITIONS).toHaveLength(STINT_PASSPORT_ITEM_COUNT)
    expect(new Set(ids).size).toBe(STINT_PASSPORT_ITEM_COUNT)
    expect(PASSPORT_ITEM_DEFINITIONS.every((definition) =>
      definition.allowedRoles.length > 0 &&
      definition.ttlMs > 0 &&
      definition.required
    )).toBe(true)
    expect(eligible).toEqual(['weather-assumption'])
  })

  it('[supported] resolves every known definition exactly and rejects an unknown runtime ID', () => {
    for (const definition of PASSPORT_ITEM_DEFINITIONS) {
      expect(passportItemDefinition(definition.id)).toBe(definition)
    }

    expect(() => passportItemDefinition('future-item' as never))
      .toThrow(/unknown passport item: future-item/i)
  })

  it('[supported] classifies every status without treating failure states as covered', () => {
    const statuses: PassportItemStatus[] = [
      'unknown',
      'verified',
      'manual-confirmed',
      'waived-with-reason',
      'not-applicable',
      'mismatch',
      'expired'
    ]

    expect(Object.fromEntries(statuses.map((status) => [status, isCoveredStatus(status)])))
      .toEqual({
        unknown: false,
        verified: true,
        'manual-confirmed': true,
        'waived-with-reason': true,
        'not-applicable': true,
        mismatch: false,
        expired: false
      })
  })

  it('[supported] computes exact zero, partial, full, and eligible N/A coverage', () => {
    const emptyCoverage = calculatePassportCoverage(
      PASSPORT_ITEM_DEFINITIONS.map((_, index) => item(index))
    )
    const partialCoverage = calculatePassportCoverage(
      PASSPORT_ITEM_DEFINITIONS.map((_, index) =>
        item(index, index < 3 ? 'verified' : 'unknown')
      )
    )
    const fullCoverage = calculatePassportCoverage(
      PASSPORT_ITEM_DEFINITIONS.map((_, index) => item(index, 'verified'))
    )
    const eligibleNotApplicable = calculatePassportCoverage(
      PASSPORT_ITEM_DEFINITIONS.map((definition, index) =>
        item(index, definition.id === 'weather-assumption' ? 'not-applicable' : 'verified')
      )
    )

    expect(emptyCoverage).toEqual({ coverage: 0, applicableItems: 12, coveredItems: 0 })
    expect(partialCoverage).toEqual({ coverage: 0.25, applicableItems: 12, coveredItems: 3 })
    expect(fullCoverage).toEqual({ coverage: 1, applicableItems: 12, coveredItems: 12 })
    expect(eligibleNotApplicable).toEqual({ coverage: 1, applicableItems: 11, coveredItems: 11 })
  })

  it('[spec-gap] rejects malformed item sets instead of returning trusted-looking coverage', () => {
    const valid = PASSPORT_ITEM_DEFINITIONS.map((_, index) => item(index, 'verified'))
    const malformed = [
      { name: 'zero items', items: [] },
      { name: '11 items', items: valid.slice(0, 11) },
      { name: '13 items', items: [...valid, { ...valid[0] }] },
      { name: 'duplicate IDs', items: [...valid.slice(0, 11), { ...valid[0] }] },
      {
        name: 'all N/A',
        items: PASSPORT_ITEM_DEFINITIONS.map((_, index) => item(index, 'not-applicable'))
      }
    ]
    const accepted = malformed
      .filter(({ items }) => {
        try {
          calculatePassportCoverage(items)
          return true
        } catch {
          return false
        }
      })
      .map(({ name }) => name)

    expect(accepted, 'malformed item sets accepted as coverage input').toEqual([])
  })

  it('[supported] accepts only the five exact primitive role strings', () => {
    expect(['driver', 'engineer', 'crew-chief', 'spotter', 'team-manager']
      .every((role) => isPassportRole(role))).toBe(true)
    expect([
      new String('driver'),
      'Driver',
      'drіver',
      ' driver',
      'team-manager ',
      Object.create({ valueOf: () => 'driver' }),
      null,
      undefined
    ].some((role) => isPassportRole(role))).toBe(false)
  })

  it('[supported] exposes unique channels only in the exact Stint Passport namespace', () => {
    const channels = Object.values(STINT_PASSPORT_CHANNELS)

    expect(new Set(channels).size).toBe(channels.length)
    expect(channels.length).toBeGreaterThan(0)
    expect(channels.every((channel) =>
      channel.startsWith('stintPassport:') &&
      channel.indexOf(':') === 'stintPassport'.length
    )).toBe(true)
  })
})
