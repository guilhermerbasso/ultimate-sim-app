// SIDE PROXIMITY (2-car) overlay — a focused GT3 blind-spot tile that uses
// iRacing's carLeftRightCount (1 or 2 cars on the busy side) on top of the decided
// side (snapshot.carLeftRight — clear / left / right / both) to distinguish ONE car
// alongside from TWO, and a car on each side as 3-wide.
//
// Callouts: "CAR LEFT" vs "2 LEFT", "CAR RIGHT" vs "2 RIGHT", "3 WIDE" (one each
// side), "CLEAR" when nothing is alongside. Colour discipline: an occupied side
// burns skin.crit (red — danger, never green); a CLEAR track is the good state so
// it reads skin.ok (green). v2.39 rebuild: one root <svg> (fixed viewBox), laid out
// with makeGrid, every glyph a FitText — overflow / tiny-text is impossible.
// Degrades to a dim "—" callout when the fields are absent (null snapshot).
import { type ReactElement } from 'react'
import { resolveSkin, FitText, makeGrid } from '../../skins'
import type { SkinId, BrandId, SkinToken } from '../../skins'
import type { CarLeftRightState } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'

export const SIDE_PROXIMITY_STREAM_SAFE = true

const DEFAULT_W = 320
const DEFAULT_H = 140

function widgetSkin(config: WidgetProps['config']): SkinToken {
  const style = (config?.style ?? {}) as { skin?: SkinId; brand?: BrandId }
  return resolveSkin(style.skin ?? 'gt3', style.brand ?? 'generic')
}

interface SideModel {
  occupied: boolean
  label: string // side badge: "CAR", "2", or ""
  count?: number
}

// Resolve per-side occupancy + 1-vs-2 badge from the decided side and busy-side count.
function resolveSides(side: CarLeftRightState | undefined, count: number | undefined): {
  left: SideModel
  right: SideModel
  callout: string
  alongside: boolean
} {
  const two = count === 2
  const badge = (on: boolean): string => (!on ? '' : two ? '2' : 'CAR')
  const sideCount = (on: boolean): number | undefined => (!on ? undefined : two ? 2 : 1)

  if (side === 'both') {
    return { left: { occupied: true, label: 'CAR', count: 1 }, right: { occupied: true, label: 'CAR', count: 1 }, callout: '3 WIDE', alongside: true }
  }
  if (side === 'left') {
    return { left: { occupied: true, label: badge(true), count: sideCount(true) }, right: { occupied: false, label: '' }, callout: two ? '2 LEFT' : 'CAR LEFT', alongside: true }
  }
  if (side === 'right') {
    return { left: { occupied: false, label: '' }, right: { occupied: true, label: badge(true), count: sideCount(true) }, callout: two ? '2 RIGHT' : 'CAR RIGHT', alongside: true }
  }
  if (side === 'clear') {
    return { left: { occupied: false, label: '' }, right: { occupied: false, label: '' }, callout: 'CLEAR', alongside: false }
  }
  return { left: { occupied: false, label: '' }, right: { occupied: false, label: '' }, callout: '—', alongside: false }
}

function Zone({ side, rect, skin, tag }: { side: SideModel; rect: { x: number; y: number; w: number; h: number }; skin: SkinToken; tag: string }): ReactElement {
  const { palette, material, segment, typography } = skin
  const occ = side.occupied
  const edge = occ ? palette.crit : material.border
  const carColor = occ ? palette.crit : palette.textDim
  // A simple car block centred in the zone.
  const cw = rect.w * 0.44
  const ch = rect.h * 0.4
  const cx = rect.x + rect.w / 2
  const cyTop = rect.y + rect.h * 0.16
  const badge = side.count && side.count > 1 ? String(side.count) : side.label
  const badgeFont = side.count && side.count > 1 ? segment.numeric : typography.label
  return (
    <g>
      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={material.radius * 0.6} fill={palette.surface} stroke={edge} strokeWidth={occ ? 2 : 1} opacity={occ ? 1 : 0.9} />
      <rect x={cx - cw / 2} y={cyTop} width={cw} height={ch} rx={Math.min(6, cw / 4)} fill={carColor} opacity={occ ? 0.95 : 0.5} />
      {badge && (
        <FitText
          x={cx}
          y={rect.y + rect.h * 0.74}
          boxW={rect.w * 0.82}
          boxH={rect.h * 0.3}
          text={badge}
          anchor="middle"
          fontFamily={badgeFont}
          fill={occ ? palette.crit : palette.textDim}
          weight={800}
          minFontPx={11}
          maxFontPx={22}
        />
      )}
    </g>
  )
}

export function SideProximityWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = widgetSkin(config)
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))
  const { palette, material, typography } = skin

  const { left, right, callout, alongside } = resolveSides(snapshot?.carLeftRight, snapshot?.carLeftRightCount)
  const calloutColor = alongside ? palette.crit : callout === 'CLEAR' ? palette.ok : palette.textDim

  const grid = makeGrid(5, 3, W, H, 8)
  const cap = grid.cell(0, 0, 5, 1)
  const leftCell = grid.cell(0, 1, 1, 2)
  const centerCell = grid.cell(1, 1, 3, 2)
  const rightCell = grid.cell(4, 1, 1, 2)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      style={{ display: 'block' }}
      data-widget="sideProximity"
    >
      <rect x={1} y={1} width={W - 2} height={H - 2} rx={material.radius} fill={material.base} stroke={material.border} strokeWidth={material.borderWidth} />

      <FitText
        x={cap.x + 2}
        y={cap.y + cap.h / 2}
        boxW={cap.w - 4}
        boxH={cap.h * 0.82}
        text="SIDE PROXIMITY"
        anchor="start"
        fontFamily={typography.label}
        fill={palette.textDim}
        weight={700}
        letterSpacing={0.8}
        minFontPx={11}
        maxFontPx={20}
      />

      <Zone side={left} rect={leftCell} skin={skin} tag="left" />

      <rect x={centerCell.x} y={centerCell.y} width={centerCell.w} height={centerCell.h} rx={material.radius * 0.6} fill={palette.bg} stroke={alongside ? palette.crit : material.border} strokeWidth={alongside ? 2 : 1} />
      <FitText
        x={centerCell.x + centerCell.w / 2}
        y={centerCell.y + centerCell.h / 2}
        boxW={centerCell.w * 0.9}
        boxH={centerCell.h * 0.6}
        text={callout}
        anchor="middle"
        fontFamily={typography.label}
        fill={calloutColor}
        weight={800}
        letterSpacing={0.5}
        minFontPx={13}
        maxFontPx={34}
      />

      <Zone side={right} rect={rightCell} skin={skin} tag="right" />
    </svg>
  )
}
