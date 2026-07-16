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

export interface FuelLapEstimatorInput {
  sessionIdentity?: string
  live: boolean
  currentLap?: number
  fuelLiters?: number
  timestamp?: number
  lapTimeSec?: number
}

export interface FuelLapEstimate {
  fuelPerLapLiters?: number
  fuelLapsRemaining?: number
  samples: FuelLapSample[]
}

const MAX_FUEL_LAP_SAMPLES = 8

export class FuelLapEstimator {
  private sessionIdentity: string | undefined
  private lapStart: {
    lap: number
    fuelLiters: number
    minFuelLiters: number
    timestamp?: number
    boundaryObserved: boolean
    refueled: boolean
  } | undefined
  private samples: FuelLapSample[] = []

  update(input: FuelLapEstimatorInput): FuelLapEstimate {
    if (input.sessionIdentity !== this.sessionIdentity) {
      this.reset()
      this.sessionIdentity = input.sessionIdentity
    }
    if (!input.live) {
      this.lapStart = undefined
      return { samples: [...this.samples] }
    }

    const lap = input.currentLap
    const fuelLiters = input.fuelLiters
    if (
      typeof lap !== 'number' ||
      !Number.isInteger(lap) ||
      lap < 0 ||
      typeof fuelLiters !== 'number' ||
      !Number.isFinite(fuelLiters) ||
      fuelLiters < 0
    ) {
      return this.current(fuelLiters)
    }

    if (!this.lapStart) {
      this.lapStart = {
        lap,
        fuelLiters,
        minFuelLiters: fuelLiters,
        timestamp: input.timestamp,
        boundaryObserved: false,
        refueled: false
      }
    } else if (lap > this.lapStart.lap) {
      const lapDelta = lap - this.lapStart.lap
      const usedLiters = this.lapStart.fuelLiters - fuelLiters
      const refueled =
        this.lapStart.refueled ||
        fuelLiters > this.lapStart.minFuelLiters + 0.05
      const elapsedSec =
        typeof input.timestamp === 'number' &&
        Number.isFinite(input.timestamp) &&
        typeof this.lapStart.timestamp === 'number' &&
        Number.isFinite(this.lapStart.timestamp)
          ? (input.timestamp - this.lapStart.timestamp) / 1000
          : undefined
      const lapTimeSec =
        typeof input.lapTimeSec === 'number' &&
        Number.isFinite(input.lapTimeSec) &&
        input.lapTimeSec > 0
          ? input.lapTimeSec
          : elapsedSec
      if (
        lapDelta === 1 &&
        this.lapStart.boundaryObserved &&
        !refueled &&
        usedLiters > 0.05 &&
        usedLiters < 25
      ) {
        this.samples.push({
          lap: this.lapStart.lap,
          usedLiters,
          lapTimeSec:
            typeof lapTimeSec === 'number' &&
            Number.isFinite(lapTimeSec) &&
            lapTimeSec > 0
              ? lapTimeSec
              : undefined
        })
        this.samples = this.samples.slice(-MAX_FUEL_LAP_SAMPLES)
      }
      this.lapStart = {
        lap,
        fuelLiters,
        minFuelLiters: fuelLiters,
        timestamp: input.timestamp,
        boundaryObserved: lapDelta === 1,
        refueled: false
      }
    } else if (lap < this.lapStart.lap) {
      this.samples = []
      this.lapStart = {
        lap,
        fuelLiters,
        minFuelLiters: fuelLiters,
        timestamp: input.timestamp,
        boundaryObserved: false,
        refueled: false
      }
    } else {
      if (fuelLiters > this.lapStart.minFuelLiters + 0.05) {
        this.lapStart.refueled = true
      }
      this.lapStart.minFuelLiters = Math.min(
        this.lapStart.minFuelLiters,
        fuelLiters
      )
    }

    return this.current(fuelLiters)
  }

  reset(): FuelLapEstimate {
    this.sessionIdentity = undefined
    this.lapStart = undefined
    this.samples = []
    return { samples: [] }
  }

  private current(fuelLiters?: number): FuelLapEstimate {
    if (this.samples.length === 0) return { samples: [] }
    const fuelPerLapLiters =
      this.samples.reduce((sum, sample) => sum + sample.usedLiters, 0) /
      this.samples.length
    return {
      fuelPerLapLiters,
      fuelLapsRemaining:
        typeof fuelLiters === 'number' &&
        Number.isFinite(fuelLiters) &&
        fuelLiters >= 0
          ? fuelLiters / fuelPerLapLiters
          : undefined,
      samples: this.samples.map((sample) => ({ ...sample }))
    }
  }
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
