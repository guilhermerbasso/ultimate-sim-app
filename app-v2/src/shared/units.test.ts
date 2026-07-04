import { describe, expect, it } from 'vitest'
import { mss2ToG, STANDARD_GRAVITY_MS2 } from './units'

describe('mss2ToG', () => {
  it('converts standard gravity to exactly 1g', () => {
    expect(mss2ToG(STANDARD_GRAVITY_MS2)).toBe(1)
  })

  it('keeps zero acceleration as zero', () => {
    expect(mss2ToG(0)).toBe(0)
  })

  it('converts negative acceleration without clamping', () => {
    expect(mss2ToG(-STANDARD_GRAVITY_MS2)).toBe(-1)
  })

  it('converts two standard gravities to 2g', () => {
    expect(mss2ToG(STANDARD_GRAVITY_MS2 * 2)).toBe(2)
  })

  it.each([undefined, null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'returns undefined for missing or non-finite input: %s',
    (value) => {
      expect(mss2ToG(value)).toBeUndefined()
    }
  )
})
