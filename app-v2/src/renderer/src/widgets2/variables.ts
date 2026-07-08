// ── Widget-matrix telemetry variables ─────────────────────────────────────────
// The authoritative catalogue of telemetry VARIABLES the widget factory can show.
// Each variable knows how to read itself from a TelemetrySnapshot (NaN-safe), its
// display range/unit/decimals, and optional warn/redline thresholds. Every value
// the app actually exposes (shared/telemetry.ts TelemetrySnapshot) is respected —
// nothing is invented. Forms (bar/gauge/led/pixel/text/…) consume the derived
// Reading, so the SAME variable can render in many visual forms.
import type { TelemetrySnapshot } from '../../../shared/telemetry'

export type VarGroup =
  | 'engine'
  | 'inputs'
  | 'dynamics'
  | 'timing'
  | 'position'
  | 'fuel'
  | 'tyres'
  | 'brakes'
  | 'thermal'
  | 'electronics'
  | 'weather'

export type ReadingState = 'normal' | 'ok' | 'warn' | 'crit'

export interface Reading {
  /** Raw numeric value (already NaN-safe). */
  value: number
  /** Display text (already formatted, NaN → dash). */
  text: string
  /** 0..1 fraction for bar/gauge/led/pixel/ring forms. */
  fraction: number
  unit: string
  state: ReadingState
}

export interface WidgetVariable {
  id: string
  label: string
  group: VarGroup
  unit: string
  min: number
  max: number
  decimals: number
  /** Low value is the bad one (e.g. fuel, grip). */
  invert?: boolean
  /** Fraction (0..1) at/above which the reading is warn (or at/below when invert). */
  warnFrom?: number
  /** Fraction (0..1) at/above which the reading is crit (or at/below when invert). */
  redlineFrom?: number
  /** Read the raw value; return undefined when the channel is absent. */
  read: (s: TelemetrySnapshot) => number | undefined
  /** Optional display-text override (e.g. gear letters, lap time mm:ss.mmm). */
  format?: (value: number | undefined, s: TelemetrySnapshot) => string | undefined
}

// ── NaN-safe helpers ──────────────────────────────────────────────────────────
function num(n: unknown): number | undefined {
  if (typeof n === 'number' && Number.isFinite(n)) return n
  if (typeof n === 'string') {
    const p = Number.parseFloat(n)
    return Number.isFinite(p) ? p : undefined
  }
  return undefined
}
function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0
}
const KPA_TO_PSI = 0.1450377

function fmtLapTime(sec: number | undefined): string {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return '--:--.---'
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(3).padStart(6, '0')}`
}
const GEAR_LABELS: Record<number, string> = { [-1]: 'R', 0: 'N' }

// ── Reading derivation ────────────────────────────────────────────────────────
export function readVariable(v: WidgetVariable, s: TelemetrySnapshot): Reading {
  const raw = v.read(s)
  const present = raw != null && Number.isFinite(raw)
  const value = present ? (raw as number) : 0
  const span = v.max - v.min
  const fraction = present && span !== 0 ? clamp01((value - v.min) / span) : 0

  // Absent channels stay NEUTRAL — never raise a false warn/crit (e.g. inverted
  // fuel/wear/grip must not read "critical red" just because the sim omits them).
  let state: ReadingState = 'normal'
  if (present && (v.redlineFrom != null || v.warnFrom != null)) {
    const warn = v.warnFrom ?? v.redlineFrom ?? 1
    const crit = v.redlineFrom ?? 1
    const hasCrit = v.redlineFrom != null
    if (v.invert) {
      if (hasCrit && fraction <= crit) state = 'crit'
      else if (fraction <= warn) state = 'warn'
      else state = 'ok'
    } else {
      if (hasCrit && fraction >= crit) state = 'crit'
      else if (fraction >= warn) state = 'warn'
      else state = 'normal'
    }
  }

  const override = v.format?.(raw, s)
  const text = override != null ? override : present ? value.toFixed(v.decimals) : '—'
  return { value, text, fraction, unit: v.unit, state }
}

// ── The variable catalogue ────────────────────────────────────────────────────
// Kept declarative and grouped; each entry is one telemetry channel (or a safe
// derivation of channels the app already exposes).
export const WIDGET_VARIABLES: WidgetVariable[] = [
  // Engine / powertrain
  { id: 'speed', label: 'Speed', group: 'engine', unit: 'km/h', min: 0, max: 340, decimals: 0, read: (s) => num(s.speedKmh) },
  { id: 'rpm', label: 'RPM', group: 'engine', unit: 'rpm', min: 0, max: 9500, decimals: 0, warnFrom: 0.82, redlineFrom: 0.95, read: (s) => num(s.rpm) },
  {
    id: 'gear',
    label: 'Gear',
    group: 'engine',
    unit: '',
    min: -1,
    max: 8,
    decimals: 0,
    read: (s) => num(s.gear),
    format: (val) => (typeof val === 'number' ? GEAR_LABELS[val] ?? String(val) : '—')
  },
  { id: 'shift', label: 'Shift', group: 'engine', unit: '%', min: 0, max: 1, decimals: 0, warnFrom: 0.7, redlineFrom: 0.95, read: (s) => num(s.shiftIndicatorPct), format: (v) => (typeof v === 'number' ? `${Math.round(clamp01(v) * 100)}` : '—') },

  // Inputs
  { id: 'throttle', label: 'Throttle', group: 'inputs', unit: '%', min: 0, max: 1, decimals: 0, read: (s) => num(s.throttle), format: (v) => (typeof v === 'number' ? `${Math.round(clamp01(v) * 100)}` : '—') },
  { id: 'brake', label: 'Brake', group: 'inputs', unit: '%', min: 0, max: 1, decimals: 0, warnFrom: 0.75, redlineFrom: 0.95, read: (s) => num(s.brake), format: (v) => (typeof v === 'number' ? `${Math.round(clamp01(v) * 100)}` : '—') },
  { id: 'clutch', label: 'Clutch', group: 'inputs', unit: '%', min: 0, max: 1, decimals: 0, read: (s) => num(s.clutch), format: (v) => (typeof v === 'number' ? `${Math.round(clamp01(v) * 100)}` : '—') },
  { id: 'steer', label: 'Steering', group: 'inputs', unit: '°', min: -180, max: 180, decimals: 0, read: (s) => num(s.steerAngleDeg) },

  // Dynamics
  { id: 'latG', label: 'Lateral G', group: 'dynamics', unit: 'g', min: -3, max: 3, decimals: 2, read: (s) => num(s.latAccelG) },
  { id: 'longG', label: 'Long. G', group: 'dynamics', unit: 'g', min: -3, max: 3, decimals: 2, read: (s) => num(s.longAccelG) },

  // Timing
  { id: 'deltaBest', label: 'Δ Best', group: 'timing', unit: 's', min: -2, max: 2, decimals: 3, read: (s) => num(s.deltaToBestSec), format: (v) => (typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(3)}` : '—') },
  { id: 'deltaSession', label: 'Δ Session', group: 'timing', unit: 's', min: -2, max: 2, decimals: 3, read: (s) => num(s.deltaToSessionBestSec), format: (v) => (typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(3)}` : '—') },
  { id: 'curLapTime', label: 'Cur Lap', group: 'timing', unit: '', min: 0, max: 240, decimals: 3, read: (s) => num(s.currentLapTimeSec), format: (v) => fmtLapTime(typeof v === 'number' ? v : undefined) },
  { id: 'lastLapTime', label: 'Last Lap', group: 'timing', unit: '', min: 0, max: 240, decimals: 3, read: (s) => num(s.lastLapTimeSec), format: (v) => fmtLapTime(typeof v === 'number' ? v : undefined) },
  { id: 'bestLapTime', label: 'Best Lap', group: 'timing', unit: '', min: 0, max: 240, decimals: 3, read: (s) => num(s.bestLapTimeSec), format: (v) => fmtLapTime(typeof v === 'number' ? v : undefined) },
  { id: 'curLap', label: 'Lap', group: 'timing', unit: '', min: 0, max: 60, decimals: 0, read: (s) => num(s.currentLap) },
  { id: 'lapsRemaining', label: 'Laps Left', group: 'timing', unit: '', min: 0, max: 60, decimals: 0, read: (s) => num(s.lapsRemaining) },
  { id: 'lapDist', label: 'Lap Dist', group: 'timing', unit: '%', min: 0, max: 1, decimals: 0, read: (s) => num(s.lapDistPct), format: (v) => (typeof v === 'number' ? `${Math.round(clamp01(v) * 100)}` : '—') },

  // Position / standings
  { id: 'position', label: 'Position', group: 'position', unit: '', min: 1, max: 30, decimals: 0, read: (s) => num(s.position), format: (v) => (typeof v === 'number' && v > 0 ? `P${Math.round(v)}` : '—') },
  { id: 'classPos', label: 'Class Pos', group: 'position', unit: '', min: 1, max: 30, decimals: 0, read: (s) => num(s.classPosition), format: (v) => (typeof v === 'number' && v > 0 ? `P${Math.round(v)}` : '—') },
  { id: 'totalCars', label: 'Cars', group: 'position', unit: '', min: 0, max: 60, decimals: 0, read: (s) => num(s.totalCars) },
  { id: 'sof', label: 'SoF', group: 'position', unit: '', min: 0, max: 5000, decimals: 0, read: (s) => num(s.strengthOfField) },
  { id: 'gapAhead', label: 'Gap Ahead', group: 'position', unit: 's', min: 0, max: 5, decimals: 1, read: (s) => num(s.relatives?.ahead?.gapSec) },
  { id: 'gapBehind', label: 'Gap Behind', group: 'position', unit: 's', min: 0, max: 5, decimals: 1, read: (s) => num(s.relatives?.behind?.gapSec) },
  { id: 'incidents', label: 'Incidents', group: 'position', unit: 'x', min: 0, max: 20, decimals: 0, warnFrom: 0.6, redlineFrom: 0.85, read: (s) => num(s.incidentCount) },

  // Fuel
  { id: 'fuelLiters', label: 'Fuel', group: 'fuel', unit: 'L', min: 0, max: 120, decimals: 1, invert: true, warnFrom: 0.25, redlineFrom: 0.1, read: (s) => num(s.fuelLiters) },
  { id: 'fuelPct', label: 'Fuel %', group: 'fuel', unit: '%', min: 0, max: 1, decimals: 0, invert: true, warnFrom: 0.25, redlineFrom: 0.1, read: (s) => (num(s.fuelLiters) != null && num(s.fuelCapacityLiters) ? (num(s.fuelLiters) as number) / (num(s.fuelCapacityLiters) as number) : undefined), format: (v) => (typeof v === 'number' ? `${Math.round(clamp01(v) * 100)}` : '—') },
  { id: 'fuelPerLap', label: 'Fuel/Lap', group: 'fuel', unit: 'L', min: 0, max: 6, decimals: 2, read: (s) => num(s.fuelPerLap) },
  {
    id: 'fuelLapsLeft',
    label: 'Fuel Laps',
    group: 'fuel',
    unit: '',
    min: 0,
    max: 40,
    decimals: 1,
    invert: true,
    warnFrom: 0.15,
    redlineFrom: 0.05,
    read: (s) => {
      const f = num(s.fuelLiters)
      const per = num(s.fuelPerLap)
      return f != null && per != null && per > 0 ? f / per : undefined
    }
  },

  // Tyres — temperature per corner
  { id: 'tyreTempFL', label: 'Tyre FL', group: 'tyres', unit: '°C', min: 40, max: 120, decimals: 0, warnFrom: 0.8, redlineFrom: 0.92, read: (s) => num(s.tyres?.lf?.tempC) },
  { id: 'tyreTempFR', label: 'Tyre FR', group: 'tyres', unit: '°C', min: 40, max: 120, decimals: 0, warnFrom: 0.8, redlineFrom: 0.92, read: (s) => num(s.tyres?.rf?.tempC) },
  { id: 'tyreTempRL', label: 'Tyre RL', group: 'tyres', unit: '°C', min: 40, max: 120, decimals: 0, warnFrom: 0.8, redlineFrom: 0.92, read: (s) => num(s.tyres?.lr?.tempC) },
  { id: 'tyreTempRR', label: 'Tyre RR', group: 'tyres', unit: '°C', min: 40, max: 120, decimals: 0, warnFrom: 0.8, redlineFrom: 0.92, read: (s) => num(s.tyres?.rr?.tempC) },
  // Tyres — pressure per corner (kPa → psi)
  { id: 'tyrePresFL', label: 'Press FL', group: 'tyres', unit: 'psi', min: 18, max: 38, decimals: 1, read: (s) => (num(s.tyres?.lf?.pressureKpa) != null ? (num(s.tyres?.lf?.pressureKpa) as number) * KPA_TO_PSI : undefined) },
  { id: 'tyrePresFR', label: 'Press FR', group: 'tyres', unit: 'psi', min: 18, max: 38, decimals: 1, read: (s) => (num(s.tyres?.rf?.pressureKpa) != null ? (num(s.tyres?.rf?.pressureKpa) as number) * KPA_TO_PSI : undefined) },
  { id: 'tyrePresRL', label: 'Press RL', group: 'tyres', unit: 'psi', min: 18, max: 38, decimals: 1, read: (s) => (num(s.tyres?.lr?.pressureKpa) != null ? (num(s.tyres?.lr?.pressureKpa) as number) * KPA_TO_PSI : undefined) },
  { id: 'tyrePresRR', label: 'Press RR', group: 'tyres', unit: 'psi', min: 18, max: 38, decimals: 1, read: (s) => (num(s.tyres?.rr?.pressureKpa) != null ? (num(s.tyres?.rr?.pressureKpa) as number) * KPA_TO_PSI : undefined) },
  // Tyres — wear per corner
  { id: 'tyreWearFL', label: 'Wear FL', group: 'tyres', unit: '%', min: 0, max: 1, decimals: 0, invert: true, warnFrom: 0.35, redlineFrom: 0.15, read: (s) => num(s.tyres?.lf?.wearPct), format: (v) => (typeof v === 'number' ? `${Math.round(clamp01(v) * 100)}` : '—') },
  { id: 'tyreWearFR', label: 'Wear FR', group: 'tyres', unit: '%', min: 0, max: 1, decimals: 0, invert: true, warnFrom: 0.35, redlineFrom: 0.15, read: (s) => num(s.tyres?.rf?.wearPct), format: (v) => (typeof v === 'number' ? `${Math.round(clamp01(v) * 100)}` : '—') },
  { id: 'tyreWearRL', label: 'Wear RL', group: 'tyres', unit: '%', min: 0, max: 1, decimals: 0, invert: true, warnFrom: 0.35, redlineFrom: 0.15, read: (s) => num(s.tyres?.lr?.wearPct), format: (v) => (typeof v === 'number' ? `${Math.round(clamp01(v) * 100)}` : '—') },
  { id: 'tyreWearRR', label: 'Wear RR', group: 'tyres', unit: '%', min: 0, max: 1, decimals: 0, invert: true, warnFrom: 0.35, redlineFrom: 0.15, read: (s) => num(s.tyres?.rr?.wearPct), format: (v) => (typeof v === 'number' ? `${Math.round(clamp01(v) * 100)}` : '—') },

  // Brakes — temperature per corner
  { id: 'brakeTempFL', label: 'Brake FL', group: 'brakes', unit: '°C', min: 100, max: 900, decimals: 0, warnFrom: 0.8, redlineFrom: 0.92, read: (s) => num(s.brakeTempC?.lf) },
  { id: 'brakeTempFR', label: 'Brake FR', group: 'brakes', unit: '°C', min: 100, max: 900, decimals: 0, warnFrom: 0.8, redlineFrom: 0.92, read: (s) => num(s.brakeTempC?.rf) },
  { id: 'brakeTempRL', label: 'Brake RL', group: 'brakes', unit: '°C', min: 100, max: 900, decimals: 0, warnFrom: 0.8, redlineFrom: 0.92, read: (s) => num(s.brakeTempC?.lr) },
  { id: 'brakeTempRR', label: 'Brake RR', group: 'brakes', unit: '°C', min: 100, max: 900, decimals: 0, warnFrom: 0.8, redlineFrom: 0.92, read: (s) => num(s.brakeTempC?.rr) },

  // Thermal / vitals
  { id: 'waterTemp', label: 'Water', group: 'thermal', unit: '°C', min: 60, max: 130, decimals: 0, warnFrom: 0.75, redlineFrom: 0.9, read: (s) => num(s.waterTempC) },
  { id: 'oilTemp', label: 'Oil', group: 'thermal', unit: '°C', min: 60, max: 150, decimals: 0, warnFrom: 0.78, redlineFrom: 0.9, read: (s) => num(s.oilTempC) },
  { id: 'oilPress', label: 'Oil Press', group: 'thermal', unit: 'kPa', min: 0, max: 700, decimals: 0, read: (s) => num(s.oilPressureKpa) },

  // Electronics / assists
  { id: 'ers', label: 'ERS', group: 'electronics', unit: '%', min: 0, max: 1, decimals: 0, read: (s) => num(s.ersBatteryPct), format: (v) => (typeof v === 'number' ? `${Math.round(clamp01(v) * 100)}` : '—') },
  { id: 'tc', label: 'TC', group: 'electronics', unit: '', min: 0, max: 12, decimals: 0, read: (s) => num(s.tcLevel) },
  { id: 'abs', label: 'ABS', group: 'electronics', unit: '', min: 0, max: 12, decimals: 0, read: (s) => num(s.absLevel) },
  { id: 'engineMap', label: 'Map', group: 'electronics', unit: '', min: 0, max: 12, decimals: 0, read: (s) => num(s.engineMap) },
  { id: 'brakeBias', label: 'Brake Bias', group: 'electronics', unit: '%', min: 40, max: 70, decimals: 1, read: (s) => num(s.brakeBiasPct) },

  // Weather
  { id: 'trackTemp', label: 'Track', group: 'weather', unit: '°C', min: 5, max: 60, decimals: 0, read: (s) => num(s.trackTempC) },
  { id: 'airTemp', label: 'Air', group: 'weather', unit: '°C', min: 5, max: 45, decimals: 0, read: (s) => num(s.airTempC) },
  { id: 'wetness', label: 'Wetness', group: 'weather', unit: '%', min: 0, max: 1, decimals: 0, read: (s) => num(s.trackWetnessPct), format: (v) => (typeof v === 'number' ? `${Math.round(clamp01(v) * 100)}` : '—') },
  { id: 'grip', label: 'Grip', group: 'weather', unit: '%', min: 0, max: 1, decimals: 0, invert: true, warnFrom: 0.4, redlineFrom: 0.2, read: (s) => num(s.gripPct), format: (v) => (typeof v === 'number' ? `${Math.round(clamp01(v) * 100)}` : '—') }
]

export const WIDGET_VARIABLES_BY_ID: Record<string, WidgetVariable> = Object.fromEntries(
  WIDGET_VARIABLES.map((v) => [v.id, v])
)
