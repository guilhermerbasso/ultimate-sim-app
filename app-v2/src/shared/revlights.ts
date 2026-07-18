import type { TelemetrySnapshot } from './telemetry'

// SIM-X firmware: 4 WS2813 LEDs on pin D10. The "R<lvl>\n" command sets the
// number of LEDs that should be on (0..NUM_REV_LEDS), and "B<0|1>\n" toggles
// the blue shift-indicator blink. Colours of each LED segment are baked into
// the firmware, so this engine doesn't actually push per-LED colours — it
// just picks a level and asks the firmware to render it.
//
// Even though the count is fixed to 4 on the real device, the config UI lets
// the user pick 1..16 to make the engine portable to other strip lengths
// (clamped to the device LED count at send time).

export const REVLIGHTS_DEVICE_LED_COUNT = 4
export const REVLIGHTS_MAX_LED_COUNT = 16
export const REVLIGHTS_MIN_LED_COUNT = 1

// Cars that don't publish iRacing's per-car shift-light RPMs still need a sane
// rev-lights fill. Light only the TOP slice of the rev range (redline-relative)
// instead of a 0..maxRpm proportional fill that would glow at idle. These match
// the provider's fallback so every surface (buttonbox/iFlag/dashboard/overlay)
// agrees for the same RPM. Defaults: first light at 92% of redline, all lit at
// 99%, blink near the very top of the band.
export const FALLBACK_SHIFT_BAND_START_FRAC = 0.92
export const FALLBACK_SHIFT_BAND_END_FRAC = 0.99
export const FALLBACK_SHIFT_BLINK_PCT = 0.98

// Map an absolute RPM onto a 0..1 shift-light fill across the redline-relative
// fallback band. Returns 0 below the band start and 1 at/after the band end —
// never a 0..maxRpm proportional value.
export function redlineBandPct(rpm: number, redlineRpm: number): number {
  if (!Number.isFinite(rpm) || !Number.isFinite(redlineRpm) || redlineRpm <= 0) return 0
  const start = redlineRpm * FALLBACK_SHIFT_BAND_START_FRAC
  const end = redlineRpm * FALLBACK_SHIFT_BAND_END_FRAC
  if (!(end > start)) return 0
  return clamp01((rpm - start) / (end - start))
}

export function resolveShiftNow(
  blink: boolean | null | undefined,
  fallbackActive: boolean
): boolean {
  return typeof blink === 'boolean' ? blink : fallbackActive
}

export type RevlightsPresetId =
  | 'progressive'
  | 'segmented-gtr'
  | 'segmented-formula'
  | 'f1'
  | 'rainforest'
  | 'shift-only'
  | 'custom'

export type RevlightsBlinkPattern = 'solid' | 'slow' | 'fast' | 'strobe'

export interface RevlightsSegment {
  // RPM threshold (0..1 of maxRpm) above which this segment lights up.
  startPct: number
  color: string
  label: string
}

export interface RevlightsFlagColors {
  yellow: string
  blue: string
  white: string
  red: string
  meatball: string
  greenWhiteCheckered: string
}

export interface RevlightsConfig {
  enabled: boolean
  ledCount: number
  startRpmPct: number
  // RPM (0..1 of maxRpm) above which the blue blink fires.
  shiftRpmPct: number
  shiftBlink: boolean
  shiftBlinkPattern: RevlightsBlinkPattern
  // Prefer the sim's per-car shift-light band (snapshot.shiftIndicatorPct /
  // revLights.pct, which the provider maps across DriverCarSLFirstRPM →
  // DriverCarSLShiftRPM). When false, fall back to a redline-relative top-slice
  // band (redlineBandPct) — never a 0..maxRpm proportional fill.
  useShiftIndicatorPct: boolean
  preset: RevlightsPresetId
  segments: RevlightsSegment[]
  flagColors: RevlightsFlagColors
  // Show steady-on yellow/blue/white flag colours through the strip whenever
  // the matching flag is shown. Has zero impact on the firmware (firmware
  // doesn't accept per-LED colours), but powers the UI preview and is wired
  // through R/B so user can see at-a-glance feedback.
  flagBlink: boolean
  updatedAt: string
}

export interface RevlightsStatus {
  enabled: boolean
  level: number
  shiftActive: boolean
  rpm: number
  maxRpm: number
  shiftIndicatorPct: number | null
  lastError: string | null
  connected: boolean
  flag: keyof RevlightsFlagColors | null
}

export const DEFAULT_FLAG_COLORS: RevlightsFlagColors = {
  yellow: '#FFCC00',
  blue: '#1F8DFF',
  white: '#F2F2F2',
  red: '#E83A2F',
  meatball: '#FF7A1A',
  greenWhiteCheckered: '#36D17C'
}

const PROGRESSIVE_SEGMENTS: RevlightsSegment[] = [
  { startPct: 0.50, color: '#36D17C', label: 'Verde 1' },
  { startPct: 0.65, color: '#36D17C', label: 'Verde 2' },
  { startPct: 0.78, color: '#FFCC00', label: 'Amarelo' },
  { startPct: 0.90, color: '#E83A2F', label: 'Vermelho' }
]

const SEGMENTED_GTR: RevlightsSegment[] = [
  { startPct: 0.55, color: '#33D17C', label: 'Verde' },
  { startPct: 0.70, color: '#FFCC00', label: 'Amber' },
  { startPct: 0.82, color: '#FF6A2A', label: 'Laranja' },
  { startPct: 0.92, color: '#E83A2F', label: 'Vermelho' }
]

const SEGMENTED_FORMULA: RevlightsSegment[] = [
  { startPct: 0.60, color: '#1F8DFF', label: 'Azul' },
  { startPct: 0.72, color: '#33D17C', label: 'Verde' },
  { startPct: 0.84, color: '#FFCC00', label: 'Amarelo' },
  { startPct: 0.95, color: '#E83A2F', label: 'Vermelho' }
]

// F1 mode is a behavior/config preset: only the top RPM window lights up, then
// shift blink fires near the limiter. Exact per-LED green/amber/red rendering is
// still firmware-owned until SIM-X accepts app-driven RGB values.
const F1_SEGMENTS: RevlightsSegment[] = [
  { startPct: 0.90, color: '#33D17C', label: 'Verde' },
  { startPct: 0.94, color: '#FFCC00', label: 'Amber' },
  { startPct: 0.97, color: '#E83A2F', label: 'Vermelho' }
]

const RAINFOREST: RevlightsSegment[] = [
  { startPct: 0.45, color: '#33D17C', label: 'Verde' },
  { startPct: 0.62, color: '#26B5A5', label: 'Teal' },
  { startPct: 0.78, color: '#1F8DFF', label: 'Azul' },
  { startPct: 0.92, color: '#9C5BE6', label: 'Roxo' }
]

const SHIFT_ONLY: RevlightsSegment[] = [
  { startPct: 0.95, color: '#1F8DFF', label: 'Shift' }
]

export interface RevlightsPreset {
  id: RevlightsPresetId
  name: string
  description: string
  baseConfig: Partial<RevlightsConfig>
}

export const REVLIGHTS_PRESETS: RevlightsPreset[] = [
  {
    id: 'progressive',
    name: 'Progressivo',
    description: 'Verde → amarelo → vermelho conforme a RPM sobe.',
    baseConfig: {
      preset: 'progressive',
      ledCount: REVLIGHTS_DEVICE_LED_COUNT,
      startRpmPct: 0.50,
      shiftRpmPct: 0.95,
      segments: [...PROGRESSIVE_SEGMENTS]
    }
  },
  {
    id: 'segmented-gtr',
    name: 'GT3 / GTR',
    description: 'Green, amber, orange, red ? calibrated for GT/Touring.',
    baseConfig: {
      preset: 'segmented-gtr',
      ledCount: REVLIGHTS_DEVICE_LED_COUNT,
      startRpmPct: 0.55,
      shiftRpmPct: 0.95,
      segments: [...SEGMENTED_GTR]
    }
  },
  {
    id: 'segmented-formula',
    name: 'Formula / LMP',
    description: 'Blue, green, yellow, and red ? high revs, very high shift point.',
    baseConfig: {
      preset: 'segmented-formula',
      ledCount: REVLIGHTS_DEVICE_LED_COUNT,
      startRpmPct: 0.60,
      shiftRpmPct: 0.97,
      segments: [...SEGMENTED_FORMULA]
    }
  },
  {
    id: 'f1',
    name: 'Modo F1',
    description: 'Lights only in the final 10% of RPM: green ? amber ? red, with shift blink.',
    baseConfig: {
      preset: 'f1',
      ledCount: REVLIGHTS_DEVICE_LED_COUNT,
      startRpmPct: 0.90,
      shiftRpmPct: 0.985,
      shiftBlink: true,
      shiftBlinkPattern: 'fast',
      segments: [...F1_SEGMENTS]
    }
  },
  {
    id: 'rainforest',
    name: 'Rainforest',
    description: 'Paleta cool (verde → teal → azul → roxo) para visibilidade em diurno.',
    baseConfig: {
      preset: 'rainforest',
      ledCount: REVLIGHTS_DEVICE_LED_COUNT,
      startRpmPct: 0.45,
      shiftRpmPct: 0.93,
      segments: [...RAINFOREST]
    }
  },
  {
    id: 'shift-only',
    name: 'Shift only',
    description: 'Only flashes blue at the shift point ? no progressive colors.',
    baseConfig: {
      preset: 'shift-only',
      ledCount: REVLIGHTS_DEVICE_LED_COUNT,
      startRpmPct: 0.95,
      shiftRpmPct: 0.95,
      segments: [...SHIFT_ONLY]
    }
  }
]

export const DEFAULT_REVLIGHTS_CONFIG: RevlightsConfig = {
  enabled: false,
  ledCount: REVLIGHTS_DEVICE_LED_COUNT,
  startRpmPct: 0.50,
  shiftRpmPct: 0.95,
  shiftBlink: true,
  shiftBlinkPattern: 'fast',
  useShiftIndicatorPct: true,
  preset: 'progressive',
  segments: [...PROGRESSIVE_SEGMENTS],
  flagColors: { ...DEFAULT_FLAG_COLORS },
  flagBlink: false,
  updatedAt: new Date(0).toISOString()
}

const PRESET_ID_SET = new Set<RevlightsPresetId>(REVLIGHTS_PRESETS.map((preset) => preset.id))
PRESET_ID_SET.add('custom')

export function isRevlightsPresetId(value: string): value is RevlightsPresetId {
  return PRESET_ID_SET.has(value as RevlightsPresetId)
}

export function clampLedCount(value: number): number {
  return clamp(Math.round(value), REVLIGHTS_MIN_LED_COUNT, REVLIGHTS_MAX_LED_COUNT)
}

export function normalizeRevlightsConfig(input: Partial<RevlightsConfig> | null | undefined): RevlightsConfig {
  const base = DEFAULT_REVLIGHTS_CONFIG
  const segments = Array.isArray(input?.segments) && input.segments.length > 0
    ? sortSegments(input.segments.map(normalizeSegment))
    : base.segments

  const flagColors: RevlightsFlagColors = {
    ...DEFAULT_FLAG_COLORS,
    ...(input?.flagColors ?? {})
  }

  const preset = input?.preset && isRevlightsPresetId(input.preset) ? input.preset : base.preset

  return {
    enabled: Boolean(input?.enabled ?? base.enabled),
    ledCount: clampLedCount(Number(input?.ledCount ?? base.ledCount)),
    startRpmPct: clamp01(Number(input?.startRpmPct ?? base.startRpmPct)),
    shiftRpmPct: clamp01(Number(input?.shiftRpmPct ?? base.shiftRpmPct)),
    shiftBlink: Boolean(input?.shiftBlink ?? base.shiftBlink),
    shiftBlinkPattern: normalizePattern(input?.shiftBlinkPattern),
    useShiftIndicatorPct: Boolean(input?.useShiftIndicatorPct ?? base.useShiftIndicatorPct),
    preset,
    segments,
    flagColors,
    flagBlink: Boolean(input?.flagBlink ?? base.flagBlink),
    updatedAt: typeof input?.updatedAt === 'string' ? input.updatedAt : new Date().toISOString()
  }
}

export function applyPreset(presetId: RevlightsPresetId, base: RevlightsConfig): RevlightsConfig {
  const preset = REVLIGHTS_PRESETS.find((candidate) => candidate.id === presetId)
  if (!preset) return base
  return normalizeRevlightsConfig({
    ...base,
    ...preset.baseConfig,
    segments: preset.baseConfig.segments ?? base.segments,
    flagColors: base.flagColors,
    enabled: base.enabled,
    shiftBlink: preset.baseConfig.shiftBlink ?? base.shiftBlink,
    shiftBlinkPattern: preset.baseConfig.shiftBlinkPattern ?? base.shiftBlinkPattern,
    flagBlink: base.flagBlink,
    useShiftIndicatorPct: base.useShiftIndicatorPct,
    updatedAt: new Date().toISOString()
  })
}

export interface RevlightsComputation {
  level: number
  shiftActive: boolean
  rpmPct: number
  flag: keyof RevlightsFlagColors | null
}

// Decide how many LEDs should be on (0..ledCount) and whether to blink the
// shift light, based on a telemetry snapshot.
export function computeRevlights(snapshot: TelemetrySnapshot | null, config: RevlightsConfig): RevlightsComputation {
  if (!snapshot?.connected) {
    return { level: 0, shiftActive: false, rpmPct: 0, flag: null }
  }

  const rpm = Number(snapshot.rpm)
  const maxRpm = Number(snapshot.maxRpm ?? 0)
  let pct = 0

  // The provider already maps RPM across the per-car shift-light band into
  // shiftIndicatorPct (and the identical revLights.pct): 0 below the first light,
  // 1 at/after the raw shift RPM. Drive the LEDs straight off that band — NEVER rpm/maxRpm,
  // which lights the strip proportionally at all RPM (the bug this replaces).
  const indicator = snapshot.shiftIndicatorPct
  const bandPct = snapshot.revLights?.pct
  if (config.useShiftIndicatorPct && typeof indicator === 'number' && Number.isFinite(indicator)) {
    pct = clamp01(indicator)
  } else if (config.useShiftIndicatorPct && typeof bandPct === 'number' && Number.isFinite(bandPct)) {
    pct = clamp01(bandPct)
  } else if (maxRpm > 0 && Number.isFinite(rpm)) {
    // No sim band available (or user opted out): synthesise a redline-relative
    // top-slice band instead of a 0..maxRpm proportional fill.
    pct = redlineBandPct(rpm, maxRpm)
  }

  const start = config.startRpmPct
  let level = 0
  if (pct >= start && config.ledCount > 0) {
    const remaining = Math.max(0, 1 - start)
    const normalized = remaining > 0 ? (pct - start) / remaining : 1
    level = Math.round(clamp01(normalized) * config.ledCount)
    if (level < 1 && pct >= start) level = 1
  }
  level = clamp(level, 0, config.ledCount)

  const shiftActive = config.shiftBlink && resolveShiftNow(
    snapshot.revLights?.blink,
    pct >= config.shiftRpmPct
  )
  if (shiftActive) level = config.ledCount

  return { level, shiftActive, rpmPct: pct, flag: detectFlag(snapshot) }
}

function detectFlag(snapshot: TelemetrySnapshot): keyof RevlightsFlagColors | null {
  const flags = snapshot.flags
  if (!flags) return null
  if (flags.red) return 'red'
  if (flags.meatball) return 'meatball'
  if (flags.yellow) return 'yellow'
  if (flags.blue) return 'blue'
  if (flags.white) return 'white'
  if (flags.greenWhiteCheckered) return 'greenWhiteCheckered'
  return null
}

// For UI preview only — map a level into the per-LED colour using the segments.
export function previewLedColors(config: RevlightsConfig, level: number): string[] {
  const colors: string[] = []
  const ledCount = config.ledCount
  for (let index = 0; index < ledCount; index += 1) {
    const rpmWindow = Math.max(0, 1 - config.startRpmPct)
    const ledPct = ledCount > 0 ? config.startRpmPct + (((index + 1) / ledCount) * rpmWindow) : 0
    colors.push(level > index ? colorForSegment(config.segments, ledPct) : '#1c1f24')
  }
  return colors
}

function colorForSegment(segments: RevlightsSegment[], pct: number): string {
  const ordered = sortSegments(segments)
  let pick = ordered[0]?.color ?? '#36D17C'
  for (const segment of ordered) {
    if (pct >= segment.startPct) pick = segment.color
  }
  return pick
}

function normalizeSegment(input: Partial<RevlightsSegment> | null | undefined): RevlightsSegment {
  return {
    startPct: clamp01(Number(input?.startPct ?? 0)),
    color: typeof input?.color === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(input.color)
      ? input.color
      : '#36D17C',
    label: typeof input?.label === 'string' ? input.label.slice(0, 32) : 'LED'
  }
}

function sortSegments(segments: RevlightsSegment[]): RevlightsSegment[] {
  return [...segments].sort((a, b) => a.startPct - b.startPct)
}

function normalizePattern(value: RevlightsBlinkPattern | undefined): RevlightsBlinkPattern {
  if (value === 'solid' || value === 'slow' || value === 'fast' || value === 'strobe') return value
  return 'fast'
}

function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}
