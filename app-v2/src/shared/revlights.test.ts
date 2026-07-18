import { describe, expect, it } from 'vitest'
import type { Flags, TelemetrySnapshot } from './telemetry'
import {
  DEFAULT_REVLIGHTS_CONFIG,
  FALLBACK_SHIFT_BAND_END_FRAC,
  FALLBACK_SHIFT_BAND_START_FRAC,
  computeRevlights,
  redlineBandPct,
  resolveShiftNow
} from './revlights'
import type { RevlightsConfig } from './revlights'

function snap(partial: Partial<TelemetrySnapshot>): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 0,
    speedKmh: 0,
    rpm: 0,
    gear: 0,
    throttle: 0,
    brake: 0,
    clutch: 0,
    ...partial
  }
}

function flags(partial: Partial<Flags>): Flags {
  return {
    green: false,
    yellow: false,
    blue: false,
    white: false,
    checkered: false,
    red: false,
    black: false,
    meatball: false,
    repair: false,
    disqualify: false,
    greenWhiteCheckered: false,
    ...partial
  }
}

// 16-LED strip so segment levels are easy to read; band drives the fill.
const config: RevlightsConfig = {
  ...DEFAULT_REVLIGHTS_CONFIG,
  ledCount: 16,
  startRpmPct: 0.5,
  shiftRpmPct: 0.95,
  shiftBlink: true,
  useShiftIndicatorPct: true
}

describe('redlineBandPct (redline-relative fallback band)', () => {
  it('stays DARK below the band start and never fills proportionally to maxRpm', () => {
    // 3000/8000 = 0.375 proportional (the bug). Band start is 92% of redline.
    expect(redlineBandPct(3000, 8000)).toBe(0)
    expect(redlineBandPct(8000 * FALLBACK_SHIFT_BAND_START_FRAC, 8000)).toBe(0)
  })

  it('maps the top slice of the rev range to 0..1', () => {
    const start = 8000 * FALLBACK_SHIFT_BAND_START_FRAC // 7360
    const end = 8000 * FALLBACK_SHIFT_BAND_END_FRAC // 7920
    expect(redlineBandPct((start + end) / 2, 8000)).toBeCloseTo(0.5, 5)
    expect(redlineBandPct(end, 8000)).toBe(1)
    expect(redlineBandPct(8000, 8000)).toBe(1) // clamps above the band end
  })

  it('guards bad inputs', () => {
    expect(redlineBandPct(5000, 0)).toBe(0)
    expect(redlineBandPct(Number.NaN, 8000)).toBe(0)
  })
})

describe('computeRevlights drives LEDs from the shift-light band, never rpm/maxRpm', () => {
  it('returns no LEDs when disconnected', () => {
    expect(computeRevlights(snap({ connected: false, rpm: 9000, maxRpm: 8000 }), config)).toMatchObject({ level: 0, shiftActive: false })
  })

  it('keeps the strip DARK when the band is 0 even though rpm/maxRpm is high', () => {
    // rpm/maxRpm = 0.75 (old bug would light ~8 LEDs); band says we're below the
    // first shift light, so nothing should light.
    const result = computeRevlights(snap({ rpm: 6000, maxRpm: 8000, shiftIndicatorPct: 0 }), config)
    expect(result.level).toBe(0)
    expect(result.shiftActive).toBe(false)
  })

  it('scales LED level with the band fill', () => {
    expect(computeRevlights(snap({ rpm: 7000, maxRpm: 8000, shiftIndicatorPct: 0.5 }), config).level).toBe(1)
    expect(computeRevlights(snap({ rpm: 8000, maxRpm: 8000, shiftIndicatorPct: 1 }), config)).toMatchObject({ level: 16, shiftActive: true })
  })

  it('blinks at/after the configured shift threshold (band-relative)', () => {
    expect(computeRevlights(snap({ shiftIndicatorPct: 0.94, maxRpm: 8000, rpm: 7000 }), config).shiftActive).toBe(false)
    expect(computeRevlights(snap({ shiftIndicatorPct: 0.95, maxRpm: 8000, rpm: 7800 }), config).shiftActive).toBe(true)
  })

  it('treats provider blink as authoritative and only falls back when it is absent', () => {
    expect(resolveShiftNow(false, true)).toBe(false)
    expect(resolveShiftNow(true, false)).toBe(true)
    expect(resolveShiftNow(undefined, true)).toBe(true)

    expect(computeRevlights(snap({
      shiftIndicatorPct: 0.999,
      revLights: { pct: 0.999, blink: false }
    }), config)).toMatchObject({ level: 16, shiftActive: false })

    expect(computeRevlights(snap({
      shiftIndicatorPct: 0.2,
      revLights: { pct: 0.2, blink: true }
    }), config)).toMatchObject({ level: 16, shiftActive: true })

    expect(computeRevlights(snap({
      shiftIndicatorPct: 0.95,
      revLights: { pct: 0.95 }
    }), config).shiftActive).toBe(true)
  })

  it('preserves race-flag detection independently of the shift-now source', () => {
    expect(computeRevlights(snap({
      shiftIndicatorPct: 0.999,
      revLights: { pct: 0.999, blink: false },
      flags: flags({ yellow: true })
    }), config)).toMatchObject({ shiftActive: false, flag: 'yellow' })

    expect(computeRevlights(snap({
      shiftIndicatorPct: 0.2,
      revLights: { pct: 0.2, blink: true },
      flags: flags({ blue: true })
    }), config)).toMatchObject({ shiftActive: true, flag: 'blue' })
  })

  it('falls back to revLights.pct (same band) when shiftIndicatorPct is absent', () => {
    const result = computeRevlights(snap({ rpm: 7000, maxRpm: 8000, revLights: { pct: 1 } }), config)
    expect(result).toMatchObject({ level: 16, shiftActive: true })
  })

  it('uses a redline-relative top slice (never proportional) when no band is provided', () => {
    // Idle/mid RPM with no sim band → dark, NOT proportional to maxRpm.
    expect(computeRevlights(snap({ rpm: 6000, maxRpm: 8000 }), config).level).toBe(0)
    // Near redline → fully lit via the redline fallback band.
    expect(computeRevlights(snap({ rpm: 7920, maxRpm: 8000 }), config).level).toBe(16)
  })

  it('does not reintroduce rpm/maxRpm when the user opts out of the sim indicator', () => {
    const optOut: RevlightsConfig = { ...config, useShiftIndicatorPct: false }
    // High rpm/maxRpm ratio but well below the redline band → stays dark.
    expect(computeRevlights(snap({ rpm: 6000, maxRpm: 8000, shiftIndicatorPct: 1, revLights: { pct: 1 } }), optOut).level).toBe(0)
    // Near redline → lit via redline fallback band.
    expect(computeRevlights(snap({ rpm: 7920, maxRpm: 8000 }), optOut).level).toBe(16)
  })
})
