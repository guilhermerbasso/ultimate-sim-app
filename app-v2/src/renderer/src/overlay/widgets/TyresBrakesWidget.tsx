// TYRES / BRAKES overlay — a GT3 four-corner grid of tyre temp, brake temp,
// pressure and tyre life. v2.39 rebuild: one root <svg> (fixed viewBox +
// preserveAspectRatio), laid out with makeGrid(2,2) into four corner tiles, every
// glyph a FitText so nothing can overflow / clip / render sub-legible.
//
// Colour rule (fixed telemetry ramp, theme-independent): cold / low / missing =
// dim chrome (never a decorative cool blue), green only in the optimal window,
// then amber → orange → red as heat climbs. Tyre life inverts (high = green). The
// panel chrome + labels are skin-token driven so a hud swap re-skins the frame.
import { type ReactElement } from 'react'
import type { Corners, TyreInfo } from '../../../../shared/telemetry'
import { resolveSkin, FitText, makeGrid } from '../../skins'
import type { SkinId, BrandId, SkinToken, Rect } from '../../skins'
import type { WidgetProps } from './types'
import { numberOrDash } from './format'

const CORNERS: Array<[keyof Corners<unknown>, string]> = [['lf', 'LF'], ['rf', 'RF'], ['lr', 'LR'], ['rr', 'RR']]

const DEFAULT_W = 360
const DEFAULT_H = 300

// Dim warm chrome for cold / low / missing — never a decorative cool blue.
const DIM_CHROME = '#8a8a8a'

interface CornerData {
  key: string
  label: string
  tyre?: number
  brake?: number
  pres?: number
  wear?: number
}

function widgetSkin(config: WidgetProps['config']): SkinToken {
  const style = (config?.style ?? {}) as { skin?: SkinId; brand?: BrandId }
  return resolveSkin(style.skin ?? 'gt3', style.brand ?? 'generic')
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

// Cold→hot ramp: dim chrome (cold/low) → green (optimal) → amber → orange → red.
function heat(norm: number): string {
  const n = clamp01(norm)
  if (n < 0.22) return DIM_CHROME
  if (n < 0.46) return '#2ee06a'
  if (n < 0.68) return '#ffd166'
  if (n < 0.86) return '#ff8c2b'
  return '#ff4d3d'
}
function tyreHeat(t?: number): string {
  return t === undefined ? DIM_CHROME : heat((t - 40) / 80)
}
function brakeHeat(b?: number): string {
  return b === undefined ? DIM_CHROME : heat(b / 900)
}

// Tyre condition arrives as a 0..1 fraction OR an already-scaled 0..100 percentage
// → normalize to a percentage and clamp 0–100 so we never print "8200%".
function lifePct(v: number | undefined): number | undefined {
  if (v === undefined || !Number.isFinite(v)) return undefined
  const scaled = v <= 1 ? v * 100 : v
  return Math.max(0, Math.min(100, scaled))
}
// Tyre life: high = good (green), low = warn/hot, missing = dim chrome.
function lifeColor(v?: number): string {
  if (v === undefined) return DIM_CHROME
  if (v >= 60) return '#2ee06a'
  if (v >= 35) return '#ffd166'
  return '#ff4d3d'
}

function offset(area: Rect, cell: Rect): Rect {
  return { x: area.x + cell.x, y: area.y + cell.y, w: cell.w, h: cell.h }
}

function Metric({ rect, label, value, color, skin }: { rect: Rect; label: string; value: string; color: string; skin: SkinToken }): ReactElement {
  const { palette, material, segment, typography } = skin
  const labelH = Math.min(rect.h * 0.36, 16)
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

function CornerTile({ rect, data, skin }: { rect: Rect; data: CornerData; skin: SkinToken }): ReactElement {
  const { palette, material, typography } = skin
  const tabH = Math.max(14, Math.min(rect.h * 0.16, 22))
  const area: Rect = { x: rect.x + 6, y: rect.y + tabH, w: rect.w - 12, h: rect.h - tabH - 6 }
  const inner = makeGrid(2, 2, area.w, area.h, 6)
  return (
    <g>
      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={material.radius} fill={palette.surface} stroke={material.border} strokeWidth={material.borderWidth} />
      <FitText
        x={rect.x + 8}
        y={rect.y + tabH / 2 + 1}
        boxW={rect.w * 0.5}
        boxH={tabH * 0.9}
        text={data.label}
        anchor="start"
        fontFamily={typography.label}
        fill={palette.textDim}
        weight={800}
        letterSpacing={1}
        minFontPx={11}
        maxFontPx={18}
      />
      <Metric rect={offset(area, inner.cell(0, 0))} label="TYRE" value={`${numberOrDash(data.tyre, 0)}°`} color={tyreHeat(data.tyre)} skin={skin} />
      <Metric rect={offset(area, inner.cell(1, 0))} label="BRK" value={`${numberOrDash(data.brake, 0)}°`} color={brakeHeat(data.brake)} skin={skin} />
      <Metric rect={offset(area, inner.cell(0, 1))} label="PRS" value={numberOrDash(data.pres, 0)} color={palette.text} skin={skin} />
      <Metric rect={offset(area, inner.cell(1, 1))} label="LIFE" value={data.wear !== undefined ? `${numberOrDash(data.wear, 0)}%` : '—'} color={lifeColor(data.wear)} skin={skin} />
    </g>
  )
}

export function TyresBrakesWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = widgetSkin(config)
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))
  const { material } = skin

  const tyres = snapshot?.tyres
  const brakes = snapshot?.brakeTempC
  const data: CornerData[] = CORNERS.map(([key, label]) => {
    const tyre = tyres?.[key] as TyreInfo | undefined
    return {
      key: String(key),
      label,
      tyre: tyre?.tempC,
      brake: brakes?.[key] as number | undefined,
      pres: tyre?.pressureKpa,
      wear: lifePct(tyre?.wearPct)
    }
  })

  const grid = makeGrid(2, 2, W, H, 10)
  const cells = [grid.cell(0, 0), grid.cell(1, 0), grid.cell(0, 1), grid.cell(1, 1)]

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      style={{ display: 'block' }}
      data-widget="tyresBrakes"
    >
      <rect x={1} y={1} width={W - 2} height={H - 2} rx={material.radius} fill={material.base} stroke={material.border} strokeWidth={material.borderWidth} />
      {data.map((c, i) => (
        <CornerTile key={c.key} rect={cells[i]} data={c} skin={skin} />
      ))}
    </svg>
  )
}
