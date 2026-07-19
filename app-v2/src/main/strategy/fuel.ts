import {
  FuelLapEstimator,
  type FuelLapEstimate,
  type FuelLapSample,
  type FuelPitWindow,
  type FuelStrategySettings,
  type FuelStrategyState
} from '../../shared/fuel'
import { fuelPerLapLitersOf, type TelemetrySnapshot } from '../../shared/telemetry'

const DEFAULT_SETTINGS: FuelStrategySettings = { fuelMarginLiters: 3 }

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

function fuelSessionIdentity(snapshot: TelemetrySnapshot): string {
  if (snapshot.replayContext?.sessionIdentity) {
    return snapshot.replayContext.sessionIdentity
  }
  return [
    snapshot.sim,
    snapshot.sessionUniqueId,
    snapshot.sessionNumber,
    snapshot.trackName,
    snapshot.carName
  ].filter((value) => value !== undefined && value !== null && value !== '').join('|')
}

function isLiveFuelSnapshot(snapshot: TelemetrySnapshot): boolean {
  if (!snapshot.connected) return false
  if (snapshot.replayContext) return snapshot.replayContext.state === 'live'
  return snapshot.replayPlaying !== true
}

export class FuelStrategyCalculator {
  private estimator = new FuelLapEstimator()
  private estimate: FuelLapEstimate = { samples: [] }
  private latest: TelemetrySnapshot | null = null
  private settings: FuelStrategySettings = { ...DEFAULT_SETTINGS }

  update(snapshot: TelemetrySnapshot | null): FuelStrategyState {
    this.latest = snapshot
    this.estimate = snapshot
      ? this.estimator.update({
          sessionIdentity: fuelSessionIdentity(snapshot),
          live: isLiveFuelSnapshot(snapshot),
          currentLap: snapshot.currentLap,
          fuelLiters: snapshot.fuelLiters,
          timestamp: snapshot.timestamp,
          lapTimeSec: snapshot.lastLapTimeSec
        })
      : this.estimator.update({ live: false })

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
    const live = snapshot ? isLiveFuelSnapshot(snapshot) : false
    const samples = this.estimate.samples.map((sample): FuelLapSample => ({
      lap: sample.lap,
      usedLiters: round(sample.usedLiters, 3),
      lapTimeSec: finite(sample.lapTimeSec) ? round(sample.lapTimeSec, 3) : undefined
    }))
    // Provider-normalized litres/lap is authoritative. The shared estimator is
    // only a truthful fallback for sims that do not publish the canonical field.
    const usedPerLap = live
      ? fuelPerLapLitersOf(snapshot) ?? this.estimate.fuelPerLapLiters
      : undefined
    const fuelLiters = snapshot?.fuelLiters
    const fuelCapacityLiters = snapshot?.fuelCapacityLiters
    const estimatedLapTimeSec = positive(snapshot?.estimatedLapTimeSec)
      ? snapshot?.estimatedLapTimeSec
      : average(samples.map((sample) => sample.lapTimeSec).filter(positive)) ?? snapshot?.bestLapTimeSec ?? snapshot?.lastLapTimeSec
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
      samples,
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
    this.estimate = this.estimator.reset()
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
