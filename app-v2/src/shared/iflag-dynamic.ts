// iFlag Dynamic Info Panel — shared PURE frame generator.
//
// Renders a LIVE RACE-STATE image onto the 8×8 RGB matrix (the same iFlag panel
// driven by shared/rgb-matrix.ts), independent of the static flag/gear effects.
// Given a TelemetrySnapshot it produces an 8×8 frame that shows, at a glance:
//
//   row 0      last-lap delta vs. your best   (purple/green/yellow/red strip)
//   row 1      live delta to best (sector)    (green/red/neutral strip)
//   rows 2–6   your RACE POSITION             (1–2 digit 3×5 font, podium-tinted)
//   row 7      gap-ahead proximity bar        (more LEDs lit = closer car ahead)
//
// PURE + standalone: it imports only the telemetry type plus the FRAME TYPES and
// hex helpers from shared/rgb-matrix.ts (read-only reuse — it does NOT edit the
// matrix module). It defines its own compact 3×5 digit font so it never depends
// on the matrix's private 5×7 gear font. The frame is a drop-in RgbFrame /
// HexGrid, so the orchestrator can route it as a NEW matrix "mode" with a small
// hook (see main/modules/iflag-dynamic.ts) without changing the frame format.

import type { TelemetrySnapshot } from './telemetry'
import { RGB_MATRIX_SIZE, hexToRgb, type HexGrid, type RgbColor, type RgbFrame } from './rgb-matrix'

// ─── Palette ─────────────────────────────────────────────────────────────────

const OFF = '#000000'
const NEUTRAL = '#1A1A1A' // dim gray — "present but on pace / no delta"
const GREEN = '#16C60C'
const YELLOW = '#FCE100'
const ORANGE = '#FF8C00'
const RED = '#E81123'
const PURPLE = '#B146C2'
const WHITE = '#FFFFFF'
const GOLD = '#FFD700'
const SILVER = '#C0C0C0'
const BRONZE = '#CD7F32'

// ─── Config ──────────────────────────────────────────────────────────────────

export interface IflagDynamicConfig {
  version: 1
  enabled: boolean
  // Gap (s) to the car ahead at/above which the bottom proximity bar is empty.
  gapAheadFullSec: number
  // Dead-band (s) inside which a delta reads as "on pace" (neutral).
  deltaDeadbandSec: number
  // Last-lap delta thresholds (s off your best): <= good → green, <= ok → yellow.
  lastLapGoodSec: number
  lastLapOkSec: number
  // Tint P1/P2/P3 digits gold/silver/bronze.
  podiumColors: boolean
  // Digit colour when not a podium slot.
  positionColor: string
  // Overall brightness scale 0..1 applied to the RgbFrame channels.
  brightness: number
  updatedAt: number
}

export const DEFAULT_IFLAG_DYNAMIC_CONFIG: IflagDynamicConfig = {
  version: 1,
  enabled: false,
  gapAheadFullSec: 3,
  deltaDeadbandSec: 0.05,
  lastLapGoodSec: 0.3,
  lastLapOkSec: 1,
  podiumColors: true,
  positionColor: WHITE,
  brightness: 1,
  updatedAt: 0
}

export const IFLAG_DYNAMIC_CHANNELS = {
  getConfig: 'iflagDynamic:getConfig',
  setConfig: 'iflagDynamic:setConfig',
  configEvent: 'iflagDynamic:config',
  render: 'iflagDynamic:render'
} as const

// ─── 3×5 digit font ──────────────────────────────────────────────────────────

const DIGIT_FONT_3x5: Record<string, readonly string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111']
}

const DIGIT_W = 3
const DIGIT_H = 5
const DIGIT_TOP = 2 // rows 2..6 hold the digits

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function clampNum(value: number, min: number, max: number, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

function emptyHexGrid(): HexGrid {
  return Array.from({ length: RGB_MATRIX_SIZE }, () => Array.from({ length: RGB_MATRIX_SIZE }, () => OFF))
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

// ─── Race-state readout (pure, telemetry → semantics) ─────────────────────────

export interface IflagDynamicReadout {
  position: number | null
  positionText: string
  positionColor: string
  gapAheadSec: number | null
  gapBarLit: number
  gapBarColor: string
  liveDeltaSec: number | null
  liveDeltaColor: string
  lastLapDeltaSec: number | null
  lastLapColor: string
}

function resolvePosition(snap: TelemetrySnapshot): number | null {
  if (isFiniteNumber(snap.position) && snap.position > 0) return Math.trunc(snap.position)
  if (isFiniteNumber(snap.classPosition) && snap.classPosition > 0) return Math.trunc(snap.classPosition)
  return null
}

function positionToText(position: number | null): string {
  if (position == null) return ''
  if (position < 1) return ''
  return String(Math.min(99, position)) // 1–2 digits; clamp the rare 100+
}

function positionColorFor(position: number | null, config: IflagDynamicConfig): string {
  if (position == null) return config.positionColor
  if (config.podiumColors) {
    if (position === 1) return GOLD
    if (position === 2) return SILVER
    if (position === 3) return BRONZE
  }
  return config.positionColor
}

// Gap (s) to the car directly ahead. Prefers the relative "ahead" entry; falls
// back to the standings driver one position ahead. Returns null when unknown.
export function gapAheadSeconds(snap: TelemetrySnapshot): number | null {
  const rel = snap.relatives?.ahead?.gapSec
  if (isFiniteNumber(rel)) return Math.abs(rel)

  const myPos = resolvePosition(snap)
  if (myPos != null && Array.isArray(snap.drivers)) {
    const ahead = snap.drivers.find((d) => d.position === myPos - 1 && !d.isPlayer)
    if (ahead && isFiniteNumber(ahead.gapToPlayerSec)) return Math.abs(ahead.gapToPlayerSec)
  }
  return null
}

// Bottom proximity bar: MORE lit LEDs = CLOSER car ahead (you're catching them),
// graded green (far) → orange → red (right on their gearbox).
function gapBar(gapSec: number | null, config: IflagDynamicConfig): { lit: number; color: string } {
  if (gapSec == null) return { lit: 0, color: OFF }
  const full = Math.max(0.2, config.gapAheadFullSec)
  const closeness = 1 - clamp01(gapSec / full)
  const lit = Math.round(closeness * RGB_MATRIX_SIZE)
  let color = GREEN
  if (gapSec < 0.5) color = RED
  else if (gapSec < 1.5) color = ORANGE
  return { lit, color }
}

// Live delta to your best lap (row 1) — the running in-lap delta, which doubles
// as the current sector trend.
function liveDeltaColor(deltaSec: number | null, config: IflagDynamicConfig): string {
  if (deltaSec == null) return OFF
  if (deltaSec < -config.deltaDeadbandSec) return GREEN
  if (deltaSec > config.deltaDeadbandSec) return RED
  return NEUTRAL
}

// Last-lap delta vs. your best (row 0): purple if a personal best that is also
// the session best, then graded green/yellow/red by how far off your best.
function lastLapColor(snap: TelemetrySnapshot, config: IflagDynamicConfig): { delta: number | null; color: string } {
  const last = snap.lastLapTimeSec
  const best = snap.bestLapTimeSec
  if (!isFiniteNumber(last) || last <= 0 || !isFiniteNumber(best) || best <= 0) return { delta: null, color: OFF }
  const delta = Math.max(0, last - best)
  const isPersonalBest = delta <= config.deltaDeadbandSec
  const isSessionBest = isFiniteNumber(snap.deltaToSessionBestSec) && snap.deltaToSessionBestSec <= config.deltaDeadbandSec
  if (isPersonalBest && isSessionBest) return { delta, color: PURPLE }
  if (delta <= config.lastLapGoodSec) return { delta, color: GREEN }
  if (delta <= config.lastLapOkSec) return { delta, color: YELLOW }
  return { delta, color: RED }
}

export function computeIflagReadout(snap: TelemetrySnapshot, config: IflagDynamicConfig): IflagDynamicReadout {
  const position = resolvePosition(snap)
  const gapAheadSec = gapAheadSeconds(snap)
  const bar = gapBar(gapAheadSec, config)
  const live = isFiniteNumber(snap.deltaToBestSec) ? snap.deltaToBestSec : null
  const last = lastLapColor(snap, config)
  return {
    position,
    positionText: positionToText(position),
    positionColor: positionColorFor(position, config),
    gapAheadSec,
    gapBarLit: bar.lit,
    gapBarColor: bar.color,
    liveDeltaSec: live,
    liveDeltaColor: liveDeltaColor(live, config),
    lastLapDeltaSec: last.delta,
    lastLapColor: last.color
  }
}

// ─── Frame painting (pure) ───────────────────────────────────────────────────

function paintRow(grid: HexGrid, row: number, hex: string): void {
  if (row < 0 || row >= RGB_MATRIX_SIZE) return
  for (let x = 0; x < RGB_MATRIX_SIZE; x += 1) grid[row][x] = hex
}

function paintBarRow(grid: HexGrid, row: number, lit: number, hex: string): void {
  if (row < 0 || row >= RGB_MATRIX_SIZE) return
  const n = Math.max(0, Math.min(RGB_MATRIX_SIZE, lit))
  for (let x = 0; x < RGB_MATRIX_SIZE; x += 1) grid[row][x] = x < n ? hex : OFF
}

function paintDigit(grid: HexGrid, ch: string, originX: number, hex: string): void {
  const glyph = DIGIT_FONT_3x5[ch]
  if (!glyph) return
  for (let gy = 0; gy < DIGIT_H; gy += 1) {
    const rowBits = glyph[gy]
    for (let gx = 0; gx < DIGIT_W; gx += 1) {
      if (rowBits[gx] !== '1') continue
      const px = originX + gx
      const py = DIGIT_TOP + gy
      if (px >= 0 && px < RGB_MATRIX_SIZE && py >= 0 && py < RGB_MATRIX_SIZE) grid[py][px] = hex
    }
  }
}

function paintPosition(grid: HexGrid, text: string, hex: string): void {
  if (text.length === 0) return
  if (text.length === 1) {
    paintDigit(grid, text, Math.floor((RGB_MATRIX_SIZE - DIGIT_W) / 2), hex) // centred single digit
    return
  }
  // Two digits: 3 + 1 gap + 3 = 7 wide, centred (origin 0 → cols 0-2 / 4-6).
  const first = text[text.length - 2]
  const second = text[text.length - 1]
  const startX = Math.floor((RGB_MATRIX_SIZE - (DIGIT_W * 2 + 1)) / 2)
  paintDigit(grid, first, startX, hex)
  paintDigit(grid, second, startX + DIGIT_W + 1, hex)
}

// Build the 8×8 hex grid for the current race state. Standalone — the result is
// a plain HexGrid (string[][]) ready to feed any matrix renderer/preview.
export function renderIflagDynamicHexGrid(
  snap: TelemetrySnapshot | null,
  config: IflagDynamicConfig = DEFAULT_IFLAG_DYNAMIC_CONFIG
): HexGrid {
  const grid = emptyHexGrid()
  if (!snap || !snap.connected) return grid

  const readout = computeIflagReadout(snap, config)
  paintRow(grid, 0, readout.lastLapColor) // top: last-lap delta
  paintRow(grid, 1, readout.liveDeltaColor) // sector/live delta
  paintPosition(grid, readout.positionText, readout.positionColor) // rows 2-6
  paintBarRow(grid, 7, readout.gapBarLit, readout.gapBarColor) // bottom: gap-ahead
  return grid
}

function scaleColor(color: RgbColor, brightness: number): RgbColor {
  const b = clamp01(brightness)
  return {
    r: Math.round(color.r * b),
    g: Math.round(color.g * b),
    b: Math.round(color.b * b)
  }
}

// Build the 8×8 RgbFrame (RgbColor[][]) for the current race state, with the
// configured brightness applied. This is the matrix frame type used by
// shared/rgb-matrix.ts, so it can be composited/streamed exactly like any other
// rendered matrix frame.
export function renderIflagDynamicFrame(
  snap: TelemetrySnapshot | null,
  config: IflagDynamicConfig = DEFAULT_IFLAG_DYNAMIC_CONFIG
): RgbFrame {
  const grid = renderIflagDynamicHexGrid(snap, config)
  return grid.map((row) => row.map((hex) => scaleColor(hexToRgb(hex), config.brightness)))
}

// ─── Merge (persistence) ─────────────────────────────────────────────────────

export type IflagDynamicConfigPatch = Partial<Omit<IflagDynamicConfig, 'version' | 'updatedAt'>> & {
  version?: 1
  updatedAt?: number
}

function sanitizeHex(value: string | undefined, fallback: string): string {
  if (typeof value !== 'string') return fallback
  return /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim().toUpperCase() : fallback
}

export function mergeIflagDynamicConfig(base: IflagDynamicConfig, patch: IflagDynamicConfigPatch): IflagDynamicConfig {
  return {
    version: 1,
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : base.enabled,
    gapAheadFullSec: clampNum(patch.gapAheadFullSec ?? base.gapAheadFullSec, 0.2, 30, base.gapAheadFullSec),
    deltaDeadbandSec: clampNum(patch.deltaDeadbandSec ?? base.deltaDeadbandSec, 0, 2, base.deltaDeadbandSec),
    lastLapGoodSec: clampNum(patch.lastLapGoodSec ?? base.lastLapGoodSec, 0, 5, base.lastLapGoodSec),
    lastLapOkSec: clampNum(patch.lastLapOkSec ?? base.lastLapOkSec, 0, 10, base.lastLapOkSec),
    podiumColors: typeof patch.podiumColors === 'boolean' ? patch.podiumColors : base.podiumColors,
    positionColor: sanitizeHex(patch.positionColor, base.positionColor),
    brightness: clampNum(patch.brightness ?? base.brightness, 0, 1, base.brightness),
    updatedAt: Date.now()
  }
}
