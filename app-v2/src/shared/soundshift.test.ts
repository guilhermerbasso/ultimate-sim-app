import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SOUNDSHIFT_CONFIG,
  carKeyOf,
  evaluateShift,
  hasUsableShiftRpm,
  resolveCarKey,
  resolveShiftTarget
} from './soundshift'
import type { SoundshiftConfig, SoundshiftSnapshotLike } from './soundshift'
import {
  effectiveLeadMs,
  isClearlyBelowThreshold,
  learnedUpshiftWrite,
  migrateLoadedSoundshift
} from '../main/modules/soundshift'

// The shipped default mode is now 'exact' (beep AT the iRacing shift point, no lead).
// shiftLight/rpm cases pin the mode here so they keep exercising those paths; the
// redlineOffset and exact suites pin/override as needed.
function config(partial: Partial<SoundshiftConfig> = {}): SoundshiftConfig {
  return { ...DEFAULT_SOUNDSHIFT_CONFIG, enabled: true, defaultMode: 'shiftLight', ...partial }
}

function snap(partial: Partial<SoundshiftSnapshotLike> = {}): SoundshiftSnapshotLike {
  return {
    carName: 'Test Car',
    rpm: 5000,
    gear: 3,
    throttle: 1,
    ...partial
  }
}

describe('evaluateShift - shiftLight mode with per-car shiftRpm', () => {
  it('beeps at/after the optimal upshift RPM (snap.shiftRpm)', () => {
    const cfg = config()
    const decision = evaluateShift(cfg, snap({ shiftRpm: 7000, rpm: 7000, shiftIndicatorPct: 0.4 }))
    expect(decision.shouldBeep).toBe(true)
    expect(decision.reason).toBe('shift-rpm-threshold')
  })

  it('beeps when rpm exceeds the optimal upshift RPM', () => {
    const decision = evaluateShift(config(), snap({ shiftRpm: 7000, rpm: 7200, shiftIndicatorPct: 0.5 }))
    expect(decision.shouldBeep).toBe(true)
    expect(decision.reason).toBe('shift-rpm-threshold')
  })

  it('does NOT beep before the optimal upshift RPM, even if shiftIndicatorPct >= threshold', () => {
    // shiftIndicatorPct (0.95) is past the old 0.9 threshold, but rpm is below shiftRpm.
    const decision = evaluateShift(config(), snap({ shiftRpm: 7000, rpm: 6800, shiftIndicatorPct: 0.95 }))
    expect(decision.shouldBeep).toBe(false)
    expect(decision.reason).toBe('below-shift-rpm-threshold')
  })

  it('ignores the rev-light fill % entirely when shiftRpm is present', () => {
    // Fill % is low but rpm reached the optimal shift point -> must beep.
    const decision = evaluateShift(config(), snap({ shiftRpm: 7000, rpm: 7050, shiftIndicatorPct: 0.1 }))
    expect(decision.shouldBeep).toBe(true)
    expect(decision.reason).toBe('shift-rpm-threshold')
  })
})

describe('evaluateShift - shiftLight mode fallback to shiftIndicatorPct', () => {
  it('falls back to shiftIndicatorPct >= threshold when shiftRpm is absent (beep)', () => {
    const decision = evaluateShift(config(), snap({ rpm: 6000, shiftIndicatorPct: 0.9 }))
    expect(decision.shouldBeep).toBe(true)
    expect(decision.reason).toBe('shift-light-threshold')
  })

  it('falls back to shiftIndicatorPct >= threshold when shiftRpm is absent (no beep)', () => {
    const decision = evaluateShift(config(), snap({ rpm: 6000, shiftIndicatorPct: 0.85 }))
    expect(decision.shouldBeep).toBe(false)
    expect(decision.reason).toBe('below-shift-light-threshold')
  })

  it('falls through to rpm/maxRpm logic when neither shiftRpm nor shiftIndicatorPct is present', () => {
    const decision = evaluateShift(config(), snap({ rpm: 9100, maxRpm: 10000, shiftIndicatorPct: undefined }))
    // threshold 0.9 * maxRpm 10000 = 9000; rpm 9100 >= 9000 -> beep via rpm path
    expect(decision.shouldBeep).toBe(true)
    expect(decision.reason).toBe('rpm-threshold')
  })
})

describe('evaluateShift - implausible shiftRpm guard (hasUsableShiftRpm)', () => {
  it('ignores a shiftRpm above redline and falls back to the rev-light fill % (beep)', () => {
    // shiftRpm 12000 is well above maxRpm 8000 (unreachable) -> use pct fallback.
    const decision = evaluateShift(config(), snap({ shiftRpm: 12000, maxRpm: 8000, rpm: 6000, shiftIndicatorPct: 0.95 }))
    expect(decision.shouldBeep).toBe(true)
    expect(decision.reason).toBe('shift-light-threshold')
  })

  it('ignores a shiftRpm above redline and falls back to the rev-light fill % (no beep)', () => {
    const decision = evaluateShift(config(), snap({ shiftRpm: 12000, maxRpm: 8000, rpm: 7900, shiftIndicatorPct: 0.5 }))
    expect(decision.shouldBeep).toBe(false)
    expect(decision.reason).toBe('below-shift-light-threshold')
  })

  it('still trusts a shiftRpm sitting right at the limiter (within the 2% margin)', () => {
    // shiftRpm 8050 vs maxRpm 8000 -> within 1.02x, treated as usable.
    const decision = evaluateShift(config(), snap({ shiftRpm: 8050, maxRpm: 8000, rpm: 8050, shiftIndicatorPct: 0.1 }))
    expect(decision.shouldBeep).toBe(true)
    expect(decision.reason).toBe('shift-rpm-threshold')
  })

  it('hasUsableShiftRpm: rejects above-redline, accepts at/below redline and unknown redline', () => {
    expect(hasUsableShiftRpm({ shiftRpm: 12000, maxRpm: 8000 })).toBe(false)
    expect(hasUsableShiftRpm({ shiftRpm: 7000, maxRpm: 8000 })).toBe(true)
    expect(hasUsableShiftRpm({ shiftRpm: 7000 })).toBe(true)
    expect(hasUsableShiftRpm({ shiftRpm: 0, maxRpm: 8000 })).toBe(false)
    expect(hasUsableShiftRpm({})).toBe(false)
  })
})

describe('evaluateShift - rpm mode tuning overrides', () => {
  it('user-set targetRpm overrides shiftRpm in rpm mode', () => {
    const cfg = config({
      cars: {
        'test car': { carKey: 'test car', mode: 'rpm', targetRpm: 8000 }
      }
    })
    // shiftRpm is 7000 but user set targetRpm 8000 -> at 7500 should NOT beep.
    const below = evaluateShift(cfg, snap({ rpm: 7500, shiftRpm: 7000 }))
    expect(below.shouldBeep).toBe(false)
    expect(below.reason).toBe('below-rpm-threshold')

    const above = evaluateShift(cfg, snap({ rpm: 8000, shiftRpm: 7000 }))
    expect(above.shouldBeep).toBe(true)
    expect(above.reason).toBe('rpm-threshold')
  })

  it('learned per-gear upshift RPM overrides shiftRpm in rpm mode', () => {
    const cfg = config({
      cars: {
        'test car': {
          carKey: 'test car',
          mode: 'rpm',
          learnedUpshiftRpmByGear: { 3: 7800 }
        }
      }
    })
    const below = evaluateShift(cfg, snap({ gear: 3, rpm: 7500, shiftRpm: 7000 }))
    expect(below.shouldBeep).toBe(false)

    const above = evaluateShift(cfg, snap({ gear: 3, rpm: 7800, shiftRpm: 7000 }))
    expect(above.shouldBeep).toBe(true)
    expect(above.reason).toBe('rpm-threshold')
  })

  it('rpm mode uses shiftRpm when no targetRpm/learned value is set', () => {
    const cfg = config({
      cars: {
        'test car': { carKey: 'test car', mode: 'rpm' }
      }
    })
    const decision = evaluateShift(cfg, snap({ rpm: 7000, shiftRpm: 7000 }))
    expect(decision.shouldBeep).toBe(true)
    expect(decision.reason).toBe('rpm-threshold')
  })
})

describe('evaluateShift - gating', () => {
  it('does not beep when disabled', () => {
    const decision = evaluateShift(config({ enabled: false }), snap({ shiftRpm: 7000, rpm: 8000 }))
    expect(decision).toEqual({ shouldBeep: false, reason: 'disabled' })
  })

  it('does not beep at low throttle', () => {
    const decision = evaluateShift(config(), snap({ shiftRpm: 7000, rpm: 8000, throttle: 0.2 }))
    expect(decision).toEqual({ shouldBeep: false, reason: 'low-throttle' })
  })

  it('does not beep when not in a forward gear', () => {
    const decision = evaluateShift(config(), snap({ shiftRpm: 7000, rpm: 8000, gear: 0 }))
    expect(decision).toEqual({ shouldBeep: false, reason: 'not-forward-gear' })
  })
})

describe('evaluateShift - redlineOffset mode (power-user, no longer default)', () => {
  // redlineOffset is now opt-in: pin it explicitly since the shipped default is 'exact'.
  function rlConfig(partial: Partial<SoundshiftConfig> = {}): SoundshiftConfig {
    return { ...DEFAULT_SOUNDSHIFT_CONFIG, enabled: true, defaultMode: 'redlineOffset', ...partial }
  }

  it('keeps the 100 RPM offset default (exact is the shipped default mode)', () => {
    expect(DEFAULT_SOUNDSHIFT_CONFIG.defaultMode).toBe('exact')
    expect(DEFAULT_SOUNDSHIFT_CONFIG.defaultShiftOffsetRpm).toBe(100)
  })

  it('beeps at the rev limiter minus the offset (7200 - 100 = 7100), not earlier', () => {
    const cfg = rlConfig()
    const at = evaluateShift(cfg, snap({ maxRpm: 7200, rpm: 7100, shiftRpm: 7200, shiftIndicatorPct: 1 }))
    expect(at.shouldBeep).toBe(true)
    expect(at.reason).toBe('redline-offset-threshold')

    const below = evaluateShift(cfg, snap({ maxRpm: 7200, rpm: 7099, shiftRpm: 7200, shiftIndicatorPct: 1 }))
    expect(below.shouldBeep).toBe(false)
    expect(below.reason).toBe('below-redline-offset-threshold')

    // 7000 is a full 200 RPM below redline — must stay quiet.
    expect(evaluateShift(cfg, snap({ maxRpm: 7200, rpm: 7000, shiftRpm: 7200 })).shouldBeep).toBe(false)
  })

  it('anchors to the rev limiter even when shiftRpm sits AT redline (MX-5 regression)', () => {
    // iRacing reports DriverCarSLShiftRPM == maxRpm == 7200, so shiftLight would beep at
    // 7200 (already in the red). redlineOffset fires at 7100 instead.
    const decision = evaluateShift(rlConfig(), snap({ maxRpm: 7200, shiftRpm: 7200, rpm: 7120 }))
    expect(decision.shouldBeep).toBe(true)
    expect(decision.reason).toBe('redline-offset-threshold')
  })

  it('per-car shiftOffsetRpm overrides the global default offset', () => {
    const cfg = rlConfig({
      defaultShiftOffsetRpm: 100,
      cars: { 'test car': { carKey: 'test car', mode: 'redlineOffset', shiftOffsetRpm: 300 } }
    })
    // target = 7200 - 300 = 6900: 7000 beeps under the override...
    expect(evaluateShift(cfg, snap({ maxRpm: 7200, rpm: 7000 })).shouldBeep).toBe(true)
    expect(evaluateShift(cfg, snap({ maxRpm: 7200, rpm: 6800 })).shouldBeep).toBe(false)
    // ...but the SAME 7000 stays quiet under the global 100 RPM offset (target 7100).
    expect(evaluateShift(rlConfig(), snap({ maxRpm: 7200, rpm: 7000 })).shouldBeep).toBe(false)
  })

  it('does not beep when neither maxRpm nor shiftRpm is available', () => {
    const decision = evaluateShift(rlConfig(), snap({ rpm: 7000, maxRpm: undefined, shiftRpm: undefined }))
    expect(decision.shouldBeep).toBe(false)
    expect(decision.reason).toBe('missing-rpm-target')
  })

  it('falls back to shiftRpm as the redline anchor when maxRpm is missing or zero', () => {
    // maxRpm missing -> anchor shiftRpm 7000 -> target 6900.
    expect(evaluateShift(rlConfig(), snap({ rpm: 6900, shiftRpm: 7000 })).shouldBeep).toBe(true)
    expect(evaluateShift(rlConfig(), snap({ rpm: 6800, shiftRpm: 7000 })).shouldBeep).toBe(false)
    // maxRpm zero (garbage) -> treated as absent -> anchor shiftRpm 7000 -> target 6900.
    expect(evaluateShift(rlConfig(), snap({ rpm: 6950, maxRpm: 0, shiftRpm: 7000 })).shouldBeep).toBe(true)
  })

  it('re-arm parity: isClearlyBelowThreshold uses the SAME target as the trigger', () => {
    const cfg = rlConfig()
    const base = snap({ maxRpm: 7200 })
    const target = resolveShiftTarget(cfg, undefined, base)
    expect(target).toBe(7100)

    // Trigger fires exactly at the shared target.
    expect(evaluateShift(cfg, { ...base, rpm: target as number }).shouldBeep).toBe(true)
    expect(evaluateShift(cfg, { ...base, rpm: (target as number) - 1 }).shouldBeep).toBe(false)

    // Re-arm hysteresis is target * 0.93 = 6603, derived from the SAME target.
    expect(isClearlyBelowThreshold(cfg, snap({ maxRpm: 7200, rpm: 6600 }))).toBe(true)
    expect(isClearlyBelowThreshold(cfg, snap({ maxRpm: 7200, rpm: 6700 }))).toBe(false)
    // Inside the shift zone it is NOT "clearly below".
    expect(isClearlyBelowThreshold(cfg, snap({ maxRpm: 7200, rpm: 7100 }))).toBe(false)
  })

  it('re-arm parity honours the per-car offset too', () => {
    const cfg = rlConfig({
      cars: { 'test car': { carKey: 'test car', mode: 'redlineOffset', shiftOffsetRpm: 300 } }
    })
    // target = 6900, re-arm at 6900 * 0.93 = 6417.
    expect(isClearlyBelowThreshold(cfg, snap({ maxRpm: 7200, rpm: 6400 }))).toBe(true)
    expect(isClearlyBelowThreshold(cfg, snap({ maxRpm: 7200, rpm: 6500 }))).toBe(false)
  })
})

describe('evaluateShift - exact mode (shipped default: beep AT the iRacing shift point)', () => {
  // Default mode is 'exact'; do NOT pin it here.
  function exactConfig(partial: Partial<SoundshiftConfig> = {}): SoundshiftConfig {
    return { ...DEFAULT_SOUNDSHIFT_CONFIG, enabled: true, ...partial }
  }

  it('ships exact as the default mode', () => {
    expect(DEFAULT_SOUNDSHIFT_CONFIG.defaultMode).toBe('exact')
  })

  it('beeps exactly at the per-car shift point (MX-5 slShift 7200), never earlier', () => {
    const cfg = exactConfig()
    // hasUsableShiftRpm true (7200 <= 7500*1.02). Below the point stays quiet even at pct 0.99.
    const below = evaluateShift(cfg, snap({ shiftRpm: 7200, maxRpm: 7500, rpm: 7199, shiftIndicatorPct: 0.99 }))
    expect(below.shouldBeep).toBe(false)
    expect(below.reason).toBe('below-exact-shift-rpm')

    const at = evaluateShift(cfg, snap({ shiftRpm: 7200, maxRpm: 7500, rpm: 7200, shiftIndicatorPct: 1 }))
    expect(at.shouldBeep).toBe(true)
    expect(at.reason).toBe('exact-shift-rpm')

    // A full 100 RPM before the shift point with the lights nearly full → still silent.
    expect(evaluateShift(cfg, snap({ shiftRpm: 7200, maxRpm: 7500, rpm: 7100, shiftIndicatorPct: 0.95 })).shouldBeep).toBe(false)
  })

  it('fires at pct>=1 OR the rev limiter (rpm>=maxRpm) when slShift sits above redline (Porsche)', () => {
    const cfg = exactConfig()
    // slShift 8500 > maxRpm 8275 * 1.02 (=8440.5) → hasUsableShiftRpm false → pct/limiter fallback.
    expect(hasUsableShiftRpm({ shiftRpm: 8500, maxRpm: 8275 })).toBe(false)
    const porsche = (rpm: number, pct: number): SoundshiftSnapshotLike =>
      ({ carName: 'Porsche 911 GT3', gear: 4, throttle: 1, shiftRpm: 8500, maxRpm: 8275, rpm, shiftIndicatorPct: pct })

    // The sl-band fill source CAPS pct below 1.0 for this car (it can't reach slShift), so a
    // pct>=1-only gate would go silent. Below the limiter → no beep.
    const below = evaluateShift(cfg, porsche(8200, 0.85))
    expect(below.shouldBeep).toBe(false)
    expect(below.reason).toBe('below-exact-shift-pct')

    // At the reachable rev limiter (maxRpm 8275) it fires even though pct never hits 1.0.
    const atLimiter = evaluateShift(cfg, porsche(8275, 0.85))
    expect(atLimiter.shouldBeep).toBe(true)
    expect(atLimiter.reason).toBe('exact-shift-pct')

    // The iracing-live fill source DOES pin pct=1.0 at slShift → also fires.
    expect(evaluateShift(cfg, porsche(8100, 1)).shouldBeep).toBe(true)
  })

  it('ignores the rev-light fill % entirely on the primary (shiftRpm) path', () => {
    // pct is past any old threshold but rpm hasn't reached the shift point → no beep.
    const cfg = exactConfig()
    expect(evaluateShift(cfg, snap({ shiftRpm: 7200, maxRpm: 7500, rpm: 7000, shiftIndicatorPct: 1 })).shouldBeep).toBe(false)
  })

  it('re-arm parity (rpm path): re-arms below shiftRpm*0.95, never at the shift point', () => {
    const cfg = exactConfig()
    // Trigger fires exactly at shiftRpm 7200...
    expect(evaluateShift(cfg, snap({ shiftRpm: 7200, maxRpm: 7500, rpm: 7200 })).shouldBeep).toBe(true)
    expect(evaluateShift(cfg, snap({ shiftRpm: 7200, maxRpm: 7500, rpm: 7199 })).shouldBeep).toBe(false)
    // ...and re-arm only once clearly below 7200*0.95 = 6840.
    expect(isClearlyBelowThreshold(cfg, snap({ shiftRpm: 7200, maxRpm: 7500, rpm: 6839 }))).toBe(true)
    expect(isClearlyBelowThreshold(cfg, snap({ shiftRpm: 7200, maxRpm: 7500, rpm: 6841 }))).toBe(false)
    // At the shift point it is NOT "clearly below".
    expect(isClearlyBelowThreshold(cfg, snap({ shiftRpm: 7200, maxRpm: 7500, rpm: 7200 }))).toBe(false)
  })

  it('re-arm parity (pct/limiter fallback): re-arms only below BOTH pct 0.9 AND maxRpm*0.95', () => {
    const cfg = exactConfig()
    const porsche = (rpm: number, pct: number): SoundshiftSnapshotLike =>
      ({ carName: 'Porsche 911 GT3', gear: 4, throttle: 1, shiftRpm: 8500, maxRpm: 8275, rpm, shiftIndicatorPct: pct })
    // maxRpm*0.95 = 7861. Clearly below the limiter AND pct low → re-arm.
    expect(isClearlyBelowThreshold(cfg, porsche(7800, 0.85))).toBe(true)
    // Still near the limiter (>= 7861) with a capped pct → NOT clearly below (else it would
    // beep-spam every frame at the limiter, since this car's pct never reaches 0.9).
    expect(isClearlyBelowThreshold(cfg, porsche(8000, 0.85))).toBe(false)
  })
})

describe('effectiveLeadMs - exact mode ignores leadMs, other modes keep it', () => {
  const car = 'Some Car'
  it('forces lead to 0 for the exact default even when leadMs is set', () => {
    const cfg: SoundshiftConfig = { ...DEFAULT_SOUNDSHIFT_CONFIG, leadMs: 200 }
    expect(cfg.defaultMode).toBe('exact')
    expect(effectiveLeadMs(cfg, car)).toBe(0)
  })

  it('keeps the configured leadMs for redlineOffset / shiftLight / rpm', () => {
    expect(effectiveLeadMs({ ...DEFAULT_SOUNDSHIFT_CONFIG, leadMs: 200, defaultMode: 'redlineOffset' }, car)).toBe(200)
    expect(effectiveLeadMs({ ...DEFAULT_SOUNDSHIFT_CONFIG, leadMs: 120, defaultMode: 'shiftLight' }, car)).toBe(120)
  })

  it('honours a per-car mode pin over the global default', () => {
    // global exact but car pinned to redlineOffset → keep lead.
    const pinnedRl: SoundshiftConfig = {
      ...DEFAULT_SOUNDSHIFT_CONFIG, leadMs: 150, cars: { 'some car': { carKey: 'some car', mode: 'redlineOffset' } }
    }
    expect(effectiveLeadMs(pinnedRl, car)).toBe(150)
    // global redlineOffset but car pinned to exact → force 0.
    const pinnedExact: SoundshiftConfig = {
      ...DEFAULT_SOUNDSHIFT_CONFIG, leadMs: 150, defaultMode: 'redlineOffset', cars: { 'some car': { carKey: 'some car', mode: 'exact' } }
    }
    expect(effectiveLeadMs(pinnedExact, car)).toBe(0)
  })
})

describe('learnedUpshiftWrite - auto-learn de-contamination', () => {
  const base: SoundshiftConfig = { ...DEFAULT_SOUNDSHIFT_CONFIG, enabled: true }

  it('records a learned upshift WITHOUT stamping a mode (car follows global default)', () => {
    const cars = learnedUpshiftWrite(base, 'mx5', 3, 7000, 'Mazda MX-5', 7500)
    expect(cars).not.toBeNull()
    const car = cars!['mx5']
    expect(car.learnedUpshiftRpmByGear).toEqual({ 3: 7000 })
    expect(car.mode).toBeUndefined()
    expect(car.carName).toBe('Mazda MX-5')
  })

  it('rejects a sample above the car redline (rpm > maxRpm), so learned never exceeds it', () => {
    expect(learnedUpshiftWrite(base, 'mx5', 3, 8330, 'Mazda MX-5', 7200)).toBeNull()
  })

  it('accepts a sample at the redline', () => {
    const cars = learnedUpshiftWrite(base, 'mx5', 3, 7200, 'Mazda MX-5', 7200)
    expect(cars!['mx5'].learnedUpshiftRpmByGear).toEqual({ 3: 7200 })
  })

  it('skips an empty/missing carName (never writes the contaminated unknown bucket)', () => {
    expect(learnedUpshiftWrite(base, '', 3, 6000, '', 7500)).toBeNull()
    expect(learnedUpshiftWrite(base, undefined, 3, 6000, undefined, 7500)).toBeNull()
  })

  it('preserves an explicit prior mode while still recording the learned value', () => {
    const withMode: SoundshiftConfig = {
      ...base, cars: { mx5: { carKey: 'mx5', mode: 'rpm', carName: 'Mazda MX-5' } }
    }
    const cars = learnedUpshiftWrite(withMode, 'mx5', 4, 7000, 'Mazda MX-5', 7500)
    expect(cars!['mx5'].mode).toBe('rpm')
    expect(cars!['mx5'].learnedUpshiftRpmByGear).toEqual({ 4: 7000 })
  })
})

describe('migrateLoadedSoundshift (v2 -> v3: exact default, reset learned, un-pin auto-stamped modes)', () => {
  it('sets exact default, bumps version, wipes learned, un-pins shiftLight, drops unknown', () => {
    const out = migrateLoadedSoundshift({
      soundshift: {
        version: 2,
        defaultMode: 'redlineOffset',
        cars: {
          'mazda mx 5': { carKey: 'mazda mx 5', mode: 'shiftLight', learnedUpshiftRpmByGear: { 3: 8330 } },
          'porsche 911': { carKey: 'porsche 911', mode: 'rpm', targetRpm: 8000, learnedUpshiftRpmByGear: { 2: 8000 } },
          unknown: { carKey: 'unknown', mode: 'shiftLight', learnedUpshiftRpmByGear: { 1: 9000 } }
        }
      } as never
    })
    const ss = out.soundshift
    expect(ss?.defaultMode).toBe('exact')
    expect(ss?.version).toBe(3)
    // 'unknown' bucket dropped entirely.
    expect(ss?.cars?.['unknown']).toBeUndefined()
    // Auto-stamped 'shiftLight' un-pinned → follows the global exact default.
    expect(ss?.cars?.['mazda mx 5'].mode).toBeUndefined()
    // Explicit power-user 'rpm' choice preserved.
    expect(ss?.cars?.['porsche 911'].mode).toBe('rpm')
    expect(ss?.cars?.['porsche 911'].targetRpm).toBe(8000)
    // Learned per-gear RPM wiped for every car.
    expect(ss?.cars?.['mazda mx 5'].learnedUpshiftRpmByGear).toBeUndefined()
    expect(ss?.cars?.['porsche 911'].learnedUpshiftRpmByGear).toBeUndefined()
  })

  it('migrates a versionless (pre-round-15) config to exact', () => {
    const out = migrateLoadedSoundshift({ soundshift: { defaultMode: 'shiftLight', cars: {} } as never })
    expect(out.soundshift?.defaultMode).toBe('exact')
    expect(out.soundshift?.version).toBe(3)
  })

  it('un-pins an auto-stamped redlineOffset car (round-15 default) → follows global exact', () => {
    const out = migrateLoadedSoundshift({
      soundshift: {
        version: 1,
        defaultMode: 'shiftLight',
        cars: { 'a car': { carKey: 'a car', mode: 'redlineOffset', learnedUpshiftRpmByGear: { 2: 6000 } } }
      } as never
    })
    // 'redlineOffset' was BOTH a deliberate choice AND the round-15 auto-learn stamp
    // (mode = existing?.mode ?? defaultMode, gated only by autoLearn=true). Since the stamp
    // dominates, un-pin it so the car follows the new global 'exact' — what the user asked for.
    expect(out.soundshift?.cars?.['a car'].mode).toBeUndefined()
    expect(out.soundshift?.cars?.['a car'].learnedUpshiftRpmByGear).toBeUndefined()
  })

  it('preserves a deliberate per-car exact pin', () => {
    const out = migrateLoadedSoundshift({
      soundshift: {
        version: 2,
        defaultMode: 'redlineOffset',
        cars: { 'a car': { carKey: 'a car', mode: 'exact', learnedUpshiftRpmByGear: { 2: 6000 } } }
      } as never
    })
    expect(out.soundshift?.cars?.['a car'].mode).toBe('exact')
  })

  it('is idempotent: a v3 config is returned untouched', () => {
    const v3 = {
      soundshift: {
        version: 3,
        defaultMode: 'rpm',
        cars: { a: { carKey: 'a', mode: 'shiftLight', learnedUpshiftRpmByGear: { 2: 6000 } } }
      }
    } as never
    const out = migrateLoadedSoundshift(v3)
    expect(out).toBe(v3)
  })

  it('is a no-op when the patch has no soundshift section', () => {
    const out = migrateLoadedSoundshift({ outputDeviceId: 'x' })
    expect(out.soundshift).toBeUndefined()
  })
})

describe('carKeyOf - prefers the stable carPath over the localized carName', () => {
  it('keys off carPath when present (immune to display-name drift)', () => {
    // Same car, two localized display names → ONE stable key from the carPath.
    expect(carKeyOf('Mazda MX-5 Cup', 'mx5 mx52016')).toBe('mx5 mx52016')
    expect(carKeyOf('Mazda MX-5 (NC)', 'mx5 mx52016')).toBe('mx5 mx52016')
  })

  it('falls back to the carName-derived key when no carPath is given', () => {
    expect(carKeyOf('Mazda MX-5')).toBe('mazda mx 5')
    expect(carKeyOf('Mazda MX-5', undefined)).toBe('mazda mx 5')
    expect(carKeyOf('Mazda MX-5', '')).toBe('mazda mx 5')
  })

  it('yields the safe "unknown" sentinel when both identities are missing (never crashes)', () => {
    expect(carKeyOf()).toBe('unknown')
    expect(carKeyOf('', '')).toBe('unknown')
    expect(carKeyOf(undefined, undefined)).toBe('unknown')
    expect(carKeyOf('   ', '  ')).toBe('unknown')
  })
})

describe('resolveCarKey - backward-compat with carName-keyed configs', () => {
  const tuning = { carKey: 'x' }

  it('prefers the carPath key when a carPath-keyed tuning exists', () => {
    const cars = { 'mx5 mx52016': tuning, 'mazda mx 5': tuning }
    expect(resolveCarKey(cars, 'Mazda MX-5', 'mx5 mx52016')).toBe('mx5 mx52016')
  })

  it('falls back to a legacy carName-keyed entry when no carPath entry exists', () => {
    // Config saved BEFORE carPath keying: only the carName-derived key is present.
    const cars = { 'mazda mx 5': tuning }
    expect(resolveCarKey(cars, 'Mazda MX-5', 'mx5 mx52016')).toBe('mazda mx 5')
  })

  it('returns the preferred carPath key for a brand-new car (so fresh learns stamp the stable key)', () => {
    expect(resolveCarKey({}, 'Mazda MX-5', 'mx5 mx52016')).toBe('mx5 mx52016')
  })

  it('returns the carName key when there is no carPath at all', () => {
    expect(resolveCarKey({}, 'Mazda MX-5', undefined)).toBe('mazda mx 5')
  })

  it('returns "unknown" when neither identity resolves', () => {
    expect(resolveCarKey({}, undefined, undefined)).toBe('unknown')
  })
})

describe('evaluateShift - resolves per-car tuning via the stable carPath key', () => {
  it('applies per-car tuning keyed by carPath even when carName drifts', () => {
    const cfg: SoundshiftConfig = {
      ...DEFAULT_SOUNDSHIFT_CONFIG,
      enabled: true,
      defaultMode: 'rpm',
      cars: { 'mx5 mx52016': { carKey: 'mx5 mx52016', mode: 'rpm', targetRpm: 7000 } }
    }
    const base: SoundshiftSnapshotLike = {
      carName: 'Mazda MX-5 Cup', carPath: 'mx5 mx52016', gear: 3, throttle: 1, rpm: 6999
    }
    expect(evaluateShift(cfg, base).shouldBeep).toBe(false)
    expect(evaluateShift(cfg, { ...base, rpm: 7001 }).shouldBeep).toBe(true)
  })

  it('still applies a legacy carName-keyed tuning (backward compat) when no carPath entry exists', () => {
    const cfg: SoundshiftConfig = {
      ...DEFAULT_SOUNDSHIFT_CONFIG,
      enabled: true,
      defaultMode: 'rpm',
      cars: { 'mazda mx 5': { carKey: 'mazda mx 5', mode: 'rpm', targetRpm: 7000 } }
    }
    const snapWithPath: SoundshiftSnapshotLike = {
      carName: 'Mazda MX-5', carPath: 'mx5 mx52016', gear: 3, throttle: 1, rpm: 7001
    }
    expect(evaluateShift(cfg, snapWithPath).shouldBeep).toBe(true)
  })
})
