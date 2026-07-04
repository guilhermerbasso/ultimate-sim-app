// EXPERIMENTAL — rF2/LMU shared memory layout; verify field offsets on Windows with LMU running.
//
// Le Mans Ultimate runs on the rFactor 2 engine and bundles The Iron Wolf's
// rF2SharedMemoryMapPlugin, which exposes the same memory-mapped buffers as rF2:
//   $rFactor2SMMP_Telemetry$  → rF2Telemetry  (per-vehicle physics, player = a mVehicles[] entry)
//   $rFactor2SMMP_Scoring$    → rF2Scoring    (session ScoringInfo + per-vehicle scoring)
//
// The structs below mirror The Iron Wolf's rF2State.h (and the canonical
// pyRfactor2SharedMemory / rF2data.cs readers). They are PACK=4: with no internal
// alignment padding in these particular structs, koffi.pack() (pack=1) yields the
// exact same byte offsets. To stay cheap at 60 Hz we only name the fields we read
// and skip the rest with byte padding — every offset is annotated and the total
// struct sizes match the native layout (rF2VehicleTelemetry=1888, rF2Wheel=260,
// rF2ScoringInfo=548, rF2VehicleScoring=584). Verify on Windows if LMU changes the
// plugin's layout.
import type { Corners, Flags, TelemetrySnapshot, TyreInfo } from '../../shared/telemetry'
import type { TelemetryProvider } from '../telemetry/provider'
import { bool, firstString, loadKoffi, num, optionalNum, openSharedMemory, type SharedMemoryHandle } from './shared-memory'

const MAX_MAPPED_VEHICLES = 128
const KELVIN_OFFSET_C = 273.15
const NOMINAL_STEER_LOCK_DEG = 450

// ─── pure helpers (shared by the provider and the unit tests) ────────────────

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

// rF2 reports tyre/temps in Kelvin; only treat physically-plausible (>0) values as real.
export function kelvinToC(value: unknown): number | undefined {
  const n = optionalNum(value)
  return n === undefined || n <= 0 ? undefined : n - KELVIN_OFFSET_C
}

// rF2 lap times are seconds, with -1 used for "no time yet".
function validLapSec(value: unknown): number | undefined {
  const n = optionalNum(value)
  return n !== undefined && n > 0 ? n : undefined
}

// Speed is the magnitude of the local-frame velocity vector (m/s) → km/h.
export function localVelocityKmh(localVel: unknown): number {
  const v = localVel as { x?: unknown; y?: unknown; z?: unknown } | null | undefined
  const x = num(v?.x)
  const y = num(v?.y)
  const z = num(v?.z)
  return Math.sqrt(x * x + y * y + z * z) * 3.6
}

// mUnfilteredSteering is -1..1; scale by the car's physical wheel range (deg) when
// available, otherwise fall back to a nominal half-lock like the AC/ACC providers.
export function rf2SteerAngleDeg(unfilteredSteering: unknown, physicalRangeDeg: unknown): number {
  const steer = num(unfilteredSteering)
  const range = num(physicalRangeDeg)
  return range > 0 ? steer * (range / 2) : steer * NOMINAL_STEER_LOCK_DEG
}

// rF2ScoringInfo.mSession: 0=test day, 1-4=practice, 5-8=qualify, 9=warmup, 10-13=race.
export function rf2SessionType(mSession: unknown): string | undefined {
  const s = optionalNum(mSession)
  if (s === undefined) return undefined
  const v = Math.trunc(s)
  if (v === 0) return 'Test Day'
  if (v >= 1 && v <= 4) return 'Practice'
  if (v >= 5 && v <= 8) return 'Qualify'
  if (v === 9) return 'Warmup'
  if (v >= 10 && v <= 13) return 'Race'
  return undefined
}

// Maps the rF2 game phase + yellow-flag state + player primary flag into the
// normalized Flags shape. rF2GamePhase: 5=green, 6=full-course yellow, 7=stopped,
// 8=over. rF2VehicleScoring.mFlag: 0=green, 6=blue. mFinishStatus: 3=dq.
export function rf2Flags(input: {
  gamePhase?: unknown
  yellowFlagState?: unknown
  sectorFlag?: unknown
  playerFlag?: unknown
  finishStatus?: unknown
}): Flags {
  const phase = Math.trunc(num(input.gamePhase, -1))
  const yellow = Math.trunc(num(input.yellowFlagState, 0))
  const sectors = Array.isArray(input.sectorFlag) ? input.sectorFlag : []
  const anySectorYellow = sectors.some((flag) => Math.trunc(num(flag, 0)) > 0)
  const playerFlag = Math.trunc(num(input.playerFlag, 0))
  const dq = Math.trunc(num(input.finishStatus, 0)) === 3
  return {
    green: phase === 5,
    yellow: phase === 6 || yellow > 0 || anySectorYellow,
    blue: playerFlag === 6,
    white: false,
    checkered: phase === 8,
    red: phase === 7,
    black: dq,
    meatball: false,
    repair: false,
    disqualify: dq,
    greenWhiteCheckered: false
  }
}

// Active-vehicle count is bounded by ScoringInfo.mNumVehicles but never beyond the
// decoded array length.
function activeCount(list: unknown[], declared: unknown): number {
  const n = Math.trunc(num(declared, list.length))
  return n > 0 ? Math.min(list.length, n) : list.length
}

// The player's scoring entry carries the authoritative mIsPlayer flag; fall back to
// the first slot when nothing is flagged (e.g. monitor/replay).
export function findPlayerScoring(scoring: any): any | null {
  const list = scoring?.mVehicles
  if (!Array.isArray(list) || list.length === 0) return null
  const n = activeCount(list, scoring?.mScoringInfo?.mNumVehicles)
  for (let i = 0; i < n; i++) {
    if (bool(list[i]?.mIsPlayer)) return list[i]
  }
  return list[0] ?? null
}

// Telemetry vehicles are not ordered player-first, so match the player's slot mID
// from scoring; fall back to the first slot.
export function findPlayerTelemetry(telemetry: any, playerId: number | undefined): any | null {
  const list = telemetry?.mVehicles
  if (!Array.isArray(list) || list.length === 0) return null
  if (playerId !== undefined && Number.isFinite(playerId)) {
    for (let i = 0; i < list.length; i++) {
      if (Math.trunc(num(list[i]?.mID, NaN)) === playerId) return list[i]
    }
  }
  return list[0] ?? null
}

function tyreFromWheel(wheel: any): TyreInfo {
  const temps = wheel?.mTemperature
  const left = Array.isArray(temps) ? temps[0] : undefined
  const middle = Array.isArray(temps) ? temps[1] : undefined
  const right = Array.isArray(temps) ? temps[2] : undefined
  return {
    tempC: kelvinToC(middle),
    tempLeftC: kelvinToC(left),
    tempMiddleC: kelvinToC(middle),
    tempRightC: kelvinToC(right),
    pressureKpa: optionalNum(wheel?.mPressure),
    wearPct: optionalNum(wheel?.mWear)
  }
}

// Maps decoded rF2 telemetry+scoring views (the player's vehicle) into the normalized
// snapshot. Pure and koffi-free so it can be unit-tested with synthetic views. Returns
// null when either buffer is missing (the sim is not running / not yet connected).
export function mapRf2Snapshot(
  views: { telemetry: any; scoring: any } | null | undefined,
  now: number = Date.now()
): TelemetrySnapshot | null {
  const telemetry = views?.telemetry
  const scoring = views?.scoring
  if (!telemetry || !scoring) return null
  const info = scoring.mScoringInfo
  if (!info) return null

  const playerScoring = findPlayerScoring(scoring)
  const playerId = playerScoring ? Math.trunc(num(playerScoring.mID, NaN)) : undefined
  const playerTelemetry = findPlayerTelemetry(telemetry, Number.isFinite(playerId as number) ? (playerId as number) : undefined)

  const wheels: any[] = Array.isArray(playerTelemetry?.mWheels) ? playerTelemetry.mWheels : []
  const tyres: Corners<TyreInfo> = {
    lf: tyreFromWheel(wheels[0]),
    rf: tyreFromWheel(wheels[1]),
    lr: tyreFromWheel(wheels[2]),
    rr: tyreFromWheel(wheels[3])
  }

  const trackLength = num(info.mLapDist, 0)
  const playerLapDist = num(playerScoring?.mLapDist, 0)
  const lapDistPct = trackLength > 0 ? clamp01(playerLapDist / trackLength) : undefined

  const currentET = num(info.mCurrentET, 0)
  const lapStartET = optionalNum(playerScoring?.mLapStartET)
  const currentLapTimeSec = lapStartET !== undefined && lapStartET >= 0 && currentET > lapStartET ? currentET - lapStartET : undefined
  const endET = num(info.mEndET, 0)
  const sessionTimeRemainingSec = endET > currentET ? endET - currentET : undefined

  const maxLaps = Math.trunc(num(info.mMaxLaps, 0))
  const lapsCompleted = Math.trunc(num(playerScoring?.mTotalLaps, 0))
  const lapsRemaining = maxLaps > 0 && maxLaps < 10000 ? Math.max(0, maxLaps - lapsCompleted) : undefined

  const rainSeverity = num(info.mRaining, 0)
  const wetness = clamp01(num(info.mMaxPathWetness, 0))

  return {
    sim: 'lmu',
    connected: true,
    timestamp: now,
    speedKmh: localVelocityKmh(playerTelemetry?.mLocalVel),
    rpm: num(playerTelemetry?.mEngineRPM),
    gear: Math.trunc(num(playerTelemetry?.mGear, 0)),
    maxRpm: num(playerTelemetry?.mEngineMaxRPM, 0) || undefined,
    throttle: num(playerTelemetry?.mUnfilteredThrottle),
    brake: num(playerTelemetry?.mUnfilteredBrake),
    clutch: num(playerTelemetry?.mUnfilteredClutch),
    steerAngleDeg: rf2SteerAngleDeg(playerTelemetry?.mUnfilteredSteering, playerTelemetry?.mPhysicalSteeringWheelRange),
    waterTempC: optionalNum(playerTelemetry?.mEngineWaterTemp),
    oilTempC: optionalNum(playerTelemetry?.mEngineOilTemp),
    sessionType: rf2SessionType(info.mSession),
    carName: firstString(playerScoring?.mVehicleName),
    trackName: firstString(info.mTrackName),
    sessionTimeRemainingSec,
    lapsRemaining,
    currentLap: lapsCompleted + 1,
    lapDistPct,
    lastLapTimeSec: validLapSec(playerScoring?.mLastLapTime),
    bestLapTimeSec: validLapSec(playerScoring?.mBestLapTime),
    currentLapTimeSec,
    position: Math.trunc(num(playerScoring?.mPlace, 0)) || undefined,
    totalCars: Math.trunc(num(info.mNumVehicles, 0)) || undefined,
    fuelLiters: optionalNum(playerTelemetry?.mFuel),
    tyres,
    flags: rf2Flags({
      gamePhase: info.mGamePhase,
      yellowFlagState: info.mYellowFlagState,
      sectorFlag: info.mSectorFlag,
      playerFlag: playerScoring?.mFlag,
      finishStatus: playerScoring?.mFinishStatus
    }),
    sessionFlagsRaw: Math.trunc(num(info.mGamePhase, 0)),
    airTempC: optionalNum(info.mAmbientTemp),
    trackTempC: optionalNum(info.mTrackTemp),
    isRaining: rainSeverity > 0.01,
    trackWetnessPct: wetness
  }
}

// ─── provider ────────────────────────────────────────────────────────────────

export class LMUProvider implements TelemetryProvider {
  readonly id = 'lmu' as const
  private koffi: any | null = null
  private telemetry: SharedMemoryHandle | null = null
  private scoring: SharedMemoryHandle | null = null
  private structs: { telemetry: any; scoring: any } | null = null

  start(): void {
    if (this.telemetry || process.platform !== 'win32') return
    this.koffi = loadKoffi()
    if (!this.koffi) return
    this.structs = cachedLMUStructs ??= createLMUStructs(this.koffi)
    this.telemetry = openSharedMemory(this.koffi, '$rFactor2SMMP_Telemetry$', this.structs.telemetry)
    this.scoring = openSharedMemory(this.koffi, '$rFactor2SMMP_Scoring$', this.structs.scoring)
  }

  stop(): void {
    this.telemetry?.close()
    this.scoring?.close()
    this.telemetry = null
    this.scoring = null
  }

  isConnected(): boolean {
    return Boolean(this.telemetry && this.scoring)
  }

  poll(): TelemetrySnapshot | null {
    if (!this.isConnected()) return null
    const telemetry = this.telemetry?.view
    const scoring = this.scoring?.view
    if (!telemetry || !scoring) return null
    return mapRf2Snapshot({ telemetry, scoring })
  }
}

let cachedLMUStructs: { telemetry: any; scoring: any } | null = null

// Builds the koffi structs. Padding fields (`_padNN`) are decoded as `char` (cheap,
// NUL-trimmed) purely to advance the cursor — their values are never read. Offsets
// are the absolute byte offsets within each native struct (rF2State.h); the trailing
// size annotations must hold or every later field is misaligned.
function createLMUStructs(koffi: any): { telemetry: any; scoring: any } {
  const pad = (bytes: number): any => koffi.array('char', bytes)
  const vec3 = koffi.pack('rF2Vec3', { x: 'double', y: 'double', z: 'double' }) // size 24

  // rF2Wheel (size 260) — only live pressure (kPa), temps (Kelvin l/c/r) and wear.
  const wheel = koffi.pack('rF2WheelLite', {
    _pad000: pad(120), // 0   mSuspensionDeflection..mGripFract (15 doubles)
    mPressure: 'double', // 120 kPa
    mTemperature: koffi.array('double', 3), // 128 Kelvin (left/center/right)
    mWear: 'double', // 152 0.0-1.0 fraction of maximum
    _pad160: pad(100) // 160 mTerrainName..mExpansion → 260
  })

  // rF2VehicleTelemetry (size 1888).
  const vehicleTelemetry = koffi.pack('rF2VehicleTelemetryLite', {
    mID: 'int32', // 0   slot ID
    _pad004: pad(180), // 4   mDeltaTime..mTrackName..mPos
    mLocalVel: vec3, // 184 local velocity (m/s)
    _pad208: pad(144), // 208 mLocalAccel..mLocalRotAccel
    mGear: 'int32', // 352 -1=reverse, 0=neutral, 1+
    mEngineRPM: 'double', // 356
    mEngineWaterTemp: 'double', // 364 Celsius
    mEngineOilTemp: 'double', // 372 Celsius
    _pad380: pad(8), // 380 mClutchRPM
    mUnfilteredThrottle: 'double', // 388 0..1
    mUnfilteredBrake: 'double', // 396 0..1
    mUnfilteredSteering: 'double', // 404 -1..1
    mUnfilteredClutch: 'double', // 412 0..1
    _pad420: pad(104), // 420 filtered inputs + deflections + aero
    mFuel: 'double', // 524 liters
    mEngineMaxRPM: 'double', // 532 rev limit
    _pad540: pad(152), // 540 mScheduledStops..mTurboBoostPressure (incl. compounds)
    mPhysicalSteeringWheelRange: 'float', // 692 degrees
    _pad696: pad(152), // 696 mExpansion
    mWheels: koffi.array(wheel, 4) // 848 FL,FR,RL,RR → 1888
  })

  // rF2ScoringInfo (size 548) — decoded once per poll, so named in full.
  const scoringInfo = koffi.pack('rF2ScoringInfo', {
    mTrackName: koffi.array('char', 64), // 0
    mSession: 'int32', // 64
    mCurrentET: 'double', // 68 seconds
    mEndET: 'double', // 76 seconds (0 for lap-limited)
    mMaxLaps: 'int32', // 84
    mLapDist: 'double', // 88 track length (m)
    _pad096: pad(8), // 96 pointer1
    mNumVehicles: 'int32', // 104
    mGamePhase: 'uint8', // 108
    mYellowFlagState: 'int8', // 109
    mSectorFlag: koffi.array('int8', 3), // 110
    mStartLight: 'uint8', // 113
    mNumRedLights: 'uint8', // 114
    mInRealtime: 'uint8', // 115
    mPlayerName: koffi.array('char', 32), // 116
    mPlrFileName: koffi.array('char', 64), // 148
    mDarkCloud: 'double', // 212
    mRaining: 'double', // 220 0..1 severity
    mAmbientTemp: 'double', // 228 Celsius
    mTrackTemp: 'double', // 236 Celsius
    mWind: vec3, // 244
    mMinPathWetness: 'double', // 268 0..1
    mMaxPathWetness: 'double', // 276 0..1
    mGameMode: 'uint8', // 284
    mIsPasswordProtected: 'uint8', // 285
    mServerPort: 'uint16', // 286
    mServerPublicIP: 'uint32', // 288
    mMaxPlayers: 'int32', // 292
    mServerName: koffi.array('char', 32), // 296
    mStartET: 'float', // 328
    mAvgPathWetness: 'double', // 332 0..1
    _pad340: pad(200), // 340 mExpansion
    _pad540: pad(8) // 540 pointer2 → 548
  })

  // rF2VehicleScoring (size 584).
  const vehicleScoring = koffi.pack('rF2VehicleScoringLite', {
    mID: 'int32', // 0   slot ID
    _pad004: pad(32), // 4   mDriverName
    mVehicleName: koffi.array('char', 64), // 36
    mTotalLaps: 'int16', // 100 laps completed
    _pad102: pad(1), // 102 mSector
    mFinishStatus: 'int8', // 103 0=none,1=finished,2=dnf,3=dq
    mLapDist: 'double', // 104 current distance around track (m)
    _pad112: pad(32), // 112 mPathLateral..mBestSector2
    mBestLapTime: 'double', // 144 seconds
    _pad152: pad(16), // 152 mLastSector1..mLastSector2
    mLastLapTime: 'double', // 168 seconds
    _pad176: pad(20), // 176 mCurSector1..mNumPenalties
    mIsPlayer: 'uint8', // 196
    _pad197: pad(2), // 197 mControl, mInPits
    mPlace: 'uint8', // 199 1-based position
    _pad200: pad(56), // 200 mVehicleClass..mLapsBehindLeader
    mLapStartET: 'double', // 256 seconds
    _pad264: pad(240), // 264 mPos..mEstimatedLapTime..mPitGroup
    mFlag: 'uint8', // 504 0=green, 6=blue
    _pad505: pad(79) // 505 mUnderYellow..mExpansion → 584
  })

  const telemetry = koffi.pack('rF2Telemetry', {
    mVersionUpdateBegin: 'uint32',
    mVersionUpdateEnd: 'uint32',
    mBytesUpdatedHint: 'int32',
    mNumVehicles: 'int32',
    mVehicles: koffi.array(vehicleTelemetry, MAX_MAPPED_VEHICLES)
  })

  const scoring = koffi.pack('rF2Scoring', {
    mVersionUpdateBegin: 'uint32',
    mVersionUpdateEnd: 'uint32',
    mBytesUpdatedHint: 'int32',
    mScoringInfo: scoringInfo,
    mVehicles: koffi.array(vehicleScoring, MAX_MAPPED_VEHICLES)
  })

  return { telemetry, scoring }
}
