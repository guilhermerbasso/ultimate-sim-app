import type { Flags, TelemetrySnapshot } from '../../../../shared/telemetry'

export const GT3_STREAM_SAFE = true

export function fuelLaps(snapshot: TelemetrySnapshot | null): number | undefined {
  const fuel = snapshot?.fuelLiters
  const perLap = snapshot?.fuelPerLap
  return fuel !== undefined && perLap !== undefined && perLap > 0 ? fuel / perLap : undefined
}

export function fuelLevelPct(snapshot: TelemetrySnapshot | null): number | undefined {
  const fuel = snapshot?.fuelLiters
  const capacity = snapshot?.fuelCapacityLiters
  return fuel !== undefined && capacity !== undefined && capacity > 0 ? fuel / capacity : undefined
}

export type Gt3Severity = 'ok' | 'amber' | 'red'

export interface Gt3Warning {
  label: string
  detail: string
  severity: Exclude<Gt3Severity, 'ok'>
  priority: number
}

function flagWarning(flags: Flags | undefined): Gt3Warning | null {
  if (!flags) return null
  if (flags.red) return { label: 'Red Flag', detail: 'Session stopped', severity: 'red', priority: 100 }
  if (flags.black) return { label: 'Black Flag', detail: 'Serve penalty', severity: 'red', priority: 96 }
  if (flags.meatball || flags.repair) return { label: 'Damage', detail: 'Repair required', severity: 'red', priority: 94 }
  if (flags.disqualify) return { label: 'DQ', detail: 'Disqualified', severity: 'red', priority: 92 }
  if (flags.yellow) return { label: 'Yellow Flag', detail: 'Sector caution', severity: 'amber', priority: 74 }
  if (flags.blue) return { label: 'Blue Flag', detail: 'Traffic behind', severity: 'amber', priority: 58 }
  if (flags.white) return { label: 'White Flag', detail: 'Final lap', severity: 'amber', priority: 48 }
  if (flags.checkered) return { label: 'Checkered', detail: 'Session complete', severity: 'amber', priority: 46 }
  return null
}

export function getGt3Warnings(snapshot: TelemetrySnapshot | null): Gt3Warning[] {
  if (!snapshot?.connected) return []
  const warnings: Gt3Warning[] = []
  const fuel = snapshot.fuelLiters
  const fuelPct = fuelLevelPct(snapshot)
  const laps = fuelLaps(snapshot)
  if ((fuel !== undefined && fuel <= 6) || (fuelPct !== undefined && fuelPct <= 0.1) || (laps !== undefined && laps <= 2)) {
    warnings.push({
      label: 'Fuel Low',
      detail: laps !== undefined ? `${laps.toFixed(1)} laps left` : `${fuel?.toFixed(1) ?? '—'} L`,
      severity: 'red',
      priority: 88
    })
  }
  if ((fuel !== undefined && fuel <= 10) || (laps !== undefined && laps <= 3.5)) {
    warnings.push({
      label: 'Fuel Warn',
      detail: laps !== undefined ? `${laps.toFixed(1)} laps left` : `${fuel?.toFixed(1) ?? '—'} L`,
      severity: 'amber',
      priority: 62
    })
  }
  if (snapshot.waterTempC !== undefined && snapshot.waterTempC >= 115) {
    warnings.push({ label: 'Water T', detail: `${snapshot.waterTempC.toFixed(0)} °C`, severity: 'red', priority: 86 })
  } else if (snapshot.waterTempC !== undefined && snapshot.waterTempC >= 105) {
    warnings.push({ label: 'Water T', detail: `${snapshot.waterTempC.toFixed(0)} °C`, severity: 'amber', priority: 55 })
  }
  if (snapshot.oilTempC !== undefined && snapshot.oilTempC >= 140) {
    warnings.push({ label: 'Oil T', detail: `${snapshot.oilTempC.toFixed(0)} °C`, severity: 'red', priority: 84 })
  } else if (snapshot.oilTempC !== undefined && snapshot.oilTempC >= 125) {
    warnings.push({ label: 'Oil T', detail: `${snapshot.oilTempC.toFixed(0)} °C`, severity: 'amber', priority: 54 })
  }
  const oilPressureBar = snapshot.oilPressureKpa !== undefined ? snapshot.oilPressureKpa / 100 : undefined
  if (oilPressureBar !== undefined && oilPressureBar < 2.5 && (snapshot.rpm ?? 0) > 1200) {
    warnings.push({ label: 'Oil Press', detail: `${oilPressureBar.toFixed(1)} bar`, severity: 'red', priority: 98 })
  } else if (oilPressureBar !== undefined && oilPressureBar < 3.5 && (snapshot.rpm ?? 0) > 1200) {
    warnings.push({ label: 'Oil Press', detail: `${oilPressureBar.toFixed(1)} bar`, severity: 'amber', priority: 60 })
  }
  if (snapshot.pitLimiter) {
    warnings.push({ label: 'Pit Speed', detail: snapshot.onPitRoad ? 'Pit road' : 'Limiter active', severity: 'amber', priority: 72 })
  }
  const activeFlag = flagWarning(snapshot.flags)
  if (activeFlag) warnings.push(activeFlag)
  return warnings.sort((a, b) => b.priority - a.priority)
}

export function gt3SeverityClass(severity: Gt3Severity): string {
  return severity === 'ok' ? 'is-ok' : severity === 'amber' ? 'is-amber' : 'is-red'
}
