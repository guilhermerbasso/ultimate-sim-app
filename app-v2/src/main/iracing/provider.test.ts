import { describe, expect, it, vi } from 'vitest'

// provider.ts → logger.ts imports `electron` for in-app dialog/shell helpers.
// Those are never called during unit tests, so a stub avoids the Electron binary
// install race condition that occurs when multiple vitest workers run in parallel.
vi.mock('electron', () => ({ dialog: {}, shell: {}, app: {} }))

import { __iracingTelemetryTest, IRacingProvider } from './provider'
import { logger } from '../modules/logger'
import { ReplayContextTracker, resolveReplayContext } from '../../shared/replay'

describe('iRacing telemetry provider parsing', () => {
  it('builds driver identity and fallback standings from SessionInfo YAML structures', () => {
    const sessionInfo = {
      DriverInfo: {
        DriverCarIdx: 1,
        Drivers: [
          { CarIdx: 0, UserName: 'Ahead Driver', CarNumber: '12', CarClassID: 7, CarClassShortName: 'GT3', CarClassColor: '49c5b1', IRating: 3200, LicString: 'A 4.99', UserID: 100, CarIsPaceCar: 1 },
          { CarIdx: 1, UserName: 'Player Driver', CarNumber: '7', CarClassID: 7, CarClassShortName: 'GT3', CarClassColor: '49c5b1', IRating: 3000, LicString: 'A 4.50', UserID: 101 },
          { CarIdx: 2, UserName: 'Behind Driver', CarNumber: '3', CarClassID: 7, CarClassShortName: 'GT3', CarClassColor: '49c5b1', IRating: 2800, LicString: 'B 3.80', UserID: 102 }
        ]
      },
      QualifyResultsInfo: {
        Results: [
          { CarIdx: 0, Position: 1, ClassPosition: 1 },
          { CarIdx: 1, Position: 2, ClassPosition: 2 },
          { CarIdx: 2, Position: 3, ClassPosition: 3 }
        ]
      }
    }

    const statics = __iracingTelemetryTest.buildDriverStatic(sessionInfo)
    const drivers = __iracingTelemetryTest.parseDrivers(sessionInfo, {
      PlayerCarIdx: 1,
      CarIdxLap: [10, 10, 10],
      CarIdxLapCompleted: [9, 9, 9],
      CarIdxLapDistPct: [0.53, 0.5, 0.48],
      CarIdxF2Time: [100, 102, 104],
      CarIdxEstTime: [84, 82, 80],
      CarIdxLastLapTime: [90.1, 90.4, 91.2],
      CarIdxBestLapTime: [89.8, 90.0, 90.6],
      CarIdxBestLapNum: [7, 8, 6],
      CarIdxGear: [5, 4, 3],
      CarIdxRPM: [7100, 6800, 5900],
      CarIdxOnPitRoad: [false, false, true],
      CarIdxTrackSurface: [3, 3, 2],
      CarIdxTrackSurfaceMaterial: [1, 2, 5],
      CarIdxP2P_Status: [0, 1, 0],
      CarIdxP2P_Count: [3, 2, 1],
      CarIdxPaceFlags: [0, 2, 1],
      CarIdxPaceLine: [0, 0, 1],
      CarIdxPaceRow: [1, 2, 3]
    }, statics)

    expect(drivers?.[0]).toMatchObject({ name: 'Ahead Driver', position: 1, classPosition: 1, gapToPlayerSec: 2, relativeTimeSec: 2, completedLaps: 9, estimatedTimeSec: 84, gear: 5, rpm: 7100, trackLocation: 3, trackSurfaceMaterial: 1, bestLapTimeSec: 89.8, bestLapNum: 7, pushToPassActive: false, pushToPassCount: 3, paceLine: 0, paceRow: 1, isPlayer: false, isPaceCar: true })
    expect(drivers?.[1]).toMatchObject({ name: 'Player Driver', position: 2, classPosition: 2, gapToPlayerSec: 0, relativeTimeSec: 0, pushToPassActive: true, paceFlags: ['freePass'], isPlayer: true })
    expect(drivers?.[2]).toMatchObject({ name: 'Behind Driver', position: 3, classPosition: 3, gapToPlayerSec: -2, relativeTimeSec: -2, inPits: true, paceFlags: ['endOfLine'] })
  })

  it('keeps official irSDK tyre carcass L/M/R temperatures per corner', () => {
    const tyres = __iracingTelemetryTest.tyreTemps({
      LFtempCL: 80,
      LFtempCM: 82,
      LFtempCR: 84,
      RFtempCL: 85,
      RFtempCM: 86,
      RFtempCR: 87,
      LRtempCL: 78,
      LRtempCM: 79,
      LRtempCR: 80,
      RRtempCL: 81,
      RRtempCM: 82,
      RRtempCR: 83,
      LFwearL: 0.98,
      LFwearM: 0.97,
      LFwearR: 0.96
    })

    expect(tyres?.lf).toMatchObject({ tempC: 82, tempLeftC: 80, tempMiddleC: 82, tempRightC: 84, wearPct: 0.97, wearLeftPct: 0.98, wearMiddlePct: 0.97, wearRightPct: 0.96 })
    expect(tyres?.rr).toMatchObject({ tempLeftC: 81, tempMiddleC: 82, tempRightC: 83 })
  })

  it('derives rev-light metadata from DriverCarSL YAML RPMs', () => {
    const setup = __iracingTelemetryTest.driverCarSetup({
      DriverInfo: {
        DriverCarSLFirstRPM: 6000,
        DriverCarSLShiftRPM: 7600,
        DriverCarSLLastRPM: 7800,
        DriverCarSLBlinkRPM: 7900,
        DriverCarFuelMaxLtr: 100
      }
    })

    expect(setup).toMatchObject({ firstRpm: 6000, shiftRpm: 7600, lastRpm: 7800, blinkRpm: 7900, fuelCapacityLiters: 100 })
    expect(__iracingTelemetryTest.revLights(7900, setup)).toMatchObject({ pct: 1, blink: true })
  })
})

describe('iRacing shift-light band (shiftBand)', () => {
  // DriverCarSL band: first light at 6000, OPTIMAL upshift (full fill) at SLShift 7600,
  // all lit at SLLast 7800, blink (over-rev) at 7900. The bar now reaches 1.0 at the
  // OPTIMAL shift point (SLShiftRPM), not the limiter (SLLastRPM).
  const band = { firstRpm: 6000, shiftRpm: 7600, lastRpm: 7800, blinkRpm: 7900 }

  it('keeps the bar DARK below DriverCarSLFirstRPM', () => {
    expect(__iracingTelemetryTest.shiftBand(0, band).pct).toBe(0)
    expect(__iracingTelemetryTest.shiftBand(3000, band).pct).toBe(0) // idle — NOT 3000/7600 proportional
    expect(__iracingTelemetryTest.shiftBand(6000, band).pct).toBe(0) // exactly at first light
  })

  it('maps RPM linearly across the First→Shift band (0.5 at midband)', () => {
    // midpoint of 6000..7600 (SLFirst..SLShift) = 6800
    expect(__iracingTelemetryTest.shiftBand(6800, band).pct).toBeCloseTo(0.5, 5)
  })

  it('is FULL and BLINKS at DriverCarSLShiftRPM (the "shift now" cue lands on the optimal shift)', () => {
    // The shift-now blink fires at the OPTIMAL upshift (SLShiftRPM=7600), NOT the
    // over-rev SLBlinkRPM (7900) — so the most attention-grabbing cue marks the real
    // shift point, not 300rpm past the limiter.
    expect(__iracingTelemetryTest.shiftBand(7500, band)).toMatchObject({ blink: false }) // just below optimal
    expect(__iracingTelemetryTest.shiftBand(7600, band)).toMatchObject({ pct: 1, blink: true }) // optimal shift = full + blink
    expect(__iracingTelemetryTest.shiftBand(7800, band)).toMatchObject({ pct: 1, blink: true })
    expect(__iracingTelemetryTest.shiftBand(8500, band)).toMatchObject({ pct: 1, blink: true })
  })

  it('a car with SLShift < SLLast fills EARLIER (full at SLShift, not the limiter)', () => {
    // Optimal upshift well below the limiter: full fill must arrive at SLShift 7000, not
    // SLLast 7800. With the old First→Last band 7000 would be only ~0.56.
    const earlyShift = { firstRpm: 6000, shiftRpm: 7000, lastRpm: 7800, blinkRpm: 7900 }
    expect(__iracingTelemetryTest.shiftBand(7000, earlyShift).pct).toBe(1)          // full at optimal shift
    expect(__iracingTelemetryTest.shiftBand(6500, earlyShift).pct).toBeCloseTo(0.5, 5) // midpoint of 6000..7000
  })

  it('prefers the per-car SL band (First→Shift) over live ShiftIndicatorPct', () => {
    // Round 11 reverted: the SL band is PRIMARY when SL data exists, because the live
    // ShiftIndicatorPct only fills to the limiter (SLLast). At 6800 (midband) the band
    // reads 0.5 regardless of the sim's 0.99.
    const r = __iracingTelemetryTest.shiftBand(6800, band, 8000, 0.99)
    expect(r.pct).toBeCloseTo(0.5, 5)
    expect(r.source).toBe('sl-band')
  })

  it('uses the SL band even when the car drives ShiftIndicatorPct (band stays authoritative)', () => {
    const r = __iracingTelemetryTest.shiftBand(6800, band, 8000, 0)
    expect(r.pct).toBeCloseTo(0.5, 5)
    expect(r.source).toBe('sl-band')
  })

  it('falls back to a redline-relative TOP-SLICE band — never rpm/maxRpm proportional', () => {
    const noSl = {} // car exposes no DriverCarSL RPMs
    const redline = 8000 // band start 92% = 7360, end 99% = 7920
    expect(__iracingTelemetryTest.shiftBand(3000, noSl, redline).pct).toBe(0)   // idle stays dark (3000/8000=0.375 would be wrong)
    expect(__iracingTelemetryTest.shiftBand(7360, noSl, redline).pct).toBe(0)   // band start
    expect(__iracingTelemetryTest.shiftBand(7640, noSl, redline).pct).toBeCloseTo(0.5, 5) // midpoint
    expect(__iracingTelemetryTest.shiftBand(7920, noSl, redline)).toMatchObject({ pct: 1, blink: true, source: 'redline' }) // blink ~98% of band
  })

  it('falls back to iRacing ShiftIndicatorPct ONLY when there is no SL band; a 0 indicator stays dark', () => {
    const noSl = {}
    // genuinely driven indicator takes priority over the redline fallback
    expect(__iracingTelemetryTest.shiftBand(3000, noSl, 8000, 0.42)).toMatchObject({ pct: 0.42, source: 'iracing-live' })
    // garbage 0 indicator is ignored → redline fallback keeps idle dark (not proportional)
    expect(__iracingTelemetryTest.shiftBand(3000, noSl, 8000, 0).pct).toBe(0)
  })

  it('forces the live fallback fill to FULL at the over-rev RPM even if ShiftIndicatorPct caps below 1.0', () => {
    // Only the LIVE path (no SL band) can cap below 1.0. A car that drives
    // ShiftIndicatorPct but caps it at 0.9 must still hit 1.0 at/after its blink RPM so
    // configured shift-now thresholds can fire. Top-only clamp at a real per-car RPM.
    const noSl = { blinkRpm: 7900 } // blink RPM present, but no First/Shift band → live path
    const r = __iracingTelemetryTest.shiftBand(8000, noSl, 8000, 0.9) // 8000 ≥ blink 7900
    expect(r).toMatchObject({ pct: 1, blink: true, source: 'iracing-live' })
    // Below the over-rev RPM the live value is mirrored as-is (no clamp, matches sim).
    expect(__iracingTelemetryTest.shiftBand(7000, noSl, 8000, 0.9).pct).toBeCloseTo(0.9, 5)
  })

  it('returns undefined fill when there is no band, indicator, or redline', () => {
    expect(__iracingTelemetryTest.shiftBand(5000, {}).pct).toBeUndefined()
  })

  it('ignores a degenerate SLFirstRPM=0 band and falls through to the redline top-slice', () => {
    // first=0 would make the band start at idle: (rpm-0)/(shift-0) glows at low RPM.
    const sl0 = { firstRpm: 0, shiftRpm: 7600, lastRpm: 7800 }
    const redline = 8000 // band start 92% = 7360, end 99% = 7920
    expect(__iracingTelemetryTest.shiftBand(3000, sl0, redline).pct).toBe(0)            // idle stays dark (NOT 3000/7600)
    expect(__iracingTelemetryTest.shiftBand(7640, sl0, redline).pct).toBeCloseTo(0.5, 5) // redline midpoint
    // a genuinely driven indicator still wins over the redline fallback
    expect(__iracingTelemetryTest.shiftBand(3000, sl0, 8000, 0.42).pct).toBeCloseTo(0.42, 5)
  })
})

describe('iRacing car-frame velocity derivation (deriveCarVelocity)', () => {
  it('uses the real VelocityX/Y when iRacing publishes them', () => {
    expect(__iracingTelemetryTest.deriveCarVelocity(42, -1.5, 41, 0.7, false)).toEqual({ velocityX: 42, velocityY: -1.5 })
  })

  it('keeps the real VelocityX even when VelocityY is absent (does not derive over it)', () => {
    expect(__iracingTelemetryTest.deriveCarVelocity(42, undefined, 41, 0.7, false)).toEqual({ velocityX: 42, velocityY: undefined })
  })

  it('derives a forward-only velocity from Speed + YawNorth when VelocityX is null', () => {
    // The user's 53-min capture: velocityX/Y null but YawNorth present. With Speed we
    // synthesize vx = Speed (forward), vy = 0 so the learner can dead-reckon a path.
    expect(__iracingTelemetryTest.deriveCarVelocity(undefined, undefined, 55, 1.2, false)).toEqual({ velocityX: 55, velocityY: 0 })
  })

  it('does NOT dead-reckon when usable lat/lon exist (lets the accurate lat-lon mode win)', () => {
    // With valid geographic position available, leave velocity undefined so the learner
    // picks lat-lon acquisition instead of a slip-ignoring dead-reckoned path.
    expect(__iracingTelemetryTest.deriveCarVelocity(undefined, undefined, 55, 1.2, true)).toEqual({ velocityX: undefined, velocityY: undefined })
  })

  it('stays undefined when neither real velocity nor Speed+YawNorth are available', () => {
    expect(__iracingTelemetryTest.deriveCarVelocity(undefined, undefined, undefined, 1.2, false)).toEqual({ velocityX: undefined, velocityY: undefined })
    expect(__iracingTelemetryTest.deriveCarVelocity(undefined, undefined, 55, undefined, false)).toEqual({ velocityX: undefined, velocityY: undefined })
  })
})

describe('IRacingProvider shift-light diagnostics', () => {
  type DiagProvider = { logShiftDiagnostics(setup: unknown, maxRpm: number | undefined, source: string): void }
  const setup = { firstRpm: 6000, shiftRpm: 7600, lastRpm: 7800, blinkRpm: 7900 }

  it('logs each DISTINCT source once per car (captures idle sl-band AND in-band iracing-live)', () => {
    const spy = vi.spyOn(logger, 'info').mockImplementation(() => {})
    try {
      const diag = new IRacingProvider() as unknown as DiagProvider
      diag.logShiftDiagnostics(setup, 8000, 'sl-band')      // idle frame
      diag.logShiftDiagnostics(setup, 8000, 'sl-band')      // same source → deduped
      diag.logShiftDiagnostics(setup, 8000, 'iracing-live') // accelerated into band → NEW source → logged
      diag.logShiftDiagnostics(setup, 8000, 'iracing-live') // deduped
      const revLines = spy.mock.calls.filter((c) => c[0] === 'revlights')
      expect(revLines).toHaveLength(2)
      expect(revLines.map((c) => (c[2] as { source: string }).source)).toEqual(['sl-band', 'iracing-live'])
    } finally {
      spy.mockRestore()
    }
  })

  it('resets the logged-source set when the car/session signature changes', () => {
    const spy = vi.spyOn(logger, 'info').mockImplementation(() => {})
    try {
      const diag = new IRacingProvider() as unknown as DiagProvider
      diag.logShiftDiagnostics(setup, 8000, 'sl-band')
      diag.logShiftDiagnostics(setup, 8000, 'sl-band') // deduped
      const other = { firstRpm: 5000, shiftRpm: 6000, lastRpm: 6200, blinkRpm: 6300 }
      diag.logShiftDiagnostics(other, 7000, 'sl-band')  // new car → re-logs even same source
      expect(spy.mock.calls.filter((c) => c[0] === 'revlights')).toHaveLength(2)
    } finally {
      spy.mockRestore()
    }
  })
})

// ─── New iRacing channels: pit status + cold tyre pressures (pure builders) ──────
describe('iRacing pit status (pitStatus)', () => {
  it('maps the real iRacing vars and DERIVES repairNeeded from PitRepairLeft > 0', () => {
    // iRacing has no boolean "repair needed" var — it is derived from the repair-time-left
    // seconds. PitsOpen/PlayerCarInPitStall are real bools; PlayerCarPitSvStatus is an enum.
    const pit = __iracingTelemetryTest.pitStatus({
      PitRepairLeft: 5.5,
      PitOptRepairLeft: 0,
      PitsOpen: true,
      PlayerCarInPitStall: false,
      PlayerCarPitSvStatus: 2
    })
    expect(pit).toEqual({ repairNeeded: true, optRepairNeeded: false, pitsOpen: true, inPitStall: false, svStatus: 2 })
  })

  it('flags optional repairs and truncates the service-status enum', () => {
    const pit = __iracingTelemetryTest.pitStatus({ PitOptRepairLeft: 12.3, PlayerCarPitSvStatus: 1.9 })
    expect(pit).toMatchObject({ repairNeeded: false, optRepairNeeded: true, svStatus: 1 })
  })

  it('returns undefined (not a crash) when NONE of the pit vars are present', () => {
    expect(__iracingTelemetryTest.pitStatus({})).toBeUndefined()
  })
})

describe('iRacing cold tyre pressures (coldPressures)', () => {
  it('maps LF/RF/LR/RRcoldPressure (kPa) — iRacing exposes no LIVE pressure var', () => {
    expect(__iracingTelemetryTest.coldPressures({
      LFcoldPressure: 138, RFcoldPressure: 140, LRcoldPressure: 135, RRcoldPressure: 137
    })).toEqual({ lf: 138, rf: 140, lr: 135, rr: 137 })
  })

  it('returns undefined when no cold-pressure var is present', () => {
    expect(__iracingTelemetryTest.coldPressures({ Speed: 50 })).toBeUndefined()
  })
})

// ─── New iRacing channels: end-to-end var → snapshot mapping through poll() ──────
type StubReadResult = { values: Record<string, unknown>; sessionInfo: unknown; sessionInfoYaml: string }
function pollWith(values: Record<string, unknown>, sessionInfo: unknown = undefined) {
  const provider = new IRacingProvider()
  const stubMmf = {
    start() {},
    stop() {},
    isOpen: () => true,
    isConnected: () => true,
    read: (): StubReadResult => ({ values, sessionInfo, sessionInfoYaml: '' })
  }
  ;(provider as unknown as { mmf: unknown }).mmf = stubMmf
  ;(provider as unknown as { started: boolean }).started = true
  return provider.poll()
}

// Like pollWith but drives the SAME provider across several polls with an advancing clock,
// so the stateful tcActive debounce (TcLatch) can cross its min-on window. snapshot.timestamp
// is Date.now(), so we mock it to step time forward deterministically.
function pollSustained(
  values: Record<string, unknown>,
  { polls = 6, stepMs = 60 }: { polls?: number; stepMs?: number } = {}
) {
  const provider = new IRacingProvider()
  const stubMmf = {
    start() {},
    stop() {},
    isOpen: () => true,
    isConnected: () => true,
    read: (): StubReadResult => ({ values, sessionInfo: undefined, sessionInfoYaml: '' })
  }
  ;(provider as unknown as { mmf: unknown }).mmf = stubMmf
  ;(provider as unknown as { started: boolean }).started = true
  let now = 1_000_000
  const spy = vi.spyOn(Date, 'now').mockImplementation(() => now)
  let snap = provider.poll()
  for (let i = 1; i < polls; i++) {
    now += stepMs
    snap = provider.poll()
  }
  spy.mockRestore()
  return snap
}

describe('iRacing new-channel snapshot mapping (poll)', () => {
  it.each([
    [0, 0, false],
    [1, 1, false],
    [2, 2, true],
    [3, 3, true],
    [7, undefined, true]
  ] as const)('normalizes DRS_Status=%s without changing the legacy boolean', (raw, state, legacy) => {
    const snap = pollWith({ Speed: 50, RPM: 7000, Gear: 3, DRS_Status: raw })
    expect(snap?.drsState).toBe(state)
    expect(snap?.drs).toBe(legacy)
  })

  it('preserves the legacy DRS_Active fallback when DRS_Status is absent', () => {
    const snap = pollWith({ Speed: 50, RPM: 7000, Gear: 3, DRS_Active: true })
    expect(snap?.drsState).toBeUndefined()
    expect(snap?.drs).toBe(true)
  })

  it('maps every new field from its verified irSDK var', () => {
    const snap = pollWith({
      Speed: 50, RPM: 7000, Gear: 3,
      EnergyERSBatteryPct: 0.62,
      PushToPass: true,
      P2P_Count: 8,
      WeatherDeclaredWet: true,
      PlayerTrackSurfaceMaterial: 12, // rumble_2 → 'kerb'
      PlayerCarWeightPenalty: 25,
      PlayerCarPowerAdjust: -3.5,
      SessionTimeOfDay: 3661,
      PitRepairLeft: 4.2,
      PitOptRepairLeft: 0,
      PitsOpen: true,
      PlayerCarInPitStall: false,
      PlayerCarPitSvStatus: 1,
      LFcoldPressure: 138, RFcoldPressure: 140, LRcoldPressure: 135, RRcoldPressure: 137
    })
    expect(snap?.ersBatteryPct).toBeCloseTo(0.62, 5)
    expect(snap?.pushToPass).toBe(true)
    expect(snap?.pushToPassCount).toBe(8)
    expect(snap?.weatherDeclaredWet).toBe(true)
    expect(snap?.trackSurfaceMaterial).toBe(12)
    expect(snap?.weightPenaltyKg).toBe(25)
    expect(snap?.powerAdjustPct).toBeCloseTo(-3.5, 5)
    expect(snap?.sessionTimeOfDay).toBe(3661)
    expect(snap?.pit).toEqual({ repairNeeded: true, optRepairNeeded: false, pitsOpen: true, inPitStall: false, svStatus: 1 })
    expect(snap?.tireColdPressuresKpa).toEqual({ lf: 138, rf: 140, lr: 135, rr: 137 })
  })

  it('falls back to P2P_Status for pushToPass when PushToPass is absent', () => {
    const snap = pollWith({ Speed: 10, RPM: 3000, Gear: 1, P2P_Status: 1 })
    expect(snap?.pushToPass).toBe(true)
  })

  it('leaves every new field undefined (no crash) when iRacing omits the vars', () => {
    const snap = pollWith({ Speed: 10, RPM: 3000, Gear: 1 })
    expect(snap).not.toBeNull()
    expect(snap?.ersBatteryPct).toBeUndefined()
    expect(snap?.pushToPass).toBeUndefined()
    expect(snap?.pushToPassCount).toBeUndefined()
    expect(snap?.weatherDeclaredWet).toBeUndefined()
    expect(snap?.trackSurfaceMaterial).toBeUndefined()
    expect(snap?.weightPenaltyKg).toBeUndefined()
    expect(snap?.powerAdjustPct).toBeUndefined()
    expect(snap?.sessionTimeOfDay).toBeUndefined()
    expect(snap?.pit).toBeUndefined()
    expect(snap?.tireColdPressuresKpa).toBeUndefined()
  })

  it('maps the v6 surfaced channels (attitude, driveline, FFB, deltas, env, brake-line, fuel%) from their irSDK vars', () => {
    const snap = pollWith({
      Speed: 50, RPM: 7000, Gear: 3,
      SteeringWheelPctTorque: 0.42,
      SteeringWheelAngleMax: Math.PI, // 180°
      Pitch: 0.05, Roll: -0.03, Yaw: 1.2, PitchRate: 0.01, RollRate: -0.02, Alt: 120,
      ManifoldPress: 0.95, FuelPress: 4.3, Voltage: 12.6, WaterLevel: 6.5, OilLevel: 5.2,
      FuelLevelPct: 0.5,
      LFbrakeLinePress: 20, RFbrakeLinePress: 21, LRbrakeLinePress: 18, RRbrakeLinePress: 19,
      LapDeltaToOptimalLap: -0.4, LapDeltaToSessionOptimalLap: 0.2, LapDeltaToDriverBestLap: -0.1,
      FogLevel: 0.1, RelativeHumidity: 0.6, WindVel: 3.5, WindDir: 1.57,
      SolarAltitude: 0.8, SolarAzimuth: 2.1, Skies: 2
    })
    expect(snap?.steeringTorquePct).toBeCloseTo(0.42, 5)
    expect(snap?.steeringAngleMaxDeg).toBeCloseTo(180, 4)
    expect(snap?.pitchRad).toBeCloseTo(0.05, 5)
    expect(snap?.rollRad).toBeCloseTo(-0.03, 5)
    expect(snap?.yawRad).toBeCloseTo(1.2, 5)
    expect(snap?.pitchRateRadSec).toBeCloseTo(0.01, 5)
    expect(snap?.rollRateRadSec).toBeCloseTo(-0.02, 5)
    expect(snap?.altitudeM).toBe(120)
    expect(snap?.manifoldPressBar).toBeCloseTo(0.95, 5)
    expect(snap?.fuelPressBar).toBeCloseTo(4.3, 5)
    expect(snap?.voltage).toBeCloseTo(12.6, 5)
    expect(snap?.waterLevelL).toBeCloseTo(6.5, 5)
    expect(snap?.oilLevelL).toBeCloseTo(5.2, 5)
    expect(snap?.fuelLevelPct).toBeCloseTo(0.5, 5)
    expect(snap?.brakeLinePressBar).toEqual({ lf: 20, rf: 21, lr: 18, rr: 19 })
    expect(snap?.deltaToOptimalSec).toBeCloseTo(-0.4, 5)
    expect(snap?.deltaToSessionOptimalSec).toBeCloseTo(0.2, 5)
    expect(snap?.deltaToDriverBestSec).toBeCloseTo(-0.1, 5)
    expect(snap?.fogPct).toBeCloseTo(0.1, 5)
    expect(snap?.humidityPct).toBeCloseTo(0.6, 5)
    expect(snap?.windSpeedMs).toBeCloseTo(3.5, 5)
    expect(snap?.windDirRad).toBeCloseTo(1.57, 5)
    expect(snap?.solarAltitudeRad).toBeCloseTo(0.8, 5)
    expect(snap?.solarAzimuthRad).toBeCloseTo(2.1, 5)
    expect(snap?.skies).toBe(2)
  })

  it('leaves the v6 surfaced channels undefined when iRacing omits the vars', () => {
    const snap = pollWith({ Speed: 10, RPM: 3000, Gear: 1 })
    const fields = [
      'steeringTorquePct', 'steeringAngleMaxDeg', 'pitchRad', 'rollRad', 'yawRad',
      'pitchRateRadSec', 'rollRateRadSec', 'altitudeM', 'manifoldPressBar', 'fuelPressBar',
      'voltage', 'waterLevelL', 'oilLevelL', 'fuelLevelPct', 'brakeLinePressBar',
      'deltaToOptimalSec', 'deltaToSessionOptimalSec', 'deltaToDriverBestSec',
      'fogPct', 'humidityPct', 'windSpeedMs', 'windDirRad', 'solarAltitudeRad', 'solarAzimuthRad', 'skies'
    ] as const
    for (const f of fields) expect(snap?.[f]).toBeUndefined()
  })
})

// ─── B2 iFlag fix + SDK-gap channels: ABS/TC + new fields through poll() ─────
describe('iRacing B2 channels (ABS/TC fix + SDK-gap fields) snapshot mapping', () => {
  it('decodes ABS active from the REAL var BrakeABSactive (lower-case active)', () => {
    expect(pollWith({ Speed: 50, RPM: 7000, Gear: 3, BrakeABSactive: true })?.absActive).toBe(true)
    expect(pollWith({ Speed: 50, RPM: 7000, Gear: 3, BrakeABSactive: 0 })?.absActive).toBe(false)
    // Absent → undefined so consumers render '—'.
    expect(pollWith({ Speed: 50, RPM: 7000, Gear: 3 })?.absActive).toBeUndefined()
  })

  it('DERIVES tcActive (no native var) — debounced: single spike false, sustained corner exit latches true', () => {
    // iRacing has no TC-active var; tcActive is derived. Phantom TractionControlActive/
    // TractionControl must NOT influence it. Heavy throttle while DECELERATING (clearly
    // negative LongAccel m/s² ⇒ negative G) at moderate speed ⇒ raw traction-loss condition.
    const intervening = {
      Speed: 19, RPM: 5000, Gear: 2, Throttle: 0.95, LongAccel: -3.0, Brake: 0,
      PlayerCarRedLine: 8000, dcTractionControl: 4, TractionControlActive: false, TractionControl: 0
    }
    // A SINGLE frame is below the debounce window → not yet latched (kills the chatter).
    expect(pollWith(intervening)?.tcActive).toBe(false)
    // Held across several polls (clock advancing past the min-on window) → latches true.
    expect(pollSustained(intervening)?.tcActive).toBe(true)
  })

  it('DERIVES tcActive false when gripping / off-throttle (and ignores phantom TC vars)', () => {
    // Strong forward accel under throttle = hooked up → derived TC inactive, even though
    // the (non-existent) phantom vars say "active".
    const gripping = pollWith({
      Speed: 19, RPM: 5000, Gear: 2, Throttle: 0.95, LongAccel: 8.0, Brake: 0,
      PlayerCarRedLine: 8000, dcTractionControl: 4, TractionControlActive: true, TractionControl: 1
    })
    expect(gripping?.tcActive).toBe(false)
    // Off throttle / coasting → false.
    expect(pollWith({ Speed: 50, RPM: 4000, Gear: 3, Throttle: 0, dcTractionControl: 4, PlayerCarRedLine: 8000 })?.tcActive).toBe(false)
  })

  it('maps absCutPct from BrakeABSCutPct', () => {
    expect(pollWith({ Speed: 50, RPM: 7000, Gear: 3, BrakeABSCutPct: 18.5 })?.absCutPct).toBeCloseTo(18.5, 5)
    expect(pollWith({ Speed: 50, RPM: 7000, Gear: 3 })?.absCutPct).toBeUndefined()
  })

  it('decodes the EngineWarnings bitfield (water + rev-limiter) into named lamps', () => {
    const snap = pollWith({ Speed: 50, RPM: 7000, Gear: 3, EngineWarnings: 0x0001 | 0x0020 })
    expect(snap?.engineWarnings).toMatchObject({ waterTemp: true, revLimiter: true, oilPressure: false, mandRepair: false })
    expect(pollWith({ Speed: 50, RPM: 7000, Gear: 3 })?.engineWarnings).toBeUndefined()
  })

  it('maps sessionState / paceMode / paceFlags from their enums', () => {
    const snap = pollWith({ Speed: 50, RPM: 7000, Gear: 3, SessionState: 4, PaceMode: 1, PaceFlags: 0x0002 })
    expect(snap?.sessionState).toBe('racing')
    expect(snap?.paceMode).toBe('doubleFileStart')
    expect(snap?.paceFlags).toEqual(['freePass'])
    const empty = pollWith({ Speed: 50, RPM: 7000, Gear: 3 })
    expect(empty?.sessionState).toBeUndefined()
    expect(empty?.paceMode).toBeUndefined()
    expect(empty?.paceFlags).toBeUndefined()
  })

  it('adds carLeftRightCount (2 for LR2CarsLeft/Right) alongside the decided side', () => {
    const two = pollWith({ Speed: 50, RPM: 7000, Gear: 3, CarLeftRight: 5 })
    expect(two?.carLeftRight).toBe('left')
    expect(two?.carLeftRightCount).toBe(2)
    const one = pollWith({ Speed: 50, RPM: 7000, Gear: 3, CarLeftRight: 3 })
    expect(one?.carLeftRight).toBe('right')
    expect(one?.carLeftRightCount).toBe(1)
    // Clear → no count.
    expect(pollWith({ Speed: 50, RPM: 7000, Gear: 3, CarLeftRight: 1 })?.carLeftRightCount).toBeUndefined()
  })
})

describe('iRacing remaining widget-channel snapshot mapping', () => {
  it('keeps engineMap separate from throttleMap and hides unsupported fallbacks', () => {
    const throttleOnly = pollWith({
      Speed: 50,
      RPM: 7000,
      Gear: 3,
      dcThrottleShape: 4,
      dcBoostLevel: 5
    })
    expect(throttleOnly?.throttleMap).toBe(4)
    expect(throttleOnly?.engineMap).toBeUndefined()

    const mapped = pollWith({
      Speed: 50,
      RPM: 7000,
      Gear: 3,
      dcThrottleShape: 4,
      dcFuelMixture: 2
    })
    expect(mapped).toMatchObject({ throttleMap: 4, engineMap: 2 })

    expect(pollWith({
      Speed: 50,
      RPM: 7000,
      Gear: 3,
      dcFuelMixture: '',
      dcEnginePower: 3
    })?.engineMap).toBe(3)
  })

  it('keeps kg/lap separate until observed FuelLevel deltas establish litres/lap', () => {
    let values: Record<string, unknown> = {
      Speed: 50,
      RPM: 7000,
      Gear: 3,
      Lap: 1,
      FuelLevel: 20,
      FuelUsePerHour: 36,
      LapLastLapTime: 100,
      IsReplayPlaying: false,
      ReplaySessionNum: -1,
      ReplayFrameNum: 100,
      ReplayFrameNumEnd: 0,
      SessionTime: 100,
      ReplaySessionTime: 100,
      SessionUniqueID: 44,
      SessionNum: 0
    }
    const provider = new IRacingProvider()
    ;(provider as unknown as { mmf: unknown }).mmf = {
      start() {},
      stop() {},
      isOpen: () => true,
      isConnected: () => true,
      read: (): StubReadResult => ({
        values,
        sessionInfo: { WeekendInfo: { SimMode: 'full', SessionID: 10 } },
        sessionInfoYaml: ''
      })
    }
    ;(provider as unknown as { started: boolean }).started = true

    const first = provider.poll()
    expect(first?.fuelPerLapKg).toBeCloseTo(1, 5)
    expect(first?.fuelPerLapLiters).toBeUndefined()
    expect(first?.fuelLapsRemaining).toBeUndefined()
    expect(first?.fuelPerLap).toBeUndefined()

    values = { ...values, Lap: 2, FuelLevel: 18 }
    const second = provider.poll()
    expect(second?.fuelPerLapKg).toBeCloseTo(1, 5)
    expect(second?.fuelPerLapLiters).toBeCloseTo(2, 5)
    expect(second?.fuelPerLap).toBeCloseTo(2, 5)
    expect(second?.fuelLapsRemaining).toBeCloseTo(9, 5)
  })

  it('maps scalar, replay, pit, weather, setup, vector, and map fields without inventing defaults', () => {
    const snap = pollWith({
      Speed: 50,
      RPM: 7000,
      Gear: 3,
      VelocityZ: -0.4,
      dcThrottleShape: 4,
      dcEngineBraking: 5,
      dcAntiRollFront: 3,
      dcAntiRollRear: 6,
      dcWeightJackerRight: -1,
      SessionNum: 2,
      SessionTime: 1234.5,
      LapCompleted: 8,
      LapDist: 3210,
      LapBestNLapLap: 7,
      LapBestNLapTime: 91.25,
      IsOnTrackCar: true,
      CamCarIdx: 12,
      IsReplayPlaying: false,
      ReplayFrameNum: 200,
      ReplayFrameNumEnd: 1000,
      PitSvLFP: 151,
      PitSvRFP: 152,
      PitSvLRP: 149,
      PitSvRRP: 150,
      PitSvFuel: 34.5,
      PitRepairLeft: 18,
      PitOptRepairLeft: 42,
      PitstopActive: 1,
      Precipitation: 0.35,
      AirDensity: 1.16,
      AirPressure: 29.8,
      WeatherType: 2
    }, {
      WeekendInfo: { TrackLength: '7.004 km' }
    })

    expect(snap).toMatchObject({
      velocityZ: -0.4,
      throttleMap: 4,
      engineBraking: 5,
      antiRollFront: 3,
      antiRollRear: 6,
      weightJackerRight: -1,
      sessionNumber: 2,
      sessionTimeSec: 1234.5,
      completedLaps: 8,
      lapDistanceM: 3210,
      bestNLapLap: 7,
      bestNLapTimeSec: 91.25,
      onTrack: true,
      cameraCarIdx: 12,
      replayPlaying: false,
      replayFrameNum: 200,
      replayFrameEnd: 1000,
      pitTyreTargetsKpa: { lf: 151, rf: 152, lr: 149, rr: 150 },
      pitFuelToAddL: 34.5,
      repairTimeSec: 18,
      optionalRepairTimeSec: 42,
      pitStopActive: true,
      precipitationPct: 0.35,
      airDensityKgM3: 1.16,
      airPressureKpa: 100.9143922,
      airPressureHg: 29.8,
      weatherType: 2,
      trackLengthKm: 7.004
    })
  })

  it('keeps every new optional channel undefined when the SDK omits it', () => {
    const snap = pollWith({ Speed: 50, RPM: 7000, Gear: 3 })
    const fields = [
      'velocityZ', 'engineMap', 'throttleMap', 'engineBraking', 'antiRollFront', 'antiRollRear',
      'weightJackerRight', 'sessionNumber', 'sessionTimeSec', 'completedLaps',
      'lapDistanceM', 'bestNLapLap', 'bestNLapTimeSec', 'onTrack', 'cameraCarIdx',
      'replayPlaying', 'replayFrameNum', 'replayFrameEnd', 'pitTyreTargetsKpa',
      'pitFuelToAddL', 'repairTimeSec', 'optionalRepairTimeSec', 'pitStopActive',
      'precipitationPct', 'airDensityKgM3', 'airPressureKpa', 'airPressureHg', 'weatherType', 'trackLengthKm',
      'fuelPerLapLiters', 'fuelLapsRemaining'
    ] as const
    for (const field of fields) expect(snap?.[field]).toBeUndefined()
  })
})

describe('iRacing canonical replay context', () => {
  const liveValues = {
    Speed: 50,
    RPM: 7000,
    Gear: 3,
    IsReplayPlaying: false,
    ReplaySessionNum: -1,
    ReplayFrameNum: 480_000,
    ReplayFrameNumEnd: 0,
    SessionTime: 7_200,
    ReplaySessionTime: 7_199.2,
    SessionUniqueID: 44,
    SessionNum: 2
  }
  const liveInfo = { WeekendInfo: { SimMode: 'full', SessionID: 10, SubSessionID: 20 } }

  it.each([
    ['live edge at zero', { simMode: 'full', isReplayPlaying: false, replaySessionNum: -1, replayFrameNum: 100, replayFrameNumEnd: 0, sessionTime: 100, replaySessionTime: 100 }, 'live', 'confirmed-live'],
    ['live edge at one with clock lag', { simMode: 'full', isReplayPlaying: false, replaySessionNum: -1, replayFrameNum: 100, replayFrameNumEnd: 1, sessionTime: 100, replaySessionTime: 99 }, 'live', 'confirmed-live'],
    ['frame cursor behind with a replay session', { simMode: 'full', isReplayPlaying: false, replaySessionNum: 2, replayFrameNumEnd: 2, sessionTime: 100, replaySessionTime: 100 }, 'replay', 'cursor-behind-live'],
    ['time cursor behind with a replay session', { simMode: 'full', isReplayPlaying: false, replaySessionNum: 2, replayFrameNum: 100, replayFrameNumEnd: 1, sessionTime: 100, replaySessionTime: 98 }, 'replay', 'cursor-behind-live'],
    ['captured live with dormant cursor fields', { simMode: 'full', isReplayPlaying: false, replaySessionNum: -1, replayFrameNum: 480_000, replayFrameNumEnd: 180_000, sessionTime: 7_200, replaySessionTime: 0 }, 'live', 'confirmed-live'],
    ['playing despite contradictory session', { simMode: 'full', isReplayPlaying: true, replaySessionNum: -1 }, 'replay', 'replay-playing'],
    ['replay mode despite missing fields', { simMode: 'replay' }, 'replay', 'replay-sim-mode'],
    ['mystery mode', { simMode: 'mystery', isReplayPlaying: false, replaySessionNum: -1, replayFrameNum: 100, replayFrameNumEnd: 0, sessionTime: 100, replaySessionTime: 100 }, 'unknown', 'invalid-metadata'],
    ['fractional session', { simMode: 'full', isReplayPlaying: false, replaySessionNum: 0.5, replayFrameNum: 100, replayFrameNumEnd: 0, sessionTime: 100, replaySessionTime: 100 }, 'unknown', 'invalid-metadata'],
    ['partial live tuple', { simMode: 'full', isReplayPlaying: false, replaySessionNum: -1 }, 'unknown', 'missing-metadata']
  ] as const)('classifies %s safely', (_name, inputs, state, reason) => {
    expect(resolveReplayContext(inputs)).toMatchObject({ state, reason })
  })

  it('fails closed initially and carries replay only through unknown samples in the same context', () => {
    const tracker = new ReplayContextTracker()
    const identity = { sessionIdentity: 'session-a', connectionEpoch: 1 }
    const initial = tracker.update({}, identity)
    const playing = tracker.update({ simMode: 'full', isReplayPlaying: true, replaySessionNum: 1 }, identity)
    const unknown = tracker.update({ simMode: 'mystery' }, identity)
    const switched = tracker.update({ simMode: 'full', isReplayPlaying: false, replaySessionNum: 2, replayFrameNum: 100, replayFrameNumEnd: 0, sessionTime: 100, replaySessionTime: 100 }, identity)

    expect(initial).toMatchObject({ state: 'unknown', active: false, revision: 0 })
    expect(playing).toMatchObject({ state: 'replay', active: true, revision: 1 })
    expect(unknown).toMatchObject({ state: 'unknown', active: true, revision: 2 })
    expect(switched).toMatchObject({ state: 'unknown', active: false, revision: 3 })
  })

  it.each([
    ['session identity', { simMode: 'mystery' }, { sessionIdentity: 'session-b', connectionEpoch: 1 }],
    ['connection epoch', { simMode: 'mystery' }, { sessionIdentity: 'session-a', connectionEpoch: 2 }]
  ] as const)('clears a replay latch before an unknown sample on %s change', (_name, sample, nextIdentity) => {
    const tracker = new ReplayContextTracker()
    tracker.update({ simMode: 'full', isReplayPlaying: true, replaySessionNum: 1 }, { sessionIdentity: 'session-a', connectionEpoch: 1 })
    expect(tracker.update(sample, nextIdentity)).toMatchObject({ state: 'unknown', active: false, revision: 1 })
  })

  it('maps the real live edge with a stable provider session identity', () => {
    const snap = pollWith(liveValues, liveInfo)
    expect(snap?.replayContext).toMatchObject({
      state: 'live',
      active: false,
      revision: 0,
      reason: 'confirmed-live',
      sessionIdentity: '10:20:44:2',
      inputs: { simMode: 'full', replayFrameNumEnd: 0 }
    })
  })

  it('canonicalizes provider session identity when metadata segments are missing', () => {
    const snap = pollWith(liveValues, { WeekendInfo: { SimMode: 'full', SessionID: 10 } })
    expect(snap?.replayContext?.sessionIdentity).toBe('10:44:2')
  })

  it('auto-mode reconnect never reuses a pre-disconnect snapshot when the first read is empty', () => {
    let connected = true
    const replayValues = { ...liveValues, IsReplayPlaying: true, ReplaySessionNum: 2 }
    let readResult: StubReadResult | null = { values: replayValues, sessionInfo: liveInfo, sessionInfoYaml: '' }
    const provider = new IRacingProvider()
    ;(provider as unknown as { mmf: unknown }).mmf = {
      start() {},
      stop() {},
      isOpen: () => true,
      isConnected: () => connected,
      read: () => readResult
    }
    provider.start()
    const first = provider.poll()
    connected = false
    expect(provider.isConnected()).toBe(false)
    connected = true
    expect(provider.isConnected()).toBe(true)
    readResult = null
    expect(provider.poll()).toBeNull()
    readResult = { values: { Speed: 50, RPM: 7000, Gear: 3 }, sessionInfo: liveInfo, sessionInfoYaml: '' }
    const reconnected = provider.poll()

    expect(first?.replayContext).toMatchObject({ state: 'replay', active: true, revision: 0 })
    expect(reconnected).not.toBe(first)
    expect(reconnected?.replayContext).toMatchObject({ state: 'unknown', active: false, revision: 2 })
    expect(reconnected?.replayContext?.connectionEpoch).toBe((first?.replayContext?.connectionEpoch ?? 0) + 2)
  })
})

// ─── Full-field array consumption (irsdkLogAllCars) ──────────────────────────────
describe('iRacing full-field array consumption', () => {
  it('builds an entry for EVERY car in the field (no hardcoded cap) and finds relatives at the array extremes', () => {
    const N = 30
    const driversRaw = Array.from({ length: N }, (_, i) => ({
      CarIdx: i, UserName: `Driver ${i}`, CarNumber: String(i), CarClassID: 1
    }))
    const sessionInfo = { DriverInfo: { DriverCarIdx: 15, Drivers: driversRaw } }

    // CarIdxEstTime drives the per-car gap. Player (idx 15) = 50. Most cars are ±10s away;
    // the NEAREST ahead is placed at the LAST index (29) and the nearest behind at index 0,
    // so a capped/subset reader (e.g. only the cars near the player's index) would miss them.
    const est: number[] = Array.from({ length: N }, (_, i) => (i % 2 === 0 ? 60 : 40))
    est[15] = 50
    est[29] = 50.5 // nearest ahead  (+0.5s)
    est[0] = 49.5  // nearest behind (-0.5s)

    const values = {
      PlayerCarIdx: 15,
      CarIdxEstTime: est,
      CarIdxLap: new Array(N).fill(10),
      CarIdxLapDistPct: new Array(N).fill(0.5)
    }

    const statics = __iracingTelemetryTest.buildDriverStatic(sessionInfo)
    const parsed = __iracingTelemetryTest.parseDrivers(sessionInfo, values, statics)
    expect(parsed).toHaveLength(N) // full field, not a capped subset

    const rel = __iracingTelemetryTest.relatives(parsed)
    expect(rel?.ahead?.carIdx).toBe(29)
    expect(rel?.behind?.carIdx).toBe(0)
  })
})

describe('iRacing SessionFlags → flags (yellow-waving + green-held detection)', () => {
  const f = __iracingTelemetryTest.flags

  it('detects a LOCAL waved yellow (irsdk_yellowWaving 0x0100) as yellow', () => {
    const out = f(0x0100)
    expect(out.yellow).toBe(true)
    expect(out.green).toBe(false)
    expect(out.blue).toBe(false)
  })

  it('still detects the static yellow + full-course caution bits', () => {
    expect(f(0x0008).yellow).toBe(true) // static yellow
    expect(f(0x4000).yellow).toBe(true) // caution
    expect(f(0x8000).yellow).toBe(true) // cautionWaving
  })

  it('detects a HELD green at restart (irsdk_greenHeld 0x0400) as green', () => {
    const out = f(0x0400)
    expect(out.green).toBe(true)
    expect(out.yellow).toBe(false)
  })

  it('leaves BLUE untouched — 0x20 is blue only, not yellow/green', () => {
    const out = f(0x0020)
    expect(out.blue).toBe(true)
    expect(out.yellow).toBe(false)
    expect(out.green).toBe(false)
  })

  it('standing-start green (0x04) is green, not yellow', () => {
    const out = f(0x0004)
    expect(out.green).toBe(true)
    expect(out.yellow).toBe(false)
  })

  it('combined local-yellow + blue resolves both bits independently', () => {
    const out = f(0x0100 | 0x0020)
    expect(out.yellow).toBe(true)
    expect(out.blue).toBe(true)
  })
})

// ─── Player car identity (carName / carPath) — the soundshift carKey:"unknown" P1 ──
describe('iRacing player car identity (carName / carPath from the player driver row)', () => {
  const carName = __iracingTelemetryTest.playerCarName
  const carPath = __iracingTelemetryTest.playerCarPath

  it('populates carName from the player row fallback chain when root DriverCar* are empty', () => {
    const sessionInfo = {
      DriverInfo: {
        DriverCarIdx: 1,
        DriverCarScreenName: '',
        DriverCarName: '',
        Drivers: [
          { CarIdx: 0, CarScreenName: 'Other Car', CarPath: 'othercar' },
          { CarIdx: 1, CarScreenName: 'Global Mazda MX-5 Cup', CarScreenNameShort: 'MX-5', CarName: 'mx5 2016', CarPath: 'mx5 mx52016' }
        ]
      }
    }
    expect(carName(sessionInfo)).toBe('Global Mazda MX-5 Cup')
    expect(carPath(sessionInfo)).toBe('mx5 mx52016')
  })

  it('walks the chain CarScreenName → CarScreenNameShort → CarName → CarPath', () => {
    const row = (extra: Record<string, unknown>) => ({
      DriverInfo: { DriverCarIdx: 1, Drivers: [{ CarIdx: 1, ...extra }] }
    })
    expect(carName(row({ CarScreenNameShort: 'MX-5', CarName: 'mx5', CarPath: 'mx5 mx52016' }))).toBe('MX-5')
    expect(carName(row({ CarName: 'mx5', CarPath: 'mx5 mx52016' }))).toBe('mx5')
    expect(carName(row({ CarPath: 'mx5 mx52016' }))).toBe('mx5 mx52016')
  })

  it('falls back to the root DriverCarScreenName/DriverCarName when the player row has no names', () => {
    const screen = {
      DriverInfo: { DriverCarIdx: 1, DriverCarScreenName: 'Root Screen Name', Drivers: [{ CarIdx: 1 }] }
    }
    expect(carName(screen)).toBe('Root Screen Name')
    const name = {
      DriverInfo: { DriverCarIdx: 1, DriverCarName: 'Root Car Name', Drivers: [{ CarIdx: 1 }] }
    }
    expect(carName(name)).toBe('Root Car Name')
  })

  it('returns undefined (no crash) for a missing/empty session — soundshift keys to a safe sentinel', () => {
    expect(carName(undefined)).toBeUndefined()
    expect(carPath(undefined)).toBeUndefined()
    expect(carName({ DriverInfo: {} })).toBeUndefined()
    expect(carPath({ DriverInfo: { DriverCarIdx: 1, Drivers: [] } })).toBeUndefined()
  })

  it('threads carName + carPath into the snapshot via poll()', () => {
    const sessionInfo = {
      DriverInfo: {
        DriverCarIdx: 0,
        Drivers: [{ CarIdx: 0, CarScreenName: 'Mazda MX-5 Cup', CarPath: 'mx5 mx52016' }]
      }
    }
    const snap = pollWith({ Speed: 40, RPM: 6000, Gear: 3 }, sessionInfo)
    expect(snap?.carName).toBe('Mazda MX-5 Cup')
    expect(snap?.carPath).toBe('mx5 mx52016')
  })
})
