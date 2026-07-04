import type { LapSectorState, LapTimingState } from '../../shared/laptiming'
import type { TelemetrySnapshot } from '../../shared/telemetry'

const SECTOR_COUNT = 3

interface ActiveSector {
  lap: number
  index: number
  startTimeSec: number
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export class LapTimingCalculator {
  private latest: TelemetrySnapshot | null = null
  private lastLap?: number
  private bestLap?: number
  private sessionBest?: number
  private bestSectors: Array<number | undefined> = Array.from({ length: SECTOR_COUNT })
  private lastSectors: Array<number | undefined> = Array.from({ length: SECTOR_COUNT })
  private currentSectors: Array<number | undefined> = Array.from({ length: SECTOR_COUNT })
  private activeSector: ActiveSector | null = null

  update(snapshot: TelemetrySnapshot | null): LapTimingState {
    this.latest = snapshot
    if (!snapshot?.connected) return this.get()

    if (positive(snapshot.bestLapTimeSec)) {
      this.bestLap = Math.min(this.bestLap ?? snapshot.bestLapTimeSec, snapshot.bestLapTimeSec)
      this.sessionBest = Math.min(this.sessionBest ?? snapshot.bestLapTimeSec, snapshot.bestLapTimeSec)
    }
    if (positive(snapshot.lastLapTimeSec)) {
      this.lastLap = snapshot.lastLapTimeSec
      this.bestLap = Math.min(this.bestLap ?? snapshot.lastLapTimeSec, snapshot.lastLapTimeSec)
    }

    this.updateSectors(snapshot)
    return this.get()
  }

  get(): LapTimingState {
    const snapshot = this.latest
    const predicted = this.getPredictedLap(snapshot)
    const optimalLap = this.bestSectors.every(finite)
      ? this.bestSectors.reduce((sum, sector) => sum + (sector ?? 0), 0)
      : undefined
    const bestLap = this.bestLap ?? snapshot?.bestLapTimeSec
    const sessionBest = this.sessionBest ?? snapshot?.bestLapTimeSec

    return {
      connected: snapshot?.connected ?? false,
      currentLap: snapshot?.currentLap,
      lapDistPct: snapshot?.lapDistPct,
      currentLapTime: finite(snapshot?.currentLapTimeSec) ? round(snapshot.currentLapTimeSec) : undefined,
      predicted: finite(predicted) ? round(predicted) : undefined,
      bestLap: finite(bestLap) ? round(bestLap) : undefined,
      sessionBest: finite(sessionBest) ? round(sessionBest) : undefined,
      optimalLap: finite(optimalLap) ? round(optimalLap) : undefined,
      lastLap: finite(this.lastLap) ? round(this.lastLap) : undefined,
      deltaBest: finite(predicted) && finite(bestLap) ? round(predicted - bestLap) : snapshot?.deltaToBestSec,
      deltaOptimal: finite(predicted) && finite(optimalLap) ? round(predicted - optimalLap) : undefined,
      deltaSessionBest: finite(predicted) && finite(sessionBest) ? round(predicted - sessionBest) : snapshot?.deltaToSessionBestSec,
      sectors: this.getSectors(snapshot),
      updatedAt: snapshot?.timestamp
    }
  }

  reset(): LapTimingState {
    this.lastLap = undefined
    this.bestLap = undefined
    this.sessionBest = undefined
    this.bestSectors = Array.from({ length: SECTOR_COUNT })
    this.lastSectors = Array.from({ length: SECTOR_COUNT })
    this.currentSectors = Array.from({ length: SECTOR_COUNT })
    this.activeSector = null
    return this.get()
  }

  private updateSectors(snapshot: TelemetrySnapshot): void {
    if (!positive(snapshot.currentLap) || !finite(snapshot.currentLapTimeSec) || !finite(snapshot.lapDistPct)) return

    const sectorIndex = Math.min(SECTOR_COUNT - 1, Math.floor(Math.max(0, Math.min(0.999999, snapshot.lapDistPct)) * SECTOR_COUNT))
    if (!this.activeSector || snapshot.currentLap !== this.activeSector.lap) {
      // Lap rollover: close out whatever sectors of the previous lap were still
      // open. Without this, the final sector (typically S3) is never written to
      // lastSectors / bestSectors and optimalLap stays undefined forever.
      if (this.activeSector && positive(snapshot.lastLapTimeSec)) {
        this.finalizePreviousLapSectors(this.activeSector, snapshot.lastLapTimeSec)
      }
      this.currentSectors = Array.from({ length: SECTOR_COUNT })
      this.activeSector = { lap: snapshot.currentLap, index: sectorIndex, startTimeSec: this.getSectorStartEstimate(snapshot, sectorIndex) }
      return
    }

    if (sectorIndex > this.activeSector.index) {
      for (let index = this.activeSector.index; index < sectorIndex; index += 1) {
        const boundaryTime = this.getSectorBoundaryEstimate(snapshot, index + 1)
        const duration = Math.max(0, boundaryTime - this.activeSector.startTimeSec)
        this.currentSectors[index] = duration
        this.lastSectors[index] = duration
        this.bestSectors[index] = Math.min(this.bestSectors[index] ?? duration, duration)
        this.activeSector = { lap: snapshot.currentLap, index: index + 1, startTimeSec: boundaryTime }
      }
    } else if (sectorIndex < this.activeSector.index) {
      this.currentSectors = Array.from({ length: SECTOR_COUNT })
      this.activeSector = { lap: snapshot.currentLap, index: sectorIndex, startTimeSec: this.getSectorStartEstimate(snapshot, sectorIndex) }
    }
  }

  // Distributes the remaining time of the just-completed lap across all sectors
  // whose boundaries weren't crossed yet. Each remaining sector ends at
  // `(boundary/SECTOR_COUNT) * lastLapTimeSec` (proportional), with the very
  // last sector clamped to `lastLapTimeSec` so the three sectors sum to the
  // recorded lap time.
  private finalizePreviousLapSectors(previousSector: ActiveSector, lastLapTimeSec: number): void {
    let startTimeSec = previousSector.startTimeSec
    for (let index = previousSector.index; index < SECTOR_COUNT; index += 1) {
      const endTimeSec = index === SECTOR_COUNT - 1
        ? lastLapTimeSec
        : ((index + 1) / SECTOR_COUNT) * lastLapTimeSec
      const duration = Math.max(0, endTimeSec - startTimeSec)
      if (duration <= 0) continue
      this.lastSectors[index] = duration
      this.bestSectors[index] = Math.min(this.bestSectors[index] ?? duration, duration)
      startTimeSec = endTimeSec
    }
  }

  private getPredictedLap(snapshot: TelemetrySnapshot | null): number | undefined {
    if (!snapshot) return undefined
    if (positive(snapshot.estimatedLapTimeSec)) return snapshot.estimatedLapTimeSec
    if (positive(snapshot.currentLapTimeSec) && positive(snapshot.lapDistPct)) return snapshot.currentLapTimeSec / snapshot.lapDistPct
    if (positive(snapshot.bestLapTimeSec) && finite(snapshot.deltaToBestSec)) return snapshot.bestLapTimeSec + snapshot.deltaToBestSec
    return undefined
  }

  private getSectors(snapshot: TelemetrySnapshot | null): LapSectorState[] {
    const activeIndex = this.activeSector?.index
    const currentLapTime = snapshot?.currentLapTimeSec
    return Array.from({ length: SECTOR_COUNT }, (_, index) => {
      const current = index === activeIndex && finite(currentLapTime) && this.activeSector
        ? Math.max(0, currentLapTime - this.activeSector.startTimeSec)
        : this.currentSectors[index]
      const best = this.bestSectors[index]
      return {
        index: index + 1,
        current: finite(current) ? round(current) : undefined,
        last: finite(this.lastSectors[index]) ? round(this.lastSectors[index]) : undefined,
        best: finite(best) ? round(best) : undefined,
        deltaToBest: finite(current) && finite(best) ? round(current - best) : undefined
      }
    })
  }

  private getSectorStartEstimate(snapshot: TelemetrySnapshot, sectorIndex: number): number {
    if (!positive(snapshot.lapDistPct) || !finite(snapshot.currentLapTimeSec)) return 0
    return snapshot.currentLapTimeSec * ((sectorIndex / SECTOR_COUNT) / snapshot.lapDistPct)
  }

  private getSectorBoundaryEstimate(snapshot: TelemetrySnapshot, boundaryIndex: number): number {
    if (!positive(snapshot.lapDistPct) || !finite(snapshot.currentLapTimeSec)) return 0
    return snapshot.currentLapTimeSec * ((boundaryIndex / SECTOR_COUNT) / snapshot.lapDistPct)
  }
}
