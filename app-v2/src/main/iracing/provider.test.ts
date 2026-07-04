import { describe, expect, it, vi } from 'vitest'
import { __iracingTelemetryTest, IRacingProvider } from './provider'
import { logger } from '../modules/logger'

describe('iRacing telemetry provider parsing', () => {
  it('builds driver identity and fallback standings from SessionInfo YAML structures', () => {
    const sessionInfo = {
      DriverInfo: {
        DriverCarIdx: 1,
        Drivers: [
          { CarIdx: 0, UserName: 'Ahead Driver', CarNumber: '12', CarClassID: 7, CarClassShortName: 'GT3', CarClassColor: '49c5b1', IRating: 3200, LicString: 'A 4.99', UserID: 100 },
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
      CarIdxLapDistPct: [0.53, 0.5, 0.48],
      CarIdxF2Time: [100, 102, 104],
      CarIdxOnPitRoad: [false, false, true]
    }, statics)

    expect(drivers?.[0]).toMatchObject({ name: 'Ahead Driver', position: 1, classPosition: 1, gapToPlayerSec: 2, isPlayer: false })
    expect(drivers?.[1]).toMatchObject({ name: 'Player Driver', position: 2, classPosition: 2, gapToPlayerSec: 0, isPlayer: true })
    expect(drivers?.[2]).toMatchObject({ name: 'Behind Driver', position: 3, classPosition: 3, gapToPlayerSec: -2, inPits: true })
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
      LFwearM: 0.97
    })

    expect(tyres?.lf).toMatchObject({ tempC: 82, tempLeftC: 80, tempMiddleC: 82, tempRightC: 84, wearPct: 0.97 })
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
    // the pct≥0.97 shift-now triggers fire. Top-only clamp at a real per-car RPM.
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
