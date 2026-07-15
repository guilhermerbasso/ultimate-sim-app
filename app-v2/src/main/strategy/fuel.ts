import type { FuelLapSample, FuelPitWindow, FuelStrategySettings, FuelStrategyState } from '../../shared/fuel'
import { fuelPerLapLitersOf, type TelemetrySnapshot } from '../../shared/telemetry'

const DEFAULT_SETTINGS: FuelStrategySettings = { fuelMarginLiters: 3 }
const MAX_SAMPLES = 8

interface LapStartState {
  lap: number
  fuelLiters: number
  timestamp: number
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0
}

function nonNegativeFinite(value: unknown): value is number {
  return finite(value) && value >= 0
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export class FuelStrategyCalculator {
  private samples: FuelLapSample[] = []
  private lapStart: LapStartState | null = null
  private latest: TelemetrySnapshot | null = null
  private settings: FuelStrategySettings = { ...DEFAULT_SETTINGS }

  update(snapshot: TelemetrySnapshot | null): FuelStrategyState {
    this.latest = snapshot
    if (!snapshot?.connected) return this.get()

    const lap = snapshot.currentLap
    const fuel = snapshot.fuelLiters
    if (positive(lap) && finite(fuel)) {
      if (!this.lapStart) {
        this.lapStart = { lap, fuelLiters: fuel, timestamp: snapshot.timestamp }
      } else if (lap > this.lapStart.lap) {
        const lapDelta = lap - this.lapStart.lap
        const usedLiters = this.lapStart.fuelLiters - fuel
        const lapTimeSec = positive(snapshot.lastLapTimeSec)
          ? snapshot.lastLapTimeSec
          : (snapshot.timestamp - this.lapStart.timestamp) / 1000

        if (lapDelta === 1 && usedLiters > 0.05 && usedLiters < 25) {
          this.samples.push({ lap: this.lapStart.lap, usedLiters: round(usedLiters, 3), lapTimeSec: round(lapTimeSec, 3) })
          this.samples = this.samples.slice(-MAX_SAMPLES)
        }
        this.lapStart = { lap, fuelLiters: fuel, timestamp: snapshot.timestamp }
      } else if (lap < this.lapStart.lap) {
        this.samples = []
        this.lapStart = { lap, fuelLiters: fuel, timestamp: snapshot.timestamp }
      }
    }

    return this.get()
  }

  get(nextSettings?: Partial<FuelStrategySettings>): FuelStrategyState {
    if (nextSettings) {
      this.settings = {
        ...this.settings,
        ...nextSettings,
        fuelMarginLiters: Math.max(0, nextSettings.fuelMarginLiters ?? this.settings.fuelMarginLiters ?? 0)
      }
    }

    const snapshot = this.latest
    const connected = snapshot?.connected ?? false
    const sampleAverage = average(this.samples.map((sample) => sample.usedLiters))
    const usedPerLap = sampleAverage ?? fuelPerLapLitersOf(snapshot)
    const fuelLiters = snapshot?.fuelLiters
    const fuelCapacityLiters = snapshot?.fuelCapacityLiters
    const estimatedLapTimeSec = positive(snapshot?.estimatedLapTimeSec)
      ? snapshot?.estimatedLapTimeSec
      : average(this.samples.map((sample) => sample.lapTimeSec).filter(positive)) ?? snapshot?.bestLapTimeSec ?? snapshot?.lastLapTimeSec
    const raceLapsRemaining = this.getRaceLapsRemaining(snapshot, estimatedLapTimeSec)
    const margin = this.settings.fuelMarginLiters
    const usableFuel = finite(fuelLiters) ? Math.max(0, fuelLiters - margin) : undefined
    const lapsLeftWithFuel = positive(usedPerLap) && finite(usableFuel) ? usableFuel / usedPerLap : undefined
    const fuelToFinish = positive(usedPerLap) && finite(raceLapsRemaining) ? raceLapsRemaining * usedPerLap + margin : undefined
    const fuelDeltaToFinish = finite(fuelLiters) && finite(fuelToFinish) ? fuelLiters - fuelToFinish : undefined
    const saveTarget = finite(usableFuel) && positive(raceLapsRemaining) ? usableFuel / raceLapsRemaining : undefined
    const saveNeededPerLap = finite(usedPerLap) && finite(saveTarget) ? Math.max(0, usedPerLap - saveTarget) : undefined
    const pitWindow = this.getPitWindow(snapshot, lapsLeftWithFuel, raceLapsRemaining, saveNeededPerLap)
    const stintLaps = positive(usedPerLap) && finite(fuelCapacityLiters)
      ? Math.max(1, Math.floor(Math.max(0, fuelCapacityLiters - margin) / usedPerLap))
      : undefined

    return {
      connected,
      currentLap: snapshot?.currentLap,
      fuelLiters: finite(fuelLiters) ? round(fuelLiters, 2) : undefined,
      fuelCapacityLiters,
      usedPerLap: finite(usedPerLap) ? round(usedPerLap, 3) : undefined,
      samples: [...this.samples],
      lapsLeftWithFuel: finite(lapsLeftWithFuel) ? round(lapsLeftWithFuel, 2) : undefined,
      raceLapsRemaining: finite(raceLapsRemaining) ? round(raceLapsRemaining, 2) : undefined,
      fuelToFinish: finite(fuelToFinish) ? round(fuelToFinish, 2) : undefined,
      fuelDeltaToFinish: finite(fuelDeltaToFinish) ? round(fuelDeltaToFinish, 2) : undefined,
      saveTarget: finite(saveTarget) ? round(saveTarget, 3) : undefined,
      saveNeededPerLap: finite(saveNeededPerLap) ? round(saveNeededPerLap, 3) : undefined,
      pitWindow,
      stint: {
        estimatedLapTimeSec: finite(estimatedLapTimeSec) ? round(estimatedLapTimeSec, 3) : undefined,
        raceLapsRemaining: finite(raceLapsRemaining) ? round(raceLapsRemaining, 2) : undefined,
        stintLaps,
        stintsToFinish: positive(stintLaps) && positive(raceLapsRemaining) ? Math.ceil(raceLapsRemaining / stintLaps) : undefined,
        fuelPerStintLiters: positive(stintLaps) && positive(usedPerLap) ? round(stintLaps * usedPerLap, 2) : undefined
      },
      settings: { ...this.settings },
      updatedAt: snapshot?.timestamp
    }
  }

  reset(): FuelStrategyState {
    this.samples = []
    this.lapStart = null
    return this.get()
  }

  private getRaceLapsRemaining(snapshot: TelemetrySnapshot | null, estimatedLapTimeSec?: number): number | undefined {
    if (positive(this.settings.targetLaps) && positive(snapshot?.currentLap)) {
      const lapProgress = snapshot?.lapDistPct ?? 0
      return Math.max(0, this.settings.targetLaps - snapshot.currentLap + 1 - lapProgress)
    }

    if (nonNegativeFinite(snapshot?.lapsRemaining) && snapshot.lapsRemaining < 9999) return snapshot.lapsRemaining

    if (positive(this.settings.raceTimeMinutes) && positive(estimatedLapTimeSec)) {
      const configuredSeconds = this.settings.raceTimeMinutes * 60
      const remainingSeconds = nonNegativeFinite(snapshot?.sessionTimeRemainingSec)
        ? Math.min(configuredSeconds, snapshot.sessionTimeRemainingSec)
        : configuredSeconds
      return remainingSeconds / estimatedLapTimeSec
    }

    if (nonNegativeFinite(snapshot?.sessionTimeRemainingSec) && positive(estimatedLapTimeSec)) {
      return snapshot.sessionTimeRemainingSec / estimatedLapTimeSec
    }
    return undefined
  }

  private getPitWindow(
    snapshot: TelemetrySnapshot | null,
    lapsLeftWithFuel?: number,
    raceLapsRemaining?: number,
    saveNeededPerLap?: number
  ): FuelPitWindow {
    if (!finite(lapsLeftWithFuel) || !finite(raceLapsRemaining)) return { canFinish: false, status: 'unknown' }

    const canFinish = lapsLeftWithFuel >= raceLapsRemaining
    const currentLap = snapshot?.currentLap ?? 0
    const lapsUntilPit = Math.max(0, Math.floor(lapsLeftWithFuel))
    const latestLap = positive(currentLap) ? currentLap + lapsUntilPit : undefined
    const status: FuelPitWindow['status'] = canFinish
      ? saveNeededPerLap && saveNeededPerLap > 0.02 ? 'save' : 'safe'
      : lapsLeftWithFuel < 1 ? 'critical' : 'pit-required'

    return {
      canFinish,
      earliestLap: canFinish ? undefined : Math.max(1, currentLap),
      latestLap,
      lapsUntilPit,
      status
    }
  }
}
