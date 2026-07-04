// G-FORCE overlay — a real accelerometer "friction circle": the combined lateral +
// longitudinal load drawn as a ball on a g-g ring, with signed per-axis readouts.
// Lateral is left/right cornering load; longitudinal is braking (up) vs acceleration
// (down). The ball colour is the widget accent; the ring + chrome are skin tokens.
//
// v2.39 rebuild: one root <svg> (fixed viewBox) laid out with makeGrid — a header,
// the g-g plot, and two signed readouts, every glyph a FitText so nothing overflows,
// clips or renders sub-legible. NaN-safe: a missing / non-finite accel channel reads
// "—" (never a fabricated "+0.00G") and the ball is simply not plotted.
import { type ReactElement } from 'react'
import { resolveSkin, FitText, makeGrid } from '../../skins'
import type { SkinId, BrandId, SkinToken, Rect } from '../../skins'
import type { WidgetProps } from './types'

const DEFAULT_W = 320
const DEFAULT_H = 320
const MAX_G = 2.5

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
function finite(v?: number): number | undefined {
  return v !== undefined && Number.isFinite(v) ? v : undefined
}
function gStr(v: number | undefined): string {
  if (v === undefined) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}G`
}

function widgetSkin(config: WidgetProps['config']): SkinToken {
  const style = (config?.style ?? {}) as { skin?: SkinId; brand?: BrandId }
  return resolveSkin(style.skin ?? 'gt3', style.brand ?? 'generic')
}

function offset(area: Rect, cell: Rect): Rect {
  return { x: area.x + cell.x, y: area.y + cell.y, w: cell.w, h: cell.h }
}

export function GForceWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = widgetSkin(config)
  const style = (config?.style ?? {}) as { accent?: string }
  const accent = style.accent ?? skin.palette.accent
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))
  const { palette, material, typography } = skin

  const lat = finite(snapshot?.latAccelG)
  const long = finite(snapshot?.longAccelG)
  const hasData = lat !== undefined && long !== undefined
  const magnitude = hasData ? Math.hypot(lat, long) : undefined

  const pad = 12
  const headerH = 24
  const footerH = 40
  const plot: Rect = { x: pad, y: pad + headerH, w: W - pad * 2, h: H - pad * 2 - headerH - footerH }
  const R = Math.max(8, Math.min(plot.w, plot.h) / 2 - 4)
  const cx = plot.x + plot.w / 2
  const cy = plot.y + plot.h / 2

  const ballX = hasData ? cx + clamp(lat / MAX_G, -1, 1) * R : cx
  const ballY = hasData ? cy - clamp(long / MAX_G, -1, 1) * R : cy
  const ballR = Math.max(5, R * 0.11)

  const footer: Rect = { x: pad, y: H - pad - footerH, w: W - pad * 2, h: footerH }
  const fGrid = makeGrid(2, 1, footer.w, footer.h, 10)
  const latCell = offset(footer, fGrid.cell(0, 0))
  const longCell = offset(footer, fGrid.cell(1, 0))

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      style={{ display: 'block' }}
      data-widget="gforce"
    >
      <rect x={1} y={1} width={W - 2} height={H - 2} rx={material.radius} fill={material.base} stroke={material.border} strokeWidth={material.borderWidth} />

      <FitText x={pad} y={pad + headerH / 2} boxW={W * 0.5} boxH={headerH * 0.86} text="G-FORCE" anchor="start" fontFamily={typography.label} fill={palette.textDim} weight={800} letterSpacing={1.4} minFontPx={11} maxFontPx={17} />
      <FitText x={W - pad} y={pad + headerH / 2} boxW={W * 0.4} boxH={headerH * 0.86} text={gStr(magnitude)} anchor="end" fontFamily={skin.segment.numeric} fill={hasData ? accent : palette.textDim} minFontPx={12} maxFontPx={18} />

      <circle cx={cx} cy={cy} r={R} fill={palette.bg} stroke={material.border} strokeWidth={material.borderWidth} />
      <circle cx={cx} cy={cy} r={R * 0.66} fill="none" stroke={material.border} strokeWidth={1} opacity={0.7} />
      <circle cx={cx} cy={cy} r={R * 0.33} fill="none" stroke={material.border} strokeWidth={1} opacity={0.5} />
      <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke={material.border} strokeWidth={1} opacity={0.6} />
      <line x1={cx} y1={cy - R} x2={cx} y2={cy + R} stroke={material.border} strokeWidth={1} opacity={0.6} />

      {hasData && (
        <g>
          <line x1={cx} y1={cy} x2={ballX} y2={ballY} stroke={accent} strokeWidth={2} opacity={0.5} />
          <circle cx={ballX} cy={ballY} r={ballR} fill={accent} stroke={palette.bg} strokeWidth={1.5} />
        </g>
      )}

      <FitText x={latCell.x + latCell.w / 2} y={latCell.y + latCell.h * 0.3} boxW={latCell.w} boxH={latCell.h * 0.34} text="LAT" fontFamily={typography.label} fill={palette.textDim} weight={700} letterSpacing={1} minFontPx={10} maxFontPx={12} />
      <FitText x={latCell.x + latCell.w / 2} y={latCell.y + latCell.h * 0.72} boxW={latCell.w} boxH={latCell.h * 0.5} text={gStr(lat)} fontFamily={skin.segment.numeric} fill={hasData ? palette.text : palette.textDim} minFontPx={13} maxFontPx={22} />
      <FitText x={longCell.x + longCell.w / 2} y={longCell.y + longCell.h * 0.3} boxW={longCell.w} boxH={longCell.h * 0.34} text="LONG" fontFamily={typography.label} fill={palette.textDim} weight={700} letterSpacing={1} minFontPx={10} maxFontPx={12} />
      <FitText x={longCell.x + longCell.w / 2} y={longCell.y + longCell.h * 0.72} boxW={longCell.w} boxH={longCell.h * 0.5} text={gStr(long)} fontFamily={skin.segment.numeric} fill={hasData ? palette.text : palette.textDim} minFontPx={13} maxFontPx={22} />
    </svg>
  )
}
