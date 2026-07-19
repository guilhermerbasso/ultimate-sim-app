import { describe, expect, it } from 'vitest'
import { mergeTouchExpressionValues } from './useTouchExpressionValues'

describe('touch expression value merging', () => {
  const wanted = new Set(['nullable', 'deleted', 'unchanged'])

  it('assigns a present null instead of retaining the previous value', () => {
    const next = mergeTouchExpressionValues(
      { nullable: 42, deleted: true, unchanged: 'keep' },
      wanted,
      { nullable: { name: 'Nullable', value: null } }
    )

    expect(next).toEqual({ nullable: null, deleted: true, unchanged: 'keep' })
  })

  it('clears a deleted expression tombstone while preserving untouched wanted ids', () => {
    const next = mergeTouchExpressionValues(
      { nullable: 42, deleted: true, unchanged: 'keep', noLongerWanted: 7 },
      wanted,
      { deleted: { name: 'Deleted', value: null, deleted: true } }
    )

    expect(next).toEqual({ nullable: 42, unchanged: 'keep' })
    expect(Object.prototype.hasOwnProperty.call(next, 'deleted')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(next, 'noLongerWanted')).toBe(false)
  })
})
