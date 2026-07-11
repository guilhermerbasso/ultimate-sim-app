// TYRE DETAIL overlay — a GT3 four-corner grid where each corner breaks out four
// channels (tyre temp, pressure, brake temp, tyre life) as a labelled meter. v2.39
// rebuild: one root <svg> (fixed viewBox), laid out with makeGrid(2,2) into corner
// tiles, every glyph a FitText so nothing can overflow / clip / render sub-legible.
//
// Colour rule (fixed telemetry ramp): dim chrome = cold/low/missing (never a
// decorative cool blue, and never a fabricated nominal), green only in the optimal
// window, then amber → orange → red. Tyre life inverts (high = green). Chrome +
// labels are skin-token driven so a hud swap re-skins the frame.
import { type ReactElement } from 'react'
import type { Corners, TyreInfo } from '../../../../shared/telemetry'
import { resolveSkin, FitText, makeGrid } from '../../skins'
import type { SkinId, BrandId, SkinToken, Rect } from '../../skins'
import type { WidgetProps } from './types'
import { numberOrDash } from './format'
import { formatMeasurement } from '../../../../shared/units'
import { useUnitSystem } from '../../lib/units'

const CORNERS: Array<[keyof Corners<unknown>, string]> = [['lf', 'LF'], ['rf', 'RF'], ['lr', 'LR'], ['rr', 'RR']]

const DEFAULT_W = 430
const DEFAULT_H = 420

// Dim warm chrome for cold / low / missing — never a decorative cool blue.
const DIM_CHROME = '#8a8a8a'

interface Chan {
  label: string
  value?: number
  display: string
  norm: number
  color: string
  unit: string
}
interface CornerData {
  key: string
  label: string
  pres?: number
  chans: Chan[]
}

function widgetSkin(config: WidgetProps['config']): SkinToken {
  const style = (config?.style ?? {}) as { skin?: SkinId; brand?: BrandId }
  return resolveSkin(style.skin ?? 'gt3', style.brand ?? 'generic')
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}
function heat(norm: number): string {
  const n = clamp01(norm)
  if (n < 0.22) return DIM_CHROME
  if (n < 0.46) return '#2ee06a'
  if (n < 0.68) return '#ffd166'
  if (n < 0.86) return '#ff8c2b'
  return '#ff4d3d'
}
function lifeColor(v?: number): string {
  if (v === undefined) return DIM_CHROME
  if (v >= 60) return '#2ee06a'
  if (v >= 35) return '#ffd166'
  return '#ff4d3d'
}
function lifePct(v: number | undefined): number | undefined {
  if (v === undefined || !Number.isFinite(v)) return undefined
  const scaled = v <= 1 ? v * 100 : v
  return Math.max(0, Math.min(100, scaled))
}

function offset(area: Rect, cell: Rect): Rect {
  return { x: area.x + cell.x, y: area.y + cell.y, w: cell.w, h: cell.h }
}

function ChannelRow({ rect, ch, skin }: { rect: Rect; ch: Chan; skin: SkinToken }): ReactElement {
  const { palette, segment, typography } = skin
  const labelW = rect.w * 0.26
  const valueW = rect.w * 0.24
  const barX = rect.x + labelW + 4
  const barW = rect.w - labelW - valueW - 8
  const barH = Math.max(4, rect.h * 0.34)
  const barY = rect.y + rect.h / 2 - barH / 2
  return (
    <g>
      <FitText x={rect.x} y={rect.y + rect.h / 2} boxW={labelW - 2} boxH={rect.h * 0.9} text={ch.label} anchor="start" fontFamily={typography.label} fill={palette.textDim} weight={600} letterSpacing={0.4} minFontPx={10} maxFontPx={13} />
      <rect x={barX} y={barY} width={barW} height={barH} rx={barH / 2} fill={palette.bg} stroke={skin.material.border} strokeWidth={1} />
      {ch.norm > 0 && <rect x={barX} y={barY} width={Math.max(0, barW * clamp01(ch.norm))} height={barH} rx={barH / 2} fill={ch.color} />}
      <FitText x={rect.x + rect.w} y={rect.y + rect.h / 2} boxW={valueW - 2} boxH={rect.h * 0.92} text={`${ch.display}${ch.unit}`} anchor="end" fontFamily={segment.numeric} fill={ch.color} minFontPx={11} maxFontPx={16} />
    </g>
  )
}

function CornerTile({ rect, data, skin, pressureDisplay }: { rect: Rect; data: CornerData; skin: SkinToken; pressureDisplay: string }): ReactElement {
  const { palette, material, typography, segment } = skin
  const pad = 8
  const headerH = Math.max(18, Math.min(rect.h * 0.16, 26))
  const rowsArea: Rect = { x: rect.x + pad, y: rect.y + headerH, w: rect.w - pad * 2, h: rect.h - headerH - pad }
  const rowH = rowsArea.h / data.chans.length
  return (
    <g>
      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={material.radius} fill={palette.surface} stroke={material.border} strokeWidth={material.borderWidth} />
      <FitText x={rect.x + pad} y={rect.y + headerH / 2 + 1} boxW={rect.w * 0.4} boxH={headerH * 0.82} text={data.label} anchor="start" fontFamily={typography.label} fill={palette.textDim} weight={800} letterSpacing={1} minFontPx={11} maxFontPx={18} />
      <FitText x={rect.x + rect.w - pad} y={rect.y + headerH / 2 + 1} boxW={rect.w * 0.5} boxH={headerH * 0.7} text={pressureDisplay} anchor="end" fontFamily={segment.numeric} fill={palette.text} minFontPx={10} maxFontPx={13} />
      {data.chans.map((ch, i) => (
        <ChannelRow key={ch.label} rect={{ x: rowsArea.x, y: rowsArea.y + i * rowH, w: rowsArea.w, h: rowH - 2 }} ch={ch} skin={skin} />
      ))}
    </g>
  )
}

export function TyresDetailWidget({ snapshot, config }: WidgetProps): ReactElement {
  const unitSystem = useUnitSystem()
  const skin = widgetSkin(config)
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))
  const { material } = skin

  const data: CornerData[] = CORNERS.map(([key, label]) => {
    const tyre = snapshot?.tyres?.[key] as TyreInfo | undefined
    const brake = snapshot?.brakeTempC?.[key] as number | undefined
    const wear = lifePct(tyre?.wearPct)
    const temp = tyre?.tempC
    const pres = tyre?.pressureKpa
    const tempReading = formatMeasurement(temp, 'temperature-c', unitSystem, { decimals: 0 })
    const pressureReading = formatMeasurement(pres, 'pressure-kpa', unitSystem, { decimals: unitSystem === 'imperial' ? 1 : 0 })
    const brakeReading = formatMeasurement(brake, 'temperature-c', unitSystem, { decimals: 0 })
    const chans: Chan[] = [
      { label: 'TEMP', value: temp, display: tempReading.display, norm: temp === undefined ? 0 : clamp01((temp - 40) / 100), color: temp === undefined ? DIM_CHROME : heat((temp - 40) / 100), unit: tempReading.unit },
      { label: 'PRES', value: pres, display: pressureReading.display, norm: pres === undefined ? 0 : clamp01(pres / 240), color: pres === undefined ? DIM_CHROME : heat(clamp01((pres - 130) / 130)), unit: pressureReading.unit },
      { label: 'BRAKE', value: brake, display: brakeReading.display, norm: brake === undefined ? 0 : clamp01(brake / 900), color: brake === undefined ? DIM_CHROME : heat(brake / 900), unit: brakeReading.unit },
      { label: 'VIDA', value: wear, display: numberOrDash(wear, 0), norm: wear === undefined ? 0 : clamp01(wear / 100), color: lifeColor(wear), unit: '%' }
    ]
    return { key: String(key), label, pres, chans }
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
      data-widget="tyresDetail"
    >
      <rect x={1} y={1} width={W - 2} height={H - 2} rx={material.radius} fill={material.base} stroke={material.border} strokeWidth={material.borderWidth} />
      {data.map((c, i) => (
        <CornerTile key={c.key} rect={cells[i]} data={c} skin={skin} pressureDisplay={formatMeasurement(c.pres, 'pressure-kpa', unitSystem, { decimals: unitSystem === 'imperial' ? 1 : 0, includeUnit: true }).display} />
      ))}
    </svg>
  )
}
