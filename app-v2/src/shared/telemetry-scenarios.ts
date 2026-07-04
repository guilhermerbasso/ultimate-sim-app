// Deterministic, dependency-free telemetry scenarios for iterating and validating
// dashboards/overlays WITHOUT a live sim session. Every frame is a pure function of
// a normalised time `t` in [0,1] — same input always yields the same snapshot — so
// they can drive unit tests, visual-regression captures and design previews.
//
// These are DATA only: they never touch the telemetry hub or providers. To replay
// one through the app you can feed `frame(t)` into any consumer that takes a
// `TelemetrySnapshot` (e.g. a preview harness), or extend the mock provider to call
// a scenario's `frame()` instead of its built-in lap.

import type { Corners, Flags, TelemetrySnapshot } from './telemetry'

const NEUTRAL_FLAGS: Flags = {
  green: true,
  yellow: false,
  blue: false,
  white: false,
  checkered: false,
  red: false,
  black: false,
  meatball: false,
  repair: false,
  disqualify: false,
  greenWhiteCheckered: false
}

function corners(lf: number, rf: number, lr: number, rr: number): Corners<number> {
  return { lf, rf, lr, rr }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t))
}

/** A plausible mid-race GT3 baseline. Scenarios start from this and mutate fields. */
export function baseSnapshot(): TelemetrySnapshot {
  return {
    sim: 'replay',
    connected: true,
    timestamp: 0,
    speedKmh: 210,
    rpm: 7200,
    gear: 5,
    maxRpm: 8200,
    shiftIndicatorPct: 0.7,
    throttle: 0.9,
    brake: 0,
    clutch: 0,
    steerAngleDeg: 0,
    latAccelG: 0,
    longAccelG: 0.2,
    vertAccelG: 0,
    drs: false,
    absActive: false,
    absEnabled: true,
    absLevel: 4,
    absCutPct: 0,
    tcActive: false,
    tcEnabled: true,
    tcLevel: 6,
    engineMap: 3,
    engineWarnings: {
      waterTemp: false,
      fuelPressure: false,
      oilPressure: false,
      oilTemp: false,
      stalled: false,
      pitLimiter: false,
      revLimiter: false,
      mandRepair: false,
      optRepair: false
    },
    brakeBiasPct: 54.5,
    handbrake: 0,
    waterTempC: 92,
    oilTempC: 108,
    oilPressureKpa: 430,
    sessionType: 'RACE',
    sessionState: 'racing',
    paceMode: 'notPacing',
    paceFlags: [],
    carName: 'GT3',
    trackName: 'Spa-Francorchamps',
    sessionTimeRemainingSec: 2400,
    lapsRemaining: 18,
    currentLap: 12,
    lapDistPct: 0.4,
    lastLapTimeSec: 138.4,
    bestLapTimeSec: 137.9,
    currentLapTimeSec: 55,
    estimatedLapTimeSec: 137.8,
    deltaToBestSec: -0.05,
    deltaToSessionBestSec: 0.1,
    position: 4,
    classPosition: 2,
    totalCars: 24,
    strengthOfField: 3100,
    fuelLiters: 48,
    fuelPerLap: 2.9,
    fuelCapacityLiters: 120,
    tyres: {
      lf: { tempC: 90, pressureKpa: 165, wearPct: 0.8 },
      rf: { tempC: 96, pressureKpa: 168, wearPct: 0.76 },
      lr: { tempC: 86, pressureKpa: 162, wearPct: 0.84 },
      rr: { tempC: 92, pressureKpa: 166, wearPct: 0.8 }
    },
    brakeTempC: corners(420, 470, 300, 330),
    flags: { ...NEUTRAL_FLAGS },
    pitLimiter: false,
    onPitRoad: false,
    incidentCount: 4,
    incidentLimit: 17,
    fastRepairsAvailable: 1,
    trackTempC: 31,
    airTempC: 24,
    trackWetnessPct: 0,
    isRaining: false,
    gripPct: 0.96,
    playerCarIdx: 0
  }
}

export type TelemetryScenarioId =
  | 'flying-lap'
  | 'hard-braking'
  | 'shift-light-sweep'
  | 'low-fuel'
  | 'yellow-flag'
  | 'pit-stop'
  | 'overheat'
  | 'rain-race'

export interface TelemetryScenario {
  id: TelemetryScenarioId
  label: string
  /** Suggested loop length when played back in real time. */
  durationSec: number
  /** Pure frame sampler: `t` in [0,1] → a complete snapshot. */
  frame: (t: number) => TelemetrySnapshot
}

function withTimestamp(snap: TelemetrySnapshot, t: number, durationSec: number): TelemetrySnapshot {
  snap.timestamp = Math.round(t * durationSec * 1000)
  return snap
}

export const TELEMETRY_SCENARIOS: Record<TelemetryScenarioId, TelemetryScenario> = {
  'flying-lap': {
    id: 'flying-lap',
    label: 'Flying lap',
    durationSec: 138,
    frame: (t) => {
      const s = baseSnapshot()
      const corner = 0.5 + 0.5 * Math.sin(t * Math.PI * 8)
      s.speedKmh = lerp(90, 295, corner)
      s.rpm = lerp(4200, 8100, corner)
      s.gear = Math.max(2, Math.min(6, Math.round(lerp(2, 6, corner))))
      s.throttle = Math.max(0, corner)
      s.brake = Math.max(0, -Math.sin(t * Math.PI * 8)) * 0.85
      s.shiftIndicatorPct = Math.min(1, Math.max(0, (s.rpm - 7300) / 900))
      s.lapDistPct = t
      s.deltaToBestSec = Math.sin(t * Math.PI * 2) * 0.3 - 0.1
      s.latAccelG = Math.sin(t * Math.PI * 8) * 1.4
      s.longAccelG = s.brake > 0.1 ? -1.6 * s.brake : 0.6 * s.throttle
      return withTimestamp(s, t, 138)
    }
  },
  'hard-braking': {
    id: 'hard-braking',
    label: 'Hard braking into a hairpin',
    durationSec: 6,
    frame: (t) => {
      const s = baseSnapshot()
      const brakeCurve = Math.sin(Math.min(1, t * 1.4) * Math.PI)
      s.brake = brakeCurve
      s.throttle = Math.max(0, 1 - brakeCurve * 1.4)
      s.speedKmh = lerp(280, 95, brakeCurve)
      s.rpm = lerp(7900, 4600, brakeCurve)
      s.gear = Math.max(2, Math.round(lerp(6, 2, brakeCurve)))
      s.absActive = brakeCurve > 0.75
      s.absCutPct = s.absActive ? Math.round(brakeCurve * 22) : 0
      // Diving up the inside under braking — two cars stack to the left.
      s.carLeftRight = 'left'
      s.carLeftRightRaw = 5
      s.carLeftRightCount = 2
      s.longAccelG = -2.4 * brakeCurve
      s.brakeTempC = corners(
        lerp(420, 760, brakeCurve),
        lerp(470, 810, brakeCurve),
        lerp(300, 520, brakeCurve),
        lerp(330, 560, brakeCurve)
      )
      return withTimestamp(s, t, 6)
    }
  },
  'shift-light-sweep': {
    id: 'shift-light-sweep',
    label: 'Shift-light sweep (LED rig test)',
    durationSec: 3,
    frame: (t) => {
      const s = baseSnapshot()
      s.shiftIndicatorPct = t
      s.rpm = lerp(3500, 8200, t)
      s.speedKmh = lerp(120, 265, t)
      s.gear = 4
      s.throttle = 1
      s.revLights = { pct: t, blink: t >= 0.97, firstRpm: 6800, shiftRpm: 8000, lastRpm: 8200 }
      return withTimestamp(s, t, 3)
    }
  },
  'low-fuel': {
    id: 'low-fuel',
    label: 'Low fuel — final laps',
    durationSec: 90,
    frame: (t) => {
      const s = baseSnapshot()
      s.fuelLiters = lerp(6.5, 0.6, t)
      s.lapsRemaining = Math.max(0, Math.round(lerp(2, 0, t)))
      s.fuelPerLap = 2.9
      s.lapDistPct = (t * 2) % 1
      return withTimestamp(s, t, 90)
    }
  },
  'yellow-flag': {
    id: 'yellow-flag',
    label: 'Local yellow + slow zone',
    durationSec: 20,
    frame: (t) => {
      const s = baseSnapshot()
      s.flags = { ...NEUTRAL_FLAGS, green: false, yellow: true }
      s.speedKmh = lerp(240, 110, Math.sin(Math.min(1, t * 2) * Math.PI * 0.5))
      s.throttle = 0.3
      s.brake = t < 0.3 ? 0.5 : 0
      return withTimestamp(s, t, 20)
    }
  },
  'pit-stop': {
    id: 'pit-stop',
    label: 'Pit entry with limiter',
    durationSec: 30,
    frame: (t) => {
      const s = baseSnapshot()
      s.onPitRoad = true
      s.pitLimiter = true
      s.speedKmh = 60
      s.rpm = 4200
      s.gear = 2
      s.throttle = 0.35
      s.pitServiceFlags = ['fuel', 'lf', 'rf', 'lr', 'rr']
      // Pit speed limiter is engaged → the EngineWarnings pitLimiter lamp lights.
      s.engineWarnings = { ...s.engineWarnings!, pitLimiter: true }
      s.lapDistPct = lerp(0.96, 0.04, t)
      return withTimestamp(s, t, 30)
    }
  },
  overheat: {
    id: 'overheat',
    label: 'Engine overheating',
    durationSec: 40,
    frame: (t) => {
      const s = baseSnapshot()
      s.waterTempC = lerp(104, 124, t)
      s.oilTempC = lerp(118, 146, t)
      s.oilPressureKpa = lerp(360, 210, t)
      s.engineMap = 1
      s.throttle = 0.7
      // Rising temps trip the water/oil-temp warning lamps partway through.
      s.engineWarnings = { ...s.engineWarnings!, waterTemp: t > 0.4, oilTemp: t > 0.6 }
      return withTimestamp(s, t, 40)
    }
  },
  'rain-race': {
    id: 'rain-race',
    label: 'Rain — wet track',
    durationSec: 60,
    frame: (t) => {
      const s = baseSnapshot()
      s.isRaining = true
      s.weatherDeclaredWet = true
      s.trackWetnessPct = lerp(0.2, 0.9, t)
      s.gripPct = lerp(0.86, 0.62, t)
      s.tcActive = true
      s.speedKmh = lerp(210, 175, t)
      s.airTempC = 16
      s.trackTempC = 18
      return withTimestamp(s, t, 60)
    }
  }
}

export const TELEMETRY_SCENARIO_IDS = Object.keys(TELEMETRY_SCENARIOS) as TelemetryScenarioId[]

/** Sample a scenario into `frames` evenly spaced snapshots over [0,1]. */
export function sampleScenario(id: TelemetryScenarioId, frames: number): TelemetrySnapshot[] {
  const scenario = TELEMETRY_SCENARIOS[id]
  const n = Math.max(1, Math.floor(frames))
  const out: TelemetrySnapshot[] = []
  for (let i = 0; i < n; i++) {
    out.push(scenario.frame(n === 1 ? 0 : i / (n - 1)))
  }
  return out
}
