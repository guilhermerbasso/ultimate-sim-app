// RELATIVES STRIP overlay — a wide, short track-position ribbon rendered as ONE root
// <svg> (fixed viewBox + preserveAspectRatio="meet") so bubbles never clip or spill.
// Each car is a bubble positioned along the strip by its relative lap distance
// (lapDistPct wrapped to -0.5..+0.5); the car number is a <FitText> in the DSEG face.
// The player bubble is ringed with the skin accent. Colour comes from the class
// colour (or a proximity ramp) — all via skin tokens. Not stream-safe (per-viewer).

import type { ReactElement } from 'react'
import type { DriverEntry } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'
import { resolveSkin, FitText } from '../../skins'

/** Relative lap distance in the range -0.5..+0.5 (positive = ahead of player). */
function relLapDist(dPct: number, playerPct: number): number {
  let diff = dPct - playerPct
  if (diff > 0.5) diff -= 1
  if (diff < -0.5) diff += 1
  return diff
}

export const RELATIVES_STRIP_STREAM_SAFE = false

const DEFAULT_W = 1860
const DEFAULT_H = 72
const CLASS_FALLBACK = '#6b7280'

interface Bubble {
  key: number
  left: number
  isPlayer: boolean
  color: string
  num: string
}

export function RelativesStripWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const glass = skin.id === 'hud'
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))

  const drivers = snapshot?.drivers ?? []
  const playerIdx = snapshot?.playerCarIdx
  const player = drivers.find((d) => d.isPlayer || d.carIdx === playerIdx)

  const panel = (
    <rect
      x={1}
      y={1}
      width={W - 2}
      height={H - 2}
      rx={skin.material.radius}
      fill={skin.material.base}
      stroke={skin.material.border}
      strokeWidth={skin.material.borderWidth}
      opacity={glass ? skin.material.panelAlpha ?? 1 : 1}
    />
  )
  const rootProps = {
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: 'xMidYMid meet' as const,
    width: '100%',
    height: '100%',
    'data-widget': 'relativesStrip',
    role: 'img', 'aria-label': 'Track-relative car positions',
    style: { display: 'block' as const }
  }

  if (drivers.length === 0) {
    return (
      <svg {...rootProps}>
        {panel}
        <FitText x={W / 2} y={H / 2} boxW={W - 24} boxH={Math.min(H - 16, 36)} text="—" fontFamily={skin.typography.value} fill={skin.palette.textDim} minFontPx={14} maxFontPx={36} />
      </svg>
    )
  }

  const hasPct = drivers.every((d) => d.lapDistPct !== undefined && Number.isFinite(d.lapDistPct))
  const playerPct = hasPct ? player?.lapDistPct ?? 0 : 0

  function leftPct(driver: DriverEntry): number {
    if (hasPct && Number.isFinite(driver.lapDistPct) && Number.isFinite(playerPct)) {
      return (relLapDist(driver.lapDistPct as number, playerPct) + 0.5) * 100
    }
    return drivers.length > 1 ? ((driver.position - 1) / (drivers.length - 1)) * 100 : 50
  }

  const bubbles: Bubble[] = drivers.map((d) => ({
    key: d.carIdx,
    left: leftPct(d),
    isPlayer: !!(d.isPlayer || d.carIdx === playerIdx),
    color: d.classColor ?? CLASS_FALLBACK,
    num: d.carNumber
  }))

  const axisY = H / 2
  const margin = 24
  const trackW = W - margin * 2
  const r = Math.min(H * 0.36, 22)
  const xForLeft = (left: number): number => margin + (Math.max(0, Math.min(100, left)) / 100) * trackW

  return (
    <svg {...rootProps}>
      {panel}
      <line x1={margin} y1={axisY} x2={W - margin} y2={axisY} stroke={skin.palette.textDim} strokeWidth={2} opacity={0.35} />
      {bubbles.map((b) => {
        const cx = xForLeft(b.left)
        return (
          <g key={b.key}>
            <circle cx={cx} cy={axisY} r={r} fill={b.color} opacity={b.isPlayer ? 0.28 : 0.9} />
            <circle
              cx={cx}
              cy={axisY}
              r={r}
              fill="none"
              stroke={b.isPlayer ? skin.palette.accent : b.color}
              strokeWidth={b.isPlayer ? 3 : 1.5}
            />
            <FitText
              x={cx}
              y={axisY}
              boxW={r * 1.7}
              boxH={r * 1.3}
              text={b.num || '—'}
              anchor="middle"
              fontFamily={skin.segment.numeric}
              fill={b.isPlayer ? skin.palette.accent : skin.palette.text}
              weight={700}
              minFontPx={11}
              maxFontPx={Math.max(12, r)}
              overflowStrategy="squeeze"
            />
          </g>
        )
      })}
    </svg>
  )
}
