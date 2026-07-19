import { describe, expect, it } from 'vitest'
import { classifyTrackWetness } from './track-wetness'

describe('classifyTrackWetness', () => {
  it('keeps stopped rain unknown without explicit surface evidence', () => {
    expect(classifyTrackWetness({ isRaining: false })).toBe('unknown')
    expect(
      classifyTrackWetness({
        isRaining: false,
        previousTrackWetnessPct: 0.8
      })
    ).toBe('unknown')
  })

  it('uses explicit surface wetness for dry, damp, wet, and drying states', () => {
    expect(classifyTrackWetness({ trackWetnessPct: 0, isRaining: false })).toBe('dry')
    expect(classifyTrackWetness({ trackWetnessPct: 0.2, isRaining: false })).toBe('intermediate')
    expect(classifyTrackWetness({ trackWetnessPct: 0.7, isRaining: false })).toBe('wet')
    expect(
      classifyTrackWetness({
        trackWetnessPct: 0.2,
        previousTrackWetnessPct: 0.5,
        isRaining: false
      })
    ).toBe('drying')
  })
})
