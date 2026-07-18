import { describe, expect, it } from 'vitest'
import {
  RGB_MATRIX_FULL_BRIGHTNESS,
  RGB_MATRIX_SIZE,
  buildCalibrationRows,
  buildFlagHexGrid,
  buildGearGlyphHexGrid,
  createEffectAnimation,
  createRgbMatrixEffect,
  createRgbMatrixGroup,
  createRgbMatrixStatusLed,
  defaultMatrixLayout,
  defaultRgbMatrixProfile,
  emptyMatrixHexGrid,
  ensureUniqueEffectPriorities,
  withEffectOnTop,
  gridToEffectAnimation,
  isValidHexGrid,
  normalizeRgbEffectAnimation,
  normalizeRgbMatrixEffect,
  normalizeRgbMatrixEffects,
  physicalIndexForXY,
  renderMatrixFrame,
  selectAnimationFrame,
  selectFlagAnimation,
  selectGearAnimation,
  applyBlinkPhase,
  selectGearNumberColor,
  selectRedlineReachedWithHysteresis,
  shiftIndicatorLevel,
  wireLayoutByte,
  rgbToHex,
  type RgbMatrixFlagsEffect,
  type RgbMatrixGearEffect,
  type RgbMatrixEffect,
  type RgbMatrixAnimationEffect,
  type RgbMatrixProfile,
  type RgbMatrixRenderOptions
} from './rgb-matrix'
import type { Flags, TelemetrySnapshot } from './telemetry'

function snapshot(partial: Partial<TelemetrySnapshot>): TelemetrySnapshot {
  return {
    sim: 'mock',
    connected: true,
    timestamp: 0,
    speedKmh: 0,
    rpm: 0,
    gear: 0,
    maxRpm: 8000,
    throttle: 0,
    brake: 0,
    clutch: 0,
    ...partial
  } as TelemetrySnapshot
}

const ALL_FLAGS_OFF: Flags = {
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
  greenWhiteCheckered: false
}

describe('defaults', () => {
  it('defaults the layout to serpentine ON (SimHub truth)', () => {
    expect(defaultMatrixLayout().serpentine).toBe(true)
  })

  it('does NOT paint the green flag during normal racing (no flash) — the gear stays', () => {
    const profile = defaultRgbMatrixProfile()
    const frame = renderMatrixFrame(profile, snapshot({ gear: 3, flags: { ...ALL_FLAGS_OFF, green: true } }), 0)
    const colors = new Set(frame.flat().map((c) => rgbToHex(c).toLowerCase()))
    // Outside the brief start/restart flash, the green flag must NOT paint a green
    // panel — the gear digit (#0078d4) owns the panel, green (#21a366) is absent.
    expect(colors.has('#0078d4')).toBe(true)
    expect(colors.has('#21a366')).toBe(false)
  })
})

describe('per-effect rotation', () => {
  it('rotates a single-pixel static effect 90° clockwise', () => {
    const dot = createRgbMatrixEffect('static')
    dot.forceActivation = true
    dot.colors.active = '#FFFFFF'
    dot.position = { matrixStart: 0, startX: 0, startY: 0, width: 1, height: 1 }
    dot.rotation = 90
    const profile: RgbMatrixProfile = { version: 1, layout: defaultMatrixLayout(), effects: [dot] }
    const frame = renderMatrixFrame(profile, snapshot({}), 0)
    // (0,0) clears and the lit pixel lands at the top-right corner.
    expect(rgbToHex(frame[0][0])).toBe('#000000')
    expect(rgbToHex(frame[0][RGB_MATRIX_SIZE - 1])).toBe('#ffffff')
  })

  it('leaves the image unchanged at rotation 0', () => {
    const dot = createRgbMatrixEffect('static')
    dot.forceActivation = true
    dot.colors.active = '#FFFFFF'
    dot.position = { matrixStart: 0, startX: 0, startY: 0, width: 1, height: 1 }
    dot.rotation = 0
    const profile: RgbMatrixProfile = { version: 1, layout: defaultMatrixLayout(), effects: [dot] }
    const frame = renderMatrixFrame(profile, snapshot({}), 0)
    expect(rgbToHex(frame[0][0])).toBe('#ffffff')
  })

  it('normalizes a missing rotation to 0 (backward compatible)', () => {
    const legacy = { ...createRgbMatrixEffect('static') } as Record<string, unknown>
    delete legacy.rotation
    const normalized = normalizeRgbMatrixEffect(legacy as never) as { rotation?: number }
    expect(normalized.rotation).toBe(0)
  })
})

describe('per-effect brightness', () => {
  it('scales a solid flag fill by brightness/255', () => {
    const flags = createRgbMatrixEffect('flags') as RgbMatrixFlagsEffect
    flags.mode = 'solid'
    flags.forceActivation = true
    flags.colors.active = '#FFFFFF'
    flags.brightness = 128
    const profile: RgbMatrixProfile = { version: 1, layout: defaultMatrixLayout(), effects: [flags] }
    const frame = renderMatrixFrame(profile, snapshot({}), 0)
    const px = frame[0][0]
    expect(px.r).toBe(Math.round(255 * (128 / 255)))
    expect(px.r).toBeLessThan(200)
    expect(px.r).toBeGreaterThan(100)
  })

  it('full brightness leaves colours unchanged', () => {
    const flags = createRgbMatrixEffect('flags') as RgbMatrixFlagsEffect
    flags.mode = 'solid'
    flags.forceActivation = true
    flags.colors.active = '#FFFFFF'
    flags.brightness = RGB_MATRIX_FULL_BRIGHTNESS
    const profile: RgbMatrixProfile = { version: 1, layout: defaultMatrixLayout(), effects: [flags] }
    const frame = renderMatrixFrame(profile, snapshot({}), 0)
    expect(rgbToHex(frame[0][0])).toBe('#ffffff')
  })

  it('zero brightness blacks out the effect', () => {
    const flags = createRgbMatrixEffect('flags') as RgbMatrixFlagsEffect
    flags.mode = 'solid'
    flags.forceActivation = true
    flags.colors.active = '#FFFFFF'
    flags.brightness = 0
    const profile: RgbMatrixProfile = { version: 1, layout: defaultMatrixLayout(), effects: [flags] }
    const frame = renderMatrixFrame(profile, snapshot({}), 0)
    expect(rgbToHex(frame[0][0])).toBe('#000000')
  })
})

describe('custom gear glyphs', () => {
  it('renders a custom glyph for the active gear when mode=custom', () => {
    const gear = createRgbMatrixEffect('gear') as RgbMatrixGearEffect
    gear.mode = 'custom'
    const grid = emptyMatrixHexGrid()
    grid[1][2] = '#FF0000'
    gear.customGlyphs = { '5': grid }
    const profile: RgbMatrixProfile = { version: 1, layout: defaultMatrixLayout(), effects: [gear] }
    const frame = renderMatrixFrame(profile, snapshot({ gear: 5 }), 0)
    expect(rgbToHex(frame[1][2])).toBe('#ff0000')
    // #000000 cells stay transparent (gear glyph behaviour).
    expect(rgbToHex(frame[0][0])).toBe('#000000')
  })

  it('falls back to the font when no custom glyph exists for the label', () => {
    const gear = createRgbMatrixEffect('gear') as RgbMatrixGearEffect
    gear.mode = 'custom'
    gear.customGlyphs = {}
    const profile: RgbMatrixProfile = { version: 1, layout: defaultMatrixLayout(), effects: [gear] }
    const frame = renderMatrixFrame(profile, snapshot({ gear: 3 }), 0)
    const lit = frame.flat().filter((c) => rgbToHex(c) !== '#000000')
    expect(lit.length).toBeGreaterThan(0)
  })
})

describe('custom flag patterns', () => {
  it('renders a custom pattern for the detected flag when mode=custom', () => {
    const flags = createRgbMatrixEffect('flags') as RgbMatrixFlagsEffect
    flags.mode = 'custom'
    const grid = emptyMatrixHexGrid()
    grid[4][4] = '#00FF00'
    flags.customPatterns = { green: grid }
    const profile: RgbMatrixProfile = { version: 1, layout: defaultMatrixLayout(), effects: [flags] }
    const frame = renderMatrixFrame(profile, snapshot({ flags: { ...ALL_FLAGS_OFF, green: true } }), 0, { greenFlashActive: true })
    expect(rgbToHex(frame[4][4])).toBe('#00ff00')
  })
})

describe('test pattern builders reflect custom pixels', () => {
  it('buildCalibrationRows(gear) uses the custom glyph for "3" when present', () => {
    const gear = createRgbMatrixEffect('gear') as RgbMatrixGearEffect
    gear.mode = 'custom'
    const grid = emptyMatrixHexGrid()
    grid[0][0] = '#123456'
    gear.customGlyphs = { '3': grid }
    const profile: RgbMatrixProfile = { version: 1, layout: defaultMatrixLayout(), effects: [gear] }
    const rows = buildCalibrationRows('gear', profile)
    expect(rows[0][0].toLowerCase()).toBe('#123456')
  })

  it('buildCalibrationRows(flag-green) uses the custom flag pattern when present', () => {
    const flags = createRgbMatrixEffect('flags') as RgbMatrixFlagsEffect
    flags.mode = 'custom'
    const grid = emptyMatrixHexGrid()
    grid[7][7] = '#abcdef'
    flags.customPatterns = { green: grid }
    const profile: RgbMatrixProfile = { version: 1, layout: defaultMatrixLayout(), effects: [flags] }
    const rows = buildCalibrationRows('flag-green', profile)
    expect(rows[7][7].toLowerCase()).toBe('#abcdef')
  })

  it('falls back to the default pattern with no profile', () => {
    const rows = buildCalibrationRows('flag-green')
    expect(isValidHexGrid(rows)).toBe(true)
  })
})

describe('backward-compatible normalization', () => {
  it('fills a missing brightness with full', () => {
    const legacy = { ...(createRgbMatrixEffect('static')) } as Record<string, unknown>
    delete legacy.brightness
    const normalized = normalizeRgbMatrixEffect(legacy as never)
    expect(normalized.kind !== 'group' && normalized.brightness).toBe(RGB_MATRIX_FULL_BRIGHTNESS)
  })

  it('defaults a missing gear mode to font and drops malformed glyphs', () => {
    const legacy = createRgbMatrixEffect('gear') as RgbMatrixGearEffect
    delete (legacy as unknown as Record<string, unknown>).mode
    ;(legacy as unknown as Record<string, unknown>).customGlyphs = { '3': [['#fff']] } // wrong size
    const normalized = normalizeRgbMatrixEffect(legacy) as RgbMatrixGearEffect
    expect(normalized.mode).toBe('font')
    expect(normalized.customGlyphs).toBeUndefined()
  })

  it('normalizes an array and falls back to defaults for non-arrays', () => {
    expect(normalizeRgbMatrixEffects('nope').length).toBeGreaterThan(0)
    expect(normalizeRgbMatrixEffects([]).length).toBe(0)
  })

  it('preserves a valid custom flag mode and patterns', () => {
    const flags = createRgbMatrixEffect('flags') as RgbMatrixFlagsEffect
    flags.mode = 'custom'
    flags.customPatterns = { red: buildFlagHexGrid('red') }
    const normalized = normalizeRgbMatrixEffect(flags) as RgbMatrixFlagsEffect
    expect(normalized.mode).toBe('custom')
    expect(isValidHexGrid(normalized.customPatterns?.red)).toBe(true)
  })
})


// v2.25.2 — statusLed transparency + UNIQUE composite priority.
// A status LED used to paint a SOLID (opaque) grid over its position, so an
// INACTIVE full-panel spotter LED on top blanked the gear/flags beneath it. It
// now renders OVERLAY-friendly (off/#000000 = transparent), and effects composite
// by an explicit UNIQUE priority (0 = top, overrides all).
describe('statusLed renders overlay-friendly (inactive = transparent)', () => {
  function profileWith(effects: RgbMatrixEffect[]): RgbMatrixProfile {
    return { version: 1, layout: defaultMatrixLayout(), effects }
  }

  it('an INACTIVE full-panel status LED on top does NOT blank the gear underneath', () => {
    const gear = createRgbMatrixEffect('gear')
    const spotter = createRgbMatrixStatusLed('spotterCarRight') // full-panel default position
    // ensureUniqueEffectPriorities → gear=1 (bottom), spotter=0 (TOP).
    const effects = ensureUniqueEffectPriorities([gear, spotter])
    const telemetry = snapshot({ gear: 3, spotterCarRight: false } as Partial<TelemetrySnapshot>)
    const frame = renderMatrixFrame(profileWith(effects), telemetry, 0)
    const gearOnly = renderMatrixFrame(profileWith([gear]), telemetry, 0)
    // The inactive spotter paints nothing (transparent), so the panel is byte-for-
    // byte the gear-only frame — the digit underneath is fully visible.
    expect(frame).toEqual(gearOnly)
    const litCells = frame.flat().filter((c) => c.r + c.g + c.b > 0).length
    expect(litCells).toBeGreaterThan(0)
  })

  it('an ACTIVE full-panel status LED on top overrides its region', () => {
    const gear = createRgbMatrixEffect('gear')
    const spotter = createRgbMatrixStatusLed('spotterCarRight') // active colour #0078D4
    const effects = ensureUniqueEffectPriorities([gear, spotter])
    const frame = renderMatrixFrame(
      profileWith(effects),
      snapshot({ gear: 3, spotterCarRight: true } as Partial<TelemetrySnapshot>),
      0
    )
    const active = { r: 0, g: 120, b: 212 } // #0078D4
    // Full-panel active spotter overrides EVERY cell (gear included).
    for (let y = 0; y < RGB_MATRIX_SIZE; y += 1) {
      for (let x = 0; x < RGB_MATRIX_SIZE; x += 1) {
        expect(frame[y][x]).toEqual(active)
      }
    }
  })

  it('a static effect still paints OPAQUE black where its grid is off', () => {
    // Same position/colour as the status LED case, but kind:'static' — a static
    // effect is allowed to deliberately blank a region, so #000000 stays opaque.
    const gear = createRgbMatrixEffect('gear')
    const black = { ...createRgbMatrixEffect('static'), colors: { active: '#000000', blink: '#FFFFFF', inactive: '#000000', inactiveBlink: '#202020' } } as RgbMatrixEffect
    const effects = ensureUniqueEffectPriorities([gear, black]) // black on top
    const frame = renderMatrixFrame(
      profileWith(effects),
      snapshot({ gear: 3 } as Partial<TelemetrySnapshot>),
      0
    )
    // The opaque black static blanks the whole panel.
    const litCells = frame.flat().filter((c) => c.r + c.g + c.b > 0).length
    expect(litCells).toBe(0)
  })

  it('uses provider blink for the iFlag redline status and falls back only when absent', () => {
    const redline = createRgbMatrixStatusLed('redlineReached')
    const profile = profileWith([redline])

    const providerOff = renderMatrixFrame(profile, snapshot({
      shiftIndicatorPct: 0.999,
      revLights: { pct: 0.999, blink: false }
    }), 0)
    expect(providerOff.flat().every((color) => color.r + color.g + color.b === 0)).toBe(true)

    const providerOn = renderMatrixFrame(profile, snapshot({
      shiftIndicatorPct: 0.2,
      revLights: { pct: 0.2, blink: true }
    }), 0)
    expect(providerOn.flat().some((color) => color.r + color.g + color.b > 0)).toBe(true)

    const fallback = renderMatrixFrame(profile, snapshot({
      shiftIndicatorPct: 0.99,
      revLights: { pct: 0.99 }
    }), 0)
    expect(fallback.flat().some((color) => color.r + color.g + color.b > 0)).toBe(true)
  })
})


describe('unique effect priority (0..N-1, 0 overrides all)', () => {
  function profileWith(effects: RgbMatrixEffect[]): RgbMatrixProfile {
    return { version: 1, layout: defaultMatrixLayout(), effects }
  }
  function solidStatic(hex: string, priority?: number): RgbMatrixEffect {
    const base = createRgbMatrixEffect('static')
    return {
      ...base,
      colors: { active: hex, blink: '#FFFFFF', inactive: hex, inactiveBlink: hex },
      ...(priority === undefined ? {} : { priority })
    } as RgbMatrixEffect
  }
  const RED = { r: 255, g: 0, b: 0 }
  const GREEN = { r: 0, g: 255, b: 0 }

  it('priority 0 is painted ON TOP regardless of array order', () => {
    // Array order is [green(prio 0), red(prio 1)]: with last-on-top array semantics
    // RED would win, but priority 0 (green) must override.
    const green = solidStatic('#00FF00', 0)
    const red = solidStatic('#FF0000', 1)
    const frame = renderMatrixFrame(profileWith([green, red]), snapshot({}), 0)
    expect(frame[0][0]).toEqual(GREEN)
  })

  it('swapping the priorities flips which effect wins', () => {
    const green = solidStatic('#00FF00', 1)
    const red = solidStatic('#FF0000', 0)
    const frame = renderMatrixFrame(profileWith([green, red]), snapshot({}), 0)
    expect(frame[0][0]).toEqual(RED)
  })

  it('EXCLUSIVE: lower-priority effect does NOT bleed through (no compositing)', () => {
    // Top = green fill (prio 0); below = a static painting only the corner red.
    // Exclusive: green owns the panel; the red cell must not survive.
    const green = solidStatic('#00FF00', 0)
    const cornerRed = solidStatic('#FF0000', 1)
    const frame = renderMatrixFrame(profileWith([green, cornerRed]), snapshot({}), 0)
    for (const row of frame) for (const cell of row) expect(cell).toEqual(GREEN)
  })

  it('EXCLUSIVE: a top effect that paints nothing falls through to a visible static', () => {
    // Flags (prio 0) under a steady green flag render an EMPTY panel; the static below
    // must still show instead of the panel going dark.
    const flags = createRgbMatrixEffect('flags')
    flags.priority = 0
    const red = solidStatic('#FF0000', 1)
    const frame = renderMatrixFrame(profileWith([flags, red]), snapshot({ flags: { ...ALL_FLAGS_OFF, green: true } }), 0)
    expect(frame[0][0]).toEqual(RED)
  })

  it('renders a legacy (no-priority) profile IDENTICALLY to its migrated form', () => {
    const legacy = [solidStatic('#FF0000'), solidStatic('#00FF00')] // last (green) on top
    const migrated = ensureUniqueEffectPriorities(legacy)
    const legacyFrame = renderMatrixFrame(profileWith(legacy), snapshot({}), 0)
    const migratedFrame = renderMatrixFrame(profileWith(migrated), snapshot({}), 0)
    expect(migratedFrame).toEqual(legacyFrame)
    expect(legacyFrame[0][0]).toEqual(GREEN) // last-on-top preserved
  })

  it('ensureUniqueEffectPriorities assigns (N-1)-index so the LAST element becomes 0', () => {
    const out = ensureUniqueEffectPriorities([solidStatic('#111111'), solidStatic('#222222'), solidStatic('#333333')])
    expect(out.map((e) => e.priority)).toEqual([2, 1, 0])
  })

  it('is idempotent for an already-unique-finite list (same reference, untouched)', () => {
    const unique = [solidStatic('#111111', 0), solidStatic('#222222', 1), solidStatic('#333333', 2)]
    expect(ensureUniqueEffectPriorities(unique)).toBe(unique)
  })

  it('resolves a DUPLICATE priority to a unique contiguous 0..N-1 set', () => {
    const dup = [solidStatic('#111111', 0), solidStatic('#222222', 0), solidStatic('#333333', 1)]
    const fixed = ensureUniqueEffectPriorities(dup)
    expect(new Set(fixed.map((e) => e.priority)).size).toBe(3)
    expect([...fixed.map((e) => e.priority)].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([0, 1, 2])
  })

  it('normalizeRgbMatrixEffects assigns unique priorities (top-level AND group children)', () => {
    const group = createRgbMatrixGroup({ kind: 'gameRunning' })
    group.effects = [createRgbMatrixEffect('flags'), createRgbMatrixEffect('gear')]
    const normalized = normalizeRgbMatrixEffects([createRgbMatrixEffect('flags'), group])
    expect(normalized.map((e) => e.priority)).toEqual([1, 0])
    const normGroup = normalized[1] as Extract<RgbMatrixEffect, { kind: 'group' }>
    expect(normGroup.effects.map((e) => e.priority)).toEqual([1, 0])
  })

  it('composites group children by priority (0 on top) inside a forced group', () => {
    const group = createRgbMatrixGroup({ kind: 'gameRunning' })
    group.forceActivation = true
    // Array order [green(0), red(1)] — priority 0 (green) must win.
    group.effects = [solidStatic('#00FF00', 0), solidStatic('#FF0000', 1)]
    const frame = renderMatrixFrame(profileWith([group]), snapshot({}), 0)
    expect(frame[0][0]).toEqual(GREEN)
  })

  // R21-1: a newly-added effect must land ON TOP (priority 0) so e.g. a spotter the
  // user just added overrides the panel out-of-the-box — deterministic whether or
  // not the profile was ever normalised.
  it('withEffectOnTop puts the new effect at priority 0 and shifts siblings down (un-normalized profile)', () => {
    const a = solidStatic('#111111') // no priority (legacy / unsaved)
    const b = solidStatic('#222222')
    const fresh = solidStatic('#00FF00')
    const next = withEffectOnTop([a, b], fresh)
    const added = next.find((e) => e.id === fresh.id)
    expect(added?.priority).toBe(0)
    // contiguous unique 0..N set, with every PRE-EXISTING sibling shifted off 0.
    expect([...next.map((e) => e.priority as number)].sort((x, y) => x - y)).toEqual([0, 1, 2])
    for (const e of next) if (e.id !== fresh.id) expect(e.priority).toBeGreaterThan(0)
  })

  it('withEffectOnTop puts the new effect at priority 0 (already-normalized profile)', () => {
    const a = solidStatic('#111111', 0)
    const b = solidStatic('#222222', 1)
    const fresh = solidStatic('#00FF00')
    const next = withEffectOnTop([a, b], fresh)
    expect(next.find((e) => e.id === fresh.id)?.priority).toBe(0)
    expect(next.find((e) => e.id === a.id)?.priority).toBe(1)
    expect(next.find((e) => e.id === b.id)?.priority).toBe(2)
  })

  it('a freshly-added full-panel spotter (priority 0) overrides the gear when active', () => {
    const gear = createRgbMatrixEffect('gear')
    const spotter = createRgbMatrixStatusLed('spotterCarRight')
    const effects = withEffectOnTop([gear], spotter) // spotter on top
    const frame = renderMatrixFrame(
      profileWith(effects),
      snapshot({ gear: 3, spotterCarRight: true } as Partial<TelemetrySnapshot>),
      0
    )
    expect(frame[0][0]).toEqual({ r: 0, g: 120, b: 212 }) // #0078D4 active overrides
  })

  // R21-2: deleting a MIDDLE effect leaves a gapped-but-unique set (0,2,3); the
  // recompaction must restore a contiguous 0..N-1 while preserving visual order.
  it('ensureUniqueEffectPriorities recompacts a gapped-but-unique set, preserving order', () => {
    // Simulate the post-delete state: priorities 0,2,3 (the original priority-1 was
    // removed). Effects are listed in array order with those priorities.
    const top = solidStatic('#111111', 0)
    const mid = solidStatic('#222222', 2)
    const bottom = solidStatic('#333333', 3)
    const out = ensureUniqueEffectPriorities([top, mid, bottom])
    // Contiguous 0..N-1, and the visual order (0 < 2 < 3) is preserved.
    expect(out.find((e) => e.id === top.id)?.priority).toBe(0)
    expect(out.find((e) => e.id === mid.id)?.priority).toBe(1)
    expect(out.find((e) => e.id === bottom.id)?.priority).toBe(2)
  })

  it('ensureUniqueEffectPriorities is a no-op (same reference) when already contiguous 0..N-1', () => {
    const contiguous = [solidStatic('#111111', 0), solidStatic('#222222', 1), solidStatic('#333333', 2)]
    expect(ensureUniqueEffectPriorities(contiguous)).toBe(contiguous)
  })
})


describe('frame animation helpers', () => {
  function grid(hex: string): string[][] {
    const out = emptyMatrixHexGrid()
    out[0][0] = hex
    return out
  }

  it('selects loop frames by duration', () => {
    const effect = createRgbMatrixEffect('static')
    effect.frames = [
      { id: 'a', durationMs: 100, grid: grid('#111111') },
      { id: 'b', durationMs: 200, grid: grid('#222222') }
    ]
    effect.loopMode = 'loop'
    expect(selectAnimationFrame(effect, 50)?.id).toBe('a')
    expect(selectAnimationFrame(effect, 150)?.id).toBe('b')
    expect(selectAnimationFrame(effect, 350)?.id).toBe('a')
  })

  it('supports ping-pong without double-counting endpoints, once and speed multiplier', () => {
    const effect = createRgbMatrixEffect('static')
    effect.frames = [
      { id: 'a', durationMs: 100, grid: grid('#111111') },
      { id: 'b', durationMs: 100, grid: grid('#222222') },
      { id: 'c', durationMs: 100, grid: grid('#333333') }
    ]
    effect.loopMode = 'pingpong'
    expect(selectAnimationFrame(effect, 50)?.id).toBe('a')
    expect(selectAnimationFrame(effect, 150)?.id).toBe('b')
    expect(selectAnimationFrame(effect, 250)?.id).toBe('c')
    expect(selectAnimationFrame(effect, 350)?.id).toBe('b')
    expect(selectAnimationFrame(effect, 450)?.id).toBe('a')
    effect.loopMode = 'once'
    expect(selectAnimationFrame(effect, 500)?.id).toBe('c')
    effect.loopMode = 'loop'
    effect.speed = 2
    expect(selectAnimationFrame(effect, 75)?.id).toBe('b')
  })

  it('uses activation-relative elapsed for once animations and replays after reset', () => {
    const effect = createRgbMatrixEffect('static')
    effect.forceActivation = true
    effect.loopMode = 'once'
    effect.frames = [
      { id: 'start', durationMs: 100, grid: grid('#111111') },
      { id: 'end', durationMs: 100, grid: grid('#222222') }
    ]
    const profile: RgbMatrixProfile = { version: 2, layout: defaultMatrixLayout(), effects: [effect] }
    let elapsed = 50
    let frame = renderMatrixFrame(profile, snapshot({}), 1_700_000_000_000, { elapsedMsForEffect: () => elapsed })
    expect(rgbToHex(frame[0][0])).toBe('#111111')
    elapsed = 250
    frame = renderMatrixFrame(profile, snapshot({}), 1_700_000_000_250, { elapsedMsForEffect: () => elapsed })
    expect(rgbToHex(frame[0][0])).toBe('#222222')
    elapsed = 0
    frame = renderMatrixFrame(profile, snapshot({}), 1_700_000_001_000, { elapsedMsForEffect: () => elapsed })
    expect(rgbToHex(frame[0][0])).toBe('#111111')
  })

  it('applies blink off, alt color, alt frames and color cycling', () => {
    const effect = createRgbMatrixEffect('static')
    const base = grid('#ffffff')
    effect.blink = { enabled: true, onMs: 100, offMs: 100 }
    expect(applyBlinkPhase(effect, 150, base)[0][0]).toBe('#000000')
    effect.blink = { enabled: true, onMs: 100, offMs: 100, altColor: '#ff0000' }
    expect(applyBlinkPhase(effect, 150, base)[0][0]).toBe('#ff0000')
    effect.blink = { enabled: true, onMs: 100, offMs: 100, altFrames: [{ id: 'alt', durationMs: 100, grid: grid('#00ff00') }] }
    expect(applyBlinkPhase(effect, 150, base)[0][0]).toBe('#00ff00')
    effect.blink = { enabled: true, onMs: 100, offMs: 100, animateColors: true }
    expect(applyBlinkPhase(effect, 150, base)[0][0]).not.toBe('#000000')
  })

  it('migrates legacy blinking to the second color instead of black', () => {
    const effect = createRgbMatrixEffect('static')
    effect.forceActivation = true
    effect.colors.active = '#123456'
    effect.colors.blink = '#abcdef'
    delete (effect as unknown as Record<string, unknown>).blink
    effect.behaviour = { blinking: true, blinkMode: 'onOffDelay', blinkDelayMs: 100, blinkOnDelayMs: 100, blinkOffDelayMs: 100 }
    const normalized = normalizeRgbMatrixEffect(effect) as typeof effect
    const frame = renderMatrixFrame({ version: 2, layout: defaultMatrixLayout(), effects: [normalized] }, snapshot({}), 150)
    expect(rgbToHex(frame[0][0])).toBe('#abcdef')
  })

  it('keeps legacy yellow and blue flags auto-blinking', () => {
    const flags = createRgbMatrixEffect('flags') as RgbMatrixFlagsEffect
    flags.mode = 'currentFlag'
    const profile: RgbMatrixProfile = { version: 2, layout: defaultMatrixLayout(), effects: [flags] }
    const onFrame = renderMatrixFrame(profile, snapshot({ flags: { ...ALL_FLAGS_OFF, yellow: true } }), 50)
    const offFrame = renderMatrixFrame(profile, snapshot({ flags: { ...ALL_FLAGS_OFF, yellow: true } }), 350)
    expect(rgbToHex(onFrame[0][0])).toBe('#ffd400')
    expect(rgbToHex(offFrame[0][0])).toBe('#000000')
  })

  it('applies redline hysteresis around the shift threshold', () => {
    expect(selectRedlineReachedWithHysteresis(0.971, false)).toBe(true)
    expect(selectRedlineReachedWithHysteresis(0.95, true)).toBe(true)
    expect(selectRedlineReachedWithHysteresis(0.929, true)).toBe(false)
    expect(selectRedlineReachedWithHysteresis(0.95, false)).toBe(false)
  })

  it('selects gear number color on redline', () => {
    const gear = createRgbMatrixEffect('gear') as RgbMatrixGearEffect
    gear.numberColor = '#123456'
    gear.redlineNumberColor = '#ff0000'
    expect(selectGearNumberColor(gear, false)).toBe('#123456')
    expect(selectGearNumberColor(gear, true)).toBe('#ff0000')
  })

  it('migrates legacy pixel frames into grid frames', () => {
    const legacy = createRgbMatrixEffect('animation') as unknown as Record<string, unknown>
    legacy.frames = [{ id: 'old', durationMs: 123, pixels: grid('#abcdef') }]
    const normalized = normalizeRgbMatrixEffect(legacy as unknown as RgbMatrixEffect) as RgbMatrixAnimationEffect
    expect(normalized.frames[0].grid[0][0]).toBe('#abcdef')
    expect(normalized.frames[0].pixels?.[0][0]).toBe('#abcdef')
  })

  it('wraps a legacy top-level single grid as a one-frame animation', () => {
    const legacy = createRgbMatrixEffect('static') as unknown as Record<string, unknown>
    legacy.grid = grid('#fedcba')
    const normalized = normalizeRgbMatrixEffect(legacy as unknown as RgbMatrixEffect)
    expect(normalized.kind !== 'group' && normalized.frames?.[0].grid[0][0]).toBe('#fedcba')
  })
})

describe('per-flag / per-gear animations', () => {
  function grid(hex: string, x = 0, y = 0): string[][] {
    const out = emptyMatrixHexGrid()
    out[y][x] = hex
    return out
  }
  function frame(hex: string, durationMs = 100): { id: string; durationMs: number; grid: string[][] } {
    return { id: `f-${hex}`, durationMs, grid: grid(hex) }
  }

  describe('selection + migration helpers', () => {
    it('selectFlagAnimation migrates a single customPattern grid to a one-frame animation', () => {
      const flags = createRgbMatrixEffect('flags') as RgbMatrixFlagsEffect
      flags.mode = 'custom'
      flags.customPatterns = { blue: grid('#abcdef', 3, 2) }
      const anim = selectFlagAnimation(flags, 'blue')
      expect(anim?.frames.length).toBe(1)
      expect(anim?.frames[0].grid[2][3]).toBe('#abcdef')
    })

    it('selectFlagAnimation prefers an explicit per-flag animation over the legacy grid', () => {
      const flags = createRgbMatrixEffect('flags') as RgbMatrixFlagsEffect
      flags.mode = 'custom'
      flags.customPatterns = { green: grid('#111111') }
      flags.flagAnimations = { green: { frames: [frame('#222222'), frame('#333333')], loopMode: 'loop', speed: 1 } }
      const anim = selectFlagAnimation(flags, 'green')
      expect(anim?.frames.length).toBe(2)
      expect(anim?.frames[0].grid[0][0]).toBe('#222222')
    })

    it('selectFlagAnimation returns null when neither a grid nor animation exists', () => {
      const flags = createRgbMatrixEffect('flags') as RgbMatrixFlagsEffect
      flags.mode = 'custom'
      expect(selectFlagAnimation(flags, 'red')).toBeNull()
    })

    it('selectGearAnimation migrates a single customGlyph grid and prefers an explicit animation', () => {
      const gear = createRgbMatrixEffect('gear') as RgbMatrixGearEffect
      gear.mode = 'custom'
      gear.customGlyphs = { '5': grid('#0f0f0f', 1, 1) }
      const migrated = selectGearAnimation(gear, '5')
      expect(migrated?.frames.length).toBe(1)
      expect(migrated?.frames[0].grid[1][1]).toBe('#0f0f0f')
      gear.gearAnimations = { '5': { frames: [frame('#a0a0a0'), frame('#b0b0b0')], loopMode: 'once', speed: 1 } }
      expect(selectGearAnimation(gear, '5')?.frames.length).toBe(2)
    })

    it('gridToEffectAnimation wraps a grid and drops a malformed one', () => {
      expect(gridToEffectAnimation(buildFlagHexGrid('green'))?.frames.length).toBe(1)
      expect(gridToEffectAnimation([['#fff']])).toBeNull()
      expect(gridToEffectAnimation(undefined)).toBeNull()
    })

    it('createEffectAnimation seeds a one-frame loop from a grid', () => {
      const anim = createEffectAnimation(grid('#abc123'))
      expect(anim.frames.length).toBe(1)
      expect(anim.loopMode).toBe('loop')
      expect(anim.frames[0].grid[0][0]).toBe('#abc123')
    })

    it('normalizeRgbEffectAnimation normalizes loop/speed/blink and drops empty frames', () => {
      const normalized = normalizeRgbEffectAnimation({ frames: [frame('#010203', 80)], loopMode: 'pingpong', speed: 99, blink: { enabled: true, onMs: 120, offMs: 60 } })
      expect(normalized?.loopMode).toBe('pingpong')
      expect(normalized?.speed).toBe(8) // clamped to max
      expect(normalized?.blink?.enabled).toBe(true)
      expect(normalizeRgbEffectAnimation({ frames: [] })).toBeNull()
      expect(normalizeRgbEffectAnimation(undefined)).toBeNull()
    })
  })

  describe('normalization on the effect', () => {
    it('keeps valid flag/gear animations and drops malformed ones', () => {
      const flags = createRgbMatrixEffect('flags') as RgbMatrixFlagsEffect
      flags.mode = 'custom'
      ;(flags as unknown as Record<string, unknown>).flagAnimations = {
        yellow: { frames: [frame('#0a0b0c', 90)], loopMode: 'pingpong', speed: 2 },
        blue: { frames: [] }
      }
      const normalized = normalizeRgbMatrixEffect(flags) as RgbMatrixFlagsEffect
      expect(normalized.flagAnimations?.yellow?.loopMode).toBe('pingpong')
      expect(normalized.flagAnimations?.yellow?.speed).toBe(2)
      expect(normalized.flagAnimations?.yellow?.frames[0].pixels?.[0][0]).toBe('#0a0b0c')
      expect(normalized.flagAnimations?.blue).toBeUndefined()
    })

    it('leaves flag/gear animations absent when none are configured', () => {
      const gear = normalizeRgbMatrixEffect(createRgbMatrixEffect('gear')) as RgbMatrixGearEffect
      expect(gear.gearAnimations).toBeUndefined()
    })
  })

  describe('rendering (back-compat + per-scope clock)', () => {
    it('renders a legacy single-grid customPattern identically (auto 1-frame migration)', () => {
      const flags = createRgbMatrixEffect('flags') as RgbMatrixFlagsEffect
      flags.mode = 'custom'
      flags.customPatterns = { green: grid('#00ff00', 4, 4) }
      const profile: RgbMatrixProfile = { version: 2, layout: defaultMatrixLayout(), effects: [flags] }
      const frameOut = renderMatrixFrame(profile, snapshot({ flags: { ...ALL_FLAGS_OFF, green: true } }), 0, { greenFlashActive: true })
      expect(rgbToHex(frameOut[4][4])).toBe('#00ff00')
    })

    it('detects the meatball flag and renders its per-flag pattern', () => {
      const flags = createRgbMatrixEffect('flags') as RgbMatrixFlagsEffect
      flags.mode = 'custom'
      flags.customPatterns = { meatball: grid('#ff6a00', 0, 0) }
      const profile: RgbMatrixProfile = { version: 2, layout: defaultMatrixLayout(), effects: [flags] }
      const frameOut = renderMatrixFrame(profile, snapshot({ flags: { ...ALL_FLAGS_OFF, meatball: true } }), 0)
      expect(rgbToHex(frameOut[0][0])).toBe('#ff6a00')
    })

    it('plays a per-flag animation selected by its own per-flag clock', () => {
      const flags = createRgbMatrixEffect('flags') as RgbMatrixFlagsEffect
      flags.mode = 'custom'
      flags.flagAnimations = { green: { frames: [frame('#111111'), frame('#222222')], loopMode: 'loop', speed: 1 } }
      const profile: RgbMatrixProfile = { version: 2, layout: defaultMatrixLayout(), effects: [flags] }
      const seenKeys: string[] = []
      let scopeElapsed = 50
      const options: RgbMatrixRenderOptions = {
        greenFlashActive: true,
        elapsedMsForAnimationScope: (_effect, scope, key) => {
          seenKeys.push(`${scope}:${key}`)
          return scope === 'flag' && key === 'green' ? scopeElapsed : 0
        }
      }
      let frameOut = renderMatrixFrame(profile, snapshot({ flags: { ...ALL_FLAGS_OFF, green: true } }), 0, options)
      expect(rgbToHex(frameOut[0][0])).toBe('#111111')
      expect(seenKeys).toContain('flag:green')
      scopeElapsed = 150
      frameOut = renderMatrixFrame(profile, snapshot({ flags: { ...ALL_FLAGS_OFF, green: true } }), 0, options)
      expect(rgbToHex(frameOut[0][0])).toBe('#222222')
    })

    it('plays a per-gear-label animation on its own clock and replays a once animation on re-activation', () => {
      const gear = createRgbMatrixEffect('gear') as RgbMatrixGearEffect
      gear.mode = 'custom'
      gear.gearAnimations = { '4': { frames: [frame('#101010'), frame('#202020')], loopMode: 'once', speed: 1 } }
      const profile: RgbMatrixProfile = { version: 2, layout: defaultMatrixLayout(), effects: [gear] }
      let scopeElapsed = 50
      const options: RgbMatrixRenderOptions = {
        elapsedMsForAnimationScope: (_effect, scope, key) => (scope === 'gear' && key === '4' ? scopeElapsed : 0)
      }
      let frameOut = renderMatrixFrame(profile, snapshot({ gear: 4 }), 0, options)
      expect(rgbToHex(frameOut[0][0])).toBe('#101010')
      scopeElapsed = 250
      frameOut = renderMatrixFrame(profile, snapshot({ gear: 4 }), 0, options)
      expect(rgbToHex(frameOut[0][0])).toBe('#202020') // once → holds last frame
      scopeElapsed = 0 // re-activation resets the per-gear clock
      frameOut = renderMatrixFrame(profile, snapshot({ gear: 4 }), 0, options)
      expect(rgbToHex(frameOut[0][0])).toBe('#101010')
    })

    it('uses different clocks for different gear labels', () => {
      const gear = createRgbMatrixEffect('gear') as RgbMatrixGearEffect
      gear.mode = 'custom'
      gear.gearAnimations = {
        '3': { frames: [frame('#aa0000'), frame('#bb0000')], loopMode: 'loop', speed: 1 },
        '4': { frames: [frame('#00aa00'), frame('#00bb00')], loopMode: 'loop', speed: 1 }
      }
      const profile: RgbMatrixProfile = { version: 2, layout: defaultMatrixLayout(), effects: [gear] }
      const elapsedByKey: Record<string, number> = { 'gear:3': 50, 'gear:4': 150 }
      const options: RgbMatrixRenderOptions = {
        elapsedMsForAnimationScope: (_effect, scope, key) => elapsedByKey[`${scope}:${key}`] ?? 0
      }
      expect(rgbToHex(renderMatrixFrame(profile, snapshot({ gear: 3 }), 0, options)[0][0])).toBe('#aa0000')
      expect(rgbToHex(renderMatrixFrame(profile, snapshot({ gear: 4 }), 0, options)[0][0])).toBe('#00bb00')
    })

    it('applies a per-flag animation blink on the per-flag clock', () => {
      const flags = createRgbMatrixEffect('flags') as RgbMatrixFlagsEffect
      flags.mode = 'custom'
      flags.flagAnimations = {
        green: { frames: [frame('#ffffff')], loopMode: 'loop', speed: 1, blink: { enabled: true, onMs: 100, offMs: 100, altColor: '#ff0000' } }
      }
      const profile: RgbMatrixProfile = { version: 2, layout: defaultMatrixLayout(), effects: [flags] }
      const options: RgbMatrixRenderOptions = { greenFlashActive: true, elapsedMsForAnimationScope: () => 150 } // OFF phase
      const frameOut = renderMatrixFrame(profile, snapshot({ flags: { ...ALL_FLAGS_OFF, green: true } }), 0, options)
      expect(rgbToHex(frameOut[0][0])).toBe('#ff0000')
    })
  })
})

describe('grid builders', () => {
  it('buildGearGlyphHexGrid returns an 8x8 grid with lit pixels', () => {
    const grid = buildGearGlyphHexGrid('3', '#ffb000')
    expect(grid.length).toBe(RGB_MATRIX_SIZE)
    expect(grid[0].length).toBe(RGB_MATRIX_SIZE)
    expect(grid.flat().some((c) => c.toLowerCase() === '#ffb000')).toBe(true)
  })

  it('buildFlagHexGrid fills a solid colour', () => {
    const grid = buildFlagHexGrid('red')
    expect(isValidHexGrid(grid)).toBe(true)
    expect(grid.flat().every((c) => c === grid[0][0])).toBe(true)
  })
})

describe('flags prevail over the gear', () => {
  // A flags + gear stack matching the default profile. The gear digit uses a
  // MAGENTA sentinel (#ff00ff) that matches NO flag fill colour, so its presence
  // unambiguously means "the gear drew" (e.g. blue flag is #0078d4, the old gear
  // colour, which would otherwise be a false positive).
  const GEAR_SENTINEL = '#ff00ff'
  function flagsGearProfile(flagOverrides?: Partial<RgbMatrixFlagsEffect>): RgbMatrixProfile {
    const flags = createRgbMatrixEffect('flags') as RgbMatrixFlagsEffect
    Object.assign(flags, flagOverrides)
    const gear = createRgbMatrixEffect('gear') as RgbMatrixGearEffect
    gear.numberColor = GEAR_SENTINEL
    return { version: 2, layout: defaultMatrixLayout(), effects: [flags, gear] }
  }

  it('suppresses the gear when a caution (yellow) flag is active', () => {
    const profile = flagsGearProfile()
    // timeMs=50 is the ON phase of the yellow auto-blink, so the flag is painted.
    const frame = renderMatrixFrame(profile, snapshot({ gear: 3, flags: { ...ALL_FLAGS_OFF, yellow: true } }), 50)
    const colors = new Set(frame.flat().map((c) => rgbToHex(c).toLowerCase()))
    expect(colors.has('#ffd400')).toBe(true) // yellow flag fills the panel
    expect(colors.has(GEAR_SENTINEL)).toBe(false) // the gear digit is gone
  })

  it('suppresses the gear for every caution flag but never for green', () => {
    const caution: Array<Partial<Flags>> = [
      { yellow: true },
      { blue: true },
      { white: true },
      { red: true },
      { black: true },
      { meatball: true },
      { checkered: true }
    ]
    for (const flags of caution) {
      const frame = renderMatrixFrame(flagsGearProfile(), snapshot({ gear: 3, flags: { ...ALL_FLAGS_OFF, ...flags } }), 50)
      const colors = new Set(frame.flat().map((c) => rgbToHex(c).toLowerCase()))
      expect(colors.has(GEAR_SENTINEL)).toBe(false)
    }
    // Green keeps the gear visible (normal racing) and, outside the flash window,
    // paints no green panel behind it.
    const green = renderMatrixFrame(flagsGearProfile(), snapshot({ gear: 3, flags: { ...ALL_FLAGS_OFF, green: true } }), 0)
    const greenColors = new Set(green.flat().map((c) => rgbToHex(c).toLowerCase()))
    expect(greenColors.has(GEAR_SENTINEL)).toBe(true) // gear digit survives
    expect(greenColors.has('#21a366')).toBe(false) // green NOT painted (only during the flash)
  })

  it('GREEN FLASH: during the flash window green prevails — gear hidden, green painted', () => {
    const frame = renderMatrixFrame(flagsGearProfile(), snapshot({ gear: 3, flags: { ...ALL_FLAGS_OFF, green: true } }), 0, { greenFlashActive: true })
    const colors = new Set(frame.flat().map((c) => rgbToHex(c).toLowerCase()))
    expect(colors.has(GEAR_SENTINEL)).toBe(false) // gear hidden during the flash
    expect(colors.has('#21a366')).toBe(true) // green flag fills the panel
  })

  it('GREEN FLASH off: green keeps the gear and paints nothing', () => {
    const frame = renderMatrixFrame(flagsGearProfile(), snapshot({ gear: 3, flags: { ...ALL_FLAGS_OFF, green: true } }), 0, { greenFlashActive: false })
    const colors = new Set(frame.flat().map((c) => rgbToHex(c).toLowerCase()))
    expect(colors.has(GEAR_SENTINEL)).toBe(true) // gear visible
    expect(colors.has('#21a366')).toBe(false) // green not painted
  })

  it('GREEN FLASH does not affect caution flags — yellow still prevails regardless', () => {
    const frame = renderMatrixFrame(flagsGearProfile(), snapshot({ gear: 3, flags: { ...ALL_FLAGS_OFF, yellow: true } }), 50, { greenFlashActive: false })
    const colors = new Set(frame.flat().map((c) => rgbToHex(c).toLowerCase()))
    expect(colors.has(GEAR_SENTINEL)).toBe(false) // yellow suppresses the gear independent of greenFlash
  })

  it('honours hideGearWhenFlagActive=false (opt-out keeps the gear on top of a caution flag)', () => {
    const profile = flagsGearProfile({ hideGearWhenFlagActive: false })
    const frame = renderMatrixFrame(profile, snapshot({ gear: 3, flags: { ...ALL_FLAGS_OFF, red: true } }), 0)
    const colors = new Set(frame.flat().map((c) => rgbToHex(c).toLowerCase()))
    expect(colors.has(GEAR_SENTINEL)).toBe(true) // gear still composited on top
    expect(colors.has('#e81123')).toBe(true) // red flag behind it
  })

  it('does not hide the gear when the flags effect is disabled (nothing to prevail with)', () => {
    const flags = createRgbMatrixEffect('flags') as RgbMatrixFlagsEffect
    flags.enabled = false
    const gear = createRgbMatrixEffect('gear') as RgbMatrixGearEffect
    gear.numberColor = GEAR_SENTINEL
    const profile: RgbMatrixProfile = { version: 2, layout: defaultMatrixLayout(), effects: [flags, gear] }
    const frame = renderMatrixFrame(profile, snapshot({ gear: 3, flags: { ...ALL_FLAGS_OFF, yellow: true } }), 50)
    const colors = new Set(frame.flat().map((c) => rgbToHex(c).toLowerCase()))
    expect(colors.has(GEAR_SENTINEL)).toBe(true)
  })

  it('does NOT suppress the gear when the flags effect sits in an INACTIVE conditional group', () => {
    // A flags effect buried in a group whose condition is false paints nothing —
    // it must not blank the gear and leave an empty panel.
    const flags = createRgbMatrixEffect('flags') as RgbMatrixFlagsEffect
    const group = createRgbMatrixGroup({ kind: 'inPitLane' }) // active only on pit road
    group.effects = [flags]
    const gear = createRgbMatrixEffect('gear') as RgbMatrixGearEffect
    gear.numberColor = GEAR_SENTINEL
    const profile: RgbMatrixProfile = { version: 2, layout: defaultMatrixLayout(), effects: [group, gear] }

    // Caution flag up but the car is NOT on pit road → group inactive, flag never
    // paints, so the gear must STAY visible.
    const offTrack = renderMatrixFrame(profile, snapshot({ gear: 3, onPitRoad: false, flags: { ...ALL_FLAGS_OFF, yellow: true } }), 50)
    const offColors = new Set(offTrack.flat().map((c) => rgbToHex(c).toLowerCase()))
    expect(offColors.has(GEAR_SENTINEL)).toBe(true)

    // On pit road the group is active → the flag prevails and the gear is hidden.
    const onPit = renderMatrixFrame(profile, snapshot({ gear: 3, onPitRoad: true, flags: { ...ALL_FLAGS_OFF, yellow: true } }), 50)
    const onColors = new Set(onPit.flat().map((c) => rgbToHex(c).toLowerCase()))
    expect(onColors.has(GEAR_SENTINEL)).toBe(false)
    expect(onColors.has('#ffd400')).toBe(true) // yellow flag fills the panel
  })

  it('still suppresses the gear for a top-level (always-active) flags effect', () => {
    const frame = renderMatrixFrame(flagsGearProfile(), snapshot({ gear: 3, flags: { ...ALL_FLAGS_OFF, yellow: true } }), 50)
    const colors = new Set(frame.flat().map((c) => rgbToHex(c).toLowerCase()))
    expect(colors.has(GEAR_SENTINEL)).toBe(false)
  })

  it('normalizes a missing hideGearWhenFlagActive to true (back-compat default)', () => {
    const legacy = createRgbMatrixEffect('flags') as RgbMatrixFlagsEffect
    delete (legacy as unknown as Record<string, unknown>).hideGearWhenFlagActive
    const normalized = normalizeRgbMatrixEffect(legacy) as RgbMatrixFlagsEffect
    expect(normalized.hideGearWhenFlagActive).toBe(true)
    // The default profile's flags effect opts in out of the box.
    const fromDefault = defaultRgbMatrixProfile().effects.find((e) => e.kind === 'flags') as RgbMatrixFlagsEffect
    expect(fromDefault.hideGearWhenFlagActive).toBe(true)
  })
})

describe('yellow auto-blink never reveals the gear', () => {
  const GEAR_SENTINEL = '#ff00ff'
  it('keeps the gear hidden in BOTH the ON and OFF phases of the yellow blink', () => {
    const flags = createRgbMatrixEffect('flags') as RgbMatrixFlagsEffect
    const gear = createRgbMatrixEffect('gear') as RgbMatrixGearEffect
    gear.numberColor = GEAR_SENTINEL
    const profile: RgbMatrixProfile = { version: 2, layout: defaultMatrixLayout(), effects: [flags, gear] }
    const snap = snapshot({ gear: 3, flags: { ...ALL_FLAGS_OFF, yellow: true } })

    // ON phase (timeMs=50): yellow fills the panel, no gear bleed-through.
    const onColors = new Set(renderMatrixFrame(profile, snap, 50).flat().map((c) => rgbToHex(c).toLowerCase()))
    expect(onColors.has('#ffd400')).toBe(true)
    expect(onColors.has(GEAR_SENTINEL)).toBe(false)

    // OFF phase (timeMs=350): the FLAG blinks off (panel dark). The gear must NOT
    // appear — this was the bug where the gear digit bled through during OFF.
    const offColors = new Set(renderMatrixFrame(profile, snap, 350).flat().map((c) => rgbToHex(c).toLowerCase()))
    expect(offColors.has(GEAR_SENTINEL)).toBe(false)
    expect(offColors.size).toBe(1) // entirely off (flag dim/off, gear hidden)
    expect(offColors.has('#000000')).toBe(true)
  })

  it('renders a configured per-flag yellow animation in the CORRECT colour (no gear/GRB bleed)', () => {
    const flags = createRgbMatrixEffect('flags') as RgbMatrixFlagsEffect
    flags.mode = 'custom'
    const yellow = emptyMatrixHexGrid()
    yellow[0][0] = '#ffd400'
    flags.flagAnimations = { yellow: createEffectAnimation(yellow) }
    const gear = createRgbMatrixEffect('gear') as RgbMatrixGearEffect
    gear.numberColor = GEAR_SENTINEL
    const profile: RgbMatrixProfile = { version: 2, layout: defaultMatrixLayout(), effects: [flags, gear] }
    const frame = renderMatrixFrame(profile, snapshot({ gear: 3, flags: { ...ALL_FLAGS_OFF, yellow: true } }), 0)
    // The user's configured yellow renders; the gear (magenta) is suppressed.
    expect(rgbToHex(frame[0][0])).toBe('#ffd400')
    const colors = new Set(frame.flat().map((c) => rgbToHex(c).toLowerCase()))
    expect(colors.has(GEAR_SENTINEL)).toBe(false)
  })
})

describe('orientation / layout mapping (single source of rotation)', () => {
  it('encodes the wire layout byte exactly like the firmware bitfield', () => {
    expect(wireLayoutByte({ serpentine: false, rotation: 0, flipX: false, flipY: false })).toBe(0x00)
    expect(wireLayoutByte({ serpentine: true, rotation: 0, flipX: false, flipY: false })).toBe(0x01)
    expect(wireLayoutByte({ serpentine: false, rotation: 90, flipX: false, flipY: false })).toBe(0x02)
    expect(wireLayoutByte({ serpentine: false, rotation: 180, flipX: false, flipY: false })).toBe(0x04)
    expect(wireLayoutByte({ serpentine: false, rotation: 270, flipX: false, flipY: false })).toBe(0x06)
    expect(wireLayoutByte({ serpentine: false, rotation: 0, flipX: true, flipY: false })).toBe(0x08)
    expect(wireLayoutByte({ serpentine: false, rotation: 0, flipX: false, flipY: true })).toBe(0x10)
    expect(wireLayoutByte({ serpentine: true, rotation: 90, flipX: true, flipY: true })).toBe(0x01 | 0x02 | 0x08 | 0x10)
  })

  it('drives an IDENTITY layout byte (0x00) when a manual customMap is active', () => {
    const map = Array.from({ length: RGB_MATRIX_SIZE * RGB_MATRIX_SIZE }, (_, i) => i)
    expect(wireLayoutByte({ serpentine: true, rotation: 90, flipX: true, flipY: true, customMap: map })).toBe(0)
  })

  it('rotation 0 / no serpentine / no flip is the identity logical→physical mapping', () => {
    const layout = { serpentine: false, rotation: 0 as const, flipX: false, flipY: false }
    for (let y = 0; y < RGB_MATRIX_SIZE; y += 1) {
      for (let x = 0; x < RGB_MATRIX_SIZE; x += 1) {
        expect(physicalIndexForXY(layout, x, y)).toBe(y * RGB_MATRIX_SIZE + x)
      }
    }
  })

  it('is a bijection for every rotation (every physical LED is written → no stale column)', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      for (const serpentine of [false, true]) {
        const layout = { serpentine, rotation, flipX: false, flipY: false }
        const seen = new Set<number>()
        for (let y = 0; y < RGB_MATRIX_SIZE; y += 1) {
          for (let x = 0; x < RGB_MATRIX_SIZE; x += 1) {
            const idx = physicalIndexForXY(layout, x, y)
            expect(idx).toBeGreaterThanOrEqual(0)
            expect(idx).toBeLessThan(RGB_MATRIX_SIZE * RGB_MATRIX_SIZE)
            seen.add(idx)
          }
        }
        expect(seen.size).toBe(RGB_MATRIX_SIZE * RGB_MATRIX_SIZE)
      }
    }
  })

  it('maps a known glyph upright via a 90° layout exactly like the firmware xyToIndex', () => {
    // Firmware 90°: px = H-1-y, py = x → index = x*8 + (7-y). The app replica must
    // agree so the preview/calibration "F" lands where the firmware paints it.
    const layout = { serpentine: false, rotation: 90 as const, flipX: false, flipY: false }
    expect(physicalIndexForXY(layout, 0, 0)).toBe(7) // logical top-left → physical (row0,col7)
    expect(physicalIndexForXY(layout, 7, 0)).toBe(63) // logical top-right → physical (row7,col7)
    expect(physicalIndexForXY(layout, 0, 7)).toBe(0) // logical bottom-left → physical (row0,col0)
    expect(physicalIndexForXY(layout, 7, 7)).toBe(56) // logical bottom-right → physical (row7,col0)
  })
})

describe('shiftIndicatorLevel (rev-lights consumer reads the snapshot, never recomputes)', () => {
  it('prefers shiftIndicatorPct, then revLights.pct, then the redline band, else 0', () => {
    expect(shiftIndicatorLevel(snapshot({ shiftIndicatorPct: 0.42, revLights: { pct: 0.9 }, rpm: 8000, maxRpm: 8000 }))).toBeCloseTo(0.42)
    expect(shiftIndicatorLevel(snapshot({ revLights: { pct: 0.8 }, rpm: 8000, maxRpm: 8000 }))).toBeCloseTo(0.8)
    // Fallback is the redline-relative TOP-SLICE band (redlineBandPct), NOT a raw
    // rpm/maxRpm fill: idle stays dark and only the top of the range lights up.
    expect(shiftIndicatorLevel(snapshot({ rpm: 4000, maxRpm: 8000 }))).toBe(0) // idle (4000/8000=0.5 would be wrong)
    expect(shiftIndicatorLevel(snapshot({ rpm: 7640, maxRpm: 8000 }))).toBeCloseTo(0.5, 5) // midband (start 7360, end 7920)
    expect(shiftIndicatorLevel(snapshot({ rpm: 7920, maxRpm: 8000 }))).toBe(1) // at/after band end
    expect(shiftIndicatorLevel(null)).toBe(0)
  })
})
