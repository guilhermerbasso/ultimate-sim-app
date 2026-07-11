// CAR SILHOUETTE RADAR overlay — a spotter view drawn around YOUR car: a central car
// silhouette with side threat zones that light RED when a car is genuinely alongside
// (within side range and overlapping longitudinally), plus front/rear blips for cars
// closing ahead or behind. This is the "am I clear to move over?" instrument.
//
// v2.39 rebuild: one root <svg> (fixed viewBox) — a header, the silhouette + side
// zones + blips, and a nearest-gap readout, every glyph a FitText so nothing overflows,
// clips or renders sub-legible. NaN-safe: non-finite blips are filtered and a missing
// nearest gap reads "—". Threat colours come from shared/radar; chrome + labels are skin
// tokens so a skin swap re-skins the frame.
import { type ReactElement } from 'react'
import { RADAR_CAR_HALF_LEN_M, RADAR_THREAT_COLORS, radarSideThreat } from '../../../../shared/radar'
import type { RadarCarEntry } from '../../../../shared/telemetry'
import { resolveSkin, FitText } from '../../skins'
import type { SkinId, BrandId, SkinToken } from '../../skins'
import type { WidgetProps } from './types'
import { useUnitSystem } from '../../lib/units'
import { formatMeasurement } from '../../../../shared/units'

const DEFAULT_W = 220
const DEFAULT_H = 310
const SIDE_X_RANGE_M = 8
const FRONT_REAR_Y_RANGE_M = 28

type Side = 'left' | 'right'
type Threat = 'beside' | 'clear'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function widgetSkin(config: WidgetProps['config']): SkinToken {
  const style = (config?.style ?? {}) as { skin?: SkinId; brand?: BrandId }
  return resolveSkin(style.skin ?? 'gt3', style.brand ?? 'generic')
}

function carSide(car: RadarCarEntry): Side | undefined {
  if (car.relativeX < 0) return 'left'
  if (car.relativeX > 0) return 'right'
  return undefined
}
function isAlongside(car: RadarCarEntry): boolean {
  return Math.abs(car.relativeY) <= RADAR_CAR_HALF_LEN_M && Math.abs(car.relativeX) <= SIDE_X_RANGE_M
}
function isFrontRearProximity(car: RadarCarEntry): boolean {
  return Math.abs(car.relativeY) > RADAR_CAR_HALF_LEN_M && Math.abs(car.relativeY) <= FRONT_REAR_Y_RANGE_M && Math.abs(car.relativeX) <= SIDE_X_RANGE_M
}
function validRadarCars(cars: RadarCarEntry[] | undefined): RadarCarEntry[] {
  return (cars ?? []).filter((car) => Number.isFinite(car.relativeX) && Number.isFinite(car.relativeY))
}
function sideThreatForCars(cars: RadarCarEntry[], side: Side): Threat {
  return radarSideThreat(cars.filter((c) => isAlongside(c) && carSide(c) === side).map((c) => c.relativeY))
}
function closestDistance(cars: RadarCarEntry[]): number | undefined {
  const nearest = [...cars].sort((a, b) => Math.hypot(a.relativeX, a.relativeY) - Math.hypot(b.relativeX, b.relativeY))[0]
  if (!nearest) return undefined
  const distance = Math.hypot(nearest.relativeX, nearest.relativeY)
  return Number.isFinite(distance) ? distance : undefined
}
export function CarSilhouetteRadarWidget({ snapshot, config }: WidgetProps): ReactElement {
  const unitSystem = useUnitSystem()
  const skin = widgetSkin(config)
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))
  const { palette, material, typography } = skin
  const BESIDE = RADAR_THREAT_COLORS.beside

  const cars = validRadarCars(snapshot?.radarCars)
  const leftThreat = sideThreatForCars(cars, 'left')
  const rightThreat = sideThreatForCars(cars, 'right')
  const alongside = cars.filter(isAlongside)
  const frontRear = cars.filter(isFrontRearProximity)
  const nearestGap = closestDistance(cars)
  const nearestReading = formatMeasurement(nearestGap, 'distance-m', unitSystem, { decimals: 1, includeUnit: true })

  const pad = 12
  const headerH = 22
  const footerH = 34
  const fieldTop = pad + headerH
  const fieldBottom = H - pad - footerH
  const cx = W / 2
  const cy = (fieldTop + fieldBottom) / 2
  const bodyW = W * 0.26
  const bodyH = (fieldBottom - fieldTop) * 0.42
  const bodyTop = cy - bodyH / 2
  const bodyBottom = cy + bodyH / 2
  const topLimit = fieldTop + 6
  const bottomLimit = fieldBottom - 6
  const zoneW = Math.max(14, W * 0.11)
  const blipR = Math.max(5, W * 0.03)

  const frontRearPos = (car: RadarCarEntry): { x: number; y: number } => {
    const bx = cx + clamp(car.relativeX / SIDE_X_RANGE_M, -1, 1) * (bodyW * 0.95)
    const t = clamp((Math.abs(car.relativeY) - RADAR_CAR_HALF_LEN_M) / (FRONT_REAR_Y_RANGE_M - RADAR_CAR_HALF_LEN_M), 0, 1)
    const by = car.relativeY > 0 ? bodyTop - 10 - t * (bodyTop - 10 - topLimit) : bodyBottom + 10 + t * (bottomLimit - bodyBottom - 10)
    return { x: bx, y: by }
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      style={{ display: 'block' }}
      data-widget="carSilhouetteRadar"
      aria-label="Car silhouette proximity radar"
    >
      <rect x={1} y={1} width={W - 2} height={H - 2} rx={material.radius} fill={material.base} stroke={material.border} strokeWidth={material.borderWidth} />

      <FitText x={pad} y={pad + headerH / 2} boxW={W * 0.55} boxH={headerH * 0.86} text="SPOTTER" anchor="start" fontFamily={typography.label} fill={palette.textDim} weight={800} letterSpacing={1.4} minFontPx={11} maxFontPx={16} />
      <FitText x={W - pad} y={pad + headerH / 2} boxW={W * 0.4} boxH={headerH * 0.82} text={`${cars.length}`} anchor="end" fontFamily={skin.segment.numeric} fill={palette.text} minFontPx={11} maxFontPx={15} />

      {/* side threat zones */}
      <rect x={cx - bodyW / 2 - zoneW - 4} y={topLimit} width={zoneW} height={bottomLimit - topLimit} rx={5} fill={leftThreat === 'beside' ? BESIDE : palette.surface} stroke={material.border} strokeWidth={1} opacity={leftThreat === 'beside' ? 0.85 : 0.45} />
      <rect x={cx + bodyW / 2 + 4} y={topLimit} width={zoneW} height={bottomLimit - topLimit} rx={5} fill={rightThreat === 'beside' ? BESIDE : palette.surface} stroke={material.border} strokeWidth={1} opacity={rightThreat === 'beside' ? 0.85 : 0.45} />

      {/* your car silhouette */}
      <rect x={cx - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} rx={bodyW * 0.32} fill={palette.surface} stroke={palette.accent} strokeWidth={2} />
      <rect x={cx - bodyW * 0.3} y={bodyTop + bodyH * 0.28} width={bodyW * 0.6} height={bodyH * 0.34} rx={bodyW * 0.16} fill={palette.accent} opacity={0.55} />

      {/* alongside blips (beside the body) */}
      {alongside.map((car) => {
        const side = carSide(car)
        const bx = side === 'left' ? cx - bodyW / 2 - zoneW / 2 - 4 : cx + bodyW / 2 + zoneW / 2 + 4
        const by = cy + clamp(car.relativeY / RADAR_CAR_HALF_LEN_M, -1, 1) * (bodyH * 0.32)
        return <circle key={`a-${car.carIdx}`} cx={bx} cy={by} r={blipR} fill={BESIDE} stroke={palette.bg} strokeWidth={1} />
      })}

      {/* front / rear blips */}
      {frontRear.map((car) => {
        const p = frontRearPos(car)
        return <circle key={`f-${car.carIdx}`} cx={p.x} cy={p.y} r={blipR * 0.9} fill={car.classColor ?? palette.textDim} stroke={palette.bg} strokeWidth={1} />
      })}

      <FitText x={pad} y={H - pad - footerH / 2} boxW={W * 0.42} boxH={footerH * 0.6} text="NEAR" anchor="start" fontFamily={typography.label} fill={palette.textDim} weight={600} letterSpacing={0.6} minFontPx={10} maxFontPx={13} />
      <FitText x={W - pad} y={H - pad - footerH / 2} boxW={W * 0.5} boxH={footerH * 0.72} text={nearestReading.display} anchor="end" fontFamily={skin.segment.numeric} fill={nearestGap === undefined ? palette.textDim : palette.text} minFontPx={12} maxFontPx={18} />
    </svg>
  )
}
