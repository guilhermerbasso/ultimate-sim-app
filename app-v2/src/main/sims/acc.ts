import type { TelemetrySnapshot } from '../../shared/telemetry'
import { sessionKindFromProvider } from '../../shared/telemetry'
import type { TelemetryProvider } from '../telemetry/provider'
import { bool, firstString, loadKoffi, msToSeconds, num, optionalNum, openSharedMemory, type SharedMemoryHandle } from './shared-memory'

const INVALID_LAP_TIME_MS = 2_000_000_000
const NOMINAL_STEER_LOCK_DEG = 450

function validLapMsToSeconds(value: unknown): number | undefined {
  const n = optionalNum(value)
  if (n === undefined || n <= 0 || n >= INVALID_LAP_TIME_MS) return undefined
  return n / 1000
}

function normalizedSteerToDeg(value: unknown): number {
  // ACC exposes normalized steering input (-1..1), not radians; approximate wheel angle with a nominal half-lock.
  return num(value) * NOMINAL_STEER_LOCK_DEG
}

function accRainIntensityPct(value: unknown): number {
  return Math.max(0, Math.min(1, Math.trunc(num(value, 0)) / 5))
}

export class ACCProvider implements TelemetryProvider {
  readonly id = 'acc' as const
  private koffi: any | null = null
  private physics: SharedMemoryHandle | null = null
  private graphics: SharedMemoryHandle | null = null
  private staticInfo: SharedMemoryHandle | null = null
  private structs: { physics: any; graphics: any; staticInfo: any } | null = null

  start(): void {
    if (this.physics || process.platform !== 'win32') return
    this.koffi = loadKoffi()
    if (!this.koffi) return
    this.structs = cachedACCStructs ??= createACCStructs(this.koffi)
    this.physics = openSharedMemory(this.koffi, 'Local\\acpmf_physics', this.structs.physics)
    this.graphics = openSharedMemory(this.koffi, 'Local\\acpmf_graphics', this.structs.graphics)
    this.staticInfo = openSharedMemory(this.koffi, 'Local\\acpmf_static', this.structs.staticInfo)
  }

  stop(): void {
    this.physics?.close()
    this.graphics?.close()
    this.staticInfo?.close()
    this.physics = null
    this.graphics = null
    this.staticInfo = null
  }

  isConnected(): boolean {
    return Boolean(this.physics && this.graphics)
  }

  poll(): TelemetrySnapshot | null {
    if (!this.isConnected()) return null
    const physics = this.physics?.view
    const graphics = this.graphics?.view
    if (!physics || !graphics) return null
    const staticInfo = this.staticInfo?.view ?? {}
    const rainIntensityPct = accRainIntensityPct(graphics.rainIntensity)
    const rawSession = graphics.session

    return {
      sim: 'acc',
      connected: true,
      timestamp: Date.now(),
      speedKmh: num(physics.speedKmh),
      rpm: num(physics.rpms),
      gear: Math.trunc(num(physics.gear)) - 1,
      maxRpm: num(staticInfo.maxRpm, 0) || undefined,
      throttle: num(physics.gas),
      brake: num(physics.brake),
      clutch: num(physics.clutch),
      steerAngleDeg: normalizedSteerToDeg(physics.steerAngle),
      absActive: bool(physics.abs),
      tcActive: bool(physics.tc),
      sessionType: firstString(rawSession),
      sessionKind: sessionKindFromProvider('acc', rawSession),
      carName: firstString(staticInfo.carModel),
      trackName: firstString(staticInfo.track),
      sessionTimeRemainingSec: msToSeconds(graphics.sessionTimeLeft),
      currentLap: Math.trunc(num(graphics.completedLaps, 0)) + 1,
      lapDistPct: optionalNum(graphics.normalizedCarPosition),
      lastLapTimeSec: validLapMsToSeconds(graphics.iLastTime),
      bestLapTimeSec: validLapMsToSeconds(graphics.iBestTime),
      currentLapTimeSec: msToSeconds(graphics.iCurrentTime),
      position: Math.trunc(num(graphics.position, 0)) || undefined,
      fuelLiters: optionalNum(physics.fuel),
      fuelCapacityLiters: num(staticInfo.maxFuel, 0) || undefined,
      tyres: {
        lf: { pressureKpa: num(physics.wheelsPressure?.[0], 0) * 6.89476, tempC: optionalNum(physics.tyreCoreTemperature?.[0]) },
        rf: { pressureKpa: num(physics.wheelsPressure?.[1], 0) * 6.89476, tempC: optionalNum(physics.tyreCoreTemperature?.[1]) },
        lr: { pressureKpa: num(physics.wheelsPressure?.[2], 0) * 6.89476, tempC: optionalNum(physics.tyreCoreTemperature?.[2]) },
        rr: { pressureKpa: num(physics.wheelsPressure?.[3], 0) * 6.89476, tempC: optionalNum(physics.tyreCoreTemperature?.[3]) }
      },
      airTempC: optionalNum(graphics.airTemp),
      trackTempC: optionalNum(graphics.roadTemp),
      isRaining: rainIntensityPct > 0,
      trackWetnessPct: rainIntensityPct
    }
  }
}

let cachedACCStructs: { physics: any; graphics: any; staticInfo: any } | null = null

function createACCStructs(koffi: any): { physics: any; graphics: any; staticInfo: any } {
  // ACC/AC shared memory must be validated on Windows against the active sim version.
  return {
    physics: koffi.struct('SPageFilePhysics', {
      packetId: 'int32', gas: 'float', brake: 'float', fuel: 'float', gear: 'int32', rpms: 'int32', steerAngle: 'float', speedKmh: 'float',
      velocity: koffi.array('float', 3), accG: koffi.array('float', 3), wheelSlip: koffi.array('float', 4), wheelLoad: koffi.array('float', 4), wheelsPressure: koffi.array('float', 4),
      wheelAngularSpeed: koffi.array('float', 4), tyreWear: koffi.array('float', 4), tyreDirtyLevel: koffi.array('float', 4), tyreCoreTemperature: koffi.array('float', 4),
      camberRAD: koffi.array('float', 4), suspensionTravel: koffi.array('float', 4), drs: 'float', tc: 'float', heading: 'float', pitch: 'float', roll: 'float', cgHeight: 'float', carDamage: koffi.array('float', 5), numberOfTyresOut: 'int32', pitLimiterOn: 'int32', abs: 'float', kersCharge: 'float', kersInput: 'float', autoShifterOn: 'int32', rideHeight: koffi.array('float', 2), turboBoost: 'float', ballast: 'float', airDensity: 'float', airTemp: 'float', roadTemp: 'float', localAngularVel: koffi.array('float', 3), finalFF: 'float', performanceMeter: 'float', engineBrake: 'int32', ersRecoveryLevel: 'int32', ersPowerLevel: 'int32', ersHeatCharging: 'int32', ersIsCharging: 'int32', kersCurrentKJ: 'float', drsAvailable: 'int32', drsEnabled: 'int32', brakeTemp: koffi.array('float', 4), clutch: 'float'
    }),
    graphics: koffi.struct('SPageFileGraphic', {
      packetId: 'int32', status: 'int32', session: 'int32', currentTime: 'wchar[15]', lastTime: 'wchar[15]', bestTime: 'wchar[15]', split: 'wchar[15]', completedLaps: 'int32', position: 'int32', iCurrentTime: 'int32', iLastTime: 'int32', iBestTime: 'int32', sessionTimeLeft: 'float', distanceTraveled: 'float', isInPit: 'int32', currentSectorIndex: 'int32', lastSectorTime: 'int32', numberOfLaps: 'int32', tyreCompound: 'wchar[33]', normalizedCarPosition: 'float', activeCars: 'int32', carCoordinates: koffi.array('float', 60 * 3), carID: koffi.array('int32', 60), playerCarID: 'int32', penaltyTime: 'float', flag: 'int32', idealLineOn: 'int32', isInPitLane: 'int32', surfaceGrip: 'float', mandatoryPitDone: 'int32', windSpeed: 'float', windDirection: 'float', isSetupMenuVisible: 'int32', mainDisplayIndex: 'int32', secondaryDisplayIndex: 'int32', tc: 'int32', tcCut: 'int32', engineMap: 'int32', abs: 'int32', fuelXLap: 'float', rainLights: 'int32', flashingLights: 'int32', lightsStage: 'int32', exhaustTemperature: 'float', wiperLV: 'int32', driverStintTotalTimeLeft: 'int32', driverStintTimeLeft: 'int32', rainIntensity: 'int32', rainIntensityIn10min: 'int32', rainIntensityIn30min: 'int32', currentTyreSet: 'int32', strategyTyreSet: 'int32', gapAhead: 'int32', gapBehind: 'int32'
    }),
    staticInfo: koffi.struct('SPageFileStatic', { smVersion: 'wchar[15]', acVersion: 'wchar[15]', numberOfSessions: 'int32', numCars: 'int32', carModel: 'wchar[33]', track: 'wchar[33]', playerName: 'wchar[33]', playerSurname: 'wchar[33]', playerNick: 'wchar[33]', sectorCount: 'int32', maxTorque: 'float', maxPower: 'float', maxRpm: 'int32', maxFuel: 'float' })
  }
}
