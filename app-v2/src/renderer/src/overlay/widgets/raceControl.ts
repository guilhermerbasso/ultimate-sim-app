// Pure, dependency-light helpers shared by the R16 overlay batch (ERS / P2P /
// pit / weather / surface / BoP / cold-pressure / session-clock widgets). Kept
// framework-free so the widgets stay thin and the logic stays unit-testable.

import type { Corners, PitStatus } from '../../../../shared/telemetry'

// Shared palette for the R16 overlay batch. COLOR RULE: warm tokens drive chrome
// and accents; cool/green/blue is reserved for genuinely positive "good" states
// (full battery, dry track, pits open, faster delta, optimal shift point).
export const WARM_RED = '#ff3b1f'
export const WARM_ORANGE = '#ff6a00'
export const WARM_AMBER = '#ffb000'
export const GOOD_GREEN = '#13c27b'
export const COOL_BLUE = '#5bb8ff'
export const SHIFT_BLUE = '#60a5fa'
export const DIM = 'rgba(255, 232, 210, 0.16)'

export function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

export function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

// ─── ERS / hybrid battery ────────────────────────────────────────────────────
export type EnergyTone = 'good' | 'mid' | 'low' | 'empty'

// EnergyERSBatteryPct is 0..1. High charge is a GOOD state (cool/green); a drained
// pack is a warm warning. Returns null when the car exposes no ERS channel.
export function energyTone(pct: number | undefined): EnergyTone | null {
  if (!isNum(pct)) return null
  const v = clamp(pct)
  if (v >= 0.66) return 'good'
  if (v >= 0.34) return 'mid'
  if (v > 0.06) return 'low'
  return 'empty'
}

// ─── Push-to-Pass ────────────────────────────────────────────────────────────
// 'none'    → car has no P2P system (hide the overlay)
// 'active'  → boost engaged right now (warm — aggressive action)
// 'ready'   → boost available, uses remaining (cool/green — good state)
// 'depleted'→ system present but no uses left (warm/dim)
export type PushToPassState = 'none' | 'active' | 'ready' | 'depleted'

export function pushToPassState(active: boolean | undefined, count: number | undefined): PushToPassState {
  if (active === undefined) return 'none'
  if (active) return 'active'
  if (isNum(count) && count <= 0) return 'depleted'
  return 'ready'
}

// ─── Pit service status (irsdk_PitSvStatus) ──────────────────────────────────
// 0=none, 1=in progress, 2=complete, 100+=error. 'good' (complete) is the only
// cool/green tone; everything else is neutral/idle or a warm alert.
export type PitServiceTone = 'idle' | 'active' | 'good' | 'error'

export interface PitServiceInfo {
  text: string
  tone: PitServiceTone
}

export function pitServiceInfo(svStatus: number | undefined): PitServiceInfo {
  if (!isNum(svStatus) || svStatus === 0) return { text: 'standby', tone: 'idle' }
  if (svStatus >= 100) return { text: 'service error', tone: 'error' }
  if (svStatus === 2) return { text: 'service done', tone: 'good' }
  return { text: 'servicing', tone: 'active' }
}

// Collapses the iRacing pit snapshot into the single most-important headline a
// driver needs while approaching the pits, plus a tone. Repairs and a closed pit
// lane are warm alerts; an open lane / completed service are the good states.
export type PitHeadlineTone = 'good' | 'warn' | 'alert' | 'info' | 'idle'

export interface PitHeadline {
  text: string
  tone: PitHeadlineTone
}

export function pitHeadline(pit: PitStatus | undefined): PitHeadline {
  if (!pit) return { text: 'no data', tone: 'idle' }
  if (pit.repairNeeded) return { text: 'repair required', tone: 'alert' }
  if (pit.inPitStall) {
    const sv = pitServiceInfo(pit.svStatus)
    if (sv.tone === 'good') return { text: 'service complete', tone: 'good' }
    if (sv.tone === 'error') return { text: 'service error', tone: 'alert' }
    return { text: 'no box', tone: 'info' }
  }
  if (pit.optRepairNeeded) return { text: 'optional repair', tone: 'warn' }
  if (!pit.pitsOpen) return { text: 'pits closed', tone: 'warn' }
  return { text: 'pits open', tone: 'good' }
}

// ─── Track surface ───────────────────────────────────────────────────────────
// On-track surfaces are neutral/good; anything off-line is a warm "you're off"
// warning. Kerbs are a caution between the two.
export type SurfaceTone = 'track' | 'kerb' | 'off'

const ON_TRACK = new Set(['asphalt', 'concrete', 'paint'])

export function surfaceTone(label: string | undefined): SurfaceTone {
  if (!label) return 'track'
  if (ON_TRACK.has(label)) return 'track'
  if (label === 'kerb') return 'kerb'
  return 'off'
}

// ─── Cold tyre pressures ─────────────────────────────────────────────────────
export function kpaToPsi(kpa: number | undefined): number | null {
  if (!isNum(kpa)) return null
  return kpa * 0.1450377
}

export interface PressureCorner {
  key: 'lf' | 'rf' | 'lr' | 'rr'
  kpa: number | null
  psi: number | null
  // 0..1 position within the [min,max] spread of the four corners (for bar fill).
  fill: number
  // Deviation from the 4-corner mean; corners far from the mean are flagged warm.
  outlier: boolean
}

const PRESSURE_OUTLIER_KPA = 3.5

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export function pressureCorners(corners: Corners<number> | undefined): PressureCorner[] {
  const keys: Array<PressureCorner['key']> = ['lf', 'rf', 'lr', 'rr']
  const raw = keys.map((key) => (corners && isNum(corners[key]) ? corners[key] : null))
  const present = raw.filter((value): value is number => value !== null)
  const min = present.length ? Math.min(...present) : 0
  const max = present.length ? Math.max(...present) : 0
  // Median (not mean) so a single very different corner doesn't make the other
  // three look like outliers — we want to flag the odd one out.
  const mid = median(present)
  const span = Math.max(1, max - min)
  return keys.map((key, index) => {
    const kpa = raw[index]
    return {
      key,
      kpa,
      psi: kpaToPsi(kpa ?? undefined),
      fill: kpa === null ? 0 : clamp((kpa - min) / span),
      outlier: kpa !== null && present.length > 1 && Math.abs(kpa - mid) >= PRESSURE_OUTLIER_KPA
    }
  })
}

export function hasAnyPressure(corners: Corners<number> | undefined): boolean {
  if (!corners) return false
  return [corners.lf, corners.rf, corners.lr, corners.rr].some(isNum)
}

// ─── BoP (balance of performance) ────────────────────────────────────────────
// Any added ballast or power cut is a handicap → warm. A clean (zero) BoP is the
// neutral/good baseline.
export function hasBop(weightKg: number | undefined, powerPct: number | undefined): boolean {
  return (isNum(weightKg) && Math.abs(weightKg) > 0.01) || (isNum(powerPct) && Math.abs(powerPct) > 0.01)
}

// ─── Session time-of-day ─────────────────────────────────────────────────────
export type DayPhase = 'day' | 'dawn' | 'dusk' | 'night'

export interface TimeOfDayInfo {
  phase: DayPhase
  // 0..1 fraction through the 24h day (midnight = 0), for arc/needle placement.
  fraction: number
  night: boolean
}

export function timeOfDayInfo(secondsSinceMidnight: number | undefined): TimeOfDayInfo | null {
  if (!isNum(secondsSinceMidnight)) return null
  const total = ((secondsSinceMidnight % 86400) + 86400) % 86400
  const hour = total / 3600
  const fraction = total / 86400
  let phase: DayPhase = 'day'
  if (hour < 5.5 || hour >= 20.5) phase = 'night'
  else if (hour < 7.5) phase = 'dawn'
  else if (hour >= 18) phase = 'dusk'
  return { phase, fraction, night: phase === 'night' }
}
