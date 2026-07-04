import { describe, expect, it } from 'vitest'
import { formatDelta, pctOrUndefined } from './format'

describe('formatDelta', () => {
  it('returns an em dash for missing/non-finite input', () => {
    expect(formatDelta(undefined)).toBe('—')
    expect(formatDelta(Number.NaN)).toBe('—')
    expect(formatDelta(Number.POSITIVE_INFINITY)).toBe('—')
  })

  it('keeps the signed delta formatting for finite values', () => {
    expect(formatDelta(-0.183)).toBe('-0.183')
    expect(formatDelta(0.5)).toBe('+0.500')
    expect(formatDelta(0)).toBe('±0.000')
  })
})

describe('pctOrUndefined', () => {
  it('returns undefined (no 0 fallback) for missing/non-finite input', () => {
    expect(pctOrUndefined(undefined)).toBeUndefined()
    expect(pctOrUndefined(Number.NaN)).toBeUndefined()
  })

  it('clamps finite values into [0, 1]', () => {
    expect(pctOrUndefined(0.5)).toBe(0.5)
    expect(pctOrUndefined(2)).toBe(1)
    expect(pctOrUndefined(-3)).toBe(0)
  })
})
