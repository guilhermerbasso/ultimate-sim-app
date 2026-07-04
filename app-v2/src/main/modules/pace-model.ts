import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { ModuleContext } from '../module-context'
import type { Corners, TelemetrySnapshot, TyreInfo } from '../../shared/telemetry'
import type { PaceFeatures, PaceModel } from '../../shared/predictions'
import { PaceLearner, type PaceLearnerState } from '../../shared/pace-learner'
import { setPredictionsPaceModel } from './predictions'
import { logger } from './logger'

// WS-L pace-model module. Owns ONE personalized `PaceLearner` per (car+track),
// feeds it CLEAN green laps (once per completed lap — NEVER in the tick loop),
// persists the learners to userData as JSON, and plugs a `PaceModel` adapter
// into the WS-G predictions engine via `setPredictionsPaceModel(...)`. When the
// active learner is confident the engine uses the personalized estimate; below
// the confidence floor the adapter returns `null` and the engine cleanly falls
// back to its deterministic math.
//
// All heavy/learning math lives in the pure, unit-tested shared/pace-learner.ts.
// This module only does I/O orchestration: lap-completion detection, clean-lap
// gating, persistence and the adapter wiring.

const STORE_FILE = 'pace-models.json'
const STORE_VERSION = 1 as const
/** Below this confidence we defer to the deterministic engine (return null). */
const MIN_CONFIDENCE = 0.35
/** Debounce window for persisting the learners after a learning update. */
const SAVE_DEBOUNCE_MS = 2_000

export const PACE_MODEL_CHANNELS = {
  /** Renderer → main: fetch a small status snapshot of the learners. */
  get: 'pacemodel:get'
} as const

export interface PaceModelStatus {
  enabled: boolean
  activeKey: string | null
  activeSamples: number
  activeConfidence: number
  models: Array<{ key: string; samples: number }>
}

interface PaceModelFile {
  version: typeof STORE_VERSION
  models: Record<string, PaceLearnerState>
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isPositive(v: unknown): v is number {
  return isFiniteNum(v) && v > 0
}

function averageDefined(values: Array<number | undefined>): number | undefined {
  const clean = values.filter((v): v is number => isFiniteNum(v))
  if (clean.length === 0) return undefined
  return clean.reduce((s, v) => s + v, 0) / clean.length
}

/** Average tyre wear across the four corners (0..1), or undefined if unknown. */
function representativeWear(tyres: Corners<TyreInfo> | undefined): number | undefined {
  if (!tyres) return undefined
  const corners: Array<keyof Corners<TyreInfo>> = ['lf', 'rf', 'lr', 'rr']
  return averageDefined(corners.map((c) => tyres[c]?.wearPct))
}

/** Stable, filesystem/JSON-safe key for a (car+track+layout) tuple. The track
 *  LAYOUT (iRacing TrackConfigName) is included so two configurations of one track
 *  (e.g. Silverstone GP vs International) get independent learners and don't collide
 *  in the outlier gate. Backward-compatible: no config → `car__track` as before.
 *  Exported for unit testing. */
export function modelKey(
  carName: string | undefined,
  trackName: string | undefined,
  trackConfigName?: string | undefined
): string | null {
  const car = (carName ?? '').trim()
  const track = (trackName ?? '').trim()
  if (!car || !track) return null
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const config = norm((trackConfigName ?? '').trim())
  const base = `${norm(car)}__${norm(track)}`
  return config ? `${base}__${config}` : base
}

class PaceModelStore {
  private readonly learners = new Map<string, PaceLearner>()
  private active: PaceLearner | null = null
  private activeKey: string | null = null

  // lap-completion / clean-lap tracking
  private lastCompletedLap: number | null = null
  private lapsOnStint = 0
  private pitSeenThisLap = false
  private lastIncidentCount: number | null = null
  private wasConnected = false

  private loadPromise: Promise<void> | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private dirty = false

  constructor(
    private readonly ctx: ModuleContext,
    private readonly filePath: string
  ) {}

  load(): Promise<void> {
    if (!this.loadPromise) this.loadPromise = this.loadFromDisk()
    return this.loadPromise
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<PaceModelFile>
      if (parsed && parsed.version === STORE_VERSION && parsed.models && typeof parsed.models === 'object') {
        for (const [key, state] of Object.entries(parsed.models)) {
          this.learners.set(key, PaceLearner.fromJSON(state))
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      if (code !== 'ENOENT') {
        logger.warn('pacemodel', 'failed to load persisted models', {
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }

  /** The `PaceModel` adapter handed to the predictions engine. */
  adapter(): PaceModel {
    return {
      predictLapSec: (features: PaceFeatures): number | null => {
        const l = this.active
        if (!l) return null
        const r = l.predict(features)
        if (r.confidence < MIN_CONFIDENCE) return null
        return isPositive(r.lapSec) ? r.lapSec : null
      },
      lapsToCliff: (features: PaceFeatures): number | null => {
        const l = this.active
        if (!l) return null
        if (l.confidence() < MIN_CONFIDENCE) return null
        return l.lapsToCliff(features)
      }
    }
  }

  /** Called once per telemetry snapshot. Cheap; only does work on lap edges. */
  onSnapshot(snap: TelemetrySnapshot | null): void {
    try {
      if (!snap || !snap.connected) {
        // Re-base on the next connection so a fresh session doesn't inherit
        // stale lap/stint counters.
        if (this.wasConnected) this.resetSession()
        this.wasConnected = false
        return
      }
      this.wasConnected = true

      this.selectActive(snap)
      this.trackPitAndIncidents(snap)

      const completed = this.detectLapCompletion(snap)
      if (completed) this.learnFromLap(snap)
    } catch (error) {
      logger.warn('pacemodel', 'onSnapshot failed', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private resetSession(): void {
    this.lastCompletedLap = null
    this.lapsOnStint = 0
    this.pitSeenThisLap = false
    this.lastIncidentCount = null
  }

  private selectActive(snap: TelemetrySnapshot): void {
    const key = modelKey(snap.carName, snap.trackName, snap.trackConfigName)
    if (key === this.activeKey) return
    this.activeKey = key
    if (key === null) {
      this.active = null
      return
    }
    let learner = this.learners.get(key)
    if (!learner) {
      learner = new PaceLearner()
      this.learners.set(key, learner)
    }
    this.active = learner
  }

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
    if (!isFiniteNum(snap.currentLap) || snap.currentLap <= 0) return false
    const lap = snap.currentLap
    if (this.lastCompletedLap === null) {
      this.lastCompletedLap = lap
      return false
    }
    if (lap > this.lastCompletedLap) {
      this.lastCompletedLap = lap
      this.lapsOnStint += 1
      return true
    }
    if (lap < this.lastCompletedLap) {
      // New session (lap counter reset backward): re-baseline so we don't skip the
      // whole new session's laps.
      this.lastCompletedLap = lap
      this.lapsOnStint = 0
      return false
    }
    return false
  }

  private learnFromLap(snap: TelemetrySnapshot): void {
    const lapTime = snap.lastLapTimeSec
    const incidentsNow = incidentCount(snap)
    const incidentDelta =
      this.lastIncidentCount !== null && incidentsNow !== null ? incidentsNow - this.lastIncidentCount : 0
    this.lastIncidentCount = incidentsNow

    const pitThisLap = this.pitSeenThisLap || snap.onPitRoad === true
    // Reset the per-lap pit flag for the next lap.
    this.pitSeenThisLap = false

    // CLEAN-lap gate: a finite positive lap time, not an in/out lap, and no new
    // incident during the lap. The learner applies a second robust outlier gate.
    if (!isPositive(lapTime)) return
    if (pitThisLap) return
    if (incidentDelta > 0) return

    const learner = this.active
    if (!learner) return

    const features: PaceFeatures = {
      recentLapTimes: [],
      tyreWearPct: representativeWear(snap.tyres),
      fuelLevelL: isFiniteNum(snap.fuelLiters) ? snap.fuelLiters : undefined,
      trackTempC: isFiniteNum(snap.trackTempC) ? snap.trackTempC : undefined,
      lapsOnStint: this.lapsOnStint
    }

    const accepted = learner.update(features, lapTime)
    if (accepted) this.scheduleSave()
  }

  private scheduleSave(): void {
    this.dirty = true
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.flush()
    }, SAVE_DEBOUNCE_MS)
    if (typeof this.saveTimer === 'object' && this.saveTimer && 'unref' in this.saveTimer) {
      ;(this.saveTimer as { unref?: () => void }).unref?.()
    }
  }

  async flush(): Promise<void> {
    if (!this.dirty) return
    this.dirty = false
    const models: Record<string, PaceLearnerState> = {}
    for (const [key, learner] of this.learners) models[key] = learner.toJSON()
    const file: PaceModelFile = { version: STORE_VERSION, models }
    try {
      await mkdir(dirname(this.filePath), { recursive: true })
      await writeFile(this.filePath, JSON.stringify(file), 'utf8')
    } catch (error) {
      this.dirty = true // retry on the next save
      logger.warn('pacemodel', 'failed to persist models', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    void this.flush()
  }

  status(): PaceModelStatus {
    return {
      enabled: true,
      activeKey: this.activeKey,
      activeSamples: this.active?.sampleCount ?? 0,
      activeConfidence: this.active?.confidence() ?? 0,
      models: Array.from(this.learners, ([key, learner]) => ({ key, samples: learner.sampleCount }))
    }
  }
}

function incidentCount(snap: TelemetrySnapshot): number | null {
  if (isFiniteNum(snap.incidentCountMy)) return snap.incidentCountMy
  if (isFiniteNum(snap.incidentCount)) return snap.incidentCount
  return null
}

export function register(ctx: ModuleContext): void {
  const store = new PaceModelStore(ctx, join(ctx.app.getPath('userData'), STORE_FILE))

  // Load persisted learners, THEN plug the adapter into the predictions engine.
  void store.load().then(() => {
    setPredictionsPaceModel(store.adapter())
  })

  ctx.telemetryHub.on('snapshot', (snapshot: TelemetrySnapshot | null) => {
    store.onSnapshot(snapshot)
  })

  ctx.ipcMain.handle(PACE_MODEL_CHANNELS.get, (): PaceModelStatus => store.status())

  ctx.app.once('before-quit', () => {
    setPredictionsPaceModel(null)
    store.dispose()
  })
}
