import { describe, expect, it } from 'vitest'
import { selectConfiguredValue, type CachedValue } from './CustomValueWidget'

describe('CustomValue exact source selection', () => {
  const values: Record<string, CachedValue> = {
    first: { name: 'first', value: '1', numeric: 1 },
    exact: { name: 'exact', value: '2', numeric: 2 }
  }

  it('returns only the explicitly configured value', () => {
    expect(selectConfiguredValue(values, 'exact')).toEqual(values.exact)
    expect(selectConfiguredValue(values, 'missing')).toBeNull()
  })

  it('does not fall back to the arbitrary first output', () => {
    expect(selectConfiguredValue(values, undefined)).toBeNull()
  })
})
