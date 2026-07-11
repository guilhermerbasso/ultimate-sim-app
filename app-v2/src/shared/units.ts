// Pure unit conversions — no Electron/native deps, safe to unit-test in isolation.

export const UNIT_SYSTEMS = ['metric', 'imperial'] as const
export type UnitSystem = (typeof UNIT_SYSTEMS)[number]

export const DEFAULT_UNIT_SYSTEM: UnitSystem = 'metric'

/** Standard gravity (m/s²) used to convert acceleration to G units. */
export const STANDARD_GRAVITY_MS2 = 9.80665
export const LITERS_PER_US_GALLON = 3.785411784

const KM_TO_MILES = 0.621371192237334
const METERS_TO_FEET = 3.28083989501312
const KPA_TO_PSI = 0.145037737730209
const BAR_TO_PSI = 14.5037737730209
const INHG_TO_KPA = 3.386389
const KG_TO_POUNDS = 2.20462262184878
const KG_M3_TO_LB_FT3 = 0.062427960576145
const MM_TO_INCHES = 0.0393700787401575
const CM_TO_INCHES = 0.393700787401575
const NM_TO_LB_FT = 0.737562149277266
const KW_TO_HP = 1.34102208959503
const NEWTON_TO_LBF = 0.224808943870963
const L_PER_100KM_TO_MPG_US = 235.214583

function finite(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function scaled(value: number | null | undefined, factor: number): number | undefined {
  const safe = finite(value)
  return safe == null ? undefined : safe * factor
}

export function isUnitSystem(value: unknown): value is UnitSystem {
  return UNIT_SYSTEMS.includes(value as UnitSystem)
}

export function kmhToMph(value: number | null | undefined): number | undefined {
  return scaled(value, KM_TO_MILES)
}

export function mphToKmh(value: number | null | undefined): number | undefined {
  return scaled(value, 1 / KM_TO_MILES)
}

export function msToMph(value: number | null | undefined): number | undefined {
  return scaled(value, METERS_TO_FEET * 3600 / 5280)
}

export function mphToMs(value: number | null | undefined): number | undefined {
  return scaled(value, 5280 / (METERS_TO_FEET * 3600))
}

export function celsiusToFahrenheit(value: number | null | undefined): number | undefined {
  const safe = finite(value)
  return safe == null ? undefined : safe * 9 / 5 + 32
}

export function fahrenheitToCelsius(value: number | null | undefined): number | undefined {
  const safe = finite(value)
  return safe == null ? undefined : (safe - 32) * 5 / 9
}

export function kpaToPsi(value: number | null | undefined): number | undefined {
  return scaled(value, KPA_TO_PSI)
}

export function psiToKpa(value: number | null | undefined): number | undefined {
  return scaled(value, 1 / KPA_TO_PSI)
}

export function barToPsi(value: number | null | undefined): number | undefined {
  return scaled(value, BAR_TO_PSI)
}

export function psiToBar(value: number | null | undefined): number | undefined {
  return scaled(value, 1 / BAR_TO_PSI)
}

export function inHgToKpa(value: number | null | undefined): number | undefined {
  return scaled(value, INHG_TO_KPA)
}

export function kpaToInHg(value: number | null | undefined): number | undefined {
  return scaled(value, 1 / INHG_TO_KPA)
}

export function litersToUsGallons(value: number | null | undefined): number | undefined {
  return scaled(value, 1 / LITERS_PER_US_GALLON)
}

export function usGallonsToLiters(value: number | null | undefined): number | undefined {
  return scaled(value, LITERS_PER_US_GALLON)
}

export function metersToFeet(value: number | null | undefined): number | undefined {
  return scaled(value, METERS_TO_FEET)
}

export function feetToMeters(value: number | null | undefined): number | undefined {
  return scaled(value, 1 / METERS_TO_FEET)
}

export function kilometersToMiles(value: number | null | undefined): number | undefined {
  return scaled(value, KM_TO_MILES)
}

export function milesToKilometers(value: number | null | undefined): number | undefined {
  return scaled(value, 1 / KM_TO_MILES)
}

export function litersPer100KmToMpgUs(value: number | null | undefined): number | undefined {
  const safe = finite(value)
  return safe == null || safe <= 0 ? undefined : L_PER_100KM_TO_MPG_US / safe
}

export function mpgUsToLitersPer100Km(value: number | null | undefined): number | undefined {
  const safe = finite(value)
  return safe == null || safe <= 0 ? undefined : L_PER_100KM_TO_MPG_US / safe
}

/**
 * Convert an acceleration in m/s² to G units.
 * iRacing reports LatAccel/LongAccel/VertAccel in m/s² (some var catalogs
 * mislabel them as "g"); divide by standard gravity to get Gs.
 */
export function mss2ToG(value: number | null | undefined): number | undefined {
  const safe = finite(value)
  return safe == null ? undefined : safe / STANDARD_GRAVITY_MS2
}

export type MeasurementKind =
  | 'speed-kmh'
  | 'speed-ms'
  | 'temperature-c'
  | 'pressure-kpa'
  | 'pressure-bar'
  | 'fuel-volume-l'
  | 'fuel-per-lap-l'
  | 'fuel-flow-l-hour'
  | 'fuel-flow-l-minute'
  | 'fuel-economy-l-100km'
  | 'fuel-economy-km-l'
  | 'distance-m'
  | 'distance-km'
  | 'length-mm'
  | 'length-cm'
  | 'mass-kg'
  | 'mass-flow-kg-hour'
  | 'mass-per-lap-kg'
  | 'density-kg-m3'
  | 'acceleration-ms2'
  | 'torque-nm'
  | 'power-kw'
  | 'force-n'

export interface MeasurementFormatOptions {
  decimals?: number
  dash?: string
  includeUnit?: boolean
  signed?: boolean
  trimTrailingZeros?: boolean
}

export interface FormattedMeasurement {
  value: number | undefined
  unit: string
  display: string
}

interface MeasurementDefinition {
  metricUnit: string
  imperialUnit: string
  toImperial(value: number): number | undefined
}

const MEASUREMENTS: Record<MeasurementKind, MeasurementDefinition> = {
  'speed-kmh': { metricUnit: 'km/h', imperialUnit: 'mph', toImperial: (value) => value * KM_TO_MILES },
  'speed-ms': { metricUnit: 'm/s', imperialUnit: 'mph', toImperial: (value) => value * METERS_TO_FEET * 3600 / 5280 },
  'temperature-c': { metricUnit: '°C', imperialUnit: '°F', toImperial: (value) => value * 9 / 5 + 32 },
  'pressure-kpa': { metricUnit: 'kPa', imperialUnit: 'psi', toImperial: (value) => value * KPA_TO_PSI },
  'pressure-bar': { metricUnit: 'bar', imperialUnit: 'psi', toImperial: (value) => value * BAR_TO_PSI },
  'fuel-volume-l': { metricUnit: 'L', imperialUnit: 'gal', toImperial: (value) => value / LITERS_PER_US_GALLON },
  'fuel-per-lap-l': { metricUnit: 'L/lap', imperialUnit: 'gal/lap', toImperial: (value) => value / LITERS_PER_US_GALLON },
  'fuel-flow-l-hour': { metricUnit: 'L/h', imperialUnit: 'gal/h', toImperial: (value) => value / LITERS_PER_US_GALLON },
  'fuel-flow-l-minute': { metricUnit: 'L/min', imperialUnit: 'gal/min', toImperial: (value) => value / LITERS_PER_US_GALLON },
  'fuel-economy-l-100km': { metricUnit: 'L/100 km', imperialUnit: 'mpg', toImperial: litersPer100KmToMpgUs },
  'fuel-economy-km-l': { metricUnit: 'km/L', imperialUnit: 'mpg', toImperial: (value) => value * 2.35214583 },
  'distance-m': { metricUnit: 'm', imperialUnit: 'ft', toImperial: (value) => value * METERS_TO_FEET },
  'distance-km': { metricUnit: 'km', imperialUnit: 'mi', toImperial: (value) => value * KM_TO_MILES },
  'length-mm': { metricUnit: 'mm', imperialUnit: 'in', toImperial: (value) => value * MM_TO_INCHES },
  'length-cm': { metricUnit: 'cm', imperialUnit: 'in', toImperial: (value) => value * CM_TO_INCHES },
  'mass-kg': { metricUnit: 'kg', imperialUnit: 'lb', toImperial: (value) => value * KG_TO_POUNDS },
  'mass-flow-kg-hour': { metricUnit: 'kg/h', imperialUnit: 'lb/h', toImperial: (value) => value * KG_TO_POUNDS },
  'mass-per-lap-kg': { metricUnit: 'kg/lap', imperialUnit: 'lb/lap', toImperial: (value) => value * KG_TO_POUNDS },
  'density-kg-m3': { metricUnit: 'kg/m³', imperialUnit: 'lb/ft³', toImperial: (value) => value * KG_M3_TO_LB_FT3 },
  'acceleration-ms2': { metricUnit: 'm/s²', imperialUnit: 'ft/s²', toImperial: (value) => value * METERS_TO_FEET },
  'torque-nm': { metricUnit: 'N·m', imperialUnit: 'lb·ft', toImperial: (value) => value * NM_TO_LB_FT },
  'power-kw': { metricUnit: 'kW', imperialUnit: 'hp', toImperial: (value) => value * KW_TO_HP },
  'force-n': { metricUnit: 'N', imperialUnit: 'lbf', toImperial: (value) => value * NEWTON_TO_LBF }
}

const UNIT_KIND = new Map<string, MeasurementKind>([
  ['km/h', 'speed-kmh'],
  ['kph', 'speed-kmh'],
  ['m/s', 'speed-ms'],
  ['°c', 'temperature-c'],
  ['c', 'temperature-c'],
  ['kpa', 'pressure-kpa'],
  ['bar', 'pressure-bar'],
  ['l', 'fuel-volume-l'],
  ['liter', 'fuel-volume-l'],
  ['litre', 'fuel-volume-l'],
  ['liters', 'fuel-volume-l'],
  ['litres', 'fuel-volume-l'],
  ['l/lap', 'fuel-per-lap-l'],
  ['l per lap', 'fuel-per-lap-l'],
  ['l/h', 'fuel-flow-l-hour'],
  ['l/hr', 'fuel-flow-l-hour'],
  ['l/min', 'fuel-flow-l-minute'],
  ['l/100km', 'fuel-economy-l-100km'],
  ['l/100 km', 'fuel-economy-l-100km'],
  ['km/l', 'fuel-economy-km-l'],
  ['m', 'distance-m'],
  ['km', 'distance-km'],
  ['mm', 'length-mm'],
  ['cm', 'length-cm'],
  ['kg', 'mass-kg'],
  ['kg/h', 'mass-flow-kg-hour'],
  ['kg/hr', 'mass-flow-kg-hour'],
  ['kg/lap', 'mass-per-lap-kg'],
  ['kg/m3', 'density-kg-m3'],
  ['kg/m³', 'density-kg-m3'],
  ['m/s2', 'acceleration-ms2'],
  ['m/s²', 'acceleration-ms2'],
  ['nm', 'torque-nm'],
  ['n·m', 'torque-nm'],
  ['kw', 'power-kw'],
  ['n', 'force-n']
])

function normalizeUnit(unit: string): string {
  return unit.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function measurementKindForUnit(unit: string | null | undefined): MeasurementKind | undefined {
  if (!unit) return undefined
  return UNIT_KIND.get(normalizeUnit(unit))
}

export function measurementUnit(kind: MeasurementKind, unitSystem: UnitSystem): string {
  const definition = MEASUREMENTS[kind]
  return unitSystem === 'imperial' ? definition.imperialUnit : definition.metricUnit
}

export function convertMeasurement(
  value: number | null | undefined,
  kind: MeasurementKind,
  unitSystem: UnitSystem
): number | undefined {
  const safe = finite(value)
  if (safe == null) return undefined
  if (unitSystem === 'metric') return safe
  const converted = MEASUREMENTS[kind].toImperial(safe)
  return finite(converted)
}

function formattedNumber(value: number, options: MeasurementFormatOptions): string {
  const decimals = Math.max(0, Math.min(6, options.decimals ?? 0))
  let text = value.toFixed(decimals)
  if (options.trimTrailingZeros && decimals > 0) {
    text = text.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
  }
  if (options.signed && value > 0) text = `+${text}`
  return text
}

export function formatMeasurement(
  value: number | null | undefined,
  kind: MeasurementKind,
  unitSystem: UnitSystem,
  options: MeasurementFormatOptions = {}
): FormattedMeasurement {
  const converted = convertMeasurement(value, kind, unitSystem)
  const unit = measurementUnit(kind, unitSystem)
  if (converted == null) return { value: undefined, unit, display: options.dash ?? '—' }
  const number = formattedNumber(converted, options)
  return {
    value: converted,
    unit,
    display: options.includeUnit ? `${number} ${unit}` : number
  }
}

export function formatCanonicalMeasurement(
  value: number | null | undefined,
  canonicalUnit: string | null | undefined,
  unitSystem: UnitSystem,
  options: MeasurementFormatOptions = {}
): FormattedMeasurement {
  const kind = measurementKindForUnit(canonicalUnit)
  if (kind) return formatMeasurement(value, kind, unitSystem, options)
  const safe = finite(value)
  const unit = canonicalUnit?.trim() ?? ''
  if (safe == null) return { value: undefined, unit, display: options.dash ?? '—' }
  const number = formattedNumber(safe, options)
  return {
    value: safe,
    unit,
    display: options.includeUnit && unit ? `${number} ${unit}` : number
  }
}
