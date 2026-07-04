// Proximity-radar threat coloring — SINGLE source of truth, shared by the overlay
// radar (overlay/widgets/ProximityRadarWidget) and the dashboard radars
// (dashboard/DashboardRoot ElementRadar + dashboard/widgets/gt3-widgets RadarCurated).
//
// Real spotter rule: a car is ALONGSIDE only when it physically overlaps you
// longitudinally (|relativeY| ≤ half a car length). Any car that is clearly
// ahead or behind — even if very close in time — is CLEAR.
//   • RED   — ALONGSIDE: |relativeY| ≤ RADAR_CAR_HALF_LEN_M.
//   • GREEN — CLEAR:     any car ahead or behind (not alongside).
// Green is reserved for the good/clear state, consistent with the app's color rule.

/** ~half a car length (m): the full side-by-side "alongside" zone. */
export const RADAR_CAR_HALF_LEN_M = 2.5

export type RadarThreat = 'beside' | 'clear'

/** Threat level for a single car at longitudinal offset relativeY (meters, + ahead / − behind). */
export function radarThreatLevel(relativeY: number | undefined | null): RadarThreat {
  if (typeof relativeY !== 'number' || !Number.isFinite(relativeY)) return 'clear'
  if (Math.abs(relativeY) <= RADAR_CAR_HALF_LEN_M) return 'beside'
  return 'clear'
}

/** Hex colors per threat: warm danger; green only for the clear/good state. */
export const RADAR_THREAT_COLORS: Record<RadarThreat, string> = {
  beside: '#ff2d2d',
  clear: '#22c55e'
}

/** Convenience: hex color for a single car by its relativeY. */
export function radarThreatColor(relativeY: number | undefined | null): string {
  return RADAR_THREAT_COLORS[radarThreatLevel(relativeY)]
}

/** Worst threat present on one side, given that side's cars' relativeY values. */
export function radarSideThreat(relativeYs: Array<number | undefined | null>): RadarThreat {
  for (const y of relativeYs) {
    if (radarThreatLevel(y) === 'beside') return 'beside'
  }
  return 'clear'
}
