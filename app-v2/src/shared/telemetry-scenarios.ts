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
    steeringAngleMaxDeg: 540,
    latAccelG: 0,
    longAccelG: 0.2,
    vertAccelG: 0,
    yawRateRadSec: 0.06,
    pitchRad: 0.01,
    rollRad: -0.02,
    yawRad: 1.2,
    pitchRateRadSec: 0.03,
    rollRateRadSec: -0.04,
    altitudeM: 412,
    velocityX: 58,
    velocityY: 1.5,
    velocityZ: 0.1,
    lat: 50.4372,
    lon: 5.9714,
    yawNorth: 1.2,
    drs: false,
    absActive: false,
    absEnabled: true,
    absLevel: 4,
    absCutPct: 0,
    tcActive: false,
    tcEnabled: true,
    tcLevel: 6,
    engineMap: 3,
    throttleMap: 4,
    engineBraking: 5,
    antiRollFront: 3,
    antiRollRear: 4,
    weightJackerRight: 0,
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
    trackConfigName: 'Grand Prix',
    sessionTimeRemainingSec: 2400,
    sessionNumber: 0,
    sessionTimeSec: 1820,
    lapsRemaining: 18,
    currentLap: 12,
    completedLaps: 11,
    lapDistPct: 0.4,
    lapDistanceM: 2801,
    lastLapTimeSec: 138.4,
    bestLapTimeSec: 137.9,
    bestNLapLap: 10,
    bestNLapTimeSec: 138.05,
    currentLapTimeSec: 55,
    estimatedLapTimeSec: 137.8,
    deltaToBestSec: -0.05,
    deltaToSessionBestSec: 0.1,
    position: 4,
    classPosition: 2,
    totalCars: 24,
    strengthOfField: 3100,
    onTrack: true,
    cameraCarIdx: 0,
    replayPlaying: false,
    replayFrameNum: 182000,
    replayFrameEnd: 360000,
    fuelLiters: 48,
    fuelPerLap: 2.9,
    fuelCapacityLiters: 120,
    tyres: {
      lf: { tempC: 90, tempLeftC: 88, tempMiddleC: 90, tempRightC: 92, surfaceTempLeftC: 91, surfaceTempMiddleC: 93, surfaceTempRightC: 95, pressureKpa: 165, wearPct: 0.8, wearLeftPct: 0.82, wearMiddlePct: 0.8, wearRightPct: 0.78 },
      rf: { tempC: 96, tempLeftC: 99, tempMiddleC: 96, tempRightC: 93, surfaceTempLeftC: 101, surfaceTempMiddleC: 98, surfaceTempRightC: 95, pressureKpa: 168, wearPct: 0.76, wearLeftPct: 0.73, wearMiddlePct: 0.76, wearRightPct: 0.79 },
      lr: { tempC: 86, tempLeftC: 84, tempMiddleC: 86, tempRightC: 88, surfaceTempLeftC: 86, surfaceTempMiddleC: 88, surfaceTempRightC: 90, pressureKpa: 162, wearPct: 0.84, wearLeftPct: 0.86, wearMiddlePct: 0.84, wearRightPct: 0.82 },
      rr: { tempC: 92, tempLeftC: 95, tempMiddleC: 92, tempRightC: 89, surfaceTempLeftC: 97, surfaceTempMiddleC: 94, surfaceTempRightC: 91, pressureKpa: 166, wearPct: 0.8, wearLeftPct: 0.77, wearMiddlePct: 0.8, wearRightPct: 0.83 }
    },
    brakeTempC: corners(420, 470, 300, 330),
    brakeLinePressBar: corners(42, 43, 31, 32),
    tireColdPressuresKpa: corners(150, 151, 148, 149),
    pitTyreTargetsKpa: corners(151, 152, 149, 150),
    flags: { ...NEUTRAL_FLAGS },
    pitLimiter: false,
    onPitRoad: false,
    pitFuelToAddL: 32,
    repairTimeSec: 0,
    optionalRepairTimeSec: 12,
    pitStopActive: false,
    incidentCount: 4,
    incidentLimit: 17,
    fastRepairsAvailable: 1,
    trackTempC: 31,
    airTempC: 24,
    airDensityKgM3: 1.18,
    airPressureKpa: 100.5757533,
    airPressureHg: 29.7,
    weatherType: 1,
    precipitationPct: 0,
    trackLengthKm: 7.004,
    trackWetnessPct: 0,
    isRaining: false,
    gripPct: 0.96,
    windSpeedMs: 4.2,
    windDirRad: 2.1,
    solarAltitudeRad: 0.55,
    solarAzimuthRad: 3.6,
    playerCarIdx: 0,
    drivers: [
      { carIdx: 2, name: 'M. Rossi', carNumber: '46', position: 2, classPosition: 2, classId: 7, className: 'GT3', classColor: '#FFB000', gapToPlayerSec: 1.24, relativeTimeSec: 1.24, lapDistPct: 0.408, lastLapTimeSec: 137.6, lap: 12, completedLaps: 11, estimatedTimeSec: 82.4, gear: 5, rpm: 7350, trackLocation: 3, trackSurfaceMaterial: 2, bestLapTimeSec: 137.2, bestLapNum: 8, pushToPassActive: false, pushToPassCount: 4, paceFlags: [], paceLine: 0, paceRow: 1, isPlayer: false },
      { carIdx: 0, name: 'G. Basso', carNumber: '7', position: 4, classPosition: 4, classId: 7, className: 'GT3', classColor: '#35C8E8', gapToPlayerSec: 0, relativeTimeSec: 0, lapDistPct: 0.4, lastLapTimeSec: 138.4, lap: 12, completedLaps: 11, estimatedTimeSec: 83.6, gear: 5, rpm: 7200, trackLocation: 3, trackSurfaceMaterial: 1, bestLapTimeSec: 137.9, bestLapNum: 10, pushToPassActive: false, pushToPassCount: 3, paceFlags: [], paceLine: 0, paceRow: 2, isPlayer: true },
      { carIdx: 5, name: 'A. Silva', carNumber: '23', position: 5, classPosition: 5, classId: 7, className: 'GT3', classColor: '#35C8E8', gapToPlayerSec: -0.72, relativeTimeSec: -0.72, lapDistPct: 0.395, lastLapTimeSec: 138.1, lap: 12, completedLaps: 11, estimatedTimeSec: 84.2, gear: 5, rpm: 7100, trackLocation: 3, trackSurfaceMaterial: 3, bestLapTimeSec: 137.7, bestLapNum: 9, pushToPassActive: true, pushToPassCount: 2, paceFlags: ['freePass'], paceLine: 1, paceRow: 2, isPlayer: false },
      { carIdx: 8, name: 'J. Martin', carNumber: '88', position: 6, classPosition: 6, classId: 7, className: 'GT3', classColor: '#B05CFF', gapToPlayerSec: -2.18, relativeTimeSec: -2.18, lapDistPct: 0.384, lastLapTimeSec: 139.0, lap: 12, completedLaps: 11, estimatedTimeSec: 85.4, gear: 4, rpm: 6800, inPits: false, trackLocation: 3, trackSurfaceMaterial: 1, bestLapTimeSec: 138.3, bestLapNum: 7, pushToPassActive: false, pushToPassCount: 1, paceFlags: [], paceLine: 1, paceRow: 3, isPlayer: false },
      { carIdx: 11, name: 'L. Chen', carNumber: '16', position: 7, classPosition: 7, classId: 7, className: 'GT3', classColor: '#B05CFF', gapToPlayerSec: -4.5, relativeTimeSec: -4.5, lapDistPct: 0.367, lastLapTimeSec: 139.4, lap: 12, completedLaps: 11, estimatedTimeSec: 87.1, gear: 3, rpm: 6100, inPits: true, trackLocation: 2, trackSurfaceMaterial: 5, bestLapTimeSec: 138.8, bestLapNum: 6, pushToPassActive: false, pushToPassCount: 0, paceFlags: ['endOfLine'], paceLine: 1, paceRow: 4, isPlayer: false }
    ],
    relatives: {
      ahead: { carIdx: 2, name: 'M. Rossi', carNumber: '46', position: 2, classPosition: 2, gapSec: 1.24, lastLapTimeSec: 137.6, classColor: '#FFB000' },
      behind: { carIdx: 5, name: 'A. Silva', carNumber: '23', position: 5, classPosition: 5, gapSec: -0.72, lastLapTimeSec: 138.1, classColor: '#35C8E8' }
    },
    radarCars: [
      { carIdx: 2, name: 'M. Rossi', relativeX: -3.2, relativeY: 18, gapSec: 1.24, classColor: '#FFB000' },
      { carIdx: 5, name: 'A. Silva', relativeX: 3.2, relativeY: -11, gapSec: -0.72, classColor: '#35C8E8' }
    ],
    carLeftRight: 'right',
    carLeftRightCount: 1
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
