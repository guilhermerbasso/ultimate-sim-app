import { describe, expect, it } from 'vitest'
import { LiveCoachEngine, type LiveCoachDeps } from './coach'
import type { CornerMapData } from '../track-map/corner-map'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import { CONDITION_CONFIRM_FRAMES } from '../../shared/coach-session-key'

// SYNTHETIC EVIDENCE: hand-built laps, not a real capture. The point is the TRANSITION —
// a car swap or the track going wet inside one sim session — which cannot be produced on
// demand from a real capture, and which iRacing's replay session identity
// (SessionID:SubSessionID:SessionUniqueID:SessionNum, see replaySessionIdentity in
// src/main/iracing/provider.ts) does not signal at all.

const STEP = 0.0025 // 400 samples per lap, well over the engine's 30-sample minimum.
const SAMPLE_MS = 50

function cornerMap(): CornerMapData {
  return {
    version: 1,
    trackName: 'Spa-Francorchamps',
    configKey: 'gp',
    corners: [
      { index: 1, startPct: 0.18, apexPct: 0.22, endPct: 0.28, minSpeedKmh: 150, entrySpeedKmh: 200, exitSpeedKmh: 200 },
      { index: 2, startPct: 0.45, apexPct: 0.55, endPct: 0.62, minSpeedKmh: 130, entrySpeedKmh: 235, exitSpeedKmh: 180 }
    ],
    generatedAt: 0,
    sampleCount: 400
  } as unknown as CornerMapData
}

function snap(over: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 0,
    speedKmh: 220,
    rpm: 8000,
    gear: 4,
    throttle: 0.95,
    brake: 0,
    clutch: 0,
    steerAngleDeg: 0,
    latAccelG: 0,
    longAccelG: 0,
    onPitRoad: false,
    sessionType: 'Practice',
    trackName: 'Spa-Francorchamps',
    trackConfigName: 'Grand Prix',
    carName: 'Ferrari 488 GT3 Evo',
    sessionUniqueId: 5,
    currentLap: 1,
    lapDistPct: 0,
    ...over
  } as TelemetrySnapshot
}

/** One full lap of 400 samples, with a braking zone so corner analysis has real input. */
function buildLap(lapNumber: number, startTs: number, over: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot[] {
  const frames: TelemetrySnapshot[] = []
  let index = 0
  for (let pct = 0; pct < 1; pct += STEP) {
    const braking = pct >= 0.46 && pct < 0.49
    const cornering = pct >= 0.49 && pct < 0.62
    frames.push(
      snap({
        ...over,
        timestamp: startTs + index * SAMPLE_MS,
        currentLap: lapNumber,
        lapDistPct: Math.min(0.999999, pct),
        speedKmh: braking ? 160 : cornering ? 150 : 235,
        throttle: braking ? 0 : cornering ? 0.85 : 0.95,
        brake: braking ? 1 : 0,
        steerAngleDeg: cornering ? 30 : 0,
        latAccelG: cornering ? 1.2 : 0,
        lastLapTimeSec: 138 + lapNumber * 0.1,
        bestLapTimeSec: 138
      })
    )
    index += 1
  }
  return frames
}

function harness() {
  let clock = 1_000_000
  const deps: LiveCoachDeps = {
    broadcast: () => undefined,
    buildCornerMap: () => cornerMap(),
    now: () => clock,
    getLanguage: () => 'en-US'
  }
  const engine = new LiveCoachEngine(deps)
  engine.start()
  return {
    engine,
    feed(frames: TelemetrySnapshot[]) {
      for (const frame of frames) {
        engine.onSnapshot(frame)
        clock += 60
      }
    }
  }
}

/** Runs two laps so the engine has learned a corner map and a reference. */
function warmed(base: Partial<TelemetrySnapshot> = {}) {
  const h = harness()
  h.feed(buildLap(1, 0, base))
  h.feed(buildLap(2, 100_000, base))
  expect(h.engine.learnedContext().cornerMap, 'a corner map must have been learned first').not.toBeNull()
  return h
}

describe('LiveCoachEngine drops ALL context on a §24-17 transition', () => {
  it('discards the learned context when the CAR changes inside one sim session', () => {
    const h = warmed()

    // Same sim session (sessionUniqueId unchanged), same track, DIFFERENT car.
    h.feed([snap({ carName: 'Porsche 992 GT3 R', currentLap: 3, lapDistPct: 0.05, timestamp: 300_000 })])

    const context = h.engine.learnedContext()
    expect(context.cornerMap).toBeNull()
    expect(context.reference).toBeNull()
    expect(context.referenceLapTimeSec).toBeUndefined()
    expect(context.findings).toEqual([])
  })

  it('discards the learned context when the TRACK changes', () => {
    const h = warmed()
    h.feed([snap({ trackName: 'Monza', currentLap: 1, lapDistPct: 0.05, timestamp: 300_000 })])
    expect(h.engine.learnedContext().cornerMap).toBeNull()
  })

  it('discards the learned context when the track CONFIGURATION changes', () => {
    const h = warmed()
    h.feed([snap({ trackConfigName: 'Endurance', currentLap: 1, lapDistPct: 0.05, timestamp: 300_000 })])
    expect(h.engine.learnedContext().cornerMap).toBeNull()
  })

  it('discards the learned context when the SESSION changes', () => {
    const h = warmed()
    h.feed([snap({ sessionType: 'Race', sessionUniqueId: 6, currentLap: 1, lapDistPct: 0.05, timestamp: 300_000 })])
    expect(h.engine.learnedContext().cornerMap).toBeNull()
  })

  it('discards the learned context when the CONDITION goes from dry to wet', () => {
    const h = warmed({ trackWetnessPct: 0, isRaining: false })
    // The condition must HOLD before it counts (CONDITION_CONFIRM_FRAMES), so a flicker
    // around a band threshold cannot wipe a learned corner map.
    const wet = { trackWetnessPct: 0.9, isRaining: true }
    for (let frame = 0; frame < CONDITION_CONFIRM_FRAMES + 2; frame += 1) {
      h.feed([snap({ ...wet, currentLap: 3, lapDistPct: 0.05 + frame * 0.001, timestamp: 300_000 + frame * 50 })])
    }

    const context = h.engine.learnedContext()
    expect(context.cornerMap).toBeNull()
    expect(context.reference).toBeNull()
  })

  it('does NOT discard the learned context when the condition flickers around a threshold', () => {
    const h = warmed({ trackWetnessPct: 0, isRaining: false })
    for (let frame = 0; frame < 60; frame += 1) {
      const wet = frame % 2 === 0
      h.feed([
        snap({
          trackWetnessPct: wet ? 0.9 : 0,
          isRaining: wet,
          currentLap: 3,
          lapDistPct: 0.05 + frame * 0.001,
          timestamp: 300_000 + frame * 50
        })
      ])
    }
    expect(h.engine.learnedContext().cornerMap).not.toBeNull()
  })

  it('KEEPS the learned context across ordinary frames of the same session', () => {
    const h = warmed()
    h.feed(buildLap(3, 300_000))
    expect(h.engine.learnedContext().cornerMap).not.toBeNull()
  })

  it('KEEPS the learned context when only cosmetic metadata casing differs', () => {
    const h = warmed()
    h.feed([snap({ trackName: 'SPA-FRANCORCHAMPS', currentLap: 3, lapDistPct: 0.05, timestamp: 300_000 })])
    expect(h.engine.learnedContext().cornerMap).not.toBeNull()
  })
})
