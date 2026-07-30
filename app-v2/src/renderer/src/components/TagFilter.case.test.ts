import { describe, expect, it } from 'vitest'
import { mergeTags } from '../../../shared/tags'
import { collectTags, filterByTags } from './TagFilter'

/**
 * Tags reach the app from three places with inconsistent casing: hand-authored
 * catalogs, user input, and imported panel JSON. Before normalisation `Rain` and
 * `rain` produced two chips that each matched only half the library.
 */
describe('tag case normalisation', () => {
  // mergeTags always appends the auto sim tags; these assertions look at the
  // manual/category portion that precedes them.
  const manualPart = (tags: readonly string[]): string[] =>
    tags.filter((tag) => !['IR', 'ACC', 'AC', 'AMS2', 'LMU'].includes(tag))

  it('treats case variants as one tag when merging', () => {
    expect(manualPart(mergeTags(['Rain', 'rain', 'RAIN'], undefined))).toEqual(['Rain'])
  })

  it('keeps the first-seen spelling as the display form', () => {
    expect(manualPart(mergeTags(['GT3'], undefined, 'gt3'))).toEqual(['gt3'])
    expect(manualPart(mergeTags(['Endurance', 'endurance'], undefined))).toEqual(['Endurance'])
  })

  it('still de-duplicates the category against a differently cased manual tag', () => {
    expect(manualPart(mergeTags(['Fuel'], undefined, 'fuel'))).toEqual(['fuel'])
  })
})

describe('tag filtering is case-insensitive', () => {
  const items = [
    { id: 'a', tags: ['Rain', 'Endurance'] },
    { id: 'b', tags: ['rain'] },
    { id: 'c', tags: ['dry'] }
  ]
  const getTags = (item: (typeof items)[number]): readonly string[] => item.tags

  it('counts case variants as a single tag', () => {
    const counts = collectTags(items, getTags)
    const rain = counts.filter((entry) => entry.tag.toLowerCase() === 'rain')
    expect(rain).toHaveLength(1)
    expect(rain[0].count).toBe(2)
  })

  it('matches items whose tag differs only by case', () => {
    expect(filterByTags(items, ['Rain'], getTags).map((item) => item.id)).toEqual(['a', 'b'])
    expect(filterByTags(items, ['rain'], getTags).map((item) => item.id)).toEqual(['a', 'b'])
    expect(filterByTags(items, ['RAIN'], getTags).map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('still requires every selected tag to be present', () => {
    expect(filterByTags(items, ['rain', 'endurance'], getTags).map((item) => item.id)).toEqual(['a'])
  })
})
