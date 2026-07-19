import type { TelemetrySnapshot } from '../../shared/telemetry'
import { sessionKindFromProvider } from '../../shared/telemetry'
import type { TelemetryProvider } from '../telemetry/provider'
import { firstString, loadKoffi, msToSeconds, num, optionalNum, openSharedMemory, type SharedMemoryHandle } from './shared-memory'

const INVALID_LAP_TIME_MS = 2_000_000_000
const NOMINAL_STEER_LOCK_DEG = 450

function validLapMsToSeconds(value: unknown): number | undefined {
  const n = optionalNum(value)
  if (n === undefined || n <= 0 || n >= INVALID_LAP_TIME_MS) return undefined
  return n / 1000
}

function normalizedSteerToDeg(value: unknown): number {
  // AC exposes normalized steering input (-1..1), not radians; approximate wheel angle with a nominal half-lock.
  return num(value) * NOMINAL_STEER_LOCK_DEG
}

function assettoSessionType(value: unknown): string | undefined {
  switch (Math.trunc(num(value, -1))) {
    case 0: return 'Practice'
    case 1: return 'Qualifying'
    case 2: return 'Race'
    case 3: return 'Hotlap'
    case 4: return 'Time Attack'
    case 5: return 'Drift'
    case 6: return 'Drag'
    default: return undefined
  }
}

export class ACProvider implements TelemetryProvider {
  readonly id = 'ac' as const
  private koffi: any | null = null
  private physics: SharedMemoryHandle | null = null
  private graphics: SharedMemoryHandle | null = null
  private staticInfo: SharedMemoryHandle | null = null
  private structs: { physics: any; graphics: any; staticInfo: any } | null = null

  start(): void {
    if (this.physics || process.platform !== 'win32') return
    this.koffi = loadKoffi()
    if (!this.koffi) return
    this.structs = cachedACStructs ??= createACStructs(this.koffi)
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
    const rawSession = graphics.session
    const completedLaps = Math.max(0, Math.trunc(num(graphics.completedLaps, 0)))
    const scheduledLaps = Math.max(0, Math.trunc(num(graphics.numberOfLaps, 0)))
    return {
      sim: 'ac',
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
      sessionType: assettoSessionType(rawSession),
      sessionKind: sessionKindFromProvider('ac', rawSession),
      carName: firstString(staticInfo.carModel),
      trackName: firstString(staticInfo.track),
      sessionTimeRemainingSec: msToSeconds(graphics.sessionTimeLeft),
      currentLap: completedLaps + 1,
      completedLaps,
      lapsRemaining: scheduledLaps > 0 ? Math.max(0, scheduledLaps - completedLaps) : undefined,
      lapDistPct: optionalNum(graphics.normalizedCarPosition),
      lastLapTimeSec: validLapMsToSeconds(graphics.iLastTime),
      bestLapTimeSec: validLapMsToSeconds(graphics.iBestTime),
      currentLapTimeSec: msToSeconds(graphics.iCurrentTime),
      position: Math.trunc(num(graphics.position, 0)) || undefined,
      totalCars: Math.trunc(num(staticInfo.numCars, 0)) || undefined,
      fuelLiters: optionalNum(physics.fuel),
      fuelCapacityLiters: num(staticInfo.maxFuel, 0) || undefined
    }
  }
}

let cachedACStructs: { physics: any; graphics: any; staticInfo: any } | null = null

function createACStructs(koffi: any): { physics: any; graphics: any; staticInfo: any } {
  // Assetto Corsa shared memory must be validated on Windows against the active sim version.
  return {
    physics: koffi.struct('ACSPageFilePhysics', { packetId: 'int32', gas: 'float', brake: 'float', fuel: 'float', gear: 'int32', rpms: 'int32', steerAngle: 'float', speedKmh: 'float', velocity: koffi.array('float', 3), accG: koffi.array('float', 3), wheelSlip: koffi.array('float', 4), wheelLoad: koffi.array('float', 4), wheelsPressure: koffi.array('float', 4), wheelAngularSpeed: koffi.array('float', 4), tyreWear: koffi.array('float', 4), tyreDirtyLevel: koffi.array('float', 4), tyreCoreTemperature: koffi.array('float', 4), camberRAD: koffi.array('float', 4), suspensionTravel: koffi.array('float', 4), drs: 'float', tc: 'float', heading: 'float', pitch: 'float', roll: 'float', cgHeight: 'float', carDamage: koffi.array('float', 5), numberOfTyresOut: 'int32', pitLimiterOn: 'int32', abs: 'float', kersCharge: 'float', kersInput: 'float', autoShifterOn: 'int32', rideHeight: koffi.array('float', 2), turboBoost: 'float', ballast: 'float', airDensity: 'float', airTemp: 'float', roadTemp: 'float', localAngularVel: koffi.array('float', 3), finalFF: 'float', performanceMeter: 'float', engineBrake: 'int32', ersRecoveryLevel: 'int32', ersPowerLevel: 'int32', ersHeatCharging: 'int32', ersIsCharging: 'int32', kersCurrentKJ: 'float', drsAvailable: 'int32', drsEnabled: 'int32', brakeTemp: koffi.array('float', 4), clutch: 'float' }),
    graphics: koffi.struct('ACSPageFileGraphic', { packetId: 'int32', status: 'int32', session: 'int32', currentTime: 'wchar[15]', lastTime: 'wchar[15]', bestTime: 'wchar[15]', split: 'wchar[15]', completedLaps: 'int32', position: 'int32', iCurrentTime: 'int32', iLastTime: 'int32', iBestTime: 'int32', sessionTimeLeft: 'float', distanceTraveled: 'float', isInPit: 'int32', currentSectorIndex: 'int32', lastSectorTime: 'int32', numberOfLaps: 'int32', tyreCompound: 'wchar[33]', normalizedCarPosition: 'float', activeCars: 'int32', carCoordinates: koffi.array('float', 60 * 3), carID: koffi.array('int32', 60), playerCarID: 'int32' }),
    staticInfo: koffi.struct('ACSPageFileStatic', { smVersion: 'wchar[15]', acVersion: 'wchar[15]', numberOfSessions: 'int32', numCars: 'int32', carModel: 'wchar[33]', track: 'wchar[33]', playerName: 'wchar[33]', playerSurname: 'wchar[33]', playerNick: 'wchar[33]', sectorCount: 'int32', maxTorque: 'float', maxPower: 'float', maxRpm: 'int32', maxFuel: 'float' })
  }
}
