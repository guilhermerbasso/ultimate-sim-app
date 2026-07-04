import type { ModuleContext } from '../module-context'
import type { Corners, TelemetrySnapshot, TyreInfo } from '../../shared/telemetry'
import {
  PREDICTIONS_CHANNELS,
  computePredictions,
  isRealLapCount,
  type GapSample,
  type PaceModel,
  type PredictionInputs,
  type PredictionsSnapshot,
  type TyreReading
} from '../../shared/predictions'
import { logger } from './logger'

// WS-G predictions module. ALL heavy math lives in shared/predictions.ts (pure +
// unit-tested). This module only: (1) keeps cheap rolling SAMPLES of telemetry,
// (2) recomputes the snapshot on a LIGHT timer + once per completed lap — never
// inside the telemetry tick — and (3) broadcasts/serves it over IPC. Everything
// is gated on a connected snapshot and wrapped so it can never throw.

const SAMPLE_INTERVAL_MS = 1_000 // light sampling cadence (out of the tick)
const BROADCAST_MIN_MS = 500 // throttle floor for broadcasts
const MIN_LAP_ADVANCE = 0.02 // min fractional-lap progress between gap samples
const MAX_GAP_SAMPLES = 80 // ring buffer cap per side
const GAP_SAMPLE_WINDOW_LAPS = 3 // only regress over the last few laps
const MAX_RECENT_LAPS = 8 // clean laps kept for pace/deg

interface SideBuffer {
  carIdx: number | null
  samples: GapSample[]
}

function emptySide(): SideBuffer {
  return { carIdx: null, samples: [] }
}

function isFiniteNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPositive(value: unknown): value is number {
  return isFiniteNum(value) && value > 0
}

function tyreReadings(tyres: Corners<TyreInfo> | undefined, cold: Corners<number> | undefined): TyreReading[] {
  if (!tyres) return []
  const corners: Array<keyof Corners<TyreInfo>> = ['lf', 'rf', 'lr', 'rr']
  return corners.map((c) => {
    const t = tyres[c] ?? {}
    const reading: TyreReading = {}
    if (isPositive(t.pressureKpa)) reading.pressureKpa = t.pressureKpa
    if (cold && isPositive(cold[c])) reading.coldPressureKpa = cold[c]
    // Prefer the core temp; fall back to the middle/average surface temp.
    const temp =
      t.tempC ??
      t.tempMiddleC ??
      averageDefined([t.tempLeftC, t.tempMiddleC, t.tempRightC]) ??
      averageDefined([t.surfaceTempLeftC, t.surfaceTempMiddleC, t.surfaceTempRightC])
    if (isFiniteNum(temp)) reading.tempC = temp
    if (isFiniteNum(t.wearPct)) reading.wearPct = t.wearPct
    return reading
  })
}

function averageDefined(values: Array<number | undefined>): number | undefined {
  const clean = values.filter((v): v is number => isFiniteNum(v))
  if (clean.length === 0) return undefined
  return clean.reduce((s, v) => s + v, 0) / clean.length
}

// Prefer the driver's own incident count; fall back to the generic one. Mirrors
// pace-model.ts so both modules gate clean laps on the same signal.
function incidentCount(snap: TelemetrySnapshot): number | null {
  if (isFiniteNum(snap.incidentCountMy)) return snap.incidentCountMy
  if (isFiniteNum(snap.incidentCount)) return snap.incidentCount
  return null
}

class PredictionsEngine {
  private latest: TelemetrySnapshot | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private ahead = emptySide()
  private behind = emptySide()
  private recentLapTimes: number[] = []
  private lastSampleLap: number | null = null
  private lastCompletedLap: number | null = null
  private lapsOnStint = 0
  private pitSeenThisLap = false
  private lastIncidentCount: number | null = null
  private lastSnapshot: PredictionsSnapshot | null = null
  private lastBroadcastAt = 0
  private model: PaceModel | null = null
  private wasConnected = false

  constructor(private readonly ctx: ModuleContext) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), SAMPLE_INTERVAL_MS)
    if (typeof this.timer === 'object' && this.timer && 'unref' in this.timer) {
      ;(this.timer as { unref?: () => void }).unref?.()
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  setModel(model: PaceModel | null): void {
    this.model = model
  }

  onSnapshot(snapshot: TelemetrySnapshot | null): void {
    // Cheap: only stash the latest. All work happens on the light timer.
    this.latest = snapshot
  }

  getSnapshot(): PredictionsSnapshot | null {
    return this.lastSnapshot
  }

  // Re-baseline all per-session/per-stint state. Called on a lap-counter backward
  // jump (practice→quali→race / new event) and on disconnect, so we never keep
  // emitting the previous session's pace/tyre/fuel/catch predictions.
  private resetSession(): void {
    this.ahead = emptySide()
    this.behind = emptySide()
    this.recentLapTimes = []
    this.lastSampleLap = null
    this.lastCompletedLap = null
    this.lapsOnStint = 0
    this.pitSeenThisLap = false
    this.lastIncidentCount = null
    this.lastSnapshot = null
  }

  // ── light timer: sample, detect lap completion, recompute, broadcast ──
  private tick(): void {
    try {
      const snap = this.latest
      if (!snap || !snap.connected) {
        if (this.wasConnected) {
          this.resetSession()
          this.wasConnected = false
        }
        return
      }
      this.wasConnected = true

      const lapFrac = this.lapFraction(snap)
      this.sampleGaps(snap, lapFrac)
      this.trackPitAndIncidents(snap)
      const lapCompleted = this.detectLapCompletion(snap)

      const inputs = this.buildInputs(snap)
      const next = computePredictions(inputs, this.model)
      this.lastSnapshot = next

      const now = Date.now()
      if (lapCompleted || now - this.lastBroadcastAt >= BROADCAST_MIN_MS) {
        this.ctx.broadcast(PREDICTIONS_CHANNELS.snapshot, next)
        this.lastBroadcastAt = now
      }
    } catch (error) {
      logger.warn('predictions', 'tick failed', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private lapFraction(snap: TelemetrySnapshot): number | null {
    const lap = isRealLapCount(snap.currentLap) ? snap.currentLap : 0
    const pct = isFiniteNum(snap.lapDistPct) ? Math.max(0, Math.min(0.999999, snap.lapDistPct)) : null
    if (pct === null) return null
    return lap + pct
  }

  private sampleGaps(snap: TelemetrySnapshot, lapFrac: number | null): void {
    if (lapFrac === null) return
    if (this.lastSampleLap !== null && lapFrac - this.lastSampleLap < MIN_LAP_ADVANCE) {
      // Don't double-sample within the same spot; still allow on a fresh lap wrap.
      if (lapFrac >= this.lastSampleLap) return
    }
    this.lastSampleLap = lapFrac

    this.pushGap(this.ahead, snap.relatives?.ahead?.carIdx, snap.relatives?.ahead?.gapSec, lapFrac)
    this.pushGap(this.behind, snap.relatives?.behind?.carIdx, snap.relatives?.behind?.gapSec, lapFrac)
  }

  private pushGap(side: SideBuffer, carIdx: number | undefined, gapSec: number | undefined, lapFrac: number): void {
    if (!isFiniteNum(carIdx)) return
    if (!isFiniteNum(gapSec)) return
    // A new neighbour invalidates the trend — reset the buffer.
    if (side.carIdx !== carIdx) {
      side.carIdx = carIdx
      side.samples = []
    }
    side.samples.push({ lap: lapFrac, gapSec: Math.abs(gapSec) })
    // Trim by age (last few laps) then by count.
    const minLap = lapFrac - GAP_SAMPLE_WINDOW_LAPS
    side.samples = side.samples.filter((s) => s.lap >= minLap)
    if (side.samples.length > MAX_GAP_SAMPLES) side.samples = side.samples.slice(-MAX_GAP_SAMPLES)
  }

  // Mirror pace-model.ts's clean-lap bookkeeping: remember if we touched pit road
  // during the lap and seed the incident baseline so a lap with a new incident can
  // be detected and skipped.
  private trackPitAndIncidents(snap: TelemetrySnapshot): void {
    if (snap.onPitRoad) {
      this.pitSeenThisLap = true
      this.lapsOnStint = 0
    }
    if (this.lastIncidentCount === null) {
      this.lastIncidentCount = incidentCount(snap)
    }
  }

  private detectLapCompletion(snap: TelemetrySnapshot): boolean {
    if (!isRealLapCount(snap.currentLap)) return false
    const lap = snap.currentLap
    if (this.lastCompletedLap === null) {
      this.lastCompletedLap = lap
      return false
    }
    if (lap > this.lastCompletedLap) {
      this.lastCompletedLap = lap
      this.lapsOnStint += 1
      // Only record CLEAN laps for pace/deg: a finite positive lap time, not an
      // in/out/pit lap, and no incident gained during the lap. This prevents a
      // single traffic-held or incident lap from skewing the degradation slope
      // (mirrors pace-model.ts's clean-lap gate).
      this.recordLapIfClean(snap)
      return true
    }
    if (lap < this.lastCompletedLap) {
      // Session boundary (practice→quali→race / new event): the lap counter went
      // backward. Re-baseline so we stop emitting the previous session's predictions.
      this.resetSession()
      this.lastCompletedLap = lap
      return false
    }
    return false
  }

  private recordLapIfClean(snap: TelemetrySnapshot): void {
    const lapTime = snap.lastLapTimeSec
    const incidentsNow = incidentCount(snap)
    const incidentDelta =
      this.lastIncidentCount !== null && incidentsNow !== null ? incidentsNow - this.lastIncidentCount : 0
    this.lastIncidentCount = incidentsNow

    const pitThisLap = this.pitSeenThisLap || snap.onPitRoad === true
    // Reset the per-lap pit flag for the next lap.
    this.pitSeenThisLap = false

    if (!isPositive(lapTime)) return
    if (pitThisLap) return
    if (incidentDelta > 0) return

    this.recentLapTimes.push(lapTime)
    if (this.recentLapTimes.length > MAX_RECENT_LAPS) {
      this.recentLapTimes = this.recentLapTimes.slice(-MAX_RECENT_LAPS)
    }
  }

  private buildInputs(snap: TelemetrySnapshot): PredictionInputs {
    const lapTimeSec = isPositive(snap.lastLapTimeSec)
      ? snap.lastLapTimeSec
      : isPositive(snap.estimatedLapTimeSec)
        ? snap.estimatedLapTimeSec
        : undefined

    return {
      aheadCarIdx: this.ahead.carIdx ?? undefined,
      aheadGapSamples: this.ahead.samples,
      behindCarIdx: this.behind.carIdx ?? undefined,
      behindGapSamples: this.behind.samples,
      lapTimeSec,
      fuelLevelL: snap.fuelLiters,
      fuelPerLap: snap.fuelPerLap,
      lapsRemaining: snap.lapsRemaining,
      sessionTimeRemainingSec: snap.sessionTimeRemainingSec,
      recentLapTimes: this.recentLapTimes,
      tyres: tyreReadings(snap.tyres, snap.tireColdPressuresKpa),
      trackTempC: snap.trackTempC,
      lapsOnStint: this.lapsOnStint
    }
  }
}

let engine: PredictionsEngine | null = null

/**
 * WS-L plug point: hand the predictions engine a learned `PaceModel`. Pass
 * `null` to revert to deterministic math. Safe to call before/after register.
 */
export function setPredictionsPaceModel(model: PaceModel | null): void {
  engine?.setModel(model)
}

/**
 * WS-G engineer tool plug point: return the last computed predictions snapshot
 * (or `null` when the engine isn't running / has nothing yet). Never throws.
 */
export function getLatestPredictions(): PredictionsSnapshot | null {
  return engine?.getSnapshot() ?? null
}

export function register(ctx: ModuleContext): void {
  engine = new PredictionsEngine(ctx)
  engine.start()

  ctx.telemetryHub.on('snapshot', (snapshot: TelemetrySnapshot | null) => {
    engine?.onSnapshot(snapshot)
  })

  ctx.ipcMain.handle(PREDICTIONS_CHANNELS.get, () => engine?.getSnapshot() ?? null)

  ctx.app.once('before-quit', () => engine?.stop())
}
