import type { TelemetrySnapshot } from './telemetry'
import { formatMeasurement, type MeasurementKind, type UnitSystem } from './units'

// SIM-X firmware: SSD1306 128×64 OLED.
//  - Text mode  (cmd "O"): 3 lines, ≤21 ASCII chars each, joined by "|".
//  - Bignum mode (cmd "D"): up to 9 chars rendered with the logisoso 38px font,
//    which only paints "0-9", "+", "-", ".".

export type OledPresetId =
  | 'race'
  | 'fuel'
  | 'timing'
  | 'tyres'
  | 'inputs'
  | 'weather'
  | 'delta-bignum'
  | 'gap-bignum'

export type OledPageKind = 'text' | 'bignum'

export interface OledPreset {
  id: OledPresetId
  name: string
  description: string
  kind: OledPageKind
  fields: string[]
}

export interface OledDashboardConfig {
  pages: OledPresetId[]
  activeIndex: number
  intervalMs: number
  enabled: boolean
  updatedAt: string
}

export interface OledDashboardStatus {
  enabled: boolean
  activeIndex: number
  activePresetId: OledPresetId
  connected: boolean
  lastPayload: string | null
  lastError: string | null
}

export interface OledRenderedTextPage {
  presetId: OledPresetId
  title: string
  kind: 'text'
  lines: [string, string, string]
  payload: string
}

export interface OledRenderedBigNumPage {
  presetId: OledPresetId
  title: string
  kind: 'bignum'
  value: string
  payload: string
}

export type OledRenderedPage = OledRenderedTextPage | OledRenderedBigNumPage

export const OLED_MIN_INTERVAL_MS = 500
export const OLED_MAX_INTERVAL_MS = 30_000
export const OLED_DEFAULT_INTERVAL_MS = 2500
export const OLED_LINE_LENGTH = 21
export const OLED_LINE_COUNT = 3
export const OLED_BIGNUM_LENGTH = 9
export const OLED_BIGNUM_ALPHABET = /^[0-9+\-. ]*$/

export const OLED_PRESETS: OledPreset[] = [
  {
    id: 'race',
    name: 'Race',
    description: 'Position, current lap, and delta to the leader.',
    kind: 'text',
    fields: ['position', 'lap', 'last lap', 'delta']
  },
  {
    id: 'fuel',
    name: 'Fuel',
    description: 'Fuel remaining, consumption per lap, and laps remaining.',
    kind: 'text',
    fields: ['fuel', 'usage/lap', 'laps remaining']
  },
  {
    id: 'timing',
    name: 'Times / Delta',
    description: 'Current lap, best lap, and delta to best.',
    kind: 'text',
    fields: ['current', 'best', 'delta']
  },
  {
    id: 'tyres',
    name: 'Tires',
    description: 'LF/RF, LR/RR, and average temperature.',
    kind: 'text',
    fields: ['LF', 'RF', 'LR', 'RR']
  },
  {
    id: 'inputs',
    name: 'Inputs',
    description: 'Throttle, brake, gear, and speed.',
    kind: 'text',
    fields: ['throttle', 'brake', 'gear', 'speed']
  },
  {
    id: 'weather',
    name: 'Weather',
    description: 'Track/air temperature and wetness.',
    kind: 'text',
    fields: ['track temp', 'air temp', 'wetness']
  },
  {
    id: 'delta-bignum',
    name: 'Delta (BIG)',
    description: 'Delta against the best lap in a giant font (38 px).',
    kind: 'bignum',
    fields: ['delta']
  },
  {
    id: 'gap-bignum',
    name: 'Gap (BIG)',
    description: 'Gap in seconds to the car ahead in a giant font.',
    kind: 'bignum',
    fields: ['gap']
  }
]

export const DEFAULT_OLED_CONFIG: OledDashboardConfig = {
  pages: ['race', 'fuel', 'timing'],
  activeIndex: 0,
  intervalMs: OLED_DEFAULT_INTERVAL_MS,
  enabled: true,
  updatedAt: new Date(0).toISOString()
}

const PRESET_SET = new Set<OledPresetId>(OLED_PRESETS.map((preset) => preset.id))

export function isOledPresetId(value: string): value is OledPresetId {
  return PRESET_SET.has(value as OledPresetId)
}

export function getOledPreset(presetId: OledPresetId): OledPreset {
  return OLED_PRESETS.find((preset) => preset.id === presetId) ?? OLED_PRESETS[0]
}

export function normalizeOledConfig(input: Partial<OledDashboardConfig> | null | undefined): OledDashboardConfig {
  const pages = (input?.pages ?? DEFAULT_OLED_CONFIG.pages).filter(isOledPresetId)
  const safePages = pages.length > 0 ? Array.from(new Set(pages)) : DEFAULT_OLED_CONFIG.pages
  const interval = Number(input?.intervalMs ?? DEFAULT_OLED_CONFIG.intervalMs)
  const intervalMs = clamp(Math.round(interval), OLED_MIN_INTERVAL_MS, OLED_MAX_INTERVAL_MS)
  const rawActiveIndex = Number(input?.activeIndex ?? DEFAULT_OLED_CONFIG.activeIndex)
  const activeIndex = clamp(Math.trunc(Number.isFinite(rawActiveIndex) ? rawActiveIndex : 0), 0, safePages.length - 1)

  return {
    pages: safePages,
    activeIndex,
    intervalMs,
    enabled: Boolean(input?.enabled ?? DEFAULT_OLED_CONFIG.enabled),
    updatedAt: typeof input?.updatedAt === 'string' ? input.updatedAt : new Date().toISOString()
  }
}

export function formatOledPage(snapshot: TelemetrySnapshot | null, presetId: OledPresetId, unitSystem: UnitSystem = 'metric'): OledRenderedPage {
  const preset = getOledPreset(presetId)
  if (preset.kind === 'bignum') return renderBigNumPage(preset, snapshot)
  return renderTextPage(preset, snapshot, unitSystem)
}

export function formatOledConfigPage(config: OledDashboardConfig, snapshot: TelemetrySnapshot | null, unitSystem: UnitSystem = 'metric'): OledRenderedPage {
  const normalized = normalizeOledConfig(config)
  return formatOledPage(snapshot, normalized.pages[normalized.activeIndex] ?? normalized.pages[0], unitSystem)
}

export function sanitizeOledLine(value: string): string {
  return sanitizeAscii(value).slice(0, OLED_LINE_LENGTH)
}

// The rev38 firmware reads the serial frame into `char serialBuf[64]` and only
// keeps bytes while `serialBufLen < 63`; the 64th byte resets the buffer and
// the WHOLE command is silently dropped. The "O" frame spends 3 of those bytes
// on the leading "O" and the two "|" separators, so the three text lines
// combined must stay within 60 chars (3 full 21-char lines = 63 would blow the
// 66-byte frame and never reach the OLED). Trim from the last line backward so
// the top lines survive.
export const OLED_FRAME_MAX_TEXT = 60

export function budgetOledLines(line1: string, line2: string, line3: string): [string, string, string] {
  let a = sanitizeOledLine(line1 ?? '')
  let b = sanitizeOledLine(line2 ?? '')
  let c = sanitizeOledLine(line3 ?? '')
  let over = a.length + b.length + c.length - OLED_FRAME_MAX_TEXT
  if (over > 0) {
    const trim = Math.min(over, c.length)
    c = c.slice(0, c.length - trim)
    over -= trim
  }
  if (over > 0) {
    const trim = Math.min(over, b.length)
    b = b.slice(0, b.length - trim)
    over -= trim
  }
  if (over > 0) {
    a = a.slice(0, Math.max(0, a.length - over))
  }
  return [a, b, c]
}

export function sanitizeOledBigNum(value: string): string {
  // BIGNUM only paints 0-9, +, -, . — strip everything else before clamping.
  const ascii = sanitizeAscii(value)
  return ascii
    .replace(/[^0-9+\-. ]/g, '')
    .trim()
    .slice(0, OLED_BIGNUM_LENGTH)
}

function renderTextPage(preset: OledPreset, snapshot: TelemetrySnapshot | null, unitSystem: UnitSystem): OledRenderedTextPage {
  const raw = renderLines(snapshot, preset.id, unitSystem)
  const lines: [string, string, string] = [sanitizeOledLine(raw[0]), sanitizeOledLine(raw[1]), sanitizeOledLine(raw[2])]
  return {
    presetId: preset.id,
    title: preset.name,
    kind: 'text',
    lines,
    payload: `${lines[0]}|${lines[1]}|${lines[2]}`
  }
}

function renderBigNumPage(preset: OledPreset, snapshot: TelemetrySnapshot | null): OledRenderedBigNumPage {
  const raw = renderBigNumValue(snapshot, preset.id)
  const value = sanitizeOledBigNum(raw)
  return {
    presetId: preset.id,
    title: preset.name,
    kind: 'bignum',
    value,
    payload: value
  }
}

function renderLines(snapshot: TelemetrySnapshot | null, presetId: OledPresetId, unitSystem: UnitSystem): [string, string, string] {
  if (!snapshot?.connected) return ['OLED DASHBOARD', 'NO TELEMETRY', '']

  switch (presetId) {
    case 'race':
      return [
        `POS ${valueOrDash(snapshot.position)}/${valueOrDash(snapshot.totalCars)}`,
        `LAP ${valueOrDash(snapshot.currentLap)}  LAST ${fmtLap(snapshot.lastLapTimeSec)}`,
        `DELTA ${fmtDelta(snapshot.deltaToBestSec)}`
      ]
    case 'fuel':
      return [
        `FUEL ${fmtMeasurement(snapshot.fuelLiters, 'fuel-volume-l', unitSystem, 1)}`,
        `USE  ${fmtMeasurement(snapshot.fuelPerLap, 'fuel-per-lap-l', unitSystem, 2)}`,
        `LEFT ${fmtNumber(fuelLapsRemaining(snapshot), 1)} LAPS`
      ]
    case 'timing':
      return [
        `NOW  ${fmtLap(snapshot.currentLapTimeSec)}`,
        `BEST ${fmtLap(snapshot.bestLapTimeSec)}`,
        `DLT  ${fmtDelta(snapshot.deltaToBestSec)}`
      ]
    case 'tyres':
      return [
        `LF ${fmtTemp(snapshot.tyres?.lf.tempC, unitSystem)} RF ${fmtTemp(snapshot.tyres?.rf.tempC, unitSystem)}`,
        `LR ${fmtTemp(snapshot.tyres?.lr.tempC, unitSystem)} RR ${fmtTemp(snapshot.tyres?.rr.tempC, unitSystem)}`,
        `AVG ${fmtTemp(avgTyreTemp(snapshot), unitSystem)}`
      ]
    case 'inputs':
      return [
        `THR ${fmtPct(snapshot.throttle)}`,
        `BRK ${fmtPct(snapshot.brake)}`,
        `G ${gearLabel(snapshot.gear)}  ${fmtMeasurement(snapshot.speedKmh, 'speed-kmh', unitSystem, 0)}`
      ]
    case 'weather':
      return [
        `TRK ${fmtTemp(snapshot.trackTempC, unitSystem)}`,
        `AIR ${fmtTemp(snapshot.airTempC, unitSystem)}`,
        `${snapshot.isRaining ? 'RAIN' : 'DRY '} WET ${fmtPct(snapshot.trackWetnessPct ?? 0)}`
      ]
    default:
      return ['OLED DASHBOARD', 'PAGE --', '']
  }
}

function renderBigNumValue(snapshot: TelemetrySnapshot | null, presetId: OledPresetId): string {
  if (!snapshot?.connected) return '--'
  switch (presetId) {
    case 'delta-bignum':
      return formatBigNumSeconds(snapshot.deltaToBestSec)
    case 'gap-bignum': {
      const ahead = snapshot.drivers?.find((driver) => driver.isPlayer === false && driver.gapToPlayerSec !== undefined && driver.gapToPlayerSec >= 0)
      return formatBigNumSeconds(ahead?.gapToPlayerSec)
    }
    default:
      return '--'
  }
}

function formatBigNumSeconds(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '--'
  const sign = value >= 0 ? '+' : '-'
  const abs = Math.abs(value)
  if (abs >= 100) return `${sign}${abs.toFixed(0)}`
  if (abs >= 10) return `${sign}${abs.toFixed(1)}`
  return `${sign}${abs.toFixed(2)}`
}

function sanitizeAscii(value: string): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[|\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function gearLabel(gear: number): string {
  if (gear < 0) return 'R'
  if (gear === 0) return 'N'
  return String(gear)
}

function fmtLap(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '--:--.---'
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  const rest = safe - minutes * 60
  return `${minutes}:${rest.toFixed(3).padStart(6, '0')}`
}

function fmtDelta(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '+-.---'
  return `${seconds >= 0 ? '+' : ''}${seconds.toFixed(2)}`
}

function fmtNumber(value: number | undefined, digits: number): string {
  if (value === undefined || !Number.isFinite(value)) return '--'
  return value.toFixed(digits)
}

function fmtMeasurement(value: number | undefined, kind: MeasurementKind, unitSystem: UnitSystem, digits: number): string {
  const reading = formatMeasurement(value, kind, unitSystem, { decimals: digits })
  return reading.value === undefined ? `--${reading.unit.toUpperCase()}` : `${reading.display}${reading.unit.toUpperCase()}`
}

function fmtTemp(value: number | undefined, unitSystem: UnitSystem): string {
  return fmtMeasurement(value, 'temperature-c', unitSystem, 0)
}

function fmtPct(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '--%'
  return `${Math.round(clamp(value, 0, 1) * 100)}%`
}

function fuelLapsRemaining(snapshot: TelemetrySnapshot): number | undefined {
  if (snapshot.lapsRemaining !== undefined && Number.isFinite(snapshot.lapsRemaining)) {
    return snapshot.lapsRemaining
  }
  if (!snapshot.fuelLiters || !snapshot.fuelPerLap || snapshot.fuelPerLap <= 0) return undefined
  return snapshot.fuelLiters / snapshot.fuelPerLap
}

function avgTyreTemp(snapshot: TelemetrySnapshot): number | undefined {
  const corners = snapshot.tyres
  if (!corners) return undefined
  const values = [corners.lf.tempC, corners.rf.tempC, corners.lr.tempC, corners.rr.tempC].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  )
  if (values.length === 0) return undefined
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function valueOrDash(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '--'
  return String(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
