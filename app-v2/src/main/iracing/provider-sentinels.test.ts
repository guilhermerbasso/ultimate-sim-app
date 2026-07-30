import { describe, expect, it, vi } from 'vitest'

// provider.ts → logger.ts imports `electron` for in-app dialog/shell helpers.
vi.mock('electron', () => ({ dialog: {}, shell: {}, app: {} }))

import { __iracingTelemetryTest } from './provider'
import {
  IRSDK_TRACK_SURFACE,
  carIdxEstTime,
  carIdxGear,
  carIdxLapCount,
  carIdxLapDistPct,
  carIdxLapNum,
  carIdxLapTime,
  carIdxPaceLineOrRow,
  carIdxPosition,
  carIdxPushToPassCount,
  carIdxRpm,
  carIdxTrackSurface,
  hasUsablePosition,
  isNotInWorld,
  playerCarIdxOf
} from '../../shared/iracing-sentinels'

// ---------------------------------------------------------------------------
// SYNTHETIC EVIDENCE, NOT A REAL CAPTURE. The var names, array shapes and sentinel
// values follow irsdk_defines.h and the iRacing SDK variable list, but the numbers
// are fabricated so each sentinel can be fed deliberately and the consumer's view of
// it asserted. A real iRacing session is still required to confirm which sentinel a
// given build actually emits for a given channel.
// ---------------------------------------------------------------------------

const { buildDriverStatic, parseDrivers, playerRelativeGapSec, radarCars, relatives } = __iracingTelemetryTest

const SESSION_INFO = {
  DriverInfo: {
    DriverCarIdx: 1,
    Drivers: [
      { CarIdx: 0, UserName: 'In Garage', CarNumber: '12', CarClassID: 7 },
      { CarIdx: 1, UserName: 'Player', CarNumber: '7', CarClassID: 7 },
      { CarIdx: 2, UserName: 'On Track Ahead', CarNumber: '3', CarClassID: 7 }
    ]
  }
}

/** Car 0 is NotInWorld (garage/disconnected); cars 1 and 2 are on track. */
function valuesWithGaragedCar(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    PlayerCarIdx: 1,
    // irsdk_NotInWorld for car 0.
    CarIdxTrackSurface: [IRSDK_TRACK_SURFACE.notInWorld, IRSDK_TRACK_SURFACE.onTrack, IRSDK_TRACK_SURFACE.onTrack],
    CarIdxTrackSurfaceMaterial: [-1, 1, 1],
    // iRacing publishes -1 in EVERY per-car array for a car that is not in the world.
    CarIdxLapDistPct: [-1, 0.5, 0.51],
    CarIdxEstTime: [-1, 45, 45.4],
    CarIdxF2Time: [-1, 0, 0],
    CarIdxLap: [-1, 10, 10],
    CarIdxLapCompleted: [-1, 9, 9],
    CarIdxPosition: [0, 2, 1],
    CarIdxClassPosition: [0, 2, 1],
    CarIdxLastLapTime: [-1, 90.4, 90.1],
    CarIdxBestLapTime: [-1, 90.0, 89.8],
    CarIdxBestLapNum: [-1, 8, 7],
    CarIdxGear: [0, 4, 5],
    CarIdxRPM: [-1, 6800, 7100],
    CarIdxOnPitRoad: [false, false, false],
    CarIdxP2P_Count: [-1, 2, 3],
    CarIdxPaceLine: [-1, 0, 1],
    CarIdxPaceRow: [-1, 1, 2],
    LapLastLapTime: 90,
    ...overrides
  }
}

function parse(values: Record<string, unknown>) {
  return parseDrivers(SESSION_INFO, values, buildDriverStatic(SESSION_INFO))
}

describe('iRacing NotInWorld cars are excluded from live views (§24-18)', () => {
  it('marks a NotInWorld car as not in the world and strips its live channels', () => {
    const garaged = parse(valuesWithGaragedCar())?.[0]

    expect(garaged?.inWorld).toBe(false)
    expect(garaged?.name).toBe('In Garage') // identity survives for the standings table
    expect(garaged?.lapDistPct).toBeUndefined()
    expect(garaged?.gapToPlayerSec).toBeUndefined()
    expect(garaged?.relativeTimeSec).toBeUndefined()
    expect(garaged?.estimatedTimeSec).toBeUndefined()
    expect(garaged?.lap).toBeUndefined()
    expect(garaged?.completedLaps).toBeUndefined()
    expect(garaged?.rpm).toBeUndefined()
    expect(garaged?.trackLocation).toBeUndefined()
  })

  it('never fabricates lapDistPct 0 for a NotInWorld car (that parks it on start/finish)', () => {
    const garaged = parse(valuesWithGaragedCar())?.[0]
    expect(garaged?.lapDistPct).not.toBe(0)
    expect(garaged?.lapDistPct).toBeUndefined()
  })

  it('keeps a NotInWorld car out of relatives even when it would be the nearest gap', () => {
    // Without the guard, the clamped -1 lap distance puts car 0 half a lap behind the
    // player and it wins the "nearest behind" sort.
    const drivers = parse(valuesWithGaragedCar())
    const rel = relatives(drivers)

    expect(rel?.ahead?.carIdx).toBe(2)
    expect(rel?.behind).toBeUndefined()
  })

  it('keeps a NotInWorld car off the radar', () => {
    const drivers = parse(valuesWithGaragedCar())
    const rows = radarCars({ CarLeftRight: 0 }, drivers, 200)

    expect(rows?.map((row) => row.carIdx)).toEqual([2])
  })

  it('returns an unknown gap rather than a start/finish-line gap when lap distance is the sentinel', () => {
    const values = valuesWithGaragedCar({ CarIdxEstTime: [-1, -1, -1], CarIdxF2Time: [-1, -1, -1] })
    expect(playerRelativeGapSec(0, 1, values, values.CarIdxLapDistPct as number[], values.CarIdxLap as number[])).toBeUndefined()
    expect(playerRelativeGapSec(2, 1, values, values.CarIdxLapDistPct as number[], values.CarIdxLap as number[])).toBeCloseTo(0.9, 5)
  })
})

describe('iRacing sentinels that are legitimate values must survive (§24-18)', () => {
  it('keeps CarIdxGear -1 (REVERSE) for a car that IS in the world', () => {
    const values = valuesWithGaragedCar({ CarIdxGear: [0, -1, 5] })
    const player = parse(values)?.[1]

    expect(player?.inWorld).toBe(true)
    expect(player?.gear).toBe(-1)
  })

  it('keeps neutral (gear 0) distinct from an unavailable gear', () => {
    expect(carIdxGear(0)).toBe(0)
    expect(carIdxGear(-1)).toBe(-1)
    expect(carIdxGear(undefined)).toBeUndefined()
    expect(carIdxGear(Number.NaN)).toBeUndefined()
  })

  it('keeps a real pace line/row but hides the -1 "not in a pace line" marker', () => {
    const drivers = parse(valuesWithGaragedCar())

    expect(drivers?.[0].paceLine).toBeUndefined()
    expect(drivers?.[0].paceRow).toBeUndefined()
    expect(drivers?.[1].paceLine).toBe(0) // pace line 0 is the front row, not a sentinel
    expect(drivers?.[2].paceRow).toBe(2)
  })

  it('keeps a real position and falls back to the YAML standing when the live one is the 0 marker', () => {
    const sessionInfoWithResults = {
      DriverInfo: SESSION_INFO.DriverInfo,
      QualifyResultsInfo: {
        Results: [
          { CarIdx: 0, Position: 3, ClassPosition: 3 },
          { CarIdx: 1, Position: 2, ClassPosition: 2 },
          { CarIdx: 2, Position: 1, ClassPosition: 1 }
        ]
      }
    }
    const drivers = parseDrivers(sessionInfoWithResults, valuesWithGaragedCar(), buildDriverStatic(sessionInfoWithResults))

    expect(drivers?.[2].position).toBe(1)
    // Car 0 reports CarIdxPosition 0 ("no position"): the qualifying standing is used
    // instead of publishing 0 as if it were a real place.
    expect(drivers?.[0].position).toBe(3)
  })
})

describe('iracing-sentinels field contract', () => {
  it('isNotInWorld only fires on -1, never on a missing channel', () => {
    expect(isNotInWorld(-1)).toBe(true)
    expect(isNotInWorld(0)).toBe(false)
    expect(isNotInWorld(3)).toBe(false)
    expect(isNotInWorld(undefined)).toBe(false)
    expect(isNotInWorld(null)).toBe(false)
  })

  it('carIdxTrackSurface hides NotInWorld but keeps OffTrack (0)', () => {
    expect(carIdxTrackSurface(IRSDK_TRACK_SURFACE.notInWorld)).toBeUndefined()
    expect(carIdxTrackSurface(IRSDK_TRACK_SURFACE.offTrack)).toBe(0)
    expect(carIdxTrackSurface(IRSDK_TRACK_SURFACE.inPitStall)).toBe(1)
  })

  it('carIdxLapDistPct rejects -1 and keeps the full 0..1 range including 0', () => {
    expect(carIdxLapDistPct(-1)).toBeUndefined()
    expect(carIdxLapDistPct(0)).toBe(0)
    expect(carIdxLapDistPct(0.5)).toBe(0.5)
    expect(carIdxLapDistPct(1)).toBe(1)
    expect(carIdxLapDistPct(1.2)).toBe(1)
  })

  it('carIdxEstTime rejects negatives and keeps 0', () => {
    expect(carIdxEstTime(-1)).toBeUndefined()
    expect(carIdxEstTime(0)).toBe(0)
    expect(carIdxEstTime(42.5)).toBe(42.5)
  })

  it('carIdxLapTime requires a strictly positive time', () => {
    expect(carIdxLapTime(-1)).toBeUndefined()
    expect(carIdxLapTime(0)).toBeUndefined()
    expect(carIdxLapTime(90.4)).toBe(90.4)
  })

  it('carIdxLapCount and carIdxLapNum keep lap 0 but reject -1', () => {
    expect(carIdxLapCount(-1)).toBeUndefined()
    expect(carIdxLapCount(0)).toBe(0)
    expect(carIdxLapNum(-1)).toBeUndefined()
    expect(carIdxLapNum(0)).toBe(0)
  })

  it('carIdxPosition rejects the 0 marker', () => {
    expect(carIdxPosition(0)).toBeUndefined()
    expect(carIdxPosition(1)).toBe(1)
    expect(carIdxPosition(-1)).toBeUndefined()
  })

  it('carIdxRpm and carIdxPushToPassCount reject negatives but keep 0', () => {
    expect(carIdxRpm(-1)).toBeUndefined()
    expect(carIdxRpm(0)).toBe(0)
    expect(carIdxPushToPassCount(-1)).toBeUndefined()
    expect(carIdxPushToPassCount(0)).toBe(0)
  })

  it('carIdxPaceLineOrRow rejects -1 but keeps line/row 0', () => {
    expect(carIdxPaceLineOrRow(-1)).toBeUndefined()
    expect(carIdxPaceLineOrRow(0)).toBe(0)
    expect(carIdxPaceLineOrRow(3)).toBe(3)
  })

  it('playerCarIdxOf rejects -1 instead of pointing at car 0', () => {
    expect(playerCarIdxOf(-1)).toBeUndefined()
    expect(playerCarIdxOf(0)).toBe(0)
    expect(playerCarIdxOf(15)).toBe(15)
    expect(playerCarIdxOf(undefined)).toBeUndefined()
  })

  it('hasUsablePosition rejects only the exact (0,0) sentinel', () => {
    expect(hasUsablePosition(0, 0)).toBe(false)
    expect(hasUsablePosition(0, 1)).toBe(true)
    expect(hasUsablePosition(-27.4, -48.5)).toBe(true)
    expect(hasUsablePosition(undefined, -48.5)).toBe(false)
  })
})
