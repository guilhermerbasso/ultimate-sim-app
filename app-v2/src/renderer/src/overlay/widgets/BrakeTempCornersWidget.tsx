// Per-corner BRAKE TEMPERATURE overlay — a GT3 MoTeC/Cosworth-style 2×2 readout of
// the four brake-disc temperatures (°C) with cold/optimal/hot bands: dim chrome =
// below the working window (never a decorative cool blue), green = in the optimal
// window (good), amber = hot, red = overheating. v2.39 rebuild: one root <svg>
// (fixed viewBox), laid out with makeGrid(2,2), every glyph a FitText so nothing
// can overflow / clip / render sub-legible. Chrome + labels are skin-token driven.
import { type ReactElement } from 'react'
import { resolveSkin, FitText, makeGrid } from '../../skins'
import type { SkinId, BrandId, SkinToken, Rect } from '../../skins'
import type { Corners } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'
import { convertMeasurement, formatMeasurement, measurementUnit } from '../../../../shared/units'
import { useUnitSystem } from '../../lib/units'

export const BRAKE_TEMP_CORNERS_STREAM_SAFE = true

const DEFAULT_W = 300
const DEFAULT_H = 200

// Generic GT3 carbon/steel disc working window (°C).
const BRAKE_COLD = 200
const BRAKE_OPT_HI = 650
const BRAKE_HOT = 800

const CORNERS: Array<[keyof Corners<number>, string]> = [['lf', 'LF'], ['rf', 'RF'], ['lr', 'LR'], ['rr', 'RR']]

function widgetSkin(config: WidgetProps['config']): SkinToken {
  const style = (config?.style ?? {}) as { skin?: SkinId; brand?: BrandId }
  return resolveSkin(style.skin ?? 'gt3', style.brand ?? 'generic')
}

// Cold = dim chrome, in-window = green (good), hot = amber, overheating = red.
function brakeColor(c: number | undefined, skin: SkinToken): string {
  if (c === undefined || !Number.isFinite(c)) return skin.palette.textDim
  if (c < BRAKE_COLD) return skin.palette.textDim
  if (c <= BRAKE_OPT_HI) return skin.palette.ok
  if (c <= BRAKE_HOT) return skin.palette.warn
  return skin.palette.crit
}

function peak(brakes: Corners<number> | undefined): number | undefined {
  if (!brakes) return undefined
  let max: number | undefined
  for (const k of ['lf', 'rf', 'lr', 'rr'] as const) {
    const v = brakes[k]
    if (v !== undefined && Number.isFinite(v) && (max === undefined || v > max)) max = v
  }
  return max
}

function offset(area: Rect, cell: Rect): Rect {
  return { x: area.x + cell.x, y: area.y + cell.y, w: cell.w, h: cell.h }
}

function Cell({ rect, label, value, color, skin }: { rect: Rect; label: string; value: string; color: string; skin: SkinToken }): ReactElement {
  const { palette, material, segment, typography } = skin
  const labelH = Math.min(rect.h * 0.34, 16)
  return (
    <g>
      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={material.radius * 0.5} fill={palette.bg} stroke={material.border} strokeWidth={1} />
      <FitText
        x={rect.x + rect.w / 2}
        y={rect.y + labelH * 0.62}
        boxW={rect.w - 6}
        boxH={labelH}
        text={label}
        anchor="middle"
        fontFamily={typography.label}
        fill={palette.textDim}
        weight={700}
        letterSpacing={0.5}
        minFontPx={10}
        maxFontPx={16}
      />
      <FitText
        x={rect.x + rect.w / 2}
        y={rect.y + labelH + (rect.h - labelH) / 2}
        boxW={rect.w - 8}
        boxH={rect.h - labelH - 4}
        text={value}
        anchor="middle"
        fontFamily={segment.numeric}
        fill={color}
        minFontPx={12}
        maxFontPx={Math.max(14, rect.h - labelH - 6)}
      />
    </g>
  )
}

export function BrakeTempCornersWidget({ snapshot, config }: WidgetProps): ReactElement {
  const unitSystem = useUnitSystem()
  const skin = widgetSkin(config)
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))
  const { palette, material, typography, segment } = skin

  const brakes = snapshot?.brakeTempC
  const hottest = peak(brakes)
  const hottestReading = formatMeasurement(hottest, 'temperature-c', unitSystem, { decimals: 0 })
  const tempUnit = measurementUnit('temperature-c', unitSystem)
  const optimalLow = convertMeasurement(BRAKE_COLD, 'temperature-c', unitSystem)
  const optimalHigh = convertMeasurement(BRAKE_OPT_HI, 'temperature-c', unitSystem)

  const pad = 8
  const headerH = 20
  const capH = 13
  const footerH = 15
  const gridArea: Rect = { x: pad, y: pad + headerH + capH, w: W - pad * 2, h: H - (pad + headerH + capH) - footerH - pad }
  const g = makeGrid(2, 2, gridArea.w, gridArea.h, 8)
  const cy = pad + headerH / 2

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      style={{ display: 'block' }}
      data-widget="brakeTempCorners"
    >
      <rect x={1} y={1} width={W - 2} height={H - 2} rx={material.radius} fill={material.base} stroke={material.border} strokeWidth={material.borderWidth} />

      <FitText x={pad + 2} y={cy} boxW={W * 0.5} boxH={headerH * 0.82} text="BRAKE TEMP" anchor="start" fontFamily={typography.label} fill={palette.textDim} weight={700} letterSpacing={0.6} minFontPx={11} maxFontPx={18} />
      {/* peak readout, right-aligned: PEAK <value> °C */}
      <FitText x={W - pad - 46} y={cy} boxW={26} boxH={headerH * 0.7} text="PEAK" anchor="end" fontFamily={typography.label} fill={palette.textDim} weight={700} letterSpacing={0.4} minFontPx={9} maxFontPx={12} />
      <FitText x={W - pad - 16} y={cy} boxW={28} boxH={headerH * 0.9} text={hottestReading.display} anchor="end" fontFamily={segment.numeric} fill={brakeColor(hottest, skin)} minFontPx={11} maxFontPx={16} />
      <FitText x={W - pad - 2} y={cy} boxW={14} boxH={headerH * 0.6} text={tempUnit} anchor="end" fontFamily={typography.label} fill={palette.textDim} weight={600} minFontPx={9} maxFontPx={11} />

      <FitText x={W / 2} y={pad + headerH + capH / 2} boxW={W * 0.5} boxH={capH} text="DISC" anchor="middle" fontFamily={typography.label} fill={palette.textDim} weight={600} letterSpacing={1.5} minFontPx={9} maxFontPx={12} />

      {CORNERS.map(([key, label], i) => {
        const v = brakes?.[key]
        const rect = offset(gridArea, g.cell(i % 2, Math.floor(i / 2)))
        return <Cell key={String(key)} rect={rect} label={label} value={formatMeasurement(v, 'temperature-c', unitSystem, { decimals: 0 }).display} color={brakeColor(v, skin)} skin={skin} />
      })}

      <FitText x={W / 2} y={H - pad - footerH / 2 + 1} boxW={W - pad * 2} boxH={footerH} text={`Optimal ${optimalLow?.toFixed(0)}–${optimalHigh?.toFixed(0)} ${tempUnit}`} anchor="middle" fontFamily={typography.label} fill={palette.textDim} weight={600} letterSpacing={0.5} minFontPx={9} maxFontPx={12} />
    </svg>
  )
}
