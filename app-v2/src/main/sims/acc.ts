import type { Flags, TelemetrySnapshot } from '../../shared/telemetry'
import { sessionKindFromProvider } from '../../shared/telemetry'
import type { TelemetryProvider } from '../telemetry/provider'
import {
  loadKoffi,
  openSharedMemoryBuffer,
  type SharedMemoryBufferHandle
} from './shared-memory'

const INVALID_LAP_TIME_MS = 2_000_000_000
const NOMINAL_STEER_LOCK_DEG = 450
const PSI_TO_KPA = 6.89476

// Kunos ACC Shared Memory v1.8.12, #pragma pack(4).
// Version-pinned mirror of the published SDK layout:
// https://github.com/SeriousOldMan/Simulator-Controller/blob/2ad4ab914ae553a30a218d71110780eecad2bbcb/Sources/Special/ACC%20SHM%20Coach/ACC%20SHM%20Coach/SharedFileOut.h
export const ACC_SHARED_MEMORY_VERSION = '1.8'
export const ACC_PHYSICS_PAGE_SIZE = 800
export const ACC_GRAPHICS_PAGE_SIZE = 1572
export const ACC_STATIC_PAGE_SIZE = 820

export const ACC_LAYOUT = {
  physics: {
    packetId: 0,
    gas: 4,
    brake: 8,
    fuel: 12,
    gear: 16,
    rpms: 20,
    steerAngle: 24,
    speedKmh: 28,
    wheelsPressure: 88,
    tyreCoreTemperature: 152,
    airTemp: 288,
    roadTemp: 292,
    clutch: 364,
    tcInAction: 672,
    absInAction: 676
  },
  graphics: {
    packetId: 0,
    status: 4,
    session: 8,
    completedLaps: 132,
    position: 136,
    iCurrentTime: 140,
    iLastTime: 144,
    iBestTime: 148,
    sessionTimeLeft: 152,
    isInPit: 160,
    numberOfLaps: 172,
    normalizedCarPosition: 248,
    flag: 1224,
    penalty: 1228,
    isInPitLane: 1236,
    surfaceGrip: 1240,
    isValidLap: 1408,
    globalYellow: 1500,
    globalWhite: 1516,
    globalGreen: 1520,
    globalChequered: 1524,
    globalRed: 1528,
    trackGripStatus: 1556,
    rainIntensity: 1560
  },
  staticInfo: {
    smVersion: 0,
    acVersion: 30,
    numCars: 64,
    carModel: 68,
    track: 134,
    maxRpm: 412,
    maxFuel: 416
  }
} as const

export interface ACCPhysicsPage {
  packetId: number
  gas: number
  brake: number
  fuel: number
  gear: number
  rpms: number
  steerAngle: number
  speedKmh: number
  wheelsPressure: [number, number, number, number]
  tyreCoreTemperature: [number, number, number, number]
  airTemp: number
  roadTemp: number
  clutch: number
  tcInAction: number
  absInAction: number
}

export interface ACCGraphicsPage {
  packetId: number
  status: number
  session: number
  completedLaps: number
  position: number
  iCurrentTime: number
  iLastTime: number
  iBestTime: number
  sessionTimeLeft: number
  isInPit: number
  numberOfLaps: number
  normalizedCarPosition: number
  flag: number
  penalty: number
  isInPitLane: number
  surfaceGrip: number
  isValidLap: number
  globalYellow: number
  globalWhite: number
  globalGreen: number
  globalChequered: number
  globalRed: number
  trackGripStatus: number
  rainIntensity: number
}

export interface ACCStaticPage {
  smVersion: string
  acVersion: string
  numCars: number
  carModel?: string
  track?: string
  maxRpm: number
  maxFuel: number
}

function readInt32(buffer: Buffer, offset: number): number {
  return buffer.readInt32LE(offset)
}

function readFloat32(buffer: Buffer, offset: number): number | undefined {
  const value = buffer.readFloatLE(offset)
  return Number.isFinite(value) ? value : undefined
}

function readFloat4(
  buffer: Buffer,
  offset: number
): [number, number, number, number] | null {
  const values = [0, 1, 2, 3].map((index) => readFloat32(buffer, offset + index * 4))
  return values.every((value): value is number => value !== undefined)
    ? [values[0], values[1], values[2], values[3]]
    : null
}

function readUtf16(buffer: Buffer, offset: number, codeUnits: number): string {
  return buffer
    .subarray(offset, offset + codeUnits * 2)
    .toString('utf16le')
    .replace(/\0.*$/s, '')
    .trim()
}

export function decodeACCPhysicsPage(buffer: Buffer): ACCPhysicsPage | null {
  if (buffer.length < ACC_PHYSICS_PAGE_SIZE) return null
  const pressure = readFloat4(buffer, ACC_LAYOUT.physics.wheelsPressure)
  const temperature = readFloat4(buffer, ACC_LAYOUT.physics.tyreCoreTemperature)
  const floats = {
    gas: readFloat32(buffer, ACC_LAYOUT.physics.gas),
    brake: readFloat32(buffer, ACC_LAYOUT.physics.brake),
    fuel: readFloat32(buffer, ACC_LAYOUT.physics.fuel),
    steerAngle: readFloat32(buffer, ACC_LAYOUT.physics.steerAngle),
    speedKmh: readFloat32(buffer, ACC_LAYOUT.physics.speedKmh),
    airTemp: readFloat32(buffer, ACC_LAYOUT.physics.airTemp),
    roadTemp: readFloat32(buffer, ACC_LAYOUT.physics.roadTemp),
    clutch: readFloat32(buffer, ACC_LAYOUT.physics.clutch)
  }
  if (
    !pressure ||
    !temperature ||
    Object.values(floats).some((value) => value === undefined)
  ) return null
  return {
    packetId: readInt32(buffer, ACC_LAYOUT.physics.packetId),
    gas: floats.gas as number,
    brake: floats.brake as number,
    fuel: floats.fuel as number,
    gear: readInt32(buffer, ACC_LAYOUT.physics.gear),
    rpms: readInt32(buffer, ACC_LAYOUT.physics.rpms),
    steerAngle: floats.steerAngle as number,
    speedKmh: floats.speedKmh as number,
    wheelsPressure: pressure,
    tyreCoreTemperature: temperature,
    airTemp: floats.airTemp as number,
    roadTemp: floats.roadTemp as number,
    clutch: floats.clutch as number,
    tcInAction: readInt32(buffer, ACC_LAYOUT.physics.tcInAction),
    absInAction: readInt32(buffer, ACC_LAYOUT.physics.absInAction)
  }
}

export function decodeACCGraphicsPage(buffer: Buffer): ACCGraphicsPage | null {
  if (buffer.length < ACC_GRAPHICS_PAGE_SIZE) return null
  const sessionTimeLeft = readFloat32(buffer, ACC_LAYOUT.graphics.sessionTimeLeft)
  const normalizedCarPosition = readFloat32(buffer, ACC_LAYOUT.graphics.normalizedCarPosition)
  const surfaceGrip = readFloat32(buffer, ACC_LAYOUT.graphics.surfaceGrip)
  if (
    sessionTimeLeft === undefined ||
    normalizedCarPosition === undefined ||
    surfaceGrip === undefined
  ) return null
  const status = readInt32(buffer, ACC_LAYOUT.graphics.status)
  const session = readInt32(buffer, ACC_LAYOUT.graphics.session)
  if (status < 0 || status > 3 || session < -1 || session > 8) return null
  return {
    packetId: readInt32(buffer, ACC_LAYOUT.graphics.packetId),
    status,
    session,
    completedLaps: readInt32(buffer, ACC_LAYOUT.graphics.completedLaps),
    position: readInt32(buffer, ACC_LAYOUT.graphics.position),
    iCurrentTime: readInt32(buffer, ACC_LAYOUT.graphics.iCurrentTime),
    iLastTime: readInt32(buffer, ACC_LAYOUT.graphics.iLastTime),
    iBestTime: readInt32(buffer, ACC_LAYOUT.graphics.iBestTime),
    sessionTimeLeft,
    isInPit: readInt32(buffer, ACC_LAYOUT.graphics.isInPit),
    numberOfLaps: readInt32(buffer, ACC_LAYOUT.graphics.numberOfLaps),
    normalizedCarPosition,
    flag: readInt32(buffer, ACC_LAYOUT.graphics.flag),
    penalty: readInt32(buffer, ACC_LAYOUT.graphics.penalty),
    isInPitLane: readInt32(buffer, ACC_LAYOUT.graphics.isInPitLane),
    surfaceGrip,
    isValidLap: readInt32(buffer, ACC_LAYOUT.graphics.isValidLap),
    globalYellow: readInt32(buffer, ACC_LAYOUT.graphics.globalYellow),
    globalWhite: readInt32(buffer, ACC_LAYOUT.graphics.globalWhite),
    globalGreen: readInt32(buffer, ACC_LAYOUT.graphics.globalGreen),
    globalChequered: readInt32(buffer, ACC_LAYOUT.graphics.globalChequered),
    globalRed: readInt32(buffer, ACC_LAYOUT.graphics.globalRed),
    trackGripStatus: readInt32(buffer, ACC_LAYOUT.graphics.trackGripStatus),
    rainIntensity: readInt32(buffer, ACC_LAYOUT.graphics.rainIntensity)
  }
}

export function decodeACCStaticPage(buffer: Buffer): ACCStaticPage | null {
  if (buffer.length < ACC_STATIC_PAGE_SIZE) return null
  const smVersion = readUtf16(buffer, ACC_LAYOUT.staticInfo.smVersion, 15)
  const acVersion = readUtf16(buffer, ACC_LAYOUT.staticInfo.acVersion, 15)
  const maxFuel = readFloat32(buffer, ACC_LAYOUT.staticInfo.maxFuel)
  if (smVersion !== ACC_SHARED_MEMORY_VERSION || !acVersion || maxFuel === undefined) return null
  return {
    smVersion,
    acVersion,
    numCars: readInt32(buffer, ACC_LAYOUT.staticInfo.numCars),
    carModel: readUtf16(buffer, ACC_LAYOUT.staticInfo.carModel, 33) || undefined,
    track: readUtf16(buffer, ACC_LAYOUT.staticInfo.track, 33) || undefined,
    maxRpm: readInt32(buffer, ACC_LAYOUT.staticInfo.maxRpm),
    maxFuel
  }
}

function validLapMsToSeconds(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0 || value >= INVALID_LAP_TIME_MS) return undefined
  return value / 1000
}

function currentLapMsToSeconds(value: number): number | undefined {
  if (!Number.isFinite(value) || value < 0 || value >= INVALID_LAP_TIME_MS) return undefined
  return value / 1000
}

function normalizedSteerToDeg(value: number): number {
  return value * NOMINAL_STEER_LOCK_DEG
}

function accRainIntensityPct(value: number): number {
  return Math.max(0, Math.min(1, Math.trunc(value) / 5))
}

export function accWeatherFromGraphics(
  rainIntensity: unknown,
  surfaceGrip: unknown
): Pick<TelemetrySnapshot, 'precipitationPct' | 'isRaining' | 'trackWetnessPct' | 'gripPct'> {
  const rain = typeof rainIntensity === 'number' && Number.isFinite(rainIntensity)
    ? rainIntensity
    : 0
  const grip = typeof surfaceGrip === 'number' && Number.isFinite(surfaceGrip)
    ? surfaceGrip
    : undefined
  const precipitationPct = accRainIntensityPct(rain)
  return {
    precipitationPct,
    isRaining: precipitationPct > 0,
    trackWetnessPct: undefined,
    gripPct: grip !== undefined ? Math.max(0, Math.min(1, grip)) : undefined
  }
}

export function accFlags(graphics: ACCGraphicsPage): Flags {
  const disqualify = new Set([5, 11, 13, 15, 16, 17, 18, 20, 21]).has(graphics.penalty)
  return {
    green: graphics.flag === 7 || graphics.globalGreen !== 0,
    yellow: graphics.flag === 2 || graphics.globalYellow !== 0,
    blue: graphics.flag === 1,
    white: graphics.flag === 4 || graphics.globalWhite !== 0,
    checkered: graphics.flag === 5 || graphics.globalChequered !== 0,
    red: graphics.globalRed !== 0,
    black: graphics.flag === 3,
    meatball: false,
    repair: false,
    disqualify,
    greenWhiteCheckered: false
  }
}

function stablePacket<T extends { packetId: number }>(
  handle: SharedMemoryBufferHandle | null,
  decode: (buffer: Buffer) => T | null
): T | null {
  const firstBuffer = handle?.view
  if (!firstBuffer) return null
  const first = decode(firstBuffer)
  if (!first) return null
  const secondBuffer = handle?.view
  if (!secondBuffer) return null
  const second = decode(secondBuffer)
  return second && second.packetId === first.packetId ? second : null
}

function assettoSessionType(value: unknown): string | undefined {
  const session = typeof value === 'number' && Number.isFinite(value)
    ? Math.trunc(value)
    : -1
  switch (session) {
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

export function accSnapshotFromPages(
  physics: ACCPhysicsPage,
  graphics: ACCGraphicsPage,
  staticInfo: ACCStaticPage,
  timestamp = Date.now()
): TelemetrySnapshot | null {
  if (graphics.status === 0) return null
  const rawSession = graphics.session
  const completedLaps = Math.max(0, graphics.completedLaps)
  const scheduledLaps = Math.max(0, graphics.numberOfLaps)
  const weather = accWeatherFromGraphics(graphics.rainIntensity, graphics.surfaceGrip)
  const onPitRoad = graphics.isInPit !== 0 || graphics.isInPitLane !== 0
  const normalizedCarPosition =
    graphics.normalizedCarPosition >= 0 && graphics.normalizedCarPosition <= 1
      ? graphics.normalizedCarPosition
      : undefined

  return {
    sim: 'acc',
    connected: true,
    timestamp,
    speedKmh: physics.speedKmh,
    rpm: physics.rpms,
    gear: physics.gear - 1,
    maxRpm: staticInfo.maxRpm > 0 ? staticInfo.maxRpm : undefined,
    throttle: physics.gas,
    brake: physics.brake,
    clutch: physics.clutch,
    steerAngleDeg: normalizedSteerToDeg(physics.steerAngle),
    absActive: physics.absInAction !== 0,
    tcActive: physics.tcInAction !== 0,
    sessionType: assettoSessionType(rawSession),
    sessionKind: sessionKindFromProvider('acc', rawSession),
    carName: staticInfo.carModel,
    trackName: staticInfo.track,
    sessionTimeRemainingSec:
      graphics.sessionTimeLeft >= 0 ? graphics.sessionTimeLeft / 1000 : undefined,
    currentLap: completedLaps + 1,
    completedLaps,
    lapsRemaining:
      scheduledLaps > 0 ? Math.max(0, scheduledLaps - completedLaps) : undefined,
    lapDistPct: normalizedCarPosition,
    lastLapTimeSec: validLapMsToSeconds(graphics.iLastTime),
    bestLapTimeSec: validLapMsToSeconds(graphics.iBestTime),
    currentLapTimeSec: currentLapMsToSeconds(graphics.iCurrentTime),
    lapValidity: graphics.isValidLap === 0 ? 'invalid' : 'valid',
    position: graphics.position > 0 ? graphics.position : undefined,
    totalCars: staticInfo.numCars > 0 ? staticInfo.numCars : undefined,
    onTrack: graphics.status === 2,
    onPitRoad,
    pit: {
      repairNeeded: false,
      optRepairNeeded: false,
      pitsOpen: false,
      inPitStall: graphics.isInPit !== 0
    },
    flags: accFlags(graphics),
    fuelLiters: physics.fuel >= 0 ? physics.fuel : undefined,
    fuelCapacityLiters: staticInfo.maxFuel > 0 ? staticInfo.maxFuel : undefined,
    tyres: {
      lf: {
        pressureKpa: physics.wheelsPressure[0] * PSI_TO_KPA,
        tempC: physics.tyreCoreTemperature[0]
      },
      rf: {
        pressureKpa: physics.wheelsPressure[1] * PSI_TO_KPA,
        tempC: physics.tyreCoreTemperature[1]
      },
      lr: {
        pressureKpa: physics.wheelsPressure[2] * PSI_TO_KPA,
        tempC: physics.tyreCoreTemperature[2]
      },
      rr: {
        pressureKpa: physics.wheelsPressure[3] * PSI_TO_KPA,
        tempC: physics.tyreCoreTemperature[3]
      }
    },
    airTempC: physics.airTemp,
    trackTempC: physics.roadTemp,
    ...weather
  }
}

export class ACCProvider implements TelemetryProvider {
  readonly id = 'acc' as const
  private koffi: any | null = null
  private physics: SharedMemoryBufferHandle | null = null
  private graphics: SharedMemoryBufferHandle | null = null
  private staticInfo: SharedMemoryBufferHandle | null = null

  start(): void {
    if (this.isConnected() || process.platform !== 'win32') return
    this.stop()
    this.koffi = loadKoffi()
    if (!this.koffi) return
    this.physics = openSharedMemoryBuffer(
      this.koffi,
      'Local\\acpmf_physics',
      ACC_PHYSICS_PAGE_SIZE
    )
    this.graphics = openSharedMemoryBuffer(
      this.koffi,
      'Local\\acpmf_graphics',
      ACC_GRAPHICS_PAGE_SIZE
    )
    this.staticInfo = openSharedMemoryBuffer(
      this.koffi,
      'Local\\acpmf_static',
      ACC_STATIC_PAGE_SIZE
    )
    if (!this.isConnected()) this.stop()
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
    return Boolean(this.physics && this.graphics && this.staticInfo)
  }

  poll(): TelemetrySnapshot | null {
    if (!this.isConnected()) return null
    const staticBuffer = this.staticInfo?.view
    const staticInfo = staticBuffer ? decodeACCStaticPage(staticBuffer) : null
    const physics = stablePacket(this.physics, decodeACCPhysicsPage)
    const graphics = stablePacket(this.graphics, decodeACCGraphicsPage)
    if (!staticInfo || !physics || !graphics) return null
    return accSnapshotFromPages(physics, graphics, staticInfo)
  }
}
