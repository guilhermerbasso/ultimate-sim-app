export interface FuelStrategySettings {
  targetLaps?: number
  raceTimeMinutes?: number
  fuelMarginLiters: number
}

export interface FuelLapSample {
  lap: number
  usedLiters: number
  lapTimeSec?: number
}

export interface FuelPitWindow {
  canFinish: boolean
  earliestLap?: number
  latestLap?: number
  lapsUntilPit?: number
  status: 'safe' | 'save' | 'pit-required' | 'critical' | 'unknown'
}

export interface FuelStintPlan {
  estimatedLapTimeSec?: number
  raceLapsRemaining?: number
  stintLaps?: number
  stintsToFinish?: number
  fuelPerStintLiters?: number
}

export interface FuelStrategyState {
  connected: boolean
  currentLap?: number
  fuelLiters?: number
  fuelCapacityLiters?: number
  usedPerLap?: number
  samples: FuelLapSample[]
  lapsLeftWithFuel?: number
  raceLapsRemaining?: number
  fuelToFinish?: number
  fuelDeltaToFinish?: number
  saveTarget?: number
  saveNeededPerLap?: number
  pitWindow: FuelPitWindow
  stint: FuelStintPlan
  settings: FuelStrategySettings
  updatedAt?: number
}
