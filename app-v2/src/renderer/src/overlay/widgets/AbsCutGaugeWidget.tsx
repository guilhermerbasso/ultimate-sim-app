// ABS CUT gauge overlay — a compact GT3 bar gauge for the iRacing BrakeABSCutPct
// channel (snapshot.absCutPct): the percentage of brake pressure the ABS is
// cutting while it intervenes. Pairs with the ABS tell-tale lamp by quantifying
// HOW HARD the ABS is working, not just that it is on.
//
// v2.39 rebuild: a single root <svg> (fixed viewBox + preserveAspectRatio) laid
// out with makeGrid; every glyph is a FitText so it can never overflow, clip or
// render sub-legible. Warm-only colour discipline — neutral chrome at rest,
// warming to skin.warn (amber) as the cut deepens and skin.crit (red) on a heavy
// cut. ABS intervention is never a "good" state, so the cool/ok (green) token is
// intentionally never used. NaN-safe: absCutPct absent → "—" with an empty track.
import { type ReactElement } from 'react'
import { resolveSkin, FitText, makeGrid } from '../../skins'
import type { SkinId, BrandId, SkinToken } from '../../skins'
import type { WidgetProps } from './types'

export const ABS_CUT_STREAM_SAFE = true

const DEFAULT_W = 300
const DEFAULT_H = 96

function widgetSkin(config: WidgetProps['config']): SkinToken {
  const style = (config?.style ?? {}) as { skin?: SkinId; brand?: BrandId }
  return resolveSkin(style.skin ?? 'gt3', style.brand ?? 'generic')
}

function clampPct(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.min(100, value))
}

// Neutral chrome until the ABS bites, then amber (warn) → red (crit) as it deepens.
// Never returns the ok/green token — ABS cut is not a good state.
function cutColor(pct: number | undefined, skin: SkinToken): string {
  if (pct === undefined || pct <= 0) return skin.palette.textDim
  if (pct >= 55) return skin.palette.crit
  return skin.palette.warn
}

export function AbsCutGaugeWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = widgetSkin(config)
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))
  const { palette, material, segment, typography } = skin

  const pct = clampPct(snapshot?.absCutPct)
  const frac = (pct ?? 0) / 100
  const color = cutColor(pct, skin)
  const valueStr = pct === undefined ? '—' : `${Math.round(pct)}`

  const grid = makeGrid(1, 2, W, H, 8)
  const head = grid.cell(0, 0)
  const barCell = grid.cell(0, 1)

  // Header split: label (left) + DSEG value with a small % (right).
  const labelW = head.w * 0.5
  const valW = head.w * 0.34
  const cy = head.y + head.h / 2
  const rightX = head.x + head.w

  // Bar track / fill within the bottom cell.
  const trackH = Math.min(barCell.h - 6, 20)
  const bx = barCell.x
  const by = barCell.y + (barCell.h - trackH) / 2
  const bw = barCell.w
  const ticks = 16

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      style={{ display: 'block' }}
      data-widget="absCut"
    >
      <rect x={1} y={1} width={W - 2} height={H - 2} rx={material.radius} fill={material.base} stroke={material.border} strokeWidth={material.borderWidth} />

      <FitText
        x={head.x + 2}
        y={cy}
        boxW={labelW}
        boxH={head.h * 0.82}
        text="ABS CUT"
        anchor="start"
        fontFamily={typography.label}
        fill={palette.textDim}
        weight={700}
        letterSpacing={0.6}
        minFontPx={12}
        maxFontPx={22}
      />
      <FitText
        x={rightX - 16}
        y={cy}
        boxW={valW}
        boxH={head.h * 0.92}
        text={valueStr}
        anchor="end"
        fontFamily={segment.numeric}
        fill={color}
        minFontPx={14}
        maxFontPx={30}
      />
      <FitText
        x={rightX}
        y={cy}
        boxW={14}
        boxH={head.h * 0.5}
        text="%"
        anchor="end"
        fontFamily={typography.label}
        fill={palette.textDim}
        weight={700}
        minFontPx={11}
        maxFontPx={14}
      />

      {/* track */}
      <rect x={bx} y={by} width={bw} height={trackH} rx={trackH / 2} fill={palette.bg} stroke={material.border} strokeWidth={1} />
      {/* warm fill */}
      {frac > 0 && (
        <rect x={bx} y={by} width={Math.max(0, bw * frac)} height={trackH} rx={trackH / 2} fill={color} />
      )}
      {/* segment separators for the GT3 bar-gauge look */}
      {Array.from({ length: ticks - 1 }, (_, i) => {
        const tx = bx + (bw * (i + 1)) / ticks
        return <line key={i} x1={tx} y1={by} x2={tx} y2={by + trackH} stroke={palette.bg} strokeWidth={1} opacity={0.6} />
      })}
    </svg>
  )
}
