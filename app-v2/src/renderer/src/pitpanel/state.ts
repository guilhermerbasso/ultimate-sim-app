import type { TelemetrySnapshot } from '../../../shared/telemetry'

// Pure, unit-tested helpers for the touch pit/command panel. Kept free of React
// and Electron so the gating + numeric logic can be tested in isolation.

export interface IRacingControlStatus {
  available: boolean
  connected: boolean
}

export type Corner = 'lf' | 'rf' | 'lr' | 'rr'

export const CORNERS: Corner[] = ['lf', 'rf', 'lr', 'rr']

// Pit commands only work while the driver is in the car / on track. We treat the
// live telemetry `connected` flag (the sim only publishes a valid header while a
// session is active) plus the broadcast control being connected as "on track".
export function canSendPitCommands(
  status: IRacingControlStatus | null,
  snapshot: TelemetrySnapshot | null
): boolean {
  if (!status?.connected) return false
  return snapshot?.connected === true
}

// Tire pressures are bounded to a sane KPa window so a stepper can't wander off
// into garbage that iRacing would reject.
export const PRESSURE_MIN_KPA = 100
export const PRESSURE_MAX_KPA = 250
export const PRESSURE_STEP_KPA = 1

export function stepPressure(
  current: number,
  delta: number,
  min = PRESSURE_MIN_KPA,
  max = PRESSURE_MAX_KPA
): number {
  const next = Math.round(current + delta)
  return Math.min(max, Math.max(min, next))
}

export const FUEL_MIN_LITERS = 0
export const FUEL_MAX_LITERS = 999
export const FUEL_PRESETS: number[] = [5, 10, 20, 30, 40, 60]

export function clampFuel(liters: number, min = FUEL_MIN_LITERS, max = FUEL_MAX_LITERS): number {
  return Math.min(max, Math.max(min, Math.round(liters)))
}

export function stepFuel(current: number, delta: number): number {
  return clampFuel(current + delta)
}

// Decode the snapshot's `pitServiceFlags` (e.g. ['fuel','lf','fastRepair']) into
// a per-corner "this tire is queued for change" map for the toggle highlighting.
export function activeCornerFlags(snapshot: TelemetrySnapshot | null): Record<Corner, boolean> {
  const flags = new Set((snapshot?.pitServiceFlags ?? []).map((flag) => flag.toLowerCase()))
  return {
    lf: flags.has('lf'),
    rf: flags.has('rf'),
    lr: flags.has('lr'),
    rr: flags.has('rr')
  }
}

export function isServiceFlagged(snapshot: TelemetrySnapshot | null, flag: string): boolean {
  return (snapshot?.pitServiceFlags ?? []).some((entry) => entry.toLowerCase() === flag.toLowerCase())
}

export const CHAT_MACRO_COUNT = 15

export function chatMacroNumbers(): number[] {
  return Array.from({ length: CHAT_MACRO_COUNT }, (_, index) => index + 1)
}

export const CORNER_LABELS: Record<Corner, string> = {
  lf: 'LF',
  rf: 'RF',
  lr: 'LR',
  rr: 'RR'
}
