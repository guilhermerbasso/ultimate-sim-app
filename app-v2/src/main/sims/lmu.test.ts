import { describe, expect, it } from 'vitest'
import {
  kelvinToC,
  localVelocityKmh,
  mapRf2Snapshot,
  rf2Flags,
  rf2SessionType,
  rf2SteerAngleDeg
} from './lmu'

// Synthetic decoded views mirror koffi's output shape (plain JS objects/arrays), so the
// pure mapping can be exercised without koffi or a Windows shared-memory map.

function makeWheel(pressure: number, temps: [number, number, number], wear: number): any {
  return { mPressure: pressure, mTemperature: temps, mWear: wear }
}

function makeViews(): { telemetry: any; scoring: any } {
  return {
    telemetry: {
      mNumVehicles: 2,
      mVehicles: [
        // index 0 is NOT the player — forces mID matching against scoring.
        { mID: 3, mLocalVel: { x: 0, y: 0, z: -10 }, mGear: 1, mEngineRPM: 5000, mEngineMaxRPM: 9000 },
        {
          mID: 7,
          mLocalVel: { x: 0, y: 0, z: -50 }, // 50 m/s → 180 km/h
          mGear: 3,
          mEngineRPM: 8500,
          mEngineWaterTemp: 92,
          mEngineOilTemp: 110,
          mUnfilteredThrottle: 0.8,
          mUnfilteredBrake: 0.1,
          mUnfilteredSteering: 0.5,
          mUnfilteredClutch: 0,
          mFuel: 42.5,
          mEngineMaxRPM: 9000,
          mPhysicalSteeringWheelRange: 540,
          mWheels: [
            makeWheel(165, [350, 360, 355], 0.95),
            makeWheel(166, [351, 361, 356], 0.94),
            makeWheel(160, [340, 345, 342], 0.97),
            makeWheel(161, [341, 346, 343], 0.96)
          ]
        }
      ]
    },
    scoring: {
      mScoringInfo: {
        mTrackName: 'Le Mans',
        mSession: 10, // Race
        mCurrentET: 1234.5,
        mEndET: 1834.5, // 600 s remaining
        mMaxLaps: 0,
        mLapDist: 13629, // track length (m)
        mNumVehicles: 2,
        mGamePhase: 5, // green
        mYellowFlagState: 0,
        mSectorFlag: [0, 0, 0],
        mAmbientTemp: 24,
        mTrackTemp: 31,
        mRaining: 0,
        mMaxPathWetness: 0
      },
      mVehicles: [
        { mID: 3, mVehicleName: 'Other Car', mIsPlayer: 0, mPlace: 1, mTotalLaps: 5 },
        {
          mID: 7,
          mVehicleName: 'Ferrari 499P',
          mIsPlayer: 1,
          mPlace: 2,
          mTotalLaps: 4,
          mLapDist: 6814.5, // half a lap
          mBestLapTime: 211.5,
          mLastLapTime: 213.2,
          mLapStartET: 1100,
          mFlag: 0,
          mFinishStatus: 0
        }
      ]
    }
  }
}

describe('mapRf2Snapshot', () => {
  it('returns null when either buffer view is missing (disconnected)', () => {
    expect(mapRf2Snapshot(null)).toBeNull()
    expect(mapRf2Snapshot(undefined)).toBeNull()
    expect(mapRf2Snapshot({ telemetry: null, scoring: makeViews().scoring })).toBeNull()
    expect(mapRf2Snapshot({ telemetry: makeViews().telemetry, scoring: null })).toBeNull()
    expect(mapRf2Snapshot({ telemetry: {}, scoring: {} })).toBeNull()
  })

  it('maps the player vehicle (matched by mID, not index 0) into a normalized snapshot', () => {
    const snap = mapRf2Snapshot(makeViews(), 1_000)
    expect(snap).not.toBeNull()
    const s = snap!
    expect(s.sim).toBe('lmu')
    expect(s.connected).toBe(true)
    expect(s.timestamp).toBe(1_000)

    // Resolved the player (mID 7) from telemetry index 1, not the index-0 decoy (mID 3).
    expect(s.rpm).toBe(8500)
    expect(s.maxRpm).toBe(9000)
    expect(s.gear).toBe(3)
    expect(s.speedKmh).toBeCloseTo(180, 6)
    expect(s.throttle).toBe(0.8)
    expect(s.brake).toBe(0.1)
    expect(s.clutch).toBe(0)
    expect(s.fuelLiters).toBe(42.5)
    expect(s.waterTempC).toBe(92)
    expect(s.oilTempC).toBe(110)
    // 0.5 * (540 / 2)
    expect(s.steerAngleDeg).toBeCloseTo(135, 6)
  })

  it('maps tyres (kPa pressure, Kelvin→Celsius temps, wear) for all four corners', () => {
    const s = mapRf2Snapshot(makeViews())!
    expect(s.tyres?.lf.pressureKpa).toBe(165)
    expect(s.tyres?.lf.tempC).toBeCloseTo(86.85, 2) // center = 360 K
    expect(s.tyres?.lf.tempLeftC).toBeCloseTo(76.85, 2) // 350 K
    expect(s.tyres?.lf.tempMiddleC).toBeCloseTo(86.85, 2) // 360 K
    expect(s.tyres?.lf.tempRightC).toBeCloseTo(81.85, 2) // 355 K
    expect(s.tyres?.lf.wearPct).toBe(0.95)
    expect(s.tyres?.rr.pressureKpa).toBe(161)
    expect(s.tyres?.rr.tempC).toBeCloseTo(72.85, 2) // 346 K
  })

  it('maps scoring-derived position, laps, timing and session context', () => {
    const s = mapRf2Snapshot(makeViews())!
    expect(s.position).toBe(2)
    expect(s.totalCars).toBe(2)
    expect(s.currentLap).toBe(5) // mTotalLaps (4) + 1
    expect(s.lastLapTimeSec).toBe(213.2)
    expect(s.bestLapTimeSec).toBe(211.5)
    expect(s.currentLapTimeSec).toBeCloseTo(134.5, 6) // 1234.5 - 1100
    expect(s.lapDistPct).toBeCloseTo(0.5, 6) // 6814.5 / 13629
    expect(s.sessionTimeRemainingSec).toBeCloseTo(600, 6) // 1834.5 - 1234.5
    expect(s.sessionType).toBe('Race')
    expect(s.sessionKind).toBe('race')
    expect(s.airTempC).toBe(24)
    expect(s.trackTempC).toBe(31)
    expect(s.trackName).toBe('Le Mans')
    expect(s.carName).toBe('Ferrari 499P')
    expect(s.isRaining).toBe(false)
    expect(s.trackWetnessPct).toBe(0)
  })

  it('reports green flag and raw game phase for a clean racing snapshot', () => {
    const s = mapRf2Snapshot(makeViews())!
    expect(s.flags?.green).toBe(true)
    expect(s.flags?.yellow).toBe(false)
    expect(s.flags?.red).toBe(false)
    expect(s.flags?.checkered).toBe(false)
    expect(s.sessionFlagsRaw).toBe(5)
  })

  it('treats invalid lap times (<= 0) as undefined', () => {
    const views = makeViews()
    views.scoring.mVehicles[1].mLastLapTime = -1
    views.scoring.mVehicles[1].mBestLapTime = -1
    const s = mapRf2Snapshot(views)!
    expect(s.lastLapTimeSec).toBeUndefined()
    expect(s.bestLapTimeSec).toBeUndefined()
  })

  it('falls back to telemetry index 0 when no scoring vehicle is flagged as the player', () => {
    const views = makeViews()
    views.scoring.mVehicles[0].mIsPlayer = 0
    views.scoring.mVehicles[1].mIsPlayer = 0
    // Player resolves to scoring index 0 (mID 3) → telemetry mID 3 (the decoy at index 0).
    const s = mapRf2Snapshot(views)!
    expect(s.rpm).toBe(5000)
    expect(s.gear).toBe(1)
  })

  it('reports a full-course yellow when the game phase indicates it', () => {
    const views = makeViews()
    views.scoring.mScoringInfo.mGamePhase = 6
    const s = mapRf2Snapshot(views)!
    expect(s.flags?.yellow).toBe(true)
    expect(s.flags?.green).toBe(false)
  })
})

describe('rf2 pure helpers', () => {
  it('kelvinToC converts plausible Kelvin and rejects non-physical values', () => {
    expect(kelvinToC(300)).toBeCloseTo(26.85, 2)
    expect(kelvinToC(0)).toBeUndefined()
    expect(kelvinToC(-5)).toBeUndefined()
    expect(kelvinToC(undefined)).toBeUndefined()
  })

  it('localVelocityKmh returns the velocity-vector magnitude in km/h', () => {
    expect(localVelocityKmh({ x: 3, y: 0, z: 4 })).toBeCloseTo(18, 6) // |5 m/s| * 3.6
    expect(localVelocityKmh(null)).toBe(0)
  })

  it('rf2SteerAngleDeg scales by physical range, or a nominal half-lock when unknown', () => {
    expect(rf2SteerAngleDeg(0.5, 540)).toBeCloseTo(135, 6)
    expect(rf2SteerAngleDeg(1, 0)).toBeCloseTo(450, 6) // nominal half-lock fallback
  })

  it('rf2SessionType maps the rF2 session enum ranges', () => {
    expect(rf2SessionType(0)).toBe('Test Day')
    expect(rf2SessionType(2)).toBe('Practice')
    expect(rf2SessionType(7)).toBe('Qualify')
    expect(rf2SessionType(9)).toBe('Warmup')
    expect(rf2SessionType(11)).toBe('Race')
    expect(rf2SessionType(99)).toBeUndefined()
  })

  it('rf2Flags derives yellow from phase, yellow state or any sector flag', () => {
    expect(rf2Flags({ gamePhase: 5 }).green).toBe(true)
    expect(rf2Flags({ gamePhase: 6 }).yellow).toBe(true)
    expect(rf2Flags({ gamePhase: 5, yellowFlagState: 1 }).yellow).toBe(true)
    expect(rf2Flags({ gamePhase: 5, sectorFlag: [0, 1, 0] }).yellow).toBe(true)
    expect(rf2Flags({ gamePhase: 7 }).red).toBe(true)
    expect(rf2Flags({ gamePhase: 8 }).checkered).toBe(true)
    expect(rf2Flags({ playerFlag: 6 }).blue).toBe(true)
    expect(rf2Flags({ finishStatus: 3 }).disqualify).toBe(true)
  })
})
