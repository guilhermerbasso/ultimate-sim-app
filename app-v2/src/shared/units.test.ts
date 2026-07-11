import { describe, expect, it } from 'vitest'
import {
  LITERS_PER_US_GALLON,
  STANDARD_GRAVITY_MS2,
  barToPsi,
  celsiusToFahrenheit,
  convertMeasurement,
  fahrenheitToCelsius,
  feetToMeters,
  formatCanonicalMeasurement,
  formatMeasurement,
  inHgToKpa,
  kilometersToMiles,
  kmhToMph,
  kpaToPsi,
  kpaToInHg,
  litersPer100KmToMpgUs,
  litersToUsGallons,
  measurementKindForUnit,
  metersToFeet,
  milesToKilometers,
  mphToKmh,
  mphToMs,
  mpgUsToLitersPer100Km,
  msToMph,
  mss2ToG,
  psiToBar,
  psiToKpa,
  usGallonsToLiters,
  type MeasurementKind
} from './units'

describe('unit conversion pairs', () => {
  it.each([
    ['speed km/h', kmhToMph, mphToKmh, 100, 62.1371192237334],
    ['speed m/s', msToMph, mphToMs, 10, 22.369362920544],
    ['temperature', celsiusToFahrenheit, fahrenheitToCelsius, 100, 212],
    ['pressure kPa', kpaToPsi, psiToKpa, 100, 14.5037737730209],
    ['pressure bar', barToPsi, psiToBar, 1, 14.5037737730209],
    ['atmospheric pressure', inHgToKpa, kpaToInHg, 29.92, 101.32075888],
    ['fuel volume', litersToUsGallons, usGallonsToLiters, LITERS_PER_US_GALLON, 1],
    ['distance metres', metersToFeet, feetToMeters, 1, 3.28083989501312],
    ['distance kilometres', kilometersToMiles, milesToKilometers, 1, 0.621371192237334],
    ['fuel economy', litersPer100KmToMpgUs, mpgUsToLitersPer100Km, 10, 23.5214583]
  ] as const)('converts and round-trips %s', (_name, forward, inverse, canonical, converted) => {
    expect(forward(canonical)).toBeCloseTo(converted, 8)
    expect(inverse(forward(canonical))).toBeCloseTo(canonical, 8)
  })

  it('handles meaningful boundaries', () => {
    expect(kmhToMph(0)).toBe(0)
    expect(celsiusToFahrenheit(0)).toBe(32)
    expect(celsiusToFahrenheit(-40)).toBe(-40)
    expect(litersPer100KmToMpgUs(0)).toBeUndefined()
    expect(mpgUsToLitersPer100Km(-1)).toBeUndefined()
  })

  it.each([
    kmhToMph,
    mphToKmh,
    msToMph,
    mphToMs,
    celsiusToFahrenheit,
    fahrenheitToCelsius,
    kpaToPsi,
    psiToKpa,
    barToPsi,
    psiToBar,
    inHgToKpa,
    kpaToInHg,
    litersToUsGallons,
    usGallonsToLiters,
    metersToFeet,
    feetToMeters,
    kilometersToMiles,
    milesToKilometers,
    litersPer100KmToMpgUs,
    mpgUsToLitersPer100Km
  ])('is NaN-safe', (convert) => {
    expect(convert(undefined)).toBeUndefined()
    expect(convert(null)).toBeUndefined()
    expect(convert(Number.NaN)).toBeUndefined()
    expect(convert(Number.POSITIVE_INFINITY)).toBeUndefined()
  })
})

describe('measurement conversion and formatting', () => {
  const imperialCases: Array<[MeasurementKind, number, number, string]> = [
    ['speed-kmh', 100, 62.1371192237334, 'mph'],
    ['speed-ms', 10, 22.369362920544, 'mph'],
    ['temperature-c', 100, 212, '°F'],
    ['pressure-kpa', 100, 14.5037737730209, 'psi'],
    ['pressure-bar', 1, 14.5037737730209, 'psi'],
    ['fuel-volume-l', LITERS_PER_US_GALLON, 1, 'gal'],
    ['fuel-per-lap-l', LITERS_PER_US_GALLON, 1, 'gal/lap'],
    ['fuel-flow-l-hour', LITERS_PER_US_GALLON, 1, 'gal/h'],
    ['fuel-flow-l-minute', LITERS_PER_US_GALLON, 1, 'gal/min'],
    ['fuel-economy-l-100km', 10, 23.5214583, 'mpg'],
    ['fuel-economy-km-l', 10, 23.5214583, 'mpg'],
    ['distance-m', 1, 3.28083989501312, 'ft'],
    ['distance-km', 1, 0.621371192237334, 'mi'],
    ['length-mm', 25.4, 1, 'in'],
    ['length-cm', 2.54, 1, 'in'],
    ['mass-kg', 1, 2.20462262184878, 'lb'],
    ['mass-flow-kg-hour', 1, 2.20462262184878, 'lb/h'],
    ['mass-per-lap-kg', 1, 2.20462262184878, 'lb/lap'],
    ['density-kg-m3', 1, 0.062427960576145, 'lb/ft³'],
    ['acceleration-ms2', 1, 3.28083989501312, 'ft/s²'],
    ['torque-nm', 1, 0.737562149277266, 'lb·ft'],
    ['power-kw', 1, 1.34102208959503, 'hp'],
    ['force-n', 1, 0.224808943870963, 'lbf']
  ]

  it.each(imperialCases)('converts %s centrally', (kind, canonical, expected, unit) => {
    expect(convertMeasurement(canonical, kind, 'metric')).toBe(canonical)
    expect(convertMeasurement(canonical, kind, 'imperial')).toBeCloseTo(expected, 8)
    expect(formatMeasurement(canonical, kind, 'imperial').unit).toBe(unit)
  })

  it('formats values, signs, units, and missing data', () => {
    expect(formatMeasurement(100, 'speed-kmh', 'imperial', { decimals: 1, includeUnit: true })).toEqual({
      value: expect.closeTo(62.1371192237334, 8),
      unit: 'mph',
      display: '62.1 mph'
    })
    expect(formatMeasurement(3, 'fuel-volume-l', 'metric', { decimals: 2, trimTrailingZeros: true }).display).toBe('3')
    expect(formatMeasurement(1, 'distance-km', 'metric', { signed: true }).display).toBe('+1')
    expect(formatMeasurement(undefined, 'temperature-c', 'imperial')).toEqual({
      value: undefined,
      unit: '°F',
      display: '—'
    })
    expect(formatMeasurement(Number.NaN, 'pressure-kpa', 'imperial', { dash: '--' }).display).toBe('--')
  })

  it('infers canonical descriptor units and leaves unknown units unchanged', () => {
    expect(measurementKindForUnit(' km/h ')).toBe('speed-kmh')
    expect(measurementKindForUnit('L/lap')).toBe('fuel-per-lap-l')
    expect(measurementKindForUnit('kg/m³')).toBe('density-kg-m3')
    expect(formatCanonicalMeasurement(12.3, 'widgets', 'imperial', { decimals: 1, includeUnit: true })).toEqual({
      value: 12.3,
      unit: 'widgets',
      display: '12.3 widgets'
    })
  })
})

describe('mss2ToG', () => {
  it('converts standard gravity and preserves sign', () => {
    expect(mss2ToG(STANDARD_GRAVITY_MS2)).toBe(1)
    expect(mss2ToG(0)).toBe(0)
    expect(mss2ToG(-STANDARD_GRAVITY_MS2)).toBe(-1)
    expect(mss2ToG(STANDARD_GRAVITY_MS2 * 2)).toBe(2)
  })

  it.each([undefined, null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'returns undefined for missing or non-finite input: %s',
    (value) => {
      expect(mss2ToG(value)).toBeUndefined()
    }
  )
})
