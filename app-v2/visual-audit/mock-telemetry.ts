// Realistic mid-race TelemetrySnapshot factory for the visual-audit harness.
//
// The goal is to feed EVERY overlay widget and dashboard widget renderer with
// plausible, "interesting" values so a visual-design QA can judge layout and
// styling — not zeros/placeholders. Values model a GT3 car mid-stint, P4 of 24,
// chasing the car ahead on a warm, drying track, with a couple of cars on the
// radar and a green-after-yellow restart so flag widgets show something.
//
// The real shared type is imported so the mock can never drift from production.
import type {
  Corners,
  DriverEntry,
  Flags,
  PitStatus,
  RadarCarEntry,
  RelativeCars,
  TelemetrySnapshot,
  TyreInfo
} from '@shared/telemetry'

function corners<T>(lf: T, rf: T, lr: T, rr: T): Corners<T> {
  return { lf, rf, lr, rr }
}

function tyre(tempC: number, wearPct: number, pressureKpa: number): TyreInfo {
  return {
    tempC,
    tempLeftC: tempC + 6,
    tempMiddleC: tempC,
    tempRightC: tempC - 4,
    surfaceTempLeftC: tempC + 10,
    surfaceTempMiddleC: tempC + 3,
    surfaceTempRightC: tempC - 1,
    pressureKpa,
    wearPct
  }
}

// ─── Flag variants ───────────────────────────────────────────────────────────
// Default race condition is a green restart. Helpers expose the other states so
// the harness can render flag-heavy widgets under representative conditions.
export function flagsAllClear(): Flags {
  return {
    green: false,
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
}

export function flagsGreen(): Flags {
  return { ...flagsAllClear(), green: true }
}

// Yellow + green together — a local yellow clearing into a green restart. This is
// the explicit "yellow+green" variant the harness wants flag widgets to handle.
export function flagsYellowGreen(): Flags {
  return { ...flagsAllClear(), yellow: true, green: true }
}

export function flagsBlue(): Flags {
  return { ...flagsAllClear(), blue: true }
}

export function flagsMeatball(): Flags {
  return { ...flagsAllClear(), meatball: true, repair: true }
}

function defaultDrivers(): DriverEntry[] {
  // Two-class field (GT3 + GT4) so class colours/positions exercise the renderers.
  // Player is carIdx 7, P4 overall / P4 in GT3.
  const gt3 = '#E8A23D'
  const gt4 = '#49C5B1'
  const lmp = '#7AA2FF'
  return [
    { carIdx: 2, name: 'L. Hoffmann', carNumber: '11', position: 1, classPosition: 1, classId: 1, className: 'GT3', classColor: gt3, gapToPlayerSec: -18.4, lapDistPct: 0.61, lastLapTimeSec: 102.31, iRating: 5240, license: 'A 4.21', isPlayer: false },
    { carIdx: 4, name: 'M. Rossi', carNumber: '23', position: 2, classPosition: 2, classId: 1, className: 'GT3', classColor: gt3, gapToPlayerSec: -9.8, lapDistPct: 0.55, lastLapTimeSec: 102.66, iRating: 4880, license: 'A 3.97', isPlayer: false },
    { carIdx: 9, name: 'K. Tanaka', carNumber: '7', position: 3, classPosition: 3, classId: 1, className: 'GT3', classColor: gt3, gapToPlayerSec: -1.42, lapDistPct: 0.50, lastLapTimeSec: 102.95, iRating: 4510, license: 'A 3.55', inPits: false, isPlayer: false },
    { carIdx: 7, name: 'G. Basso', carNumber: '42', position: 4, classPosition: 4, classId: 1, className: 'GT3', classColor: gt3, gapToPlayerSec: 0, lapDistPct: 0.485, lastLapTimeSec: 103.12, iRating: 4320, license: 'A 3.40', isPlayer: true },
    { carIdx: 12, name: 'F. Dubois', carNumber: '88', position: 5, classPosition: 5, classId: 1, className: 'GT3', classColor: gt3, gapToPlayerSec: 0.88, lapDistPct: 0.47, lastLapTimeSec: 103.40, iRating: 4180, license: 'A 3.12', isPlayer: false },
    { carIdx: 18, name: 'S. Novak', carNumber: '5', position: 6, classPosition: 6, classId: 1, className: 'GT3', classColor: gt3, gapToPlayerSec: 4.6, lapDistPct: 0.41, lastLapTimeSec: 103.77, iRating: 3990, license: 'B 4.05', isPlayer: false },
    { carIdx: 21, name: 'A. Costa', carNumber: '14', position: 7, classPosition: 1, classId: 2, className: 'GT4', classColor: gt4, gapToPlayerSec: 11.9, lapDistPct: 0.33, lastLapTimeSec: 108.21, iRating: 3120, license: 'B 3.44', isPlayer: false },
    { carIdx: 25, name: 'R. Meyer', carNumber: '57', position: 8, classPosition: 2, classId: 2, className: 'GT4', classColor: gt4, gapToPlayerSec: 16.2, lapDistPct: 0.28, lastLapTimeSec: 108.66, iRating: 2870, license: 'C 3.90', inPits: true, isPlayer: false },
    { carIdx: 31, name: 'P. Andersen', carNumber: '3', position: 9, classPosition: 1, classId: 3, className: 'LMP3', classColor: lmp, gapToPlayerSec: 22.7, lapDistPct: 0.20, lastLapTimeSec: 99.84, iRating: 6010, license: 'A 4.80', isPlayer: false },
    { carIdx: 33, name: 'T. Weber', carNumber: '19', position: 10, classPosition: 7, classId: 1, className: 'GT3', classColor: gt3, gapToPlayerSec: -25.1, lapsBehind: 0, lapDistPct: 0.72, lastLapTimeSec: 104.02, iRating: 3760, license: 'B 2.98', isPlayer: false }
  ]
}

function defaultRelatives(): RelativeCars {
  return {
    ahead: { carIdx: 9, name: 'K. Tanaka', carNumber: '7', position: 3, classPosition: 3, gapSec: -1.42, lastLapTimeSec: 102.95, classColor: '#E8A23D' },
    behind: { carIdx: 12, name: 'F. Dubois', carNumber: '88', position: 5, classPosition: 5, gapSec: 0.88, lastLapTimeSec: 103.40, classColor: '#E8A23D' }
  }
}

function defaultRadar(): RadarCarEntry[] {
  // One car overlapping on the left (door-to-door) plus one just behind-right.
  return [
    { carIdx: 12, name: 'F. Dubois', relativeX: -2.1, relativeY: 1.4, gapSec: 0.31, classColor: '#E8A23D' },
    { carIdx: 25, name: 'R. Meyer', relativeX: 3.0, relativeY: -6.2, gapSec: 0.74, classColor: '#49C5B1' }
  ]
}

function defaultPit(): PitStatus {
  return { repairNeeded: false, optRepairNeeded: true, pitsOpen: true, inPitStall: false, svStatus: 0 }
}

/**
 * Build a complete, realistic mid-race snapshot. Pass `overrides` to tweak any
 * field (e.g. a different `flags` variant, rain, or a pit phase) for a specific
 * widget or scenario.
 */
export function createMockSnapshot(overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  const maxRpm = 8200
  const rpm = 7480
  const base: TelemetrySnapshot = {
    sim: 'iracing',
    connected: true,
    timestamp: Date.now(),

    // Car / engine
    speedKmh: 214,
    rpm,
    gear: 4,
    maxRpm,
    engineRunning: true,
    shiftIndicatorPct: 0.86,
    shiftRpm: 7850,
    revLights: { firstRpm: 6200, shiftRpm: 7850, lastRpm: 8050, blinkRpm: 8100, pct: 0.86, blink: false },
    throttle: 0.83,
    brake: 0,
    clutch: 0,
    steerAngleDeg: -14,
    latAccelG: -1.18,
    longAccelG: 0.42,
    vertAccelG: 0.06,
    yawRateRadSec: 0.21,
    drs: false,
    absActive: false,
    absEnabled: true,
    absLevel: 3,
    tcActive: true,
    tcEnabled: true,
    tcLevel: 4,
    engineMap: 5,
    brakeBiasPct: 54.5,
    handbrake: 0,
    waterTempC: 96,
    oilTempC: 108,
    oilPressureKpa: 470,

    // Hybrid / ERS / push-to-pass
    ersBatteryPct: 0.62,
    pushToPass: true,
    pushToPassCount: 6,

    // Session / timing
    sessionType: 'Race',
    carName: 'Mercedes-AMG GT3 Evo',
    trackName: 'Spa-Francorchamps',
    sessionTimeRemainingSec: 1865,
    lapsRemaining: 18,
    currentLap: 12,
    lapDistPct: 0.485,
    lastLapTimeSec: 103.12,
    bestLapTimeSec: 102.88,
    currentLapTimeSec: 47.36,
    estimatedLapTimeSec: 102.74,
    deltaToBestSec: -0.143,
    deltaToSessionBestSec: 0.212,
    position: 4,
    classPosition: 4,
    totalCars: 24,
    strengthOfField: 4180,
    sessionUniqueId: 990217,
    driverName: 'G. Basso',
    sessionTimeOfDay: 15 * 3600 + 42 * 60,

    // BoP
    weightPenaltyKg: 15,
    powerAdjustPct: -1.5,

    // Fuel
    fuelLiters: 38.4,
    fuelPerLap: 2.86,
    fuelPerLapLiters: 2.86,
    fuelLapsRemaining: 38.4 / 2.86,
    fuelUsePerHourKg: 71.5,
    fuelPerLapKg: 2.12,
    fuelCapacityLiters: 120,

    // Tyres / brakes
    tyres: corners(
      tyre(88, 0.91, 168),
      tyre(94, 0.88, 171),
      tyre(85, 0.93, 165),
      tyre(90, 0.90, 167)
    ),
    brakeTempC: corners(486, 512, 372, 398),
    tireColdPressuresKpa: corners(165, 166, 163, 164),

    // Flags / pit / incidents
    flags: flagsYellowGreen(),
    sessionFlagsRaw: 0,
    pitLimiter: false,
    onPitRoad: false,
    pitServiceFlags: ['fuel', 'lf', 'rf'],
    pit: defaultPit(),
    incidentCount: 6,
    incidentCountMy: 6,
    incidentCountTeam: 6,
    incidentLimit: 17,
    fastRepairsUsed: 0,
    fastRepairsAvailable: 1,

    // Weather (warm, drying)
    trackTempC: 34,
    airTempC: 25,
    trackWetnessPct: 0.08,
    isRaining: false,
    gripPct: 0.96,
    weatherDeclaredWet: false,
    trackSurfaceMaterial: 1,

    // Standings / relative / radar
    playerCarIdx: 7,
    drivers: defaultDrivers(),
    relatives: defaultRelatives(),
    radarCars: defaultRadar(),
    carLeftRight: 'left',
    carLeftRightRaw: 2,

    // Position / orientation (for track-map builders)
    lat: 50.4372,
    lon: 5.9714,
    velocityX: 59.4,
    velocityY: 1.2,
    yawNorth: 2.31
  }

  return { ...base, ...overrides }
}

export default createMockSnapshot
