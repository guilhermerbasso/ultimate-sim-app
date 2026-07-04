// Pure unit conversions — no Electron/native deps, safe to unit-test in isolation.

/** Standard gravity (m/s²) used to convert acceleration to G units. */
export const STANDARD_GRAVITY_MS2 = 9.80665

/**
 * Convert an acceleration in m/s² to G units.
 * iRacing reports LatAccel/LongAccel/VertAccel in m/s² (some var catalogs
 * mislabel them as "g"); divide by standard gravity to get Gs. Returns
 * undefined for missing/non-finite input so optional fields stay clean.
 */
export function mss2ToG(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value / STANDARD_GRAVITY_MS2
}
