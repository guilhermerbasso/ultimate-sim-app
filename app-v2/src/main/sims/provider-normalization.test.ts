import { describe, expect, it } from 'vitest'
import { classifyCoachTrackCondition } from '../../shared/coach-racecraft'
import { accWeatherFromGraphics } from './acc'
import { ams2TrackIdentity, ams2WeatherFromRainDensity } from './ams2'

describe('ACC weather normalization', () => {
  it('keeps stopped rain and unknown surface state from becoming instant dry', () => {
    const weather = accWeatherFromGraphics(0, 0.97)
    expect(weather).toEqual({
      precipitationPct: 0,
      isRaining: false,
      trackWetnessPct: undefined,
      gripPct: 0.97
    })
    expect(classifyCoachTrackCondition(weather)).toBe('unknown')
  })

  it('reports precipitation without fabricating validated surface wetness', () => {
    const weather = accWeatherFromGraphics(2, 0.85)
    expect(weather.precipitationPct).toBe(0.4)
    expect(weather.isRaining).toBe(true)
    expect(weather.trackWetnessPct).toBeUndefined()
    expect(classifyCoachTrackCondition(weather)).toBe('intermediate')
  })

  it('uses explicit ACC surface state for dry, damp, and wet tri-state evidence', () => {
    const dry = accWeatherFromGraphics(0, 0.99, 2)
    const damp = accWeatherFromGraphics(0, 0.9, 4)
    const wet = accWeatherFromGraphics(0, 0.75, 5)
    const unsupported = accWeatherFromGraphics(0, 0.95, 99)

    expect(dry.trackWetnessPct).toBe(0)
    expect(classifyCoachTrackCondition(dry)).toBe('dry')
    expect(classifyCoachTrackCondition(damp)).toBe('intermediate')
    expect(classifyCoachTrackCondition(wet)).toBe('wet')
    expect(classifyCoachTrackCondition(unsupported)).toBe('unknown')
  })
})

describe('AMS2 weather and layout normalization', () => {
  it('maps rain density to precipitation while leaving surface wetness unknown', () => {
    const wet = ams2WeatherFromRainDensity(0.6)
    const stopped = ams2WeatherFromRainDensity(0)
    expect(wet).toEqual({
      precipitationPct: 0.6,
      isRaining: true,
      trackWetnessPct: undefined
    })
    expect(classifyCoachTrackCondition(wet)).toBe('intermediate')
    expect(classifyCoachTrackCondition(stopped)).toBe('unknown')
  })

  it('keeps track location and variation as separate layout identity fields', () => {
    expect(ams2TrackIdentity('Spa-Francorchamps', '2022 GP')).toEqual({
      trackName: 'Spa-Francorchamps',
      trackConfigName: '2022 GP'
    })
  })
})
