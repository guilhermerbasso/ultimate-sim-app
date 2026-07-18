// Pure telemetry → frame renderers for the generic-device output engine.
//
// These functions turn a TelemetrySnapshot into the per-component pixel/text
// payloads the companion v2 protocol expects (see `src/shared/companion.ts`).
// They are deliberately side-effect free (no serial IO, no timers) so the
// `device-output` module can throttle/dedup/ship the results, and so they can
// be reasoned about in isolation. Timing-dependent effects (shift blink, flag
// blink) are driven by a `now` (ms epoch) argument passed in by the caller.

import type {
  GaugeComponent,
  RgbMatrixComponent,
  RgbStripComponent,
  SegDisplayComponent,
  StartLedComponent
} from '../../../shared/devices'
import {
  computeRevlights,
  normalizeRevlightsConfig,
  previewLedColors
} from '../../../shared/revlights'
import type { Flags, TelemetrySnapshot } from '../../../shared/telemetry'
import { formatMeasurement, type UnitSystem } from '../../../shared/units'

// ─── Constants ──────────────────────────────────────────────────────────────

const STRIP_OFF = '#000000'
// Blue used for the shift-light blink (matches the SIM-X shift indicator).
const SHIFT_BLUE = '#1f8dff'
// Shift blink half-period (ms). ~5.5Hz blink — fast and obvious.
const STRIP_BLINK_MS = 90

const MATRIX_OFF = '#000000'
// Flag blink half-period (ms). Flags change rarely; 2Hz is plenty.
const MATRIX_BLINK_MS = 250

type MatrixFlag = 'yellow' | 'blue' | 'white' | 'green' | 'red' | 'meatball' | 'checkered'

const MATRIX_FLAG_RGB: Record<Exclude<MatrixFlag, 'checkered'>, string> = {
  yellow: '#ffcc00',
  blue: '#1f8dff',
  white: '#f2f2f2',
  green: '#36d17c',
  red: '#e83a2f',
  meatball: '#ff7a1a'
}

// Only these flags blink on the matrix; everything else is steady.
const MATRIX_BLINK_FLAGS = new Set<MatrixFlag>(['yellow', 'blue'])

// Default rev-lights config used purely to derive shiftActive for a startLed
// whose trigger is `shift` (a startLed component carries no rev-lights config).
const SHIFT_TRIGGER_CONFIG = normalizeRevlightsConfig({ enabled: true, shiftBlink: true })

// ─── Helpers ────────────────────────────────────────────────────────────────

function blinkOn(now: number, halfPeriodMs: number): boolean {
  return Math.floor(now / halfPeriodMs) % 2 === 0
}

function clampCount(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(max, Math.trunc(value)))
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

// ─── RGB strip (rev lights) ─────────────────────────────────────────────────

// Build the physical per-LED colour array for a rev-lights strip. Length equals
// the component's `ledCount` (padded with off). The caller slices/caps the array
// to the serial frame budget and formats it with `formatStripRgb`.
export function stripColors(
  component: RgbStripComponent,
  snapshot: TelemetrySnapshot | null,
  now: number
): string[] {
  const rev = component.revlights
  const result = computeRevlights(snapshot, rev)

  let base: string[]
  if (result.flag && rev.flagBlink) {
    // A flag is active and the user opted to show flag colours on the strip.
    base = new Array<string>(rev.ledCount).fill(rev.flagColors[result.flag])
  } else {
    base = previewLedColors(rev, result.level)
  }

  // Shift-now owns the whole strip: every LED strobes uniformly in strong blue.
  if (result.shiftActive) {
    base = new Array<string>(rev.ledCount).fill(
      blinkOn(now, STRIP_BLINK_MS) ? SHIFT_BLUE : STRIP_OFF
    )
  }

  const count = clampCount(component.ledCount, 256)
  const out: string[] = []
  for (let i = 0; i < count; i += 1) out.push(base[i] ?? STRIP_OFF)
  return out
}

// ─── RGB matrix (iFlag) ─────────────────────────────────────────────────────

function detectMatrixFlag(flags: Flags | undefined): MatrixFlag | null {
  if (!flags) return null
  if (flags.red) return 'red'
  if (flags.meatball) return 'meatball'
  if (flags.yellow) return 'yellow'
  if (flags.blue) return 'blue'
  if (flags.white) return 'white'
  if (flags.checkered || flags.greenWhiteCheckered) return 'checkered'
  if (flags.green) return 'green'
  return null
}

// Rotate a grid of colours by the component orientation (0/90/180/270). 90/270
// are only well-defined for square panels (the iFlag 8x8), so non-square grids
// keep their original orientation for those angles. Serpentine wiring is a
// physical property handled by the firmware, not here.
function rotateGrid(rows: string[][], orientation: number): string[][] {
  const o = ((Math.trunc(orientation) % 360) + 360) % 360
  if (o === 0 || rows.length === 0) return rows
  const h = rows.length
  const w = rows[0].length
  if ((o === 90 || o === 270) && w !== h) return rows
  const outH = o === 180 ? h : w
  const outW = o === 180 ? w : h
  const out: string[][] = []
  for (let r = 0; r < outH; r += 1) {
    const row: string[] = []
    for (let c = 0; c < outW; c += 1) {
      let sr: number
      let sc: number
      if (o === 90) {
        sr = h - 1 - c
        sc = r
      } else if (o === 180) {
        sr = h - 1 - r
        sc = w - 1 - c
      } else {
        sr = c
        sc = w - 1 - r
      }
      row.push(rows[sr][sc])
    }
    out.push(row)
  }
  return out
}

// Render the matrix as `height` rows of `width` hex colours. No active flag → a
// blank (all-off) frame so the panel clears when flags drop. Yellow/blue blink.
export function matrixFrame(
  component: RgbMatrixComponent,
  snapshot: TelemetrySnapshot | null,
  now: number
): string[][] {
  const width = Math.max(1, clampCount(component.width, 32))
  const height = Math.max(1, clampCount(component.height, 32))
  const flag = snapshot?.connected ? detectMatrixFlag(snapshot.flags) : null

  const rows: string[][] = []
  if (!flag) {
    for (let r = 0; r < height; r += 1) rows.push(new Array<string>(width).fill(MATRIX_OFF))
    return rotateGrid(rows, component.orientation)
  }

  const off = MATRIX_BLINK_FLAGS.has(flag) && !blinkOn(now, MATRIX_BLINK_MS)
  for (let r = 0; r < height; r += 1) {
    const row: string[] = []
    for (let c = 0; c < width; c += 1) {
      let color: string
      if (flag === 'checkered') {
        // 2×2 checkerboard of white / black.
        color = (Math.floor(r / 2) + Math.floor(c / 2)) % 2 === 0 ? '#ffffff' : '#000000'
      } else {
        color = MATRIX_FLAG_RGB[flag]
      }
      row.push(off ? MATRIX_OFF : color)
    }
    rows.push(row)
  }
  return rotateGrid(rows, component.orientation)
}

// ─── Screen (OLED text page) ────────────────────────────────────────────────

function gearLabel(gear: number | undefined): string {
  if (gear === undefined || !Number.isFinite(gear)) return '-'
  if (gear < 0) return 'R'
  if (gear === 0) return 'N'
  return String(Math.trunc(gear))
}

function lapTimeShort(sec: number | undefined): string {
  if (sec === undefined || !Number.isFinite(sec) || sec <= 0) return '--.-'
  const minutes = Math.floor(sec / 60)
  const seconds = sec - minutes * 60
  if (minutes > 0) return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`
  return seconds.toFixed(2)
}

function deltaShort(sec: number | undefined): string {
  if (sec === undefined || !Number.isFinite(sec)) return '--'
  const sign = sec >= 0 ? '+' : '-'
  return `${sign}${Math.abs(sec).toFixed(2)}`
}

// Default 3-row telemetry page: gear+speed, last/best lap, delta. Returns null
// when there is no connected telemetry (leave the screen as-is).
export function oledRows(snapshot: TelemetrySnapshot | null, unitSystem: UnitSystem = 'metric'): [string, string, string] | null {
  if (!snapshot?.connected) return null
  const speed = formatMeasurement(snapshot.speedKmh, 'speed-kmh', unitSystem, { decimals: 0 })
  const row0 = `${gearLabel(snapshot.gear)}  ${speed.display} ${speed.unit}`
  const row1 = `L${lapTimeShort(snapshot.lastLapTimeSec)} B${lapTimeShort(snapshot.bestLapTimeSec)}`
  const row2 = `DLT ${deltaShort(snapshot.deltaToBestSec)}`
  return [row0, row1, row2]
}

// ─── 7-seg display ──────────────────────────────────────────────────────────

// Map the configured metric to a display string. Returns null when the metric
// has no value (skip the send and keep the last shown value).
export function segValue(
  component: SegDisplayComponent,
  snapshot: TelemetrySnapshot | null,
  unitSystem: UnitSystem = 'metric'
): string | null {
  if (!snapshot?.connected) return null
  switch (component.metric) {
    case 'gear':
      return gearLabel(snapshot.gear)
    case 'speed':
      return formatMeasurement(snapshot.speedKmh, 'speed-kmh', unitSystem, { decimals: 0 }).value?.toFixed(0) ?? null
    case 'rpm':
      return Number.isFinite(snapshot.rpm) ? String(Math.round(snapshot.rpm)) : null
    case 'lap':
      return snapshot.currentLap !== undefined ? String(Math.trunc(snapshot.currentLap)) : null
    case 'position':
      return snapshot.position !== undefined ? String(Math.trunc(snapshot.position)) : null
    case 'custom':
    default:
      return null
  }
}

// ─── Gauge (servo / stepper) ────────────────────────────────────────────────

function gaugeMetricValue(component: GaugeComponent, snapshot: TelemetrySnapshot): number | null {
  switch (component.metric) {
    case 'speed':
      return Number.isFinite(snapshot.speedKmh) ? snapshot.speedKmh : null
    case 'rpm':
      return Number.isFinite(snapshot.rpm) ? snapshot.rpm : null
    case 'fuel':
      return snapshot.fuelLiters !== undefined && Number.isFinite(snapshot.fuelLiters)
        ? snapshot.fuelLiters
        : null
    // waterTemp / oilTemp / custom are not in the normalized snapshot — skip.
    case 'waterTemp':
    case 'oilTemp':
    case 'custom':
    default:
      return null
  }
}

// Map the metric value across [minValue,maxValue] → [minAngle,maxAngle]. Returns
// null when the metric has no value.
export function gaugeAngle(
  component: GaugeComponent,
  snapshot: TelemetrySnapshot | null
): number | null {
  if (!snapshot?.connected) return null
  const value = gaugeMetricValue(component, snapshot)
  if (value === null) return null
  const span = component.maxValue - component.minValue
  const t = span !== 0 ? clamp01((value - component.minValue) / span) : 0
  const angle = component.minAngle + t * (component.maxAngle - component.minAngle)
  return Math.round(angle)
}

// ─── Status LED ─────────────────────────────────────────────────────────────

// Evaluate whether a startLed should be lit for the current snapshot.
export function startLedOn(
  component: StartLedComponent,
  snapshot: TelemetrySnapshot | null
): boolean {
  if (!snapshot?.connected) return false
  switch (component.trigger) {
    case 'pitLimiter':
      return Boolean(snapshot.pitLimiter) || Boolean(snapshot.onPitRoad)
    case 'drs':
      return Boolean(snapshot.drs)
    case 'shift':
      return computeRevlights(snapshot, SHIFT_TRIGGER_CONFIG).shiftActive
    case 'custom':
    default:
      return false
  }
}
