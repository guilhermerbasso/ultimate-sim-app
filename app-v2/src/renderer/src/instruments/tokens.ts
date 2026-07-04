// ── Instrument design tokens ──────────────────────────────────────────────────
// Single source of truth for the high-fidelity SVG instrument primitives in this
// folder. Brand-neutral (no manufacturer logos/names). Reuses the GT3 colour
// discipline from dashboard/widgets/gt3-theme.ts (import only — never edited):
//
//   • WARM tones (red / orange / amber / chrome) = decoration, accents, warnings.
//   • COOL / GREEN  = positive "good" STATE ONLY (delta better, optimal temp …).
//   • GLOW is reserved for LEDs and active alerts — never decorative chrome.
//
// All helpers here are pure and NaN-safe so a null/extreme telemetry value can
// never produce NaN/undefined in rendered SVG markup.

import { GT3 } from '../dashboard/widgets/gt3-theme'

// ── Numeric guards (NaN/undefined-safe) ──────────────────────────────────────
export function safe(n: number | undefined | null, fallback = 0): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback
}

export function clamp(n: number | undefined | null, min: number, max: number): number {
  const v = safe(n, min)
  if (max < min) return min
  return Math.min(max, Math.max(min, v))
}

export function clamp01(n: number | undefined | null): number {
  return clamp(n, 0, 1)
}

/** Map a value within [min,max] to a 0..1 fraction (NaN-safe, clamped). */
export function fraction(value: number | undefined | null, min: number, max: number): number {
  const lo = safe(min, 0)
  const hi = safe(max, 1)
  if (hi === lo) return 0
  return clamp01((safe(value, lo) - lo) / (hi - lo))
}

/** Format a number with fixed decimals, guarding NaN/undefined to a dash. */
export function fmtNum(value: number | undefined | null, decimals = 0, dash = '—'): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return dash
  return value.toFixed(Math.max(0, Math.min(8, Math.trunc(safe(decimals, 0)))))
}

/** Degrees → radians. */
export function deg2rad(d: number): number {
  return (safe(d, 0) * Math.PI) / 180
}

/**
 * Critically-damped step of a needle/value toward a target. Pure helper the
 * AnalogDial/Needle use for the optional damped-needle behaviour:
 *   next = prev + (target - prev) * (1 - damp)
 * `damp` is the fraction of the gap RETAINED each frame (0 = snap, →1 = sluggish).
 */
export function dampStep(prev: number, target: number, damp = 0): number {
  const d = clamp01(damp)
  return safe(prev, target) + (safe(target, 0) - safe(prev, target)) * (1 - d)
}

// ── Fonts (reuse the embedded DSEG / condensed faces) ─────────────────────────
export const FONT_SEG7 = "'DSEG7Classic-Regular', 'Cascadia Code', monospace"
export const FONT_SEG14 = "'DSEG14Classic-Regular', 'DSEG7Classic-Regular', monospace"
export const FONT_COND = "'Chakra Petch', 'Michroma', sans-serif"
export const FONT_TECH = "'Rajdhani', 'Barlow Condensed', sans-serif"

// DSEG 7-seg renders garbled for letters/symbols, and has NO glyph for %, + or ±.
// Pure numerals (optionally minus-signed, with decimals/colons/commas) → DSEG7;
// anything carrying letters OR a %/+/± symbol routes to the 14-seg / condensed face.
export function isNumericReadout(v: unknown): boolean {
  return typeof v === 'string' && /^\s*[-−]?\d[\d.,:\s]*$/.test(v)
}

// ── Colour token set ─────────────────────────────────────────────────────────
export interface InstrumentColors {
  /** cool / green — positive "good" STATE only. */
  good: string
  /** amber — warn / chrome ramp midpoint. */
  warn: string
  /** red — danger / over-limit. */
  danger: string
  /** white redline flash. */
  flash: string
  /** warm chrome decoration (bezels, accents). */
  chrome: string
  /** warm accent highlight. */
  accent: string
  text: string
  textDim: string
  textMuted: string
  /** instrument face / matte surface. */
  surface: string
  /** recessed dark behind LEDs / segments. */
  recess: string
  /** hairline stroke. */
  stroke: string
  /** brighter hairline for hot/raised edges. */
  strokeHot: string
  /** brushed-metal bezel midtone. */
  bezel: string
  bezelHi: string
  bezelLo: string
}

// Seeded from the GT3 palette (import only). Cool/green is the single state-good
// hue; warm amber/orange/chrome carry all decoration.
export const INSTRUMENT_COLORS: InstrumentColors = {
  good: GT3.good,
  warn: GT3.amber,
  danger: GT3.red,
  flash: GT3.whiteFlash,
  chrome: GT3.chrome,
  accent: GT3.accent,
  text: GT3.textPrimary,
  textDim: GT3.textSecondary,
  textMuted: GT3.textMuted,
  surface: '#070707',
  recess: '#040404',
  stroke: GT3.panelStroke,
  strokeHot: GT3.panelStrokeHot,
  bezel: '#3A3A3A',
  bezelHi: '#6E6E6E',
  bezelLo: '#141414'
}

/** Merge caller overrides onto the canonical token set. */
export function resolveColors(overrides?: Partial<InstrumentColors>): InstrumentColors {
  return overrides ? { ...INSTRUMENT_COLORS, ...overrides } : INSTRUMENT_COLORS
}

// ── Rev / RPM zone ramp ───────────────────────────────────────────────────────
// Standard green → amber → red motorsport ramp keyed by a 0..1 fraction. `warnAt`
// is the green→amber boundary, `dangerAt` the amber→red boundary.
export function revZoneColor(
  frac: number,
  colors: InstrumentColors,
  warnAt = 0.55,
  dangerAt = 0.8
): string {
  const f = clamp01(frac)
  if (f >= clamp01(dangerAt)) return colors.danger
  if (f >= clamp01(warnAt)) return colors.warn
  return colors.good
}

// ── Material kinds (matte / carbon weave / brushed metal) ─────────────────────
export type MaterialKind = 'matte' | 'carbon' | 'brushed'

// ── Bezel kinds ───────────────────────────────────────────────────────────────
export type BezelKind = 'none' | 'thin' | 'chrome' | 'double'
