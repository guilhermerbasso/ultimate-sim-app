import type { TireCornerId, TireCornerStrategy, TireStrategySettings, TireStrategyState } from '../../shared/tire-strategy'
import type { Corners, TelemetrySnapshot } from '../../shared/telemetry'

const CORNERS: TireCornerId[] = ['lf', 'rf', 'lr', 'rr']
const DEFAULT_SETTINGS: TireStrategySettings = { wearThresholdPct: 0.3 }
const MAX_SAMPLES = 8
const EMPTY_CORNERS: Corners<TireCornerStrategy> = { lf: {}, rf: {}, lr: {}, rr: {} }

interface LapStartState {
  lap: number
  timestamp: number
  wear?: Partial<Record<TireCornerId, number>>
  load: Partial<Record<TireCornerId, number>>
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

function clamp(valueToClamp: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, valueToClamp))
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function emptyCornerSamples(): Record<TireCornerId, number[]> {
  return { lf: [], rf: [], lr: [], rr: [] }
}

function fullEstimatedLife(): Record<TireCornerId, number> {
  return { lf: 100, rf: 100, lr: 100, rr: 100 }
}

function readWear(snapshot: TelemetrySnapshot | null): Partial<Record<TireCornerId, number>> {
  const wear: Partial<Record<TireCornerId, number>> = {}
  for (const corner of CORNERS) {
    const value = snapshot?.tyres?.[corner]?.wearPct
    // Telemetry wearPct is a 0..1 fraction (1 = full life); the strategy math
    // uses a 0..100 internal scale, so convert here.
    if (finite(value)) wear[corner] = clamp(value * 100, 0, 100)
  }
  return wear
}

function hasWear(wear: Partial<Record<TireCornerId, number>>): boolean {
  return CORNERS.some((corner) => finite(wear[corner]))
}

function getCornerLoad(snapshot: TelemetrySnapshot): Record<TireCornerId, number> {
  const speedFactor = clamp((snapshot.speedKmh ?? 0) / 260, 0, 1.5)
  const brakeLoad = clamp(snapshot.brake ?? 0, 0, 1) * (0.35 + speedFactor)
  const throttleLoad = clamp(snapshot.throttle ?? 0, 0, 1) * 0.18 * speedFactor
  const steer = clamp(Math.abs(snapshot.steerAngleDeg ?? 0) / 180, 0, 1)
  const lateralLoad = steer * speedFactor

  return {
    lf: brakeLoad * (1.05 + lateralLoad * 0.35) + throttleLoad * 0.25 + lateralLoad * 0.65,
    rf: brakeLoad * (1.05 + lateralLoad * 0.35) + throttleLoad * 0.25 + lateralLoad * 0.65,
    lr: brakeLoad * 0.35 + throttleLoad * 1.15 + lateralLoad * 0.45,
    rr: brakeLoad * 0.35 + throttleLoad * 1.15 + lateralLoad * 0.45
  }
}

function addLoad(base: Partial<Record<TireCornerId, number>>, delta: Record<TireCornerId, number>, elapsedSec: number): Partial<Record<TireCornerId, number>> {
  const next = { ...base }
  for (const corner of CORNERS) {
    next[corner] = (next[corner] ?? 0) + delta[corner] * elapsedSec
  }
  return next
}

export class TireStrategyCalculator {
  private wearSamples: Record<TireCornerId, number[]> = emptyCornerSamples()
  private estimatedSamples: Record<TireCornerId, number[]> = emptyCornerSamples()
  private estimatedLife: Record<TireCornerId, number> = fullEstimatedLife()
  private lapStart: LapStartState | null = null
  private latest: TelemetrySnapshot | null = null
  private lastTimestamp?: number
  private settings: TireStrategySettings = { ...DEFAULT_SETTINGS }

  update(snapshot: TelemetrySnapshot | null): TireStrategyState {
    this.latest = snapshot
    if (!snapshot?.connected) return this.get()

    const elapsedSec = finite(this.lastTimestamp) ? clamp((snapshot.timestamp - this.lastTimestamp) / 1000, 0, 5) : 0
    this.lastTimestamp = snapshot.timestamp

    const lap = snapshot.currentLap
    const currentWear = readWear(snapshot)
    if (positive(lap)) {
      if (!this.lapStart) {
        this.lapStart = { lap, timestamp: snapshot.timestamp, wear: currentWear, load: {} }
      } else {
        this.lapStart.load = addLoad(this.lapStart.load, getCornerLoad(snapshot), elapsedSec)

        if (lap > this.lapStart.lap) {
          const lapDelta = lap - this.lapStart.lap
          if (lapDelta === 1) this.recordCompletedLap(currentWear, this.lapStart.load)
          this.lapStart = { lap, timestamp: snapshot.timestamp, wear: currentWear, load: {} }
        } else if (lap < this.lapStart.lap) {
          this.resetSamples()
          this.lapStart = { lap, timestamp: snapshot.timestamp, wear: currentWear, load: {} }
        }
      }
    }

    return this.get()
  }

  get(nextSettings?: Partial<TireStrategySettings>): TireStrategyState {
    if (nextSettings) {
      this.settings = {
        ...this.settings,
        ...nextSettings,
        wearThresholdPct: clamp(nextSettings.wearThresholdPct ?? this.settings.wearThresholdPct, 0.05, 0.9)
      }
    }

    const snapshot = this.latest
    const currentWear = readWear(snapshot)
    const primaryAvailable = hasWear(currentWear)
    const cornerStates = { ...EMPTY_CORNERS } as Corners<TireCornerStrategy>
    const notes: string[] = []
    let worstCorner: TireCornerId | undefined
    let shortestLaps: number | undefined

    for (const corner of CORNERS) {
      const wearPct = currentWear[corner] ?? (!primaryAvailable ? this.estimatedLife[corner] : undefined)
      const primaryRate = average(this.wearSamples[corner])
      const estimatedRate = average(this.estimatedSamples[corner])
      const wearPerLap = primaryRate ?? (!primaryAvailable ? estimatedRate : undefined)
      const remainingLife = finite(wearPct) ? wearPct / 100 : undefined
      const lapsToThreshold = finite(remainingLife) && positive(wearPerLap)
        ? Math.max(0, (remainingLife - this.settings.wearThresholdPct) / wearPerLap)
        : undefined

      cornerStates[corner] = {
        wearPct: finite(wearPct) ? round(wearPct, 1) : undefined,
        wearPerLap: finite(wearPerLap) ? round(wearPerLap, 4) : undefined,
        lapsToThreshold: finite(lapsToThreshold) ? round(lapsToThreshold, 1) : undefined,
        estimated: !primaryRate && !primaryAvailable && finite(estimatedRate)
      }

      if (finite(lapsToThreshold) && (!finite(shortestLaps) || lapsToThreshold < shortestLaps)) {
        shortestLaps = lapsToThreshold
        worstCorner = corner
      }
    }

    if (!primaryAvailable) notes.push('Real wear unavailable; using a relative estimate from brake load, acceleration, and speed.')
    if (!finite(shortestLaps)) notes.push('Waiting for complete laps to calculate the change window.')

    const avgWearPerLap = average(CORNERS.map((corner) => cornerStates[corner].wearPerLap).filter(finite))
    const currentLap = snapshot?.currentLap
    const recommendedPitLap = positive(currentLap) && finite(shortestLaps) ? Math.max(1, Math.floor(currentLap + shortestLaps)) : undefined
    const estimatedLapTimeSec = positive(snapshot?.estimatedLapTimeSec) ? snapshot?.estimatedLapTimeSec : snapshot?.lastLapTimeSec ?? snapshot?.bestLapTimeSec
    const raceLapsRemaining = this.getRaceLapsRemaining(snapshot, estimatedLapTimeSec)

    return {
      connected: snapshot?.connected ?? false,
      currentLap,
      corners: cornerStates,
      worstCorner,
      avgWearPerLap: finite(avgWearPerLap) ? round(avgWearPerLap, 4) : undefined,
      recommendedPitLap,
      lapsRemainingOnTyres: finite(shortestLaps) ? round(shortestLaps, 1) : undefined,
      raceLapsRemaining: finite(raceLapsRemaining) ? round(raceLapsRemaining, 1) : undefined,
      estimated: !primaryAvailable,
      notes,
      settings: { ...this.settings },
      updatedAt: snapshot?.timestamp
    }
  }

  reset(): TireStrategyState {
    this.resetSamples()
    this.lapStart = null
    this.lastTimestamp = undefined
    return this.get()
  }

  private recordCompletedLap(currentWear: Partial<Record<TireCornerId, number>>, load: Partial<Record<TireCornerId, number>>): void {
    const hasPrimaryWear = hasWear(currentWear) && hasWear(this.lapStart?.wear ?? {})

    if (hasPrimaryWear) {
      for (const corner of CORNERS) {
        const startWear = this.lapStart?.wear?.[corner]
        const endWear = currentWear[corner]
        if (!finite(startWear) || !finite(endWear)) continue

        const deltaRemainingLife = (startWear - endWear) / 100
        if (endWear > startWear + 2) {
          this.resetSamples()
          break
        }
        if (deltaRemainingLife > 0.0002 && deltaRemainingLife < 0.08) {
          this.wearSamples[corner].push(deltaRemainingLife)
          this.wearSamples[corner] = this.wearSamples[corner].slice(-MAX_SAMPLES)
        }
      }
      return
    }

    for (const corner of CORNERS) {
      const estimated = (load[corner] ?? 0) / 18000
      if (estimated > 0.0002 && estimated < 0.08) {
        this.estimatedSamples[corner].push(estimated)
        this.estimatedSamples[corner] = this.estimatedSamples[corner].slice(-MAX_SAMPLES)
        this.estimatedLife[corner] = clamp(this.estimatedLife[corner] - estimated * 100, 0, 100)
      }
    }
  }

  private resetSamples(): void {
    this.wearSamples = emptyCornerSamples()
    this.estimatedSamples = emptyCornerSamples()
    this.estimatedLife = fullEstimatedLife()
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
}
