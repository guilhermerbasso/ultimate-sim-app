import type { Flags, SimId, TelemetrySnapshot } from './telemetry'
import { redlineBandPct, resolveShiftNow } from './revlights'

export const RGB_MATRIX_SIZE = 8
export const RGB_MATRIX_PROFILE_VERSION = 2

// Per-effect brightness is an 8-bit scale (0–255); 255 = full / unchanged. Each
// effect's rendered colour is multiplied by brightness/255 before it is
// composited into the SINGLE frame streamed to the firmware (no protocol change).
export const RGB_MATRIX_FULL_BRIGHTNESS = 255

// Gear digits the iFlag can show (R, N, 0–9) — also the keys of a gear effect's
// per-label custom glyph map.
export type GearLabel = 'R' | 'N' | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
export const GEAR_LABELS: readonly GearLabel[] = ['R', 'N', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

// Race flags the iFlag can show — the keys of a flags effect's per-flag custom
// pattern / animation map.
export type FlagName = 'green' | 'yellow' | 'blue' | 'white' | 'red' | 'black' | 'meatball' | 'checkered'
export const FLAG_NAMES: readonly FlagName[] = ['green', 'yellow', 'blue', 'white', 'red', 'black', 'meatball', 'checkered']

export interface RgbColor {
  r: number
  g: number
  b: number
}

export type RgbFrame = RgbColor[][]
export type HexGrid = string[][]
export type RgbAnimationLoopMode = 'loop' | 'pingpong' | 'once'


export interface RgbMatrixProfile {
  version: number
  layout: MatrixLayout
  effects: RgbMatrixEffect[]
}

export type MatrixRotation = 0 | 90 | 180 | 270

// Physical wiring of an 8x8 panel. Mirrors the iFlag firmware layout byte so the
// app and the device agree on the logical→physical mapping without recompiling.
export interface MatrixLayout {
  // Odd physical rows are wired right→left (boustrophedon). Most cheap panels.
  serpentine: boolean
  // Panel rotation relative to the app preview (top-left = logical origin).
  rotation: MatrixRotation
  // Mirror logical columns / rows before rotation (covers the remaining wiring
  // orientations, e.g. DIN entering from the opposite corner).
  flipX: boolean
  flipY: boolean
  // Optional advanced fallback for panels whose wiring matches NO
  // serpentine/rotation/flip combination (e.g. composite 4×4 tiles, diagonal
  // zig-zag). A 64-entry permutation mapping a LOGICAL pixel index (row-major,
  // top-left origin) → the PHYSICAL LED index that should display it. When set
  // (and valid), the app pre-maps every frame to physical order and drives the
  // device with an IDENTITY layout byte (0x00) so the firmware's xyToIndex is a
  // no-op (index == y*8+x) and the custom permutation alone decides the wiring.
  // See wireLayoutByte / applyCustomMapToHexRows below.
  customMap?: number[]
}

export const MATRIX_ROTATIONS: readonly MatrixRotation[] = [0, 90, 180, 270]

// Total LEDs in the 8×8 panel; also the required length of a customMap.
export const RGB_MATRIX_LED_COUNT = RGB_MATRIX_SIZE * RGB_MATRIX_SIZE

// Layout byte bitfield — must stay in sync with companion_iflag.ino.
const LAYOUT_SERP = 0x01
const LAYOUT_ROT_SHIFT = 1
const LAYOUT_FLIPX = 0x08
const LAYOUT_FLIPY = 0x10

// Default = serpentine ON, no rotation, no flips — the SimHub "Serpentine
// layout" convention (start top-left, row 0 left→right, every odd physical row
// reversed). This matches the overwhelming majority of cheap 8x8 WS2812B panels
// (the same wiring SimHub drives), so flags/gears render correctly out of the
// box. Progressive and the other orientations are reachable from the calibration
// UI, and the chosen layout is persisted + auto-applied.
export function defaultMatrixLayout(): MatrixLayout {
  return { serpentine: true, rotation: 0, flipX: false, flipY: false }
}

function rotationToIndex(rotation: MatrixRotation): number {
  switch (rotation) {
    case 90:
      return 1
    case 180:
      return 2
    case 270:
      return 3
    default:
      return 0
  }
}

export function encodeMatrixLayout(layout: MatrixLayout): number {
  let byte = 0
  if (layout.serpentine) byte |= LAYOUT_SERP
  byte |= (rotationToIndex(layout.rotation) & 0x03) << LAYOUT_ROT_SHIFT
  if (layout.flipX) byte |= LAYOUT_FLIPX
  if (layout.flipY) byte |= LAYOUT_FLIPY
  return byte & 0xff
}

export function decodeMatrixLayout(input: number): MatrixLayout {
  const byte = Number.isFinite(input) ? Math.trunc(input) & 0xff : encodeMatrixLayout(defaultMatrixLayout())
  return {
    serpentine: (byte & LAYOUT_SERP) !== 0,
    rotation: MATRIX_ROTATIONS[(byte >> LAYOUT_ROT_SHIFT) & 0x03],
    flipX: (byte & LAYOUT_FLIPX) !== 0,
    flipY: (byte & LAYOUT_FLIPY) !== 0
  }
}

export function normalizeMatrixLayout(input: unknown): MatrixLayout {
  if (!input || typeof input !== 'object') return defaultMatrixLayout()
  const candidate = input as Partial<MatrixLayout>
  const rotation = MATRIX_ROTATIONS.includes(candidate.rotation as MatrixRotation)
    ? (candidate.rotation as MatrixRotation)
    : 0
  const layout: MatrixLayout = {
    serpentine: candidate.serpentine === true,
    rotation,
    flipX: candidate.flipX === true,
    flipY: candidate.flipY === true
  }
  // Only keep a customMap that is a true 64-entry permutation; anything else
  // (wrong length, out-of-range, duplicate) is dropped so a corrupted profile
  // silently falls back to the serpentine/rotation/flip mapping.
  if (isValidCustomMap(candidate.customMap)) layout.customMap = candidate.customMap.slice()
  return layout
}

// A customMap is valid iff it is a bijection of [0, RGB_MATRIX_LED_COUNT): exactly
// 64 integers, each in range, no duplicates. Anything else would either drop or
// double-light LEDs, so we reject it and fall back to the bitfield mapping.
export function isValidCustomMap(map: unknown): map is number[] {
  if (!Array.isArray(map) || map.length !== RGB_MATRIX_LED_COUNT) return false
  const seen = new Set<number>()
  for (const value of map) {
    if (!Number.isInteger(value) || value < 0 || value >= RGB_MATRIX_LED_COUNT) return false
    if (seen.has(value)) return false
    seen.add(value)
  }
  return true
}

// The layout byte to put on the wire (`M<byte>`). When a valid customMap is
// present the app pre-maps frames to physical order, so the device MUST run an
// identity layout (serpentine off, rotation 0, no flips → 0x00) and xyToIndex
// becomes index = y*8 + x. Otherwise the byte is the serp/rotation/flip bitfield.
export function wireLayoutByte(layout: MatrixLayout): number {
  return isValidCustomMap(layout.customMap) ? 0 : encodeMatrixLayout(layout)
}

// Exact replica of the firmware `xyToIndex` (companion_iflag.ino) for the
// serp/rotation/flip pipeline: optional logical flips → rotation into panel
// coordinates → optional serpentine reversal on odd physical rows. Lets the app
// predict, for any layout, which PHYSICAL LED a logical (x,y) lights — used by
// the manual-remap probe to light an exact physical LED via the current layout
// without rewriting the device's persisted mapping.
export function physicalIndexForXY(layout: MatrixLayout, x: number, y: number): number {
  const w = RGB_MATRIX_SIZE
  const h = RGB_MATRIX_SIZE
  let lx = layout.flipX ? w - 1 - x : x
  let ly = layout.flipY ? h - 1 - y : y
  let px: number
  let py: number
  switch (layout.rotation) {
    case 90:
      px = h - 1 - ly
      py = lx
      break
    case 180:
      px = w - 1 - lx
      py = h - 1 - ly
      break
    case 270:
      px = ly
      py = w - 1 - lx
      break
    default:
      px = lx
      py = ly
      break
  }
  if (layout.serpentine && (py & 1)) px = w - 1 - px
  return py * w + px
}

// Inverse of physicalIndexForXY: the unique logical (x,y) that lights the given
// PHYSICAL LED under `layout` (the mapping is a bijection, so exactly one). Used
// to light a precise physical LED during manual calibration without touching the
// device's stored layout byte.
export function logicalXYForPhysical(layout: MatrixLayout, physicalIndex: number): { x: number; y: number } {
  for (let y = 0; y < RGB_MATRIX_SIZE; y += 1) {
    for (let x = 0; x < RGB_MATRIX_SIZE; x += 1) {
      if (physicalIndexForXY(layout, x, y) === physicalIndex) return { x, y }
    }
  }
  return { x: 0, y: 0 }
}

// Re-order a LOGICAL row-major hex grid (rows[y][x]) into PHYSICAL row-major
// order using a customMap (logical index → physical index). The result, sent as
// `Q`/`P` frames to a device running an IDENTITY layout, lights physical LED
// customMap[logical] with the logical pixel's colour — i.e. it bypasses
// xyToIndex and lets the permutation alone define the wiring. Off colour fills
// any physical LED the map never targets (it always covers all 64 when valid).
export function applyCustomMapToHexRows(rows: string[][], customMap: number[], offHex = '#000000'): string[][] {
  const w = RGB_MATRIX_SIZE
  const physical: string[] = new Array(RGB_MATRIX_LED_COUNT).fill(offHex)
  for (let y = 0; y < w; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const logical = y * w + x
      const target = customMap[logical]
      if (Number.isInteger(target) && target >= 0 && target < RGB_MATRIX_LED_COUNT) {
        physical[target] = rows[y]?.[x] ?? offHex
      }
    }
  }
  const out: string[][] = []
  for (let r = 0; r < w; r += 1) out.push(physical.slice(r * w, r * w + w))
  return out
}

// Panel test / calibration patterns, generated APP-SIDE as a LOGICAL row-major
// hex grid so they can be pushed through a customMap (or the firmware layout)
// exactly like a real frame — used to verify the wiring/mapping even after a
// manual remap is active. Mirrors the firmware's built-in T patterns.
// Panel/calibration shapes ('all','corner','row','col','f') plus content tests
// that exercise the REAL telemetry visuals through the same path: solid race
// flags ('flag-*') and a gear digit ('gear'). The latter let the user confirm
// flags + the gear marker actually render through their manual map WITHOUT a live
// session (the #1 complaint: "não está imprimindo as flags e o gear").
export type MatrixTestMode =
  | 'all'
  | 'corner'
  | 'row'
  | 'col'
  | 'f'
  | 'flag-green'
  | 'flag-yellow'
  | 'flag-blue'
  | 'flag-white'
  | 'flag-checkered'
  | 'gear'

const MATRIX_TEST_MODES: readonly MatrixTestMode[] = [
  'all',
  'corner',
  'row',
  'col',
  'f',
  'flag-green',
  'flag-yellow',
  'flag-blue',
  'flag-white',
  'flag-checkered',
  'gear'
]

// Bold asymmetric "F" (MSB = logical column 0), identical to the firmware glyph.
const CALIB_F_GLYPH = [0x7c, 0x60, 0x60, 0x78, 0x60, 0x60, 0x60, 0x00]

export function isMatrixTestMode(value: unknown): value is MatrixTestMode {
  return typeof value === 'string' && (MATRIX_TEST_MODES as readonly string[]).includes(value)
}

export function buildCalibrationRows(mode: MatrixTestMode, profile?: RgbMatrixProfile): string[][] {
  const w = RGB_MATRIX_SIZE
  const off = '#000000'
  const rows: string[][] = []
  for (let y = 0; y < w; y += 1) rows.push(new Array(w).fill(off))
  if (mode === 'all') {
    for (let y = 0; y < w; y += 1) for (let x = 0; x < w; x += 1) rows[y][x] = '#ffffff'
  } else if (mode === 'corner') {
    rows[0][0] = '#ffffff'
  } else if (mode === 'row') {
    for (let x = 0; x < w; x += 1) rows[0][x] = '#ff0000'
  } else if (mode === 'col') {
    for (let y = 0; y < w; y += 1) rows[y][0] = '#0000ff'
  } else if (mode === 'flag-checkered') {
    // Reflect a custom 'checkered' pattern if the profile defines one.
    const custom = customFlagTestGrid(profile, 'checkered')
    if (custom) return custom
    for (let y = 0; y < w; y += 1) {
      for (let x = 0; x < w; x += 1) {
        rows[y][x] = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0 ? '#ffffff' : off
      }
    }
  } else if (mode.startsWith('flag-')) {
    const flag = mode.slice('flag-'.length) as FlagName
    // Reflect this flag's custom pattern when configured, else its solid colour.
    const custom = customFlagTestGrid(profile, flag)
    if (custom) return custom
    const hex = flagColor(flag, '#ffffff')
    for (let y = 0; y < w; y += 1) for (let x = 0; x < w; x += 1) rows[y][x] = hex
  } else if (mode === 'gear') {
    // Reflect the custom glyph for "3" when configured, else the built-in font —
    // so a correct map shows it upright and legible exactly like a real shift
    // indicator.
    const custom = customGearTestGrid(profile, '3')
    if (custom) return custom
    const glyph = GEAR_FONT['3'] ?? GEAR_FONT.N
    const originX = Math.max(0, Math.floor((w - 5) / 2))
    const originY = Math.max(0, Math.floor((w - 7) / 2))
    for (let gy = 0; gy < glyph.length; gy += 1) {
      for (let gx = 0; gx < glyph[gy].length; gx += 1) {
        if (glyph[gy][gx] !== '1') continue
        const px = originX + gx
        const py = originY + gy
        if (px >= 0 && px < w && py >= 0 && py < w) rows[py][px] = '#ffb000'
      }
    }
  } else {
    for (let y = 0; y < w; y += 1) {
      const bits = CALIB_F_GLYPH[y] ?? 0
      for (let x = 0; x < w; x += 1) if (bits & (0x80 >> x)) rows[y][x] = '#ffffff'
    }
  }
  return rows
}

// First enabled gear/flags effect in the stack (recursing into groups), so the
// "Testar painel" content tests can mirror the user's custom pixels.
function findEnabledEffect<T extends RgbMatrixEffect>(
  effects: RgbMatrixEffect[] | undefined,
  predicate: (effect: RgbMatrixEffect) => effect is T
): T | null {
  if (!effects) return null
  for (const effect of effects) {
    if (!effect.enabled) continue
    if (predicate(effect)) return effect
    if (effect.kind === 'group') {
      const child = findEnabledEffect(effect.effects, predicate)
      if (child) return child
    }
  }
  return null
}

function customFlagTestGrid(profile: RgbMatrixProfile | undefined, flag: FlagName): string[][] | null {
  const effect = findEnabledEffect(profile?.effects, (e): e is RgbMatrixFlagsEffect => e.kind === 'flags')
  if (!effect || effect.mode !== 'custom') return null
  const grid = effect.customPatterns?.[flag]
  return isValidHexGrid(grid) ? grid.map((row) => row.slice()) : null
}

function customGearTestGrid(profile: RgbMatrixProfile | undefined, label: GearLabel): string[][] | null {
  const effect = findEnabledEffect(profile?.effects, (e): e is RgbMatrixGearEffect => e.kind === 'gear')
  if (!effect || effect.mode !== 'custom') return null
  const grid = effect.customGlyphs?.[label]
  return isValidHexGrid(grid) ? grid.map((row) => row.slice()) : null
}

export interface RgbMatrixPosition {
  matrixStart: number
  startX: number
  startY: number
  width: number
  height: number
}

export type RgbMatrixBlinkMode = 'simpleDelay' | 'onOffDelay'

export interface RgbMatrixBehaviour {
  blinking: boolean
  blinkMode: RgbMatrixBlinkMode
  blinkDelayMs: number
  blinkOnDelayMs: number
  blinkOffDelayMs: number
}

export interface RgbAnimationFrame {
  id?: string
  durationMs: number
  grid: HexGrid
  // Back-compat alias kept for profiles/UI saved before frame-by-frame animations used `grid`.
  pixels?: HexGrid
}

export interface RgbMatrixBlinkConfig {
  enabled: boolean
  onMs: number
  offMs: number
  altColor?: string
  altFrames?: RgbAnimationFrame[]
  animateColors?: boolean
}

// A self-contained frame animation that can be attached PER race flag / PER gear
// digit. Reuses the SAME frame / loop / blink primitives as a full effect, so the
// existing animation engine (selectAnimationFrame / applyBlinkPhase) drives it
// unchanged. The drive clocks each one independently (per-flag / per-gear-label
// activation clock) so a 'once' animation replays every time that specific flag /
// gear label becomes active.
export interface RgbEffectAnimation {
  frames: RgbAnimationFrame[]
  loopMode: RgbAnimationLoopMode
  speed: number
  blink?: RgbMatrixBlinkConfig
}

export interface RgbMatrixEffectColors {
  active: string
  blink: string
  inactive: string
  inactiveBlink: string
}

export interface RgbMatrixEffectBase {
  id: string
  name: string
  enabled: boolean
  forceActivation: boolean
  // 0–255 multiplier applied to this effect's output colour before compositing.
  // 255 = full. Backward-compat: profiles saved before this field existed are
  // normalised to RGB_MATRIX_FULL_BRIGHTNESS on load.
  brightness: number
  // Clockwise rotation (in degrees) applied to THIS effect's rendered layer
  // before it is composited into the shared frame. Independent of the panel
  // wiring layout rotation (MatrixLayout.rotation). Backward-compat: profiles
  // saved before this field existed are normalised to 0 on load.
  rotation?: MatrixRotation
  position: RgbMatrixPosition
  colors: RgbMatrixEffectColors
  behaviour: RgbMatrixBehaviour
  frames?: RgbAnimationFrame[]
  loopMode?: RgbAnimationLoopMode
  speed?: number
  blink?: RgbMatrixBlinkConfig
  // Explicit, UNIQUE composite priority within a sibling list: 0 = top (overrides
  // all), 1 sits over 2, etc. No two siblings share a number. Effects composite so
  // the HIGHEST priority number is painted first (bottom) and priority 0 is painted
  // LAST (on top). Backward-compat: profiles saved before this field existed get a
  // priority assigned on load (see ensureUniqueEffectPriorities) that preserves
  // their previous last-on-top array order, so they render identically.
  priority?: number
}

export interface RgbMatrixAnimationEffect extends RgbMatrixEffectBase {
  kind: 'animation'
  frames: RgbAnimationFrame[]
}

export type RgbMatrixFlagMode = 'currentFlag' | 'checkered' | 'solid' | 'custom'

export interface RgbMatrixFlagsEffect extends RgbMatrixEffectBase {
  kind: 'flags'
  mode: RgbMatrixFlagMode
  // mode === 'custom': per-flag 8×8 hex grids. The grid for the detected (or
  // forced) flag is painted; all other modes use the solid/checkered defaults.
  // Legacy single-grid map — kept readable and auto-migrated to a 1-frame
  // animation (see selectFlagAnimation) so old profiles render identically.
  customPatterns?: Partial<Record<FlagName, string[][]>>
  // mode === 'custom': per-flag frame ANIMATION. Takes precedence over the legacy
  // single grid for the same flag, and plays on its own per-flag activation clock
  // so each flag animates independently.
  flagAnimations?: Partial<Record<FlagName, RgbEffectAnimation>>
  // FLAGS PREVAIL OVER THE GEAR. When true (default), a detected CAUTION flag
  // (every flag except green: yellow/blue/white/red/black/meatball/checkered)
  // suppresses any gear effect in the same profile, so the flag owns the whole
  // panel instead of the gear digit drawing on top of it. The GREEN flag never
  // hides the gear (normal racing keeps the shift digit visible). Backward-compat:
  // profiles saved before this field existed normalise to `true` on load.
  hideGearWhenFlagActive?: boolean
}

export type RgbMatrixGearGlyphMode = 'font' | 'custom'

export interface RgbMatrixGearEffect extends RgbMatrixEffectBase {
  kind: 'gear'
  // 'font' (default) renders GEAR_FONT; 'custom' renders customGlyphs[label],
  // an 8×8 hex grid where #000000 cells stay transparent (like the font glyph).
  mode?: RgbMatrixGearGlyphMode
  numberColor?: string
  redlineNumberColor?: string
  // Legacy single-grid per-gear glyph map — kept readable and auto-migrated to a
  // 1-frame animation (see selectGearAnimation) so old profiles render identically.
  customGlyphs?: Partial<Record<GearLabel, string[][]>>
  // mode === 'custom': per-gear-label frame ANIMATION. Takes precedence over the
  // legacy single glyph for the same label, and plays on its own per-gear-label
  // activation clock so each digit animates independently.
  gearAnimations?: Partial<Record<GearLabel, RgbEffectAnimation>>
}

export interface RgbMatrixSpotterEffect extends RgbMatrixEffectBase {
  kind: 'spotter'
}

export interface RgbMatrixStaticEffect extends RgbMatrixEffectBase {
  kind: 'static'
}

export type RgbMatrixStatusLedId =
  | 'absActive'
  | 'absOn'
  | 'brakeActive'
  | 'blackFlag'
  | 'blueFlag'
  | 'greenFlag'
  | 'whiteFlag'
  | 'yellowFlag'
  | 'drsAvailable'
  | 'drsOn'
  | 'lowFuel'
  | 'redlineReached'
  | 'speedLimiterOn'
  | 'spotterCarLeft'
  | 'spotterCarRight'
  | 'tcActive'
  | 'tcOn'
  | 'turnLeftIndicator'
  | 'turnRightIndicator'

export interface RgbMatrixStatusLedEffect extends RgbMatrixEffectBase {
  kind: 'statusLed'
  status: RgbMatrixStatusLedId
}

export type RgbMatrixCondition =
  | { kind: 'gameRunning' }
  | { kind: 'gameNotRunning' }
  | { kind: 'inPitLane' }
  | { kind: 'speedLimiter' }
  | { kind: 'brakePressed'; threshold: number }
  | { kind: 'formulaTrue'; formula: string }
  | { kind: 'selectedCarModel'; carModel: string }
  | { kind: 'selectedGames'; games: SimId[] }
  | { kind: 'special'; mode: RgbMatrixSpecialConditionMode; formula?: string; profileId?: string; script?: string }

export type RgbMatrixSpecialConditionMode =
  | 'changeBrightness'
  | 'changeBrightnessFormula'
  | 'includeProfile'
  | 'scriptedJsContent'

export interface RgbMatrixConditionalGroup {
  id: string
  name: string
  kind: 'group'
  enabled: boolean
  forceActivation: boolean
  condition: RgbMatrixCondition
  effects: RgbMatrixEffect[]
  // Composite priority among its SIBLINGS (a group is itself a sibling in the
  // stack). Same semantics as RgbMatrixEffectBase.priority: 0 = top, unique per
  // sibling list. Its own children carry their own independent priority set.
  priority?: number
}

export type RgbMatrixEffect =
  | RgbMatrixAnimationEffect
  | RgbMatrixFlagsEffect
  | RgbMatrixGearEffect
  | RgbMatrixSpotterEffect
  | RgbMatrixStaticEffect
  | RgbMatrixStatusLedEffect
  | RgbMatrixConditionalGroup

export type RgbMatrixLeafEffect = Exclude<RgbMatrixEffect, RgbMatrixConditionalGroup>

export interface RgbMatrixRenderOptions {
  elapsedMsForEffect?: (effect: RgbMatrixLeafEffect, defaultElapsedMs: number) => number
  redlineReachedForEffect?: (effect: RgbMatrixGearEffect, telemetry: TelemetrySnapshot | null) => boolean
  // Resolve the elapsed time for a per-flag / per-gear-label sub-animation clock.
  // `scope` is 'flag' or 'gear'; `key` is the flag name or gear label. Lets the
  // drive run an independent activation clock per flag / per gear digit so a
  // 'once' animation replays each time that specific flag / label becomes active.
  // Falls back to `defaultElapsedMs` (the effect clock) when not provided, e.g. in
  // editor previews and tests that render without the live drive.
  elapsedMsForAnimationScope?: (
    effect: RgbMatrixLeafEffect,
    scope: 'flag' | 'gear',
    key: string,
    defaultElapsedMs: number
  ) => number
  // True ONLY during the brief green-flag "flash" window (start/restart), computed by
  // the live drive (edge-detect + timer). The green flag prevails over the gear and
  // renders ONLY while this is true; outside the window green never hides the gear
  // (normal racing keeps the digit) and paints no green panel. Undefined in editor /
  // test previews → green never flashes there.
  greenFlashActive?: boolean
}

export interface RgbMatrixCatalogItem {
  id: string
  label: string
  description: string
  category: 'Effects' | 'Status leds' | 'Conditional groups' | 'Special'
}

export const RGB_MATRIX_EFFECT_CATALOG: ReadonlyArray<RgbMatrixCatalogItem> = [
  { id: 'animation', label: 'Animation', description: 'Hand-drawn multi-frame RGB animation.', category: 'Effects' },
  { id: 'flags', label: 'Flags', description: 'Show current racing flag colours.', category: 'Effects' },
  { id: 'gear', label: 'Gear', description: 'Display the current gear digit.', category: 'Effects' },
  { id: 'spotter', label: 'Spotter overlay', description: 'Left/right proximity overlay.', category: 'Effects' },
  { id: 'static', label: 'Static effect', description: 'Paint a fixed colour block.', category: 'Effects' }
]

export const RGB_MATRIX_STATUS_LED_CATALOG: ReadonlyArray<RgbMatrixCatalogItem & { status: RgbMatrixStatusLedId }> = [
  { id: 'absActive', status: 'absActive', label: 'ABS active', description: 'Lights while ABS intervention is active.', category: 'Status leds' },
  { id: 'absOn', status: 'absOn', label: 'ABS ON', description: 'Lights while ABS is enabled by telemetry.', category: 'Status leds' },
  { id: 'brakeActive', status: 'brakeActive', label: 'Brake active', description: 'Lights while brake pedal is pressed.', category: 'Status leds' },
  { id: 'blackFlag', status: 'blackFlag', label: 'Black flag ON', description: 'Lights while black flag is active.', category: 'Status leds' },
  { id: 'blueFlag', status: 'blueFlag', label: 'Blue flag ON', description: 'Lights while blue flag is active.', category: 'Status leds' },
  { id: 'greenFlag', status: 'greenFlag', label: 'Green flag ON', description: 'Lights while green flag is active.', category: 'Status leds' },
  { id: 'whiteFlag', status: 'whiteFlag', label: 'White flag ON', description: 'Lights while white flag is active.', category: 'Status leds' },
  { id: 'yellowFlag', status: 'yellowFlag', label: 'Yellow flag ON', description: 'Lights while yellow flag is active.', category: 'Status leds' },
  { id: 'drsAvailable', status: 'drsAvailable', label: 'DRS available', description: 'Lights while DRS availability is reported.', category: 'Status leds' },
  { id: 'drsOn', status: 'drsOn', label: 'DRS ON', description: 'Lights while DRS is open.', category: 'Status leds' },
  { id: 'lowFuel', status: 'lowFuel', label: 'Low fuel', description: 'Lights when estimated fuel is low.', category: 'Status leds' },
  { id: 'redlineReached', status: 'redlineReached', label: 'Redline reached', description: 'Lights near shift/redline.', category: 'Status leds' },
  { id: 'speedLimiterOn', status: 'speedLimiterOn', label: 'Speed limiter ON', description: 'Lights while pit limiter is enabled.', category: 'Status leds' },
  { id: 'spotterCarLeft', status: 'spotterCarLeft', label: 'Spotter car left', description: 'Lights when spotter reports a car left.', category: 'Status leds' },
  { id: 'spotterCarRight', status: 'spotterCarRight', label: 'Spotter car right', description: 'Lights when spotter reports a car right.', category: 'Status leds' },
  { id: 'tcActive', status: 'tcActive', label: 'TC active', description: 'Lights while traction control intervention is active.', category: 'Status leds' },
  { id: 'tcOn', status: 'tcOn', label: 'TC ON', description: 'Lights while traction control is enabled.', category: 'Status leds' },
  { id: 'turnLeftIndicator', status: 'turnLeftIndicator', label: 'Turn-left indicator', description: 'Lights while left indicator is on.', category: 'Status leds' },
  { id: 'turnRightIndicator', status: 'turnRightIndicator', label: 'Turn-right indicator', description: 'Lights while right indicator is on.', category: 'Status leds' }
]

export const RGB_MATRIX_GROUP_CATALOG: ReadonlyArray<RgbMatrixCatalogItem> = [
  { id: 'gameRunning', label: 'Game running', description: 'Enabled when telemetry is connected.', category: 'Conditional groups' },
  { id: 'gameNotRunning', label: 'Game not running', description: 'Enabled when telemetry is disconnected.', category: 'Conditional groups' },
  { id: 'inPitLane', label: 'Car in pit lane', description: 'Enabled while the car is on pit road.', category: 'Conditional groups' },
  { id: 'speedLimiter', label: 'Speed limiter ON', description: 'Enabled while pit limiter is active.', category: 'Conditional groups' },
  { id: 'brakePressed', label: 'Brake pressed', description: 'Enabled when brake pedal exceeds threshold.', category: 'Conditional groups' },
  { id: 'formulaTrue', label: 'Custom formula', description: 'Enabled when a safe formula resolves true.', category: 'Conditional groups' }
]

export const RGB_MATRIX_SPECIAL_CATALOG: ReadonlyArray<RgbMatrixCatalogItem> = [
  { id: 'changeBrightness', label: 'Change brightness', description: 'Reserved special wrapper for brightness changes.', category: 'Special' },
  { id: 'changeBrightnessFormula', label: 'Brightness via formula', description: 'Reserved special wrapper for formula brightness.', category: 'Special' },
  { id: 'includeProfile', label: 'Include profile', description: 'Reserved wrapper to include another profile.', category: 'Special' },
  { id: 'scriptedJsContent', label: 'Scripted JS content', description: 'Reserved wrapper for scripted content.', category: 'Special' }
]

const BLACK: RgbColor = { r: 0, g: 0, b: 0 }
const GEAR_FONT: Record<string, readonly string[]> = {
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['10010', '10010', '10010', '11111', '00010', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110']
}

export function defaultRgbMatrixProfile(): RgbMatrixProfile {
  return {
    version: RGB_MATRIX_PROFILE_VERSION,
    layout: defaultMatrixLayout(),
    // Order matters: effects composite top→bottom (later overwrites earlier), so
    // the gear digit is LAST and renders ON TOP of the flag fill during NORMAL
    // racing (no flag, or the GREEN flag) — the digit stays visible over the
    // colour behind it. A CAUTION flag (yellow/blue/white/red/black/meatball/
    // checkered), however, PREVAILS: it suppresses the gear (see
    // shouldHideGearForFlag / hideGearWhenFlagActive) so the flag owns the panel.
    effects: [
      createRgbMatrixEffect('flags'),
      createRgbMatrixEffect('gear')
    ]
  }
}

export function createRgbMatrixEffect(kind: Exclude<RgbMatrixEffect['kind'], 'group'>): Exclude<RgbMatrixEffect, RgbMatrixConditionalGroup> {
  const base = createEffectBase(kindLabel(kind))
  switch (kind) {
    case 'animation':
      return { ...base, kind, frames: [createAnimationFrame()], loopMode: 'loop', speed: 1 }
    case 'flags':
      return { ...base, kind, mode: 'currentFlag', hideGearWhenFlagActive: true }
    case 'gear':
      return { ...base, kind, numberColor: base.colors.active, redlineNumberColor: '#FF2D20' }
    case 'spotter':
      return { ...base, kind }
    case 'static':
      return { ...base, kind }
    case 'statusLed':
      return { ...base, kind, status: 'speedLimiterOn' }
  }
}

export function createRgbMatrixStatusLed(status: RgbMatrixStatusLedId): RgbMatrixStatusLedEffect {
  const item = RGB_MATRIX_STATUS_LED_CATALOG.find((entry) => entry.status === status)
  return { ...createEffectBase(item?.label ?? 'Status LED'), kind: 'statusLed', status }
}

export function createRgbMatrixGroup(condition: RgbMatrixCondition): RgbMatrixConditionalGroup {
  return {
    id: createId('group'),
    name: conditionLabel(condition),
    kind: 'group',
    enabled: true,
    forceActivation: false,
    condition,
    effects: []
  }
}

export function createAnimationFrame(grid: HexGrid = emptyHexGrid(), durationMs = 250): RgbAnimationFrame {
  const normalized = cloneHexGrid(grid)
  return {
    id: createId('frame'),
    durationMs,
    grid: normalized,
    pixels: normalized
  }
}

// Build a per-flag / per-gear-label animation, optionally seeded from a single
// 8×8 grid (its first frame). Used by the editor's per-label timeline and as the
// destination shape when migrating a legacy single grid to a 1-frame animation.
export function createEffectAnimation(grid: HexGrid = emptyHexGrid(), durationMs = 250): RgbEffectAnimation {
  return { frames: [createAnimationFrame(grid, durationMs)], loopMode: 'loop', speed: 1 }
}

// Back-compat: a single saved 8×8 grid (customPatterns[flag] / customGlyphs[label])
// becomes a one-frame animation so older profiles render identically. Returns null
// when the grid is missing/malformed.
export function gridToEffectAnimation(grid: unknown): RgbEffectAnimation | null {
  return isValidHexGrid(grid) ? createEffectAnimation(grid) : null
}

// ─── Per-effect custom glyph / pattern helpers ───────────────────────────────

// Build an 8×8 hex grid of the built-in font glyph for a gear label, centred and
// painted in `hex`. Used to SEED a gear effect's custom glyphs so the user starts
// from the legible default and tweaks pixels instead of drawing from scratch.
export function buildGearGlyphHexGrid(label: GearLabel, hex: string): string[][] {
  const grid = emptyHexGrid()
  const glyph = GEAR_FONT[label] ?? GEAR_FONT.N
  const originX = Math.max(0, Math.floor((RGB_MATRIX_SIZE - 5) / 2))
  const originY = Math.max(0, Math.floor((RGB_MATRIX_SIZE - 7) / 2))
  for (let gy = 0; gy < glyph.length; gy += 1) {
    for (let gx = 0; gx < glyph[gy].length; gx += 1) {
      if (glyph[gy][gx] !== '1') continue
      const px = originX + gx
      const py = originY + gy
      if (px >= 0 && px < RGB_MATRIX_SIZE && py >= 0 && py < RGB_MATRIX_SIZE) grid[py][px] = hex
    }
  }
  return grid
}

export function defaultGearCustomGlyphs(hex: string): Record<GearLabel, string[][]> {
  const out = {} as Record<GearLabel, string[][]>
  for (const label of GEAR_LABELS) out[label] = buildGearGlyphHexGrid(label, hex)
  return out
}

// Build the default 8×8 image for a flag (its solid colour fill, or the
// checkered pattern). Used to seed a flags effect's custom patterns.
export function buildFlagHexGrid(flag: FlagName): string[][] {
  const grid = emptyHexGrid()
  if (flag === 'checkered') {
    for (let y = 0; y < RGB_MATRIX_SIZE; y += 1) {
      for (let x = 0; x < RGB_MATRIX_SIZE; x += 1) {
        grid[y][x] = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0 ? '#FFFFFF' : '#000000'
      }
    }
    return grid
  }
  const hex = flagColor(flag, '#FFFFFF')
  for (let y = 0; y < RGB_MATRIX_SIZE; y += 1) for (let x = 0; x < RGB_MATRIX_SIZE; x += 1) grid[y][x] = hex
  return grid
}

export function defaultFlagCustomPatterns(): Record<FlagName, string[][]> {
  const out = {} as Record<FlagName, string[][]>
  for (const flag of FLAG_NAMES) out[flag] = buildFlagHexGrid(flag)
  return out
}

function sanitizeHexGrids<K extends string>(input: unknown): Partial<Record<K, string[][]>> | undefined {
  if (!input || typeof input !== 'object') return undefined
  const out: Partial<Record<K, string[][]>> = {}
  let kept = false
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (isValidHexGrid(value)) {
      out[key as K] = value.map((row) => row.slice())
      kept = true
    }
  }
  return kept ? out : undefined
}


function cloneHexGrid(grid: HexGrid): HexGrid {
  return grid.map((row) => row.slice())
}

function normalizeDurationMs(input: unknown, fallback = 250): number {
  const value = typeof input === 'number' && Number.isFinite(input) ? input : fallback
  return clampInt(value, 20, 60000)
}

function normalizeSpeed(input: unknown): number {
  const value = typeof input === 'number' && Number.isFinite(input) ? input : 1
  return Math.max(0.05, Math.min(8, value))
}

function normalizeLoopMode(input: unknown): RgbAnimationLoopMode {
  return input === 'pingpong' || input === 'once' ? input : 'loop'
}

function normalizeAnimationFrame(input: unknown): RgbAnimationFrame | null {
  if (!input || typeof input !== 'object') return null
  const candidate = input as Partial<RgbAnimationFrame> & { pixels?: unknown; grid?: unknown }
  const rawGrid = isValidHexGrid(candidate.grid) ? candidate.grid : isValidHexGrid(candidate.pixels) ? candidate.pixels : null
  if (!rawGrid) return null
  const grid = cloneHexGrid(rawGrid)
  return {
    id: typeof candidate.id === 'string' && candidate.id ? candidate.id : createId('frame'),
    durationMs: normalizeDurationMs(candidate.durationMs),
    grid,
    pixels: grid
  }
}

function normalizeAnimationFrames(input: unknown, fallbackGrid?: HexGrid): RgbAnimationFrame[] | undefined {
  if (Array.isArray(input)) {
    const frames = input.map(normalizeAnimationFrame).filter((frame): frame is RgbAnimationFrame => Boolean(frame))
    if (frames.length > 0) return frames
  }
  if (fallbackGrid && isValidHexGrid(fallbackGrid)) return [createAnimationFrame(fallbackGrid)]
  return undefined
}

function normalizeBlinkConfig(input: unknown, behaviour: RgbMatrixBehaviour, colors: RgbMatrixEffectColors): RgbMatrixBlinkConfig {
  const hasExplicitBlink = Boolean(input && typeof input === 'object' && Object.keys(input as Record<string, unknown>).length > 0)
  const candidate = hasExplicitBlink ? (input as Partial<RgbMatrixBlinkConfig>) : {}
  const enabled = candidate.enabled === true || (!hasExplicitBlink && behaviour.blinking === true)
  const onMs = normalizeDurationMs(candidate.onMs, behaviour.blinkMode === 'onOffDelay' ? behaviour.blinkOnDelayMs : behaviour.blinkDelayMs)
  const offMs = normalizeDurationMs(candidate.offMs, behaviour.blinkMode === 'onOffDelay' ? behaviour.blinkOffDelayMs : behaviour.blinkDelayMs)
  const altFrames = normalizeAnimationFrames(candidate.altFrames)
  return {
    enabled,
    onMs,
    offMs,
    altColor: typeof candidate.altColor === 'string' ? candidate.altColor : !hasExplicitBlink && behaviour.blinking ? colors.blink : undefined,
    altFrames,
    animateColors: candidate.animateColors === true
  }
}

function normalizeEffectAnimation<T extends RgbMatrixEffectBase>(effect: T, fallbackGrid?: HexGrid): T {
  const legacy = effect as T & { grid?: unknown; pixels?: unknown }
  const legacyGrid = fallbackGrid ?? (isValidHexGrid(legacy.grid) ? legacy.grid : isValidHexGrid(legacy.pixels) ? legacy.pixels : undefined)
  const frames = normalizeAnimationFrames(effect.frames, legacyGrid)
  return {
    ...effect,
    frames,
    loopMode: normalizeLoopMode(effect.loopMode),
    speed: normalizeSpeed(effect.speed),
    blink: normalizeBlinkConfig(effect.blink, effect.behaviour, effect.colors)
  }
}

// Blink config for a per-flag / per-gear animation. Unlike the effect-level
// normaliser this has no legacy `behaviour` to fall back on, so it only keeps an
// explicit blink object (returns undefined when absent → no blink).
function normalizePerScopeBlinkConfig(input: unknown): RgbMatrixBlinkConfig | undefined {
  if (!input || typeof input !== 'object') return undefined
  const candidate = input as Partial<RgbMatrixBlinkConfig>
  return {
    enabled: candidate.enabled === true,
    onMs: normalizeDurationMs(candidate.onMs, 300),
    offMs: normalizeDurationMs(candidate.offMs, 300),
    altColor: typeof candidate.altColor === 'string' ? candidate.altColor : undefined,
    altFrames: normalizeAnimationFrames(candidate.altFrames),
    animateColors: candidate.animateColors === true
  }
}

// Normalise a standalone per-flag / per-gear animation. Returns null when there
// is no usable frame (so a malformed/empty entry is dropped). `fallbackGrid`
// seeds a one-frame animation when no explicit frames are present (used by the
// single-grid migration).
export function normalizeRgbEffectAnimation(input: unknown, fallbackGrid?: HexGrid): RgbEffectAnimation | null {
  const candidate = input && typeof input === 'object' ? (input as Partial<RgbEffectAnimation>) : null
  const frames = normalizeAnimationFrames(candidate?.frames, fallbackGrid)
  if (!frames || frames.length === 0) return null
  return {
    frames,
    loopMode: normalizeLoopMode(candidate?.loopMode),
    speed: normalizeSpeed(candidate?.speed),
    blink: normalizePerScopeBlinkConfig(candidate?.blink)
  }
}

// Normalise a per-label animation map (flagAnimations / gearAnimations), dropping
// malformed/empty entries. Returns undefined when nothing survives so the field
// stays absent on the effect.
function normalizeEffectAnimationMap<K extends string>(
  input: unknown,
  keys: readonly K[]
): Partial<Record<K, RgbEffectAnimation>> | undefined {
  if (!input || typeof input !== 'object') return undefined
  const source = input as Record<string, unknown>
  const out: Partial<Record<K, RgbEffectAnimation>> = {}
  let kept = false
  for (const key of keys) {
    const anim = normalizeRgbEffectAnimation(source[key])
    if (anim) {
      out[key] = anim
      kept = true
    }
  }
  return kept ? out : undefined
}

// Resolve the animation that should play for a flag: an explicit per-flag
// animation wins; otherwise a legacy single-grid customPattern migrates to a
// one-frame animation. `explicit` tells the renderer whether to use the
// animation's OWN blink + per-flag clock (true) or keep the effect-level blink +
// clock for the migrated single grid (false), preserving round-6 behaviour.
function resolveFlagAnimation(
  effect: Pick<RgbMatrixFlagsEffect, 'flagAnimations' | 'customPatterns'>,
  flag: FlagName
): { animation: RgbEffectAnimation; explicit: boolean } | null {
  const explicit = normalizeRgbEffectAnimation(effect.flagAnimations?.[flag])
  if (explicit) return { animation: explicit, explicit: true }
  const migrated = gridToEffectAnimation(effect.customPatterns?.[flag])
  return migrated ? { animation: migrated, explicit: false } : null
}

// Resolve the animation that should play for a gear label — see resolveFlagAnimation.
function resolveGearAnimation(
  effect: Pick<RgbMatrixGearEffect, 'gearAnimations' | 'customGlyphs'>,
  label: GearLabel
): { animation: RgbEffectAnimation; explicit: boolean } | null {
  const explicit = normalizeRgbEffectAnimation(effect.gearAnimations?.[label])
  if (explicit) return { animation: explicit, explicit: true }
  const migrated = gridToEffectAnimation(effect.customGlyphs?.[label])
  return migrated ? { animation: migrated, explicit: false } : null
}

// Pure helper: the active animation for a flag (explicit per-flag animation, else
// the legacy single grid migrated to one frame, else null). Used by the editor
// and tests; the renderer uses resolveFlagAnimation for the blink/clock nuance.
export function selectFlagAnimation(
  effect: Pick<RgbMatrixFlagsEffect, 'flagAnimations' | 'customPatterns'>,
  flag: FlagName
): RgbEffectAnimation | null {
  return resolveFlagAnimation(effect, flag)?.animation ?? null
}

// Pure helper: the active animation for a gear label — see selectFlagAnimation.
export function selectGearAnimation(
  effect: Pick<RgbMatrixGearEffect, 'gearAnimations' | 'customGlyphs'>,
  label: GearLabel
): RgbEffectAnimation | null {
  return resolveGearAnimation(effect, label)?.animation ?? null
}

// Normalise ONE effect (recursively for groups): fill a missing per-effect
// brightness with full, default the gear/flags mode, and drop malformed custom
// grids. Keeps old profiles working without a version migration.
export function normalizeRgbMatrixEffect(effect: RgbMatrixEffect): RgbMatrixEffect {
  if (effect.kind === 'group') {
    return { ...effect, effects: ensureUniqueEffectPriorities(effect.effects.map(normalizeRgbMatrixEffect)) }
  }
  const brightness = effectBrightness(effect)
  const rotation = effectRotation(effect)
  const withBase = { ...effect, brightness, rotation }
  if (effect.kind === 'gear') {
    const mode: RgbMatrixGearGlyphMode = effect.mode === 'custom' ? 'custom' : 'font'
    const numberColor = typeof effect.numberColor === 'string' ? effect.numberColor : effect.colors.active
    const redlineNumberColor = typeof effect.redlineNumberColor === 'string' ? effect.redlineNumberColor : '#FF2D20'
    return normalizeEffectAnimation({ ...withBase, mode, numberColor, redlineNumberColor, customGlyphs: sanitizeHexGrids<GearLabel>(effect.customGlyphs), gearAnimations: normalizeEffectAnimationMap(effect.gearAnimations, GEAR_LABELS) } as RgbMatrixGearEffect)
  }
  if (effect.kind === 'animation') {
    return normalizeEffectAnimation(withBase as RgbMatrixAnimationEffect, emptyHexGrid())
  }
  if (effect.kind === 'flags') {
    const mode: RgbMatrixFlagMode = (['currentFlag', 'checkered', 'solid', 'custom'] as const).includes(
      effect.mode as RgbMatrixFlagMode
    )
      ? (effect.mode as RgbMatrixFlagMode)
      : 'currentFlag'
    // Default the prevail-over-gear flag to ON; only an explicit `false` opts out
    // (so legacy profiles that predate the field get the corrected behaviour).
    return normalizeEffectAnimation({ ...withBase, mode, hideGearWhenFlagActive: effect.hideGearWhenFlagActive !== false, customPatterns: sanitizeHexGrids<FlagName>(effect.customPatterns), flagAnimations: normalizeEffectAnimationMap(effect.flagAnimations, FLAG_NAMES) } as RgbMatrixFlagsEffect)
  }
  return normalizeEffectAnimation(withBase as Exclude<RgbMatrixEffect, RgbMatrixConditionalGroup>)
}

export function normalizeRgbMatrixEffects(input: unknown): RgbMatrixEffect[] {
  if (!Array.isArray(input)) return ensureUniqueEffectPriorities(defaultRgbMatrixProfile().effects)
  return ensureUniqueEffectPriorities(input.map((effect) => normalizeRgbMatrixEffect(effect as RgbMatrixEffect)))
}

// True iff EVERY effect in a sibling list already carries a finite, mutually
// UNIQUE priority (regardless of range/gaps).
function hasUniqueFinitePriorities(effects: readonly { priority?: number }[]): boolean {
  const seen = new Set<number>()
  for (const effect of effects) {
    const value = effect.priority
    if (typeof value !== 'number' || !Number.isFinite(value)) return false
    if (seen.has(value)) return false
    seen.add(value)
  }
  return true
}

// True iff a sibling list's priorities are EXACTLY the contiguous set {0,1,…,N-1}.
// This is the fully-normalised state under which the migration is a strict no-op.
function hasContiguousUniquePriorities(effects: readonly { priority?: number }[]): boolean {
  const seen = new Set<number>()
  for (const effect of effects) {
    const value = effect.priority
    if (typeof value !== 'number' || !Number.isInteger(value)) return false
    if (value < 0 || value >= effects.length) return false
    if (seen.has(value)) return false
    seen.add(value)
  }
  return true
}

// Guarantee a sibling list has CONTIGUOUS unique priorities 0..N-1 (0 = top).
// Idempotent: a list already at {0,…,N-1} is returned UNCHANGED (same reference).
// • unique-but-gapped (e.g. 0,2,3 after a middle delete) → RANK-normalised to
//   0..N-1, preserving the visual order (priority asc, stable) so the effect that
//   was priority 0 stays 0.
// • not-unique / not-finite (e.g. a legacy no-priority profile) → assigned
//   `priority = (N-1) - index`, so the LAST array element — which used to composite
//   ON TOP (last-on-top) — becomes priority 0, preserving the legacy appearance.
// Pure: never mutates the input array or its effects; only priority fields change.
export function ensureUniqueEffectPriorities<T extends { priority?: number }>(effects: T[]): T[] {
  if (hasContiguousUniquePriorities(effects)) return effects
  if (hasUniqueFinitePriorities(effects)) {
    // Rank-normalise the gapped-but-unique set to contiguous 0..N-1, preserving the
    // current display order (lowest priority stays on top).
    const rankByIndex = new Array<number>(effects.length)
    effects
      .map((effect, index) => ({ index, priority: effect.priority as number }))
      .sort((a, b) => a.priority - b.priority || a.index - b.index)
      .forEach((entry, rank) => {
        rankByIndex[entry.index] = rank
      })
    return effects.map((effect, index) => ({ ...effect, priority: rankByIndex[index] }))
  }
  const lastIndex = effects.length - 1
  return effects.map((effect, index) => ({ ...effect, priority: lastIndex - index }))
}

// Insert a new effect at the TOP of a sibling list: it gets priority 0 (overrides
// all), every existing sibling shifts +1, and the result is a contiguous unique
// 0..N set. Deterministic regardless of whether the existing list was normalised
// (a spotter the user just added overrides the panel out-of-the-box). The new
// effect is appended to the array END (stored array order); only the priority
// fields drive the on-top placement.
export function withEffectOnTop<T extends { priority?: number }>(siblings: T[], newEffect: T): T[] {
  const ensured = ensureUniqueEffectPriorities(siblings)
  const shifted = ensured.map((effect) => ({ ...effect, priority: (effect.priority as number) + 1 }))
  return [...shifted, { ...newEffect, priority: 0 }]
}

export function renderMatrixFrame(
  profile: RgbMatrixProfile,
  telemetry: TelemetrySnapshot | null,
  timeMs: number,
  options: RgbMatrixRenderOptions = {}
): RgbFrame {
  const frame = emptyFrame()
  // FLAGS PREVAIL OVER THE GEAR: when a caution flag is active (and an enabled
  // flags effect opts in — the default), the gear effect renders nothing, so the
  // flag owns the whole panel. This stops the gear digit from compositing on top
  // of the flag AND from bleeding through during the yellow/blue auto-blink OFF
  // phase. The GREEN flag prevails ONLY during the brief start/restart flash
  // window (options.greenFlashActive); otherwise normal racing keeps the digit.
  const suppressGear = shouldHideGearForFlag(profile, telemetry, options)
  // EXCLUSIVE PRIORITY: only the SINGLE highest-priority (lowest number) currently
  // ACTIVE leaf paints; everything below it is suppressed (no transparent bleed-
  // through). This stops the panel from showing several effects "printed" on top of
  // each other. The one pairing kept is gear-over-flag during NORMAL racing: a green
  // (non-caution) flag fill still lets the gear digit render on top, exactly as
  // before. statusLed/spotter count as active only when lit, so an inactive LED can't
  // claim the panel. Legacy (no priorities) → first active leaf in order, same intent.
  const leaves = collectRenderableLeaves(profile.effects, telemetry)
  // EXCLUSIVE: paint the highest-priority leaf that ACTUALLY lights a pixel. A leaf
  // can be "active" yet render nothing (steady green flag, empty animation frame);
  // suppressing the rest then would blank the panel, so we render into a scratch and
  // fall through to the next when empty. A STATIC always claims its slot even when
  // all-black (it can be used to deliberately blank a region).
  for (const leaf of leaves) {
    if (!leafPaintsThisFrame(leaf, telemetry, suppressGear)) continue
    if (leaf.kind !== 'static') {
      const scratch = emptyFrame()
      renderEffect(leaf, telemetry, timeMs, scratch, options, suppressGear)
      if (!frameHasLitPixel(scratch)) continue
    }
    renderEffect(leaf, telemetry, timeMs, frame, options, suppressGear)
    // Gear-over-flag pairing: a flag fill that doesn't suppress the gear (green /
    // opt-out) still gets the gear digit on top — and a top gear keeps the flag fill
    // behind it, so the caution colour + digit show together.
    if ((leaf.kind === 'flags' || leaf.kind === 'gear') && !suppressGear) {
      const gear = leaves.find((l) => l.kind === 'gear')
      const flags = leaves.find((l) => l.kind === 'flags')
      if (leaf.kind === 'gear' && flags && leafPaintsThisFrame(flags, telemetry, suppressGear)) {
        renderEffect(flags, telemetry, timeMs, frame, options, suppressGear)
        renderEffect(leaf, telemetry, timeMs, frame, options, suppressGear)
      } else if (leaf.kind === 'flags' && gear && leafPaintsThisFrame(gear, telemetry, suppressGear)) {
        renderEffect(gear, telemetry, timeMs, frame, options, suppressGear)
      }
    }
    break
  }
  return frame
}

// Flatten enabled leaves (skipping inactive groups) into PAINT priority order: 0 =
// top. A group is itself a sibling — its priority places its whole subtree, then its
// children order among themselves. Mirrors renderEffect's group gating so what we
// pick matches what would paint. Returns leaves top-first.
function collectRenderableLeaves(
  effects: RgbMatrixEffect[] | undefined,
  telemetry: TelemetrySnapshot | null
): Exclude<RgbMatrixEffect, RgbMatrixConditionalGroup>[] {
  const out: Exclude<RgbMatrixEffect, RgbMatrixConditionalGroup>[] = []
  if (!effects) return out
  for (const effect of exclusiveOrder(effects)) {
    if (!effect.enabled) continue
    if (effect.kind === 'group') {
      if (!effect.forceActivation && !evaluateCondition(effect.condition, telemetry)) continue
      out.push(...collectRenderableLeaves(effect.effects, telemetry))
    } else {
      out.push(effect)
    }
  }
  return out
}

// Top-first order (0 first) for EXCLUSIVE selection: lowest priority number wins;
// no/equal priority keeps original array order. (compositeOrder is the reverse, for
// painting bottom→top; here we want to pick the top-most first.)
function exclusiveOrder<T extends { priority?: number }>(effects: T[]): T[] {
  return effects
    .map((effect, index) => ({ effect, index }))
    .sort((a, b) => priorityRank(a.effect) - priorityRank(b.effect) || b.index - a.index)
    .map((entry) => entry.effect)
}

// Whether a leaf actually produces output this frame (so it can claim the panel).
function leafPaintsThisFrame(
  effect: Exclude<RgbMatrixEffect, RgbMatrixConditionalGroup>,
  telemetry: TelemetrySnapshot | null,
  suppressGear: boolean
): boolean {
  if (!effect.enabled) return false
  if (effect.kind === 'gear' && suppressGear) return false
  return effect.forceActivation || isEffectActive(effect, telemetry)
}

// Order a sibling list for COMPOSITING (painting): the HIGHEST priority number is
// painted first (ends up at the bottom) and priority 0 is painted LAST (ends up on
// top, overriding all). Effects without a finite priority sort as the bottom-most
// group and, like exact ties, keep their original array order — so a legacy profile
// (no priorities) composites exactly as before (last-on-top). Returns a SORTED COPY;
// the caller's stored array order is never mutated.
function compositeOrder<T extends { priority?: number }>(effects: T[]): T[] {
  return effects
    .map((effect, index) => ({ effect, index }))
    .sort((a, b) => priorityRank(b.effect) - priorityRank(a.effect) || a.index - b.index)
    .map((entry) => entry.effect)
}

function priorityRank(effect: { priority?: number }): number {
  return typeof effect.priority === 'number' && Number.isFinite(effect.priority) ? effect.priority : Number.MAX_SAFE_INTEGER
}

// Whether the gear effect must be hidden because a prevailing caution flag is
// active. True iff telemetry is connected, the detected flag is a caution flag
// (anything but green) OR a green flash is active, and a flags effect that would
// ACTUALLY RENDER this frame keeps its default opt-in (`hideGearWhenFlagActive !==
// false`). "Would render" means: enabled, AND every enclosing conditional group is
// itself active — so a flags effect buried in a condition-false group (which paints
// no flag) can no longer blank the gear and leave the panel empty.
function shouldHideGearForFlag(profile: RgbMatrixProfile, telemetry: TelemetrySnapshot | null, options: RgbMatrixRenderOptions = {}): boolean {
  if (!telemetry?.connected) return false
  const flag = detectFlag(telemetry.flags)
  if (!flag) return false
  // Green prevails over the gear ONLY during the brief start/restart flash window.
  if (flag === 'green' && options.greenFlashActive !== true) return false
  const flagsEffect = findRenderableFlagsEffect(profile.effects, telemetry)
  if (!flagsEffect) return false
  return flagsEffect.hideGearWhenFlagActive !== false
}

// First enabled flags effect that would render for `telemetry`, honouring the
// enclosing group chain's condition exactly like renderEffect (a group renders
// its children iff `forceActivation || evaluateCondition`). Unlike
// findEnabledEffect (used by the static "Testar painel" content tests), this
// skips effects inside an inactive group so suppression matches what is painted.
function findRenderableFlagsEffect(
  effects: RgbMatrixEffect[] | undefined,
  telemetry: TelemetrySnapshot | null
): RgbMatrixFlagsEffect | null {
  if (!effects) return null
  for (const effect of effects) {
    if (!effect.enabled) continue
    if (effect.kind === 'group') {
      if (!effect.forceActivation && !evaluateCondition(effect.condition, telemetry)) continue
      const child = findRenderableFlagsEffect(effect.effects, telemetry)
      if (child) return child
    } else if (effect.kind === 'flags') {
      return effect
    }
  }
  return null
}

export function hexToRgb(input: string): RgbColor {
  const value = input.trim().replace(/^#/, '')
  const normalized = /^[0-9a-fA-F]{6}$/.test(value) ? value : '000000'
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  }
}

export function rgbToHex(color: RgbColor): string {
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`
}

function createEffectBase(name: string): RgbMatrixEffectBase {
  return {
    id: createId('effect'),
    name,
    enabled: true,
    forceActivation: false,
    brightness: RGB_MATRIX_FULL_BRIGHTNESS,
    rotation: 0,
    position: { matrixStart: 0, startX: 0, startY: 0, width: RGB_MATRIX_SIZE, height: RGB_MATRIX_SIZE },
    colors: {
      active: '#0078D4',
      blink: '#FFFFFF',
      inactive: '#000000',
      inactiveBlink: '#202020'
    },
    behaviour: {
      blinking: false,
      blinkMode: 'simpleDelay',
      blinkDelayMs: 300,
      blinkOnDelayMs: 300,
      blinkOffDelayMs: 300
    },
    loopMode: 'loop',
    speed: 1,
    blink: { enabled: false, onMs: 300, offMs: 300 }
  }
}

function renderEffect(
  effect: RgbMatrixEffect,
  telemetry: TelemetrySnapshot | null,
  timeMs: number,
  frame: RgbFrame,
  options: RgbMatrixRenderOptions,
  suppressGear: boolean
): void {
  if (!effect.enabled) return
  if (effect.kind === 'group') {
    if (!effect.forceActivation && !evaluateCondition(effect.condition, telemetry)) return
    for (const child of compositeOrder(effect.effects)) renderEffect(child, telemetry, timeMs, frame, options, suppressGear)
    return
  }
  // A prevailing caution flag hides the gear entirely (flags prevail over the
  // gear). This overrides forceActivation so the flag always owns the panel; the
  // opt-out is `hideGearWhenFlagActive: false` on the flags effect.
  if (effect.kind === 'gear' && suppressGear) return
  const active = effect.forceActivation || isEffectActive(effect, telemetry)
  if (!active && effect.kind !== 'statusLed') return
  const effectTimeMs = options.elapsedMsForEffect?.(effect, timeMs) ?? timeMs
  const color = selectEffectColor(effect, active, effectTimeMs)
  // Each leaf effect renders into its own transparent scratch layer, which is
  // then composited into the shared frame scaled by the effect's brightness — so
  // brightness is per-effect while a SINGLE composed frame is still sent.
  const layer = emptyLayer()
  switch (effect.kind) {
    case 'animation':
      renderAnimation(effect, effectTimeMs, layer)
      break
    case 'flags':
      renderFlags(effect, telemetry, effectTimeMs, layer, options)
      break
    case 'gear':
      renderGear(effect, telemetry, color, effectTimeMs, layer, options)
      break
    case 'spotter':
      renderSpotter(effect, telemetry, effectTimeMs, layer)
      break
    case 'static': {
      // A static effect intentionally paints its grid OPAQUELY (black cells stay
      // black) — it can be used to deliberately blank a region.
      const grid = frameGrid(selectAnimationFrame(effect, effectTimeMs)) ?? solidGrid(rgbToHex(color))
      blitHexGrid(layer, effect.position, applyBlinkPhase(effect, effectTimeMs, grid))
      break
    }
    case 'statusLed': {
      // A status LED is OVERLAY-friendly: it renders TRANSPARENT where it is off
      // (#000000), so an INACTIVE LED no longer paints opaque black over the gear /
      // flags underneath. An ACTIVE lit colour still paints and overrides its region.
      const grid = frameGrid(selectAnimationFrame(effect, effectTimeMs)) ?? solidGrid(rgbToHex(color))
      blitHexGridTransparent(layer, effect.position, applyBlinkPhase(effect, effectTimeMs, grid))
      break
    }
  }
  compositeLayer(frame, rotateLayer(layer, effectRotation(effect)), effectBrightness(effect))
}

function isEffectActive(effect: Exclude<RgbMatrixEffect, RgbMatrixConditionalGroup>, telemetry: TelemetrySnapshot | null): boolean {
  switch (effect.kind) {
    case 'statusLed':
      return statusLedActive(effect.status, telemetry)
    case 'flags':
      return Boolean(telemetry?.connected && detectFlag(telemetry.flags))
    case 'gear':
      return Boolean(telemetry?.connected)
    case 'spotter':
      return statusLedActive('spotterCarLeft', telemetry) || statusLedActive('spotterCarRight', telemetry)
    case 'animation':
    case 'static':
      return true
  }
}

export function evaluateCondition(condition: RgbMatrixCondition, telemetry: TelemetrySnapshot | null): boolean {
  switch (condition.kind) {
    case 'gameRunning':
      return Boolean(telemetry?.connected)
    case 'gameNotRunning':
      return !telemetry?.connected
    case 'inPitLane':
      return Boolean(telemetry?.onPitRoad)
    case 'speedLimiter':
      return Boolean(telemetry?.pitLimiter)
    case 'brakePressed':
      return (telemetry?.brake ?? 0) >= condition.threshold
    case 'formulaTrue':
      return evaluateFormula(condition.formula, telemetry)
    case 'selectedCarModel':
      return Boolean(telemetry?.carName?.toLowerCase().includes(condition.carModel.toLowerCase()))
    case 'selectedGames':
      return telemetry ? condition.games.includes(telemetry.sim) : false
    case 'special':
      return condition.formula ? evaluateFormula(condition.formula, telemetry) : true
  }
}

function statusLedActive(status: RgbMatrixStatusLedId, telemetry: TelemetrySnapshot | null): boolean {
  if (!telemetry?.connected) return false
  switch (status) {
    case 'absActive':
      return Boolean(telemetry.absActive)
    case 'absOn':
      return readTelemetryBoolean(telemetry, 'abs')
    case 'brakeActive':
      return telemetry.brake > 0.05
    case 'blackFlag':
      return Boolean(telemetry.flags?.black)
    case 'blueFlag':
      return Boolean(telemetry.flags?.blue)
    case 'greenFlag':
      return Boolean(telemetry.flags?.green)
    case 'whiteFlag':
      return Boolean(telemetry.flags?.white)
    case 'yellowFlag':
      return Boolean(telemetry.flags?.yellow)
    case 'drsAvailable':
      return readTelemetryBoolean(telemetry, 'drsAvailable')
    case 'drsOn':
      return Boolean(telemetry.drs)
    case 'lowFuel':
      return lowFuel(telemetry)
    case 'redlineReached':
      return resolveShiftNow(telemetry.revLights?.blink, shiftIndicatorLevel(telemetry) >= 0.97)
    case 'speedLimiterOn':
      return Boolean(telemetry.pitLimiter)
    case 'spotterCarLeft':
      return readTelemetryBoolean(telemetry, 'spotterCarLeft')
    case 'spotterCarRight':
      return readTelemetryBoolean(telemetry, 'spotterCarRight')
    case 'tcActive':
      return Boolean(telemetry.tcActive)
    case 'tcOn':
      return readTelemetryBoolean(telemetry, 'tc')
    case 'turnLeftIndicator':
      return readTelemetryBoolean(telemetry, 'turnLeftIndicator')
    case 'turnRightIndicator':
      return readTelemetryBoolean(telemetry, 'turnRightIndicator')
  }
}

function lowFuel(telemetry: TelemetrySnapshot): boolean {
  if (typeof telemetry.fuelLiters !== 'number') return false
  if (typeof telemetry.fuelCapacityLiters === 'number' && telemetry.fuelCapacityLiters > 0) {
    return telemetry.fuelLiters / telemetry.fuelCapacityLiters <= 0.08
  }
  return telemetry.fuelLiters <= 5
}

function renderAnimation(effect: RgbMatrixAnimationEffect, timeMs: number, layer: Layer): void {
  const grid = frameGrid(selectAnimationFrame(effect, timeMs))
  if (!grid) return
  blitHexGrid(layer, effect.position, applyBlinkPhase(effect, timeMs, grid))
}


function solidGrid(color: string): HexGrid {
  return Array.from({ length: RGB_MATRIX_SIZE }, () => Array.from({ length: RGB_MATRIX_SIZE }, () => color))
}

function checkeredGrid(): HexGrid {
  const grid = emptyHexGrid()
  for (let y = 0; y < RGB_MATRIX_SIZE; y += 1) {
    for (let x = 0; x < RGB_MATRIX_SIZE; x += 1) grid[y][x] = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0 ? '#FFFFFF' : '#000000'
  }
  return grid
}

function renderFlags(
  effect: RgbMatrixFlagsEffect,
  telemetry: TelemetrySnapshot | null,
  timeMs: number,
  layer: Layer,
  options: RgbMatrixRenderOptions
): void {
  const flag =
    effect.mode === 'currentFlag' || effect.mode === 'custom' ? detectFlag(telemetry?.flags) : effect.mode
  if (!flag) return
  // GREEN renders ONLY during the brief start/restart flash window. Outside it, the
  // live green flag must not paint a green panel behind the gear during normal
  // racing — for BOTH currentFlag and custom modes (the only modes where a
  // telemetry-derived green reaches here). (Editor/test previews leave
  // greenFlashActive undefined → no green paint.)
  if (flag === 'green' && options.greenFlashActive !== true) return
  let grid: HexGrid | null = null
  // Blink + clock default to the effect's own (round-6 behaviour); an explicit
  // per-flag animation overrides both so each flag animates/blinks independently.
  let blinkSource: Pick<RgbMatrixEffectBase, 'blink' | 'colors' | 'loopMode' | 'speed'> = effect
  let blinkEnabled = effect.blink?.enabled === true
  let clockMs = timeMs
  // 1. Explicit per-flag animation (custom mode) — own per-flag activation clock + blink.
  if (effect.mode === 'custom' && isFlagName(flag)) {
    const explicit = normalizeRgbEffectAnimation(effect.flagAnimations?.[flag])
    if (explicit) {
      const animClock = options.elapsedMsForAnimationScope?.(effect, 'flag', flag, timeMs) ?? timeMs
      const animGrid = frameGrid(selectAnimationFrame(explicit, animClock))
      if (animGrid) {
        grid = animGrid
        clockMs = animClock
        blinkSource = { ...explicit, colors: effect.colors }
        blinkEnabled = explicit.blink?.enabled === true
      }
    }
  }
  // 2. Effect-level frames (round-6) → 3. legacy single-grid customPattern → 4. default.
  if (!grid) grid = frameGrid(selectAnimationFrame(effect, timeMs))
  if (!grid && effect.mode === 'custom' && isFlagName(flag)) grid = effect.customPatterns?.[flag] ?? null
  if (!grid) grid = flag === 'checkered' ? checkeredGrid() : solidGrid(flagColor(flag, effect.colors.active))
  if ((flag === 'yellow' || flag === 'blue') && !blinkEnabled && !autoCautionFlagBlinkOn(effect, timeMs)) return
  blitHexGrid(layer, effect.position, applyBlinkPhase(blinkSource, clockMs, grid))
}

function renderGear(
  effect: RgbMatrixGearEffect,
  telemetry: TelemetrySnapshot | null,
  color: RgbColor,
  timeMs: number,
  layer: Layer,
  options: RgbMatrixRenderOptions
): void {
  const label = gearLabel(telemetry?.gear)
  const redlineReached = options.redlineReachedForEffect?.(effect, telemetry) ?? statusLedActive('redlineReached', telemetry)
  const numberHex = effect.numberColor || effect.redlineNumberColor ? selectGearNumberColor(effect, redlineReached) : rgbToHex(color)
  const background = frameGrid(selectAnimationFrame(effect, timeMs))
  if (background) blitHexGrid(layer, effect.position, applyBlinkPhase(effect, timeMs, background))
  let digitGrid: HexGrid | null = null
  // Blink + clock default to the effect's own (round-6); an explicit per-gear-label
  // animation overrides both so each gear digit animates/blinks independently.
  let digitBlink: Pick<RgbMatrixEffectBase, 'blink' | 'colors' | 'loopMode' | 'speed'> = effect
  let digitClock = timeMs
  if (effect.mode === 'custom' && isGearLabel(label)) {
    const explicit = normalizeRgbEffectAnimation(effect.gearAnimations?.[label])
    if (explicit) {
      const animClock = options.elapsedMsForAnimationScope?.(effect, 'gear', label, timeMs) ?? timeMs
      const animGrid = frameGrid(selectAnimationFrame(explicit, animClock))
      if (animGrid) {
        digitGrid = animGrid
        digitClock = animClock
        digitBlink = { ...explicit, colors: effect.colors }
      }
    } else {
      const custom = effect.customGlyphs?.[label]
      if (isValidHexGrid(custom)) digitGrid = custom
    }
  }
  if (digitGrid && redlineReached) digitGrid = recolorNonBlack(digitGrid, numberHex)
  if (!digitGrid) digitGrid = buildGearGlyphHexGrid(label as GearLabel, numberHex)
  blitHexGridTransparent(layer, effect.position, applyBlinkPhase(digitBlink, digitClock, digitGrid))
}

function setPixel(layer: Layer, x: number, y: number, color: RgbColor): void {
  if (x < 0 || x >= RGB_MATRIX_SIZE || y < 0 || y >= RGB_MATRIX_SIZE) return
  layer[y][x] = color
}

function renderSpotter(
  effect: RgbMatrixSpotterEffect,
  telemetry: TelemetrySnapshot | null,
  timeMs: number,
  layer: Layer
): void {
  const color = selectEffectColor(effect, true, timeMs)
  if (statusLedActive('spotterCarLeft', telemetry)) {
    forEachPosition({ ...effect.position, width: Math.max(1, Math.ceil(effect.position.width / 3)) }, (x, y) => {
      layer[y][x] = color
    })
  }
  if (statusLedActive('spotterCarRight', telemetry)) {
    const width = Math.max(1, Math.ceil(effect.position.width / 3))
    const startX = effect.position.startX + effect.position.width - width
    forEachPosition({ ...effect.position, startX, width }, (x, y) => {
      layer[y][x] = color
    })
  }
}

function selectEffectColor(
  effect: Exclude<RgbMatrixEffect, RgbMatrixConditionalGroup>,
  active: boolean,
  timeMs: number
): RgbColor {
  const blinkingOn = blinkOn(effect.behaviour, timeMs)
  if (active) return hexToRgb(effect.behaviour.blinking && !blinkingOn ? effect.colors.blink : effect.colors.active)
  return hexToRgb(effect.behaviour.blinking && !blinkingOn ? effect.colors.inactiveBlink : effect.colors.inactive)
}

export function selectAnimationFrame(
  effect: Pick<RgbMatrixEffectBase, 'frames' | 'loopMode' | 'speed'> | RgbAnimationFrame[],
  elapsedMs: number
): RgbAnimationFrame | null {
  const frames = Array.isArray(effect) ? effect : effect.frames ?? []
  if (frames.length === 0) return null
  if (frames.length === 1) return frames[0]
  const speed = Array.isArray(effect) ? 1 : normalizeSpeed(effect.speed)
  const loopMode: RgbAnimationLoopMode = Array.isArray(effect) ? 'loop' : normalizeLoopMode(effect.loopMode)
  const durations = frames.map((frame) => Math.max(1, normalizeDurationMs(frame.durationMs)))
  const total = durations.reduce((sum, duration) => sum + duration, 0)
  const t = Math.max(0, elapsedMs * speed)
  if (loopMode === 'once' && t >= total) return frames[frames.length - 1]
  const forwardOrder = [...frames.keys()]
  const reverseOrder = frames.length > 2 ? forwardOrder.slice(1, -1).reverse() : []
  const pingpongOrder = [...forwardOrder, ...reverseOrder]
  const order = loopMode === 'pingpong' ? pingpongOrder : forwardOrder
  const cycleTotal = order.reduce((sum, index) => sum + durations[index], 0)
  let cursor = loopMode === 'once' ? t : ((t % cycleTotal) + cycleTotal) % cycleTotal
  for (const index of order) {
    cursor -= durations[index]
    if (cursor < 0) return frames[index]
  }
  return frames[frames.length - 1]
}

function frameGrid(frame: RgbAnimationFrame | null | undefined): HexGrid | null {
  if (!frame) return null
  return isValidHexGrid(frame.grid) ? frame.grid : isValidHexGrid(frame.pixels) ? frame.pixels : null
}

export function applyBlinkPhase(
  effect: Pick<RgbMatrixEffectBase, 'blink' | 'colors' | 'loopMode' | 'speed'>,
  elapsedMs: number,
  baseGrid: HexGrid
): HexGrid {
  const blink = effect.blink
  if (!blink?.enabled) return cloneHexGrid(baseGrid)
  const onMs = Math.max(1, normalizeDurationMs(blink.onMs, 300))
  const offMs = Math.max(1, normalizeDurationMs(blink.offMs, 300))
  const phase = elapsedMs % (onMs + offMs)
  if (phase < onMs) return cloneHexGrid(baseGrid)
  const alt = frameGrid(selectAnimationFrame({ frames: blink.altFrames, loopMode: effect.loopMode, speed: effect.speed }, elapsedMs))
  if (alt) return cloneHexGrid(alt)
  const color = blink.altColor ?? (blink.animateColors ? cycleBlinkColor(effect, elapsedMs) : undefined)
  if (!color) return emptyHexGrid()
  return recolorNonBlack(baseGrid, color)
}

function cycleBlinkColor(effect: Pick<RgbMatrixEffectBase, 'colors'>, elapsedMs: number): string {
  const palette = [effect.colors.active, effect.colors.blink, effect.colors.inactiveBlink, '#FF2D20', '#FFD400', '#21A366']
  return palette[Math.floor(elapsedMs / 180) % palette.length]
}

function recolorNonBlack(grid: HexGrid, color: string): HexGrid {
  return grid.map((row) => row.map((cell) => (isBlackHex(cell) ? '#000000' : color)))
}

function isBlackHex(hex: string): boolean {
  const color = hexToRgb(hex)
  return color.r === 0 && color.g === 0 && color.b === 0
}

export function selectGearNumberColor(effect: Pick<RgbMatrixGearEffect, 'numberColor' | 'redlineNumberColor' | 'colors'>, redlineReached: boolean): string {
  if (redlineReached) return effect.redlineNumberColor ?? '#FF2D20'
  return effect.numberColor ?? effect.colors.active
}

export function selectRedlineReachedWithHysteresis(level: number, wasReached: boolean, onThreshold = 0.97, offThreshold = 0.93): boolean {
  const value = Number.isFinite(level) ? level : 0
  return wasReached ? value >= offThreshold : value >= onThreshold
}

// 0..1 progress toward the shift point, used by the gear redline marker and the
// "redline reached" status LED. Reads the snapshot fields in priority order and
// NEVER recomputes rpm/maxRpm beyond the final proxy: the provider's
// `shiftIndicatorPct` (iRacing ShiftIndicatorPct) wins, then the corrected
// `revLights.pct` (maintained by the rev-lights pipeline), then a redline-relative
// top-slice band (redlineBandPct) — NOT a raw rpm/maxRpm fill, which would light
// the marker at idle. This keeps the gear-marker/status-LED on the SAME band
// pipeline as every other surface. Always returns a finite number ≥ 0.
export function shiftIndicatorLevel(telemetry: TelemetrySnapshot | null): number {
  if (!telemetry) return 0
  const shiftPct = telemetry.shiftIndicatorPct
  if (typeof shiftPct === 'number' && Number.isFinite(shiftPct)) return Math.max(0, shiftPct)
  const revPct = telemetry.revLights?.pct
  if (typeof revPct === 'number' && Number.isFinite(revPct)) return Math.max(0, revPct)
  if (typeof telemetry.maxRpm === 'number' && telemetry.maxRpm > 0 && Number.isFinite(telemetry.rpm)) {
    return redlineBandPct(telemetry.rpm, telemetry.maxRpm)
  }
  return 0
}

function autoCautionFlagBlinkOn(effect: RgbMatrixFlagsEffect, timeMs: number): boolean {
  const on = Math.max(1, effect.behaviour.blinkOnDelayMs || effect.behaviour.blinkDelayMs || 300)
  const off = Math.max(1, effect.behaviour.blinkOffDelayMs || effect.behaviour.blinkDelayMs || 300)
  return timeMs % (on + off) < on
}

function blinkOn(behaviour: RgbMatrixBehaviour, timeMs: number): boolean {
  if (!behaviour.blinking) return true
  if (behaviour.blinkMode === 'simpleDelay') {
    return Math.floor(timeMs / Math.max(1, behaviour.blinkDelayMs)) % 2 === 0
  }
  const on = Math.max(1, behaviour.blinkOnDelayMs)
  const off = Math.max(1, behaviour.blinkOffDelayMs)
  return timeMs % (on + off) < on
}

export function detectFlag(flags: Flags | undefined): FlagName | null {
  if (!flags) return null
  if (flags.black) return 'black'
  if (flags.red) return 'red'
  if (flags.meatball) return 'meatball'
  if (flags.yellow) return 'yellow'
  if (flags.blue) return 'blue'
  if (flags.white) return 'white'
  if (flags.checkered || flags.greenWhiteCheckered) return 'checkered'
  if (flags.green) return 'green'
  return null
}

function isFlagName(value: string): value is FlagName {
  return (FLAG_NAMES as readonly string[]).includes(value)
}

function isGearLabel(value: string): value is GearLabel {
  return (GEAR_LABELS as readonly string[]).includes(value)
}

function flagColor(flag: string, fallback: string): string {
  switch (flag) {
    case 'black':
      return '#050505'
    case 'red':
      return '#E81123'
    case 'meatball':
      return '#FF6A00'
    case 'yellow':
      return '#FFD400'
    case 'blue':
      return '#0078D4'
    case 'white':
      return '#F8F8F8'
    case 'green':
      return '#21A366'
    case 'solid':
      return fallback
    default:
      return fallback
  }
}

function evaluateFormula(formula: string, telemetry: TelemetrySnapshot | null): boolean {
  const trimmed = formula.trim()
  if (!trimmed) return false
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed.startsWith('!')) return !Boolean(readTelemetryPath(telemetry, trimmed.slice(1).trim()))
  const match = trimmed.match(/^([A-Za-z0-9_.]+)\s*(===|==|!==|!=|>=|<=|>|<)\s*([-+]?\d+(?:\.\d+)?|true|false|"[^"]*"|'[^']*')$/)
  if (!match) return Boolean(readTelemetryPath(telemetry, trimmed))
  const left = readTelemetryPath(telemetry, match[1])
  const right = parseFormulaValue(match[3])
  switch (match[2]) {
    case '===':
    case '==':
      return left === right
    case '!==':
    case '!=':
      return left !== right
    case '>':
      return typeof left === 'number' && typeof right === 'number' && left > right
    case '<':
      return typeof left === 'number' && typeof right === 'number' && left < right
    case '>=':
      return typeof left === 'number' && typeof right === 'number' && left >= right
    case '<=':
      return typeof left === 'number' && typeof right === 'number' && left <= right
    default:
      return false
  }
}

function parseFormulaValue(raw: string): string | number | boolean {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1)
  }
  return Number(raw)
}

function readTelemetryBoolean(telemetry: TelemetrySnapshot, key: string): boolean {
  return Boolean(readTelemetryPath(telemetry, key))
}

function readTelemetryPath(telemetry: TelemetrySnapshot | null, path: string): string | number | boolean | undefined {
  if (!telemetry) return undefined
  let current: unknown = telemetry
  for (const part of path.split('.')) {
    if (!part) return undefined
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  if (typeof current === 'string' || typeof current === 'number' || typeof current === 'boolean') return current
  return undefined
}

function emptyFrame(): RgbFrame {
  return Array.from({ length: RGB_MATRIX_SIZE }, () => Array.from({ length: RGB_MATRIX_SIZE }, () => ({ ...BLACK })))
}

// True if any pixel is lit. Lets the exclusive selector skip a top leaf that rendered
// nothing so a lower visible effect isn't blanked.
function frameHasLitPixel(frame: RgbFrame): boolean {
  for (const row of frame) for (const c of row) if (c.r !== 0 || c.g !== 0 || c.b !== 0) return true
  return false
}

// A scratch render target for ONE effect. `null` = pixel untouched (transparent),
// any colour (including black) = opaque, exactly like the previous direct-write
// behaviour. The layer is then composited into the shared frame scaled by the
// effect's brightness (see compositeLayer).
type Layer = (RgbColor | null)[][]

function emptyLayer(): Layer {
  return Array.from({ length: RGB_MATRIX_SIZE }, () => Array.from({ length: RGB_MATRIX_SIZE }, () => null))
}

function effectBrightness(effect: RgbMatrixEffectBase): number {
  const value = effect.brightness
  if (typeof value !== 'number' || !Number.isFinite(value)) return RGB_MATRIX_FULL_BRIGHTNESS
  return clampInt(value, 0, RGB_MATRIX_FULL_BRIGHTNESS)
}

// Per-effect clockwise rotation (0/90/180/270). Backward-compat: anything else
// (including a profile saved before the field existed) normalises to 0.
function effectRotation(effect: RgbMatrixEffectBase): MatrixRotation {
  return MATRIX_ROTATIONS.includes(effect.rotation as MatrixRotation) ? (effect.rotation as MatrixRotation) : 0
}

// Rotate ONE effect's scratch layer clockwise by `rotation` degrees before it is
// composited. Transparent (null) pixels stay transparent so rotation never
// "paints" the empty background. Identity-returns the same layer at 0° so the
// common case allocates nothing.
function rotateLayer(layer: Layer, rotation: MatrixRotation): Layer {
  if (rotation === 0) return layer
  const n = RGB_MATRIX_SIZE
  const out = emptyLayer()
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const px = layer[y][x]
      if (!px) continue
      let nx = x
      let ny = y
      if (rotation === 90) {
        nx = n - 1 - y
        ny = x
      } else if (rotation === 180) {
        nx = n - 1 - x
        ny = n - 1 - y
      } else {
        nx = y
        ny = n - 1 - x
      }
      out[ny][nx] = px
    }
  }
  return out
}

function scaleColor(color: RgbColor, scale: number): RgbColor {
  return {
    r: clampInt(Math.round(color.r * scale), 0, 255),
    g: clampInt(Math.round(color.g * scale), 0, 255),
    b: clampInt(Math.round(color.b * scale), 0, 255)
  }
}

function compositeLayer(frame: RgbFrame, layer: Layer, brightness: number): void {
  const scale = clampInt(brightness, 0, RGB_MATRIX_FULL_BRIGHTNESS) / RGB_MATRIX_FULL_BRIGHTNESS
  for (let y = 0; y < RGB_MATRIX_SIZE; y += 1) {
    for (let x = 0; x < RGB_MATRIX_SIZE; x += 1) {
      const px = layer[y][x]
      if (px) frame[y][x] = scale >= 1 ? px : scaleColor(px, scale)
    }
  }
}

function emptyHexGrid(): string[][] {
  return Array.from({ length: RGB_MATRIX_SIZE }, () => Array.from({ length: RGB_MATRIX_SIZE }, () => '#000000'))
}

// A blank 8×8 hex grid (all off) — used by the editor when seeding a new custom
// glyph / pattern cell.
export function emptyMatrixHexGrid(): string[][] {
  return emptyHexGrid()
}

// A grid is usable as a custom glyph/pattern iff it is 8 rows × 8 columns of
// strings. Anything else is ignored so a corrupt profile falls back to defaults.
export function isValidHexGrid(grid: unknown): grid is string[][] {
  if (!Array.isArray(grid) || grid.length !== RGB_MATRIX_SIZE) return false
  for (const row of grid) {
    if (!Array.isArray(row) || row.length !== RGB_MATRIX_SIZE) return false
    for (const cell of row) if (typeof cell !== 'string') return false
  }
  return true
}

function blitHexGrid(layer: Layer, position: RgbMatrixPosition, pixels: string[][]): void {
  forEachPosition(position, (x, y, localX, localY) => {
    layer[y][x] = hexToRgb(pixels[localY]?.[localX] ?? '#000000')
  })
}

// Like blitHexGrid but treats fully-off (#000000) cells as transparent, so a
// custom glyph paints only its lit pixels (matching the built-in font gear).
function blitHexGridTransparent(layer: Layer, position: RgbMatrixPosition, pixels: string[][]): void {
  forEachPosition(position, (x, y, localX, localY) => {
    const hex = pixels[localY]?.[localX]
    if (!hex) return
    const color = hexToRgb(hex)
    if (color.r === 0 && color.g === 0 && color.b === 0) return
    layer[y][x] = color
  })
}

function fillRect(layer: Layer, position: RgbMatrixPosition, color: RgbColor): void {
  forEachPosition(position, (x, y) => {
    layer[y][x] = color
  })
}

function forEachPosition(
  position: RgbMatrixPosition,
  visit: (x: number, y: number, localX: number, localY: number) => void
): void {
  const startX = clampInt(position.startX, 0, RGB_MATRIX_SIZE - 1)
  const startY = clampInt(position.startY, 0, RGB_MATRIX_SIZE - 1)
  const width = clampInt(position.width, 1, RGB_MATRIX_SIZE)
  const height = clampInt(position.height, 1, RGB_MATRIX_SIZE)
  for (let localY = 0; localY < height; localY += 1) {
    for (let localX = 0; localX < width; localX += 1) {
      const x = startX + localX
      const y = startY + localY
      if (x >= 0 && x < RGB_MATRIX_SIZE && y >= 0 && y < RGB_MATRIX_SIZE) visit(x, y, localX, localY)
    }
  }
}

function gearLabel(gear: number | undefined): string {
  if (gear === undefined || !Number.isFinite(gear)) return 'N'
  if (gear < 0) return 'R'
  if (gear === 0) return 'N'
  return String(Math.max(0, Math.min(9, Math.trunc(gear))))
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(Number.isFinite(value) ? value : min)))
}

function toHex(value: number): string {
  return clampInt(value, 0, 255).toString(16).padStart(2, '0')
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function kindLabel(kind: Exclude<RgbMatrixEffect['kind'], 'group'>): string {
  switch (kind) {
    case 'animation':
      return 'Animation'
    case 'flags':
      return 'Flags'
    case 'gear':
      return 'Gear'
    case 'spotter':
      return 'Spotter overlay'
    case 'static':
      return 'Static effect'
    case 'statusLed':
      return 'Status LED'
  }
}

function conditionLabel(condition: RgbMatrixCondition): string {
  switch (condition.kind) {
    case 'gameRunning':
      return 'Game running'
    case 'gameNotRunning':
      return 'Game not running'
    case 'inPitLane':
      return 'Car in pit lane'
    case 'speedLimiter':
      return 'Speed limiter ON'
    case 'brakePressed':
      return 'Brake pressed'
    case 'formulaTrue':
      return 'Custom formula'
    case 'selectedCarModel':
      return 'Selected car model'
    case 'selectedGames':
      return 'Selected games'
    case 'special':
      return 'Special wrapper'
  }
}
