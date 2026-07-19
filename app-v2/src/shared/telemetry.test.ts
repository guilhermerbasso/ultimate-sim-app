import { describe, expect, it } from 'vitest'
import {
  formatTimeOfDay,
  trackSurfaceMaterialLabel,
  engineWarningsFromBitfield,
  ENGINE_WARNING_BITS,
  sessionStateLabel,
  paceModeLabel,
  paceFlagsList,
  carLeftRightCountFromEnum,
  deriveTcActive,
  tcOptionsForSensitivity,
  isTcSensitivity,
  TC_SENSITIVITIES,
  TcLatch,
  tcLatchTimingsForSensitivity,
  TC_ACTIVE_DERIVED,
  fuelLapsRemainingOf,
  fuelPerLapLitersOf
} from './telemetry'
import type { TelemetrySnapshot } from './telemetry'
import {
  createRgbMatrixStatusLed,
  defaultMatrixLayout,
  renderMatrixFrame,
  type RgbMatrixProfile
} from './rgb-matrix'

describe('fuel unit helpers', () => {
  it('uses explicit litre telemetry and rejects the old iRacing kg alias', () => {
    const explicit = {
      sim: 'iracing',
      fuelLiters: 9,
      fuelPerLapLiters: 2
    } as TelemetrySnapshot
    expect(fuelPerLapLitersOf(explicit)).toBe(2)
    expect(fuelLapsRemainingOf(explicit)).toBe(4.5)

    const massAlias = {
      sim: 'iracing',
      fuelLiters: 9,
      fuelPerLap: 1.5,
      fuelPerLapKg: 1.5
    } as TelemetrySnapshot
    expect(fuelPerLapLitersOf(massAlias)).toBeUndefined()
    expect(fuelLapsRemainingOf(massAlias)).toBeUndefined()
  })

  it('keeps missing and invalid inputs unknown', () => {
    expect(fuelLapsRemainingOf({ sim: 'iracing' } as TelemetrySnapshot)).toBeUndefined()
    expect(fuelLapsRemainingOf({
      sim: 'iracing',
      fuelLapsRemaining: Number.NaN
    } as TelemetrySnapshot)).toBeUndefined()
    expect(fuelLapsRemainingOf({
      sim: 'iracing',
      fuelLiters: 4,
      fuelPerLapLiters: 0
    } as TelemetrySnapshot)).toBeUndefined()
  })
})

describe('trackSurfaceMaterialLabel (irsdk_TrkSurf enum)', () => {
  it('collapses each numbered material family to a single readable label', () => {
    // asphalt_1..4 = 1..4, concrete_1..2 = 5..6, racing_dirt = 7..8, paint = 9..10,
    // rumble_1..4 = 11..14 (kerb), grass_1..4 = 15..18, dirt_1..4 = 19..22, sand = 23,
    // gravel_1..2 = 24..25, grasscrete = 26, astroturf = 27.
    expect(trackSurfaceMaterialLabel(1)).toBe('asphalt')
    expect(trackSurfaceMaterialLabel(4)).toBe('asphalt')
    expect(trackSurfaceMaterialLabel(5)).toBe('concrete')
    expect(trackSurfaceMaterialLabel(6)).toBe('concrete')
    expect(trackSurfaceMaterialLabel(7)).toBe('racing dirt')
    expect(trackSurfaceMaterialLabel(9)).toBe('paint')
    expect(trackSurfaceMaterialLabel(11)).toBe('kerb')
    expect(trackSurfaceMaterialLabel(14)).toBe('kerb')
    expect(trackSurfaceMaterialLabel(15)).toBe('grass')
    expect(trackSurfaceMaterialLabel(18)).toBe('grass')
    expect(trackSurfaceMaterialLabel(20)).toBe('dirt')
    expect(trackSurfaceMaterialLabel(23)).toBe('sand')
    expect(trackSurfaceMaterialLabel(24)).toBe('gravel')
    expect(trackSurfaceMaterialLabel(26)).toBe('grasscrete')
    expect(trackSurfaceMaterialLabel(27)).toBe('astroturf')
  })

  it('returns undefined for not-in-world (-1), undefined (0) and non-finite/absent input', () => {
    expect(trackSurfaceMaterialLabel(-1)).toBeUndefined()
    expect(trackSurfaceMaterialLabel(0)).toBeUndefined()
    expect(trackSurfaceMaterialLabel(99)).toBeUndefined()
    expect(trackSurfaceMaterialLabel(undefined)).toBeUndefined()
    expect(trackSurfaceMaterialLabel(Number.NaN)).toBeUndefined()
  })

  it('truncates fractional enum values before mapping', () => {
    expect(trackSurfaceMaterialLabel(12.9)).toBe('kerb')
  })
})

describe('formatTimeOfDay (SessionTimeOfDay seconds → HH:MM)', () => {
  it('formats seconds-since-midnight as a zero-padded 24h clock', () => {
    expect(formatTimeOfDay(0)).toBe('00:00')
    expect(formatTimeOfDay(3661)).toBe('01:01') // 1h 1m 1s
    expect(formatTimeOfDay(50_400)).toBe('14:00') // 14:00
    expect(formatTimeOfDay(86_399)).toBe('23:59')
  })

  it('wraps values outside a single day into [00:00, 24:00)', () => {
    expect(formatTimeOfDay(86_400)).toBe('00:00') // exactly one day → midnight
    expect(formatTimeOfDay(90_000)).toBe('01:00') // 25h → 01:00
    expect(formatTimeOfDay(-3600)).toBe('23:00') // negative wraps backwards
  })

  it('returns undefined for missing/non-finite input', () => {
    expect(formatTimeOfDay(undefined)).toBeUndefined()
    expect(formatTimeOfDay(null)).toBeUndefined()
    expect(formatTimeOfDay(Number.NaN)).toBeUndefined()
  })
})

// ─── EngineWarnings bitfield (irsdk_EngineWarnings) ─────────────────────────
describe('engineWarningsFromBitfield (irsdk_EngineWarnings)', () => {
  it('decodes EVERY bit independently from its mask', () => {
    const cases: Array<[keyof typeof ENGINE_WARNING_BITS, number]> = [
      ['waterTemp', 0x0001],
      ['fuelPressure', 0x0002],
      ['oilPressure', 0x0004],
      ['stalled', 0x0008],
      ['pitLimiter', 0x0010],
      ['revLimiter', 0x0020],
      ['oilTemp', 0x0040],
      ['mandRepair', 0x0080],
      ['optRepair', 0x0100]
    ]
    for (const [name, mask] of cases) {
      expect(ENGINE_WARNING_BITS[name]).toBe(mask)
      const decoded = engineWarningsFromBitfield(mask)!
      // Only the matching lamp is on; all others are off.
      expect(decoded[name]).toBe(true)
      const others = Object.keys(decoded).filter((k) => k !== name) as Array<keyof typeof decoded>
      for (const other of others) expect(decoded[other]).toBe(false)
    }
  })

  it('decodes combined bits (waterTemp + oilPressure + revLimiter) together', () => {
    const decoded = engineWarningsFromBitfield(0x0001 | 0x0004 | 0x0020)!
    expect(decoded.waterTemp).toBe(true)
    expect(decoded.oilPressure).toBe(true)
    expect(decoded.revLimiter).toBe(true)
    expect(decoded.fuelPressure).toBe(false)
    expect(decoded.mandRepair).toBe(false)
  })

  it('a present value of 0 decodes to an all-false object (no warnings)', () => {
    const decoded = engineWarningsFromBitfield(0)!
    expect(Object.values(decoded).every((v) => v === false)).toBe(true)
  })

  it('returns undefined for missing/non-finite input (consumers render —)', () => {
    expect(engineWarningsFromBitfield(undefined)).toBeUndefined()
    expect(engineWarningsFromBitfield(null)).toBeUndefined()
    expect(engineWarningsFromBitfield(Number.NaN)).toBeUndefined()
  })
})

// ─── SessionState mapping (irsdk_SessionState) ──────────────────────────────
describe('sessionStateLabel (irsdk_SessionState)', () => {
  it('maps each enum int to its label', () => {
    expect(sessionStateLabel(0)).toBe('invalid')
    expect(sessionStateLabel(1)).toBe('getInCar')
    expect(sessionStateLabel(2)).toBe('warmup')
    expect(sessionStateLabel(3)).toBe('paradeLaps')
    expect(sessionStateLabel(4)).toBe('racing')
    expect(sessionStateLabel(5)).toBe('checkered')
    expect(sessionStateLabel(6)).toBe('coolDown')
  })

  it('returns undefined for out-of-range / missing / non-finite input', () => {
    expect(sessionStateLabel(7)).toBeUndefined()
    expect(sessionStateLabel(-1)).toBeUndefined()
    expect(sessionStateLabel(undefined)).toBeUndefined()
    expect(sessionStateLabel(Number.NaN)).toBeUndefined()
  })
})

// ─── PaceMode / PaceFlags (irsdk_PaceMode / irsdk_PaceFlags) ─────────────────
describe('paceModeLabel + paceFlagsList', () => {
  it('maps each PaceMode enum int to its label', () => {
    expect(paceModeLabel(0)).toBe('singleFileStart')
    expect(paceModeLabel(1)).toBe('doubleFileStart')
    expect(paceModeLabel(2)).toBe('singleFileRestart')
    expect(paceModeLabel(3)).toBe('doubleFileRestart')
    expect(paceModeLabel(4)).toBe('notPacing')
    expect(paceModeLabel(5)).toBeUndefined()
    expect(paceModeLabel(undefined)).toBeUndefined()
  })

  it('decodes the PaceFlags bitfield into active flag names', () => {
    expect(paceFlagsList(0)).toEqual([])
    expect(paceFlagsList(0x0001)).toEqual(['endOfLine'])
    expect(paceFlagsList(0x0002)).toEqual(['freePass'])
    expect(paceFlagsList(0x0004)).toEqual(['wavedAround'])
    expect(paceFlagsList(0x0001 | 0x0004)).toEqual(['endOfLine', 'wavedAround'])
    expect(paceFlagsList(undefined)).toBeUndefined()
    expect(paceFlagsList(Number.NaN)).toBeUndefined()
  })
})

// ─── carLeftRightCount (irsdk_CarLeftRight count) ───────────────────────────
describe('carLeftRightCountFromEnum (irsdk_CarLeftRight)', () => {
  it('reports 1 car for CarLeft/CarRight/CarLeftRight (2/3/4)', () => {
    expect(carLeftRightCountFromEnum(2)).toBe(1)
    expect(carLeftRightCountFromEnum(3)).toBe(1)
    expect(carLeftRightCountFromEnum(4)).toBe(1)
  })

  it('reports 2 cars for LR2CarsLeft/LR2CarsRight (5/6)', () => {
    expect(carLeftRightCountFromEnum(5)).toBe(2)
    expect(carLeftRightCountFromEnum(6)).toBe(2)
  })

  it('returns undefined when no car is alongside (Off=0, Clear=1) or input is invalid', () => {
    expect(carLeftRightCountFromEnum(0)).toBeUndefined()
    expect(carLeftRightCountFromEnum(1)).toBeUndefined()
    expect(carLeftRightCountFromEnum(99)).toBeUndefined()
    expect(carLeftRightCountFromEnum(undefined)).toBeUndefined()
    expect(carLeftRightCountFromEnum(Number.NaN)).toBeUndefined()
  })
})

// ─── deriveTcActive (pure, DERIVED-ON by default per product decision) ──────
// Conservative semantics: TC-active fires ONLY when the driver is HARD on throttle yet the
// car is DECELERATING (longG clearly NEGATIVE) — genuine traction loss. Normal grippy
// acceleration keeps longG ≥ ~0, so it never lights ("qualquer acelerada" is gone).
describe('deriveTcActive (pure TC-active derivation)', () => {
  const base: Pick<TelemetrySnapshot, 'throttle' | 'tcEnabled' | 'longAccelG' | 'speedKmh' | 'brake'> = {
    throttle: 0.9,
    tcEnabled: true,
    longAccelG: -0.3,
    speedKmh: 70,
    brake: 0
  }

  it('is wired ON by default — the live-derivation gate is true (product decision)', () => {
    expect(TC_ACTIVE_DERIVED).toBe(true)
  })

  it('returns true only when DECELERATING under heavy throttle (longG clearly negative)', () => {
    expect(deriveTcActive({ ...base, throttle: 0.9, speedKmh: 70, longAccelG: -0.3 })).toBe(true)
    expect(deriveTcActive({ ...base, throttle: 0.95, speedKmh: 60, longAccelG: -0.5 })).toBe(true)
  })

  it('returns false at longG ~0 — the old cry-wolf case (normal accel, gearshift, steady throttle)', () => {
    // The whole bug: longG ≈ 0 happens constantly on normal acceleration. With the negative
    // medium default (-0.10), a flat/near-zero longG no longer lights the indicator.
    expect(deriveTcActive({ ...base, throttle: 0.9, speedKmh: 70, longAccelG: 0.0 })).toBe(false)
    expect(deriveTcActive({ ...base, throttle: 0.9, speedKmh: 70, longAccelG: -0.05 })).toBe(false)
  })

  it('returns false on a clean low-gear rev-out near the limiter WITH grip (no cry-wolf)', () => {
    expect(deriveTcActive({ ...base, throttle: 0.9, speedKmh: 60, longAccelG: 0.6 })).toBe(false)
  })

  it('returns false when the car is hooked up and gripping (strong forward G)', () => {
    expect(deriveTcActive({ ...base, throttle: 0.9, speedKmh: 70, longAccelG: 0.8 })).toBe(false)
  })

  it('returns false at part throttle (not hard on power) even while decelerating', () => {
    expect(deriveTcActive({ ...base, throttle: 0.5, speedKmh: 90, longAccelG: -0.3 })).toBe(false)
  })

  it('returns false when cruising flat-out (above the slip-regime speed) or coasting', () => {
    expect(deriveTcActive({ ...base, throttle: 0.9, speedKmh: 280, longAccelG: -0.3 })).toBe(false)
    expect(deriveTcActive({ ...base, throttle: 0.1 })).toBe(false)
  })

  it('returns false when TC is disabled, below min speed, or trail-braking', () => {
    expect(deriveTcActive({ ...base, tcEnabled: false })).toBe(false)
    expect(deriveTcActive({ ...base, speedKmh: 1 })).toBe(false)
    expect(deriveTcActive({ ...base, brake: 0.5 })).toBe(false)
  })

  it('honours custom thresholds and tolerates non-finite inputs (never NaN)', () => {
    expect(
      deriveTcActive({ ...base, throttle: 0.55, longAccelG: -0.3 }, { throttleThreshold: 0.5 })
    ).toBe(true)
    expect(
      deriveTcActive({ throttle: Number.NaN, tcEnabled: true, longAccelG: Number.NaN, speedKmh: Number.NaN, brake: Number.NaN })
    ).toBe(false)
    expect(deriveTcActive(null)).toBe(false)
    expect(deriveTcActive(undefined)).toBe(false)
  })
})

// ─── tcOptionsForSensitivity (level → thresholds mapping) ────────────────────
describe('tcOptionsForSensitivity (TC sensitivity level → thresholds)', () => {
  const base: Pick<TelemetrySnapshot, 'throttle' | 'tcEnabled' | 'longAccelG' | 'speedKmh' | 'brake'> = {
    throttle: 1,
    tcEnabled: true,
    longAccelG: 0,
    speedKmh: 70,
    brake: 0
  }
  // Helper: derive at a given level, treating 'off' (null options) as "never true".
  const at = (
    level: Parameters<typeof tcOptionsForSensitivity>[0],
    snap: Partial<typeof base>
  ): boolean => {
    const opts = tcOptionsForSensitivity(level)
    return opts ? deriveTcActive({ ...base, ...snap }, opts) : false
  }

  it('exposes the four levels and a working type guard', () => {
    expect(TC_SENSITIVITIES).toEqual(['off', 'low', 'medium', 'high'])
    expect(isTcSensitivity('medium')).toBe(true)
    expect(isTcSensitivity('bogus')).toBe(false)
    expect(isTcSensitivity(undefined)).toBe(false)
  })

  it('off disables the derivation entirely (null options ⇒ never true)', () => {
    expect(tcOptionsForSensitivity('off')).toBeNull()
    // Even a textbook traction-loss snapshot stays false when off.
    expect(at('off', { throttle: 1, longAccelG: -0.5 })).toBe(false)
  })

  it('low (Baixa) fires only on strong wheelspin — longG ≤ -0.25 AND throttle ≥ 0.90', () => {
    expect(at('low', { throttle: 0.95, longAccelG: -0.3 })).toBe(true) // past both boundaries
    expect(at('low', { throttle: 0.95, longAccelG: -0.2 })).toBe(false) // longG not negative enough
    expect(at('low', { throttle: 0.85, longAccelG: -0.3 })).toBe(false) // throttle below 0.90
    expect(at('low', { throttle: 0.95, longAccelG: -0.25 })).toBe(true) // exactly on the longG boundary
  })

  it('medium (Average) fires at longG ? -0.10 AND throttle ? 0.85', () => {
    expect(at('medium', { throttle: 0.9, longAccelG: -0.2 })).toBe(true)
    expect(at('medium', { throttle: 0.9, longAccelG: -0.1 })).toBe(true) // on the boundary
    expect(at('medium', { throttle: 0.9, longAccelG: -0.05 })).toBe(false) // not negative enough
    expect(at('medium', { throttle: 0.8, longAccelG: -0.2 })).toBe(false) // throttle below 0.85
  })

  it('high (Alta) is the most sensitive — longG ≤ 0.0 AND throttle ≥ 0.75', () => {
    expect(at('high', { throttle: 0.8, longAccelG: 0.0 })).toBe(true) // longG at zero is enough
    expect(at('high', { throttle: 0.8, longAccelG: -0.05 })).toBe(true)
    expect(at('high', { throttle: 0.8, longAccelG: 0.05 })).toBe(false) // any positive accel → false
    expect(at('high', { throttle: 0.7, longAccelG: -0.2 })).toBe(false) // throttle below 0.75
  })

  it('a normal grippy acceleration (longG strongly positive) is false at ALL levels', () => {
    const grippy = { throttle: 1, longAccelG: 0.6 }
    expect(at('off', grippy)).toBe(false)
    expect(at('low', grippy)).toBe(false)
    expect(at('medium', grippy)).toBe(false)
    expect(at('high', grippy)).toBe(false)
  })

  it('a clear deceleration-under-throttle is true at the appropriate levels', () => {
    // Mild deceleration under throttle (-0.15 G): caught by medium & high, not low.
    const mild = { throttle: 0.95, longAccelG: -0.15 }
    expect(at('off', mild)).toBe(false)
    expect(at('low', mild)).toBe(false)
    expect(at('medium', mild)).toBe(true)
    expect(at('high', mild)).toBe(true)
    // Strong deceleration under throttle (-0.4 G): caught by every active level.
    const strong = { throttle: 0.95, longAccelG: -0.4 }
    expect(at('low', strong)).toBe(true)
    expect(at('medium', strong)).toBe(true)
    expect(at('high', strong)).toBe(true)
  })
})

// ─── TcLatch (stateful debounce / hysteresis) ───────────────────────────────
describe('TcLatch (TC-active debounce / hysteresis)', () => {
  it('a single-frame spike below the min-on window stays false (no chatter)', () => {
    const latch = new TcLatch({ minOnMs: 150, releaseMs: 200 })
    expect(latch.update(true, 1000)).toBe(false) // first true frame — candidate starts
    expect(latch.update(false, 1040)).toBe(false) // dropped well before 150 ms → never latched
    expect(latch.value).toBe(false)
  })

  it('latches true only after the raw condition holds for >= minOnMs', () => {
    const latch = new TcLatch({ minOnMs: 150, releaseMs: 200 })
    expect(latch.update(true, 1000)).toBe(false) // t0 — candidate
    expect(latch.update(true, 1100)).toBe(false) // +100 ms — still below window
    expect(latch.update(true, 1149)).toBe(false) // +149 ms — just short
    expect(latch.update(true, 1150)).toBe(true) // +150 ms — latches
  })

  it('a brief drop within the release window keeps it latched (min-on), then releases', () => {
    const latch = new TcLatch({ minOnMs: 150, releaseMs: 200 })
    latch.update(true, 1000)
    expect(latch.update(true, 1150)).toBe(true) // latched
    expect(latch.update(false, 1200)).toBe(true) // brief drop — clear timer starts, still on
    expect(latch.update(true, 1260)).toBe(true) // raw back within window — stays on, timer reset
    expect(latch.update(false, 1300)).toBe(true) // drops again — new clear timer
    expect(latch.update(false, 1499)).toBe(true) // +199 ms since drop — just short of release
    expect(latch.update(false, 1500)).toBe(false) // +200 ms — releases
  })

  it('re-arms after release and respects a fresh hold window', () => {
    const latch = new TcLatch({ minOnMs: 150, releaseMs: 200 })
    latch.update(true, 0)
    expect(latch.update(true, 150)).toBe(true) // latched
    expect(latch.update(false, 350)).toBe(true) // drop starts the release timer — still on
    expect(latch.update(false, 550)).toBe(false) // +200 ms off → released
    expect(latch.update(true, 560)).toBe(false) // new candidate — must hold again
    expect(latch.update(true, 710)).toBe(true) // held 150 ms → latches again
  })

  it('reset() and non-finite timestamps are safe (never spuriously latch)', () => {
    const latch = new TcLatch({ minOnMs: 150, releaseMs: 200 })
    latch.update(true, 0)
    latch.update(true, 150)
    expect(latch.value).toBe(true)
    latch.reset()
    expect(latch.value).toBe(false)
    // Non-finite clock is treated as "no time elapsed" → can't cross the window.
    expect(latch.update(true, Number.NaN)).toBe(false)
    expect(latch.update(true, Number.NaN)).toBe(false)
  })

  it('maps sensitivity to hold windows: lower = longer hold, higher = shorter', () => {
    expect(tcLatchTimingsForSensitivity('low')).toEqual({ minOnMs: 250, releaseMs: 300 })
    expect(tcLatchTimingsForSensitivity('medium')).toEqual({ minOnMs: 150, releaseMs: 200 })
    expect(tcLatchTimingsForSensitivity('high')).toEqual({ minOnMs: 100, releaseMs: 150 })
    // 'off' is never used live (derivation disabled) but returns a sane window.
    expect(tcLatchTimingsForSensitivity('off')).toEqual({ minOnMs: 150, releaseMs: 200 })
  })
})

// ─── ABS status LED (B1: decode is the only break; pipeline is sound) ────────
// Read-only: drives statusLedActive('absActive') through the PUBLIC renderMatrixFrame
// API. Proves a snapshot with absActive:true lights the ABS status LED.
describe('ABS status LED lights from absActive (rgb-matrix pipeline)', () => {
  function absProfile(): RgbMatrixProfile {
    return { version: 1, layout: defaultMatrixLayout(), effects: [createRgbMatrixStatusLed('absActive')] }
  }
  function snapshot(partial: Partial<TelemetrySnapshot>): TelemetrySnapshot {
    return {
      sim: 'mock', connected: true, timestamp: 0,
      speedKmh: 0, rpm: 0, gear: 0, maxRpm: 8000, throttle: 0, brake: 0, clutch: 0,
      ...partial
    } as TelemetrySnapshot
  }
  const litCells = (frame: ReturnType<typeof renderMatrixFrame>) =>
    frame.flat().filter((c) => c.r + c.g + c.b > 0).length

  it('lights the ABS LED when absActive is true', () => {
    const frame = renderMatrixFrame(absProfile(), snapshot({ absActive: true }), 0)
    expect(litCells(frame)).toBeGreaterThan(0)
  })

  it('keeps the ABS LED dark when absActive is false/undefined or disconnected', () => {
    expect(litCells(renderMatrixFrame(absProfile(), snapshot({ absActive: false }), 0))).toBe(0)
    expect(litCells(renderMatrixFrame(absProfile(), snapshot({ absActive: undefined }), 0))).toBe(0)
    expect(litCells(renderMatrixFrame(absProfile(), snapshot({ absActive: true, connected: false }), 0))).toBe(0)
  })
})
