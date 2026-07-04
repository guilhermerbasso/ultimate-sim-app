// PROXIMITY RADAR overlay — a top-down spotter radar: your car at the centre, nearby
// cars drawn as blips positioned by their real relative offset (metres). A car is a RED
// threat only when it is genuinely ALONGSIDE (within side proximity and overlapping
// longitudinally); anything clearly ahead/behind is neutral/class-coloured. Left/right
// threat chips mirror the spotter's "car left / car right" call.
//
// v2.39 rebuild: one root <svg> (fixed viewBox) — a header, the radar field with range
// rings + blips, side threat chips, and a nearest-gap readout, every glyph a FitText so
// nothing overflows / clips / renders sub-legible. NaN-safe: non-finite blips are
// filtered and a missing nearest gap reads "—". Threat colours come from shared/radar;
// chrome + labels are skin tokens so a skin swap re-skins the frame.
import { type ReactElement } from 'react'
import {
  type RadarThreat,
  radarSideThreat,
  radarThreatColor,
  radarThreatLevel
} from '../../../../shared/radar'
import type { RadarCarEntry } from '../../../../shared/telemetry'
import { resolveSkin, FitText } from '../../skins'
import type { SkinId, BrandId, SkinToken } from '../../skins'
import type { WidgetProps } from './types'

const DEFAULT_W = 300
const DEFAULT_H = 300
const RADAR_RANGE_X_METERS = 10
const RADAR_RANGE_Y_METERS = 35
const SIDE_PROXIMITY_METERS = 5
const RADAR_NEUTRAL = 'rgba(138, 164, 200, 0.55)'

type Side = 'left' | 'right'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function widgetSkin(config: WidgetProps['config']): SkinToken {
  const style = (config?.style ?? {}) as { skin?: SkinId; brand?: BrandId }
  return resolveSkin(style.skin ?? 'gt3', style.brand ?? 'generic')
}

function sortedCars(cars: RadarCarEntry[] | undefined): RadarCarEntry[] {
  return [...(cars ?? [])]
    .filter((car) => Number.isFinite(car.relativeX) && Number.isFinite(car.relativeY))
    .sort((a, b) => Math.hypot(a.relativeX, a.relativeY) - Math.hypot(b.relativeX, b.relativeY))
}

function carSide(car: RadarCarEntry): Side | undefined {
  if (car.relativeX < 0) return 'left'
  if (car.relativeX > 0) return 'right'
  return undefined
}
function isInSideProximity(car: RadarCarEntry): boolean {
  return carSide(car) !== undefined && Math.abs(car.relativeX) <= SIDE_PROXIMITY_METERS
}
function carThreatLevel(car: RadarCarEntry): RadarThreat {
  return isInSideProximity(car) ? radarThreatLevel(car.relativeY) : 'clear'
}
function markerColor(car: RadarCarEntry): string {
  const level = carThreatLevel(car)
  if (level !== 'clear') return radarThreatColor(car.relativeY)
  return car.classColor ?? RADAR_NEUTRAL
}
function sideThreat(cars: RadarCarEntry[], side: Side): RadarThreat {
  return radarSideThreat(cars.filter((car) => carSide(car) === side && isInSideProximity(car)).map((car) => car.relativeY))
}
function numericText(value: number | undefined, decimals = 1): string {
  return value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(decimals)
}

export function ProximityRadarWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = widgetSkin(config)
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))
  const { palette, material, typography } = skin

  const cars = sortedCars(snapshot?.radarCars)
  const nearest = cars[0]
  const nearestGap = nearest ? Math.hypot(nearest.relativeX, nearest.relativeY) : undefined
  const leftThreat = sideThreat(cars, 'left')
  const rightThreat = sideThreat(cars, 'right')

  const pad = 12
  const headerH = 24
  const footerH = 34
  const fx = W / 2
  const fy = pad + headerH + (H - pad * 2 - headerH - footerH) / 2
  const rx = W * 0.4
  const ry = (H - pad * 2 - headerH - footerH) / 2 - 4

  const chipW = Math.max(18, W * 0.09)
  const threatColor = (t: RadarThreat): string => (t === 'beside' ? radarThreatColor(0) : palette.textDim)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      style={{ display: 'block' }}
      data-widget="proximityRadar"
      aria-label="Proximity radar"
    >
      <rect x={1} y={1} width={W - 2} height={H - 2} rx={material.radius} fill={material.base} stroke={material.border} strokeWidth={material.borderWidth} />

      <FitText x={pad} y={pad + headerH / 2} boxW={W * 0.45} boxH={headerH * 0.86} text="RADAR" anchor="start" fontFamily={typography.label} fill={palette.textDim} weight={800} letterSpacing={1.4} minFontPx={11} maxFontPx={17} />
      <FitText x={W - pad} y={pad + headerH / 2} boxW={W * 0.45} boxH={headerH * 0.82} text={`${cars.length} CARS`} anchor="end" fontFamily={typography.label} fill={palette.text} weight={700} letterSpacing={0.6} minFontPx={11} maxFontPx={15} />

      <rect x={fx - rx} y={fy - ry} width={rx * 2} height={ry * 2} rx={Math.min(rx, ry) * 0.5} fill={palette.bg} stroke={material.border} strokeWidth={material.borderWidth} />
      <line x1={fx} y1={fy - ry} x2={fx} y2={fy + ry} stroke={material.border} strokeWidth={1} opacity={0.6} />
      <line x1={fx - rx} y1={fy} x2={fx + rx} y2={fy} stroke={material.border} strokeWidth={1} opacity={0.4} />

      {/* left / right side threat chips */}
      <rect x={fx - rx - chipW - 2} y={fy - ry * 0.5} width={chipW} height={ry} rx={4} fill={leftThreat === 'beside' ? radarThreatColor(0) : palette.surface} stroke={material.border} strokeWidth={1} opacity={leftThreat === 'beside' ? 0.85 : 0.5} />
      <rect x={fx + rx + 2} y={fy - ry * 0.5} width={chipW} height={ry} rx={4} fill={rightThreat === 'beside' ? radarThreatColor(0) : palette.surface} stroke={material.border} strokeWidth={1} opacity={rightThreat === 'beside' ? 0.85 : 0.5} />
      <FitText x={fx - rx - chipW / 2 - 2} y={fy} boxW={chipW} boxH={14} text="L" fontFamily={typography.label} fill={threatColor(leftThreat)} weight={800} minFontPx={10} maxFontPx={13} />
      <FitText x={fx + rx + chipW / 2 + 2} y={fy} boxW={chipW} boxH={14} text="R" fontFamily={typography.label} fill={threatColor(rightThreat)} weight={800} minFontPx={10} maxFontPx={13} />

      {/* player car */}
      <rect x={fx - W * 0.018} y={fy - H * 0.03} width={W * 0.036} height={H * 0.06} rx={2} fill={palette.accent} />

      {/* blips */}
      {cars.map((car) => {
        const bx = fx + clamp(car.relativeX / RADAR_RANGE_X_METERS, -1, 1) * rx
        const by = fy - clamp(car.relativeY / RADAR_RANGE_Y_METERS, -1, 1) * ry
        const beside = carThreatLevel(car) === 'beside'
        return <circle key={car.carIdx} cx={bx} cy={by} r={beside ? W * 0.032 : W * 0.024} fill={markerColor(car)} stroke={palette.bg} strokeWidth={1} />
      })}

      <FitText x={pad} y={H - pad - footerH / 2} boxW={W * 0.5} boxH={footerH * 0.6} text="NEAREST" anchor="start" fontFamily={typography.label} fill={palette.textDim} weight={600} letterSpacing={0.6} minFontPx={10} maxFontPx={13} />
      <FitText x={W - pad} y={H - pad - footerH / 2} boxW={W * 0.45} boxH={footerH * 0.72} text={nearestGap === undefined ? '—' : `${numericText(nearestGap, 1)} m`} anchor="end" fontFamily={skin.segment.numeric} fill={nearestGap === undefined ? palette.textDim : palette.text} minFontPx={12} maxFontPx={18} />
    </svg>
  )
}
