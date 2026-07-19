import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { TelemetryProvider } from '../telemetry/provider'
import { firstString, loadKoffi, num, optionalNum, openSharedMemory, type SharedMemoryHandle } from './shared-memory'

function ams2Gear(value: unknown): number {
  const gear = Math.trunc(num(value, 0)) & 0x0f
  return gear === 15 ? -1 : gear
}

function validLapSeconds(value: unknown): number | undefined {
  const n = optionalNum(value)
  return n !== undefined && n > 0 ? n : undefined
}

function ams2SessionType(value: unknown): string | undefined {
  switch (Math.trunc(num(value, 0))) {
    case 1: return 'Practice'
    case 2: return 'Test'
    case 3: return 'Qualifying'
    case 4: return 'Formation Lap'
    case 5: return 'Race'
    case 6: return 'Time Attack'
    default: return undefined
  }
}

export class AMS2Provider implements TelemetryProvider {
  readonly id = 'ams2' as const
  private koffi: any | null = null
  private memory: SharedMemoryHandle | null = null
  private struct: any | null = null

  start(): void {
    if (this.memory || process.platform !== 'win32') return
    this.koffi = loadKoffi()
    if (!this.koffi) return
    this.struct = cachedAMS2Struct ??= createAMS2Struct(this.koffi)
    this.memory = openSharedMemory(this.koffi, '$pcars2$', this.struct)
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
    const data = this.memory?.view
    if (!data) return null
    const completedLaps = Math.max(0, Math.trunc(num(data.mLapsCompleted, 0)))
    const scheduledLaps = Math.max(0, Math.trunc(num(data.mLapsInEvent, 0)))
    return {
      sim: 'ams2',
      connected: true,
      timestamp: Date.now(),
      speedKmh: num(data.mSpeed, 0) * 3.6,
      rpm: num(data.mRpm),
      gear: ams2Gear(data.mGearNumGears),
      maxRpm: num(data.mMaxRPM, 0) || undefined,
      throttle: num(data.mThrottle),
      brake: num(data.mBrake),
      clutch: num(data.mClutch),
      steerAngleDeg: num(data.mSteering) * 450,
      sessionType: ams2SessionType(data.mSessionState),
      carName: firstString(data.mCarName),
      trackName: firstString(data.mTrackLocation) ?? firstString(data.mTrackVariation),
      sessionTimeRemainingSec: optionalNum(data.mEventTimeRemaining),
      currentLap: completedLaps + 1,
      completedLaps,
      lapsRemaining: scheduledLaps > 0 ? Math.max(0, scheduledLaps - completedLaps) : undefined,
      lapDistPct: optionalNum(data.mLapDistance) === undefined ? undefined : num(data.mLapDistance) / Math.max(1, num(data.mTrackLength, 1)),
      lastLapTimeSec: validLapSeconds(data.mLastLapTime),
      bestLapTimeSec: validLapSeconds(data.mBestLapTime),
      currentLapTimeSec: optionalNum(data.mCurrentTime),
      position: Math.trunc(num(data.mRacePosition, 0)) || undefined,
      fuelLiters: optionalNum(data.mFuelLevel),
      fuelCapacityLiters: num(data.mFuelCapacity, 0) || undefined
    }
  }
}

let cachedAMS2Struct: any | null = null

function createAMS2Struct(koffi: any): any {
  // AMS2 uses the Project CARS 2 shared memory layout; validate offsets on Windows.
  return koffi.struct('PCars2SharedMemory', {
    mVersion: 'uint32', mBuildVersionNumber: 'uint32', mGameState: 'uint32', mSessionState: 'uint32', mRaceState: 'uint32', mViewedParticipantIndex: 'int32', mNumParticipants: 'int32',
    mUnfilteredThrottle: 'float', mUnfilteredBrake: 'float', mUnfilteredSteering: 'float', mUnfilteredClutch: 'float', mCarName: 'char[64]', mCarClassName: 'char[64]', mLapsInEvent: 'uint32', mTrackLocation: 'char[64]', mTrackVariation: 'char[64]', mTrackLength: 'float',
    mNumSectors: 'int32', mLapInvalidated: 'bool', mBestLapTime: 'float', mLastLapTime: 'float', mCurrentTime: 'float', mSplitTimeAhead: 'float', mSplitTimeBehind: 'float', mSplitTime: 'float', mEventTimeRemaining: 'float', mPersonalFastestLapTime: 'float', mWorldFastestLapTime: 'float', mCurrentSector1Time: 'float', mCurrentSector2Time: 'float', mCurrentSector3Time: 'float', mFastestSector1Time: 'float', mFastestSector2Time: 'float', mFastestSector3Time: 'float', mPersonalFastestSector1Time: 'float', mPersonalFastestSector2Time: 'float', mPersonalFastestSector3Time: 'float', mWorldFastestSector1Time: 'float', mWorldFastestSector2Time: 'float', mWorldFastestSector3Time: 'float', mJoyPad0: 'uint32', mJoyPad1: 'uint32', mJoyPad2: 'uint32', mJoyPad3: 'uint32', mHighestFlagColour: 'uint32', mHighestFlagReason: 'uint32', mPitModeSchedule: 'uint32', mOilTempCelsius: 'int32', mOilPressureKPa: 'uint32', mWaterTempCelsius: 'int32', mWaterPressureKPa: 'uint32', mFuelPressureKPa: 'uint32', mFuelLevel: 'float', mFuelCapacity: 'float', mSpeed: 'float', mRpm: 'uint32', mMaxRPM: 'uint32', mBrake: 'float', mThrottle: 'float', mClutch: 'float', mSteering: 'float', mGearNumGears: 'uint32', mBoostAmount: 'float', mCrashState: 'uint32', mOdometerKM: 'float', mOrientation: koffi.array('float', 3), mLocalVelocity: koffi.array('float', 3), mWorldVelocity: koffi.array('float', 3), mAngularVelocity: koffi.array('float', 3), mLocalAcceleration: koffi.array('float', 3), mWorldAcceleration: koffi.array('float', 3), mExtentsCentre: koffi.array('float', 3), mTyreFlags: koffi.array('uint32', 4), mTerrain: koffi.array('uint32', 4), mTyreY: koffi.array('float', 4), mTyreRPS: koffi.array('float', 4), mTyreSlipSpeed: koffi.array('float', 4), mTyreTemp: koffi.array('uint8', 4), mTyreGrip: koffi.array('float', 4), mTyreHeightAboveGround: koffi.array('float', 4), mTyreLateralStiffness: koffi.array('float', 4), mTyreWear: koffi.array('uint8', 4), mBrakeDamage: koffi.array('uint8', 4), mSuspensionDamage: koffi.array('uint8', 4), mBrakeTempCelsius: koffi.array('int16', 4), mTyreTreadTemp: koffi.array('uint16', 4), mTyreLayerTemp: koffi.array('uint16', 4), mTyreCarcassTemp: koffi.array('uint16', 4), mTyreRimTemp: koffi.array('uint16', 4), mTyreInternalAirTemp: koffi.array('uint16', 4), mWheelLocalPositionY: koffi.array('float', 4), mRideHeight: koffi.array('float', 4), mSuspensionTravel: koffi.array('float', 4), mSuspensionVelocity: koffi.array('float', 4), mAirPressure: 'uint32', mEngineSpeed: 'float', mEngineTorque: 'float', mWings: koffi.array('float', 2), mHandBrake: 'float', mAeroDamage: 'uint8', mEngineDamage: 'uint8', mJoyPad: 'uint32', mDPad: 'uint32', mAntiLockActive: 'bool', mLastOpponentCollisionIndex: 'int32', mLastOpponentCollisionMagnitude: 'float', mBoostActive: 'bool', mRainDensity: 'float', mSnowDensity: 'float', mSessionState2: 'int32', mRacePosition: 'int32', mLapsCompleted: 'uint32', mCurrentLapDistance: 'float', mLapDistance: 'float'
  })
}
