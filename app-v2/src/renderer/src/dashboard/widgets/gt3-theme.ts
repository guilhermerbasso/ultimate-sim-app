// Original motorsport dashboard theme tokens and formatters.
// The renderers are intentionally pure helpers so previews and live widgets share
// the same color ramps without adding per-frame runtime work.

import type { DashboardElement, DashboardElementStyle } from '../../../../shared/dashboards'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'

// GT3 color discipline (motorsport HMI rule):
//   - WARM tones (red / orange / amber) = chrome, accents, highlights, warnings.
//   - COOL / GREEN = positive "good" STATE ONLY (delta better than best, optimal
//     temp, healthy wear / pressure). Never use green as decorative chrome.
// green = positive state only: `green` / `teal` / `lime` / `flagGreen` are
// intentionally the SAME single state-good hue (#1AFF6E). `good` is the canonical
// STATE alias to reach for in new code; warm `chrome` / `accent` cover decoration.
export const GT3 = {
  black: '#000000',
  bg0: '#000000',
  bg1: '#000000',
  bg2: '#000000',
  panel: '#000000',
  panelRaised: '#000000',
  panelDeep: '#000000',
  panelGraphite: '#000000',
  panelStroke: '#1F1F1F',
  panelStrokeHot: '#2E2E2E',
  textPrimary: '#F4F4F4',
  textSecondary: '#8A8A8A',
  textMuted: '#4A4A4A',
  cyan: '#00BFFF',
  // green = positive state only — teal/green/lime/good are one state-good hue.
  teal: '#1AFF6E',
  green: '#1AFF6E',
  lime: '#1AFF6E',
  good: '#1AFF6E',
  // Warm chrome / accents / highlights — the only palette allowed for decoration.
  amber: '#FFB800',
  orange: '#FF7A00',
  chrome: '#FFB800',
  accent: '#FF7A00',
  red: '#FF2200',
  magenta: '#FF2200',
  purple: '#00BFFF',
  blue: '#00BFFF',
  whiteFlash: '#FFFFFF',
  pitBlue: '#00BFFF',
  flagYellow: '#FFB800',
  flagBlue: '#00BFFF',
  flagGreen: '#1AFF6E',
  flagRed: '#FF2200'
} as const

export const FONT_CONDENSED = '"Chakra Petch", "Michroma", monospace'
export const FONT_MONO = '"DSEG7Classic-Regular", "DSEG14Classic-Regular", monospace'
export const FONT_TECH = '"Rajdhani", "Barlow Condensed", sans-serif'

// ── Numeral-only DSEG discipline ──────────────────────────────────────────────
// DSEG 7-seg renders garbled for letters/symbols. Use DSEG (FONT_MONO) for numeric
// readouts ONLY; route any letter/label/unit text to the condensed face.
export function isNumericReadout(v: unknown): boolean {
  return typeof v === 'string' && /^\s*[-−+±]?\d[\d.,:\s]*%?$/.test(v)
}

export function readoutFont(v: unknown): string {
  return typeof v === 'string' && !isNumericReadout(v) ? FONT_CONDENSED : FONT_MONO
}

export function gearFont(g: string): string {
  return /^\d$/.test(g) ? FONT_MONO : FONT_CONDENSED
}

// Pure/matte-black surfaces only — no carbon weave, brushed metal or gradients.
// Backgrounds are flat #000 and separation comes from hairline strokes alone.
export const GT3_PANEL_BACKGROUND = '#000000'

export const GT3_RECESSED_BACKGROUND = '#000000'

export const BRUSHED_METAL_BACKGROUND = '#2A2A2A'

export function elementBox(element: DashboardElement): { left: number; top: number; width: number; height: number } {
  return { left: element.x, top: element.y, width: element.w, height: element.h }
}

export function panelChrome(
  style: DashboardElementStyle,
  opts: { glow?: string; radius?: number; plain?: boolean } = {}
): {
  background: string
  border: string
  borderRadius: number
  boxShadow?: string
} {
  const radius = style.radius ?? opts.radius ?? 2
  // Opt-in borderless: when a caller explicitly asks for no box (borderWidth 0
  // or a transparent background) the widget floats straight on the black canvas
  // with no hairline at all — the cleanest motorsport look. Boxed widgets that
  // set a real background keep their single hairline separator.
  const borderless = opts.plain || style.borderWidth === 0 || style.background === 'transparent'
  const background = borderless ? 'transparent' : (style.background ?? GT3_PANEL_BACKGROUND)
  return {
    background,
    border: borderless ? 'none' : `1px solid ${GT3.panelStroke}`,
    borderRadius: radius,
    boxShadow: 'none'
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

export function rpmRampColor(pct: number, style?: DashboardElementStyle): string {
  const p = clamp01(pct)
  const warnAt = style?.warnAt ?? 0.50
  const dangerAt = style?.dangerAt ?? 0.75
  const flashAt = style?.flashAt ?? 0.90
  if (p >= flashAt) return GT3.whiteFlash
  if (p >= dangerAt) return GT3.red
  if (p >= warnAt) return GT3.amber
  return GT3.green
}

export function tyreTempColor(c: number | undefined, style?: DashboardElementStyle): string {
  if (c === undefined) return GT3.textMuted
  const cold = style?.coldAt ?? 70
  const optimal = style?.optimalAt ?? 86
  const hot = style?.hotAt ?? 104
  const crit = style?.criticalAt ?? 116
  if (c >= crit) return GT3.red
  if (c >= hot) return GT3.orange
  if (c >= optimal) return GT3.green
  if (c >= cold) return GT3.amber
  return GT3.amber
}

export function brakeTempColor(c: number | undefined, style?: DashboardElementStyle): string {
  if (c === undefined) return GT3.textMuted
  const cold = style?.coldAt ?? 260
  const optimal = style?.optimalAt ?? 610
  const hot = style?.hotAt ?? 820
  if (c >= hot) return GT3.red
  if (c >= optimal) return GT3.amber
  if (c >= cold) return GT3.green
  return GT3.amber
}

export function pressureColor(kpa: number | undefined, target = 165, tol = 7): string {
  if (kpa === undefined) return GT3.textMuted
  const d = kpa - target
  if (Math.abs(d) <= tol) return GT3.green
  if (d < 0) return GT3.amber
  if (d <= tol * 2) return GT3.amber
  return GT3.red
}

export function wearColor(pctRemaining: number | undefined): string {
  if (pctRemaining === undefined) return GT3.textMuted
  const p = clamp01(pctRemaining)
  if (p >= 0.55) return GT3.green
  if (p >= 0.28) return GT3.amber
  return GT3.red
}

export function fmtTemp(c: number | undefined, unit?: string): string {
  if (c === undefined || !Number.isFinite(c)) return '—'
  if (unit === 'F') return `${Math.round(c * 1.8 + 32)}`
  return `${Math.round(c)}`
}

export function fmtPressure(kpa: number | undefined, unit?: string): string {
  if (kpa === undefined || !Number.isFinite(kpa)) return '—'
  if (unit === 'psi') return (kpa * 0.1450377).toFixed(1)
  if (unit === 'bar') return (kpa * 0.01).toFixed(2)
  return kpa.toFixed(0)
}

export function pressureUnitLabel(unit?: string): string {
  if (unit === 'psi') return 'psi'
  if (unit === 'bar') return 'bar'
  return 'kPa'
}

export function fmtVolume(liters: number | undefined, unit?: string): string {
  if (liters === undefined || !Number.isFinite(liters)) return '—'
  if (unit === 'gal') return (liters * 0.264172).toFixed(1)
  return liters.toFixed(1)
}

export type CornerKey = 'lf' | 'rf' | 'lr' | 'rr'
export const CORNER_ORDER: CornerKey[] = ['lf', 'rf', 'lr', 'rr']
export const CORNER_LABEL: Record<CornerKey, string> = { lf: 'LF', rf: 'RF', lr: 'LR', rr: 'RR' }

export function tyreCorner(
  snap: TelemetrySnapshot | null,
  corner: CornerKey,
  field: 'tempC' | 'pressureKpa' | 'wearPct'
): number | undefined {
  const v = snap?.tyres?.[corner]?.[field]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

export function brakeCorner(snap: TelemetrySnapshot | null, corner: CornerKey): number | undefined {
  const v = snap?.brakeTempC?.[corner]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

export const PREVIEW_SNAPSHOT: TelemetrySnapshot = {
  sim: 'mock',
  connected: true,
  timestamp: 0,
  speedKmh: 236,
  rpm: 7420,
  gear: 5,
  maxRpm: 8200,
  shiftIndicatorPct: 0.86,
  throttle: 0.98,
  brake: 0.02,
  clutch: 0,
  steerAngleDeg: -18,
  latAccelG: 0.82,
  longAccelG: -0.64,
  vertAccelG: 0.12,
  drs: false,
  absActive: true,
  absEnabled: true,
  absLevel: 4,
  tcActive: true,
  tcEnabled: true,
  tcLevel: 6,
  engineMap: 3,
  brakeBiasPct: 54.8,
  handbrake: 0,
  waterTempC: 92,
  oilTempC: 108,
  oilPressureKpa: 430,
  sessionType: 'RACE',
  carName: 'GT3',
  trackName: 'Spa',
  sessionTimeRemainingSec: 2410,
  lapsRemaining: 18,
  currentLap: 12,
  lapDistPct: 0.43,
  lastLapTimeSec: 138.452,
  bestLapTimeSec: 137.911,
  currentLapTimeSec: 59.21,
  estimatedLapTimeSec: 137.62,
  deltaToBestSec: -0.214,
  deltaToSessionBestSec: -0.081,
  position: 4,
  classPosition: 2,
  totalCars: 24,
  strengthOfField: 3120,
  fuelLiters: 46.5,
  fuelPerLap: 2.92,
  fuelCapacityLiters: 120,
  tyres: {
    lf: { tempC: 92, pressureKpa: 165, wearPct: 0.78 },
    rf: { tempC: 108, pressureKpa: 171, wearPct: 0.71 },
    lr: { tempC: 88, pressureKpa: 162, wearPct: 0.84 },
    rr: { tempC: 99, pressureKpa: 167, wearPct: 0.8 }
  },
  brakeTempC: { lf: 540, rf: 612, lr: 360, rr: 405 },
  flags: {
    green: true,
    yellow: false,
    blue: false,
    white: false,
    checkered: false,
    red: false,
    black: false,
    meatball: false,
    repair: false,
    disqualify: false,
    greenWhiteCheckered: false
  },
  pitLimiter: false,
  onPitRoad: false,
  incidentCount: 4,
  incidentLimit: 17,
  fastRepairsAvailable: 1,
  trackTempC: 31,
  airTempC: 24,
  trackWetnessPct: 0.05,
  isRaining: false,
  gripPct: 0.96,
  playerCarIdx: 0,
  drivers: [
    { carIdx: 7, name: 'A. Rossi', carNumber: '7', position: 3, classPosition: 1, classId: 1, classColor: '#158BFF', gapToPlayerSec: 1.42, lapDistPct: 0.46, lastLapTimeSec: 137.8, isPlayer: false },
    { carIdx: 0, name: 'YOU', carNumber: '24', position: 4, classPosition: 2, classId: 1, classColor: '#35F2B8', gapToPlayerSec: 0, lapDistPct: 0.43, lastLapTimeSec: 138.452, isPlayer: true },
    { carIdx: 11, name: 'M. Sato', carNumber: '11', position: 5, classPosition: 3, classId: 1, classColor: '#FFB000', gapToPlayerSec: -0.83, lapDistPct: 0.39, lastLapTimeSec: 138.1, isPlayer: false }
  ],
  relatives: {
    ahead: { carIdx: 7, name: 'A. Rossi', carNumber: '7', position: 3, classPosition: 1, gapSec: 1.42, lastLapTimeSec: 137.8, classColor: '#158BFF' },
    behind: { carIdx: 11, name: 'M. Sato', carNumber: '11', position: 5, classPosition: 3, gapSec: -0.83, lastLapTimeSec: 138.1, classColor: '#FFB000' }
  },
  radarCars: [
    { carIdx: 7, name: 'A. Rossi', relativeX: -2.8, relativeY: 15, gapSec: 1.42, classColor: '#158BFF' },
    { carIdx: 11, name: 'M. Sato', relativeX: 3.1, relativeY: -9, gapSec: -0.83, classColor: '#FFB000' }
  ]
}
