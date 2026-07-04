import type { Corners } from './telemetry'

export type TireCornerId = keyof Corners<unknown>

export interface TireCornerStrategy {
  wearPct?: number
  wearPerLap?: number
  lapsToThreshold?: number
  estimated?: boolean
}

export interface TireStrategySettings {
  /** Remaining tyre life threshold (0.30 = pit when life is <= 30%). */
  wearThresholdPct: number
  targetLaps?: number
  raceTimeMinutes?: number
}

export interface TireStrategyState {
  connected: boolean
  currentLap?: number
  corners: Corners<TireCornerStrategy>
  worstCorner?: TireCornerId
  avgWearPerLap?: number
  recommendedPitLap?: number
  lapsRemainingOnTyres?: number
  raceLapsRemaining?: number
  estimated: boolean
  notes: string[]
  settings: TireStrategySettings
  updatedAt?: number
}

export const TIRE_CHANNELS = {
  update: 'tire:update',
  get: 'tire:get',
  reset: 'tire:reset'
} as const
