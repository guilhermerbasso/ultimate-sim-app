import { describe, expect, it } from 'vitest'
import { collectTags, filterByTags } from './TagFilter'

interface Item {
  id: string
  tags?: string[]
}

const items: Item[] = [
  { id: 'gt3-ir-carbon', tags: ['GT3', 'IR', 'carbon'] },
  { id: 'gt3-acc', tags: ['GT3', 'ACC'] },
  { id: 'formula-ir', tags: ['formula', 'IR'] },
  { id: 'untagged' }
]

describe('filterByTags', () => {
  it('returns every item when no tags are selected', () => {
    expect(filterByTags(items, [], (item) => item.tags).map((item) => item.id)).toEqual([
      'gt3-ir-carbon',
      'gt3-acc',
      'formula-ir',
      'untagged'
    ])
  })

  it('uses AND semantics for multiple selected tags', () => {
    expect(filterByTags(items, ['GT3', 'IR'], (item) => item.tags).map((item) => item.id)).toEqual([
      'gt3-ir-carbon'
    ])
  })

  it('accepts a selected-tag Set and excludes untagged items when filtering', () => {
    expect(filterByTags(items, new Set(['IR']), (item) => item.tags).map((item) => item.id)).toEqual([
      'gt3-ir-carbon',
      'formula-ir'
    ])
  })
})

describe('collectTags', () => {
  it('returns sorted unique tags with per-item counts', () => {
    expect(collectTags(items, (item) => item.tags)).toEqual([
      { tag: 'ACC', count: 1 },
      { tag: 'carbon', count: 1 },
      { tag: 'formula', count: 1 },
      { tag: 'GT3', count: 2 },
      { tag: 'IR', count: 2 }
    ])
  })

  it('counts duplicate tags only once per item', () => {
    const result = collectTags([{ id: 'a', tags: ['IR', 'IR', 'GT3'] }], (item) => item.tags)
    expect(result).toEqual([
      { tag: 'GT3', count: 1 },
      { tag: 'IR', count: 1 }
    ])
  })
})
