import { type ReactElement } from 'react'
import { DEFAULT_ALERTS_CONFIG } from '../../../../../shared/alerts'
import {
  fuelLapsRemainingOf,
  type TelemetrySnapshot
} from '../../../../../shared/telemetry'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { C, CleanTile, FONT_BIG, FONT_LABEL, FONT_NUM, fixed, frac, legibleStroke, num } from '../kit'
import { SHIFT_STROBE_BLUE, ShiftStrobe, resolveRevLightState, revLightRowLayout } from '../../../lib/rev-lights'

const AMBER = '#ffb000'
const CYAN = '#00d8ff'
const WHITE = '#f8fbff'
const BLUE = '#157cff'
const RED = '#ff2626'

function empty(width: number, height: number): ReactElement {
  return <CleanTile width={width} height={height}>{null}</CleanTile>
}

function ArrowChevron({ side, width, height }: { side: 'left' | 'right'; width: number; height: number }): ReactElement {
  const showLeft = side === 'left'
  const points = showLeft ? '140 34 72 110 140 186' : '80 34 148 110 80 186'
  return (
    <CleanTile width={width} height={height}>
      <defs>
        <filter id={`alerts-${side}-chevron-glow`} x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor={AMBER} floodOpacity="0.95" />
          <feDropShadow dx="0" dy="0" stdDeviation="14" floodColor={AMBER} floodOpacity="0.52" />
        </filter>
      </defs>
      <polyline points={points} fill="none" stroke={AMBER} strokeWidth="18" strokeLinecap="square" strokeLinejoin="miter" filter={`url(#alerts-${side}-chevron-glow)`} />
      <polyline points={points} fill="none" stroke="#ffe48a" strokeWidth="5" strokeLinecap="square" strokeLinejoin="miter" opacity="0.9" />
    </CleanTile>
  )
}

function AlertCarLeft({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 220
  const h = height ?? 220
  if (snapshot?.carLeftRight !== 'left' && snapshot?.carLeftRight !== 'both') return empty(w, h)
  return <ArrowChevron side="left" width={w} height={h} />
}

function AlertCarRight({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 220
  const h = height ?? 220
  if (snapshot?.carLeftRight !== 'right' && snapshot?.carLeftRight !== 'both') return empty(w, h)
  return <ArrowChevron side="right" width={w} height={h} />
}

interface RadarDot {
  x: number
  y: number
  gap?: number
  side?: 'left' | 'right' | 'center'
}

function radarDots(snapshot: TelemetrySnapshot | null): RadarDot[] {
  if (!snapshot) return []
  const fromRadar: RadarDot[] = []
  for (const car of snapshot.radarCars ?? []) {
    const relX = num(car.relativeX)
    const relY = num(car.relativeY)
    if (relX == null || relY == null) continue
    fromRadar.push({
      x: 180 + Math.max(-1, Math.min(1, relX / 8)) * 102,
      y: 180 - Math.max(-1, Math.min(1, relY / 16)) * 118,
      gap: num(car.gapSec),
      side: relX < -0.3 ? 'left' : relX > 0.3 ? 'right' : 'center'
    })
  }
  if (fromRadar.length > 0) return fromRadar

  const dots: RadarDot[] = []
  const ahead = num(snapshot.relatives?.ahead?.gapSec)
  const behind = num(snapshot.relatives?.behind?.gapSec)
  if (ahead != null) dots.push({ x: 180, y: 76, gap: Math.abs(ahead), side: 'center' })
  if (behind != null) dots.push({ x: 180, y: 284, gap: Math.abs(behind), side: 'center' })
  return dots
}

function AlertProximityRadar({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 360
  const h = height ?? 360
  const dots = radarDots(snapshot)
  if (!snapshot || dots.length === 0) return empty(w, h)

  return (
    <CleanTile width={w} height={h}>
      <defs>
        <filter id="alerts-radar-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor={CYAN} floodOpacity="0.7" />
        </filter>
        <filter id="alerts-radar-red-glow" x="-90%" y="-90%" width="280%" height="280%">
          <feDropShadow dx="0" dy="0" stdDeviation="7" floodColor={RED} floodOpacity="0.9" />
        </filter>
      </defs>
      <circle cx="180" cy="180" r="132" fill="none" stroke={CYAN} strokeWidth="1.5" opacity="0.35" />
      <path d="M180 36v34M180 290v34M36 180h34M290 180h34" stroke={CYAN} strokeWidth="1.5" opacity="0.42" />
      <rect x="164" y="134" width="32" height="72" rx="10" fill="rgba(0,216,255,0.08)" stroke={CYAN} strokeWidth="4" filter="url(#alerts-radar-glow)" />
      {dots.map((dot, i) => {
        const close = dot.gap != null && dot.gap <= 0.5
        const color = close ? RED : dot.gap != null && dot.gap <= 1 ? AMBER : WHITE
        return (
          <circle
            key={`${dot.x}-${dot.y}-${i}`}
            cx={dot.x}
            cy={dot.y}
            r={close ? 9 : 7}
            fill={color}
            filter={close ? 'url(#alerts-radar-red-glow)' : undefined}
            opacity={dot.gap == null ? 0.85 : 1}
          />
        )
      })}
    </CleanTile>
  )
}

function AlertShiftFlash({
  snapshot,
  width,
  height,
  visibility,
  alertsConfig
}: HifiWidgetProps): ReactElement {
  const w = width ?? 1200
  const h = height ?? 80
  const state = resolveRevLightState(
    frac(num(snapshot?.shiftIndicatorPct), 0, 1),
    snapshot?.revLights?.blink,
    alertsConfig?.shiftPoint.shiftIndicatorPct ??
      DEFAULT_ALERTS_CONFIG.shiftPoint.shiftIndicatorPct
  )
  const active = visibility ? visibility.visible : state.atShiftPoint
  if (!snapshot || !active) return empty(w, h)
  const layout = revLightRowLayout(w, h, 72, {
    gap: 5,
    heightRatio: 0.2,
    minLedHeight: Math.min(4, Math.max(1, Number.isFinite(h) ? h : 80))
  })
  return (
    <CleanTile width={w} height={h}>
      <defs>
        <filter id="alerts-shift-glow" x="-8%" y="-220%" width="116%" height="540%">
          <feGaussianBlur stdDeviation="9" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter="url(#alerts-shift-glow)">
        <ShiftStrobe active />
        {layout.positions.map((x, i) => (
          <rect
            key={i}
            x={x}
            y={layout.y}
            width={layout.ledWidth}
            height={layout.ledHeight}
            rx={layout.ledHeight / 2}
            fill={SHIFT_STROBE_BLUE}
          />
        ))}
      </g>
    </CleanTile>
  )
}

function AlertPitLimiter({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 360
  const h = height ?? 220
  if (snapshot?.pitLimiter !== true) return empty(w, h)
  return (
    <CleanTile width={w} height={h}>
      <defs>
        <filter id="alerts-limiter-glow" x="-50%" y="-70%" width="200%" height="240%">
          <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor={AMBER} floodOpacity="0.9" />
          <feDropShadow dx="0" dy="0" stdDeviation="14" floodColor={AMBER} floodOpacity="0.45" />
        </filter>
      </defs>
      <g filter="url(#alerts-limiter-glow)" stroke={AMBER} strokeLinecap="round" strokeLinejoin="round">
        <rect x="54" y="28" width="252" height="164" rx="26" fill="rgba(0,0,0,0.04)" strokeWidth="4" />
        <path d="M118 105a62 62 0 0 1 124 0" fill="none" strokeWidth="9" />
        <path d="M180 105 222 68" strokeWidth="9" />
        <circle cx="180" cy="105" r="10" fill={AMBER} stroke="none" />
        <path d="M124 105h-13M137 73l-9-9M180 55V42M223 73l9-9M236 105h13" strokeWidth="6" />
        <text x="180" y="160" textAnchor="middle" fill={AMBER} fontFamily={FONT_LABEL} fontSize="42" fontWeight="900" letterSpacing="2" {...legibleStroke(42)}>
          LIMITER
        </text>
      </g>
    </CleanTile>
  )
}

function activeFlagColor(snapshot: TelemetrySnapshot | null): string | null {
  const flags = snapshot?.flags
  if (!flags) return null
  if (flags.red) return RED
  if (flags.blue) return BLUE
  if (flags.white) return WHITE
  if (flags.black || flags.meatball || flags.disqualify) return '#151515'
  if (flags.checkered || flags.greenWhiteCheckered) return WHITE
  if (flags.yellow) return '#ffd200'
  return null
}

function AlertFlag({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 320
  const h = height ?? 240
  const color = activeFlagColor(snapshot)
  if (!color) return empty(w, h)
  const isBlack = color === '#151515'
  const isCheckered = Boolean(snapshot?.flags?.checkered || snapshot?.flags?.greenWhiteCheckered)
  return (
    <CleanTile width={w} height={h}>
      <defs>
        <filter id="alerts-flag-glow" x="-50%" y="-60%" width="200%" height="220%">
          <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor={isBlack ? WHITE : color} floodOpacity="0.62" />
          <feDropShadow dx="0" dy="0" stdDeviation="14" floodColor={isBlack ? WHITE : color} floodOpacity="0.3" />
        </filter>
        <linearGradient id="alerts-flag-shade" x1="0" x2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.44)" />
          <stop offset="46%" stopColor="rgba(255,255,255,0.02)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.2)" />
        </linearGradient>
      </defs>
      <g filter="url(#alerts-flag-glow)">
        <path d="M52 48 C104 62 130 76 184 74 C218 73 242 82 272 96 L276 190 C232 177 198 166 153 170 C112 174 84 158 58 158 Z" fill={color} />
        <path d="M52 48 C104 62 130 76 184 74 C218 73 242 82 272 96 L276 190 C232 177 198 166 153 170 C112 174 84 158 58 158 Z" fill="url(#alerts-flag-shade)" opacity="0.65" />
        <path d="M75 56 C101 92 104 128 76 158 M135 72 C165 104 167 139 150 170 M207 76 C236 112 237 147 216 176" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="8" />
        {isBlack || isCheckered ? (
          <g opacity={isCheckered ? 0.95 : 1}>
            <path d="M178 86h42v38h-42zM94 68h42v38H94zM136 106h42v38h-42zM220 124h42v38h-42z" fill={isBlack ? '#ff7a00' : '#101010'} opacity={isBlack ? 0.9 : 1} />
          </g>
        ) : null}
      </g>
    </CleanTile>
  )
}

function AlertLowFuel({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 360
  const h = height ?? 200
  const laps = fuelLapsRemainingOf(snapshot)
  if (!snapshot || laps == null) return empty(w, h)
  return (
    <CleanTile width={w} height={h}>
      <defs>
        <filter id="alerts-fuel-glow" x="-60%" y="-80%" width="220%" height="260%">
          <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor={AMBER} floodOpacity="0.9" />
          <feDropShadow dx="0" dy="0" stdDeviation="14" floodColor={AMBER} floodOpacity="0.45" />
        </filter>
      </defs>
      <g filter="url(#alerts-fuel-glow)" fill={AMBER} stroke={AMBER} strokeLinecap="round" strokeLinejoin="round">
        <path d="M42 58h58v98H42z" fill={AMBER} strokeWidth="0" />
        <rect x="48" y="66" width="44" height="34" rx="4" fill="rgba(0,0,0,0.82)" stroke="none" />
        <path d="M100 76c23 8 32 25 32 44v20c0 11 17 11 17 0v-34c0-14-8-23-19-30" fill="none" strokeWidth="10" />
        <path d="M126 72l17 18" fill="none" strokeWidth="8" />
        <text x="226" y="132" textAnchor="middle" fill={AMBER} fontFamily={FONT_NUM} fontSize="96" fontWeight="900" letterSpacing="-3" {...legibleStroke(96)}>
          {fixed(laps, 1)}
        </text>
        <text x="260" y="174" textAnchor="middle" fill={AMBER} fontFamily={FONT_LABEL} fontSize="31" fontWeight="900" letterSpacing="6" {...legibleStroke(31)}>
          LAPS
        </text>
      </g>
    </CleanTile>
  )
}

export const alertCarLeftWidget: HifiWidgetModule = {
  id: 'alertCarLeft',
  title: 'Alert Car Left',
  description: 'Trigger-only amber left-side spotter chevron.',
  category: 'alerts',
  tags: ['spotter', 'car-left', 'radar', 'trigger', 'clean'],
  requires: ['carLeftRight'],
  defaultSize: { w: 220, h: 220 },
  defaultTrigger: { kind: 'carLeft' },
  render: AlertCarLeft
}

export const alertCarRightWidget: HifiWidgetModule = {
  id: 'alertCarRight',
  title: 'Alert Car Right',
  description: 'Trigger-only amber right-side spotter chevron.',
  category: 'alerts',
  tags: ['spotter', 'car-right', 'radar', 'trigger', 'clean'],
  requires: ['carLeftRight'],
  defaultSize: { w: 220, h: 220 },
  defaultTrigger: { kind: 'carRight' },
  render: AlertCarRight
}

export const alertProximityRadarWidget: HifiWidgetModule = {
  id: 'alertProximityRadar',
  title: 'Alert Proximity Radar',
  description: 'Trigger-only top-down proximity radar with close-car emphasis.',
  category: 'alerts',
  tags: ['radar', 'proximity', 'spotter', 'trigger', 'clean'],
  requires: ['radarCars', 'relatives'],
  defaultSize: { w: 360, h: 360 },
  defaultTrigger: { kind: 'proximity', thresholdSec: 0.5 },
  render: AlertProximityRadar
}

export const alertShiftFlashWidget: HifiWidgetModule = {
  id: 'alertShiftFlash',
  title: 'Alert Shift Flash',
  description: 'Trigger-only blue and white full-width shift LED flash.',
  category: 'alerts',
  tags: ['rev-lights', 'shift', 'led', 'trigger', 'clean'],
  requires: ['shiftIndicatorPct'],
  defaultSize: { w: 1200, h: 80 },
  defaultTrigger: { kind: 'shiftPoint' },
  render: AlertShiftFlash
}

export const alertPitLimiterWidget: HifiWidgetModule = {
  id: 'alertPitLimiter',
  title: 'Alert Pit Limiter',
  description: 'Trigger-only amber pit speed limiter glyph.',
  category: 'alerts',
  tags: ['pit', 'limiter', 'trigger', 'clean'],
  requires: ['pitLimiter'],
  defaultSize: { w: 360, h: 220 },
  defaultTrigger: { kind: 'pitLimiter' },
  render: AlertPitLimiter
}

export const alertFlagWidget: HifiWidgetModule = {
  id: 'alertFlag',
  title: 'Alert Flag',
  description: 'Trigger-only racing flag pictogram colored by race-control state.',
  category: 'alerts',
  tags: ['flag', 'race-control', 'trigger', 'clean'],
  requires: ['flags'],
  defaultSize: { w: 320, h: 240 },
  defaultTrigger: { kind: 'flag' },
  render: AlertFlag
}

export const alertLowFuelWidget: HifiWidgetModule = {
  id: 'alertLowFuel',
  title: 'Alert Low Fuel',
  description: 'Trigger-only amber fuel pump with laps-to-empty readout.',
  category: 'alerts',
  tags: ['fuel', 'low-fuel', 'warning', 'trigger', 'clean'],
  requires: ['fuelLapsRemaining'],
  defaultSize: { w: 360, h: 200 },
  defaultTrigger: { kind: 'lowFuel' },
  render: AlertLowFuel
}
