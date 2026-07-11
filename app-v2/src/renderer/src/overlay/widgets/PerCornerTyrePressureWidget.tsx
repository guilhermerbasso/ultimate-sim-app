// Per-corner tyre PRESSURE overlay — a GT3 MoTeC/AiM-style 2×2 readout of the four
// tyre pressures (kPa) with a target-band colour rule: in-band = green (good),
// slightly off = amber, far off = red, missing = dim. v2.39 rebuild: one root
// <svg> (fixed viewBox), laid out with makeGrid(2,2), every glyph a FitText so it
// can never overflow / clip / render sub-legible. Chrome + labels are skin-token
// driven so a hud swap re-skins the frame.
//
// Source priority mirrors the sims: live `tyres.*.pressureKpa` when present, else
// the iRacing garage `tireColdPressuresKpa` cold set. The tag spells out the source.
import { type ReactElement } from 'react'
import { resolveSkin, FitText, makeGrid } from '../../skins'
import type { SkinId, BrandId, SkinToken, Rect } from '../../skins'
import type { Corners } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'
import { convertMeasurement, formatMeasurement, measurementUnit } from '../../../../shared/units'
import { useUnitSystem } from '../../lib/units'

export const PER_CORNER_TYRE_PRESSURE_STREAM_SAFE = true

const DEFAULT_W = 300
const DEFAULT_H = 200

// Nominal hot-running target band (kPa) for a generic GT3 slick (~24–26 psi).
const P_OPT_LO = 160
const P_OPT_HI = 180
const P_WARN = 12

const CORNERS: Array<[keyof Corners<unknown>, string]> = [['lf', 'LF'], ['rf', 'RF'], ['lr', 'LR'], ['rr', 'RR']]

function widgetSkin(config: WidgetProps['config']): SkinToken {
  const style = (config?.style ?? {}) as { skin?: SkinId; brand?: BrandId }
  return resolveSkin(style.skin ?? 'gt3', style.brand ?? 'generic')
}

// In-band = good (green); within the warn margin = amber; otherwise red. A missing
// corner stays neutral dim rather than alarming.
function pressColor(kpa: number | undefined, skin: SkinToken): string {
  if (kpa === undefined || !Number.isFinite(kpa)) return skin.palette.textDim
  if (kpa >= P_OPT_LO && kpa <= P_OPT_HI) return skin.palette.ok
  if (kpa >= P_OPT_LO - P_WARN && kpa <= P_OPT_HI + P_WARN) return skin.palette.warn
  return skin.palette.crit
}

function cornerKpa(
  live: Corners<{ pressureKpa?: number }> | undefined,
  cold: Corners<number> | undefined,
  key: keyof Corners<unknown>
): number | undefined {
  const liveVal = live?.[key]?.pressureKpa
  if (liveVal !== undefined && Number.isFinite(liveVal)) return liveVal
  const coldVal = cold?.[key]
  return coldVal !== undefined && Number.isFinite(coldVal) ? coldVal : undefined
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

export function PerCornerTyrePressureWidget({ snapshot, config }: WidgetProps): ReactElement {
  const unitSystem = useUnitSystem()
  const skin = widgetSkin(config)
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))
  const { palette, material, typography } = skin

  const live = snapshot?.tyres
  const cold = snapshot?.tireColdPressuresKpa

  const hasLive = !!live && (['lf', 'rf', 'lr', 'rr'] as const).some((k) => {
    const v = live[k]?.pressureKpa
    return v !== undefined && Number.isFinite(v)
  })
  const hasCold = !!cold && (['lf', 'rf', 'lr', 'rr'] as const).some((k) => {
    const v = cold[k]
    return v !== undefined && Number.isFinite(v)
  })
  const tag = hasLive ? 'LIVE' : hasCold ? 'COLD' : '—'
  const tagColor = hasLive ? palette.textDim : hasCold ? palette.warn : palette.textDim
  const pressureUnit = measurementUnit('pressure-kpa', unitSystem)
  const targetLow = convertMeasurement(P_OPT_LO, 'pressure-kpa', unitSystem)
  const targetHigh = convertMeasurement(P_OPT_HI, 'pressure-kpa', unitSystem)
  const pressureDecimals = unitSystem === 'imperial' ? 1 : 0

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
      data-widget="perCornerTyrePressure"
    >
      <rect x={1} y={1} width={W - 2} height={H - 2} rx={material.radius} fill={material.base} stroke={material.border} strokeWidth={material.borderWidth} />

      <FitText x={pad + 2} y={cy} boxW={W * 0.6} boxH={headerH * 0.82} text="TYRE PRESSURE" anchor="start" fontFamily={typography.label} fill={palette.textDim} weight={700} letterSpacing={0.6} minFontPx={11} maxFontPx={18} />
      <FitText x={W - pad - 2} y={cy} boxW={W * 0.24} boxH={headerH * 0.82} text={tag} anchor="end" fontFamily={typography.label} fill={tagColor} weight={800} letterSpacing={0.6} minFontPx={10} maxFontPx={14} />
      <FitText x={W / 2} y={pad + headerH + capH / 2} boxW={W * 0.5} boxH={capH} text="PRESS" anchor="middle" fontFamily={typography.label} fill={palette.textDim} weight={600} letterSpacing={1.5} minFontPx={9} maxFontPx={12} />

      {CORNERS.map(([key, label], i) => {
        const kpa = cornerKpa(live, cold, key)
        const rect = offset(gridArea, g.cell(i % 2, Math.floor(i / 2)))
        return <Cell key={String(key)} rect={rect} label={label} value={formatMeasurement(kpa, 'pressure-kpa', unitSystem, { decimals: pressureDecimals }).display} color={pressColor(kpa, skin)} skin={skin} />
      })}

      <FitText x={W / 2} y={H - pad - footerH / 2 + 1} boxW={W - pad * 2} boxH={footerH} text={`Target ${targetLow?.toFixed(pressureDecimals)}–${targetHigh?.toFixed(pressureDecimals)} ${pressureUnit}`} anchor="middle" fontFamily={typography.label} fill={palette.textDim} weight={600} letterSpacing={0.5} minFontPx={9} maxFontPx={12} />
    </svg>
  )
}
