import type { Flags, TelemetrySnapshot } from '../../shared/telemetry'
import { sessionKindFromProvider } from '../../shared/telemetry'
import type { TelemetryProvider } from '../telemetry/provider'
import {
  firstString,
  loadKoffi,
  openSharedMemoryBuffer,
  type SharedMemoryBufferHandle
} from './shared-memory'

const AMS2_PARTICIPANT_COUNT = 64
const AMS2_PARTICIPANT_SIZE = 100
const AMS2_PARTICIPANT_BASE = 28

// AMS2 exposes the Project CARS 2 shared-memory ABI. We read only the stable
// prefix through mSequenceNumber and accept the two version-pinned layouts whose
// headers were verified field-for-field:
// v13: https://github.com/diegocbarboza/AMS2_SessionLogger/blob/b783329f9e0b403075128362dbb00f44c706aa55/SharedMemory.h
// v14: https://github.com/viper4gh/CREST2-AMS2/blob/534ed288f2a7d50f4c796af34c4ba4af4cfa11da/SharedMemory.h
export const AMS2_SUPPORTED_SHARED_MEMORY_VERSIONS = new Set([13, 14])
export const AMS2_SHARED_MEMORY_PREFIX_SIZE = 7324

export const AMS2_LAYOUT = {
  version: 0,
  buildVersion: 4,
  gameState: 8,
  sessionState: 12,
  raceState: 16,
  viewedParticipantIndex: 20,
  numParticipants: 24,
  carName: 6444,
  lapsInEvent: 6572,
  trackLocation: 6576,
  trackVariation: 6640,
  trackLength: 6704,
  lapInvalidated: 6712,
  bestLapTime: 6716,
  lastLapTime: 6720,
  currentTime: 6724,
  eventTimeRemaining: 6740,
  highestFlagColour: 6800,
  pitMode: 6808,
  pitSchedule: 6812,
  carFlags: 6816,
  fuelLevel: 6840,
  fuelCapacity: 6844,
  speed: 6848,
  rpm: 6852,
  maxRpm: 6856,
  brake: 6860,
  throttle: 6864,
  clutch: 6868,
  steering: 6872,
  gear: 6876,
  antiLockActive: 6888,
  ambientTemperature: 7292,
  trackTemperature: 7296,
  rainDensity: 7300,
  sequenceNumber: 7320
} as const

const AMS2_PARTICIPANT_LAYOUT = {
  active: 0,
  currentLapDistance: 80,
  racePosition: 84,
  lapsCompleted: 88,
  currentLap: 92
} as const

export interface AMS2ParticipantPage {
  active: boolean
  currentLapDistance: number
  racePosition: number
  lapsCompleted: number
  currentLap: number
}

export interface AMS2SharedMemoryPage {
  version: number
  buildVersion: number
  gameState: number
  sessionState: number
  raceState: number
  viewedParticipantIndex: number
  numParticipants: number
  participant?: AMS2ParticipantPage
  carName?: string
  lapsInEvent: number
  trackLocation?: string
  trackVariation?: string
  trackLength: number
  lapInvalidated: boolean
  bestLapTime: number
  lastLapTime: number
  currentTime: number
  eventTimeRemaining: number
  highestFlagColour: number
  pitMode: number
  pitSchedule: number
  carFlags: number
  fuelLevel: number
  fuelCapacity: number
  speed: number
  rpm: number
  maxRpm: number
  brake: number
  throttle: number
  clutch: number
  steering: number
  gear: number
  antiLockActive: boolean
  ambientTemperature: number
  trackTemperature: number
  rainDensity: number
  sequenceNumber: number
}

function readInt32(buffer: Buffer, offset: number): number {
  return buffer.readInt32LE(offset)
}

function readUInt32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset)
}

function readFloat32(buffer: Buffer, offset: number): number | undefined {
  const value = buffer.readFloatLE(offset)
  return Number.isFinite(value) ? value : undefined
}

function readAscii(buffer: Buffer, offset: number, length: number): string | undefined {
  return firstString([...buffer.subarray(offset, offset + length)])
}

function decodeParticipant(
  buffer: Buffer,
  viewedParticipantIndex: number,
  numParticipants: number
): AMS2ParticipantPage | undefined {
  if (
    viewedParticipantIndex < 0 ||
    viewedParticipantIndex >= numParticipants ||
    viewedParticipantIndex >= AMS2_PARTICIPANT_COUNT
  ) return undefined
  const base = AMS2_PARTICIPANT_BASE + viewedParticipantIndex * AMS2_PARTICIPANT_SIZE
  const currentLapDistance = readFloat32(
    buffer,
    base + AMS2_PARTICIPANT_LAYOUT.currentLapDistance
  )
  if (currentLapDistance === undefined) return undefined
  return {
    active: buffer.readUInt8(base + AMS2_PARTICIPANT_LAYOUT.active) !== 0,
    currentLapDistance,
    racePosition: readUInt32(buffer, base + AMS2_PARTICIPANT_LAYOUT.racePosition),
    lapsCompleted: readUInt32(buffer, base + AMS2_PARTICIPANT_LAYOUT.lapsCompleted),
    currentLap: readUInt32(buffer, base + AMS2_PARTICIPANT_LAYOUT.currentLap)
  }
}

export function decodeAMS2SharedMemoryPage(buffer: Buffer): AMS2SharedMemoryPage | null {
  if (buffer.length < AMS2_SHARED_MEMORY_PREFIX_SIZE) return null
  const version = readUInt32(buffer, AMS2_LAYOUT.version)
  if (!AMS2_SUPPORTED_SHARED_MEMORY_VERSIONS.has(version)) return null
  const gameState = readUInt32(buffer, AMS2_LAYOUT.gameState)
  const sessionState = readUInt32(buffer, AMS2_LAYOUT.sessionState)
  const raceState = readUInt32(buffer, AMS2_LAYOUT.raceState)
  const viewedParticipantIndex = readInt32(buffer, AMS2_LAYOUT.viewedParticipantIndex)
  const numParticipants = readInt32(buffer, AMS2_LAYOUT.numParticipants)
  if (
    gameState > 7 ||
    sessionState > 6 ||
    raceState > 6 ||
    numParticipants < 0 ||
    numParticipants > AMS2_PARTICIPANT_COUNT
  ) return null
  const floats = {
    trackLength: readFloat32(buffer, AMS2_LAYOUT.trackLength),
    bestLapTime: readFloat32(buffer, AMS2_LAYOUT.bestLapTime),
    lastLapTime: readFloat32(buffer, AMS2_LAYOUT.lastLapTime),
    currentTime: readFloat32(buffer, AMS2_LAYOUT.currentTime),
    eventTimeRemaining: readFloat32(buffer, AMS2_LAYOUT.eventTimeRemaining),
    fuelLevel: readFloat32(buffer, AMS2_LAYOUT.fuelLevel),
    fuelCapacity: readFloat32(buffer, AMS2_LAYOUT.fuelCapacity),
    speed: readFloat32(buffer, AMS2_LAYOUT.speed),
    rpm: readFloat32(buffer, AMS2_LAYOUT.rpm),
    maxRpm: readFloat32(buffer, AMS2_LAYOUT.maxRpm),
    brake: readFloat32(buffer, AMS2_LAYOUT.brake),
    throttle: readFloat32(buffer, AMS2_LAYOUT.throttle),
    clutch: readFloat32(buffer, AMS2_LAYOUT.clutch),
    steering: readFloat32(buffer, AMS2_LAYOUT.steering),
    ambientTemperature: readFloat32(buffer, AMS2_LAYOUT.ambientTemperature),
    trackTemperature: readFloat32(buffer, AMS2_LAYOUT.trackTemperature),
    rainDensity: readFloat32(buffer, AMS2_LAYOUT.rainDensity)
  }
  if (Object.values(floats).some((value) => value === undefined)) return null
  return {
    version,
    buildVersion: readUInt32(buffer, AMS2_LAYOUT.buildVersion),
    gameState,
    sessionState,
    raceState,
    viewedParticipantIndex,
    numParticipants,
    participant: decodeParticipant(buffer, viewedParticipantIndex, numParticipants),
    carName: readAscii(buffer, AMS2_LAYOUT.carName, 64),
    lapsInEvent: readUInt32(buffer, AMS2_LAYOUT.lapsInEvent),
    trackLocation: readAscii(buffer, AMS2_LAYOUT.trackLocation, 64),
    trackVariation: readAscii(buffer, AMS2_LAYOUT.trackVariation, 64),
    trackLength: floats.trackLength as number,
    lapInvalidated: buffer.readUInt8(AMS2_LAYOUT.lapInvalidated) !== 0,
    bestLapTime: floats.bestLapTime as number,
    lastLapTime: floats.lastLapTime as number,
    currentTime: floats.currentTime as number,
    eventTimeRemaining: floats.eventTimeRemaining as number,
    highestFlagColour: readUInt32(buffer, AMS2_LAYOUT.highestFlagColour),
    pitMode: readUInt32(buffer, AMS2_LAYOUT.pitMode),
    pitSchedule: readUInt32(buffer, AMS2_LAYOUT.pitSchedule),
    carFlags: readUInt32(buffer, AMS2_LAYOUT.carFlags),
    fuelLevel: floats.fuelLevel as number,
    fuelCapacity: floats.fuelCapacity as number,
    speed: floats.speed as number,
    rpm: floats.rpm as number,
    maxRpm: floats.maxRpm as number,
    brake: floats.brake as number,
    throttle: floats.throttle as number,
    clutch: floats.clutch as number,
    steering: floats.steering as number,
    gear: readInt32(buffer, AMS2_LAYOUT.gear),
    antiLockActive: buffer.readUInt8(AMS2_LAYOUT.antiLockActive) !== 0,
    ambientTemperature: floats.ambientTemperature as number,
    trackTemperature: floats.trackTemperature as number,
    rainDensity: floats.rainDensity as number,
    sequenceNumber: readUInt32(buffer, AMS2_LAYOUT.sequenceNumber)
  }
}

function validLapSeconds(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? value : undefined
}

export function ams2WeatherFromRainDensity(
  rainDensity: unknown
): Pick<TelemetrySnapshot, 'precipitationPct' | 'isRaining' | 'trackWetnessPct'> {
  const rain = typeof rainDensity === 'number' && Number.isFinite(rainDensity)
    ? rainDensity
    : 0
  const precipitationPct = Math.max(0, Math.min(1, rain))
  return {
    precipitationPct,
    isRaining: precipitationPct > 0.01,
    trackWetnessPct: undefined
  }
}

export function ams2TrackIdentity(
  location: unknown,
  variation: unknown
): Pick<TelemetrySnapshot, 'trackName' | 'trackConfigName'> {
  return {
    trackName: firstString(location),
    trackConfigName: firstString(variation)
  }
}

export function ams2Flags(highestFlagColour: number): Flags {
  return {
    green: highestFlagColour === 1,
    blue: highestFlagColour === 2,
    white: highestFlagColour === 3 || highestFlagColour === 4,
    red: highestFlagColour === 5,
    yellow: highestFlagColour === 6 || highestFlagColour === 7,
    black: highestFlagColour === 10,
    checkered: highestFlagColour === 11,
    meatball: highestFlagColour === 9,
    repair: false,
    disqualify: highestFlagColour === 10,
    greenWhiteCheckered: false
  }
}

export function coherentAMS2PagePair(
  first: AMS2SharedMemoryPage | null,
  second: AMS2SharedMemoryPage | null
): AMS2SharedMemoryPage | null {
  return (
    first &&
    second &&
    first.sequenceNumber % 2 === 0 &&
    second.sequenceNumber % 2 === 0 &&
    second.sequenceNumber === first.sequenceNumber
  )
    ? second
    : null
}

function stableSequence(handle: SharedMemoryBufferHandle | null): AMS2SharedMemoryPage | null {
  const firstBuffer = handle?.view
  if (!firstBuffer) return null
  const first = decodeAMS2SharedMemoryPage(firstBuffer)
  const secondBuffer = handle?.view
  if (!secondBuffer) return null
  const second = decodeAMS2SharedMemoryPage(secondBuffer)
  return coherentAMS2PagePair(first, second)
}

function ams2SessionType(value: number): string | undefined {
  switch (Math.trunc(value)) {
    case 1: return 'Practice'
    case 2: return 'Test'
    case 3: return 'Qualifying'
    case 4: return 'Formation Lap'
    case 5: return 'Race'
    case 6: return 'Time Attack'
    default: return undefined
  }
}

export function ams2SnapshotFromPage(
  data: AMS2SharedMemoryPage,
  timestamp = Date.now()
): TelemetrySnapshot | null {
  if (data.gameState === 0) return null
  const rawSession = data.sessionState
  const participant = data.participant
  const completedLaps = Math.max(0, participant?.lapsCompleted ?? 0)
  const scheduledLaps = Math.max(0, data.lapsInEvent)
  const track = ams2TrackIdentity(data.trackLocation, data.trackVariation)
  const weather = ams2WeatherFromRainDensity(data.rainDensity)
  const lapDistPct =
    participant &&
    participant.currentLapDistance >= 0 &&
    data.trackLength > 0
      ? Math.max(0, Math.min(1, participant.currentLapDistance / data.trackLength))
      : undefined
  const fuelLiters =
    data.fuelLevel >= 0 &&
    data.fuelLevel <= 1 &&
    data.fuelCapacity > 0
      ? data.fuelLevel * data.fuelCapacity
      : undefined
  const onPitRoad = data.pitMode !== 0

  return {
    sim: 'ams2',
    connected: true,
    timestamp,
    speedKmh: data.speed * 3.6,
    rpm: data.rpm,
    gear: data.gear,
    maxRpm: data.maxRpm > 0 ? data.maxRpm : undefined,
    throttle: data.throttle,
    brake: data.brake,
    clutch: data.clutch,
    steerAngleDeg: data.steering * 450,
    absActive: data.antiLockActive,
    tcActive: (data.carFlags & (1 << 6)) !== 0,
    sessionType: ams2SessionType(rawSession),
    sessionKind: sessionKindFromProvider('ams2', rawSession),
    carName: data.carName,
    ...track,
    sessionTimeRemainingSec:
      data.eventTimeRemaining >= 0 ? data.eventTimeRemaining / 1000 : undefined,
    currentLap: participant ? completedLaps + 1 : undefined,
    completedLaps: participant ? completedLaps : undefined,
    lapsRemaining:
      participant && scheduledLaps > 0
        ? Math.max(0, scheduledLaps - completedLaps)
        : undefined,
    lapDistPct,
    lastLapTimeSec: validLapSeconds(data.lastLapTime),
    lapValidity: data.lapInvalidated ? 'invalid' : 'valid',
    bestLapTimeSec: validLapSeconds(data.bestLapTime),
    currentLapTimeSec:
      data.currentTime >= 0 ? data.currentTime : undefined,
    position:
      participant && participant.racePosition > 0
        ? participant.racePosition
        : undefined,
    onTrack: data.gameState === 2 || data.gameState === 3 || data.gameState === 4,
    onPitRoad,
    pit: {
      repairNeeded: false,
      optRepairNeeded: false,
      pitsOpen: false,
      inPitStall: data.pitMode === 2 || data.pitMode === 4
    },
    flags: ams2Flags(data.highestFlagColour),
    fuelLiters,
    fuelCapacityLiters: data.fuelCapacity > 0 ? data.fuelCapacity : undefined,
    airTempC: data.ambientTemperature,
    trackTempC: data.trackTemperature,
    ...weather
  }
}

export class AMS2Provider implements TelemetryProvider {
  readonly id = 'ams2' as const
  private koffi: any | null = null
  private memory: SharedMemoryBufferHandle | null = null

  start(): void {
    if (this.memory || process.platform !== 'win32') return
    this.koffi = loadKoffi()
    if (!this.koffi) return
    this.memory = openSharedMemoryBuffer(
      this.koffi,
      '$pcars2$',
      AMS2_SHARED_MEMORY_PREFIX_SIZE
    )
  }

  stop(): void {
    this.memory?.close()
    this.memory = null
  }

  isConnected(): boolean {
    return Boolean(this.memory)
  }

  poll(): TelemetrySnapshot | null {
    if (!this.isConnected()) return null
    const data = stableSequence(this.memory)
    return data ? ams2SnapshotFromPage(data) : null
  }
}
