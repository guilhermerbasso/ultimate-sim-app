export type TrackWetnessState = 'dry' | 'intermediate' | 'wet' | 'drying' | 'unknown'

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export interface TrackWetnessInput {
  trackWetnessPct?: number
  isRaining?: boolean
  weatherDeclaredWet?: boolean
  previousTrackWetnessPct?: number
}

export function classifyTrackWetness(input: TrackWetnessInput): TrackWetnessState {
  const hasWetness = finite(input.trackWetnessPct)
  const hasPositiveWeatherSignal =
    input.isRaining === true || input.weatherDeclaredWet === true
  if (!hasWetness && !hasPositiveWeatherSignal) return 'unknown'
  const wetness = hasWetness
    ? Math.max(0, Math.min(1, input.trackWetnessPct as number))
    : 0
  const wasWetter =
    finite(input.previousTrackWetnessPct) &&
    input.previousTrackWetnessPct - wetness >= 0.03
  if (
    input.isRaining !== true &&
    wetness > 0.03 &&
    (wasWetter || input.weatherDeclaredWet === true)
  ) {
    return 'drying'
  }
  if (wetness >= 0.6 || (input.isRaining === true && wetness >= 0.35)) return 'wet'
  if (wetness >= 0.08 || input.isRaining === true || input.weatherDeclaredWet === true) {
    return 'intermediate'
  }
  return 'dry'
}
