import {
  carLeftRightCountFromEnum,
  type Corners,
  type DriverEntry,
  type RadarCarEntry,
  type TelemetrySnapshot
} from './telemetry'
import { baseSnapshot } from './telemetry-scenarios'

export const RACECON_MOCK_DASHBOARD_IDS = [
  'RC-01',
  'RC-02',
  'RC-03',
  'RC-04',
  'RC-05',
  'RC-06',
  'RC-07',
  'RC-08',
  'RC-09',
  'RC-10',
  'RC-11',
  'RC-12',
  'RC-13',
  'RC-14',
  'RC-15',
  'RC-16',
  'RC-17',
  'RC-18',
  'RC-19',
  'RC-20'
] as const

export type RaceConMockDashboardId = (typeof RACECON_MOCK_DASHBOARD_IDS)[number]

export type RaceConMockPhase =
  | 'attack'
  | 'qualifying'
  | 'endurance'
  | 'pit-approach'
  | 'pit-limiter'
  | 'pit-service'
  | 'pit-release'
  | 'thermal'
  | 'fuel-saving'
  | 'traffic'
  | 'wet'
  | 'stage'
  | 'accessible'
  | 'analysis'
  | 'broadcast'
  | 'safety-car'
  | 'fault'
  | 'balance'
  | 'coaching'
  | 'oval'
  | 'setup-compare'
  | 'handover'
  | 'formation'
  | 'grid'
  | 'lights'
  | 'launch'

export type RaceConMockValue = number | string | boolean | null

export interface RaceConMockChannelSample {
  value: RaceConMockValue
  unit: string
  available: boolean
  synthetic: true
}

export interface RaceConMockFrame {
  scenarioId: RaceConMockDashboardId
  title: string
  elapsedSec: number
  normalizedTime: number
  phase: RaceConMockPhase
  snapshot: TelemetrySnapshot
  channels: Readonly<Record<string, RaceConMockChannelSample>>
}

export interface RaceConMockScenario {
  id: RaceConMockDashboardId
  title: string
  durationSec: number
  frame: (elapsedSec: number) => RaceConMockFrame
}

interface ScenarioContext {
  snapshot: TelemetrySnapshot
  channels: Record<string, RaceConMockChannelSample>
  elapsedSec: number
  localSec: number
  t: number
}

type ScenarioConfigurer = (context: ScenarioContext) => RaceConMockPhase

const LAP_DURATION_SEC = 92
const PIT_SPEED_LIMIT_KMH = 60
const LAP_ROLLOVER_EPSILON = 1e-9

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t)
}

function finiteElapsed(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function cycle(value: number, duration: number): number {
  return ((value % duration) + duration) % duration
}

function corners<T>(lf: T, rf: T, lr: T, rr: T): Corners<T> {
  return { lf, rf, lr, rr }
}

function gearForSpeed(speedKmh: number): number {
  if (speedKmh < 90) return 2
  if (speedKmh < 135) return 3
  if (speedKmh < 190) return 4
  if (speedKmh < 245) return 5
  return 6
}

function sample(value: RaceConMockValue | undefined, unit: string): RaceConMockChannelSample {
  return {
    value: value ?? null,
    unit,
    available: value !== undefined && value !== null,
    synthetic: true
  }
}

function setSample(
  channels: Record<string, RaceConMockChannelSample>,
  id: string,
  value: RaceConMockValue | undefined,
  unit = ''
): void {
  channels[id] = sample(value, unit)
}

function syncFuelDerivedFields(snapshot: TelemetrySnapshot): void {
  const fuelLiters = snapshot.fuelLiters
  const fuelPerLapLiters = snapshot.fuelPerLapLiters
  const fuelCapacityLiters = snapshot.fuelCapacityLiters

  if (typeof fuelLiters !== 'number' || !Number.isFinite(fuelLiters) || fuelLiters < 0) return

  snapshot.fuelMassKg = fuelLiters * 0.75
  snapshot.fuelLevelPct =
    typeof fuelCapacityLiters === 'number' && Number.isFinite(fuelCapacityLiters) && fuelCapacityLiters > 0
      ? clamp(fuelLiters / fuelCapacityLiters)
      : undefined

  if (
    typeof fuelPerLapLiters === 'number' &&
    Number.isFinite(fuelPerLapLiters) &&
    fuelPerLapLiters > 0
  ) {
    snapshot.fuelPerLap = fuelPerLapLiters
    snapshot.fuelPerLapKg = fuelPerLapLiters * 0.75
    snapshot.fuelLapsRemaining = fuelLiters / fuelPerLapLiters
  } else {
    snapshot.fuelPerLap = undefined
    snapshot.fuelPerLapKg = undefined
    snapshot.fuelLapsRemaining = undefined
  }
}

function syncRevLightsAndWarnings(snapshot: TelemetrySnapshot): void {
  const firstRpm = snapshot.revLights?.firstRpm ?? 6800
  const shiftRpm = snapshot.shiftRpm ?? snapshot.revLights?.shiftRpm ?? 7900
  const lastRpm = snapshot.revLights?.lastRpm ?? 8100
  const blinkRpm = snapshot.revLights?.blinkRpm ?? 8150
  const band = Math.max(1, shiftRpm - firstRpm)
  const pct = clamp((snapshot.rpm - firstRpm) / band)

  snapshot.shiftRpm = shiftRpm
  snapshot.shiftIndicatorPct = pct
  snapshot.revLights = {
    firstRpm,
    shiftRpm,
    lastRpm,
    blinkRpm,
    pct,
    blink: snapshot.rpm >= blinkRpm
  }
  const warnings = snapshot.engineWarnings
  snapshot.engineWarnings = {
    waterTemp: warnings?.waterTemp ?? false,
    fuelPressure: warnings?.fuelPressure ?? false,
    oilPressure: warnings?.oilPressure ?? false,
    oilTemp: warnings?.oilTemp ?? false,
    stalled: warnings?.stalled ?? false,
    pitLimiter: snapshot.pitLimiter === true,
    revLimiter: snapshot.rpm >= lastRpm,
    mandRepair: warnings?.mandRepair ?? false,
    optRepair: warnings?.optRepair ?? false
  }
}

function syncStandings(snapshot: TelemetrySnapshot): void {
  const position = Math.max(1, Math.trunc(snapshot.position ?? 2))
  const lap = Math.max(1, Math.trunc(snapshot.currentLap ?? 1))
  const completedLaps = Math.max(0, Math.trunc(snapshot.completedLaps ?? lap - 1))
  const lapDistPct = clamp(snapshot.lapDistPct ?? 0)
  const lastLapTimeSec = snapshot.lastLapTimeSec
  const classColor = '#35C8E8'
  const radarGeometry = snapshot.radarCars ?? []
  const behindRadarCount = radarGeometry.filter((radar) => radar.relativeY < 0).length
  const fieldSize = Math.max(3, position + Math.max(1, behindRadarCount), radarGeometry.length + 1)
  const drivers: DriverEntry[] = Array.from({ length: fieldSize }, (_, index) => {
    const driverPosition = index + 1
    const positionDelta = position - driverPosition
    const isPlayer = driverPosition === position
    const rawLapDistPct = lapDistPct + positionDelta * 0.01
    const lapOffset =
      rawLapDistPct >= 1 - LAP_ROLLOVER_EPSILON
        ? 1
        : rawLapDistPct < -LAP_ROLLOVER_EPSILON
          ? -1
          : 0
    const driverLap = Math.max(1, lap + lapOffset)
    const gapToPlayerSec = isPlayer
      ? 0
      : positionDelta > 0
        ? positionDelta * 1.25
        : positionDelta * 0.9
    return {
      carIdx: isPlayer ? 0 : 100 + driverPosition,
      name: isPlayer ? (snapshot.driverName ?? 'Mock Driver') : `Mock P${driverPosition}`,
      carNumber: isPlayer ? '7' : String(10 + driverPosition),
      position: driverPosition,
      classPosition: driverPosition,
      classId: 1,
      className: 'GT3',
      classColor,
      gapToPlayerSec,
      lapDistPct: cycle(rawLapDistPct, 1),
      lastLapTimeSec:
        lastLapTimeSec === undefined ? undefined : lastLapTimeSec - positionDelta * 0.25,
      lap: driverLap,
      completedLaps: Math.max(0, completedLaps + driverLap - lap),
      gear: isPlayer ? snapshot.gear : undefined,
      rpm: isPlayer ? snapshot.rpm : undefined,
      isPlayer
    }
  })
  const defaultGeometry: RadarCarEntry[] = []
  if (position > 1) defaultGeometry.push({ carIdx: -1, relativeX: -2.5, relativeY: 16 })
  if (position < fieldSize) defaultGeometry.push({ carIdx: -2, relativeX: 3, relativeY: -9 })
  const geometry: RadarCarEntry[] = radarGeometry.length > 0 ? radarGeometry : defaultGeometry
  const availableAhead = drivers
    .filter((driver) => driver.position < position)
    .sort((a, b) => b.position - a.position)
  const availableBehind = drivers
    .filter((driver) => driver.position > position)
    .sort((a, b) => a.position - b.position)
  const remaining = drivers.filter((driver) => !driver.isPlayer)
  const radarAssignments = geometry.map((radar) => {
    const directional = radar.relativeY >= 0 ? availableAhead : availableBehind
    const driver = directional.shift() ?? remaining.find((candidate) => !directional.includes(candidate))
    if (driver === undefined) return undefined

    const remainingIndex = remaining.indexOf(driver)
    if (remainingIndex >= 0) remaining.splice(remainingIndex, 1)
    const name = radar.name ?? driver.name
    const prototype = /prototype|hypercar|lmp/i.test(name)
    const gapMagnitude = Math.abs(radar.gapSec ?? driver.gapToPlayerSec ?? 0.5)
    driver.name = name
    driver.classId = prototype ? 2 : 1
    driver.className = prototype ? 'Prototype' : 'GT3'
    driver.classColor = radar.classColor ?? driver.classColor
    driver.gapToPlayerSec = radar.relativeY >= 0 ? gapMagnitude : -gapMagnitude
    return { radar, driver }
  }).filter((assignment) => assignment !== undefined)

  const classCounts = new Map<number, number>()
  for (const driver of drivers) {
    const nextClassPosition = (classCounts.get(driver.classId) ?? 0) + 1
    classCounts.set(driver.classId, nextClassPosition)
    driver.classPosition = nextClassPosition
  }
  const player = drivers.find((driver) => driver.isPlayer)
  const ahead = drivers.find((driver) => driver.position === position - 1)
  const behind = drivers.find((driver) => driver.position === position + 1)

  snapshot.position = position
  snapshot.classPosition = player?.classPosition ?? position
  snapshot.playerCarIdx = 0
  snapshot.drivers = drivers
  snapshot.totalCars = drivers.length
  snapshot.relatives = {
    ahead:
      ahead === undefined
        ? undefined
        : {
            carIdx: ahead.carIdx,
            name: ahead.name,
            carNumber: ahead.carNumber,
            position: ahead.position,
            classPosition: ahead.classPosition,
            gapSec: ahead.gapToPlayerSec,
            lastLapTimeSec: ahead.lastLapTimeSec,
            classColor: ahead.classColor
          },
    behind:
      behind === undefined
        ? undefined
        : {
            carIdx: behind.carIdx,
            name: behind.name,
            carNumber: behind.carNumber,
            position: behind.position,
            classPosition: behind.classPosition,
            gapSec: behind.gapToPlayerSec,
            lastLapTimeSec: behind.lastLapTimeSec,
            classColor: behind.classColor
          }
  }
  snapshot.radarCars = radarAssignments.map(({ radar, driver }) => {
    return {
      carIdx: driver.carIdx,
      name: driver.name,
      relativeX: radar.relativeX,
      relativeY: radar.relativeY,
      gapSec: driver.gapToPlayerSec,
      classColor: driver.classColor
    }
  })
}

function setSpatialPosition(snapshot: TelemetrySnapshot, lapDistPct: number): void {
  const normalizedLapDistPct = cycle(lapDistPct, 1)
  const theta = normalizedLapDistPct * Math.PI * 2
  const xMeters = 1000 * Math.cos(theta) + 80 * Math.sin(3 * theta)
  const yMeters = 600 * Math.sin(theta) + 50 * Math.sin(5 * theta)
  const dxDtheta = -1000 * Math.sin(theta) + 240 * Math.cos(3 * theta)
  const dyDtheta = 600 * Math.cos(theta) + 250 * Math.cos(5 * theta)
  const originLat = 50.4372
  const originLon = 5.9714
  const metersPerDegLat = 111_320
  const metersPerDegLon = metersPerDegLat * Math.cos((originLat * Math.PI) / 180)

  snapshot.lapDistPct = normalizedLapDistPct
  snapshot.lapDistanceM = normalizedLapDistPct * 7004
  snapshot.currentLapTimeSec = normalizedLapDistPct * LAP_DURATION_SEC
  snapshot.lat = originLat + yMeters / metersPerDegLat
  snapshot.lon = originLon + xMeters / metersPerDegLon
  snapshot.yawNorth = Math.atan2(dxDtheta, dyDtheta)
}

function syncKinematics(snapshot: TelemetrySnapshot): void {
  snapshot.velocityX = snapshot.speedKmh / 3.6
  snapshot.velocityY = 0
  if (snapshot.speedKmh > 0.5) return

  if (snapshot.pit?.inPitStall === true) {
    setSpatialPosition(snapshot, 0.985)
  } else if (snapshot.sessionType === 'Race Start') {
    setSpatialPosition(snapshot, 0.02)
  }
  snapshot.velocityX = 0
  snapshot.velocityY = 0
  snapshot.velocityZ = 0
  snapshot.latAccelG = 0
  snapshot.longAccelG = 0
  snapshot.vertAccelG = 0
  snapshot.yawRateRadSec = 0
  snapshot.absActive = false
  snapshot.tcActive = false
  snapshot.absCutPct = 0
}

function buildBaseSnapshot(elapsedSec: number): TelemetrySnapshot {
  const elapsed = finiteElapsed(elapsedSec)
  const lapPct = cycle(elapsed, LAP_DURATION_SEC) / LAP_DURATION_SEC
  const lap = 12 + Math.floor(elapsed / LAP_DURATION_SEC)
  const sessionTimeSec = elapsed + 11 * LAP_DURATION_SEC
  const cornerWave = Math.sin(lapPct * Math.PI * 6)
  const braking = clamp(-cornerWave * 1.15)
  const throttle = clamp(0.25 + cornerWave * 0.95)
  const speedKmh = clamp(178 + cornerWave * 112, 68, 296)
  const gear = gearForSpeed(speedKmh)
  const maxRpm = 8200
  const rpm = clamp(3900 + (speedKmh / 296) * 4100 + cornerWave * 180, 3300, 8150)
  const shiftIndicatorPct = clamp((rpm - 6800) / 1300)
  const fuelPerLapLiters = 2.75
  const fuelCapacityLiters = 120
  const fuelLiters = Math.max(0, 76 - (elapsed / LAP_DURATION_SEC) * fuelPerLapLiters)
  const waterTempC = 92 + Math.sin(elapsed * 0.035) * 3
  const oilTempC = 108 + Math.sin(elapsed * 0.028) * 4
  const deltaToBestSec = Math.sin(lapPct * Math.PI * 2) * 0.28 - 0.05

  const theta = lapPct * Math.PI * 2
  const xMeters = 1000 * Math.cos(theta) + 80 * Math.sin(3 * theta)
  const yMeters = 600 * Math.sin(theta) + 50 * Math.sin(5 * theta)
  const dxDtheta = -1000 * Math.sin(theta) + 240 * Math.cos(3 * theta)
  const dyDtheta = 600 * Math.cos(theta) + 250 * Math.cos(5 * theta)
  const dThetaDt = (Math.PI * 2) / LAP_DURATION_SEC
  const vEast = dxDtheta * dThetaDt
  const vNorth = dyDtheta * dThetaDt
  const speedMs = Math.hypot(vEast, vNorth)
  const originLat = 50.4372
  const originLon = 5.9714
  const metersPerDegLat = 111_320
  const metersPerDegLon = metersPerDegLat * Math.cos((originLat * Math.PI) / 180)

  const base = baseSnapshot()
  const tyreBase = 82 + elapsed / 900
  const tyreHeatFront = braking * 22
  const tyreHeatRear = throttle * 16
  const tyreWear = clamp(0.97 - elapsed / 12_000, 0.55, 0.97)

  return {
    ...base,
    sim: 'mock',
    timestamp: Math.round(elapsed * 1000),
    speedKmh,
    rpm,
    gear,
    maxRpm,
    engineRunning: true,
    shiftIndicatorPct,
    shiftRpm: 7900,
    revLights: {
      firstRpm: 6800,
      shiftRpm: 7900,
      lastRpm: 8100,
      blinkRpm: 8150,
      pct: shiftIndicatorPct,
      blink: rpm >= 8100
    },
    throttle,
    brake: braking,
    clutch: 0,
    steerAngleDeg: cornerWave * 105,
    steeringAngleMaxDeg: 540,
    latAccelG: cornerWave * 1.55,
    longAccelG: throttle * 0.62 - braking * 2.2,
    vertAccelG: Math.sin(lapPct * Math.PI * 16) * 0.08,
    yawRateRadSec: cornerWave * 0.52,
    velocityX: speedMs,
    velocityY: 0,
    velocityZ: 0,
    lat: originLat + yMeters / metersPerDegLat,
    lon: originLon + xMeters / metersPerDegLon,
    yawNorth: Math.atan2(vEast, vNorth),
    absActive: braking > 0.76,
    absEnabled: true,
    absLevel: 4,
    absCutPct: braking > 0.76 ? Math.round(braking * 20) : 0,
    tcActive: throttle > 0.86 && speedKmh < 145,
    tcEnabled: true,
    tcLevel: 5,
    engineMap: 3,
    throttleMap: 4,
    engineBraking: 5,
    brakeBiasPct: 54.2 + Math.sin(elapsed * 0.04) * 0.8,
    waterTempC,
    oilTempC,
    oilPressureKpa: 410 + throttle * 85,
    manifoldPressBar: 0.45 + throttle * 1.55,
    fuelPressBar: 4.8,
    voltage: 13.8 + Math.sin(elapsed * 0.07) * 0.18,
    waterLevelL: 7.2,
    oilLevelL: 5.8,
    engineWarnings: {
      waterTemp: waterTempC >= 108,
      fuelPressure: false,
      oilPressure: false,
      oilTemp: oilTempC >= 130,
      stalled: false,
      pitLimiter: false,
      revLimiter: rpm >= 8100,
      mandRepair: false,
      optRepair: false
    },
    sessionType: 'Race',
    sessionKind: 'race',
    sessionState: 'racing',
    paceMode: 'notPacing',
    paceFlags: [],
    carName: 'Mock GT3',
    carPath: 'mock-gt3',
    trackName: 'Mock Grand Prix Circuit',
    trackConfigName: 'Grand Prix',
    sessionTimeRemainingSec: Math.max(0, 3600 - sessionTimeSec),
    sessionTimeSec,
    lapsRemaining: Math.max(0, 38 - lap),
    currentLap: lap,
    completedLaps: Math.max(0, lap - 1),
    lapDistPct: lapPct,
    lapDistanceM: lapPct * 7004,
    lastLapTimeSec: 90.7 + Math.sin(lap) * 0.35,
    lapValidity: 'valid',
    bestLapTimeSec: 90.2,
    bestNLapLap: undefined,
    bestNLapTimeSec: undefined,
    currentLapTimeSec: lapPct * LAP_DURATION_SEC,
    estimatedLapTimeSec: 90.2 + deltaToBestSec,
    deltaToBestSec,
    deltaToSessionBestSec: deltaToBestSec + 0.12,
    position: 2,
    classPosition: 2,
    totalCars: 24,
    strengthOfField: 3200,
    sessionUniqueId: 7001,
    driverName: 'Mock Driver',
    onTrack: undefined,
    replayPlaying: false,
    fuelLiters,
    fuelLevelPct: fuelLiters / fuelCapacityLiters,
    fuelMassKg: fuelLiters * 0.75,
    fuelPerLap: fuelPerLapLiters,
    fuelPerLapLiters,
    fuelPerLapKg: fuelPerLapLiters * 0.75,
    fuelLapsRemaining: fuelLiters / fuelPerLapLiters,
    fuelCapacityLiters,
    tyres: {
      lf: { tempC: tyreBase + tyreHeatFront + 2, pressureKpa: 165 + braking * 4, wearPct: tyreWear },
      rf: { tempC: tyreBase + tyreHeatFront + 5, pressureKpa: 166 + braking * 4.5, wearPct: tyreWear - 0.01 },
      lr: { tempC: tyreBase - 2 + tyreHeatRear, pressureKpa: 162 + throttle * 3, wearPct: tyreWear + 0.01 },
      rr: { tempC: tyreBase + tyreHeatRear, pressureKpa: 163 + throttle * 3.5, wearPct: tyreWear }
    },
    brakeTempC: corners(
      330 + braking * 420,
      340 + braking * 440,
      250 + braking * 280,
      260 + braking * 300
    ),
    brakeLinePressBar: corners(
      braking * 88,
      braking * 90,
      braking * 64,
      braking * 66
    ),
    tireColdPressuresKpa: corners(151, 152, 149, 150),
    pitTyreTargetsKpa: corners(152, 153, 150, 151),
    flags: {
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
    },
    raceControlState: 'known',
    pitLimiter: false,
    onPitRoad: false,
    pitServiceFlags: [],
    pitFuelToAddL: 0,
    repairTimeSec: 0,
    optionalRepairTimeSec: 0,
    pitStopActive: false,
    refuelServiceActive: false,
    pit: { inPitStall: false, repairNeeded: false, optRepairNeeded: false, pitsOpen: true },
    trackTempC: 31,
    airTempC: 24,
    trackWetnessPct: 0,
    isRaining: false,
    gripPct: 0.96,
    weatherDeclaredWet: false,
    precipitationPct: 0,
    trackLengthKm: 7.004,
    tyreStatePct: tyreWear,
    trafficDensity: 0.2,
    flagStateIndex: 0,
    damagePct: 0,
    towReset: false,
    playerCarIdx: 0,
    carLeftRight: 'clear',
    carLeftRightRaw: 1,
    carLeftRightCount: undefined,
    radarCars: []
  }
}

function buildCoreChannels(snapshot: TelemetrySnapshot): Record<string, RaceConMockChannelSample> {
  const channels: Record<string, RaceConMockChannelSample> = {}
  setSample(channels, 'engine.rpm', snapshot.rpm, '1/min')
  setSample(channels, 'vehicle.speed', snapshot.speedKmh, 'km/h')
  setSample(channels, 'vehicle.gear', snapshot.gear, 'gear')
  setSample(channels, 'driver.throttle', snapshot.throttle * 100, '%')
  setSample(channels, 'driver.brake', snapshot.brake * 100, '%')
  setSample(channels, 'driver.clutch', snapshot.clutch * 100, '%')
  setSample(channels, 'driver.steering', snapshot.steerAngleDeg, 'deg')
  setSample(channels, 'vehicle.accel.lateral', snapshot.latAccelG, 'g')
  setSample(channels, 'vehicle.accel.longitudinal', snapshot.longAccelG, 'g')
  setSample(channels, 'engine.waterTemp', snapshot.waterTempC, 'degC')
  setSample(channels, 'engine.oilTemp', snapshot.oilTempC, 'degC')
  setSample(channels, 'engine.oilPressure', snapshot.oilPressureKpa, 'kPa')
  setSample(channels, 'engine.fuelPressure', snapshot.fuelPressBar, 'bar')
  setSample(channels, 'electrical.voltage', snapshot.voltage, 'V')
  setSample(channels, 'driver.tcLevel', snapshot.tcLevel, 'step')
  setSample(channels, 'driver.absLevel', snapshot.absLevel, 'step')
  setSample(channels, 'driver.brakeBias', snapshot.brakeBiasPct, '%')
  setSample(channels, 'fuel.level', snapshot.fuelLiters, 'L')
  setSample(channels, 'fuel.perLap', snapshot.fuelPerLapLiters, 'L/lap')
  setSample(channels, 'fuel.lapsRemaining', snapshot.fuelLapsRemaining, 'laps')
  setSample(channels, 'lap.currentTime', snapshot.currentLapTimeSec, 's')
  setSample(channels, 'lap.lastTime', snapshot.lastLapTimeSec, 's')
  setSample(channels, 'lap.bestTime', snapshot.bestLapTimeSec, 's')
  setSample(channels, 'lap.deltaBest', snapshot.deltaToBestSec, 's')
  setSample(channels, 'lap.number', snapshot.currentLap, 'lap')
  setSample(channels, 'race.position', snapshot.position, 'position')
  setSample(channels, 'race.classPosition', snapshot.classPosition, 'position')
  setSample(channels, 'race.gapAhead', snapshot.relatives?.ahead?.gapSec, 's')
  setSample(channels, 'race.gapBehind', snapshot.relatives?.behind?.gapSec, 's')
  setSample(channels, 'weather.trackWetness', snapshot.trackWetnessPct, 'ratio')
  setSample(channels, 'weather.grip', snapshot.gripPct, 'ratio')
  setSample(channels, 'gps.latitude', snapshot.lat, 'deg')
  setSample(channels, 'gps.longitude', snapshot.lon, 'deg')
  setSample(channels, 'pit.limiter', snapshot.pitLimiter, 'bool')
  setSample(channels, 'pit.onRoad', snapshot.onPitRoad, 'bool')

  for (const corner of ['lf', 'rf', 'lr', 'rr'] as const) {
    setSample(channels, `tyre.${corner}.temperature`, snapshot.tyres?.[corner]?.tempC, 'degC')
    setSample(channels, `tyre.${corner}.pressure`, snapshot.tyres?.[corner]?.pressureKpa, 'kPa')
    setSample(channels, `tyre.${corner}.wear`, snapshot.tyres?.[corner]?.wearPct, 'ratio')
    setSample(channels, `brake.${corner}.temperature`, snapshot.brakeTempC?.[corner], 'degC')
    setSample(channels, `brake.${corner}.pressure`, snapshot.brakeLinePressBar?.[corner], 'bar')
  }

  return channels
}

function buildScenario(
  id: RaceConMockDashboardId,
  title: string,
  durationSec: number,
  configure: ScenarioConfigurer
): RaceConMockScenario {
  return {
    id,
    title,
    durationSec,
    frame: (elapsedSec) => {
      const elapsed = finiteElapsed(elapsedSec)
      const localSec = cycle(elapsed, durationSec)
      const t = durationSec > 0 ? localSec / durationSec : 0
      const snapshot = buildBaseSnapshot(elapsed)
      const scenarioChannels: Record<string, RaceConMockChannelSample> = {}
      const phase = configure({
        snapshot,
        channels: scenarioChannels,
        elapsedSec: elapsed,
        localSec,
        t
      })
      syncFuelDerivedFields(snapshot)
      syncRevLightsAndWarnings(snapshot)
      syncKinematics(snapshot)
      syncStandings(snapshot)
      const channels = {
        ...buildCoreChannels(snapshot),
        ...scenarioChannels
      }
      return {
        scenarioId: id,
        title,
        elapsedSec: elapsed,
        normalizedTime: t,
        phase,
        snapshot,
        channels: Object.freeze(channels)
      }
    }
  }
}

export const RACECON_MOCK_SCENARIOS: Record<RaceConMockDashboardId, RaceConMockScenario> = {
  'RC-01': buildScenario('RC-01', 'Apex Strike - Sprint Race Attack DDU', 92, ({ snapshot, channels, t }) => {
    snapshot.sessionType = 'Sprint Race'
    snapshot.lapsRemaining = Math.max(1, Math.round(5 - t * 4))
    snapshot.position = 2
    snapshot.classPosition = 2
    snapshot.deltaToBestSec = Math.sin(t * Math.PI * 2) * 0.24 - 0.08
    snapshot.tcLevel = 4
    setSample(channels, 'lap.deltaBest', snapshot.deltaToBestSec, 's')
    setSample(channels, 'race.position', snapshot.position, 'position')
    return 'attack'
  }),

  'RC-02': buildScenario('RC-02', 'Purple Lap - One-Lap Qualifying Focus', 92, ({ snapshot, channels, t }) => {
    snapshot.sessionType = 'Qualifying'
    snapshot.sessionKind = 'qualify'
    snapshot.position = 1
    snapshot.classPosition = 1
    snapshot.deltaToBestSec = lerp(0.12, -0.28, t)
    snapshot.currentLapTimeSec = t * 92
    setSample(channels, 'lap.deltaBest', snapshot.deltaToBestSec, 's')
    setSample(channels, 'lap.sectorSplit', Math.sin(t * Math.PI * 6) * 0.11, 's')
    setSample(channels, 'race.position', snapshot.position, 'position')
    return 'qualifying'
  }),

  'RC-03': buildScenario('RC-03', 'Long Night - Endurance Night-Stint DDU', 600, ({ snapshot, channels, t }) => {
    snapshot.sessionType = 'Endurance Race'
    snapshot.fuelLiters = lerp(52, 29, t)
    snapshot.voltage = 13.55 + Math.sin(t * Math.PI * 4) * 0.12
    snapshot.waterTempC = 96 + t * 4
    snapshot.oilPressureKpa = 455 - t * 20
    setSample(channels, 'electrical.voltage', snapshot.voltage, 'V')
    setSample(channels, 'stint.lapCount', Math.floor(t * 12) + 1, 'laps')
    return 'endurance'
  }),

  'RC-04': buildScenario('RC-04', 'Box Now - Pit Entry / Stop / Exit Sequence', 36, ({ snapshot, channels, t }) => {
    setSample(channels, 'pit.speedLimit', PIT_SPEED_LIMIT_KMH, 'km/h')
    setSample(channels, 'stint.time', snapshot.sessionTimeSec, 's')
    if (t < 0.2) {
      snapshot.speedKmh = lerp(170, 75, t / 0.2)
      snapshot.gear = snapshot.speedKmh < 110 ? 2 : 3
      snapshot.rpm = lerp(5400, 3900, t / 0.2)
      snapshot.throttle = 0
      snapshot.brake = lerp(0.2, 0.72, t / 0.2)
      snapshot.longAccelG = -1.8 * snapshot.brake
      snapshot.absActive = false
      snapshot.absCutPct = 0
      snapshot.tcActive = false
      setSample(channels, 'pit.phase', 'APPROACH')
      return 'pit-approach'
    }
    if (t < 0.48) {
      snapshot.onPitRoad = true
      snapshot.pitLimiter = true
      snapshot.speedKmh = 59
      snapshot.gear = 2
      snapshot.rpm = 4200
      snapshot.throttle = 0.32
      snapshot.brake = 0
      snapshot.longAccelG = 0.15
      snapshot.absActive = false
      snapshot.absCutPct = 0
      snapshot.tcActive = false
      snapshot.engineWarnings = { ...snapshot.engineWarnings!, pitLimiter: true }
      setSample(channels, 'pit.limiter', true, 'bool')
      setSample(channels, 'pit.onRoad', true, 'bool')
      setSample(channels, 'pit.phase', 'LIMITER')
      return 'pit-limiter'
    }
    if (t < 0.73) {
      snapshot.onPitRoad = true
      snapshot.pitLimiter = true
      snapshot.pitStopActive = true
      snapshot.refuelServiceActive = true
      snapshot.pitFuelToAddL = 32
      snapshot.speedKmh = 0
      snapshot.gear = 0
      snapshot.rpm = 950
      snapshot.throttle = 0
      snapshot.brake = 1
      snapshot.engineWarnings = { ...snapshot.engineWarnings!, pitLimiter: true }
      snapshot.pit = { inPitStall: true, repairNeeded: false, optRepairNeeded: false, pitsOpen: true }
      snapshot.pitServiceFlags = ['fuel', 'lf', 'rf', 'lr', 'rr']
      setSample(channels, 'pit.phase', 'SERVICE')
      setSample(channels, 'pit.service', 'FUEL + TYRES')
      return 'pit-service'
    }
    const releaseT = clamp((t - 0.73) / 0.27)
    const limiterReleasePoint = 0.55
    snapshot.pitLimiter = releaseT < limiterReleasePoint
    snapshot.onPitRoad = snapshot.pitLimiter
    snapshot.speedKmh = snapshot.pitLimiter
      ? lerp(35, 59, releaseT / limiterReleasePoint)
      : lerp(61, 115, (releaseT - limiterReleasePoint) / (1 - limiterReleasePoint))
    snapshot.gear = snapshot.speedKmh < 70 ? 2 : 3
    snapshot.rpm = snapshot.pitLimiter
      ? lerp(3000, 4200, releaseT / limiterReleasePoint)
      : lerp(4300, 6200, (releaseT - limiterReleasePoint) / (1 - limiterReleasePoint))
    snapshot.throttle = snapshot.pitLimiter ? 0.28 : 0.62
    snapshot.brake = 0
    snapshot.longAccelG = snapshot.pitLimiter ? 0.12 : 0.45
    snapshot.absActive = false
    snapshot.absCutPct = 0
    snapshot.tcActive = false
    setSample(channels, 'pit.phase', 'RELEASE')
    setSample(channels, 'pit.releaseHazard', t > 0.82 && t < 0.88, 'bool')
    return 'pit-release'
  }),

  'RC-05': buildScenario('RC-05', 'Thermal Window - Tyre Temperature and Pressure', 120, ({ snapshot, channels, t }) => {
    const heat = Math.sin(t * Math.PI) * 18
    const temps = corners(82 + heat, 88 + heat * 1.15, 79 + heat * 0.8, 85 + heat)
    const pressures = corners(164 + heat * 0.18, 166 + heat * 0.21, 162 + heat * 0.16, 163 + heat * 0.19)
    for (const corner of ['lf', 'rf', 'lr', 'rr'] as const) {
      snapshot.tyres![corner] = {
        ...snapshot.tyres![corner],
        tempC: temps[corner],
        pressureKpa: pressures[corner]
      }
      setSample(channels, `tyre.${corner}.temperature`, temps[corner], 'degC')
      setSample(channels, `tyre.${corner}.pressure`, pressures[corner], 'kPa')
    }
    setSample(channels, 'tyre.windowState', t < 0.2 ? 'COLD' : t > 0.82 ? 'HOT' : 'OPTIMAL')
    return 'thermal'
  }),

  'RC-06': buildScenario('RC-06', 'Save Mode - Fuel and Lift-and-Coast Strategy', 180, ({ snapshot, channels, t }) => {
    snapshot.fuelPerLapLiters = lerp(3.05, 2.62, t)
    snapshot.throttle = Math.min(snapshot.throttle, 0.82)
    setSample(channels, 'fuel.targetPerLap', 2.7, 'L/lap')
    setSample(channels, 'fuel.planDelta', snapshot.fuelPerLapLiters - 2.7, 'L/lap')
    return 'fuel-saving'
  }),

  'RC-07': buildScenario('RC-07', 'Blue Flags - Dense Traffic and Multiclass Awareness', 30, ({ snapshot, channels, t }) => {
    snapshot.flags = { ...snapshot.flags!, green: true, blue: t > 0.25 && t < 0.8 }
    snapshot.carLeftRight = t > 0.45 && t < 0.7 ? 'left' : 'clear'
    snapshot.carLeftRightRaw = snapshot.carLeftRight === 'left' ? 2 : 1
    snapshot.carLeftRightCount = snapshot.carLeftRight === 'left' ? 1 : undefined
    snapshot.radarCars = [
      { carIdx: 11, name: 'Mock Prototype', relativeX: -2.4, relativeY: lerp(-18, 8, t), gapSec: lerp(-0.8, 0.2, t), classColor: '#FFB000' },
      { carIdx: 12, name: 'Mock GT3', relativeX: 3.1, relativeY: -7, gapSec: -0.5, classColor: '#35C8E8' }
    ]
    snapshot.trafficDensity = 0.78
    setSample(channels, 'race.blueFlag', snapshot.flags.blue, 'bool')
    setSample(channels, 'race.proximity', snapshot.carLeftRight, 'state')
    setSample(channels, 'race.closingSpeed', lerp(8, 34, t), 'km/h')
    return 'traffic'
  }),

  'RC-08': buildScenario('RC-08', 'Rain Line - Changing Wet Conditions', 90, ({ snapshot, channels, t }) => {
    snapshot.isRaining = true
    snapshot.weatherDeclaredWet = true
    snapshot.precipitationPct = lerp(0.15, 0.85, t)
    snapshot.trackWetnessPct = lerp(0.18, 0.92, t)
    snapshot.gripPct = lerp(0.86, 0.59, t)
    snapshot.tcLevel = 8
    snapshot.absLevel = 6
    snapshot.brakeBiasPct = 53.1
    setSample(channels, 'weather.rainRate', snapshot.precipitationPct, 'ratio')
    setSample(channels, 'weather.trackWetness', snapshot.trackWetnessPct, 'ratio')
    setSample(channels, 'weather.grip', snapshot.gripPct, 'ratio')
    return 'wet'
  }),

  'RC-09': buildScenario('RC-09', 'Stage Time - Rally Stage and Co-Driver Timing', 240, ({ snapshot, channels, t }) => {
    snapshot.sessionType = 'Rally Stage'
    snapshot.sessionKind = 'time-attack'
    snapshot.position = 3
    snapshot.currentLapTimeSec = t * 240
    setSample(channels, 'stage.distanceRemaining', lerp(12_400, 0, t), 'm')
    setSample(channels, 'stage.split', Math.sin(t * Math.PI * 4) * 0.7, 's')
    setSample(channels, 'stage.paceNote', t < 0.33 ? 'L4 80' : t < 0.66 ? 'R3 CREST' : 'HAIRPIN L')
    return 'stage'
  }),

  'RC-10': buildScenario('RC-10', 'Clear Sight - High-Contrast Driver Display', 92, ({ snapshot, channels, t }) => {
    snapshot.deltaToBestSec = Math.sin(t * Math.PI * 2) * 0.18
    setSample(channels, 'lap.deltaBest', snapshot.deltaToBestSec, 's')
    setSample(channels, 'display.cueShape', snapshot.deltaToBestSec <= 0 ? 'UP-CHEVRON' : 'DOWN-CHEVRON')
    return 'accessible'
  }),

  'RC-11': buildScenario('RC-11', 'Trace Room - Race Engineer Analysis Wall', 92, ({ snapshot, channels, t }) => {
    snapshot.replayPlaying = true
    snapshot.sessionType = 'Post-run Analysis'
    snapshot.speedKmh = lerp(88, 294, 0.5 + Math.sin(t * Math.PI * 8) * 0.5)
    snapshot.throttle = clamp(0.5 + Math.sin(t * Math.PI * 8) * 0.65)
    snapshot.brake = clamp(-Math.sin(t * Math.PI * 8))
    snapshot.steerAngleDeg = Math.sin(t * Math.PI * 10) * 115
    snapshot.latAccelG = Math.sin(t * Math.PI * 10) * 1.7
    snapshot.longAccelG = snapshot.throttle * 0.6 - snapshot.brake * 2.3
    setSample(channels, 'analysis.distance', t * 7004, 'm')
    setSample(channels, 'analysis.referenceDelta', Math.sin(t * Math.PI * 2) * 0.22, 's')
    setSample(channels, 'analysis.dataGap', t > 0.58 && t < 0.61, 'bool')
    return 'analysis'
  }),

  'RC-12': buildScenario('RC-12', 'On Air - Broadcast Timing Presentation', 60, ({ snapshot, channels, t }) => {
    snapshot.position = t > 0.62 ? 1 : 2
    snapshot.classPosition = snapshot.position
    snapshot.lastLapTimeSec = 90.4 - t * 0.35
    snapshot.bestLapTimeSec = 90.2
    setSample(channels, 'race.position', snapshot.position, 'position')
    setSample(channels, 'broadcast.positionChanged', t > 0.6, 'bool')
    setSample(channels, 'broadcast.fastestLap', t > 0.78, 'bool')
    setSample(channels, 'broadcast.leader', snapshot.position === 1, 'bool')
    return 'broadcast'
  }),

  'RC-13': buildScenario('RC-13', 'Hold Order - Safety-Car and Restart Procedure', 45, ({ snapshot, channels, t }) => {
    snapshot.flags = { ...snapshot.flags!, green: t > 0.82, yellow: t <= 0.82 }
    snapshot.sessionState = t > 0.82 ? 'racing' : 'paradeLaps'
    snapshot.paceMode = t > 0.82 ? 'notPacing' : 'doubleFileRestart'
    snapshot.speedKmh = t > 0.82 ? lerp(100, 240, (t - 0.82) / 0.18) : 92
    setSample(channels, 'race.restartStatus', t < 0.62 ? 'HOLD' : t < 0.82 ? 'READY' : 'GREEN')
    setSample(channels, 'race.restartDelta', lerp(0.8, 0.1, t), 's')
    setSample(channels, 'race.overtakeAllowed', t > 0.82, 'bool')
    return 'safety-car'
  }),

  'RC-14': buildScenario('RC-14', 'Triage - Vehicle Health and Damage Assessment', 50, ({ snapshot, channels, t }) => {
    snapshot.damagePct = lerp(0.08, 0.42, t)
    snapshot.oilPressureKpa = lerp(420, 205, t)
    snapshot.waterTempC = lerp(98, 119, t)
    snapshot.oilTempC = lerp(112, 143, t)
    snapshot.voltage = lerp(13.8, 11.2, t)
    snapshot.engineWarnings = {
      ...snapshot.engineWarnings!,
      waterTemp: t > 0.55,
      oilPressure: t > 0.5,
      oilTemp: t > 0.68,
      mandRepair: t > 0.82
    }
    setSample(channels, 'engine.oilPressure', snapshot.oilPressureKpa, 'kPa')
    setSample(channels, 'engine.waterTemp', snapshot.waterTempC, 'degC')
    setSample(channels, 'engine.oilTemp', snapshot.oilTempC, 'degC')
    setSample(channels, 'electrical.voltage', snapshot.voltage, 'V')
    setSample(channels, 'vehicle.damage', snapshot.damagePct, 'ratio')
    setSample(channels, 'vehicle.faultSummary', t > 0.82 ? 'CRITICAL' : t > 0.5 ? 'WARNING' : 'OK')
    return 'fault'
  }),

  'RC-15': buildScenario('RC-15', 'On The Nose - Brake and Chassis Balance', 60, ({ snapshot, channels, t }) => {
    snapshot.brakeBiasPct = lerp(52.5, 56.8, t)
    snapshot.latAccelG = Math.sin(t * Math.PI * 6) * 1.8
    snapshot.steerAngleDeg = Math.sin(t * Math.PI * 6) * 125
    snapshot.brakeTempC = corners(
      lerp(420, 710, t),
      lerp(440, 745, t),
      lerp(330, 505, t),
      lerp(340, 520, t)
    )
    setSample(channels, 'driver.brakeBias', snapshot.brakeBiasPct, '%')
    setSample(channels, 'vehicle.chassisBalance', lerp(-0.18, 0.24, t), 'index')
    setSample(channels, 'vehicle.balanceState', t < 0.35 ? 'UNDERSTEER' : t > 0.7 ? 'OVERSTEER' : 'NEUTRAL')
    return 'balance'
  }),

  'RC-16': buildScenario('RC-16', 'Learn Lines - Novice Coaching and Consistency', 150, ({ snapshot, channels, t }) => {
    const roughness = 0.5 + Math.sin(t * Math.PI * 6) * 0.35
    snapshot.deltaToBestSec = lerp(1.2, 0.35, t)
    snapshot.lastLapTimeSec = lerp(93.8, 91.4, t)
    setSample(channels, 'coach.consistency', lerp(0.62, 0.91, t), 'score')
    setSample(channels, 'coach.throttleSmoothness', 1 - roughness * 0.35, 'score')
    setSample(channels, 'coach.minimumCornerSpeed', lerp(72, 86, t), 'km/h')
    setSample(channels, 'lap.deltaBest', snapshot.deltaToBestSec, 's')
    return 'coaching'
  }),

  'RC-17': buildScenario('RC-17', 'High Line - Oval Spotter Awareness', 30, ({ snapshot, channels, t }) => {
    snapshot.trackName = 'Mock Speedway'
    snapshot.trackConfigName = 'Oval'
    snapshot.speedKmh = 268 + Math.sin(t * Math.PI * 2) * 8
    snapshot.gear = 5
    snapshot.carLeftRight = t < 0.33 ? 'left' : t < 0.66 ? 'both' : 'right'
    snapshot.carLeftRightRaw = snapshot.carLeftRight === 'left' ? 5 : snapshot.carLeftRight === 'right' ? 6 : 4
    snapshot.carLeftRightCount = carLeftRightCountFromEnum(snapshot.carLeftRightRaw)
    snapshot.radarCars = [
      { carIdx: 21, name: 'Mock Inside', relativeX: -2.2, relativeY: 1.1, gapSec: 0.05, classColor: '#FFB000' },
      { carIdx: 22, name: 'Mock Outside', relativeX: 2.3, relativeY: -0.8, gapSec: -0.04, classColor: '#35C8E8' }
    ]
    setSample(channels, 'race.proximity', snapshot.carLeftRight, 'state')
    setSample(channels, 'oval.lineChoice', t < 0.5 ? 'HIGH' : 'LOW')
    setSample(channels, 'oval.threeWideRisk', t > 0.28 && t < 0.72, 'bool')
    return 'oval'
  }),

  'RC-18': buildScenario('RC-18', 'Split Test - Setup A/B Practice Comparison', 120, ({ snapshot, channels, t }) => {
    snapshot.sessionType = 'Practice'
    snapshot.sessionKind = 'practice'
    setSample(channels, 'setup.variant', t < 0.5 ? 'A' : 'B')
    setSample(channels, 'setup.sectorDelta', t < 0.5 ? 0 : -0.18, 's')
    setSample(channels, 'setup.chassisBalance', t < 0.5 ? -0.12 : 0.04, 'index')
    setSample(channels, 'setup.minimumCornerSpeed', t < 0.5 ? 78 : 83, 'km/h')
    setSample(channels, 'setup.comparable', true, 'bool')
    return 'setup-compare'
  }),

  'RC-19': buildScenario('RC-19', 'Hand Over - Endurance Driver-Swap Handover', 90, ({ snapshot, channels, t }) => {
    snapshot.sessionType = 'Endurance Handover'
    const fuelLapsRemaining = lerp(8.2, 6.9, t)
    snapshot.fuelLiters = fuelLapsRemaining * (snapshot.fuelPerLapLiters ?? 2.75)
    snapshot.tcLevel = t < 0.5 ? 5 : 6
    setSample(channels, 'handover.checklistState', t < 0.3 ? 'OPEN' : t < 0.75 ? 'IN REVIEW' : 'CONFIRMED')
    setSample(channels, 'handover.safetyConfirmed', t >= 0.75, 'bool')
    setSample(channels, 'handover.carriedFault', t > 0.45 ? 'RF PRESSURE WATCH' : 'NONE')
    setSample(channels, 'stint.lapCount', Math.floor(16 + t * 2), 'laps')
    return 'handover'
  }),

  'RC-20': buildScenario('RC-20', 'Lights Out - Formation, Grid and Start Procedure', 40, ({ snapshot, channels, t }) => {
    snapshot.sessionType = 'Race Start'
    setSample(channels, 'start.gridSlot', 7, 'slot')
    setSample(channels, 'start.launchRpmTarget', 5200, '1/min')
    if (t < 0.42) {
      snapshot.sessionState = 'paradeLaps'
      snapshot.paceMode = 'doubleFileStart'
      snapshot.speedKmh = 78
      snapshot.rpm = 4300 + Math.sin(t * Math.PI * 8) * 900
      snapshot.gear = 2
      snapshot.clutch = 0
      setSample(channels, 'start.status', 'FORMATION')
      setSample(channels, 'start.lightStage', 0, 'stage')
      return 'formation'
    }
    if (t < 0.64) {
      snapshot.sessionState = 'warmup'
      snapshot.paceMode = 'doubleFileStart'
      snapshot.speedKmh = 0
      snapshot.rpm = 5100
      snapshot.gear = 1
      snapshot.clutch = 0.72
      setSample(channels, 'start.status', 'GRID')
      setSample(channels, 'start.lightStage', Math.min(5, Math.floor(((t - 0.42) / 0.22) * 6)), 'stage')
      return 'grid'
    }
    if (t < 0.76) {
      snapshot.sessionState = 'warmup'
      snapshot.paceMode = 'doubleFileStart'
      snapshot.speedKmh = 0
      snapshot.rpm = lerp(5000, 5600, (t - 0.64) / 0.12)
      snapshot.gear = 1
      snapshot.clutch = 0.68
      setSample(channels, 'start.status', 'LIGHTS')
      setSample(channels, 'start.lightStage', 5, 'stage')
      return 'lights'
    }
    snapshot.sessionState = 'racing'
    snapshot.paceMode = 'notPacing'
    snapshot.speedKmh = lerp(0, 165, (t - 0.76) / 0.24)
    snapshot.rpm = lerp(5400, 7900, (t - 0.76) / 0.24)
    snapshot.gear = snapshot.speedKmh < 75 ? 1 : snapshot.speedKmh < 125 ? 2 : 3
    snapshot.clutch = lerp(0.68, 0, (t - 0.76) / 0.12)
    setSample(channels, 'start.status', 'RELEASED')
    setSample(channels, 'start.lightStage', 0, 'stage')
    setSample(channels, 'start.jumpRisk', false, 'bool')
    return 'launch'
  })
}

export function createRaceConMockFrame(
  scenarioId: RaceConMockDashboardId,
  elapsedSec: number
): RaceConMockFrame {
  return RACECON_MOCK_SCENARIOS[scenarioId].frame(elapsedSec)
}
