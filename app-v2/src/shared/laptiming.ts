export interface LapSectorState {
  index: number
  current?: number
  last?: number
  best?: number
  deltaToBest?: number
}

export interface LapTimingState {
  connected: boolean
  currentLap?: number
  lapDistPct?: number
  currentLapTime?: number
  predicted?: number
  bestLap?: number
  sessionBest?: number
  optimalLap?: number
  lastLap?: number
  deltaBest?: number
  deltaOptimal?: number
  deltaSessionBest?: number
  sectors: LapSectorState[]
  updatedAt?: number
}
