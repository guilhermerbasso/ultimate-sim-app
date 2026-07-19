import { describe, expect, it } from 'vitest'
import { deepFreeze, type DeepReadonly } from './immutability'

describe('deepFreeze', () => {
  it('preserves callable signatures while deeply freezing tuples and arrays', () => {
    const increment = (value: number): number => value + 1
    const frozen = deepFreeze({
      tuple: [{ value: 7 }, increment] as const,
      rows: [{ label: 'A' }, { label: 'B' }]
    })

    const callable: DeepReadonly<typeof increment> = frozen.tuple[1]
    expect(callable(4)).toBe(5)
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(Object.isFrozen(frozen.tuple)).toBe(true)
    expect(Object.isFrozen(frozen.tuple[0])).toBe(true)
    expect(Object.isFrozen(frozen.rows)).toBe(true)
    expect(Object.isFrozen(frozen.rows[0])).toBe(true)
  })
})
