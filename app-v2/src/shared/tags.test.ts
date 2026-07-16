import { describe, expect, it } from 'vitest'
import {
  DASHBOARD_PORTFOLIO_FAMILY_TAGS,
  TYPE_TAGS,
  UNIT_TAGS,
  isControlledTag,
  unitTagFor
} from './tags'

const KNOWN_UNITS = [
  'bar', '°C', '°', 'frame', 'Hg', 'kg', 'kg/h', 'kg/lap',
  'kg/m³', 'km/h', 'kPa', 'L', '%', 'rpm', 's', 'V'
] as const

const REPEATED_UNITS = [
  ['%%', 'unit-percentpercent'],
  ['%/%', 'unit-percent-percent'],
  ['°°', 'unit-degreesdegrees'],
  ['°/°', 'unit-degrees-degrees'],
  ['°C°C', 'unit-celsiuscelsius'],
  ['°C/%/°', 'unit-celsius-percent-degrees']
] as const

describe('unitTagFor', () => {
  it('preserves every known unit mapping', () => {
    expect(KNOWN_UNITS.map((unit) => unitTagFor(unit))).toEqual(UNIT_TAGS)
  })

  it.each([
    ['  KPA  ', 'unit-kpa'],
    [' kg/m³ ', 'unit-kg-m'],
    ['mph', 'unit-mph'],
    ['! / ?', undefined],
    ['', undefined],
    [undefined, undefined]
  ])('normalizes %j', (unit, expected) => {
    expect(unitTagFor(unit)).toBe(expected)
  })

  it.each(REPEATED_UNITS)('replaces every semantic token in %s', (unit, expected) => {
    expect(unitTagFor(unit)).toBe(expected)
  })

  it('emits the unit tag grammar', () => {
    for (const unit of [...KNOWN_UNITS, ' mph ', ...REPEATED_UNITS.map(([value]) => value)]) {
      expect(unitTagFor(unit)).toMatch(/^unit-[a-z0-9]+(?:-[a-z0-9]+)*$/)
    }
  })
})

describe('dashboard portfolio controlled tags', () => {
  it('registers Release B and every family facet for shared filtering', () => {
    const requiredPortfolioTags = [
      'dashboard',
      'telemetry-framework',
      'release-b',
      ...DASHBOARD_PORTFOLIO_FAMILY_TAGS
    ]

    expect(TYPE_TAGS).toContain('release-b')
    expect(DASHBOARD_PORTFOLIO_FAMILY_TAGS).toHaveLength(10)
    for (const tag of requiredPortfolioTags) expect(isControlledTag(tag), tag).toBe(true)
  })
})
